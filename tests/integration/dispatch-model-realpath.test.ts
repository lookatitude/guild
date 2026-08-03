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

function runLauncher(
  cwd: string,
  extraArgs: string[] = []
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
  env.GUILD_DISPATCH_APPROVAL_OVERRIDE =
    "dispatch-model realpath fixture: no team-plan trail; approval verification is pinned separately";
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
      "--dry-run",
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
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on" },
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    const { exitCode, stdout, stderr } = runLauncher(tmp);
    expect([stderr, exitCode]).toEqual([stderr, 0]);

    const runDirs = findRunDirs(tmp);
    expect(runDirs).toHaveLength(1);
    const runDir = runDirs[0];
    const runId = path.basename(runDir);

    // The run is BOUND: the launcher minted the binding before any write.
    expect(loadRunBinding({ root: tmp, run_id: runId })).not.toBeNull();

    // Task cells were emitted on the production channel...
    expect(stdout).toMatch(/emitted 3 guild\.task_assignment\.v2 cell\(s\)/);
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
    const { exitCode, stdout } = runLauncher(tmp);
    expect(exitCode).toBe(0);
    const runDirs = findRunDirs(tmp);
    expect(runDirs).toHaveLength(1);
    expect(fs.existsSync(path.join(runDirs[0], "shadow"))).toBe(false);
    expect(stdout).not.toMatch(/M1 shadow comparison recorded/);
    expect(stdout).not.toMatch(/M2 v2 selection/);
    // The production channel still dispatched normally:
    expect(stdout).toMatch(/emitted 3 guild\.task_assignment\.v2 cell\(s\)/);
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
    const runId = "run-m2-realpath";
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
    const agentRun = runLauncher(tmp, ["--run-id", runId, "--agent-mode=agent"]);
    expect([agentRun.stderr, agentRun.exitCode]).toEqual([agentRun.stderr, 0]);
    const signalLine = agentRun.stdout
      .split("\n")
      .filter((l) => l.trim().startsWith("{"))
      .pop() as string;
    const signal = JSON.parse(signalLine) as {
      dispatchPlan: Array<{ name: string; model: string | null; env: Record<string, string> }>;
    };
    expect(signal.dispatchPlan).toHaveLength(3);
    for (const d of signal.dispatchPlan) {
      // Was `model: null` (auto-scored) before F5 — the selected model now
      // actually rides the Agent() dispatch descriptor.
      expect(d.model).toBe("powerful-model-1");
      expect(d.env.GUILD_MODEL).toBe("powerful-model-1");
    }
  });

  test("CONTROL (flag off, same bound tree + same evidence): the launcher spawns the LEGACY pane command — no --model, no GUILD_MODEL, no v2 selection", () => {
    const runId = "run-m2-realpath-off";
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

    const agentRun = runLauncher(tmp, ["--run-id", runId, "--agent-mode=agent"]);
    expect(agentRun.exitCode).toBe(0);
    const signal = JSON.parse(
      agentRun.stdout.split("\n").filter((l) => l.trim().startsWith("{")).pop() as string
    ) as { dispatchPlan: Array<{ model: string | null; env: Record<string, string> }> };
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
  function seedRunIdentity(runId: string): string {
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
          models: CATALOG_MODELS.map((m) => ({
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
    const runId = "run-f3-writer";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on" },
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);
    // Precondition: nothing has ever written an inspection report here.
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);

    const { exitCode, stdout, stderr } = runLauncher(tmp, ["--run-id", runId]);
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
    const runId = "run-f3-reachable";
    setupConsumerRepo(tmp, {
      model_routing: { shadow: "on", enabled: "on" },
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "shadow"))).toBe(false);

    const { exitCode, stdout, stderr } = runLauncher(tmp, ["--run-id", runId]);
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
    const modelPanes = stdout
      .split("\n")
      .filter((l) => l.includes("tmux split-window") && l.includes("--model"));
    expect(modelPanes).toHaveLength(v2Selections.length);
    for (const line of modelPanes) {
      expect(line).toContain("--model powerful-model-1");
    }
  });

  test("CONTROL (anti-vacuity): ADR-default flags over the SAME identity tree → NO inspection report is written at all", () => {
    const runId = "run-f3-control";
    setupConsumerRepo(tmp, {
      // model_routing absent ⇒ shadow off, enabled off. Everything else identical.
      model_policy: validPolicy(),
      models: { tiers: { mid: { claude: "legacy-model-9" } } },
    });
    seedRunIdentity(runId);

    const { exitCode, stdout, stderr } = runLauncher(tmp, ["--run-id", runId]);
    expect([stderr, exitCode]).toEqual([stderr, 0]);
    expect(stdout).not.toMatch(/M0 inspection evidence recorded/);
    expect(stdout).not.toMatch(/M2 v2 selection/);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);
    // The dispatch still happened — the recorder is inert, not blocking.
    expect(stdout).toMatch(/emitted 3 guild\.task_assignment\.v2 cell\(s\)/);
  });
});
