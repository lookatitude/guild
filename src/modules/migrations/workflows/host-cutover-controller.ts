/**
 * src/modules/migrations/workflows/host-cutover-controller.ts
 *
 * A21-8 / W4/MH-08 — the strangler-migration host-cutover controller and its
 * four-scenario owner evaluator.
 *
 * WHAT THIS FILE IS
 *   A defensive, fail-closed selection controller for host/capability/version
 *   scoped `legacy | shadow | current | rollback` cutover, backed by a
 *   contained, append-only, hash-linked filesystem journal, plus the evaluator
 *   that drives it through the four frozen `W4/MH-08` scenarios
 *   (`MHRC-STR-001`..`004`) and hands the A21-S assembler one
 *   `guild.conformance_owner_packet.v1` packet. It decides nothing else.
 *
 * SAFETY SEMANTICS
 *   - `shadow` never transfers authority; legacy remains effective.
 *   - `current` is allowed only after an equivalent successful shadow record
 *     for the EXACT host/capability/host-version tuple.
 *   - Divergence is a typed refusal: it enumerates field differences, appends
 *     the refusal record, and preserves legacy authority.
 *   - `rollback` APPENDS a new selection record rather than truncating; it
 *     never deletes history.
 *   - Repeated identical operation ids are idempotent; a divergent reuse of
 *     the same operation id is refused.
 *   - Reads refuse partial writes, sequence gaps, hash drift, non-directory
 *     roots, symlink roots/components, and roots escaping the
 *     controller-owned containment boundary.
 *   - Journal publication is atomic (write-then-rename) and no caller input is
 *     ever mutated.
 *
 * NOT AN OFFENSIVE-SECURITY SURFACE
 *   This module performs no credential access, no persistence beyond its own
 *   contained journal, no user influence, no network behavior, and no host
 *   mutation outside the journal it owns.
 *
 * DELIBERATELY OUT OF SCOPE
 *   No promotion decision, no assembly, no signature/attestation verification.
 *   `assembleNeutralConformanceEvidence` (A21-S) still owns the join.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  neutralCanonicalJson,
  neutralFreeze,
} from "../../lifecycle";
import type { NeutralEvidenceIdentity, NeutralScenarioResult } from "../../lifecycle";

// ---------------------------------------------------------------------------
// Identity of this owner
// ---------------------------------------------------------------------------

export const MH08_OWNER_KEY = "W4/MH-08";

/** The four stable ids, in CANONICAL (whole-suite) order. Source-owned. */
export const MH08_SCENARIO_IDS: readonly string[] = Object.freeze([
  "MHRC-STR-001",
  "MHRC-STR-002",
  "MHRC-STR-003",
  "MHRC-STR-004",
]);

/** The closed decision-record schema this controller emits. */
export const MH08_DECISION_SCHEMA = "guild.migration_decision.v1";

/** The closed neutral reason code for a shadow-divergence refusal. */
export const MH08_DIVERGENCE_REASON_CODE = "migration_shadow_divergence";

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The closed mode vocabulary. */
export const MH08_MODES: readonly string[] = Object.freeze(["legacy", "shadow", "current", "rollback"]);

/** The exact host/capability/version scope shape, in canonical field order. */
export const MH08_SCOPE_FIELDS: readonly string[] = Object.freeze(["host_id", "capability_id", "host_version"]);

export interface Mh08Scope {
  readonly host_id: string;
  readonly capability_id: string;
  readonly host_version: string;
}

export interface Mh08ComparisonDifference {
  readonly field: string;
  readonly legacy: unknown;
  readonly candidate: unknown;
}

export interface Mh08ComparisonVerdict {
  readonly equivalent: boolean;
  readonly compared_fields: readonly string[];
  readonly differences: readonly Mh08ComparisonDifference[];
  readonly allowlisted_fields: readonly string[];
}

export interface Mh08DecisionRecord {
  readonly schema_version: string;
  readonly sequence: number;
  readonly operation_id: string;
  readonly mode: string;
  readonly scope: Mh08Scope;
  readonly disposition: "succeeded" | "refused";
  readonly reason_code: string | null;
  readonly comparison: Mh08ComparisonVerdict | null;
  readonly record_hash: string;
  readonly previous_hash: string;
}

export interface Mh08JournalHandle {
  readonly root: string;
}

/**
 * Handles are runtime-authenticated by object identity, not by shape: a
 * structurally-identical clone of a real handle (same `root`, distinct
 * object) must still be refused. Membership is the ONLY thing this set
 * proves; it is never iterated or otherwise treated as a registry.
 */
const AUTHENTICATED_JOURNAL_HANDLES = new WeakSet<object>();

function authenticateJournalHandle(handle: unknown): asserts handle is Mh08JournalHandle {
  if (
    handle === null ||
    (typeof handle !== "object" && typeof handle !== "function") ||
    !AUTHENTICATED_JOURNAL_HANDLES.has(handle as object)
  ) {
    throw new Error(
      "journal handle was not returned by openMigrationJournal (unauthorized/unopened handle refused)"
    );
  }
}

export interface Mh08OwnerPacket {
  readonly schema_version: string;
  readonly suite_id: string;
  readonly suite_version: string;
  readonly owner_key: string;
  readonly evidence_identity: NeutralEvidenceIdentity;
  readonly stable_ids: readonly string[];
  readonly results: readonly NeutralScenarioResult[];
}

export interface Mh08EvaluationResult {
  readonly outcome: { readonly type: string; readonly disposition: string; readonly reason_code: string | null };
  readonly packet: Mh08OwnerPacket | null;
}

/**
 * Fields that may differ between legacy and candidate WITHOUT breaking
 * semantic equivalence — provenance only, never outcome or receipt semantics.
 */
export const MH08_PROVENANCE_ALLOWLIST: readonly string[] = neutralFreeze([
  "binding.run_id",
  "binding.operation_id",
  "binding.correlation_id",
]);

/** The default scope a full owner evaluation uses when the caller names none. */
const MH08_DEFAULT_SCOPE: Mh08Scope = neutralFreeze({
  host_id: "guild-runtime",
  capability_id: "cap.host-cutover",
  host_version: "0.0.0",
});

// ---------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------

function flattenRecord(value: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return out;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    const val = (value as Record<string, unknown>)[key];
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      Object.assign(out, flattenRecord(val, full));
    } else {
      out[full] = val;
    }
  }
  return out;
}

/**
 * Deterministic semantic comparison of two typed migration outcomes, with a
 * provenance-only allowlist and a complete compared-field/difference report.
 * Never mutates either input.
 *
 * Comparison admission is canonical-JSON-TEXT only: `legacyText` and
 * `candidateText` must each be a string, checked with a bare `typeof` before
 * anything else touches the value — a live object, an accessor, or a Proxy is
 * refused unread (no property access, so no trap ever fires). Only after both
 * pass the string check are they `JSON.parse`d into a fresh, inert graph that
 * production code never handed the caller and the caller never handed a
 * shape production has to defend against.
 */
/**
 * Closed, deterministic bounds on comparison admission text, enforced by a
 * bounded pre-scan BEFORE `JSON.parse`/`neutralCanonicalJson` ever walk the
 * text — so materially deep or complex input is refused by this scan
 * instead of letting the parser's or re-canonicalizer's own recursive
 * descent escape as an engine `RangeError`.
 */
const MH08_COMPARISON_MAX_TEXT_LENGTH = 262144;
const MH08_COMPARISON_MAX_DEPTH = 256;

/**
 * Walk `text` once, honoring JSON string quoting/escapes so a bracket
 * character inside a string is never counted as structure, and refuse text
 * whose nesting depth exceeds the closed cap above. Non-recursive (a single
 * `for` loop with an integer counter), so this scan itself cannot overflow
 * the call stack no matter how deep the input claims to be.
 */
function assertBoundedComparisonComplexity(text: string, label: string): void {
  if (text.length > MH08_COMPARISON_MAX_TEXT_LENGTH) {
    throw new Error(
      `compareMigrationOutcomes: ${label} exceeds the maximum comparison text size (materially complex comparison text refused)`
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{" || ch === "[") {
      depth += 1;
      if (depth > MH08_COMPARISON_MAX_DEPTH) {
        throw new Error(
          `compareMigrationOutcomes: ${label} exceeds the maximum comparison nesting depth (materially deep comparison text refused)`
        );
      }
    } else if (ch === "}" || ch === "]") {
      depth -= 1;
    }
  }
}

/**
 * Parse one admitted comparison input, then re-encode the fresh, inert
 * result through the production neutral canonical JSON encoder and require
 * byte-for-byte equality with the supplied text. Malformed, materially
 * deep/complex, or non-canonical text fails closed with a source-owned
 * detail that never echoes the raw text back to the caller. Every
 * parser/re-canonicalizer engine exception — including a `RangeError` from
 * either recursive descent — is caught and translated to an ordinary
 * source-owned `Error` rather than left to escape.
 */
function parseCanonicalComparisonText(text: string, label: string): unknown {
  assertBoundedComparisonComplexity(text, label);
  let parsed: unknown;
  let canonical: string;
  try {
    parsed = JSON.parse(text);
    canonical = neutralCanonicalJson(parsed);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(
        `compareMigrationOutcomes: ${label} exceeds the maximum comparison depth/complexity (materially deep or complex comparison text refused)`
      );
    }
    throw new Error(`compareMigrationOutcomes: ${label} is not valid JSON (malformed comparison text refused)`);
  }
  if (canonical !== text) {
    throw new Error(
      `compareMigrationOutcomes: ${label} is not canonical JSON text (must exact-round-trip through the neutral canonical encoder)`
    );
  }
  return parsed;
}

export function compareMigrationOutcomes(legacyText: unknown, candidateText: unknown): Mh08ComparisonVerdict {
  if (typeof legacyText !== "string" || typeof candidateText !== "string") {
    throw new Error(
      "compareMigrationOutcomes: comparison admission requires canonical JSON text (a string), not a live object"
    );
  }
  const legacy = parseCanonicalComparisonText(legacyText, "legacyText");
  const candidate = parseCanonicalComparisonText(candidateText, "candidateText");
  const flatLegacy = flattenRecord(legacy);
  const flatCandidate = flattenRecord(candidate);
  const fields = Array.from(new Set([...Object.keys(flatLegacy), ...Object.keys(flatCandidate)])).sort();
  const differences: Mh08ComparisonDifference[] = [];
  for (const field of fields) {
    if (MH08_PROVENANCE_ALLOWLIST.indexOf(field) !== -1) continue;
    const a = neutralCanonicalJson(flatLegacy[field] ?? null);
    const b = neutralCanonicalJson(flatCandidate[field] ?? null);
    if (a !== b) {
      differences.push({ field, legacy: flatLegacy[field] ?? null, candidate: flatCandidate[field] ?? null });
    }
  }
  return neutralFreeze({
    equivalent: differences.length === 0,
    compared_fields: fields,
    differences,
    allowlisted_fields: [...MH08_PROVENANCE_ALLOWLIST],
  }) as Mh08ComparisonVerdict;
}

// ---------------------------------------------------------------------------
// The contained, atomic, hash-linked journal
// ---------------------------------------------------------------------------

function journalPath(root: string): string {
  return path.join(root, "journal.ndjson");
}

/** Walk `base` down to `resolved`, refusing any symlink component along the way. */
function assertNoSymlinkComponents(base: string, resolved: string): void {
  const rel = path.relative(base, resolved);
  if (rel.length === 0) return;
  let current = base;
  for (const segment of rel.split(path.sep)) {
    if (segment.length === 0) continue;
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`journal root path contains a symlink component: ${current}`);
    }
  }
}

/**
 * Walk upward from `startDir` for the nearest project root: the first
 * ancestor owning a `.git` directory, falling back to the nearest ancestor
 * that already owns a `.guild` directory, falling back to `startDir` itself.
 * Self-contained (no cross-module import) so this file's containment
 * boundary never depends on another module's resolution behavior.
 */
function nearestProjectRoot(startDir: string): string {
  const resolvedStart = path.resolve(startDir);
  let current = resolvedStart;
  let nearestGuildDir: string | null = null;
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      try {
        if (fs.existsSync(guildDir) && fs.statSync(guildDir).isDirectory()) nearestGuildDir = current;
      } catch {
        // The candidate disappeared between exists/stat; keep walking upward.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return nearestGuildDir ?? resolvedStart;
    current = parent;
  }
}

/**
 * The durable `.guild/runs` bases this process trusts: the nearest project
 * root derived from `process.cwd()`, plus (when set) the nearest project
 * root derived from `GUILD_CWD` — a UNION, not an either/or. An umbrella
 * `GUILD_CWD` (e.g. a workspace root that owns its own `.git`) must never
 * shadow the plugin/project sub-repo that actually owns the controller call.
 */
function trustedDurableBases(): readonly string[] {
  const bases = new Set<string>();
  bases.add(path.resolve(nearestProjectRoot(process.cwd()), ".guild", "runs"));
  const guildCwd = process.env["GUILD_CWD"];
  if (typeof guildCwd === "string" && guildCwd.length > 0) {
    bases.add(path.resolve(nearestProjectRoot(guildCwd), ".guild", "runs"));
  }
  return [...bases];
}

/**
 * The two trusted containment roots: disposable conformance roots under the
 * canonical OS temp directory, and durable run-scoped roots under any
 * trusted project's `.guild/runs` tree (see `trustedDurableBases`). Returns
 * the matched base (used to bound the subsequent symlink-component walk) or
 * `null` if `resolved` is contained by neither.
 */
function matchTrustedBase(resolved: string): string | null {
  const tmpBase = path.resolve(os.tmpdir());
  if (resolved === tmpBase || resolved.indexOf(tmpBase + path.sep) === 0) {
    return tmpBase;
  }
  for (const durableBase of trustedDurableBases()) {
    if (resolved === durableBase || resolved.indexOf(durableBase + path.sep) === 0) {
      return durableBase;
    }
  }
  return null;
}

/**
 * Open (validate, never create) a journal root.
 *
 * Order is deliberate: type checks (symlink / non-directory) run before the
 * containment check, so a preimage that is not even a directory is refused
 * with the specific "symlink|not a directory" reason rather than a generic
 * containment refusal.
 */
export function openMigrationJournal(root: unknown): Mh08JournalHandle {
  if (typeof root !== "string" || root.length === 0) {
    throw new Error("openMigrationJournal: journal root must be a non-empty string");
  }
  const resolved = path.resolve(root);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    // A preimage that cannot even be observed (e.g. reached by walking past a
    // real root via `..` traversal) cannot be proven contained; refuse it as
    // an escape rather than reporting an ordinary absence.
    throw new Error(
      `openMigrationJournal: journal root does not exist or escapes the controller-owned containment boundary (traversal refused): ${resolved}`
    );
  }
  if (stat.isSymbolicLink()) {
    throw new Error(`openMigrationJournal: journal root is a symlink, not a contained directory: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`openMigrationJournal: journal root is not a directory (non-directory preimage): ${resolved}`);
  }
  const matchedBase = matchTrustedBase(resolved);
  if (matchedBase === null) {
    throw new Error(
      `openMigrationJournal: journal root escapes the controller-owned containment boundary (untrusted root, traversal refused): ${resolved}`
    );
  }
  assertNoSymlinkComponents(matchedBase, resolved);
  const handle = neutralFreeze({ root: resolved }) as Mh08JournalHandle;
  AUTHENTICATED_JOURNAL_HANDLES.add(handle);
  return handle;
}

function computeRecordHash(input: {
  readonly sequence: number;
  readonly operation_id: string;
  readonly mode: string;
  readonly scope: Mh08Scope;
  readonly disposition: string;
  readonly reason_code: string | null;
  readonly comparison: Mh08ComparisonVerdict | null;
  readonly previous_hash: string;
}): string {
  return `sha256:${crypto.createHash("sha256").update(neutralCanonicalJson(input)).digest("hex")}`;
}

/**
 * Read and verify the journal at `handle.root`.
 *
 * Refuses: a partial final write (a `journal.ndjson.<n>.tmp` sibling still on
 * disk), a sequence gap, and a hash chain that does not verify (hash drift or
 * tampered content). Accepts a bare `{ root }` shape so a partial-write or
 * gap probe can hand this a root that was never opened.
 */
export function readMigrationJournal(handle: { readonly root: string }): readonly Mh08DecisionRecord[] {
  authenticateJournalHandle(handle);
  const root = handle.root;
  const entries = fs.existsSync(root) ? fs.readdirSync(root) : [];
  const partialWrites = entries.filter((name) => /^journal\.ndjson\.\d+\.tmp$/.test(name));
  if (partialWrites.length > 0) {
    throw new Error(
      `readMigrationJournal: refusing a partial/incomplete journal write: ${partialWrites.join(", ")}`
    );
  }
  const file = journalPath(root);
  let fileStat: fs.Stats;
  try {
    fileStat = fs.lstatSync(file);
  } catch {
    return neutralFreeze([]);
  }
  if (fileStat.isSymbolicLink()) {
    throw new Error(`readMigrationJournal: journal.ndjson is a symlink, not a contained regular file: ${file}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`readMigrationJournal: journal.ndjson is not a regular file: ${file}`);
  }
  // Prefer O_NOFOLLOW so the check/use seam also fails closed against a
  // symlink swapped in between the lstat above and this open.
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const fd = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  let content: string;
  try {
    content = fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  const records: Mh08DecisionRecord[] = lines.map((line) => JSON.parse(line) as Mh08DecisionRecord);

  let previous = "sha256:genesis";
  let expectedSequence = 1;
  for (const record of records) {
    if (record.sequence !== expectedSequence) {
      throw new Error(
        `readMigrationJournal: journal sequence gap — expected ${expectedSequence}, found ${record.sequence}`
      );
    }
    if (record.previous_hash !== previous) {
      throw new Error(`readMigrationJournal: journal hash drift at sequence ${record.sequence}`);
    }
    const recomputed = computeRecordHash({
      sequence: record.sequence,
      operation_id: record.operation_id,
      mode: record.mode,
      scope: record.scope,
      disposition: record.disposition,
      reason_code: record.reason_code,
      comparison: record.comparison,
      previous_hash: record.previous_hash,
    });
    if (recomputed !== record.record_hash) {
      throw new Error(`readMigrationJournal: journal record hash mismatch at sequence ${record.sequence}`);
    }
    previous = record.record_hash;
    expectedSequence += 1;
  }
  return neutralFreeze(records);
}

export interface Mh08AppendInput {
  readonly operation_id: string;
  readonly mode: string;
  readonly scope: Mh08Scope;
  readonly disposition: "succeeded" | "refused";
  readonly reason_code: string | null;
  readonly comparison: Mh08ComparisonVerdict | null;
}

/**
 * Append one schema-versioned, hash-linked decision record.
 *
 * Idempotent under a repeated operation id with IDENTICAL effect (mode,
 * scope, disposition, reason code, comparison); refuses a repeated operation
 * id whose content diverges. Publication is atomic: write to a per-sequence
 * temp file, then rename over the journal. Never mutates `input`.
 */
export function appendMigrationDecision(
  handle: { readonly root: string },
  input: Mh08AppendInput
): Mh08DecisionRecord {
  authenticateJournalHandle(handle);
  if (MH08_MODES.indexOf(input.mode) === -1) {
    throw new Error(
      `appendMigrationDecision: mode ${JSON.stringify(input.mode)} is not in the closed vocabulary legacy | shadow | current | rollback`
    );
  }

  // A fail-closed, per-root exclusive lock (`open(..., "wx")` throws EEXIST
  // when another append on the same root has not yet released it) serializes
  // the read-compute-write critical section. A racing second writer refuses
  // outright rather than silently overwriting the first writer's rename —
  // the corrected concurrent-append contract.
  const file = journalPath(handle.root);
  const lockPath = `${file}.lock`;
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch {
    throw new Error(
      `appendMigrationDecision: concurrent journal write in progress on this root, refusing (fail-closed): ${handle.root}`
    );
  }

  try {
    const existing = readMigrationJournal(handle);
    const reasonCode = input.reason_code ?? null;
    const comparison = input.comparison ?? null;

    const prior = existing.find((record) => record.operation_id === input.operation_id);
    if (prior !== undefined) {
      const sameEffect =
        prior.mode === input.mode &&
        prior.disposition === input.disposition &&
        prior.reason_code === reasonCode &&
        neutralCanonicalJson(prior.scope) === neutralCanonicalJson(input.scope) &&
        neutralCanonicalJson(prior.comparison) === neutralCanonicalJson(comparison);
      if (!sameEffect) {
        throw new Error(
          `appendMigrationDecision: operation id ${input.operation_id} reused with divergent content`
        );
      }
      return prior;
    }

    const previousHash = existing.length > 0 ? existing[existing.length - 1].record_hash : "sha256:genesis";
    const sequence = existing.length + 1;
    const scope: Mh08Scope = { host_id: input.scope.host_id, capability_id: input.scope.capability_id, host_version: input.scope.host_version };
    const base = {
      sequence,
      operation_id: input.operation_id,
      mode: input.mode,
      scope,
      disposition: input.disposition,
      reason_code: reasonCode,
      comparison,
      previous_hash: previousHash,
    };
    const hash = computeRecordHash(base);
    const record = neutralFreeze({
      schema_version: MH08_DECISION_SCHEMA,
      ...base,
      record_hash: hash,
    }) as Mh08DecisionRecord;

    const tmp = `${file}.${sequence}.tmp`;
    const priorContent = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    fs.writeFileSync(tmp, `${priorContent}${JSON.stringify(record)}\n`);
    fs.renameSync(tmp, file);
    return record;
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Selection resolution
// ---------------------------------------------------------------------------

function sameScope(a: Mh08Scope, b: Mh08Scope): boolean {
  return a.host_id === b.host_id && a.capability_id === b.capability_id && a.host_version === b.host_version;
}

/**
 * The five source-owned selection rules: shadow retains legacy authority;
 * exact-scope current (after a succeeded record) selects the candidate;
 * unscoped tuples remain legacy; rollback resolves to legacy; absence of any
 * record defaults to legacy.
 */
export function resolveEffectiveSelection(
  records: readonly Mh08DecisionRecord[],
  scope: Mh08Scope
): string {
  const forScope = (records ?? []).filter((record) => sameScope(record.scope, scope));
  if (forScope.length === 0) return "legacy";
  const last = forScope[forScope.length - 1];
  if (last.disposition !== "succeeded") return "legacy";
  if (last.mode === "current") return "current";
  return "legacy";
}

// ---------------------------------------------------------------------------
// The four-scenario owner evaluation
// ---------------------------------------------------------------------------

function scenarioScope(base: Mh08Scope, stableId: string): Mh08Scope {
  return { host_id: base.host_id, capability_id: `${base.capability_id}#${stableId}`, host_version: base.host_version };
}

/** The closed neutral reason code for missing/incomplete caller-observed evidence. */
const MH08_EVIDENCE_INCOMPLETE_REASON_CODE = "scenario_evidence_incomplete";

/** The closed neutral reason code for an otherwise-valid scenario whose rule check fails. */
const MH08_RESULT_MISMATCH_REASON_CODE = "scenario_result_mismatch";

interface Mh08ScenarioEvidenceEntry {
  readonly legacy_outcome: string;
  readonly candidate_outcome: string;
  readonly side_effect_authority?: unknown;
}

/**
 * Read one scenario's evidence entry from the caller-supplied
 * `scenario_evidence` map, admitting only a shape whose legacy/candidate
 * outcomes are already canonical JSON text (never a live object) — a
 * missing or malformed entry returns `null` rather than throwing, so the
 * scenario runner can turn it into a nameable evidence-incomplete refusal
 * instead of manufacturing a synthetic outcome.
 */
function scenarioEvidenceFor(request: Mh08EvaluationRequest, stableId: string): Mh08ScenarioEvidenceEntry | null {
  const map = (request.scenario_evidence ?? {}) as Record<string, unknown>;
  const raw = map[stableId];
  if (raw === null || typeof raw !== "object") return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.legacy_outcome !== "string" || typeof entry.candidate_outcome !== "string") return null;
  return {
    legacy_outcome: entry.legacy_outcome,
    candidate_outcome: entry.candidate_outcome,
    side_effect_authority: entry.side_effect_authority,
  };
}

/** STR-001's explicit side-effect-authority evidence: legacy committed, candidate did not. */
function sideEffectAuthorityProvesNoCandidateCommit(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (typeof record.legacy_commits !== "number" || typeof record.candidate_commits !== "number") return false;
  return record.legacy_commits > 0 && record.candidate_commits === 0;
}

function hasSideEffectAuthorityShape(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.legacy_commits === "number" && typeof record.candidate_commits === "number";
}

/**
 * Run one of the four frozen MH-08 scenarios against a shared, isolated
 * scope, evaluated ONLY from the caller's `scenario_evidence` entry for this
 * stable id. Production never manufactures a legacy/candidate outcome
 * internally — absent or malformed evidence is a closed, evidence-named
 * refusal rather than a manufactured success.
 */
function runMh08Scenario(
  handle: Mh08JournalHandle,
  runId: string,
  baseScope: Mh08Scope,
  stableId: string,
  request: Mh08EvaluationRequest
): { readonly disposition: "succeeded" | "refused"; readonly reason_code: string | null } {
  const scope = scenarioScope(baseScope, stableId);
  const evidence = scenarioEvidenceFor(request, stableId);
  if (evidence === null) {
    return { disposition: "refused", reason_code: MH08_EVIDENCE_INCOMPLETE_REASON_CODE };
  }

  if (stableId === "MHRC-STR-001") {
    if (!hasSideEffectAuthorityShape(evidence.side_effect_authority)) {
      return { disposition: "refused", reason_code: MH08_EVIDENCE_INCOMPLETE_REASON_CODE };
    }
    const comparison = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison.equivalent ? "succeeded" : "refused",
      reason_code: comparison.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison,
    });
    if (!comparison.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    const authorityOk = sideEffectAuthorityProvesNoCandidateCommit(evidence.side_effect_authority);
    return authorityOk
      ? { disposition: "succeeded", reason_code: null }
      : { disposition: "refused", reason_code: MH08_RESULT_MISMATCH_REASON_CODE };
  }

  if (stableId === "MHRC-STR-002") {
    const comparison = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison.equivalent ? "succeeded" : "refused",
      reason_code: comparison.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison,
    });
    if (!comparison.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:current`,
      mode: "current",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const records = readMigrationJournal(handle);
    const inScope = resolveEffectiveSelection(records, scope);
    const outOfScope = resolveEffectiveSelection(records, { ...scope, host_id: `${scope.host_id}-control-out-of-scope` });
    const ok = inScope === "current" && outOfScope === "legacy";
    return { disposition: ok ? "succeeded" : "refused", reason_code: ok ? null : MH08_RESULT_MISMATCH_REASON_CODE };
  }

  if (stableId === "MHRC-STR-003") {
    const comparison = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:shadow`,
      mode: "shadow",
      scope,
      disposition: comparison.equivalent ? "succeeded" : "refused",
      reason_code: comparison.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
      comparison,
    });
    if (!comparison.equivalent) {
      return { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
    }
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:current`,
      mode: "current",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    appendMigrationDecision(handle, {
      operation_id: `${runId}:${stableId}:rollback`,
      mode: "rollback",
      scope,
      disposition: "succeeded",
      reason_code: null,
      comparison: null,
    });
    const records = readMigrationJournal(handle);
    const effective = resolveEffectiveSelection(records, scope);
    const scenarioRecordCount = records.filter((record) => sameScope(record.scope, scope)).length;
    const ok = effective === "legacy" && scenarioRecordCount === 3;
    return { disposition: ok ? "succeeded" : "refused", reason_code: ok ? null : MH08_RESULT_MISMATCH_REASON_CODE };
  }

  // MHRC-STR-004: the divergence refusal — succeeds only as a typed refusal.
  const comparison = compareMigrationOutcomes(evidence.legacy_outcome, evidence.candidate_outcome);
  appendMigrationDecision(handle, {
    operation_id: `${runId}:${stableId}:shadow`,
    mode: "shadow",
    scope,
    disposition: comparison.equivalent ? "succeeded" : "refused",
    reason_code: comparison.equivalent ? null : MH08_DIVERGENCE_REASON_CODE,
    comparison,
  });
  return comparison.equivalent
    ? { disposition: "refused", reason_code: MH08_RESULT_MISMATCH_REASON_CODE }
    : { disposition: "refused", reason_code: MH08_DIVERGENCE_REASON_CODE };
}

// ---------------------------------------------------------------------------
// The public evaluator entrypoint
// ---------------------------------------------------------------------------

export interface Mh08EvaluationRequest {
  readonly run_id?: unknown;
  readonly claimant_id?: unknown;
  readonly operation_id?: unknown;
  readonly mode?: unknown;
  readonly scenario?: unknown;
  readonly scope?: unknown;
  readonly legacy_outcome?: unknown;
  readonly candidate_outcome?: unknown;
  readonly journal_root?: unknown;
  readonly evidence_identity?: unknown;
  readonly receipt_refs?: unknown;
  readonly evidence_freshness?: unknown;
  readonly scenario_evidence?: unknown;
}

function asScope(value: unknown): Mh08Scope {
  if (value === null || typeof value !== "object") return MH08_DEFAULT_SCOPE;
  const record = value as Record<string, unknown>;
  return {
    host_id: typeof record.host_id === "string" ? record.host_id : MH08_DEFAULT_SCOPE.host_id,
    capability_id: typeof record.capability_id === "string" ? record.capability_id : MH08_DEFAULT_SCOPE.capability_id,
    host_version: typeof record.host_version === "string" ? record.host_version : MH08_DEFAULT_SCOPE.host_version,
  };
}

/**
 * Evaluate host-cutover conformance.
 *
 * Two modes, chosen by request shape, never by caller intent alone:
 *
 *   - `mode` present: a SINGLE migration operation (legacy / shadow / current
 *     / rollback) is applied to the journal at `journal_root`, scoped to
 *     `scope`, and its typed outcome is returned (`packet: null`).
 *   - `mode` absent: the full four-scenario `W4/MH-08` owner evaluation runs
 *     against the journal at `journal_root` and returns one frozen
 *     `guild.conformance_owner_packet.v1` packet with ordered ids
 *     `MHRC-STR-001..004`.
 *
 * Never mutates `request` or anything it references.
 */
export function evaluateHostCutoverConformance(request: unknown): Mh08EvaluationResult {
  const req = (request ?? {}) as Mh08EvaluationRequest;
  const runId = typeof req.run_id === "string" ? req.run_id : "";
  const evidenceIdentity = (req.evidence_identity ?? {}) as Record<string, unknown>;
  const receiptRefs = (req.receipt_refs ?? {}) as Record<string, string>;
  const evidenceFreshness = (req.evidence_freshness ?? {}) as Record<string, string>;
  const baseScope = asScope(req.scope);

  const handle = openMigrationJournal(req.journal_root);

  if (typeof req.mode === "string") {
    const mode = req.mode;
    const operationId =
      typeof req.operation_id === "string" && req.operation_id.length > 0
        ? req.operation_id
        : `${runId}:${mode}:${neutralCanonicalJson(baseScope)}`;

    let disposition: "succeeded" | "refused" = "succeeded";
    let reasonCode: string | null = null;
    let comparison: Mh08ComparisonVerdict | null = null;

    if (mode === "current") {
      const records = readMigrationJournal(handle);
      const priorEquivalentShadow = records.some(
        (record) =>
          record.mode === "shadow" &&
          record.disposition === "succeeded" &&
          record.comparison !== null &&
          record.comparison.equivalent === true &&
          sameScope(record.scope, baseScope)
      );
      if (!priorEquivalentShadow) {
        disposition = "refused";
        reasonCode = "scenario_result_mismatch";
      }
    } else if (mode === "shadow" && req.legacy_outcome !== undefined && req.candidate_outcome !== undefined) {
      comparison = compareMigrationOutcomes(req.legacy_outcome, req.candidate_outcome);
      if (!comparison.equivalent) {
        disposition = "refused";
        reasonCode = MH08_DIVERGENCE_REASON_CODE;
      }
    }

    const record = appendMigrationDecision(handle, {
      operation_id: operationId,
      mode,
      scope: baseScope,
      disposition,
      reason_code: reasonCode,
      comparison,
    });

    return {
      outcome: { type: "guild.migration_outcome.v1", disposition: record.disposition, reason_code: record.reason_code },
      packet: null,
    };
  }

  const results: NeutralScenarioResult[] = MH08_SCENARIO_IDS.map((stableId) => {
    const verdict = runMh08Scenario(handle, runId, baseScope, stableId, req);
    return {
      stable_id: stableId,
      outcome_type: "guild.migration_outcome.v1",
      disposition: verdict.disposition,
      reason_code: verdict.reason_code,
      receipt_ref: receiptRefs[stableId],
      evidence_identity: { ...evidenceIdentity },
      evidence_freshness: evidenceFreshness[stableId],
    } as unknown as NeutralScenarioResult;
  });

  const packet = neutralFreeze({
    schema_version: NEUTRAL_ASSEMBLY_PACKET_SCHEMA,
    suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    owner_key: MH08_OWNER_KEY,
    evidence_identity: { ...evidenceIdentity },
    stable_ids: [...MH08_SCENARIO_IDS],
    results,
  }) as unknown as Mh08OwnerPacket;

  // The top-level outcome is HONEST, derived from the four scenario results
  // — never hard-coded. It reports succeeded only when STR-001..003 each
  // succeeded and STR-004 produced its expected typed divergence refusal;
  // any evidence-incomplete required scenario refuses the top level with
  // `scenario_evidence_incomplete` rather than manufacturing/reinterpreting
  // scenario evidence.
  const requiredSucceeded = ["MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003"].every(
    (stableId) => results.find((r) => r.stable_id === stableId)?.disposition === "succeeded"
  );
  const str004Result = results.find((r) => r.stable_id === "MHRC-STR-004");
  const str004ExpectedDivergence =
    str004Result?.disposition === "refused" && str004Result?.reason_code === MH08_DIVERGENCE_REASON_CODE;
  const topLevelSucceeded = requiredSucceeded && str004ExpectedDivergence;
  let topLevelReasonCode: string | null = null;
  if (!topLevelSucceeded) {
    const anyEvidenceIncomplete = results.some((r) => r.reason_code === MH08_EVIDENCE_INCOMPLETE_REASON_CODE);
    topLevelReasonCode = anyEvidenceIncomplete ? MH08_EVIDENCE_INCOMPLETE_REASON_CODE : MH08_RESULT_MISMATCH_REASON_CODE;
  }

  return {
    outcome: {
      type: "guild.migration_outcome.v1",
      disposition: topLevelSucceeded ? "succeeded" : "refused",
      reason_code: topLevelReasonCode,
    },
    packet,
  };
}
