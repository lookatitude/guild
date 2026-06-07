#!/usr/bin/env -S npx tsx
/**
 * scripts/score-tier.ts
 *
 * Pure-function deterministic tier scorer implementing the ADR §2 signal-sum
 * rubric (docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §2).
 *
 * No LLM. No network. Same inputs → same output every time.
 *
 * Usage:
 *   npx tsx scripts/score-tier.ts --signals '<json>' [--cwd <root>] [--model-tier <pin>]
 *
 * --signals  JSON object: { workType, blastRadius?, hasUpstreamContract?, sensitivity?, priorEscalation? }
 *   workType: "read"|"summarize"|"draft"|"extract"|"architect"|"review"|"schema"
 *   blastRadius: number (file/module count — each ≥1 contributes scoreWeights.blastRadius)
 *   hasUpstreamContract: boolean (depends-on contract present)
 *   sensitivity: boolean (security/correctness flag)
 *   priorEscalation: boolean (prior-attempt escalation, sticky for the run)
 *
 * --cwd      Path to the consuming repo root (reads .guild/settings.json for
 *            models.scoreWeights, models.thresholds, models.tiers via read-guild-config.ts).
 *            Omit for pure built-in defaults.
 *
 * --model-tier  Explicit pin: cheap|mid|powerful. Overrides the scored tier
 *               (top of the precedence ladder: pin > explicit arg > scored).
 *
 * Stdout: JSON { score: number, tier: "cheap"|"mid"|"powerful", model?: string }
 * Exit:   0 always (scoring failures must not block dispatch).
 */

import { resolveSettings } from "./lib/settings-resolver";

// ── Types ────────────────────────────────────────────────────────────────────

export type Tier = "cheap" | "mid" | "powerful";

export type WorkType =
  | "read"
  | "summarize"
  | "draft"
  | "extract"
  | "architect"
  | "review"
  | "schema";

/** Raw signals fed to the scorer. All optional except workType. */
export interface TierSignals {
  /** The work-type verb for this lane. */
  workType: WorkType;
  /** Number of files / modules affected. Each unit ≥1 adds scoreWeights.blastRadius per unit. Default 0. */
  blastRadius?: number;
  /** True when a depends-on upstream contract is present. Default false. */
  hasUpstreamContract?: boolean;
  /** True when the lane is flagged security/correctness sensitive. Default false. */
  sensitivity?: boolean;
  /** True when a prior attempt on this lane already escalated (sticky per run). Default false. */
  priorEscalation?: boolean;
}

export interface ScoreWeights {
  workType: number;       // base addend (not directly used — workType verb drives the delta)
  blastRadius: number;    // per-file/module contribution
  dependsOn: number;      // upstream contract present
  security: number;       // sensitivity flag
  priorEscalation: number; // sticky prior-attempt escalation
}

export interface Thresholds {
  mid: number;      // score >= mid  → mid (unless >= powerful)
  powerful: number; // score >= powerful → powerful
}

export interface ScorerOpts {
  scoreWeights?: Partial<ScoreWeights>;
  thresholds?: Partial<Thresholds>;
  /** The host-agnostic tier→model map. When absent, model is not resolved. */
  tiers?: {
    cheap?: { claude?: string | null; codex?: string | null; gemini?: string | null };
    mid?:   { claude?: string | null; codex?: string | null; gemini?: string | null };
    powerful?: { claude?: string | null; codex?: string | null; gemini?: string | null };
  };
  /** Active host adapter. Default "claude". */
  host?: "claude" | "codex" | "gemini";
  /** Explicit tier pin (--model-tier or per-lane override). Bypasses scoring. */
  modelTierPin?: Tier;
  /**
   * R-006: models.enabled gate. When false, skip auto-scoring entirely and use the
   * default `mid` tier (current v2 behavior). Default true (scoring active).
   * Consumed from settings.models.enabled via loadConfigModels().
   */
  enabled?: boolean;
}

export interface TierResult {
  score: number;
  tier: Tier;
  model?: string; // resolved model name for the active host, or undefined if not in map
}

// ── Built-in defaults (mirrors DEFAULTS.models in read-guild-config.ts) ──────

const DEFAULT_WEIGHTS: ScoreWeights = {
  workType: 0,         // base — verb drives the delta (not this addend)
  blastRadius: 1,      // per-unit contribution
  dependsOn: 1,
  security: 1,
  priorEscalation: 1,
};

const DEFAULT_THRESHOLDS: Thresholds = {
  mid: 1,
  powerful: 3,
};

const DEFAULT_TIERS = {
  cheap:    { claude: "haiku",  codex: null, gemini: null },
  mid:      { claude: "sonnet", codex: null, gemini: null },
  powerful: { claude: "opus",   codex: null, gemini: null },
};

// ── Work-type verb → score delta (ADR §2 rubric) ──────────────────────────

function workTypeDelta(wt: WorkType): number {
  switch (wt) {
    case "read":
    case "summarize":
      return 0;
    case "draft":
    case "extract":
      return 1;
    case "architect":
    case "review":
    case "schema":
      return 2;
    default:
      return 0;
  }
}

// ── Pure scorer function ──────────────────────────────────────────────────────

/**
 * scoreTier — deterministic tier resolver.
 *
 * Implements ADR §2 signal-sum rubric. Pure function: no I/O, no LLM, no network.
 * Precedence: modelTierPin (opts) > scored tier.
 */
export function scoreTier(signals: TierSignals, opts: ScorerOpts = {}): TierResult {
  const weights: ScoreWeights = { ...DEFAULT_WEIGHTS, ...(opts.scoreWeights ?? {}) };
  const thresholds: Thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
  const tiers = opts.tiers ?? DEFAULT_TIERS;
  const host = opts.host ?? "claude";

  // R-006: models.enabled gate — when false, skip scoring and use the static mid tier.
  // This matches documented behavior: "false = all lanes run at mid (current v2 behavior)".
  // The modelTierPin still overrides even when enabled=false (explicit pin is always top).
  if (opts.enabled === false && opts.modelTierPin === undefined) {
    const midEntry = tiers["mid"] as Record<string, string | null | undefined> | undefined;
    const midModel = midEntry?.[host];
    return {
      score: 0,
      tier: "mid",
      model: (midModel != null) ? midModel : undefined,
    };
  }

  // Compute score
  let score = 0;
  score += workTypeDelta(signals.workType);
  if ((signals.blastRadius ?? 0) > 0) {
    score += (signals.blastRadius ?? 0) * weights.blastRadius;
  }
  if (signals.hasUpstreamContract) score += weights.dependsOn;
  if (signals.sensitivity)         score += weights.security;
  if (signals.priorEscalation)     score += weights.priorEscalation;

  // Resolve tier from score
  let tier: Tier;
  if (score >= thresholds.powerful) {
    tier = "powerful";
  } else if (score >= thresholds.mid) {
    tier = "mid";
  } else {
    tier = "cheap";
  }

  // Apply pin (top of precedence ladder)
  if (opts.modelTierPin !== undefined) {
    tier = opts.modelTierPin;
    // score is still the raw computed score — not modified by pin
  }

  // Resolve model from tier map
  const tierEntry = tiers[tier] as Record<string, string | null | undefined> | undefined;
  const rawModel = tierEntry?.[host];
  const model = (rawModel != null && rawModel !== undefined) ? rawModel : undefined;

  return { score, tier, model };
}

// ── Config loader (uses settings-resolver — no subprocess, inherits workspace) ─

/**
 * Load models config (scoreWeights, thresholds, tiers) from the settings resolver.
 * Replaces the former subprocess call to read-guild-config.ts.
 *
 * The resolver applies the full 5-layer inheritance chain so a workspace root's
 * models config is inherited by child projects (unless the child overrides).
 * Graceful on missing/parse errors — returns {} so scoreTier falls back to built-ins.
 */
function loadConfigModels(cwd: string): Pick<ScorerOpts, "scoreWeights" | "thresholds" | "tiers" | "enabled"> {
  try {
    const { config } = resolveSettings({ cwd });
    const m = config.models;
    if (!m) return {};
    return {
      enabled: m.enabled,     // R-006: gate the scorer on this flag
      scoreWeights: m.scoreWeights,
      thresholds: m.thresholds,
      tiers: m.tiers,
    };
  } catch {
    return {};
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main(): void {
  const argv = process.argv.slice(2);
  let rawSignals: string | undefined;
  let cwd: string | undefined;
  let modelTierPin: Tier | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--signals" && argv[i + 1]) {
      rawSignals = argv[++i];
    } else if (arg.startsWith("--signals=")) {
      rawSignals = arg.slice("--signals=".length);
    } else if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg.startsWith("--cwd=")) {
      cwd = arg.slice("--cwd=".length);
    } else if (arg === "--model-tier" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "cheap" || v === "mid" || v === "powerful") modelTierPin = v;
    } else if (arg.startsWith("--model-tier=")) {
      const v = arg.slice("--model-tier=".length);
      if (v === "cheap" || v === "mid" || v === "powerful") modelTierPin = v;
    }
  }

  if (!rawSignals) {
    process.stderr.write("[score-tier] ERROR: --signals '<json>' is required\n");
    process.stdout.write(JSON.stringify({ score: 0, tier: "cheap" }) + "\n");
    process.exit(0); // non-blocking: scoring failure must not block dispatch
    return;
  }

  let signals: TierSignals;
  try {
    signals = JSON.parse(rawSignals) as TierSignals;
  } catch (e) {
    process.stderr.write(`[score-tier] ERROR: could not parse --signals JSON: ${(e as Error).message}\n`);
    process.stdout.write(JSON.stringify({ score: 0, tier: "cheap" }) + "\n");
    process.exit(0);
    return;
  }

  // Load config from cwd when provided (reuses read-guild-config.ts — no re-spelling)
  const configOpts: ScorerOpts = cwd ? loadConfigModels(cwd) : {};

  const result = scoreTier(signals, { ...configOpts, modelTierPin });
  process.stdout.write(JSON.stringify(result) + "\n");
}

// Only run main() when invoked directly (not when imported by tests)
if (require.main === module) {
  main();
}
