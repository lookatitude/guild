/**
 * scripts/compile.ts — the ONE compile step (U2 / KTD6, KTD7, KTD10, KTD11, KTD29, KTD60).
 *
 * Three planes:
 *   P1  author — `bun run compile` (this file) on a maintainer machine.
 *   P2  CI     — `bun run compile --check` on `next` and `main`.
 *   P3  user   — plain `node` on the committed outputs. Never Bun, never `npx tsx`.
 *
 * Outputs (all committed; KTD7):
 *   hooks/dist/*.js              the 18 hook bundles
 *   hooks/agent-team/dist/*.js   the 3 agent-team bundles
 *   runtime/guild-mcp.js         ONE MCP binary, two D-MCP ids (wiki | trace) — KTD3
 *   runtime/scripts/*.js         the closed list of CLIs a user session spawns
 *   runtime/mcp-descriptions.pins.json
 *                                MCP tool-description pins, written by THIS step —
 *                                there is no separate pinning ritual (KTD60)
 *
 * `--check` recompiles every target into a scratch dir and byte-compares it with
 * the committed copy. Any drift is a non-zero exit naming the file: CI's R-DIST
 * rail and the author loop share one oracle.
 *
 * Determinism: every esbuild invocation runs with `absWorkingDir` pinned to the
 * plugin root and a repo-relative entry path, so the banner paths esbuild writes
 * into the bundle do not encode the checkout location or the scratch dir.
 *
 * CONTRACT: no network, no clock, no randomness in any emitted byte.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { LIBRARY, RUNTIME_USAGE } from "./runtime-usage";

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Target table — the single source of truth for what ships
// ---------------------------------------------------------------------------

export interface Target {
  /** Stable id used by --only and by --check diagnostics. */
  id: string;
  /** Entry file, repo-relative. */
  entry: string;
  /** Emitted file, repo-relative. */
  out: string;
  /** Directory whose node_modules supplies `js-yaml` for the esbuild alias. */
  yamlFrom?: string;
  /**
   * Repo-relative node_modules dirs for bare packages the entry cannot reach by
   * walking up (src/ has no node_modules). The MCP binary's SDK and zod live only
   * in the mcp-servers/* lockfiles CI installs.
   */
  nodePaths?: string[];
  /**
   * esbuild's `absWorkingDir`. Module header comments are written relative to it,
   * so it is part of the output bytes. Defaults to the repo root; only a target
   * whose committed copy was built from elsewhere overrides it.
   */
  absWorkingDir?: string;
  /** `--help` text a runtime script prints from its banner (#269). */
  usage?: string;
  group: "hooks" | "agent-team" | "mcp" | "scripts" | "conformance";
}

/** hooks/*.ts → hooks/dist/*.js. Was a 3,500-char one-liner in hooks/package.json. */
const HOOK_IDS = [
  "capture-telemetry",
  "maybe-reflect",
  "pre-tool-use",
  "pre-compact",
  "post-tool-use",
  "run-trace-start",
  "run-trace-close",
  "run-trace",
  "detect-guild-version",
  "update-check",
  "comms-format-lint",
  "learning-backstop",
  "emit-learning-checkpoint",
  "using-guild-bootstrap",
  "session-reanchor",
  "lean-lead-guard",
  "lifecycle-gate",
  "gate-outcome-writer",
];

const AGENT_TEAM_IDS = ["task-created", "task-completed", "teammate-idle"];

/**
 * CLIs a live user session spawns. Closed list — an entry here is a promise that
 * `node <out>` works with Bun absent from PATH (KTD10). Growing it is a design
 * decision, not a convenience: anything not listed must be reached through a hook
 * bundle or a domain function, never through `npx tsx`.
 */
const RUNTIME_SCRIPT_IDS: Array<{ id: string; entry: string }> = [
  // SessionStart, from hooks/bootstrap.sh — was `npx --yes tsx`, the single
  // slowest thing on the start path and the last tsx spawn a user could hit.
  { id: "write-host-capability", entry: "scripts/write-host-capability.ts" },
  // SessionStart marker read (KTD29). Stub until T07 lands the step chain.
  { id: "ensure-storage-layout", entry: "scripts/lib/state/ensure-storage-layout.ts" },
  // `/guild:maintain gc` — scratch janitor + report-only durable sweep (U-STOR).
  { id: "storage-gc", entry: "scripts/lib/state/storage-gc.ts" },
  // NOT a CLI. The cold half of the layout upgrade (U-UPG), required by a
  // non-analyzable specifier from `ensure-storage-layout.js` so the ≤50ms
  // SessionStart bundle carries the marker read and nothing else (KTD29).
  { id: "upgrade-chain", entry: "scripts/lib/state/upgrade-chain.ts" },
  // Product-loop intake router, named by using-guild. Compiled here so T03 can
  // repoint the skill body at `node` without a second build.
  { id: "classify-intake", entry: "scripts/lib/classify-intake.ts" },
  // Stop / SubagentStop: hooks/maybe-reflect.ts spawns this. Was `npx tsx`.
  { id: "trace-summarize", entry: "scripts/trace-summarize.ts" },
  // `/guild:maintain wiki revert <harvest_id>` — the guild.harvest_journal.v1
  // inverse (R54/KTD39). Compiled because an operator reaches for it exactly when
  // something went wrong, which is the worst moment to need a working tsx.
  { id: "wiki-revert", entry: "scripts/wiki-revert.ts" },
  // `guild:decisions` promotion: a staged decision candidate → wiki/decisions via
  // harvest, with the index.md / log.md entries (#220).
  { id: "wiki-promote", entry: "scripts/wiki-promote.ts" },
  // `/guild:maintain rollback <skill> [n]` — the compact-history walker (KTD48/R60).
  // Compiled for the same reason as wiki-revert: an operator reaches for rollback
  // exactly when something went wrong, which is the worst moment to need a working tsx.
  { id: "rollback-walker", entry: "scripts/rollback-walker.ts" },
  // `/guild:maintain evolve <id>` step 1 — records the pre-edit baseline hash and the
  // 10-step pipeline plan. No version tree is written (KTD48).
  { id: "evolve-loop", entry: "scripts/evolve-loop.ts" },
  // T0's work loop (KTD33/KTD41-44/KTD49/KTD53): bind the class cursor, route a
  // workflow decision, route an operator redirect (harvest on the third), write
  // the research packet. Named by the `/guild` command body.
  { id: "work-loop", entry: "scripts/work-loop.ts" },
  // Every script a `commands/*.md` body spawns today with `npx tsx`. Compiling
  // them here is T02's half of the fix; T04 owns swapping the command bodies to
  // `node "$GUILD_PLUGIN_ROOT/runtime/scripts/<id>.js"` (command bodies are that
  // lane's surface, not this one's).
  { id: "capability-adopt", entry: "scripts/capability-adopt.ts" },
  { id: "capability-profile", entry: "scripts/capability-profile.ts" },
  // NOT a CLI. The lazy evidence chunk `capability-profile.js` requires by a
  // run-time path so the migration-evidence chain stays out of the cheap
  // `status` bundle (KTD29). Dropping this entry breaks `capability-profile
  // baseline|emit` in a shipped package.
  { id: "capability-profile-evidence", entry: "scripts/lib/capability/capability-profile-evidence.ts" },
  { id: "config-cmd", entry: "scripts/config-cmd.ts" },
  { id: "dashboard-launch", entry: "scripts/dashboard-launch.ts" },
  { id: "migrate-guild", entry: "scripts/dot-guild/migrate-guild.ts" },
  { id: "initiative-gate", entry: "scripts/initiative-gate.ts" },
  { id: "config-ui-metadata", entry: "scripts/lib/config-ui-metadata.ts" },
  { id: "runstart-preflight", entry: "scripts/lib/runstart-preflight.ts" },
  { id: "settings-resolver", entry: "scripts/lib/settings-resolver.ts" },
  { id: "models-cmd", entry: "scripts/models-cmd.ts" },
  { id: "oq11-gate-check", entry: "scripts/oq11-gate-check.ts" },
  { id: "read-guild-config", entry: "scripts/read-guild-config.ts" },
  { id: "resume-lanes", entry: "scripts/resume-lanes.ts" },
  { id: "team-decide", entry: "scripts/team-decide.ts" },
  // T14 (KTD11/KTD28): every script a shipped surface spawns runs as compiled
  // Node, so a package ships these bundles and no domain TypeScript. Two are
  // libraries a skill `require`s for one validator (explore/define schema).
  { id: "agent-team-launcher", entry: "scripts/agent-team-launcher.ts" },
  { id: "analyze-runs", entry: "scripts/analyze-runs.ts" },
  { id: "analyze-structural", entry: "scripts/learn/analyze-structural.ts" },
  { id: "assign-layers", entry: "scripts/learn/assign-layers.ts" },
  { id: "audit-run-sinks", entry: "scripts/audit-run-sinks.ts" },
  { id: "build-tour", entry: "scripts/learn/build-tour.ts" },
  { id: "check-handoff-receipts", entry: "scripts/check-handoff-receipts.ts" },
  { id: "check-lane-liveness", entry: "scripts/check-lane-liveness.ts" },
  { id: "cost-gate", entry: "scripts/learn/cost-gate.ts" },
  { id: "define-schema", entry: "scripts/lib/define-schema.ts" },
  { id: "definition-ref-for-dispatch", entry: "scripts/definition-ref-for-dispatch.ts" },
  { id: "derive-domain", entry: "scripts/learn/derive-domain.ts" },
  { id: "diff-learn", entry: "scripts/learn/diff-learn.ts" },
  { id: "emit-loop-event", entry: "scripts/emit-loop-event.ts" },
  { id: "explore-schema", entry: "scripts/lib/explore-schema.ts" },
  { id: "feedback-triage", entry: "scripts/feedback-triage.ts" },
  { id: "guild-run", entry: "scripts/guild-run.ts" },
  { id: "ideation-min-build-cli", entry: "scripts/ideation-min-build-cli.ts" },
  { id: "ingest-similarity", entry: "scripts/lib/ingest-similarity.ts" },
  { id: "instantiate-template", entry: "scripts/instantiate-template.ts" },
  { id: "k-stage-staleness", entry: "scripts/learn/k-stage-staleness.ts" },
  { id: "kb-snapshot", entry: "scripts/lib/kb-snapshot.ts" },
  { id: "knowledge-links-builder", entry: "scripts/knowledge-links-builder.ts" },
  { id: "knowledge-links-traverse", entry: "scripts/knowledge-links-traverse.ts" },
  { id: "knowledge-orchestrator", entry: "scripts/learn/knowledge-orchestrator.ts" },
  { id: "learn-route", entry: "scripts/learn/learn-route.ts" },
  { id: "learn-scan", entry: "scripts/learn/scan.ts" },
  { id: "learn-staleness", entry: "scripts/learn/staleness.ts" },
  { id: "lint-context-bundle", entry: "scripts/lint-context-bundle.ts" },
  { id: "mark-lane-dead", entry: "scripts/mark-lane-dead.ts" },
  { id: "lane-receipt-wait", entry: "scripts/lane-receipt-wait.ts" },
  { id: "pane-send", entry: "scripts/pane-send.ts" },
  { id: "pane-dispatch-trace", entry: "scripts/lib/host/pane-dispatch-trace.ts" },
  { id: "recall", entry: "scripts/lib/recall.ts" },
  { id: "registry-rollup", entry: "scripts/registry-rollup.ts" },
  { id: "resolve-specialist-capability-scope", entry: "scripts/resolve-specialist-capability-scope.ts" },
  { id: "retention", entry: "scripts/lib/retention.ts" },
  { id: "roster-resolve", entry: "scripts/roster-resolve.ts" },
  // `/guild:maintain analyze` (C-CLI): the run-analysis CLI ships as compiled
  // Node at runtime/scripts/run-analysis.js — never tsx on the user path.
  { id: "run-analysis", entry: "scripts/run-analysis.ts" },
  // NOT CLIs. The lazy domain-barrel chunks (C04/KTD29): the cheap bundles reach
  // lifecycle / telemetry / adapters only through non-analyzable requires that
  // resolve these compiled siblings at run time, so the heavy graphs stay OUT of
  // the cheap entrypoints (config-cmd was 12 domains wide). Dropping one breaks
  // that call path in a shipped package (KTD10 fail-closed).
  { id: "lifecycle-api", entry: "src/domains/lifecycle/index.ts" },
  { id: "telemetry-api", entry: "src/domains/telemetry/index.ts" },
  { id: "adapters-api", entry: "src/adapters/index.ts" },
  { id: "run-lifecycle", entry: "scripts/lib/run-lifecycle.ts" },
  { id: "score-tier", entry: "scripts/score-tier.ts" },
  { id: "stamp-recall-importance", entry: "scripts/stamp-recall-importance.ts" },
  { id: "station-compose", entry: "scripts/station-compose.ts" },
  { id: "task-cell-audit", entry: "scripts/task-cell-audit.ts" },
  { id: "task-cell-team-result", entry: "scripts/task-cell-team-result.ts" },
  { id: "validate-graph", entry: "scripts/learn/validate-graph.ts" },
  { id: "verify-gate-pass", entry: "scripts/verify-gate-pass.ts" },
  { id: "wiki-lint-checks", entry: "scripts/wiki-lint-checks.ts" },
  { id: "workspace-detect", entry: "scripts/workspace/detect.ts" },
  { id: "workspace-federated-query", entry: "scripts/workspace/federated-query.ts" },
  { id: "workspace-promote-upstream", entry: "scripts/workspace/promote-upstream.ts" },
  { id: "workspace-write-manifest", entry: "scripts/workspace/write-manifest.ts" },
  { id: "write-knowledge-links", entry: "scripts/learn/write-knowledge-links.ts" },
  { id: "write-task-run", entry: "scripts/write-task-run.ts" },
];

/**
 * The single Guild MCP binary's authored entry (KTD3): the two D-MCP ids
 * (wiki | trace), the `--describe` pin oracle and the `--call` in-process
 * fallback. Nothing is generated.
 */
const MCP_ENTRY = "src/runtime/mcp.ts";
const MCP_OUT = "runtime/guild-mcp.js";
const PINS_OUT = "runtime/mcp-descriptions.pins.json";
/** Packages whose lockfiles supply the MCP binary's bare imports (sdk, zod, js-yaml). */
const MCP_DEPS = ["mcp-servers/guild-memory", "mcp-servers/guild-telemetry"];

export function targets(): Target[] {
  const t: Target[] = [];
  for (const id of HOOK_IDS) {
    t.push({ id: `hooks/${id}`, entry: `hooks/${id}.ts`, out: `hooks/dist/${id}.js`, yamlFrom: "hooks", group: "hooks" });
  }
  for (const id of AGENT_TEAM_IDS) {
    t.push({
      id: `agent-team/${id}`,
      entry: `hooks/agent-team/${id}.ts`,
      out: `hooks/agent-team/dist/${id}.js`,
      yamlFrom: "hooks",
      group: "agent-team",
    });
  }
  t.push({
    id: "mcp/guild-mcp",
    entry: MCP_ENTRY,
    out: MCP_OUT,
    yamlFrom: MCP_DEPS[0],
    nodePaths: MCP_DEPS.map((d) => `${d}/node_modules`),
    group: "mcp",
  });
  for (const s of RUNTIME_SCRIPT_IDS) {
    const usage = RUNTIME_USAGE[s.id];
    if (!usage) throw new Error(`runtime script "${s.id}" has no --help entry in scripts/runtime-usage.ts (#269)`);
    t.push({ id: `scripts/${s.id}`, entry: s.entry, out: `runtime/scripts/${s.id}.js`, yamlFrom: "scripts", usage, group: "scripts" });
  }
  // The activated-host conformance worker. It was built by its own esbuild target
  // in scripts/package.json with byte-identical options, which left it OUTSIDE
  // --check: editing anything it bundles drifted the shipped copy silently, and
  // only the conformance suite's own byte-identical assertion caught it (#241).
  t.push({
    id: "scripts/activated-host-conformance",
    entry: "scripts/activated-host-conformance.ts",
    out: "scripts/dist/activated-host-conformance.js",
    yamlFrom: "scripts",
    // absWorkingDir reproduces the scripts/-cwd npm build, whose module header
    // comments are cwd-relative and therefore part of the output bytes.
    absWorkingDir: "scripts",
    // NOT group "scripts": that group is the floor SC-2 derives for "compiled
    // bundles the host package ships" (tests/universal-host/_helpers.ts). This
    // worker is a conformance harness and ships in no package, so filing it
    // under "scripts" would demand a script_ref the package must never carry.
    group: "conformance",
  });
  return t;
}

// ---------------------------------------------------------------------------
// esbuild
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-var-requires */
const esbuild = require(path.join(ROOT, "scripts", "node_modules", "esbuild")) as typeof import("esbuild");

/**
 * Bundle bytes depend on the esbuild version, so a stale scripts/node_modules
 * silently produces a different committed surface than CI. That cost a full
 * debugging detour (#241): 0.27.7 was installed against a lockfile pinning
 * 0.28.2, and the ~87 drifted files read as platform-dependent output. The
 * lockfile is the pin; this makes the pin ENFORCED rather than merely declared.
 */
function assertLockedEsbuild(): void {
  const lockPath = path.join(ROOT, "scripts", "package-lock.json");
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  const locked = lock.packages?.["node_modules/esbuild"]?.version;
  if (!locked) throw new Error("scripts/package-lock.json does not pin esbuild");
  const loaded = (esbuild as unknown as { version: string }).version;
  if (loaded !== locked) {
    throw new Error(
      `esbuild ${loaded} is installed but scripts/package-lock.json pins ${locked}. ` +
        "Bundle bytes differ between versions, so this would drift every output. " +
        "Run `npm ci` in scripts/.",
    );
  }
}

/**
 * The esbuild `alias` map for one target. Exported because it IS the #75 fix:
 * every bundle must resolve `js-yaml` from its own package's `node_modules`, and
 * the determinism rail asserts that here now that the 3,500-char one-liner in
 * `hooks/package.json` is gone.
 */
export function aliasForTarget(t: Target): Record<string, string> {
  const alias: Record<string, string> = {};
  if (t.yamlFrom) alias["js-yaml"] = path.join(ROOT, t.yamlFrom, "node_modules", "js-yaml");
  return alias;
}

/**
 * The exact options object `buildOne` hands to esbuild. Exported so the
 * determinism suite asserts the alias on the REAL invocation path, not on a
 * helper that a refactor could disconnect from the build.
 */
export function buildOptionsForTarget(t: Target, outAbs: string): import("esbuild").BuildOptions {
  return {
    absWorkingDir: t.absWorkingDir ? path.join(ROOT, t.absWorkingDir) : ROOT,
    entryPoints: [t.absWorkingDir ? path.relative(t.absWorkingDir, t.entry) : t.entry],
    outfile: outAbs,
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    alias: aliasForTarget(t),
    nodePaths: (t.nodePaths ?? []).map((p) => path.join(ROOT, p)),
    logLevel: "silent",
    ...(t.usage ? { banner: { js: helpBanner(t) } } : {}),
  };
}

/**
 * Runs before every bundled module, so `--help` / `-h` can have no side effect
 * (#269). Only when the bundle is the main module: a library bundle required by
 * another CLI must not read that CLI's argv. Tokens after `--` are not flags.
 * TRAP: a literal `-h` / `--help` VALUE (`--message -h`) also prints usage.
 */
export function helpBanner(t: Target): string {
  const id = path.basename(t.out, ".js");
  const text =
    t.usage === LIBRARY
      ? `usage: none. runtime/scripts/${id}.js is a library bundle other runtime scripts require; it is not a CLI.\n`
      : `usage: node runtime/scripts/${id}.js ${t.usage}\n`;
  return (
    `if (require.main === module) { const a = process.argv.slice(2), e = a.indexOf("--"); ` +
    `if ((e < 0 ? a : a.slice(0, e)).some((x) => x === "--help" || x === "-h")) { ` +
    `require("fs").writeSync(1, ${JSON.stringify(text)}); process.exit(0); } }`
  );
}

/**
 * The ONE build path. Exported so a test asserting a shipped bundle is current
 * rebuilds it exactly as the compile does, instead of re-declaring the options
 * and drifting from them (that duplication is what hid the conformance bundle
 * from --check in the first place).
 */
export function buildOne(t: Target, outAbs: string): void {
  const options = buildOptionsForTarget(t, outAbs);
  const r = esbuild.buildSync({ ...options, metafile: true });
  if (r.errors.length) {
    throw new Error(`esbuild failed for ${t.id}:\n${r.errors.map((e) => e.text).join("\n")}`);
  }
  const bad = mainGuardViolations(t, options.absWorkingDir as string, Object.keys(r.metafile?.inputs ?? {}));
  if (bad.length) {
    throw new Error(
      `${t.id}: unguarded CLI main block in a bundled module (#274). esbuild inlines it, where ` +
        "`require.main === module` is true, so it runs on the bundle's argv. Gate it on the " +
        "entry basename, e.g. `require.main === module && /^<name>\\.[cm]?[jt]s$/.test(" +
        '(process.argv[1] ?? "").split(/[\\\\/]/).pop() ?? "")`:\n' +
        bad.map((b) => `  ${b}`).join("\n"),
    );
  }
  normalizeShebang(outAbs);
}

// ---------------------------------------------------------------------------
// CLI main-block guard (#274)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require(path.join(ROOT, "scripts", "node_modules", "typescript")) as typeof import("typescript");

/** The argv spellings a basename gate may test (whitespace removed). */
const ARGV_BASENAME_SHAPES: ReadonlySet<string> = new Set([
  "process.argv[1]",
  'process.argv[1]??""',
  '(process.argv[1]??"").split(/[\\\\/]/).pop()??""',
]);

interface MainBlock {
  line: number;
  guarded: boolean;
}

/**
 * Every `require.main === module` comparison in `src` (either operand order, `==`
 * too), parsed as TypeScript so comments and strings never count. A block is
 * guarded only when the comparison is a top-level `&&` conjunct of an `if`
 * condition that also has an un-negated `<regex>.test(<…process.argv[1]…>)`
 * conjunct whose regex accepts `<base>.ts` and rejects any other basename.
 * Anything else (`||`, `!`, a ternary, an assignment) fails closed.
 */
function mainBlocks(src: string, base: string, forbidden: readonly string[] = []): MainBlock[] {
  // Broad on purpose: `require . main` and `require["main"]` must still be parsed.
  if (!/\brequire\b/.test(src) || !/\bmain\b/.test(src)) return [];
  const sf = ts.createSourceFile("x.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: MainBlock[] = [];
  const unwrap = (n: import("typescript").Expression): import("typescript").Expression =>
    ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n;
  const conjuncts = (n: import("typescript").Expression): import("typescript").Expression[] => {
    const e = unwrap(n);
    return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ? [...conjuncts(e.left), ...conjuncts(e.right)]
      : [e];
  };
  const isRequire = (n: import("typescript").Node): boolean => ts.isIdentifier(n) && n.text === "require";
  const isRequireMain = (n: import("typescript").Node): boolean =>
    (ts.isPropertyAccessExpression(n) && n.name.text === "main" && isRequire(unwrap(n.expression))) ||
    (ts.isElementAccessExpression(n) &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      n.argumentExpression.text === "main" &&
      isRequire(unwrap(n.expression)));
  const isModule = (n: import("typescript").Node): boolean => ts.isIdentifier(n) && n.text === "module";
  const isMainCompare = (n: import("typescript").Node): boolean => {
    if (!ts.isBinaryExpression(n)) return false;
    const k = n.operatorToken.kind;
    if (k !== ts.SyntaxKind.EqualsEqualsEqualsToken && k !== ts.SyntaxKind.EqualsEqualsToken) return false;
    const l = unwrap(n.left);
    const r = unwrap(n.right);
    return (isRequireMain(l) && isModule(r)) || (isModule(l) && isRequireMain(r));
  };
  const acceptsOnlyBase = (re: RegExp): boolean => {
    const own = [`${base}.ts`, `/p/${base}.ts`, `${base}.js`, `/p/${base}.js`].some((x) => re.test(x));
    const other = ["other.js", "/p/other.js", `/p/x${base}.js`, `/p/${base}x.js`, `x${base}.ts`, ...forbidden]
      .flatMap((x) => [x, `/p/${x}`])
      .some((x) => re.test(x));
    return own && !other;
  };
  const isBasenameTest = (n: import("typescript").Expression): boolean => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "test") return false;
    if (n.arguments.length !== 1 || !ARGV_BASENAME_SHAPES.has(n.arguments[0].getText(sf).replace(/\s+/g, ""))) return false;
    const target = unwrap(n.expression.expression);
    let re: RegExp | undefined;
    try {
      if (ts.isRegularExpressionLiteral(target)) {
        const t = target.text;
        re = new RegExp(t.slice(1, t.lastIndexOf("/")), t.slice(t.lastIndexOf("/") + 1));
      } else if (
        ts.isNewExpression(target) &&
        ts.isIdentifier(target.expression) &&
        target.expression.text === "RegExp" &&
        target.arguments?.length === 1 &&
        ts.isStringLiteralLike(target.arguments[0])
      ) {
        re = new RegExp(target.arguments[0].text);
      }
    } catch {
      return false;
    }
    return re !== undefined && acceptsOnlyBase(re);
  };
  const visit = (n: import("typescript").Node): void => {
    // Every `require.main` reference counts, so `!==`, `!(...)` or an alias fails
    // closed; only `require.main === module` inside a guarded `if` can pass.
    if (isRequireMain(n)) {
      let cmp: import("typescript").Node = n;
      while (cmp.parent && ts.isParenthesizedExpression(cmp.parent)) cmp = cmp.parent;
      const compare = cmp.parent && isMainCompare(cmp.parent) ? cmp.parent : undefined;
      let guarded = false;
      let p: import("typescript").Node = compare ?? n;
      while (p.parent && (ts.isParenthesizedExpression(p.parent) || (ts.isBinaryExpression(p.parent) && p.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken))) {
        p = p.parent;
      }
      if (compare && p.parent && ts.isIfStatement(p.parent) && p.parent.expression === p) {
        guarded = conjuncts(p as import("typescript").Expression).some(isBasenameTest);
      }
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, guarded });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * 1-based lines of the main blocks in `src` that are not basename-guarded (see
 * mainBlocks). `forbidden` names basenames the guard must reject; the compile
 * passes every shipped bundle name, so a guard that also matches one fails.
 */
export function unguardedMainBlocks(src: string, base: string, forbidden: readonly string[] = []): number[] {
  return mainBlocks(src, base, forbidden).filter((b) => !b.guarded).map((b) => b.line);
}

/** Every output basename the compile ships (`trace-summarize.js`, …). */
function shippedBasenames(): string[] {
  return [...new Set(targets().map((x) => path.basename(x.out)))];
}

/**
 * Violations for one target, from esbuild's metafile inputs. A non-entry module's
 * main block must be basename-guarded. A guarded entry must be guarded on the name
 * it ships as, or its own CLI never runs from `runtime/scripts/<id>.js`.
 */
export function mainGuardViolations(t: Target, absWorkingDir: string, inputs: string[]): string[] {
  const entryAbs = path.join(ROOT, t.entry);
  const outBase = path.basename(t.out).replace(/\.[cm]?js$/, "");
  const bad: string[] = [];
  const shipped = shippedBasenames();
  for (const input of inputs) {
    const abs = path.resolve(absWorkingDir, input);
    if (abs.split(path.sep).includes("node_modules") || !/\.[cm]?[jt]s$/.test(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const base = path.basename(abs).replace(/\.[cm]?[jt]s$/, "");
    const rel = path.relative(ROOT, abs);
    const forbidden = shipped.filter((x) => x !== `${base}.js`);
    if (abs !== entryAbs) {
      for (const line of unguardedMainBlocks(src, base, forbidden)) bad.push(`${rel}:${line}`);
    } else if (base !== outBase && mainBlocks(src, base, forbidden).some((b) => b.guarded)) {
      bad.push(`${rel}: entry guarded on "${base}" but ships as ${t.out}`);
    }
  }
  return bad;
}

/**
 * esbuild copies the ENTRY's shebang to the top of the bundle, so every committed
 * `.js` inherited `#!/usr/bin/env -S npx tsx` from its TypeScript source — and the
 * bundles are mode 0755. `node hooks/dist/x.js` was always fine, but executing the
 * bundle directly would have run `npx tsx` on it: a real `npx` on the user path
 * (KTD10/KTD11), reachable on a cold cache. Rewrite it to `node`.
 */
function normalizeShebang(outAbs: string): void {
  const src = fs.readFileSync(outAbs, "utf8");
  if (!src.startsWith("#!")) return;
  const nl = src.indexOf("\n");
  const first = src.slice(0, nl);
  if (!/\b(npx|tsx|bun)\b/.test(first)) return;
  fs.writeFileSync(outAbs, `#!/usr/bin/env node${src.slice(nl)}`);
}

// ---------------------------------------------------------------------------
// MCP description pins (KTD60)
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Run the freshly built binary's `--describe` and hash each description with the
 * same function PreToolUse uses (hooks/lib/security/mcp-hash-pin.ts hashDescription).
 * Keys are the bare tool name: the host prefix (`mcp__guild-memory__`,
 * `mcp__plugin_guild_guild-memory__`, …) varies by host and install shape, and the
 * bare names are unique across Guild's two servers.
 */
function writePins(binaryAbs: string, pinsAbs: string): void {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const raw = execFileSync(process.execPath, [binaryAbs, "--describe"], { encoding: "utf8" });
  const described = JSON.parse(raw) as Record<string, { server: string; tools: Record<string, string> }>;
  // Keyed by SERVER, never by bare tool name: a pin must never bind to a tool of
  // the same name on a server that did not declare it (codex G-lane r1).
  const servers: Record<string, { mcp_id: string; tools: Record<string, string> }> = {};
  for (const id of Object.keys(described).sort()) {
    const entry = described[id];
    if (servers[entry.server]) throw new Error(`two D-MCP ids share server "${entry.server}"`);
    const tools: Record<string, string> = {};
    for (const name of Object.keys(entry.tools).sort()) tools[name] = sha256(entry.tools[name]);
    servers[entry.server] = { mcp_id: id, tools };
  }
  const doc = {
    schema_version: "guild.mcp_description_pins.v2",
    generated_by: "scripts/compile.ts",
    binary: MCP_OUT,
    // Verified by PreToolUse at pin load: pins describe THIS binary and no other.
    binary_sha256: sha256(fs.readFileSync(binaryAbs, "utf8")),
    servers,
  };
  fs.mkdirSync(path.dirname(pinsAbs), { recursive: true });
  fs.writeFileSync(pinsAbs, JSON.stringify(doc, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function compileAll(outRoot: string, only?: string): string[] {
  const written: string[] = [];
  for (const t of targets()) {
    if (only && t.group !== only) continue;
    const outAbs = path.join(outRoot, t.out);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    buildOne(t, outAbs);
    written.push(t.out);
  }
  if (!only || only === "mcp") {
    writePins(path.join(outRoot, MCP_OUT), path.join(outRoot, PINS_OUT));
    written.push(PINS_OUT);
  }
  return written;
}

/** Every directory the compile OWNS: nothing else may live under them (KTD7/KTD9). */
const OWNED_OUTPUT_ROOTS = ["hooks/dist", "hooks/agent-team/dist", "runtime", "scripts/dist"];

/** Every committed file under the owned roots, repo-relative. */
function committedOutputs(): string[] {
  const out: string[] = [];
  const walk = (absDir: string, rel: string): void => {
    if (!fs.existsSync(absDir)) return;
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(absDir, e.name), r);
      else out.push(r);
    }
  };
  for (const root of OWNED_OUTPUT_ROOTS) walk(path.join(ROOT, root), root);
  return out.sort();
}

/**
 * Files the target table no longer produces but that are still committed. A target
 * removed from the table used to leave its stale bundle shipping and unchecked —
 * `--check` only ever compared the outputs it had just written, so a deleted target
 * was invisible. Also catches a hand-dropped file under a compile-owned directory.
 */
function strayOutputs(expected: string[]): string[] {
  const known = new Set(expected);
  return committedOutputs().filter((f) => !known.has(f));
}

const GROUPS = ["hooks", "agent-team", "mcp", "scripts", "conformance"];

function main(argv: string[]): number {
  assertLockedEsbuild();
  const check = argv.includes("--check");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : undefined;

  // An unknown --only used to select zero targets and exit 0 — a typo in a build
  // script read as a green compile.
  if (only !== undefined && !GROUPS.includes(only)) {
    process.stderr.write(
      `compile: unknown --only=${only}. Valid groups: ${GROUPS.join(", ")}.\n`,
    );
    return 2;
  }

  if (!check) {
    const written = compileAll(ROOT, only);
    process.stdout.write(`compile — ${written.length} outputs\n`);
    for (const w of written) process.stdout.write(`  ${w}\n`);
    return 0;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-compile-check-"));
  try {
    const written = compileAll(scratch, only);
    const drift: string[] = [];
    const missing: string[] = [];
    for (const rel of written) {
      const committed = path.join(ROOT, rel);
      if (!fs.existsSync(committed)) {
        missing.push(rel);
        continue;
      }
      const a = fs.readFileSync(committed);
      const b = fs.readFileSync(path.join(scratch, rel));
      if (!a.equals(b)) drift.push(rel);
    }
    // Completeness is only meaningful over the WHOLE table: a --only run knows
    // nothing about the groups it skipped, so it must not judge them stray.
    const stray = only ? [] : strayOutputs(written);
    if (missing.length === 0 && drift.length === 0 && stray.length === 0) {
      process.stdout.write(
        `compile --check — ${written.length} outputs match a fresh compile; ` +
          `no stray files under ${OWNED_OUTPUT_ROOTS.join(", ")}\n`,
      );
      return 0;
    }
    for (const m of missing) process.stdout.write(`MISSING  ${m} — committed output absent (KTD7)\n`);
    for (const d of drift) process.stdout.write(`DRIFT    ${d} — committed bytes differ from a fresh compile\n`);
    for (const x of stray) {
      process.stdout.write(`STRAY    ${x} — committed under a compile-owned directory but produced by no target\n`);
    }
    process.stdout.write(
      `compile --check FAILED — ${missing.length} missing, ${drift.length} drifted, ` +
        `${stray.length} stray. Run \`bun run compile\`, or delete the stray file.\n`,
    );
    return 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`compile: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  }
}
