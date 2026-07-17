/**
 * scripts/__tests__/pane-adapter.test.ts
 *
 * CH-2 / CH-6 — PaneAdapter implementations + fail-fast preflight.
 *
 * Covers:
 *   - resolveAdapter selection by host_kind; unknown brand throws.
 *   - ClaudePaneAdapter.command is byte-identical to the legacy paneCommand
 *     (the launcher regression anchor) + carries the team env gate.
 *   - CodexPaneAdapter.command uses `codex exec`, exports GUILD_RUN_ID, and does
 *     NOT inject the Claude team env gate.
 *   - preflight: claude --version; codex --version AND usable auth:
 *       (a) auth.json present (codex login) + no OPENAI_API_KEY → pass
 *       (b) OPENAI_API_KEY present + no auth.json → pass
 *       (c) neither present → refuse with message naming both paths
 *       (d) codex --version failing → refuse regardless of auth
 *   - preflightTeam fail-fast: orchestrator uses the starting host; specialist
 *     host picked from host_kind or inherited from the orchestrator; failures collected.
 *   - TmuxTeamBackend.preflight() no-ops without a resolver (regression) and
 *     reports failures with one.
 *   - composeTmuxCommands with an all-claude resolver === the no-resolver path
 *     (byte-for-byte), and emits a `codex exec` pane for a codex specialist.
 */

import {
  buildAdapters,
  resolveAdapter,
  preflightTeam,
  ClaudePaneAdapter,
  CodexPaneAdapter,
  type FsSeam,
} from "../lib/pane-adapter";
import {
  composeTmuxCommands,
  paneCommand,
  buildPrompt,
  TmuxTeamBackend,
  type PaneSpec,
  type RunFn,
  type RunResult,
  type Specialist,
} from "../lib/team-backend";

const OK: RunResult = { status: 0, stdout: "ok", stderr: "" };
const FAIL: RunResult = { status: 127, stdout: "", stderr: "not found" };

/** FsSeam that reports auth.json as present and non-empty. */
const AUTH_JSON_PRESENT: FsSeam = {
  existsSync: () => true,
  statSync: () => ({ size: 42 }),
};

/** FsSeam that reports auth.json as absent. */
const AUTH_JSON_ABSENT: FsSeam = {
  existsSync: () => false,
  statSync: () => { throw new Error("ENOENT"); },
};

/** A runner that returns a per-binary status. */
function runner(map: Record<string, RunResult>): RunFn {
  return (cmd) => map[cmd] ?? FAIL;
}

function spec(overrides: Partial<PaneSpec> = {}): PaneSpec {
  return {
    name: "backend",
    scope: "api + data",
    runId: "run-001",
    slug: "demo",
    prompt: buildPrompt("demo", "run-001", { name: "backend", scope: "api", dependsOn: [] }),
    hostKind: "claude",
    ...overrides,
  };
}

describe("guild.task_assignment.v1 — GUILD_TASK_ASSIGNMENT export (cross-host channel)", () => {
  const s = spec({ specialist: "backend", runId: "run-xyz" });
  const rel = ".guild/runs/run-xyz/tasks/backend.json";

  it("Claude adapter (via paneCommand) exports the assignment path", () => {
    const c = new ClaudePaneAdapter().command(s);
    expect(c).toContain("GUILD_TASK_ASSIGNMENT=");
    expect(c).toContain(rel);
  });

  it("Codex adapter exports it in command AND env", () => {
    const c = new CodexPaneAdapter().command(s);
    expect(c).toContain("GUILD_TASK_ASSIGNMENT=");
    expect(c).toContain(rel);
    expect(new CodexPaneAdapter().env(s).GUILD_TASK_ASSIGNMENT).toBe(rel);
  });

  it("omits the GUILD_TASK_ASSIGNMENT export when no specialist is set", () => {
    const c = new CodexPaneAdapter().command(spec({ runId: "r" }));
    // Assert the absence of the EXPORT FRAGMENT specifically. task-cell-runtime G3
    // added a read-ack instruction to the teammate PROMPT that names the
    // `$GUILD_TASK_ASSIGNMENT` env var, so the bare token now legitimately appears
    // in every teammate command; the export fragment (`GUILD_TASK_ASSIGNMENT=…`) is
    // still correctly gated on `spec.specialist`, which is what this test guards.
    expect(c).not.toContain("GUILD_TASK_ASSIGNMENT=");
    expect(new CodexPaneAdapter().env(spec({ runId: "r" })).GUILD_TASK_ASSIGNMENT).toBeUndefined();
  });
});

describe("resolveAdapter — selection by host_kind", () => {
  it("returns the Claude adapter for claude and the Codex adapter for codex", () => {
    const r = resolveAdapter();
    expect(r("claude")).toBeInstanceOf(ClaudePaneAdapter);
    expect(r("codex")).toBeInstanceOf(CodexPaneAdapter);
  });

  it("buildAdapters exposes both brands keyed by host_kind", () => {
    const a = buildAdapters();
    expect(a.claude.hostKind).toBe("claude");
    expect(a.codex.hostKind).toBe("codex");
    expect(a.claude.adapterVersion).toBe("1");
  });

  it("throws on an unregistered host_kind (programming error, not a fallback)", () => {
    const r = resolveAdapter();
    // gemini was discarded 2026-06-14 (sunset → Antigravity); unregistered now.
    expect(() => r("gemini" as never)).toThrow(/No PaneAdapter registered/);
  });
});

describe("ClaudePaneAdapter", () => {
  const adapter = new ClaudePaneAdapter();

  it("command is byte-identical to the legacy paneCommand", () => {
    const s = spec();
    expect(adapter.command(s)).toBe(paneCommand(s.prompt, s.runId));
  });

  it("command carries the agent-team env gate + run id, and (G4) does NOT keep the pane alive by default", () => {
    const c = adapter.command(spec());
    expect(c).toContain("export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    expect(c).toContain("export GUILD_RUN_ID=run-001");
    // task-cell-runtime G4 (ADR D5): a completed worker's pane must DISAPPEAR — no
    // lingering `exec $SHELL` (the P0.4 "pane alive != worker alive" bug). The
    // operator debug shell is opt-in only (GUILD_PANE_DEBUG=1), verified in
    // tmux-backend.test.ts.
    expect(c).not.toContain("exec $SHELL");
    // The command ends on the worker invocation (pane closes when `claude` exits).
    expect(/\bclaude\b/.test(c)).toBe(true);
  });

  it("env reports the team gate + run id", () => {
    expect(adapter.env(spec())).toEqual({
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: "run-001",
    });
  });

  it("preflight passes when claude --version exits 0, fails otherwise", () => {
    expect(new ClaudePaneAdapter({ run: runner({ claude: OK }) }).preflight().ok).toBe(true);
    const bad = new ClaudePaneAdapter({ run: runner({ claude: FAIL }) }).preflight();
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/claude/);
  });

  // D-CAP (Wave-3 security): GUILD_TASK_ID locates the scope file written by the launcher.
  // The hook (pre-tool-use.ts:487-494) reads <runDir>/scope/<taskId>.json when
  // GUILD_CAPABILITY_SCOPE is absent from env — it needs GUILD_TASK_ID to find the file.
  it("D-CAP: command exports GUILD_TASK_ID when taskId is present", () => {
    const c = adapter.command(spec({ taskId: "task-arch-001" }));
    expect(c).toContain("export GUILD_TASK_ID=task-arch-001");
    // GUILD_TASK_ID must appear BEFORE `claude` so it is set on entry
    expect(c.indexOf("GUILD_TASK_ID")).toBeLessThan(c.indexOf("claude "));
  });

  it("D-CAP: command does not export GUILD_TASK_ID when taskId is absent", () => {
    const c = adapter.command(spec()); // no taskId in spec()
    expect(c).not.toContain("GUILD_TASK_ID");
  });

  it("D-CAP: env includes GUILD_TASK_ID when taskId is present (scope-file locatable)", () => {
    const e = adapter.env(spec({ taskId: "task-arch-001" }));
    expect(e["GUILD_TASK_ID"]).toBe("task-arch-001");
  });

  it("D-CAP: env does not include GUILD_TASK_ID when taskId is absent (regression anchor)", () => {
    const e = adapter.env(spec()); // no taskId → no key
    expect(e).not.toHaveProperty("GUILD_TASK_ID");
  });

  // G-9 / C2-D1 (heartbeat real-path wiring): lane panes export GUILD_SPECIALIST
  // so the PostToolUse heartbeat writer (GUILD_RUN_ID ∧ GUILD_SPECIALIST) fires.
  it("heartbeat: command exports GUILD_SPECIALIST when specialist is present", () => {
    const c = adapter.command(spec({ specialist: "backend" }));
    expect(c).toContain("export GUILD_SPECIALIST=backend");
    expect(c.indexOf("GUILD_SPECIALIST")).toBeLessThan(c.indexOf("claude "));
  });

  it("heartbeat: command omits GUILD_SPECIALIST when specialist is absent (orchestrator)", () => {
    const c = adapter.command(spec()); // no specialist in spec()
    expect(c).not.toContain("GUILD_SPECIALIST");
  });

  it("heartbeat: env includes GUILD_SPECIALIST when specialist is present", () => {
    const e = adapter.env(spec({ specialist: "backend" }));
    expect(e["GUILD_SPECIALIST"]).toBe("backend");
  });
});

describe("CodexPaneAdapter", () => {
  it("command uses `codex exec`, exports GUILD_RUN_ID, NO claude team gate", () => {
    const adapter = new CodexPaneAdapter({ env: { OPENAI_API_KEY: "sk-x" } });
    const c = adapter.command(spec({ hostKind: "codex" }));
    expect(c).toContain("codex exec");
    expect(c).toContain("export GUILD_RUN_ID=run-001");
    expect(c).toContain("exec $SHELL");
    expect(c).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
  });

  it("env reports only the run id (no team gate)", () => {
    const adapter = new CodexPaneAdapter({ env: {} });
    expect(adapter.env(spec({ hostKind: "codex" }))).toEqual({ GUILD_RUN_ID: "run-001" });
  });

  // G-9 / C2-D1: env parity — Codex lane panes also export GUILD_SPECIALIST.
  it("heartbeat: command + env export GUILD_SPECIALIST when specialist is present", () => {
    const adapter = new CodexPaneAdapter({ env: { OPENAI_API_KEY: "sk-x" } });
    const s = spec({ hostKind: "codex", specialist: "backend" });
    const c = adapter.command(s);
    expect(c).toContain("export GUILD_SPECIALIST=backend");
    expect(c.indexOf("GUILD_SPECIALIST")).toBeLessThan(c.indexOf("codex exec"));
    expect(adapter.env(s)["GUILD_SPECIALIST"]).toBe("backend");
  });

  it("preflight passes when codex --version ok AND OPENAI_API_KEY present (no auth.json)", () => {
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: { OPENAI_API_KEY: "sk-x" },
      fs: AUTH_JSON_ABSENT,
    }).preflight();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("OPENAI_API_KEY present");
  });

  it("preflight passes when codex --version ok AND auth.json present (no OPENAI_API_KEY)", () => {
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: {},
      fs: AUTH_JSON_PRESENT,
    }).preflight();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("codex login session");
  });

  it("preflight passes when both OPENAI_API_KEY and auth.json are present", () => {
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: { OPENAI_API_KEY: "sk-x" },
      fs: AUTH_JSON_PRESENT,
    }).preflight();
    expect(r.ok).toBe(true);
  });

  it("preflight refuses when neither OPENAI_API_KEY nor auth.json is present (CH-6)", () => {
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: {},
      fs: AUTH_JSON_ABSENT,
    }).preflight();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/OPENAI_API_KEY/);
    expect(r.message).toMatch(/codex login/);
    expect(r.message).toMatch(/auth\.json/);
  });

  it("preflight refuses when OPENAI_API_KEY is whitespace-only and no auth.json (CH-6)", () => {
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: { OPENAI_API_KEY: "   " },
      fs: AUTH_JSON_ABSENT,
    }).preflight();
    expect(r.ok).toBe(false);
  });

  it("preflight refuses when codex --version fails (regardless of auth)", () => {
    const noBin = new CodexPaneAdapter({
      run: runner({ codex: FAIL }),
      env: { OPENAI_API_KEY: "sk-x" },
      fs: AUTH_JSON_PRESENT,
    }).preflight();
    expect(noBin.ok).toBe(false);
    expect(noBin.message).toMatch(/codex/);
  });

  it("CODEX_HOME env override is used to resolve auth.json path", () => {
    // Inject a CODEX_HOME that the fs seam reports as having auth.json.
    const customFs: FsSeam = {
      existsSync: (p) => p === "/custom/codex/auth.json",
      statSync: (p) => {
        if (p === "/custom/codex/auth.json") return { size: 10 };
        throw new Error("ENOENT");
      },
    };
    const r = new CodexPaneAdapter({
      run: runner({ codex: OK }),
      env: { CODEX_HOME: "/custom/codex" },
      fs: customFs,
    }).preflight();
    expect(r.ok).toBe(true);
    expect(r.message).toContain("/custom/codex/auth.json");
  });

  // D-CAP (Wave-3 security): Codex panes need GUILD_TASK_ID so the hook file-fallback
  // (pre-tool-use.ts:487-494) can locate <runDir>/scope/<taskId>.json.
  it("D-CAP: command exports GUILD_TASK_ID when taskId is present", () => {
    const adapter = new CodexPaneAdapter({ env: { OPENAI_API_KEY: "sk-x" } });
    const c = adapter.command(spec({ hostKind: "codex", taskId: "task-sec-001" }));
    expect(c).toContain("export GUILD_TASK_ID=task-sec-001");
    // GUILD_TASK_ID must appear BEFORE `codex exec`
    expect(c.indexOf("GUILD_TASK_ID")).toBeLessThan(c.indexOf("codex exec"));
  });

  it("D-CAP: command does not export GUILD_TASK_ID when taskId is absent", () => {
    const adapter = new CodexPaneAdapter({ env: { OPENAI_API_KEY: "sk-x" } });
    const c = adapter.command(spec({ hostKind: "codex" }));
    expect(c).not.toContain("GUILD_TASK_ID");
  });

  it("D-CAP: env includes GUILD_TASK_ID when taskId is present (scope-file locatable)", () => {
    const adapter = new CodexPaneAdapter({ env: {} });
    const e = adapter.env(spec({ hostKind: "codex", taskId: "task-sec-001" }));
    expect(e["GUILD_TASK_ID"]).toBe("task-sec-001");
  });

  it("D-CAP: env does not include GUILD_TASK_ID when taskId is absent (regression anchor)", () => {
    const adapter = new CodexPaneAdapter({ env: {} });
    const e = adapter.env(spec({ hostKind: "codex" })); // no taskId
    expect(e).not.toHaveProperty("GUILD_TASK_ID");
    expect(e).toEqual({ GUILD_RUN_ID: "run-001" });
  });
});

describe("preflightTeam — fail-fast (CH-6)", () => {
  const claudeOk = runner({ claude: OK, codex: OK });

  it("defaults the orchestrator probe to claude; a mixed team passes when all probes pass (key auth)", () => {
    const resolver = resolveAdapter({ run: claudeOk, env: { OPENAI_API_KEY: "sk-x" }, fs: AUTH_JSON_ABSENT });
    const specialists: Array<{ name: string; host_kind?: "claude" | "codex" }> = [
      { name: "architect" }, // defaults to claude
      { name: "security", host_kind: "codex" },
    ];
    const r = preflightTeam(specialists, resolver);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("defaults the orchestrator probe to claude; a mixed team passes when all probes pass (auth.json)", () => {
    const resolver = resolveAdapter({ run: claudeOk, env: {}, fs: AUTH_JSON_PRESENT });
    const specialists: Array<{ name: string; host_kind?: "claude" | "codex" }> = [
      { name: "architect" },
      { name: "security", host_kind: "codex" },
    ];
    const r = preflightTeam(specialists, resolver);
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });

  it("collects a failure naming the specialist + host + both missing credential paths", () => {
    // codex binary present but neither OPENAI_API_KEY nor auth.json → the codex pane fails.
    const resolver = resolveAdapter({ run: claudeOk, env: {}, fs: AUTH_JSON_ABSENT });
    const r = preflightTeam([{ name: "security", host_kind: "codex" }], resolver);
    expect(r.ok).toBe(false);
    const f = r.failures.find((x) => x.specialist === "security");
    expect(f?.hostKind).toBe("codex");
    expect(f?.message).toMatch(/OPENAI_API_KEY/);
    expect(f?.message).toMatch(/codex login/);
  });

  it("fails when the orchestrator's claude binary is missing", () => {
    const resolver = resolveAdapter({
      run: runner({ claude: FAIL, codex: OK }),
      env: { OPENAI_API_KEY: "sk-x" },
      fs: AUTH_JSON_ABSENT,
    });
    const r = preflightTeam([{ name: "security", host_kind: "codex" }], resolver);
    expect(r.ok).toBe(false);
    expect(r.failures.some((x) => x.specialist === "orchestrator")).toBe(true);
  });

  it("codex-started preflight does not probe claude when no claude pane is present", () => {
    const resolver = resolveAdapter({
      run: runner({ claude: FAIL, codex: OK }),
      env: { OPENAI_API_KEY: "sk-x" },
      fs: AUTH_JSON_ABSENT,
    });
    const r = preflightTeam([{ name: "security" }], resolver, "codex");
    expect(r.ok).toBe(true);
    expect(r.failures).toHaveLength(0);
  });
});

describe("TmuxTeamBackend integration (regression-preserving)", () => {
  const SPECIALISTS: Specialist[] = [
    { name: "architect", scope: "boundaries", dependsOn: [] },
    { name: "backend", scope: "api", dependsOn: ["architect"] },
  ];

  it("composeTmuxCommands with an all-claude resolver === the no-resolver path (byte-for-byte)", () => {
    const common = {
      mode: "new-session" as const,
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: SPECIALISTS,
    };
    const legacy = composeTmuxCommands(common);
    const viaAdapter = composeTmuxCommands({ ...common, resolveAdapter: resolveAdapter() });
    expect(viaAdapter.map((c) => c.display)).toEqual(legacy.map((c) => c.display));
  });

  it("a codex specialist gets a `codex exec` pane; orchestrator stays claude", () => {
    const mixed: Specialist[] = [
      { name: "architect", scope: "boundaries", dependsOn: [] },
      { name: "security", scope: "audit", dependsOn: [], host_kind: "codex" },
    ];
    const cmds = composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: mixed,
      resolveAdapter: resolveAdapter({ env: { OPENAI_API_KEY: "sk-x" }, fs: AUTH_JSON_ABSENT }),
    });
    const inline = cmds.map((c) => c.argv[c.argv.length - 1]);
    // Orchestrator (new-session) pane is claude.
    expect(inline[0]).toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1");
    // Exactly one pane runs `codex exec` (the security specialist).
    const codexPanes = inline.filter((c) => c.includes("codex exec"));
    expect(codexPanes).toHaveLength(1);
    expect(codexPanes[0]).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
  });

  it("a codex-started team uses codex for the orchestrator and default specialists", () => {
    const cmds = composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-demo",
      cwd: "/tmp/repo",
      slug: "demo",
      runId: "run-test-001",
      specialists: SPECIALISTS,
      resolveAdapter: resolveAdapter({ env: { OPENAI_API_KEY: "sk-x" }, fs: AUTH_JSON_ABSENT }),
      orchestratorHostKind: "codex",
    });
    const inline = cmds.map((c) => c.argv[c.argv.length - 1]);
    expect(inline[0]).toContain("codex exec");
    expect(inline[0]).toContain("agent-bus");
    expect(inline[0]).not.toContain("TaskCreated");
    expect(inline[0]).not.toContain("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS");
    const codexPanes = inline.filter((c) => c.includes("codex exec"));
    expect(codexPanes).toHaveLength(1 + SPECIALISTS.length);
    expect(inline.some((c) => c.includes("claude "))).toBe(false);
    expect(inline.some((c) => c.includes("TaskCreated"))).toBe(false);
  });

  it("TmuxTeamBackend.preflight() no-ops without a resolver (regression)", () => {
    const backend = new TmuxTeamBackend({ run: runner({}) });
    expect(backend.preflight(SPECIALISTS)).toEqual({ ok: true, failures: [] });
  });

  it("TmuxTeamBackend.preflight() reports failures when a resolver is wired", () => {
    const backend = new TmuxTeamBackend({
      run: runner({}),
      resolveAdapter: resolveAdapter({
        run: runner({ claude: OK, codex: FAIL }),
        env: { OPENAI_API_KEY: "sk-x" },
        fs: AUTH_JSON_ABSENT,
      }),
    });
    const r = backend.preflight([{ name: "security", scope: "audit", dependsOn: [], host_kind: "codex" }]);
    expect(r.ok).toBe(false);
    expect(r.failures.some((f) => f.hostKind === "codex")).toBe(true);
  });
});
