import { useEffect, useRef } from "react";
import type { RunDetailResponse, RunStatus } from "../../../src/types";
import { useFetch, type UseFetchResult } from "./useFetch";
import { api } from "../lib/api";

// 2-second polling for live-run status, per the P3 plan.
// We picked polling over SSE — adds zero backend surface, fits the
// single-operator local-tool frame, and works with the existing
// useFetch + AbortController plumbing.
const POLL_INTERVAL_MS = 2000;

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "pass",
  "fail",
  "timeout",
  "errored",
]);

export interface UseRunStatusResult extends UseFetchResult<RunDetailResponse> {
  isTerminal: boolean;
  isPolling: boolean;
}

// Polls GET /api/runs/<id> every 2s while the run.json's status is missing,
// transitional, or unreachable (e.g. the file hasn't been written yet — the
// runner spawn is still in flight). Stops on terminal status (pass | fail |
// timeout | errored) and on unmount. Initial fetch routes through useFetch;
// we layer setInterval on top calling refetch() while not terminal.
export function useRunStatus(runId: string | undefined): UseRunStatusResult {
  const url = runId ? api.runDetail(runId) : null;
  const result = useFetch<RunDetailResponse>(url);

  const status = result.data?.run.status;
  const isTerminal = status != null && TERMINAL_STATUSES.has(status);
  const isPolling = !!runId && !isTerminal;

  // Stable ref so the polling effect doesn't tear down + rebuild on every
  // useFetch state churn (refetch is wrapped in useCallback by useFetch but
  // we keep the ref anyway to make the deps array obviously minimal).
  const refetchRef = useRef(result.refetch);
  refetchRef.current = result.refetch;

  useEffect(() => {
    if (!isPolling) return;
    const id = setInterval(() => refetchRef.current(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isPolling]);

  return { ...result, isTerminal, isPolling };
}
