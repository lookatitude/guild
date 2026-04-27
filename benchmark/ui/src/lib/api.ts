// Typed wrappers around fetch("/api/...") — purely URL builders so the
// useFetch hook can call them with a string. All requests are proxied via
// vite.config.ts in dev (→ http://127.0.0.1:3055) and served by the same
// backend in production.

import type { RunPostRequest, RunPostResponse } from "../../../src/types";

const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export const api = {
  base: API_BASE,
  runs: (caseSlug?: string) =>
    caseSlug
      ? `${API_BASE}/runs?case=${encodeURIComponent(caseSlug)}`
      : `${API_BASE}/runs`,
  runDetail: (runId: string) => `${API_BASE}/runs/${encodeURIComponent(runId)}`,
  artifact: (runId: string, path: string) =>
    `${API_BASE}/runs/${encodeURIComponent(runId)}/artifacts/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  comparison: (baseline: string, candidate: string) =>
    `${API_BASE}/comparisons/${encodeURIComponent(baseline)}/${encodeURIComponent(
      candidate,
    )}`,
  cases: () => `${API_BASE}/cases`,
};

export type PostRunErrorBody = {
  error?: string;
  reason?: string;
  current_run_id?: string;
  [k: string]: unknown;
};

export class PostRunError extends Error {
  status: number;
  body: PostRunErrorBody;
  constructor(status: number, body: PostRunErrorBody, message: string) {
    super(message);
    this.name = "PostRunError";
    this.status = status;
    this.body = body;
  }
}

// POST /api/runs — backend (T2) returns 202 + Location + RunPostResponse on
// success; 409 with { reason: "run_in_flight", current_run_id } when another
// run is already in flight; 400 on shape error. Network failures throw the
// underlying TypeError untouched (caller treats as "couldn't reach server").
export async function postRun(req: RunPostRequest): Promise<RunPostResponse> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 202) {
    return (await res.json()) as RunPostResponse;
  }
  const body: PostRunErrorBody = await res.json().catch(() => ({}));
  const message =
    typeof body.error === "string"
      ? body.error
      : typeof body.reason === "string"
        ? body.reason
        : `unexpected status ${res.status}`;
  throw new PostRunError(res.status, body, message);
}
