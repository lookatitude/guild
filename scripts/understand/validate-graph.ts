#!/usr/bin/env -S npx tsx
/**
 * understand/validate-graph.ts — the Tolerant validate/repair ladder
 * (codebase-understanding.md §"Tolerant validate/repair ladder").
 *
 * sanitize → normalize aliases (forked ~80-entry MIT table) → auto-fix
 * defaults → validate & drop invalid items individually. Never discards a
 * salvageable graph; FATAL only on zero valid nodes. Writes the FINAL
 * KnowledgeGraph artifact (`guild.knowledge_graph.v1`) to
 * .guild/indexes/knowledge-graph.json.
 *
 * Usage:
 *   npx tsx validate-graph.ts [--cwd <path>] [--in <path>] [--dry] [--print]
 *   cat graph.json | npx tsx validate-graph.ts --cwd <path> --stdin
 * Exit: 0 ok (incl. dropped items) · 2 fatal (unrecoverable).
 */

import * as fs from "fs";
import * as path from "path";
import { guildPaths, parseCwd, parseFlag, hasFlag, writeJson, readJson } from "./lib/paths";
import { validateGraph } from "./lib/schema";

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

  const result = validateGraph(input);
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
    `[validate] OK · nodes=${result.data.nodes.length} edges=${result.data.edges.length} ` +
    `layers=${result.data.layers.length} · auto-corrected=${counts["auto-corrected"] ?? 0} ` +
    `dropped=${counts["dropped"] ?? 0}\n`,
  );

  if (!hasFlag(argv, "dry")) {
    writeJson(gp.knowledgeGraph, result.data);
    process.stderr.write(`[validate] → ${path.relative(gp.repoRoot, gp.knowledgeGraph)}\n`);
  }

  if (hasFlag(argv, "print")) {
    process.stdout.write(JSON.stringify({ data: result.data, issues: result.issues }, null, 2) + "\n");
  } else {
    process.stdout.write(
      hasFlag(argv, "dry") ? "validated (dry-run)\n" : path.relative(gp.repoRoot, gp.knowledgeGraph) + "\n",
    );
  }
}

main();
