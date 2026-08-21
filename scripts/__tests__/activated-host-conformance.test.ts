import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";

import { NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS } from "../../src/modules/lifecycle";
import { snapshotMigrationRuntimePackage } from "../lib/capability/migration-evidence";
import { buildHostPackages } from "../build-host-packages";

const {
  ACTIVATED_HOST_CONFORMANCE_SCHEMA,
  ACTIVATED_HOST_WORKER_SCHEMA,
  activatedConsumerRoots,
  activatedHostCaptureId,
  captureActivatedHostConformance,
  containsSensitiveOutput,
  codexExecutionWorkspace,
  isolatedCodexEnvironment,
  openHostExecutable,
  publishActivatedHostEvidence,
  refreshSensitiveJsonValues,
  runJsonCommand,
  sealActivatedWorkerRuntime,
  sensitiveJsonValues,
  snapshotConsumerContentTree,
  snapshotOfficialConsumerGitTree,
  sha256Hex,
  snapshotHostExecutable,
  spawnOpenExecutable,
  runActivatedConformanceWorker,
  verifyActivatedHostConformanceReceipt,
} = require("../activated-host-conformance") as any;

const SOURCE_COMMIT = "cdbf6d1b9018f8e48f8d135898e47e64eb640b05";
const RELEASE = "2.7.0-beta.4";
const RUNTIME_VERSION = `guild-${RELEASE}`;
const ADAPTER_VERSION = "guild.host_adapter.v1.0.0";
const PLATFORM = "darwin-arm64";
const CHALLENGE = "ab".repeat(32);
const CAPTURED_AT = "2026-08-21T00:00:00.000Z";

type HostId = "claude-code-cli" | "codex-cli";

function fixtureConsumerTrees(website?: string, benchmark?: string) {
  const identity = (name: "website" | "benchmark", root: string | undefined, seed: string) => {
    const content = root === undefined ? { content_tree_sha256: seed.repeat(64), file_count: 1 } : snapshotConsumerContentTree(root);
    return {
      schema_version: "guild.consumer_tree_identity.v1",
      name,
      repository: `github.com/lookatitude/guild-${name}`,
      source_commit: seed.repeat(40),
      source_tree: (seed === "a" ? "b" : "d").repeat(40),
      ...content,
    };
  };
  return { website: identity("website", website, "a"), benchmark: identity("benchmark", benchmark, "c") };
}

function packageFixture(host: HostId): {
  root: string;
  runtimePackage: ReturnType<typeof snapshotMigrationRuntimePackage>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `guild-activated-${host}-`));
  const manifest = host === "claude-code-cli" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  fs.mkdirSync(path.join(root, path.dirname(manifest)), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "lib", "capability"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "hooks", "dist"), { recursive: true });
  if (host === "codex-cli") fs.mkdirSync(path.join(root, ".agents", "skills", "guild", "meta", "verify-done"), { recursive: true });
  fs.writeFileSync(path.join(root, manifest), `${JSON.stringify({ name: "guild", version: RELEASE })}\n`);
  fs.writeFileSync(path.join(root, "scripts", "lib", "capability", "compatibility-loader.ts"), "export {};\n");
  fs.writeFileSync(path.join(root, "scripts", "activated-host-conformance.ts"), "export {};\n");
  fs.writeFileSync(path.join(root, "scripts", "dist", "activated-host-conformance.js"), "console.log('sealed fixture');\n");
  fs.writeFileSync(path.join(root, "hooks", "dist", "runtime.cjs"), "module.exports = {};\n");
  if (host === "codex-cli") fs.writeFileSync(
    path.join(root, ".agents", "skills", "guild", "meta", "verify-done", "SKILL.md"),
    "---\nname: guild-verify-done\ndescription: Final gate before task close, and the home of Guild's verify-the-claim discipline — fixture\n---\n",
  );
  return { root, runtimePackage: snapshotMigrationRuntimePackage(root, host) };
}

function identity(host: HostId, packageHash: string) {
  return {
    source_commit: SOURCE_COMMIT,
    package_hash: `sha256:${packageHash}`,
    runtime_version: RUNTIME_VERSION,
    adapter_version: ADAPTER_VERSION,
    host_id: host,
    host_version: host === "claude-code-cli" ? "2.1.236" : "0.147.0",
    platform: PLATFORM,
    contract_version: 1,
    scenario_suite_id: "guild.conformance_scenarios.v1",
    scenario_suite_version: "1.0.0",
    release_id: "rel-2026-08-21-beta4",
  };
}

function evidence(host: HostId, packageHash: string) {
  const activatedRuntime = identity(host, packageHash);
  return {
    schema_version: "guild.conformance_evidence.v1",
    suite_id: "guild.conformance_scenarios.v1",
    suite_version: "1.0.0",
    required_scenario_ids: [...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS],
    activated_runtime: activatedRuntime,
    claimant_id: "guild.activated-host-capture",
    results: NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS.map((stableId, index) => ({
    stable_id: stableId,
    outcome_type: "guild.lifecycle_outcome.v1",
    disposition: "succeeded",
    reason_code: null,
    evidence_identity: activatedRuntime,
    evidence_freshness: "fresh",
    receipt_ref: `guild.receipt_ref.v1:activated-host#${index + 1}@nec1:${(index + 1)
      .toString(16)
      .padStart(16, "0")}`,
    })),
  };
}

function workerCommand(host: HostId, packageHash: string): string {
  return [
    "npx tsx scripts/activated-host-conformance.ts worker",
    `--host ${host}`,
    `--challenge ${CHALLENGE}`,
    `--source-commit ${SOURCE_COMMIT}`,
    `--package-hash ${packageHash}`,
    `--runtime-version ${RUNTIME_VERSION}`,
    `--host-version ${host === "claude-code-cli" ? "2.1.236" : "0.147.0"}`,
    `--platform ${PLATFORM}`,
    `--release ${RELEASE}`,
    "--out /tmp/guild-activated-worker/result.json",
  ].join(" ");
}

function runtimeBinding(runtimePackage: ReturnType<typeof snapshotMigrationRuntimePackage>) {
  return {
    host_id: runtimePackage.host_id,
    manifest_path: runtimePackage.manifest_path,
    manifest_sha256: runtimePackage.manifest_sha256,
    producer_sha256: runtimePackage.producer_sha256,
    tree_sha256: runtimePackage.tree_sha256,
    install_surface_sha256: runtimePackage.install_surface_sha256,
  };
}

function hostExecutableBinding() {
  const stats = fs.statSync(process.execPath);
  return {
    path: process.execPath,
    sha256: sha256Hex(fs.readFileSync(process.execPath)),
    device: stats.dev,
    inode: stats.ino,
    size: stats.size,
    companions: [],
  };
}

function activation(
  host: HostId,
  installedAt = CAPTURED_AT,
  runtimePackage?: ReturnType<typeof snapshotMigrationRuntimePackage>,
) {
  if (host === "codex-cli") return {
    schema_version: "guild.codex_model_visible_skill_activation.v1",
    mechanism: "model-visible-plugin-skill",
    skill_name: "guild:guild-verify-done",
    skill_path: ".agents/skills/guild/meta/verify-done/SKILL.md",
    skill_sha256: runtimePackage?.files.find((entry) => entry.path === ".agents/skills/guild/meta/verify-done/SKILL.md")?.sha256,
    declaration: "GUILD_CODEX_SKILL_VISIBLE:Final gate before task close, and the home of Guild's verify-the-claim discipline",
  };
  const receipt = {
    schema_version: "guild.install_receipt.v1",
    host,
    channel: "beta",
    ref: "next",
    commit: null,
    version: RELEASE,
    installed_at: installedAt,
    minted_by: "update-check-session-start",
    managed_by: "host-native",
    channel_confidence: "version-derived",
  };
  return { path: "guild-install-receipt.json", sha256: sha256Hex(`${JSON.stringify(receipt, null, 2)}\n`), receipt };
}

function writeActivation(root: string, host: HostId, installedAt = CAPTURED_AT): void {
  const value = activation(host, installedAt) as any;
  if (host === "claude-code-cli") fs.writeFileSync(path.join(root, "guild-install-receipt.json"), `${JSON.stringify(value.receipt, null, 2)}\n`);
}

function writeSessionReceipt(root: string, host: HostId, installedAt = CAPTURED_AT): void {
  const receipt = {
    schema_version: "guild.install_receipt.v1",
    host,
    channel: "beta",
    ref: "next",
    commit: null,
    version: RELEASE,
    installed_at: installedAt,
    minted_by: "update-check-session-start",
    managed_by: "host-native",
    channel_confidence: "version-derived",
  };
  fs.writeFileSync(path.join(root, "guild-install-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
}

function productionWorkerFixture(host: HostId = "claude-code-cli") {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-production-worker-"));
  const plugin = path.join(stage, "plugin");
  const website = path.join(stage, "website");
  const benchmark = path.join(stage, "benchmark");
  const manifest = host === "claude-code-cli" ? ".claude-plugin/plugin.json" : ".codex-plugin/plugin.json";
  fs.mkdirSync(path.join(plugin, path.dirname(manifest)), { recursive: true });
  fs.cpSync(path.resolve(__dirname, `../../${manifest}`), path.join(plugin, manifest));
  fs.cpSync(path.resolve(__dirname, "../../src/modules"), path.join(plugin, "src", "modules"), { recursive: true });
  fs.mkdirSync(path.join(plugin, "scripts", "lib", "capability"), { recursive: true });
  fs.mkdirSync(path.join(plugin, "hooks", "dist"), { recursive: true });
  fs.cpSync(path.resolve(__dirname, "../lib/capability/compatibility-loader.ts"), path.join(plugin, "scripts", "lib", "capability", "compatibility-loader.ts"));
  fs.cpSync(path.resolve(__dirname, "../activated-host-conformance.ts"), path.join(plugin, "scripts", "activated-host-conformance.ts"));
  fs.writeFileSync(path.join(plugin, "hooks", "dist", "runtime.cjs"), "module.exports = {};\n");
  fs.mkdirSync(path.join(website, "src"), { recursive: true });
  fs.mkdirSync(path.join(benchmark, "src"), { recursive: true });
  fs.writeFileSync(path.join(website, "src", "render.ts"), "export {};\n");
  fs.writeFileSync(path.join(benchmark, "src", "run.ts"), "export {};\n");
  return { stage, plugin, website, benchmark, runtimePackage: snapshotMigrationRuntimePackage(plugin, host) };
}

function workerBytes(host: HostId, runtimePackage: ReturnType<typeof snapshotMigrationRuntimePackage>): string {
  return `${JSON.stringify({
    schema_version: ACTIVATED_HOST_WORKER_SCHEMA,
    ok: true,
    code: "evaluated",
    detail: "test runner transported a production-shaped worker result",
    marker: `GUILD_ACTIVATED_CONFORMANCE_OK:${CHALLENGE}`,
    challenge: CHALLENGE,
    host_id: host,
    evidence: evidence(host, runtimePackage.tree_sha256),
    package_snapshot: runtimeBinding(runtimePackage),
    host_activation: host === "codex-cli" ? null : activation(host, CAPTURED_AT, runtimePackage),
    consumer_trees: fixtureConsumerTrees(),
  }, null, 2)}\n`;
}

function transcript(host: HostId, packageRoot: string, command: string, runtimePackage: ReturnType<typeof snapshotMigrationRuntimePackage>, workerResult: string): string {
  const marker = `GUILD_ACTIVATED_CONFORMANCE_OK:${CHALLENGE}:RESULT_SHA256:${sha256Hex(workerResult)}`;
  const session = host === "claude-code-cli" ? "45561128-9731-417a-b20f-223b889b7bcb" : "01a0244a-32b4-7d83-a545-23a97a2aba0b";
  const rows = host === "claude-code-cli"
    ? [
        { type: "system", subtype: "init", session_id: session, plugins: [{ name: "guild", path: packageRoot, version: RELEASE }] },
        { type: "assistant", message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command } }] } },
        { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: false, content: marker }] } },
        { type: "assistant", message: { content: [{ type: "text", text: marker }] } },
        { type: "result", subtype: "success", session_id: session, result: marker },
      ]
    : [
        { type: "guild.codex_plugin_activation", schema_version: "guild.codex_plugin_activation.v1", marketplace: { marketplaceName: "guild-activated-capture" }, installed: { pluginId: "guild@guild-activated-capture", version: RELEASE, installedPath: packageRoot }, list_entry: { pluginId: "guild@guild-activated-capture", version: RELEASE, installed: true, enabled: true }, activated_package_path: packageRoot, runtime_package: runtimeBinding(runtimePackage) },
        { type: "thread.started", thread_id: session },
        { type: "turn.started" },
        { type: "item.completed", item: { id: "item-probe", type: "agent_message", text: "GUILD_CODEX_SKILL_VISIBLE:Final gate before task close, and the home of Guild's verify-the-claim discipline" } },
        { type: "item.started", item: { id: "item-1", type: "command_execution", command: `/bin/zsh -lc '${command}'`, aggregated_output: "", exit_code: null, status: "in_progress" } },
        { type: "item.completed", item: { id: "item-1", type: "command_execution", command: `/bin/zsh -lc '${command}'`, aggregated_output: `${marker}\n`, exit_code: 0, status: "completed" } },
        { type: "item.completed", item: { id: "item-2", type: "agent_message", text: marker } },
        { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
      ];
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function receipt(host: HostId, runtimePackage: ReturnType<typeof snapshotMigrationRuntimePackage>, packageRoot: string, rawTranscript: string, rawWorker: string) {
  const command = workerCommand(host, runtimePackage.tree_sha256);
  const withoutId = {
    schema_version: ACTIVATED_HOST_CONFORMANCE_SCHEMA,
    host_id: host,
    source_commit: SOURCE_COMMIT,
    release: RELEASE,
    runtime_package: runtimeBinding(runtimePackage),
    host_version: host === "claude-code-cli" ? "2.1.236" : "0.147.0",
    host_executable: hostExecutableBinding(),
    platform: PLATFORM,
    runtime_version: RUNTIME_VERSION,
    adapter_version: ADAPTER_VERSION,
    contract_version: 1,
    scenario_suite_id: "guild.conformance_scenarios.v1",
    scenario_suite_version: "1.0.0",
    challenge: CHALLENGE,
    activated_package_path: packageRoot,
    worker_command_sha256: sha256Hex(command),
    worker_result_sha256: sha256Hex(rawWorker),
    transcript_sha256: sha256Hex(rawTranscript),
    session_id: host === "claude-code-cli" ? "45561128-9731-417a-b20f-223b889b7bcb" : "01a0244a-32b4-7d83-a545-23a97a2aba0b",
    captured_at: CAPTURED_AT,
    evidence: evidence(host, runtimePackage.tree_sha256),
    activated_package_snapshot: runtimeBinding(runtimePackage),
    host_activation: activation(host, CAPTURED_AT, runtimePackage),
    consumer_trees: fixtureConsumerTrees(),
    external_attestation_verified: false,
    authorizes_promotion: false,
  };
  return { capture_id: activatedHostCaptureId(withoutId), ...withoutId };
}

function verify(host: HostId) {
  const fixture = packageFixture(host);
  const command = workerCommand(host, fixture.runtimePackage.tree_sha256);
  const rawWorker = workerBytes(host, fixture.runtimePackage);
  const rawTranscript = transcript(host, fixture.root, command, fixture.runtimePackage, rawWorker);
  const value = receipt(host, fixture.runtimePackage, fixture.root, rawTranscript, rawWorker);
  return { fixture, command, rawTranscript, rawWorker, value, result: verifyActivatedHostConformanceReceipt({
    receipt: value,
    transcript: rawTranscript,
    workerResult: rawWorker,
    packageRoot: fixture.root,
    expectedPackage: fixture.runtimePackage,
    expectedSourceCommit: SOURCE_COMMIT,
    expectedRelease: RELEASE,
  }) };
}

describe("activated-host conformance capture", () => {
  it("keeps the shipped worker bundle byte-identical to a fresh source build", () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-bundle-")), "activated-host-conformance.js");
    buildSync({
      entryPoints: [path.resolve(__dirname, "../activated-host-conformance.ts")],
      bundle: true,
      platform: "node",
      target: "node18",
      format: "cjs",
      alias: { "js-yaml": path.resolve(__dirname, "../node_modules/js-yaml") },
      outfile: out,
      logLevel: "silent",
    });
    expect(fs.readFileSync(out)).toEqual(fs.readFileSync(path.resolve(__dirname, "../dist/activated-host-conformance.js")));
  });

  it("bundles js-yaml into the relocatable sealed worker instead of resolving it from ambient disk", () => {
    const bundle = fs.readFileSync(path.resolve(__dirname, "../dist/activated-host-conformance.js"), "utf8");
    expect(bundle).toContain("node_modules/js-yaml/lib/common.js");
    expect(bundle).not.toMatch(/require\(["']js-yaml["']\)/);
  });

  it("executes the shipped worker bundle from both freshly generated host packages without an ambient TypeScript loader", () => {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-generated-hosts-"));
    buildHostPackages({
      root: path.resolve(__dirname, "../.."), distRoot, generatedAt: "1970-01-01T00:00:00.000Z",
      gates: false, syncClaudeInstall: false, checkClaudeInstall: false,
    });
    const website = path.join(distRoot, "website");
    const benchmark = path.join(distRoot, "benchmark");
    fs.mkdirSync(path.join(website, "src"), { recursive: true });
    fs.mkdirSync(path.join(benchmark, "src"), { recursive: true });
    fs.writeFileSync(path.join(website, "src", "render.ts"), "export {};\n");
    fs.writeFileSync(path.join(benchmark, "src", "run.ts"), "export {};\n");
    const consumerIdentitiesPath = path.join(distRoot, "consumer-identities.json");
    fs.writeFileSync(consumerIdentitiesPath, `${JSON.stringify(fixtureConsumerTrees(website, benchmark))}\n`);
    for (const [host, packageName] of [["claude-code-cli", "claude-code"], ["codex-cli", "codex"]] as const) {
      const packageRoot = path.join(distRoot, packageName);
      const runtimePackage = snapshotMigrationRuntimePackage(packageRoot, host);
      writeActivation(packageRoot, host);
      const out = path.join(distRoot, `${host}.worker.json`);
      const result = spawnSync(process.execPath, [
        path.join(packageRoot, "scripts", "dist", "activated-host-conformance.js"), "worker",
        "--host", host, "--challenge", CHALLENGE, "--source-commit", SOURCE_COMMIT,
        "--package-hash", runtimePackage.tree_sha256, "--runtime-version", RUNTIME_VERSION,
        "--host-version", host === "claude-code-cli" ? "2.1.236" : "0.147.0",
        "--platform", PLATFORM, "--release", RELEASE, "--captured-at", CAPTURED_AT,
        "--plugin-root", packageRoot, "--module-boundary-root", packageRoot,
        "--consumer-root", `website=${website}`,
        "--consumer-root", `benchmark=${benchmark}`, "--consumer-identities", consumerIdentitiesPath, "--out", out,
      ], { cwd: packageRoot, encoding: "utf8" });
      expect(result.status).toBe(0);
      const markerPrefix = `GUILD_ACTIVATED_CONFORMANCE_OK:${CHALLENGE}:RESULT_SHA256:`;
      expect(result.stdout.trim().startsWith(markerPrefix)).toBe(true);
      expect(result.stdout.trim().slice(markerPrefix.length)).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.parse(fs.readFileSync(out, "utf8")).evidence.results).toHaveLength(31);
    }
  });

  it("consumes a Codex SessionStart receipt before exact-tree self-snapshotting", () => {
    const fixture = productionWorkerFixture("codex-cli");
    const receiptPath = path.join(fixture.plugin, "guild-install-receipt.json");
    const attested = snapshotMigrationRuntimePackage(fixture.plugin, "codex-cli");
    // The attested tree predates the host-created receipt.
    writeSessionReceipt(fixture.plugin, "codex-cli");
    const receiptBearingPackage = snapshotMigrationRuntimePackage(fixture.plugin, "codex-cli");
    const result = runActivatedConformanceWorker({
      hostId: "codex-cli",
      challenge: CHALLENGE,
      sourceCommit: SOURCE_COMMIT,
      packageHash: attested.tree_sha256,
      runtimeVersion: RUNTIME_VERSION,
      hostVersion: "0.147.0",
      platform: PLATFORM,
      release: RELEASE,
      capturedAt: CAPTURED_AT,
      pluginRoot: fixture.plugin,
      moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
    });
    expect(receiptBearingPackage.tree_sha256).not.toBe(attested.tree_sha256);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "evaluated", hostActivation: null }));
    expect(fs.existsSync(receiptPath)).toBe(false);
  });

  it("evaluates Codex module boundaries from an exact package twin whose consumers are true siblings", () => {
    const fixture = productionWorkerFixture("codex-cli");
    const activatedPlugin = path.join(
      fixture.stage,
      "codex-home",
      "plugins",
      "cache",
      "guild-activated-capture",
      "guild",
      RELEASE,
    );
    fs.mkdirSync(path.dirname(activatedPlugin), { recursive: true });
    fs.cpSync(fixture.plugin, activatedPlugin, { recursive: true });
    const result = runActivatedConformanceWorker({
      hostId: "codex-cli",
      challenge: CHALLENGE,
      sourceCommit: SOURCE_COMMIT,
      packageHash: fixture.runtimePackage.tree_sha256,
      runtimeVersion: RUNTIME_VERSION,
      hostVersion: "0.147.0",
      platform: PLATFORM,
      release: RELEASE,
      capturedAt: CAPTURED_AT,
      pluginRoot: activatedPlugin,
      moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "evaluated" }));
  });

  it("refuses a module-boundary package twin whose bytes differ from the activated runtime", () => {
    const fixture = productionWorkerFixture("codex-cli");
    const activatedPlugin = path.join(fixture.stage, "activated", "plugin");
    fs.mkdirSync(path.dirname(activatedPlugin), { recursive: true });
    fs.cpSync(fixture.plugin, activatedPlugin, { recursive: true });
    fs.appendFileSync(path.join(fixture.plugin, "hooks", "dist", "runtime.cjs"), "// planted mismatch\n");
    const result = runActivatedConformanceWorker({
      hostId: "codex-cli", challenge: CHALLENGE, sourceCommit: SOURCE_COMMIT,
      packageHash: fixture.runtimePackage.tree_sha256, runtimeVersion: RUNTIME_VERSION,
      hostVersion: "0.147.0", platform: PLATFORM, release: RELEASE, capturedAt: CAPTURED_AT,
      pluginRoot: activatedPlugin, moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "module_boundary_package_mismatch" }));
  });

  it("refuses a module-boundary package twin that changes during owner evaluation", () => {
    const fixture = productionWorkerFixture("codex-cli");
    const activatedPlugin = path.join(fixture.stage, "activated", "plugin");
    fs.mkdirSync(path.dirname(activatedPlugin), { recursive: true });
    fs.cpSync(fixture.plugin, activatedPlugin, { recursive: true });
    const result = runActivatedConformanceWorker({
      hostId: "codex-cli", challenge: CHALLENGE, sourceCommit: SOURCE_COMMIT,
      packageHash: fixture.runtimePackage.tree_sha256, runtimeVersion: RUNTIME_VERSION,
      hostVersion: "0.147.0", platform: PLATFORM, release: RELEASE, capturedAt: CAPTURED_AT,
      pluginRoot: activatedPlugin, moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
      testOnlyAfterInitialBoundarySnapshot: () => {
        fs.appendFileSync(path.join(fixture.plugin, "hooks", "dist", "runtime.cjs"), "// planted drift\n");
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "module_boundary_package_drift" }));
  });

  it("detects copied auth.json token material before host output can be persisted", () => {
    const values = sensitiveJsonValues(Buffer.from(JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { access_token: "access-secret-123456", refresh_token: "refresh-secret-654321" },
      harmless: "ordinary-visible-value",
    })));
    expect(values).toEqual(expect.arrayContaining(["access-secret-123456", "refresh-secret-654321"]));
    expect(values).not.toContain("ordinary-visible-value");
    expect(containsSensitiveOutput("model echoed access-secret-123456", {}, values)).toBe(true);
  });

  it("refreshes copied Codex auth after each process and refuses a newly rotated token in output", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-rotated-auth-bin-"));
    const executable = path.join(bin, "codex");
    const companion = path.join(bin, "codex-code-mode-host");
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-rotated-auth-stage-"));
    const codexHome = path.join(stageRoot, "codex-home");
    const authPath = path.join(codexHome, "auth.json");
    fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    fs.writeFileSync(authPath, `${JSON.stringify({ tokens: { access_token: "original-token-123456" } })}\n`, { mode: 0o600 });
    fs.writeFileSync(executable, "#!/bin/sh\nprintf '{\"echo\":\"transient-token-654321\"}\\n'\nprintf '{\"tokens\":{\"access_token\":\"final-token-987654\"}}\\n' > \"$CODEX_HOME/auth.json\"\nchmod 600 \"$CODEX_HOME/auth.json\"\n", { mode: 0o755 });
    fs.writeFileSync(companion, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const opened = openHostExecutable("codex-cli", { PATH: bin }, stageRoot);
    const values = sensitiveJsonValues(fs.readFileSync(authPath));
    try {
      expect(() => runJsonCommand(opened, ["plugin", "list", "--json"], { PATH: bin, CODEX_HOME: codexHome }, "rotating Codex process", values, authPath))
        .toThrow("Codex auth material changed during rotating Codex process");
      expect(refreshSensitiveJsonValues(authPath, values)).toEqual(expect.arrayContaining(["original-token-123456", "final-token-987654"]));
      expect(containsSensitiveOutput("transient-token-654321", {}, values)).toBe(false);
    } finally {
      fs.closeSync(opened.descriptor);
    }
  });

  it("capture CLI refuses before host launch when the beta boundary is not attestable", () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-cli-boundary-"));
    const boundary = path.join(stage, "boundary.json");
    fs.writeFileSync(boundary, "{}\n");
    const result = spawnSync("npx", [
      "tsx",
      path.resolve(__dirname, "../activated-host-conformance.ts"),
      "capture",
      "--host", "claude-code-cli",
      "--boundary", boundary,
      "--package-root", stage,
      "--consumer-root", `website=${stage}`,
      "--consumer-root", `benchmark=${stage}`,
      "--out-dir", path.join(stage, "out"),
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/migration boundary is invalid/i);
  });

  it("worker CLI writes the production 31-result payload and emits only its challenge plus result digest", () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-worker-cli-"));
    const plugin = path.join(stage, "plugin");
    const website = path.join(stage, "website");
    const benchmark = path.join(stage, "benchmark");
    const out = path.join(stage, "worker.json");
    fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
    fs.cpSync(path.resolve(__dirname, "../../.claude-plugin/plugin.json"), path.join(plugin, ".claude-plugin", "plugin.json"));
    fs.cpSync(path.resolve(__dirname, "../../src/modules"), path.join(plugin, "src", "modules"), { recursive: true });
    fs.mkdirSync(path.join(plugin, "scripts", "lib", "capability"), { recursive: true });
    fs.mkdirSync(path.join(plugin, "hooks", "dist"), { recursive: true });
    fs.cpSync(path.resolve(__dirname, "../lib/capability/compatibility-loader.ts"), path.join(plugin, "scripts", "lib", "capability", "compatibility-loader.ts"));
    fs.cpSync(path.resolve(__dirname, "../activated-host-conformance.ts"), path.join(plugin, "scripts", "activated-host-conformance.ts"));
    fs.writeFileSync(path.join(plugin, "hooks", "dist", "runtime.cjs"), "module.exports = {};\n");
    fs.mkdirSync(path.join(website, "src"), { recursive: true });
    fs.mkdirSync(path.join(benchmark, "src"), { recursive: true });
    fs.writeFileSync(path.join(website, "src", "render.ts"), "export {};\n");
    fs.writeFileSync(path.join(benchmark, "src", "run.ts"), "export {};\n");
    const runtimePackage = snapshotMigrationRuntimePackage(plugin, "claude-code-cli");
    writeActivation(plugin, "claude-code-cli");
    const consumerIdentitiesPath = path.join(stage, "consumer-identities.json");
    fs.writeFileSync(consumerIdentitiesPath, `${JSON.stringify(fixtureConsumerTrees(website, benchmark))}\n`);
    const result = spawnSync("npx", [
      "tsx",
      path.resolve(__dirname, "../activated-host-conformance.ts"),
      "worker",
      "--host", "claude-code-cli",
      "--challenge", CHALLENGE,
      "--source-commit", SOURCE_COMMIT,
      "--package-hash", runtimePackage.tree_sha256,
      "--runtime-version", RUNTIME_VERSION,
      "--host-version", "2.1.236",
      "--platform", PLATFORM,
      "--release", RELEASE,
      "--captured-at", CAPTURED_AT,
      "--plugin-root", plugin,
      "--module-boundary-root", plugin,
      "--consumer-root", `website=${website}`,
      "--consumer-root", `benchmark=${benchmark}`,
      "--consumer-identities", consumerIdentitiesPath,
      "--out", out,
    ], { cwd: path.resolve(__dirname, ".."), encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(`GUILD_ACTIVATED_CONFORMANCE_OK:${CHALLENGE}:RESULT_SHA256:${sha256Hex(fs.readFileSync(out))}`);
    const payload = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(payload).toEqual(expect.objectContaining({ schema_version: ACTIVATED_HOST_WORKER_SCHEMA, ok: true, code: "evaluated", challenge: CHALLENGE, host_id: "claude-code-cli" }));
    expect(payload.evidence.results).toHaveLength(31);
  });

  it("drives the six production owners into one canonical 31-result worker payload", () => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-stage-"));
    const plugin = path.join(stage, "plugin");
    const website = path.join(stage, "website");
    const benchmark = path.join(stage, "benchmark");
    fs.mkdirSync(path.join(plugin, ".claude-plugin"), { recursive: true });
    fs.cpSync(path.resolve(__dirname, "../../.claude-plugin/plugin.json"), path.join(plugin, ".claude-plugin", "plugin.json"));
    fs.cpSync(path.resolve(__dirname, "../../src/modules"), path.join(plugin, "src", "modules"), { recursive: true });
    fs.mkdirSync(path.join(plugin, "scripts", "lib", "capability"), { recursive: true });
    fs.mkdirSync(path.join(plugin, "hooks", "dist"), { recursive: true });
    fs.cpSync(path.resolve(__dirname, "../lib/capability/compatibility-loader.ts"), path.join(plugin, "scripts", "lib", "capability", "compatibility-loader.ts"));
    fs.cpSync(path.resolve(__dirname, "../activated-host-conformance.ts"), path.join(plugin, "scripts", "activated-host-conformance.ts"));
    fs.writeFileSync(path.join(plugin, "hooks", "dist", "runtime.cjs"), "module.exports = {};\n");
    fs.mkdirSync(path.join(website, "src"), { recursive: true });
    fs.mkdirSync(path.join(benchmark, "src"), { recursive: true });
    fs.writeFileSync(path.join(website, "src", "render.ts"), "export {};\n");
    fs.writeFileSync(path.join(benchmark, "src", "run.ts"), "export {};\n");
    const runtimePackage = snapshotMigrationRuntimePackage(plugin, "claude-code-cli");
    writeActivation(plugin, "claude-code-cli");
    const result = runActivatedConformanceWorker({
      hostId: "claude-code-cli",
      challenge: CHALLENGE,
      sourceCommit: SOURCE_COMMIT,
      packageHash: runtimePackage.tree_sha256,
      runtimeVersion: RUNTIME_VERSION,
      hostVersion: "2.1.236",
      platform: PLATFORM,
      release: RELEASE,
      pluginRoot: plugin,
      moduleBoundaryRoot: plugin,
      consumerRoots: { website, benchmark },
      consumerIdentities: fixtureConsumerTrees(website, benchmark),
    });
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "evaluated", marker: `GUILD_ACTIVATED_CONFORMANCE_OK:${CHALLENGE}` }));
    expect(result.evidence?.required_scenario_ids).toEqual([...NEUTRAL_REQUIRED_SUITE_SCENARIO_IDS]);
    expect(result.evidence?.results).toHaveLength(31);
  });

  it("refuses when the worker's own package snapshot changes during owner evaluation", () => {
    const fixture = productionWorkerFixture();
    writeActivation(fixture.plugin, "claude-code-cli");
    const result = runActivatedConformanceWorker({
      hostId: "claude-code-cli",
      challenge: CHALLENGE,
      sourceCommit: SOURCE_COMMIT,
      packageHash: fixture.runtimePackage.tree_sha256,
      runtimeVersion: RUNTIME_VERSION,
      hostVersion: "2.1.236",
      platform: PLATFORM,
      release: RELEASE,
      pluginRoot: fixture.plugin,
      moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
      testOnlyAfterInitialPackageSnapshot: () => {
        fs.appendFileSync(path.join(fixture.plugin, "hooks", "dist", "runtime.cjs"), "// planted drift\n");
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "runtime_package_drift" }));
  });

  it("refuses when a bound consumer tree changes during owner evaluation", () => {
    const fixture = productionWorkerFixture();
    writeActivation(fixture.plugin, "claude-code-cli");
    const result = runActivatedConformanceWorker({
      hostId: "claude-code-cli", challenge: CHALLENGE, sourceCommit: SOURCE_COMMIT,
      packageHash: fixture.runtimePackage.tree_sha256, runtimeVersion: RUNTIME_VERSION,
      hostVersion: "2.1.236", platform: PLATFORM, release: RELEASE,
      pluginRoot: fixture.plugin, moduleBoundaryRoot: fixture.plugin,
      consumerRoots: { website: fixture.website, benchmark: fixture.benchmark },
      consumerIdentities: fixtureConsumerTrees(fixture.website, fixture.benchmark),
      testOnlyAfterInitialConsumerSnapshot: () => {
        fs.appendFileSync(path.join(fixture.website, "src", "render.ts"), "// planted consumer drift\n");
      },
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "consumer_tree_drift" }));
  });

  it.each(["claude-code-cli", "codex-cli"] as const)("accepts a synthetic %s parser fixture bound to an exact package and 31 results", (host) => {
    const { result } = verify(host);
    expect(result).toEqual(expect.objectContaining({ ok: true, code: "verified" }));
  });

  it.each(["claude-code-cli", "codex-cli"] as const)("atomically persists a %s triple that remains independently verifiable after the activated path is removed", (host) => {
    const fixture = packageFixture(host);
    const activatedPath = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-removed-path-"));
    const command = workerCommand(host, fixture.runtimePackage.tree_sha256);
    const rawWorker = workerBytes(host, fixture.runtimePackage);
    const rawTranscript = transcript(host, activatedPath, command, fixture.runtimePackage, rawWorker);
    const value = receipt(host, fixture.runtimePackage, activatedPath, rawTranscript, rawWorker);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-capture-out-"));
    const result = publishActivatedHostEvidence(outDir, host, value.capture_id, rawTranscript, Buffer.from(rawWorker), `${JSON.stringify(value, null, 2)}\n`, []);
    fs.rmSync(activatedPath, { recursive: true, force: true });
    const reloaded = verifyActivatedHostConformanceReceipt({
      receipt: JSON.parse(fs.readFileSync(result.receiptPath, "utf8")),
      transcript: fs.readFileSync(result.transcriptPath, "utf8"),
      workerResult: fs.readFileSync(result.workerPath, "utf8"),
      packageRoot: fixture.root,
      expectedPackage: fixture.runtimePackage,
      expectedSourceCommit: SOURCE_COMMIT,
      expectedRelease: RELEASE,
    });
    expect(reloaded).toEqual(expect.objectContaining({ ok: true, code: "verified" }));
  });

  it.each([2, 3])("rolls back the private staging directory when evidence write %i fails", (failureWrite) => {
    const run = verify("claude-code-cli");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-publish-failure-"));
    const original = fs.writeFileSync;
    let writes = 0;
    const spy = jest.spyOn(fs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      writes += 1;
      if (writes === failureWrite) throw new Error(`planted write ${failureWrite} failure`);
      return original(...args);
    }) as typeof fs.writeFileSync);
    try {
      expect(() => publishActivatedHostEvidence(outDir, "claude-code-cli", run.value.capture_id, run.rawTranscript, Buffer.from(run.rawWorker), `${JSON.stringify(run.value, null, 2)}\n`, [])).toThrow(`planted write ${failureWrite} failure`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("refuses a direct/fabricated receipt when no host command ran", () => {
    const fixture = packageFixture("codex-cli");
    const rawTranscript = `${JSON.stringify({ type: "thread.started", thread_id: "01a0244a-32b4-7d83-a545-23a97a2aba0b" })}\n`;
    const rawWorker = workerBytes("codex-cli", fixture.runtimePackage);
    const value = receipt("codex-cli", fixture.runtimePackage, fixture.root, rawTranscript, rawWorker);
    const result = verifyActivatedHostConformanceReceipt({ receipt: value, transcript: rawTranscript, workerResult: rawWorker, packageRoot: fixture.root, expectedPackage: fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_command_unproven" }));
  });

  it("refuses an installed-but-unloaded Codex transcript with no model-visible Guild skill activation", () => {
    const run = verify("codex-cli");
    const worker = JSON.parse(run.rawWorker);
    worker.host_activation = null;
    const rawWorker = `${JSON.stringify(worker, null, 2)}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.host_activation = null;
    const priorHash = tampered.worker_result_sha256;
    tampered.worker_result_sha256 = sha256Hex(rawWorker);
    const rawTranscript = run.rawTranscript.split(priorHash).join(tampered.worker_result_sha256);
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_activation_unproven" }));
  });

  it("refuses a Codex skill declaration placed before thread.started", () => {
    const run = verify("codex-cli");
    const rows = run.rawTranscript.trim().split("\n").map((line: string) => JSON.parse(line));
    const probeIndex = rows.findIndex((row: any) => row.type === "item.completed" && row.item?.id === "item-probe");
    const threadIndex = rows.findIndex((row: any) => row.type === "thread.started");
    const [probe] = rows.splice(probeIndex, 1);
    rows.splice(threadIndex, 0, probe);
    const rawTranscript = `${rows.map((row: any) => JSON.stringify(row)).join("\n")}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_activation_unproven" }));
  });

  it("refuses a Claude beta SessionStart receipt that falsely claims stable/main", () => {
    const run = verify("claude-code-cli");
    const bad: any = activation("claude-code-cli");
    (bad.receipt as any).channel = "stable";
    (bad.receipt as any).ref = "main";
    (bad.receipt as any).channel_confidence = "assumed-default";
    bad.sha256 = sha256Hex(`${JSON.stringify(bad.receipt, null, 2)}\n`);
    const worker = JSON.parse(run.rawWorker);
    worker.host_activation = bad;
    const rawWorker = `${JSON.stringify(worker, null, 2)}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.host_activation = bad;
    const priorHash = tampered.worker_result_sha256;
    tampered.worker_result_sha256 = sha256Hex(rawWorker);
    const rawTranscript = run.rawTranscript.split(priorHash).join(tampered.worker_result_sha256);
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_activation_unproven" }));
  });

  it("refuses a planted honest 5/31 result set", () => {
    const run = verify("claude-code-cli");
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.evidence.results = tampered.evidence.results.slice(0, 5);
    tampered.evidence.required_scenario_ids = tampered.evidence.required_scenario_ids.slice(0, 5);
    const worker = JSON.parse(run.rawWorker);
    worker.evidence = tampered.evidence;
    const rawWorker = `${JSON.stringify(worker, null, 2)}\n`;
    const priorHash = tampered.worker_result_sha256;
    tampered.worker_result_sha256 = sha256Hex(rawWorker);
    const rawTranscript = run.rawTranscript.split(priorHash).join(tampered.worker_result_sha256);
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "scenario_coverage_incomplete" }));
  });

  it("refuses transcript tamper even when the semantic command remains visible", () => {
    const run = verify("codex-cli");
    const result = verifyActivatedHostConformanceReceipt({ receipt: run.value, transcript: `${run.rawTranscript} \n`, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "transcript_hash_mismatch" }));
  });

  it("refuses a Claude result whose tool_use_id does not match the exact command", () => {
    const run = verify("claude-code-cli");
    const rows = run.rawTranscript.trim().split("\n").map((line: string) => JSON.parse(line));
    rows[2].message.content[0].tool_use_id = "tool-attacker";
    const rawTranscript = `${rows.map((row: unknown) => JSON.stringify(row)).join("\n")}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_command_unproven" }));
  });

  it("refuses an additional Codex command even when both commands report success", () => {
    const run = verify("codex-cli");
    const rows = run.rawTranscript.trim().split("\n").map((line: string) => JSON.parse(line));
    const command = rows.find((row: any) => row.type === "item.completed" && row.item?.type === "command_execution");
    rows.splice(rows.length - 2, 0, { ...command, item: { ...command.item, id: "item-attacker" } });
    const rawTranscript = `${rows.map((row: unknown) => JSON.stringify(row)).join("\n")}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_command_unproven" }));
  });

  it("refuses worker-result substitution even when the receipt and transcript are unchanged", () => {
    const run = verify("codex-cli");
    const result = verifyActivatedHostConformanceReceipt({ receipt: run.value, transcript: run.rawTranscript, workerResult: `${run.rawWorker} `, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "worker_result_hash_mismatch" }));
  });

  it("refuses a package containing a planted symlink before host execution", () => {
    const fixture = packageFixture("claude-code-cli");
    fs.symlinkSync("scripts/activated-host-conformance.ts", path.join(fixture.root, "planted-link"));
    const result = captureActivatedHostConformance({
      hostId: "claude-code-cli", packageRoot: fixture.root, expectedPackage: fixture.runtimePackage,
      sourceCommit: SOURCE_COMMIT, release: RELEASE, platform: PLATFORM,
      capturedAt: CAPTURED_AT, challenge: CHALLENGE, consumerRoots: { website: fixture.root, benchmark: fixture.root },
      outDir: fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-symlink-out-")),
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "capture_error" }));
  });

  it("refuses to persist a host transcript containing allowlisted authentication material", () => {
    expect(containsSensitiveOutput(
      "model echoed sk-sentinel-activated-host-secret",
      { OPENAI_API_KEY: "sk-sentinel-activated-host-secret" },
    )).toBe(true);
  });

  it.each(["transcript", "worker", "receipt"] as const)("refuses a copied-auth secret in the final %s artifact", (artifact) => {
    const run = verify("codex-cli");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-secret-publication-"));
    const secret = "copied-auth-secret-123456";
    const transcriptBytes = artifact === "transcript" ? `${run.rawTranscript}${secret}` : run.rawTranscript;
    const workerBytes = Buffer.from(artifact === "worker" ? `${run.rawWorker}${secret}` : run.rawWorker);
    const receiptBytes = artifact === "receipt" ? `${JSON.stringify(run.value)}${secret}` : `${JSON.stringify(run.value)}\n`;
    expect(() => publishActivatedHostEvidence(outDir, "codex-cli", run.value.capture_id, transcriptBytes, workerBytes, receiptBytes, [secret]))
      .toThrow("artifact contained authentication material");
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it.each([4, 5])("does not report a published capture when directory fsync %i fails", (failureFsync) => {
    const run = verify("claude-code-cli");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-fsync-failure-"));
    const original = fs.fsyncSync;
    let calls = 0;
    const spy = jest.spyOn(fs, "fsyncSync").mockImplementation(((descriptor: number) => {
      calls += 1;
      if (calls === failureFsync) throw new Error(`planted fsync ${failureFsync} failure`);
      return original(descriptor);
    }) as typeof fs.fsyncSync);
    try {
      expect(() => publishActivatedHostEvidence(outDir, "claude-code-cli", run.value.capture_id, run.rawTranscript, Buffer.from(run.rawWorker), `${JSON.stringify(run.value)}\n`, []))
        .toThrow(`planted fsync ${failureFsync} failure`);
    } finally {
      spy.mockRestore();
    }
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  it("refuses an absent output root instead of returning before its parent entry is durable", () => {
    const run = verify("claude-code-cli");
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activated-absent-output-parent-"));
    const outDir = path.join(parent, "not-created-by-publisher");
    expect(() => publishActivatedHostEvidence(outDir, "claude-code-cli", run.value.capture_id, run.rawTranscript, Buffer.from(run.rawWorker), `${JSON.stringify(run.value)}\n`, []))
      .toThrow("output root must already exist as a durable physical directory");
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("executes the pinned open host descriptor after a pathname swap", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-descriptor-"));
    const executable = path.join(bin, "codex");
    const companion = path.join(bin, "codex-code-mode-host");
    fs.writeFileSync(executable, "#!/bin/sh\nprintf original-pinned-host\n", { mode: 0o755 });
    fs.writeFileSync(companion, "#!/bin/sh\nprintf original-pinned-companion\n", { mode: 0o755 });
    const sealRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-descriptor-seal-"));
    const opened = openHostExecutable("codex-cli", { PATH: bin }, sealRoot);
    try {
      fs.renameSync(executable, `${executable}.original`);
      fs.writeFileSync(executable, "#!/bin/sh\nprintf attacker-path-host\n", { mode: 0o755 });
      fs.writeFileSync(companion, "#!/bin/sh\nprintf attacker-path-companion\n", { mode: 0o755 });
      const result = spawnOpenExecutable("codex-cli", opened, [], { timeout: 30_000, env: { PATH: process.env.PATH } });
      expect(result).toEqual(expect.objectContaining({ status: 0, stdout: "original-pinned-host" }));
      expect(opened.identity.companions).toEqual([expect.objectContaining({ name: "codex-code-mode-host" })]);
      expect(spawnSync(path.join(sealRoot, "codex-code-mode-host"), [], { encoding: "utf8" }).stdout).toBe("original-pinned-companion");
    } finally {
      fs.closeSync(opened.descriptor);
    }
  });

  it("executes only a private sealed worker/runtime copy after source replacement", () => {
    const fixture = packageFixture("codex-cli");
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sealed-worker-"));
    const fakeNode = path.join(stageRoot, "fixture-node-source");
    fs.writeFileSync(fakeNode, "#!/bin/sh\nprintf sealed-node\n", { mode: 0o755 });
    const sealed = sealActivatedWorkerRuntime(stageRoot, fixture.root, fixture.runtimePackage, fakeNode);
    const workerBefore = fs.readFileSync(sealed.workerPath);
    fs.writeFileSync(path.join(fixture.root, "scripts", "dist", "activated-host-conformance.js"), "console.log('attacker');\n");
    fs.writeFileSync(fakeNode, "#!/bin/sh\nprintf attacker-node\n", { mode: 0o755 });
    expect(fs.readFileSync(sealed.workerPath)).toEqual(workerBefore);
    expect(spawnSync(sealed.nodePath, [], { encoding: "utf8" }).stdout).toBe("sealed-node");
  });

  it("removes ambient Codex skill-discovery roots from the activated environment", () => {
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-isolated-discovery-"));
    const ambientHome = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-ambient-home-"));
    const ambientSkill = path.join(ambientHome, ".agents", "skills", "guild", "meta", "verify-done", "SKILL.md");
    fs.mkdirSync(path.dirname(ambientSkill), { recursive: true });
    fs.writeFileSync(ambientSkill, "---\nname: guild-verify-done\ndescription: attacker collision\n---\n");
    const environment = isolatedCodexEnvironment(stageRoot, path.join(stageRoot, "codex-home"), path.join(stageRoot, "installed"), { HOME: ambientHome, PATH: process.env.PATH });
    expect(environment.HOME).toBe(path.join(stageRoot, "isolated-home"));
    expect(environment.HOME).not.toBe(ambientHome);
    expect(environment.XDG_CONFIG_HOME).toBe(path.join(stageRoot, "xdg", "config"));
    expect(fs.existsSync(path.join(environment.HOME!, ".agents", "skills", "guild", "meta", "verify-done", "SKILL.md"))).toBe(false);
  });

  it("keeps a package-local probe skill outside the empty Codex execution workspace", () => {
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-empty-workspace-"));
    const packageRoot = path.join(stageRoot, "installed-plugin");
    const probe = path.join(packageRoot, ".agents", "skills", "guild", "meta", "verify-done", "SKILL.md");
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, "---\nname: guild-verify-done\ndescription: package-local collision\n---\n");
    const workspace = codexExecutionWorkspace(stageRoot, packageRoot);
    expect(workspace).not.toBe(packageRoot);
    expect(fs.readdirSync(workspace)).toEqual([]);
    expect(fs.existsSync(path.join(workspace, ".agents", "skills", "guild", "meta", "verify-done", "SKILL.md"))).toBe(false);
    expect(fs.existsSync(probe)).toBe(true);
  });

  it("keeps consumer fixtures outside the Codex plugin version cache", () => {
    expect(typeof activatedConsumerRoots).toBe("function");
    if (typeof activatedConsumerRoots !== "function") return;
    const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-consumer-roots-"));
    const packageRoot = path.join(stageRoot, "codex-home", "plugins", "cache", "guild-activated-capture", "guild", RELEASE);
    const website = path.join(stageRoot, "website");
    const benchmark = path.join(stageRoot, "benchmark");
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(website);
    fs.mkdirSync(benchmark);
    const roots = activatedConsumerRoots("codex-cli", stageRoot, packageRoot, website, benchmark);
    expect(roots).toEqual({ website: fs.realpathSync(website), benchmark: fs.realpathSync(benchmark) });
    for (const root of Object.values(roots) as string[]) {
      const relativeToCache = path.relative(path.dirname(packageRoot), root);
      expect(relativeToCache.startsWith("..") || path.isAbsolute(relativeToCache)).toBe(true);
    }
  });

  it("refuses toy consumer roots that are not the official Git worktrees", () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "guild-toy-consumer-source-"));
    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-toy-consumer-stage-")), "website");
    fs.writeFileSync(path.join(source, "toy.ts"), "export {};\n");
    expect(() => snapshotOfficialConsumerGitTree("website", source, destination)).toThrow("must be an official Git worktree");
    expect(fs.existsSync(destination)).toBe(false);
  });

  it("binds a resolved host executable path and detects byte replacement", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-executable-"));
    const executable = path.join(bin, "codex");
    fs.writeFileSync(executable, "#!/bin/sh\necho codex-cli 0.147.0\n", { mode: 0o755 });
    const before = snapshotHostExecutable("codex-cli", { PATH: bin });
    fs.appendFileSync(executable, "# planted replacement\n");
    const after = snapshotHostExecutable("codex-cli", { PATH: bin });
    expect(before.path).toBe(fs.realpathSync(executable));
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.size).not.toBe(before.size);
  });

  it("refuses a substituted Codex enabled-plugin identity", () => {
    const run = verify("codex-cli");
    const rows = run.rawTranscript.trim().split("\n").map((line: string) => JSON.parse(line));
    const activationRow = rows.find((row: any) => row.type === "guild.codex_plugin_activation");
    activationRow.list_entry.pluginId = "other@guild-activated-capture";
    const rawTranscript = `${rows.map((row: unknown) => JSON.stringify(row)).join("\n")}\n`;
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.transcript_sha256 = sha256Hex(rawTranscript);
    const { capture_id: _old, ...withoutId } = tampered;
    tampered.capture_id = activatedHostCaptureId(withoutId);
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "host_activation_unproven" }));
  });

  it("refuses package drift after the host run", () => {
    const run = verify("claude-code-cli");
    fs.appendFileSync(path.join(run.fixture.root, "scripts", "activated-host-conformance.ts"), "// drift\n");
    const result = verifyActivatedHostConformanceReceipt({ receipt: run.value, transcript: run.rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "runtime_package_mismatch" }));
  });

  it("refuses a capture id that was not recomputed after evidence tamper", () => {
    const run = verify("codex-cli");
    const tampered = JSON.parse(JSON.stringify(run.value));
    tampered.evidence.results[0].disposition = "failed";
    const result = verifyActivatedHostConformanceReceipt({ receipt: tampered, transcript: run.rawTranscript, workerResult: run.rawWorker, packageRoot: run.fixture.root, expectedPackage: run.fixture.runtimePackage, expectedSourceCommit: SOURCE_COMMIT, expectedRelease: RELEASE });
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "capture_id_mismatch" }));
  });
});
