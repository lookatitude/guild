/**
 * scripts/__tests__/safe-object-parity.test.ts
 *
 * Re-arch WAVE 1 (M9 single-source floor) — PARITY GUARD for the
 * prototype-pollution key guard.
 *
 * Unit 4 collapsed THREE identical PROTO_POISON_KEYS definitions (in
 * read-guild-config.ts, lib/settings-resolver.ts, config-cmd.ts) into ONE
 * canonical module: scripts/lib/shared/safe-object.ts.
 *
 *   (A) PARITY:        the canonical set membership matches the frozen reference
 *                      (the exact pre-collapse key set) for the dangerous keys
 *                      AND for a set of benign keys (no over-blocking).
 *   (B) ANTI-VACUITY:  a divergent set (missing "constructor") disagrees on at
 *                      least one key — proving (A) has teeth.
 *   (C) SINGLE-IMPL:   exactly one source file DEFINES the proto-poison key set;
 *                      none of the three consumers re-spells it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PROTO_POISON_KEYS as canonical, isProtoPoisonKey } from "../lib/shared/safe-object";
import * as safeObjectShim from "../lib/shared/safe-object";
import * as safeObjectModule from "../../src/modules/security/workflows/safe-object";

// Frozen reference: the verbatim pre-collapse set.
const REF = new Set(["__proto__", "prototype", "constructor"]);
// Divergent variant for the anti-vacuity control (drops "constructor").
const DIVERGENT = new Set(["__proto__", "prototype"]);

const DANGEROUS = ["__proto__", "prototype", "constructor"];
const BENIGN = ["models", "defaults", "index", "host_profiles", "roles", "constructorX", "proto"];

describe("WAVE-1 Unit 4 — proto-poison keys single-source parity", () => {
  test("compatibility shim: scripts/lib/shared/safe-object re-exports src/modules/security", () => {
    expect(safeObjectShim.PROTO_POISON_KEYS).toBe(safeObjectModule.PROTO_POISON_KEYS);
    expect(safeObjectShim.isProtoPoisonKey).toBe(safeObjectModule.isProtoPoisonKey);
  });

  test("(A) parity: canonical set blocks exactly the reference dangerous keys", () => {
    for (const k of DANGEROUS) {
      expect(canonical.has(k)).toBe(REF.has(k));
      expect(isProtoPoisonKey(k)).toBe(true);
    }
  });

  test("(A) parity: canonical set never over-blocks benign keys (matches reference)", () => {
    for (const k of BENIGN) {
      expect(canonical.has(k)).toBe(REF.has(k)); // both false
      expect(isProtoPoisonKey(k)).toBe(false);
    }
  });

  test("(B) anti-vacuity control: a set missing 'constructor' disagrees", () => {
    let sawDivergence = false;
    for (const k of DANGEROUS) {
      if (canonical.has(k) !== DIVERGENT.has(k)) sawDivergence = true;
    }
    expect(sawDivergence).toBe(true); // 'constructor' differs
  });

  test("(C) single-impl: exactly one source file DEFINES the proto-poison key set", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const roots = [path.join(repoRoot, "scripts"), path.join(repoRoot, "src"), path.join(repoRoot, "mcp-servers")];
    const SKIP = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
    const definers: string[] = [];

    // A DEFINITION = a Set constructed over a literal that lists the dangerous keys.
    // Re-exports / imports of PROTO_POISON_KEYS do not match.
    //
    // `sealSet(...)` is now the construction form: task #22 established that
    // `new Set([...])` yields a runtime-mutable Set no type annotation or Object.freeze
    // can close, so `PROTO_POISON_KEYS.delete("__proto__")` re-opened prototype
    // pollution. This regex accepts either spelling so it tracks DEFINITIONS rather
    // than one particular constructor.
    const DEF_RE = /(?:new Set|sealSet)\s*(?:<[^>]*>)?\s*\(\s*\[[^\]]*["']__proto__["'][^\]]*\]/;

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          const full = path.join(dir, e.name);
          const rel = path.relative(repoRoot, full);
          if (rel.includes(`${path.sep}resources${path.sep}`)) continue;
          const src = fs.readFileSync(full, "utf8");
          if (DEF_RE.test(src)) definers.push(rel);
        }
      }
    }
    for (const r of roots) walk(r);

    expect(definers).toEqual(["src/modules/security/workflows/safe-object.ts"]);
  });
});
