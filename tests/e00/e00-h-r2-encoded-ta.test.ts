/**
 * E00-T0 · independent reds for the H r2 encoded-diagnostic extension
 * (implementation/e00/h-r2-encoded-triage-and-red-release.json; readback
 * evidence/e00-h/r2-encoded-diagnostic-readback.json), authored BEFORE any H source change.
 *
 * The raw receipt is policy-clean because the secret is written with a JSON escape; JSON.parse
 * decodes it and validateHandoffV2 echoes the decoded text into the unbound hook's diagnostic.
 * E1 unknown key whose first character is \u-escaped (configured pattern).
 * E2 the same encoded canary as the `tier` enum value (echoed via JSON.stringify).
 * E3 unknown key holding an escaped newline that a configured pattern classifies once decoded;
 *    JSON.stringify(rawEnvelope) re-escapes it, so only the rendered diagnostic shows the secret.
 * Each red must end in the generic secret_scrub_required refusal with no canary in stdout/stderr,
 * zero tree writes and no notice. Control: a policy-clean \u-escaped unknown key keeps its SC-7
 * diagnostic naming the decoded key.
 *
 * Same legitimate fixture as tests/e00/e00-h-r2-ta.test.ts; synthetic low-entropy canaries under
 * valid configured patterns only (the default-policy AWS arm is not claimed here). Layers: raw source
 * (npx tsx) and compiled bundle (node dist), labelled separately; E00_H2E_LAYER=source|dist selects
 * one, unset runs both. Canaries and validator errors are compared only as booleans.
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
import { PLUGIN, ownedTempDir, receiptBytes, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const LAYERS: Record<string, [string, string[]]> = {
  source: ["npx", ["tsx", path.join(PLUGIN, "hooks", "agent-team", "task-completed.ts")]],
  dist: ["node", [path.join(PLUGIN, "hooks", "agent-team", "dist", "task-completed.js")]],
};
const SELECTED = process.env["E00_H2E_LAYER"];
if (SELECTED !== undefined && !(SELECTED in LAYERS)) throw new Error("E00_H2E_LAYER must be source or dist");
const RUN_ID = "run-e00-h2e";
const sha = (b: Buffer | string) => crypto.createHash("sha256").update(b).digest("hex");
const CFG_PATTERN = "E00H2CFG-[a-z]{8}";
const NL_PATTERN = "E00H2NL-[a-z]{4}\\n[a-z]{4}";
const PATTERNS = [CFG_PATTERN, NL_PATTERN];
const letters = (n: number) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(97 + (b % 26))).join("");
/** JSON source text for `s` with its first character written as a \uXXXX escape. */
const escapeFirst = (s: string) => `\\u${s.charCodeAt(0).toString(16).padStart(4, "0")}${s.slice(1)}`;

// ── Fixture (same shape as the frozen H2 file) ──

interface Fx { root: string; c: ReturnType<typeof buildTaskCell>; receipt: string; notice: string; content: string }
function fixture(edit: (body: string) => string): Fx {
  const root = ownedTempDir("guild-e00-h2e-");
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal-e00", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "e00 h2e", scopePaths: ["hooks/agent-team"],
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
  const base = receiptBytes(RUN_ID, c.assignment);
  const body = edit(base);
  expect(body !== base).toBe(true);
  fs.writeFileSync(receipt, body);
  const noticePath = path.join(root, ".guild", "runs", RUN_ID, "outbox", c.assignment.instance_id, "task-completed-notice.json");
  expect(ensureStorageLayout(root, "e00-t0-fixture").ok).toBe(true);
  fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ secrets_policy: { redaction_patterns: PATTERNS } }, null, 2) + "\n");
  return { root, c, receipt, notice: noticePath, content: body };
}
const withExtraKey = (rawKeyJson: string) => (b: string) => b.replace(`"issues":[]}`, `"issues":[],"${rawKeyJson}":"x"}`);
const withTier = (rawValueJson: string) => (b: string) => b.replace(`"tier":"mid"`, `"tier":"${rawValueJson}"`);

function runTC(layer: string, f: Fx) {
  const [bin, args] = LAYERS[layer]!;
  const r = spawnSync(bin, args, {
    input: JSON.stringify({ session_id: "e00-h2e", cwd: f.root, hook_event_name: "TaskCompleted", task_id: f.c.assignment.logical_task_id,
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
const SECRET_REFUSAL = /TaskCell task-completed notice refused for task "task-001" — secret_scrub_required \(no write performed\)\.$/;
const finalBlocked = (stderr: string) => stderr.split("\n").filter((l) => l.startsWith("[task-completed] BLOCKED:")).pop() ?? null;

function observe(layer: string, f: Fx, canary: string | null) {
  const before = tree(f.root);
  const r = runTC(layer, f);
  const changed = delta(before, tree(f.root));
  const last = finalBlocked(r.stderr);
  expect(r.timedOut).toBe(false);
  return {
    summary: {
      refused: r.status !== 0 && r.status !== null,
      final_secret_scrub_required: last !== null && SECRET_REFUSAL.test(last),
      canary_in_stdout: canary !== null && r.stdout.includes(canary),
      canary_in_stderr: canary !== null && r.stderr.includes(canary),
      tree_writes: changed.length,
      notice_written: fs.existsSync(f.notice),
      receipt_unchanged: fs.readFileSync(f.receipt, "utf8") === f.content,
    },
    stderr: r.stderr,
  };
}

/** In-process stage/seam prerequisites; booleans only. `drop` removes the injected field to prove the rest is valid. */
function prerequisites(f: Fx, canary: string, drop: (env: Record<string, unknown>) => Record<string, unknown>) {
  const env = handoffV2.extractHandoffEnvelope(f.content) as Record<string, unknown> | null;
  const v = env === null ? null : handoffV2.validateHandoffV2(env);
  const rendered = v === null ? "" : v.errors.map((e) => `  - ${e}`).join("\n");
  return {
    configured_patterns_parsed: JSON.stringify(securityConfig.readSecurityConfig(f.root).secrets_policy.redaction_patterns) === JSON.stringify(PATTERNS),
    canary_absent_from_raw_receipt: !f.content.includes(canary),
    raw_receipt_policy_clean: notice.receiptIsSecretClean(f.root, f.content),
    envelope_extracted: env !== null,
    validation_invalid: v !== null && v.valid === false,
    otherwise_valid: env !== null && handoffV2.validateHandoffV2(drop(env)).valid === true,
    rendered_errors_carry_canary: rendered.includes(canary),
    rendered_errors_policy_clean: notice.receiptIsSecretClean(f.root, rendered),
    reserialized_envelope_policy_clean: env !== null && notice.receiptIsSecretClean(f.root, JSON.stringify(env)),
  };
}
const RED = { refused: true, final_secret_scrub_required: true, canary_in_stdout: false, canary_in_stderr: false, tree_writes: 0, notice_written: false, receipt_unchanged: true };

// ── Reds and control, per layer ──

for (const layer of SELECTED !== undefined ? [SELECTED] : Object.keys(LAYERS)) {
  describe(`[${layer}] H2 encoded · a JSON-escaped secret decoded into the validator diagnostic refuses generically`, () => {
    it("E1 unknown key with a \\u-escaped first character (configured pattern)", () => {
      const canary = `E00H2CFG-${letters(8)}`;
      const f = fixture(withExtraKey(escapeFirst(canary)));
      expect(prerequisites(f, canary, (e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== canary)))).toEqual({
        configured_patterns_parsed: true, canary_absent_from_raw_receipt: true, raw_receipt_policy_clean: true, envelope_extracted: true,
        validation_invalid: true, otherwise_valid: true, rendered_errors_carry_canary: true, rendered_errors_policy_clean: false,
        reserialized_envelope_policy_clean: false,
      });
      expect(observe(layer, f, canary).summary).toEqual(RED);
    });

    it("E2 \\u-escaped canary as the tier enum value (configured pattern)", () => {
      const canary = `E00H2CFG-${letters(8)}`;
      const f = fixture(withTier(escapeFirst(canary)));
      expect(prerequisites(f, canary, (e) => ({ ...e, tier: "mid" }))).toEqual({
        configured_patterns_parsed: true, canary_absent_from_raw_receipt: true, raw_receipt_policy_clean: true, envelope_extracted: true,
        validation_invalid: true, otherwise_valid: true, rendered_errors_carry_canary: true, rendered_errors_policy_clean: false,
        reserialized_envelope_policy_clean: false,
      });
      expect(observe(layer, f, canary).summary).toEqual(RED);
    });

    it("E3 unknown key with an escaped newline: re-serialized envelope stays clean, rendered diagnostic does not", () => {
      const head = `E00H2NL-${letters(4)}`; const tail = letters(4);
      const canary = `${head}\n${tail}`;
      const f = fixture(withExtraKey(`${head}\\n${tail}`));
      // reserialized_envelope_policy_clean=true: JSON.stringify re-escapes the newline, so a check on
      // the re-serialized envelope alone (O1) would pass this receipt; the rendered body (O2) would not.
      expect(prerequisites(f, canary, (e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== canary)))).toEqual({
        configured_patterns_parsed: true, canary_absent_from_raw_receipt: true, raw_receipt_policy_clean: true, envelope_extracted: true,
        validation_invalid: true, otherwise_valid: true, rendered_errors_carry_canary: true, rendered_errors_policy_clean: false,
        reserialized_envelope_policy_clean: true,
      });
      expect(observe(layer, f, canary).summary).toEqual(RED);
    });
  });

  describe(`[${layer}] H2 encoded control · a policy-clean escaped unknown key keeps its SC-7 diagnostic`, () => {
    it("control: \\u-escaped clean unknown key refuses with the SC-7 diagnostic naming the decoded key, zero writes", () => {
      const key = "e00_h2e_extra_key";
      const f = fixture(withExtraKey(escapeFirst(key)));
      expect({ raw_has_decoded_key: f.content.includes(key), raw_clean: notice.receiptIsSecretClean(f.root, f.content) }).toEqual({ raw_has_decoded_key: false, raw_clean: true });
      const o = observe(layer, f, null);
      expect({
        refused: o.summary.refused, tree_writes: o.summary.tree_writes, notice_written: o.summary.notice_written, receipt_unchanged: o.summary.receipt_unchanged,
        invalid_envelope_diagnostic: /contains an invalid guild\.handoff\.v2 envelope/.test(o.stderr),
        names_decoded_key: o.stderr.includes(`unknown key "${key}"`),
      }).toEqual({ refused: true, tree_writes: 0, notice_written: false, receipt_unchanged: true, invalid_envelope_diagnostic: true, names_decoded_key: true });
    });
  });
}
