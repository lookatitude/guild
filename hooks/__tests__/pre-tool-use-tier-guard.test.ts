/**
 * hooks/__tests__/pre-tool-use-tier-guard.test.ts
 *
 * #60 — the PreToolUse tier-scoring guard on the REAL hook path (runs
 * pre-tool-use.ts via tsx over stdin, exactly as Claude Code drives it, against
 * a real run directory and a real `.guild/settings.json`, so the settings-backed
 * tier map is exercised rather than mocked away).
 *
 *   [x] composed lane, NO model param                     → DENY + receipt
 *   [x] composed lane WITH a model param                  → PASS + receipt (the
 *                                                           resurrected SKILL.md:113 line)
 *   [x] GUILD_ALLOW_UNTIERED_DISPATCH=1                   → ALLOW + receipt flagged
 *   [x] GUILD_TIER=mid dispatched at the powerful model   → RECORDED, not denied
 *                                                          (hook is not the authoritative map)
 *   [x] GUILD_TIER=mid dispatched at the mid model        → PASS, tier+score recorded
 *   [x] a project that REMAPS models.tiers               → the remap wins (no false deny)
 *   [x] declared tier + an unrecognized model            → RECORDED, never blocked
 *   [x] hand-rolled brief (prompt-only evidence)         → RECORDED, never blocked
 *   [x] a helper dispatched from INSIDE a lane           → still gated (unlike #56)
 *   [x] a #58 persona-strip deny still leaves the #60 receipt
 *   [x] learn-lane generic fan-out                       → PASS, no receipt
 *   [x] non-Agent tool call                              → PASS, no receipt
 *   [x] non-Guild Agent call (no run id)                 → PASS, no receipt
 *   [x] STALE current-run-id sentinel                    → PASS, no receipt
 *   [x] anti-vacuity: a FRESH sentinel run DOES gate
 *   [x] anti-vacuity: the sink is never empty on a compliant dispatch
 *   [x] the receipt never lands in the validated v1.4 channel
 *   [x] a compliant dispatch writes NO security-event twin
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
    env: {
      ...process.env,
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      // The #56 backend guard shares this hook; blank the team-substrate signal
      // so a developer running these tests inside cmux/tmux gets the same result.
      CMUX_WORKSPACE_ID: "",
      TMUX: "",
      GUILD_ALLOW_UNTIERED_DISPATCH: "",
      ...env,
    },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Blank the lane-process env so the hook is treated as the run LEAD. */
const AS_LEAD = { GUILD_LANE_ID: "", GUILD_TASK_ID: "", GUILD_SPECIALIST: "" };

/**
 * A resolved-settings snapshot whose agent_mode is `subagent` — the row where
 * `Agent` dispatch IS the designed path, so the #56 backend detector never fires
 * and every assertion below is unambiguously about #60. It doubles as the
 * lead-independent freshness signal `isRunFresh` looks for.
 */
function writeSnapshot(agentMode = "subagent"): void {
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

/** Every `tier_dispatch` receipt in the dedicated sink. */
function receipts(): Array<Record<string, unknown>> {
  return readJsonl(path.join(tmp, ".guild", "runs", RUN, "logs", "tier-dispatch.jsonl"));
}

function securityEvents(): Array<Record<string, unknown>> {
  return readJsonl(
    path.join(tmp, ".guild", "runs", RUN, "logs", "security-events.jsonl"),
  ).filter((e) => e["event_type"] === "tier_dispatch_untiered");
}

const ADOPTION_PROMPT =
  "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
  "You are the `devops` teammate for run-id `test-run`. Your role definition is at " +
  "`.guild/agents/devops.md` — read it FIRST and adopt it fully (persona, boundaries).";

const LANE_ENV: Record<string, string> = {
  GUILD_RUN_ID: RUN,
  GUILD_SPECIALIST: "devops",
  GUILD_TASK_ID: "wi-1",
  GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
};

/**
 * A contract-correct project-specialist dispatch (passes the #58 guard cleanly),
 * parameterized by the tiering fields under test.
 */
function composedLane(
  opts: { model?: string; tier?: string; score?: string } = {},
): object {
  const env: Record<string, string> = { ...LANE_ENV };
  if (opts.tier !== undefined) env["GUILD_TIER"] = opts.tier;
  if (opts.score !== undefined) env["GUILD_TIER_SCORE"] = opts.score;
  const ti: Record<string, unknown> = {
    subagent_type: "general-purpose",
    prompt: ADOPTION_PROMPT,
    env,
  };
  if (opts.model !== undefined) ti["model"] = opts.model;
  return { tool_name: "Agent", tool_input: ti };
}

/**
 * A contract-correct lane whose env does NOT name the run — required to exercise
 * the sentinel-provenance path, since a dispatch that DOES name the run is
 * trusted identity in its own right (`dispatchAssertsRunId`) and skips the
 * freshness test. Carries the full #58 contract so only #60 can gate it.
 */
function composedLaneNoRunEnv(opts: { model?: string } = {}): object {
  const env: Record<string, string> = {
    GUILD_SPECIALIST: "devops",
    GUILD_TASK_ID: "wi-1",
    GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
  };
  const ti: Record<string, unknown> = {
    subagent_type: "general-purpose",
    prompt: ADOPTION_PROMPT,
    env,
  };
  if (opts.model !== undefined) ti["model"] = opts.model;
  return { tool_name: "Agent", tool_input: ti };
}

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

function decisionOf(stdout: string): string | undefined {
  if (!stdout.includes("permissionDecision")) return undefined;
  return (
    JSON.parse(stdout) as { hookSpecificOutput: { permissionDecision: string } }
  ).hookSpecificOutput.permissionDecision;
}

function reasonOf(stdout: string): string {
  return (
    JSON.parse(stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }
  ).hookSpecificOutput.permissionDecisionReason;
}

describe("pre-tool-use.ts — #60 tier-scoring guard", () => {
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-tier-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
    writeSnapshot();
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // ── DENY: the missing model param ─────────────────────────────────────────

  it("DENIES a Guild lane dispatched with NO explicit model param", () => {
    const { exitCode, stdout } = runHook(composedLane(), AS_LEAD);
    expect(exitCode).toBe(0);
    expect(decisionOf(stdout)).toBe("deny");
    const reason = reasonOf(stdout);
    expect(reason).toContain("#60");
    // The contract, the ladder, the deterministic remedy, and the audited door.
    expect(reason).toContain("cheap=haiku");
    expect(reason).toContain("powerful=opus");
    expect(reason).toContain("score-tier.ts");
    expect(reason).toContain("GUILD_ALLOW_UNTIERED_DISPATCH");
  });

  it("writes a tier_dispatch receipt carrying the SKILL.md:113 dispatch line", () => {
    runHook(composedLane(), AS_LEAD);
    const found = receipts();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      schema_version: "guild.tier_dispatch.v1",
      event: "tier_dispatch",
      tool: "Agent",
      run_id: RUN,
      decision: "deny",
      reason: "missing_model",
      model: "MISSING",
      task_id: "wi-1",
      specialist: "devops",
      lane_evidence: "structured",
      subagent_type: "general-purpose",
      ok: false,
    });
    expect(found[0]!["dispatch_line"]).toBe("lane wi-1 · score - · tier - · model MISSING");
    expect(typeof found[0]!["span_id"]).toBe("string");
  });

  it("records a guild.security_event.v1 audit twin on a DENY", () => {
    runHook(composedLane(), AS_LEAD);
    expect(securityEvents()).toHaveLength(1);
    expect(securityEvents()[0]).toMatchObject({ decision: "deny", tool: "Agent", run_id: RUN });
  });

  it("never contaminates the validated v1.4 trace channel", () => {
    runHook(composedLane(), AS_LEAD);
    const canonical = readJsonl(
      path.join(tmp, ".guild", "runs", RUN, "logs", "v1.4-events.jsonl"),
    );
    expect(canonical.filter((e) => e["event"] === "tier_dispatch")).toHaveLength(0);
  });

  // ── PASS: the compliant dispatch is recorded, not gated ───────────────────

  it("PASSES a lane dispatched WITH a model param — and still records the line", () => {
    const { exitCode, stdout } = runHook(composedLane({ model: "sonnet" }), AS_LEAD);
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    const found = receipts();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      decision: "pass",
      reason: "model_present", // model present, but no GUILD_TIER to verify scoring
      model: "sonnet",
      dispatched_tier: "mid",
      ok: true,
    });
  });

  it("writes NO security-event twin for a compliant dispatch", () => {
    runHook(composedLane({ model: "haiku" }), AS_LEAD);
    expect(receipts()).toHaveLength(1); // anti-vacuity: the sink DID receive it
    expect(securityEvents()).toHaveLength(0);
  });

  it("records the declared tier + score when execute-plan carries them", () => {
    const { stdout } = runHook(
      composedLane({ model: "sonnet", tier: "mid", score: "2" }),
      AS_LEAD,
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "pass",
      reason: "scored_compliant", // model matches the declared tier's model
      tier: "mid",
      score: 2,
      model: "sonnet",
      expected_model: "sonnet",
      dispatch_line: "lane wi-1 · score 2 · tier mid · model sonnet",
    });
  });

  it("matches a fully-qualified model id against the tier map's short alias", () => {
    const { stdout } = runHook(
      composedLane({ model: "claude-sonnet-5", tier: "mid" }),
      AS_LEAD,
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({ decision: "pass", reason: "scored_compliant" });
  });

  it("does NOT collapse two distinct qualified versions of the same family", () => {
    // A version pin must not be defeated: claude-sonnet-4-5 ≠ claude-sonnet-5.
    // With no config, mid=sonnet (bare alias) — the dispatched qualified id is
    // unknown to the map, so this is tier_unverifiable, never a false pass/deny.
    const { stdout } = runHook(
      composedLane({ model: "claude-sonnet-4-5", tier: "mid" }),
      AS_LEAD,
    );
    expect(stdout).not.toContain("permissionDecision");
    // sonnet (bare) ↔ claude-sonnet-4-5 IS an alias match → scored_compliant.
    expect(receipts()[0]).toMatchObject({ decision: "pass", reason: "scored_compliant" });
  });

  // ── Tier/model mismatch is RECORDED, never denied (finding #1) ────────────

  it("RECORDS but never denies a tier/model mismatch (reader is not the authoritative map)", () => {
    const { stdout } = runHook(composedLane({ model: "opus", tier: "mid" }), AS_LEAD);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "allow_recorded",
      reason: "tier_model_mismatch",
      tier: "mid",
      model: "opus",
      dispatched_tier: "powerful",
      expected_model: "sonnet",
    });
  });

  it("honors a project that REMAPS models.tiers — the remap makes it scored_compliant", () => {
    // The check reads the run's project-local tier map, so a project that maps
    // mid→opus records a compliant dispatch for opus at tier mid.
    fs.writeFileSync(
      path.join(tmp, ".guild", "settings.json"),
      JSON.stringify({ models: { tiers: { mid: { "claude-code-cli": "opus" } } } }),
      "utf8",
    );
    const { stdout } = runHook(composedLane({ model: "opus", tier: "mid" }), AS_LEAD);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "pass",
      reason: "scored_compliant",
      expected_model: "opus",
    });
  });

  it("RECORDS but never blocks a declared tier it cannot verify", () => {
    // An unmapped/custom model is not evidence of a violation — the `model`
    // param IS present, so the contract's primary invariant holds.
    const { stdout } = runHook(
      composedLane({ model: "some-local-llm", tier: "cheap" }),
      AS_LEAD,
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "allow_recorded",
      reason: "tier_unverifiable",
      model: "some-local-llm",
    });
  });

  // ── The audited override ──────────────────────────────────────────────────

  it("ALLOWS with GUILD_ALLOW_UNTIERED_DISPATCH=1 — and still records the receipt", () => {
    const { exitCode, stdout, stderr } = runHook(composedLane(), {
      ...AS_LEAD,
      GUILD_ALLOW_UNTIERED_DISPATCH: "1",
    });
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(stderr).toContain("OVERRIDDEN");
    expect(receipts()[0]).toMatchObject({
      decision: "allow_override",
      reason: "missing_model",
      override_env: "GUILD_ALLOW_UNTIERED_DISPATCH",
      model: "MISSING",
      ok: false,
    });
    expect(securityEvents()[0]).toMatchObject({ decision: "allow" });
  });

  it("leaves the guard ARMED for a non-affirmative override value", () => {
    const { stdout } = runHook(composedLane(), {
      ...AS_LEAD,
      GUILD_ALLOW_UNTIERED_DISPATCH: "0",
    });
    expect(decisionOf(stdout)).toBe("deny");
  });

  // ── Evidence tiering: prompt text can record, never block ─────────────────

  it("RECORDS but never blocks the hand-rolled shape (prompt-only evidence)", () => {
    const { stdout } = runHook(handRolledLane(), AS_LEAD);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()[0]).toMatchObject({
      decision: "allow_recorded",
      reason: "missing_model",
      lane_evidence: "prompt_only",
      task_id: "",
    });
  });

  // ── Interaction with the sibling guards ───────────────────────────────────

  it("still writes the #60 receipt when the #58 persona-strip guard owns the deny", () => {
    const stripped = {
      tool_name: "Agent",
      tool_input: {
        subagent_type: "general-purpose",
        prompt: ADOPTION_PROMPT,
        env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "wi-1" },
      },
    };
    const { stdout } = runHook(stripped, AS_LEAD);
    expect(stdout).toContain("#58"); // #58 owns the message...
    expect(receipts()).toHaveLength(1); // ...but the tier line is still recorded.
    expect(receipts()[0]).toMatchObject({ decision: "deny", reason: "missing_model" });
  });

  it("gates a helper dispatched from INSIDE a lane (unlike the #56 lead-only rule)", () => {
    // The tier contract binds the DISPATCH, not the dispatcher: a helper with no
    // model param inherits its parent lane's model just as silently.
    const { stdout } = runHook(composedLane(), { GUILD_LANE_ID: "lane-7" });
    expect(decisionOf(stdout)).toBe("deny");
    expect(receipts()[0]).toMatchObject({ decision: "deny", lane_id: "lane-7" });
  });

  // ── Negative cases: every one of these must pass through UNTOUCHED ────────

  it("PASSES a learn-lane generic fan-out (no lane evidence at all)", () => {
    const { exitCode, stdout } = runHook(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "Analyze this batch of files and return knowledge-graph nodes.",
        },
      },
      AS_LEAD,
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES a non-Agent tool call inside an active run", () => {
    const { stdout } = runHook(
      { tool_name: "Read", tool_input: { file_path: "/repo/README.md" } },
      AS_LEAD,
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("PASSES a non-Guild Agent call (no resolvable run id)", () => {
    const { stdout } = runHook(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: ADOPTION_PROMPT,
          env: { GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "wi-1" },
        },
      },
      { ...AS_LEAD, GUILD_RUN_ID: "" },
    );
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });

  it("anti-vacuity: the current-run-id sentinel path DOES gate a fresh run", () => {
    writeSentinel();
    const { stdout } = runHook(composedLaneNoRunEnv(), { ...AS_LEAD, GUILD_RUN_ID: "" });
    expect(decisionOf(stdout)).toBe("deny");
    expect(receipts()[0]).toMatchObject({ decision: "deny", reason: "missing_model" });
  });

  it("PASSES when the current-run-id sentinel names a STALE (long-closed) run", () => {
    // closeRun does NOT clear the sentinel, so a dead run keeps naming itself.
    writeSentinel();
    makeRunStale();
    const { stdout } = runHook(composedLaneNoRunEnv(), { ...AS_LEAD, GUILD_RUN_ID: "" });
    expect(stdout).not.toContain("permissionDecision");
    expect(receipts()).toHaveLength(0);
  });
});
