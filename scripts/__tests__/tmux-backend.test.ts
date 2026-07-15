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

import type { RunFn } from "../lib/core/contracts/team-backend";
import {
  DEBUG_PANE_TITLE_PREFIX,
  isDebugShellTitle,
  isPaneAlive,
  livePaneIds,
  paneCommand,
  paneDebugEnabled,
  terminatePane,
} from "../lib/host/tmux-backend";

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
