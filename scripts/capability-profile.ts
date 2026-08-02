#!/usr/bin/env -S npx tsx
/**
 * scripts/capability-profile.ts
 *
 * CLI for the capability-profile surface — the entrypoint a real Learn run and a
 * real `/guild:status` invocation call, so both are exercising production code
 * rather than a test-only path (conformance rule 3: exercise the REAL path).
 *
 * Sub-commands
 *   hash-tree    print the three tree hashes a profile's `mutation_evidence` carries
 *   emit         emit `guild.project_capability_profile.v1` for a run (report-only)
 *   candidates   print the F7 candidate surface (READ-ONLY — what /guild:status shows)
 *
 * WHY `hash-tree` IS A SHIPPED SUB-COMMAND AND NOT A TEST HELPER
 *
 * Assertion A1.7 requires a REAL Learn run whose profile hashes match hashes
 * computed INDEPENDENTLY by a shell. If the only way to compute them were the
 * emitter itself, the two sides of that comparison would be the same code and the
 * assertion would be circular. `hash-tree` prints the recipe's result for a tree,
 * and `docs/`-free shell (`find | sort | shasum`) reproduces it — two paths, one
 * number, a real cross-check.
 *
 * Usage
 *   npx tsx scripts/capability-profile.ts hash-tree  --cwd <root> [--json] [--for-run <run-id>]
 *   npx tsx scripts/capability-profile.ts emit       --cwd <root> --run-id <id>
 *                                                    --project-id <id> --generated-at <rfc3339>
 *                                                    [--facts <file.json>] [--source-commit <sha>]
 *                                                    [--resolver-mode <mode>] [--budget <n>]
 *                                                    [--baseline <run-start hash-tree --json output>]
 *   npx tsx scripts/capability-profile.ts candidates --cwd <root> [--json]
 *
 * Exit codes
 *   0  success (for `emit`: a profile was written; for `candidates`: always, it is a report)
 *   1  refusal or bad input; the reason goes to stderr as a typed code
 *
 * Invariants
 *   - `hash-tree` and `candidates` write NOTHING.
 *   - `emit` writes exactly one file, under `.guild/runs/<run-id>/capability/`, and
 *     only after the context-manager contract allows the path.
 *   - Deterministic: no clock (`--generated-at` is required), no network.
 */

import * as fs from "fs";
import * as path from "path";

import {
  renderCandidateSection,
  surfaceCapabilityCandidates,
} from "./lib/capability/candidate-surface";
import {
  HASHED_REGISTRIES,
  HASHED_TREES,
  TREE_HASH_RECIPE,
  baselineBinding,
  emitCapabilityProfile,
  snapshotTreeHashes,
  type DerivedFacts,
} from "./lib/capability/profile-emit";
import {
  CAPABILITY_RESOLVER_MODES,
  type CapabilityResolverMode,
} from "../src/modules/config/workflows/config-defaults";
import { DEFAULT_SUGGESTION_BUDGET } from "./lib/core/contracts/project-capability-profile";

// ── arg parsing ──────────────────────────────────────────────────────────────

/**
 * Read `--<name> <value>`, distinguishing ABSENT from PRESENT-BUT-EMPTY.
 *
 * CODEX-REVIEW FIX (round 2, finding 6). The previous version returned `null` for
 * both, so `emit --baseline --resolver-mode observe` was indistinguishable from
 * omitting `--baseline` entirely: the flag was silently dropped and the run
 * emitted with the NARROW window — the exact silent downgrade the baseline
 * comment says must be a refusal. Same shape for `--facts`, `--budget`,
 * `--resolver-mode` and `--source-commit`.
 *
 * The two states are now distinct, and the caller must handle both.
 */
type FlagRead =
  | { state: "absent" }
  | { state: "missing_value" }
  | { state: "value"; value: string };

function readFlag(argv: string[], name: string): FlagRead {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return { state: "absent" };
  if (i + 1 >= argv.length) return { state: "missing_value" };
  const value = argv[i + 1];
  if (value.startsWith("--")) return { state: "missing_value" };
  return { state: "value", value };
}

/**
 * `readFlag` with the missing-value case turned into a hard failure. This is the
 * form every caller wants: a flag typed without its value is an operator mistake,
 * never a request for the default.
 */
function flag(argv: string[], name: string): string | null {
  const r = readFlag(argv, name);
  if (r.state === "missing_value") fail("missing_value", `--${name} was given without a value`);
  return r.state === "value" ? r.value : null;
}

/**
 * A non-negative integer, in the ONE spelling a count has.
 *
 * `Number()` would accept `"1e3"`, `"0x10"`, `" 4 "`, `"Infinity"` and `""` — five
 * ways to write a budget that no operator meant to write, each silently becoming
 * a different number than the text suggests. Same reject-don't-normalize rule the
 * contracts follow.
 */
function parseCount(raw: string): number | null {
  if (!/^(0|[1-9][0-9]{0,4})$/.test(raw)) return null;
  return Number(raw);
}

function has(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function fail(code: string, detail: string): never {
  process.stderr.write(`capability-profile: ${code}: ${detail}\n`);
  process.exit(1);
}

/**
 * An EMPTY derived-fact set. Used when `--facts` is omitted.
 *
 * Empty is the honest default, not a placeholder: a profile with no facts and no
 * candidates is a valid, meaningful report ("Learn ran, proposed nothing"), and it
 * is exactly what the empty-project conformance row (B1) expects. Inventing
 * plausible facts to fill the shape would be the "invented professions" failure
 * the whole design guards against.
 */
const EMPTY_FACTS: DerivedFacts = {
  domains: [],
  boundaries: [],
  repeated_methods: [],
  coverage: { covered: [], uncovered: [], unmatched_roles: [] },
  candidates: [],
};

function readFacts(file: string | null): DerivedFacts {
  if (file === null) return EMPTY_FACTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail("bad_facts_file", `${file}: ${String(e)}`);
  }
  // Shape is NOT patched up here. Anything malformed flows into the emitter and
  // is rejected by S1's validator — one gate, not two disagreeing ones.
  return parsed as DerivedFacts;
}

// ── sub-commands ─────────────────────────────────────────────────────────────

function cmdHashTree(argv: string[]): void {
  const root = path.resolve(flag(argv, "cwd") ?? process.cwd());
  const h = snapshotTreeHashes(root);
  if (h === null) fail("hash_incomplete", "the agents/skills/registry trees could not be hashed");
  if (has(argv, "json")) {
    // `--for-run` produces a BOUND baseline the emitter will accept. Without it
    // the JSON is informational only — the emitter rejects an unbound baseline
    // rather than silently treating it as a run-start capture.
    const forRun = flag(argv, "for-run");
    const binding = baselineBinding(root);
    const payload =
      forRun === null || binding === null
        ? h
        : { ...h, bound_root: binding, bound_run_id: forRun };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`recipe: ${TREE_HASH_RECIPE}\n`);
  process.stdout.write(`${HASHED_TREES[0]}  ${h.agents}\n`);
  process.stdout.write(`${HASHED_TREES[1]}  ${h.skills}\n`);
  process.stdout.write(`${HASHED_REGISTRIES.join(" + ")}  ${h.registries}\n`);
}

function cmdEmit(argv: string[]): void {
  const root = path.resolve(flag(argv, "cwd") ?? process.cwd());
  const runId = flag(argv, "run-id");
  const projectId = flag(argv, "project-id");
  const generatedAt = flag(argv, "generated-at");
  if (runId === null) fail("missing_arg", "--run-id is required");
  if (projectId === null) fail("missing_arg", "--project-id is required");
  // No clock in this tool by design: a caller-supplied timestamp keeps a replayed
  // run byte-identical to the original.
  if (generatedAt === null) fail("missing_arg", "--generated-at is required (RFC3339 UTC)");

  const modeRaw = flag(argv, "resolver-mode") ?? "observe";
  if (!(CAPABILITY_RESOLVER_MODES as readonly string[]).includes(modeRaw)) {
    fail("bad_resolver_mode", `"${modeRaw}" is not one of ${CAPABILITY_RESOLVER_MODES.join("|")}`);
  }
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? DEFAULT_SUGGESTION_BUDGET : parseCount(budgetRaw);
  if (budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);

  // `--baseline <file>` carries the run-start `hash-tree --json` output, widening
  // the no-mutation window from the emission to the WHOLE Learn run. Parsed here,
  // VALIDATED by the emitter (one gate, not two): a malformed baseline must be a
  // refusal, never a silent fall-back to the narrow window — that would quietly
  // downgrade the claim the profile makes.
  const baselineFile = flag(argv, "baseline");
  let baselineHashes: unknown;
  if (baselineFile !== null) {
    try {
      baselineHashes = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
    } catch (e) {
      fail("bad_baseline_file", `${baselineFile}: ${String(e)}`);
    }
  }

  const result = emitCapabilityProfile({
    projectRoot: root,
    runId,
    projectId,
    generatedAt,
    sourceCommit: flag(argv, "source-commit"),
    resolverMode: modeRaw as CapabilityResolverMode,
    suggestionBudget: budget,
    facts: readFacts(flag(argv, "facts")),
    ...(baselineFile === null ? {} : { baselineHashes: baselineHashes as never }),
  });

  if (result.status === "refused") {
    fail(result.code, result.detail);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "emitted",
        rel_path: result.rel_path,
        mutation_performed: result.profile.mutation_performed,
        mutation_window: result.profile.mutation_window,
        hashes: result.hashes,
        candidates: result.profile.candidates.length,
        feedstock_absent: result.profile.feedstock.absent,
      },
      null,
      2
    )}\n`
  );
}

function cmdCandidates(argv: string[]): void {
  const root = path.resolve(flag(argv, "cwd") ?? process.cwd());
  const budgetRaw = flag(argv, "budget");
  const budget = budgetRaw === null ? undefined : parseCount(budgetRaw);
  if (budgetRaw !== null && budget === null) fail("bad_budget", `"${budgetRaw}" is not a count`);
  const surface = surfaceCapabilityCandidates(root, { suggestionBudget: budget ?? undefined });
  if (has(argv, "json")) {
    process.stdout.write(`${JSON.stringify(surface, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderCandidateSection(surface)}\n`);
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const [, , sub, ...argv] = process.argv;
  switch (sub) {
    case "hash-tree":
      return cmdHashTree(argv);
    case "emit":
      return cmdEmit(argv);
    case "candidates":
      return cmdCandidates(argv);
    default:
      fail("unknown_subcommand", `expected hash-tree|emit|candidates, got "${sub ?? ""}"`);
  }
}

if (require.main === module) main();
