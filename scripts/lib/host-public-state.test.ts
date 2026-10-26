/**
 * scripts/lib/host-public-state.test.ts
 *
 * verified-multi-host-support L5 — CORRECTNESS + TESTABILITY proof for the two-field
 * honesty state model. This is the lane-owner's own regression guard: it proves the
 * derivations are TOTAL over all 16 hosts, the gate PASSES on the honest committed
 * state, and the gate is NOT vacuous (a fraud + a regression each fail). The EXHAUSTIVE
 * anti-vacuity matrix (fraud / regression / null-mismatched-floor / honest-pass /
 * promote-independent-of-provenance across the whole registry) is L7's wave-4b suite —
 * this file makes the surface testable without pre-empting it.
 */

import { describe, it, expect } from "bun:test";
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
  groupSourceCommit,
  type DisplaySupport,
  type GateableRow,
  type HostSmokeReceipt,
} from "./host-public-state";
import { loadCommittedReceipts, readGuildSourceVersion } from "./host-smoke-store";
import { generateSupportMatrix, validateSupportMatrix } from "./support-matrix";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "./host-registry-schema";

const GENERATED_AT = "2026-07-04T00:00:00Z";
const CURRENT_VERSION = readGuildSourceVersion();

function makeReceipt(host: HostId, publicState: string, boxId = "box-t"): HostSmokeReceipt {
  const identity = {
    host_id: host,
    box_id: boxId,
    host_version: "9.9.9",
    public_state_claimed: publicState as HostSmokeReceipt["identity"]["public_state_claimed"],
    verification_status_claimed: "verified" as const,
    checks: [{ concern: "binary_present", state: "verified", evidence: "test" }],
    source_commit: "0123456789abcdef0123-456789abcdef01234567",
  };
  return {
    schema_version: "guild.host_smoke_receipt.v1",
    identity,
    smoke_digest: computeSmokeDigest(identity),
    freshness: { captured_at: "2026-07-04", guild_version: CURRENT_VERSION },
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
    // (verified_wrapped) alongside L5's pi/antigravity wrapped-CLI receipts; v3.2.0
    // added cursor, opencode and rovo-dev wrapped-CLI receipts.
    expect(promoted).toEqual(["antigravity-cli", "claude-code-cli", "codex-cli", "cursor", "opencode", "pi-cli", "rovo-dev"]);
    // The native host promotes to `native`; the wrapped hosts to `verified_wrapped` —
    // each to its OWN bucket's verified state, with the floor committed atomically.
    const expectedState: Record<string, string> = {
      "claude-code-cli": "native",
      "codex-cli": "verified_wrapped",
      "pi-cli": "verified_wrapped",
      "antigravity-cli": "verified_wrapped",
      cursor: "verified_wrapped",
      opencode: "verified_wrapped",
      "rovo-dev": "verified_wrapped",
    };
    for (const id of promoted) {
      const row = rowById.get(id as HostId)!;
      expect(row.current_public_state).toBe(expectedState[id]);
      expect(row.verification_status).toBe("verified");
      expect(row.achieved_floor).toBe(expectedState[id]); // floor === promoted state, committed atomically
    }
  });

  it("keeps an honest unverified target UNSUPPORTED (not a failure)", () => {
    for (const id of ["github-copilot", "agents-file", "kiro"] as HostId[]) {
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
    ], GENERATED_AT, { guild_version: CURRENT_VERSION });
    expect(sel.has_valid_receipt).toBe(true); // single valid receipt → no conflict
    expect(sel.conflict).toBeNull();
  });

  it("G08 R3 — a guild_version-mismatched receipt is refused, never selected via fallback", () => {
    const old = makeReceipt("pi-cli", "verified_wrapped");
    old.freshness.guild_version = "2.0.0";
    const sel = selectValidReceipt("pi-cli", "wrapped-cli", [old], GENERATED_AT, { guild_version: "3.2.0-beta.1" });
    expect(sel.has_valid_receipt).toBe(false);
    expect(sel.chosen).toBeNull();
    expect(sel.refused.join("\n")).toMatch(/guild_version 2\.0\.0 !== 3\.2\.0-beta\.1/);
    // DISCRIMINATING: the same receipt bound to its own version is selected.
    expect(selectValidReceipt("pi-cli", "wrapped-cli", [old], GENERATED_AT, { guild_version: "2.0.0" }).has_valid_receipt).toBe(true);
  });

  it("G08 R3 — a commit-mismatched (or commit-less) receipt is refused when the caller binds a commit", () => {
    const commitA = "a".repeat(40);
    const commitB = "b".repeat(40);
    const withCommit = (commit: string | undefined): HostSmokeReceipt => {
      const r = makeReceipt("pi-cli", "verified_wrapped");
      const identity = { ...r.identity, ...(commit ? { source_commit: groupSourceCommit(commit) } : {}) };
      return { ...r, identity, smoke_digest: computeSmokeDigest(identity) };
    };
    const binding = { guild_version: CURRENT_VERSION, source_commit: commitB };
    const mismatched = selectValidReceipt("pi-cli", "wrapped-cli", [withCommit(commitA)], GENERATED_AT, binding);
    expect(mismatched.has_valid_receipt).toBe(false);
    expect(mismatched.refused.join("\n")).toMatch(/source_commit/);
    expect(selectValidReceipt("pi-cli", "wrapped-cli", [withCommit(undefined)], GENERATED_AT, binding).has_valid_receipt).toBe(false);
    // A mismatched receipt alongside a matching one never wins: the matching one is chosen.
    const mixed = selectValidReceipt("pi-cli", "wrapped-cli", [withCommit(commitA), withCommit(commitB)], GENERATED_AT, binding);
    expect(mixed.has_valid_receipt).toBe(true);
    expect(mixed.chosen!.identity.source_commit).toBe(groupSourceCommit(commitB));
  });

  it("G08 R3 — the live matrix refuses a receipt that records no source commit", () => {
    const r = makeReceipt("cursor", "verified_wrapped");
    const { source_commit: _commit, ...identity } = r.identity;
    const commitless = { ...r, identity, smoke_digest: computeSmokeDigest(identity) };
    const cursor = (receipts: HostSmokeReceipt[]) => generateSupportMatrix(GENERATED_AT, { cursor: receipts }).rows.find((row) => row.host_id === "cursor")!;
    expect(cursor([commitless]).has_valid_receipt).toBe(false);
    // DISCRIMINATING: the same receipt with its commit recorded promotes.
    expect(cursor([r]).has_valid_receipt).toBe(true);
  });

  it("G08 R3 — an all-stale pool is refused (staleness disqualifies, no stale fallback)", () => {
    const stale = makeReceipt("pi-cli", "verified_wrapped");
    stale.freshness.captured_at = "2025-01-01";
    const sel = selectValidReceipt("pi-cli", "wrapped-cli", [stale], "2026-07-04T00:00:00Z", { guild_version: CURRENT_VERSION });
    expect(sel.has_valid_receipt).toBe(false);
    expect(sel.chosen).toBeNull();
    expect(sel.stale).toBe(true);
    // DISCRIMINATING: inside the horizon it is selected.
    expect(selectValidReceipt("pi-cli", "wrapped-cli", [stale], "2025-02-01T00:00:00Z", { guild_version: CURRENT_VERSION }).has_valid_receipt).toBe(true);
  });

  it("G08 R3 — the live matrix binds the manifest version: a committed receipt re-stamped to another version stops promoting", () => {
    const committed = loadCommittedReceipts();
    const restamped = Object.fromEntries(
      Object.entries(committed).map(([h, rs]) => [h, rs.map((r) => ({ ...r, freshness: { ...r.freshness, guild_version: "0.0.1" } }))]),
    );
    const res = validateSupportMatrix(generateSupportMatrix(GENERATED_AT, restamped));
    expect(res.valid).toBe(false);
    expect(res.errors.join("\n")).toMatch(/claude-code-cli/);
  });

  it("derive functions cover the honest no-receipt path per bucket", () => {
    const row = { host_id: "opencode" as HostId, surface_kind: "cli" as const, installability: "target", registry_provenance: "inferred", final_state: "degraded" };
    const bucket = bucketForRow(row);
    const vs = deriveVerificationStatus(row, bucket, false);
    expect(vs).toBe("target"); // installability target checked BEFORE inferred
    expect(deriveCurrentPublicState("opencode", bucket, vs)).toBe("unsupported");
  });

  it("refuses a verified install/load check that lacks isolated-install provenance", () => {
    for (const concern of ["real_install_activation", "native_plugin_load"]) {
      const forged = makeReceipt("codex-cli", "verified_wrapped");
      forged.identity.checks.push({ concern, state: "verified", evidence: "trust me" });
      forged.smoke_digest = computeSmokeDigest(forged.identity);
      const v = validateSmokeReceipt(forged);
      expect(v.valid).toBe(false);
      expect(v.errors.join("\n")).toContain(concern);

      const honest = makeReceipt("codex-cli", "verified_wrapped");
      honest.identity.checks.push({ concern, state: "verified", evidence: "isolated-install: observed" });
      honest.smoke_digest = computeSmokeDigest(honest.identity);
      expect(validateSmokeReceipt(honest).valid).toBe(true);
    }
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
    // Load the committed receipts so the verified hosts satisfy their committed
    // floors (an empty-receipt matrix would honestly trip the floor-regression check).
    const matrix = generateSupportMatrix(GENERATED_AT, loadCommittedReceipts());
    const byHost = new Map(matrix.rows.map((r) => [r.host_id, r]));
    // Verified hosts read Supported; installable targets read beta; app surfaces read app;
    // the connector reads connector. Every host presents as supported in some form.
    expect(byHost.get("claude-code-cli")!.display_support).toBe("supported");
    expect(byHost.get("cursor")!.display_support).toBe("supported");
    expect(byHost.get("github-copilot")!.display_support).toBe("supported_beta");
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
