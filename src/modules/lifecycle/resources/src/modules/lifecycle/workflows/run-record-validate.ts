/**
 * src/modules/lifecycle/workflows/run-record-validate.ts
 *
 * W5 (run-identity-and-dispatch): the deterministic enforcement rail for the
 * shareable-run contract (.guild/wiki/standards/run-record-contract.md).
 *
 * A run directory is SHARE-ELIGIBLE iff ALL of:
 *   - its directory name is canonical (run-<yyyymmdd-hhmmss>-<slug> — the ONE
 *     creation-time contract, `isCanonicalRunId` from run-lifecycle);
 *   - `run.yaml` exists (a run startRun actually opened);
 *   - `provenance.json` exists (what produced the run);
 *   - `logs/v1.4-events.jsonl` exists (the trace channel);
 *   - at least one VALID lane handoff exists — a non-empty
 *     `handoffs/<specialist>-<task-id>.md`.
 *
 * Non-run DOCUMENT DUMPS under `.guild/runs/` (reports, research packets,
 * ideation sets, handoff bundles detached from a run) are REJECTED — while the
 * lifecycle-owned entries the contract names (`_archive/` rotation,
 * `current-run-id`, dot-prefixed lock/system files) are never misclassified.
 *
 * Pure, deterministic, fail-closed: every check is a plain filesystem read;
 * findings are typed records; no repair, no side effects. The machine-readable
 * CLI lives at scripts/validate-run-record.ts.
 */

import * as fs from "fs";
import * as path from "path";

import { isCanonicalRunId } from "./run-lifecycle";
// Blocker 3 (independent review): the handoff leg validates the CANONICAL
// receipt contract, not filename+bytes. The strict guild.handoff.v2 validator
// is single-sourced in the distribution module (acyclic: distribution does not
// depend on lifecycle).
import { validateHandoffV2 } from "../../distribution";
import {
  parseReceiptDocument,
  readReceiptFrontmatter,
  RECEIPT_FRONTMATTER_SCHEMA_VERSION,
} from "../../documents";
import { validateTaskAssignmentV2 } from "../../dispatch";

export const RUN_RECORD_VALIDATION_SCHEMA = "guild.run_record_validation.v1" as const;

/** The closed finding vocabulary. */
export const RUN_RECORD_FINDING_CODES = Object.freeze([
  "non_canonical_name",
  "missing_run_yaml",
  "missing_provenance",
  "missing_events_log",
  "no_valid_handoff",
  "document_dump",
  "not_a_directory",
  "usage",
] as const);

export type RunRecordFindingCode = (typeof RUN_RECORD_FINDING_CODES)[number];

export interface RunRecordFinding {
  code: RunRecordFindingCode;
  /** The path the finding is about (absolute or as given by the caller). */
  path: string;
  detail: string;
}

export interface RunRecordValidation {
  schema_version: typeof RUN_RECORD_VALIDATION_SCHEMA;
  /** What was validated: one run directory, or a whole runs root scan. */
  target: string;
  ok: boolean;
  findings: RunRecordFinding[];
}

/** Lifecycle-owned entries under `.guild/runs/` that are never document dumps. */
const LIFECYCLE_OWNED_ENTRIES: ReadonlySet<string> = new Set(["_archive", "current-run-id"]);

function isRegularFile(p: string): boolean {
  try {
    const stat = fs.lstatSync(p);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isNonEmptyFile(p: string): boolean {
  try {
    const stat = fs.lstatSync(p);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0;
  } catch {
    return false;
  }
}

/** `handoffs/<specialist>-<task-id>.md` — the minimum per-lane receipt shape. */
const HANDOFF_NAME_RE = /^[A-Za-z0-9_.]+(?:[A-Za-z0-9_.-]*)-[A-Za-z0-9_.-]+\.md$/;

/**
 * The canonical receipt fence (execute-plan dispatch.md §"single-channel
 * protocol"): a `guild.handoff_receipt.v1` Markdown wrapper embeds EXACTLY ONE
 * fenced ```guild.handoff.v2``` JSON block. The GLOBAL flag lets this rail
 * count blocks — zero (frontmatter-only) and >=2 (duplicate-block) are both
 * defects the wrapper contract rejects.
 */
const V2_FENCE_RE = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/g;

/** The five §8.2 wrapper sections a lane receipt must carry (PART B). */
const RECEIPT_SECTIONS = Object.freeze([
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups",
] as const);

/** Remove CommonMark backtick/tilde fenced blocks before reading wrapper headings. */
function receiptWrapperText(content: string): string {
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (fence === null) {
      const opened = /^[ \t]{0,3}(`{3,}|~{3,})(?:[^\n]*)$/.exec(line);
      if (opened) {
        fence = {
          marker: opened[1][0] as "`" | "~",
          length: opened[1].length,
        };
        continue;
      }
      output.push(line);
      continue;
    }
    const trimmed = line.replace(/^[ \t]{0,3}/, "");
    const close = new RegExp(`^${fence.marker === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`);
    if (close.test(trimmed)) fence = null;
  }
  return output.join("\n");
}

/**
 * Blocker 3 (independent review): a "valid lane handoff" is the CANONICAL
 * receipt, not any non-empty name-matching Markdown file:
 *   - EXACTLY ONE fenced guild.handoff.v2 block (0 = frontmatter-only defect,
 *     >=2 = duplicate-block defect);
 *   - the block parses as JSON and passes the strict canonical
 *     `validateHandoffV2` (distribution module — single source of truth);
 *   - all five §8.2 wrapper sections are present as `## <name>` headings.
 * Junk, truncated, or frontmatter-only receipts no longer satisfy share
 * eligibility.
 */
interface LaneReceiptIdentity {
  taskId: string;
  specialist: string;
}

function canonicalLaneReceiptIdentity(
  content: string,
  receiptName?: string,
): LaneReceiptIdentity | null {
  const frontmatter = readReceiptFrontmatter(content);
  if (!frontmatter.ok) return null;
  if (
    frontmatter.fields["schema_version"] !==
    RECEIPT_FRONTMATTER_SCHEMA_VERSION
  ) {
    return null;
  }
  const frontmatterTaskId = frontmatter.fields["task_id"];
  if (typeof frontmatterTaskId !== "string" || frontmatterTaskId.length === 0) {
    return null;
  }
  const specialist = frontmatter.fields["specialist"] ?? frontmatter.fields["agent"];
  if (typeof specialist !== "string" || specialist.length === 0) return null;
  if (receiptName !== undefined && receiptName !== `${specialist}-${frontmatterTaskId}.md`) {
    return null;
  }
  // Reuse the documents module's canonical provenance validator rather than
  // maintaining a weaker lifecycle-local subset. This requires author,
  // model-family, host, and generation-time provenance.
  if (parseReceiptDocument(content).status !== "parsed") return null;

  const blocks = [...content.matchAll(V2_FENCE_RE)];
  if (blocks.length !== 1) return null;
  let envelope: unknown;
  try {
    envelope = JSON.parse(blocks[0][1].trim());
  } catch {
    return null;
  }
  if (!validateHandoffV2(envelope).valid) return null;
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    (envelope as Record<string, unknown>)["task_id"] !== frontmatterTaskId
  ) {
    return null;
  }
  const wrapperText = receiptWrapperText(content);
  if (!RECEIPT_SECTIONS.every((section) =>
    new RegExp(`^##\\s+${section}\\b`, "m").test(wrapperText)
  )) return null;
  return { taskId: frontmatterTaskId, specialist };
}

export function isCanonicalLaneReceipt(content: string, receiptName?: string): boolean {
  return canonicalLaneReceiptIdentity(content, receiptName) !== null;
}

function taskCellBindings(runDir: string): ReadonlySet<string> | null {
  const root = path.join(runDir, "task-cells");
  if (!fs.existsSync(root)) return null;
  const bindings = new Set<string>();
  const runId = path.basename(runDir);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || entry.name !== "assignment.json") continue;
      try {
        const assignment = validateTaskAssignmentV2(JSON.parse(fs.readFileSync(abs, "utf8")));
        if (assignment !== null && assignment.run_id === runId) {
          bindings.add(`${assignment.worker_role}\0${assignment.logical_task_id}`);
        }
      } catch {
        // A malformed assignment never supplies lane identity.
      }
    }
  };
  walk(root);
  return bindings;
}

function hasValidLaneHandoff(runDir: string): boolean {
  const handoffsDir = path.join(runDir, "handoffs");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(handoffsDir, { withFileTypes: true });
  } catch {
    return false;
  }
  const bindings = taskCellBindings(runDir);
  return entries.some((entry) => {
    if (!entry.isFile() || !HANDOFF_NAME_RE.test(entry.name)) return false;
    const abs = path.join(handoffsDir, entry.name);
    if (!isNonEmptyFile(abs)) return false;
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      return false;
    }
    const identity = canonicalLaneReceiptIdentity(content, entry.name);
    if (identity === null) return false;
    return bindings === null || bindings.has(`${identity.specialist}\0${identity.taskId}`);
  });
}

/**
 * Validate ONE candidate run directory against the minimum shareable set.
 *
 * Classification rule (per the contract's "what does not belong in runs/"):
 * a directory with NEITHER a canonical run name NOR a `run.yaml` is not a
 * run-shaped candidate at all — it is a document dump, reported as exactly
 * that one finding. A canonical-named directory missing `run.yaml` (or a
 * legacy-named directory that HAS one) is a broken/legacy RUN and gets the
 * precise per-file findings instead — never misclassified as a dump.
 */
export function validateRunRecordDir(runDir: string): RunRecordValidation {
  const findings: RunRecordFinding[] = [];
  const name = path.basename(runDir);

  let isDir = false;
  try {
    isDir = fs.lstatSync(runDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return {
      schema_version: RUN_RECORD_VALIDATION_SCHEMA,
      target: runDir,
      ok: false,
      findings: [
        {
          code: "not_a_directory",
          path: runDir,
          detail: "run-record candidate is not a directory",
        },
      ],
    };
  }

  const canonical = isCanonicalRunId(name);
  const hasRunYaml = isRegularFile(path.join(runDir, "run.yaml"));

  if (!canonical && !hasRunYaml) {
    return {
      schema_version: RUN_RECORD_VALIDATION_SCHEMA,
      target: runDir,
      ok: false,
      findings: [
        {
          code: "document_dump",
          path: runDir,
          detail:
            "neither a canonical run name nor a run.yaml — a non-run document dump; " +
            "move it to .guild/artifacts/ (run-record-contract §what does not belong in runs/)",
        },
      ],
    };
  }

  if (!canonical) {
    findings.push({
      code: "non_canonical_name",
      path: runDir,
      detail: `directory name ${JSON.stringify(name)} is not run-<yyyymmdd-hhmmss>-<slug>`,
    });
  }
  if (!hasRunYaml) {
    findings.push({
      code: "missing_run_yaml",
      path: path.join(runDir, "run.yaml"),
      detail: "run.yaml is required for a shareable run (run identity)",
    });
  }
  if (!isRegularFile(path.join(runDir, "provenance.json"))) {
    findings.push({
      code: "missing_provenance",
      path: path.join(runDir, "provenance.json"),
      detail: "provenance.json is required for a shareable run (what produced it)",
    });
  }
  if (!isRegularFile(path.join(runDir, "logs", "v1.4-events.jsonl"))) {
    findings.push({
      code: "missing_events_log",
      path: path.join(runDir, "logs", "v1.4-events.jsonl"),
      detail: "logs/v1.4-events.jsonl is required for a shareable run (trace events)",
    });
  }
  if (!hasValidLaneHandoff(runDir)) {
    findings.push({
      code: "no_valid_handoff",
      path: path.join(runDir, "handoffs"),
      detail:
        "at least one CANONICAL handoffs/<specialist>-<task-id>.md lane receipt is required: " +
        "a guild.handoff_receipt.v1 wrapper embedding exactly ONE fenced guild.handoff.v2 " +
        "JSON block (strict-validated) plus the five §8.2 sections " +
        "(changed_files, opens_for, assumptions, evidence, followups)",
    });
  }

  return {
    schema_version: RUN_RECORD_VALIDATION_SCHEMA,
    target: runDir,
    ok: findings.length === 0,
    findings,
  };
}

/**
 * Scan a project root's `.guild/runs/` for document dumps and invalid runs.
 *
 * Exemptions (lifecycle-owned, never dumps): `_archive/` (retention rotation,
 * validated separately if ever needed), `current-run-id` (the sentinel), and
 * dot-prefixed entries (locks, editor/system files).
 */
export function scanRunsRoot(root: string): RunRecordValidation {
  const runsRoot = path.join(root, ".guild", "runs");
  const findings: RunRecordFinding[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runsRoot, { withFileTypes: true });
  } catch {
    return {
      schema_version: RUN_RECORD_VALIDATION_SCHEMA,
      target: runsRoot,
      ok: false,
      findings: [
        {
          code: "not_a_directory",
          path: runsRoot,
          detail: "no .guild/runs/ directory to scan",
        },
      ],
    };
  }

  for (const entry of entries) {
    if (LIFECYCLE_OWNED_ENTRIES.has(entry.name) || entry.name.startsWith(".")) continue;
    const abs = path.join(runsRoot, entry.name);
    if (!entry.isDirectory()) {
      findings.push({
        code: "document_dump",
        path: abs,
        detail:
          "loose file in .guild/runs/ — run records are directories; move documents to .guild/artifacts/",
      });
      continue;
    }
    findings.push(...validateRunRecordDir(abs).findings);
  }

  return {
    schema_version: RUN_RECORD_VALIDATION_SCHEMA,
    target: runsRoot,
    ok: findings.length === 0,
    findings,
  };
}
