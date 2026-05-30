#!/usr/bin/env -S npx tsx
/**
 * hooks/detect-guild-version.ts
 *
 * Event:   SessionStart
 * Purpose: Detect any .guild/ tree in the repo and, if it is v1 or mixed,
 *          surface a migration prompt to the user (SC-2 "surfaced, never silent").
 *
 * THIS HOOK NEVER MUTATES THE TREE. It is detect-and-surface only.
 * Actual migration runs via the explicit command the user invokes after choosing.
 * This keeps the always-ask-on-mutate HARD rail intact.
 *
 * Classification outcomes (from convert/detect.ts):
 *   v2      → silent no-op (SC-1 zero-false-positive)
 *   none    → silent no-op (no .guild/ present)
 *   v1      → surface migrate/dry-run/skip prompt block
 *   mixed   → surface migrate/dry-run/skip prompt block
 *   corrupt → surface DISTINCT message: no migrate offered, dry-run + manual review
 *
 * Output channel: stdout. Claude Code renders SessionStart hook stdout as
 * "additionalContext" injected into the session at startup (the same channel
 * bootstrap.sh uses for its status block). Writing to stdout is the correct
 * surface for SessionStart hooks — the harness picks it up and makes it visible.
 *
 * Stdin:  Claude Code SessionStart hook payload (JSON). cwd is read from it.
 *         Has a 500 ms timeout — if stdin doesn't close in time, proceeds with
 *         whatever was buffered (Fix C / F3: never hangs on session open).
 * Stdout: Surfaced message when v1/mixed/corrupt; silent (empty) otherwise.
 * Stderr: Diagnostics only (never blocks session).
 * Exit:   Always 0 — a hook failure must NEVER block the session.
 *
 * Runner: bundled to dist/detect-guild-version.js via esbuild (hooks/package.json).
 *         Can also be run directly: npx tsx hooks/detect-guild-version.ts
 */

import * as path from "node:path";
import * as fs from "node:fs";
import { resolveGuildRoot } from "./lib/guild-root.js";

// ── Inline detect import ──────────────────────────────────────────────────
// We import detect + realFs directly from the converter. esbuild bundles
// everything into dist/detect-guild-version.js so there are no runtime
// path-resolution surprises.
import { detect } from "../scripts/dot-guild/convert/detect.js";
import { realFs } from "../scripts/dot-guild/convert/seams.js";

// ── Types ─────────────────────────────────────────────────────────────────

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
}

// ── Stdin reader (Fix C / F3 — 500 ms timeout) ───────────────────────────
//
// Claude Code feeds hook stdin synchronously before the hook process's stdin
// stream closes. In practice it closes immediately, but to guard against any
// future harness variation that delays the EOF, we race the 'end' event
// against a 500 ms deadline. On timeout we proceed with whatever was buffered
// (may be empty → silent exit 0). This prevents the hook from ever hanging
// and blocking session open.

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const settle = (result: string) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => settle(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => settle(""));

    // 500 ms deadline — proceed with whatever is buffered so far.
    setTimeout(() => settle(Buffer.concat(chunks).toString("utf8")), 500);
  });
}

// ── Migrate CLI path resolution (Fix B redo / F4) ────────────────────────
//
// Priority:
//   1. ${CLAUDE_PLUGIN_ROOT}/scripts/dot-guild/migrate-guild.ts  — installed path
//      (CLAUDE_PLUGIN_ROOT is injected by Claude Code for all installed plugins).
//      Return even if the file doesn't exist yet — it's the canonical path.
//   2. __dirname fallback — try two candidates and pick the first that exists:
//        a. <plugin>/hooks/dist → ../../scripts/...  (bundled runtime: __dirname
//           = <plugin>/hooks/dist, two levels up = <plugin>/)
//        b. <plugin>/hooks     → ../scripts/...      (tsx source runtime: __dirname
//           = <plugin>/hooks, one level up = <plugin>/)
//      If neither exists on disk, use candidate (a) — the dist-relative path —
//      as the safe fallback (correct at production runtime).
//
// The resolved ABSOLUTE path is printed in the surfaced commands, and
// --root is appended, so the command is unambiguous regardless of cwd.

function resolveMigratePath(): string {
  // Option 1: CLAUDE_PLUGIN_ROOT env.
  const pluginRoot = process.env["CLAUDE_PLUGIN_ROOT"];
  if (pluginRoot) {
    const candidate = path.resolve(pluginRoot, "scripts/dot-guild/migrate-guild.ts");
    if (fs.existsSync(candidate)) return candidate;
    // Return even if not present — right path for an installed plugin.
    return candidate;
  }

  // Option 2: derive from __dirname — try both depth candidates.
  // Candidate (a): dist-relative — correct when bundled (hooks/dist/__dirname).
  const distRelative = path.resolve(__dirname, "../../scripts/dot-guild/migrate-guild.ts");
  // Candidate (b): source-relative — correct when run via tsx (hooks/__dirname).
  const srcRelative = path.resolve(__dirname, "../scripts/dot-guild/migrate-guild.ts");

  if (fs.existsSync(distRelative)) return distRelative;
  if (fs.existsSync(srcRelative)) return srcRelative;
  // Neither exists — return dist-relative as the production-correct fallback.
  return distRelative;
}

// ── Message builders ──────────────────────────────────────────────────────

/**
 * The SC-2 surfaced block for v1 and mixed trees.
 * Uses resolved absolute path for commands + appends --root so the command
 * targets the detected repo regardless of the user's cwd (Fix B).
 *
 * Fix A: dry-run description is accurate — it writes only the dry-run report
 * under .guild/ (no snapshot, no migration, no file mutations).
 */
function buildV1MixedMessage(
  classification: "v1" | "mixed",
  guildDir: string,
  repoRoot: string,
  migratePath: string
): string {
  const classLabel = classification === "mixed" ? "v1/mixed" : "v1";
  const base = `npx tsx "${migratePath}" --root="${repoRoot}"`;
  return [
    `[Guild] v1 .guild detected — migrate to v2? [migrate / dry-run / skip]`,
    ``,
    `  Classification: ${classLabel}   Path: ${guildDir}`,
    ``,
    `  migrate  → ${base} --mode=migrate`,
    `             (snapshots .guild/ first, then converts in place; rollback available)`,
    `  dry-run  → ${base} --mode=dry-run`,
    `             (previews the plan + writes only a dry-run report under .guild/; no migration, no snapshot)`,
    `  skip     → do nothing (this message surfaces again next session)`,
    ``,
    `  Multi-repo (workspace): add --workspace to fan out to all child repos.`,
    ``,
    `  Tip: run dry-run first to preview before committing to migrate.`,
  ].join("\n");
}

/**
 * The DISTINCT message for corrupt trees.
 * No migrate is offered — corruption requires manual review first.
 * Fix A: dry-run description accurate; Fix B: resolved absolute path.
 */
function buildCorruptMessage(
  guildDir: string,
  repoRoot: string,
  migratePath: string
): string {
  const base = `npx tsx "${migratePath}" --root="${repoRoot}"`;
  return [
    `[Guild] corrupt .guild detected — migration blocked pending manual review`,
    ``,
    `  Path: ${guildDir}`,
    ``,
    `  One or more authoritative files failed to parse (truncated / invalid JSON/YAML).`,
    `  Blind conversion could discard data. Inspect first, then re-classify.`,
    ``,
    `  Recommended steps:`,
    `    1. Inspect:  ${base} --mode=dry-run`,
    `                 (reads; writes only a dry-run report under .guild/ — no other changes)`,
    `    2. Manual review: open the flagged files and repair or remove the corrupt entries.`,
    `    3. Re-run:   ${base} --mode=dry-run  (confirm no corrupt files remain)`,
    `    4. Once dry-run reports clean, re-open the session — the normal migrate prompt`,
    `       will surface if any v1/mixed keys remain.`,
    ``,
    `  Do not force migrate on a corrupt tree.`,
  ].join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: HookPayload = {};
  try {
    if (raw.trim()) {
      payload = JSON.parse(raw.trim()) as HookPayload;
    }
  } catch {
    // Malformed stdin — nothing to do; silent exit.
    process.exit(0);
  }

  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot(cwd);
  const guildDir = path.join(root, ".guild");

  // Fast path: no .guild/ → silent
  if (!fs.existsSync(guildDir)) {
    process.exit(0);
  }

  const result = detect(realFs, guildDir);
  const migratePath = resolveMigratePath();

  switch (result.classification) {
    case "v2":
    case "none":
      // Silent — correct, clean, or absent tree.
      break;

    case "v1":
    case "mixed":
      process.stdout.write(
        buildV1MixedMessage(result.classification, guildDir, root, migratePath) + "\n"
      );
      break;

    case "corrupt":
      process.stdout.write(buildCorruptMessage(guildDir, root, migratePath) + "\n");
      break;

    default:
      // Unknown future classification — silent (forward-compatible).
      break;
  }

  process.exit(0);
}

main().catch((err: unknown) => {
  // Catch-all: a detect throw MUST NOT block the session.
  process.stderr.write(
    `[detect-guild-version] error (session unaffected): ${
      err instanceof Error ? err.message : String(err)
    }\n`
  );
  process.exit(0);
});
