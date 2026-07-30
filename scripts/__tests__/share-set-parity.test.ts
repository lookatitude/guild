/**
 * scripts/__tests__/share-set-parity.test.ts
 *
 * Re-arch WAVE 1 (M9 single-source floor) — PARITY GUARD for the scrub share-set.
 *
 * Unit 3 collapsed the share-set membership that scrub.ts owned and audit.ts
 * mirrored ("keep in sync" SCRUB_SHARED_NAMES + inScrubShareSet) into ONE
 * canonical module: scripts/lib/shared/share-set.ts.
 *
 *   (A) PARITY:        canonical inShareSet matches the frozen reference (the
 *                      exact pre-collapse membership rule) across a sample of
 *                      run-relative paths × hasFlag.
 *   (B) ANTI-VACUITY:  a divergent variant (payloads shared regardless of flag)
 *                      disagrees on at least one sample — proving (A) has teeth.
 *   (C) SINGLE-IMPL:   exactly one source file DEFINES inShareSet, and neither
 *                      scrub.ts nor audit.ts redefines the share-set names set.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { inShareSet as canonicalInShareSet } from "../lib/shared/share-set";
import * as shareSetShim from "../lib/shared/share-set";
import * as shareSetModule from "../../src/modules/security/workflows/share-set";

const sep = path.sep;

// ── Frozen reference: the verbatim pre-collapse membership rule. ──────────────
// `payloadsAlwaysShared` exists ONLY for the anti-vacuity control (default false
// = shipped behaviour: payloads gated behind hasFlag).
const REF_SHARED_NAMES = new Set([
  "verify.md", "review.md", "provenance.json", "summary.md", "run.yaml", "run-state.json",
]);
function refInShareSet(rel: string, hasFlag: boolean, payloadsAlwaysShared = false): boolean {
  if (REF_SHARED_NAMES.has(path.basename(rel))) return true;
  if (rel.startsWith("handoffs" + sep) && rel.endsWith(".md")) return true;
  const isPayload = path.basename(rel) === "events.ndjson"
    || rel.startsWith("logs" + sep + "payloads" + sep);
  if (isPayload) return payloadsAlwaysShared ? true : hasFlag;
  return false;
}

// Representative run-relative paths (built with path.sep for cross-platform).
const PATHS = [
  "verify.md",
  "review.md",
  "provenance.json",
  "summary.md",
  "run.yaml",
  "run-state.json",
  ["handoffs", "backend-T1.md"].join(sep),
  ["handoffs", "nested", "x.md"].join(sep),
  ["handoffs", "notes.txt"].join(sep),     // handoffs but not .md → not shared
  "events.ndjson",
  ["logs", "payloads", "p1.json"].join(sep),
  ["logs", "v1.4-events.jsonl"].join(sep), // logs but not payloads → not shared
  "random.txt",
  ["context", "bundle.md"].join(sep),
];

describe("WAVE-1 Unit 3 — scrub share-set single-source parity", () => {
  test("compatibility shim: scripts/lib/shared/share-set re-exports src/modules/security", () => {
    expect(shareSetShim.SHARED_SCRUBBED_NAMES).toBe(shareSetModule.SHARED_SCRUBBED_NAMES);
    expect(shareSetShim.inShareSet).toBe(shareSetModule.inShareSet);
    expect(shareSetShim.isPayloadFile).toBe(shareSetModule.isPayloadFile);
  });

  test("(A) parity: canonical inShareSet matches the reference for both flag states", () => {
    for (const rel of PATHS) {
      for (const hasFlag of [false, true]) {
        expect(canonicalInShareSet(rel, hasFlag)).toBe(refInShareSet(rel, hasFlag));
      }
    }
  });

  test("(B) anti-vacuity control: a payloads-always-shared variant disagrees", () => {
    let sawDivergence = false;
    for (const rel of PATHS) {
      // The divergence shows up for payload paths when hasFlag === false.
      if (canonicalInShareSet(rel, false) !== refInShareSet(rel, false, /* payloadsAlwaysShared */ true)) {
        sawDivergence = true;
      }
    }
    expect(sawDivergence).toBe(true);
  });

  test("(C) single-impl: exactly one source file DEFINES inShareSet; no dup name set", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const roots = [path.join(repoRoot, "scripts"), path.join(repoRoot, "src"), path.join(repoRoot, "mcp-servers")];
    const SKIP = new Set(["node_modules", "dist", ".git", "build", "coverage"]);
    const inShareSetDefiners: string[] = [];
    const mirrorOffenders: string[] = [];

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
          const rel = path.relative(repoRoot, full);
          if (rel.includes(`${path.sep}resources${path.sep}`)) continue;
          if (/function\s+inShareSet\s*\(/.test(src)) inShareSetDefiners.push(rel);
          // The deleted dup: a re-spelled SHARED/SCRUB share-names Set or inScrubShareSet.
          if (/inScrubShareSet\s*\(/.test(src) || /SCRUB_SHARED_NAMES\s*=/.test(src)) {
            mirrorOffenders.push(rel);
          }
        }
      }
    }
    for (const r of roots) walk(r);

    expect(inShareSetDefiners).toEqual(["src/modules/security/workflows/share-set.ts"]);
    expect(mirrorOffenders).toEqual([]);
  });
});
