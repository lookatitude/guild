/**
 * scripts/__tests__/tmux-backend.test.ts
 *
 * G4 — worker-pane teardown (deliverable 3) + the real termination primitive
 * (deliverable 2/4), task-cell-runtime ADR D5. Non-vacuous: each assertion would
 * fail if `exec $SHELL` were restored or `terminatePane` reverted to signal-only.
 *
 *   AT14  a completed worker's pane DISAPPEARS by default (no `exec $SHELL`); an
 *         operator debug shell is opt-in AND retitled so it can never be confused
 *         with a live worker.
 *   kill+confirm  terminatePane kills the pane and CONFIRMS its death by polling.
 *   AT6   a kill that does not confirm is an ORPHAN; a reaper retry confirms it.
 *   degraded  tmux unavailable is a recorded degradation, not a silent success.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { RunFn } from "../lib/core/contracts/team-backend";
import {
  DEBUG_PANE_TITLE_PREFIX,
  TmuxTeamBackend,
  composeTmuxCommands,
  isDebugShellTitle,
  isPaneAlive,
  livePaneIds,
  paneCommand,
  paneDebugEnabled,
  resolveClaudeTeamLaunchArgs,
  resolveTeamPaneHostMode,
  terminatePane,
} from "../lib/host/tmux-backend";
import { RUNTIME_DEFAULT_CONFIG, type RuntimePermissionConfig } from "../lib/permission-policy";

/** A scriptable fake `tmux` RunFn. `live` is mutated by kill-pane (unless killRemoves=false). */
function fakeTmux(opts: {
  live: Set<string>;
  killRemoves?: boolean;
  listFails?: boolean;
}): { run: RunFn; kills: string[] } {
  const kills: string[] = [];
  const run: RunFn = (cmd, args) => {
    if (cmd !== "tmux") return { status: 1, stdout: "", stderr: "not tmux" };
    const sub = args[0];
    if (sub === "-V") return { status: 0, stdout: "tmux 3.4\n", stderr: "" };
    if (sub === "list-panes") {
      if (opts.listFails) return { status: 1, stdout: "", stderr: "no server running" };
      return { status: 0, stdout: [...opts.live].join("\n") + (opts.live.size ? "\n" : ""), stderr: "" };
    }
    if (sub === "kill-pane") {
      const t = args[args.indexOf("-t") + 1];
      kills.push(t);
      if (opts.killRemoves !== false) opts.live.delete(t);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, kills };
}

// ── AT14 — no lingering shell by default; opt-in debug shell is distinguishable ─

describe("paneCommand — worker pane teardown (deliverable 3 / AT14)", () => {
  it("does NOT append `exec $SHELL` by default — a completed worker's pane closes", () => {
    const c = paneCommand("do the thing", "run-1", undefined, "task-1", "backend", /* debug */ false);
    expect(c).not.toContain("exec $SHELL");
    // No launchArgs passed => byte-identical to paneCommand's pre-issue-#54
    // behavior (issue #54's flag-splicing is an explicit opt-in — see the
    // "host launch flags" describe block below).
    expect(c).toContain("claude 'do the thing'");
    // Ends on the worker invocation — nothing keeps the pane alive after it exits.
    expect(c.trimEnd().endsWith("claude 'do the thing'")).toBe(true);
  });

  it("opt-in debug shell retitles the pane to the debug sentinel so it is NOT a live worker", () => {
    const c = paneCommand("do the thing", "run-1", undefined, "task-1", "backend", /* debug */ true);
    expect(c).toContain("exec $SHELL"); // the operator shell only exists under opt-in
    expect(c).toContain(`${DEBUG_PANE_TITLE_PREFIX}backend`);
    expect(c).toContain("select-pane");
    expect(c).toContain("NOT a live worker");
  });

  it("paneDebugEnabled reads GUILD_PANE_DEBUG=1", () => {
    expect(paneDebugEnabled({ GUILD_PANE_DEBUG: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(paneDebugEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(paneDebugEnabled({ GUILD_PANE_DEBUG: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("isDebugShellTitle distinguishes a debug shell title from a live worker title", () => {
    expect(isDebugShellTitle(`${DEBUG_PANE_TITLE_PREFIX}backend`)).toBe(true);
    expect(isDebugShellTitle("backend")).toBe(false);
    expect(isDebugShellTitle("orchestrator")).toBe(false);
  });
});

// ── issue #54 — host launch flags threaded into the pane command ────────────

describe("resolveTeamPaneHostMode — team-pane 'ask' lifts to 'bypass_all'", () => {
  it("the default config (no host_mode set) resolves to bypass_all", () => {
    expect(resolveTeamPaneHostMode(RUNTIME_DEFAULT_CONFIG)).toBe("bypass_all");
  });

  it("an explicit host_mode: 'ask' also lifts to bypass_all (same team-pane default)", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "ask" };
    expect(resolveTeamPaneHostMode(config)).toBe("bypass_all");
  });

  it("an explicit non-'ask' host_mode is honored verbatim, not overridden", () => {
    const readOnly: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "read_only" };
    expect(resolveTeamPaneHostMode(readOnly)).toBe("read_only");
    const acceptEdits: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    expect(resolveTeamPaneHostMode(acceptEdits)).toBe("accept_edits");
  });
});

describe("resolveClaudeTeamLaunchArgs — the Claude-only launch-flag resolver (issue #54)", () => {
  it("the default config (no host_mode set) resolves to the bypass flag", () => {
    expect(resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG)).toEqual(["--permission-mode", "bypassPermissions"]);
  });

  it("an explicit host_mode is honored — e.g. accept_edits maps to its own claude flag", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    expect(resolveClaudeTeamLaunchArgs(config)).toEqual(["--permission-mode", "acceptEdits"]);
  });
});

describe("paneCommand — launchArgs splicing (issue #54: an explicit opt-in, not a new default)", () => {
  it("with no launchArgs, paneCommand is UNCHANGED from its pre-issue-#54 shape (bare claude invocation)", () => {
    const c = paneCommand("do the work", "run-1", undefined, "task-1", "backend");
    expect(c).toContain("claude 'do the work'");
    expect(c).not.toContain("--permission-mode");
  });

  it("an explicit launchArgs is spliced between the binary and the prompt", () => {
    const c = paneCommand(
      "do the work",
      "run-1",
      undefined,
      "task-1",
      "backend",
      /* debug */ false,
      resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG),
    );
    expect(c).toContain("claude --permission-mode bypassPermissions 'do the work'");
  });

  it("prompt quoting stays intact when flags are inserted ahead of the prompt", () => {
    const trickyPrompt = "do the work; then 'quote' this $VAR";
    const c = paneCommand(
      trickyPrompt,
      "run-1",
      undefined,
      "task-1",
      "backend",
      /* debug */ false,
      resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG),
    );
    // The whole prompt is a single shell-quoted argument, immediately after the
    // resolved flags — no unescaped shell metacharacters leak into the pane command.
    const quotedPrompt = `'${trickyPrompt.replace(/'/g, "'\\''")}'`;
    expect(c).toContain(`claude --permission-mode bypassPermissions ${quotedPrompt}`);
    expect(c.trimEnd().endsWith(quotedPrompt)).toBe(true);
  });

  it("each launchArgs token is independently shell-quoted, not just the prompt", () => {
    // A hostile-shaped launch arg (spaces, quotes, $(), ;) — if `launchArgs.map(shellQuote)`
    // were ever removed in favor of a naive `.join(" ")`, this would inject.
    const hostileArg = "--foo=bar; rm -rf / $(whoami) 'x'";
    const c = paneCommand("do the work", "run-1", undefined, "task-1", "backend", false, [hostileArg]);
    const quotedArg = `'${hostileArg.replace(/'/g, "'\\''")}'`;
    expect(c).toContain(`claude ${quotedArg} 'do the work'`);
    // Not present unquoted/raw anywhere in the command.
    expect(c).not.toContain(`claude ${hostileArg} `);
  });
});

describe("composeTmuxCommands — the real builder the launcher uses, per launch mode", () => {
  const baseOpts = {
    targetName: "guild-team",
    cwd: "/repo",
    slug: "my-slug",
    runId: "run-1",
    specialists: [{ name: "backend", scope: "backend work" } as never],
  };

  it("new-session mode: every pane command carries the resolved claude launch flags", () => {
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "new-session" });
    const orchestratorCmd = cmds[0]!.argv[cmds[0]!.argv.length - 1]!;
    expect(orchestratorCmd).toContain("claude --permission-mode bypassPermissions");

    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const paneArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(paneArg).toContain("claude --permission-mode bypassPermissions");
  });

  it("in-session mode: every pane command (orchestrator AND teammate split panes) carries the resolved flags", () => {
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "in-session" });
    const newWindowCmd = cmds.find((c) => c.argv[1] === "new-window")!;
    const orchestratorArg = newWindowCmd.argv[newWindowCmd.argv.length - 1]!;
    expect(orchestratorArg).toContain("claude --permission-mode bypassPermissions");

    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const teammateArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(teammateArg).toContain("claude --permission-mode bypassPermissions");
  });

  it("an explicit non-default permissionConfig flows through to every pane", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "new-session", permissionConfig: config });
    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const paneArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(paneArg).toContain("claude --permission-mode acceptEdits");
    expect(paneArg).not.toContain("bypassPermissions");
  });

  // Issue #54 (round 4): a LOCAL mixed-host team's claude pane still gets the
  // resolved launch flags — composeTmuxCommands intercepts every "claude"
  // host_kind before it ever consults resolveAdapter, so the resolver is
  // called ONLY for the non-claude (codex) pane. Guards both directions:
  // (a) the claude pane never reaches the mock resolver at all, and (b) the
  // codex pane DOES reach it, with no permissionConfig-derived flags leaking
  // into what the mock returns.
  it("a local mixed-host team: the claude pane bypasses the resolver and still gets flags; the codex pane still routes through it", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    const seenSpecs: Array<{ name: string; hostKind: string }> = [];
    const cmds = composeTmuxCommands({
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      mode: "new-session",
      permissionConfig: config,
      specialists: [
        { name: "backend", scope: "backend work" } as never,
        { name: "security", scope: "audit", host_kind: "codex" } as never,
      ],
      resolveAdapter: () => ({
        hostKind: "codex",
        adapterVersion: "test",
        preflight: () => ({ ok: true, message: "ok" }),
        command: (spec) => {
          seenSpecs.push({ name: spec.name, hostKind: spec.hostKind });
          return `codex exec ${spec.prompt}`; // bare — proving no claude-flag leakage
        },
        env: () => ({}),
        expectedOutputs: () => [],
      }),
    });

    // The mock resolver was called ONLY for the codex pane, never for claude.
    expect(seenSpecs).toEqual([{ name: "security", hostKind: "codex" }]);

    const splitCmds = cmds.filter((c) => c.argv[1] === "split-window");
    const backendCmd = splitCmds.find((c) => c.argv[c.argv.length - 1]!.includes("backend work"))!;
    expect(backendCmd.argv[backendCmd.argv.length - 1]).toContain("claude --permission-mode acceptEdits");

    const codexCmd = splitCmds.find((c) => c.argv[c.argv.length - 1]!.includes("codex exec"))!;
    expect(codexCmd.argv[codexCmd.argv.length - 1]).not.toContain("--permission-mode");
    expect(codexCmd.argv[codexCmd.argv.length - 1]).not.toContain("acceptEdits");
  });
});

// ── issue #54 — TmuxTeamBackend.plan(), composeTmuxCommands's real caller ───

describe("TmuxTeamBackend.plan() — the real launcher call chain resolves the same flags", () => {
  it("a plain-Claude team's plan() carries the resolved bypass flags on every pane, end-to-end", () => {
    const backend = new TmuxTeamBackend();
    const plan = backend.plan({
      mode: "new-session",
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      specialists: [{ name: "backend", scope: "backend work" } as never],
      dryRun: true,
    });
    const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
    expect(orchestratorCmd).toContain("claude --permission-mode bypassPermissions");

    const splitCmd = plan.commands.find((c) => c.argv[1] === "split-window")!;
    const teammateCmd = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(teammateCmd).toContain("claude --permission-mode bypassPermissions");
  });

  // rf-wi-01 (G1 codex-review fix, P1) — plan() now actually reads the project's
  // registered `host_mode` (readRuntimePermissionConfig(req.cwd)) instead of
  // always defaulting to RUNTIME_DEFAULT_CONFIG. Before the fix, `config show
  // --sources` could report a configured host_mode while the real dispatch path
  // silently ignored it and launched bypassed anyway.
  it("an explicit non-'ask' host_mode in the project's settings.json is honored verbatim on the real pane", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-backend-host-mode-"));
    try {
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ host_mode: "read_only" }));

      const backend = new TmuxTeamBackend();
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: root,
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
      // resolveHostLaunch("claude", "read_only") -> the read-only launch mode, NOT bypassPermissions.
      expect(orchestratorCmd).not.toContain("bypassPermissions");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no settings.json at all still falls back to the unset->bypass_all team-pane default", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-backend-no-settings-"));
    try {
      const backend = new TmuxTeamBackend();
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: root,
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
      expect(orchestratorCmd).toContain("claude --permission-mode bypassPermissions");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── terminatePane — real kill + confirm (deliverable 2) ──────────────────────

describe("terminatePane — kills the pane and confirms its death", () => {
  it("kills a live pane and confirms it is gone", () => {
    const { run, kills } = fakeTmux({ live: new Set(["%1", "%2"]) });
    const out = terminatePane("%1", { run });
    expect(kills).toEqual(["%1"]);
    expect(out.ok).toBe(true);
    expect(out.confirmed).toBe(true);
    expect(out.mechanism).toBe("tmux kill-pane");
    expect(out.degraded).toBe(false);
  });

  it("is idempotent — an already-dead pane confirms with zero kills", () => {
    const { run, kills } = fakeTmux({ live: new Set(["%2"]) });
    const out = terminatePane("%1", { run });
    expect(kills).toEqual([]); // pane already absent — no kill issued
    expect(out.ok).toBe(true);
    expect(out.confirmed).toBe(true);
    expect(out.polls).toBe(0);
  });

  it("refuses a dry-run placeholder pane id", () => {
    const { run } = fakeTmux({ live: new Set(["%1"]) });
    const out = terminatePane("(dry-run: not spawned)", { run });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/placeholder/);
  });

  it("records a DEGRADATION when tmux is unavailable (host-unavailable, D5)", () => {
    const { run } = fakeTmux({ live: new Set(["%1"]), listFails: true });
    const out = terminatePane("%1", { run });
    expect(out.ok).toBe(false);
    expect(out.degraded).toBe(true);
    expect(out.error).toMatch(/unavailable/i);
  });
});

// ── AT6 — a kill that does not confirm is an orphan; the reaper retries ───────

describe("AT6 — terminate fails → orphan → reaper retry → terminated", () => {
  it("returns an unconfirmed orphan when the pane survives the kill, then confirms on retry", () => {
    // First attempt: kill does NOT remove the pane (survives) → orphan.
    const live = new Set(["%1"]);
    const first = fakeTmux({ live, killRemoves: false });
    const orphan = terminatePane("%1", { run: first.run, pollAttempts: 3 });
    expect(first.kills).toEqual(["%1"]);
    expect(orphan.ok).toBe(false);
    expect(orphan.confirmed).toBe(false);
    expect(orphan.degraded).toBe(false);
    expect(orphan.polls).toBe(3);
    expect(isPaneAlive("%1", first.run)).toBe(true); // still live — must be reaped

    // Reaper retry: kill now lands → confirmed terminated.
    const retry = fakeTmux({ live, killRemoves: true });
    const done = terminatePane("%1", { run: retry.run });
    expect(done.ok).toBe(true);
    expect(done.confirmed).toBe(true);
    expect(isPaneAlive("%1", retry.run)).toBe(false);
  });
});

// ── liveness helpers ─────────────────────────────────────────────────────────

describe("livePaneIds / isPaneAlive", () => {
  it("returns the live set, or null when tmux errors", () => {
    const ok = fakeTmux({ live: new Set(["%1", "%2"]) });
    expect(livePaneIds(ok.run)).toEqual(new Set(["%1", "%2"]));
    const bad = fakeTmux({ live: new Set(), listFails: true });
    expect(livePaneIds(bad.run)).toBeNull();
    expect(isPaneAlive("%1", bad.run)).toBe(false); // fail-closed
  });
});
