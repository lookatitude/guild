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

const CLAUDE_CODEX: DetectionResult = { authorHost: "claude", providers: [host(), codex(true)] };
const CLAUDE_ONLY: DetectionResult = { authorHost: "claude", providers: [host(), codex(false)] };

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
      providers: [
        host(),
        { id: "gemini-cli", kind: "cli", detected: true, authed: false, selectable: false, family: "gemini", detail: "" },
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
