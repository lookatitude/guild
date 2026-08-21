/**
 * tests/integration/dispatch-model-realpath.test.ts — lane T6, rework round 3
 * (run-20260730-131020-dynamic-host-model-routing). Suite for T6-R1-F5 /
 * T6-R2-F5.
 *
 * REAL-PATH proof that the M1/M2 model-routing integration is WIRED into the
 * production dispatch, not isolated test scaffolding. Every assertion below
 * drives the PRODUCTION ENTRYPOINT (scripts/agent-team-launcher.ts, spawned as
 * a real process exactly as guild:execute-plan spawns it) — team.yaml +
 * settings.json in, backend spec + artifacts out. No module seam is injected:
 *
 *   1. shadow on → the run tree carries the shadow receipt + content-hashed
 *      comparison for EVERY task cell, written through the binding-verified
 *      writer (binding.json minted in the same tree).
 *   2. flags at ADR defaults → NO shadow artifacts and no v2 selection —
 *      byte-identical legacy behavior at M0.
 *   3. T6-R2-F5 — CONSUMPTION: with `enabled: on` over a bound run tree
 *      carrying verified M0+M1 evidence, the selected model reaches THE REAL
 *      BACKEND SPEC: the tmux pane the launcher would spawn is
 *      `claude --model <selected>` and the in-process rung's dispatch
 *      descriptor carries `model: <selected>` (it was `null` before). The
 *      flag-off control over the SAME tree + SAME evidence spawns the legacy
 *      command with no `--model` and no `GUILD_MODEL` at all.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  deriveResolveInputsFromM0Evidence,
  planProductionDispatchModel,
} from "../../src/modules/dispatch/workflows/task-assignment-v2";
import { persistInspectionReport } from "../../src/modules/capability/workflows/inspection-persist";
import {
  buildModelInspection,
  MODEL_INSPECTION_SCHEMA,
} from "../../src/modules/capability/workflows/model-inspect";
import {
  loadVerifiedM0Reports,
  ROUTING_FLAG_DEFAULTS,
} from "../../src/modules/capability/workflows/routing-rollout";
// T8R/F3: the run-identity artifacts a real run owns (frozen session context +
// content-addressed catalog cache entry) are seeded through the SAME key
// builder production reads with — a hand-picked filename would prove nothing.
import {
  createCacheKey,
  MODEL_CATALOG_SCHEMA_VERSION,
  modelCatalogCacheDir,
} from "../../src/modules/capability/workflows/catalog-cache";
import { loadRunBinding, mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";
import { selfReferentialHash } from "../../src/modules/teams/workflows/canonical-hash";
import { recordDecision, writeDecision } from "../../src/modules/teams/workflows/team-decision";
import { composeProposal, writeProposal } from "../../src/modules/teams/workflows/team-proposal";

const SESSION_CONTEXT_SCHEMA = "guild.session_context.v1";

const SCRIPT = path.resolve(__dirname, "../../scripts/agent-team-launcher.ts");
const TEAM_FIXTURE = path.resolve(__dirname, "../../scripts/fixtures/team-agent-team.yaml");

const CATALOG_MODELS = [
  {
    canonical_id: "powerful-model-1",
    model_family: "acme",
    tier: "powerful",
    catalog_index: 0,
    evidence: { state: "available" },
  },
  {
    canonical_id: "legacy-model-9",
    model_family: "oldco",
    tier: "powerful",
    catalog_index: 1,
    evidence: { state: "available" },
  },
];

function validPolicy(): Record<string, unknown> {
  return {
    version: 2,
    allow_advertised_attempt: false,
    purposes: {
      implementation: {
        min_effective_complexity: "hard",
        independence: "none",
        confirm_on_degradation: false,
        routes: [
          {
            complexity: "hard",
            preferred: [{ selector: "id:powerful-model-1" }],
            fallbacks: [{ selector: "id:legacy-model-9" }],
          },
        ],
      },
    },
  };
}

function makeLaunchableTmuxBin(root: string): string {
  const binDir = path.join(root, "fakebin-launchable");
  const logPath = path.join(root, ".fake-tmux.log");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "tmux"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  -V) echo "tmux 3.4 (fake)"; exit 0;;',
      "  has-session) exit 1;;",
      "  list-windows) exit 0;;",
      `  *) printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}; exit 0;;`,
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return binDir;
}

function assignmentFiles(root: string, runId: string): string[] {
  const taskCells = path.join(root, ".guild", "runs", runId, "task-cells");
  if (!fs.existsSync(taskCells)) return [];
  return (fs.readdirSync(taskCells, { recursive: true }) as string[])
    .filter((entry) => entry.endsWith("assignment.json"));
}

function fakeTmuxLog(root: string): string {
  const logPath = path.join(root, ".fake-tmux.log");
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
}

function runLauncher(
  cwd: string,
  extraArgs: string[] = [],
  opts: { dryRun?: boolean; approvalOverride?: boolean } = {}
): { exitCode: number; stdout: string; stderr: string } {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // A live Guild session's envelope or tmux state must not leak into the fixture.
  delete env.TMUX;
  delete env.GUILD_RUN_ID;
  delete env.GUILD_RUN_BINDING_REF;
  // T7R-R1-B1: approve-before-dispatch verification is MANDATORY on the real
  // launcher path. These fixtures are about M0/M1/M2 model selection, not
  // approval, and carry no team-plan trail — opt into the ONE audited escape
  // hatch with a stated reason. The gate's own pins live in
  // scripts/__tests__/t7-h1-dispatch-approval.test.ts.
  if (opts.approvalOverride !== false) {
    env.GUILD_DISPATCH_APPROVAL_OVERRIDE =
      "dispatch-model realpath fixture: no team-plan trail; approval verification is pinned separately";
  } else {
    delete env.GUILD_DISPATCH_APPROVAL_OVERRIDE;
  }
  if (opts.dryRun === false) {
    env.PATH = `${makeLaunchableTmuxBin(cwd)}:${env.PATH ?? ""}`;
  }
  const result = spawnSync(
    "npx",
    [
      "tsx",
      SCRIPT,
      "--team",
      path.join(cwd, ".guild", "team", "test-slug.yaml"),
      "--session-name",
      "guild-t6-realpath",
      "--cwd",
      cwd,
      // FIC-48/FU08: both paths resolve lane models, but only a real launch
      // records M0/M1 evidence and emits durable task cells. Tests that read a
      // dispatch-authorized in-process descriptor must therefore run that rung
      // non-dry (the
      // in-process port is declarative: it emits cells + a dispatchPlan
      // signal; it spawns no processes).
      ...(opts.dryRun === false ? [] : ["--dry-run"]),
      ...extraArgs,
    ],
    { encoding: "utf8", env, timeout: 120_000 }
  );
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * FIC-48 fixture reconciliation with the CANONICAL run-id contract.
 *
 * The production launcher is now a dispatch CONSUMER, never a run-starting
 * actor (`resolveLifecycleRunId`): it requires a canonical
 * `run-<yyyymmdd-hhmmss>-<slug>` id — from `--run-id` or the lifecycle's
 * `.guild/runs/current-run-id` sentinel — AND a pre-minted run binding, and it
 * refuses anything else. These fixtures therefore seed the run identity the
 * LIFECYCLE would own, through the SAME production binding writer, instead of
 * expecting the launcher to mint a fresh run. The contract itself is pinned by
 * the "run-identity contract" probes at the bottom of this file — the fixtures
 * adapt to the contract; they never soften it.
 */
function seedLifecycleRun(root: string, runId: string): string {
  const binding = mintRunBinding({ root, run_id: runId });
  const runsDir = path.join(root, ".guild", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  fs.writeFileSync(path.join(runsDir, "current-run-id"), `${runId}\n`, "utf8");
  return binding.binding_ref;
}

/**
 * A NON-dry cell emission fail-closes on a missing per-lane context bundle
 * (production contract: guild:context-assemble runs before dispatch). Seed the
 * minimal bundles the fixture team's three lanes require.
 */
function seedContextBundles(
  root: string,
  runId: string,
  lanes: string[] = ["architect", "backend", "qa"],
): void {
  const dir = path.join(root, ".guild", "context", runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const lane of lanes) {
    fs.writeFileSync(
      path.join(dir, `${lane}-${lane}.md`),
      `# ${lane} context bundle (fixture)\n\nScope: dispatch-model realpath fixture lane.\n`,
      "utf8"
    );
  }
}

/**
 * FU09: canonical/scoped roles cannot use direct Agent() until the host proves
 * child-env carriage. Preserve this suite's in-process model-routing proof on
 * the one production path that remains intentionally available: a hash-bound,
 * operator-approved unknown/project role with no resolved capability scope.
 */
function writeApprovedUnscopedCustomTeam(root: string, runId: string): void {
  fs.writeFileSync(
    path.join(root, ".guild", "team", "test-slug.yaml"),
    [
      "spec: .guild/spec/test-slug.md",
      "backend: agent-team",
      "specialists:",
      "  - name: custom-role",
      "    scope: approved project-specific model-routing proof",
      "    depends-on: []",
      "",
    ].join("\n"),
    "utf8",
  );

  const proposal = composeProposal({
    run_id: runId,
    phase: "build",
    participants: [
      {
        participant_id: "custom-role",
        participation_kind: "worker",
        role_ref: "custom-role",
        necessity_rationale: "approved project-specific model-routing proof",
        owned_obligations: ["ob-custom-role"],
        depends_on: [],
        tier: "powerful",
        purpose: "implementation",
        capability_scope: null,
        backend: "agent-team",
      },
    ],
    obligations: [
      {
        obligation_id: "ob-custom-role",
        source: "plan_item",
        text: "prove direct-host model routing on the retained unscoped seam",
        disposition: { owners: ["custom-role"] },
      },
    ],
    excluded_roles: [],
    backend_capacity_evidence: {
      backend: "agent-team",
      verified_capacity: 1,
      method: "integration fixture",
      as_of: "2026-08-20T00:00:00Z",
    },
  });
  writeProposal(root, proposal);
  writeDecision(
    root,
    recordDecision(proposal, {
      decision: "approve",
      decided_by: { kind: "operator", id: "miguel" },
      decision_channel: "terminal_prompt",
      decided_at: "2026-08-20T00:00:01Z",
    }),
  );
}

function setupConsumerRepo(tmp: string, settings: Record<string, unknown>): void {
  fs.mkdirSync(path.join(tmp, ".guild", "team"), { recursive: true });
  fs.copyFileSync(TEAM_FIXTURE, path.join(tmp, ".guild", "team", "test-slug.yaml"));
  fs.writeFileSync(
    path.join(tmp, ".guild", "settings.json"),
    JSON.stringify(settings, null, 2),
    "utf8"
  );
}

function findRunDirs(cwd: string): string[] {
  const runsDir = path.join(cwd, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir)
    .filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory())
    .map((d) => path.join(runsDir, d));
}

describe("REAL PATH (F5): production dispatch emits M1 shadow provenance", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-realpath-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("dispatch through the PRODUCTION entrypoint with shadow on → shadow receipt + hash-verified comparison per task cell, in the BOUND run tree", () => {
    const seededRunId = "run-20260730-140000-shadow-realpath";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on" },
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedLifecycleRun(tmp, seededRunId);
    seedContextBundles(tmp, seededRunId);
    const { exitCode, stdout, stderr } = runLauncher(tmp, [], { dryRun: false });
    expect([stderr, exitCode]).toEqual([stderr, 0]);

    const runDirs = findRunDirs(tmp);
    expect(runDirs).toHaveLength(1);
    const runDir = runDirs[0];
    const runId = path.basename(runDir);
    // The launcher dispatched into the LIFECYCLE's run (inherited via the
    // current-run-id sentinel) — it did not mint a second run of its own.
    expect(runId).toBe(seededRunId);

    // The run is BOUND: the lifecycle minted the binding (seeded above through
    // the production writer); the launcher verified it before any write.
    expect(loadRunBinding({ root: tmp, run_id: runId })).not.toBeNull();

    // Task cells were emitted on the production channel. The deterministic
    // tmux double executes no host process, but the real launcher persisted one
    // immutable assignment per lane before invoking that backend.
    expect(assignmentFiles(tmp, runId)).toHaveLength(3);
    // ...and EVERY cell carried an M1 shadow leg (the F5 wiring):
    expect(stdout.match(/M1 shadow comparison recorded/g)).toHaveLength(3);

    const shadowDir = path.join(runDir, "shadow");
    const receipts = fs.readdirSync(shadowDir).filter((f) => f.endsWith(".shadow-receipt.json"));
    const comparisons = fs
      .readdirSync(shadowDir)
      .filter((f) => f.endsWith(".shadow-comparison.json"));
    expect(receipts).toHaveLength(3); // one per specialist task cell
    expect(comparisons).toHaveLength(3);

    for (const f of comparisons) {
      const cmp = JSON.parse(fs.readFileSync(path.join(shadowDir, f), "utf8"));
      expect(cmp.schema_version).toBe("guild.shadow_comparison.v1");
      expect(cmp.run_id).toBe(runId);
      // The legacy selection came from the SAME models.tiers unpack the legacy
      // path uses (mid tier on the claude host):
      expect(cmp.legacy.model).toBe("legacy-model-9");
      expect(cmp.legacy.source).toBe("tier_map:mid");
      // No catalog/session inputs are threaded at the launcher yet, so the
      // shadow resolver fails CLOSED — recorded honestly, never invented:
      expect(cmp.comparable).toBe(false);
      expect(cmp.shadow.failed_closed).toBeTruthy();
      // The persisted comparison is content-hash-verified evidence:
      expect(selfReferentialHash(cmp, "comparison_hash")).toBe(cmp.comparison_hash);
    }

    // M0/M1 invariant: shadow changed NO routing — no v2 selection anywhere.
    expect(stdout).not.toMatch(/M2 v2 selection/);
  });

  test("CONTROL: ADR-default flags → NO shadow artifacts, no v2 selection (byte-identical legacy behavior)", () => {
    setupConsumerRepo(tmp, {
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const runId = "run-20260730-140000-legacy-control";
    seedLifecycleRun(tmp, runId);
    seedContextBundles(tmp, runId);
    const { exitCode, stdout } = runLauncher(tmp, [], { dryRun: false });
    expect(exitCode).toBe(0);
    const runDirs = findRunDirs(tmp);
    expect(runDirs).toHaveLength(1);
    expect(fs.existsSync(path.join(runDirs[0], "shadow"))).toBe(false);
    expect(stdout).not.toMatch(/M1 shadow comparison recorded/);
    expect(stdout).not.toMatch(/M2 v2 selection/);
    // The production channel still dispatched normally; the recorder was inert.
    expect(assignmentFiles(tmp, runId)).toHaveLength(3);
  });
});

describe("REAL PATH (F5): gated M2 selection through the production function", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-realpath-m2-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** Seed a bound run with verified M0+M1 evidence THROUGH the production writers. */
  function seedBoundEvidence(runId: string): string {
    const binding = mintRunBinding({ root: tmp, run_id: runId });
    const report = buildModelInspection({
      session_context: {
        schema_version: "guild.session_context.v1",
        run_id: runId,
        host: { family: "claude", surface: "cli" },
        identity: { source: "native_adapter", trust: "verified", confidence: "high", evidence: "seed" },
        execution_target: { target_id: "codex-cli-target", provider_kind: "unknown", auth_mode: "unknown" },
      },
      catalog_snapshot: { models: CATALOG_MODELS },
      policy: validPolicy(),
      receipt: null,
      flags: { ...ROUTING_FLAG_DEFAULTS },
      now: "2026-07-30T14:00:00Z",
    });
    persistInspectionReport({
      root: tmp,
      report,
      binding: { run_id: runId, binding_ref: binding.binding_ref },
      label: "m0-seed",
    });
    // A comparable M1 comparison, produced + persisted by the SAME production
    // function the launcher calls (full resolver inputs supplied):
    const m1 = planProductionDispatchModel({
      cwd: tmp,
      runId,
      dispatchId: "seed.att1",
      binding: { binding_ref: binding.binding_ref },
      legacy: { model: "legacy-model-9", source: "tier_map:mid" },
      settings: { model_routing: { shadow: "on" } },
      sessionContext: { target_id: "codex-cli-target" },
      catalogSnapshot: { models: CATALOG_MODELS },
      policy: validPolicy(),
      request: { purpose: "implementation", requested_complexity: "easy" },
    });
    expect(m1.provenance.source).toBe("v2_shadow");
    expect(m1.shadowArtifacts.comparisonPath).not.toBeNull();
    return binding.binding_ref;
  }

  /**
   * T6-R2-F5 (the enabled-on assertion): the M2 selection must DRIVE THE REAL
   * BACKEND, so this drives the production launcher process and reads the model
   * out of the backend spec it produced — the tmux pane command and the
   * in-process dispatch descriptor. No planProductionDispatchModel call is
   * asserted on here; the planner appears only as the SEEDER of the M0/M1
   * evidence the gate requires (a precondition, not the thing under test).
   */
  test("enabled on + verified M0/M1 → the launcher SPAWNS at the selected model: `claude --model` in the tmux pane spec AND model on the in-process descriptor", () => {
    const runId = "run-20260730-140000-m2-realpath";
    setupConsumerRepo(tmp, {
      model_routing: { enabled: "on" },
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedBoundEvidence(runId);

    // ── tmux rung: the pane the launcher would actually spawn ──────────────
    const tmuxRun = runLauncher(tmp, ["--run-id", runId]);
    expect([tmuxRun.stderr, tmuxRun.exitCode]).toEqual([tmuxRun.stderr, 0]);
    // The gated M2 selection happened on the production path...
    expect(tmuxRun.stdout.match(/M2 v2 selection/g)).toHaveLength(3);
    // ...and it reached the SPAWN: every specialist pane runs `claude --model
    // <selected>` (the fixture's 3 lanes), carrying GUILD_MODEL provenance.
    const paneLines = tmuxRun.stdout
      .split("\n")
      .filter((l) => l.includes("tmux split-window"));
    expect(paneLines).toHaveLength(3);
    for (const line of paneLines) {
      expect(line).toContain("--model powerful-model-1");
      expect(line).toContain("export GUILD_MODEL=powerful-model-1");
    }

    // ── in-process rung: the descriptor guild:execute-plan dispatches from ──
    // FU09 refuses canonical/scoped direct Agent() production dispatch. Exercise
    // the retained hash-bound, approval-verified unscoped custom-role seam so this remains a
    // real non-dry model-routing proof rather than weakening to a preview.
    writeApprovedUnscopedCustomTeam(tmp, runId);
    seedContextBundles(tmp, runId, ["custom-role"]);
    const agentRun = runLauncher(tmp, ["--run-id", runId, "--agent-mode=agent"], {
      dryRun: false,
      approvalOverride: false,
    });
    expect([agentRun.stderr, agentRun.exitCode]).toEqual([agentRun.stderr, 0]);
    expect(agentRun.stdout).toContain("approve-before-dispatch gate PASSED");
    expect(agentRun.stderr).not.toContain("NOT approval-verified");
    const signalLine = agentRun.stdout
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .pop() as string;
    const signal = JSON.parse(signalLine) as {
      dispatchAllowed: boolean;
      previewOnly: boolean;
      dispatchPlan: Array<{ name: string; model: string | null; env: Record<string, string> }>;
    };
    expect(signal.dispatchAllowed).toBe(true);
    expect(signal.previewOnly).toBe(false);
    expect(signal.dispatchPlan).toHaveLength(1);
    for (const d of signal.dispatchPlan) {
      // Was `model: null` (auto-scored) before F5 — the selected model now
      // actually rides the Agent() dispatch descriptor.
      expect(d.model).toBe("powerful-model-1");
      expect(d.env.GUILD_MODEL).toBe("powerful-model-1");
    }
  });

  test("CONTROL (flag off, same bound tree + same evidence): the launcher spawns the LEGACY pane command — no --model, no GUILD_MODEL, no v2 selection", () => {
    const runId = "run-20260730-140000-m2-realpath-off";
    setupConsumerRepo(tmp, {
      // model_routing.enabled absent ⇒ ADR default off. Everything else identical.
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedBoundEvidence(runId);

    const { exitCode, stdout, stderr } = runLauncher(tmp, ["--run-id", runId]);
    expect([stderr, exitCode]).toEqual([stderr, 0]);
    expect(stdout).not.toMatch(/M2 v2 selection/);
    const paneLines = stdout.split("\n").filter((l) => l.includes("tmux split-window"));
    expect(paneLines).toHaveLength(3);
    for (const line of paneLines) {
      expect(line).not.toContain("--model");
      expect(line).not.toContain("GUILD_MODEL");
    }

    // Non-dry, hash-bound approval-verified unscoped control for the same reason as the
    // enabled-on rung: a dry preflight plans in memory but is never dispatch-
    // authorized, so it would make this expectation vacuous.
    writeApprovedUnscopedCustomTeam(tmp, runId);
    seedContextBundles(tmp, runId, ["custom-role"]);
    const agentRun = runLauncher(tmp, ["--run-id", runId, "--agent-mode=agent"], {
      dryRun: false,
      approvalOverride: false,
    });
    expect(agentRun.exitCode).toBe(0);
    expect(agentRun.stdout).toContain("approve-before-dispatch gate PASSED");
    expect(agentRun.stderr).not.toContain("NOT approval-verified");
    const signal = JSON.parse(
      agentRun.stdout.split("\n").filter((l) => l.trim().startsWith("{")).pop() as string
    ) as {
      dispatchAllowed: boolean;
      previewOnly: boolean;
      dispatchPlan: Array<{ model: string | null; env: Record<string, string> }>;
    };
    expect(signal.dispatchAllowed).toBe(true);
    expect(signal.previewOnly).toBe(false);
    expect(signal.dispatchPlan).toHaveLength(1);
    for (const d of signal.dispatchPlan) {
      expect(d.model).toBeNull();
      expect(d.env.GUILD_MODEL).toBeUndefined();
    }
  });

  test("the gate is not injectable: same launcher inputs, flag off vs on, decided by the run's OWN verified evidence", () => {
    const runId = "run-m2-gate-check";
    const bindingRef = seedBoundEvidence(runId);
    // Flag off → legacy retained byte-identically (F3: no injectable gate).
    const gatedOff = planProductionDispatchModel({
      cwd: tmp,
      runId,
      dispatchId: "task-a.att1",
      binding: { binding_ref: bindingRef },
      legacy: { model: "legacy-model-9", source: "tier_map:mid" },
      settings: {},
      sessionContext: { target_id: "codex-cli-target" },
      catalogSnapshot: { models: CATALOG_MODELS },
      policy: validPolicy(),
      request: { purpose: "implementation", requested_complexity: "easy" },
    });
    expect(gatedOff.selection.source).toBe("legacy");
    expect(gatedOff.selection.model).toBe("legacy-model-9");
    expect(gatedOff.provenance.source).toBe("legacy");
    expect(gatedOff.provenance.selected_model).toBeUndefined();
  });

  test("enabled on but NO evidence on record → legacy retained with the honest gate reason", () => {
    const runId = "run-m2-unevidenced";
    const binding = mintRunBinding({ root: tmp, run_id: runId });
    const out = planProductionDispatchModel({
      cwd: tmp,
      runId,
      dispatchId: "task-b.att1",
      binding: { binding_ref: binding.binding_ref },
      legacy: { model: "legacy-model-9", source: "tier_map:mid" },
      settings: { model_routing: { enabled: "on" } },
      sessionContext: { target_id: "codex-cli-target" },
      catalogSnapshot: { models: CATALOG_MODELS },
      policy: validPolicy(),
      request: { purpose: "implementation", requested_complexity: "easy" },
    });
    expect(out.selection.source).toBe("legacy");
    expect(out.selection.reason).toMatch(/M0 not evidenced/);
  });

  test("PROBE (F4 on the real path): shadow-on dispatch into a run with NO minted binding → the dispatch model step throws, nothing persisted", () => {
    const runId = "run-m2-nobind";
    expect(() =>
      planProductionDispatchModel({
        cwd: tmp,
        runId,
        dispatchId: "task-c.att1",
        binding: { binding_ref: "rb-not-minted" },
        legacy: { model: "legacy-model-9", source: "tier_map:mid" },
        settings: { model_routing: { shadow: "on" } },
        sessionContext: { target_id: "codex-cli-target" },
        catalogSnapshot: { models: CATALOG_MODELS },
        policy: validPolicy(),
        request: { purpose: "implementation", requested_complexity: "easy" },
      })
    ).toThrow(/binding_rejected/);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "shadow"))).toBe(false);
  });
});

/**
 * T8R / F3 — the M0 inspection report now has a PRODUCTION WRITER.
 *
 * T8's integrated verification found `persistInspectionReport` had zero
 * production callers: `guild models inspect` is read-only by contract and the
 * launcher supplied no resolver inputs, so `.guild/runs/<id>/inspection/` was
 * always empty in a real run, `deriveResolveInputsFromM0Evidence` always
 * returned null, and M2 could never reach a v2 selection end-to-end.
 *
 * These cases drive the REAL launcher process over a tree that carries NO
 * pre-seeded inspection artifact and passes NO caller-supplied session context
 * or catalog snapshot. Everything the resolver needs has to come from evidence
 * the production path recorded ITSELF.
 */
describe("REAL PATH (T8R/F3): the M0 inspection report has a production writer", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t8r-f3-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const HOST = { family: "claude", surface: "cli", adapter_id: "claude-code", adapter_version: "2.2.0" };
  const TARGET = {
    target_id: "claude-cli",
    provider_kind: "subscription",
    auth_mode: "oauth",
    account_fingerprint: "acct-fp-1",
    endpoint_fingerprint: "endp-fp-1",
    org_fingerprint: "org-fp-1",
    tool_version: "2.2.0",
  };

  /**
   * Seed ONLY the two artifacts a real run legitimately owns: the frozen
   * session context written at run start, and the content-addressed catalog
   * cache entry keyed off that context's identity tuple. NO inspection report
   * is planted — that is the thing under test.
   */
  function seedRunIdentity(
    runId: string,
    catalogModels: typeof CATALOG_MODELS = CATALOG_MODELS,
  ): string {
    const binding = mintRunBinding({ root: tmp, run_id: runId });
    const sessionContext = {
      schema_version: SESSION_CONTEXT_SCHEMA,
      run_id: runId,
      started_at: "2026-07-30T14:00:00Z",
      host: { ...HOST },
      identity: {
        source: "native_adapter",
        trust: "verified",
        confidence: "high",
        evidence: "adapter handshake",
      },
      execution_target: { ...TARGET },
      active_model: null,
      run_binding: { binding_ref: binding.binding_ref, state: "open" },
    };
    fs.mkdirSync(path.join(tmp, ".guild", "runs", runId), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, ".guild", "runs", runId, "session-context.json"),
      JSON.stringify(sessionContext, null, 2),
      "utf8"
    );
    const key = createCacheKey(
      {
        target_id: TARGET.target_id,
        family: HOST.family,
        surface: HOST.surface,
        provider_kind: TARGET.provider_kind,
        auth_mode: TARGET.auth_mode,
        account_fingerprint: TARGET.account_fingerprint,
        endpoint_fingerprint: TARGET.endpoint_fingerprint,
        org_fingerprint: TARGET.org_fingerprint,
        tool_version: TARGET.tool_version,
        adapter_id: HOST.adapter_id,
        adapter_version: HOST.adapter_version,
      },
      runId
    );
    const cacheDir = modelCatalogCacheDir(tmp);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
      path.join(cacheDir, `${key.hash}.json`),
      JSON.stringify(
        {
          schema_version: MODEL_CATALOG_SCHEMA_VERSION,
          target: { ...TARGET, ...HOST },
          discovery: {
            method: "cli_listing",
            source_ref: "models list",
            discovered_at: "2026-07-30T13:00:00Z",
            ttl_seconds: 7200,
            status: "ok",
            latency_ms: 12,
            failure_reason: null,
          },
          generation: 1,
          models: catalogModels.map((m) => ({
            canonical_id: m.canonical_id,
            tier: m.tier,
            evidence: {
              state: m.evidence.state,
              source: "cli_listing",
              confidence: "high",
              as_of: "2026-07-30T13:00:00Z",
            },
          })),
        },
        null,
        2
      ),
      "utf8"
    );
    return binding.binding_ref;
  }

  test("shadow on: the launcher RECORDS this run's M0 inspection report, and loadVerifiedM0Reports accepts it", () => {
    const runId = "run-20260730-140000-f3-writer";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on" },
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);
    seedContextBundles(tmp, runId);
    // Precondition: nothing has ever written an inspection report here.
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);

    const { exitCode, stdout, stderr } = runLauncher(
      tmp,
      ["--run-id", runId],
      { dryRun: false },
    );
    expect([stderr, exitCode]).toEqual([stderr, 0]);
    expect(stdout).toMatch(/M0 inspection evidence recorded/);

    const reportPath = path.join(tmp, ".guild", "runs", runId, "inspection", "dispatch.json");
    expect(fs.existsSync(reportPath)).toBe(true);
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    expect(report.schema_version).toBe(MODEL_INSPECTION_SCHEMA);
    expect(report.state).toBe("ok");
    expect(report.run_id).toBe(runId);
    expect(report.catalog.state).toBe("ok");

    // The M2 gate's OWN verifier accepts what production wrote — not a
    // hand-shaped fixture, and not merely "a file exists".
    const evidence = {
      root: tmp,
      run_id: runId,
      m0: { inspection_report_refs: ["inspection/dispatch.json"] },
      m1: { shadow_comparison_refs: [] },
    };
    expect(loadVerifiedM0Reports(evidence)).toHaveLength(1);
    // ...and the resolver inputs the dispatch path derives are now NON-NULL,
    // which was the exact thing F3 said could never happen in a real run.
    const derived = deriveResolveInputsFromM0Evidence(evidence);
    expect(derived).not.toBeNull();
    expect((derived?.catalog_snapshot as { models: unknown[] }).models).toHaveLength(
      CATALOG_MODELS.length
    );
  });

  /**
   * The staged-rollout chain, end to end, inside ONE launcher process and with
   * NOTHING pre-seeded but the run's own identity artifacts:
   *
   *   record M0 inspection evidence  (the writer F3 said did not exist)
   *     → derive resolver inputs from it (was always null before)
   *     → the M1 shadow leg resolves COMPARABLY and persists a hash-verified
   *       comparison (it failed closed before, for want of those inputs)
   *     → gateM2 — which requires BOTH a verified M0 report AND a comparable
   *       M1 comparison — goes active
   *     → a v2 selection reaches the real backend spec.
   *
   * M1 is genuinely staged BEFORE M2: the first lane dispatched in a fresh run
   * has no comparison on record yet, so it stays legacy and produces the M1
   * evidence the later lanes gate on. That is the ADR's milestone ordering, and
   * this asserts it as it really behaves rather than rounding it up to 3/3.
   */
  test("shadow+enabled on: M2 reaches a v2 selection END-TO-END from evidence the run RECORDED ITSELF — no pre-seeded artifact, no caller-supplied resolver inputs", () => {
    const runId = "run-20260730-140000-f3-reachable";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on", enabled: "on" },
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);
    seedContextBundles(tmp, runId);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "shadow"))).toBe(false);

    const { exitCode, stdout, stderr } = runLauncher(
      tmp,
      ["--run-id", runId],
      { dryRun: false },
    );
    expect([stderr, exitCode]).toEqual([stderr, 0]);
    expect(stdout).toMatch(/M0 inspection evidence recorded/);

    // The M1 leg is no longer failing closed — the comparison is COMPARABLE,
    // which it can only be because the derived M0 inputs reached the resolver.
    const shadowDir = path.join(tmp, ".guild", "runs", runId, "shadow");
    const comparisons = fs
      .readdirSync(shadowDir)
      .filter((f) => f.endsWith(".shadow-comparison.json"));
    expect(comparisons.length).toBeGreaterThan(0);
    const firstCmp = JSON.parse(fs.readFileSync(path.join(shadowDir, comparisons[0]), "utf8"));
    expect(firstCmp.comparable).toBe(true);
    expect(selfReferentialHash(firstCmp, "comparison_hash")).toBe(firstCmp.comparison_hash);

    // ...and M2 went active for the lanes that follow that evidence, reaching
    // the real spawn spec.
    const v2Selections = stdout.match(/M2 v2 selection/g) ?? [];
    expect(v2Selections.length).toBeGreaterThan(0);
    const modelPanes = fakeTmuxLog(tmp)
      .split("\n")
      .filter((l) => l.startsWith("split-window ") && l.includes("--model"));
    expect(modelPanes).toHaveLength(v2Selections.length);
    for (const line of modelPanes) {
      expect(line).toContain("--model powerful-model-1");
    }
  });

  test("dry-run warns that fresh-run M0/M1 evolution can expose a later §6 confirmation while remaining write-free", () => {
    const runId = "run-20260730-140000-fu08-preview-stage-evolution";
    const policy = validPolicy();
    const implementation = (policy.purposes as Record<string, Record<string, unknown>>)
      .implementation;
    implementation.confirm_on_degradation = true;
    const route = (implementation.routes as Array<{
      fallbacks: Array<Record<string, unknown>>;
    }>)[0];
    route.fallbacks[0].effort = "high";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on", enabled: "on" },
      model_policy: policy,
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const catalog = CATALOG_MODELS.map((model, index) => ({
      ...model,
      evidence: { state: index === 0 ? "unavailable" : "available" },
    })) as typeof CATALOG_MODELS;
    seedRunIdentity(runId, catalog);
    seedContextBundles(tmp, runId);

    const runDir = path.join(tmp, ".guild", "runs", runId);
    const preview = runLauncher(tmp, ["--run-id", runId], { dryRun: true });
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout).toMatch(
      /BLOCKED PREVIEW:.*M0\/M1.*later-lane M2 selection.*confirmation/is,
    );
    expect(fs.existsSync(path.join(runDir, "inspection"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "shadow"))).toBe(false);

    const real = runLauncher(tmp, ["--run-id", runId], { dryRun: false });
    expect(real.exitCode).not.toBe(0);
    expect(real.stderr).toMatch(/confirmation_required/);
  });

  test("CONTROL (anti-vacuity): ADR-default flags over the SAME identity tree → NO inspection report is written at all", () => {
    const runId = "run-20260730-140000-f3-control";
    setupConsumerRepo(tmp, {
      // model_routing absent ⇒ shadow off, enabled off. Everything else identical.
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);
    seedContextBundles(tmp, runId);

    const { exitCode, stdout, stderr } = runLauncher(
      tmp,
      ["--run-id", runId],
      { dryRun: false },
    );
    expect([stderr, exitCode]).toEqual([stderr, 0]);
    expect(stdout).not.toMatch(/M0 inspection evidence recorded/);
    expect(stdout).not.toMatch(/M2 v2 selection/);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);
    // The dispatch still happened — the recorder is inert, not blocking.
    expect(assignmentFiles(tmp, runId)).toHaveLength(3);
  });
});

/**
 * FIC-48 — the run-identity contract these fixtures were reconciled AGAINST,
 * pinned as refusal probes. The fixtures above seed canonical, lifecycle-bound
 * run identities; these probes prove that adaptation did not weaken the
 * contract — each forbidden identity shape is still REFUSED by the production
 * launcher with nothing dispatched and nothing persisted.
 */
describe("REAL PATH (FIC-48): the launcher's run-identity contract stays strict", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-runid-contract-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("PROBE: a legacy non-canonical --run-id (the exact pre-reconciliation fixture shape) is REFUSED — no pane, no cells, no run tree", () => {
    setupConsumerRepo(tmp, {
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const legacyId = "run-m2-realpath"; // what these fixtures passed before FIC-48
    const { exitCode, stdout, stderr } = runLauncher(tmp, ["--run-id", legacyId]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/canonical run id required \(run-<yyyymmdd-hhmmss>-<slug>\)/);
    expect(stdout).not.toMatch(/emitted \d+ guild\.task_assignment\.v2 cell/);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", legacyId))).toBe(false);
  });

  test("PROBE: a canonical --run-id WITHOUT a minted binding is REFUSED (binding_rejected) — the launcher never mints on a caller's behalf", () => {
    setupConsumerRepo(tmp, {
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const { exitCode, stdout, stderr } = runLauncher(tmp, [
      "--run-id",
      "run-20260730-140000-unbound",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/binding_rejected/);
    expect(stdout).not.toMatch(/emitted \d+ guild\.task_assignment\.v2 cell/);
  });

  test("PROBE: no --run-id and no lifecycle sentinel is REFUSED — the launcher is a consumer, never a run-starting actor", () => {
    setupConsumerRepo(tmp, {
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const { exitCode, stdout, stderr } = runLauncher(tmp);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/lifecycle run id required/);
    expect(stdout).not.toMatch(/emitted \d+ guild\.task_assignment\.v2 cell/);
    expect(findRunDirs(tmp)).toHaveLength(0);
  });
});
