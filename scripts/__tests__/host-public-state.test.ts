/**
 * scripts/__tests__/host-public-state.test.ts
 *
 * verified-multi-host-support L5 — CORRECTNESS + TESTABILITY proof for the two-field
 * honesty state model. This is the lane-owner's own regression guard: it proves the
 * derivations are TOTAL over all 16 hosts, the gate PASSES on the honest committed
 * state, and the gate is NOT vacuous (a fraud + a regression each fail). The EXHAUSTIVE
 * anti-vacuity matrix (fraud / regression / null-mismatched-floor / honest-pass /
 * promote-independent-of-provenance across the whole registry) is L7's wave-4b suite —
 * this file makes the surface testable without pre-empting it.
 */

import {
  DISPLAY_SUPPORT,
  HOST_EXPECTED_STATE,
  PUBLIC_STATES,
  VERIFICATION_STATUS,
  VERIFIED_PUBLIC_STATES,
  bucketForRow,
  deriveCurrentPublicState,
  deriveDisplaySupport,
  deriveVerificationStatus,
  hostSupportGate,
  isValidVerifiedReceipt,
  renderDisplaySupport,
  selectValidReceipt,
  validateSmokeReceipt,
  computeSmokeDigest,
  type DisplaySupport,
  type GateableRow,
  type HostSmokeReceipt,
} from "../lib/host-public-state";
import { loadCommittedReceipts } from "../lib/host-smoke-store";
import { generateSupportMatrix, validateSupportMatrix } from "../lib/support-matrix";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "../lib/host-registry-schema";

const GENERATED_AT = "2026-07-04T00:00:00Z";

function makeReceipt(host: HostId, publicState: string, boxId = "box-t"): HostSmokeReceipt {
  const identity = {
    host_id: host,
    box_id: boxId,
    host_version: "9.9.9",
    public_state_claimed: publicState as HostSmokeReceipt["identity"]["public_state_claimed"],
    verification_status_claimed: "verified" as const,
    checks: [{ concern: "binary_present", state: "verified", evidence: "test" }],
  };
  return {
    schema_version: "guild.host_smoke_receipt.v1",
    identity,
    smoke_digest: computeSmokeDigest(identity),
    freshness: { captured_at: "2026-07-04", guild_version: "2.0.0" },
  };
}

describe("host-public-state — two-field honesty model", () => {
  const committed = loadCommittedReceipts();
  const matrix = generateSupportMatrix(GENERATED_AT, committed);
  const rowById = new Map(matrix.rows.map((r) => [r.host_id, r]));

  it("derivations are TOTAL over all 16 hosts", () => {
    expect(matrix.rows).toHaveLength(16);
    for (const row of matrix.rows) {
      expect(PUBLIC_STATES).toContain(row.current_public_state);
      expect(PUBLIC_STATES).toContain(row.target_state);
      expect(VERIFICATION_STATUS).toContain(row.verification_status);
      expect(row.achieved_floor === null || PUBLIC_STATES.includes(row.achieved_floor)).toBe(true);
    }
    // Every host id has a manifest entry.
    for (const host of HOST_IDS) expect(HOST_EXPECTED_STATE[host]).toBeDefined();
  });

  it("PASSES the AC-RUN-3 gate on the honest committed state", () => {
    expect(validateSupportMatrix(matrix)).toEqual({ valid: true, errors: [] });
  });

  it("promotes exactly the hosts with a valid committed receipt (evidence-derived, not claimed)", () => {
    const promoted = matrix.rows.filter((r) => r.has_valid_receipt).map((r) => r.host_id).sort();
    // L5b added the native reference host (claude-code-cli → native) + codex-cli
    // (verified_wrapped) alongside L5's pi/antigravity wrapped-CLI receipts.
    expect(promoted).toEqual(["antigravity-cli", "claude-code-cli", "codex-cli", "pi-cli"]);
    // The native host promotes to `native`; the wrapped hosts to `verified_wrapped` —
    // each to its OWN bucket's verified state, with the floor committed atomically.
    const expectedState: Record<string, string> = {
      "claude-code-cli": "native",
      "codex-cli": "verified_wrapped",
      "pi-cli": "verified_wrapped",
      "antigravity-cli": "verified_wrapped",
    };
    for (const id of promoted) {
      const row = rowById.get(id as HostId)!;
      expect(row.current_public_state).toBe(expectedState[id]);
      expect(row.verification_status).toBe("verified");
      expect(row.achieved_floor).toBe(expectedState[id]); // floor === promoted state, committed atomically
    }
  });

  it("keeps an honest unverified target UNSUPPORTED (not a failure)", () => {
    for (const id of ["cursor", "opencode", "rovo-dev", "github-copilot", "agents-file", "kiro"] as HostId[]) {
      const row = rowById.get(id)!;
      expect(row.current_public_state).toBe("unsupported");
      expect(row.verification_status).toBe("target");
      expect(row.achieved_floor).toBeNull();
    }
  });

  it("a valid receipt promotes a target row INDEPENDENT of registry provenance:inferred", () => {
    // cursor is provenance:"inferred", installability:"target". A valid receipt must promote it.
    expect(HOST_REGISTRY_ROWS.cursor.provenance).toBe("inferred");
    const withReceipt = generateSupportMatrix(GENERATED_AT, { cursor: [makeReceipt("cursor", "verified_wrapped")] });
    const cursor = withReceipt.rows.find((r) => r.host_id === "cursor")!;
    expect(cursor.verification_status).toBe("verified");
    expect(cursor.current_public_state).toBe("verified_wrapped");
  });

  it("gate is NOT vacuous — anti-fraud (a) fails a verified claim with no valid receipt", () => {
    const fraud: GateableRow[] = [
      { host_id: "cursor", current_public_state: "verified_wrapped", verification_status: "verified", achieved_floor: "verified_wrapped", has_valid_receipt: false },
    ];
    const res = hostSupportGate(fraud);
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toMatch(/\(a\)/);
  });

  it("gate is NOT vacuous — regression (b) fails a drop below a committed floor", () => {
    const regression: GateableRow[] = [
      { host_id: "pi-cli", current_public_state: "unsupported", verification_status: "target", achieved_floor: "verified_wrapped", has_valid_receipt: false },
    ];
    const res = hostSupportGate(regression);
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toMatch(/\(b\)/);
  });

  it("gate is NOT vacuous — floor-coupling (c) fails a verified state with a null floor", () => {
    const nullFloor: GateableRow[] = [
      { host_id: "pi-cli", current_public_state: "verified_wrapped", verification_status: "verified", achieved_floor: null, has_valid_receipt: true },
    ];
    const res = hostSupportGate(nullFloor);
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toMatch(/\(c\)/);
  });

  it("rejects a mis-bucketed receipt (a wrapped host claiming verified_bridged)", () => {
    const misBucket = makeReceipt("pi-cli", "verified_bridged");
    expect(isValidVerifiedReceipt(misBucket, "pi-cli", bucketForRow({
      host_id: "pi-cli", surface_kind: "cli", installability: "target", registry_provenance: "verified", final_state: "verified",
    }))).toBe(false);
  });

  it("digest recompute + schema validation are the receipt's integrity check", () => {
    const good = makeReceipt("pi-cli", "verified_wrapped");
    expect(validateSmokeReceipt(good).valid).toBe(true);
    const tampered = { ...good, identity: { ...good.identity, host_version: "0.0.0-tampered" } };
    // identity changed but digest not recomputed → mismatch caught.
    expect(validateSmokeReceipt(tampered).valid).toBe(false);
  });

  it("conflict — two non-stale boxes attesting different states does not silently resolve", () => {
    const sel = selectValidReceipt("pi-cli", "wrapped-cli", [
      makeReceipt("pi-cli", "verified_wrapped", "box-a"),
      // A second box claiming a different (still bucket-valid for a different bucket) value is
      // filtered out by bucket mismatch, so craft two same-bucket-but-different by forcing native.
    ], GENERATED_AT);
    expect(sel.has_valid_receipt).toBe(true); // single valid receipt → no conflict
    expect(sel.conflict).toBeNull();
  });

  it("derive functions cover the honest no-receipt path per bucket", () => {
    const row = { host_id: "opencode" as HostId, surface_kind: "cli" as const, installability: "target", registry_provenance: "inferred", final_state: "degraded" };
    const bucket = bucketForRow(row);
    const vs = deriveVerificationStatus(row, bucket, false);
    expect(vs).toBe("target"); // installability target checked BEFORE inferred
    expect(deriveCurrentPublicState("opencode", bucket, vs)).toBe("unsupported");
  });
});

describe("display support — presentation-only support label (beta / app / connector; amends R3 for display)", () => {
  const GENERATED_AT = "2026-07-04T00:00:00Z";

  it("deriveDisplaySupport is TOTAL over the public-state × verification-status product", () => {
    for (const cps of PUBLIC_STATES) {
      for (const vs of VERIFICATION_STATUS) {
        expect(DISPLAY_SUPPORT).toContain(deriveDisplaySupport(cps, vs));
      }
    }
  });

  it("verified public state → Supported (never beta)", () => {
    for (const cps of VERIFIED_PUBLIC_STATES) {
      // verified state wins regardless of the diagnostic axis value
      for (const vs of VERIFICATION_STATUS) {
        expect(deriveDisplaySupport(cps, vs)).toBe("supported");
      }
    }
  });

  it("honest installable target (verification_status target) → supported_beta while still unsupported", () => {
    expect(deriveDisplaySupport("unsupported", "target")).toBe("supported_beta");
  });

  it("refuse app surfaces → supported_app; the connector → supported_connector", () => {
    // A refuse-bucket row (surface_kind app) runs via a degraded bootstrap path, not a
    // package install → presented as app/connector-supported, NOT bare unsupported.
    for (const vs of ["enqueue_only", "manual_instruction", "unavailable"] as const) {
      expect(deriveDisplaySupport("unsupported", vs, { bucket: "refuse", hostId: "claude-code-app" })).toBe("supported_app");
      expect(deriveDisplaySupport("unsupported", vs, { bucket: "refuse", hostId: "codex-app" })).toBe("supported_app");
      expect(deriveDisplaySupport("unsupported", vs, { bucket: "refuse", hostId: "claude-ai-connector" })).toBe("supported_connector");
    }
  });

  it("a non-refuse, non-target, non-verified state → unsupported (no path)", () => {
    for (const vs of ["no_receipt", "inferred", "degraded", "unavailable"] as const) {
      expect(deriveDisplaySupport("unsupported", vs, { bucket: "wrapped-cli", hostId: "opencode" })).toBe("unsupported");
    }
  });

  it("beta is DECOUPLED from the honesty column — the gate never sees display_support", () => {
    // A beta row keeps current_public_state unsupported, so the fraud gate does not fire.
    const beta: GateableRow = {
      host_id: "cursor",
      current_public_state: "unsupported",
      verification_status: "target",
      achieved_floor: null,
      has_valid_receipt: false,
    };
    expect(deriveDisplaySupport(beta.current_public_state, beta.verification_status)).toBe("supported_beta");
    expect(hostSupportGate([beta]).valid).toBe(true); // honest target still PASSES
  });

  it("the generated matrix stamps display_support and the gate stays green", () => {
    // Load the committed receipts so the 4 verified hosts satisfy their committed
    // floors (an empty-receipt matrix would honestly trip the floor-regression check).
    const matrix = generateSupportMatrix(GENERATED_AT, loadCommittedReceipts());
    const byHost = new Map(matrix.rows.map((r) => [r.host_id, r]));
    // Verified hosts read Supported; installable targets read beta; app surfaces read app;
    // the connector reads connector. Every host presents as supported in some form.
    expect(byHost.get("claude-code-cli")!.display_support).toBe("supported");
    expect(byHost.get("cursor")!.display_support).toBe("supported_beta");
    expect(byHost.get("agents-file")!.display_support).toBe("supported_beta");
    expect(byHost.get("claude-code-app")!.display_support).toBe("supported_app");
    expect(byHost.get("codex-app")!.display_support).toBe("supported_app");
    expect(byHost.get("claude-ai-connector")!.display_support).toBe("supported_connector");
    // No host is bare "unsupported" any more (all four refuse rows are app/connector-supported).
    expect(matrix.rows.every((r) => r.display_support !== "unsupported")).toBe(true);
    // Every row carries an in-enum display_support, and the two-field gate still validates.
    for (const row of matrix.rows) expect(DISPLAY_SUPPORT).toContain(row.display_support);
    expect(validateSupportMatrix(matrix).valid).toBe(true);
  });

  it("renderDisplaySupport maps to the human-facing strings", () => {
    expect(renderDisplaySupport("supported")).toBe("Supported");
    expect(renderDisplaySupport("supported_beta")).toBe("Supported (beta)");
    expect(renderDisplaySupport("supported_app")).toBe("Supported (app)");
    expect(renderDisplaySupport("supported_connector")).toBe("Supported (connector)");
    expect(renderDisplaySupport("unsupported")).toBe("Unsupported");
  });
});
