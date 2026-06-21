import {
  HOST_ADAPTER_OPERATIONS,
  createAllHostAdapters,
  createHostAdapter,
} from "../lib/host-adapter-contract";
import { HOST_IDS } from "../lib/host-registry-schema";

describe("HostAdapter contract — canonical host coverage", () => {
  it("creates an adapter profile for every canonical host id", () => {
    const adapters = createAllHostAdapters();
    expect(Object.keys(adapters).sort()).toEqual([...HOST_IDS].sort());

    for (const hostId of HOST_IDS) {
      const adapter = adapters[hostId];
      const profile = adapter.capabilities();
      expect(profile.schema_version).toBe("guild.host_adapter_capabilities.v1");
      expect(profile.known).toBe(true);
      expect(profile.host_id).toBe(hostId);
      expect(Object.keys(profile.runtime_surfaces).sort()).toEqual([
        "browser",
        "interaction",
        "semantic_tool",
        "session",
      ]);
    }
  });

  it("exposes the required operation surface", () => {
    expect([...HOST_ADAPTER_OPERATIONS].sort()).toEqual([
      "bootstrap",
      "capabilities",
      "collect",
      "dispatch",
      "memory",
      "preflight",
      "renderCommandSurface",
      "renderPackage",
      "renderPermissionDecision",
      "resolveModelParams",
    ].sort());
  });
});

describe("HostAdapter contract — aliases and unknown hosts", () => {
  it("normalizes legacy aliases before resolving adapter capabilities", () => {
    expect(createHostAdapter("claude").hostId).toBe("claude-code-cli");
    expect(createHostAdapter("codex-plugin").hostId).toBe("codex-cli");
    expect(createHostAdapter(".agents").hostId).toBe("agents-file");
    expect(createHostAdapter("antigravity-2").hostId).toBe("antigravity-cli");
  });

  it("unknown hosts fail closed into explicit unavailable/degraded results", () => {
    const adapter = createHostAdapter("unknown-host");
    const profile = adapter.capabilities();
    expect(profile.known).toBe(false);
    expect(profile.host_id).toBeNull();
    expect(profile.unavailable_operations).toEqual(
      expect.arrayContaining(["bootstrap", "dispatch", "renderPackage"])
    );

    const dispatch = adapter.dispatch({ taskRun: { id: "x" } });
    expect(dispatch.status).toBe("unavailable");
    expect(dispatch.receipt.schema_version).toBe("guild.host_adapter_receipt.v1");
    expect(dispatch.receipt.reason).toMatch(/unknown host/);
    expect(dispatch.receipt.degradation_receipt?.rung).toBe("degraded");
  });
});

describe("HostAdapter contract — degraded/unavailable operation results", () => {
  it("app hosts are not installable package targets", () => {
    for (const hostId of ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"] as const) {
      const render = createHostAdapter(hostId).renderPackage();
      expect(render.status).toBe("unavailable");
      expect(render.receipt.reason).toMatch(/no installable package surface/);
    }
  });

  it("target package hosts report degraded rather than verified install support", () => {
    for (const hostId of ["codex-cli", "pi-cli", "antigravity-cli", "agents-file"] as const) {
      const render = createHostAdapter(hostId).renderPackage();
      expect(render.status).toBe("degraded");
      expect(render.value).toMatchObject({ installability: "target" });
    }
  });

  it("dispatch rejects known app hosts that are not dispatch selectable", () => {
    const result = createHostAdapter("codex-app").dispatch({ taskRun: { id: "lane" } });
    expect(result.status).toBe("unavailable");
    expect(result.receipt.reason).toMatch(/not dispatch-selectable/);
  });

  it("capability profiles list operations that the adapter will return as unavailable", () => {
    const appProfile = createHostAdapter("codex-app").capabilities();
    expect(appProfile.unavailable_operations).toEqual(
      expect.arrayContaining(["dispatch", "renderCommandSurface", "renderPackage"])
    );

    const cliProfile = createHostAdapter("claude-code-cli").capabilities();
    expect(cliProfile.unavailable_operations).not.toContain("dispatch");
    expect(cliProfile.unavailable_operations).not.toContain("renderPackage");
  });

  it("capability profiles match unavailable operation results for every known host", () => {
    for (const hostId of HOST_IDS) {
      const adapter = createHostAdapter(hostId);
      const profile = adapter.capabilities();
      const operationResults = {
        bootstrap: adapter.bootstrap(),
        preflight: adapter.preflight(),
        dispatch: adapter.dispatch({ taskRun: { id: "lane" } }),
        collect: adapter.collect(),
        renderCommandSurface: adapter.renderCommandSurface(),
        renderPackage: adapter.renderPackage(),
        renderPermissionDecision: adapter.renderPermissionDecision({ decision: "deny" }),
        resolveModelParams: adapter.resolveModelParams({ tier: "cheap" }),
        memory: adapter.memory({ mode: "status" }),
      };

      for (const [operation, result] of Object.entries(operationResults)) {
        if (result.status === "unavailable") {
          expect(profile.unavailable_operations).toContain(operation);
        }
      }
    }
  });

  it("preflight is explicitly degraded in foundation adapters while preserving no-hook evidence in the reason", () => {
    const appPreflight = createHostAdapter("codex-app").preflight();
    expect(appPreflight.status).toBe("degraded");
    expect(appPreflight.receipt.reason).toMatch(/no native hook advertised/);
  });

  it("default/stub model params preserve supplied fields and degrade unsupported keys", () => {
    const result = createHostAdapter("claude").resolveModelParams({
      tier: "powerful",
      params: { model: "opus", effort: "low", reasoning: "xhigh", verbosity: "low" },
    });
    expect(result.status).toBe("degraded");
    expect(result.value).toEqual({
      modelParams: {
        model: "opus",
        effort: "low",
        reasoning: "xhigh",
        verbosity: "low",
      },
      unsupported_model_params: ["effort", "reasoning", "verbosity"],
    });
  });

  it("pre-R9/R10 hosts record model-param degradation instead of claiming enforcement", () => {
    for (const hostId of [
      "pi-cli",
      "antigravity-cli",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
    ] as const) {
      const result = createHostAdapter(hostId).resolveModelParams({
        tier: "powerful",
        params: { model: "frontier", effort: "xhigh" },
      });
      expect(result.status).toBe("degraded");
      expect(result.value).toMatchObject({
        modelParams: { model: "frontier", effort: "xhigh" },
        unsupported_model_params: ["effort"],
      });
      expect(result.receipt.degradation_receipt).toBeDefined();
    }
  });
});
