#!/usr/bin/env -S npx tsx
/**
 * scripts/sync-migration.ts
 *
 * F7 fix: single-source generator for MIGRATION.md.
 * Canonical: plugin/.guild/wiki/entities/MIGRATION.md  (hand-authored by docs-writer)
 * Target (what main() writes/checks):
 *   MIGRATION.md (root)  — pointer stub with digest extracted from canonical.
 * `generatePluginCopy()` is a retained-but-uninvoked helper for a plugin/MIGRATION.md full copy.
 *
 * Usage (run from repo root):
 *   npx tsx plugin/scripts/sync-migration.ts          # write the root stub
 *   npx tsx plugin/scripts/sync-migration.ts --check  # drift-detect, exit 1 if stale
 *   npx tsx plugin/scripts/sync-migration.ts --cwd <repo-root>
 *
 * Options:
 *   --check   Regenerate in-memory, byte-diff vs on-disk, exit 1 on any mismatch.
 *   --cwd     Repo root (default ".").
 *
 * Exit codes:
 *   0  Success (write: targets updated; check: all in-sync).
 *   1  Check: one or more targets stale. Or: bad input (canonical missing /
 *      fence markers absent).
 *   2  Internal error.
 *
 * Invariants:
 *   - Never writes to .guild/wiki/.
 *   - Deterministic — no timestamps injected; pure content diff is correct.
 *   - Link-rewrite scope: ](architecture/  ](lifecycle/  ](decisions/  only.
 */

import * as fs from "fs";
import * as path from "path";
import { hasTopLevelKey, replaceTopLevelLine } from "./lib/frontmatter";

// ── Constants ─────────────────────────────────────────────────────────────

const CANONICAL_REL = path.join("plugin", ".guild", "wiki", "entities", "MIGRATION.md");
const PLUGIN_TARGET_REL = path.join("plugin", "MIGRATION.md");
const ROOT_TARGET_REL = "MIGRATION.md";

const LINK_DIRS = ["architecture", "lifecycle", "decisions"] as const;
type LinkDir = (typeof LINK_DIRS)[number];
// Where each old docs/knowledge link-dir landed in the v2 plugin wiki (harvest 2026-06-27).
// (The real canonical's digest carries no such links; this only rewrites any that appear.)
const WIKI_SUBDIR: Record<LinkDir, string> = {
  architecture: "entities",
  lifecycle: "entities",
  decisions: "decisions",
};

/** Prefix map for plugin/ target (at plugin/): link-dir → .guild/wiki/<subdir>/. */
const PLUGIN_PREFIX_MAP: Record<string, string> = Object.fromEntries(
  LINK_DIRS.map((d) => [`](${d}/`, `](.guild/wiki/${WIKI_SUBDIR[d]}/`])
);

/** Prefix map for root target (at repo root): link-dir → plugin/.guild/wiki/<subdir>/. */
const ROOT_PREFIX_MAP: Record<string, string> = Object.fromEntries(
  LINK_DIRS.map((d) => [`](${d}/`, `](plugin/.guild/wiki/${WIKI_SUBDIR[d]}/`])
);

const STUB_DIGEST_START = "<!-- STUB-DIGEST:START -->";
const STUB_DIGEST_END = "<!-- STUB-DIGEST:END -->";

// ── CLI parsing ───────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { check: boolean; cwd: string } {
  let check = false;
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--check") check = true;
    else if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { check, cwd };
}

// ── Pure transform functions ──────────────────────────────────────────────

/**
 * Split canonical content into the YAML front-matter block (including both
 * `---` delimiters) and the body (everything after the closing `---`).
 * Returns empty strings if no front-matter is present.
 */
function parseFrontMatter(content: string): { fmRaw: string; body: string } {
  const lines = content.split("\n");
  if (lines[0] !== "---") return { fmRaw: "", body: content };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { fmRaw: "", body: content };

  const fmRaw = lines.slice(0, endIdx + 1).join("\n");
  const body = lines.slice(endIdx + 1).join("\n");
  return { fmRaw, body };
}

/**
 * Replace (or insert) `source_refs:` in fmRaw to point at the canonical.
 */
function overrideSourceRefs(fmRaw: string): string {
  const replacement = `source_refs: ["plugin/.guild/wiki/entities/MIGRATION.md"]`;
  // Byte-preserving top-level line swap via the shared helper (OD-3).
  if (hasTopLevelKey(fmRaw, "source_refs")) {
    return replaceTopLevelLine(fmRaw, "source_refs", replacement).text;
  }
  // No source_refs present — insert before the closing ---
  return fmRaw.replace(/\n---$/, `\n${replacement}\n---`);
}

/**
 * Apply a prefix map to all Markdown link destinations of the form `](dir/…`.
 * Only rewrites the three scoped directories; no other link text is touched.
 */
function rewriteLinks(text: string, prefixMap: Record<string, string>): string {
  let result = text;
  for (const [from, to] of Object.entries(prefixMap)) {
    // Use split/join rather than regex to avoid special-char escaping issues.
    result = result.split(from).join(to);
  }
  return result;
}

/**
 * Extract the lines between the STUB-DIGEST fences (exclusive of the fence
 * lines themselves). Returns the joined string (no trailing newline).
 * Throws if either fence is absent.
 */
function extractDigest(body: string): string {
  const lines = body.split("\n");
  let inDigest = false;
  let foundStart = false;
  let foundEnd = false;
  const digestLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === STUB_DIGEST_START) {
      inDigest = true;
      foundStart = true;
      continue;
    }
    if (line.trim() === STUB_DIGEST_END) {
      inDigest = false;
      foundEnd = true;
      continue;
    }
    if (inDigest) digestLines.push(line);
  }

  if (!foundStart || !foundEnd) {
    throw new Error(
      `Canonical is missing required STUB-DIGEST fence markers.\n` +
        `Expected both "${STUB_DIGEST_START}" and "${STUB_DIGEST_END}" in the body.`
    );
  }

  return digestLines.join("\n");
}

/**
 * Remove the two STUB-DIGEST fence-marker lines from body text.
 * The content between the fences is preserved (it's part of the full body).
 */
function stripFenceMarkers(body: string): string {
  return body
    .split("\n")
    .filter(
      (line) =>
        line.trim() !== STUB_DIGEST_START && line.trim() !== STUB_DIGEST_END
    )
    .join("\n");
}

// ── Generator: plugin/ full copy ─────────────────────────────────────────

const PLUGIN_BANNER = `<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: plugin/.guild/wiki/entities/MIGRATION.md (canonical).
     Regenerate from the umbrella repo root: npx tsx plugin/scripts/sync-migration.ts   (drift-check: --check).
     Only link-path prefixes differ from canonical (rewritten for plugin/). -->`;

const PLUGIN_BLOCKQUOTE = `> **Generated copy — do not edit by hand.** Canonical source:
> [\`plugin/.guild/wiki/entities/MIGRATION.md\`](plugin/.guild/wiki/entities/MIGRATION.md). This package
> copy is regenerated from it (only link paths are rewritten). Edit the
> canonical, then regenerate.`;

export function generatePluginCopy(canonical: string): string {
  const { fmRaw, body } = parseFrontMatter(canonical);

  // Validate fences (extractDigest throws if absent).
  extractDigest(body);

  const updatedFm = overrideSourceRefs(fmRaw);
  // Strip fence-marker lines; keep the digest content inline (it's part of body).
  const strippedBody = stripFenceMarkers(body);
  const rewrittenBody = rewriteLinks(strippedBody, PLUGIN_PREFIX_MAP);
  // Trim leading blank lines from body for clean assembly.
  const trimmedBody = rewrittenBody.replace(/^\n+/, "");

  return [
    updatedFm,
    "",
    PLUGIN_BANNER,
    "",
    PLUGIN_BLOCKQUOTE,
    "",
    trimmedBody,
  ].join("\n");
}

// ── Generator: root pointer stub ─────────────────────────────────────────

const ROOT_BANNER = `<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Source: plugin/.guild/wiki/entities/MIGRATION.md (canonical). Repo-root pointer stub.
     Regenerate from the umbrella repo root: npx tsx plugin/scripts/sync-migration.ts   (drift-check: --check). -->`;

const ROOT_POINTER_BLOCKQUOTE = `> **This is a pointer.** The canonical, maintained v1 → v2 migration guide
> lives at **[\`plugin/.guild/wiki/entities/MIGRATION.md\`](plugin/.guild/wiki/entities/MIGRATION.md)** (the
> source of truth, and the target of every in-docs \`MIGRATION.md\` cross-link).
> This repo-root file is a
> generated pointer stub — do not edit it by hand.`;

/**
 * Derive the root stub front-matter from canonical's FM.
 * Carries all fields verbatim EXCEPT:
 *   source_refs → ["plugin/.guild/wiki/entities/MIGRATION.md"]
 *   supersedes  → null  (canonical points at plugin/guild-plan.md; root stub doesn't)
 */
function deriveRootFrontMatter(fmRaw: string): string {
  let fm = overrideSourceRefs(fmRaw);
  // Override supersedes: null regardless of canonical value (byte-preserving).
  if (hasTopLevelKey(fm, "supersedes")) {
    fm = replaceTopLevelLine(fm, "supersedes", `supersedes: null`).text;
  } else {
    fm = fm.replace(/\n---$/, `\nsupersedes: null\n---`);
  }
  return fm;
}

export function generateRootStub(canonical: string): string {
  const { fmRaw, body } = parseFrontMatter(canonical);

  // Extract and root-rewrite the digest lines.
  const digestRaw = extractDigest(body);
  const digestRewritten = rewriteLinks(digestRaw, ROOT_PREFIX_MAP);

  const rootFm = deriveRootFrontMatter(fmRaw);

  return [
    rootFm,
    "",
    ROOT_BANNER,
    "",
    "# Guild v1 → v2 Migration",
    "",
    ROOT_POINTER_BLOCKQUOTE,
    "",
    "## The 30-second version (read the canonical guide for the full mapping)",
    "",
    digestRewritten,
    "",
    "For the complete removed/renamed-command table, config key mapping, flag",
    "cheat-sheet, and worked examples, see",
    "**[`plugin/.guild/wiki/entities/MIGRATION.md`](plugin/.guild/wiki/entities/MIGRATION.md)**.",
    "",
  ].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

function main(): void {
  const { check, cwd: cwdArg } = parseArgs(process.argv.slice(2));
  const cwd = path.resolve(cwdArg);

  const canonicalPath = path.join(cwd, CANONICAL_REL);
  if (!fs.existsSync(canonicalPath)) {
    process.stderr.write(
      `[sync-migration] ERROR: canonical not found at ${canonicalPath}\n`
    );
    process.exit(1);
  }

  const canonical = fs.readFileSync(canonicalPath, "utf8");

  // Validate fences up-front (before writing anything). The migration GUIDE for
  // end users lives on the website (guildstack.dev/docs/migration-v1-to-v2); the
  // PUBLIC PLUGIN repo no longer carries a MIGRATION.md (progress/transitional
  // tracking is workspace-only). This generator now maintains only the
  // workspace-root pointer stub from the workspace canonical.
  let rootContent: string;
  try {
    rootContent = generateRootStub(canonical);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[sync-migration] ERROR: ${msg}\n`);
    process.exit(1);
    return;
  }

  const rootTarget = path.join(cwd, ROOT_TARGET_REL);

  if (check) {
    // ── Check mode: byte-diff vs on-disk ─────────────────────────────────
    const stale: string[] = [];

    const checkFile = (targetPath: string, generated: string, label: string): void => {
      if (!fs.existsSync(targetPath)) {
        stale.push(`${label} (missing)`);
        return;
      }
      const onDisk = fs.readFileSync(targetPath, "utf8");
      if (onDisk !== generated) {
        stale.push(`${label} (stale / mismatch)`);
      }
    };

    checkFile(rootTarget, rootContent, ROOT_TARGET_REL);

    if (stale.length > 0) {
      process.stderr.write(
        `[sync-migration] FAIL: ${stale.length} stale target(s):\n` +
          stale.map((s) => `  - ${s}`).join("\n") +
          `\n  Run: npx tsx scripts/sync-migration.ts  to regenerate.\n`
      );
      process.exit(1);
    }

    process.stderr.write(`[sync-migration] OK: all targets in-sync with canonical.\n`);
    process.exit(0);
  } else {
    // ── Write mode: regenerate the workspace-root pointer stub ────────────
    fs.mkdirSync(path.dirname(rootTarget), { recursive: true });
    fs.writeFileSync(rootTarget, rootContent, "utf8");

    process.stderr.write(`[sync-migration] wrote:\n  ${rootTarget}\n`);
    process.exit(0);
  }
}

main();
