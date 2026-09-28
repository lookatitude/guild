import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { createHostAdapter } from "./host-adapter-factory";

/**
 * Resolve a package the way the shipped package resolves it: under Node, from the
 * package's own tree. The bun preload serves js-yaml to src/ by name, which makes
 * an in-process require.resolve answer with the bare name instead of a path.
 */
function resolveUnderNode(pkg: string, fromDir: string): string {
  const r = spawnSync(process.execPath, ["-p", `require.resolve(${JSON.stringify(pkg)}, { paths: [${JSON.stringify(fromDir)}] })`], {
    encoding: "utf8",
  });
  return r.stdout.trim();
}
import { createClaudeCodeCliAdapter } from "./host-adapters/claude-code-cli";
import { HOST_REGISTRY_ROWS } from "./host-registry-schema";
import { buildInventory, PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import {
  checkClaudeInstallSurface,
  loadModuleResourceResolver,
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
  // The render path fails closed when the vendored script runtime deps are
  // missing (issue #14), so the fixture must carry them like a real checkout
  // after `npm ci --prefix scripts`.
  for (const dep of ["js-yaml", "argparse"]) {
    fs.cpSync(
      path.join(PLUGIN_ROOT, "scripts", "node_modules", dep),
      path.join(root, "scripts", "node_modules", dep),
      { recursive: true }
    );
  }
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
        taskCellInstanceId: "T1.a1.i-abc",
        specialist: "backend",
      },
    });
    expect(dispatch.status).toBe("ok");
    expect(JSON.stringify(dispatch.value)).toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    expect(JSON.stringify(dispatch.value)).toContain("GUILD_TASK_ID=T1");
    expect(JSON.stringify(dispatch.value)).toContain("GUILD_TASK_CELL_INSTANCE_ID=T1.a1.i-abc");

    // plr-wi-15-4: a task id with no admitted instance id is refused, never planned.
    const unadmitted = adapter.dispatch({
      taskRun: { prompt: "Implement the lane", runId: "run-1", taskId: "T1", specialist: "backend" },
    });
    expect(unadmitted.status).toBe("unavailable");
    expect(String(unadmitted.receipt.reason).startsWith("isolated_spawn_refused:")).toBe(true);
    expect(JSON.stringify(unadmitted.value)).not.toContain("GUILD_TASK_ID");
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
    const res = spawnSync("git", ["grep", "-nE", symbols.join("|"), "--", "scripts/*.ts", "scripts/**/*.ts"], {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^scripts\/guild-run\.ts:\d+:import \{ createHostAdapter \} from "\.\/lib\/host-adapter-factory";$/m);
    const offenders = res.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith("scripts/guild-run.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/support-matrix.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/host-adapter-factory.ts:"))
      .filter((line) => !line.startsWith("scripts/lib/host-adapter-contract.ts:"))
      .filter((line) => !line.includes("/__tests__/") && !/^[^:]+\.test\.ts:/.test(line));
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

  it("generated Claude package ships compiled runtime and module manifests, never domain TypeScript (KTD28)", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-claude-src-"));
    try {
      const dest = writeClaudeTree(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT), tmpDist, UNSTAMPED_GENERATED_AT);
      // Module manifests ship for the conformance worker (T16 deleted the shims); no domain file does.
      expect(fs.existsSync(path.join(dest, "src", "modules", "kernel", "module.manifest.json"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "src", "modules", "kernel", "index.ts"))).toBe(false);
      expect(fs.existsSync(path.join(dest, "src", "domains"))).toBe(false);
      // Authoring TypeScript and its node_modules stay in the repo (KTD11).
      expect(fs.existsSync(path.join(dest, "scripts", "lib", "module-manifest.ts"))).toBe(false);
      expect(fs.existsSync(path.join(dest, "scripts", "node_modules"))).toBe(false);
      // The compiled user path runs under plain node, with js-yaml inlined.
      const hookProbe = spawnSync(process.execPath, [path.join(dest, "hooks", "dist", "learning-backstop.js")], {
        cwd: dest,
        encoding: "utf8",
        input: "{}",
      });
      expect(hookProbe.status).toBe(0);
      expect(hookProbe.stderr).not.toContain("Cannot resolve js-yaml");
      const cliProbe = spawnSync(process.execPath, [path.join(dest, "runtime", "scripts", "workspace-detect.js"), "--cwd", dest], {
        cwd: dest,
        encoding: "utf8",
      });
      expect(cliProbe.stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND/);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated Claude package ships the emit-learning-checkpoint CLI entrypoint (issue #55)", () => {
    // hooks/emit-learning-checkpoint is not a Claude hook-event binding — it's a
    // standalone CLI the learning-checkpoint skill invokes directly via
    // `node .../hooks/dist/emit-learning-checkpoint.js` (compiled, KTD11).
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r3-claude-checkpoint-cli-"));
    try {
      const dest = writeClaudeTree(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT), tmpDist, UNSTAMPED_GENERATED_AT);

      const shippedDist = path.join(dest, "hooks", "dist", "emit-learning-checkpoint.js");
      expect(fs.existsSync(shippedDist)).toBe(true);
      expect(fs.existsSync(path.join(dest, "hooks", "emit-learning-checkpoint.ts"))).toBe(false);

      // The documented invocation must actually run from the shipped tree.
      const cliProbe = spawnSync(process.execPath, [shippedDist], {
        cwd: dest,
        encoding: "utf8",
        env: {
          ...process.env,
          GUILD_RUN_ID: "run-package-probe",
          GUILD_PHASE: "development",
          GUILD_EVIDENCE_REF: "none",
          GUILD_CWD: dest,
        },
        timeout: 30000,
      });
      expect(cliProbe.status).toBe(0);
      expect(
        fs.existsSync(
          path.join(dest, ".guild", "runs", "run-package-probe", "learning", "development-run-package-probe.yaml")
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated packages refuse a projected surface file that is missing at render time", () => {
    const fixtureRoot = copyPluginFixture();
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-missing-projected-surface-"));
    try {
      const inv = buildInventory(fixtureRoot);
      // The projection plan is taken while the file exists; the file then goes.
      const resolver = loadModuleResourceResolver(fixtureRoot);
      fs.rmSync(path.join(fixtureRoot, "commands", "plan.md"));
      expect(() => writeClaudeTree(fixtureRoot, inv, tmpDist, UNSTAMPED_GENERATED_AT, resolver)).toThrow(
        /projected surface file is missing for commands:plan/
      );
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

  it("live Claude install metadata sync refuses an inventory entry whose surface file is missing", () => {
    const fixtureRoot = copyPluginFixture();
    try {
      const inv = buildInventory(fixtureRoot);
      const before = fs.readFileSync(path.join(fixtureRoot, ".claude-plugin", "plugin.json"));
      fs.rmSync(path.join(fixtureRoot, "commands", "plan.md"));
      expect(() => syncClaudeInstallSurface(fixtureRoot, inv, UNSTAMPED_GENERATED_AT)).toThrow(
        /commands:plan/
      );
      // Refused before any write.
      expect(fs.readFileSync(path.join(fixtureRoot, ".claude-plugin", "plugin.json"))).toEqual(before);
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("generated Codex marketplace package carries the compiled runtime, not script dependencies", () => {
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
      expect(fs.existsSync(path.join(pluginDir, "runtime", "scripts", "guild-run.js"))).toBe(true);
      expect(fs.existsSync(path.join(pluginDir, "scripts", "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(tmpDist, { recursive: true, force: true });
    }
  });

  it("generated Codex marketplace exposes every Guild skill through the native plugin skill root", () => {
    const tmpDist = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-native-skills-"));
    try {
      const inv = buildInventory(PLUGIN_ROOT);
      const codexDir = writeCodexTree(PLUGIN_ROOT, inv, tmpDist, UNSTAMPED_GENERATED_AT);
      const marketplaceDir = writeCodexMarketplaceTree(codexDir, tmpDist);
      const pluginDir = path.join(marketplaceDir, "plugins", "guild");
      for (const skill of inv.skills) {
        expect(fs.readFileSync(path.join(pluginDir, skill.source_path))).toEqual(
          fs.readFileSync(path.join(PLUGIN_ROOT, skill.source_path))
        );
      }
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
            env: { ...process.env, npm_config_cache: require("node:path").join(require("node:os").tmpdir(), "guild-npm-cache") },
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
