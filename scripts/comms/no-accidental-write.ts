/**
 * scripts/comms/no-accidental-write.ts
 *
 * Usage: node scripts/comms/no-accidental-write.ts [--paths <file,...>]
 *        [--diff-range <base>...<head>]
 *
 * U7 — AC-6 negative gate for the communication-format-standardization initiative.
 *
 * This is the GUARD, not a freeze. It fails (exit non-zero) when a comms-format
 * changeset accidentally mutates the FORMAT or SCHEMA of any protected surface.
 * Legitimate changes to these files via OTHER initiatives are allowed — only
 * format/schema violations within a checked diff are flagged.
 *
 * Protected surfaces (per communication-format-policy.md §"Invariants / non-goals"):
 *   (1) .guild/settings.json      — must stay JSON; required top-level keys stable
 *   (2) .guild/workspace.json     — must stay JSON; schema_version required
 *   (3) provenance JSON           — .guild/runs/<id>/provenance.json; must stay JSON,
 *                                   schema_version = "guild.provenance.v1" required
 *   (4) trace JSONL               — logs/*.jsonl, events.ndjson; each line must be
 *                                   valid JSON object with required fields
 *   (5) docs/knowledge frontmatter— YAML frontmatter convention; required key-set stable
 *
 * What constitutes a VIOLATION:
 *   - settings.json / workspace.json: file is NOT valid JSON, OR all required keys absent
 *   - provenance.json: file is NOT valid JSON, OR schema_version absent/wrong value
 *   - trace JSONL: any non-blank line is NOT valid JSON, OR missing required fields (ts, event)
 *   - docs/knowledge .md: frontmatter cannot be parsed as YAML, OR missing required keys
 *
 * What is NOT a violation:
 *   - Adding new optional keys to settings.json or workspace.json
 *   - Adding new optional fields to provenance.json or trace lines
 *   - Adding new docs/knowledge pages (check only fires on pages in the diff
 *     that already have frontmatter and miss required keys)
 *   - Changing any of these files via a non-comms-format changeset (scope is
 *     the passed paths/diff-range, not a repo-wide freeze)
 *
 * Exported interface:
 *   export type ProtectedSurface
 *   export interface AccidentalWriteViolation { surface, file, message }
 *   export interface AccidentalWriteResult { violations, hasViolations }
 *   export function checkAccidentalWrite(opts): AccidentalWriteResult
 *   export const SETTINGS_JSON_REQUIRED_KEYS: readonly string[]
 *   export const WORKSPACE_JSON_REQUIRED_KEYS: readonly string[]
 *   export const PROVENANCE_JSON_REQUIRED_KEYS: readonly string[]
 *   export const TRACE_JSONL_REQUIRED_KEYS: readonly string[]
 *   export const DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS: readonly string[]
 *
 * YAML parsing discipline (OD-3): this file reads docs/knowledge frontmatter
 * using js-yaml (the shared parser). No hand-rolled YAML parsing.
 *
 * CLI entry: scripts/comms/no-accidental-write.cli.ts
 * Policy ref: docs/knowledge/decisions/communication-format-policy.md
 * Owner: tooling-engineer.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

// ── Protected surface discriminator ───────────────────────────────────────

/**
 * The five protected surfaces this guard knows about.
 * Each value is the human-readable label used in violation messages.
 */
export type ProtectedSurface =
  | "settings.json"
  | "workspace.json"
  | "provenance.json"
  | "trace.jsonl"
  | "docs/knowledge frontmatter";

// ── Schema-snapshot constants — the pinned shapes ─────────────────────────
//
// These are the required key-sets for each protected surface. A test fails if
// any of these arrays is modified, ensuring CI catches shape drift.
//
// Required = must be present for the file to be considered "format-correct".
// Optional keys are allowed; extra unknown keys do not cause violations.

/**
 * Required top-level keys in .guild/settings.json (category 1 — user config, JSON).
 * Pinned from live settings.json at workspace root on 2026-06-03.
 * A settings.json in the diff that contains NONE of these keys has drifted;
 * a partial config with at least one is accepted (users may omit optional keys).
 */
export const SETTINGS_JSON_REQUIRED_KEYS: readonly string[] = [
  "rigor",
  "auto_approve",
  "review",
  "host",
  "agent_mode",
  "defaults",
];

/**
 * The full known top-level settings.json key-set (mirrors read-guild-config.ts TIER1).
 * settings.json is user-extensible and all keys are OPTIONAL, so the guard does NOT
 * require every key (a minimal config is valid). Instead it fails on an UNKNOWN
 * top-level key — a restructure/corruption signal that this comms-format changeset
 * must never introduce. Keys starting with "_" (e.g. _help/_docs annotations) are
 * always allowed. New legitimate keys must be added here on purpose — that addition
 * is itself a deliberate schema-change checkpoint.
 */
export const SETTINGS_JSON_KNOWN_KEYS: ReadonlySet<string> = new Set([
  "rigor", "auto_approve", "review", "host", "initiative_default",
  "index", "record_status_runs", "codex_skip_enforcement", "agent_mode", "workspace", "models",
  "security", "secrets_policy", "mcp",
  "loops", "loop_cap", "codex_cap", "defaults",
]);

/**
 * Required keys in .guild/workspace.json (category 4 — machine-only state, JSON).
 * schema_version = "guild.workspace.v1" is the canonical discriminator.
 */
export const WORKSPACE_JSON_REQUIRED_KEYS: readonly string[] = [
  "schema_version",
];

/**
 * Required keys in .guild/runs/<id>/provenance.json (category 4 — machine-only, JSON).
 * schema_version must equal "guild.provenance.v1".
 */
export const PROVENANCE_JSON_REQUIRED_KEYS: readonly string[] = [
  "schema_version",
  "run_id",
];

/**
 * Required fields on every non-blank line of a trace JSONL file (category 5 — JSONL).
 * ts = ISO timestamp; event = event type name.
 */
export const TRACE_JSONL_REQUIRED_KEYS: readonly string[] = [
  "ts",
  "event",
];

/**
 * Required frontmatter keys in docs/knowledge .md files (category 2 — Markdown + YAML).
 * Pinned from communication-format-policy.md frontmatter on 2026-06-03.
 * A page that has frontmatter (starts with ---) must carry all of these.
 */
export const DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS: readonly string[] = [
  "type",
  "owner",
  "created_at",
  "updated_at",
  "sensitivity",
];

// ── Known provenance schema_version values ────────────────────────────────

const KNOWN_PROVENANCE_SCHEMA_VERSIONS: ReadonlySet<string> = new Set([
  "guild.provenance.v1",
]);

// ── Types ─────────────────────────────────────────────────────────────────

/** A single violation of a protected surface. */
export interface AccidentalWriteViolation {
  /** Which protected surface was breached. */
  surface: ProtectedSurface;
  /** Absolute path to the file that contains the violation. */
  file: string;
  /** Human-readable explanation of what is wrong. */
  message: string;
  /** Line number within the file (1-based), if applicable. */
  line?: number;
}

/** Result returned by checkAccidentalWrite. */
export interface AccidentalWriteResult {
  /** All violations found. Empty array = clean. */
  violations: AccidentalWriteViolation[];
  /** True if any violation was found (convenience shorthand for violations.length > 0). */
  hasViolations: boolean;
}

/** Options for checkAccidentalWrite. */
export interface AccidentalWriteOpts {
  /**
   * Explicit list of changed file paths to check (OD-4 arm 1 — diff range resolved externally).
   * Absolute paths preferred; relative paths are resolved against process.cwd().
   */
  paths?: string[];
  /**
   * Git diff range (e.g. "abc123...def456"). When provided, changed paths are
   * resolved via `git diff --name-only <range>`. Merged with `paths` if both given.
   */
  diffRange?: string;
}

// ── Path classification helpers ───────────────────────────────────────────

function normPath(p: string): string {
  return path.normalize(p).replace(/\\/g, "/");
}

/** True if the file path is .guild/settings.json (any repo root). */
function isSettingsJson(filePath: string): boolean {
  const n = normPath(filePath);
  return n.endsWith("/.guild/settings.json") || n === ".guild/settings.json";
}

/** True if the file path is .guild/workspace.json (any repo root). */
function isWorkspaceJson(filePath: string): boolean {
  const n = normPath(filePath);
  return n.endsWith("/.guild/workspace.json") || n === ".guild/workspace.json";
}

/** True if the file path is a provenance.json under .guild/runs/<id>/. */
function isProvenanceJson(filePath: string): boolean {
  const n = normPath(filePath);
  return /\/\.guild\/runs\/[^/]+\/provenance\.json$/.test(n) ||
    /^\.guild\/runs\/[^/]+\/provenance\.json$/.test(n);
}

/** True if the file path is a trace JSONL (.jsonl or events.ndjson). */
/**
 * True if the path is a real RUNTIME trace surface: a .jsonl or events.ndjson
 * under a `.guild/runs/<id>/` directory (optionally in a logs/ subdir). Scoped to
 * the actual trace surface so arbitrary .jsonl files elsewhere (and test fixtures —
 * see isExemptFixture) are not falsely frozen.
 */
function isTraceJsonl(filePath: string): boolean {
  const n = normPath(filePath);
  if (!n.endsWith(".jsonl") && !n.endsWith("events.ndjson")) return false;
  return /(?:^|\/)\.guild\/runs\/[^/]+\/(?:logs\/)?[^/]+\.(?:jsonl)$/.test(n) ||
    /(?:^|\/)\.guild\/runs\/[^/]+\/(?:logs\/)?events\.ndjson$/.test(n);
}

/**
 * Fixture / legacy-example exemption (OD-4): paths containing "legacy-example" or
 * under a tests fixtures tree are point-in-time fixtures, not live protected
 * surfaces — a benign edit to them must not be frozen by this guard.
 */
function isExemptFixture(filePath: string): boolean {
  const n = normPath(filePath);
  return n.includes("legacy-example") ||
    /(?:^|\/)tests?\//.test(n) ||
    n.includes("/fixtures/") ||
    n.includes("/__tests__/");
}

/** True if the file path is a .md under docs/knowledge/. */
function isDocsKnowledgeMd(filePath: string): boolean {
  const n = normPath(filePath);
  return (n.includes("/docs/knowledge/") || n.startsWith("docs/knowledge/")) &&
    n.endsWith(".md");
}

// ── Surface checkers ──────────────────────────────────────────────────────

function checkSettingsJson(filePath: string, content: string): AccidentalWriteViolation[] {
  // Must be valid JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [{
      surface: "settings.json",
      file: filePath,
      message:
        ".guild/settings.json is not valid JSON — this initiative must not convert " +
        "it away from JSON (communication-format-policy category 1: user config stays JSON)",
    }];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [{
      surface: "settings.json",
      file: filePath,
      message:
        ".guild/settings.json must be a JSON object at the top level — got non-object value",
    }];
  }

  const obj = parsed as Record<string, unknown>;

  // settings.json keys are all OPTIONAL (a minimal user config is valid), so the
  // guard does NOT require any specific key. It fails on a RESTRUCTURE signal:
  // any UNKNOWN top-level key (not in the known schema, not an "_"-annotation) means
  // the changeset reshaped the settings surface — which this initiative must not do.
  const unknownKeys = Object.keys(obj).filter(
    (k) => !k.startsWith("_") && !SETTINGS_JSON_KNOWN_KEYS.has(k)
  );
  if (unknownKeys.length > 0) {
    return [{
      surface: "settings.json",
      file: filePath,
      message:
        `.guild/settings.json has unknown top-level key(s) [${unknownKeys.join(", ")}] — ` +
        "the settings schema must not be restructured by a comms-format changeset " +
        "(communication-format-policy category 1: user config stays JSON, schema unchanged)",
    }];
  }

  return [];
}

function checkWorkspaceJson(filePath: string, content: string): AccidentalWriteViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [{
      surface: "workspace.json",
      file: filePath,
      message:
        ".guild/workspace.json is not valid JSON — this initiative must not convert " +
        "it away from JSON (communication-format-policy category 4: machine-only state stays JSON)",
    }];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [{
      surface: "workspace.json",
      file: filePath,
      message:
        ".guild/workspace.json must be a JSON object at the top level — got non-object value",
    }];
  }

  const obj = parsed as Record<string, unknown>;
  const violations: AccidentalWriteViolation[] = [];

  for (const key of WORKSPACE_JSON_REQUIRED_KEYS) {
    if (!(key in obj)) {
      violations.push({
        surface: "workspace.json",
        file: filePath,
        message:
          `.guild/workspace.json is missing required key "${key}" — ` +
          "the workspace schema must not be restructured by a comms-format changeset",
      });
    }
  }

  return violations;
}

function checkProvenanceJson(filePath: string, content: string): AccidentalWriteViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [{
      surface: "provenance.json",
      file: filePath,
      message:
        "provenance.json is not valid JSON — this initiative must not alter the " +
        "machine-only provenance format (communication-format-policy category 4)",
    }];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [{
      surface: "provenance.json",
      file: filePath,
      message: "provenance.json must be a JSON object at the top level",
    }];
  }

  const obj = parsed as Record<string, unknown>;
  const violations: AccidentalWriteViolation[] = [];

  // Check required keys
  for (const key of PROVENANCE_JSON_REQUIRED_KEYS) {
    if (!(key in obj)) {
      violations.push({
        surface: "provenance.json",
        file: filePath,
        message:
          `provenance.json is missing required key "${key}" — ` +
          "the provenance schema must not be restructured by a comms-format changeset",
      });
    }
  }

  // Check schema_version value if present
  if ("schema_version" in obj) {
    if (!KNOWN_PROVENANCE_SCHEMA_VERSIONS.has(obj.schema_version as string)) {
      violations.push({
        surface: "provenance.json",
        file: filePath,
        message:
          `provenance.json schema_version "${obj.schema_version}" is not a known value ` +
          `(expected one of: ${[...KNOWN_PROVENANCE_SCHEMA_VERSIONS].join(", ")}) — ` +
          "schema_version must not be changed by a comms-format changeset",
      });
    }
  }

  return violations;
}

function checkTraceJsonl(filePath: string, content: string): AccidentalWriteViolation[] {
  const violations: AccidentalWriteViolation[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue; // blank lines are OK

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      violations.push({
        surface: "trace.jsonl",
        file: filePath,
        line: i + 1,
        message:
          `trace JSONL line ${i + 1} is not valid JSON — ` +
          "trace files must remain line-delimited JSON (category 5, unchanged by this initiative)",
      });
      continue;
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      violations.push({
        surface: "trace.jsonl",
        file: filePath,
        line: i + 1,
        message:
          `trace JSONL line ${i + 1} is not a JSON object — each line must be an object`,
      });
      continue;
    }

    const obj = parsed as Record<string, unknown>;
    for (const key of TRACE_JSONL_REQUIRED_KEYS) {
      if (!(key in obj)) {
        violations.push({
          surface: "trace.jsonl",
          file: filePath,
          line: i + 1,
          message:
            `trace JSONL line ${i + 1} is missing required field "${key}" — ` +
            "trace line shape must not be restructured by a comms-format changeset",
        });
        break; // one violation per line is sufficient
      }
    }
  }

  return violations;
}

function checkDocsKnowledgeFrontmatter(filePath: string, content: string): AccidentalWriteViolation[] {
  // Bounded fence check (slice, not startsWith('---')) — the actual frontmatter
  // is parsed with js-yaml below (already OD-3-compliant). The distinct error
  // messages per failure mode require these explicit boundary checks.
  if (content.slice(0, 3) !== "---") {
    // No YAML frontmatter delimiter found. Two sub-cases:
    //   (a) The file genuinely has no frontmatter (new stub page) — not flagged here;
    //       check (c) in comms-format-lint handles undeclared categories for new artifacts.
    //   (b) The frontmatter was replaced by a non-YAML format (e.g. a bare JSON object
    //       on line 1) — this IS a convention violation we must catch.
    //
    // Heuristic: if the file starts with '{' it looks like the YAML frontmatter was
    // accidentally replaced with a JSON-object body. Flag it.
    if (content.trimStart().startsWith("{")) {
      return [{
        surface: "docs/knowledge frontmatter",
        file: filePath,
        message:
          "docs/knowledge page appears to have its YAML frontmatter replaced with a JSON object — " +
          "the established convention is Markdown + YAML frontmatter (category 2: unchanged); " +
          "frontmatter must begin with a '---' delimiter",
      }];
    }
    // Plain page with no frontmatter — not flagged by this guard
    return [];
  }

  const fmEnd = content.indexOf("\n---", 3);
  if (fmEnd === -1) {
    // Frontmatter opened with '---' but never closed — a broken convention. A page
    // under docs/knowledge that starts a frontmatter block MUST close it.
    return [{
      surface: "docs/knowledge frontmatter",
      file: filePath,
      message:
        "docs/knowledge page has an UNCLOSED YAML frontmatter block (opening '---' with no " +
        "closing '---') — the Markdown + YAML frontmatter convention (category 2) must not be broken",
    }];
  }

  const rawFm = content.slice(3, fmEnd).trim();
  if (!rawFm) {
    // Empty frontmatter block (--- followed by ---) — the required key-set is absent;
    // an established docs/knowledge page must carry its frontmatter.
    return [{
      surface: "docs/knowledge frontmatter",
      file: filePath,
      message:
        "docs/knowledge page has an EMPTY YAML frontmatter block — the established convention " +
        `requires the frontmatter key-set [${DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS.join(", ")}] (category 2)`,
    }];
  }

  // Parse with js-yaml (OD-3: shared parser)
  let fm: unknown;
  try {
    fm = yaml.load(rawFm);
  } catch {
    return [{
      surface: "docs/knowledge frontmatter",
      file: filePath,
      message:
        "docs/knowledge page frontmatter is not parseable as YAML — " +
        "the frontmatter convention (category 2: Markdown + YAML frontmatter) must not be broken",
    }];
  }

  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) {
    return [{
      surface: "docs/knowledge frontmatter",
      file: filePath,
      message:
        "docs/knowledge page frontmatter did not parse to a YAML mapping — " +
        "it may have been replaced with a non-YAML format (e.g. JSON object body)",
    }];
  }

  const fmObj = fm as Record<string, unknown>;
  const violations: AccidentalWriteViolation[] = [];

  for (const key of DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS) {
    if (!(key in fmObj)) {
      violations.push({
        surface: "docs/knowledge frontmatter",
        file: filePath,
        message:
          `docs/knowledge page is missing required frontmatter key "${key}" — ` +
          "the established YAML-frontmatter convention must not be reshaped by this changeset " +
          "(communication-format-policy category 2: unchanged)",
      });
    }
  }

  return violations;
}

// ── Git diff range resolver ────────────────────────────────────────────────

function resolvePathsFromDiffRange(diffRange: string): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require("child_process") as typeof import("child_process");
    const output: string = execSync(`git diff --name-only ${diffRange}`, {
      encoding: "utf8",
      timeout: 10_000,
    });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((p) => path.resolve(p));
  } catch {
    return [];
  }
}

// ── Core guard function ───────────────────────────────────────────────────

/**
 * Check a set of changed paths for accidental writes to protected surfaces.
 *
 * Each path is classified; if it matches a protected surface the relevant
 * format/schema check runs. Paths that match none of the five surfaces are
 * silently skipped (they are not protected, so they always pass).
 *
 * Returns a result with all violations and a `hasViolations` convenience flag.
 * Never throws — failures in reading files are silently skipped (fail-open).
 *
 * @param opts.paths      Absolute paths of changed files (OD-4 arm 1).
 * @param opts.diffRange  Git diff range — changed paths resolved automatically.
 */
export function checkAccidentalWrite(opts: AccidentalWriteOpts = {}): AccidentalWriteResult {
  const violations: AccidentalWriteViolation[] = [];

  // Resolve all in-scope paths
  const pathSet = new Set<string>(
    (opts.paths ?? []).map((p) => path.resolve(p))
  );
  if (opts.diffRange) {
    for (const p of resolvePathsFromDiffRange(opts.diffRange)) {
      pathSet.add(p);
    }
  }

  for (const filePath of pathSet) {
    // Fixture / legacy-example paths are point-in-time records, not live protected
    // surfaces — exempt them (OD-4) so a benign fixture edit is never frozen.
    if (isExemptFixture(filePath)) continue;

    // Read the file; skip if unreadable (fail-open — file may be deleted in diff)
    let content: string;
    try {
      if (!fs.existsSync(filePath)) continue;
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    // Dispatch to the appropriate checker(s)
    if (isSettingsJson(filePath)) {
      violations.push(...checkSettingsJson(filePath, content));
    } else if (isWorkspaceJson(filePath)) {
      violations.push(...checkWorkspaceJson(filePath, content));
    } else if (isProvenanceJson(filePath)) {
      violations.push(...checkProvenanceJson(filePath, content));
    } else if (isTraceJsonl(filePath)) {
      violations.push(...checkTraceJsonl(filePath, content));
    } else if (isDocsKnowledgeMd(filePath)) {
      violations.push(...checkDocsKnowledgeFrontmatter(filePath, content));
    }
    // All other paths: not a protected surface — silently pass
  }

  return {
    violations,
    hasViolations: violations.length > 0,
  };
}

// ── CLI entry point (main) ────────────────────────────────────────────────
//
// CLI is in a separate file (no-accidental-write.cli.ts) following the U5
// pattern. The core module has NO run-on-import side effects — no process.exit()
// at module level — so it is safe to import from tests and other scripts.
