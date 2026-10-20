/**
 * hooks/__tests__/post-tool-use-scrub.test.ts
 *
 * TDD (written BEFORE HK-06 wiki+review surface implementation):
 * On-disk FINAL-state tests for the PostToolUse scrub-in-place interceptor
 * wired into post-tool-use.ts.
 *
 * CONTRACT (D-SECRETS / HK-06, amended by #108 / D2):
 *   Prose (Markdown under .guild/wiki/**, runs/<id>/review/**, runs/<id>/handoffs/**)
 *   is never rewritten in place. A credential shape (or an invalid operator
 *   pattern) on disk after Write|Edit restores the prior bytes PreToolUse
 *   snapshotted and emits secret_scrub_blocked; nothing is quarantined.
 *   provenance.json keeps scrub-in-place: ok=false → quarantine ladder.
 *   PostToolUse exits 0 (non-blocking).
 *
 * Tests prove the on-disk EFFECT, not just "scrubber called".
 */

import { describe, it, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../dist/post-tool-use.js");
const RUN = "run-ptu-scrub-test";

// T3b (session_context §5): run-dir writes are binding-gated; fixtures mint
// the run's binding. hermeticEnv strips any outer Guild-lane env.
import { mintTestBinding } from "../test-support/mint-binding";
import { hermeticEnv } from "../test-support/hermetic-env";
const FAKE_SECRET = "sk-ant-FAKESECRETVALUE1234567890";
const INVALID_REGEX = "[unclosed-bracket-regex";

// ── Helpers ─────────────────────────────────────────────────────────────────

function setup(): { tmp: string; guildRoot: string; runDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-scrub-"));
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  const runDir = path.join(tmp, ".guild", "runs", RUN);
  fs.mkdirSync(runDir, { recursive: true });
  // Write current-run-id sentinel
  fs.mkdirSync(path.join(tmp, ".guild", "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".guild", "runs", "current-run-id"),
    RUN,
    "utf8",
  );
  mintTestBinding(tmp, RUN);
  return { tmp, guildRoot: tmp, runDir };
}

function writeSettings(tmp: string, override: Record<string, unknown>): void {
  const guildDir = path.join(tmp, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(
    path.join(guildDir, "settings.json"),
    JSON.stringify(override, null, 2),
    "utf8",
  );
}

function spawnHook(
  tmp: string,
  toolName: "Write" | "Edit",
  filePath: string,
): { exitCode: number; stderr: string } {
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: toolName,
    // The tool's input is the bytes it wrote (what is on disk now).
    tool_input: { file_path: filePath, content: fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "" },
    tool_response: { success: true },
    session_id: RUN.replace("run-", ""),
    cwd: tmp,
  };

  const result = spawnSync(process.execPath, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...hermeticEnv(),
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      GUILD_RUN_BINDING_REF: `rb-test-${RUN}`,
    },
    timeout: 30000,
  });
  return { exitCode: result.status ?? 1, stderr: result.stderr ?? "" };
}

const PRE_SCRIPT = path.resolve(__dirname, "../dist/pre-tool-use.js");

/**
 * Run the real PreToolUse hook with an Edit it cannot predict (old_string absent),
 * so it allows and snapshots the current bytes, exactly as a live session would
 * before the tool writes.
 */
function snapshotViaPre(tmp: string, filePath: string, runEnv: Record<string, string> = {}): void {
  const r = spawnSync(process.execPath, [PRE_SCRIPT], {
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      tool_input: { file_path: filePath, old_string: "\u0000absent\u0000", new_string: "x" },
      session_id: RUN.replace("run-", ""),
      cwd: tmp,
    }),
    encoding: "utf8",
    env: {
      ...hermeticEnv(),
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      GUILD_RUN_BINDING_REF: `rb-test-${RUN}`,
      ...runEnv,
    },
    timeout: 30000,
  });
  expect(r.stdout ?? "").not.toContain('"deny"');
}

function securityEvents(runDir: string): Array<Record<string, unknown>> {
  const f = path.join(runDir, "logs", "security-events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("post-tool-use.ts — HK-06 durable-surface scrub (prose: refuse, never rewrite)", () => {
  let tmp: string;
  let runDir: string;

  beforeEach(() => {
    ({ tmp, runDir } = setup());
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ── Wiki surface ────────────────────────────────────────────────────────────

  describe("wiki surface (.guild/wiki/**)", () => {
    it("PostToolUse exits 0 (never blocks) even when scrubbing a wiki file", () => {
      const wikiPath = path.join(tmp, ".guild", "wiki", "some-page.md");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      fs.writeFileSync(wikiPath, `# Page\nToken: ${FAKE_SECRET}\n`, "utf8");

      const { exitCode } = spawnHook(tmp, "Write", wikiPath);
      expect(exitCode).toBe(0);
    });

    it("a secret on disk after the write is undone by restoring the prior bytes", () => {
      const wikiPath = path.join(tmp, ".guild", "wiki", "some-page.md");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      const prior = "# Page\nprior body\n";
      fs.writeFileSync(wikiPath, prior, "utf8");
      snapshotViaPre(tmp, wikiPath);
      fs.writeFileSync(wikiPath, `# Page\nToken: ${FAKE_SECRET}\n`, "utf8");

      spawnHook(tmp, "Write", wikiPath);

      const onDisk = fs.readFileSync(wikiPath, "utf8");
      expect(onDisk).not.toContain(FAKE_SECRET);
      expect(onDisk).toBe(prior);
    });

    it("clean wiki prose is never rewritten: long identifiers, paths and key: value lines survive byte-identical", () => {
      const wikiPath = path.join(tmp, ".guild", "wiki", "clean.md");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      const content = "# Page\nSee app/Http/Middleware/EnforceSessionMaxDuration.php and ApiPerformanceMonitor.\ntoken: rotate monthly\n~/.claude/settings.json\n";
      fs.writeFileSync(wikiPath, content, "utf8");

      spawnHook(tmp, "Write", wikiPath);

      const onDisk = fs.readFileSync(wikiPath, "utf8");
      expect(onDisk).toBe(content);
      expect(onDisk).not.toMatch(/REDACTED/);
    });

    it("preserves multiple legitimate .guild paths on the real wiki write path while still removing the secret", () => {
      const wikiPath = path.join(tmp, ".guild", "wiki", "path-preservation.md");
      const expectedPaths = [
        ".guild/wiki/decisions/workspace-knowledge-flow.md",
        ".guild/runs/run-20260812-010000-hook-output/handoffs/security-W4.md",
        ".guild/initiatives/active/hook-output-hygiene/initiative.yaml",
        ".guild/artifacts/audits/hook-output-budget.json",
      ];
      const content = [
        "# Durable references",
        "",
        ...expectedPaths.map((ref) => `- ${ref}`),
        "",
      ].join("\n");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      fs.writeFileSync(wikiPath, content, "utf8");
      snapshotViaPre(tmp, wikiPath);
      fs.writeFileSync(wikiPath, `${content}api_key: ${FAKE_SECRET}\n`, "utf8");

      const { exitCode } = spawnHook(tmp, "Write", wikiPath);
      expect(exitCode).toBe(0);

      const onDisk = fs.readFileSync(wikiPath, "utf8");
      for (const ref of expectedPaths) expect(onDisk).toContain(ref);
      expect(onDisk).not.toContain(FAKE_SECRET);
      expect(onDisk).toBe(content);
    });

    it("forced ok=false (invalid regex) fails closed on wiki prose by restoring the prior bytes, never quarantining", () => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
      const wikiPath = path.join(tmp, ".guild", "wiki", "quarantine-me.md");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      const prior = "# Page\nPrior.\n";
      fs.writeFileSync(wikiPath, prior, "utf8");
      snapshotViaPre(tmp, wikiPath);
      fs.writeFileSync(wikiPath, `# Page\nSome content.\n`, "utf8");

      spawnHook(tmp, "Write", wikiPath);

      expect(fs.readFileSync(wikiPath, "utf8")).toBe(prior);
      expect(fs.existsSync(wikiPath + ".quarantined")).toBe(false);
    });

    it("emits secret_scrub_blocked event on forced ok=false for wiki", () => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
      const wikiPath = path.join(tmp, ".guild", "wiki", "event-test.md");
      fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
      fs.writeFileSync(wikiPath, "# Page\nContent.\n", "utf8");

      spawnHook(tmp, "Write", wikiPath);

      const events = securityEvents(runDir);
      const blocked = events.find(
        (e) =>
          e["event_type"] === "secret_scrub_blocked" && e["decision"] === "blocked",
      );
      expect(blocked).toBeDefined();
    });
  });

  // ── Review surface ──────────────────────────────────────────────────────────

  describe("review surface (.guild/runs/<id>/review/**)", () => {
    it("on-disk review file does NOT contain the raw secret after the hook (prior restored)", () => {
      const reviewDir = path.join(runDir, "review");
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewPath = path.join(reviewDir, "review.md");
      snapshotViaPre(tmp, reviewPath); // prior: absent
      fs.writeFileSync(reviewPath, `# Review\nToken: ${FAKE_SECRET}\n`, "utf8");

      spawnHook(tmp, "Write", reviewPath);

      expect(fs.existsSync(reviewPath)).toBe(false);
    });

    it("forced ok=false on review prose restores the prior state, never quarantines", () => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
      const reviewDir = path.join(runDir, "review");
      fs.mkdirSync(reviewDir, { recursive: true });
      const reviewPath = path.join(reviewDir, "review.md");
      fs.writeFileSync(reviewPath, "# Review\nPrior.\n", "utf8");
      snapshotViaPre(tmp, reviewPath);
      fs.writeFileSync(reviewPath, "# Review\nContent.\n", "utf8");

      spawnHook(tmp, "Write", reviewPath);

      expect(fs.readFileSync(reviewPath, "utf8")).toBe("# Review\nPrior.\n");
      expect(fs.existsSync(reviewPath + ".quarantined")).toBe(false);
    });
  });

  // ── Handoff surface (C3 fix 3: model-written receipts via Write tool) ──────
  // The subagent/in-process backends write handoff receipts with the Write
  // tool — no TaskCompleted hook fires there, so the PostToolUse scrub-in-place
  // is the ONLY deterministic secrets pass on that path.

  describe("handoff surface (.guild/runs/<id>/handoffs/**)", () => {
    it("on-disk handoff receipt does NOT contain the raw secret after the hook (prior restored)", () => {
      const handoffDir = path.join(runDir, "handoffs");
      fs.mkdirSync(handoffDir, { recursive: true });
      const handoffPath = path.join(handoffDir, "backend-T1.md");
      fs.writeFileSync(handoffPath, "summary: prior\n", "utf8");
      snapshotViaPre(tmp, handoffPath);
      fs.writeFileSync(
        handoffPath,
        `schema_version: guild.handoff.v2\nsummary: done\nevidence: Token ${FAKE_SECRET}\n`,
        "utf8",
      );

      const { exitCode } = spawnHook(tmp, "Write", handoffPath);
      expect(exitCode).toBe(0);

      const onDisk = fs.readFileSync(handoffPath, "utf8");
      expect(onDisk).not.toContain(FAKE_SECRET);
      expect(onDisk).toBe("summary: prior\n");
    });

    it("forced ok=false on a handoff receipt fails closed by restoring the prior bytes (no quarantine)", () => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
      const handoffDir = path.join(runDir, "handoffs");
      fs.mkdirSync(handoffDir, { recursive: true });
      const handoffPath = path.join(handoffDir, "backend-T2.md");
      fs.writeFileSync(handoffPath, "summary: prior\n", "utf8");
      snapshotViaPre(tmp, handoffPath);
      fs.writeFileSync(handoffPath, "summary: content\n", "utf8");

      spawnHook(tmp, "Write", handoffPath);

      expect(fs.readFileSync(handoffPath, "utf8")).toBe("summary: prior\n");
      expect(fs.existsSync(handoffPath + ".quarantined")).toBe(false);
      const events = securityEvents(runDir);
      expect(
        events.some(
          (e) => e["event_type"] === "secret_scrub_blocked" && e["decision"] === "blocked",
        ),
      ).toBe(true);
    });
  });

  // ── Provenance surface (.guild/runs/<id>/provenance.json) ──────────────────

  describe("provenance surface (.guild/runs/<id>/provenance.json)", () => {
    it("on-disk provenance.json does NOT contain the raw secret after the hook", () => {
      const provenancePath = path.join(runDir, "provenance.json");
      fs.writeFileSync(
        provenancePath,
        JSON.stringify({ run_id: RUN, note: `Token ${FAKE_SECRET}` }),
        "utf8",
      );

      spawnHook(tmp, "Write", provenancePath);

      const onDisk = fs.readFileSync(provenancePath, "utf8");
      expect(onDisk).not.toContain(FAKE_SECRET);
    });

    it("a nested file merely NAMED provenance.json deeper in the run dir is not classified", () => {
      const nested = path.join(runDir, "logs", "provenance.json");
      fs.mkdirSync(path.dirname(nested), { recursive: true });
      const content = `{"token":"${FAKE_SECRET}"}`;
      fs.writeFileSync(nested, content, "utf8");

      spawnHook(tmp, "Write", nested);

      // Only the run-root provenance.json is the provenance surface.
      expect(fs.readFileSync(nested, "utf8")).toBe(content);
    });
  });

  // ── MAJOR 1: quarantine-rename-failure ladder (provenance; prose never quarantines) ─
  // When the quarantine rename fails, the hook MUST still remove the raw content
  // from the canonical path. PostToolUse always exits 0 for normal scrub failures,
  // but exits non-zero only on the truly catastrophic case (rename AND unlink/overwrite
  // both fail). Here we test the recoverable ladder (rename fails → overwrite/unlink ok).

  describe("quarantine-rename-failure ladder", () => {
    it("canonical path does NOT contain raw secret when rename-to-quarantine fails (provenance)", () => {
      writeSettings(tmp, {
        secrets_policy: {
          redaction_patterns: [INVALID_REGEX],
          fail_mode_durable: "closed",
        },
      });
      const provPath = path.join(runDir, "provenance.json");
      fs.writeFileSync(provPath, JSON.stringify({ note: `Token: ${FAKE_SECRET}` }), "utf8");
      // Pre-create quarantine path as a non-empty directory → fs.renameSync fails
      fs.mkdirSync(path.join(provPath + ".quarantined", "occupied"), { recursive: true });

      spawnHook(tmp, "Write", provPath);

      // Canonical MUST NOT hold the raw secret regardless of rename result
      if (fs.existsSync(provPath)) {
        expect(fs.readFileSync(provPath, "utf8")).not.toContain(FAKE_SECRET);
      }
    });
  });

  // ── MAJOR B: wiki scrub fires even when there is no active run-id ───────────
  // Wiki pages (.guild/wiki/**) are project-scoped, not run-scoped.
  // The scrub must fire even when GUILD_RUN_ID is unset and current-run-id
  // does not exist — the run-id gate must NOT bypass the wiki surface.

  describe("wiki scrub fires without an active run-id", () => {
    it("wiki file is scrubbed even when no run-id is set (project-scoped write)", () => {
      // Create a completely fresh tmp WITHOUT a current-run-id sentinel
      const freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-nowiki-"));
      fs.mkdirSync(path.join(freshTmp, ".git"), { recursive: true });
      // Deliberately NO current-run-id and NO GUILD_RUN_ID

      try {
        const wikiPath = path.join(freshTmp, ".guild", "wiki", "no-run-id-page.md");
        fs.mkdirSync(path.dirname(wikiPath), { recursive: true });
        const prior = "# Page\nPrior.\n";
        fs.writeFileSync(wikiPath, prior, "utf8");
        const preResult = spawnSync(process.execPath, [PRE_SCRIPT], {
          input: JSON.stringify({
            hook_event_name: "PreToolUse",
            tool_name: "Edit",
            tool_input: { file_path: wikiPath, old_string: "\u0000absent\u0000", new_string: "x" },
            session_id: "no-run-session",
            cwd: freshTmp,
          }),
          encoding: "utf8",
          env: { ...hermeticEnv(), GUILD_CWD: freshTmp, GUILD_RUN_ID: "", GUILD_RUN_DIR: "" },
          timeout: 30000,
        });
        expect(preResult.stdout ?? "").not.toContain('"deny"');
        fs.writeFileSync(wikiPath, `# Page\nToken: ${FAKE_SECRET}\n`, "utf8");

        const payload = {
          hook_event_name: "PostToolUse",
          tool_name: "Write",
          tool_input: { file_path: wikiPath, content: `# Page\nToken: ${FAKE_SECRET}\n` },
          tool_response: { success: true },
          session_id: "no-run-session",
          cwd: freshTmp,
        };

        const result = spawnSync("npx", ["tsx", SCRIPT], {
          input: JSON.stringify(payload),
          encoding: "utf8",
          env: {
            ...hermeticEnv(),
            GUILD_CWD: freshTmp,
            // Explicitly unset GUILD_RUN_ID and GUILD_RUN_DIR
            GUILD_RUN_ID: "",
            GUILD_RUN_DIR: "",
          },
          timeout: 30000,
        });

        // Must exit 0 — telemetry path is skipped (no run-id) but scrub still ran
        expect(result.status).toBe(0);

        // The secret MUST be undone despite no active run-id
        const onDisk = fs.readFileSync(wikiPath, "utf8");
        expect(onDisk).not.toContain(FAKE_SECRET);
        expect(onDisk).toBe(prior);
      } finally {
        fs.rmSync(freshTmp, { recursive: true, force: true });
      }
    });
  });

  // ── Non-target paths: no scrub ──────────────────────────────────────────────

  describe("non-target paths: scrub does NOT run", () => {
    it("does not modify a file outside .guild/ wiki or review paths", () => {
      const outsidePath = path.join(tmp, "README.md");
      const originalContent = `# README\nToken: ${FAKE_SECRET}\n`;
      fs.writeFileSync(outsidePath, originalContent, "utf8");

      spawnHook(tmp, "Write", outsidePath);

      // File should be unchanged — scrub does not fire outside the target paths
      expect(fs.readFileSync(outsidePath, "utf8")).toBe(originalContent);
    });

    it("does not modify a file in .guild/ but NOT wiki or review", () => {
      const learningsPath = path.join(tmp, ".guild", "runs", RUN, "learnings", "test.json");
      fs.mkdirSync(path.dirname(learningsPath), { recursive: true });
      const content = `{"token":"${FAKE_SECRET}"}`;
      fs.writeFileSync(learningsPath, content, "utf8");

      spawnHook(tmp, "Write", learningsPath);

      // PostToolUse does not scrub learnings (that's task-completed's domain)
      expect(fs.readFileSync(learningsPath, "utf8")).toBe(content);
    });
  });
});
