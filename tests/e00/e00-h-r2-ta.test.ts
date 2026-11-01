/**
 * E00-T0 · independent reds for the H r2 finding (review/G-lane-E00-H/result-r2.json,
 * implementation/e00/h-r2-triage-and-red-test-release.json), authored BEFORE any H source change.
 *
 * H2-F1 an unbound TaskCompleted whose guild.handoff.v2 envelope carries a secret-bearing UNKNOWN
 *       key must refuse with the generic Q1 predicate `secret_scrub_required`, never a diagnostic
 *       that names the key, and must write nothing (no notice). Two policies: the built-in default
 *       (AWS key shape) and a valid operator-configured redaction pattern.
 * Controls: a clean invalid envelope keeps its existing SC-7 diagnostic and refusal; a clean valid
 *       receipt writes only its notice; a valid envelope with a secret (default or configured) keeps
 *       the existing secret_scrub_required refusal.
 *
 * Same legitimate fixture as the frozen H1 file: buildTaskCell/writeTaskCell with a minted binding,
 * the canonical receiptBytes receipt, the layout provisioned up front, and the real hook run with no
 * binding ref (unbound). Canaries are compared only as booleans.
 *
 * Layers: every case runs against the raw source (npx tsx hooks/agent-team/task-completed.ts) and the
 * compiled bundle (node hooks/agent-team/dist/task-completed.js), labelled separately.
 * E00_H2_LAYER=source|dist selects one layer; unset runs both.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { hermeticEnv } from "../../hooks/test-support/hermetic-env";
import { ensureStorageLayout } from "../../hooks/lib/ensure-layout";
import * as handoffV2 from "../../hooks/lib/handoff-v2";
import * as notice from "../../hooks/lib/task-completed-notice";
import * as securityConfig from "../../hooks/lib/security/config";
import * as secrets from "../../hooks/lib/security/secrets";
import { PLUGIN, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const LAYERS: Record<string, [string, string[]]> = {
  source: ["npx", ["tsx", path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts")]],
  dist: ["node", [path.join(PLUGIN, "hooks", "agent-team", "dist", "task-completed.js")]],
};
const SELECTED = process.env["E00_H2_LAYER"];
if (SELECTED !== undefined && !(SELECTED in LAYERS)) throw new Error("E00_H2_LAYER must be source or dist");
const RUN_ID = "run-e00-h2";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const CFG_PATTERN = "E00H2CFG-[a-z]{8}";

// ── Fixture (same shape as the frozen H1 file) ──

interface Fx { root: string; c: ReturnType<typeof buildTaskCell>; receipt: string; notice: string; content: string }
function fixture(o: { extraKey?: string; bodyCanary?: string; patterns?: string[] } = {}): Fx {
  const root = ownedTempDir("guild-e00-h2-");
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal-e00", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 h2", scopePaths: ["hooks/agent-team"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["npm test -- hook"],
    projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-e00",
    now: () => "2026-10-26T13:00:00.000Z",
  });
  (c.assignment as Record<string, unknown>)["done_when_ref"] = {
    oracle_plan_path: `.guild/runs/${RUN_ID}/oracle-plan/build.json`, oracle_plan_sha256: "a".repeat(64), decision_sha256: "b".repeat(64),
  };
  writeTaskCell(root, c, { binding_ref: bindingRef });
  const receipt = path.join(root, ".guild", "runs", RUN_ID, "handoffs", "backend-task-001.md");
  fs.mkdirSync(path.dirname(receipt), { recursive: true });
  let body = receiptBytes(RUN_ID, c.assignment);
  if (o.bodyCanary) body = body.replace("- runtime collection", `- runtime collection ${o.bodyCanary}`);
  if (o.extraKey !== undefined) body = body.replace(`"issues":[]}`, `"issues":[],${JSON.stringify(o.extraKey)}:"x"}`);
  fs.writeFileSync(receipt, body);
  const noticePath = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  if (o.patterns) fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ secrets_policy: { redaction_patterns: o.patterns } }, null, 2) + "\n");
  return { root, c, receipt, notice: noticePath, content: body };
}
function runTC(layer: string, f: Fx) {
  const [bin, args] = LAYERS[layer]!;
  const r = spawnSync(bin, args, {
    input: JSON.stringify({ session_id: "e00-h2", cwd: f.root, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
      task_subject: "e00", teammate_name: f.c.assignment.worker_role, team_name: "guild-team" }),
    encoding: "utf8",
    env: { ...hermeticEnv(), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: RUN_ID, GUILD_TASK_ASSIGNMENT: f.c.assignment.assignment_path },
    timeout: 30000,
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
const delta = (a: Record<string, string>, b: Record<string, string>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
const awsCanary = () => `AKIA${crypto.randomBytes(12).toString("hex").toUpperCase().slice(0, 16)}`;
const cfgCanary = () => `E00H2CFG-${Array.from(crypto.randomBytes(8), (b) => String.fromCharCode(97 + (b % 26))).join("")}`;
/** The final `[task-completed] BLOCKED:` line, or null. */
const finalBlocked = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[task-completed] BLOCKED:")).pop() ?? null;
const SECRET_REFUSAL = /TaskCell task-completed notice refused for task "task-001" — secret_scrub_required \(no write performed\)\.$/;

/** Run the hook once and summarize it without ever echoing a canary. */
function observe(layer: string, f: Fx, canary: string | null) {
  const before = tree(f.root);
  const r = runTC(layer, f);
  const changed = delta(before, tree(f.root));
  const last = finalBlocked(r.stderr);
  expect(r.timedOut).toBe(false);
  return {
    refused: r.status !== 0 && r.status !== null,
    final_secret_scrub_required: last !== null && SECRET_REFUSAL.test(last),
    canary_in_stdout: canary !== null && r.stdout.includes(canary),
    canary_in_stderr: canary !== null && r.stderr.includes(canary),
    tree_writes: changed.length,
    notice_written: fs.existsSync(f.notice),
    receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content,
    last,
    stderr: r.stderr,
  };
}

// ── Stage/seam prerequisites, checked in-process for each red fixture ──

function prerequisites(f: Fx, canary: string, configured: boolean) {
  const env = handoffV2.extractHandoffEnvelope(f.content);
  const v = env === null ? null : handoffV2.validateHandoffV2(env);
  const policy = securityConfig.readSecurityConfig(f.root).secrets_policy;
  const defaults = securityConfig.securityDefaults().secrets_policy;
  const withoutKey = env === null ? null : Object.fromEntries(Object.entries(env as Record<string, unknown>).filter(([k]) => k !== canary));
  return {
    envelope_extracted: env !== null,
    envelope_has_canary_key: env !== null && Object.prototype.hasOwnProperty.call(env, canary),
    canary_only_in_envelope_key: f.content.split(canary).length === 2,
    validation_invalid: v !== null && v.valid === false,
    validation_errors_carry_canary: v !== null && v.errors.some((e) => e.includes(canary)),
    envelope_valid_without_canary_key: withoutKey !== null && handoffV2.validateHandoffV2(withoutKey).valid === true,
    configured_pattern_parsed: JSON.stringify(policy.redaction_patterns) === JSON.stringify(configured ? [CFG_PATTERN] : []),
    default_policy_detects: secrets.applySecretsPolicy(f.content, defaults, { noTruncate: true }).value !== f.content,
    receipt_is_secret_clean: notice.receiptIsSecretClean(f.root, f.content),
  };
}

for (const layer of SELECTED !== undefined ? [SELECTED] : Object.keys(LAYERS)) {
  // ── H2-F1 reds ──

  describe(`[${layer}] H2-F1 · a secret-bearing unknown envelope key refuses generically before any receipt-derived diagnostic`, () => {
    const arms: Array<[string, () => string, boolean]> = [
      ["default policy (built-in AWS key shape)", awsCanary, false],
      ["valid configured redaction pattern", cfgCanary, true],
    ];
    for (const [label, mint, configured] of arms) {
      it(`${label}: final predicate secret_scrub_required, no canary in stdout/stderr, zero tree writes, no notice`, () => {
        const canary = mint();
        const f = fixture({ extraKey: canary, patterns: configured ? [CFG_PATTERN] : undefined });
        // Prerequisites: the fixture reaches validateHandoffV2 with the canary as an unknown key, the
        // error text carries it, the envelope is otherwise valid, and the policy (default or configured)
        // already judges this receipt not clean. Any fixture/setup fault fails here, not below.
        expect(prerequisites(f, canary, configured)).toEqual({
          envelope_extracted: true, envelope_has_canary_key: true, canary_only_in_envelope_key: true,
          validation_invalid: true, validation_errors_carry_canary: true, envelope_valid_without_canary_key: true,
          configured_pattern_parsed: true, default_policy_detects: !configured, receipt_is_secret_clean: false,
        });
        const o = observe(layer, f, canary);
        const { last: _last, stderr: _stderr, ...summary } = o;
        expect(summary).toEqual({
          refused: true, final_secret_scrub_required: true, canary_in_stdout: false, canary_in_stderr: false,
          tree_writes: 0, notice_written: false, receipt_unchanged: true,
        });
      });
    }
  });

  // ── Controls ──

  describe(`[${layer}] H2 controls · existing validation and Q1 refusal behaviour is kept`, () => {
    it("control: a clean invalid envelope (non-secret unknown key) keeps the SC-7 diagnostic and refusal with zero writes", () => {
      const key = "e00_h2_extra_key";
      const f = fixture({ extraKey: key });
      expect(notice.receiptIsSecretClean(f.root, f.content)).toBe(true);
      const o = observe(layer, f, null);
      expect({
        refused: o.refused, tree_writes: o.tree_writes, notice_written: o.notice_written, receipt_unchanged: o.receipt_unchanged,
        invalid_envelope_diagnostic: o.last !== null && /contains an invalid guild\.handoff\.v2 envelope/.test(o.last),
        names_unknown_key: o.stderr.includes(`unknown key "${key}"`),
      }).toEqual({ refused: true, tree_writes: 0, notice_written: false, receipt_unchanged: true, invalid_envelope_diagnostic: true, names_unknown_key: true });
    });

    it("control: a clean valid receipt succeeds and writes only its notice", () => {
      const f = fixture();
      const before = tree(f.root);
      const r = runTC(layer, f);
      const changed = delta(before, tree(f.root));
      const noticeRel = path.relative(f.root, f.notice);
      expect(r.timedOut).toBe(false);
      expect({
        status: r.status, notice_written: fs.existsSync(f.notice),
        extra_paths: changed.filter((k) => k !== noticeRel && !noticeRel.startsWith(`${k}${path.sep}`)),
        receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content,
      }).toEqual({ status: 0, notice_written: true, extra_paths: [], receipt_unchanged: true });
    });

    const valid: Array<[string, () => string, boolean]> = [
      ["default-policy canary", awsCanary, false],
      ["configured-pattern canary", cfgCanary, true],
    ];
    for (const [label, mint, configured] of valid) {
      it(`control: a valid envelope with a ${label} in the body keeps the secret_scrub_required refusal with zero writes`, () => {
        const canary = mint();
        const f = fixture({ bodyCanary: canary, patterns: configured ? [CFG_PATTERN] : undefined });
        expect(notice.receiptIsSecretClean(f.root, f.content)).toBe(false);
        const { last: _last, stderr: _stderr, ...summary } = observe(layer, f, canary);
        expect(summary).toEqual({
          refused: true, final_secret_scrub_required: true, canary_in_stdout: false, canary_in_stderr: false,
          tree_writes: 0, notice_written: false, receipt_unchanged: true,
        });
      });
    }
  });
}
