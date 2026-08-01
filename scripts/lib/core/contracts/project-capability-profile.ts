/**
 * scripts/lib/core/contracts/project-capability-profile.ts
 *
 * Capability localization — `guild.project_capability_profile.v1`: the typed,
 * evidence-backed REPORT a full Learn emits describing what judgment ownership
 * and repeatable methods a project needs.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS A REPORT, NOT A MUTATION.                                         │
 * │ Emitting a profile changes no agent, no skill, and no registry.           │
 * │ `mutation_performed` ASSERTS that; `mutation_evidence` PROVES it.         │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * THE SEAM THIS EXISTS TO CREATE (spec S1, decision cap-loc-D01/D04)
 *
 * Learn may emit evidence and candidates; it may NOT write live agent or skill
 * definitions. That rule is unenforceable as prose. This artifact is the seam
 * that makes it mechanical: everything downstream of Learn reads THIS, not the
 * knowledge graph. A consumer that wants a capability decision has to come
 * through a file whose type cannot say "I changed something".
 *
 * WHY `mutation_performed` IS THE LITERAL TYPE `false` AND NOT `boolean`
 *
 * A `boolean` field invites a producer to write `true` and a reader to branch on
 * it — which would make "did Learn mutate?" a runtime question. As the literal
 * type `false` the TYPE ADMITS NO OTHER VALUE: a producer writing `true` is a
 * COMPILE error, and a reader that finds anything but `false` at runtime treats
 * the artifact as corrupt rather than as a mutation report. There is no branch to
 * write, because there is no second case.
 *
 * The declaration alone would still be cheap talk, so it is paired with
 * `mutation_evidence`: before/after tree hashes over `.guild/agents/**`,
 * `.guild/skills/**`, and both registry projections. THE VALIDATOR REJECTS A
 * PROFILE WHOSE BEFORE AND AFTER HASHES DIFFER (A1.6). The no-mutation guarantee
 * is checked here, not merely declared.
 *
 * A1.5 asserts, A1.6 checks, A1.7 (a real Learn run against a fixture repo)
 * proves it on the live path. All three or none — A1.7 is integration-owned and
 * is NOT in this module; see "Deferred" below.
 *
 * WHY EVIDENCE REFS ARE STRUCTURED AND NOT FREE TEXT
 *
 * Free text is what lets an "evidence-backed" claim be unfalsifiable. Every
 * citation here parses to `<source>:<locator>[#<anchor>]` against a CLOSED source
 * vocabulary, so a dangling or fabricated citation is a shape error at the
 * boundary rather than a plausible sentence nobody checks.
 *
 * This module validates ref SHAPE. It cannot validate ref RESOLUTION — that
 * needs the feedstock, which is I/O. Resolution is A1.10, owned by the
 * conformance layer. Shape-only validation would let a well-formed fabrication
 * pass, so A1.10 is not optional; it is simply not implementable here.
 *
 * CONTRACT: pure types + fail-closed validators. No I/O, no clock, NEVER throws.
 *
 * DEFERRED, WITH OWNERS (deliberately absent from this file, so their absence is
 * legible rather than forgotten). None is optional; each is simply not
 * implementable in a pure contract module:
 *   A1.7   real full-Learn run mutates nothing   — needs a fixture repo + runner  → Task #6
 *   A1.9   absent feedstock is recorded          — needs a real Learn invocation  → Task #6
 *   A1.10  every evidence ref RESOLVES           — needs the feedstock; I/O       → Task #9 ledger
 *
 * A1.10 is the one to keep visible: this module validates ref SHAPE, so a
 * well-formed FABRICATION passes here. Only resolution against real feedstock
 * catches it.
 *
 * C5 DUAL-HOME: this file is mirrored at
 * src/modules/capability/resources/scripts/lib/core/contracts/project-capability-profile.ts.
 * Both homes change in ONE commit + `sync:module-resources`; a single-home edit
 * silently reverts.
 */

import { types as nodeTypes } from "util";

import {
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "./project-definition-ref";

// ── Frozen schema string ─────────────────────────────────────────────────────

export const PROJECT_CAPABILITY_PROFILE_SCHEMA = "guild.project_capability_profile.v1" as const;

/**
 * D04's suggestion budget, as the contract default. The resolved config key
 * `capability.suggestion_budget` overrides it per project; D04 fixes the value at
 * 4 in every location the plan states it.
 *
 * A profile exceeding the budget is INVALID, never truncated — truncating would
 * silently discard a candidate a human was meant to see, which is the failure
 * mode the budget exists to prevent in the other direction.
 */
export const DEFAULT_SUGGESTION_BUDGET = 4;

/** The five resolver modes (S5 / decision cap-loc-D04). Recorded, never inferred. */
export const RESOLVER_MODES = ["legacy", "observe", "shadow", "project-local", "strict"] as const;
export type ResolverMode = (typeof RESOLVER_MODES)[number];
const RESOLVER_MODE_SET: ReadonlySet<string> = new Set<string>(RESOLVER_MODES);

/** Confidence grades. Closed. */
export const CONFIDENCE_GRADES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE_GRADES)[number];
const CONFIDENCE_SET: ReadonlySet<string> = new Set<string>(CONFIDENCE_GRADES);

/** What a human is being asked to do with a candidate. Closed. */
export const CANDIDATE_ACTIONS = ["propose", "observe", "defer"] as const;
export type CandidateAction = (typeof CANDIDATE_ACTIONS)[number];
const CANDIDATE_ACTION_SET: ReadonlySet<string> = new Set<string>(CANDIDATE_ACTIONS);

/** A candidate is an agent or a skill. Nothing else. */
export const CANDIDATE_KINDS = ["agent", "skill"] as const;
export type CandidateKind = (typeof CANDIDATE_KINDS)[number];
const CANDIDATE_KIND_SET: ReadonlySet<string> = new Set<string>(CANDIDATE_KINDS);

/**
 * The closed feedstock vocabulary an evidence ref may cite.
 *
 * `run` and `reflection` are the only two that describe HISTORY. That distinction
 * is load-bearing: a `MethodFact`'s `occurrence_count` is a claim about how often
 * something happened, so it must cite history and not code (A1.11).
 */
export const EVIDENCE_SOURCES = [
  "codebase_map",
  "knowledge_graph",
  "run",
  "reflection",
  "roster",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
const EVIDENCE_SOURCE_SET: ReadonlySet<string> = new Set<string>(EVIDENCE_SOURCES);

/** The subset of sources that may back a `MethodFact.occurrence_count` (A1.11). */
export const HISTORICAL_EVIDENCE_SOURCES = ["run", "reflection"] as const;
const HISTORICAL_SOURCE_SET: ReadonlySet<string> = new Set<string>(HISTORICAL_EVIDENCE_SOURCES);

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * One parsed citation. Serialized on the wire as a compact string; this is what
 * it parses TO.
 *
 * Wire format: `<source>:<locator>[#<anchor>]`
 *   "knowledge_graph:node/domain/dispatch"
 *   "run:run-20260730-131020-dynamic-host-model-routing"
 *   "codebase_map:plugin/src/modules/dispatch/workflows/execution-transport-ports.ts#74"
 */
export interface EvidenceRef {
  source: EvidenceSource;
  /**
   * Locator within that source:
   *   codebase_map    → project-relative file path
   *   knowledge_graph → node id
   *   run             → run id
   *   reflection      → .guild/reflections/<run-id>.md
   *   roster          → role slug
   */
  locator: string;
  /** Optional line/anchor within the locator. */
  anchor: string | null;
}

/**
 * Before/after tree hashes proving `mutation_performed`.
 *
 * The plan's "Empty project, full Learn" conformance row demands a before/after
 * tree hash. Carrying it IN the artifact means the proof travels with the claim
 * instead of living only in a test that a future reader may never run.
 */
export interface MutationEvidence {
  /** sha256 over the canonical listing of `.guild/agents/**` before emission. */
  agents_tree_hash_before: string;
  agents_tree_hash_after: string;
  /** sha256 over the canonical listing of `.guild/skills/**` before emission. */
  skills_tree_hash_before: string;
  skills_tree_hash_after: string;
  /** Both registry projections. */
  registry_hash_before: string;
  registry_hash_after: string;
}

/** Hashes of the feedstock, so a reader can tell whether the profile is stale. */
export interface FeedstockBinding {
  codebase_map_hash: string | null;
  knowledge_graph_hash: string | null;
  /** canonicalJson of sorted role ids + profile hashes. */
  roster_hash: string | null;
  /**
   * Which inputs were ABSENT. Never silently omitted: a profile built with no
   * knowledge graph says so, and a reader can downgrade its trust accordingly
   * instead of mistaking absence for emptiness (A1.9).
   */
  absent: string[];
}

/** What the project's work actually consists of. Descriptive — never prescriptive. */
export interface DomainFact {
  id: string;
  label: string;
  /** Graph node ids / file paths this was derived from. Never empty. */
  evidence_refs: string[];
  confidence: Confidence;
}

/** A judgment/ownership seam the graph exposes. */
export interface BoundaryFact {
  id: string;
  label: string;
  /** Why this is a JUDGMENT seam and not just a module edge. */
  rationale: string;
  evidence_refs: string[];
  confidence: Confidence;
}

/** A method observed repeating. Feeds SKILL candidates. */
export interface MethodFact {
  id: string;
  label: string;
  /** How many DISTINCT tasks/phases this method was observed in. */
  occurrence_count: number;
  /**
   * The run ids / reflection paths backing `occurrence_count`. Length MUST equal
   * it, entries MUST be deduped, and every entry MUST cite history (A1.4, A1.11).
   */
  evidence_refs: string[];
  confidence: Confidence;
}

export interface CoveredEntry {
  /** DomainFact.id | BoundaryFact.id */
  fact_id: string;
  /**
   * Exact hash-bound ref to the covering definition — NEVER a bare role name, so
   * "already covered" cannot silently match a renamed or mutated definition
   * (A1.8).
   */
  covered_by: ProjectDefinitionRefV1;
}

export interface CoverageVerdict {
  covered: CoveredEntry[];
  /** Domains/boundaries with no covering role or skill. */
  uncovered: string[];
  /** Roles present but matching no domain — REPORTED, never auto-removed. */
  unmatched_roles: string[];
}

export interface CapabilityCandidate {
  id: string;
  kind: CandidateKind;
  /** Role slug or skill name. */
  proposed_id: string;
  /** Which facts justify it. MUST be non-empty — no evidence, no candidate (A1.2). */
  justified_by: string[];
  action: CandidateAction;
  /** Required when action is observe/defer: why it is not a proposal. */
  defer_reason: string | null;
  confidence: Confidence;
  /** Nearest owning layer — workspace vs a named child. Federation rule (S4). */
  owning_layer: string;
}

/**
 * `guild.project_capability_profile.v1`.
 *
 * Note what is ABSENT and deliberately so: no field can express a change made.
 * The artifact has no "applied", no "written", no "adopted" — adoption is the
 * adoption manifest's job (S3), behind a human gate.
 */
export interface ProjectCapabilityProfileV1 {
  schema_version: typeof PROJECT_CAPABILITY_PROFILE_SCHEMA;

  /** Which project this describes. Matches `project_definition_ref.project_id` (S2). */
  project_id: string;
  /** Run that produced it. Binds the profile to replayable evidence. */
  run_id: string;
  /** RFC3339 UTC, caller-supplied — no clock in the contract. */
  generated_at: string;
  /** Commit the feedstock was read at, or null when not a git tree. */
  source_commit: string | null;

  feedstock: FeedstockBinding;

  domains: DomainFact[];
  boundaries: BoundaryFact[];
  repeated_methods: MethodFact[];

  /** What the CURRENT roster already covers. Prevents duplicate candidates. */
  coverage: CoverageVerdict;

  /** At most `suggestion_budget` (D04 default 4). MAY be empty. */
  candidates: CapabilityCandidate[];

  /** Resolver mode at emission — a profile emitted under `observe` says so. */
  resolver_mode: ResolverMode;

  /**
   * THE NO-MUTATION INVARIANT, AS A FIELD. Literal `false`; the type admits no
   * other value. See the file header for why this is not a `boolean`.
   */
  mutation_performed: false;

  /** Before/after tree hashes proving the assertion above. */
  mutation_evidence: MutationEvidence;
}

// ── Hardening primitives ─────────────────────────────────────────────────────
// Re-declared rather than imported, exactly as specialist-identity.ts and
// project-definition-ref.ts do, so the hardening of one contract can never be
// weakened by an edit to another. Behaviour is intentionally identical.

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

/**
 * Read an array's own DATA elements ONCE each, rejecting every exotic shape.
 *
 * Same reasoning as `sanitizeSkillArr` in project-definition-ref.ts, including
 * both Codex-review hardenings carried forward deliberately: the prototype must
 * be exactly `Array.prototype` (a subclassed or prototype-poisoned array is a
 * fail-closed reject, not something to normalize), and extra own string keys are
 * rejected rather than ignored (an array carrying `__proto__` or a non-index name
 * is smuggling data the index scan would never see).
 *
 * `length` is read EXACTLY ONCE through its own data descriptor so a Proxy cannot
 * shrink it mid-loop to hide a later entry.
 */
function readDataArray(v: unknown): unknown[] | null {
  if (!Array.isArray(v)) return null;
  if (nodeTypes.isProxy(v)) return null;
  if (Object.getOwnPropertySymbols(v).length > 0) return null;
  if (Object.getPrototypeOf(v) !== Array.prototype) return null;

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

  for (const k of Object.getOwnPropertyNames(v)) {
    if (k === "length") continue;
    const n = Number(k);
    if (!Number.isInteger(n) || n < 0 || String(n) !== k) return null;
    if (n >= lenDesc.value) return null; // index beyond `length` — out-of-band data
  }

  const out: unknown[] = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const desc = Object.getOwnPropertyDescriptor(v, i);
    if (!desc || !("value" in desc)) return null; // hole or accessor → reject
    out.push(desc.value);
  }
  return out;
}

/** Array of non-empty strings, single-pass, no duplicates permitted when `unique`. */
function readStrArray(v: unknown, opts: { unique?: boolean } = {}): string[] | null {
  const raw = readDataArray(v);
  if (raw === null) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isNonEmptyStr(entry)) return null;
    if (opts.unique) {
      if (seen.has(entry)) return null;
      seen.add(entry);
    }
    out.push(entry);
  }
  return out;
}

// ── Evidence-ref parsing (shape only — resolution is A1.10, integration-owned) ──

/** `sha256:` + exactly 64 lowercase hex, or bare 64-hex. Tree hashes use the bare form. */
const TREE_HASH_RE = /^[0-9a-f]{64}$/;
const PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/;

/** A feedstock hash: bare 64-hex or the `sha256:`-prefixed form. */
export function isFeedstockHash(v: unknown): v is string {
  return typeof v === "string" && (TREE_HASH_RE.test(v) || PREFIXED_HASH_RE.test(v));
}

/** A tree hash in `mutation_evidence`: bare 64 lowercase hex. */
export function isTreeHash(v: unknown): v is string {
  return typeof v === "string" && TREE_HASH_RE.test(v);
}

/**
 * Parse one wire-format evidence ref: `<source>:<locator>[#<anchor>]`.
 *
 * Returns the parsed ref or NULL. Never throws.
 *
 * Splitting rules that matter:
 *   - the FIRST `:` separates source from locator, so a locator may itself contain
 *     `:` (a Windows-ish path or a URL-shaped node id) without ambiguity;
 *   - the LAST `#` separates the anchor, so a locator containing `#` still parses
 *     (the anchor is the trailing fragment, as in a URL);
 *   - an empty source, empty locator, or empty anchor is INVALID — a ref that
 *     points nowhere is worse than no ref, because it reads as a citation.
 */
export function parseEvidenceRef(v: unknown): EvidenceRef | null {
  if (!isNonEmptyStr(v)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(v)) return null;

  const colon = v.indexOf(":");
  if (colon <= 0) return null; // no source, or empty source
  const source = v.slice(0, colon);
  if (!EVIDENCE_SOURCE_SET.has(source)) return null; // closed vocabulary

  let rest = v.slice(colon + 1);
  if (rest.length === 0) return null;

  let anchor: string | null = null;
  const hash = rest.lastIndexOf("#");
  if (hash !== -1) {
    anchor = rest.slice(hash + 1);
    rest = rest.slice(0, hash);
    if (anchor.length === 0) return null; // trailing `#` with no anchor
  }
  if (rest.length === 0) return null; // empty locator
  if (!isCanonicalLocator(rest)) return null;

  return { source: source as EvidenceSource, locator: rest, anchor };
}

/**
 * A locator must have exactly ONE spelling per referent.
 *
 * CODEX-REVIEW FIX (adversarial round 1, second defect). Dedup in
 * `readEvidenceRefArray` compares raw strings, so two spellings of one referent
 * counted as two distinct citations and inflated `occurrence_count` — the exact
 * A1.4 guarantee the dedup exists to provide. Reproduced as:
 *
 *   occurrence_count: 2, evidence_refs: [
 *     "reflection:.guild/reflections/r.md",
 *     "reflection:.guild/reflections/./r.md",   // same file, different spelling
 *   ]
 *   // => ACCEPTED with count 2, backed by ONE reflection.
 *
 * The fix REJECTS non-canonical spellings rather than normalizing them.
 * Normalizing would be accept-and-repair, which this contract forbids
 * everywhere else — and it would silently rewrite a citation, which is the last
 * thing an evidence contract should do. Rejecting means raw-string dedup is
 * sound by construction: if only one spelling can validate, two distinct strings
 * are two distinct referents.
 *
 * Applied uniformly to every source. Run ids and node ids are unaffected (they
 * contain no `.` or `..` segments); path-shaped locators get the same rules
 * `isProjectRelativePath` applies in project-definition-ref.ts.
 */
export function isCanonicalLocator(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0) return false;
  if (v.includes("\\")) return false; // one separator convention only
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false; // leading, trailing, or doubled slash
    if (seg === ".") return false; // `./` or `/./` — an alias for the same referent
    if (seg === "..") return false; // traversal, and also an alias
  }
  return true;
}

/** Whether a wire-format ref is well-shaped. Shape only — see A1.10 for resolution. */
export function isEvidenceRef(v: unknown): boolean {
  return parseEvidenceRef(v) !== null;
}

/**
 * Evidence-ref array: every entry parses, and entries are DEDUPED.
 *
 * Dedup matters for `MethodFact`: `occurrence_count` counts distinct refs, so a
 * doubled citation must not be able to inflate a count (A1.4).
 *
 * When `historicalOnly`, every ref must cite `run` or `reflection` — a claim
 * about how often something happened has to cite history, not code (A1.11).
 */
function readEvidenceRefArray(v: unknown, opts: { historicalOnly?: boolean } = {}): string[] | null {
  const raw = readStrArray(v, { unique: true });
  if (raw === null) return null;
  for (const entry of raw) {
    const parsed = parseEvidenceRef(entry);
    if (parsed === null) return null;
    if (opts.historicalOnly && !HISTORICAL_SOURCE_SET.has(parsed.source)) return null;
  }
  return raw;
}

// ── Sub-shape validators ─────────────────────────────────────────────────────

const MUTATION_EVIDENCE_KEYS = [
  "agents_tree_hash_before",
  "agents_tree_hash_after",
  "skills_tree_hash_before",
  "skills_tree_hash_after",
  "registry_hash_before",
  "registry_hash_after",
] as const;

/**
 * Validate `mutation_evidence` AND enforce the no-mutation guarantee (A1.6).
 *
 * This is the function that turns `mutation_performed: false` from a declaration
 * into a checked property: if ANY before/after pair differs, the profile is
 * invalid. A Learn run that mutated the tree cannot produce a valid profile — it
 * has to either report the mutation (impossible, the type forbids it) or fail
 * validation. There is no third outcome, which is the point.
 */
function validateMutationEvidenceInner(obj: unknown): MutationEvidence | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, MUTATION_EVIDENCE_KEYS)) return null;

  const values: Record<string, string> = {};
  for (const key of MUTATION_EVIDENCE_KEYS) {
    const prop = ownDataProp(obj, key);
    if (prop.kind !== "data") return null;
    if (!isTreeHash(prop.value)) return null;
    values[key] = prop.value;
  }

  // A1.6 — the guarantee, checked. All three pairs must be identical.
  if (values.agents_tree_hash_before !== values.agents_tree_hash_after) return null;
  if (values.skills_tree_hash_before !== values.skills_tree_hash_after) return null;
  if (values.registry_hash_before !== values.registry_hash_after) return null;

  return {
    agents_tree_hash_before: values.agents_tree_hash_before,
    agents_tree_hash_after: values.agents_tree_hash_after,
    skills_tree_hash_before: values.skills_tree_hash_before,
    skills_tree_hash_after: values.skills_tree_hash_after,
    registry_hash_before: values.registry_hash_before,
    registry_hash_after: values.registry_hash_after,
  };
}

/** Fail-closed validation of a `MutationEvidence`. Returns a FRESH object or NULL. */
export function validateMutationEvidence(obj: unknown): MutationEvidence | null {
  try {
    return validateMutationEvidenceInner(obj);
  } catch {
    return null;
  }
}

const FEEDSTOCK_KEYS = [
  "codebase_map_hash",
  "knowledge_graph_hash",
  "roster_hash",
  "absent",
] as const;

function validateFeedstockInner(obj: unknown): FeedstockBinding | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, FEEDSTOCK_KEYS)) return null;

  const cm = ownDataProp(obj, "codebase_map_hash");
  const kg = ownDataProp(obj, "knowledge_graph_hash");
  const roster = ownDataProp(obj, "roster_hash");
  const absentProp = ownDataProp(obj, "absent");
  if (cm.kind !== "data" || kg.kind !== "data") return null;
  if (roster.kind !== "data" || absentProp.kind !== "data") return null;

  // Each hash is a hash or an EXPLICIT null. `undefined` is not accepted: an
  // absent input must be stated, not implied (A1.9's contract half).
  if (cm.value !== null && !isFeedstockHash(cm.value)) return null;
  if (kg.value !== null && !isFeedstockHash(kg.value)) return null;
  if (roster.value !== null && !isFeedstockHash(roster.value)) return null;

  const absent = readStrArray(absentProp.value, { unique: true });
  if (absent === null) return null;

  return {
    codebase_map_hash: cm.value as string | null,
    knowledge_graph_hash: kg.value as string | null,
    roster_hash: roster.value as string | null,
    absent,
  };
}

const DOMAIN_KEYS = ["id", "label", "evidence_refs", "confidence"] as const;
const BOUNDARY_KEYS = ["id", "label", "rationale", "evidence_refs", "confidence"] as const;
const METHOD_KEYS = ["id", "label", "occurrence_count", "evidence_refs", "confidence"] as const;

function validateDomainFactInner(obj: unknown): DomainFact | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, DOMAIN_KEYS)) return null;

  const id = ownDataProp(obj, "id");
  const label = ownDataProp(obj, "label");
  const refs = ownDataProp(obj, "evidence_refs");
  const conf = ownDataProp(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;

  if (!isNonEmptyStr(id.value) || !isNonEmptyStr(label.value)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;

  const evidence = readEvidenceRefArray(refs.value);
  if (evidence === null || evidence.length === 0) return null; // never empty

  return {
    id: id.value,
    label: label.value,
    evidence_refs: evidence,
    confidence: conf.value as Confidence,
  };
}

function validateBoundaryFactInner(obj: unknown): BoundaryFact | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, BOUNDARY_KEYS)) return null;

  const id = ownDataProp(obj, "id");
  const label = ownDataProp(obj, "label");
  const rationale = ownDataProp(obj, "rationale");
  const refs = ownDataProp(obj, "evidence_refs");
  const conf = ownDataProp(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || rationale.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;

  if (!isNonEmptyStr(id.value) || !isNonEmptyStr(label.value)) return null;
  // A boundary asserts a JUDGMENT seam; an unexplained one is an unfalsifiable
  // claim, so the rationale is required rather than optional.
  if (!isNonEmptyStr(rationale.value)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;

  const evidence = readEvidenceRefArray(refs.value);
  if (evidence === null || evidence.length === 0) return null;

  return {
    id: id.value,
    label: label.value,
    rationale: rationale.value,
    evidence_refs: evidence,
    confidence: conf.value as Confidence,
  };
}

function validateMethodFactInner(obj: unknown): MethodFact | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, METHOD_KEYS)) return null;

  const id = ownDataProp(obj, "id");
  const label = ownDataProp(obj, "label");
  const count = ownDataProp(obj, "occurrence_count");
  const refs = ownDataProp(obj, "evidence_refs");
  const conf = ownDataProp(obj, "confidence");
  if (id.kind !== "data" || label.kind !== "data" || count.kind !== "data") return null;
  if (refs.kind !== "data" || conf.kind !== "data") return null;

  if (!isNonEmptyStr(id.value) || !isNonEmptyStr(label.value)) return null;
  if (typeof count.value !== "number" || !Number.isInteger(count.value) || count.value < 1) {
    return null;
  }
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;

  // A1.11 — a recurrence claim must cite HISTORY (run / reflection), not code.
  const evidence = readEvidenceRefArray(refs.value, { historicalOnly: true });
  if (evidence === null) return null;

  // A1.4 — the count is never asserted without matching backing refs. Combined
  // with the dedup in readEvidenceRefArray, a doubled citation cannot inflate it.
  if (evidence.length !== count.value) return null;

  return {
    id: id.value,
    label: label.value,
    occurrence_count: count.value,
    evidence_refs: evidence,
    confidence: conf.value as Confidence,
  };
}

const COVERED_ENTRY_KEYS = ["fact_id", "covered_by"] as const;

function validateCoveredEntryInner(obj: unknown): CoveredEntry | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, COVERED_ENTRY_KEYS)) return null;

  const factId = ownDataProp(obj, "fact_id");
  const coveredBy = ownDataProp(obj, "covered_by");
  if (factId.kind !== "data" || coveredBy.kind !== "data") return null;
  if (!isNonEmptyStr(factId.value)) return null;

  // A1.8 — coverage is HASH-BOUND. Delegated to S2's validator rather than
  // re-implemented: a second implementation of the same contract is exactly the
  // duplication cap-loc-D05 exists to prevent. `capability` declares `dispatch`
  // in its manifest depends_on, so this edge is a declared dependency.
  const ref = validateProjectDefinitionRefV1(coveredBy.value);
  if (ref === null) return null;

  return { fact_id: factId.value, covered_by: ref };
}

const COVERAGE_KEYS = ["covered", "uncovered", "unmatched_roles"] as const;

function validateCoverageInner(obj: unknown): CoverageVerdict | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, COVERAGE_KEYS)) return null;

  const coveredProp = ownDataProp(obj, "covered");
  const uncoveredProp = ownDataProp(obj, "uncovered");
  const unmatchedProp = ownDataProp(obj, "unmatched_roles");
  if (coveredProp.kind !== "data") return null;
  if (uncoveredProp.kind !== "data" || unmatchedProp.kind !== "data") return null;

  const rawCovered = readDataArray(coveredProp.value);
  if (rawCovered === null) return null;
  const covered: CoveredEntry[] = [];
  const seenFacts = new Set<string>();
  for (const entry of rawCovered) {
    const parsed = validateCoveredEntryInner(entry);
    if (parsed === null) return null;
    // One covering definition per fact: two entries for the same fact are
    // ambiguous about what actually covers it.
    if (seenFacts.has(parsed.fact_id)) return null;
    seenFacts.add(parsed.fact_id);
    covered.push(parsed);
  }

  const uncovered = readStrArray(uncoveredProp.value, { unique: true });
  if (uncovered === null) return null;
  const unmatchedRoles = readStrArray(unmatchedProp.value, { unique: true });
  if (unmatchedRoles === null) return null;

  // A fact cannot be both covered and uncovered.
  for (const factId of uncovered) if (seenFacts.has(factId)) return null;

  return { covered, uncovered, unmatched_roles: unmatchedRoles };
}

const CANDIDATE_KEYS = [
  "id",
  "kind",
  "proposed_id",
  "justified_by",
  "action",
  "defer_reason",
  "confidence",
  "owning_layer",
] as const;

function validateCandidateInner(obj: unknown): CapabilityCandidate | null {
  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, CANDIDATE_KEYS)) return null;

  const id = ownDataProp(obj, "id");
  const kind = ownDataProp(obj, "kind");
  const proposedId = ownDataProp(obj, "proposed_id");
  const justifiedBy = ownDataProp(obj, "justified_by");
  const action = ownDataProp(obj, "action");
  const deferReason = ownDataProp(obj, "defer_reason");
  const conf = ownDataProp(obj, "confidence");
  const owningLayer = ownDataProp(obj, "owning_layer");
  if (id.kind !== "data" || kind.kind !== "data" || proposedId.kind !== "data") return null;
  if (justifiedBy.kind !== "data" || action.kind !== "data") return null;
  if (deferReason.kind !== "data" || conf.kind !== "data" || owningLayer.kind !== "data") {
    return null;
  }

  if (!isNonEmptyStr(id.value) || !isNonEmptyStr(proposedId.value)) return null;
  if (!isNonEmptyStr(owningLayer.value)) return null;
  if (typeof kind.value !== "string" || !CANDIDATE_KIND_SET.has(kind.value)) return null;
  if (typeof action.value !== "string" || !CANDIDATE_ACTION_SET.has(action.value)) return null;
  if (typeof conf.value !== "string" || !CONFIDENCE_SET.has(conf.value)) return null;

  const actionValue = action.value as CandidateAction;
  const confidence = conf.value as Confidence;

  // A1.2 — no evidence, no candidate. This is the "no invented professions" guard
  // as code rather than prose. `justified_by` cites fact ids, not evidence refs,
  // so it is a plain non-empty unique string array.
  const justified = readStrArray(justifiedBy.value, { unique: true });
  if (justified === null || justified.length === 0) return null;

  // A1.3 — a low-confidence finding may be surfaced, but it may NOT be proposed.
  // This is the sparse/uncertain-project conformance row made mechanical.
  if (confidence === "low" && actionValue === "propose") return null;

  // A non-proposal must say WHY it is not a proposal, and a proposal must not
  // carry a defer reason (which would be a contradiction a reader has to resolve).
  if (actionValue === "propose") {
    if (deferReason.value !== null) return null;
  } else {
    if (!isNonEmptyStr(deferReason.value)) return null;
  }

  return {
    id: id.value,
    kind: kind.value as CandidateKind,
    proposed_id: proposedId.value,
    justified_by: justified,
    action: actionValue,
    defer_reason: (actionValue === "propose" ? null : deferReason.value) as string | null,
    confidence,
    owning_layer: owningLayer.value,
  };
}

// ── Top-level validator ──────────────────────────────────────────────────────

const PROFILE_KEYS = [
  "schema_version",
  "project_id",
  "run_id",
  "generated_at",
  "source_commit",
  "feedstock",
  "domains",
  "boundaries",
  "repeated_methods",
  "coverage",
  "candidates",
  "resolver_mode",
  "mutation_performed",
  "mutation_evidence",
] as const;

export interface ValidateProfileOptions {
  /**
   * Resolved `capability.suggestion_budget`. Defaults to D04's value of 4.
   * A profile exceeding it is INVALID, never truncated (A1.1).
   */
  suggestionBudget?: number;
}

const PROFILE_OPTS_KEYS = ["suggestionBudget"] as const;

/**
 * Resolve the budget from `opts` WITHOUT ever running caller code.
 *
 * CODEX-REVIEW FIX (adversarial round 1). The previous implementation read
 * `opts.suggestionBudget` with plain property access, AFTER the profile's
 * closed-key check had already passed. That was a genuine bypass, not a
 * theoretical one — reproduced as:
 *
 *   const opts = Object.defineProperty({}, "suggestionBudget", {
 *     get() { profile.extra = "smuggled-after-key-check"; return 4; },
 *   });
 *   validateProjectCapabilityProfileV1(profile, opts);
 *   // => getter fired; profile gained an unknown key AFTER hasExactKeys ran;
 *   //    the profile was ACCEPTED; the extra key was silently dropped.
 *
 * That single read violated four of this contract's rules at once: a getter
 * fired, the closed key set was bypassed, a time-of-check/time-of-use gap
 * opened, and the result was silently repaired rather than rejected. A Proxy
 * passed as `opts` does the same through its `get` trap.
 *
 * `opts` is caller-supplied input and gets exactly the same treatment as the
 * artifact: own-DATA descriptor reads, Proxy rejection, prototype check, closed
 * key set, no symbols. Returns the resolved budget, or `null` to mean "reject" —
 * which is distinguishable from a valid budget because a valid budget is always
 * a non-negative integer.
 */
function resolveSuggestionBudget(opts: unknown): number | null {
  if (opts === undefined) return DEFAULT_SUGGESTION_BUDGET;
  if (!isPlainDataObject(opts)) return null;
  // Symbols are checked explicitly: `getOwnPropertyNames` does not see them, so
  // without this a symbol-keyed option rides along invisibly. `hasExactKeys`
  // makes the same check for the artifact; `opts` gets no weaker treatment.
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  if (Object.getOwnPropertyNames(opts).some((k) => !PROFILE_OPTS_KEYS.includes(k as never))) {
    return null; // unknown option key — closed set, same as the artifact
  }

  const prop = ownDataProp(opts, "suggestionBudget");
  if (prop.kind === "accessor") return null; // a getter is never fired, here either
  if (prop.kind === "absent") return DEFAULT_SUGGESTION_BUDGET;
  if (prop.value === undefined) return DEFAULT_SUGGESTION_BUDGET;
  if (typeof prop.value !== "number") return null;
  if (!Number.isInteger(prop.value) || prop.value < 0) return null;
  return prop.value;
}

function validateProjectCapabilityProfileV1Inner(
  obj: unknown,
  opts: unknown
): ProjectCapabilityProfileV1 | null {
  // `opts` is resolved FIRST, before anything about `obj` is inspected. Order is
  // load-bearing: resolving it later is what let a getter mutate the artifact
  // after its closed-key check had passed (codex round 1). Nothing caller-supplied
  // may execute between a check on `obj` and the read it guards.
  const budget = resolveSuggestionBudget(opts);
  if (budget === null) return null; // malformed/hostile opts fails closed

  if (!isPlainDataObject(obj)) return null;
  if (!hasExactKeys(obj, PROFILE_KEYS)) return null;

  const schema = ownDataProp(obj, "schema_version");
  if (schema.kind !== "data" || schema.value !== PROJECT_CAPABILITY_PROFILE_SCHEMA) return null;

  const projectId = ownDataProp(obj, "project_id");
  const runId = ownDataProp(obj, "run_id");
  const generatedAt = ownDataProp(obj, "generated_at");
  const sourceCommit = ownDataProp(obj, "source_commit");
  const feedstockProp = ownDataProp(obj, "feedstock");
  const domainsProp = ownDataProp(obj, "domains");
  const boundariesProp = ownDataProp(obj, "boundaries");
  const methodsProp = ownDataProp(obj, "repeated_methods");
  const coverageProp = ownDataProp(obj, "coverage");
  const candidatesProp = ownDataProp(obj, "candidates");
  const resolverModeProp = ownDataProp(obj, "resolver_mode");
  const mutationPerformedProp = ownDataProp(obj, "mutation_performed");
  const mutationEvidenceProp = ownDataProp(obj, "mutation_evidence");

  if (projectId.kind !== "data" || runId.kind !== "data") return null;
  if (generatedAt.kind !== "data" || sourceCommit.kind !== "data") return null;
  if (feedstockProp.kind !== "data" || domainsProp.kind !== "data") return null;
  if (boundariesProp.kind !== "data" || methodsProp.kind !== "data") return null;
  if (coverageProp.kind !== "data" || candidatesProp.kind !== "data") return null;
  if (resolverModeProp.kind !== "data") return null;
  if (mutationPerformedProp.kind !== "data" || mutationEvidenceProp.kind !== "data") return null;

  if (!isNonEmptyStr(projectId.value)) return null;
  if (!isNonEmptyStr(runId.value)) return null;
  if (!isNonEmptyStr(generatedAt.value)) return null;
  if (sourceCommit.value !== null && !isNonEmptyStr(sourceCommit.value)) return null;

  if (
    typeof resolverModeProp.value !== "string" ||
    !RESOLVER_MODE_SET.has(resolverModeProp.value)
  ) {
    return null;
  }

  // A1.5 — the literal `false`, checked with `!==` so `0`, `""`, `null`, and
  // `undefined` are all rejected rather than coerced. Anything but `false` means
  // the artifact is corrupt, NOT that a mutation happened: the type has no way to
  // report a mutation, so there is no such reading available.
  if (mutationPerformedProp.value !== false) return null;

  const feedstock = validateFeedstockInner(feedstockProp.value);
  if (feedstock === null) return null;

  // A1.6 — the paired runtime proof. Rejects any differing before/after pair.
  const mutationEvidence = validateMutationEvidenceInner(mutationEvidenceProp.value);
  if (mutationEvidence === null) return null;

  const rawDomains = readDataArray(domainsProp.value);
  if (rawDomains === null) return null;
  const domains: DomainFact[] = [];
  const domainIds = new Set<string>();
  for (const entry of rawDomains) {
    const parsed = validateDomainFactInner(entry);
    if (parsed === null) return null;
    if (domainIds.has(parsed.id)) return null;
    domainIds.add(parsed.id);
    domains.push(parsed);
  }

  const rawBoundaries = readDataArray(boundariesProp.value);
  if (rawBoundaries === null) return null;
  const boundaries: BoundaryFact[] = [];
  const boundaryIds = new Set<string>();
  for (const entry of rawBoundaries) {
    const parsed = validateBoundaryFactInner(entry);
    if (parsed === null) return null;
    if (boundaryIds.has(parsed.id)) return null;
    boundaryIds.add(parsed.id);
    boundaries.push(parsed);
  }

  const rawMethods = readDataArray(methodsProp.value);
  if (rawMethods === null) return null;
  const repeatedMethods: MethodFact[] = [];
  const methodIds = new Set<string>();
  for (const entry of rawMethods) {
    const parsed = validateMethodFactInner(entry);
    if (parsed === null) return null;
    if (methodIds.has(parsed.id)) return null;
    methodIds.add(parsed.id);
    repeatedMethods.push(parsed);
  }

  const coverage = validateCoverageInner(coverageProp.value);
  if (coverage === null) return null;

  const rawCandidates = readDataArray(candidatesProp.value);
  if (rawCandidates === null) return null;

  // A1.1 — the budget ceiling. Checked BEFORE per-entry validation so an
  // over-budget profile fails as over-budget rather than on whatever its fifth
  // entry happens to get wrong.
  if (rawCandidates.length > budget) return null;

  const candidates: CapabilityCandidate[] = [];
  const candidateIds = new Set<string>();
  for (const entry of rawCandidates) {
    const parsed = validateCandidateInner(entry);
    if (parsed === null) return null;
    if (candidateIds.has(parsed.id)) return null;
    candidateIds.add(parsed.id);
    candidates.push(parsed);
  }

  // Every `justified_by` entry must name a fact that exists in THIS profile.
  // A candidate justified by a fact id nobody declared is a dangling citation —
  // the in-artifact half of A1.10, and the half that is checkable without I/O.
  const knownFactIds = new Set<string>([...domainIds, ...boundaryIds, ...methodIds]);
  for (const candidate of candidates) {
    for (const factId of candidate.justified_by) {
      if (!knownFactIds.has(factId)) return null;
    }
  }

  // Coverage must likewise reference declared facts.
  for (const entry of coverage.covered) {
    if (!knownFactIds.has(entry.fact_id)) return null;
  }
  for (const factId of coverage.uncovered) {
    if (!knownFactIds.has(factId)) return null;
  }

  return {
    schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
    project_id: projectId.value,
    run_id: runId.value,
    generated_at: generatedAt.value,
    source_commit: sourceCommit.value as string | null,
    feedstock,
    domains,
    boundaries,
    repeated_methods: repeatedMethods,
    coverage,
    candidates,
    resolver_mode: resolverModeProp.value as ResolverMode,
    mutation_performed: false,
    mutation_evidence: mutationEvidence,
  };
}

/**
 * Fail-closed validation of a `guild.project_capability_profile.v1`. Returns a
 * FRESH, sanitized profile or NULL — never throws, never repairs.
 *
 * Rejects: a non-plain object / wrong `schema_version`; any unknown or missing
 * top-level key (the shape is CLOSED) or any symbol key; an accessor field;
 * `mutation_performed` that is not the literal `false` (A1.5); any differing
 * before/after tree-hash pair (A1.6); more candidates than the budget (A1.1); a
 * candidate with empty `justified_by` (A1.2); a low-confidence `propose` (A1.3);
 * a `MethodFact` whose ref count disagrees with `occurrence_count` (A1.4) or
 * whose refs cite anything but `run`/`reflection` (A1.11); a `covered_by` that is
 * not a valid `ProjectDefinitionRefV1` (A1.8); a malformed evidence ref; and any
 * citation of a fact id this profile does not declare.
 */
export function validateProjectCapabilityProfileV1(
  obj: unknown,
  opts: ValidateProfileOptions = {}
): ProjectCapabilityProfileV1 | null {
  try {
    return validateProjectCapabilityProfileV1Inner(obj, opts);
  } catch {
    return null; // NEVER throw: any exotic input maps to null.
  }
}

/**
 * Boolean shape check. Returns whether `value` COULD be validated — it does NOT
 * narrow, deliberately.
 *
 * Same reasoning as `isProjectDefinitionRefV1`: the validator produces a FRESH
 * sanitized copy, so a type predicate would narrow the CALLER'S ORIGINAL
 * unsanitized object and reopen the time-of-check/time-of-use gap the single-pass
 * sanitizers exist to close.
 *
 * USE `validateProjectCapabilityProfileV1` AND CARRY ITS RETURN VALUE.
 */
export function isProjectCapabilityProfileV1(
  value: unknown,
  opts: ValidateProfileOptions = {}
): boolean {
  return validateProjectCapabilityProfileV1(value, opts) !== null;
}
