import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "./lane-receipt-wait";
import { loadRunState } from "../src/domains/lifecycle/index";

const RUN_ID = "run-20261020-000000-h1-cli";

describe("lane-receipt-wait CLI (#138)", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lane-receipt-cli-"));
    fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID, "handoffs"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("exits 1 with status missing on timeout and records the lane failed", async () => {
    const code = await main([
      "--cwd", root, "--run-id", RUN_ID, "--specialist", "developer", "--task-id", "A",
      "--timeout-ms", "0",
    ]);
    expect(code).toBe(1);
    const state = loadRunState(path.join(root, ".guild", "runs", RUN_ID));
    expect(state?.lanes["A"]?.status).toBe("failed");
  });

  it("exits 2 on a usage error or an unsafe run id", async () => {
    expect(await main(["--cwd", root, "--run-id", RUN_ID])).toBe(2);
    expect(
      await main(["--cwd", root, "--run-id", "../x", "--specialist", "developer", "--task-id", "A"]),
    ).toBe(2);
  });
});
