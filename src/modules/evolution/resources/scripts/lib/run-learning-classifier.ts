/**
 * Run-learning routing for R11.
 *
 * This is the host-independent decision layer between replayable run exports and
 * external issue filing. It classifies improvements as project-local or
 * plugin-level, sanitizes external drafts, and refuses to produce a fileable
 * GitHub action without an explicit operator approval receipt.
 */

import { redactRunString, type RunExportPolicy } from "./sanitized-run-export";

export const RUN_LEARNING_CLASSIFIER_SCHEMA = "guild.run_learning_classification.v1";
export const GITHUB_ISSUE_DRAFT_SCHEMA = "guild.github_issue_draft.v1";
export const GITHUB_ISSUE_FILING_SCHEMA = "guild.github_issue_filing_decision.v1";

export type LearningLevel = "workspace_project" | "plugin" | "mixed" | "ambiguous";
export type FilingStatus = "approval_required" | "denied" | "ready_to_file" | "not_applicable";

export interface RunLearningFinding {
  id: string;
  summary: string;
  details?: string;
  evidence_refs?: string[];
  affected_artifacts?: string[];
  proposed_change?: string;
  level_hint?: LearningLevel;
}

export interface RunLearningClassification {
  schema_version: typeof RUN_LEARNING_CLASSIFIER_SCHEMA;
  finding_id: string;
  level: LearningLevel;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  recommended_owner:
    | "workspace_or_project_maintainer"
    | "guild_plugin_maintainers"
    | "split_between_project_and_plugin"
    | "operator_triage";
  normal_gate: "project_learning_gate" | "plugin_issue_approval" | "split_required" | "human_triage";
  external_share_allowed: false;
}

export interface GitHubIssueDraft {
  schema_version: typeof GITHUB_ISSUE_DRAFT_SCHEMA;
  source_finding_id: string;
  repo: "guild/plugin";
  title: string;
  body: string;
  labels: string[];
  sanitized: true;
  approval_required: true;
}

export interface IssueFilingApproval {
  approved: boolean;
  approved_by?: string;
  approved_at?: string;
  reason?: string;
}

export interface GitHubIssueFilingDecision {
  schema_version: typeof GITHUB_ISSUE_FILING_SCHEMA;
  status: FilingStatus;
  repo: "guild/plugin";
  draft: GitHubIssueDraft | null;
  reason: string;
  approval_required: boolean;
  approval?: IssueFilingApproval;
}

const PLUGIN_PATH_PATTERNS = [
  /^plugin\//,
  /\/plugin\//,
  /^docs\/v2\/16-host-adapter-migration-spec\.md$/,
  /^docs\/v2\/17-implementation-dod-and-verification\.md$/,
];

const PROJECT_PATH_PATTERNS = [
  /^\.guild\//,
  /\/\.guild\//,
  /^docs\/knowledge\//,
  /^AGENTS\.md$/,
  /^CLAUDE\.md$/,
  /\/AGENTS\.md$/,
  /\/CLAUDE\.md$/,
  /^website\//,
  /^benchmark\//,
];

const PLUGIN_TEXT_SIGNALS = [
  "host adapter",
  "review broker",
  "guild plugin",
  "plugin-level",
  "all hosts",
  "host-independent",
  "installer",
  "pre-flight",
  "preflight",
  "memory adapter",
  "flow is broken",
  "orchestrator",
];

const PROJECT_TEXT_SIGNALS = [
  "workspace-level",
  "project-level",
  "project local",
  "team knowledge",
  "wiki",
  ".guild",
  "agents.md",
  "project setting",
  "workspace setting",
  "docs/knowledge",
];

function textForFinding(finding: RunLearningFinding): string {
  return [
    finding.summary,
    finding.details,
    finding.proposed_change,
    ...(finding.evidence_refs ?? []),
    ...(finding.affected_artifacts ?? []),
  ].filter(Boolean).join("\n").toLowerCase();
}

function pathSignals(paths: string[], patterns: RegExp[]): string[] {
  return paths.filter((p) => patterns.some((pattern) => pattern.test(p)));
}

function wordSignals(text: string, signals: string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

export function classifyRunLearning(finding: RunLearningFinding): RunLearningClassification {
  const paths = [...(finding.evidence_refs ?? []), ...(finding.affected_artifacts ?? [])];
  const text = textForFinding(finding);
  const pluginReasons = [
    ...pathSignals(paths, PLUGIN_PATH_PATTERNS).map((p) => `plugin artifact: ${p}`),
    ...wordSignals(text, PLUGIN_TEXT_SIGNALS).map((s) => `plugin signal: ${s}`),
  ];
  const projectReasons = [
    ...pathSignals(paths, PROJECT_PATH_PATTERNS).map((p) => `workspace/project artifact: ${p}`),
    ...wordSignals(text, PROJECT_TEXT_SIGNALS).map((s) => `workspace/project signal: ${s}`),
  ];

  if (finding.level_hint && finding.level_hint !== "ambiguous") {
    // A hint may only make a finding LESS external, never more: hints are
    // model-authored, and the lane contract says routing toward external
    // filing is deterministic code. A plugin/mixed hint therefore needs at
    // least one CORROBORATING deterministic plugin signal — an uncorroborated
    // externalizing hint downgrades to human triage instead of becoming
    // fileable (codex G-lane MAJOR).
    const externalizing = finding.level_hint === "plugin" || finding.level_hint === "mixed";
    if (externalizing && pluginReasons.length === 0) {
      return {
        schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
        finding_id: finding.id,
        level: "ambiguous",
        confidence: "low",
        reasons: [
          `level hint "${finding.level_hint}" has NO corroborating plugin signal — refusing to externalize on a hint alone`,
          ...projectReasons,
        ],
        recommended_owner: "operator_triage",
        normal_gate: "human_triage",
        external_share_allowed: false,
      };
    }
    const gate = finding.level_hint === "plugin"
      ? "plugin_issue_approval"
      : finding.level_hint === "mixed"
        ? "split_required"
        : "project_learning_gate";
    const owner = finding.level_hint === "plugin"
      ? "guild_plugin_maintainers"
      : finding.level_hint === "mixed"
        ? "split_between_project_and_plugin"
        : "workspace_or_project_maintainer";
    return {
      schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
      finding_id: finding.id,
      level: finding.level_hint,
      confidence: "high",
      reasons: [
        `explicit level hint: ${finding.level_hint}`,
        ...(externalizing ? pluginReasons : []),
      ],
      recommended_owner: owner,
      normal_gate: gate,
      external_share_allowed: false,
    };
  }

  let level: LearningLevel;
  let confidence: RunLearningClassification["confidence"];
  let normal_gate: RunLearningClassification["normal_gate"];
  let recommended_owner: RunLearningClassification["recommended_owner"];
  let reasons: string[];

  if (pluginReasons.length > 0 && projectReasons.length > 0) {
    level = "mixed";
    confidence = "high";
    normal_gate = "split_required";
    recommended_owner = "split_between_project_and_plugin";
    reasons = [...pluginReasons, ...projectReasons];
  } else if (pluginReasons.length > 0) {
    level = "plugin";
    confidence = pluginReasons.length > 1 ? "high" : "medium";
    normal_gate = "plugin_issue_approval";
    recommended_owner = "guild_plugin_maintainers";
    reasons = pluginReasons;
  } else if (projectReasons.length > 0) {
    level = "workspace_project";
    confidence = projectReasons.length > 1 ? "high" : "medium";
    normal_gate = "project_learning_gate";
    recommended_owner = "workspace_or_project_maintainer";
    reasons = projectReasons;
  } else {
    level = "ambiguous";
    confidence = "low";
    normal_gate = "human_triage";
    recommended_owner = "operator_triage";
    reasons = ["no plugin or workspace/project routing signals"];
  }

  return {
    schema_version: RUN_LEARNING_CLASSIFIER_SCHEMA,
    finding_id: finding.id,
    level,
    confidence,
    reasons,
    recommended_owner,
    normal_gate,
    external_share_allowed: false,
  };
}

function sanitizeForIssue(input: string, policy?: RunExportPolicy): string {
  return redactRunString(input, policy);
}

export function draftPluginGitHubIssue(
  finding: RunLearningFinding,
  classification: RunLearningClassification = classifyRunLearning(finding),
  policy?: RunExportPolicy,
): GitHubIssueDraft | null {
  if (classification.level !== "plugin" && classification.level !== "mixed") return null;
  const title = sanitizeForIssue(`[Guild] ${finding.summary}`, policy).slice(0, 120);
  const evidence = (finding.evidence_refs ?? []).map((ref) => `- ${sanitizeForIssue(ref, policy)}`).join("\n") || "- None provided";
  const artifacts = (finding.affected_artifacts ?? []).map((ref) => `- ${sanitizeForIssue(ref, policy)}`).join("\n") || "- None provided";
  const body = sanitizeForIssue([
    "## Summary",
    finding.summary,
    "",
    "## Classification",
    `Level: ${classification.level}`,
    `Confidence: ${classification.confidence}`,
    `Recommended owner: ${classification.recommended_owner}`,
    "",
    "## Details",
    finding.details ?? "No details provided.",
    "",
    "## Proposed Change",
    finding.proposed_change ?? "No proposed change provided.",
    "",
    "## Evidence",
    evidence,
    "",
    "## Affected Artifacts",
    artifacts,
    "",
    "## Sharing Gate",
    "Prepared locally by Guild. Do not file or share until the operator approves this exact draft.",
  ].join("\n"), policy);

  return {
    schema_version: GITHUB_ISSUE_DRAFT_SCHEMA,
    source_finding_id: finding.id,
    repo: "guild/plugin",
    title,
    body,
    labels: ["guild-learning", classification.level === "mixed" ? "mixed-scope" : "plugin-level"],
    sanitized: true,
    approval_required: true,
  };
}

export function decideGitHubIssueFiling(
  draft: GitHubIssueDraft | null,
  approval?: IssueFilingApproval,
): GitHubIssueFilingDecision {
  if (!draft) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "not_applicable",
      repo: "guild/plugin",
      draft: null,
      reason: "finding is not plugin-level or mixed-scope",
      approval_required: false,
    };
  }
  if (!approval) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "approval_required",
      repo: "guild/plugin",
      draft,
      reason: "operator approval is required before external GitHub issue filing",
      approval_required: true,
    };
  }
  if (!approval.approved) {
    return {
      schema_version: GITHUB_ISSUE_FILING_SCHEMA,
      status: "denied",
      repo: "guild/plugin",
      draft,
      reason: approval.reason ?? "operator denied external GitHub issue filing",
      approval_required: true,
      approval,
    };
  }
  return {
    schema_version: GITHUB_ISSUE_FILING_SCHEMA,
    status: "ready_to_file",
    repo: "guild/plugin",
    draft,
    reason: "operator approved this sanitized GitHub issue draft",
    approval_required: false,
    approval,
  };
}
