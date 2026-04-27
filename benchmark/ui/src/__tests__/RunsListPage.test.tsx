import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import RunsListPage from "../routes/RunsListPage";
import { installMockFetch } from "./fixtures/mockFetch";

function mount() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <RunsListPage />
    </MemoryRouter>,
  );
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
