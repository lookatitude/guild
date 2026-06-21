import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { createHostAdapter } from "../lib/host-adapter-factory";
import { createClaudeCodeCliAdapter } from "../lib/host-adapters/claude-code-cli";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry-schema";
import { buildInventory, PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import { writeClaudeTree } from "../build-host-packages";

describe("Claude HostAdapter concrete parity", () => {
  it("factory returns the concrete Claude adapter for canonical id and legacy alias", () => {
    expect(createHostAdapter("claude-code-cli").capabilities().provenance).toBe("verified");
    expect(createHostAdapter("claude").hostId).toBe("claude-code-cli");
    expect(createHostAdapter("claude").bootstrap().status).toBe("ok");
  });

  it("bootstrap and preflight expose the using-guild SessionStart hook path", () => {
    const adapter = createHostAdapter("claude-code-cli");
    const bootstrap = adapter.bootstrap({ cwd: "/repo", runId: "run-1" });
    expect(bootstrap.status).toBe("ok");
    expect(bootstrap.value).toMatchObject({
      context_injection: "hookSpecificOutput.additionalContext",
      using_guild_source: "skills/meta/using-guild/SKILL.src.md",
      hook_event: "SessionStart",
      registry_value: "hookSpecificOutput.additionalContext",
    });

    const preflight = adapter.preflight({ cwd: "/repo", runId: "run-1", event: "SessionStart" });
    expect(preflight.status).toBe("ok");
    expect(JSON.stringify(preflight.value)).toContain("using-guild-bootstrap.js");
    expect(JSON.stringify(preflight.value)).toContain("hooks/bootstrap.sh");
  });

  it("renders Claude package, command, permission, memory, and dispatch surfaces as concrete", () => {
    const adapter = createHostAdapter("claude-code-cli");

    const pkg = adapter.renderPackage({ packageRoot: PLUGIN_ROOT });
    expect(pkg.status).toBe("ok");
    expect(pkg.value).toMatchObject({
      manifest_path: ".claude-plugin/plugin.json",
      agents_md_path: "AGENTS.md",
      claude_md_path: "CLAUDE.md",
      claude_md_import: "@AGENTS.md",
    });

    const commands = adapter.renderCommandSurface({ commandIds: ["guild", "plan"] });
    expect(commands.status).toBe("ok");
    expect(commands.value).toMatchObject({ command_files: "markdown", slash_commands: true });

    const permission = adapter.renderPermissionDecision({ decision: { host_mode: "ask" } });
    expect(permission.status).toBe("ok");
    expect(permission.value).toMatchObject({ prompt_layer: "PreToolUse", native_ask: true });

    const memory = adapter.memory({ mode: "status", payload: { activeRoot: "/workspace/project" } });
    expect(memory.status).toBe("ok");
    expect(memory.value).toMatchObject({
      active_guild_root: "/workspace/project/.guild",
      primary: { transport: "mcp-stdio", status: "registry_verified" },
    });
    const memoryWithGuildRoot = adapter.memory({ mode: "status", payload: { activeRoot: "/workspace/project/.guild/" } });
    expect(memoryWithGuildRoot.value).toMatchObject({
      active_guild_root: "/workspace/project/.guild",
      primary: { verified_by: "HOST_REGISTRY_ROWS[claude-code-cli].capabilities.mcp.stdio" },
    });
    const memoryWithBareGuildRoot = adapter.memory({ mode: "status", payload: { activeRoot: ".guild" } });
    expect(memoryWithBareGuildRoot.value).toMatchObject({
      active_guild_root: ".guild",
      primary: { status: "registry_verified", registry_value: true },
    });
    expect(JSON.stringify(memory.value)).toContain("filesystem-bm25");
    expect(JSON.stringify(memory.value)).toContain("degraded");

    const dispatch = adapter.dispatch({
      taskRun: {
        prompt: "Implement the lane",
        runId: "run-1",
        taskId: "T1",
        specialist: "backend",
      },
    });
    expect(dispatch.status).toBe("ok");
    expect(JSON.stringify(dispatch.value)).toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    expect(JSON.stringify(dispatch.value)).toContain("GUILD_TASK_ID=T1");
    expect(JSON.stringify(dispatch.value)).toContain("GUILD_SPECIALIST=backend");

    const wrapperDispatch = adapter.dispatch({
      taskRun: {
        prompt: "Implement the lane",
        runId: "run-1",
        command: "claude",
        args: ["--permission-mode", "default", "-p", "Implement the lane"],
        env: { GUILD_RUN_ID: "run-1" },
      },
    });
    expect(wrapperDispatch.value).toMatchObject({
      dispatch_kind: "wrapper_launch",
      command: "claude",
      args: ["--permission-mode", "default", "-p", "Implement the lane"],
      env: { GUILD_RUN_ID: "run-1" },
    });
    expect(JSON.stringify(wrapperDispatch.value)).toContain("alternate_pane_command");

    const modelParams = adapter.resolveModelParams({
      tier: "powerful",
      params: { model: "opus-4.8", effort: "low" },
    });
    expect(modelParams.status).toBe("ok");
    expect(modelParams.value).toMatchObject({
      modelParams: { model: "opus-4.8", effort: "low" },
      argv: ["--model", "opus-4.8", "--effort", "low"],
      unsupported_model_params: [],
    });

    const unsupportedModelParams = adapter.resolveModelParams({
      tier: "powerful",
      params: { model: "opus-4.8", effort: "xhigh", reasoning: "xhigh" },
    });
    expect(unsupportedModelParams.status).toBe("degraded");
    expect(unsupportedModelParams.value).toMatchObject({
      unsupported_model_params: ["reasoning"],
    });
  });

  it("degrades bootstrap and memory when registry values are disabled", () => {
    const entry = JSON.parse(JSON.stringify(HOST_REGISTRY_ROWS["claude-code-cli"])) as typeof HOST_REGISTRY_ROWS["claude-code-cli"];
    entry.capabilities.bootstrap.context_injection = "";
    entry.capabilities.hooks.session_start = false;
    entry.capabilities.mcp.stdio = false;
    const adapter = createClaudeCodeCliAdapter(entry);

    const bootstrap = adapter.bootstrap({ cwd: "/repo", runId: "run-1" });
    expect(bootstrap.status).toBe("degraded");
    expect(bootstrap.value).toMatchObject({ registry_value: "" });

    const preflight = adapter.preflight({ cwd: "/repo", runId: "run-1", event: "SessionStart" });
    expect(preflight.status).toBe("degraded");
    expect(preflight.value).toMatchObject({
      session_start_registry_value: false,
      session_start_commands: [],
    });
    expect(JSON.stringify(preflight.value)).not.toContain("using-guild-bootstrap.js");

    const memory = adapter.memory({ mode: "status", payload: { activeRoot: "/workspace/project" } });
    expect(memory.status).toBe("degraded");
    expect(memory.value).toMatchObject({
      primary: { status: "unavailable", registry_value: false },
    });
  });

  it("production callers route concrete adapter creation through the factory", () => {
    const symbols = [
      "createHostAdapter",
      "createDefaultHostAdapter",
      "createDefaultHostAdapters",
      "createAllHostAdapters",
    ];
    const res = spawnSync("rg", ["-n", symbols.join("|"), "scripts", "-g*.ts"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('scripts/guild-run.ts:43:import { createHostAdapter } from "./lib/host-adapter-factory";');
    const offenders = res.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("scripts/guild-run.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/support-matrix.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/host-adapter-factory.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/host-adapter-contract.ts:"))
      .filter((line) => !line.includes("/__tests__/"));
    expect(offenders).toEqual([]);
  });

  it("generated Claude package includes canonical AGENTS.md and wrapper CLAUDE.md", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-claude-package-"));
    try {
      const dest = writeClaudeTree(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT), tmpDist, UNSTAMPED_GENERATED_AT);
      const agents = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
      const claude = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
      expect(agents).toContain("host-neutral instruction file");
      expect(claude.trim().endsWith("@AGENTS.md")).toBe(true);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });
});

describe("install.sh Claude host dry-run", () => {
  it("accepts --host claude-code-cli and prints Claude install commands plus wrapper shape", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "claude-code-cli"], {
      encoding: "utf8",
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("would run: claude plugin marketplace add");
    expect(res.stdout).toContain("would run: claude plugin install guild@guild");
    expect(res.stdout).toContain("CLAUDE.md imports AGENTS.md");
    expect(res.stdout).toContain("@AGENTS.md");
  });
});
