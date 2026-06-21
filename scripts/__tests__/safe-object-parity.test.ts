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

// Frozen reference: the verbatim pre-collapse set.
const REF = new Set(["__proto__", "prototype", "constructor"]);
// Divergent variant for the anti-vacuity control (drops "constructor").
const DIVERGENT = new Set(["__proto__", "prototype"]);

const DANGEROUS = ["__proto__", "prototype", "constructor"];
const BENIGN = ["models", "defaults", "index", "host_profiles", "roles", "constructorX", "proto"];

describe("WAVE-1 Unit 4 — proto-poison keys single-source parity", () => {
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
    const roots = [path.join(repoRoot, "scripts"), path.join(repoRoot, "mcp-servers")];
    const SKIP = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
    const definers: string[] = [];

    // A DEFINITION = a `new Set([... "__proto__" ... ])` literal that lists the
    // dangerous keys. Re-exports / imports of PROTO_POISON_KEYS do not match.
    const DEF_RE = /new Set\s*\(\s*\[[^\]]*["']__proto__["'][^\]]*\]/;

    function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) continue;
          walk(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
          const full = path.join(dir, e.name);
          const src = fs.readFileSync(full, "utf8");
          if (DEF_RE.test(src)) definers.push(path.relative(repoRoot, full));
        }
      }
    }
    for (const r of roots) walk(r);

    expect(definers).toEqual(["scripts/lib/shared/safe-object.ts"]);
  });
});
