/**
 * hooks/lib/tier-dispatch.ts
 *
 * Issue #60 — the TIER-SCORING guard for Guild lane dispatch.
 *
 * Background: `skills/meta/execute-plan/SKILL.md §"Tier resolution"` makes the
 * Agent `model` param the ONE tiering lever — every lane is auto-scored by the
 * deterministic `scripts/score-tier.ts` scorer, mapped to a tier through
 * `models.tiers` (within Claude `cheap=haiku`, `mid=sonnet`, `powerful=opus`),
 * dispatched with that model, and the resulting line
 * (`lane <task-id> · score N · tier <tier> · model <model>`) is PRINTED and
 * recorded — "never silent" (SKILL.md:113). All of that was PROSE the
 * orchestrator executed only while a dispatch flowed through the skill.
 *
 * The forensic `new-infra-migration` run is what unenforced prose costs: after
 * the run's first `/compact` the orchestrator kept only the ARTIFACT memory of
 * tiering (the phrase "score-tier.ts" survives inside all 8 compaction
 * summaries) and never re-executed the step. All 48 post-compaction dispatches
 * dropped the `model` key, so every lane — including read/summarize/doc lanes
 * the scorer bands cheap, and plan lanes explicitly tagged `tier: mid` —
 * silently inherited the `opus` orchestrator. The intended call and the drifted
 * call were byte-identical except for the missing `model` key, so nothing
 * caught it, and the mandatory dispatch line disappeared with it.
 *
 * This module converts both halves into code. It is the #60 sibling of
 * `backend-degradation.ts` (#56) and `dispatch-attribution.ts` (#58), and
 * deliberately mirrors their posture:
 *   - a PURE decision function over already-extracted facts, so the matrix is
 *     unit-testable without a run directory;
 *   - the SAME evidence tiering as #56 — only a producer-set carrier in the
 *     dispatch's own `env` map may BLOCK; anything read out of prompt text is
 *     recorded, never denied (`classifyLaneEvidence`, reused not re-implemented);
 *   - fail-CLOSED on the violation, with ONE explicit, auditable operator
 *     override (`GUILD_ALLOW_UNTIERED_DISPATCH`) that itself emits the receipt.
 *
 * ── Two deliberate differences from #56 ──────────────────────────────────────
 *   - It records EVERY Guild-lane dispatch decision, including a compliant one.
 *     #56 only receipts a degradation; here the receipt IS the resurrected
 *     SKILL.md:113 print-mandate, so "48 dispatches, 0 tiered" has to be
 *     answerable from the run record — which needs the compliant lines too.
 *   - It does NOT require the dispatching process to be the run LEAD. #56 is
 *     about the lead bypassing the launcher, so a pane-local helper is exempt
 *     there. The tier contract binds the DISPATCH, not the dispatcher: a helper
 *     spawned from inside a lane with no `model` param inherits that lane's
 *     model just as silently. This follows #58 (which has no lead check) rather
 *     than #56.
 *
 * Bundle-weight note: `pre-tool-use.js` runs on EVERY tool call in every
 * session, so this module reads `.guild/settings.json` with `fs` + `JSON.parse`
 * instead of importing `scripts/lib/settings-resolver.ts` (whose graph would pull
 * the whole config layer into the hook bundle), and restates the Claude tier
 * ladder rather than importing `src/modules/capability/workflows/tier-defaults.ts`
 * (which pulls the host registry). Exactly as `backend-degradation.ts` restates
 * `probeTmuxAvailable` and `dispatch-attribution.ts` restates
 * `GENERIC_SUBAGENT_TYPE`. Keep the semantics identical.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { DispatchAttribution } from "./dispatch-attribution.js";
import { classifyLaneEvidence, type LaneEvidence } from "./backend-degradation.js";
import { redactField } from "./v1.4/redact-log.js";

/** The env var an operator sets to consciously dispatch a lane without a tier. */
export const OVERRIDE_ENV = "GUILD_ALLOW_UNTIERED_DISPATCH";

/** The receipt's self-versioned schema token and its `event` value. */
export const TIER_DISPATCH_EVENT = "tier_dispatch";
export const TIER_DISPATCH_SCHEMA = "guild.tier_dispatch.v1" as const;

/** The receipt sink, relative to the run dir. */
export const RECEIPT_RELATIVE_PATH = "logs/tier-dispatch.jsonl";

/**
 * The dispatch-env carriers `guild:execute-plan` sets when it HAS run the
 * scorer. Both are optional — the guard's primary invariant is the `model`
 * param itself — but when `GUILD_TIER` is present the guard can additionally
 * verify that the dispatched model is the one that tier actually maps to,
 * putting score resolution on the real dispatch path instead of in prose.
 */
export const TIER_ENV = "GUILD_TIER";
export const TIER_SCORE_ENV = "GUILD_TIER_SCORE";

/** What the receipt records in the `model` field when the param was absent. */
export const MISSING_MODEL = "MISSING";

export type Tier = "cheap" | "mid" | "powerful";

const TIERS: readonly Tier[] = ["cheap", "mid", "powerful"];

/**
 * The Claude tier ladder, restated from
 * `src/modules/capability/workflows/tier-defaults.ts CLAUDE_TIER_FALLBACK`
 * (see the bundle-weight note in the module header). Used ONLY as the fallback
 * when the project has no `models.tiers` config AND the host is a Claude host —
 * see `readConfiguredTierModels` for why the fallback is host-gated.
 */
export const CLAUDE_TIER_FALLBACK: Record<Tier, string> = {
  cheap: "haiku",
  mid: "sonnet",
  powerful: "opus",
};

/** The effective tier→model map for the active host. `null` = no mapped model. */
export type TierModelMap = Record<Tier, string | null>;

// ── Reading the dispatch ─────────────────────────────────────────────────────

/**
 * `subagent_type` and `model` arrive verbatim from the dispatch and are rendered
 * into a TRUSTED, model-visible deny message and stored in the receipt. Bound
 * them the same way `backend-degradation.ts safeSubagentType` does: allowlist or
 * drop. The bound matches the host's model vocabulary ("haiku", "sonnet",
 * "claude-opus-4-8", "claude-haiku-4-5-20251001", …).
 */
const SAFE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/**
 * Bound a model name for rendering/telemetry AND scrub it. The character
 * allowlist alone accepts token-shaped values ("sk-proj-…" is all
 * `[A-Za-z0-9._:-]`), so a bounded-but-secret value would still land verbatim in
 * `model` / `expected_model` / `dispatch_line` / stderr (adversarial review
 * round 3, P1). Composing `redactField` closes that: a real model alias/id is
 * low-entropy and non-token-shaped, so it passes untouched, while a token- or
 * high-entropy-shaped value is scrubbed to its redaction marker. Bad characters
 * still short-circuit to "<unsafe>".
 */
export function safeModelName(value: string): string {
  if (value.length === 0) return MISSING_MODEL;
  if (!SAFE_MODEL_RE.test(value)) return "<unsafe>";
  return redactField(value);
}

/**
 * `GUILD_TASK_ID` arrives verbatim from the dispatch env and is rendered into
 * the trusted deny message and stored in the receipt. `resolveDispatchAttribution`
 * does NOT bound it, so a task id could carry a token-shaped secret or control
 * characters (adversarial review finding #3). Bound it to the same shape as a
 * lane/run id (leading alphanumeric + up to 127 more); anything else ⇒
 * "<unsafe>". A bounded value keeps the receipt greppable while never leaking a
 * secret verbatim; the free-text `detail` is additionally run through the shared
 * redaction policy at build time.
 */
const SAFE_TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export function safeTaskId(value: string): string {
  if (value.length === 0) return "";
  if (!SAFE_TASK_ID_RE.test(value)) return "<unsafe>";
  // Same reasoning as safeModelName: the char bound accepts token-shaped ids,
  // so scrub as well (round 3, P1). A normal `wi-30`/`nim-wi-30` id is untouched.
  return redactField(value);
}

function toolInputEnv(toolInput: unknown): Record<string, unknown> {
  if (toolInput === null || typeof toolInput !== "object") return {};
  const env = (toolInput as Record<string, unknown>)["env"];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return {};
  return env as Record<string, unknown>;
}

/**
 * The dispatched `model` param, trimmed. Returns undefined when the key is
 * absent, non-string, or whitespace — a whitespace `model` is not an explicit
 * tier decision, it is the same silent inheritance with extra steps.
 */
export function readDispatchModel(toolInput: unknown): string | undefined {
  if (toolInput === null || typeof toolInput !== "object") return undefined;
  const v = (toolInput as Record<string, unknown>)["model"];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The tier `guild:execute-plan` declared on the dispatch env, when well-formed. */
export function readDeclaredTier(toolInput: unknown): Tier | undefined {
  const v = toolInputEnv(toolInput)[TIER_ENV];
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  return (TIERS as readonly string[]).includes(t) ? (t as Tier) : undefined;
}

/**
 * Was a `GUILD_TIER` env carrier PRESENT (non-empty), regardless of validity?
 * Lets the guard tell "no tier declared" (→ `model_present`) apart from "a tier
 * was declared but is malformed" (→ `tier_unverifiable`) — an invalid carrier
 * must not silently degrade to the no-carrier case (adversarial review round 3).
 */
export function rawTierPresent(toolInput: unknown): boolean {
  const v = toolInputEnv(toolInput)[TIER_ENV];
  return typeof v === "string" && v.trim().length > 0;
}

/** The raw score the scorer produced, when the dispatch carried it. */
export function readDeclaredScore(toolInput: unknown): number | undefined {
  const v = toolInputEnv(toolInput)[TIER_SCORE_ENV];
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.trim().length === 0) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) ? n : undefined;
}

// ── Model identity ───────────────────────────────────────────────────────────

/**
 * The model FAMILY token, when one is recognizable. Guild's tier map stores
 * short aliases ("sonnet") while a host may dispatch a fully-qualified id
 * ("claude-sonnet-5"), and both name the same tier. Comparing raw strings would
 * report a mismatch between two spellings of the same model.
 */
const MODEL_FAMILY_RE = /(?:^|[^a-z])(haiku|sonnet|opus|fable)(?:[^a-z]|$)/;

export function modelFamily(value: string): string | undefined {
  return MODEL_FAMILY_RE.exec(value.trim().toLowerCase())?.[1];
}

/** Is `v` a BARE family token ("sonnet"), as opposed to a qualified id? */
function isBareFamily(v: string): boolean {
  return /^(haiku|sonnet|opus|fable)$/.test(v.trim().toLowerCase());
}

/**
 * Does a DISPATCHED model satisfy a CONFIGURED/expected model? DIRECTIONAL —
 * the alias tolerance only opens in one direction (adversarial review round 2,
 * P1):
 *
 *   - exact (case-insensitive) match → yes.
 *   - the CONFIGURED side is the bare family alias ("sonnet"): any dispatched
 *     model of that family satisfies it — the config said "any sonnet", so
 *     `claude-sonnet-5` qualifies.
 *   - the CONFIGURED side is a QUALIFIED pin ("claude-sonnet-5"): only an exact
 *     match satisfies it. A bare alias or a DIFFERENT qualified version
 *     (`claude-sonnet-4-5`) does NOT — else a version pin is silently defeated
 *     by a moving alias.
 *
 * Two values with no recognizable family only match exactly — never guess.
 */
export function modelMatchesConfigured(configured: string, dispatched: string): boolean {
  const nc = configured.trim().toLowerCase();
  const nd = dispatched.trim().toLowerCase();
  if (nc.length === 0 || nd.length === 0) return false;
  if (nc === nd) return true;
  const fc = modelFamily(nc);
  const fd = modelFamily(nd);
  if (fc === undefined || fc !== fd) return false;
  // Same family, different spelling — satisfied ONLY when the configured side is
  // the bare alias (it accepts any member of the family). A qualified config
  // pin requires exactness (handled by the `nc === nd` check above).
  return isBareFamily(nc);
}

/**
 * Which tier of THIS map the dispatched model belongs to — ONLY when the answer
 * is UNAMBIGUOUS. Each tier's map value is the CONFIGURED side, so the match is
 * directional (`modelMatchesConfigured`). When several tiers map to the same
 * model (e.g. a project sets both `mid` and `powerful` to `opus`), the reverse
 * lookup is genuinely ambiguous, so this returns undefined rather than the first
 * arbitrary match (adversarial review finding #7). A caller that has a DECLARED
 * tier should compare that tier's expected model directly, not rely on this
 * reverse map.
 */
export function tierOfModel(map: TierModelMap, model: string): Tier | undefined {
  const hits = TIERS.filter((t) => {
    const m = map[t];
    return m !== null && modelMatchesConfigured(m, model);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

// ── The effective tier→model map ─────────────────────────────────────────────

/**
 * Unpack one `models.tiers.<tier>.<host>` value: string | {model} | null, and
 * BOUND it through `safeModelName` (adversarial review round 2, P1). Config
 * values flow into the shareable receipt (`expected_model`), the operator-facing
 * ladder clause, and stderr, so a token-shaped or control-character value in
 * `settings.json` must never pass through verbatim — it renders "<unsafe>"
 * instead. A normal model alias/id is unaffected.
 */
function unpackTierHostValue(v: unknown): string | null {
  let raw: string | null = null;
  if (typeof v === "string") raw = v.trim().length > 0 ? v.trim() : null;
  else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const m = (v as Record<string, unknown>)["model"];
    if (typeof m === "string" && m.trim().length > 0) raw = m.trim();
  }
  return raw === null ? null : safeModelName(raw);
}

/**
 * The tier→model map this run would actually resolve against, read from the
 * project's `.guild/settings.json` `models.tiers.<tier>.<host-id>` block.
 *
 * Two deliberate limits, both chosen so the MISMATCH check can never produce a
 * false deny:
 *
 *   - It reads the project-local settings file only — it does not replay the
 *     5-layer inheritance chain `scripts/lib/settings-resolver.ts` owns (bundle
 *     weight; module header). A workspace-level `models.tiers` override is
 *     therefore invisible here, which yields the built-in map. That is safe
 *     because an UNRECOGNIZED dispatched model is graded `tier_unverifiable`
 *     (recorded, never blocked), so a remapped model the local file never saw
 *     can only ever be recorded.
 *   - The built-in Claude ladder is used as a fallback ONLY for a Claude host.
 *     `tier-defaults.ts` lets every host fall back to it, which is the right
 *     answer for CHOOSING a model; it is the wrong answer for JUDGING one,
 *     since asserting `cheap = haiku` on a Codex host would be an invented
 *     fact. A non-Claude host with no configured map simply cannot be
 *     tier-verified — the `model`-param invariant still applies.
 */
export function readConfiguredTierModels(guildRoot: string, hostId: string): TierModelMap {
  const claudeHost = hostId.startsWith("claude");
  const out: TierModelMap = {
    cheap: claudeHost ? CLAUDE_TIER_FALLBACK.cheap : null,
    mid: claudeHost ? CLAUDE_TIER_FALLBACK.mid : null,
    powerful: claudeHost ? CLAUDE_TIER_FALLBACK.powerful : null,
  };
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(guildRoot, ".guild", "settings.json"), "utf8"));
  } catch {
    return out; // absent/malformed settings — built-in ladder (Claude) or nothing.
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return out;
  const models = (doc as Record<string, unknown>)["models"];
  if (models === null || typeof models !== "object" || Array.isArray(models)) return out;
  const tiers = (models as Record<string, unknown>)["tiers"];
  if (tiers === null || typeof tiers !== "object" || Array.isArray(tiers)) return out;
  for (const tier of TIERS) {
    const row = (tiers as Record<string, unknown>)[tier];
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    // A row that exists but has no entry for this host is an explicit "no model
    // here" — honor it, do not silently keep the built-in fallback.
    out[tier] = unpackTierHostValue((row as Record<string, unknown>)[hostId]);
  }
  return out;
}

// ── Override ─────────────────────────────────────────────────────────────────

/**
 * Is the conscious-untiered-dispatch override engaged? Deliberately an
 * ALLOWLIST of affirmative tokens (same doctrine as
 * `backend-degradation.ts isOverrideEngaged`): an unset, empty, "0", "false", or
 * unrecognized value leaves the guard armed. The override still emits the
 * receipt — that is its whole point: a conscious, auditable untiered dispatch
 * instead of a silent one.
 */
export function isUntieredOverrideEngaged(env: NodeJS.ProcessEnv): boolean {
  const raw = env[OVERRIDE_ENV];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

// ── The decision ─────────────────────────────────────────────────────────────

export type TierDispatchDecision =
  /** The dispatch honors the tier contract — recorded, never gated. */
  | "pass"
  /** A tier-contract violation with STRUCTURED evidence — blocked fail-closed. */
  | "deny"
  /** The same case, consciously accepted by the operator via the override env. */
  | "allow_override"
  /** A violation the plugin can observe but must not block — receipt only. */
  | "allow_recorded";

export type TierDispatchReason =
  /**
   * `model` present, `GUILD_TIER` present + valid, and the dispatched model is
   * the one that tier maps to in the run's tier map. This verifies MODEL↔
   * DECLARED-TIER CONSISTENCY only — NOT that the score→tier banding is correct
   * or that a `powerful` choice was justified (adversarial review round 3): a
   * per-lane pin or advisor request legitimately overrides the score→tier map,
   * so `GUILD_TIER_SCORE` is recorded for audit but never used to reject a tier.
   * The strongest signal this guard can honestly assert; it does not certify the
   * upstream scoring policy.
   */
  | "scored_compliant"
  /**
   * `model` present, but NO valid `GUILD_TIER` carrier to check scoring against.
   * The contract's PRIMARY invariant (an explicit tiering lever) is satisfied,
   * so this is not a violation — but the guard cannot PROVE the lane was scored
   * or that a `powerful` choice was justified (adversarial review finding #5).
   * Distinct from `scored_compliant` so a consumer can tell a merely-present
   * model from a verified-scored one.
   */
  | "model_present"
  /**
   * No explicit `model` param. The dispatched lane silently inherits whatever
   * model the dispatching process runs on — the exact #60 shape, where an opus
   * orchestrator turned every cheap/mid lane into an opus lane. This is the one
   * violation that needs NO tier map to detect (purely structural), so it is
   * the only reason that may BLOCK.
   */
  | "missing_model"
  /**
   * The dispatch declares `GUILD_TIER=<t>` but the `model` it carries is the
   * model of a DIFFERENT tier in the run's own project-local map. RECORDED,
   * never blocked: the hook can only read the PROJECT-LOCAL `settings.json`, not
   * the full multi-layer effective map `guild:execute-plan` resolves against
   * (workspace/local/CLI layers + the frozen run snapshot — the snapshot's
   * `effective` block carries no `models.tiers`). A "mismatch" may therefore
   * reflect a stale/partial map rather than a real contradiction, so denying it
   * would risk a false positive on a legitimate inherited remap (adversarial
   * review finding #1). It is surfaced loudly on stderr + in the receipt so a
   * genuine contradiction is still visible.
   */
  | "tier_model_mismatch"
  /**
   * A declared tier could not be checked against the dispatched model — the host
   * has no mapped model for that tier, or the dispatched model is not in the
   * map at all (a custom/remapped model, or a non-Claude host). RECORDED, never
   * blocked: an unknown model is not evidence of a violation.
   */
  | "tier_unverifiable";

export interface TierDispatchFacts {
  /** The raw `Agent` tool_input — model param + structured-carrier source. */
  toolInput: unknown;
  /** #58 attribution for this dispatch. */
  attr: DispatchAttribution;
  /** The dispatch's prompt (lane-brief signature source). */
  prompt: string;
  /** The active run id — binds the prompt-only lane signature to THIS run. */
  runId: string;
  /** The effective tier→model map for the active host. */
  tierModels: TierModelMap;
  /** Whether the operator engaged the conscious-untiered override. */
  overrideEngaged: boolean;
  /** Whether the run identity is trustworthy enough to gate on (stale sentinel guard). */
  runFresh: boolean;
}

export interface TierDispatchResult {
  decision: TierDispatchDecision;
  reason: TierDispatchReason;
  /** How strong the lane evidence was — decides whether a DENY was permissible. */
  evidence: LaneEvidence;
  /** True when this dispatch is a Guild lane at all (evidence !== "none" ∧ fresh). */
  recorded: boolean;
  /** The dispatched model, bounded for display; `MISSING` when absent. */
  model: string;
  /** The tier the dispatch declared, when it carried one. */
  declaredTier?: Tier;
  /** The tier the DISPATCHED model belongs to, when resolvable — the mismatch proof. */
  dispatchedTier?: Tier;
  /** The model the declared tier maps to, when known. */
  expectedModel?: string;
  /** The scorer's raw score, when the dispatch carried it. */
  score?: number;
  /** The lane's task id, when the dispatch carried one. */
  taskId?: string;
  /** The specialist role this lane claims, when determinable (already #58-bounded). */
  specialist?: string;
  /** subagent_type as dispatched, bounded for display/telemetry. */
  subagentType: string;
}

/**
 * The #60 predicate.
 *
 * Preconditions for ANY outcome other than an untouched pass:
 *   - the dispatch is a Guild specialist LANE (`classifyLaneEvidence !== "none"`);
 *   - the run identity is trustworthy (a stale `current-run-id` sentinel from a
 *     long-finished run never gates — `isRunFresh`).
 *
 * Then:
 *
 *   model absent, structured evidence       → deny            (or allow_override)
 *   model absent, prompt-only evidence       → allow_recorded
 *   model present, valid tier, model matches → pass  scored_compliant
 *   model present, no valid tier carrier     → pass  model_present
 *   model present, tier declared, mismatch   → allow_recorded  (never denied — see below)
 *   model present, tier unverifiable         → allow_recorded
 *
 * Only `missing_model` may BLOCK, and only with STRUCTURED lane evidence — a
 * producer-set carrier in the dispatch's own `env` map, which no quoted prose
 * can forge (`backend-degradation.ts LaneEvidence`, reused verbatim). It is the
 * one violation that needs no tier map: "did the dispatch carry a `model` key?"
 * is purely structural. `tier_model_mismatch` is deliberately NOT blockable
 * because the hook cannot read the authoritative multi-layer effective tier map
 * (finding #1) — it is recorded loudly instead.
 */
export function resolveTierDispatch(facts: TierDispatchFacts): TierDispatchResult {
  const evidence = classifyLaneEvidence(
    facts.toolInput,
    facts.attr,
    facts.prompt,
    facts.runId,
  );
  const rawModel = readDispatchModel(facts.toolInput);
  const declaredTier = readDeclaredTier(facts.toolInput);
  const score = readDeclaredScore(facts.toolInput);

  const base: TierDispatchResult = {
    decision: "pass",
    reason: "model_present",
    evidence,
    recorded: false,
    model: rawModel === undefined ? MISSING_MODEL : safeModelName(rawModel),
    subagentType: safeSubagentTypeLocal(facts.attr.subagentType),
  };
  if (declaredTier !== undefined) base.declaredTier = declaredTier;
  if (score !== undefined) base.score = score;
  if (facts.attr.taskId !== undefined) base.taskId = safeTaskId(facts.attr.taskId);
  if (facts.attr.specialist !== undefined) base.specialist = safeSpecialist(facts.attr.specialist);

  // Not a Guild lane, or an identity we must not gate on → untouched, no receipt.
  if (evidence === "none" || !facts.runFresh) return base;
  base.recorded = true;

  const expectedModel =
    declaredTier !== undefined ? facts.tierModels[declaredTier] : null;
  if (expectedModel !== null && expectedModel !== undefined) {
    base.expectedModel = expectedModel;
  }

  // ── The only blockable violation: no explicit model param ────────────────
  if (rawModel === undefined) {
    // Only STRUCTURED evidence may block; the override only applies to a case
    // that WOULD have been denied (stamping `allow_override` on a prompt-only
    // dispatch would claim the override opened a door that was never shut —
    // `backend-degradation.ts`, round 4).
    const decision: TierDispatchDecision =
      evidence !== "structured"
        ? "allow_recorded"
        : facts.overrideEngaged
          ? "allow_override"
          : "deny";
    return { ...base, decision, reason: "missing_model" };
  }

  const dispatchedTier = tierOfModel(facts.tierModels, rawModel);
  if (dispatchedTier !== undefined) base.dispatchedTier = dispatchedTier;

  // No VALID declared tier. Two sub-cases (round 3): a MALFORMED-but-present
  // GUILD_TIER carrier is recorded as `tier_unverifiable` (a tier was asserted
  // but can't be used), never silently folded into the no-carrier case; a
  // genuinely absent carrier is `model_present` (the model-param invariant holds
  // but scoring is UNVERIFIED — this guard does not, and cannot, prove a lane
  // was scored, since a pin legitimately overrides the score→tier banding).
  if (declaredTier === undefined) {
    if (rawTierPresent(facts.toolInput)) {
      return { ...base, decision: "allow_recorded", reason: "tier_unverifiable" };
    }
    return base;
  }

  // A declared tier we cannot resolve to a model → nothing to compare against.
  if (expectedModel === null || expectedModel === undefined) {
    return { ...base, decision: "allow_recorded", reason: "tier_unverifiable" };
  }
  // Declared tier's model matches the dispatched model → verified-scored.
  if (modelMatchesConfigured(expectedModel, rawModel)) {
    return { ...base, reason: "scored_compliant" };
  }
  // The dispatched model is not in this (project-local) map at all — a
  // remapped/custom model or an inheritance-chain override this reader cannot
  // see. Never a violation.
  if (dispatchedTier === undefined) {
    return { ...base, decision: "allow_recorded", reason: "tier_unverifiable" };
  }
  // A genuine tier/model disagreement in the project-local map. RECORDED, never
  // denied (finding #1 — the reader is not the authoritative effective map).
  return { ...base, decision: "allow_recorded", reason: "tier_model_mismatch" };
}

/**
 * Local restatement of `backend-degradation.ts safeSubagentType`. Not imported
 * to keep this module's public surface self-describing; same allowlist, same
 * "<absent>" sentinel — keep them in step.
 */
const SAFE_SUBAGENT_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
function safeSubagentTypeLocal(value: string): string {
  if (value.length === 0) return "<absent>";
  if (!SAFE_SUBAGENT_TYPE_RE.test(value)) return "<unsafe>";
  // The char allowlist accepts token-shaped values; scrub as well (round 4, P1).
  return redactField(value);
}

/**
 * The specialist role reaches the shareable receipt (`specialist`) and the
 * operator-facing messages. It is already #58-bounded (SAFE_ROLE_RE), but that
 * is a character allowlist too, so scrub it the same way (round 4, P1). A normal
 * role ("devops") is untouched.
 */
function safeSpecialist(value: string): string {
  return redactField(value);
}

// ── The dispatch line (SKILL.md:113, resurrected) ────────────────────────────

/**
 * The mandatory dispatch line, verbatim in the shape
 * `guild:execute-plan §"Tier resolution"` step 5 requires:
 *
 *   lane <task-id> · score N · tier <tier> · model <model>
 *
 * Absent fields render as `-` rather than being dropped, so a consumer counting
 * un-scored dispatches can grep for `score -` / `model MISSING` instead of
 * having to reason about a variable-shape string.
 */
export function buildDispatchLine(r: TierDispatchResult): string {
  return (
    `lane ${r.taskId ?? "-"} · score ${r.score ?? "-"} · ` +
    `tier ${r.declaredTier ?? "-"} · model ${r.model}`
  );
}

// ── Operator-facing messages ─────────────────────────────────────────────────

const SCORER_HINT =
  "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/score-tier.ts " +
  "--signals '<json>' --cwd <repo-root> [--model-tier <pin>]";

/** The tier ladder as an operator-readable clause, from the EFFECTIVE map. */
function ladderClause(map: TierModelMap): string {
  const shown = TIERS.filter((t) => map[t] !== null).map((t) => `${t}=${map[t]}`);
  return shown.length > 0 ? shown.join(", ") : "no models.tiers mapping for this host";
}

/**
 * The loud, actionable deny message. Mirrors the fail-closed style of #56/#58:
 * quote the invariant, name the concrete remedy (the scorer command that
 * produces the missing value), and name the explicit override so an operator who
 * really must dispatch untiered has a documented, auditable door instead of
 * quietly re-rolling the same drifted dispatch.
 *
 * Every interpolated value is pre-bounded: `role` by #58's SAFE_ROLE_RE, `model`
 * by `safeModelName`, the tier tokens by `readDeclaredTier`'s closed set.
 */
export function buildDenyMessage(r: TierDispatchResult, map: TierModelMap): string {
  const role = r.specialist ?? "<unattributed>";
  const head =
    `Guild tier integrity (#60): the "${role}" lane is being dispatched through the ` +
    `Agent tool `;
  const contract =
    `guild:execute-plan §"Tier resolution" makes the Agent \`model\` param the ONLY ` +
    `tiering lever, and it is REQUIRED on every lane dispatch: the tier defaults ` +
    `CHEAP and a \`powerful\` invocation must be justified by the score, an explicit ` +
    `pin, or an advisor request (${ladderClause(map)}). `;
  const remedy =
    `Resolve the lane's tier deterministically first — ${SCORER_HINT} — then dispatch ` +
    `with \`model: <the resolved model>\` (and carry ${TIER_ENV}/${TIER_SCORE_ENV} on the ` +
    `dispatch env so the resolved tier is verifiable here). `;
  const door =
    `If this lane genuinely must run untiered, do it CONSCIOUSLY: re-run with ` +
    `${OVERRIDE_ENV}=1 — the dispatch is then allowed and a ${TIER_DISPATCH_EVENT} ` +
    `receipt is written to the run record either way. Blocking this dispatch.`;

  // Only `missing_model` reaches a DENY (mismatch is record-only — finding #1).
  return (
    head +
    `with NO explicit \`model\` param, so it silently INHERITS the dispatching ` +
    `process's model. That is the exact #60 regression: after a /compact the ` +
    `orchestrator kept the memory of tier-scoring but stopped executing it, and every ` +
    `lane — including read/summarize/doc lanes the scorer bands cheap — inherited the ` +
    `powerful orchestrator model. ` +
    contract +
    remedy +
    door
  );
}

/**
 * The message for a decision that is recorded rather than blocked. Also the
 * receipt's durable `detail`, so it must be accurate for EVERY row — branch on
 * the REASON first, then on the evidence tier.
 */
export function buildRecordMessage(r: TierDispatchResult, map: TierModelMap): string {
  const role = r.specialist ?? "<unattributed>";
  const line = buildDispatchLine(r);
  const tail =
    `Recording a ${TIER_DISPATCH_EVENT} receipt at ` +
    `.guild/runs/<run-id>/${RECEIPT_RELATIVE_PATH} so the dispatch line is a checkable ` +
    `run-record entry (guild:execute-plan SKILL.md §"Tier resolution" step 5 — ` +
    `"never silent").`;
  const promptOnlyClause =
    `The lane was identified from PROMPT TEXT alone (the handoff-protocol block, or ` +
    `the #58 adoption marker / role anchor / dispatch prose) — the dispatch env carries ` +
    `no GUILD_SPECIALIST / GUILD_TASK_ID / GUILD_AGENT_DEFINITION carrier. Quoted text ` +
    `is indistinguishable from a real brief, so this is recorded, not blocked. `;

  if (r.reason === "scored_compliant" || r.reason === "model_present") {
    const scored =
      r.reason === "scored_compliant"
        ? "verified scored (model matches the declared tier)"
        : "model present but scoring UNVERIFIED (no GUILD_TIER carrier to check)";
    return `Guild tier integrity (#60): ${line} · ${scored} · decision ${r.decision}. ${tail}`;
  }
  if (r.reason === "tier_model_mismatch") {
    return (
      `Guild tier integrity (#60): the "${role}" lane declared ${TIER_ENV}=` +
      `"${r.declaredTier}" but was dispatched with \`model: "${r.model}"\` — this run's ` +
      `project-local \`${r.dispatchedTier}\` model, not its \`${r.declaredTier}\` model ` +
      `("${r.expectedModel}"). RECORDED, not blocked: the hook reads only the ` +
      `project-local settings.json, not the full multi-layer effective tier map, so this ` +
      `may be a legitimate inherited remap rather than a real contradiction. If it IS a ` +
      `contradiction, dispatch \`model: "${r.expectedModel}"\` for the declared tier or ` +
      `re-score — ${SCORER_HINT}. ${line}. ${tail}`
    );
  }
  if (r.reason === "tier_unverifiable") {
    return (
      `Guild tier integrity (#60): the "${role}" lane declared ${TIER_ENV}=` +
      `"${r.declaredTier}" but the dispatched model ("${r.model}") could not be ` +
      `checked against this run's tier map (${ladderClause(map)}) — an unmapped tier ` +
      `for this host, or a model the project remapped. The \`model\` param IS present, ` +
      `so the contract's primary invariant holds; the tier is simply unverifiable here. ` +
      `${line}. ${tail}`
    );
  }
  // The only remaining reason here is `missing_model` (mismatch/unverifiable/
  // compliant are handled above).
  const violation =
    `was dispatched with NO explicit \`model\` param and therefore inherits the ` +
    `dispatching process's model (${ladderClause(map)}; the tier defaults cheap and ` +
    `\`powerful\` must be justified). `;
  const head = `Guild tier integrity (#60): the "${role}" lane ${violation}`;
  if (r.decision === "allow_override") {
    return (
      head +
      `OVERRIDDEN: the dispatch was allowed because ${OVERRIDE_ENV} is set. To honor ` +
      `the tier contract instead, resolve the tier first — ${SCORER_HINT}. ${line}. ${tail}`
    );
  }
  return `${head}${promptOnlyClause}${line}. ${tail}`;
}

// ── Receipt ──────────────────────────────────────────────────────────────────

/**
 * The `tier_dispatch` receipt — the run-record form of the SKILL.md:113 dispatch
 * line, written for EVERY Guild-lane `Agent` dispatch (compliant ones included,
 * unlike #56's degradation-only receipt: "48 dispatches, 0 with a model param"
 * is only answerable when the compliant lines are on the record too).
 *
 * Written to its OWN sink (`RECEIPT_RELATIVE_PATH`) with its own
 * `schema_version` — never into `logs/v1.4-events.jsonl`, whose validator
 * accepts only the frozen v1.4 `EVENT_TYPES`, the hook-name mirror family, and
 * `guild.trace.*.v1` (same constraint `backend-degradation.ts` documents).
 *
 * Field shape follows the telemetry convention (ts / event / tool / specialist /
 * ok / ms) plus the v2 `span_id` from `trace-v2.ts genSpanId`, so a consumer that
 * already parses Guild trace lines parses these unchanged.
 *
 * SEMANTICS — this is a PreToolUse TIER-GATE decision, not a dispatch outcome
 * (adversarial review finding #4). It records what tier/model the orchestrator
 * ATTEMPTED to dispatch with, at the moment of the `Agent` call. A sibling
 * PreToolUse guard (#58 persona-strip, #56 backend-degradation) or capability
 * enforcement may still block the very same call AFTER this receipt is written,
 * so `ok`/`decision` describe ONLY the tier check — a `decision:"pass"` receipt
 * paired with a downstream deny means "the tier gate did not object; another
 * gate did". Reconciling this with the true PostToolUse outcome is an explicit
 * followup owned by other lanes.
 */
export interface TierDispatchEvent {
  schema_version: typeof TIER_DISPATCH_SCHEMA;
  ts: string;
  event: typeof TIER_DISPATCH_EVENT;
  tool: "Agent";
  specialist: string;
  /**
   * The TIER gate raised no objection (reason `scored_compliant`/`model_present`).
   * NOT "the dispatch executed" — a sibling PreToolUse gate may still block the
   * same call (see the SEMANTICS note above).
   */
  ok: boolean;
  ms: 0;
  run_id: string;
  decision: TierDispatchDecision;
  reason: TierDispatchReason;
  /** The lane's task id, or "" when the dispatch carried none. */
  task_id: string;
  /** The dispatched model, bounded — or `MISSING` when the param was absent. */
  model: string;
  /** The tier declared on the dispatch env (GUILD_TIER), when present. */
  tier?: Tier;
  /** The scorer's raw score (GUILD_TIER_SCORE), when present. */
  score?: number;
  /** The tier the DISPATCHED model maps to, when resolvable. */
  dispatched_tier?: Tier;
  /** The model the declared tier maps to, when known. */
  expected_model?: string;
  /**
   * How the dispatch was identified as a lane. "prompt_only" receipts are
   * lower-confidence by construction and are never blocked — a consumer
   * triaging these should weight "structured" far more heavily.
   */
  lane_evidence: LaneEvidence;
  /** subagent_type the dispatch wore (bounded). */
  subagent_type: string;
  /** The verbatim SKILL.md:113 line, ready to grep/print. */
  dispatch_line: string;
  /** Present only on an overridden allow — names the env var that opened the door. */
  override_env?: string;
  detail: string;
  span_id: string;
  lane_id?: string;
}

export interface BuildTierReceiptInput {
  runId: string;
  ts: string;
  spanId: string;
  result: TierDispatchResult;
  detail: string;
  laneId?: string;
}

/** Pure builder — the file write is the caller's (see `appendTierDispatchEvent`). */
export function buildTierDispatchEvent(input: BuildTierReceiptInput): TierDispatchEvent {
  const r = input.result;
  const evt: TierDispatchEvent = {
    schema_version: TIER_DISPATCH_SCHEMA,
    ts: input.ts,
    event: TIER_DISPATCH_EVENT,
    tool: "Agent",
    specialist: r.specialist ?? "",
    ok: r.decision === "pass",
    ms: 0,
    run_id: input.runId,
    decision: r.decision,
    reason: r.reason,
    // task_id is bounded upstream (safeTaskId) but bound again defensively so a
    // receipt built from a hand-constructed result cannot leak an unbounded id.
    task_id: safeTaskId(r.taskId ?? ""),
    model: r.model,
    lane_evidence: r.evidence,
    subagent_type: r.subagentType,
    dispatch_line: buildDispatchLine(r),
    // The free-text detail carries operator-facing prose (config model names,
    // ladder text) — run it through the shared redaction policy so a
    // token-shaped or high-entropy value can never land in this shareable sink
    // (adversarial review finding #3). The security-event twin is already
    // redacted by buildSecurityEvent; this closes the dedicated sink too.
    detail: redactField(input.detail),
    span_id: input.spanId,
  };
  if (r.declaredTier !== undefined) evt.tier = r.declaredTier;
  if (r.score !== undefined) evt.score = r.score;
  if (r.dispatchedTier !== undefined) evt.dispatched_tier = r.dispatchedTier;
  // expected_model already comes from the bounded tier map, but bind again so a
  // hand-constructed result cannot smuggle an unbounded config value in.
  if (r.expectedModel !== undefined) evt.expected_model = safeModelName(r.expectedModel);
  if (r.decision === "allow_override") evt.override_env = OVERRIDE_ENV;
  if (input.laneId !== undefined) evt.lane_id = input.laneId;
  return evt;
}

/**
 * Append the receipt to the run record at `<runDir>/logs/tier-dispatch.jsonl`.
 *
 * Best-effort and non-throwing: a telemetry failure must NEVER change the gate
 * decision the caller already made. Returns true on a successful write.
 */
export function appendTierDispatchEvent(runDir: string, event: TierDispatchEvent): boolean {
  try {
    const file = path.join(runDir, RECEIPT_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [tier-dispatch] receipt write failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return false;
  }
}
