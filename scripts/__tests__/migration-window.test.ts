import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createMigrationBoundary, createMigrationObservation, writeMigrationBoundary, writeMigrationObservation } from "../lib/capability/migration-evidence";
import { MIGRATION_WINDOW_SCHEMA, evaluateMigrationAdvance, legacyRemovalEligibility, recordMigrationRelease, startMigrationWindow, validateMigrationWindow } from "../lib/capability/migration-window";
import { readCompatibilityAsset } from "../lib/capability/compatibility-loader";
import { baselineBinding, emitCapabilityProfile, snapshotTreeHashes } from "../lib/capability/profile-emit";
import { readFeatureGateRegistry } from "../lib/capability/strangler-control";

let mockGhFailure = false;
jest.mock("node:child_process", () => {
  const actual = jest.requireActual("node:child_process") as typeof import("node:child_process");
  return {
    ...actual,
    execFileSync: jest.fn((file: string, args: readonly string[], options: unknown) => {
      if (file !== "gh") return actual.execFileSync(file, args as string[], options as never);
      if (mockGhFailure) throw new Error("planted attestation refusal");
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
  writeFileSync(join(root, ".claude-plugin/plugin.json"), `${JSON.stringify({ name: "guild", version })}\n`);
  writeFileSync(join(root, "payload.txt"), `${version}\n`);
  git(root, "add", ".claude-plugin/plugin.json", "payload.txt");
  git(root, "commit", "-qm", version);
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/next", commit);
  writeFileSync(eventPath, `${JSON.stringify({ ref: "refs/heads/next", after: commit, repository: { full_name: "lookatitude/guild", pushed_at: pushedAt }, head_commit: { id: commit, timestamp: new Date((pushedAt - 60) * 1000).toISOString() } })}\n`);
  const boundary = createMigrationBoundary({ pluginRoot: root, eventPath, repository: "lookatitude/guild", runId: String(pushedAt), runAttempt: 1 });
  return { root, boundary, boundaryPath: writeMigrationBoundary(join(root, "boundaries"), boundary) };
}

function observationFixture(projectRoot: string, fixture: ReturnType<typeof boundaryFixture>, runId: string, synthetic = false) {
  const pluginRoot = mkdtempSync(join(tmpdir(), "guild-window-plugin-"));
  const assetPath = "templates/specialists/researcher.md";
  const assetBytes = Buffer.from("# researcher\n");
  mkdirSync(dirname(join(pluginRoot, assetPath)), { recursive: true });
  mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
  writeFileSync(join(pluginRoot, assetPath), assetBytes);
  writeFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), `${JSON.stringify({ version: fixture.boundary.release })}\n`);
  const baseline = snapshotTreeHashes(projectRoot)!;
  const emitted = emitCapabilityProfile({
    projectRoot, runId, projectId: "fx-project", generatedAt: fixture.boundary.merged_at, sourceCommit: null, resolverMode: "observe",
    facts: { domains: [], boundaries: [], repeated_methods: [], coverage: { covered: [], uncovered: [], unmatched_roles: [] }, candidates: [] },
    baselineHashes: { ...baseline, bound_root: baselineBinding(projectRoot)!, bound_run_id: runId },
  });
  expect(emitted.status).toBe("emitted");
  const loaded = readCompatibilityAsset({
    pluginRoot, projectRoot,
    entry: { kind: "shipped_template", id: "researcher", path: assetPath, content_hash: createHash("sha256").update(assetBytes).digest("hex"), deprecation: "deprecated", deprecated_by: "cap-loc-D03" },
    mode: "observe", intent: "dispatch", synthetic, specialistId: null, runId, operationId: "migration-observe", recordedAt: fixture.boundary.merged_at,
  });
  expect(loaded.status).toBe("loaded");
  const observation = createMigrationObservation({ projectRoot, boundaryPath: fixture.boundaryPath, projectId: "fx-project", mode: "observe", runIds: [runId] });
  const observationPath = writeMigrationObservation(join(fixture.root, "observations", runId), observation);
  rmSync(pluginRoot, { recursive: true, force: true });
  return { observation, observationPath };
}

describe("D03 evidence-bound migration window", () => {
  it("removes the caller-asserted time and conformance flags from the CLI", () => {
    const cli = join(__dirname, "..", "capability-adopt.ts");
    const tsx = join(__dirname, "..", "node_modules", "tsx", "dist", "cli.mjs");
    const result = spawnSync(process.execPath, [tsx, cli, "window", "advance", "--boundary", "b.json", "--observation", "o.json", "--to", "shadow", "--at", "2026-09-04T00:00:00Z", "--conformance-pass"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unknown window option.*--at.*--conformance-pass/i);
  });

  it("starts only from a boundary paired with real non-synthetic whole-run evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-080000-beta2");
      const window = startMigrationWindow({ projectRoot, mode: "observe", boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath, actor: "operator" });
      expect(window.schema_version).toBe(MIGRATION_WINDOW_SCHEMA);
      expect(window.entered_at).toBe("2026-08-21T08:00:00.000Z");
      expect(window.releases).toEqual([fixture.boundary]);
      expect(window.observations).toEqual([evidence.observation]);
      expect(readFeatureGateRegistry(projectRoot)?.resolver_mode).toBe("observe");
      const ghCalls = (execFileSync as jest.MockedFunction<typeof execFileSync>).mock.calls.filter(([file]) => file === "gh");
      expect(ghCalls.some(([, args]) => (args as string[]).includes("--signer-workflow") && (args as string[]).includes("--source-digest") && (args as string[]).includes("--deny-self-hosted-runners"))).toBe(true);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a self-consistent boundary without GitHub attestation provenance", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      mockGhFailure = true;
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-080000-unattested")).toThrow(/GitHub provenance verification failed/i);
    } finally {
      mockGhFailure = false;
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("cannot skip observe or overwrite a corrupt existing timer", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-080000-guard");
      expect(() => startMigrationWindow({ projectRoot, mode: "shadow", boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath, actor: "operator" })).toThrow(/must enter at observe/i);
      const timer = join(projectRoot, ".guild/artifacts/capability/migration-window.json");
      mkdirSync(dirname(timer), { recursive: true });
      writeFileSync(timer, "{broken\n");
      expect(() => startMigrationWindow({ projectRoot, mode: "observe", boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath, actor: "operator" })).toThrow(/already exists or is invalid/i);
      expect(readFileSync(timer, "utf8")).toBe("{broken\n");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
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
      const firstEvidence = observationFixture(projectRoot, first, "run-20260821-080000-beta2");
      startMigrationWindow({ projectRoot, mode: "observe", boundaryPath: first.boundaryPath, observationPath: firstEvidence.observationPath, actor: "operator" });
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
      const window = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: "observe", entered_at: first.boundary.merged_at, releases: [first.boundary, second.boundary, third.boundary], observations, actor: "operator" })!;
      expect(evaluateMigrationAdvance(window, "shadow", advance.boundary).passed).toBe(true);
      expect(evaluateMigrationAdvance(window, "shadow", earlyAdvance.boundary).blockers).toContain("need >=14 days in observe");
      const tampered = JSON.parse(JSON.stringify(window));
      tampered.observations[0].runs[0].profile.sha256 = "0".repeat(64);
      expect(validateMigrationWindow(tampered)).toBeNull();
    } finally { rmSync(projectRoot, { recursive: true, force: true }); for (const f of [first, second, third, earlyAdvance, advance]) rmSync(f.root, { recursive: true, force: true }); }
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
