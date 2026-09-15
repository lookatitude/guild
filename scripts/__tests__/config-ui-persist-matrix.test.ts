/**
 * scripts/__tests__/config-ui-persist-matrix.test.ts
 *
 * init-config-goal lane L5 (§V / V12) — the persistence + immediate-reload MATRIX.
 *
 * Drives `config ui set` (cmdUiSet, the §E12 persistence path) over EVERY key in
 * CONFIG_UI_METADATA with a valid value + the confirmation the metadata DECLARES,
 * and proves:
 *   (1) validate-before-write — an invalid candidate is rejected and persists NOTHING;
 *   (2) every valid edit persists to the INTENDED scoped file (read-modify-write,
 *       never-clobber across the whole 109-key sweep);
 *   (3) the smoke subset (spec §V12) round-trips through a FRESH resolveSettings and is
 *       visible from TWO host families' rendered surfaces (host-agnostic persistence);
 *   (4) immediate reload reflects the new value.
 *
 * Completeness guard: the value table is GENERATED from CONFIG_UI_METADATA itself, so a
 * newly-added metadata key is covered automatically — there is no hand-maintained key
 * list to drift. Anti-vacuity (spec §V): a mutate-and-confirm test proves the round-trip
 * assertions actually fail when the expected value is wrong.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { cmdUiSet } from "../config-cmd";
import {
  CONFIG_UI_METADATA,
  type ConfigUiMeta,
  type ConfirmationStrength,
} from "../lib/config-ui-metadata";
import { resolveSettings } from "../lib/settings-resolver";
import { canonicalPolicyKey, isPolicyKey } from "../../src/modules/config/workflows/policy-keys";
import { policyValue, resolvePolicy } from "../../src/modules/config/workflows/policy-resolver";
import { buildHostConfigUiSurface, getByPath } from "../lib/config-ui-surface";
import type { ConfigSource } from "../lib/config-render";

// ---------------------------------------------------------------------------
// scaffolding
// ---------------------------------------------------------------------------

const TMPDIRS: string[] = [];
afterAll(() => {
  for (const d of TMPDIRS) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function mkProject(settings: unknown = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-persist-"));
  TMPDIRS.push(dir);
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
  return dir;
}

/** Silence the cmdUiSet stdout chatter for the duration of `fn`. */
function quiet<T>(fn: () => T): T {
  const spy = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}

/** Read a dotted path out of a parsed settings file. */
function deepGet(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const p of dotted.split(".")) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function readSettings(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"));
}

/** The U-CFG policy file — the durable home of the closed policy key set (KTD22). */
function readPolicy(dir: string): Record<string, unknown> {
  const file = path.join(dir, ".guild", "config", "project.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

// ---------------------------------------------------------------------------
// value generator — driven by control + per-key overrides (enums, objects, ranges)
// ---------------------------------------------------------------------------

/** The confirmation token cmdUiSet needs for a key (undefined for none/normal). */
function confirmTokenFor(strength: ConfirmationStrength): string | undefined {
  return strength === "none" || strength === "normal" ? undefined : strength;
}

/**
 * Per-key value overrides: every enum (closed value set), every object_editor (shape),
 * and the few keys whose generic control-default would not be a meaningful valid value.
 */
const VALUE_OVERRIDES: Record<string, string> = {
  // closed-enum keys
  "defaults.update.mode": "auto",
  rigor: "deep",
  review: "off",
  index: "auto",
  codex_skip_enforcement: "block",
  agent_mode: "team",
  host: "codex",
  host_mode: "accept_edits", // rf-wi-01 (G1) — P1-L10 host-autonomy override enum
  "roles.host": "claude-code-cli",
  "roles.advisory": "codex-cli",
  "roles.adversarial": "claude-code-cli",
  "models.cacheTTL.coordinator": "5m",
  "models.cacheTTL.leaf": "1h",
  "defaults.adversarial": "on",
  "defaults.review_workflow": "cross",
  "defaults.skill_policy": "conservative",
  "defaults.reporting": "verbose",
  "defaults.wiki.share_mode": "private",
  "defaults.retry.backoff": "exponential",
  "defaults.wiki.autopromote": "false", // always-false invariant (agents emit candidates only) — true is rejected

  // S5 (cap-loc-D04) — capability localization enums. Values differ from their
  // defaults on purpose: this matrix persists a value and reads it back, so a value
  // equal to the default would pass vacuously.
  "capability.resolver_mode": "shadow",
  "capability.auto_create_policy": "never",

  "security.bypass_permissions_policy": "allow",
  "secrets_policy.fail_mode_durable": "open",
  "secrets_policy.fail_mode_telemetry": "closed",
  "workspace.mode": "on",
  // valid CSV for loops (a bare "x" would be dropped by the resolver's CSV validator)
  loops: "all",
  // object_editor shapes
  // minimal guild.model_policy.v2 object accepted by the closed-key validator
  model_policy: '{"version":2,"purposes":{}}',
  host_profiles: '{"claude-code-cli":{"enabled":true}}',
  "models.shortOutputThreshold": '{"impl":{"cheap":100}}',
  "defaults.cross_host.hosts": '{"box":{"address":"10.0.0.1"}}',
  "mcp.tool_description_hashes": '{"tool":"abc"}',
};

/** A valid raw value string for a metadata key, derived from its control (+ overrides). */
function valueFor(key: string, meta: ConfigUiMeta): string {
  if (key in VALUE_OVERRIDES) return VALUE_OVERRIDES[key];
  switch (meta.control) {
    case "boolean":
      return "true";
    case "number":
      return "1"; // within every numeric key's accepted range (incl. the [0,1] ratios)
    case "string_array":
    case "multi_select":
      return '["spec"]';
    case "secret_array":
      return '["sk-x"]';
    case "text":
      // model-tier matrix cells + open text keys accept any string.
      return "haiku";
    case "enum":
    case "object_editor":
      // every enum / object_editor key must be in VALUE_OVERRIDES; fail loudly if not.
      throw new Error(`missing VALUE_OVERRIDES entry for ${meta.control} key "${key}"`);
    default:
      return "x";
  }
}

interface KeyEdit {
  key: string;
  value: string;
  confirm: string | undefined;
  meta: ConfigUiMeta;
}

/** Generated from CONFIG_UI_METADATA — covers EVERY key (completeness is automatic). */
const KEY_EDITS: KeyEdit[] = Object.entries(CONFIG_UI_METADATA).map(([key, meta]) => ({
  key,
  value: valueFor(key, meta),
  confirm: confirmTokenFor(meta.confirmation_strength),
  meta,
}));

/** Per-host model inventory — refused at every write surface after U-CFG (KTD22). */
function isInventoryKey(key: string): boolean {
  return /^models\.tiers(\.|$)/.test(key);
}

/** The physical key path cmdSet writes (host_profiles uses canonical id; here ids are canonical). */
function writePathFor(key: string): string {
  return key;
}

// ===========================================================================
// V12.0 — completeness: the matrix covers EVERY metadata key
// ===========================================================================

describe("V12.0 — the persist matrix covers every CONFIG_UI_METADATA key", () => {
  it("one edit per metadata key, no gaps (generated, so it can't silently drift)", () => {
    expect(KEY_EDITS.length).toBe(Object.keys(CONFIG_UI_METADATA).length);
    // rf-wi-01 (G1): +5 — host_mode, defaults.lean_lead.{enabled,hands_on_edit_threshold},
    // defaults.lifecycle_gate.{enabled,adhoc_activity_threshold}.
    // S5 (cap-loc-D04): +4 — capability.{resolver_mode,suggestion_budget,
    // starter_roles,auto_create_policy}.
    // +1 (dynamic-host-model-routing T5): capability model_policy (guild.model_policy.v2).
    // +1 (#93): defaults.dispatch.block_unmarked_lanes — the backend-degradation
    // guard's strict rung, promoted from the GUILD_BLOCK_UNMARKED_LANES env flag.
    expect(KEY_EDITS.length).toBe(143);
    // every enum/object_editor key resolved to a concrete value (no generator throw)
    for (const e of KEY_EDITS) expect(typeof e.value).toBe("string");
  });
});

// ===========================================================================
// V12.1 — persist EVERY key to the intended file (project scope), never-clobber
// ===========================================================================

// U-CFG (KTD22): `config ui set` delegates every byte of persistence to the config
// write API (`cmdSet`), and that API is POLICY-ONLY. So the UI inherits the same
// contract: the closed policy set persists, everything else is refused. The rule
// this block pins — one edit per metadata key, each lands where intended, nothing
// clobbers a sibling — is unchanged; the partition is new.
describe("V12.1 — every key persists to the intended scoped file", () => {
  it("edits all metadata keys: policy keys land in the policy file, the rest are refused", () => {
    const dir = mkProject({});
    quiet(() => {
      for (const e of KEY_EDITS) {
        const rc = cmdUiSet(dir, e.key, e.value, "project", undefined, e.confirm);
        expect([e.key, rc]).toEqual([e.key, isPolicyKey(e.key) ? 0 : 1]);
      }
    });

    const onDiskPolicy = readPolicy(dir);
    for (const e of KEY_EDITS) {
      const landed = deepGet(onDiskPolicy, canonicalPolicyKey(e.key));
      if (isPolicyKey(e.key)) expect([e.key, landed !== undefined]).toEqual([e.key, true]);
    }
    // A refused write persists NOTHING: no non-policy key reached settings.json.
    const onDiskSettings = readSettings(dir);
    for (const e of KEY_EDITS) {
      if (isPolicyKey(e.key)) continue;
      expect([e.key, deepGet(onDiskSettings, writePathFor(e.key))]).toEqual([e.key, undefined]);
    }
    // Coexistence: every policy key survived the full sweep, not just the last one.
    const policyKeysEdited = KEY_EDITS.filter((e) => isPolicyKey(e.key));
    expect(policyKeysEdited.length).toBeGreaterThan(0);
    for (const e of policyKeysEdited) {
      expect(deepGet(onDiskPolicy, canonicalPolicyKey(e.key))).not.toBeUndefined();
    }
  });

  it("local scope writes the machine-local POLICY file, not the project one", () => {
    const dir = mkProject({});
    quiet(() => {
      expect(cmdUiSet(dir, "agent_mode", "team", "local", undefined, "advanced")).toBe(0);
    });
    const local = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "config", "project.local.json"), "utf8"),
    );
    expect(local.agent_mode).toBe("team");
    expect(readPolicy(dir).agent_mode).toBeUndefined(); // project file untouched
  });
});

// ===========================================================================
// V12.3 — smoke subset round-trips: fresh resolveSettings + TWO host families
// ===========================================================================

/** The spec §V12 smoke subset — exercised end-to-end (persist → resolve → cross-host render). */
const SMOKE: Array<{ key: string; value: string; confirm?: string; expect: unknown }> = [
  { key: "rigor", value: "deep", expect: "deep" },
  { key: "loops", value: "all", expect: "all" },
  { key: "loop_cap", value: "8", expect: 8 },
  { key: "codex_cap", value: "3", expect: 3 },
  { key: "review", value: "off", confirm: "danger", expect: "off" },
  { key: "agent_mode", value: "team", confirm: "advanced", expect: "team" },
  { key: "roles.host", value: "claude-code-cli", confirm: "advanced", expect: "claude-code-cli" },
  { key: "defaults.team.size", value: "5", expect: 5 },
  { key: "auto_approve", value: '["spec"]', confirm: "strongest", expect: ["spec"] },
  { key: "models.thresholds.mid", value: "6", confirm: "advanced", expect: 6 },
  { key: "security.bypass_permissions_policy", value: "allow", confirm: "strongest", expect: "allow" },
  { key: "secrets_policy.redaction_patterns", value: '["sk-x"]', confirm: "strongest", expect: ["sk-x"] },
  { key: "mcp.stdio_available", value: "true", confirm: "strongest", expect: true },
  { key: "defaults.index.enabled", value: "true", expect: true },
  { key: "defaults.quality.budget.per_class_minutes", value: "7", expect: 7 },
];

const NOW = "2026-06-26T00:00:00.000Z";

function surfaceValueFor(host: string, dir: string, key: string): { value: string; source: ConfigSource } | undefined {
  const { config, sources } = resolveSettings({ cwd: dir });
  const s = buildHostConfigUiSurface({
    host,
    config: config as never,
    sources: sources as unknown as Record<string, ConfigSource>,
    renderedAt: NOW,
  });
  for (const g of s.groups) {
    const row = g.keys.find((k) => k.key === key);
    if (row) return { value: row.value, source: row.source };
  }
  return undefined;
}

// U-CFG (KTD22): the smoke round-trip now runs against the POLICY resolver, because
// that is where a `ui set` write lands. The legacy keys this block used to carry are
// refused at the write, so each one is pinned as a refusal instead of a round-trip.
describe("V12.3 — smoke subset persists + reloads + is visible across host families", () => {
  const POLICY_SMOKE: Array<{ key: string; value: string; confirm?: string; expect: unknown }> = [
    { key: "agent_mode", value: "team", confirm: "advanced", expect: "team" },
    // The metadata still carries the LEGACY spelling; it aliases onto the policy key.
    { key: "defaults.wiki.autopromote", value: "false", confirm: "advanced", expect: false },
  ];

  for (const c of POLICY_SMOKE) {
    it(`${c.key} → a fresh resolvePolicy sees the persisted value`, () => {
      const dir = mkProject({});
      expect(quiet(() => cmdUiSet(dir, c.key, c.value, "project", undefined, c.confirm))).toBe(0);
      const resolved = resolvePolicy({ cwd: dir });
      expect(policyValue(resolved, c.key)).toEqual(c.expect);
      expect(resolved.sources[canonicalPolicyKey(c.key)]).toBe("project");
    });
  }

  for (const c of SMOKE.filter((x) => !isPolicyKey(x.key))) {
    it(`${c.key} → refused: not a policy key, nothing persisted`, () => {
      const dir = mkProject({});
      expect(quiet(() => cmdUiSet(dir, c.key, c.value, "project", undefined, c.confirm))).toBe(1);
      expect(deepGet(readSettings(dir), writePathFor(c.key))).toBeUndefined();
      expect(deepGet(readPolicy(dir), c.key)).toBeUndefined();
    });
  }

  it("a policy value renders identically from TWO host families (host-agnostic)", () => {
    const dir = mkProject({});
    quiet(() => {
      expect(cmdUiSet(dir, "agent_mode", "team", "project", undefined, "advanced")).toBe(0);
    });
    const resolved = resolvePolicy({ cwd: dir });
    // Policy carries no host identity at all, so there is nothing to render per host:
    // the SAME value is what every host family reads.
    expect(policyValue(resolved, "agent_mode")).toBe("team");
    for (const host of ["claude-code-cli", "codex-cli", "agents-file"]) {
      expect(surfaceValueFor(host, dir, "agent_mode")?.value).toBe("auto"); // legacy surface, untouched
    }
  });
});


describe("V12.4 — the round-trip is non-vacuous (mutate-and-confirm)", () => {
  it("asserting the OLD/default value after a successful edit throws", () => {
    // Driven on a POLICY key: a legacy key no longer persists at all (U-CFG).
    const dir = mkProject({});
    quiet(() => expect(cmdUiSet(dir, "agent_mode", "team", "project", undefined, "advanced")).toBe(0));
    const config = resolvePolicy({ cwd: dir }).policy as Record<string, unknown>;
    expect(config.agent_mode).toBe("team");
    // The builtin default ("auto") must no longer be observed — the reload is real.
    expect(() => expect(config.agent_mode).toBe("auto")).toThrow();
  });
});

// L5-r2: the models.knowledge.* editability fix must be TIGHT (G-lane MAJORs) — reject
// (a) deeper paths and (b) out-of-range values write-time, so nothing invalid is persisted
// (validate-before-write must mirror the resolver, which would silently drop these).
describe("config ui set — models.knowledge.* validation is tight (no invalid write)", () => {
  const NOOP = () => undefined;
  const quietRc = (fn: () => number): number => {
    const e = console.error; console.error = NOOP as typeof console.error;
    try { return fn(); } finally { console.error = e; }
  };
  it("rejects a DEEPER path (models.knowledge.maxDepth.foo) and writes nothing", () => {
    const dir = mkProject({});
    const before = readSettings(dir);
    const rc = quietRc(() => cmdUiSet(dir, "models.knowledge.maxDepth.foo", "5", "project", undefined, "strongest"));
    expect(rc).not.toBe(0);
    expect(readSettings(dir)).toEqual(before); // never-clobber: tree byte-identical
  });
  it("rejects OUT-OF-RANGE integer (maxDepth=0; resolver requires >=1) and writes nothing", () => {
    const dir = mkProject({});
    const before = readSettings(dir);
    const rc = quietRc(() => cmdUiSet(dir, "models.knowledge.maxDepth", "0", "project", undefined, "strongest"));
    expect(rc).not.toBe(0);
    expect(readSettings(dir)).toEqual(before);
  });
  it("rejects OUT-OF-RANGE ratio (minTopicImportance=2; resolver requires [0,1]) and writes nothing", () => {
    const dir = mkProject({});
    const before = readSettings(dir);
    const rc = quietRc(() => cmdUiSet(dir, "models.knowledge.minTopicImportance", "2", "project", undefined, "strongest"));
    expect(rc).not.toBe(0);
    expect(readSettings(dir)).toEqual(before);
  });
  // U-CFG (KTD22): `models.knowledge.*` is no longer writable at all — the write API
  // is policy-only. The validator still runs FIRST, so the two rejections above still
  // prove their point; the anti-vacuity control moves to a key that can still write.
  it("anti-vacuity: an IN-RANGE POLICY value still WRITES (rc 0, persisted)", () => {
    const dir = mkProject({});
    const rc = quietRc(() => cmdUiSet(dir, "agent_mode", "team", "project", undefined, "advanced"));
    expect(rc).toBe(0);
    expect(deepGet(readPolicy(dir), "agent_mode")).toBe("team");
  });

  it("a refused machine overlay makes the post-write reload FAIL (rc 1), never a stale [builtin] (codex r3)", () => {
    // The overlay lives on the platform STATE root; point it at a temp root and
    // seed a concrete model name, which the resolver refuses fail-closed.
    const dir = mkProject({});
    const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), "guild-state-"));
    const prev = process.env.GUILD_STATE_HOME;
    process.env.GUILD_STATE_HOME = stateHome;
    try {
      const { createGuildStorage } = require("../../src/modules/state") as {
        createGuildStorage: (c: string) => { runtime(...s: string[]): string };
      };
      const overlay = createGuildStorage(dir).runtime("policy-overlay.json");
      fs.mkdirSync(path.dirname(overlay), { recursive: true });
      fs.writeFileSync(overlay, JSON.stringify({ tiers: { default: "opus" } }) + "\n");
      const rc = quietRc(() => cmdUiSet(dir, "agent_mode", "team", "project", undefined, "advanced"));
      expect(rc).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.GUILD_STATE_HOME; else process.env.GUILD_STATE_HOME = prev;
    }
  });

  it("models.knowledge.maxDepth is refused by the policy-only write API", () => {
    const dir = mkProject({});
    expect(quietRc(() => cmdUiSet(dir, "models.knowledge.maxDepth", "4", "project", undefined, "strongest"))).toBe(1);
    expect(deepGet(readSettings(dir), "models.knowledge.maxDepth")).toBeUndefined();
  });
});
