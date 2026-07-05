import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PLUGIN_ROOT } from "../build-inventory";

const BRIDGE_SOURCE = path.join(PLUGIN_ROOT, "scripts", "codex-guild-prompt-bridge.ts");

function runBridge(prompt: string, bridge: string) {
  return spawnSync(process.execPath, [bridge], {
    cwd: PLUGIN_ROOT,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
    encoding: "utf8",
    env: { ...process.env, GUILD_PLUGIN_ROOT: PLUGIN_ROOT },
  });
}

describe("Codex Guild prompt bridge", () => {
  let tmpDir = "";
  let bridge = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-bridge-"));
    bridge = path.join(tmpDir, "codex-guild-prompt-bridge.js");
    fs.copyFileSync(BRIDGE_SOURCE, bridge);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits no hook output for ordinary prompts", () => {
    const res = runBridge("please inspect the repo", bridge);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toBe("");
  });

  it("injects selected command context for /guild:<verb>", () => {
    const res = runBridge("/guild:status --json", bridge);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(out.hookSpecificOutput.additionalContext).toContain("# Guild Codex App Command Bridge");
    expect(out.hookSpecificOutput.additionalContext).toContain("Requested command: /guild:status --json");
    expect(out.hookSpecificOutput.additionalContext).toContain("Command id: status");
    expect(out.hookSpecificOutput.additionalContext).toContain("# /guild:status");
  });

  it("maps bare /guild to the root Guild command", () => {
    const res = runBridge("/guild", bridge);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.hookSpecificOutput.additionalContext).toContain("Requested command: /guild:guild");
    expect(out.hookSpecificOutput.additionalContext).toContain("Command id: guild");
  });

  it("blocks unknown Guild commands with the known command list", () => {
    const res = runBridge("/guild:not-real", bridge);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout);
    expect(out.decision).toBe("block");
    expect(out.reason).toContain('Unknown Guild command "/guild:not-real"');
    expect(out.reason).toContain("status");
  });
});
