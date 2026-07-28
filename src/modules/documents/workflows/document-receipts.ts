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

/**
 * Closed synonym table for the receipt status vocabulary. This is declared
 * normalization between two named vocabularies, not optimistic coercion:
 * anything outside the table is an error, never a guess.
 */
const RECEIPT_STATUS_MAP: Readonly<Record<string, HandoffStatus>> = Object.freeze({
  complete: "completed",
  completed: "completed",
  done: "completed",
  partial: "partial",
  blocked: "blocked",
  failed: "failed",
});

export interface ReceiptParseResult {
  status: "parsed" | "unparsable";
  record: HandoffDocumentRecord | null;
  errors: DocumentIssue[];
}

// ── Bounded structured readers ───────────────────────────────────────────────

/**
 * Read top-level scalar `key: value` pairs from YAML frontmatter.
 * Deliberately minimal: indented lines and list items belong to nested
 * structures this reader does not model, and are skipped rather than guessed.
 *
 * A repeated key is refused rather than resolved. YAML implementations differ
 * on whether the first or the last wins, and an envelope that reads one way
 * here and another way elsewhere is exactly the ambiguity a trust boundary
 * must not absorb.
 */
export function readReceiptFrontmatter(
  text: string
): { ok: true; fields: Record<string, string> } | { ok: false; reason: string } {
  const lines = text.split("\n");
  if ((lines[0] ?? "").trim() !== "---") {
    return { ok: false, reason: "receipt does not begin with YAML frontmatter" };
  }
  const limit = Math.min(lines.length, RECEIPT_PARSE_BOUNDS.max_frontmatter_lines);
  let end = -1;
  for (let index = 1; index < limit; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) return { ok: false, reason: "frontmatter is unterminated" };

  // Null-prototype: a frontmatter key is untrusted input, so `__proto__` and
  // friends must land as ordinary own properties and never as inheritance.
  const fields: Record<string, string> = Object.create(null);
  for (let index = 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "" || line.startsWith(" ") || line.startsWith("\t") || line.startsWith("-")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (value === "") continue;
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      return { ok: false, reason: `frontmatter declares ${key} more than once` };
    }
    fields[key] = value;
  }
  return { ok: true, fields };
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
    if (info !== "" && info !== "json" && info !== "jsonc") continue;
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

/**
 * Parse a receipt document into a canonical handoff record.
 * Total — any input yields a result, never a throw.
 */
export function parseReceiptDocument(input: unknown): ReceiptParseResult {
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

    const authorId = firstField(fields, ["agent", "specialist"]);
    const authorFamily = firstField(fields, ["model_family", "family"]);
    const hostId = firstField(fields, ["host"]);
    const createdAt = firstField(fields, ["generated_at"]);

    if (authorId === null) {
      pushIssue(errors, "$.frontmatter.agent", "missing_provenance", "frontmatter agent/specialist is required");
    }
    if (authorFamily === null) {
      pushIssue(errors, "$.frontmatter.model_family", "missing_provenance", "frontmatter model_family/family is required");
    }
    if (hostId === null) {
      pushIssue(errors, "$.frontmatter.host", "missing_provenance", "frontmatter host is required");
    }
    if (createdAt === null) {
      pushIssue(errors, "$.frontmatter.generated_at", "missing_provenance", "frontmatter generated_at is required");
    }

    const taskIdRead = safeGet(block.block, "task_id");
    const taskId = taskIdRead.ok && typeof taskIdRead.value === "string" ? taskIdRead.value : null;
    if (taskId === null) {
      pushIssue(errors, "$.machine_block.task_id", "missing_field", "task_id must be a string");
    }

    const statusRead = safeGet(block.block, "status");
    const rawStatus = statusRead.ok && typeof statusRead.value === "string" ? statusRead.value : null;
    const mappedStatus =
      rawStatus !== null && Object.prototype.hasOwnProperty.call(RECEIPT_STATUS_MAP, rawStatus)
        ? RECEIPT_STATUS_MAP[rawStatus]
        : undefined;
    if (mappedStatus === undefined) {
      pushIssue(
        errors,
        "$.machine_block.status",
        "unknown_receipt_status",
        `status must be one of ${Object.keys(RECEIPT_STATUS_MAP).sort().join("|")}`
      );
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
    const titleField = firstField(fields, ["task", "title"]);

    const candidate = {
      schema_version: DOCUMENT_SCHEMA_VERSION,
      kind: "handoff",
      id: recordId,
      title: titleField ?? taskId,
      provenance: {
        author_id: authorId,
        author_family: authorFamily,
        host_id: hostId,
        created_at: createdAt,
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
