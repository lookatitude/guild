/**
 * scripts/lib/guild-root.ts
 *
 * Usage: import { resolveGuildRoot } from "./lib/guild-root"
 *
 * Single-SoT re-export of the hook-tier repo-root resolver so scripts/
 * callers don't import from ../../hooks/lib/guild-root directly (the
 * two-level path is fragile and easy to mis-type).
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

export { resolveGuildRoot } from "../../hooks/lib/guild-root";
