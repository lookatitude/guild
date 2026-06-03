/**
 * hooks/__tests__/comms-format-lint.test.ts
 *
 * TDD: written before comms-format-lint.ts implementation.
 * U5a — WARN ONLY local-advisory hook for comms-format lint.
 *
 * Three scenarios exercised:
 *   1. Written file is a malformed receipt (no guild.handoff.v2 block) → hook
 *      surfaces a WARN line on stderr; exits 0.
 *   2. Written file is a clean receipt (valid guild.handoff.v2 block) → no WARN;
 *      exits 0.
 *   3. Non-receipt / unrecognised file → no WARN; exits 0.
 *
 * In ALL cases the hook MUST exit 0 (warn mode). Never blocks.
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
      expect(stderr).toMatch(/WARN/i);
      expect(stderr).toMatch(/check-a/i);
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
      expect(stderr).toMatch(/WARN/i);
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
      expect(stderr).toMatch(/WARN/i);
    });
  });
});
