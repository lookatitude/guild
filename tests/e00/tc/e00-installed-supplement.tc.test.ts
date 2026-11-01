/**
 * E00-T0 · TC tier — installed-package SUPPLEMENT (authored at T0, EXECUTED by E00-Q after the
 * genuine clean reviewed basis and build). Plans: evidence/e00-q/installed-coverage-read-plan.json
 * (S1-S8), .r2, .r3, .r4-addendum; decisions q-r3-plan-decisions.json and
 * h-r2-encoded-installed-coverage-followup.json. Same gate as e00-installed-package.tc.test.ts:
 * E00_TC_PACKAGE_ROOT closed ⇒ every case is reported "not executed" (bun skip); open ⇒ a missing
 * root/Q input or packaged entry FAILS its cases, never skips.
 *
 * S1-S5 run the PACKAGED hooks (node <pkg>/hooks/agent-team/dist/task-completed.js and
 * node <pkg>/hooks/dist/pre-tool-use.js) as a synthetic hook-event invocation on owned temp roots;
 * the event is not a native TaskCompleted. Fixture construction uses the canonical helpers the
 * source regressions use (buildTaskCell/writeTaskCell, mintRunBinding, receiptBytes, layout
 * provisioning, admitLane); no source hook, policy reader or validator decides any outcome here.
 *   S1 F1 + H2 privacy: clean notice-only; secret receipt (default policy, literal unknown key under
 *      the default and a configured pattern) and the encoded variants (\u-escaped unknown key,
 *      \u-escaped enum value, escaped-newline key) refuse secret_scrub_required with zero writes,
 *      no notice and no canary in stdout/stderr; a policy-clean escaped key keeps its SC-7 diagnostic.
 *   S1 H-ABS1: producer-form absolute refs (logical root, physical spelling, same-root whole-root alias)
 *      write only the notice; with a secret receipt or an unmarked root they keep the generic refusal /
 *      notice-only behaviour; foreign-root, non-normalized, in-root-alias refs and native E00 ambiguity
 *      (no env ref) refuse with zero writes. The producer form is path.resolve(root, assignment_path)
 *      (tmux-backend.ts assignmentAbs); its equality to the real pane export is proven by the frozen
 *      source e00-h-absolute-ref-ta, and the installed producer -> pane -> hook path is X1 (TC :354).
 *   S2 layout: absent marker notice-only; malformed, stale and future markers zero writes.
 *   S3 outbox containment: symlinked run/instance outbox and a FIFO leaf refuse without escape or hang.
 *   S4 idempotence: identical repeat keeps the first bytes; conflicting/malformed notice refused unchanged.
 *   S5 binding guard: Read, Grep, Glob, Bash, Write and Edit naming binding.json denied (binding_path_refused);
 *      a benign worker-owned control per tool is genuinely allowed (empty-stdout allow or an explicit allow).
 *   S6 is X1/X2 in e00-installed-package.tc.test.ts; not duplicated here.
 *   S7 report-only wrapper wall time (n>=5 per path, median/p95): clean notice path vs the opt-in
 *      early exit. Includes Node startup and every path difference; not digest-only, not model latency;
 *      billed_usd null/unmeasured.
 * S8 installed facade (task-cell-api) with a transport double, genuine basis, installed ack/decide
 *    CLIs; no TaskCompleted hook. The fault (settings state, then the receipt) is written once by the
 *    double's sleep only when controller/handles/<iid>.json is running AND the controller-recorded
 *    ack exists; the raw worker ack claim alone never triggers it.
 *    U1-U7 handoff_secret_policy_unavailable (U6/U7: malformed fail-mode objects, no exception text);
 *    V1-V2 handoff_secret_scrub_required; K1-K2 byte-identical publication and acceptance; T4a/T4b
 *    terminate confirmed/refused, with the installed facade started at maxInstances 1 and a second lane T2:
 *    T4b's refused teardown keeps T1's slot, so the installed admission refuses T2 on the instance cap;
 *    T4a's confirmed teardown frees it, so T2 is admitted (non-vacuity control). F3 is compiled-runtime fault injection (mechanics): an in-process,
 *    path-keyed wrapper on the fs export the compiled pointer writer calls, installed in the double
 *    before task-cell-api is required. F2 (pre-publication replacement) is source-only
 *    (e00-c-r13-ta R4) and recorded unexecuted at the installed boundary.
 * cooperative_local only; no same-UID isolation claim.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../../src/domains/dispatch";
import { mintRunBinding } from "../../../src/domains/lifecycle";
import { readVerifiedReleasePackageIdentity } from "../../../src/domains/distribution";
import { ensureStorageLayout } from "../../../hooks/lib/ensure-layout";
import { CURRENT_LAYOUT_VERSION } from "../../../scripts/lib/state/ensure-storage-layout";
import { admitLane } from "../../../scripts/lib/host/__tests__/admit-lane";
import { FULL_RUNGS, ownedTempDir, receiptBytes, sha256, teardownOwned } from "../support/e00-harness";
import { TC_LEAD, buildTcRoot, type TcRoot } from "./tc-fixture";

afterEach(teardownOwned);

const PKG = process.env["E00_TC_PACKAGE_ROOT"] ?? "";
const enabled = PKG.length > 0 && path.isAbsolute(PKG) && fs.existsSync(PKG);
const NODE = process.env["E00_TC_NODE"] ?? "node";
const T = 300_000;

const script = (id: string) => path.join(PKG, "runtime", "scripts", `${id}.js`);
function packaged(rel: string): string {
  const p = path.join(PKG, rel);
  if (!fs.existsSync(p)) throw new Error(`TC supplement: packaged entry ${rel} is missing from E00_TC_PACKAGE_ROOT`);
  return p;
}
function requireBasis(): string {
  const v = process.env["E00_TC_REVIEWED_BASIS"] ?? "";
  if (!path.isAbsolute(v) || !fs.existsSync(v)) throw new Error("TC input E00_TC_REVIEWED_BASIS not supplied by root/Q (absolute existing path required)");
  return v;
}
function hermetic(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith("GUILD_") && !k.startsWith("E00_") && k !== "TMUX" && k !== "TMUX_PANE" && v !== undefined) env[k] = v;
  return env;
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n); const s = fs.lstatSync(p); const k = path.relative(dir, p);
      if (s.isSymbolicLink()) out[k] = `link:${fs.readlinkSync(p)}`;
      else if (s.isDirectory()) { out[k] = "dir"; walk(p); }
      else if (s.isFile()) out[k] = sha256(fs.readFileSync(p));
      else out[k] = "special";
    }
  };
  walk(dir);
  return out;
}
const delta = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const letters = (n: number) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join("");
const awsCanary = () => `AKIA${crypto.randomBytes(12).toString("hex").toUpperCase().slice(0, 16)}`;
const escapeFirst = (s: string) => `\\u${s.charCodeAt(0).toString(16).padStart(4, "0")}${s.slice(1)}`;
/** Booleans only: does any regular file under `dir` (except `skip`) contain `needle`. */
function anyFileContains(dir: string, needle: string, skip: string | null = null): boolean {
  if (!fs.existsSync(dir)) return false;
  for (const rel of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const f = path.join(dir, String(rel));
    if (f === skip) continue;
    try { if (fs.lstatSync(f).isFile() && fs.readFileSync(f).includes(needle)) return true; } catch { /* not a hit */ }
  }
  return false;
}

// ── S1-S4 fixture: one E00 TaskCell assignment and its lane receipt (same shape as the H1/H2 regressions) ──

const RUN_ID = "run-e00-tcs";
const CFG_PATTERN = "E00TCSCFG-[a-z]{8}";
const NL_PATTERN = "E00TCSNL-[a-z]{4}\\n[a-z]{4}";

interface Fx { root: string; cwd: string; ext: string; c: ReturnType<typeof buildTaskCell>; receipt: string; notice: string; marker: string; content: string }
/** The logical spelling of a physical temp root (macOS /var -> /private/var); the root itself when none exists. */
function logicalOf(root: string): string {
  const phys = fs.realpathSync(root);
  const logical = phys.startsWith("/private/var/") ? phys.slice("/private".length) : phys;
  return fs.existsSync(logical) && fs.realpathSync(logical) === phys ? logical : root;
}
function cell(taskId: string, attempt = 1) {
  return buildTaskCell({
    runId: RUN_ID, logicalTaskId: taskId, taskRunId: `${taskId}.tr1`, attempt, attemptId: `${taskId}.att${attempt}`,
    instanceId: `${taskId}.a${attempt}.i1`, cellId: `cell-${taskId}`, goalId: "goal-e00", phaseId: "build", stepId: taskId,
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-${taskId}.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 tc supplement", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
    ...(attempt > 1 ? { previousAttemptId: `${taskId}.att${attempt - 1}`, retryReason: "e00 tc supplement native ambiguity fixture" } : {}),
  });
}
function fixture(o: { edit?: (body: string) => string; patterns?: string[]; layout?: boolean; extraTask?: string; secondAttempt?: boolean } = {}): Fx {
  const root = ownedTempDir("guild-e00-tcs-");
  const cwd = logicalOf(root);
  const ext = ownedTempDir("guild-e00-tcs-ext-");
  for (const d of ["state", "cache", "temp"]) fs.mkdirSync(path.join(ext, d), { recursive: true });
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const e00 = (x: ReturnType<typeof cell>) => {
    (x.assignment as Record<string, unknown>)["done_when_ref"] = {
      oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64),
    };
    writeTaskCell(root, x, { binding_ref: bindingRef });
  };
  const c = cell("task-001");
  e00(c);
  if (o.extraTask) e00(cell(o.extraTask));
  if (o.secondAttempt) e00(cell("task-001", 2));
  const receipt = path.join(root, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  const base = receiptBytes(RUN_ID, c.assignment);
  const content = o.edit ? o.edit(base) : base;
  if (o.edit) expect(content !== base).toBe(true);
  fs.writeFileSync(receipt, content);
  if (o.layout !== false) expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  if (o.patterns) fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ secrets_policy: { redaction_patterns: o.patterns } }, null, 2) + "\n");
  const notice = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  return { root, cwd, ext, c, receipt, notice, marker: path.join(root, ".guild", "storage-layout.json"), content };
}
const bodyCanary = (canary: string) => (b: string) => b.replace("- runtime collection", `- runtime collection ${canary}`);
const extraKey = (rawKeyJson: string) => (b: string) => b.replace(`"issues":[]}`, `"issues":[],"${rawKeyJson}":"x"}`);
const tierValue = (rawValueJson: string) => (b: string) => b.replace(`"tier":"mid"`, `"tier":"${rawValueJson}"`);
/** The test's own envelope parse (fixture precondition only; never the product validator). */
const envelopeOf = (content: string): Record<string, unknown> | null => {
  const m = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/.exec(content);
  try { return m ? (JSON.parse(m[1]!.trim()) as Record<string, unknown>) : null; } catch { return null; }
};

/**
 * Synthetic TaskCompleted event to the PACKAGED hook, unbound (no binding ref). `ref` defaults to the canonical relative
 * assignment path the source regressions pass; a string is passed as given; null leaves GUILD_TASK_ASSIGNMENT unset.
 */
function runHook(f: Fx, o: { optIn?: boolean; timeoutMs?: number; ref?: string | null; cwd?: string } = {}) {
  const ref = o.ref === undefined ? f.c.assignment.assignment_path : o.ref;
  const env: Record<string, string> = { ...hermetic(), GUILD_RUN_ID: RUN_ID, ...(ref !== null ? { GUILD_TASK_ASSIGNMENT: ref } : {}),
    GUILD_STATE_HOME: path.join(f.ext, "state"), GUILD_CACHE_HOME: path.join(f.ext, "cache"), GUILD_TEMP_HOME: path.join(f.ext, "temp") };
  if (o.optIn !== false) env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1";
  const t0 = performance.now();
  const r = spawnSync(NODE, [packaged("hooks/agent-team/dist/task-completed.js")], {
    input: JSON.stringify({ session_id: "e00-tcs", cwd: o.cwd ?? f.cwd, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: f.c.assignment.worker_role, team_name: "guild-team" }),
    encoding: "utf8", env, timeout: o.timeoutMs ?? 60_000,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", ms: performance.now() - t0, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
}
const SECRET_REFUSAL = /TaskCell task-completed notice refused for task "task-001" — secret_scrub_required \(no write performed\)\.$/;
const finalBlocked = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[task-completed] BLOCKED:")).pop() ?? null;
const stateCache = (f: Fx) => ({ ...Object.fromEntries(Object.entries(tree(path.join(f.ext, "state"))).map(([k, v]) => [`state/${k}`, v])),
  ...Object.fromEntries(Object.entries(tree(path.join(f.ext, "cache"))).map(([k, v]) => [`cache/${k}`, v])) });
const otherWrites = (f: Fx, changed: string[]) => { const rel = path.relative(f.root, f.notice); return changed.filter((k) => k !== rel && !rel.startsWith(`${k}${path.sep}`)); };

/** Run once; summarize as booleans (a canary is never echoed). */
function refusal(f: Fx, canary: string | null, ref?: string | null, others: string[] = []) {
  const before = tree(f.root); const othersBefore = others.map(tree);
  const r = runHook(f, { ref });
  expect(r.timedOut).toBe(false);
  const last = finalBlocked(r.stderr);
  return {
    refused: r.status !== 0 && r.status !== null,
    final_secret_scrub_required: last !== null && SECRET_REFUSAL.test(last),
    canary_in_stdout: canary !== null && r.stdout.includes(canary),
    canary_in_stderr: canary !== null && r.stderr.includes(canary),
    tree_writes: delta(before, tree(f.root)).length + others.map((d, i) => delta(othersBefore[i]!, tree(d)).length).reduce((x, y) => x + y, 0),
    notice_written: fs.existsSync(f.notice),
    receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content,
  };
}
const RED = { refused: true, final_secret_scrub_required: true, canary_in_stdout: false, canary_in_stderr: false, tree_writes: 0, notice_written: false, receipt_unchanged: true };

// ── S1 · F1 and H2 privacy at the packaged TaskCompleted boundary ──

describe.skipIf(!enabled)("TC supplement S1 · packaged TaskCompleted: unbound E00 writes only its notice; secrets refuse generically", () => {
  it("S1 clean receipt: exit 0, the notice is the only root write, receipt unchanged, notice package_identity is the installed identity", () => {
    const f = fixture();
    const before = tree(f.root); const rStat = fs.statSync(f.receipt);
    const r = runHook(f);
    expect(r.timedOut).toBe(false);
    const id = readVerifiedReleasePackageIdentity(PKG) as unknown as { release_id: string; current_package: string; package_digests: Record<string, string> };
    const notice = fs.existsSync(f.notice) ? JSON.parse(fs.readFileSync(f.notice, "utf8")) : null;
    const after = fs.statSync(f.receipt);
    expect({ status: r.status, notice_written: notice !== null, other_writes: otherWrites(f, delta(before, tree(f.root))),
      receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content && after.mtimeMs === rStat.mtimeMs && after.ino === rStat.ino,
      package_identity: notice?.package_identity ?? null })
      .toEqual({ status: 0, notice_written: true, other_writes: [], receipt_unchanged: true,
        package_identity: { id: id.release_id, sha256: id.package_digests[id.current_package] } });
  });

  const arms: Array<[string, () => { canary: string; edit: (b: string) => string; patterns?: string[] }]> = [
    ["receipt body holding a default-policy canary (AWS key shape)", () => { const canary = awsCanary(); return { canary, edit: bodyCanary(canary) }; }],
    ["literal unknown envelope key holding a default-policy canary", () => { const canary = awsCanary(); return { canary, edit: extraKey(canary) }; }],
    ["literal unknown envelope key under a valid configured pattern", () => { const canary = `E00TCSCFG-${letters(8)}`; return { canary, edit: extraKey(canary), patterns: [CFG_PATTERN, NL_PATTERN] }; }],
  ];
  for (const [label, mk] of arms) {
    it(`S1 ${label}: secret_scrub_required, no canary in stdout/stderr, zero writes, no notice`, () => {
      const { canary, edit, patterns } = mk();
      const f = fixture({ edit, patterns });
      expect(f.content.includes(canary)).toBe(true);
      expect(refusal(f, canary)).toEqual(RED);
    });
  }

  // H2 encoded follow-up: the raw receipt never holds the literal canary; JSON decoding produces it.
  const encoded: Array<[string, () => { canary: string; edit: (b: string) => string; reserializedHolds: boolean }]> = [
    ["\\u-escaped unknown key (configured pattern)", () => { const canary = `E00TCSCFG-${letters(8)}`; return { canary, edit: extraKey(escapeFirst(canary)), reserializedHolds: true }; }],
    ["\\u-escaped tier enum value (configured pattern)", () => { const canary = `E00TCSCFG-${letters(8)}`; return { canary, edit: tierValue(escapeFirst(canary)), reserializedHolds: true }; }],
    ["escaped-newline unknown key (configured pattern; re-serialization re-escapes it)", () => {
      const head = `E00TCSNL-${letters(4)}`; const tail = letters(4);
      return { canary: `${head}\n${tail}`, edit: extraKey(`${head}\\n${tail}`), reserializedHolds: false };
    }],
  ];
  for (const [label, mk] of encoded) {
    it(`S1 encoded ${label}: secret_scrub_required, no canary in stdout/stderr, zero writes, no notice`, () => {
      const { canary, edit, reserializedHolds } = mk();
      const f = fixture({ edit, patterns: [CFG_PATTERN, NL_PATTERN] });
      const env = envelopeOf(f.content);
      expect({ raw_has_canary: f.content.includes(canary), decoded_has_canary: env !== null && (Object.keys(env).includes(canary) || Object.values(env).includes(canary)),
        reserialized_has_canary: env !== null && JSON.stringify(env).includes(canary) })
        .toEqual({ raw_has_canary: false, decoded_has_canary: true, reserialized_has_canary: reserializedHolds });
      expect(refusal(f, canary)).toEqual(RED);
    });
  }

  it("S1 control: a policy-clean \\u-escaped unknown key keeps the SC-7 diagnostic naming the decoded key, zero writes", () => {
    const key = "e00_tcs_extra_key";
    const f = fixture({ edit: extraKey(escapeFirst(key)), patterns: [CFG_PATTERN, NL_PATTERN] });
    expect(f.content.includes(key)).toBe(false);
    const before = tree(f.root);
    const r = runHook(f);
    expect(r.timedOut).toBe(false);
    expect({ refused: r.status !== 0, tree_writes: delta(before, tree(f.root)).length, notice_written: fs.existsSync(f.notice),
      invalid_envelope_diagnostic: /contains an invalid guild\.handoff\.v2 envelope/.test(r.stderr), names_decoded_key: r.stderr.includes(`unknown key "${key}"`) })
      .toEqual({ refused: true, tree_writes: 0, notice_written: false, invalid_envelope_diagnostic: true, names_decoded_key: true });
  });
});

// ── S1 · H-ABS1 absolute assignment references at the packaged TaskCompleted boundary ──

describe.skipIf(!enabled)("TC supplement S1 H-ABS1 · the packaged hook binds same-root absolute refs and refuses the rest before any write", () => {
  /** Notice-only outcome for `ref` with the hook cwd spelled `cwd`. */
  function noticeOnly(f: Fx, ref: string, cwd?: string) {
    const before = tree(f.root); const extBefore = { ...tree(path.join(f.ext, "state")), ...tree(path.join(f.ext, "cache")) };
    const r = runHook(f, { ref, cwd });
    expect(r.timedOut).toBe(false);
    return { status: r.status, notice_written: fs.existsSync(f.notice), other_writes: otherWrites(f, delta(before, tree(f.root))),
      state_cache_writes: delta(extBefore, { ...tree(path.join(f.ext, "state")), ...tree(path.join(f.ext, "cache")) }).length,
      receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content };
  }
  const NOTICE_ONLY = { status: 0, notice_written: true, other_writes: [], state_cache_writes: 0, receipt_unchanged: true };
  const producerForm = (portCwd: string, rel: string) => path.resolve(path.resolve(portCwd), rel);

  it("A1 producer-form logical absolute ref: exit 0, the notice is the only write", () => {
    const f = fixture();
    const ref = producerForm(f.cwd, f.c.assignment.assignment_path);
    expect({ absolute: path.isAbsolute(ref), logical: f.cwd !== fs.realpathSync(f.cwd), same_file: fs.realpathSync(ref) === fs.realpathSync(path.join(f.root, f.c.assignment.assignment_path)) })
      .toEqual({ absolute: true, logical: true, same_file: true });
    expect(noticeOnly(f, ref)).toEqual(NOTICE_ONLY);
  });

  it("A2 physical (realpath) spelling with a logical hook root, and the reverse: exit 0, the notice is the only write", () => {
    const f = fixture();
    const physical = producerForm(fs.realpathSync(f.cwd), f.c.assignment.assignment_path);
    expect(physical !== producerForm(f.cwd, f.c.assignment.assignment_path)).toBe(true);
    expect(noticeOnly(f, physical)).toEqual(NOTICE_ONLY);
    const g = fixture();
    expect(noticeOnly(g, producerForm(g.cwd, g.c.assignment.assignment_path), fs.realpathSync(g.cwd))).toEqual(NOTICE_ONLY);
  });

  it("A3 whole-root alias (an outside link to the same physical root): exit 0, the notice is the only write", () => {
    const f = fixture();
    const alias = path.join(ownedTempDir("guild-e00-tcs-alias-"), "alias");
    fs.symlinkSync(f.root, alias);
    const ref = producerForm(alias, f.c.assignment.assignment_path);
    expect(fs.realpathSync(alias) === fs.realpathSync(f.root)).toBe(true);
    expect(noticeOnly(f, ref)).toEqual(NOTICE_ONLY);
  });

  it("A4 producer-form ref with a secret-bearing receipt: generic secret_scrub_required, no canary in output, zero writes, no notice", () => {
    const canary = awsCanary();
    const f = fixture({ edit: bodyCanary(canary) });
    expect(refusal(f, canary, producerForm(f.cwd, f.c.assignment.assignment_path))).toEqual(RED);
  });

  it("A5 producer-form ref on an unmarked root: notice only, no layout marker, no wiki", () => {
    const f = fixture({ layout: false });
    fs.rmSync(f.marker, { force: true });
    const wiki = path.join(f.root, ".guild", "wiki");
    const wikiBefore = fs.existsSync(wiki);
    expect({ ...noticeOnly(f, producerForm(f.cwd, f.c.assignment.assignment_path)), marker_written: fs.existsSync(f.marker), wiki_created: !wikiBefore && fs.existsSync(wiki) })
      .toEqual({ ...NOTICE_ONLY, marker_written: false, wiki_created: false });
  });

  const ZERO = { ...RED, final_secret_scrub_required: false };
  const negatives: Array<[string, { extraTask?: string; secondAttempt?: boolean }, (f: Fx) => { ref: string | null; others: string[]; ok: boolean }]> = [
    ["N1 another root's valid E00 assignment (foreign root)", {}, (f) => {
      const other = fixture();
      return { ref: producerForm(other.cwd, other.c.assignment.assignment_path), others: [other.root], ok: fs.realpathSync(other.root) !== fs.realpathSync(f.root) };
    }],
    ["N2 non-normalized spelling ('.' segment) of this root's own assignment", {}, (f) => {
      const abs = producerForm(f.cwd, f.c.assignment.assignment_path);
      const ref = abs.replace(`${path.sep}.guild${path.sep}runs${path.sep}`, `${path.sep}.guild${path.sep}.${path.sep}runs${path.sep}`);
      return { ref, others: [], ok: ref !== abs && path.normalize(ref) === abs };
    }],
    ["N3 in-root symlink segment naming this root's own assignment", {}, (f) => {
      const cells = path.join(f.root, ".guild", "runs", RUN_ID, "task-cells");
      fs.symlinkSync(path.join(cells, "task-001"), path.join(cells, "task-alias"));
      const rel = f.c.assignment.assignment_path.replace(`${path.sep}task-cells${path.sep}task-001${path.sep}`, `${path.sep}task-cells${path.sep}task-alias${path.sep}`);
      const ref = path.join(f.cwd, rel);
      return { ref, others: [], ok: rel !== f.c.assignment.assignment_path && fs.realpathSync(ref) === fs.realpathSync(path.join(f.root, f.c.assignment.assignment_path)) };
    }],
    ["N4 another task's readable E00 assignment in this root (mismatched)", { extraTask: "task-002" }, (f) => {
      const ref = producerForm(f.cwd, cell("task-002").assignment.assignment_path);
      return { ref, others: [], ok: fs.existsSync(ref) };
    }],
    ["N5 no env ref with two readable E00 assignments for this task (native ambiguity)", { secondAttempt: true }, (f) => {
      const cells = path.join(f.root, ".guild", "runs", RUN_ID, "task-cells", "task-001");
      const count = (fs.readdirSync(cells, { recursive: true }) as string[]).filter((e) => path.basename(e) === "assignment.json").length;
      return { ref: null, others: [], ok: count === 2 };
    }],
  ];
  for (const [label, fx, build] of negatives) {
    it(`${label}, secret-bearing receipt: refused with zero writes, receipt unchanged, no notice, no canary (no fall-through to the scrub)`, () => {
      const canary = awsCanary();
      const f = fixture({ ...fx, edit: bodyCanary(canary) });
      const b = build(f);
      expect(b.ok).toBe(true);
      expect(refusal(f, canary, b.ref, b.others)).toEqual(ZERO);
    });
  }

  it("N5 native ambiguity on an unmarked root: refused with zero writes, no layout marker (no fall-through to the bootstrap)", () => {
    const f = fixture({ secondAttempt: true, layout: false });
    fs.rmSync(f.marker, { force: true });
    const out = refusal(f, null, null);
    expect({ refused: out.refused, tree_writes: out.tree_writes, notice_written: out.notice_written, marker_written: fs.existsSync(f.marker) })
      .toEqual({ refused: true, tree_writes: 0, notice_written: false, marker_written: false });
  });
});

// ── S2 · layout at the packaged boundary ──

describe.skipIf(!enabled)("TC supplement S2 · packaged TaskCompleted never upgrades or writes on a non-current layout", () => {
  it("S2 absent marker with a valid current-format E00 assignment: exit 0, notice only, zero state/cache writes", () => {
    const f = fixture({ layout: false });
    fs.rmSync(f.marker, { force: true });
    const rootBefore = tree(f.root); const extBefore = stateCache(f);
    const r = runHook(f);
    expect(r.timedOut).toBe(false);
    expect({ status: r.status, notice_written: fs.existsSync(f.notice), marker_written: fs.existsSync(f.marker),
      other_writes: otherWrites(f, delta(rootBefore, tree(f.root))), state_cache_delta: delta(extBefore, stateCache(f)) })
      .toEqual({ status: 0, notice_written: true, marker_written: false, other_writes: [], state_cache_delta: [] });
  });

  const markers: Array<[string, string]> = [
    ["malformed marker", "{ not json\n"],
    ["stale marker (older layout version)", JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION - 1 }) + "\n"],
    ["future marker (newer layout version)", JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION + 1 }) + "\n"],
  ];
  for (const [label, bytes] of markers) {
    it(`S2 ${label}: zero writes in the root and in state/cache, no notice`, () => {
      const f = fixture({ layout: false });
      fs.writeFileSync(f.marker, bytes);
      const rootBefore = tree(f.root); const extBefore = stateCache(f);
      const r = runHook(f);
      expect({ timed_out: r.timedOut, notice_written: fs.existsSync(f.notice), root_delta: delta(rootBefore, tree(f.root)), state_cache_delta: delta(extBefore, stateCache(f)) })
        .toEqual({ timed_out: false, notice_written: false, root_delta: [], state_cache_delta: [] });
    });
  }
});

// ── S3 · outbox containment ──

describe.skipIf(!enabled)("TC supplement S3 · the packaged notice never lands outside the exact run/instance outbox", () => {
  const parents: Array<[string, (f: Fx) => string]> = [
    ["the run outbox directory", (f) => path.join(f.root, ".guild", "runs", RUN_ID, "outbox")],
    ["the instance outbox directory", (f) => path.dirname(f.notice)],
  ];
  for (const [label, where] of parents) {
    it(`S3 ${label} is a symlink to an owned outside directory: refused, no write in the root, state/cache or outside`, () => {
      const f = fixture();
      const outside = ownedTempDir("guild-e00-tcs-outside-");
      const link = where(f);
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(outside, link);
      const rootBefore = tree(f.root); const extBefore = stateCache(f); const outsideBefore = tree(outside);
      const r = runHook(f);
      expect({ timed_out: r.timedOut, refused: r.status !== 0, root_delta: delta(rootBefore, tree(f.root)), state_cache_delta: delta(extBefore, stateCache(f)),
        outside_delta: delta(outsideBefore, tree(outside)), outside_entries: fs.readdirSync(outside, { recursive: true }).length })
        .toEqual({ timed_out: false, refused: true, root_delta: [], state_cache_delta: [], outside_delta: [], outside_entries: 0 });
    });
  }

  it("S3 a FIFO at the notice path: refused without opening it (no hang), the FIFO kept", () => {
    const f = fixture();
    fs.mkdirSync(path.dirname(f.notice), { recursive: true });
    expect(spawnSync("mkfifo", [f.notice]).status).toBe(0);
    const r = runHook(f, { timeoutMs: 20_000 });
    expect({ timed_out: r.timedOut, refused: r.status !== 0, still_fifo: fs.lstatSync(f.notice).isFIFO() })
      .toEqual({ timed_out: false, refused: true, still_fifo: true });
  });
});

// ── S4 · notice idempotence ──

describe.skipIf(!enabled)("TC supplement S4 · a repeated packaged notice is idempotent; a conflicting one is refused without overwrite", () => {
  it("S4 identical repeated callback: both succeed and the first notice bytes are kept", () => {
    const f = fixture();
    const first = runHook(f);
    expect({ first_ok: first.status === 0, notice: fs.existsSync(f.notice) }).toEqual({ first_ok: true, notice: true });
    const bytes = fs.readFileSync(f.notice);
    const second = runHook(f);
    expect({ second_ok: second.status === 0, bytes_kept: fs.readFileSync(f.notice).equals(bytes) }).toEqual({ second_ok: true, bytes_kept: true });
  });

  const conflicting: Array<[string, (f: Fx) => string]> = [
    ["a notice for a different assignment", (f) => JSON.stringify({ schema_version: "guild.task_completed_notice.v1", run_id: RUN_ID, assignment_id: "other:1:other", instance_id: f.c.assignment.instance_id, noticed_at: "2026-10-26T13:00:00.000Z" }, null, 2) + "\n"],
    ["a malformed notice", () => "{ not json\n"],
  ];
  for (const [label, body] of conflicting) {
    it(`S4 ${label} already present: refused and the existing bytes stay`, () => {
      const f = fixture();
      fs.mkdirSync(path.dirname(f.notice), { recursive: true });
      const b = body(f);
      fs.writeFileSync(f.notice, b);
      const r = runHook(f);
      expect({ timed_out: r.timedOut, refused: r.status !== 0, bytes_kept: fs.readFileSync(f.notice, "utf8") === b }).toEqual({ timed_out: false, refused: true, bytes_kept: true });
    });
  }
});

// ── S5 · packaged PreToolUse binding guard ──

const GUARD_RUN = "run-e00-tcs-guard";
const GUARD_INSTANCE = "T1.a1.i-1";
function guardRepo() {
  const repo = path.join(ownedTempDir("guild-e00-tcs-guard-"), "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".guild", "wiki", "decisions"), { recursive: true });
  const runDir = path.join(repo, ".guild", "runs", GUARD_RUN);
  mintRunBinding({ root: repo, run_id: GUARD_RUN });
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "run.yaml"), "run_id: x\n");
  // A worker-owned declared artifact for the allowed controls (outside .guild, no secret, not prose).
  fs.mkdirSync(path.join(repo, "src", "out"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src", "out", "T1.txt"), "tc artifact x\n");
  admitLane(repo, GUARD_RUN, "T1", GUARD_INSTANCE, ["Read", "Grep", "Glob", "Bash", "Write", "Edit"]);
  return { repo, runDir };
}
type HookOutcome = { kind: "allow_empty" } | { kind: "decision"; decision: string; reason: string };
function ptu(g: { repo: string; runDir: string }, tool: string, input: Record<string, unknown>): HookOutcome {
  const r = spawnSync(NODE, [packaged("hooks/dist/pre-tool-use.js")], {
    input: JSON.stringify({ tool_name: tool, tool_input: input, cwd: g.repo }), encoding: "utf8", cwd: g.repo,
    env: { ...hermetic(), CLAUDE_PLUGIN_ROOT: PKG, GUILD_CWD: g.repo, GUILD_RUN_DIR: g.runDir, GUILD_RUN_ID: GUARD_RUN, GUILD_TASK_ID: "T1", GUILD_TASK_CELL_INSTANCE_ID: GUARD_INSTANCE },
    timeout: 30_000,
  });
  if (r.error) throw new Error(`packaged pre-tool-use spawn error: ${(r.error as NodeJS.ErrnoException).code ?? r.error.message}`);
  if (r.status !== 0) throw new Error(`packaged pre-tool-use exited ${r.status}`);
  if (/fatal: \[pre-tool-use\]/.test(r.stderr ?? "")) throw new Error("packaged pre-tool-use hit its fatal handler (exit 0 masks it)");
  const out = (r.stdout ?? "").trim();
  if (out === "") return { kind: "allow_empty" };
  const lines = out.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length !== 1) throw new Error(`packaged pre-tool-use emitted ${lines.length} stdout lines; expected one JSON response`);
  const h = (JSON.parse(lines[0]!) as { hookSpecificOutput?: Record<string, unknown> }).hookSpecificOutput;
  if (!h || h["hookEventName"] !== "PreToolUse" || typeof h["permissionDecision"] !== "string") throw new Error("packaged pre-tool-use stdout is not a PreToolUse hookSpecificOutput");
  return { kind: "decision", decision: h["permissionDecision"] as string, reason: String(h["permissionDecisionReason"] ?? "") };
}
const bindingRefused = (o: HookOutcome) => o.kind === "decision" && o.decision === "deny" && /binding_path_refused/.test(o.reason);
/** A genuine allow under the hook response contract: the native empty-stdout allow or an explicit allow decision. */
const allowed = (o: HookOutcome) => o.kind === "allow_empty" || (o.kind === "decision" && o.decision === "allow");

describe.skipIf(!enabled)("TC supplement S5 · the packaged binding guard denies all six admitted tools naming binding.json", () => {
  type G = { repo: string; runDir: string };
  const binding = (g: G) => path.join(g.runDir, "binding.json");
  const artifact = (g: G) => path.join(g.repo, "src", "out", "T1.txt");
  // [tool, binding-path input, benign worker-owned control input]
  const tools: Array<[string, (g: G) => Record<string, unknown>, (g: G) => Record<string, unknown>]> = [
    ["Read", (g) => ({ file_path: binding(g) }), (g) => ({ file_path: path.join(g.runDir, "run.yaml") })],
    ["Grep", (g) => ({ pattern: "binding_ref", path: binding(g) }), (g) => ({ pattern: "artifact", path: artifact(g) })],
    ["Glob", (g) => ({ pattern: ".guild/runs/*/binding*.json", path: g.repo }), (g) => ({ pattern: "src/out/*.txt", path: g.repo })],
    ["Bash", () => ({ command: "cat .guild/runs/*/binding*.json" }), () => ({ command: "cat src/out/T1.txt" })],
    ["Write", (g) => ({ file_path: binding(g), content: "{}" }), (g) => ({ file_path: artifact(g), content: "tc artifact y\n" })],
    ["Edit", (g) => ({ file_path: binding(g), old_string: "a", new_string: "b" }), (g) => ({ file_path: artifact(g), old_string: "x", new_string: "y" })],
  ];
  for (const [tool, deny, control] of tools) {
    it(`S5 ${tool}: the binding path is denied binding_path_refused; a benign worker-owned path is genuinely allowed`, () => {
      const g = guardRepo();
      expect({ denied: bindingRefused(ptu(g, tool, deny(g))), control_allowed: allowed(ptu(g, tool, control(g))) })
        .toEqual({ denied: true, control_allowed: true });
    });
  }
});

// ── S7 · report-only wrapper wall time ──

describe.skipIf(!enabled)("TC supplement S7 · packaged TaskCompleted wrapper wall time per path (report-only)", () => {
  it("S7 clean notice path vs opt-in early exit: n>=5 each, median and p95 recorded", () => {
    const N = 5;
    const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!; };
    const clean: number[] = []; const early: number[] = [];
    for (let i = 0; i < N; i++) {
      const f = fixture();
      const r = runHook(f);
      expect({ status: r.status, notice: fs.existsSync(f.notice) }).toEqual({ status: 0, notice: true });
      clean.push(r.ms);
      const g = fixture();
      const e = runHook(g, { optIn: false });
      expect({ status: e.status, notice: fs.existsSync(g.notice) }).toEqual({ status: 0, notice: false });
      early.push(e.ms);
    }
    const report = {
      schema_version: "guild.e00_tc_supplement_s7.v1",
      label: "wrapper process wall time (node startup + stdin + every path difference); not digest-only, not model latency",
      n: { clean_notice: clean.length, opt_in_early_exit: early.length },
      clean_notice_ms: { median: quantile(clean, 0.5), p95: quantile(clean, 0.95) },
      opt_in_early_exit_ms: { median: quantile(early, 0.5), p95: quantile(early, 0.95) },
      billed_usd: null, served_model: null,
    };
    const out = process.env["E00_TC_SUPPLEMENT_METRICS"];
    if (out && path.isAbsolute(out)) fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(`[e00-tc-supplement-s7] ${JSON.stringify(report)}`);
    expect(report.n).toEqual({ clean_notice: N, opt_in_early_exit: N });
  }, T);
});

// ── S8 · installed facade, transport double, policy faults after the controller-recorded ack ──

const SUPP_DOUBLE = String.raw`
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const st = { iid: null, instanceDir: null, receipt: null, fired: false, trigger: null };
// S8-F3 only: an in-process wrapper on the fs export the compiled pointer writer calls, keyed on the exact
// physical pointer path, installed before task-cell-api is required. No NODE_OPTIONS, module-name or stack keying.
const seam = { armed: typeof cfg.f3Outside === "string", pointer: null, calls: 0, fired: 0 };
if (seam.armed) {
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = function (file, data, opts) {
    const r = realWrite.apply(fs, arguments);
    if (seam.pointer !== null && typeof file === "string" && path.resolve(file) === seam.pointer) {
      seam.calls++;
      if (seam.fired === 0) {
        seam.fired++;
        const handoffs = path.dirname(st.receipt);
        realWrite.call(fs, path.join(cfg.f3Outside, path.basename(st.receipt)), fs.readFileSync(st.receipt));
        fs.renameSync(handoffs, handoffs + ".moved-aside");
        fs.symlinkSync(cfg.f3Outside, handoffs);
      }
    }
    return r;
  };
}
const api = require(cfg.api);
const actions = [];
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } };
const settingsPath = path.join(cfg.root, ".guild", "settings.json");
function applySettings() {
  const s = cfg.settings;
  if (s.kind === "write") fs.writeFileSync(settingsPath, s.raw);
  else if (s.kind === "dir") { fs.mkdirSync(settingsPath); fs.writeFileSync(path.join(settingsPath, s.entry), "x\n"); }
  else if (s.kind === "symlink") fs.symlinkSync(s.target, settingsPath);
}
function writeReceipt(a) {
  const produced = new Date().toISOString();
  const receipt = ["---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null", "  run_id: " + a.run_id, "  task_id: " + a.logical_task_id, "  task_run_id: " + a.task_run_id,
    "specialist: " + a.worker_role, "host:", "  selected: " + a.host_id, "  degraded: false", "  native_ref: null", "  independence: weak", "scope:", "  objective: " + JSON.stringify(a.objective),
    "  in_scope: " + JSON.stringify(a.scope_paths), "  out_of_scope_touched: []", "status: completed", "changed_files: []", "evidence:", "  - kind: command", "    ref: " + JSON.stringify(a.acceptance_tests[0] || "tc"), "    result: pass",
    "assumptions: []", "open_risks: []", "followups: []", "produced_at: " + produced, "---", "", "## changed_files", "- none", "", "## opens_for", "- lead", "", "## assumptions", "- none", "",
    "## evidence", "- tc supplement double" + (cfg.receiptCanary ? " " + cfg.receiptCanary : ""), "", "## followups", "- none", "", "` + "```" + String.raw`guild.handoff.v2",
    JSON.stringify({ schema_version: "guild.handoff.v2", task_id: a.logical_task_id, tier: "mid", status: "done", summary: "tc supplement double lane", artifacts: [], issues: [] }), "` + "```" + String.raw`", ""].join("\n");
  fs.mkdirSync(path.dirname(st.receipt), { recursive: true });
  fs.writeFileSync(st.receipt, receipt);
}
const worker = { mode: "native", losses: [], isAvailable: () => true, ready: () => ({ ok: true, reason: null }),
  spawn: () => { actions.push("spawn"); return { ok: true, reason: null }; },
  notifyAssignment: (i) => {
    actions.push("notify");
    const assignmentAbs = path.resolve(cfg.root, i.assignment_path);
    const a = JSON.parse(fs.readFileSync(assignmentAbs, "utf8"));
    if (cp.spawnSync(cfg.node, [cfg.ackCli, "--assignment", assignmentAbs], { cwd: path.join(cfg.root, "src"), stdio: "ignore" }).status !== 0) throw new Error("ack CLI failed");
    for (const item of a.done_when || []) if (item.oracle === "artifact_exists") { const o = path.join(cfg.root, JSON.parse(item.target).path); fs.mkdirSync(path.dirname(o), { recursive: true }); fs.writeFileSync(o, "tc artifact\n"); }
    st.a = a; st.iid = a.instance_id; st.instanceDir = path.dirname(assignmentAbs);
    st.receipt = path.join(cfg.root, ".guild", "runs", a.run_id, "handoffs", a.worker_role + "-" + a.logical_task_id + ".md");
    if (seam.armed) seam.pointer = path.join(fs.realpathSync(st.instanceDir), "handoff.json");
    return { ok: true, reason: null };
  },
  terminate: () => { actions.push("terminate"); return cfg.refuseTerminate ? { ok: false, reason: "transport double: teardown refused" } : { ok: true, reason: null }; } };
const decided = new Set();
const sleep = async () => {
  if (!st.fired && st.iid !== null) {
    const handle = readJson(path.join(cfg.root, ".guild", "runs", cfg.runId, "controller", "handles", st.iid + ".json"));
    const controllerAck = fs.existsSync(path.join(st.instanceDir, "assignment-ack.json"));
    if (handle !== null && handle.runtime_state === "running" && controllerAck) {
      st.trigger = { handle_running: true, controller_ack_present: true,
        raw_claim_present: fs.existsSync(path.join(cfg.root, ".guild", "runs", cfg.runId, "outbox", st.iid, "ack-claim.json")),
        pointer_absent: !fs.existsSync(path.join(st.instanceDir, "handoff.json")), receipt_absent: !fs.existsSync(st.receipt) };
      applySettings();
      writeReceipt(st.a);
      st.fired = true;
    }
  }
  const cells = path.join(cfg.root, ".guild", "runs", cfg.runId, "task-cells");
  if (!fs.existsSync(cells)) return;
  for (const rel of fs.readdirSync(cells, { recursive: true })) {
    if (path.basename(String(rel)) !== "handoff-validation.json") continue;
    const iid = path.basename(path.dirname(path.join(cells, String(rel))));
    if (decided.has(iid)) continue;
    decided.add(iid);
    cp.spawnSync(cfg.node, [cfg.controllerCli, "decide", "--root", cfg.root, "--run", cfg.runId, "--instance", iid, "--lead-binding-id", cfg.lead, "--decision", "accepted"], { stdio: "ignore", env: process.env });
  }
};
const r = api.startTaskCellController({ cwd: cfg.root, runId: cfg.runId, phase: "build", workerTrustPolicy: "cooperative_local", packageRoot: cfg.pkg, proposal: cfg.proposal,
  worker, rungPlan: cfg.rungPlan, sleep, reviewedBasis: cfg.basis, ...(cfg.maxInstances ? { maxInstances: cfg.maxInstances } : {}) });
if (!r.ok) { process.stdout.write(JSON.stringify({ start: r.reason })); process.exit(0); }
(async () => {
  r.controller.writeStationPlan(cfg.teamPlan);
  const out = await r.controller.runLane(cfg.lane);
  let second = null, secondError = null;
  if (cfg.secondLane) {
    try { second = await r.controller.runLane(cfg.secondLane); } catch (e) { secondError = String(e && e.message); }
  }
  r.controller.close();
  process.stdout.write(JSON.stringify({ out, second, secondError, actions, trigger: st.trigger, fired: st.fired, seam: { armed: seam.armed, calls: seam.calls, fired: seam.fired } }));
})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message) })); });
`;

type SettingsArm = { kind: "none" } | { kind: "write"; raw: string } | { kind: "dir"; entry: string } | { kind: "symlink"; target: string };
interface S8 { t: TcRoot; r: Record<string, any>; io: string; env: Record<string, string> }

function s8Lane(o: { settings: SettingsArm; refuseTerminate?: boolean; receiptCanary?: string; f3Outside?: string; capOneWithSecondLane?: boolean }): S8 {
  const basisPath = requireBasis();
  const descriptor = JSON.parse(fs.readFileSync(basisPath, "utf8"));
  if (descriptor.schema_version !== "guild.source_basis_descriptor.v1" || !path.isAbsolute(descriptor.root)) throw new Error("E00_TC_REVIEWED_BASIS is not an absolute-root guild.source_basis_descriptor.v1");
  const t = buildTcRoot(o.capOneWithSecondLane ? [{ id: "T1", role: "backend" }, { id: "T2", role: "backend" }] : [{ id: "T1", role: "backend" }], { ackCli: script("task-cell-ack"), node: NODE });
  const env = { ...hermetic(), GUILD_RUN_ID: t.runId, GUILD_RUN_BINDING_REF: t.bindingRef };
  const approve = spawnSync(NODE, [script("task-cell-controller"), "approve-oracles", "--root", t.root, "--run", t.runId, "--phase", "build", "--decided-by", "tc-operator"], { cwd: t.root, env, encoding: "utf8", timeout: 120_000 });
  expect(approve.status).toBe(0);
  // The double's probe and its cfg (which may hold the test's own receipt canary) live in an owned directory OUTSIDE
  // the TC root, so every root privacy scan covers all runtime output without exclusions.
  const dir = ownedTempDir("guild-e00-tcs-double-");
  const probe = path.join(dir, "supplement-double.cjs");
  fs.writeFileSync(probe, SUPP_DOUBLE);
  const cfg = {
    api: script("task-cell-api"), controllerCli: script("task-cell-controller"), ackCli: script("task-cell-ack"),
    node: NODE, root: t.root, runId: t.runId, pkg: PKG, proposal: t.proposal, rungPlan: FULL_RUNGS, lead: TC_LEAD, refuseTerminate: o.refuseTerminate === true,
    basis: { root: descriptor.root, proposalPath: descriptor.proposal_path, decisionPath: descriptor.decision_path, requestPath: descriptor.request_path },
    teamPlan: JSON.parse(fs.readFileSync(t.teamPlanPath, "utf8")),
    lane: { ...JSON.parse(fs.readFileSync(t.lanesPath, "utf8"))[0], ready_timeout_ms: 60_000, ack_timeout_ms: 60_000, receipt_timeout_ms: 60_000, review_timeout_ms: 60_000 },
    maxInstances: o.capOneWithSecondLane ? 1 : null,
    secondLane: o.capOneWithSecondLane ? { ...JSON.parse(fs.readFileSync(t.lanesPath, "utf8"))[1], ready_timeout_ms: 60_000, ack_timeout_ms: 60_000, receipt_timeout_ms: 2_000, review_timeout_ms: 60_000 } : null,
    settings: o.settings, receiptCanary: o.receiptCanary ?? null, f3Outside: o.f3Outside ?? null,
  };
  const cfgPath = path.join(dir, "cfg.json");
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const res = spawnSync(NODE, [probe, cfgPath], { cwd: t.root, env, encoding: "utf8", timeout: 240_000 });
  const r = JSON.parse(res.stdout || "{}");
  // False-positive guards (r3/r4): started, admitted, the fault written only after the controller-recorded ack
  // while the handle was running and before any pointer.
  expect({ start_refused: r.start ?? null, error: r.error ?? null, instance: typeof r.out?.instance_id === "string", fired: r.fired === true })
    .toEqual({ start_refused: null, error: null, instance: true, fired: true });
  expect(r.trigger).toEqual({ handle_running: true, controller_ack_present: true, raw_claim_present: true, pointer_absent: true, receipt_absent: true });
  return { t, r, io: `${res.stdout ?? ""}${res.stderr ?? ""}`, env };
}
const instanceDir = (s: S8) => path.dirname(findAssignment(s.t)!);
function findLaneAssignment(t: TcRoot, id: string): string | null {
  const cells = path.join(t.runDir, "task-cells", id);
  if (!fs.existsSync(cells)) return null;
  for (const e of fs.readdirSync(cells, { recursive: true }) as string[]) if (path.basename(e) === "assignment.json") return path.join(cells, e);
  return null;
}
function findAssignment(t: TcRoot): string | null {
  const cells = path.join(t.runDir, "task-cells", "T1");
  if (!fs.existsSync(cells)) return null;
  for (const e of fs.readdirSync(cells, { recursive: true }) as string[]) if (path.basename(e) === "assignment.json") return path.join(cells, e);
  return null;
}
const publication = (s: S8) => {
  const d = instanceDir(s);
  return { pointer: fs.existsSync(path.join(d, "handoff.json")), origin: fs.existsSync(path.join(d, "handoff-origin.json")), retained: fs.existsSync(path.join(d, "handoff-receipt.md")),
    validation: fs.existsSync(path.join(d, "handoff-validation.json")), acceptance: fs.existsSync(path.join(d, "handoff-acceptance.json")) };
};
const NONE = { pointer: false, origin: false, retained: false, validation: false, acceptance: false };
const s8Status = (s: S8) => {
  const r = spawnSync(NODE, [script("task-cell-controller"), "status", "--root", s.t.root, "--run", s.t.runId, "--consumer-policy", "cooperative_local"], { cwd: s.t.root, env: s.env, encoding: "utf8", timeout: 120_000 });
  expect(r.status).toBe(0);
  return (JSON.parse(r.stdout).instances ?? []).find((i: { logical_task_id: string }) => i.logical_task_id === "T1");
};
const EXCEPTION_TEXT = ["Cannot convert object to primitive value", "controller_error:", "No default value"];

describe.skipIf(!enabled)("TC supplement S8 · installed controller refuses an unavailable secrets policy before any publication", () => {
  const SETTINGS_CANARY = `e00-tcs-settings-canary-${crypto.randomBytes(6).toString("hex")}`;
  const arms: Array<[string, () => SettingsArm]> = [
    ["U1 settings.json is a directory (EISDIR)", () => ({ kind: "dir", entry: SETTINGS_CANARY })],
    ["U2 settings.json is a symlink to an otherwise valid file", () => {
      const target = path.join(ownedTempDir("guild-e00-tcs-settings-"), "settings.json");
      fs.writeFileSync(target, JSON.stringify({ secrets_policy: { redaction_patterns: [`never-matches-${SETTINGS_CANARY}`] } }));
      return { kind: "symlink", target };
    }],
    ["U3 malformed JSON", () => ({ kind: "write", raw: `{ "${SETTINGS_CANARY}": ` })],
    ["U4 unknown secrets_policy key", () => ({ kind: "write", raw: JSON.stringify({ secrets_policy: { [SETTINGS_CANARY]: true } }) })],
    ["U5 redaction_patterns has a non-string member", () => ({ kind: "write", raw: JSON.stringify({ secrets_policy: { redaction_patterns: [SETTINGS_CANARY, 1] } }) })],
    ["U6 fail_mode_durable is an object with toString null", () => ({ kind: "write", raw: JSON.stringify({ secrets_policy: { fail_mode_durable: { toString: null, note: SETTINGS_CANARY } } }) })],
    ["U7 fail_mode_telemetry is an object with toString null", () => ({ kind: "write", raw: JSON.stringify({ secrets_policy: { fail_mode_telemetry: { toString: null, note: SETTINGS_CANARY } } }) })],
  ];
  for (const [label, arm] of arms) {
    it(`${label}: handoff_secret_policy_unavailable; nothing published; no settings bytes or exception text in output, outcome or run tree`, () => {
      const s = s8Lane({ settings: arm() });
      const outcome = JSON.stringify(s.r.out);
      expect({ reason: s.r.out.failure_reason ?? null, published: publication(s),
        settings_in_io: s.io.includes(SETTINGS_CANARY), settings_in_outcome: outcome.includes(SETTINGS_CANARY), settings_in_run_tree: anyFileContains(s.t.runDir, SETTINGS_CANARY),
        exception_text: EXCEPTION_TEXT.some((x) => s.io.includes(x) || outcome.includes(x) || anyFileContains(s.t.runDir, x)) })
        .toEqual({ reason: "handoff_secret_policy_unavailable", published: NONE, settings_in_io: false, settings_in_outcome: false, settings_in_run_tree: false, exception_text: false });
    }, T);
  }

  it("V1 a valid-shaped policy whose pattern does not compile: handoff_secret_scrub_required, nothing published", () => {
    const s = s8Lane({ settings: { kind: "write", raw: JSON.stringify({ secrets_policy: { redaction_patterns: ["("] } }) } });
    expect({ reason: s.r.out.failure_reason ?? null, published: publication(s) }).toEqual({ reason: "handoff_secret_scrub_required", published: NONE });
  }, T);

  it("V2 a valid matching policy with a canary receipt: handoff_secret_scrub_required, nothing published, canary only in the lane receipt", () => {
    const canary = awsCanary();
    const s = s8Lane({ settings: { kind: "write", raw: JSON.stringify({ secrets_policy: { redaction_patterns: ["AKIA[0-9A-Z]{16}"] } }) }, receiptCanary: canary });
    const lane = path.join(s.t.runDir, "handoffs", "backend-T1.md");
    expect({ reason: s.r.out.failure_reason ?? null, published: publication(s), receipt_has_canary: fs.readFileSync(lane).includes(canary),
      canary_in_io: s.io.includes(canary), canary_elsewhere: anyFileContains(s.t.root, canary, lane) })
      .toEqual({ reason: "handoff_secret_scrub_required", published: NONE, receipt_has_canary: true, canary_in_io: false, canary_elsewhere: false });
  }, T);

  const controls: Array<[string, SettingsArm]> = [
    ["K1 settings absent (built-in defaults)", { kind: "none" }],
    ["K2 a valid non-matching policy", { kind: "write", raw: JSON.stringify({ secrets_policy: { redaction_patterns: ["never-matches-e00-tcs"] } }) }],
  ];
  for (const [label, settings] of controls) {
    it(`${label}: the clean receipt is published byte-identically and accepted`, () => {
      const s = s8Lane({ settings });
      const d = instanceDir(s);
      const lane = fs.readFileSync(path.join(s.t.runDir, "handoffs", "backend-T1.md"));
      const origin = JSON.parse(fs.readFileSync(path.join(d, "handoff-origin.json"), "utf8"));
      expect({ reason: s.r.out.failure_reason ?? null, pointer: fs.existsSync(path.join(d, "handoff.json")),
        retained_identical: fs.readFileSync(path.join(d, "handoff-receipt.md")).equals(lane), origin_bound: origin.receipt_sha256 === sha256(lane),
        acceptance: s8Status(s)?.mechanical_acceptance ?? null })
        .toEqual({ reason: null, pointer: true, retained_identical: true, origin_bound: true, acceptance: "accepted" });
    }, T);
  }

  it("T4a U3 with terminate confirmed: lane failed, attempt sealed failed, cleanup complete (installed status)", () => {
    const s = s8Lane({ settings: { kind: "write", raw: `{ "${SETTINGS_CANARY}": ` }, capOneWithSecondLane: true });
    const attempt = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(instanceDir(s))), "attempt.json"), "utf8"));
    const st = s8Status(s);
    expect({ reason: s.r.out.failure_reason ?? null, terminate_called: s.r.actions.includes("terminate"), lane_state: s.r.out.state, attempt_terminal: attempt.terminal_state ?? null,
      status_terminal: st?.attempt_terminal_state ?? null, cleanup: st?.cleanup_state ?? null })
      .toEqual({ reason: "handoff_secret_policy_unavailable", terminate_called: true, lane_state: "failed", attempt_terminal: "failed", status_terminal: "failed", cleanup: "complete" });
    // Capacity control (maxInstances 1): the confirmed teardown freed T1's slot, so the installed admission admits T2.
    expect({ second_admission_error: s.r.secondError ?? null, second_instance: typeof s.r.second?.instance_id === "string",
      spawns: s.r.actions.filter((x: string) => x === "spawn").length, t2_assignment: findLaneAssignment(s.t, "T2") !== null })
      .toEqual({ second_admission_error: null, second_instance: true, spawns: 2, t2_assignment: true });
  }, T);

  it("T4b U3 with terminate refused: no terminal state, handle terminating awaiting teardown, attempt orphaned and unsealed, closed audit fails", () => {
    const s = s8Lane({ settings: { kind: "write", raw: `{ "${SETTINGS_CANARY}": ` }, refuseTerminate: true, capOneWithSecondLane: true });
    const attemptDir = path.dirname(path.dirname(instanceDir(s)));
    const attempt = JSON.parse(fs.readFileSync(path.join(attemptDir, "attempt.json"), "utf8"));
    const handle = JSON.parse(fs.readFileSync(path.join(s.t.runDir, "controller", "handles", `${s.r.out.instance_id}.json`), "utf8"));
    const st = s8Status(s);
    const audit = spawnSync(NODE, [script("task-cell-audit"), "--cwd", s.t.root, "--run-id", s.t.runId], { encoding: "utf8", timeout: 120_000 });
    expect({ reason: s.r.out.failure_reason ?? null, terminate_called: s.r.actions.includes("terminate"),
      lane_terminal: ["timed_out", "rejected", "failed", "terminated", "cancelled"].includes(s.r.out.state), awaiting: s.r.out.awaiting ?? null,
      attempt_terminal: attempt.terminal_state ?? null, orphaned: attempt.orphaned === true, sealed: fs.existsSync(path.join(attemptDir, "terminal.json")),
      handle: { runtime_state: handle.runtime_state, awaiting: handle.awaiting }, status_terminal: st?.attempt_terminal_state ?? null,
      cleanup_complete: st?.cleanup_state === "complete", audit_failed: audit.status !== 0 })
      .toEqual({ reason: "handoff_secret_policy_unavailable", terminate_called: true, lane_terminal: false, awaiting: "teardown", attempt_terminal: null, orphaned: true, sealed: false,
        handle: { runtime_state: "terminating", awaiting: "teardown" }, status_terminal: null, cleanup_complete: false, audit_failed: true });
    // Held capacity, observed through the installed admission path (maxInstances 1): T1's slot is still counted live,
    // so admitting T2 is refused on the instance cap and no T2 attempt or spawn exists.
    expect({ second_refused_on_cap: typeof s.r.secondError === "string" && s.r.secondError.startsWith("not_authorized: dispatch.max_instances=1 would be exceeded: 1 live slot(s)"),
      second_outcome: s.r.second ?? null, spawns: s.r.actions.filter((x: string) => x === "spawn").length, t2_assignment: findLaneAssignment(s.t, "T2") !== null })
      .toEqual({ second_refused_on_cap: true, second_outcome: null, spawns: 1, t2_assignment: false });
  }, T);

  it("F3 (compiled-runtime fault injection, mechanics) parent replaced by an outside symlink after the real pointer write: no origin, no retained copy (pointer may remain)", () => {
    const outside = ownedTempDir("guild-e00-tcs-f3-outside-");
    const s = s8Lane({ settings: { kind: "none" }, f3Outside: outside });
    const handoffs = path.join(s.t.runDir, "handoffs");
    // Eligibility: the wrapper intercepted the compiled pointer write exactly once on its exact path; otherwise
    // F3 is not executed at the installed boundary (this fails; it never passes or skips).
    expect({ armed: s.r.seam?.armed === true, intercepted_once: s.r.seam?.calls === 1, fired: s.r.seam?.fired,
      parent_is_symlink: fs.lstatSync(handoffs).isSymbolicLink(),
      outside_identical: fs.readFileSync(path.join(outside, "backend-T1.md")).equals(fs.readFileSync(path.join(`${handoffs}.moved-aside`, "backend-T1.md"))) })
      .toEqual({ armed: true, intercepted_once: true, fired: 1, parent_is_symlink: true, outside_identical: true });
    const d = instanceDir(s);
    // Fail closed: the installed status must report the T1 instance with a recognized non-accepted value of its
    // existing mechanical_acceptance field ("none" | "accepted" | "rejected"); a missing instance or unknown value fails.
    const st = s8Status(s);
    expect({ refused: (s.r.out.failure_reason ?? null) !== null, origin: fs.existsSync(path.join(d, "handoff-origin.json")), retained: fs.existsSync(path.join(d, "handoff-receipt.md")),
      acceptance_file: fs.existsSync(path.join(d, "handoff-acceptance.json")), status_t1_present: st !== undefined && st !== null,
      status_recognized_nonaccepted: st !== undefined && st !== null && ["none", "rejected"].includes(st.mechanical_acceptance) })
      .toEqual({ refused: true, origin: false, retained: false, acceptance_file: false, status_t1_present: true, status_recognized_nonaccepted: true });
  }, T);
});
