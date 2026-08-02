/**
 * tests/integration/model-inspect-service.test.ts — lane T6, rework round 2
 * (run-20260730-131020-dynamic-host-model-routing).
 *
 * M0 read-only inspection service (module-map §1: capability/model-inspect).
 * Contract under test:
 *   - works from Claude CLI, Claude App, Codex CLI, Codex App session-context
 *     fixtures SIMULTANEOUSLY with no cross-contamination;
 *   - INSPECT-ONLY (T6-R1-F1): the module performs NO I/O of any kind — an
 *     inspection call creates/appends no file anywhere (probed dynamically
 *     against every fs write primitive AND statically against the module
 *     source, which must not import fs at all);
 *   - receipts are trusted only after RECOMPUTE-AND-VERIFY (T6-R1-F2): a
 *     forged finalized_at + 64-zero receipt_hash + fabricated actual_model is
 *     rejected/ignored and surfaced as an unknown; `finalized` is the T5
 *     verifier's verdict, never string presence;
 *   - independence comes ONLY from a hash-bound §7a adjudication block; a
 *     caller-supplied {independence: "strong"} fragment is rejected;
 *   - surfaces honest unknowns (absent catalog, disabled discovery, unbound
 *     actual model, unwritten independence adjudication — §7a forbids
 *     provisional strong);
 *   - catalog age/staleness computed from the snapshot's own discovery record
 *     against a caller-supplied clock (no wall-clock reads).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildModelInspection,
  MODEL_INSPECTION_SCHEMA,
} from "../../src/modules/capability/workflows/model-inspect";
import { persistInspectionReport } from "../../src/modules/capability/workflows/inspection-persist";
import { buildIndependenceAdjudication } from "../../src/modules/capability/workflows/independence-predicates";
import {
  readRoutingFlags,
  ROUTING_FLAG_DEFAULTS,
  type RoutingFlags,
} from "../../src/modules/capability/workflows/routing-rollout";
import { buildSessionContext } from "../../src/modules/host-runtime/workflows/session-context";
import {
  finalizeReceipt,
  recordAttempt,
  resolve as resolveModel,
  type ResolutionReceipt,
} from "../../src/modules/capability/workflows/model-resolver";
import {
  BindingRejectedError,
  mintRunBinding,
} from "../../src/modules/lifecycle/workflows/run-binding";

const NOW = "2026-07-30T14:00:00Z";

// ── Fixtures: the four primary host session contexts (contract-shaped) ──────

function hostContext(opts: {
  runId: string;
  family: string;
  surface: string;
  trust?: "asserted" | "verified";
  targetId?: string;
}): Record<string, unknown> {
  return {
    schema_version: "guild.session_context.v1",
    run_id: opts.runId,
    started_at: "2026-07-30T13:00:00Z",
    host: {
      family: opts.family,
      surface: opts.surface,
      adapter_id: `${opts.family}-${opts.surface}`,
      adapter_version: "1.0.0",
    },
    identity: {
      source: opts.trust === "verified" ? "native_adapter" : "invocation_envelope",
      trust: opts.trust ?? "asserted",
      confidence: opts.trust === "verified" ? "high" : "low",
      evidence: "fixture",
    },
    execution_target: {
      target_id: opts.targetId ?? `${opts.family}-${opts.surface}-target`,
      provider_kind: "unknown",
      auth_mode: "unknown",
      account_fingerprint: "unknown",
      endpoint_fingerprint: "unknown",
      org_fingerprint: "unknown",
      tool_version: "unknown",
    },
    active_model: null,
    run_binding: { binding_ref: `bind-${opts.runId}`, state: "open" },
  };
}

const FOUR_HOSTS = [
  { runId: "run-claude-cli", family: "claude", surface: "cli" },
  { runId: "run-claude-app", family: "claude", surface: "app" },
  { runId: "run-codex-cli", family: "codex", surface: "cli" },
  { runId: "run-codex-app", family: "codex", surface: "app" },
] as const;

function catalogSnapshot(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    schema_version: "guild.model_catalog.v1",
    target: { target_id: "codex-cli-target" },
    discovery: {
      method: "native_list",
      source_ref: "fixture",
      discovered_at: "2026-07-30T13:50:00Z", // 600 s before NOW
      ttl_seconds: 900,
      status: "ok",
      latency_ms: 42,
      failure_reason: null,
    },
    generation: 3,
    models: [
      {
        canonical_id: "powerful-model-1",
        model_family: "acme",
        tier: "powerful",
        catalog_index: 0,
        evidence: { state: "available" },
      },
      {
        canonical_id: "advertised-model-2",
        model_family: "acme",
        tier: "mid",
        catalog_index: 1,
        evidence: { state: "advertised" },
      },
    ],
    ...(overrides ?? {}),
  };
}

function validPolicy(): Record<string, unknown> {
  return {
    version: 2,
    allow_advertised_attempt: false,
    purposes: {
      research: {
        min_effective_complexity: "hard",
        independence: "none",
        confirm_on_degradation: true,
        routes: [
          {
            complexity: "hard",
            preferred: [{ selector: "id:powerful-model-1" }],
            fallbacks: [],
          },
        ],
      },
    },
  };
}

function frozenReceiptFor(runId: string): Record<string, unknown> {
  const receipt = resolveModel({
    session_context: { target_id: "codex-cli-target" },
    catalog_snapshot: { models: catalogSnapshot()["models"] as unknown[] },
    policy: validPolicy(),
    request: { purpose: "research", requested_complexity: "easy" },
    run_id: runId,
    dispatch_id: `${runId}-d1`,
  });
  return receipt as unknown as Record<string, unknown>;
}

/** A REAL finalized receipt — recorded attempt + finalizeReceipt (hashes verify). */
function finalizedReceiptFor(
  runId: string,
  opts?: { actualModel?: string; substitution?: string; degradation?: Record<string, unknown> }
): ResolutionReceipt {
  let receipt = resolveModel({
    session_context: { target_id: "codex-cli-target" },
    catalog_snapshot: { models: catalogSnapshot()["models"] as unknown[] },
    policy: validPolicy(),
    request: { purpose: "research", requested_complexity: "easy" },
    run_id: runId,
    dispatch_id: `${runId}-d1`,
  });
  receipt = recordAttempt(receipt, {
    model: "powerful-model-1",
    effort: null,
    result: "served",
    failure_class: null,
    substitution_class: (opts?.substitution ?? "none") as never,
    actual_model: opts?.actualModel ?? "powerful-model-1",
  });
  if (opts?.degradation) {
    receipt.outcome.degradation = opts.degradation as never;
  }
  return finalizeReceipt(receipt, { status: "served", at: "2026-07-30T13:59:00Z" });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

function flagsOn(overrides?: Partial<RoutingFlags>): RoutingFlags {
  return { ...ROUTING_FLAG_DEFAULTS, ...(overrides ?? {}) };
}

// ── M0: works across the four host fixtures simultaneously ──────────────────

describe("model-inspect — M0 read-only inspection service (lane T6)", () => {
  test("all four host fixtures inspect simultaneously with no cross-contamination", () => {
    const reports = FOUR_HOSTS.map((h) =>
      buildModelInspection({
        session_context: hostContext(h),
        catalog_snapshot: catalogSnapshot(),
        policy: validPolicy(),
        receipt: frozenReceiptFor(h.runId),
        flags: flagsOn(),
        now: NOW,
      })
    );
    expect(reports).toHaveLength(4);
    for (let i = 0; i < FOUR_HOSTS.length; i++) {
      expect(reports[i].schema_version).toBe(MODEL_INSPECTION_SCHEMA);
      expect(reports[i].run_id).toBe(FOUR_HOSTS[i].runId);
      expect(reports[i].host).toEqual({
        family: FOUR_HOSTS[i].family,
        surface: FOUR_HOSTS[i].surface,
      });
      expect(reports[i].state).toBe("ok");
    }
    // No cross-contamination: every run_id distinct, every selection bound to
    // that run's own receipt.
    expect(new Set(reports.map((r) => r.run_id)).size).toBe(4);
    for (const r of reports) {
      expect(r.selection?.model).toBe("powerful-model-1");
    }
  });

  test("REAL-PATH anchor: a buildSessionContext-built (not hand-shaped) context inspects identically", () => {
    const real = buildSessionContext({
      run_id: "run-real-claude",
      started_at: "2026-07-30T13:00:00Z",
      native_adapter: {
        family: "claude",
        surface: "cli",
        adapter_id: "claude-code",
        adapter_version: "2.2.0",
        evidence: "host-set env CLAUDECODE=1 in the spawned process",
      },
      run_binding: { binding_ref: "bind-real", state: "open" },
    });
    const report = buildModelInspection({
      session_context: real,
      catalog_snapshot: null,
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.run_id).toBe("run-real-claude");
    expect(report.host).toEqual({ family: "claude", surface: "cli" });
    expect(report.identity.trust).toBe("verified");
  });

  // ── Read-only guarantees (M0 IS INSPECT-ONLY) ─────────────────────────────

  test("never mutates routing: deep-frozen inputs pass through byte-identical; output is deep-frozen", () => {
    const sc = deepFreeze(hostContext(FOUR_HOSTS[0]));
    const cat = deepFreeze(catalogSnapshot());
    const pol = deepFreeze(validPolicy());
    const rec = deepFreeze(frozenReceiptFor("run-claude-cli"));
    const before = JSON.stringify({ sc, cat, pol, rec });

    const report = buildModelInspection({
      session_context: sc,
      catalog_snapshot: cat,
      policy: pol,
      receipt: rec,
      flags: flagsOn(),
      now: NOW,
    });

    expect(JSON.stringify({ sc, cat, pol, rec })).toBe(before);
    // Output frozen at every level — a consumer cannot turn the display
    // surface into a routing mutation channel.
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.selection)).toBe(true);
    expect(Object.isFrozen(report.fallbacks)).toBe(true);
    expect(() => {
      (report as unknown as Record<string, unknown>)["selection"] = { model: "hijack" };
    }).toThrow();
  });

  test("selection/fallbacks are ECHOES of the frozen receipt — inspection invents nothing", () => {
    const receipt = frozenReceiptFor("run-codex-cli");
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[2]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.selection?.model).toBe((receipt["selection"] as Record<string, unknown>)["model"]);
    expect(report.fallbacks?.fallback_hash).toBe(receipt["fallback_hash"]);
    expect(report.fallbacks?.chain).toEqual(receipt["fallbacks"]);
    // No receipt at all → no selection claim of any kind.
    const bare = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[2]),
      catalog_snapshot: catalogSnapshot(),
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(bare.selection).toBeNull();
    expect(bare.fallbacks).toBeNull();
    expect(bare.unknowns).toEqual(expect.arrayContaining(["selection"]));
  });

  // ── Honest unknowns ───────────────────────────────────────────────────────

  test("absent catalog → state 'absent', never a fabricated listing", () => {
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[1]),
      catalog_snapshot: null,
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.catalog.state).toBe("absent");
    expect(report.catalog.models).toBeNull();
    expect(report.unknowns).toEqual(expect.arrayContaining(["catalog"]));
  });

  test("discovery flag off → 'discovery_disabled' honestly, even when a (stale) snapshot exists", () => {
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[3]),
      catalog_snapshot: catalogSnapshot(), // present but must NOT be sold as live
      policy: null,
      receipt: null,
      flags: flagsOn({ "model_routing.discovery": "off" }),
      now: NOW,
    });
    expect(report.catalog.state).toBe("discovery_disabled");
    expect(report.catalog.models).toBeNull();
    expect(report.catalog.age_seconds).toBeNull();
  });

  test("catalog age + staleness derive from the snapshot's own discovery record vs the supplied clock", () => {
    const fresh = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[2]),
      catalog_snapshot: catalogSnapshot(),
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(fresh.catalog.age_seconds).toBe(600);
    expect(fresh.catalog.stale).toBe(false);
    expect(fresh.catalog.generation).toBe(3);
    expect(fresh.catalog.models).toEqual([
      { canonical_id: "powerful-model-1", tier: "powerful", evidence_state: "available" },
      { canonical_id: "advertised-model-2", tier: "mid", evidence_state: "advertised" },
    ]);

    const stale = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[2]),
      catalog_snapshot: catalogSnapshot({
        discovery: {
          method: "native_list",
          source_ref: "fixture",
          discovered_at: "2026-07-30T12:00:00Z", // 7200 s before NOW > ttl 900
          ttl_seconds: 900,
          status: "ok",
          latency_ms: 42,
          failure_reason: null,
        },
      }),
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(stale.catalog.age_seconds).toBe(7200);
    expect(stale.catalog.stale).toBe(true);

    const unparsable = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[2]),
      catalog_snapshot: catalogSnapshot({
        discovery: { discovered_at: "not-a-date", ttl_seconds: 900 },
      }),
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(unparsable.catalog.age_seconds).toBeNull();
    expect(unparsable.catalog.stale).toBeNull();
    expect(unparsable.unknowns).toEqual(expect.arrayContaining(["catalog_age"]));
  });

  test("unfinalized receipt → actual_model 'unknown' (an unfinalized receipt proves nothing, §8)", () => {
    const receipt = frozenReceiptFor("run-claude-cli"); // core only, never finalized
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.outcome.finalized).toBe(false);
    expect(report.outcome.actual_model).toBe("unknown");
    // NEVER the requested/selected model:
    expect(report.outcome.actual_model).not.toBe(report.selection?.model);
    expect(report.unknowns).toEqual(expect.arrayContaining(["actual_model"]));
  });

  test("REAL finalized provider_silent receipt → actual_model stays the literal 'unknown' (§5); hashes verify", () => {
    const finalized = finalizedReceiptFor("run-claude-cli", {
      actualModel: "unknown",
      substitution: "provider_silent",
      degradation: { kind: "evidence", note: "provider did not report the served model" },
    });
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: finalized,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.outcome.finalized).toBe(true);
    expect(report.outcome.status).toBe("served");
    expect(report.outcome.actual_model).toBe("unknown");
    expect(report.degradation).toEqual({
      kind: "evidence",
      note: "provider did not report the served model",
    });
  });

  // ── T6-R1-F2 probes: forged receipts + caller-shaped independence rejected ─

  test("PROBE (F2): forged finalized receipt (64-zero receipt_hash + fabricated actual_model) is rejected — surfaces unknown, never 'finalized'", () => {
    const forged = {
      ...frozenReceiptFor("run-claude-cli"),
      outcome: {
        attempted: [],
        actual_model: "fabricated-actual",
        status: "served",
      },
      finalized_at: "2026-07-30T13:59:00Z",
      receipt_hash: "0".repeat(64),
    };
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: forged,
      adjudication: { independence: "strong" }, // caller fragment — must be ignored
      flags: flagsOn(),
      now: NOW,
    });
    // The forged receipt is treated as ABSENT: nothing in it reaches the report.
    expect(report.outcome.finalized).toBe(false);
    expect(report.outcome.status).toBe("pending");
    expect(report.outcome.actual_model).toBe("unknown");
    expect(report.selection).toBeNull();
    expect(report.unknowns.join("\n")).toMatch(/receipt_unverified:receipt_hash_mismatch/);
    // The caller "strong" fragment is rejected — no independence value exists.
    expect(report.independence.adjudicated).toBe(false);
    expect(report.independence.independence).toBeNull();
    expect(report.unknowns).toEqual(expect.arrayContaining(["independence", "actual_model"]));
  });

  test("PROBE (F2): a tampered CORE (rule_path edited after freeze) fails core-hash recompute → treated absent", () => {
    const tampered = {
      ...frozenReceiptFor("run-claude-cli"),
      rule_path: ["attacker_injected"],
    };
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: tampered,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.selection).toBeNull();
    expect(report.unknowns.join("\n")).toMatch(/receipt_unverified:core_hash_mismatch/);
  });

  test("PROBE (F2/§7a): a caller {independence:'strong'} fragment over a REAL verified receipt is still rejected (not a written §7a block)", () => {
    const finalized = finalizedReceiptFor("run-claude-cli");
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: finalized,
      adjudication: { independence: "strong", predicate_trace: "caller says strong" },
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.outcome.finalized).toBe(true); // the receipt itself verifies
    expect(report.independence.adjudicated).toBe(false); // the fragment does not
    expect(report.independence.independence).toBeNull();
    expect(report.independence.note).toMatch(/not a written §7a adjudication block/);
  });

  test("§7a: a HASH-BOUND adjudication block over the verified finalized receipt IS accepted; an unbound block is rejected", () => {
    const producer = finalizedReceiptFor("run-claude-cli");
    const reviewer = finalizedReceiptFor("run-claude-cli-reviewer");
    const block = buildIndependenceAdjudication({
      producer_ref: {
        dispatch_id: String(producer.dispatch_id),
        receipt_hash: producer.receipt_hash as string,
      },
      reviewer_ref: {
        dispatch_id: String(reviewer.dispatch_id),
        receipt_hash: reviewer.receipt_hash as string,
      },
      producer: {
        host_family: "claude",
        host_trust: "verified",
        served_model: "powerful-model-1",
        served_model_family: "acme",
        finalized: true,
        status: "served",
      },
      reviewer: {
        host_family: "codex",
        host_trust: "verified",
        served_model: "powerful-model-1",
        served_model_family: "acme",
        finalized: true,
        status: "served",
      },
      requested_independence: "prefer_cross_family",
    });
    const bound = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: producer,
      adjudication: block,
      flags: flagsOn(),
      now: NOW,
    });
    // Same-family served models → the §7a verdict is weak; the inspection
    // echoes the ADJUDICATED verdict, never invents strong.
    expect(bound.independence.adjudicated).toBe(true);
    expect(bound.independence.independence).toBe("weak");
    expect(bound.independence.note).toMatch(/=> weak/);

    // The same block presented against a DIFFERENT dispatch's receipt (hash
    // not referenced by the block) is rejected — hash-bound or nothing.
    const other = finalizedReceiptFor("run-unrelated");
    const unbound = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: other,
      adjudication: block,
      flags: flagsOn(),
      now: NOW,
    });
    expect(unbound.independence.adjudicated).toBe(false);
    expect(unbound.independence.note).toMatch(/neither backward ref matches/);
  });

  test("independence: no written adjudication block → NO independence value (never provisional strong, §7a)", () => {
    // Verified cross-family hosts — the classic provisional-strong trap.
    const report = buildModelInspection({
      session_context: hostContext({ ...FOUR_HOSTS[0], trust: "verified" }),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: frozenReceiptFor("run-claude-cli"),
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.independence.adjudicated).toBe(false);
    expect(report.independence.independence).toBeNull();

    // A weak-shaped FRAGMENT is rejected exactly like a strong one — only a
    // full hash-bound §7a block (see the dedicated §7a test) is an adjudication.
    const fragment = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: frozenReceiptFor("run-claude-cli"),
      adjudication: { independence: "weak", predicate_trace: "bound_actual(P) failed" },
      flags: flagsOn(),
      now: NOW,
    });
    expect(fragment.independence.adjudicated).toBe(false);
    expect(fragment.independence.independence).toBeNull();
  });

  test("[control] a known-bad builder that copies the requested model into actual_model IS caught by these expectations (anti-vacuity)", () => {
    const knownBad = (selected: string): { finalized: boolean; actual_model: string } => ({
      finalized: false,
      actual_model: selected, // the dishonesty class under test
    });
    const bad = knownBad("powerful-model-1");
    // The same assertions the real path must satisfy reject the bad shape:
    expect(bad.actual_model === "unknown").toBe(false);
    expect(bad.actual_model).toBe("powerful-model-1"); // ≙ selection — the violation
  });

  test("inspect flag off → the surface reports disabled and exposes nothing else", () => {
    const report = buildModelInspection({
      session_context: hostContext(FOUR_HOSTS[0]),
      catalog_snapshot: catalogSnapshot(),
      policy: validPolicy(),
      receipt: frozenReceiptFor("run-claude-cli"),
      flags: flagsOn({ "model_routing.inspect": "off" }),
      now: NOW,
    });
    expect(report.state).toBe("inspect_disabled");
    expect(report.selection).toBeNull();
    expect(report.fallbacks).toBeNull();
    expect(report.catalog.state).toBe("inspect_disabled");
  });

  test("identity block is unknown-safe: malformed session context degrades, never guesses claude", () => {
    const report = buildModelInspection({
      session_context: { schema_version: "guild.session_context.v1" }, // hollow
      catalog_snapshot: null,
      policy: null,
      receipt: null,
      flags: flagsOn(),
      now: NOW,
    });
    expect(report.host).toEqual({ family: "unknown", surface: "unknown" });
    expect(report.identity).toEqual({
      source: "none",
      trust: "asserted",
      confidence: "low",
      evidence: "unknown",
    });
    expect(report.unknowns).toEqual(expect.arrayContaining(["host", "identity"]));
  });

  // ── T6-R1-F1 probes: inspection is INSPECT-ONLY (creates/appends NO file) ─

  describe("inspect-only invariant (F1)", () => {
    test("PROBE: NO inspection call touches any fs write primitive; a run dir stays byte-identical", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-inspect-pure-"));
      try {
        const runDir = path.join(tmp, "run-claude-cli");
        fs.mkdirSync(runDir, { recursive: true });
        const listTree = (dir: string): string[] => {
          const out: string[] = [];
          const walk = (d: string): void => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
              const p = path.join(d, e.name);
              out.push(p);
              if (e.isDirectory()) walk(p);
            }
          };
          walk(dir);
          return out.sort();
        };
        const before = listTree(tmp);
        const writeSpies = [
          jest.spyOn(fs, "writeFileSync"),
          jest.spyOn(fs, "appendFileSync"),
          jest.spyOn(fs, "mkdirSync"),
          jest.spyOn(fs, "renameSync"),
          jest.spyOn(fs, "openSync"),
          jest.spyOn(fs, "createWriteStream"),
          jest.spyOn(fs, "rmSync"),
          jest.spyOn(fs, "unlinkSync"),
        ];
        try {
          // Every inspection shape: ok, disabled, forged receipt, adjudicated.
          for (const receipt of [null, frozenReceiptFor("run-claude-cli"), { forged: true }]) {
            buildModelInspection({
              session_context: hostContext(FOUR_HOSTS[0]),
              catalog_snapshot: catalogSnapshot(),
              policy: validPolicy(),
              receipt,
              adjudication: { independence: "strong" },
              flags: flagsOn(),
              now: NOW,
            });
            buildModelInspection({
              session_context: hostContext(FOUR_HOSTS[0]),
              catalog_snapshot: null,
              policy: null,
              receipt,
              flags: flagsOn({ "model_routing.inspect": "off" }),
              now: NOW,
            });
          }
          for (const spy of writeSpies) expect(spy).not.toHaveBeenCalled();
        } finally {
          for (const spy of writeSpies) spy.mockRestore();
        }
        expect(listTree(tmp)).toEqual(before);
        // The classic F1 regression: no logs/v1.4-events.jsonl appears anywhere.
        expect(fs.existsSync(path.join(runDir, "logs"))).toBe(false);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });

    test("STATIC PROBE: the inspection module imports no fs/telemetry-emit surface and exports no emit function", () => {
      const src = fs.readFileSync(
        path.join(__dirname, "../../src/modules/capability/workflows/model-inspect.ts"),
        "utf8"
      );
      expect(src).not.toMatch(/from ["'](node:)?fs["']/);
      expect(src).not.toMatch(/require\(["'](node:)?fs["']\)/);
      expect(src).not.toMatch(/from ["'].*guild-trace-emit["']/);
      expect(src).not.toMatch(/export function emitInspectionTrace/);
      expect(src).not.toMatch(/emitTraceEvent\(/);
      const mod = require("../../src/modules/capability/workflows/model-inspect");
      expect("emitInspectionTrace" in mod).toBe(false);
    });
  });

  // ── Persistence is a SEPARATE binding-verified writer (never inspection) ──

  describe("persistInspectionReport (run-binding-verified, F1/F3)", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-inspect-persist-"));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test("with the run's minted binding → writes run-local inspection evidence", () => {
      const runId = "run-claude-cli";
      const binding = mintRunBinding({ root: tmp, run_id: runId });
      const report = buildModelInspection({
        session_context: hostContext(FOUR_HOSTS[0]),
        catalog_snapshot: catalogSnapshot(),
        policy: validPolicy(),
        receipt: frozenReceiptFor(runId),
        flags: flagsOn(),
        now: NOW,
      });
      const { absPath, ref } = persistInspectionReport({
        root: tmp,
        report,
        binding: { run_id: runId, binding_ref: binding.binding_ref },
        label: "T6-lane",
      });
      expect(absPath).toBe(path.join(tmp, ".guild", "runs", runId, "inspection", "T6-lane.json"));
      expect(ref).toBe(path.join("inspection", "T6-lane.json"));
      const persisted = JSON.parse(fs.readFileSync(absPath, "utf8"));
      expect(persisted.schema_version).toBe(MODEL_INSPECTION_SCHEMA);
      expect(persisted.run_id).toBe(runId);
    });

    test("PROBE (F4-class): no binding.json → BindingRejectedError, NOTHING written", () => {
      const runId = "run-claude-cli";
      const report = buildModelInspection({
        session_context: hostContext(FOUR_HOSTS[0]),
        catalog_snapshot: null,
        policy: null,
        receipt: null,
        flags: flagsOn(),
        now: NOW,
      });
      expect(() =>
        persistInspectionReport({
          root: tmp,
          report,
          binding: { run_id: runId, binding_ref: "rb-forged" },
          label: "T6-lane",
        })
      ).toThrow(BindingRejectedError);
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", runId, "inspection"))).toBe(false);
    });
  });

  // ── readRoutingFlags is exercised here as the inspection's flag source ────

  test("readRoutingFlags: ADR defaults (M0 legs on; shadow + enabled off)", () => {
    const { flags, rejects } = readRoutingFlags({});
    expect(rejects).toEqual([]);
    expect(flags).toEqual({
      "model_routing.identity_v2": "on",
      "model_routing.binding_enforce": "on",
      "model_routing.discovery": "on",
      "model_routing.inspect": "on",
      "model_routing.shadow": "off",
      "model_routing.enabled": "off",
      "teams.proposal_v2": "on",
    });
  });
});
