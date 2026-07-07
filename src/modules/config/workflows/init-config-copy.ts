/**
 * src/modules/config/workflows/init-config-copy.ts
 *
 * Centralized host-open / init advisory copy (spec init-config-goal line 83). The
 * preflight contract carries an advisory `{code, message}`; the message text lives
 * HERE (one place) so every host adapter renders the SAME wording — adapters may
 * relabel for their native surface but must convey the same facts.
 *
 * Module: config — pure data, no I/O. Re-exported via scripts/lib for the spec path.
 */

/** Advisory codes emitted by `hostOpenPreflight` (mirrors PreflightAdvisory.code). */
export type AdvisoryCode = "ready" | "not_installed" | "needs_repair" | "host_unsupported";

/**
 * Canonical advisory copy keyed by advisory code. `not_installed` mirrors the exact
 * spec line-83 string; the others are the centralized equivalents adapters render
 * for the proceed / repair / unsupported routes.
 */
export const INIT_CONFIG_COPY: Readonly<Record<AdvisoryCode, string>> = {
  ready:
    "Guild is initialized here. Lifecycle commands and settings management are available.",
  not_installed:
    "Guild is not initialized in this folder. Initialize Guild to enable lifecycle commands and settings management.",
  needs_repair:
    "Guild is installed here but incomplete or malformed. Repair the install to restore the required Guild structure; lifecycle commands are unavailable until repair completes.",
  host_unsupported:
    "This host has no native Guild config surface yet. Settings management is unavailable here; use a supported CLI host to initialize, repair, or edit Guild settings.",
} as const;

/** Resolve the centralized advisory message for a code. */
export function advisoryMessage(code: AdvisoryCode): string {
  return INIT_CONFIG_COPY[code];
}
