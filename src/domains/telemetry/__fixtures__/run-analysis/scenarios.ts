/**
 * Golden fixture scenarios for run-analysis (B02). Hand-authored rows and
 * sidecars test the analyzer as a CONSUMER only; they never establish
 * production emitter coverage (C-DETECTORS coverage_gate rule 1).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export const TS = (seconds: number): string => new Date(Date.UTC(2026, 7, 12, 1, 0, 0) + seconds).toISOString();

export function sha(text: string): string {
  return `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`;
}

export interface SeedOptions {
  withConfig?: boolean;
  events?: Array<Record<string, unknown>>;
  scope?: "initiative" | "independent";
  initiative?: string;
  group?: string;
  provenance?: Record<string, unknown>;
}

export function defaultEvents(runId: string): Array<Record<string, unknown>> {
  return [
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:00Z", run_id: runId, lane_id: "", event_class: "prompt_received", actor_type: "lead", actor_id: "main", status: "ok", span_id: "prompt-1", prompt_hash: "hash-1", redaction: "omitted" },
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:01Z", run_id: runId, lane_id: "lane-a", event_class: "agent_dispatched", actor_type: "agent", actor_id: "tooling", task_id: "T1", span_id: "agent-1", status: "ok" },
    { ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "ok", latency_ms: 10, result_excerpt_redacted: "ok", tokens_in: 10, tokens_out: 5 },
    { ts: "2026-08-12T01:00:03.000Z", event: "phase_start", run_id: runId, phase: "execute" },
    { ts: "2026-08-12T01:00:04.000Z", event: "loop_round_start", run_id: runId, lane_id: "lane-a", loop_layer: "L3", round_number: 1, cap: 3 },
    { ts: "2026-08-12T01:00:05.000Z", event: "gate_decision", run_id: runId, gate: "gate-3-plan", decision: "approved", source: "user" },
    { schema_version: "guild.trace_event.v1", event_id: "evt-close", event_name: "run_closed", run_id: runId, at: "2026-08-12T01:00:06Z" },
  ];
}

export function seedRun(root: string, runId: string, opts: SeedOptions = {}): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  const scope = opts.scope ?? "initiative";
  fs.writeFileSync(path.join(runDir, "run.yaml"), [
    "schema_version: guild.run.v1",
    `run_id: ${runId}`,
    "command: /guild:build",
    `run_scope: ${scope}`,
    `initiative_attachment: ${scope === "initiative" ? opts.initiative ?? "alpha" : "null"}`,
    `independent_run_group: ${scope === "independent" ? opts.group ?? "research" : "null"}`,
    `config_snapshot_ref: ${opts.withConfig === false ? "null" : "plugin-config-snapshot.json"}`,
    "run_class: full",
    "status: closed",
    "host:",
    "  requested: auto",
    "  resolved: codex",
    "phase: ops",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(runDir, "provenance.json"),
    JSON.stringify({ schema_version: "guild.provenance.v1", run_id: runId, status: "closed", ...opts.provenance }) + "\n");
  if (opts.withConfig !== false) {
    fs.writeFileSync(path.join(runDir, "plugin-config-snapshot.json"), JSON.stringify({
      schema_version: "guild.plugin_config_snapshot.v1", run_id: runId, effective: {}, config_source_layers: {},
      plugin: { version: "2.6.0", ref: "sha256:plugin" },
      host_adapter: { requested: "auto", resolved: "codex", capabilities_ref: null },
      registry_hashes: { skills: null, agents: null },
      command_surface_version: "sha256:commands",
      redaction_policy: "scrubbed-config-v1",
      environment_capabilities: {},
    }) + "\n");
  }
  const events = opts.events ?? defaultEvents(runId);
  fs.writeFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return runDir;
}

/** A schema-valid guild.trace.analysis.v2 row. */
export function v2(runId: string, eventClass: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "guild.trace.analysis.v2", ts: TS(10_000), run_id: runId, lane_id: "lane-a",
    event_class: eventClass, actor_type: "agent", actor_id: "tooling", status: "ok", ...fields,
  };
}

/** Append rows; returns their evidence refs in order. */
export function appendRows(root: string, runId: string, rows: Array<Record<string, unknown>>): string[] {
  const log = path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
  const existing = fs.readFileSync(log, "utf8").split("\n").filter((line, index, all) => index < all.length - 1 || line !== "").length;
  fs.appendFileSync(log, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return rows.map((_, index) => `.guild/runs/${runId}/logs/v1.4-events.jsonl#line:${existing + index + 1}`);
}

export function writeRunFile(root: string, runId: string, relative: string, content: unknown): string {
  const file = path.join(root, ".guild", "runs", runId, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
  return `.guild/runs/${runId}/${relative}`;
}

export const ASSESSED_INPUT = "frozen task/code input set v1\n";

export interface Declaration {
  instructions?: Array<{ instruction_id: string; requirement_hash: string }>;
  complete?: boolean;
  clarify?: string[];
  phases?: string[];
}

/** Frozen declaration sidecar carried by implementation_authorized. */
export function declare(root: string, runId: string, decl: Declaration = {}): { assessedHash: string; ref: string } {
  writeRunFile(root, runId, "inputs/assessed.txt", ASSESSED_INPUT);
  const assessedHash = sha(ASSESSED_INPUT);
  const ref = writeRunFile(root, runId, "sidecars/declaration.json", {
    schema_version: "guild.analysis_declaration.v1", run_id: runId,
    assessed_input_hash: assessedHash, assessed_input_ref: "inputs/assessed.txt",
    instructions: decl.instructions ?? [], instructions_complete: decl.complete ?? true,
    clarification_required_tasks: decl.clarify ?? [], required_phases: decl.phases ?? [],
  });
  appendRows(root, runId, [v2(runId, "implementation_authorized", { actor_type: "lead", actor_id: "main", span_id: "auth-1", signature: "auth:plan", payload_ref: "sidecars/declaration.json" })]);
  return { assessedHash, ref };
}

export const REQ = (id: string): string => sha(`requirement:${id}`);

let proofCounter = 0;
/** Gate verifier row plus a guild.instruction_evidence.v1 proof referencing it. */
export function prove(root: string, runId: string, opts: {
  id: string; result: "passed" | "failed" | "unobservable"; verifierStatus: "ok" | "error" | "unknown";
  inputHash?: string; verifierRef?: string; evidenceRefs?: string[]; span?: string; verificationInputRef?: string;
}): { gateRef: string; proofRef: string } {
  const n = ++proofCounter;
  const relative = `sidecars/proof-${opts.id}-${n}.json`;
  const [gateRef] = appendRows(root, runId, [v2(runId, "gate_concluded", {
    actor_type: "lead", actor_id: "main", status: opts.verifierStatus, span_id: opts.span ?? `gate-${opts.id}-${n}`, signature: `gate:${opts.id}`, payload_ref: relative,
  })]);
  const proofRef = writeRunFile(root, runId, relative, {
    schema_version: "guild.instruction_evidence.v1", run_id: runId, instruction_id: opts.id, requirement_hash: REQ(opts.id),
    verifier_kind: "done_when", verifier_ref: opts.verifierRef ?? gateRef, result: opts.result,
    verified_input_hash: opts.inputHash ?? sha(ASSESSED_INPUT), verification_input_ref: opts.verificationInputRef ?? "inputs/assessed.txt",
    evidence_refs: opts.evidenceRefs ?? [gateRef],
  });
  return { gateRef, proofRef };
}

/** Frozen graph cursor (guild.phase_cursor.v1) carried by an analysis.v2 run_closed row. */
export function phaseCursor(root: string, runId: string, visited: string[], bypassed: string[] = []): string {
  const ref = writeRunFile(root, runId, "sidecars/cursor.json", { schema_version: "guild.phase_cursor.v1", run_id: runId, visited_phases: visited, bypassed_phases: bypassed });
  appendRows(root, runId, [v2(runId, "run_closed", { actor_type: "lead", actor_id: "main", span_id: "close-cursor", run_scope: "initiative", payload_ref: "sidecars/cursor.json" })]);
  return ref;
}

/** Non-final cursor: carried by `carrier` (phase_concluded or an earlier run_closed), then a later cursor-less run_closed. */
export function staleCursor(root: string, runId: string, visited: string[], carrier: "phase_concluded" | "run_closed"): string {
  const ref = writeRunFile(root, runId, "sidecars/cursor.json", { schema_version: "guild.phase_cursor.v1", run_id: runId, visited_phases: visited, bypassed_phases: [] });
  appendRows(root, runId, [
    v2(runId, carrier, carrier === "run_closed"
      ? { actor_type: "lead", actor_id: "main", span_id: "close-stale", run_scope: "initiative", payload_ref: "sidecars/cursor.json" }
      : { actor_type: "lead", actor_id: "main", span_id: "ph-stale", phase: visited[visited.length - 1], payload_ref: "sidecars/cursor.json" }),
    v2(runId, "run_closed", { actor_type: "lead", actor_id: "main", span_id: "close-final", run_scope: "initiative" }),
  ]);
  return ref;
}

export function failedTool(runId: string, span: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return v2(runId, "tool_call_failed", { actor_type: "tool", actor_id: "Bash", status: "error", span_id: span, duration_ms: 5, ...fields });
}

export function capabilityEvidence(root: string, runId: string, relative: string, fields: Record<string, unknown>): string {
  return writeRunFile(root, runId, relative, {
    schema_version: "guild.capability_evidence.v1", run_id: runId, evidence_refs: [`.guild/runs/${runId}/run.yaml`], ...fields,
  });
}

/** Events for a usage cohort run: one Agent response carrying explicit tokens and cost. */
export function usageEvents(runId: string, cost: number): Array<Record<string, unknown>> {
  return [
    ...defaultEvents(runId).map((event) => event["event"] === "tool_call" ? { ...event, tokens_in: undefined, tokens_out: undefined } : event)
      .map((event) => JSON.parse(JSON.stringify(event)) as Record<string, unknown>),
    v2(runId, "agent_response_received", { span_id: "resp-1", tokens: { input: 100, output: 20, cached: 0, cost_usd: cost } }),
  ];
}

/** Project the v1 core so a baseline can be compared across analyzer versions (drops path-bound ids). */
export function coreProjection(analysis: {
  eligible: boolean; identity: unknown; completeness: unknown; assessments: unknown;
  usage: { llm_event_count: number; specialists_dispatched: string[]; tokens: unknown; duration_ms: number };
  findings: Array<{ kind: string; severity: string; summary: string; evidence_refs: string[]; signature: string }>;
  recommendations: Array<{ scope: string; kind: string; confidence: string; severity: string; evidence_refs: string[]; proposed_action: string; status: string; routing: unknown }>;
}): Record<string, unknown> {
  return {
    eligible: analysis.eligible,
    identity: analysis.identity,
    completeness: analysis.completeness,
    assessments: analysis.assessments,
    usage: { llm_event_count: analysis.usage.llm_event_count, specialists_dispatched: analysis.usage.specialists_dispatched, tokens: analysis.usage.tokens, duration_ms: analysis.usage.duration_ms },
    findings: analysis.findings.map(({ kind, severity, summary, evidence_refs, signature }) => ({ kind, severity, summary, evidence_refs, signature }))
      .sort((a, b) => `${a.kind}|${a.signature}`.localeCompare(`${b.kind}|${b.signature}`)),
    recommendations: analysis.recommendations.map(({ scope, kind, confidence, severity, evidence_refs, proposed_action, status, routing }) =>
      ({ scope, kind, confidence, severity, evidence_refs, proposed_action, status, routing }))
      .sort((a, b) => `${a.kind}|${a.evidence_refs.join(",")}`.localeCompare(`${b.kind}|${b.evidence_refs.join(",")}`)),
  };
}

export const BASELINE_RUN = "run-20260812-010000-alpha";

/** v1 baseline scenarios. Each mutates a freshly seeded BASELINE_RUN. */
export const V1_BASELINE_SCENARIOS: Readonly<Record<string, (root: string, runId: string) => void>> = Object.freeze({
  "v1-default-complete-run": (root, runId) => { seedRun(root, runId); },
  "v1-missing-config-snapshot": (root, runId) => { seedRun(root, runId, { withConfig: false }); },
  "v1-malformed-trace-line": (root, runId) => {
    seedRun(root, runId);
    fs.appendFileSync(path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl"), "{bad json\n");
  },
  "v1-independent-scope": (root, runId) => { seedRun(root, runId, { scope: "independent" }); },
  "v1-single-legacy-failure": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [{ ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 }]);
  },
  "v1-two-legacy-failures": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [7, 8].map((second) => ({ ts: `2026-08-12T01:00:0${second}.000Z`, event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 })));
  },
  "v1-two-typed-signed-failures": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [failedTool(runId, "f-1", { signature: "tool:Bash:abc" }), failedTool(runId, "f-2", { signature: "tool:Bash:abc" })]);
  },
  "v1-one-steering": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [v2(runId, "user_steering_received", { actor_type: "user", actor_id: "operator", span_id: "steer-1", signature: "user-steering" })]);
  },
  "v1-two-steering": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [1, 2].map((index) => v2(runId, "user_steering_received", { actor_type: "user", actor_id: "operator", span_id: `steer-${index}`, signature: "user-steering" })));
  },
  "v1-loop-cap-hit": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [v2(runId, "loop_cap_hit", { span_id: "loop-1", signature: "loop:L3" })]);
  },
  "v1-instruction-violation": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [v2(runId, "instruction_violation_detected", { span_id: "viol-1", signature: "instruction:no-push" })]);
  },
  "v1-span-twin-usage": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [
      { ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Agent", command_redacted: "dispatch tooling", result_excerpt_redacted: "ok", status: "ok", span_id: "same-span", latency_ms: 20, tokens_in: 7, tokens_out: 3 },
      v2(runId, "tool_call_finished", { actor_type: "tool", actor_id: "Agent", span_id: "same-span", duration_ms: 20, tokens: { input: 7, output: 3 } }),
    ]);
  },
  // Intentional B02 changes (recorded with their pre-B02 output in v1-baseline.json):
  "v1-policy-denial": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [v2(runId, "tool_call_denied", { actor_type: "tool", actor_id: "Bash", status: "denied", span_id: "deny-1", signature: "policy:Bash" })]);
  },
  "v1-signatureless-semantic-failures": (root, runId) => {
    seedRun(root, runId);
    appendRows(root, runId, [failedTool(runId, "f-1"), failedTool(runId, "f-2")]);
  },
});
