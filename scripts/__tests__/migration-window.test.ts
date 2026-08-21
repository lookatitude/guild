import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createMigrationBoundary, createMigrationObservation, writeMigrationBoundary, writeMigrationObservation } from "../lib/capability/migration-evidence";
import { MIGRATION_TRANSITION_RELPATH, MIGRATION_WINDOW_RELPATH, MIGRATION_WINDOW_SCHEMA, advanceMigrationWindow, evaluateMigrationAdvance, inspectMigrationWindow, legacyRemovalEligibility, readMigrationWindow, recordMigrationRelease, recoverMigrationTransition, startMigrationWindow, validateMigrationWindow } from "../lib/capability/migration-window";
import { readCompatibilityAsset } from "../lib/capability/compatibility-loader";
import { baselineBinding, emitCapabilityProfile, snapshotTreeHashes } from "../lib/capability/profile-emit";
import { readFeatureGateRegistry } from "../lib/capability/strangler-control";
import { sealReceiptRecord } from "../../src/modules/telemetry/workflows/receipt-journal";

let mockGhFailure = false;
let mockGhSourceDigest = "";
jest.mock("node:child_process", () => {
  const actual = jest.requireActual("node:child_process") as typeof import("node:child_process");
  return {
    ...actual,
    execFileSync: jest.fn((file: string, args: readonly string[], options: unknown) => {
      if (file !== "gh") return actual.execFileSync(file, args as string[], options as never);
      if (mockGhFailure) throw new Error("planted attestation refusal");
      if (args[0] === "api") return `HTTP/2.0 200 OK\ndate: Fri, 21 Aug 2026 09:00:00 GMT\n\n${JSON.stringify({ head_sha: mockGhSourceDigest, head_branch: "next", event: "push", status: "completed", conclusion: "success" })}`;
      const sourceIndex = args.indexOf("--source-digest");
      mockGhSourceDigest = sourceIndex >= 0 ? args[sourceIndex + 1] : "";
      return JSON.stringify([{ verificationResult: { statement: { predicateType: "https://slsa.dev/provenance/v1" } } }]);
    }),
  };
});

const git = (root: string, ...args: string[]): string => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function boundaryFixture(version: string, pushedAt: number) {
  const root = mkdtempSync(join(tmpdir(), "guild-window-boundary-repo-"));
  const eventPath = join(root, "push.json");
  git(root, "init", "-q", "-b", "next");
  git(root, "config", "user.name", "Guild Test");
  git(root, "config", "user.email", "guild@example.invalid");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "scripts/lib/capability"), { recursive: true });
  const claudeManifest = `${JSON.stringify({ name: "guild", version })}\n`;
  const codexManifest = `${JSON.stringify({ name: "guild", version, host: "codex" })}\n`;
  writeFileSync(join(root, ".claude-plugin/plugin.json"), claudeManifest);
  writeFileSync(join(root, ".codex-plugin/plugin.json"), codexManifest);
  writeFileSync(join(root, "payload.txt"), `${version}\n`);
  writeFileSync(join(root, "scripts/lib/capability/compatibility-loader.ts"), "// runtime producer\n");
  git(root, "add", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "scripts/lib/capability/compatibility-loader.ts", "payload.txt");
  git(root, "commit", "-qm", version);
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/next", commit);
  writeFileSync(eventPath, `${JSON.stringify({ ref: "refs/heads/next", after: commit, repository: { full_name: "lookatitude/guild", pushed_at: pushedAt }, head_commit: { id: commit, timestamp: new Date((pushedAt - 60) * 1000).toISOString() } })}\n`);
  const claudePackageRoot = join(root, "runtime-packages", "claude-code");
  const codexPackageRoot = join(root, "runtime-packages", "codex");
  const assetPath = "templates/specialists/researcher.md";
  mkdirSync(dirname(join(claudePackageRoot, assetPath)), { recursive: true });
  mkdirSync(join(claudePackageRoot, "scripts/lib/capability"), { recursive: true });
  mkdirSync(join(claudePackageRoot, ".claude-plugin"), { recursive: true });
  mkdirSync(join(codexPackageRoot, ".codex-plugin"), { recursive: true });
  mkdirSync(join(codexPackageRoot, "scripts/lib/capability"), { recursive: true });
  writeFileSync(join(claudePackageRoot, assetPath), "# researcher\n");
  writeFileSync(join(claudePackageRoot, "scripts/lib/capability/compatibility-loader.ts"), "// runtime producer\n");
  writeFileSync(join(claudePackageRoot, ".claude-plugin/plugin.json"), claudeManifest);
  writeFileSync(join(codexPackageRoot, ".codex-plugin/plugin.json"), codexManifest);
  writeFileSync(join(codexPackageRoot, "scripts/lib/capability/compatibility-loader.ts"), "// runtime producer\n");
  const boundary = createMigrationBoundary({ pluginRoot: root, claudePackageRoot, codexPackageRoot, eventPath, repository: "lookatitude/guild", runId: String(pushedAt), runAttempt: 1 });
  return { root, claudePackageRoot, codexPackageRoot, boundary, boundaryPath: writeMigrationBoundary(join(root, "boundaries"), boundary) };
}

function projectSourceCommit(projectRoot: string): string {
  if (!existsSync(join(projectRoot, ".git"))) {
    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.name", "Guild Test");
    git(projectRoot, "config", "user.email", "guild@example.invalid");
    git(projectRoot, "commit", "--allow-empty", "-qm", "project evidence baseline");
    return git(projectRoot, "rev-parse", "HEAD");
  }
  return git(projectRoot, "rev-parse", "HEAD");
}

function observationFixture(projectRoot: string, fixture: ReturnType<typeof boundaryFixture>, runId: string, synthetic = false, mode: "observe" | "shadow" = "observe", generatedAt?: string, sourceCommit: string | null = projectSourceCommit(projectRoot), tamperRuntimeBinding?: "host" | "tree") {
  const pluginRoot = fixture.claudePackageRoot;
  const assetPath = "templates/specialists/researcher.md";
  const assetBytes = Buffer.from("# researcher\n");
  const baseline = snapshotTreeHashes(projectRoot)!;
  const emitted = emitCapabilityProfile({
    projectRoot, runId, projectId: "fx-project", generatedAt: generatedAt ?? fixture.boundary.merged_at, sourceCommit, resolverMode: mode,
    facts: { domains: [], boundaries: [], repeated_methods: [], coverage: { covered: [], uncovered: [], unmatched_roles: [] }, candidates: [] },
    baselineHashes: { ...baseline, bound_root: baselineBinding(projectRoot)!, bound_run_id: runId },
  });
  expect(emitted.status).toBe("emitted");
  const loaded = readCompatibilityAsset({
    pluginRoot, runtimeHost: "claude-code-cli", projectRoot,
    entry: { kind: "shipped_template", id: "researcher", path: assetPath, content_hash: createHash("sha256").update(assetBytes).digest("hex"), deprecation: "deprecated", deprecated_by: "cap-loc-D03" },
    mode, intent: mode === "shadow" ? "shadow_compare" : "dispatch", synthetic, specialistId: null, runId, operationId: `migration-${mode}`, recordedAt: generatedAt ?? fixture.boundary.merged_at,
  });
  expect(loaded.status).toBe("loaded");
  if (tamperRuntimeBinding) {
    const journalPath = join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl");
    const record = JSON.parse(readFileSync(journalPath, "utf8"));
    record.versions[tamperRuntimeBinding === "host" ? "host_id" : "source_version"] = tamperRuntimeBinding === "host" ? "codex-cli" : `sha256:${"0".repeat(64)}`;
    const { record_hash: _recordHash, schema_version: _schemaVersion, ...body } = record;
    writeFileSync(journalPath, `${JSON.stringify(sealReceiptRecord(body))}\n`);
  }
  const observation = createMigrationObservation({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, boundaryPath: fixture.boundaryPath, projectId: "fx-project", mode, runIds: [runId] });
  const observationPath = writeMigrationObservation(join(fixture.root, "observations", runId), observation);
  return { observation, observationPath };
}

describe("D03 evidence-bound migration window", () => {
  it("removes the caller-asserted time and conformance flags from the CLI", () => {
    const cli = join(__dirname, "..", "capability-adopt.ts");
    const tsx = join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [tsx, cli, "window", "advance", "--boundary", "b.json", "--to", "shadow", "--at", "2026-09-04T00:00:00Z", "--conformance-pass"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown window option.*--at.*--conformance-pass/i);
    const prototypeAction = spawnSync(process.execPath, [tsx, cli, "window", "toString", "--project-root", "/tmp/x"], { encoding: "utf8" });
    expect(prototypeAction.status).toBe(1);
    expect(prototypeAction.stderr).toContain("capability-adopt — project capability adoption migration");
  });

  it("starts only from a boundary paired with real non-synthetic whole-run evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const window = startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      expect(window.schema_version).toBe(MIGRATION_WINDOW_SCHEMA);
      expect(window.entered_at).toBe("2026-08-21T09:00:00.000Z");
      expect(window.entry_boundary).toEqual(fixture.boundary);
      expect(window.releases).toEqual([]);
      expect(window.observations).toEqual([]);
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-beta2", false, "observe", "2026-08-21T09:00:00.000Z");
      expect(recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath }).observations).toEqual([evidence.observation]);
      expect(readFeatureGateRegistry(projectRoot)?.resolver_mode).toBe("observe");
      const ghCalls = (execFileSync as jest.MockedFunction<typeof execFileSync>).mock.calls.filter(([file]) => file === "gh");
      expect(ghCalls.some(([, args]) => (args as string[]).includes("--signer-workflow") && (args as string[]).includes("--source-digest") && (args as string[]).includes("--deny-self-hosted-runners"))).toBe(true);
      expect(ghCalls.every(([, args]) => (args as string[]).includes("--hostname") && (args as string[]).includes("github.com"))).toBe(true);
      expect(ghCalls.every(([, , options]) => (options as { env?: NodeJS.ProcessEnv }).env?.GH_HOST === "github.com" && (options as { env?: NodeJS.ProcessEnv }).env?.GH_ENTERPRISE_TOKEN === undefined)).toBe(true);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses evidence produced before observe actually began", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const preproduced = observationFixture(projectRoot, fixture, "run-20260821-080000-preproduced");
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: preproduced.observationPath })).toThrow(/predates entry/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("retains verified evidence independently of normal run rotation", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-retained";
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z");
      rmSync(join(projectRoot, ".guild", "runs", runId), { recursive: true, force: true });
      recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath });
      expect(readMigrationWindow(projectRoot)?.observations).toEqual([evidence.observation]);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a runtime package whose bytes differ from the attested host build", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      writeFileSync(join(fixture.claudePackageRoot, "scripts/lib/capability/compatibility-loader.ts"), "// modified runtime producer\n");
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-wrong-build", false, "observe", "2026-08-21T09:00:00.000Z")).toThrow(/runtime package.*attested/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("accepts an attested install surface with installer receipts and unrelated symlinks outside that surface", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      writeFileSync(join(fixture.claudePackageRoot, "guild-install-receipt.json"), "{}\n");
      mkdirSync(join(fixture.claudePackageRoot, "scripts/node_modules/.bin"), { recursive: true });
      symlinkSync(process.execPath, join(fixture.claudePackageRoot, "scripts/node_modules/.bin/node"));
      expect(observationFixture(projectRoot, fixture, "run-20260821-090000-installed", false, "observe", "2026-08-21T09:00:00.000Z").observation.runtime_package.tree_sha256).toBe(fixture.boundary.packages["claude-code-cli"].tree_sha256);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each(["host", "tree"] as const)("refuses a PCL-09 receipt whose runtime %s is detached from the attested package", (binding) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, `run-20260821-090000-wrong-${binding}`, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), binding)).toThrow(/no non-synthetic/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a whole-run profile without a project source commit", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-null-source", false, "observe", "2026-08-21T09:00:00.000Z", null)).toThrow(/whole-run observe profile/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a self-consistent boundary without GitHub attestation provenance", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      mockGhFailure = true;
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/GitHub provenance verification failed/i);
    } finally {
      mockGhFailure = false;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("reverifies every persisted boundary before trusting recovered window state", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      expect(readMigrationWindow(projectRoot)?.entry_boundary).toEqual(fixture.boundary);
      mockGhFailure = true;
      expect(readMigrationWindow(projectRoot)).toBeNull();
      expect(inspectMigrationWindow(projectRoot)).toEqual(expect.objectContaining({ status: "provenance_unavailable", detail: expect.stringMatching(/GitHub provenance verification failed/i) }));
    } finally {
      mockGhFailure = false;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("reports provenance outages explicitly during record and advance", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-outage", false, "observe", "2026-08-21T09:00:00.000Z");
      mockGhFailure = true;
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath })).toThrow(/provenance verification failed/i);
      expect(advanceMigrationWindow({ projectRoot, to: "shadow", boundaryPath: fixture.boundaryPath, actor: "operator" })).toEqual(expect.objectContaining({ status: "refused", blockers: [expect.stringMatching(/verification failed.*provenance/i)] }));
    } finally {
      mockGhFailure = false;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("binds every observation to the project that opened the migration window", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "different-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-wrong-project", false, "observe", "2026-08-21T09:00:00.000Z");
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath })).toThrow(/does not match window project/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("cannot skip observe or overwrite a corrupt existing timer", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "shadow", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/must enter at observe/i);
      const timer = join(projectRoot, ".guild/artifacts/capability/migration-window.json");
      mkdirSync(dirname(timer), { recursive: true });
      writeFileSync(timer, "{broken\n");
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/already exists or is invalid/i);
      expect(readFileSync(timer, "utf8")).toBe("{broken\n");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("reports an invalid state file distinctly from an absent window", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    try {
      const timer = join(projectRoot, ".guild/artifacts/capability/migration-window.json");
      mkdirSync(dirname(timer), { recursive: true });
      writeFileSync(timer, "{broken\n");
      const cli = join(__dirname, "..", "capability-adopt.ts");
      const tsx = join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
      const result = spawnSync(process.execPath, [tsx, cli, "window", "status", "--project-root", projectRoot], { encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toEqual({ status: "invalid_or_recovery_required" });
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("recovers a crash after both transition targets landed but before intent cleanup", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const unlink = jest.spyOn(require("node:fs"), "unlinkSync").mockImplementationOnce(() => { throw new Error("planted cleanup crash"); });
    try {
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/planted cleanup crash/i);
      expect(readFileSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH), "utf8")).toContain("guild.capability_migration_transition.v1");
      unlink.mockRestore();
      expect(recoverMigrationTransition(projectRoot)).toBe(true);
      expect(readMigrationWindow(projectRoot)?.mode).toBe("observe");
      expect(readFeatureGateRegistry(projectRoot)?.resolver_mode).toBe("observe");
    } finally {
      unlink.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("discards a start intent when neither changed target landed", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const canonical = (value: any): string => Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : value !== null && typeof value === "object"
        ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
        : JSON.stringify(value);
    try {
      const window = startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const gates = readFeatureGateRegistry(projectRoot)!;
      rmSync(join(projectRoot, MIGRATION_WINDOW_RELPATH));
      const candidate = { schema_version: "guild.capability_migration_transition.v1", operation: "start", prior_window: null, prior_gates: gates, next_window: window, next_gates: gates };
      const intent = { ...candidate, intent_hash: createHash("sha256").update(canonical(candidate)).digest("hex") };
      writeFileSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH), `${JSON.stringify(intent, null, 2)}\n`);
      expect(recoverMigrationTransition(projectRoot)).toBe(false);
      expect(existsSync(join(projectRoot, MIGRATION_WINDOW_RELPATH))).toBe(false);
      expect(existsSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses a correctly self-hashed transition whose successor semantics were forged", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const unlink = jest.spyOn(require("node:fs"), "unlinkSync").mockImplementationOnce(() => { throw new Error("planted cleanup crash"); });
    const canonical = (value: any): string => Array.isArray(value)
      ? `[${value.map(canonical).join(",")}]`
      : value !== null && typeof value === "object"
        ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
        : JSON.stringify(value);
    try {
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/planted cleanup crash/i);
      unlink.mockRestore();
      const intentPath = join(projectRoot, MIGRATION_TRANSITION_RELPATH);
      const intent = JSON.parse(readFileSync(intentPath, "utf8"));
      intent.next_gates.revision += 7;
      const { intent_hash: _intentHash, ...body } = intent;
      intent.intent_hash = createHash("sha256").update(canonical(body)).digest("hex");
      writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
      expect(() => recoverMigrationTransition(projectRoot)).toThrow(/exact successor/i);
      expect(readFeatureGateRegistry(projectRoot)?.revision).toBe(0);
    } finally {
      unlink.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses synthetic-only evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try { expect(() => observationFixture(projectRoot, fixture, "run-20260821-080000-synthetic", true)).toThrow(/no non-synthetic/i); }
    finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("counts only a strictly newer beta boundary with matching evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const same = boundaryFixture("2.7.0-beta.2", 1787385600);
    const next = boundaryFixture("2.7.0-beta.3", 1787385600);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: first.boundaryPath, actor: "operator" });
      const firstEvidence = observationFixture(projectRoot, first, "run-20260821-090000-beta2", false, "observe", "2026-08-21T09:00:00.000Z");
      recordMigrationRelease({ projectRoot, boundaryPath: first.boundaryPath, observationPath: firstEvidence.observationPath });
      const sameEvidence = observationFixture(projectRoot, same, "run-20260822-080000-same");
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: same.boundaryPath, observationPath: sameEvidence.observationPath })).toThrow(/strictly newer/i);
      const nextEvidence = observationFixture(projectRoot, next, "run-20260822-080000-beta3");
      const recorded = recordMigrationRelease({ projectRoot, boundaryPath: next.boundaryPath, observationPath: nextEvidence.observationPath });
      expect(recorded.releases.map((entry) => entry.release)).toEqual(["2.7.0-beta.2", "2.7.0-beta.3"]);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); for (const f of [first, same, next]) rmSync(f.root, { recursive: true, force: true }); }
  });

  it("rejects tampered evidence and derives time and conformance without caller assertions", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const second = boundaryFixture("2.7.0-beta.3", 1787904000);
    const third = boundaryFixture("2.7.0-beta.4", 1788508800);
    const earlyAdvance = boundaryFixture("2.7.0-beta.5", 1787299200 + 13 * 86_400);
    const advance = boundaryFixture("2.7.0-beta.5", 1788508800 + 14 * 86_400);
    try {
      const observations = [
        observationFixture(projectRoot, first, "run-20260821-080000-beta2").observation,
        observationFixture(projectRoot, second, "run-20260828-080000-beta3").observation,
        observationFixture(projectRoot, third, "run-20260904-080000-beta4").observation,
      ];
      const window = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, project_id: "fx-project", mode: "observe", entered_at: first.boundary.merged_at, entry_boundary: first.boundary, releases: [first.boundary, second.boundary, third.boundary], observations, completed_phases: [], actor: "operator" })!;
      expect(evaluateMigrationAdvance(window, "shadow", advance.boundary).passed).toBe(true);
      expect(evaluateMigrationAdvance(window, "shadow", advance.boundary).conformance).toEqual(expect.objectContaining({ schema_version: "guild.capability_migration_advance_conformance.v1", decision: "passed" }));
      expect(evaluateMigrationAdvance(window, "shadow", earlyAdvance.boundary).blockers).toContain("need >=14 days in observe");
      const tampered = JSON.parse(JSON.stringify(window));
      tampered.observations[0].runs[0].profile.sha256 = "0".repeat(64);
      expect(validateMigrationWindow(tampered)).toBeNull();
      const preEntryEvidence = JSON.parse(JSON.stringify(window));
      preEntryEvidence.entered_at = second.boundary.merged_at;
      expect(validateMigrationWindow(preEntryEvidence)).toBeNull();
      const undersoaked = {
        schema_version: MIGRATION_WINDOW_SCHEMA,
        project_id: "fx-project",
        mode: "shadow",
        entered_at: advance.boundary.merged_at,
        entry_boundary: advance.boundary,
        releases: [],
        observations: [],
        completed_phases: [{ mode: "observe", entered_at: first.boundary.merged_at, releases: [first.boundary], observations: [observations[0]], advanced_with: second.boundary }],
        actor: "operator",
      };
      expect(validateMigrationWindow(undersoaked)).toBeNull();
    } finally { rmSync(projectRoot, { recursive: true, force: true }); for (const f of [first, second, third, earlyAdvance, advance]) rmSync(f.root, { recursive: true, force: true }); }
  });

  it("advances observe through shadow to project-local and strict without deleting prior evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixtures = [
      boundaryFixture("2.7.0-beta.2", 1787299200),
      boundaryFixture("2.7.0-beta.3", 1787904000),
      boundaryFixture("2.7.0-beta.4", 1788508800),
      boundaryFixture("2.7.0-beta.5", 1788508800 + 14 * 86_400),
      boundaryFixture("2.7.0-beta.6", 1788508800 + 21 * 86_400),
      boundaryFixture("2.7.0-beta.7", 1788508800 + 28 * 86_400),
      boundaryFixture("2.7.0-beta.8", 1788508800 + 42 * 86_400),
      boundaryFixture("2.7.0-beta.9", 1788508800 + 49 * 86_400),
    ];
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixtures[0].boundaryPath, actor: "operator" });
      const first = observationFixture(projectRoot, fixtures[0], "run-20260821-090000-observe2", false, "observe", "2026-08-21T09:00:00.000Z");
      recordMigrationRelease({ projectRoot, boundaryPath: fixtures[0].boundaryPath, observationPath: first.observationPath });
      for (let index = 1; index <= 2; index += 1) {
        const evidence = observationFixture(projectRoot, fixtures[index], `run-${index === 1 ? "20260828" : "20260904"}-080000-observe${index + 2}`);
        recordMigrationRelease({ projectRoot, boundaryPath: fixtures[index].boundaryPath, observationPath: evidence.observationPath });
      }
      expect(advanceMigrationWindow({ projectRoot, to: "shadow", boundaryPath: fixtures[3].boundaryPath, actor: "operator" }).status).toBe("advanced");
      const shadowEntry = observationFixture(projectRoot, fixtures[3], "run-20260918-080000-shadow5", false, "shadow");
      recordMigrationRelease({ projectRoot, boundaryPath: fixtures[3].boundaryPath, observationPath: shadowEntry.observationPath });
      for (let index = 4; index <= 5; index += 1) {
        const evidence = observationFixture(projectRoot, fixtures[index], `run-2026100${index}-080000-shadow${index + 2}`, false, "shadow");
        recordMigrationRelease({ projectRoot, boundaryPath: fixtures[index].boundaryPath, observationPath: evidence.observationPath });
      }
      expect(advanceMigrationWindow({ projectRoot, to: "project-local", boundaryPath: fixtures[6].boundaryPath, actor: "operator" }).status).toBe("advanced");
      expect(advanceMigrationWindow({ projectRoot, to: "strict", boundaryPath: fixtures[7].boundaryPath, actor: "operator" }).status).toBe("advanced");
      const final = readMigrationWindow(projectRoot)!;
      expect(final.mode).toBe("strict");
      expect(final.completed_phases.map((phase) => phase.mode)).toEqual(["observe", "shadow"]);
      expect(final.completed_phases.flatMap((phase) => phase.observations)).toHaveLength(6);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); for (const fixture of fixtures) rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("never clears v2 and enforces both G5 and the two-minor floor", () => {
    expect(legacyRemovalEligibility({ projectLocalDefault: "2.7.0", currentVersion: "2.9.0", g5Passed: true }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.2.0", g5Passed: true }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0", g5Passed: false }).passed).toBe(false);
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0", g5Passed: true }).passed).toBe(true);
    expect(legacyRemovalEligibility({ projectLocalDefault: "4.1.0", currentVersion: "3.0.0", g5Passed: true }).blockers).toContain("current version predates the project-local default");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0", currentVersion: "3.3.0-beta.1", g5Passed: true }).blockers).toContain("removal-floor versions must be stable semantic versions");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.1.0-beta.1", currentVersion: "3.3.0", g5Passed: true }).blockers).toContain("removal-floor versions must be stable semantic versions");
    expect(legacyRemovalEligibility({ projectLocalDefault: "3.9.0", currentVersion: "4.0.0", g5Passed: true }).passed).toBe(true);
  });
});
