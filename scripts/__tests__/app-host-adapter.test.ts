import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { createHostAdapter } from "../lib/host-adapter-factory";
import { APP_HOSTS, appHostReviewPacket } from "../lib/host-adapters/app-host";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry-schema";
import { PLUGIN_ROOT } from "../build-inventory";
import { REVIEW_PROGRESS_STATES, validateReviewProgressEvent } from "../lib/review-progress";

describe("R10 app-host concrete adapters", () => {
  it("factory returns explicit adapters for all app/connector host ids", () => {
    for (const hostId of APP_HOSTS) {
      const adapter = createHostAdapter(hostId);
      expect(adapter.hostId).toBe(hostId);
      expect(adapter.capabilities()).toMatchObject({
        host_id: hostId,
        surface_kind: "app",
        installability: "none",
        dispatch_selectable: false,
      });
    }
  });

  it("app capability rows remain non-installable and non-dispatch-selectable", () => {
    for (const hostId of APP_HOSTS) {
      const row = HOST_REGISTRY_ROWS[hostId];
      expect(row.installability).toBe("none");
      expect(row.dispatch_selectable).toBe(false);
      expect(row.surface_kind).toBe("app");
    }
  });

  it("renderPackage refuses app/connector targets as CLI packages with connector guidance", () => {
    for (const hostId of APP_HOSTS) {
      const result = createHostAdapter(hostId).renderPackage({ packageRoot: PLUGIN_ROOT });
      expect(result.status).toBe("unavailable");
      expect(result.value).toMatchObject({
        support_state: "unavailable",
        installability: "none",
      });
      expect(JSON.stringify(result.value)).toContain("guidance");
    }
  });

  it("app adapters expose explicit support states for bootstrap/preflight/dispatch/command/permission/memory/model", () => {
    for (const hostId of APP_HOSTS) {
      const adapter = createHostAdapter(hostId);
      expect(adapter.bootstrap({ cwd: PLUGIN_ROOT, runId: "run-r10" }).value).toHaveProperty("support_state");
      expect(adapter.preflight({ cwd: PLUGIN_ROOT, runId: "run-r10" })).toMatchObject({
        status: "degraded",
        value: { native_hooks: false, no_local_hook: true, connector_auth: "manual_instruction", egress_gate: "manual_instruction" },
      });
      expect(adapter.dispatch({ taskRun: { prompt: "Do work" } }).value).toHaveProperty("support_state");
      expect(adapter.renderCommandSurface({ commandIds: ["guild"] }).value).toHaveProperty("support_state");
      expect(adapter.renderCommandSurface({ commandIds: ["guild"] }).value).toHaveProperty("desktop_command_guidance");
      expect(adapter.renderPermissionDecision({ decision: { host_mode: "ask" } })).toMatchObject({
        status: "degraded",
        value: { support_state: "manual_instruction" },
      });
      expect(adapter.resolveModelParams({ tier: "powerful", params: { model: "frontier", effort: "low", verbosity: "high" } })).toMatchObject({
        status: "degraded",
        value: { support_state: "manual_instruction", unsupported_model_params: ["verbosity"] },
      });
      const memory = adapter.memory({ mode: "query", payload: { cwd: PLUGIN_ROOT, query: "guild memory" } });
      expect(["degraded", "unavailable"]).toContain(memory.status);
      expect(memory.value).toHaveProperty("support_state");
    }
  });

  it("Codex App command surface names the local plugin bridge, slash probe, and explicit fallback", () => {
    const commandSurface = createHostAdapter("codex-app").renderCommandSurface({ commandIds: ["guild"] });
    expect(commandSurface).toMatchObject({
      status: "degraded",
      value: {
        support_state: "manual_instruction",
        desktop_command_guidance: {
          invocation: "local_plugin_bridge",
          primary: "/guild:status",
          codex_app_local_plugin_link:
            "codex://plugins/guild?marketplacePath=<absolute-path-to-dist/codex-marketplace/.agents/plugins/marketplace.json>",
          codex_prompt_bridge: {
            hook_event: "UserPromptSubmit",
            accepted_forms: ["/guild", "/guild:<verb>", "/guild <verb>"],
            unknown_verb_behavior: "block_with_known_command_list",
          },
        },
      },
    });
    expect(JSON.stringify(commandSurface.value)).toContain("@");
    expect(JSON.stringify(commandSurface.value)).toContain("rejects unknown slash text before hooks run");
  });

  it("Claude desktop command surface names the native /guild expectation and CLI/manual fallback", () => {
    const commandSurface = createHostAdapter("claude-code-app").renderCommandSurface({ commandIds: ["guild"] });
    expect(commandSurface).toMatchObject({
      status: "degraded",
      value: {
        support_state: "manual_instruction",
        desktop_command_guidance: {
          invocation: "native_slash",
          primary: '/guild:guild "your task"',
        },
      },
    });
    expect(JSON.stringify(commandSurface.value)).toContain("Claude Code CLI Guild plugin install");
    expect(JSON.stringify(commandSurface.value)).toContain("confirm /guild:guild appears and dispatches");
  });

  it("local app memory fails visibly when no memory transport is advertised", () => {
    for (const hostId of ["claude-code-app", "codex-app"] as const) {
      const memory = createHostAdapter(hostId).memory({
        mode: "query",
        payload: {
          cwd: PLUGIN_ROOT,
          query: "guild memory",
          capabilities: { filesystem: false, mcp: false, httpMcp: false, bridgePackage: false },
        },
      });
      expect(memory).toMatchObject({
        status: "unavailable",
        value: {
          support_state: "unavailable",
          required_bridge: "guild-memory MCP, bridge package, or local filesystem companion",
        },
      });
    }
  });

  it("Codex app can emit a Claude CLI review packet with canonical progress scenarios", () => {
    const packet = appHostReviewPacket("run-r10");
    expect(packet).toMatchObject({
      schema_version: "guild.app_review_packet.v1",
      origin_host: "codex-app",
      reviewer_host: "claude-code-cli",
      support_state: "manual_instruction",
      pairing: {
        status: "manual_instruction",
        independence: "strong",
      },
    });
    expect(packet.review_command).toContain("claude --print");
    const stateUnion = new Set(Object.values(packet.progress_scenarios).flat().map((e) => e.state));
    expect([...stateUnion].sort()).toEqual([...REVIEW_PROGRESS_STATES].sort());
    for (const events of Object.values(packet.progress_scenarios)) {
      for (const event of events) expect(validateReviewProgressEvent(event).valid).toBe(true);
    }
  });
});

describe("R10 install.sh app/connector refusal", () => {
  it.each([...APP_HOSTS])("refuses %s as a CLI package target", (hostId) => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", hostId], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(4);
    expect(res.stderr).toContain("not a CLI package install target");
    expect(res.stderr).toContain("connector/app bootstrap contract");
    expect(res.stderr).toContain("--host claude-code-cli");
    expect(res.stdout).not.toContain("would run:");
  });
});
