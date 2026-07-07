/**
 * hooks/__tests__/task-completed-scrub.test.ts
 *
 * TDD (written BEFORE HK-06 handoff-surface implementation):
 * On-disk FINAL-state tests for the handoff receipt post-write scrub
 * wired into task-completed.ts.
 *
 * CONTRACT (D-SECRETS / HK-06 handoff surface):
 *   The agent writes the receipt markdown. task-completed reads it,
 *   runs applySecretsPolicy on the content, and:
 *     ok=true  → rewrites rPath with the scrubbed content (in-place)
 *     ok=false → quarantines rPath to rPath+".quarantined", emits
 *                secret_scrub_blocked event, blocks the lane (exit 1)
 *
 * Tests prove the on-disk EFFECT, not just "scrubber called".
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../agent-team/task-completed.ts");
const RUN = "run-tc-scrub-test";
const SPECIALIST = "backend";
const TASK_ID = "task-scrub-001";

// A token-shaped value the built-in group-1 redactor catches
const FAKE_SECRET = "sk-ant-FAKESECRETVALUE1234567890";

// ── Receipt builder ─────────────────────────────────────────────────────────

function makeReceipt(summary: string, extraContent = ""): string {
  const envelope = {
    schema_version: "guild.handoff.v2",
    task_id: TASK_ID,
    tier: "mid",
    status: "done",
    summary,
    artifacts: [],
    issues: [],
  };
  return `---
task: ${TASK_ID}
specialist: ${SPECIALIST}
date: 2026-06-08
---

## changed_files
- hooks/agent-team/task-completed.ts

## opens_for
None.

## assumptions
None.

## evidence
All tests pass.

## followups
None.
${extraContent}
\`\`\`guild.handoff.v2
${JSON.stringify(envelope, null, 2)}
\`\`\`
`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeSettings(tmp: string, override: Record<string, unknown>): void {
  const guildDir = path.join(tmp, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "settings.json"), JSON.stringify(override, null, 2), "utf8");
}

function makeEnv(tmp: string): { exitCode: number; stderr: string } {
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  const runDir = path.join(tmp, ".guild", "runs", RUN);
  fs.mkdirSync(runDir, { recursive: true });
  // run.yaml with future start date → always in-scope for OD-4
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    `schema_version: guild.run.v1\nrun_id: ${RUN}\nstarted_at: ${future.toISOString()}\n`,
    "utf8",
  );
  return { exitCode: 0, stderr: "" }; // unused — just sets up the env
}

function spawnHook(
  tmp: string,
  receiptContent: string,
): { exitCode: number; stderr: string } {
  const handoffsDir = path.join(tmp, ".guild", "runs", RUN, "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });
  const rPath = path.join(handoffsDir, `${SPECIALIST}-${TASK_ID}.md`);
  fs.writeFileSync(rPath, receiptContent, "utf8");

  const payload = {
    hook_event_name: "TaskCompleted",
    session_id: RUN.replace("run-", ""),
    task_id: TASK_ID,
    task_subject: "Implement feature X",
    teammate_name: SPECIALIST,
    team_name: "guild",
    cwd: tmp,
  };

  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
    },
    timeout: 30000,
  });
  return { exitCode: result.status ?? 1, stderr: result.stderr ?? "" };
}

function receiptPath(tmp: string): string {
  return path.join(tmp, ".guild", "runs", RUN, "handoffs", `${SPECIALIST}-${TASK_ID}.md`);
}

function securityEvents(tmp: string): Array<Record<string, unknown>> {
  const f = path.join(tmp, ".guild", "runs", RUN, "logs", "security-events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("task-completed.ts — HK-06 handoff surface scrub", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tc-scrub-"));
    makeEnv(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── Clean path (ok=true): scrub applied, file rewritten ──────────────────

  describe("ok=true path: secret in receipt is redacted on disk", () => {
    it("exits 0 for a clean receipt (no regression)", () => {
      const { exitCode } = spawnHook(tmp, makeReceipt("Feature complete."));
      expect(exitCode).toBe(0);
    });

    it("on-disk receipt does NOT contain the raw secret after the hook", () => {
      // Secret appears in the receipt body (not in the envelope summary, which is size-capped)
      const receiptWithSecret = makeReceipt(
        "Task done.",
        `\nAPI token used during testing: ${FAKE_SECRET}\n`,
      );
      spawnHook(tmp, receiptWithSecret);
      const onDisk = fs.readFileSync(receiptPath(tmp), "utf8");
      expect(onDisk).not.toContain(FAKE_SECRET);
    });

    it("on-disk receipt contains a redaction sentinel in place of the raw secret", () => {
      const receiptWithSecret = makeReceipt(
        "Task done.",
        `\nAPI token used during testing: ${FAKE_SECRET}\n`,
      );
      spawnHook(tmp, receiptWithSecret);
      const onDisk = fs.readFileSync(receiptPath(tmp), "utf8");
      // Built-in group 1 (token-shape) replaces with [REDACTED_TOKEN]
      expect(onDisk).toMatch(/\[REDACTED(?:_TOKEN)?\]/);
    });

    it("does NOT emit a secret_scrub_blocked event on a successful scrub", () => {
      const receiptWithSecret = makeReceipt(
        "Task done.",
        `\nNote: ${FAKE_SECRET}\n`,
      );
      spawnHook(tmp, receiptWithSecret);
      const events = securityEvents(tmp);
      const blocked = events.filter((e) => e["event_type"] === "secret_scrub_blocked");
      expect(blocked).toHaveLength(0);
    });
  });

  // ── Fail-CLOSED path (ok=false): quarantine + event + block lane ──────────

  describe("ok=false (forced via invalid regex): quarantine + block lane", () => {
    beforeEach(() => {
      // An invalid regex in redaction_patterns → applySecretsPolicy returns ok=false
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: ["[unclosed-bracket-regex"],
          fail_mode_durable: "closed",
        },
      });
    });

    it("exits non-zero (lane blocked) when scrub fails", () => {
      const { exitCode } = spawnHook(tmp, makeReceipt("Task done."));
      expect(exitCode).not.toBe(0);
    });

    it("quarantines the receipt (moves it to .quarantined) on fail-CLOSED", () => {
      spawnHook(tmp, makeReceipt("Task done."));
      const rPath = receiptPath(tmp);
      expect(fs.existsSync(rPath)).toBe(false); // original gone
      expect(fs.existsSync(rPath + ".quarantined")).toBe(true); // quarantined exists
    });

    it("emits a secret_scrub_blocked security event (decision: blocked) on fail-CLOSED", () => {
      spawnHook(tmp, makeReceipt("Task done."));
      const events = securityEvents(tmp);
      const blocked = events.find(
        (e) =>
          e["event_type"] === "secret_scrub_blocked" && e["decision"] === "blocked",
      );
      expect(blocked).toBeDefined();
      expect(blocked!["schema_version"]).toBe("guild.security_event.v1");
    });
  });

  // ── MAJOR A: ok=true rewrite-failure falls into fail-CLOSED ladder ──────────
  // When the scrub SUCCEEDS (ok=true) but the writeFileSync that rewrites the
  // receipt with the scrubbed content fails (e.g. read-only file), the raw
  // receipt is still at canonical. The hook MUST treat this as fail-CLOSED.

  describe("ok=true rewrite-failure ladder", () => {
    it("canonical does NOT contain raw secret when scrubbed-rewrite fails (ok=true path)", () => {
      // Write the receipt with a secret, then make it read-only so the rewrite fails
      const receiptContent = makeReceipt(
        "Task done.",
        `\nAPI token: ${FAKE_SECRET}\n`,
      );
      const rPath = receiptPath(tmp);
      fs.mkdirSync(path.dirname(rPath), { recursive: true });
      fs.writeFileSync(rPath, receiptContent, "utf8");
      fs.chmodSync(rPath, 0o444); // read-only: writeFileSync(rPath, scrubbed) will fail

      // Spawn directly (bypassing spawnHook which would re-create the file)
      const payload = {
        hook_event_name: "TaskCompleted",
        session_id: RUN.replace("run-", ""),
        task_id: TASK_ID,
        task_subject: "Implement feature X",
        teammate_name: SPECIALIST,
        team_name: "guild",
        cwd: tmp,
      };
      const result = spawnSync("npx", ["tsx", SCRIPT], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          GUILD_CWD: tmp,
          GUILD_RUN_ID: RUN,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        },
        timeout: 30000,
      });

      // Restore write permission before assertions (so afterEach cleanup works)
      try { fs.chmodSync(rPath, 0o644); } catch {}
      // Quarantine path may also be read-only if rename succeeded; restore it too
      try { fs.chmodSync(rPath + ".quarantined", 0o644); } catch {}

      // Hook must exit non-zero (rewrite failure → fail-CLOSED → die/block)
      expect(result.status).not.toBe(0);

      // Canonical MUST NOT hold the raw secret
      if (fs.existsSync(rPath)) {
        expect(fs.readFileSync(rPath, "utf8")).not.toContain(FAKE_SECRET);
      }
    });

    it("approval_request is written on ok=true rewrite-failure (fail-CLOSED path)", () => {
      const receiptContent = makeReceipt("Task done.", `\nNote: ${FAKE_SECRET}\n`);
      const rPath = receiptPath(tmp);
      fs.mkdirSync(path.dirname(rPath), { recursive: true });
      fs.writeFileSync(rPath, receiptContent, "utf8");
      fs.chmodSync(rPath, 0o444);

      const payload = {
        hook_event_name: "TaskCompleted",
        session_id: RUN.replace("run-", ""),
        task_id: TASK_ID,
        task_subject: "Implement feature X",
        teammate_name: SPECIALIST,
        team_name: "guild",
        cwd: tmp,
      };
      spawnSync("npx", ["tsx", SCRIPT], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: {
          ...process.env,
          GUILD_CWD: tmp,
          GUILD_RUN_ID: RUN,
          CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
        },
        timeout: 30000,
      });

      try { fs.chmodSync(rPath, 0o644); } catch {}
      try { fs.chmodSync(rPath + ".quarantined", 0o644); } catch {}

      const approvalDir = path.join(
        tmp, ".guild", "runs", RUN, "agent-bus", "approvals",
      );
      expect(fs.existsSync(approvalDir)).toBe(true);
      const files = fs.readdirSync(approvalDir).filter(
        (f) => f.endsWith("-scrub-blocked.json"),
      );
      expect(files.length).toBeGreaterThan(0);
    });
  });

  // ── MAJOR 1: quarantine-rename-failure ladder ──────────────────────────────
  // When the quarantine rename fails (e.g., quarantine path is already a dir),
  // the hook MUST still remove the raw content from the canonical path.

  describe("quarantine-rename-failure ladder", () => {
    beforeEach(() => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: ["[unclosed-bracket-regex"],
          fail_mode_durable: "closed",
        },
      });
    });

    it("canonical path does NOT contain raw secret when rename-to-quarantine fails", () => {
      // Pre-create the quarantine path as a directory → fs.renameSync will fail (EISDIR)
      const rPath = receiptPath(tmp);
      fs.mkdirSync(path.dirname(rPath), { recursive: true });
      fs.mkdirSync(rPath + ".quarantined", { recursive: true });

      spawnHook(tmp, makeReceipt("Task done.", `\nToken: ${FAKE_SECRET}\n`));

      // Canonical MUST NOT hold raw secret regardless of rename result
      if (fs.existsSync(rPath)) {
        expect(fs.readFileSync(rPath, "utf8")).not.toContain(FAKE_SECRET);
      }
      // Either the file is gone (unlinked) or overwritten with a redaction notice
    });
  });

  // ── MAJOR 2: approval_request emitted on handoff fail-CLOSED ──────────────
  // On the fail-CLOSED path, writeScrubApprovalRequest must write a
  // guild.approval_request.v1 to agent-bus/approvals/ so the operator
  // gets the always-ask notification (same as the durable scrubbedWrite path).

  describe("approval_request on handoff fail-CLOSED", () => {
    beforeEach(() => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: ["[unclosed-bracket-regex"],
          fail_mode_durable: "closed",
        },
      });
    });

    it("writes a guild.approval_request.v1 to agent-bus/approvals/ on fail-CLOSED", () => {
      spawnHook(tmp, makeReceipt("Task done."));

      const approvalDir = path.join(
        tmp, ".guild", "runs", RUN, "agent-bus", "approvals",
      );
      expect(fs.existsSync(approvalDir)).toBe(true);
      const files = fs.readdirSync(approvalDir).filter(
        (f) => f.endsWith("-scrub-blocked.json"),
      );
      expect(files.length).toBeGreaterThan(0);
    });

    it("approval_request file contains the blocked surface identifier", () => {
      spawnHook(tmp, makeReceipt("Task done."));

      const approvalDir = path.join(
        tmp, ".guild", "runs", RUN, "agent-bus", "approvals",
      );
      const files = fs.readdirSync(approvalDir).filter(
        (f) => f.endsWith("-scrub-blocked.json"),
      );
      const record = JSON.parse(
        fs.readFileSync(path.join(approvalDir, files[0]), "utf8"),
      ) as Record<string, unknown>;
      expect(record["schema_version"]).toBe("guild.approval_request.v1");
      expect(record["surface"]).toBe("handoff");
    });
  });
});
