#!/usr/bin/env -S npx tsx
/**
 * hooks/emit-learning-checkpoint.ts
 *
 * HK-03 — per-phase `guild.learning_checkpoint.v1` emitter.
 *
 * CONTRACT (by pointer):
 *   .guild/initiatives/active/drift-remediation/contracts/learning-checkpoint.v1.md
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
 * Optional: GUILD_CHECKPOINT_VERDICT=<json-path> (SK-13 integration)
 * Output: path of written checkpoint
 *
 * ── INVARIANTS (VC-K7) ───────────────────────────────────────────────────
 * - Never writes to .guild/wiki/ directly
 * - Non-`none` verdicts ONLY route to the reflections queue (operator gate)
 * - No permission / sandbox / runtime policy changes
 */

import * as fs from "fs";
import * as path from "path";

// ── Schema constants ───────────────────────────────────────────────────────

export const SCHEMA_VERSION = "guild.learning_checkpoint.v1" as const;

/** Closed 7-value phase enum per architect contract. */
export const VALID_PHASES = [
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
  "reflection",
] as const;

export type CheckpointPhase = (typeof VALID_PHASES)[number];

/**
 * 12-target decision set (VC-K4). Machine-checked by `DECISION_TARGETS.length === 12`.
 * Each value is a freeform string; `none` = no action warranted.
 */
export const DECISION_TARGETS = [
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
] as const;

export type DecisionTarget = (typeof DECISION_TARGETS)[number];

export type CheckpointDecisions = Record<DecisionTarget, string>;

/** All-`none` default — safe advisory default for any phase checkpoint. */
export const ALL_NONE_DECISIONS: CheckpointDecisions = Object.fromEntries(
  DECISION_TARGETS.map((k) => [k, "none"]),
) as CheckpointDecisions;

/** Closed 9-edge type set for `knowledge_links_batch`. */
export const VALID_EDGE_TYPES = [
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves",
] as const;

export type EdgeType = (typeof VALID_EDGE_TYPES)[number];

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

  return lines.join("\n") + "\n";
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
  });

  fs.writeFileSync(checkpointFile, yaml, "utf8");

  // Append non-none verdicts to reflections queue (VC-K7 guard inside)
  appendReflections(guildRoot, opts.runId, opts.phase, decisions);

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

  if (!runId) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_RUN_ID not set\n");
    process.exit(1);
  }
  if (!phase) {
    process.stderr.write("[emit-learning-checkpoint] ERROR: GUILD_PHASE not set\n");
    process.exit(1);
  }

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

  try {
    const written = writeCheckpoint({
      runId,
      phase: phase as CheckpointPhase,
      evidenceRef,
      guildRoot,
      decisions,
    });
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[emit-learning-checkpoint] ERROR: ${String(e)}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
