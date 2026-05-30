#!/usr/bin/env -S npx tsx
/**
 * hooks/capture-telemetry.ts
 *
 * Events:  PostToolUse | SubagentStop | UserPromptSubmit
 * Purpose: Appends one NDJSON event line per invocation to
 *          .guild/runs/<run-id>/events.ndjson.
 *
 * Event schema:
 * {
 *   "ts":             "<ISO-8601>",
 *   "event":          "PostToolUse | SubagentStop | UserPromptSubmit | loop_round_start | loop_round_end | codex_review_round",
 *   "tool":           "<tool name, empty for SubagentStop/UserPromptSubmit>",
 *   "specialist":     "<agent name if applicable, empty for main session>",
 *   "payload_digest": "<short signature of inputs, not full payload>",
 *   "ok":             <bool>,
 *   "ms":             <duration ms if known, 0 otherwise>,
 *   "model":          "<model name if provided in payload, omitted otherwise>",
 *   "prompt":         "<user prompt text, UserPromptSubmit only; omitted otherwise>",
 *   "loop_layer":     "<L1|L2|L3|L4|security-review — loop events only>",
 *   "loop_round":     <1-indexed round number — loop events only>,
 *   "loop_gate":      "<G-spec|G-plan|G-diagnose|G-lane:<lane-id> — codex_review_round only>",
 *   "loop_terminated":<bool — loop_round_end/codex_review_round only>,
 *   // ── guild.trace_event.v2 additive fields (D-OBS-1; OPTIONAL, absence valid) ──
 *   "span_id":        "<sha256(run_id|event|ts|actor_id)[0:16] — D-OBS-6>",
 *   "parent_span_id": "<GUILD_PARENT_SPAN_ID env, when threaded>",
 *   "tier":           "<GUILD_TIER env: cheap|mid|powerful>",
 *   "model":          "<GUILD_MODEL env > payload.model>",
 *   "tokens":         { "input", "output", "cached", "cost_usd" } // LLM-call events only,
 *   "payload_ref":    "logs/payloads/<span_id>.json — guild.trace_payload.v1 sidecar (D-OBS-2)"
 * }
 *
 * Payload sidecar (D-OBS-2): a redacted structured body is written to
 * <runDir>/logs/payloads/<span_id>.json (schema guild.trace_payload.v1) via the
 * secrets gatekeeper. Raw provider prompts are NEVER stored — only the scrubbed
 * structured body. payload_ref on the event points at the sidecar. Sidecars are
 * size-capped (SIDECAR_MAX_BYTES) and share events.ndjson's retention story.
 *
 * Run-id resolution (priority order):
 *   1. GUILD_RUN_ID env var (set by tests or orchestrator)
 *   2. .guild/runs/current-run-id sentinel file (written by scripts/new-run-id.ts)
 *   3. stdin payload session_id field
 *   4. fallback: "run-session-<date>"
 *
 * Working directory resolution (priority order):
 *   1. GUILD_CWD env var (set by tests)
 *   2. stdin payload cwd field
 *   3. process.cwd()
 *
 * Stdin:   JSON — Claude Code hook payload (PostToolUse / SubagentStop / UserPromptSubmit).
 * Stdout:  Silent — Claude Code may consume stdout.
 * Stderr:  Error messages on failure (telemetry failures must not block tool execution).
 * Exit:    Always 0 — telemetry failures must not block tool execution.
 *
 * Runner:  npx -y tsx hooks/capture-telemetry.ts
 *
 * Retention: events.ndjson is append-only and grows unbounded. Consuming repos
 * should periodically archive/rotate `.guild/runs/<run-id>/events.ndjson` files
 * (the P5 audit flags this for a future retention/rotation policy). For now,
 * manual cleanup via `find .guild/runs -name events.ndjson -mtime +30` is a
 * reasonable default.
 *
 * Manual smoke test:
 *   mkdir -p /tmp/guild-smoke/.guild/runs/test-run
 *   cat hooks/fixtures/post-tool-use.json | \
 *     (cd /tmp/guild-smoke && GUILD_RUN_ID=test-run npx -y tsx /path/to/hooks/capture-telemetry.ts)
 *   cat /tmp/guild-smoke/.guild/runs/test-run/events.ndjson
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { resolveGuildRoot } from "./lib/guild-root.js";

// ── v2 security ADR (D-SECRETS): scrub the one raw free-text field that lands
// in telemetry (the UserPromptSubmit prompt) through the built-in redaction +
// the operator's secrets_policy.redaction_patterns, honoring fail_mode_telemetry.
// Schema/settings bound BY POINTER — see lib/security/* headers.
import { readSecurityConfig } from "./lib/security/config.js";
import { applySecretsPolicy, resolveTelemetryField } from "./lib/security/secrets.js";
import { appendSecurityEvent, buildSecurityEvent, resolveRunDir } from "./lib/security/events.js";

// ── v2 observability ADR (D-OBS-1/2/6): guild.trace_event.v2 additive fields,
// deterministic hook-side span ids, and the redacted guild.trace_payload.v1
// sidecar. Schema/contracts bound BY POINTER — see lib/trace-v2.ts header
// (docs/knowledge/decisions/v2-observability-and-replay.md + contract-map §B-post).
import {
  genSpanId,
  isLlmCallEvent,
  normalizeTokens,
  pruneUndefined,
  resolveTraceV2Fields,
  writePayloadSidecar,
  type TraceTokens,
} from "./lib/trace-v2.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface HookPayload {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: { success?: boolean; error?: string } | unknown;
  agent_name?: string;
  stop_reason?: string;
  duration_ms?: number;
  prompt?: string;
  model?: string;
  // loop_round fields — emitted by loop skill scripts via emit-loop-event.ts
  loop_layer?: string;
  loop_round?: number;
  loop_gate?: string;
  loop_terminated?: boolean;
  // D-OBS-1: provider token/usage object, present on LLM-call events only.
  tokens?: unknown;
  usage?: unknown;
}

interface TelemetryEvent {
  ts: string;
  event: string;
  tool: string;
  specialist: string;
  payload_digest: string;
  ok: boolean;
  ms: number;
  model?: string;
  prompt?: string;
  // loop_round_start / loop_round_end extra fields
  loop_layer?: string;
  loop_round?: number;
  loop_gate?: string;
  loop_terminated?: boolean;
  // ── guild.trace_event.v2 additive fields (D-OBS-1; optional, absence valid) ──
  span_id?: string;
  parent_span_id?: string;
  tier?: string;
  tokens?: TraceTokens;
  payload_ref?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Short deterministic digest of an arbitrary value (first 12 hex chars of sha256). */
function digest(value: unknown): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return crypto.createHash("sha256").update(str).digest("hex").slice(0, 12);
}

/**
 * Determine if the tool response signals an error.
 * Treats explicit success:false or presence of error field as not-ok.
 */
function isOk(payload: HookPayload): boolean {
  const resp = payload.tool_response;
  if (resp === null || resp === undefined) return true;
  if (typeof resp === "object") {
    const r = resp as Record<string, unknown>;
    if (r["success"] === false) return false;
    if (typeof r["error"] === "string" && r["error"].length > 0) return false;
  }
  return true;
}

/** Read all stdin into a string. */
async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c: Buffer) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}

function readCurrentRunId(cwd: string): string | undefined {
  const sentinelPath = path.join(resolveGuildRoot(cwd), ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveRunId(cwd: string, payload: HookPayload): string {
  const envRunId = process.env["GUILD_RUN_ID"];
  if (typeof envRunId === "string" && envRunId.length > 0) return envRunId;
  const currentRunId = readCurrentRunId(cwd);
  if (currentRunId !== undefined) return currentRunId;
  return payload.session_id
    ? `run-${payload.session_id}`
    : `run-session-${new Date().toISOString().slice(0, 10)}`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const raw = await readStdin();

  let payload: HookPayload = {};
  try {
    payload = JSON.parse(raw.trim()) as HookPayload;
  } catch {
    // Invalid JSON — log to stderr and exit 0 (must not block)
    process.stderr.write("[capture-telemetry] WARN: invalid JSON on stdin; skipping.\n");
    process.exit(0);
  }

  // Resolve run context.
  // Priority order: GUILD_RUN_ID env → current-run-id sentinel → run-<session_id> → date fallback.
  // The sentinel file is written by scripts/lib/run-lifecycle.ts (startRun) at the start of each
  // /guild invocation, allowing multiple /guild runs within one Claude session to produce distinct
  // run directories.
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const runId = resolveRunId(cwd, payload);

  // Build event
  const eventName = payload.hook_event_name ?? "PostToolUse";
  const tool =
    eventName === "SubagentStop" || eventName === "UserPromptSubmit"
      ? ""
      : (payload.tool_name ?? "");
  const specialist = payload.agent_name ?? "";
  const payloadDigest = digest(
    payload.tool_input ?? payload.stop_reason ?? payload.prompt ?? ""
  );
  const ok = isOk(payload);
  const ms = typeof payload.duration_ms === "number" ? payload.duration_ms : 0;
  // Single ts shared by the event line, its span_id, and the sidecar so they
  // all join deterministically (D-OBS-6 span = sha256(run|event|ts|actor)).
  const ts = new Date().toISOString();
  const actorId = specialist || "main";

  const event: TelemetryEvent = {
    ts,
    event: eventName,
    tool,
    specialist,
    payload_digest: payloadDigest,
    ok,
    ms,
  };
  // `model` is resolved below via the v2 helper (GUILD_MODEL env > payload.model).
  // The secrets gatekeeper is read once and reused by the prompt scrub (below)
  // and the v2 payload-sidecar redactor (D-OBS-2).
  const secPolicy = readSecurityConfig(cwd).secrets_policy;
  if (eventName === "UserPromptSubmit" && typeof payload.prompt === "string") {
    // D-SECRETS: never write a raw prompt. Built-in redaction always runs;
    // secrets_policy.redaction_patterns layer on top; fail_mode_telemetry
    // decides what happens if a custom pattern fails to compile/apply.
    const scrub = applySecretsPolicy(payload.prompt, secPolicy);
    const resolved = resolveTelemetryField(scrub, secPolicy);
    if (resolved.value !== undefined) event.prompt = resolved.value;
    if (resolved.warn) {
      process.stderr.write(
        `[capture-telemetry] WARN: secrets_policy redaction_patterns failure on prompt (fail_mode_telemetry=${secPolicy.fail_mode_telemetry}): ${scrub.failures.join("; ")}\n`,
      );
      try {
        const evRunDir = process.env["GUILD_RUN_DIR"] ?? resolveRunDir(cwd, runId);
        appendSecurityEvent(
          evRunDir,
          buildSecurityEvent({
            run_id: runId,
            event_type: "secret_scrub_failure",
            decision: secPolicy.fail_mode_telemetry === "closed" ? "deny" : "allow",
            tool: "",
            detail: `secrets_policy redaction_patterns failed on telemetry prompt: ${scrub.failures.join("; ")}`,
          }),
        );
      } catch {
        /* telemetry must never block */
      }
    }
  }
  // loop_round_start / loop_round_end extra fields
  if (eventName === "loop_round_start" || eventName === "loop_round_end") {
    if (typeof payload.loop_layer === "string") event.loop_layer = payload.loop_layer;
    if (typeof payload.loop_round === "number") event.loop_round = payload.loop_round;
    if (typeof payload.loop_gate === "string") event.loop_gate = payload.loop_gate;
    if (typeof payload.loop_terminated === "boolean") event.loop_terminated = payload.loop_terminated;
  }

  // ── guild.trace_event.v2 + payload sidecar (D-OBS-1/2/6) ────────────────────
  // Additive: the frozen v1 fields above are untouched; everything here is
  // optional. Compose with the secrets gatekeeper — never store a raw prompt.
  const runsDir = path.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const redact = (s: string): string => applySecretsPolicy(s, secPolicy).value;
  const spanId = genSpanId(runId, eventName, ts, actorId);

  // Build the structured, redactable sidecar body from the payload. The prompt,
  // if any, is the ALREADY-scrubbed value (event.prompt) — never the raw text.
  const body: Record<string, unknown> = {};
  if (tool) body["tool"] = tool;
  if (payload.tool_input !== undefined) body["tool_input"] = payload.tool_input;
  if (payload.tool_response !== undefined) body["tool_response"] = payload.tool_response;
  if (typeof payload.stop_reason === "string") body["stop_reason"] = payload.stop_reason;
  if (specialist) body["agent_name"] = specialist;
  if (typeof event.prompt === "string") body["prompt"] = event.prompt;
  if (typeof event.loop_layer === "string") body["loop_layer"] = event.loop_layer;
  if (typeof event.loop_gate === "string") body["loop_gate"] = event.loop_gate;

  let payloadRef: string | undefined;
  if (Object.keys(body).length > 0) {
    payloadRef = writePayloadSidecar(
      runsDir,
      spanId,
      {
        runId,
        spanId,
        eventType: eventName,
        ts,
        actorId,
        parentSpanId: process.env["GUILD_PARENT_SPAN_ID"] || undefined,
        body,
      },
      redact,
    );
  }

  // tokens — D-OBS-1: only on LLM-call events, sourced from payload usage.
  const tokens: TraceTokens | undefined = isLlmCallEvent(eventName)
    ? normalizeTokens(payload.tokens ?? payload.usage)
    : undefined;

  Object.assign(
    event,
    pruneUndefined(
      resolveTraceV2Fields({
        runId,
        eventType: eventName,
        ts,
        actorId,
        payloadModel: payload.model,
        tokens,
        payloadRef,
      }),
    ),
  );

  // Write to .guild/runs/<run-id>/events.ndjson
  const eventsFile = path.join(runsDir, "events.ndjson");

  try {
    fs.mkdirSync(runsDir, { recursive: true });
    fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `[capture-telemetry] ERROR: failed to write event: ${
        err instanceof Error ? err.message : String(err)
      }\n`
    );
    // Still exit 0 — telemetry failures must not block tool execution
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[capture-telemetry] FATAL: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(0); // Exit 0 always
});
