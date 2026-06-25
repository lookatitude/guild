/**
 * scripts/lib/guild-root.ts
 *
 * Usage: import { resolveGuildRoot } from "./lib/guild-root"
 *
 * Compatibility shim for the state-module repo-root resolver so scripts/
 * callers can keep importing from scripts/lib/guild-root.
 *
 * resolveGuildRoot(startCwd)
 *   Walk UP from startCwd to the nearest ancestor directory that contains
 *   a `.git` entry OR an existing `.guild/` directory.  Returns that
 *   ancestor path.  Falls back to startCwd when no anchor is found
 *   (no-repo / isolated-directory safety).  Never throws.
 *
 * Invariant: every scripts/ writer that uses process.cwd() as its .guild/
 * base MUST pass it through resolveGuildRoot() first, so a sub-directory
 * cwd can never create a nested `.guild/`.
 *
 * Decision: .guild/wiki/decisions/telemetry-anchors-to-repo-root-not-cwd.md
 */

export { resolveGuildRoot } from "../../src/modules/state/workflows/guild-root";
