/**
 * hooks/__tests__/analysis-production-events.test.ts — B01H.
 *
 * Semantic analysis.v2 coverage through the REAL hook entries. Every fixture
 * spawns the compiled `node hooks/dist/<hook>.js` the host runs (hooks.json),
 * never a stubbed emitter, and reads the run's canonical log back through the
 * closed envelope validator. Each acceptance case has a negative control beside
 * it: an unobservable boundary writes nothing, and a trace failure never
 * changes the permission decision.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  collapseSpanTwins,
  toolActionSignature,
  validateGuildTraceEvent,
} from "../../src/domains/telemetry";
import {
  createRealEnv,
  createRunLifecycle,
  loadRunBinding,
  type ResolvedSettingsSnapshot,
  type StartRunOpts,
} from "../../src/domains/lifecycle";
import { redactField } from "../lib/v1.4/redact-log";

const DIST = path.resolve(__dirname, "..", "dist");
const SECRET = "sk-ant-api03-" + "Z".repeat(40);

type Row = { ref: string; value: Record<string, unknown> };

function snapshot(): ResolvedSettingsSnapshot {
  return {
    schema_version: "guild.resolved_settings.v1",
    source_chain: { agent_mode: "builtin", review: "builtin", rigor: "builtin", loops: "builtin", loop_cap: "builtin", host: "builtin" },
    effective: { agent_mode: "team", host: "auto", review: "cross", rigor: "deep", loops: "all", loop_cap: 16, block_unmarked_lanes: false },
    providers: { authorHost: "claude", authorTrust: "verified", detected: [], recommended: null },
    communication_contract: "review_result.v1",
    roles: {
      schema_version: "guild.role_resolution.v1",
      host: { role: "host", substrate: "claude-code-cli", strength: "strong", reason: "author host" },
      advisory: { role: "advisory", substrate: "claude-code-cli", strength: "weak", reason: "same-family fallback" },
      adversarial: { role: "adversarial", substrate: "codex-cli", strength: "strong", reason: "cross-family" },
    },
    dispatch: { backend: "subagent", reason: "test fixture", facts: { cmux_workspace_present: false, tmux_on_path: false, agent_mode: "team" } },
    resolved_at_ref: null,
  } as unknown as ResolvedSettingsSnapshot;
}

function startRun(root: string): string {
  const env = createRealEnv(root, (requested: string) => ({ requested, resolved: "claude" as const }));
  return createRunLifecycle(env).startRun({
    command: "/guild:build", arguments: {}, cwd: root, root, target_kind: "existing_guild_project",
    workspace: { is_workspace: false, root }, project: "test", host_requested: "auto",
    model_tier_policy: "test", ignore_policy: "test", scan_policy: "test", initiative: null,
    run_class: "full", phase: "build", snapshot: snapshot(),
  } as StartRunOpts);
}

function readLog(runDir: string): Row[] {
  const file = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return [];
  return fs.readFileSync(file, "utf8").split("\n").flatMap((line, i) =>
    line.trim() ? [{ ref: `line:${i + 1}`, value: JSON.parse(line) as Record<string, unknown> }] : []);
}

const ofClass = (rows: Row[], cls: string): Record<string, unknown>[] =>
  rows.filter(({ value }) => value["event_class"] === cls).map(({ value }) => value);

const toolRows = (rows: Row[]): Row[] =>
  rows.filter(({ value }) => value["event"] === "tool_call" || String(value["event_class"] ?? "").startsWith("tool_call_"));

interface HookResult { status: number; stdout: string; stderr: string }

/** Spawn the compiled hook exactly as hooks.json does: `node hooks/dist/<name>.js`. */
function runHook(name: string, root: string, payload: object, env: Record<string, string | undefined>, timeout = 60000): HookResult {
  const base: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(base)) if (key.startsWith("GUILD_")) delete base[key];
  const r = spawnSync("node", [path.join(DIST, `${name}.js`)], {
    input: JSON.stringify({ cwd: root, ...payload }),
    encoding: "utf8",
    cwd: root,
    env: { ...base, GUILD_CWD: root, ...env },
    timeout,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function decision(stdout: string): string | undefined {
  if (stdout.trim() === "") return undefined;
  const parsed = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string } };
  return parsed.hookSpecificOutput?.permissionDecision;
}

let root: string;
let runId: string;
let runDir: string;
let bound: Record<string, string>;

beforeAll(() => {
  for (const hook of ["pre-tool-use", "post-tool-use", "capture-telemetry"]) {
    if (!fs.existsSync(path.join(DIST, `${hook}.js`))) throw new Error(`missing compiled hook ${hook}.js — run: cd hooks && npm run build`);
  }
});

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-b01h-")));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
  runId = startRun(root);
  runDir = path.join(root, ".guild", "runs", runId);
  bound = { GUILD_RUN_ID: runId, GUILD_RUN_BINDING_REF: loadRunBinding({ root, run_id: runId })!.binding_ref };
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

// A lane worker's wiki write: denied by the KTD35 gate, before any approvable ask.
const wikiWrite = (content: string) => ({
  hook_event_name: "PreToolUse",
  tool_name: "Write",
  tool_input: { file_path: path.join(root, ".guild", "wiki", "decisions", "x.md"), content },
});

describe("tool_call_denied at the PreToolUse permission decision (B01H-AC1/AC2)", () => {
  it("actual denied entry: the deny is on stdout and one validated denied row lands before execution", () => {
    const r = runHook("pre-tool-use", root, wikiWrite("# decision\n"), { ...bound, GUILD_LANE_ID: "lane-a" });
    expect(r.status).toBe(0);
    expect(decision(r.stdout)).toBe("deny");

    const rows = readLog(runDir);
    const denied = ofClass(rows, "tool_call_denied");
    expect(denied.length).toBe(1);
    expect(validateGuildTraceEvent(denied[0])).toEqual({ ok: true });
    expect([denied[0]["status"], denied[0]["signature"], denied[0]["actor_id"], denied[0]["lane_id"]])
      .toEqual(["denied", "policy:Write:lane_wiki_write", "Write", "lane-a"]);
    // Before execution: no tool_call mirror and no started row for this call.
    expect(rows.some(({ value }) => value["event"] === "tool_call" || value["event_class"] === "tool_call_started")).toBe(false);
    // One denial is one action.
    expect(collapseSpanTwins(toolRows(rows), runId).length).toBe(1);
  });

  it("an unverifiable projection records unavailable_observation, never a missing tool", () => {
    const r = runHook("pre-tool-use", root, { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a.ts" } },
      { ...bound, GUILD_TASK_ID: "B01H" });
    expect(decision(r.stdout)).toBe("deny");
    const denied = ofClass(readLog(runDir), "tool_call_denied");
    expect(denied.map((d) => d["signature"])).toEqual(["host_unavailable:Read:projection"]);
    expect(validateGuildTraceEvent(denied[0])).toEqual({ ok: true });
    expect(denied[0]["task_id"]).toBe("B01H");
    expect(String(denied[0]["signature"]).startsWith("capability_absent:")).toBe(false);
  });

  it("negative control: an allowed call emits no denial", () => {
    const r = runHook("pre-tool-use", root, {
      hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: path.join(root, "src.ts"), content: "x" },
    }, { ...bound, GUILD_LANE_ID: "lane-a" });
    expect(decision(r.stdout)).toBeUndefined();
    expect(ofClass(readLog(runDir), "tool_call_denied")).toEqual([]);
  });

  it("secret-safe payload: the denied row carries no content, command, or payload sidecar", () => {
    const r = runHook("pre-tool-use", root, wikiWrite(`token=${SECRET}\n`), { ...bound, GUILD_LANE_ID: "lane-a" });
    expect(decision(r.stdout)).toBe("deny");
    const denied = ofClass(readLog(runDir), "tool_call_denied");
    expect(denied.length).toBe(1);
    expect(denied[0]["redaction"]).toBe("omitted");
    expect(denied[0]["payload_ref"]).toBeUndefined();
    expect(fs.readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")).not.toContain(SECRET);
    expect(fs.existsSync(path.join(runDir, "logs", "payloads"))).toBe(false);
  });

  it("trace write failure never suppresses or alters the permission decision", () => {
    const log = path.join(runDir, "logs", "v1.4-events.jsonl");
    fs.rmSync(log, { force: true });
    fs.mkdirSync(log); // appendFileSync now fails with EISDIR
    const r = runHook("pre-tool-use", root, wikiWrite("# decision\n"), { ...bound, GUILD_LANE_ID: "lane-a" });
    expect(r.status).toBe(0);
    expect(decision(r.stdout)).toBe("deny");
    expect(r.stderr).toContain("could not write trace event");
    expect(fs.statSync(log).isDirectory()).toBe(true);
  });

  it("malformed/no-run attribution: the deny stands and no row or run tree is invented", () => {
    const noRun = runHook("pre-tool-use", root, wikiWrite("# d\n"), { GUILD_LANE_ID: "lane-a" });
    expect(decision(noRun.stdout)).toBe("deny");
    expect(noRun.stderr).toContain("tool_call_denied unobservable (no bound run)");

    const unsafe = runHook("pre-tool-use", root, wikiWrite("# d\n"), { GUILD_RUN_ID: "../escape", GUILD_LANE_ID: "lane-a" });
    expect(decision(unsafe.stdout)).toBe("deny");
    expect(unsafe.stderr).toContain("tool_call_denied unobservable (no bound run)");

    const ghost = "run-20261017-000000-ghost";
    const missing = runHook("pre-tool-use", root, wikiWrite("# d\n"), { GUILD_RUN_ID: ghost, GUILD_LANE_ID: "lane-a" });
    expect(decision(missing.stdout)).toBe("deny");
    expect(missing.stderr).toContain("tool_call_denied unobservable (no matching run record)");
    expect(fs.existsSync(path.join(root, ".guild", "runs", ghost, "logs", "v1.4-events.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".guild", "escape"))).toBe(false);
    expect(ofClass(readLog(runDir), "tool_call_denied")).toEqual([]);
  });

  it("R1: a FIFO at the log path never blocks the deny (no reader, hook still exits 0)", () => {
    const log = path.join(runDir, "logs", "v1.4-events.jsonl");
    fs.rmSync(log, { force: true });
    expect(spawnSync("mkfifo", [log]).status).toBe(0);
    const r = runHook("pre-tool-use", root, wikiWrite("# decision\n"), { ...bound, GUILD_LANE_ID: "lane-a" }, 10000);
    expect(r.status).toBe(0);
    expect(decision(r.stdout)).toBe("deny");
    expect(r.stderr).toContain("tool_call_denied unobservable (unsafe log target)");
    expect(fs.lstatSync(log).isFIFO()).toBe(true);
  }, 20000);

  it("R2: a run record naming another run never takes this run's denial", () => {
    const runB = "run-20261017-000000-runb";
    const runBDir = path.join(root, ".guild", "runs", runB);
    fs.mkdirSync(runBDir, { recursive: true });
    fs.writeFileSync(path.join(runBDir, "run.yaml"), `schema_version: guild.run.v1\nrun_id: ${runB}\n`);
    const r = runHook("pre-tool-use", root, wikiWrite("# d\n"), { ...bound, GUILD_RUN_DIR: runBDir, GUILD_LANE_ID: "lane-a" });
    expect(decision(r.stdout)).toBe("deny");
    expect(r.stderr).toContain("tool_call_denied unobservable (no matching run record)");
    expect(ofClass(readLog(runBDir), "tool_call_denied")).toEqual([]);
    expect(ofClass(readLog(runDir), "tool_call_denied")).toEqual([]);
  });
});

describe("PostToolUse semantic classes (B01H-AC1/AC2/AC3)", () => {
  it("F2: POST-without-PRE explicit failure is a failure with the same action signature as a paired attempt", () => {
    const call = { tool_name: "Bash", tool_input: { command: "npm test" } };
    const failed = { ...call, hook_event_name: "PostToolUse", tool_response: { success: false, error: "exit 1" } };
    expect(runHook("post-tool-use", root, failed, bound).status).toBe(0);
    expect(runHook("pre-tool-use", root, { ...call, hook_event_name: "PreToolUse" }, bound).status).toBe(0);
    expect(runHook("post-tool-use", root, failed, bound).status).toBe(0);

    const rows = readLog(runDir);
    expect(rows.filter(({ value }) => value["event"] === "tool_call").map(({ value }) => value["status"])).toEqual(["err", "err"]);
    const failures = ofClass(rows, "tool_call_failed");
    expect(failures.length).toBe(2);
    for (const f of failures) expect(validateGuildTraceEvent(f)).toEqual({ ok: true });
    const expected = toolActionSignature("Bash", redactField(`Bash ${JSON.stringify(call.tool_input)}`));
    expect(failures.map((f) => f["signature"])).toEqual([expected, expected]);
    expect(failures[0]["span_id"]).not.toBe(failures[1]["span_id"]);
    // Two attempts stay two actions; each attempt's twins collapse.
    expect(collapseSpanTwins(toolRows(rows), runId).length).toBe(2);
  });

  it("clarifying_question_asked: semantic child of the tool span, hash only, no sidecar body", () => {
    const call = { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: `Use ${SECRET}?` }] } };
    expect(runHook("pre-tool-use", root, { ...call, hook_event_name: "PreToolUse" }, bound).status).toBe(0);
    expect(runHook("post-tool-use", root, { ...call, hook_event_name: "PostToolUse", tool_response: { answers: {} } }, bound).status).toBe(0);

    const rows = readLog(runDir);
    const asked = ofClass(rows, "clarifying_question_asked");
    expect(asked.length).toBe(1);
    expect(validateGuildTraceEvent(asked[0])).toEqual({ ok: true });
    expect(asked[0]["redaction"]).toBe("omitted");
    expect(asked[0]["payload_ref"]).toBeUndefined();
    expect(String(asked[0]["prompt_hash"])).toMatch(/^[0-9a-f]{16}$/);
    const toolSpan = ofClass(rows, "tool_call_finished")[0]["span_id"];
    expect(asked[0]["parent_span_id"]).toBe(toolSpan);
    expect(asked[0]["span_id"]).not.toBe(toolSpan);
    expect(fs.readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")).not.toContain(SECRET);
    // Semantic-twin attribution: the tool action is still exactly one action.
    expect(collapseSpanTwins(toolRows(rows), runId).map((a) => a.refs.length)).toEqual([3]);
  });

  it("agent_dispatched + agent_prompt_sent share one dispatch span; no task id stays unobservable", () => {
    const prompt = `Implement B01H. key=${SECRET}`;
    const dispatch = { hook_event_name: "PostToolUse", tool_name: "Agent", tool_response: { ok: true } };
    expect(runHook("post-tool-use", root, {
      ...dispatch, tool_input: { subagent_type: "general-purpose", prompt, env: { GUILD_TASK_ID: "B01H" } },
    }, bound).status).toBe(0);

    let rows = readLog(runDir);
    const dispatched = ofClass(rows, "agent_dispatched");
    const sent = ofClass(rows, "agent_prompt_sent");
    expect([dispatched.length, sent.length]).toEqual([1, 1]);
    for (const e of [...dispatched, ...sent]) {
      expect(validateGuildTraceEvent(e)).toEqual({ ok: true });
      expect(e["task_id"]).toBe("B01H");
    }
    expect(dispatched[0]["span_id"]).toBe(sent[0]["span_id"]);
    expect(dispatched[0]["parent_span_id"]).toBe(ofClass(rows, "tool_call_finished")[0]["span_id"]);
    expect(sent[0]["redaction"]).toBe("omitted");
    expect(fs.readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")).not.toContain(SECRET);

    const untasked = runHook("post-tool-use", root, { ...dispatch, tool_input: { subagent_type: "general-purpose", prompt: "x" } }, bound);
    expect(untasked.stderr).toContain("agent_dispatched unobservable");
    rows = readLog(runDir);
    expect([ofClass(rows, "agent_dispatched").length, ofClass(rows, "agent_prompt_sent").length]).toEqual([1, 1]);
  });

  it("agent_handoff_written names the receipt's own task_id; foreign-run and untyped receipts write nothing", () => {
    const handoffs = path.join(runDir, "handoffs");
    fs.mkdirSync(handoffs, { recursive: true });
    const receipt = path.join(handoffs, "hook-engineer-B01H.md");
    fs.writeFileSync(receipt, "```json\n{\"schema\": \"guild.handoff.v2\", \"task_id\": \"B01H\"}\n```\n");
    const write = (file: string) => ({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file, content: "x" }, tool_response: { success: true } });
    expect(runHook("post-tool-use", root, write(receipt), bound).status).toBe(0);

    const written = ofClass(readLog(runDir), "agent_handoff_written");
    expect(written.length).toBe(1);
    expect(validateGuildTraceEvent(written[0])).toEqual({ ok: true });
    expect([written[0]["task_id"], written[0]["payload_ref"]]).toEqual(["B01H", "handoffs/hook-engineer-B01H.md"]);

    const other = path.join(root, ".guild", "runs", "run-20261017-000000-other", "handoffs");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "x-B9.md"), "\"task_id\": \"B9\"\n");
    runHook("post-tool-use", root, write(path.join(other, "x-B9.md")), bound);
    const untyped = path.join(handoffs, "notes.md");
    fs.writeFileSync(untyped, "B01H looks done.\n");
    const r = runHook("post-tool-use", root, write(untyped), bound);
    expect(r.stderr).toContain("agent_handoff_written unobservable");
    expect(ofClass(readLog(runDir), "agent_handoff_written").length).toBe(1);
  });

  it("R3: the env task id alone never proves a handoff, and a contradicting receipt is refused", () => {
    const handoffs = path.join(runDir, "handoffs");
    fs.mkdirSync(handoffs, { recursive: true });
    const write = (file: string) => ({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file, content: "x" }, tool_response: { success: true } });

    const notes = path.join(handoffs, "notes.md");
    fs.writeFileSync(notes, "B01H looks done.\n");
    const envOnly = runHook("post-tool-use", root, write(notes), { ...bound, GUILD_TASK_ID: "B01H" });
    expect(envOnly.stderr).toContain("agent_handoff_written unobservable");

    const foreign = path.join(handoffs, "hook-engineer-B02.md");
    fs.writeFileSync(foreign, "```json\n{\"schema\": \"guild.handoff.v2\", \"task_id\": \"B02\"}\n```\n");
    const mismatch = runHook("post-tool-use", root, write(foreign), { ...bound, GUILD_TASK_ID: "B01H" });
    expect(mismatch.stderr).toContain("agent_handoff_written refused: receipt task_id differs from GUILD_TASK_ID");
    expect(ofClass(readLog(runDir), "agent_handoff_written")).toEqual([]);

    const own = runHook("post-tool-use", root, write(foreign), { ...bound, GUILD_TASK_ID: "B02" });
    expect(own.status).toBe(0);
    expect(ofClass(readLog(runDir), "agent_handoff_written").map((e) => e["task_id"])).toEqual(["B02"]);
  });

  it("F8: a whitespace gate token becomes one non-whitespace signature at the hook boundary", () => {
    const r = runHook("capture-telemetry", root, {
      hook_event_name: "codex_review_round", loop_gate: "G-lane:  B01H", loop_round: 2, loop_terminated: true,
    }, bound);
    expect(r.status).toBe(0);
    const gates = ofClass(readLog(runDir), "gate_concluded");
    expect(gates.map((g) => g["signature"])).toEqual(["G-lane:_B01H:2"]);
    expect(validateGuildTraceEvent(gates[0])).toEqual({ ok: true });
  });
});
