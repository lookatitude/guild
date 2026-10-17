/**
 * tests/integration/run-analysis-installed.test.ts — B04 (P6 plugin-complete evidence).
 *
 * Drives the COMMITTED generated payload end to end, the way an installed plugin
 * runs it: the real hook bundles (hooks/dist/*.js) produce a run, and the compiled
 * C-CLI bundle (runtime/scripts/run-analysis.js) analyzes, compares, inspects and
 * decides on it. Both are copied into a package directory outside the repo and run
 * under plain `node` with a PATH whose only entries are failing tsx/bun/npx shims
 * and a directory holding just the node binary. Nothing here rebuilds the payload.
 *
 * Checkout-robust: a tree without the committed payload SKIPS every case under a
 * name carrying the reason (B04_PAYLOAD_ABSENT); a tree whose payload does not
 * match its own identity file FAILS (B04_PAYLOAD_STALE). Neither passes vacuously.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { computeTrackedNativeClaudePayloadDigest, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE } from "../../src/domains/distribution";
import { validateGuildTraceEvent } from "../../src/domains/telemetry";

const REPO = path.resolve(__dirname, "..", "..");

/** The accepted B04 candidate (C05 payload commit) and its native payload identity (C07 handoff). */
const ACCEPTED_COMMIT = "1fc993e7a1f8bdd7e5262a5ef82b50751b420191";
const ACCEPTED_PAYLOAD = "sha256:9a6a1af4d68c77641fc8f5023c371db17df05b9bc7e94b4ac9f07ca16599c96c";

const CLI_OUT = "runtime/scripts/run-analysis.js";
const HOOKS = ["run-trace", "run-trace-start", "run-trace-close", "capture-telemetry", "pre-tool-use", "post-tool-use"];

const git = (...args: string[]): { status: number | null; stdout: string } => {
  const r = spawnSync("git", ["-C", REPO, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: (r.stdout ?? "").trim() };
};

/** Gate: is the committed payload present, and does it match this tree's identity file? */
function payloadGate(): { state: "absent" | "stale" | "current"; reason: string; digest: string | null; head: string } {
  const head = git("rev-parse", "HEAD").stdout;
  const required = [CLI_OUT, ...HOOKS.map((hook) => `hooks/dist/${hook}.js`)];
  const untracked = required.filter((file) => git("ls-files", "--error-unmatch", file).status !== 0 || !fs.existsSync(path.join(REPO, file)));
  if (untracked.length > 0) {
    return { state: "absent", reason: `B04_PAYLOAD_ABSENT: committed payload missing ${untracked.join(", ")} at ${head.slice(0, 8)}`, digest: null, head };
  }
  // The tracked digest reads the git index; the sandbox copies working-tree bytes, so they must agree.
  const dirty = git("diff", "--name-only", "--", "runtime", "hooks/dist").stdout;
  if (dirty !== "") {
    return { state: "stale", reason: `B04_PAYLOAD_STALE: working-tree payload differs from the index:\n${dirty}`, digest: null, head };
  }
  const digest = computeTrackedNativeClaudePayloadDigest(REPO);
  const declared = (JSON.parse(fs.readFileSync(path.join(REPO, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE), "utf8")) as { payload_digest?: string }).payload_digest;
  if (declared !== digest) {
    return { state: "stale", reason: `B04_PAYLOAD_STALE: identity file says ${declared}, tracked payload is ${digest}`, digest, head };
  }
  return { state: "current", reason: "payload present and current", digest, head };
}

const GATE = payloadGate();
if (GATE.state !== "current") process.stderr.write(`\n[B04] ${GATE.reason}\n`);
else process.stderr.write(`\n[B04] payload ${GATE.digest} at ${GATE.head}\n`);

const REAL_NODE = fs.realpathSync(spawnSync("/bin/sh", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim());

interface Sandbox { dir: string; pkg: string; env: NodeJS.ProcessEnv; sentinel: string }

/** Installed package + node-only PATH. Any tsx/bun/npx re-entry hits a shim that records and fails. */
function makeSandbox(withCli = true): Sandbox {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-b04-")));
  const pkg = path.join(dir, "pkg");
  fs.mkdirSync(path.join(pkg, "hooks"), { recursive: true });
  fs.cpSync(path.join(REPO, "runtime"), path.join(pkg, "runtime"), { recursive: true });
  fs.cpSync(path.join(REPO, "hooks", "dist"), path.join(pkg, "hooks", "dist"), { recursive: true });
  // The hooks resolve the installed plugin identity from <pkg>/.claude-plugin/plugin.json (hooks/dist/../..).
  fs.cpSync(path.join(REPO, ".claude-plugin"), path.join(pkg, ".claude-plugin"), { recursive: true });
  if (!withCli) fs.rmSync(path.join(pkg, CLI_OUT));
  const shims = path.join(dir, "shims");
  const nodeBin = path.join(dir, "nodebin");
  fs.mkdirSync(shims);
  fs.mkdirSync(nodeBin);
  fs.symlinkSync(REAL_NODE, path.join(nodeBin, "node"));
  const sentinel = path.join(dir, "shim-invoked.sentinel");
  for (const name of ["tsx", "bun", "npx"]) {
    fs.writeFileSync(path.join(shims, name), `#!/bin/sh\necho "${name}" >> "${sentinel}"\nexit 3\n`);
    fs.chmodSync(path.join(shims, name), 0o755);
  }
  return { dir, pkg, sentinel, env: { PATH: `${shims}:${nodeBin}`, NODE_PATH: "", HOME: dir } };
}

interface Proc { status: number | null; stdout: string; stderr: string }

function node(sb: Sandbox, file: string, args: string[], opts: { cwd: string; input?: string; env?: Record<string, string> }): Proc {
  const r = spawnSync("node", [file, ...args], {
    encoding: "utf8", cwd: opts.cwd, input: opts.input, env: { ...sb.env, ...(opts.env ?? {}) }, timeout: 60000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const cli = (sb: Sandbox, root: string, ...args: string[]): Proc => node(sb, path.join(sb.pkg, CLI_OUT), [...args, "--cwd", root], { cwd: root });

function makeProject(sb: Sandbox, name: string): string {
  const root = path.join(sb.dir, name);
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild", "wiki", "decisions"), { recursive: true });
  return root;
}

/**
 * One run produced only by the packaged producers: run-trace start, then every
 * hook a host fires (prompt, two failing Bash attempts, a denied lane wiki
 * write, a clarification, an Agent dispatch, a typed handoff receipt, a gate
 * round, the subagent stop) and the Stop close.
 */
function producePackagedRun(sb: Sandbox, root: string, command: string): string {
  const start = node(sb, path.join(sb.pkg, "hooks/dist/run-trace.js"), ["start", `--command=${command}`, "--phase=build", "--cwd", root], { cwd: root });
  expect(start.status).toBe(0);
  const runId = start.stdout.trim();
  expect(runId).toMatch(/^run-\d{8}-\d{6}-/);
  const binding = JSON.parse(fs.readFileSync(path.join(root, ".guild", "runs", runId, "binding.json"), "utf8")) as { binding_ref: string };
  const bound = { GUILD_CWD: root, GUILD_RUN_ID: runId, GUILD_RUN_BINDING_REF: binding.binding_ref };
  const hook = (name: string, payload: object, env: Record<string, string> = {}): Proc => {
    const r = node(sb, path.join(sb.pkg, `hooks/dist/${name}.js`), [], { cwd: root, input: JSON.stringify({ cwd: root, ...payload }), env: { ...bound, ...env } });
    expect(r.status).toBe(0);
    return r;
  };
  const prompt = { hook_event_name: "UserPromptSubmit", prompt: "build the widget" };
  hook("capture-telemetry", prompt);
  hook("run-trace-start", prompt);
  const bash = { tool_name: "Bash", tool_input: { command: "npm test" } };
  for (let attempt = 0; attempt < 2; attempt++) {
    hook("pre-tool-use", { ...bash, hook_event_name: "PreToolUse" });
    hook("post-tool-use", { ...bash, hook_event_name: "PostToolUse", tool_response: { success: false, error: "exit 1" } });
  }
  const denied = hook("pre-tool-use", {
    hook_event_name: "PreToolUse", tool_name: "Write",
    tool_input: { file_path: path.join(root, ".guild", "wiki", "decisions", "x.md"), content: "# d\n" },
  }, { GUILD_LANE_ID: "lane-a" });
  expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  const ask = { tool_name: "AskUserQuestion", tool_input: { questions: [{ question: "Which target?" }] } };
  hook("pre-tool-use", { ...ask, hook_event_name: "PreToolUse" });
  hook("post-tool-use", { ...ask, hook_event_name: "PostToolUse", tool_response: { answers: {} } });
  hook("post-tool-use", {
    hook_event_name: "PostToolUse", tool_name: "Agent",
    tool_input: { subagent_type: "general-purpose", prompt: "do T1", env: { GUILD_TASK_ID: "T1" } }, tool_response: { ok: true },
  });
  const handoffs = path.join(root, ".guild", "runs", runId, "handoffs");
  fs.mkdirSync(handoffs, { recursive: true });
  const receipt = path.join(handoffs, "developer-T1.md");
  fs.writeFileSync(receipt, "```json\n{\"schema\": \"guild.handoff.v2\", \"task_id\": \"T1\"}\n```\n");
  hook("post-tool-use", { hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: receipt, content: "x" }, tool_response: { success: true } });
  hook("capture-telemetry", { hook_event_name: "codex_review_round", loop_gate: "G-lane:T1-developer", loop_round: 1, loop_terminated: true });
  hook("capture-telemetry", { hook_event_name: "SubagentStop" });
  hook("run-trace-close", { hook_event_name: "Stop" });
  return runId;
}

type Row = Record<string, unknown>;
const readLog = (root: string, runId: string): Row[] =>
  fs.readFileSync(path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl"), "utf8")
    .split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as Row);

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string): void => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      const key = path.relative(dir, file);
      if (entry.isDirectory()) { out[`${key}/`] = "dir"; walk(file); }
      else out[key] = fs.readFileSync(file, "utf8");
    }
  };
  walk(dir);
  return out;
}

const readJson = (file: string): Record<string, any> => JSON.parse(fs.readFileSync(file, "utf8"));
const recs = (root: string, runId: string): Array<{ id: string; scope: string; status: string }> =>
  fs.readFileSync(path.join(root, ".guild", "recommendations", `${runId}.jsonl`), "utf8").trim().split("\n").map((row) => JSON.parse(row));

/** The analysis.v2 classes the packaged producers must emit (B01 matrix rows wired through B01H). */
const PRODUCED_CLASSES = [
  "run_started", "run_attachment_resolved", "config_snapshot_written", "phase_entered", "prompt_received",
  "tool_call_started", "tool_call_failed", "tool_call_finished", "tool_call_denied", "clarifying_question_asked",
  "agent_dispatched", "agent_prompt_sent", "agent_handoff_written", "gate_concluded", "agent_response_received",
  "phase_concluded", "run_closed",
];

if (GATE.state === "absent") {
  describe(`B04 installed run-analysis — SKIPPED ${GATE.reason}`, () => {
    it.skip(`${GATE.reason} (positives run only on a checkout carrying the committed C05 payload)`, () => {});
  });
} else {
  describe("B04 installed run-analysis (packaged Node, no Bun/tsx)", () => {
    let sb: Sandbox;
    let root: string;
    let runA: string;
    let runB: string;

    beforeAll(() => {
      expect(GATE.state, GATE.reason).toBe("current");
      sb = makeSandbox();
      root = makeProject(sb, "project");
      runA = producePackagedRun(sb, root, "/guild:build");
      runB = producePackagedRun(sb, root, "/guild:qa");
    });

    afterAll(() => { if (sb) fs.rmSync(sb.dir, { recursive: true, force: true }); });

    // Off the accepted commit this case is a named skip, never a silent pass.
    it.skipIf(GATE.head !== ACCEPTED_COMMIT)(
      GATE.head === ACCEPTED_COMMIT
        ? "B04-AC4: the checkout carries the accepted candidate payload identity"
        : `B04-AC4 SKIPPED B04_NOT_ACCEPTED_COMMIT: HEAD ${GATE.head.slice(0, 8)} is not ${ACCEPTED_COMMIT.slice(0, 8)}`,
      () => { expect(GATE.digest).toBe(ACCEPTED_PAYLOAD); },
    );

    it("isolation: node-only PATH resolves bun/tsx/npx to failing shims", () => {
      const probe = spawnSync("/bin/sh", ["-c", "command -v bun; command -v tsx; command -v npx; command -v node"], { encoding: "utf8", env: sb.env });
      const [bun, tsx, npx, nodePath] = probe.stdout.trim().split("\n");
      for (const shim of [bun, tsx, npx]) expect(shim.startsWith(path.join(sb.dir, "shims"))).toBe(true);
      expect(nodePath).toBe(path.join(sb.dir, "nodebin", "node"));
    });

    it("B04-AC1 [producers]: packaged hooks emit every wired class as validated, run-bound rows", () => {
      const rows = readLog(root, runA);
      const classes = new Set(rows.map((row) => row["event_class"]).filter(Boolean));
      for (const cls of PRODUCED_CLASSES) expect(classes.has(cls), cls).toBe(true);
      for (const row of rows.filter((r) => r["schema_version"] === "guild.trace.analysis.v2")) {
        expect(validateGuildTraceEvent(row)).toEqual({ ok: true });
        expect(row["run_id"]).toBe(runA);
      }
      const failed = rows.filter((row) => row["event_class"] === "tool_call_failed");
      expect(failed.length).toBe(2);
      expect(failed[0]["signature"]).toBe(failed[1]["signature"]);
      expect(failed[0]["span_id"]).not.toBe(failed[1]["span_id"]);
      expect(rows.find((row) => row["event_class"] === "tool_call_denied")?.["signature"]).toBe("policy:Write:lane_wiki_write");
      for (const file of ["run.yaml", "provenance.json", "plugin-config-snapshot.json"]) {
        expect(fs.existsSync(path.join(root, ".guild", "runs", runA, file)), file).toBe(true);
      }
    });

    it("B04-AC1 [analyze]: the packaged CLI writes canonical artifacts from the real trace", () => {
      const r = cli(sb, root, "run", "analyze", runA);
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out).toMatchObject({ ok: true, cache: "recomputed", reason: "missing" });
      const analysis = readJson(path.join(root, ".guild", "analysis", "runs", runA, "analysis.json"));
      expect(analysis.analysis_id).toBe(out.analysis_id);
      const repeat = analysis.findings.find((f: { kind: string }) => f.kind === "repeated_failure");
      expect(repeat).toBeDefined();
      const result = (id: string) => analysis.diagnostics.results.find((entry: { detector: string }) => entry.detector === id);
      expect(result("repeated_mistake").state).toBe("observed");
      expect(result("repeated_mistake").value.clusters[0].signature).toBe(readLog(root, runA).find((row) => row["event_class"] === "tool_call_failed")!["signature"]);
      expect(result("tool_coverage").state).toBe("observed");
      expect(result("tool_coverage").value.outcomes).toMatchObject({ failed: 2, denied: 1 });
      // One policy denial is an observed outcome, never a missing-skill/tool-gap candidate (C-DETECTORS golden_negative).
      expect(analysis.findings.map((f: { kind: string }) => f.kind)).not.toContain("tool_gap");
      expect(analysis.recommendations.map((r: { kind: string }) => r.kind)).not.toContain("create_skill");
      expect(fs.existsSync(path.join(root, ".guild", "recommendations", `${runA}.jsonl`))).toBe(true);
      const again = JSON.parse(cli(sb, root, "run", "analyze", runA).stdout);
      expect(again).toMatchObject({ analysis_id: out.analysis_id, cache: "hit", written: null });
    });

    it("B04 step 4 [unknown stays unknown]: unwired classes surface as gaps, never as satisfaction or measured zero", () => {
      const analysis = readJson(path.join(root, ".guild", "analysis", "runs", runA, "analysis.json"));
      expect(analysis.eligible).toBe(false);
      // Real producers satisfy identity, snapshot, parseability and validity; only the unwired loop classes are missing.
      expect(analysis.completeness.missing).toEqual(["loop"]);
      expect(analysis.findings.map((f: { kind: string }) => f.kind)).toContain("telemetry_gap");
      const byId = new Map<string, { state: string; value: any; reason: string | null }>(
        analysis.diagnostics.results.map((entry: { detector: string }) => [entry.detector, entry]));
      for (const id of ["steering", "knowledge_memory", "outcome_quality", "usage_outlier"]) {
        expect(byId.get(id)?.state, id).toBe("unobservable");
        expect(byId.get(id)?.reason, id).not.toBeNull();
      }
      expect(byId.get("instruction_following")?.value.aggregate).not.toBe("satisfied");
      // Hooks carry no token/cost usage: the v1 numeric 0 stays labelled unobserved, not a measured zero.
      for (const metric of ["input", "output", "cached", "cost_usd"]) {
        expect(byId.get("usage_outlier")!.value.availability[metric], metric).toBe("unobserved");
        expect(analysis.usage.availability[metric].state, metric).toBe("unobserved");
      }
    });

    it("B04-AC1 [inspect]: read-only inspect reports current with exact hashes and writes nothing", () => {
      const before = snapshot(root);
      const r = cli(sb, root, "artifact", "inspect", "run", runA);
      expect(r.status).toBe(0);
      const inspected = JSON.parse(r.stdout);
      const analysis = readJson(path.join(root, ".guild", "analysis", "runs", runA, "analysis.json"));
      expect(inspected).toMatchObject({
        ok: true, state: "current", kind: "run", source_id: runA, source_analysis_id: analysis.analysis_id,
        source_hash: analysis.source_hash, current_source_hash: analysis.source_hash, input_hash: analysis.diagnostics.input_hash,
      });
      expect(snapshot(root)).toEqual(before);
    });

    it("B04-AC1 [compare]: two packaged runs compare and the comparison inspects current", () => {
      const r = cli(sb, root, "run", "compare", runA, runB);
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(true);
      expect([...out.run_ids].sort()).toEqual([runA, runB].sort());
      expect(fs.existsSync(out.written.json)).toBe(true);
      const comparison = readJson(out.written.json);
      expect(comparison.diagnostics.dimensions).toBeDefined();
      const inspected = JSON.parse(cli(sb, root, "artifact", "inspect", "comparison", out.comparison_id).stdout);
      expect(inspected).toMatchObject({ state: "current", kind: "comparison", source_id: out.comparison_id });
    });

    it("B04-AC1 [recommendation]: browser-bound decisions write only local recommendation state", () => {
      cli(sb, root, "run", "analyze", runB);
      const inspected = JSON.parse(cli(sb, root, "artifact", "inspect", "run", runB).stdout);
      const before = snapshot(root);
      const effects: string[] = [];
      for (const rec of recs(root, runB)) {
        const r = cli(sb, root, "recommendation", "decide", runB, rec.id, "accept",
          "--expected-analysis-id", inspected.source_analysis_id, "--expected-input-hash", inspected.input_hash);
        expect(r.status, r.stderr).toBe(0);
        effects.push(JSON.parse(r.stdout).effect);
      }
      expect(effects.sort()).toEqual(["plugin_draft_written", "project_proposal_queued"]);
      const project = recs(root, runB).find((rec) => rec.scope === "project")!;
      const status = cli(sb, root, "recommendation", "status", runB, project.id, "implemented");
      expect(JSON.parse(status.stdout)).toMatchObject({ ok: true, status: "implemented", effect: "status_recorded" });
      const after = snapshot(root);
      const changed = Object.keys({ ...before, ...after }).filter((key) => before[key] !== after[key]);
      expect(changed.length).toBeGreaterThan(0);
      expect(changed.every((key) => key.startsWith(".guild/recommendations/"))).toBe(true);
      const draft = changed.find((key) => key.startsWith(".guild/recommendations/drafts/") && key.endsWith(".md"))!;
      expect(after[draft]).toContain("external filing has not occurred");
    });

    it("B04-AC2 [missing bundle]: a package without run-analysis.js refuses with no fallback and no artifacts", () => {
      const bare = makeSandbox(false);
      try {
        const project = makeProject(bare, "project");
        const r = node(bare, path.join(bare.pkg, CLI_OUT), ["run", "analyze", "run-20261018-000000-x", "--cwd", project], { cwd: project });
        expect(r.status).not.toBe(0);
        expect(r.stderr).toMatch(/run-analysis\.js/);
        expect(fs.existsSync(path.join(bare.pkg, CLI_OUT))).toBe(false);
        expect(fs.existsSync(path.join(project, ".guild", "analysis"))).toBe(false);
        expect(fs.existsSync(bare.sentinel)).toBe(false);
      } finally {
        fs.rmSync(bare.dir, { recursive: true, force: true });
      }
    });

    it("B04-AC2 [malformed trace]: unparseable and cross-run rows never become evidence and block eligibility", () => {
      const project = makeProject(sb, "malformed");
      const runId = producePackagedRun(sb, project, "/guild:build");
      const log = path.join(project, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
      const lines = fs.readFileSync(log, "utf8").split("\n").length;
      fs.appendFileSync(log, "{not json\n" + JSON.stringify({ ...readLog(project, runId)[0], run_id: "run-20261018-000000-other" }) + "\n");
      const r = cli(sb, project, "run", "analyze", runId);
      expect(r.status).toBe(0);
      const analysis = readJson(path.join(project, ".guild", "analysis", "runs", runId, "analysis.json"));
      expect(analysis.eligible).toBe(false);
      expect(analysis.completeness.missing).toEqual(expect.arrayContaining(["trace parseability", "trace validity"]));
      expect(JSON.stringify(analysis)).not.toMatch(new RegExp(`v1\\.4-events\\.jsonl#line:(${lines}|${lines + 1})\\b`));

      // A corrupted canonical artifact is refused by inspect, without writes.
      const artifact = path.join(project, ".guild", "analysis", "runs", runId, "analysis.json");
      fs.writeFileSync(artifact, "{\"schema_version\": \"guild.run_analysis.v1\"");
      const before = snapshot(project);
      const inspect = cli(sb, project, "artifact", "inspect", "run", runId);
      expect(inspect.status).toBe(1);
      expect(JSON.parse(inspect.stdout)).toMatchObject({ ok: false, state: "refused", reason: "malformed_artifact" });
      expect(snapshot(project)).toEqual(before);
    });

    it("B04-AC2 [invalid recommendations]: unknown, corrupt, unsafe, unauthorized and stale-context decisions refuse without writes", () => {
      const project = makeProject(sb, "invalid-recs");
      const runId = producePackagedRun(sb, project, "/guild:build");
      expect(cli(sb, project, "run", "analyze", runId).status).toBe(0);
      const inspected = JSON.parse(cli(sb, project, "artifact", "inspect", "run", runId).stdout);
      const plugin = recs(project, runId).find((rec) => rec.scope === "plugin")!;
      const before = snapshot(project);
      const cases: Array<[string, string[], number, RegExp]> = [
        ["unknown id", ["recommendation", "decide", runId, "rec-0000000000000000", "accept"], 1, /was not found/],
        ["unsafe source", ["recommendation", "decide", "../escape", plugin.id, "accept"], 1, /safe path component/],
        ["invalid status", ["recommendation", "status", runId, plugin.id, "bogus"], 2, /invalid command/],
        ["unauthorized transition", ["recommendation", "status", runId, plugin.id, "implemented"], 1, /not authorized/],
        ["stale expected context", ["recommendation", "decide", runId, plugin.id, "accept",
          "--expected-analysis-id", inspected.source_analysis_id, "--expected-input-hash", `sha256:${"0".repeat(64)}`], 1, /expected_context_changed/],
      ];
      for (const [label, args, exit, message] of cases) {
        const r = cli(sb, project, ...args);
        expect(r.status, label).toBe(exit);
        expect(r.stderr, label).toMatch(message);
      }
      const source = path.join(project, ".guild", "recommendations", `${runId}.jsonl`);
      fs.appendFileSync(source, "{not json\n");
      const corrupt = cli(sb, project, "recommendation", "decide", runId, plugin.id, "accept");
      expect(corrupt.status).toBe(1);
      expect(corrupt.stderr).toMatch(/is not valid JSON/);
      const after = snapshot(project);
      after[`.guild/recommendations/${runId}.jsonl`] = after[`.guild/recommendations/${runId}.jsonl`].replace(/\{not json\n$/, "");
      expect(after).toEqual(before);
    });

    it("B04-AC2 [failed transaction]: a held lock refuses; a mid-write failure rolls back and recovers", () => {
      const project = makeProject(sb, "transaction");
      const runId = producePackagedRun(sb, project, "/guild:build");
      expect(cli(sb, project, "run", "analyze", runId).status).toBe(0);
      const projectRec = recs(project, runId).find((rec) => rec.scope === "project")!;
      const store = path.join(project, ".guild", "recommendations");

      fs.writeFileSync(path.join(store, ".write.lock"), JSON.stringify({ schema_version: "guild.recommendation_lock.v1", pid: process.pid, created_at: new Date().toISOString() }));
      const lockedBefore = snapshot(project);
      const locked = cli(sb, project, "recommendation", "decide", runId, projectRec.id, "accept");
      expect(locked.status).toBe(1);
      expect(locked.stderr).toMatch(/locked by another writer/);
      expect(snapshot(project)).toEqual(lockedBefore);
      fs.rmSync(path.join(store, ".write.lock"));

      if (process.platform !== "darwin") {
        throw new Error("B04_TXN_PLATFORM: the mid-write rollback control needs the darwin user-immutable flag (chflags uchg)");
      }
      // queue.jsonl is immutable, so the source rewrite lands first and the queue rename fails mid-transaction.
      const before = snapshot(project);
      const queue = path.join(store, "queue.jsonl");
      expect(spawnSync("chflags", ["uchg", queue]).status).toBe(0);
      let failed: Proc;
      try {
        failed = cli(sb, project, "recommendation", "decide", runId, projectRec.id, "accept");
      } finally {
        spawnSync("chflags", ["nouchg", queue]);
      }
      expect(failed.status).toBe(1);
      expect(failed.stderr).toMatch(/recommendation transaction failed and recovery is pending: .*EPERM/);
      const after = snapshot(project);
      expect(Object.keys(after).filter((key) => before[key] !== after[key])).toEqual([".guild/recommendations/.transaction.json"]);

      const recovered = cli(sb, project, "recommendation", "decide", runId, projectRec.id, "accept");
      expect(recovered.status, recovered.stderr).toBe(0);
      expect(JSON.parse(recovered.stdout)).toMatchObject({ status: "queued", effect: "project_proposal_queued" });
      expect(fs.existsSync(path.join(store, ".transaction.json"))).toBe(false);
    });

    it("isolation: no scenario re-entered tsx, bun or npx", () => {
      expect(fs.existsSync(sb.sentinel)).toBe(false);
    });
  });
}
