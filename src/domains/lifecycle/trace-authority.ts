/**
 * src/domains/lifecycle/trace-authority.ts — the R01 records a T01 trace capture
 * correlates against.
 *
 * A host observation may only confirm ids that this authority holds: the run,
 * its executions (host, host session, pins, admission) and the task attempts
 * assigned in each execution (task, instance, pins, goal contributions). Grant
 * ids are collected as private literals so the capture can keep them out of
 * every sidecar, trace line and export. Only v2 logical runs have an authority;
 * a v1 or absent run refuses, and a v1 run keeps its existing trace.
 */

import { readLogicalRunView } from "./execution-identity";
import type { Pins } from "./execution-identity";

export interface TraceAuthority {
  source_id: string;
  run_id: string;
  initiative_id: string | null;
  executions: { execution_id: string; host_id: string; host_session_id: string | null; pins: Pins; admission: "active" | "reconcile_only" | "revoked" | "sealed" }[];
  assignments: { execution_id: string; logical_task_id: string; attempt_id: string; agent_instance_id: string | null; pins: Pins; goal_ids: string[] }[];
  private_literals: string[];
}

export class TraceAuthorityRefusal extends Error {
  constructor(readonly code: "not_a_logical_run", detail: string) {
    super(`trace authority refused (${code}): ${detail}`);
    this.name = "TraceAuthorityRefusal";
  }
}

export function traceAuthorityFor(root: string, runId: string, extraPrivateLiterals: readonly string[] = []): TraceAuthority {
  const view = readLogicalRunView(root, runId);
  if (view.kind !== "v2") throw new TraceAuthorityRefusal("not_a_logical_run", `${runId} is ${view.kind}; trace v3 needs a v2 logical run`);
  const { manifest } = view;
  return {
    source_id: manifest.source_id,
    run_id: manifest.run_id,
    initiative_id: manifest.initiative_id,
    executions: view.executions.map(({ segment }) => ({
      execution_id: segment.lineage.execution_id,
      host_id: segment.original_host_id,
      host_session_id: segment.host_session_id,
      pins: segment.pins,
      admission: segment.admission,
    })),
    assignments: view.assignments.map((a) => ({
      execution_id: a.lineage.execution_id,
      logical_task_id: a.lineage.logical_task_id!,
      attempt_id: a.lineage.attempt_id!,
      agent_instance_id: a.lineage.agent_instance_id,
      pins: a.pins,
      // Trace lineage carries an unqualified goal id, so only goals owned by this source can be attributed.
      goal_ids: a.goal_contributions.filter((g) => g.source_id === manifest.source_id).map((g) => g.id),
    })),
    private_literals: [...new Set([...view.assignments.map((a) => a.grant_id), ...extraPrivateLiterals])],
  };
}
