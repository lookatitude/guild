/**
 * scripts/__tests__/host-public-state-gate-matrix.test.ts
 *
 * verified-multi-host-support L7 (wave-4b) — the EXHAUSTIVE anti-vacuity matrix for
 * the two-field host-support gate (`hostSupportGate`, ADR §5.3) and the two derive
 * functions. The lane-owner (L5) shipped `host-public-state.test.ts` as a correctness
 * SEED (honest PASS + one fraud + one regression + digest integrity); this file is the
 * durable AC-RUN-3 regression — it drives EVERY fail path, the honest pass, and
 * promote-independent-of-provenance, and it makes every assertion DISCRIMINATING: for
 * each verdict it flips exactly one input and shows the verdict flips too, so a green
 * suite can never be false-clean.
 *
 * The gate is a PURE function of injected `GateableRow[]`; the floor is read from the
 * row (the generator stamps it from `HOST_EXPECTED_STATE`). So synthetic rows exercise
 * the gate without mutating the module manifest. The derive functions + the whole-matrix
 * "green gate is not vacuous" guard run over the REAL registry / committed receipts.
 *
 * Grounding: scripts/lib/host-public-state.ts §5.3 gate, §5.2 derivations;
 * scripts/lib/support-matrix.ts generateSupportMatrix; the L5 handoff 16-host table.
 */

import {
  HOST_EXPECTED_STATE,
  PUBLIC_STATES,
  VERIFICATION_STATUS,
  bucketForRow,
  deriveCurrentPublicState,
  deriveVerificationStatus,
  hostSupportGate,
  computeSmokeDigest,
  type GateableRow,
  type HostSmokeReceipt,
  type PublicState,
  type VerificationStatus,
} from "../lib/host-public-state";
import { generateSupportMatrix, validateSupportMatrix } from "../lib/support-matrix";
import { loadCommittedReceipts } from "../lib/host-smoke-store";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "../lib/host-registry-schema";

const GENERATED_AT = "2026-07-04T00:00:00Z";

/** A committed-receipt fixture whose digest recomputes (so it is a *valid* verified receipt). */
function makeReceipt(host: HostId, publicState: PublicState, boxId = "box-t"): HostSmokeReceipt {
  const identity = {
    host_id: host,
    box_id: boxId,
    host_version: "9.9.9",
    public_state_claimed: publicState,
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

/** A single honest gate row, overridable field-by-field — the base for flip tests. */
function row(overrides: Partial<GateableRow> = {}): GateableRow {
  return {
    host_id: "pi-cli",
    current_public_state: "unsupported",
    verification_status: "target",
    achieved_floor: null,
    has_valid_receipt: false,
    receipt_conflict: null,
    ...overrides,
  };
}

const gatePasses = (r: GateableRow) => hostSupportGate([r]).valid;
const gateErrors = (r: GateableRow) => hostSupportGate([r]).errors.join("\n");

describe("host-support gate — anti-vacuity matrix (AC-RUN-3, ADR §5.3)", () => {
  // ── honest target PASSES ────────────────────────────────────────────────────
  it("honest target PASSES — unsupported/target/null-floor/no-receipt is not a failure", () => {
    const honest = row({
      current_public_state: "unsupported",
      verification_status: "target",
      achieved_floor: null,
      has_valid_receipt: false,
    });
    expect(gatePasses(honest)).toBe(true);
    // DISCRIMINATING: claim a verified public state without acquiring a receipt → FAIL.
    expect(gatePasses({ ...honest, current_public_state: "verified_wrapped" })).toBe(false);
  });

  it("an honestly-promoted verified host (receipt + matching floor) PASSES", () => {
    const promoted = row({
      current_public_state: "verified_wrapped",
      verification_status: "verified",
      achieved_floor: "verified_wrapped",
      has_valid_receipt: true,
    });
    expect(gatePasses(promoted)).toBe(true);
    // DISCRIMINATING: strip the floor → floor-coupling (c) fires.
    expect(gatePasses({ ...promoted, achieved_floor: null })).toBe(false);
  });

  // ── (a) anti-fraud ──────────────────────────────────────────────────────────
  it("(a) anti-fraud FAILS — verified_* public state with NO valid receipt", () => {
    // Floor set so ONLY (a) can fire (isolate the check).
    const fraud = row({
      current_public_state: "verified_wrapped",
      verification_status: "verified",
      achieved_floor: "verified_wrapped",
      has_valid_receipt: false,
    });
    expect(gatePasses(fraud)).toBe(false);
    expect(gateErrors(fraud)).toMatch(/\(a\)/);
    // DISCRIMINATING: supply the receipt → PASS.
    expect(gatePasses({ ...fraud, has_valid_receipt: true })).toBe(true);
  });

  it("(a) also FAILS when has_valid_receipt is true but verification_status is not 'verified'", () => {
    // A receipt file present but the derived status disagrees — still fraud.
    const mismatch = row({
      current_public_state: "verified_bridged",
      verification_status: "target",
      achieved_floor: "verified_bridged",
      has_valid_receipt: true,
    });
    expect(gateErrors(mismatch)).toMatch(/\(a\)/);
    // DISCRIMINATING: align verification_status → PASS.
    expect(gatePasses({ ...mismatch, verification_status: "verified" })).toBe(true);
  });

  it("(a) fires ISOLATED + DISCRIMINATING across ALL three verified buckets (incl. native)", () => {
    // For EACH verified bucket, hold the floor EQUAL to the claimed state so (b) and (c)
    // are both neutral — the ONLY branch that can fail the gate is anti-fraud (a). Then
    // flip has_valid_receipt ALONE and require the verdict to flip fail↔pass. If (a) were
    // broken (or omitted `native`) the "false" assertion would not hold, because (c) is
    // held neutral and can no longer mask it.
    for (const cps of ["native", "verified_wrapped", "verified_bridged"] as PublicState[]) {
      const fraud = row({
        current_public_state: cps,
        verification_status: "verified", // matched, so only has_valid_receipt drives (a)
        achieved_floor: cps, // floor === cps ⇒ (b) skip, (c) skip
        has_valid_receipt: false,
      });
      // ONLY (a) fires — prove it both by verdict and by the isolated error tag.
      expect(gatePasses(fraud)).toBe(false);
      expect(gateErrors(fraud)).toMatch(/\(a\)/);
      expect(gateErrors(fraud)).not.toMatch(/\(b\)|\(c\)/);
      // DISCRIMINATING: flipping ONLY has_valid_receipt → PASS (nothing else changed).
      expect(gatePasses({ ...fraud, has_valid_receipt: true })).toBe(true);
    }
    // unsupported is honest — (a) never fires.
    expect(gateErrors(row({ current_public_state: "unsupported" }))).not.toMatch(/\(a\)/);
  });

  // ── (b) regression below a committed floor ──────────────────────────────────
  it("(b) regression FAILS — current_public_state below a committed achieved_floor", () => {
    const regression = row({
      current_public_state: "unsupported",
      verification_status: "target",
      achieved_floor: "verified_wrapped", // was verified once; now dropped
      has_valid_receipt: false,
    });
    expect(gatePasses(regression)).toBe(false);
    expect(gateErrors(regression)).toMatch(/\(b\)/);
    // Only (b) — an unsupported cps never trips anti-fraud/floor-coupling.
    expect(gateErrors(regression)).not.toMatch(/\(a\)|\(c\)/);
    // DISCRIMINATING: restore the floored state (with its receipt) → PASS.
    expect(
      gatePasses({
        ...regression,
        current_public_state: "verified_wrapped",
        verification_status: "verified",
        has_valid_receipt: true,
      }),
    ).toBe(true);
  });

  it("(b) does NOT fire when there is no committed floor (null floor = never promoted)", () => {
    expect(gateErrors(row({ current_public_state: "unsupported", achieved_floor: null }))).not.toMatch(/\(b\)/);
  });

  // ── (c) floor-coupling ──────────────────────────────────────────────────────
  it("(c) floor-coupling FAILS — verified public state with a NULL achieved_floor", () => {
    const nullFloor = row({
      current_public_state: "verified_wrapped",
      verification_status: "verified",
      achieved_floor: null, // operator committed a receipt but forgot the floor
      has_valid_receipt: true,
    });
    expect(gatePasses(nullFloor)).toBe(false);
    expect(gateErrors(nullFloor)).toMatch(/\(c\)/);
    // Isolated: a valid receipt means (a) is clean; null floor means (b) is skipped.
    expect(gateErrors(nullFloor)).not.toMatch(/\(a\)|\(b\)/);
    // DISCRIMINATING: stamp the matching floor → PASS.
    expect(gatePasses({ ...nullFloor, achieved_floor: "verified_wrapped" })).toBe(true);
  });

  it("(c) floor-coupling FAILS — verified public state with a MISMATCHED-bucket floor", () => {
    const mismatchedFloor = row({
      current_public_state: "verified_wrapped",
      verification_status: "verified",
      achieved_floor: "verified_bridged", // wrong bucket
      has_valid_receipt: true,
    });
    expect(gatePasses(mismatchedFloor)).toBe(false);
    expect(gateErrors(mismatchedFloor)).toMatch(/\(c\)/);
    // DISCRIMINATING: correct the floor bucket → PASS.
    expect(gatePasses({ ...mismatchedFloor, achieved_floor: "verified_wrapped" })).toBe(true);
  });

  // ── conflict — divergent non-stale multi-box attestation ─────────────────────
  it("conflict FAILS — a divergent non-stale multi-box attestation never resolves silently", () => {
    const conflicted = row({
      current_public_state: "unsupported",
      verification_status: "target",
      achieved_floor: null,
      has_valid_receipt: false,
      receipt_conflict: "conflicting non-stale receipts for pi-cli: verified_bridged vs verified_wrapped",
    });
    expect(gatePasses(conflicted)).toBe(false);
    expect(gateErrors(conflicted)).toMatch(/conflict/);
    // DISCRIMINATING: clear the conflict → PASS.
    expect(gatePasses({ ...conflicted, receipt_conflict: null })).toBe(true);
  });

  // ── promote-independent-of-provenance ───────────────────────────────────────
  it("promote-independent-of-provenance — a provenance:'inferred' target promotes on a VALID receipt", () => {
    // cursor is registry provenance:"inferred", installability:"target".
    expect(HOST_REGISTRY_ROWS.cursor.provenance).toBe("inferred");

    // Without a receipt: honest target/unsupported (the discriminating baseline).
    const bare = generateSupportMatrix(GENERATED_AT, {});
    const bareCursor = bare.rows.find((r) => r.host_id === "cursor")!;
    expect(bareCursor.verification_status).toBe("target");
    expect(bareCursor.current_public_state).toBe("unsupported");

    // With a valid receipt: the receipt PROMOTES regardless of the inferred registry provenance.
    const withReceipt = generateSupportMatrix(GENERATED_AT, {
      cursor: [makeReceipt("cursor", "verified_wrapped")],
    });
    const cursor = withReceipt.rows.find((r) => r.host_id === "cursor")!;
    expect(cursor.verification_status).toBe("verified");
    expect(cursor.current_public_state).toBe("verified_wrapped");
    expect(cursor.has_valid_receipt).toBe(true);

    // …and the promoted state PASSES the gate once its floor is committed atomically.
    const promotedRow = row({
      host_id: "cursor",
      current_public_state: "verified_wrapped",
      verification_status: "verified",
      achieved_floor: "verified_wrapped",
      has_valid_receipt: true,
    });
    expect(gatePasses(promotedRow)).toBe(true);
  });

  // ── totality — both derive functions are total over all 16 hosts ─────────────
  it("derive functions return a LEGAL value for all 16 hosts × every final_state × receipt", () => {
    expect(HOST_IDS).toHaveLength(16);
    const finalStates = ["verified", "degraded", "unavailable", "enqueue_only", "manual_instruction"];
    for (const host of HOST_IDS) {
      const reg = HOST_REGISTRY_ROWS[host];
      for (const final_state of finalStates) {
        for (const hasValidReceipt of [false, true]) {
          const derivable = {
            host_id: host,
            surface_kind: reg.surface_kind,
            installability: reg.installability,
            registry_provenance: reg.provenance,
            final_state,
          };
          const bucket = bucketForRow(derivable);
          const vs: VerificationStatus = deriveVerificationStatus(derivable, bucket, hasValidReceipt);
          const cps: PublicState = deriveCurrentPublicState(host, bucket, vs);
          expect(VERIFICATION_STATUS).toContain(vs);
          expect(PUBLIC_STATES).toContain(cps);
          // R3 invariant: the public column never leaks a diagnostic axis value.
          expect(["native", "verified_wrapped", "verified_bridged", "unsupported"]).toContain(cps);
        }
      }
      // The manifest is total too.
      expect(HOST_EXPECTED_STATE[host]).toBeDefined();
      expect(PUBLIC_STATES).toContain(HOST_EXPECTED_STATE[host].target_state);
    }
  });

  // ── whole-matrix "green gate is NOT vacuous" — the anti-vacuity backstop ──────
  it("the REAL committed matrix PASSES, and dropping a real receipt makes it FAIL (green ≠ false-clean)", () => {
    const committed = loadCommittedReceipts();
    const matrix = generateSupportMatrix(GENERATED_AT, committed);
    // Positive: the honest committed state passes end-to-end.
    expect(validateSupportMatrix(matrix)).toEqual({ valid: true, errors: [] });

    // A real host was actually promoted (else this guard would be vacuous itself).
    const promoted = matrix.rows.filter((r) => r.has_valid_receipt);
    expect(promoted.length).toBeGreaterThan(0);

    // Anti-vacuity: strip the receipt from a promoted row while leaving its verified
    // public state — the gate must catch it. If the gate were a no-op this stays green.
    const target = promoted[0];
    const tampered = matrix.rows.map((r) =>
      r.host_id === target.host_id ? { ...r, has_valid_receipt: false } : r,
    );
    const res = hostSupportGate(tampered);
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toMatch(new RegExp(`${target.host_id}.*\\(a\\)`));
  });
});
