#!/usr/bin/env -S npx tsx
/**
 * scripts/workspace/federated-query.ts
 *
 * Fan-out recall helper for workspace-level queries.
 *
 * Given a query string + a guild.workspace.v1 manifest at <cwd>/.guild/workspace.json,
 * iterates sub_guilds where has_wiki=true and produces a structured plan of per-sub
 * guild-memory invocations (tool=wiki_search, per-sub cwd override) + a merge/tag step.
 *
 * READ-ONLY — never copies pages up into the workspace .guild/ or writes anything
 * into sub-guild .guild/ directories. Outputs a JSON plan to stdout; the skill layer
 * drives execution against the guild-memory MCP.
 *
 * Usage:
 *   npx tsx scripts/workspace/federated-query.ts \
 *     --cwd <workspace-root> \
 *     --query "<query string>" \
 *     [--scope <sub-guild-name>]
 *
 * Options:
 *   --cwd <path>          Workspace root (must have .guild/workspace.json). Default: cwd.
 *   --query <string>      (required) The query to fan out.
 *   --scope <name>        (optional) Restrict fan-out to a single named sub_guild.
 *
 * Stdout: JSON plan:
 *   {
 *     "query": "<query string>",
 *     "steps": [
 *       { "type": "query", "sub_guild": "<name>", "tool": "wiki_search",
 *         "cwd": "<absolute-path-to-sub>", "query": "<query string>" },
 *       ...
 *       { "type": "merge_and_tag",
 *         "description": "merge results from all query steps; tag each hit with sub_guild name" }
 *     ]
 *   }
 *
 * Stderr: warnings (unknown scope, no wikis available).
 * Exit:
 *   0  Success (including zero-wiki case, which emits a warning).
 *   1  Bad input (--query missing, manifest not found).
 *   2  Internal error.
 *
 * Invariant: writes NO files. Read-only recall helper.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

interface SubGuildEntry {
  name: string;
  path: string;
  kind: "sub-guild" | "sub-project";
  remote: string | null;
  has_wiki: boolean;
  has_indexes: boolean;
  last_seen_commit: string | null;
}

interface WorkspaceManifest {
  schema_version: string;
  is_workspace: boolean;
  sub_guilds: SubGuildEntry[];
}

interface QueryStep {
  type: "query";
  sub_guild: string;
  tool: "wiki_search";
  cwd: string;  // absolute path to the sub-guild dir
  query: string;
}

interface MergeStep {
  type: "merge_and_tag";
  description: string;
}

type Step = QueryStep | MergeStep;

interface FanOutPlan {
  query: string;
  steps: Step[];
}

// ── Core fan-out ──────────────────────────────────────────────────────────────

export function federatedQuery(
  root: string,
  query: string,
  scope?: string
): FanOutPlan {
  const manifestPath = path.join(root, ".guild", "workspace.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`workspace.json not found at ${manifestPath}`);
  }

  const manifest: WorkspaceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  // Collect sub_guilds that have wikis
  let candidates = manifest.sub_guilds.filter((sg) => sg.has_wiki);

  // Apply scope filter if requested
  if (scope !== undefined) {
    const named = candidates.find((sg) => sg.name === scope);
    if (!named) {
      process.stderr.write(
        `[workspace/federated-query] WARN: scope "${scope}" not found or has no wiki — 0 query steps\n`
      );
      candidates = [];
    } else {
      candidates = [named];
    }
  }

  if (candidates.length === 0 && scope === undefined) {
    process.stderr.write(
      `[workspace/federated-query] WARN: no sub_guilds with has_wiki=true — 0 query steps\n`
    );
  }

  const steps: Step[] = [];

  for (const sg of candidates) {
    // cwd for guild-memory override: absolute path to the sub-guild directory
    const subAbsPath = path.resolve(root, sg.path);
    steps.push({
      type: "query",
      sub_guild: sg.name,
      tool: "wiki_search",
      cwd: subAbsPath,
      query,
    });
  }

  // Always append a merge/tag step (even for zero-query-step cases, so the skill
  // layer knows what to do with the (empty) results)
  steps.push({
    type: "merge_and_tag",
    description:
      "Merge results from all query steps; tag each result hit with its source " +
      "sub_guild name. Deduplicate by page path if the same page appears via multiple " +
      "guild-memory calls. Present to the user with [sub_guild: <name>] provenance.",
  });

  return { query, steps };
}

// ── CLI entry point ───────────────────────────────────────────────────────────

interface ParsedArgs {
  cwd?: string;
  query?: string;
  scope?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let cwd: string | undefined;
  let query: string | undefined;
  let scope: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg === "--query" && argv[i + 1]) query = argv[++i];
    else if (arg === "--scope" && argv[i + 1]) scope = argv[++i];
  }
  return { cwd, query, scope };
}

function main(): void {
  const { cwd: cwdArg, query, scope } = parseArgs(process.argv.slice(2));
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!query) {
    process.stderr.write(`[workspace/federated-query] ERROR: --query is required\n`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(cwd, ".guild", "workspace.json"))) {
    process.stderr.write(
      `[workspace/federated-query] ERROR: no workspace.json at ${path.join(cwd, ".guild", "workspace.json")}\n`
    );
    process.exit(1);
  }

  try {
    const plan = federatedQuery(cwd, query, scope);
    process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/federated-query] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

main();
