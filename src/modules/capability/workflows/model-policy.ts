/**
 * src/modules/capability/workflows/model-policy.ts
 *
 * guild.model_policy.v2 — closed-key policy schema + the §5 load-time validator
 * (frozen contract: .guild/runs/run-20260730-131020-dynamic-host-model-routing/
 * contracts/guild.model_policy.v2.md). Lane T5-policy-resolution-migration.
 *
 * Policies are SELECTORS evaluated against the frozen target catalog at
 * resolution time; they name preferences, never availability. This module owns:
 *   - the closed §1/§1a/§1b shape (route table, selector grammar, conditions);
 *   - purpose floors (§3) as pure helpers consumed by purpose-provenance and
 *     the resolver;
 *   - validateModelPolicy — the §5 validator that REJECTS at load (fail closed;
 *     an invalid policy never resolves anything);
 *   - OPERATOR_BASELINE_POLICY — the §4 worked example, verbatim: the
 *     operator's VALIDATED PREFERENCES (never inventory).
 *
 * CONTRACT: pure. No I/O, no clock, no globals.
 */

// ── Closed vocabularies ──────────────────────────────────────────────────────

export const POLICY_PURPOSES = [
  "general",
  "implementation",
  "planning",
  "research",
  "advisory",
  "adversarial",
  "security",
  "adversarial-security",
] as const;
export type PolicyPurpose = (typeof POLICY_PURPOSES)[number];

/** Review-class purposes — the only purposes where a producer exists (§1b). */
export const REVIEW_CLASS_PURPOSES = [
  "advisory",
  "adversarial",
  "security",
  "adversarial-security",
] as const;
export type ReviewClassPurpose = (typeof REVIEW_CLASS_PURPOSES)[number];

export function isReviewClassPurpose(p: string): p is ReviewClassPurpose {
  return (REVIEW_CLASS_PURPOSES as readonly string[]).includes(p);
}

export const COMPLEXITIES = ["easy", "medium", "hard"] as const;
export type PolicyComplexity = (typeof COMPLEXITIES)[number];
export type RouteComplexity = PolicyComplexity | "any";

export const CONDITION_KINDS = [
  "always",
  "producer_model_family_is",
  "producer_model_family_is_not",
] as const;
export type RouteConditionKind = (typeof CONDITION_KINDS)[number];

export const INDEPENDENCE_LEVELS = ["none", "prefer_cross_family", "require_cross_family"] as const;
export type IndependenceLevel = (typeof INDEPENDENCE_LEVELS)[number];

export const POLICY_TIERS = ["cheap", "mid", "powerful"] as const;
export type PolicyTier = (typeof POLICY_TIERS)[number];

// ── §1 schema shapes (closed-key) ────────────────────────────────────────────

export interface RouteCondition {
  kind: RouteConditionKind;
  /** REQUIRED iff kind ≠ always; MUST be null when kind = always. */
  model_family: string | null;
}

export interface PolicySelectorEntry {
  /** MUST match the closed §1a grammar (id:/alias:/expr:). */
  selector: string;
  /** Preferred reasoning effort (e.g. xhigh); null = entry default. */
  effort?: string | null;
  /** Required capability keys (catalog §1 vocabulary). */
  capabilities?: string[];
}

export interface PolicyRoute {
  complexity: RouteComplexity;
  /** Optional; omitted ⇒ {kind: always}. */
  condition?: RouteCondition;
  preferred: PolicySelectorEntry[];
  /** Ordered fallback INTENT (frozen into the receipt at resolution time). */
  fallbacks: PolicySelectorEntry[];
  /** Default forbid — per-ROUTE key (model_policy §1). */
  provider_default?: "forbid" | "allow_last_resort";
}

export interface PurposePolicy {
  /** Floor; may only raise (§3). */
  min_effective_complexity: PolicyComplexity;
  independence: IndependenceLevel;
  /** User confirmation when a fallback weakens capability/cost/independence. */
  confirm_on_degradation: boolean;
  routes: PolicyRoute[];
}

export interface ModelPolicyV2 {
  version: 2;
  /** Default false; general/implementation work only (catalog §5). */
  allow_advertised_attempt: boolean;
  purposes: Partial<Record<PolicyPurpose, PurposePolicy>>;
}

// ── §1a selector grammar (closed) ────────────────────────────────────────────

export type ParsedSelector =
  | { form: "id"; canonical_id: string }
  | { form: "alias"; alias: string }
  | { form: "expr"; model_family?: string; tier?: PolicyTier };

/**
 * Parse one selector against the closed §1a grammar. Throws on any violation
 * (bare strings, unknown prefixes, unknown expr keys, duplicate conjuncts,
 * empty conjunct lists, tier=unknown). There is no implicit guessing.
 */
export function parseSelector(raw: string): ParsedSelector {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(`selector_malformed: empty or non-string selector`);
  }
  if (raw.startsWith("id:")) {
    const id = raw.slice(3);
    if (!id) throw new Error(`selector_malformed: "id:" needs a canonical_id (got "${raw}")`);
    return { form: "id", canonical_id: id };
  }
  if (raw.startsWith("alias:")) {
    const alias = raw.slice(6);
    if (!alias) throw new Error(`selector_malformed: "alias:" needs an alias (got "${raw}")`);
    return { form: "alias", alias };
  }
  if (raw.startsWith("expr:")) {
    const body = raw.slice(5);
    if (!body) throw new Error(`selector_malformed: "expr:" needs conjuncts (got "${raw}")`);
    const out: { model_family?: string; tier?: PolicyTier } = {};
    for (const conjunct of body.split(";")) {
      const eq = conjunct.indexOf("=");
      if (eq <= 0) throw new Error(`selector_malformed: bad conjunct "${conjunct}" in "${raw}"`);
      const key = conjunct.slice(0, eq);
      const value = conjunct.slice(eq + 1);
      if (key === "model_family") {
        if (out.model_family !== undefined)
          throw new Error(`selector_malformed: duplicate conjunct key "model_family" in "${raw}"`);
        if (!value) throw new Error(`selector_malformed: empty model_family in "${raw}"`);
        out.model_family = value;
      } else if (key === "tier") {
        if (out.tier !== undefined)
          throw new Error(`selector_malformed: duplicate conjunct key "tier" in "${raw}"`);
        if (!(POLICY_TIERS as readonly string[]).includes(value)) {
          throw new Error(
            `selector_malformed: tier "${value}" invalid in "${raw}" (cheap|mid|powerful; tier=unknown is invalid)`
          );
        }
        out.tier = value as PolicyTier;
      } else {
        throw new Error(`selector_malformed: unknown expr key "${key}" in "${raw}" (closed: model_family, tier)`);
      }
    }
    if (out.model_family === undefined && out.tier === undefined) {
      throw new Error(`selector_malformed: expr needs at least one conjunct ("${raw}")`);
    }
    return { form: "expr", ...out };
  }
  throw new Error(
    `selector_malformed: "${raw}" is not id:/alias:/expr: (bare strings and unknown prefixes are rejected)`
  );
}

// ── §3 purpose floors (pure helpers) ─────────────────────────────────────────

const COMPLEXITY_ORDER: Record<PolicyComplexity, number> = { easy: 0, medium: 1, hard: 2 };

export function maxComplexity(a: PolicyComplexity, b: PolicyComplexity): PolicyComplexity {
  return COMPLEXITY_ORDER[a] >= COMPLEXITY_ORDER[b] ? a : b;
}

/** research ALWAYS floors to hard (research_always_hard, §3 / SC-5). */
export function purposeComplexityFloor(purpose: PolicyPurpose): PolicyComplexity {
  return purpose === "research" ? "hard" : "easy";
}

/** research + review-class purposes carry a `powerful` tier floor (§3). */
export function purposeTierFloor(purpose: PolicyPurpose): PolicyTier | null {
  if (purpose === "research" || isReviewClassPurpose(purpose)) return "powerful";
  return null;
}

export function tierForComplexity(c: PolicyComplexity): PolicyTier {
  return c === "easy" ? "cheap" : c === "medium" ? "mid" : "powerful";
}

/**
 * The effective_complexity values REACHABLE for a purpose after the §3 floors
 * and the purpose's own min_effective_complexity (floors compose by max()).
 */
export function reachableComplexities(
  purpose: PolicyPurpose,
  minEffectiveComplexity: PolicyComplexity
): PolicyComplexity[] {
  const floor = maxComplexity(purposeComplexityFloor(purpose), minEffectiveComplexity);
  return COMPLEXITIES.filter((c) => COMPLEXITY_ORDER[c] >= COMPLEXITY_ORDER[floor]);
}

// ── §5 validator (rejects at load; fail closed) ──────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  rejects: string[]
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      rejects.push(`${where}: unknown key "${k}" (closed key set: ${allowed.join(", ")})`);
    }
  }
}

function validateSelectorEntry(
  entry: unknown,
  where: string,
  rejects: string[]
): void {
  if (!isPlainObject(entry)) {
    rejects.push(`${where}: selector entry must be an object with a "selector" key`);
    return;
  }
  rejectUnknownKeys(entry, ["selector", "effort", "capabilities"], where, rejects);
  if (typeof entry["selector"] !== "string") {
    rejects.push(`${where}: "selector" must be a string (bare/missing selectors are rejected)`);
  } else {
    try {
      parseSelector(entry["selector"]);
    } catch (e) {
      rejects.push(`${where}: ${(e as Error).message}`);
    }
  }
  if (entry["effort"] !== undefined && entry["effort"] !== null && typeof entry["effort"] !== "string") {
    rejects.push(`${where}: "effort" must be a string or null`);
  }
  if (entry["capabilities"] !== undefined) {
    const caps = entry["capabilities"];
    if (!Array.isArray(caps) || caps.some((c) => typeof c !== "string")) {
      rejects.push(`${where}: "capabilities" must be an array of capability-key strings`);
    }
  }
}

/** The catalog facts the §3 tier-floor validation leg needs (structural subset). */
export interface PolicyValidationCatalogModel {
  canonical_id?: string;
  aliases?: string[];
  model_family?: string;
  tier?: string;
}

/**
 * The §5 built-in validator. Returns [] for a conforming policy; otherwise a
 * list of rejection strings. Callers MUST treat a non-empty result as a load
 * failure (the policy never resolves anything) — this is the "validation
 * REJECTS any bypass" leg of research_always_hard (SC-5).
 *
 * Tier floors (§3): research and review-class purposes carry a non-downgradable
 * `powerful` tier floor. The static leg always runs (an `expr:` selector naming
 * a sub-floor tier is rejected outright); when `opts.catalog_models` is
 * supplied — the resolver passes the FROZEN snapshot — every preferred/fallback
 * selector on a floored route is expanded and any resolved catalog row below
 * the floor tier is a rejection. A floored purpose can therefore never carry a
 * validator-accepted route to a sub-powerful model.
 */
export function validateModelPolicy(
  input: unknown,
  opts?: { catalog_models?: ReadonlyArray<PolicyValidationCatalogModel> }
): string[] {
  const rejects: string[] = [];
  if (!isPlainObject(input)) {
    return [`model_policy: must be an object (guild.model_policy.v2)`];
  }
  rejectUnknownKeys(input, ["version", "allow_advertised_attempt", "purposes"], "model_policy", rejects);
  if (input["version"] !== 2) {
    rejects.push(`model_policy.version: must be 2 (got ${JSON.stringify(input["version"])})`);
  }
  if (input["allow_advertised_attempt"] !== undefined && typeof input["allow_advertised_attempt"] !== "boolean") {
    rejects.push(`model_policy.allow_advertised_attempt: must be a boolean (default false)`);
  }
  const purposes = input["purposes"];
  if (!isPlainObject(purposes)) {
    rejects.push(`model_policy.purposes: must be an object keyed by the closed purpose enum`);
    return rejects;
  }
  for (const [purposeKey, rawPurpose] of Object.entries(purposes)) {
    const where = `model_policy.purposes.${purposeKey}`;
    if (!(POLICY_PURPOSES as readonly string[]).includes(purposeKey)) {
      rejects.push(`${where}: unknown purpose (closed enum: ${POLICY_PURPOSES.join(", ")})`);
      continue;
    }
    const purpose = purposeKey as PolicyPurpose;
    if (!isPlainObject(rawPurpose)) {
      rejects.push(`${where}: must be an object`);
      continue;
    }
    rejectUnknownKeys(
      rawPurpose,
      ["min_effective_complexity", "independence", "confirm_on_degradation", "routes"],
      where,
      rejects
    );
    const minC = rawPurpose["min_effective_complexity"];
    if (!(COMPLEXITIES as readonly string[]).includes(minC as string)) {
      rejects.push(`${where}.min_effective_complexity: must be easy|medium|hard`);
    }
    // §5: research below hard/powerful is rejected — the floor may never be
    // missing, lowered, or overridable (research_always_hard, SC-5).
    if (purpose === "research" && minC !== "hard") {
      rejects.push(
        `${where}.min_effective_complexity: research is ALWAYS hard/powerful (research_always_hard); ` +
          `"${String(minC)}" lowers the non-downgradable floor`
      );
    }
    const independence = rawPurpose["independence"];
    if (!(INDEPENDENCE_LEVELS as readonly string[]).includes(independence as string)) {
      rejects.push(`${where}.independence: must be none|prefer_cross_family|require_cross_family`);
    }
    if (typeof rawPurpose["confirm_on_degradation"] !== "boolean") {
      rejects.push(`${where}.confirm_on_degradation: must be a boolean`);
    }
    // §5: require_cross_family may never silently accept a same-family reviewer.
    // The explicit weak-degradation labelling path REQUIRES the confirmation
    // gate — require_cross_family with confirm_on_degradation:false is rejected.
    if (independence === "require_cross_family" && rawPurpose["confirm_on_degradation"] === false) {
      rejects.push(
        `${where}: independence require_cross_family requires confirm_on_degradation:true ` +
          `(a same-family fallback must take the explicit weak-degradation labelling path, never silent)`
      );
    }
    const routes = rawPurpose["routes"];
    if (!Array.isArray(routes) || routes.length === 0) {
      rejects.push(`${where}.routes: must be a non-empty array (closed route table, §1b)`);
      continue;
    }
    routes.forEach((rawRoute, i) => {
      const rWhere = `${where}.routes[${i}]`;
      if (!isPlainObject(rawRoute)) {
        rejects.push(`${rWhere}: must be an object`);
        return;
      }
      rejectUnknownKeys(
        rawRoute,
        ["complexity", "condition", "preferred", "fallbacks", "provider_default"],
        rWhere,
        rejects
      );
      const complexity = rawRoute["complexity"];
      if (complexity !== "any" && !(COMPLEXITIES as readonly string[]).includes(complexity as string)) {
        rejects.push(`${rWhere}.complexity: must be easy|medium|hard|any`);
      }
      const condition = rawRoute["condition"];
      if (condition !== undefined) {
        if (!isPlainObject(condition)) {
          rejects.push(`${rWhere}.condition: must be an object {kind, model_family}`);
        } else {
          rejectUnknownKeys(condition, ["kind", "model_family"], `${rWhere}.condition`, rejects);
          const kind = condition["kind"];
          if (!(CONDITION_KINDS as readonly string[]).includes(kind as string)) {
            rejects.push(`${rWhere}.condition.kind: must be always|producer_model_family_is|producer_model_family_is_not`);
          } else if (kind === "always") {
            if (condition["model_family"] !== null && condition["model_family"] !== undefined) {
              rejects.push(`${rWhere}.condition.model_family: MUST be null when kind = always`);
            }
          } else {
            if (typeof condition["model_family"] !== "string" || condition["model_family"].length === 0) {
              rejects.push(`${rWhere}.condition.model_family: REQUIRED (non-empty string) when kind ≠ always`);
            }
            // §1b: conditions are review-only — a producer exists only there.
            if (!isReviewClassPurpose(purpose)) {
              rejects.push(
                `${rWhere}.condition: non-always conditions are valid ONLY on review-class purposes ` +
                  `(advisory, adversarial, security, adversarial-security) — "${purpose}" has no producer`
              );
            }
          }
        }
      }
      const preferred = rawRoute["preferred"];
      if (!Array.isArray(preferred) || preferred.length === 0) {
        rejects.push(`${rWhere}.preferred: must be a non-empty ordered selector list`);
      } else {
        preferred.forEach((entry, j) => validateSelectorEntry(entry, `${rWhere}.preferred[${j}]`, rejects));
        // §5: security-purpose preferred selectors must be pinned id: selectors
        // (rolling aliases/expressions are rejected where the policy requires a
        // pin — a provider-side safety fallback must never silently change the
        // recorded security model).
        if (purpose === "security") {
          preferred.forEach((entry, j) => {
            if (isPlainObject(entry) && typeof entry["selector"] === "string" && !entry["selector"].startsWith("id:")) {
              rejects.push(
                `${rWhere}.preferred[${j}]: security-purpose preferred selectors must be pinned "id:" selectors ` +
                  `(got "${entry["selector"]}")`
              );
            }
          });
        }
      }
      const fallbacks = rawRoute["fallbacks"];
      if (!Array.isArray(fallbacks)) {
        rejects.push(`${rWhere}.fallbacks: must be an array (may be empty)`);
      } else {
        fallbacks.forEach((entry, j) => validateSelectorEntry(entry, `${rWhere}.fallbacks[${j}]`, rejects));
      }
      // §3 tier floor: research + review-class routes may never name or resolve
      // to a sub-powerful model (research_always_hard forces hard AND powerful).
      const tierFloor = purposeTierFloor(purpose);
      if (tierFloor !== null) {
        const checkSelectorFloor = (entry: unknown, sWhere: string): void => {
          if (!isPlainObject(entry) || typeof entry["selector"] !== "string") return;
          let parsed: ParsedSelector;
          try {
            parsed = parseSelector(entry["selector"]);
          } catch {
            return; // already rejected as selector_malformed above
          }
          if (parsed.form === "expr" && parsed.tier !== undefined && parsed.tier !== tierFloor) {
            rejects.push(
              `${sWhere}: "${entry["selector"]}" names tier "${parsed.tier}" on a "${purpose}" route — ` +
                `the §3 purpose tier floor is "${tierFloor}" (non-downgradable)`
            );
            return;
          }
          const catalog = opts?.catalog_models;
          if (!catalog) return;
          for (const m of catalog) {
            const matches =
              parsed.form === "id"
                ? m.canonical_id === parsed.canonical_id
                : parsed.form === "alias"
                  ? Array.isArray(m.aliases) && m.aliases.includes(parsed.alias)
                  : (parsed.model_family === undefined || m.model_family === parsed.model_family) &&
                    (parsed.tier === undefined || m.tier === parsed.tier);
            if (matches && m.tier !== tierFloor) {
              rejects.push(
                `${sWhere}: "${entry["selector"]}" resolves to catalog model "${String(m.canonical_id)}" at ` +
                  `tier "${m.tier ?? "unknown"}" — "${purpose}" routes must stay at the "${tierFloor}" floor ` +
                  `(§3; research_always_hard forces hard AND powerful)`
              );
            }
          }
        };
        if (Array.isArray(preferred)) {
          preferred.forEach((entry, j) => checkSelectorFloor(entry, `${rWhere}.preferred[${j}]`));
        }
        if (Array.isArray(fallbacks)) {
          fallbacks.forEach((entry, j) => checkSelectorFloor(entry, `${rWhere}.fallbacks[${j}]`));
        }
      }
      const providerDefault = rawRoute["provider_default"];
      if (providerDefault !== undefined && providerDefault !== "forbid" && providerDefault !== "allow_last_resort") {
        rejects.push(`${rWhere}.provider_default: must be forbid|allow_last_resort (default forbid)`);
      }
      // §5: research + review-class routes must all be forbid.
      if (
        providerDefault === "allow_last_resort" &&
        (purpose === "research" || isReviewClassPurpose(purpose))
      ) {
        rejects.push(
          `${rWhere}.provider_default: allow_last_resort is rejected on "${purpose}" routes ` +
            `(research and review-class purposes must be forbid)`
        );
      }
    });
    // §1b coverage: every REACHABLE effective_complexity needs at least one
    // matching row whose condition kind is `always` (route_incomplete).
    if ((COMPLEXITIES as readonly string[]).includes(minC as string)) {
      const reachable = reachableComplexities(purpose, minC as PolicyComplexity);
      for (const c of reachable) {
        const covered = routes.some((r) => {
          if (!isPlainObject(r)) return false;
          const rc = r["complexity"];
          const cond = r["condition"];
          const isAlways =
            cond === undefined || (isPlainObject(cond) && cond["kind"] === "always");
          return (rc === c || rc === "any") && isAlways;
        });
        if (!covered) {
          rejects.push(
            `${where}.routes: route_incomplete — reachable effective_complexity "${c}" has no matching ` +
              `always-condition row (§1b coverage)`
          );
        }
      }
    }
  }
  return rejects;
}

// ── §4 operator preference baseline (validated defaults; NEVER inventory) ────

/**
 * The ENTIRE frozen §4 baseline in the §1 route shape (normative worked
 * example, verbatim). These are the operator's VALIDATED PREFERENCES —
 * selectors evaluated against the frozen catalog at resolution time; nothing
 * here asserts availability.
 *
 * Binding drift note (T0 matrix, drift #2): the `opus` ALIAS resolves to Opus 5
 * on the Anthropic API (CLI ≥ 2.1.219) while Opus 4.8 moved to the
 * legacy-pinned table — every Opus-4.8 route uses the pinned id
 * `claude-opus-4-8`, never the `opus` alias. The security purpose deliberately
 * pins a concrete model so a provider-side safety fallback cannot silently
 * change the recorded security model.
 */
export const OPERATOR_BASELINE_POLICY: ModelPolicyV2 = Object.freeze({
  version: 2,
  allow_advertised_attempt: false,
  purposes: {
    general: {
      min_effective_complexity: "easy",
      independence: "none",
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "easy",
          preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=cheap" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "medium",
          preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=mid" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "hard",
          preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
          provider_default: "allow_last_resort",
        },
      ],
    },
    implementation: {
      min_effective_complexity: "easy",
      independence: "none",
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "easy",
          preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=cheap" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "medium",
          preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=mid" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "hard",
          preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
          provider_default: "allow_last_resort",
        },
      ],
    },
    planning: {
      min_effective_complexity: "easy",
      independence: "none",
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "easy",
          preferred: [{ selector: "alias:haiku", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=cheap" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "medium",
          preferred: [{ selector: "alias:sonnet", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:tier=mid" }],
          provider_default: "allow_last_resort",
        },
        {
          complexity: "hard",
          preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
          provider_default: "allow_last_resort",
        },
      ],
    },
    research: {
      // Redundant with the §3 forced floor; stated for closure.
      min_effective_complexity: "hard",
      independence: "none",
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "hard", // the ONLY reachable value (research_always_hard, §3)
          preferred: [{ selector: "id:claude-fable-5", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }, { selector: "expr:tier=powerful" }],
          provider_default: "forbid",
        },
      ],
    },
    advisory: {
      min_effective_complexity: "easy",
      independence: "prefer_cross_family",
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "any",
          preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
          fallbacks: [{ selector: "expr:model_family=gpt;tier=powerful" }],
          provider_default: "forbid",
        },
      ],
    },
    adversarial: {
      min_effective_complexity: "easy",
      // Same-family fallback allowed but ALWAYS weak-labelled (resolution §7a).
      independence: "prefer_cross_family",
      confirm_on_degradation: true,
      routes: [
        {
          // Producer is not gpt-family → gpt reviewer is cross-family.
          complexity: "any",
          condition: { kind: "producer_model_family_is_not", model_family: "gpt" },
          preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }], // may be same-family as producer ⇒ weak, labelled
          provider_default: "forbid",
        },
        {
          // Producer IS gpt-family → claude reviewer restores independence.
          complexity: "any",
          condition: { kind: "producer_model_family_is", model_family: "gpt" },
          preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }],
          fallbacks: [{ selector: "expr:model_family=claude;tier=powerful" }],
          provider_default: "forbid",
        },
        {
          // Producer family unknown → weak either way (resolution §7a); review still runs.
          complexity: "any",
          preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }],
          provider_default: "forbid",
        },
      ],
    },
    security: {
      min_effective_complexity: "easy",
      independence: "none", // same-family claude is deliberate (pinned-model rationale)
      confirm_on_degradation: true,
      routes: [
        {
          complexity: "any",
          preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }], // pinned id REQUIRED (§5)
          fallbacks: [{ selector: "expr:model_family=claude;tier=powerful" }],
          provider_default: "forbid",
        },
      ],
    },
    "adversarial-security": {
      min_effective_complexity: "easy",
      independence: "require_cross_family", // adjudicated weak ⇒ NO strong sign-off (resolution §7a)
      confirm_on_degradation: true,
      routes: [
        {
          // Producer not gpt-family → gpt reviewer is cross-family.
          complexity: "any",
          condition: { kind: "producer_model_family_is_not", model_family: "gpt" },
          preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
          // Cannot restore independence on this branch ⇒ weak ⇒ NO strong sign-off.
          fallbacks: [{ selector: "id:claude-opus-4-8" }],
          provider_default: "forbid",
        },
        {
          // Producer IS gpt-family → claude restores family independence.
          complexity: "any",
          condition: { kind: "producer_model_family_is", model_family: "gpt" },
          preferred: [{ selector: "id:claude-opus-4-8", effort: null, capabilities: [] }],
          fallbacks: [], // nothing further — beyond this there is NO strong sign-off
          provider_default: "forbid",
        },
        {
          // Producer family unknown → weak regardless; NO strong sign-off.
          complexity: "any",
          preferred: [{ selector: "id:gpt-5.6-sol", effort: "xhigh", capabilities: [] }],
          fallbacks: [{ selector: "id:claude-opus-4-8" }],
          provider_default: "forbid",
        },
      ],
    },
  },
}) as ModelPolicyV2;
