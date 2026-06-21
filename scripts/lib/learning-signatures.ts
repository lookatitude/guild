/**
 * scripts/lib/learning-signatures.ts
 *
 * Usage: import { classifyPhase } from './learning-signatures'
 *        import { classifyMemory, classifyWiki, ... } from './learning-signatures'
 *
 * PURE module — zero I/O, zero throws (fail-safe to "none").
 *
 * Implements the 12-target per-phase learning checkpoint classifier described in:
 *   skills/meta/learning-checkpoint/SKILL.md
 *
 * The contract table lives in (archived):
 *   .guild/initiatives/archived/drift-remediation/contracts/learning-checkpoint.v1.md §2
 * (the active pointer in SKILL.md §13 is dangling — bind to the archived path above)
 *
 * Terminal verdict forms per target (from contract §2):
 *   memory          : "candidate:<ref>"
 *   wiki            : "candidate:<ref>"
 *   knowledge_graph : "refresh:<classifier-state>"
 *   domain_model    : "re-derive"
 *   agent_def       : "proposal:<agent>"
 *   skill_def       : "proposal:<skill>"
 *   agent_template  : "systemic-proposal"   (via classifyProposal)
 *   skill_template  : "systemic-proposal"   (via classifyProposal)
 *   config          : "proposal:<key>"
 *   task_tracking   : "update:<work-item>"
 *   workflow_rules  : "proposal:<rule>"
 *   review_policy   : "proposal:<gate>"
 *
 * Conservative rule: each target stays "none" UNLESS its deterministic
 * signature fired this phase. Absence => "none". The all-"none" result is
 * the common case.
 *
 * Targets 7-8 (agent_template / skill_template) REUSE classifyProposal from
 * scripts/classify-proposal.ts. Systemic = classifyProposal returned "systemic".
 *
 * Exported API (for eval-engineer fixture tests):
 *   - 12 named predicates (classifyMemory, classifyWiki, ...)
 *   - classifyPhase(artifacts) → Record<12 targets, verdict>
 *
 * ArtifactSet is the SOLE input — the caller assembles it from already-written
 * phase artifacts; this module never reads the filesystem.
 */

import {
  classifyProposal,
  type ClassifyProposalInput,
} from "../classify-proposal";

// ── ArtifactSet ──────────────────────────────────────────────────────────────

/**
 * The already-written phase artifacts the caller assembles and passes in.
 * Every field is optional — absent => not provided => "none" for any target
 * that depends on it. This is the ONLY I/O boundary: the caller reads disk,
 * this module is pure.
 */
export interface ArtifactSet {
  /**
   * The run id (e.g. "run-abc123"). Used in verdict forms that reference it.
   */
  runId: string;

  /**
   * All text from handoff receipts for this phase (guild.handoff.v2 JSON
   * blocks already parsed or raw receipt markdown). Used for learning
   * extraction across multiple targets.
   */
  handoffTexts?: string[];

  /**
   * Structured handoff v2 blocks parsed from receipts. Used for learnings[],
   * followups:, and status fields.
   */
  handoffBlocks?: HandoffV2Block[];

  /**
   * The run's provenance.json `touched` block. Used for:
   *   - touched.decisions → memory/wiki candidates, review_policy, workflow_rules
   *   - touched.runs → task_tracking
   *   - touched.initiatives → knowledge_graph
   *   - touched.wiki → wiki candidates
   *   - touched.files → domain_model, knowledge_graph, config
   */
  provenanceTouched?: ProvenanceTouched;

  /**
   * Path of the primary evidence artifact for this phase (e.g. .guild/spec/<slug>.md).
   * Used as the <ref> in candidate verdicts when no more specific ref is available.
   */
  evidenceRef?: string;

  /**
   * Set of file paths changed during this phase. Used to detect graph, domain,
   * and config surface changes.
   */
  changedFiles?: string[];

  /**
   * For agent_template / skill_template: the classify-proposal inputs collected
   * during this phase (e.g. from the per-instance evolve queue). Absent => no
   * systemic threshold reached => "none".
   */
  classifyProposalInput?: ClassifyProposalInput;

  /**
   * Phase label (from the 7-phase enum). Used for tagging verdict forms.
   */
  phase?: string;

  /**
   * Short fact strings already written in the review/receipt. Passed through
   * to observed[] by the caller (not used by classifiers but available for
   * future cross-target enrichment).
   */
  observed?: string[];
}

/** Parsed guild.handoff.v2 block. */
export interface HandoffV2Block {
  schema_version?: string;
  task_id?: string;
  status?: string;
  summary?: string;
  learnings?: string[];
  followups?: string[];
  issues?: string[];
  artifacts?: string[];
  assumptions?: string;
  notes?: string;
}

/** The `touched` sub-object from provenance.json (guild.provenance.v1). */
export interface ProvenanceTouched {
  tasks?: string[];
  agents?: string[];
  skills?: string[];
  decisions?: string[];
  features?: string[];
  files?: string[];
  runs?: string[];
  wiki?: string[];
  initiatives?: string[];
  config_keys?: string[];
}

// ── Verdict type ─────────────────────────────────────────────────────────────

export type Verdict = string; // "none" or a terminal verdict form

/**
 * The 12-key decision map. All 12 keys are always present.
 * Mirrors CheckpointDecisions from emit-learning-checkpoint.ts.
 */
export interface PhaseVerdict {
  memory: Verdict;
  wiki: Verdict;
  knowledge_graph: Verdict;
  domain_model: Verdict;
  agent_def: Verdict;
  skill_def: Verdict;
  agent_template: Verdict;
  skill_template: Verdict;
  config: Verdict;
  task_tracking: Verdict;
  workflow_rules: Verdict;
  review_policy: Verdict;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Collect all learnings strings across all handoff blocks. */
function allLearnings(artifacts: ArtifactSet): string[] {
  const out: string[] = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const l of block.learnings ?? []) {
      if (l) out.push(l);
    }
  }
  return out;
}

/** Collect all followups strings across all handoff blocks. */
function allFollowups(artifacts: ArtifactSet): string[] {
  const out: string[] = [];
  for (const block of artifacts.handoffBlocks ?? []) {
    for (const f of block.followups ?? []) {
      if (f) out.push(f);
    }
  }
  return out;
}

/** Ref to use in candidate verdicts: first touched.wiki entry, then evidenceRef, then runId. */
function bestRef(artifacts: ArtifactSet): string {
  const wiki = artifacts.provenanceTouched?.wiki ?? [];
  if (wiki.length > 0) return wiki[0]!;
  return artifacts.evidenceRef ?? artifacts.runId;
}

/**
 * True if any of the changed/touched files match a graph-index path.
 * Checks both changedFiles and provenance touched.files.
 */
function filesInclude(artifacts: ArtifactSet, patterns: RegExp[]): boolean {
  const files = [
    ...(artifacts.changedFiles ?? []),
    ...(artifacts.provenanceTouched?.files ?? []),
  ];
  return files.some((f) => patterns.some((p) => p.test(f)));
}

/**
 * True if any handoff block learnings/notes/summary reference a skill name
 * or if followups mention a skill improvement.
 */
function learningsReferenceSkill(artifacts: ArtifactSet): string | null {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    // Conservative: detect explicit skill reference patterns
    const match = text.match(/\b(?:skill[:\s]+|guild:)([\w:-]+)/i);
    if (match) return match[1] ?? "unknown-skill";
    // Also detect "skill improvement" or "skill gap" phrasing
    if (/skill[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-skill";
    }
  }
  return null;
}

/**
 * True if any handoff block learnings/notes/summary reference an agent name.
 */
function learningsReferenceAgent(artifacts: ArtifactSet): string | null {
  const learnings = allLearnings(artifacts);
  const followups = allFollowups(artifacts);
  const all = [...learnings, ...followups];
  for (const text of all) {
    const match = text.match(/\b(?:agent[:\s]+|guild:)([\w:-]+(?:engineer|writer|author|architect|specialist|reviewer|planner|developer|auditor))/i);
    if (match) return match[1] ?? "unknown-agent";
    if (/agent[\s_-](?:improvement|gap|defect|change|update|refactor)/i.test(text)) {
      return "unknown-agent";
    }
  }
  return null;
}

// ── 12 named predicate functions ─────────────────────────────────────────────

/**
 * TARGET 1: memory
 *
 * Contract §2 row 1: a guild:decisions / wiki-ingest memory-class candidate
 * artifact was emitted this phase. The ONLY deterministic signal is
 * provenance.touched.decisions being non-empty — meaning a decision capture
 * was written to .guild/wiki/decisions/ this phase.
 *
 * The broad free-text keyword fallback (always/never/must/should/pattern/…)
 * is intentionally excluded: it fires on arbitrary prose and violates the
 * contract's "deterministic signal" rule. Absence ⇒ "none".
 *
 * Verdict form: "candidate:<ref>"
 */
export function classifyMemory(artifacts: ArtifactSet): Verdict {
  try {
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.length > 0) {
      const ref = decisions[0]!;
      return `candidate:${ref}`;
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 2: wiki
 *
 * Signature: provenance.touched.wiki is non-empty (a wiki page was explicitly
 * touched/proposed this phase), OR handoff followups reference wiki-ingest or
 * a decision capture that would produce a new wiki page.
 *
 * Verdict form: "candidate:<ref>"
 */
export function classifyWiki(artifacts: ArtifactSet): Verdict {
  try {
    const wikiTouched = artifacts.provenanceTouched?.wiki ?? [];
    if (wikiTouched.length > 0) {
      return `candidate:${wikiTouched[0]!}`;
    }
    // Secondary: followups reference wiki-ingest or decisions
    const followups = allFollowups(artifacts);
    if (
      followups.some((f) =>
        /\b(?:wiki[\s_-]?ingest|wiki[\s_-]?page|decisions?[\s_-]?capture|guild:decisions|guild:wiki)/i.test(f)
      )
    ) {
      return `candidate:${bestRef(artifacts)}`;
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 3: knowledge_graph
 *
 * Contract §2 row 3: fires when changed-files set ∩ an indexed path
 * (file/function/concept added/removed/renamed). The classifier state
 * is derived from whether provenance.touched.initiatives is non-empty
 * (a new initiative touched the graph) or whether known index-feeding
 * paths appear in changedFiles.
 *
 * Verdict form: "refresh:<classifier-state>"   (contract :63)
 */
export function classifyKnowledgeGraph(artifacts: ArtifactSet): Verdict {
  try {
    const initiatives = artifacts.provenanceTouched?.initiatives ?? [];
    if (initiatives.length > 0) {
      return "refresh:initiative-touched";
    }
    // Stale index: any change to a source that the builder reads
    if (
      filesInclude(artifacts, [
        /\.guild\/wiki\//,
        /\.guild\/raw\/sources\//,
        /\.guild\/initiatives\//,
        /\.guild\/reflections\//,
        /\.guild\/evolve\//,
        /\.guild\/indexes\/harvest-/,
      ])
    ) {
      return "refresh:stale";
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 4: domain_model
 *
 * Contract §2 row 4: fires ONLY when brownfield stage-4/5 domain/component
 * output for a touched path DIFFERS from the persisted label. That comparison
 * data lives outside the ArtifactSet at classify time, so if it is absent the
 * predicate returns "none" (conservative: absence ⇒ none).
 *
 * We look for a single explicit signal: provenanceTouched.files contains an
 * entry under .guild/indexes/domain-graph.json, signalling that the persisted
 * domain label was actually compared and found to differ this phase. Any
 * broader "source file changed" heuristic is intentionally excluded — that
 * fires too eagerly and violates the contract's deterministic-signal rule.
 *
 * Verdict form: "re-derive"   (contract :64)
 */
export function classifyDomainModel(artifacts: ArtifactSet): Verdict {
  try {
    // The only contract-compliant signal: the domain-graph index itself was
    // touched this phase (meaning a comparison ran and found drift).
    if (
      filesInclude(artifacts, [
        /\.guild\/indexes\/domain-graph\.json/,
      ])
    ) {
      return "re-derive";
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 5: agent_def
 *
 * Signature: handoff learnings or followups propose a per-instance agent change
 * (not systemic — that's agent_template). A "proposal" naming an agent definition.
 *
 * Verdict form: "proposal:<agent>"
 */
export function classifyAgentDef(artifacts: ArtifactSet): Verdict {
  try {
    // Only emit if NOT already caught by agent_template (systemic)
    // We check agent_template here defensively — but callers should wire both
    const agentRef = learningsReferenceAgent(artifacts);
    if (agentRef !== null) {
      return `proposal:${agentRef}`;
    }
    // Also detect explicit proposal tokens in handoff text
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([a-z][\w:-]+)/i);
      if (match && /agent/i.test(match[1] ?? "")) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 6: skill_def
 *
 * Signature: handoff learnings or followups propose a per-instance skill change.
 *
 * Verdict form: "proposal:<skill>"
 */
export function classifySkillDef(artifacts: ArtifactSet): Verdict {
  try {
    const skillRef = learningsReferenceSkill(artifacts);
    if (skillRef !== null) {
      return `proposal:${skillRef}`;
    }
    // Detect explicit proposal tokens
    const all = [...allLearnings(artifacts), ...allFollowups(artifacts)];
    for (const text of all) {
      const match = text.match(/proposal:([\w:-]+)/i);
      if (match && /skill/i.test(text)) {
        return `proposal:${match[1]}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 7: agent_template
 *
 * Signature: classifyProposal returned "systemic" for target="agent".
 * REUSES classify-proposal.ts (IFACE-CLASSIFIER-1).
 * A single-instance proposal → agent_def, never agent_template.
 *
 * Verdict form: "systemic-proposal"
 */
export function classifyAgentTemplate(artifacts: ArtifactSet): Verdict {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "agent" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 8: skill_template
 *
 * Signature: classifyProposal returned "systemic" for target="skill".
 * REUSES classify-proposal.ts (IFACE-CLASSIFIER-1).
 * A single-instance proposal → skill_def, never skill_template.
 *
 * Verdict form: "systemic-proposal"
 */
export function classifySkillTemplate(artifacts: ArtifactSet): Verdict {
  try {
    const input = artifacts.classifyProposalInput;
    if (!input) return "none";
    const result = classifyProposal({ ...input, target: "skill" });
    return result.verdict === "systemic" ? "systemic-proposal" : "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 9: config
 *
 * Signature: provenance.touched.config_keys is non-empty (a config key was
 * explicitly changed this phase), OR changedFiles include settings files
 * (.guild/settings.json, .claude-plugin/*, guild.json, etc.).
 *
 * Verdict form: "proposal:<key>"
 */
export function classifyConfig(artifacts: ArtifactSet): Verdict {
  try {
    const configKeys = artifacts.provenanceTouched?.config_keys ?? [];
    if (configKeys.length > 0) {
      return `proposal:${configKeys[0]!}`;
    }
    // Detect settings file changes
    const settingsFiles = [
      ...(artifacts.changedFiles ?? []),
      ...(artifacts.provenanceTouched?.files ?? []),
    ].filter((f) =>
      /(?:settings\.json|settings\.local\.json|\.claude-plugin\/|guild\.json|\.guild\/settings|guildstack\.pen)/i.test(f),
    );
    if (settingsFiles.length > 0) {
      // Extract the config key from the path if possible
      const f = settingsFiles[0]!;
      const keyMatch = f.match(/([^/]+)\.json$/);
      return `proposal:${keyMatch ? keyMatch[1] : "settings"}`;
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 10: task_tracking
 *
 * Signature: provenance.touched.tasks is non-empty AND handoff status is done/shipped
 * (a task work item needs its tracking updated to reflect completion).
 * Also: provenance.touched.runs is non-empty AND a lane produced a handoff
 * with status "done" — new work item references exist.
 *
 * Verdict form: "update:<work-item>" where work-item is the first task id.
 */
export function classifyTaskTracking(artifacts: ArtifactSet): Verdict {
  try {
    const tasks = artifacts.provenanceTouched?.tasks ?? [];
    if (tasks.length > 0) {
      // Verify at least one handoff is done
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped",
      );
      if (anyDone || artifacts.handoffBlocks === undefined) {
        return `update:${tasks[0]!}`;
      }
    }
    // Secondary: runs references new sub-runs that completed tasks
    const runs = artifacts.provenanceTouched?.runs ?? [];
    if (runs.length > 0) {
      const anyDone = (artifacts.handoffBlocks ?? []).some(
        (b) => b.status === "done" || b.status === "shipped",
      );
      if (anyDone) {
        return `update:run:${runs[0]!}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 11: workflow_rules
 *
 * Contract §2 row 11: fires ONLY when an explicit workflow exception/override
 * was logged this phase — a gate was skipped/forced, or a phase-order deviation
 * was recorded. This must be an explicit, structured signal, NOT broad process
 * prose or any AGENTS.md/CLAUDE.md doc touch.
 *
 * The broad-prose fallback (always/never/must/convention/…) and the any-doc-
 * touch fallback (AGENTS.md, workflow*.md) are intentionally excluded — those
 * fire on normal narration and violate the contract's deterministic-signal rule.
 *
 * Deterministic signals (contract-compliant):
 *   - provenanceTouched.decisions contains an entry whose path signals a
 *     workflow exception (e.g. "workflow-exception:*", "gate-skip:*",
 *     "phase-override:*").
 *   - A handoff block's issues[] contains an explicit gate-skip or
 *     phase-order-deviation token.
 *
 * Verdict form: "proposal:<rule>"
 */
export function classifyWorkflowRules(artifacts: ArtifactSet): Verdict {
  try {
    // Signal A: explicit workflow-exception decision captured in provenance
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    for (const d of decisions) {
      if (/^(?:workflow[\s_-]exception|gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)/i.test(d)) {
        return `proposal:${d}`;
      }
    }
    // Signal B: handoff issue explicitly records a gate skip or phase deviation
    const issues = (artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []);
    for (const text of issues) {
      if (/\b(?:gate[\s_-]skip(?:ped)?|phase[\s_-]order[\s_-]deviation|workflow[\s_-]override|force[\s_-]gate|gate[\s_-]force[d]?)\b/i.test(text)) {
        const ruleMatch = text.match(/(?:gate[\s_-]skip|phase[\s_-]override|workflow[\s_-]override)[:\s]+([\w-]+)/i);
        return `proposal:${ruleMatch ? ruleMatch[1] : "workflow-exception"}`;
      }
    }
    return "none";
  } catch {
    return "none";
  }
}

/**
 * TARGET 12: review_policy
 *
 * Signature: a review gate was BLOCKED or overridden with accepted risk this
 * phase (recorded in handoff issues or notes as a BLOCK/override), OR
 * the phase was quality/operations and a gate policy needs updating.
 *
 * Verdict form: "proposal:<gate>"
 */
export function classifyReviewPolicy(artifacts: ArtifactSet): Verdict {
  try {
    const all = [
      ...allLearnings(artifacts),
      ...allFollowups(artifacts),
      ...(artifacts.handoffBlocks ?? []).flatMap((b) => b.issues ?? []),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.notes ?? ""),
      ...(artifacts.handoffBlocks ?? []).map((b) => b.summary ?? ""),
    ];
    for (const text of all) {
      // BLOCK pattern: a gate was blocked then overridden with accepted risk
      if (/\b(?:BLOCK|block[\s_-]override|owner[\s_-]accepted[\s_-]risk|gate[\s_-]override|releasegate|review[\s_-]gate[\s_-]fail)\b/.test(text)) {
        const gateMatch = text.match(/(?:G[-_]?(\w+)|gate[\s:]+([\w-]+)|releasegate)/i);
        const gate = gateMatch
          ? gateMatch[1] ?? gateMatch[2] ?? "releasegate"
          : "releasegate";
        return `proposal:${gate}`;
      }
      // Codex gate SATISFIED — no policy change needed, but "rounds exceeded" IS a policy signal
      if (/\bcap[\s_-]exceeded\b|rounds[\s_-]cap[\s_-]hit\b|codex[\s_-]cap\b/i.test(text)) {
        return "proposal:codex-cap";
      }
    }
    // Decisions that touch review policy surface
    const decisions = artifacts.provenanceTouched?.decisions ?? [];
    if (decisions.some((d) => /review[\s_-]?policy|gate[\s_-]?policy/i.test(d))) {
      return `proposal:${decisions.find((d) => /review|gate/i.test(d))!}`;
    }
    return "none";
  } catch {
    return "none";
  }
}

// ── classifyPhase (the aggregate entry point) ─────────────────────────────────

/**
 * Classify all 12 targets in one call.
 *
 * Returns a PhaseVerdict with all 12 keys. The all-"none" result is the
 * common case (conservative). Never throws — any predicate exception
 * fails-safe to "none" for that target.
 *
 * @param artifacts - the already-written phase artifacts assembled by the caller.
 * @returns PhaseVerdict - all 12 targets with their terminal verdict strings.
 */
export function classifyPhase(artifacts: ArtifactSet): PhaseVerdict {
  return {
    memory: classifyMemory(artifacts),
    wiki: classifyWiki(artifacts),
    knowledge_graph: classifyKnowledgeGraph(artifacts),
    domain_model: classifyDomainModel(artifacts),
    agent_def: classifyAgentDef(artifacts),
    skill_def: classifySkillDef(artifacts),
    agent_template: classifyAgentTemplate(artifacts),
    skill_template: classifySkillTemplate(artifacts),
    config: classifyConfig(artifacts),
    task_tracking: classifyTaskTracking(artifacts),
    workflow_rules: classifyWorkflowRules(artifacts),
    review_policy: classifyReviewPolicy(artifacts),
  };
}
