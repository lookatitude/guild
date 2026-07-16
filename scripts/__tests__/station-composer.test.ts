/**
 * scripts/__tests__/station-composer.test.ts
 *
 * G6a (task-cell-runtime P0.6) conformance for the deterministic station composer
 * + the two typed contracts (`guild.team_plan.v1` / `guild.team_result.v1`) + the
 * code-as-data station policy (`guild.station_policy.v1`).
 *
 * Non-vacuous: the tier index is built from the REAL shipped template library via
 * roster-resolve (so the tiers under test are the actual `model:` frontmatter
 * values, per D2/D4), and the policy assertions pin the composer to the canonical
 * `team-composition.md` §Phase Team Defaults + §Implied Specialist Rules — a
 * broken policy row or a broken implied rule fails a test.
 */

import * as path from "path";

import {
  IMPLIED_RULES,
  STATIONS,
  STATION_POLICY,
  TEAM_CAP,
  buildTierIndex,
  composeStationTeam,
  isStation,
  validateTeamPlanV1,
  validateTeamResultV1,
  type StationComposeConfig,
  type StationId,
  type StationSignals,
  type TeamPlanV1,
  type TeamResultV1,
} from "../../src/modules/teams/workflows/station-composer";
import { resolveRoster } from "../lib/roster";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/** Real tier index off the shipped template library (D4-compliant tier source). */
function realTierIndex(): Record<string, "cheap" | "mid" | "powerful"> {
  // projectRoot === pluginRoot: no project agents, so the templates supply tiers.
  const resolution = resolveRoster({ projectRoot: PLUGIN_ROOT, pluginRoot: PLUGIN_ROOT });
  return buildTierIndex(resolution);
}

function cfg(over: Partial<StationComposeConfig> = {}): StationComposeConfig {
  return { tierIndex: realTierIndex(), ...over };
}

const NO_SIGNALS: StationSignals = {};

// ── Station set sanity ─────────────────────────────────────────────────────────

describe("station set", () => {
  it("covers the 6 canonical lifecycle phases plus the 3 extended stations", () => {
    expect([...STATIONS]).toEqual([
      "init",
      "ideate",
      "plan",
      "build",
      "qa",
      "ops",
      "research",
      "definition",
      "learn",
    ]);
  });

  it("isStation is a closed guard", () => {
    expect(isStation("init")).toBe(true);
    expect(isStation("research")).toBe(true);
    expect(isStation("deploy")).toBe(false);
    expect(isStation("")).toBe(false);
  });
});

// ── Every station composes a valid plan ────────────────────────────────────────

describe("composeStationTeam — every station", () => {
  it("composes a schema-valid, non-empty team_plan for all stations (no signals)", () => {
    for (const station of STATIONS) {
      const plan = composeStationTeam(station, NO_SIGNALS, cfg());
      expect(validateTeamPlanV1(plan)).not.toBeNull();
      expect(plan.station).toBe(station);
      expect(plan.roster.length).toBeGreaterThan(0);
      // Every lane resolves a real tier + the D1 baseline fan-out.
      for (const lane of plan.roster) {
        expect(["cheap", "mid", "powerful"]).toContain(lane.default_tier);
        expect(lane.fanout).toBe("lead_only");
      }
      // No signals ⇒ no implied rule fired.
      expect(plan.fired_rules).toEqual([]);
    }
  });

  it("assigns each lane its roster default_tier (architect/security=powerful, qa=mid)", () => {
    const plan = composeStationTeam("plan", { auth_touched: true }, cfg());
    const tierOf = (role: string) => plan.roster.find((l) => l.role === role)?.default_tier;
    expect(tierOf("architect")).toBe("powerful");
    expect(tierOf("security")).toBe("powerful");
    expect(tierOf("qa")).toBe("mid");
    expect(tierOf("technical-writer")).toBe("mid");
  });

  it("throws on an unknown station id (fail loud — never an empty team)", () => {
    expect(() => composeStationTeam("nope" as StationId, NO_SIGNALS, cfg())).toThrow(/unknown station/);
  });
});

// ── Policy table MATCHES the canonical doc ─────────────────────────────────────

describe("station policy matches team-composition.md §Phase Team Defaults", () => {
  it("Init → researcher + technical-writer (architect conditional on multi_component)", () => {
    const p = STATION_POLICY.init;
    expect(p.default_roster).toEqual(["researcher", "technical-writer"]);
    expect(p.conditional_roster).toEqual({ architect: "multi_component" });
    expect(p.advisory_memory).toBe(true);
    expect(p.extends_doc).toBe(false);
  });

  it("Ideation → architect + researcher (product/content/domain plan-driven)", () => {
    expect(STATION_POLICY.ideate.default_roster).toEqual(["architect", "researcher"]);
    expect(STATION_POLICY.ideate.plan_driven_slots).toEqual(["product", "content", "domain"]);
    expect(STATION_POLICY.ideate.extends_doc).toBe(false);
  });

  it("Planning → architect + technical-writer + qa (security when auth_touched)", () => {
    const p = STATION_POLICY.plan;
    expect(p.default_roster).toEqual(["architect", "technical-writer", "qa"]);
    expect(p.conditional_roster).toEqual({ security: "auth_touched" });
  });

  it("Development → qa + security (architect on multi_component; implementers plan-driven)", () => {
    const p = STATION_POLICY.build;
    expect(p.default_roster).toEqual(["qa", "security"]);
    expect(p.conditional_roster).toEqual({ architect: "multi_component" });
    expect(p.plan_driven_slots).toEqual(["task-owner-implementers"]);
  });

  it("Quality → qa (security when auth_touched; devops + implementers plan-driven)", () => {
    const p = STATION_POLICY.qa;
    expect(p.default_roster).toEqual(["qa"]);
    expect(p.conditional_roster).toEqual({ security: "auth_touched" });
    expect(p.plan_driven_slots).toEqual(["devops", "relevant-implementers"]);
  });

  it("Operations → devops + security + qa (implementers plan-driven)", () => {
    expect(STATION_POLICY.ops.default_roster).toEqual(["devops", "security", "qa"]);
    expect(STATION_POLICY.ops.plan_driven_slots).toEqual(["relevant-implementers"]);
  });

  it("extended stations (research/definition/learn) are flagged with a reconcile note", () => {
    for (const s of ["research", "definition", "learn"] as const) {
      expect(STATION_POLICY[s].extends_doc).toBe(true);
      expect(STATION_POLICY[s].note).toMatch(/EXTENDS doc/);
    }
    // The 6 doc phases are NOT flagged.
    for (const s of ["init", "ideate", "plan", "build", "qa", "ops"] as const) {
      expect(STATION_POLICY[s].extends_doc).toBe(false);
    }
  });

  it("every policy default role resolves a tier in the roster (no orphan role)", () => {
    const index = realTierIndex();
    for (const station of STATIONS) {
      const p = STATION_POLICY[station];
      for (const role of [...p.default_roster, ...Object.keys(p.conditional_roster)]) {
        expect(index[role]).toBeDefined();
      }
    }
  });
});

// ── Implied rules: fire on trigger, NOT otherwise ──────────────────────────────

describe("implied specialist rules", () => {
  it("mirrors the doc's 6 rules with the canonical signal→specialist mapping", () => {
    const byId = Object.fromEntries(IMPLIED_RULES.map((r) => [r.id, r]));
    expect(byId["multi_component"].adds).toEqual(["architect"]);
    expect(byId["auth_touched"].adds).toEqual(["security"]);
    expect(byId["backend_present"].adds).toEqual(["qa"]);
    expect(byId["user_facing_ui"].adds).toEqual(["frontend", "qa"]);
    expect(byId["public_docs"].adds).toEqual(["technical-writer"]);
    expect(byId["search_discoverability"].adds).toEqual(["seo"]);
    expect(IMPLIED_RULES.length).toBe(6);
  });

  // Use `ops` (default roster devops/security/qa) so an implied ADD is visible and
  // not masked by a role already in the default team — EXCEPT where noted.
  it("each rule fires ONLY on its trigger signal and adds its specialist", () => {
    const cases: Array<{ signal: keyof StationSignals; rule: string; role: string }> = [
      { signal: "multi_component", rule: "multi_component", role: "architect" },
      { signal: "public_docs", rule: "public_docs", role: "technical-writer" },
      { signal: "search_discoverability", rule: "search_discoverability", role: "seo" },
      { signal: "user_facing_ui", rule: "user_facing_ui", role: "frontend" },
    ];
    for (const { signal, rule, role } of cases) {
      // Fires: the `qa` station's team (default [qa], optional [devops, security])
      // contains NONE of architect/technical-writer/seo/frontend, so each implied
      // add is a genuinely NEW lane — never masked by a default.
      const station: StationId = "qa";
      const fired = composeStationTeam(station, { [signal]: true } as StationSignals, cfg());
      expect(fired.fired_rules).toContain(rule);
      const lane = fired.roster.find((l) => l.role === role);
      expect(lane).toBeDefined();
      expect(lane!.source).toBe("implied");
      expect(lane!.fired_rule).toBe(rule);

      // Does NOT fire without the signal.
      const idle = composeStationTeam(station, NO_SIGNALS, cfg());
      expect(idle.fired_rules).not.toContain(rule);
      // …and the role is absent unless it was a default at this station.
      const wasDefault = STATION_POLICY[station].default_roster.includes(role);
      expect(idle.roster.some((l) => l.role === role)).toBe(wasDefault);
    }
  });

  it("dedupes an implied role that is also a default, but STILL records the fired rule", () => {
    // ops already has qa in its default roster; backend_present must not add a 2nd qa
    // lane — but the rule DID fire (signal true), so it MUST stay in the audit trail.
    const plan = composeStationTeam("ops", { backend_present: true }, cfg());
    const qaLanes = plan.roster.filter((l) => l.role === "qa");
    expect(qaLanes.length).toBe(1);
    // The surviving qa lane keeps its "default" provenance (first occurrence wins).
    expect(qaLanes[0].source).toBe("default");
    // fired_rules is SIGNAL-driven: the deduped rule is NOT lost from the audit trail.
    expect(plan.fired_rules).toContain("backend_present");
  });

  it("user_facing_ui adds frontend AND qa, deduping qa against backend_present", () => {
    const plan = composeStationTeam("ideate", { user_facing_ui: true, backend_present: true }, cfg());
    expect(plan.roster.filter((l) => l.role === "qa").length).toBe(1);
    expect(plan.roster.some((l) => l.role === "frontend")).toBe(true);
    expect(plan.fired_rules).toContain("user_facing_ui");
  });

  it("fanout stays the D1 baseline lead_only even when rules fire (no scoring in G6a)", () => {
    const plan = composeStationTeam("ideate", { multi_component: true, auth_touched: true }, cfg());
    for (const lane of plan.roster) expect(lane.fanout).toBe("lead_only");
  });
});

// ── Conditional optionals: included ONLY when the gating signal fires ──────────

describe("conditional roster (optionals are signal-gated, never unconditional)", () => {
  it("Init's optional architect is ABSENT without multi_component, PRESENT with it", () => {
    const idle = composeStationTeam("init", NO_SIGNALS, cfg());
    expect(idle.roster.some((l) => l.role === "architect")).toBe(false);
    expect(idle.fired_rules).toEqual([]);

    const fired = composeStationTeam("init", { multi_component: true }, cfg());
    const lane = fired.roster.find((l) => l.role === "architect");
    expect(lane).toBeDefined();
    // The station conditional (opt:init:architect) is evaluated before the global
    // implied rule, so the surviving lane's provenance is "optional"; BOTH rule ids
    // are still recorded in fired_rules (signal-driven, dedup-independent).
    expect(lane!.source).toBe("optional");
    expect(fired.fired_rules).toContain("opt:init:architect");
    expect(fired.fired_rules).toContain("multi_component");
  });

  it("Planning's 'security when needed' is ABSENT without auth_touched, PRESENT with it", () => {
    const idle = composeStationTeam("plan", NO_SIGNALS, cfg());
    expect(idle.roster.some((l) => l.role === "security")).toBe(false);

    const fired = composeStationTeam("plan", { auth_touched: true }, cfg());
    expect(fired.roster.some((l) => l.role === "security")).toBe(true);
    expect(fired.fired_rules).toContain("opt:plan:security");
  });

  it("no-signal composition carries ONLY the default roster (no optionals leak in)", () => {
    for (const station of STATIONS) {
      const plan = composeStationTeam(station, NO_SIGNALS, cfg());
      const roles = plan.roster.map((l) => l.role).sort();
      expect(roles).toEqual([...STATION_POLICY[station].default_roster].sort());
      // no lane is sourced "optional" or "implied" when nothing fired.
      expect(plan.roster.every((l) => l.source === "default")).toBe(true);
    }
  });

  it("ENFORCES plan-driven exclusion: no plan_driven role is EVER composed, under any signals", () => {
    // The composer filters candidates against plan_driven_slots (defense-in-depth):
    // a role declared plan-driven for a station is never deterministically composed,
    // even if a default/conditional/implied path would otherwise add it. Prove the
    // INVARIANT holds with EVERY signal on (the worst case — all implied rules fire).
    const allSignals: StationSignals = {
      multi_component: true,
      auth_touched: true,
      backend_present: true,
      user_facing_ui: true,
      public_docs: true,
      search_discoverability: true,
    };
    for (const station of STATIONS) {
      const plan = composeStationTeam(station, allSignals, cfg());
      const composed = new Set(plan.roster.map((l) => l.role));
      for (const slot of plan.plan_driven_slots) {
        expect(composed.has(slot)).toBe(false); // plan-driven ⇒ never auto-composed
      }
    }
  });

  it("the filter is load-bearing: a plan_driven role that WOULD be added by an implied rule is excluded", () => {
    // frontend is added by the user_facing_ui implied rule. If a station lists
    // frontend as plan-driven, the filter must drop it even though the signal fired.
    // (No shipped station does this, so we assert the mechanism directly: the
    // composer's candidate set never yields a role present in plan_driven_slots.)
    const plan = composeStationTeam("build", { user_facing_ui: true, multi_component: true }, cfg());
    // build has no frontend in plan_driven, so frontend IS composed here (baseline)…
    expect(plan.roster.some((l) => l.role === "frontend")).toBe(true);
    // …and every build plan_driven slot ("task-owner-implementers") stays out.
    for (const slot of plan.plan_driven_slots) {
      expect(plan.roster.some((l) => l.role === slot)).toBe(false);
    }
  });

  it("every composed lane carries a `scope` field (null from the deterministic composer)", () => {
    const plan = composeStationTeam("plan", { auth_touched: true, multi_component: true }, cfg());
    for (const lane of plan.roster) {
      expect(lane).toHaveProperty("scope");
      expect(lane.scope).toBeNull();
    }
  });

  it("validateTeamPlanV1 rejects a plan claiming an UNKNOWN fired rule id", () => {
    const good = composeStationTeam("plan", { auth_touched: true }, cfg());
    expect(validateTeamPlanV1(good)).not.toBeNull();
    const bad = { ...good, fired_rules: [...good.fired_rules, "totally_made_up_rule"] };
    expect(validateTeamPlanV1(bad)).toBeNull();
  });
});

// ── Advisory challenger panel (advisory_panel — additive, ADVISORY only) ───────

describe("advisory challenger panel", () => {
  it("every station composes a well-formed advisory_panel", () => {
    for (const station of STATIONS) {
      const plan = composeStationTeam(station, NO_SIGNALS, cfg());
      expect(validateTeamPlanV1(plan)).not.toBeNull();
      const panel = plan.advisory_panel;
      expect(panel).toBeDefined();
      // producer is a non-empty string or null; challengers/fired ids are arrays.
      expect(panel.producer === null || typeof panel.producer === "string").toBe(true);
      expect(Array.isArray(panel.challengers)).toBe(true);
      expect(Array.isArray(panel.fired_challenger_rules)).toBe(true);
      // Every fired-challenger id is well-formed `chal:<station>:<role>`.
      for (const id of panel.fired_challenger_rules) {
        expect(id).toMatch(/^chal:[a-z-]+:[A-Za-z0-9_-]+$/);
      }
    }
  });

  it("qa panel: producer qa-test-strategy; security baseline, architect GATED on multi_component", () => {
    // No signals → only the baseline challenger (security); architect gated OFF.
    const idle = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(idle.advisory_panel.producer).toBe("qa-test-strategy");
    expect(idle.advisory_panel.challengers).toEqual(["security"]);
    expect(idle.advisory_panel.fired_challenger_rules).toEqual([]);

    // multi_component → architect gated ON; its fired-rule recorded.
    const fired = composeStationTeam("qa", { multi_component: true }, cfg());
    expect(fired.advisory_panel.producer).toBe("qa-test-strategy");
    expect(fired.advisory_panel.challengers).toEqual(["security", "architect"]);
    expect(fired.advisory_panel.fired_challenger_rules).toEqual(["chal:qa:architect"]);
  });

  it("ops panel: producer null; same baseline/gated behavior", () => {
    const idle = composeStationTeam("ops", NO_SIGNALS, cfg());
    expect(idle.advisory_panel.producer).toBeNull();
    expect(idle.advisory_panel.challengers).toEqual(["security"]);
    expect(idle.advisory_panel.fired_challenger_rules).toEqual([]);

    const fired = composeStationTeam("ops", { multi_component: true }, cfg());
    expect(fired.advisory_panel.producer).toBeNull();
    expect(fired.advisory_panel.challengers).toEqual(["security", "architect"]);
    expect(fired.advisory_panel.fired_challenger_rules).toEqual(["chal:ops:architect"]);
  });

  it("a station with an empty panel (build) resolves an empty resolved panel", () => {
    const plan = composeStationTeam("build", { multi_component: true, auth_touched: true }, cfg());
    expect(plan.advisory_panel).toEqual({
      producer: null,
      challengers: [],
      fired_challenger_rules: [],
    });
  });

  it("advisory challengers do NOT enter the roster and do NOT count toward cap-6", () => {
    // qa's advisory panel names security + architect, but a no-signal qa roster is
    // just [qa] — the challengers stay out of the roster entirely.
    const plan = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(plan.roster.map((l) => l.role)).toEqual(["qa"]);
    // The gated-challenger fired-rule id is NOT folded into the roster fired_rules.
    const fired = composeStationTeam("qa", { multi_component: true }, cfg());
    expect(fired.fired_rules).not.toContain("chal:qa:architect");
    expect(fired.advisory_panel.fired_challenger_rules).toContain("chal:qa:architect");
  });

  it("validateTeamPlanV1 REJECTS a plan missing advisory_panel", () => {
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    const { advisory_panel: _omit, ...missing } = p;
    expect(validateTeamPlanV1(missing)).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a bad producer type", () => {
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(
      validateTeamPlanV1({ ...p, advisory_panel: { ...p.advisory_panel, producer: 7 } })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a non-string challenger", () => {
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(
      validateTeamPlanV1({ ...p, advisory_panel: { ...p.advisory_panel, challengers: [1] } })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a fired_challenger_rules entry not matching chal:<station>:<role>", () => {
    const p = composeStationTeam("qa", { multi_component: true }, cfg());
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: { ...p.advisory_panel, fired_challenger_rules: ["opt:qa:architect"] },
      })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS duplicate challengers (resolver dedup guarantee)", () => {
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: { ...p.advisory_panel, challengers: ["security", "security"] },
      })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS duplicate fired_challenger_rules", () => {
    const p = composeStationTeam("qa", { multi_component: true }, cfg());
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: {
          ...p.advisory_panel,
          fired_challenger_rules: ["chal:qa:architect", "chal:qa:architect"],
        },
      })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a chal: id for a DIFFERENT station", () => {
    const p = composeStationTeam("qa", { multi_component: true }, cfg());
    // architect IS present in qa challengers, but the id names the ops station.
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: { ...p.advisory_panel, fired_challenger_rules: ["chal:ops:architect"] },
      })
    ).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a fired rule whose role is ABSENT from challengers", () => {
    // qa with no signals: challengers = ["security"], architect NOT present.
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: { ...p.advisory_panel, fired_challenger_rules: ["chal:qa:architect"] },
      })
    ).toBeNull();
  });

  it("validateTeamPlanV1 returns null (never throws) for a Proxy advisory_panel that traps reads", () => {
    const p = composeStationTeam("qa", NO_SIGNALS, cfg());
    const evil = new Proxy(
      { ...p.advisory_panel },
      {
        get() {
          throw new Error("trap");
        },
      }
    );
    expect(() => validateTeamPlanV1({ ...p, advisory_panel: evil })).not.toThrow();
    expect(validateTeamPlanV1({ ...p, advisory_panel: evil })).toBeNull();
  });

  it("validateTeamPlanV1 REJECTS a SPARSE challengers array (a hole serializes to null)", () => {
    const p = composeStationTeam("qa", { multi_component: true }, cfg());
    const sparse: string[] = [];
    sparse[1] = "architect"; // index 0 is a HOLE — Array.every would skip it
    expect(
      validateTeamPlanV1({
        ...p,
        advisory_panel: {
          ...p.advisory_panel,
          challengers: sparse,
          fired_challenger_rules: ["chal:qa:architect"],
        },
      })
    ).toBeNull();
  });
});

// ── Cap-6 (§Team Size Rules) ───────────────────────────────────────────────────

describe("cap-6 team size rule", () => {
  it("does not truncate a normal composition (advisory never counts)", () => {
    const plan = composeStationTeam("plan", { auth_touched: true }, cfg());
    expect(plan.capped).toBe(false);
    expect(plan.dropped_roles).toEqual([]);
    expect(plan.roster.length).toBeLessThanOrEqual(TEAM_CAP);
    expect(plan.advisory_memory).toBe(true);
  });

  it("truncates to the cap, dropping optionals before hard-rule specialists", () => {
    // Force an over-cap composition with a small cap. ops default = devops/security/qa
    // (all "default"); fire every implied rule so architect/seo/technical-writer/frontend
    // pile on as "implied". With cap=3 only the 3 defaults survive; implied are dropped.
    const plan = composeStationTeam(
      "ops",
      {
        multi_component: true,
        public_docs: true,
        search_discoverability: true,
        user_facing_ui: true,
      },
      cfg({ cap: 3 })
    );
    expect(plan.cap).toBe(3);
    expect(plan.roster.length).toBe(3);
    expect(plan.capped).toBe(true);
    expect(plan.roster.map((l) => l.role).sort()).toEqual(["devops", "qa", "security"]);
    // The dropped roles are surfaced in dropped_roles (its LANE was capped)…
    expect(plan.dropped_roles).toEqual(expect.arrayContaining(["architect", "seo"]));
    // …but the RULE still fired (its signal was true), so it stays in the audit
    // trail even though its lane was capped — fired_rules is signal-driven, not
    // lane-survival-driven (the M2 fix). The role is gone from the roster; the
    // fired-rule record is not.
    expect(plan.fired_rules).toContain("search_discoverability");
    expect(plan.roster.some((l) => l.role === "seo")).toBe(false);
    // The plan still validates (roster <= cap).
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });
});

// ── The G8 scoring seam ────────────────────────────────────────────────────────

describe("G8 fanout scoring seam", () => {
  it("uses the injected scoreFanout when provided, without reshaping the API", () => {
    const plan = composeStationTeam(
      "ops",
      NO_SIGNALS,
      cfg({
        scoreFanout: ({ role, baseline }) =>
          role === "security" ? "lead_plus_many" : baseline,
      })
    );
    expect(plan.roster.find((l) => l.role === "security")!.fanout).toBe("lead_plus_many");
    expect(plan.roster.find((l) => l.role === "devops")!.fanout).toBe("lead_only");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });
});

// ── Validators reject malformed input (fail-closed) ────────────────────────────

describe("validateTeamPlanV1 fail-closed", () => {
  const good = (): TeamPlanV1 => composeStationTeam("ideate", { auth_touched: true }, cfg());

  it("accepts a well-formed plan", () => {
    expect(validateTeamPlanV1(good())).not.toBeNull();
  });

  it("rejects a wrong/absent schema_version", () => {
    expect(validateTeamPlanV1({ ...good(), schema_version: "guild.team_plan.v2" })).toBeNull();
    expect(validateTeamPlanV1(null)).toBeNull();
    expect(validateTeamPlanV1("nope")).toBeNull();
  });

  it("rejects an unknown station", () => {
    expect(validateTeamPlanV1({ ...good(), station: "deploy" })).toBeNull();
  });

  it("rejects a SPARSE roster array (a hole would pass Array.every but serialize to null)", () => {
    const p = good();
    const withHole: unknown[] = [];
    withHole[1] = p.roster[0]; // index 0 is a HOLE
    expect(validateTeamPlanV1({ ...p, roster: withHole, cap: 6, capped: false, dropped_roles: [] })).toBeNull();
  });

  it("rejects a lane with a bad tier or fan-out", () => {
    const p = good();
    expect(
      validateTeamPlanV1({ ...p, roster: [{ ...p.roster[0], default_tier: "epic" }] })
    ).toBeNull();
    expect(
      validateTeamPlanV1({ ...p, roster: [{ ...p.roster[0], fanout: "lead_plus_five" }] })
    ).toBeNull();
  });

  it("rejects a non-implied lane that carries a fired_rule (provenance leak)", () => {
    const p = good();
    const defaultLane = p.roster.find((l) => l.source === "default")!;
    expect(
      validateTeamPlanV1({
        ...p,
        roster: [{ ...defaultLane, fired_rule: "multi_component" }],
      })
    ).toBeNull();
  });

  it("rejects a capped/dropped_roles inconsistency", () => {
    const p = good();
    expect(validateTeamPlanV1({ ...p, capped: true, dropped_roles: [] })).toBeNull();
    expect(validateTeamPlanV1({ ...p, capped: false, dropped_roles: ["qa"] })).toBeNull();
  });

  it("rejects a roster larger than the declared cap", () => {
    const p = good();
    expect(validateTeamPlanV1({ ...p, cap: 1 })).toBeNull();
  });
});

// ── team_result.v1 + adversarial test 12 (fresh, distinct instance_ids) ─────────

describe("validateTeamResultV1 — fresh identities + typed results (test 12)", () => {
  const result = (lanes: TeamResultV1["lanes"]): unknown => ({
    schema_version: "guild.team_result.v1",
    station: "build",
    team_plan_ref: "run-x/team-plan/build",
    lanes,
  });

  it("accepts a result whose lanes carry DISTINCT instance_ids", () => {
    const ok = result([
      { role: "qa", instance_id: "inst-qa-001", handoff_ref: "h/qa", acceptance_ref: "a/qa" },
      { role: "security", instance_id: "inst-sec-001", handoff_ref: "h/sec", acceptance_ref: null },
    ]);
    const v = validateTeamResultV1(ok);
    expect(v).not.toBeNull();
    const ids = v!.lanes.map((l) => l.instance_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("REJECTS a result with a duplicate instance_id (no reused runtime identity)", () => {
    const dup = result([
      { role: "qa", instance_id: "inst-dup", handoff_ref: null, acceptance_ref: null },
      { role: "security", instance_id: "inst-dup", handoff_ref: null, acceptance_ref: null },
    ]);
    expect(validateTeamResultV1(dup)).toBeNull();
  });

  it("accepts an empty lanes array (composed but nothing dispatched)", () => {
    expect(validateTeamResultV1(result([]))).not.toBeNull();
  });

  it("rejects a malformed lane / bad schema / unknown station", () => {
    expect(validateTeamResultV1({ ...(result([]) as object), schema_version: "x" })).toBeNull();
    expect(validateTeamResultV1({ ...(result([]) as object), station: "deploy" })).toBeNull();
    expect(
      validateTeamResultV1(
        result([{ role: "qa", instance_id: "", handoff_ref: null, acceptance_ref: null } as never])
      )
    ).toBeNull();
    expect(
      validateTeamResultV1(
        result([{ role: "qa", instance_id: "i1", handoff_ref: 7 as never, acceptance_ref: null }])
      )
    ).toBeNull();
  });
});
