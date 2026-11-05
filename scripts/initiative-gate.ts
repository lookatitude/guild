#!/usr/bin/env -S npx tsx
/**
 * scripts/initiative-gate.ts
 *
 * Deterministic CLI over the D8 initiative close gate
 * (docs/v2/initiatives.html §The D8 close gate).
 *
 * WHY THIS EXISTS: the 2026-07-12 plugin-implementation-audit (G3) found that
 * `/guild:initiative close` (commands/initiative.md) deferred ALL sub-verb
 * logic to an "initiative skill set" that did not exist, so the two deferred-
 * item functions that already implement the close gate —
 * `d8CloseGate` and `populateReleaseDocsWorkItems`
 * (scripts/lib/initiative.ts, scripts/lib/initiative-workitems.ts) — were
 * unreachable from any shipped path. This CLI is the deterministic bridge: it
 * reads an initiative's on-disk manifest, calls the REAL gate functions
 * (never re-derives the gate), and prints a machine-readable verdict. The
 * `guild:initiative` skill (skills/meta/initiative/SKILL.md) invokes this CLI
 * on `close` and refuses to close on a non-zero exit.
 *
 * No LLM. No network. Same inputs → same output every time.
 *
 * Usage:
 *   npx tsx scripts/initiative-gate.ts close-check --initiative <id> \
 *     [--root <cwd>] [--exec-verified=true|false]
 *
 *   npx tsx scripts/initiative-gate.ts docs-workitems --initiative <id> \
 *     [--root <cwd>] [--exec-verified=true|false]
 *
 * --initiative   Required. The initiative id (directory name under
 *                `.guild/initiatives/{active,archived}/<id>/`).
 * --root         Repo root `.guild/` is resolved under. Defaults to `.`
 *                (scripts/README.md §Flags convention).
 * --exec-verified
 *                Explicit `execVerified` input to `d8CloseGate` (the exec
 *                leg — "verify.md PASS for the contributing runs"). The gate
 *                function's own contract is explicit that this is SUPPLIED
 *                BY THE CALLER ("Pure function; the sub-verb supplies the run
 *                evidence" — src/domains/lifecycle/initiative.ts),
 *                never re-derived from heuristics here. Defaults to `false`
 *                (fail-closed) when omitted.
 *
 * close-check
 *   Locates `.guild/initiatives/{active,archived}/<id>/initiative.yaml`,
 *   reads the three D8 axes (execution_status, release_status,
 *   documentation_status), maps known legacy/loose manifest spellings onto
 *   the frozen closed-enum values (see `mapLegacyStatus` — a manifest value
 *   already accepted by the real repo corpus predates the v2 enum in places,
 *   e.g. `execution_status: in_progress` or `documentation_status: pending`;
 *   an UNRECOGNIZED value is treated as UNRESOLVED — fail closed — never
 *   guessed toward "resolved"), then calls `d8CloseGate`. It also binds the
 *   verdict to every path cited by `close_gate.evidence` and every work-item
 *   `evidence_refs` list; missing, malformed, absolute, or escaping refs fail
 *   closed. Prints `{ initiative_id, manifest_path, inputs, warnings, result,
 *   evidence, pass }` to stdout. Exit 0 pass, 1 fail (unmet criteria), 2
 *   usage/read error.
 *
 * docs-workitems
 *   Same manifest read + `d8CloseGate` call, then
 *   `populateReleaseDocsWorkItems(id, d8, documentation_status)`. Prints
 *   `{ initiative_id, manifest_path, warnings, result, work_items }` to
 *   stdout. Exit 0 (informational — use close-check for the pass/fail
 *   verdict), 2 usage/read error.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseYaml } from "./lib/frontmatter";
import {
  d8CloseGate,
  EXECUTION_STATUS,
  RELEASE_STATUS,
  DOCUMENTATION_STATUS,
  type ExecutionStatus,
  type ReleaseStatus,
  type DocumentationStatus,
  type D8Input,
  type D8Result,
} from "./lib/initiative";
import { populateReleaseDocsWorkItems, type WorkItem } from "./lib/initiative-workitems";
import { durableGuildDir } from "./lib/state/storage";
import { ensureStorageLayout } from "./lib/state/ensure-storage-layout";

export { loadInitiativeManifest, buildD8Input, checkInitiativeEvidenceRefs } from "../src/domains/lifecycle";
import { loadInitiativeManifest, buildD8Input, checkInitiativeEvidenceRefs, type InitiativeEvidenceCheck } from "../src/domains/lifecycle";

// ── Arg parsing ──────────────────────────────────────────────────────────────

export interface GateArgs {
  command: "close-check" | "docs-workitems";
  initiative: string;
  root: string;
  execVerified: boolean;
}

const USAGE = [
  "usage: initiative-gate.ts close-check --initiative <id> [--root <cwd>] [--exec-verified=true|false]",
  "       initiative-gate.ts docs-workitems --initiative <id> [--root <cwd>] [--exec-verified=true|false]",
].join("\n");

export function parseGateArgs(argv: string[]): GateArgs | { error: string } {
  const [command, ...rest] = argv;
  if (command !== "close-check" && command !== "docs-workitems") {
    return { error: `unknown or missing sub-command: ${command ?? "(none)"}\n${USAGE}` };
  }

  let initiative: string | undefined;
  let root = ".";
  let execVerified = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--initiative" && rest[i + 1] !== undefined) initiative = rest[++i];
    else if (arg.startsWith("--initiative=")) initiative = arg.slice("--initiative=".length);
    else if (arg === "--root" && rest[i + 1] !== undefined) root = rest[++i];
    else if (arg.startsWith("--root=")) root = arg.slice("--root=".length);
    else if (arg === "--exec-verified" && rest[i + 1] !== undefined) execVerified = rest[++i] === "true";
    else if (arg.startsWith("--exec-verified=")) execVerified = arg.slice("--exec-verified=".length) === "true";
    else return { error: `unknown argument: ${arg}\n${USAGE}` };
  }
  if (!initiative) return { error: `missing --initiative <id>\n${USAGE}` };

  return { command, initiative, root: path.resolve(root), execVerified };
}

// ── Sub-commands (pure given the manifest read) ─────────────────────────────

export interface CloseCheckOutput {
  initiative_id: string;
  manifest_path: string | null;
  inputs: D8Input;
  warnings: string[];
  result: D8Result;
  evidence: InitiativeEvidenceCheck;
  pass: boolean;
}

export function runCloseCheck(root: string, initiativeId: string, execVerified: boolean): CloseCheckOutput | { error: string } {
  const manifest = loadInitiativeManifest(root, initiativeId);
  if (manifest === null) {
    return { error: `no initiative.yaml found for "${initiativeId}" under ${path.join(durableGuildDir(root), "initiatives")}/{active,archived}/${initiativeId}/` };
  }
  const { input, warnings } = buildD8Input(manifest.raw, execVerified);
  const result = d8CloseGate(input);
  const evidence = checkInitiativeEvidenceRefs(root, path.dirname(manifest.path), manifest.raw);
  return {
    initiative_id: initiativeId,
    manifest_path: manifest.path,
    inputs: input,
    warnings,
    result,
    evidence,
    pass: result.canClose && evidence.valid,
  };
}

export interface DocsWorkitemsOutput {
  initiative_id: string;
  manifest_path: string | null;
  warnings: string[];
  result: D8Result;
  work_items: WorkItem[];
}

export function runDocsWorkitems(root: string, initiativeId: string, execVerified: boolean): DocsWorkitemsOutput | { error: string } {
  const manifest = loadInitiativeManifest(root, initiativeId);
  if (manifest === null) {
    return { error: `no initiative.yaml found for "${initiativeId}" under ${path.join(durableGuildDir(root), "initiatives")}/{active,archived}/${initiativeId}/` };
  }
  const { input, warnings } = buildD8Input(manifest.raw, execVerified);
  const result = d8CloseGate(input);
  const workItems = populateReleaseDocsWorkItems(initiativeId, result, input.documentation_status);
  return {
    initiative_id: initiativeId,
    manifest_path: manifest.path,
    warnings,
    result,
    work_items: workItems,
  };
}

// ── CLI entry ────────────────────────────────────────────────────────────────

function main(): number {
  ensureStorageLayout(process.cwd(), { detectOnly: true });
  const parsed = parseGateArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 2;
  }

  if (parsed.command === "close-check") {
    const out = runCloseCheck(parsed.root, parsed.initiative, parsed.execVerified);
    if ("error" in out) {
      process.stderr.write(`initiative-gate: ${out.error}\n`);
      return 2;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return out.pass ? 0 : 1;
  }

  const out = runDocsWorkitems(parsed.root, parsed.initiative, parsed.execVerified);
  if ("error" in out) {
    process.stderr.write(`initiative-gate: ${out.error}\n`);
    return 2;
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
