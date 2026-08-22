/**
 * scripts/__tests__/team-backend.test.ts
 *
 * RE-4 — TeamBackend seam.
 *
 * Covers:
 *   - interface conformance: TmuxTeamBackend / InProcessTeamBackend /
 *     RemoteTeamBackend all expose { kind, isAvailable(), launch() }.
 *   - TmuxTeamBackend.plan() is pure (no subprocess) and produces the exact
 *     command set for new-session vs in-session (byte-for-byte with the prior
 *     inline launcher logic — the regression anchor for the extraction).
 *   - TmuxTeamBackend probes (isAvailable / sessionExists / windowExists /
 *     currentSessionName) read the injected runner correctly.
 *   - TmuxTeamBackend.spawn() success → pane ids; failure → teardown + ok:false.
 *   - InProcessTeamBackend (RE-4 / VC-RE-4): launch() yields a declarative
 *     Agent-tool dispatch plan (ok:true, no tmux commands, no panes) — one
 *     descriptor per specialist with the right name/subagent_type/model/env.
 *   - RemoteTeamBackend is a seam (isAvailable false; launch throws).
 *   - pure helpers shellQuote / buildPrompt / paneCommand.
 *
 * The end-to-end launcher regression (exact stdout/stderr/exit/session.json)
 * stays in agent-team-launcher.test.ts; this file tests the extracted seam in
 * isolation with an injected runner so no real tmux is spawned.
 */

import {
  TmuxTeamBackend,
  InProcessTeamBackend,
  RemoteTeamBackend,
  SerialBackend,
  composeTmuxCommands,
  composeInProcessDispatch,
  shellQuote,
  buildPrompt,
  paneCommand,
  probeTmuxAvailable,
  type TeamBackend,
  type RunFn,
  type RunResult,
  type Specialist,
  type TeamLaunchRequest,
} from "../lib/team-backend";
import { resolveClaudePluginActivation } from "../lib/host/tmux-backend";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  computePhysicalNativeClaudePayloadDigest,
} from "../lib/release-package-identity";

const TEST_PLUGIN_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "team-backend-native-plugin-"));
fs.mkdirSync(path.join(TEST_PLUGIN_ROOT, ".claude-plugin"), { recursive: true });
fs.writeFileSync(
  path.join(TEST_PLUGIN_ROOT, ".claude-plugin", "plugin.json"),
  JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
);
fs.writeFileSync(
  path.join(TEST_PLUGIN_ROOT, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
  `${JSON.stringify({
    schema_version: NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
    release_version: "2.7.0-beta.14",
    payload_digest: computePhysicalNativeClaudePayloadDigest(TEST_PLUGIN_ROOT),
  }, null, 2)}\n`,
);

afterAll(() => fs.rmSync(TEST_PLUGIN_ROOT, { recursive: true, force: true }));

function tmuxBackend(run: RunFn = makeFakeRun().run): TmuxTeamBackend {
  return new TmuxTeamBackend({
    run,
    env: { GUILD_PLUGIN_ROOT: TEST_PLUGIN_ROOT } as NodeJS.ProcessEnv,
    pluginOwnerRoot: TEST_PLUGIN_ROOT,
  });
}

const SPECIALISTS: Specialist[] = [
  { name: "architect", scope: "boundaries", dependsOn: [] },
  { name: "backend", scope: "api + data", dependsOn: ["architect"] },
  { name: "qa", scope: "tests", dependsOn: ["backend"] },
];

function req(overrides: Partial<TeamLaunchRequest> = {}): TeamLaunchRequest {
  return {
    slug: "demo",
    runId: "run-test-001",
    cwd: "/tmp/repo",
    specialists: SPECIALISTS,
    targetName: "guild-demo",
    mode: "new-session",
    dryRun: false,
    ...overrides,
  };
}

/** Scriptable tmux runner that records every invocation. */
function makeFakeRun(opts: {
  available?: boolean;
  windows?: string[];
  sessionName?: string;
  hasSession?: boolean;
  panes?: Array<[string, string, string]>;
  failOn?: (sub: string) => boolean;
} = {}): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: RunFn = (cmd, args) => {
    calls.push({ cmd, args });
    const sub = args[0] ?? "";
    const ok: RunResult = { status: 0, stdout: "", stderr: "" };
    if (sub === "-V") return { ...ok, status: opts.available === false ? 1 : 0, stdout: "tmux 3.4" };
    if (sub === "has-session") return { ...ok, status: opts.hasSession ? 0 : 1 };
    if (sub === "list-windows") return { ...ok, stdout: (opts.windows ?? []).join("\n") + "\n" };
    if (sub === "display-message") return { ...ok, stdout: (opts.sessionName ?? "sess") + "\n" };
    if (sub === "list-panes") {
      const lines = (opts.panes ?? []).map(([i, id, t]) => `${i}\t${id}\t${t}`).join("\n");
      return { ...ok, stdout: lines + "\n" };
    }
    if (opts.failOn && opts.failOn(sub)) return { status: 1, stdout: "", stderr: "boom" };
    return ok;
  };
  return { run, calls };
}

describe("TeamBackend seam — interface conformance (RE-4)", () => {
  const backends: TeamBackend[] = [
    tmuxBackend(),
    new InProcessTeamBackend(),
    new RemoteTeamBackend(),
    new SerialBackend(), // TE-08/ARCH-5: Rung 4, the serial floor
  ];

  it("every backend exposes kind/isAvailable/launch", () => {
    for (const b of backends) {
      expect(typeof b.kind).toBe("string");
      expect(typeof b.isAvailable).toBe("function");
      expect(typeof b.launch).toBe("function");
    }
  });

  it("kinds are the four declared backend kinds (TE-08: serial added as Rung 4)", () => {
    expect(backends.map((b) => b.kind).sort()).toEqual(["in-process", "remote", "serial", "tmux"]);
  });
});

describe("TmuxTeamBackend.plan() — pure composition", () => {
  it("does NOT invoke the runner (pure)", () => {
    const { run, calls } = makeFakeRun();
    const backend = tmuxBackend(run);
    backend.plan(req({ mode: "new-session" }));
    expect(calls).toHaveLength(0);
  });

  it("new-session: emits new-session + a split per specialist + select-layout, no select-window", () => {
    const backend = tmuxBackend();
    const { commands } = backend.plan(req({ mode: "new-session", targetName: "guild-demo" }));
    const displays = commands.map((c) => c.display);
    expect(displays.some((d) => /^tmux new-session -d -s guild-demo/.test(d))).toBe(true);
    expect(displays.filter((d) => d.startsWith("tmux split-window -t guild-demo"))).toHaveLength(3);
    expect(displays.some((d) => d === "tmux select-layout -t guild-demo tiled")).toBe(true);
    expect(displays.some((d) => d.startsWith("tmux select-window"))).toBe(false);
    expect(displays.some((d) => d.startsWith("tmux new-window"))).toBe(false);
  });

  it("in-session: emits new-window + splits + select-window, no new-session", () => {
    const backend = tmuxBackend();
    const { commands } = backend.plan(req({ mode: "in-session", targetName: "guild-demo" }));
    const displays = commands.map((c) => c.display);
    expect(displays.some((d) => d.startsWith("tmux new-window -n guild-demo"))).toBe(true);
    expect(displays.some((d) => d === "tmux select-window -t guild-demo")).toBe(true);
    expect(displays.some((d) => d.startsWith("tmux new-session"))).toBe(false);
  });

  it("every pane command exports the agent-team env gate + run-id", () => {
    const backend = tmuxBackend();
    const { commands } = backend.plan(req());
    // The orchestrator + each specialist pane carries the env exports.
    const paneCmds = commands.filter(
      (c) => c.argv.includes("new-session") || c.argv.includes("new-window") || c.argv[1] === "split-window"
    );
    for (const c of paneCmds) {
      const inlineCmd = c.argv[c.argv.length - 1];
      expect(inlineCmd).toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
      expect(inlineCmd).toContain("GUILD_RUN_ID=run-test-001");
    }
  });
});

describe("TmuxTeamBackend — probes via injected runner", () => {
  it("isAvailable reflects `tmux -V` status", () => {
    expect(tmuxBackend(makeFakeRun({ available: true }).run).isAvailable()).toBe(true);
    expect(tmuxBackend(makeFakeRun({ available: false }).run).isAvailable()).toBe(false);
  });

  it("sessionExists reflects has-session status", () => {
    expect(tmuxBackend(makeFakeRun({ hasSession: true }).run).sessionExists("s")).toBe(true);
    expect(tmuxBackend(makeFakeRun({ hasSession: false }).run).sessionExists("s")).toBe(false);
  });

  it("windowExists matches an exact window name from list-windows", () => {
    const backend = tmuxBackend(makeFakeRun({ windows: ["misc", "guild-demo"] }).run);
    expect(backend.windowExists("guild-demo")).toBe(true);
    expect(backend.windowExists("guild-other")).toBe(false);
  });

  it("currentSessionName returns the trimmed display-message output", () => {
    const backend = tmuxBackend(makeFakeRun({ sessionName: "main" }).run);
    expect(backend.currentSessionName()).toBe("main");
  });
});

describe("TmuxTeamBackend.spawn() — execution + teardown", () => {
  it("success: runs every command then collects teammate pane ids", () => {
    const { run, calls } = makeFakeRun({
      panes: [
        ["0", "%0", "orchestrator"],
        ["1", "%1", "architect"],
        ["2", "%2", "backend"],
        ["3", "%3", "qa"],
      ],
    });
    const backend = tmuxBackend(run);
    const plan = backend.plan(req({ mode: "new-session" }));
    const outcome = backend.spawn(plan);
    expect(outcome.ok).toBe(true);
    expect(outcome.failedCommand).toBeNull();
    expect(outcome.teammatePaneIds.architect).toBe("%1");
    expect(outcome.teammatePaneIds.qa).toBe("%3");
    // The orchestrator's own pane is now captured (titled "orchestrator" by the
    // select-pane command composeTmuxCommands emits right after session/window
    // creation) — no longer left empty.
    expect(outcome.orchestratorPaneId).toBe("%0");
    // "orchestrator" is never ALSO reported as a teammate pane.
    expect(outcome.teammatePaneIds["orchestrator"]).toBeUndefined();
    // The last call is the list-panes collection, scoped to this session/window
    // (no `-a`, which would list panes server-wide across other sessions too).
    expect(calls[calls.length - 1].args[0]).toBe("list-panes");
    expect(calls[calls.length - 1].args).not.toContain("-a");
  });

  it("failure (new-session): tears down with kill-session and returns ok:false", () => {
    const { run, calls } = makeFakeRun({ failOn: (sub) => sub === "split-window" });
    const backend = tmuxBackend(run);
    const plan = backend.plan(req({ mode: "new-session", targetName: "guild-demo" }));
    const outcome = backend.spawn(plan);
    expect(outcome.ok).toBe(false);
    expect(outcome.failedCommand?.display).toMatch(/^tmux split-window/);
    expect(outcome.stderr).toBe("boom");
    expect(calls.some((c) => c.args[0] === "kill-session" && c.args.includes("guild-demo"))).toBe(true);
    expect(calls.some((c) => c.args[0] === "kill-window")).toBe(false);
  });

  it("failure (in-session): tears down with kill-window only (never the session)", () => {
    const { run, calls } = makeFakeRun({ failOn: (sub) => sub === "split-window" });
    const backend = tmuxBackend(run);
    const plan = backend.plan(req({ mode: "in-session", targetName: "guild-demo" }));
    const outcome = backend.spawn(plan);
    expect(outcome.ok).toBe(false);
    expect(calls.some((c) => c.args[0] === "kill-window" && c.args.includes("guild-demo"))).toBe(true);
    expect(calls.some((c) => c.args[0] === "kill-session")).toBe(false);
  });
});

describe("TmuxTeamBackend.launch() — seam-conformant entry", () => {
  it("dry-run: returns ok + planned commands without invoking the runner for spawn", () => {
    const { run, calls } = makeFakeRun();
    const backend = tmuxBackend(run);
    const result = backend.launch(req({ dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("tmux");
    expect(result.plannedCommands.length).toBeGreaterThan(0);
    // No spawn calls (no new-session/split-window executed) in dry-run.
    expect(calls.some((c) => c.args[0] === "new-session" || c.args[0] === "split-window")).toBe(false);
  });

  it("real run: spawns and reports teammate pane ids", () => {
    const { run } = makeFakeRun({ panes: [["1", "%1", "architect"]] });
    const backend = tmuxBackend(run);
    const result = backend.launch(req({ dryRun: false }));
    expect(result.ok).toBe(true);
    expect(result.teammatePaneIds.architect).toBe("%1");
  });
});

describe("InProcessTeamBackend — Agent-tool dispatch plan (RE-4 / VC-RE-4)", () => {
  it("isAvailable is unconditionally true (no tmux / transport gate)", () => {
    const backend = new InProcessTeamBackend();
    expect(backend.kind).toBe("in-process");
    expect(backend.isAvailable()).toBe(true);
  });

  it("launch() returns ok:true with a declarative dispatch plan, never throws", () => {
    const backend = new InProcessTeamBackend();
    let result;
    expect(() => {
      result = backend.launch(req());
    }).not.toThrow();
    expect(result!.ok).toBe(true);
    expect(result!.kind).toBe("in-process");
    expect(Array.isArray(result!.dispatchPlan)).toBe(true);
    // No stub language remains — this is a shipping backend now.
    expect(result!.notes.join(" ")).not.toMatch(/stub|not yet implemented/i);
  });

  it("plans one descriptor per specialist with the right name/subagent_type/model/env", () => {
    const result = new InProcessTeamBackend().launch(req());
    const plan = result.dispatchPlan!;
    expect(plan).toHaveLength(SPECIALISTS.length);
    // One descriptor per specialist, in order; subagent_type = bare owner_role
    // (= name), never general-purpose; model null (execute-plan auto-scores);
    // env carries the run-id for hook convergence.
    expect(plan.map((d) => d.name)).toEqual(["architect", "backend", "qa"]);
    expect(plan.map((d) => d.subagentType)).toEqual(["architect", "backend", "qa"]);
    expect(plan.every((d) => d.subagentType !== "general-purpose")).toBe(true);
    expect(plan.every((d) => d.model === null)).toBe(true);
    expect(plan.every((d) => d.env.GUILD_RUN_ID === "run-test-001")).toBe(true);
    // Each descriptor carries the specialist staging prompt (NOT the orchestrator one).
    const backendDesc = plan.find((d) => d.name === "backend")!;
    expect(backendDesc.prompt).toContain("`backend`");
    expect(backendDesc.prompt).toContain("api + data");
  });

  it("uses file-bus prompt wording for non-Claude in-process descriptors", () => {
    const plan = composeInProcessDispatch(req({ orchestratorHostKind: "codex" }));
    expect(plan).toHaveLength(SPECIALISTS.length);
    expect(plan.every((d) => d.prompt.includes("agent-bus"))).toBe(true);
    expect(plan.some((d) => d.prompt.includes("TaskCreated"))).toBe(false);
  });

  it("the in-process env does NOT carry the tmux team gate (it is the no-tmux path)", () => {
    const result = new InProcessTeamBackend().launch(req());
    for (const d of result.dispatchPlan!) {
      expect(d.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS).toBeUndefined();
    }
  });

  // D-CAP (Wave-3): GUILD_CAPABILITY_SCOPE injection into in-process descriptor env
  it("D-CAP: composeInProcessDispatch injects GUILD_CAPABILITY_SCOPE when specialist has capability_scope", () => {
    const scopedSpecialists = SPECIALISTS.map((s, i) =>
      i === 0 ? { ...s, capability_scope: ["Read", "Glob"] } : s
    );
    const plan = composeInProcessDispatch(req({ specialists: scopedSpecialists }));
    const scopedDesc = plan.find((d) => d.name === "architect")!;
    expect(scopedDesc.env.GUILD_CAPABILITY_SCOPE).toBe(JSON.stringify(["Read", "Glob"]));
    expect(plan.find((d) => d.name === "backend")!.env.GUILD_CAPABILITY_SCOPE).toBe(
      JSON.stringify(["Read", "Write", "Edit", "Bash", "Glob", "Grep"])
    );
    expect(plan.find((d) => d.name === "qa")!.env.GUILD_CAPABILITY_SCOPE).toBe(
      JSON.stringify(["Read", "Write", "Edit", "Bash", "Glob", "Grep"])
    );
  });

  it("D-CAP: materializes canonical role defaults when capability_scope is absent", () => {
    const plan = composeInProcessDispatch(req());
    expect(JSON.parse(plan.find((d) => d.name === "architect")!.env.GUILD_CAPABILITY_SCOPE!)).toEqual([
      "Read", "Write", "Edit", "Glob", "Grep",
    ]);
    expect(JSON.parse(plan.find((d) => d.name === "backend")!.env.GUILD_CAPABILITY_SCOPE!)).toEqual([
      "Read", "Write", "Edit", "Bash", "Glob", "Grep",
    ]);
  });

  it("D-CAP: keeps researcher as the sole canonical native-web default and honors an explicit scoped exception", () => {
    const plan = composeInProcessDispatch(req({
      specialists: [
        { name: "researcher", scope: "sources", dependsOn: [] },
        { name: "seo", scope: "provided exports", dependsOn: [] },
        { name: "seo", dispatch_key: "seo-approved", scope: "fresh metrics", dependsOn: [], capability_scope: ["Read", "WebSearch"] },
      ],
    }));
    expect(JSON.parse(plan.find((d) => d.name === "researcher")!.env.GUILD_CAPABILITY_SCOPE!)).toContain("WebSearch");
    expect(JSON.parse(plan.find((d) => d.name === "seo")!.env.GUILD_CAPABILITY_SCOPE!)).toEqual([
      "Read", "Write", "Edit", "Glob", "Grep",
    ]);
    expect(JSON.parse(plan.find((d) => d.name === "seo-approved")!.env.GUILD_CAPABILITY_SCOPE!)).toEqual([
      "Read", "WebSearch",
    ]);
  });

  // D-CAP GUILD_TASK_ID in composeInProcessDispatch (lane identity carrier)
  it("D-CAP: composeInProcessDispatch injects GUILD_TASK_ID for every specialist", () => {
    const specialists = SPECIALISTS.map((s, i) => ({ ...s, taskId: `T${i + 1}-${s.name}` }));
    const plan = composeInProcessDispatch(req({ specialists }));
    for (const spec of specialists) {
      const d = plan.find((p) => p.name === spec.name)!;
      expect(d.env.GUILD_TASK_ID).toBe(spec.taskId);
    }
  });

  it("D-CAP: composeInProcessDispatch falls back to spec.name for GUILD_TASK_ID when taskId absent", () => {
    // When no plan exists, W2-A2 sets taskId = spec.name; this test verifies
    // the fallback (spec.taskId undefined → env gets spec.name).
    const plan = composeInProcessDispatch(req()); // SPECIALISTS have no taskId
    for (const spec of SPECIALISTS) {
      const d = plan.find((p) => p.name === spec.name)!;
      expect(d.env.GUILD_TASK_ID).toBe(spec.name);
    }
  });

  // G-9 / C2-D1 (heartbeat real-path wiring): the PostToolUse heartbeat writer
  // (hooks/lib/heartbeat-write.ts) fires only when GUILD_RUN_ID ∧
  // GUILD_SPECIALIST are both in the dispatched lane's env. These tests assert
  // on the ACTUAL env construction the dispatcher uses — not an injected seam.
  it("heartbeat: composeInProcessDispatch exports GUILD_SPECIALIST=<spec.name> on every descriptor", () => {
    const plan = composeInProcessDispatch(req());
    for (const spec of SPECIALISTS) {
      const d = plan.find((p) => p.name === spec.name)!;
      expect(d.env.GUILD_SPECIALIST).toBe(spec.name);
      // The writer's trigger contract needs BOTH vars — assert the pair.
      expect(d.env.GUILD_RUN_ID).toBe("run-test-001");
    }
  });

  it("emits zero tmux commands / panes: orchestratorPaneId null, teammatePaneIds empty", () => {
    // The backend takes no RunFn — there is no subprocess seam to invoke, so it
    // structurally cannot shell out to tmux. plannedCommands describe Agent()
    // calls, never `tmux …`.
    const result = new InProcessTeamBackend().launch(req());
    expect(result.orchestratorPaneId).toBeNull();
    expect(result.teammatePaneIds).toEqual({});
    expect(result.plannedCommands.every((c) => !c.startsWith("tmux"))).toBe(true);
    expect(result.plannedCommands.every((c) => c.includes("Agent({"))).toBe(true);
    expect(result.plannedCommands.some((c) => c.includes("subagent_type: backend"))).toBe(true);
  });

  it("dry-run is a side-effect-free no-op: same plan, annotated note", () => {
    const wet = new InProcessTeamBackend().launch(req({ dryRun: false }));
    const dry = new InProcessTeamBackend().launch(req({ dryRun: true }));
    expect(dry.ok).toBe(true);
    expect(dry.dispatchPlan).toEqual(wet.dispatchPlan);
    expect(dry.notes.join(" ")).toMatch(/dry-run/i);
  });

  it("VC-RE-4: the SAME dispatch runs in-process (no tmux) as on tmux — same specialist set", () => {
    // The tmux backend would spawn a pane per specialist; the in-process backend
    // plans an Agent() dispatch per specialist. Same team in → same lane owners
    // out, just a different execution substrate (D5 selects which).
    const inProcess = new InProcessTeamBackend().launch(req());
    const tmuxPlan = tmuxBackend().plan(req());
    // Exclude the orchestrator's own self-titling select-pane command (emitted
    // once, right after session/window creation, so spawn() can later identify
    // the orchestrator pane by title) — it isn't a specialist dispatch target.
    const tmuxSpecialistTargets = tmuxPlan.commands
      .filter((c) => c.argv[1] === "select-pane" && c.argv[2] === "-T" && c.argv[3] !== "orchestrator")
      .map((c) => c.argv[3]);
    expect(inProcess.dispatchPlan!.map((d) => d.name)).toEqual(tmuxSpecialistTargets);
    // ...and the in-process path uses no tmux at all.
    expect(inProcess.teammatePaneIds).toEqual({});
  });

  it("composeInProcessDispatch is pure and matches the backend's plan", () => {
    const direct = composeInProcessDispatch(req());
    const viaBackend = new InProcessTeamBackend().launch(req()).dispatchPlan!;
    expect(viaBackend).toEqual(direct);
  });
});

describe("RemoteTeamBackend — no-transport guard", () => {
  // Full transport-driven lifecycle lives in remote-backend.test.ts; here we
  // only pin the inert posture when NO transport is wired.
  it("isAvailable is false without a transport (never auto-selected)", () => {
    expect(new RemoteTeamBackend().isAvailable()).toBe(false);
  });

  it("launch throws (no wire) pointing at the RE-4 contract", () => {
    expect(() => new RemoteTeamBackend().launch(req())).toThrow(/transport|RE-4/i);
  });
});

describe("SerialBackend — serial floor (TE-08 / Rung 4)", () => {
  // Per spec §6: isAvailable() is unconditionally true (the whole point of
  // Rung 4 — there is ALWAYS a satisfiable substrate). dispatch plan is
  // byte-identical to InProcessTeamBackend (same composeInProcessDispatch call).
  // parallelism=1, substrateDegradation are ADDITIVE — not a behavior change.

  it("kind is 'serial'", () => {
    expect(new SerialBackend().kind).toBe("serial");
  });

  it("isAvailable() is unconditionally true — never false, even on a bare host", () => {
    // Rung 4 is the floor: the dispatcher guarantees ≥1 satisfiable substrate.
    expect(new SerialBackend().isAvailable()).toBe(true);
    // Calling it twice must remain stable (no side effects)
    expect(new SerialBackend().isAvailable()).toBe(true);
  });

  it("launch() returns ok:true and never throws", () => {
    let result: ReturnType<SerialBackend["launch"]> | undefined;
    expect(() => {
      result = new SerialBackend().launch(req());
    }).not.toThrow();
    expect(result!.ok).toBe(true);
    expect(result!.kind).toBe("serial");
  });

  it("dispatch plan is byte-identical to InProcessTeamBackend — regression anchor (TE-08 extraction invariant)", () => {
    // The spec requires: SerialBackend's dispatchPlan === InProcessTeamBackend's
    // dispatchPlan, byte-for-byte, for the same request. Extracting Rung 4 from
    // InProcess's implicit fallback must NOT change the dispatch outcome.
    const inProcess = new InProcessTeamBackend().launch(req()).dispatchPlan!;
    const serial = new SerialBackend().launch(req()).dispatchPlan!;
    expect(serial).toEqual(inProcess);
  });

  it("plannedCommands match InProcessTeamBackend for the same request", () => {
    const inProcessCmds = new InProcessTeamBackend().launch(req()).plannedCommands;
    const serialCmds = new SerialBackend().launch(req()).plannedCommands;
    expect(serialCmds).toEqual(inProcessCmds);
  });

  it("parallelism is 1 — execute-plan must serialize (Rung 4 cap)", () => {
    const result = new SerialBackend().launch(req());
    expect(result.parallelism).toBe(1);
  });

  it("substrateDegradation marker is present with substrate='serial'", () => {
    const result = new SerialBackend().launch(req());
    expect(result.substrateDegradation).toBeDefined();
    expect(result.substrateDegradation!.substrate).toBe("serial");
    expect(typeof result.substrateDegradation!.degraded_from).toBe("string");
    expect(typeof result.substrateDegradation!.reason).toBe("string");
    expect(result.substrateDegradation!.reason.length).toBeGreaterThan(0);
  });

  it("substrateDegradation accepts caller-provided degraded_from + reason override", () => {
    const result = new SerialBackend().launch(req(), {
      degraded_from: "tmux",
      reason: "tmux session spawn failed: ENOENT",
    });
    expect(result.substrateDegradation!.degraded_from).toBe("tmux");
    expect(result.substrateDegradation!.reason).toBe("tmux session spawn failed: ENOENT");
  });

  it("no tmux commands in plannedCommands (not a tmux backend)", () => {
    const result = new SerialBackend().launch(req());
    expect(result.plannedCommands.every((c) => !c.startsWith("tmux"))).toBe(true);
  });

  it("orchestratorPaneId is null and teammatePaneIds is empty (no pane management)", () => {
    const result = new SerialBackend().launch(req());
    expect(result.orchestratorPaneId).toBeNull();
    expect(result.teammatePaneIds).toEqual({});
  });

  it("notes array contains at least one entry describing dispatch_rung=4", () => {
    const result = new SerialBackend().launch(req());
    expect(result.notes.length).toBeGreaterThan(0);
    const combined = result.notes.join(" ");
    expect(combined).toMatch(/dispatch_rung=4|Rung 4/i);
  });

  it("dryRun=true vs dryRun=false: both succeed, dry-run note is different", () => {
    const wet = new SerialBackend().launch(req({ dryRun: false }));
    const dry = new SerialBackend().launch(req({ dryRun: true }));
    expect(wet.ok).toBe(true);
    expect(dry.ok).toBe(true);
    // dry-run note should contain 'dry-run'
    expect(dry.notes.join(" ").toLowerCase()).toContain("dry-run");
  });

  it("composeInProcessDispatch free function === serial backend dispatch plan (referential pure check)", () => {
    const direct = composeInProcessDispatch(req());
    const viaSerial = new SerialBackend().launch(req()).dispatchPlan!;
    expect(viaSerial).toEqual(direct);
  });
});

describe("pure helpers", () => {
  it("shellQuote leaves safe tokens, quotes whitespace/specials, escapes single quotes", () => {
    expect(shellQuote("safe-token_1")).toBe("safe-token_1");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it("buildPrompt produces an orchestrator prompt when specialist is null", () => {
    const p = buildPrompt("demo", "run-1", null);
    expect(p).toMatch(/orchestrator/i);
    expect(p).toContain(".guild/spec/demo.md");
  });

  it("C13: buildPrompt interpolates the RESOLVED teamPath into the orchestrator prompt", () => {
    const resolved = ".guild/team/demo.build.yaml";
    const p = buildPrompt("demo", "run-1", null, resolved);
    // The persisted reference must carry the resolved per-phase path…
    expect(p).toContain(resolved);
    // …and NOT the reconstructed legacy path.
    expect(p).not.toContain(".guild/team/demo.yaml");
  });

  it("C13: buildPrompt falls back to legacy <slug>.yaml when no teamPath is threaded", () => {
    const p = buildPrompt("demo", "run-1", null); // teamPath omitted (back-compat)
    expect(p).toContain(".guild/team/demo.yaml");
  });

  it("C13: teamPath does not affect the teammate prompt (orchestrator-only reference)", () => {
    const withPath = buildPrompt("demo", "run-1", { name: "backend", scope: "api", dependsOn: [] }, ".guild/team/demo.qa.yaml");
    const without = buildPrompt("demo", "run-1", { name: "backend", scope: "api", dependsOn: [] });
    expect(withPath).toBe(without); // teammate prompt never names the team file
  });

  it("buildPrompt produces a teammate prompt naming the specialist + its scope", () => {
    const p = buildPrompt("demo", "run-1", { name: "backend", scope: "api", dependsOn: [] });
    expect(p).toContain("`backend`");
    expect(p).toContain("api");
    expect(p).toContain("handoff receipt");
  });

  it("paneCommand exports the env gate and (G4) does NOT keep the pane alive by default", () => {
    const c = paneCommand("hello", "run-1");
    expect(c).toContain("export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    expect(c).toContain("export GUILD_RUN_ID=run-1");
    // task-cell-runtime G4 (ADR D5): a completed worker's pane must DISAPPEAR — no
    // lingering `exec $SHELL` (the operator debug shell is opt-in, GUILD_PANE_DEBUG=1).
    expect(c).not.toContain("exec $SHELL");
  });

  // D-CAP (Wave-3): GUILD_CAPABILITY_SCOPE injection into tmux pane commands
  it("D-CAP: paneCommand injects GUILD_CAPABILITY_SCOPE when capability_scope present", () => {
    const c = paneCommand("hello", "run-1", ["Read", "Write", "Edit"]);
    expect(c).toContain("GUILD_CAPABILITY_SCOPE");
    expect(c).toContain(JSON.stringify(["Read", "Write", "Edit"]));
    // Must come BEFORE the `claude` invocation so the shell sees it at launch
    const scopeIdx = c.indexOf("GUILD_CAPABILITY_SCOPE");
    const claudeIdx = c.indexOf("claude ");
    expect(scopeIdx).toBeLessThan(claudeIdx);
  });

  it("D-CAP: paneCommand omits GUILD_CAPABILITY_SCOPE when capability_scope is absent", () => {
    const c = paneCommand("hello", "run-1");
    expect(c).not.toContain("GUILD_CAPABILITY_SCOPE");
  });

  // D-CAP GUILD_TASK_ID injection (lane identity carrier)
  it("D-CAP: paneCommand injects GUILD_TASK_ID when taskId present", () => {
    const c = paneCommand("hello", "run-1", undefined, "T2-backend");
    expect(c).toContain("GUILD_TASK_ID=");
    expect(c).toContain("T2-backend");
    // Must come BEFORE the `claude` invocation
    const taskIdx = c.indexOf("GUILD_TASK_ID");
    const claudeIdx = c.indexOf("claude ");
    expect(taskIdx).toBeLessThan(claudeIdx);
  });

  it("D-CAP: paneCommand omits GUILD_TASK_ID when taskId is absent", () => {
    const c = paneCommand("hello", "run-1", ["Read"]);
    expect(c).not.toContain("GUILD_TASK_ID");
  });

  it("D-CAP: paneCommand injects both GUILD_TASK_ID and GUILD_CAPABILITY_SCOPE when both present", () => {
    const c = paneCommand("hello", "run-1", ["Read", "Write"], "T1-architect");
    expect(c).toContain("GUILD_TASK_ID=");
    expect(c).toContain("GUILD_CAPABILITY_SCOPE=");
    // GUILD_TASK_ID must come before GUILD_CAPABILITY_SCOPE (and both before claude)
    const taskIdx = c.indexOf("GUILD_TASK_ID");
    const scopeIdx = c.indexOf("GUILD_CAPABILITY_SCOPE");
    const claudeIdx = c.indexOf("claude ");
    expect(taskIdx).toBeLessThan(claudeIdx);
    expect(scopeIdx).toBeLessThan(claudeIdx);
  });

  // G-9 / C2-D1 (heartbeat real-path wiring): specialist panes must export
  // GUILD_SPECIALIST so the PostToolUse heartbeat writer fires.
  it("heartbeat: paneCommand exports GUILD_SPECIALIST when specialist present (before claude)", () => {
    const c = paneCommand("hello", "run-1", undefined, "T2-backend", "backend");
    expect(c).toContain("export GUILD_SPECIALIST=backend");
    const specIdx = c.indexOf("GUILD_SPECIALIST");
    const claudeIdx = c.indexOf("claude ");
    expect(specIdx).toBeLessThan(claudeIdx);
  });

  it("heartbeat: paneCommand omits GUILD_SPECIALIST when specialist is absent (orchestrator pane)", () => {
    const c = paneCommand("hello", "run-1", ["Read"], "T1");
    expect(c).not.toContain("GUILD_SPECIALIST");
  });

  it("composeTmuxCommands free function matches the backend plan output", () => {
    const activation = resolveClaudePluginActivation(
      { GUILD_PLUGIN_ROOT: TEST_PLUGIN_ROOT } as NodeJS.ProcessEnv,
      TEST_PLUGIN_ROOT,
    );
    const direct = composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: SPECIALISTS,
      claudePluginActivationArgs: activation.args,
      claudePluginRoot: activation.pluginRoot,
    });
    const viaBackend = tmuxBackend().plan(req()).commands;
    expect(viaBackend.map((c) => c.display)).toEqual(direct.map((c) => c.display));
  });

  // G-9 / C2-D1 real-path assertion: the ACTUAL tmux plan the backend composes
  // carries GUILD_SPECIALIST in every specialist pane command and NOT in the
  // orchestrator pane command.
  it("heartbeat: the composed tmux plan exports GUILD_SPECIALIST per specialist pane only", () => {
    const cmds = composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: SPECIALISTS,
    });
    const displays = cmds.map((c) => c.display);
    for (const spec of SPECIALISTS) {
      expect(
        displays.some((d) => d.includes(`export GUILD_SPECIALIST=${spec.name}`)),
      ).toBe(true);
    }
    // The orchestrator pane (the new-session command carrying the lead prompt)
    // must NOT export GUILD_SPECIALIST.
    const orchestrator = displays.find((d) => d.includes("new-session"));
    expect(orchestrator).toBeDefined();
    expect(orchestrator!).not.toContain("GUILD_SPECIALIST");
  });

  it("probeTmuxAvailable uses the injected runner", () => {
    expect(probeTmuxAvailable(makeFakeRun({ available: true }).run)).toBe(true);
    expect(probeTmuxAvailable(makeFakeRun({ available: false }).run)).toBe(false);
  });
});
