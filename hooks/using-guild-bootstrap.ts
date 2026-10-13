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
 * Guild root (R48 / KTD31): when the session's cwd resolves to a root with a
 *          `.guild/` directory, Guild ALWAYS bootstraps, in this order:
 *            1. ensureStorageLayout   — marker read when current (KTD23/KTD29);
 *                                       a future layout fails closed.
 *            2. projectSurfaces       — the host family's adapter map + rung plan.
 *            3. composeSessionPrompt  — using-guild + project overlays + the
 *                                       model-family dialect (<=200 tokens).
 *            4. bindSession           — when a run is active, record the host,
 *                                       model family and prompt_compose hash.
 *          Plugin or compile outputs missing on a Guild root fails CLOSED: the
 *          context says so and the session is not treated as a vanilla one.
 *
 * Stdin:   JSON — Claude Code SessionStart hook payload (source/cwd/session_id).
 * Stdout:  A single JSON object:
 *            {"hookSpecificOutput":{"hookEventName":"SessionStart",
 *             "additionalContext":"<using-guild SKILL.src.md, verbatim>"}}
 *          The injected context is the COMPOSED always-on prefix: the WHOLE
 *          using-guild source (frontmatter INCLUDED — the richest WHEN-to-engage
 *          signals, SC-4), then any project overlay and the dialect. Off a Guild
 *          root with no skill source the hook is a silent no-op.
 * Stderr:  Diagnostics only.
 * Exit:    0, except 2 when a Guild root fails closed (plugin or compile outputs
 *          missing, future layout, rejected project prompt, any bootstrap step
 *          that throws).
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
import { ensureStorageLayout } from "./lib/ensure-layout.js";
import { detect as detectLayout } from "../scripts/lib/state/ensure-storage-layout.js";
import { resolveActiveRunId } from "./lib/reanchor.js";
import {
  PromptRejectedError,
  bindSession,
  composeSessionPrompt,
  detectSession,
} from "../src/domains/config";
import { projectSurfaces, rungKeyForSession } from "../src/adapters";
import { createGuildStorage } from "../src/domains/state";
import { recordRungLosses, type RungPlan } from "../src/domains/dispatch";

/** Relative path (from the plugin root) of the L4 gateway skill source. */
const USING_GUILD_SRC_REL = path.join(
  "skills",
  "meta",
  "using-guild",
  "SKILL.src.md",
);

/** Compile outputs a Guild session cannot run without (KTD7/KTD10). */
export const REQUIRED_COMPILE_OUTPUTS: readonly string[] = Object.freeze([
  path.join("runtime", "guild-mcp.js"),
  path.join("runtime", "scripts", "ensure-storage-layout.js"),
  path.join("hooks", "dist", "using-guild-bootstrap.js"),
]);

/**
 * Resolve the plugin root, robust to BOTH execution shapes (source via tsx =
 * `hooks/`, compiled via node = `hooks/dist/`): honor `GUILD_PLUGIN_ROOT`, then
 * Claude's compatibility alias, then walk up from this file's directory. The
 * root is the directory that carries the using-guild skill source.
 */
export function resolvePluginRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of ["GUILD_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"]) {
    const fromEnv = env[key];
    if (typeof fromEnv === "string" && fromEnv.length > 0) {
      if (fs.existsSync(path.join(fromEnv, USING_GUILD_SRC_REL))) return fromEnv;
    }
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, USING_GUILD_SRC_REL))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Normalize the composed prefix for injection: CRLF→LF and trim. Frontmatter
 * stays (see the file header).
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

export type SessionStartOutcome =
  | { kind: "inject"; context: string; exitCode: 0 }
  | { kind: "fail_closed"; context: string; exitCode: 2; reason: string }
  | { kind: "noop"; exitCode: 0; reason: string };

function failClosed(reason: string): SessionStartOutcome {
  return {
    kind: "fail_closed",
    exitCode: 2,
    reason,
    context:
      `GUILD FAILED CLOSED on this Guild root: ${reason}. ` +
      "Do not continue as a non-Guild session. Reinstall or upgrade the Guild plugin " +
      "(install.sh, or `claude plugin update guild`), then start a new session.",
  };
}

/**
 * The SessionStart chain. Pure over its inputs apart from the layout bootstrap
 * and the run binding it writes, so a fixture can drive every branch.
 */
export function bootstrapSession(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  pluginRoot: string | null;
}): SessionStartOutcome {
  // A Guild root is a resolved root with a `.guild/` directory (a pure read).
  const layout = detectLayout(input.cwd);
  const { pluginRoot } = input;

  if (layout.state === "absent") {
    // Off a Guild root: the always-on gateway is still offered, never forced.
    if (pluginRoot === null) return { kind: "noop", exitCode: 0, reason: "using-guild SKILL.src.md not found" };
    const detected = detectSession(input.env);
    const composed = composeSessionPrompt({
      host_family: detected.host_family,
      model_family: detected.model_family,
      pluginRoot,
      guildDir: null,
    });
    const context = gatewayContext(composed.text);
    return context.length === 0
      ? { kind: "noop", exitCode: 0, reason: "using-guild source is empty" }
      : { kind: "inject", context, exitCode: 0 };
  }

  // R48: on a Guild root the plugin and its compile outputs are mandatory.
  if (pluginRoot === null) return failClosed("the Guild plugin root cannot be resolved");
  const missing = REQUIRED_COMPILE_OUTPUTS.filter((rel) => !fs.existsSync(path.join(pluginRoot, rel)));
  if (missing.length > 0) return failClosed(`compile outputs missing: ${missing.join(", ")}`);

  // Any throw past this point would leave a Guild root with no projection and no
  // signal, so it fails closed and names the cause (R48).
  try {
    return bootstrapGuildRoot(layout.root, input.env, pluginRoot);
  } catch (err) {
    return failClosed(`bootstrap error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Every loss the projection reports lands on the run's event log as a
 * degradation record (KTD28). A loss that cannot be written is said, not hidden;
 * the launcher refuses isolated spawn on the same condition.
 */
function recordProjectionLosses(runDir: string, runId: string, plan: RungPlan): string[] {
  const expected = plan.losses.length;
  if (expected === 0) return [];
  const written = recordRungLosses({ runDir, run_id: runId, plan });
  if (written === expected) return [];
  return [
    `Guild could NOT record ${expected - written} of ${expected} rung losses on run ${runId} ` +
      "(event log unwritable); isolated spawn is refused for this run until it is writable.",
  ];
}

function bootstrapGuildRoot(
  guildRoot: string,
  env: NodeJS.ProcessEnv,
  pluginRoot: string,
): SessionStartOutcome {
  // 1. Layout bootstrap: a marker read when current; a future layout refuses.
  const storage = createGuildStorage(guildRoot, { activeRoot: guildRoot, profile: "standalone" });
  const gate = ensureStorageLayout(guildRoot, "session-start");
  if (!gate.ok) return failClosed(gate.reason ?? "layout refused");

  // 2. Project the surface for this host family.
  const detected = detectSession(env);
  const projection = projectSurfaces(rungKeyForSession(detected), { verify_check_available: false });

  // 3. Compose the always-on prefix. A project prompt carrying host or model
  //    identity is refused, and that refusal reaches the operator (KTD22).
  let composed: ReturnType<typeof composeSessionPrompt>;
  try {
    composed = composeSessionPrompt({
      host_family: detected.host_family,
      model_family: detected.model_family,
      pluginRoot,
      guildDir: storage.root.durable,
    });
  } catch (err) {
    if (err instanceof PromptRejectedError) return failClosed(err.message);
    throw err;
  }

  // 4. Bind the active run, if there is one, to this host + prompt.
  const notes: string[] = [];
  const runId = resolveActiveRunId(guildRoot);
  if (runId !== undefined) {
    const runDir = storage.project!.runRecord(runId);
    if (fs.existsSync(runDir)) {
      const bound = bindSession({
        runDir,
        runId,
        detected,
        promptCompose: {
          dialect_id: composed.dialect_id,
          overlay_ids: composed.overlay_ids,
          hash: composed.hash,
        },
      });
      if (!bound.ok) notes.push(bound.message);
      else notes.push(...recordProjectionLosses(runDir, runId, projection.plan));
    }
  }
  if (projection.summary) notes.push(projection.summary);

  const context = gatewayContext([composed.text, ...notes].join("\n\n"));
  return { kind: "inject", context, exitCode: 0 };
}

async function main(): Promise<void> {
  // Build on the L5a seam: read + normalize the SessionStart payload (drains
  // stdin; a future Codex host maps through its own emitter to this same shape).
  const raw = await readHookStdin();
  let payload: GuildHookEvent = {};
  try {
    payload = emitClaudeHookEvent(raw);
  } catch {
    // The payload only supplies cwd; fall back to the process cwd.
  }
  const cwd =
    typeof (payload as { cwd?: unknown }).cwd === "string" && (payload as { cwd: string }).cwd.length > 0
      ? (payload as { cwd: string }).cwd
      : process.cwd();

  const outcome = bootstrapSession({ cwd, env: process.env, pluginRoot: resolvePluginRoot() });
  if (outcome.kind === "noop") {
    process.stderr.write(`[using-guild-bootstrap] warn: ${outcome.reason}; skipping context injection.\n`);
    process.exit(0);
  }
  if (outcome.kind === "fail_closed") {
    process.stderr.write(`[using-guild-bootstrap] FAIL CLOSED: ${outcome.reason}\n`);
  }
  process.stdout.write(buildSessionStartInjection(outcome.context));
  process.exit(outcome.exitCode);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const cause = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[using-guild-bootstrap] FATAL: ${cause}\n`);
    // Off a Guild root an internal error never blocks the session. On one, the
    // session must learn that Guild did not bootstrap (R48).
    let onGuildRoot = false;
    try {
      onGuildRoot = detectLayout(process.cwd()).state !== "absent";
    } catch {
      onGuildRoot = true;
    }
    if (!onGuildRoot) process.exit(0);
    const outcome = failClosed(`bootstrap error: ${cause}`);
    process.stdout.write(buildSessionStartInjection(outcome.context));
    process.exit(outcome.exitCode);
  });
}
