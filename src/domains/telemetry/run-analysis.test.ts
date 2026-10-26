import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as crypto from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { analyzeRun, compareRuns, resolveComparisonTarget, routeRecommendation, decideRecommendation, updateRecommendationStatus, writeRunComparison, writeRunAnalysis, withRecommendationLock, loadOrAnalyzeRun, inspectAnalysisArtifact, type RunAnalysis } from ".";
// Internal-only names (off the index since the C06E orphan trim): import the module.
import { DETECTOR_IDS, type DetectorId } from "./run-analysis";
import {
  ASSESSED_INPUT, BASELINE_RUN, REQ, TS, V1_BASELINE_SCENARIOS, appendRows, capabilityEvidence, coreProjection, declare,
  defaultEvents, failedTool, phaseCursor, prove, staleCursor, seedRun as seedGoldenRun, sha, usageEvents, v2, writeRunFile,
} from "./__fixtures__/run-analysis/scenarios";
import V1_BASELINE from "./__fixtures__/run-analysis/v1-baseline.json";

const RUN_A = "run-20260812-010000-alpha";
const RUN_B = "run-20260812-020000-beta";

function recommendationEnvelope(
  sourceId: string,
  scope: "plugin" | "project",
  kind: string,
  evidenceRefs: string[],
): { schema_version: "guild.recommendation.v1"; source_id: string; evidence_signature: string } {
  return {
    schema_version: "guild.recommendation.v1",
    source_id: sourceId,
    evidence_signature: crypto.createHash("sha256").update([scope, kind, ...[...evidenceRefs].sort()].join("\n")).digest("hex"),
  };
}

function seedRun(
  root: string,
  runId: string,
  opts: {
    withConfig?: boolean;
    events?: Array<Record<string, unknown>>;
    scope?: "initiative" | "independent";
    omitRunClass?: boolean;
  } = {},
): string {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  const scope = opts.scope ?? "initiative";
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    [
      "schema_version: guild.run.v1",
      `run_id: ${runId}`,
      "command: /guild:build",
      `run_scope: ${scope}`,
      `initiative_attachment: ${scope === "initiative" ? "alpha" : "null"}`,
      `independent_run_group: ${scope === "independent" ? "research" : "null"}`,
      "entry_prompt_ref: logs/payloads/entry.json",
      `config_snapshot_ref: ${opts.withConfig === false ? "null" : "plugin-config-snapshot.json"}`,
      ...(opts.omitRunClass ? [] : ["run_class: full"]),
      "status: closed",
      "started_at: 2026-08-12T01:00:00Z",
      "host:",
      "  requested: auto",
      "  resolved: codex",
      "workspace:",
      "  is_workspace: true",
      `  root: ${root}`,
      "phase: ops",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runDir, "provenance.json"),
    JSON.stringify({ schema_version: "guild.provenance.v1", run_id: runId, status: "closed" }) + "\n",
    "utf8",
  );
  if (opts.withConfig !== false) {
    fs.writeFileSync(
      path.join(runDir, "plugin-config-snapshot.json"),
      JSON.stringify({
        schema_version: "guild.plugin_config_snapshot.v1", run_id: runId, effective: {}, config_source_layers: {},
        plugin: { version: "2.6.0", ref: "sha256:plugin" },
        host_adapter: { requested: "auto", resolved: "codex", capabilities_ref: null },
        registry_hashes: { skills: null, agents: null },
        command_surface_version: "sha256:commands",
        redaction_policy: "scrubbed-config-v1",
        environment_capabilities: {},
      }) + "\n",
      "utf8",
    );
  }
  const events = opts.events ?? [
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:00Z", run_id: runId, lane_id: "", event_class: "prompt_received", actor_type: "lead", actor_id: "main", status: "ok", span_id: "prompt-1", prompt_hash: "hash-1", redaction: "omitted" },
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:01Z", run_id: runId, lane_id: "lane-a", event_class: "agent_dispatched", actor_type: "agent", actor_id: "tooling", task_id: "T1", span_id: "agent-1", status: "ok" },
    { ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "ok", latency_ms: 10, result_excerpt_redacted: "ok", tokens_in: 10, tokens_out: 5 },
    { ts: "2026-08-12T01:00:03.000Z", event: "phase_start", run_id: runId, phase: "execute" },
    { ts: "2026-08-12T01:00:04.000Z", event: "loop_round_start", run_id: runId, lane_id: "lane-a", loop_layer: "L3", round_number: 1, cap: 3 },
    { ts: "2026-08-12T01:00:05.000Z", event: "gate_decision", run_id: runId, gate: "gate-3-plan", decision: "approved", source: "user" },
    { schema_version: "guild.trace_event.v1", event_id: "evt-close", event_name: "run_closed", run_id: runId, at: "2026-08-12T01:00:06Z" },
  ];
  fs.writeFileSync(
    path.join(runDir, "logs", "v1.4-events.jsonl"),
    events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    "utf8",
  );
  return runDir;
}

function appendRepeatedFailure(root: string, runId: string): void {
  fs.appendFileSync(path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl"), [
    { ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
    { ts: "2026-08-12T01:00:08.000Z", event: "tool_call", run_id: runId, lane_id: "lane-a", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
  ].map((event) => JSON.stringify(event)).join("\n") + "\n");
}

describe("run-tracing-evaluation — plugin-owned analysis", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-"));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("fails full-run analysis eligibility when the frozen config snapshot is missing", () => {
    seedRun(root, RUN_A, { withConfig: false });
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("plugin-config-snapshot.json");
    expect(analysis.assessments.instruction_following.status).toBe("unobservable");
  });

  it("rejects malformed and wrong-run config snapshots instead of counting file existence", () => {
    const dir = seedRun(root, RUN_A);
    const snapshot = path.join(dir, "plugin-config-snapshot.json");
    fs.writeFileSync(snapshot, "not json\n");
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
    fs.writeFileSync(snapshot, JSON.stringify({ schema_version: "guild.plugin_config_snapshot.v1", run_id: RUN_B, effective: {}, config_source_layers: {} }));
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("rejects incomplete plugin identity snapshots instead of granting full-run eligibility", () => {
    const dir = seedRun(root, RUN_A);
    fs.writeFileSync(path.join(dir, "plugin-config-snapshot.json"), JSON.stringify({
      schema_version: "guild.plugin_config_snapshot.v1", run_id: RUN_A, effective: {}, config_source_layers: {},
    }));
    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("infers migration-safe initiative scope for old runs with only initiative_attachment", () => {
    const dir = seedRun(root, RUN_A);
    const file = path.join(dir, "run.yaml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("run_scope: initiative\n", "").replace("independent_run_group: null\n", ""));
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.identity.run_scope).toBe("initiative");
    expect(analysis.identity.initiative_id).toBe("alpha");
    expect(analysis.eligible).toBe(true);
  });

  it("treats historical manifests without run_class as full runs", () => {
    seedRun(root, RUN_A, { withConfig: false, omitRunClass: true });
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("plugin-config-snapshot.json");
  });

  it("reports malformed trace lines as incomplete evidence", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), "{bad json\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.completeness.missing).toContain("trace parseability");
    expect(analysis.findings.some((item) => item.kind === "telemetry_gap")).toBe(true);
  });

  it("produces evidence-bound deterministic findings and non-zero usage", () => {
    const repeated = [
      { ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "err", latency_ms: 10, result_excerpt_redacted: "same failure", tokens_in: 12, tokens_out: 3 },
      { ts: "2026-08-12T01:00:03.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", status: "err", latency_ms: 11, result_excerpt_redacted: "same failure", tokens_in: 11, tokens_out: 4 },
    ];
    const baseDir = seedRun(root, RUN_A);
    const log = path.join(baseDir, "logs", "v1.4-events.jsonl");
    fs.appendFileSync(log, repeated.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const first = analyzeRun(root, RUN_A);
    const second = analyzeRun(root, RUN_A);
    expect(first).toEqual(second);
    expect(first.eligible).toBe(true);
    expect(first.usage.llm_event_count).toBeGreaterThan(0);
    expect(first.usage.tokens.total).toBeGreaterThan(0);
    const finding = first.findings.find((item) => item.kind === "repeated_failure");
    expect(finding?.evidence_refs.length).toBeGreaterThanOrEqual(2);
    expect(first.recommendations.every((item) => item.evidence_refs.length > 0)).toBe(true);
    expect(first.recommendations.every((item) => item.routing.requires_user_approval)).toBe(true);
  });

  describe("G04 R4 — runaway repetition (decoder loop)", () => {
    const agentRow = (excerpt: string, status = "ok") => ({
      ts: "2026-08-12T01:00:02.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Agent",
      command_redacted: "dispatch backend", status, latency_ms: 10, result_excerpt_redacted: excerpt, tokens_in: 12, tokens_out: 3,
    });
    const plant = (rows: Record<string, unknown>[]) => {
      const dir = seedRun(root, RUN_A);
      fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
      return analyzeRun(root, RUN_A);
    };

    it("emits runaway_repetition when one agent output loops on a phrase, distinct from repeated_failure", () => {
      const loop = "Summary of the change. " + "I will now verify the result. ".repeat(40) + "Done.";
      const analysis = plant([agentRow(loop)]);
      const found = analysis.findings.filter((item) => item.kind === "runaway_repetition");
      expect(found).toHaveLength(1);
      expect(found[0].severity).toBe("high");
      expect(found[0].evidence_refs).toHaveLength(1);
      expect(found[0].signature.startsWith("runaway_repetition:Agent:")).toBe(true);
      expect(found[0].signature.slice("runaway_repetition:Agent:".length)).toMatch(/^[0-9a-f]{12}$/);
      expect(analysis.findings.some((item) => item.kind === "repeated_failure")).toBe(false);
      expect(analysis).toEqual(analyzeRun(root, RUN_A));
    });

    it("a short inner repeat does not hide a longer loop", () => {
      const analysis = plant([agentRow("aaaaaaaaaabcccccccccc ".repeat(10))]);
      expect(analysis.findings.some((item) => item.kind === "runaway_repetition")).toBe(true);
    });

    it("catches a single-token loop with no spaces", () => {
      const analysis = plant([agentRow("result: " + "的".repeat(300))]);
      expect(analysis.findings.some((item) => item.kind === "runaway_repetition")).toBe(true);
    });

    it("negative: ordinary prose, a long rule line and a short legit repeat raise no finding", () => {
      const prose = "The backend lane added the cache and its tests. Each test seeds a run, calls recall, and checks the order. ".repeat(3);
      const rule = "=".repeat(400);
      const shortRepeat = "ok ok ok ok ok";
      // 9 back-to-back copies of a 30-char phrase: one short of the repeat floor.
      const nineCopies = "I will now verify the result. ".repeat(9);
      const analysis = plant([agentRow(prose), agentRow(`${rule}\nTable done`), agentRow(shortRepeat), agentRow(nineCopies)]);
      expect(analysis.findings.some((item) => item.kind === "runaway_repetition")).toBe(false);
    });

    it("negative: repeated failures are repeated_failure, not runaway_repetition", () => {
      const analysis = plant([agentRow("same failure", "err"), agentRow("same failure", "err")]);
      expect(analysis.findings.some((item) => item.kind === "repeated_failure")).toBe(true);
      expect(analysis.findings.some((item) => item.kind === "runaway_repetition")).toBe(false);
    });
  });

  it("detects repeated user steering as prompt inefficiency without claiming satisfaction", () => {
    const dir = seedRun(root, RUN_A);
    const events = [1, 2].map((index) => ({
      schema_version: "guild.trace.analysis.v2",
      ts: `2026-08-12T01:00:0${index}Z`,
      run_id: RUN_A,
      lane_id: "",
      event_class: "user_steering_received",
      actor_type: "lead",
      actor_id: "main",
      status: "ok",
      prompt_hash: `sha256:${index}`,
      redaction: "omitted",
      span_id: `steer-${index}`,
      signature: "user-steering",
    }));
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.findings.some((item) => item.kind === "prompt_inefficiency")).toBe(true);
    expect(analysis.assessments.prompt_efficiency.status).toBe("ambiguous");
  });

  it("writes canonical analysis.md, analysis.json, and proposal-only recommendations", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const written = writeRunAnalysis(root, analysis);
    expect(fs.existsSync(written.json)).toBe(true);
    expect(fs.existsSync(written.markdown)).toBe(true);
    expect(fs.existsSync(written.recommendations)).toBe(true);
    expect(JSON.parse(fs.readFileSync(written.json, "utf8"))).toEqual(analysis);
    expect(fs.readFileSync(written.markdown, "utf8")).toContain("Evidence completeness");
  });

  it("refuses analysis output through a symlinked .guild/analysis directory", () => {
    seedRun(root, RUN_A);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-analysis-outside-"));
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".guild", "analysis"));
    expect(() => writeRunAnalysis(root, analyzeRun(root, RUN_A))).toThrow(/symlink|escapes/i);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("comparison is stable under run-order changes and clusters repeated evidence", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    const a = analyzeRun(root, RUN_A);
    const b = analyzeRun(root, RUN_B);
    expect(compareRuns([a, b])).toEqual(compareRuns([b, a]));
    expect(compareRuns([a, b]).run_ids).toEqual([RUN_A, RUN_B]);
  });

  it("excludes ineligible runs from cross-run finding clusters and recommendations", () => {
    seedRun(root, RUN_A, { withConfig: false });
    seedRun(root, RUN_B, { withConfig: false });
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    expect(comparison.completeness.eligible_runs).toBe(0);
    expect(comparison.repeated_signatures).toEqual([]);
    expect(comparison.recommendations).toEqual([]);
  });

  it("deduplicates legacy tool usage and its semantic twin by span_id", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      JSON.stringify({ ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: RUN_A, lane_id: "lane-a", tool: "Agent", command_redacted: "dispatch tooling", result_excerpt_redacted: "ok", status: "ok", span_id: "same-span", latency_ms: 20, tokens_in: 7, tokens_out: 3 }),
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:07Z", run_id: RUN_A, lane_id: "lane-a", event_class: "tool_call_finished", actor_type: "tool", actor_id: "Agent", status: "ok", span_id: "same-span", duration_ms: 20, tokens: { input: 7, output: 3 } }),
    ].join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.usage.tokens.total).toBe(25);
    expect(analysis.usage.duration_ms).toBe(30);
  });

  it("rejects invalid and cross-run trace rows from evidence and eligibility", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:08Z", run_id: RUN_B, lane_id: "", event_class: "prompt_received", actor_type: "user", actor_id: "foreign", status: "ok", span_id: "foreign", prompt_hash: "hash", redaction: "omitted" }),
      JSON.stringify({ schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:09Z", run_id: RUN_A, lane_id: "", event_class: "gate_concluded", actor_type: "system", actor_id: "bad", status: "ok" }),
    ].join("\n") + "\n");
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.usage.specialists_dispatched).not.toContain("foreign");
  });

  it("does not let a malformed legacy row supply missing phase evidence", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutPhase = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "phase_start");
    withoutPhase.push({ run_id: RUN_A, event: "phase_start" });
    fs.writeFileSync(log, withoutPhase.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("phase");
  });

  it("does not let a lifecycle row smuggle conflicting loop evidence", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutLoop = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "loop_round_start");
    withoutLoop.push({
      schema_version: "guild.trace_event.v1",
      event_id: "evt-smuggled-loop",
      event_name: "run_closed",
      run_id: RUN_A,
      at: "2026-08-12T01:00:06Z",
      ts: "2026-08-12T01:00:06.000Z",
      event: "loop_round_start",
      tool: "",
      specialist: "",
      payload_digest: "sha256:smuggled-loop",
      ok: true,
      ms: 0,
      loop_layer: "L1",
      loop_round: 1,
    });
    fs.writeFileSync(log, withoutLoop.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("loop");
  });

  it("does not let a typed trace row fall through to a conflicting legacy category", () => {
    const dir = seedRun(root, RUN_A);
    const log = path.join(dir, "logs", "v1.4-events.jsonl");
    const withoutLoop = fs.readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((event) => event["event"] !== "loop_round_start");
    withoutLoop.push({
      schema_version: "guild.trace.degradation.v1",
      ts: "2026-08-12T01:00:04Z",
      run_id: RUN_A,
      lane_id: "",
      surface: "hook",
      reason: "fallback",
      attempted: "native",
      fallback: "degraded",
      severity: "warn",
      event: "loop_round_start",
    });
    fs.writeFileSync(log, withoutLoop.map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
    expect(analysis.completeness.missing).toContain("loop");
  });

  it("does not let a non-string schema marker enter legacy categorization", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: 7,
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      run_id: RUN_A,
      lane_id: "lane-a",
      loop_layer: "L1",
      round_number: 1,
      cap: 5,
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("rejects a legacy degradation row whose payload kind does not match", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: "guild.trace_event.v1",
      event_type: "feature_degraded",
      kind: "feature_degraded",
      run_id: RUN_A,
      ts: "2026-08-12T01:00:07Z",
      degradation: {},
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("accepts schema-valid nullable fields through the typed trace validator", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      schema_version: "guild.trace.model_inspection.v1",
      ts: "2026-08-12T01:00:07Z",
      run_id: RUN_A,
      lane_id: "",
      host_family: "codex",
      host_surface: "cli",
      identity_trust: "verified",
      catalog_state: "absent",
      selection_model: null,
      actual_model: "unknown",
      independence: "none_written",
      unknowns_count: 1,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("accepts an owner-architect L-arch loop row and still refuses an unknown loop layer", () => {
    const relayer = (layer: string) => {
      const dir = seedRun(root, RUN_A);
      const log = path.join(dir, "logs", "v1.4-events.jsonl");
      const rows = fs.readFileSync(log, "utf8").split("\n").filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .map((event) => event["event"] === "loop_round_start" ? { ...event, loop_layer: layer } : event);
      fs.writeFileSync(log, rows.map((event) => JSON.stringify(event)).join("\n") + "\n");
      return analyzeRun(root, RUN_A);
    };
    expect(relayer("L-arch").completeness.missing).not.toContain("trace validity");
    expect(relayer("L-bogus").completeness.missing).toContain("trace validity");
  });

  it("counts valid-JSON non-object trace rows as invalid instead of silently dropping them", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), "[]\n42\nnull\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("accepts a valid run-file-scoped hook mirror without inventing a cross-run failure", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "UserPromptSubmit",
      tool: "",
      specialist: "",
      payload_digest: "sha256:prompt",
      ok: true,
      ms: 3,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("accepts the production loop and codex hook mirrors emitted by capture-telemetry", () => {
    const dir = seedRun(root, RUN_A);
    const common = { tool: "", specialist: "", ok: true, ms: 3 };
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      { ...common, ts: "2026-08-12T01:00:07.000Z", event: "loop_round_start", payload_digest: "sha256:loop-start", loop_layer: "L1", loop_round: 1, span_id: "hook-loop-start" },
      { ...common, ts: "2026-08-12T01:00:08.000Z", event: "loop_round_end", payload_digest: "sha256:loop-end", loop_layer: "L1", loop_round: 1, loop_terminated: true, span_id: "hook-loop-end" },
      { ...common, ts: "2026-08-12T01:00:09.000Z", event: "codex_review_round", payload_digest: "sha256:codex", loop_gate: "G-spec", loop_round: 1, loop_terminated: true, span_id: "hook-codex" },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(true);
  });

  it("rejects a malformed production loop hook mirror", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      tool: "",
      specialist: "",
      payload_digest: "sha256:loop",
      ok: true,
      ms: 3,
      loop_layer: "L1",
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("never treats a run-bound loop row as an implicit hook mirror", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      ts: "2026-08-12T01:00:07.000Z",
      event: "loop_round_start",
      run_id: RUN_A,
      tool: "",
      specialist: "",
      payload_digest: "sha256:discriminator",
      ok: true,
      ms: 3,
      loop_layer: "L1",
      loop_round: 1,
    }) + "\n");

    expect(analyzeRun(root, RUN_A).eligible).toBe(false);
  });

  it("deduplicates a hook mirror and its semantic twin by span_id", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), [
      { ts: "2026-08-12T01:00:07.000Z", event: "SubagentStop", tool: "", specialist: "tooling", payload_digest: "sha256:response", ok: true, ms: 20, span_id: "same-hook-span", tokens: { input: 7, output: 3 } },
      { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T01:00:07Z", run_id: RUN_A, lane_id: "lane-a", event_class: "agent_response_received", actor_type: "agent", actor_id: "tooling", status: "ok", span_id: "same-hook-span", duration_ms: 20, tokens: { input: 7, output: 3 } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.usage.tokens.total).toBe(25);
    expect(analysis.usage.duration_ms).toBe(30);
  });

  it("rejects a malformed hook mirror instead of trusting its event name", () => {
    const dir = seedRun(root, RUN_A);
    fs.appendFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), JSON.stringify({
      event: "UserPromptSubmit",
      prompt: "approve",
    }) + "\n");

    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.eligible).toBe(false);
    expect(analysis.completeness.missing).toContain("trace validity");
  });

  it("writes discoverable comparison artifacts and a stable comparison index", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    const written = writeRunComparison(root, comparison);
    expect(fs.existsSync(written.json)).toBe(true);
    expect(fs.existsSync(written.markdown)).toBe(true);
    expect(fs.existsSync(written.recommendations)).toBe(true);
    const index = JSON.parse(fs.readFileSync(written.index, "utf8"));
    expect(index.comparisons).toEqual([
      expect.objectContaining({ comparison_id: comparison.comparison_id, run_ids: [RUN_A, RUN_B] }),
    ]);
  });

  it("resolves initiative and independent-group targets from run manifests", () => {
    seedRun(root, RUN_A, { scope: "initiative" });
    seedRun(root, RUN_B, { scope: "independent" });
    expect(resolveComparisonTarget(root, { kind: "initiative", id: "alpha" }).map((item) => item.run_id)).toEqual([RUN_A]);
    expect(resolveComparisonTarget(root, { kind: "independent", id: "research" }).map((item) => item.run_id)).toEqual([RUN_B]);
  });

  it("does not let a corrupt unrelated run poison a targeted comparison", () => {
    seedRun(root, RUN_A, { scope: "initiative" });
    const corrupt = path.join(root, ".guild", "runs", "run-20260812-030000-corrupt");
    fs.mkdirSync(corrupt, { recursive: true });
    fs.writeFileSync(path.join(corrupt, "run.yaml"), "run_scope: [unterminated\n");
    expect(resolveComparisonTarget(root, { kind: "initiative", id: "alpha" }).map((item) => item.run_id)).toEqual([RUN_A]);
  });

  it("routes plugin recommendations behind approval and project recommendations to a proposal queue", () => {
    const base = {
      id: "rec-1",
      source_analysis_id: `analysis:${RUN_A}`,
      confidence: "high" as const,
      severity: "medium" as const,
      evidence_refs: [`.guild/runs/${RUN_A}/logs/v1.4-events.jsonl#line:1`],
      affected_runs: [RUN_A],
      status: "proposed" as const,
    };
    expect(routeRecommendation({ ...base, scope: "plugin", kind: "telemetry_gap", proposed_action: "add event" }).action).toBe("ask_user_before_filing");
    expect(routeRecommendation({ ...base, scope: "project", kind: "create_skill", proposed_action: "draft skill" }).action).toBe("queue_proposal_only");
  });

  it("writes only project-scoped recommendations to an idempotent proposal queue", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [
      {
        ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
        requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
      },
      {
        ...recommendationEnvelope(RUN_A, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-plugin", source_analysis_id: analysis.analysis_id, scope: "plugin", kind: "telemetry_gap",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a Guild issue.", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
        requires_user_approval: true, status: "proposed", routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      },
    ];
    writeRunAnalysis(root, analysis);
    writeRunAnalysis(root, analysis);
    const queue = fs.readFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(queue).toEqual([expect.objectContaining({ id: "rec-project", scope: "project", status: "proposed" })]);
  });

  it("preserves recorded decisions across regeneration and de-duplicates by evidence signature", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence),
      id: "rec-project-first", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    decideRecommendation(root, RUN_A, "rec-project-first", "accept");

    analysis.recommendations = [{ ...analysis.recommendations[0], id: "rec-project-regenerated", status: "proposed" }];
    const written = writeRunAnalysis(root, analysis);
    const queue = fs.readFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(queue).toEqual([expect.objectContaining({ id: "rec-project-regenerated", status: "queued" })]);
    expect(source).toEqual([expect.objectContaining({ id: "rec-project-regenerated", status: "queued" })]);
    expect(JSON.parse(fs.readFileSync(written.json, "utf8")).recommendations[0].status).toBe("queued");
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated", previous_recommendation_id: "rec-project-first", recommendation_id: "rec-project-regenerated",
    }));
  });

  it("audits a regenerated analysis identity for the same run and stable recommendation id", () => {
    seedRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    const first = analyzeRun(root, RUN_A);
    first.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-stable", source_analysis_id: first.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }, {
      ...recommendationEnvelope(RUN_A, "project", "update_workflow", [`.guild/runs/${RUN_A}/provenance.json`]), id: "rec-stable-two", source_analysis_id: first.analysis_id,
      scope: "project", kind: "update_workflow", confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/provenance.json`], affected_runs: [RUN_A],
      proposed_action: "Update a project workflow.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, first);
    decideRecommendation(root, RUN_A, "rec-stable", "accept");
    decideRecommendation(root, RUN_A, "rec-stable-two", "accept");

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:09.000Z", event: "phase_start", run_id: RUN_A, phase: "review" }) + "\n");
    const regenerated = analyzeRun(root, RUN_A);
    expect(regenerated.analysis_id).not.toBe(first.analysis_id);
    regenerated.recommendations = first.recommendations.map((item) => ({ ...item, source_analysis_id: regenerated.analysis_id, status: "proposed" }));
    writeRunAnalysis(root, regenerated);

    const source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rec-stable", source_analysis_id: regenerated.analysis_id, status: "queued" }),
      expect.objectContaining({ id: "rec-stable-two", source_analysis_id: regenerated.analysis_id, status: "queued" }),
    ]));
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated", source_id: RUN_A, source_analysis_id: regenerated.analysis_id,
      previous_source_id: RUN_A, previous_source_analysis_id: first.analysis_id,
    }));
  });

  it("carries progressed decisions when regeneration changes signature or removes the detector output", () => {
    seedRun(root, RUN_A);
    const first = analyzeRun(root, RUN_A);
    const oldEvidence = [`.guild/runs/${RUN_A}/run.yaml`];
    first.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", oldEvidence), id: "rec-durable", source_analysis_id: first.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: oldEvidence, affected_runs: [RUN_A],
      proposed_action: "Draft the durable skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, first);
    decideRecommendation(root, RUN_A, "rec-durable", "accept");

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:09.000Z", event: "phase_start", run_id: RUN_A, phase: "review" }) + "\n");
    const changed = analyzeRun(root, RUN_A);
    const newEvidence = [`.guild/runs/${RUN_A}/provenance.json`];
    changed.recommendations = [{
      ...first.recommendations[0],
      ...recommendationEnvelope(RUN_A, "project", "update_workflow", newEvidence),
      id: "rec-new-detector", source_analysis_id: changed.analysis_id, kind: "update_workflow",
      evidence_refs: newEvidence, proposed_action: "Update the newly detected workflow.", status: "proposed",
    }];
    writeRunAnalysis(root, changed);
    let source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "rec-durable", source_analysis_id: changed.analysis_id, status: "queued" }),
      expect.objectContaining({ id: "rec-new-detector", source_analysis_id: changed.analysis_id, status: "proposed" }),
    ]));

    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:10.000Z", event: "phase_end", run_id: RUN_A, phase: "review", outcome: "pass" }) + "\n");
    const disappeared = analyzeRun(root, RUN_A);
    disappeared.recommendations = [];
    writeRunAnalysis(root, disappeared);
    source = fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(source).toEqual([expect.objectContaining({
      id: "rec-durable", source_analysis_id: disappeared.analysis_id, status: "queued",
    })]);
    expect(() => writeRunAnalysis(root, disappeared)).not.toThrow();
  });

  it("fails closed on malformed or symlink-escaped recommendation sources", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const source = path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`);
    fs.writeFileSync(source, "{}\n");
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/schema_version|\.id must be one safe path component/);

    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rec-outside-"));
    const outside = path.join(outsideDir, "outside.jsonl");
    fs.writeFileSync(outside, JSON.stringify(analysis.recommendations[0]) + "\n");
    fs.unlinkSync(source);
    fs.symlinkSync(outside, source);
    try {
      expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/not a contained regular file/);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("records user decisions without auto-filing or mutating project capabilities", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [
      {
        ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
        requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
      },
      {
        ...recommendationEnvelope(RUN_A, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`]),
        id: "rec-plugin", source_analysis_id: analysis.analysis_id, scope: "plugin", kind: "telemetry_gap",
        confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
        proposed_action: "Draft a Guild issue.", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
        requires_user_approval: true, status: "proposed", routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      },
    ];
    writeRunAnalysis(root, analysis);
    expect(decideRecommendation(root, RUN_A, "rec-project", "accept")).toMatchObject({ status: "queued", effect: "project_proposal_queued" });
    expect(decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toMatchObject({ status: "accepted", effect: "plugin_draft_written" });
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", "drafts", "rec-plugin.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "agents"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false);
  });

  it("supports explicit audited status transitions and rejects unsafe ids", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-project", source_analysis_id: analysis.analysis_id, scope: "project", kind: "create_skill",
      confidence: "high", severity: "medium", evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only",
      requires_user_approval: true, status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    expect(() => updateRecommendationStatus(root, RUN_A, "rec-project", "implemented")).toThrow(/transition|approval/i);
    decideRecommendation(root, RUN_A, "rec-project", "accept");
    expect(() => updateRecommendationStatus(root, RUN_A, "rec-project", "filed")).toThrow(/scope|transition/i);
    expect(updateRecommendationStatus(root, RUN_A, "rec-project", "implemented")).toMatchObject({ status: "implemented" });
    expect(() => decideRecommendation(root, "../escape", "rec-project", "accept")).toThrow(/safe path component/);
  });

  it("persists a strict standalone recommendation schema and rejects invalid runtime scope", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    expect(analysis.recommendations.length).toBeGreaterThan(0);
    expect(analysis.recommendations[0]).toMatchObject({
      schema_version: "guild.recommendation.v1",
      source_id: RUN_A,
      evidence_signature: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(() => routeRecommendation({ scope: "outside" as never })).toThrow(/scope/i);
  });

  it("fails before status mutation when activity history is malformed or escaped", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    analysis.recommendations = [{
      ...analysis.recommendations[0], id: "rec-project", source_id: RUN_A, scope: "project", kind: "create_skill",
      ...recommendationEnvelope(RUN_A, "project", "create_skill", analysis.recommendations[0].evidence_refs),
      suggested_owner: "project", next_action: "queue_proposal_only",
      routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const source = path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`);
    const before = fs.readFileSync(source, "utf8");
    const activity = path.join(root, ".guild", "recommendations", "activity.jsonl");
    fs.writeFileSync(activity, "{}\n");
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/activity/i);
    expect(fs.readFileSync(source, "utf8")).toBe(before);

    fs.unlinkSync(activity);
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-activity-outside-"));
    const outside = path.join(outsideDir, "activity.jsonl");
    fs.writeFileSync(outside, "");
    fs.symlinkSync(outside, activity);
    try {
      expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/activity|contained/i);
      expect(fs.readFileSync(source, "utf8")).toBe(before);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects pre-existing duplicate evidence signatures instead of inheriting by file order", () => {
    seedRun(root, RUN_A);
    appendRepeatedFailure(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const base = {
      ...analysis.recommendations[0], source_id: RUN_A, scope: "project" as const, kind: "create_skill" as const,
      ...recommendationEnvelope(RUN_A, "project", "create_skill", analysis.recommendations[0].evidence_refs),
      suggested_owner: "project" as const, next_action: "queue_proposal_only" as const,
      routing: { action: "queue_proposal_only" as const, requires_user_approval: true as const, target: "project-local" as const },
    };
    analysis.recommendations = [{ ...base, id: "rec-first" }];
    writeRunAnalysis(root, analysis);
    const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
    fs.writeFileSync(queue, [
      JSON.stringify({ ...base, id: "rec-first", status: "queued" }),
      JSON.stringify({ ...base, id: "rec-second", status: "rejected" }),
    ].join("\n") + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/duplicate evidence signature/i);
  });

  it("preserves plugin approval across a regenerated comparison source id", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    appendRepeatedFailure(root, RUN_A);
    const first = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    const base = analyzeRun(root, RUN_A).recommendations[0];
    first.recommendations = [{
      ...base, id: "rec-plugin-stable", source_id: first.comparison_id, source_analysis_id: first.comparison_id,
      scope: "plugin", kind: "telemetry_gap", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing",
      routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
      affected_runs: [RUN_A, RUN_B], evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`, `.guild/runs/${RUN_B}/run.yaml`],
      ...recommendationEnvelope(first.comparison_id, "plugin", "telemetry_gap", [`.guild/runs/${RUN_A}/run.yaml`, `.guild/runs/${RUN_B}/run.yaml`]),
    }];
    writeRunComparison(root, first);
    decideRecommendation(root, first.comparison_id, "rec-plugin-stable", "accept");

    const regenerated = { ...first, comparison_id: "comparison-regenerated", source_hashes: first.source_hashes.map((hash) => `${hash}-new`) };
    regenerated.recommendations = [{ ...first.recommendations[0], source_id: regenerated.comparison_id, source_analysis_id: regenerated.comparison_id, status: "proposed" }];
    const written = writeRunComparison(root, regenerated);
    const record = JSON.parse(fs.readFileSync(written.recommendations, "utf8").trim());
    expect(record.status).toBe("accepted");
    const activity = fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(activity).toContainEqual(expect.objectContaining({
      effect: "status_migrated",
      source_id: regenerated.comparison_id,
      previous_source_id: first.comparison_id,
      previous_recommendation_id: "rec-plugin-stable",
      recommendation_id: "rec-plugin-stable",
    }));
  });

  it("rejects symlinked run inputs that escape the project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-input-outside-"));
    seedRun(outside, RUN_A);
    fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
    fs.symlinkSync(path.join(outside, ".guild", "runs", RUN_A), path.join(root, ".guild", "runs", RUN_A));
    try {
      expect(() => analyzeRun(root, RUN_A)).toThrow(/symlink|contained|escapes/i);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it.each(["run.yaml", "provenance.json", path.join("logs", "v1.4-events.jsonl")])(
    "rejects a nested symlinked run input: %s",
    (relative) => {
      const attackRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-run-input-"));
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-run-outside-"));
      const dir = seedRun(attackRoot, RUN_A);
      const target = path.join(dir, relative);
      const external = path.join(outside, path.basename(relative));
      fs.copyFileSync(target, external);
      fs.unlinkSync(target);
      fs.symlinkSync(external, target);
      try {
        expect(() => analyzeRun(attackRoot, RUN_A)).toThrow(/symlink|contained|escapes/i);
      } finally {
        fs.rmSync(attackRoot, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("rejects pre-progressed, cross-bound, missing-evidence, and duplicate generated recommendations", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const base = {
      ...recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/run.yaml`]),
      id: "rec-generated", source_analysis_id: analysis.analysis_id, scope: "project" as const, kind: "create_skill" as const,
      confidence: "high" as const, severity: "medium" as const, evidence_refs: [`.guild/runs/${RUN_A}/run.yaml`], affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project" as const, next_action: "queue_proposal_only" as const,
      requires_user_approval: true as const, status: "proposed" as const,
      routing: { action: "queue_proposal_only" as const, requires_user_approval: true as const, target: "project-local" as const },
    };
    analysis.recommendations = [{ ...base, status: "implemented" }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/proposed|transition/i);
    analysis.recommendations = [{ ...base, source_id: RUN_B }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/source_id|bound/i);
    analysis.recommendations = [{ ...base, evidence_refs: [`.guild/runs/${RUN_A}/missing.json`], evidence_signature: recommendationEnvelope(RUN_A, "project", "create_skill", [`.guild/runs/${RUN_A}/missing.json`]).evidence_signature }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/evidence|regular file|exist/i);
    analysis.recommendations = [{ ...base, id: "rec-first" }, { ...base, id: "rec-second" }];
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/duplicate evidence signature/i);
  });

  it("rejects semantically unauthorized activity before regeneration", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-project", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-forged", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-project", evidence_signature: analysis.recommendations[0].evidence_signature,
      scope: "project", from_status: "proposed", to_status: "implemented", effect: "status_recorded",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/activity|transition|source_analysis/i);
  });

  it("rejects a shaped activity promotion that no persisted source or queue state corroborates", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-forged", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-shaped-forgery", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-forged",
      evidence_signature: analysis.recommendations[0].evidence_signature, scope: "project",
      from_status: "proposed", to_status: "queued", effect: "project_proposal_queued",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/corroborated|persisted|activity/i);
  });

  it("rejects activity corroboration from a persisted record with a different identity", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-identity-bound", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    writeRunAnalysis(root, analysis);
    const mismatched = {
      ...analysis.recommendations[0],
      id: "rec-different-identity",
      source_id: RUN_B,
      source_analysis_id: "analysis-different-identity",
      status: "queued" as const,
    };
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "queue.jsonl"), JSON.stringify(mismatched) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), JSON.stringify({
      schema_version: "guild.recommendation_activity.v1", activity_id: "activity-identity-mismatch", at: "2026-08-12T01:00:00Z",
      source_id: RUN_A, source_analysis_id: analysis.analysis_id, recommendation_id: "rec-identity-bound",
      evidence_signature: analysis.recommendations[0].evidence_signature, scope: "project",
      from_status: "proposed", to_status: "queued", effect: "project_proposal_queued",
    }) + "\n");
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/identity|corroborated|persisted/i);
  });

  it("recovers an interrupted multi-file transaction before the next writer runs", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const written = writeRunAnalysis(root, analysis);
    const previous = fs.readFileSync(written.json, "utf8");
    fs.writeFileSync(written.json, "partial write\n");
    const journal = path.join(root, ".guild", "recommendations", ".transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
      schema_version: "guild.recommendation_transaction.v1",
      transaction_id: "transaction-interrupted",
      files: [{ path: path.relative(root, written.json), previous }],
    }) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    expect(() => decideRecommendation(root, RUN_A, "missing-recommendation", "accept")).toThrow(/not found/i);
    expect(fs.readFileSync(written.json, "utf8")).toBe(previous);
    expect(fs.existsSync(journal)).toBe(false);
  });

  it("refuses a crafted recovery journal that targets project capabilities", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    writeRunAnalysis(root, analysis);
    const injected = path.join(root, ".guild", "skills", "injected.md");
    const journal = path.join(root, ".guild", "recommendations", ".transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
      schema_version: "guild.recommendation_transaction.v1",
      transaction_id: "transaction-capability-escape",
      files: [{ path: path.relative(root, injected), previous: "malicious capability\n" }],
    }) + "\n");
    fs.writeFileSync(path.join(root, ".guild", "recommendations", ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    expect(() => decideRecommendation(root, RUN_A, "missing-recommendation", "accept")).toThrow(/analyzer-owned|transaction target/i);
    expect(fs.existsSync(injected)).toBe(false);
    expect(fs.existsSync(journal)).toBe(true);
  });

  it("admits only one writer during concurrent stale-lock recovery", async () => {
    const recommendations = path.join(root, ".guild", "recommendations");
    fs.mkdirSync(recommendations, { recursive: true });
    fs.writeFileSync(path.join(recommendations, ".write.lock"), JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    const marker = path.join(root, "writers.txt");
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "run-analysis.ts")).href;
    const script = `
      import fs from "node:fs";
      import runAnalysis from ${JSON.stringify(moduleUrl)};
      const { withRecommendationLock } = runAnalysis;
      try {
        withRecommendationLock(${JSON.stringify(root)}, () => {
          fs.appendFileSync(${JSON.stringify(marker)}, process.pid + "\\n");
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
        });
      } catch (error) {
        process.stderr.write(String(error));
        process.exitCode = 2;
      }
    `;
    const launch = (): Promise<{ code: number | null; stderr: string }> => new Promise((resolve) => {
      const tsx = require.resolve("tsx", { paths: [path.resolve(__dirname, "../../../scripts")] });
      const child = spawn(process.execPath, ["--import", tsx, "--input-type=module", "-e", script], {
        cwd: path.resolve(__dirname, "../../../scripts"),
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => resolve({ code, stderr }));
    });
    const results = await Promise.all([launch(), launch()]);
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 2)).toHaveLength(1);
    expect(results.find((result) => result.code === 2)?.stderr).toMatch(/lock|recovery/i);
    expect(fs.readFileSync(marker, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("does not delete a replacement recovery claim during stale-lock cleanup", () => {
    const recommendations = path.join(root, ".guild", "recommendations");
    const lock = path.join(recommendations, ".write.lock");
    const recovery = path.join(recommendations, ".write.lock.recovery");
    fs.mkdirSync(recommendations, { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({
      schema_version: "guild.recommendation_lock.v1", pid: 99999999, created_at: "2026-08-12T01:00:00Z",
    }) + "\n");
    const originalUnlink = fs.unlinkSync.bind(fs);
    let replaced = false;
    const unlink = spyOn(fs, "unlinkSync").mockImplementation(((file: fs.PathLike) => {
      originalUnlink(file);
      if (!replaced && String(file) === lock) {
        replaced = true;
        originalUnlink(recovery);
        fs.writeFileSync(recovery, "replacement-claim\n");
      }
    }) as typeof fs.unlinkSync);
    try {
      withRecommendationLock(root, () => undefined);
    } finally {
      unlink.mockRestore();
    }
    expect(fs.readFileSync(recovery, "utf8")).toBe("replacement-claim\n");
  });

  it.each(["activity", "queue", "Activity", "QUEUE"])("rejects reserved recommendation source id %s", (runId) => {
    seedRun(root, runId);
    const analysis = analyzeRun(root, runId);
    expect(() => writeRunAnalysis(root, analysis)).toThrow(/reserved|source id/i);
  });

  it("rolls back every analysis output when a later file write fails", () => {
    seedRun(root, RUN_A);
    const analysis = analyzeRun(root, RUN_A);
    const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
    analysis.recommendations = [{
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-project", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    }];
    const written = writeRunAnalysis(root, analysis);
    const queue = path.join(root, ".guild", "recommendations", "queue.jsonl");
    const before = new Map([written.json, written.markdown, written.recommendations, queue].map((file) => [file, fs.readFileSync(file, "utf8")]));
    const originalRename = fs.renameSync.bind(fs);
    let injected = false;
    const rename = spyOn(fs, "renameSync").mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (!injected && String(to) === queue) { injected = true; throw new Error("injected queue write failure"); }
      return originalRename(from, to);
    }) as typeof fs.renameSync);
    try {
      analysis.recommendations[0].proposed_action = "Changed action that must roll back.";
      expect(() => writeRunAnalysis(root, analysis)).toThrow(/injected queue write failure/);
    } finally {
      rename.mockRestore();
    }
    for (const [file, contents] of before) expect(fs.readFileSync(file, "utf8")).toBe(contents);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", ".transaction.json"))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B02 — C-DETECTORS goldens. Every case name is a named golden fixture; the
// observed projection is compared exactly. B02_MATRIX_OUT, when set,
// receives the requirement-to-fixture matrix built from these observations.
// ─────────────────────────────────────────────────────────────────────────────

type GoldenKind = "positive" | "negative" | "unobservable" | "boundary" | "determinism" | "freshness" | "baseline" | "refusal";
interface MatrixObservation { row: string; fixture: string; kind: GoldenKind; observed: unknown }
const matrixObservations: MatrixObservation[] = [];

function diag(analysis: RunAnalysis, detector: DetectorId) {
  const item = analysis.diagnostics!.results.find((entry) => entry.detector === detector)!;
  return { state: item.state, reason: item.reason, value: item.value };
}
const kinds = (analysis: RunAnalysis) => ({
  findings: analysis.findings.map((item) => `${item.kind}:${item.signature}`).sort(),
  recommendations: analysis.recommendations.map((item) => `${item.scope}:${item.kind}`).sort(),
});

interface DetectorGolden {
  name: string;
  row: DetectorId;
  kind: GoldenKind;
  build: (root: string, runId: string) => void;
  observe: (analysis: RunAnalysis) => unknown;
  expected: unknown;
}

const R = BASELINE_RUN;
const line = (n: number) => `.guild/runs/${R}/logs/v1.4-events.jsonl#line:${n}`;
const twoInstructions = [{ instruction_id: "no-push", requirement_hash: REQ("no-push") }, { instruction_id: "tests-green", requirement_hash: REQ("tests-green") }];
const instructionView = (analysis: RunAnalysis) => ({
  aggregate: diag(analysis, "instruction_following").value["aggregate"],
  state: diag(analysis, "instruction_following").state,
  reason: diag(analysis, "instruction_following").reason,
  checks: analysis.diagnostics!.instruction_checks.map((check) => `${check.instruction_id}:${check.status}`),
  v1: analysis.assessments.instruction_following.status,
});
const toolView = (analysis: RunAnalysis) => ({ ...diag(analysis, "tool_coverage"), ...kinds(analysis) });

const DETECTOR_GOLDENS: DetectorGolden[] = [
  // instruction_following (B02-AC1)
  { name: "instruction-two-declared-checks-proved", row: "instruction_following", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions }); prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok" }); prove(root, id, { id: "tests-green", result: "passed", verifierStatus: "ok" }); },
    observe: instructionView, expected: { aggregate: "satisfied", state: "observed", reason: null, checks: ["no-push:satisfied", "tests-green:satisfied"], v1: "satisfied" } },
  { name: "instruction-failed-verifier-violates-despite-gate-ok", row: "instruction_following", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions }); prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok" }); prove(root, id, { id: "tests-green", result: "failed", verifierStatus: "error" }); prove(root, id, { id: "tests-green", result: "passed", verifierStatus: "ok" }); },
    observe: instructionView, expected: { aggregate: "violated", state: "observed", reason: null, checks: ["no-push:satisfied", "tests-green:violated"], v1: "violated" } },
  { name: "instruction-no-declaration-no-observation", row: "instruction_following", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id, { events: defaultEvents(id).filter((event) => !["prompt_received"].includes(String(event["event_class"])) && event["event"] !== "gate_decision") }); },
    observe: instructionView, expected: { aggregate: "unobservable", state: "unobservable", reason: "no_instruction_declaration", checks: [], v1: "unobservable" } },
  { name: "instruction-current-telemetry-observability-only-ambiguous", row: "instruction_following", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [v2(id, "gate_concluded", { actor_type: "lead", actor_id: "main", span_id: "gate-review", signature: "gate:review" })]); },
    observe: instructionView, expected: { aggregate: "ambiguous", state: "ambiguous", reason: "no_instruction_declaration", checks: [], v1: "ambiguous" } },
  { name: "instruction-stale-input-hash-is-not-proof", row: "instruction_following", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions.slice(0, 1) }); prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok", inputHash: sha("old inputs") }); },
    observe: instructionView, expected: { aggregate: "ambiguous", state: "ambiguous", reason: "missing_typed_proof", checks: ["no-push:ambiguous"], v1: "ambiguous" } },
  { name: "instruction-uncorroborated-self-report-is-not-proof", row: "instruction_following", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions.slice(0, 1) }); prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok", verifierRef: line(1) }); },
    observe: instructionView, expected: { aggregate: "ambiguous", state: "ambiguous", reason: "missing_typed_proof", checks: ["no-push:ambiguous"], v1: "ambiguous" } },
  { name: "instruction-unrelated-ok-gate-never-corroborates", row: "instruction_following", kind: "negative",
    build: (root, id) => {
      seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions.slice(0, 1) });
      const [unrelated] = appendRows(root, id, [v2(id, "gate_concluded", { actor_type: "lead", actor_id: "main", span_id: "gate-unrelated", signature: "gate:unrelated-approval" })]);
      prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok", verifierRef: unrelated });
    },
    observe: instructionView, expected: { aggregate: "ambiguous", state: "ambiguous", reason: "missing_typed_proof", checks: ["no-push:ambiguous"], v1: "ambiguous" } },
  { name: "instruction-incomplete-declared-scope-never-satisfied", row: "instruction_following", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions, complete: false }); prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok" }); prove(root, id, { id: "tests-green", result: "passed", verifierStatus: "ok" }); },
    observe: instructionView, expected: { aggregate: "ambiguous", state: "ambiguous", reason: "declared_scope_incomplete", checks: ["no-push:satisfied", "tests-green:satisfied"], v1: "ambiguous" } },
  // repeated_mistake (B02-AC2 single/two failure; B01-F4)
  { name: "repeat-two-distinct-failed-attempts", row: "repeated_mistake", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [failedTool(id, "f-1", { signature: "tool:Bash:abc", task_id: "T1", phase: "execute" }), failedTool(id, "f-2", { signature: "tool:Bash:abc", task_id: "T1", phase: "execute" })]); },
    observe: (a) => ({ clusters: diag(a, "repeated_mistake").value["clusters"], ...kinds(a) }),
    expected: { clusters: [{ signature: "tool:Bash:abc", task_id: "T1", phase: "execute", attempts: 2, sources: ["failed_action"], refs: [line(8), line(9)] }], findings: ["repeated_failure:tool:Bash:abc"], recommendations: ["project:clarify_prompt_contract"] } },
  { name: "repeat-two-failed-verifications-finding", row: "repeated_mistake", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions.slice(1) }); prove(root, id, { id: "tests-green", result: "failed", verifierStatus: "error" }); prove(root, id, { id: "tests-green", result: "failed", verifierStatus: "error" }); },
    observe: (a) => ({ clusters: (diag(a, "repeated_mistake").value["clusters"] as Array<Record<string, unknown>>).map((c) => `${c["signature"]}:${c["attempts"]}:${(c["sources"] as string[]).join(",")}`), ...kinds(a) }),
    expected: { clusters: ["instruction:tests-green:2:failed_verifier"], findings: ["repeated_failure:instruction:tests-green"], recommendations: ["project:clarify_prompt_contract"] } },
  { name: "repeat-same-span-duplicate-failed-proofs-one-attempt", row: "repeated_mistake", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { instructions: twoInstructions.slice(1) }); prove(root, id, { id: "tests-green", result: "failed", verifierStatus: "error", span: "gate-dup" }); prove(root, id, { id: "tests-green", result: "failed", verifierStatus: "error", span: "gate-dup" }); },
    observe: (a) => ({ clusters: diag(a, "repeated_mistake").value["clusters"], signed: diag(a, "repeated_mistake").value["signed_attempts"], checks: instructionView(a).checks, ...kinds(a) }),
    expected: { clusters: [], signed: 1, checks: ["tests-green:violated"], findings: [], recommendations: [] } },
  { name: "repeat-single-failure-boundary", row: "repeated_mistake", kind: "boundary",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [failedTool(id, "f-1", { signature: "tool:Bash:abc" })]); },
    observe: (a) => ({ state: diag(a, "repeated_mistake").state, clusters: diag(a, "repeated_mistake").value["clusters"], ...kinds(a) }),
    expected: { state: "observed", clusters: [], findings: [], recommendations: [] } },
  { name: "repeat-one-attempt-plus-semantic-twins", row: "repeated_mistake", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [
      { ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: id, lane_id: "lane-a", tool: "Bash", command_redacted: "npm test", result_excerpt_redacted: "exit 1", status: "err", latency_ms: 5, span_id: "twin-1" },
      v2(id, "tool_call_started", { actor_type: "tool", actor_id: "Bash", span_id: "twin-1" }), failedTool(id, "twin-1")]); },
    observe: (a) => ({ ...diag(a, "repeated_mistake").value, ...kinds(a), duration_ms: a.usage.duration_ms }),
    expected: { clusters: [], signed_attempts: 1, unsignatured_failures: 0, findings: [], recommendations: [], duration_ms: 15 } },
  { name: "repeat-signatureless-failures-unobservable", row: "repeated_mistake", kind: "unobservable",
    build: V1_BASELINE_SCENARIOS["v1-signatureless-semantic-failures"],
    observe: (a) => ({ ...diag(a, "repeated_mistake"), ...kinds(a) }),
    expected: { state: "unobservable", reason: "absent_action_signature", value: { clusters: [], signed_attempts: 0, unsignatured_failures: 2 }, findings: [], recommendations: [] } },
  { name: "repeat-two-unrelated-signatures-stay-separate", row: "repeated_mistake", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [failedTool(id, "f-1", { signature: "tool:Bash:abc" }), failedTool(id, "f-2", { signature: "tool:Bash:def" })]); },
    observe: (a) => ({ clusters: diag(a, "repeated_mistake").value["clusters"], ...kinds(a) }), expected: { clusters: [], findings: [], recommendations: [] } },
  { name: "repeat-correction-signatures-cluster", row: "repeated_mistake", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "correction_applied", { span_id: `corr-${n}`, signature: "correction:lint", task_id: "T1" }))); },
    observe: (a) => (diag(a, "repeated_mistake").value["clusters"] as Array<Record<string, unknown>>).map((c) => `${c["signature"]}:${c["attempts"]}:${(c["sources"] as string[]).join(",")}`),
    expected: ["correction:lint:2:correction_applied"] },
  // steering (B02-AC2 steering boundary)
  { name: "steering-two-typed-interventions", row: "steering", kind: "positive",
    build: V1_BASELINE_SCENARIOS["v1-two-steering"], observe: (a) => ({ ...diag(a, "steering"), ...kinds(a), v1: a.assessments.prompt_efficiency.status }),
    expected: { state: "observed", reason: null, value: { interventions: 2, by_signature: { "user-steering": 2 }, repeated: true, necessity: "unobservable" }, findings: ["prompt_inefficiency:repeated-user-steering"], recommendations: ["project:update_workflow"], v1: "ambiguous" } },
  { name: "steering-one-intervention-boundary", row: "steering", kind: "boundary",
    build: V1_BASELINE_SCENARIOS["v1-one-steering"], observe: (a) => ({ interventions: diag(a, "steering").value["interventions"], ...kinds(a) }),
    expected: { interventions: 1, findings: [], recommendations: [] } },
  { name: "steering-duplicate-span-twin-counts-once", row: "steering", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map(() => v2(id, "user_steering_received", { actor_type: "user", actor_id: "operator", span_id: "steer-same", signature: "user-steering" }))); },
    observe: (a) => ({ interventions: diag(a, "steering").value["interventions"], ...kinds(a) }), expected: { interventions: 1, findings: [], recommendations: [] } },
  { name: "steering-ordinary-prompts-unclassified", row: "steering", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "prompt_received", { actor_type: "user", actor_id: "operator", span_id: `p-${n}`, prompt_hash: `h-${n}`, redaction: "omitted" }))); },
    observe: (a) => ({ state: diag(a, "steering").state, reason: diag(a, "steering").reason, ...kinds(a) }),
    expected: { state: "unobservable", reason: "no_steering_classification", findings: [], recommendations: [] } },
  // clarification
  { name: "clarification-late-after-substantive-action", row: "clarification", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { clarify: ["T1"] }); appendRows(root, id, [v2(id, "clarifying_question_asked", { actor_type: "lead", actor_id: "main", span_id: "clar-1", prompt_hash: "q-1", redaction: "omitted", task_id: "T1" })]); },
    observe: (a) => ({ state: diag(a, "clarification").state, timely: diag(a, "clarification").value["timely"], late: diag(a, "clarification").value["late"], ...kinds(a) }),
    expected: { state: "observed", timely: 0, late: 1, findings: ["prompt_inefficiency:late-clarification:T1"], recommendations: ["project:update_workflow"] } },
  { name: "clarification-timely-before-action", row: "clarification", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { clarify: ["T9"] }); appendRows(root, id, [
      v2(id, "clarifying_question_asked", { actor_type: "lead", actor_id: "main", span_id: "clar-9", prompt_hash: "q-9", redaction: "omitted", task_id: "T9" }),
      v2(id, "tool_call_started", { actor_type: "tool", actor_id: "Bash", span_id: "t9-1", task_id: "T9" })]); },
    observe: (a) => ({ state: diag(a, "clarification").state, timely: diag(a, "clarification").value["timely"], late: diag(a, "clarification").value["late"], ...kinds(a) }),
    expected: { state: "observed", timely: 1, late: 0, findings: [], recommendations: [] } },
  { name: "clarification-without-declared-constraint-ambiguous", row: "clarification", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [v2(id, "clarifying_question_asked", { actor_type: "lead", actor_id: "main", span_id: "clar-1", prompt_hash: "q-1", redaction: "omitted", task_id: "T1" })]); },
    observe: (a) => ({ state: diag(a, "clarification").state, reason: diag(a, "clarification").reason, unknown: diag(a, "clarification").value["unknown"], ...kinds(a) }),
    expected: { state: "ambiguous", reason: "no_declared_clarification_constraint", unknown: 1, findings: [], recommendations: [] } },
  { name: "clarification-absent-unobservable", row: "clarification", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); }, observe: (a) => ({ state: diag(a, "clarification").state, reason: diag(a, "clarification").reason }),
    expected: { state: "unobservable", reason: "no_clarification_correlation" } },
  // redundant_prompt
  ...([
    ["redundant-identical-prompts-unchanged-context", "positive", false, false, { keyed: 2, candidates: 1, findings: 1 }],
    ["redundant-after-intervening-result", "negative", true, false, { keyed: 2, candidates: 0, findings: 0 }],
    ["redundant-explicit-retry-authorized", "negative", false, true, { keyed: 2, candidates: 0, findings: 0 }],
  ] as const).map(([name, kind, intervening, retry, expected]): DetectorGolden => ({
    name, row: "redundant_prompt", kind,
    build: (root, id) => {
      seedGoldenRun(root, id);
      writeRunFile(root, id, "sidecars/ctx-1.json", { schema_version: "guild.prompt_context.v1", run_id: id, prompt_hash: "p-hash", context_hash: sha("ctx"), retry_authorized: false });
      writeRunFile(root, id, "sidecars/ctx-2.json", { schema_version: "guild.prompt_context.v1", run_id: id, prompt_hash: "p-hash", context_hash: sha("ctx"), retry_authorized: retry });
      const prompt = (n: number) => v2(id, "prompt_normalized", { actor_type: "lead", actor_id: "main", span_id: `pn-${n}`, prompt_hash: "p-hash", redaction: "redacted", task_id: "T1", phase: "execute", payload_ref: `sidecars/ctx-${n}.json` });
      appendRows(root, id, [prompt(1), ...(intervening ? [v2(id, "agent_response_received", { span_id: "resp-1", task_id: "T1" })] : []), prompt(2)]);
    },
    observe: (a) => ({ keyed: diag(a, "redundant_prompt").value["keyed"], candidates: (diag(a, "redundant_prompt").value["candidates"] as string[]).length, findings: a.findings.filter((f) => f.signature.startsWith("redundant-prompt:")).length }),
    expected,
  })),
  { name: "redundant-missing-context-hash-unobservable", row: "redundant_prompt", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "prompt_normalized", { actor_type: "lead", actor_id: "main", span_id: `pn-${n}`, prompt_hash: "p-hash", redaction: "redacted", task_id: "T1", phase: "execute" }))); },
    observe: (a) => ({ state: diag(a, "redundant_prompt").state, reason: diag(a, "redundant_prompt").reason, ...kinds(a) }),
    expected: { state: "unobservable", reason: "missing_context_hash", findings: [], recommendations: [] } },
  // prompt_action_latency
  ...([
    ["latency-30001ms-long", "positive", 30_001, false, { state: "observed", long: 1, pairs: 1, waits: 0, malformed: 0 }],
    ["latency-30000ms-not-long", "boundary", 30_000, false, { state: "observed", long: 0, pairs: 1, waits: 0, malformed: 0 }],
    ["latency-documented-user-wait-excluded", "negative", 45_000, true, { state: "observed", long: 0, pairs: 0, waits: 1, malformed: 0 }],
    ["latency-reversed-timestamp-refused", "unobservable", -5, false, { state: "unobservable", long: 0, pairs: 0, waits: 0, malformed: 1 }],
  ] as const).map(([name, kind, elapsed, wait, expected]): DetectorGolden => ({
    name, row: "prompt_action_latency", kind,
    build: (root, id) => {
      seedGoldenRun(root, id);
      appendRows(root, id, [
        v2(id, "prompt_received", { ts: TS(100_000), actor_type: "user", actor_id: "operator", span_id: "lp-1", prompt_hash: "lp", redaction: "omitted" }),
        ...(wait ? [v2(id, "clarifying_question_asked", { ts: TS(100_500), actor_type: "lead", actor_id: "main", span_id: "lw-1", parent_span_id: "lp-1", prompt_hash: "lq", redaction: "omitted" })] : []),
        v2(id, "tool_call_started", { ts: TS(100_000 + elapsed), actor_type: "tool", actor_id: "Bash", span_id: "la-1", parent_span_id: "lp-1" }),
      ]);
    },
    observe: (a) => { const d = diag(a, "prompt_action_latency"); return { state: d.state, long: d.value["long_latency"], pairs: d.value["pairs"], waits: d.value["excluded_waits"], malformed: d.value["malformed"] }; },
    expected,
  })),
  // workflow_churn
  ...([
    ["churn-required-phase-missing-without-cursor-unknown", "unobservable", null, { skipped: [], unconfirmed: ["review"], dimension: "unobservable", findings: [], recommendations: [] }],
    ["churn-required-phase-skipped-frozen-cursor", "positive", [["execute"], []], { skipped: ["review"], unconfirmed: [], dimension: "observed", findings: ["workflow_churn:skipped-phase:review"], recommendations: ["project:update_workflow"] }],
    ["churn-required-phase-explicit-bypass", "positive", [["execute", "review"], ["review"]], { skipped: ["review"], unconfirmed: [], dimension: "observed", findings: ["workflow_churn:skipped-phase:review"], recommendations: ["project:update_workflow"] }],
    ["churn-cursor-visited-without-entry-telemetry-not-skipped", "negative", [["execute", "review"], []], { skipped: [], unconfirmed: ["review"], dimension: "observed", findings: [], recommendations: [] }],
  ] as const).map(([name, kind, cursor, expected]): DetectorGolden => ({
    name, row: "workflow_churn", kind,
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { phases: ["execute", "review"] }); if (cursor) phaseCursor(root, id, [...cursor[0]], [...cursor[1]]); },
    observe: (a) => { const d = diag(a, "workflow_churn").value; return { skipped: d["skipped_required_phases"], unconfirmed: d["unconfirmed_missing_phases"], dimension: (d["dimension_states"] as Record<string, string>)["skipped_phases"], ...kinds(a) }; },
    expected,
  })),
  ...([
    ["churn-stale-phase-concluded-cursor-before-closure-not-skipped", "phase_concluded"],
    ["churn-superseded-close-cursor-not-skipped", "run_closed"],
  ] as const).map(([name, carrier]): DetectorGolden => ({
    name, row: "workflow_churn", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); declare(root, id, { phases: ["execute", "review"] }); staleCursor(root, id, ["execute"], carrier); },
    observe: (a) => { const d = diag(a, "workflow_churn").value; return { skipped: d["skipped_required_phases"], unconfirmed: d["unconfirmed_missing_phases"], dimension: (d["dimension_states"] as Record<string, string>)["skipped_phases"], ...kinds(a) }; },
    expected: { skipped: [], unconfirmed: ["review"], dimension: "unobservable", findings: [], recommendations: [] },
  })),
  { name: "churn-loop-cap-hit", row: "workflow_churn", kind: "positive",
    build: V1_BASELINE_SCENARIOS["v1-loop-cap-hit"], observe: (a) => ({ caps: diag(a, "workflow_churn").value["cap_hits"], ...kinds(a) }),
    expected: { caps: 1, findings: ["workflow_churn:loop:L3"], recommendations: ["project:update_workflow"] } },
  { name: "churn-phase-reentered-twice", row: "workflow_churn", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, ["phase_entered", "phase_concluded", "phase_entered", "phase_concluded", "phase_entered"].map((cls, n) => v2(id, cls, { span_id: `ph-${Math.floor(n / 2)}`, phase: "review" }))); },
    observe: (a) => ({ reentries: diag(a, "workflow_churn").value["phase_reentries"], loops: diag(a, "workflow_churn").value["repeated_phase_loops"], ...kinds(a) }),
    expected: { reentries: { review: 2 }, loops: ["review"], findings: [], recommendations: [] } },
  { name: "churn-single-visit-and-authorized-iteration", row: "workflow_churn", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "loop_iteration", { span_id: `it-${n}`, signature: "loop:L3" }))); },
    observe: (a) => ({ ...diag(a, "workflow_churn").value, dimension_states: undefined, ...kinds(a) }),
    expected: { cap_hits: 0, phase_reentries: {}, repeated_phase_loops: [], skipped_required_phases: [], unconfirmed_missing_phases: [], repeated_proposals: [], dimension_states: undefined, findings: [], recommendations: [] } },
  { name: "churn-repeated-proposal-unchanged-input", row: "workflow_churn", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "recommendation_created", { span_id: `rc-${n}`, signature: "proposal:x" }))); },
    observe: (a) => diag(a, "workflow_churn").value["repeated_proposals"], expected: ["proposal:x"] },
  { name: "churn-changed-input-invalidates-proposal", row: "workflow_churn", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [v2(id, "recommendation_created", { span_id: "rc-1", signature: "proposal:x" }), v2(id, "prompt_received", { actor_type: "user", actor_id: "operator", span_id: "p-new", prompt_hash: "new", redaction: "omitted" }), v2(id, "recommendation_created", { span_id: "rc-2", signature: "proposal:x" })]); },
    observe: (a) => diag(a, "workflow_churn").value["repeated_proposals"], expected: [] },
  { name: "churn-missing-phase-loop-evidence-unobservable", row: "workflow_churn", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id, { events: defaultEvents(id).filter((event) => !["phase_start", "loop_round_start"].includes(String(event["event"]))) }); },
    observe: (a) => ({ state: diag(a, "workflow_churn").state, reason: diag(a, "workflow_churn").reason }),
    expected: { state: "unobservable", reason: "missing_phase_loop_or_proposal_evidence" } },
  // knowledge_memory
  ...([
    ["knowledge-hit-consumed-by-passing-verifier", "positive", true, { state: "observed", reason: null, hits: 1, use_links: 1 }],
    ["knowledge-hit-without-consumption-ambiguous", "negative", false, { state: "ambiguous", reason: "no_result_consumption_link", hits: 1, use_links: 0 }],
  ] as const).map(([name, kind, consumed, expected]): DetectorGolden => ({
    name, row: "knowledge_memory", kind,
    build: (root, id) => {
      seedGoldenRun(root, id);
      declare(root, id, { instructions: twoInstructions.slice(0, 1) });
      const resultRef = writeRunFile(root, id, "knowledge/result-1.md", "wiki page excerpt\n");
      writeRunFile(root, id, "sidecars/lookup-1.json", { schema_version: "guild.lookup_result.v1", run_id: id, outcome: "hit", result_ref: resultRef });
      appendRows(root, id, [v2(id, "knowledge_lookup_started", { span_id: "kl-1", prompt_hash: "kq" }), v2(id, "knowledge_lookup_result", { span_id: "kl-1", prompt_hash: "kq", payload_ref: "sidecars/lookup-1.json" })]);
      prove(root, id, { id: "no-push", result: "passed", verifierStatus: "ok", evidenceRefs: consumed ? [resultRef] : [`.guild/runs/${id}/run.yaml`] });
    },
    observe: (a) => { const d = diag(a, "knowledge_memory"); const k = d.value["knowledge"] as Record<string, number>; return { state: d.state, reason: d.reason, hits: k["hits"], use_links: k["use_links"] }; },
    expected,
  })),
  { name: "knowledge-lookup-without-typed-outcome", row: "knowledge_memory", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [v2(id, "knowledge_lookup_result", { span_id: "kl-1", prompt_hash: "kq" })]); },
    observe: (a) => ({ state: diag(a, "knowledge_memory").state, reason: diag(a, "knowledge_memory").reason }), expected: { state: "unobservable", reason: "no_typed_lookup_outcome" } },
  { name: "knowledge-no-lookup-unobservable", row: "knowledge_memory", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); }, observe: (a) => ({ state: diag(a, "knowledge_memory").state, reason: diag(a, "knowledge_memory").reason }), expected: { state: "unobservable", reason: "no_lookup_evidence" } },
  // tool_coverage (missing tool versus permission denial)
  ...([
    ["tool-gap-project-two-workarounds", "positive", "project", "skill", "deploy-recipe", 2, ["repeated_failure:tool:Bash:deploy", "tool_gap:tool-gap:project:skill:deploy-recipe"], ["project:clarify_prompt_contract", "project:create_skill"]],
    ["tool-gap-plugin-behavior-two-attempts", "positive", "plugin", "plugin_behavior", "trace-query", 2, ["repeated_failure:tool:Bash:deploy", "tool_gap:tool-gap:plugin:plugin_behavior:trace-query"], ["plugin:tooling_gap", "project:clarify_prompt_contract"]],
    ["tool-capability-evidence-single-attempt", "boundary", "project", "skill", "deploy-recipe", 1, [], []],
  ] as const).map(([name, kind, owner, capability, target, attempts, findings, recommendations]): DetectorGolden => ({
    name, row: "tool_coverage", kind,
    build: (root, id) => {
      seedGoldenRun(root, id);
      capabilityEvidence(root, id, "sidecars/cap-1.json", { action_signature: "tool:Bash:deploy", owner, capability_kind: capability, target });
      appendRows(root, id, Array.from({ length: attempts }, (_, n) => failedTool(id, `d-${n}`, { signature: "tool:Bash:deploy", ...(n === 0 ? { payload_ref: "sidecars/cap-1.json" } : {}) })));
    },
    observe: (a) => { const d = diag(a, "tool_coverage"); return { gap_cause: d.value["gap_cause"], candidates: (d.value["gap_candidates"] as unknown[]).length, ...kinds(a) }; },
    expected: { gap_cause: attempts >= 2 ? "observed" : "unobservable", candidates: attempts >= 2 ? 1 : 0, findings: attempts >= 2 ? [...findings] : [], recommendations: attempts >= 2 ? [...recommendations] : [] },
  })),
  { name: "tool-single-policy-denial-no-missing-skill", row: "tool_coverage", kind: "negative",
    build: V1_BASELINE_SCENARIOS["v1-policy-denial"], observe: (a) => { const d = toolView(a); return { state: d.state, denials: d.value["denials"], gap_cause: d.value["gap_cause"], findings: d.findings, recommendations: d.recommendations }; },
    expected: { state: "observed", denials: { policy: 1, user: 0, host_unavailable: 0, capability_absent: 0 }, gap_cause: "unobservable", findings: [], recommendations: [] } },
  { name: "tool-capability-absent-denials-without-ownership", row: "tool_coverage", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [1, 2].map((n) => v2(id, "tool_call_denied", { actor_type: "tool", actor_id: "Skill", status: "denied", span_id: `cd-${n}`, signature: "capability_absent:Skill:deploy" }))); },
    observe: (a) => { const d = toolView(a); return { denials: (d.value["denials"] as Record<string, number>)["capability_absent"], gap_cause: d.value["gap_cause"], findings: d.findings, recommendations: d.recommendations }; },
    expected: { denials: 2, gap_cause: "unobservable", findings: [], recommendations: [] } },
  { name: "tool-duplicate-mirror-counts-once", row: "tool_coverage", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [
      { ts: "2026-08-12T01:00:07.000Z", event: "tool_call", run_id: id, lane_id: "lane-a", tool: "Bash", command_redacted: "deploy", result_excerpt_redacted: "exit 1", status: "err", latency_ms: 5, span_id: "m-1" },
      failedTool(id, "m-1", { signature: "tool:Bash:deploy", payload_ref: "sidecars/cap-1.json" })]);
      capabilityEvidence(root, id, "sidecars/cap-1.json", { action_signature: "tool:Bash:deploy", owner: "project", capability_kind: "skill", target: "deploy-recipe" }); },
    observe: (a) => { const d = toolView(a); return { actions: d.value["actions"], outcomes: d.value["outcomes"], findings: d.findings }; },
    expected: { actions: 2, outcomes: { ok: 1, failed: 1, denied: 0, started_only: 0 }, findings: [] } },
  // outcome_quality
  ...([
    ["outcome-bound-failed-verify-reopened-residual", "positive", "error", "failed", sha(ASSESSED_INPUT), true, { state: "observed", verify: "failed", reopened: true, residual_count: 2 }],
    ["outcome-passed-verify-at-old-input-hash", "negative", "ok", "passed", sha("old inputs"), true, { state: "ambiguous", verify: "unknown", reopened: null, residual_count: null }],
    ["outcome-incomplete-finding-list-no-zero-residual", "negative", "error", "failed", sha(ASSESSED_INPUT), false, { state: "observed", verify: "failed", reopened: true, residual_count: null }],
  ] as const).map(([name, kind, gateStatus, resultValue, hash, complete, expected]): DetectorGolden => ({
    name, row: "outcome_quality", kind,
    build: (root, id) => {
      seedGoldenRun(root, id); declare(root, id);
      writeRunFile(root, id, "sidecars/verify.json", { schema_version: "guild.outcome_record.v1", run_id: id, kind: "verify", result: resultValue, verified_input_hash: hash, reopen_transitions: 1, findings_complete: complete, unresolved_finding_ids: ["F-1", "F-2"] });
      appendRows(root, id, [v2(id, "gate_concluded", { actor_type: "lead", actor_id: "main", status: gateStatus, span_id: "verify-1", signature: "gate:verify-done", payload_ref: "sidecars/verify.json" })]);
    },
    observe: (a) => { const d = diag(a, "outcome_quality"); return { state: d.state, verify: d.value["verify"], reopened: d.value["reopened"], residual_count: d.value["residual_count"] }; },
    expected,
  })),
  { name: "outcome-no-typed-records-unobservable", row: "outcome_quality", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); }, observe: (a) => ({ ...diag(a, "outcome_quality"), value: undefined }), expected: { state: "unobservable", reason: "no_typed_outcome_records", value: undefined } },
  // recommendation_scope (both scopes)
  { name: "scope-plugin-invariant-bug-report", row: "recommendation_scope", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); capabilityEvidence(root, id, "sidecars/inv.json", { action_signature: "tool:Bash:trace", owner: "plugin", capability_kind: "plugin_invariant", target: "trace-span-pairing" }); appendRows(root, id, [failedTool(id, "inv-1", { signature: "tool:Bash:trace", payload_ref: "sidecars/inv.json" }), failedTool(id, "inv-2", { signature: "tool:Bash:trace" })]); },
    observe: (a) => ({ ...diag(a, "recommendation_scope"), ...kinds(a), routing: a.recommendations.map((item) => item.next_action) }),
    expected: { state: "observed", reason: null, value: { supported: [{ scope: "plugin", kind: "bug_report", target: "trace-span-pairing" }], unowned_failed_actions: 0 }, findings: ["repeated_failure:tool:Bash:trace"], recommendations: ["plugin:bug_report", "project:clarify_prompt_contract"], routing: ["ask_user_before_filing", "queue_proposal_only"] } },
  { name: "scope-plugin-invariant-single-attempt-no-bug-report", row: "recommendation_scope", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); capabilityEvidence(root, id, "sidecars/inv.json", { action_signature: "tool:Bash:trace", owner: "plugin", capability_kind: "plugin_invariant", target: "trace-span-pairing" }); appendRows(root, id, [failedTool(id, "inv-1", { signature: "tool:Bash:trace", payload_ref: "sidecars/inv.json" })]); },
    observe: (a) => ({ ...diag(a, "recommendation_scope"), ...kinds(a) }),
    expected: { state: "ambiguous", reason: "unowned_action_failure", value: { supported: [], unowned_failed_actions: 1 }, findings: [], recommendations: [] } },
  { name: "scope-project-recipe-gap-create-skill", row: "recommendation_scope", kind: "positive",
    build: (root, id) => { seedGoldenRun(root, id); capabilityEvidence(root, id, "sidecars/cap-1.json", { action_signature: "tool:Bash:deploy", owner: "project", capability_kind: "skill", target: "deploy-recipe" }); appendRows(root, id, [failedTool(id, "d-0", { signature: "tool:Bash:deploy", payload_ref: "sidecars/cap-1.json" }), failedTool(id, "d-1", { signature: "tool:Bash:deploy" })]); },
    observe: (a) => ({ supported: diag(a, "recommendation_scope").value["supported"], routing: a.recommendations.filter((item) => item.kind === "create_skill").map((item) => item.next_action) }),
    expected: { supported: [{ scope: "project", kind: "create_skill", target: "deploy-recipe" }], routing: ["queue_proposal_only"] } },
  { name: "scope-permission-refusal-no-recommendation", row: "recommendation_scope", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [v2(id, "tool_call_denied", { actor_type: "tool", actor_id: "Write", status: "denied", span_id: "u-1", signature: "user:Write" })]); },
    observe: (a) => ({ ...diag(a, "recommendation_scope"), ...kinds(a) }),
    expected: { state: "unobservable", reason: "no_ownership_evidence", value: { supported: [], unowned_failed_actions: 0 }, findings: [], recommendations: [] } },
  { name: "scope-unowned-failure-ambiguous-routing", row: "recommendation_scope", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); appendRows(root, id, [failedTool(id, "x-1", { signature: "tool:Bash:x" })]); },
    observe: (a) => ({ ...diag(a, "recommendation_scope"), ...kinds(a) }),
    expected: { state: "ambiguous", reason: "unowned_action_failure", value: { supported: [], unowned_failed_actions: 1 }, findings: [], recommendations: [] } },
  // usage_outlier single-run state
  { name: "usage-outlier-single-run-needs-cohort", row: "usage_outlier", kind: "unobservable",
    build: (root, id) => { seedGoldenRun(root, id); }, observe: (a) => diag(a, "usage_outlier"),
    expected: { state: "unobservable", reason: "requires_comparison_cohort", value: { availability: { input: "complete", output: "complete", cached: "unobserved", cost_usd: "unobserved", duration_ms: "complete" } } } },
  { name: "usage-explicit-zero-differs-from-unobserved", row: "usage_outlier", kind: "negative",
    build: (root, id) => { seedGoldenRun(root, id, { events: usageEvents(id, 0) }); },
    observe: (a) => ({ cost: a.usage.tokens.cost_usd, cost_state: a.usage.availability!.cost_usd.state, cost_refs: a.usage.availability!.cost_usd.evidence_refs.length, cached_state: a.usage.availability!.cached.state }),
    expected: { cost: 0, cost_state: "complete", cost_refs: 1, cached_state: "complete" } },
];

describe("B02 — C-DETECTORS single-run goldens", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-b02-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  for (const golden of DETECTOR_GOLDENS) {
    it(`[${golden.row}] ${golden.name}`, () => {
      golden.build(root, R);
      const analysis = analyzeRun(root, R);
      const observed = golden.observe(analysis);
      matrixObservations.push({ row: golden.row, fixture: golden.name, kind: golden.kind, observed });
      expect(observed).toEqual(golden.expected);
      expect(analyzeRun(root, R)).toEqual(analysis);
    });
  }

  it("[v1] v1-baseline-cores-match-pre-b02-analyzer", () => {
    const observed: Record<string, string> = {};
    for (const [name, build] of Object.entries(V1_BASELINE_SCENARIOS)) {
      const scenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-b02-v1-"));
      try {
        build(scenarioRoot, R);
        const core = coreProjection(analyzeRun(scenarioRoot, R));
        const golden = (V1_BASELINE as { scenarios: Record<string, unknown>; intentional_changes: Record<string, { expected: unknown }> });
        expect(core).toEqual(golden.scenarios[name] ?? golden.intentional_changes[name].expected);
        observed[name] = name in golden.scenarios ? "identical_to_pre_b02" : "intentional_change";
      } finally {
        fs.rmSync(scenarioRoot, { recursive: true, force: true });
      }
    }
    matrixObservations.push({ row: "v1_core", fixture: "v1-baseline-cores-match-pre-b02-analyzer", kind: "baseline", observed });
  });

  it("[sidecar] cross-run, escaping, missing and wrong-carrier sidecars never become proof", () => {
    seedGoldenRun(root, R);
    declare(root, R, { instructions: twoInstructions.slice(0, 1) });
    const proof = prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok" });
    const file = path.join(root, proof.proofRef);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(`"run_id":"${R}"`, `"run_id":"run-20260812-020000-beta"`));
    appendRows(root, R, [
      v2(R, "gate_concluded", { actor_type: "lead", actor_id: "main", span_id: "g-esc", signature: "gate:x", payload_ref: "../../../etc/passwd" }),
      v2(R, "gate_concluded", { actor_type: "lead", actor_id: "main", span_id: "g-miss", signature: "gate:y", payload_ref: "sidecars/absent.json" }),
      v2(R, "tool_call_finished", { actor_type: "tool", actor_id: "Bash", span_id: "g-wrong", duration_ms: 1, payload_ref: "sidecars/declaration.json" }),
    ]);
    const analysis = analyzeRun(root, R);
    const statuses = Object.fromEntries(analysis.diagnostics!.input_manifest.map((entry) => [entry.ref.replace(`.guild/runs/${R}/`, ""), entry.status]));
    const observed = { statuses, aggregate: instructionView(analysis).aggregate, checks: instructionView(analysis).checks };
    matrixObservations.push({ row: "sidecar_controls", fixture: "sidecar-cross-run-escape-missing-refused", kind: "refusal", observed });
    expect(Object.values(statuses).sort()).toEqual(["consumed", "consumed", "missing", "rejected", "rejected"]);
    expect(statuses[proof.proofRef.replace(`.guild/runs/${R}/`, "")]).toBe("rejected");
    expect(statuses["sidecars/absent.json"]).toBe("missing");
    expect(observed.checks).toEqual(["no-push:unobservable"]);
    expect(observed.aggregate).toBe("ambiguous");
  });

  it("[sidecar] symlinked sidecar file and symlinked sidecars dir are rejected", () => {
    seedGoldenRun(root, R);
    declare(root, R, { instructions: twoInstructions.slice(0, 1) });
    const proof = prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok" });
    const runDir = path.join(root, ".guild", "runs", R);
    const proofFile = path.join(root, proof.proofRef);
    fs.renameSync(proofFile, path.join(runDir, "inputs", "proof-target.json"));
    fs.symlinkSync(path.join(runDir, "inputs", "proof-target.json"), proofFile);
    const fileLink = analyzeRun(root, R);
    fs.renameSync(path.join(runDir, "sidecars"), path.join(runDir, "sidecars-real"));
    fs.symlinkSync(path.join(runDir, "sidecars-real"), path.join(runDir, "sidecars"));
    const dirLink = analyzeRun(root, R);
    const status = (analysis: RunAnalysis, ref: string) => analysis.diagnostics!.input_manifest.find((entry) => entry.ref === ref)?.status;
    const observed = {
      file_link: { proof: status(fileLink, proof.proofRef), checks: instructionView(fileLink).checks },
      dir_link: { proof: status(dirLink, proof.proofRef), declaration: status(dirLink, `.guild/runs/${R}/sidecars/declaration.json`), reason: instructionView(dirLink).reason },
    };
    matrixObservations.push({ row: "sidecar_controls", fixture: "sidecar-symlinked-file-and-dir-rejected", kind: "refusal", observed });
    expect(observed).toEqual({
      file_link: { proof: "rejected", checks: ["no-push:unobservable"] },
      dir_link: { proof: "rejected", declaration: "rejected", reason: "no_instruction_declaration" },
    });
  });

  it("[sidecar] removing a required event keeps the skipped-phase claim unobservable", () => {
    seedGoldenRun(root, R, { events: defaultEvents(R).filter((event) => event["event_name"] !== "run_closed") });
    declare(root, R, { phases: ["review"] });
    const analysis = analyzeRun(root, R);
    const observed = { eligible: analysis.eligible, missing: analysis.completeness.missing, skipped: diag(analysis, "workflow_churn").value["skipped_required_phases"], findings: kinds(analysis).findings };
    matrixObservations.push({ row: "workflow_churn", fixture: "churn-removed-run-closed-no-skip-claim", kind: "refusal", observed });
    expect(observed).toEqual({ eligible: false, missing: ["close"], skipped: [], findings: ["telemetry_gap:missing:close"] });
  });
});

describe("B02 — comparison goldens, determinism and cache freshness", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-b02-cmp-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  const ids = (n: number) => Array.from({ length: n }, (_, index) => `run-20260812-0${index + 1}0000-c${index}`);
  const dimension = (comparison: ReturnType<typeof compareRuns>, detector: DetectorId) => comparison.diagnostics!.dimensions.find((item) => item.detector === detector)!;
  const outlier = (costs: number[], provenance: Record<string, unknown> = { model: "claude-opus-5-5", provider: "anthropic" }) => {
    const runs = ids(costs.length);
    runs.forEach((id, index) => seedGoldenRun(root, id, { events: usageEvents(id, costs[index]), provenance }));
    const value = dimension(compareRuns(runs.map((id) => analyzeRun(root, id))), "usage_outlier");
    const cost = (value.value["metrics"] as Record<string, { state: string; reason: string | null; cohorts: Array<{ median: number; outliers: string[] | null }> }>)["cost_usd"];
    return { state: cost.state, reason: cost.reason, cohorts: cost.cohorts.map((cohort) => ({ median: cohort.median, outliers: cohort.outliers?.map((id) => runs.indexOf(id)) ?? null })) };
  };
  const record = (fixture: string, kind: GoldenKind, observed: unknown, row = "comparison") => matrixObservations.push({ row, fixture, kind, observed });

  it("[usage_outlier] usage-outlier-five-complete-costs", () => {
    const observed = outlier([1, 1, 1, 1, 3]);
    record("usage-outlier-five-complete-costs", "positive", observed, "usage_outlier");
    expect(observed).toEqual({ state: "observed", reason: null, cohorts: [{ median: 1, outliers: [4] }] });
  });

  it("[usage_outlier] usage-outlier-equal-two-x-median-not-outlier", () => {
    const observed = outlier([1, 1, 1, 1, 2]);
    record("usage-outlier-equal-two-x-median-not-outlier", "boundary", observed, "usage_outlier");
    expect(observed).toEqual({ state: "observed", reason: null, cohorts: [{ median: 1, outliers: [] }] });
  });

  it("[usage_outlier] usage-outlier-four-runs-unobservable", () => {
    const observed = outlier([1, 1, 1, 3]);
    record("usage-outlier-four-runs-unobservable", "unobservable", observed, "usage_outlier");
    expect(observed).toEqual({ state: "unobservable", reason: "insufficient_comparable_cohort", cohorts: [] });
  });

  it("[usage_outlier] usage-outlier-unknown-model-unobservable", () => {
    const observed = outlier([1, 1, 1, 1, 3], {});
    record("usage-outlier-unknown-model-unobservable", "unobservable", observed, "usage_outlier");
    expect(observed).toEqual({ state: "unobservable", reason: "insufficient_comparable_cohort", cohorts: [] });
  });

  it("[usage_outlier] usage-outlier-zero-median-unobservable", () => {
    const observed = outlier([0, 0, 0, 1, 3]);
    record("usage-outlier-zero-median-unobservable", "unobservable", observed, "usage_outlier");
    expect(observed).toEqual({ state: "unobservable", reason: "zero_median", cohorts: [{ median: 0, outliers: null }] });
  });

  it("[comparison] compare-two-runs-all-dimensions-present", () => {
    const [a, b] = ids(2);
    seedGoldenRun(root, a); seedGoldenRun(root, b);
    const comparison = compareRuns([analyzeRun(root, a), analyzeRun(root, b)]);
    const observed = {
      dimensions: comparison.diagnostics!.dimensions.map((item) => `${item.detector}:${item.state}`),
      runs: comparison.diagnostics!.runs.map((item) => [item.run_id === a ? "a" : "b", item.input_hash !== null, item.eligible]),
    };
    record("compare-two-runs-all-dimensions-present", "positive", observed);
    expect(observed.dimensions).toEqual([
      "clarification:unobservable", "instruction_following:ambiguous", "knowledge_memory:unobservable", "outcome_quality:unobservable",
      "prompt_action_latency:unobservable", "recommendation_scope:unobservable", "redundant_prompt:unobservable", "repeated_mistake:unobservable",
      "steering:unobservable", "tool_coverage:observed", "usage_outlier:unobservable", "workflow_churn:observed",
    ]);
    expect(observed.runs).toEqual([["a", true, true], ["b", true, true]]);
  });

  it("[comparison] compare-n-runs-new-repeated-error-run-changes-cluster-shuffle-does-not", () => {
    const runs = ids(3);
    runs.forEach((id) => seedGoldenRun(root, id));
    const repeat = (id: string) => appendRows(root, id, [failedTool(id, "f-1", { signature: "tool:Bash:abc" }), failedTool(id, "f-2", { signature: "tool:Bash:abc" })]);
    repeat(runs[0]); repeat(runs[1]);
    const clusters = (comparison: ReturnType<typeof compareRuns>) => dimension(comparison, "repeated_mistake").value["cross_run_clusters"];
    const before = compareRuns(runs.map((id) => analyzeRun(root, id)));
    const shuffled = compareRuns([...runs].reverse().map((id) => analyzeRun(root, id)));
    repeat(runs[2]);
    const after = compareRuns(runs.map((id) => analyzeRun(root, id)));
    const observed = { before: clusters(before), after: clusters(after), shuffle_equal: canonical(before) === canonical(shuffled), v1_repeated: before.repeated_signatures };
    record("compare-n-runs-new-repeated-error-run-changes-cluster-shuffle-does-not", "determinism", observed);
    expect(observed.before).toEqual([{ signature: "tool:Bash:abc", runs: [runs[0], runs[1]], occurrences: 4, phases: ["-"] }]);
    expect(observed.after).toEqual([{ signature: "tool:Bash:abc", runs, occurrences: 6, phases: ["-"] }]);
    expect(observed.shuffle_equal).toBe(true);
    expect(before.repeated_signatures).toEqual([{ signature: "tool:Bash:abc", runs: [runs[0], runs[1]], occurrences: 2 }]);
  });

  it("[comparison] compare-initiative-and-independent-targets", () => {
    const runs = ids(4);
    seedGoldenRun(root, runs[0], { initiative: "alpha" }); seedGoldenRun(root, runs[1], { initiative: "alpha" });
    seedGoldenRun(root, runs[2], { scope: "independent", group: "research" }); seedGoldenRun(root, runs[3], { scope: "independent", group: "research" });
    const initiative = compareRuns(resolveComparisonTarget(root, { kind: "initiative", id: "alpha" }));
    const independent = compareRuns(resolveComparisonTarget(root, { kind: "independent", id: "research" }));
    const observed = { initiative: initiative.diagnostics!.runs.map((item) => item.run_id), independent: independent.diagnostics!.runs.map((item) => item.run_id), dimensions: [initiative, independent].map((item) => item.diagnostics!.dimensions.length) };
    record("compare-initiative-and-independent-targets", "positive", observed);
    expect(observed).toEqual({ initiative: runs.slice(0, 2), independent: runs.slice(2), dimensions: [12, 12] });
  });

  it("[comparison] compare-zero-eligible-runs-unobservable", () => {
    const runs = ids(2);
    runs.forEach((id) => seedGoldenRun(root, id, { withConfig: false }));
    const comparison = compareRuns(runs.map((id) => analyzeRun(root, id)));
    const observed = sortedReasons(comparison);
    record("compare-zero-eligible-runs-unobservable", "unobservable", observed);
    expect(observed).toEqual(Object.fromEntries(DETECTOR_IDS.map((id) => [id, id === "usage_outlier" ? "unobservable:insufficient_comparable_cohort" : "unobservable:no_eligible_runs"])));
  });

  it("[comparison] compare-incomparable-declared-instruction-scopes", () => {
    const runs = ids(2);
    runs.forEach((id, index) => {
      seedGoldenRun(root, id);
      declare(root, id, { instructions: [twoInstructions[index]] });
      prove(root, id, { id: twoInstructions[index].instruction_id, result: "passed", verifierStatus: "ok" });
    });
    const value = dimension(compareRuns(runs.map((id) => analyzeRun(root, id))), "instruction_following");
    const observed = { state: value.state, reason: value.reason, satisfied: (value.value["by_aggregate"] as Record<string, string[]>)["satisfied"].length };
    record("compare-incomparable-declared-instruction-scopes", "negative", observed, "instruction_following");
    expect(observed).toEqual({ state: "ambiguous", reason: "incomparable_declared_scopes", satisfied: 2 });
  });

  it("[comparison] compare-recommendation-kind-cluster-across-runs", () => {
    const runs = ids(2);
    for (const id of runs) {
      seedGoldenRun(root, id);
      capabilityEvidence(root, id, "sidecars/cap-1.json", { action_signature: "tool:Bash:deploy", owner: "project", capability_kind: "skill", target: "deploy-recipe" });
      appendRows(root, id, [failedTool(id, "d-0", { signature: "tool:Bash:deploy", payload_ref: "sidecars/cap-1.json" }), failedTool(id, "d-1", { signature: "tool:Bash:deploy" })]);
    }
    const comparison = compareRuns(runs.map((id) => analyzeRun(root, id)));
    record("compare-recommendation-kind-cluster-across-runs", "positive", comparison.diagnostics!.recommendation_clusters, "recommendation_scope");
    expect(comparison.diagnostics!.recommendation_clusters).toEqual([{ scope: "project", kind: "create_skill", target: "deploy-recipe", runs }]);
  });

  it("[comparison] compare-legacy-artifact-usage-unknown", () => {
    const runs = ids(2);
    runs.forEach((id) => seedGoldenRun(root, id));
    const [a, b] = runs.map((id) => analyzeRun(root, id));
    const legacy = { ...b, usage: { ...b.usage, availability: undefined }, diagnostics: undefined } as RunAnalysis;
    const comparison = compareRuns([a, legacy]);
    const cost = (dimension(comparison, "usage_outlier").value["metrics"] as Record<string, { unknown: string[] }>)["input"].unknown;
    const observed = { unknown: cost, legacy_state: dimension(comparison, "steering").by_run[b.run_id].state, legacy_input_hash: comparison.diagnostics!.runs[1].input_hash };
    record("compare-legacy-artifact-usage-unknown", "unobservable", observed, "usage_outlier");
    expect(observed).toEqual({ unknown: [b.run_id], legacy_state: "legacy_unknown", legacy_input_hash: null });
  });

  it("[cache] cache-hit-and-invalidation-by-every-consumed-input", () => {
    const observed: Record<string, string> = {};
    const prepare = () => {
      fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
      seedGoldenRun(root, R);
      declare(root, R, { instructions: twoInstructions.slice(0, 1) });
      prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok" });
      writeRunAnalysis(root, analyzeRun(root, R));
    };
    const runFile = (relative: string) => path.join(root, ".guild", "runs", R, relative);
    const mutations: Record<string, () => void> = {
      unchanged: () => undefined,
      "event-byte": () => fs.appendFileSync(runFile("logs/v1.4-events.jsonl"), "\n"),
      "run-yaml": () => fs.appendFileSync(runFile("run.yaml"), "# touched\n"),
      config: () => fs.appendFileSync(runFile("plugin-config-snapshot.json"), " "),
      provenance: () => fs.appendFileSync(runFile("provenance.json"), " "),
      "sidecar-proof-byte": () => { const file = fs.readdirSync(runFile("sidecars")).find((name) => name.startsWith("proof-"))!; fs.appendFileSync(runFile(`sidecars/${file}`), " "); },
      "assessed-input-byte": () => fs.appendFileSync(runFile("inputs/assessed.txt"), "x"),
      "legacy-artifact": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        delete cached.diagnostics;
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      ...Object.fromEntries(["assessments", "usage", "completeness"].map((key) => [`truncated-${key}`, () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        delete cached[key];
        fs.writeFileSync(file, JSON.stringify(cached));
      }])),
      "malformed-usage-availability": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        delete cached.usage.availability.cost_usd;
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "missing-identity": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        delete cached.identity;
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "null-finding": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        cached.findings = [null];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "array-enum-run-scope": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        cached.identity.run_scope = ["independent"];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "array-enum-finding-kind-severity": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        cached.findings = [{ id: "f-1", kind: ["workflow_churn"], severity: ["medium"], summary: "x", evidence_refs: [], signature: "sig" }];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "array-enum-assessment-status": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        cached.assessments.workflow.status = ["unobservable"];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "array-enum-availability-state": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        const metric = Object.keys(cached.usage.availability)[0];
        cached.usage.availability[metric].state = ["complete"];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
      "tampered-manifest": () => {
        const file = path.join(root, ".guild", "analysis", "runs", R, "analysis.json");
        const cached = JSON.parse(fs.readFileSync(file, "utf8"));
        cached.diagnostics.input_manifest = [];
        fs.writeFileSync(file, JSON.stringify(cached));
      },
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      prepare();
      mutate();
      const loaded = loadOrAnalyzeRun(root, R);
      observed[name] = `${loaded.cache}:${loaded.reason}`;
      if (loaded.cache === "recomputed") expect(loaded.analysis).toEqual(analyzeRun(root, R));
    }
    record("cache-hit-and-invalidation-by-every-consumed-input", "freshness", observed, "cache");
    expect(observed).toEqual({
      unchanged: "hit:null", "event-byte": "recomputed:stale_source", "run-yaml": "recomputed:stale_source", config: "recomputed:stale_source",
      provenance: "recomputed:stale_source", "sidecar-proof-byte": "recomputed:stale_inputs", "assessed-input-byte": "recomputed:stale_inputs",
      "legacy-artifact": "recomputed:legacy_diagnostics", "tampered-manifest": "recomputed:malformed",
      "truncated-assessments": "recomputed:malformed", "truncated-usage": "recomputed:malformed", "truncated-completeness": "recomputed:malformed",
      "malformed-usage-availability": "recomputed:malformed", "missing-identity": "recomputed:malformed", "null-finding": "recomputed:malformed",
      "array-enum-run-scope": "recomputed:malformed", "array-enum-finding-kind-severity": "recomputed:malformed",
      "array-enum-assessment-status": "recomputed:malformed", "array-enum-availability-state": "recomputed:malformed",
    });
  });

  it("[cache] verification-input-ref-differs-recomputes", () => {
    seedGoldenRun(root, R);
    declare(root, R, { instructions: twoInstructions.slice(0, 1) });
    writeRunFile(root, R, "inputs/verify.txt", ASSESSED_INPUT);
    prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok", verificationInputRef: "inputs/verify.txt" });
    writeRunAnalysis(root, analyzeRun(root, R));
    const loaded = loadOrAnalyzeRun(root, R);
    const observed = { cache: `${loaded.cache}:${loaded.reason}`, aggregate: instructionView(loaded.analysis).aggregate };
    record("cache-verification-input-ref-differs-recomputes", "freshness", observed, "cache");
    expect(observed).toEqual({ cache: "recomputed:stale_inputs", aggregate: "satisfied" });
    expect(loaded.analysis).toEqual(analyzeRun(root, R));
  });

  it("[determinism] same-id-reanalysis-and-input-mutation-freshness", () => {
    seedGoldenRun(root, R);
    declare(root, R, { instructions: twoInstructions.slice(0, 1) });
    const { proofRef } = prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok" });
    const first = analyzeRun(root, R);
    const again = analyzeRun(root, R);
    fs.appendFileSync(path.join(root, proofRef), " ");
    const mutated = analyzeRun(root, R);
    const observed = {
      same_id_equal: canonical(first) === canonical(again),
      source_hash_stable: mutated.source_hash === first.source_hash,
      input_hash_changed: mutated.diagnostics!.input_hash !== first.diagnostics!.input_hash,
      aggregate_before: instructionView(first).aggregate,
      aggregate_after: instructionView(mutated).aggregate,
    };
    record("same-id-reanalysis-and-input-mutation-freshness", "freshness", observed, "determinism");
    expect(observed).toEqual({ same_id_equal: true, source_hash_stable: true, input_hash_changed: true, aggregate_before: "satisfied", aggregate_after: "satisfied" });
  });

  afterAll(() => {
    const out = process.env["B02_MATRIX_OUT"];
    if (!out) return;
    const rows = [...new Set(matrixObservations.map((item) => item.row))].sort();
    fs.writeFileSync(out, JSON.stringify({
      schema: "guild.b02.detector_fixture_matrix.v1",
      test_file: "src/domains/telemetry/run-analysis.test.ts",
      contract: "C-DETECTORS/v1",
      rows: Object.fromEntries(rows.map((row) => [row, matrixObservations.filter((item) => item.row === row)
        .map(({ fixture, kind, observed }) => ({ fixture, kind, observed }))])),
    }, null, 2) + "\n");
  });
});

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function sortedReasons(comparison: ReturnType<typeof compareRuns>): Record<string, string> {
  return Object.fromEntries(comparison.diagnostics!.dimensions.map((item) => [item.detector, `${item.state}:${item.reason}`]));
}

// ─────────────────────────────────────────────────────────────────────────────
// B03 — read-only freshness inspection and recommendation authority.
// ─────────────────────────────────────────────────────────────────────────────

function treeSnapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const key = path.relative(dir, file);
      if (entry.isSymbolicLink()) out[key] = `symlink:${fs.readlinkSync(file)}`;
      else if (entry.isDirectory()) { out[`${key}/`] = "dir"; walk(file); }
      else out[key] = fs.readFileSync(file, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** RUN_A with one consumed sidecar plus one plugin and one project recommendation. */
function seedDecidable(root: string): RunAnalysis {
  seedRun(root, RUN_A);
  phaseCursor(root, RUN_A, ["plan", "execute"]);
  const analysis = analyzeRun(root, RUN_A);
  const evidence = [`.guild/runs/${RUN_A}/run.yaml`];
  analysis.recommendations = [
    {
      ...recommendationEnvelope(RUN_A, "project", "create_skill", evidence), id: "rec-project", source_analysis_id: analysis.analysis_id,
      scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
      status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
    },
    {
      ...recommendationEnvelope(RUN_A, "plugin", "telemetry_gap", evidence), id: "rec-plugin", source_analysis_id: analysis.analysis_id,
      scope: "plugin", kind: "telemetry_gap", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [RUN_A],
      proposed_action: "Draft a Guild issue.", suggested_owner: "guild-plugin", next_action: "ask_user_before_filing", requires_user_approval: true,
      status: "proposed", routing: { action: "ask_user_before_filing", requires_user_approval: true, target: "guild-plugin" },
    },
  ];
  writeRunAnalysis(root, analysis);
  return analysis;
}

describe("B03 — read-only inspection and decision authority", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-b03-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const artifactFile = (r: string) => path.join(r, ".guild", "analysis", "runs", RUN_A, "analysis.json");
  const editArtifact = (r: string, edit: (cached: Record<string, any>) => void) => {
    const cached = JSON.parse(fs.readFileSync(artifactFile(r), "utf8"));
    edit(cached);
    fs.writeFileSync(artifactFile(r), JSON.stringify(cached));
  };

  it("[inspect] run-inspect-reports-every-state-with-canonical-id-and-exact-hash-binding", () => {
    seedRun(root, RUN_A);
    phaseCursor(root, RUN_A, ["plan", "execute"]);
    const fresh = analyzeRun(root, RUN_A);
    expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({
      ok: true, state: "missing", reason: "artifact_missing", source_hash: null,
      current_source_hash: fresh.source_hash, current_input_hash: fresh.diagnostics!.input_hash, eligible: false,
    });
    writeRunAnalysis(root, fresh);
    expect(inspectAnalysisArtifact(root, "run", RUN_A)).toEqual({
      ok: true, state: "current", kind: "run", source_id: RUN_A, artifact_ref: `.guild/analysis/runs/${RUN_A}/analysis.json`,
      schema_version: "guild.run_analysis.v1", source_analysis_id: fresh.analysis_id, source_hash: fresh.source_hash,
      current_source_hash: fresh.source_hash, input_hash: fresh.diagnostics!.input_hash, current_input_hash: fresh.diagnostics!.input_hash,
      eligible: true, reason: null,
    });

    const sidecar = path.join(root, ".guild", "runs", RUN_A, "sidecars", "cursor.json");
    const sidecarBytes = fs.readFileSync(sidecar, "utf8");
    fs.appendFileSync(sidecar, " ");
    const staleInputs = inspectAnalysisArtifact(root, "run", RUN_A);
    expect(staleInputs).toMatchObject({ state: "stale", reason: "stale_inputs", source_hash: fresh.source_hash, current_source_hash: fresh.source_hash, eligible: false });
    expect(staleInputs.current_input_hash).not.toBe(fresh.diagnostics!.input_hash);
    fs.writeFileSync(sidecar, sidecarBytes);

    appendRepeatedFailure(root, RUN_A);
    const staleSource = inspectAnalysisArtifact(root, "run", RUN_A);
    expect(staleSource).toMatchObject({ state: "stale", reason: "stale_source", source_hash: fresh.source_hash, eligible: false });
    expect(staleSource.current_source_hash).toBe(analyzeRun(root, RUN_A).source_hash);

    const unsupported: Array<[string, (cached: Record<string, any>) => void, string]> = [
      ["legacy", (cached) => { delete cached.diagnostics; }, "legacy_diagnostics_missing"],
      ["contract", (cached) => { cached.diagnostics.contract = "C-DETECTORS/v9"; }, "unknown_diagnostics_contract"],
      ["core-schema", (cached) => { cached.schema_version = "guild.run_analysis.v9"; }, "unknown_core_schema"],
    ];
    for (const [, edit, reason] of unsupported) {
      writeRunAnalysis(root, analyzeRun(root, RUN_A));
      editArtifact(root, edit);
      expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ ok: true, state: "unsupported", reason, eligible: false });
    }

    const refused: Array<[string, () => void, string]> = [
      ["malformed-json", () => fs.writeFileSync(artifactFile(root), "{ not json"), "malformed_artifact"],
      ["forged-analysis-id", () => editArtifact(root, (cached) => { cached.analysis_id = `analysis:${RUN_A}:000000000000`; }), "malformed_artifact"],
      ["tampered-input-hash", () => editArtifact(root, (cached) => { cached.diagnostics.input_hash = `sha256:${"0".repeat(64)}`; }), "malformed_artifact"],
      ["foreign-recommendation", () => editArtifact(root, (cached) => { cached.recommendations = [{ id: "../x" }]; }), "malformed_artifact"],
    ];
    for (const [, corrupt, reason] of refused) {
      writeRunAnalysis(root, analyzeRun(root, RUN_A));
      corrupt();
      expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ ok: false, state: "refused", reason, eligible: false });
    }
    expect(inspectAnalysisArtifact(root, "run", "../escape")).toMatchObject({ state: "refused", reason: "unsafe_source_id" });
    expect(inspectAnalysisArtifact(root, "run", "queue")).toMatchObject({ state: "refused", reason: "unsafe_source_id" });
  });

  it("[inspect] inspect-refuses-symlinked-artifact-and-run-inputs", () => {
    seedRun(root, RUN_A);
    writeRunAnalysis(root, analyzeRun(root, RUN_A));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-b03-outside-"));
    try {
      const analysisDir = path.join(root, ".guild", "analysis", "runs", RUN_A);
      fs.cpSync(analysisDir, path.join(outside, RUN_A), { recursive: true });
      fs.rmSync(analysisDir, { recursive: true });
      fs.symlinkSync(path.join(outside, RUN_A), analysisDir);
      expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ state: "refused", reason: "unsafe_artifact_path" });
      fs.rmSync(analysisDir);
      fs.cpSync(path.join(outside, RUN_A), analysisDir, { recursive: true });
      const config = path.join(root, ".guild", "runs", RUN_A, "plugin-config-snapshot.json");
      fs.renameSync(config, path.join(outside, "config.json"));
      fs.symlinkSync(path.join(outside, "config.json"), config);
      expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ state: "refused", reason: "unsafe_source_inputs" });
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("[inspect] inspect-makes-no-writes-in-any-state", () => {
    seedRun(root, RUN_A);
    phaseCursor(root, RUN_A, ["plan", "execute"]);
    const kinds = ["run", "comparison"] as const;
    const probe = () => kinds.forEach((kind) => [RUN_A, "comparison-0000000000000000", "../escape", "activity"].forEach((id) => inspectAnalysisArtifact(root, kind, id)));
    const bare = treeSnapshot(root);
    probe();
    expect(treeSnapshot(root)).toEqual(bare);
    expect(fs.existsSync(path.join(root, ".guild", "analysis"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations"))).toBe(false);
    writeRunAnalysis(root, analyzeRun(root, RUN_A));
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "sidecars", "cursor.json"), " ");
    const written = treeSnapshot(root);
    probe();
    expect(treeSnapshot(root)).toEqual(written);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", ".write.lock"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", ".transaction.json"))).toBe(false);
  });

  it("[inspect] comparison-inspect-binds-every-retained-run-source-and-input-hash", () => {
    seedRun(root, RUN_A);
    seedRun(root, RUN_B);
    phaseCursor(root, RUN_B, ["plan", "execute"]);
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    writeRunComparison(root, comparison);
    const current = inspectAnalysisArtifact(root, "comparison", comparison.comparison_id);
    expect(current).toMatchObject({
      ok: true, state: "current", kind: "comparison", source_analysis_id: comparison.comparison_id, schema_version: "guild.run_comparison.v1",
      artifact_ref: `.guild/analysis/comparisons/${comparison.comparison_id}/comparison.json`, eligible: true, reason: null,
    });
    expect(current.source_hash).toBe(current.current_source_hash);
    expect(current.input_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(current.input_hash).toBe(current.current_input_hash);

    const sidecar = path.join(root, ".guild", "runs", RUN_B, "sidecars", "cursor.json");
    fs.appendFileSync(sidecar, " ");
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "stale", reason: "stale_inputs", source_hash: current.source_hash, current_source_hash: current.source_hash });
    appendRepeatedFailure(root, RUN_A);
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "stale", reason: "stale_source" });
    fs.rmSync(path.join(root, ".guild", "runs", RUN_A), { recursive: true });
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "stale", reason: "retained_run_missing", current_source_hash: null });

    const file = path.join(root, ".guild", "analysis", "comparisons", comparison.comparison_id, "comparison.json");
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...cached, diagnostics: undefined }));
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "unsupported", reason: "legacy_diagnostics_missing", eligible: false });
    fs.writeFileSync(file, JSON.stringify({ ...cached, diagnostics: { ...cached.diagnostics, runs: cached.diagnostics.runs.map((run: Record<string, unknown>) => ({ ...run, input_hash: null })) } }));
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "unsupported", reason: "retained_run_legacy_diagnostics" });
    fs.writeFileSync(file, JSON.stringify({ ...cached, run_ids: [RUN_B, RUN_A] }));
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "refused", reason: "malformed_artifact" });
    fs.writeFileSync(file, JSON.stringify({ ...cached, source_hashes: [cached.source_hashes[1], cached.source_hashes[0]] }));
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "refused", reason: "malformed_artifact" });
  });

  it("[decide] conditional-decide-requires-exact-identity-supported-diagnostics-and-fresh-inputs", () => {
    const analysis = seedDecidable(root);
    const expected = { analysisId: analysis.analysis_id, inputHash: analysis.diagnostics!.input_hash };
    const unchanged = treeSnapshot(root);
    const refusals: Array<[string, () => void, Partial<typeof expected> | null, RegExp]> = [
      ["malformed-hash", () => undefined, { inputHash: "sha256:XYZ" }, /expected-input-hash/],
      ["path-like-analysis-id", () => undefined, { analysisId: "../analysis" }, /expected-analysis-id/],
      ["other-analysis-id", () => undefined, { analysisId: `analysis:${RUN_A}:000000000000` }, /expected_context_changed: analysis_identity_changed/],
      ["other-input-hash", () => undefined, { inputHash: `sha256:${"0".repeat(64)}` }, /expected_context_changed: input_hash_changed/],
      ["sidecar-changed", () => fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "sidecars", "cursor.json"), " "), null, /expected_context_changed: stale:stale_inputs/],
      ["legacy-diagnostics", () => editArtifact(root, (cached) => { delete cached.diagnostics; }), null, /expected_context_changed: unsupported:legacy_diagnostics_missing/],
    ];
    for (const [label, mutate, override, refusal] of refusals) {
      fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
      seedDecidable(root);
      mutate();
      const before = treeSnapshot(root);
      for (const id of ["rec-plugin", "rec-project"]) {
        expect(() => decideRecommendation(root, RUN_A, id, "accept", { ...expected, ...override }), label).toThrow(refusal);
      }
      expect(treeSnapshot(root), label).toEqual(before);
    }
    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    seedDecidable(root);
    expect(treeSnapshot(root)).toEqual(unchanged);
    expect(decideRecommendation(root, RUN_A, "rec-plugin", "accept", expected)).toMatchObject({ status: "accepted", effect: "plugin_draft_written" });
    expect(decideRecommendation(root, RUN_A, "rec-project", "accept", expected)).toMatchObject({ status: "queued", effect: "project_proposal_queued" });
    const after = treeSnapshot(root);
    const changed = Object.keys({ ...unchanged, ...after }).filter((key) => unchanged[key] !== after[key]).sort();
    expect(changed).toEqual([
      ".guild/recommendations/activity.jsonl",
      ".guild/recommendations/drafts/",
      ".guild/recommendations/drafts/rec-plugin.md",
      ".guild/recommendations/queue.jsonl",
      `.guild/recommendations/${RUN_A}.jsonl`,
    ]);
    expect(after[".guild/recommendations/drafts/rec-plugin.md"]).toContain("external filing has not occurred");
  });

  it("[decide] historical-direct-decide-keeps-manual-authority-but-cannot-bypass-source-freshness", () => {
    seedDecidable(root);
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "sidecars", "cursor.json"), " ");
    const before = treeSnapshot(root);
    expect(() => decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toThrow(/source_context_stale: stale_inputs/);
    expect(treeSnapshot(root)).toEqual(before);

    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    seedDecidable(root);
    editArtifact(root, (cached) => { delete cached.diagnostics; });
    expect(decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toMatchObject({ status: "accepted", effect: "plugin_draft_written" });
    appendRepeatedFailure(root, RUN_A);
    const stale = treeSnapshot(root);
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept")).toThrow(/source_context_stale: stale_source/);
    expect(treeSnapshot(root)).toEqual(stale);
  });

  it("[regenerate] regeneration-preserves-progressed-decisions-and-invalidates-prior-consent", () => {
    const analysis = seedDecidable(root);
    const expected = { analysisId: analysis.analysis_id, inputHash: analysis.diagnostics!.input_hash };
    decideRecommendation(root, RUN_A, "rec-project", "accept", expected);
    decideRecommendation(root, RUN_A, "rec-plugin", "accept", expected);
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T01:00:09.000Z", event: "phase_start", run_id: RUN_A, phase: "review" }) + "\n");
    const regenerated = loadOrAnalyzeRun(root, RUN_A);
    expect(regenerated).toMatchObject({ cache: "recomputed", reason: "stale_source" });
    regenerated.analysis.recommendations = analysis.recommendations.map((item) => ({ ...item, source_analysis_id: regenerated.analysis.analysis_id }));
    writeRunAnalysis(root, regenerated.analysis);
    const inspected = inspectAnalysisArtifact(root, "run", RUN_A);
    expect(inspected).toMatchObject({ state: "current", source_analysis_id: regenerated.analysis.analysis_id });
    expect(inspected.source_analysis_id).not.toBe(analysis.analysis_id);
    const statuses = Object.fromEntries(fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN_A}.jsonl`), "utf8").trim().split("\n")
      .map((row) => JSON.parse(row)).map((row) => [row.id, row.status]));
    expect(statuses).toEqual({ "rec-plugin": "accepted", "rec-project": "queued" });
    expect(loadOrAnalyzeRun(root, RUN_A)).toMatchObject({ cache: "hit" });
    const before = treeSnapshot(root);
    expect(() => decideRecommendation(root, RUN_A, "rec-project", "accept", expected)).toThrow(/expected_context_changed: analysis_identity_changed/);
    expect(treeSnapshot(root)).toEqual(before);
    expect(decideRecommendation(root, RUN_A, "rec-project", "accept", { analysisId: inspected.source_analysis_id!, inputHash: inspected.input_hash! }))
      .toMatchObject({ status: "queued", effect: "project_proposal_queued" });
  });

  it("[decide] unknown-contract-direct-decide-cannot-skip-additive-freshness", () => {
    seedDecidable(root);
    editArtifact(root, (cached) => { cached.diagnostics.contract = "C-DETECTORS/v9"; });
    fs.appendFileSync(path.join(root, ".guild", "runs", RUN_A, "sidecars", "cursor.json"), " ");
    const inspected = inspectAnalysisArtifact(root, "run", RUN_A);
    expect(inspected).toMatchObject({ state: "unsupported", reason: "unknown_diagnostics_contract", eligible: false });
    expect(inspected.source_hash).toBe(inspected.current_source_hash);
    const before = treeSnapshot(root);
    for (const id of ["rec-plugin", "rec-project"]) {
      expect(() => decideRecommendation(root, RUN_A, id, "accept")).toThrow(/source_context_stale: stale_inputs/);
    }
    expect(treeSnapshot(root)).toEqual(before);

    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    seedDecidable(root);
    editArtifact(root, (cached) => { cached.diagnostics.contract = "C-DETECTORS/v9"; delete cached.diagnostics.input_hash; });
    const unverifiable = treeSnapshot(root);
    expect(() => decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toThrow(/source_context_stale: stale_inputs/);
    expect(treeSnapshot(root)).toEqual(unverifiable);

    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    seedDecidable(root);
    editArtifact(root, (cached) => { cached.diagnostics.contract = "C-DETECTORS/v9"; });
    expect(decideRecommendation(root, RUN_A, "rec-plugin", "accept")).toMatchObject({ status: "accepted", effect: "plugin_draft_written" });
  });

  it("[inspect] distinct-verification-input-ref-is-current-when-fresh-and-stale-when-mutated", () => {
    const seed = (): { expected: { analysisId: string; inputHash: string }; verify: string } => {
      seedGoldenRun(root, R);
      declare(root, R, { instructions: twoInstructions.slice(0, 1) });
      const verify = path.join(root, writeRunFile(root, R, "inputs/verify.txt", ASSESSED_INPUT));
      prove(root, R, { id: "no-push", result: "passed", verifierStatus: "ok", verificationInputRef: "inputs/verify.txt" });
      const analysis = analyzeRun(root, R);
      expect(analysis.diagnostics!.input_manifest.map((entry) => entry.ref)).toContain(`.guild/runs/${R}/inputs/verify.txt`);
      const evidence = [`.guild/runs/${R}/run.yaml`];
      analysis.recommendations = [{
        ...recommendationEnvelope(R, "project", "create_skill", evidence), id: "rec-verify", source_analysis_id: analysis.analysis_id,
        scope: "project", kind: "create_skill", confidence: "high", severity: "medium", evidence_refs: evidence, affected_runs: [R],
        proposed_action: "Draft a project skill.", suggested_owner: "project", next_action: "queue_proposal_only", requires_user_approval: true,
        status: "proposed", routing: { action: "queue_proposal_only", requires_user_approval: true, target: "project-local" },
      }];
      writeRunAnalysis(root, analysis);
      return { expected: { analysisId: analysis.analysis_id, inputHash: analysis.diagnostics!.input_hash }, verify };
    };
    const fresh = seed();
    expect(inspectAnalysisArtifact(root, "run", R)).toMatchObject({
      state: "current", eligible: true, reason: null, input_hash: fresh.expected.inputHash, current_input_hash: fresh.expected.inputHash,
    });
    expect(decideRecommendation(root, R, "rec-verify", "accept", fresh.expected)).toMatchObject({ status: "queued", effect: "project_proposal_queued" });

    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    const mutated = seed();
    fs.appendFileSync(mutated.verify, "changed");
    expect(inspectAnalysisArtifact(root, "run", R)).toMatchObject({ state: "stale", reason: "stale_inputs", eligible: false });
    const before = treeSnapshot(root);
    expect(() => decideRecommendation(root, R, "rec-verify", "accept", mutated.expected)).toThrow(/expected_context_changed: stale:stale_inputs/);
    expect(() => decideRecommendation(root, R, "rec-verify", "accept")).toThrow(/source_context_stale: stale_inputs/);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it("[inspect] malformed-diagnostic-results-and-comparison-dimensions-refuse-and-never-authorize", () => {
    const analysis = seedDecidable(root);
    const expected = { analysisId: analysis.analysis_id, inputHash: analysis.diagnostics!.input_hash };
    const runCorruptions: Array<[string, (cached: Record<string, any>) => void]> = [
      ["results-null-entry", (cached) => { cached.diagnostics.results = [null]; }],
      ["results-null-among-valid", (cached) => { cached.diagnostics.results[0] = null; }],
      ["results-string-state", (cached) => { cached.diagnostics.results[0].state = 7; }],
      ["results-unknown-state", (cached) => { cached.diagnostics.results[0].state = "satisfied"; }],
      ["results-extra-key", (cached) => { cached.diagnostics.results[0].injected = true; }],
      ["results-missing-detector", (cached) => { cached.diagnostics.results.pop(); }],
      ["results-duplicate-detector", (cached) => { cached.diagnostics.results[1] = cached.diagnostics.results[0]; }],
      ["results-string-value", (cached) => { cached.diagnostics.results[0].value = "x"; }],
    ];
    for (const [label, edit] of runCorruptions) {
      fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
      seedDecidable(root);
      editArtifact(root, edit);
      expect(inspectAnalysisArtifact(root, "run", RUN_A), label).toMatchObject({ ok: false, state: "refused", reason: "malformed_artifact", eligible: false });
      const before = treeSnapshot(root);
      expect(() => decideRecommendation(root, RUN_A, "rec-plugin", "accept", expected), label).toThrow(/expected_context_changed: refused:malformed_artifact/);
      expect(() => decideRecommendation(root, RUN_A, "rec-plugin", "accept"), label).toThrow(/recommendation source refused: malformed_artifact/);
      expect(treeSnapshot(root), label).toEqual(before);
    }

    seedRun(root, RUN_B);
    const comparison = compareRuns([analyzeRun(root, RUN_A), analyzeRun(root, RUN_B)]);
    writeRunComparison(root, comparison);
    expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id)).toMatchObject({ state: "current" });
    const file = path.join(root, ".guild", "analysis", "comparisons", comparison.comparison_id, "comparison.json");
    const cached = JSON.parse(fs.readFileSync(file, "utf8"));
    const dims = cached.diagnostics.dimensions as Array<Record<string, any>>;
    const comparisonCorruptions: Array<[string, unknown]> = [
      ["dimensions-null-entry", { ...cached.diagnostics, dimensions: [null] }],
      ["dimensions-missing", { ...cached.diagnostics, dimensions: undefined }],
      ["dimension-string-state", { ...cached.diagnostics, dimensions: [{ ...dims[0], state: 7 }, ...dims.slice(1)] }],
      ["dimension-extra-key", { ...cached.diagnostics, dimensions: [{ ...dims[0], injected: true }, ...dims.slice(1)] }],
      ["dimension-by-run-extra-key", { ...cached.diagnostics, dimensions: [{ ...dims[0], by_run: Object.fromEntries(Object.entries(dims[0].by_run).map(([id, entry]) => [id, { ...(entry as object), injected: 1 }])) }, ...dims.slice(1)] }],
      ["dimension-foreign-comparable-run", { ...cached.diagnostics, dimensions: [{ ...dims[0], comparable_runs: ["run-other"] }, ...dims.slice(1)] }],
      ["runs-entry-extra-key", { ...cached.diagnostics, runs: cached.diagnostics.runs.map((run: Record<string, unknown>) => ({ ...run, injected: 1 })) }],
    ];
    for (const [label, diagnostics] of comparisonCorruptions) {
      fs.writeFileSync(file, JSON.stringify({ ...cached, diagnostics }));
      expect(inspectAnalysisArtifact(root, "comparison", comparison.comparison_id), label).toMatchObject({ ok: false, state: "refused", reason: "malformed_artifact", eligible: false });
    }
  });

  it("[inspect] unreadable-artifact-and-unstatable-run-refuse-without-raw-errors", () => {
    seedDecidable(root);
    const target = fs.realpathSync(artifactFile(root));
    const original = fs.readFileSync;
    const read = spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file) === target) throw Object.assign(new Error(`EACCES: permission denied, open '${target}'`), { code: "EACCES" });
      return (original as (...args: unknown[]) => unknown)(file, ...rest);
    }) as typeof fs.readFileSync);
    try {
      expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ ok: false, state: "refused", reason: "artifact_unreadable", eligible: false });
    } finally {
      read.mockRestore();
    }
    fs.rmSync(path.join(root, ".guild"), { recursive: true, force: true });
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs"), "not a directory");
    expect(inspectAnalysisArtifact(root, "run", RUN_A)).toMatchObject({ ok: false, state: "refused", reason: "unsafe_source_inputs", eligible: false });
  });

  it("[recovery] conditional-decide-recovery-rejects-capability-journal-before-consent", () => {
    const analysis = seedDecidable(root);
    const injected = path.join(root, ".guild", "skills", "injected.md");
    const journal = path.join(root, ".guild", "recommendations", ".transaction.json");
    fs.writeFileSync(journal, JSON.stringify({
      schema_version: "guild.recommendation_transaction.v1",
      transaction_id: "transaction-capability-escape",
      files: [{ path: path.relative(root, injected), previous: "malicious capability\n" }],
    }) + "\n");
    expect(() => decideRecommendation(root, RUN_A, "rec-plugin", "accept", { analysisId: analysis.analysis_id, inputHash: analysis.diagnostics!.input_hash }))
      .toThrow(/analyzer-owned|transaction target/i);
    expect(fs.existsSync(injected)).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", "drafts"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "recommendations", "activity.jsonl"))).toBe(false);
  });
});
