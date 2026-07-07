#!/usr/bin/env -S npx tsx
/**
 * learn/scan.ts — Stage 1 (Scan) SCRIPT phase.
 *
 * Deterministic discovery + ignore filter + per-language import-map
 * resolution → .guild/indexes/codebase-map.json (`guild.codebase_map.v1`,
 * codebase-understanding.md §"CodebaseMap", contract-map.md §A row 11).
 * The LLM phase (#24) adds only the 1–2 sentence project description.
 *
 * Usage:
 *   npx tsx scan.ts [--cwd <path>] [--print] [--gen-ignore]
 * Exit: 0 ok · 1 write/error.
 */

import * as fs from "fs";
import * as path from "path";
import {
  guildPaths, parseCwd, hasFlag, writeJson, SCHEMA,
} from "./lib/paths";
import { headSha } from "./lib/git";
import { walkRepo } from "./lib/walk";
import { detectLanguage, detectFrameworks, isEntrypoint, moduleOf, isCodeLanguage } from "./lib/languages";
import { analyzeSource } from "./lib/extract";
import { buildImportMap } from "./lib/import-map";
import { generateStarterIgnoreFile } from "./lib/ignore";

function main(): void {
  const argv = process.argv.slice(2);
  const cwd = parseCwd(argv);
  const gp = guildPaths(cwd);
  const repoRoot = gp.repoRoot;

  // Stage 0.5: seed a starter .guildignore if absent (user-tunable scope).
  const ignorePath = path.join(repoRoot, ".guildignore");
  if (hasFlag(argv, "gen-ignore") && !fs.existsSync(ignorePath)) {
    fs.writeFileSync(ignorePath, generateStarterIgnoreFile(repoRoot), "utf8");
    process.stderr.write(`[scan] wrote starter ${path.relative(repoRoot, ignorePath)}\n`);
  }

  const { files } = walkRepo(repoRoot);

  let pkgJson: Record<string, unknown> | null = null;
  try {
    pkgJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  } catch { /* none */ }

  const languages = new Set<string>();
  const modules = new Set<string>();
  const fileEntries = files.map((rel) => {
    const language = detectLanguage(rel);
    if (language !== "unknown") languages.add(language);
    const mod = moduleOf(rel);
    modules.add(mod);

    let loc = 0;
    let complexity = 0;
    if (isCodeLanguage(language)) {
      try {
        const a = analyzeSource(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8"));
        if (a) { loc = a.loc; complexity = a.complexity; }
      } catch { /* unreadable */ }
    }
    return {
      path: rel,
      language,
      loc,
      complexity,
      module: mod,
      is_entrypoint: isEntrypoint(rel),
    };
  });

  const importMap = buildImportMap(repoRoot, files).map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
  }));

  const codebaseMap = {
    version: SCHEMA.codebaseMap,
    generated_from_commit: headSha(repoRoot),
    project: {
      root: repoRoot,
      languages: [...languages].sort(),
      frameworks: detectFrameworks(pkgJson, files),
    },
    files: fileEntries,
    import_map: importMap,
    stats: { file_count: fileEntries.length, module_count: modules.size },
  };

  try {
    writeJson(gp.codebaseMap, codebaseMap);
  } catch (err) {
    process.stderr.write(`[scan] ERROR writing codebase-map.json: ${String(err)}\n`);
    process.exit(1);
  }

  process.stderr.write(
    `[scan] ${fileEntries.length} files · ${languages.size} languages · ` +
    `${importMap.length} import edges → ${path.relative(repoRoot, gp.codebaseMap)}\n`,
  );
  if (hasFlag(argv, "print")) process.stdout.write(JSON.stringify(codebaseMap, null, 2) + "\n");
  else process.stdout.write(path.relative(repoRoot, gp.codebaseMap) + "\n");
}

main();
