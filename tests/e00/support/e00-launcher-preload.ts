/**
 * tests/e00/support/e00-launcher-preload.ts — test-CHILD preload for the real
 * agent-team-launcher CLI (`bun --preload <this> scripts/agent-team-launcher.ts`).
 * Every behaviour is armed only by env in that child; nothing here is a product
 * flag or seam, and the parent test process never loads it.
 *
 * E00_ACTIVATION_STUB_ROOT  source-only TA activation fixture (mechanics only): the
 *   launcher's exact-package activation RESULT becomes `--plugin-dir <root>`; a modified
 *   source tree can never pass real package activation. The root is the root-built C12
 *   package (no qualification is claimed).
 * E00_FAULT  post-action faults wrapping the REAL methods after their real effect:
 *   spawn-throw   TmuxTeamBackend.prototype.spawn runs (real panes) then throws
 *   failed-ok     TeamDispatchExecutionTransport.prototype.launch result -> status failed, value kept (ok true)
 *   no-value      same, but value null (status unchanged)
 * E00_CARRIER_CONFLICT=1  before the real spawn, write a pre-existing pane-identity.json in
 *   every emitted instance dir of E00_RUN_ID (exclusive create; bytes recorded in the log).
 * E00_CLAIM_LANES=<task,...>  at real spawn entry, stat (existence only) each lane's
 *   canonical launch-claim path for attempt 1; never opens a claim.
 * E00_BOUNDARY_HOLDER=<task,...>  child-only source plugin over scripts/agent-team-launcher.ts:
 *   the real exported emitTaskCellsV2 is renamed in memory and re-exported by a wrapper that
 *   calls it first and returns its value unchanged. After the real non-dry tmux emission of
 *   E00_RUN_ID returns (before the launcher's own claim admission and transport launch), the
 *   callback starts an owned live holder session through the shim tmux (E00_SHIM_TMUX,
 *   ledgered), consumes the emitted lanes' claims through the public claimIsolatedLaunches
 *   under launch id "e00-boundary-holder", and logs the emitted ids, holder pane, a
 *   stat/hash snapshot and the calls-log span (E00_SHIM_CALLS) of the injected holder create.
 * E00_PRELOAD_LOG  append-only observation log (one JSON line per event).
 */
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const W = path.resolve(import.meta.dir, "..", "..", "..");
const env = process.env;
const log = (event: Record<string, unknown>) => { if (env["E00_PRELOAD_LOG"]) fs.appendFileSync(env["E00_PRELOAD_LOG"]!, JSON.stringify(event) + "\n"); };

const stub = env["E00_ACTIVATION_STUB_ROOT"];
if (stub) {
  Bun.plugin({
    name: "e00-activation-fixture",
    setup(b) {
      b.onLoad({ filter: /scripts\/lib\/host\/tmux-backend\.ts$/ }, async (args) => {
        const src = await Bun.file(args.path).text();
        const marker = "export function resolveClaudePluginActivation(";
        if (!src.includes(marker)) throw new Error("e00 preload: activation export not found");
        log({ event: "activation-fixture", root_is_dir: fs.statSync(stub).isDirectory() });
        return {
          contents: src.replace(marker,
            `export function resolveClaudePluginActivation(..._a: unknown[]): ClaudePluginActivation { return { args: ["--plugin-dir", ${JSON.stringify(stub)}], pluginRoot: ${JSON.stringify(stub)} }; }\nfunction __e00RealResolveClaudePluginActivation(`),
          loader: "ts",
        };
      });
    },
  });
}

const fault = env["E00_FAULT"] ?? "";
const runId = env["E00_RUN_ID"] ?? "";
const root = env["E00_ROOT"] ?? "";
if (env["E00_BOUNDARY_HOLDER"]) {
  const adm = await import(path.join(W, "src", "domains", "dispatch", "index.ts"));
  const snap = await import(path.join(W, "tests", "e00", "support", "e00-admission-snapshot.ts"));
  const tasks = env["E00_BOUNDARY_HOLDER"]!.split(",").filter(Boolean);
  const callsCount = () => fs.existsSync(env["E00_SHIM_CALLS"]!) ? fs.readFileSync(env["E00_SHIM_CALLS"]!, "utf8").split("\n").filter(Boolean).length : -1;
  let held = false;
  // Runs after the REAL emitter returned, in the launcher process, before anything the
  // launcher does next (its own claim admission, then the transport launch).
  (globalThis as { __e00AfterEmit?: (a: unknown[], ret: unknown) => void }).__e00AfterEmit = (a, ret) => {
    const [, emitRunId, , , , transport, , dryRun] = a;
    log({ event: "emitter-returned", transport, dry_run: dryRun, returned: ret, run_matches: emitRunId === runId });
    if (held || dryRun !== false || transport !== "tmux" || emitRunId !== runId) return;
    held = true;
    const emitted = snap.emittedLanes(root, runId, tasks);
    const tmux = env["E00_SHIM_TMUX"]!;
    const before = callsCount();
    const started = spawnSync(tmux, ["new-session", "-d", "-s", "e00-boundary-holder", "sleep 6952"], { encoding: "utf8" }).status;
    const pane = spawnSync(tmux, ["list-panes", "-t", "e00-boundary-holder", "-F", "#{pane_id} #{pane_pid}"], { encoding: "utf8" }).stdout.trim().split(" ");
    const after = callsCount();
    let claimed = false;
    let refusal: string | null = null;
    try {
      adm.claimIsolatedLaunches({ cwd: root, runId, launchId: "e00-boundary-holder", lanes: emitted.map((l: { task: string; instance_id: string | null }) => ({ logicalTaskId: l.task, instanceId: l.instance_id ?? undefined, attempt: 1 })) });
      claimed = true;
    } catch (e) {
      refusal = (e as Error).constructor.name;
    }
    log({ event: "boundary-held", emitted, holder_started: started, holder_pane: pane[0] ?? null, holder_pid: Number(pane[1] ?? NaN), claimed, refusal,
      snapshot: snap.snapshotAttempts(root, runId, tasks), injected_calls: { from: before, to: after } });
  };
  Bun.plugin({
    name: "e00-after-emit-boundary",
    setup(b) {
      b.onLoad({ filter: /scripts\/agent-team-launcher\.ts$/ }, async (args) => {
        const src = await Bun.file(args.path).text();
        const marker = "export function emitTaskCellsV2(";
        if (src.split(marker).length !== 2) throw new Error("e00 preload: emitTaskCellsV2 export not found exactly once");
        log({ event: "after-emit-boundary-fixture", path_is_launcher: args.path.endsWith(path.join("scripts", "agent-team-launcher.ts")) });
        return {
          contents: src.replace(marker, "function __e00RealEmitTaskCellsV2(") +
            "\nexport function emitTaskCellsV2(...a: Parameters<typeof __e00RealEmitTaskCellsV2>): ReturnType<typeof __e00RealEmitTaskCellsV2> {\n" +
            "  const ret = __e00RealEmitTaskCellsV2(...a);\n" +
            "  (globalThis as { __e00AfterEmit?: (a: unknown[], r: unknown) => void }).__e00AfterEmit?.(a, ret);\n" +
            "  return ret;\n}\n",
          loader: "ts",
        };
      });
    },
  });
}
if (fault || env["E00_CARRIER_CONFLICT"] || env["E00_CLAIM_LANES"]) {
  const tb = await import(path.join(W, "scripts", "lib", "host", "tmux-backend.ts"));
  const adm = await import(path.join(W, "src", "domains", "dispatch", "index.ts"));
  const proto = tb.TmuxTeamBackend.prototype as { spawn: (...a: unknown[]) => unknown };
  const realSpawn = proto.spawn;
  proto.spawn = function (this: unknown, ...a: unknown[]) {
    if (env["E00_CLAIM_LANES"]) {
      const lanes = env["E00_CLAIM_LANES"]!.split(",").filter(Boolean);
      const present = Object.fromEntries(lanes.map((t) => [t, fs.existsSync(path.resolve(root, adm.launchClaimPath({ runId, logicalTaskId: t, attempt: 1 })))]));
      log({ event: "claims-at-spawn-entry", present });
    }
    if (env["E00_CARRIER_CONFLICT"]) {
      const cells = path.join(root, ".guild", "runs", runId, "task-cells");
      for (const task of fs.existsSync(cells) ? fs.readdirSync(cells) : []) {
        const inst = path.join(cells, task, "attempts", "1", "instances");
        for (const iid of fs.existsSync(inst) ? fs.readdirSync(inst) : []) {
          const file = path.join(inst, iid, "pane-identity.json");
          const bytes = JSON.stringify({ schema_version: "guild.task_cell_pane_identity.v1", note: "E00-T0 pre-existing conflicting carrier", instance_id: iid }) + "\n";
          fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
          log({ event: "carrier-conflict-planted", task, instance_id: iid, bytes: bytes.length });
        }
      }
    }
    const real = realSpawn.apply(this, a);
    log({ event: "real-spawn-returned", fault });
    if (fault === "spawn-throw") { log({ event: "fault-fired", fault }); throw new Error("E00-T0 injected post-spawn failure"); }
    return real;
  };
  if (fault === "failed-ok" || fault === "no-value") {
    const tr = await import(path.join(W, "src", "domains", "dispatch", "index.ts"));
    const tp = tr.TeamDispatchExecutionTransport.prototype as { launch: (...a: unknown[]) => Record<string, unknown> };
    const realLaunch = tp.launch;
    tp.launch = function (this: unknown, ...a: unknown[]) {
      const out = realLaunch.apply(this, a);
      const value = out["value"] as { ok?: unknown } | null;
      log({ event: "fault-fired", fault, real_status: out["status"], real_value_ok: value?.ok ?? null });
      return fault === "failed-ok"
        ? { ...out, status: "failed", reason_code: "spawn_failed", detail: "E00-T0 injected post-action failure" }
        : { ...out, value: null };
    };
  }
}
