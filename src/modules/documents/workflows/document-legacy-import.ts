/**
 * src/modules/documents/workflows/document-legacy-import.ts
 *
 * DC-06 — bounded legacy Markdown import.
 *
 * Importing prose can never manufacture canonical authority. This produces a
 * distinct `guild.legacy_document.v1` record that is *structurally* incapable
 * of being mistaken for a canonical one:
 *
 *   - it carries `canonical: false` and `completeness: "partial"` as literal
 *     fields, not as documentation;
 *   - its schema version is not in the canonical vocabulary, so
 *     `validateDocumentRecord` rejects it outright;
 *   - `resolveDocumentAuthority` refuses a legacy record explicitly;
 *   - every lossy step emits a warning code, so a caller that wants to claim
 *     completeness has to ignore an explicit list telling it not to.
 *
 * Bounds are contractual: oversized input is rejected, never truncated into a
 * record that silently omits content.
 */

import { DocumentIssue, sha256Of } from "./document-safe";
import { deepFreeze } from "../../kernel";
import { DOCUMENT_KINDS, DocumentKind } from "./document-records";

export const LEGACY_DOCUMENT_SCHEMA_VERSION = "guild.legacy_document.v1" as const;

export const LEGACY_IMPORT_BOUNDS = Object.freeze({
  max_characters: 65_536,
  max_lines: 2_000,
  max_sections: 64,
  max_section_characters: 4_000,
});

export interface LegacyDocumentSection {
  heading: string;
  text: string;
}

export interface LegacyDocumentRecord {
  schema_version: typeof LEGACY_DOCUMENT_SCHEMA_VERSION;
  /** Literal `false` — a legacy record is never canonical. */
  canonical: false;
  /** Literal `"partial"` — a legacy record never claims completeness. */
  completeness: "partial";
  inferred_kind: DocumentKind | "unknown";
  title: string;
  sections: LegacyDocumentSection[];
  source_hash: string;
}

export interface LegacyImportWarning {
  code: string;
  message: string;
}

export interface LegacyImportResult {
  status: "imported" | "rejected";
  record: LegacyDocumentRecord | null;
  warnings: LegacyImportWarning[];
}

const INLINE_HTML = /<\/?[a-zA-Z][^>]*>/g;
const HEADING = /^(#{1,6})\s+(.*)$/;

const KIND_HINTS: ReadonlyArray<[RegExp, DocumentKind]> = deepFreeze([
  [/\bplan\b/i, "plan"],
  [/\bspec(?:ification)?\b/i, "spec"],
  [/\b(?:handoff|receipt)\b/i, "handoff"],
  [/\breview\b/i, "review"],
  [/\bverif(?:y|ication)\b/i, "verify"],
]);

function warn(code: string, message: string): LegacyImportWarning {
  return { code, message };
}

function inferKind(candidates: readonly string[]): DocumentKind | "unknown" {
  for (const [pattern, kind] of KIND_HINTS) {
    for (const candidate of candidates) {
      if (pattern.test(candidate)) return kind;
    }
  }
  return "unknown";
}

/**
 * Import Markdown into an explicitly partial legacy record. Total — any input,
 * including a non-string, produces a result rather than a throw.
 */
export function importLegacyMarkdown(input: unknown): LegacyImportResult {
  const warnings: LegacyImportWarning[] = [
    warn(
      "legacy_record_is_not_canonical",
      "imported Markdown yields a partial legacy record and never canonical authority"
    ),
  ];

  if (typeof input !== "string") {
    warnings.push(warn("legacy_input_not_string", "legacy import requires a string"));
    return { status: "rejected", record: null, warnings };
  }
  if (input.length > LEGACY_IMPORT_BOUNDS.max_characters) {
    warnings.push(
      warn(
        "legacy_bounds_exceeded",
        `input exceeds ${LEGACY_IMPORT_BOUNDS.max_characters} characters; refusing to truncate`
      )
    );
    return { status: "rejected", record: null, warnings };
  }

  const lines = input.split("\n");
  if (lines.length > LEGACY_IMPORT_BOUNDS.max_lines) {
    warnings.push(
      warn("legacy_bounds_exceeded", `input exceeds ${LEGACY_IMPORT_BOUNDS.max_lines} lines; refusing to truncate`)
    );
    return { status: "rejected", record: null, warnings };
  }

  const sections: LegacyDocumentSection[] = [];
  let current: LegacyDocumentSection = { heading: "", text: "" };
  let started = false;
  let droppedHtml = false;
  let unparsed = 0;
  let inFence = false;
  let title = "";

  const commit = (): void => {
    if (!started) return;
    sections.push({ heading: current.heading, text: current.text.trim() });
  };

  for (const rawLine of lines) {
    if (/^\s*```/.test(rawLine)) {
      inFence = !inFence;
      unparsed += 1;
      continue;
    }
    if (inFence) {
      unparsed += 1;
      continue;
    }

    let line = rawLine;
    if (INLINE_HTML.test(line)) {
      INLINE_HTML.lastIndex = 0;
      line = line.replace(INLINE_HTML, "");
      droppedHtml = true;
    }
    INLINE_HTML.lastIndex = 0;

    const heading = HEADING.exec(line);
    if (heading !== null) {
      commit();
      started = true;
      const text = (heading[2] ?? "").trim();
      current = { heading: text, text: "" };
      if (title === "") title = text;
      if (sections.length >= LEGACY_IMPORT_BOUNDS.max_sections) {
        warnings.push(
          warn(
            "legacy_bounds_exceeded",
            `input exceeds ${LEGACY_IMPORT_BOUNDS.max_sections} sections; refusing to truncate`
          )
        );
        return { status: "rejected", record: null, warnings };
      }
      continue;
    }

    // Structures this bounded importer does not model.
    if (/^\s*\|/.test(line) || /^\s*>/.test(line)) {
      unparsed += 1;
      continue;
    }
    if (line.trim() === "") continue;

    if (!started) {
      started = true;
      current = { heading: "", text: "" };
    }
    if (current.text.length + line.length > LEGACY_IMPORT_BOUNDS.max_section_characters) {
      warnings.push(
        warn(
          "legacy_bounds_exceeded",
          `a section exceeds ${LEGACY_IMPORT_BOUNDS.max_section_characters} characters; refusing to truncate`
        )
      );
      return { status: "rejected", record: null, warnings };
    }
    current.text += (current.text === "" ? "" : "\n") + line.trim();
  }
  commit();

  const inferredKind = inferKind([title, ...sections.map((section) => section.heading)]);
  if (inferredKind === "unknown") {
    warnings.push(warn("legacy_kind_unknown", "no canonical kind could be inferred from the source"));
  } else {
    warnings.push(
      warn("legacy_kind_inferred", `kind ${inferredKind} was inferred from prose and is not authoritative`)
    );
  }
  if (droppedHtml) {
    warnings.push(warn("legacy_inline_html_dropped", "inline HTML was stripped during import"));
  }
  if (unparsed > 0) {
    warnings.push(warn("legacy_lines_unparsed", `${unparsed} line(s) were not modelled by the bounded importer`));
  }

  return {
    status: "imported",
    record: {
      schema_version: LEGACY_DOCUMENT_SCHEMA_VERSION,
      canonical: false,
      completeness: "partial",
      inferred_kind: inferredKind,
      title,
      sections,
      source_hash: sha256Of(input),
    },
    warnings,
  };
}

/** Guard so consumers can assert a value is explicitly legacy, not canonical. */
export function isLegacyDocumentRecord(value: unknown): value is LegacyDocumentRecord {
  if (value === null || typeof value !== "object") return false;
  try {
    const candidate = value as Record<string, unknown>;
    return (
      candidate["schema_version"] === LEGACY_DOCUMENT_SCHEMA_VERSION &&
      candidate["canonical"] === false
    );
  } catch {
    return false;
  }
}

/** Canonical kinds a legacy import may infer. */
export const LEGACY_INFERABLE_KINDS: readonly DocumentKind[] = DOCUMENT_KINDS;

/** Placeholder so the module's issue type stays exported from one place. */
export type LegacyImportIssue = DocumentIssue;
