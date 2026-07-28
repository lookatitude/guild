/**
 * hooks/__tests__/gate-outcome-writer.test.ts
 *
 * G5(b) — run.yaml `gates:` writer (v23x-deferred-followups rf-wi-05, origin
 * oir-wi-58). Exercises the REAL hook path (spawns gate-outcome-writer.ts via
 * tsx over stdin, exactly as Claude Code's PostToolUse Write|Edit matcher
 * drives it) against a real run.yaml + review.md/verify.md fixture.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { parseGateOutcome } from "../gate-outcome-writer";

const SCRIPT = path.resolve(__dirname, "../gate-outcome-writer.ts");
const RUN = "test-run";

let tmp: string;

function runHook(payload: object, env: Record<string, string> = {}): { stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN, ...env },
    timeout: 20000,
  });
  return { stderr: result.stderr ?? "" };
}

function runDir(): string {
  return path.join(tmp, ".guild", "runs", RUN);
}

function writeRunYaml(): void {
  const raw = [
    "schema_version: guild.run.v1",
    `run_id: ${RUN}`,
    "initiative_attachment: null",
    "phase: build",
    "gates: {}",
    "status: open",
    "phases_log: []",
    "",
  ].join("\n");
  fs.mkdirSync(runDir(), { recursive: true });
  fs.writeFileSync(path.join(runDir(), "run.yaml"), raw, "utf8");
}

function readRunYaml(): string {
  return fs.readFileSync(path.join(runDir(), "run.yaml"), "utf8");
}

function writeArtifact(basename: string, content: string): string {
  const p = path.join(runDir(), basename);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

describe("parseGateOutcome (pure parser)", () => {
  it("verify-done: reads the explicit Overall status line", () => {
    expect(parseGateOutcome("verify-done", "## Overall status\npass\n")).toBe("pass");
    expect(parseGateOutcome("verify-done", "**Overall status** — fail\n")).toBe("fail");
  });

  it("verify-done: falls back to the ✓/✗ glyph when no Overall status line exists", () => {
    expect(parseGateOutcome("verify-done", "check 1: ✓\ncheck 2: ✗\n")).toBe("fail");
    expect(parseGateOutcome("verify-done", "check 1: ✓\ncheck 2: ✓\n")).toBe("pass");
  });

  it("review: a ✗ anywhere means fail, no ✗ with a ✓ present means pass", () => {
    expect(parseGateOutcome("review", "lane a: ✓ pass\nlane b: ✗ fail\n")).toBe("fail");
    expect(parseGateOutcome("review", "lane a: ✓ pass\nlane b: ✓ pass\n")).toBe("pass");
  });

  it("returns null (ambiguous) when neither signal is present", () => {
    expect(parseGateOutcome("review", "no glyphs here, just prose.\n")).toBeNull();
  });
});

describe("gate-outcome-writer.ts — G5(b) real hook path", () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-gow-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    writeRunYaml();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("records `verify-done: pass` when verify.md's Overall status is pass", () => {
    const abs = writeArtifact("verify.md", "## Overall status\npass\n");
    runHook({ tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp });
    const raw = readRunYaml();
    expect(raw).not.toContain("gates: {}");
    expect(raw).toMatch(/verify-done:\s*\n\s*posture: auto\s*\n\s*outcome: pass/);
  });

  it("records `review: fail` when review.md carries a ✗", () => {
    const abs = writeArtifact("review.md", "lane a: ✓ pass\nlane b: ✗ fail (missing evidence)\n");
    runHook({ tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp });
    const raw = readRunYaml();
    expect(raw).toMatch(/review:\s*\n\s*posture: auto\s*\n\s*outcome: fail/);
  });

  it("writes NOTHING when the report is ambiguous (no false pass)", () => {
    const abs = writeArtifact("verify.md", "This run looks fine, ship it.\n");
    runHook({ tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp });
    const raw = readRunYaml();
    expect(raw).toContain("gates: {}"); // untouched
  });

  it("ignores a Write to an unrelated file", () => {
    const abs = writeArtifact("notes.md", "Overall status: pass\n");
    runHook({ tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp });
    const raw = readRunYaml();
    expect(raw).toContain("gates: {}");
  });

  it("ignores a same-named report belonging to a DIFFERENT run dir", () => {
    const otherRun = "other-run";
    const otherDir = path.join(tmp, ".guild", "runs", otherRun);
    fs.mkdirSync(otherDir, { recursive: true });
    const abs = path.join(otherDir, "verify.md");
    fs.writeFileSync(abs, "## Overall status\npass\n", "utf8");
    // GUILD_RUN_ID still names the ORIGINAL run — the write is in a different dir.
    runHook({ tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp });
    const raw = readRunYaml(); // the ORIGINAL run's run.yaml
    expect(raw).toContain("gates: {}");
  });

  it("never throws / never blocks on a missing run id (silent fall-through)", () => {
    const abs = writeArtifact("verify.md", "## Overall status\npass\n");
    const { stderr } = runHook(
      { tool_name: "Write", tool_input: { file_path: abs }, cwd: tmp },
      { GUILD_RUN_ID: "" },
    );
    // No crash; stderr may be empty (no sentinel either) — the key assertion
    // is run.yaml stays untouched.
    expect(stderr).not.toMatch(/fatal/i);
    const raw = readRunYaml();
    expect(raw).toContain("gates: {}");
  });
});
