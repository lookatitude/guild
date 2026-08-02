#!/usr/bin/env -S npx tsx
/**
 * hooks/emit-learning-checkpoint.ts
 *
 * HK-03 — per-phase `guild.learning_checkpoint.v1` emitter.
 *
 * CONTRACT (by pointer):
 *   .guild/initiatives/archived/drift-remediation/contracts/learning-checkpoint.v1.md
 *
 * DRIFT finding: HK-03 (high) — the once-at-Stop maybe-reflect pattern is
 * replaced by a per-phase checkpoint emitted at each phase review boundary.
 * Default: all 12 decision targets → `none`; advisory, no new gate.
 *
 * Emit path: .guild/runs/<run-id>/learning/<phase>-<run-id>.yaml
 * Reflections queue: .guild/reflections/<run-id>.md (appended when any
 * decision is non-`none`; nothing auto-promotes — operator reviews queue).
 *
 * ── EXPORTED SEAM (skill-author / SK-13) ──────────────────────────────────
 * `writeCheckpoint(opts)` is the public API. SK-13 calls it with a populated
 * `decisions` verdict block after classifying phase artifacts. This module
 * owns the envelope + write; SK-13 owns the classifier logic.
 *
 * ── STANDALONE CLI ────────────────────────────────────────────────────────
 * Usage (phase hook):
 *   GUILD_RUN_ID=<id> GUILD_PHASE=development GUILD_EVIDENCE_REF=<path> \
 *     npx tsx hooks/emit-learning-checkpoint.ts
 * Optional: GUILD_CHECKPOINT_VERDICT=<json-path>           (pre-written verdict; SK-13 integration)
 * Optional: GUILD_CHECKPOINT_ARTIFACTS_JSON=<json-path>    (ArtifactSet for in-process classify)
 *   When GUILD_CHECKPOINT_VERDICT is absent but GUILD_CHECKPOINT_ARTIFACTS_JSON is
 *   provided, the hook calls classifyPhase() from scripts/lib/learning-signatures.ts
 *   to produce the real 12-target verdict (the GUILD_CHECKPOINT_VERDICT producer path).
 *   Both absent → all-none default (behavior-neutral, back-compat).
 * Output: path of written checkpoint
 *
 * ── INVARIANTS (VC-K7) ───────────────────────────────────────────────────
 * - Never writes to .guild/wiki/ directly
 * - Non-`none` verdicts ONLY route to the reflections queue (operator gate)
 * - No permission / sandbox / runtime policy changes
 */

import * as fs from "fs";
import * as path from "path";

// ── Classifier integration (learning-signatures) ───────────────────────────
// Imported lazily so the module stays loadable even before scripts/lib is built.
// classifyPhase is the GUILD_CHECKPOINT_VERDICT producer when the caller
// provides a serialized ArtifactSet via GUILD_CHECKPOINT_ARTIFACTS_JSON.
import { classifyPhase, type ArtifactSet } from "../scripts/lib/learning-signatures";

// ── Schema constants ───────────────────────────────────────────────────────

export const SCHEMA_VERSION = "guild.learning_checkpoint.v1" as const;

/** Closed 7-value phase enum per architect contract. */
export const VALID_PHASES = Object.freeze([
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
  "reflection",
] as const);

export type CheckpointPhase = (typeof VALID_PHASES)[number];

/**
 * 12-target decision set (VC-K4). Machine-checked by `DECISION_TARGETS.length === 12`.
 * Each value is a freeform string; `none` = no action warranted.
 */
export const DECISION_TARGETS = Object.freeze([
  "memory",
  "wiki",
  "knowledge_graph",
  "domain_model",
  "agent_def",
  "skill_def",
  "agent_template",
  "skill_template",
  "config",
  "task_tracking",
  "workflow_rules",
  "review_policy",
] as const);

export type DecisionTarget = (typeof DECISION_TARGETS)[number];

export type CheckpointDecisions = Record<DecisionTarget, string>;

/** All-`none` default — safe advisory default for any phase checkpoint. */
export const ALL_NONE_DECISIONS: CheckpointDecisions = Object.fromEntries(
  DECISION_TARGETS.map((k) => [k, "none"]),
) as CheckpointDecisions;

/** Closed 9-edge type set for `knowledge_links_batch`. */
export const VALID_EDGE_TYPES = Object.freeze([
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves",
] as const);

export type EdgeType = (typeof VALID_EDGE_TYPES)[number];

/** Allowed node-id prefixes in the work/decision space (closed set per contract §3). */
export const ALLOWED_NODE_PREFIXES = Object.freeze([
  "task:",
  "run:",
  "decision:",
  "skill:",
  "agent:",
  "feature:",
] as const);

/**
 * Forbidden node-id prefixes — cross-space references that bridge work/decision
 * space to code/wiki/domain space, violating the no-node-space-overlap invariant.
 * Any edge whose `from` or `to` starts with one of these is rejected before write.
 */
export const FORBIDDEN_NODE_PREFIXES = Object.freeze([
  "wiki:",
  "file:",
  "domain:",
  "component:",
] as const);

export interface KnowledgeLink {
  from: string;
  to: string;
  type: EdgeType;
  run_id: string;
}

// ── Public opts ───────────────────────────────────────────────────────────

export interface WriteCheckpointOpts {
  runId: string;
  phase: CheckpointPhase;
  evidenceRef: string;
  /**
   * The guild root (i.e. the directory that contains .git and .guild/).
   * Defaults to `process.cwd()` when invoked via CLI.
   */
  guildRoot?: string;
  /** Optional verdict block from SK-13; defaults to ALL_NONE_DECISIONS. */
  decisions?: CheckpointDecisions;
  /**
   * Short facts already present in the phase's receipt/review/provenance that
   * the classifier read (not new evidence — read off existing artifacts only).
   * Contract §1: REQUIRED field, may be empty list.
   */
  observed?: string[];
  /** Optional knowledge links; empty by default. */
  knowledgeLinksBatch?: KnowledgeLink[];
  /**
   * G-7 (SC-3, additive): marks a checkpoint written by the Stop-hook
   * BACKSTOP (hooks/learning-backstop.ts) rather than the per-phase
   * emitter. When true, the YAML gains a trailing `backstop: true` line so
   * analytics can distinguish a model-emitted checkpoint from the
   * guaranteed-record no-op. Default false/absent — existing callers and
   * existing YAML output are byte-identical.
   */
  backstop?: boolean;
}

// ── Validation ─────────────────────────────────────────────────────────────

function assertPhase(phase: string): asserts phase is CheckpointPhase {
  if (!(VALID_PHASES as readonly string[]).includes(phase)) {
    throw new Error(
      `[emit-learning-checkpoint] invalid phase: "${phase}". ` +
        `Expected one of: ${VALID_PHASES.join(", ")}`,
    );
  }
}

function assertEdgeTypes(links: KnowledgeLink[]): void {
  for (const link of links) {
    if (!(VALID_EDGE_TYPES as readonly string[]).includes(link.type)) {
      throw new Error(
        `[emit-learning-checkpoint] invalid edge type: "${link.type}". ` +
          `Expected one of: ${VALID_EDGE_TYPES.join(", ")}`,
      );
    }
  }
}

/**
 * ALLOWLIST gate: every `from`/`to` node id MUST start with one of the 6
 * allowed work/decision-space prefixes (`ALLOWED_NODE_PREFIXES`). Anything
 * else — a known forbidden prefix (wiki:/file:/domain:/component:), an
 * unknown/custom prefix, or a bare no-prefix id — is rejected.
 *
 * "No node-space overlap with the code/wiki KnowledgeGraph" (contract §3).
 * Throws immediately on the first violation so no partial index write occurs.
 */
function assertNodePrefixes(links: KnowledgeLink[]): void {
  for (const link of links) {
    for (const node of [link.from, link.to]) {
      const allowed = (ALLOWED_NODE_PREFIXES as readonly string[]).some((p) =>
        node.startsWith(p),
      );
      if (!allowed) {
        // Give a specific message for known forbidden prefixes; generic otherwise.
        const matchedForbidden = (FORBIDDEN_NODE_PREFIXES as readonly string[]).find(
          (p) => node.startsWith(p),
        );
        const detail = matchedForbidden
          ? `uses the cross-space prefix "${matchedForbidden}" (code/wiki/domain space)`
          : `uses an unknown or no-prefix node id "${node}"`;
        throw new Error(
          `[emit-learning-checkpoint] invalid node in edge ` +
            `(from: "${link.from}", to: "${link.to}") — ${detail}. ` +
            `Node ids must start with an allowed work/decision-space prefix: ` +
            `${ALLOWED_NODE_PREFIXES.join(", ")}.`,
        );
      }
    }
  }
}

// ── YAML serialization (manual — no external dep) ─────────────────────────

/**
 * Minimal safe YAML value serializer. Wraps values in double-quotes only when
 * strictly necessary for YAML safety. A colon is only special in YAML when
 * followed by a space or at end-of-line (mapping key indicator); bare colons
 * elsewhere (e.g. `candidate:.guild/...`) are legal unquoted scalars.
 */
function yamlValue(v: string): string {
  if (v === "none") return "none";
  // Must quote: colon-space (mapping key), or leading indicator chars that
  // YAML parsers treat as block/flow/alias/anchor/tag markers, or surrounding
  // whitespace, or empty string.
  if (
    /: /.test(v) ||            // colon-space → would be a mapping
    /:$/.test(v) ||            // trailing colon
    v.trim() !== v ||          // leading/trailing whitespace
    v === "" ||                // empty
    /^[{[\]}&*#?|<>=!%@`'"]/.test(v) // leading YAML indicator
  ) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function buildYaml(opts: {
  runId: string;
  phase: string;
  evidenceRef: string;
  decisions: CheckpointDecisions;
  observed: string[];
  reflectionsPath: string;
  knowledgeLinksBatch: KnowledgeLink[];
  backstop?: boolean;
}): string {
  // Contract §1: top-level comment + nested `learning_checkpoint:` wrapper.
  // Field order matches contract exactly:
  //   version, phase, run_id, observed, decisions, knowledge_links_batch,
  //   routed_to, evidence_ref
  const lines: string[] = [
    `# ${SCHEMA_VERSION}`,
    "learning_checkpoint:",
    `  version: ${SCHEMA_VERSION}`,
    `  phase: ${opts.phase}`,
    `  run_id: ${opts.runId}`,
  ];

  // observed: [] or list of short fact strings (already in receipt/review/provenance)
  if (opts.observed.length === 0) {
    lines.push("  observed: []");
  } else {
    lines.push("  observed:");
    for (const fact of opts.observed) {
      lines.push(`    - ${yamlValue(fact)}`);
    }
  }

  lines.push("  decisions:");
  for (const key of DECISION_TARGETS) {
    lines.push(`    ${key}: ${yamlValue(opts.decisions[key] ?? "none")}`);
  }

  if (opts.knowledgeLinksBatch.length === 0) {
    lines.push("  knowledge_links_batch: []");
  } else {
    lines.push("  knowledge_links_batch:");
    for (const link of opts.knowledgeLinksBatch) {
      lines.push(
        `    - from: ${yamlValue(link.from)}`,
        `      to: ${yamlValue(link.to)}`,
        `      type: ${link.type}`,
        `      run_id: ${link.run_id}`,
      );
    }
  }

  lines.push(`  routed_to: ${yamlValue(opts.reflectionsPath)}`);
  lines.push(`  evidence_ref: ${yamlValue(opts.evidenceRef)}`);

  // G-7 (additive): trailing backstop marker — emitted ONLY when true so
  // every pre-existing checkpoint shape stays byte-identical.
  if (opts.backstop === true) {
    lines.push("  backstop: true");
  }

  return lines.join("\n") + "\n";
}

// ── Knowledge-links index append ──────────────────────────────────────────

/**
 * Append new edges to `.guild/indexes/knowledge-links.json`.
 *
 * Append-only: reads existing links, deduplicates by `{from, to, type}` (run_id
 * excluded from the dedup key — the same conceptual edge from multiple runs is
 * one edge in the index), then writes the merged set back.
 *
 * VC-K7: index is additive only — no auto-promote path.
 *
 * 3-producer model (architect NN#8 — knowledge-links.json is a derived,
 * rebuildable projection):
 *   1. `knowledge-links-builder.ts` — canonical full rebuild (authoritative)
 *   2. This module (emit-learning-checkpoint.ts) — incremental append of
 *      checkpoint edges, ALL re-derivable by the builder. The W3 builder change
 *      landed (NN#8 W3): `knowledge-links-builder.ts` now emits decided_by /
 *      supersedes / resolves from decision-page frontmatter, so no checkpoint
 *      edge type is builder-ephemeral any more.
 *   3. `domain.ts` — incremental append of domain-graph edges
 *
 * Never throws: I/O failures are logged to stderr and swallowed.
 */
function appendKnowledgeLinksIndex(
  guildRoot: string,
  links: KnowledgeLink[],
): void {
  if (links.length === 0) return;

  const indexDir = path.join(guildRoot, ".guild", "indexes");
  const indexPath = path.join(indexDir, "knowledge-links.json");

  // Read existing links (safe — missing file = empty list).
  let existing: KnowledgeLink[] = [];
  if (fs.existsSync(indexPath)) {
    try {
      const raw = fs.readFileSync(indexPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed["links"])) {
        existing = parsed["links"] as KnowledgeLink[];
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not parse knowledge-links.json — ` +
          `starting fresh: ${String(e)}\n`,
      );
      existing = [];
    }
  }

  // Dedup: composite key is \0-joined {from, to, type}.
  const existingKeys = new Set(
    existing.map((l) => `${l.from}\0${l.to}\0${l.type}`),
  );
  const novel = links.filter(
    (l) => !existingKeys.has(`${l.from}\0${l.to}\0${l.type}`),
  );

  if (novel.length === 0) return; // all already present — no write needed

  const merged = [...existing, ...novel];

  try {
    fs.mkdirSync(indexDir, { recursive: true });
    fs.writeFileSync(
      indexPath,
      JSON.stringify(
        { schema_version: "guild.knowledge_links.v1", links: merged },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  } catch (e) {
    process.stderr.write(
      `[emit-learning-checkpoint] WARN: could not write knowledge-links.json: ${String(e)}\n`,
    );
  }
}

// ── Reflections queue append ───────────────────────────────────────────────

function appendReflections(
  guildRoot: string,
  runId: string,
  phase: string,
  decisions: CheckpointDecisions,
): void {
  const nonNone = DECISION_TARGETS.filter((k) => decisions[k] !== "none");
  if (nonNone.length === 0) return; // VC-K7: nothing to queue

  const reflectionsDir = path.join(guildRoot, ".guild", "reflections");
  fs.mkdirSync(reflectionsDir, { recursive: true });
  const reflPath = path.join(reflectionsDir, `${runId}.md`);

  const entry =
    `\n## Phase: ${phase} (${runId})\n\n` +
    nonNone.map((k) => `- ${k}: ${decisions[k]}`).join("\n") +
    "\n";

  fs.appendFileSync(reflPath, entry, "utf8");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Write a `guild.learning_checkpoint.v1` YAML record for the given phase.
 *
 * @returns The absolute path of the written checkpoint file.
 *
 * SEAM: exported so SK-13 (skill-author) can call with a populated
 * `decisions` verdict block after classifying phase artifacts.
 */
export function writeCheckpoint(opts: WriteCheckpointOpts): string {
  // Validate inputs
  assertPhase(opts.phase);
  const links = opts.knowledgeLinksBatch ?? [];
  assertEdgeTypes(links);
  assertNodePrefixes(links);

  const guildRoot = opts.guildRoot ?? process.cwd();
  const decisions: CheckpointDecisions = opts.decisions ?? { ...ALL_NONE_DECISIONS };

  // Compute paths
  const learningDir = path.join(guildRoot, ".guild", "runs", opts.runId, "learning");
  fs.mkdirSync(learningDir, { recursive: true });
  const checkpointFile = path.join(learningDir, `${opts.phase}-${opts.runId}.yaml`);

  // Relative reflections path (stored in the YAML for reference; actual write uses absolute)
  const reflectionsRelPath = `.guild/reflections/${opts.runId}.md`;
  const reflectionsAbsPath = path.join(guildRoot, ".guild", "reflections", `${opts.runId}.md`);

  const observed = opts.observed ?? [];

  // Build + write YAML (contract §1 nested shape)
  const yaml = buildYaml({
    runId: opts.runId,
    phase: opts.phase,
    evidenceRef: opts.evidenceRef,
    decisions,
    observed,
    reflectionsPath: reflectionsRelPath,
    knowledgeLinksBatch: links,
    ...(opts.backstop === true ? { backstop: true } : {}),
  });

  fs.writeFileSync(checkpointFile, yaml, "utf8");

  // Append non-none verdicts to reflections queue (VC-K7 guard inside)
  appendReflections(guildRoot, opts.runId, opts.phase, decisions);

  // D-edge-batch: append new edges to the project-level knowledge-links index.
  // Append-only, dedup by {from,to,type}, never auto-promotes (VC-K7).
  // 3-producer model: knowledge-links-builder.ts (canonical rebuild) +
  // this module (incremental checkpoint append) + domain.ts (incremental
  // domain append). See appendKnowledgeLinksIndex JSDoc for the full model.
  appendKnowledgeLinksIndex(guildRoot, links);

  // Suppress the unused-var warning on reflectionsAbsPath — it's intentionally
  // here as documentation that we use the relative path in YAML but the
  // absolute path when writing. The actual write is in appendReflections().
  void reflectionsAbsPath;

  return checkpointFile;
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main(): void {
  const runId = process.env["GUILD_RUN_ID"];
  const phase = process.env["GUILD_PHASE"];
  const evidenceRef = process.env["GUILD_EVIDENCE_REF"] ?? "none";
  const guildRoot = process.env["GUILD_CWD"] ?? process.cwd();
  const verdictPath = process.env["GUILD_CHECKPOINT_VERDICT"];
  // D-edge-batch: path to the JSON file written by the SK-13 skill classifier
  // containing the `KnowledgeLink[]` for this phase.
  // Absent → empty batch (safe no-op, back-compat with Wave-1 callers).
  const linksPath = process.env["GUILD_CHECKPOINT_LINKS"];

  if (!runId) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_RUN_ID not set\n");
    process.exit(1);
  }
  if (!phase) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_PHASE not set\n");
    process.exit(1);
  }

  // GUILD_CHECKPOINT_ARTIFACTS_JSON: optional path to a JSON file containing
  // a serialized ArtifactSet produced by the phase skill (step 7.5).
  // When verdictPath is absent but this env var is present, the hook
  // classifies the artifacts in-process to produce a real verdict map.
  // This is the GUILD_CHECKPOINT_VERDICT producer path (learning-signatures.ts).
  const artifactsJsonPath = process.env["GUILD_CHECKPOINT_ARTIFACTS_JSON"];

  let decisions: CheckpointDecisions | undefined;
  if (verdictPath) {
    try {
      const raw = fs.readFileSync(verdictPath, "utf8");
      decisions = JSON.parse(raw) as CheckpointDecisions;
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_VERDICT (${verdictPath}): ${String(e)}\n`,
      );
    }
  }

  // Fallback: classify from ArtifactSet when no pre-written verdict file exists.
  // Behavior-neutral when GUILD_CHECKPOINT_ARTIFACTS_JSON is absent (decisions
  // stays undefined → writeCheckpoint defaults to ALL_NONE_DECISIONS, unchanged).
  if (decisions === undefined && artifactsJsonPath) {
    try {
      const rawArtifacts = fs.readFileSync(artifactsJsonPath, "utf8");
      const artifacts = JSON.parse(rawArtifacts) as ArtifactSet;
      // Inject runId and phase from the env if not already in the artifact set
      if (!artifacts.runId) artifacts.runId = runId;
      if (!artifacts.phase) artifacts.phase = phase ?? undefined;
      if (!artifacts.evidenceRef) artifacts.evidenceRef = evidenceRef !== "none" ? evidenceRef : undefined;
      const verdict = classifyPhase(artifacts);
      // Cast to CheckpointDecisions (the 12-key map is structurally identical)
      decisions = verdict as unknown as CheckpointDecisions;
      process.stderr.write(
        `[emit-learning-checkpoint] INFO: classified artifacts → non-none: ` +
          `${Object.entries(verdict).filter(([, v]) => v !== "none").map(([k]) => k).join(", ") || "none"}\n`,
      );
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not classify GUILD_CHECKPOINT_ARTIFACTS_JSON ` +
          `(${artifactsJsonPath}): ${String(e)}\n`,
      );
      // Fail-safe: leave decisions undefined → all-none default
    }
  }

  // D-edge-batch: read the links file written by the SK-13 classifier.
  // Invalid JSON / missing file → warn + continue with empty batch.
  let knowledgeLinksBatch: KnowledgeLink[] = [];
  if (linksPath) {
    try {
      const raw = fs.readFileSync(linksPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        knowledgeLinksBatch = parsed as KnowledgeLink[];
      } else {
        process.stderr.write(
          `[emit-learning-checkpoint] WARN: GUILD_CHECKPOINT_LINKS JSON is not an array ` +
            `— ignoring (${linksPath})\n`,
        );
      }
    } catch (e) {
      process.stderr.write(
        `[emit-learning-checkpoint] WARN: could not read GUILD_CHECKPOINT_LINKS ` +
          `(${linksPath}): ${String(e)}\n`,
      );
    }
  }

  try {
    const written = writeCheckpoint({
      runId,
      phase: phase as CheckpointPhase,
      evidenceRef,
      guildRoot,
      decisions,
      knowledgeLinksBatch, // populated from GUILD_CHECKPOINT_LINKS (was deferred [] in Wave 1)
    });
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[emit-learning-checkpoint] ERROR: ${String(e)}\n`);
    process.exit(1);
  }
}

// CLI gate — argv-based (same pattern as hooks/post-tool-use.ts), NOT
// `require.main === module`: esbuild scope-hoists this module into bundles
// that import writeCheckpoint (dist/learning-backstop.js), where `module`
// IS require.main and the old guard would run main() at bundle load.
if (
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("emit-learning-checkpoint.ts") ||
    process.argv[1].endsWith("emit-learning-checkpoint.js"))
) {
  main();
}
