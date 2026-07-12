#!/usr/bin/env -S npx tsx
/**
 * scripts/feedback-triage.ts
 *
 * The deterministic end of the run-learning feedback loop (AGENTS.md §"Run
 * learning and improvement routing", made code):
 *
 *   analysis (model) → findings JSON → THIS CLI:
 *     triage : classifyRunLearning() per finding (project vs plugin vs mixed),
 *              draftPluginGitHubIssue() for plugin/mixed (sanitized via the
 *              run-export redaction stack), everything written under
 *              .guild/feedback/<run-id>/ for operator review. NOTHING leaves
 *              the machine.
 *     file   : consume ONE reviewed draft + an explicit operator approval and
 *              run `gh issue create`. Refuses without --approve; --deny
 *              records the denial. The consent state machine is
 *              decideGitHubIssueFiling() — this CLI cannot file a draft the
 *              machine says is not ready_to_file.
 *
 * Usage:
 *   npx tsx feedback-triage.ts triage --run-id <id> --findings <findings.json> [--cwd <dir>]
 *   npx tsx feedback-triage.ts file   --run-id <id> --finding <finding-id> \
 *       (--approve <operator> | --deny [reason]) [--cwd <dir>] [--dry-run]
 *
 * findings.json: RunLearningFinding[] (see lib/run-learning-classifier.ts).
 * The filing target repo comes from GUILD_ISSUE_REPO (default
 * lookatitude/guild); the draft's `repo: "guild/plugin"` field is the schema
 * label, not a GitHub slug.
 */

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  classifyRunLearning,
  decideGitHubIssueFiling,
  draftPluginGitHubIssue,
  type GitHubIssueDraft,
  type RunLearningClassification,
  type RunLearningFinding,
} from "./lib/run-learning-classifier";

export const TRIAGE_SCHEMA = "guild.feedback_triage.v1";
export const FILED_SCHEMA = "guild.feedback_filed.v1";
const DEFAULT_ISSUE_REPO = "lookatitude/guild";

export interface TriageRecord {
  schema_version: typeof TRIAGE_SCHEMA;
  run_id: string;
  triaged_at: string;
  findings: Array<{
    finding: RunLearningFinding;
    classification: RunLearningClassification;
    draft: GitHubIssueDraft | null;
  }>;
}

export interface FiledRecord {
  finding_id: string;
  status: "filed" | "denied";
  at: string;
  by?: string;
  reason?: string;
  issue_url?: string;
}

export function feedbackDir(cwd: string, runId: string): string {
  return path.join(cwd, ".guild", "feedback", runId);
}

export function runTriage(opts: {
  cwd: string;
  runId: string;
  findings: RunLearningFinding[];
  now?: Date;
  fsi?: typeof fs;
  log?: (l: string) => void;
}): TriageRecord {
  const fsi = opts.fsi ?? fs;
  const log = opts.log ?? ((l) => process.stderr.write(`[feedback-triage] ${l}\n`));
  const dir = feedbackDir(opts.cwd, opts.runId);
  fsi.mkdirSync(dir, { recursive: true });

  const record: TriageRecord = {
    schema_version: TRIAGE_SCHEMA,
    run_id: opts.runId,
    triaged_at: (opts.now ?? new Date()).toISOString(),
    findings: opts.findings.map((finding) => {
      const classification = classifyRunLearning(finding);
      const draft = draftPluginGitHubIssue(finding, classification);
      return { finding, classification, draft };
    }),
  };

  fsi.writeFileSync(
    path.join(dir, "triage.json"),
    JSON.stringify(record, null, 2) + "\n",
    "utf8"
  );
  for (const f of record.findings) {
    if (!f.draft) continue;
    // One reviewable markdown file per plugin/mixed draft — what the operator
    // actually reads before saying yes.
    fsi.writeFileSync(
      path.join(dir, `${f.finding.id}.draft.md`),
      `<!-- ${f.draft.schema_version} · sanitized · approval_required -->\n# ${f.draft.title}\n\n${f.draft.body}\n`,
      "utf8"
    );
  }

  const counts = { workspace_project: 0, plugin: 0, mixed: 0, ambiguous: 0 };
  for (const f of record.findings) counts[f.classification.level]++;
  log(
    `triaged ${record.findings.length} finding(s): ` +
      `${counts.workspace_project} project · ${counts.plugin} plugin · ` +
      `${counts.mixed} mixed · ${counts.ambiguous} ambiguous → ${dir}/triage.json`
  );
  const drafts = record.findings.filter((f) => f.draft);
  if (drafts.length > 0) {
    log(`${drafts.length} sanitized plugin-issue draft(s) prepared — NOT filed:`);
    for (const f of drafts) log(`  · ${dir}/${f.finding.id}.draft.md`);
    log(
      "Ask the operator per draft, then: feedback-triage.ts file --run-id " +
        `${opts.runId} --finding <id> --approve "<operator>" (or --deny [reason]).`
    );
  }
  return record;
}

export function runFile(opts: {
  cwd: string;
  runId: string;
  findingId: string;
  approve?: string;
  deny?: boolean;
  denyReason?: string;
  dryRun?: boolean;
  repo?: string;
  now?: Date;
  fsi?: typeof fs;
  gh?: (args: string[]) => string;
  log?: (l: string) => void;
}): number {
  const fsi = opts.fsi ?? fs;
  const log = opts.log ?? ((l) => process.stderr.write(`[feedback-triage] ${l}\n`));
  const gh =
    opts.gh ?? ((args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim());
  const dir = feedbackDir(opts.cwd, opts.runId);
  const triagePath = path.join(dir, "triage.json");
  let record: TriageRecord;
  try {
    record = JSON.parse(fsi.readFileSync(triagePath, "utf8")) as TriageRecord;
  } catch {
    log(`no triage record at ${triagePath} — run \`triage\` first.`);
    return 1;
  }
  const entry = record.findings.find((f) => f.finding.id === opts.findingId);
  if (!entry) {
    log(`finding "${opts.findingId}" not in ${triagePath}.`);
    return 1;
  }

  const approval = opts.approve
    ? {
        approved: true,
        approved_by: opts.approve,
        approved_at: (opts.now ?? new Date()).toISOString(),
      }
    : opts.deny
      ? { approved: false, reason: opts.denyReason ?? "operator denied" }
      : undefined;

  const decision = decideGitHubIssueFiling(entry.draft, approval);
  const filedPath = path.join(dir, "filed.json");
  const filed: FiledRecord[] = (() => {
    try {
      return JSON.parse(fsi.readFileSync(filedPath, "utf8")) as FiledRecord[];
    } catch {
      return [];
    }
  })();

  if (decision.status === "not_applicable") {
    log("finding is not plugin-level/mixed — nothing to file (route it to the project learning gate).");
    return 1;
  }
  if (decision.status === "approval_required") {
    log("REFUSED: operator approval is required — re-run with --approve \"<operator>\" or --deny.");
    return 2;
  }
  if (decision.status === "denied") {
    filed.push({
      finding_id: opts.findingId,
      status: "denied",
      at: (opts.now ?? new Date()).toISOString(),
      reason: decision.reason,
    });
    fsi.writeFileSync(filedPath, JSON.stringify(filed, null, 2) + "\n", "utf8");
    log(`denial recorded — nothing filed (${decision.reason}).`);
    return 0;
  }

  // ready_to_file — the ONLY state that reaches gh.
  const draft = decision.draft as GitHubIssueDraft;
  const repo = opts.repo ?? process.env["GUILD_ISSUE_REPO"] ?? DEFAULT_ISSUE_REPO;
  if (opts.dryRun) {
    log(`dry-run: would file to ${repo}: "${draft.title}" (labels: ${draft.labels.join(", ")})`);
    return 0;
  }
  const bodyFile = path.join(dir, `${opts.findingId}.filed-body.md`);
  fsi.writeFileSync(bodyFile, draft.body, "utf8");
  const url = gh([
    "issue", "create",
    "--repo", repo,
    "--title", draft.title,
    "--body-file", bodyFile,
    ...draft.labels.flatMap((l) => ["--label", l]),
  ]);
  filed.push({
    finding_id: opts.findingId,
    status: "filed",
    at: (opts.now ?? new Date()).toISOString(),
    by: opts.approve,
    issue_url: url,
  });
  fsi.writeFileSync(filedPath, JSON.stringify(filed, null, 2) + "\n", "utf8");
  log(`filed: ${url}`);
  return 0;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function main(): number {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  let runId: string | null = null;
  let findingsPath: string | null = null;
  let findingId: string | null = null;
  let approve: string | null = null;
  let deny = false;
  let denyReason: string | undefined;
  let cwd = process.cwd();
  let dryRun = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-id" && argv[i + 1]) runId = argv[++i];
    else if (a === "--findings" && argv[i + 1]) findingsPath = argv[++i];
    else if (a === "--finding" && argv[i + 1]) findingId = argv[++i];
    else if (a === "--approve" && argv[i + 1]) approve = argv[++i];
    else if (a === "--deny") {
      deny = true;
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) denyReason = argv[++i];
    } else if (a === "--cwd" && argv[i + 1]) cwd = path.resolve(argv[++i]);
    else if (a === "--dry-run") dryRun = true;
    else {
      process.stderr.write(`[feedback-triage] unknown argument: ${a}\n`);
      return 1;
    }
  }
  if (!runId) {
    process.stderr.write("[feedback-triage] --run-id is required\n");
    return 1;
  }

  if (cmd === "triage") {
    if (!findingsPath) {
      process.stderr.write("[feedback-triage] triage requires --findings <findings.json>\n");
      return 1;
    }
    const findings = JSON.parse(fs.readFileSync(findingsPath, "utf8")) as RunLearningFinding[];
    if (!Array.isArray(findings)) {
      process.stderr.write("[feedback-triage] findings file must be a JSON array of RunLearningFinding\n");
      return 1;
    }
    runTriage({ cwd, runId, findings });
    return 0;
  }
  if (cmd === "file") {
    if (!findingId) {
      process.stderr.write("[feedback-triage] file requires --finding <finding-id>\n");
      return 1;
    }
    return runFile({
      cwd,
      runId,
      findingId,
      ...(approve ? { approve } : {}),
      deny,
      ...(denyReason !== undefined ? { denyReason } : {}),
      dryRun,
    });
  }
  process.stderr.write("[feedback-triage] usage: feedback-triage.ts <triage|file> …\n");
  return 1;
}

if (require.main === module) process.exit(main());
