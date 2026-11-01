/**
 * E00-T0 · independent E00-L check M1: terminateBoundPane's identity check runs
 * INSIDE the receiving tmux server at the action (POST-FIX authored after L's
 * source freeze; not red-before).
 *
 * Real, test-owned tmux server through tc/tmux-shim.ts (isolated root socket,
 * ledger ownership, fail-closed teardown). The race lands at the action: the shim
 * holds L's `if-shell` kill (hold-kill-pane barrier) after every client-side
 * precheck has passed; while it is held the test replaces the server on the same
 * socket, or respawns the pane, then releases it. The replacement must survive and
 * the outcome must not be a verified teardown. A child process runs the call so
 * the test can act while the shim holds it. Replacements are test-side only and
 * removed on the test-owned socket; no production code is changed.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { TMUX_SERVER_START_PREFIX, processStartOf } from "../../scripts/lib/host/tmux-backend";
import { ownChild, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { installTmuxShim, resolveRealTmux, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const BACKEND = path.resolve(__dirname, "..", "..", "scripts", "lib", "host", "tmux-backend.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FMT = "#{pane_id}\t#{pane_pid}\t#{pid}\t#{start_time}";

interface Rig { root: string; shim: TmuxShim; tmux: string; runner: string }

function rig(): Rig {
  const root = ownedTempDir("guild-e00-lbound-");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  const runner = path.join(root, "bound-runner.ts");
  // The child calls the production function with `run` routed through the shim.
  fs.writeFileSync(runner, [
    `import { spawnSync } from "child_process";`,
    `import { terminateBoundPane } from ${JSON.stringify(BACKEND)};`,
    `const [tmux, expectedJson] = process.argv.slice(2);`,
    `const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {`,
    `  const r = spawnSync(cmd === "tmux" ? tmux : cmd, args, { encoding: "utf8", timeout: 60000, ...o } as never);`,
    `  return { status: r.status, stdout: (r.stdout as unknown as string) ?? "", stderr: (r.stderr as unknown as string) ?? "" };`,
    `};`,
    `const expected = JSON.parse(expectedJson);`,
    `if (process.argv[4] === "naive") {`,
    `  // Anti-vacuity control: a client-side precheck then a plain kill-pane (the unsafe shape).`,
    `  const pre = run("tmux", ["display-message", "-p", "-t", expected.pane_id, "#{pane_pid}"]);`,
    `  const matches = Number(pre.stdout.trim()) === expected.pane_pid;`,
    `  if (matches) run("tmux", ["kill-pane", "-t", expected.pane_id]);`,
    `  process.stdout.write(JSON.stringify({ naive: true, precheck_matched: matches }));`,
    `} else {`,
    `  process.stdout.write(JSON.stringify(terminateBoundPane(expected.pane_id, expected, { run })));`,
    `}`,
  ].join("\n"));
  return { root, shim, tmux: path.join(bin, "tmux"), runner };
}

function tmuxVia(r: Rig, args: string[]) {
  return spawnSync(r.tmux, args, { encoding: "utf8", env: { ...process.env, LANG: "en_US.UTF-8" } });
}

/** Start a pane through the shim (owned server) and capture its recorded identity. */
function ownedPane(r: Rig, session: string, cmd: string) {
  const out = tmuxVia(r, ["new-session", "-d", "-P", "-F", FMT, "-s", session, cmd]);
  const [pane_id, panePid, serverPid, serverStart] = out.stdout.trim().split("\t");
  const pane_pid = Number(panePid);
  const start = processStartOf(pane_pid);
  if (!start) throw new Error(`fixture: owned pane not started (${out.stderr.trim()})`);
  return { pane_id, pane_pid, pane_process_start: start, server_pid: Number(serverPid), server_process_start: `${TMUX_SERVER_START_PREFIX}${serverStart}` };
}

/** Test-side replacement on the same socket, never through the shim (never owned). */
function replaceServer(r: Rig, cmd: string) {
  spawnSync(r.shim.realTmux, ["-S", r.shim.socket, "kill-server"]);
  const out = spawnSync(r.shim.realTmux, ["-S", r.shim.socket, "-f", "/dev/null", "new-session", "-d", "-P", "-F", FMT, "-s", "replacement", cmd], { encoding: "utf8", env: { ...process.env, LANG: "en_US.UTF-8" } });
  const [pane_id, panePid] = out.stdout.trim().split("\t");
  return { pane_id, pane_pid: Number(panePid), start: processStartOf(Number(panePid)) };
}

const removeReplacement = (r: Rig) => spawnSync(r.shim.realTmux, ["-S", r.shim.socket, "kill-server"]);
const ifShellCalls = (r: Rig) => (fs.existsSync(r.shim.callsLog) ? fs.readFileSync(r.shim.callsLog, "utf8").split("\n").filter((l) => l === "if-shell").length : 0);

/** Run terminateBoundPane in a child; when `atAction` is set, hold the if-shell kill and run it first. */
async function bound(r: Rig, expected: Record<string, unknown>, atAction?: () => void, mode = "bound"): Promise<Record<string, any>> {
  if (atAction) fs.writeFileSync(r.shim.holdFile, "");
  const child = ownChild(spawn("bun", [r.runner, r.tmux, JSON.stringify(expected), mode], { cwd: r.root, env: { ...process.env, LANG: "en_US.UTF-8" }, stdio: ["ignore", "pipe", "pipe"] }), r.root);
  let stdout = "";
  child.stdout!.on("data", (b) => { stdout += String(b); });
  const exited = new Promise<number | null>((res) => child.on("exit", (code) => res(code)));
  if (atAction) {
    const until = Date.now() + 30000;
    while (!fs.existsSync(r.shim.arrivedFile) && Date.now() < until) await sleep(20);
    if (!fs.existsSync(r.shim.arrivedFile)) throw new Error("the bound kill never reached the shim hold");
    atAction();
    fs.rmSync(r.shim.holdFile, { force: true });
  }
  await exited;
  return JSON.parse(stdout || "{}");
}

describe.skipIf(resolveRealTmux() === null)("M1 · terminateBoundPane binds the kill to the recorded server and pane at the action", () => {
  it("control: the recorded pane is killed, verified and confirmed, through a server-side if-shell", async () => {
    const r = rig();
    const id = ownedPane(r, "s1", "sleep 6031");
    const out = await bound(r, id);
    expect(out).toMatchObject({ ok: true, confirmed: true, identity_check: "verified" });
    expect(processStartOf(id.pane_pid)).toBeNull();
    expect(ifShellCalls(r)).toBe(1);
  });

  it("a replacement server on the same socket BEFORE the call is never killed; no if-shell is issued", async () => {
    const r = rig();
    const id = ownedPane(r, "s1", "sleep 6032");
    const repl = replaceServer(r, "sleep 6033");
    try {
      const out = await bound(r, id);
      expect(out.ok && out.confirmed && out.identity_check === "verified").toBe(false);
      expect(processStartOf(repl.pane_pid)).toBe(repl.start);
      expect(ifShellCalls(r)).toBe(0);
    } finally {
      removeReplacement(r);
    }
  });

  it("a replacement server on the same socket AT THE ACTION survives; the outcome is not a verified teardown", async () => {
    const r = rig();
    const id = ownedPane(r, "s1", "sleep 6034");
    let repl: ReturnType<typeof replaceServer> | null = null;
    try {
      const out = await bound(r, id, () => { repl = replaceServer(r, "sleep 6035"); });
      expect(repl!.start).not.toBeNull();
      expect(processStartOf(repl!.pane_pid)).toBe(repl!.start);
      expect(out.ok && out.confirmed && out.identity_check === "verified").toBe(false);
      expect(out.identity_check).not.toBe("verified");
      expect(ifShellCalls(r)).toBe(1);
    } finally {
      removeReplacement(r);
    }
  });

  it("anti-vacuity control: a client-side precheck plus a plain kill-pane at the same held moment DOES kill the replacement", async () => {
    const r = rig();
    const id = ownedPane(r, "s1", "sleep 6038");
    let repl: ReturnType<typeof replaceServer> | null = null;
    try {
      // Same pane id (%0) in the replacement server, so the unsafe shape hits it.
      const out = await bound(r, id, () => { repl = replaceServer(r, "sleep 6039"); }, "naive");
      expect(out).toMatchObject({ naive: true, precheck_matched: true });
      expect(repl!.pane_id).toBe(String(id.pane_id));
      expect(processStartOf(repl!.pane_pid)).toBeNull();
    } finally {
      removeReplacement(r);
    }
  });

  it("a pane respawned in the same server AT THE ACTION (same pane id, new process) survives; not a verified teardown", async () => {
    const r = rig();
    const id = ownedPane(r, "s1", "sleep 6036");
    let respawned: { pid: number; start: string | null } | null = null;
    try {
      const out = await bound(r, id, () => {
        spawnSync(r.shim.realTmux, ["-S", r.shim.socket, "respawn-pane", "-k", "-t", String(id.pane_id), "sleep 6037"]);
        const pid = Number(spawnSync(r.shim.realTmux, ["-S", r.shim.socket, "display-message", "-p", "-t", String(id.pane_id), "#{pane_pid}"], { encoding: "utf8" }).stdout.trim());
        respawned = { pid, start: processStartOf(pid) };
      });
      expect(respawned!.pid).not.toBe(id.pane_pid);
      expect(processStartOf(respawned!.pid)).toBe(respawned!.start);
      expect(out.ok && out.confirmed && out.identity_check === "verified").toBe(false);
    } finally {
      removeReplacement(r);
    }
  });
});
