/**
 * E00-T0 · EAT06 / CD14 (TA, source side) — the compiled package must declare
 * the runtime scripts task-cell-controller and task-cell-ack plus the
 * facade-only library chunk task-cell-api, and verify-host-packages must
 * require all three. Expected red: none are declared today.
 * The installed-package behaviour (TC) is in tc/e00-installed-package.tc.test.ts.
 */
import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { PLUGIN, requireExport } from "./support/e00-harness";

const compile = fs.readFileSync(path.join(PLUGIN, "scripts", "compile.ts"), "utf8");
const verifier = fs.readFileSync(path.join(PLUGIN, "src", "domains", "distribution", "verify-host-packages.ts"), "utf8");

describe("EAT06 package surface declarations (expected red)", () => {
  for (const [id, entry] of [
    ["task-cell-controller", "scripts/task-cell-controller.ts"],
    ["task-cell-ack", "scripts/task-cell-ack.ts"],
  ]) {
    it(`compile.ts ships runtime script ${id} from ${entry}`, () => {
      expect(compile).toContain(`{ id: "${id}", entry: "${entry}" }`);
      expect(fs.existsSync(path.join(PLUGIN, entry))).toBe(true);
    });
  }

  // Corrected (root scope l-facade-test-correction-scope.json): the facade-only entry is
  // scripts/task-cell-api.ts; task-cell-controller.ts also exports the source-only factory.
  it("compile.ts ships the task-cell-api library chunk from the facade-only entry scripts/task-cell-api.ts", () => {
    expect(compile).toMatch(/\{ id: "task-cell-api", entry: "scripts\/task-cell-api\.ts" \}/);
    const entry = path.join(PLUGIN, "scripts", "task-cell-api.ts");
    expect(fs.existsSync(entry)).toBe(true);
    // No code names the factory (comments may; the compiled export set is checked in e00-l-compiled-facade-ta).
    const code = fs.readFileSync(entry, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(/\bcreateTaskCellController\b/.test(code)).toBe(false);
  });

  for (const id of ["task-cell-controller", "task-cell-ack", "task-cell-api"]) {
    it(`verify-host-packages requires runtime/scripts/${id}.js`, () => {
      expect(verifier).toContain(`${id}.js`);
    });
  }

  it("the source-only createTaskCellController exists but is not part of the facade chunk", async () => {
    await requireExport("src/domains/dispatch/task-cell-controller.ts", "createTaskCellController");
    const facade = fs.readFileSync(path.join(PLUGIN, "src", "domains", "dispatch", "index.ts"), "utf8");
    expect(/\bcreateTaskCellController\b/.test(facade)).toBe(false);
  });

  for (const name of [
    "startTaskCellController", "readControllerStatus", "recordControllerLoss", "approveOraclePlan",
    "recordAuthorityDecision", "submitObservedHandoff", "writeAckClaim", "isQualifiedDownstreamRelease",
    "findQualifiedRunAcceptances",
  ]) {
    it(`dispatch index re-exports the facade function ${name}`, async () => {
      expect(typeof (await requireExport("src/domains/dispatch/index.ts", name))).toBe("function");
    });
  }
});
