/**
 * hooks/__tests__/maybe-reflect.test.ts
 *
 * TDD: written before maybe-reflect.ts implementation.
 * Verifies the heuristic gate (§13.2 + §15.2):
 *   GATE PASSES  → ≥ 1 specialist dispatched + ≥ 1 file edited + no error event
 *   GATE FAILS   → any condition missing → no-op (silent, exit 0)
 *
 * The test sets up a temporary .guild/runs/<run-id>/events.ndjson, then
 * spawns maybe-reflect.ts with the Stop fixture on stdin.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../maybe-reflect.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

const SPECIALIST_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "SubagentStop",
  tool: "",
  specialist: "backend",
  payload_digest: "abc123",
  ok: true,
  ms: 1200,
});

const FILE_EDIT_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "PostToolUse",
  tool: "Write",
  specialist: "backend",
  payload_digest: "def456",
  ok: true,
  ms: 50,
});

const ERROR_EVENT = JSON.stringify({
  ts: new Date().toISOString(),
  event: "PostToolUse",
  tool: "Bash",
  specialist: "backend",
  payload_digest: "err789",
  ok: false,
  ms: 300,
});

function makeRunDir(tmpDir: string, runId: string, events: string[]): string {
  const runDir = path.join(tmpDir, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  if (events.length > 0) {
    fs.writeFileSync(
      path.join(runDir, "events.ndjson"),
      events.join("\n") + "\n",
      "utf8"
    );
  }
  return runDir;
}

function runScript(
  input: string,
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 15000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("maybe-reflect.ts — heuristic gate", () => {
  let tmpDir: string;
  const stopPayload = fs
    .readFileSync(path.join(FIXTURES, "stop.json"), "utf8")
    .toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-reflect-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("gate PASSES — specialist + file edit + no error", () => {
    it("emits reflect marker to stdout", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      // Must emit a line telling orchestrator to invoke guild:reflect
      expect(stdout).toMatch(/reflect/i);
      expect(stdout).toMatch(/test-run/);
    });

    it("exits 0", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });
  });

  describe("gate FAILS — no specialist event", () => {
    it("no-ops silently (no reflect marker) when no specialist dispatched", () => {
      // Only a file edit, no specialist
      makeRunDir(tmpDir, "test-run", [FILE_EDIT_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — no file edit", () => {
    it("no-ops silently when no Write/Edit tool used", () => {
      // Only specialist stop, no file edit
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — error event present", () => {
    it("no-ops silently when an ok:false event is in the log", () => {
      makeRunDir(tmpDir, "test-run", [
        SPECIALIST_EVENT,
        FILE_EDIT_EVENT,
        ERROR_EVENT,
      ]);
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("gate FAILS — no events.ndjson at all", () => {
    it("no-ops silently when events file is missing", () => {
      // Create run dir but no events file
      const runDir = path.join(tmpDir, ".guild", "runs", "test-run");
      fs.mkdirSync(runDir, { recursive: true });
      const { exitCode, stdout } = runScript(stopPayload, {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe("");
    });
  });

  describe("error resilience", () => {
    it("exits 0 even with invalid JSON on stdin", () => {
      makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
      const { exitCode } = runScript("not valid json", {
        GUILD_CWD: tmpDir,
        GUILD_RUN_ID: "test-run",
      });
      expect(exitCode).toBe(0);
    });
  });
});

// v1.3 — F12: maybe-reflect.ts widened to fire on dev-team SubagentStop
// when all three guards hold:
//   1. GUILD_ENABLE_DEVTEAM_REFLECT === "1"   (operator opt-in; default off)
//   2. ≥ 3 SubagentStop dispatches in events.ndjson   (threshold filter)
//   3. .guild/spec/<slug>.md exists                  (something to reflect against)
//
// Tests cover the three branches: gate-off, gate-on-below-threshold,
// gate-on-met-threshold-with-spec.
describe("maybe-reflect.ts — F12 dev-team SubagentStop branch", () => {
  let tmpDir: string;
  const subagentPayload = fs
    .readFileSync(path.join(FIXTURES, "subagent-stop.json"), "utf8")
    .toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-reflect-devteam-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper — build N specialist dispatch events for the threshold check.
  function nDispatchEvents(n: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      out.push(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "SubagentStop",
          tool: "",
          specialist: `agent-${i}`,
          payload_digest: `dig-${i}`,
          ok: true,
          ms: 1000,
        }),
      );
    }
    return out;
  }

  // Helper — seed a spec file at .guild/spec/<slug>.md.
  function seedSpec(cwd: string, slug: string): void {
    const specDir = path.join(cwd, ".guild", "spec");
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(
      path.join(specDir, `${slug}.md`),
      "# spec\n\ncontent\n",
      "utf8",
    );
  }

  it("gate OFF — env var unset → no reflect marker even with 3 dispatches + spec", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(3));
    seedSpec(tmpDir, "demo");
    const { exitCode, stdout, stderr } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      // Explicitly clear the env var so we exercise the default-off path.
      GUILD_ENABLE_DEVTEAM_REFLECT: "",
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toMatch(/GUILD_ENABLE_DEVTEAM_REFLECT/);
  });

  it("gate ON, below threshold — 2 dispatches → no reflect marker", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(2));
    seedSpec(tmpDir, "demo");
    const { exitCode, stdout, stderr } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      GUILD_ENABLE_DEVTEAM_REFLECT: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toMatch(/dispatch count 2 < 3/);
  });

  it("gate ON, met threshold, with spec — 3 dispatches + spec → reflect marker fires", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(3));
    seedSpec(tmpDir, "demo");
    const { exitCode, stdout } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      GUILD_ENABLE_DEVTEAM_REFLECT: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/GUILD_REFLECT/);
    expect(stdout).toMatch(/test-run/);
  });

  it("gate ON, met threshold, slug-explicit lookup honors GUILD_SPEC_SLUG", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(3));
    seedSpec(tmpDir, "v1.3.0-deferred-cleanup");
    const { exitCode, stdout } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      GUILD_ENABLE_DEVTEAM_REFLECT: "1",
      GUILD_SPEC_SLUG: "v1.3.0-deferred-cleanup",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/GUILD_REFLECT/);
  });

  it("gate ON, met threshold, GUILD_SPEC_SLUG points at missing spec → no reflect", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(3));
    seedSpec(tmpDir, "actual-spec");
    const { exitCode, stdout, stderr } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      GUILD_ENABLE_DEVTEAM_REFLECT: "1",
      GUILD_SPEC_SLUG: "nonexistent-spec",
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toMatch(/spec not found/);
  });

  it("gate ON, met threshold, no spec dir at all → no reflect", () => {
    makeRunDir(tmpDir, "test-run", nDispatchEvents(3));
    // No seedSpec call — .guild/spec/ does not exist.
    const { exitCode, stdout, stderr } = runScript(subagentPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
      GUILD_ENABLE_DEVTEAM_REFLECT: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("");
    expect(stderr).toMatch(/spec dir not found/);
  });
});

// ── Codex-skip discipline guard (FU-E) ──────────────────────────────────────
// The SessionStart banner promises: "three consecutive skips trigger a hard
// fail at the gate (maybe-reflect.ts checks the reflection trail)." These
// tests pin BOTH halves of the contract:
//   1. The counter actually counts reflections that record a codex-review skip,
//      across all three marker formats (frontmatter codex_review: SKIPPED,
//      legacy skill_improvement list, and the canonical body marker).
//   2. At >= 3 the guard escalates for real: writes the .guild sentinel AND
//      exits non-zero with a loud DISCIPLINE warning (Stop hooks can't fail a
//      past gate, so the sentinel + non-zero exit are the honest enforcement).
// The guard ONLY arms in self-build context (cwd has plugin/CLAUDE.md with the
// orientation banner) so it never fires on a consuming repo's normal session.
describe("maybe-reflect.ts — codex-skip discipline guard (FU-E)", () => {
  let tmpDir: string;
  const stopPayload = fs
    .readFileSync(path.join(FIXTURES, "stop.json"), "utf8")
    .toString();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-reflect-codex-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Mark tmpDir as a self-build root so the guard arms.
  function seedSelfBuild(cwd: string): void {
    const pluginDir = path.join(cwd, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "CLAUDE.md"),
      "# Guild — repo orientation\n\nself-build marker\n",
      "utf8",
    );
  }

  // Write a reflection file with a codex-skip marker in the given format.
  type MarkerStyle = "frontmatter" | "legacy-list" | "body-marker" | "none";
  function writeReflection(
    cwd: string,
    name: string,
    style: MarkerStyle,
  ): void {
    const dir = path.join(cwd, ".guild", "reflections");
    fs.mkdirSync(dir, { recursive: true });
    let body: string;
    switch (style) {
      case "frontmatter":
        body =
          "---\nschema_version: guild.reflection.v1\ncodex_review: SKIPPED\n---\n\n# reflection\n";
        break;
      case "legacy-list":
        body =
          "---\nschema_version: guild.reflection.v1\nproposals:\n  skill_improvement: [guild:codex-review, guild:execute-plan]\n---\n\n# reflection\n";
        break;
      case "body-marker":
        body =
          "---\nschema_version: guild.reflection.v1\n---\n\n# reflection\n\n<!-- codex_review: SKIPPED -->\nprose about the skip\n";
        break;
      case "none":
        body = "---\nschema_version: guild.reflection.v1\n---\n\n# reflection\n";
        break;
    }
    fs.writeFileSync(path.join(dir, name), body, "utf8");
  }

  it("does NOT arm outside self-build context (no plugin/CLAUDE.md)", () => {
    // 3 skip-marked reflections but no self-build marker → silent, exit 0.
    writeReflection(tmpDir, "r1.md", "frontmatter");
    writeReflection(tmpDir, "r2.md", "frontmatter");
    writeReflection(tmpDir, "r3.md", "frontmatter");
    makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
    });
    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/DISCIPLINE/);
    expect(
      fs.existsSync(path.join(tmpDir, ".guild", "codex-skip-streak.json")),
    ).toBe(false);
  });

  it("counts < 3 skip reflections → warns softly, exits 0, no sentinel", () => {
    seedSelfBuild(tmpDir);
    writeReflection(tmpDir, "r1.md", "frontmatter");
    writeReflection(tmpDir, "r2.md", "legacy-list");
    makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
    const { exitCode } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
    });
    expect(exitCode).toBe(0);
    expect(
      fs.existsSync(path.join(tmpDir, ".guild", "codex-skip-streak.json")),
    ).toBe(false);
  });

  it("counts 3 frontmatter codex_review: SKIPPED → escalates (sentinel + non-zero exit)", () => {
    seedSelfBuild(tmpDir);
    writeReflection(tmpDir, "r1.md", "frontmatter");
    writeReflection(tmpDir, "r2.md", "frontmatter");
    writeReflection(tmpDir, "r3.md", "frontmatter");
    makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/DISCIPLINE/);
    const sentinel = path.join(tmpDir, ".guild", "codex-skip-streak.json");
    expect(fs.existsSync(sentinel)).toBe(true);
    const data = JSON.parse(fs.readFileSync(sentinel, "utf8"));
    expect(data.streak).toBeGreaterThanOrEqual(3);
    expect(data.blocked).toBe(true);
  });

  it("counts mixed marker formats (frontmatter + legacy + body) toward the streak", () => {
    seedSelfBuild(tmpDir);
    writeReflection(tmpDir, "r1.md", "frontmatter");
    writeReflection(tmpDir, "r2.md", "legacy-list");
    writeReflection(tmpDir, "r3.md", "body-marker");
    makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/DISCIPLINE/);
    expect(
      fs.existsSync(path.join(tmpDir, ".guild", "codex-skip-streak.json")),
    ).toBe(true);
  });

  it("a non-skip reflection breaks the consecutive streak (newest first)", () => {
    seedSelfBuild(tmpDir);
    // Oldest 3 are skips; newest has no marker → streak resets to 0.
    // mtime ordering: write oldest first, newest last.
    writeReflection(tmpDir, "r1.md", "frontmatter");
    writeReflection(tmpDir, "r2.md", "frontmatter");
    writeReflection(tmpDir, "r3.md", "frontmatter");
    // Force r4 to be newest by touching after the others.
    writeReflection(tmpDir, "r4.md", "none");
    const r4 = path.join(tmpDir, ".guild", "reflections", "r4.md");
    const future = Date.now() / 1000 + 100;
    fs.utimesSync(r4, future, future);
    makeRunDir(tmpDir, "test-run", [SPECIALIST_EVENT, FILE_EDIT_EVENT]);
    const { exitCode, stderr } = runScript(stopPayload, {
      GUILD_CWD: tmpDir,
      GUILD_RUN_ID: "test-run",
    });
    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/DISCIPLINE/);
    expect(
      fs.existsSync(path.join(tmpDir, ".guild", "codex-skip-streak.json")),
    ).toBe(false);
  });
});
