/**
 * scripts/__tests__/rearch-parity-settings-resolver.test.ts
 *
 * W3 parity test — settings-resolver.ts split into core/settings-reader.ts + config defaults
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
import * as settingsResolverModule from "../../src/modules/config/workflows/settings-resolver";
import * as settingsReaderShim from "../lib/core/settings-reader";
import * as settingsReaderModule from "../../src/modules/config/workflows/settings-reader";

import {
  DEFAULT_ESCALATION_MARKERS,
  NON_INHERITABLE_KEYS,
} from "../lib/shared/config-defaults"; // shared constants
import * as configDefaultsShim from "../lib/shared/config-defaults";
import * as configDefaultsModule from "../../src/modules/config/workflows/config-defaults";

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
    // This list is a PIN, not a description: it exists so an accidental export (an
    // internal helper, a `__main` leak) is caught. An ADDITION is a deliberate act that
    // must be recorded here WITH ITS REASON — never a list refreshed reflexively to make
    // the pin green again.
    expect(Object.keys(settingsResolverExports).sort()).toEqual([
      // S5 (cap-loc-D04): the resolver's own closed top-level key set, exported so
      // config-schema-resolver-parity.test.ts can assert it equals CONFIG_SCHEMA's
      // top-level keys. That rail exists because the two are a C5-style dual home with
      // NO sync script between them, and they had already drifted — `capability` was
      // registered in the schema, the CLI loader, the UI metadata and the persist matrix
      // but not here, so a project could configure it and the runtime would silently
      // ignore it. The rail cannot exist without this export.
      "RESOLVER_TIER1_KEYS",
      "deepMerge",
      "initiativeIsWorkspaceScoped",
      "isPlainObject",
      "resolveSettings",
      "rigorProfile",
    ]);
  });

  it("scripts/lib/settings-resolver re-exports src/modules/config settings resolver", () => {
    expect(settingsResolverExports.resolveSettings).toBe(settingsResolverModule.resolveSettings);
    expect(settingsResolverExports.deepMerge).toBe(settingsResolverModule.deepMerge);
    expect(settingsResolverExports.rigorProfile).toBe(settingsResolverModule.rigorProfile);
  });

  it("scripts/lib/core/settings-reader re-exports src/modules/config settings reader", () => {
    expect(settingsReaderShim.resolveSettings).toBe(settingsReaderModule.resolveSettings);
    expect(settingsReaderShim.deepMerge).toBe(settingsReaderModule.deepMerge);
    expect(settingsReaderShim.rigorProfile).toBe(settingsReaderModule.rigorProfile);
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

  // ── config defaults compatibility shim ───────────────────────────────────
  it("scripts/lib/shared/config-defaults re-exports src/modules/config", () => {
    expect(configDefaultsShim.DEFAULTS).toBe(configDefaultsModule.DEFAULTS);
    expect(configDefaultsShim.DEFAULT_ESCALATION_MARKERS).toBe(configDefaultsModule.DEFAULT_ESCALATION_MARKERS);
    expect(configDefaultsShim.NON_INHERITABLE_KEYS).toBe(configDefaultsModule.NON_INHERITABLE_KEYS);
  });

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

  // -- M2 single-source DEFAULTS (the codex G-lane finding) --
  // W3's first pass left a full DEFAULTS literal in BOTH core/config-cli.ts and core/settings-reader.ts.
  // The module reorg keeps public shared/core paths as shims but moves real config logic into
  // src/modules/config. This asserts the full DEFAULTS object is DEFINED there and remaining
  // core CLI code still imports through the stable shared entrypoint.
  it("DEFAULTS is single-sourced in src/modules/config; legacy readers do not redeclare it", () => {
    const readScripts = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
    const readRepo = (rel: string) => fs.readFileSync(path.join(__dirname, "../..", rel), "utf8");
    const shared = readScripts("lib/shared/config-defaults.ts");
    const module = readRepo("src/modules/config/workflows/config-defaults.ts");
    const settingsReader = readRepo("src/modules/config/workflows/settings-reader.ts");
    expect(shared).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/\.\.\/src\/modules\/config\/workflows\/config-defaults["']/);
    expect(shared).not.toMatch(/export\s+const\s+DEFAULTS\s*=/);
    expect(module).toMatch(/compositeRecall/); // module owns the real object, not just a few constants
    expect(module).toMatch(/importanceGate/);
    expect(settingsReader).toMatch(/from\s+["']\.\/config-defaults["']/);
    expect(settingsReader).not.toMatch(/(?:const|let)\s+DEFAULTS\s*(?::[^=]+)?=\s*\{[\s\S]*?compositeRecall/);
    for (const core of ["lib/core/config-cli.ts"]) {
      const src = readScripts(core);
      expect(src).toMatch(/from\s+["']\.\.\/shared\/config-defaults["']/); // imports canonical DEFAULTS
      // and does NOT re-declare a full DEFAULTS object literal of its own
      expect(src).not.toMatch(/(?:const|let)\s+DEFAULTS\s*(?::[^=]+)?=\s*\{[\s\S]*?compositeRecall/);
    }
  });
});
