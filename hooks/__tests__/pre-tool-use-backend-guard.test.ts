/**
 * hooks/__tests__/pre-tool-use-backend-guard.test.ts
 *
 * #56 — the PreToolUse backend-degradation detector on the REAL hook path (runs
 * pre-tool-use.ts via tsx over stdin, exactly as Claude Code drives it, against
 * a real run directory with a real resolved-settings.json and the REAL tmux
 * probe — a stub `tmux` binary on PATH decides availability, so the probe code
 * itself is exercised rather than mocked away).
 *
 *   [x] team + tmux + composed specialist lane            → DENY + receipt
 *   [x] team + tmux + hand-rolled brief (no env carriers) → RECORDED, never blocked
 *                                                          (prompt-only evidence)
 *   [x] team + cmux only (no tmux)                        → DENY  (cmux is rung 0 of team)
 *   [x] team + tmux + GUILD_ALLOW_BACKEND_DEGRADE=1       → ALLOW + receipt (auditable)
 *   [x] auto + tmux (ladder resolves auto→team)           → DENY + receipt
 *   [x] team + NO substrate                               → ALLOW + receipt, never blocked
 *   [x] a #58 persona-strip deny still leaves the #56 receipt
 *   [x] team + tmux + learn-lane generic fan-out          → PASS, no receipt
 *   [x] team + tmux + pane-local helper (lane env set)    → PASS, no receipt
 *   [x] team + tmux + STALE run (dead sentinel)           → PASS, no receipt
 *   [x] a stale run survives the FULL PreToolUse→PostToolUse→Stop hook lifecycle
 *   [x] a quoted canonical block in an audit prompt        → PASS, no receipt
 *   [x] a prompt quoting a live ADOPTION prefix           → RECORDED, never blocked
 *   [x] a long-running sentinel run with a live lane heartbeat → still gated
 *   [x] agent_mode=subagent (+ tmux)                      → PASS, no receipt
 *   [x] no resolved-settings snapshot                     → PASS, no receipt
 *   [x] non-Agent tool call inside a team run             → PASS, no receipt
 *   [x] non-Guild Agent call (no run id)                  → PASS, no receipt
 *   [x] the receipt never lands in the validated v1.4 channel
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const RUN = "test-run";

let tmp: string;

function runHook(
  payload: object,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN, ...env },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Put a stub `tmux` first on PATH; `ok` decides whether `tmux -V` exits 0. */
function stubTmux(ok: boolean): Record<string, string> {
  const bin = path.join(tmp, ok ? "bin-tmux-ok" : "bin-tmux-missing");
  fs.mkdirSync(bin, { recursive: true });
  const file = path.join(bin, "tmux");
  fs.writeFileSync(file, ok ? '#!/bin/sh\necho "tmux 3.4"\n' : "#!/bin/sh\nexit 1\n", "utf8");
  fs.chmodSync(file, 0o755);
  // CMUX_WORKSPACE_ID is the OTHER team substrate — blank it unless a test sets
  // it, so a developer running these tests inside cmux gets the same result.
  return { PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}`, CMUX_WORKSPACE_ID: "" };
}

/** Drive another hook script over stdin, the same way Claude Code does. */
function runOtherHook(rel: string, payload: object, env: Record<string, string>): void {
  spawnSync("npx", ["tsx", path.resolve(__dirname, rel)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN, ...env },
    timeout: 20000,
  });
}

/** Blank the lane-process env so the hook is treated as the run LEAD. */
const AS_LEAD = { GUILD_LANE_ID: "", GUILD_TASK_ID: "", GUILD_SPECIALIST: "" };

function writeSnapshot(agentMode: string): void {
  fs.writeFileSync(
    path.join(tmp, ".guild", "runs", RUN, "resolved-settings.json"),
    JSON.stringify({
      schema_version: "guild.resolved_settings.v1",
      effective: { agent_mode: agentMode },
    }),
    "utf8",
  );
}

/** The `current-run-id` sentinel — the path `resolveRunId` falls back to. */
function writeSentinel(): void {
  fs.writeFileSync(path.join(tmp, ".guild", "runs", "current-run-id"), RUN, "utf8");
}

/** Backdate every run-dir signal so the run reads as stale/abandoned. */
function makeRunStale(): void {
  const dir = path.join(tmp, ".guild", "runs", RUN);
  const old = (Date.now() - 24 * 60 * 60 * 1000) / 1000;
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else fs.utimesSync(p, old, old);
    }
  };
  walk(dir);
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Every `backend_degradation` receipt in the dedicated sink. */
function receipts(): Array<Record<string, unknown>> {
  return readJsonl(
    path.join(tmp, ".guild", "runs", RUN, "logs", "backend-degradation.jsonl"),
  );
}

function securityEvents(): Array<Record<string, unknown>> {
  return readJsonl(
    path.join(tmp, ".guild", "runs", RUN, "logs", "security-events.jsonl"),
  ).filter((e) => e["event_type"] === "backend_degradation");
}

const ADOPTION_PROMPT =
  "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
  "You are the `devops` teammate for run-id `test-run`. Your role definition is at " +
  "`.guild/agents/devops.md` — read it FIRST and adopt it fully (persona, boundaries).";

/** Contract-correct project-specialist dispatch (passes the #58 guard cleanly). */
const composedLane = () => ({
  tool_name: "Agent",
  tool_input: {
    subagent_type: "general-purpose",
    prompt: ADOPTION_PROMPT,
    env: {
      GUILD_RUN_ID: RUN,
      GUILD_SPECIALIST: "devops",
      GUILD_TASK_ID: "wi-1",
      GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
    },
  },
});

/**
 * A composed lane whose descriptor env does NOT name the run — required to
 * exercise the sentinel-provenance path, since a dispatch that DOES name the run
 * is trusted identity in its own right (`dispatchAssertsRunId`).
 */
const composedLaneNoRunEnv = () => ({
  tool_name: "Agent",
  tool_input: {
    subagent_type: "general-purpose",
    prompt: ADOPTION_PROMPT,
    env: {
      GUILD_SPECIALIST: "devops",
      GUILD_TASK_ID: "wi-1",
      GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
    },
  },
});

/** The forensic drift shape: hand-rolled brief, zero GUILD_* env carriers. */
const handRolledLane = () => ({
  tool_name: "Agent",
  tool_input: {
    subagent_type: "general-purpose",
    prompt:
      "Implement the gate scripts for wi-30.\n\n---\n" +
      "HANDOFF PROTOCOL (mandatory — single channel, strict fenced-JSON)\n\n" +
      "Your final action is writing your handoff receipt to the receipt file.\n" +
      "Receipt path (absolute): /repo/.guild/runs/test-run/handoffs/devops-wi-30.md\n---",
  },
});

describe("pre-tool-use.ts — #56 backend-degradation detector", () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-backend-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // ── DENY ──────────────────────────────────────────────────────────────────

  it("DENIES a team-mode lane dispatched through the in-session Agent tool", () => {
    writeSnapshot("team");
    const { exitCode, stdout } = runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(exitCode).toBe(0);
    const decision = JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string };
    };
    expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
    const reason = decision.hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain("#56");
    expect(reason).toContain("agent-team-launcher.ts");
    expect(reason).toContain("GUILD_ALLOW_BACKEND_DEGRADE");
  });

  it("writes a backend_degradation receipt to the run record on a DENY", () => {
    writeSnapshot("team");
    runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    const found = receipts();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      schema_version: "guild.backend_degradation.v1",
      event: "backend_degradation",
      tool: "Agent",
      run_id: RUN,
      decision: "deny",
      reason: "team_substrate_available",
      snapshot_agent_mode: "team",
      effective_backend: "team",
      substrate: "tmux",
      attempted_subagent_type: "general-purpose",
      specialist: "devops",
      ok: false,
    });
    expect(typeof found[0]!["span_id"]).toBe("string");
  });

  it("never contaminates the validated v1.4 trace channel", () => {
    writeSnapshot("team");
    runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    const canonical = readJsonl(
      path.join(tmp, ".guild", "runs", RUN, "logs", "v1.4-events.jsonl"),
    );
    expect(canonical.filter((e) => e["event"] === "backend_degradation")).toHaveLength(0);
  });

  it("records a guild.security_event.v1 audit twin on a DENY", () => {
    writeSnapshot("team");
    runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    const evs = securityEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ decision: "deny", tool: "Agent", run_id: RUN });
  });

  it("RECORDS but never blocks the hand-rolled shape (prompt-only evidence)", () => {
    // Text alone cannot separate a hand-rolled brief from a prompt quoting a
    // live one, so this tier is observable but not blockable.
    writeSnapshot("team");
    const { stdout } = runHook(handRolledLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "allow_recorded",
      reason: "team_substrate_available",
      lane_evidence: "prompt_only",
    });
  });

  it("DENIES when cmux is the only team substrate (tmux absent)", () => {
    writeSnapshot("team");
    const { stdout } = runHook(composedLane(), {
      ...stubTmux(false),
      ...AS_LEAD,
      CMUX_WORKSPACE_ID: "ws-1",
    });
    expect(stdout).toContain('"permissionDecision":"deny"');
    expect(receipts()[0]).toMatchObject({ substrate: "cmux" });
  });

  it("DENIES agent_mode=auto with a substrate — the D5 ladder resolves auto→team", () => {
    writeSnapshot("auto");
    const { stdout } = runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(stdout).toContain('"permissionDecision":"deny"');
    expect(receipts()[0]).toMatchObject({
      decision: "deny",
      reason: "auto_resolves_to_team",
      snapshot_agent_mode: "auto",
      effective_backend: "team",
      substrate: "tmux",
    });
  });

  it("still writes the #56 receipt when the #58 persona-strip guard owns the deny", () => {
    writeSnapshot("team");
    // Same lane, but GUILD_AGENT_DEFINITION stripped → #58 denies first.
    const stripped = {
      tool_name: "Agent",
      tool_input: {
        subagent_type: "general-purpose",
        prompt: ADOPTION_PROMPT,
        env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "wi-1" },
      },
    };
    const { stdout } = runHook(stripped, { ...stubTmux(true), ...AS_LEAD });
    // #58 owns the message...
    expect(stdout).toContain('"permissionDecision":"deny"');
    expect(stdout).toContain("#58");
    // ...but the backend degradation is still on the record.
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0]).toMatchObject({ decision: "deny", reason: "team_substrate_available" });
  });

  // ── ALLOW + RECORD (never blocked) ────────────────────────────────────────

  it("ALLOWS with GUILD_ALLOW_BACKEND_DEGRADE=1 — and still records the receipt", () => {
    writeSnapshot("team");
    const { exitCode, stdout, stderr } = runHook(composedLane(), {
      ...stubTmux(true),
      ...AS_LEAD,
      GUILD_ALLOW_BACKEND_DEGRADE: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(stderr).toContain("OVERRIDDEN");
    const found = receipts();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      decision: "allow_override",
      reason: "team_substrate_available",
      override_env: "GUILD_ALLOW_BACKEND_DEGRADE",
      ok: false,
    });
    expect(securityEvents()[0]).toMatchObject({ decision: "allow" });
  });

  it("RECORDS but never blocks team mode when NO team substrate exists", () => {
    writeSnapshot("team");
    const { stdout } = runHook(composedLane(), { ...stubTmux(false), ...AS_LEAD });
    expect(stdout).not.toContain("permissionDecision");
    const r = receipts()[0]!;
    expect(r).toMatchObject({
      decision: "allow_recorded",
      reason: "team_substrate_unavailable",
      substrate: "none",
    });
    // The durable detail must not claim a substrate was available.
    expect(String(r["detail"])).not.toContain("IS available");
  });

  // ── Negative cases: every one of these must pass through UNTOUCHED ────────

  it("PASSES a learn-lane generic fan-out in team mode", () => {
    writeSnapshot("team");
    const { exitCode, stdout } = runHook(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "Analyze this batch of files and return knowledge-graph nodes.",
        },
      },
      { ...stubTmux(true), ...AS_LEAD },
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES a helper spawned from inside a lane (pane-local, not the lead)", () => {
    writeSnapshot("team");
    const { stdout } = runHook(composedLane(), {
      ...stubTmux(true),
      GUILD_LANE_ID: "lane-7",
    });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("anti-vacuity: the current-run-id sentinel path DOES gate a fresh run", () => {
    writeSnapshot("team");
    writeSentinel();
    const { stdout } = runHook(composedLaneNoRunEnv(), {
      ...stubTmux(true),
      ...AS_LEAD,
      GUILD_RUN_ID: "", // resolve through the sentinel, not the env
    });
    expect(stdout).toContain('"permissionDecision":"deny"');
  });

  it("PASSES when the current-run-id sentinel names a STALE (long-closed) run", () => {
    // closeRun does NOT clear the sentinel, so a dead run keeps naming itself.
    writeSnapshot("team");
    writeSentinel();
    makeRunStale();
    const { stdout } = runHook(composedLaneNoRunEnv(), {
      ...stubTmux(true),
      ...AS_LEAD,
      GUILD_RUN_ID: "",
    });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("a STALE sentinel run survives the FULL hook lifecycle without resurrecting", () => {
    // Regression for the indirect feedback loop: an unrelated tool call in a new
    // session runs PreToolUse (writes logs/tool-call-pre.jsonl) → PostToolUse
    // (writes logs/v1.4-events.jsonl + events.ndjson) → Stop (run-trace-close
    // REWRITES run.yaml for whatever run the sentinel names). None of those may
    // make the next lane dispatch gate against the dead run.
    writeSnapshot("team");
    writeSentinel();
    makeRunStale();
    const sentinelEnv = { ...stubTmux(true), ...AS_LEAD, GUILD_RUN_ID: "" };
    const read = { tool_name: "Read", tool_input: { file_path: "/repo/README.md" } };

    runHook(read, sentinelEnv);
    runOtherHook("../capture-telemetry.ts", { ...read, hook_event_name: "PostToolUse" }, sentinelEnv);
    runOtherHook("../post-tool-use.ts", { ...read, hook_event_name: "PostToolUse" }, sentinelEnv);
    runOtherHook("../run-trace-close.ts", { hook_event_name: "Stop" }, sentinelEnv);

    // Prove the lifecycle really did touch the run dir (anti-vacuity).
    const runDir = path.join(tmp, ".guild", "runs", RUN);
    const touched = ["run.yaml", "logs", "events.ndjson"].some((f) =>
      fs.existsSync(path.join(runDir, f)),
    );
    expect(touched).toBe(true);

    const { stdout } = runHook(composedLaneNoRunEnv(), sentinelEnv);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("an explicit GUILD_RUN_ID is trusted regardless of run-dir mtime", () => {
    // Session-bound identity: a genuinely active run's first dispatch after a
    // long quiet period must still be gated.
    writeSnapshot("team");
    makeRunStale();
    const { stdout } = runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(stdout).toContain('"permissionDecision":"deny"');
  });

  it("DENIES agent_mode=auto inside a tmux session even when `tmux -V` fails", () => {
    // The launcher's auto rung 1 is "$TMUX set → team in-session", checked
    // BEFORE probeTmuxAvailable — the detector must mirror it.
    writeSnapshot("auto");
    const { stdout } = runHook(composedLane(), {
      ...stubTmux(false),
      ...AS_LEAD,
      TMUX: "/tmp/tmux-501/default,1,0",
    });
    expect(stdout).toContain('"permissionDecision":"deny"');
    expect(receipts()[0]).toMatchObject({ substrate: "tmux", reason: "auto_resolves_to_team" });
  });

  it("explicit team does NOT treat $TMUX as substrate — the launcher probes", () => {
    writeSnapshot("team");
    const { stdout } = runHook(composedLane(), {
      ...stubTmux(false),
      ...AS_LEAD,
      TMUX: "/tmp/tmux-501/default,1,0",
    });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({ reason: "team_substrate_unavailable" });
  });

  it("PASSES agent_mode=auto with NO substrate — the ladder resolves to subagent", () => {
    writeSnapshot("auto");
    const { stdout } = runHook(composedLane(), { ...stubTmux(false), ...AS_LEAD, TMUX: "" });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("RECORDS but never blocks an audit prompt quoting a live ADOPTION prefix", () => {
    // #58's attribution reads the adoption marker/anchor out of the PROMPT, so a
    // quoting prompt looks like a lane. It must never be blockable on that alone.
    writeSnapshot("team");
    const { stdout } = runHook(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "Explore",
          prompt:
            "Audit this brief captured from the live run; do NOT execute it:\n\n" +
            ADOPTION_PROMPT,
        },
      },
      { ...stubTmux(true), ...AS_LEAD },
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({ lane_evidence: "prompt_only" });
  });

  it("gates a long-running sentinel run kept live by a lane heartbeat", () => {
    // /guild:build resolves through the sentinel without exporting GUILD_RUN_ID
    // into the lead; a run older than the grace window must still gate while a
    // lane is demonstrably alive.
    writeSnapshot("team");
    writeSentinel();
    makeRunStale();
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN, "in-progress"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".guild", "runs", RUN, "in-progress", "devops.json"),
      "{}",
      "utf8",
    );
    const { stdout } = runHook(composedLaneNoRunEnv(), {
      ...stubTmux(true),
      ...AS_LEAD,
      GUILD_RUN_ID: "",
    });
    expect(stdout).toContain('"permissionDecision":"deny"');
  });

  it("PASSES an audit prompt that QUOTES the whole canonical handoff block", () => {
    writeSnapshot("team");
    const { stdout } = runHook(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "Explore",
          prompt:
            "Audit whether our briefs still preserve this quoted fixture verbatim:\n\n---\n" +
            "HANDOFF PROTOCOL (mandatory — single channel, strict fenced-JSON)\n\n" +
            "Your final action is writing your handoff receipt to the receipt file.\n" +
            "Receipt path (absolute): <RECEIPT_PATH>\n---\n\nReport yes/no only.",
        },
      },
      { ...stubTmux(true), ...AS_LEAD },
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES when the resolved agent_mode is not team/auto", () => {
    writeSnapshot("subagent");
    const { stdout } = runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES when the run has no resolved-settings snapshot", () => {
    const { stdout } = runHook(composedLane(), { ...stubTmux(true), ...AS_LEAD });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES a non-Agent tool call inside a team run", () => {
    writeSnapshot("team");
    const { stdout } = runHook(
      { tool_name: "Read", tool_input: { file_path: "/repo/README.md" } },
      { ...stubTmux(true), ...AS_LEAD },
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES a non-Guild Agent call (no resolvable run id)", () => {
    writeSnapshot("team");
    const { stdout } = runHook(composedLaneNoRunEnv(), {
      ...stubTmux(true),
      ...AS_LEAD,
      GUILD_RUN_ID: "",
    });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });
});
