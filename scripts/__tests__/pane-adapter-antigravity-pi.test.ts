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
  // G4b (host-reachability): buildAdapters() now ALSO constructs a generic
  // WrappedCliPaneAdapter for every dispatch_selectable "self"-bound CLI registry
  // row with no bespoke class — cursor/github-copilot/opencode/rovo-dev. This is
  // the fix, not a regression: those 4 hosts previously had NO adapter at all.
  it("buildAdapters serves claude/codex/antigravity-2/pi + the 4 generic wrapped-CLI hosts (no gemini)", () => {
    const a = buildAdapters();
    expect(Object.keys(a).sort()).toEqual([
      "antigravity-2",
      "claude",
      "codex",
      "cursor",
      "github-copilot",
      "opencode",
      "pi",
      "rovo-dev",
    ]);
    // gemini was discarded (no longer a HostKind) — cast to probe the discarded key.
    expect((a as Record<string, unknown>).gemini).toBeUndefined();
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
  it("exports GUILD_TASK_ASSIGNMENT in command + env when a specialist is set (cross-host channel)", () => {
    const s = spec({ specialist: "researcher", runId: "run-xyz" });
    const rel = ".guild/runs/run-xyz/tasks/researcher.json";
    expect(new AntigravityPaneAdapter().command(s)).toContain(rel);
    expect(new AntigravityPaneAdapter().env(s).GUILD_TASK_ASSIGNMENT).toBe(rel);
  });
  it("expectedOutputs: file-bus receipts + approvals, NO heartbeat", () => {
    expect(new AntigravityPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});

describe("PiPaneAdapter", () => {
  it("preflight gates on the binary only (pi is multi-provider, resolves its own auth)", () => {
    expect(new PiPaneAdapter({ run: runner({}) }).preflight().ok).toBe(false);   // missing binary
    expect(new PiPaneAdapter({ run: runner({ pi: OK }) }).preflight().ok).toBe(true); // binary present
  });
  it("command emits `pi -p` with the run env + keep-alive", () => {
    const cmd = new PiPaneAdapter().command(spec({ hostKind: "pi", prompt: "go", taskId: "t1" }));
    expect(cmd).toContain("pi -p go");
    expect(cmd).toContain("export GUILD_TASK_ID=t1");
    expect(cmd).toContain("exec $SHELL");
  });
  it("exports GUILD_TASK_ASSIGNMENT in command + env when a specialist is set (cross-host channel)", () => {
    const s = spec({ hostKind: "pi", specialist: "researcher", runId: "run-xyz" });
    const rel = ".guild/runs/run-xyz/tasks/researcher.json";
    expect(new PiPaneAdapter().command(s)).toContain(rel);
    expect(new PiPaneAdapter().env(s).GUILD_TASK_ASSIGNMENT).toBe(rel);
  });
  it("expectedOutputs excludes heartbeat (no Claude hooks)", () => {
    expect(new PiPaneAdapter().expectedOutputs()).toEqual(["handoff_receipt", "approval_request"]);
  });
});

// ── LIVE validation (gated) ───────────────────────────────────────────────────
// Runs the REAL agy/pi one-shot invocations the adapters construct. Gated on
// GUILD_ADAPTER_LIVE=1 (skips in normal CI). Validated 2026-06-14: agy 1.0.8 +
// pi 0.79.3 both returned the expected token from `<bin> -p '<prompt>'`.
//   GUILD_ADAPTER_LIVE=1 npx jest __tests__/pane-adapter-antigravity-pi.test.ts
import { execSync } from "child_process";
const LIVE = process.env["GUILD_ADAPTER_LIVE"] === "1";
(LIVE ? describe : describe.skip)("LIVE — real agy + pi one-shot invocations", () => {
  it("agy --version + `agy -p` round-trips", () => {
    expect(execSync("agy --version", { encoding: "utf8" })).toMatch(/\d+\.\d+/);
    const out = execSync(`agy -p 'reply with exactly: AGY_OK'`, { encoding: "utf8", timeout: 90000 });
    expect(out).toContain("AGY_OK");
  }, 100000);
  it("pi --version + `pi -p` round-trips", () => {
    expect(execSync("pi --version", { encoding: "utf8" })).toMatch(/\d+\.\d+/);
    const out = execSync(`pi -p 'reply with exactly: PI_OK'`, { encoding: "utf8", timeout: 90000 });
    expect(out).toContain("PI_OK");
  }, 100000);
});
