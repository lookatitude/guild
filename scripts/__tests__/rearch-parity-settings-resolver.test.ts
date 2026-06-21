/**
 * scripts/__tests__/rearch-parity-settings-resolver.test.ts
 *
 * W3 parity test — settings-resolver.ts split into core/settings-reader.ts + shared/config-defaults.ts
 *
 * Imports via ORIGINAL paths to verify shims resolve correctly.
 * Anti-vacuity control: asserts that rigor profiles produce DIFFERENT outputs.
 *
 * // @control: anti-vacuity-control (see bottom of file)
 */

import {
  resolveSettings,
  deepMerge,
  isPlainObject,
  rigorProfile,
  initiativeIsWorkspaceScoped,
  type ResolvedConfig,
  type ResolveResult,
} from "../lib/settings-resolver"; // ORIGINAL path — the shim
import * as settingsResolverExports from "../lib/settings-resolver";

import {
  DEFAULT_ESCALATION_MARKERS,
  NON_INHERITABLE_KEYS,
} from "../lib/shared/config-defaults"; // shared constants

import * as os from "os";
import * as path from "path";
import * as fs from "fs";

function makeTmpGuild(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-parity-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  return dir;
}

describe("settings-resolver shim — parity after W3 split", () => {
  // ── shim exports expected symbols ─────────────────────────────────────────
  it("exports resolveSettings()", () => expect(typeof resolveSettings).toBe("function"));
  it("exports deepMerge()", () => expect(typeof deepMerge).toBe("function"));
  it("exports isPlainObject()", () => expect(typeof isPlainObject).toBe("function"));
  it("exports rigorProfile()", () => expect(typeof rigorProfile).toBe("function"));
  it("exports initiativeIsWorkspaceScoped()", () => expect(typeof initiativeIsWorkspaceScoped).toBe("function"));
  it("exports the exact original runtime shim surface", () => {
    expect(Object.keys(settingsResolverExports).sort()).toEqual([
      "deepMerge",
      "initiativeIsWorkspaceScoped",
      "isPlainObject",
      "resolveSettings",
      "rigorProfile",
    ]);
  });

  // ── resolveSettings() — basic resolution ──────────────────────────────────
  it("resolveSettings() returns a ResolveResult with config + sources", () => {
    const cwd = makeTmpGuild();
    try {
      const result = resolveSettings({ cwd });
      expect(result).toHaveProperty("config");
      expect(result).toHaveProperty("sources");
      expect(result.config.rigor).toBe("standard");
    } finally {
      fs.rmSync(cwd, { recursive: true });
    }
  });

  // ── deepMerge() ───────────────────────────────────────────────────────────
  it("deepMerge() merges nested objects", () => {
    const base = { a: 1, b: { c: 2 } };
    const override = { b: { d: 3 } };
    const result = deepMerge(base, override as any);
    expect(result).toMatchObject({ a: 1, b: { c: 2, d: 3 } });
  });

  it("deepMerge() blocks prototype pollution", () => {
    const base = {} as any;
    const malicious = JSON.parse('{"__proto__":{"polluted":true}}') as any;
    deepMerge(base, malicious);
    expect(({} as any).polluted).toBeUndefined();
  });

  // ── isPlainObject() ───────────────────────────────────────────────────────
  it("isPlainObject() returns true for plain objects", () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
  });
  it("isPlainObject() returns false for null", () => {
    expect(isPlainObject(null)).toBe(false);
  });
  it("isPlainObject() returns false for arrays", () => {
    expect(isPlainObject([])).toBe(false);
  });

  // ── rigorProfile() ────────────────────────────────────────────────────────
  it("rigorProfile('standard') returns standard settings", () => {
    const p = rigorProfile("standard");
    expect(p).toHaveProperty("loops");
    expect(p).toHaveProperty("review");
  });
  it("rigorProfile('deep') returns 'all' loops (more than standard 'spec,plan')", () => {
    const deep = rigorProfile("deep");
    expect(deep.loops).toBe("all");
  });

  // ── shared/config-defaults ────────────────────────────────────────────────
  it("DEFAULT_ESCALATION_MARKERS is a non-empty array", () => {
    expect(Array.isArray(DEFAULT_ESCALATION_MARKERS)).toBe(true);
    expect(DEFAULT_ESCALATION_MARKERS.length).toBeGreaterThan(0);
  });

  it("NON_INHERITABLE_KEYS includes initiative_default and workspace", () => {
    expect(NON_INHERITABLE_KEYS.has("initiative_default")).toBe(true);
    expect(NON_INHERITABLE_KEYS.has("workspace")).toBe(true);
  });

  // ── Anti-vacuity control ───────────────────────────────────────────────────
  // @control: anti-vacuity-control
  // rigorProfile('standard') and rigorProfile('deep') produce DIFFERENT outputs.
  // If resolveSettings/rigorProfile were no-ops, both would be identical.
  it("ANTI-VACUITY CONTROL: rigorProfile('standard') !== rigorProfile('deep')", () => {
    const standard = rigorProfile("standard");
    const deep = rigorProfile("deep");
    // Deep rigor has 'all' loops; standard has 'spec,plan' — they must differ
    expect(JSON.stringify(standard)).not.toBe(JSON.stringify(deep));
    expect(deep.loops).toBe("all");
    expect(standard.loops).toBe("spec,plan");
  });

  // — M2 single-source DEFAULTS (the codex G-lane finding) —
  // W3's first pass left a full DEFAULTS literal in BOTH core/config-cli.ts and core/settings-reader.ts
  // (only small constants reached shared/). codex consolidated it; this asserts the full DEFAULTS object
  // is DEFINED in exactly shared/config-defaults.ts and the two core readers IMPORT it, so the M2
  // dual-source can't silently return. (R-DUP enforces this too; this is the localized control.)
  it("DEFAULTS is single-sourced in shared/config-defaults.ts; core readers import it", () => {
    const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const shared = read("lib/shared/config-defaults.ts");
    expect(shared).toMatch(/compositeRecall/); // shared owns the real object, not just a few constants
    expect(shared).toMatch(/importanceGate/);
    for (const core of ["lib/core/config-cli.ts", "lib/core/settings-reader.ts"]) {
      const src = read(core);
      expect(src).toMatch(/from\s+["']\.\.\/shared\/config-defaults["']/); // imports canonical DEFAULTS
      // and does NOT re-declare a full DEFAULTS object literal of its own
      expect(src).not.toMatch(/(?:const|let)\s+DEFAULTS\s*(?::[^=]+)?=\s*\{[\s\S]*?compositeRecall/);
    }
  });
});
