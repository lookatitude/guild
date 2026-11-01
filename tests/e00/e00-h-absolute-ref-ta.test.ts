/**
 * E00-T0 · independent reds for H-ABS1 (implementation/e00/h-absolute-triage-and-red-test-release.json,
 * refined by h-absolute-scope-refinement.json; readbacks evidence/e00-h/absolute-assignment-readback.json
 * and evidence/e00-t0-tc-archival-authoring/t0-blocker-readback.json), authored BEFORE any H source change.
 *
 * The L tmux producer exports an ABSOLUTE GUILD_TASK_ASSIGNMENT (tmux-backend.ts assignmentAbs); the
 * TaskCompleted resolver compares it raw to the stored canonical relative assignment_path, so a real
 * controller lane never binds. Selected correction: O1 accepts a normalized absolute ref naming the
 * literal canonical assignment suffix when its root prefix resolves to the SAME physical guildRoot (logical,
 * physical, reverse and whole-root-alias spellings); O2 makes every known-E00 non-binding or ambiguous
 * unbound resolution refuse before any write, even with no env ref.
 *   P1 producer logical ref, logical hook root      P2 producer physical ref, logical hook root
 *   P3 producer logical ref, physical hook root     P4 whole-root alias (outside link to the same root)
 *     all: exit 0, the notice is the only write, receipt unchanged.
 *   R3 producer ref + secret-bearing receipt: generic secret_scrub_required, zero writes.
 *   R4 producer ref on an unmarked root: notice only, no layout marker, no wiki or state/cache writes.
 *   N1 foreign root, N2 non-normalized spelling, N3 in-root symlink, N4 mismatched readable E00 ref and
 *   N5 native E00 ambiguity with no env ref refuse with zero writes and no notice; secret and unmarked
 *   variants show the refusal is not a fall-through to the scrub or the layout bootstrap.
 *   C2 bound path: the producer ref publishes the same pointer as the canonical relative ref.
 *   K1/K2 canonical relative unbound notice and bound publish; K3 a non-E00 relative assignment keeps its
 *   legacy refusal and writes no notice.
 *
 * Setup proves the ref is the producer's: the real TmuxTaskCellWorkerPort composes the pane command
 * through a recording `run` that refuses the create (no tmux, no pane), and the captured export must
 * equal the ref used. The existing physical-containment reader must load (or refuse) the assignment as
 * stated. Fixture construction uses the canonical helpers (buildTaskCell/writeTaskCell, mintRunBinding,
 * receiptBytes, adoptDefinition). Layers: raw source (npx tsx) and compiled bundle (node dist), labelled
 * separately; E00_HABS_LAYER=source|dist selects one, unset runs both. Canaries compared as booleans only.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { buildTaskCell, readTaskAssignmentV2, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { ensureStorageLayout } from "../../hooks/lib/ensure-layout";
import { TmuxTaskCellWorkerPort, shellQuote } from "../../scripts/lib/host/tmux-backend";
import { resolveAdoptedDefinition } from "../../scripts/task-cell-controller";
import { PLUGIN, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";
import { TEST_PROFILE_HASH, TEST_TYPE_HASH, adoptDefinition } from "./support/adopted-definition";

afterEach(teardownOwned);

const LAYERS: Record<string, [string, string[]]> = {
  source: ["npx", ["tsx", path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts")]],
  dist: ["node", [path.join(PLUGIN, "hooks", "agent-team", "dist", "task-completed.js")]],
};
const SELECTED = process.env["E00_HABS_LAYER"];
if (SELECTED !== undefined && !(SELECTED in LAYERS)) throw new Error("E00_HABS_LAYER must be source or dist");
const RUN_ID = "run-e00-habs";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const awsCanary = () => `AKIA${crypto.randomBytes(12).toString("hex").toUpperCase().slice(0, 16)}`;

// ── Fixture (same TaskCell/receipt shape as the frozen H1/H2 files) ──

interface Fx { root: string; cwd: string; ext: string; bindingRef: string; c: ReturnType<typeof buildTaskCell>; rel: string; receipt: string; notice: string; marker: string; content: string }
function cell(taskId: string, attempt = 1) {
  return buildTaskCell({
    runId: RUN_ID, logicalTaskId: taskId, taskRunId: `${taskId}.tr1`, attempt, attemptId: `${taskId}.att${attempt}`,
    instanceId: `${taskId}.a${attempt}.i1`, cellId: `cell-${taskId}`, goalId: "goal-e00", phaseId: "build", stepId: taskId,
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-${taskId}.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 h-abs", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
    ...(attempt > 1 ? { previousAttemptId: `${taskId}.att${attempt - 1}`, retryReason: "e00 h-abs native ambiguity fixture" } : {}),
  });
}
/** The logical spelling of a physical temp root (macOS /var -> /private/var); the root itself when none exists. */
function logicalOf(root: string): string {
  const phys = fs.realpathSync(root);
  const logical = phys.startsWith("/private/var/") ? phys.slice("/private".length) : phys;
  return fs.existsSync(logical) && fs.realpathSync(logical) === phys ? logical : root;
}
function fixture(o: { canary?: string; layout?: boolean; extraTask?: string; secondAttempt?: boolean; legacy?: boolean } = {}): Fx {
  const root = ownedTempDir("guild-e00-habs-");
  const cwd = logicalOf(root);
  const ext = ownedTempDir("guild-e00-habs-ext-");
  for (const d of ["state", "cache", "temp"]) fs.mkdirSync(path.join(ext, d), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const e00 = (x: ReturnType<typeof cell>) => {
    if (o.legacy) return;
    (x.assignment as Record<string, unknown>)["done_when_ref"] = {
      oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64),
    };
  };
  const c = cell("task-001");
  e00(c);
  writeTaskCell(root, c, { binding_ref: bindingRef });
  if (o.extraTask) { const x = cell(o.extraTask); e00(x); writeTaskCell(root, x, { binding_ref: bindingRef }); }
  if (o.secondAttempt) { const x = cell("task-001", 2); e00(x); writeTaskCell(root, x, { binding_ref: bindingRef }); }
  adoptDefinition(root, "backend");
  const receipt = path.join(root, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  let content = receiptBytes(RUN_ID, c.assignment);
  if (o.canary) content = content.replace("- runtime collection", `- runtime collection ${o.canary}`);
  fs.writeFileSync(receipt, content);
  const marker = path.join(root, ".guild", "storage-layout.json");
  if (o.layout === false) fs.rmSync(marker, { force: true });
  else expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  const notice = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  return { root, cwd, ext, bindingRef, c, rel: c.assignment.assignment_path, receipt, notice, marker, content };
}

/**
 * The L producer's own absolute GUILD_TASK_ASSIGNMENT for `rel` with the port's cwd spelled `portCwd`: the real
 * port composes the pane command; the recording `run` answers the credential probe as absent, reports no
 * session and refuses the create, so no tmux server or pane ever exists. Returns the exact exported value.
 */
function producerRef(portCwd: string, rel: string, taskId = "task-001"): string {
  const aside = ownedTempDir("guild-e00-habs-port-");
  const stubPlugin = path.join(aside, "stub-plugin");
  fs.mkdirSync(stubPlugin);
  const creates: string[][] = [];
  const run = (cmd: string, args: string[]) => {
    if (cmd !== "tmux") return { status: 1, stdout: "", stderr: "recording run: not executed" };
    if (args[0] === "show-environment") return { status: 0, stdout: "-GUILD_RUN_BINDING_REF\n", stderr: "" };
    if (args[0] === "has-session") return { status: 1, stdout: "", stderr: "" };
    if (args[0] === "new-session" || args[0] === "new-window") { creates.push(args); return { status: 1, stdout: "", stderr: "recording run: create not performed" }; }
    return { status: 1, stdout: "", stderr: "recording run: not executed" };
  };
  const port = new TmuxTaskCellWorkerPort({
    cwd: portCwd, sessionName: "e00-habs", snapshotDir: path.join(aside, "launch"),
    resolveDefinition: (inst: { worker_role: string }) => resolveAdoptedDefinition(portCwd, inst.worker_role),
    receiptPath: (inst: { worker_role: string; logical_task_id: string }) => path.join(portCwd, ".guild", "runs", RUN_ID, "handoffs", `${inst.worker_role}-${inst.logical_task_id}.md`),
    ackArgv: ["node", path.join(aside, "task-cell-ack.js")], recordLaunch: () => {}, run,
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: process.env["HOME"] ?? aside, SHELL: "/bin/zsh", LANG: "en_US.UTF-8" },
    activate: () => ({ args: ["--plugin-dir", stubPlugin], pluginRoot: stubPlugin }),
  } as never);
  const inst = { instance_id: `${taskId}.a1.i1`, run_id: RUN_ID, logical_task_id: taskId, worker_role: "backend", host_id: "claude-code-cli",
    specialist_profile_hash: `sha256:${TEST_PROFILE_HASH}`, specialist_type_hash: `sha256:${TEST_TYPE_HASH}`,
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, model_id: null };
  const out = port.spawn({ instance_id: inst.instance_id, run_id: RUN_ID, assignment_path: rel, instance: inst } as never) as { ok: boolean; reason: string };
  expect({ ok: out.ok, create_issued_once: creates.length === 1, outcome: String(out.reason).startsWith("spawn_outcome_unknown") })
    .toEqual({ ok: false, create_issued_once: true, outcome: true });
  const command = creates[0]![creates[0]!.length - 1]!;
  const expected = path.resolve(path.resolve(portCwd), rel);
  expect(command.includes(`export GUILD_TASK_ASSIGNMENT=${shellQuote(expected)}; `)).toBe(true);
  return expected;
}

/** Synthetic TaskCompleted to the hook; `ref: null` leaves GUILD_TASK_ASSIGNMENT unset (native discovery). */
function runHook(layer: string, f: Fx, ref: string | null, o: { bound?: boolean; cwd?: string } = {}) {
  const [bin, args] = LAYERS[layer]!;
  const env: Record<string, string | undefined> = { ...hermeticEnv(), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: RUN_ID,
    GUILD_STATE_HOME: path.join(f.ext, "state"), GUILD_CACHE_HOME: path.join(f.ext, "cache"), GUILD_TEMP_HOME: path.join(f.ext, "temp"),
    ...(ref !== null ? { GUILD_TASK_ASSIGNMENT: ref } : {}), ...(o.bound ? { GUILD_RUN_BINDING_REF: f.bindingRef } : {}) };
  const r = spawnSync(bin, args, {
    input: JSON.stringify({ session_id: "e00-habs", cwd: o.cwd ?? f.cwd, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: f.c.assignment.worker_role, team_name: "guild-team" }),
    encoding: "utf8", env, timeout: 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n); const s = fs.lstatSync(p); const k = path.relative(dir, p);
      if (s.isSymbolicLink()) out[k] = `link:${fs.readlinkSync(p)}`;
      else if (s.isDirectory()) { out[k] = "dir"; walk(p); }
      else if (s.isFile()) out[k] = sha(fs.readFileSync(p));
      else out[k] = "special";
    }
  };
  walk(dir);
  return out;
}
const delta = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const otherWrites = (f: Fx, changed: string[]) => { const rel = path.relative(f.root, f.notice); return changed.filter((k) => k !== rel && !rel.startsWith(`${k}${path.sep}`)); };
const SECRET_REFUSAL = /TaskCell task-completed notice refused for task "task-001" — secret_scrub_required \(no write performed\)\.$/;
const finalBlocked = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[task-completed] BLOCKED:")).pop() ?? null;
/** The contained assignment the existing physical-containment reader loads for `ref` under `cwd` (null when refused). */
const loaded = (cwd: string, ref: string) => readTaskAssignmentV2(cwd, ref)?.assignment_path ?? null;
const pointerOf = (f: Fx) => { const p = path.join(f.root, f.c.assignment.handoff_path); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null; };
/** Readable E00 assignments that name this run/task/worker (what native discovery would see). */
function nativeE00(f: Fx): number {
  const cells = path.join(f.root, ".guild", "runs", RUN_ID, "task-cells");
  return (fs.readdirSync(cells, { recursive: true }) as string[]).filter((e) => path.basename(e) === "assignment.json").filter((e) => {
    const a = readTaskAssignmentV2(f.root, path.relative(f.root, path.join(cells, e)));
    return a !== null && a.logical_task_id === "task-001" && a.worker_role === "backend" && Object.prototype.hasOwnProperty.call(a, "done_when_ref");
  }).length;
}

function noticeOnly(layer: string, f: Fx, ref: string | null, cwd?: string) {
  const before = tree(f.root); const extBefore = tree(f.ext);
  const r = runHook(layer, f, ref, { cwd });
  expect(r.timedOut).toBe(false);
  return { status: r.status, notice_written: fs.existsSync(f.notice), other_writes: otherWrites(f, delta(before, tree(f.root))),
    state_cache_writes: delta(extBefore, tree(f.ext)).length, receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content };
}
const NOTICE_ONLY = { status: 0, notice_written: true, other_writes: [], state_cache_writes: 0, receipt_unchanged: true };

function zeroWriteRefusal(layer: string, f: Fx, ref: string | null, canary: string | null, others: string[] = []) {
  const before = tree(f.root); const extBefore = tree(f.ext); const othersBefore = others.map(tree);
  const r = runHook(layer, f, ref);
  expect(r.timedOut).toBe(false);
  return { refused: r.status !== 0 && r.status !== null, root_writes: delta(before, tree(f.root)), state_cache_writes: delta(extBefore, tree(f.ext)).length,
    other_root_writes: others.map((o, i) => delta(othersBefore[i]!, tree(o)).length).reduce((a, b) => a + b, 0),
    notice_written: fs.existsSync(f.notice), receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content,
    canary_in_output: canary !== null && `${r.stdout}${r.stderr}`.includes(canary) };
}
const ZERO = { refused: true, root_writes: [], state_cache_writes: 0, other_root_writes: 0, notice_written: false, receipt_unchanged: true, canary_in_output: false };

// ── Negative ref builders: each returns the ref plus the setup facts it must satisfy ──

type Neg = { id: string; label: string; fx?: { extraTask?: string; secondAttempt?: boolean };
  build: (f: Fx) => { ref: string | null; others: string[]; facts: Record<string, unknown>; expectFacts: Record<string, unknown> } };
const NEGATIVES: Neg[] = [
  { id: "N1", label: "another root's valid E00 assignment (foreign root)", build: (f) => {
    const other = fixture();
    const ref = producerRef(other.cwd, other.rel);
    return { ref, others: [other.root], facts: { distinct_physical_root: fs.realpathSync(other.root) !== fs.realpathSync(f.root), loads_in_foreign: loaded(other.cwd, ref), loads_in_this_root: loaded(f.cwd, ref) },
      expectFacts: { distinct_physical_root: true, loads_in_foreign: other.rel, loads_in_this_root: null } };
  } },
  { id: "N2", label: "non-normalized spelling (a '.' segment) of this root's own assignment", build: (f) => {
    const abs = producerRef(f.cwd, f.rel);
    const ref = abs.replace(`${path.sep}.guild${path.sep}runs${path.sep}`, `${path.sep}.guild${path.sep}.${path.sep}runs${path.sep}`);
    return { ref, others: [], facts: { differs: ref !== abs, normalizes_to_producer: path.normalize(ref) === abs, loads: loaded(f.cwd, ref) },
      expectFacts: { differs: true, normalizes_to_producer: true, loads: f.rel } };
  } },
  { id: "N3", label: "in-root symlink segment naming this root's own assignment", build: (f) => {
    const cells = path.join(f.root, ".guild", "runs", RUN_ID, "task-cells");
    fs.symlinkSync(path.join(cells, "task-001"), path.join(cells, "task-alias"));
    const ref = path.join(f.cwd, f.rel.replace(`${path.sep}task-cells${path.sep}task-001${path.sep}`, `${path.sep}task-cells${path.sep}task-alias${path.sep}`));
    return { ref, others: [], facts: { same_file: fs.realpathSync(ref) === fs.realpathSync(path.join(f.root, f.rel)), via_alias: ref.includes(`${path.sep}task-alias${path.sep}`), reader_refuses: loaded(f.cwd, ref) === null },
      expectFacts: { same_file: true, via_alias: true, reader_refuses: true } };
  } },
  { id: "N4", label: "a readable E00 assignment of another task in this root (mismatched)", fx: { extraTask: "task-002" }, build: (f) => {
    const otherRel = cell("task-002").assignment.assignment_path;
    const ref = producerRef(f.cwd, otherRel, "task-002");
    const a = readTaskAssignmentV2(f.cwd, ref);
    return { ref, others: [], facts: { loads: a?.assignment_path ?? null, e00: a !== null && Object.prototype.hasOwnProperty.call(a, "done_when_ref"), task: a?.logical_task_id ?? null },
      expectFacts: { loads: otherRel, e00: true, task: "task-002" } };
  } },
  { id: "N5", label: "no env ref with two readable E00 assignments for this task (native ambiguity)", fx: { secondAttempt: true }, build: (f) => ({
    ref: null, others: [], facts: { native_e00_matches: nativeE00(f) }, expectFacts: { native_e00_matches: 2 } }) },
];

for (const layer of SELECTED !== undefined ? [SELECTED] : Object.keys(LAYERS)) {
  describe(`[${layer}] H-ABS1 · an absolute ref naming the same physical root's canonical E00 assignment binds`, () => {
    it("P1 producer logical ref, logical hook root: exit 0, the notice is the only write, receipt unchanged", () => {
      const f = fixture();
      const ref = producerRef(f.cwd, f.rel);
      expect({ absolute: path.isAbsolute(ref), logical_spelling: f.cwd !== fs.realpathSync(f.cwd) && ref.startsWith(`${f.cwd}${path.sep}`), loads: loaded(f.cwd, ref) })
        .toEqual({ absolute: true, logical_spelling: true, loads: f.rel });
      expect(noticeOnly(layer, f, ref)).toEqual(NOTICE_ONLY);
    });

    it("P2 producer physical ref (port cwd realpath), logical hook root: exit 0, the notice is the only write", () => {
      const f = fixture();
      const ref = producerRef(f.root, f.rel);
      expect({ physical_spelling: ref.startsWith(`${fs.realpathSync(f.cwd)}${path.sep}`), hook_logical: f.cwd !== fs.realpathSync(f.cwd), loads: loaded(f.cwd, ref) })
        .toEqual({ physical_spelling: true, hook_logical: true, loads: f.rel });
      expect(noticeOnly(layer, f, ref)).toEqual(NOTICE_ONLY);
    });

    it("P3 producer logical ref, physical hook root: exit 0, the notice is the only write", () => {
      const f = fixture();
      const ref = producerRef(f.cwd, f.rel);
      expect({ ref_logical: ref.startsWith(`${f.cwd}${path.sep}`) && f.cwd !== f.root, hook_physical: f.root === fs.realpathSync(f.root), loads: loaded(f.root, ref) })
        .toEqual({ ref_logical: true, hook_physical: true, loads: f.rel });
      expect(noticeOnly(layer, f, ref, f.root)).toEqual(NOTICE_ONLY);
    });

    it("P4 whole-root alias (an outside link to the same root) as the producer cwd: exit 0, the notice is the only write", () => {
      const f = fixture();
      const alias = path.join(ownedTempDir("guild-e00-habs-alias-"), "alias");
      fs.symlinkSync(f.root, alias);
      const ref = producerRef(alias, f.rel);
      expect({ same_physical_root: fs.realpathSync(alias) === fs.realpathSync(f.root), alias_spelling: ref.startsWith(`${alias}${path.sep}`), loads: loaded(f.cwd, ref) })
        .toEqual({ same_physical_root: true, alias_spelling: true, loads: f.rel });
      expect(noticeOnly(layer, f, ref)).toEqual(NOTICE_ONLY);
    });

    it("R3 producer ref with a secret-bearing receipt: generic secret_scrub_required, receipt unchanged, zero writes", () => {
      const canary = awsCanary();
      const f = fixture({ canary });
      const ref = producerRef(f.cwd, f.rel);
      expect({ loads: loaded(f.cwd, ref), receipt_has_canary: f.content.includes(canary) }).toEqual({ loads: f.rel, receipt_has_canary: true });
      const before = tree(f.root);
      const r = runHook(layer, f, ref);
      expect(r.timedOut).toBe(false);
      const last = finalBlocked(r.stderr);
      expect({ refused: r.status !== 0, final_secret_scrub_required: last !== null && SECRET_REFUSAL.test(last), canary_in_output: `${r.stdout}${r.stderr}`.includes(canary),
        root_writes: delta(before, tree(f.root)), notice_written: fs.existsSync(f.notice), receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content })
        .toEqual({ refused: true, final_secret_scrub_required: true, canary_in_output: false, root_writes: [], notice_written: false, receipt_unchanged: true });
    });

    it("R4 producer ref on an unmarked root: notice only, no layout marker, no wiki or state/cache writes", () => {
      const f = fixture({ layout: false });
      const ref = producerRef(f.cwd, f.rel);
      const wiki = path.join(f.root, ".guild", "wiki");
      const wikiBefore = fs.existsSync(wiki);
      expect({ unmarked: !fs.existsSync(f.marker), loads: loaded(f.cwd, ref) }).toEqual({ unmarked: true, loads: f.rel });
      const out = noticeOnly(layer, f, ref);
      expect({ ...out, marker_written: fs.existsSync(f.marker), wiki_created: !wikiBefore && fs.existsSync(wiki) })
        .toEqual({ ...NOTICE_ONLY, marker_written: false, wiki_created: false });
    });

    it("C2 bound path: the producer ref publishes the same pointer as the canonical relative ref", () => {
      const rel = fixture();
      const abs = fixture();
      const ref = producerRef(abs.cwd, abs.rel);
      const r1 = runHook(layer, rel, rel.rel, { bound: true });
      const r2 = runHook(layer, abs, ref, { bound: true });
      const p1 = pointerOf(rel); const p2 = pointerOf(abs);
      expect({ relative_status: r1.status, absolute_status: r2.status, relative_pointer: p1 !== null, absolute_pointer: p2 !== null,
        same_receipt_id: p1 !== null && p2 !== null && p1.receipt_id === p2.receipt_id, same_receipt_path: p1 !== null && p2 !== null && p1.receipt_path === p2.receipt_path })
        .toEqual({ relative_status: 0, absolute_status: 0, relative_pointer: true, absolute_pointer: true, same_receipt_id: true, same_receipt_path: true });
    });
  });

  describe(`[${layer}] H-ABS1 · a known E00 lane that cannot bind refuses before any write`, () => {
    for (const n of NEGATIVES) {
      it(`${n.id} ${n.label}: refused with zero writes and no notice`, () => {
        const f = fixture({ ...n.fx });
        const b = n.build(f);
        expect(b.facts).toEqual(b.expectFacts);
        expect(zeroWriteRefusal(layer, f, b.ref, null, b.others)).toEqual(ZERO);
      });
      it(`${n.id} ${n.label} with a secret-bearing receipt: refused with zero writes, receipt unchanged (no fall-through to the scrub)`, () => {
        const canary = awsCanary();
        const f = fixture({ ...n.fx, canary });
        const b = n.build(f);
        expect(b.facts).toEqual(b.expectFacts);
        expect(zeroWriteRefusal(layer, f, b.ref, canary, b.others)).toEqual(ZERO);
      });
    }
    for (const n of NEGATIVES.filter((x) => x.id === "N2" || x.id === "N5")) {
      it(`${n.id} ${n.label} on an unmarked root: refused with zero writes, no layout marker (no fall-through to the bootstrap)`, () => {
        const f = fixture({ ...n.fx, layout: false });
        const b = n.build(f);
        expect({ unmarked: !fs.existsSync(f.marker), facts: b.facts }).toEqual({ unmarked: true, facts: b.expectFacts });
        expect({ ...zeroWriteRefusal(layer, f, b.ref, null, b.others), marker_written: fs.existsSync(f.marker) }).toEqual({ ...ZERO, marker_written: false });
      });
    }
  });

  describe(`[${layer}] H-ABS1 controls · canonical relative and non-E00 refs keep today's behaviour`, () => {
    it("K1 canonical relative ref: exit 0, the notice is the only write", () => {
      const f = fixture();
      expect(noticeOnly(layer, f, f.rel)).toEqual(NOTICE_ONLY);
    });
    it("K2 canonical relative ref on the bound path: exit 0 and the pointer is published", () => {
      const f = fixture();
      const r = runHook(layer, f, f.rel, { bound: true });
      expect({ status: r.status, pointer: pointerOf(f) !== null }).toEqual({ status: 0, pointer: true });
    });
    it("K3 non-E00 (legacy) relative assignment, unbound: keeps its refusal and writes no notice", () => {
      const f = fixture({ legacy: true });
      expect(Object.prototype.hasOwnProperty.call(readTaskAssignmentV2(f.cwd, f.rel) ?? {}, "done_when_ref")).toBe(false);
      const r = runHook(layer, f, f.rel);
      expect({ refused: r.status !== 0, message: /did not authorize this TaskCompleted write/.test(r.stderr), notice: fs.existsSync(f.notice) })
        .toEqual({ refused: true, message: true, notice: false });
    });
  });
}
