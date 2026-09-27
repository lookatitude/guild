/**
 * F4: `GUILD_RUN_DIR` is honoured only as a non-empty absolute path, in every
 * hook entry that reads it (capture-telemetry, pre-tool-use, lean-lead-guard,
 * lifecycle-gate, heartbeat-write).
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

import { runDirOverride } from "../lib/run-dir-override";

const HOOK_ENTRIES = [
  "hooks/capture-telemetry.ts",
  "hooks/pre-tool-use.ts",
  "hooks/lib/lean-lead-guard.ts",
  "hooks/lib/lifecycle-gate.ts",
  "hooks/lib/heartbeat-write.ts",
];

describe("F4 GUILD_RUN_DIR override", () => {
  it("rejects an empty or relative override and keeps an absolute one", () => {
    expect(runDirOverride({})).toBeUndefined();
    expect(runDirOverride({ GUILD_RUN_DIR: "" })).toBeUndefined();
    expect(runDirOverride({ GUILD_RUN_DIR: "runs/x" })).toBeUndefined();
    expect(runDirOverride({ GUILD_RUN_DIR: "/abs/run" })).toBe("/abs/run");
  });

  it("no hook entry reads GUILD_RUN_DIR through a bare ??", () => {
    const root = path.resolve(__dirname, "../..");
    for (const rel of HOOK_ENTRIES) {
      const body = fs.readFileSync(path.join(root, rel), "utf8");
      expect({ rel, bare: /GUILD_RUN_DIR"\]\s*\?\?/.test(body) }).toEqual({ rel, bare: false });
    }
  });
});
