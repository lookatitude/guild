#!/usr/bin/env -S npx tsx
/**
 * scripts/initiative-gate.ts
 *
 * Deterministic CLI over the D8 initiative close gate
 * (docs/v2/initiatives.md §The D8 close gate).
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
 *                evidence" — src/modules/initiatives/workflows/initiative.ts),
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
 *   guessed toward "resolved"), then calls `d8CloseGate`. Prints
 *   `{ initiative_id, manifest_path, inputs, warnings, result, pass }` to
 *   stdout. Exit 0 pass, 1 fail (unmet criteria), 2 usage/read error.
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

// ── Manifest lookup ──────────────────────────────────────────────────────────

export interface LoadedManifest {
  path: string;
  raw: Record<string, unknown>;
}

/**
 * Find + parse `.guild/initiatives/{active,archived}/<id>/initiative.yaml`.
 * Checks `active/` first, then `archived/` (a closed initiative's manifest
 * still lives there). Returns `null` when neither exists or the file does not
 * parse to an object carrying a top-level `initiative:` map.
 */
export function loadInitiativeManifest(root: string, id: string): LoadedManifest | null {
  for (const bucket of ["active", "archived"] as const) {
    const p = path.join(root, ".guild", "initiatives", bucket, id, "initiative.yaml");
    if (!fs.existsSync(p)) continue;
    let text: string;
    try {
      text = fs.readFileSync(p, "utf8");
    } catch {
      return null;
    }
    const parsed = parseYaml(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const inner = obj["initiative"];
    if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return null;
    return { path: p, raw: inner as Record<string, unknown> };
  }
  return null;
}

// ── Legacy status mapping (fail-closed on the unrecognized) ────────────────

/**
 * Known legacy/loose spellings seen in the real repo corpus, mapped onto the
 * frozen closed-enum values. Anything not listed here (and not already a
 * canonical value) is left UNMAPPED — the caller treats that leg as
 * unresolved rather than guessing.
 */
const EXECUTION_STATUS_ALIASES: Record<string, ExecutionStatus> = {
  in_progress: "active",
  "in-progress": "active",
  completed: "done",
  complete: "done",
};
const DOCUMENTATION_STATUS_ALIASES: Record<string, DocumentationStatus> = {
  pending: "update_required",
  "in-sync": "no_update_required",
  in_sync: "no_update_required",
  "not-assessed": "not_assessed",
  // real archived-corpus spelling (host-adapter-migration): docs shipped
  done: "updated",
};
const RELEASE_STATUS_ALIASES: Record<string, ReleaseStatus> = {
  // real archived-corpus spelling (settings-control-and-tmux)
  released_to_canon: "released",
  "released-to-canon": "released",
};

export interface MappedStatus<T extends string> {
  /** The canonical value, or null when the raw value could not be mapped. */
  value: T | null;
  warning?: string;
}

function mapStatus<T extends string>(
  field: string,
  raw: unknown,
  canonical: readonly T[],
  aliases: Record<string, T>,
): MappedStatus<T> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { value: null, warning: `${field}: missing — leg treated as unresolved` };
  }
  if ((canonical as readonly string[]).includes(raw)) return { value: raw as T };
  const aliased = aliases[raw];
  if (aliased !== undefined) {
    return {
      value: aliased,
      warning: `${field}: legacy value "${raw}" mapped to "${aliased}"`,
    };
  }
  return {
    value: null,
    warning: `${field}: unrecognized value "${raw}" (not in ${canonical.join("|")}) — leg treated as unresolved`,
  };
}

export interface BuiltD8Input {
  input: D8Input;
  warnings: string[];
}

/** Build the `D8Input` the real `d8CloseGate` consumes, from a raw manifest + supplied execVerified. */
export function buildD8Input(raw: Record<string, unknown>, execVerified: boolean): BuiltD8Input {
  const warnings: string[] = [];

  const exec = mapStatus("execution_status", raw["execution_status"], EXECUTION_STATUS, EXECUTION_STATUS_ALIASES);
  const release = mapStatus("release_status", raw["release_status"], RELEASE_STATUS, RELEASE_STATUS_ALIASES);
  const docs = mapStatus(
    "documentation_status",
    raw["documentation_status"],
    DOCUMENTATION_STATUS,
    DOCUMENTATION_STATUS_ALIASES,
  );
  for (const m of [exec, release, docs]) if (m.warning) warnings.push(m.warning);

  // A leg that failed to map has NO canonical resolved value — fall back to
  // the enum's least-resolved member so d8CloseGate sees it as unresolved
  // (never silently "not present" — the gate always receives a valid D8Input).
  const input: D8Input = {
    execVerified,
    execution_status: exec.value ?? "not_started",
    release_status: release.value ?? "not_released",
    documentation_status: docs.value ?? "not_assessed",
  };
  return { input, warnings };
}

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
  pass: boolean;
}

export function runCloseCheck(root: string, initiativeId: string, execVerified: boolean): CloseCheckOutput | { error: string } {
  const manifest = loadInitiativeManifest(root, initiativeId);
  if (manifest === null) {
    return { error: `no initiative.yaml found for "${initiativeId}" under ${path.join(root, ".guild", "initiatives")}/{active,archived}/${initiativeId}/` };
  }
  const { input, warnings } = buildD8Input(manifest.raw, execVerified);
  const result = d8CloseGate(input);
  return {
    initiative_id: initiativeId,
    manifest_path: manifest.path,
    inputs: input,
    warnings,
    result,
    pass: result.canClose,
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
    return { error: `no initiative.yaml found for "${initiativeId}" under ${path.join(root, ".guild", "initiatives")}/{active,archived}/${initiativeId}/` };
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
