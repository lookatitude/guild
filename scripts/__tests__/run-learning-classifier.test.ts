import {
  classifyRunLearning,
  decideGitHubIssueFiling,
  draftPluginGitHubIssue,
  type RunLearningFinding,
} from "../lib/run-learning-classifier";

describe("R11 run learning classifier", () => {
  it("classifies project-only findings as workspace_project and keeps them on the normal project gate", () => {
    const finding: RunLearningFinding = {
      id: "project-only",
      summary: "Team wiki needs a project-specific API boundary note",
      evidence_refs: [".guild/runs/run-1/learning/build.yaml"],
      affected_artifacts: [".guild/wiki/api-boundary.md", "AGENTS.md"],
    };
    const out = classifyRunLearning(finding);
    expect(out.level).toBe("workspace_project");
    expect(out.recommended_owner).toBe("workspace_or_project_maintainer");
    expect(out.normal_gate).toBe("project_learning_gate");
    expect(out.external_share_allowed).toBe(false);
    expect(draftPluginGitHubIssue(finding, out)).toBeNull();
  });

  it("classifies plugin-level findings as plugin and routes them to issue approval", () => {
    const finding: RunLearningFinding = {
      id: "plugin-flow",
      summary: "Review broker loses progress when host adapter dispatch falls back",
      details: "The flow is broken for all hosts when the review broker receives no activity receipts.",
      evidence_refs: ["plugin/scripts/lib/review-progress.ts:44"],
      affected_artifacts: ["plugin/scripts/lib/host-adapter-factory.ts"],
    };
    const out = classifyRunLearning(finding);
    expect(out.level).toBe("plugin");
    expect(out.recommended_owner).toBe("guild_plugin_maintainers");
    expect(out.normal_gate).toBe("plugin_issue_approval");
    expect(out.external_share_allowed).toBe(false);
  });

  it("classifies mixed findings as split_required", () => {
    const finding: RunLearningFinding = {
      id: "mixed",
      summary: "Project settings exposed a host adapter bug",
      details: "Workspace setting is valid, but the Guild plugin memory adapter fails across all hosts.",
      evidence_refs: [".guild/settings.json", "plugin/scripts/lib/memory-adapter.ts"],
      affected_artifacts: ["docs/knowledge/decisions/workspace-knowledge-flow.md"],
    };
    const out = classifyRunLearning(finding);
    expect(out.level).toBe("mixed");
    expect(out.recommended_owner).toBe("split_between_project_and_plugin");
    expect(out.normal_gate).toBe("split_required");
    expect(out.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("plugin"),
      expect.stringContaining("workspace/project"),
    ]));
  });

  it("classifies signal-free findings as ambiguous for human triage", () => {
    const out = classifyRunLearning({
      id: "ambiguous",
      summary: "Something should be cleaner",
      details: "The previous task felt awkward.",
    });
    expect(out.level).toBe("ambiguous");
    expect(out.normal_gate).toBe("human_triage");
    expect(out.recommended_owner).toBe("operator_triage");
    expect(out.confidence).toBe("low");
  });

  it("produces a sanitized plugin issue draft without allowing external share", () => {
    const finding: RunLearningFinding = {
      id: "sanitize",
      summary: "Guild plugin review broker leaked user data jane.customer@example.com",
      details: [
        "Observed token=ghp_abcdefghijklmnopqrstuvwxyzabcdefghij",
        "Private file /Users/alice/private/customer-roadmap.md was included in a prompt.",
        "Card 4111 1111 1111 1111 appeared in the run trace.",
      ].join("\n"),
      proposed_change: "Redact before preparing plugin-level GitHub issue drafts.",
      evidence_refs: ["plugin/scripts/lib/review-progress.ts:44", "/Users/alice/private/run.jsonl"],
      affected_artifacts: ["plugin/scripts/lib/run-learning-classifier.ts"],
    };
    const classification = classifyRunLearning(finding);
    const draft = draftPluginGitHubIssue(finding, classification, {
      privatePathPrefixes: ["/Users/alice/private"],
    });
    expect(draft).not.toBeNull();
    const serialized = JSON.stringify(draft);
    for (const raw of [
      "jane.customer@example.com",
      "ghp_abcdefghijklmnopqrstuvwxyzabcdefghij",
      "/Users/alice/private/customer-roadmap.md",
      "4111 1111 1111 1111",
    ]) {
      expect(serialized).not.toContain(raw);
    }
    expect(draft?.sanitized).toBe(true);
    expect(draft?.approval_required).toBe(true);
    expect(draft?.body).toContain("Do not file or share until the operator approves");
  });

  it("sanitizes the issue title before truncating it", () => {
    const finding: RunLearningFinding = {
      id: "title-sanitize-order",
      summary: `${"x".repeat(110)} token=ghp_abcdefghijklmnopqrstuvwxyzabcdefghij`,
      affected_artifacts: ["plugin/scripts/lib/review-progress.ts"],
    };
    const draft = draftPluginGitHubIssue(finding)!;
    expect(draft.title).not.toContain("ghp_abcdefghijklmnopqrstuvwxyzabcdefghij");
    expect(draft.title).not.toContain("token=ghp");
    expect(draft.title.length).toBeLessThanOrEqual(120);
  });

  it("requires approval for filing and respects denial", () => {
    const finding: RunLearningFinding = {
      id: "approval",
      summary: "Guild plugin host-independent review flow needs a bug report",
      affected_artifacts: ["plugin/scripts/lib/review-progress.ts"],
    };
    const draft = draftPluginGitHubIssue(finding)!;
    expect(decideGitHubIssueFiling(draft).status).toBe("approval_required");

    const denied = decideGitHubIssueFiling(draft, {
      approved: false,
      reason: "operator wants more local evidence",
    });
    expect(denied.status).toBe("denied");
    expect(denied.reason).toBe("operator wants more local evidence");

    const approved = decideGitHubIssueFiling(draft, {
      approved: true,
      approved_by: "operator",
      approved_at: "2026-06-18T10:00:00Z",
    });
    expect(approved.status).toBe("ready_to_file");
    expect(approved.approval_required).toBe(false);
  });
});
