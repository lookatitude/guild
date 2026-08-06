/**
 * scripts/__tests__/config-surface-block-unmarked-lanes.test.ts
 *
 * Issue #93 — promote the backend-degradation guard's STRICT unmarked-lane block
 * from an undiscoverable env-only flag (`GUILD_BLOCK_UNMARKED_LANES`, shipped by
 * PR #85 / G3) to a first-class registered key in the canonical CLOSED config
 * schema: `defaults.dispatch.block_unmarked_lanes`.
 *
 * This is the exact shape PR #87 (rf-wi-01) used for `defaults.lean_lead.*` /
 * `defaults.lifecycle_gate.*`: one canonical DEFAULTS entry, mirrored into every
 * closed-key set that guards `config validate` / `set` / `resolve` /
 * `show --sources`, so the key is discoverable AND validated instead of a bare
 * `process.env` read nobody can find.
 *
 * RED-FIRST EVIDENCE (captured before implementation):
 *   - CONFIG_SCHEMA carried no `defaults.dispatch.block_unmarked_lanes` entry
 *     (`getFieldSpec(...)` → undefined).
 *   - `read-guild-config.ts --validate` on a settings.json setting the key
 *     rejected it as `unknown defaults key "dispatch"`.
 *   - `config-cmd.ts show --sources` never printed the key at all.
 * This file pins the GREEN contract so the gap cannot silently reopen.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { CONFIG_SCHEMA, getFieldSpec, isSecuritySensitiveKey } from "../lib/config-schema";
import { CONFIG_UI_METADATA } from "../lib/config-ui-metadata";
import { DEFAULTS } from "../lib/shared/config-defaults";
import { validateDefaults } from "../../src/modules/config/workflows/config-validation";

const READ_GUILD_CONFIG = path.resolve(__dirname, "..", "read-guild-config.ts");
const CONFIG_CMD = path.resolve(__dirname, "..", "config-cmd.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

/** The one key this lane registers. */
const KEY = "defaults.dispatch.block_unmarked_lanes";

function runReadGuildConfig(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", READ_GUILD_CONFIG, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function runConfigCmd(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", CONFIG_CMD, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cfg-93-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  return dir;
}

function writeSettings(dir: string, obj: unknown): void {
  fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(obj, null, 2));
}

describe("config-schema.ts — #93 registration of defaults.dispatch.block_unmarked_lanes", () => {
  it("registers the key exactly once, as a boolean defaulting to false", () => {
    const matches = CONFIG_SCHEMA.filter((s) => s.key === KEY);
    expect(matches.length).toBe(1);
    const spec = getFieldSpec(KEY);
    expect(spec?.type).toBe("boolean");
    // Default OFF preserves the pre-#93 record-not-block posture for prompt-only
    // drift; strict blocking stays a conscious opt-in.
    expect(spec?.default).toBe(false);
  });

  it("the canonical DEFAULTS tree is the single source (schema is derived, not duplicated)", () => {
    expect(DEFAULTS.defaults.dispatch.block_unmarked_lanes).toBe(false);
  });

  // codex-review round-2 P1 reversed the original call here. The first cut argued
  // "it only makes the guard STRICTER" — but that reasoning inspects only
  // false→true. true→false REMOVES a PreToolUse denial, the same weakened-
  // enforcement shape `codex_skip_enforcement` is classified for, and it let
  // `reconcile repair` silently resolve an operator-enabled guard back to OFF.
  it("IS classified security-sensitive (turning it off removes a permission denial)", () => {
    expect(isSecuritySensitiveKey(KEY)).toBe(true);
    expect(getFieldSpec(KEY)?.security_sensitive).toBe(true);
  });

  it("declares NO most_restrictive — malformed values HOLD, never fail closed to true", () => {
    // A fail-closed repair would coerce a corrupted value to `true` and start
    // blocking real dispatches (a merely-QUOTED lane brief grades prompt_only
    // too). Absent `most_restrictive`, F4 takes the `security-hold` branch.
    expect(getFieldSpec(KEY)).toBeDefined();
    expect(getFieldSpec(KEY)).not.toHaveProperty("most_restrictive");
  });

  it("has CONFIG_UI_METADATA with a boolean control (the ui surface can render/edit it)", () => {
    const meta = CONFIG_UI_METADATA[KEY];
    expect(meta).toBeDefined();
    expect(meta.control).toBe("boolean");
    expect(typeof meta.group).toBe("string");
    expect(typeof meta.label).toBe("string");
  });
});

describe("reconcile repair — #93 key is HELD, not silently disabled", () => {
  it("a malformed value is security-held and left on disk, not reset to false", () => {
    const dir = mkRepo();
    expect(runConfigCmd(["reconcile", "sync", "--cwd", dir]).status).toBe(0);
    const file = path.join(dir, ".guild", "settings.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    doc.defaults.dispatch.block_unmarked_lanes = "damaged";
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));

    const r = runConfigCmd(["reconcile", "repair", "--cwd", dir]);
    expect(r.status).toBe(0);
    const out = `${r.out}${r.err}`;
    expect(out).toMatch(/block_unmarked_lanes: malformed → security-hold/);
    // The operator's corrupted value SURVIVES: repair never rewrote an
    // opted-in enforcement guard back to its permissive default.
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(after.defaults.dispatch.block_unmarked_lanes).toBe("damaged");
  });

  it("a VALID operator value is untouched by repair (anti-vacuity)", () => {
    const dir = mkRepo();
    expect(runConfigCmd(["reconcile", "sync", "--cwd", dir]).status).toBe(0);
    expect(
      runConfigCmd(["set", KEY, "true", "--scope", "project", "--cwd", dir]).status,
    ).toBe(0);
    expect(runConfigCmd(["reconcile", "repair", "--cwd", dir]).status).toBe(0);
    const after = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"),
    );
    expect(after.defaults.dispatch.block_unmarked_lanes).toBe(true);
  });
});

describe("read-guild-config.ts --validate — #93 key", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  it("accepts a settings.json that sets the key to true", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: { block_unmarked_lanes: true } } });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(out).toMatch(/VALID/);
    expect(status).toBe(0);
  });

  it("rejects a non-boolean value", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: { block_unmarked_lanes: "yes" } } });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/defaults\.dispatch\.block_unmarked_lanes must be a boolean/);
  });

  it("rejects a wrong-SHAPE defaults.dispatch block", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: "oops" } });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/defaults\.dispatch must be an object/);
  });

  it("STILL rejects an unknown defaults.dispatch sub-key (schema stays closed)", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: { bogus_key: true } } });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/unknown defaults\.dispatch key "bogus_key"/);
  });

  it("STILL rejects an unknown top-level key (closed schema not accidentally opened)", () => {
    const dir = repo();
    writeSettings(dir, { totally_bogus_top_level_key: 1 });
    const { status, out } = runReadGuildConfig(["--validate", "--cwd", dir]);
    expect(status).not.toBe(0);
    expect(out).toMatch(/unknown top-level key "totally_bogus_top_level_key"/);
  });

  it("resolve mode reflects the configured value and defaults it to false when unset", () => {
    const on = repo();
    writeSettings(on, { defaults: { dispatch: { block_unmarked_lanes: true } } });
    const r1 = runReadGuildConfig(["--cwd", on]);
    expect(r1.status).toBe(0);
    expect(JSON.parse(r1.out).defaults.dispatch).toEqual({ block_unmarked_lanes: true });

    const off = repo();
    writeSettings(off, {});
    const r2 = runReadGuildConfig(["--cwd", off]);
    expect(r2.status).toBe(0);
    expect(JSON.parse(r2.out).defaults.dispatch).toEqual({ block_unmarked_lanes: false });
  });
});

describe("config-cmd.ts — #93 key on the show/set surfaces", () => {
  const repos: string[] = [];
  afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  // NOTE ON WHICH SURFACE IS ASSERTED HERE: `show --sources` annotates TOP-LEVEL
  // keys, so it renders the whole `defaults` block as one JSON line — a nested key
  // has no line of its own there (the same is true of the PR #87 lifecycle-guard
  // keys, which is why that lane's test asserted on the top-level `host_mode`
  // instead). `config ui sources` is the per-key provenance surface, and it is
  // where a nested key's own inheritance layer is actually reported.

  it("ui sources prints the key with a [project] provenance when set", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: { block_unmarked_lanes: true } } });
    const { status, out } = runConfigCmd(["ui", "sources", "--cwd", dir]);
    expect(status).toBe(0);
    expect(out).toMatch(/defaults\.dispatch\.block_unmarked_lanes = true\s+\[project\]/);
  });

  it("ui sources prints the key with a [builtin] provenance when unset", () => {
    const dir = repo();
    const { status, out } = runConfigCmd(["ui", "sources", "--cwd", dir]);
    expect(status).toBe(0);
    expect(out).toMatch(/defaults\.dispatch\.block_unmarked_lanes = false\s+\[builtin\]/);
  });

  it("show --sources carries the key inside the resolved defaults block at [project]", () => {
    const dir = repo();
    writeSettings(dir, { defaults: { dispatch: { block_unmarked_lanes: true } } });
    const { status, out } = runConfigCmd(["show", "--sources", "--cwd", dir]);
    expect(status).toBe(0);
    const line = out.split("\n").find((l) => l.trimStart().startsWith("defaults = "));
    expect(line).toBeDefined();
    expect(line).toContain("[project]");
    const json = JSON.parse(
      (line as string).slice((line as string).indexOf("{"), (line as string).lastIndexOf("}") + 1),
    );
    expect(json.dispatch).toEqual({ block_unmarked_lanes: true });
  });

  it("config set persists a real BOOLEAN (not the string 'true') the resolver keeps", () => {
    const dir = repo();
    const r = runConfigCmd(["set", KEY, "true", "--scope", "project", "--cwd", dir]);
    expect(r.status).toBe(0);
    const persisted = JSON.parse(
      fs.readFileSync(path.join(dir, ".guild", "settings.json"), "utf8"),
    );
    expect(persisted.defaults.dispatch.block_unmarked_lanes).toBe(true);
    // round-trips through the resolver rather than being dropped as a non-boolean
    const resolved = JSON.parse(runReadGuildConfig(["--cwd", dir]).out);
    expect(resolved.defaults.dispatch.block_unmarked_lanes).toBe(true);
  });

  it("config set rejects an unknown defaults.dispatch sub-key", () => {
    const dir = repo();
    const r = runConfigCmd([
      "set", "defaults.dispatch.bogus_key", "true", "--scope", "project", "--cwd", dir,
    ]);
    expect(r.status).not.toBe(0);
    expect(`${r.out}${r.err}`).toMatch(/unknown defaults\.dispatch key "bogus_key"/);
  });
});

// ── The FOURTH closed-key set ────────────────────────────────────────────────
// `src/modules/config/workflows/config-validation.ts` is a validator distinct
// from the three in config-cmd.ts / config-cli.ts / settings-reader.ts, and it is
// the one `runStartPreflight` calls. Registering the key in the other three but
// not here made every run start with `validation.ok: false` on an otherwise
// pristine default config — the built-in DEFAULTS tree failing its own closed-key
// check. Pinned separately because no other #93 assertion reaches this validator.
describe("config-validation.ts (the runStartPreflight validator) — #93 key", () => {
  it("accepts the defaults block the built-in DEFAULTS tree itself ships", () => {
    expect(validateDefaults(DEFAULTS.defaults as unknown as Record<string, unknown>, false)).toEqual(
      [],
    );
  });

  it("accepts an explicitly configured boolean", () => {
    expect(validateDefaults({ dispatch: { block_unmarked_lanes: true } }, false)).toEqual([]);
  });

  it("rejects a non-boolean value", () => {
    expect(validateDefaults({ dispatch: { block_unmarked_lanes: "true" } }, false).join("\n")).toMatch(
      /block_unmarked_lanes must be a boolean/,
    );
  });

  it("rejects a wrong-shaped defaults.dispatch block", () => {
    expect(validateDefaults({ dispatch: true }, false).join("\n")).toMatch(
      /defaults\.dispatch must be an object/,
    );
  });

  it("STILL rejects an unknown defaults.dispatch sub-key (stays closed)", () => {
    expect(validateDefaults({ dispatch: { bogus_key: true } }, false).join("\n")).toMatch(
      /unknown defaults\.dispatch key "bogus_key"/,
    );
  });
});
