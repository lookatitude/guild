#!/usr/bin/env -S npx tsx
/**
 * hooks/using-guild-bootstrap.ts
 *
 * Event:   SessionStart
 * Purpose: Inject the L4 `using-guild` gateway bootstrap into the session via the
 *          STRUCTURED `hookSpecificOutput.additionalContext` envelope — so the
 *          model is primed with WHEN to reach for Guild at session start, even
 *          before any skill autoload, feeding SC-4 (auto-invocation).
 *
 *          This is the ONE Phase-1 DELIBERATE output-format change (L5b): the
 *          plain-stdout banner (`bootstrap.sh`) is PRESERVED as-is for human
 *          visibility; this hook ADDS the machine-injected structured context.
 *          The two channels are intentionally split:
 *            - bootstrap.sh  → human-readable banner (plain stdout)
 *            - this hook      → model context (hookSpecificOutput.additionalContext)
 *
 *          Built on the L5a seam: the SessionStart payload is read + normalized
 *          through `readHookStdin` + `emitClaudeHookEvent` into a `GuildHookEvent`,
 *          so a future Codex SessionStart maps through its own emitter to the same
 *          shape. Additive — does NOT touch the other 5 L5a hooks (zero-delta).
 *
 * Stdin:   JSON — Claude Code SessionStart hook payload (source/cwd/session_id).
 * Stdout:  A single JSON object:
 *            {"hookSpecificOutput":{"hookEventName":"SessionStart",
 *             "additionalContext":"<using-guild SKILL.src.md, verbatim>"}}
 *          The injected context is the WHOLE skill source — frontmatter
 *          (name/description/when_to_use) INCLUDED, since the `description` /
 *          `when_to_use` fields are the richest WHEN-to-engage trigger signals
 *          (feeds SC-4). Emitted ONLY when the source resolves; otherwise the hook
 *          is a silent no-op (no stdout) so a partial install never injects a
 *          broken/empty context block.
 * Stderr:  Diagnostics only.
 * Exit:    Always 0 — a bootstrap-injection failure must never block the session.
 *
 * Runner:  bundled to dist/using-guild-bootstrap.js via esbuild (hooks/package.json).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  emitClaudeHookEvent,
  readHookStdin,
  type GuildHookEvent,
} from "./lib/guild-hook-event.js";

/** Relative path (from the plugin root) of the L4 gateway skill source. */
const USING_GUILD_SRC_REL = path.join(
  "skills",
  "meta",
  "using-guild",
  "SKILL.src.md",
);

/**
 * Resolve the absolute path to `skills/meta/using-guild/SKILL.src.md`, robust to
 * BOTH execution shapes (source via tsx = `hooks/`, compiled via node =
 * `hooks/dist/`): honor `GUILD_PLUGIN_ROOT` first, fall back to Claude's
 * compatibility alias, then walk up from this file's directory until the skill
 * source is found. Returns null if it cannot be located.
 */
function resolveUsingGuildSrc(): string | null {
  const fromEnv = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    const candidate = path.join(fromEnv, USING_GUILD_SRC_REL);
    if (fs.existsSync(candidate)) return candidate;
  }
  // Walk up from __dirname (works for hooks/ AND hooks/dist/).
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, USING_GUILD_SRC_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Normalize the using-guild skill source for injection: CRLF→LF and trim. The
 * WHOLE source is injected — frontmatter (name/description/when_to_use) included,
 * because those fields are the richest WHEN-to-engage trigger signals (SC-4).
 */
export function gatewayContext(src: string): string {
  return src.replace(/\r\n/g, "\n").trim();
}

/**
 * Build the SessionStart additionalContext envelope for a given gateway body.
 * Exported so the golden test pins the EXACT payload shape (SC-8b drift guard).
 */
export function buildSessionStartInjection(gatewayBody: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: gatewayBody,
    },
  });
}

async function main(): Promise<void> {
  // Build on the L5a seam: read + normalize the SessionStart payload (drains
  // stdin; a future Codex host maps through its own emitter to this same shape).
  const raw = await readHookStdin();
  let _payload: GuildHookEvent = {};
  try {
    _payload = emitClaudeHookEvent(raw);
  } catch {
    // SessionStart context injection does not depend on the payload — proceed.
  }

  const srcPath = resolveUsingGuildSrc();
  if (srcPath === null) {
    // Partial install / skill missing — silent no-op (never inject a broken block).
    process.stderr.write(
      "[using-guild-bootstrap] warn: using-guild SKILL.src.md not found; skipping context injection.\n",
    );
    process.exit(0);
  }

  let context: string;
  try {
    context = gatewayContext(fs.readFileSync(srcPath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `[using-guild-bootstrap] warn: failed to read ${srcPath}: ${
        err instanceof Error ? err.message : String(err)
      }; skipping.\n`,
    );
    process.exit(0);
  }

  if (context.length === 0) {
    process.stderr.write(
      "[using-guild-bootstrap] warn: using-guild source is empty; skipping.\n",
    );
    process.exit(0);
  }

  process.stdout.write(buildSessionStartInjection(context));
  process.exit(0);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[using-guild-bootstrap] FATAL: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(0); // never block the session
  });
}
