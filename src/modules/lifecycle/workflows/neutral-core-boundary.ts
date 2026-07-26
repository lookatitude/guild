/**
 * src/modules/lifecycle/workflows/neutral-core-boundary.ts
 *
 * The neutral core's self-check: is it still import-closed?
 *
 * MH-02 / W1 of `multi-host-runtime-convergence`. This file exists to make MH-02
 * acceptance 3 — "Core imports no host adapter, hook, wrapper, launcher,
 * PaneAdapter backend, benchmark, or website implementation" — a MECHANICAL
 * verdict instead of a claim in a receipt.
 *
 * WHY A MEMBERSHIP LIST, NOT A MODULE
 *   The `lifecycle` module as a whole is NOT host-neutral and cannot be: its
 *   existing `run-lifecycle.ts` legitimately imports `../../host-runtime` and
 *   `hooks/lib/security/scrubbed-write`. MH-02 therefore extracts a neutral core
 *   as an explicitly DECLARED file set inside the module rather than relabelling
 *   the module. `NEUTRAL_CORE_MEMBERS` is that declaration.
 *
 * WHY CLOSURE RATHER THAN A DENYLIST
 *   A denylist only proves the absence of the edges someone thought to forbid,
 *   and it proves nothing about TRANSITIVE reach. This evaluator instead requires
 *   that every specifier in every core file resolve to another declared core
 *   member. Since the core is closed under import, no direct OR transitive edge
 *   can leave it — including into a Node builtin, so the core cannot perform
 *   I/O, read a clock, or observe a host even accidentally. The forbidden-matcher
 *   list is kept as well, purely so a mistake fails with a NAMED boundary
 *   (`host_adapter`, `hook_implementation`, …) instead of a generic
 *   "unclassified".
 *
 * WHAT THIS IS NOT
 *   Repo-wide dependency-boundary enforcement across every module and consumer
 *   (MHRC-MOD-001..004) is W4/MH-07's dependency-graph tool. This evaluator is
 *   scoped to the MH-02 core and needs no graph of its own.
 *
 * PURITY
 *   `evaluateNeutralCoreBoundary` is a pure function of `{path, source}` records;
 *   it does not read the filesystem, which is what lets it be a core member and
 *   scan itself. The caller supplies the bytes.
 *
 * Pure library module; there is no CLI entrypoint.
 */

import { neutralFreeze, neutralOutcome } from "./neutral-runtime-contracts";
import type { NeutralOutcome } from "./neutral-runtime-contracts";

// ---------------------------------------------------------------------------
// Declared membership
// ---------------------------------------------------------------------------

/**
 * The host-neutral core, by file. Module-relative to
 * `src/modules/lifecycle/workflows/`. Adding a file here is the deliberate act
 * of putting it under the closure rule; the accompanying test fails if the
 * declaration and the supplied file set disagree in either direction.
 */
export const NEUTRAL_CORE_MEMBERS = [
  "neutral-runtime-contracts.ts",
  "neutral-gate-policy.ts",
  "neutral-lifecycle-machine.ts",
  "neutral-conformance-core.ts",
  "neutral-core-boundary.ts",
] as const;

export type NeutralCoreMember = (typeof NEUTRAL_CORE_MEMBERS)[number];

// ---------------------------------------------------------------------------
// Forbidden boundary classes
// ---------------------------------------------------------------------------

export interface NeutralForbiddenBoundaryMatcher {
  readonly id: string;
  readonly pattern: RegExp;
  readonly boundary: string;
}

/**
 * Named boundary classes the core must never reach. Patterns are built with
 * `new RegExp` from plain strings on purpose: a regex literal containing an
 * escaped slash would embed a `//` sequence in this file's own source, which is
 * needless noise in a file that gets read back as text by its own test.
 */
export const NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS: readonly NeutralForbiddenBoundaryMatcher[] =
  neutralFreeze([
    {
      id: "host_adapter",
      boundary: "host-adapters",
      pattern: new RegExp("(^|/)(host-runtime|host-adapter|host-adapters|[a-z0-9-]+-host-adapter)(/|$)"),
    },
    {
      id: "hook_implementation",
      boundary: "compatibility-shims",
      pattern: new RegExp("(^|/)hooks(/|$)"),
    },
    {
      id: "wrapper_or_launcher",
      boundary: "execution-transports",
      pattern: new RegExp("(launcher|wrapper|guild-run|agent-team|agent-bus)"),
    },
    {
      id: "execution_transport",
      boundary: "execution-transports",
      pattern: new RegExp("(pane-adapter|pane|tmux|remote-exec|process-exec|transport|dispatch)"),
    },
    {
      id: "benchmark_internals",
      boundary: "benchmark-internals",
      pattern: new RegExp("(^|/)(benchmark|benchmarks|evals)(/|$)"),
    },
    {
      id: "website_internals",
      boundary: "website-internals",
      pattern: new RegExp("(^|/)(website|site|docs-site)(/|$)"),
    },
    {
      id: "generated_mirror",
      boundary: "generated-projections",
      pattern: new RegExp("(^|/)(resources|dist)(/|$)"),
    },
    {
      id: "compatibility_shim",
      boundary: "compatibility-shims",
      pattern: new RegExp("(^|/)(scripts|shim|shims|compat)(/|$)"),
    },
    {
      id: "node_io_builtin",
      boundary: "node-runtime",
      pattern: new RegExp(
        "^(node:)?(fs|path|os|child_process|crypto|net|http|https|process|worker_threads|readline|tty|zlib|stream|url|util|module|vm|dns|cluster)$"
      ),
    },
  ]);

// ---------------------------------------------------------------------------
// Specifier extraction
// ---------------------------------------------------------------------------

/**
 * Static `import`/`export ... from` forms are matched only at a LINE START.
 * That is what keeps prose safe: this core's own comments say things like
 * "imports no host adapter", and a floating `from "…"` inside a comment would
 * otherwise be mistaken for an edge. Real module-scope statements always begin
 * at column zero, so anchoring is both sufficient and precise. Dynamic
 * `import()` and `require()` are matched anywhere, since they legitimately
 * appear inside expressions.
 */
const STATIC_SPECIFIER_RE = /^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
const BARE_IMPORT_RE = /^import\s+["']([^"']+)["']/gm;
const CALL_SPECIFIER_RE = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Every module specifier a source file references, de-duplicated, first-seen order. */
export function extractNeutralImportSpecifiers(source: string): string[] {
  const found: string[] = [];
  for (const regex of [STATIC_SPECIFIER_RE, BARE_IMPORT_RE, CALL_SPECIFIER_RE]) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      if (found.indexOf(match[1]) === -1) found.push(match[1]);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export interface NeutralCoreSourceFile {
  /** Module-relative filename, e.g. `neutral-lifecycle-machine.ts`. */
  readonly path: string;
  readonly source: string;
}

export interface NeutralCoreBoundaryEdge {
  readonly importer: string;
  readonly specifier: string;
  readonly matcher_id?: string;
  readonly boundary?: string;
}

function isIntraCoreSpecifier(specifier: string): boolean {
  if (specifier.charAt(0) !== ".") return false;
  const tail = specifier.replace(/^\.\//, "");
  if (tail.indexOf("/") !== -1) return false;
  const withExtension = tail.endsWith(".ts") ? tail : `${tail}.ts`;
  return (NEUTRAL_CORE_MEMBERS as readonly string[]).indexOf(withExtension) !== -1;
}

/**
 * Verdict on the core's import closure. Reason-code priority is
 * membership → forbidden → unclassified: a membership disagreement means the
 * scan was not looking at the declared core at all, so reporting edge findings
 * from it would be misleading.
 *
 * An UNCLASSIFIED destination fails rather than passes, mirroring the
 * MHRC-MOD-001 rule "unclassified destinations fail the verdict". A boundary
 * scan that silently ignores what it does not recognise proves nothing.
 */
export function evaluateNeutralCoreBoundary(
  files: readonly NeutralCoreSourceFile[]
): NeutralOutcome {
  const declared = NEUTRAL_CORE_MEMBERS as readonly string[];
  const suppliedPaths = files.map((file) => file.path);
  const missingMembers = declared.filter((member) => suppliedPaths.indexOf(member) === -1);
  const undeclaredFiles = suppliedPaths.filter((supplied) => declared.indexOf(supplied) === -1);

  const forbidden: NeutralCoreBoundaryEdge[] = [];
  const unclassified: NeutralCoreBoundaryEdge[] = [];
  const intraCore: NeutralCoreBoundaryEdge[] = [];

  for (const file of files) {
    for (const specifier of extractNeutralImportSpecifiers(file.source)) {
      const matcher = NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS.find((candidate) =>
        candidate.pattern.test(specifier)
      );
      if (matcher !== undefined) {
        forbidden.push({
          importer: file.path,
          specifier,
          matcher_id: matcher.id,
          boundary: matcher.boundary,
        });
        continue;
      }
      if (isIntraCoreSpecifier(specifier)) {
        intraCore.push({ importer: file.path, specifier });
        continue;
      }
      unclassified.push({ importer: file.path, specifier });
    }
  }

  const edgeCount = forbidden.length + unclassified.length + intraCore.length;
  const facts = {
    declared_members: [...declared],
    missing_members: missingMembers,
    undeclared_files: undeclaredFiles,
    node_count: suppliedPaths.length,
    edge_count: edgeCount,
    intra_core_edges: intraCore,
    forbidden_edges: forbidden,
    unclassified_edges: unclassified,
  };

  if (missingMembers.length > 0 || undeclaredFiles.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_membership_mismatch",
      assertions: [
        "the scanned file set must equal the declared core membership",
        "a partial scan cannot prove closure",
      ],
      facts,
    });
  }

  if (forbidden.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_forbidden_edge",
      assertions: [
        "no core-to-concrete dependency edge exists",
        "dynamic and re-export edges are included",
      ],
      facts,
    });
  }

  if (unclassified.length > 0) {
    return neutralOutcome({
      type: "guild.boundary_outcome.v1",
      disposition: "failed",
      reason_code: "boundary_unclassified_edge",
      assertions: [
        "unclassified destinations fail the verdict",
        "the core is closed under import: only declared members are reachable",
      ],
      facts,
    });
  }

  return neutralOutcome({
    type: "guild.boundary_outcome.v1",
    disposition: "succeeded",
    assertions: [
      "no core-to-concrete dependency edge exists",
      "dynamic and re-export edges are included",
      "the core is closed under import, so no transitive escape exists",
    ],
    facts,
  });
}
