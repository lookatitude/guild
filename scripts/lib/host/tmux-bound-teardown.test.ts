/**
 * E00-L source tests: identity-bound tmux teardown and the controller tmux worker
 * port. Real-tmux cases run on a private `-L` socket owned by the test.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { RunFn } from "../core/contracts/team-backend";
import { reapTmuxOrphanByCarrier } from "../../agent-team-launcher";
import {
  CREATE_IDENTITY_FORMAT,
  PANE_IDENTITY_SCHEMA,
  paneIdentityCarrierPath,
  probeTmuxAvailable,
  processStartOf,
  tmuxServerIdentity,
  TmuxTeamBackend,
  sanitizedWorkerEnv,
  terminateBoundPane,
  TMUX_SERVER_START_PREFIX,
  TmuxTaskCellWorkerPort,
  type BoundPaneIdentity,
} from "./tmux-backend";

const PLUGIN = path.resolve(__dirname, "..", "..", "..");
const hasTmux = spawnSync("tmux", ["-V"]).status === 0;
const sockets: string[] = [];
const socketPaths = new Map<string, string>();
const dirs: string[] = [];

afterEach(() => {
  for (const s of sockets.splice(0)) {
    spawnSync("tmux", ["-L", s, "kill-server"]);
    // Only this test's own -L socket file, after its server is gone.
    const socketPath = socketPaths.get(s);
    if (socketPath?.endsWith(`/${s}`) && tmuxOn(s, ["list-sessions"]).status !== 0) fs.rmSync(socketPath, { force: true });
  }
  socketPaths.clear();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function privateSocket(): string {
  const s = `gtc-l-${process.pid}-${sockets.length}-${Date.now() % 100000}`;
  sockets.push(s);
  return s;
}

function tmuxOn(sock: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync("tmux", ["-L", sock, "-f", "/dev/null", ...args], { encoding: "utf8", ...(env ? { env } : {}) });
}

/** Start a detached server on `sock` with one long-lived pane; returns its recorded identity. */
function startServer(sock: string, env?: NodeJS.ProcessEnv): BoundPaneIdentity {
  const r = tmuxOn(sock, ["new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid} #{pid} #{start_time}", "sleep 600"], env);
  expect(r.status).toBe(0);
  socketPaths.set(sock, tmuxOn(sock, ["display-message", "-p", "#{socket_path}"]).stdout.trim());
  const [pane_id, panePid, serverPid, start] = r.stdout.trim().split(" ");
  const pane_pid = Number(panePid);
  return {
    pane_id: pane_id!, pane_pid, pane_process_start: processStartOf(pane_pid)!,
    server_pid: Number(serverPid), server_process_start: `${TMUX_SERVER_START_PREFIX}${start}`,
  };
}

const runOn = (sock: string, before?: (args: string[]) => void, tmuxEnv?: NodeJS.ProcessEnv): RunFn => (cmd, args, o = {}) => {
  if (cmd === "tmux") {
    before?.(args);
    const r = tmuxOn(sock, args, tmuxEnv);
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }
  const r = spawnSync(cmd, args, { encoding: "utf8", ...o } as never);
  return { status: r.status, stdout: (r.stdout as unknown as string) ?? "", stderr: (r.stderr as unknown as string) ?? "" };
};

describe.skipIf(!hasTmux)("terminateBoundPane on a real private tmux server", () => {
  it("kills and confirms the recorded pane on the recorded server", () => {
    const sock = privateSocket();
    const id = startServer(sock);
    const out = terminateBoundPane(id.pane_id, id, { run: runOn(sock) });
    expect(out).toMatchObject({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("L-T0-3: confirms the target gone on the original server while a sibling pane survives", () => {
    const sock = privateSocket();
    const sibling = startServer(sock);
    const r = tmuxOn(sock, ["new-window", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "sleep 600"]);
    const [targetPane, targetPid] = r.stdout.trim().split(" ");
    const target: BoundPaneIdentity = { ...sibling, pane_id: targetPane!, pane_pid: Number(targetPid), pane_process_start: processStartOf(Number(targetPid))! };
    const out = terminateBoundPane(target.pane_id, target, { run: runOn(sock) });
    expect(out).toMatchObject({ ok: true, confirmed: true, degraded: false, identity_check: "verified" });
    const alive = tmuxOn(sock, ["list-panes", "-a", "-F", "#{pane_id} #{pane_pid}"]).stdout.trim();
    expect(alive).toBe(`${sibling.pane_id} ${sibling.pane_pid}`);
  });

  it("reads identity through a C-locale tmux client (tab-free formats)", () => {
    const sock = privateSocket();
    // A detached C-locale client (no TERM/TMUX) is the case that rewrites tabs.
    const cEnv: NodeJS.ProcessEnv = { ...process.env, LC_ALL: "C", LANG: "C" };
    for (const k of ["TERM", "TMUX", "TMUX_PANE"]) delete cEnv[k];
    const id = startServer(sock, cEnv);
    // Precondition: under the C locale a tab in -F output prints as `_`.
    expect(tmuxOn(sock, ["display-message", "-p", "#{pid}\t#{start_time}"], cEnv).stdout).toContain("_");
    const out = terminateBoundPane(id.pane_id, id, { run: runOn(sock, undefined, cEnv) });
    expect(out).toMatchObject({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("never kills a replacement server that appears between the check and the action", () => {
    const sock = privateSocket();
    const recorded = startServer(sock);
    let replacement: BoundPaneIdentity | null = null;
    // Replace the server on the same socket exactly at the bound kill: the pane id is
    // reused (%0 again) but the server identity differs, so the server-side check fails.
    const run = runOn(sock, (args) => {
      if (args[0] !== "if-shell" || replacement) return;
      tmuxOn(sock, ["kill-server"]);
      replacement = startServer(sock);
    });
    const out = terminateBoundPane(recorded.pane_id, recorded, { run });
    expect(replacement).not.toBeNull();
    expect(replacement!.pane_id).toBe(recorded.pane_id);
    expect(out.confirmed).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.identity_check).toBe("mismatch");
    // The replacement's pane is untouched.
    const alive = tmuxOn(sock, ["display-message", "-p", "-t", replacement!.pane_id, "#{pane_pid}"]);
    expect(alive.status).toBe(0);
    expect(Number(alive.stdout.trim())).toBe(replacement!.pane_pid);
  });

  it("issues no kill when the live pane already differs from the record", () => {
    const sock = privateSocket();
    const live = startServer(sock);
    const calls: string[] = [];
    const out = terminateBoundPane(live.pane_id, { ...live, pane_pid: live.pane_pid + 99999 }, {
      run: runOn(sock, (args) => calls.push(args[0]!)),
    });
    expect(out).toMatchObject({ ok: false, confirmed: false, identity_check: "mismatch" });
    expect(calls).not.toContain("if-shell");
    expect(calls).not.toContain("kill-pane");
    expect(tmuxOn(sock, ["display-message", "-p", "-t", live.pane_id, "#{pane_pid}"]).status).toBe(0);
  });
});

describe("terminateBoundPane decisions (fake tmux)", () => {
  const recorded: BoundPaneIdentity = {
    pane_id: "%3", pane_pid: 4242, pane_process_start: "Tue Oct 27 10:00:00 2026",
    server_pid: 77, server_process_start: `${TMUX_SERVER_START_PREFIX}1793000000`,
  };

  /** A fake server that evaluates if-shell conditions against its CURRENT identity only. */
  /** `listing` overrides the list-panes answer (status/stderr) to model a failing query; `ps` the full table. */
  function fakeServer(swapAtAction: boolean, listing?: { status: number | null; stderr: string }, ps?: string) {
    let server = { pid: 77, start: "1793000000", panePid: 4242, alive: true };
    const kills: string[] = [];
    const run: RunFn = (cmd, args) => {
      // Full-table ps (`ps -A -o pid=,lstart=`): by default the recorded pane process is listed.
      if (cmd === "ps") return { status: 0, stdout: ps ?? `    1 Mon Oct 26 09:00:00 2026\n ${recorded.pane_pid} ${recorded.pane_process_start}\n`, stderr: "" };
      if (args[0] === "list-panes") {
        if (listing) return { status: listing.status, stdout: "", stderr: listing.stderr };
        // A sibling pane %4 always lives on the answering server.
        const sibling = `${server.pid} ${server.start} %4 1111`;
        return { status: 0, stdout: (server.alive ? `${server.pid} ${server.start} %3 ${server.panePid}\n` : "") + `${sibling}\n`, stderr: "" };
      }
      if (args[0] === "display-message") return { status: 0, stdout: `${server.pid} ${server.start}\n`, stderr: "" };
      if (args[0] === "if-shell") {
        if (swapAtAction) server = { pid: 88, start: "1793000500", panePid: 5151, alive: true };
        const expected = String(args[4]).replace(/^#\{==:#\{pid\}\/#\{start_time\}\/#\{pane_pid\},/, "").replace(/\}$/, "");
        if (expected === `${server.pid}/${server.start}/${server.panePid}`) {
          kills.push(args[5]!);
          server.alive = false;
        }
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "unexpected" };
    };
    return { run, kills };
  }

  it("binds the kill server-side: a swap at the action kills nothing and stays unconfirmed", () => {
    const fake = fakeServer(true);
    const out = terminateBoundPane("%3", recorded, { run: fake.run, pollAttempts: 2 });
    expect(fake.kills).toEqual([]);
    expect(out).toMatchObject({ ok: false, confirmed: false, identity_check: "mismatch" });
  });

  it("confirms only after the recorded server reports the pane gone", () => {
    const fake = fakeServer(false);
    const out = terminateBoundPane("%3", recorded, { run: fake.run });
    expect(fake.kills).toEqual(["kill-pane -t %3"]);
    expect(out).toMatchObject({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("a failing pane query is never absence: unavailable, no kill, not confirmed", () => {
    const fake = fakeServer(false, { status: 1, stderr: "permission denied" });
    const out = terminateBoundPane("%3", recorded, { run: fake.run });
    expect(out).toMatchObject({ ok: false, confirmed: false, identity_check: "unavailable", degraded: false });
    expect(fake.kills).toEqual([]);
    const gone = fakeServer(false, { status: null, stderr: "" });
    expect(terminateBoundPane("%3", recorded, { run: gone.run })).toMatchObject({ ok: false, identity_check: "unavailable", degraded: true });
  });

  it("an ENOENT socket answer is never death: the recorded process still runs, so nothing is confirmed", () => {
    const fake = fakeServer(false, { status: 1, stderr: "error connecting to /private/tmp/tmux-501/guild (No such file or directory)\n" });
    const out = terminateBoundPane("%3", recorded, { run: fake.run, pollAttempts: 2 });
    expect(out).toMatchObject({ ok: false, confirmed: false });
    expect(fake.kills).toEqual([]);
  });

  it("no-server death needs a whole valid C-locale table: any bad, duplicate or invalid-date row confirms nothing", () => {
    const enoent = { status: 1, stderr: "error connecting to /private/tmp/tmux-501/guild (No such file or directory)\n" };
    const good = "    1 Mon Oct 26 09:00:00 2026\n";
    for (const ps of [
      "1 garbage\n",
      `${good}    7 garbage words\n`,
      `${good}    7 Mon Feb 30 09:00:00 2026\n`,
      `${good}    7 Tue Oct 26 09:00:00 2026\n`, // Oct 26 2026 is a Monday
      `${good}    7 Mon Oct 26 25:00:00 2026\n`,
      `${good}    1 Mon Oct 26 09:00:00 2026\n`, // duplicate pid
      `${good}\n    7 Mon Oct 26 09:00:00 2026\n`, // interior blank line
      `${good}    7\tMon Oct 26 09:00:00 2026\n`,
      `${good}    7 Mon Oct 26 09:00:00 2026\r\n`,
      `${good}    7 Mon\vOct 26 09:00:00 2026\n`, // VT collapsed by whitespace normalization
      `${good}    7 Mon Oct 26\f09:00:00 2026\n`,
      `${good}    7\vMon Oct 26 09:00:00 2026\n`,
      `${good}    7 Mon Oct 26 09:00:00 2026 \n`,
      "",
    ]) {
      const fake = fakeServer(false, enoent, ps);
      expect({ ps, out: terminateBoundPane("%3", recorded, { run: fake.run, pollAttempts: 1 }) }).toMatchObject({ ps, out: { ok: false, confirmed: false, identity_check: "unavailable" } });
      expect(fake.kills).toEqual([]);
    }
    // Positive: a whole valid table (pid 0 row, space-padded day) without the recorded pid proves it gone.
    const clean = fakeServer(false, enoent, "    0 Mon Oct  5 09:00:00 2026\n    1 Mon Oct 26 09:00:00 2026\n 9001 Tue Oct 27 10:00:00 2026\n");
    expect(terminateBoundPane("%3", recorded, { run: clean.run, pollAttempts: 1 })).toMatchObject({ ok: true, confirmed: true, identity_check: "verified" });
  });

  it("a no-server answer with a missing stream or a non-integer status is unknown, never a confirmed death", () => {
    const table = "    1 Mon Oct 26 09:00:00 2026\n"; // the recorded pid is absent: only no-server could confirm
    for (const listing of [
      { status: 1, stderr: "no server running on /private/tmp/tmux-501/guild\n" }, // stdout missing
      { status: 1, stdout: "", stderr: undefined },
      { status: Number.NaN, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\n" },
      { status: 1.5, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\n" },
    ]) {
      const kills: string[] = [];
      const run: RunFn = (cmd, args) => {
        if (cmd === "ps") return { status: 0, stdout: table, stderr: "" };
        if (args[0] === "list-panes") return listing as never;
        if (args[0] === "if-shell") kills.push(String(args[5]));
        return { status: 0, stdout: "", stderr: "" };
      };
      expect({ listing, out: terminateBoundPane("%3", recorded, { run, pollAttempts: 1 }) }).toMatchObject({ listing, out: { ok: false, confirmed: false } });
      expect(kills).toEqual([]);
    }
  });

  it("refuses a record whose server identity is not tmux-bound", () => {
    const fake = fakeServer(false);
    const out = terminateBoundPane("%3", { ...recorded, server_process_start: "Tue Oct 27 09:00:00 2026" }, { run: fake.run });
    expect(out).toMatchObject({ ok: false, identity_check: "unavailable" });
    expect(fake.kills).toEqual([]);
  });
});

describe("TmuxTaskCellWorkerPort spawn guards (fake tmux)", () => {
  interface Proc { pid: number; ppid: number; comm: string; args: string }
  function fixture(opts: {
    leak?: boolean; profileHash?: string; spawnOut?: string; procs?: () => Proc[];
    spawnStatus?: number | null; hasSession?: number | null; launchThrows?: boolean;
    /** The FIRST (pre-create) show-environment answer; later probes see the variable absent. */
    preCreateProbe?: { status: number | null; stdout: string; stderr: string };
    /** Every LATER (post-create) show-environment answer, when set. Typed loosely to model malformed transports. */
    postCreateProbe?: { status: unknown; stdout?: unknown; stderr?: unknown };
  } = {}) {
    let probes = 0;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-e00-l-port-"));
    dirs.push(root);
    const defAbs = path.join(root, "tooling-engineer.md");
    fs.writeFileSync(defAbs, "---\nname: tooling-engineer\n---\nrole body\n");
    const contentHash = `sha256:${createHash("sha256").update(fs.readFileSync(defAbs)).digest("hex")}`;
    const ref = {
      schema_version: "guild.project_definition_ref.v1", project_id: "plugin", layer: "project-guild", kind: "agent",
      id: "tooling-engineer", relative_path: ".guild/agents/tooling-engineer.md", content_hash: contentHash,
      source_commit: null, specialist_profile_hash: "p".repeat(64), specialist_type_hash: "t".repeat(64), skills: [],
    };
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv | undefined }> = [];
    const run: RunFn = (cmd, args, o) => {
      calls.push({ args: [cmd, ...args], env: (o as { env?: NodeJS.ProcessEnv } | undefined)?.env });
      if (cmd === "ps") {
        const procs = opts.procs?.() ?? [];
        if (args.includes("pid=,ppid=")) return { status: 0, stdout: procs.map((p) => `  ${p.pid}   ${p.ppid}`).join("\n") + "\n", stderr: "" };
        const p = procs.find((x) => String(x.pid) === args[args.length - 1]);
        if (args.includes("comm=")) return p ? { status: 0, stdout: `${p.comm}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "" };
        if (args.includes("args=")) return p ? { status: 0, stdout: `${p.args}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "" };
        // Full-table lstart read: the spawned pane process 9001 is listed.
        return { status: 0, stdout: "    1 Mon Oct 26 09:00:00 2026\n 9001 Tue Oct 27 10:00:00 2026\n", stderr: "" };
      }
      if (args[0] === "show-environment") {
        const index = probes++;
        if (index === 0 && opts.preCreateProbe) return opts.preCreateProbe;
        if (index > 0 && opts.postCreateProbe) return opts.postCreateProbe as never;
        return opts.leak
          ? { status: 0, stdout: "GUILD_RUN_BINDING_REF=x\n", stderr: "" }
          : { status: 1, stdout: "", stderr: "unknown variable: GUILD_RUN_BINDING_REF\n" };
      }
      if (args[0] === "has-session") return { status: opts.hasSession === undefined ? 1 : opts.hasSession, stdout: "", stderr: "" };
      if (args[0] === "new-session") {
        if (opts.spawnStatus !== undefined) return { status: opts.spawnStatus, stdout: "", stderr: "create failed" };
        return { status: 0, stdout: opts.spawnOut ?? "%9 9001 77 1793000000\n", stderr: "" };
      }
      if (args[0] === "list-panes") return { status: 0, stdout: "77 1793000000 %9 9001\n", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    const launches: Record<string, unknown>[] = [];
    const port = new TmuxTaskCellWorkerPort({
      cwd: root, sessionName: "guild-tc-test", snapshotDir: path.join(root, "launch"), ackArgv: ["node", "/pkg/task-cell-ack.js"],
      resolveDefinition: () => ({ ref: ref as never, definition_abs: defAbs }),
      receiptPath: () => path.join(root, "receipt.md"),
      recordLaunch: (_id, e) => {
        if (opts.launchThrows && (e as { state?: string }).state !== "identity_unknown") throw new Error("evidence disk full");
        launches.push(e);
      },
      run, pluginOwnerRoot: PLUGIN,
      // Source tests have no verified installed package; the activation itself is the
      // resolver's own concern and is exercised by the launcher suites.
      activate: () => ({ args: ["--plugin-dir", root], pluginRoot: root }),
      env: { ...process.env, GUILD_PLUGIN_ROOT: undefined, CLAUDE_PLUGIN_ROOT: undefined, GUILD_RUN_BINDING_REF: "secret-nonce", OTHER_BINDING_REF: "y" },
    });
    const instance = {
      instance_id: "T1.a1.i-1", run_id: "run-e00-l", logical_task_id: "T1", worker_role: "tooling-engineer",
      specialist_profile_hash: opts.profileHash ?? `sha256:${"p".repeat(64)}`, specialist_type_hash: "t".repeat(64),
      host_id: "claude-code-cli", model_id: null, projection: { tools: ["Read", "Write"], permissions: [], recorded_losses: [] },
    };
    const spawn = () => port.spawn({ instance_id: instance.instance_id, run_id: instance.run_id,
      assignment_path: ".guild/runs/run-e00-l/task-cells/T1/attempts/1/instances/T1.a1.i-1/assignment.json", instance: instance as never });
    return { root, defAbs, contentHash, calls, launches, port, spawn };
  }

  it("never forwards credential env to tmux and refuses a server that already holds it", () => {
    const f = fixture({ leak: true });
    const out = f.spawn();
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/credential_env_present_in_tmux_server/);
    for (const c of f.calls) {
      expect(c.env?.["GUILD_RUN_BINDING_REF"]).toBeUndefined();
      expect(c.env?.["OTHER_BINDING_REF"]).toBeUndefined();
    }
    expect(sanitizedWorkerEnv({ GUILD_RUN_BINDING_REF: "a", KEEP: "b" })).toEqual({ KEEP: "b" });
  });

  it("refuses a definition whose profile hash differs from the instance", () => {
    const f = fixture({ profileHash: "sha256:" + "0".repeat(64) });
    expect(f.spawn()).toEqual({ ok: false, reason: "definition_hash_mismatch", spawn_effect: "none" });
    expect(f.calls.some((c) => c.args[1] === "new-session")).toBe(false);
  });

  it("injects the exact hash-checked definition bytes and records forwarding evidence", () => {
    const f = fixture();
    const out = f.spawn();
    expect(out).toEqual({ ok: true, reason: null });
    const created = f.calls.find((c) => c.args[1] === "new-session")!;
    const command = created.args[created.args.length - 1]!;
    const snapshot = path.join(f.root, "launch", "T1.a1.i-1.definition.md");
    expect(command).toContain(`--append-system-prompt-file ${snapshot}`);
    expect(`sha256:${createHash("sha256").update(fs.readFileSync(snapshot)).digest("hex")}`).toBe(f.contentHash);
    expect(command).not.toContain("secret-nonce");
    expect(command).toContain(`export GUILD_TASK_ASSIGNMENT=${path.join(f.root, ".guild/runs/run-e00-l/task-cells/T1/attempts/1/instances/T1.a1.i-1/assignment.json")};`);
    expect(f.launches[0]).toMatchObject({
      definition_injection: { flag: "--append-system-prompt-file", path: snapshot },
      definition_carriage_verified: true,
      capability_scope: ["Read", "Write"],
      pane: { pane_id: "%9", pane_pid: 9001, server_pid: 77, server_process_start: `${TMUX_SERVER_START_PREFIX}1793000000` },
    });
    expect(f.port.paneIdentity("T1.a1.i-1")).toMatchObject({ pane_id: "%9" });
  });

  it("an unparseable spawn identity is refused and recorded durably, with no kill and no adoption", () => {
    const f = fixture({ spawnOut: "%9_9001_77_1793000000\n" });
    const out = f.spawn();
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/^spawn_identity_unavailable: a created pane may remain live and untracked/);
    expect(f.calls.some((c) => c.args[1] === "if-shell" || c.args[1] === "kill-pane")).toBe(false);
    expect(f.launches[0]).toMatchObject({ state: "identity_unknown", live_pane_may_remain: true, observed_spawn_output: "%9_9001_77_1793000000" });
    expect(f.port.paneIdentity("T1.a1.i-1")).toBeNull();
    expect(out.spawn_effect).toBe("unknown");
  });

  it("spawn_effect: none before the create is issued, unknown for every post-create failure", () => {
    // Pre-call: tmux did not run for the session probe, so nothing was created.
    const probe = fixture({ hasSession: null });
    expect(probe.spawn()).toMatchObject({ ok: false, spawn_effect: "none" });
    expect(probe.calls.some((c) => c.args[1] === "new-session" || c.args[1] === "new-window")).toBe(false);
    // Post-create: a nonzero create and a lost status are both unknown, and recorded.
    for (const status of [1, null]) {
      const f = fixture({ spawnStatus: status });
      const out = f.spawn();
      expect(out).toMatchObject({ ok: false, spawn_effect: "unknown" });
      expect(out.reason).toMatch(/^spawn_outcome_unknown: create /);
      expect(f.launches[0]).toMatchObject({ state: "identity_unknown", live_pane_may_remain: true });
      expect(f.calls.some((c) => c.args[1] === "if-shell" || c.args[1] === "kill-pane")).toBe(false);
    }
  });

  it("pre-create no-server is exact: a lone ENOENT line creates, a mixed or embedded one creates nothing", () => {
    const enoent = "error connecting to /private/tmp/tmux-501/guild (No such file or directory)";
    for (const probe of [
      { status: 1, stdout: "", stderr: `${enoent}\n` },
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\n" },
      { status: 2, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild" },
      { status: 1, stdout: "", stderr: "error connecting to /private/tmp/tést-üser/tmux-501/guild (No such file or directory)\n" }, // printable Unicode TMPDIR
    ]) {
      const ok = fixture({ preCreateProbe: probe });
      expect(ok.spawn()).toEqual({ ok: true, reason: null });
      expect(ok.calls.filter((c) => c.args[1] === "new-session")).toHaveLength(1);
    }
    for (const probe of [
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild (Permission denied)\n" },
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild junk\n" },
      { status: 1, stdout: "", stderr: "no server running on guild\n" },
      { status: 1, stdout: "", stderr: `${enoent} junk\n` },
      { status: 1, stdout: "\n", stderr: `${enoent}\n` },
      { status: 1, stdout: "", stderr: `${enoent}\n\n` }, // two trailing LFs: not one line
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\n\n" },
      { status: 1, stdout: "", stderr: `${enoent}\r` },
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\r" },
      { status: 1, stdout: "", stderr: `${enoent} ` },
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild \n" },
      { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/gu\u0001ild\n" }, // control byte in the path
      { status: 1, stdout: "", stderr: "error connecting to /private/tmp/tmux-501/gu\u007fild (No such file or directory)\n" },
      { status: 1, stdout: "", stderr: `Permission denied\n${enoent}\n` },
      { status: 1, stdout: "", stderr: `${enoent}\nno server running on /private/tmp/tmux-501/guild\n` },
      { status: 1, stdout: "GUILD_RUN_BINDING_REF=x\n", stderr: `${enoent}\n` },
      { status: 1, stdout: "", stderr: "error connecting to /private/tmp/tmux-501/guild (Permission denied)\n" },
      { status: 1, stdout: "", stderr: `junk ${enoent}\n` },
      { status: 0, stdout: "", stderr: `${enoent}\n` },
    ]) {
      const f = fixture({ preCreateProbe: probe });
      expect(f.spawn()).toMatchObject({ ok: false, spawn_effect: "none" });
      expect(f.calls.some((c) => c.args[1] === "new-session" || c.args[1] === "new-window")).toBe(false);
    }
  });

  it("credential probe shape: missing or non-string streams and an invalid status are never absence or no-server, and are never echoed", () => {
    const KEY = "GUILD_RUN_BINDING_REF";
    const canary = "probe-shape-canary-7f3a";
    const malformed: Array<Record<string, unknown>> = [
      { status: 1, stderr: `unknown variable: ${KEY}\n` }, // stdout missing
      { status: 0, stdout: `-${KEY}\n` }, // stderr missing
      { status: 1, stdout: null, stderr: `unknown variable: ${KEY}\n` },
      { status: 0, stdout: `-${KEY}\n`, stderr: 0 },
      { status: 1, stderr: "no server running on /private/tmp/tmux-501/guild\n" }, // no-server with stdout missing
      { status: `1 ${canary}`, stdout: "", stderr: `unknown variable: ${KEY}\n` }, // status as content
      { status: 1.5, stdout: "", stderr: `unknown variable: ${KEY}\n` },
      { status: undefined, stdout: "", stderr: "no server running on /private/tmp/tmux-501/guild\n" },
      { status: 0, stdout: `-${KEY}\n`, stderr: "Permission denied\n" }, // contradictory other stream
      { status: 0, stdout: ` -${KEY}\n`, stderr: "" }, // not trimmed into canonical
      { status: 0, stdout: `-${KEY}\n${KEY}=${canary}\n`, stderr: "" }, // ambiguous, carries a private-looking line
      { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\n${canary}\n` },
    ];
    for (const probe of malformed) {
      const f = fixture({ preCreateProbe: probe as never });
      const out = f.spawn();
      expect({ probe, out: { ok: out.ok, spawn_effect: out.spawn_effect } }).toEqual({ probe, out: { ok: false, spawn_effect: "none" } });
      expect(f.calls.some((c) => c.args[1] === "new-session" || c.args[1] === "new-window")).toBe(false);
      expect(JSON.stringify(out).includes(canary)).toBe(false);
    }
    // After the create, the same shapes are unknown with the identity retained and no verified launch.
    for (const probe of malformed.slice(0, 2)) {
      const f = fixture({ postCreateProbe: probe });
      const out = f.spawn();
      expect({ probe, out: { ok: out.ok, spawn_effect: out.spawn_effect }, verified: f.launches.some((l) => (l as { state?: string }).state !== "identity_unknown") })
        .toEqual({ probe, out: { ok: false, spawn_effect: "unknown" }, verified: false });
      expect(f.port.paneIdentity("T1.a1.i-1")).toMatchObject({ pane_id: "%9" });
    }
  });

  it("a verified spawn whose launch evidence fails is unknown and keeps the exact identity", () => {
    const f = fixture({ launchThrows: true });
    const out = f.spawn();
    expect(out).toMatchObject({ ok: false, spawn_effect: "unknown" });
    expect(out.reason).toMatch(/verified pane %9 spawned but launch evidence was not recorded/);
    expect(f.port.paneIdentity("T1.a1.i-1")).toMatchObject({ pane_id: "%9", pane_pid: 9001, server_pid: 77 });
  });

  it("ready only once the declared host process (its own injection argument) runs under the recorded pane", () => {
    let procs: Proc[] = [];
    const f = fixture({ procs: () => procs });
    expect(f.spawn().ok).toBe(true);
    const snapshot = path.join(f.root, "launch", "T1.a1.i-1.definition.md");
    const ready = () => f.port.ready({ instance_id: "T1.a1.i-1", run_id: "run-e00-l" });
    // The launch shell's -c string contains the argument but a shell never counts.
    procs = [{ pid: 9001, ppid: 1, comm: "/bin/bash", args: `bash -c export X=1; command claude --append-system-prompt-file ${snapshot} 'p'` }];
    expect(ready()).toMatchObject({ ok: false, reason: "declared host process not started under the recorded pane" });
    // A guard/helper child without the declared argument is not the host.
    procs = [...procs, { pid: 9002, ppid: 9001, comm: "sleep", args: "sleep 5" }];
    expect(ready().ok).toBe(false);
    // A process elsewhere carrying the argument is not under the recorded pane.
    procs = [...procs, { pid: 7000, ppid: 1, comm: "node", args: `node x --append-system-prompt-file ${snapshot}` }];
    expect(ready().ok).toBe(false);
    // A longer path that merely starts with the snapshot path does not match.
    procs = [...procs, { pid: 9003, ppid: 9001, comm: "node", args: `node x --append-system-prompt-file ${snapshot}.other` }];
    expect(ready().ok).toBe(false);
    procs = [...procs, { pid: 9004, ppid: 9001, comm: "node", args: `node /fixture.mjs --plugin-dir /r --append-system-prompt-file ${snapshot} prompt` }];
    expect(ready()).toEqual({ ok: true, reason: "declared host process observed (pid 9004, node)" });
  });
});

describe("TmuxTeamBackend child env and credential boundary (fake run / fake tmux)", () => {
  const KEY = "GUILD_RUN_BINDING_REF";
  const ALIAS = "OTHER_BINDING_REF";
  /** Set the parent binding (fixture canaries) plus a known PATH/LC_ALL for the duration of fn; restored after. */
  function withParent<T>(fn: () => T): { value: T; parent_kept: boolean } {
    const saved = { [KEY]: process.env[KEY], [ALIAS]: process.env[ALIAS], LC_ALL: process.env["LC_ALL"] };
    process.env[KEY] = "fixture-parent-binding"; process.env[ALIAS] = "fixture-alias"; process.env["LC_ALL"] = "en_US.UTF-8";
    try {
      const value = fn();
      return { value, parent_kept: process.env[KEY] === "fixture-parent-binding" && process.env[ALIAS] === "fixture-alias" };
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  }
  interface Call { cmd: string; args: string[]; o: Record<string, unknown> }
  /** A fake tmux/ps transport; `env` answers show-environment per stage. */
  function fakeRun(answer: { pre: { status: number; stdout: string; stderr: string }; post: { status: number; stdout: string; stderr: string } }) {
    const calls: Call[] = [];
    let created = false;
    const run: RunFn = (cmd, args, o = {}) => {
      calls.push({ cmd, args, o: o as Record<string, unknown> });
      if (cmd === "ps") return { status: 0, stdout: `    1 Mon Oct 26 09:00:00 2026\n ${process.pid} Tue Oct 27 10:00:00 2026\n`, stderr: "" };
      if (args[0] === "show-environment") return created ? answer.post : answer.pre;
      if (args[0] === "new-session") { created = true; return { status: 0, stdout: `$1 @1 77 1793000000\n`, stderr: "" }; }
      if (args[0] === "list-panes") return { status: 0, stdout: `77 1793000000 @1 %1 ${process.pid} orchestrator\n`, stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    };
    return { run, calls, created: () => created };
  }
  const plan = { mode: "new-session" as const, targetName: "team-x", commands: [
    { argv: ["tmux", "new-session", "-d", "-P", "-F", CREATE_IDENTITY_FORMAT, "-s", "team-x", "-n", "orchestrator", "sleep 1"], display: "create" },
    { argv: ["tmux", "select-pane", "-T", "orchestrator"], display: "title" },
  ] };
  const absent = { status: 1, stdout: "", stderr: `unknown variable: ${KEY}\n` };
  const hasKey = (env: unknown) => Object.keys((env ?? {}) as object).some((k) => /BINDING_REF$/.test(k));

  it("an injected run gets a sanitized clone for every subprocess; per-call env, PATH and LC_ALL are preserved; nothing supplied is mutated", () => {
    const supplied = { PATH: process.env["PATH"], [KEY]: "constructor-binding" };
    const suppliedCopy = JSON.stringify(supplied);
    const f = fakeRun({ pre: absent, post: absent });
    const r = withParent(() => {
      const backend = new TmuxTeamBackend({ run: f.run, env: supplied, pluginOwnerRoot: PLUGIN });
      backend.sessionExists("team-x");
      return backend.spawn(plan);
    });
    expect({ ok: r.value.ok, parent_kept: r.parent_kept, supplied_unchanged: JSON.stringify(supplied) === suppliedCopy }).toEqual({ ok: true, parent_kept: true, supplied_unchanged: true });
    expect(f.calls.length).toBeGreaterThan(3);
    for (const c of f.calls) {
      expect({ cmd: c.cmd, verb: c.args[0], env_given: c.o["env"] !== undefined, binding: hasKey(c.o["env"]) }).toEqual({ cmd: c.cmd, verb: c.args[0], env_given: true, binding: false });
      const env = c.o["env"] as NodeJS.ProcessEnv;
      expect(env["PATH"]).toBe(process.env["PATH"]);
      // ps keeps its own explicit C locale; every other child keeps the parent's locale.
      expect(env["LC_ALL"]).toBe(c.cmd === "ps" ? "C" : "en_US.UTF-8");
    }
    // Per-call options other than env survive (sessionExists passes stdio).
    expect(f.calls.find((c) => c.args[0] === "has-session")?.o["stdio"]).toEqual(["ignore", "ignore", "ignore"]);
  });

  it("the default run (no injected transport) hands no binding key to any tmux client", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-e00-l-client-"));
    dirs.push(dir);
    const log = path.join(dir, "client.log");
    fs.writeFileSync(path.join(dir, "tmux"), `#!/bin/sh\nfor k in ${KEY} ${ALIAS}; do eval "v=\\\${$k+set}"; echo "$1 $k=\${v:-unset}" >> ${log}; done\n[ "$1" = "-V" ] && echo "tmux 3.4 (fake)"\nexit 0\n`, { mode: 0o755 });
    const savedPath = process.env["PATH"];
    process.env["PATH"] = `${dir}:${savedPath ?? "/usr/bin:/bin"}`;
    try {
      const r = withParent(() => [probeTmuxAvailable(), tmuxServerIdentity(), new TmuxTeamBackend({ pluginOwnerRoot: PLUGIN }).isAvailable()]);
      const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
      expect({ ran: lines.length >= 6, any_set: lines.some((l) => l.endsWith("=set")), parent_kept: r.parent_kept }).toEqual({ ran: true, any_set: false, parent_kept: true });
    } finally {
      process.env["PATH"] = savedPath;
    }
  });

  it("an existing server holding the binding, or an ambiguous answer, refuses before any create; a clean or absent server proceeds", () => {
    for (const pre of [
      { status: 0, stdout: `${KEY}=held\n`, stderr: "" },
      { status: 0, stdout: `-${KEY}\n`, stderr: "Permission denied\n" },
      { status: 0, stdout: "", stderr: "" },
    ]) {
      const f = fakeRun({ pre, post: absent });
      const out = new TmuxTeamBackend({ run: f.run, pluginOwnerRoot: PLUGIN }).spawn(plan);
      expect({ pre: pre.stdout, ok: out.ok, created: f.created(), kills: f.calls.filter((c) => c.args[0] === "kill-server" || c.args[0] === "set-environment").length })
        .toEqual({ pre: pre.stdout, ok: false, created: false, kills: 0 });
    }
    for (const pre of [absent, { status: 1, stdout: "", stderr: "error connecting to /private/tmp/tmux-501/default (No such file or directory)\n" }]) {
      const f = fakeRun({ pre, post: absent });
      expect(new TmuxTeamBackend({ run: f.run, pluginOwnerRoot: PLUGIN }).spawn(plan).ok).toBe(true);
    }
  });

  it("an uncertain post-create answer is never success: the captured target gets the identity-bound cleanup and the capture is kept", () => {
    for (const post of [{ status: 0, stdout: `\n-${KEY}\n\n`, stderr: "" }, { status: 0, stdout: `${KEY}=x\n`, stderr: "" }, { status: 1, stdout: "", stderr: "no server running on /private/tmp/tmux-501/default\n" }]) {
      const f = fakeRun({ pre: absent, post });
      const backend = new TmuxTeamBackend({ run: f.run, pluginOwnerRoot: PLUGIN });
      const out = backend.spawn(plan);
      const capture = backend.takeSpawnCapture("team-x");
      expect({ post: post.stdout || post.stderr, ok: out.ok, creating_kept: capture?.creating?.session_id ?? null, cleanup_attempted: capture?.cleanup?.attempted ?? false,
        bound_cleanup: f.calls.some((c) => c.args[0] === "if-shell" && String(c.args[5]).startsWith("kill-session -t $1")) })
        .toEqual({ post: post.stdout || post.stderr, ok: false, creating_kept: "$1", cleanup_attempted: true, bound_cleanup: true });
    }
  });
});

describe("pane carrier validation gates --reap teardown (launcher reapTmuxOrphanByCarrier)", () => {
  const ids = { run_id: "run-e00-l-carrier", logical_task_id: "T1", attempt: 1, instance_id: "T1.a1.i1" };
  function carrierRoot(mutate?: (c: Record<string, any>) => void): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-e00-l-carrier-"));
    dirs.push(root);
    const c: Record<string, any> = {
      schema_version: PANE_IDENTITY_SCHEMA, ...ids, launch_id: "launch-1", created_at: "2026-10-28T03:00:00.000Z",
      creating_command: { verb: "new-session", session_id: "$1", window_id: "@1", server_pid: 77, server_process_start: `${TMUX_SERVER_START_PREFIX}1793000000` },
      pane: { pane_id: "%3", pane_pid: 4242, pane_process_start: "Tue Oct 27 10:00:00 2026", window_id: "@1", title: "backend--T1--a1" },
      shared_members: [{ logical_task_id: "T1", attempt: 1, instance_id: "T1.a1.i1", dispatch_key: "backend--T1--a1", specialist: "backend" }],
    };
    mutate?.(c);
    const file = paneIdentityCarrierPath(root, ids);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
    return root;
  }
  const spy = () => {
    const calls: string[] = [];
    const teardown = ((paneId: string) => {
      calls.push(paneId);
      return { ok: true, confirmed: true, identity_check: "verified", degraded: false, polls: 0, mechanism: "tmux kill-pane", paneId, error: null };
    }) as never;
    return { calls, teardown };
  };

  it("an incomplete or inconsistent carrier is never torn down", () => {
    const cases: Array<[string, (c: Record<string, any>) => void]> = [
      ["created_at absent", (c) => { delete c.created_at; }],
      ["created_at impossible", (c) => { c.created_at = "2026-13-45T99:99:99.000Z"; }],
      ["created_at not the writer's ISO form", (c) => { c.created_at = "2026-10-28 03:00:00"; }],
      ["verb absent", (c) => { delete c.creating_command.verb; }],
      ["verb not a create verb", (c) => { c.creating_command.verb = "kill-pane"; }],
      ["server start not numeric", (c) => { c.creating_command.server_process_start = `${TMUX_SERVER_START_PREFIX}abc`; }],
      ["server pid zero", (c) => { c.creating_command.server_pid = 0; }],
      ["pane pid zero", (c) => { c.pane.pane_pid = 0; }],
      ["pane start not a C-locale date", (c) => { c.pane.pane_process_start = "garbage"; }],
      ["pane start with a vertical tab separator (not writer-shaped)", (c) => { c.pane.pane_process_start = "Tue\u000bOct 27 10:00:00 2026"; }],
      ["pane start with a doubled space (not writer-shaped)", (c) => { c.pane.pane_process_start = "Tue Oct  27 10:00:00 2026"; }],
      ["launch_id whitespace only", (c) => { c.launch_id = "  "; }],
      ["title and member key whitespace only", (c) => { c.pane.title = " "; c.shared_members[0].dispatch_key = " "; }],
      ["member instance_id whitespace only", (c) => { c.shared_members[0].instance_id = "\t"; }],
      ["title empty", (c) => { c.pane.title = ""; c.shared_members[0].dispatch_key = ""; }],
      ["member dispatch key differs from the pane title", (c) => { c.shared_members[0].dispatch_key = "backend--T9--a1"; }],
      ["member specialist empty", (c) => { c.shared_members[0].specialist = ""; }],
      ["member attempt zero", (c) => { c.shared_members[0].attempt = 0; }],
    ];
    for (const [label, mutate] of cases) {
      const s = spy();
      expect({ label, out: reapTmuxOrphanByCarrier(carrierRoot(mutate), ids, s.teardown).kind }).toEqual({ label, out: "orphan" });
      expect({ label, calls: s.calls }).toEqual({ label, calls: [] });
    }
  });

  it("positive: the complete writer-shaped carrier (extra fields tolerated) reaches the identity-bound teardown", () => {
    for (const mutate of [undefined, (c: Record<string, any>) => { c.note = "extra"; }]) {
      const s = spy();
      expect(reapTmuxOrphanByCarrier(carrierRoot(mutate), ids, s.teardown).kind).toBe("sealable");
      expect(s.calls).toEqual(["%3"]);
    }
  });
});
