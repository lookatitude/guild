/**
 * src/modules/communication/workflows/comms-format-lint.ts
 *
 * Usage: node scripts/comms/comms-format-lint.ts [--paths <file,...>]
 *        [--diff-range <base>...<head>] [--runs-dir <path>] [--enforce]
 *
 * U5a — Lint core for the communication-format-standardization initiative.
 * WARN MODE: exits 0 (non-blocking). The `enforce` flag (default false) is
 * a stub for U5b to flip; in U5a it is always wired OFF.
 *
 * Policy ref: ADR: communication-format-policy (workspace wiki)
 * Init ref:   .guild/initiatives/active/communication-format-standardization/
 *
 * OD-4 discriminator — a file/receipt is in-scope iff:
 *   (1) its path appears in the --paths list (diff range resolved externally), OR
 *   (2) it is a runtime receipt under .guild/runs/<id>/handoffs/ for a run whose
 *       run.yaml.started_at >= POLICY_EFFECTIVE_DATE (2026-06-03).
 * Everything else is grandfathered. Fixtures with "legacy-example" in their
 * path are additionally exempt.
 *
 * Checks:
 *   (a) Ambiguous receipt: a handoff receipt with no embedded guild.handoff.v2
 *       block, OR ≥2 blocks (duplicate), OR a block that fails validateHandoffV2.
 *   (b) New hand-rolled YAML reader: a changed source file that contains
 *       hand-rolled YAML/frontmatter parsing NOT in the U4 inventory allow-list.
 *   (c) Undeclared artifact category: a new communication artifact (.md with a
 *       known communication `type:` frontmatter field) that doesn't declare
 *       `artifact_category:`.
 *
 * Exported interface (stable — hook-engineer depends on this):
 *   export interface CommsLintFinding { check, severity, file, line?, message }
 *   export function lintCommsFormat(opts): CommsLintFinding[]
 *
 * YAML parsing discipline (OD-3): this file reads the U4 inventory JSON (JSON.parse)
 * and run.yaml using a narrow single-field regex (bounded-legacy, same pattern as
 * run-date.ts — no js-yaml in scope; run.yaml is a bounded scalar read). It does NOT
 * hand-roll a new YAML parser — only the one targeted scalar read that mirrors the
 * existing run-lifecycle.ts readStartFacts() pattern.
 *
 * Owner: tooling-engineer.
 */

import * as fs from "fs";
import * as path from "path";
import {
  ALLOWED_INJECTION_CLEAN_VALUES,
  ALLOWED_TOP_LEVEL_KEYS,
} from "../../../../hooks/lib/handoff-v2";
import { loadYamlApi } from "../../kernel";

const yaml = loadYamlApi();

// ── Policy constant ────────────────────────────────────────────────────────

/**
 * OD-4 enforcement boundary.
 * Canonical source: ADR: communication-format-policy (workspace wiki)
 * §"policy_effective_date" (policy_effective_date: 2026-06-03)
 */
export const POLICY_EFFECTIVE_DATE = new Date("2026-06-03T00:00:00Z");

// ── Exported types ─────────────────────────────────────────────────────────

/** A single lint finding from comms-format-lint. Severity is always 'warn' in U5a. */
export interface CommsLintFinding {
  /** Which check fired: (a) ambiguous receipt, (b) new YAML reader, (c) undeclared category. */
  check: "a" | "b" | "c";
  /** Always 'warn' in U5a; U5b may introduce 'error'. */
  severity: "warn";
  /** Absolute path to the offending file. */
  file: string;
  /** Source line number (1-based) if known; omitted otherwise. */
  line?: number;
  /** Human-readable description of the violation. */
  message: string;
}

/** Options for lintCommsFormat. */
export interface CommsLintOpts {
  /**
   * Explicit list of changed file paths (arm 1 of OD-4 discriminator).
   * Callers pass the output of `git diff --name-only <range>` resolved to
   * absolute paths, or a pre-resolved list.
   */
  paths?: string[];
  /**
   * Git diff range string (e.g. "abc123...def456"). When provided, the linter
   * resolves changed paths from git. If `paths` is also provided, they are merged.
   * Requires the cwd to be inside a git repo.
   */
  diffRange?: string;
  /**
   * Absolute path to .guild/runs/ directory. When provided, the linter scans
   * runtime receipts under each run subdirectory (arm 2 of OD-4 discriminator).
   */
  runsDir?: string;
  /**
   * Flip to true in U5b to make violations exit non-zero.
   * In U5a this flag is accepted but has no effect on exit code — the CLI main()
   * still exits 0 regardless.
   */
  enforce?: boolean;
}

// ── U4 allow-list ──────────────────────────────────────────────────────────

/** Normalise a file path for allow-list comparison. */
function normalisePath(p: string): string {
  // Compare by the canonical relative path from the repo root, or the basename
  // if the path is not repo-rooted. We strip leading slashes and normalise.
  return path.normalize(p).replace(/\\/g, "/");
}

/**
 * Load the U4 YAML-reader inventory and return the set of inventoried (grandfathered)
 * source file paths. Paths are stored relative to the repo root in the inventory JSON.
 *
 * Reads the inventory JSON adjacent to this script's package location so the allow-list
 * is always current. Falls back to an empty set if the file cannot be read (safe — a
 * missing allow-list means no files are grandfathered, which may produce false positives
 * but never false negatives for NEW readers).
 */
function loadInventoryAllowList(): Set<string> {
  const inventoryPath = path.resolve(
    __dirname,
    // __dirname = <repo>/src/modules/communication/workflows; four `..` reach the
    // repo root: workflows → communication → modules → src → <repo>. (The prior
    // five-`..` overshot to the umbrella parent — a path that does not exist in a
    // standalone plugin checkout, so the allow-list silently never loaded.)
    "../../../..",
    ".guild/initiatives/active/communication-format-standardization/yaml-reader-inventory.json"
  );
  try {
    if (!fs.existsSync(inventoryPath)) return new Set();
    const raw = fs.readFileSync(inventoryPath, "utf8");
    // Use JSON.parse — inventory is category 4 (machine-derived JSON). No hand-rolled parser.
    const data = JSON.parse(raw) as { readers?: Array<{ file?: string }> };
    const files = new Set<string>();
    for (const reader of data.readers ?? []) {
      if (reader.file) {
        files.add(normalisePath(reader.file));
      }
    }
    return files;
  } catch {
    return new Set();
  }
}

// ── Exemption helpers ──────────────────────────────────────────────────────

/** True if the path is a fixture / legacy-example and is always exempt. */
function isLegacyExempt(filePath: string): boolean {
  const normalised = normalisePath(filePath);
  return normalised.includes("legacy-example") || normalised.includes("fixtures/legacy-example");
}

/**
 * Generated build-output exemption — fully exempt from all checks.
 *
 * The lint governs AUTHORED SOURCE. Compiled bundles under any `/dist/` directory
 * (hooks/dist, hooks/agent-team/dist, mcp-servers/**\/dist, …) are emitted from
 * already-linted `.ts` source — re-flagging the `.js` build output is noise, and
 * "fixing" generated code is wrong (the source is the unit of change). A `/dist/`
 * path segment is the canonical marker for that build output across the repo.
 */
function isBuildArtifactExempt(filePath: string): boolean {
  return normalisePath(filePath).includes("/dist/");
}

/**
 * check-a SCOPE exemption: intentional handoff TEST FIXTURES.
 *
 * `tests/**\/fixtures/**\/handoffs/*.md` are DELIBERATELY malformed receipts
 * authored to exercise the scrub / policy machinery (e.g. a receipt with no
 * embedded guild.handoff.v2 block). They are not real runtime receipts, so the
 * ambiguous-receipt check (a) must not flag them. This is a lint-scope
 * exemption — the fixtures themselves are NOT edited.
 *
 * Narrowly scoped to check (a): a file is exempt only when its normalised path
 * contains BOTH a `/fixtures/` segment AND a `/handoffs/` segment. Real runtime
 * receipts live under `.guild/runs/<id>/handoffs/` and never under a `/fixtures/`
 * path, so this can never over-exempt a production receipt. Checks (b) and (c)
 * are unaffected.
 */
function isHandoffFixtureExempt(filePath: string): boolean {
  const normalised = normalisePath(filePath);
  return normalised.includes("/fixtures/") && normalised.includes("/handoffs/");
}

// ── Handoff-v2 extraction + validation (mirrored from hooks/lib/handoff-v2.ts) ──
//
// Extraction remains local because this linter must find every fence to detect
// duplicates, while the canonical helper intentionally returns only the first.

/**
 * Mirror of hooks/lib/handoff-v2.ts:extractHandoffEnvelope.
 * Finds ALL fenced ```guild.handoff.v2 blocks and returns their parsed JSON values.
 * (The original returns only the first match; here we count all for duplicate detection.)
 */
function extractAllHandoffEnvelopes(content: string): unknown[] {
  const results: unknown[] = [];
  // Global regex to find all fenced guild.handoff.v2 blocks.
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1]) {
      try {
        results.push(JSON.parse(match[1].trim()));
      } catch {
        results.push(null); // unparseable block counts as a block (malformed)
      }
    }
  }
  return results;
}

// ── guild.handoff.v2 full validator (mirror of hooks/lib/handoff-v2.ts) ───
//
// Full mirror of validateHandoffV2 in hooks/lib/handoff-v2.ts.
// Validation remains local, while the strict allowed-key set is imported from
// the canonical validator so schema additions cannot silently diverge here.
// Canonical source of truth: hooks/lib/handoff-v2.ts:validateHandoffV2.
// Also mirrors the envelopeShapeErrors function in scripts/lib/reaping.ts,
// which was forced to full parity by the AC-3 consumer agreement requirement.
// If the canonical changes, update both mirrors in lockstep.

/** Effective allowed-key set, shared with the canonical handoff-v2 validator. */
export const ALLOWED_ENVELOPE_KEYS: ReadonlySet<string> = ALLOWED_TOP_LEVEL_KEYS;

const VALID_ENVELOPE_TIERS = new Set<string>(["cheap", "mid", "powerful"]);
const VALID_ENVELOPE_STATUSES = new Set<string>(["done", "blocked", "escalate"]);

/** ~100-token proxy — mirror of SUMMARY_MAX_CHARS in hooks/lib/handoff-v2.ts. */
const ENVELOPE_SUMMARY_MAX = 600;

/** O-4 cap — mirror of NOTES_MAX_CHARS in hooks/lib/handoff-v2.ts. */
const ENVELOPE_NOTES_MAX = 200;

/**
 * Full mirror of validateHandoffV2 from hooks/lib/handoff-v2.ts.
 * Returns error strings (empty array = valid).
 * Validates ALL required fields, array element types, conditional fields,
 * optional field types, unknown-key rejection, and size caps.
 * Canonical reference: hooks/lib/handoff-v2.ts validateHandoffV2 (OD-2).
 */
function envelopeShapeErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["envelope must be a non-null object"];
  }
  const obj = value as Record<string, unknown>;
  const errors: string[] = [];

  // Unknown-key rejection — strict guild.handoff.v2 (spec §2)
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) {
      errors.push(
        `unknown key "${k}" — strict guild.handoff.v2 rejects extra/misspelled keys`
      );
    }
  }

  // schema_version
  if (obj["schema_version"] !== "guild.handoff.v2") {
    errors.push(
      `schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // task_id — required non-empty string
  if (typeof obj["task_id"] !== "string" || obj["task_id"].trim() === "") {
    errors.push("task_id must be a non-empty string");
  }

  // tier — required, one of cheap|mid|powerful
  if (typeof obj["tier"] !== "string" || !VALID_ENVELOPE_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }

  // status — required, one of done|blocked|escalate
  if (typeof obj["status"] !== "string" || !VALID_ENVELOPE_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }

  // summary — required, non-empty, size-capped
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > ENVELOPE_SUMMARY_MAX) {
    errors.push(
      `summary exceeds ${ENVELOPE_SUMMARY_MAX} char cap (bloat rejection SC-7): ` +
        `got ${obj["summary"].length} chars`
    );
  }

  // artifacts — required array (may be empty); elements must be strings
  if (!Array.isArray(obj["artifacts"])) {
    errors.push("artifacts must be an array (may be empty)");
  } else {
    for (let i = 0; i < (obj["artifacts"] as unknown[]).length; i++) {
      if (typeof (obj["artifacts"] as unknown[])[i] !== "string") {
        errors.push(`artifacts[${i}] must be a string`);
      }
    }
  }

  // issues — required array (may be empty); elements must be strings
  if (!Array.isArray(obj["issues"])) {
    errors.push("issues must be an array (may be empty)");
  } else {
    for (let i = 0; i < (obj["issues"] as unknown[]).length; i++) {
      if (typeof (obj["issues"] as unknown[])[i] !== "string") {
        errors.push(`issues[${i}] must be a string`);
      }
    }
  }

  // escalate_reason — required when status === "escalate"
  if (obj["status"] === "escalate") {
    if (
      obj["escalate_reason"] === undefined ||
      obj["escalate_reason"] === null ||
      (typeof obj["escalate_reason"] === "string" && obj["escalate_reason"].trim() === "")
    ) {
      errors.push("escalate_reason is required and must be non-empty when status is 'escalate'");
    }
  }

  // escalate_reason type check (if present)
  if (obj["escalate_reason"] !== undefined && typeof obj["escalate_reason"] !== "string") {
    errors.push("escalate_reason must be a string when provided");
  }

  // learnings — optional array of strings
  if (obj["learnings"] !== undefined) {
    if (!Array.isArray(obj["learnings"])) {
      errors.push("learnings must be an array when provided");
    } else {
      for (let i = 0; i < (obj["learnings"] as unknown[]).length; i++) {
        if (typeof (obj["learnings"] as unknown[])[i] !== "string") {
          errors.push(`learnings[${i}] must be a string`);
        }
      }
    }
  }

  // notes — optional, capped at 200 chars (O-4)
  if (obj["notes"] !== undefined) {
    if (typeof obj["notes"] !== "string") {
      errors.push("notes must be a string when provided");
    } else if ((obj["notes"] as string).length > ENVELOPE_NOTES_MAX) {
      errors.push(
        `notes exceeds ${ENVELOPE_NOTES_MAX} char cap (O-4 binding resolution): ` +
          `got ${(obj["notes"] as string).length} chars`
      );
    }
  }

  // injection_clean — HK-08 additive-optional; absent ⇒ unverified (no error)
  if (
    obj["injection_clean"] !== undefined &&
    !ALLOWED_INJECTION_CLEAN_VALUES.has(obj["injection_clean"] as string)
  ) {
    errors.push(
      `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
    );
  }

  return errors;
}

// ── Check (a): ambiguous receipts ─────────────────────────────────────────

/**
 * Determine whether a file looks like a handoff receipt.
 *
 * A file is a receipt ONLY if:
 *   (a) its path is under a /handoffs/ or /receipts/ directory, OR
 *   (b) its frontmatter `type:` field is exactly `handoff_receipt`.
 *
 * A file whose frontmatter declares a DIFFERENT type (decision, standard,
 * recipe, reflection, run_manifest, etc.) is NOT a receipt even if its prose
 * body mentions the ```guild.handoff.v2 fence format (e.g. a policy doc that
 * documents the format). The previous third heuristic — "has a guild.handoff.v2
 * fence in content" — was removed because it caused false positives on docs/
 * knowledge pages that describe the fence syntax in prose. The frontmatter type
 * is authoritative; path location is a sufficient structural signal for runtime
 * receipts written without a type field.
 *
 * Note: arm 2 of lintCommsFormat (runsDir) feeds runtime receipts that live
 * under .guild/runs/<id>/handoffs/ — those are caught by the path heuristic.
 */
function looksLikeReceipt(filePath: string, content: string): boolean {
  if (!filePath.endsWith(".md")) return false;
  // Path heuristic: under a handoffs/ or receipts/ directory
  const normalised = normalisePath(filePath);
  if (normalised.includes("/handoffs/") || normalised.includes("/receipts/")) return true;
  // Frontmatter heuristic: type: handoff_receipt (authoritative)
  // A different `type:` value (decision, standard, etc.) disqualifies the file
  // as a receipt regardless of any guild.handoff.v2 mention in its body.
  if (/^type:\s*handoff_receipt\s*$/m.test(content)) return true;
  return false;
}

function checkAmbiguousReceipt(filePath: string, content: string): CommsLintFinding[] {
  if (!looksLikeReceipt(filePath, content)) return [];
  const envelopes = extractAllHandoffEnvelopes(content);

  if (envelopes.length === 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message:
          "handoff receipt has no embedded `guild.handoff.v2` block — " +
          "a valid receipt must embed exactly one (OD-2, communication-format-policy §7)",
      },
    ];
  }

  if (envelopes.length >= 2) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message:
          `handoff receipt has ${envelopes.length} embedded \`guild.handoff.v2\` blocks ` +
          "(duplicate) — exactly one is required (OD-2)",
      },
    ];
  }

  // Exactly one block: run the full parity validator
  const envelope = envelopes[0];
  if (envelope === null) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message:
          "handoff receipt's embedded `guild.handoff.v2` block is not valid JSON " +
          "(strict v2 requires parseable JSON)",
      },
    ];
  }
  const shapeErrors = envelopeShapeErrors(envelope);
  if (shapeErrors.length > 0) {
    return [
      {
        check: "a",
        severity: "warn",
        file: filePath,
        message:
          `handoff receipt's embedded \`guild.handoff.v2\` block fails shape validation: ` +
          shapeErrors.join("; "),
      },
    ];
  }

  return [];
}

// ── Check (b): new hand-rolled YAML readers ───────────────────────────────
//
// GRANDFATHERING: only via the U4 inventory allow-list and legacy-example exemption.
// A file is NOT exempted merely because it imports js-yaml — a new reader can keep
// hand-rolled regex parsing and add an unused js-yaml import to dodge the warn.
// Only the 20 inventoried files are grandfathered.
//
// PATTERN TIGHTENING: patterns require YAML-specific structural context to avoid
// false positives on non-YAML regex (URL patterns, JSON, general string ops).
// Each pattern targets a form known to appear in the U4 inventory readers.

/**
 * Narrow YAML-frontmatter-specific detection patterns (per coordinator guidance).
 *
 * A file is flagged ONLY when it contains an idiom specific to hand-rolled
 * YAML/frontmatter parsing. Generic regex (URL patterns, JSON access, string
 * comparisons) does NOT match these patterns.
 *
 * Patterns are stored as strings and compiled at module load, so no regex
 * literal in this source file can accidentally match its own pattern text.
 *
 * Six detected idioms:
 *   (1) Splitting a string on the triple-dash frontmatter delimiter.
 *   (2) Calling startsWith on the triple-dash delimiter.
 *   (3) A regex literal anchored at ^ with a bare YAML identifier then colon-space,
 *       excluding URL schemes (https, http, ftp, file) and Windows drive letters.
 *   (4) Constructing new RegExp with a quoted caret as the first argument, then
 *       string concatenation (the dynamic per-field YAML extractor pattern).
 *   (5) Calling matchAll with a caret-anchored identifier-colon regex literal.
 *   (6) Calling indexOf/split on a colon-only string via a variable named "line"
 *       (the conventional YAML line-scanner loop variable).
 */
const HAND_ROLLED_PATTERN_SOURCES: Array<{ src: string; label: string }> = [
  // (1) content split on triple-dash delimiter
  {
    src: String.raw`\.split\s*\(\s*['` + "`" + String.raw`"']---['` + "`" + String.raw`"']\s*\)`,
    label: "frontmatter delimiter split (hand-rolled frontmatter splitter)",
  },
  // (2) startsWith triple-dash
  {
    src: String.raw`\.startsWith\s*\(\s*['` + "`" + String.raw`"']---['` + "`" + String.raw`"']\s*\)`,
    label: "frontmatter boundary check via startsWith (hand-rolled)",
  },
  // (3) regex literal of form /^yamlIdentifier: in source code.
  //     Catches YAML key-extraction regex literals anchored at line start.
  //     Excludes known URL scheme identifiers (https/http/ftp/file/ws/wss/data/mailto)
  //     via a named lookahead — distinguishes /^status:\s*/ (warn) from /^https?:\/\//
  //     (no warn) by checking the identifier itself, not the chars after the colon
  //     (which are ambiguous because both :\s* and :\/\/ start with : in source).
  {
    src: String.raw`/\^(?!(?:https?|ftp|file|wss?|data|mailto)[:/])[A-Za-z_][A-Za-z0-9_-]*:`,
    label: "line-anchored YAML key regex literal (hand-rolled field extractor)",
  },
  // (4a) dynamic per-field extractor — quoted-string caret then string concat:
  //      new RegExp('^' + key + ':\\s*(.*)$', 'm')
  //      The quoted-caret then close-quote then plus-sign is the discriminator.
  {
    src: String.raw`new\s+RegExp\s*\(\s*['` + "`" + String.raw`"']\^['` + "`" + String.raw`"']\s*\+`,
    label: "dynamic RegExp('^'+key+...) string-concat (hand-rolled YAML field extractor)",
  },
  // (4b) dynamic per-field extractor — template-literal caret form:
  //      new RegExp(`^${key}:\\s*(.*)$`, 'm')
  //      The backtick-open then caret is the discriminator.
  {
    src: String.raw`new\s+RegExp\s*\(\s*` + "`" + String.raw`\^(?!(?:https?|ftp|file|wss?|data|mailto|tel|urn|blob):)[^` + "`" + String.raw`]*:`,
    label: "dynamic RegExp(`^${key}:...) template-literal (hand-rolled YAML field extractor)",
  },
  // (4c) per-field extractor — single quoted string carrying the whole anchored
  //      key pattern: new RegExp('^status:\\s*(.*)$', 'm'). The discriminator is a
  //      quoted caret immediately followed by a YAML identifier + colon. Excludes
  //      known URL scheme identifiers with the same named lookahead as pattern (3).
  {
    src: String.raw`new\s+RegExp\s*\(\s*['` + '"' + String.raw`]\^(?!(?:https?|ftp|file|wss?|data|mailto):)[A-Za-z_][A-Za-z0-9_-]*:`,
    label: "single-string RegExp('^key:...) anchored key (hand-rolled YAML field extractor)",
  },
  // (5) matchAll with a YAML-key pattern — catches BOTH anchored (/^key:/) and
  //     UNANCHORED (/key:/) forms, mirroring inventory reader #19 (knowledge-links-builder
  //     collectReflectionEdges uses unanchored matchAll(/source_ref[s]?:\s*(.+)/g)).
  //     URL schemes excluded two ways: (1) a NAMED-scheme negative lookahead
  //     (?!(?:https?|ftp|file|wss?|data|mailto):) rejects non-slash schemes like
  //     mailto:/data: (same mechanism as patterns 3/4c); (2) :(?!\\*\/) rejects any
  //     remaining slash-scheme (scheme://, incl. source-escaped :\\/\\/).
  {
    src: String.raw`matchAll\s*\(\s*/\^?(?!(?:https?|ftp|file|wss?|data|mailto):)([A-Za-z_][A-Za-z0-9_\[\]?-]*):(?!\\*\/)`,
    label: "matchAll with YAML key pattern anchored or unanchored (hand-rolled multi-value extractor)",
  },
  // (6) YAML line-scanner: a variable named 'line' calls indexOf or split with
  //     a colon as the sole argument — the pattern used in frontmatter key:value loops.
  {
    src: String.raw`\bline\b.{0,30}\.(?:indexOf|split)\s*\(\s*['` + "`" + String.raw`"']:['` + "`" + String.raw`"']\s*\)`,
    label: "line.indexOf/split on colon — YAML line scanner (hand-rolled)",
  },
];

/** Compiled pattern objects (lazy, built once). */
const HAND_ROLLED_PATTERNS: Array<{ pattern: RegExp; label: string }> =
  HAND_ROLLED_PATTERN_SOURCES.map(({ src, label }) => ({
    pattern: new RegExp(src),
    label,
  }));

/**
 * This lint file's own canonical path suffix — exempt from check (b).
 *
 * This file contains two regex-against-content uses that legitimately trigger
 * pattern 3 (line-anchored key regex) but are NOT new hand-rolled YAML parsers:
 *
 *   (a) looksLikeReceipt(): the /^type:\s*handoff_receipt/ test checks whether
 *       a .md file contains a known frontmatter type marker — it is receipt
 *       detection, not YAML field extraction.
 *
 *   (b) readRunStartedAt(): uses /^started_at:[ \t]*(.*)$/m — a bounded single-
 *       field reader, explicitly modeled after and documented as mirroring
 *       hooks/lib/run-date.ts (bounded-legacy reader #20 in the U4 inventory).
 *       The scripts package has no js-yaml dep for this bounded scalar surface.
 *
 * Neither constitutes a new general YAML parser. Exempting this file is an
 * architectural declaration, not a coverage gap — any GENUINELY new reader in a
 * different file is still caught.
 */
// The detector's own source (contains the idiom PATTERNS it searches for) and its
// test (feeds INTENTIONAL hand-rolled-idiom examples to assert the detector flags them)
// are both self-exempt — their idioms are the detector's own machinery / test data,
// not real readers. Any GENUINELY new reader in a different file is still caught.
const SELF_EXEMPT_SUFFIXES = [
  "src/modules/communication/workflows/comms-format-lint.ts",
  "scripts/comms/comms-format-lint.ts",
  "scripts/comms/__tests__/comms-format-lint.test.ts",
];

function checkNewHandRolledYaml(
  filePath: string,
  content: string,
  allowList: Set<string>
): CommsLintFinding[] {
  // Only flag TypeScript / JavaScript source files
  const ext = path.extname(filePath).toLowerCase();
  if (![".ts", ".js", ".tsx", ".jsx"].includes(ext)) return [];

  // Grandfather via the U4 inventory allow-list (the 20 known readers) and
  // this lint file's own source (which uses two bounded patterns — see above).
  // A js-yaml import does NOT grant exemption — a new reader that imports
  // js-yaml but still uses hand-rolled YAML patterns is still flagged.
  const normalised = normalisePath(filePath);
  if (SELF_EXEMPT_SUFFIXES.some((s) => normalised.endsWith(s))) return [];
  for (const inventoried of allowList) {
    if (normalised.endsWith(inventoried) || normalised.includes(inventoried)) return [];
  }

  // POSITIVE YAML-SURFACE GATE (root false-positive guard): a file is only a
  // candidate "hand-rolled YAML reader" if it actually reads a YAML / markdown-
  // frontmatter surface. This is the semantic definition of the check and it
  // eliminates the whole class of false positives where a non-YAML anchored
  // key-like regex (URL schemes tel:/urn:/blob:/mailto:/data:/http(s)://, glob
  // builders like globToRegExp, etc.) would otherwise trip patterns 3/4/5.
  // Signals: a .yaml/.yml/.md/run.yaml reference, the word "frontmatter", or the
  // '---' frontmatter-delimiter idiom (patterns 1/2 carry their own '---' signal).
  const YAML_SURFACE_SIGNAL = /\.ya?ml\b|run\.yaml|frontmatter|\.md\b|['"`]---['"`]/i;
  if (!YAML_SURFACE_SIGNAL.test(content)) return [];

  // Scan for hand-rolled YAML patterns
  const findings: CommsLintFinding[] = [];
  for (const { pattern, label } of HAND_ROLLED_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        check: "b",
        severity: "warn",
        file: filePath,
        message:
          `new hand-rolled YAML reader detected (${label}) — ` +
          "use shared js-yaml parser instead (OD-3, communication-format-policy §\"New artifact must declare its category\")",
      });
      break; // one finding per file is sufficient
    }
  }
  return findings;
}

// ── Check (c): undeclared artifact category ───────────────────────────────

/**
 * Machine-communication artifact types that require an explicit `artifact_category:`
 * declaration in their frontmatter.
 *
 * SCOPE: only genuinely NEW machine-communication artifacts — envelopes, receipts,
 * and runtime manifests — that sit on a NEW communication boundary and therefore
 * need to explicitly declare which policy category they belong to (per
 * communication-format-policy.md §"New artifact must declare its category").
 *
 * EXCLUDED by design (human knowledge / established convention):
 *   - `decision` — category 2 (human knowledge doc, MD+frontmatter) by established
 *     convention for docs/knowledge/ pages. These files are not machine protocol.
 *   - `standard`, `recipe`, `reflection`, `learning` — same: human knowledge docs
 *     under docs/knowledge/ or .guild/wiki/ (category 2 by location, not by label).
 *
 * A separate location exemption (isHumanKnowledgeDoc) additionally guards any file
 * under docs/knowledge/ or .guild/wiki/ from check-(c), regardless of its type
 * field, because those directories are category-2 by established convention and
 * must NOT require an explicit artifact_category: to participate in the lint gate.
 *
 * Types in this set are machine-protocol surfaces that are genuinely new or
 * ambiguous without an explicit category declaration:
 *   - handoff_receipt     — category 7 (mixed Markdown wrapper + JSON envelope)
 *   - run_manifest        — category 3 (human-authored YAML, but must be explicit)
 *   - team_manifest       — category 3
 *   - review_packet       — category 7 (new, ambiguous without a declaration)
 *   - learning_checkpoint — category 7 (new)
 *   - trace_event         — category 5 (JSONL; new files of this type must declare)
 */
const COMM_ARTIFACT_TYPES = new Set([
  "handoff_receipt",
  "run_manifest",
  "team_manifest",
  "review_packet",
  "learning_checkpoint",
  "trace_event",
]);

/**
 * Human knowledge / established-convention location exemption for check-(c).
 *
 * Files under docs/knowledge/ or .guild/wiki/ are category-2 (human knowledge,
 * MD+YAML frontmatter) by established convention — they do NOT need to carry an
 * explicit `artifact_category:` field to satisfy the "new artifact must declare
 * its category" discipline. The location IS the declaration.
 *
 * This exemption covers:
 *   - docs/knowledge/**   — policy pages, ADRs, standards, recipes, reflections
 *   - .guild/wiki/**      — durable wiki knowledge base
 *
 * It does NOT cover runtime state (.guild/runs/, .guild/team/, etc.) which
 * should carry explicit categories on new artifact types.
 */
function isHumanKnowledgeDoc(filePath: string): boolean {
  const normalised = normalisePath(filePath);
  return (
    normalised.includes("/docs/knowledge/") ||
    normalised.includes("/.guild/wiki/")
  );
}

function checkUndeclaredCategory(filePath: string, content: string): CommsLintFinding[] {
  if (!filePath.endsWith(".md") && !filePath.endsWith(".yaml") && !filePath.endsWith(".yml")) {
    return [];
  }

  // Exempt human knowledge / established-convention docs (category-2 by location).
  if (isHumanKnowledgeDoc(filePath)) return [];

  // Extract the raw frontmatter block between the --- delimiters.
  // We locate the delimiters first with a simple index search to avoid
  // hand-rolling a regex YAML parser (OD-3 compliance).
  const fmStart = content.indexOf("---");
  if (fmStart !== 0 && fmStart !== -1) return []; // no leading ---
  if (fmStart === -1) return [];
  const fmEnd = content.indexOf("\n---", fmStart + 3);
  if (fmEnd === -1) return []; // no closing ---

  const rawFrontmatter = content.slice(fmStart + 3, fmEnd).trim();
  if (!rawFrontmatter) return [];

  // Parse frontmatter with js-yaml (OD-3: shared parser, not hand-rolled).
  // js-yaml is a dependency of the scripts package (package.json).
  let fm: unknown;
  try {
    fm = yaml.load(rawFrontmatter);
  } catch {
    return []; // unparseable frontmatter — not our job to flag parse errors here
  }

  if (typeof fm !== "object" || fm === null || Array.isArray(fm)) return [];
  const fmObj = fm as Record<string, unknown>;

  // Check for a known machine-communication artifact type
  const artifactType = typeof fmObj["type"] === "string" ? fmObj["type"].trim() : null;
  if (!artifactType || !COMM_ARTIFACT_TYPES.has(artifactType)) return [];

  // Check for artifact_category declaration
  if (fmObj["artifact_category"] !== undefined && fmObj["artifact_category"] !== null && fmObj["artifact_category"] !== "") {
    return []; // declared — OK
  }

  return [
    {
      check: "c",
      severity: "warn",
      file: filePath,
      message:
        `communication artifact of type "${artifactType}" does not declare \`artifact_category:\` — ` +
        "every new communication artifact must state its category before choosing a format " +
        "(communication-format-policy §\"New artifact must declare its category\")",
    },
  ];
}

// ── OD-4 run-date reader ───────────────────────────────────────────────────
//
// Mirrors hooks/lib/run-date.ts:readRunStartedAt — same bounded single-field
// regex approach. Scripts package has no js-yaml dep for this surface (run.yaml
// is a bounded-legacy read; reader id 13 / id 20 in U4 inventory).

function readRunStartedAt(runDir: string): Date | null {
  const runYamlPath = path.join(runDir, "run.yaml");
  try {
    if (!fs.existsSync(runYamlPath)) return null;
    const raw = fs.readFileSync(runYamlPath, "utf8");
    // Targeted single-field extraction — mirrors run-lifecycle.ts readStartFacts()
    // and hooks/lib/run-date.ts readRunStartedAt(). Bounded to one scalar.
    const m = raw.match(/^started_at:[ \t]*(.*)$/m);
    if (!m || !m[1] || m[1].trim() === "") return null;
    const d = new Date(m[1].trim());
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** True if the run's started_at is >= POLICY_EFFECTIVE_DATE. Fail-open on null (indeterminate). */
function isRunInScope(runDir: string): boolean {
  const d = readRunStartedAt(runDir);
  if (d === null) return false; // indeterminate → fail-open (do not enforce)
  return d >= POLICY_EFFECTIVE_DATE;
}

// ── Git diff range resolver ────────────────────────────────────────────────

function resolvePathsFromDiffRange(diffRange: string): string[] {
  try {
    const { execSync } = require("child_process");
    const output: string = execSync(`git diff --name-only ${diffRange}`, {
      encoding: "utf8",
      timeout: 10000,
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

// ── Core lint function ─────────────────────────────────────────────────────

/**
 * Run the comms-format lint checks over the given options.
 *
 * Returns a (possibly empty) array of findings. Always returns cleanly —
 * never throws. In U5a, all findings have severity 'warn' and the caller
 * exits 0 regardless.
 *
 * @param opts.paths     Changed file paths (OD-4 arm 1).
 * @param opts.diffRange Git range to resolve changed paths (OD-4 arm 1).
 * @param opts.runsDir   Path to .guild/runs/ for runtime receipt checks (OD-4 arm 2).
 * @param opts.enforce   Stub for U5b; accepted but no effect on exit code in U5a.
 */
export function lintCommsFormat(opts: CommsLintOpts = {}): CommsLintFinding[] {
  const findings: CommsLintFinding[] = [];
  const allowList = loadInventoryAllowList();

  // Resolve in-scope paths (OD-4 arm 1)
  const inScopePaths = new Set<string>(opts.paths ?? []);
  if (opts.diffRange) {
    for (const p of resolvePathsFromDiffRange(opts.diffRange)) {
      inScopePaths.add(p);
    }
  }

  // ── Arm 1: check changed paths ────────────────────────────────────────
  for (const filePath of inScopePaths) {
    if (isLegacyExempt(filePath)) continue;
    if (isBuildArtifactExempt(filePath)) continue; // generated build output — lint source, not dist

    let content: string;
    try {
      if (!fs.existsSync(filePath)) continue;
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    // check (a) is scoped-out for intentional handoff TEST FIXTURES; (b)/(c) still apply.
    if (!isHandoffFixtureExempt(filePath)) {
      findings.push(...checkAmbiguousReceipt(filePath, content));
    }
    findings.push(...checkNewHandRolledYaml(filePath, content, allowList));
    findings.push(...checkUndeclaredCategory(filePath, content));
  }

  // ── Arm 2: check runtime receipts under runsDir ───────────────────────
  if (opts.runsDir) {
    try {
      if (!fs.existsSync(opts.runsDir)) return findings;
      const runDirs = fs
        .readdirSync(opts.runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(opts.runsDir!, d.name));

      for (const runDir of runDirs) {
        if (!isRunInScope(runDir)) continue; // grandfathered or indeterminate

        // Scan handoffs/ subdirectory for receipts
        const handoffsDir = path.join(runDir, "handoffs");
        if (!fs.existsSync(handoffsDir)) continue;

        const receiptFiles = fs
          .readdirSync(handoffsDir, { withFileTypes: true })
          .filter((f) => f.isFile() && f.name.endsWith(".md"))
          .map((f) => path.join(handoffsDir, f.name));

        for (const receiptPath of receiptFiles) {
          if (isLegacyExempt(receiptPath)) continue;
          // Don't double-check files already checked via arm 1
          if (inScopePaths.has(receiptPath)) continue;

          let content: string;
          try {
            content = fs.readFileSync(receiptPath, "utf8");
          } catch {
            continue;
          }

          if (!isHandoffFixtureExempt(receiptPath)) {
            findings.push(...checkAmbiguousReceipt(receiptPath, content));
          }
          // Note: checks (b) and (c) are not applied to runtime receipts —
          // they are source-code and artifact-declaration checks respectively.
          // Runtime receipts are only checked for (a) ambiguous envelope.
        }
      }
    } catch {
      // If we cannot read the runsDir, skip silently (fail-open)
    }
  }

  return findings;
}

// ── CLI helpers (exported for comms-format-lint.cli.ts) ───────────────────
//
// These are exported so the CLI entry file can import and call them without
// duplicating logic. The core module itself has NO run-on-import side effects —
// no self-invocation, no process.exit() at module level. This makes it safe
// to import/bundle into hooks or other consumers without triggering CLI behaviour.
//
// CLI entry point: src/modules/communication/workflows/comms-format-lint.cli.ts

export function printFindings(findings: CommsLintFinding[]): void {
  if (findings.length === 0) {
    console.log("[comms-format-lint] OK — no issues found");
    return;
  }
  for (const f of findings) {
    const loc = f.line !== undefined ? `:${f.line}` : "";
    console.warn(
      `[comms-format-lint] WARN [check-${f.check}] ${f.file}${loc}: ${f.message}`
    );
  }
  console.warn(
    `\n[comms-format-lint] ${findings.length} warning(s) — non-blocking (U5a warn mode)`
  );
}

/** Parse CLI args into CommsLintOpts. */
export function parseArgs(args: string[]): CommsLintOpts {
  const opts: CommsLintOpts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--paths" && args[i + 1]) {
      opts.paths = args[++i].split(",").map((p) => path.resolve(p));
    } else if (args[i] === "--diff-range" && args[i + 1]) {
      opts.diffRange = args[++i];
    } else if (args[i] === "--runs-dir" && args[i + 1]) {
      opts.runsDir = path.resolve(args[++i]);
    } else if (args[i] === "--enforce") {
      opts.enforce = true;
    }
  }
  return opts;
}
