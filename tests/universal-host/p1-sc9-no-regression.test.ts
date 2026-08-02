/**
 * tests/universal-host/p1-sc9-no-regression.test.ts
 *
 * P1 SC-9 — NO REGRESSION (BEHAVIORAL contract-surface tripwire).
 *
 * Scope (read this — the claim is deliberately narrow and fully tested here):
 *   This file is a BEHAVIORAL tripwire over the SHARED contract surfaces that the
 *   downstream P1 lanes (L7–L11) EDIT and that both the P1 and the pre-existing L6
 *   universal-host suites IMPORT. Each assertion CALLS the shipped function with a
 *   known input and asserts a known output — so it fails not only when an export is
 *   renamed/removed, but when a load-bearing export is mutated into a no-op or its
 *   behavior drifts (codex G-lane round-1 MAJOR: export-existence checks are vacuous).
 *
 *   What this file does NOT claim: it is not a re-run of the other suites' own
 *   internal assertions. The LIVE whole-suite no-regression evidence (the full
 *   universal-host + scripts/__tests__ jest run staying green alongside these files)
 *   is recorded in the lane handoff — this file is the cheap always-on guard for the
 *   contract surfaces those suites stand on, not a substitute for running them.
 *
 * Status at authoring: GREEN.
 */

// ── (1) L0 contract surfaces — BEHAVIORAL (these files are edited by L7–L11) ──

import {
  HOST_REGISTRY_ROWS,
  HOST_IDS,
  validateHostRegistryEntry,
} from "../../scripts/lib/host-registry-schema";
import { resolveRoles, validateRoleResolutionSet } from "../../scripts/lib/role-model-schema";
import {
  mayReconcileWrite,
  reconcile,
  type ConfigFieldSpec,
} from "../../scripts/lib/config-reconcile-contract";
import {
  gateRequired,
  resolveBaselineGolden,
  HOST_MODES,
  GATE_TYPES,
  PHASES,
} from "../../scripts/lib/permission-policy-schema";
import { resolveRung } from "../../scripts/lib/adapter-fallback-ladders";
import { deepEqualCanonical, canonicalJSON } from "../../scripts/lib/routing-ab-contract";
import {
  makeAdvisoryRecord,
  validateAdvisoryRecord,
  DEFAULT_ADVISORY_SUBSTRATE,
} from "../../scripts/lib/advisory-record";

describe("P1 SC-9 — L0 contract surfaces BEHAVE (not just exist) after L7–L11 edits", () => {
  it("host-registry: validator accepts a real row, rejects an empty object; 16 canonical ids", () => {
    // Host-adapter migration (R0–R13) + verified-multi-host expansion (G4b): the
    // registry roster is the 16 canonical ids — the original 9 (legacy claude/codex/
    // .agents/pi/antigravity renamed + 4 app/web/connector surfaces) plus the 4
    // wrapped-CLI hosts (cursor/github-copilot/opencode/rovo-dev) and the 3
    // agents-file IDE hosts (kiro/qoder/trae).
    expect(validateHostRegistryEntry(HOST_REGISTRY_ROWS["claude-code-cli"]).valid).toBe(true);
    expect(validateHostRegistryEntry({}).valid).toBe(false); // would pass if validator no-op'd
    expect([...HOST_IDS]).toEqual([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      "kiro",
      "qoder",
      "trae",
    ]);
  });

  it("role-model: default Claude+Codex resolves adversarial=codex(strong) and self-validates", () => {
    const roles = resolveRoles({
      available: [HOST_REGISTRY_ROWS["claude-code-cli"], HOST_REGISTRY_ROWS["codex-cli"]],
    });
    // substrate is the resolved registry host_id — canonical ids post host-adapter migration.
    expect(roles.adversarial.substrate).toBe("codex-cli");
    expect(roles.host.substrate).toBe("claude-code-cli");
    expect(validateRoleResolutionSet(roles).valid).toBe(true);
  });

  it("config-reconcile: never-clobber predicate discriminates user vs default; sync fills missing", () => {
    expect(mayReconcileWrite(undefined)).toBe(true);
    expect(mayReconcileWrite({ key: "k", value: 1, provenance: "user", last_reconciled_at: null })).toBe(false);
    const schema: ConfigFieldSpec[] = [
      { key: "review", type: "string", default: "local", scope: "project", security_sensitive: false },
    ];
    const res = reconcile(schema, {}, "sync", "2026-06-15T00:00:00Z");
    expect(res.wrote).toBe(true);
    expect(res.findings[0].resolved_value).toBe("local");
  });

  it("permission-policy: orthogonality predicate ignores host_mode; golden has 36 cells", () => {
    expect(gateRequired("bypass_all", "ask", "release")).toBe(true); // host bypass never lifts a gate
    expect(gateRequired("ask", "auto-safe", "plan")).toBe(false); // auto-safe permits plan
    expect(Object.keys(resolveBaselineGolden()).length).toBe(36);
    expect(HOST_MODES.length).toBe(5);
    expect(GATE_TYPES.length).toBe(6);
    expect(PHASES.length).toBe(6);
  });

  it("adapter-ladder: resolveRung returns the table rung for a known host, degrades an unknown one", () => {
    // The ladder table is keyed by canonical host ids post host-adapter migration.
    expect(resolveRung("interaction", "claude-code-cli").rung).toBe("native");
    const unknown = resolveRung("interaction", "gemini");
    expect(unknown.rung).toBe("degraded");
    expect(unknown.degraded).toBe(true);
  });

  it("routing-ab: canonical compare is key-order-independent and diff-detecting", () => {
    expect(deepEqualCanonical({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqualCanonical({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("advisory-record: C1 substrate is additive+back-compat; default is claude; gemini rejected", () => {
    const base = {
      id: "advisory-sc9-001",
      recorded_at: "2026-06-15T00:00:00Z",
      phase: "review",
      backend: "single_agent" as const,
      question: "q",
      advisors: [{ role: "architecture", model_tier: "powerful" as const }],
      recommendations: [{ role: "architecture", recommendation: "x", confidence: "high" as const }],
      synthesis: "s",
      confidence: "high" as const,
    };
    const noSub = makeAdvisoryRecord(base);
    expect("substrate" in noSub).toBe(false); // absent ⇒ omitted (byte-identical to pre-P1)
    expect(validateAdvisoryRecord(noSub).valid).toBe(true);
    expect(DEFAULT_ADVISORY_SUBSTRATE).toBe("claude-code-cli"); // canonical id post host-adapter migration
    const bad = makeAdvisoryRecord(base) as unknown as Record<string, unknown>;
    bad.substrate = "gemini"; // still not a known substrate ⇒ rejected (non-vacuity preserved)
    expect(validateAdvisoryRecord(bad).valid).toBe(false); // would pass if validator no-op'd
  });
});

// ── (2) the real route()/selectReviewer() surfaces the SC-4 A/B depends on ───

import { route } from "../../scripts/lib/host-router";
import { selectReviewer, detectProviders } from "../../scripts/lib/provider-detect";
import { claudeHost, codexHost, NOW, makeProbe } from "./_p1-helpers";

describe("P1 SC-9 — the routing surfaces the SC-4 A/B pins BEHAVE", () => {
  it("route() still produces a deterministic claude decision for a team lane", () => {
    const d = route({ taskId: "sc9", tier: "mid", mode: "team" }, [claudeHost(), codexHost()], {
      now: NOW,
      crossHostEnabled: false,
    });
    expect(d.host).toBe("claude");
    expect(d.model).toBe("sonnet");
  });

  it("detectProviders→selectReviewer still selects a different-family reviewer on review=cross (VERIFIED identity)", () => {
    const detection = detectProviders({
      cwd: "/tmp/guild-sc9",
      // T3 (session_context §3): the claude author is asserted explicitly —
      // the retired "auto"/unset ⇒ claude default no longer supplies it.
      // T3 R3-F1: selection additionally REQUIRES verified identity — this
      // no-regression case models the production default box, where the
      // native-adapter marker (CLAUDECODE) verifies the claude author.
      host: "claude",
      trust: "verified",
      probe: makeProbe({ onPath: ["codex"], versionOk: ["codex"], codexStoredAuth: true, pluginAdapters: ["codex-plugin"] }),
    });
    const sel = selectReviewer(detection, { mode: "cross", provider: "auto" });
    expect(sel.status).toBe("selected");
    expect(sel.provider).toBe("codex-plugin");
  });

  it("R3-F1 CORRECTION: an asserted-only author is NEVER selected — the pre-R3 green expectation here encoded a false sign-off", () => {
    // This test previously described the claude host as asserted yet expected
    // codex to be SELECTED — permanently pinning the fail-open bypass. The
    // corrected contract: anything but verified trust degrades; only the
    // verified case above may select.
    const asserted = detectProviders({
      cwd: "/tmp/guild-sc9",
      host: "claude",
      trust: "asserted",
      probe: makeProbe({ onPath: ["codex"], versionOk: ["codex"], codexStoredAuth: true, pluginAdapters: ["codex-plugin"] }),
    });
    const sel = selectReviewer(asserted, { mode: "cross", provider: "auto" });
    expect(sel.status).not.toBe("selected");
    expect(sel.provider).toBeNull();
    expect(sel.reason).toMatch(/not verified|unverified/i);
  });
});

// ── (3) pre-existing L6 contract surfaces still RESOLVE and BEHAVE ───────────

import { normalizeJson, normalizeText } from "../../scripts/lib/equivalence-contract";
import { findContract } from "../../scripts/lib/result-contracts";
import { checkCoverage } from "../../scripts/lib/parity-contract";

describe("P1 SC-9 — pre-existing L6 contract surfaces still behave (adding P1 files cannot shadow them)", () => {
  it("equivalence.normalizeJson is key-order-invariant; normalizeText normalizes concretely (sc2 suite)", () => {
    expect(normalizeJson({ b: 1, a: 2 })).toEqual(normalizeJson({ a: 2, b: 1 }));
    // Concrete input→output: CRLF→LF, per-line trailing whitespace stripped, trailing
    // newlines collapsed to one. A no-op (identity) implementation fails this.
    expect(normalizeText("a \r\nb\t\n\n\n")).toBe("a\nb\n");
    const once = normalizeText("  a\r\n b  ");
    expect(once).toBe("  a\n b"); // leading ws preserved, CRLF→LF, trailing ws stripped
    expect(normalizeText(once)).toBe(once); // and idempotent
  });

  it("result-contracts.findContract resolves a known wire id and refuses an unknown one (sc6 suite)", () => {
    expect(findContract("guild.handoff.v2")?.wire_schema_version).toBe("guild.handoff.v2");
    expect(findContract("definitely.not.a.contract.v1")).toBeUndefined();
  });

  it("parity.checkCoverage still fires its anti-vacuity guard on an empty scan (sc7 suite)", () => {
    // Empty discovery ⇒ the enforced-category guard must report ok:false with reasons —
    // a behavioral assertion that fails if checkCoverage were stubbed to ok:true.
    const r = checkCoverage({} as never, {} as never);
    expect(r.ok).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
