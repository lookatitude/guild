import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { buildOne, targets, type Target } from "./compile";

const RUN = "run-20260812-030000-cli";

const REPO = path.resolve(__dirname, "..");

/** The C-CLI contract path a shipped package serves: node <pkg>/runtime/scripts/run-analysis.js. */
const COMPILED_OUT = "runtime/scripts/run-analysis.js";

function runAnalysisTarget(): Target {
  const t = targets().find((candidate) => candidate.id === "scripts/run-analysis");
  if (!t) throw new Error("compile table lost the scripts/run-analysis target (C01)");
  return t;
}

/** Absolute path of the real `node` on this machine (resolved once, outside the shimmed PATH). */
const REAL_NODE = spawnSync("/bin/sh", ["-c", "command -v node"], { encoding: "utf8" }).stdout.trim();

/**
 * An "installed package" fixture: the compiled bundle at its contract path inside a
 * directory that is NOT the repo, plus a PATH whose only entries are (1) a shim dir
 * where `tsx`/`bun`/`npx` record any invocation to a sentinel and fail, and (2) the
 * real node's dir. Any fallback through tsx/bun/npx is observable, and the plugin
 * source tree is unreachable from the package.
 */
function makeInstalledPackage(compiledAbs: string | null): { pkg: string; env: NodeJS.ProcessEnv; sentinel: string } {
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "guild-installed-pkg-"));
  if (compiledAbs) {
    const dest = path.join(pkg, COMPILED_OUT);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(compiledAbs, dest);
  }
  const shims = path.join(pkg, "shims");
  fs.mkdirSync(shims);
  const sentinel = path.join(pkg, "shim-invoked.sentinel");
  for (const name of ["tsx", "bun", "npx"]) {
    const shim = path.join(shims, name);
    fs.writeFileSync(shim, `#!/bin/sh\necho "${name}" >> "${sentinel}"\nexit 3\n`);
    fs.chmodSync(shim, 0o755);
  }
  const env: NodeJS.ProcessEnv = {
    PATH: `${shims}:${path.dirname(REAL_NODE)}`,
    NODE_PATH: "",
    HOME: pkg,
  };
  return { pkg, env, sentinel };
}

function makeRunRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-cli-"));
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
  return root;
}

describe("run-analysis CLI (author plane)", () => {
  let root: string;

  beforeEach(() => {
    root = makeRunRoot();
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("executes the shipped run analyze surface and writes canonical artifacts", () => {
    const tsx = path.resolve(__dirname, "node_modules/.bin/tsx");
    const cli = path.resolve(__dirname, "run-analysis.ts");
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
    const tsx = path.resolve(__dirname, "node_modules/.bin/tsx");
    const cli = path.resolve(__dirname, "run-analysis.ts");
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
    const tsx = path.resolve(__dirname, "node_modules/.bin/tsx");
    const cli = path.resolve(__dirname, "run-analysis.ts");
    const result = spawnSync(tsx, [cli, "recommendation", "decide", "../escape", "rec-1", "accept", "--cwd", root], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/safe path component/);
  });
});

describe("run-analysis compiled runtime target (C01)", () => {
  let outRoot: string;
  let compiled: string;

  beforeAll(() => {
    // Compile the run-analysis target exactly as scripts/compile.ts does — same
    // target row, same options — into a scratch dir (generated bytes stay
    // uncommitted; the committed copy is C05's integration barrier).
    const t = runAnalysisTarget();
    outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-compiled-"));
    const outAbs = path.join(outRoot, t.out);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    buildOne(t, outAbs);
    compiled = outAbs;
  });

  afterAll(() => fs.rmSync(outRoot, { recursive: true, force: true }));

  it("C01-AC2: compile target, inventory entry and the C-CLI contract path agree", () => {
    const t = runAnalysisTarget();
    expect(t.entry).toBe("scripts/run-analysis.ts");
    expect(t.out).toBe(COMPILED_OUT);
    expect(t.group).toBe("scripts");
    const inventory = JSON.parse(fs.readFileSync(path.join(REPO, "guild.inventory.json"), "utf8")) as {
      scripts: Array<{ id: string; source_path: string; kind: string }>;
    };
    const entry = inventory.scripts.find((s) => s.id === "run-analysis");
    expect(entry).toBeDefined();
    expect(entry!.source_path).toBe(t.entry);
  });

  it("C01-AC1: Node18+ launches the installed bundle with no Bun, tsx or plugin source reachable", () => {
    const major = Number(spawnSync(REAL_NODE, ["--version"], { encoding: "utf8" }).stdout.replace(/^v/, "").split(".")[0]);
    expect(major).toBeGreaterThanOrEqual(18);
    const root = makeRunRoot();
    const { pkg, env, sentinel } = makeInstalledPackage(compiled);
    try {
      // Launch from the installed package, cwd far from the repo: the bundle must
      // be self-contained, and any tsx/bun/npx re-entry would hit a failing shim.
      const installed = path.join(pkg, COMPILED_OUT);
      const result = spawnSync(REAL_NODE, [installed, "run", "analyze", RUN, "--cwd", root], {
        encoding: "utf8",
        cwd: root,
        env,
      });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).eligible).toBe(true);
      expect(fs.existsSync(path.join(root, ".guild", "analysis", "runs", RUN, "analysis.json"))).toBe(true);
      expect(fs.existsSync(sentinel)).toBe(false);
      // Negative control: closed flags — an unknown option is a usage refusal (exit 2).
      const unknown = spawnSync(REAL_NODE, [installed, "run", "analyze", RUN, "--nope"], { encoding: "utf8", cwd: root, env });
      expect(unknown.status).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(pkg, { recursive: true, force: true });
    }
  });

  it("C01-AC1: the compiled bundle never re-enters tsx/bun via its shebang", () => {
    const firstLine = fs.readFileSync(compiled, "utf8").split("\n", 1)[0];
    if (firstLine.startsWith("#!")) {
      expect(firstLine).not.toMatch(/\b(npx|tsx|bun)\b/);
    }
  });

  it("C01-AC3: a package missing the compiled output fails closed — no fallback download/compile/tsx", () => {
    const root = makeRunRoot();
    // Installed package WITHOUT the bundle: the exact contract path is absent.
    const { pkg, env, sentinel } = makeInstalledPackage(null);
    try {
      const installed = path.join(pkg, COMPILED_OUT);
      const result = spawnSync(REAL_NODE, [installed, "run", "analyze", RUN, "--cwd", root], {
        encoding: "utf8",
        cwd: root,
        env,
      });
      // Recorded refusal: the user-path launch of the contract path refuses…
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/run-analysis\.js/);
      // …nothing regenerated the bundle, no tsx/bun/npx fallback ran, no artifact appeared.
      expect(fs.existsSync(installed)).toBe(false);
      expect(fs.existsSync(sentinel)).toBe(false);
      expect(fs.existsSync(path.join(root, ".guild", "analysis"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(pkg, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B03 — read-only inspect and browser-bound (expected-context) decisions.
// ─────────────────────────────────────────────────────────────────────────────

const B03_RUN = "run-20260812-040000-b03";
const TSX = path.resolve(__dirname, "node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "run-analysis.ts");

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(TSX, [CLI, ...args], { encoding: "utf8" });
}

/** Byte + kind snapshot of every path under root/.guild (or the root itself). */
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

/** Incomplete run (plugin telemetry_gap) with a repeated failure (project rec) and one consumed sidecar. */
function seedB03(root: string): string {
  const dir = path.join(root, ".guild", "runs", B03_RUN);
  fs.mkdirSync(path.join(dir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sidecars"), { recursive: true });
  fs.writeFileSync(path.join(dir, "run.yaml"), [
    "schema_version: guild.run.v1", `run_id: ${B03_RUN}`, "run_scope: independent", "initiative_attachment: null",
    "independent_run_group: cli", "config_snapshot_ref: null", "run_class: full", "status: closed", "host:", "  resolved: codex", "",
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "provenance.json"), JSON.stringify({ schema_version: "guild.provenance.v1", run_id: B03_RUN }) + "\n");
  fs.writeFileSync(path.join(dir, "sidecars", "cursor.json"), JSON.stringify({
    schema_version: "guild.phase_cursor.v1", run_id: B03_RUN, visited_phases: ["plan", "execute"], bypassed_phases: [],
  }) + "\n");
  const events = [
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T04:00:00Z", run_id: B03_RUN, lane_id: "", event_class: "prompt_received", actor_type: "user", actor_id: "operator", status: "ok", span_id: "prompt-1", prompt_hash: "hash-1", redaction: "omitted" },
    { ts: "2026-08-12T04:00:01.000Z", event: "tool_call", run_id: B03_RUN, lane_id: "T1", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
    { ts: "2026-08-12T04:00:02.000Z", event: "tool_call", run_id: B03_RUN, lane_id: "T1", tool: "Bash", command_redacted: "failing command", result_excerpt_redacted: "failed", status: "err", latency_ms: 1 },
    { schema_version: "guild.trace.analysis.v2", ts: "2026-08-12T04:00:03Z", run_id: B03_RUN, lane_id: "", event_class: "run_closed", actor_type: "lead", actor_id: "main", status: "ok", span_id: "close-cursor", run_scope: "independent", payload_ref: "sidecars/cursor.json" },
  ];
  fs.writeFileSync(path.join(dir, "logs", "v1.4-events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  return dir;
}

function recommendations(root: string): Array<{ id: string; scope: string; status: string }> {
  return fs.readFileSync(path.join(root, ".guild", "recommendations", `${B03_RUN}.jsonl`), "utf8").trim().split("\n").map((row) => JSON.parse(row));
}

describe("B03 — run-analysis artifact inspect + expected-context decisions", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-b03-")); seedB03(root); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("[inspect] cli-inspect-missing-current-stale-refused-and-no-writes", () => {
    const before = snapshot(root);
    const missing = cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]);
    expect(missing.status).toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({ ok: true, state: "missing", kind: "run", source_id: B03_RUN, eligible: false, reason: "artifact_missing" });
    const missingComparison = cli(["artifact", "inspect", "comparison", "comparison-0000000000000000", "--cwd", root]);
    expect(missingComparison.status).toBe(0);
    expect(JSON.parse(missingComparison.stdout).state).toBe("missing");
    const refused = cli(["artifact", "inspect", "run", "../escape", "--cwd", root]);
    expect(refused.status).toBe(1);
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, state: "refused", reason: "unsafe_source_id" });
    expect(snapshot(root)).toEqual(before);

    const analyze = cli(["run", "analyze", B03_RUN, "--cwd", root]);
    expect(analyze.status).toBe(0);
    const analysis = JSON.parse(fs.readFileSync(path.join(root, ".guild", "analysis", "runs", B03_RUN, "analysis.json"), "utf8"));
    const afterAnalyze = snapshot(root);
    const current = JSON.parse(cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]).stdout);
    expect(current).toEqual({
      ok: true, state: "current", kind: "run", source_id: B03_RUN, artifact_ref: `.guild/analysis/runs/${B03_RUN}/analysis.json`,
      schema_version: "guild.run_analysis.v1", source_analysis_id: analysis.analysis_id, source_hash: analysis.source_hash,
      current_source_hash: analysis.source_hash, input_hash: analysis.diagnostics.input_hash,
      current_input_hash: analysis.diagnostics.input_hash, eligible: true, reason: null,
    });
    fs.appendFileSync(path.join(root, ".guild", "runs", B03_RUN, "sidecars", "cursor.json"), " ");
    const stale = cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]);
    expect(stale.status).toBe(0);
    expect(JSON.parse(stale.stdout)).toMatchObject({ state: "stale", reason: "stale_inputs", source_hash: analysis.source_hash, current_source_hash: analysis.source_hash, eligible: false });
    const afterStale = snapshot(root);
    delete afterStale[`.guild/runs/${B03_RUN}/sidecars/cursor.json`];
    const expectedTree = { ...afterAnalyze };
    delete expectedTree[`.guild/runs/${B03_RUN}/sidecars/cursor.json`];
    expect(afterStale).toEqual(expectedTree);
  });

  it("[cli] run-analyze-reuses-a-current-artifact-and-regenerates-a-stale-one", () => {
    const first = JSON.parse(cli(["run", "analyze", B03_RUN, "--cwd", root]).stdout);
    expect(first).toMatchObject({ cache: "recomputed", reason: "missing" });
    const tree = snapshot(root);
    const second = JSON.parse(cli(["run", "analyze", B03_RUN, "--cwd", root]).stdout);
    expect(second).toMatchObject({ analysis_id: first.analysis_id, cache: "hit", reason: null, written: null });
    expect(snapshot(root)).toEqual(tree);
    fs.appendFileSync(path.join(root, ".guild", "runs", B03_RUN, "logs", "v1.4-events.jsonl"),
      JSON.stringify({ ts: "2026-08-12T04:00:09.000Z", event: "phase_start", run_id: B03_RUN, phase: "execute" }) + "\n");
    const third = JSON.parse(cli(["run", "analyze", B03_RUN, "--cwd", root]).stdout);
    expect(third).toMatchObject({ cache: "recomputed", reason: "stale_source" });
    expect(third.analysis_id).not.toBe(first.analysis_id);
  });

  it.each([
    ["one expected flag", ["--expected-analysis-id", "analysis:x:000000000000"]],
    ["duplicate flag", ["--expected-analysis-id", "a", "--expected-analysis-id", "b", "--expected-input-hash", `sha256:${"0".repeat(64)}`]],
    ["missing flag value", ["--expected-analysis-id"]],
    ["unknown flag", ["--expected-hash", "x"]],
  ])("[cli] decide-usage-error-%s-exits-2-without-writes", (_label, extra) => {
    cli(["run", "analyze", B03_RUN, "--cwd", root]);
    const before = snapshot(root);
    const [rec] = recommendations(root);
    const result = cli(["recommendation", "decide", B03_RUN, rec.id, "accept", ...extra, "--cwd", root]);
    expect(result.status).toBe(2);
    expect(snapshot(root)).toEqual(before);
  });

  it("[cli] expected-flags-are-refused-outside-decide", () => {
    const result = cli(["artifact", "inspect", "run", B03_RUN, "--expected-analysis-id", "a", "--expected-input-hash", `sha256:${"0".repeat(64)}`, "--cwd", root]);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/only to recommendation decide/);
  });

  it("[decide] cli-browser-decision-with-exact-context-writes-local-effects-only", () => {
    cli(["run", "analyze", B03_RUN, "--cwd", root]);
    const inspected = JSON.parse(cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]).stdout);
    const malformed = cli(["recommendation", "decide", B03_RUN, recommendations(root)[0].id, "accept",
      "--expected-analysis-id", inspected.source_analysis_id, "--expected-input-hash", "sha256:NOT-HEX", "--cwd", root]);
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toMatch(/expected-input-hash/);
    const outsideBefore = snapshot(root);
    for (const rec of recommendations(root)) {
      const decided = cli(["recommendation", "decide", B03_RUN, rec.id, "accept",
        "--expected-analysis-id", inspected.source_analysis_id, "--expected-input-hash", inspected.input_hash, "--cwd", root]);
      expect(decided.status).toBe(0);
      expect(JSON.parse(decided.stdout)).toMatchObject(rec.scope === "plugin"
        ? { status: "accepted", effect: "plugin_draft_written" }
        : { status: "queued", effect: "project_proposal_queued" });
    }
    const after = snapshot(root);
    const changed = Object.keys({ ...outsideBefore, ...after }).filter((key) => outsideBefore[key] !== after[key]);
    // Accept writes only the local draft / project queue / source / activity: never a capability or remote effect.
    expect(changed.every((key) => key.startsWith(".guild/recommendations/"))).toBe(true);
    const draft = changed.find((key) => key.startsWith(".guild/recommendations/drafts/") && key.endsWith(".md"))!;
    expect(after[draft]).toContain("external filing has not occurred");
    expect(after[".guild/recommendations/queue.jsonl"]).toContain('"status":"queued"');
  });
});

/**
 * Real two-process barrier. Process 1 (CLI) inspects. The decision child then
 * starts, signals readiness and blocks BEFORE it enters the recommendation lock.
 * The test mutates context (raw event, sidecar, or a regenerating CLI process),
 * snapshots the tree, releases the barrier, and requires the child to refuse
 * with expected_context_changed and leave the tree byte-identical.
 */
describe("B03 — two-process stale-consent barrier", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-analysis-barrier-")); seedB03(root); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  /**
   * `pre-lock`: the child blocks before decideRecommendation. `in-lock`: the
   * child blocks right after it wrote its owner record into the O_EXCL lock
   * file, so the parent's mutation lands while the child HOLDS the lock and
   * before its in-lock freshness check runs.
   */
  function launchDecisionChild(expected: { analysisId: string; inputHash: string }, recIds: string[], at: "pre-lock" | "in-lock" = "pre-lock"): {
    ready: string; go: string; done: Promise<{ code: number | null; stdout: string; stderr: string }>;
  } {
    const ready = path.join(os.tmpdir(), `b03-ready-${process.pid}-${Date.now()}`);
    const go = `${ready}.go`;
    const moduleUrl = pathToFileURL(path.resolve(__dirname, "../src/domains/telemetry/run-analysis.ts")).href;
    const script = `
      import fs from "node:fs";
      import runAnalysis from ${JSON.stringify(moduleUrl)};
      const { decideRecommendation } = runAnalysis;
      const barrier = () => {
        fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));
        const deadline = Date.now() + 20000;
        while (!fs.existsSync(${JSON.stringify(go)})) {
          if (Date.now() > deadline) { process.stderr.write("barrier timeout"); process.exit(3); }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
      };
      if (${JSON.stringify(at)} === "in-lock") {
        const write = fs.writeFileSync;
        let armed = true;
        fs.writeFileSync = function (target, data, ...rest) {
          const out = write.call(this, target, data, ...rest);
          if (armed && typeof target === "number" && String(data).includes('"guild.recommendation_lock.v1"')) { armed = false; barrier(); }
          return out;
        };
      } else barrier();
      const results = [];
      for (const id of ${JSON.stringify(recIds)}) {
        try { results.push({ id, ok: true, ...decideRecommendation(${JSON.stringify(root)}, ${JSON.stringify(B03_RUN)}, id, "accept", ${JSON.stringify(expected)}) }); }
        catch (error) { results.push({ id, ok: false, error: String(error && error.message) }); }
      }
      process.stdout.write(JSON.stringify(results));
    `;
    const tsx = require.resolve("tsx", { paths: [__dirname] });
    const child = spawn(process.execPath, ["--import", tsx, "--input-type=module", "-e", script], { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => child.on("close", (code) => {
      fs.rmSync(ready, { force: true });
      fs.rmSync(go, { force: true });
      resolve({ code, stdout, stderr });
    }));
    return { ready, go, done };
  }

  async function waitFor(file: string): Promise<void> {
    const deadline = Date.now() + 20000;
    while (!fs.existsSync(file)) {
      if (Date.now() > deadline) throw new Error(`barrier never reached: ${file}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  const appendEvent = (root: string): void => fs.appendFileSync(path.join(root, ".guild", "runs", B03_RUN, "logs", "v1.4-events.jsonl"),
    JSON.stringify({ ts: "2026-08-12T04:00:09.000Z", event: "phase_start", run_id: B03_RUN, phase: "execute" }) + "\n");

  const MUTATIONS: Array<[string, ((root: string) => void) | null, RegExp | null]> = [
    ["control-no-mutation-decides", null, null],
    ["sidecar-changed-same-source-hash", (r) => fs.appendFileSync(path.join(r, ".guild", "runs", B03_RUN, "sidecars", "cursor.json"), " "), /expected_context_changed: stale:stale_inputs/],
    ["trace-appended-after-inspect", appendEvent, /expected_context_changed: stale:stale_source/],
    ["regenerated-same-rec-id-new-analysis-id", (r) => {
      appendEvent(r);
      const regen = cli(["run", "analyze", B03_RUN, "--cwd", r]);
      if (regen.status !== 0) throw new Error(regen.stderr);
    }, /expected_context_changed: analysis_identity_changed/],
  ];

  it.each(MUTATIONS)("[barrier] %s", async (_label, mutate, refusal) => {
    expect(cli(["run", "analyze", B03_RUN, "--cwd", root]).status).toBe(0);
    const inspect = cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]);
    expect(inspect.status).toBe(0);
    const inspected = JSON.parse(inspect.stdout);
    expect(inspected.state).toBe("current");
    const recIds = recommendations(root).map((rec) => rec.id).sort();
    expect(recIds).toHaveLength(2);

    const child = launchDecisionChild({ analysisId: inspected.source_analysis_id, inputHash: inspected.input_hash }, recIds);
    await waitFor(child.ready);
    mutate?.(root);
    if (mutate && _label.startsWith("regenerated")) {
      // Same recommendation ids survive regeneration; only the analysis identity moved.
      expect(recommendations(root).map((rec) => rec.id).sort()).toEqual(recIds);
      expect(JSON.parse(cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]).stdout)).toMatchObject({ state: "current" });
    }
    const beforeDecision = snapshot(root);
    fs.writeFileSync(child.go, "go");
    const outcome = await child.done;
    expect(outcome.code).toBe(0);
    const results = JSON.parse(outcome.stdout) as Array<{ ok: boolean; error?: string; effect?: string }>;
    const after = snapshot(root);
    if (refusal === null) {
      expect(results.map((item) => item.effect).sort()).toEqual(["plugin_draft_written", "project_proposal_queued"]);
      expect(Object.keys(after).some((key) => key.startsWith(".guild/recommendations/drafts/"))).toBe(true);
      expect(after[".guild/recommendations/activity.jsonl"]).toBeDefined();
      return;
    }
    expect(results.every((item) => !item.ok && refusal.test(item.error ?? ""))).toBe(true);
    expect(after).toEqual(beforeDecision);
    expect(Object.keys(after).some((key) => key.startsWith(".guild/recommendations/drafts/"))).toBe(false);
    expect(after[".guild/recommendations/activity.jsonl"]).toBeUndefined();
  }, 60000);

  it.each(MUTATIONS.filter(([, mutate]) => mutate !== null).slice(0, 2))("[barrier] in-lock %s", async (_label, mutate, refusal) => {
    expect(cli(["run", "analyze", B03_RUN, "--cwd", root]).status).toBe(0);
    const inspected = JSON.parse(cli(["artifact", "inspect", "run", B03_RUN, "--cwd", root]).stdout);
    expect(inspected.state).toBe("current");
    const recIds = recommendations(root).map((rec) => rec.id).sort();
    const child = launchDecisionChild({ analysisId: inspected.source_analysis_id, inputHash: inspected.input_hash }, recIds, "in-lock");
    await waitFor(child.ready);
    // The child holds the real lock: its pid owns the lock file and a contending writer is refused.
    const lock = path.join(root, ".guild", "recommendations", ".write.lock");
    expect(JSON.parse(fs.readFileSync(lock, "utf8")).pid).toBe(Number(fs.readFileSync(child.ready, "utf8")));
    const contender = cli(["recommendation", "decide", B03_RUN, recIds[0], "accept", "--cwd", root]);
    expect(contender.status).not.toBe(0);
    expect(contender.stderr).toMatch(/locked by another writer/);
    mutate!(root);
    const beforeDecision = snapshot(root);
    delete beforeDecision[".guild/recommendations/.write.lock"];
    fs.writeFileSync(child.go, "go");
    const outcome = await child.done;
    expect(outcome.code).toBe(0);
    const results = JSON.parse(outcome.stdout) as Array<{ ok: boolean; error?: string }>;
    expect(results.every((item) => !item.ok && refusal!.test(item.error ?? ""))).toBe(true);
    expect(snapshot(root)).toEqual(beforeDecision);
  }, 60000);
});
