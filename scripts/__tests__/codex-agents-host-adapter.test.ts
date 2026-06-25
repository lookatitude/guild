import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { createHostAdapter } from "../lib/host-adapter-factory";
import { PLUGIN_ROOT } from "../build-inventory";

function resolveCodexBinary(): string | null {
  const candidates = [
    process.env.CODEX_BIN,
    spawnSync("sh", ["-lc", "command -v codex"], { encoding: "utf8" }).stdout.trim(),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ].filter((v): v is string => Boolean(v));
  for (const candidate of candidates) {
    const res = spawnSync(candidate, ["--help"], { encoding: "utf8" });
    if (res.status === 0) return candidate;
  }
  return null;
}

const codexBinary = resolveCodexBinary();
const codexIt = codexBinary ? it : it.skip;

describe("R4 Codex CLI and agents-file host adapters", () => {
  it("factory returns concrete Codex and agents-file adapters", () => {
    const codex = createHostAdapter("codex-cli");
    expect(codex.hostId).toBe("codex-cli");
    expect(createHostAdapter("codex").hostId).toBe("codex-cli");
    expect(createHostAdapter("codex-plugin").hostId).toBe("codex-cli");
    expect(codex.capabilities()).toMatchObject({
      host_id: "codex-cli",
      family: "codex",
      installability: "target",
      result_adapter: true,
      dispatch_selectable: true,
    });

    const agents = createHostAdapter("agents-file");
    expect(agents.hostId).toBe("agents-file");
    expect(createHostAdapter("agents").hostId).toBe("agents-file");
    expect(createHostAdapter(".agents").hostId).toBe("agents-file");
    expect(agents.capabilities()).toMatchObject({
      host_id: "agents-file",
      family: "agents",
      surface_kind: "file",
      installability: "target",
    });
  });

  it("Codex adapter exposes AGENTS.md bootstrap, package, wrapper dispatch, and degraded hook/memory receipts", () => {
    const adapter = createHostAdapter("codex-cli");
    expect(adapter.bootstrap({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "ok",
      value: { instruction_file: "AGENTS.md", registry_value: "instruction_file" },
    });
    expect(adapter.preflight({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "degraded",
      value: { native_hooks: false, bootstrap_file: "AGENTS.md" },
    });
    expect(adapter.renderPackage({ packageRoot: PLUGIN_ROOT })).toMatchObject({
      status: "degraded",
      value: { manifest_path: ".codex-plugin/plugin.json", agents_skill_root: ".agents/skills/guild" },
    });
    expect(
      adapter.dispatch({
        taskRun: {
          prompt: "Review this",
          command: "codex",
          args: ["exec", "Review this"],
          env: { GUILD_RUN_ID: "run-1" },
        },
      })
    ).toMatchObject({
      status: "ok",
      value: { dispatch_kind: "wrapper_launch", command: "codex", args: ["exec", "Review this"] },
    });
    expect(adapter.memory({ mode: "status" })).toMatchObject({
      status: "degraded",
      value: { primary: { transport: "filesystem-bm25", root: ".guild" } },
    });

    expect(adapter.resolveModelParams({
      tier: "powerful",
      params: { model: "gpt-6-codex", reasoning: "xhigh" },
    })).toMatchObject({
      status: "ok",
      value: {
        modelParams: { model: "gpt-6-codex", reasoning: "xhigh" },
        argv: ["--model", "gpt-6-codex", "-c", "model_reasoning_effort=\"xhigh\""],
        unsupported_model_params: [],
      },
    });

    expect(adapter.resolveModelParams({
      tier: "powerful",
      params: { model: "gpt-6-codex", effort: "low", verbosity: "high" },
    })).toMatchObject({
      status: "degraded",
      value: {
        unsupported_model_params: ["verbosity"],
      },
    });
  });

  it("agents-file adapter is an install/package target, not a process launcher", () => {
    const adapter = createHostAdapter("agents-file");
    expect(adapter.bootstrap({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "ok",
      value: { instruction_file: "AGENTS.md", skill_root: ".agents/skills/guild" },
    });
    expect(adapter.dispatch({ taskRun: { prompt: "Do work" } })).toMatchObject({
      status: "degraded",
      value: { dispatch_kind: "instruction_file", command: null },
    });
    expect(adapter.resolveModelParams({
      tier: "mid",
      params: { model: "sonnet", effort: "low" },
    })).toMatchObject({
      status: "degraded",
      value: {
        modelParams: { model: "sonnet", effort: "low" },
        unsupported_model_params: ["model", "effort"],
      },
    });
    expect(adapter.renderPackage({ packageRoot: PLUGIN_ROOT })).toMatchObject({
      status: "degraded",
      value: { agents_md_path: "AGENTS.md", skill_root: ".agents/skills/guild" },
    });
  });
});

describe("R4 install.sh host dry-runs", () => {
  it("accepts --host codex-cli and prints Codex plugin commands", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "codex-cli"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>"
    );
    expect(res.stdout).toContain("would run: codex plugin marketplace remove guild || true");
    expect(res.stdout).toContain("would run: codex plugin marketplace add ./dist/codex-marketplace");
    expect(res.stdout).toContain("would run: codex plugin add guild@guild");
    expect(res.stdout).toContain("Package bootstrap: AGENTS.md plus .agents/skills/guild");
  });

  it("accepts --host codex-plugin as a legacy Codex alias", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "codex-plugin"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("would run: codex plugin marketplace add ./dist/codex-marketplace");
    expect(res.stdout).toContain("would run: codex plugin add guild@guild");
  });

  it("accepts --host agents-file and prints universal AGENTS.md package guidance", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "agents-file"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>"
    );
    expect(res.stdout).toContain("Universal AGENTS.md package target selected");
    expect(res.stdout).toContain("dist/agents/AGENTS.md");
    expect(res.stdout).toContain("dist/agents/.agents/skills/guild");
    expect(res.stdout).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
  });

  codexIt("verifies the local Codex CLI exposes every plugin command used by install.sh", () => {
    expect(codexBinary).toBeTruthy();
    const marketplaceAdd = spawnSync(codexBinary!, ["plugin", "marketplace", "add", "--help"], {
      encoding: "utf8",
    });
    expect(marketplaceAdd.status).toBe(0);
    expect(marketplaceAdd.stdout).toContain("codex plugin marketplace add");
    expect(marketplaceAdd.stdout).toContain("<SOURCE>");

    const marketplaceUpgrade = spawnSync(codexBinary!, ["plugin", "marketplace", "upgrade", "--help"], {
      encoding: "utf8",
    });
    expect(marketplaceUpgrade.status).toBe(0);
    expect(marketplaceUpgrade.stdout).toContain("codex plugin marketplace upgrade");
    expect(marketplaceUpgrade.stdout).toContain("[MARKETPLACE_NAME]");

    const marketplaceRemove = spawnSync(codexBinary!, ["plugin", "marketplace", "remove", "--help"], {
      encoding: "utf8",
    });
    expect(marketplaceRemove.status).toBe(0);
    expect(marketplaceRemove.stdout).toContain("codex plugin marketplace remove");
    expect(marketplaceRemove.stdout).toContain("<MARKETPLACE_NAME>");

    const add = spawnSync(codexBinary!, ["plugin", "add", "--help"], {
      encoding: "utf8",
    });
    expect(add.status).toBe(0);
    expect(add.stdout).toContain("codex plugin add");
    expect(add.stdout).toContain("<PLUGIN[@MARKETPLACE]>");
  });
});
