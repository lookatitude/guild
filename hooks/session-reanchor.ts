#!/usr/bin/env -S npx tsx
/**
 * hooks/session-reanchor.ts
 *
 * Event:   SessionStart
 * Purpose: Gap G1 — re-anchor the orchestrator's behavioral contract AFTER a
 *          /compact or session resume (OIR work-item oir-wi-00; issues
 *          #56/#57/#59/#60).
 *
 *          This is the RELIABLE re-anchor surface. Empirically, on current
 *          Claude Code the SessionStart hook fires with `source` in the enum
 *          {startup, resume, clear, compact, fork}, and its
 *          `hookSpecificOutput.additionalContext` is injected into the model
 *          context of the NEW (post-compact / resumed) window — so it survives
 *          the very compaction that dropped the posture. PreCompact
 *          (hooks/pre-compact.ts) fires BEFORE compaction and is shipped as a
 *          best-effort belt-and-suspenders; this hook is the one that lands.
 *
 *          Fires ONLY on source=compact|resume: a fresh startup / clear / fork
 *          is not a posture-loss event (using-guild-bootstrap already primes
 *          startup), so we stay silent there — zero noise.
 *
 *          Separate from using-guild-bootstrap.ts on purpose: that hook has a
 *          golden-pinned payload (SC-8b drift guard) and injects the generic
 *          gateway on every start; this hook injects run-specific posture only
 *          on the two posture-loss sources. Keeping them apart avoids coupling a
 *          run-state read into the always-on startup path.
 *
 * Stdin:   JSON — Claude Code SessionStart payload (carries `source`, `cwd`).
 * Stdout:  A single JSON object (the additionalContext envelope) when an active
 *          OPEN run exists AND source is compact|resume; otherwise NOTHING.
 * Stderr:  Diagnostics only.
 * Exit:    Always 0 — a re-anchor failure must never block the session.
 *
 * Runner:  bundled to dist/session-reanchor.js via esbuild (hooks/package.json).
 */

import { resolveGuildRoot } from "./lib/guild-root.js";
import {
  REANCHOR_SESSION_SOURCES,
  buildReanchorHeader,
  buildAdditionalContextEnvelope,
} from "./lib/reanchor.js";

interface SessionStartPayload {
  source?: string;
  cwd?: string;
  hook_event_name?: string;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

export async function main(): Promise<void> {
  const raw = await readStdin();
  let payload: SessionStartPayload = {};
  try {
    if (raw.trim().length > 0) {
      const parsed: unknown = JSON.parse(raw.trim());
      // Type-guard the JSON boundary: `JSON.parse` happily returns null, a
      // number, or an array for VALID JSON, and casting straight to the payload
      // interface would make the field reads below throw (a fatal diagnostic
      // instead of the documented silent no-op). Only a plain object is usable.
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      payload = parsed as SessionStartPayload;
    }
  } catch {
    // A malformed payload has no `source` we can trust — stay silent.
    return;
  }

  const source = typeof payload.source === "string" ? payload.source : "";
  if (!REANCHOR_SESSION_SOURCES.has(source)) {
    // startup / clear / fork — not a posture-loss event. Zero noise.
    return;
  }

  // `cwd` is only usable when it is actually a string — a non-string (e.g. 42)
  // must fall through to process.cwd(), never reach resolveGuildRoot.
  const payloadCwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
  const cwd = process.env["GUILD_CWD"] ?? payloadCwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);

  const header = buildReanchorHeader(guildRoot);
  if (header === null) return; // no active OPEN run → emit nothing.

  process.stdout.write(buildAdditionalContextEnvelope("SessionStart", header));
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[session-reanchor] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0); // never block the session
  });
}
