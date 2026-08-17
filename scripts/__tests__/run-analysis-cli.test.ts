import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const RUN = "run-20260812-030000-cli";

describe("run-analysis CLI", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-cli-"));
    const dir = path.join(root, ".guild", "runs", RUN);
    fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "run.yaml"), [
      "schema_version: guild.run.v1",
      `run_id: ${RUN}`,
      "run_scope: independent",
      "initiative_attachment: null",
      "independent_run_group: cli",
      "config_snapshot_ref: plugin-config-snapshot.json",
      "run_class: full",
      "status: closed",
      "host:",
      "  resolved: codex",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(dir, "plugin-config-snapshot.json"), JSON.stringify({
      schema_version: "guild.plugin_config_snapshot.v1", run_id: RUN, effective: {}, config_source_layers: {},
      plugin: { version: "2.6.0", ref: "sha256:plugin" }, host_adapter: { requested: "auto", resolved: "codex", capabilities_ref: null },
      registry_hashes: { skills: null, agents: null }, command_surface_version: "sha256:commands",
      redaction_policy: "scrubbed-config-v1", environment_capabilities: {},
    }) + "\n");
    fs.writeFileSync(path.join(dir, "provenance.json"), JSON.stringify({ schema_version: "guild.provenance.v1", run_id: RUN }) + "\n");
    const events = [
      { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T03:00:00Z", run_id: RUN, lane_id: "", event_class: "prompt_received", actor_type: "user", actor_id: "operator", status: "ok", span_id: "prompt-1", prompt_hash: "hash-1", redaction: "omitted" },
      { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T03:00:01Z", run_id: RUN, lane_id: "T1", event_class: "agent_dispatched", actor_type: "agent", actor_id: "tooling", status: "ok", span_id: "agent-1", task_id: "T1" },
      { ts: "2026-08-12T03:00:02.000Z", event: "tool_call", run_id: RUN, lane_id: "T1", tool: "Bash", command_redacted: "npm test", result_excerpt_redacted: "ok", status: "ok", latency_ms: 1 },
      { ts: "2026-08-12T03:00:03.000Z", event: "phase_start", run_id: RUN, phase: "execute" },
      { ts: "2026-08-12T03:00:04.000Z", event: "loop_round_start", run_id: RUN, lane_id: "T1", loop_layer: "L3", round_number: 1, cap: 3 },
      { ts: "2026-08-12T03:00:05.000Z", event: "gate_decision", run_id: RUN, gate: "gate-3-plan", decision: "approved", source: "user" },
      { schema_version: "guild.trace_event.v1", event_id: "close-1", event_name: "run_closed", run_id: RUN, at: "2026-08-12T03:00:06Z" },
    ];
    fs.writeFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("executes the shipped run analyze surface and writes canonical artifacts", () => {
    const tsx = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");
    const cli = path.resolve(__dirname, "..", "run-analysis.ts");
    const result = spawnSync(tsx, [cli, "run", "analyze", RUN, "--cwd", root], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).eligible).toBe(true);
    expect(fs.existsSync(path.join(root, ".guild", "analysis", "runs", RUN, "analysis.json"))).toBe(true);
  });

  it("executes explicit recommendation decisions and audited status updates", () => {
    const eventsFile = path.join(root, ".guild", "runs", RUN, "logs", "v1.4-events.jsonl");
    fs.appendFileSync(eventsFile, [
      { ts: "2026-08-12T03:00:07.000Z", event: "tool_call", run_id: RUN, lane_id: "T1", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
      { ts: "2026-08-12T03:00:08.000Z", event: "tool_call", run_id: RUN, lane_id: "T1", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");
    const tsx = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");
    const cli = path.resolve(__dirname, "..", "run-analysis.ts");
    const analyze = spawnSync(tsx, [cli, "run", "analyze", RUN, "--cwd", root], { encoding: "utf8" });
    expect(analyze.status).toBe(0);
    const recommendation = JSON.parse(fs.readFileSync(path.join(root, ".guild", "recommendations", `${RUN}.jsonl`), "utf8").trim());

    const decide = spawnSync(tsx, [cli, "recommendation", "decide", RUN, recommendation.id, "accept", "--cwd", root], { encoding: "utf8" });
    expect(decide.status).toBe(0);
    expect(JSON.parse(decide.stdout)).toMatchObject({ ok: true, status: "queued", effect: "project_proposal_queued" });

    const status = spawnSync(tsx, [cli, "recommendation", "status", RUN, recommendation.id, "implemented", "--cwd", root], { encoding: "utf8" });
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, status: "implemented", effect: "status_recorded" });
    expect(fs.readFileSync(path.join(root, ".guild", "recommendations", "activity.jsonl"), "utf8")).toContain('"to_status":"implemented"');
  });

  it("rejects unsafe recommendation source ids before reading outside the project", () => {
    const tsx = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");
    const cli = path.resolve(__dirname, "..", "run-analysis.ts");
    const result = spawnSync(tsx, [cli, "recommendation", "decide", "../escape", "rec-1", "accept", "--cwd", root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/safe path component/);
  });
});
