/**
 * scripts/__tests__/config-surface-lean-lead-lifecycle-host-mode.test.ts
 *
 * rf-wi-01 (v23x-deferred-followups G1) — config-surface registration for the three
 * keys that were read TOLERANTLY by their guards but were NOT registered in the
 * canonical closed config schema, so they were invisible to `config validate/set/
 * resolve/show --sources` and undiscoverable:
 *   - defaults.lean_lead.*      (hooks/lib/lean-lead-guard.ts)
 *   - defaults.lifecycle_gate.* (hooks/lib/lifecycle-gate.ts)
 *   - host_mode                 (scripts/lib/permission-policy.ts RuntimePermissionConfig)
 *
 * RED-FIRST EVIDENCE (captured before implementation, see rf-wi-01 handoff receipt):
 *   - CONFIG_SCHEMA did not contain any of the 5 flattened keys below.
 *   - `read-guild-config.ts --validate` on a settings.json carrying
 *     `defaults.lean_lead`/`defaults.lifecycle_gate`/`host_mode` reported them as
 *     "unknown key" violations (closed-schema reject).
 *   - `config-cmd.ts show --sources` never printed a `host_mode` line at all.
 * This file pins the GREEN (post-fix) contract so the gap can never silently reopen.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CONFIG_SCHEMA, getFieldSpec } from "../lib/config-schema";
import { defaultIsValidValue } from "../lib/config-reconcile-contract";
import { reconcileConfig, type ReconcileIO } from "../lib/config-reconcile";

const READ_GUILD_CONFIG = path.resolve(__dirname, "..", "read-guild-config.ts");
const CONFIG_CMD = path.resolve(__dirname, "..", "config-cmd.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

const RECONCILE_SETTINGS = "/repo/.guild/settings.json";
const RECONCILE_PROV = "/repo/.guild/settings.provenance.json";
function memReconcileIO(seed: Record<string, string> = {}): { io: ReconcileIO; store: Map<string, string> } {
  const store = new Map<string, string>(Object.entries(seed));
  const io: ReconcileIO = {
    readFileText: (p) => (store.has(p) ? (store.get(p) as string) : null),
    writeFileText: (p, text) => void store.set(p, text),
    ensureDir: () => {},
  };
  return { io, store };
}

function runReadGuildConfig(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", READ_GUILD_CONFIG, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function runConfigCmd(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", CONFIG_CMD, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cfg-g1-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  return dir;
}

function writeSettings(dir: string, obj: unknown): void {
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(obj, null, 2));
}

const NEW_KEYS = [
  "defaults.lean_lead.enabled",
  "defaults.lean_lead.hands_on_edit_threshold",
  "defaults.lifecycle_gate.enabled",
  "defaults.lifecycle_gate.adhoc_activity_threshold",
  "host_mode",
];

describe("config-schema.ts — G1 registration (CONFIG_SCHEMA)", () => {
  it("registers all 5 new keys with the documented defaults", () => {
    expect(getFieldSpec("defaults.lean_lead.enabled")?.default).toBe(true);
    expect(getFieldSpec("defaults.lean_lead.hands_on_edit_threshold")?.default).toBe(8);
    expect(getFieldSpec("defaults.lifecycle_gate.enabled")?.default).toBe(true);
    expect(getFieldSpec("defaults.lifecycle_gate.adhoc_activity_threshold")?.default).toBe(20);
    expect(getFieldSpec("host_mode")?.default).toBe(null);
  });

  it("host_mode is flagged security-sensitive with a fail-closed most_restrictive", () => {
    const spec = getFieldSpec("host_mode");
    expect(spec?.security_sensitive).toBe(true);
    expect(spec?.most_restrictive).toBe(null);
  });

  it("host_mode is a NULLABLE enum — not type 'object' (codex-review P1 fix)", () => {
    // Before the fix, inferType(null) classified host_mode as type "object", under
    // which defaultIsValidValue requires typeof value === "object" — a VALID enum
    // string like "read_only" would be misclassified as malformed, and `reconcile
    // repair` would silently reset a real user setting back to null.
    const spec = getFieldSpec("host_mode");
    expect(spec?.type).toBe("enum");
    expect(spec?.nullable).toBe(true);
    expect(spec?.enum_values).toEqual(["read_only", "ask", "accept_edits", "auto", "bypass_all"]);
  });

  it("isValidValue accepts both null and every enum member for host_mode (never flags a real value as malformed)", () => {
    const spec = getFieldSpec("host_mode")!;
    expect(defaultIsValidValue(spec, null)).toBe(true);
    for (const v of spec.enum_values ?? []) {
      expect(defaultIsValidValue(spec, v)).toBe(true);
    }
    expect(defaultIsValidValue(spec, "godmode")).toBe(false);
    expect(defaultIsValidValue(spec, 123)).toBe(false);
  });

  it("reconcile repair does NOT reset a valid RECONCILED host_mode back to null (codex-review P1 regression)", () => {
    // Before the fix: host_mode's inferred type "object" made "read_only" look
    // malformed, so repair mode fired security_sensitive's repair-most-restrictive
    // path and silently reset it to null even though it was a perfectly valid value.
    const seed = {
      [RECONCILE_SETTINGS]: JSON.stringify({ host_mode: "read_only" }, null, 2) + "\n",
      [RECONCILE_PROV]:
        JSON.stringify({ host_mode: { provenance: "reconciled", last_reconciled_at: "2026-06-15T12:00:00Z" } }, null, 2) + "\n",
    };
    const { io, store } = memReconcileIO(seed);
    const r = reconcileConfig({ cwd: "/repo", mode: "repair", now: "2026-07-01T00:00:00Z", io });
    const out = JSON.parse(store.get(RECONCILE_SETTINGS) as string);
    expect(out.host_mode).toBe("read_only"); // unchanged — a valid value is NOT malformed
    expect(r.findings.find((f) => f.key === "host_mode")?.status).not.toBe("malformed");
  });

  it("every NEW_KEYS entry is present in the flattened schema exactly once", () => {
    for (const key of NEW_KEYS) {
      const matches = CONFIG_SCHEMA.filter((s) => s.key === key);
      expect(matches.length).toBe(1);
    }
  });
});

describe("read-guild-config.ts --validate — G1 keys", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  it("accepts a settings.json that sets all 3 keys to valid values", () => {
    const dir = repo();
    writeSettings(dir, {
      host_mode: "accept_edits",
      defaults: {
        lean_lead: { enabled: false, hands_on_edit_threshold: 4 },
        lifecycle_gate: { enabled: false, adhoc_activity_threshold: 10 },
      },
    });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(out).toMatch(/VALID/);
    expect(status).toBe(0);
  });

  it("still rejects a genuinely unknown key (closed schema not accidentally opened)", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { lean_lead: { bogus_key: 1 } } });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/unknown defaults\.lean_lead key "bogus_key"/);
  });

  it("rejects a wrong-SHAPE lean_lead/lifecycle_gate block (codex-review P2 fix)", () => {
    // Before the fix, a non-object value silently passed validate --validate
    // (the check was gated entirely behind isPlainObject, with no else-reject).
    const dir1 = repo();
    writeSettings(dir1, { defaults: { lean_lead: "oops" } });
    const r1 = runReadGuildConfig(["--validate", "--cwd", dir1]);
    expect(r1.status).not.toBe(0);
    expect(r1.out).toMatch(/defaults\.lean_lead must be an object/);

    const dir2 = repo();
    writeSettings(dir2, { defaults: { lifecycle_gate: [1, 2, 3] } });
    const r2 = runReadGuildConfig(["--validate", "--cwd", dir2]);
    expect(r2.status).not.toBe(0);
    expect(r2.out).toMatch(/defaults\.lifecycle_gate must be an object/);
  });

  it("rejects an unknown top-level key even after host_mode is registered", () => {
    const dir = repo();
    writeSettings(dir, { totally_bogus_top_level_key: 1 });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/unknown top-level key "totally_bogus_top_level_key"/);
  });

  it("rejects an invalid host_mode enum value", () => {
    const dir = repo();
    writeSettings(dir, { host_mode: "godmode" });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/host_mode/);
  });

  it("resolve mode reflects the configured host_mode + lean_lead + lifecycle_gate", () => {
    const dir = repo();
    writeSettings(dir, {
      host_mode: "read_only",
      defaults: { lean_lead: { enabled: false, hands_on_edit_threshold: 2 } },
    });
    const { status, out } = runReadGuildConfig(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.host_mode).toBe("read_only");
    expect(j.defaults.lean_lead).toEqual({ enabled: false, hands_on_edit_threshold: 2 });
    // unspecified lifecycle_gate keeps the documented default (deep-merge, not clobbered)
    expect(j.defaults.lifecycle_gate).toEqual({ enabled: true, adhoc_activity_threshold: 20 });
  });
});

describe("config-cmd.ts show --sources — host_mode surfaces with its layer", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  it("prints host_mode with a [project] source when set in settings.json", () => {
    const dir = repo();
    writeSettings(dir, { host_mode: "bypass_all" });
    const { status, out } = runConfigCmd(["show", "--sources", "--cwd", dir]);
    expect(status).toBe(0);
    expect(out).toMatch(/host_mode = bypass_all\s+\[project\]/);
    expect(out).toMatch(/host_mode=bypass_all \[project\]/); // per-cell annotation in the permission table
  });

  it("defaults host_mode to the host baseline (ask) with a [builtin] source when unset", () => {
    const dir = repo();
    const { status, out } = runConfigCmd(["show", "--sources", "--cwd", dir]);
    expect(status).toBe(0);
    expect(out).toMatch(/host_mode = null\s+\[builtin\]/);
  });
});
