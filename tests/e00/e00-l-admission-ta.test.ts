/**
 * E00-T0 · L caller/admission reds (implementation/e00/l-caller-admission-test-release.json),
 * authored BEFORE any L source change, bound to l-session-admission-and-failure-decision.json,
 * the approved per-instance carrier (l-pane-carrier-approved-r1.json) and L's revised plan
 * (evidence/e00-l/l1-session-admission-capture-plan.json r1).
 *
 * Real entry: the WORKTREE scripts/agent-team-launcher.ts CLI, non-dry, in-session mode on
 * a test-owned isolated tmux server (tc/tmux-shim; physical creates counted separately
 * from read-only probes), a `claude` stub that idles, and a real owned team window.
 * Seams (test child only): support/e00-launcher-preload.ts. Its activation fixture
 * (mechanics only) points activation at the root-built C12 package, because the worktree
 * launcher refuses both that package (cross-package) and its own modified tree; faults wrap
 * the REAL TmuxTeamBackend.spawn / TeamDispatchExecutionTransport.launch after their real
 * effect. Claims are observed by existence/stat only; no nonce, claim body or binding is
 * read. No production flag, no qualified package claim.
 *
 * A1 a real session launch writes exactly one canonical claim per lane BEFORE the first
 *    physical create; a pre-existing claim refuses with zero physical creates and leaves
 *    the holder untouched; --dry-run writes no claim (control).
 * A2 a post-spawn throw, a failed status with value.ok true, or a missing value never
 *    reports success: nonzero exit, no success text, emitted lanes nonterminal/orphaned.
 * A3 success requires a captured pane and a durable per-instance carrier for every lane:
 *    a dropped capture or a pre-existing carrier refuses success and preserves bytes; a
 *    normal launch writes matching carriers (positive).
 * Limit: a shared-peer conflict needs a multi-task specialist pane; the fixture team is one
 * task per specialist, so that case stays with the L1 carrier tests.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { claimIsolatedLaunches, launchClaimPath } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { PLUGIN, ownedTempDir, teardownOwned } from "./support/e00-harness";
import { installTmuxShim, resolveRealTmux, tmuxOn, type TmuxShim } from "./tc/tmux-shim";
import { snapshotAttempts } from "./support/e00-admission-snapshot";

afterEach(teardownOwned);

const tmuxAvailable = resolveRealTmux() !== null;
// Supplied only by the evidence runner (from the canonical c12-refresh/ready.json package_root;
// source_commit=null, mechanics only). Absent: every case skips and is NOT executed proof.
const PKG = process.env["E00_TA_ACTIVATION_PACKAGE"] ?? "";
const pkgPresent = PKG.length > 0 && path.isAbsolute(PKG) && fs.existsSync(path.join(PKG, ".claude-plugin", "plugin.json"));
const PRELOAD = path.join(__dirname, "support", "e00-launcher-preload.ts");
const BUN = (globalThis as { Bun?: { which(n: string): string | null } }).Bun?.which("bun") ?? "bun";
const RUN = "run-20261028-000000-e00-ladm";
const TASKS = ["architect", "backend", "qa"];
const SUCCESS = /team window "[^"]+" created in the current session/;
const PHYSICAL = new Set(["new-session", "new-window", "split-window", "respawn-pane", "respawn-window"]);
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");

interface Fx { root: string; bin: string; shim: TmuxShim }
function fixture(o: { legacy?: boolean } = {}): Fx {
  const root = ownedTempDir("guild-e00-ladm-");
  fs.mkdirSync(path.join(root, ".guild", "team"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  for (const slug of ["e00-adm", "e00-adm2"]) fs.copyFileSync(path.join(PLUGIN, "scripts", "fixtures", "team-agent-team.yaml"), path.join(root, ".guild", "team", `${slug}.yaml`));
  if (!o.legacy) {
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), `${RUN}\n`);
  mintRunBinding({ root, run_id: RUN });
  fs.writeFileSync(path.join(root, ".guild", "runs", RUN, "session-binding.json"), JSON.stringify({
    schema_version: "guild.session_binding.v1", run_id: RUN, host_family: "claude-code-cli", surface: "cli", detected_at: new Date().toISOString(),
    models: { cheap: "haiku", mid: "sonnet", powerful: "opus" }, model_family: "claude", prompt_compose: { dialect_id: "claude", overlay_ids: [], hash: "sha256:x" },
    evidence: { cheap: "available", mid: "available", powerful: "available" },
  }, null, 2) + "\n");
  const ctx = path.join(root, ".guild", "context", RUN);
  fs.mkdirSync(ctx, { recursive: true });
  for (const t of TASKS) fs.writeFileSync(path.join(ctx, `${t}-${t}.md`), `# ${t}\n`);
  }
  const bin = path.join(root, ".bin");
  const shim = installTmuxShim(root, bin);
  fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexec sleep 6950\n", { mode: 0o755 });
  // Through the shim so the server start is recorded in the ownership ledger.
  expect(spawnSync(path.join(bin, "tmux"), ["new-session", "-d", "-s", "e00-host", "sleep 6951"], { encoding: "utf8" }).status).toBe(0);
  return { root, bin, shim };
}

interface Run { status: number | null; stdout: string; success: boolean; physical: number; log: Array<Record<string, any>>; calls: string[]; callsBefore: number; stderr: string }
function launch(f: Fx, o: { slug?: string; env?: Record<string, string>; dryRun?: boolean; noRunId?: boolean } = {}): Run {
  const logFile = path.join(f.root, `preload-${crypto.randomBytes(4).toString("hex")}.log`);
  const callsBefore = fs.existsSync(f.shim.callsLog) ? fs.readFileSync(f.shim.callsLog, "utf8").split("\n").filter(Boolean).length : 0;
  const env: Record<string, string> = {
    PATH: `${f.bin}:${process.env["PATH"] ?? "/usr/bin:/bin"}`, HOME: process.env["HOME"] ?? f.root, SHELL: "/bin/zsh", LANG: "en_US.UTF-8",
    TMUX: `${f.shim.socket},1,0`,
    GUILD_DISPATCH_APPROVAL_OVERRIDE: "E00-T0 launcher admission fixture: approval verification is pinned separately",
    E00_ACTIVATION_STUB_ROOT: PKG, E00_PRELOAD_LOG: logFile, E00_RUN_ID: RUN, E00_ROOT: f.root, ...(o.env ?? {}),
  };
  const args = ["--preload", PRELOAD, path.join(PLUGIN, "scripts", "agent-team-launcher.ts"), "--team", path.join(f.root, ".guild", "team", `${o.slug ?? "e00-adm"}.yaml`), "--cwd", f.root, ...(o.noRunId ? [] : ["--run-id", RUN]), ...(o.dryRun ? ["--dry-run"] : [])];
  const r = spawnSync(BUN, args, { cwd: f.root, env, encoding: "utf8", timeout: 180000 });
  const calls = fs.existsSync(f.shim.callsLog) ? fs.readFileSync(f.shim.callsLog, "utf8").split("\n").filter(Boolean).slice(callsBefore) : [];
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  // Evidence only: the shim's PID+start ownership ledger as of this launch (server and pane identities).
  const ledgerOut = process.env["E00_LEDGER_ARCHIVE"];
  if (ledgerOut && fs.existsSync(f.shim.identities)) {
    fs.mkdirSync(ledgerOut, { recursive: true });
    fs.copyFileSync(f.shim.identities, path.join(ledgerOut, `${path.basename(f.root)}-${path.basename(logFile, ".log")}.tsv`));
  }
  return { status: r.status, stdout: `${r.stdout ?? ""}`, success: SUCCESS.test(r.stdout ?? ""), physical: calls.filter((c) => PHYSICAL.has(c)).length, log, calls, callsBefore, stderr: `${r.stderr ?? ""}` };
}

/** Emitted attempt-1 lanes of RUN: ids and nonterminal/orphan state as read. */
function lanes(root: string) {
  const out: Array<{ task: string; instance_id: string | null; attempt_present: boolean; terminal: unknown; orphaned: unknown; dir: string | null }> = [];
  for (const task of TASKS) {
    const attemptDir = path.join(root, ".guild", "runs", RUN, "task-cells", task, "attempts", "1");
    const a = path.join(attemptDir, "attempt.json");
    const rec = fs.existsSync(a) ? JSON.parse(fs.readFileSync(a, "utf8")) : null;
    const insts = fs.existsSync(path.join(attemptDir, "instances")) ? fs.readdirSync(path.join(attemptDir, "instances")) : [];
    out.push({ task, instance_id: rec?.instance_id ?? null, attempt_present: rec !== null, terminal: rec ? rec.terminal_state : "missing_record", orphaned: rec ? rec.orphaned : null, dir: insts[0] ? path.join(attemptDir, "instances", insts[0]) : null });
  }
  return out;
}
const claimStat = (root: string, task: string) => { const p = path.resolve(root, launchClaimPath({ runId: RUN, logicalTaskId: task, attempt: 1 })); if (!fs.existsSync(p)) return null; const s = fs.statSync(p); return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino }; };
const parked = (root: string) => lanes(root).map((l) => ({ task: l.task, attempt_present: l.attempt_present, terminal: l.terminal, orphaned: l.orphaned }));
const PARKED = TASKS.map((task) => ({ task, attempt_present: true, terminal: null, orphaned: true }));

const enabled = tmuxAvailable && pkgPresent;

describe.skipIf(!enabled)("A1 · the real session launch consumes exactly one canonical claim per lane before any physical create", () => {
  it("normal launch: every lane's claim exists at spawn entry and exactly one exists after", () => {
    const f = fixture();
    const r = launch(f, { env: { E00_CLAIM_LANES: TASKS.join(",") } });
    const entry = r.log.find((e) => e.event === "claims-at-spawn-entry");
    expect(entry).toBeDefined();
    expect({ status: r.status, success: r.success, physical_positive: r.physical > 0, claims_at_spawn_entry: entry!.present, claims_after: TASKS.map((t) => claimStat(f.root, t) !== null) })
      .toEqual({ status: 0, success: true, physical_positive: true, claims_at_spawn_entry: Object.fromEntries(TASKS.map((t) => [t, true])), claims_after: TASKS.map(() => true) });
  }, 240_000);

  it("a claim already held for the task refuses a second launch with zero physical creates; the holder is unchanged", () => {
    const f = fixture();
    const first = launch(f);
    expect({ status: first.status, success: first.success }).toEqual({ status: 0, success: true });
    // Seed the holder through the public admission API (a real admitted, live, launched lane).
    for (const l of lanes(f.root)) {
      if (claimStat(f.root, l.task) !== null) continue;
      claimIsolatedLaunches({ cwd: f.root, runId: RUN, launchId: "e00-holder-launch", lanes: [{ logicalTaskId: l.task, instanceId: l.instance_id!, attempt: 1 }] });
    }
    const holder = Object.fromEntries(TASKS.map((t) => [t, claimStat(f.root, t)]));
    expect(Object.values(holder).every((s) => s !== null)).toBe(true);
    const holderPanes = tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_id} #{pane_pid}"]).stdout.trim();
    const attemptsBefore = TASKS.map((t) => sha(fs.readFileSync(path.join(f.root, ".guild", "runs", RUN, "task-cells", t, "attempts", "1", "attempt.json"))));
    const second = launch(f, { slug: "e00-adm2" });
    expect({
      status_nonzero: second.status !== 0, success: second.success, physical: second.physical,
      holder_claims_unchanged: TASKS.every((t) => JSON.stringify(claimStat(f.root, t)) === JSON.stringify(holder[t])),
      holder_panes_unchanged: tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_id} #{pane_pid}"]).stdout.trim() === holderPanes,
      holder_attempts_unchanged: TASKS.every((t, i) => sha(fs.readFileSync(path.join(f.root, ".guild", "runs", RUN, "task-cells", t, "attempts", "1", "attempt.json"))) === attemptsBefore[i]),
    }).toEqual({ status_nonzero: true, success: false, physical: 0, holder_claims_unchanged: true, holder_panes_unchanged: true, holder_attempts_unchanged: true });
  }, 240_000);

  it("control: a --dry-run preview writes no claim and makes no physical create", () => {
    const f = fixture();
    const r = launch(f, { dryRun: true });
    expect({ status: r.status, physical: r.physical, claims: TASKS.map((t) => claimStat(f.root, t)) }).toEqual({ status: 0, physical: 0, claims: TASKS.map(() => null) });
  }, 240_000);
});

describe.skipIf(!enabled)("A2 · an unknown post-action outcome is never reported as a launch success", () => {
  for (const fault of ["spawn-throw", "failed-ok", "no-value"] as const) {
    it(`${fault}: nonzero exit, no success report, every emitted lane nonterminal and orphaned under its real id`, () => {
      const f = fixture();
      const r = launch(f, { env: { E00_FAULT: fault } });
      // Preconditions: the real spawn ran (physical creates happened) and the fault fired.
      expect(r.physical).toBeGreaterThan(0);
      expect(r.log.some((e) => e.event === "fault-fired" && e.fault === fault)).toBe(true);
      expect({ status_nonzero: r.status !== 0, success: r.success, lanes: parked(f.root) }).toEqual({ status_nonzero: true, success: false, lanes: PARKED });
    }, 240_000);
  }
});

describe.skipIf(!enabled)("A3 · success requires a captured pane and a durable carrier for every lane", () => {
  it("positive: a normal launch writes one per-instance carrier per lane matching a real live pane", () => {
    const f = fixture();
    const r = launch(f);
    const livePanes = new Map(tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_id} #{pane_pid} #{pane_title}"]).stdout.trim().split("\n").map((l) => { const [id, pid, title] = l.split(" "); return [id!, { pid: Number(pid), title }]; }));
    const carriers = lanes(f.root).map((l) => {
      const file = l.dir ? path.join(l.dir, "pane-identity.json") : null;
      if (!file || !fs.existsSync(file)) return { task: l.task, carrier: false };
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      const live = livePanes.get(c?.pane?.pane_id);
      return { task: l.task, carrier: true, own_instance: c.instance_id === l.instance_id, live_pane_matches: !!live && live.pid === c.pane.pane_pid && live.title === c.pane.title,
        member_listed: Array.isArray(c.shared_members) && c.shared_members.some((m: { instance_id?: string }) => m.instance_id === l.instance_id) };
    });
    expect({ status: r.status, success: r.success, carriers }).toEqual({ status: 0, success: true,
      carriers: TASKS.map((task) => ({ task, carrier: true, own_instance: true, live_pane_matches: true, member_listed: true })) });
  }, 240_000);

  it("a lane missing from the creating command's pane enumeration refuses success; lanes parked; no pane killed", () => {
    const f = fixture();
    fs.writeFileSync(f.shim.dropPaneTitle, "backend--backend--a1");
    const r = launch(f);
    fs.rmSync(f.shim.dropPaneTitle, { force: true });
    const titles = tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_title}"]).stdout.split("\n");
    // Precondition: the dropped pane really exists (only its enumeration line was removed).
    expect(titles.includes("backend--backend--a1")).toBe(true);
    expect({ status_nonzero: r.status !== 0, success: r.success, lanes: parked(f.root) }).toEqual({ status_nonzero: true, success: false, lanes: PARKED });
  }, 240_000);

  it("a pre-existing carrier for an emitted instance refuses success, keeps its bytes, and parks the lanes", () => {
    const f = fixture();
    const r = launch(f, { env: { E00_CARRIER_CONFLICT: "1" } });
    const planted = r.log.filter((e) => e.event === "carrier-conflict-planted");
    expect(planted.length).toBe(TASKS.length);
    const preserved = lanes(f.root).every((l) => {
      const file = path.join(l.dir!, "pane-identity.json");
      const want = JSON.stringify({ schema_version: "guild.task_cell_pane_identity.v1", note: "E00-T0 pre-existing conflicting carrier", instance_id: path.basename(l.dir!) }) + "\n";
      return fs.existsSync(file) && fs.readFileSync(file, "utf8") === want;
    });
    expect({ status_nonzero: r.status !== 0, success: r.success, carriers_preserved: preserved, lanes: parked(f.root) })
      .toEqual({ status_nonzero: true, success: false, carriers_preserved: true, lanes: PARKED });
  }, 240_000);
});

describe.skipIf(!enabled)("control · legacy launch without --run-id keeps its no-cell behaviour (root Q4)", () => {
  // Baseline limitation (current source): the launcher resolves args.runId before emission
  // (resolveLifecycleRunId), so a real launch never reaches the args.runId === null no-cell
  // branch. Without --run-id it either inherits current-run-id (a bound run that emits cells)
  // or refuses on run identity. The reachable no-run-id baseline is that refusal, pinned exactly.
  it("no --run-id and no current-run-id: run-identity refusal, zero physical creates, no cells, claims or carriers", () => {
    const f = fixture({ legacy: true });
    const r = launch(f, { noRunId: true });
    const runsDir = path.join(f.root, ".guild", "runs");
    const found = (name: string) => fs.existsSync(runsDir) && spawnSync("find", [runsDir, "-name", name], { encoding: "utf8" }).stdout.trim().length > 0;
    expect({ status: r.status, success: r.success, physical: r.physical, run_identity_refusal: /REFUSED \(run identity\): lifecycle run id required/.test(r.stderr), cells: found("assignment.json"), claims: found("launch-claim.json"), carriers: found("pane-identity.json") })
      .toEqual({ status: 1, success: false, physical: 0, run_identity_refusal: true, cells: false, claims: false, carriers: false });
  }, 240_000);
});

describe.skipIf(!enabled)("Q4 · an explicit --run-id never downgrades to the legacy path", () => {
  it("explicit run id with no seeded canonical run: refuses before any physical create; no success", () => {
    const f = fixture({ legacy: true });
    const r = launch(f);
    expect({ status_nonzero: r.status !== 0, success: r.success, physical: r.physical }).toEqual({ status_nonzero: true, success: false, physical: 0 });
  }, 240_000);
});

describe.skipIf(!enabled)("A1 boundary · a claim taken AFTER the real emission and BEFORE this launch's admission refuses without touching the holder", () => {
  it("public claimIsolatedLaunches holds the emitted instances, an owned holder is live: nonzero, no success, zero production physical creates, holder bytes unchanged", () => {
    const f = fixture();
    const r = launch(f, { env: { E00_BOUNDARY_HOLDER: TASKS.join(","), E00_SHIM_TMUX: path.join(f.bin, "tmux"), E00_SHIM_CALLS: f.shim.callsLog } });
    const fixtureLoaded = r.log.some((e) => e.event === "after-emit-boundary-fixture" && e.path_is_launcher === true);
    const b = r.log.find((e) => e.event === "boundary-held");
    // Preconditions: the real emitter ran and returned, the boundary fired after it, every lane
    // was emitted with a real instance id, the holder is live and the public claim succeeded.
    expect({ fixtureLoaded, fired: b !== undefined }).toEqual({ fixtureLoaded: true, fired: true });
    expect({ emitted: b!.emitted.every((l: { instance_id: string | null }) => typeof l.instance_id === "string"), holder_started: b!.holder_started, claimed: b!.claimed, refusal: b!.refusal })
      .toEqual({ emitted: true, holder_started: 0, claimed: true, refusal: null });
    const injected = (i: number) => r.callsBefore + i >= b!.injected_calls.from && r.callsBefore + i < b!.injected_calls.to;
    const production = r.calls.filter((c, i) => !injected(i) && PHYSICAL.has(c)).length;
    let holderAlive = false;
    try { process.kill(b!.holder_pid, 0); holderAlive = true; } catch { holderAlive = false; }
    const holderListed = tmuxOn(f.shim, ["list-panes", "-a", "-F", "#{pane_id}"]).stdout.split("\n").includes(b!.holder_pane);
    expect({
      status_nonzero: r.status !== 0, success: r.success, production_physical: production,
      holder_alive: holderAlive, holder_listed: holderListed,
      holder_state_unchanged: JSON.stringify(snapshotAttempts(f.root, RUN, TASKS)) === JSON.stringify(b!.snapshot),
    }).toEqual({ status_nonzero: true, success: false, production_physical: 0, holder_alive: true, holder_listed: true, holder_state_unchanged: true });
  }, 240_000);
});
