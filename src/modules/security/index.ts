export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./workflows/safe-object";
export * from "./workflows/injection-guard";
export * from "./workflows/scrubbed-write";
export * from "./workflows/redact-log";
export * from "./workflows/share-set";
// T6b: the canonical redaction applier + its pattern SoT are published so
// consuming modules (e.g. capability's `guild models inspect` emit path) scrub
// through the SAME code as the share scrubber and the package leak audit,
// instead of re-spelling patterns or wiring a private import.
export * from "./workflows/scrub-redact";
export * from "./workflows/secret-patterns";
// T09 (R53): the D-AUDIT security-event record + writer. Harvest is the one
// UNATTENDED durable-write path in Guild, so the knowledge domain must be able to
// emit its audit twin through this module's public entrypoint rather than
// reaching into `workflows/`.
export * from "./workflows/events";
