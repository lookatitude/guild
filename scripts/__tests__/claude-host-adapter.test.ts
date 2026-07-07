import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { createHostAdapter } from "../lib/host-adapter-factory";
import { createClaudeCodeCliAdapter } from "../lib/host-adapters/claude-code-cli";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry-schema";
import { buildInventory, PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import {
  checkClaudeInstallSurface,
  syncClaudeInstallSurface,
  writeAgentsTree,
  writeAntigravityTree,
  writeClaudeTree,
  writeCodexTree,
  writeCodexMarketplaceTree,
  writePiTree,
} from "../build-host-packages";

function copyPluginFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-package-fixture-"));
  for (const dir of ["commands", "skills", "agents", "hooks", "scripts", "src", ".claude-plugin"]) {
    fs.cpSync(path.join(PLUGIN_ROOT, dir), path.join(root, dir), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`),
    });
  }
  fs.copyFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), path.join(root, ".mcp.json"));
  return root;
}

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

  it("generated Claude package includes generated install metadata sidecars", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-claude-install-metadata-"));
    try {
      const inv = buildInventory(PLUGIN_ROOT);
      const dest = writeClaudeTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);
      const pluginJson = JSON.parse(
        fs.readFileSync(path.join(dest, ".claude-plugin", "plugin.json"), "utf8")
      ) as { name: string; version: string };
      const marketplace = JSON.parse(
        fs.readFileSync(path.join(dest, ".claude-plugin", "marketplace.json"), "utf8")
      ) as { plugins: Array<{ name: string; version: string; source: string }> };
      expect(pluginJson).toMatchObject({ name: "guild", version: inv.manifest.version });
      expect(marketplace.plugins).toHaveLength(1);
      expect(marketplace.plugins[0]).toMatchObject({
        name: "guild",
        version: inv.manifest.version,
        source: "./",
      });
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated Claude package bundles src/modules for script compatibility shims", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-claude-src-"));
    try {
      const dest = writeClaudeTree(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT), tmpDist, UNSTAMPED_GENERATED_AT);
      const shim = fs.readFileSync(path.join(dest, "scripts", "lib", "module-manifest.ts"), "utf8");
      expect(shim).toContain("../../src/modules/kernel/workflows/module-manifest");
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "kernel", "workflows", "module-manifest.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "kernel", "workflows", "yaml-loader.ts"))
      ).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "package-lock.json"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "node_modules", "js-yaml", "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "node_modules", "argparse", "index.js"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "node_modules", "esprima", "package.json"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "scripts", "node_modules", "sprintf-js", "package.json"))).toBe(true);
      expect(require.resolve("js-yaml", { paths: [path.join(dest, "scripts")] })).toContain(
        path.join(dest, "scripts", "node_modules", "js-yaml")
      );
      const hookProbe = spawnSync(process.execPath, [path.join(dest, "hooks", "dist", "learning-backstop.js")], {
        cwd: dest,
        encoding: "utf8",
        input: "{}",
      });
      expect(hookProbe.status).toBe(0);
      expect(hookProbe.stderr).not.toContain("Cannot resolve js-yaml");
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "check-module-ownership.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "build-inventory.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "equivalence-contract.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "inventory-schema.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "installer-contract.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "parity-contract.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "per-host-packaging.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "result-contracts.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "review-result.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "distribution", "workflows", "surface-manifest.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "dispatch", "workflows", "specialist-contract.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "host-types.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "capability", "workflows", "router.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "capability", "workflows", "rank.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "capability", "workflows", "tiebreak.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "capability", "workflows", "tier-defaults.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "config", "workflows", "settings-reader.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "config", "workflows", "settings-resolver.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "config", "workflows", "tier-model.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "prompting", "workflows", "team-prompt.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "recall-protect.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "protect-chunks-cli.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "wiki-recall.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "recall.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "fs-scanner.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "context", "workflows", "memory-adapter.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "evals", "workflows", "define-schema.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "evals", "workflows", "explore-schema.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "knowledge", "workflows", "ingest-importance.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "knowledge", "workflows", "knowledge-links-contract.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "telemetry", "workflows", "guild-trace-events.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "telemetry", "workflows", "guild-trace-emit.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "state", "workflows", "frontmatter.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "state", "workflows", "guild-discovery.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "state", "workflows", "guild-root.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "state", "workflows", "index-cache.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "migrations", "workflows", "index-migrate.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "host-runtime", "workflows", "host-capabilities-schema.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "host-runtime", "workflows", "host-capability-manifest.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "host-runtime", "workflows", "host-registry-schema.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "host-id-namespace.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "host-registry.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "host-runtime", "workflows", "adapter-fallback-ladders.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "host-runtime", "workflows", "host-profiles-validate.ts")
        )
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "runtime-adapters.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "host-adapter-contract.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "degradation-trace.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "mixed-host-contracts.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(path.join(dest, "src", "modules", "host-runtime", "workflows", "provider-detect.ts"))
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(dest, "src", "modules", "learning", "workflows", "knowledge-graph-contract.ts")
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated packages refuse stale module resource mirrors", () => {
    const fixtureRoot = copyPluginFixture();
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-stale-module-resources-"));
    try {
      fs.appendFileSync(path.join(fixtureRoot, "commands", "plan.md"), "\nSTALE RESOURCE CONTROL\n");
      expect(() =>
        writeClaudeTree(fixtureRoot, buildInventory(fixtureRoot), tmpDist, UNSTAMPED_GENERATED_AT)
      ).toThrow(/module resources are stale/);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("live Claude install metadata can be synced and checked against the generated render", () => {
    const fixtureRoot = copyPluginFixture();
    try {
      const inv = buildInventory(fixtureRoot);
      syncClaudeInstallSurface(fixtureRoot, inv, UNSTAMPED_GENERATED_AT);
      expect(checkClaudeInstallSurface(fixtureRoot, inv, UNSTAMPED_GENERATED_AT)).toEqual({
        ok: true,
        stale: [],
      });

      fs.appendFileSync(path.join(fixtureRoot, ".claude-plugin", "plugin.json"), "\n");
      const drift = checkClaudeInstallSurface(fixtureRoot, inv, UNSTAMPED_GENERATED_AT);
      expect(drift.ok).toBe(false);
      expect(drift.stale).toContainEqual({
        path: ".claude-plugin/plugin.json",
        reason: "content differs from generated module/inventory render",
      });
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("live Claude install metadata sync refuses stale module resource mirrors", () => {
    const fixtureRoot = copyPluginFixture();
    try {
      const inv = buildInventory(fixtureRoot);
      fs.appendFileSync(path.join(fixtureRoot, "commands", "plan.md"), "\nSTALE RESOURCE CONTROL\n");
      expect(() => syncClaudeInstallSurface(fixtureRoot, inv, UNSTAMPED_GENERATED_AT)).toThrow(
        /module resources are stale/
      );
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("generated Codex marketplace package preserves scripts runtime dependencies", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-codex-marketplace-runtime-"));
    try {
      const inv = buildInventory(PLUGIN_ROOT);
      const codexDir = writeCodexTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);
      const marketplaceDir = writeCodexMarketplaceTree(codexDir, tmpDist);
      const pluginDir = path.join(marketplaceDir, "plugins", "guild");
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, ".codex-plugin", "plugin.json"), "utf8"));
      const codexHooks = JSON.parse(fs.readFileSync(path.join(pluginDir, "hooks", "codex-hooks.json"), "utf8"));
      expect(manifest.hooks).toBe("./hooks/codex-hooks.json");
      expect(codexHooks.hooks.UserPromptSubmit[0].hooks[0].command).toContain("codex-guild-prompt-bridge.js");
      expect(fs.existsSync(path.join(pluginDir, "hooks", "codex-guild-prompt-bridge.js"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "command-src", "command-registry.json"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "scripts", "node_modules", "js-yaml", "index.js"))).toBe(true);
      expect(require.resolve("js-yaml", { paths: [path.join(pluginDir, "scripts")] })).toContain(
        path.join(pluginDir, "scripts", "node_modules", "js-yaml")
      );
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated non-Claude packages execute bundled guild-run wrappers in dry-run mode", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-generated-wrapper-smoke-"));
    const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wrapper-cwd-"));
    try {
      const inv = buildInventory(PLUGIN_ROOT);
      const agentsDir = writeAgentsTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);
      expect(fs.existsSync(path.join(agentsDir, "AGENTS.md"))).toBe(true);
      expect(
        fs.existsSync(path.join(agentsDir, ".agents", "skills", "guild", "meta", "using-guild", "SKILL.src.md"))
      ).toBe(true);
      const packages = [
        { host: "codex", dir: writeCodexTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT) },
        { host: "pi", dir: writePiTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT) },
        { host: "antigravity", dir: writeAntigravityTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT) },
      ];

      for (const pkg of packages) {
        const res = spawnSync(
          path.join(pkg.dir, "bin", "guild-run"),
          ["--dry-run", "--prompt", `smoke ${pkg.host}`, "--cwd", tmpCwd],
          {
            cwd: pkg.dir,
            encoding: "utf8",
            env: { ...process.env, npm_config_cache: "/private/tmp/guild-npm-cache" },
            maxBuffer: 10 * 1024 * 1024,
          }
        );
        expect(res.status).toBe(0);
        const plan = JSON.parse(res.stdout) as Record<string, unknown>;
        expect(plan).toMatchObject({
          host: pkg.host,
          cwd: tmpCwd,
          host_adapter: {
            schema_version: "guild.run_host_adapter_receipt.v1",
          },
        });
        expect(plan["command"]).toBeTruthy();
        expect(JSON.stringify(plan)).toContain(`smoke ${pkg.host}`);
      }
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("install.sh Claude host dry-run", () => {
  it("accepts --host claude-code-cli and prints Claude install commands plus wrapper shape", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "claude-code-cli"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(
      "would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>"
    );
    expect(res.stdout).toContain("would run: claude plugin validate dist/claude-code");
    expect(res.stdout).toContain("would run: claude plugin marketplace add dist/claude-code");
    expect(res.stdout).toContain("would run: claude plugin install guild@guild");
    expect(res.stdout).toContain("CLAUDE.md imports AGENTS.md");
    expect(res.stdout).toContain("@AGENTS.md");
  });
});
