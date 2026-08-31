/**
 * src/modules/documents/workflows/document-receipts.ts
 *
 * Typed adoption bridge: a handoff receipt document → a canonical handoff
 * record → a `DocumentDecision`.
 *
 * This is the path shipped lifecycle consumers use instead of inferring
 * meaning from a receipt's filename or prose (DC-07). Only two structured
 * regions of a receipt are ever read:
 *
 *   1. the `guild.handoff_receipt.v1` YAML frontmatter, for provenance;
 *   2. exactly one fenced `guild.handoff.v2` JSON block, for the payload.
 *
 * Everything else in the file is narrative and is never consulted. If either
 * region is missing, duplicated, malformed, or lacks required provenance, the
 * result is `unparsable` with deterministic errors — which downstream becomes
 * a `refuse` decision. A receipt is trusted because it carries verifiable
 * structure, not because a file with the right name exists.
 *
 * Both regions must declare the contract they are written to, and the two
 * declarations are separate (BF-03). The frontmatter is the envelope that
 * supplies provenance, so it must declare `guild.handoff_receipt.v1`; a
 * document announcing some other envelope schema is explicitly not written to
 * this contract, and reading its provenance anyway would let it borrow this
 * contract's authority. A correct machine block does not vouch for a foreign
 * envelope, and a correct envelope does not vouch for a foreign machine block.
 *
 * Provenance is required and never invented: `agent`, `model_family` (or
 * `family`), `host`, and `generated_at` must all be present in frontmatter.
 */

import { loadYamlApi } from "../../kernel";
import { DocumentIssue, pushIssue, safeGet, sortIssues } from "./document-safe";
import {
  DOCUMENT_ID_PATTERN,
  DOCUMENT_SCHEMA_VERSION,
  HandoffDocumentRecord,
  HandoffStatus,
  validateDocumentRecord,
} from "./document-records";
import { DocumentDecision, decideFromDocumentSources } from "./document-decisions";

export const RECEIPT_MACHINE_SCHEMA_VERSION = "guild.handoff.v2" as const;
export const RECEIPT_FRONTMATTER_SCHEMA_VERSION = "guild.handoff_receipt.v1" as const;

export const RECEIPT_PARSE_BOUNDS = Object.freeze({
  max_characters: 524_288,
  max_frontmatter_lines: 200,
  max_json_blocks: 20,
});

const RECEIPT_FRONTMATTER_BLOCK =
  /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Closed synonym table for the receipt status vocabulary. This is declared
 * normalization between two named vocabularies, not optimistic coercion:
 * anything outside the table is an error, never a guess.
 */
const FROZEN_RECEIPT_STATUS_MAP: Readonly<Record<string, HandoffStatus>> = Object.freeze({
  done: "completed",
  blocked: "blocked",
  escalate: "blocked",
});

const LEGACY_RECEIPT_STATUS_MAP: Readonly<Record<string, HandoffStatus>> = Object.freeze({
  complete: "completed",
  completed: "completed",
  done: "completed",
  partial: "partial",
  blocked: "blocked",
  failed: "failed",
});

const RECEIPT_MACHINE_KEYS = new Set([
  "schema_version", "task_id", "tier", "status", "summary", "artifacts", "issues",
  "escalate_reason", "learnings", "notes", "injection_clean",
]);

function validateReceiptMachineBlock(block: Record<string, unknown>, errors: DocumentIssue[]): void {
  for (const key of Object.keys(block)) {
    if (!RECEIPT_MACHINE_KEYS.has(key)) pushIssue(errors, `$.machine_block.${key}`, "unknown_key", `guild.handoff.v2 rejects unknown key ${key}`);
  }
  if (typeof block.task_id !== "string" || block.task_id.trim() === "") pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a non-empty string");
  if (block.tier !== "cheap" && block.tier !== "mid" && block.tier !== "powerful") pushIssue(errors, "$.machine_block.tier", "unknown_value", "tier must be cheap, mid, or powerful");
  if (block.status !== "done" && block.status !== "blocked" && block.status !== "escalate") pushIssue(errors, "$.machine_block.status", "unknown_receipt_status", "status must be done, blocked, or escalate");
  if (typeof block.summary !== "string" || block.summary.trim() === "" || block.summary.length > 600) pushIssue(errors, "$.machine_block.summary", "invalid_summary", "summary must be a non-empty string of at most 600 characters");
  for (const key of ["artifacts", "issues"] as const) {
    if (!Array.isArray(block[key]) || !(block[key] as unknown[]).every((value) => typeof value === "string")) pushIssue(errors, `$.machine_block.${key}`, "wrong_type", `${key} must be an array of strings`);
  }
  if (block.learnings !== undefined && (!Array.isArray(block.learnings) || !block.learnings.every((value) => typeof value === "string"))) pushIssue(errors, "$.machine_block.learnings", "wrong_type", "learnings must be an array of strings when provided");
  if (block.status === "escalate" && (typeof block.escalate_reason !== "string" || block.escalate_reason.trim() === "")) pushIssue(errors, "$.machine_block.escalate_reason", "missing_field", "escalate_reason is required for escalate status");
  if (block.escalate_reason !== undefined && typeof block.escalate_reason !== "string") pushIssue(errors, "$.machine_block.escalate_reason", "wrong_type", "escalate_reason must be a string when provided");
  if (block.notes !== undefined && (typeof block.notes !== "string" || block.notes.length > 200)) pushIssue(errors, "$.machine_block.notes", "wrong_type", "notes must be a string of at most 200 characters");
  if (block.injection_clean !== undefined && !["clean", "flagged", "unverified"].includes(String(block.injection_clean))) pushIssue(errors, "$.machine_block.injection_clean", "unknown_value", "injection_clean must be clean, flagged, or unverified");
}

export interface ReceiptParseResult {
  status: "parsed" | "unparsable";
  record: HandoffDocumentRecord | null;
  errors: DocumentIssue[];
}

// ── Bounded structured readers ───────────────────────────────────────────────

/**
 * Read top-level scalar fields from YAML frontmatter through the shared parser.
 *
 * A repeated key is refused by js-yaml rather than resolved. YAML
 * implementations differ on whether the first or the last wins, and an
 * envelope that reads one way here and another way elsewhere is exactly the
 * ambiguity a trust boundary must not absorb.
 */
export function readReceiptFrontmatter(
  text: string
):
  | { ok: true; fields: Record<string, string>; document: Record<string, unknown> }
  | { ok: false; reason: string } {
  const match = RECEIPT_FRONTMATTER_BLOCK.exec(text);
  if (match === null) {
    return { ok: false, reason: "receipt frontmatter is missing or unterminated" };
  }
  const frontmatter = match[1] ?? "";
  if (frontmatter.split("\n").length + 2 > RECEIPT_PARSE_BOUNDS.max_frontmatter_lines) {
    return { ok: false, reason: "frontmatter exceeds the line bound" };
  }
  let parsed: unknown;
  try {
    const yaml = loadYamlApi();
    parsed = yaml.load(frontmatter, { schema: yaml.JSON_SCHEMA });
  } catch {
    return { ok: false, reason: "frontmatter is not a valid YAML mapping" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "frontmatter is not a valid YAML mapping" };
  }

  // Null-prototype: a frontmatter key is untrusted input, so `__proto__` and
  // friends must land as ordinary own properties and never as inheritance.
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    const scalar = String(value);
    if (scalar !== "") fields[key] = scalar;
  }
  return { ok: true, fields, document: parsed as Record<string, unknown> };
}

/** Extract the single `guild.handoff.v2` JSON block, or explain why not. */
export function readReceiptMachineBlock(
  text: string
): { ok: true; block: Record<string, unknown> } | { ok: false; reason: string } {
  // Fences are matched at line starts and paired open-to-close so that a
  // non-JSON block (a ```text table, say) cannot desynchronize the scan and
  // hide the machine block behind it. The info string is captured rather than
  // filtered in the pattern for the same reason: every fence must be consumed,
  // even the ones whose content is not considered.
  const fence = /^```([^\n]*)\n([\s\S]*?)\n```[ \t]*$/gm;
  const candidates: Record<string, unknown>[] = [];
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = fence.exec(text)) !== null) {
    seen += 1;
    if (seen > RECEIPT_PARSE_BOUNDS.max_json_blocks) {
      return { ok: false, reason: "receipt exceeds the fenced-block scan bound" };
    }
    const info = (match[1] ?? "").trim().toLowerCase();
    if (
      info !== "" &&
      info !== "json" &&
      info !== "jsonc" &&
      info !== RECEIPT_MACHINE_SCHEMA_VERSION
    ) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[2] ?? "");
    } catch {
      continue;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const version = safeGet(parsed, "schema_version");
    if (version.ok && version.value === RECEIPT_MACHINE_SCHEMA_VERSION) {
      candidates.push(parsed as Record<string, unknown>);
    }
  }
  if (candidates.length === 0) {
    return { ok: false, reason: `no ${RECEIPT_MACHINE_SCHEMA_VERSION} block found` };
  }
  if (candidates.length > 1) {
    return { ok: false, reason: `receipt contains ${candidates.length} ${RECEIPT_MACHINE_SCHEMA_VERSION} blocks` };
  }
  return { ok: true, block: candidates[0] as Record<string, unknown> };
}

// ── Receipt → canonical handoff record ───────────────────────────────────────

function firstField(fields: Record<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function aliasesAgree(fields: Record<string, string>, keys: readonly string[]): boolean {
  const declared = keys
    .map((key) => fields[key])
    .filter((value): value is string => typeof value === "string" && value !== "");
  return new Set(declared).size <= 1;
}

type ReceiptFrontmatterShape = "frozen" | "legacy";

interface ReceiptProvenanceFields {
  shape: ReceiptFrontmatterShape;
  authorId: string | null;
  authorFamily: string | null;
  hostId: string | null;
  createdAt: string | null;
  taskId: string | null;
  title: string | null;
  status: HandoffStatus | null;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredRecord(
  errors: DocumentIssue[],
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = plainRecord(parent[key]);
  if (value === null) {
    pushIssue(errors, `$.frontmatter.${key}`, "missing_field", `${key} must be a mapping`);
  }
  return value;
}

function requiredString(
  errors: DocumentIssue[],
  parent: Record<string, unknown>,
  path: string,
  key: string,
): string | null {
  const value = parent[key];
  if (typeof value !== "string" || value.length === 0) {
    pushIssue(errors, `${path}.${key}`, "missing_field", `${key} must be a non-empty string`);
    return null;
  }
  return value;
}

function requiredArray(
  errors: DocumentIssue[],
  parent: Record<string, unknown>,
  key: string,
): unknown[] | null {
  const value = parent[key];
  if (!Array.isArray(value)) {
    pushIssue(errors, `$.frontmatter.${key}`, "missing_field", `${key} must be an array`);
    return null;
  }
  return value;
}

function validateStringArray(errors: DocumentIssue[], values: unknown[] | null, path: string): void {
  if (values === null) return;
  values.forEach((value, index) => {
    if (typeof value !== "string" || value.length === 0) {
      pushIssue(errors, `${path}[${index}]`, "wrong_type", `${path} entries must be non-empty strings`);
    }
  });
}

function canonicalReceiptInstant(
  errors: DocumentIssue[],
  value: unknown,
  path: string,
): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    pushIssue(errors, path, "invalid_timestamp", `${path} must be an ISO-8601 timestamp`);
    return null;
  }
  const parsed = Date.parse(value);
  const expectedCanonical = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== expectedCanonical) {
    pushIssue(errors, path, "invalid_timestamp", `${path} must name a real UTC calendar instant`);
    return null;
  }
  return expectedCanonical;
}

/**
 * Validate the frozen frontmatter field set. Unknown additive fields are
 * ignored (the v1 reader is intentionally lenient), but every frozen field is
 * required and typed. A scalar `host` selects the bounded legacy transition;
 * it is never retyped as the frozen mapping.
 */
function receiptProvenance(
  document: Record<string, unknown>,
  fields: Record<string, string>,
  errors: DocumentIssue[],
): ReceiptProvenanceFields {
  if (plainRecord(document.host) === null) {
    const authorId = firstField(fields, ["agent", "specialist"]);
    const authorFamily = firstField(fields, ["model_family", "family"]);
    const hostId = firstField(fields, ["host"]);
    const createdAt = firstField(fields, ["generated_at"]);
    if (!aliasesAgree(fields, ["agent", "specialist"])) {
      pushIssue(errors, "$.frontmatter.agent", "conflicting_provenance", "frontmatter agent and specialist must agree when both are present");
    }
    if (!aliasesAgree(fields, ["model_family", "family"])) {
      pushIssue(errors, "$.frontmatter.model_family", "conflicting_provenance", "frontmatter model_family and family must agree when both are present");
    }
    if (authorId === null) pushIssue(errors, "$.frontmatter.agent", "missing_provenance", "frontmatter agent/specialist is required");
    if (authorFamily === null) pushIssue(errors, "$.frontmatter.model_family", "missing_provenance", "frontmatter model_family/family is required");
    if (hostId === null) pushIssue(errors, "$.frontmatter.host", "missing_provenance", "frontmatter legacy scalar host is required");
    if (createdAt === null) pushIssue(errors, "$.frontmatter.generated_at", "missing_provenance", "frontmatter generated_at is required for a legacy receipt");
    return {
      shape: "legacy",
      authorId,
      authorFamily,
      hostId,
      createdAt,
      taskId: firstField(fields, ["task_id"]),
      title: firstField(fields, ["task", "title"]),
      status: null,
    };
  }

  const ids = requiredRecord(errors, document, "ids");
  const host = requiredRecord(errors, document, "host");
  const scope = requiredRecord(errors, document, "scope");
  const authorId = requiredString(errors, document, "$.frontmatter", "specialist");
  const taskId = ids === null ? null : requiredString(errors, ids, "$.frontmatter.ids", "task_id");
  if (ids !== null) {
    requiredString(errors, ids, "$.frontmatter.ids", "run_id");
    requiredString(errors, ids, "$.frontmatter.ids", "task_run_id");
    if (!Object.prototype.hasOwnProperty.call(ids, "initiative_id")) {
      pushIssue(errors, "$.frontmatter.ids.initiative_id", "missing_field", "initiative_id is required and may be null");
    } else if (ids.initiative_id !== null && (typeof ids.initiative_id !== "string" || ids.initiative_id.length === 0)) {
      pushIssue(errors, "$.frontmatter.ids.initiative_id", "wrong_type", "initiative_id must be null or a non-empty string");
    }
  }

  const hostId = host === null ? null : requiredString(errors, host, "$.frontmatter.host", "selected");
  if (host !== null) {
    if (typeof host.degraded !== "boolean") pushIssue(errors, "$.frontmatter.host.degraded", "wrong_type", "degraded must be boolean");
    if (host.native_ref !== null && typeof host.native_ref !== "string") pushIssue(errors, "$.frontmatter.host.native_ref", "wrong_type", "native_ref must be null or a string");
    if (host.independence !== "strong" && host.independence !== "weak") {
      pushIssue(errors, "$.frontmatter.host.independence", "unknown_value", "independence must be strong or weak");
    }
  }

  const title = scope === null ? null : requiredString(errors, scope, "$.frontmatter.scope", "objective");
  if (scope !== null) {
    validateStringArray(errors, Array.isArray(scope.in_scope) ? scope.in_scope : null, "$.frontmatter.scope.in_scope");
    validateStringArray(errors, Array.isArray(scope.out_of_scope_touched) ? scope.out_of_scope_touched : null, "$.frontmatter.scope.out_of_scope_touched");
    if (!Array.isArray(scope.in_scope)) pushIssue(errors, "$.frontmatter.scope.in_scope", "missing_field", "in_scope must be an array");
    if (!Array.isArray(scope.out_of_scope_touched)) pushIssue(errors, "$.frontmatter.scope.out_of_scope_touched", "missing_field", "out_of_scope_touched must be an array");
  }

  const statusValue = document.status;
  const status = typeof statusValue === "string" && ["completed", "partial", "blocked", "failed"].includes(statusValue)
    ? statusValue as HandoffStatus
    : null;
  if (status === null) pushIssue(errors, "$.frontmatter.status", "unknown_receipt_status", "status must be completed, partial, blocked, or failed");

  const changedFiles = requiredArray(errors, document, "changed_files");
  changedFiles?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.changed_files[${index}]`;
    if (entry === null) {
      pushIssue(errors, base, "wrong_type", "changed_files entries must be mappings");
      return;
    }
    requiredString(errors, entry, base, "path");
    if (!["created", "modified", "deleted", "renamed"].includes(String(entry.change))) {
      pushIssue(errors, `${base}.change`, "unknown_value", "change must be created, modified, deleted, or renamed");
    }
    if (entry.sha256_after !== null && (typeof entry.sha256_after !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/i.test(entry.sha256_after))) {
      pushIssue(errors, `${base}.sha256_after`, "invalid_hash", "sha256_after must be null or a SHA-256 digest");
    }
  });

  const evidence = requiredArray(errors, document, "evidence");
  evidence?.forEach((value, index) => {
    const entry = plainRecord(value);
    const base = `$.frontmatter.evidence[${index}]`;
    if (entry === null) { pushIssue(errors, base, "wrong_type", "evidence entries must be mappings"); return; }
    if (!["test", "command", "log", "artifact", "screenshot", "url"].includes(String(entry.kind))) pushIssue(errors, `${base}.kind`, "unknown_value", "evidence kind is invalid");
    requiredString(errors, entry, base, "ref");
    if (!["pass", "fail", "n/a"].includes(String(entry.result))) pushIssue(errors, `${base}.result`, "unknown_value", "evidence result is invalid");
  });

  const assumptions = requiredArray(errors, document, "assumptions");
  assumptions?.forEach((value, index) => {
    const entry = plainRecord(value); const base = `$.frontmatter.assumptions[${index}]`;
    if (entry === null) { pushIssue(errors, base, "wrong_type", "assumption entries must be mappings"); return; }
    requiredString(errors, entry, base, "statement");
    if (!["low", "medium", "high"].includes(String(entry.risk_if_wrong))) pushIssue(errors, `${base}.risk_if_wrong`, "unknown_value", "risk_if_wrong is invalid");
  });
  const openRisks = requiredArray(errors, document, "open_risks");
  openRisks?.forEach((value, index) => {
    const entry = plainRecord(value); const base = `$.frontmatter.open_risks[${index}]`;
    if (entry === null) { pushIssue(errors, base, "wrong_type", "open_risks entries must be mappings"); return; }
    requiredString(errors, entry, base, "statement");
    if (!["low", "medium", "high", "critical"].includes(String(entry.severity))) pushIssue(errors, `${base}.severity`, "unknown_value", "severity is invalid");
    if (typeof entry.owner_accepted !== "boolean") pushIssue(errors, `${base}.owner_accepted`, "wrong_type", "owner_accepted must be boolean");
  });
  const followups = requiredArray(errors, document, "followups");
  followups?.forEach((value, index) => {
    const entry = plainRecord(value); const base = `$.frontmatter.followups[${index}]`;
    if (entry === null) { pushIssue(errors, base, "wrong_type", "followup entries must be mappings"); return; }
    requiredString(errors, entry, base, "statement");
    if (typeof entry.blocking !== "boolean") pushIssue(errors, `${base}.blocking`, "wrong_type", "blocking must be boolean");
    if (entry.ref !== null && entry.ref !== undefined && typeof entry.ref !== "string") pushIssue(errors, `${base}.ref`, "wrong_type", "ref must be null or a string");
    if (status === "completed" && entry.blocking === true) pushIssue(errors, `${base}.blocking`, "blocking_followup", "a completed receipt cannot retain a blocking followup");
  });

  const createdAt = canonicalReceiptInstant(errors, document.produced_at, "$.frontmatter.produced_at");
  return {
    shape: "frozen",
    authorId,
    authorFamily: firstField(fields, ["model_family", "family"]) ?? hostId,
    hostId,
    createdAt,
    taskId,
    title,
    status,
  };
}

/**
 * Parse a receipt document into a canonical handoff record.
 * Total — any input yields a result, never a throw.
 */
function parseReceiptDocumentInternal(input: unknown, requireFrozen: boolean): ReceiptParseResult {
  const errors: DocumentIssue[] = [];
  try {
    if (typeof input !== "string") {
      pushIssue(errors, "$", "not_a_string", "receipt document must be a string");
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    if (input.length > RECEIPT_PARSE_BOUNDS.max_characters) {
      pushIssue(errors, "$", "receipt_too_large", "receipt exceeds the parse bound");
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }

    const frontmatter = readReceiptFrontmatter(input);
    if (frontmatter.ok === false) {
      pushIssue(errors, "$.frontmatter", "frontmatter_unreadable", frontmatter.reason);
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }
    const block = readReceiptMachineBlock(input);
    if (block.ok === false) {
      pushIssue(errors, "$.machine_block", "machine_block_unreadable", block.reason);
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }

    const fields = frontmatter.fields;

    // The envelope schema is checked before any provenance is read out of it.
    const declaredEnvelope = firstField(fields, ["schema_version"]);
    if (declaredEnvelope === null) {
      pushIssue(
        errors,
        "$.frontmatter.schema_version",
        "missing_frontmatter_schema",
        `frontmatter schema_version is required and must be ${RECEIPT_FRONTMATTER_SCHEMA_VERSION}`
      );
    } else if (declaredEnvelope !== RECEIPT_FRONTMATTER_SCHEMA_VERSION) {
      pushIssue(
        errors,
        "$.frontmatter.schema_version",
        "wrong_frontmatter_schema",
        `frontmatter schema_version must be ${RECEIPT_FRONTMATTER_SCHEMA_VERSION}`
      );
    }

    const provenance = receiptProvenance(frontmatter.document, fields, errors);
    if (requireFrozen && provenance.shape !== "frozen") {
      pushIssue(
        errors,
        "$.frontmatter.host",
        "legacy_receipt_transition",
        "a frozen-contract gate requires the structured host mapping",
      );
    }

    if (provenance.shape === "frozen") validateReceiptMachineBlock(block.block, errors);

    const taskIdRead = safeGet(block.block, "task_id");
    const taskId = taskIdRead.ok && typeof taskIdRead.value === "string" ? taskIdRead.value : null;
    if (taskId === null) {
      pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a string");
    }

    const statusRead = safeGet(block.block, "status");
    const rawStatus = statusRead.ok && typeof statusRead.value === "string" ? statusRead.value : null;
    const statusMap = provenance.shape === "frozen"
      ? FROZEN_RECEIPT_STATUS_MAP
      : LEGACY_RECEIPT_STATUS_MAP;
    const mappedStatus =
      rawStatus !== null && Object.prototype.hasOwnProperty.call(statusMap, rawStatus)
        ? statusMap[rawStatus]
        : undefined;
    if (mappedStatus === undefined) {
      pushIssue(
        errors,
        "$.machine_block.status",
        "unknown_receipt_status",
        `status must be one of ${Object.keys(statusMap).sort().join("|")}`
      );
    }
    if (provenance.shape === "frozen" && provenance.taskId !== taskId) {
      pushIssue(errors, "$.frontmatter.ids.task_id", "conflicting_identity", "ids.task_id must match the embedded handoff task_id");
    }
    if (provenance.shape === "frozen" && mappedStatus !== undefined && provenance.status !== mappedStatus) {
      pushIssue(errors, "$.frontmatter.status", "conflicting_status", "frontmatter status must match the embedded handoff status");
    }

    if (errors.length > 0 || taskId === null) {
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }

    const recordId = `doc-handoff-${taskId.toLowerCase()}`;
    if (!DOCUMENT_ID_PATTERN.test(recordId)) {
      pushIssue(
        errors,
        "$.machine_block.task_id",
        "derived_id_invalid",
        `task_id does not yield a stable record id (${recordId})`
      );
      return { status: "unparsable", record: null, errors: sortIssues(errors) };
    }

    const artifactsRead = safeGet(block.block, "artifacts");
    const issuesRead = safeGet(block.block, "issues");
    const titleField = provenance.title;

    const candidate = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      kind: "handoff",
      id: recordId,
      title: titleField ?? taskId,
      provenance: {
        author_id: provenance.authorId,
        author_family: provenance.authorFamily,
        host_id: provenance.hostId,
        created_at: provenance.createdAt,
        // The record is derived from a receipt document, not authored as a
        // canonical record — say so rather than claiming authorship.
        source: "imported",
      },
      body: {
        task_id: taskId,
        status: mappedStatus,
        artifacts: artifactsRead.ok ? artifactsRead.value : undefined,
        issues: issuesRead.ok ? issuesRead.value : undefined,
      },
    };

    const validation = validateDocumentRecord(candidate);
    if (!validation.valid || validation.record === null || validation.record.kind !== "handoff") {
      return { status: "unparsable", record: null, errors: validation.errors };
    }
    return { status: "parsed", record: validation.record, errors: [] };
  } catch {
    pushIssue(errors, "$", "internal_guard", "receipt parse was interrupted");
    return { status: "unparsable", record: null, errors: sortIssues(errors) };
  }
}

/** Read either the frozen receipt or the bounded legacy scalar-host transition. */
export function parseReceiptDocument(input: unknown): ReceiptParseResult {
  return parseReceiptDocumentInternal(input, false);
}

/**
 * Gate a receipt against the frozen v1 frontmatter contract. Legacy receipts
 * remain readable for migration, but cannot truthfully set TaskCell
 * `schema_valid` at a new acceptance boundary.
 */
export function validateFrozenReceiptDocument(input: unknown): ReceiptParseResult {
  return parseReceiptDocumentInternal(input, true);
}

/** The required human-review wrapper headings in a canonical lane receipt. */
export const CANONICAL_RECEIPT_SECTIONS = Object.freeze([
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups",
] as const);

/** Strip fenced blocks before matching headings so machine JSON cannot spoof the wrapper. */
function receiptWrapperText(content: string): string {
  const output: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;
  for (const line of content.split(/\r?\n/)) {
    if (fence === null) {
      const opened = /^[ \t]{0,3}(`{3,}|~{3,})(?:[^\n]*)$/.exec(line);
      if (opened) {
        fence = { marker: opened[1][0] as "`" | "~", length: opened[1].length };
        continue;
      }
      output.push(line);
      continue;
    }
    const trimmed = line.replace(/^[ \t]{0,3}/, "");
    const marker = fence.marker === "`" ? "`" : "~";
    if (new RegExp(`^${marker}{${fence.length},}[ \\t]*$`).test(trimmed)) fence = null;
  }
  return output.join("\n");
}

/** Shared runtime/lifecycle predicate for the canonical §8.2 receipt wrapper. */
export function hasCanonicalReceiptWrapper(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const wrapper = receiptWrapperText(input);
  return CANONICAL_RECEIPT_SECTIONS.every((section) =>
    new RegExp(`^##\\s+${section}\\b`, "m").test(wrapper)
  );
}

/**
 * Parse errors that also deserve a named refusal on a consumer's report row.
 * Consumers surface `refusals` but not the full evidence list, so the reason a
 * receipt was distrusted has to survive that projection.
 */
const RECEIPT_REFUSAL_BY_ERROR_CODE: Readonly<Record<string, string>> = Object.freeze({
  missing_frontmatter_schema: "receipt_envelope_schema_unsupported",
  wrong_frontmatter_schema: "receipt_envelope_schema_unsupported",
});

/**
 * Receipt text → typed decision. The entrypoint shipped consumers call: a
 * receipt that cannot be proven yields `refuse`, never a silent pass.
 */
export function decideFromReceiptDocument(input: unknown): DocumentDecision {
  const parsed = parseReceiptDocument(input);
  if (parsed.status !== "parsed" || parsed.record === null) {
    const refusals = new Set<string>(["receipt_not_structured"]);
    for (const error of parsed.errors) {
      if (Object.prototype.hasOwnProperty.call(RECEIPT_REFUSAL_BY_ERROR_CODE, error.code)) {
        refusals.add(RECEIPT_REFUSAL_BY_ERROR_CODE[error.code] as string);
      }
    }
    return {
      authority: "none",
      gate_signal: "refuse",
      disposition: "unknown",
      content_hash: null,
      projection: null,
      refusals: [...refusals].sort(),
      evidence: parsed.errors,
    };
  }
  return decideFromDocumentSources({ record: parsed.record });
}
