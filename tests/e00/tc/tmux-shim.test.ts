/**
 * E00-T0 · F5/F8/F9 controls for the TC test infrastructure (runs at TA when
 * tmux exists): the shim isolates its server and holds kill-pane at an explicit
 * barrier; teardownOwned establishes closure only from the process table, closes
 * the exact owned server even when its socket is gone, owns only what the shim
 * captured at its start call (an unowned prefix-colliding server and a same-socket
 * replacement survive, and a later query never adopts a replacement), never signals
 * on an unreadable process table, never kills through the socket (a replacement
 * installed between identification and action survives), refuses to launch when
 * its start record cannot be written, and keeps (and fails on) any root whose
 * closure, ownership or ledger integrity is unknown, including a recorded start with
 * no captured identity, or whose owned child is not confirmed stopped.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { argvNamesSocket, listProcesses, ownChild, ownRoot, ownTmuxServer, ownedTempDir, processStart, readTmuxLedger, teardownOwned } from "../support/e00-harness";
import { installTmuxShim, resolveRealTmux, tmuxOn } from "./tmux-shim";

afterEach(teardownOwned);

const hasTmux = resolveRealTmux() !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shimRoot() {
  const root = ownedTempDir("guild-e00-tmux-");
  const bin = path.join(root, ".tc-bin");
  const shim = installTmuxShim(root, bin);
  const env = { ...process.env, PATH: `${bin}:${process.env["PATH"]}`, TMUX: "/tmp/not-the-test-server,1,0" };
  const viaShim = (args: string[]) => spawnSync(path.join(bin, "tmux"), args, { encoding: "utf8", env, timeout: 10000 });
  return { root, bin, shim, env, viaShim };
}

const panePid = (shim: ReturnType<typeof shimRoot>["shim"]) => Number((tmuxOn(shim, ["list-panes", "-a", "-F", "#{pane_pid}"]).stdout ?? "").trim().split("\n")[0]);

/** Server processes whose argv names this exact socket, from the process table. */
function serversFor(socket: string): Array<{ pid: number; start: string }> {
  return (listProcesses() ?? []).filter((r) => argvNamesSocket(r.command, socket)).map((r) => ({ pid: r.pid, start: r.start }));
}

async function killExact(ids: Array<{ pid: number; start: string }>): Promise<void> {
  for (const i of alive(ids)) process.kill(i.pid, "SIGKILL");
  const end = Date.now() + 5000;
  while (Date.now() < end && alive(ids).length > 0) await sleep(50);
}
const alive = (ids: Array<{ pid: number; start: string }>) => {
  const rows = listProcesses() ?? [];
  return ids.filter((i) => rows.some((r) => r.pid === i.pid && r.start === i.start));
};

describe.skipIf(!hasTmux)("TC tmux shim (infrastructure controls)", () => {
  it("creates sessions only on its isolated root-local server, ignoring an inherited TMUX", () => {
    const { shim, viaShim } = shimRoot();
    const name = `e00shim${process.pid}`;
    expect(viaShim(["new-session", "-d", "-s", name, "sleep 600"]).status).toBe(0);
    expect(tmuxOn(shim, ["has-session", "-t", name]).status).toBe(0);
    expect(spawnSync(shim.realTmux, ["has-session", "-t", name], { encoding: "utf8" }).status).not.toBe(0);
    expect(fs.readFileSync(shim.callsLog, "utf8").split("\n")).toContain("new-session");
  });

  it("holds kill-pane at the barrier until released, then kills the pane", async () => {
    const { root, shim, viaShim, bin, env } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "barrier", "sleep 600"]).status).toBe(0);
    const pane = (tmuxOn(shim, ["list-panes", "-a", "-F", "#{pane_id}"]).stdout ?? "").trim();
    fs.writeFileSync(shim.holdFile, "");
    const killer = ownChild(spawn(path.join(bin, "tmux"), ["kill-pane", "-t", pane], { env, stdio: "ignore" }), root);
    const until = Date.now() + 5000;
    while (Date.now() < until && !fs.existsSync(shim.arrivedFile)) await sleep(20);
    expect(fs.existsSync(shim.arrivedFile)).toBe(true);
    await sleep(300);
    expect(killer.exitCode).toBeNull();
    expect(tmuxOn(shim, ["list-panes", "-a", "-F", "#{pane_id}"]).stdout?.trim()).toBe(pane);
    fs.rmSync(shim.holdFile);
    const done = await new Promise<number | null>((r) => killer.on("exit", (code) => r(code)));
    expect(done).toBe(0);
    expect(tmuxOn(shim, ["list-sessions"]).status).not.toBe(0);
  });

  it("teardown closes the owned server, confirms its pane process is gone, and removes the root", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "td", "sleep 600"]).status).toBe(0);
    const pid = panePid(shim);
    const start = processStart(pid);
    expect(start).not.toBeNull();
    await teardownOwned();
    expect(processStart(pid) === start).toBe(false);
    expect(fs.existsSync(root)).toBe(false);
  });

  it("teardown signals only verified owned children and leaves an unowned process running", async () => {
    const owned = ownChild(spawn("sleep", ["600"], { stdio: "ignore" }), ownedTempDir("guild-e00-child-"));
    const ownedStart = processStart(owned.pid!);
    const stranger = spawn("sleep", ["600"], { stdio: "ignore", detached: true });
    const strangerStart = processStart(stranger.pid!);
    try {
      await teardownOwned();
      expect(processStart(owned.pid!) === ownedStart).toBe(false);
      expect(processStart(stranger.pid!)).toBe(strangerStart);
    } finally {
      if (processStart(stranger.pid!) === strangerStart) process.kill(stranger.pid!, "SIGKILL");
    }
  });
  it("socket-failure control: a failed tmux query is not exit proof; teardown kills the exact owned server and panes and spares an unowned server", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "owned", "sleep 600"]).status).toBe(0);
    const pane = { pid: panePid(shim), start: (listProcesses() ?? []).find((r) => r.pid === panePid(shim))!.start };
    const servers = serversFor(shim.socket);
    expect(servers.length).toBe(1);
    const strangerDir = fs.realpathSync(fs.mkdtempSync(path.join(require("os").tmpdir(), "guild-e00-stranger-")));
    const strangerSock = path.join(strangerDir, "sock");
    expect(spawnSync(shim.realTmux, ["-S", strangerSock, "-f", "/dev/null", "new-session", "-d", "-s", "stranger", "sleep 600"]).status).toBe(0);
    const stranger = serversFor(strangerSock);
    try {
      fs.rmSync(shim.socket);
      expect(tmuxOn(shim, ["list-sessions"]).status).not.toBe(0);
      expect(alive([...servers, pane]).length).toBe(2);
      await teardownOwned();
      expect(alive([...servers, pane])).toEqual([]);
      expect(fs.existsSync(root)).toBe(false);
      expect(alive(stranger).length).toBe(1);
    } finally {
      spawnSync(shim.realTmux, ["-S", strangerSock, "kill-server"]);
      const end = Date.now() + 5000;
      while (Date.now() < end && alive(stranger).length > 0) await sleep(50);
      expect(alive(stranger)).toEqual([]);
      fs.rmSync(strangerDir, { recursive: true, force: true });
    }
  });

  it("unknown closure (process table unreadable) keeps the root and fails teardown; the real teardown then cleans exactly that server", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "unknown", "sleep 600"]).status).toBe(0);
    const servers = serversFor(shim.socket);
    let failure = "";
    try {
      await teardownOwned({ listProcesses: () => null });
    } catch (e) {
      failure = (e as Error).message;
    }
    expect(failure).toMatch(/closure unknown/);
    expect(fs.existsSync(root)).toBe(true);
    expect(alive(servers).length).toBe(1);
    ownRoot(root);
    ownTmuxServer(root, shim.realTmux, shim.socket, shim.identities);
    await teardownOwned();
    expect(alive(servers)).toEqual([]);
    expect(fs.existsSync(root)).toBe(false);
  });

  it("F9 control: an owned child not confirmed stopped keeps its root and fails teardown", async () => {
    const root = ownedTempDir("guild-e00-child-");
    const child = ownChild(spawn("sleep", ["600"], { stdio: "ignore" }), root);
    const ident = { pid: child.pid!, start: processStart(child.pid!)!.replace(/\s+/g, " ") };
    let failure = "";
    try {
      await teardownOwned({ signal: () => {}, waitMs: 300 });
    } catch (e) {
      failure = (e as Error).message;
    }
    expect(failure).toMatch(/not confirmed stopped/);
    expect(fs.existsSync(root)).toBe(true);
    expect(alive([ident]).length).toBe(1);
    ownRoot(root);
    ownChild(child, root);
    await teardownOwned();
    expect(alive([ident])).toEqual([]);
    expect(fs.existsSync(root)).toBe(false);
  });
  it("the shim captures server and pane identities while the socket is reachable", () => {
    const { shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "cap", "sleep 600"]).status).toBe(0);
    expect(viaShim(["new-session", "-d", "-s", "cap2", "sleep 600"]).status).toBe(0);
    const ledger = readTmuxLedger(shim.identities);
    expect(ledger.servers).toEqual(serversFor(shim.socket));
    expect(ledger.uncovered).toEqual([]);
    const panes = (tmuxOn(shim, ["list-panes", "-a", "-F", "#{pane_pid}"]).stdout ?? "").trim().split("\n").map(Number).sort();
    expect(ledger.panes.map((p) => p.pid).sort()).toEqual(panes);
    const starts = fs.readFileSync(shim.identities, "utf8").split("\n").filter((l) => l.startsWith("start\t"));
    expect(starts.length).toBe(2);
  });

  it("F8: a recorded start whose identity capture failed keeps the root and fails, even with the socket removed and argv hidden; nothing is signalled", async () => {
    const { root, shim, viaShim } = shimRoot();
    fs.writeFileSync(shim.failCapture, "");
    expect(viaShim(["new-session", "-d", "-s", "uncapt", "sleep 600"]).status).toBe(0);
    const servers = serversFor(shim.socket);
    expect(servers.length).toBe(1);
    const pane = { pid: panePid(shim), start: processStart(panePid(shim))!.replace(/\s+/g, " ") };
    const ledger = readTmuxLedger(shim.identities);
    expect(ledger.servers).toEqual([]);
    expect(ledger.uncovered.length).toBe(1);
    fs.rmSync(shim.socket);
    const blinded = () => (listProcesses() ?? []).map((r) => ({ ...r, command: "renamed" }));
    const signals: number[] = [];
    let failure = "";
    try {
      await teardownOwned({ listProcesses: blinded, signal: (pid, sig) => { signals.push(pid); process.kill(pid, sig); }, waitMs: 300 });
    } catch (e) {
      failure = (e as Error).message;
    }
    try {
      expect(failure).toMatch(/without a verified identity \(exit unknown\)/);
      expect(signals).toEqual([]);
      expect(fs.existsSync(root)).toBe(true);
      expect(alive([...servers, pane]).length).toBe(2);
    } finally {
      await killExact([...servers, pane]);
      expect(alive([...servers, pane])).toEqual([]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F10: a same-socket replacement server is never adopted or signalled; owned identities still close and the root is kept", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "owned", "sleep 600"]).status).toBe(0);
    const owned = readTmuxLedger(shim.identities);
    expect(owned.servers.length).toBe(1);
    const ownedKeys = new Set([...owned.servers, ...owned.panes].map((i) => `${i.pid}|${i.start}`));
    fs.rmSync(shim.socket);
    expect(spawnSync(shim.realTmux, ["-S", shim.socket, "-f", "/dev/null", "new-session", "-d", "-s", "repl", "sleep 600"]).status).toBe(0);
    const replServer = serversFor(shim.socket).filter((i) => !ownedKeys.has(`${i.pid}|${i.start}`));
    expect(replServer.length).toBe(1);
    const replPane = { pid: panePid(shim), start: processStart(panePid(shim))!.replace(/\s+/g, " ") };
    const replacement = [...replServer, replPane];
    // A successful query through the shim must not refresh ownership.
    expect(viaShim(["list-sessions"]).status).toBe(0);
    const after = readTmuxLedger(shim.identities);
    expect(after.servers).toEqual(owned.servers);
    expect(after.panes).toEqual(owned.panes);
    const signals: number[] = [];
    let failure = "";
    try {
      await teardownOwned({ signal: (pid, sig) => { signals.push(pid); process.kill(pid, sig); } });
    } catch (e) {
      failure = (e as Error).message;
    }
    try {
      expect(failure).toMatch(/ownership is not verified \(no signal sent\)/);
      expect(signals.filter((pid) => replacement.some((r) => r.pid === pid))).toEqual([]);
      expect(alive([...owned.servers, ...owned.panes])).toEqual([]);
      expect(alive(replacement).length).toBe(2);
      expect(fs.existsSync(root)).toBe(true);
    } finally {
      await killExact(replacement);
      expect(alive(replacement)).toEqual([]);
    }
    ownRoot(root);
    ownTmuxServer(root, shim.realTmux, shim.socket, shim.identities);
    await teardownOwned();
    expect(fs.existsSync(root)).toBe(false);
  });

  it("exact -S token match: an unowned server whose socket shares the owned path as a prefix survives teardown", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "owned", "sleep 600"]).status).toBe(0);
    const collidingSock = `${shim.socket}x`;
    expect(spawnSync(shim.realTmux, ["-S", collidingSock, "-f", "/dev/null", "new-session", "-d", "-s", "collide", "sleep 600"]).status).toBe(0);
    const colliding = serversFor(collidingSock);
    expect(colliding.length).toBe(1);
    expect(argvNamesSocket(`tmux -S ${collidingSock} -f /dev/null new-session`, shim.socket)).toBe(false);
    const owned = readTmuxLedger(shim.identities);
    try {
      await teardownOwned();
      expect(alive([...owned.servers, ...owned.panes])).toEqual([]);
      expect(alive(colliding).length).toBe(1);
      expect(fs.existsSync(root)).toBe(false);
    } finally {
      await killExact(colliding);
      expect(alive(colliding)).toEqual([]);
    }
  });

  it("ownership survives undiscoverable argv: ledger identities are closed and confirmed even when no process names the socket", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "hidden", "sleep 600"]).status).toBe(0);
    const owned = readTmuxLedger(shim.identities);
    expect(owned.servers.length).toBe(1);
    fs.rmSync(shim.socket);
    const blinded = () => (listProcesses() ?? []).map((r) => ({ ...r, command: "renamed" }));
    await teardownOwned({ listProcesses: blinded });
    expect(alive([...owned.servers, ...owned.panes])).toEqual([]);
    expect(fs.existsSync(root)).toBe(false);
  });

  it("uncaptured ownership: a live socket server absent from the ledger is not signalled; the root is kept and teardown fails; a later query does not adopt it", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "uncaptured", "sleep 600"]).status).toBe(0);
    const servers = serversFor(shim.socket);
    const pane = { pid: panePid(shim), start: processStart(panePid(shim))!.replace(/\s+/g, " ") };
    fs.rmSync(shim.identities);
    expect(viaShim(["list-sessions"]).status).toBe(0);
    expect(readTmuxLedger(shim.identities).servers).toEqual([]);
    const signals: number[] = [];
    let failure = "";
    try {
      await teardownOwned({ signal: (pid) => { signals.push(pid); } });
    } catch (e) {
      failure = (e as Error).message;
    }
    try {
      expect(failure).toMatch(/ownership is not verified/);
      expect(failure).toMatch(/ledger integrity unconfirmed \(missing_start_records\)/);
      expect(signals).toEqual([]);
      expect(fs.existsSync(root)).toBe(true);
      expect(alive([...servers, pane]).length).toBe(2);
    } finally {
      await killExact([...servers, pane]);
      expect(alive([...servers, pane])).toEqual([]);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F8: an unwritable start ledger aborts the launch (no server, no pane) and teardown reports integrity unconfirmed, never closure", async () => {
    const { root, shim, viaShim } = shimRoot();
    fs.writeFileSync(shim.identities, "", { mode: 0o444 });
    const marker = `${6000 + (process.pid % 997)}`;
    try {
      const r = viaShim(["new-session", "-d", "-s", "ledgerfail", `sleep ${marker}`]);
      expect(r.status).toBe(125);
      expect(r.stderr).toContain("start record write failed; not launching");
      expect(fs.existsSync(shim.socket)).toBe(false);
      expect(serversFor(shim.socket)).toEqual([]);
      expect((listProcesses() ?? []).filter((p) => p.command === `sleep ${marker}`)).toEqual([]);
      expect(readTmuxLedger(shim.identities).integrity).toBe("missing_start_records");
      const signals: number[] = [];
      let failure = "";
      try {
        await teardownOwned({ signal: (pid) => { signals.push(pid); } });
      } catch (e) {
        failure = (e as Error).message;
      }
      expect(failure).toMatch(/ledger integrity unconfirmed \(missing_start_records\)/);
      expect(signals).toEqual([]);
      expect(fs.existsSync(root)).toBe(true);
    } finally {
      // Exact-identity cleanup if a regression launched anything.
      const leaked = [...serversFor(shim.socket), ...(listProcesses() ?? []).filter((p) => p.command === `sleep ${marker}`).map((p) => ({ pid: p.pid, start: p.start }))];
      await killExact(leaked);
      expect(alive(leaked)).toEqual([]);
      fs.chmodSync(shim.identities, 0o600);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("F10: a replacement installed between teardown's identification read and its cleanup action is neither adopted nor signalled; no socket kill is sent", async () => {
    const { root, shim, viaShim } = shimRoot();
    expect(viaShim(["new-session", "-d", "-s", "owned", "sleep 600"]).status).toBe(0);
    const owned = readTmuxLedger(shim.identities);
    expect(owned.servers.length).toBe(1);
    const ownedIds = [...owned.servers, ...owned.panes];
    const replacement: Array<{ pid: number; start: string }> = [];
    let reads = 0;
    const racing = () => {
      const rows = listProcesses();
      if (++reads === 1) {
        // Owned server dies and an unowned server binds the same socket after the read.
        for (const i of ownedIds) process.kill(i.pid, "SIGKILL");
        const end = Date.now() + 5000;
        while (Date.now() < end && alive(ownedIds).length > 0) spawnSync("sleep", ["0.05"]);
        fs.rmSync(shim.socket, { force: true });
        spawnSync(shim.realTmux, ["-S", shim.socket, "-f", "/dev/null", "new-session", "-d", "-s", "repl", "sleep 600"]);
        const ownedKeys = new Set(ownedIds.map((i) => `${i.pid}|${i.start}`));
        replacement.push(...serversFor(shim.socket).filter((i) => !ownedKeys.has(`${i.pid}|${i.start}`)));
        const pp = panePid(shim);
        replacement.push({ pid: pp, start: processStart(pp)!.replace(/\s+/g, " ") });
      }
      return rows;
    };
    const signals: number[] = [];
    let failure = "";
    try {
      await teardownOwned({ listProcesses: racing, signal: (pid, sig) => { signals.push(pid); try { process.kill(pid, sig); } catch { /* gone */ } } });
    } catch (e) {
      failure = (e as Error).message;
    }
    try {
      expect(reads).toBeGreaterThan(1);
      expect(replacement.length).toBe(2);
      expect(alive(replacement).length).toBe(2);
      expect(signals.filter((pid) => replacement.some((r) => r.pid === pid))).toEqual([]);
      expect(readTmuxLedger(shim.identities).servers).toEqual(owned.servers);
      expect(failure).toMatch(/ownership is not verified \(no signal sent\)/);
      expect(fs.existsSync(root)).toBe(true);
      expect(fs.readFileSync(path.join(__dirname, "..", "support", "e00-harness.ts"), "utf8")).not.toContain('"kill-server"');
    } finally {
      await killExact(replacement);
      expect(alive(replacement)).toEqual([]);
    }
    ownRoot(root);
    ownTmuxServer(root, shim.realTmux, shim.socket, shim.identities);
    await teardownOwned();
    expect(fs.existsSync(root)).toBe(false);
  });

  it("an unreadable process table never authorizes a signal to an owned child; its root is kept and teardown fails", async () => {
    const root = ownedTempDir("guild-e00-child-");
    const child = ownChild(spawn("sleep", ["600"], { stdio: "ignore" }), root);
    const ident = { pid: child.pid!, start: processStart(child.pid!)!.replace(/\s+/g, " ") };
    const signals: number[] = [];
    let failure = "";
    try {
      await teardownOwned({ listProcesses: () => null, signal: (pid) => { signals.push(pid); }, waitMs: 200 });
    } catch (e) {
      failure = (e as Error).message;
    }
    expect(signals).toEqual([]);
    expect(failure).toMatch(/not confirmed stopped \(unknown\)/);
    expect(fs.existsSync(root)).toBe(true);
    expect(alive([ident]).length).toBe(1);
    ownRoot(root);
    ownChild(child, root);
    await teardownOwned();
    expect(alive([ident])).toEqual([]);
  });
});
