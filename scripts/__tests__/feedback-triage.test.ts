/**
 * scripts/__tests__/feedback-triage.test.ts
 *
 * The feedback loop's deterministic end (feedback-triage.ts): triage writes
 * classifications + sanitized drafts and never files; the file command is a
 * consent choke-point — refuses without approval, records denials, and only a
 * ready_to_file decision reaches the (injected) gh runner. Sanitization is
 * asserted end-to-end (a private path in a finding never reaches the draft).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { feedbackDir, runFile, runTriage } from "../feedback-triage";
import type { RunLearningFinding } from "../lib/run-learning-classifier";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-feedback-"));
}

const silent = { log: () => {} };

const pluginFinding: RunLearningFinding = {
  id: "F-1",
  summary: "Host adapter drops degradation receipts on codex",
  details: "Seen in /Users/testuser/host-logs/session.log — the host adapter path loses receipts on all hosts.",
  evidence_refs: ["plugin/src/modules/host-runtime/workflows/host-router.ts"],
  proposed_change: "Persist degradation receipts before dispatch returns.",
};

const projectFinding: RunLearningFinding = {
  id: "F-2",
  summary: "Team convention: wiki pages need owners",
  affected_artifacts: [".guild/wiki/standards/ownership.md"],
};

describe("runTriage", () => {
  it("classifies, drafts plugin issues sanitized, and files NOTHING", () => {
    const cwd = mkTmp();
    const rec = runTriage({
      cwd,
      runId: "run-9",
      findings: [pluginFinding, projectFinding],
      now: new Date("2026-07-12T12:00:00Z"),
      ...silent,
    });
    const byId = Object.fromEntries(rec.findings.map((f) => [f.finding.id, f]));
    expect(byId["F-1"].classification.level).toBe("plugin");
    expect(byId["F-2"].classification.level).toBe("workspace_project");
    expect(byId["F-2"].draft).toBeNull();

    const draft = byId["F-1"].draft!;
    expect(draft.approval_required).toBe(true);
    // Sanitization: the private user path from details must be redacted.
    expect(draft.body).not.toContain("/Users/testuser");
    expect(draft.body).toContain("Do not file or share until the operator approves");

    const dir = feedbackDir(cwd, "run-9");
    expect(fs.existsSync(path.join(dir, "triage.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "F-1.draft.md"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "F-2.draft.md"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "filed.json"))).toBe(false);
  });
});

describe("runFile — the consent choke-point", () => {
  function triaged(): string {
    const cwd = mkTmp();
    runTriage({ cwd, runId: "run-9", findings: [pluginFinding, projectFinding], ...silent });
    return cwd;
  }

  it("refuses without approval; gh is never invoked", () => {
    const cwd = triaged();
    let ghCalls = 0;
    const rc = runFile({
      cwd,
      runId: "run-9",
      findingId: "F-1",
      gh: () => {
        ghCalls++;
        return "";
      },
      ...silent,
    });
    expect(rc).toBe(2);
    expect(ghCalls).toBe(0);
  });

  it("records a denial without filing", () => {
    const cwd = triaged();
    let ghCalls = 0;
    const rc = runFile({
      cwd,
      runId: "run-9",
      findingId: "F-1",
      deny: true,
      denyReason: "not ready",
      gh: () => {
        ghCalls++;
        return "";
      },
      ...silent,
    });
    expect(rc).toBe(0);
    expect(ghCalls).toBe(0);
    const filed = JSON.parse(
      fs.readFileSync(path.join(feedbackDir(cwd, "run-9"), "filed.json"), "utf8")
    );
    expect(filed[0]).toMatchObject({ finding_id: "F-1", status: "denied" });
  });

  it("approved plugin draft files via gh with sanitized title/body and records the URL", () => {
    const cwd = triaged();
    const ghArgs: string[][] = [];
    const rc = runFile({
      cwd,
      runId: "run-9",
      findingId: "F-1",
      approve: "miguel",
      gh: (args) => {
        ghArgs.push(args);
        return "https://github.com/lookatitude/guild/issues/99";
      },
      ...silent,
    });
    expect(rc).toBe(0);
    expect(ghArgs).toHaveLength(1);
    const args = ghArgs[0];
    expect(args.slice(0, 2)).toEqual(["issue", "create"]);
    expect(args[args.indexOf("--repo") + 1]).toBe("lookatitude/guild");
    expect(args).toContain("--label");
    const bodyFile = args[args.indexOf("--body-file") + 1];
    expect(fs.readFileSync(bodyFile, "utf8")).not.toContain("/Users/testuser");
    const filed = JSON.parse(
      fs.readFileSync(path.join(feedbackDir(cwd, "run-9"), "filed.json"), "utf8")
    );
    expect(filed[0]).toMatchObject({
      finding_id: "F-1",
      status: "filed",
      by: "miguel",
      issue_url: "https://github.com/lookatitude/guild/issues/99",
    });
  });

  it("rejects path-traversal run ids and finding ids before touching the filesystem", () => {
    const cwd = mkTmp();
    expect(() =>
      runTriage({ cwd, runId: "../escape", findings: [pluginFinding], ...silent })
    ).toThrow(/unsafe run id/);
    expect(() =>
      runTriage({
        cwd,
        runId: "run-9",
        findings: [{ ...pluginFinding, id: "../../evil" }],
        ...silent,
      })
    ).toThrow(/unsafe finding id/);
    expect(() =>
      runFile({ cwd, runId: "run-9", findingId: "a/b", approve: "x", gh: () => "", ...silent })
    ).toThrow(/unsafe finding id/);
  });

  it("an uncorroborated plugin level_hint cannot become fileable (hint hardening)", () => {
    const cwd = mkTmp();
    const hinted: RunLearningFinding = {
      id: "F-3",
      summary: "Team prefers tabs", // zero plugin signals
      affected_artifacts: [".guild/wiki/standards/style.md"],
      level_hint: "plugin",
    };
    const rec = runTriage({ cwd, runId: "run-9", findings: [hinted], ...silent });
    expect(rec.findings[0].classification.level).toBe("ambiguous");
    expect(rec.findings[0].classification.normal_gate).toBe("human_triage");
    expect(rec.findings[0].draft).toBeNull();
  });

  it("project-level findings are not fileable at all", () => {
    const cwd = triaged();
    const rc = runFile({
      cwd,
      runId: "run-9",
      findingId: "F-2",
      approve: "miguel",
      gh: () => "should-not-run",
      ...silent,
    });
    expect(rc).toBe(1);
  });
});
