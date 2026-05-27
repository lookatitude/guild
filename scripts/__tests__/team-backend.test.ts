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
 *   - InProcessTeamBackend is a graceful stub (ok:false, never throws).
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
  composeTmuxCommands,
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
    new TmuxTeamBackend({ run: makeFakeRun().run }),
    new InProcessTeamBackend(),
    new RemoteTeamBackend(),
  ];

  it("every backend exposes kind/isAvailable/launch", () => {
    for (const b of backends) {
      expect(typeof b.kind).toBe("string");
      expect(typeof b.isAvailable).toBe("function");
      expect(typeof b.launch).toBe("function");
    }
  });

  it("kinds are the three declared backend kinds", () => {
    expect(backends.map((b) => b.kind).sort()).toEqual(["in-process", "remote", "tmux"]);
  });
});

describe("TmuxTeamBackend.plan() — pure composition", () => {
  it("does NOT invoke the runner (pure)", () => {
    const { run, calls } = makeFakeRun();
    const backend = new TmuxTeamBackend({ run });
    backend.plan(req({ mode: "new-session" }));
    expect(calls).toHaveLength(0);
  });

  it("new-session: emits new-session + a split per specialist + select-layout, no select-window", () => {
    const backend = new TmuxTeamBackend({ run: makeFakeRun().run });
    const { commands } = backend.plan(req({ mode: "new-session", targetName: "guild-demo" }));
    const displays = commands.map((c) => c.display);
    expect(displays.some((d) => /^tmux new-session -d -s guild-demo/.test(d))).toBe(true);
    expect(displays.filter((d) => d.startsWith("tmux split-window -t guild-demo"))).toHaveLength(3);
    expect(displays.some((d) => d === "tmux select-layout -t guild-demo tiled")).toBe(true);
    expect(displays.some((d) => d.startsWith("tmux select-window"))).toBe(false);
    expect(displays.some((d) => d.startsWith("tmux new-window"))).toBe(false);
  });

  it("in-session: emits new-window + splits + select-window, no new-session", () => {
    const backend = new TmuxTeamBackend({ run: makeFakeRun().run });
    const { commands } = backend.plan(req({ mode: "in-session", targetName: "guild-demo" }));
    const displays = commands.map((c) => c.display);
    expect(displays.some((d) => d.startsWith("tmux new-window -n guild-demo"))).toBe(true);
    expect(displays.some((d) => d === "tmux select-window -t guild-demo")).toBe(true);
    expect(displays.some((d) => d.startsWith("tmux new-session"))).toBe(false);
  });

  it("every pane command exports the agent-team env gate + run-id", () => {
    const backend = new TmuxTeamBackend({ run: makeFakeRun().run });
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
    expect(new TmuxTeamBackend({ run: makeFakeRun({ available: true }).run }).isAvailable()).toBe(true);
    expect(new TmuxTeamBackend({ run: makeFakeRun({ available: false }).run }).isAvailable()).toBe(false);
  });

  it("sessionExists reflects has-session status", () => {
    expect(new TmuxTeamBackend({ run: makeFakeRun({ hasSession: true }).run }).sessionExists("s")).toBe(true);
    expect(new TmuxTeamBackend({ run: makeFakeRun({ hasSession: false }).run }).sessionExists("s")).toBe(false);
  });

  it("windowExists matches an exact window name from list-windows", () => {
    const backend = new TmuxTeamBackend({ run: makeFakeRun({ windows: ["misc", "guild-demo"] }).run });
    expect(backend.windowExists("guild-demo")).toBe(true);
    expect(backend.windowExists("guild-other")).toBe(false);
  });

  it("currentSessionName returns the trimmed display-message output", () => {
    const backend = new TmuxTeamBackend({ run: makeFakeRun({ sessionName: "main" }).run });
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
    const backend = new TmuxTeamBackend({ run });
    const plan = backend.plan(req({ mode: "new-session" }));
    const outcome = backend.spawn(plan);
    expect(outcome.ok).toBe(true);
    expect(outcome.failedCommand).toBeNull();
    expect(outcome.teammatePaneIds.architect).toBe("%1");
    expect(outcome.teammatePaneIds.qa).toBe("%3");
    // orchestrator pane id intentionally left empty (preserves prior behavior).
    expect(outcome.orchestratorPaneId).toBe("");
    // The last call is the list-panes collection.
    expect(calls[calls.length - 1].args[0]).toBe("list-panes");
  });

  it("failure (new-session): tears down with kill-session and returns ok:false", () => {
    const { run, calls } = makeFakeRun({ failOn: (sub) => sub === "split-window" });
    const backend = new TmuxTeamBackend({ run });
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
    const backend = new TmuxTeamBackend({ run });
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
    const backend = new TmuxTeamBackend({ run });
    const result = backend.launch(req({ dryRun: true }));
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("tmux");
    expect(result.plannedCommands.length).toBeGreaterThan(0);
    // No spawn calls (no new-session/split-window executed) in dry-run.
    expect(calls.some((c) => c.args[0] === "new-session" || c.args[0] === "split-window")).toBe(false);
  });

  it("real run: spawns and reports teammate pane ids", () => {
    const { run } = makeFakeRun({ panes: [["1", "%1", "architect"]] });
    const backend = new TmuxTeamBackend({ run });
    const result = backend.launch(req({ dryRun: false }));
    expect(result.ok).toBe(true);
    expect(result.teammatePaneIds.architect).toBe("%1");
  });
});

describe("InProcessTeamBackend — graceful stub", () => {
  it("isAvailable true, launch returns ok:false with a stub note, never throws", () => {
    const backend = new InProcessTeamBackend();
    expect(backend.kind).toBe("in-process");
    expect(backend.isAvailable()).toBe(true);
    const result = backend.launch(req());
    expect(result.ok).toBe(false);
    expect(result.notes.join(" ")).toMatch(/stub|not yet implemented/i);
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

  it("buildPrompt produces a teammate prompt naming the specialist + its scope", () => {
    const p = buildPrompt("demo", "run-1", { name: "backend", scope: "api", dependsOn: [] });
    expect(p).toContain("`backend`");
    expect(p).toContain("api");
    expect(p).toContain("handoff receipt");
  });

  it("paneCommand exports the env gate and keeps the pane alive", () => {
    const c = paneCommand("hello", "run-1");
    expect(c).toContain("export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    expect(c).toContain("export GUILD_RUN_ID=run-1");
    expect(c).toContain("exec $SHELL");
  });

  it("composeTmuxCommands free function matches the backend plan output", () => {
    const direct = composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: SPECIALISTS,
    });
    const viaBackend = new TmuxTeamBackend({ run: makeFakeRun().run }).plan(req()).commands;
    expect(viaBackend.map((c) => c.display)).toEqual(direct.map((c) => c.display));
  });

  it("probeTmuxAvailable uses the injected runner", () => {
    expect(probeTmuxAvailable(makeFakeRun({ available: true }).run)).toBe(true);
    expect(probeTmuxAvailable(makeFakeRun({ available: false }).run)).toBe(false);
  });
});
