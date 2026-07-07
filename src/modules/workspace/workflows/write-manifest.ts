#!/usr/bin/env -S npx tsx
/**
 * scripts/workspace/write-manifest.ts
 *
 * Idempotent writer of <root>/.guild/workspace.json conforming to guild.workspace.v1.
 *
 * Refresh-merge semantics:
 *   Re-detect sub_guilds from scratch each run. Overwrite workspace.json atomically
 *   (temp file → rename). Never touches any other file under .guild/. Never copies
 *   sub-guild wiki pages up into the workspace .guild/ (SC-3 / no-duplication).
 *
 * root_wiki (D-OQ2):
 *   true iff the workspace root itself has at least one scannable top-level code file
 *   (extensions: .ts .tsx .js .jsx .py .rb .go .rs .java .kt .swift .cs .cpp .c .h).
 *   Pure federation roots (only sub-repos + docs/) get root_wiki=false.
 *
 * Usage:
 *   npx tsx scripts/workspace/write-manifest.ts --cwd <root> [--mode auto|on|off]
 *
 * Reads:    <root>/.guild/settings.json (optional — for workspace.mode)
 * Writes:   <root>/.guild/workspace.json (atomic temp-then-rename)
 * Stdout:   path to written manifest.
 * Stderr:   diagnostics.
 * Exit:
 *   0  Success — always written, including on a regular (non-workspace) root,
 *      where the manifest records is_workspace:false (idempotent; init guards
 *      the call with detection, so a regular repo is normally never written).
 *   1  Bad input (--cwd invalid).
 *   2  Internal error.
 *
 * Invariant: never writes to .guild/wiki/ or into any sub-guild's .guild/.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detect, type WorkspaceMode } from "./detect";

// ── Code-file extensions that indicate scannable top-level code (D-OQ2) ──────

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
  ".cs", ".cpp", ".c", ".h", ".hpp",
]);

/** True iff root has at least one code file directly in it (depth-0 only). */
function hasTopLevelCode(root: string): boolean {
  try {
    const entries = fs.readdirSync(root);
    for (const name of entries) {
      const ext = path.extname(name).toLowerCase();
      if (CODE_EXTENSIONS.has(ext)) {
        try {
          const stat = fs.statSync(path.join(root, name));
          if (stat.isFile()) return true;
        } catch {
          // skip
        }
      }
    }
  } catch {
    // unreadable — assume false
  }
  return false;
}

// ── Manifest schema (guild.workspace.v1) ─────────────────────────────────────

interface WorkspaceManifest {
  schema_version: "guild.workspace.v1";
  is_workspace: boolean;
  detected_at: string;
  detection: {
    depth: 1;
    rule: string;
    mode: WorkspaceMode;
  };
  root_wiki: boolean;
  sub_guilds: Array<{
    name: string;
    path: string;
    kind: "sub-guild" | "sub-project";
    remote: string | null;
    has_wiki: boolean;
    has_indexes: boolean;
    last_seen_commit: string | null;
  }>;
  query_recipe: {
    mechanism: string;
    fan_out: string;
    example: string;
  };
}

// ── Core writer ───────────────────────────────────────────────────────────────

export function writeManifest(root: string, modeOverride?: WorkspaceMode): string {
  const detection = detect(root, modeOverride);
  const rootWiki = hasTopLevelCode(root);

  const manifest: WorkspaceManifest = {
    schema_version: "guild.workspace.v1",
    is_workspace: detection.kind === "workspace",
    detected_at: new Date().toISOString(),
    detection: detection.detection,
    root_wiki: rootWiki,
    sub_guilds: detection.sub_guilds,
    query_recipe: {
      mechanism:
        "guild-memory MCP wiki_search/wiki_get/wiki_list with per-call cwd override " +
        "(or GUILD_MEMORY_WIKI_ROOT=<path>/.guild/wiki)",
      fan_out:
        "iterate sub_guilds where has_wiki; merge results, tag each hit with sub_guild.name",
      example: "wiki_search({ query: '<q>', cwd: 'plugin' })",
    },
  };

  // Ensure .guild/ dir exists (does not touch any sub-dir or wiki)
  const guildDir = path.join(root, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });

  const manifestPath = path.join(guildDir, "workspace.json");
  const tmpPath = path.join(os.tmpdir(), `guild-ws-manifest-${Date.now()}-${process.pid}.json.tmp`);

  // Atomic write: write to tmp → rename (never a partial workspace.json)
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, manifestPath);

  return manifestPath;
}

// ── CLI entry point ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cwd?: string; mode?: WorkspaceMode } {
  let cwd: string | undefined;
  let mode: WorkspaceMode | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg === "--mode" && argv[i + 1]) {
      const v = argv[++i];
      if (v === "auto" || v === "on" || v === "off") mode = v;
    }
  }
  return { cwd, mode };
}

export function runWriteWorkspaceManifestCli(argv: string[] = process.argv.slice(2)): void {
  const { cwd: cwdArg, mode } = parseArgs(argv);
  const cwd = cwdArg ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write(`[workspace/write-manifest] ERROR: --cwd "${cwd}" is not a directory\n`);
    process.exit(1);
  }

  try {
    const written = writeManifest(cwd, mode);
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[workspace/write-manifest] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  runWriteWorkspaceManifestCli();
}
