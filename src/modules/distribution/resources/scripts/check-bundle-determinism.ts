#!/usr/bin/env -S npx tsx
/**
 * scripts/check-bundle-determinism.ts
 *
 * CI regression rail for issue #75. The committed hook bundles must be a pure function
 * of hooks/ sources + hooks/package-lock.json — and of nothing else on the machine that
 * ran the build.
 *
 * ROOT CAUSE this rail guards (measured, not theorised). Two hook entrypoints bundle
 * first-party TypeScript from ../scripts/**:
 *
 *   detect-guild-version.ts      → ../scripts/dot-guild/convert/detect.js
 *   agent-team/task-completed.ts → ../../scripts/lib/artifact-bus
 *
 * Those scripts/ files carry bare package imports (`import * as yaml from "js-yaml"`),
 * and esbuild resolves a bare import from the IMPORTER's directory — plugin/scripts/,
 * not plugin/hooks/. So the js-yaml copy welded into those two bundles came from:
 *
 *   - plugin/scripts/node_modules/js-yaml (4.1.1, pinned by scripts/package-lock.json)
 *     whenever that sibling package happened to be installed; or
 *   - plugin/hooks/node_modules/js-yaml (4.3.0, pinned by hooks/package-lock.json)
 *     when it was not — reached through the build script's old `export
 *     NODE_PATH=node_modules` fallback.
 *
 * Identical sources and lockfile, two different committed bundles, selected by whether
 * an unrelated sibling package happened to be installed. This is NOT npm
 * nondeterminism: the resolution is perfectly deterministic, but one of its inputs was
 * the ambient filesystem. Exactly the two crossing entrypoints drifted; the other 18
 * bundles, which never leave hooks/, never did.
 *
 * THE FIX (hooks/package.json). Every esbuild invocation pins each declared hooks
 * runtime dependency with `--alias:<dep>=./node_modules/<dep>`, so a bare import
 * resolves out of THIS package's locked dependency closure regardless of which file
 * imported it. The NODE_PATH fallback is removed as well, since a second, ambient
 * resolution root is precisely the kind of hidden input this rail exists to forbid.
 *
 * Be precise about what that removal does and does not buy: it does NOT make an
 * unpinned bare import fail loudly in general. With plugin/scripts/node_modules
 * installed, ordinary importer-relative resolution still succeeds and still yields the
 * wrong (sibling) copy. The --alias pin is the actual fix; dropping NODE_PATH only
 * removes the second way the same bug could enter. That is exactly why check 2 below
 * exists — a NEW entrypoint added without the pin is invisible to check 1 on any
 * machine where the sibling package happens to be absent.
 *
 * CAVEAT on the pin mechanism. `--alias:<dep>=./node_modules/<dep>` names a DIRECTORY,
 * which bypasses the package's `exports` map and falls back to main/index.js. For
 * js-yaml (no `main`; exports {import: dist/js-yaml.mjs, require: index.js}) that
 * deliberately collapses the ESM and CJS copies onto one CJS instance — it removed a
 * duplicated js-yaml from five bundles and eliminates the dual-package identity hazard.
 * It is NOT automatically right for every future dependency: a package with
 * conditional exports or no root fallback may resolve differently, or fail to resolve
 * at all. When adding a hooks runtime dependency, verify what the alias resolves to
 * rather than assuming; a build failure here is fail-closed and wants a decision, not a
 * workaround.
 *
 * THE CHECKS.
 *   1. PROVENANCE (static, over the committed bundles). esbuild stamps every bundled
 *      module with a `// <path>` header relative to the build working directory. No
 *      committed bundle may carry a module whose path escapes the hooks package into a
 *      foreign node_modules. This is the literal fingerprint the defect left behind, and
 *      it generalises: it catches ANY dependency resolved from outside hooks/, not just
 *      js-yaml.
 *   2. BUILD CONFIG (static, over hooks/package.json). Every esbuild invocation must pin
 *      every declared hooks runtime dependency, and the build must not reintroduce the
 *      NODE_PATH fallback. This closes the hole where a NEW entrypoint is added without
 *      the pin — check 1 alone would only catch that on a machine where the sibling
 *      package happened to be installed.
 *
 * Rebuild-idempotence itself (committed bytes == a fresh esbuild) is enforced by the
 * R-DIST rail in tests/rearch/r-dist.ts, which replays the build script's own flags
 * rather than a hardcoded copy of them — so it can no longer drift from the real build.
 *
 * Usage:
 *   npx tsx scripts/check-bundle-determinism.ts [--cwd <path>]
 *
 * Options:
 *   --cwd <path>   (optional, default ".") Plugin repo root to scan.
 *
 * Exit codes:
 *   0  No violations found.
 *   1  One or more violations found; details written to stderr.
 *
 * Invariants:
 *   - Read-only. Never writes any file. Never runs a build. No network.
 *   - Deterministic given the same inputs.
 */

import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface Violation {
  /** Path relative to the scanned root (or a pseudo-path for config findings). */
  file: string;
  /** Human-readable description of what is wrong and how to fix it. */
  detail: string;
}

/** One fully-understood `esbuild <entry> <flags…> --outfile=<out>` invocation. */
export interface Invocation {
  entry: string;
  outfile: string;
  flags: string[];
  raw: string;
}

/**
 * The result of reading the build script. `unrecognized` is the important half: a
 * segment this parser cannot fully model is a HOLE, not a pass. Skipping it silently
 * would let an unchecked esbuild invocation (a `--outdir` form, an invocation behind a
 * shell variable, a second bundler) ride along unguarded.
 */
export interface BuildScriptParse {
  invocations: Invocation[];
  unrecognized: string[];
}

// ── Check 1: bundle provenance ────────────────────────────────────────────

/**
 * esbuild precedes each bundled module with a `// <prettyPath>` comment on its own
 * line, where <prettyPath> is the module's path relative to the build working
 * directory (hooks/).
 */
const MODULE_HEADER = /^\/\/ (\S+)$/gm;

/**
 * Module paths in `bundle` that were resolved from a node_modules tree OUTSIDE the
 * hooks package. A hooks-local dependency is stamped `node_modules/<pkg>/…`; anything
 * else that mentions node_modules (`../scripts/node_modules/…`, an absolute path, a
 * nested tree) came from somewhere the hooks lockfile does not control.
 *
 * Note this deliberately does NOT flag `../scripts/**` SOURCE modules: bundling
 * first-party TypeScript across packages is intended and fully deterministic — it is
 * version-controlled. Only third-party resolution is environment-coupled.
 */
export function findForeignModulePaths(bundle: string): string[] {
  const found = new Set<string>();
  for (const m of bundle.matchAll(MODULE_HEADER)) {
    const modulePath = m[1];
    if (!modulePath.includes("node_modules/")) continue;
    if (modulePath.startsWith("node_modules/")) continue; // hooks-local: correct
    found.add(modulePath);
  }
  return [...found].sort();
}

/**
 * How many module headers the provenance scan can actually see.
 *
 * findForeignModulePaths() reads esbuild's `// <path>` comments, so anything that
 * strips them (`--minify`, `--minify-whitespace`) would make it return [] for a bundle
 * that IS carrying foreign modules — a silently vacuous pass. The rail therefore
 * asserts its own precondition per bundle instead of trusting it.
 */
export function countModuleHeaders(bundle: string): number {
  return [...bundle.matchAll(MODULE_HEADER)].length;
}

/** A `require("…node_modules…")` left in emitted code — i.e. a dependency NOT bundled. */
const RUNTIME_NODE_MODULES_REQUIRE = /require\(\s*["'`]([^"'`]*node_modules\/[^"'`]*)["'`]\s*\)/g;

/**
 * Runtime requires that reach into a node_modules tree. A committed hook bundle is meant
 * to be self-contained: every dependency welded in, nothing resolved from disk at run
 * time. If a dependency is externalised instead of bundled, the provenance scan sees no
 * foreign module (there is no module at all) and passes — while the shipped hook quietly
 * depends on whatever happens to be installed next to it. This catches that at the
 * artifact level, whatever flag spelling produced it.
 */
export function findRuntimeNodeModulesRequires(bundle: string): string[] {
  const found = new Set<string>();
  for (const m of bundle.matchAll(RUNTIME_NODE_MODULES_REQUIRE)) found.add(m[1]);
  return [...found].sort();
}

/**
 * Bare `require("<dep>")` calls for a DECLARED dependency surviving in emitted code.
 *
 * The sibling of findRuntimeNodeModulesRequires(): where that catches an explicit path
 * into node_modules, this catches the plain package form left behind when a dependency
 * was not bundled at all. In correctly bundled esbuild output a dependency appears as an
 * inlined `require_<name>()` closure, never as a literal `require("<dep>")`, so any hit
 * here means the shipped hook is resolving that package from the ambient install tree.
 *
 * Only DECLARED dependencies are considered — `require("fs")` and other node builtins are
 * legitimately external in a --platform=node bundle.
 */
export function findExternalDependencyRequires(bundle: string, deps: string[]): string[] {
  const found = new Set<string>();
  for (const dep of deps) {
    const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`require\\(\\s*["'\`](${escaped}(?:/[^"'\`]*)?)["'\`]\\s*\\)`, "g");
    for (const m of bundle.matchAll(re)) found.add(m[1]);
  }
  return [...found].sort();
}

/** Committed bundle files, in stable order. */
export function committedBundles(hooksDir: string): string[] {
  const dirs = [path.join(hooksDir, "dist"), path.join(hooksDir, "agent-team", "dist")];
  const out: string[] = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (name.endsWith(".js")) out.push(path.join(dir, name));
    }
  }
  return out;
}

// ── Check 2: build configuration ──────────────────────────────────────────

/** Command separators. Splitting on only `&&` would let `; cmd` or `|| cmd` hide a build. */
const SEGMENT_SEPARATORS = /&&|\|\||;/;

/** A recognised segment is an esbuild command and nothing else — no wrapper, no prefix. */
const ANCHORED_ESBUILD = /^(?:npx\s+)?esbuild\s+/;

/**
 * Shell syntax that could hide a second command, a redirect, or an expansion inside what
 * otherwise looks like a plain invocation (`sh -c '…'`, `$(…)`, backticks, globs). The
 * real build script contains none of these, so rejecting them outright costs nothing and
 * removes the entire class of "the parser modelled the decoy, the shell ran something
 * else".
 */
const SHELL_METACHARACTER = /[`$(){}<>'"\\|&;*?[\]~#!]/;

/**
 * Read a shell build script into fully-understood esbuild invocations plus the segments
 * that could not be modelled.
 *
 * A segment is "understood" only when it IS an esbuild command (anchored, no shell
 * metacharacters), names exactly one entry, and writes exactly one `--outfile=`.
 * Everything else — a `--outdir=` form, an invocation behind a shell variable or a
 * `sh -c` wrapper, a second output, a non-esbuild command — lands in `unrecognized` so
 * the caller can FAIL rather than quietly check a subset of the build.
 */
export function parseBuildScript(buildScript: string): BuildScriptParse {
  const invocations: Invocation[] = [];
  const unrecognized: string[] = [];

  for (const raw of buildScript.split(SEGMENT_SEPARATORS).map((s) => s.trim())) {
    if (!raw) continue;

    // The command must BE an esbuild invocation, not merely contain the word somewhere
    // after arbitrary shell syntax.
    if (!ANCHORED_ESBUILD.test(raw) || SHELL_METACHARACTER.test(raw)) {
      unrecognized.push(raw);
      continue;
    }

    const tokens = raw.split(/\s+/).filter(Boolean);
    const rest = tokens.slice(tokens[0] === "npx" ? 2 : 1);
    const positionals = rest.filter((t) => !t.startsWith("-"));
    const flags = rest.filter((t) => t.startsWith("-"));
    const outFlags = flags.filter((f) => f.startsWith("--outfile="));
    if (positionals.length !== 1 || outFlags.length !== 1) {
      unrecognized.push(raw);
      continue;
    }
    invocations.push({
      entry: positionals[0],
      outfile: normalizeOutfile(outFlags[0].slice("--outfile=".length)),
      flags,
      raw,
    });
  }

  return { invocations, unrecognized };
}

/**
 * Canonical form of an --outfile target, so `./dist/a.js`, `dist/a.js` and `dist/./a.js`
 * compare equal against the on-disk bundle listing.
 */
export function normalizeOutfile(outfile: string): string {
  return path.posix.normalize(outfile.split(path.sep).join("/")).replace(/^\.\//, "");
}

/**
 * The fully-understood esbuild invocations only. Callers that need to know about
 * unmodelled segments (both rails do) must use parseBuildScript().
 */
export function parseEsbuildInvocations(buildScript: string): Invocation[] {
  return parseBuildScript(buildScript).invocations;
}

/** The pin that forces `dep` to resolve out of the hooks package's own closure. */
export function aliasFlagFor(dep: string): string {
  return `--alias:${dep}=./node_modules/${dep}`;
}

/**
 * Violations in the hooks build script itself: a NODE_PATH fallback (the ambient
 * resolution escape hatch that made the bundles environment-dependent), an
 * unparseable script, or any esbuild invocation that fails to pin a declared runtime
 * dependency.
 */
export function checkBuildScript(buildScript: string, runtimeDeps: string[]): Violation[] {
  const out: Violation[] = [];

  if (/\bNODE_PATH\b/.test(buildScript)) {
    out.push({
      file: "hooks/package.json",
      detail:
        "build script sets NODE_PATH — an ambient resolution fallback. It silently " +
        "redirects a bare import that the normal walk failed to resolve, making the " +
        "bundled bytes depend on which sibling packages are installed (issue #75). " +
        `Pin the dependency with ${aliasFlagFor("<dep>")} instead and drop NODE_PATH.`,
    });
  }

  const { invocations, unrecognized } = parseBuildScript(buildScript);

  // A segment the parser cannot model is a HOLE, not a pass: an unchecked esbuild
  // invocation (a --outdir form, a second output, an invocation behind a shell
  // variable) would ride along completely unguarded while the remaining segments kept
  // the rail green.
  for (const seg of unrecognized) {
    out.push({
      file: "hooks/package.json",
      detail:
        `build segment is not a recognised single-entry/single---outfile esbuild ` +
        `invocation, so this rail cannot verify it: \`${seg.slice(0, 120)}\`. Either express it ` +
        "in the supported shape or extend parseBuildScript() (and R-DIST, which shares " +
        "this parse) to model it. Refusing to check only part of the build.",
    });
  }

  if (invocations.length === 0) {
    out.push({
      file: "hooks/package.json",
      detail:
        "no esbuild invocation could be parsed from the build script. This rail refuses " +
        "to pass vacuously over a build it cannot read — if the build was restructured, " +
        "update parseBuildScript() (and R-DIST, which shares this parse).",
    });
    return out;
  }

  if (runtimeDeps.length === 0) {
    out.push({
      file: "hooks/package.json",
      detail:
        "no runtime `dependencies` declared, so there is nothing to pin. If hooks bundles " +
        "a third-party package it must declare it, or the bundled copy is whatever the " +
        "ambient filesystem happened to offer.",
    });
    return out;
  }

  for (const inv of invocations) {
    // esbuild accepts a repeated --alias for the same package and the LAST one wins, so
    // a correct-looking pin can be silently overridden by a later bad one. Require
    // exactly one, with exactly the expected value.
    for (const dep of runtimeDeps) {
      const want = aliasFlagFor(dep);
      const given = inv.flags.filter((f) => f.startsWith(`--alias:${dep}=`));
      if (given.length === 1 && given[0] === want) continue;
      const why =
        given.length === 0
          ? `does not pin "${dep}"`
          : given.length > 1
            ? `pins "${dep}" ${given.length} times (esbuild takes the LAST: \`${given[given.length - 1]}\`)`
            : `pins "${dep}" to the wrong target (\`${given[0]}\`)`;
      out.push({
        file: `hooks/${inv.outfile || inv.entry}`,
        detail:
          `esbuild invocation for \`${inv.entry}\` ${why}: it must carry exactly \`${want}\`. ` +
          "Without it, a bare import reached through a bundled ../scripts/** module resolves " +
          "from that module's own directory, so the committed bytes depend on whether " +
          "plugin/scripts/node_modules happens to be installed (issue #75).",
      });
    }

    // Everything downstream assumes the output is a BUNDLE. Without --bundle esbuild
    // merely transpiles: no dependency is inlined, no module headers are emitted, and the
    // shipped hook is left resolving every import from disk at run time. (esbuild also
    // rejects --alias without --bundle outright, so this is belt-and-braces — but the
    // rail should state its own precondition rather than inherit it from a tool error.)
    if (!inv.flags.includes("--bundle")) {
      out.push({
        file: `hooks/${inv.outfile || inv.entry}`,
        detail:
          "is missing --bundle, so the output is transpiled rather than bundled — its " +
          "dependencies would resolve from the ambient install tree at run time, which is " +
          "the defect this rail exists to prevent.",
      });
    }

    // The provenance check reads esbuild's `// <path>` module headers. Minification
    // strips them, which would turn that check into a silent no-op.
    const minifiers = inv.flags.filter((f) => f.startsWith("--minify"));
    if (minifiers.length > 0) {
      out.push({
        file: `hooks/${inv.outfile || inv.entry}`,
        detail:
          `uses ${minifiers.join(" ")} — minification strips the \`// <path>\` module headers ` +
          "that the provenance check reads, so a foreign dependency would pass unnoticed. " +
          "Drop the minify flag, or replace the header scan with an esbuild --metafile analysis.",
      });
    }

    // Externalising a declared dependency removes it from the bundle entirely. The
    // provenance scan then finds no foreign module — because it finds no module at all —
    // while the shipped hook is left with a bare `require()` resolved against whatever
    // happens to sit next to it at runtime. That is the SAME defect class as #75, one
    // layer later, and it must not slip past a check whose whole premise is that the
    // dependency is welded in.
    if (inv.flags.includes("--packages=external")) {
      out.push({
        file: `hooks/${inv.outfile || inv.entry}`,
        detail:
          "uses --packages=external, which un-bundles every dependency. The committed hook " +
          "bundles must be self-contained; a runtime require() resolves against the install " +
          "tree, not the hooks lockfile.",
      });
    }
    for (const dep of runtimeDeps) {
      const externals = inv.flags.filter(
        (f) =>
          f.startsWith("--external:") &&
          new RegExp(`(^|/)${dep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`).test(
            f.slice("--external:".length),
          ),
      );
      if (externals.length === 0) continue;
      out.push({
        file: `hooks/${inv.outfile || inv.entry}`,
        detail:
          `externalises the declared dependency "${dep}" (${externals.join(" ")}) — it is then ` +
          "NOT bundled, so the provenance check has nothing to inspect and the shipped hook " +
          "resolves it at runtime from whatever is next to it on disk. Remove the --external.",
      });
    }
  }

  return out;
}

// ── Driver ────────────────────────────────────────────────────────────────

export function findViolations(root: string): Violation[] {
  const out: Violation[] = [];
  const hooksDir = path.join(root, "hooks");
  const pkgPath = path.join(hooksDir, "package.json");

  if (!fs.existsSync(pkgPath)) {
    return [{ file: "hooks/package.json", detail: "missing — cannot verify bundle determinism." }];
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const runtimeDeps = Object.keys(pkg.dependencies ?? {}).sort();
  out.push(...checkBuildScript(String(pkg.scripts?.build ?? ""), runtimeDeps));

  const bundles = committedBundles(hooksDir);
  if (bundles.length === 0) {
    out.push({
      file: "hooks/dist",
      detail: "no committed bundles found — nothing to verify (refusing to pass vacuously).",
    });
    return out;
  }

  // Every output the build produces must be a bundle this rail actually scans, and every
  // bundle it scans must have a producing invocation. Without this, an invocation writing
  // outside hooks/dist + hooks/agent-team/dist would simply never be provenance-checked.
  const scanned = new Set(
    bundles.map((b) => normalizeOutfile(path.relative(hooksDir, b))),
  );
  // Multiplicity is preserved deliberately: two invocations writing the SAME outfile is a
  // last-writer-wins race, not a duplicate to be deduped away.
  const producedList = parseEsbuildInvocations(String(pkg.scripts?.build ?? "")).map((i) => i.outfile);
  const produced = new Set(producedList);
  const producerCount = new Map<string, number>();
  for (const outfile of producedList) {
    producerCount.set(outfile, (producerCount.get(outfile) ?? 0) + 1);
  }
  for (const [outfile, count] of [...producerCount].sort()) {
    if (count > 1) {
      out.push({
        file: `hooks/${outfile}`,
        detail:
          `${count} esbuild invocations write this same bundle — the last one silently wins, ` +
          "so the committed bytes depend on invocation order rather than on a single source.",
      });
    }
    if (scanned.has(outfile)) continue;
    out.push({
      file: `hooks/${outfile}`,
      detail:
        "the build writes this bundle, but it is outside the directories this rail scans " +
        "(hooks/dist, hooks/agent-team/dist) — it would never be provenance-checked. " +
        "Either write it into a scanned directory or extend committedBundles().",
    });
  }
  for (const bundle of [...scanned].sort()) {
    if (produced.has(bundle)) continue;
    out.push({
      file: `hooks/${bundle}`,
      detail:
        "a committed bundle with no producing esbuild invocation in the build script — " +
        "it is stale output that `npm run build` no longer regenerates, so nothing keeps " +
        "it in sync with its source. Remove it or restore its build invocation.",
    });
  }

  for (const abs of bundles) {
    const text = fs.readFileSync(abs, "utf8");
    const rel = path.relative(root, abs);

    // Guard the provenance scan's own precondition before trusting its result.
    if (countModuleHeaders(text) === 0) {
      out.push({
        file: rel,
        detail:
          "carries no esbuild `// <path>` module headers, so the provenance scan cannot " +
          "see anything and would pass vacuously. Is the bundle minified, or built by " +
          "something other than esbuild?",
      });
      continue;
    }

    // A dependency that was externalised rather than bundled leaves no module for the
    // provenance scan to judge, so check for it explicitly.
    const runtimeRequires = [
      ...findRuntimeNodeModulesRequires(text),
      ...findExternalDependencyRequires(text, runtimeDeps),
    ].sort();
    if (runtimeRequires.length > 0) {
      out.push({
        file: rel,
        detail:
          `resolves ${runtimeRequires.length} dependency path(s) at RUNTIME instead of bundling ` +
          `them: ${runtimeRequires.slice(0, 3).join(", ")}${runtimeRequires.length > 3 ? ", …" : ""}. ` +
          "A committed hook bundle must be self-contained — a runtime require() resolves " +
          "against the install tree, not against hooks/package-lock.json.",
      });
    }

    const foreign = findForeignModulePaths(text);
    if (foreign.length === 0) continue;
    out.push({
      file: rel,
      detail:
        `bundles ${foreign.length} module(s) resolved from OUTSIDE the hooks package: ` +
        `${foreign.slice(0, 3).join(", ")}${foreign.length > 3 ? ", …" : ""}. ` +
        "The committed bytes therefore depend on which sibling packages were installed " +
        "when the build ran (issue #75). Pin the dependency in the hooks build script " +
        "and rebuild: `cd hooks && npm ci && npm run build`.",
    });
  }

  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { cwd: string } {
  let cwd = ".";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
  }
  return { cwd };
}

function main(): void {
  const { cwd: cwdArg } = parseArgs(process.argv.slice(2));
  const root = path.resolve(cwdArg);

  const violations = findViolations(root);

  if (violations.length === 0) {
    process.stdout.write(
      "[check-bundle-determinism] PASS — every committed hook bundle resolves its " +
        "dependencies from hooks/node_modules, and the build pins them explicitly.\n"
    );
    process.exit(0);
  }

  process.stderr.write(
    `[check-bundle-determinism] FAIL — ${violations.length} violation(s). The committed hook ` +
      `bundles must be a pure function of hooks/ sources + hooks/package-lock.json.\n\n`
  );
  for (const v of violations) {
    process.stderr.write(`  ${v.file}: ${v.detail}\n`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}
