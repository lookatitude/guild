/**
 * work-class.ts — the SIX-WAY intake classifier (KTD41 / R55 / R58 / R69).
 *
 * `classify-intake.ts` answers one question: is this prompt the product loop or
 * not. The class graphs need five answers plus "I do not know", so this file
 * widens that verdict to `product | research | debug | ops | init | other`
 * WITHOUT touching the shipped binary classifier — T02/T04 already pipe
 * `$ARGUMENTS` through `classifyIntake`, and `runIntakeSmoke` pins its exact
 * behaviour. The product arm here DELEGATES to it rather than re-deriving it, so
 * there is one product rule in the codebase, not two that drift.
 *
 * Precision-over-recall, unchanged (R1): a single hard engineering veto still
 * sinks a product reading. What changes is where the vetoed prompt LANDS. In the
 * binary classifier a veto meant `other` and the caller fell through to its own
 * judgement; here "fix this crash" is not merely not-product, it is positively
 * `debug`, because the veto family that sank it (fix / crash / broken / stack
 * trace) IS the debug signal. That is the whole trick of the widening: the
 * existing veto table was already a debug detector wearing a negative sign.
 *
 * Binding order is NOT this file's judgement (KTD41):
 *
 *   1. a typed L1 verb that already exists (`/guild:init`, `/guild:ops`, …)
 *   2. `--class=<c>`
 *   3. this classifier
 *
 * A typed verb outranks the classifier because the operator already said it. The
 * classifier only ever fills silence, and when it is not confident it says
 * `other` so T0 asks rather than guessing — an unasked wrong class routes a whole
 * run through the wrong graph.
 */

import { classifyIntake } from "./classify-intake";

/** The five closed classes plus the "ask the operator" verdict. */
export const WORK_CLASSES = Object.freeze(["product", "research", "debug", "ops", "init"] as const);
export type WorkClass = (typeof WORK_CLASSES)[number];
export type WorkClassVerdict = WorkClass | "other";

/** How a run's class was decided. Mirrors `guild.workflow_cursor.v1.bound_from`. */
export type ClassBindSource = "typed_verb" | "class_flag" | "intake" | "change_class";

export interface WorkClassSignal {
  id: string;
  klass: WorkClassVerdict;
  weight: number;
}

export interface WorkClassResult {
  /** The verdict. `other` means "not confident — T0 asks". */
  class: WorkClassVerdict;
  /** Per-class net scores, for diagnostics and for the ask prompt's ordering. */
  scores: Readonly<Record<WorkClass, number>>;
  signals: readonly WorkClassSignal[];
}

/**
 * Typed L1 verbs that ALREADY bind a class without the classifier running. The
 * sub-verbs `research` and `debug` are here too: KTD69 makes them class binders
 * on the existing `/guild` command rather than a 14th and 15th command file.
 */
export const TYPED_VERB_CLASS: Readonly<Record<string, WorkClass>> = Object.freeze({
  init: "init",
  ops: "ops",
  research: "research",
  debug: "debug",
  ideate: "product",
  plan: "product",
  build: "product",
  qa: "product",
});

// ── Signals ──────────────────────────────────────────────────────────────────

interface ClassSignalDef {
  id: string;
  klass: WorkClass;
  weight: number;
  re: RegExp;
}

const W_OPENER = 1.0;
const W_CORROBORATE = 0.5;

/** Net score a class must reach to beat `other`. */
export const CLASS_THRESHOLD = 1.0;

/**
 * Openers, by class. Each family is anchored on a VERB or a named artifact, never
 * on a bare noun: "monitor" is ops, "monitoring dashboard colours" is not, and the
 * difference is whether the prompt asks for the act.
 */
const CLASS_SIGNALS: ClassSignalDef[] = [
  // ── debug ──────────────────────────────────────────────────────────────────
  // These deliberately overlap the binary classifier's veto table. There the
  // patterns subtract from a product score; here they add to a debug one.
  {
    id: "debug-fix-verb",
    klass: "debug",
    weight: W_OPENER,
    re: /\b(?:fix(?:es|ing|ed)?|debug(?:ging|ged|s)?|troubleshoot(?:ing|s)?|repair(?:s|ing|ed)?)\b/,
  },
  {
    id: "debug-symptom",
    klass: "debug",
    weight: W_OPENER,
    re: /\b(?:crash(?:es|ing|ed)?|broken|regression|stack ?trace|traceback|segfault|panic(?:s|ked|king)?|hang(?:s|ing)?|deadlock)\b/,
  },
  {
    id: "debug-root-cause",
    klass: "debug",
    weight: W_OPENER,
    re: /\b(?:root[- ]cause|diagnose|investigate why|why (?:is|does|did|are) .*(?:fail|break|crash|error|hang|wrong))\b/,
  },
  {
    id: "debug-failing",
    klass: "debug",
    weight: W_CORROBORATE,
    re: /\b(?:error|errors|exception|fail(?:s|ed|ing)?|failure|flaky|intermittent)\b/,
  },

  // ── research ───────────────────────────────────────────────────────────────
  {
    id: "research-find-out",
    klass: "research",
    weight: W_OPENER,
    re: /\b(?:find out|look into|dig into|research|survey|investigate (?:the|our|how|what|whether)|literature review)\b/,
  },
  {
    id: "research-compare",
    klass: "research",
    weight: W_OPENER,
    re: /\b(?:compare|comparison|evaluate (?:the )?(?:options|alternatives|tradeoffs|trade[- ]offs)|weigh (?:the )?(?:options|alternatives)|which (?:one )?should we (?:use|pick|choose))\b/,
  },
  {
    id: "research-what-does-x-say",
    klass: "research",
    weight: W_OPENER,
    re: /\b(?:what does .* say|what do the docs say|how do others|prior art|state of the art|benchmark(?:s|ing)? (?:against|of))\b/,
  },
  {
    id: "research-corroborate",
    klass: "research",
    weight: W_CORROBORATE,
    re: /\b(?:options?|alternatives?|tradeoffs?|trade[- ]offs?|evidence|sources?|papers?|findings?)\b/,
  },

  // ── ops ────────────────────────────────────────────────────────────────────
  {
    id: "ops-deploy",
    klass: "ops",
    weight: W_OPENER,
    re: /\b(?:deploy(?:ment|s|ing|ed)?|ship (?:it|this|the release)|cut (?:a|the) release|roll ?(?:out|back)|rollback|promote (?:to|the) (?:prod|production|stable))\b/,
  },
  {
    id: "ops-incident",
    klass: "ops",
    weight: W_OPENER,
    re: /\b(?:incident|outage|pager|on[- ]call|postmortem|post[- ]mortem|sev[- ]?[0-9])\b/,
  },
  {
    id: "ops-monitor",
    klass: "ops",
    weight: W_OPENER,
    re: /\b(?:set up (?:monitoring|alerting|observability)|add (?:an? )?alert|monitor (?:the|our|this)|runbook)\b/,
  },
  {
    id: "ops-corroborate",
    klass: "ops",
    weight: W_CORROBORATE,
    re: /\b(?:prod|production|staging|canary|pipeline|infra(?:structure)?|cluster)\b/,
  },

  // ── init ───────────────────────────────────────────────────────────────────
  {
    id: "init-onboard",
    klass: "init",
    weight: W_OPENER,
    re: /\b(?:onboard(?:ing)? (?:this|the|a) (?:repo|codebase|project)|set up guild|initiali[sz]e guild|get (?:guild )?started (?:on|in|with) (?:this|the))\b/,
  },
  {
    id: "init-new-root",
    klass: "init",
    weight: W_OPENER,
    re: /\b(?:new repo|new repository|new project|existing codebase|brand[- ]new (?:repo|project)|this is a workspace|umbrella workspace)\b/,
  },
  {
    id: "init-learn-repo",
    klass: "init",
    weight: W_CORROBORATE,
    re: /\b(?:learn (?:this|the) (?:repo|codebase)|map (?:this|the) (?:repo|codebase)|what is this (?:repo|codebase))\b/,
  },
];

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

const EMPTY_SCORES = (): Record<WorkClass, number> => ({
  product: 0, research: 0, debug: 0, ops: 0, init: 0,
});

/**
 * Six-way classification of a raw prompt. Pure, deterministic, never throws.
 *
 * The product arm is the shipped binary classifier's verdict, promoted to a score
 * so it competes on the same scale as the other four. That is deliberate: a prompt
 * like "I have an idea for a deploy tool" fires both a product structure and an
 * ops opener, and the tie has to be resolved somewhere. It is resolved by score,
 * and a genuine tie is `other` — the operator settles it, not a coin flip.
 */
export function classifyWorkClass(prompt: unknown): WorkClassResult {
  const scores = EMPTY_SCORES();
  const signals: WorkClassSignal[] = [];
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { class: "other", scores: Object.freeze(scores), signals: Object.freeze([]) };
  }

  const text = normalize(prompt);

  for (const def of CLASS_SIGNALS) {
    if (!def.re.test(text)) continue;
    signals.push({ id: def.id, klass: def.klass, weight: def.weight });
    scores[def.klass] += def.weight;
  }

  // The product arm: one rule, delegated. A `product_loop` verdict is a full
  // opener; anything else contributes nothing rather than a negative, because the
  // binary classifier's "other" already means "not product", not "anti-product".
  if (classifyIntake(prompt).intake === "product_loop") {
    signals.push({ id: "product-loop-intake", klass: "product", weight: W_OPENER });
    scores.product += W_OPENER;
  }

  let best: WorkClassVerdict = "other";
  let bestScore = 0;
  let tied = false;
  for (const k of WORK_CLASSES) {
    const s = scores[k];
    if (s > bestScore) {
      best = k; bestScore = s; tied = false;
    } else if (s === bestScore && s > 0) {
      tied = true;
    }
  }
  if (bestScore < CLASS_THRESHOLD || tied) best = "other";

  return { class: best, scores: Object.freeze(scores), signals: Object.freeze(signals) };
}

export interface ClassBindInput {
  /** The operator's verbatim prompt. */
  prompt?: unknown;
  /** A typed L1 verb or sub-verb, if one was used (`init`, `ops`, `research`, …). */
  typedVerb?: string | null;
  /** An explicit `--class=<c>` flag value. */
  classFlag?: string | null;
}

export interface ClassBinding {
  class: WorkClassVerdict;
  bound_from: ClassBindSource;
  /** True when T0 must ask the operator instead of routing. */
  needs_operator: boolean;
  result?: WorkClassResult;
}

/**
 * Resolve the class for a run, in the KTD41 binding order. An unknown typed verb
 * or an unknown `--class=` value is NOT silently downgraded to the classifier: an
 * operator who typed something we do not recognise gets asked, because guessing
 * past a typo is exactly how a run ends up in the wrong graph.
 */
export function bindWorkClass(input: ClassBindInput): ClassBinding {
  const verb = typeof input.typedVerb === "string" ? input.typedVerb.trim().toLowerCase() : "";
  if (verb !== "") {
    const bound = TYPED_VERB_CLASS[verb];
    return bound
      ? { class: bound, bound_from: "typed_verb", needs_operator: false }
      : { class: "other", bound_from: "typed_verb", needs_operator: true };
  }

  const flag = typeof input.classFlag === "string" ? input.classFlag.trim().toLowerCase() : "";
  if (flag !== "") {
    const ok = (WORK_CLASSES as readonly string[]).includes(flag);
    return ok
      ? { class: flag as WorkClass, bound_from: "class_flag", needs_operator: false }
      : { class: "other", bound_from: "class_flag", needs_operator: true };
  }

  const result = classifyWorkClass(input.prompt);
  return {
    class: result.class,
    bound_from: "intake",
    needs_operator: result.class === "other",
    result,
  };
}
