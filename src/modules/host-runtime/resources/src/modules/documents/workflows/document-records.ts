/**
 * src/modules/documents/workflows/document-records.ts
 *
 * DC-01 canonical records + DC-02 validation.
 *
 * `validateDocumentRecord` is the single trust boundary of this module. It is
 * total over any input (BF-02) and it does not merely *inspect* the input — it
 * NORMALIZES it, returning a freshly built, deep-frozen record composed only
 * of validated primitives.
 *
 * That normalization is what makes "valid but crashes later" structurally
 * impossible: hashing, projection and rendering all consume the normalized
 * record, so a hostile getter, proxy or `toJSON` on the caller's object can
 * never be reached by a downstream step.
 *
 * Validation is closed and non-coercing: unknown record kinds, unknown keys,
 * out-of-vocabulary enum values and mistyped fields are errors, never silently
 * repaired.
 */

import {
  DocumentIssue,
  MAX_ARRAY_ITEMS,
  MAX_STRING_LENGTH,
  deepFreeze,
  isObjectLike,
  pushIssue,
  safeArrayLength,
  safeGet,
  safeHasOwn,
  safeIsArray,
  safeOwnKeys,
  sortIssues,
} from "./document-safe";

// ── Frozen vocabularies ──────────────────────────────────────────────────────

export const DOCUMENT_SCHEMA_VERSION = "guild.document.v1" as const;

export const DOCUMENT_KINDS = Object.freeze([
  "plan",
  "spec",
  "handoff",
  "review",
  "verify",
] as const);
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_PROVENANCE_SOURCES = Object.freeze([
  "authored",
  "imported",
  "migrated",
] as const);
export type DocumentProvenanceSource = (typeof DOCUMENT_PROVENANCE_SOURCES)[number];

export const PLAN_STEP_STATUSES = Object.freeze([
  "pending",
  "active",
  "done",
  "blocked",
] as const);
export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export const SPEC_REQUIREMENT_PRIORITIES = Object.freeze(["must", "should", "may"] as const);
export type SpecRequirementPriority = (typeof SPEC_REQUIREMENT_PRIORITIES)[number];

export const HANDOFF_STATUSES = Object.freeze([
  "completed",
  "partial",
  "blocked",
  "failed",
] as const);
export type HandoffStatus = (typeof HANDOFF_STATUSES)[number];

export const REVIEW_VERDICTS = Object.freeze(["approved", "issues", "rejected"] as const);
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const REVIEW_SEVERITIES = Object.freeze([
  "blocking",
  "major",
  "minor",
  "note",
] as const);
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const VERIFY_OUTCOMES = Object.freeze(["pass", "fail", "inconclusive"] as const);
export type VerifyOutcome = (typeof VERIFY_OUTCOMES)[number];

export const VERIFY_CHECK_RESULTS = Object.freeze(["pass", "fail", "skip"] as const);
export type VerifyCheckResult = (typeof VERIFY_CHECK_RESULTS)[number];

/** Stable document / item identifier shape. */
export const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
/** Item ids inside a body are shorter-lived but still stable and slug-like. */
export const DOCUMENT_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Strict RFC3339 UTC with milliseconds — no local offsets, no coercion. */
export const DOCUMENT_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const TOP_LEVEL_KEYS = Object.freeze([
  "schema_version",
  "kind",
  "id",
  "title",
  "provenance",
  "body",
]);

const PROVENANCE_KEYS = Object.freeze([
  "author_id",
  "author_family",
  "host_id",
  "created_at",
  "source",
]);

// ── Record types ─────────────────────────────────────────────────────────────

export interface DocumentProvenance {
  author_id: string;
  author_family: string;
  host_id: string;
  created_at: string;
  source: DocumentProvenanceSource;
}

export interface PlanStep {
  id: string;
  title: string;
  status: PlanStepStatus;
}
export interface PlanBody {
  objectives: string[];
  steps: PlanStep[];
}

export interface SpecRequirement {
  id: string;
  statement: string;
  priority: SpecRequirementPriority;
}
export interface SpecBody {
  requirements: SpecRequirement[];
}

export interface HandoffBody {
  task_id: string;
  status: HandoffStatus;
  artifacts: string[];
  issues: string[];
}

export interface ReviewFinding {
  id: string;
  severity: ReviewSeverity;
  statement: string;
}
export interface ReviewBody {
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
}

export interface VerifyCheck {
  id: string;
  name: string;
  result: VerifyCheckResult;
}
export interface VerifyBody {
  outcome: VerifyOutcome;
  checks: VerifyCheck[];
}

interface DocumentRecordBase {
  schema_version: typeof DOCUMENT_SCHEMA_VERSION;
  id: string;
  title: string;
  provenance: DocumentProvenance;
}

export interface PlanDocumentRecord extends DocumentRecordBase {
  kind: "plan";
  body: PlanBody;
}
export interface SpecDocumentRecord extends DocumentRecordBase {
  kind: "spec";
  body: SpecBody;
}
export interface HandoffDocumentRecord extends DocumentRecordBase {
  kind: "handoff";
  body: HandoffBody;
}
export interface ReviewDocumentRecord extends DocumentRecordBase {
  kind: "review";
  body: ReviewBody;
}
export interface VerifyDocumentRecord extends DocumentRecordBase {
  kind: "verify";
  body: VerifyBody;
}

export type DocumentRecord =
  | PlanDocumentRecord
  | SpecDocumentRecord
  | HandoffDocumentRecord
  | ReviewDocumentRecord
  | VerifyDocumentRecord;

export interface DocumentValidationResult {
  valid: boolean;
  errors: DocumentIssue[];
  record: DocumentRecord | null;
}

// ── Field readers (all total) ────────────────────────────────────────────────

interface StringOptions {
  enumOf?: readonly string[];
  pattern?: RegExp;
  maxLength?: number;
  allowEmpty?: boolean;
}

/**
 * Verify a value is an object with exactly the allowed own keys. Returns false
 * on any hostile or structurally wrong input, having recorded the reason.
 */
function readShape(
  issues: DocumentIssue[],
  value: unknown,
  path: string,
  allowed: readonly string[]
): boolean {
  if (value === null || typeof value !== "object") {
    pushIssue(issues, path, "not_an_object", `${path} must be an object`);
    return false;
  }
  if (safeIsArray(value)) {
    pushIssue(issues, path, "not_an_object", `${path} must be an object, not an array`);
    return false;
  }
  const keys = safeOwnKeys(value);
  if (keys.ok === false) {
    pushIssue(issues, path, "own_keys_threw", `${path}: ${keys.reason}`);
    return false;
  }
  const allowedSet = new Set(allowed);
  let ok = true;
  for (const key of [...keys.keys].sort()) {
    if (!allowedSet.has(key)) {
      pushIssue(issues, `${path}.${key}`, "unexpected_key", `${path}.${key} is not part of the closed schema`);
      ok = false;
    }
  }
  for (const key of allowed) {
    if (!safeHasOwn(value, key)) {
      pushIssue(issues, `${path}.${key}`, "missing_field", `${path}.${key} is required`);
      ok = false;
    }
  }
  return ok;
}

function readString(
  issues: DocumentIssue[],
  parent: unknown,
  path: string,
  key: string,
  options: StringOptions = {}
): string | null {
  const fieldPath = `${path}.${key}`;
  const read = safeGet(parent, key);
  if (read.ok === false) {
    pushIssue(issues, fieldPath, "property_read_threw", `${fieldPath}: property read threw`);
    return null;
  }
  const value = read.value;
  if (typeof value !== "string") {
    pushIssue(issues, fieldPath, "not_a_string", `${fieldPath} must be a string`);
    return null;
  }
  if (!options.allowEmpty && value.length === 0) {
    pushIssue(issues, fieldPath, "empty_string", `${fieldPath} must not be empty`);
    return null;
  }
  const maxLength = options.maxLength ?? MAX_STRING_LENGTH;
  if (value.length > maxLength) {
    pushIssue(issues, fieldPath, "string_too_long", `${fieldPath} exceeds ${maxLength} characters`);
    return null;
  }
  if (options.enumOf !== undefined && !options.enumOf.includes(value)) {
    pushIssue(
      issues,
      fieldPath,
      "value_not_in_vocabulary",
      `${fieldPath} must be one of ${options.enumOf.join("|")}`
    );
    return null;
  }
  if (options.pattern !== undefined && !options.pattern.test(value)) {
    pushIssue(issues, fieldPath, "pattern_mismatch", `${fieldPath} does not match ${String(options.pattern)}`);
    return null;
  }
  return value;
}

/**
 * Read an array by index, rejecting holes explicitly. `forEach`/`map` are
 * never used here: they skip sparse holes, which is exactly how a sparse
 * record previously passed validation and then crashed hashing (BF-02).
 */
function readArray(
  issues: DocumentIssue[],
  parent: unknown,
  path: string,
  key: string,
  options: { min?: number; max?: number } = {}
): unknown[] | null {
  const fieldPath = `${path}.${key}`;
  const read = safeGet(parent, key);
  if (read.ok === false) {
    pushIssue(issues, fieldPath, "property_read_threw", `${fieldPath}: property read threw`);
    return null;
  }
  if (!safeIsArray(read.value)) {
    pushIssue(issues, fieldPath, "not_an_array", `${fieldPath} must be an array`);
    return null;
  }
  const length = safeArrayLength(read.value);
  if (length.ok === false) {
    pushIssue(issues, fieldPath, "array_length_unreadable", `${fieldPath}: ${length.reason}`);
    return null;
  }
  const max = options.max ?? MAX_ARRAY_ITEMS;
  if (length.length > max) {
    pushIssue(issues, fieldPath, "array_too_long", `${fieldPath} exceeds ${max} items`);
    return null;
  }
  if (options.min !== undefined && length.length < options.min) {
    pushIssue(issues, fieldPath, "array_too_short", `${fieldPath} requires at least ${options.min} items`);
    return null;
  }
  const items: unknown[] = [];
  let ok = true;
  for (let index = 0; index < length.length; index += 1) {
    const indexKey = String(index);
    if (!safeHasOwn(read.value, indexKey)) {
      pushIssue(issues, `${fieldPath}[${index}]`, "sparse_array_hole", `${fieldPath}[${index}] is an array hole`);
      ok = false;
      continue;
    }
    const item = safeGet(read.value, indexKey);
    if (item.ok === false) {
      pushIssue(issues, `${fieldPath}[${index}]`, "property_read_threw", `${fieldPath}[${index}]: property read threw`);
      ok = false;
      continue;
    }
    items.push(item.value);
  }
  return ok ? items : null;
}

function readStringArray(
  issues: DocumentIssue[],
  parent: unknown,
  path: string,
  key: string,
  options: { min?: number; max?: number; itemMaxLength?: number } = {}
): string[] | null {
  const items = readArray(issues, parent, path, key, options);
  if (items === null) return null;
  const fieldPath = `${path}.${key}`;
  const out: string[] = [];
  let ok = true;
  for (let index = 0; index < items.length; index += 1) {
    const value = items[index];
    const itemPath = `${fieldPath}[${index}]`;
    if (typeof value !== "string") {
      pushIssue(issues, itemPath, "not_a_string", `${itemPath} must be a string`);
      ok = false;
      continue;
    }
    if (value.length === 0) {
      pushIssue(issues, itemPath, "empty_string", `${itemPath} must not be empty`);
      ok = false;
      continue;
    }
    const itemMax = options.itemMaxLength ?? MAX_STRING_LENGTH;
    if (value.length > itemMax) {
      pushIssue(issues, itemPath, "string_too_long", `${itemPath} exceeds ${itemMax} characters`);
      ok = false;
      continue;
    }
    out.push(value);
  }
  return ok ? out : null;
}

/**
 * Read an array of identified items.
 *
 * Item ids are the nested identity of a record: evidence references and
 * projection signals point at them. Two items sharing an id would collapse
 * into one referent, so a duplicate is a validation failure, not a preference
 * for the first or last writer (BF-02). Comparison is exact — item ids are
 * ASCII-restricted by `DOCUMENT_ITEM_ID_PATTERN`, so `C1` and `c1` are two
 * distinct identities rather than a confusable pair.
 */
function readItemArray<T extends { id: string }>(
  issues: DocumentIssue[],
  parent: unknown,
  path: string,
  key: string,
  options: { min?: number; max?: number },
  readItem: (issues: DocumentIssue[], item: unknown, itemPath: string) => T | null
): T[] | null {
  const items = readArray(issues, parent, path, key, options);
  if (items === null) return null;
  const fieldPath = `${path}.${key}`;
  const out: T[] = [];
  const firstIndexById = new Map<string, number>();
  let ok = true;
  for (let index = 0; index < items.length; index += 1) {
    const itemPath = `${fieldPath}[${index}]`;
    const parsed = readItem(issues, items[index], itemPath);
    if (parsed === null) {
      ok = false;
      continue;
    }
    const firstIndex = firstIndexById.get(parsed.id);
    if (firstIndex !== undefined) {
      pushIssue(
        issues,
        `${itemPath}.id`,
        "duplicate_item_id",
        `${itemPath}.id duplicates ${fieldPath}[${firstIndex}].id (${parsed.id})`
      );
      ok = false;
      continue;
    }
    firstIndexById.set(parsed.id, index);
    out.push(parsed);
  }
  return ok ? out : null;
}

// ── Provenance ───────────────────────────────────────────────────────────────

function readProvenance(
  issues: DocumentIssue[],
  parent: unknown,
  path: string
): DocumentProvenance | null {
  const read = safeGet(parent, "provenance");
  if (read.ok === false) {
    pushIssue(issues, `${path}.provenance`, "property_read_threw", `${path}.provenance: property read threw`);
    return null;
  }
  const provenancePath = `${path}.provenance`;
  if (!readShape(issues, read.value, provenancePath, PROVENANCE_KEYS)) return null;

  const source = read.value;
  const authorId = readString(issues, source, provenancePath, "author_id", {
    pattern: DOCUMENT_ID_PATTERN,
  });
  const authorFamily = readString(issues, source, provenancePath, "author_family", {
    pattern: DOCUMENT_ID_PATTERN,
  });
  const hostId = readString(issues, source, provenancePath, "host_id", {
    pattern: DOCUMENT_ID_PATTERN,
  });
  const createdAt = readString(issues, source, provenancePath, "created_at", {
    pattern: DOCUMENT_TIMESTAMP_PATTERN,
  });
  const provenanceSource = readString(issues, source, provenancePath, "source", {
    enumOf: DOCUMENT_PROVENANCE_SOURCES,
  });

  // A syntactically well-formed stamp must also be a real instant that
  // round-trips — "2026-02-30T00:00:00.000Z" is rejected, not coerced.
  if (createdAt !== null) {
    const parsed = Date.parse(createdAt);
    if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== createdAt) {
      pushIssue(
        issues,
        `${provenancePath}.created_at`,
        "not_a_real_instant",
        `${provenancePath}.created_at is not a real UTC instant`
      );
      return null;
    }
  }

  if (
    authorId === null ||
    authorFamily === null ||
    hostId === null ||
    createdAt === null ||
    provenanceSource === null
  ) {
    return null;
  }

  return {
    author_id: authorId,
    author_family: authorFamily,
    host_id: hostId,
    created_at: createdAt,
    source: provenanceSource as DocumentProvenanceSource,
  };
}

// ── Body readers ─────────────────────────────────────────────────────────────

function readPlanBody(issues: DocumentIssue[], body: unknown, path: string): PlanBody | null {
  if (!readShape(issues, body, path, ["objectives", "steps"])) return null;
  const objectives = readStringArray(issues, body, path, "objectives", { min: 1, max: 64, itemMaxLength: 500 });
  const steps = readItemArray(issues, body, path, "steps", { min: 1, max: 256 }, (itemIssues, item, itemPath) => {
    if (!readShape(itemIssues, item, itemPath, ["id", "title", "status"])) return null;
    const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
    const title = readString(itemIssues, item, itemPath, "title", { maxLength: 500 });
    const status = readString(itemIssues, item, itemPath, "status", { enumOf: PLAN_STEP_STATUSES });
    if (id === null || title === null || status === null) return null;
    return { id, title, status: status as PlanStepStatus };
  });
  if (objectives === null || steps === null) return null;
  return { objectives, steps };
}

function readSpecBody(issues: DocumentIssue[], body: unknown, path: string): SpecBody | null {
  if (!readShape(issues, body, path, ["requirements"])) return null;
  const requirements = readItemArray(
    issues,
    body,
    path,
    "requirements",
    { min: 1, max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "statement", "priority"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const statement = readString(itemIssues, item, itemPath, "statement", { maxLength: 2000 });
      const priority = readString(itemIssues, item, itemPath, "priority", {
        enumOf: SPEC_REQUIREMENT_PRIORITIES,
      });
      if (id === null || statement === null || priority === null) return null;
      return { id, statement, priority: priority as SpecRequirementPriority };
    }
  );
  if (requirements === null) return null;
  return { requirements };
}

function readHandoffBody(issues: DocumentIssue[], body: unknown, path: string): HandoffBody | null {
  if (!readShape(issues, body, path, ["task_id", "status", "artifacts", "issues"])) return null;
  const taskId = readString(issues, body, path, "task_id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
  const status = readString(issues, body, path, "status", { enumOf: HANDOFF_STATUSES });
  const artifacts = readStringArray(issues, body, path, "artifacts", { max: 256, itemMaxLength: 1000 });
  const handoffIssues = readStringArray(issues, body, path, "issues", { max: 256, itemMaxLength: 1000 });
  if (taskId === null || status === null || artifacts === null || handoffIssues === null) return null;
  return { task_id: taskId, status: status as HandoffStatus, artifacts, issues: handoffIssues };
}

function readReviewBody(issues: DocumentIssue[], body: unknown, path: string): ReviewBody | null {
  if (!readShape(issues, body, path, ["verdict", "findings"])) return null;
  const verdict = readString(issues, body, path, "verdict", { enumOf: REVIEW_VERDICTS });
  const findings = readItemArray(
    issues,
    body,
    path,
    "findings",
    { max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "severity", "statement"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const severity = readString(itemIssues, item, itemPath, "severity", { enumOf: REVIEW_SEVERITIES });
      const statement = readString(itemIssues, item, itemPath, "statement", { maxLength: 2000 });
      if (id === null || severity === null || statement === null) return null;
      return { id, severity: severity as ReviewSeverity, statement };
    }
  );
  if (verdict === null || findings === null) return null;
  return { verdict: verdict as ReviewVerdict, findings };
}

function readVerifyBody(issues: DocumentIssue[], body: unknown, path: string): VerifyBody | null {
  if (!readShape(issues, body, path, ["outcome", "checks"])) return null;
  const outcome = readString(issues, body, path, "outcome", { enumOf: VERIFY_OUTCOMES });
  const checks = readItemArray(
    issues,
    body,
    path,
    "checks",
    { min: 1, max: 256 },
    (itemIssues, item, itemPath) => {
      if (!readShape(itemIssues, item, itemPath, ["id", "name", "result"])) return null;
      const id = readString(itemIssues, item, itemPath, "id", { pattern: DOCUMENT_ITEM_ID_PATTERN });
      const name = readString(itemIssues, item, itemPath, "name", { maxLength: 500 });
      const result = readString(itemIssues, item, itemPath, "result", { enumOf: VERIFY_CHECK_RESULTS });
      if (id === null || name === null || result === null) return null;
      return { id, name, result: result as VerifyCheckResult };
    }
  );
  if (outcome === null || checks === null) return null;
  return { outcome: outcome as VerifyOutcome, checks };
}

// ── The trust boundary ───────────────────────────────────────────────────────

function failure(errors: DocumentIssue[]): DocumentValidationResult {
  return { valid: false, errors: sortIssues(errors), record: null };
}

/**
 * Validate and normalize an untrusted value into a canonical document record.
 *
 * Total: never throws for any input. On success the returned `record` is a
 * fresh deep-frozen plain object — the caller's original value is never
 * retained, so no hostile accessor survives into the rest of the pipeline.
 */
export function validateDocumentRecord(input: unknown): DocumentValidationResult {
  const errors: DocumentIssue[] = [];
  try {
    if (!isObjectLike(input)) {
      pushIssue(errors, "$", "not_an_object", "document record must be an object");
      return failure(errors);
    }
    if (!readShape(errors, input, "$", TOP_LEVEL_KEYS)) return failure(errors);

    const schemaVersion = readString(errors, input, "$", "schema_version", {
      enumOf: [DOCUMENT_SCHEMA_VERSION],
    });
    const kind = readString(errors, input, "$", "kind", { enumOf: DOCUMENT_KINDS });
    const id = readString(errors, input, "$", "id", { pattern: DOCUMENT_ID_PATTERN });
    const title = readString(errors, input, "$", "title", { maxLength: 500 });
    const provenance = readProvenance(errors, input, "$");

    const bodyRead = safeGet(input, "body");
    if (bodyRead.ok === false) {
      pushIssue(errors, "$.body", "property_read_threw", "$.body: property read threw");
      return failure(errors);
    }

    if (schemaVersion === null || kind === null || id === null || title === null || provenance === null) {
      return failure(errors);
    }

    const base = { schema_version: DOCUMENT_SCHEMA_VERSION, id, title, provenance } as const;
    let record: DocumentRecord | null = null;

    if (kind === "plan") {
      const body = readPlanBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "plan", body };
    } else if (kind === "spec") {
      const body = readSpecBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "spec", body };
    } else if (kind === "handoff") {
      const body = readHandoffBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "handoff", body };
    } else if (kind === "review") {
      const body = readReviewBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "review", body };
    } else if (kind === "verify") {
      const body = readVerifyBody(errors, bodyRead.value, "$.body");
      if (body !== null) record = { ...base, kind: "verify", body };
    }

    if (record === null || errors.length > 0) return failure(errors);
    return { valid: true, errors: [], record: deepFreeze(record) };
  } catch {
    // Unreachable by construction; kept so no caller can ever see a throw.
    pushIssue(errors, "$", "internal_guard", "validation was interrupted");
    return failure(errors);
  }
}

/** Convenience type guard built on the same total validator. */
export function isDocumentRecord(value: unknown): value is DocumentRecord {
  return validateDocumentRecord(value).valid;
}
