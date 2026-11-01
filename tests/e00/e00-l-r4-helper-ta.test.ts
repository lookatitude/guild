/**
 * E00-T0 · supplement to the frozen L r4 reds (implementation/e00/l-r4-env-boundary-decisions.json,
 * helper_defaults + pure_preview), the same L4-F1 boundary; not a new formal finding. The frozen 9-case
 * file is unchanged.
 *
 * The shipping tmux query/teardown helpers on their DEFAULT run never hand the controller binding to a
 * tmux CLIENT: probeTmuxAvailable, livePaneIds, isPaneAlive, tmuxServerIdentity, tmuxPanePid and the
 * bound teardown terminateBoundPane. After the operation the parent still holds its binding and a
 * protected controller write that uses it still succeeds. A launcher --dry-run issues no tmux call at
 * all (no probe, not only no create).
 *
 * Observation: a test-owned `tmux` first on PATH records, per call, only whether each binding key is set
 * in the CLIENT environment, then execs the owned shim (isolated socket, PID+start ledger). The parent
 * binding is the fixture's own minted run binding plus an alias canary; no value is printed or compared
 * except as a boolean.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { isPaneAlive, livePaneIds, probeTmuxAvailable, processStartOf, terminateBoundPane, tmuxPanePid, tmuxServerIdentity } from "../../scripts/lib/host/tmux-backend";
import { buildTaskCell, readAttemptForInstance, writeTaskCell, type TaskCellDispatchInput } from "../../src/domains/dispatch";
import { loadRunBinding, mintRunBinding } from "../../src/domains/lifecycle";
import { PLUGIN, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";

afterEach(teardownOwned);

const tmuxAvailable = resolveRealTmux() !== null;
let seq = 6980;
const KEY = "GUILD_RUN_BINDING_REF";
const ALIAS = "E00_PARENT_BINDING_REF";
const RUN = "run-20261028-000000-e00-lr4h";

interface Env { root: string; bin: string; probeBin: string; shim: TmuxShim; clientLog: string }
function env(): Env {
  const root = ownedTempDir("guild-e00-lr4h-");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  const probeBin = path.join(root, ".client-probe");
  const clientLog = path.join(root, "client-env.log");
  fs.mkdirSync(probeBin, { recursive: true });
  fs.writeFileSync(path.join(probeBin, "tmux"),
    `#!/bin/sh\nfor k in ${KEY} ${ALIAS}; do eval "v=\\\${$k+set}"; echo "$1 $k=\${v:-unset}" >> ${clientLog}; done\nexec ${path.join(bin, "tmux")} "$@"\n`, { mode: 0o755 });
  return { root, bin, probeBin, shim, clientLog };
}
const clientLines = (e: Env) => (fs.existsSync(e.clientLog) ? fs.readFileSync(e.clientLog, "utf8").split("\n").filter(Boolean) : []);
const shimCalls = (e: Env) => (fs.existsSync(e.shim.callsLog) ? fs.readFileSync(e.shim.callsLog, "utf8").split("\n").filter(Boolean) : []);

function ownedPane(e: Env): { pane_id: string; pid: number; start: string } {
  const r = spawnSync(path.join(e.bin, "tmux"), ["new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", `w${++seq}`, `sleep ${seq}`], { encoding: "utf8", env: { PATH: `${e.bin}:/usr/bin:/bin`, HOME: e.root } });
  if (r.status !== 0) throw new Error("fixture: owned pane not created");
  const [pane_id, pid] = r.stdout.trim().split(" ");
  return { pane_id: pane_id!, pid: Number(pid), start: processStartOf(Number(pid))! };
}

function disp(logicalTaskId: string): TaskCellDispatchInput {
  const now = () => "2026-07-15T00:00:00.000Z";
  return {
    runId: RUN, logicalTaskId, taskRunId: `${logicalTaskId}.tr1`, attempt: 1, attemptId: `${logicalTaskId}.att1`, instanceId: `${logicalTaskId}.a1.i1`,
    cellId: `cell-${logicalTaskId}`, goalId: "goal", phaseId: "build", stepId: logicalTaskId, teamId: "guild", workerRole: "backend",
    specialistTypeId: "backend", specialistTypeVersion: "1", specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN}/${logicalTaskId}.md`, contextBundleHash: "sha256:ctx", hostId: "claude-code-cli", adapterId: "claude-code-cli@1",
    hostCapabilitiesHash: "sha256:caps", substrate: "tmux", modelTier: "mid", objective: `implement ${logicalTaskId}`, nonGoals: [], scopePaths: [],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: [], dependencies: [], projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] },
    autonomyPolicy: "supervised", budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, deadline: null, leadBindingId: "lead-binding", now,
  };
}

/**
 * Run `fn` with the parent env holding the run's own minted binding and an alias canary, PATH led by the
 * client probe; afterwards report parent preservation and a protected controller write that uses the
 * parent's binding. Everything restored in finally.
 */
function withBoundParent<T>(e: Env, fn: () => T) {
  mintRunBinding({ root: e.root, run_id: RUN });
  const bindingRef = loadRunBinding({ root: e.root, run_id: RUN })!.binding_ref;
  const alias = `e00-canary-${crypto.randomBytes(8).toString("hex")}`;
  const saved = { PATH: process.env["PATH"], TMUX: process.env["TMUX"], TMUX_PANE: process.env["TMUX_PANE"], [KEY]: process.env[KEY], [ALIAS]: process.env[ALIAS] };
  process.env["PATH"] = `${e.probeBin}:${e.bin}:${saved.PATH ?? "/usr/bin:/bin"}`;
  delete process.env["TMUX"]; delete process.env["TMUX_PANE"];
  process.env[KEY] = bindingRef; process.env[ALIAS] = alias;
  try {
    const value = fn();
    const parent_kept = process.env[KEY] === bindingRef && process.env[ALIAS] === alias;
    // Protected controller write AFTER the operation, authorized by the parent's own binding.
    let controller_write_ok = false;
    try {
      writeTaskCell(e.root, buildTaskCell(disp("T9")), { binding_ref: process.env[KEY]! });
      controller_write_ok = readAttemptForInstance(e.root, { run_id: RUN, logical_task_id: "T9", attempt: 1, instance_id: "T9.a1.i1" }) !== null;
    } catch { controller_write_ok = false; }
    return { value, parent_kept, controller_write_ok };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

const HELPERS: Array<[string, (p: { pane_id: string; pid: number; start: string }) => unknown]> = [
  ["probeTmuxAvailable()", () => probeTmuxAvailable()],
  ["livePaneIds()", () => livePaneIds()],
  ["isPaneAlive(paneId)", (p) => isPaneAlive(p.pane_id)],
  ["tmuxServerIdentity()", () => tmuxServerIdentity()],
  ["tmuxPanePid(paneId)", (p) => tmuxPanePid(p.pane_id)],
];

describe.skipIf(!tmuxAvailable)("L4-F1 helpers · default-run tmux clients never carry the controller binding", () => {
  for (const [label, call] of HELPERS) {
    it(`${label}: every tmux client it runs has neither key set; the parent keeps its binding; a protected write still succeeds`, () => {
      const e = env();
      const pane = ownedPane(e);
      const from = clientLines(e).length;
      const r = withBoundParent(e, () => call(pane));
      const lines = clientLines(e).slice(from);
      // Precondition: the helper really ran a tmux client through the probe.
      expect(lines.length > 0).toBe(true);
      expect({ any_client_with_a_key_set: lines.some((l) => l.endsWith("=set")), parent_kept: r.parent_kept, controller_write_ok: r.controller_write_ok })
        .toEqual({ any_client_with_a_key_set: false, parent_kept: true, controller_write_ok: true });
    });
  }

  it("terminateBoundPane (default run) on an owned live pane: confirmed teardown, and no tmux client carried a key", () => {
    const e = env();
    const pane = ownedPane(e);
    const server = tmuxServerIdentity((cmd, args) => {
      const x = spawnSync(cmd === "tmux" ? path.join(e.bin, "tmux") : cmd, args, { encoding: "utf8", env: { PATH: `${e.bin}:/usr/bin:/bin`, HOME: e.root } });
      return { status: x.status, stdout: x.stdout ?? "", stderr: x.stderr ?? "" };
    })!;
    const from = clientLines(e).length;
    const r = withBoundParent(e, () => terminateBoundPane(pane.pane_id, { pane_id: pane.pane_id, pane_pid: pane.pid, pane_process_start: pane.start, server_pid: server.pid, server_process_start: server.process_start }));
    const lines = clientLines(e).slice(from);
    expect({ clients: lines.length > 0, confirmed: (r.value as { confirmed: boolean }).confirmed, pane_gone: processStartOf(pane.pid) !== pane.start }).toEqual({ clients: true, confirmed: true, pane_gone: true });
    expect({ any_client_with_a_key_set: lines.some((l) => l.endsWith("=set")), parent_kept: r.parent_kept, controller_write_ok: r.controller_write_ok })
      .toEqual({ any_client_with_a_key_set: false, parent_kept: true, controller_write_ok: true });
  });

  it("anti-vacuity: the client probe does record a key that IS set in a client environment", () => {
    const e = env();
    const from = clientLines(e).length;
    spawnSync(path.join(e.probeBin, "tmux"), ["-V"], { encoding: "utf8", env: { PATH: `${e.bin}:/usr/bin:/bin`, [ALIAS]: "fixture" } });
    expect(clientLines(e).slice(from).some((l) => l.endsWith(`${ALIAS}=set`))).toBe(true);
  });
});

// ── pure preview: the real launcher --dry-run issues no tmux call at all ──

const PKG = process.env["E00_TA_ACTIVATION_PACKAGE"] ?? "";
const pkgPresent = PKG.length > 0 && path.isAbsolute(PKG) && fs.existsSync(path.join(PKG, ".claude-plugin", "plugin.json"));
const PRELOAD = path.join(__dirname, "support", "e00-launcher-preload.ts");
const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";

describe.skipIf(!tmuxAvailable || !pkgPresent)("L4-F1 helpers · a launcher --dry-run is pure", () => {
  it("--dry-run with the run binding in the launcher env: zero tmux calls of any kind (no probe), no client carried a key", () => {
    const e = env();
    fs.mkdirSync(path.join(e.root, ".guild", "team"), { recursive: true });
    fs.copyFileSync(path.join(PLUGIN, "scripts", "fixtures", "team-agent-team.yaml"), path.join(e.root, ".guild", "team", "e00-lr4h.yaml"));
    fs.mkdirSync(path.join(e.root, ".guild", "runs", RUN), { recursive: true });
    fs.writeFileSync(path.join(e.root, ".guild", "runs", "current-run-id"), `${RUN}\n`);
    mintRunBinding({ root: e.root, run_id: RUN });
    fs.writeFileSync(path.join(e.root, ".guild", "runs", RUN, "session-binding.json"), JSON.stringify({
      schema_version: "guild.session_binding.v1", run_id: RUN, host_family: "claude-code-cli", surface: "cli", detected_at: new Date().toISOString(),
      models: { cheap: "haiku", mid: "sonnet", powerful: "opus" }, model_family: "claude", prompt_compose: { dialect_id: "claude", overlay_ids: [], hash: "sha256:x" },
      evidence: { cheap: "available", mid: "available", powerful: "available" },
    }, null, 2) + "\n");
    const bindingRef = loadRunBinding({ root: e.root, run_id: RUN })!.binding_ref;
    const base = shimCalls(e).length;
    const r = spawnSync(BUN, ["--preload", PRELOAD, path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), "--team", path.join(e.root, ".guild", "team", "e00-lr4h.yaml"), "--cwd", e.root, "--run-id", RUN, "--dry-run"], {
      cwd: e.root, encoding: "utf8", timeout: 180000,
      env: { PATH: `${e.probeBin}:${e.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? e.root,
        GUILD_DISPATCH_APPROVAL_OVERRIDE: "E00-T0 r4 helper fixture", E00_ACTIVATION_STUB_ROOT: PKG, [KEY]: bindingRef },
    });
    // Precondition: the dry run completed as a preview.
    expect(r.status).toBe(0);
    expect({ tmux_calls: shimCalls(e).length - base, any_client_with_a_key_set: clientLines(e).some((l) => l.endsWith("=set")) })
      .toEqual({ tmux_calls: 0, any_client_with_a_key_set: false });
  }, 240_000);
});
