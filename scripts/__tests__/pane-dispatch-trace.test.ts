/**
 * scripts/__tests__/pane-dispatch-trace.test.ts
 *
 * Issue #76 — pane/cmux-dispatched lanes are invisible to the ORCHESTRATING
 * run's trace.
 *
 * Real-world evidence (run-f40a6c53-…, a 10-lane pane run): the orchestrating
 * run's `logs/v1.4-events.jsonl` held only `tool_call` + one `SubagentStop`
 * line, so `trace-summarize` reported `specialists_dispatched: [(none)]` and
 * `guild:reflect` saw a solo run. The #58/#66 attribution work
 * (hooks/lib/dispatch-attribution.ts → trace-v2.ts `attribution_specialist`)
 * covers only the in-session `Agent`-tool path; a pane launched as its own
 * interactive session writes into ITS OWN session, never the parent's trace.
 *
 * These are REAL-PATH tests: they spawn the actual `agent-team-launcher.ts` and
 * `trace-summarize.ts` CLIs against temp consumer repos, with a stub `tmux` on
 * PATH (no real tmux server). Nothing is mocked at the module seam.
 *
 * Coverage:
 *  1. launcher emit — a real (non-dry-run) tmux launch appends ONE
 *     `guild.trace.dispatch.v1` line per specialist to the ORCHESTRATING run's
 *     canonical log, carrying attribution_specialist + task_id + pane id +
 *     pane target + backend "tmux".
 *  2. dry-run emits NO pane dispatch (nothing was dispatched).
 *  3. summarizer counts them — a run whose ONLY specialist signal is pane
 *     dispatch reports real specialist names + a dispatch count, and does NOT
 *     invent bogus errors from the `ok`-less trace lines.
 *  4. the Agent-tool / in-process path is UNCHANGED — write-task-run's
 *     pre-routing emit keeps backend "unknown" and carries no pane fields.
 *  5. the cmux rung — which SKILL.md documents as bypassing the launcher — can
 *     record the same receipt through the module's CLI.
 *  6. end-to-end: launcher → summarizer over the SAME run dir, so the two
 *     halves are proven to agree on real (not synthetic) events.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as yaml from "js-yaml";

const LAUNCHER = path.resolve(__dirname, "../agent-team-launcher.ts");
const SUMMARIZER = path.resolve(__dirname, "../trace-summarize.ts");
const PANE_TRACE_CLI = path.resolve(__dirname, "../lib/host/pane-dispatch-trace.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");

function runScript(
  script: string,
  args: string[],
  env: Record<string, string | undefined> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const baseEnv: Record<string, string | undefined> = { ...process.env };
  delete baseEnv.TMUX;
  const finalEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...baseEnv, ...env })) {
    if (v !== undefined) finalEnv[k] = v;
  }
  const result = spawnSync("npx", ["tsx", script, ...args], {
    encoding: "utf8",
    env: finalEnv,
    timeout: 120_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function setupConsumerRepo(
  tmpDir: string,
  slug: string,
  fixture = "team-agent-team.yaml",
): string {
  const teamDir = path.join(tmpDir, ".guild", "team");
  fs.mkdirSync(teamDir, { recursive: true });
  const dst = path.join(teamDir, `${slug}.yaml`);
  fs.copyFileSync(path.join(FIXTURES, fixture), dst);
  return dst;
}

/** guild.host_capability.v1 manifest the launcher's cross-host routing reads. */
function writeHostManifest(cwd: string, hostId: string, hostKind: "claude" | "codex"): void {
  const dir = path.join(cwd, ".guild", "hosts", hostId);
  fs.mkdirSync(dir, { recursive: true });
  const tierModels =
    hostKind === "codex"
      ? { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" }
      : { cheap: "haiku", mid: "sonnet", powerful: "opus" };
  fs.writeFileSync(
    path.join(dir, "capability.json"),
    JSON.stringify({
      schema_version: "guild.host_capability.v1",
      host_id: hostId,
      host_kind: hostKind,
      advertised_at: new Date().toISOString(),
      source: "test",
      tier_models: tierModels,
      supported_tiers: ["cheap", "mid", "powerful"],
      models: Object.values(tierModels),
      tool_support: {
        subagent: true,
        agent_team: hostKind === "claude",
        independent_agents: hostKind === "claude",
        tmux: hostKind === "claude",
        mcp: true,
        pre_tool_use_ask: hostKind === "claude",
      },
    }),
    "utf8",
  );
}

/**
 * Stub `tmux` that also answers `list-panes` with the orchestrator + one pane
 * per fixture specialist, in the exact `#{pane_index}\t#{pane_id}\t#{pane_title}`
 * shape TmuxTeamBackend.spawn() asks for. `%%` is printf's literal `%`, so the
 * ids materialize as %0/%1/%2/%3 — real tmux pane ids.
 */
function makeFakeTmuxBin(tmpDir: string): string {
  const binDir = path.join(tmpDir, "fakebin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "tmux"),
    [
      "#!/bin/sh",
      'case "$1" in',
      '  -V) echo "tmux 3.4 (fake)"; exit 0;;',
      "  list-windows) printf 'other-window\\n'; exit 0;;",
      "  list-panes) printf '0\\t%%0\\torchestrator\\n1\\t%%1\\tarchitect\\n2\\t%%2\\tbackend\\n3\\t%%3\\tqa\\n'; exit 0;;",
      '  display-message) echo "fake-session"; exit 0;;',
      "  *) exit 0;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return binDir;
}

/**
 * Adds `ssh`, `claude` and `codex` stubs alongside the tmux stub so the REMOTE
 * rung runs end-to-end without a network. SshRemoteTransport shells out to
 * `ssh` three times — reachability (`true`), a `command -v` tool probe whose
 * STDOUT it parses, and the pane spawn — so the stub runs its last argument
 * locally instead of exiting 0 blindly (which would fail the probe: no
 * "PRESENT <bin>" lines ⇒ "missing required tool(s)").
 */
function makeFakeRemoteBin(tmpDir: string): string {
  const binDir = makeFakeTmuxBin(tmpDir);
  fs.writeFileSync(
    path.join(binDir, "ssh"),
    ['#!/bin/sh', 'for a in "$@"; do last="$a"; done', 'exec sh -c "$last"', ""].join("\n"),
    { mode: 0o755 },
  );
  for (const bin of ["claude", "codex"]) {
    fs.writeFileSync(path.join(binDir, bin), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return binDir;
}

function writeSettingsCrossHost(
  cwd: string,
  hosts: Record<string, { address: string; user?: string }>,
): void {
  const dir = path.join(cwd, ".guild");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "settings.json"),
    JSON.stringify({ defaults: { cross_host: { enabled: true, hosts } } }, null, 2),
    "utf8",
  );
}

interface TraceLine {
  schema_version?: string;
  specialist?: string;
  task_id?: string;
  backend?: string;
  backend_rung?: number;
  attribution_specialist?: string;
  pane_id?: string;
  pane_target?: string;
  pane_backend?: string;
  phase?: string;
  run_id?: string;
  lane_id?: string;
  [k: string]: unknown;
}

function readCanonicalLog(cwd: string, runId: string): TraceLine[] {
  const file = path.join(cwd, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TraceLine);
}

/** The dispatch events that record a lane actually reaching a visible pane. */
function paneDispatches(lines: TraceLine[]): TraceLine[] {
  return lines.filter(
    (l) =>
      l.schema_version === "guild.trace.dispatch.v1" &&
      l.backend === "tmux" &&
      l.pane_backend === undefined,
  );
}


/**
 * Parse the summary's YAML frontmatter with the shared js-yaml parser
 * (comms-format OD-3: no line-anchored YAML-key regex extractors in tests).
 */
function readFrontmatter(summary: string): Record<string, unknown> {
  const end = summary.indexOf("\n---", 4);
  const block = summary.slice(4, end);
  return yaml.load(block) as Record<string, unknown>;
}

describe("issue #76 — pane-dispatched lanes in the orchestrating run trace", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pane-trace-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. The launcher's pane path writes dispatch events into the PARENT run
  // ───────────────────────────────────────────────────────────────────────────
  describe("agent-team-launcher tmux pane path", () => {
    const RUN_ID = "run-pane-76";

    it("appends one guild.trace.dispatch.v1 per specialist to the orchestrating run", () => {
      const teamPath = setupConsumerRepo(tmpDir, "test-slug");
      const fakeBin = makeFakeTmuxBin(tmpDir);

      const { exitCode } = runScript(
        LAUNCHER,
        ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      );
      expect(exitCode).toBe(0);

      const dispatches = paneDispatches(readCanonicalLog(tmpDir, RUN_ID));
      // team-agent-team.yaml ships architect + backend + qa.
      expect(dispatches.map((d) => d.specialist).sort()).toEqual([
        "architect",
        "backend",
        "qa",
      ]);
    });

    it("carries attribution_specialist, task id, pane id, pane target and backend kind", () => {
      const teamPath = setupConsumerRepo(tmpDir, "test-slug");
      const fakeBin = makeFakeTmuxBin(tmpDir);

      runScript(LAUNCHER, ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID], {
        TMUX: "/tmp/tmux-1000/default,12345,0",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      });

      const backendLane = paneDispatches(readCanonicalLog(tmpDir, RUN_ID)).find(
        (d) => d.specialist === "backend",
      );
      expect(backendLane).toBeDefined();
      // #58 parity: the SAME field name the Agent-tool path stamps, so one
      // consumer query spans both dispatch paths.
      expect(backendLane!.attribution_specialist).toBe("backend");
      expect(backendLane!.task_id).toBe("backend");
      expect(backendLane!.pane_id).toBe("%2");
      expect(backendLane!.pane_target).toBe("guild-test-slug");
      expect(backendLane!.backend).toBe("tmux");
      expect(backendLane!.run_id).toBe(RUN_ID);
      // rung 1 = the full/visible-pane substrate (not a degraded fallback).
      expect(backendLane!.backend_rung).toBe(1);
    });

    it("does NOT emit a pane dispatch on --dry-run (nothing was dispatched)", () => {
      const teamPath = setupConsumerRepo(tmpDir, "test-slug");
      const { exitCode } = runScript(
        LAUNCHER,
        ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID, "--dry-run"],
        { TMUX: "/tmp/tmux-1000/default,12345,0" },
      );
      expect(exitCode).toBe(0);
      expect(paneDispatches(readCanonicalLog(tmpDir, RUN_ID))).toHaveLength(0);
    });

    // Regression guard for the Agent-tool / in-process path (#58/#66 territory):
    // write-task-run's pre-routing emit must stay backend "unknown" with NO pane
    // fields — this lane only ADDS the pane-path receipt.
    it("leaves the pre-routing write-task-run dispatch emit unchanged", () => {
      const teamPath = setupConsumerRepo(tmpDir, "test-slug");
      const fakeBin = makeFakeTmuxBin(tmpDir);

      runScript(LAUNCHER, ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID], {
        TMUX: "/tmp/tmux-1000/default,12345,0",
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      });

      const preRouting = readCanonicalLog(tmpDir, RUN_ID).filter(
        (l) => l.schema_version === "guild.trace.dispatch.v1" && l.backend === "unknown",
      );
      expect(preRouting.length).toBeGreaterThan(0);
      for (const e of preRouting) {
        expect(e.backend_rung).toBe(0);
        expect(e.pane_id).toBeUndefined();
        expect(e.pane_target).toBeUndefined();
        // Critically: no pane_backend either. That field is what promotes an
        // "unknown" line to a CONFIRMED dispatch, so a pre-routing intent
        // carrying one would be counted as a dispatched lane.
        expect(e.pane_backend).toBeUndefined();
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. The summarizer counts them — the defect the operator actually saw
  // ───────────────────────────────────────────────────────────────────────────
  describe("trace-summarize with a pane-only run", () => {
    const RUN_ID = "run-pane-only-76";

    /**
     * A run whose ONLY specialist signal is pane dispatch: the panes are
     * separate interactive sessions, so their own tool calls never reach this
     * log. Exactly the shape run-f40a6c53-… had, plus the new receipts.
     */
    function seedPaneOnlyRun(): string {
      const runDir = path.join(tmpDir, ".guild", "runs", RUN_ID);
      fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
      const lines = [
        // The lead session's own bookkeeping — `ok`-less, like the real log.
        {
          schema_version: "guild.trace_event.v1",
          event_id: "e0",
          event_name: "run_started",
          at: "2026-07-22T14:49:40.000Z",
        },
        ...["architect", "backend", "qa"].map((name, i) => ({
          schema_version: "guild.trace.dispatch.v1",
          ts: `2026-07-22T14:49:4${i + 1}.000Z`,
          run_id: RUN_ID,
          lane_id: name,
          specialist: name,
          phase: "execute",
          task_id: name,
          backend: "tmux",
          backend_rung: 1,
          dispatched_at: `2026-07-22T14:49:4${i + 1}.000Z`,
          attribution_specialist: name,
          pane_id: `%${i + 1}`,
          pane_target: "guild-test-slug",
        })),
      ];
      fs.writeFileSync(
        path.join(runDir, "logs", "v1.4-events.jsonl"),
        lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
        "utf8",
      );
      return runDir;
    }

    it("reports the real specialist names instead of (none)", () => {
      const runDir = seedPaneOnlyRun();
      const { exitCode } = runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      expect(exitCode).toBe(0);

      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(summary).toMatch(/specialists_dispatched: \[architect, backend, qa\]/);
      expect(summary).not.toMatch(/specialists_dispatched: \[\(none\)\]/);
    });

    it("counts the pane dispatches by backend in the frontmatter", () => {
      const runDir = seedPaneOnlyRun();
      runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(readFrontmatter(summary)["dispatched_lanes"]).toEqual([{ tmux: 3 }]);
    });

    it("does not invent errors from ok-less trace lines", () => {
      const runDir = seedPaneOnlyRun();
      runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      // A `guild.trace.*` line carries no `ok` field. Absence is NOT failure —
      // treating it as one buried the real signal under phantom ERROR rows.
      expect(readFrontmatter(summary)["errors"]).toBe(0);
      expect(summary).toMatch(/No notable events\./);
      expect(summary).not.toMatch(/⚠ ERROR/);
      expect(summary).not.toMatch(/skill-improvement candidates/);
      // …and does not swing to the mirror-image lie either: a verdict-less
      // receipt is NOT a passing tool call. Every dispatched specialist shows
      // 0 OK and 0 errors — no verdict was ever recorded for it in this log.
      for (const name of ["architect", "backend", "qa"]) {
        expect(summary).toMatch(
          new RegExp(`### ${name}\\n- Tool calls: 0\\n- Files touched \\(Write/Edit\\): 0\\n- OK: 0, Errors: 0`),
        );
      }
    });

    // The pre-routing write-task-run emit is one-per-TASK, before routing, with
    // backend "unknown" ("not determinable at emit time" — its own contract).
    // Counting it as a dispatch would report `[tmux: 3, unknown: 5]` for a
    // three-lane run: two different lifecycle signals in two different units.
    it("excludes pre-routing backend:unknown intents from the dispatch count", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "run-mixed-76");
      fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
      const mk = (backend: string, name: string, taskId: string) => ({
        schema_version: "guild.trace.dispatch.v1",
        ts: "2026-07-22T14:49:41.000Z",
        run_id: "run-mixed-76",
        lane_id: taskId,
        specialist: name,
        phase: "execute",
        task_id: taskId,
        backend,
        backend_rung: backend === "unknown" ? 0 : 1,
        dispatched_at: "2026-07-22T14:49:41.000Z",
      });
      fs.writeFileSync(
        path.join(runDir, "logs", "v1.4-events.jsonl"),
        [
          mk("unknown", "backend", "T1"),
          mk("unknown", "backend", "T2"),
          mk("unknown", "qa", "T3"),
          mk("tmux", "backend", "T1"),
          mk("tmux", "qa", "T3"),
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
        "utf8",
      );
      runScript(SUMMARIZER, ["--run-id", "run-mixed-76", "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(readFrontmatter(summary)["dispatched_lanes"]).toEqual([{ tmux: 2 }]);
      expect(summary).not.toMatch(/unknown/);
    });

    // The canonical v1.4 line shape reports failure via `status`, not `ok`
    // (TOOL_CALL_STATUS "err" / PHASE_END_STATUS "error"). Ignoring `ok`-less
    // lines must not blind the summarizer to those.
    it("reports a canonical status:err line as an error", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "run-status-76");
      fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "logs", "v1.4-events.jsonl"),
        [
          { ts: "2026-07-22T14:49:40.000Z", event: "tool_call", tool: "Bash", status: "ok" },
          { ts: "2026-07-22T14:49:41.000Z", event: "tool_call", tool: "Bash", status: "err" },
          { ts: "2026-07-22T14:49:42.000Z", event: "phase_end", status: "error" },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
        "utf8",
      );
      runScript(SUMMARIZER, ["--run-id", "run-status-76", "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(readFrontmatter(summary)["errors"]).toBe(2);
      // …and the healthy status:"ok" line must NOT be flagged.
      expect(summary.match(/⚠ ERROR/g) ?? []).toHaveLength(1);
      // 3 verdict-bearing events, 2 of them failures.
      expect(readFrontmatter(summary)["ok_rate"]).toBe(0.333);
    });

    // ok_rate must be a rate over events that REPORT an outcome. Counting
    // verdict-less lines as successes let a run that verified nothing score 1.0
    // — and #76 puts one receipt per lane on the log, so every pane run would
    // dilute its own rate upward.
    it("computes ok_rate over verdict-bearing events only", () => {
      const runDir = seedPaneOnlyRun();
      runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      const paneOnly = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      // 4 events, NONE carrying a verdict → nothing to rate; not "all passed".
      expect(readFrontmatter(paneOnly)["event_count"]).toBe(4);
      expect(readFrontmatter(paneOnly)["errors"]).toBe(0);
      expect(readFrontmatter(paneOnly)["ok_rate"]).toBe(1);

      // Mixed: the receipts must not dilute a real failure rate. One ok:true +
      // one ok:false alongside 3 receipts is 0.5, not 0.8.
      const mixedId = "run-mixed-rate-76";
      const mixedDir = path.join(tmpDir, ".guild", "runs", mixedId);
      fs.mkdirSync(path.join(mixedDir, "logs"), { recursive: true });
      const receipts = ["architect", "backend", "qa"].map((name, i) => ({
        schema_version: "guild.trace.dispatch.v1",
        ts: `2026-07-22T14:49:4${i}.000Z`,
        run_id: mixedId,
        lane_id: name,
        specialist: name,
        phase: "execute",
        task_id: name,
        backend: "tmux",
        backend_rung: 1,
        dispatched_at: `2026-07-22T14:49:4${i}.000Z`,
      }));
      fs.writeFileSync(
        path.join(mixedDir, "logs", "v1.4-events.jsonl"),
        [
          ...receipts,
          { ts: "2026-07-22T14:50:00.000Z", event: "PostToolUse", tool: "Bash", ok: true, ms: 1 },
          { ts: "2026-07-22T14:50:01.000Z", event: "PostToolUse", tool: "Bash", ok: false, ms: 1 },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n") + "\n",
        "utf8",
      );
      runScript(SUMMARIZER, ["--run-id", mixedId, "--cwd", tmpDir]);
      const mixed = fs.readFileSync(path.join(mixedDir, "summary.md"), "utf8");
      expect(readFrontmatter(mixed)["event_count"]).toBe(5);
      expect(readFrontmatter(mixed)["errors"]).toBe(1);
      expect(readFrontmatter(mixed)["ok_rate"]).toBe(0.5);
      expect(readFrontmatter(mixed)["dispatched_lanes"]).toEqual([{ tmux: 3 }]);
    });

    it("still reports a real ok:false event as an error", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "run-real-err-76");
      fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
      fs.writeFileSync(
        path.join(runDir, "logs", "v1.4-events.jsonl"),
        JSON.stringify({
          ts: "2026-07-22T14:49:40.000Z",
          event: "PostToolUse",
          tool: "Bash",
          specialist: "backend",
          ok: false,
          ms: 12,
          payload_digest: "deadbeef",
        }) + "\n",
        "utf8",
      );
      runScript(SUMMARIZER, ["--run-id", "run-real-err-76", "--cwd", tmpDir]);
      const summary = fs.readFileSync(path.join(runDir, "summary.md"), "utf8");
      expect(readFrontmatter(summary)["errors"]).toBe(1);
      expect(summary).toMatch(/⚠ ERROR/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. The cmux rung — documented (execute-plan SKILL.md §"cmux-first dispatch")
  //    as bypassing agent-team-launcher.ts entirely, with the lead assuming the
  //    launcher's record-keeping obligations. The CLI is that obligation made
  //    executable.
  // ───────────────────────────────────────────────────────────────────────────
  describe("cmux rung via the pane-dispatch-trace CLI", () => {
    const RUN_ID = "run-cmux-76";

    it("records a cmux surface dispatch into the orchestrating run", () => {
      const { exitCode, stdout } = runScript(PANE_TRACE_CLI, [
        "--cwd", tmpDir,
        "--run-id", RUN_ID,
        "--target", "ws-abc123",
        "--backend", "cmux",
        "--lane", "backend:T2-backend:surface-7",
        "--lane", "qa:T3-qa",
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/recorded 2\/2 cmux dispatch receipt\(s\)/);

      const events = readCanonicalLog(tmpDir, RUN_ID).filter(
        (l) => l.schema_version === "guild.trace.dispatch.v1" && l.pane_backend === "cmux",
      );
      expect(events.map((e) => e.specialist).sort()).toEqual(["backend", "qa"]);
      const be = events.find((e) => e.specialist === "backend")!;
      expect(be.task_id).toBe("T2-backend");
      expect(be.attribution_specialist).toBe("backend");
      expect(be.pane_id).toBe("surface-7");
      expect(be.pane_target).toBe("ws-abc123");
      // The CLOSED `backend` enum is untouched, so an OLDER validator reading
      // the same guild.trace.dispatch.v1 token still accepts the line. cmux
      // reports "unknown" (literally true — the enum cannot name it) rather
      // than borrowing "tmux", whose contract is "tmux pane send-keys": a
      // consumer filtering backend==="tmux" for LOCAL panes must not silently
      // collect cmux surfaces.
      expect(be.backend).toBe("unknown");
      // A lane with no pane id still gets a receipt — absence is valid.
      expect(events.find((e) => e.specialist === "qa")!.pane_id).toBeUndefined();
    });

    it("the summarizer counts cmux dispatches as real specialists", () => {
      runScript(PANE_TRACE_CLI, [
        "--cwd", tmpDir,
        "--run-id", RUN_ID,
        "--backend", "cmux",
        "--lane", "backend",
        "--lane", "qa",
      ]);
      runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      const summary = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", RUN_ID, "summary.md"),
        "utf8",
      );
      expect(summary).toMatch(/specialists_dispatched: \[backend, qa\]/);
      expect(readFrontmatter(summary)["dispatched_lanes"]).toEqual([{ cmux: 2 }]);
    });

    it("refuses bad input instead of writing a partial record", () => {
      const missingRun = runScript(PANE_TRACE_CLI, ["--cwd", tmpDir, "--lane", "backend"]);
      expect(missingRun.exitCode).toBe(1);
      expect(missingRun.stderr).toMatch(/--run-id/);

      const badBackend = runScript(PANE_TRACE_CLI, [
        "--cwd", tmpDir, "--run-id", RUN_ID, "--backend", "carrier-pigeon", "--lane", "backend",
      ]);
      expect(badBackend.exitCode).toBe(1);
      expect(badBackend.stderr).toMatch(/--backend must be one of/);

      const noLanes = runScript(PANE_TRACE_CLI, ["--cwd", tmpDir, "--run-id", RUN_ID]);
      expect(noLanes.exitCode).toBe(1);
      expect(noLanes.stderr).toMatch(/--lane/);

      expect(readCanonicalLog(tmpDir, RUN_ID)).toHaveLength(0);
    });

    // A retried / re-invoked dispatch appends a second receipt for the SAME
    // lane. "specialists dispatched" must not inflate because a lane retried.
    it("a re-dispatched lane is counted once, not twice", () => {
      for (let i = 0; i < 2; i++) {
        runScript(PANE_TRACE_CLI, [
          "--cwd", tmpDir, "--run-id", RUN_ID, "--backend", "cmux",
          "--lane", "backend:T2-backend", "--lane", "qa:T3-qa",
        ]);
      }
      // Both attempts really are on the log…
      expect(
        readCanonicalLog(tmpDir, RUN_ID).filter((l) => l.pane_backend === "cmux"),
      ).toHaveLength(4);

      runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      const summary = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", RUN_ID, "summary.md"),
        "utf8",
      );
      // …the LANE count does not inflate…
      expect(readFrontmatter(summary)["dispatched_lanes"]).toEqual([{ cmux: 2 }]);
      // …and the retry volume is still visible rather than hidden by it.
      expect(readFrontmatter(summary)["dispatch_receipts"]).toEqual([{ cmux: 4 }]);
    });

    // The count must come from real write verdicts, not from counting loop
    // iterations: an unwritable log has to read as 0/1, never 1/1.
    it("reports a failed append honestly instead of claiming success", () => {
      const runDir = path.join(tmpDir, ".guild", "runs", "run-unwritable-76");
      fs.mkdirSync(runDir, { recursive: true });
      // `logs` is a FILE, so the emitter's mkdir of <runDir>/logs must fail.
      fs.writeFileSync(path.join(runDir, "logs"), "not a directory", "utf8");

      const { exitCode, stdout } = runScript(PANE_TRACE_CLI, [
        "--cwd", tmpDir, "--run-id", "run-unwritable-76", "--backend", "cmux",
        "--lane", "backend",
      ]);
      expect(stdout).toMatch(/recorded 0\/1 cmux dispatch receipt\(s\)/);
      // A run record that silently lost a receipt is a degradation, not a pass.
      expect(exitCode).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3c. The contract edges the emitter leans on: emitTraceEvent's per-write
  //     verdict (widened void→boolean for #76) and the additive-field validator.
  // ───────────────────────────────────────────────────────────────────────────
  describe("guild.trace.dispatch.v1 contract edges", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const events = require("../../src/modules/telemetry/workflows/guild-trace-events");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const emit = require("../../src/modules/telemetry/workflows/guild-trace-emit");

    const valid = () =>
      events.makeDispatchEvent({
        ts: "2026-07-22T14:49:41.000Z",
        run_id: "run-x",
        lane_id: "T1",
        specialist: "backend",
        phase: "execute",
        task_id: "T1",
        backend: "tmux",
        backend_rung: 1,
        dispatched_at: "2026-07-22T14:49:41.000Z",
      });

    it("emitTraceEvent reports false on skip, false on invalid, true on write", () => {
      // No runDir → nothing written, and the caller must be able to tell.
      expect(emit.emitTraceEvent(valid(), undefined)).toBe(false);

      const runDir = path.join(tmpDir, ".guild", "runs", "run-verdict-76");
      // Invalid event → dropped by the validator, reported as a non-write.
      expect(emit.emitTraceEvent({ ...valid(), specialist: "" }, runDir)).toBe(false);
      // Unwritable log dir → I/O failure, reported as a non-write.
      fs.mkdirSync(runDir, { recursive: true });
      fs.writeFileSync(path.join(runDir, "logs"), "not a directory", "utf8");
      expect(emit.emitTraceEvent(valid(), runDir)).toBe(false);

      // Happy path → true, and the line really is on disk.
      const okDir = path.join(tmpDir, ".guild", "runs", "run-verdict-ok-76");
      expect(emit.emitTraceEvent(valid(), okDir)).toBe(true);
      expect(readCanonicalLog(tmpDir, "run-verdict-ok-76")).toHaveLength(1);
    });

    it("validates the additive pane fields when present, allows their absence", () => {
      // Absence is valid — every pre-#76 event omits all four.
      expect(events.validateDispatchEvent(valid()).ok).toBe(true);
      // `pane_backend` is excluded from the "present is fine" half: it carries
      // an extra cross-field invariant, covered by its own test below.
      for (const field of ["attribution_specialist", "pane_id", "pane_target"]) {
        expect(events.validateDispatchEvent({ ...valid(), [field]: "x" }).ok).toBe(true);
        // Present-but-malformed must be REJECTED, not written as junk.
        expect(events.validateDispatchEvent({ ...valid(), [field]: "" }).ok).toBe(false);
        expect(events.validateDispatchEvent({ ...valid(), [field]: 123 }).ok).toBe(false);
      }
      for (const bad of ["", 123]) {
        expect(events.validateDispatchEvent({ ...valid(), pane_backend: bad }).ok).toBe(false);
      }
    });

    it("keeps the backend enum closed (no cmux value)", () => {
      // Adding a value would break an OLDER validator on the SAME schema token.
      expect(events.validateDispatchEvent({ ...valid(), backend: "cmux" }).ok).toBe(false);
      for (const b of ["agent", "tmux", "remote", "unknown"]) {
        expect(events.validateDispatchEvent({ ...valid(), backend: b }).ok).toBe(true);
      }
    });

    // pane_backend is read as `pane_backend ?? backend`, so the two shapes that
    // would mislead that read must be unrepresentable, not merely unwritten.
    it("rejects a pane_backend that contradicts backend or claims an unconfirmed rung", () => {
      // A concrete backend carrying a contradicting surface.
      expect(
        events.validateDispatchEvent({ ...valid(), backend: "tmux", pane_backend: "cmux" }).ok,
      ).toBe(false);
      expect(
        events.validateDispatchEvent({ ...valid(), backend: "remote", pane_backend: "cmux" }).ok,
      ).toBe(false);
      // A pre-routing INTENT (rung 0) dressed up as a confirmed dispatch.
      expect(
        events.validateDispatchEvent({
          ...valid(),
          backend: "unknown",
          backend_rung: 0,
          pane_backend: "cmux",
        }).ok,
      ).toBe(false);
      // The one legal shape.
      expect(
        events.validateDispatchEvent({
          ...valid(),
          backend: "unknown",
          backend_rung: 1,
          pane_backend: "cmux",
        }).ok,
      ).toBe(true);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3b. The REMOTE rung — a separate code path that returns (and, for an
  //     all-remote team, process.exit(0)s) before the local tmux emit.
  // ───────────────────────────────────────────────────────────────────────────
  describe("remote rung", () => {
    const RUN_ID = "run-remote-76";

    it("records an SSH-dispatched lane in the orchestrating run", () => {
      // team-mixed-host.yaml: architect stays local, security routes to codex.
      const teamPath = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeSettingsCrossHost(tmpDir, {
        "codex-remote": { address: "gpu-box.example.com", user: "ci" },
      });
      const fakeBin = makeFakeRemoteBin(tmpDir);

      const { exitCode, stdout, stderr } = runScript(
        LAUNCHER,
        ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          GUILD_CROSS_HOST_ENABLED: "1",
          GUILD_HOST_ID: "claude",
        },
      );
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/recorded 1 remote dispatch\(es\)/);
      expect(stderr).not.toMatch(/under-reports its specialists/);

      const lines = readCanonicalLog(tmpDir, RUN_ID);
      const remote = lines.filter(
        (l) => l.schema_version === "guild.trace.dispatch.v1" && l.backend === "remote",
      );
      expect(remote).toHaveLength(1);
      expect(remote[0].specialist).toBe("security");
      expect(remote[0].attribution_specialist).toBe("security");
      expect(remote[0].backend_rung).toBe(1);
      // pane_id is the transport's real remote handle (its detached tmux
      // session name on the far host) …
      expect(remote[0].pane_id).toMatch(/^ssh-/);
      // … and pane_target is ABSENT: the launcher's local session/window name
      // does not exist on the remote, and a wrong target beats no target only
      // in the sense of being worse.
      expect(remote[0].pane_target).toBeUndefined();

      // The local lane still lands on the tmux path — remote specialists are
      // filtered out of the local pool, so neither lane is double-emitted.
      const local = paneDispatches(lines);
      expect(local.map((l) => l.specialist)).toEqual(["architect"]);
    });

    it("emits nothing on a remote --dry-run (nothing was dispatched)", () => {
      const teamPath = setupConsumerRepo(tmpDir, "test-slug", "team-mixed-host.yaml");
      writeHostManifest(tmpDir, "claude", "claude");
      writeHostManifest(tmpDir, "codex-remote", "codex");
      writeSettingsCrossHost(tmpDir, { "codex-remote": { address: "gpu-box.example.com" } });

      const { exitCode } = runScript(
        LAUNCHER,
        ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID, "--dry-run"],
        { GUILD_CROSS_HOST_ENABLED: "1", GUILD_HOST_ID: "claude" },
      );
      expect(exitCode).toBe(0);
      expect(
        readCanonicalLog(tmpDir, RUN_ID).filter(
          (l) => l.schema_version === "guild.trace.dispatch.v1" && l.backend === "remote",
        ),
      ).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. End-to-end: launcher → summarizer over the SAME run dir. Proves the two
  //    halves agree on REAL emitted events, not a hand-written fixture.
  // ───────────────────────────────────────────────────────────────────────────
  describe("launcher → summarizer, one run dir", () => {
    it("a real pane launch summarizes with its real specialist count", () => {
      const RUN_ID = "run-e2e-76";
      const teamPath = setupConsumerRepo(tmpDir, "test-slug");
      const fakeBin = makeFakeTmuxBin(tmpDir);

      const launch = runScript(
        LAUNCHER,
        ["--team", teamPath, "--cwd", tmpDir, "--run-id", RUN_ID],
        {
          TMUX: "/tmp/tmux-1000/default,12345,0",
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      );
      expect(launch.exitCode).toBe(0);
      expect(launch.stdout).toMatch(/recorded 3 pane dispatch\(es\)/);
      // The truthful readback must not have reported a shortfall.
      expect(launch.stderr).not.toMatch(/under-reports its specialists/);

      const { exitCode } = runScript(SUMMARIZER, ["--run-id", RUN_ID, "--cwd", tmpDir]);
      expect(exitCode).toBe(0);

      const summary = fs.readFileSync(
        path.join(tmpDir, ".guild", "runs", RUN_ID, "summary.md"),
        "utf8",
      );
      // THE DEFECT, end to end: this line read `[(none)]` on the real 10-lane run.
      expect(summary).toMatch(/specialists_dispatched: \[architect, backend, qa\]/);
      // Exactly 3 — the per-task pre-routing `unknown` intents are not dispatches.
      expect(readFrontmatter(summary)["dispatched_lanes"]).toEqual([{ tmux: 3 }]);
      expect(summary).not.toMatch(/⚠ ERROR/);
    });
  });
});
