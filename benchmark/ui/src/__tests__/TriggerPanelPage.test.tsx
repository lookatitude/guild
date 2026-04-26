// TriggerPanelPage.test.tsx
//
// P3 button-migration: the P2 disabled-Run-button contract is gone — Run is
// now a live POST /api/runs button. We REMOVED the two disabled-contract
// tests that pinned `disabled`, `aria-disabled="true"`, the P3-deferred
// title, and the no-fetch-on-click invariant. We REPLACE them with the
// enabled-flow assertions: case selection persists, Run is enabled iff a
// case is picked, click POSTs the contract body, navigation happens on 202,
// 409/400/network errors surface their respective `data-testid` panels.
//
// We avoid asserting on the inner navigation route content — instead we
// stub the destination route in a tiny <Routes> tree so navigation can be
// observed by checking which page is rendered. That keeps these tests
// hermetic to the rest of the UI router.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import TriggerPanelPage from "../routes/TriggerPanelPage";
import { installMockFetch } from "./fixtures/mockFetch";

// Sentinel destination route — the page navigates to /runs/<id> on success;
// instead of mounting the real RunDetailPage (and its fetch hooks) we mount
// a probe that exposes the param via data-testid for assertion.
function RunDestinationProbe() {
  const { run_id } = useParams<{ run_id: string }>();
  return <div data-testid="nav-target-run-id">{run_id}</div>;
}

function mount() {
  return render(
    <MemoryRouter initialEntries={["/cases"]}>
      <Routes>
        <Route path="/cases" element={<TriggerPanelPage />} />
        <Route path="/runs/:run_id" element={<RunDestinationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TriggerPanelPage — surface + live Run-button POST flow", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders the case list and selects a case on click", async () => {
    handle = installMockFetch();
    mount();
    const button = await screen.findByRole("button", {
      name: /demo-url-shortener-build/,
    });
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByRole("heading", {
        name: /Build a URL shortener service end-to-end/,
      }),
    ).toBeInTheDocument();
  });

  it("shows the loading state while the cases fetch is in flight", async () => {
    handle = installMockFetch({
      override: () => undefined,
    });
    mount();
    expect(screen.getByText(/Loading cases/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText(/Loading cases/)).not.toBeInTheDocument(),
    );
  });

  // -----------------------------------------------------------------------
  // P3 enabled-flow tests (replaces the P2 disabled-button contract pair).
  // -----------------------------------------------------------------------

  it("Run button is hidden until a case is selected and enabled once one is chosen", async () => {
    handle = installMockFetch();
    mount();
    // Wait for the cases list to render — at this point the right pane shows
    // the "Select a case from the list." empty state, so no Run button is
    // present yet.
    await screen.findByRole("button", { name: /demo-url-shortener-build/ });
    expect(screen.queryByTestId("run-button")).not.toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: /demo-url-shortener-build/ }),
    );

    const runButton = await screen.findByTestId("run-button");
    expect(runButton).toBeEnabled();
    expect(runButton).toHaveTextContent("Run");
    // Sanity: no leftover P2 disabled-contract attributes.
    expect(runButton).not.toHaveAttribute("aria-disabled", "true");
    expect(runButton).not.toHaveAttribute("data-disabled-reason");
  });

  it("clicking Run POSTs /api/runs with the selected case_slug and JSON content-type", async () => {
    handle = installMockFetch();
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    const runButton = await screen.findByTestId("run-button");
    await userEvent.click(runButton);

    await waitFor(() => {
      const post = handle!.fetchSpy.mock.calls.find(([, init]) => {
        const i = init as RequestInit | undefined;
        return i?.method === "POST";
      });
      expect(post).toBeTruthy();
    });

    const postCall = handle.fetchSpy.mock.calls.find(([, init]) => {
      const i = init as RequestInit | undefined;
      return i?.method === "POST";
    })!;
    const [url, init] = postCall as [string, RequestInit];
    expect(url).toMatch(/\/api\/runs$/);
    const headers = init.headers as Record<string, string>;
    // Header keys are case-insensitive at the wire level; postRun uses
    // Content-Type. Pin the value, not the case of the key.
    const contentType =
      headers["Content-Type"] ?? headers["content-type"];
    expect(contentType).toMatch(/application\/json/);
    expect(JSON.parse(init.body as string)).toEqual({
      case_slug: "demo-url-shortener-build",
    });
  });

  it("navigates to /runs/<run_id> after a successful 202 response", async () => {
    handle = installMockFetch();
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    await userEvent.click(await screen.findByTestId("run-button"));

    // Default 202 returns run_id "sample-running-002" (mockFetch.ts).
    const target = await screen.findByTestId("nav-target-run-id");
    expect(target).toHaveTextContent("sample-running-002");
  });

  it("surfaces the 409 'run already in flight' error with a link to the current run", async () => {
    handle = installMockFetch({
      override: (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST" && /\/api\/runs$/.test(url)) {
          return new Response(
            JSON.stringify({
              error: "run already in flight",
              current_run_id: "sample-pass-001",
              started_at: "2026-04-26T05:30:00Z",
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return undefined;
      },
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    await userEvent.click(await screen.findByTestId("run-button"));

    const banner = await screen.findByTestId("run-error-409");
    expect(banner).toHaveTextContent(/run is already in flight/i);
    // The link points at the in-flight run.
    const link = banner.querySelector("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute("href", "/runs/sample-pass-001");
    // Run button is re-enabled (caller can retry once the slot clears).
    expect(screen.getByTestId("run-button")).toBeEnabled();
  });

  it("surfaces the 400 body-validation error and re-enables the Run button", async () => {
    handle = installMockFetch({
      override: (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST" && /\/api\/runs$/.test(url)) {
          return new Response(
            JSON.stringify({ error: "case_slug is required" }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          );
        }
        return undefined;
      },
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    await userEvent.click(await screen.findByTestId("run-button"));

    const banner = await screen.findByTestId("run-error-400");
    expect(banner).toHaveTextContent(/case_slug is required/);
    expect(screen.getByTestId("run-button")).toBeEnabled();
  });

  it("surfaces a network error when fetch throws (couldn't reach server)", async () => {
    handle = installMockFetch({
      override: (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST" && /\/api\/runs$/.test(url)) {
          // Throwing inside the fetch implementation makes the spy reject —
          // matches the real-world TypeError("Failed to fetch") shape that
          // postRun() lets propagate untouched.
          throw new TypeError("Failed to fetch");
        }
        return undefined;
      },
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    await userEvent.click(await screen.findByTestId("run-button"));

    const banner = await screen.findByTestId("run-error-network");
    expect(banner).toHaveTextContent(/Couldn't reach server/i);
    expect(banner).toHaveTextContent(/Failed to fetch/);
    expect(screen.getByTestId("run-button")).toBeEnabled();
  });

  it("clears a prior submit error when the operator picks a different case", async () => {
    let postCount = 0;
    handle = installMockFetch({
      override: (url, init) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (method === "POST" && /\/api\/runs$/.test(url)) {
          postCount += 1;
          if (postCount === 1) {
            return new Response(
              JSON.stringify({ error: "boom", current_run_id: "x" }),
              { status: 409, headers: { "content-type": "application/json" } },
            );
          }
        }
        return undefined;
      },
    });
    mount();
    await userEvent.click(
      await screen.findByRole("button", { name: /demo-url-shortener-build/ }),
    );
    await userEvent.click(await screen.findByTestId("run-button"));
    expect(await screen.findByTestId("run-error-409")).toBeInTheDocument();

    // Pick a DIFFERENT case — the prior 409 banner should disappear because
    // chooseCase() resets submit state to IDLE per TriggerPanelPage.tsx.
    await userEvent.click(
      screen.getByRole("button", { name: /demo-context-drift-evolve/ }),
    );
    expect(screen.queryByTestId("run-error-409")).not.toBeInTheDocument();
  });
});
