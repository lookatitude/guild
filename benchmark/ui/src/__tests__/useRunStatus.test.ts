// useRunStatus.test.ts
//
// Hook-level test for the 2-second polling contract that drives
// RunDetailPage. We exercise the hook directly through @testing-library/react's
// `renderHook` so we can assert on `isPolling`, `isTerminal`, and the exact
// number of underlying `fetch` calls. The corresponding integration-shape
// tests live in RunDetailPage.test.tsx — together they triangulate that the
// hook AND its consumer agree on the polling contract.
//
// Fake timers stub setInterval/clearInterval so we control polling cadence
// deterministically. We do NOT stub setImmediate/queueMicrotask — both are
// still needed for promise resolution + React effect commits.

import { act, renderHook } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { RunDetailResponse, RunStatus } from "../../../src/types";
import runDetailFixture from "./fixtures/run-detail.json";
import { useRunStatus } from "../hooks/useRunStatus";

// `RunStatus` is the union of *terminal* statuses ("pass" | "fail" |
// "timeout" | "errored"). The transitional "the runner is still writing
// run.json" state is not a member — the hook treats a missing/undefined
// `run.status` as non-terminal. We model that by constructing a run
// object without the `status` field. The cast through `unknown` is the
// honest acknowledgement that we're producing an under-typed payload to
// mirror the real on-the-wire shape during a live poll.
function detailWithStatus(status: RunStatus | undefined): RunDetailResponse {
  if (status === undefined) {
    const baseRun = runDetailFixture.run as RunDetailResponse["run"];
    const { status: _omit, ...runWithoutStatus } = baseRun;
    void _omit;
    return {
      ...runDetailFixture,
      run: runWithoutStatus,
    } as unknown as RunDetailResponse;
  }
  return {
    ...runDetailFixture,
    run: { ...runDetailFixture.run, status },
  } as RunDetailResponse;
}

// Minimal fetch stub that returns a configurable RunDetailResponse JSON body.
// We deliberately don't reuse installMockFetch here — that one is page-shaped
// (cases / runs / comparisons) and would dilute the hook test's failure
// signal. Each test wires its own response so the assertion ↔ payload
// coupling is local.
function installFetchStub(
  responder: (url: string) => RunDetailResponse | { status: number; body: unknown },
): { fetchSpy: ReturnType<typeof vi.fn>; reset: () => void } {
  const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const r = responder(url);
    const isErrorShape =
      typeof r === "object" && r !== null && "status" in r && "body" in r;
    if (isErrorShape) {
      const e = r as { status: number; body: unknown };
      return new Response(JSON.stringify(e.body), {
        status: e.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(r), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchSpy);
  return {
    fetchSpy,
    reset: () => vi.unstubAllGlobals(),
  };
}

async function flushAsync() {
  // Two zero-advances cover (a) fetch microtask resolution and (b) the
  // resulting setState's effect commit.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useRunStatus — polling contract", () => {
  let stub: ReturnType<typeof installFetchStub> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    stub?.reset();
    vi.useRealTimers();
  });

  it("returns idle state when run_id is undefined (no fetch fired)", async () => {
    stub = installFetchStub(() => detailWithStatus(undefined));
    const { result } = renderHook(() => useRunStatus(undefined));
    expect(result.current.status).toBe("idle");
    expect(result.current.isTerminal).toBe(false);
    expect(result.current.isPolling).toBe(false);
    // Advance time — still no fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(stub.fetchSpy).not.toHaveBeenCalled();
  });

  it("flags isPolling=true while status is non-terminal (undefined = runner still writing)", async () => {
    stub = installFetchStub(() => detailWithStatus(undefined));
    const { result } = renderHook(() => useRunStatus("r1"));
    await flushAsync();
    expect(result.current.status).toBe("success");
    // The transitional shape genuinely lacks `run.status` — runner hasn't
    // written it yet. The hook reads `data?.run.status` and treats
    // undefined as non-terminal.
    expect(result.current.data?.run.status).toBeUndefined();
    expect(result.current.isTerminal).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  it.each<[RunStatus]>([["pass"], ["fail"], ["timeout"], ["errored"]])(
    "flags isTerminal=true and isPolling=false for status=%s",
    async (status) => {
      stub = installFetchStub(() => detailWithStatus(status));
      const { result } = renderHook(() => useRunStatus("r1"));
      await flushAsync();
      expect(result.current.isTerminal).toBe(true);
      expect(result.current.isPolling).toBe(false);
    },
  );

  it("re-fetches every 2s while non-terminal", async () => {
    stub = installFetchStub(() => detailWithStatus(undefined));
    renderHook(() => useRunStatus("r1"));

    await flushAsync();
    expect(stub.fetchSpy).toHaveBeenCalledTimes(1);

    // First poll tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(2);

    // Second poll tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(3);

    // Third poll tick.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("does NOT poll once status flips to terminal mid-stream", async () => {
    let callCount = 0;
    stub = installFetchStub(() => {
      callCount += 1;
      // First call: transitional (status undefined). Second call onward:
      // pass (terminal).
      return detailWithStatus(callCount >= 2 ? "pass" : undefined);
    });
    renderHook(() => useRunStatus("r1"));

    await flushAsync();
    expect(stub.fetchSpy).toHaveBeenCalledTimes(1);

    // Tick #1 — fetch returns terminal status; effect cleanup tears down
    // the interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(2);

    // Advance 10 more seconds — no further polls because isPolling is now
    // false and the polling effect's cleanup ran.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount (no fetches after teardown)", async () => {
    stub = installFetchStub(() => detailWithStatus(undefined));
    const { unmount } = renderHook(() => useRunStatus("r1"));
    await flushAsync();
    expect(stub.fetchSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(2);

    unmount();
    const before = stub.fetchSpy.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(stub.fetchSpy.mock.calls.length).toBe(before);
  });

  it("surfaces error status when the response is non-2xx", async () => {
    stub = installFetchStub(() => ({
      status: 500,
      body: { error: "kaboom" },
    }));
    const { result } = renderHook(() => useRunStatus("r1"));
    await flushAsync();
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/HTTP 500/);
    // Even on error the underlying status field is undefined → not terminal,
    // so isPolling stays true and the hook keeps trying. This is intentional
    // so a transient backend blip doesn't permanently halt the UI.
    expect(result.current.isTerminal).toBe(false);
    expect(result.current.isPolling).toBe(true);
  });

  it("re-arms polling when run_id changes from undefined → string", async () => {
    stub = installFetchStub(() => detailWithStatus(undefined));
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useRunStatus(id),
      { initialProps: { id: undefined as string | undefined } },
    );
    expect(result.current.status).toBe("idle");
    expect(stub.fetchSpy).not.toHaveBeenCalled();

    rerender({ id: "r-new" });
    await flushAsync();
    expect(stub.fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isPolling).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(stub.fetchSpy).toHaveBeenCalledTimes(2);
  });
});
