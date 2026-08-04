/**
 * scripts/__tests__/t7-h1-dispatch-approval.test.ts
 *
 * T7-H1 REGRESSION PIN — the approve-before-dispatch gate is REACHABLE from the
 * REAL dispatch path.
 *
 * The audit's finding: `dispatchGate` was correct (7/7 planted controls
 * refused) and NOTHING on the execution path called it. `agent-team-launcher`
 * took `--team <path>` and dispatched every specialist in that YAML — no
 * proposal loaded, no hash recomputed, no decision consulted. So an operator
 * approving a proposal, followed by ANY edit to `.guild/team/<slug>.build.yaml`
 * (add a specialist, drop a role), dispatched the edited roster.
 *
 * This suite drives the REAL launcher entry point (`npx tsx
 * scripts/agent-team-launcher.ts`, the same command guild:execute-plan runs) —
 * NOT a helper, NOT the gate function in isolation. The audit was explicit:
 * "verify against the compiled entry point, not a helper."
 *
 * ZERO PANES is proved two ways per tamper case:
 *   1. a STUB `tmux` on PATH records every invocation to a log file — the
 *      tampered launch must leave that log EMPTY (no new-session, no
 *      new-window, no split-window: not one pane);
 *   2. no `session.json` manifest is written.
 *
 * ANTI-VACUITY: the same fixture with an UNTAMPERED team file must launch —
 * otherwise "zero panes" would just mean "the launcher is broken".
 *
 * ── T7R-R1-B1 (round-2 rework) ──────────────────────────────────────────────
 * Round 1 only pinned the post-approval TAMPER branch, and every case ran with
 * `--dry-run` over a pre-approved trail. The DEFAULT path — no proposal, no
 * decision, no refs, non-dry — was never exercised, and it was fail-OPEN: the
 * launcher warned and dispatched an entirely unapproved team (the reviewer's
 * real-entry probe saw `new-session` + `split-window`). The `NO TRAIL AT ALL`
 * describe below is that probe, promoted to a permanent regression:
 *   - NON-DRY, so nothing is skipped by a preview short-circuit;
 *   - the COMPLETE tmux invocation log must be EMPTY, not merely free of
 *     pane-creating subcommands;
 *   - matched by a NON-DRY anti-vacuity control that must really dispatch.
 * The `--approval-override` describe pins the one escape hatch as explicit,
 * unreasoned-value-refusing, audited, and reported as a degradation.
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { composeProposal, writeProposal } from "../../src/modules/teams/workflows/team-proposal";
import { recordDecision, writeDecision } from "../../src/modules/teams/workflows/team-decision";
// §5/D6: the v2 task-cell channel is hard fail-closed without the run's minted
// binding, so the fixture mints one — otherwise the POSITIVE CONTROL would fail
// for a reason unrelated to approval and the anti-vacuity leg would be useless.
import { mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";

const SCRIPT = path.resolve(__dirname, "../agent-team-launcher.ts");
const RUN_ID = "run-t7h1-0001";
const SLUG = "t7h1";
const PHASE = "build";

/** The three approved worker lanes the launcher is expected to spawn. */
const APPROVED_WORKERS = ["backend", "frontend", "qa"];

interface LaunchResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Every argv the stub tmux was invoked with, one per line. */
  tmuxInvocations: string[];
}

function makeRecordingTmux(root: string): { binDir: string; logPath: string } {
  const binDir = path.join(root, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  const logPath = path.join(root, "tmux-invocations.log");
  fs.writeFileSync(
    path.join(binDir, "tmux"),
    [
      "#!/bin/sh",
      `echo "$@" >> ${JSON.stringify(logPath)}`,
      'case "$1" in',
      '  -V) echo "tmux 3.4 (recording stub)"; exit 0;;',
      // "no such session" — otherwise the launcher refuses to clobber and the
      // non-dry anti-vacuity leg never reaches pane creation.
      "  has-session) exit 1;;",
      "  list-windows) exit 0;;",
      '  display-message) echo "%1"; exit 0;;',
      "  *) exit 0;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { binDir, logPath };
}

function teamYaml(specialists: string[]): string {
  return [
    "backend: agent-team",
    `spec: ${SLUG}`,
    "specialists:",
    ...specialists.flatMap((name) => [`  - name: ${name}`, `    scope: lane ${name}`]),
    "",
  ].join("\n");
}

/**
 * A repo with: an approved 4-participant proposal (3 workers + 1 cross-host
 * reviewer, matching the shape team-compose produces) and its user approve
 * decision persisted under `.guild/runs/<run>/team-plan/`, plus the per-phase
 * team file realizing the approved WORKER set.
 */
function seedApprovedRepo(): { root: string; teamPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t7-h1-"));
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID), { recursive: true });
  mintRunBinding({ root, run_id: RUN_ID });

  const participants = [
    ...APPROVED_WORKERS.map((id) => ({
      participant_id: id,
      participation_kind: "worker",
      role_ref: id,
      necessity_rationale: `owns the ${id} lane`,
      owned_obligations: [`ob-${id}`],
      depends_on: [],
      tier: "mid",
      purpose: "implementation",
      capability_scope: null,
      backend: "team",
    })),
    {
      participant_id: "codex-reviewer",
      participation_kind: "reviewer_cross_host",
      role_ref: "codex-reviewer",
      necessity_rationale: "cross-family independence for the G-lane gate",
      owned_obligations: ["ob-review"],
      depends_on: ["backend"],
      tier: "powerful",
      purpose: "adversarial",
      capability_scope: null,
      backend: "team",
    },
  ];
  const proposal = composeProposal({
    run_id: RUN_ID,
    phase: PHASE,
    participants,
    obligations: participants.map((p) => ({
      obligation_id: p.owned_obligations[0],
      source: "plan_item",
      text: `work owned by ${p.participant_id}`,
      disposition: { owners: [p.participant_id] },
    })),
    excluded_roles: [{ role_ref: "mobile", why_unnecessary: "no mobile surface" }],
    backend_capacity_evidence: {
      backend: "team",
      verified_capacity: 3,
      method: "preflight probe",
      as_of: "2026-07-30T00:00:00Z",
    },
  } as never);
  writeProposal(root, proposal);
  writeDecision(
    root,
    recordDecision(proposal, {
      decision: "approve",
      decided_by: { kind: "operator", id: "miguel" },
      decision_channel: "terminal_prompt",
      decided_at: "2026-07-31T00:00:00Z",
    } as never),
  );

  const teamDir = path.join(root, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const teamPath = path.join(teamDir, `${SLUG}.${PHASE}.yaml`);
  fs.writeFileSync(teamPath, teamYaml(APPROVED_WORKERS), "utf8");
  return { root, teamPath };
}

/**
 * Drive the REAL launcher entry point. `opts.extraArgs` replaces nothing — it is
 * appended, so a case can drop `--dry-run` (`opts.dryRun: false`) or add the
 * override flag. `opts.env` merges over the scrubbed base env.
 */
function launchWith(
  root: string,
  teamPath: string,
  opts: {
    dryRun?: boolean;
    runId?: string | null;
    extraArgs?: string[];
    env?: Record<string, string>;
  } = {},
): LaunchResult {
  const { binDir, logPath } = makeRecordingTmux(root);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.TMUX; // new-session mode; do not inherit the developer's tmux
  delete env.GUILD_RUN_ID;
  delete env.GUILD_RUN_BINDING_REF;
  // A stray ambient override in the developer's shell would silently defeat the
  // whole suite — scrub it, and let a case set it back explicitly.
  delete env.GUILD_DISPATCH_APPROVAL_OVERRIDE;
  env.PATH = `${binDir}:${env.PATH ?? ""}`;
  env.GUILD_HOST_ID = "claude-code-cli";
  for (const [k, v] of Object.entries(opts.env ?? {})) env[k] = v;

  const runId = opts.runId === undefined ? RUN_ID : opts.runId;
  const argv = ["tsx", SCRIPT, "--team", teamPath, "--cwd", root];
  if (runId !== null) argv.push("--run-id", runId);
  if (opts.dryRun !== false) argv.push("--dry-run");
  argv.push(...(opts.extraArgs ?? []));

  const res = spawnSync("npx", argv, { encoding: "utf8", env, timeout: 120_000 });
  let invocations: string[] = [];
  try {
    invocations = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  } catch {
    invocations = [];
  }
  return {
    exitCode: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    tmuxInvocations: invocations,
  };
}

/** The round-1 shape: dry-run, approved fixture, caller-supplied run id. */
function launch(root: string, teamPath: string): LaunchResult {
  return launchWith(root, teamPath);
}

/** tmux subcommands that CREATE a pane. Zero of these ⇒ zero panes. */
const PANE_CREATING = ["new-session", "new-window", "split-window"];

function paneCreatingInvocations(result: LaunchResult): string[] {
  return result.tmuxInvocations.filter((line) =>
    PANE_CREATING.some((sub) => line.split(/\s+/).includes(sub)),
  );
}

function sessionManifests(root: string): string[] {
  const dir = path.join(root, ".guild", "runs", RUN_ID, "agent-team");
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
}

describe("T7-H1 — the REAL launcher blocks on a post-approval-tampered team file", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  function seed(): { root: string; teamPath: string } {
    const s = seedApprovedRepo();
    roots.push(s.root);
    return s;
  }

  // ── ANTI-VACUITY ──────────────────────────────────────────────────────────
  it("POSITIVE CONTROL: the UNTAMPERED approved team launches and the gate reports PASSED", () => {
    const { root, teamPath } = seed();
    const run = launch(root, teamPath);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("approve-before-dispatch gate PASSED");
    // The gate bound to a real persisted approve, not a default-allow.
    expect(run.stdout).toMatch(/\[decision [0-9a-f]{12}…\]/);
    expect(run.stdout).not.toContain("REFUSED");
  });

  // ── THE FINDING ───────────────────────────────────────────────────────────
  it("TAMPER (add a specialist after approval) ⇒ exit 1 and ZERO panes", () => {
    const { root, teamPath } = seed();
    // The exact attack: someone (or a lane pane) appends a specialist to the
    // approved team file. The proposal bytes are untouched, so the proposal
    // hash still matches its decision — only the ROSTER ABOUT TO DISPATCH
    // diverged. This is precisely what nothing checked before.
    fs.writeFileSync(teamPath, teamYaml([...APPROVED_WORKERS, "smuggled-agent"]), "utf8");

    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("REFUSED (approve-before-dispatch gate");
    expect(run.stderr).toContain("participant_set_mismatch");
    expect(run.stderr).toContain("smuggled-agent");
    // ZERO PANES — proved by the recording tmux stub, not by reading logs.
    expect(paneCreatingInvocations(run)).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });

  it("TAMPER (silently remove an approved worker) ⇒ exit 1 and ZERO panes", () => {
    const { root, teamPath } = seed();
    fs.writeFileSync(teamPath, teamYaml(APPROVED_WORKERS.slice(0, 2)), "utf8");

    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("participant_set_mismatch");
    // "omission is never removal" — the dropped role is named.
    expect(run.stderr).toContain(APPROVED_WORKERS[2]);
    expect(paneCreatingInvocations(run)).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });

  it("TAMPER (mutate the approved PROPOSAL after approval) ⇒ exit 1 and ZERO panes", () => {
    const { root, teamPath } = seed();
    // Edit the persisted proposal so its recomputed §1 hash no longer equals
    // the approved hash — the staleness case dispatchGate exists for.
    const trail = path.join(root, ".guild", "runs", RUN_ID, "team-plan");
    const proposalFile = fs
      .readdirSync(trail)
      .find((n) => n.includes(".proposal.")) as string;
    const p = path.join(trail, proposalFile);
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("tier: mid", "tier: powerful"), "utf8");

    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("REFUSED (approve-before-dispatch gate");
    expect(paneCreatingInvocations(run)).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });

  it("NO decision at all ⇒ exit 1 and ZERO panes (Guild never auto-approves)", () => {
    const { root, teamPath } = seed();
    const trail = path.join(root, ".guild", "runs", RUN_ID, "team-plan");
    for (const n of fs.readdirSync(trail)) {
      if (n.includes(".decision.")) fs.rmSync(path.join(trail, n));
    }

    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("no_persisted_decision");
    expect(paneCreatingInvocations(run)).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });

  it("a TAMPERED decision artifact ⇒ exit 1 and ZERO panes (the whole trail fails closed)", () => {
    const { root, teamPath } = seed();
    const trail = path.join(root, ".guild", "runs", RUN_ID, "team-plan");
    const decisionFile = fs
      .readdirSync(trail)
      .find((n) => n.includes(".decision.")) as string;
    const p = path.join(trail, decisionFile);
    // Break the self-referential decision_hash — validateDecision recomputes it.
    fs.writeFileSync(
      p,
      fs.readFileSync(p, "utf8").replace(/decision_hash: [0-9a-f]{64}/, `decision_hash: ${"0".repeat(64)}`),
      "utf8",
    );

    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("invalid_decision_artifact");
    expect(paneCreatingInvocations(run)).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });
});

// ── T7R-R1-B1: THE DEFAULT PATH ────────────────────────────────────────────

/** Frozen record kind written to the override audit log. */
const OVERRIDE_KIND = "guild.dispatch_approval_override.v1";

/** A repo with a team file and NOTHING else — no proposal, no decision, no refs. */
function seedUnapprovedRepo(): { root: string; teamPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t7-h1-noapproval-"));
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID), { recursive: true });
  mintRunBinding({ root, run_id: RUN_ID });
  const teamDir = path.join(root, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const teamPath = path.join(teamDir, `${SLUG}.${PHASE}.yaml`);
  fs.writeFileSync(teamPath, teamYaml(APPROVED_WORKERS), "utf8");
  return { root, teamPath };
}

function overrideAuditRecords(root: string, runId: string | null): Record<string, unknown>[] {
  const p =
    runId === null
      ? path.join(root, ".guild", "artifacts", "audits", "dispatch-approval-overrides.jsonl")
      : path.join(root, ".guild", "runs", runId, "dispatch-approval-overrides.jsonl");
  try {
    return fs
      .readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  } catch {
    return [];
  }
}

describe("T7R-R1-B1 — NO TRAIL AT ALL: the default path fails CLOSED (non-dry, real entry)", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });
  function seedNone(): { root: string; teamPath: string } {
    const s = seedUnapprovedRepo();
    roots.push(s.root);
    return s;
  }
  function seedOk(): { root: string; teamPath: string } {
    const s = seedApprovedRepo();
    roots.push(s.root);
    return s;
  }

  it("THE REVIEWER'S PROBE: no proposal and no decision ⇒ exit non-zero, EMPTY tmux log", () => {
    const { root, teamPath } = seedNone();
    // Exactly the reviewer's invocation: the real launcher, NOT dry-run, on a
    // run with no proposal/decision trail. Round 1 exited 0 here and dispatched.
    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("REFUSED (approve-before-dispatch gate");
    expect(run.stderr).toContain("no_persisted_proposal");
    // The COMPLETE invocation log is empty — not merely free of pane-creating
    // subcommands. The stub tmux was never reached at all.
    expect(run.tmuxInvocations).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
    // And the "warn and continue" wording of the round-1 fail-open is gone.
    expect(run.stderr).not.toContain("NOT approval-verified — no approval signal");
  });

  it("standalone / NO --run-id ⇒ exit non-zero, EMPTY tmux log (nothing to verify ⇒ refuse)", () => {
    const { root, teamPath } = seedNone();
    const run = launchWith(root, teamPath, { dryRun: false, runId: null });

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("no_run_id");
    expect(run.tmuxInvocations).toEqual([]);
    expect(sessionManifests(root)).toEqual([]);
  });

  it("a dispatch-PLAN emission (--agent-mode=agent) is gated too, with no trail", () => {
    const { root, teamPath } = seedNone();
    const run = launchWith(root, teamPath, {
      dryRun: false,
      extraArgs: ["--agent-mode=agent"],
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("no_persisted_proposal");
    // No dispatch plan reached stdout either.
    expect(run.stdout).not.toContain("dispatchPlan");
    expect(run.tmuxInvocations).toEqual([]);
  });

  it("ANTI-VACUITY (non-dry): the APPROVED fixture really does dispatch panes", () => {
    // Without this leg, "empty tmux log" would only prove the launcher is broken.
    const { root, teamPath } = seedOk();
    const run = launchWith(root, teamPath, { dryRun: false });

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("approve-before-dispatch gate PASSED");
    expect(paneCreatingInvocations(run).length).toBeGreaterThan(0);
  });
});

describe("T7R-R1-B1 — the ONLY escape is an explicit, audited operator override", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });
  function seedNone(): { root: string; teamPath: string } {
    const s = seedUnapprovedRepo();
    roots.push(s.root);
    return s;
  }

  it("a BOOLEAN-shaped override value is NOT a reason ⇒ still refused, ZERO panes", () => {
    const { root, teamPath } = seedNone();
    const run = launchWith(root, teamPath, {
      dryRun: false,
      extraArgs: ["--approval-override", "1"],
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("dispatch_approval_override_unreasoned");
    expect(run.tmuxInvocations).toEqual([]);
    expect(overrideAuditRecords(root, RUN_ID)).toEqual([]);
  });

  it("an ENV override with a boolean value is refused the same way (no silent default)", () => {
    const { root, teamPath } = seedNone();
    const run = launchWith(root, teamPath, {
      dryRun: false,
      env: { GUILD_DISPATCH_APPROVAL_OVERRIDE: "true" },
    });
    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("dispatch_approval_override_unreasoned");
    expect(run.tmuxInvocations).toEqual([]);
  });

  it("a REASONED override dispatches, but is reported as a DEGRADATION and audited", () => {
    const { root, teamPath } = seedNone();
    const reason = "migrating a pre-approval team file; approved out-of-band";
    const run = launchWith(root, teamPath, {
      dryRun: false,
      extraArgs: ["--approval-override", reason],
    });

    expect(run.exitCode).toBe(0);
    // Never reported as a pass.
    expect(run.stdout).not.toContain("approve-before-dispatch gate PASSED");
    expect(run.stderr).toContain("DEGRADATION");
    expect(run.stderr).toContain("no_persisted_proposal");
    expect(run.stderr).toContain(reason);

    // The audit record is durable, names the refusal it overrode, and is
    // written BEFORE the panes — a bypass is never unrecorded.
    const records = overrideAuditRecords(root, RUN_ID);
    expect(records).toHaveLength(1);
    expect(records[0].schema_version).toBe(OVERRIDE_KIND);
    expect(records[0]).toMatchObject({
      run_id: RUN_ID,
      refusal: "no_persisted_proposal",
      override_reason: reason,
      degradation: true,
    });
    expect(records[0].scheduled_participants).toEqual([...APPROVED_WORKERS].sort());
  });

  it("the override is NOT a default: the same repo with no flag and no env still refuses", () => {
    const { root, teamPath } = seedNone();
    const run = launchWith(root, teamPath, { dryRun: false });
    expect(run.exitCode).not.toBe(0);
    expect(run.tmuxInvocations).toEqual([]);
  });
});
