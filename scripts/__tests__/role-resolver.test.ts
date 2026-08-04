/**
 * scripts/__tests__/role-resolver.test.ts
 *
 * P1-L8 SC-5 — the runtime role resolver: resolution contract (the wired resolver
 * matches the L0 reference), default Claude+Codex resolution == today, advisory
 * routing (substrate stamped on the AdvisoryRecord), and degradation when no
 * different-family adversarial substrate exists.
 */

import {
  resolveRolesForRun,
  availableRegistryRows,
  advisorySubstrateFromRoles,
} from "../lib/role-resolver";
import { resolveRoles } from "../lib/role-model-schema";
import { makeAdvisoryRecord, validateAdvisoryRecord } from "../lib/advisory-record";
import type { DetectionResult, DetectedProvider } from "../lib/provider-detect";

function host(): DetectedProvider {
  return { id: "claude", kind: "host", detected: true, authed: false, selectable: false, family: "claude", detail: "" };
}
function codex(selectable: boolean): DetectedProvider {
  return {
    id: "codex-plugin",
    kind: "plugin-adapter",
    detected: selectable,
    authed: selectable,
    selectable,
    family: "codex",
    detail: "",
  };
}

// R3-F1: DetectionResult.authorTrust is non-optional — the canonical fixtures
// model the production default box, where the native-adapter marker
// (CLAUDECODE) VERIFIES the claude author. Non-verified trust degrades the
// adversarial strength (see the T3 F4 / R3-F1 suites below).
const CLAUDE_CODEX: DetectionResult = { authorHost: "claude", authorTrust: "verified", providers: [host(), codex(true)] };
const CLAUDE_ONLY: DetectionResult = { authorHost: "claude", authorTrust: "verified", providers: [host(), codex(false)] };

describe("P1-L8 role resolver — contract + default==today (SC-5)", () => {
  it("the wired resolver matches the L0 reference for the same inputs", () => {
    for (const det of [CLAUDE_CODEX, CLAUDE_ONLY]) {
      const wired = resolveRolesForRun(det);
      const reference = resolveRoles({ available: availableRegistryRows(det) });
      expect(wired).toEqual(reference);
    }
  });

  it("default Claude+Codex box resolves to canonical Claude/Codex substrates", () => {
    const r = resolveRolesForRun(CLAUDE_CODEX);
    expect(r.host).toMatchObject({ substrate: "claude-code-cli", strength: "strong" });
    expect(r.advisory).toMatchObject({ substrate: "claude-code-cli", strength: "strong" });
    expect(r.adversarial).toMatchObject({ substrate: "codex-cli", strength: "strong" });
  });

  it("Claude-only box ⇒ adversarial degrades (no different-family result_adapter)", () => {
    const r = resolveRolesForRun(CLAUDE_ONLY);
    expect(r.host).toMatchObject({ substrate: "claude-code-cli", strength: "strong" });
    expect(r.advisory).toMatchObject({ substrate: "claude-code-cli", strength: "strong" });
    expect(r.adversarial.substrate).toBeNull();
    expect(r.adversarial.strength).toBe("weak");
  });

  it("availableRegistryRows drops families with no registry row (gemini, D10) and keeps registry order", () => {
    const det: DetectionResult = {
      authorHost: "claude",
      authorTrust: "verified",
      providers: [
        host(),
        // gemini family was dropped (D10) — it is no longer a HostFamily, so cast a
        // raw legacy "gemini" string to exercise the "no registry row ⇒ dropped" path.
        { id: "gemini-cli", kind: "cli", detected: true, authed: false, selectable: false, family: "gemini" as unknown as DetectedProvider["family"], detail: "" },
        codex(true),
      ],
    };
    const rows = availableRegistryRows(det);
    expect(rows.map((r) => r.host_id)).toEqual([
      "claude-code-cli",
      "codex-cli",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
    ]); // gemini dropped; registry order
  });
});

describe("P1-L8 advisory routing — substrate stamped on the record (C1)", () => {
  it("advisorySubstrateFromRoles returns the resolved advisory substrate", () => {
    const roles = resolveRolesForRun(CLAUDE_CODEX);
    expect(advisorySubstrateFromRoles(roles)).toBe("claude-code-cli");
  });

  it("the routed substrate is actually recorded on a valid AdvisoryRecord", () => {
    const roles = resolveRolesForRun(CLAUDE_CODEX);
    const substrate = advisorySubstrateFromRoles(roles);
    const rec = makeAdvisoryRecord({
      id: "adv-1",
      recorded_at: "2026-06-15T12:00:00Z",
      phase: "build",
      backend: "single_agent",
      question: "is this right?",
      advisors: [],
      recommendations: [],
      synthesis: "yes",
      confidence: "high",
      run_id: "run-x",
      substrate,
    });
    expect(validateAdvisoryRecord(rec).valid).toBe(true);
    expect(rec.substrate).toBe("claude-code-cli");
  });
});


// ── T3 rework F4 — asserted-identity clamp (session_context §3: asserted ⇒ weak) ──

describe("T3 F4 — asserted author identity clamps adversarial strength", () => {
  it("asserted trust: a would-be strong different-family adversarial resolves WEAK with the downgrade reason", () => {
    const det: DetectionResult = { authorHost: "claude", authorTrust: "asserted", providers: [host(), codex(true)] };
    const r = resolveRolesForRun(det);
    expect(r.adversarial.substrate).toBe("codex-cli");
    expect(r.adversarial.strength).toBe("weak");
    expect(r.adversarial.reason).toMatch(/not verified|unverified/i);
    expect(r.adversarial.reason).toMatch(/trust: asserted/);
    // host/advisory are capability claims, not independence claims — unclamped.
    expect(r.host.strength).toBe("strong");
    expect(r.advisory.strength).toBe("strong");
  });

  it("verified trust: strength strong is preserved (anti-vacuity)", () => {
    const det: DetectionResult = { authorHost: "claude", authorTrust: "verified", providers: [host(), codex(true)] };
    expect(resolveRolesForRun(det).adversarial).toMatchObject({ substrate: "codex-cli", strength: "strong" });
  });

  it("OMITTED trust (rogue plain-JS caller) fails CLOSED: adversarial degrades to weak (R3-F1)", () => {
    // R3-F1 CORRECTION: the pre-R3 expectation here ("absent trust: behavior
    // unchanged" ⇒ strong) encoded the fail-open trust hole — an omitted
    // authorTrust bypassed the asserted clamp and let an unverified author
    // keep a STRONG cross-family sign-off. The corrected contract requires
    // `verified` for strong; absent trust degrades exactly like asserted.
    const det = { authorHost: "claude", providers: [host(), codex(true)] } as unknown as DetectionResult;
    const r = resolveRolesForRun(det);
    expect(r.adversarial.substrate).toBe("codex-cli");
    expect(r.adversarial.strength).toBe("weak");
    expect(r.adversarial.reason).toMatch(/not verified|unverified/i);
    // host/advisory are capability claims, not independence claims — unclamped.
    expect(r.host.strength).toBe("strong");
    expect(r.advisory.strength).toBe("strong");
  });
});
