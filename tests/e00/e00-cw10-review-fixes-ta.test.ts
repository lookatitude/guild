/**
 * CW-10 independent-review fixes (E00 qualification): each case fails on the
 * pre-fix source.
 *   F1 an oracle id is one safe path segment (it names the evidence file).
 *   F3 the real env publishes a staged/minted run binding 0600 at create.
 *   F4 an invalid glob class cannot crash the binding guard open.
 *   F5 the worker ack claim is not written through a symlinked outbox.
 *   F6 a lane's declared host_family must be its host's registry family.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildTaskAssignmentV2, taskCellPaths, validateExecutableDoneWhen, writeAckClaim } from "../../src/domains/dispatch";
import { createRealEnv, mintRunBinding, runBindingPath } from "../../src/domains/lifecycle";
import { laneBindingPathTarget } from "../../hooks/lib/security/binding-path-guard";
import { validateLaneInputs } from "../../scripts/task-cell-controller";

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), p))); dirs.push(d); return d; };

describe("CW-10 review fixes", () => {
  it("F1: a done_when id that is a path is refused before any evidence path is built", () => {
    const target = JSON.stringify({ path: "src/api/x.ts", sha256: null });
    const ctx = { scope_paths: ["src/api"], dependencies: [] };
    for (const id of ["../../../../../../outside", "a/b", ".hidden", ""]) {
      const r = validateExecutableDoneWhen([{ id, oracle: "artifact_exists", target }], ctx);
      expect({ id, ok: r.ok }).toEqual({ id, ok: false });
    }
    expect(validateExecutableDoneWhen([{ id: "api.v1:check", oracle: "artifact_exists", target }], ctx).ok).toBe(true);
  });

  it("F3: the real lifecycle env mints the run binding private under a permissive umask", () => {
    const root = tmp("guild-cw10-f3-");
    const saved = process.umask(0o022);
    try {
      const env = createRealEnv(root);
      mintRunBinding({ root, run_id: "run-cw10-f3", fs: env.fs });
    } finally {
      process.umask(saved);
    }
    expect((fs.statSync(runBindingPath(root, "run-cw10-f3")).mode & 0o777).toString(8)).toBe("600");
  });

  it("F4: an invalid character range in a lane command is denied, not thrown", () => {
    const env = { GUILD_LANE_ID: "lane-1" } as NodeJS.ProcessEnv;
    const input = { command: 'printf %s "[z-a]"; cat .guild/runs/run-e00/./binding.json' };
    let target: string | null = null;
    expect(() => { target = laneBindingPathTarget(env, "Bash", input); }).not.toThrow();
    expect(target).not.toBeNull();
    expect(laneBindingPathTarget(env, "Read", { file_path: ".guild/runs/[z-a]/binding.json" })).not.toBeNull();
  });

  it("F5: the ack claim refuses an outbox directory that is a symlink out of the root", () => {
    const root = tmp("guild-cw10-f5-");
    const outside = tmp("guild-cw10-f5-out-");
    const runId = "run-cw10-f5";
    const a = buildTaskAssignmentV2({
      run_id: runId, cell_id: "cell-api", goal_id: "goal", phase_id: "build", step_id: "api", team_id: "team",
      logical_task_id: "api", task_run_id: "api.tr1", attempt: 1, attempt_id: "api.tr1.a1", previous_attempt_id: null,
      retry_reason: null, instance_id: "inst-api-1", lead_binding_id: "lead", team_lead_instance_id: null, worker_role: "backend",
      specialist_type_id: "backend", specialist_type_version: "1", specialist_type_hash: "sha256:t",
      specialist_profile_id: "backend", specialist_profile_hash: "sha256:p", context_bundle_id: "ctx", context_bundle_hash: "sha256:c",
      host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:h",
      objective: "o", non_goals: [], scope_paths: ["src/api"], output_schema: "guild.handoff_receipt.v1", acceptance_tests: ["t"],
      dependencies: [], projection: { tools: ["read"], permissions: [], recorded_losses: [] }, autonomy_policy: "supervised",
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, deadline: null, written_at: "2026-11-05T00:00:00.000Z",
    } as never);
    const assignmentAbs = path.join(root, taskCellPaths(a as never).assignment_path);
    fs.mkdirSync(path.dirname(assignmentAbs), { recursive: true });
    fs.writeFileSync(assignmentAbs, JSON.stringify(a, null, 2) + "\n");
    fs.mkdirSync(path.join(root, ".guild", "runs", runId), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".guild", "runs", runId, "outbox"));
    const r = writeAckClaim({ assignmentPath: assignmentAbs, now: () => "2026-11-05T00:00:01.000Z" });
    expect({ ok: r.ok, outside: fs.readdirSync(outside) }).toEqual({ ok: false, outside: [] });
  });

  it("F6: a lane labelled with another host's family is refused", () => {
    const lane = (family: string) => ({
      logical_task_id: "api", dependencies: [],
      host: { host_id: "claude-code-cli", adapter_id: "claude-code-cli@1", host_capabilities_hash: "sha256:h", host_family: family },
    });
    const ok = validateLaneInputs([lane("anthropic")]);
    expect(ok.ok).toBe(true);
    const bad = validateLaneInputs([lane("openai")]);
    expect({ ok: bad.ok, reason: (bad as { reason?: string }).reason }).toEqual({ ok: false, reason: "host_family_mismatch" });
  });
});
