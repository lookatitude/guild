/**
 * scripts/__tests__/pane-adapter-antigravity-pi.test.ts
 *
 * Antigravity (`agy`) + Pi PaneAdapters (deferred item 26 — host adapters beyond
 * Claude+Codex, Rung-1 tmux CLI panes). Gemini was discarded 2026-06-14 (sunset
 * in favour of Antigravity). Command construction + preflight are unit-tested via
 * the injected RunFn; LIVE validation + exact prompt-flag confirmation are the
 * documented residual (agy/pi were not locatable on the test host).
 */

import {
  buildAdapters,
  resolveAdapter,
  AntigravityPaneAdapter,
  PiPaneAdapter,
} from "../lib/pane-adapter";
import { buildPrompt, type PaneSpec, type RunFn, type RunResult } from "../lib/team-backend";

const OK: RunResult = { status: 0, stdout: "ok", stderr: "" };
const FAIL: RunResult = { status: 127, stdout: "", stderr: "not found" };
const runner = (map: Record<string, RunResult>): RunFn => (cmd) => map[cmd] ?? FAIL;

function spec(overrides: Partial<PaneSpec> = {}): PaneSpec {
  return {
    name: "researcher", scope: "x", runId: "run-001", slug: "demo",
    prompt: buildPrompt("demo", "run-001", { name: "researcher", scope: "x", dependsOn: [] }),
    hostKind: "antigravity-2", ...overrides,
  };
}

describe("registry — antigravity-2 + pi registered, gemini discarded", () => {
  it("buildAdapters serves claude/codex/antigravity-2/pi (no gemini)", () => {
    const a = buildAdapters();
    expect(Object.keys(a).sort()).toEqual(["antigravity-2", "claude", "codex", "pi"]);
    expect(a.gemini).toBeUndefined();
  });
  it("resolveAdapter returns the right hostKind", () => {
    expect(resolveAdapter()("antigravity-2").hostKind).toBe("antigravity-2");
    expect(resolveAdapter()("pi").hostKind).toBe("pi");
  });
});

describe("AntigravityPaneAdapter (agy)", () => {
  it("preflight fails when `agy` is missing", () => {
    expect(new AntigravityPaneAdapter({ run: runner({}) }).preflight().ok).toBe(false);
  });
  it("preflight ok when `agy --version` succeeds", () => {
    expect(new AntigravityPaneAdapter({ run: runner({ agy: OK }) }).preflight().ok).toBe(true);
  });
  it("command invokes `agy`, exports GUILD_RUN_ID, keeps the pane alive, no Claude team gate", () => {
    const cmd = new AntigravityPaneAdapter().command(spec({ prompt: "do x" }));
    expect(cmd).toMatch(/\bagy\b/);
    expect(cmd).toContain("'do x'"); // prompt shell-quoted (has a space)
    expect(cmd).toContain("export GUILD_RUN_ID=run-001");
    expect(cmd).toContain("exec $SHELL");
    expect(cmd).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
  });
  it("expectedOutputs: file-bus receipts + approvals, NO heartbeat", () => {
    expect(new AntigravityPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});

describe("PiPaneAdapter", () => {
  it("preflight: missing binary → fail; binary ok + no key → fail; + key → ok", () => {
    expect(new PiPaneAdapter({ run: runner({}), env: {} }).preflight().ok).toBe(false);
    expect(new PiPaneAdapter({ run: runner({ pi: OK }), env: {} }).preflight().ok).toBe(false);
    expect(new PiPaneAdapter({ run: runner({ pi: OK }), env: { PI_API_KEY: "k" } }).preflight().ok).toBe(true);
  });
  it("command emits `pi -p` with the run env + keep-alive", () => {
    const cmd = new PiPaneAdapter().command(spec({ hostKind: "pi", prompt: "go", taskId: "t1" }));
    expect(cmd).toContain("pi -p go");
    expect(cmd).toContain("export GUILD_TASK_ID=t1");
    expect(cmd).toContain("exec $SHELL");
  });
  it("expectedOutputs excludes heartbeat (no MCP, no Claude hooks)", () => {
    expect(new PiPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});
