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
  rigor: "deep",
  review: "off",
  index: "auto",
  codex_skip_enforcement: "block",
  agent_mode: "team",
  host: "codex",
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
  "security.bypass_permissions_policy": "allow",
  "secrets_policy.fail_mode_durable": "open",
  "secrets_policy.fail_mode_telemetry": "closed",
  "workspace.mode": "on",
  // valid CSV for loops (a bare "x" would be dropped by the resolver's CSV validator)
  loops: "all",
  // object_editor shapes
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
    expect(KEY_EDITS.length).toBe(109);
    // every enum/object_editor key resolved to a concrete value (no generator throw)
    for (const e of KEY_EDITS) expect(typeof e.value).toBe("string");
  });
});

// ===========================================================================
// V12.1 — persist EVERY key to the intended file (project scope), never-clobber
// ===========================================================================

describe("V12.1 — every key persists to the intended scoped file", () => {
  it("edits all 109 keys into one project settings.json; each lands, all coexist", () => {
    const dir = mkProject({});
    quiet(() => {
      for (const e of KEY_EDITS) {
        const rc = cmdUiSet(dir, e.key, e.value, "project", undefined, e.confirm);
        expect(rc).toBe(0); // PLAN ok + validate-before-write + persist + reload all succeeded
      }
    });
    // Every written key path is present on disk (read-modify-write never-clobbered any sibling).
    const onDisk = readSettings(dir);
    for (const e of KEY_EDITS) {
      const v = deepGet(onDisk, writePathFor(e.key));
      expect(v).not.toBeUndefined();
    }
    // Spot-check coexistence: an early write and a late write both survive the 109-edit sweep.
    expect(deepGet(onDisk, "rigor")).toBe("deep");
    expect(deepGet(onDisk, "mcp.tool_description_hashes")).toEqual({ tool: "abc" });
  });

  it("local scope writes settings.local.json (intended file), not settings.json", () => {
    const dir = mkProject({});
    quiet(() => {
      const rc = cmdUiSet(dir, "rigor", "deep", "local", undefined, undefined);
      expect(rc).toBe(0);
    });
    const local = JSON.parse(fs.readFileSync(path.join(dir, ".guild", "settings.local.json"), "utf8"));
    expect(local.rigor).toBe("deep");
    expect(readSettings(dir).rigor).toBeUndefined(); // project file untouched
  });
});

// ===========================================================================
// V12.2 — validate-before-write: invalid candidates rejected, persist NOTHING
// ===========================================================================

describe("V12.2 — validate-before-write rejects invalid values (nothing persisted)", () => {
  const INVALID: Array<{ key: string; value: string; confirm?: string; why: string }> = [
    { key: "rigor", value: "bogus", why: "enum out of range" },
    { key: "review", value: "nope", confirm: "danger", why: "enum out of range (confirm ok)" },
    { key: "loop_cap", value: "not-a-number", why: "non-integer" },
    { key: "defaults.index.enabled", value: "yes", why: "boolean must be true|false" },
    { key: "roles.host", value: "claudee", confirm: "advanced", why: "unknown host id" },
    { key: "mcp.tool_description_hashes", value: "{bad json", confirm: "strongest", why: "malformed JSON" },
  ];

  for (const c of INVALID) {
    it(`rejects ${c.key}=${c.value} (${c.why}) and writes nothing`, () => {
      const dir = mkProject({});
      const rc = quiet(() => cmdUiSet(dir, c.key, c.value, "project", undefined, c.confirm));
      expect(rc).toBe(1);
      expect(readSettings(dir)).toEqual({}); // file untouched — no half-applied state
    });
  }

  it("a danger key WITHOUT --confirm is rejected before any write (confirmation gate)", () => {
    const dir = mkProject({});
    const rc = quiet(() => cmdUiSet(dir, "review", "off", "project", undefined, undefined));
    expect(rc).toBe(1);
    expect(readSettings(dir)).toEqual({});
  });

  it("a strongest key with only a danger confirmation is rejected (insufficient strength)", () => {
    const dir = mkProject({});
    const rc = quiet(() =>
      cmdUiSet(dir, "security.bypass_permissions_policy", "allow", "project", undefined, "danger")
    );
    expect(rc).toBe(1);
    expect(readSettings(dir)).toEqual({});
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

describe("V12.3 — smoke subset persists + reloads + is visible across host families", () => {
  for (const c of SMOKE) {
    it(`${c.key} → fresh resolveSettings sees the persisted value`, () => {
      const dir = mkProject({});
      const rc = quiet(() => cmdUiSet(dir, c.key, c.value, "project", undefined, c.confirm));
      expect(rc).toBe(0);
      // Fresh resolve (the immediate-reload contract, re-derived independently).
      const { config, sources } = resolveSettings({ cwd: dir });
      expect(getByPath(config as never, c.key)).toEqual(c.expect);
      // Top-level attribution is the project layer (drives the surface `source` column).
      const top = c.key.split(".")[0];
      expect((sources as Record<string, string>)[top]).toBe("project");
    });
  }

  it("the persisted value renders identically from TWO host families (host-agnostic)", () => {
    const dir = mkProject({});
    quiet(() => {
      expect(cmdUiSet(dir, "rigor", "deep", "project", undefined, undefined)).toBe(0);
      expect(cmdUiSet(dir, "defaults.team.size", "5", "project", undefined, undefined)).toBe(0);
    });
    for (const host of ["claude-code-cli", "codex-cli", "agents-file"]) {
      const rigor = surfaceValueFor(host, dir, "rigor");
      expect(rigor).toBeDefined();
      expect(rigor!.value).toBe("deep");
      expect(rigor!.source).toBe("project");
      const teamSize = surfaceValueFor(host, dir, "defaults.team.size");
      expect(teamSize!.value).toBe("5");
      expect(teamSize!.source).toBe("project");
    }
  });

  it("a secret value persists (resolver sees it) but the surface NEVER echoes it", () => {
    const dir = mkProject({});
    quiet(() =>
      expect(
        cmdUiSet(dir, "secrets_policy.redaction_patterns", '["sk-SECRET"]', "project", undefined, "strongest")
      ).toBe(0)
    );
    // resolver sees the real value …
    const { config } = resolveSettings({ cwd: dir });
    expect(getByPath(config as never, "secrets_policy.redaction_patterns")).toEqual(["sk-SECRET"]);
    // … but the rendered surface masks it and the raw secret appears nowhere.
    const row = surfaceValueFor("claude-code-cli", dir, "secrets_policy.redaction_patterns");
    expect(row!.value).not.toContain("sk-SECRET");
  });
});

// ===========================================================================
// V12.4 — anti-vacuity: a wrong expectation actually fails
// ===========================================================================

describe("V12.4 — the round-trip is non-vacuous (mutate-and-confirm)", () => {
  it("asserting the OLD/default value after a successful edit throws", () => {
    const dir = mkProject({ loop_cap: 16 });
    quiet(() => expect(cmdUiSet(dir, "loop_cap", "4", "project", undefined, undefined)).toBe(0));
    const { config } = resolveSettings({ cwd: dir });
    expect(config.loop_cap).toBe(4);
    // The pre-edit value (16) must no longer be observed — proving the reload is real.
    expect(() => expect(config.loop_cap).toBe(16)).toThrow();
  });
});
