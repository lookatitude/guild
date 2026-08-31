/**
 * scripts/lib/core/contracts/specialist-identity.ts
 *
 * G7 (task-cell-runtime P1.1, ADDITIVE) — the two UPSTREAM identity schemas the
 * G2 ephemeral `guild.agent_instance.v1` binds by hash, plus the deterministic
 * hashing that PRODUCES those hashes, plus the projections that read the REAL
 * shipped feedstock into the schemas.
 *
 * The three-layer identity (ADR D3, task-cell-runtime-contract.md §D3):
 *
 *   TYPE     `guild.specialist_type.v2`     provider-NEUTRAL factory type — a role,
 *            (this file)                     its capability tags, its compatible
 *                                            skill refs, its SEMANTIC tool
 *                                            requirements, and a default MODEL TIER
 *                                            (never a provider model name). Immutable.
 *
 *   PROFILE  `guild.specialist_profile.v1`  the durable per-project customization —
 *            (this file)                     what a minted `.guild/agents/<role>.md`
 *                                            IS. Binds to a specific type version+hash
 *                                            via `derived_from`.
 *
 *   INSTANCE `guild.agent_instance.v1`       the EPHEMERAL runtime identity (G2,
 *            (task-cell-backend.ts)          task-cell-backend.ts). One per
 *                                            (task_run_id, attempt); NEVER reused.
 *                                            Carries `specialist_type_hash` +
 *                                            `specialist_profile_hash` — the outputs
 *                                            of THIS file's hashing.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ IDENTITY IS ANSWERED BY THIS FILE AND ONLY BY IT.                         │
 * │ `project-definition-ref.ts` LOCATES BYTES and CARRIES these identity      │
 * │ hashes AS OPAQUE DATA; it never recomputes or redefines identity.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The "replace provider model names with tiers" requirement lives here: a v2 type
 * carries a `default_model_tier` (`ModelTier` — cheap|mid|powerful), never `opus`
 * / `sonnet` / `haiku`. The projection maps a template's PROVIDER `model:` to a
 * tier via the canonical `tierForModel` ladder (reused from `roster.ts`, never
 * re-implemented; an explicit `default_tier:` frontmatter wins).
 *
 * Contract idioms mirror the G2 seam (`task-cell-backend.ts`) and G6a/G6b:
 *   - frozen literal `*_SCHEMA` strings;
 *   - fail-closed validators returning the typed value or NULL — NEVER throw,
 *     NEVER repair;
 *   - own-DATA descriptor reads + null/plain-prototype checks + dense-array checks,
 *     so an exotic input (a Proxy, a throwing getter, prototype pollution, a sparse
 *     array) is rejected rather than able to slip an unvalidated value through
 *     (mirrors `validateStationSignalsV1` / `validateTeamPlanV1` hardening).
 *
 * ADDITIVE: nothing here rewires production. `roster-resolve.ts`, `roster.ts`
 * (`tierForModel`, minting), the templates, and the minted agents keep their
 * current behavior. This is a contract + hashing + conformance lane, like G2/G6a.
 */

import * as crypto from "crypto";
import { types as nodeTypes } from "util";

import type { ModelTier } from "./task-cell-backend";
// REUSE the canonical provider-model→tier ladder + the template stamp constant —
// never re-implement them (brief §read-only reference; roster.ts is the SoT).
import { tierForModel, SPECIALIST_TEMPLATE_VERSION, type Tier } from "../../roster";

// ── Frozen schema strings ────────────────────────────────────────────────────

export const SPECIALIST_TYPE_SCHEMA = "guild.specialist_type.v2" as const;
export const SPECIALIST_PROFILE_SCHEMA = "guild.specialist_profile.v1" as const;

/**
 * The closed `ModelTier` set. `ModelTier` (G2) and `Tier` (roster.ts) are the
 * SAME three-value union, re-declared as neither owns the other; the compile-time
 * assertion below fails if they ever drift apart.
 */
export const MODEL_TIERS = Object.freeze(["cheap", "mid", "powerful"] as const);
type _ModelTierEqA = ModelTier extends (typeof MODEL_TIERS)[number] ? true : never;
type _ModelTierEqB = (typeof MODEL_TIERS)[number] extends ModelTier ? true : never;
type _TierEqA = Tier extends ModelTier ? true : never;
type _TierEqB = ModelTier extends Tier ? true : never;
const _mtA: _ModelTierEqA = true;
const _mtB: _ModelTierEqB = true;
const _tA: _TierEqA = true;
const _tB: _TierEqB = true;
void _mtA;
void _mtB;
void _tA;
void _tB;

const MODEL_TIER_SET: ReadonlySet<string> = new Set<string>(MODEL_TIERS);

function isModelTier(v: unknown): v is ModelTier {
  return typeof v === "string" && MODEL_TIER_SET.has(v);
}

// ── guild.specialist_type.v2 ─────────────────────────────────────────────────

/**
 * D3 — the provider-NEUTRAL factory type. IMMUTABLE: two structurally-equal types
 * hash identically (see `hashSpecialistType`). `default_model_tier` is a TIER, so
 * a concrete provider model is resolved only at dispatch (G2's `model_id`), never
 * baked into the type.
 */
export interface SpecialistTypeV2 {
  schema_version: typeof SPECIALIST_TYPE_SCHEMA;
  /** The role slug (e.g. "architect", "backend"). */
  type_id: string;
  /** The type's OWN version (independent of the template contract version). */
  version: string;
  role: string;
  capability_tags: string[];
  /** Semantic skill refs (guild skill names), NOT host tool names. */
  compatible_skill_refs: string[];
  /**
   * Semantic CAPABILITY requirements ("read-files", "run-shell", …), NOT concrete
   * host tool names. The projection maps a template's concrete `tools:` to these
   * (see `TOOL_TO_CAPABILITY`); an unrecognized tool is carried through verbatim
   * so nothing is silently dropped.
   */
  semantic_tool_requirements: string[];
  /** A TIER — never a provider model name. The core "tiers, not models" rule. */
  default_model_tier: ModelTier;
  /** Open-but-typed policy bag (e.g. `operating_style`, `personality`). JSON data only. */
  constraints: Record<string, unknown>;
  eval_fixture_refs: string[];
}

// ── guild.specialist_profile.v1 ──────────────────────────────────────────────

/** Binds a profile to a SPECIFIC type version+hash. Data — never recomputed. */
export interface SpecialistTypeBinding {
  type_id: string;
  type_version: string;
  type_hash: string;
}

/**
 * D3 — the DURABLE per-project customization: exactly what a minted
 * `.guild/agents/<role>.md` is. `derived_from` pins it to one type version+hash;
 * the profile hash includes that binding AS DATA (it never re-hashes the type).
 */
export interface SpecialistProfileV1 {
  schema_version: typeof SPECIALIST_PROFILE_SCHEMA;
  /** The role slug. */
  profile_id: string;
  version: string;
  derived_from: SpecialistTypeBinding;
  /** Project-specific added instructions, or null when the profile adds none. */
  project_instructions: string | null;
  /** Project-local skill refs layered on top of the type's compatible set. */
  local_skill_refs: string[];
}

// ── Hardening primitives (G2 / G6b idioms, re-declared to keep core/ import-free) ─

/**
 * A plain JSON-shaped data object: non-null, non-array, prototype `Object.prototype`
 * or `null`. Rejecting any other prototype closes the prototype-carried-key hole —
 * an inherited field on `Object.create({...})` would slip past an own-key scan and
 * later be read through the chain. Fail-closed: an exotic prototype ⇒ reject.
 */
function isPlainDataObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  if (nodeTypes.isProxy(v)) return false; // a Proxy can lie on every trap → reject outright
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * The own DATA value of `key` on `o`, read through its own-property DESCRIPTOR: a
 * validator must never invoke a caller-supplied getter (it could throw or return a
 * different value each read) nor read through the prototype chain. `absent` = no
 * own property; `accessor` = an own getter/setter (rejected); `data` = a plain own
 * value.
 */
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

/**
 * SINGLE-PASS string-array sanitizer — validate AND copy in ONE read per index, so
 * there is no time-of-check/time-of-use gap. A separate `validate(arr[i])` then
 * `[...arr]` copy reads each index TWICE; an accessor index that returns a valid
 * string on the first read and garbage on the second would validate yet store the
 * garbage. Here we read each index's OWN DATA descriptor exactly once and push THAT
 * SAME value into a fresh array. Returns null (fail-closed) for: a non-array; a
 * sparse hole or an accessor/getter index (no own data descriptor); a non-string or
 * empty entry. The returned array owns only the checked values — no later read can
 * differ from what was validated. (An exotic Proxy trap that throws is caught by the
 * caller's try/catch → null; the never-throws contract holds.)
 */
function sanitizeStrArr(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  // A Proxy array can lie on EVERY trap (`get`, `getOwnPropertyDescriptor`,
  // `ownKeys`, `has`) to present different data to different operations — no
  // userland descriptor/symbol check can defeat a consistent liar. Reject it
  // outright: the real input path is JSON-parsed config, never a Proxy.
  if (nodeTypes.isProxy(v)) return null;
  // For a GENUINE array: reject symbol-keyed data — fail-closed like the top-level
  // validators (`Object.getOwnPropertySymbols(o).length > 0 → null`); never silently drop it.
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  // Read `length` EXACTLY ONCE, through its OWN DATA descriptor — never `v.length`
  // in the loop guard: a Proxy can make `.length` shrink on each re-read and
  // terminate the loop early to hide a later invalid entry. `getOwnPropertyDescriptor`
  // reads a DIFFERENT trap (and falls through to the real target for a get-only
  // Proxy), and we snapshot the result so the loop bound is fixed.
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
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    // OWN DATA descriptor per index, read once; the value validated IS the value stored.
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null; // hole or accessor → reject
    const val = desc.value;
    if (typeof val !== "string" || val.length === 0) return null;
    out.push(val);
  }
  return out;
}

/**
 * Deep-clone a value into a FRESH JSON-data structure, reading every object field
 * through its own-data descriptor. THROWS on anything non-JSON (a function, a
 * symbol key, `undefined`, an accessor, a NaN/Infinity number, an exotic
 * prototype, a sparse-array hole). Callers wrap in try/catch → NULL. This is what
 * keeps `constraints` open-but-safe: after cloning, later canonical-JSON hashing
 * never fires a getter or walks a prototype chain.
 */
function cloneJsonData(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "string" || t === "boolean") return value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("non-finite number");
    return value;
  }
  // A Proxy (object OR array, at ANY nesting depth — cloneJsonData recurses, so
  // this fires on every nested value) can lie on every trap; reject outright.
  if (nodeTypes.isProxy(value)) throw new Error("proxy value not allowed in JSON data");
  if (Array.isArray(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("symbol key on array");
    // length via own-data descriptor, snapshotted once; each index via its own DATA
    // descriptor (rejects a hole or an accessor index — never invoke a getter).
    const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
    if (
      !lenDesc ||
      !("value" in lenDesc) ||
      typeof lenDesc.value !== "number" ||
      !Number.isInteger(lenDesc.value) ||
      lenDesc.value < 0
    ) {
      throw new Error("bad array length");
    }
    const out: unknown[] = [];
    for (let i = 0; i < lenDesc.value; i++) {
      const desc = Object.getOwnPropertyDescriptor(value, i);
      if (!desc || !("value" in desc)) throw new Error("sparse hole or accessor index");
      out.push(cloneJsonData(desc.value));
    }
    return out;
  }
  if (isPlainDataObject(value)) {
    if (Object.getOwnPropertySymbols(value).length > 0) throw new Error("symbol key");
    const out: Record<string, unknown> = {};
    for (const k of Object.getOwnPropertyNames(value)) {
      const prop = ownDataProp(value, k);
      if (prop.kind !== "data") throw new Error("accessor field"); // reject getters
      out[k] = cloneJsonData(prop.value);
    }
    return out;
  }
  throw new Error(`non-JSON value of type ${t}`);
}

// ── Validators (fail-closed: typed | null, never throw) ──────────────────────

/**
 * Fail-closed validation of a `guild.specialist_type.v2`. Returns a FRESH,
 * sanitized type or NULL — never throws, never repairs. Rejects:
 *   - a non-plain object / wrong `schema_version`;
 *   - any unknown top-level key (the shape is closed) or any symbol key;
 *   - a `default_model_tier` outside the `ModelTier` set (this is where a provider
 *     model name like "opus" is rejected — a type must carry a TIER);
 *   - a non-string / empty / sparse entry in any string-array field;
 *   - a `constraints` that is not JSON-safe plain data (accessor / exotic proto / symbol).
 */
export function validateSpecialistTypeV2(obj: unknown): SpecialistTypeV2 | null {
  try {
    return validateSpecialistTypeV2Inner(obj);
  } catch {
    return null; // NEVER throw (G2 idiom): any exotic input maps to null.
  }
}

const TYPE_KEYS = new Set([
  "schema_version",
  "type_id",
  "version",
  "role",
  "capability_tags",
  "compatible_skill_refs",
  "semantic_tool_requirements",
  "default_model_tier",
  "constraints",
  "eval_fixture_refs",
]);

function validateSpecialistTypeV2Inner(obj: unknown): SpecialistTypeV2 | null {
  if (!isPlainDataObject(obj)) return null;
  const o = obj;
  if (Object.getOwnPropertySymbols(o).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(o)) {
    if (!TYPE_KEYS.has(k)) return null; // closed shape
  }

  const schema = ownDataProp(o, "schema_version");
  if (schema.kind !== "data" || schema.value !== SPECIALIST_TYPE_SCHEMA) return null;

  const readStr = (k: string): string | null => {
    const p = ownDataProp(o, k);
    return p.kind === "data" && isNonEmptyStr(p.value) ? p.value : null;
  };
  const type_id = readStr("type_id");
  const version = readStr("version");
  const role = readStr("role");
  if (type_id === null || version === null || role === null) return null;

  const readStrArr = (k: string): string[] | null => {
    const p = ownDataProp(o, k);
    if (p.kind !== "data") return null;
    return sanitizeStrArr(p.value); // single-pass: validate + copy in one read per index
  };
  const capability_tags = readStrArr("capability_tags");
  const compatible_skill_refs = readStrArr("compatible_skill_refs");
  const semantic_tool_requirements = readStrArr("semantic_tool_requirements");
  const eval_fixture_refs = readStrArr("eval_fixture_refs");
  if (
    capability_tags === null ||
    compatible_skill_refs === null ||
    semantic_tool_requirements === null ||
    eval_fixture_refs === null
  ) {
    return null;
  }

  const tierProp = ownDataProp(o, "default_model_tier");
  if (tierProp.kind !== "data" || !isModelTier(tierProp.value)) return null;

  const constraintsProp = ownDataProp(o, "constraints");
  if (constraintsProp.kind !== "data" || !isPlainDataObject(constraintsProp.value)) return null;
  const constraints = cloneJsonData(constraintsProp.value) as Record<string, unknown>;

  return {
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id,
    version,
    role,
    capability_tags,
    compatible_skill_refs,
    semantic_tool_requirements,
    default_model_tier: tierProp.value,
    constraints,
    eval_fixture_refs,
  };
}

/**
 * Fail-closed validation of a `guild.specialist_profile.v1`. Returns a FRESH,
 * sanitized profile or NULL — never throws. Rejects a wrong `schema_version`, an
 * unknown/symbol top-level key, a missing/empty string field, a malformed
 * `derived_from` binding, a non-string/empty/sparse `local_skill_refs` entry, and
 * a `project_instructions` that is present but neither a non-empty string nor null.
 */
export function validateSpecialistProfileV1(obj: unknown): SpecialistProfileV1 | null {
  try {
    return validateSpecialistProfileV1Inner(obj);
  } catch {
    return null;
  }
}

const PROFILE_KEYS = new Set([
  "schema_version",
  "profile_id",
  "version",
  "derived_from",
  "project_instructions",
  "local_skill_refs",
]);

const BINDING_KEYS = new Set(["type_id", "type_version", "type_hash"]);

function validateBinding(v: unknown): SpecialistTypeBinding | null {
  if (!isPlainDataObject(v)) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(v)) {
    if (!BINDING_KEYS.has(k)) return null;
  }
  const read = (k: string): string | null => {
    const p = ownDataProp(v, k);
    return p.kind === "data" && isNonEmptyStr(p.value) ? p.value : null;
  };
  const type_id = read("type_id");
  const type_version = read("type_version");
  const type_hash = read("type_hash");
  if (type_id === null || type_version === null || type_hash === null) return null;
  return { type_id, type_version, type_hash };
}

function validateSpecialistProfileV1Inner(obj: unknown): SpecialistProfileV1 | null {
  if (!isPlainDataObject(obj)) return null;
  const o = obj;
  if (Object.getOwnPropertySymbols(o).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(o)) {
    if (!PROFILE_KEYS.has(k)) return null;
  }

  const schema = ownDataProp(o, "schema_version");
  if (schema.kind !== "data" || schema.value !== SPECIALIST_PROFILE_SCHEMA) return null;

  const readStr = (k: string): string | null => {
    const p = ownDataProp(o, k);
    return p.kind === "data" && isNonEmptyStr(p.value) ? p.value : null;
  };
  const profile_id = readStr("profile_id");
  const version = readStr("version");
  if (profile_id === null || version === null) return null;

  const derivedProp = ownDataProp(o, "derived_from");
  if (derivedProp.kind !== "data") return null;
  const derived_from = validateBinding(derivedProp.value);
  if (derived_from === null) return null;

  const piProp = ownDataProp(o, "project_instructions");
  if (piProp.kind !== "data") return null; // required key; must be own data
  const pi = piProp.value;
  if (!(pi === null || isNonEmptyStr(pi))) return null;

  const skillsProp = ownDataProp(o, "local_skill_refs");
  if (skillsProp.kind !== "data") return null;
  const local_skill_refs = sanitizeStrArr(skillsProp.value); // single-pass validate + copy
  if (local_skill_refs === null) return null;

  return {
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id,
    version,
    derived_from,
    project_instructions: pi as string | null,
    local_skill_refs,
  };
}

// ── Deterministic hashing ────────────────────────────────────────────────────

/**
 * Canonicalize a JSON value: RECURSIVELY sort object keys (making the hash
 * key-order-INDEPENDENT — two structurally-equal objects with different insertion
 * order produce the identical canonical form) while PRESERVING array order (arrays
 * are ordered data). Reads object fields through their own-data descriptor so a
 * getter cannot inject a value; the callers only ever pass already-validated
 * structures, so this stays total.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.getOwnPropertyNames(o).sort()) {
    out[k] = canonicalize(o[k]);
  }
  return out;
}

/** Canonical-JSON string: sorted keys, stable array order, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * The deterministic type hash — the SOURCE of the G2 instance's
 * `specialist_type_hash`. Hashes the FULL canonical type (every field, including
 * `constraints`). Key-order-INDEPENDENT (canonical sort) and content-SENSITIVE
 * (any field change changes the digest). sha256 hex.
 */
export function hashSpecialistType(type: SpecialistTypeV2): string {
  return sha256Hex(canonicalJson(type));
}

/**
 * The deterministic profile hash — the SOURCE of the G2 instance's
 * `specialist_profile_hash`. Hashes the FULL canonical profile. It does NOT
 * recompute the type: the bound type identity enters the profile hash purely AS
 * DATA, through `derived_from.type_hash`. So a profile pinned to a different type
 * version/hash hashes differently, but the type is never re-hashed here.
 */
export function hashSpecialistProfile(profile: SpecialistProfileV1): string {
  return sha256Hex(canonicalJson(profile));
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

// ── Projections: REAL feedstock → the schemas ────────────────────────────────

/**
 * The concrete-host-tool → semantic-capability map used when projecting a
 * template's `tools:` line. The template feedstock lists CONCRETE host tools
 * (Read/Write/Edit/Grep/Glob/Bash/…); the v2 type stores provider-NEUTRAL semantic
 * requirements. A tool NOT in this map is carried through verbatim (never dropped),
 * so the projection is total and auditable — the mapping choice is: map the known
 * host tools, pass the rest as-is.
 */
export const TOOL_TO_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  Read: "read-files",
  Write: "write-files",
  Edit: "edit-files",
  Grep: "search-code",
  Glob: "find-files",
  Bash: "run-shell",
  WebFetch: "fetch-web",
  WebSearch: "search-web",
});

/** Read one own-data field from parsed frontmatter (getters/proto reads rejected). */
function fmVal(fm: Record<string, unknown>, key: string): unknown {
  const p = ownDataProp(fm, key);
  return p.kind === "data" ? p.value : undefined;
}

function fmString(fm: Record<string, unknown>, key: string): string | null {
  const v = fmVal(fm, key);
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/**
 * Normalize a frontmatter `tools:` / `skills:` value to a string list. Accepts the
 * YAML array form AND the comma-flow string form (`tools: Read, Write, Edit`) the
 * shipped agents use. Non-string entries and blanks are dropped.
 */
function fmStringList(fm: Record<string, unknown>, key: string): string[] {
  const v = fmVal(fm, key);
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x === "string" && x.trim().length > 0) out.push(x.trim());
    }
    return out;
  }
  if (typeof v === "string" && v.trim().length > 0) {
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/** Dedupe preserving first-seen order. */
function dedupe(list: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    if (!seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

/**
 * Project a `guild.specialist_template.v1` template's frontmatter to a
 * `guild.specialist_type.v2`. Fail-closed (NULL on a shape it cannot project):
 *   - requires `template_version: guild.specialist_template.v1` + a `name`;
 *   - maps the PROVIDER `model:` → `default_model_tier` via `tierForModel`
 *     (explicit `default_tier:` frontmatter wins); a shape yielding NO tier is
 *     rejected — a type must carry a tier, never a provider name;
 *   - `name` → `type_id` + `role`;
 *   - `skills:` → `compatible_skill_refs`;
 *   - `tools:` → `semantic_tool_requirements` via `TOOL_TO_CAPABILITY` (unknown
 *     carried as-is), deduped;
 *   - `operating_style` / `personality` → `constraints` (when JSON-safe);
 *   - `version:` → `version` (defaults to "1" — templates rarely self-version);
 *   - `eval_fixture_refs:` → `eval_fixture_refs` (defaults to []).
 * The result is round-tripped through `validateSpecialistTypeV2`, so the projection
 * output is ALWAYS a validated type or null.
 */
export function specialistTypeFromTemplateFrontmatter(
  fm: Record<string, unknown>
): SpecialistTypeV2 | null {
  try {
    if (!isPlainDataObject(fm)) return null;
    if (fmString(fm, "template_version") !== SPECIALIST_TEMPLATE_VERSION) return null;

    const name = fmString(fm, "name");
    if (name === null) return null;

    // Provider model → tier. Explicit default_tier wins (roster.ts precedence).
    const explicit = fmString(fm, "default_tier");
    const tier: ModelTier | null = isModelTier(explicit)
      ? explicit
      : tierForModel(fmString(fm, "model"));
    if (tier === null) return null; // no derivable tier ⇒ cannot project

    const semanticTools = dedupe(
      fmStringList(fm, "tools").map((t) => TOOL_TO_CAPABILITY[t] ?? t)
    );

    const constraints: Record<string, unknown> = {};
    const operatingStyle = fmString(fm, "operating_style");
    if (operatingStyle !== null) constraints["operating_style"] = operatingStyle;
    const personality = fmVal(fm, "personality");
    if (isPlainDataObject(personality)) {
      try {
        constraints["personality"] = cloneJsonData(personality);
      } catch {
        // A non-JSON personality block is simply omitted from constraints (the
        // type still projects) — it is never allowed to make the whole type fail.
      }
    }

    const candidate: SpecialistTypeV2 = {
      schema_version: SPECIALIST_TYPE_SCHEMA,
      type_id: name,
      version: fmString(fm, "version") ?? "1",
      role: name,
      capability_tags: dedupe(fmStringList(fm, "capability_tags")),
      compatible_skill_refs: dedupe(fmStringList(fm, "skills")),
      semantic_tool_requirements: semanticTools,
      default_model_tier: tier,
      constraints,
      eval_fixture_refs: dedupe(fmStringList(fm, "eval_fixture_refs")),
    };
    return validateSpecialistTypeV2(candidate);
  } catch {
    return null;
  }
}

/**
 * Project a minted `.guild/agents/<role>.md` frontmatter to a
 * `guild.specialist_profile.v1` bound to `boundType`. Fail-closed:
 *   - requires a `name` and a well-formed `boundType`;
 *   - `name` → `profile_id`;
 *   - `version:` → `version` (defaults to "1");
 *   - `project_instructions:` → `project_instructions` (string) else null;
 *   - `skills:` → `local_skill_refs`.
 * Round-tripped through `validateSpecialistProfileV1`.
 */
export function specialistProfileFromAgentFrontmatter(
  fm: Record<string, unknown>,
  boundType: SpecialistTypeBinding
): SpecialistProfileV1 | null {
  try {
    if (!isPlainDataObject(fm)) return null;
    const binding = validateBinding(boundType);
    if (binding === null) return null;

    const name = fmString(fm, "name");
    if (name === null) return null;

    const projectInstructions = fmString(fm, "project_instructions");

    const candidate: SpecialistProfileV1 = {
      schema_version: SPECIALIST_PROFILE_SCHEMA,
      profile_id: name,
      version: fmString(fm, "version") ?? "1",
      derived_from: binding,
      project_instructions: projectInstructions,
      local_skill_refs: dedupe(fmStringList(fm, "skills")),
    };
    return validateSpecialistProfileV1(candidate);
  } catch {
    return null;
  }
}
