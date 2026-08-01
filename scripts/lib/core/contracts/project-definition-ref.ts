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
/**
 * The COLLECTION bound on a pinned skill bundle — the containment ladder one rung
 * INSIDE the envelope.
 *
 * Every scalar here is shape-checked, and S3 bounds its `entries[]`, but `skills[]`
 * had no cap, so the outer bound was defeated one level down: a single ref carrying
 * 100,000 skills validated at ~15MB / 179ms, and S3 accepts 4096 entries. Per-item
 * validation without a count bound is not containment — it is containment-shaped.
 *
 * 256 is far above any real bundle (the whole plugin ships 111 skills; one
 * specialist pins a handful) and far below a denial-of-service quantity.
 */
export const MAX_SKILLS = 256;

/**
 * THE SCALAR BOUNDS — the rung BOUNDING COUNTS DOES NOT REACH (codex round 5, #6).
 *
 * `MAX_SKILLS` and S3's `MAX_ENTRIES` bound HOW MANY, and nothing here bounded HOW
 * BIG. Reproduced against the pristine tip: `project_id`, `id`, `relative_path`,
 * `source_commit` and both pinned-skill scalars each accepted an 8 MiB value, so a
 * ref with 256 skills whose ids were hundreds of MB validated — times 4,096 S3
 * entries. Per-item validation without a size bound is not containment; it is
 * containment-shaped, exactly as an uncapped array was one rung out.
 *
 * Every string field of this envelope is registered against one of these, and
 * `project-definition-ref` conformance tests assert that registration is TOTAL —
 * a new field added to `REF_KEYS` or `PINNED_SKILL_KEYS` without a bound is a red
 * build, not a silent hole. That is the only way this rung stops being re-missed;
 * it has now been missed twice.
 *
 * THE COMPOSED CEILING, computed once so nobody has to re-derive it. A pinned skill
 * is ≤ ~1.2 KiB (id + path + hash); a ref is ≤ ~1.6 KiB + 256 × 1.2 KiB ≈ 314 KiB;
 * an S3 entry is ≤ ~3.5 KiB + one ref ≈ 318 KiB; 4,096 entries ≈ 1.3 GiB. That is a
 * CEILING ON ACCEPTED PAYLOAD, reachable only by a caller who has already
 * materialised 1.3 GiB of parsed JSON — the validator adds no amplification on top.
 * Tightening it further is a `MAX_SKILLS` / `MAX_ENTRIES` decision, not a per-scalar
 * one, and is deliberately not taken here: both counts are frozen contract surface.
 */
export const MAX_PROJECT_ID = 128;
/** Role slug or skill name — the same budget S3 gives a legacy id. */
export const MAX_DEFINITION_ID = 128;
/**
 * RATIONALE CORRECTED (codex round 1 on this fix, #5). This said "matches S3's
 * `MAX_PATH`, so one path cannot be legal on one side and not the other" — which is
 * not a thing equal caps can achieve here. S3's `historical_path` is ABSOLUTE and
 * this field is RELATIVE; they are DIFFERENT fields describing different strings,
 * and an absolute spelling of the same file is necessarily longer. Equal numbers
 * never made them consistent.
 *
 * The cap stands on this file's own stated policy instead: "deliberately stricter
 * than the filesystem — the envelope is a CONTRACT". This locates a definition
 * inside a project root (`.guild/agents/<slug>.md`), not an arbitrary deep tree, so
 * 1024 is far above any real value while bounding the byte budget the composed
 * ceiling below multiplies. It is a policy number, not a derived one, and a deep
 * monorepo path beyond it is knowingly unrepresentable.
 */
export const MAX_RELATIVE_PATH = 1024;
/**
 * A commit-ish: a sha, a tag, a `git describe` string. Never a document.
 *
 * WAS 128, AND THAT REJECTED THE DOCUMENTED INPUT (codex round 1 on this fix, #4).
 * A real `git describe --tags --long` over a 126-character tag is 137 characters —
 * `<tag>-<n>-g<abbrev>` — so the bound refused a value the field's own doc promises
 * to accept. A bound that rejects the documented input is a defect in the bound.
 * 512 clears any realistic tag-plus-describe suffix (git ref components are
 * conventionally under 255) while staying orders of magnitude below a body.
 */
export const MAX_SOURCE_COMMIT = 512;

/**
 * Rule 6's universal shape gate, spelled exactly as `adoption-manifest.ts` spells
 * it — C0, C1, and the Unicode line separators. An id, path, or commit NEVER
 * contains one; a smuggled body always does. The two contracts share a field
 * (`relative_path` is carried verbatim into S3's traversal), so a character legal
 * here and illegal there would be an alias hole between them.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** A bounded, control-free, non-empty scalar. */
function isBoundedScalar(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL_RE.test(v);
}

/**
 * An IDENTITY token — spelled exactly as `adoption-manifest.ts` spells `TOKEN_RE`.
 *
 * BOUNDING WITHOUT SHAPE-CHECKING WAS HALF OF RULE 6 (codex round 1 on this fix,
 * #3). `id: "../outside"` and a pinned skill `id: "../../secret"` both validated:
 * these fields are documented as a role slug and a `.guild/skills/<id>/` directory
 * name, and a path-shaped value masquerades as a locator.
 *
 * The sharper consequence is a SEAM DEFECT. S3's legacy locator and its query both
 * require this shape, so a path-shaped S2 id could be a destination once and then
 * never legally become a later `from` identity — one identity, legal on one side of
 * the adoption manifest and illegal on the other. That is exactly the disagreement
 * D4 removed inside S3, reappearing across the S2/S3 boundary.
 *
 * NOT applied to `source_commit`: a git ref legitimately contains `/`
 * (`refs/tags/v2.5.0`), and over-tightening it would be its own defect.
 */
const IDENTITY_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A bounded, control-free, TOKEN-shaped identity. */
function isIdentityToken(v: unknown, max: number): v is string {
  return isBoundedScalar(v, max) && IDENTITY_TOKEN_RE.test(v);
}

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
  // BOUNDED FIRST (codex round 5, #6). Every rule below was a SHAPE rule, and a
  // shape rule says nothing about size: an 8 MiB path of legal segments validated.
  // The bound matches S3's `MAX_PATH`, so one path cannot be legal on one side of
  // the adoption manifest and illegal on the other.
  if (!isBoundedScalar(v, MAX_RELATIVE_PATH)) return false;
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

  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;

  // THE DECLARED ID MUST NAME THE BYTES IT CLAIMS (codex round 2, #3).
  //
  // `id` is documented above as "the `.guild/skills/<id>/` directory name", but id
  // and path were validated INDEPENDENTLY, so this passed:
  //
  //   { id: "read-only-review",
  //     relative_path: ".guild/skills/deploy-production/SKILL.md", … }
  //
  // A consumer selecting `read-only-review` was handed the deploy skill's pinned
  // bytes under a trusted name. That is the same category as S3's removal
  // limitation: an invariant the documentation states and the validator did not
  // keep, which is worse than an undocumented one because it is what readers plan
  // against.
  //
  // The rule is the OWNING DIRECTORY, not a fixed prefix, so it holds for both real
  // layouts — a project's `.guild/skills/<id>/SKILL.md` and the plugin's tiered
  // `skills/<tier>/<id>/SKILL.md` — without this envelope having to know either.
  // A path with no directory to own the id cannot satisfy it, and is refused.
  const segments = pathProp.value.split("/");
  if (segments.length < 2) return null;
  if (segments[segments.length - 2] !== idProp.value) return null;

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
  // THE COLLECTION BOUND, IN TWO PARTS THAT BOUND DIFFERENT THINGS.
  //
  // The `length` line was written first, then DELETED as redundant: a genuine JSON
  // array has exactly its indices plus `length`, so the own-key count bounds the
  // length too, and the anti-vacuity sweep showed nothing reddened without it. That
  // reasoning was sound about OUTCOMES and wrong about COST — which is exactly the
  // gap the sweep cannot see, since it only proves a guard changes an answer.
  //
  // Restored, ahead of the enumeration, because `getOwnPropertyNames` materialises
  // one string per own property BEFORE any cap is consulted. Measured on the
  // pristine tip, rejecting a dense array against a cap of 256:
  //
  //   250k → 112.8ms · 500k → 273.9ms · 1M → 541.0ms · 2M → 1392.4ms · 4M → 1909.9ms
  //
  // Linear in the INPUT. A rejection cost as much as an acceptance, which is what a
  // collection bound exists to prevent (codex round 5, #5).
  //
  // AND IT IS STILL OUTCOME-REDUNDANT — said plainly, because the deleted comment's
  // mistake was not its reasoning but its scope. Every oversized shape is rejected
  // without this line too: a dense one by the key count below, a sparse or partly
  // sparse one by the hole check in the index loop. Weakening this line reddens the
  // TIMING assertion and nothing else, and that is the whole point of keeping it.
  // A guard whose only observable effect is cost is still a guard; it just needs a
  // cost test, which is why D5's coverage is timed rather than behavioural.
  if (lenDesc.value > MAX_SKILLS) return null;
  //
  // Counting KEYS as well is what bounds the rest: `length` alone does not bound the
  // WORK, because an array with `length: 1` can still carry a million NAMED own
  // properties that the scan below walks (an earlier codex round: the bound "does
  // not bound the property-validation work it claims to contain"). Names are
  // materialised ONCE here and reused. The residual — one `getOwnPropertyNames` over
  // properties the caller already allocated — is unavoidable without an early-exit
  // own-key enumerator, and cannot arise from `JSON.parse`, this contract's actual
  // input path.
  const ownNames = Object.getOwnPropertyNames(v);
  if (ownNames.length > MAX_SKILLS + 1) return null;

  // CODEX-REVIEW FIX (adversarial round 1): reject EXTRA own string keys. A
  // genuine JSON-parsed array has exactly the index keys plus `length`. An array
  // carrying `__proto__`, `constructor`, or any non-index own property is
  // smuggling data the index scan below would never see — and normalizing it away
  // is repair, not validation. Fail closed instead.
  for (const k of ownNames) {
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
    // TWO IDS ON ONE LOCATOR — the same ambiguity from the other side (codex round 2,
    // #3) — needs NO separate guard, and the one written here was DELETED rather than
    // shipped untested. Since `validatePinnedSkillRefInner` now requires each id to
    // name its own owning directory, two entries sharing a `relative_path` share that
    // directory and therefore share an id, which the line above already rejects. The
    // anti-vacuity sweep confirmed it: weakening the locator check reddened nothing.
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

  if (!isIdentityToken(projectProp.value, MAX_PROJECT_ID)) return null;
  if (typeof kindProp.value !== "string" || !DEFINITION_KIND_SET.has(kindProp.value)) return null;
  const kind = kindProp.value as DefinitionKind;
  if (!isIdentityToken(idProp.value, MAX_DEFINITION_ID)) return null;
  if (!isProjectRelativePath(pathProp.value)) return null;
  if (!isValidContentHash(hashProp.value)) return null;

  // `source_commit`: a non-empty string or explicit null. `undefined` is NOT
  // accepted — an absent commit must be stated, not implied.
  if (commitProp.value !== null && !isBoundedScalar(commitProp.value, MAX_SOURCE_COMMIT)) {
    return null;
  }

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
