#!/usr/bin/env -S npx tsx
/**
 * scripts/check-entrypoint-packaging.ts
 *
 * Packaging rail (generalizes issue #55's defect class): scans every shipped
 * skills/​**​/*.md file and every hooks/ source file (hooks/​**​/*.ts, hooks/​**​/*.sh,
 * excluding tests/fixtures/dist/node_modules) for a documented `npx tsx <path>` or
 * `node <path>` CLI-entrypoint invocation under hooks/, then fails when:
 *
 *   1. SOURCE_MISSING — the referenced file does not exist anywhere in the
 *      source tree (the doc/skill references something that was never written).
 *   2. PACKAGE_MISSING — the referenced file DOES exist in the source tree, but
 *      is absent from one or more RENDERED host packages (the exact shape of
 *      issue #55: hooks/emit-learning-checkpoint.ts existed and was correctly
 *      imported by hooks/lib/*.ts, but no host-package renderer shipped it, so
 *      a real install hit ERR_MODULE_NOT_FOUND). This check actually renders
 *      every host package (scripts/build-host-packages.ts writers) into a temp
 *      directory and looks for the referenced file there — it does NOT just
 *      re-check the source tree, which would stay green even if the packaging
 *      copy were silently removed.
 *
 * The PACKAGE_MISSING check renders all 9 direct host trees (Claude, Codex,
 * Agents, Pi, Antigravity, cursor, github-copilot, opencode, rovo-dev) PLUS the
 * Codex marketplace wrapper (`codex-marketplace/plugins/guild/**`, a distinct
 * installable artifact) — 10 rendered surfaces total. It runs by default
 * whenever `--cwd` looks like a real, buildable plugin root (has
 * .claude-plugin/plugin.json + scripts/build-host-packages.ts +
 * scripts/build-inventory.ts); an incomplete `--cwd` FAILS CLOSED (a wrong path
 * must not silently report success) unless `--source-only` is passed explicitly
 * — the escape hatch synthetic unit-test fixtures use to exercise the
 * SOURCE_MISSING path in isolation.
 *
 * Usage:
 *   npx tsx scripts/check-entrypoint-packaging.ts [--cwd <plugin-root>] [--source-only]
 *
 * Exit codes:
 *   0  every referenced entrypoint exists in source AND in every rendered package.
 *   1  one or more entrypoints are missing, a render failed, or --cwd is an
 *      incomplete plugin root without --source-only; details on stderr.
 *
 * Invariants:
 *   - Read-only with respect to the source tree. Any host-package rendering
 *     happens in a temp directory that is always cleaned up.
 *   - No network. Local filesystem only.
 *   - Deterministic given the same inputs.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildInventory, UNSTAMPED_GENERATED_AT } from "./build-inventory";
import type { GuildInventoryV1 } from "./lib/inventory-schema";
import {
  writeClaudeTree,
  writeCodexTree,
  writeCodexMarketplaceTree,
  writeAgentsTree,
  writePiTree,
  writeAntigravityTree,
  writeNewCliTree,
} from "./build-host-packages";

// ── Types ─────────────────────────────────────────────────────────────────

export interface EntrypointRef {
  /** Repo-relative path of the file containing the reference. */
  sourceFile: string;
  /** Which CLI invocation form matched. */
  invocation: "npx tsx" | "node";
  /** Repo-relative path referenced, e.g. "hooks/emit-learning-checkpoint.ts". */
  entrypoint: string;
}

export interface MissingEntrypoint extends EntrypointRef {
  resolvedPath: string;
}

export interface HostPackageCheck {
  host: string;
  /** Referenced entrypoints absent from this host's rendered tree. */
  missing: string[];
  /** Set when rendering the host package itself threw (e.g. a required-file guard tripped). */
  renderError?: string;
}

// ── Extraction ──────────────────────────────────────────────────────────────

/**
 * Matches `npx tsx ... hooks/<path>.ts` or `node ... hooks/dist/<path>.js`,
 * tolerating `${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}`-style env-var
 * prefixes between the invocation verb and the `hooks/` path.
 */
const ENTRYPOINT_PATTERN = /\b(npx tsx|node)\b[^\n]*?(hooks\/[A-Za-z0-9_.\-/]+\.(?:ts|js))/g;

/** Collapse `\` + newline shell continuations so multi-line invocations match. */
function collapseContinuations(content: string): string {
  return content.replace(/\\\r?\n\s*/g, " ");
}

/** Extract every documented `npx tsx`/`node` hooks/ entrypoint reference in `content`. */
export function extractEntrypointRefs(content: string, sourceFile: string): EntrypointRef[] {
  const collapsed = collapseContinuations(content);
  const refs: EntrypointRef[] = [];
  const pattern = new RegExp(ENTRYPOINT_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(collapsed)) !== null) {
    refs.push({
      sourceFile,
      invocation: m[1] as "npx tsx" | "node",
      entrypoint: m[2],
    });
  }
  return refs;
}

// ── Filesystem walk ──────────────────────────────────────────────────────────

const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", "__tests__", "fixtures", "golden"]);

function walkFiles(
  root: string,
  dir: string,
  matches: (rel: string, name: string) => boolean,
  out: string[]
): void {
  const abs = path.join(root, dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIR_NAMES.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, rel, matches, out);
    } else if (matches(rel, entry.name)) {
      out.push(rel);
    }
  }
}

/**
 * The scan surface: every skills/​**​/*.md file (shipped SKILL.md + companion
 * docs) and every hooks/​**​/*.ts + hooks/​**​/*.sh source (excluding tests/
 * fixtures/dist/node_modules) — the two evidence locations issue #55 named
 * (the documenting skill body and the invoking hook source's own doc comments).
 */
function discoverScanTargets(root: string): string[] {
  const out: string[] = [];
  walkFiles(root, "skills", (_rel, name) => name.endsWith(".md"), out);
  walkFiles(
    root,
    "hooks",
    (_rel, name) => (name.endsWith(".ts") || name.endsWith(".sh")) && !name.endsWith(".test.ts"),
    out
  );
  return out.sort();
}

/** Only skills/​**​/*.md — the subset of {@link discoverScanTargets} that documents a real,
 * agent-invoked runtime dependency (as opposed to a hook's own "for dev/test, run this
 * directly from the checkout" header comment, which carries no packaging obligation). */
function discoverSkillScanTargets(root: string): string[] {
  const out: string[] = [];
  walkFiles(root, "skills", (_rel, name) => name.endsWith(".md"), out);
  return out.sort();
}

/** Every documented hooks/ entrypoint reference found across the scan surface. */
export function collectAllEntrypointRefs(pluginRoot: string): EntrypointRef[] {
  const refs: EntrypointRef[] = [];
  for (const rel of discoverScanTargets(pluginRoot)) {
    const content = fs.readFileSync(path.join(pluginRoot, rel), "utf8");
    refs.push(...extractEntrypointRefs(content, rel));
  }
  return refs;
}

/**
 * Every documented hooks/ entrypoint reference found in skills/​**​/*.md only.
 * This is the packaging-obligation surface: a skill body is what an agent
 * actually executes at runtime against an INSTALLED package, so an entrypoint
 * it documents must exist in every rendered host package. A hook source's own
 * "npx tsx hooks/self.ts" dev/test comment (checked only by
 * {@link findMissingEntrypoints} for plain existence) carries no such
 * obligation — it is a plugin-developer convenience run from the checkout.
 */
export function collectSkillEntrypointRefs(pluginRoot: string): EntrypointRef[] {
  const refs: EntrypointRef[] = [];
  for (const rel of discoverSkillScanTargets(pluginRoot)) {
    const content = fs.readFileSync(path.join(pluginRoot, rel), "utf8");
    refs.push(...extractEntrypointRefs(content, rel));
  }
  return refs;
}

// ── Check 1: SOURCE_MISSING (the reference resolves to nothing anywhere) ────

/**
 * Scan every discovered file for documented hooks/ entrypoint references and
 * return the ones whose target does not exist ANYWHERE in the source tree.
 */
export function findMissingEntrypoints(pluginRoot: string): MissingEntrypoint[] {
  const missing: MissingEntrypoint[] = [];
  for (const ref of collectAllEntrypointRefs(pluginRoot)) {
    const resolvedPath = path.join(pluginRoot, ref.entrypoint);
    if (!fs.existsSync(resolvedPath)) {
      missing.push({ ...ref, resolvedPath });
    }
  }
  return missing;
}

// ── Check 2: PACKAGE_MISSING (exists in source, but a rendered package omits it) ──

/** Pure check: which of `entrypoints` (repo-relative paths) are absent under `renderedRoot`. */
export function findMissingInRenderedTree(entrypoints: readonly string[], renderedRoot: string): string[] {
  return entrypoints.filter((e) => !fs.existsSync(path.join(renderedRoot, e)));
}

type HostRenderFn = (
  root: string,
  inv: GuildInventoryV1,
  distRoot: string,
  generatedAt: string
) => string;

/**
 * Every host-package renderer that ships the Guild skill tree (and therefore
 * must ship any standalone hook CLI entrypoint a skill body documents). One
 * entry per scripts/build-host-packages.ts writer, incl. the 4 wrapped-CLI
 * hosts sharing writeNewCliTree.
 */
const HOST_RENDERERS: ReadonlyArray<{ host: string; render: HostRenderFn }> = [
  { host: "claude-code", render: writeClaudeTree },
  { host: "codex", render: writeCodexTree },
  { host: "agents", render: writeAgentsTree },
  { host: "pi", render: writePiTree },
  { host: "antigravity", render: writeAntigravityTree },
  { host: "cursor", render: (root, inv, dist, at) => writeNewCliTree(root, inv, dist, at, "cursor") },
  { host: "github-copilot", render: (root, inv, dist, at) => writeNewCliTree(root, inv, dist, at, "github-copilot") },
  { host: "opencode", render: (root, inv, dist, at) => writeNewCliTree(root, inv, dist, at, "opencode") },
  { host: "rovo-dev", render: (root, inv, dist, at) => writeNewCliTree(root, inv, dist, at, "rovo-dev") },
];

/** Every host id {@link checkHostPackages} checks — pinned so a test can assert the
 * exact set, catching a future edit that silently shrinks (or forgets to grow) it. */
export const ALL_CHECKED_HOST_IDS: readonly string[] = [
  ...HOST_RENDERERS.map((r) => r.host),
  "codex-marketplace",
];

/** A directory looks like a real, buildable plugin root (vs. a synthetic unit-test fixture). */
export function looksLikeRealPluginRoot(root: string): boolean {
  return (
    fs.existsSync(path.join(root, ".claude-plugin", "plugin.json")) &&
    fs.existsSync(path.join(root, "scripts", "build-host-packages.ts")) &&
    fs.existsSync(path.join(root, "scripts", "build-inventory.ts"))
  );
}

/**
 * Render every host package into a fresh temp directory and check whether each
 * of `entrypoints` (repo-relative paths) is present in that rendered tree. A
 * host whose renderer throws (e.g. a required-file guard tripped) is reported
 * via `renderError` rather than crashing the whole rail.
 *
 * Also renders the Codex MARKETPLACE wrapper (`writeCodexMarketplaceTree`), a
 * DISTINCT installable artifact (`codex-marketplace/plugins/guild/**`) that
 * wraps an already-rendered Codex tree — the canonical host-package verifier
 * treats it as its own surface, so a regression in the wrapper's copy step
 * (independent of the 9 direct trees) must be caught too.
 */
export function checkHostPackages(pluginRoot: string, entrypoints: readonly string[]): HostPackageCheck[] {
  if (entrypoints.length === 0) return [];
  const inv = buildInventory(pluginRoot, UNSTAMPED_GENERATED_AT);
  const results: HostPackageCheck[] = [];
  const tmpRootsToClean: string[] = [];
  let codexDest: string | undefined;

  try {
    for (const { host, render } of HOST_RENDERERS) {
      const tmpDistRoot = fs.mkdtempSync(path.join(os.tmpdir(), `guild-entrypoint-rail-${host}-`));
      tmpRootsToClean.push(tmpDistRoot);
      try {
        const dest = render(pluginRoot, inv, tmpDistRoot, UNSTAMPED_GENERATED_AT);
        results.push({ host, missing: findMissingInRenderedTree(entrypoints, dest) });
        // codex's dest must survive past this loop — the marketplace wrapper below
        // copies it wholesale, so its temp root is cleaned up in the outer `finally`.
        if (host === "codex") codexDest = dest;
      } catch (e) {
        results.push({ host, missing: [], renderError: e instanceof Error ? e.message : String(e) });
      }
    }

    const marketplaceTmpRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "guild-entrypoint-rail-codex-marketplace-")
    );
    tmpRootsToClean.push(marketplaceTmpRoot);
    try {
      if (codexDest === undefined) {
        throw new Error("codex tree failed to render — cannot wrap it into the marketplace package");
      }
      const marketplaceDest = writeCodexMarketplaceTree(codexDest, marketplaceTmpRoot);
      const nestedPluginRoot = path.join(marketplaceDest, "plugins", "guild");
      results.push({
        host: "codex-marketplace",
        missing: findMissingInRenderedTree(entrypoints, nestedPluginRoot),
      });
    } catch (e) {
      results.push({
        host: "codex-marketplace",
        missing: [],
        renderError: e instanceof Error ? e.message : String(e),
      });
    }

    return results;
  } finally {
    for (const tmpRoot of tmpRootsToClean) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────

interface CliArgs {
  pluginRoot: string;
  /** Explicit opt-in to skip the rendered host-package check (unit-test fixtures only). */
  sourceOnly: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const idx = args.indexOf("--cwd");
  const pluginRoot =
    idx !== -1 && args[idx + 1] ? path.resolve(args[idx + 1]) : path.resolve(__dirname, "..");
  return { pluginRoot, sourceOnly: args.includes("--source-only") };
}

if (require.main === module) {
  const { pluginRoot, sourceOnly } = parseArgs(process.argv.slice(2));
  const failures: string[] = [];

  const sourceMissing = findMissingEntrypoints(pluginRoot);
  for (const m of sourceMissing) {
    failures.push(
      `SOURCE_MISSING  ${m.sourceFile} references "${m.invocation} ... ${m.entrypoint}" ` +
        `but ${m.entrypoint} does not exist anywhere in the source tree`
    );
  }

  if (sourceOnly) {
    process.stderr.write("(--source-only: skipping the rendered host-package check)\n");
  } else if (looksLikeRealPluginRoot(pluginRoot)) {
    const entrypoints = [...new Set(collectSkillEntrypointRefs(pluginRoot).map((r) => r.entrypoint))];
    for (const { host, missing, renderError } of checkHostPackages(pluginRoot, entrypoints)) {
      if (renderError) {
        failures.push(`PACKAGE_RENDER_FAILED  host "${host}" failed to render: ${renderError}`);
        continue;
      }
      for (const e of missing) {
        failures.push(`PACKAGE_MISSING  host "${host}" does not ship the documented entrypoint ${e}`);
      }
    }
  } else {
    // Fail CLOSED: an incomplete --cwd must not silently claim the package check ran.
    // Pass --source-only to intentionally opt into the reduced, source-tree-only check
    // (the escape hatch synthetic unit-test fixtures use).
    failures.push(
      `INCOMPLETE_PLUGIN_ROOT  --cwd (${pluginRoot}) is missing .claude-plugin/plugin.json, ` +
        `scripts/build-host-packages.ts, or scripts/build-inventory.ts, so the rendered ` +
        `host-package check cannot run. Pass --source-only to intentionally skip it.`
    );
  }

  if (failures.length === 0) {
    process.stdout.write(
      sourceOnly
        ? "✓ every npx tsx / node hooks/ entrypoint referenced by skills/ or hooks/ exists in source " +
            "(--source-only: rendered host-package check was NOT run)\n"
        : "✓ every npx tsx / node hooks/ entrypoint referenced by skills/ or hooks/ exists in source " +
            "and in every rendered host package\n"
    );
    process.exit(0);
  } else {
    process.stderr.write(`✗ ${failures.length} entrypoint packaging issue(s):\n\n`);
    for (const f of failures) {
      process.stderr.write(`  ${f}\n`);
    }
    process.stderr.write("\n");
    process.exit(1);
  }
}
