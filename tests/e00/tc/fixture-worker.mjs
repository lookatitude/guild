#!/usr/bin/env node
/**
 * tests/e00/tc/fixture-worker.mjs — TC cooperative fixture worker (CD16/CD22:
 * "fixture worker binary, no paid host session"). The TC harness puts a `claude`
 * shim that execs this file first on PATH, so the controller's unchanged
 * `command claude` pane launch reaches it with no production test mode.
 *
 * It first waits (bounded; mode.assignmentWaitMs, default 180 s) for an assignment
 * with the complete required structure, which the controller publishes only after
 * readiness; an incomplete or wrong-typed record keeps it polling and expiry exits 3
 * before any side effect. Then it does
 * only what a cooperative worker may do (file_ownership.worker): write
 * declared scope artifacts and the lane receipt, run the PACKAGED TaskCompleted
 * hook (<pkg>/hooks/agent-team/dist/task-completed.js, <pkg> derived from
 * mode.ackCli = <pkg>/runtime/scripts/task-cell-ack.js) as a synthetic fixture
 * invocation (never a native event), then run the packaged task-cell-ack CLI, and
 * idle until the controller tears it down. Order is receipt(1) -> hook(2) ->
 * ack(3): <root>/.tc-hook-result.json records each observation after it happened
 * (receipt written, hook completed with its exit, ack started, ack completed with
 * its exit; exit codes and booleans only) and is rewritten after every one. The
 * worker never writes a notice itself: if the hook
 * fails or writes none, nothing replaces it. bad-notice rewrites only the hook
 * notice's instance_id; no-ack writes the receipt and runs neither hook nor ack.
 * It never reads binding.json. Behaviour comes from <root>/.tc-worker-mode.json
 * because pane env carries only GENERATED_PRE_GUARD_EXPORTS keys. It writes a
 * secret-safe env check (booleans and counts only) to <root>/.tc-worker-env.json.
 * Teardown never trusts a pid this worker reports; see support/e00-harness.ts.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const assignmentPath = process.env.GUILD_TASK_ASSIGNMENT ?? "";
const marker = `${path.sep}.guild${path.sep}`;
if (!path.isAbsolute(assignmentPath) || !assignmentPath.includes(marker)) process.exit(3);
const root = assignmentPath.slice(0, assignmentPath.indexOf(marker));
const modeFile = path.join(root, ".tc-worker-mode.json");
const mode = fs.existsSync(modeFile) ? JSON.parse(fs.readFileSync(modeFile, "utf8")) : {};
// The controller writes the assignment only after it has observed this process as
// ready. As the launch prompt instructs, wait until a complete guild.task_assignment.v2
// parses; an empty or partial file (a non-atomic writer, kept as a regression input) is
// never read as the assignment. Give up (exit 3) after the bound.
//
// "Complete" is the required structure, checked before any observation or write: a
// parseable but incomplete or wrong-typed record is not the assignment and polling goes
// on. Node cannot load dispatch/index.ts (extensionless imports) and KTD27 forbids
// importing past it, so this restates validateTaskAssignmentV2 and, for the done_when
// the worker consumes, the E00 floor plus the artifact_exists decode and scope check of
// validateExecutableDoneWhen. fixture-worker.test.ts holds each variant to the canonical
// validators.
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const REQUIRED_STRINGS = [
  "run_id", "cell_id", "goal_id", "phase_id", "step_id", "team_id", "logical_task_id", "task_run_id",
  "attempt_id", "instance_id", "worker_role", "specialist_type_id", "specialist_type_version",
  "specialist_type_hash", "specialist_profile_id", "specialist_profile_hash", "context_bundle_id",
  "context_bundle_hash", "host_id", "adapter_id", "host_capabilities_hash", "objective", "output_schema",
  "autonomy_policy", "written_at", "assignment_path", "handoff_path", "heartbeat_path", "cancel_channel",
];
const ORACLE_KINDS = ["verify.after_edit", "named_check", "command", "artifact_exists", "acceptance_record"];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isStr = (x) => typeof x === "string" && x.length > 0;
const isStrArr = (x) => Array.isArray(x) && x.every((s) => typeof s === "string");
const numOrNull = (x) => x === null || typeof x === "number";
const safeRelative = (p) => typeof p === "string" && p.length > 0 && !p.includes("\0") && !p.includes("\\") &&
  !path.posix.isAbsolute(p) && path.posix.normalize(p) === p && p !== "." && p !== ".." && !p.startsWith("../");
const canonicalJson = (x) => Array.isArray(x) ? `[${x.map(canonicalJson).join(",")}]`
  : x !== null && typeof x === "object" ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(x[k])}`).join(",")}}`
  : JSON.stringify(x);
const artifactTargetOk = (target, scopePaths) => {
  if (!isStr(target)) return false;
  let t;
  try { t = JSON.parse(target); } catch { return false; }
  if (canonicalJson(t) !== target || !isObj(t)) return false;
  const keys = Object.keys(t);
  if (keys.length !== 2 || !Object.hasOwn(t, "path") || !Object.hasOwn(t, "sha256")) return false;
  if (!safeRelative(t.path) || !(t.sha256 === null || (typeof t.sha256 === "string" && /^[0-9a-f]{64}$/.test(t.sha256)))) return false;
  return scopePaths.some((s) => safeRelative(s) && (t.path === s || t.path.startsWith(`${s}/`)));
};
const validAssignment = (v) => {
  if (!isObj(v) || v.schema_version !== "guild.task_assignment.v2") return false;
  if (!REQUIRED_STRINGS.every((k) => isStr(v[k]))) return false;
  if (![v.non_goals, v.acceptance_tests, v.scope_paths].every(isStrArr)) return false;
  if (!Array.isArray(v.dependencies) || !v.dependencies.every((d) => isObj(d) && isStr(d.logical_task_id) &&
    (d.accepted_artifact_ref === null || typeof d.accepted_artifact_ref === "string"))) return false;
  const p = v.projection;
  if (!isObj(p) || !isStrArr(p.tools) || !isStrArr(p.permissions) || !Array.isArray(p.recorded_losses) ||
    !p.recorded_losses.every((l) => isObj(l) && isStr(l.capability) && isStr(l.mapping) && isStr(l.loss))) return false;
  const b = v.budgets;
  if (!isObj(b) || !numOrNull(b.tokens) || !numOrNull(b.wall_clock_ms) || !numOrNull(b.cost_usd)) return false;
  if (!(v.deadline === null || typeof v.deadline === "string")) return false;
  // D4 lineage (attemptLineage) and the lead-binding XOR (leadBinding).
  const prev = v.previous_attempt_id ?? null;
  const reason = v.retry_reason ?? null;
  if (!Number.isInteger(v.attempt) || v.attempt < 1) return false;
  if (v.attempt === 1 ? Boolean(prev || reason) : !(prev && reason)) return false;
  if (Boolean(v.team_lead_instance_id ?? null) === Boolean(v.lead_binding_id ?? null)) return false;
  // D6 canonical channels; the locator must be this record's own path.
  if (![v.run_id, v.logical_task_id, v.instance_id].every((s) => SAFE_SEGMENT.test(s) && s !== "." && s !== "..")) return false;
  const dir = path.join(".guild", "runs", v.run_id, "task-cells", v.logical_task_id, "attempts", String(v.attempt), "instances", v.instance_id);
  if (v.assignment_path !== path.join(dir, "assignment.json") || v.handoff_path !== path.join(dir, "handoff.json") ||
    v.heartbeat_path !== path.join(dir, "heartbeat.json") || v.cancel_channel !== path.join(dir, "cancel")) return false;
  if (path.join(root, v.assignment_path) !== path.resolve(assignmentPath)) return false;
  // done_when (validateDoneWhen floor; artifact_exists targets as the worker writes them).
  if (!Array.isArray(v.done_when) || v.done_when.length === 0) return false;
  const seen = new Set();
  for (const item of v.done_when) {
    if (!isObj(item) || !isStr(item.id) || seen.has(item.id) || !ORACLE_KINDS.includes(item.oracle)) return false;
    seen.add(item.id);
    if (!(item.target === undefined || item.target === null || typeof item.target === "string")) return false;
    if (item.oracle === "artifact_exists" && !artifactTargetOk(item.target, v.scope_paths)) return false;
  }
  return true;
};
const readAssignment = () => {
  try {
    const b = fs.readFileSync(assignmentPath);
    const v = JSON.parse(b.toString("utf8"));
    return validAssignment(v) ? { b, v } : null;
  } catch {
    return null;
  }
};
const waitMs = Number.isInteger(mode.assignmentWaitMs) && mode.assignmentWaitMs > 0 ? mode.assignmentWaitMs : 180_000;
const waitUntil = Date.now() + waitMs;
let got = readAssignment();
while (got === null && Date.now() < waitUntil) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  got = readAssignment();
}
if (got === null) process.exit(3);
const bytes = got.b;
const a = got.v;

// F3 (round 2): secret-safe self-check of the pane environment. The mode file
// carries only the nonce LENGTH and SHA-256; the worker hashes every byte window
// of that length across every complete "KEY=VALUE" entry, so an undelimited
// prefix+nonce+suffix is still found. Only booleans and counts are written.
const digest = (b) => createHash("sha256").update(b).digest("hex");
const len = Number.isInteger(mode.nonceLength) && mode.nonceLength > 0 ? mode.nonceLength : 0;
const supplied = typeof mode.nonceSha256 === "string" && /^[0-9a-f]{64}$/.test(mode.nonceSha256) && len > 0;
let windows = 0;
let matched = false;
if (supplied) {
  for (const [k, v] of Object.entries(process.env)) {
    const entry = Buffer.from(`${k}=${v ?? ""}`, "utf8");
    for (let i = 0; i + len <= entry.length && !matched; i++) {
      windows++;
      if (digest(entry.subarray(i, i + len)) === mode.nonceSha256) matched = true;
    }
    if (matched) break;
  }
}
// E00-L Q3: the definition Claude would receive via --append-system-prompt-file
// (digest and booleans only; never the path's bytes or any argv/env value).
const injectAt = process.argv.indexOf("--append-system-prompt-file");
const injectFile = injectAt >= 0 ? process.argv[injectAt + 1] : null;
let injectSha = null;
try { if (injectFile) injectSha = digest(fs.readFileSync(injectFile)); } catch { injectSha = null; }
fs.writeFileSync(path.join(root, ".tc-worker-env.json"), JSON.stringify({
  schema_version: "guild.e00_tc_worker_env_check.v2",
  definition_injection_present: injectFile !== null,
  definition_injection_absolute: injectFile !== null && path.isAbsolute(injectFile),
  definition_injection_sha256: injectSha,
  binding_ref_env_present: Object.prototype.hasOwnProperty.call(process.env, "GUILD_RUN_BINDING_REF"),
  nonce_digest_supplied: supplied,
  nonce_digest_matched: matched,
  windows_checked: windows,
  assignment_locator_absolute: path.isAbsolute(assignmentPath),
  env_keys_checked: Object.keys(process.env).length,
}) + "\n");

const steps = [];
for (const item of a.done_when ?? []) {
  if (item.oracle !== "artifact_exists") continue;
  const target = JSON.parse(item.target);
  const out = path.join(root, target.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "tc artifact\n");
}

const produced = new Date().toISOString();
const receipt = [
  "---", "schema_version: guild.handoff_receipt.v1", "ids:", "  initiative_id: null",
  `  run_id: ${a.run_id}`, `  task_id: ${a.logical_task_id}`, `  task_run_id: ${a.task_run_id}`,
  `specialist: ${a.worker_role}`, "host:", `  selected: ${a.host_id}`, "  degraded: false",
  "  native_ref: null", "  independence: weak", "scope:", `  objective: ${JSON.stringify(a.objective)}`,
  `  in_scope: ${JSON.stringify(a.scope_paths)}`, "  out_of_scope_touched: []", "status: completed",
  "changed_files: []", "evidence:", "  - kind: command", `    ref: ${JSON.stringify(a.acceptance_tests[0] ?? "tc")}`, "    result: pass",
  "assumptions: []", "open_risks: []", "followups: []", `produced_at: ${produced}`,
  "---", "", "## changed_files", "- none", "", "## opens_for", "- lead", "", "## assumptions", "- none", "",
  "## evidence", "- tc fixture worker", "", "## followups", "- none", "", "```guild.handoff.v2",
  JSON.stringify({ schema_version: "guild.handoff.v2", task_id: a.logical_task_id, tier: "mid", status: "done", summary: "tc fixture lane", artifacts: [], issues: [] }),
  "```", "",
].join("\n");
const receiptPath = path.join(root, ".guild", "runs", a.run_id, "handoffs", `${a.worker_role}-${a.logical_task_id}.md`);
fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
fs.writeFileSync(receiptPath, receipt);
steps.push("receipt");

const outbox = path.join(root, ".guild", "runs", a.run_id, "outbox", a.instance_id);
const noticePath = path.join(outbox, "task-completed-notice.json");
const hook = path.join(path.resolve(path.dirname(mode.ackCli), "..", ".."), "hooks", "agent-team", "dist", "task-completed.js");
const result = {
  schema_version: "guild.e00_tc_hook_result.v1",
  invocation: "synthetic_fixture_event",
  mode: mode.mode ?? "normal",
  hook_present: fs.existsSync(hook),
  hook_ran: false, hook_exit: null, hook_timed_out: false,
  notice_present_after_hook: false, ack_claim_present_at_hook: false, controller_ack_present_at_hook: false,
  ack_started: false, ack_completed: false, ack_exit: null,
  changed_fields: [], events: [], steps: {},
};
// Observations are appended only after the step happened (ack_started just before the ack spawn); `steps` numbers
// COMPLETED steps in order. The file is rewritten after every observation, so a refusal leaves the true prefix.
const observe = (event, extra = {}) => {
  result.events.push({ seq: result.events.length + 1, event, ...extra });
  result.steps = Object.fromEntries(steps.map((s, i) => [s, i + 1]));
  fs.writeFileSync(path.join(root, ".tc-hook-result.json"), JSON.stringify(result) + "\n");
};
observe("receipt_written");
if (mode.mode !== "no-ack") {
  // The pane already carries GUILD_RUN_ID and the absolute GUILD_TASK_ASSIGNMENT; only the hook opt-in is added.
  const h = spawnSync(process.execPath, [hook], {
    cwd: root, stdio: ["pipe", "ignore", "ignore"], timeout: 120000,
    input: JSON.stringify({ hook_event_name: "TaskCompleted", cwd: root, task_id: a.logical_task_id, teammate_name: a.worker_role, team_name: "tc-fixture", session_id: "tc-fixture-worker" }),
    env: { ...process.env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" },
  });
  steps.push("hook");
  Object.assign(result, {
    hook_ran: true, hook_exit: h.status, hook_timed_out: h.error?.code === "ETIMEDOUT",
    notice_present_after_hook: fs.existsSync(noticePath),
    ack_claim_present_at_hook: fs.existsSync(path.join(outbox, "ack-claim.json")),
    controller_ack_present_at_hook: fs.existsSync(path.join(path.dirname(assignmentPath), "assignment-ack.json")),
  });
  if (mode.mode === "bad-notice" && result.notice_present_after_hook) {
    const before = JSON.parse(fs.readFileSync(noticePath, "utf8"));
    const after = { ...before, instance_id: `${a.instance_id}-other` };
    fs.writeFileSync(noticePath, JSON.stringify(after, null, 2) + "\n");
    result.changed_fields = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
  }
  observe("hook_completed", { exit: h.status });
  result.ack_started = true;
  observe("ack_started");
  const r = spawnSync(process.execPath, [mode.ackCli, "--assignment", assignmentPath], { cwd: path.join(root, "src"), stdio: "ignore" });
  steps.push("ack_cli");
  Object.assign(result, { ack_completed: true, ack_exit: r.status });
  observe("ack_completed", { exit: r.status });
  if (r.status !== 0) process.exit(4);
}

setInterval(() => {}, 1 << 30);
