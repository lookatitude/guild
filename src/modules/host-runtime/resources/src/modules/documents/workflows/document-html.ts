/**
 * src/modules/documents/workflows/document-html.ts
 *
 * DC-04 deterministic HTML projection + DC-05 safe rendering.
 *
 * Guarantees:
 *   - Deterministic. Same record in, byte-identical HTML out; every field and
 *     collection is emitted in a fixed declared order.
 *   - Self-contained. No stylesheet, script, image, iframe or any other
 *     resource-loading attribute, so rendering never touches the network.
 *   - Inert. All record-derived text is escaped, so untrusted content cannot
 *     introduce markup. That is then *proved* structurally by
 *     `scanHtmlForActivePayloads`, which tokenizes the emitted tags and
 *     rejects anything outside the element/attribute allowlist — a render that
 *     somehow produced an active construct fails closed instead of shipping.
 *   - Provenance-bound. Record id, kind, schema version, content hash and the
 *     projection binding are carried in machine-readable attributes, so a
 *     verifier never has to read the prose.
 */

import { DocumentIssue, pushIssue, sortIssues } from "./document-safe";
import { deepFreeze } from "../../kernel";
import { hashDocumentRecord } from "./document-hash";
import { DocumentRecord, validateDocumentRecord } from "./document-records";
import { DocumentProjection, projectValidatedRecord } from "./document-projection";

/** Elements this renderer is permitted to emit. */
const ALLOWED_ELEMENTS = Object.freeze(
  new Set([
    "html", "head", "meta", "title", "body", "article", "section", "header",
    "h1", "h2", "dl", "dt", "dd", "ul", "li", "p", "span", "time", "footer",
  ])
);

/** Attributes this renderer is permitted to emit (plus `data-guild-*`). */
const ALLOWED_ATTRIBUTES = Object.freeze(
  new Set(["lang", "charset", "name", "content", "class", "id"])
);

// ── Escaping ─────────────────────────────────────────────────────────────────

/**
 * Escape for both text and attribute contexts. All five characters are always
 * escaped so that a single unescape table is unambiguous in both directions.
 */
export function escapeHtml(text: string): string {
  let out = "";
  for (const char of text) {
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "'") out += "&#39;";
    else out += char;
  }
  return out;
}

/** The only entities this renderer ever emits. */
const KNOWN_ENTITY = /&(amp|lt|gt|quot|#39);/g;
/** An `&` that does not begin one of them is, by construction, tampering. */
const AMBIGUOUS_AMPERSAND = /&(?!(?:amp|lt|gt|quot|#39);)/;

const ENTITY_VALUES: Readonly<Record<string, string>> = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
});

/**
 * Reverse of `escapeHtml`, strict about ambiguity.
 *
 * The renderer only ever emits the five entities above, so any *other* `&`
 * sequence in a round-tripped value means the document was edited after
 * rendering. That is reported as tampering rather than being best-effort
 * decoded. Decoding is a single pass, so a decoded `&amp;` can never be
 * re-decoded into a second entity.
 */
export function unescapeHtmlStrict(
  text: string
): { ok: true; value: string } | { ok: false; reason: string } {
  if (AMBIGUOUS_AMPERSAND.test(text)) {
    return { ok: false, reason: "ambiguous or unknown HTML entity" };
  }
  return {
    ok: true,
    value: text.replace(KNOWN_ENTITY, (_match, name: string) => ENTITY_VALUES[name] ?? ""),
  };
}

// ── Inertness scanner ────────────────────────────────────────────────────────

/**
 * Structurally verify that `html` contains only allowlisted elements and
 * attributes. Because escaped text can never contain a raw `<` or `>`, every
 * tag this finds is one the renderer actually emitted — so the scan has no
 * false positives on document content.
 */
export function scanHtmlForActivePayloads(html: string): string[] {
  const problems: string[] = [];

  const markupDeclarations = html.match(/<![^>]*>/g) ?? [];
  for (const declaration of markupDeclarations) {
    if (declaration.toLowerCase() !== "<!doctype html>") {
      problems.push(`disallowed markup declaration: ${declaration}`);
    }
  }

  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    if (!ALLOWED_ELEMENTS.has(name)) {
      problems.push(`disallowed element: <${name}>`);
      continue;
    }
    const attributePattern = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(match[2] ?? "")) !== null) {
      const attributeName = (attribute[1] ?? "").toLowerCase();
      if (attributeName.startsWith("data-guild-")) continue;
      if (!ALLOWED_ATTRIBUTES.has(attributeName)) {
        problems.push(`disallowed attribute: ${attributeName} on <${name}>`);
      }
    }
  }
  return problems;
}

// ── Rendering ────────────────────────────────────────────────────────────────

export interface DocumentHtmlBinding {
  record_id: string;
  record_kind: string;
  schema_version: string;
  content_hash: string;
  projection_binding: string;
}

export type DocumentHtmlResult =
  | { ok: true; html: string; binding: DocumentHtmlBinding; errors?: never }
  | { ok: false; html?: never; binding?: never; errors: DocumentIssue[] };

function meta(name: string, content: string): string {
  return `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`;
}

function definition(term: string, value: string): string {
  return `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function bodySections(record: DocumentRecord): string[] {
  if (record.kind === "plan") {
    return [
      `<section class="objectives"><h2>Objectives</h2><ul>` +
        record.body.objectives.map((objective) => `<li>${escapeHtml(objective)}</li>`).join("") +
        `</ul></section>`,
      `<section class="steps"><h2>Steps</h2><ul>` +
        record.body.steps
          .map(
            (step) =>
              `<li data-guild-step-id="${escapeHtml(step.id)}" data-guild-step-status="${escapeHtml(step.status)}">` +
              `<span class="status">${escapeHtml(step.status)}</span> ${escapeHtml(step.title)}</li>`
          )
          .join("") +
        `</ul></section>`,
    ];
  }
  if (record.kind === "spec") {
    return [
      `<section class="requirements"><h2>Requirements</h2><ul>` +
        record.body.requirements
          .map(
            (requirement) =>
              `<li data-guild-requirement-id="${escapeHtml(requirement.id)}" ` +
              `data-guild-priority="${escapeHtml(requirement.priority)}">` +
              `<span class="priority">${escapeHtml(requirement.priority)}</span> ` +
              `${escapeHtml(requirement.statement)}</li>`
          )
          .join("") +
        `</ul></section>`,
    ];
  }
  if (record.kind === "handoff") {
    return [
      `<section class="handoff"><h2>Handoff</h2><dl>` +
        definition("task_id", record.body.task_id) +
        definition("status", record.body.status) +
        `</dl></section>`,
      `<section class="artifacts"><h2>Artifacts</h2><ul>` +
        record.body.artifacts.map((artifact) => `<li>${escapeHtml(artifact)}</li>`).join("") +
        `</ul></section>`,
      `<section class="issues"><h2>Issues</h2><ul>` +
        record.body.issues.map((item) => `<li>${escapeHtml(item)}</li>`).join("") +
        `</ul></section>`,
    ];
  }
  if (record.kind === "review") {
    return [
      `<section class="verdict"><h2>Verdict</h2><p data-guild-verdict="${escapeHtml(record.body.verdict)}">` +
        `${escapeHtml(record.body.verdict)}</p></section>`,
      `<section class="findings"><h2>Findings</h2><ul>` +
        record.body.findings
          .map(
            (finding) =>
              `<li data-guild-finding-id="${escapeHtml(finding.id)}" ` +
              `data-guild-severity="${escapeHtml(finding.severity)}">` +
              `<span class="severity">${escapeHtml(finding.severity)}</span> ` +
              `${escapeHtml(finding.statement)}</li>`
          )
          .join("") +
        `</ul></section>`,
    ];
  }
  return [
    `<section class="outcome"><h2>Outcome</h2><p data-guild-outcome="${escapeHtml(record.body.outcome)}">` +
      `${escapeHtml(record.body.outcome)}</p></section>`,
    `<section class="checks"><h2>Checks</h2><ul>` +
      record.body.checks
        .map(
          (check) =>
            `<li data-guild-check-id="${escapeHtml(check.id)}" ` +
            `data-guild-result="${escapeHtml(check.result)}">` +
            `<span class="result">${escapeHtml(check.result)}</span> ${escapeHtml(check.name)}</li>`
        )
        .join("") +
      `</ul></section>`,
  ];
}

/** Render an already-validated record. */
export function renderValidatedRecordHtml(record: DocumentRecord): DocumentHtmlResult {
  const contentHash = hashDocumentRecord(record);
  const projection: DocumentProjection = projectValidatedRecord(record);
  const binding: DocumentHtmlBinding = {
    record_id: record.id,
    record_kind: record.kind,
    schema_version: record.schema_version,
    content_hash: contentHash,
    projection_binding: projection.binding,
  };

  const html =
    `<!doctype html>` +
    `<html lang="en">` +
    `<head>` +
    `<meta charset="utf-8">` +
    `<title>${escapeHtml(record.title)}</title>` +
    meta("guild.record_id", binding.record_id) +
    meta("guild.record_kind", binding.record_kind) +
    meta("guild.schema_version", binding.schema_version) +
    meta("guild.content_hash", binding.content_hash) +
    meta("guild.projection_binding", binding.projection_binding) +
    meta("guild.disposition", projection.disposition) +
    `</head>` +
    `<body>` +
    `<article data-guild-record-id="${escapeHtml(record.id)}" ` +
    `data-guild-record-kind="${escapeHtml(record.kind)}" ` +
    `data-guild-schema-version="${escapeHtml(record.schema_version)}" ` +
    `data-guild-content-hash="${escapeHtml(contentHash)}" ` +
    `data-guild-projection-binding="${escapeHtml(projection.binding)}">` +
    `<header><h1>${escapeHtml(record.title)}</h1></header>` +
    `<section class="provenance"><h2>Provenance</h2><dl>` +
    definition("author_id", record.provenance.author_id) +
    definition("author_family", record.provenance.author_family) +
    definition("host_id", record.provenance.host_id) +
    definition("created_at", record.provenance.created_at) +
    definition("source", record.provenance.source) +
    `</dl></section>` +
    bodySections(record).join("") +
    `<footer><p class="notice">Rendered projection. The canonical record is authoritative.</p></footer>` +
    `</article>` +
    `</body>` +
    `</html>`;

  const problems = scanHtmlForActivePayloads(html);
  if (problems.length > 0) {
    const errors: DocumentIssue[] = [];
    for (const problem of problems) {
      pushIssue(errors, "$", "active_payload_detected", problem);
    }
    return { ok: false, errors: sortIssues(errors) };
  }

  return { ok: true, html, binding };
}

/** Render an untrusted value: validate and normalize first. Total. */
export function renderDocumentHtml(input: unknown): DocumentHtmlResult {
  const validation = validateDocumentRecord(input);
  if (!validation.valid || validation.record === null) {
    return { ok: false, errors: validation.errors };
  }
  return renderValidatedRecordHtml(validation.record);
}

// ── Binding extraction ───────────────────────────────────────────────────────

export type DocumentHtmlBindingResult =
  | { ok: true; binding: DocumentHtmlBinding; errors?: never }
  | { ok: false; binding?: never; errors: DocumentIssue[] };

const META_KEYS: ReadonlyArray<[keyof DocumentHtmlBinding, string]> = deepFreeze([
  ["record_id", "guild.record_id"],
  ["record_kind", "guild.record_kind"],
  ["schema_version", "guild.schema_version"],
  ["content_hash", "guild.content_hash"],
  ["projection_binding", "guild.projection_binding"],
]);

/**
 * Recover the machine-readable binding from rendered HTML.
 * Reads only the declared meta attributes — never the prose.
 */
export function extractDocumentHtmlBinding(html: unknown): DocumentHtmlBindingResult {
  const errors: DocumentIssue[] = [];
  if (typeof html !== "string") {
    pushIssue(errors, "$", "not_a_string", "rendered HTML must be a string");
    return { ok: false, errors: sortIssues(errors) };
  }

  const found: Partial<Record<keyof DocumentHtmlBinding, string>> = {};
  for (const [field, metaName] of META_KEYS) {
    const pattern = new RegExp(
      `<meta name="${metaName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)">`,
      "g"
    );
    const matches = [...html.matchAll(pattern)];
    if (matches.length === 0) {
      pushIssue(errors, `$.${field}`, "missing_binding_field", `${metaName} is absent`);
      continue;
    }
    if (matches.length > 1) {
      pushIssue(errors, `$.${field}`, "duplicate_binding_field", `${metaName} appears more than once`);
      continue;
    }
    const decoded = unescapeHtmlStrict(matches[0]?.[1] ?? "");
    if (decoded.ok === false) {
      pushIssue(errors, `$.${field}`, "ambiguous_entity", `${metaName}: ${decoded.reason}`);
      continue;
    }
    found[field] = decoded.value;
  }

  if (errors.length > 0) return { ok: false, errors: sortIssues(errors) };
  return {
    ok: true,
    binding: {
      record_id: found.record_id ?? "",
      record_kind: found.record_kind ?? "",
      schema_version: found.schema_version ?? "",
      content_hash: found.content_hash ?? "",
      projection_binding: found.projection_binding ?? "",
    },
  };
}

/**
 * Compare a rendered document's binding against the canonical record.
 * Returns the mismatching field names — empty means the render is faithful.
 */
export function verifyRenderedDocumentBinding(
  html: unknown,
  record: DocumentRecord
): string[] {
  const extracted = extractDocumentHtmlBinding(html);
  if (extracted.ok === false) return ["binding_unreadable"];
  const expected = renderValidatedRecordHtml(record);
  if (expected.ok === false) return ["record_unrenderable"];

  const mismatches: string[] = [];
  for (const [field] of META_KEYS) {
    if (extracted.binding[field] !== expected.binding[field]) mismatches.push(field);
  }
  return mismatches.sort();
}
