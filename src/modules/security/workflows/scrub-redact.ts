/**
 * src/modules/security/workflows/scrub-redact.ts
 *
 * CANONICAL, single-source redaction applier for share-dot-guild (verified-multi-
 * host-support L0 ADR §6.4, security F1 BLOCKER). Scrubbing MUST be code on the
 * write/commit path, not prose — this module is the ONE place the operator-path +
 * tilde-Claude-path + secret-pattern redaction lives. Extracted verbatim from the
 * formerly-local `redact()` in scripts/dot-guild/scrub.ts.
 *
 * Consumers (all import from here — no re-spelled duplicate):
 *   - scrub.ts   — the per-run share-dot-guild scrubber (write path).
 *   - audit.ts   — the package/receipt-tree leak scan (ADR §7.2); "same applier as
 *                  the write path → no drift".
 *   - L5         — receipt-write-time scrub (clean at commit, not post-push).
 *   - L6         — the build/verify redaction-verify pass over plugin/evidence.
 *   - L8         — the byte-identical no-op cleanliness assertion
 *                  (redact(committed).out === committed).
 *
 * Secret patterns are sourced (never re-spelled) from the canonical SoT at the
 * sibling `secret-patterns.ts` (moved here from docs-hygiene/scan.ts — audit
 * remediation item 16 — so the security module no longer imports UPWARD from a
 * self-build docs scanner; `scan.ts` now re-exports FROM here instead).
 *
 * PURITY: no I/O, no spawn, no clock. Fully unit-testable.
 */

import { SECRET_PATTERNS } from "./secret-patterns";

// Operator-path patterns (Decision H.2 + Decision M relative-paths-policy).
// Placeholders are idempotent — they won't re-match.
const OPERATOR_PATH_RE = /\/Users\/[^/\s]+\/Projects\/[^/\s]+/g;
const WORKSPACE_ROOT_MARKER = "<workspace-root>";
// Decision M: tilde-prefixed Claude project paths leak the workspace via the
// URL-encoded slug `~/.claude/projects/-Users-<NAME>-Projects-<WS>/...`.
const TILDE_CLAUDE_PROJECT_RE = /~\/\.claude\/projects\/-Users-[^/\s]+-Projects-[^/\s]+/g;
const OPERATOR_MEMORY_ROOT_MARKER = "<operator-memory-root>";
// T6B-R1-B1: the two patterns above only recognize the WORKSPACE forms (the
// macOS home + `Projects` + workspace path, and the tilde-Claude slug). A
// round-1 live probe leaked a private home path under a user's `.ssh`
// directory — an absolute path that is neither of those two shapes. This
// third pattern generalizes to ANY private home root (a macOS `Users` home or
// a Linux `home` home); only the home PREFIX is replaced, so
// the path's structure survives for replay (AGENTS.md §"Redaction must
// preserve structure"). It runs LAST so the two specific markers above win.
// Idempotent: the marker contains no `/Users/` or `/home/` segment.
const PRIVATE_HOME_PATH_RE = /\/(?:Users|home)\/[A-Za-z0-9._-]+(?=[/\s"',:;)\]}]|$)/g;
const PRIVATE_HOME_MARKER = "<private-home>";

export interface SecretHit {
  category: string;
  line: number;
}

/**
 * The result of a redaction pass. `opPaths` and `secrets` are INDEPENDENT counters
 * (round-2 minor): a caller decides an operator-path finding on `opPaths > 0` and a
 * secret finding on `secrets.length > 0` — they must never be conflated.
 */
export interface RedactResult {
  out: string;
  opPaths: number;
  secrets: SecretHit[];
}

/**
 * Redact operator paths, tilde-Claude project paths, and secret-pattern matches.
 * Returns the scrubbed text plus the two independent counters. Idempotent +
 * deterministic (placeholders never re-match; no clock/PID/nonce).
 */
export function redact(content: string): RedactResult {
  let opPaths = 0;
  let out = content.replace(OPERATOR_PATH_RE, () => { opPaths++; return WORKSPACE_ROOT_MARKER; });
  // Decision M: also redact tilde-prefixed Claude project paths.
  out = out.replace(TILDE_CLAUDE_PROJECT_RE, () => { opPaths++; return OPERATOR_MEMORY_ROOT_MARKER; });
  // T6B-R1-B1: any remaining private home root (`/Users/<n>`, `/home/<n>`) —
  // the general case the two workspace-specific patterns above do not cover.
  out = out.replace(PRIVATE_HOME_PATH_RE, () => { opPaths++; return PRIVATE_HOME_MARKER; });
  const secrets: SecretHit[] = [];
  const lines = out.split("\n");
  out = lines.map((line, i) => {
    let l = line;
    for (const [re, label] of SECRET_PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      if (g.test(l)) {
        secrets.push({ category: label, line: i + 1 });
        l = l.replace(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
          `<SECRET-REDACTED:${label}>`);
      }
    }
    return l;
  }).join("\n");
  return { out, opPaths, secrets };
}
