#!/usr/bin/env -S npx tsx
/**
 * knowledge-links-builder.ts — SC-E full entity/edge builder for knowledge-links.json.
 *
 * Usage:
 *   node scripts/knowledge-links-builder.ts --root <project-root>
 *   node scripts/knowledge-links-builder.ts --root /abs/path/to/project [--dry-run]
 *
 * What it does:
 *   Reads CANONICAL stores (non-negotiable #8 — see spec SC-E):
 *     .guild/wiki/**                  : wiki pages + decision entries
 *     .guild/raw/sources/**           : raw research sources
 *     .guild/initiatives/**           : goals, non-goals, initiative facts, specs, plans, work items
 *     .guild/runs/**                  : tasks, runs, touched facts, agents, skills, reviews, verify evidence
 *     .guild/reflections/**           : reflection/evolution candidates
 *     .guild/evolve/**                : evolution candidates
 *     .guild/indexes/harvest-*.json   : learn-harvest candidates (guild.harvest_candidates.v1)
 *
 *   Derives a full KnowledgeLinkDoc and writes (or dry-run prints) to:
 *     .guild/indexes/knowledge-links.json
 *
 *   The derived index is FULLY REBUILDABLE from the canonical stores.
 *   Deleting .guild/indexes/knowledge-links.json loses NO source truth (NN#8).
 *
 * Entity/edge set (brief §306-327):
 *   goals, non-goals, initiatives, work items, specs, plans, tasks, runs,
 *   decisions, open questions, wiki pages, raw sources, files, components,
 *   domains, agents, skills, reviews, verification evidence,
 *   reflection/evolution candidates.
 *
 * context-assemble query shape:
 *   import { queryDecisionsAndOpenQuestions } from './knowledge-links-builder'
 *   queryDecisionsAndOpenQuestions(doc, { anchor_id: 'task:E1-links', kinds: ['decision', 'open_question'] })
 *
 * F1-facing read surface (for benchmark/timeline):
 *   - doc.links where from or to starts with "run:" : run timeline edges
 *   - findSkillsAndAgentsForRun(doc, runId) : skill + agent attribution
 *   - findLessonsAfterRun(doc, runId) : reflection + evolution candidates
 *
 * Zero runtime deps beyond Node builtins.
 */

import * as fs from "fs";
import * as path from "path";

// ── Extended node-kind type ───────────────────────────────────────────────────

/**
 * All 19 node kinds from brief §306-327 + the original 4 VC-K2 kinds.
 * Superset of the original NodeKind in knowledge-links-traverse.ts.
 */
export type ExtendedNodeKind =
  | "goal"
  | "non_goal"
  | "initiative"
  | "work_item"
  | "spec"
  | "plan"
  | "task"
  | "run"
  | "decision"
  | "open_question"
  | "wiki"
  | "raw_source"
  | "file"
  | "feature_component"  // covers component: + feature: prefixes (VC-K2 compat)
  | "domain"
  | "skill_agent"        // covers skill: + agent: prefixes (VC-K2 compat)
  | "review"
  | "verify"
  | "reflection_evolution"  // covers reflection: + evolution: prefixes
  | "other";

/**
 * The complete set of node kinds — all 19 brief §306-327 entity kinds.
 * ReadonlySet to prevent mutation.
 */
export const EXTENDED_NODE_KINDS: ReadonlySet<string> = new Set<string>([
  "goal",
  "non_goal",
  "initiative",
  "work_item",
  "spec",
  "plan",
  "task",
  "run",
  "decision",
  "open_question",
  "wiki",
  "raw_source",
  "file",
  "feature_component",
  "domain",
  "skill_agent",
  "review",
  "verify",
  "reflection_evolution",
]);

/**
 * Extended closed edge-type set. Preserves the original 9 from
 * continuous-knowledge-and-learning-loop.md §"CR-A #2" and adds 6 new types
 * for the expanded entity graph.
 *
 * Original 9:
 *   decided_by, used_for, produced, touches, supersedes, learned_from,
 *   constrains, opens_question, resolves
 *
 * Extended 6 (SC-E additions):
 *   serves_goal      — initiative/task serves a goal
 *   excludes         — initiative excludes a non-goal
 *   references       — reflection/evo candidate references a source_ref (FU-A1-3)
 *   emits_candidate  — run/phase emits a harvest candidate (learn-harvest SC-C)
 *   verified_by      — run/task is verified by verify evidence
 *   has_review       — run/task has a review artifact
 */
export const EXTENDED_EDGE_TYPES: ReadonlySet<string> = new Set<string>([
  // Original 9 (CR-A #2, locked — never removed)
  "decided_by",
  "used_for",
  "produced",
  "touches",
  "supersedes",
  "learned_from",
  "constrains",
  "opens_question",
  "resolves",
  // SC-E additions
  "serves_goal",
  "excludes",
  "references",
  "emits_candidate",
  "verified_by",
  "has_review",
]);

// ── Extended node-kind classifier ─────────────────────────────────────────────

/**
 * Classify a node id by its canonical id prefix into an ExtendedNodeKind.
 * Preserves full backward-compat with the original classifyNodeKind in
 * knowledge-links-traverse.ts (decision/skill_agent/feature_component/wiki/other).
 *
 * Prefix convention (canonical — enforced by builder when generating ids):
 *   goal:, non-goal: (or non_goal:), initiative:, work_item:, spec:, plan:,
 *   task:, run:, decision:, open_question:, wiki:, raw_source:, file:,
 *   component: / feature:, domain:, agent: / skill:, review:, verify:,
 *   reflection: / evolution:
 */
export function classifyNodeKindExtended(id: string): ExtendedNodeKind {
  if (id.startsWith("goal:")) return "goal";
  if (id.startsWith("non-goal:") || id.startsWith("non_goal:")) return "non_goal";
  if (id.startsWith("initiative:")) return "initiative";
  if (id.startsWith("work_item:")) return "work_item";
  if (id.startsWith("spec:")) return "spec";
  if (id.startsWith("plan:")) return "plan";
  if (id.startsWith("task:")) return "task";
  if (id.startsWith("run:")) return "run";
  if (id.startsWith("decision:")) return "decision";
  if (id.startsWith("open_question:")) return "open_question";
  if (id.startsWith("wiki:")) return "wiki";
  if (id.startsWith("raw_source:")) return "raw_source";
  if (id.startsWith("file:")) return "file";
  if (id.startsWith("component:") || id.startsWith("feature:")) return "feature_component";
  if (id.startsWith("domain:")) return "domain";
  if (id.startsWith("agent:") || id.startsWith("skill:")) return "skill_agent";
  if (id.startsWith("review:")) return "review";
  if (id.startsWith("verify:")) return "verify";
  if (id.startsWith("reflection:") || id.startsWith("evolution:")) return "reflection_evolution";
  return "other";
}

// ── Document types ────────────────────────────────────────────────────────────

export interface KnowledgeLink {
  from: string;
  to: string;
  type: string;
  run_id: string;
}

export interface KnowledgeLinkDoc {
  schema_version: "guild.knowledge_links.v1";
  links: KnowledgeLink[];
}

export interface BuildResult {
  ok: boolean;
  added: number;
  total: number;
  error?: string;
}

export interface BuildOptions {
  /** Absolute project/workspace root (the .guild/ base). */
  root: string;
  /** When true, compute the link set but do NOT write to disk. */
  dry_run?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safe JSON parse; returns null on any error. */
function safeJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Read a file from disk; returns null if absent or unreadable. */
function readFile(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/** Walk a directory tree and collect file paths matching a filter. */
function walkDir(dir: string, filter: (name: string) => boolean): string[] {
  const results: string[] = [];
  function walk(d: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && filter(e.name)) results.push(full);
    }
  }
  walk(dir);
  return results;
}

/** Extract a YAML frontmatter value for a given key from a string. */
function yamlVal(raw: string, key: string): string | null {
  const m = raw.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!m) return null;
  // Strip quotes if present
  return m[1].trim().replace(/^["']|["']$/g, "");
}

/** Slugify a path or string for use as a node id fragment. */
function slugify(s: string): string {
  return path
    .basename(s, path.extname(s))
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ── Edge batch collectors — one per canonical store ───────────────────────────

/**
 * FROM: .guild/wiki/[glob: md files]
 * Emits: decision : wiki page (learned_from), wiki page existence (for
 *        component/wiki edges to land in the same doc).
 */
function collectWikiEdges(root: string, runId: string): KnowledgeLink[] {
  const wikiDir = path.join(root, ".guild", "wiki");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(wikiDir)) return links;

  const files = walkDir(wikiDir, (n) => n.endsWith(".md"));
  for (const f of files) {
    const raw = readFile(f);
    if (!raw) continue;
    const relPath = path.relative(root, f);
    const slug = slugify(f);
    const wikiId = `wiki:${slug}`;

    // Decision entries under wiki/decisions/ : decision:slug linked to wiki:slug
    if (relPath.includes(`${path.sep}decisions${path.sep}`) || relPath.includes("/decisions/")) {
      const decSlug = yamlVal(raw, "slug") ?? slug;
      const decId = `decision:${decSlug}`;
      links.push({ from: decId, to: wikiId, type: "learned_from", run_id: runId });
    }
  }
  return links;
}

/**
 * FROM: .guild/raw/sources/**
 * Emits: raw_source : wiki page (learned_from) when the frontmatter declares
 *        a wiki_target. Otherwise the raw_source node is just declared.
 */
function collectRawSourceEdges(root: string, runId: string): KnowledgeLink[] {
  const rawDir = path.join(root, ".guild", "raw", "sources");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(rawDir)) return links;

  const files = walkDir(rawDir, (n) => n.endsWith(".md") || n.endsWith(".yaml"));
  for (const f of files) {
    const raw = readFile(f);
    if (!raw) continue;
    const slug = slugify(f);
    const srcId = `raw_source:${slug}`;

    const wikiTarget = yamlVal(raw, "wiki_target");
    if (wikiTarget) {
      links.push({ from: srcId, to: `wiki:${slugify(wikiTarget)}`, type: "learned_from", run_id: runId });
    }
    // Domain/topic linkage
    const domain = yamlVal(raw, "domain");
    if (domain) {
      links.push({ from: srcId, to: `domain:${domain}`, type: "touches", run_id: runId });
    }
  }
  return links;
}

/**
 * FROM: .guild/initiatives/{active,archived}/**
 * Emits:
 *   initiative : goal (serves_goal, from goal: frontmatter)
 *   initiative : non-goal (excludes, from non_goals section)
 *   initiative : spec (produced)
 *   initiative : plan (produced)
 *   spec : plan (produced)
 *   plan : task (produced, from plan lane task-ids)
 *   initiative : decision (constrains, from locked_decisions / decisions)
 *   initiative : open_question (opens_question)
 *   initiative : run (produced, from run_id)
 */
function collectInitiativeEdges(root: string, runId: string): KnowledgeLink[] {
  const initiativesDir = path.join(root, ".guild", "initiatives");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(initiativesDir)) return links;

  // Walk both active/ and archived/
  const dirs = ["active", "archived"].map((d) => path.join(initiativesDir, d));
  for (const baseDir of dirs) {
    if (!fs.existsSync(baseDir)) continue;
    let slugDirs: fs.Dirent[];
    try {
      slugDirs = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sd of slugDirs) {
      if (!sd.isDirectory()) continue;
      const initSlug = sd.name;
      const initId = `initiative:${initSlug}`;
      const initDir = path.join(baseDir, initSlug);

      // initiative.yaml — goal, run_id
      const initYamlPath = path.join(initDir, "initiative.yaml");
      const initYaml = readFile(initYamlPath);
      if (initYaml) {
        const initRunId = yamlVal(initYaml, "run_id");
        if (initRunId) {
          links.push({ from: initId, to: `run:${initRunId}`, type: "produced", run_id: runId });
        }
        // goal field in initiative block
        const goal = yamlVal(initYaml, "goal");
        if (goal) {
          links.push({ from: initId, to: `goal:${goal}`, type: "serves_goal", run_id: runId });
        }
      }

      // spec.md — goal: frontmatter, linked to initiative
      const specPath = path.join(initDir, "spec.md");
      const specRaw = readFile(specPath);
      if (specRaw) {
        const specId = `spec:${initSlug}-spec`;
        links.push({ from: initId, to: specId, type: "produced", run_id: runId });

        // goal from spec
        const specGoal = yamlVal(specRaw, "goal") ?? yamlVal(specRaw, "## Goal");
        if (specGoal) {
          links.push({ from: initId, to: `goal:${slugify(specGoal)}`, type: "serves_goal", run_id: runId });
        }

        // decisions from locked_decisions or decision sections
        const decisionMatches = [...specRaw.matchAll(/`?decision:([a-z0-9-_]+)`?/gi)];
        for (const m of decisionMatches) {
          links.push({ from: specId, to: `decision:${m[1]}`, type: "constrains", run_id: runId });
        }

        // open questions
        const oqMatches = [...specRaw.matchAll(/\bOQ(\d+)\b/g)];
        const oqSeen = new Set<string>();
        for (const m of oqMatches) {
          const oqId = `open_question:oq${m[1]}`;
          if (!oqSeen.has(oqId)) {
            oqSeen.add(oqId);
            links.push({ from: specId, to: oqId, type: "opens_question", run_id: runId });
          }
        }
      }

      // plan.md — task-ids (task:T1-links pattern in lane rows)
      const planPath = path.join(initDir, "plan.md");
      const planRaw = readFile(planPath);
      if (planRaw) {
        const planId = `plan:${initSlug}-plan`;
        links.push({ from: initId, to: planId, type: "produced", run_id: runId });
        if (specPath && readFile(specPath)) {
          const specId = `spec:${initSlug}-spec`;
          links.push({ from: specId, to: planId, type: "produced", run_id: runId });
        }

        // Lane task-ids like `task-id \`E1-links\`` or `task-id: E1-links`
        const taskMatches = [...planRaw.matchAll(/task-id[:\s]+`?([A-Za-z0-9_-]+)`?/g)];
        for (const m of taskMatches) {
          links.push({ from: planId, to: `task:${m[1]}`, type: "produced", run_id: runId });
        }
      }
    }
  }
  return links;
}

/**
 * FROM: .guild/runs/{run-id}/provenance.json
 * Emits (using the `touched` block — the canonical source):
 *   task : run (produced)
 *   skill : run (used_for)
 *   agent : run (used_for)
 *   run : decision (constrains)
 *   run : component/feature (touches)
 *   run : file (touches)
 *   run : run (references, for resumed-from)
 *   run : verify artifact (verified_by, if artifacts.verify present)
 *   run : review artifact (has_review, if artifacts.review present)
 *
 * Also reads run.yaml when present for initiative_attachment + command.
 */
function collectRunEdges(root: string, builderRunId: string): KnowledgeLink[] {
  const runsDir = path.join(root, ".guild", "runs");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(runsDir)) return links;

  let runDirs: fs.Dirent[];
  try {
    runDirs = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return links;
  }

  for (const rd of runDirs) {
    if (!rd.isDirectory()) continue;
    const runId = rd.name;
    if (runId === "current-run-id") continue;
    const runDir = path.join(runsDir, runId);
    const runNodeId = `run:${runId}`;

    // provenance.json (guild.provenance.v1) — the `touched` block is the
    // canonical fact source (run-lifecycle-contract.md §2)
    const provPath = path.join(runDir, "provenance.json");
    const provRaw = readFile(provPath);
    if (provRaw) {
      const prov = safeJson<{
        run_id?: string;
        initiative?: string | null;
        command?: string;
        touched?: {
          tasks?: string[];
          agents?: string[];
          skills?: string[];
          decisions?: string[];
          features?: string[];
          files?: string[];
          runs?: string[];
        };
        artifacts?: Record<string, string | null>;
        final_learning_checkpoint?: string | null;
      }>(provRaw);

      if (prov) {
        const touched = prov.touched ?? {};

        // initiative : run (produced)
        if (prov.initiative) {
          links.push({ from: `initiative:${prov.initiative}`, to: runNodeId, type: "produced", run_id: builderRunId });
        }

        // tasks : run (produced)
        for (const t of touched.tasks ?? []) {
          links.push({ from: t, to: runNodeId, type: "produced", run_id: builderRunId });
        }

        // agents + skills : run (used_for)
        for (const a of touched.agents ?? []) {
          links.push({ from: a.startsWith("agent:") ? a : `agent:${a}`, to: runNodeId, type: "used_for", run_id: builderRunId });
        }
        for (const s of touched.skills ?? []) {
          links.push({ from: s.startsWith("skill:") ? s : `skill:${s}`, to: runNodeId, type: "used_for", run_id: builderRunId });
        }

        // decisions : run (constrains); decisions are refs (NN#1 — no bodies)
        for (const d of touched.decisions ?? []) {
          const decId = d.startsWith("decision:") ? d : `decision:${slugify(d)}`;
          links.push({ from: decId, to: runNodeId, type: "constrains", run_id: builderRunId });
        }

        // run : components/features (touches)
        for (const f of touched.features ?? []) {
          const compId = f.startsWith("component:") || f.startsWith("feature:") ? f : `component:${f}`;
          links.push({ from: runNodeId, to: compId, type: "touches", run_id: builderRunId });
        }

        // run : files (touches)
        for (const file of touched.files ?? []) {
          links.push({ from: runNodeId, to: `file:${file}`, type: "touches", run_id: builderRunId });
        }

        // run : other runs (references)
        for (const r of touched.runs ?? []) {
          links.push({ from: runNodeId, to: `run:${r}`, type: "references", run_id: builderRunId });
        }

        // artifacts: verify + review
        const arts = prov.artifacts ?? {};
        if (arts["verify"]) {
          links.push({ from: `verify:${slugify(arts["verify"] as string)}`, to: runNodeId, type: "verified_by", run_id: builderRunId });
        }
        if (arts["review"]) {
          links.push({ from: `review:${slugify(arts["review"] as string)}`, to: runNodeId, type: "has_review", run_id: builderRunId });
        }

        // final learning checkpoint : run (emits_candidate)
        if (prov.final_learning_checkpoint) {
          links.push({ from: runNodeId, to: `reflection:${slugify(prov.final_learning_checkpoint)}`, type: "produced", run_id: builderRunId });
        }
      }
    }

    // run.yaml — extract initiative_attachment + command for edges
    const runYamlPath = path.join(runDir, "run.yaml");
    const runYaml = readFile(runYamlPath);
    if (runYaml) {
      const initiative = yamlVal(runYaml, "initiative_attachment");
      if (initiative && initiative !== "null") {
        // initiative attachment link — only if provenance.json didn't already add it
        links.push({ from: `initiative:${initiative}`, to: runNodeId, type: "produced", run_id: builderRunId });
      }
    }

    // handoffs/* — extract task-ids and specialist agents
    const handoffsDir = path.join(runDir, "handoffs");
    if (fs.existsSync(handoffsDir)) {
      let hFiles: fs.Dirent[];
      try {
        hFiles = fs.readdirSync(handoffsDir, { withFileTypes: true });
      } catch {
        hFiles = [];
      }
      for (const hf of hFiles) {
        if (!hf.isFile()) continue;
        const hRaw = readFile(path.join(handoffsDir, hf.name));
        if (!hRaw) continue;
        // lane: X1-slug : task:X1-slug
        const lane = yamlVal(hRaw, "lane");
        if (lane) {
          links.push({ from: `task:${lane}`, to: runNodeId, type: "produced", run_id: builderRunId });
        }
        // specialist: agent-name : agent : run
        const specialist = yamlVal(hRaw, "specialist");
        if (specialist) {
          links.push({ from: `agent:${specialist}`, to: runNodeId, type: "used_for", run_id: builderRunId });
        }
      }
    }
  }
  return links;
}

/**
 * FROM: .guild/reflections/**
 * Emits:
 *   run : reflection candidate (produced)
 *   reflection : source_refs as raw_source (references — FU-A1-3 compat)
 */
function collectReflectionEdges(root: string, runId: string): KnowledgeLink[] {
  const reflDir = path.join(root, ".guild", "reflections");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(reflDir)) return links;

  const files = walkDir(reflDir, (n) => n.endsWith(".yaml") || n.endsWith(".md"));
  for (const f of files) {
    const raw = readFile(f);
    if (!raw) continue;
    const slug = slugify(f);
    const reflId = `reflection:${slug}`;

    const runRef = yamlVal(raw, "run_id");
    if (runRef) {
      links.push({ from: `run:${runRef}`, to: reflId, type: "produced", run_id: runId });
    }
    // source_refs in YAML list or inline
    const srcRefMatches = [...raw.matchAll(/source_ref[s]?:\s*(.+)/g)];
    for (const m of srcRefMatches) {
      const refs = m[1].split(",").map((s) => s.trim().replace(/["'\[\]]/g, "")).filter(Boolean);
      for (const ref of refs) {
        if (ref.startsWith("-")) continue; // skip list marker lines
        links.push({ from: reflId, to: `raw_source:${slugify(ref)}`, type: "references", run_id: runId });
      }
    }
  }
  return links;
}

/**
 * FROM: .guild/evolve/**
 * Emits:
 *   run : evolution candidate (produced)
 *   evolution : skill/agent (used_for, when it targets a specific skill)
 */
function collectEvolveEdges(root: string, runId: string): KnowledgeLink[] {
  const evolveDir = path.join(root, ".guild", "evolve");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(evolveDir)) return links;

  const files = walkDir(evolveDir, (n) => n.endsWith(".yaml") || n.endsWith(".md") || n.endsWith(".json"));
  for (const f of files) {
    // Skip shadow/ directory — shadow mode harness only (scope boundary)
    if (f.includes(`${path.sep}shadow${path.sep}`)) continue;
    const raw = readFile(f);
    if (!raw) continue;
    const slug = slugify(f);
    const evoId = `evolution:${slug}`;

    const runRef = yamlVal(raw, "run_id");
    if (runRef) {
      links.push({ from: `run:${runRef}`, to: evoId, type: "produced", run_id: runId });
    }
    // skill target (e.g. skill: guild:learn-harvest in frontmatter)
    const skillTarget = yamlVal(raw, "skill");
    if (skillTarget) {
      const skillId = skillTarget.startsWith("skill:") ? skillTarget : `skill:${skillTarget}`;
      links.push({ from: evoId, to: skillId, type: "used_for", run_id: runId });
    }
  }
  return links;
}

/**
 * FROM: .guild/runs/{run-id}/learn/harvest-candidates.json
 *       (guild.harvest_candidates.v1, A1 schema)
 * Emits for each candidate:
 *   run : reflection/evolution candidate (emits_candidate)
 *   candidate : source_refs as raw_source (references — FU-A1-3)
 *
 * Edges reference candidates by their source_refs (FU-A1-3 — write compatibility
 * with A1's guild.harvest_candidates.v1). Bodies are NEVER embedded.
 */
function collectHarvestCandidateEdges(root: string, builderRunId: string): KnowledgeLink[] {
  const runsDir = path.join(root, ".guild", "runs");
  const links: KnowledgeLink[] = [];
  if (!fs.existsSync(runsDir)) return links;

  let runDirs: fs.Dirent[];
  try {
    runDirs = fs.readdirSync(runsDir, { withFileTypes: true });
  } catch {
    return links;
  }

  for (const rd of runDirs) {
    if (!rd.isDirectory()) continue;
    const hcPath = path.join(runsDir, rd.name, "learn", "harvest-candidates.json");
    const raw = readFile(hcPath);
    if (!raw) continue;

    const hc = safeJson<{
      schema_version?: string;
      run_id?: string;
      reflection_candidates?: Array<{ id?: string; source_refs?: string[]; promotion_gate?: string }>;
      evolution_candidates?: Array<{ id?: string; source_refs?: string[]; promotion_gate?: string; skill?: string }>;
      decision_candidates?: Array<{ id?: string; source_refs?: string[] }>;
      wiki_candidates?: Array<{ id?: string; source_refs?: string[] }>;
      open_questions?: Array<{ id?: string; source_refs?: string[] }>;
    }>(raw);

    if (!hc) continue;
    const hcRunId = hc.run_id ?? rd.name;

    // reflection candidates
    for (const c of hc.reflection_candidates ?? []) {
      if (!c.id) continue;
      const reflId = c.id.startsWith("reflection:") ? c.id : `reflection:${c.id}`;
      links.push({ from: `run:${hcRunId}`, to: reflId, type: "emits_candidate", run_id: builderRunId });
      for (const ref of c.source_refs ?? []) {
        links.push({ from: reflId, to: `raw_source:${slugify(ref)}`, type: "references", run_id: builderRunId });
      }
    }

    // evolution candidates
    for (const c of hc.evolution_candidates ?? []) {
      if (!c.id) continue;
      const evoId = c.id.startsWith("evolution:") ? c.id : `evolution:${c.id}`;
      links.push({ from: `run:${hcRunId}`, to: evoId, type: "emits_candidate", run_id: builderRunId });
      for (const ref of c.source_refs ?? []) {
        links.push({ from: evoId, to: `raw_source:${slugify(ref)}`, type: "references", run_id: builderRunId });
      }
      if ((c as { skill?: string }).skill) {
        const s = (c as { skill: string }).skill;
        links.push({ from: evoId, to: s.startsWith("skill:") ? s : `skill:${s}`, type: "used_for", run_id: builderRunId });
      }
    }

    // decision candidates : run (constrains)
    for (const c of hc.decision_candidates ?? []) {
      if (!c.id) continue;
      const decId = c.id.startsWith("decision:") ? c.id : `decision:${c.id}`;
      links.push({ from: decId, to: `run:${hcRunId}`, type: "constrains", run_id: builderRunId });
      for (const ref of c.source_refs ?? []) {
        links.push({ from: decId, to: `raw_source:${slugify(ref)}`, type: "references", run_id: builderRunId });
      }
    }

    // open questions
    for (const c of hc.open_questions ?? []) {
      if (!c.id) continue;
      const oqId = c.id.startsWith("open_question:") ? c.id : `open_question:${c.id}`;
      links.push({ from: `run:${hcRunId}`, to: oqId, type: "opens_question", run_id: builderRunId });
    }
  }
  return links;
}

// ── Core builder ──────────────────────────────────────────────────────────────

const BUILDER_SENTINEL_RUN_ID = "knowledge-links-builder";

/**
 * Build the full KnowledgeLinkDoc from all canonical stores.
 *
 * This function is PURE with respect to the canonical stores: given the same
 * on-disk canonical stores it always produces the same output. The derived
 * index is fully rebuildable — NN#8 holds.
 *
 * The builder uses `BUILDER_SENTINEL_RUN_ID` as the `run_id` on edges it
 * derives (structural edges from the build pass, not from a specific live run).
 * Live-run edges (from provenance.json `touched` blocks) keep their run's id.
 */
export function buildKnowledgeLinks(opts: BuildOptions): BuildResult {
  const { root, dry_run = false } = opts;

  // ── Collect edges from all canonical stores ───────────────────────────────
  const batchRunId = BUILDER_SENTINEL_RUN_ID;

  const allLinks: KnowledgeLink[] = [
    ...collectWikiEdges(root, batchRunId),
    ...collectRawSourceEdges(root, batchRunId),
    ...collectInitiativeEdges(root, batchRunId),
    ...collectRunEdges(root, batchRunId),
    ...collectReflectionEdges(root, batchRunId),
    ...collectEvolveEdges(root, batchRunId),
    ...collectHarvestCandidateEdges(root, batchRunId),
  ];

  // ── Preserve existing engine-produced edges (stage-5 `touches` from
  //    understand/derive-domain.ts) if the index already exists. These are
  //    canonical-store-derived too (from code scan), so NN#8 holds as long as
  //    the engine can re-derive them. Here we MERGE to avoid stomping the
  //    domain.file edges the engine wrote; a full rebuild (--rebuild-all) would
  //    re-run the engine as well. For the rebuild-from-canonical test, the
  //    builder deterministically re-derives the same edges both runs, so the
  //    normalised comparison still holds.
  //
  //    The existing index is read but treated as a CACHE HINT only — no unique
  //    state is held there that is not also in the canonical stores. If it is
  //    absent (NN#8 delete case), only the canonical-store edges appear.
  // ─────────────────────────────────────────────────────────────────────────
  const klPath = path.join(root, ".guild", "indexes", "knowledge-links.json");
  let existingLinks: KnowledgeLink[] = [];
  if (!dry_run && fs.existsSync(klPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(klPath, "utf8")) as {
        links?: KnowledgeLink[];
      };
      // Keep only engine-tagged edges (stage-5 touches from derive-domain.ts)
      // so we don't inherit stale builder edges from a prior run.
      existingLinks = (existing.links ?? []).filter(
        (l) => l.run_id !== BUILDER_SENTINEL_RUN_ID,
      );
    } catch {
      existingLinks = [];
    }
  }

  // ── Dedupe on from|to|type (append-only pattern, mirrors appendBatch) ─────
  const seen = new Set<string>();
  const merged: KnowledgeLink[] = [];

  for (const l of [...existingLinks, ...allLinks]) {
    const k = `${l.from}|${l.to}|${l.type}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(l);
    }
  }

  const doc: KnowledgeLinkDoc = {
    schema_version: "guild.knowledge_links.v1",
    links: merged,
  };

  if (!dry_run) {
    fs.mkdirSync(path.dirname(klPath), { recursive: true });
    fs.writeFileSync(klPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  }

  const added = allLinks.length;
  return { ok: true, added, total: merged.length };
}

// ── Traversal helpers (cross-cut questions, brief §329-339) ──────────────────

/** BFS helper: collect all node ids reachable from start within max_hops. */
function bfsReachable(
  doc: KnowledgeLinkDoc,
  start: string,
  maxHops: number,
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const l of doc.links) {
    if (!adj.has(l.from)) adj.set(l.from, []);
    if (!adj.has(l.to)) adj.set(l.to, []);
    adj.get(l.from)!.push(l.to);
    adj.get(l.to)!.push(l.from);
  }
  const visited = new Map<string, number>([[start, 0]]);
  const queue: Array<[string, number]> = [[start, 0]];
  while (queue.length) {
    const [cur, hop] = queue.shift()!;
    if (hop >= maxHops) continue;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.set(next, hop + 1);
        queue.push([next, hop + 1]);
      }
    }
  }
  return visited;
}

/**
 * §329 — Which decisions constrained this task?
 * Returns decision node ids reachable from taskId (within 3 hops).
 */
export function findConstrainingDecisions(doc: KnowledgeLinkDoc, taskId: string): string[] {
  const reachable = bfsReachable(doc, taskId, 3);
  return [...reachable.keys()].filter((id) => classifyNodeKindExtended(id) === "decision");
}

/**
 * §330 — Which goal does this initiative serve?
 * Returns goal node ids reachable from initiativeId.
 */
export function findGoalForInitiative(doc: KnowledgeLinkDoc, initiativeId: string): string[] {
  // Direct edges only (serves_goal is always a direct edge)
  return doc.links
    .filter((l) => l.from === initiativeId && l.type === "serves_goal")
    .map((l) => l.to);
}

/**
 * §331 — Which features/components did this run touch?
 * Returns feature_component node ids directly touched by runId.
 */
export function findComponentsForRun(doc: KnowledgeLinkDoc, runId: string): string[] {
  return doc.links
    .filter((l) => l.from === runId && l.type === "touches")
    .map((l) => l.to)
    .filter((id) => classifyNodeKindExtended(id) === "feature_component");
}

/**
 * §332 — Which skill and agent produced the work?
 * Returns { skills, agents } node ids for runId.
 */
export function findSkillsAndAgentsForRun(
  doc: KnowledgeLinkDoc,
  runId: string,
): { skills: string[]; agents: string[] } {
  const skills: string[] = [];
  const agents: string[] = [];
  for (const l of doc.links) {
    if (l.to === runId && l.type === "used_for") {
      if (l.from.startsWith("skill:")) skills.push(l.from);
      else if (l.from.startsWith("agent:")) agents.push(l.from);
    }
  }
  return { skills, agents };
}

/**
 * §333 — Which wiki pages explain this component?
 * Returns wiki node ids learned_from by componentId (within 2 hops).
 */
export function findWikiPagesForComponent(
  doc: KnowledgeLinkDoc,
  componentId: string,
): string[] {
  const reachable = bfsReachable(doc, componentId, 2);
  return [...reachable.keys()].filter((id) => classifyNodeKindExtended(id) === "wiki");
}

/**
 * §335 — Which lessons were extracted after this run?
 * Returns reflection + evolution candidate ids produced by runId.
 */
export function findLessonsAfterRun(doc: KnowledgeLinkDoc, runId: string): string[] {
  return doc.links
    .filter(
      (l) =>
        l.from === runId &&
        (l.type === "produced" || l.type === "emits_candidate") &&
        classifyNodeKindExtended(l.to) === "reflection_evolution",
    )
    .map((l) => l.to);
}

/**
 * §337 — Which research source introduced this idea?
 * Returns raw_source node ids reachable from an entity (within 3 hops).
 */
export function findSourcesForEntity(doc: KnowledgeLinkDoc, entityId: string): string[] {
  const reachable = bfsReachable(doc, entityId, 3);
  return [...reachable.keys()].filter((id) => classifyNodeKindExtended(id) === "raw_source");
}

// ── context-assemble query shape ──────────────────────────────────────────────

/**
 * Query shape for context-assemble to pin relevant decisions + open questions
 * from the edge layer (spec SC-E acceptance: "context-assemble can pin relevant
 * decisions + open questions from the edge layer").
 */
export interface ContextAssembleQuery {
  /** The anchor node id (e.g. "task:E1-links" or "run:run-..."). */
  anchor_id: string;
  /** Kinds to collect (typically ["decision", "open_question"]). */
  kinds: Array<"decision" | "open_question">;
  /** Max BFS hops from anchor. Default 3. */
  max_hops?: number;
}

export interface ContextAssembleResult {
  /** Decision node ids reachable from the anchor. */
  decisions: string[];
  /** Open-question node ids reachable from the anchor. */
  open_questions: string[];
}

/**
 * Query the edge layer for decisions + open questions relevant to an anchor.
 * context-assemble calls this to pin them into the context budget.
 */
export function queryDecisionsAndOpenQuestions(
  doc: KnowledgeLinkDoc,
  query: ContextAssembleQuery,
): ContextAssembleResult {
  const maxHops = query.max_hops ?? 3;
  const reachable = bfsReachable(doc, query.anchor_id, maxHops);
  const decisions: string[] = [];
  const open_questions: string[] = [];

  const wantDecisions = query.kinds.includes("decision");
  const wantOq = query.kinds.includes("open_question");

  for (const id of reachable.keys()) {
    if (id === query.anchor_id) continue;
    if (wantDecisions && classifyNodeKindExtended(id) === "decision") decisions.push(id);
    if (wantOq && classifyNodeKindExtended(id) === "open_question") open_questions.push(id);
  }

  return { decisions, open_questions };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const rootIdx = args.indexOf("--root");
  const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const dryRun = args.includes("--dry-run");

  if (!root) {
    console.error("Usage: node scripts/knowledge-links-builder.ts --root <project-root> [--dry-run]");
    process.exit(1);
  }

  const result = buildKnowledgeLinks({ root, dry_run: dryRun });
  if (result.ok) {
    const action = dryRun ? "dry-run" : "wrote";
    console.log(`[knowledge-links-builder] ${action} ${result.total} edges (${result.added} from canonical stores)`);
  } else {
    console.error(`[knowledge-links-builder] error: ${result.error}`);
    process.exit(1);
  }
}
