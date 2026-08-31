/**
 * src/modules/documents/index.ts
 *
 * Public entrypoint for the documents module — HTML-native typed document
 * contracts (DC-01..DC-09).
 *
 * Consumers must import from this file only; the `workflows/` files are
 * private. The module depends on no other module and never on host internals
 * (DC-08), so importing it cannot pull a host, hook, wrapper or transport
 * surface into a consumer.
 *
 * The entrypoints machine consumers want:
 *
 *   validateDocumentRecord     untrusted value → validated, normalized record
 *   projectDocumentRecord      record → compact execution projection
 *   resolveDocumentAuthority   sources → who, if anyone, may speak
 *   decideFromDocumentSources  sources → an actionable, fail-closed decision
 *   decideFromReceiptDocument  receipt text → the same decision
 *   renderDocumentHtml         record → deterministic, inert HTML
 *   importLegacyMarkdown       Markdown → explicitly partial legacy record
 *   migrateDocumentRecord      versioned payload → current record or refusal
 */

export * from "./workflows/document-safe";
export * from "./workflows/document-records";
export * from "./workflows/document-hash";
export * from "./workflows/document-projection";
export * from "./workflows/document-html";
export * from "./workflows/document-legacy-import";
export * from "./workflows/document-versioning";
export * from "./workflows/document-decisions";
export * from "./workflows/document-receipts";
export * from "./workflows/document-service-boundary";
