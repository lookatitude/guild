/**
 * src/modules/capability/workflows/compatibility-usage.ts
 *
 * `guild.compatibility_usage.v1` — the MEASURED input to D03's G5 removal gate.
 *
 * Spec S8. Closes audit gap F4: *"G5 depends on 'compatibility usage telemetry' that
 * nothing defines. No mechanism is specified for instrumenting legacy template/
 * domain-skill use, so the removal gate has no measurable input."*
 *
 * WHAT THIS FILE IS
 *   The typed payload one read of a SHIPPED template (15) or SHIPPED domain skill
 *   (58) produces, the closed vocabulary of reasons such a read can happen for, and
 *   the pure rollup that turns a window of those payloads into a G5 verdict.
 *
 * WHAT THIS FILE IS NOT
 *   It is not a journal. It performs NO I/O, reads no clock, and appends nothing.
 *   Emission rides the EXISTING MH-06 receipt journal (`guild.observability.v1`,
 *   telemetry/receipt-journal.ts) — the plan is explicit that capability discovery
 *   "should emit receipts through this API after it stabilizes, NOT invent another
 *   journal". This module supplies the payload type and the query; the journal
 *   supplies durability, ordering and hashing.
 *
 * NO CLOSED VOCABULARY IS WIDENED. A compatibility read rides as:
 *
 *   event_name   "task.dispatch"                    (already in RECEIPT_EVENT_NAMES)
 *   outcome_type "guild.capability_outcome.v1"      (already in RECEIPT_OUTCOME_TYPES)
 *   disposition  "degraded"                         (already in RECEIPT_DISPOSITIONS)
 *
 * and the specifics live in the outcome payload below. `degraded` is the honest
 * label for a legacy read during the migration window: the work succeeded, but via
 * the path we are retiring. Adding a new event name would be a contract change for
 * something the existing set already expresses.
 *
 * Pure library module; there is no CLI entrypoint. Reached through the capability
 * module's public index.
 */

import { types as nodeTypes } from "util";

import { CAPABILITY_RESOLVER_MODES, type CapabilityResolverMode } from "../../config";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const COMPATIBILITY_USAGE_SCHEMA = "guild.compatibility_usage.v1" as const;

/**
 * The receipt vocabulary members a compatibility read binds to. Exported as
 * constants so an emission point cannot quietly pick a different event name and
 * fall out of the G5 query's reach — the binding is part of the contract, not a
 * convention at the call site.
 */
export const COMPATIBILITY_USAGE_EVENT_NAME = "task.dispatch" as const;
export const COMPATIBILITY_USAGE_OUTCOME_TYPE = "guild.capability_outcome.v1" as const;
export const COMPATIBILITY_USAGE_DISPOSITION = "degraded" as const;

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

// EVERY exported vocabulary is Object.freeze'd, not merely `readonly`. TypeScript's
// readonly is erased at compile time: the emitted array is mutable, so a caller could
// `BENIGN_COMPATIBILITY_READ_REASONS.push("rollback")` and silently exclude rollback
// reads from the G5 count — a FALSE CLEAN on a deletion gate. The predicates below
// read from PRIVATE frozen Sets built once at module load, so even a successful
// mutation of an exported array cannot change a verdict.

/** Which legacy surface was read. */
export const COMPATIBILITY_ASSET_KINDS = Object.freeze([
  "shipped_template",
  "shipped_domain_skill",
] as const);
export type CompatibilityAssetKind = (typeof COMPATIBILITY_ASSET_KINDS)[number];

/**
 * Why the legacy asset was reached instead of a project-local definition.
 *
 * THIS IS THE LOAD-BEARING DISTINCTION IN S8. Two of these reasons are the
 * migration working CORRECTLY, not evidence of legacy dependence:
 *
 *   mint_source        minting a project role FROM a shipped template reads the
 *                      template by design — that read is the migration succeeding
 *   shadow_comparison  the A-side of a shadow compare is supposed to be legacy
 *
 * A naive total of all reads therefore NEVER reaches zero and G5 could never pass.
 * The G5 input is the DEPENDENCE subset — see `isDependenceRead`.
 */
export const COMPATIBILITY_READ_REASONS = Object.freeze([
  "no_project_definition",
  "explicit_legacy_mode",
  "rollback",
  "mint_source",
  "shadow_comparison",
] as const);
export type CompatibilityReadReason = (typeof COMPATIBILITY_READ_REASONS)[number];

/**
 * The reasons that indicate GENUINE legacy dependence — the only ones G5 counts.
 * Derived from the full vocabulary by exclusion so a newly added reason is counted
 * as dependence by DEFAULT (fail-closed): a future reason that is actually benign
 * must be added to `BENIGN_COMPATIBILITY_READ_REASONS` deliberately, rather than a
 * forgotten one silently suppressing the gate.
 */
export const BENIGN_COMPATIBILITY_READ_REASONS: readonly CompatibilityReadReason[] =
  Object.freeze(["mint_source", "shadow_comparison"] as const);

export const DEPENDENCE_COMPATIBILITY_READ_REASONS: readonly CompatibilityReadReason[] =
  Object.freeze(
    COMPATIBILITY_READ_REASONS.filter(
      (r) => !BENIGN_COMPATIBILITY_READ_REASONS.includes(r),
    ) as CompatibilityReadReason[],
  );

/**
 * PRIVATE frozen lookup sets, snapshotted at module load. The exported arrays exist
 * for readers; THESE decide verdicts. Mutating an export cannot reach them.
 */
const BENIGN_REASON_SET: ReadonlySet<string> = new Set(BENIGN_COMPATIBILITY_READ_REASONS);
const READ_REASON_SET: ReadonlySet<string> = new Set(COMPATIBILITY_READ_REASONS);
const ASSET_KIND_SET: ReadonlySet<string> = new Set(COMPATIBILITY_ASSET_KINDS);
const RESOLVER_MODE_SET: ReadonlySet<string> = new Set(CAPABILITY_RESOLVER_MODES);

/** Canonical SHA-256 hex. A hash that cannot be a hash proves nothing about bytes read. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Maximum length for any scalar in this contract. Ids, paths and hashes are short by
 * nature; an unbounded "non-empty string" is a smuggling channel (a sibling lane found
 * a 12KB agent body riding in a field schema-d as a commit id).
 */
const MAX_SCALAR_LEN = 512;

/** Control characters never appear in an id, a path, or a hash. The sharp universal guard. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Slug form for an asset/specialist id — also the CANONICAL spelling (see readCanonicalId). */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * A plugin-install-relative path in CANONICAL form. Non-canonical spellings are
 * REJECTED, never normalized: accept-and-repair would let two spellings of one file
 * (`skills/x/SKILL.md` vs `skills/./x/SKILL.md`) be treated as one after the fact,
 * while every count taken BEFORE normalization already double-counted.
 */
function isCanonicalRelPath(v: string): boolean {
  if (v.length === 0 || v.length > MAX_SCALAR_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false;        // backslash separators are a second spelling
  if (v.startsWith("/")) return false;       // must be relative
  if (v.includes("//")) return false;        // empty segment
  const segs = v.split("/");
  return segs.every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** A bounded, control-char-free string. */
function isBoundedStr(v: unknown): v is string {
  return (
    typeof v === "string" && v.length > 0 && v.length <= MAX_SCALAR_LEN && !CONTROL_CHARS.test(v)
  );
}

/** A canonical id: bounded, control-char-free, slug-shaped. One referent, one spelling. */
function isCanonicalId(v: unknown): v is string {
  return isBoundedStr(v) && SLUG.test(v);
}

// ---------------------------------------------------------------------------
// Strict options reading (cross-lane defect class: options-object TOCTOU)
// ---------------------------------------------------------------------------

/**
 * Resolve a caller-supplied OPTIONS object into a plain own-data snapshot, or null.
 *
 * Why this exists: hardening the artifact while reading the options bag with plain
 * property access leaves the window open. A getter (or Proxy) on the options executes
 * DURING validation, and every field read twice — `if (!isCount(o.unreadable)) … else if
 * (o.unreadable > 0)` — can return a different value each time. In `evaluateG5` that is
 * a direct FALSE CLEAN: return 5 to the validity check, 0 to the threshold check, and a
 * torn journal passes a deletion gate.
 *
 * So: reject Proxy, reject a non-Object.prototype/null prototype, reject symbol keys
 * (getOwnPropertyNames does NOT see them), reject unknown keys, reject accessor
 * properties, and snapshot every value through its own DATA descriptor exactly once.
 * After this returns, nothing caller-supplied can execute again.
 */
function readOptions(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (nodeTypes.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null; // accessor ⇒ reject, never invoke
    out[key] = desc.value;
  }
  return out;
}

/** Snapshot a caller-supplied array into a fresh dense array of own data values, or null. */
function readArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || nodeTypes.isProxy(value)) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  if (!lenDesc || !("value" in lenDesc) || !isCount(lenDesc.value)) return null;
  const out: unknown[] = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !("value" in d)) return null; // hole or accessor
    out.push(d.value);
  }
  return out;
}

/** A count that is trustworthy: a non-negative safe integer. NaN/negative/float are not. */
function isCount(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

// ---------------------------------------------------------------------------
// The outcome payload
// ---------------------------------------------------------------------------

/** One read of one legacy asset, as it rides in the receipt's outcome payload. */
export interface CompatibilityUsageV1 {
  readonly schema_version: typeof COMPATIBILITY_USAGE_SCHEMA;

  /** Which legacy surface was read. */
  readonly asset_kind: CompatibilityAssetKind;
  /** Template role slug or skill name. */
  readonly asset_id: string;
  /** Plugin-install-relative path. */
  readonly asset_path: string;
  /** sha256 of the bytes read — proves WHICH version was consumed (S8 invariant 4). */
  readonly content_hash: string;

  /** Why the legacy asset was reached rather than a project-local definition. */
  readonly reason: CompatibilityReadReason;
  /** Resolver mode at read time — correlates usage with migration phase. */
  readonly resolver_mode: CapabilityResolverMode;

  /**
   * True ONLY for test/tooling reads. Set at the EMISSION POINT (S8 invariant 3) —
   * never inferred downstream from a path heuristic, because G5's criterion is
   * "zero NON-TEST reads" and a filter applied later is a filter that can be wrong.
   */
  readonly synthetic: boolean;
  /** The lane, when there is one. */
  readonly specialist_id: string | null;
}

// ---------------------------------------------------------------------------
// Validation — the fail-closed `specialist-identity.ts` idiom
// ---------------------------------------------------------------------------
//
// Typed-or-null, never throws, never repairs. Reads every field through its OWN
// DATA DESCRIPTOR so a caller-supplied getter is never invoked (it could throw, or
// return a different value on each read) and the prototype chain is never walked.
// Proxies are rejected outright: a Proxy can lie on every trap, and no userland
// check defeats a consistent liar. The real input path is a JSON-parsed journal
// payload, never an exotic object.
//
// This matters more here than for a typical payload: a record that validates but
// then reads back differently would corrupt the G5 count — the one number the
// removal gate rests on.

/** Non-null, non-array, prototype `Object.prototype` or `null`, not a Proxy. */
function isPlainDataObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (nodeTypes.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** The own DATA value of `key`, or a marker. An accessor is rejected, never invoked. */
function ownDataProp(
  o: object,
  key: string,
): { kind: "absent" } | { kind: "accessor" } | { kind: "data"; value: unknown } {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}

/** Own data value or `undefined` — a missing OR accessor property both read as absent. */
function ownValue(o: object, key: string): unknown {
  const p = ownDataProp(o, key);
  return p.kind === "data" ? p.value : undefined;
}

const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** The closed key set — an unknown key is a REJECT, not something to ignore. */
const COMPATIBILITY_USAGE_KEYS: readonly string[] = [
  "schema_version",
  "asset_kind",
  "asset_id",
  "asset_path",
  "content_hash",
  "reason",
  "resolver_mode",
  "synthetic",
  "specialist_id",
];

/**
 * Parse an untrusted value into a frozen `CompatibilityUsageV1`, or `null`.
 *
 * The returned object is a FRESH copy built from the values that were validated, so
 * no later read can differ from what passed the checks (no time-of-check /
 * time-of-use gap). Never throws.
 */
export function parseCompatibilityUsageV1(value: unknown): CompatibilityUsageV1 | null {
  try {
    if (!isPlainDataObject(value)) return null;
    // Symbol-keyed data is rejected fail-closed rather than silently dropped.
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    // getOwnPropertyNames, NOT Object.keys: an unknown NON-ENUMERABLE own property is
    // still an own property, and a closed key set that only inspects enumerable keys
    // is not closed at all.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (!COMPATIBILITY_USAGE_KEYS.includes(key)) return null;
    }

    if (ownValue(value, "schema_version") !== COMPATIBILITY_USAGE_SCHEMA) return null;

    const assetKind = ownValue(value, "asset_kind");
    if (typeof assetKind !== "string" || !ASSET_KIND_SET.has(assetKind)) return null;

    // CANONICAL id: bounded, control-char-free, slug-shaped. Rejecting non-canonical
    // spellings is what stops a dependence read hiding under an alias while the
    // canonical id reports zero — the by_asset grouping key must have ONE spelling.
    const assetId = ownValue(value, "asset_id");
    if (!isCanonicalId(assetId)) return null;

    const assetPath = ownValue(value, "asset_path");
    if (!isBoundedStr(assetPath) || !isCanonicalRelPath(assetPath)) return null;

    // S8 invariant 4: mandatory, so a rollup can distinguish versions of one asset.
    // Shape-checked, not merely non-empty: the field's entire purpose is to prove WHICH
    // bytes were consumed, and "x" proves nothing.
    const contentHash = ownValue(value, "content_hash");
    if (!isNonEmptyStr(contentHash) || !SHA256_HEX.test(contentHash)) return null;

    const reason = ownValue(value, "reason");
    if (typeof reason !== "string" || !READ_REASON_SET.has(reason)) return null;

    const resolverMode = ownValue(value, "resolver_mode");
    if (typeof resolverMode !== "string" || !RESOLVER_MODE_SET.has(resolverMode)) return null;

    // S8 invariant 3: an explicit boolean set at the emission point. Not optional and
    // not coerced — "missing" must never read as "not synthetic", which would pull a
    // tooling read into the G5 dependence count.
    const synthetic = ownValue(value, "synthetic");
    if (typeof synthetic !== "boolean") return null;

    // Explicit branches rather than `x !== null && !isNonEmptyStr(x)`: the negated
    // form does not narrow `unknown` down to `string | null` for the constructor below.
    const specialistIdRaw = ownValue(value, "specialist_id");
    let specialistId: string | null;
    if (specialistIdRaw === null) specialistId = null;
    else if (isCanonicalId(specialistIdRaw)) specialistId = specialistIdRaw;
    else return null;

    return Object.freeze({
      schema_version: COMPATIBILITY_USAGE_SCHEMA,
      asset_kind: assetKind as CompatibilityAssetKind,
      asset_id: assetId,
      asset_path: assetPath,
      content_hash: contentHash,
      reason: reason as CompatibilityReadReason,
      resolver_mode: resolverMode as CapabilityResolverMode,
      synthetic,
      specialist_id: specialistId,
    });
  } catch {
    // An exotic input that throws mid-read is a REJECT, never a crash.
    return null;
  }
}

/** Boolean convenience over `parseCompatibilityUsageV1`. Pure, never throws. */
export function isCompatibilityUsageV1(value: unknown): value is CompatibilityUsageV1 {
  return parseCompatibilityUsageV1(value) !== null;
}

/**
 * The G5 predicate: does this record count as legacy DEPENDENCE?
 *
 * > G5 input = records where `synthetic === false` AND
 * > `reason ∈ {no_project_definition, explicit_legacy_mode, rollback}`.
 */
export function isDependenceRead(record: CompatibilityUsageV1): boolean {
  if (record.synthetic) return false;
  // Reads the PRIVATE frozen set, so mutating the exported array cannot suppress a
  // dependence read and manufacture a clean gate.
  return !BENIGN_REASON_SET.has(record.reason);
}

// ---------------------------------------------------------------------------
// The G5 rollup
// ---------------------------------------------------------------------------

export interface CompatibilityUsageRollup {
  readonly window_start_release: string;
  readonly window_end_release: string;
  /** Per asset, the count of DEPENDENCE reads. */
  readonly by_asset: Readonly<Record<string, number>>;
  readonly total_dependence_reads: number;
  /**
   * Assets for which at least one VALID record was seen in this window — regardless of
   * reason or `synthetic`. This is INSTRUMENTATION COVERAGE, deliberately separate from
   * `by_asset`.
   *
   * The distinction is the difference between a real gate and a false-clean one.
   * `by_asset` is seeded to 0 for every known asset so an unread asset is visible; if
   * coverage were derived from ITS keys, an asset that was never instrumented at all
   * would look identical to one that was instrumented and simply never depended on, and
   * two EMPTY rollups would pass G5 and mark all 73 assets removable. Coverage must come
   * from observations that actually happened.
   */
  readonly observed_asset_ids: readonly string[];
  /** Assets with zero dependence reads across the whole window. */
  readonly removable: readonly string[];
  /**
   * Records that could not be read (torn tail, hash mismatch). NEVER zero-by-default
   * — the caller supplies the journal's own count of unreadable records.
   */
  readonly unreadable: number;
  /**
   * Present ONLY on a rollup that could not be computed (rejected options, a malformed
   * record, a non-canonical id). Its counts are NaN so evaluateG5 blocks; this field
   * says why, so the block is diagnosable rather than mysterious.
   */
  readonly unusable_reason?: string;
}

export interface CompatibilityUsageRollupInput {
  readonly window_start_release: string;
  readonly window_end_release: string;
  /** Every VALID payload parsed from the window. */
  readonly records: readonly CompatibilityUsageV1[];
  /**
   * The set of asset ids the rollup is accountable for — the 73 shipped assets
   * (15 templates + 58 domain skills), or a subset under test.
   *
   * REQUIRED, and deliberately not derived from `records`: deriving it would make
   * `removable` mean "assets we happened to see", so an asset that was never
   * instrumented at all would silently never appear and never be reported as
   * removable OR as a coverage gap.
   */
  readonly known_asset_ids: readonly string[];
  /** Unreadable-record count from the journal. Not optional — see `unreadable`. */
  readonly unreadable: number;
}

/**
 * Fold a window of payloads into the G5 verdict input. Pure; never throws.
 *
 * `removable` lists assets with zero DEPENDENCE reads — benign `mint_source` /
 * `shadow_comparison` reads and every `synthetic` read are excluded, which is the
 * whole reason a real project can ever reach zero. The returned object is FROZEN so a
 * caller cannot mutate a verdict input after it has been computed.
 */
const ROLLUP_INPUT_KEYS = [
  "window_start_release",
  "window_end_release",
  "records",
  "known_asset_ids",
  "unreadable",
] as const;

/** A rollup that could not be computed from the given input. Fail-closed, never thrown. */
function unusableRollup(reason: string): CompatibilityUsageRollup {
  return Object.freeze({
    window_start_release: "",
    window_end_release: "",
    by_asset: Object.freeze({}),
    // NaN, deliberately: an unusable rollup must never read as "zero dependence".
    // evaluateG5 rejects a non-count and blocks, so this cannot become a false clean.
    total_dependence_reads: Number.NaN,
    observed_asset_ids: Object.freeze([]),
    removable: Object.freeze([]),
    unreadable: Number.NaN,
    unusable_reason: reason,
  }) as CompatibilityUsageRollup;
}

export function rollupCompatibilityUsage(
  input: CompatibilityUsageRollupInput,
): CompatibilityUsageRollup {
  // EVERY option is resolved FIRST, through own-data descriptors, before anything is
  // inspected or counted. Nothing caller-supplied executes after this point, so no
  // field can differ between the check that guards it and the read that uses it.
  const opts = readOptions(input, ROLLUP_INPUT_KEYS);
  if (opts === null) return unusableRollup("options object rejected (proxy/accessor/unknown key)");

  const startRelease = opts["window_start_release"];
  const endRelease = opts["window_end_release"];
  if (!isBoundedStr(startRelease) || !isBoundedStr(endRelease)) {
    return unusableRollup("window release identifiers must be bounded plain strings");
  }
  const unreadable = opts["unreadable"];
  if (!isCount(unreadable)) return unusableRollup("unreadable must be a non-negative safe integer");

  const knownIds = readArray(opts["known_asset_ids"]);
  if (knownIds === null) return unusableRollup("known_asset_ids must be a dense plain array");
  // Canonical AND unique. A duplicate or non-canonical id is REJECTED, never normalized:
  // two spellings of one asset would let a dependence read land under one key while the
  // other reports zero — the alias false-zero this gate exists to block.
  const seenKnown = new Set<string>();
  for (const id of knownIds) {
    if (!isCanonicalId(id)) return unusableRollup(`known_asset_ids entry is not a canonical id: ${String(id)}`);
    if (seenKnown.has(id)) return unusableRollup(`known_asset_ids contains duplicate id: ${id}`);
    seenKnown.add(id);
  }

  const records = readArray(opts["records"]);
  if (records === null) return unusableRollup("records must be a dense plain array");

  const byAsset: Record<string, number> = {};
  for (const id of seenKnown) byAsset[id] = 0;

  const observed = new Set<string>();
  let total = 0;
  for (const raw of records) {
    // Re-validate every record here rather than trusting the caller's typing: this is a
    // trust boundary, and a malformed entry must REJECT the whole rollup, never be
    // skipped until a benign one matches (accept-by-attrition).
    const record = parseCompatibilityUsageV1(raw);
    if (record === null) return unusableRollup("records contains an entry that is not a valid guild.compatibility_usage.v1");
    observed.add(record.asset_id);
    if (!isDependenceRead(record)) continue;
    byAsset[record.asset_id] = (byAsset[record.asset_id] ?? 0) + 1;
    total += 1;
  }

  const removable = [...seenKnown].filter((id) => (byAsset[id] ?? 0) === 0).sort();

  return Object.freeze({
    window_start_release: startRelease,
    window_end_release: endRelease,
    by_asset: Object.freeze(byAsset),
    total_dependence_reads: total,
    observed_asset_ids: Object.freeze([...observed].sort()),
    removable: Object.freeze(removable),
    unreadable,
  });
}

// ---------------------------------------------------------------------------
// The G5 gate
// ---------------------------------------------------------------------------

export const G5_MIN_CLEAN_RELEASES = 2;

export interface G5Verdict {
  readonly passed: boolean;
  /** Every reason the gate is blocked. Empty iff `passed`. */
  readonly blockers: readonly string[];
  /** Assets G5 clears for removal. Empty unless `passed`. */
  readonly removable: readonly string[];
}

export interface G5Input {
  /** One rollup per release in the window, oldest first. */
  readonly rollups: readonly CompatibilityUsageRollup[];
  /**
   * Every asset id that MUST be instrumented (the 73). An id observed in NO rollup was
   * never instrumented, which produces a FALSE zero — S8 invariant 5, and the
   * difference between a real gate and a vacuous one.
   */
  readonly required_asset_ids: readonly string[];
}

/**
 * Evaluate G5. Fail-closed on every axis: the gate passes only when it can PROVE zero
 * dependence, not when it merely fails to observe any.
 *
 * Every check below exists because its absence is a way to get a FALSE CLEAN on a
 * gate whose output is "delete these 73 files":
 *
 *   1. an EMPTY required set — a gate over nothing must never pass
 *   2. fewer than 2 releases — that short a window is a schedule, not a measurement
 *   3. DUPLICATE release identifiers — passing the same rollup twice must not
 *      masquerade as two independent releases of evidence
 *   4. any count that is not a non-negative safe integer — NaN fails every `> 0`
 *      comparison, and negatives let a sum cancel a real positive to zero
 *   5. `unreadable > 0` in ANY release, checked PER RELEASE rather than on a sum, so
 *      +1/-1 cannot cancel. An absent observation is never cleanliness
 *   6. any dependence read, counted from `by_asset` itself and cross-checked against
 *      the reported total, so a hand-built or mutated rollup claiming
 *      `total_dependence_reads: 0` over `by_asset: {x: 1}` is caught
 *   7. a required asset OBSERVED in no rollup — never instrumented, so its zero is fake
 */
const G5_INPUT_KEYS = ["rollups", "required_asset_ids"] as const;
const ROLLUP_KEYS = [
  "window_start_release",
  "window_end_release",
  "by_asset",
  "total_dependence_reads",
  "observed_asset_ids",
  "removable",
  "unreadable",
  "unusable_reason",
] as const;

export function evaluateG5(input: G5Input): G5Verdict {
  const blockers: string[] = [];
  const blocked = (reason: string): G5Verdict =>
    Object.freeze({ passed: false, blockers: Object.freeze([reason]), removable: Object.freeze([]) });

  // Resolve the options bag FIRST — before any rollup is inspected.
  const opts = readOptions(input, G5_INPUT_KEYS);
  if (opts === null) return blocked("G5 input rejected (proxy/accessor/unknown key)");

  const requiredRaw = readArray(opts["required_asset_ids"]);
  if (requiredRaw === null) return blocked("required_asset_ids must be a dense plain array");
  const required: string[] = [];
  const seenRequired = new Set<string>();
  for (const id of requiredRaw) {
    // Canonical + unique, same reasoning as the rollup: one referent, one spelling.
    if (!isCanonicalId(id)) return blocked(`required_asset_ids entry is not a canonical id: ${String(id)}`);
    if (seenRequired.has(id)) return blocked(`required_asset_ids contains duplicate id: ${id}`);
    seenRequired.add(id);
    required.push(id);
  }
  if (required.length === 0) {
    blockers.push("empty required_asset_ids — a removal gate over zero assets cannot pass");
  }

  const rollupsRaw = readArray(opts["rollups"]);
  if (rollupsRaw === null) return blocked("rollups must be a dense plain array");

  // SNAPSHOT every rollup's fields once, through own-data descriptors. Previously
  // `rollup.unreadable` was read twice — once for validity, once for the threshold — so
  // a getter returning 5 then 0 passed a torn journal. Now each value is read exactly
  // once and every later check sees that same value.
  interface Snapshot {
    label: string;
    unreadable: unknown;
    total: unknown;
    byAsset: Record<string, unknown> | null;
    observed: unknown[] | null;
    unusable: unknown;
  }
  const snapshots: Snapshot[] = [];
  for (const raw of rollupsRaw) {
    const r = readOptions(raw, ROLLUP_KEYS);
    if (r === null) return blocked("a rollup was rejected (proxy/accessor/unknown key)");
    const start = r["window_start_release"];
    const end = r["window_end_release"];
    if (typeof start !== "string" || typeof end !== "string") {
      return blocked("a rollup carries a non-string release identifier");
    }
    const byAssetRaw = r["by_asset"];
    const byAsset = readOptionsAsCounts(byAssetRaw);
    snapshots.push({
      label: `${start}..${end}`,
      unreadable: r["unreadable"],
      total: r["total_dependence_reads"],
      byAsset,
      observed: readArray(r["observed_asset_ids"]),
      unusable: r["unusable_reason"],
    });
  }

  if (snapshots.length < G5_MIN_CLEAN_RELEASES) {
    blockers.push(
      `insufficient window: ${snapshots.length} release(s) of evidence, need >= ${G5_MIN_CLEAN_RELEASES}`,
    );
  }
  const labels = snapshots.map((s) => s.label);
  if (new Set(labels).size !== labels.length) {
    blockers.push("duplicate release windows — the same evidence submitted twice is one release, not two");
  }

  for (const snap of snapshots) {
    if (typeof snap.unusable === "string") {
      blockers.push(`release ${snap.label}: rollup is unusable — ${snap.unusable}`);
    }
    if (!isCount(snap.unreadable)) {
      blockers.push(`release ${snap.label}: unreadable is not a valid count (${String(snap.unreadable)})`);
    } else if (snap.unreadable > 0) {
      blockers.push(
        `release ${snap.label}: ${snap.unreadable} unreadable record(s) — a partially-readable journal is not evidence of zero usage`,
      );
    }

    if (snap.byAsset === null) {
      blockers.push(`release ${snap.label}: by_asset is not a plain own-data object`);
    } else {
      let derived = 0;
      for (const [assetId, count] of Object.entries(snap.byAsset)) {
        if (!isCount(count)) {
          blockers.push(`release ${snap.label}: by_asset[${assetId}] is not a valid count (${String(count)})`);
          continue;
        }
        derived += count;
      }
      if (!isCount(snap.total)) {
        blockers.push(
          `release ${snap.label}: total_dependence_reads is not a valid count (${String(snap.total)})`,
        );
      } else if (snap.total !== derived) {
        blockers.push(
          `release ${snap.label}: total_dependence_reads ${snap.total} disagrees with by_asset sum ${derived}`,
        );
      }
      if (derived > 0) blockers.push(`release ${snap.label}: ${derived} dependence read(s)`);
    }

    if (snap.observed === null) {
      blockers.push(`release ${snap.label}: observed_asset_ids is not a dense plain array`);
    }
  }

  const observed = new Set<string>();
  for (const snap of snapshots) {
    for (const id of snap.observed ?? []) if (typeof id === "string") observed.add(id);
  }
  const uninstrumented = required.filter((id) => !observed.has(id)).sort();
  if (uninstrumented.length > 0) {
    blockers.push(
      `${uninstrumented.length} required asset(s) never instrumented (a false zero): ${uninstrumented.join(", ")}`,
    );
  }

  const passed = blockers.length === 0;
  const removable = passed ? [...required].sort() : [];
  return Object.freeze({
    passed,
    blockers: Object.freeze(blockers),
    removable: Object.freeze(removable),
  });
}

/** Snapshot a by_asset map through own-data descriptors, or null if it is not plain data. */
function readOptionsAsCounts(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (nodeTypes.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}
