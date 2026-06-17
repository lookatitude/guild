/**
 * scripts/lib/classify-intake.ts
 *
 * Usage (library — pure function, no CLI, no I/O, no process.exit):
 *   import { classifyIntake } from "./lib/classify-intake";
 *   const r = classifyIntake("I have an idea for an app that tracks plants");
 *   // → { intake: "product_loop", score: 1.8,
 *   //      signals: [{ id: "have-an-idea", category: "opener", polarity: "product", … }, …] }
 *
 * LW1-2 of universal-host P2 Wave 1 (spec SC-W1-1a / ADR AC30). A DETERMINISTIC
 * product-loop intake classifier — signals + thresholds, NOT model-prose. It
 * routes a vague PRODUCT prompt ("I have an idea for X", "what if we built…",
 * "I want to make a tool that…") to `intake=product_loop`, and routes engineering
 * / maintenance prompts (bug fix, "plan this feature", "review this PR",
 * refactor, deploy) to `intake=other`.
 *
 * This lane ships ONLY the primitive. The WIRING into the no-slash `using-guild`
 * entry (behind the precision floor) is LW1-3 (skill-author) — not here.
 *
 * Contract:
 *  - Pure & deterministic: same prompt → same result. No clock, no fs, no random.
 *  - Precision-leaning by design: the no-slash path must NOT hijack non-product
 *    prompts (R1 precision floor), so a clear engineering veto outweighs a single
 *    product opener. Target precision ≥0.9 / recall ≥0.8 over LW1-8's fixture.
 *  - Explainable: every matched signal is returned in `signals[]` with its
 *    polarity and weight, so a caller (or eval) can see WHY a prompt routed.
 *  - Never throws: a non-string / empty prompt → `{ intake: "other", score: 0 }`.
 *
 * Scoring model + co-occurrence GATE (anti-over-fire) with a standalone bare-idea path:
 *   - Signals fall in four categories: `strong-idea` (an explicit personal idea
 *     statement — "I have an idea…", "my idea is…"), `opener` (a build/make/create
 *     ideation verb), `specificity` (product-domain noun / audience), and `veto`
 *     (engineering verb/artifact).
 *   - net score = Σ(strong-idea+opener+specificity weights) − Σ(veto weights), each id once.
 *   - `intake = product_loop` IFF `score >= THRESHOLD` **AND** EITHER:
 *       (a) a `strong-idea` signal is present (the AC30 canonical "I have an idea for X"
 *           is a product trigger ON ITS OWN — an explicit idea, not a dev task), OR
 *       (b) an `opener` CO-OCCURS with a `specificity` signal.
 *     A bare build/make/create opener (weight 0.6 < THRESHOLD) can NEVER route a dev
 *     prompt to product_loop: "What if we built an endpoint…" has an opener but no
 *     product specificity → `other`. And any single engineering veto (weight 1.5)
 *     sinks even a strong-idea or fully-specified prompt ("I have an idea to refactor
 *     the auth module" / "…build a tool for debugging tests" → `other`). This is the
 *     precision-over-recall tilt the wired path requires (R1).
 *
 * Spec: .guild/spec/universal-host-p2-wave1.md (SC-W1-1 / AC30), plan lane LW1-2.
 */

// ── Public types ────────────────────────────────────────────────────────────

export type Intake = "product_loop" | "other";

/**
 * Signal category — drives the gate. `strong-idea` is a standalone product trigger
 * (no co-occurrence needed); `opener` × `specificity` is the corroborated path.
 */
export type SignalCategory = "strong-idea" | "opener" | "specificity" | "veto";

export interface IntakeSignal {
  /** Stable signal id (kebab-case) — referenceable from evals / debugging. */
  id: string;
  /** Role in the gate: opener/specificity push toward product_loop; veto away. */
  category: SignalCategory;
  /** "product" pushes toward product_loop; "other" pushes away from it. */
  polarity: "product" | "other";
  /** Magnitude this signal contributes (always positive); applied per polarity. */
  weight: number;
}

export interface IntakeResult {
  intake: Intake;
  /** Net score = Σ(product weights) − Σ(other weights). >= THRESHOLD ⇒ product_loop. */
  score: number;
  /** Every signal that matched, de-duplicated by id, in declaration order. */
  signals: IntakeSignal[];
}

// ── Thresholds / weights ─────────────────────────────────────────────────────

/** Net score at/above which a (gate-passing) prompt routes to product_loop. */
export const THRESHOLD = 1.0;

const W_STRONG_IDEA = 1.0; // explicit personal idea statement — clears THRESHOLD ALONE
const W_OPENER = 0.6; // build/make/create ideation verb — BELOW THRESHOLD alone (anti-over-fire)
const W_SPEC = 0.6; // product-domain noun / audience — corroborates an opener
const W_VETO = 1.5; // clear engineering/maintenance verb/artifact — sinks a product prompt
const W_SOFT_NEG = 0.75; // softer "work on an existing surface" cue

// ── Signal table (declaration order is the tie-break / display order) ─────────

interface SignalDef {
  id: string;
  category: SignalCategory;
  weight: number;
  re: RegExp;
}

/**
 * All patterns run against a normalized prompt (lowercased, whitespace-collapsed).
 * Openers are anchored on ideation VERBS; specificity on PRODUCT-domain nouns /
 * audience terms (never bare "endpoint"/"script"/"hook" — those are eng artifacts
 * and live in the veto set). The opener×specificity gate is what stops a broad
 * opener ("what if we built…") over-firing on an engineering target.
 */
const SIGNALS: SignalDef[] = [
  // ── Standalone bare-idea trigger (1.0 — clears THRESHOLD with no co-occurrence) ──
  // An explicit personal idea statement IS the product-loop trigger (AC30 canonical
  // "I have an idea for X"). A dev veto can still sink it via the score gate.
  {
    id: "strong-idea",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\b(?:i (?:have|'ve got|ve got|have got|got)|i've got|my)\s+(?:a|an|this|another|the)?\s*(?:idea|concept)\b/,
  },
  // ── Discovery-phase product triggers (1.0 — standalone, per LW1-8 recall disposition) ──
  // "prototype the concept for X" / "explore whether X is feasible" are explicit product
  // DISCOVERY statements, not dev tasks — standalone like "I have an idea". A dev veto
  // still sinks them via the score gate ("explore whether the API errors" → other).
  {
    id: "prototype-concept",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bprototype (?:the |a |an |this |our )?(?:concept|idea|mvp|prototype)\b/,
  },
  {
    id: "explore-feasibility",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bexplore (?:whether|if|the (?:idea|concept|feasibility|possibility|viability))\b/,
  },

  // ── Product-ideation openers (each 0.6 — below THRESHOLD on their own) ──────
  { id: "idea-for", category: "opener", weight: W_OPENER, re: /\bidea for (?:a|an|some)\b/ },
  {
    id: "product-startup-idea",
    category: "opener",
    weight: W_OPENER,
    re: /\b(?:product|startup|app|business)\s+idea\b/,
  },
  {
    id: "what-if-we-built",
    category: "opener",
    weight: W_OPENER,
    re: /\bwhat if we (?:built|made|created|build|make|create|had|add|added)\b/,
  },
  // First-person "I want to build/make/create X" is itself a product-intent statement
  // (like "I have an idea") — STANDALONE (1.0, strong-idea), so a bare object with no
  // product-domain noun ("I want to build a habit tracker") still routes. A dev veto
  // still sinks it ("I want to create a script that migrates users" → other). [LW1-8 disposition]
  {
    id: "want-to-make-build",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bi(?:'d| would)?\s*(?:want|wanna|'d like|would like|wish)\s+to\s+(?:make|build|create)\s+(?:a|an|some|something|my own)\b/,
  },
  { id: "wish-there-was", category: "opener", weight: W_OPENER, re: /\bi wish there (?:was|were|wa?s)\b/ },
  {
    id: "wouldnt-it-be",
    category: "opener",
    weight: W_OPENER,
    re: /\bwould\s?n'?t it be (?:cool|great|nice|awesome|neat|amazing)\b/,
  },
  {
    id: "thinking-of-building",
    category: "opener",
    weight: W_OPENER,
    re: /\bthinking (?:about|of) (?:building|making|creating|a|an)\b/,
  },
  { id: "could-we-build", category: "opener", weight: W_OPENER, re: /\b(?:could|should|can) we (?:build|make|create)\b/ },
  { id: "lets-build-a", category: "opener", weight: W_OPENER, re: /\blet'?s (?:build|make|create) (?:a|an|some)\b/ },

  // ── Product-specificity signals (0.6) — a real product DOMAIN, not eng artifact
  {
    id: "product-noun",
    category: "specificity",
    weight: W_SPEC,
    re: /\b(?:apps?|tools?|products?|platforms?|marketplaces?|web ?apps?|mobile ?apps?|websites?|saas|games?|chatbots?|bots?|extensions?|plugins?|services?|startups?|widgets?)\b/,
  },
  {
    id: "audience-market",
    category: "specificity",
    weight: W_SPEC,
    re: /\b(?:users?|customers?|consumers?|subscribers?|audiences?|markets?|businesses|people|creators?|freelancers?|shoppers?|neighbou?rs?)\b/,
  },

  // ── Engineering / maintenance vetoes (strong — any one sinks the prompt) ────
  { id: "fix-debug-repair", category: "veto", weight: W_VETO, re: /\b(?:fix(?:es|ing|ed)?|debug(?:ging|ged|s)?|repair(?:s|ing|ed)?)\b/ },
  { id: "bug-broken", category: "veto", weight: W_VETO, re: /\b(?:bug|broken|crash(?:es|ing)?|regression)\b/ },
  {
    id: "error-failing",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:error|errors|exception|stack ?trace|traceback|fail(?:s|ed|ing)?|failure)\b/,
  },
  { id: "review-pr", category: "veto", weight: W_VETO, re: /\b(?:review (?:this|the|my)|code review|pull request|\bpr\b)\b/ },
  { id: "plan-this", category: "veto", weight: W_VETO, re: /\bplan (?:this|the|out|a|my)\b/ },
  { id: "refactor", category: "veto", weight: W_VETO, re: /\brefactor(?:ing|ed|s)?\b/ },
  { id: "implement", category: "veto", weight: W_VETO, re: /\bimplement(?:ing|ed|ation|s)?\b/ },
  {
    id: "ops-migrate-deploy",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:deploy(?:ment|s)?|rollback|roll back|release[ds]?|migrat(?:e|es|ed|ing|ion|ions)|upgrade[ds]?|downgrade[ds]?|hotfix)\b/,
  },
  {
    id: "eng-artifacts",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:endpoints?|routes?|api|apis|hooks?|handlers?|webhooks?|middleware|daemons?|crons?|crontab|cli|scripts?|binary|binaries|microservices?|schemas?)\b/,
  },
  { id: "test", category: "veto", weight: W_VETO, re: /\btest(?:s|ing|ed)?\b/ },
  { id: "log-rotation", category: "veto", weight: W_VETO, re: /\b(?:log rotation|rotate (?:old )?logs|logrotate)\b/ },
  {
    id: "code-change-verbs",
    category: "veto",
    weight: W_VETO,
    re: /\badd (?:an?\s+)?(?:endpoint|route|api|migration|column|field|table|test|param(?:eter)?|flag|hook|handler)\b/,
  },
  { id: "diagnose", category: "veto", weight: W_VETO, re: /\b(?:diagnose|root[- ]cause|investigate why|why is .* (?:failing|broken))\b/ },
  { id: "slash-command", category: "veto", weight: W_VETO, re: /(?:^|\s)\/guild\b|\/guild:/ },

  // ── Softer "work on an existing surface" cues ──────────────────────────────
  { id: "feature-work", category: "veto", weight: W_SOFT_NEG, re: /\bfeature(?:s)?\b/ },
  { id: "update-change-the", category: "veto", weight: W_SOFT_NEG, re: /\b(?:update|change|modify|tweak|adjust|rename|remove|delete) the\b/ },
  { id: "in-the-codebase", category: "veto", weight: W_SOFT_NEG, re: /\b(?:in (?:the|this|our) (?:codebase|repo|repository|code|module|file)|existing code)\b/ },
];

// ── Core ──────────────────────────────────────────────────────────────────────

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Classify a raw prompt as a product-loop intake or not. Pure & deterministic.
 */
export function classifyIntake(prompt: unknown): IntakeResult {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { intake: "other", score: 0, signals: [] };
  }

  const text = normalize(prompt);
  const signals: IntakeSignal[] = [];
  let score = 0;
  let hasStrongIdea = false;
  let hasOpener = false;
  let hasSpecificity = false;

  for (const def of SIGNALS) {
    if (def.re.test(text)) {
      const polarity: "product" | "other" =
        def.category === "veto" ? "other" : "product";
      signals.push({ id: def.id, category: def.category, polarity, weight: def.weight });
      score += polarity === "product" ? def.weight : -def.weight;
      if (def.category === "strong-idea") hasStrongIdea = true;
      if (def.category === "opener") hasOpener = true;
      if (def.category === "specificity") hasSpecificity = true;
    }
  }

  // Round to avoid floating-point drift (0.6/0.75 weights) breaking the
  // deterministic `>= THRESHOLD` comparison.
  score = Math.round(score * 100) / 100;

  // GATE: route to product_loop only if the score clears THRESHOLD AND a real
  // product structure is present — EITHER a standalone bare-idea statement (AC30
  // canonical) OR a build/make/create opener corroborated by product specificity.
  // The score requirement means any single engineering veto (1.5) still sinks the
  // prompt; the structure requirement means a broad opener cannot over-fire on a
  // dev target ("what if we built an endpoint…" → no specificity → other).
  const hasProductStructure = hasStrongIdea || (hasOpener && hasSpecificity);
  const intake: Intake = score >= THRESHOLD && hasProductStructure ? "product_loop" : "other";

  return { intake, score, signals };
}

// ── Inline smoke set ──────────────────────────────────────────────────────────
//
// A SMALL hand-set used as a smoke check only — NOT the authoritative trigger
// accuracy eval (that ≥12+/≥12- fixture is LW1-8/eval-engineer's deliverable).
// Kept here so the primitive carries its own minimal self-evidence.

export interface SmokeCase {
  prompt: string;
  expect: Intake;
}

export const INTAKE_SMOKE_FIXTURE: SmokeCase[] = [
  // ── PINNED canonical AC30 bare-idea positives (standalone trigger, no co-occurrence) ──
  { prompt: "I have an idea for X", expect: "product_loop" },
  { prompt: "I have an idea for a budgeting app", expect: "product_loop" },
  { prompt: "I've got an idea for a product", expect: "product_loop" },

  // ── more positives — vague product ideation (opener × product specificity) ──
  { prompt: "I have an idea for an app that helps people track their houseplants", expect: "product_loop" },
  { prompt: "What if we built a tool that summarizes long PDFs?", expect: "product_loop" },
  { prompt: "I want to make a tool that turns voice notes into to-do lists", expect: "product_loop" },
  { prompt: "I wish there was an app that reminded me to call my parents", expect: "product_loop" },
  { prompt: "Got a startup idea: a marketplace for local farmers", expect: "product_loop" },
  { prompt: "Wouldn't it be cool if we had a service that auto-tags photos?", expect: "product_loop" },
  { prompt: "I have an idea for a marketplace where neighbors lend tools", expect: "product_loop" },
  { prompt: "What if we made an app that matches dog owners for playdates?", expect: "product_loop" },
  { prompt: "I want to build a product that helps freelancers manage their invoices", expect: "product_loop" },
  { prompt: "Wouldn't it be great to have a platform connecting tutors and students?", expect: "product_loop" },
  { prompt: "Got a startup idea: an app for busy parents to plan family meals", expect: "product_loop" },
  { prompt: "I wish there was a service that reminds me to water my plants", expect: "product_loop" },

  // ── negatives (12) — engineering / maintenance (incl. the 5 G-lane FPs) ────
  { prompt: "Fix the bug where the login button does nothing on mobile", expect: "other" },
  { prompt: "Plan this feature: add SSO to the admin dashboard", expect: "other" },
  { prompt: "Review this PR and tell me if the migration is safe", expect: "other" },
  { prompt: "Refactor the payment module to use the new client", expect: "other" },
  { prompt: "The test suite is failing after the upgrade, diagnose it", expect: "other" },
  { prompt: "Add an endpoint to export users as CSV", expect: "other" },
  // ↓ the five over-fire prompts Codex flagged on the G-lane review (MUST be other)
  { prompt: "What if we built an endpoint that creates invoices?", expect: "other" },
  { prompt: "I want to create a script that migrates users to the new table", expect: "other" },
  { prompt: "Thinking about a small script to rotate old logs", expect: "other" },
  { prompt: "What if we made a hook that validates receipts?", expect: "other" },
  { prompt: "I would like to build a tool for debugging flaky tests", expect: "other" },
  // ↓ extra: covers cli / cron / daemon / refactor vetoes
  { prompt: "Refactor the CLI so the cron daemon reads its config from disk", expect: "other" },
];

/**
 * Run the inline smoke set; returns precision/recall + any mismatches. Used by
 * the smoke test and available for ad-hoc verification. Not the gating eval.
 */
export function runIntakeSmoke(fixture: SmokeCase[] = INTAKE_SMOKE_FIXTURE): {
  precision: number;
  recall: number;
  mismatches: Array<{ prompt: string; expect: Intake; got: Intake }>;
} {
  let tp = 0; // predicted product_loop, expected product_loop
  let fp = 0; // predicted product_loop, expected other
  let fn = 0; // predicted other, expected product_loop
  const mismatches: Array<{ prompt: string; expect: Intake; got: Intake }> = [];

  for (const c of fixture) {
    const got = classifyIntake(c.prompt).intake;
    if (got !== c.expect) mismatches.push({ prompt: c.prompt, expect: c.expect, got });
    if (got === "product_loop" && c.expect === "product_loop") tp++;
    else if (got === "product_loop" && c.expect === "other") fp++;
    else if (got === "other" && c.expect === "product_loop") fn++;
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  return { precision, recall, mismatches };
}

// ── CLI — the deterministic router entrypoint for the no-slash `using-guild` path ──
//
// LW1-3 wiring (SC-W1-1b). The no-slash entry invokes THIS to decide routing, so the
// decision is deterministic CODE on the real path — never model-prose re-derivation of
// the heuristic (the recurring self-build defect). The caller routes on the `intake`
// field ONLY (`product_loop` ⇒ product-loop intake), NEVER the raw `score`.
//
// Import stays PURE — this block runs ONLY when the file is executed directly
// (`require.main === module`), preserving LW1-2's "no process IO at module scope"
// contract for every importer (the validators, the smoke test, LW1-8's eval).
//
// Usage (prompt via stdin is preferred — robust to quotes/newlines in a user prompt):
//   echo "<prompt>" | npx tsx scripts/lib/classify-intake.ts
//   npx tsx scripts/lib/classify-intake.ts "<prompt>"
// Stdout: the IntakeResult as JSON ({ intake, score, signals }). Exit 0 always.
if (require.main === module) {
  const argPrompt = process.argv.slice(2).join(" ");
  const emit = (p: string): void => {
    process.stdout.write(JSON.stringify(classifyIntake(p), null, 2) + "\n");
  };
  if (argPrompt.trim() !== "") {
    emit(argPrompt);
  } else {
    // No argv prompt — read the verbatim prompt from stdin (quoting-safe).
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (buf += c));
    process.stdin.on("end", () => emit(buf));
  }
}
