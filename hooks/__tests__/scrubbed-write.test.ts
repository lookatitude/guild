/**
 * hooks/__tests__/scrubbed-write.test.ts
 *
 * TDD: written BEFORE the HK-06 scrubbed-write implementation.
 *
 * Proves:
 *   1. COVERAGE (actual leak): record with secret-shaped token → on-disk file
 *      has the token REDACTED. Proves the scrubber ran on the real write path.
 *   2. FAIL-CLOSED EFFECT (forced ok=false via invalid regex): durable surface
 *      → `fs.existsSync(outPath) === false` (file does NOT land), plus
 *      `secret_scrub_blocked` security event, plus approval_request on bus,
 *      plus caller receives `blocked: true`.
 *   3. FAIL-OPEN TELEMETRY (same invalid regex): telemetry surface → file
 *      EXISTS with built-in-redacted content + `degraded` security event +
 *      caller receives `written: true, blocked: false`.
 *   4. SHA-AFTER-SCRUB (bus surface): stored file's content sha256 equals
 *      sha256(scrubbed) and NOT sha256(raw).
 *   5. PRE-EXISTING FILE UNCHANGED on fail-CLOSED: if file existed before the
 *      blocked write, its content is unchanged afterward.
 *
 * DRIFT-ANALYSIS finding addressed: HK-06 (HIGH/security) — durable `.guild/`
 *   writers (e.g. persistLearnings) do raw fs.writeFileSync with NO scrub.
 *   The scrubber (applySecretsPolicy) exists but callers bypass it.
 *
 * Spec: .guild/initiatives/active/drift-remediation/contracts/
 *         wave2-hk06-secrets-scrub-coverage.md
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

import { scrubbedWrite, type ScrubSurface } from "../lib/security/scrubbed-write";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeEnv(): { tmp: string; runDir: string; runId: string; settingsPath: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scrub-"));
  // Minimal .git for resolveGuildRoot
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  const runId = "run-scrub-test";
  const runDir = path.join(tmp, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
  const settingsPath = path.join(tmp, ".guild", "settings.json");
  return { tmp, runDir, runId, settingsPath };
}

function writeSettings(settingsPath: string, override: Record<string, unknown>): void {
  fs.writeFileSync(settingsPath, JSON.stringify(override, null, 2), "utf8");
}

function readSecurityEvents(runDir: string): Array<Record<string, unknown>> {
  const f = path.join(runDir, "logs", "security-events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function readApprovalRequests(runDir: string): Array<Record<string, unknown>> {
  const dir = path.join(runDir, "agent-bus", "approvals");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>);
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// A token that built-in redaction (group 1 token-shape) will catch:
//   /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/g
const FAKE_SECRET = "sk-ant-FAKESECRETVALUE1234567890";
const CLEAN_CONTENT = JSON.stringify({ schema_version: "guild.learnings.v1", task_id: "t1" });
const SECRET_CONTENT = JSON.stringify({
  schema_version: "guild.learnings.v1",
  api_token: FAKE_SECRET,
  task_id: "t1",
});

// Invalid redaction_patterns entry → applySecretsPolicy returns ok=false
const INVALID_REGEX = "[unclosed-bracket-regex";

// ── Test suite ───────────────────────────────────────────────────────────────

describe("scrubbedWrite — HK-06 durable write choke-point", () => {
  let tmp: string;
  let runDir: string;
  let runId: string;
  let settingsPath: string;

  beforeEach(() => {
    ({ tmp, runDir, runId, settingsPath } = makeEnv());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── 1. Clean write ─────────────────────────────────────────────────────────

  describe("clean content — durable surface", () => {
    it("writes the file (written:true, blocked:false) for clean content", () => {
      const outPath = path.join(runDir, "learnings", "backend-t1.json");
      const result = scrubbedWrite(outPath, CLEAN_CONTENT, {
        surface: "learnings",
        runDir,
        runId,
        laneId: "backend",
      });
      expect(result.written).toBe(true);
      expect(result.blocked).toBe(false);
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it("file content equals clean content (no corruption)", () => {
      const outPath = path.join(runDir, "learnings", "backend-t2.json");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      expect(fs.readFileSync(outPath, "utf8")).toBe(CLEAN_CONTENT);
    });

    it("does NOT emit a security event for a clean successful write", () => {
      const outPath = path.join(runDir, "learnings", "backend-t3.json");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      expect(readSecurityEvents(runDir)).toHaveLength(0);
    });
  });

  // ── 2. Coverage: secret is redacted in the on-disk file ─────────────────

  describe("coverage: secret-shaped token is redacted on disk", () => {
    it("on-disk file does NOT contain the raw secret (built-in scrub ran)", () => {
      const outPath = path.join(runDir, "learnings", "backend-secret.json");
      scrubbedWrite(outPath, SECRET_CONTENT, { surface: "learnings", runDir, runId });
      const onDisk = fs.readFileSync(outPath, "utf8");
      expect(onDisk).not.toContain(FAKE_SECRET);
    });

    it("on-disk file contains the redaction sentinel in place of the secret", () => {
      const outPath = path.join(runDir, "learnings", "backend-secret2.json");
      scrubbedWrite(outPath, SECRET_CONTENT, { surface: "learnings", runDir, runId });
      const onDisk = fs.readFileSync(outPath, "utf8");
      // Either REDACTED_TOKEN (group 1) or REDACTED (group 3 kv) replaces the secret
      expect(onDisk).toMatch(/\[REDACTED(?:_TOKEN)?\]/);
    });

    it("non-secret fields survive the scrub intact", () => {
      const outPath = path.join(runDir, "learnings", "backend-secret3.json");
      scrubbedWrite(outPath, SECRET_CONTENT, { surface: "learnings", runDir, runId });
      const onDisk = fs.readFileSync(outPath, "utf8");
      expect(onDisk).toContain("guild.learnings.v1");
      expect(onDisk).toContain("t1");
    });
  });

  // ── 3. FAIL-CLOSED: durable surface + forced ok=false ───────────────────

  describe("fail-CLOSED effect (durable surface + forced ok=false)", () => {
    beforeEach(() => {
      // Force ok=false by providing an invalid custom regex
      writeSettings(settingsPath, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
    });

    it("returns blocked:true on forced ok=false for durable surface", () => {
      const outPath = path.join(runDir, "learnings", "backend-blocked.json");
      const result = scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      expect(result.blocked).toBe(true);
      expect(result.written).toBe(false);
    });

    it("THE LOAD-BEARING NEGATIVE: file does NOT exist on disk after fail-CLOSED", () => {
      const outPath = path.join(runDir, "learnings", "backend-no-file.json");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      // The file must NOT land — this is the on-disk EFFECT the spec requires
      expect(fs.existsSync(outPath)).toBe(false);
    });

    it("emits secret_scrub_blocked security event on fail-CLOSED", () => {
      const outPath = path.join(runDir, "learnings", "backend-event.json");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId, laneId: "backend" });
      const events = readSecurityEvents(runDir);
      const blocked = events.find((e) => e["event_type"] === "secret_scrub_blocked");
      expect(blocked).toBeDefined();
      expect(blocked!["decision"]).toBe("blocked");
      expect(blocked!["schema_version"]).toBe("guild.security_event.v1");
    });

    it("writes approval_request to agent-bus/approvals/ on fail-CLOSED", () => {
      const outPath = path.join(runDir, "learnings", "backend-approval.json");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      const approvals = readApprovalRequests(runDir);
      expect(approvals.length).toBeGreaterThanOrEqual(1);
      expect(approvals[0]!["schema_version"]).toBe("guild.approval_request.v1");
    });

    it("pre-existing file is UNCHANGED after a fail-CLOSED write attempt", () => {
      const outPath = path.join(runDir, "learnings", "pre-existing.json");
      const priorContent = JSON.stringify({ existing: true });
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, priorContent, "utf8");

      scrubbedWrite(outPath, "new content that should not land", { surface: "learnings", runDir, runId });

      // File still has the prior content, not the new attempted write
      expect(fs.readFileSync(outPath, "utf8")).toBe(priorContent);
    });

    it("fail-CLOSED covers all durable surfaces (handoff, provenance, wiki, review, bus)", () => {
      const surfaces: ScrubSurface[] = ["handoff", "provenance", "wiki", "review", "bus"];
      for (const surface of surfaces) {
        const outPath = path.join(tmp, `test-${surface}.txt`);
        const result = scrubbedWrite(outPath, CLEAN_CONTENT, { surface, runDir, runId });
        expect(result.blocked).toBe(true);
        expect(fs.existsSync(outPath)).toBe(false);
      }
    });
  });

  // ── 4. FAIL-OPEN: telemetry surface + forced ok=false ───────────────────

  describe("fail-OPEN (telemetry surface + forced ok=false)", () => {
    beforeEach(() => {
      writeSettings(settingsPath, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_telemetry: "open",
          fail_mode_durable: "closed",
        },
      });
    });

    it("returns written:true, blocked:false for telemetry surface", () => {
      const outPath = path.join(runDir, "logs", "telemetry.jsonl");
      const result = scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "telemetry", runDir, runId });
      expect(result.written).toBe(true);
      expect(result.blocked).toBe(false);
    });

    it("file EXISTS on disk (telemetry is fail-open)", () => {
      const outPath = path.join(runDir, "logs", "telemetry2.jsonl");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "telemetry", runDir, runId });
      expect(fs.existsSync(outPath)).toBe(true);
    });

    it("file content has built-in redaction applied (not raw)", () => {
      const outPath = path.join(runDir, "logs", "telemetry3.jsonl");
      scrubbedWrite(outPath, SECRET_CONTENT, { surface: "telemetry", runDir, runId });
      const onDisk = fs.readFileSync(outPath, "utf8");
      // Built-ins always apply — secret not raw
      expect(onDisk).not.toContain(FAKE_SECRET);
    });

    it("emits degraded security event for fail-OPEN scrub failure", () => {
      const outPath = path.join(runDir, "logs", "telemetry4.jsonl");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "telemetry", runDir, runId });
      const events = readSecurityEvents(runDir);
      const degraded = events.find((e) =>
        e["event_type"] === "secret_scrub_blocked" && e["decision"] === "degraded",
      );
      expect(degraded).toBeDefined();
    });

    it("does NOT write approval_request for telemetry (fail-open → no block)", () => {
      const outPath = path.join(runDir, "logs", "telemetry5.jsonl");
      scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "telemetry", runDir, runId });
      expect(readApprovalRequests(runDir)).toHaveLength(0);
    });
  });

  // ── 5. SHA-after-scrub (bus surface) ───────────────────────────────────────

  describe("SHA-after-scrub: bus surface", () => {
    it("returns sha256 field for bus surface on successful write", () => {
      const outPath = path.join(runDir, "bus", "artifact.json");
      const result = scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "bus", runDir, runId });
      expect(result.sha256).toBeDefined();
      expect(typeof result.sha256).toBe("string");
      expect(result.sha256!.length).toBe(64); // SHA-256 hex
    });

    it("sha256 returned equals sha256 of the SCRUBBED (on-disk) content, not raw", () => {
      const outPath = path.join(runDir, "bus", "artifact2.json");
      const result = scrubbedWrite(outPath, SECRET_CONTENT, { surface: "bus", runDir, runId });
      expect(result.written).toBe(true);
      const onDisk = fs.readFileSync(outPath, "utf8");
      // sha256(returned) === sha256(stored)
      expect(result.sha256).toBe(sha256(onDisk));
      // sha256(returned) !== sha256(raw) (since the secret was redacted)
      expect(result.sha256).not.toBe(sha256(SECRET_CONTENT));
    });

    it("does NOT return sha256 for non-bus surfaces", () => {
      const outPath = path.join(runDir, "learnings", "no-sha.json");
      const result = scrubbedWrite(outPath, CLEAN_CONTENT, { surface: "learnings", runDir, runId });
      expect(result.sha256).toBeUndefined();
    });
  });
});
