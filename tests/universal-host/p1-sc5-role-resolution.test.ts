/**
 * tests/universal-host/p1-sc5-role-resolution.test.ts
 *
 * P1 SC-5 — ROLE-RESOLUTION CONTRACT + ADVISORY-ROUTING substrate.
 *
 * The default Claude+Codex resolution MUST reproduce today's implicit behavior:
 *   host = claude (strong), advisory = claude (strong — the local advisor runs on
 *   the host), adversarial = codex (strong — different family ⇒ cross-host
 *   independence). Resolution reads the registry COLUMNS, never the host name.
 *
 * The advisory-routing substrate (C1) is the routing TARGET L8 will populate from
 * `roles.advisory`: the AdvisoryRecord gains an optional `substrate` that is
 * back-compatible (absent ⇒ default "claude") and closed to the five registry
 * hosts — an unknown substrate ("gemini") is REJECTED.
 *
 * REAL PATH (no seam): tests drive the SHIPPED `resolveRoles()` reference predicate
 * over real `HOST_REGISTRY_ROWS`, and the SHIPPED `validateRoleResolutionSet()` /
 * `validateAdvisoryRecord()` / `makeAdvisoryRecord()`. The resolver output is fed
 * back through its own validator (round-trip), so a resolution that produces an
 * invalid set fails. Fail-fixtures (gemini substrate; unknown role substrate) are
 * the RED discriminators.
 *
 * Status at authoring: GREEN (P1-L0 shipped the role model + C1 substrate field).
 * L8 wires resolveRoles into preflight/execute-plan/review-broker — its wired
 * resolver must match this reference (asserted live when L8 lands; see report).
 */

import {
  resolveRoles,
  validateRoleResolutionSet,
  type RoleResolutionSet,
} from "../../scripts/lib/role-model-schema";
import {
  HOST_REGISTRY_ROWS,
  type HostRegistryEntry,
} from "../../scripts/lib/host-registry-schema";
import {
  makeAdvisoryRecord,
  validateAdvisoryRecord,
  ADVISORY_SUBSTRATES,
  DEFAULT_ADVISORY_SUBSTRATE,
  type AdvisoryRecord,
} from "../../scripts/lib/advisory-record";

const CLAUDE = HOST_REGISTRY_ROWS["claude-code-cli"];
const CODEX = HOST_REGISTRY_ROWS["codex-cli"];

// ── Default Claude+Codex resolution == today ────────────────────────────────

describe("P1 SC-5 — resolveRoles default Claude+Codex == today", () => {
  const roles = resolveRoles({ available: [CLAUDE, CODEX] });

  it("host = claude-code-cli, strong", () => {
    expect(roles.host.substrate).toBe("claude-code-cli");
    expect(roles.host.strength).toBe("strong");
  });

  it("advisory = claude-code-cli, strong (local advisor runs on the host)", () => {
    expect(roles.advisory.substrate).toBe("claude-code-cli");
    expect(roles.advisory.strength).toBe("strong");
    expect(roles.advisory.reason).toMatch(/host substrate|local advisor/i);
  });

  it("adversarial = codex-cli, strong (different family ⇒ cross-host independence)", () => {
    expect(roles.adversarial.substrate).toBe("codex-cli");
    expect(roles.adversarial.strength).toBe("strong");
    expect(roles.adversarial.reason).toMatch(/different-family|cross-host independence/i);
  });

  it("the resolved set round-trips through its own validator", () => {
    const r = validateRoleResolutionSet(roles);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(roles.schema_version).toBe("guild.role_resolution.v1");
  });
});

// ── Degradation paths (the independence axis) ───────────────────────────────

describe("P1 SC-5 — adversarial independence degradation", () => {
  it("solo-claude box: adversarial degrades (no different-family result_adapter)", () => {
    const roles = resolveRoles({ available: [CLAUDE] });
    expect(roles.host.substrate).toBe("claude-code-cli");
    expect(roles.advisory.substrate).toBe("claude-code-cli"); // advisory still strong on host
    expect(roles.adversarial.substrate).toBeNull();
    expect(roles.adversarial.strength).toBe("weak");
    expect(validateRoleResolutionSet(roles).valid).toBe(true);
  });

  it("only a SAME-family result_adapter ⇒ adversarial weak (independence lost)", () => {
    // A second claude-family substrate that DOES carry a result_adapter. resolveRoles
    // must pick it but mark weak, because it is the same family as the host.
    const claudeFamilyReviewer: HostRegistryEntry = {
      ...CODEX,
      host_id: "claude-code-app", // same (claude) family as host
      family: "claude",
      result_adapter: true,
    };
    const roles = resolveRoles({ available: [CLAUDE, claudeFamilyReviewer] });
    expect(roles.host.substrate).toBe("claude-code-cli");
    expect(roles.adversarial.substrate).toBe("claude-code-app");
    expect(roles.adversarial.strength).toBe("weak");
    expect(roles.adversarial.reason).toMatch(/same-family|independence lost/i);
  });

  it("prefers a DIFFERENT-family reviewer over a same-family one for strong independence", () => {
    const sameFamily: HostRegistryEntry = {
      ...CLAUDE,
      host_id: "claude-code-app",
      family: "claude",
      result_adapter: true,
    };
    // Both a same-family and a different-family (codex) result_adapter present ⇒ codex wins, strong.
    const roles = resolveRoles({ available: [CLAUDE, sameFamily, CODEX] });
    expect(roles.adversarial.substrate).toBe("codex-cli");
    expect(roles.adversarial.strength).toBe("strong");
  });
});

// ── Role-set validator fail-fixtures (RED discriminators) ───────────────────

describe("P1 SC-5 — role-set validator fail-closed", () => {
  const good: RoleResolutionSet = resolveRoles({ available: [CLAUDE, CODEX] });

  it("rejects an unknown substrate host (e.g. gemini) — codex G-lane finding", () => {
    const bad = {
      ...good,
      adversarial: { ...good.adversarial, substrate: "gemini" },
    };
    const r = validateRoleResolutionSet(bad);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/substrate/);
  });

  it("rejects a wrong role tag, a bad strength, and an empty reason", () => {
    expect(
      validateRoleResolutionSet({ ...good, host: { ...good.host, role: "advisory" } }).valid
    ).toBe(false);
    expect(
      validateRoleResolutionSet({ ...good, advisory: { ...good.advisory, strength: "medium" } }).valid
    ).toBe(false);
    expect(
      validateRoleResolutionSet({ ...good, adversarial: { ...good.adversarial, reason: "" } }).valid
    ).toBe(false);
  });

  it("rejects a non-object / wrong schema_version", () => {
    expect(validateRoleResolutionSet(null).valid).toBe(false);
    expect(validateRoleResolutionSet({ ...good, schema_version: "guild.role_resolution.v2" }).valid).toBe(false);
  });
});

// ── Advisory substrate (C1) — the L8 routing target ─────────────────────────

describe("P1 SC-5 — advisory substrate (C1, additive + back-compatible)", () => {
  function baseInput() {
    return {
      id: "advisory-p1-sc5-001",
      recorded_at: "2026-06-15T12:00:00Z",
      phase: "review",
      backend: "single_agent" as const,
      question: "Is the registry unification behavior-preserving?",
      advisors: [{ role: "architecture", model_tier: "powerful" as const }],
      recommendations: [
        { role: "architecture", recommendation: "ship", confidence: "high" as const },
      ],
      synthesis: "behavior-preserving",
      confidence: "high" as const,
    };
  }

  it("the substrate enum is the nine canonical registry hosts + five legacy aliases (default = claude-code-cli)", () => {
    // Post host-adapter-migration: the canonical 9 host ids, followed by the 5
    // retained legacy aliases (claude/codex/.agents/pi/antigravity) so older
    // advisory records still validate. Default flips to the canonical claude-code-cli.
    expect([...ADVISORY_SUBSTRATES]).toEqual([
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      "claude",
      "codex",
      ".agents",
      "pi",
      "antigravity",
    ]);
    expect(DEFAULT_ADVISORY_SUBSTRATE).toBe("claude-code-cli");
  });

  it("ABSENT substrate ⇒ field omitted (byte-identical to a pre-P1 record) + validates", () => {
    const rec = makeAdvisoryRecord(baseInput());
    expect("substrate" in rec).toBe(false); // not serialized when absent
    expect(validateAdvisoryRecord(rec).valid).toBe(true);
  });

  it("a supplied substrate (codex-cli) is carried + validates", () => {
    const rec = makeAdvisoryRecord({ ...baseInput(), substrate: "codex-cli" });
    expect(rec.substrate).toBe("codex-cli");
    expect(validateAdvisoryRecord(rec).valid).toBe(true);
  });

  it("every enum substrate value validates (incl. .agents/pi/antigravity)", () => {
    for (const s of ADVISORY_SUBSTRATES) {
      const rec = makeAdvisoryRecord({ ...baseInput(), substrate: s });
      expect(validateAdvisoryRecord(rec).valid).toBe(true);
    }
  });

  it("REJECTS an unknown substrate (gemini) — the routing target is closed", () => {
    const rec = makeAdvisoryRecord(baseInput());
    const raw = rec as unknown as Record<string, unknown>;
    raw.substrate = "gemini";
    const r = validateAdvisoryRecord(raw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/substrate/);
  });
});
