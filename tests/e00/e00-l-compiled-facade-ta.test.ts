/**
 * E00-T0 · independent E00-L check M5: the COMPILED facade chunk
 * runtime/scripts/task-cell-api.js exports exactly the nine CD14 facade functions
 * and never the source-only factory (POST-FIX authored after L's source freeze;
 * not red-before). Internal bundled function text is not a violation; only the
 * module's exported surface counts. Loaded in a fresh `node` child (the user-path
 * runtime, KTD6/KTD10). Compiled-output freshness against source is checked by
 * `scripts/compile.ts --check` in the run evidence, not here.
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { PLUGIN } from "./support/e00-harness";

const CHUNK = path.join(PLUGIN, "runtime", "scripts", "task-cell-api.js");
const FACADE = [
  "approveOraclePlan", "findQualifiedRunAcceptances", "isQualifiedDownstreamRelease", "readControllerStatus", "recordAuthorityDecision",
  "recordControllerLoss", "startTaskCellController", "submitObservedHandoff", "writeAckClaim",
].sort();

function exportsOf(file: string): { functions: string[]; all: string[] } {
  const r = spawnSync("node", ["-e", `const m=require(${JSON.stringify(file)});const all=Object.keys(m).sort();process.stdout.write(JSON.stringify({all,functions:all.filter(k=>typeof m[k]==="function")}))`], { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) throw new Error(`node could not load ${file}: ${(r.stderr ?? "").slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

describe("M5 · compiled task-cell-api facade surface", () => {
  it("the compiled chunk exists and node loads it", () => {
    expect(fs.existsSync(CHUNK)).toBe(true);
    expect(exportsOf(CHUNK).all.length).toBeGreaterThan(0);
  });

  it("exports exactly the nine CD14 facade functions", () => {
    expect(exportsOf(CHUNK).functions).toEqual(FACADE);
  });

  it("exports nothing else, in particular no source-only factory, principal override or controller class", () => {
    const { all } = exportsOf(CHUNK);
    expect(all).toEqual(FACADE);
    for (const banned of ["createTaskCellController", "TaskCellController", "selectPrincipalProvider", "principal"]) expect(all).not.toContain(banned);
  });
});
