/**
 * run-all.ts — run every re-architecture enforcement rail and summarise.
 *
 *   cd tests && npx tsx rearch/run-all.ts            # run all rails
 *   cd tests && npx tsx rearch/run-all.ts --prove    # anti-vacuity self-test of every rail
 *
 * Exit code: non-zero iff a STRICT rail is RED (advisory rails never block).
 * Strict rails: R-DUP, R-DIST, R-DEP (layering floor), R-HOST, R-SEC.  Advisory rails: R-VAC.
 */
import { execFileSync } from "child_process";
import * as path from "path";
import { report } from "./_common";
import * as rdup from "./r-dup";
import * as rdep from "./r-dep";
import * as rvac from "./r-vac";
import * as rdist from "./r-dist";
import * as rhost from "./r-host";
import * as rsec from "./r-sec";
import * as rperf from "./r-perf";
import * as rtrace from "./r-trace";
import * as rdecl from "./r-decl";

const RAILS = [rdup, rdep, rvac, rdist, rhost, rsec, rperf, rtrace, rdecl];

if (process.argv.includes("--prove")) {
  // each rail's --prove throws on a vacuity failure; run them as child processes so one
  // broken rail does not abort the rest, and a non-zero child exit fails the suite.
  let failed = 0;
  for (const f of ["r-dup", "r-dep", "r-vac", "r-dist", "r-host", "r-sec", "r-perf", "r-trace", "r-decl"]) {
    try {
      execFileSync("npx", ["tsx", path.join(__dirname, `${f}.ts`), "--prove"], {
        stdio: "inherit",
      });
    } catch {
      failed++;
    }
  }
  if (failed) {
    console.error(`\n${failed} rail(s) FAILED anti-vacuity proof — rails are vacuous and must be fixed.`);
    process.exit(1);
  }
  console.log("\nAll rails proved non-vacuous ✓");
  process.exit(0);
}

let code = 0;
const summary: string[] = [];
for (const rail of RAILS) {
  const r = rail.run();
  code = Math.max(code, report(r));
  const state = r.pass ? "GREEN" : r.advisory ? "ADVISORY-VIOLATIONS" : "RED";
  summary.push(`${r.rail.padEnd(8)} ${state}  (${r.violations.length} finding(s))`);
}
console.log("\n──────── RAIL SUMMARY ────────");
for (const s of summary) console.log("  " + s);
console.log(`\nstrict exit code: ${code} (${code === 0 ? "no strict rail red" : "a strict rail is RED"})`);
process.exit(code);
