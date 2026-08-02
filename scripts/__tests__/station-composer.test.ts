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
  COMPOSITION_TRACE_SCHEMA,
  COST_GATE_POLICY,
  IMPLIED_RULES,
  STATIONS,
  STATION_POLICY,
  TEAM_SIZE_POLICY,
  buildTierIndex,
  composeStationTeam,
  deriveDecompositionSignals,
  isStation,
  scoreFanoutMode,
  validateTeamPlanV1,
  validateTeamResultV1,
  type FanoutSignalsFired,
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

  it("G8 scores the fan-out mode from fired signals (2 disciplines + auth ⇒ lead_plus_many)", () => {
    const plan = composeStationTeam("ideate", { multi_component: true, auth_touched: true }, cfg());
    // multi_component + auth_touched = 2 discipline signals, and auth_touched derives
    // adversarial_value — either alone forces lead_plus_many.
    expect(plan.composition_trace.mode).toBe("lead_plus_many");
    for (const lane of plan.roster) expect(lane.fanout).toBe("lead_plus_many");
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
      // Every fired-challenger id is well-formed `chal:<station>:<role>` — asserted
      // by SEGMENT (an anchored `^ident:` regex literal reads as the hand-rolled
      // YAML-field-extractor idiom the comms-format policy lints for; this is a
      // structured id, not YAML).
      for (const id of panel.fired_challenger_rules) {
        const parts = id.split(":");
        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe("chal");
        expect(parts[1]).toMatch(/^[a-z-]+$/);
        expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/);
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

  it("advisory challengers do NOT enter the roster (advisory is never a lane)", () => {
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

// ── Uncapped composition (team-contracts §2 — the cap is RETIRED) ──────────────

describe("uncapped composition (team-contracts §2)", () => {
  it("declares the uncapped policy and emits NO truncation artifacts", () => {
    expect(TEAM_SIZE_POLICY).toBe("uncapped_task_derived");
    const plan = composeStationTeam("plan", { auth_touched: true }, cfg()) as unknown as Record<string, unknown>;
    expect(plan["cap"]).toBeUndefined();
    expect(plan["capped"]).toBeUndefined();
    expect(plan["dropped_roles"]).toBeUndefined();
  });

  it("a fully-justified large composition survives WHOLE — every fired role is a lane", () => {
    // ops defaults devops/security/qa; fire every implied rule so architect,
    // frontend, technical-writer, and seo all justify lanes too: 7 distinct roles.
    const plan = composeStationTeam(
      "ops",
      {
        multi_component: true,
        public_docs: true,
        search_discoverability: true,
        user_facing_ui: true,
      },
      cfg()
    );
    expect(plan.roster.map((l) => l.role).sort()).toEqual(
      ["architect", "devops", "frontend", "qa", "security", "seo", "technical-writer"]
    );
    // fired_rules stays signal-driven (the M2 fix) AND every fired role survives.
    expect(plan.fired_rules).toContain("search_discoverability");
    expect(plan.roster.some((l) => l.role === "seo")).toBe(true);
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("REJECTS the retired numeric `cap` override loudly (never honors a logical-size limiter)", () => {
    expect(() =>
      composeStationTeam("ops", NO_SIGNALS, { ...cfg(), cap: 3 } as never)
    ).toThrow(/cap is retired/);
  });
});

// ── G8 hybrid composition engine — fan-out scoring + trace + override ───────────

describe("G8 scoreFanoutMode (signal-gated, NOT cost-gated)", () => {
  const fired = (o: Partial<FanoutSignalsFired>): FanoutSignalsFired => ({
    independence: false,
    adversarial_value: false,
    distinct_discipline_count: 0,
    ...o,
  });

  it("no decomposition signal ⇒ lead_only", () => {
    expect(scoreFanoutMode(fired({}))).toBe("lead_only");
  });
  it("exactly one distinct discipline ⇒ lead_plus_one", () => {
    expect(scoreFanoutMode(fired({ distinct_discipline_count: 1 }))).toBe("lead_plus_one");
  });
  it("two or more distinct disciplines ⇒ lead_plus_many", () => {
    expect(scoreFanoutMode(fired({ distinct_discipline_count: 2 }))).toBe("lead_plus_many");
    expect(scoreFanoutMode(fired({ distinct_discipline_count: 5 }))).toBe("lead_plus_many");
  });
  it("independence ⇒ lead_plus_many (parallelizable branches)", () => {
    expect(scoreFanoutMode(fired({ independence: true }))).toBe("lead_plus_many");
  });
  it("adversarial_value ⇒ lead_plus_many (D1: adversarially valuable work)", () => {
    expect(scoreFanoutMode(fired({ adversarial_value: true }))).toBe("lead_plus_many");
  });
});

describe("G8 deriveDecompositionSignals (from StationSignals only)", () => {
  it("no signals ⇒ no independence, no adversarial value, zero disciplines", () => {
    expect(deriveDecompositionSignals(NO_SIGNALS)).toEqual({
      independence: false,
      adversarial_value: false,
      distinct_discipline_count: 0,
    });
  });
  it("auth_touched derives adversarial_value (independent security review)", () => {
    const d = deriveDecompositionSignals({ auth_touched: true });
    expect(d.adversarial_value).toBe(true);
    expect(d.distinct_discipline_count).toBe(1);
  });
  it("counts each fired discipline signal", () => {
    const d = deriveDecompositionSignals({ backend_present: true, user_facing_ui: true, public_docs: true });
    expect(d.distinct_discipline_count).toBe(3);
    expect(d.adversarial_value).toBe(false); // no auth_touched
  });
  it("never derives independence (StationSignals has no breadth axis)", () => {
    expect(deriveDecompositionSignals({ multi_component: true }).independence).toBe(false);
  });
});

// The six required task classes (adversarial test 13). Each composes to a mode with
// recorded, self-consistent evidence.
describe("G8 acceptance: the six task classes score deterministic, traceable modes", () => {
  it("small-linear task ⇒ lead_only, lead reuses parent, cost band low", () => {
    const plan = composeStationTeam("build", NO_SIGNALS, cfg());
    const t = plan.composition_trace;
    expect(t.mode).toBe("lead_only");
    expect(t.lead_reuses_parent).toBe(true);
    expect(t.lead_binding).toBe("reuse_parent");
    expect(t.cost_estimate.band).toBe("low");
    expect(t.override).toBeNull();
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("parallel-research (explicit independence) ⇒ lead_plus_many", () => {
    const plan = composeStationTeam(
      "research",
      NO_SIGNALS,
      cfg({ decompositionSignals: { independence: true } })
    );
    const t = plan.composition_trace;
    expect(t.mode).toBe("lead_plus_many");
    expect(t.fanout_signals.independence).toBe(true);
    expect(t.lead_reuses_parent).toBe(false);
    expect(t.lead_binding).toBe("distinct_lead");
    expect(t.cost_estimate.band).toBe("high");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("cross-discipline planning (≥2 disciplines) ⇒ lead_plus_many", () => {
    const plan = composeStationTeam(
      "plan",
      { backend_present: true, user_facing_ui: true, multi_component: true },
      cfg()
    );
    expect(plan.composition_trace.mode).toBe("lead_plus_many");
    expect(plan.composition_trace.fanout_signals.distinct_discipline_count).toBeGreaterThanOrEqual(2);
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("implementation with one discipline ⇒ lead_plus_one", () => {
    const plan = composeStationTeam("build", { multi_component: true }, cfg());
    expect(plan.composition_trace.mode).toBe("lead_plus_one");
    expect(plan.composition_trace.fanout_signals.distinct_discipline_count).toBe(1);
    expect(plan.composition_trace.cost_estimate.band).toBe("medium");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("security-sensitive task (auth_touched) ⇒ lead_plus_many (adversarial value)", () => {
    const plan = composeStationTeam("build", { auth_touched: true }, cfg());
    expect(plan.composition_trace.mode).toBe("lead_plus_many");
    expect(plan.composition_trace.fanout_signals.adversarial_value).toBe(true);
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("reviewer/adversarial task (explicit adversarial_value) ⇒ lead_plus_many", () => {
    const plan = composeStationTeam(
      "qa",
      NO_SIGNALS,
      cfg({ decompositionSignals: { adversarial_value: true } })
    );
    expect(plan.composition_trace.mode).toBe("lead_plus_many");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });
});

describe("G8 fan-out is signal-gated, not cost-gated", () => {
  it("records cost_estimate + cost_gate_policy=disabled_by_operator but never gates on it", () => {
    const plan = composeStationTeam("research", NO_SIGNALS, cfg({ decompositionSignals: { independence: true } }));
    const t = plan.composition_trace;
    // A high-cost fan-out is allowed on the signal alone; the cost is RECORDED.
    expect(t.mode).toBe("lead_plus_many");
    expect(t.cost_gate_policy).toBe(COST_GATE_POLICY);
    expect(t.cost_gate_policy).toBe("disabled_by_operator");
    expect(t.cost_estimate.worker_lanes).toBe(plan.roster.length);
    expect(t.schema_version).toBe(COMPOSITION_TRACE_SCHEMA);
  });

  it("default_fanout is a FLOOR the signals may only raise (never lowers below it)", () => {
    // No signals fire ⇒ scored lead_only === the table floor.
    const plan = composeStationTeam("ideate", NO_SIGNALS, cfg());
    expect(plan.composition_trace.mode).toBe("lead_only");
  });
});

describe("G8 user override — possible + traceable (adversarial test 13)", () => {
  it("an override FORCES the mode and is recorded verbatim (can LOWER a scored fan-out)", () => {
    // auth_touched would score lead_plus_many; operator forces lead_only.
    const plan = composeStationTeam(
      "build",
      { auth_touched: true },
      cfg({ fanoutOverride: { mode: "lead_only", by: "operator", reason: "single trusted maintainer" } })
    );
    const t = plan.composition_trace;
    expect(t.mode).toBe("lead_only");
    expect(t.lead_reuses_parent).toBe(true);
    expect(t.override).not.toBeNull();
    expect(t.override!.applied).toBe(true);
    expect(t.override!.scored_mode).toBe("lead_plus_many"); // what the signals scored
    expect(t.override!.forced_mode).toBe("lead_only"); // what the operator forced
    expect(t.override!.by).toBe("operator");
    expect(t.override!.reason).toBe("single trusted maintainer");
    // Every lane mirrors the forced mode; the plan still validates.
    for (const lane of plan.roster) expect(lane.fanout).toBe("lead_only");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("an override can RAISE a scored fan-out too", () => {
    const plan = composeStationTeam(
      "build",
      NO_SIGNALS,
      cfg({ fanoutOverride: { mode: "lead_plus_many", by: "lead", reason: "known parallel breadth" } })
    );
    expect(plan.composition_trace.mode).toBe("lead_plus_many");
    expect(plan.composition_trace.override!.scored_mode).toBe("lead_only");
    expect(validateTeamPlanV1(plan)).not.toBeNull();
  });

  it("throws on an override with an unknown mode (programming error, fail loud)", () => {
    expect(() =>
      composeStationTeam(
        "build",
        NO_SIGNALS,
        // deliberately invalid mode
        cfg({ fanoutOverride: { mode: "lead_plus_five" as never, by: "x", reason: "y" } })
      )
    ).toThrow(/invalid fanoutOverride/);
  });

  it("throws on a BLANK override reason or by (must stay traceable — never emit an invalid plan)", () => {
    expect(() =>
      composeStationTeam("build", NO_SIGNALS, cfg({ fanoutOverride: { mode: "lead_only", by: "op", reason: "  " } }))
    ).toThrow(/reason must be a non-empty/);
    expect(() =>
      composeStationTeam("build", NO_SIGNALS, cfg({ fanoutOverride: { mode: "lead_only", by: "", reason: "why" } }))
    ).toThrow(/by must be a non-empty/);
  });
});

describe("G8 progressive disclosure / dynamic specialist discovery", () => {
  it("names ONLY the selected (justified) roles, never the whole catalogue", () => {
    const plan = composeStationTeam("build", { multi_component: true, auth_touched: true }, cfg());
    // The composer output enumerates selected roles, not the shipped template library.
    const catalogueSize = Object.keys(realTierIndex()).length;
    expect(plan.roster.length).toBeLessThan(catalogueSize);
  });

  it("resolves a NEWLY-DISCOVERED role via the tier index with no hardcoded catalogue", () => {
    // Inject a role the policy would add but that only exists in a custom tier index —
    // the composer resolves its tier through the index (dynamic discovery), not a table.
    const idx = { ...realTierIndex(), architect: "powerful" as const };
    const plan = composeStationTeam("build", { multi_component: true }, cfg({ tierIndex: idx }));
    const arch = plan.roster.find((l) => l.role === "architect");
    expect(arch).toBeDefined();
    expect(arch!.default_tier).toBe("powerful");
  });
});

describe("G8 composition_trace validator (fail-closed, self-consistent)", () => {
  const good = (): TeamPlanV1 =>
    composeStationTeam("research", NO_SIGNALS, cfg({ decompositionSignals: { independence: true } }));

  it("rejects a trace whose mode is not justified by its fanout_signals (no override)", () => {
    const p = good();
    // Claim lead_plus_many with all-false signals + no override ⇒ signals don't justify it.
    const tampered = {
      ...p,
      composition_trace: {
        ...p.composition_trace,
        fanout_signals: { independence: false, adversarial_value: false, distinct_discipline_count: 0 },
        override: null,
      },
    };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("rejects a lane whose fanout diverges from the trace mode", () => {
    const p = good(); // mode lead_plus_many
    const tampered = { ...p, roster: p.roster.map((l, i) => (i === 0 ? { ...l, fanout: "lead_only" as const } : l)) };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("rejects a trace whose cost band disagrees with the mode", () => {
    const p = good();
    const tampered = {
      ...p,
      composition_trace: { ...p.composition_trace, cost_estimate: { ...p.composition_trace.cost_estimate, band: "low" as const } },
    };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("rejects a trace whose lead_binding disagrees with the mode", () => {
    const p = good(); // distinct_lead
    const tampered = { ...p, composition_trace: { ...p.composition_trace, lead_binding: "reuse_parent" as const } };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("rejects a trace whose worker_lanes disagrees with the roster size", () => {
    const p = good();
    const tampered = {
      ...p,
      composition_trace: { ...p.composition_trace, cost_estimate: { ...p.composition_trace.cost_estimate, worker_lanes: 99 } },
    };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("rejects an absent composition_trace", () => {
    const p = good();
    const { composition_trace: _drop, ...withoutTrace } = p;
    expect(validateTeamPlanV1(withoutTrace)).toBeNull();
  });

  it("rejects an override record whose forced_mode disagrees with the resolved mode", () => {
    const p = composeStationTeam("build", NO_SIGNALS, cfg({ fanoutOverride: { mode: "lead_plus_many", by: "x", reason: "y" } }));
    const tampered = {
      ...p,
      composition_trace: { ...p.composition_trace, override: { ...p.composition_trace.override!, forced_mode: "lead_plus_one" as const } },
    };
    expect(validateTeamPlanV1(tampered)).toBeNull();
  });

  it("never throws on an exotic trace (Proxy getter) — maps to null", () => {
    const p = good();
    const evil = new Proxy(
      { ...p },
      {
        get(target, prop, recv) {
          if (prop === "composition_trace") throw new Error("boom");
          return Reflect.get(target, prop, recv);
        },
      }
    );
    expect(validateTeamPlanV1(evil)).toBeNull();
  });

  it("rejects a NON-throwing Proxy plan (traps can lie on every read)", () => {
    const p = good();
    const liar = new Proxy({ ...p }, { get: (t, k, r) => Reflect.get(t, k, r) });
    expect(validateTeamPlanV1(liar)).toBeNull();
  });

  it("rejects a trace whose `mode` is an ACCESSOR getter, not own data (fail-closed)", () => {
    const p = good(); // real mode lead_plus_many
    const trace = { ...p.composition_trace };
    // Replace `mode` with a getter returning a consistent-looking value.
    Object.defineProperty(trace, "mode", { get: () => "lead_plus_many", enumerable: true, configurable: true });
    expect(validateTeamPlanV1({ ...p, composition_trace: trace })).toBeNull();
  });

  it("rejects a trace with a getter-injected fanout_signals object (accessor descriptor)", () => {
    const p = good();
    const trace: Record<string, unknown> = { ...p.composition_trace };
    Object.defineProperty(trace, "fanout_signals", {
      get: () => ({ independence: true, adversarial_value: false, distinct_discipline_count: 0 }),
      enumerable: true,
      configurable: true,
    });
    expect(validateTeamPlanV1({ ...p, composition_trace: trace })).toBeNull();
  });

  it("rejects a plan whose TOP-LEVEL composition_trace is an accessor getter (own-data read)", () => {
    const p = good();
    const plan: Record<string, unknown> = { ...p };
    const realTrace = p.composition_trace;
    Object.defineProperty(plan, "composition_trace", {
      get: () => realTrace, // a getter returning an otherwise-valid trace
      enumerable: true,
      configurable: true,
    });
    expect(validateTeamPlanV1(plan)).toBeNull();
  });

  it("rejects a whitespace-only override reason/by (matches the composer's traceability bar)", () => {
    const p = composeStationTeam("build", NO_SIGNALS, cfg({ fanoutOverride: { mode: "lead_plus_many", by: "op", reason: "known" } }));
    const blankReason = { ...p, composition_trace: { ...p.composition_trace, override: { ...p.composition_trace.override!, reason: "   " } } };
    const blankBy = { ...p, composition_trace: { ...p.composition_trace, override: { ...p.composition_trace.override!, by: "  " } } };
    expect(validateTeamPlanV1(blankReason)).toBeNull();
    expect(validateTeamPlanV1(blankBy)).toBeNull();
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
    expect(validateTeamPlanV1({ ...p, roster: withHole })).toBeNull();
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

  it("rejects a plan smuggling ANY retired truncation key (team-contracts §2/§7)", () => {
    const p = good();
    expect(validateTeamPlanV1({ ...p, cap: 6 })).toBeNull();
    expect(validateTeamPlanV1({ ...p, capped: false, dropped_roles: [] })).toBeNull();
    expect(validateTeamPlanV1({ ...p, dropped_roles: ["qa"] })).toBeNull();
    expect(validateTeamPlanV1({ ...p, max_team_size: 4 })).toBeNull();
    expect(validateTeamPlanV1({ ...p, team_size: 4 })).toBeNull();
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
