import { vi } from "vitest";
import runs from "./runs.json";
import runDetail from "./run-detail.json";
import comparison from "./comparison.json";
import cases from "./cases.json";

// Shared mock-fetch wiring. Tests call `installMockFetch()` from the page
// boundary; the mock dispatches by URL prefix and returns JSON fixtures.

export const fixtures = {
  runs,
  runDetail,
  comparison,
  cases,
};

export interface MockedCall {
  url: string;
  init?: RequestInit;
}

export interface MockFetchHandle {
  fetchSpy: ReturnType<typeof vi.fn>;
  calls: MockedCall[];
  reset: () => void;
}

interface InstallOpts {
  // Allow tests to override the per-URL response shape (e.g., empty list,
  // 500 error). The handler is called before the default dispatcher.
  override?: (url: string, init?: RequestInit) => Response | undefined;
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

// Default 202 response shape for POST /api/runs — tests that don't override
// the handler get a deterministic run_id so navigation assertions can pin
// `/runs/<run_id>`. Tests that need 409/400/network failure pass an override.
function defaultPostRunResponse(): Response {
  const body = {
    run_id: "sample-running-002",
    location: "/api/runs/sample-running-002",
    started_at: "2026-04-26T06:00:00Z",
  };
  return jsonResponse(body, 202, { Location: "/api/runs/sample-running-002" });
}

export function installMockFetch(opts: InstallOpts = {}): MockFetchHandle {
  const calls: MockedCall[] = [];

  const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init });

    if (opts.override) {
      const r = opts.override(url, init);
      if (r) return r;
    }

    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "POST" && url.match(/\/api\/runs(\?|$)/)) {
      return defaultPostRunResponse();
    }

    if (url.match(/\/api\/runs(\?|$)/)) return jsonResponse(runs);
    if (url.match(/\/api\/runs\/[^/]+$/)) return jsonResponse(runDetail);
    if (url.match(/\/api\/comparisons\//)) return jsonResponse(comparison);
    if (url.match(/\/api\/cases$/)) return jsonResponse(cases);

    return new Response(`Unhandled mock url: ${url}`, { status: 599 });
  });

  vi.stubGlobal("fetch", fetchSpy);

  return {
    fetchSpy,
    calls,
    reset() {
      vi.unstubAllGlobals();
    },
  };
}
