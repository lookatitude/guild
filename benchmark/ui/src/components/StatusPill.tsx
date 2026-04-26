import type { RunStatus } from "../../../src/types";

const LABEL: Record<RunStatus, string> = {
  pass: "pass",
  fail: "fail",
  timeout: "timeout",
  errored: "errored",
};

export function StatusPill({ status }: { status: RunStatus }) {
  return (
    <span className="pill" data-status={status} aria-label={`status: ${status}`}>
      {LABEL[status]}
    </span>
  );
}

// Convenience for tests + handoff: the four canonical RunStatus values.
export const ALL_RUN_STATUSES: RunStatus[] = ["pass", "fail", "timeout", "errored"];
