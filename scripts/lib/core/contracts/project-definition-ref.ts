/**
 * scripts/lib/core/contracts/project-definition-ref.ts
 *
 * Capability localization — `guild.project_definition_ref.v1`: the LOCATOR /
 * TRANSPORT envelope for a project-local agent definition plus its pinned skill
 * bundle.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ IDENTITY IS ANSWERED BY `specialist-identity.ts` AND ONLY BY IT.          │
 * │ This file LOCATES BYTES and CARRIES identity hashes AS DATA; it never     │
 * │ recomputes or redefines identity.                                         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS IS NOT A SECOND IDENTITY SCHEMA (decision cap-loc-D05)
 *
 * `guild.specialist_profile.v1` (specialist-identity.ts) answers "WHAT is this
 * role, semantically, and which type is it derived from". It carries `profile_id`,
 * `version`, `derived_from`, `project_instructions`, `local_skill_refs[]`, and its
 * hash is taken over the CANONICAL JSON OF THE OBJECT.
 *
 * THIS file answers a different question: "WHERE do the exact bytes live relative
 * to this project root, at which commit, and which skill bundle rides with them".
 * Its `content_hash` is taken over the FILE BYTES.
 *
 * Field-by-field the two schemas share NOTHING. The collision the gap audit (E1)
 * feared was a NAMING collision, not a schema collision — dissolved by naming this
 * envelope for what it is.
 *
 * THE BINDING IDIOM
 *
 * `specialist_profile_hash` / `specialist_type_hash` are carried as OPAQUE DATA,
 * exactly like `SpecialistTypeBinding` in specialist-identity.ts ("Data — never
 * recomputed"). This module deliberately imports NO hashing from that file: a
 * validator that recomputed an identity hash would make this a second identity
 * model. There is a conformance assertion (A2.5) that greps this file for
 * `hashSpecialistProfile` / `hashSpecialistType` and requires ZERO hits.
 *
 * THE RECEIPT CHAIN THIS COMPLETES
 *
 *   specialist_type.v2 --hash--> specialist_profile.v1 --hash--> THIS --hash--> bytes
 *                                        \_____ agent_instance.v1 (per attempt) __/
 *
 * `guild.agent_instance.v1` (task-cell-backend.ts) already carries both identity
 * hashes. Adding `content_hash` + `source_commit` extends the chain to the exact
 * bytes — what worktree safety (R10) and historical replay (R11) require and what
 * NEITHER schema alone provides.
 *
 * OWNERSHIP (cap-loc-D05)
 *   - ARTIFACT service RESOLVES: path → bytes → verify hash → assemble bundle → receipt.
 *   - CAPABILITY service DECIDES: which role/skill, approval, adoption manifest, resolver mode.
 *   - The neutral core sees a typed request and a typed outcome and imports NEITHER.
 *
 * A resolution failure is a TYPED TRANSPORT OUTCOME (`invalid_request` /
 * `capability_absent` from the frozen EXECUTION_REASON_CODES), never a policy
 * decision — policy denial belongs to the core (BR-04).
 *
 * CONTRACT: pure types + fail-closed validators. No I/O, no clock, NEVER throws.
 * Byte reading and hash verification live in the artifact service, not here.
 *
 * C5 DUAL-HOME: this file is mirrored at
 * src/modules/dispatch/resources/scripts/lib/core/contracts/project-definition-ref.ts.
 * Both homes change in ONE commit + `sync:module-resources`; a single-home edit
 * silently reverts.
 */

import { types as nodeTypes } from "util";

// ── Frozen schema string ─────────────────────────────────────────────────────

export const PROJECT_DEFINITION_REF_SCHEMA = "guild.project_definition_ref.v1" as const;

/** The closed `kind` set. An agent definition or a skill body — nothing else. */
export const DEFINITION_KINDS = ["agent", "skill"] as const;
export type DefinitionKind = (typeof DEFINITION_KINDS)[number];

const DEFINITION_KIND_SET: ReadonlySet<string> = new Set<string>(DEFINITION_KINDS);

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * One pinned skill riding with a definition. Byte-bound like its parent: the
 * bundle a transport carries is exactly these bytes or the dispatch is refused.
 */
export interface PinnedSkillRef {
  /** Skill name (the `.guild/skills/<id>/` directory name). */
  id: string;
  /** ALWAYS project-root-relative. */
  relative_path: string;
  /** `sha256:<64 lowercase hex>` over the FILE BYTES. */
  content_hash: string;
}

/**
 * `guild.project_definition_ref.v1` — a locator + integrity envelope.
 *
 * Note what is ABSENT and deliberately so: no role, no tier, no tool scope, no
 * instructions. Those are identity/semantic questions and belong to
 * `specialist_profile.v1`. Adding any of them here would recreate the collision
 * this design exists to avoid.
 */
export interface ProjectDefinitionRefV1 {
  schema_version: typeof PROJECT_DEFINITION_REF_SCHEMA;

  /** Which project root `relative_path` resolves against (e.g. "plugin"). */
  project_id: string;
  kind: DefinitionKind;
  /** Role slug or skill name. For `kind:"agent"` this matches SpecialistProfileV1.profile_id. */
  id: string;

  /**
   * ALWAYS project-root-relative (e.g. `.guild/agents/plugin-runtime-architect.md`).
   * An absolute path is INVALID — that is the R10 worktree-safety fix. Note that
   * `Specialist.definition?` in team-backend.ts is ALREADY documented as
   * project-root-relative; the absolute paths the audit found (C2) are in CONTEXT
   * BUNDLE PROMPT TEXT, which this envelope exists to replace.
   */
  relative_path: string;

  /** `sha256:<64 lowercase hex>` over the FILE BYTES — never over the parsed object. */
  content_hash: string;

  /** Commit the bytes were read at, or null outside a git tree. */
  source_commit: string | null;

  // ── Identity binding: DATA, never recomputed here ──

  /** `hashSpecialistProfile(profile)`. NULL for `kind:"skill"`. */
  specialist_profile_hash: string | null;
  /** `profile.derived_from.type_hash`. NULL for `kind:"skill"`. */
  specialist_type_hash: string | null;

  /** Pinned skill bundle. MAY be empty. */
  skills: PinnedSkillRef[];
}

// ── Hardening primitives ─────────────────────────────────────────────────────
// Re-declared rather than imported, to keep core/contracts/ import-free of each
// other (the same reason specialist-identity.ts re-declares them). Behaviour is
// intentionally identical; see that file for the full rationale on each.

/** Plain JSON-shaped data object: non-null, non-array, prototype Object.prototype|null, not a Proxy. */
function isPlainDataObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (nodeTypes.isProxy(v)) return false; // a Proxy can lie on every trap → reject outright
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Own DATA value read through its own-property DESCRIPTOR — never fires a getter. */
function ownDataProp(
  o: object,
  key: string
): { kind: "absent" } | { kind: "accessor" } | { kind: "data"; value: unknown } {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}

const isNonEmptyStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Exactly the closed key set — no extras, no symbols. */
function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(o).length > 0) return false;
  const own = Object.getOwnPropertyNames(o);
  if (own.length !== keys.length) return false;
  for (const k of keys) if (!own.includes(k)) return false;
  return true;
}

// ── Path + hash rules (the load-bearing validation) ──────────────────────────

/** `sha256:` + exactly 64 lowercase hex. */
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;

export function isValidContentHash(v: unknown): v is string {
  return typeof v === "string" && CONTENT_HASH_RE.test(v);
}

/**
 * A project-root-relative path that cannot escape the root.
 *
 * Rejects, fail-closed:
 *   - absolute POSIX paths (`/…`) — the R10 fix;
 *   - Windows drive/UNC absolutes (`C:\…`, `\\server\…`);
 *   - any `..` segment (traversal), at any position;
 *   - a leading `./`, a trailing slash, an empty or `.`-only path;
 *   - empty segments (`a//b`), which normalize differently across readers;
 *   - a backslash anywhere — one separator convention only, so the string a
 *     validator checks is the string a resolver resolves;
 *   - NUL and other control characters.
 *
 * This is deliberately stricter than the filesystem: the envelope is a CONTRACT,
 * and a path that reads differently on two platforms is a hash-binding hazard.
 */
export function isProjectRelativePath(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(v)) return false;
  if (v.includes("\\")) return false; // no backslashes — POSIX separators only
  if (v.startsWith("/")) return false; // absolute
  if (/^[A-Za-z]:/.test(v)) return false; // Windows drive absolute
  if (v.endsWith("/")) return false; // directory form is not a definition
  const segments = v.split("/");
  for (const seg of segments) {
    if (seg.length === 0) return false; // empty segment (leading, trailing, or doubled slash)
    if (seg === ".") return false; // no `.` or `./` prefix — one canonical spelling
    if (seg === "..") return false; // traversal
  }
  return true;
}

// ── Validators (fail-closed: typed | null, NEVER throw) ──────────────────────

const PINNED_SKILL_KEYS = ["id", "relative_path", "content_hash"] as const;

const REF_KEYS = [
  "schema_version",
  "project_id",
  "kind",
  "id",
  "relative_path",
  "content_hash",
  "source_commit",
  "specialist_profile_hash",
  "specialist_type_hash",
  "skills",
] as const;

function validatePinnedSkillRefInner(obj: unknown): PinnedSkillRef | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, PINNED_SKILL_KEYS)) return null;

  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  if (idProp.kind !== "data" || pathProp.kind !== "data" || hashProp.kind !== "data") return null;

  if (!isNonEmptyStr(idProp.value)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;

  return {
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value,
  };
}

/**
 * Fail-closed validation of one `PinnedSkillRef`. Returns a FRESH object or NULL.
 * Never throws, never repairs.
 */
export function validatePinnedSkillRef(obj: unknown): PinnedSkillRef | null {
  try {
    return validatePinnedSkillRefInner(obj);
  } catch {
    return null;
  }
}

/**
 * Single-pass skill-array sanitizer. Validates AND copies in ONE read per index,
 * so there is no time-of-check/time-of-use gap (see specialist-identity.ts
 * `sanitizeStrArr` for the full reasoning — an accessor index that returns a valid
 * value on the first read and garbage on the second would otherwise validate yet
 * store the garbage).
 *
 * Also rejects DUPLICATE skill ids: a bundle naming one skill twice is ambiguous
 * about which bytes ride, and the transport must never guess.
 */
function sanitizeSkillArr(v: unknown): PinnedSkillRef[] | null {
  if (!Array.isArray(v)) return null;
  if (nodeTypes.isProxy(v)) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;

  // CODEX-REVIEW FIX (adversarial round 1): the array's own PROTOTYPE must be
  // exactly `Array.prototype`. Without this, an array built on a polluted or
  // custom prototype is accepted and silently normalized into a clean one —
  // accept-and-repair, which this contract forbids. A subclassed or
  // prototype-poisoned array is a fail-closed reject.
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;

  // `length` read EXACTLY ONCE through its own DATA descriptor — never `v.length`
  // in the loop guard (a Proxy could shrink it mid-loop to hide a later entry).
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

  // CODEX-REVIEW FIX (adversarial round 1): reject EXTRA own string keys. A
  // genuine JSON-parsed array has exactly the index keys plus `length`. An array
  // carrying `__proto__`, `constructor`, or any non-index own property is
  // smuggling data the index scan below would never see — and normalizing it away
  // is repair, not validation. Fail closed instead.
  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === "length") continue;
    // Canonical array index: a non-negative integer whose string form round-trips
    // (rejects "01", "1.0", "-1", " 1", "1e2", and every non-index name).
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null; // index beyond `length` — out-of-band data
  }

  const out: PinnedSkillRef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null; // hole or accessor → reject
    const skill = validatePinnedSkillRefInner(desc.value);
    if (skill === null) return null;
    if (seen.has(skill.id)) return null; // duplicate id ⇒ ambiguous bundle
    seen.add(skill.id);
    out.push(skill);
  }
  return out;
}

function validateProjectDefinitionRefV1Inner(obj: unknown): ProjectDefinitionRefV1 | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, REF_KEYS)) return null;

  const schemaProp = ownDataProp(obj, "schema_version");
  if (schemaProp.kind !== "data" || schemaProp.value !== PROJECT_DEFINITION_REF_SCHEMA) return null;

  const projectProp = ownDataProp(obj, "project_id");
  const kindProp = ownDataProp(obj, "kind");
  const idProp = ownDataProp(obj, "id");
  const pathProp = ownDataProp(obj, "relative_path");
  const hashProp = ownDataProp(obj, "content_hash");
  const commitProp = ownDataProp(obj, "source_commit");
  const profileHashProp = ownDataProp(obj, "specialist_profile_hash");
  const typeHashProp = ownDataProp(obj, "specialist_type_hash");
  const skillsProp = ownDataProp(obj, "skills");

  // Each checked individually rather than in a loop: a loop over a heterogeneous
  // array does not narrow the individual consts, and narrowing is what keeps the
  // `.value` reads type-safe below.
  if (projectProp.kind !== "data") return null; // absent or accessor → reject
  if (kindProp.kind !== "data") return null;
  if (idProp.kind !== "data") return null;
  if (pathProp.kind !== "data") return null;
  if (hashProp.kind !== "data") return null;
  if (commitProp.kind !== "data") return null;
  if (profileHashProp.kind !== "data") return null;
  if (typeHashProp.kind !== "data") return null;
  if (skillsProp.kind !== "data") return null;

  if (!isNonEmptyStr(projectProp.value)) return null;
  if (typeof kindProp.value !== "string" || !DEFINITION_KIND_SET.has(kindProp.value)) return null;
  const kind = kindProp.value as DefinitionKind;
  if (!isNonEmptyStr(idProp.value)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;

  // `source_commit`: a non-empty string or explicit null. `undefined` is NOT
  // accepted — an absent commit must be stated, not implied.
  if (commitProp.value !== null && !isNonEmptyStr(commitProp.value)) return null;

  // Identity hashes are raw sha256 hex (the shape hashSpecialistProfile emits —
  // NOT the "sha256:"-prefixed form this file uses for byte hashes). They are
  // carried verbatim as data; this module never computes or re-derives them.
  const isIdentityHash = (x: unknown): x is string =>
    typeof x === "string" && /^[0-9a-f]{64}$/.test(x);

  // kind:"agent" ⇒ BOTH identity hashes present. kind:"skill" ⇒ BOTH null.
  // A mixed state is invalid: a half-bound agent ref cannot complete the receipt
  // chain, and a skill ref carrying a profile hash is claiming an identity it has not got.
  if (kind === "agent") {
    if (!isIdentityHash(profileHashProp.value)) return null;
    if (!isIdentityHash(typeHashProp.value)) return null;
  } else {
    if (profileHashProp.value !== null) return null;
    if (typeHashProp.value !== null) return null;
  }

  const skills = sanitizeSkillArr(skillsProp.value);
  if (skills === null) return null;

  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: projectProp.value,
    kind,
    id: idProp.value,
    relative_path: pathProp.value,
    content_hash: hashProp.value,
    source_commit: commitProp.value as string | null,
    specialist_profile_hash: (kind === "agent" ? profileHashProp.value : null) as string | null,
    specialist_type_hash: (kind === "agent" ? typeHashProp.value : null) as string | null,
    skills,
  };
}

/**
 * Fail-closed validation of a `guild.project_definition_ref.v1`. Returns a FRESH,
 * sanitized ref or NULL — never throws, never repairs.
 *
 * Rejects: a non-plain object / wrong `schema_version`; any unknown or missing
 * top-level key (the shape is CLOSED) or any symbol key; an accessor field; an
 * absolute or traversing `relative_path`; a malformed `content_hash`; a
 * kind/identity-hash mismatch; a non-array, sparse, or duplicate-id `skills`.
 */
export function validateProjectDefinitionRefV1(obj: unknown): ProjectDefinitionRefV1 | null {
  try {
    return validateProjectDefinitionRefV1Inner(obj);
  } catch {
    return null; // NEVER throw: any exotic input maps to null.
  }
}

/**
 * Boolean shape check. Returns whether `value` COULD be validated — it does NOT
 * narrow, deliberately.
 *
 * CODEX-REVIEW FIX (adversarial round 1): this was a TypeScript type predicate
 * (`value is ProjectDefinitionRefV1`). That was unsound. The validator produces a
 * FRESH sanitized copy, but a type predicate narrows the CALLER'S ORIGINAL object
 * — so a caller would pass the check and then keep using the unsanitized input.
 * An alias holding a reference could mutate a field after the check, which is
 * exactly the time-of-check/time-of-use gap the single-pass sanitizers exist to
 * close. Narrowing the original silently re-opened it at the API boundary.
 *
 * USE `validateProjectDefinitionRefV1` AND CARRY ITS RETURN VALUE. The sanitized
 * copy is the only safe object; this predicate is for cheap "is this plausibly a
 * ref?" branching where the value is then re-validated, never for narrowing.
 */
export function isProjectDefinitionRefV1(value: unknown): boolean {
  return validateProjectDefinitionRefV1(value) !== null;
}

// ── Verification helper (pure — the artifact service supplies the bytes) ─────

/** Why a ref failed to verify. Maps 1:1 onto frozen EXECUTION_REASON_CODES. */
export const REF_VERIFICATION_FAILURES = [
  /** The ref itself is malformed → transport `invalid_request`. */
  "invalid_ref",
  /** Bytes were supplied but their hash does not match → transport `invalid_request`. */
  "hash_mismatch",
  /** The definition could not be read at `relative_path` → transport `capability_absent`. */
  "bytes_absent",
] as const;
export type RefVerificationFailure = (typeof REF_VERIFICATION_FAILURES)[number];

export interface RefVerification {
  ok: boolean;
  failure: RefVerificationFailure | null;
}

/**
 * Verify a ref against ALREADY-READ bytes' hash. PURE: the caller (artifact
 * service) does the I/O and the hashing; this decides.
 *
 * Fail-closed by construction — `actualContentHash === null` means "could not
 * read", which is `bytes_absent`, NEVER "assume fine". There is no third answer.
 *
 * @param ref               the candidate ref (validated here, so callers cannot skip it)
 * @param actualContentHash `sha256:<hex>` of the bytes actually read, or null if unreadable
 */
export function verifyRefAgainstBytes(
  ref: unknown,
  actualContentHash: string | null
): RefVerification {
  const valid = validateProjectDefinitionRefV1(ref);
  if (valid === null) return { ok: false, failure: "invalid_ref" };
  if (actualContentHash === null) return { ok: false, failure: "bytes_absent" };
  if (!isValidContentHash(actualContentHash)) return { ok: false, failure: "hash_mismatch" };
  if (actualContentHash !== valid.content_hash) return { ok: false, failure: "hash_mismatch" };
  return { ok: true, failure: null };
}
