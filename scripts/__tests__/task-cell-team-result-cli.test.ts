import * as path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.join(__dirname, "../task-cell-team-result.ts");

describe("task-cell-team-result CLI", () => {
  it("fails closed without the required run and station coordinates", () => {
    const result = spawnSync(process.execPath, ["-r", "tsx/cjs", CLI], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--run-id <safe-id> and --station <station> are required");
  });

  it("rejects an unknown station before touching the run tree", () => {
    const result = spawnSync(process.execPath, [
      "-r", "tsx/cjs", CLI,
      "--run-id", "run-x",
      "--station", "deploy",
    ], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown station: deploy");
  });
});
