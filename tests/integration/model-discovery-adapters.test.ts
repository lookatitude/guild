/**
 * tests/integration/model-discovery-adapters.test.ts — lane T4
 * (run-20260730-131020-dynamic-host-model-routing).
 *
 * REAL-PATH adapter verification: the Codex fixtures are the live captures
 * from the run's T0 evidence ([P1]/[P2] `codex debug models`, [P3] app-server
 * `model/list`), scrubbed to the catalog payload only — not hand-authored
 * shapes. The Claude/OpenAI API fixtures are transcribed from the documented
 * response schemas (no authenticated call exists in the evidence base; marked
 * doc-derived).
 */

import * as fs from "fs";
import * as path from "path";

import {
  DiscoveryIo,
  RawDiscoveryResult,
  fingerprintOrUnknown,
  nullIo,
  runAdapter,
} from "../../src/modules/host-runtime/workflows/model-discovery/adapter-contract";
import {
  codexAppServerAdapter,
  parseModelListResult,
  normalizeAppServerModels,
} from "../../src/modules/host-runtime/workflows/model-discovery/codex-app-server";
import {
  codexDebugModelsAdapter,
  parseDebugModelsOutput,
  normalizeDebugModels,
} from "../../src/modules/host-runtime/workflows/model-discovery/codex-debug-models";
import {
  claudeApiAdapter,
} from "../../src/modules/host-runtime/workflows/model-discovery/claude-api";
import {
  openAiApiAdapter,
  openAiFamilyFor,
} from "../../src/modules/host-runtime/workflows/model-discovery/openai-api";
import {
  makeHonestUnknownAdapter,
} from "../../src/modules/host-runtime/workflows/model-discovery/honest-unknown";
import {
  CODEX_SEAM_PREFERENCE,
  DISCOVERY_ADAPTER_REGISTRY,
  adapterForTarget,
  discoverCodexModels,
} from "../../src/modules/host-runtime/workflows/model-discovery";
import {
  CatalogTarget,
  LISTING_AUTHORITY,
  appendEvidenceEvent,
  evidenceStateForListing,
  normalizeDiscovery,
} from "../../src/modules/capability/workflows/model-catalog";

const FIXTURES = path.join(__dirname, "fixtures");
const NOW = "2026-07-30T13:13:34Z";

function fixtureJson(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

function io(overrides: Partial<DiscoveryIo> = {}): DiscoveryIo {
  let tick = 0;
  return { nowIso: () => NOW, monotonicMs: () => tick++, ...overrides };
}

function target(targetId: string, overrides: Partial<CatalogTarget> = {}): CatalogTarget {
  return {
    target_id: targetId,
    family: targetId.startsWith("codex") || targetId === "openai-api" ? "codex" : "claude",
    surface: "cli",
    provider_kind: "chatgpt_subscription",
    auth_mode: "subscription",
    account_fingerprint: "fp-acct-test",
    endpoint_fingerprint: "fp-endp-test",
    org_fingerprint: "unknown",
    tool_version: "codex-cli 0.146.0",
    adapter_id: "set-by-normalize",
    adapter_version: "set-by-normalize",
    ...overrides,
  };
}

// ── Codex app-server model/list — REAL [P3] capture ─────────────────────────

describe("codex-app-server adapter (live [P3] capture)", () => {
  const result = fixtureJson("codex-app-server-model-list.result.json");

  test("parses the live capture and preserves provider order + effort order verbatim", () => {
    const models = normalizeAppServerModels(parseModelListResult(result));
    expect(models.map((m) => m.canonical_id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ]);
    expect(models[0].reasoning_efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
    expect(models[2].reasoning_efforts).toEqual(["low", "medium", "high", "xhigh", "max"]); // luna: no ultra
    expect(models[0].provider_default).toBe(true); // isDefault on sol
    expect(models[0].default_effort).toBe("low");
  });

  test("preserves upgrade/deprecation metadata and modality-derived capabilities", () => {
    const models = normalizeAppServerModels(parseModelListResult(result));
    const gpt54 = models.find((m) => m.canonical_id === "gpt-5.4")!;
    expect(gpt54.deprecation.upgrade_to).toBe("gpt-5.6-terra");
    expect(gpt54.deprecation.migration_note).toContain("deprecated");
    const spark = models.find((m) => m.canonical_id === "gpt-5.3-codex-spark")!;
    expect(spark.capabilities.image_input).toBe(false); // text-only modalities
    expect(models[0].capabilities.image_input).toBe(true);
    expect(models[0].capabilities.service_tiers).toEqual(["priority"]);
  });

  test("normalizes to a guild.model_catalog.v1 snapshot: advertised (never available), indexed, tiered", async () => {
    const raw = await runAdapter(
      codexAppServerAdapter,
      io({ jsonRpcCall: async () => result }),
      { toolVersion: "0.146.0" }
    );
    expect(raw.status).toBe("ok");
    const snap = normalizeDiscovery(raw, {
      target: target("codex-app-server", { surface: "app" }),
      discoveredAt: NOW,
      generation: 1,
    });
    expect(snap.schema_version).toBe("guild.model_catalog.v1");
    expect(snap.models.map((m) => m.catalog_index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const m of snap.models) {
      expect(m.evidence.state).toBe("advertised"); // entitlement semantics undefined
      expect(m.evidence.state).not.toBe("available");
      expect(m.evidence.confidence).toBe("high"); // authenticated native list
    }
    const byId = Object.fromEntries(snap.models.map((m) => [m.canonical_id, m.tier]));
    expect(byId["gpt-5.6-sol"]).toBe("powerful");
    expect(byId["gpt-5.6-terra"]).toBe("mid");
    expect(byId["gpt-5.6-luna"]).toBe("cheap");
    expect(byId["gpt-5.3-codex-spark"]).toBe("cheap");
  });

  test("tool-version gate: out-of-range codex version resolves honest unsupported", async () => {
    const raw = await runAdapter(codexAppServerAdapter, io({ jsonRpcCall: async () => result }), {
      toolVersion: "0.120.0",
    });
    expect(raw.status).toBe("unsupported");
    expect(raw.failure_reason).toBe("tool_version_out_of_range");
    expect(raw.models).toEqual([]);
  });

  test("malformed provider output is rejected with the redacted parse_rejected class (no raw bytes)", async () => {
    const evil = { data: [{ model: 42, SECRET_MARKER: "sk-DO-NOT-ECHO" }] };
    const raw = await runAdapter(codexAppServerAdapter, io({ jsonRpcCall: async () => evil }), {
      toolVersion: "0.146.0",
    });
    expect(raw.status).toBe("error");
    expect(raw.failure_reason).toBe("parse_rejected");
    expect(JSON.stringify(raw)).not.toContain("sk-DO-NOT-ECHO"); // provider bytes never surface
  });

  test("budget timeout normalizes to an honest timeout receipt", async () => {
    const never = new Promise<never>(() => undefined);
    const raw = await runAdapter(codexAppServerAdapter, io({ jsonRpcCall: () => never }), {
      toolVersion: "0.146.0",
      budgetMs: 20,
    });
    expect(raw.status).toBe("timeout");
    expect(raw.failure_reason).toBe("timeout_budget_exceeded");
    expect(raw.models).toEqual([]);
  });

  test("absent IO seam resolves honest unsupported (no network fallback exists)", async () => {
    const raw = await runAdapter(codexAppServerAdapter, nullIo(), { toolVersion: "0.146.0" });
    expect(raw.status).toBe("unsupported");
    expect(raw.failure_reason).toBe("io_unavailable");
  });
});

// ── Codex debug models — REAL [P1]/[P2] capture ──────────────────────────────

describe("codex-debug-models adapter (live [P1]/[P2] capture)", () => {
  const stdout = fs.readFileSync(path.join(FIXTURES, "codex-debug-models.json"), "utf8");

  test("parses the live catalog: order, efforts, visibility, priority, supported_in_api metadata", () => {
    const models = normalizeDebugModels(parseDebugModelsOutput(stdout));
    expect(models.map((m) => m.canonical_id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
      "codex-auto-review",
    ]);
    const spark = models.find((m) => m.canonical_id === "gpt-5.3-codex-spark")!;
    expect(spark.capabilities.supported_in_api).toBe(false); // advertised metadata, preserved
    const autoReview = models.find((m) => m.canonical_id === "codex-auto-review")!;
    expect(autoReview.visibility).toBe("hidden");
    expect(models[0].provider_priority).toBe(1);
    expect(models[0].reasoning_efforts).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  test("normalized snapshot is advertised-only; spark's supported_in_api=false is NOT unavailable evidence", async () => {
    const raw = await runAdapter(
      codexDebugModelsAdapter,
      io({ execCapture: async () => ({ stdout }) }),
      { toolVersion: "0.146.0" }
    );
    const snap = normalizeDiscovery(raw, {
      target: target("codex-cli-chatgpt"),
      discoveredAt: NOW,
      generation: 1,
    });
    for (const m of snap.models) {
      expect(m.evidence.state).toBe("advertised");
    }
    const spark = snap.models.find((m) => m.canonical_id === "gpt-5.3-codex-spark")!;
    expect(spark.evidence.state).toBe("advertised"); // never projected onto the API target
  });

  test("versioned parser seam: 0.147+ (unevidenced shape) resolves honest unsupported", async () => {
    const raw = await runAdapter(codexDebugModelsAdapter, io({ execCapture: async () => ({ stdout }) }), {
      toolVersion: "0.147.0",
    });
    expect(raw.status).toBe("unsupported");
    expect(raw.failure_reason).toBe("tool_version_out_of_range");
  });
});

// ── Claude API /v1/models — doc-derived schema fixture ([C2]) ────────────────

describe("claude-api adapter (documented schema fixture — no live capture exists)", () => {
  // Transcribed from the documented GET /v1/models response schema ([C2]),
  // including per-model effort support flags. Doc-derived, NOT a live capture.
  const page = {
    data: [
      {
        id: "claude-fable-5",
        display_name: "Claude Fable 5",
        created_at: "2026-06-01T00:00:00Z",
        type: "model",
        capabilities: {
          batch: true,
          citations: true,
          code_execution: true,
          effort: { low: true, medium: true, high: true, xhigh: true, max: true },
          image_input: true,
          pdf_input: true,
          structured_outputs: true,
          thinking: { adaptive: true, enabled: true },
        },
      },
      {
        id: "claude-haiku-4-5-20251001",
        display_name: "Claude Haiku 4.5",
        created_at: "2025-10-01T00:00:00Z",
        type: "model",
        capabilities: {
          batch: true,
          effort: { low: true, medium: true, high: true, xhigh: false, max: false },
          image_input: true,
          structured_outputs: true,
        },
      },
    ],
    has_more: false,
    first_id: "claude-fable-5",
    last_id: "claude-haiku-4-5-20251001",
  };

  test("the availability-contract row grounds `available` for claude-api ONLY, with effort flags consumed", async () => {
    const raw = await runAdapter(claudeApiAdapter, io({ httpGetJson: async () => page }));
    expect(raw.status).toBe("ok");
    const snap = normalizeDiscovery(raw, {
      target: target("claude-api", {
        family: "claude",
        surface: "api",
        provider_kind: "anthropic_api",
        auth_mode: "api_key",
        tool_version: "claude-cli 2.1.220",
      }),
      discoveredAt: NOW,
      generation: 1,
    });
    const fable = snap.models.find((m) => m.canonical_id === "claude-fable-5")!;
    expect(fable.evidence.state).toBe("available"); // contract states API availability
    expect(fable.reasoning_efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(fable.tier).toBe("powerful");
    const haiku = snap.models.find((m) => m.canonical_id === "claude-haiku-4-5-20251001")!;
    expect(haiku.reasoning_efforts).toEqual(["low", "medium", "high"]); // false flags excluded
    expect(haiku.tier).toBe("cheap");
  });

  test("a claude-api snapshot can never be normalized under another target (projection guard)", async () => {
    const raw = await runAdapter(claudeApiAdapter, io({ httpGetJson: async () => page }));
    expect(() =>
      normalizeDiscovery(raw, {
        target: target("claude-cli-subscription"),
        discoveredAt: NOW,
        generation: 1,
      })
    ).toThrow(/does not match/);
  });

  test("bounded pagination follows has_more without looping unbounded", async () => {
    let calls = 0;
    const pagedIo = io({
      httpGetJson: async () => {
        calls += 1;
        // Always claims more pages: adapter must stop at its page cap.
        return { data: [{ id: `claude-fable-${calls}` }], has_more: true, last_id: `claude-fable-${calls}` };
      },
    });
    const raw = await runAdapter(claudeApiAdapter, pagedIo);
    expect(raw.status).toBe("partial"); // honest partial at the cap
    expect(calls).toBeLessThanOrEqual(5);
  });
});

// ── OpenAI API /v1/models — doc-derived schema fixture ([C11]) ───────────────

describe("openai-api adapter (documented schema fixture)", () => {
  const page = {
    object: "list",
    data: [
      { id: "gpt-5.6-sol", object: "model", created: 1780000000, owned_by: "system" },
      { id: "davinci-002", object: "model", created: 1690000000, owned_by: "openai" },
    ],
  };

  test("metadata-poor listing emits advertised (scope-ambiguous contract), never available", async () => {
    const raw = await runAdapter(openAiApiAdapter, io({ httpGetJson: async () => page }));
    const snap = normalizeDiscovery(raw, {
      target: target("openai-api", { surface: "api", provider_kind: "openai_api", auth_mode: "api_key" }),
      discoveredAt: NOW,
      generation: 1,
    });
    for (const m of snap.models) {
      expect(m.evidence.state).toBe("advertised");
      expect(m.reasoning_efforts).toEqual([]); // never copied from other targets
    }
    expect(snap.models[0].model_family).toBe("gpt");
    expect(snap.models[1].model_family).toBe("unknown"); // unmapped stays unknown
    expect(openAiFamilyFor("davinci-002")).toBe("unknown");
  });
});

// ── Honest-unknown targets + registry ────────────────────────────────────────

describe("honest-unknown adapters + registry coverage", () => {
  test("every §2 primary target has a registered adapter; unknown targets resolve null", () => {
    expect(Object.keys(DISCOVERY_ADAPTER_REGISTRY).sort()).toEqual(
      [
        "claude-api",
        "claude-app",
        "claude-cli-subscription",
        "claude-gateway-bedrock",
        "claude-gateway-foundry",
        "claude-gateway-vertex",
        "claude-web",
        "codex-app-server",
        "codex-cli-api-key",
        "codex-cli-chatgpt",
        "openai-api",
      ].sort()
    );
    expect(adapterForTarget("not-a-target")).toBeNull();
  });

  test.each([
    "claude-cli-subscription",
    "claude-app",
    "claude-web",
    "claude-gateway-bedrock",
    "claude-gateway-vertex",
    "claude-gateway-foundry",
    "codex-cli-api-key",
  ])("%s resolves an honest unsupported receipt with zero models", async (targetId) => {
    const raw: RawDiscoveryResult = await runAdapter(adapterForTarget(targetId)!, nullIo());
    expect(raw.status).toBe("unsupported");
    expect(raw.failure_reason).toBe("surface_absent");
    expect(raw.models).toEqual([]);
    const snap = normalizeDiscovery(raw, {
      target: target(targetId),
      discoveredAt: NOW,
      generation: 1,
    });
    expect(snap.models).toEqual([]); // target evidence posture stays honest unknown
  });

  test("static hints fill metadata as advertised(low) and can NEVER become available", async () => {
    const adapter = makeHonestUnknownAdapter("claude-gateway-bedrock", {
      staticHints: [{ canonical_id: "claude-opus-4-8", model_family: "claude" }],
    });
    const raw = await runAdapter(adapter, nullIo());
    const snap = normalizeDiscovery(raw, {
      target: target("claude-gateway-bedrock", { provider_kind: "gateway_bedrock" }),
      discoveredAt: NOW,
      generation: 1,
    });
    expect(snap.models).toHaveLength(1);
    expect(snap.models[0].evidence.state).toBe("advertised");
    expect(snap.models[0].evidence.confidence).toBe("low");
    expect(snap.models[0].evidence.state).not.toBe("available");
  });
});

// ── Row-keyed listing authority: no adapter can out-promote its row ─────────
// Permanent regression probes for G-lane findings T4-R1-001 / T4-R1-002: the
// round-1 defect let an adapter-supplied contract_states_availability=true
// promote ANY authenticated source (picker, native_list) to `available`.

/** A forged RawDiscoveryResult claiming availability the row cannot ground. */
function forgedListing(
  targetId: string,
  adapterId: string,
  method: RawDiscoveryResult["method"],
  evidenceSource: string
): RawDiscoveryResult {
  return {
    adapter_id: adapterId,
    adapter_version: "1.0.0",
    target_id: targetId,
    method,
    source_ref: "forged availability probe",
    status: "ok",
    latency_ms: 1,
    failure_reason: null,
    models: [
      {
        canonical_id: "claude-fable-5",
        evidence_source: evidenceSource as never,
        contract_states_availability: true, // the forged caller-controlled flag
      },
    ],
  };
}

describe("listing authority is row-keyed and closed (T4-R1-001 / T4-R1-002 probes, permanent)", () => {
  test("REGRESSION (T4-R1-001): a claude-cli-subscription picker listing can NEVER produce available, even with a forged true flag", () => {
    const raw = forgedListing("claude-cli-subscription", "honest-unknown-claude-cli-subscription", "picker", "picker");
    const snap = normalizeDiscovery(raw, { target: target("claude-cli-subscription"), discoveredAt: NOW, generation: 1 });
    expect(snap.models[0].evidence.state).toBe("advertised");
    expect(snap.models[0].evidence.state).not.toBe("available");
    // The full-triple form is equally closed for the picker row…
    expect(
      evidenceStateForListing({
        source: "picker",
        contract_states_availability: true,
        target_id: "claude-cli-subscription",
        adapter_id: "honest-unknown-claude-cli-subscription",
      })
    ).toBe("advertised");
    // …and the bare source-only form no longer exists (T4-R2-001).
    expect(() =>
      evidenceStateForListing({ source: "picker", contract_states_availability: true } as never)
    ).toThrow(/authority triple/);
  });

  test("REGRESSION (T4-R1-001): even a forged contract_api_list source cannot promote a non-claude-api row", () => {
    const raw = forgedListing("claude-cli-subscription", "claude-api-models", "contract_api_list", "contract_api_list");
    const snap = normalizeDiscovery(raw, { target: target("claude-cli-subscription"), discoveredAt: NOW, generation: 1 });
    expect(snap.models[0].evidence.state).toBe("advertised"); // row has no availability grounding
  });

  test.each(["claude-gateway-bedrock", "claude-gateway-vertex", "claude-gateway-foundry"])(
    "REGRESSION (T4-R1-002): a %s native_list listing with a forged availability flag caps at advertised",
    (gateway) => {
      const raw = forgedListing(gateway, `forged-${gateway}-native`, "native_list", "native_list");
      const snap = normalizeDiscovery(raw, {
        target: target(gateway, { provider_kind: "gateway" }),
        discoveredAt: NOW,
        generation: 1,
      });
      expect(snap.models[0].evidence.state).toBe("advertised");
      expect(snap.models[0].evidence.state).not.toBe("available");
    }
  );

  test("the closed authority table grounds available on exactly one row (claude-api / claude-api-models / contract_api_list)", () => {
    const grounded = Object.entries(LISTING_AUTHORITY).filter(([, row]) => row.available_grounding !== null);
    expect(grounded).toEqual([
      ["claude-api", { ceiling: "available", available_grounding: { adapter_id: "claude-api-models", source: "contract_api_list" } }],
    ]);
    // An unregistered target fails closed: forged availability stays advertised.
    expect(
      evidenceStateForListing({
        source: "native_list",
        contract_states_availability: true,
        target_id: "not-a-target",
        adapter_id: "whatever",
      })
    ).toBe("advertised");
    // A partial triple (target without adapter, or adapter without target)
    // derives nothing — it throws (T4-R2-001).
    expect(() =>
      evidenceStateForListing({
        source: "contract_api_list",
        contract_states_availability: true,
        target_id: "claude-api",
      } as never)
    ).toThrow(/authority triple/);
    expect(() =>
      evidenceStateForListing({
        source: "contract_api_list",
        contract_states_availability: true,
        adapter_id: "claude-api-models",
      } as never)
    ).toThrow(/authority triple/);
  });

  test("the transition function consults the same table: a listing-sourced ->available is rejected off-row, dispatch receipts pass", () => {
    const log: never[] = [];
    // Picker / gateway-native listing events can never append ->available,
    // even with their own adapter identity attached.
    expect(() =>
      appendEvidenceEvent(log, {
        model: "claude-fable-5",
        transition: "advertised->available",
        source: "picker",
        target_id: "claude-cli-subscription",
        adapter_id: "honest-unknown-claude-cli-subscription",
      })
    ).toThrow(/dispatch receipt|contract-availability/);
    expect(() =>
      appendEvidenceEvent(log, {
        model: "claude-fable-5",
        transition: "unknown->available",
        source: "native_list",
        target_id: "claude-gateway-bedrock",
        adapter_id: "forged-claude-gateway-bedrock-native",
      })
    ).toThrow(/dispatch receipt|contract-availability/);
    // A forged contract_api_list label on the wrong row is rejected too.
    expect(() =>
      appendEvidenceEvent(log, {
        model: "claude-fable-5",
        transition: "unknown->available",
        source: "contract_api_list",
        target_id: "claude-gateway-vertex",
        adapter_id: "claude-api-models",
      })
    ).toThrow(/dispatch receipt|contract-availability/);
    // The grounded row and §4 dispatch evidence still work.
    expect(
      appendEvidenceEvent([], {
        model: "claude-fable-5",
        transition: "unknown->available",
        source: "contract_api_list",
        target_id: "claude-api",
        adapter_id: "claude-api-models",
      })
    ).toHaveLength(1);
    expect(
      appendEvidenceEvent([], {
        model: "claude-fable-5",
        transition: "advertised->available",
        source: "dispatch_receipt",
        target_id: "claude-gateway-bedrock",
      })
    ).toHaveLength(1);
  });

  test("REGRESSION (T4-R2-001): the three round-2 bypass shapes are all rejected — no ->available without the full authority triple", () => {
    // (a) sourceless promotion: unknown->available with NO source at all.
    expect(() =>
      appendEvidenceEvent([], {
        model: "claude-fable-5",
        transition: "unknown->available",
      } as never)
    ).toThrow(/sourceless promotion is illegal/);
    // (b) bare contract_api_list with NO target row.
    expect(() =>
      appendEvidenceEvent([], {
        model: "claude-fable-5",
        transition: "unknown->available",
        source: "contract_api_list",
      } as never)
    ).toThrow(/carries no target_id/);
    // (c) grounded row + grounded source but NO adapter identity.
    expect(() =>
      appendEvidenceEvent([], {
        model: "claude-fable-5",
        transition: "unknown->available",
        source: "contract_api_list",
        target_id: "claude-api",
      } as never)
    ).toThrow(/carries no adapter_id/);
  });

  test("REGRESSION (T4-R2-001): the module's public surface is sealed — no raw state-transition/setter escapes", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const catalog = require("../../src/modules/capability/workflows/model-catalog");
    expect(Object.keys(catalog).sort()).toEqual([
      "EVIDENCE_STATES",
      "LEGAL_EVIDENCE_TRANSITIONS",
      "LISTING_AUTHORITY",
      "TIER_MAPPING_VERSION",
      "appendEvidenceEvent",
      "confidenceForListing",
      "defaultEvidenceStateForTarget",
      "dispatchUpgrade",
      "eligibleForPurpose",
      "evidenceStateForListing",
      "freezeSnapshot",
      "listingAuthorityFor",
      "normalizeDiscovery",
      "projectionAllowed",
      "purposeClassFor",
      "tierForCanonicalId",
    ]);
    // The round-2 probe's entry point is unreachable: the raw grounding
    // predicate is module-private, so "import it and promote directly" cannot
    // even name the symbol.
    expect(catalog.listingCanGroundAvailable).toBeUndefined();
  });
});

// ── Codex seam preference is executable (T4-R1-005 probe, permanent) ─────────

describe("codex adapter selection: app-server model/list preferred, versioned debug parser fallback", () => {
  const appServerResult = fixtureJson("codex-app-server-model-list.result.json");
  const debugStdout = fs.readFileSync(path.join(FIXTURES, "codex-debug-models.json"), "utf8");

  test("the preference order is app-server first (catalog §6)", () => {
    expect([...CODEX_SEAM_PREFERENCE]).toEqual(["app-server", "debug-models"]);
  });

  test("REGRESSION (T4-R1-005): with BOTH seams reachable, model/list is selected and the debug parser is never invoked", async () => {
    let debugCalls = 0;
    const outcome = await discoverCodexModels(
      io({
        jsonRpcCall: async () => appServerResult,
        execCapture: async () => {
          debugCalls += 1;
          return { stdout: debugStdout };
        },
      }),
      { toolVersion: "0.146.0" }
    );
    expect(outcome.seam).toBe("app-server");
    expect(debugCalls).toBe(0);
    expect(outcome.result.status).toBe("ok");
    expect(outcome.result.target_id).toBe("codex-app-server");
    expect(outcome.result.models.map((m) => m.canonical_id)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex-spark",
    ]);
    expect(outcome.attempted).toEqual([{ seam: "app-server", status: "ok" }]);
  });

  test("with the app-server seam unreachable, the versioned debug parser carries the listing ([P1] capture)", async () => {
    const outcome = await discoverCodexModels(io({ execCapture: async () => ({ stdout: debugStdout }) }), {
      toolVersion: "0.146.0",
    });
    expect(outcome.seam).toBe("debug-models");
    expect(outcome.result.status).toBe("ok");
    expect(outcome.result.target_id).toBe("codex-cli-chatgpt"); // target-safe: its OWN row
    expect(outcome.result.models).toHaveLength(8);
    expect(outcome.attempted).toEqual([
      { seam: "app-server", status: "unsupported" },
      { seam: "debug-models", status: "ok" },
    ]);
    // The fallback result normalizes under its own target row only — advertised, never available.
    const snap = normalizeDiscovery(outcome.result, {
      target: target("codex-cli-chatgpt"),
      discoveredAt: NOW,
      generation: 1,
    });
    for (const m of snap.models) expect(m.evidence.state).toBe("advertised");
  });

  test("an ERRORING app-server seam falls back to the debug parser instead of guessing", async () => {
    const outcome = await discoverCodexModels(
      io({
        jsonRpcCall: async () => {
          throw new Error("app-server not running");
        },
        execCapture: async () => ({ stdout: debugStdout }),
      }),
      { toolVersion: "0.146.0" }
    );
    expect(outcome.seam).toBe("debug-models");
    expect(outcome.result.status).toBe("ok");
    expect(outcome.attempted.map((a) => a.status)).toEqual(["error", "ok"]);
  });

  test("when EVERY seam fails, the outcome is the last honest failure receipt — never a guess", async () => {
    const outcome = await discoverCodexModels(nullIo(), { toolVersion: "0.146.0" });
    expect(outcome.seam).toBe("debug-models");
    expect(outcome.result.status).toBe("unsupported");
    expect(outcome.result.models).toEqual([]);
    expect(outcome.attempted).toHaveLength(2);
  });

  test("REGRESSION (parser-injection probe): poisoned debug output through the fallback path is rejected redacted — no provider bytes, no prototype pollution", async () => {
    const poison = JSON.stringify({
      models: [{ slug: 42, __proto__: { polluted: true }, note: "$(rm -rf /)", SECRET_MARKER: "sk-INJECTED-DO-NOT-ECHO" }],
    });
    const outcome = await discoverCodexModels(io({ execCapture: async () => ({ stdout: poison }) }), {
      toolVersion: "0.146.0",
    });
    expect(outcome.result.status).toBe("error");
    expect(outcome.result.failure_reason).toBe("parse_rejected");
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("sk-INJECTED-DO-NOT-ECHO");
    expect(serialized).not.toContain("rm -rf");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined(); // provider output is DATA, never executed
  });
});

// ── Fingerprint redaction ────────────────────────────────────────────────────

describe("fingerprints are non-reversible and unknown-safe", () => {
  test("fingerprintOrUnknown: unobservable → literal unknown; observable → salted fp- digest", () => {
    expect(fingerprintOrUnknown(null, "salt-a")).toBe("unknown");
    expect(fingerprintOrUnknown("", "salt-a")).toBe("unknown");
    const fp = fingerprintOrUnknown("org_abc123", "salt-a");
    expect(fp).toMatch(/^fp-[0-9a-f]+$/);
    expect(fp).not.toContain("org_abc123");
    expect(fingerprintOrUnknown("org_abc123", "salt-a")).toBe(fp); // deterministic per salt
    expect(fingerprintOrUnknown("org_abc123", "salt-b")).not.toBe(fp); // machine-local salt matters
  });
});
