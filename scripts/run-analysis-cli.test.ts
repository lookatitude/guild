import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
