/**
 * hooks/__tests__/comms-format-lint.test.ts
 *
 * TDD: written before comms-format-lint.ts implementation.
 * U5a — WARN ONLY local-advisory hook for comms-format lint.
 * U5b — ENFORCE mode: opt-in hard-fail for check-(a) violations on in-scope receipts.
 *
 * U5a scenarios (enforce OFF — default):
 *   1. Written file is a malformed receipt (no guild.handoff.v2 block) → hook
 *      surfaces a WARN line on stderr; exits 0.
 *   2. Written file is a clean receipt (valid guild.handoff.v2 block) → no WARN;
 *      exits 0.
 *   3. Non-receipt / unrecognised file → no WARN; exits 0.
 *   In ALL U5a cases the hook MUST exit 0 (warn mode). Never blocks.
 *
 * U5b scenarios (GUILD_COMMS_FORMAT_ENFORCE=1):
 *   4. enforce ON + check-(a) violation (no guild.handoff.v2 block) → exit 2 (BLOCK).
 *   5. enforce ON + only check-(b)/(c) violations → exit 0 (advisory — not a block).
 *   6. enforce ON + clean receipt → exit 0 (no violation).
 *   7. enforce ON + hook error path (bad stdin) → exit 0 (resilient — never block on error).
 *
 * Opt-in mechanism: GUILD_COMMS_FORMAT_ENFORCE=1 env var (default absent/0 = warn-only).
 * Block mechanism: exit code 2 (PostToolUse hook blocking convention); reason on stderr.
 * Conservative scope: ONLY check-(a) blocks in enforce mode. check-(b)/(c) remain advisory.
 *
 * Test strategy: create a tmp directory with a fixture file, then feed a
 * PostToolUse payload (tool_name Write, tool_input.file_path → the fixture)
 * to the hook script via stdin using spawnSync. Inspect exit code + stderr.
 *
 * The test does NOT import the lint core directly — it exercises the hook as
 * a CLI child process (hermetic), consistent with the house style in
 * maybe-reflect.test.ts.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../comms-format-lint.ts");

// ── Fixture builders ────────────────────────────────────────────────────────

/** A handoff receipt that is MISSING its guild.handoff.v2 block. */
function malformedReceiptContent(): string {
  return [
    "---",
    "type: handoff_receipt",
    "task_id: U5a-test",
    "---",
    "",
    "# Handoff receipt",
    "",
    "This receipt has no embedded guild.handoff.v2 block — check (a) should fire.",
    "",
  ].join("\n");
}

/** A handoff receipt with a valid embedded guild.handoff.v2 block and artifact_category declared. */
function cleanReceiptContent(): string {
  const envelope = JSON.stringify({
    schema_version: "guild.handoff.v2",
    task_id: "U5a-test",
    tier: "mid",
    status: "done",
    summary: "Clean receipt for test.",
    artifacts: [],
    issues: [],
  });
  return [
    "---",
    "type: handoff_receipt",
    "artifact_category: agent_machine_receipt",
    "task_id: U5a-test",
    "---",
    "",
    "# Handoff receipt",
    "",
    "```guild.handoff.v2",
    envelope,
    "```",
    "",
  ].join("\n");
}

/** A plain TypeScript source file — not a communication artifact at all. */
function plainSourceContent(): string {
  return [
    "// just a regular source file",
    "export function hello() { return 'hi'; }",
  ].join("\n");
}

// ── Helper: build a PostToolUse payload ────────────────────────────────────

function makeWritePayload(filePath: string): string {
  return JSON.stringify({
    session_id: "sess-test-comms",
    cwd: path.dirname(filePath),
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: { file_path: filePath, content: "..." },
    tool_response: { success: true },
  });
}

function makeEditPayload(filePath: string): string {
  return JSON.stringify({
    session_id: "sess-test-comms",
    cwd: path.dirname(filePath),
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    tool_input: { file_path: filePath },
    tool_response: { success: true },
  });
}

// ── Helper: invoke the hook ─────────────────────────────────────────────────

function runHook(
  stdinPayload: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: stdinPayload,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("comms-format-lint.ts hook — U5a WARN ONLY", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-comms-lint-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scenario 1: malformed receipt via Write ────────────────────────────

  describe("malformed receipt (no guild.handoff.v2 block) — Write tool", () => {
    it("exits 0 (warn mode — never blocks)", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(receiptPath, malformedReceiptContent(), "utf8");
      const { exitCode } = runHook(makeWritePayload(receiptPath));
      expect(exitCode).toBe(0);
    });

    it("surfaces a WARN on stderr for check (a)", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(receiptPath, malformedReceiptContent(), "utf8");
      const { stderr } = runHook(makeWritePayload(receiptPath));
      // Match the literal comms prefix to avoid false-matching DeprecationWarning
      expect(stderr).toMatch(/\[comms-format-lint\] WARN \[check-a\]/i);
    });

    it("includes the file path in the warning", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(receiptPath, malformedReceiptContent(), "utf8");
      const { stderr } = runHook(makeWritePayload(receiptPath));
      expect(stderr).toContain(receiptPath);
    });
  });

  // ── Scenario 1b: malformed receipt via Edit ────────────────────────────

  describe("malformed receipt — Edit tool", () => {
    it("exits 0", () => {
      const receiptPath = path.join(tmpDir, "receipt.md");
      fs.writeFileSync(receiptPath, malformedReceiptContent(), "utf8");
      const { exitCode } = runHook(makeEditPayload(receiptPath));
      expect(exitCode).toBe(0);
    });

    it("surfaces a WARN on stderr", () => {
      const receiptPath = path.join(tmpDir, "receipt.md");
      fs.writeFileSync(receiptPath, malformedReceiptContent(), "utf8");
      const { stderr } = runHook(makeEditPayload(receiptPath));
      // Match the literal comms prefix to avoid false-matching DeprecationWarning
      expect(stderr).toMatch(/\[comms-format-lint\] WARN \[check-a\]/i);
    });
  });

  // ── Scenario 2: clean receipt ──────────────────────────────────────────

  describe("clean receipt (valid guild.handoff.v2 block)", () => {
    it("exits 0", () => {
      const receiptPath = path.join(tmpDir, "clean-handoff.md");
      fs.writeFileSync(receiptPath, cleanReceiptContent(), "utf8");
      const { exitCode } = runHook(makeWritePayload(receiptPath));
      expect(exitCode).toBe(0);
    });

    it("emits no WARN on stderr", () => {
      const receiptPath = path.join(tmpDir, "clean-handoff.md");
      fs.writeFileSync(receiptPath, cleanReceiptContent(), "utf8");
      const { stderr } = runHook(makeWritePayload(receiptPath));
      // No WARN lines — only the advisory OK prefix is acceptable
      expect(stderr).not.toMatch(/\bWARN\b.*check-/i);
    });
  });

  // ── Scenario 3: non-receipt plain source ──────────────────────────────

  describe("non-receipt plain source file", () => {
    it("exits 0", () => {
      const srcPath = path.join(tmpDir, "helper.ts");
      fs.writeFileSync(srcPath, plainSourceContent(), "utf8");
      const { exitCode } = runHook(makeWritePayload(srcPath));
      expect(exitCode).toBe(0);
    });

    it("emits no WARN on stderr", () => {
      const srcPath = path.join(tmpDir, "helper.ts");
      fs.writeFileSync(srcPath, plainSourceContent(), "utf8");
      const { stderr } = runHook(makeWritePayload(srcPath));
      expect(stderr).not.toMatch(/\bWARN\b.*check-/i);
    });
  });

  // ── Error resilience ──────────────────────────────────────────────────

  describe("error resilience — always exit 0", () => {
    it("exits 0 on invalid JSON stdin", () => {
      const { exitCode } = runHook("not valid json at all");
      expect(exitCode).toBe(0);
    });

    it("exits 0 when tool_input has no file_path", () => {
      const payload = JSON.stringify({
        session_id: "sess-x",
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: {},
        tool_response: { success: true },
      });
      const { exitCode } = runHook(payload);
      expect(exitCode).toBe(0);
    });

    it("exits 0 when file_path points at a nonexistent file (lintCommsFormat skips missing)", () => {
      const payload = JSON.stringify({
        session_id: "sess-x",
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/nonexistent/path/that/does/not/exist.md" },
        tool_response: { success: true },
      });
      const { exitCode } = runHook(payload);
      expect(exitCode).toBe(0);
    });
  });

  // ── Receipt in /handoffs/ directory ──────────────────────────────────

  describe("receipt in a handoffs/ directory path", () => {
    it("surfaces WARN for a malformed receipt under a handoffs/ dir", () => {
      const handoffsDir = path.join(tmpDir, "handoffs");
      fs.mkdirSync(handoffsDir, { recursive: true });
      const receiptPath = path.join(handoffsDir, "lane-1.md");
      // Plain markdown with no handoff block — looksLikeReceipt fires on the /handoffs/ path
      fs.writeFileSync(
        receiptPath,
        "# Some handoff note\n\nNo envelope here.\n",
        "utf8"
      );
      const { exitCode, stderr } = runHook(makeWritePayload(receiptPath));
      expect(exitCode).toBe(0);
      // Match the literal comms prefix to avoid false-matching DeprecationWarning
      expect(stderr).toMatch(/\[comms-format-lint\] WARN \[check-a\]/i);
    });
  });
});

// ── U5b: ENFORCE MODE (GUILD_COMMS_FORMAT_ENFORCE=1) ──────────────────────────
//
// RED-FIRST: these tests were written BEFORE the enforce path was added to
// comms-format-lint.ts. They describe the target behavior for U5b.
//
// Enforce opt-in: GUILD_COMMS_FORMAT_ENFORCE=1 env var.
// Block mechanism: exit code 2 (PostToolUse hook blocking convention).
// Conservative scope: ONLY check-(a) blocks; check-(b)/(c) stay advisory.

describe("comms-format-lint.ts hook — U5b ENFORCE MODE (GUILD_COMMS_FORMAT_ENFORCE=1)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-comms-lint-enforce-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Scenario U5b-1: enforce ON + check-(a) violation → BLOCK (exit 2) ────

  describe("enforce ON + check-(a) violation (no guild.handoff.v2 block)", () => {
    it("exits 2 (BLOCK) when enforce is enabled and receipt has no v2 block", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-test",
          "---",
          "",
          "# Handoff receipt",
          "",
          "This receipt has no embedded guild.handoff.v2 block.",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(2);
    });

    it("writes a clear BLOCK reason to stderr on check-(a) violation", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-test",
          "---",
          "",
          "No guild.handoff.v2 block here.",
          "",
        ].join("\n"),
        "utf8"
      );
      const { stderr } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      // Must describe why it blocked and what to fix
      expect(stderr).toMatch(/BLOCK/i);
      expect(stderr).toMatch(/check-a/i);
      expect(stderr).toMatch(/guild\.handoff\.v2/i);
    });

    it("includes the file path in the block message", () => {
      const receiptPath = path.join(tmpDir, "handoff.md");
      fs.writeFileSync(
        receiptPath,
        "---\ntype: handoff_receipt\ntask_id: U5b-test\n---\n\nNo block.\n",
        "utf8"
      );
      const { stderr } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(stderr).toContain(receiptPath);
    });

    it("exits 2 for duplicate guild.handoff.v2 blocks (also a check-(a) violation)", () => {
      const envelope = JSON.stringify({
        schema_version: "guild.handoff.v2",
        task_id: "U5b-dup",
        tier: "mid",
        status: "done",
        summary: "Duplicate envelope test.",
        artifacts: [],
        issues: [],
      });
      const receiptPath = path.join(tmpDir, "dup-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-dup",
          "---",
          "",
          "```guild.handoff.v2",
          envelope,
          "```",
          "",
          "```guild.handoff.v2",
          envelope,
          "```",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(2);
    });

    it("exits 2 for an invalid (malformed JSON) guild.handoff.v2 block", () => {
      const receiptPath = path.join(tmpDir, "bad-json-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-bad-json",
          "---",
          "",
          "```guild.handoff.v2",
          "{ not valid json at all",
          "```",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(2);
    });

    it("exits 2 for a guild.handoff.v2 block that fails shape validation", () => {
      // A parseable JSON block but missing required fields
      const badEnvelope = JSON.stringify({
        schema_version: "guild.handoff.v2",
        // missing: task_id, tier, status, summary, artifacts, issues
      });
      const receiptPath = path.join(tmpDir, "bad-shape-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-bad-shape",
          "---",
          "",
          "```guild.handoff.v2",
          badEnvelope,
          "```",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(2);
    });
  });

  // ── Scenario U5b-2: enforce ON + only check-(b)/(c) → NO BLOCK (exit 0) ──

  describe("enforce ON + only check-(b)/(c) violations → advisory only (exit 0)", () => {
    it("exits 0 (advisory) even when enforce is ON for a check-(c) violation", () => {
      // Use `type: review_packet` — a real current check-(c) machine type that is NOT
      // under docs/knowledge/ (where the isHumanKnowledgeDoc exemption would fire).
      // `type: decision` was removed from COMM_ARTIFACT_TYPES by the tooling-engineer's
      // core fix, so it no longer fires check-(c). This test only asserts exit 0 (not a
      // WARN assertion) so it is immune to the DeprecationWarning false-green trap, but
      // we still use a real check-(c) type so the fixture exercises what it says it does.
      const artifactPath = path.join(tmpDir, "some-review-packet.md");
      fs.writeFileSync(
        artifactPath,
        [
          "---",
          "type: review_packet",
          "owner: qa",
          "---",
          "",
          "# Review packet (no artifact_category)",
          "",
          "check-(c) fires; enforce mode must NOT block on it.",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(artifactPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      // check-(c) is advisory even in enforce mode — must NOT block
      expect(exitCode).toBe(0);
    });

    it("exits 0 for check-(c) violation in enforce mode — still warns", () => {
      // Use `type: review_packet` — a real current check-(c) machine type (in COMM_ARTIFACT_TYPES)
      // that is NOT under docs/knowledge/ (where the isHumanKnowledgeDoc exemption fires).
      // `type: decision` was removed from COMM_ARTIFACT_TYPES by the tooling-engineer's core
      // fix, so it no longer fires check-(c) at all — using it here was a false-green
      // that accidentally matched "DeprecationWarning" on bare /WARN/i.
      const artifactPath = path.join(tmpDir, "review-packet.md");
      fs.writeFileSync(
        artifactPath,
        [
          "---",
          "type: review_packet",
          "owner: qa",
          "---",
          "",
          "# Review packet",
          "",
          "Missing artifact_category: — check-(c) must fire (advisory only, not a block).",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode, stderr } = runHook(makeWritePayload(artifactPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(0);
      // Assert on the actual check-(c) comms message — not bare /WARN/i which can
      // false-match "DeprecationWarning" from node/tsx when no comms output exists.
      expect(stderr).toMatch(/\[comms-format-lint\] WARN \[check-c\]/i);
      expect(stderr).toMatch(/artifact_category/i);
    });
  });

  // ── Scenario U5b-3: enforce ON + clean receipt → NO BLOCK (exit 0) ────────

  describe("enforce ON + clean receipt (valid guild.handoff.v2 block) → no block", () => {
    it("exits 0 when enforce is ON and receipt is clean", () => {
      const envelope = JSON.stringify({
        schema_version: "guild.handoff.v2",
        task_id: "U5b-clean",
        tier: "mid",
        status: "done",
        summary: "Clean receipt — no violations.",
        artifacts: [],
        issues: [],
      });
      const receiptPath = path.join(tmpDir, "clean-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "artifact_category: agent_machine_receipt",
          "task_id: U5b-clean",
          "---",
          "",
          "# Clean handoff receipt",
          "",
          "```guild.handoff.v2",
          envelope,
          "```",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(0);
    });

    it("emits no block on stderr for a clean receipt in enforce mode", () => {
      const envelope = JSON.stringify({
        schema_version: "guild.handoff.v2",
        task_id: "U5b-clean-2",
        tier: "mid",
        status: "done",
        summary: "Another clean receipt.",
        artifacts: [],
        issues: [],
      });
      const receiptPath = path.join(tmpDir, "clean2-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "artifact_category: agent_machine_receipt",
          "task_id: U5b-clean-2",
          "---",
          "",
          "```guild.handoff.v2",
          envelope,
          "```",
          "",
        ].join("\n"),
        "utf8"
      );
      const { stderr } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(stderr).not.toMatch(/BLOCK/i);
    });
  });

  // ── Scenario U5b-4: enforce ON + hook error paths → NEVER BLOCK (exit 0) ──

  describe("enforce ON + hook error paths → always exit 0 (resilient)", () => {
    it("exits 0 on invalid JSON stdin even when enforce is ON", () => {
      const { exitCode } = runHook("not valid json at all", {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(0);
    });

    it("exits 0 when file_path is missing even when enforce is ON", () => {
      const payload = JSON.stringify({
        session_id: "sess-enforce-x",
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: {},
        tool_response: { success: true },
      });
      const { exitCode } = runHook(payload, {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(0);
    });

    it("exits 0 when file_path points at a nonexistent file even when enforce is ON", () => {
      const payload = JSON.stringify({
        session_id: "sess-enforce-missing",
        hook_event_name: "PostToolUse",
        tool_name: "Write",
        tool_input: { file_path: "/nonexistent/enforce-test/receipt.md" },
        tool_response: { success: true },
      });
      const { exitCode } = runHook(payload, {
        GUILD_COMMS_FORMAT_ENFORCE: "1",
      });
      expect(exitCode).toBe(0);
    });
  });

  // ── Scenario U5b-5: enforce OFF (default) + check-(a) → WARN only (exit 0) ─

  describe("enforce OFF (default) — U5a behavior unchanged", () => {
    it("exits 0 (warn-only) with no GUILD_COMMS_FORMAT_ENFORCE var set", () => {
      const receiptPath = path.join(tmpDir, "no-enforce-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-no-enforce",
          "---",
          "",
          "No guild.handoff.v2 block — should warn only.",
          "",
        ].join("\n"),
        "utf8"
      );
      // Note: runHook by default does NOT set GUILD_COMMS_FORMAT_ENFORCE
      const { exitCode, stderr } = runHook(makeWritePayload(receiptPath));
      expect(exitCode).toBe(0);
      // Match literal comms prefix — avoids false-matching DeprecationWarning
      expect(stderr).toMatch(/\[comms-format-lint\] WARN \[check-a\]/i); // advisory still fires
    });

    it("exits 0 (warn-only) when GUILD_COMMS_FORMAT_ENFORCE=0 (explicitly off)", () => {
      const receiptPath = path.join(tmpDir, "enforce-zero-handoff.md");
      fs.writeFileSync(
        receiptPath,
        [
          "---",
          "type: handoff_receipt",
          "task_id: U5b-enforce-zero",
          "---",
          "",
          "No v2 block — enforce explicitly off.",
          "",
        ].join("\n"),
        "utf8"
      );
      const { exitCode } = runHook(makeWritePayload(receiptPath), {
        GUILD_COMMS_FORMAT_ENFORCE: "0",
      });
      expect(exitCode).toBe(0);
    });
  });
});
