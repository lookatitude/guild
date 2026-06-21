/**
 * hooks/lib/guild-hook-event.ts
 *
 * GuildHookEvent — the single normalized hook payload that Guild's downstream
 * telemetry / security / trace consumers read, decoupled from any one host's
 * raw hook wire-format. A per-host "emitter" maps that host's hook stdin into
 * this one shape; consumers never parse host JSON ad hoc.
 *
 * Phase-1 (P0) ships the CLAUDE emitter only. For Claude Code the field mapping
 * is the IDENTITY — Claude's wire field names (`session_id`, `tool_name`,
 * `hook_event_name`, …) already are the canonical names — which is exactly why
 * L5a is a byte-for-byte zero-delta refactor: introducing the seam changes the
 * INTERNAL shape consumers read, never what any hook outputs or does. A future
 * Codex emitter will remap Codex's differently-named fields into the same
 * GuildHookEvent so the telemetry/security/trace hooks stay host-agnostic.
 *
 * This is the runtime-payload counterpart to how L0's `guild.host_capabilities.v1`
 * models hooks as a first-class neutral category (see
 * `plugin/scripts/lib/host-capabilities-schema.ts` → `REQUIRED_HOOK_EVENTS`).
 * Note: the capability ROW advertises events in snake_case (`pre_tool_use`); the
 * runtime `hook_event_name` below carries the host's verbatim wire value
 * (`PreToolUse`) untouched — normalization of the event NAME is not in scope here.
 *
 * ── Phase-1 (L5a) consumer scope — EXPLICIT ────────────────────────────────
 * Exactly these five hooks consume the emitter in P0 (telemetry · security ·
 * trace): `capture-telemetry.ts`, `pre-tool-use.ts`, `post-tool-use.ts`,
 * `run-trace-start.ts`, `run-trace-close.ts`. The following Claude hooks are
 * DELIBERATELY excluded from this lane and keep their own readers/parse:
 *   - `detect-guild-version.ts` — uses a 500ms-timeout stdin reader, NOT the
 *     data/end/error reader below; folding it in would change read behavior.
 *   - `run-trace.ts` — a `--run-id` CLI that parses an entries ARRAY, not the
 *     host hook payload shape.
 *   - `pre-compact.ts`, `comms-format-lint.ts`, `learning-backstop.ts`,
 *     `maybe-reflect.ts`, `agent-team/*` — outside the five named
 *     telemetry/security/trace consumers; DEFERRED to keep this
 *     highest-regression-risk lane minimal. (The `host` stamp would be inert in
 *     each — none whole-payload-serializes the top-level event; e.g.
 *     `pre-compact.ts` stringifies only the nested `payload.payload` sub-field
 *     via `payloadExcerpt(payload.payload)`, not the top-level object — so they
 *     are safe to adopt the seam in a later pass, just not in scope here.)
 */

/** The host emitter that produced a GuildHookEvent. */
export type GuildHostKind = "claude" | "codex" | "pi" | "antigravity" | "claude-code-app" | "claude-code-web" | "codex-app" | "claude-ai-connector";

/**
 * Normalized hook payload. A structural superset of every field the Phase-1
 * Claude telemetry/security/trace hooks read, plus an index signature so any
 * host field a hook reads in the future passes through untouched. All fields are
 * optional: a hook that fails to parse stdin keeps an empty `{}` and bails on its
 * own established error branch, exactly as before.
 */
export interface GuildHookEvent {
  /** Which host emitter produced this event. Set by the emitter; `claude` in P0. */
  host?: GuildHostKind;

  // ── Core Claude Code hook fields (canonical names) ─────────────────────────
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { success?: boolean; error?: string } | unknown;

  // ── Event-specific fields ──────────────────────────────────────────────────
  agent_name?: string;
  stop_reason?: string;
  duration_ms?: number;
  prompt?: string;
  model?: string;
  /** PreToolUse: host permission mode ("default" | "plan" | "acceptEdits" | "bypassPermissions"). */
  permission_mode?: string;
  /** PreToolUse: live MCP tool description when the host provides it (forward-compatible). */
  tool_description?: string;

  // ── loop_round fields — emitted by loop skill scripts via emit-loop-event.ts ─
  loop_layer?: string;
  loop_round?: number;
  loop_gate?: string;
  loop_terminated?: boolean;

  // ── D-OBS-1: provider token/usage object, present on LLM-call events only. ──
  tokens?: unknown;
  usage?: unknown;

  /** Forward-compat: unknown host fields pass through untouched. */
  [key: string]: unknown;
}

/**
 * Read all of stdin into a string. Resolves "" on stream error and never
 * rejects — telemetry/security/trace hooks must never block tool execution on a
 * read failure. Byte-identical to the per-hook readers it replaces.
 */
export async function readHookStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

/**
 * Claude emitter: normalize a raw Claude Code hook stdin string into a
 * GuildHookEvent. The body mirrors the `JSON.parse(raw.trim()) as T` call it
 * replaces — same parse, same trim — and THROWS on invalid JSON so each caller
 * keeps its own established error branch (some `return`, some `process.exit(0)`).
 *
 * Fidelity note (byte-for-byte): the original code blind-cast the parse result,
 * so a valid-but-non-object body (`"null"`, a number, an array, a string) flowed
 * downstream AS-IS and each hook's existing field-access / outer-fatal path
 * handled it. We reproduce that EXACTLY: a non-object parse result is returned
 * unchanged, and the `host: "claude"` provenance stamp is applied ONLY to real
 * object payloads (the sole case that occurs in the Claude hook contract). For
 * Claude the field mapping is otherwise the identity.
 */
export function emitClaudeHookEvent(raw: string): GuildHookEvent {
  const parsed = JSON.parse(raw.trim()) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Preserve the original blind-cast semantics on a non-object body: return it
    // as-is so the caller's existing downstream/fatal path fires exactly as before.
    return parsed as GuildHookEvent;
  }
  return { ...(parsed as Record<string, unknown>), host: "claude" };
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function firstValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function normalizeGenericHookEvent(raw: string, host: GuildHostKind): GuildHookEvent {
  const parsed = JSON.parse(raw.trim()) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed as GuildHookEvent;
  }
  const obj = parsed as Record<string, unknown>;
  const out: GuildHookEvent = { ...obj, host };
  const sessionId = firstString(obj, ["session_id", "sessionId", "session", "conversation_id", "conversationId", "thread_id", "threadId"]);
  const cwd = firstString(obj, ["cwd", "workspace", "workspace_path", "workspacePath"]);
  const eventName = firstString(obj, ["hook_event_name", "hookEventName", "event", "event_name", "eventName", "type"]);
  const toolName = firstString(obj, ["tool_name", "toolName", "tool", "tool_id", "toolId", "name"]);
  const prompt = firstString(obj, ["prompt", "message", "input_text", "inputText"]);
  const model = firstString(obj, ["model", "model_id", "modelId"]);
  if (sessionId !== undefined) out.session_id = sessionId;
  if (cwd !== undefined) out.cwd = cwd;
  if (eventName !== undefined) out.hook_event_name = eventName;
  if (toolName !== undefined) out.tool_name = toolName;
  const toolInput = firstValue(obj, ["tool_input", "toolInput", "arguments", "args", "input"]);
  if (toolInput !== undefined) out.tool_input = toolInput;
  const toolResponse = firstValue(obj, ["tool_response", "toolResponse", "result", "response", "output"]);
  if (toolResponse !== undefined) out.tool_response = toolResponse;
  if (prompt !== undefined) out.prompt = prompt;
  if (model !== undefined) out.model = model;
  return out;
}

/** Pi CLI emitter: maps Pi extension/tool event fields into GuildHookEvent. */
export function emitPiHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "pi");
}

/** Antigravity CLI emitter: maps agy plugin/tool event fields into GuildHookEvent. */
export function emitAntigravityHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "antigravity");
}

// App/connector surfaces do not have local native hooks. These emitters are the
// shared normalization boundary for forwarded connector events and file-bus
// packets that need to enter Guild's hook-shaped telemetry pipeline.
export function emitCodexAppHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "codex-app");
}

export function emitClaudeCodeAppHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "claude-code-app");
}

export function emitClaudeCodeWebHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "claude-code-web");
}

export function emitClaudeAiConnectorHookEvent(raw: string): GuildHookEvent {
  return normalizeGenericHookEvent(raw, "claude-ai-connector");
}
