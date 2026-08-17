/**
 * scripts/__tests__/run-record-validate.test.ts
 *
 * W5 (run-identity-and-dispatch): the deterministic enforcement rail for the
 * shareable-run contract (.guild/wiki/standards/run-record-contract.md).
 *
 * Contract under test:
 *   - Share eligibility requires ALL of: the canonical run-directory name
 *     (run-<yyyymmdd-hhmmss>-<slug>), run.yaml, provenance.json,
 *     logs/v1.4-events.jsonl, and at least one valid lane handoff
 *     (handoffs/<specialist>-<task-id>.md, non-empty).
 *   - Non-run document dumps under .guild/runs/ are REJECTED — while
 *     lifecycle-owned artifacts (_archive/, current-run-id, lock files) are
 *     never misclassified as dumps.
 *   - A REAL machine-readable CLI: JSON findings on stdout, exit 0 for a
 *     share-eligible run, exit non-zero for an invalid candidate.
 *
 * Adversarial positives AND negatives — a validator whose failure legs are
 * untested is a rubber stamp.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import {
  validateRunRecordDir,
  scanRunsRoot,
  RUN_RECORD_VALIDATION_SCHEMA,
} from "../lib/run-record-validate";
import { buildTaskAssignmentV2 } from "../lib/core/contracts/task-cell-backend";

const CLI = path.resolve(__dirname, "../validate-run-record.ts");
const GOOD_RUN = "run-20260811-010758-w5-fixture";

const FENCE = "```";

/** One valid guild.handoff.v2 envelope block (canonical machine contract). */
function v2Block(taskId = "W4-W5"): string {
  return [
    `${FENCE}guild.handoff.v2`,
    JSON.stringify(
      {
        schema_version: "guild.handoff.v2",
        task_id: taskId,
        tier: "powerful",
        status: "done",
        summary: "fixture receipt for the W5 share-eligibility rail",
        artifacts: ["scripts/validate-run-record.ts:1"],
        issues: [],
      },
      null,
      2
    ),
    FENCE,
  ].join("\n");
}

const FIVE_SECTIONS = [
  "## changed_files",
  "- (fixture)",
  "",
  "## opens_for",
  "- lead",
  "",
  "## assumptions",
  "- none",
  "",
  "## evidence",
  "- pinned by run-record-validate.test.ts",
  "",
  "## followups",
  "- none",
].join("\n");

/**
 * The CANONICAL guild.handoff_receipt.v1 wrapper (independent-review blocker
 * 3): frontmatter + the five §8.2 sections + EXACTLY ONE fenced
 * guild.handoff.v2 JSON block that passes the strict canonical validator.
 */
function canonicalReceipt(): string {
  return [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    "task_id: W4-W5",
    "specialist: tooling-engineer",
    "model_family: codex",
    "host: codex-cli",
    "generated_at: 2026-08-12T00:00:00.000Z",
    "---",
    "",
    FIVE_SECTIONS,
    "",
    v2Block(),
    "",
  ].join("\n");
}

type HandoffShape =
  | "valid"
  | "empty"
  | "none"
  | "no-frontmatter"
  | "wrong-frontmatter-schema"
  | "missing-provenance"
  | "mismatched-task-id"
  | "frontmatter-only"
  | "duplicate-block"
  | "invalid-envelope"
  | "missing-sections"
  | "conflicting-provenance"
  | "fenced-only-sections"
  | "tilde-fenced-only-sections"
  | "long-fenced-only-sections";

function handoffBody(shape: HandoffShape): string {
  switch (shape) {
    case "valid":
      return canonicalReceipt();
    case "empty":
      return "";
    case "no-frontmatter":
      return [FIVE_SECTIONS, "", v2Block(), ""].join("\n");
    case "wrong-frontmatter-schema":
      return [
        "---",
        "schema_version: guild.other.v9",
        "task_id: W4-W5",
        "---",
        "",
        FIVE_SECTIONS,
        "",
        v2Block(),
        "",
      ].join("\n");
    case "missing-provenance":
      return canonicalReceipt()
        .replace("specialist: tooling-engineer\n", "")
        .replace("model_family: codex\n", "")
        .replace("host: codex-cli\n", "")
        .replace("generated_at: 2026-08-12T00:00:00.000Z\n", "");
    case "mismatched-task-id":
      return [
        "---",
        "schema_version: guild.handoff_receipt.v1",
        "task_id: SOME-OTHER-TASK",
        "---",
        "",
        FIVE_SECTIONS,
        "",
        v2Block(),
        "",
      ].join("\n");
    case "frontmatter-only":
      // The exact defect the review named: YAML frontmatter claiming the
      // schema, with NO embedded machine envelope.
      return [
        "---",
        "schema_version: guild.handoff.v2",
        "task_id: W4-W5",
        "status: done",
        "---",
        "",
        FIVE_SECTIONS,
        "",
      ].join("\n");
    case "duplicate-block":
      return [canonicalReceipt(), "", v2Block("W4-W5-dup")].join("\n");
    case "invalid-envelope":
      return [
        "---",
        "schema_version: guild.handoff_receipt.v1",
        "---",
        "",
        FIVE_SECTIONS,
        "",
        `${FENCE}guild.handoff.v2`,
        JSON.stringify({
          schema_version: "guild.handoff.v2",
          task_id: "W4-W5",
          tier: "cheap|mid|powerful",
          status: "done",
          summary: "invalid tier — the strict validator must reject this",
          artifacts: [],
          issues: [],
        }),
        FENCE,
        "",
      ].join("\n");
    case "missing-sections":
      return ["---", "schema_version: guild.handoff_receipt.v1", "---", "", v2Block(), ""].join("\n");
    case "conflicting-provenance":
      return canonicalReceipt()
        .replace("specialist: tooling-engineer\n", "specialist: tooling-engineer\nagent: attacker\n")
        .replace("model_family: codex\n", "model_family: codex\nfamily: claude\n");
    case "fenced-only-sections":
      return [
        "---",
        "schema_version: guild.handoff_receipt.v1",
        "task_id: W4-W5",
        "specialist: tooling-engineer",
        "model_family: codex",
        "host: codex-cli",
        "generated_at: 2026-08-12T00:00:00.000Z",
        "---",
        "",
        `${FENCE}text`,
        FIVE_SECTIONS,
        FENCE,
        "",
        v2Block(),
        "",
      ].join("\n");
    case "tilde-fenced-only-sections":
      return handoffBody("fenced-only-sections")
        .replace(`${FENCE}text`, "~~~~text")
        .replace(`\n${FENCE}\n\n${FENCE}guild.handoff.v2`, `\n~~~~\n\n${FENCE}guild.handoff.v2`);
    case "long-fenced-only-sections":
      return handoffBody("fenced-only-sections")
        .replace(`${FENCE}text`, "````text")
        .replace(
          `\n${FENCE}\n\n${FENCE}guild.handoff.v2`,
          "\n````\n\n" + FENCE + "guild.handoff.v2",
        );
    case "none":
      return "";
  }
}

function seedTaskCellAssignment(
  root: string,
  runId: string,
  logicalTaskId: string,
  workerRole: string,
): void {
  const assignment = buildTaskAssignmentV2({
    run_id: runId,
    cell_id: `cell-${logicalTaskId}`,
    goal_id: "goal-w5",
    phase_id: "build",
    step_id: "step-w5",
    team_id: "team-w5",
    logical_task_id: logicalTaskId,
    task_run_id: `${logicalTaskId}.tr1`,
    attempt_id: `${logicalTaskId}.att1`,
    instance_id: `${logicalTaskId}.a1.i-w5`,
    worker_role: workerRole,
    specialist_type_id: workerRole,
    specialist_type_version: "1",
    specialist_type_hash: "type-hash",
    specialist_profile_id: workerRole,
    specialist_profile_hash: "profile-hash",
    context_bundle_id: `context-${logicalTaskId}`,
    context_bundle_hash: "context-hash",
    host_id: "codex-cli",
    adapter_id: "codex-cli@test",
    host_capabilities_hash: "capabilities-hash",
    objective: `implement ${logicalTaskId}`,
    non_goals: [],
    scope_paths: [],
    output_schema: "guild.handoff_receipt.v1",
    acceptance_tests: [],
    dependencies: [],
    projection: { tools: ["Read"], permissions: [], recorded_losses: [] },
    autonomy_policy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
    deadline: null,
    written_at: "2026-08-12T00:00:00.000Z",
    attempt: 1,
    lead_binding_id: "lead-w5",
  });
  const abs = path.join(root, assignment.assignment_path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(assignment, null, 2) + "\n", "utf8");
}

function seedRun(
  root: string,
  runId: string,
  opts: {
    runYaml?: boolean;
    provenance?: boolean;
    events?: boolean;
    handoff?: HandoffShape;
    handoffName?: string;
    taskCell?: { logicalTaskId: string; workerRole: string };
  } = {}
): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  if (opts.runYaml !== false) {
    fs.writeFileSync(path.join(runDir, "run.yaml"), `schema_version: guild.run.v1\nrun_id: ${runId}\n`, "utf8");
  }
  if (opts.provenance !== false) {
    fs.writeFileSync(path.join(runDir, "provenance.json"), JSON.stringify({ status: "closed" }) + "\n", "utf8");
  }
  if (opts.events !== false) {
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), '{"event":"UserPromptSubmit"}\n', "utf8");
  }
  const handoff = opts.handoff ?? "valid";
  if (handoff !== "none") {
    fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "handoffs", opts.handoffName ?? "tooling-engineer-W4-W5.md"),
      handoffBody(handoff),
      "utf8"
    );
  }
  if (opts.taskCell) {
    seedTaskCellAssignment(
      root,
      runId,
      opts.taskCell.logicalTaskId,
      opts.taskCell.workerRole,
    );
  }
  return runDir;
}

describe("W5 — validateRunRecordDir (deterministic minimum share set)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-w5-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("POSITIVE: a complete canonical run validates with zero findings", () => {
    const dir = seedRun(root, GOOD_RUN);
    const result = validateRunRecordDir(dir);
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.schema_version).toBe(RUN_RECORD_VALIDATION_SCHEMA);
  });

  it("NEGATIVE: a non-canonical directory name is rejected", () => {
    const dir = seedRun(root, "run-2026-06-14T21-03-36-186Z");
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("non_canonical_name");
  });

  it("NEGATIVE: each missing member of the minimum file set is its own finding", () => {
    const dir = seedRun(root, GOOD_RUN, { provenance: false, events: false, handoff: "none" });
    const codes = validateRunRecordDir(dir).findings.map((f) => f.code);
    expect(codes).toContain("missing_provenance");
    expect(codes).toContain("missing_events_log");
    expect(codes).toContain("no_valid_handoff");
  });

  it("NEGATIVE: an empty handoff file does not satisfy the handoff leg", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "empty" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE (blocker 3): a frontmatter-only receipt with no embedded v2 block is not valid", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "frontmatter-only" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: a machine-valid wrapper with no receipt frontmatter is rejected", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "no-frontmatter" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: a foreign frontmatter schema cannot borrow handoff authority", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "wrong-frontmatter-schema" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: frontmatter and machine-envelope task identities must agree", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "mismatched-task-id" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: receipt provenance required by the canonical document contract cannot be omitted", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "missing-provenance" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: conflicting provenance aliases cannot split filename and author identity", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "conflicting-provenance" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: wrapper sections inside an unrelated code fence do not satisfy the contract", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "fenced-only-sections" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it.each(["tilde-fenced-only-sections", "long-fenced-only-sections"] as const)(
    "NEGATIVE: CommonMark %s headings do not satisfy the wrapper contract",
    (handoff) => {
      const dir = seedRun(root, GOOD_RUN, { handoff });
      const result = validateRunRecordDir(dir);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
    },
  );

  it("NEGATIVE: the receipt task and specialist must bind to the handoff filename", () => {
    const dir = seedRun(root, GOOD_RUN, {
      handoff: "valid",
      handoffName: "tooling-engineer-SOME-OTHER-TASK.md",
    });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("POSITIVE: a receipt binds to the matching TaskCell when the run has TaskCells", () => {
    const dir = seedRun(root, GOOD_RUN, {
      taskCell: { logicalTaskId: "W4-W5", workerRole: "tooling-engineer" },
    });
    expect(validateRunRecordDir(dir).ok).toBe(true);
  });

  it("NEGATIVE: an unrelated TaskCell cannot lend lane identity to a receipt", () => {
    const dir = seedRun(root, GOOD_RUN, {
      taskCell: { logicalTaskId: "SOME-OTHER-TASK", workerRole: "tooling-engineer" },
    });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE (blocker 3): two guild.handoff.v2 blocks is a duplicate-block defect", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "duplicate-block" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE (blocker 3): an envelope failing the strict canonical validator is rejected", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "invalid-envelope" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE (blocker 3): a receipt missing the five §8.2 sections is rejected", () => {
    const dir = seedRun(root, GOOD_RUN, { handoff: "missing-sections" });
    const result = validateRunRecordDir(dir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("no_valid_handoff");
  });

  it("NEGATIVE: a run.yaml-less directory is classified as a document dump", () => {
    const dumpDir = path.join(root, ".guild", "runs", "research-notes");
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, "notes.md"), "# a document dump\n", "utf8");
    const result = validateRunRecordDir(dumpDir);
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("document_dump");
  });
});

describe("W5 — scanRunsRoot (dump rejection without lifecycle misclassification)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-w5-scan-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("flags loose files and run.yaml-less dirs; exempts _archive, current-run-id and dotfiles", () => {
    const runsRoot = path.join(root, ".guild", "runs");
    seedRun(root, GOOD_RUN);
    fs.writeFileSync(path.join(runsRoot, "current-run-id"), `${GOOD_RUN}\n`, "utf8");
    fs.writeFileSync(path.join(runsRoot, ".lock"), "", "utf8");
    fs.mkdirSync(path.join(runsRoot, "_archive", "run-20250101-000000-old"), { recursive: true });
    fs.writeFileSync(path.join(runsRoot, "stray-report.md"), "# dump\n", "utf8");
    fs.mkdirSync(path.join(runsRoot, "ideation-pack"));
    fs.writeFileSync(path.join(runsRoot, "ideation-pack", "ideas.md"), "# dump\n", "utf8");

    const scan = scanRunsRoot(root);
    const dumpPaths = scan.findings.filter((f) => f.code === "document_dump").map((f) => path.basename(f.path));
    expect(dumpPaths).toContain("stray-report.md");
    expect(dumpPaths).toContain("ideation-pack");
    expect(dumpPaths).not.toContain("_archive");
    expect(dumpPaths).not.toContain("current-run-id");
    expect(dumpPaths).not.toContain(".lock");
    expect(dumpPaths).not.toContain(GOOD_RUN);
  });
});

describe("W5 — validate-run-record CLI (real entry, machine-readable, non-zero exit)", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-w5-cli-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
    const result = spawnSync("npx", ["tsx", CLI, ...args], {
      encoding: "utf8",
      timeout: 60_000,
    });
    return { exitCode: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  }

  it("POSITIVE: exit 0 + JSON {ok:true} for a share-eligible run", () => {
    seedRun(root, GOOD_RUN);
    const { exitCode, stdout } = runCli(["--cwd", root, "--run-id", GOOD_RUN]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.schema_version).toBe(RUN_RECORD_VALIDATION_SCHEMA);
    expect(parsed.ok).toBe(true);
    expect(parsed.findings).toEqual([]);
  });

  it("NEGATIVE: exit 1 + JSON findings for an invalid candidate", () => {
    seedRun(root, GOOD_RUN, { provenance: false });
    const { exitCode, stdout } = runCli(["--cwd", root, "--run-id", GOOD_RUN]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.findings.map((f: { code: string }) => f.code)).toContain("missing_provenance");
  });

  it("NEGATIVE: exit 1 for a document dump named via --run-id", () => {
    const dumpDir = path.join(root, ".guild", "runs", "handoff-bundle");
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, "bundle.md"), "# dump\n", "utf8");
    const { exitCode, stdout } = runCli(["--cwd", root, "--run-id", "handoff-bundle"]);
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).findings.map((f: { code: string }) => f.code)).toContain("document_dump");
  });

  it("--scan reports dumps across the runs root and exits 1 when any exist", () => {
    seedRun(root, GOOD_RUN);
    fs.writeFileSync(path.join(root, ".guild", "runs", "stray.md"), "# dump\n", "utf8");
    const { exitCode, stdout } = runCli(["--cwd", root, "--scan"]);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.findings.some((f: { code: string }) => f.code === "document_dump")).toBe(true);
  });

  it("usage error (no target) exits 2 with JSON on stdout", () => {
    const { exitCode, stdout } = runCli(["--cwd", root]);
    expect(exitCode).toBe(2);
    expect(JSON.parse(stdout).ok).toBe(false);
  });
});
