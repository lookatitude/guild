/**
 * E00-T0 · independent reds for the L r4 finding (review/G-lane-E00-L/result-r4.json,
 * implementation/e00/l-r4-triage-and-test-release.json), authored BEFORE any L r4 source change.
 *
 * L4-F1 the team backend's physical tmux subprocesses never carry the controller binding. With the
 *       parent holding GUILD_RUN_BINDING_REF and an alias *_BINDING_REF (test-owned canaries, or the
 *       fixture's own minted binding on the CLI path), a fresh owned server's global environment and
 *       every created pane process must hold neither key, while the parent keeps both (D1, D4).
 * Derived same boundary (D2, D3): an existing owned server whose global environment already holds a
 *       private binding key, or an ambiguous pre-create answer, refuses BEFORE any create without
 *       clearing that environment or killing the server; an uncertain post-create answer is never a
 *       success and keeps the creating capture. Clean existing and unbound launches still succeed;
 *       a --dry-run launch makes no tmux action.
 *
 * Physical path: the real TmuxTeamBackend with its default run (no injected transport) and the test
 * process PATH led by the owned tmux shim (isolated socket, PID+start ledger); injected answers only
 * for the ambiguous/uncertain cases, through the declared `run` option, counted and staged. Pane
 * processes report key PRESENCE (set/unset) into a marker file; no binding value is ever printed,
 * written to a diagnostic or compared other than as a boolean. No real model/API calls.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { CREATE_IDENTITY_FORMAT, TmuxTeamBackend, processStartOf } from "../../scripts/lib/host/tmux-backend";
import { loadRunBinding, mintRunBinding } from "../../src/domains/lifecycle";
import { PLUGIN, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const tmuxAvailable = resolveRealTmux() !== null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 6950;
const KEY = "GUILD_RUN_BINDING_REF";
const ALIAS = "E00_PARENT_BINDING_REF";

interface Env { root: string; bin: string; shim: TmuxShim; marker: string }
function env(prefix = "guild-e00-lr4-"): Env {
  const root = ownedTempDir(prefix);
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  return { root, bin, shim, marker: path.join(root, "pane-env.marker") };
}
const shimCalls = (e: Env) => (fs.existsSync(e.shim.callsLog) ? fs.readFileSync(e.shim.callsLog, "utf8").split("\n").filter(Boolean) : []);
const creates = (e: Env, from: number) => shimCalls(e).slice(from).filter((c) => c === "new-session" || c === "new-window").length;
const tmuxRun = (e: Env, args: string[]) => spawnSync(path.join(e.bin, "tmux"), args, { encoding: "utf8", env: { PATH: `${e.bin}:/usr/bin:/bin`, HOME: e.root } });

/** A pane command that records only whether each binding key is set, then stays alive. */
const reportingCmd = (e: Env) =>
  `sh -c 'for k in ${KEY} ${ALIAS}; do eval "v=\\\${$k+set}"; echo "$k=\${v:-unset}" >> ${e.marker}; done; exec sleep ${++seq}'`;
function markerOf(e: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of fs.existsSync(e.marker) ? fs.readFileSync(e.marker, "utf8").split("\n").filter(Boolean) : []) {
    const [k, v] = l.split("=");
    if (k) out[k] = v ?? "";
  }
  return out;
}
async function waitMarker(e: Env, n: number) {
  for (let i = 0; i < 100 && Object.keys(markerOf(e)).length < n; i++) await sleep(30);
}
/** Whether the owned server's GLOBAL environment holds `key` (presence only). */
const serverHas = (e: Env, key: string) => {
  const r = tmuxOn(e.shim, ["show-environment", "-g", key]);
  return r.status === 0 && r.stdout.startsWith(`${key}=`);
};

/** Run `fn` with the parent process env holding canaries and PATH led by the owned shim; restored after. */
function withParent<T>(e: Env, bound: boolean, fn: (canaries: { key: string; alias: string }) => T): { value: T; parent_kept: boolean } {
  const saved = { PATH: process.env["PATH"], TMUX: process.env["TMUX"], TMUX_PANE: process.env["TMUX_PANE"], [KEY]: process.env[KEY], [ALIAS]: process.env[ALIAS] };
  const canaries = { key: `e00-canary-${crypto.randomBytes(8).toString("hex")}`, alias: `e00-canary-${crypto.randomBytes(8).toString("hex")}` };
  process.env["PATH"] = `${e.bin}:${saved.PATH ?? "/usr/bin:/bin"}`;
  delete process.env["TMUX"]; delete process.env["TMUX_PANE"];
  if (bound) { process.env[KEY] = canaries.key; process.env[ALIAS] = canaries.alias; } else { delete process.env[KEY]; delete process.env[ALIAS]; }
  try {
    const value = fn(canaries);
    const parent_kept = bound ? process.env[KEY] === canaries.key && process.env[ALIAS] === canaries.alias : process.env[KEY] === undefined;
    return { value, parent_kept };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const newSessionPlan = (e: Env, name: string) => ({
  mode: "new-session" as const, targetName: name,
  commands: [{ argv: ["tmux", "new-session", "-d", "-P", "-F", CREATE_IDENTITY_FORMAT, "-s", name, "-n", "orchestrator", reportingCmd(e)], display: "create" }],
});
/** An owned holder server started WITHOUT any binding (explicit clean env). */
function cleanHolder(e: Env): { pid: number; start: string } {
  const r = spawnSync(path.join(e.bin, "tmux"), ["new-session", "-d", "-P", "-F", "#{pane_pid}", "-s", "holder", `sleep ${++seq}`], { encoding: "utf8", env: { PATH: `${e.bin}:/usr/bin:/bin`, HOME: e.root } });
  if (r.status !== 0) throw new Error("fixture: holder not created");
  const pid = Number(r.stdout.trim());
  return { pid, start: processStartOf(pid)! };
}
const alive = (p: { pid: number; start: string }) => processStartOf(p.pid) === p.start;

// ── L4-F1 · the default-run physical path ──

describe.skipIf(!tmuxAvailable)("L4-F1 · a fresh server created by the team backend never inherits the parent binding", () => {
  it("default run, no server yet, parent holds the binding and an alias: neither the server env nor the pane process holds either key; the parent keeps both", async () => {
    const e = env();
    const base = shimCalls(e).length;
    const r = withParent(e, true, () => new TmuxTeamBackend().spawn(newSessionPlan(e, "team-a")));
    await waitMarker(e, 2);
    // Preconditions: the real create ran on the owned socket and the pane reported.
    expect({ created: creates(e, base), ok: r.value.ok, reported: Object.keys(markerOf(e)).length }).toEqual({ created: 1, ok: true, reported: 2 });
    expect({ server_key: serverHas(e, KEY), server_alias: serverHas(e, ALIAS), pane: markerOf(e), parent_kept: r.parent_kept })
      .toEqual({ server_key: false, server_alias: false, pane: { [KEY]: "unset", [ALIAS]: "unset" }, parent_kept: true });
  });

  it("control: an unbound parent launches normally (ok, pane created, nothing set)", async () => {
    const e = env();
    const base = shimCalls(e).length;
    const r = withParent(e, false, () => new TmuxTeamBackend().spawn(newSessionPlan(e, "team-b")));
    await waitMarker(e, 2);
    expect({ ok: r.value.ok, created: creates(e, base), pane: markerOf(e), server_key: serverHas(e, KEY) })
      .toEqual({ ok: true, created: 1, pane: { [KEY]: "unset", [ALIAS]: "unset" }, server_key: false });
  });

  it("anti-vacuity: the reporting pane does detect a key that IS set in its environment", async () => {
    const e = env();
    cleanHolder(e);
    expect(tmuxOn(e.shim, ["set-environment", "-g", ALIAS, "fixture"]).status).toBe(0);
    const r = withParent(e, false, () => new TmuxTeamBackend().spawn({ ...newSessionPlan(e, "team-c") }));
    await waitMarker(e, 2);
    expect({ ok: r.value.ok, alias_seen: markerOf(e)[ALIAS] }).toEqual({ ok: true, alias_seen: "set" });
  });
});

// ── derived same boundary (D2, D3) ──

describe.skipIf(!tmuxAvailable)("L4-F1 derived · existing-server and post-create credential semantics on the team path", () => {
  it("an existing owned server whose global env holds a private binding key: refused before create; that env is not cleared and the server lives", () => {
    const e = env();
    const holder = cleanHolder(e);
    expect(tmuxOn(e.shim, ["set-environment", "-g", KEY, "fixture-private"]).status).toBe(0);
    const base = shimCalls(e).length;
    const r = withParent(e, false, () => new TmuxTeamBackend().spawn(newSessionPlan(e, "team-d")));
    expect({ ok: r.value.ok, created: creates(e, base), server_env_kept: serverHas(e, KEY), holder_alive: alive(holder) })
      .toEqual({ ok: false, created: 0, server_env_kept: true, holder_alive: true });
  });

  it("an ambiguous pre-create environment answer (status 0 '-KEY' with 'Permission denied' stderr): refused before create", () => {
    const e = env();
    cleanHolder(e);
    const base = shimCalls(e).length;
    let injected = 0;
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "tmux" && args[0] === "show-environment" && creates(e, base) === 0) { injected++; return { status: 0, stdout: `-${KEY}\n`, stderr: "Permission denied\n" }; }
      const x = spawnSync(cmd === "tmux" ? path.join(e.bin, "tmux") : cmd, args, { encoding: "utf8", ...o } as never);
      return { status: x.status, stdout: (x.stdout as unknown as string) ?? "", stderr: (x.stderr as unknown as string) ?? "" };
    };
    const r = withParent(e, false, () => new TmuxTeamBackend({ run }).spawn(newSessionPlan(e, "team-e")));
    expect({ ok: r.value.ok, created: creates(e, base), probe_reached: injected > 0 }).toEqual({ ok: false, created: 0, probe_reached: true });
  });

  it("an uncertain post-create environment answer: never a success, and the creating capture is retained", () => {
    const e = env();
    cleanHolder(e);
    const base = shimCalls(e).length;
    let injected = 0;
    const run = (cmd: string, args: string[], o: Record<string, unknown> = {}) => {
      if (cmd === "tmux" && args[0] === "show-environment" && creates(e, base) > 0) { injected++; return { status: 0, stdout: `\n-${KEY}\n\n`, stderr: "" }; }
      const x = spawnSync(cmd === "tmux" ? path.join(e.bin, "tmux") : cmd, args, { encoding: "utf8", ...o } as never);
      return { status: x.status, stdout: (x.stdout as unknown as string) ?? "", stderr: (x.stderr as unknown as string) ?? "" };
    };
    const backend = new TmuxTeamBackend({ run });
    const r = withParent(e, false, () => backend.spawn(newSessionPlan(e, "team-f")));
    const capture = backend.takeSpawnCapture("team-f");
    expect({ created: creates(e, base) }).toEqual({ created: 1 });
    expect({ ok: r.value.ok, post_probe_reached: injected > 0, creating_retained: capture?.creating != null }).toEqual({ ok: false, post_probe_reached: true, creating_retained: true });
  });

  it("control: an existing clean owned server (binding absent) still launches", () => {
    const e = env();
    cleanHolder(e);
    const base = shimCalls(e).length;
    const r = withParent(e, false, () => new TmuxTeamBackend().spawn(newSessionPlan(e, "team-g")));
    expect({ ok: r.value.ok, created: creates(e, base) }).toEqual({ ok: true, created: 1 });
  });
});

// ── the real launcher CLI ──

const PKG = process.env["E00_TA_ACTIVATION_PACKAGE"] ?? "";
const pkgPresent = PKG.length > 0 && path.isAbsolute(PKG) && fs.existsSync(path.join(PKG, ".claude-plugin", "plugin.json"));
const PRELOAD = path.join(__dirname, "support", "e00-launcher-preload.ts");
const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";
const RUN = "run-20261028-000000-e00-lr4";
const TASKS = ["architect", "backend", "qa"];

function cliFixture(e: Env): string {
  fs.mkdirSync(path.join(e.root, ".guild", "team"), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN, "scripts", "fixtures", "team-agent-team.yaml"), path.join(e.root, ".guild", "team", "e00-lr4.yaml"));
  fs.mkdirSync(path.join(e.root, ".guild", "runs", RUN), { recursive: true });
  fs.writeFileSync(path.join(e.root, ".guild", "runs", "current-run-id"), `${RUN}\n`);
  mintRunBinding({ root: e.root, run_id: RUN });
  fs.writeFileSync(path.join(e.root, ".guild", "runs", RUN, "session-binding.json"), JSON.stringify({
    schema_version: "guild.session_binding.v1", run_id: RUN, host_family: "claude-code-cli", surface: "cli", detected_at: new Date().toISOString(),
    models: { cheap: "haiku", mid: "sonnet", powerful: "opus" }, model_family: "claude", prompt_compose: { dialect_id: "claude", overlay_ids: [], hash: "sha256:x" },
    evidence: { cheap: "available", mid: "available", powerful: "available" },
  }, null, 2) + "\n");
  const ctx = path.join(e.root, ".guild", "context", RUN);
  fs.mkdirSync(ctx, { recursive: true });
  for (const t of TASKS) fs.writeFileSync(path.join(ctx, `${t}-${t}.md`), `# ${t}\n`);
  // The host stub reports only key presence, then stays alive (no model/API call).
  fs.writeFileSync(path.join(e.bin, "claude"), `#!/bin/sh\nfor k in ${KEY} ${ALIAS}; do eval "v=\\\${$k+set}"; echo "$k=\${v:-unset}" >> ${e.marker}; done\nexec sleep ${++seq}\n`, { mode: 0o755 });
  return loadRunBinding({ root: e.root, run_id: RUN })!.binding_ref;
}

describe.skipIf(!tmuxAvailable || !pkgPresent)("L4-F1 · the real launcher CLI never hands its run binding to tmux", () => {
  it("new-session launch with the run's own binding in the launcher env: records written, no pane holds either key, the binding record unchanged", async () => {
    const e = env();
    const bindingRef = cliFixture(e);
    const bindingFile = path.join(e.root, ".guild", "runs", RUN, "binding.json");
    const statOf = (f: string) => { if (!fs.existsSync(f)) return null; const s = fs.statSync(f); return `${s.size}/${s.mtimeMs}/${s.ino}`; };
    const before = statOf(bindingFile);
    expect(before !== null).toBe(true);
    const base = shimCalls(e).length;
    const r = spawnSync(BUN, ["--preload", PRELOAD, path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), "--team", path.join(e.root, ".guild", "team", "e00-lr4.yaml"), "--cwd", e.root, "--run-id", RUN], {
      cwd: e.root, encoding: "utf8", timeout: 180000,
      env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, SHELL: fs.existsSync("/bin/zsh") ? "/bin/zsh" : "/bin/sh", LANG: "en_US.UTF-8",
        GUILD_DISPATCH_APPROVAL_OVERRIDE: "E00-T0 r4 fixture: approval verification is pinned separately",
        E00_ACTIVATION_STUB_ROOT: PKG, [KEY]: bindingRef, [ALIAS]: "e00-alias-canary" },
    });
    await waitMarker(e, 2);
    const cells = path.join(e.root, ".guild", "runs", RUN, "task-cells");
    // Preconditions: the real CLI created panes on the owned socket and the host stubs reported.
    expect({ created: creates(e, base) > 0, reported: Object.keys(markerOf(e)).length >= 2, records_written: fs.existsSync(cells) && fs.readdirSync(cells).length === TASKS.length })
      .toEqual({ created: true, reported: true, records_written: true });
    expect({ pane: markerOf(e), binding_record_unchanged: statOf(bindingFile) === before, exit_recorded: typeof r.status === "number" })
      .toEqual({ pane: { [KEY]: "unset", [ALIAS]: "unset" }, binding_record_unchanged: true, exit_recorded: true });
  }, 240_000);

  it("control: --dry-run with the binding in the launcher env makes no tmux create", () => {
    const e = env();
    const bindingRef = cliFixture(e);
    const base = shimCalls(e).length;
    spawnSync(BUN, ["--preload", PRELOAD, path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), "--team", path.join(e.root, ".guild", "team", "e00-lr4.yaml"), "--cwd", e.root, "--run-id", RUN, "--dry-run"], {
      cwd: e.root, encoding: "utf8", timeout: 180000,
      env: { PATH: `${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root, GUILD_DISPATCH_APPROVAL_OVERRIDE: "E00-T0 r4 fixture", E00_ACTIVATION_STUB_ROOT: PKG, [KEY]: bindingRef },
    });
    expect({ creates: creates(e, base), marker: fs.existsSync(e.marker) }).toEqual({ creates: 0, marker: false });
  }, 240_000);
});
