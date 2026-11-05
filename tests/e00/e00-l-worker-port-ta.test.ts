/**
 * E00-T0 · independent E00-L checks of TmuxTaskCellWorkerPort on a REAL,
 * test-owned tmux server (POST-FIX authored after L's source freeze; not
 * red-before). Plan items M2, M3, M4, M6, M7.
 *
 * Mechanics only: the port is constructed through its declared source seam with
 * (a) `run` routing every tmux call through the test-owned shim (isolated root
 * socket, ledger ownership, fail-closed teardown), (b) an EXPLICITLY DECLARED
 * activation stub (`activate`) because a source checkout is refused activation
 * (L Q4), and (c) a test-owned `claude` on PATH (tc/claude-fixture.mjs) that
 * records only digests, booleans and allowlisted public specialist metadata.
 * The definition is a legitimate test-owned adoption (support/adopted-definition.ts)
 * resolved by L's own resolveAdoptedDefinition. No real Claude, host, model,
 * package or qualification claim.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { TmuxTaskCellWorkerPort, processStartOf } from "../../scripts/lib/host/tmux-backend";
import type { RunFn } from "../../scripts/lib/team-backend";
import { resolveAdoptedDefinition } from "../../scripts/task-cell-controller";
import { ownedTempDir, teardownOwned } from "./support/e00-harness";
import { TEST_PROFILE_HASH, TEST_TYPE_HASH, adoptDefinition } from "./support/adopted-definition";
import { installTmuxShim, resolveRealTmux, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const RUN = "run-e00-lport";
const CLAUDE_FIXTURE = path.join(__dirname, "tc", "claude-fixture.mjs");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fx {
  root: string; bin: string; shim: TmuxShim; port: TmuxTaskCellWorkerPort; launches: Map<string, Record<string, any>>;
  adopted: ReturnType<typeof adoptDefinition>; assignmentRel: string; spawnCalls: () => number;
}

function fixture(opts: { mode?: "normal" | "exit"; resolve?: (root: string) => any; locale?: Record<string, string>; shell?: string; hostBody?: string; wrapRun?: (run: RunFn) => RunFn } = {}): Fx {
  const root = ownedTempDir("guild-e00-lport-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const adopted = adoptDefinition(root, "backend");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  fs.writeFileSync(path.join(bin, "claude"), opts.hostBody ?? `#!/bin/sh\nexec "${process.execPath.includes("bun") ? "node" : process.execPath}" "${CLAUDE_FIXTURE}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, ".claude-fixture-mode"), opts.mode ?? "normal");
  const assignmentRel = `.guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1/assignment.json`;
  fs.mkdirSync(path.dirname(path.join(root, assignmentRel)), { recursive: true });
  fs.writeFileSync(path.join(root, assignmentRel), "{\"schema_version\":\"guild.task_assignment.v2\"}\n");
  const stubPlugin = path.join(root, ".stub-plugin");
  fs.mkdirSync(stubPlugin);
  const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
    const r = spawnSync(cmd === "tmux" ? path.join(bin, "tmux") : cmd, args, { encoding: "utf8", timeout: 20000, ...o } as never);
    return { status: r.status, stdout: (r.stdout as unknown as string) ?? "", stderr: (r.stderr as unknown as string) ?? "" };
  };
  const launches = new Map<string, Record<string, any>>();
  const port = new TmuxTaskCellWorkerPort({
    cwd: root,
    sessionName: "e00-lport",
    snapshotDir: path.join(root, ".guild", "runs", RUN, "controller", "launch"),
    resolveDefinition: (inst) => (opts.resolve ? opts.resolve(root) : resolveAdoptedDefinition(root, inst.worker_role)),
    receiptPath: (inst) => path.join(root, ".guild", "runs", RUN, "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(root, "task-cell-ack.js")],
    recordLaunch: (iid, ev) => launches.set(iid, ev),
    run: opts.wrapRun ? opts.wrapRun(run) : run,
    // Credential env the port must strip before any tmux client, server or pane sees it.
    env: {
      PATH: `${bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? root, SHELL: opts.shell ?? (fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh"),
      ...(opts.locale ?? { LANG: "en_US.UTF-8" }),
      GUILD_RUN_BINDING_REF: "e00-test-binding-secret", OTHER_BINDING_REF: "x",
    },
    // DECLARED activation stub: a source checkout is refused real activation (L Q4).
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
  });
  const spawnCalls = () => (fs.existsSync(shim.callsLog) ? fs.readFileSync(shim.callsLog, "utf8").split("\n").filter((l) => l === "new-session" || l === "new-window").length : 0);
  return { root, bin, shim, port, launches, adopted, assignmentRel, spawnCalls };
}

function instance(over: Record<string, unknown> = {}): any {
  return {
    instance_id: "i1", run_id: RUN, logical_task_id: "T1", worker_role: "backend", host_id: "claude-code-cli",
    specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null, ...over,
  };
}

const spawn = (f: Fx, inst = instance()) => f.port.spawn({ instance_id: inst.instance_id, run_id: RUN, assignment_path: f.assignmentRel, instance: inst } as never);

async function fixtureRecord(f: Fx, limitMs = 15000): Promise<Record<string, any>> {
  const file = path.join(f.root, ".claude-fixture.json");
  const until = Date.now() + limitMs;
  while (Date.now() < until && !fs.existsSync(file)) await sleep(50);
  if (!fs.existsSync(file)) throw new Error("claude fixture never ran inside the pane");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const tmuxAvailable = resolveRealTmux() !== null;

describe.skipIf(!tmuxAvailable)("M7 · definition refusals happen before any pane exists", () => {
  const refusals: Array<[string, (f: Fx) => any, RegExp]> = [
    ["a non-Claude registry host", () => instance({ host_id: "codex-cli" }), /^host_unsupported/],
    ["a worker role other than the adopted ref id", () => instance({ worker_role: "frontend" }), /^definition_(unresolved|hash_mismatch)/],
    ["a profile hash other than the adopted ref's", () => instance({ specialist_profile_hash: `sha256:${"e".repeat(64)}` }), /^definition_hash_mismatch/],
    ["a type hash other than the adopted ref's", () => instance({ specialist_type_hash: `sha256:${"e".repeat(64)}` }), /^definition_hash_mismatch/],
  ];
  for (const [label, inst, reason] of refusals) {
    it(`refuses ${label} with no pane and no snapshot`, () => {
      const f = fixture();
      const out = f.port.spawn({ instance_id: "i1", run_id: RUN, assignment_path: f.assignmentRel, instance: inst(f) } as never);
      expect(out.ok).toBe(false);
      expect(String(out.reason)).toMatch(reason);
      expect(f.spawnCalls()).toBe(0);
      expect(f.launches.size).toBe(0);
    });
  }

  it("refuses definition bytes edited after adoption (content hash mismatch) with no pane", () => {
    const f = fixture();
    fs.appendFileSync(f.adopted.abs, "tampered\n");
    const out = spawn(f);
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toMatch(/^definition_(bytes_mismatch|unresolved)/);
    expect(f.spawnCalls()).toBe(0);
  });

  it("refuses an unresolvable definition (no committed adoption) with no pane", () => {
    const f = fixture({ resolve: () => ({ error: "capability_absent: no committed manifest" }) });
    const out = spawn(f);
    expect(out).toMatchObject({ ok: false });
    expect(String(out.reason)).toMatch(/^definition_unresolved/);
    expect(f.spawnCalls()).toBe(0);
  });
});

describe.skipIf(!tmuxAvailable)("M6 / M4 / M3 · a spawned pane receives the exact adopted bytes, an absolute assignment and no credential", () => {
  it("M6: Claude receives --append-system-prompt-file whose bytes hash to the adopted content_hash; the launch plan declares the same", async () => {
    const f = fixture();
    expect(spawn(f)).toEqual({ ok: true, reason: null });
    const rec = await fixtureRecord(f);
    expect(rec.append_system_prompt_file_present).toBe(true);
    expect(rec.append_system_prompt_file_absolute).toBe(true);
    expect(rec.append_system_prompt_file_sha256).toBe(f.adopted.sha256);
    expect(rec.append_system_prompt_file_sha256).toBe(f.adopted.ref.content_hash.slice(f.adopted.ref.content_hash.startsWith("sha256:") ? "sha256:".length : 0));
    const ev = f.launches.get("i1")!;
    expect(ev.definition_injection).toMatchObject({ flag: "--append-system-prompt-file", sha256: f.adopted.sha256 });
    expect(ev.definition_injection.path).toBe(rec.append_system_prompt_file_path);
    expect(sha(fs.readFileSync(ev.definition_injection.path))).toBe(f.adopted.sha256);
    // The carried ref (env) names the same content hash; recorded as a digest only.
    expect(rec.definition_ref_env_content_hash).toBe(f.adopted.ref.content_hash);
    expect(rec.definition_ref_env_public).toEqual({ kind: "agent", id: "backend", specialist_profile_hash: TEST_PROFILE_HASH, specialist_type_hash: TEST_TYPE_HASH });
  });

  it("M4: the pane gets an absolute GUILD_TASK_ASSIGNMENT, starts at the root, and carries no *BINDING_REF credential", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    const rec = await fixtureRecord(f);
    expect(rec.assignment_env_absolute).toBe(true);
    expect(rec.assignment_env_matches_expected_sha).toBe(sha(path.join(f.root, f.assignmentRel)));
    expect(rec.cwd_realpath_sha).toBe(sha(fs.realpathSync(f.root)));
    expect(rec.binding_ref_keys_present).toBe(0);
    const ev = f.launches.get("i1")!;
    expect(path.isAbsolute(ev.assignment_path)).toBe(true);
    expect(ev.credential_env_removed.sort()).toEqual(["GUILD_RUN_BINDING_REF", "OTHER_BINDING_REF"]);
  });

  it("M4: notifyAssignment resolves the relative assignment to an absolute path; a missing assignment is refused", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    expect(f.port.notifyAssignment({ instance_id: "i1", run_id: RUN, assignment_path: f.assignmentRel }).ok).toBe(true);
    const missing = f.port.notifyAssignment({ instance_id: "i1", run_id: RUN, assignment_path: ".guild/runs/x/none.json" });
    expect(missing).toMatchObject({ ok: false, reason: "assignment not on disk" });
  });

  it("M3: ready() is true only after the launch handed off to the host process", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    const until = Date.now() + 10000;
    let r = f.port.ready({ instance_id: "i1", run_id: RUN });
    while (!r.ok && Date.now() < until) { await sleep(100); r = f.port.ready({ instance_id: "i1", run_id: RUN }); }
    expect({ ok: r.ok, reason: r.reason }).toMatchObject({ ok: true });
    expect(f.port.ready({ instance_id: "other", run_id: RUN })).toMatchObject({ ok: false });
  });

  it("M3 control: a host process that exits immediately is never ready (recorded pane gone)", async () => {
    const f = fixture({ mode: "exit" });
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    // The host exits ~1s after start; wait for the recorded pane to be gone.
    let r = f.port.ready({ instance_id: "i1", run_id: RUN });
    for (let i = 0; i < 100 && !/not present/.test(String(r.reason)); i++) { await sleep(100); r = f.port.ready({ instance_id: "i1", run_id: RUN }); }
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/not present/);
  });
});

describe.skipIf(!tmuxAvailable)("M3 refusal · a host that exits before pane identity capture", () => {
  it("is refused as spawn_identity_unavailable: no recorded identity, never ready, only an identity_unknown launch record", async () => {
    // Deterministic, not timed: the host exits at once, and the first process-table read
    // after the create is held until that pane process is gone.
    let panePid = 0;
    let held = false;
    const f = fixture({
      hostBody: "#!/bin/sh\nexit 0\n",
      wrapRun: (run) => (cmd, args, o) => {
        if (cmd === "ps" && panePid > 0 && !held) {
          held = true;
          const end = Date.now() + 10000;
          const gone = () => { try { process.kill(panePid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === "ESRCH"; } };
          while (Date.now() < end && !gone()) spawnSync("sleep", ["0.05"]);
        }
        const r = run(cmd, args, o);
        if (cmd === "tmux" && (args[0] === "new-session" || args[0] === "new-window") && r.status === 0) panePid = Number(r.stdout.trim().split(" ")[1]);
        return r;
      },
    });
    // A long-lived owned session keeps the shim's server (and its recorded identity) up after the pane dies.
    expect(spawnSync(path.join(f.bin, "tmux"), ["new-session", "-d", "-s", "keep", "sleep 600"]).status).toBe(0);
    const out = spawn(f) as { ok: boolean; reason: string; spawn_effect?: string };
    expect({ held, pane_pid_seen: panePid > 0 }).toEqual({ held: true, pane_pid_seen: true });
    expect({ ok: out.ok, spawn_effect: out.spawn_effect }).toEqual({ ok: false, spawn_effect: "unknown" });
    expect(out.reason).toStartWith("spawn_identity_unavailable: a created pane may remain live and untracked");
    expect(f.port.paneIdentity("i1")).toBeNull();
    expect(f.port.ready({ instance_id: "i1", run_id: RUN })).toEqual({ ok: false, reason: "no recorded pane for this instance" });
    // Nothing is sealed as a verified launch: the only record is the identity_unknown observation.
    expect(f.launches.get("i1")?.state).toBe("identity_unknown");
    expect(f.launches.get("i1")?.live_pane_may_remain).toBe(true);
  });
});

describe.skipIf(!tmuxAvailable)("L routing finding · spawn under the C locale (tmux rewrites the -F tab to '_')", () => {
  it("a spawn whose pane identity cannot be parsed must not leave a live untracked pane", async () => {
    const f = fixture({ locale: { LC_ALL: "C" } });
    const out = spawn(f);
    const panes = spawnSync(f.shim.realTmux, ["-S", f.shim.socket, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" });
    const live = panes.status === 0 ? panes.stdout.split("\n").filter(Boolean) : [];
    if (out.ok) {
      expect(f.port.paneIdentity("i1")).not.toBeNull();
    } else {
      expect(live).toEqual([]);
    }
  });
});

describe.skipIf(!tmuxAvailable)("L routing finding · ready() under a bash default shell", () => {
  it("a launched host under SHELL=/bin/bash is observed ready (the launch shell hands off)", async () => {
    const f = fixture({ shell: "/bin/bash" });
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    const until = Date.now() + 5000;
    let r = f.port.ready({ instance_id: "i1", run_id: RUN });
    while (!r.ok && Date.now() < until) { await sleep(100); r = f.port.ready({ instance_id: "i1", run_id: RUN }); }
    expect({ ok: r.ok, reason: r.reason }).toMatchObject({ ok: true });
  });
});

describe.skipIf(!tmuxAvailable)("M2 · port terminate is identity-bound against the real server", () => {
  it("control: terminate kills the recorded pane (verified, confirmed)", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    const id = f.port.paneIdentity("i1")!;
    expect(f.port.terminate({ instance_id: "i1", run_id: RUN, reason: "test" })).toEqual({ ok: true, reason: null });
    expect(processStartOf(id.pane_pid)).toBeNull();
  });

  it("a replacement server on the same socket is never killed; terminate is unconfirmed (mismatch)", async () => {
    const f = fixture();
    expect(spawn(f).ok).toBe(true);
    await fixtureRecord(f);
    const id = f.port.paneIdentity("i1")!;
    // Test-side only, on the test-owned socket: end the recorded server, start an unowned replacement.
    spawnSync(f.shim.realTmux, ["-S", f.shim.socket, "kill-server"]);
    const repl = spawnSync(f.shim.realTmux, ["-S", f.shim.socket, "-f", "/dev/null", "new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", "repl", "sleep 6021"], { encoding: "utf8" });
    // Space, not tab: under the C locale tmux rewrites a tab in -F output to "_".
    const [, replPid] = repl.stdout.trim().split(" ");
    const replStart = processStartOf(Number(replPid));
    try {
      expect(replStart).not.toBeNull();
      const out = f.port.terminate({ instance_id: "i1", run_id: RUN, reason: "test" });
      expect(out.ok).toBe(false);
      expect(String(out.reason)).toMatch(/mismatch|unavailable/);
      expect(processStartOf(Number(replPid))).toBe(replStart);
      expect(id.server_pid).not.toBe(Number(spawnSync(f.shim.realTmux, ["-S", f.shim.socket, "display-message", "-p", "#{pid}"], { encoding: "utf8" }).stdout.trim()));
    } finally {
      spawnSync(f.shim.realTmux, ["-S", f.shim.socket, "kill-server"]);
    }
  });
});
