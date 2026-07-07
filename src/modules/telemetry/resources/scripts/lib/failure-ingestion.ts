/**
 * scripts/lib/failure-ingestion.ts
 *
 * P2-Wave-3 ADDITIVE — AC37 failure → improvement-PROPOSAL ingestion (spec SC-W3-7,
 * ADR step 18 / AC37).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 18 (AC37)
 *   .guild/spec/universal-host-p2-wave3.md  SC-W3-7
 *   .guild/plan/universal-host-p2-wave3.md  lane LW3-7 (dep LW3-1)
 *
 * WHY: AC37 says repeated product-workflow failures must drive improvement — but Guild
 * must NEVER self-edit its own runtime (a workflow that rewrites its permissions/skills/
 * agents on failure is an unbounded, unsafe feedback loop). This module routes repeated
 * failures into the EXISTING reflect/evolve PROPOSAL path: it emits three proposal kinds —
 *   - skill_evolution     → reflection `proposals.skill_improvement[]` (the key
 *                           `analyze-runs.ts` already aggregates → guild:evolve-skill)
 *   - benchmark_fixture   → an eval/benchmark fixture candidate (low-risk test material)
 *   - template_improvement→ a `guild.template.v1` (LW3-1) tree-improvement candidate
 * and lands them ONLY under `.guild/reflections/` + the `.guild/evolve/` candidate surface.
 *
 * HARD SAFETY PROPERTY (AC37 no-self-edit): ingestion PROPOSES ONLY. It NEVER writes or
 * edits a runtime permission file, a skill (`skills/**`), or an agent (`agents/**`,
 * `.claude/agents/**`). This is ENFORCED IN CODE (a fail-closed path guard on every write),
 * not merely asserted in prose — and proven anti-vacuously by the LW3-7 spy-based negative
 * test. The proposer core is PURE (no I/O); only the explicit emitter writes, and only
 * under the two allowed proposal roots.
 *
 * Reuses LW3-1 / Wave-1: `makeLearningCandidate` (typed candidate + promotion gate) so the
 * proposals bind to the existing `guild.learning_candidate.v1` policy (gate = PROPOSE,
 * never auto-promote). No clock / no random in this module — callers pass `run_id` + `date`.
 *
 * Owned by tooling-engineer (LW3-7); consumed by guild:reflect / analyze-runs aggregation.
 */

import * as fs from "fs";
import * as path from "path";
import {
  makeLearningCandidate,
  type LearningCandidate,
} from "./learning-candidate.js";

// ---------------------------------------------------------------------------
// Schema constants
// ---------------------------------------------------------------------------

export const FAILURE_PROPOSAL_SCHEMA_VERSION = "guild.failure_proposal.v1" as const;

/** The three AC37 proposal kinds — closed set. */
export const FAILURE_PROPOSAL_KINDS = [
  "skill_evolution",
  "benchmark_fixture",
  "template_improvement",
] as const;
export type FailureProposalKind = (typeof FAILURE_PROPOSAL_KINDS)[number];

/** Default "repeated" threshold — matches analyze-runs.ts `--min-runs` default. */
export const DEFAULT_MIN_REPEATS = 3;

// ---------------------------------------------------------------------------
// Input — a single product-workflow failure observation
// ---------------------------------------------------------------------------

export interface ProductWorkflowFailure {
  /** The run the failure occurred in (an evidence ref). */
  run_id: string;
  /** The product-loop stage that failed (e.g. "explore", "define", "build"). */
  stage: string;
  /** The dedup key — WHAT repeated. Failures sharing a signature are one cluster. */
  signature: string;
  /** Optional human detail. */
  detail?: string;
  /** Optional: the skill implicated (drives the skill_evolution proposal text). */
  skill?: string;
  /** Optional: the guild.template.v1 id implicated (drives template_improvement). */
  template_id?: string;
}

// ---------------------------------------------------------------------------
// Output — a typed PROPOSAL (never a self-edit)
// ---------------------------------------------------------------------------

export interface FailureProposal {
  schema_version: typeof FAILURE_PROPOSAL_SCHEMA_VERSION;
  kind: FailureProposalKind;
  /** The cluster signature this proposal addresses. */
  signature: string;
  /**
   * The CLEAN aggregation token (kebab, no commas/brackets/quotes) the existing
   * `analyze-runs.ts` groups on — the implicated skill name (skill_evolution), the
   * template id (template_improvement), else the signature. Prose lives in `summary`.
   */
  target: string;
  /** How many failures clustered under this signature (≥ the threshold). */
  occurrences: number;
  /** Human-readable proposal text. */
  summary: string;
  /** Evidence — the run ids that produced the cluster. */
  evidence_refs: string[];
  /** Informational destination — NEVER an auto-write target. */
  recommended_destination: "skill" | "eval" | "template";
  /** Promotion gate — always human-gated or auto-PROPOSE; never auto-apply a self-edit. */
  promotion_gate: "human_approval" | "auto_propose";
}

export interface FailureCluster {
  signature: string;
  occurrences: number;
  run_ids: string[];
  stages: string[];
  skills: string[];
  template_ids: string[];
}

export interface IngestResult {
  clusters: FailureCluster[];
  proposals: FailureProposal[];
}

// ---------------------------------------------------------------------------
// Core proposer — PURE (no I/O, no clock, no random)
// ---------------------------------------------------------------------------

/**
 * Sanitize to a clean aggregation token: the existing `analyze-runs.ts` inline-array
 * parser splits on commas and truncates at `]`, so a token must contain neither (nor
 * quotes/whitespace). Collapses any other run to a single hyphen.
 */
export function sanitizeToken(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

/** Unique, order-preserving string list. */
function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Cluster failures by signature; for every cluster meeting the repeat threshold emit the
 * three AC37 proposal kinds. PURE — performs NO I/O. The three kinds are derived through
 * `makeLearningCandidate` (reused policy) so each proposal carries a PROPOSE-only gate.
 */
export function ingestFailures(
  failures: readonly ProductWorkflowFailure[],
  opts: { minRepeats?: number } = {}
): IngestResult {
  const minRepeats = opts.minRepeats ?? DEFAULT_MIN_REPEATS;

  // Group by signature, preserving first-seen order.
  const order: string[] = [];
  const groups = new Map<string, ProductWorkflowFailure[]>();
  for (const f of failures) {
    if (!f || typeof f.signature !== "string" || f.signature.trim() === "") continue;
    if (!groups.has(f.signature)) {
      groups.set(f.signature, []);
      order.push(f.signature);
    }
    groups.get(f.signature)!.push(f);
  }

  const clusters: FailureCluster[] = [];
  const proposals: FailureProposal[] = [];

  for (const sig of order) {
    const fs_ = groups.get(sig)!;
    if (fs_.length < minRepeats) continue; // not "repeated" — no proposal

    const run_ids = uniq(fs_.map((f) => f.run_id).filter((s) => !!s));
    const stages = uniq(fs_.map((f) => f.stage).filter((s) => !!s));
    const skills = uniq(fs_.map((f) => f.skill ?? "").filter((s) => !!s));
    const template_ids = uniq(fs_.map((f) => f.template_id ?? "").filter((s) => !!s));
    const occurrences = fs_.length;

    clusters.push({ signature: sig, occurrences, run_ids, stages, skills, template_ids });

    // (1) skill_evolution — routes to reflection `proposals.skill_improvement[]`.
    const skillCand: LearningCandidate = makeLearningCandidate({
      type: "skill_improvement",
      summary: `skill_evolution: "${sig}" failed ${occurrences}× across stages [${stages.join(", ")}]${
        skills.length ? ` (skill: ${skills.join(", ")})` : ""
      } — PROPOSE evolving the implicated skill (human-gated, never auto-applied).`,
      scope: "repo",
      evidence_refs: run_ids,
      impact: "high",
    });
    proposals.push({
      schema_version: FAILURE_PROPOSAL_SCHEMA_VERSION,
      kind: "skill_evolution",
      signature: sig,
      // The token analyze-runs aggregates → `guild:evolve-skill <token>`: the implicated
      // skill when known (only when unambiguous — one skill), else the signature.
      target: sanitizeToken(skills.length === 1 ? skills[0] : sig),
      occurrences,
      summary: skillCand.summary,
      evidence_refs: run_ids,
      recommended_destination: "skill",
      promotion_gate: skillCand.promotion_gate === "auto_propose" ? "auto_propose" : "human_approval",
    });

    // (2) benchmark_fixture — low-risk test material (eval_fixture → auto_propose).
    const fixtureCand: LearningCandidate = makeLearningCandidate({
      type: "eval_fixture",
      summary: `benchmark_fixture: capture "${sig}" as a regression fixture so the suite re-detects it.`,
      scope: "repo",
      evidence_refs: run_ids,
      impact: "medium",
    });
    proposals.push({
      schema_version: FAILURE_PROPOSAL_SCHEMA_VERSION,
      kind: "benchmark_fixture",
      signature: sig,
      target: sanitizeToken(sig),
      occurrences,
      summary: fixtureCand.summary,
      evidence_refs: run_ids,
      recommended_destination: "eval",
      promotion_gate: fixtureCand.promotion_gate === "auto_propose" ? "auto_propose" : "human_approval",
    });

    // (3) template_improvement — a guild.template.v1 (LW3-1) tree-improvement candidate.
    //     A template is ADDITIVE data, NOT a runtime skill/agent/perm — but it is still a
    //     PROPOSAL here, human-gated, never auto-applied.
    proposals.push({
      schema_version: FAILURE_PROPOSAL_SCHEMA_VERSION,
      kind: "template_improvement",
      signature: sig,
      target: sanitizeToken(template_ids.length === 1 ? template_ids[0] : sig),
      occurrences,
      summary: `template_improvement: "${sig}" recurs${
        template_ids.length ? ` for template(s) [${template_ids.join(", ")}]` : ""
      } — PROPOSE refining the product template (context_questions / default_checks / release_gates) to pre-empt it.`,
      evidence_refs: run_ids,
      recommended_destination: "template",
      promotion_gate: "human_approval",
    });
  }

  return { clusters, proposals };
}

// ---------------------------------------------------------------------------
// Renderers — PURE (produce the existing reflect/evolve artifact text)
// ---------------------------------------------------------------------------

/**
 * Render a `guild:reflect`-compatible reflection markdown.
 *
 * The frontmatter `proposals.skill_improvement` is the SAME key `analyze-runs.ts` already
 * aggregates (→ `guild:evolve-skill`). It MUST use the INLINE-ARRAY form of CLEAN tokens
 * (no commas/brackets/quotes) — that is the ONLY nested shape the aggregator's minimal
 * frontmatter parser reads (it splits on `,` and truncates at `]`). Prose proposal text
 * lives in the BODY + the `.guild/evolve/` candidate report, never in these tokens. The
 * benchmark/template kinds ride additive sibling keys in the same inline-array form. PURE.
 */
export function renderReflectionMarkdown(
  result: IngestResult,
  meta: { run_id: string; date: string }
): string {
  // Unique, sanitized aggregation tokens per kind (already sanitized at ingest; uniq here).
  const tokensFor = (k: FailureProposalKind) =>
    uniq(result.proposals.filter((p) => p.kind === k).map((p) => p.target));

  // Inline array of single-quoted clean tokens — the only nested shape analyze-runs parses.
  const inline = (key: string, tokens: string[]): string =>
    `  ${key}: [${tokens.map((t) => `'${t}'`).join(", ")}]`;

  const fm = [
    "---",
    `run_id: ${meta.run_id}`,
    `date: ${meta.date}`,
    "source: ac37-failure-ingestion",
    "proposals:",
    inline("skill_improvement", tokensFor("skill_evolution")),
    inline("benchmark_fixture", tokensFor("benchmark_fixture")),
    inline("template_improvement", tokensFor("template_improvement")),
    "---",
    "",
  ].join("\n");

  const body = [
    `# Reflection — AC37 failure ingestion (${meta.run_id})`,
    "",
    "## Repeated product-workflow failures → improvement PROPOSALS (human-gated)",
    "",
    "These are PROPOSALS only. AC37 no-self-edit: nothing here edits a runtime permission,",
    "skill, or agent file. Promotion is the existing human-gated evolve/ingest path.",
    "",
    ...result.clusters.map(
      (c) =>
        `- **${c.signature}** — ${c.occurrences}× across [${c.stages.join(", ")}]; runs: ${c.run_ids.join(
          ", "
        )}`
    ),
    "",
    "### Proposals",
    "",
    ...result.proposals.map((p) => `- [${p.kind} → ${p.target}] ${p.summary}`),
    "",
  ].join("\n");

  return fm + body;
}

/** Render the `.guild/evolve/` candidate report (the evolve-candidate surface). PURE. */
export function renderEvolveCandidateMarkdown(
  result: IngestResult,
  meta: { run_id: string; date: string }
): string {
  const lines = [
    `# AC37 failure → evolve candidates — ${meta.run_id}`,
    "",
    `date: ${meta.date} · source: ac37-failure-ingestion · PROPOSAL-ONLY (never auto-promoted)`,
    "",
  ];
  for (const p of result.proposals) {
    lines.push(
      `- [${p.kind}] (${p.promotion_gate} → ${p.recommended_destination}) ${p.occurrences}× — ${p.summary}`
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Fail-closed path guard — the AC37 safety property, ENFORCED IN CODE
// ---------------------------------------------------------------------------

/**
 * True iff `p` points at a Guild RUNTIME surface that ingestion must NEVER write:
 * a skill (`skills/…`), an agent (`agents/…`, `.claude/agents/…`), or a permission
 * file. Normalizes separators so the check holds cross-platform. Exported so the
 * negative test can assert the write spy never saw such a path.
 */
export function isRuntimeSurfacePath(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return (
    /(^|\/)skills\//.test(n) ||
    /(^|\/)agents\//.test(n) ||
    /(^|\/)\.claude\/agents\//.test(n) ||
    /(^|\/)\.claude-plugin\//.test(n) ||
    /(^|\/)commands\//.test(n) ||
    /permission-policy/.test(n) ||
    /(^|\/)settings\.json$/.test(n)
  );
}

/** Resolve + assert `target` is inside `root`; throws fail-closed otherwise. */
function assertInside(root: string, target: string): string {
  const absRoot = path.resolve(root);
  const abs = path.resolve(target);
  const rel = path.relative(absRoot, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`AC37 guard: refusing to write outside ${absRoot}: ${abs}`);
  }
  if (isRuntimeSurfacePath(abs)) {
    throw new Error(`AC37 guard: refusing to write a runtime surface file: ${abs}`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Emitter — the ONLY writer; writes ONLY under the two allowed proposal roots
// ---------------------------------------------------------------------------

export interface EmitResult {
  reflection_path: string;
  evolve_path: string;
}

/**
 * Write the proposals through the existing reflect/evolve path — and NOWHERE else.
 *
 * Writes exactly two files:
 *   <guildRoot>/.guild/reflections/<run_id>.md       (reflect path)
 *   <guildRoot>/.guild/evolve/<run_id>-ac37-candidates.md  (evolve-candidate surface)
 *
 * Every target is run through `assertInside` against its allowed root AND the runtime-
 * surface guard — so this function CANNOT write a permission / skill / agent file even if
 * misused. PROPOSES only.
 */
export function emitFailureProposals(
  result: IngestResult,
  meta: { run_id: string; date: string; guildRoot: string }
): EmitResult {
  const reflectionsRoot = path.join(meta.guildRoot, ".guild", "reflections");
  const evolveRoot = path.join(meta.guildRoot, ".guild", "evolve");

  fs.mkdirSync(reflectionsRoot, { recursive: true });
  fs.mkdirSync(evolveRoot, { recursive: true });

  const reflectionPath = assertInside(reflectionsRoot, path.join(reflectionsRoot, `${meta.run_id}.md`));
  const evolvePath = assertInside(evolveRoot, path.join(evolveRoot, `${meta.run_id}-ac37-candidates.md`));

  fs.writeFileSync(reflectionPath, renderReflectionMarkdown(result, meta), "utf8");
  fs.writeFileSync(evolvePath, renderEvolveCandidateMarkdown(result, meta), "utf8");

  return { reflection_path: reflectionPath, evolve_path: evolvePath };
}

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope). LW3-6 may call it.
// ---------------------------------------------------------------------------

/** A deterministic fixture of repeated failures. */
export const FAILURE_FIXTURE: ProductWorkflowFailure[] = [
  { run_id: "run-a", stage: "explore", signature: "explore-stalls-on-vague-idea", skill: "product-explore", template_id: "web-app" },
  { run_id: "run-b", stage: "explore", signature: "explore-stalls-on-vague-idea", skill: "product-explore", template_id: "web-app" },
  { run_id: "run-c", stage: "define", signature: "explore-stalls-on-vague-idea", skill: "product-explore", template_id: "web-app" },
  { run_id: "run-d", stage: "build", signature: "one-off-flake", skill: "execute-plan" },
];

/**
 * Deterministic smoke check; NO process IO, never exits. Confirms a repeated signature
 * yields all three proposal kinds, a one-off (below threshold) yields none, and the
 * runtime-surface guard flags a skill path.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const { proposals } = ingestFailures(FAILURE_FIXTURE);
  const kinds = new Set(proposals.map((p) => p.kind));
  const allThree =
    kinds.has("skill_evolution") && kinds.has("benchmark_fixture") && kinds.has("template_improvement");
  const oneOffDropped = proposals.every((p) => p.signature !== "one-off-flake");
  const guardFlags = isRuntimeSurfacePath("plugin/skills/meta/foo/SKILL.md") &&
    isRuntimeSurfacePath("agents/backend.md") &&
    !isRuntimeSurfacePath(".guild/reflections/run-a.md");
  const pass = allThree && oneOffDropped && guardFlags;
  return {
    pass,
    details: `all-three-kinds=${allThree} one-off-dropped=${oneOffDropped} guard-flags=${guardFlags}`,
  };
}
