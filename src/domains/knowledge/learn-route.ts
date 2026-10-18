/**
 * learn-route.ts — the deterministic `/guild:learn` router (G10 R1-R2).
 *
 * A pure function: workspace-detect facts + the command's argument tokens in,
 * one closed route out. `commands/learn.md` and the learn skill run it through
 * `runtime/scripts/learn-route.js` and follow the route; the skill's prose
 * describes each route, it does not decide between them.
 *
 * The shapes and routes are the ones the learn skill already documents
 * (§"Detection and confirmation", §"Workflow — Workspace full learn", eval
 * cases). Nothing here adds behaviour; it pins the choice in code.
 */

import type { DetectionResult } from "../state";

export const LEARN_SUB_VERBS = ["map", "graph", "knowledge", "onboard", "diff", "explain"] as const;
export type LearnSubVerb = (typeof LEARN_SUB_VERBS)[number];

/** Each sub-verb loads exactly one chapter of the learn assembler. */
export const LEARN_CHAPTERS: Readonly<Record<LearnSubVerb, string>> = {
  map: "references/learn-map.md",
  graph: "references/learn-graph.md",
  knowledge: "references/learn-knowledge.md",
  onboard: "references/learn-onboard.md",
  diff: "references/learn-diff.md",
  explain: "references/learn-explain.md",
};

export const LEARN_ROUTES = [
  "full_learn",
  "cheap_map_only",
  "workspace_full_learn",
  "workspace_plan_only",
  "confirm_target",
  "chapter",
  "usage",
] as const;
export type LearnRoute = (typeof LEARN_ROUTES)[number];

export type LearnTargetKind =
  | "regular_project"
  | "existing_guild_project"
  | "new_or_sparse_project"
  | "workspace"
  | "mixed_or_uncertain";

/**
 * When the K1-K6 deep knowledge tier runs on this route. `after_oq1_gate`:
 * step 10 runs once the deep-graph cost gate is approved. `deferred`: only an
 * explicit `/guild:learn knowledge` runs it (workspace-root default).
 */
export type LearnKnowledgeTier = "after_oq1_gate" | "deferred" | "not_run";

/** Root facts the CLI reads from disk. The router itself never touches disk. */
export interface LearnTargetFacts {
  detection: Pick<DetectionResult, "kind" | "sub_guilds">;
  has_git: boolean;
  guild_dir: "absent" | "empty" | "populated";
  wiki_populated: boolean;
  tracked_files: number;
}

export interface LearnRouteInput {
  /** The tokens after `/guild:learn`, in order. */
  argv: readonly string[];
  /** Required for the bare case; ignored when a token decides the route. */
  target: LearnTargetFacts | null;
  /** `learn_fanout` from `.guild/workspace.json`. Default "auto". */
  learnFanout?: "auto" | "plan-only";
}

export interface LearnRouteResult {
  schema: "guild.learn_route.v1";
  route: LearnRoute;
  target_kind: LearnTargetKind | null;
  chapter: LearnSubVerb | null;
  chapter_file: string | null;
  knowledge_tier: LearnKnowledgeTier | null;
  /** Tokens the route's chapter or pipeline receives (the sub-verb removed). */
  forward: string[];
  dry_run: boolean;
  cwd_override: string | null;
  /** The token that produced `usage`, else null. */
  token: string | null;
  usage: string | null;
}

export class LearnRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearnRouteError";
  }
}

export const LEARN_USAGE = `usage: /guild:learn [${LEARN_SUB_VERBS.join("|")}] [target] [--rigor=quick|standard|deep]`;

/** `new_or_sparse_project` holds at most this many tracked files. */
export const SPARSE_TRACKED_FILE_LIMIT = 5;

const KNOWLEDGE_TIER: Readonly<Record<Exclude<LearnRoute, "chapter" | "usage" | "confirm_target">, LearnKnowledgeTier>> = {
  full_learn: "after_oq1_gate",
  cheap_map_only: "not_run",
  workspace_full_learn: "deferred",
  workspace_plan_only: "not_run",
};

/** The skill's five-way detection table, in its precedence order. */
export function classifyLearnTarget(facts: LearnTargetFacts): LearnTargetKind {
  if (facts.detection.kind === "workspace") {
    const kinds = new Set(facts.detection.sub_guilds.map((c) => c.kind));
    return kinds.size > 1 ? "mixed_or_uncertain" : "workspace";
  }
  if (facts.guild_dir !== "populated" && facts.tracked_files <= SPARSE_TRACKED_FILE_LIMIT) {
    return "new_or_sparse_project";
  }
  if (facts.guild_dir === "populated" && facts.wiki_populated) return "existing_guild_project";
  if (facts.has_git || facts.guild_dir !== "absent") return "regular_project";
  // Neither .git/ nor .guild/ and not sparse: no documented shape fits, so ask.
  return "mixed_or_uncertain";
}

export function learnRouteFor(
  kind: LearnTargetKind,
  opts: { learnFanout: "auto" | "plan-only"; dryRun: boolean },
): LearnRoute {
  switch (kind) {
    case "regular_project":
    case "existing_guild_project":
      return "full_learn";
    case "new_or_sparse_project":
      return "cheap_map_only";
    case "workspace":
      return opts.dryRun || opts.learnFanout === "plan-only" ? "workspace_plan_only" : "workspace_full_learn";
    case "mixed_or_uncertain":
      return "confirm_target";
  }
}

function isSubVerb(token: string): token is LearnSubVerb {
  return (LEARN_SUB_VERBS as readonly string[]).includes(token);
}

export interface ParsedLearnArgs {
  /** Empty tokens dropped; everything else in order. */
  argv: string[];
  /** Index in `argv` of the first positional token, or -1 when bare. */
  positional: number;
  dry_run: boolean;
  cwd_override: string | null;
}

/** Flags never pick the route; only the first positional token does. */
export function parseLearnArgs(tokens: readonly string[]): ParsedLearnArgs {
  const argv = tokens.filter((t) => t !== "");
  let positional = -1;
  let cwdOverride: string | null = null;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--cwd") {
      if (i + 1 < argv.length) cwdOverride = argv[++i];
      continue;
    }
    if (t.startsWith("--cwd=")) {
      cwdOverride = t.slice("--cwd=".length);
      continue;
    }
    if (t === "--dry-run") dryRun = true;
    if (t.startsWith("-")) continue;
    if (positional === -1) positional = i;
  }
  return { argv, positional, dry_run: dryRun, cwd_override: cwdOverride };
}

export function routeLearn(input: LearnRouteInput): LearnRouteResult {
  const { argv, positional, dry_run: dryRun, cwd_override: cwdOverride } = parseLearnArgs(input.argv);

  const base = {
    schema: "guild.learn_route.v1" as const,
    dry_run: dryRun,
    cwd_override: cwdOverride,
  };

  if (positional !== -1) {
    const token = argv[positional];
    const forward = argv.filter((_, i) => i !== positional);
    if (!isSubVerb(token)) {
      return {
        ...base,
        route: "usage",
        target_kind: null,
        chapter: null,
        chapter_file: null,
        knowledge_tier: null,
        forward,
        token,
        usage: LEARN_USAGE,
      };
    }
    return {
      ...base,
      route: "chapter",
      target_kind: null,
      chapter: token,
      chapter_file: LEARN_CHAPTERS[token],
      knowledge_tier: null,
      forward,
      token: null,
      usage: null,
    };
  }

  if (input.target === null) {
    throw new LearnRouteError("bare /guild:learn needs workspace-detect target facts; refusing to guess the route");
  }
  const kind = classifyLearnTarget(input.target);
  const route = learnRouteFor(kind, { learnFanout: input.learnFanout ?? "auto", dryRun });
  return {
    ...base,
    route,
    target_kind: kind,
    chapter: null,
    chapter_file: null,
    knowledge_tier: route === "confirm_target" ? null : KNOWLEDGE_TIER[route as keyof typeof KNOWLEDGE_TIER],
    forward: [...argv],
    token: null,
    usage: null,
  };
}
