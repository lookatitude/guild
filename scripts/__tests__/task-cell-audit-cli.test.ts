import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(__dirname, "../task-cell-audit.ts");

describe("task-cell-audit closeout CLI", () => {
  it("fails closed when a run has no TaskCell join", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cell-audit-"));
    const result = spawnSync("npx", ["tsx", SCRIPT, "--cwd", cwd, "--run-id", "run-empty"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    const audit = JSON.parse(result.stdout);
    expect(audit.ok).toBe(false);
    expect(audit.require_closed).toBe(true);
    expect(audit.missing).toContain("run run-empty has no task-cell assignments");
  });

  it("rejects an unsafe run id before reading the filesystem", () => {
    const result = spawnSync("npx", ["tsx", SCRIPT, "--run-id", "../escape"], { encoding: "utf8" });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/safe-id/);
  });
});
