#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// scripts/lib/classify-intake.ts
var classify_intake_exports = {};
__export(classify_intake_exports, {
  INTAKE_SMOKE_FIXTURE: () => INTAKE_SMOKE_FIXTURE,
  PRODUCT_LOOP_ENTRY_SKILL: () => PRODUCT_LOOP_ENTRY_SKILL,
  THRESHOLD: () => THRESHOLD,
  classifyIntake: () => classifyIntake,
  intakeRouteTarget: () => intakeRouteTarget,
  runClassifyIntakeCli: () => runClassifyIntakeCli,
  runIntakeSmoke: () => runIntakeSmoke
});
module.exports = __toCommonJS(classify_intake_exports);

// src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// src/modules/kernel/workflows/sealed-collections.ts
function regExpWritesLastIndex(re) {
  return re.global || re.sticky;
}
function freezeRegExpSafely(re) {
  if (regExpWritesLastIndex(re)) return false;
  Object.freeze(re);
  return true;
}
var SEALED_BRAND = /* @__PURE__ */ Symbol.for("guild.sealed_collection.v1");
function isSealedCollection(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Set || value instanceof Map) return false;
  const brand = value[SEALED_BRAND];
  return (brand === "set" || brand === "map") && Object.isFrozen(value);
}
function sealedCollectionValues(value) {
  if (!isSealedCollection(value)) return void 0;
  return [...value];
}
function deepFreeze(value, options = {}) {
  const policy = options.regexps ?? "safe";
  const seen = /* @__PURE__ */ new WeakSet();
  const walk = (node) => {
    if (node === null || typeof node !== "object") return;
    const obj = node;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof RegExp) {
      if (policy === "freeze") Object.freeze(obj);
      else if (policy === "safe") freezeRegExpSafely(obj);
      return;
    }
    if (obj instanceof Date) {
      return;
    }
    if (obj instanceof Set || obj instanceof Map) {
      throw new TypeError(
        "deepFreeze: refusing to 'freeze' a Set/Map \u2014 freeze does not close membership and the intrinsics reach past neutered own methods. Declare it with sealSet()/sealMap()."
      );
    }
    const sealedValues = sealedCollectionValues(obj);
    if (sealedValues !== void 0) {
      for (const entry of sealedValues) walk(entry);
      return;
    }
    Object.freeze(obj);
    for (const key of Reflect.ownKeys(obj)) {
      const descriptor = Object.getOwnPropertyDescriptor(obj, key);
      if (!descriptor || !("value" in descriptor)) continue;
      walk(descriptor.value);
    }
  };
  walk(value);
  return value;
}

// src/modules/kernel/workflows/path-containment.ts
var CONTAINMENT_REFUSAL_CODES = Object.freeze([
  "root-unresolvable",
  "no-existing-ancestor",
  "dangling-symlink",
  "physical-symlink",
  "outside-root",
  "leaf-not-regular-file",
  "mkdir-failed",
  "parent-traversal",
  "destination-moved"
]);

// src/modules/intake/workflows/classify-intake.ts
var THRESHOLD = 1;
var W_STRONG_IDEA = 1;
var W_OPENER = 0.6;
var W_SPEC = 0.6;
var W_VETO = 1.5;
var W_SOFT_NEG = 0.75;
var SIGNALS = [
  // ── Standalone bare-idea trigger (1.0 — clears THRESHOLD with no co-occurrence) ──
  // An explicit personal idea statement IS the product-loop trigger (AC30 canonical
  // "I have an idea for X"). A dev veto can still sink it via the score gate.
  {
    id: "strong-idea",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\b(?:i (?:have|'ve got|ve got|have got|got)|i've got|my)\s+(?:a|an|this|another|the)?\s*(?:idea|concept)\b/
  },
  // ── Discovery-phase product triggers (1.0 — standalone, per LW1-8 recall disposition) ──
  // "prototype the concept for X" / "explore whether X is feasible" are explicit product
  // DISCOVERY statements, not dev tasks — standalone like "I have an idea". A dev veto
  // still sinks them via the score gate ("explore whether the API errors" → other).
  {
    id: "prototype-concept",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bprototype (?:the |a |an |this |our )?(?:concept|idea|mvp|prototype)\b/
  },
  {
    id: "explore-feasibility",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bexplore (?:whether|if|the (?:idea|concept|feasibility|possibility|viability))\b/
  },
  // ── Product-ideation openers (each 0.6 — below THRESHOLD on their own) ──────
  { id: "idea-for", category: "opener", weight: W_OPENER, re: /\bidea for (?:a|an|some)\b/ },
  {
    id: "product-startup-idea",
    category: "opener",
    weight: W_OPENER,
    re: /\b(?:product|startup|app|business)\s+idea\b/
  },
  {
    id: "what-if-we-built",
    category: "opener",
    weight: W_OPENER,
    re: /\bwhat if we (?:built|made|created|build|make|create|had|add|added)\b/
  },
  // First-person "I want to build/make/create X" is itself a product-intent statement
  // (like "I have an idea") — STANDALONE (1.0, strong-idea), so a bare object with no
  // product-domain noun ("I want to build a habit tracker") still routes. A dev veto
  // still sinks it ("I want to create a script that migrates users" → other). [LW1-8 disposition]
  {
    id: "want-to-make-build",
    category: "strong-idea",
    weight: W_STRONG_IDEA,
    re: /\bi(?:'d| would)?\s*(?:want|wanna|'d like|would like|wish)\s+to\s+(?:make|build|create)\s+(?:a|an|some|something|my own)\b/
  },
  { id: "wish-there-was", category: "opener", weight: W_OPENER, re: /\bi wish there (?:was|were|wa?s)\b/ },
  {
    id: "wouldnt-it-be",
    category: "opener",
    weight: W_OPENER,
    re: /\bwould\s?n'?t it be (?:cool|great|nice|awesome|neat|amazing)\b/
  },
  {
    id: "thinking-of-building",
    category: "opener",
    weight: W_OPENER,
    re: /\bthinking (?:about|of) (?:building|making|creating|a|an)\b/
  },
  { id: "could-we-build", category: "opener", weight: W_OPENER, re: /\b(?:could|should|can) we (?:build|make|create)\b/ },
  { id: "lets-build-a", category: "opener", weight: W_OPENER, re: /\blet'?s (?:build|make|create) (?:a|an|some)\b/ },
  // ── Product-specificity signals (0.6) — a real product DOMAIN, not eng artifact
  {
    id: "product-noun",
    category: "specificity",
    weight: W_SPEC,
    re: /\b(?:apps?|tools?|products?|platforms?|marketplaces?|web ?apps?|mobile ?apps?|websites?|saas|games?|chatbots?|bots?|extensions?|plugins?|services?|startups?|widgets?)\b/
  },
  {
    id: "audience-market",
    category: "specificity",
    weight: W_SPEC,
    re: /\b(?:users?|customers?|consumers?|subscribers?|audiences?|markets?|businesses|people|creators?|freelancers?|shoppers?|neighbou?rs?)\b/
  },
  // ── Engineering / maintenance vetoes (strong — any one sinks the prompt) ────
  { id: "fix-debug-repair", category: "veto", weight: W_VETO, re: /\b(?:fix(?:es|ing|ed)?|debug(?:ging|ged|s)?|repair(?:s|ing|ed)?)\b/ },
  { id: "bug-broken", category: "veto", weight: W_VETO, re: /\b(?:bug|broken|crash(?:es|ing)?|regression)\b/ },
  {
    id: "error-failing",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:error|errors|exception|stack ?trace|traceback|fail(?:s|ed|ing)?|failure)\b/
  },
  { id: "review-pr", category: "veto", weight: W_VETO, re: /\b(?:review (?:this|the|my)|code review|pull request|\bpr\b)\b/ },
  { id: "plan-this", category: "veto", weight: W_VETO, re: /\bplan (?:this|the|out|a|my)\b/ },
  { id: "refactor", category: "veto", weight: W_VETO, re: /\brefactor(?:ing|ed|s)?\b/ },
  { id: "implement", category: "veto", weight: W_VETO, re: /\bimplement(?:ing|ed|ation|s)?\b/ },
  {
    id: "ops-migrate-deploy",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:deploy(?:ment|s)?|rollback|roll back|release[ds]?|migrat(?:e|es|ed|ing|ion|ions)|upgrade[ds]?|downgrade[ds]?|hotfix)\b/
  },
  {
    id: "eng-artifacts",
    category: "veto",
    weight: W_VETO,
    re: /\b(?:endpoints?|routes?|api|apis|hooks?|handlers?|webhooks?|middleware|daemons?|crons?|crontab|cli|scripts?|binary|binaries|microservices?|schemas?)\b/
  },
  { id: "test", category: "veto", weight: W_VETO, re: /\btest(?:s|ing|ed)?\b/ },
  { id: "log-rotation", category: "veto", weight: W_VETO, re: /\b(?:log rotation|rotate (?:old )?logs|logrotate)\b/ },
  {
    id: "code-change-verbs",
    category: "veto",
    weight: W_VETO,
    re: /\badd (?:an?\s+)?(?:endpoint|route|api|migration|column|field|table|test|param(?:eter)?|flag|hook|handler)\b/
  },
  { id: "diagnose", category: "veto", weight: W_VETO, re: /\b(?:diagnose|root[- ]cause|investigate why|why is .* (?:failing|broken))\b/ },
  { id: "slash-command", category: "veto", weight: W_VETO, re: /(?:^|\s)\/guild\b|\/guild:/ },
  // ── Softer "work on an existing surface" cues ──────────────────────────────
  { id: "feature-work", category: "veto", weight: W_SOFT_NEG, re: /\bfeature(?:s)?\b/ },
  { id: "update-change-the", category: "veto", weight: W_SOFT_NEG, re: /\b(?:update|change|modify|tweak|adjust|rename|remove|delete) the\b/ },
  { id: "in-the-codebase", category: "veto", weight: W_SOFT_NEG, re: /\b(?:in (?:the|this|our) (?:codebase|repo|repository|code|module|file)|existing code)\b/ }
];
function normalize(prompt) {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}
function classifyIntake(prompt) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return { intake: "other", score: 0, signals: [] };
  }
  const text = normalize(prompt);
  const signals = [];
  let score = 0;
  let hasStrongIdea = false;
  let hasOpener = false;
  let hasSpecificity = false;
  for (const def of SIGNALS) {
    if (def.re.test(text)) {
      const polarity = def.category === "veto" ? "other" : "product";
      signals.push({ id: def.id, category: def.category, polarity, weight: def.weight });
      score += polarity === "product" ? def.weight : -def.weight;
      if (def.category === "strong-idea") hasStrongIdea = true;
      if (def.category === "opener") hasOpener = true;
      if (def.category === "specificity") hasSpecificity = true;
    }
  }
  score = Math.round(score * 100) / 100;
  const hasProductStructure = hasStrongIdea || hasOpener && hasSpecificity;
  const intake = score >= THRESHOLD && hasProductStructure ? "product_loop" : "other";
  return { intake, score, signals };
}
var PRODUCT_LOOP_ENTRY_SKILL = "guild:product-explore";
function intakeRouteTarget(prompt) {
  const intake = classifyIntake(prompt).intake;
  return { intake, next_skill: intake === "product_loop" ? PRODUCT_LOOP_ENTRY_SKILL : null };
}
var INTAKE_SMOKE_FIXTURE = deepFreeze([
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
  { prompt: "Refactor the CLI so the cron daemon reads its config from disk", expect: "other" }
]);
function runIntakeSmoke(fixture = INTAKE_SMOKE_FIXTURE) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const mismatches = [];
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
function runClassifyIntakeCli(argv = process.argv.slice(2)) {
  const argPrompt = argv.join(" ");
  const emit = (p) => {
    process.stdout.write(JSON.stringify(classifyIntake(p), null, 2) + "\n");
  };
  if (argPrompt.trim() !== "") {
    emit(argPrompt);
  } else {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => buf += c);
    process.stdin.on("end", () => emit(buf));
  }
}
if (require.main === module) runClassifyIntakeCli();

// scripts/lib/classify-intake.ts
if (require.main === module) runClassifyIntakeCli();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  INTAKE_SMOKE_FIXTURE,
  PRODUCT_LOOP_ENTRY_SKILL,
  THRESHOLD,
  classifyIntake,
  intakeRouteTarget,
  runClassifyIntakeCli,
  runIntakeSmoke
});
