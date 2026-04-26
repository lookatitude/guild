// RunDetailPage.test.tsx
//
// Surface tests + P3 polling-contract tests. The P3 contract is:
//   - useRunStatus polls GET /api/runs/<id> every 2s while the run.json's
//     status is non-terminal.
//   - When status becomes terminal (pass | fail | timeout | errored), the
//     interval clears and no further fetches fire.
//   - On unmount, the interval is cleared (no fetches after teardown).
//   - While polling, the page shows a `data-testid="run-in-progress-banner"`
//     "Run in progress…" banner; once terminal, the banner is gone.
//
// We use vitest fake timers for polling tests — `toFake: ["setInterval",
// "clearInterval", "setTimeout", "clearTimeout"]` so React's microtasks and
// `queueMicrotask` keep working. Each `vi.advanceTimersByTimeAsync(2000)`
// drains the interval tick + the setState chain that follows useFetch's
// resolved promise.

import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RunDetailPage from "../routes/RunDetailPage";
import runDetailFixture from "./fixtures/run-detail.json";
import { installMockFetch } from "./fixtures/mockFetch";

function mount(runId = "sample-pass-001") {
  return render(
    <MemoryRouter initialEntries={[`/runs/${runId}`]}>
      <Routes>
        <Route path="/runs/:run_id" element={<RunDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetailPage — surface", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders the score card, stages, components, artifacts, and metadata", async () => {
    handle = installMockFetch();
    mount();

    expect(
      screen.getByRole("heading", { level: 1 }),
    ).toHaveTextContent("sample-pass-001");

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Score components" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("missing_artifact")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Stages" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Run metadata" })).toBeInTheDocument();
  });

  it("surfaces an error state when the detail fetch fails", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.includes("/api/runs/sample-pass-001")
          ? new Response(JSON.stringify({ error: "run not found" }), {
              status: 404,
              statusText: "Not Found",
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// P3 polling contract — useRunStatus drives a 2s interval refetch while
// the run is non-terminal. We mount the page (which uses the hook) and
// observe fetch-call count + banner visibility through real timer advances.
// ---------------------------------------------------------------------------

describe("RunDetailPage — polling contract (useRunStatus integration)", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
  });

  afterEach(() => {
    handle?.reset();
    vi.useRealTimers();
  });

  // Build a non-terminal RunDetailResponse from the existing fixture so the
  // hook decides to poll. Status "running" is non-terminal — TERMINAL_STATUSES
  // = pass | fail | timeout | errored (useRunStatus.ts).
  function nonTerminalDetail() {
    return {
      ...runDetailFixture,
      run: { ...runDetailFixture.run, status: "running" },
    };
  }

  function terminalDetail() {
    return {
      ...runDetailFixture,
      run: { ...runDetailFixture.run, status: "pass" },
    };
  }

  // Drain the pending microtask + state update queue. Fake timers stub
  // setTimeout, so testing-library's `waitFor`/`findBy*` helpers can't poll;
  // we instead advance fake time inside `act()` and read the DOM
  // synchronously. Two zero-advances cover (a) the fetch promise resolving
  // and (b) the resulting setState's effect commit.
  async function flushFetchAndEffects() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it("shows the 'Run in progress…' banner while status is non-terminal", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.includes("/api/runs/sample-pass-001")
          ? new Response(JSON.stringify(nonTerminalDetail()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    mount();

    await flushFetchAndEffects();

    const banner = screen.getByTestId("run-in-progress-banner");
    expect(banner).toHaveTextContent(/Run in progress/i);
  });

  it("hides the polling banner once the run reaches a terminal status", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.includes("/api/runs/sample-pass-001")
          ? new Response(JSON.stringify(terminalDetail()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    mount();

    await flushFetchAndEffects();

    // Status fixture is "pass" → terminal → no polling banner.
    expect(screen.queryByTestId("run-in-progress-banner")).not.toBeInTheDocument();
  });

  it("fires GET /api/runs/<id> every 2s while non-terminal", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.includes("/api/runs/sample-pass-001")
          ? new Response(JSON.stringify(nonTerminalDetail()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    mount();

    // Initial fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const detailCallsAfterInitial = handle.fetchSpy.mock.calls.filter(([u]) =>
      String(u).includes("/api/runs/sample-pass-001"),
    ).length;
    expect(detailCallsAfterInitial).toBe(1);

    // Tick #1 at 2_000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const after1 = handle.fetchSpy.mock.calls.filter(([u]) =>
      String(u).includes("/api/runs/sample-pass-001"),
    ).length;
    expect(after1).toBe(2);

    // Tick #2 at 4_000ms.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const after2 = handle.fetchSpy.mock.calls.filter(([u]) =>
      String(u).includes("/api/runs/sample-pass-001"),
    ).length;
    expect(after2).toBe(3);
  });

  it("stops polling once a terminal status response arrives", async () => {
    // First response: non-terminal. Second response (after 2s): terminal.
    let calls = 0;
    handle = installMockFetch({
      override: (url) => {
        if (!url.includes("/api/runs/sample-pass-001")) return undefined;
        calls += 1;
        const body = calls >= 2 ? terminalDetail() : nonTerminalDetail();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls).toBe(1);

    // First poll tick — fetches the terminal payload, hook flips isPolling.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(calls).toBe(2);

    // After becoming terminal, advancing time another 6s must NOT fire more
    // fetches (interval was cleared via the cleanup of the polling effect).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(calls).toBe(2);

    // Drain one more microtask cycle so the terminal-status setState commits,
    // then assert banner is gone.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByTestId("run-in-progress-banner")).not.toBeInTheDocument();
  });

  it("clears the polling interval on unmount (no fetches after teardown)", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.includes("/api/runs/sample-pass-001")
          ? new Response(JSON.stringify(nonTerminalDetail()), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    const { unmount } = mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const detailCalls = () =>
      handle!.fetchSpy.mock.calls.filter(([u]) =>
        String(u).includes("/api/runs/sample-pass-001"),
      ).length;
    expect(detailCalls()).toBe(1);

    // Tick once to confirm polling is active.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(detailCalls()).toBe(2);

    // Unmount — interval should be cleared. Advancing time further must
    // produce zero new fetches.
    unmount();
    const beforeAdvance = detailCalls();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(detailCalls()).toBe(beforeAdvance);
  });
});
