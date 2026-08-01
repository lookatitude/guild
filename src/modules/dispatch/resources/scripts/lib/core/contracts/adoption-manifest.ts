/**
 * scripts/lib/core/contracts/adoption-manifest.ts
 *
 * Capability localization — `guild.adoption_manifest.v1`: the IMMUTABLE,
 * APPEND-ONLY, HASH-CHAINED map from an old role/skill identity to its new
 * project-local reference, so a historical run record still resolves after ids,
 * paths, and homes have moved.
 *
 * WHY THIS EXISTS (gap-audit F1, plan risk R11)
 *
 * F1: the manifest was "load-bearing for G3, G4, R11, and historical replay" but
 * had only a PROSE MENTION — no schema id, no versioning rule, no reader contract.
 * R11: "old team/run artifacts become unreadable after ids move."
 *
 * Three decisions gate role moves on this existing FIRST: cap-loc-D07 (16
 * template-derived umbrella roles), D09 (10 self-build roles out of
 * `.claude/agents/`), D10 (4 duplicated agents collapse or change home).
 *
 * ── THE FOUR PROPERTIES ─────────────────────────────────────────────────────
 *
 * 1. APPEND-ONLY — HASH-CHAINED, WITH AN HONEST LIMIT. Each entry carries
 *    `prev_digest`, the digest of the entry before it (`null` at sequence 1), so
 *    deleting an entry and RENUMBERING the rest — the only deletion anyone would
 *    actually perform by hand — breaks every digest after the cut. A gap-free
 *    1..N check alone caught only deletion WITHOUT renumbering, i.e. the case
 *    nobody hits.
 *
 *    WHAT THIS DOES NOT DO (codex #1, stated rather than implied). The chain is
 *    SELF-DERIVED and UNKEYED: the validator recomputes it from the manifest it
 *    was handed. So it detects tampering by anyone who does not also recompute —
 *    accidental corruption, a partial edit, a naive delete — but NOT a
 *    deliberate rewrite by an actor who re-chains the whole file, and NOT
 *    TRUNCATION (dropping the final entries re-chains trivially).
 *
 *    Closing that needs an EXTERNAL commitment the contract cannot hold: the tip
 *    digest recorded somewhere the rewriter does not control (the run record, a
 *    signed commit, the receipt journal). `manifestCommitment()` computes the value
 *    to commit — binding schema, project_id, entry count and chain tip under a
 *    domain separator — and `verifyAgainstTip()` checks it; WHO commits it is the
 *    caller's job. Until a caller does, the honest claim is "tamper-EVIDENT against
 *    non-adversarial edits", not "append-only proven".
 *
 * 2. `not_found` IS A REAL ANSWER AND NEVER FALLS BACK TO CURRENT CONTENT (R11).
 *    A reader that silently resolved an unknown id to today's file would make
 *    every historical run quietly WRONG rather than loudly unresolvable.
 *
 * 3. ROLLBACK IS A FORWARD APPEND, NEVER A REWIND (cap-loc-D03). Undoing an
 *    adoption appends a NEW entry in the opposite direction. Runs recorded BETWEEN
 *    the adoption and the rollback genuinely used the new location; deleting the
 *    entry would strand them and rewinding would resolve them to the wrong bytes.
 *
 * 4. TRAVERSAL MATCHES IDENTITY, NOT BARE IDS. A later, unrelated definition
 *    reusing a successor's id must not hijack the chain — that would resolve a
 *    historical run to the WRONG BYTES, the exact R11 failure this file prevents.
 *    Hops are matched on `(kind, id)` AND the predecessor's byte identity.
 *
 * ── THE THREE STANDING DEFECT CLASSES (spec README rules 4-6) ───────────────
 *
 * This surface was written with all three built in, not retrofitted:
 *
 *   Rule 5 (alias dedup):  every path-like scalar is CANONICAL-ONLY. `a/./x`,
 *     `a//x`, `..`, trailing slash and backslashes are REJECTED, never normalized.
 *     Once one spelling validates, keying and dedup are sound BY CONSTRUCTION —
 *     which matters most here, since this manifest is keyed by old id and path and
 *     an alias could split or double-map an entry.
 *   Rule 6 (scalar smuggling): every scalar is BOUNDED and SHAPE-CHECKED. Control
 *     characters are rejected everywhere — an id, sha, run-id or timestamp never
 *     contains a newline; a smuggled body always does. Malformed entries REJECT,
 *     never skip (no accept-by-attrition).
 *   Rule 4 (opts-TOCTOU): N/A — no validator here takes an options argument. If
 *     one is ever added, resolve options FIRST via own-data descriptors.
 *
 * CONTRACT: pure types + fail-closed validators + a PURE resolver. No I/O, no
 * clock, NEVER throws. Byte fetching is the artifact service's job (see S2).
 *
 * C5 DIRECTION: `scripts/lib` is the SoT; the `src/modules/<m>/resources` tree is
 * GENERATED. Edit HERE, then run `sync:module-resources`. Never hand-edit the
 * resources copy — the next sync overwrites it, so the edit is silently lost.
 */

import * as crypto from "crypto";
import { types as nodeTypes } from "util";

import {
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "./project-definition-ref";

// ── Frozen schema string ─────────────────────────────────────────────────────

export const ADOPTION_MANIFEST_SCHEMA = "guild.adoption_manifest.v1" as const;

/** Why an entry exists. CLOSED — never free-text classification. */
export const ADOPTION_REASONS = Object.freeze([
  "migrated",
  "collapsed",
  "rehomed",
  "renamed",
  "removed",
  "rolled_back",
] as const);
export type AdoptionReason = (typeof ADOPTION_REASONS)[number];

const ADOPTION_REASON_SET: ReadonlySet<string> = new Set<string>(ADOPTION_REASONS);

/** Reasons whose information loss demands an explicit note. */
const DETAIL_REQUIRED: ReadonlySet<string> = new Set<string>([
  "collapsed",
  "removed",
  "rolled_back",
]);

export const LEGACY_HOMES = Object.freeze([
  "plugin-shipped",
  "dot-claude-agents",
  "project-guild",
  "umbrella-guild",
] as const);
export type LegacyHome = (typeof LEGACY_HOMES)[number];

const LEGACY_HOME_SET: ReadonlySet<string> = new Set<string>(LEGACY_HOMES);

// ── Scalar bounds (Rule 6) ───────────────────────────────────────────────────
// Every bound is deliberate: a value near these limits is already suspicious, and
// a smuggled body is orders of magnitude past them.

const MAX_ID = 128;
const MAX_PATH = 1024;
const MAX_DETAIL = 2048;
const MAX_RUN_ID = 128;
const MAX_AUTHORIZED_BY = 128;
const MAX_TIMESTAMP = 64;

/** `sha256:` + 64 lowercase hex, matching S2's byte-hash spelling. */
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
/** Bare 64-hex — the digest spelling used by the chain. */
const DIGEST_RE = /^[0-9a-f]{64}$/;
/** RFC3339-shaped UTC. Not a full parser; a shape gate that a body cannot pass. */
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
/** A decision-record / run id: no whitespace, no path separators, no controls. */
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * Rule 6's sharpest universal guard: an identifier, sha, run-id, or timestamp
 * NEVER contains a control character; a smuggled body always does.
 */
function isCleanScalar(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL_RE.test(v);
}

/**
 * Rule 5 — a CANONICAL path spelling, rejected rather than normalized.
 *
 * Applies to `historical_path` too, with ONE deliberate difference: a historical
 * path MAY be absolute, because its job is to match what old run records literally
 * cite (many cite `/Users/…/.claude/agents/<role>.md`, gap-audit C2). Everything
 * else — `.`, `..`, `//`, trailing slash, backslashes, controls — is still
 * rejected, so two spellings of one file can never both validate and split a key.
 */
function isCanonicalPath(v: unknown, opts: { allowAbsolute: boolean }): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_PATH) return false;
  if (CONTROL_RE.test(v)) return false;
  if (v.includes("\\")) return false; // one separator convention only
  if (/^[A-Za-z]:/.test(v)) return false; // Windows drive absolute — never canonical here
  const isAbs = v.startsWith("/");
  // CODEX #5: allowing BOTH spellings meant `agents/a.md` and `/proj/agents/a.md`
  // could identify one file while both validated — the alias hole one level up
  // from the segment check. A historical path is therefore ABSOLUTE-ONLY (it cites
  // what an old record literally wrote, and those are absolute), and a successor
  // path is RELATIVE-ONLY (S2's rule). Exactly one spelling is legal per field.
  if (opts.allowAbsolute && !isAbs) return false;
  if (!opts.allowAbsolute && isAbs) return false;
  if (v.endsWith("/")) return false; // directory form is not a definition
  const segments = (isAbs ? v.slice(1) : v).split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // `//` or a trailing/leading empty segment
    if (seg === "." || seg === "..") return false; // alias spellings — REJECT, never normalize
  }
  return true;
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface LegacyLocator {
  /** The id the old world used. Token-shaped, never path-shaped (Rule 6). */
  id: string;
  /** The path as historical records cite it — CANONICAL, but may be absolute. */
  historical_path: string;
  /** Byte hash of the old definition if recoverable, else null. */
  content_hash: string | null;
  home: LegacyHome;
}

export interface AdoptionEntry {
  /** Monotonic, gap-free from 1. Assigned by the writer, never the caller. */
  sequence: number;
  kind: "agent" | "skill";
  from: LegacyLocator;
  /** The successor, or NULL for a removal. */
  to: ProjectDefinitionRefV1 | null;
  reason: AdoptionReason;
  /** Required for `collapsed`, `removed`, `rolled_back`. */
  detail: string | null;
  /**
   * The sequence this entry REVERSES. Non-null IFF `reason === "rolled_back"`.
   * A typed field, not prose in `detail`: the manifest validator proves the target
   * exists, is EARLIER, and that this entry genuinely reverses it.
   */
  reverses_sequence: number | null;
  /** RFC3339 UTC, caller-supplied — no clock in the contract. */
  adopted_at: string;
  run_id: string;
  /** The decision record authorizing it, e.g. "cap-loc-D09". */
  authorized_by: string;
  /** Digest of the PRECEDING entry; null at sequence 1. The append-only proof. */
  prev_digest: string | null;
}

export interface AdoptionManifestV1 {
  schema_version: typeof ADOPTION_MANIFEST_SCHEMA;
  project_id: string;
  /** APPEND-ONLY, ordered by `sequence`, chained by `prev_digest`. */
  entries: AdoptionEntry[];
}

// ── Hardening primitives (the specialist-identity.ts idiom) ──────────────────

function isPlainDataObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (nodeTypes.isProxy(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function ownDataProp(
  o: object,
  key: string
): { kind: "absent" } | { kind: "accessor" } | { kind: "data"; value: unknown } {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}

function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}

/** A genuine, unpolluted array. Returns its snapshotted length, or null. */
function arrayLength(v: unknown): number | null {
  if (!Array.isArray(v)) return null;
  if (nodeTypes.isProxy(v)) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(v, "length");
  if (
    !lenDesc ||
    !("value" in lenDesc) ||
    typeof lenDesc.value !== "number" ||
    !Number.isInteger(lenDesc.value) ||
    lenDesc.value < 0
  ) {
    return null;
  }
  const len = lenDesc.value;
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k || n >= len) return null;
  }
  return len;
}

// ── The hash chain (append-only, provably) ──────────────────────────────────

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return out;
}

/**
 * The canonical digest of ONE entry, over every field INCLUDING `prev_digest`.
 *
 * Including the predecessor's digest is what makes this a CHAIN rather than a set
 * of independent checksums: altering entry N changes N's digest, which is data
 * inside N+1's digest, and so on to the tip. There is no edit that repairs itself.
 */
export function entryDigest(entry: AdoptionEntry): string {
  // CODEX #4: this is an EXPORTED boundary, and a compile-time type is not a
  // runtime guarantee. `canonicalize` + `JSON.stringify` will happily traverse a
  // Proxy, fire a throwing getter, recurse a cyclic object, or hit a bigint — any
  // of which escapes the file-wide NEVER-throws contract. Validate first, exactly
  // as `manifestCommitment` does, and return a sentinel rather than throwing.
  //
  // The sentinel is a fixed non-hex string, so it can never collide with a real
  // digest and any chain built on it fails `DIGEST_RE` immediately.
  try {
    const valid = validateAdoptionEntry(entry);
    if (valid === null) return INVALID_DIGEST;
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalize(valid)), "utf8")
      .digest("hex");
  } catch {
    return INVALID_DIGEST;
  }
}

/** Never matches DIGEST_RE, so a chain built on an invalid entry cannot validate. */
export const INVALID_DIGEST = "invalid-entry";

/**
 * The result of computing a manifest's external commitment.
 *
 * A DISCRIMINATED result, not a bare string: codex round 3 (#2) noted that
 * returning `null` conflated "this manifest is invalid" with "this manifest is
 * validly empty" — two facts a committer must never confuse, because committing
 * the second is correct and committing the first is meaningless.
 */
export type ManifestCommitment =
  | { readonly ok: true; readonly digest: string; readonly empty: boolean }
  | { readonly ok: false; readonly digest: null; readonly empty: false };

/** Domain separator — this digest is never confusable with a bare entry digest. */
const COMMITMENT_DOMAIN = "guild.adoption_manifest.v1/commitment\u0000";

/**
 * The value a caller commits EXTERNALLY to close the truncation/rewrite gap
 * documented at the top of this file.
 *
 * BINDS THE WHOLE ENVELOPE, not just the chain tip (codex round 3, #1). An earlier
 * version digested only the last entry, so an attacker could change `project_id`
 * to another valid token, keep every entry, and REPLAY a valid commitment under a
 * different project namespace — which matters precisely because successor paths
 * are project-RELATIVE and only `project_id` says which root they resolve against.
 * The commitment therefore covers `schema_version`, `project_id`, the entry count,
 * and the tip digest, under a domain separator.
 *
 * Takes `unknown` and validates (codex round 3, #2): a typed parameter is a
 * compile-time hint, not a runtime guarantee, and this is an exported boundary. A
 * Proxy or throwing getter yields `{ ok: false }`, never an exception.
 */
export function manifestCommitment(manifest: unknown): ManifestCommitment {
  try {
    const m = validateAdoptionManifestV1(manifest);
    if (m === null) return { ok: false, digest: null, empty: false };
    const last = m.entries[m.entries.length - 1];
    const tip = last === undefined ? "" : entryDigest(last);
    const payload =
      COMMITMENT_DOMAIN +
      JSON.stringify([m.schema_version, m.project_id, m.entries.length, tip]);
    return {
      ok: true,
      digest: crypto.createHash("sha256").update(payload, "utf8").digest("hex"),
      empty: m.entries.length === 0,
    };
  } catch {
    return { ok: false, digest: null, empty: false };
  }
}

/**
 * Verify a manifest against an EXTERNALLY COMMITTED digest from
 * `manifestCommitment`.
 *
 * This is the check the self-derived chain cannot perform. `expected` must come
 * from OUTSIDE the manifest — a run record, a signed commit, the receipt journal —
 * otherwise it proves nothing an attacker could not also rewrite.
 *
 * Fail-closed: an invalid manifest, a malformed expectation, or any mismatch is
 * `false`. Never throws.
 */
export function verifyAgainstTip(manifest: unknown, expected: string | null): boolean {
  const c = manifestCommitment(manifest);
  if (!c.ok) return false;
  if (expected === null) return false; // a commitment always exists; null commits nothing
  if (typeof expected !== "string" || !DIGEST_RE.test(expected)) return false;
  return c.digest === expected;
}

// ── Validators (fail-closed: typed | null, NEVER throw) ──────────────────────

const LOCATOR_KEYS = ["id", "historical_path", "content_hash", "home"] as const;

const ENTRY_KEYS = [
  "sequence",
  "kind",
  "from",
  "to",
  "reason",
  "detail",
  "reverses_sequence",
  "adopted_at",
  "run_id",
  "authorized_by",
  "prev_digest",
] as const;

const MANIFEST_KEYS = ["schema_version", "project_id", "entries"] as const;

function validateLegacyLocatorInner(obj: unknown): LegacyLocator | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, LOCATOR_KEYS)) return null;

  const idP = ownDataProp(obj, "id");
  const pathP = ownDataProp(obj, "historical_path");
  const hashP = ownDataProp(obj, "content_hash");
  const homeP = ownDataProp(obj, "home");
  if (idP.kind !== "data") return null;
  if (pathP.kind !== "data") return null;
  if (hashP.kind !== "data") return null;
  if (homeP.kind !== "data") return null;

  // Rule 6: an id is a TOKEN — bounded, control-free, and NOT path-shaped, so it
  // can never smuggle a body or masquerade as a locator.
  if (!isCleanScalar(idP.value, MAX_ID)) return null;
  if (!TOKEN_RE.test(idP.value)) return null;

  // Rule 5: canonical-only, absolute permitted (this is history's spelling).
  if (!isCanonicalPath(pathP.value, { allowAbsolute: true })) return null;

  if (hashP.value !== null) {
    if (typeof hashP.value !== "string" || !CONTENT_HASH_RE.test(hashP.value)) return null;
  }
  if (typeof homeP.value !== "string" || !LEGACY_HOME_SET.has(homeP.value)) return null;

  return {
    id: idP.value,
    historical_path: pathP.value,
    content_hash: hashP.value as string | null,
    home: homeP.value as LegacyHome,
  };
}

export function validateLegacyLocator(obj: unknown): LegacyLocator | null {
  try {
    return validateLegacyLocatorInner(obj);
  } catch {
    return null;
  }
}

function validateAdoptionEntryInner(obj: unknown): AdoptionEntry | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, ENTRY_KEYS)) return null;

  const seqP = ownDataProp(obj, "sequence");
  const kindP = ownDataProp(obj, "kind");
  const fromP = ownDataProp(obj, "from");
  const toP = ownDataProp(obj, "to");
  const reasonP = ownDataProp(obj, "reason");
  const detailP = ownDataProp(obj, "detail");
  const revP = ownDataProp(obj, "reverses_sequence");
  const atP = ownDataProp(obj, "adopted_at");
  const runP = ownDataProp(obj, "run_id");
  const authP = ownDataProp(obj, "authorized_by");
  const prevP = ownDataProp(obj, "prev_digest");
  if (seqP.kind !== "data") return null;
  if (kindP.kind !== "data") return null;
  if (fromP.kind !== "data") return null;
  if (toP.kind !== "data") return null;
  if (reasonP.kind !== "data") return null;
  if (detailP.kind !== "data") return null;
  if (revP.kind !== "data") return null;
  if (atP.kind !== "data") return null;
  if (runP.kind !== "data") return null;
  if (authP.kind !== "data") return null;
  if (prevP.kind !== "data") return null;

  if (typeof seqP.value !== "number" || !Number.isInteger(seqP.value) || seqP.value < 1) {
    return null;
  }
  if (kindP.value !== "agent" && kindP.value !== "skill") return null;
  if (typeof reasonP.value !== "string" || !ADOPTION_REASON_SET.has(reasonP.value)) return null;
  const reason = reasonP.value as AdoptionReason;

  const from = validateLegacyLocatorInner(fromP.value);
  if (from === null) return null;

  let to: ProjectDefinitionRefV1 | null;
  if (toP.value === null) {
    if (reason !== "removed") return null;
    to = null;
  } else {
    if (reason === "removed") return null;
    to = validateProjectDefinitionRefV1(toP.value);
    if (to === null) return null;
    // The successor's KIND must match the entry's. A `kind:"agent"` adoption whose
    // successor is a skill ref would corrupt identity-matched traversal.
    if (to.kind !== kindP.value) return null;
  }

  if (detailP.value !== null && !isCleanScalar(detailP.value, MAX_DETAIL)) return null;
  if (DETAIL_REQUIRED.has(reason) && detailP.value === null) return null;

  // `reverses_sequence` is non-null IFF rolled_back. Cross-entry proof (exists,
  // earlier, actually reverses) happens in the MANIFEST validator, which can see
  // the other entries.
  if (reason === "rolled_back") {
    if (
      typeof revP.value !== "number" ||
      !Number.isInteger(revP.value) ||
      revP.value < 1 ||
      revP.value >= seqP.value // must be EARLIER — a forward or self reference is invalid
    ) {
      return null;
    }
  } else if (revP.value !== null) {
    return null;
  }

  if (!isCleanScalar(atP.value, MAX_TIMESTAMP) || !RFC3339_RE.test(atP.value)) return null;
  if (!isCleanScalar(runP.value, MAX_RUN_ID) || !TOKEN_RE.test(runP.value)) return null;
  if (!isCleanScalar(authP.value, MAX_AUTHORIZED_BY) || !TOKEN_RE.test(authP.value)) return null;

  if (prevP.value !== null) {
    if (typeof prevP.value !== "string" || !DIGEST_RE.test(prevP.value)) return null;
  }
  // Sequence 1 has no predecessor; every later entry MUST chain.
  if (seqP.value === 1 && prevP.value !== null) return null;
  if (seqP.value > 1 && prevP.value === null) return null;

  return {
    sequence: seqP.value,
    kind: kindP.value,
    from,
    to,
    reason,
    detail: detailP.value as string | null,
    reverses_sequence: (reason === "rolled_back" ? revP.value : null) as number | null,
    adopted_at: atP.value,
    run_id: runP.value,
    authorized_by: authP.value,
    prev_digest: prevP.value as string | null,
  };
}

export function validateAdoptionEntry(obj: unknown): AdoptionEntry | null {
  try {
    return validateAdoptionEntryInner(obj);
  } catch {
    return null;
  }
}

function validateAdoptionManifestV1Inner(obj: unknown): AdoptionManifestV1 | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, MANIFEST_KEYS)) return null;

  const schemaP = ownDataProp(obj, "schema_version");
  if (schemaP.kind !== "data" || schemaP.value !== ADOPTION_MANIFEST_SCHEMA) return null;

  const projP = ownDataProp(obj, "project_id");
  const entriesP = ownDataProp(obj, "entries");
  if (projP.kind !== "data" || entriesP.kind !== "data") return null;
  if (!isCleanScalar(projP.value, MAX_ID) || !TOKEN_RE.test(projP.value)) return null;

  const len = arrayLength(entriesP.value);
  if (len === null) return null;

  const raw = entriesP.value as unknown[];
  const entries: AdoptionEntry[] = [];
  let expectedPrev: string | null = null;

  for (let i = 0; i < len; i++) {
    const desc = Object.getOwnPropertyDescriptor(raw, i);
    if (!desc || !("value" in desc)) return null;
    // Rule 6 sub-pattern: a malformed entry REJECTS the whole manifest. Skipping
    // to find a benign one would be accept-by-attrition.
    const entry = validateAdoptionEntryInner(desc.value);
    if (entry === null) return null;
    if (entry.sequence !== i + 1) return null; // monotonic, gap-free from 1
    // THE CHAIN. Deleting an entry and renumbering breaks this at the cut.
    if (entry.prev_digest !== expectedPrev) return null;
    expectedPrev = entryDigest(entry);
    entries.push(entry);
  }

  // ── THE LIVENESS RULE — make the undecidable states UNREPRESENTABLE ────────
  //
  // Rather than adjudicate a one-to-many "fork" at READ time, forbid it at WRITE
  // time. An entry's `from` identity must be LIVE at that sequence, and its `to`
  // identity must not already be live. Concretely, walking the log in order:
  //
  //   a `from` identity is live if it has never been adopted away, or was restored
  //   by an intervening proven rollback;
  //   a `to` identity must be dead, unless this entry IS that proven rollback.
  //
  // What this dissolves, without any read-time special case:
  //
  //   A->B(1), A->C(2)          the "fork". A was adopted away at 1 and never
  //                             restored, so entry 2 is REJECTED. There is no
  //                             ambiguity to resolve because the state cannot exist.
  // What it deliberately does NOT dissolve: an UNLABELLED loop (A->B, B->A as a
  // plain migration) stays representable, because every rule that would forbid it
  // also forbids collapse or re-adoption. That case is caught at READ time by the
  // authorization-based revisit guard instead — validation and traversal each take
  // the half they can express without collateral damage.
  //
  // What it preserves — every history D03 contemplates:
  //
  //   A->B(1), B->C(2)                   sequential migration
  //   A->B(1), B->A(2 rollback)          forward-append rollback
  //   A->B(1), B->A(2 rb), A->B(3)       RE-ADOPTION: the rollback restored A, so A
  //                                      is live again at 3
  //   U->X(1), N->X(2)                   collapse: two distinct live sources
  //
  // The payoff is that traversal needs NO discriminator: multiple forward matches
  // from one source identity can now only be a re-adoption, so earliest-forward-
  // match is correct by construction. Three earlier attempts at a read-time rule
  // were each wrong in a different way (one broke re-adoption, one resolved to the
  // WRONG BYTES, one mis-scoped identity) — the state is better removed than judged.
  //
  // KNOWN LIMITATION, stated rather than discovered later: a `removed` identity
  // cannot be re-created and re-adopted, because nothing restores it. If that
  // history is ever needed it wants an explicit `restored` reason, not a hole here.
  {
    const liveIds = new Set<string>();
    const deadIds = new Set<string>();
    // CODEX (merged round) #1: this keyed on (kind, id) only, so `A@h1` and `A@h2`
    // were ONE identity — and combined with the blanket resurrect below, the fork
    // this rule exists to forbid stayed representable. The liveness identity must
    // include the BYTES, exactly like traversal's.
    const identityOf = (kind: string, id: string, hash: string | null) =>
      `${kind}\u0000${id}\u0000${hash ?? ""}`;

    for (const entry of entries) {
      const fromKey = identityOf(entry.kind, entry.from.id, entry.from.content_hash);

      // `from` must be live. An identity is live until adopted away; the first
      // time we see it as a source it is live by default (it pre-dates the log).
      if (deadIds.has(fromKey)) return null;

      // NOTE — there is deliberately NO liveness rule on `to`. Two tempting ones
      // were tried and both rejected LEGITIMATE histories:
      //   "to must not be live"  breaks COLLAPSE (U->X, N->X land on one survivor
      //                          by design — D10's whole shape).
      //   "to must not be dead"  breaks RE-ADOPTION (A->B, B->A rollback, A->B:
      //                          the third entry necessarily resurrects B).
      // Constraining the SOURCE is enough to make the fork unrepresentable, and
      // constraining the destination costs more than it buys.
      if (entry.to !== null) {
        const toKey = identityOf(entry.to.kind, entry.to.id, entry.to.content_hash);
        liveIds.add(toKey);
        // CODEX (merged round) #1 was really TWO issues, and only one of them was
        // here. The fork survived because `identityOf` ignored BYTES, so `A@h1` and
        // `A@h2` were one identity and `B->A@h2` resurrected `A@h1`. With the key now
        // byte-aware that path is closed: in `A@h1->B`, `B->A@h2`, `A@h1->C`, entry 2
        // lands on A@h2 and leaves A@h1 dead, so entry 3 is rejected.
        //
        // Restricting restoration to rollbacks ALSO closed it, but over-broadly: it
        // rejected a legitimate re-creation (`B` adopted away, then landed on again
        // by a later migration), which broke a two-round-trip chain. An identity is
        // live wherever an entry places it — the SOURCE constraint is what forbids
        // the fork, and it is sufficient on its own.
        deadIds.delete(toKey);
      }

      // The source is now adopted away.
      deadIds.add(fromKey);
      liveIds.delete(fromKey);
    }
  }

  // Cross-entry rollback proof, now that every entry is in hand.
  for (const entry of entries) {
    if (entry.reason !== "rolled_back") continue;
    const target = entries[(entry.reverses_sequence as number) - 1];
    // UNREACHABLE BY CONSTRUCTION, kept as a belt-and-braces guard: the entry-level
    // validator already rejects `reverses_sequence >= sequence`, and every entry has
    // been proven `sequence === index + 1` above, so the index is always in range.
    // Noted explicitly because the anti-vacuity sweep flags it as uncovered — it is
    // dead code by design, NOT a guard someone forgot to test. Do not write a test
    // that appears to cover it; no valid input can reach it.
    if (target === undefined) return null; // referenced sequence does not exist
    if (target.sequence !== entry.reverses_sequence) return null;
    // It must genuinely REVERSE the target: this entry's `from` is where the target
    // landed, and it is the same kind. Without this, "rolled_back" is a label
    // anyone could attach to an unrelated edge.
    if (target.to === null) return null; // a removal has nothing to roll back to
    if (entry.kind !== target.kind) return null;
    if (entry.from.id !== target.to.id) return null;
    if (target.to.content_hash !== entry.from.content_hash) return null;
    // CODEX #3: the previous check proved only where the rollback STARTED, so
    // `A → B` followed by `B → C` could be labelled "rolled_back" against entry 1
    // and validate. A reversal must also LAND back on the target's source identity.
    if (entry.to === null) return null; // a rollback always has a destination
    if (entry.to.id !== target.from.id) return null;
    if (target.from.content_hash !== null && entry.to.content_hash !== target.from.content_hash) {
      return null;
    }
  }

  return {
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: projP.value,
    entries,
  };
}

/**
 * Fail-closed validation of a `guild.adoption_manifest.v1`. Returns a FRESH,
 * sanitized manifest or NULL — never throws, never repairs.
 */
export function validateAdoptionManifestV1(obj: unknown): AdoptionManifestV1 | null {
  try {
    return validateAdoptionManifestV1Inner(obj);
  } catch {
    return null;
  }
}

// ── Reader contract (the part gap-audit F1 says is missing) ─────────────────

export const ADOPTION_RESOLUTIONS = Object.freeze([
  "resolved",
  /** Deliberately removed with no successor — DISTINCT from `not_found`. */
  "removed",
  /** No record of this identity. NEVER a fallback to current content. */
  "not_found",
  /** A fork, a cycle, or a malformed manifest. Never a guess. */
  "ambiguous",
] as const);
export type AdoptionResolutionStatus = (typeof ADOPTION_RESOLUTIONS)[number];

export interface AdoptionResolution {
  status: AdoptionResolutionStatus;
  ref: ProjectDefinitionRefV1 | null;
  /** Every entry consulted, in order — the receipt for this resolution. */
  trail: number[];
}

/** What a caller knows about the historical definition it is trying to resolve. */
export interface HistoricalQuery {
  kind: "agent" | "skill";
  id: string;
  /** Optional, and DISAMBIGUATING when present. */
  historical_path?: string;
  /** Optional byte identity of the old definition. */
  content_hash?: string;
}

/**
 * Resolve a historical identity to its current reference. PURE — no I/O, no clock.
 *
 * SELF-VALIDATING AND SNAPSHOTTING. It takes `unknown`, re-validates, and works
 * only from the fresh sanitized copy, returning a DEEP-FROZEN ref. A caller cannot
 * hand it a previously-validated-then-mutated manifest, sneak a Proxy through a
 * type assertion, or mutate the manifest afterwards through the returned `ref`.
 * The hardened validators protected the parse boundary; this protects the API one.
 *
 * IDENTITY, NOT BARE IDS. Hops match `(kind, id)` and — when the predecessor
 * recorded a `content_hash` — the byte identity too. A later unrelated definition
 * reusing an id cannot hijack the chain into the wrong bytes.
 *
 * FORWARD-ONLY. A next hop must have a HIGHER sequence: in an append-only log a
 * later entry supersedes an earlier one, so walking backwards would re-apply
 * superseded history. This is also what makes the rollback `A→B→A'` resolve
 * cleanly instead of looping.
 */
export function resolveHistorical(
  manifest: unknown,
  query: unknown
): AdoptionResolution {
  try {
    return resolveHistoricalInner(manifest, query);
  } catch {
    // The file-wide NEVER-throws contract holds at the API boundary too: a Proxy
    // or throwing getter on either argument yields a typed answer, not an escape.
    return { status: "ambiguous", ref: null, trail: [] };
  }
}

/**
 * CODEX #4: the query boundary was UNHARDENED — it took a typed `HistoricalQuery`
 * and read it with plain property access. A polluted `Object.prototype` could
 * supply `kind` and `id` to an otherwise empty object and resolve an identity the
 * caller never provided; a Proxy or throwing getter escaped the never-throws
 * contract.
 *
 * This is the STANDING opts-TOCTOU class (spec README rule 4) — and it applied to
 * this file's own new API. The query is now accepted as `unknown` and SNAPSHOTTED
 * through own-data descriptors BEFORE anything about the manifest is walked.
 */
/**
 * The key a lineage's position is tracked by: kind + id + exact bytes. ONE helper
 * builds every key so the two construction sites can never spell the separator
 * differently — a guard whose two keys disagree is a guard that silently never
 * fires. `\u0000` cannot occur in a validated id or a `sha256:<hex>`, so no two
 * distinct positions collide.
 */
function identityKey(kind: string, id: string, contentHash: string): string {
  return `${kind}\u0000${id}\u0000${contentHash}`;
}

function resolveHistoricalInner(manifest: unknown, query: unknown): AdoptionResolution {
  const NO_ANSWER: AdoptionResolution = { status: "ambiguous", ref: null, trail: [] };

  // ── QUERY FIRST, own-data only, closed key set ──
  if (!isPlainDataObject(query)) return NO_ANSWER;
  const QUERY_KEYS = ["kind", "id", "historical_path", "content_hash"];
  for (const k of Object.getOwnPropertyNames(query)) {
    if (!QUERY_KEYS.includes(k)) return NO_ANSWER; // unknown key ⇒ reject, never ignore
  }
  const qKind = ownDataProp(query, "kind");
  const qId = ownDataProp(query, "id");
  const qPath = ownDataProp(query, "historical_path");
  const qHash = ownDataProp(query, "content_hash");
  if (qKind.kind !== "data" || qId.kind !== "data") return NO_ANSWER;
  if (qPath.kind === "accessor" || qHash.kind === "accessor") return NO_ANSWER;
  if (qKind.value !== "agent" && qKind.value !== "skill") return NO_ANSWER;
  if (!isCleanScalar(qId.value, MAX_ID) || !TOKEN_RE.test(qId.value)) return NO_ANSWER;
  const snapPath = qPath.kind === "data" ? qPath.value : undefined;
  if (snapPath !== undefined && !isCanonicalPath(snapPath, { allowAbsolute: true })) {
    return NO_ANSWER;
  }
  const snapHash = qHash.kind === "data" ? qHash.value : undefined;
  if (snapHash !== undefined && (typeof snapHash !== "string" || !CONTENT_HASH_RE.test(snapHash))) {
    return NO_ANSWER;
  }

  const m = validateAdoptionManifestV1(manifest);
  // A manifest that does not validate yields NO answer — never a partial walk.
  if (m === null) return NO_ANSWER;

  const trail: number[] = [];
  /**
   * IDENTITY-CYCLE GUARD.
   *
   * Forward-only traversal (`minSequence`) guarantees TERMINATION, so there is no
   * hang — but it does not detect a lineage that comes back to a position it has
   * already occupied. `A@h1 → B@h2 → A@h1` walks forward the whole way and reports
   * `resolved` at A@h1, which is not a terminal at all: it is where the walk
   * started. The chain closed a loop, so its endpoint is genuinely indeterminate
   * and the honest answer is `ambiguous`.
   *
   * This is precisely what separates the two round trips S3 cares about: a
   * rollback to DIFFERENT bytes (`A@h1 → B@h2 → A@h3`) is legal and must resolve,
   * while a return to IDENTICAL bytes is a closed loop. Both directions are
   * asserted, so the rule cannot be satisfied by always answering `ambiguous`.
   */
  const visitedIdentities = new Set<string>();
  let currentKind: "agent" | "skill" = qKind.value;
  let currentId: string = qId.value;
  let currentHash: string | undefined = snapHash as string | undefined;
  let firstHopPath: string | undefined = snapPath as string | undefined;
  let minSequence = 0;

  // Seed the ORIGIN position when the caller pinned it. Without a seed, a two-link
  // round trip back to the starting bytes has nothing to compare against.
  if (currentHash !== undefined) {
    visitedIdentities.add(identityKey(currentKind, currentId, currentHash));
  }

  for (let step = 0; step <= m.entries.length; step++) {
    const matches = m.entries.filter((e) => {
      if (e.sequence <= minSequence) return false; // never walk backwards in time
      if (e.kind !== currentKind) return false;
      if (e.from.id !== currentId) return false;
      // Byte identity when BOTH sides recorded one — this is what stops an
      // id-reusing later definition from hijacking the chain.
      // CODEX #2: `content_hash === null` was a WILDCARD — `A → B@hash1` followed
      // by an unrelated `B@null → C` traversed as one chain and resolved to C, the
      // wrong bytes. When the caller's identity is KNOWN, an entry that records no
      // hash cannot match it: absence is not agreement.
      if (currentHash !== undefined) {
        if (e.from.content_hash !== currentHash) return false;
      }
      // A supplied path disambiguates the FIRST hop only; later hops are reached
      // through the successor's identity, not through history's spelling.
      if (step === 0 && firstHopPath !== undefined) {
        return e.from.historical_path === firstHopPath;
      }
      return true;
    });

    if (matches.length === 0) {
      return trail.length === 0
        ? { status: "not_found", ref: null, trail } // NEVER a fallback to live content
        : { status: "ambiguous", ref: null, trail }; // dead end mid-chain
    }
    // MULTIPLE FORWARD MATCHES — now a SETTLED case, because the state that made
    // it hard is unrepresentable.
    //
    // The LIVENESS RULE (validation) rejects a one-to-many fork outright: a source
    // adopted away and never restored cannot appear as a source again. So multiple
    // forward matches from one identity can ONLY be a re-adoption reached through a
    // rollback — one history, in order. Take the EARLIEST and keep walking; the
    // chain replays the real sequence and the trail is the full provenance.
    //
    // Three read-time rules were tried before this and each was wrong differently:
    // "ambiguous always" broke re-adoption; "same destination, take earliest"
    // resolved to the WRONG BYTES; "take latest" fixed that but needed a growing
    // pile of sameness checks (source hash, destination path, whole locator) to stop
    // conflicts masquerading as re-adoptions. Removing the state beat judging it —
    // the whole discriminator is gone, not merely corrected.
    // The liveness rule removes the FORK, but not the case where a query names an
    // identity loosely: a hash-less query for "A" can match `A@h1->B` and `A@h2->B`,
    // which are two genuinely different sources the caller has not distinguished.
    // Multiple matches are one history ONLY if they share the whole source locator.
    if (matches.length > 1) {
      const head = matches[0].from;
      const oneSource = matches.every(
        (x) =>
          x.from.id === head.id &&
          x.from.content_hash === head.content_hash &&
          x.from.historical_path === head.historical_path &&
          x.from.home === head.home
      );
      if (!oneSource) {
        return {
          status: "ambiguous",
          ref: null,
          trail: [...trail, ...matches.map((x) => x.sequence)],
        };
      }
    }
    const entry = matches.reduce((a, b) => (a.sequence <= b.sequence ? a : b));

    trail.push(entry.sequence);
    minSequence = entry.sequence;

    // The caller supplies an id but often no hash, so the first matched entry's
    // `from` is the only place the ORIGIN bytes become known. Recovering them here
    // extends the cycle guard to the common un-pinned query.
    if (step === 0 && currentHash === undefined && entry.from.content_hash !== null) {
      visitedIdentities.add(identityKey(entry.kind, entry.from.id, entry.from.content_hash));
    }

    if (entry.to === null) return { status: "removed", ref: null, trail };

    const next = entry.to;

    // A position already occupied ⇒ the lineage closed a loop — UNLESS this edge is
    // a PROVEN rollback.
    //
    // That exemption is load-bearing, and finding it is why this guard is written
    // this way. `rolled_back` entries are REQUIRED by the cross-entry proof above to
    // land back on the reversed entry's `from` identity (id AND, when recorded,
    // content_hash). So every well-formed rollback returns to bytes the lineage has
    // already occupied — a naive "revisited position ⇒ cycle" rule would flag EVERY
    // legal rollback as ambiguous, breaking the central forward-append semantic S3
    // exists to express (`A → B → A'` is a chain, never a rewind).
    //
    // The distinction is AUTHORIZATION, not geometry. A rollback is an authorized
    // return: the validator has already proven it references a real, strictly
    // earlier entry, that it genuinely reverses it in both directions, and that no
    // entry is reversed twice. An UNLABELLED edge back to an occupied position has
    // proven none of that — it is a corrupt or mislabelled loop with an
    // indeterminate endpoint, and that is what `ambiguous` is for.
    //
    // Checked BEFORE the `hasNext` lookahead: a loop is a loop whether or not it
    // continues.
    const nextIdentity = identityKey(next.kind, next.id, next.content_hash);
    // A proven rollback REWINDS the lineage, so the era it undid stops counting as
    // occupied — a later RE-ADOPTION is new history, not a loop. Exempting only the
    // rollback EDGE (and not the era) left `A->B, B->A rollback, A->B` tripping on
    // entry 3, i.e. the legitimate re-adoption still reported `ambiguous`, just from
    // a different guard. Found by repo-prep while checking this guard against the
    // liveness rule; their patch, their reasoning.
    if (entry.reason === "rolled_back") {
      visitedIdentities.clear();
    } else if (visitedIdentities.has(nextIdentity)) {
      return { status: "ambiguous", ref: null, trail };
    }
    visitedIdentities.add(nextIdentity);
    const hasNext = m.entries.some(
      (e) =>
        e.sequence > minSequence &&
        e.kind === next.kind &&
        e.from.id === next.id &&
        // CODEX #2: same wildcard, second site. `next.content_hash` is always
        // known (it comes from a validated ref), so an entry with a null hash is
        // NOT a continuation of this chain.
        e.from.content_hash === next.content_hash
    );
    if (!hasNext) {
      return { status: "resolved", ref: deepFreeze(next), trail };
    }
    currentKind = next.kind as "agent" | "skill";
    currentId = next.id;
    currentHash = next.content_hash;
    firstHopPath = undefined;
  }

  // Exceeded the entry count ⇒ a cycle forward-only did not already exclude.
  return { status: "ambiguous", ref: null, trail };
}

/** Deep-freeze so a caller cannot mutate the manifest through the returned ref. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const k of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[k]);
  }
  return Object.freeze(value);
}
