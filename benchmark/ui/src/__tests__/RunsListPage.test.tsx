import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import RunsListPage from "../routes/RunsListPage";
import { installMockFetch } from "./fixtures/mockFetch";

function mount(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <RunsListPage />
    </MemoryRouter>,
  );
}

// F4 (v1.3) — fixture set used by the ?auth= filter tests. Three runs with
// distinct 7-char auth_identity_hash prefixes; one absent prefix to confirm
// the (r.auth_identity_hash ?? "").startsWith(...) coalesce works. Full
// hashes are 64-char SHA-256 hex; the filter only matches against the
// 7-char prefix from the existing badge contract.
const AUTH_FIXTURE_RUNS = {
  runs: [
    {
      run_id: "run-with-abc-prefix",
      case_slug: "demo-url-shortener-build",
      plugin_ref: "abcdef1",
      status: "pass",
      guild_score: 90,
      started_at: "2026-04-26T05:30:00Z",
      auth_identity_hash:
        "abc1234deadbeefcafebabe0011223344556677889900aabbccddeeff00112233",
    },
    {
      run_id: "run-with-def-prefix",
      case_slug: "demo-url-shortener-build",
      plugin_ref: "abcdef1",
      status: "fail",
      guild_score: 40,
      started_at: "2026-04-26T05:31:00Z",
      auth_identity_hash:
        "def567812345678012345678901234567890abcdef1234567890abcdef123456",
    },
    {
      run_id: "run-without-hash",
      case_slug: "demo-url-shortener-build",
      plugin_ref: "abcdef1",
      status: "errored",
      guild_score: 0,
      started_at: "2026-04-26T05:32:00Z",
      // auth_identity_hash intentionally omitted — exercises the
      // `r.auth_identity_hash ?? ""` coalesce path.
    },
  ],
  total: 3,
};

function authFixtureResponse(): Response {
  return new Response(JSON.stringify(AUTH_FIXTURE_RUNS), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("RunsListPage — surface", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders the runs table with one row per fixture run", async () => {
    handle = installMockFetch();
    mount();
    expect(await screen.findByRole("heading", { name: "Runs" })).toBeInTheDocument();
    // Wait for the success state.
    await waitFor(() => {
      expect(screen.getByText(/Showing 4 runs/)).toBeInTheDocument();
    });
    // Each fixture run id appears as a link to /runs/<id>.
    expect(screen.getByText("demo-url-shortener-build-abcdef1-h0001-1")).toBeInTheDocument();
    expect(screen.getByText("sample-pass-001")).toBeInTheDocument();
    // Status pills cover all four RunStatus values.
    expect(screen.getByLabelText("status: pass")).toBeInTheDocument();
    expect(screen.getByLabelText("status: fail")).toBeInTheDocument();
    expect(screen.getByLabelText("status: timeout")).toBeInTheDocument();
    expect(screen.getByLabelText("status: errored")).toBeInTheDocument();
  });

  it("renders the empty state when no runs are returned", async () => {
    handle = installMockFetch({
      override: () =>
        new Response(JSON.stringify({ runs: [], total: 0 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    mount();
    expect(await screen.findByText(/No runs found/)).toBeInTheDocument();
  });

  it("renders an error banner when the fetch fails", async () => {
    handle = installMockFetch({
      override: () =>
        new Response(JSON.stringify({ error: "broken" }), {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "application/json" },
        }),
    });
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  it("toggles sort direction when a column header is clicked", async () => {
    handle = installMockFetch();
    mount();
    await waitFor(() => expect(screen.getByText(/Showing 4 runs/)).toBeInTheDocument());
    const startedHeader = screen
      .getAllByRole("columnheader")
      .find((th) => th.getAttribute("aria-sort") === "descending");
    expect(startedHeader).toBeDefined();
    const startedButton = startedHeader!.querySelector("button")!;
    await userEvent.click(startedButton);
    expect(startedHeader).toHaveAttribute("aria-sort", "ascending");
  });
});

// ---------------------------------------------------------------------------
// F4 (v1.3) — ?auth=<7-char-prefix> URL filter. Display-only, client-side,
// no aggregation, no <input>. Filter is applied to data.runs after useFetch
// returns and before sortRows. Backwards-compatible: missing/empty ?auth=
// shows all runs.
// ---------------------------------------------------------------------------

describe("RunsListPage — ?auth= URL filter (F4 v1.3)", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("filter-off: mount at /runs renders all rows (backwards-compatible)", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.match(/\/api\/runs(\?|$)/) ? authFixtureResponse() : undefined,
    });
    mount("/runs");
    await waitFor(() => {
      expect(screen.getByText(/Showing 3 runs/)).toBeInTheDocument();
    });
    // All three rows visible.
    expect(screen.getByText("run-with-abc-prefix")).toBeInTheDocument();
    expect(screen.getByText("run-with-def-prefix")).toBeInTheDocument();
    expect(screen.getByText("run-without-hash")).toBeInTheDocument();
    // No filter indicator when ?auth= absent.
    expect(screen.queryByTestId("runs-filter-indicator")).toBeNull();
  });

  it("filter-on (matching): /runs?auth=abc1234 narrows to the matching row", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.match(/\/api\/runs(\?|$)/) ? authFixtureResponse() : undefined,
    });
    mount("/runs?auth=abc1234");
    // Indicator appears once data resolves.
    const indicator = await screen.findByTestId("runs-filter-indicator");
    expect(indicator).toHaveTextContent(/Showing 1 of 3 runs/);
    expect(indicator).toHaveTextContent(/filtered by auth=/);
    expect(indicator).toHaveTextContent("abc1234");
    // Clear-filter link present.
    const clearLink = indicator.querySelector("a[href='/runs']");
    expect(clearLink).not.toBeNull();
    expect(clearLink).toHaveTextContent(/clear/i);
    // Only the matching row is rendered.
    expect(screen.getByText("run-with-abc-prefix")).toBeInTheDocument();
    expect(screen.queryByText("run-with-def-prefix")).toBeNull();
    expect(screen.queryByText("run-without-hash")).toBeNull();
  });

  it("filter-on (no matches): /runs?auth=zzzzzzz shows the empty-state-with-filter", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.match(/\/api\/runs(\?|$)/) ? authFixtureResponse() : undefined,
    });
    mount("/runs?auth=zzzzzzz");
    // Indicator shows "0 of 3".
    const indicator = await screen.findByTestId("runs-filter-indicator");
    expect(indicator).toHaveTextContent(/Showing 0 of 3 runs/);
    expect(indicator).toHaveTextContent("zzzzzzz");
    // Distinct empty-state message references the filter prefix and a
    // clear-filter link, not the global "No runs found" copy.
    expect(screen.getByText(/No runs match auth=/)).toBeInTheDocument();
    expect(screen.queryByText(/No runs found/)).toBeNull();
    // Clear-filter link present in the empty-state body.
    const clearLinks = screen.getAllByRole("link", { name: /clear/i });
    expect(clearLinks.length).toBeGreaterThanOrEqual(1);
    clearLinks.forEach((a) => expect(a).toHaveAttribute("href", "/runs"));
    // No table rows rendered.
    expect(screen.queryByText("run-with-abc-prefix")).toBeNull();
    expect(screen.queryByText("run-with-def-prefix")).toBeNull();
    expect(screen.queryByText("run-without-hash")).toBeNull();
  });
});
