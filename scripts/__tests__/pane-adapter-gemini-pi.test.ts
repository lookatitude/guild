/**
 * scripts/__tests__/pane-adapter-gemini-pi.test.ts
 *
 * Gemini + Pi PaneAdapters (deferred item 26 — host adapters beyond Claude+Codex,
 * Rung-1 tmux CLI panes). Command construction + preflight unit-tested via the
 * injected RunFn (live validation against the real CLIs is the documented
 * residual, same posture as Codex was). docs/v2/07 + host-adapter-contract.md.
 */

import {
  buildAdapters,
  resolveAdapter,
  GeminiPaneAdapter,
  PiPaneAdapter,
  type FsSeam,
} from "../lib/pane-adapter";
import { buildPrompt, type PaneSpec, type RunFn, type RunResult } from "../lib/team-backend";

const OK: RunResult = { status: 0, stdout: "ok", stderr: "" };
const FAIL: RunResult = { status: 127, stdout: "", stderr: "not found" };
const runner = (map: Record<string, RunResult>): RunFn => (cmd) => map[cmd] ?? FAIL;
const NO_FS: FsSeam = { existsSync: () => false, statSync: () => { throw new Error("ENOENT"); } };
const FS_PRESENT: FsSeam = { existsSync: () => true, statSync: () => ({ size: 42 }) };

function spec(overrides: Partial<PaneSpec> = {}): PaneSpec {
  return {
    name: "researcher", scope: "x", runId: "run-001", slug: "demo",
    prompt: buildPrompt("demo", "run-001", { name: "researcher", scope: "x", dependsOn: [] }),
    hostKind: "gemini", ...overrides,
  };
}

describe("registry — gemini + pi are registered", () => {
  it("buildAdapters exposes gemini + pi alongside claude + codex", () => {
    const a = buildAdapters();
    expect(Object.keys(a).sort()).toEqual(["claude", "codex", "gemini", "pi"]);
  });
  it("resolveAdapter returns the right hostKind", () => {
    expect(resolveAdapter()("gemini").hostKind).toBe("gemini");
    expect(resolveAdapter()("pi").hostKind).toBe("pi");
  });
});

describe("GeminiPaneAdapter", () => {
  it("preflight fails when the binary is missing", () => {
    const a = new GeminiPaneAdapter({ run: runner({}), env: {}, fs: NO_FS });
    expect(a.preflight().ok).toBe(false);
  });
  it("preflight fails when binary ok but no auth", () => {
    const a = new GeminiPaneAdapter({ run: runner({ gemini: OK }), env: {}, fs: NO_FS });
    const r = a.preflight();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/GEMINI_API_KEY/);
  });
  it("preflight ok with an API key, or with oauth creds", () => {
    expect(new GeminiPaneAdapter({ run: runner({ gemini: OK }), env: { GEMINI_API_KEY: "k" }, fs: NO_FS }).preflight().ok).toBe(true);
    expect(new GeminiPaneAdapter({ run: runner({ gemini: OK }), env: {}, fs: FS_PRESENT }).preflight().ok).toBe(true);
  });
  it("command emits `gemini -p`, exports GUILD_RUN_ID, keeps the pane alive, no Claude team gate", () => {
    const cmd = new GeminiPaneAdapter().command(spec({ prompt: "do x" }));
    expect(cmd).toContain("gemini -p 'do x'"); // space → shellQuote wraps
    expect(cmd).toContain("export GUILD_RUN_ID=run-001"); // safe string → unquoted
    expect(cmd).toContain("exec $SHELL");
    expect(cmd).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
  });
  it("expectedOutputs: file-bus receipts + approvals, NO heartbeat (no Claude hooks)", () => {
    expect(new GeminiPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});

describe("PiPaneAdapter", () => {
  it("preflight fails on missing binary, then on missing key, then ok with key", () => {
    expect(new PiPaneAdapter({ run: runner({}), env: {} }).preflight().ok).toBe(false);
    expect(new PiPaneAdapter({ run: runner({ pi: OK }), env: {} }).preflight().ok).toBe(false);
    expect(new PiPaneAdapter({ run: runner({ pi: OK }), env: { PI_API_KEY: "k" } }).preflight().ok).toBe(true);
  });
  it("command emits `pi -p` with the run env + keep-alive", () => {
    const cmd = new PiPaneAdapter().command(spec({ hostKind: "pi", prompt: "go", taskId: "t1" }));
    expect(cmd).toContain("pi -p go"); // "go" is a safe string → unquoted by shellQuote
    expect(cmd).toContain("export GUILD_TASK_ID=t1");
    expect(cmd).toContain("exec $SHELL");
  });
  it("expectedOutputs excludes heartbeat (no MCP, no Claude hooks)", () => {
    expect(new PiPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});
