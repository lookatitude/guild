import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { captureMigrationRunBaseline, createMigrationBoundary, createMigrationObservation, profileBaselineFromMigrationRunBaseline, recordMigrationSubstantiveTaskOperation, sealMigrationObservationRun, verifyMigrationObservation, verifySubstantiveMigrationObservation, writeMigrationBoundary, writeMigrationObservation } from "../lib/capability/migration-evidence";
import { MIGRATION_RESTART_HISTORY_RELPATH, MIGRATION_TRANSITION_RELPATH, MIGRATION_WINDOW_RELPATH, MIGRATION_WINDOW_SCHEMA, advanceMigrationWindow, evaluateMigrationAdvance, inspectMigrationWindow, legacyRemovalEligibility, readMigrationWindow, recordMigrationRelease, recoverMigrationTransition, restartMigrationWindow, startMigrationWindow, validateMigrationRestartRecord, validateMigrationWindow, writeMigrationWindow } from "../lib/capability/migration-window";
import { readCompatibilityAsset } from "../lib/capability/compatibility-loader";
import { baselineBinding, emitCapabilityProfile, snapshotTreeHashes } from "../lib/capability/profile-emit";
import { FEATURE_GATE_RELPATH, readFeatureGateRegistry } from "../lib/capability/strangler-control";
import { appendReceipt, defaultJournalIo, makeReceiptInput, scanReceiptJournal, sealReceiptRecord } from "../../src/modules/telemetry/workflows/receipt-journal";
import { CAPABILITY_RUN_START_SNAPSHOT_SCHEMA, capabilityRunStartIdentityHash } from "../../src/modules/lifecycle/workflows/run-lifecycle";
import { closeRunBinding, loadRunBinding, mintRunBinding, reopenRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import { buildSessionContext, writeSessionContext } from "../../src/modules/host-runtime/workflows/session-context";
import { buildTaskAssignmentV2, taskCellPaths } from "../../src/modules/dispatch/workflows/task-cell-contract";

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

function writeRunState(
  projectRoot: string,
  runId: string,
  startedAt: string,
  status: "open" | "closed",
  closedAt?: string,
  options: { readonly touchedTasks?: readonly string[]; readonly manifestExtra?: string; readonly traceExtra?: readonly unknown[] } = {},
): void {
  const runRoot = join(projectRoot, ".guild", "runs", runId);
  const snapshotPath = join(runRoot, "capability", "run-start-snapshot.json");
  mkdirSync(dirname(snapshotPath), { recursive: true });
  if (!loadRunBinding({ root: projectRoot, run_id: runId })) {
    mintRunBinding({ root: projectRoot, run_id: runId });
  }
  if (!existsSync(snapshotPath)) {
    const hashes = snapshotTreeHashes(projectRoot);
    const boundRoot = baselineBinding(projectRoot);
    if (!hashes || !boundRoot) throw new Error("fixture could not capture run-start capability trees");
    writeFileSync(snapshotPath, `${JSON.stringify({
      schema_version: "guild.capability_run_start_snapshot.v1",
      run_id: runId,
      run_started_at: startedAt,
      captured_at: startedAt,
      ...hashes,
      bound_root: boundRoot,
      bound_run_id: runId,
    }, null, 2)}\n`);
  }
  const snapshotHash = createHash("sha256").update(readFileSync(snapshotPath)).digest("hex");
  writeFileSync(join(runRoot, "run.yaml"), `schema_version: guild.run.v1\nrun_id: ${runId}\ncwd: ${projectRoot}\nworkspace:\n  root: ${projectRoot}\nstarted_at: ${startedAt}\ncapability_start_snapshot_ref:\n  path: capability/run-start-snapshot.json\n  sha256: ${snapshotHash}\n${options.manifestExtra ?? ""}status: ${status}\n`);
  const journal = join(runRoot, "receipts", "journal.jsonl");
  const checkpoint = join(runRoot, "receipts", "checkpoint.json");
  const startOperation = `capability-start-snapshot:${runId}`;
  if (status === "open" && !scanReceiptJournal(journal).records.some((record) => record.operation_id === startOperation)) {
    const identity = capabilityRunStartIdentityHash(runId, startedAt, snapshotHash);
    const appended = appendReceipt({ journal, checkpoint }, makeReceiptInput({
      run_id: runId, operation_id: startOperation, correlation_id: startOperation,
      event_id: `${startOperation}:${snapshotHash.slice(0, 12)}`, causation_id: null, scenario_id: "PCL-09",
      event_name: "receipt.append", outcome_type: "guild.capability_outcome.v1", disposition: "succeeded",
      observation_state: "checked_clean", input_hash: identity, output_hash: `sha256:${snapshotHash}`,
      terminal: false, recorded_at: startedAt, observed_at: startedAt,
      versions: { host_id: "guild-lifecycle", host_version: "unknown", runtime_version: CAPABILITY_RUN_START_SNAPSHOT_SCHEMA, source_version: identity, contract_version: "guild.observability.v1" },
      affected_event_range: null,
    }));
    if (!appended.durable || appended.sequence !== 1) throw new Error("fixture could not append lifecycle start receipt");
  }
  if (status === "closed") {
    if (!closedAt) throw new Error("fixture close requires closedAt");
    const event = { schema_version: "guild.trace_event.v1", event_id: `evt-${runId}`, event_name: "run_closed", run_id: runId, at: closedAt };
    mkdirSync(join(runRoot, "logs"), { recursive: true });
    writeFileSync(join(runRoot, "logs", "v1.4-events.jsonl"), `${[...(options.traceExtra ?? []), event].map((entry) => JSON.stringify(entry)).join("\n")}\n`);
    writeFileSync(join(runRoot, "provenance.json"), `${JSON.stringify({
      schema_version: "guild.provenance.v1",
      run_id: runId,
      started_at: startedAt,
      closed_at: closedAt,
      status: "closed",
      terminal_trace_event: { event_id: `evt-${runId}`, event_name: "run_closed", at: closedAt, log_ref: `.guild/runs/${runId}/logs/v1.4-events.jsonl` },
      touched: { tasks: [...(options.touchedTasks ?? [])], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] },
      artifacts: { capability_profile: `.guild/runs/${runId}/capability/profile.json` },
    }, null, 2)}\n`);
    closeRunBinding({ root: projectRoot, run_id: runId });
  }
}

type TaskCellFixtureVariant = "done" | "blocked-handoff" | "duplicate-handoff" | "noncanonical-receipt" | "early-termination" | "early-authorization" | "foreign-specialist" | "stale-receipt" | "private-path" | "reaped" | "orphaned-unreaped";

function writeAcceptedTaskCell(projectRoot: string, runId: string, taskId: string, specialistId: string, completedAt: string, pointerReceipt = true, variant: TaskCellFixtureVariant = "done"): void {
  const instanceId = `${taskId}.a1.i-fixture`;
  const paths = taskCellPaths({ run_id: runId, logical_task_id: taskId, attempt: 1, instance_id: instanceId });
  const assignment = buildTaskAssignmentV2({
    run_id: runId,
    cell_id: `cell-${taskId}`,
    goal_id: "goal-migration-observation",
    phase_id: "build",
    step_id: taskId,
    team_id: "migration-observation",
    logical_task_id: taskId,
    task_run_id: `${taskId}.tr1`,
    attempt: 1,
    attempt_id: `${taskId}.att1`,
    previous_attempt_id: null,
    retry_reason: null,
    instance_id: instanceId,
    team_lead_instance_id: null,
    lead_binding_id: "lead-binding-migration-observation",
    worker_role: specialistId,
    specialist_type_id: specialistId,
    specialist_type_version: "1",
    specialist_type_hash: "a".repeat(64),
    specialist_profile_id: specialistId,
    specialist_profile_hash: "b".repeat(64),
    context_bundle_id: `.guild/context/${runId}/${specialistId}-${taskId}.md`,
    context_bundle_hash: `sha256:${"c".repeat(64)}`,
    host_id: "claude-code-cli",
    adapter_id: "claude-code-cli@1",
    host_capabilities_hash: `sha256:${"d".repeat(64)}`,
    objective: variant === "private-path" ? `complete ${taskId} from /Users/alice/Projects/demo/src/input.ts` : `complete ${taskId}`,
    non_goals: [],
    scope_paths: [],
    output_schema: "guild.handoff_receipt.v1",
    acceptance_tests: [],
    dependencies: [],
    projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
    autonomy_policy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    written_at: completedAt,
  });
  const attempt = {
    schema_version: "guild.task_attempt.v1",
    run_id: runId,
    cell_id: assignment.cell_id,
    logical_task_id: taskId,
    task_run_id: assignment.task_run_id,
    attempt: 1,
    attempt_id: assignment.attempt_id,
    previous_attempt_id: null,
    retry_reason: null,
    instance_id: instanceId,
    created_at: completedAt,
    terminal_state: "terminated",
    terminal_reason: variant === "reaped" ? "reaper: pane already gone" : "accepted",
    terminated_at: variant === "early-termination" ? new Date(Date.parse(completedAt) - 1_000).toISOString() : completedAt,
    immutable: true,
    orphaned: variant === "reaped" || variant === "orphaned-unreaped",
    reap_attempts: variant === "reaped" ? 1 : 0,
  };
  const receiptId = `receipt-${assignment.attempt_id}`;
  const receiptSpecialist = variant === "foreign-specialist" ? "seo" : specialistId;
  const receiptGeneratedAt = variant === "stale-receipt"
    ? new Date(Date.parse(completedAt) - 1_000).toISOString()
    : completedAt;
  const handoffReceiptPath = `.guild/runs/${runId}/handoffs/${receiptSpecialist}-${taskId}.md`;
  const envelope = {
    schema_version: "guild.handoff.v2",
    task_id: taskId,
    tier: "mid",
    status: variant === "blocked-handoff" ? "blocked" : "done",
    summary: variant === "private-path" ? `completed /Users/alice/Projects/demo/src/output.ts for ${taskId}` : `completed ${taskId}`,
    artifacts: [],
    issues: [],
  };
  const handoffReceipt = [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    `task_id: ${taskId}`,
    `specialist: ${receiptSpecialist}`,
    "model_family: claude",
    "host: claude-code-cli",
    `generated_at: ${receiptGeneratedAt}`,
    "---",
    "",
    ...(variant === "noncanonical-receipt" ? [] : [
      "## changed_files", "- none", "",
      "## opens_for", "- lead", "",
      "## assumptions", "- none", "",
      "## evidence", "- accepted fixture", "",
      "## followups", "- none", "",
    ]),
    "```guild.handoff.v2",
    JSON.stringify(envelope),
    "```",
    ...(variant === "duplicate-handoff" ? ["", "```guild.handoff.v2", JSON.stringify({ ...envelope, status: "blocked", summary: `conflicting ${taskId}` }), "```"] : []),
    "",
  ].join("\n");
  const handoff = pointerReceipt ? {
    receipt_id: receiptId,
    receipt_path: handoffReceiptPath,
    schema_valid: true,
    claimed_changed_files: [],
    acceptance_tests_passed: [],
    submitted_at: completedAt,
  } : {
    schema_version: "guild.handoff_receipt.v1",
    run_id: runId,
    task_id: taskId,
    instance_id: instanceId,
    worker_role: specialistId,
    status: "done",
    changed_files: [],
    opens_for: {},
    assumptions: [],
    evidence: ["production-shaped accepted task cell"],
    followups: [],
  };
  const validation = {
    schema_version: "guild.handoff_validation.v1",
    validation_result_id: `validation-${assignment.attempt_id}`,
    run_id: runId,
    cell_id: assignment.cell_id,
    logical_task_id: taskId,
    task_run_id: assignment.task_run_id,
    attempt: 1,
    instance_id: instanceId,
    assignment_id: `${assignment.task_run_id}:1:${instanceId}`,
    receipt_id: receiptId,
    schema_valid: true,
    scope_valid: true,
    tests_passed: true,
    out_of_scope_files: [],
    failed_acceptance_tests: [],
    result: "passed",
    reason: null,
    validated_at: completedAt,
  };
  const acceptance = {
    schema_version: "guild.handoff_acceptance.v1",
    run_id: runId,
    cell_id: assignment.cell_id,
    logical_task_id: taskId,
    task_run_id: assignment.task_run_id,
    attempt: 1,
    instance_id: instanceId,
    assignment_id: `${assignment.task_run_id}:1:${instanceId}`,
    receipt_id: receiptId,
    validation_result_id: validation.validation_result_id,
    acceptance_policy_version: "1.0.0",
    authorities_required: ["deterministic_floor", "team_lead"],
    authorities_observed: [
      { authority: "deterministic_floor", decision: "accepted", at: completedAt, reason: null },
      { authority: "team_lead", decision: "accepted", at: completedAt, reason: null },
    ],
    reviewer_cell_id: null,
    downstream_release_at: completedAt,
    termination_authorized_at: variant === "early-authorization" ? new Date(Date.parse(completedAt) - 1_000).toISOString() : completedAt,
  };
  if (pointerReceipt) {
    const receiptTarget = join(projectRoot, handoffReceiptPath);
    mkdirSync(dirname(receiptTarget), { recursive: true });
    writeFileSync(receiptTarget, handoffReceipt);
  }
  for (const [relativePath, value] of [[paths.assignment_path, assignment], [paths.handoff_path, handoff], [paths.validation_path, validation], [paths.attempt_path, attempt], [paths.acceptance_path, acceptance]] as const) {
    const target = join(projectRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
  }
}

function observationFixture(projectRoot: string, fixture: ReturnType<typeof boundaryFixture>, runId: string, synthetic = false, mode: "observe" | "shadow" = "observe", generatedAt?: string, sourceCommit: string | null = projectSourceCommit(projectRoot), tamperRuntimeBinding?: "host" | "tree", timing: { baselineAt?: string; receiptAt?: string; taskCompletedAt?: string; closeAt?: string; removeBaseline?: boolean; removeBaselineReceipt?: boolean; leaveRunOpen?: boolean; omitTerminalSeal?: boolean; omitProvenance?: boolean; omitTerminalTrace?: boolean; tamperTerminalTrace?: boolean; corruptProfileAfterSeal?: boolean; mutateAfterProfile?: boolean; mutateAfterSeal?: boolean; tamperSessionAfterSeal?: boolean; unresolvedIdentity?: boolean; compatibilityOnly?: boolean; omitSubstantiveOperation?: boolean; corruptCheckpointBeforeSubstantive?: boolean; detachedCompatibility?: boolean; taskCellChain?: "missing-handoff" | "missing-receipt" | "failed-validation" | "direct-handoff" | "blocked-handoff" | "duplicate-handoff" | "noncanonical-receipt" | "early-termination" | "early-authorization" | "foreign-specialist" | "stale-receipt" | "reaped" | "orphaned-unreaped"; taskPrivatePath?: boolean; plantedCredential?: boolean; plantedEntropy?: boolean; noisyTrace?: boolean } = {}) {
  const pluginRoot = fixture.claudePackageRoot;
  const assetPath = "templates/specialists/researcher.md";
  const assetBytes = Buffer.from("# researcher\n");
  const profileAt = generatedAt ?? fixture.boundary.merged_at;
  const receiptAt = timing.receiptAt ?? new Date(Date.parse(profileAt) - 1_000).toISOString();
  const baselineAt = timing.baselineAt ?? new Date(Date.parse(profileAt) - 2_000).toISOString();
  const runStartedAt = new Date(Date.parse(baselineAt) - 1_000).toISOString();
  const taskId = `task-${runId}`;
  const manifestExtra = `${timing.plantedCredential ? "operator_note: api_key=sk-abcdefghijklmnop\n" : ""}${timing.plantedEntropy ? `arbitrary_entropy: ${"f".repeat(64)}\n` : ""}`;
  writeRunState(projectRoot, runId, runStartedAt, "open", undefined, { manifestExtra });
  const binding = loadRunBinding({ root: projectRoot, run_id: runId })!;
  writeSessionContext(projectRoot, buildSessionContext({
    run_id: runId,
    started_at: runStartedAt,
    native_adapter: timing.unresolvedIdentity ? null : {
      family: "claude",
      surface: "cli",
      adapter_id: "claude-code-cli",
      adapter_version: fixture.boundary.release,
      evidence: "test-owned native adapter identity",
    },
    run_binding: { binding_ref: binding.binding_ref, state: "open" },
  }));
  jest.useFakeTimers({ now: new Date(baselineAt) });
  let baseline;
  try { baseline = captureMigrationRunBaseline({ projectRoot, runId }); }
  finally { jest.useRealTimers(); }
  if (timing.removeBaselineReceipt) {
    rmSync(join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl"), { force: true });
    rmSync(join(projectRoot, ".guild", "runs", runId, "receipts", "checkpoint.json"), { force: true });
  }
  jest.useFakeTimers({ now: new Date(receiptAt) });
  let loaded;
  try {
    loaded = readCompatibilityAsset({
      pluginRoot, runtimeHost: "claude-code-cli", projectRoot,
      entry: { kind: "shipped_template", id: "researcher", path: assetPath, content_hash: createHash("sha256").update(assetBytes).digest("hex"), deprecation: "deprecated", deprecated_by: "cap-loc-D03" },
      mode, intent: mode === "shadow" ? "shadow_compare" : "dispatch", synthetic, specialistId: "researcher", runId,
      bindingRef: binding.binding_ref,
      operationId: timing.detachedCompatibility ? `task-cell-identity-other-task-researcher` : `task-cell-identity-${taskId}-researcher`,
    });
  } finally { jest.useRealTimers(); }
  expect(loaded.status).toBe("loaded");
  if (tamperRuntimeBinding) {
    const journalPath = join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl");
    const records = readFileSync(journalPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const recordIndex = records.findIndex((entry) => String(entry.operation_id).startsWith("compatibility-read:"));
    expect(recordIndex).toBeGreaterThanOrEqual(0);
    const record = records[recordIndex];
    record.versions[tamperRuntimeBinding === "host" ? "host_id" : "source_version"] = tamperRuntimeBinding === "host" ? "codex-cli" : `sha256:${"0".repeat(64)}`;
    const { record_hash: _recordHash, schema_version: _schemaVersion, ...body } = record;
    records[recordIndex] = sealReceiptRecord(body);
    writeFileSync(journalPath, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
  }
  const emitted = emitCapabilityProfile({
    projectRoot, runId, projectId: "fx-project", generatedAt: profileAt, sourceCommit, resolverMode: mode,
    facts: { domains: [], boundaries: [], repeated_methods: [], coverage: { covered: [], uncovered: [], unmatched_roles: [] }, candidates: [] },
    baselineHashes: profileBaselineFromMigrationRunBaseline(baseline),
  });
  expect(emitted.status).toBe("emitted");
  if (timing.mutateAfterProfile) {
    mkdirSync(join(projectRoot, ".guild", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".guild", "agents", `${runId}.late.md`), "late mutation\n");
  }
  if (!timing.leaveRunOpen && !timing.omitTerminalSeal) {
    const closedAt = timing.closeAt ?? new Date(Date.parse(profileAt) + 1_000).toISOString();
    const fixtureVariant: TaskCellFixtureVariant = timing.taskPrivatePath
      ? "private-path"
      : (["blocked-handoff", "duplicate-handoff", "noncanonical-receipt", "early-termination", "early-authorization", "foreign-specialist", "stale-receipt", "reaped", "orphaned-unreaped"] as const).includes(timing.taskCellChain as never)
        ? timing.taskCellChain as TaskCellFixtureVariant
        : "done";
    if (!timing.compatibilityOnly) writeAcceptedTaskCell(projectRoot, runId, taskId, "researcher", timing.taskCompletedAt ?? profileAt, timing.taskCellChain !== "direct-handoff", fixtureVariant);
    if (timing.taskCellChain === "missing-handoff") {
      const paths = taskCellPaths({ run_id: runId, logical_task_id: taskId, attempt: 1, instance_id: `${taskId}.a1.i-fixture` });
      rmSync(join(projectRoot, paths.handoff_path), { force: true });
    }
    if (timing.taskCellChain === "missing-receipt") {
      rmSync(join(projectRoot, `.guild/runs/${runId}/handoffs/researcher-${taskId}.md`), { force: true });
    }
    if (timing.taskCellChain === "failed-validation") {
      const paths = taskCellPaths({ run_id: runId, logical_task_id: taskId, attempt: 1, instance_id: `${taskId}.a1.i-fixture` });
      const validationPath = join(projectRoot, paths.validation_path);
      const validation = JSON.parse(readFileSync(validationPath, "utf8"));
      validation.result = "failed";
      validation.tests_passed = false;
      validation.failed_acceptance_tests = ["planted failure"];
      validation.reason = "planted failure";
      writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);
    }
    if (!timing.compatibilityOnly && !timing.omitSubstantiveOperation) {
      const taskCompletedAt = timing.taskCompletedAt ?? profileAt;
      const recordedAt = new Date(Math.max(Date.parse(profileAt), Date.parse(taskCompletedAt)) + 1).toISOString();
      if (timing.corruptCheckpointBeforeSubstantive) {
        writeFileSync(join(projectRoot, ".guild", "runs", runId, "receipts", "checkpoint.json"), "{}\n");
      }
      jest.useFakeTimers({ now: new Date(recordedAt) });
      try { recordMigrationSubstantiveTaskOperation({ projectRoot, runId, taskId }); }
      finally { jest.useRealTimers(); }
    }
    writeRunState(projectRoot, runId, runStartedAt, "closed", closedAt, {
      manifestExtra,
      touchedTasks: [taskId],
      traceExtra: timing.noisyTrace ? [{
        schema_version: "guild.trace.analysis.v2",
        event_class: "tool_call_finished",
        run_id: runId,
        result_excerpt_redacted: `normal receipt hash ${"f".repeat(64)} must not enter the public close projection`,
      }] : [],
    });
    if (timing.omitProvenance) rmSync(join(projectRoot, ".guild", "runs", runId, "provenance.json"), { force: true });
    const terminalLog = join(projectRoot, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
    if (timing.omitTerminalTrace) rmSync(terminalLog, { force: true });
    if (timing.tamperTerminalTrace) writeFileSync(terminalLog, `${JSON.stringify({ schema_version: "guild.trace_event.v1", event_id: `evt-${runId}`, event_name: "run_closed", run_id: runId, at: new Date(Date.parse(closedAt) + 1_000).toISOString() })}\n`);
    jest.useFakeTimers({ now: new Date(Math.max(Date.parse(profileAt), Date.parse(closedAt)) + 1_000) });
    try { sealMigrationObservationRun({ projectRoot, runId }); }
    finally { jest.useRealTimers(); }
  }
  if (timing.mutateAfterSeal) {
    mkdirSync(join(projectRoot, ".guild", "agents"), { recursive: true });
    writeFileSync(join(projectRoot, ".guild", "agents", `${runId}.after-seal.md`), "post-seal mutation\n");
  }
  if (timing.tamperSessionAfterSeal) {
    const sessionPath = join(projectRoot, ".guild", "runs", runId, "session-context.json");
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    session.host.adapter_id = "forged-after-close";
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
  }
  if (!timing.leaveRunOpen && timing.omitTerminalSeal) writeRunState(projectRoot, runId, runStartedAt, "closed", new Date(Date.parse(profileAt) + 1_000).toISOString(), {
    manifestExtra,
    touchedTasks: [`task-${runId}`],
  });
  if (timing.corruptProfileAfterSeal) writeFileSync(join(projectRoot, ".guild", "runs", runId, "capability", "profile.json"), "{broken\n");
  if (timing.removeBaseline) rmSync(join(projectRoot, ".guild", "runs", runId, "capability", "run-start-baseline.json"));
  const observation = createMigrationObservation({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, boundaryPath: fixture.boundaryPath, projectId: "fx-project", mode, runIds: [runId] });
  const observationPath = writeMigrationObservation(join(fixture.root, "observations", runId), observation);
  return { observation, observationPath };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asLegacyObservation(observation: ReturnType<typeof observationFixture>["observation"]) {
  const body = {
    ...observation,
    schema_version: "guild.capability_migration_observation.v1",
    runs: observation.runs.map(({ run_manifest: _runManifest, provenance: _provenance, source_provenance_sha256: _sourceProvenanceSha256, source_session_context_sha256: _sourceSessionContextSha256, terminal_trace_log: _terminalTraceLog, start_snapshot: _startSnapshot, baseline: _baseline, session_context: _sessionContext, substantive_operations: _substantiveOperations, substantive_evidence: _substantiveEvidence, ...run }) => run),
  } as Record<string, unknown>;
  delete body.observation_hash;
  return { ...body, observation_hash: createHash("sha256").update(canonical(body)).digest("hex") };
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
    const help = spawnSync(process.execPath, [tsx, cli, "--help"], { encoding: "utf8" });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("window   publish");
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

  it("projects a scrub-clean, self-resolving, session-bound public evidence tree before hashing", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-public-projection";
    try {
      const evidence = observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z");
      const run = evidence.observation.runs[0] as typeof evidence.observation.runs[0] & { session_context?: { path: string; sha256: string } };
      expect(run.session_context).toEqual(expect.objectContaining({
        path: expect.stringMatching(/\/session-context\.json$/),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }));
      expect(run.source_session_context_sha256).toMatch(/^[0-9a-f]{64}$/);
      const retainedRun = readFileSync(join(projectRoot, run.run_manifest.path), "utf8");
      const retainedProvenance = JSON.parse(readFileSync(join(projectRoot, run.provenance.path), "utf8"));
      const retainedSession = JSON.parse(readFileSync(join(projectRoot, run.session_context!.path), "utf8"));
      expect(retainedRun).toContain("cwd: <workspace-root>");
      expect(retainedRun).toContain("root: <workspace-root>");
      expect(retainedRun).toContain("path: run-start-snapshot.json");
      expect(retainedRun).not.toContain(projectRoot);
      expect(retainedProvenance.terminal_trace_event.log_ref).toBe("terminal-trace-log.jsonl");
      expect(retainedProvenance.artifacts.capability_profile).toBe("profile.json");
      expect(retainedSession.identity).toEqual(expect.objectContaining({ trust: "verified", confidence: "high" }));
      expect(retainedSession.host).toEqual(expect.objectContaining({ family: "claude", adapter_id: "claude-code-cli" }));
      expect(readFileSync(join(projectRoot, ".guild", "runs", runId, "run.yaml"), "utf8")).toContain(projectRoot);
      expect(verifyMigrationObservation(projectRoot, evidence.observation)).toEqual(evidence.observation);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("projects only the provenance-bound close event from a noisy operational trace", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-noisy-terminal-trace";
    try {
      const evidence = observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { noisyTrace: true });
      const retained = readFileSync(join(projectRoot, evidence.observation.runs[0].terminal_trace_log.path), "utf8").trim().split("\n");
      expect(retained).toHaveLength(1);
      expect(JSON.parse(retained[0])).toEqual(expect.objectContaining({
        schema_version: "guild.trace_event.v1",
        event_name: "run_closed",
        run_id: runId,
      }));
      expect(retained[0]).not.toContain("f".repeat(64));
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("verifies a published observation after the project checkout moves", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-origin-"));
    const movedRoot = `${projectRoot}-moved`;
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-portable-observation", false, "observe", "2026-08-21T09:00:00.000Z");
      renameSync(projectRoot, movedRoot);
      rmSync(join(movedRoot, ".guild", "runs", "run-20260821-090000-portable-observation"), { recursive: true, force: true });
      expect(verifyMigrationObservation(movedRoot, evidence.observation)).toEqual(evidence.observation);
      expect(verifySubstantiveMigrationObservation(movedRoot, evidence.observation)).toEqual(evidence.observation);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(movedRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("binds substantive operations to scrub-clean projected task-cell hashes", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-projected-task-cell", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { taskPrivatePath: true });
      const run = evidence.observation.runs[0];
      const assignmentRef = run.substantive_evidence!.find((ref) => ref.path.endsWith("/assignment.json"))!;
      const operationRef = run.substantive_operations![0];
      const assignmentBytes = readFileSync(join(projectRoot, assignmentRef.path));
      const operation = JSON.parse(readFileSync(join(projectRoot, operationRef.path), "utf8"));
      expect(assignmentBytes.toString("utf8")).toContain("<workspace-root>/src/input.ts");
      expect(assignmentBytes.toString("utf8")).not.toContain("/Users/alice/Projects/demo");
      expect(operation.projected_assignment_sha256).toBe(createHash("sha256").update(assignmentBytes).digest("hex"));
      expect(operation.assignment_sha256).not.toBe(operation.projected_assignment_sha256);
      expect(verifyMigrationObservation(projectRoot, evidence.observation)).toEqual(evidence.observation);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses tampering with retained substantive task-cell bytes", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-tampered-task-cell", false, "observe", "2026-08-21T09:00:00.000Z");
      const retained = evidence.observation.runs[0].substantive_evidence![0];
      writeFileSync(join(projectRoot, retained.path), "{}\n");
      expect(() => verifyMigrationObservation(projectRoot, evidence.observation)).toThrow(/evidence hash mismatch|substantive evidence/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ["credential", { plantedCredential: true }, /credential|secret|public projection/i],
    ["arbitrary entropy", { plantedEntropy: true }, /entropy|secret|public projection/i],
  ] as const)("refuses a planted %s before any public evidence directory lands", (_label, timing, message) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = `run-20260821-090000-planted-${_label === "credential" ? "credential" : "entropy"}`;
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, timing)).toThrow(message);
      expect(existsSync(join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, runId))).toBe(false);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ["unresolved session identity", { unresolvedIdentity: true }, /session identity|verified.*identity/i],
    ["compatibility-only lifecycle", { compatibilityOnly: true }, /substantive|touched\.tasks|specialist/i],
  ] as const)("does not publish or count a %s", (_label, timing, message) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = `run-20260821-090000-${_label === "unresolved session identity" ? "unresolved" : "compatibility-only"}`;
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, timing)).toThrow(message);
      expect(readMigrationWindow(projectRoot)?.observations).toEqual([]);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("does not let terminal sealing manufacture a substantive operation for an otherwise accepted task cell", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-no-preclose-operation", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { omitSubstantiveOperation: true }))
        .toThrow(/pre-existing resolver-emitted substantive operation/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("admits an accepted attempt after a successful reaper terminal transition", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-reaped-success", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { taskCellChain: "reaped" }))
        .not.toThrow();
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses an orphan flag without a successful reaper history", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-orphan-unreaped", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { taskCellChain: "orphaned-unreaped" }))
        .toThrow(/accepted task cell|substantive/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses substantive evidence recording after lifecycle close without changing the journal", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-post-close-operation";
    try {
      observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z");
      const journalPath = join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl");
      const before = readFileSync(journalPath, "utf8");
      expect(() => recordMigrationSubstantiveTaskOperation({
        projectRoot,
        runId,
        taskId: `task-${runId}`,
      })).toThrow(/while the run binding is open/i);
      expect(readFileSync(journalPath, "utf8")).toBe(before);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("propagates active migration journal corruption before lifecycle close", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-corrupt-substantive-checkpoint";
    try {
      expect(() => observationFixture(
        projectRoot,
        fixture,
        runId,
        false,
        "observe",
        "2026-08-21T09:00:00.000Z",
        projectSourceCommit(projectRoot),
        undefined,
        { corruptCheckpointBeforeSubstantive: true },
      )).toThrow(/checkpoint|journal.*intact/i);
      expect(loadRunBinding({ root: projectRoot, run_id: runId })?.state).toBe("open");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ["missing handoff", "no-handoff", { taskCellChain: "missing-handoff" as const }],
    ["missing referenced receipt", "no-receipt", { taskCellChain: "missing-receipt" as const }],
    ["failed deterministic validation", "bad-validation", { taskCellChain: "failed-validation" as const }],
    ["a direct JSON handoff substituted for the canonical pointer chain", "direct-handoff", { taskCellChain: "direct-handoff" as const }],
    ["a blocked handoff envelope", "blocked-handoff", { taskCellChain: "blocked-handoff" as const }],
    ["duplicate handoff envelopes", "duplicate-handoff", { taskCellChain: "duplicate-handoff" as const }],
    ["a noncanonical receipt wrapper", "noncanonical-receipt", { taskCellChain: "noncanonical-receipt" as const }],
    ["termination before acceptance", "early-termination", { taskCellChain: "early-termination" as const }],
    ["termination authorization before validation", "early-authorization", { taskCellChain: "early-authorization" as const }],
    ["a receipt from another specialist", "foreign-specialist", { taskCellChain: "foreign-specialist" as const }],
    ["a receipt generated before assignment", "stale-receipt", { taskCellChain: "stale-receipt" as const }],
    ["compatibility read for another task", "wrong-task", { detachedCompatibility: true }],
    ["compatibility read not preceding task assignment", "late-read", { receiptAt: "2026-08-21T08:59:59.000Z", taskCompletedAt: "2026-08-21T08:59:59.000Z" }],
  ])("refuses a substantive operation with %s", (_label, slug, timing) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, `run-20260821-090000-chain-${slug}`, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, timing)).toThrow(/accepted task-cell|distinct substantive operation|pre-existing resolver-emitted substantive operation/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a strong-looking session identity substituted after the terminal seal", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-session-substitution", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { tamperSessionAfterSeal: true })).toThrow(/terminal run seal|session.*seal|stale.*seal/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each(["session", "provenance"] as const)("refuses a hand-authored projected %s tree even when its source hash still matches the seal", (kind) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, `run-20260821-090000-forged-projected-${kind}`, false, "observe", "2026-08-21T09:00:00.000Z");
      const forged = JSON.parse(JSON.stringify(evidence.observation));
      const run = forged.runs[0];
      const ref = kind === "session" ? run.session_context : run.provenance;
      const target = join(projectRoot, ref.path);
      const document = JSON.parse(readFileSync(target, "utf8"));
      if (kind === "session") document.host.adapter_id = "hand-authored-strong-identity";
      else document.touched.tasks = ["task:hand-authored-substantive-work"];
      const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
      writeFileSync(target, bytes);
      ref.sha256 = createHash("sha256").update(bytes).digest("hex");
      delete forged.observation_hash;
      forged.observation_hash = createHash("sha256").update(canonical(forged)).digest("hex");
      expect(() => verifyMigrationObservation(projectRoot, forged)).toThrow(/terminal run seal|stale.*seal|detached/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("retries identical observation and window publication byte-for-byte but refuses collisions", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-idempotent", false, "observe", "2026-08-21T09:00:00.000Z");
      expect(writeMigrationObservation(dirname(evidence.observationPath), evidence.observation)).toBe(evidence.observationPath);
      const first = recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath });
      expect(recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath })).toEqual(first);
      writeFileSync(evidence.observationPath, `${JSON.stringify({ ...evidence.observation, project_id: "collision" }, null, 2)}\n`);
      expect(() => writeMigrationObservation(dirname(evidence.observationPath), evidence.observation)).toThrow(/collision|replacement/i);
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

  it("requires the retained baseline and enforces baseline → receipt → profile ordering", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const profileAt = "2026-08-21T09:00:00.000Z";
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-missing-baseline", false, "observe", profileAt, projectSourceCommit(projectRoot), undefined, { removeBaseline: true })).toThrow(/run-start-baseline|no such file/i);
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-late-baseline", false, "observe", profileAt, projectSourceCommit(projectRoot), undefined, {
        baselineAt: "2026-08-21T08:59:59.500Z",
        receiptAt: "2026-08-21T08:59:58.000Z",
      })).toThrow(/baseline does not precede compatibility dispatch/i);
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-early-profile", false, "observe", profileAt, projectSourceCommit(projectRoot), undefined, {
        baselineAt: "2026-08-21T08:59:58.000Z",
        receiptAt: "2026-08-21T09:00:01.000Z",
      })).toThrow(/profile predates compatibility dispatch|distinct substantive operation|pre-existing resolver-emitted substantive operation/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("accepts equal-millisecond baseline and first dispatch when append-only sequence proves the order", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-equal-clock", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, {
        baselineAt: "2026-08-21T08:59:59.000Z",
        receiptAt: "2026-08-21T08:59:58.000Z",
      });
      expect(evidence.observation.runs).toHaveLength(1);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ["missing lifecycle close provenance", { omitProvenance: true }, /provenance|close evidence/i],
    ["missing referenced run_closed trace event", { omitTerminalTrace: true }, /referenced run_closed trace event/i],
    ["tampered referenced run_closed trace event", { tamperTerminalTrace: true }, /close evidence/i],
    ["a profile produced after lifecycle close", { closeAt: "2026-08-21T08:59:59.000Z" }, /profile before lifecycle close/i],
    ["compatibility evidence produced after lifecycle close", { receiptAt: "2026-08-21T09:00:02.000Z", closeAt: "2026-08-21T09:00:01.000Z" }, /after lifecycle close/i],
  ] as const)("refuses terminal sealing with %s", (_label, timing, expected) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const slug = createHash("sha256").update(_label).digest("hex").slice(0, 12);
      expect(() => observationFixture(projectRoot, fixture, `run-20260821-090000-close-${slug}`, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, timing)).toThrow(expected);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses an open run before creating immutable snapshots, then succeeds after close", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-open-snapshot";
    const profileAt = "2026-08-21T09:00:00.000Z";
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", profileAt, projectSourceCommit(projectRoot), undefined, { leaveRunOpen: true })).toThrow(/terminal closed run manifest before snapshotting/i);
      const retainedRun = join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, runId, "run.yaml");
      expect(existsSync(retainedRun)).toBe(false);
      const taskId = `task-${runId}`;
      writeAcceptedTaskCell(projectRoot, runId, taskId, "researcher", profileAt);
      jest.useFakeTimers({ now: new Date("2026-08-21T09:00:00.001Z") });
      try { recordMigrationSubstantiveTaskOperation({ projectRoot, runId, taskId }); }
      finally { jest.useRealTimers(); }
      writeRunState(projectRoot, runId, "2026-08-21T08:59:57.000Z", "closed", "2026-08-21T09:00:01.000Z", { touchedTasks: [taskId] });
      jest.useFakeTimers({ now: new Date("2026-08-21T09:00:02.000Z") });
      try { sealMigrationObservationRun({ projectRoot, runId }); }
      finally { jest.useRealTimers(); }
      const observation = createMigrationObservation({ pluginRoot: fixture.claudePackageRoot, runtimeHost: "claude-code-cli", projectRoot, boundaryPath: fixture.boundaryPath, projectId: "fx-project", mode: "observe", runIds: [runId] });
      expect(observation.runs[0].run_manifest.path).toContain(`${runId}/run.yaml`);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses to seal stale terminal files after the run binding reopens", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const runId = "run-20260821-090000-reopened-before-seal";
    try {
      const startedAt = "2026-08-21T08:59:57.000Z";
      writeRunState(projectRoot, runId, startedAt, "open");
      const bindingRef = loadRunBinding({ root: projectRoot, run_id: runId })!.binding_ref;
      writeRunState(projectRoot, runId, startedAt, "closed", "2026-08-21T09:00:01.000Z");
      reopenRunBinding({ root: projectRoot, run_id: runId }, bindingRef);
      expect(() => sealMigrationObservationRun({ projectRoot, runId }))
        .toThrow(/valid closed run binding/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("requires an explicit terminal seal and publishes no snapshots for invalid source evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const unsealedRun = "run-20260821-090000-unsealed";
    const corruptRun = "run-20260821-090100-corrupt";
    try {
      expect(() => observationFixture(projectRoot, fixture, unsealedRun, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { omitTerminalSeal: true })).toThrow(/explicit terminal run seal/i);
      expect(existsSync(join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, unsealedRun))).toBe(false);
      expect(() => observationFixture(projectRoot, fixture, corruptRun, false, "observe", "2026-08-21T09:01:00.000Z", projectSourceCommit(projectRoot), undefined, { corruptProfileAfterSeal: true })).toThrow(/profile is unreadable/i);
      expect(existsSync(join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, corruptRun))).toBe(false);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("reports a prior terminal seal as stale after a later receipt becomes the journal tail", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-stale-terminal-seal";
    try {
      observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z");
      const operationId = `planted-later-terminal:${runId}`;
      const appended = appendReceipt({
        journal: join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl"),
        checkpoint: join(projectRoot, ".guild", "runs", runId, "receipts", "checkpoint.json"),
      }, makeReceiptInput({
        run_id: runId, operation_id: operationId, correlation_id: operationId,
        event_id: `${operationId}:event`, causation_id: null, scenario_id: "PCL-09",
        event_name: "receipt.append", outcome_type: "guild.capability_outcome.v1", disposition: "succeeded",
        observation_state: "checked_clean", input_hash: `sha256:${"1".repeat(64)}`, output_hash: `sha256:${"2".repeat(64)}`,
        terminal: true, recorded_at: "2026-08-21T09:00:03.000Z", observed_at: "2026-08-21T09:00:03.000Z",
        versions: { host_id: "test", host_version: "test", runtime_version: "test", source_version: "test", contract_version: "guild.observability.v1" },
        affected_event_range: null,
      }));
      expect(appended.durable).toBe(true);
      expect(() => sealMigrationObservationRun({ projectRoot, runId })).toThrow(/seal is stale|no longer the terminal receipt/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each([
    ["before terminal seal", { mutateAfterProfile: true }, /mutation after final profile emission/i],
    ["after terminal seal", { mutateAfterSeal: true }, /mutation after final profile emission/i],
  ] as const)("refuses capability-tree mutation %s", (_label, timing, expected) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = `run-20260821-090000-${"mutateAfterProfile" in timing ? "pre-seal" : "post-seal"}-mutation`;
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, timing)).toThrow(expected);
      expect(existsSync(join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, runId))).toBe(false);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("recovers an interrupted atomic evidence publication without partial final snapshots", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-atomic-publish";
    const fsModule = require("node:fs") as typeof import("node:fs");
    const realRename = fsModule.renameSync.bind(fsModule);
    let planted = true;
    const rename = jest.spyOn(fsModule, "renameSync").mockImplementation(((source: string, destination: string) => {
      if (planted && source.includes("/migration-evidence/.pending/") && destination.endsWith(`/${runId}`)) {
        planted = false;
        throw new Error("planted atomic publish crash");
      }
      realRename(source, destination);
    }) as typeof fsModule.renameSync);
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z")).toThrow(/planted atomic publish crash/i);
      const finalDirectory = join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, runId);
      expect(existsSync(finalDirectory)).toBe(false);
      rename.mockRestore();
      const observation = createMigrationObservation({ pluginRoot: fixture.claudePackageRoot, runtimeHost: "claude-code-cli", projectRoot, boundaryPath: fixture.boundaryPath, projectId: "fx-project", mode: "observe", runIds: [runId] });
      expect(observation.runs[0].run_id).toBe(runId);
      expect(existsSync(finalDirectory)).toBe(true);
    } finally { rename.mockRestore(); rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("revalidates live receipt authority before accepting an existing final evidence directory", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-recovery-authority";
    let acquire: jest.SpyInstance | null = null;
    try {
      observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z");
      acquire = jest.spyOn(defaultJournalIo, "acquireLock").mockReturnValue(false);
      expect(() => createMigrationObservation({
        pluginRoot: fixture.claudePackageRoot,
        runtimeHost: "claude-code-cli",
        projectRoot,
        boundaryPath: fixture.boundaryPath,
        projectId: "fx-project",
        mode: "observe",
        runIds: [runId],
      })).toThrow(/recovery could not lock the live receipt journal/i);
      expect(acquire).toHaveBeenCalled();
    } finally {
      acquire?.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses and removes a publication redirected outside the project during rename", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const externalRoot = mkdtempSync(join(tmpdir(), "guild-window-external-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-redirected-publish";
    const fsModule = require("node:fs") as typeof import("node:fs");
    const realRename = fsModule.renameSync.bind(fsModule);
    const boundaryParent = join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash);
    const displacedParent = `${boundaryParent}.held`;
    let planted = true;
    const rename = jest.spyOn(fsModule, "renameSync").mockImplementation(((source: string, destination: string) => {
      if (planted && source.includes("/migration-evidence/.pending/") && destination.endsWith(`/${runId}`)) {
        planted = false;
        realRename(boundaryParent, displacedParent);
        symlinkSync(externalRoot, boundaryParent, "dir");
      }
      realRename(source, destination);
    }) as typeof fsModule.renameSync);
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z"))
        .toThrow(/escaped or changed identity after rename/i);
      expect(existsSync(join(externalRoot, runId))).toBe(false);
    } finally {
      rename.mockRestore();
      try { rmSync(boundaryParent, { force: true }); } catch { /* best effort test cleanup */ }
      if (existsSync(displacedParent)) realRename(displacedParent, boundaryParent);
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("refuses and removes publication when the live terminal seal changes during commit", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const runId = "run-20260821-090000-concurrent-terminal";
    const fsModule = require("node:fs") as typeof import("node:fs");
    const realRename = fsModule.renameSync.bind(fsModule);
    let planted = true;
    const rename = jest.spyOn(fsModule, "renameSync").mockImplementation(((source: string, destination: string) => {
      realRename(source, destination);
      if (planted && source.includes("/migration-evidence/.pending/") && destination.endsWith(`/${runId}`)) {
        planted = false;
        const receipts = join(projectRoot, ".guild", "runs", runId, "receipts");
        const journalPath = join(receipts, "journal.jsonl");
        const checkpointPath = join(receipts, "checkpoint.json");
        const scan = scanReceiptJournal(journalPath);
        const last = scan.records[scan.records.length - 1];
        const { schema_version: _schema, record_hash: _hash, sequence: _sequence, ...lastInput } = last;
        const later = sealReceiptRecord({
          ...lastInput,
          sequence: last.sequence + 1,
          operation_id: `planted-concurrent-terminal:${runId}`,
          correlation_id: `planted-concurrent-terminal:${runId}`,
          event_id: `planted-concurrent-terminal:${runId}:event`,
          causation_id: last.event_id,
          recorded_at: new Date(Date.parse(last.recorded_at) + 1_000).toISOString(),
          observed_at: new Date(Date.parse(last.recorded_at) + 1_000).toISOString(),
          terminal: true,
        });
        writeFileSync(journalPath, `${JSON.stringify(later)}\n`, { flag: "a" });
        const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
        checkpoint.last_sequence = later.sequence;
        checkpoint.last_event_id = later.event_id;
        checkpoint.record_count = scan.records.length + 1;
        checkpoint.updated_at = later.recorded_at;
        writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
      }
    }) as typeof fsModule.renameSync);
    try {
      expect(() => observationFixture(projectRoot, fixture, runId, false, "observe", "2026-08-21T09:00:00.000Z"))
        .toThrow(/terminal seal became stale|receipt authority detached/i);
      expect(existsSync(join(projectRoot, ".guild", "artifacts", "capability", "migration-evidence", fixture.boundary.boundary_hash, runId))).toBe(false);
    } finally {
      rename.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("recovers baseline staging and a journal-won checkpoint failure without duplicate receipts", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const runId = `run-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 8)}-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(8, 14)}-baseline-recovery`;
    const startedAt = new Date().toISOString();
    writeRunState(projectRoot, runId, startedAt, "open");
    const checkpoint = jest.spyOn(defaultJournalIo, "writeCheckpoint").mockImplementationOnce(() => { throw new Error("planted checkpoint crash"); });
    try {
      const baseline = captureMigrationRunBaseline({ projectRoot, runId });
      checkpoint.mockRestore();
      const journalPath = join(projectRoot, ".guild", "runs", runId, "receipts", "journal.jsonl");
      expect(scanReceiptJournal(journalPath).records.filter((record) => record.operation_id === `capability-baseline:${runId}`)).toHaveLength(1);

      const finalPath = join(projectRoot, ".guild", "runs", runId, "capability", "run-start-baseline.json");
      const pendingPath = join(projectRoot, ".guild", "runs", runId, "capability", "run-start-baseline.pending.json");
      renameSync(finalPath, pendingPath);
      expect(captureMigrationRunBaseline({ projectRoot, runId })).toEqual(baseline);
      expect(existsSync(finalPath)).toBe(true);
      expect(scanReceiptJournal(journalPath).records.filter((record) => record.operation_id === `capability-baseline:${runId}`)).toHaveLength(1);

      renameSync(finalPath, pendingPath);
      rmSync(journalPath, { force: true });
      rmSync(join(projectRoot, ".guild", "runs", runId, "receipts", "checkpoint.json"), { force: true });
      expect(() => captureMigrationRunBaseline({ projectRoot, runId })).toThrow(/lifecycle start receipt|pending file has no prior append-only capture receipt/i);
    } finally { checkpoint.mockRestore(); rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("does not bless a capability-tree mutation between run start and baseline publication", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const runId = "run-20260821-090000-start-gap-control";
    try {
      writeRunState(projectRoot, runId, "2026-08-21T08:59:58.000Z", "open");
      mkdirSync(join(projectRoot, ".guild", "agents"), { recursive: true });
      writeFileSync(join(projectRoot, ".guild", "agents", "planted-after-start.md"), "mutation after start\n");
      const baseline = captureMigrationRunBaseline({ projectRoot, runId });
      const current = snapshotTreeHashes(projectRoot)!;
      expect(baseline.agents).not.toBe(current.agents);
      const emitted = emitCapabilityProfile({
        projectRoot,
        runId,
        projectId: "fx-project",
        generatedAt: "2026-08-21T09:00:00.000Z",
        sourceCommit: projectSourceCommit(projectRoot),
        resolverMode: "observe",
        facts: { domains: [], boundaries: [], repeated_methods: [], coverage: { covered: [], uncovered: [], unmatched_roles: [] }, candidates: [] },
        baselineHashes: profileBaselineFromMigrationRunBaseline(baseline),
      });
      expect(emitted).toEqual(expect.objectContaining({ status: "refused", code: "mutation_detected" }));
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("refuses a self-consistent snapshot plus manifest replacement after run start", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const runId = "run-20260821-090000-start-snapshot-substitution";
    const startedAt = "2026-08-21T08:59:58.000Z";
    try {
      writeRunState(projectRoot, runId, startedAt, "open");
      mkdirSync(join(projectRoot, ".guild", "agents"), { recursive: true });
      writeFileSync(join(projectRoot, ".guild", "agents", "planted-before-recapture.md"), "late mutation\n");
      const hashes = snapshotTreeHashes(projectRoot)!;
      const replacement = Buffer.from(`${JSON.stringify({
        schema_version: CAPABILITY_RUN_START_SNAPSHOT_SCHEMA,
        run_id: runId,
        run_started_at: startedAt,
        captured_at: startedAt,
        ...hashes,
        bound_root: baselineBinding(projectRoot),
        bound_run_id: runId,
      }, null, 2)}\n`);
      const replacementHash = createHash("sha256").update(replacement).digest("hex");
      writeFileSync(join(projectRoot, ".guild", "runs", runId, "capability", "run-start-snapshot.json"), replacement);
      writeFileSync(join(projectRoot, ".guild", "runs", runId, "run.yaml"), `schema_version: guild.run.v1\nrun_id: ${runId}\nstarted_at: ${startedAt}\ncapability_start_snapshot_ref:\n  path: capability/run-start-snapshot.json\n  sha256: ${replacementHash}\nstatus: open\n`);
      expect(() => captureMigrationRunBaseline({ projectRoot, runId })).toThrow(/lifecycle run-start snapshot receipt is invalid or detached/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("hash-binds the retained baseline and refuses post-observation replacement", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-baseline-tamper", false, "observe", "2026-08-21T09:00:00.000Z");
      const baselinePath = join(projectRoot, evidence.observation.runs[0].baseline.path);
      writeFileSync(baselinePath, `${readFileSync(baselinePath, "utf8")} `);
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: evidence.observationPath })).toThrow(/evidence hash mismatch/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("refuses a shaped baseline whose append-only tool capture receipt is absent", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      expect(() => observationFixture(projectRoot, fixture, "run-20260821-090000-forged-baseline", false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), undefined, { removeBaselineReceipt: true })).toThrow(/lifecycle start receipt|append-only capture receipt/i);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("keeps legacy observations readable for history but never counts or records them for advancement", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const next = boundaryFixture("2.7.0-beta.3", 1788508800);
    try {
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-legacy", false, "observe", "2026-08-21T09:00:00.000Z");
      const legacy = asLegacyObservation(evidence.observation);
      const legacyPath = writeMigrationObservation(join(fixture.root, "observations", "legacy"), legacy as never);
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" });
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: fixture.boundaryPath, observationPath: legacyPath })).toThrow(/baseline-bound v2/i);
      const historical = validateMigrationWindow({
        schema_version: MIGRATION_WINDOW_SCHEMA,
        project_id: "fx-project",
        mode: "observe",
        entered_at: fixture.boundary.merged_at,
        entry_boundary: fixture.boundary,
        releases: [fixture.boundary],
        observations: [legacy],
        completed_phases: [],
        actor: "operator",
      });
      expect(historical).not.toBeNull();
      expect(evaluateMigrationAdvance(historical!, "shadow", next.boundary)).toEqual(expect.objectContaining({
        passed: false,
        release_count: 0,
        run_count: 0,
        blockers: expect.arrayContaining([expect.stringMatching(/baseline-bound v2/)]),
      }));
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); rmSync(next.root, { recursive: true, force: true }); }
  });

  it("restarts only a legacy observe window at a newer attested beta and retains the complete prior state", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const next = boundaryFixture("2.7.0-beta.3", 1787904000);
    try {
      const started = startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: first.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, first, "run-20260821-090000-legacy-restart", false, "observe", "2026-08-21T09:00:00.000Z");
      const legacy = asLegacyObservation(evidence.observation);
      const legacyWindow = validateMigrationWindow({ ...started, releases: [first.boundary], observations: [legacy] });
      expect(legacyWindow).not.toBeNull();
      writeMigrationWindow(projectRoot, legacyWindow!);
      const nextEvidence = observationFixture(projectRoot, next, "run-20260828-090000-v2-before-restart");
      expect(() => recordMigrationRelease({ projectRoot, boundaryPath: next.boundaryPath, observationPath: nextEvidence.observationPath })).toThrow(/restart.*before recording v2/i);

      const result = restartMigrationWindow({ projectRoot, boundaryPath: next.boundaryPath, actor: "operator", reason: "baseline-bound observation v2 supersedes the legacy evidence contract" });
      expect(result.status).toBe("restarted");
      expect(result.window).toEqual(expect.objectContaining({
        mode: "observe",
        entry_boundary: next.boundary,
        releases: [],
        observations: [],
        completed_phases: [],
      }));
      expect(result.history_path.startsWith(`${MIGRATION_RESTART_HISTORY_RELPATH}/`)).toBe(true);
      const restartRecord = validateMigrationRestartRecord(JSON.parse(readFileSync(join(projectRoot, result.history_path), "utf8")));
      expect(restartRecord?.prior_window).toEqual(legacyWindow);
      expect(restartRecord?.next_window).toEqual(expect.objectContaining({
        mode: result.window.mode,
        entered_at: result.window.entered_at,
        entry_boundary: result.window.entry_boundary,
      }));
      expect(restartRecord?.next_window.restart_history).toBeUndefined();
      expect(result.window.restart_history).toEqual({ path: result.history_path, sha256: result.restart_hash });
      expect(readMigrationWindow(projectRoot)).toEqual(result.window);
      expect(readFeatureGateRegistry(projectRoot)).toEqual(expect.objectContaining({
        resolver_mode: "observe",
        revision: 1,
        history: [expect.objectContaining({ from: "observe", to: "observe", reason: `D03 migration-window restart for baseline-bound v2 evidence [restart_hash=${result.restart_hash}]` })],
      }));
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(first.root, { recursive: true, force: true }); rmSync(next.root, { recursive: true, force: true }); }
  });

  it("restarts a legacy shadow window in place without discarding completed observe history", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixtures = [
      boundaryFixture("2.7.0-beta.2", 1787299200),
      boundaryFixture("2.7.0-beta.3", 1787904000),
      boundaryFixture("2.7.0-beta.4", 1788508800),
      boundaryFixture("2.7.0-beta.5", 1788508800 + 14 * 86_400),
      boundaryFixture("2.7.0-beta.6", 1788508800 + 21 * 86_400),
    ];
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixtures[0].boundaryPath, actor: "operator" });
      const runDates = ["20260821", "20260828", "20260904"];
      for (let index = 0; index < 3; index += 1) {
        const evidence = observationFixture(projectRoot, fixtures[index], `run-${runDates[index]}-090000-observe-shadow-restart-${index}`, false, "observe", index === 0 ? "2026-08-21T09:00:00.000Z" : undefined);
        recordMigrationRelease({ projectRoot, boundaryPath: fixtures[index].boundaryPath, observationPath: evidence.observationPath });
      }
      expect(advanceMigrationWindow({ projectRoot, to: "shadow", boundaryPath: fixtures[3].boundaryPath, actor: "operator" }).status).toBe("advanced");
      const advanced = readMigrationWindow(projectRoot)!;
      expect(advanced.completed_phases.map((phase) => phase.mode)).toEqual(["observe"]);
      const shadowEvidence = observationFixture(projectRoot, fixtures[3], "run-20260918-090000-legacy-shadow-restart", false, "shadow");
      const legacyShadow = asLegacyObservation(shadowEvidence.observation);
      const legacyWindow = validateMigrationWindow({ ...advanced, releases: [fixtures[3].boundary], observations: [legacyShadow] });
      expect(legacyWindow).not.toBeNull();
      writeMigrationWindow(projectRoot, legacyWindow!);

      const result = restartMigrationWindow({ projectRoot, boundaryPath: fixtures[4].boundaryPath, actor: "operator", reason: "upgrade legacy shadow evidence without losing the completed observe phase" });
      expect(result.window.mode).toBe("shadow");
      expect(result.window.completed_phases).toEqual(advanced.completed_phases);
      expect(readFeatureGateRegistry(projectRoot)?.history.at(-1)).toEqual(expect.objectContaining({ from: "shadow", to: "shadow" }));
      expect(validateMigrationRestartRecord(JSON.parse(readFileSync(join(projectRoot, result.history_path), "utf8")))?.prior_window).toEqual(legacyWindow);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); for (const fixture of fixtures) rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it.each(["missing", "tampered", "gate-entry-missing"] as const)("refuses live restart state when its hash-bound history is %s", (condition) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const next = boundaryFixture("2.7.0-beta.3", 1787904000);
    try {
      const started = startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: first.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, first, `run-20260821-090000-legacy-${condition}`, false, "observe", "2026-08-21T09:00:00.000Z");
      const legacyWindow = validateMigrationWindow({ ...started, releases: [first.boundary], observations: [asLegacyObservation(evidence.observation)] });
      expect(legacyWindow).not.toBeNull();
      writeMigrationWindow(projectRoot, legacyWindow!);
      const result = restartMigrationWindow({ projectRoot, boundaryPath: next.boundaryPath, actor: "operator", reason: "upgrade the legacy evidence window" });
      const historyPath = join(projectRoot, result.history_path);
      if (condition === "missing") rmSync(historyPath);
      else if (condition === "tampered") {
        const history = JSON.parse(readFileSync(historyPath, "utf8"));
        history.reason = "detached replacement";
        writeFileSync(historyPath, `${JSON.stringify(history, null, 2)}\n`);
      } else {
        const gatePath = join(projectRoot, FEATURE_GATE_RELPATH);
        const gates = JSON.parse(readFileSync(gatePath, "utf8"));
        gates.history = [];
        writeFileSync(gatePath, `${JSON.stringify(gates, null, 2)}\n`);
      }
      expect(inspectMigrationWindow(projectRoot)).toEqual({ status: "invalid_or_recovery_required" });
      expect(readMigrationWindow(projectRoot)).toBeNull();
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(first.root, { recursive: true, force: true }); rmSync(next.root, { recursive: true, force: true }); }
  });

  it("keeps a previously valid v1 observation readable when its profile predates the qualifying receipt", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    try {
      const profileAt = new Date(Date.parse(fixture.boundary.merged_at) + 10_000).toISOString();
      const evidence = observationFixture(projectRoot, fixture, "run-20260821-090000-legacy-order", false, "observe", profileAt);
      const legacy = JSON.parse(JSON.stringify(asLegacyObservation(evidence.observation)));
      const profilePath = join(projectRoot, legacy.runs[0].profile.path);
      const journalPath = join(projectRoot, legacy.runs[0].journal.path);
      const qualifyingReceipt = readFileSync(journalPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)).find((record) => String(record.operation_id).startsWith("compatibility-read:"));
      const profile = JSON.parse(readFileSync(profilePath, "utf8"));
      profile.generated_at = new Date(Date.parse(qualifyingReceipt.recorded_at) - 1_000).toISOString();
      writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
      legacy.runs[0].profile.sha256 = createHash("sha256").update(readFileSync(profilePath)).digest("hex");
      legacy.observed_at = profile.generated_at;
      const { observation_hash: _observationHash, ...body } = legacy;
      legacy.observation_hash = createHash("sha256").update(canonical(body)).digest("hex");
      expect(verifyMigrationObservation(projectRoot, legacy).schema_version).toBe("guild.capability_migration_observation.v1");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(fixture.root, { recursive: true, force: true }); }
  });

  it("recovers a restart interrupted while installing its hash-bound history", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const next = boundaryFixture("2.7.0-beta.3", 1787904000);
    const fsModule = require("node:fs") as typeof import("node:fs");
    const renameSync = fsModule.renameSync.bind(fsModule);
    let planted = true;
    let rename: jest.SpyInstance | null = null;
    try {
      const started = startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: first.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, first, "run-20260821-090000-legacy-recovery", false, "observe", "2026-08-21T09:00:00.000Z");
      const legacyWindow = validateMigrationWindow({ ...started, releases: [first.boundary], observations: [asLegacyObservation(evidence.observation)] });
      expect(legacyWindow).not.toBeNull();
      writeMigrationWindow(projectRoot, legacyWindow!);

      rename = jest.spyOn(fsModule, "renameSync").mockImplementation(((source: string, destination: string) => {
        if (planted && destination.includes(MIGRATION_RESTART_HISTORY_RELPATH)) {
          planted = false;
          throw new Error("planted restart-history crash");
        }
        renameSync(source, destination);
      }) as typeof fsModule.renameSync);

      expect(() => restartMigrationWindow({ projectRoot, boundaryPath: next.boundaryPath, actor: "operator", reason: "upgrade the legacy evidence window" })).toThrow(/restart history write refused.*planted restart-history crash/i);
      const pending = JSON.parse(readFileSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH), "utf8"));
      expect(pending.restart_record).toEqual(expect.objectContaining({ schema_version: "guild.capability_migration_restart.v1" }));
      expect(existsSync(join(projectRoot, MIGRATION_RESTART_HISTORY_RELPATH, `${pending.restart_record.restart_hash}.json`))).toBe(false);
      expect(readFeatureGateRegistry(projectRoot)?.revision).toBe(1);

      rename.mockRestore();
      rename = null;
      const retainedProfile = join(projectRoot, pending.restart_record.prior_window.observations[0].runs[0].profile.path);
      const retainedBytes = readFileSync(retainedProfile);
      writeFileSync(retainedProfile, Buffer.concat([retainedBytes, Buffer.from(" ")]));
      expect(() => recoverMigrationTransition(projectRoot)).toThrow(/evidence hash mismatch/i);
      expect(existsSync(join(projectRoot, MIGRATION_RESTART_HISTORY_RELPATH, `${pending.restart_record.restart_hash}.json`))).toBe(false);
      writeFileSync(retainedProfile, retainedBytes);
      expect(recoverMigrationTransition(projectRoot)).toBe(true);
      const historyPath = join(projectRoot, MIGRATION_RESTART_HISTORY_RELPATH, `${pending.restart_record.restart_hash}.json`);
      expect(validateMigrationRestartRecord(JSON.parse(readFileSync(historyPath, "utf8")))).toEqual(pending.restart_record);
      expect(readMigrationWindow(projectRoot)?.entry_boundary.release).toBe("2.7.0-beta.3");
      expect(existsSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH))).toBe(false);
    } finally {
      rename?.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(first.root, { recursive: true, force: true });
      rmSync(next.root, { recursive: true, force: true });
    }
  });

  it("refuses to use restart as a general-purpose timer reset for v2 evidence", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const first = boundaryFixture("2.7.0-beta.2", 1787299200);
    const next = boundaryFixture("2.7.0-beta.3", 1787904000);
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: first.boundaryPath, actor: "operator" });
      const evidence = observationFixture(projectRoot, first, "run-20260821-090000-v2-no-restart", false, "observe", "2026-08-21T09:00:00.000Z");
      recordMigrationRelease({ projectRoot, boundaryPath: first.boundaryPath, observationPath: evidence.observationPath });
      expect(() => restartMigrationWindow({ projectRoot, boundaryPath: next.boundaryPath, actor: "operator", reason: "reset timer" })).toThrow(/only allowed.*legacy observations/i);
      expect(existsSync(join(projectRoot, MIGRATION_RESTART_HISTORY_RELPATH))).toBe(false);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); rmSync(first.root, { recursive: true, force: true }); rmSync(next.root, { recursive: true, force: true }); }
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
      expect(() => observationFixture(projectRoot, fixture, `run-20260821-090000-wrong-${binding}`, false, "observe", "2026-08-21T09:00:00.000Z", projectSourceCommit(projectRoot), binding)).toThrow(/no non-synthetic|substantive operation.*specialist|pre-existing resolver-emitted substantive operation/i);
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
      expect(readFileSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH), "utf8")).toContain("guild.capability_migration_transition.v2");
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

  it("recovers a pending v1 start intent left by the immediately preceding release", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixture = boundaryFixture("2.7.0-beta.2", 1787299200);
    const unlink = jest.spyOn(require("node:fs"), "unlinkSync").mockImplementationOnce(() => { throw new Error("planted legacy cleanup crash"); });
    try {
      expect(() => startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixture.boundaryPath, actor: "operator" })).toThrow(/planted legacy cleanup crash/i);
      unlink.mockRestore();
      const intentPath = join(projectRoot, MIGRATION_TRANSITION_RELPATH);
      const current = JSON.parse(readFileSync(intentPath, "utf8"));
      const legacyCandidate = {
        schema_version: "guild.capability_migration_transition.v1",
        operation: current.operation,
        prior_window: current.prior_window,
        prior_gates: current.prior_gates,
        next_window: current.next_window,
        next_gates: current.next_gates,
      };
      writeFileSync(intentPath, `${JSON.stringify({ ...legacyCandidate, intent_hash: createHash("sha256").update(canonical(legacyCandidate)).digest("hex") }, null, 2)}\n`);
      expect(recoverMigrationTransition(projectRoot)).toBe(true);
      expect(readMigrationWindow(projectRoot)?.mode).toBe("observe");
      expect(existsSync(intentPath)).toBe(false);
    } finally {
      unlink.mockRestore();
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("recovers a partially applied v1 advance intent under the rules that admitted it", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-window-project-"));
    const fixtures = [
      boundaryFixture("2.7.0-beta.2", 1787299200),
      boundaryFixture("2.7.0-beta.3", 1787904000),
      boundaryFixture("2.7.0-beta.4", 1788508800),
      boundaryFixture("2.7.0-beta.5", 1788508800 + 14 * 86_400),
    ];
    try {
      startMigrationWindow({ projectRoot, projectId: "fx-project", mode: "observe", boundaryPath: fixtures[0].boundaryPath, actor: "operator" });
      const runDates = ["20260821", "20260828", "20260904"];
      for (let index = 0; index < 3; index += 1) {
        const profileAt = new Date(Date.parse(fixtures[index].boundary.merged_at) + 12 * 3_600_000).toISOString();
        const evidence = observationFixture(projectRoot, fixtures[index], `run-${runDates[index]}-120000-v1-advance-${index}`, false, "observe", profileAt);
        recordMigrationRelease({ projectRoot, boundaryPath: fixtures[index].boundaryPath, observationPath: evidence.observationPath });
      }
      const current = readMigrationWindow(projectRoot)!;
      const priorWindow = validateMigrationWindow({ ...current, observations: current.observations.map((observation) => asLegacyObservation(observation as never)) })!;
      writeMigrationWindow(projectRoot, priorWindow);
      expect(advanceMigrationWindow({ projectRoot, to: "shadow", boundaryPath: fixtures[3].boundaryPath, actor: "operator" }).status).toBe("refused");
      const priorGates = readFeatureGateRegistry(projectRoot)!;
      const enteredAt = fixtures[3].boundary.merged_at;
      const nextWindow = validateMigrationWindow({
        schema_version: MIGRATION_WINDOW_SCHEMA,
        project_id: priorWindow.project_id,
        mode: "shadow",
        entered_at: enteredAt,
        entry_boundary: fixtures[3].boundary,
        releases: [],
        observations: [],
        completed_phases: [{ mode: "observe", entered_at: priorWindow.entered_at, releases: priorWindow.releases, observations: priorWindow.observations, advanced_with: fixtures[3].boundary }],
        actor: "operator",
      })!;
      const nextGates = {
        ...priorGates,
        resolver_mode: "shadow" as const,
        revision: priorGates.revision + 1,
        updated_at: enteredAt,
        updated_by: "operator",
        history: [...priorGates.history, { from: "observe" as const, to: "shadow" as const, reason: "D03 migration-window advance", recorded_at: enteredAt, actor: "operator" }],
      };
      const candidate = { schema_version: "guild.capability_migration_transition.v1", operation: "advance", prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates };
      writeMigrationWindow(projectRoot, nextWindow);
      writeFileSync(join(projectRoot, MIGRATION_TRANSITION_RELPATH), `${JSON.stringify({ ...candidate, intent_hash: createHash("sha256").update(canonical(candidate)).digest("hex") }, null, 2)}\n`);
      expect(recoverMigrationTransition(projectRoot)).toBe(true);
      expect(readMigrationWindow(projectRoot)?.mode).toBe("shadow");
      expect(readFeatureGateRegistry(projectRoot)?.resolver_mode).toBe("shadow");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      for (const fixture of fixtures) rmSync(fixture.root, { recursive: true, force: true });
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
      const candidate = { schema_version: "guild.capability_migration_transition.v2", operation: "start", prior_window: null, prior_gates: gates, next_window: window, next_gates: gates, restart_record: null };
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
      const legacyCompleted = validateMigrationWindow({
        ...final,
        completed_phases: final.completed_phases.map((phase) => ({
          ...phase,
          observations: phase.observations.map((observation) => asLegacyObservation(observation as never)),
        })),
      });
      expect(legacyCompleted).not.toBeNull();
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
