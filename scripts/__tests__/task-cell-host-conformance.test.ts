import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildTaskCellHostConformanceMatrix,
  runTaskCellHostConformance,
  verifyTaskCellHostConformanceReceipt,
  type HostProbeRunner,
} from "../../src/modules/dispatch/workflows/task-cell-host-conformance";

const NOW = "2026-08-10T18:00:00.000Z";

function fakeRunner(options: { invalidSecond?: boolean; preflightOk?: boolean } = {}): HostProbeRunner {
  let calls = 0;
  return {
    preflight(input) {
      return {
        ok: options.preflightOk !== false,
        requested_host: input.host,
        bound_host_id: options.preflightOk === false ? null : `${input.host}-cli`,
        capability_snapshot_hash: options.preflightOk === false ? null : "sha256:caps",
        mechanics_mode: input.host === "claude" ? "native" : "wrapped",
        launch_requested: "read_only",
        launch_effective: "read_only",
        degradation_reasons: input.host === "claude" ? [] : ["session uses the wrapped rung"],
        evidence: { source: "fake-preflight" },
        errors: options.preflightOk === false ? ["host binary unavailable"] : [],
      };
    },
    invoke(input) {
      calls += 1;
      const context = fs.readFileSync(path.join(input.cwd, input.assignment.context_bundle_id), "utf8").trim();
      const handoff = options.invalidSecond && calls === 2
        ? null
        : {
            schema_version: "guild.handoff.v2" as const,
            task_id: input.assignment.logical_task_id,
            tier: "cheap" as const,
            status: "done" as const,
            summary: context,
            artifacts: [],
            issues: [],
            injection_clean: "clean" as const,
          };
      return {
        exit: handoff ? 0 : 2,
        stdout: handoff ? `\`\`\`guild.handoff.v2\n${JSON.stringify(handoff)}\n\`\`\`` : "invalid",
        stderr: "",
        wrapper_record: {
          schema_version: "guild.run_wrapper_record.v1",
          host: input.host,
          exit: handoff ? 0 : 2,
          contract: "guild.handoff.v2",
          normalized: { ok: Boolean(handoff), failed_closed: !handoff },
          host_adapter: {
            boundary: {
              disposition: "succeeded",
              host_id: `${input.host}-cli`,
              capability_snapshot_hash: "sha256:caps",
            },
          },
        },
        handoff,
        errors: handoff ? [] : ["invalid structured result"],
      };
    },
  };
}

describe("installed-host TaskCell lifecycle conformance", () => {
  it("drives two live attempts through the canonical runtime and emits a verified receipt", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-conformance-"));
    let tick = Date.parse(NOW);
    const receipt = await runTaskCellHostConformance({
      cwd,
      run_id: "run-host-conformance",
      host: "codex",
      runner: fakeRunner(),
      now: () => new Date(tick++).toISOString(),
      nonceFactory: (attempt) => `nonce-${attempt}`,
    });

    expect(receipt.schema_version).toBe("guild.task_cell_host_conformance_receipt.v1");
    expect(receipt.task_team_verified).toBe(true);
    expect(receipt.support_state).toBe("verified_with_degradation");
    expect(receipt.attempts).toHaveLength(2);
    expect(receipt.attempts.map((item) => item.task_run_id)).toEqual(["host-probe-codex.tr1", "host-probe-codex.tr2"]);
    expect(new Set(receipt.attempts.map((item) => item.instance_id)).size).toBe(2);
    expect(receipt.attempts[1].previous_attempt_id).toBe(receipt.attempts[0].attempt_id);
    expect(new Set(receipt.attempts.map((item) => item.handoff_receipt_path)).size).toBe(2);
    expect(receipt.attempts.every((item) => item.handoff_receipt_path.endsWith("/handoff-receipt.md"))).toBe(true);
    expect(receipt.attempts.every((item) => item.context_bundle_hash === receipt.attempts[0].context_bundle_hash)).toBe(true);
    expect(receipt.normalized_trace).toEqual([
      "spawn_started", "spawned", "ready", "assignment_delivered",
      "assignment_acknowledged", "running", "handoff_submitted",
      "handoff_validated", "handoff_accepted", "termination_started", "terminated",
    ]);
    expect(receipt.concerns.find((item) => item.id === "heartbeat_cancel_terminate")?.status).toBe("degraded");
    expect(receipt.concerns.every((item) => item.status !== "refused")).toBe(true);
    expect(fs.existsSync(path.join(cwd, receipt.receipt_path))).toBe(true);
    expect(verifyTaskCellHostConformanceReceipt({
      cwd,
      receiptFile: path.join(cwd, receipt.receipt_path),
      expectedRunId: "run-host-conformance",
    })).toMatchObject({ valid: true, errors: [] });
  });

  it("fails closed on an invalid host result and never labels the host verified", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-conformance-invalid-"));
    const receipt = await runTaskCellHostConformance({
      cwd,
      run_id: "run-invalid",
      host: "codex",
      runner: fakeRunner({ invalidSecond: true }),
      now: () => NOW,
      nonceFactory: (attempt) => `nonce-${attempt}`,
    });
    expect(receipt.task_team_verified).toBe(false);
    expect(receipt.support_state).toBe("refused");
    expect(receipt.concerns.find((item) => item.id === "structured_result_normalization")?.status).toBe("refused");
  });

  it("records an unavailable requested host as refused without guessing Claude", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-conformance-missing-"));
    const receipt = await runTaskCellHostConformance({
      cwd,
      run_id: "run-missing",
      host: "not-installed",
      runner: fakeRunner({ preflightOk: false }),
      now: () => NOW,
    });
    expect(receipt.requested_host).toBe("not-installed");
    expect(receipt.bound_host_id).toBeNull();
    expect(receipt.task_team_verified).toBe(false);
    expect(receipt.support_state).toBe("refused");
    expect(JSON.stringify(receipt)).not.toContain("claude-cli");
  });

  it("requires equivalent normalized traces before the matrix can pass", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-matrix-"));
    const a = await runTaskCellHostConformance({
      cwd,
      run_id: "run-matrix",
      host: "claude",
      runner: fakeRunner(),
      now: () => NOW,
    });
    const b = await runTaskCellHostConformance({
      cwd,
      run_id: "run-matrix",
      host: "codex",
      runner: fakeRunner(),
      now: () => NOW,
    });
    expect(buildTaskCellHostConformanceMatrix([a, b])).toMatchObject({ ok: true, equivalent_traces: true });
    const forged = { ...b, normalized_trace: [...b.normalized_trace, "failed"] };
    expect(buildTaskCellHostConformanceMatrix([a, forged])).toMatchObject({ ok: false, equivalent_traces: false });
    expect(buildTaskCellHostConformanceMatrix([{ ...a, attempts: [], task_team_verified: true }])).toMatchObject({ ok: false });
  });

  it("rejects a copied or mixed-run receipt even when its self-reported verdict is green", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-forged-receipt-"));
    const receipt = await runTaskCellHostConformance({ cwd, run_id: "run-real", host: "codex", runner: fakeRunner(), now: () => NOW });
    const copied = path.join(cwd, "forged.json");
    fs.writeFileSync(copied, JSON.stringify({ ...receipt, run_id: "run-other", task_team_verified: true }));
    const verified = verifyTaskCellHostConformanceReceipt({ cwd, receiptFile: copied, expectedRunId: "run-real" });
    expect(verified.valid).toBe(false);
    expect(verified.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/run_id/),
      expect.stringMatching(/canonical/),
    ]));
  });
});
