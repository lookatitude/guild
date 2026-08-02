/**
 * tests/integration/shadow-optin-routing.test.ts — lane T6, rework round 2
 * (run-20260730-131020-dynamic-host-model-routing).
 *
 * M1 shadow resolution + M2 opt-in wiring behind the ADR rollout flags
 * (module-map §1: dispatch shadow/opt-in wiring; ADR §Milestones).
 * Contract under test:
 *   - M1 shadow output is CONTENT-HASHED and comparable to the current
 *     (legacy) dispatch; shadow NEVER changes the dispatched model;
 *   - shadow persistence goes ONLY through the T3/T3b run-binding contract
 *     (T6-R1-F4): a run dir with no minted binding.json gets NO shadow write —
 *     basename matching is not authorization;
 *   - M2 cannot activate unless M0/M1 are evidenced by LOADED, schema/hash/
 *     run-binding-VERIFIED artifacts (T6-R1-F3): a nonexistent ref, a
 *     non-sha comparison_hash, a tampered record, or an unbound run tree is
 *     NOT evidence; there is no injectable `active` gate — with
 *     `model_routing.enabled` off, no caller value can select v2;
 *   - rollback disables v2 routing without corrupting legacy settings bytes
 *     or already-persisted run snapshots;
 *   - user prompts are deduplicated ONLY for exact
 *     (run_id, purpose, target_id, policy_hash, catalog_hash, fallback_hash)
 *     keys (model_resolution §6, via the T5 confirmation arbiter);
 *   - review-broker provenance: served evidence comes ONLY from receipts that
 *     RECOMPUTE-AND-VERIFY as finalized (T6-R1-F2) — a forged receipt and an
 *     unfinalized shadow receipt can never ground strong.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  gateM2,
  readRoutingFlags,
  rollbackV2Routing,
  ROUTING_FLAG_DEFAULTS,
  type M2EvidenceRefs,
  type RoutingFlags,
} from "../../src/modules/capability/workflows/routing-rollout";
import {
  confirmationKeyForReceipt,
  persistShadowArtifacts,
  planDispatchModel,
  runShadowResolution,
  selectDispatchModel,
  servedEvidenceFromReceipt,
  SHADOW_COMPARISON_SCHEMA,
} from "../../src/modules/dispatch/workflows/shadow-routing";
import { buildModelInspection } from "../../src/modules/capability/workflows/model-inspect";
import { persistInspectionReport } from "../../src/modules/capability/workflows/inspection-persist";
import {
  claimPrompt,
  createRunLocalState,
  recordDecision,
} from "../../src/modules/capability/workflows/confirmation-arbiter";
import {
  finalizeReceipt,
  recordAttempt,
  resolve as resolveModel,
  type ResolveInputs,
} from "../../src/modules/capability/workflows/model-resolver";
import {
  BindingRejectedError,
  mintRunBinding,
} from "../../src/modules/lifecycle/workflows/run-binding";
import {
  selfReferentialHash,
} from "../../src/modules/teams/workflows/canonical-hash";
import { planReviewPairing } from "../../src/modules/review/workflows/review-pairing";
import type { SpecialistDispatchContract } from "../../src/modules/dispatch/workflows/specialist-contract";

// ── Shared fixtures ──────────────────────────────────────────────────────────

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
      research: {
        min_effective_complexity: "hard",
        independence: "none",
        confirm_on_degradation: true,
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

function resolveInputs(runId: string, dispatchId: string): ResolveInputs {
  return {
    session_context: { target_id: "codex-cli-target" },
    catalog_snapshot: { models: CATALOG_MODELS },
    policy: validPolicy(),
    request: { purpose: "research", requested_complexity: "easy" },
    run_id: runId,
    dispatch_id: dispatchId,
  };
}

function flags(overrides?: Partial<RoutingFlags>): RoutingFlags {
  return { ...ROUTING_FLAG_DEFAULTS, ...(overrides ?? {}) };
}

const LEGACY = { model: "legacy-model-9", source: "tier_map:powerful" };

/** Persist ONE inspection report through the bound writer. Returns its run-dir-relative ref. */
function seedInspectionOnly(root: string, runId: string, bindingRef: string): string {
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
    flags: flags(),
    now: "2026-07-30T14:00:00Z",
  });
  return persistInspectionReport({
    root,
    report,
    binding: { run_id: runId, binding_ref: bindingRef },
    label: "seed",
  }).ref;
}

/**
 * Seed a REAL, verifiable evidence trail in `root` for `runId`:
 * mint the binding, persist one inspection report (M0) and one comparable
 * shadow comparison (M1) through the binding-verified writers. Returns the
 * refs gateM2 will load + verify, plus the minted nonce.
 */
function seedM2Evidence(
  root: string,
  runId: string
): { refs: M2EvidenceRefs; bindingRef: string } {
  const binding = mintRunBinding({ root, run_id: runId });
  const inspectionRef = seedInspectionOnly(root, runId, binding.binding_ref);
  const shadow = runShadowResolution({
    flags: flags({ "model_routing.shadow": "on" }),
    resolveInputs: resolveInputs(runId, "d-seed"),
    legacy: LEGACY,
  });
  const persistedShadow = persistShadowArtifacts(root, shadow, {
    run_id: runId,
    binding_ref: binding.binding_ref,
  });
  const runDir = path.join(root, ".guild", "runs", runId);
  return {
    refs: {
      root,
      run_id: runId,
      m0: { inspection_report_refs: [inspectionRef] },
      m1: {
        shadow_comparison_refs: [path.relative(runDir, persistedShadow.comparisonPath!)],
      },
    },
    bindingRef: binding.binding_ref,
  };
}

// ── Rollout flags (closed keys, ADR §Rollout flags) ─────────────────────────

describe("routing-rollout — closed-key flags + M2 gate (lane T6)", () => {
  test("explicit off always wins; explicit on is honored for opt-in legs", () => {
    const { flags: f, rejects } = readRoutingFlags({
      model_routing: { identity_v2: "off", shadow: "on", enabled: "on" },
      teams: { proposal_v2: "off" },
    });
    expect(rejects).toEqual([]);
    expect(f["model_routing.identity_v2"]).toBe("off");
    expect(f["model_routing.shadow"]).toBe("on");
    expect(f["model_routing.enabled"]).toBe("on");
    expect(f["teams.proposal_v2"]).toBe("off");
    // Untouched keys keep ADR defaults:
    expect(f["model_routing.discovery"]).toBe("on");
  });

  test("malformed values reject + fall back to the ADR default (never crash, never invent)", () => {
    const { flags: f, rejects } = readRoutingFlags({
      model_routing: { shadow: true, enabled: "yes", inspect: 1 },
    });
    expect(f["model_routing.shadow"]).toBe("off");
    expect(f["model_routing.enabled"]).toBe("off");
    expect(f["model_routing.inspect"]).toBe("on");
    expect(rejects.length).toBe(3);
    expect(rejects.join("\n")).toMatch(/model_routing\.shadow/);
  });

  test("unknown keys under model_routing are rejected (closed-key surface)", () => {
    const { rejects } = readRoutingFlags({
      model_routing: { auto_switch: "on" },
    });
    expect(rejects.join("\n")).toMatch(/unknown key.*model_routing\.auto_switch/i);
  });

  test("non-object settings → defaults, with a reject recorded for the malformed root", () => {
    const { flags: f, rejects } = readRoutingFlags("not-an-object");
    expect(f).toEqual(ROUTING_FLAG_DEFAULTS);
    expect(rejects.length).toBe(1);
  });

  describe("gateM2 — loads + verifies every evidence artifact (F3)", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-gate-"));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test("enabled off → inactive whatever the evidence says (real seeded evidence)", () => {
      const { refs } = seedM2Evidence(tmp, "run-gate-off");
      const gate = gateM2(flags(), refs);
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/model_routing\.enabled/);
    });

    test("enabled on + NO evidence refs → inactive with an honest M0 reason", () => {
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), null);
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/M0/);
    });

    test("PROBE (F3): refs=['does-not-exist'] + a comparison whose hash is 'not-a-sha' → active=false", () => {
      const runId = "run-gate-forged";
      const binding = mintRunBinding({ root: tmp, run_id: runId });
      const runDir = path.join(tmp, ".guild", "runs", runId);
      // A comparison FILE exists but its hash is not even hash-shaped:
      fs.mkdirSync(path.join(runDir, "shadow"), { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "shadow", "d-x.shadow-comparison.json"),
        JSON.stringify({
          schema_version: SHADOW_COMPARISON_SCHEMA,
          run_id: runId,
          dispatch_id: "d-x",
          shadow: { model: "m", effort: null, resolution_core_hash: null, failed_closed: null },
          legacy: { model: "legacy-model-9", source: "tier_map" },
          match: false,
          comparable: true,
          comparison_hash: "not-a-sha",
        }),
        "utf8"
      );
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), {
        root: tmp,
        run_id: runId,
        m0: { inspection_report_refs: ["does-not-exist"] },
        m1: { shadow_comparison_refs: [path.join("shadow", "d-x.shadow-comparison.json")] },
      });
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/M0 not evidenced: 0 of 1/);
      expect(binding.state).toBe("open"); // the minted binding was never the blocker
    });

    test("PROBE (F3): valid M0 but hash-shaped FORGED comparison hash → still not M1 evidence", () => {
      const runId = "run-gate-forged-hash";
      const binding = mintRunBinding({ root: tmp, run_id: runId });
      const inspectionRef = seedInspectionOnly(tmp, runId, binding.binding_ref);
      const runDir = path.join(tmp, ".guild", "runs", runId);
      fs.mkdirSync(path.join(runDir, "shadow"), { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "shadow", "d-f.shadow-comparison.json"),
        JSON.stringify({
          schema_version: SHADOW_COMPARISON_SCHEMA,
          run_id: runId,
          dispatch_id: "d-f",
          shadow: { model: "m", effort: null, resolution_core_hash: null, failed_closed: null },
          legacy: { model: "legacy-model-9", source: "tier_map" },
          match: false,
          comparable: true,
          comparison_hash: "a".repeat(64), // hash-shaped but does NOT recompute
        }),
        "utf8"
      );
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), {
        root: tmp,
        run_id: runId,
        m0: { inspection_report_refs: [inspectionRef] },
        m1: { shadow_comparison_refs: [path.join("shadow", "d-f.shadow-comparison.json")] },
      });
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/M1 not evidenced/);
    });

    test("PROBE (F3): valid M0 but TAMPERED comparison (content edited after hashing) → active=false", () => {
      const { refs } = seedM2Evidence(tmp, "run-gate-tamper");
      const runDir = path.join(tmp, ".guild", "runs", "run-gate-tamper");
      const cmpPath = path.join(runDir, refs.m1.shadow_comparison_refs[0]);
      const cmp = JSON.parse(fs.readFileSync(cmpPath, "utf8"));
      cmp.shadow.model = "attacker-model"; // content edited; stored hash now stale
      fs.writeFileSync(cmpPath, JSON.stringify(cmp), "utf8");
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), refs);
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/M1 not evidenced/);
    });

    test("PROBE (F3): a comparable:false comparison is NOT M1 evidence", () => {
      const runId = "run-gate-incomparable";
      const binding = mintRunBinding({ root: tmp, run_id: runId });
      const inspectionRef = seedInspectionOnly(tmp, runId, binding.binding_ref);
      const shadow = runShadowResolution({
        flags: flags({ "model_routing.shadow": "on" }),
        resolveInputs: {
          session_context: "sc",
          catalog_snapshot: "cat",
          policy: "not-a-policy", // fail-closed → comparable:false
          run_id: runId,
          dispatch_id: "d-fc",
        },
        legacy: LEGACY,
      });
      const persisted = persistShadowArtifacts(tmp, shadow, {
        run_id: runId,
        binding_ref: binding.binding_ref,
      });
      const runDir = path.join(tmp, ".guild", "runs", runId);
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), {
        root: tmp,
        run_id: runId,
        m0: { inspection_report_refs: [inspectionRef] },
        m1: { shadow_comparison_refs: [path.relative(runDir, persisted.comparisonPath!)] },
      });
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/M1 not evidenced/);
    });

    test("PROBE (F3): valid-LOOKING artifacts in a run tree with NO binding.json → active=false (evidence voided)", () => {
      const runId = "run-gate-unbound";
      // Build artifacts in a bound scratch run, then copy them into an
      // unbound run tree — same bytes, no minted binding.
      const seeded = seedM2Evidence(tmp, "run-gate-src");
      const srcDir = path.join(tmp, ".guild", "runs", "run-gate-src");
      const dstDir = path.join(tmp, ".guild", "runs", runId);
      fs.mkdirSync(path.join(dstDir, "inspection"), { recursive: true });
      fs.mkdirSync(path.join(dstDir, "shadow"), { recursive: true });
      for (const ref of [
        seeded.refs.m0.inspection_report_refs[0],
        seeded.refs.m1.shadow_comparison_refs[0],
      ]) {
        fs.copyFileSync(path.join(srcDir, ref), path.join(dstDir, ref));
      }
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), {
        ...seeded.refs,
        run_id: runId,
      });
      expect(gate.active).toBe(false);
      expect(gate.reason).toMatch(/binding absent/);
      expect(fs.existsSync(path.join(dstDir, "binding.json"))).toBe(false);
    });

    test("PROBE (F3): a ref escaping the run dir (../../..) is refused", () => {
      const { refs } = seedM2Evidence(tmp, "run-gate-escape");
      const sibling = gateM2(flags({ "model_routing.enabled": "on" }), {
        ...refs,
        m0: { inspection_report_refs: [path.join("..", "..", "..", "settings.json")] },
      });
      expect(sibling.active).toBe(false);
      expect(sibling.reason).toMatch(/M0 not evidenced/);
    });

    test("enabled on + verified M0 report + verified comparable M1 comparison → ACTIVE", () => {
      const { refs } = seedM2Evidence(tmp, "run-gate-ok");
      const gate = gateM2(flags({ "model_routing.enabled": "on" }), refs);
      expect(gate.active).toBe(true);
      expect(gate.reason).toMatch(/M2 active: .*1 verified inspection report.*1 verified comparable/);
    });

    test("[control] anti-vacuity: the same verified evidence with enabled off stays inactive", () => {
      const { refs } = seedM2Evidence(tmp, "run-gate-control");
      expect(gateM2(flags(), refs).active).toBe(false);
    });
  });

  test("rollbackV2Routing is pure: flips shadow+enabled off, touches nothing else", () => {
    const before = flags({ "model_routing.shadow": "on", "model_routing.enabled": "on" });
    const frozen = Object.freeze({ ...before });
    const after = rollbackV2Routing(frozen);
    expect(after["model_routing.shadow"]).toBe("off");
    expect(after["model_routing.enabled"]).toBe("off");
    expect(after["model_routing.identity_v2"]).toBe(before["model_routing.identity_v2"]);
    // Input untouched (pure — a rollback never rewrites bytes):
    expect(frozen["model_routing.shadow"]).toBe("on");
  });
});

// ── M1 shadow resolution ─────────────────────────────────────────────────────

describe("shadow-routing — M1 shadow resolution (content-hashed, comparable, no dispatch effect)", () => {
  test("shadow flag off → does not run, legacy selection untouched", () => {
    const out = runShadowResolution({
      flags: flags(),
      resolveInputs: resolveInputs("run-s1", "d-s1"),
      legacy: LEGACY,
    });
    expect(out.ran).toBe(false);
    expect(out.reason).toMatch(/model_routing\.shadow/);
    expect(out.receipt).toBeUndefined();
    expect(out.comparison).toBeUndefined();
  });

  test("shadow on → content-hashed receipt + comparison record; legacy input NEVER modified", () => {
    const legacyFrozen = Object.freeze({ ...LEGACY });
    const out = runShadowResolution({
      flags: flags({ "model_routing.shadow": "on" }),
      resolveInputs: resolveInputs("run-s2", "d-s2"),
      legacy: legacyFrozen,
    });
    expect(out.ran).toBe(true);
    expect(out.receipt?.resolution_core_hash).toMatch(/^[0-9a-f]{64}$/);
    const cmp = out.comparison!;
    expect(cmp.schema_version).toBe(SHADOW_COMPARISON_SCHEMA);
    expect(cmp.run_id).toBe("run-s2");
    expect(cmp.dispatch_id).toBe("d-s2");
    expect(cmp.shadow.model).toBe("powerful-model-1");
    expect(cmp.legacy.model).toBe("legacy-model-9");
    expect(cmp.match).toBe(false);
    expect(cmp.comparable).toBe(true);
    // Content-hash is the canonical self-referential hash (team-contracts §1):
    const { comparison_hash, ...rest } = cmp as unknown as Record<string, unknown>;
    expect(comparison_hash).toBe(
      selfReferentialHash({ ...rest, comparison_hash: "x" }, "comparison_hash")
    );
    // Deterministic: same inputs → same hashes (comparable across runs of the tool).
    const again = runShadowResolution({
      flags: flags({ "model_routing.shadow": "on" }),
      resolveInputs: resolveInputs("run-s2", "d-s2"),
      legacy: LEGACY,
    });
    expect(again.comparison!.comparison_hash).toBe(cmp.comparison_hash);
    expect(again.receipt!.resolution_core_hash).toBe(out.receipt!.resolution_core_hash);
  });

  test("matching legacy/shadow selection → match true", () => {
    const out = runShadowResolution({
      flags: flags({ "model_routing.shadow": "on" }),
      resolveInputs: resolveInputs("run-s3", "d-s3"),
      legacy: { model: "powerful-model-1", source: "tier_map:powerful" },
    });
    expect(out.comparison!.match).toBe(true);
  });

  test("shadow resolver fail-closed → comparable false, honest reason, still no dispatch effect", () => {
    const out = runShadowResolution({
      flags: flags({ "model_routing.shadow": "on" }),
      resolveInputs: {
        session_context: "sc",
        catalog_snapshot: "cat",
        policy: "not-a-policy", // unparsable → resolver fails closed
        run_id: "run-s4",
        dispatch_id: "d-s4",
      },
      legacy: LEGACY,
    });
    expect(out.ran).toBe(true);
    expect(out.comparison!.comparable).toBe(false);
    expect(out.comparison!.match).toBe(false);
    expect(out.comparison!.shadow.model).toBeNull();
    expect(out.comparison!.shadow.failed_closed).toBeTruthy();
  });

  describe("persistence (run-binding-authorized, run-local, snapshot-safe — F4)", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-shadow-"));
    });
    afterEach(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    test("with the run's minted binding → writes receipt+comparison under the run's own shadow/ atomically", () => {
      const binding = mintRunBinding({ root: tmp, run_id: "run-s2" });
      const out = runShadowResolution({
        flags: flags({ "model_routing.shadow": "on" }),
        resolveInputs: resolveInputs("run-s2", "d-s2"),
        legacy: LEGACY,
      });
      const paths = persistShadowArtifacts(tmp, out, {
        run_id: "run-s2",
        binding_ref: binding.binding_ref,
      });
      const runDir = path.join(tmp, ".guild", "runs", "run-s2");
      expect(paths.receiptPath).toBe(path.join(runDir, "shadow", "d-s2.shadow-receipt.json"));
      expect(paths.comparisonPath).toBe(
        path.join(runDir, "shadow", "d-s2.shadow-comparison.json")
      );
      expect(fs.existsSync(paths.receiptPath!)).toBe(true);
      expect(fs.existsSync(paths.comparisonPath!)).toBe(true);
      // No temp litter; nothing outside shadow/ touched (resolution/ untouched):
      expect(fs.readdirSync(path.join(runDir, "shadow")).filter((f) => f.includes(".tmp-"))).toEqual([]);
      expect(fs.existsSync(path.join(runDir, "resolution"))).toBe(false);
    });

    test("PROBE (F4): run dir with NO binding.json → shadow writes REJECTED (BindingRejectedError), nothing written", () => {
      const out = runShadowResolution({
        flags: flags({ "model_routing.shadow": "on" }),
        resolveInputs: resolveInputs("run-nobind", "d-nb"),
        legacy: LEGACY,
      });
      expect(() =>
        persistShadowArtifacts(tmp, out, { run_id: "run-nobind", binding_ref: "rb-anything" })
      ).toThrow(BindingRejectedError);
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-nobind", "shadow"))).toBe(false);
    });

    test("PROBE (F4): a WRONG nonce for a minted run → rejected (binding_mismatch), nothing written", () => {
      mintRunBinding({ root: tmp, run_id: "run-wrongnonce" });
      const out = runShadowResolution({
        flags: flags({ "model_routing.shadow": "on" }),
        resolveInputs: resolveInputs("run-wrongnonce", "d-wn"),
        legacy: LEGACY,
      });
      expect(() =>
        persistShadowArtifacts(tmp, out, {
          run_id: "run-wrongnonce",
          binding_ref: "rb-forged-nonce",
        })
      ).toThrow(/binding_mismatch/);
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-wrongnonce", "shadow"))).toBe(false);
    });

    test("PROBE (F4): a receipt bound to a DIFFERENT run than the envelope → refused before verification", () => {
      const binding = mintRunBinding({ root: tmp, run_id: "run-envelope" });
      const out = runShadowResolution({
        flags: flags({ "model_routing.shadow": "on" }),
        resolveInputs: resolveInputs("run-OTHER", "d-o"),
        legacy: LEGACY,
      });
      expect(() =>
        persistShadowArtifacts(tmp, out, {
          run_id: "run-envelope",
          binding_ref: binding.binding_ref,
        })
      ).toThrow(/run_binding_mismatch/);
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-envelope", "shadow"))).toBe(false);
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-OTHER", "shadow"))).toBe(false);
    });

    test("not-ran shadow persists nothing (and performs no binding check it doesn't need)", () => {
      const out = runShadowResolution({
        flags: flags(),
        resolveInputs: resolveInputs("run-s1", "d-s1"),
        legacy: LEGACY,
      });
      const paths = persistShadowArtifacts(tmp, out, { run_id: "run-s1", binding_ref: "rb-x" });
      expect(paths.receiptPath).toBeNull();
      expect(paths.comparisonPath).toBeNull();
      expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-s1"))).toBe(false);
    });
  });
});

// ── M2 opt-in selection + rollback ───────────────────────────────────────────

describe("shadow-routing — M2 opt-in selection behind the verified gate (reversible)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t6-m2-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("PROBE (F3): flag off + VERIFIED evidence on record → source legacy (no injectable gate exists)", () => {
    const { refs } = seedM2Evidence(tmp, "run-m2a");
    const sel = selectDispatchModel({
      flags: flags(), // enabled off
      m2Evidence: refs,
      resolveInputs: resolveInputs("run-m2a", "d-m2a"),
      legacy: LEGACY,
    });
    expect(sel.source).toBe("legacy");
    expect(sel.model).toBe("legacy-model-9");
    expect(sel.receipt).toBeUndefined();
    expect(sel.reason).toMatch(/model_routing\.enabled is off/);
  });

  test("gate un-evidenced → source legacy even with enabled on", () => {
    const sel = selectDispatchModel({
      flags: flags({ "model_routing.enabled": "on" }),
      m2Evidence: null,
      resolveInputs: resolveInputs("run-m2b", "d-m2b"),
      legacy: LEGACY,
    });
    expect(sel.source).toBe("legacy");
    expect(sel.model).toBe("legacy-model-9");
    expect(sel.reason).toMatch(/M0/);
  });

  test("gate ACTIVE (verified evidence) → source v2, model from the frozen receipt selection + provenance hashes", () => {
    const { refs } = seedM2Evidence(tmp, "run-m2c");
    const sel = selectDispatchModel({
      flags: flags({ "model_routing.enabled": "on" }),
      m2Evidence: refs,
      resolveInputs: resolveInputs("run-m2c", "d-m2c"),
      legacy: LEGACY,
    });
    expect(sel.source).toBe("v2");
    expect(sel.model).toBe("powerful-model-1");
    expect(sel.dispatch_id).toBe("d-m2c");
    expect(sel.resolution_core_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sel.receipt?.fallbacks?.length).toBeGreaterThan(0);
  });

  test("gate ACTIVE but resolver fails closed → legacy with the fail-closed reason (never an invented model)", () => {
    const { refs } = seedM2Evidence(tmp, "run-m2d");
    const sel = selectDispatchModel({
      flags: flags({ "model_routing.enabled": "on" }),
      m2Evidence: refs,
      resolveInputs: {
        session_context: "sc",
        catalog_snapshot: "cat",
        policy: "not-a-policy",
        run_id: "run-m2d",
        dispatch_id: "d-m2d",
      },
      legacy: LEGACY,
    });
    expect(sel.source).toBe("legacy");
    expect(sel.model).toBe("legacy-model-9");
    expect(sel.reason).toMatch(/fail.?closed|policy_unparsable/i);
  });

  test("ROLLBACK DRILL: flags off → selection identical to pure legacy; legacy settings bytes + persisted snapshots intact", () => {
    // A legacy settings file that MUST survive byte-identical:
    const settingsPath = path.join(tmp, "settings.json");
    const legacyBytes = JSON.stringify(
      { defaults: { tier_map: { powerful: "legacy-model-9" } } },
      null,
      2
    );
    fs.writeFileSync(settingsPath, legacyBytes, "utf8");

    // Active v2 run persists shadow snapshots through the bound writer:
    const { refs, bindingRef } = seedM2Evidence(tmp, "run-rb");
    const active = flags({ "model_routing.shadow": "on", "model_routing.enabled": "on" });
    const shadow = runShadowResolution({
      flags: active,
      resolveInputs: resolveInputs("run-rb", "d-rb"),
      legacy: LEGACY,
    });
    const persisted = persistShadowArtifacts(tmp, shadow, {
      run_id: "run-rb",
      binding_ref: bindingRef,
    });
    const snapshotBytes = fs.readFileSync(persisted.receiptPath!, "utf8");

    // Roll back:
    const rolledBack = rollbackV2Routing(active);
    const afterPlan = planDispatchModel({
      flags: rolledBack,
      m2Evidence: refs,
      resolveInputs: resolveInputs("run-rb", "d-rb2"),
      legacy: LEGACY,
    });
    // v2 routing disabled: selection is legacy, shadow does not run.
    expect(afterPlan.selection.source).toBe("legacy");
    expect(afterPlan.selection.model).toBe("legacy-model-9");
    expect(afterPlan.shadow.ran).toBe(false);
    // Pure-legacy reference run (flags never on) selects identically:
    const pureLegacy = planDispatchModel({
      flags: flags(),
      m2Evidence: null,
      resolveInputs: resolveInputs("run-rb", "d-rb2"),
      legacy: LEGACY,
    });
    expect(afterPlan.selection.model).toBe(pureLegacy.selection.model);
    expect(afterPlan.selection.source).toBe(pureLegacy.selection.source);
    // Legacy settings bytes untouched; persisted snapshot untouched + parseable:
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(legacyBytes);
    expect(fs.readFileSync(persisted.receiptPath!, "utf8")).toBe(snapshotBytes);
  });

  test("planDispatchModel: shadow (M1) runs alongside a LEGACY selection without touching it (no automatic switch)", () => {
    const f = flags({ "model_routing.shadow": "on" }); // shadow on, M2 off
    const out = planDispatchModel({
      flags: f,
      m2Evidence: null,
      resolveInputs: resolveInputs("run-pd", "d-pd"),
      legacy: LEGACY,
    });
    expect(out.shadow.ran).toBe(true);
    expect(out.shadow.comparison!.shadow.model).toBe("powerful-model-1");
    expect(out.selection.source).toBe("legacy");
    expect(out.selection.model).toBe("legacy-model-9"); // shadow disagreement changed NOTHING
    // Provenance for the specialist contract is additive + optional:
    const contract: SpecialistDispatchContract = {
      name: "backend",
      scope: "lane",
      dependsOn: [],
      modelProvenance: {
        source: "legacy",
        shadow_comparison_hash: out.shadow.comparison!.comparison_hash,
      },
    };
    expect(contract.modelProvenance?.source).toBe("legacy");
  });
});

// ── §6 exact-key prompt dedup wiring ─────────────────────────────────────────

describe("shadow-routing — exact-key confirmation wiring (model_resolution §6)", () => {
  test("confirmationKeyForReceipt builds the exact 6-tuple from the frozen receipt", () => {
    const receipt = resolveModel(resolveInputs("run-k1", "d-k1"));
    const key = confirmationKeyForReceipt(receipt);
    expect(key).toEqual({
      run_id: "run-k1",
      purpose: "research",
      target_id: "codex-cli-target",
      policy_hash: (receipt.refs as any).policy.sha256,
      catalog_hash: (receipt.refs as any).catalog_snapshot.sha256,
      fallback_hash: receipt.fallback_hash,
    });
  });

  test("byte-identical keys share ONE prompt; any differing component gets its own; decisions never leak", () => {
    const state = createRunLocalState("run-k1");
    const a = resolveModel(resolveInputs("run-k1", "d-a"));
    const b = resolveModel(resolveInputs("run-k1", "d-b")); // same tuple, different dispatch
    const keyA = confirmationKeyForReceipt(a);
    const keyB = confirmationKeyForReceipt(b);
    const pa = claimPrompt(state, keyA);
    const pb = claimPrompt(state, keyB);
    expect(pa.prompt_id).toBe(pb.prompt_id); // deduped: exact same 6-tuple

    // A different fallback_hash is a DIFFERENT question:
    const keyC = { ...keyA, fallback_hash: "f".repeat(64) };
    expect(claimPrompt(state, keyC).prompt_id).not.toBe(pa.prompt_id);

    // One decision for the shared key; contradiction throws:
    recordDecision(state, keyA, { decision: "approve", at: "2026-07-30T14:00:00Z" });
    expect(claimPrompt(state, keyB).already_decided).toBe(true);
    expect(() => recordDecision(state, keyB, { decision: "decline" })).toThrow(
      /contradictory_decision/
    );
  });
});

// ── Review-broker provenance (T5 opens_for → T6) ─────────────────────────────

describe("shadow-routing — served evidence for the review broker (verified finalized receipts only)", () => {
  test("unfinalized receipt → null (an unfinalized receipt proves nothing, §8)", () => {
    const receipt = resolveModel(resolveInputs("run-e1", "d-e1"));
    expect(servedEvidenceFromReceipt(receipt, CATALOG_MODELS)).toBeNull();
  });

  test("PROBE (F2): a FORGED finalized receipt (64-zero receipt_hash, fabricated served gpt model) → null, never evidence", () => {
    const forged = {
      ...resolveModel(resolveInputs("run-ef", "d-ef")),
      outcome: {
        attempted: [],
        actual_model: "gpt-5.6",
        status: "served",
      },
      finalized_at: "2026-07-30T14:00:00Z",
      receipt_hash: "0".repeat(64),
    } as any;
    expect(servedEvidenceFromReceipt(forged, CATALOG_MODELS)).toBeNull();
  });

  test("finalized served receipt → evidence with the SERVED model's catalog family", () => {
    let receipt = resolveModel(resolveInputs("run-e2", "d-e2"));
    receipt = recordAttempt(receipt, {
      model: "powerful-model-1",
      effort: null,
      result: "served",
      failure_class: null,
      substitution_class: "none",
      actual_model: "powerful-model-1",
    });
    receipt = finalizeReceipt(receipt, { status: "served", at: "2026-07-30T14:00:00Z" });
    const ev = servedEvidenceFromReceipt(receipt, CATALOG_MODELS);
    expect(ev).toEqual({
      served_model: "powerful-model-1",
      served_model_family: "acme",
      finalized: true,
      status: "served",
    });
  });

  test("served model missing from the frozen snapshot → family 'unknown' (never derived from the requested model)", () => {
    let receipt = resolveModel(resolveInputs("run-e3", "d-e3"));
    receipt = recordAttempt(receipt, {
      model: "powerful-model-1",
      effort: null,
      result: "served",
      failure_class: null,
      substitution_class: "provider_server_fallback",
      actual_model: "mystery-served-model",
    });
    receipt = finalizeReceipt(receipt, { status: "served", at: "2026-07-30T14:00:00Z" });
    const ev = servedEvidenceFromReceipt(receipt, CATALOG_MODELS);
    expect(ev?.served_model).toBe("mystery-served-model");
    expect(ev?.served_model_family).toBe("unknown");
  });

  test("integration: finalized cross-family served evidence grounds strong; shadow-only (unfinalized) stays weak", () => {
    // Producer (claude host) served a claude-family model; reviewer (codex host)
    // served a gpt-family model — both finalized: strong is achievable.
    const strongPlan = planReviewPairing({
      authorHost: "claude-code-cli",
      reviewerHost: "codex-cli",
      policyAllowsSkip: true,
      reviewerAvailable: true,
      authorTrust: "verified",
      reviewerTrust: "verified",
      authorServed: {
        served_model: "claude-opus-5",
        served_model_family: "claude",
        finalized: true,
        status: "served",
      },
      reviewerServed: {
        served_model: "gpt-5.6",
        served_model_family: "gpt",
        finalized: true,
        status: "served",
      },
    } as any);
    expect(strongPlan.independence).toBe("strong");

    // Same pairing but the reviewer evidence comes from an UNFINALIZED shadow
    // receipt → servedEvidenceFromReceipt yields null → weak, mechanically.
    const shadowReceipt = resolveModel(resolveInputs("run-e4", "d-e4"));
    const shadowEvidence = servedEvidenceFromReceipt(shadowReceipt, CATALOG_MODELS);
    expect(shadowEvidence).toBeNull();
    const weakPlan = planReviewPairing({
      authorHost: "claude-code-cli",
      reviewerHost: "codex-cli",
      policyAllowsSkip: true,
      reviewerAvailable: true,
      authorTrust: "verified",
      reviewerTrust: "verified",
      authorServed: {
        served_model: "claude-opus-5",
        served_model_family: "claude",
        finalized: true,
        status: "served",
      },
      reviewerServed: shadowEvidence ?? undefined,
    } as any);
    expect(weakPlan.independence).toBe("weak");
  });
});
