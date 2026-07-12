#!/usr/bin/env -S npx tsx
/**
 * learn/validate-graph.ts — the Tolerant validate/repair ladder
 * (codebase-understanding.md §"Tolerant validate/repair ladder").
 *
 * sanitize → normalize aliases (forked ~80-entry MIT table) → auto-fix
 * defaults → validate & drop invalid items individually. Never discards a
 * salvageable graph; FATAL only on zero valid nodes. Writes the FINAL
 * KnowledgeGraph artifact to .guild/indexes/knowledge-graph.json.
 *
 * Version dispatch (v1/v2 boundary, lib/schema.ts): the input's `version`
 * field decides the validator. `guild.knowledge_graph.v2` inputs route
 * through validateGraphV2 (full invariant ladder, v2 closed node/edge sets
 * incl. the knowledge tier — topic/concept/claim/entity/wiki_page/diagram
 * nodes + knowledge edges). Everything else (v1 or unversioned) routes
 * through the v1 validateGraph, unchanged.
 *
 * Downgrade guard: this CLI NEVER silently overwrites an on-disk
 * `guild.knowledge_graph.v2` graph with a v1-validated result — doing so
 * would silently strip the knowledge tier a prior `learn-knowledge` run
 * produced (e.g. because this CLI's default input, the K1-K5 partial graph,
 * is v1-shaped). A run that would downgrade an on-disk v2 graph refuses
 * (exit 2) unless `--force` is passed to make the downgrade explicit.
 *
 * Usage:
 *   npx tsx validate-graph.ts [--cwd <path>] [--in <path>] [--dry] [--print] [--force]
 *   cat graph.json | npx tsx validate-graph.ts --cwd <path> --stdin
 * Exit: 0 ok (incl. dropped items) · 2 fatal (unrecoverable) ·
 *       2 refused (v2-downgrade-guard tripped, no --force).
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson } from "./lib/paths";
import { validateGraph, validateGraphV2, type ValidationResult } from "./lib/schema";

export const KNOWLEDGE_GRAPH_V2 = "guild.knowledge_graph.v2";

/** True when a raw (pre-validation) graph input declares the v2 version string. */
export function isV2Input(input: unknown): boolean {
  return (
    typeof input === "object" &&
    input !== null &&
    (input as Record<string, unknown>)["version"] === KNOWLEDGE_GRAPH_V2
  );
}

/** True when an already-validated result's data carries the v2 version string. */
export function isV2Result(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as Record<string, unknown>)["version"] === KNOWLEDGE_GRAPH_V2
  );
}

/**
 * Version-dispatching validate entrypoint (extracted for tests). Routes
 * `guild.knowledge_graph.v2` input through validateGraphV2 (repoRoot-anchored
 * anchor resolution); everything else goes through the v1 validateGraph.
 */
export function validateWithDispatch(input: unknown, repoRoot: string): ValidationResult {
  if (isV2Input(input)) {
    return validateGraphV2(input, { repoRoot });
  }
  return validateGraph(input);
}

export interface DowngradeGuardResult {
  /** true = refuse the write (on-disk is v2, result is not, --force absent). */
  refused: boolean;
  onDiskVersion?: string;
}

/**
 * The v2-downgrade guard: refuse to overwrite an on-disk v2 knowledge graph
 * with a non-v2-validated result unless the caller explicitly forces it.
 */
export function checkDowngradeGuard(
  knowledgeGraphPath: string,
  resultData: unknown,
  force: boolean,
): DowngradeGuardResult {
  const existing = readJson<Record<string, unknown>>(knowledgeGraphPath);
  const onDiskVersion = typeof existing?.["version"] === "string" ? (existing["version"] as string) : undefined;
  const onDiskIsV2 = onDiskVersion === KNOWLEDGE_GRAPH_V2;
  const resultIsV2 = isV2Result(resultData);
  if (onDiskIsV2 && !resultIsV2 && !force) {
    return { refused: true, onDiskVersion };
  }
  return { refused: false, onDiskVersion };
}

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);

  let input: unknown;
  if (hasFlag(argv, "stdin")) {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } else {
    const inPath = parseFlag(argv, "in");
    const resolved = inPath ? path.resolve(cwd, inPath) : gp.partialGraph;
    input = readJson(resolved);
    if (input === null) {
      process.stderr.write(`[validate] ERROR: cannot read input graph ${resolved}\n`);
      process.exit(2);
    }
  }

  if (input && typeof input === "object") delete (input as Record<string, unknown>)._merge_report;

  const dispatchedV2 = isV2Input(input);
  const result = validateWithDispatch(input, gp.repoRoot);
  const counts = result.issues.reduce<Record<string, number>>((m, i) => {
    m[i.level] = (m[i.level] ?? 0) + 1;
    return m;
  }, {});

  if (!result.success || !result.data) {
    process.stderr.write(`[validate] FATAL: ${result.fatal}\n`);
    process.stdout.write(JSON.stringify({ success: false, fatal: result.fatal, issues: result.issues }, null, 2) + "\n");
    process.exit(2);
  }

  process.stderr.write(
    `[validate] OK (${dispatchedV2 ? "v2" : "v1"}) · nodes=${result.data.nodes.length} edges=${result.data.edges.length} ` +
    `layers=${result.data.layers.length} · auto-corrected=${counts["auto-corrected"] ?? 0} ` +
    `dropped=${counts["dropped"] ?? 0}\n`,
  );

  const dry = hasFlag(argv, "dry");
  const force = hasFlag(argv, "force");

  if (!dry) {
    const guard = checkDowngradeGuard(gp.knowledgeGraph, result.data, force);
    if (guard.refused) {
      const msg =
        `[validate] REFUSED: on-disk knowledge-graph.json is ${guard.onDiskVersion} (carries the knowledge ` +
        `tier — wiki_page/topic/diagram nodes + knowledge edges) but this run resolved a non-v2 result, which ` +
        `would silently strip that tier. Re-run the knowledge finalize (learn-knowledge) instead of this CLI, ` +
        `or pass --force to downgrade deliberately.\n`;
      process.stderr.write(msg);
      process.stdout.write(
        JSON.stringify(
          { success: false, refused: "v2-downgrade-guard", onDiskVersion: guard.onDiskVersion },
          null,
          2,
        ) + "\n",
      );
      process.exit(2);
    }
    if (guard.onDiskVersion === KNOWLEDGE_GRAPH_V2 && !isV2Result(result.data) && force) {
      process.stderr.write(
        `[validate] WARNING: --force downgrading on-disk ${guard.onDiskVersion} knowledge-graph.json to a ` +
        `non-v2 result — the knowledge tier will be lost.\n`,
      );
    }
  }

  if (!dry) {
    writeJson(gp.knowledgeGraph, result.data);
    process.stderr.write(`[validate] → ${path.relative(gp.repoRoot, gp.knowledgeGraph)}\n`);
  }

  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ data: result.data, issues: result.issues }, null, 2) + "\n");
  } else {
    process.stdout.write(
      dry ? "validated (dry-run)\n" : path.relative(gp.repoRoot, gp.knowledgeGraph) + "\n",
    );
  }
}

if (require.main === module) {
  main();
}
