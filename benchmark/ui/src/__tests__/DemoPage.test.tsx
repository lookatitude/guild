import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import DemoPage from "../routes/DemoPage";
import { installMockFetch } from "./fixtures/mockFetch";

function mount(caseSlug?: string) {
  const path = caseSlug ? `/demo/${caseSlug}` : "/demo";
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/demo" element={<DemoPage />} />
        <Route path="/demo/:case_slug" element={<DemoPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DemoPage — surface", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders the empty state when no case slug is provided", () => {
    handle = installMockFetch();
    mount();
    expect(screen.getByText(/No case selected/)).toBeInTheDocument();
  });

  it("loads the headline run + score card for a slug", async () => {
    handle = installMockFetch();
    mount("demo-url-shortener-build");
    // Headline run heading from ScoreCard.
    await waitFor(() => {
      expect(screen.getByText(/Headline run/)).toBeInTheDocument();
    });
    // The component breakdown chart heading is rendered.
    expect(
      screen.getByRole("heading", { name: /Component breakdown/i }),
    ).toBeInTheDocument();
    // recharts wraps the chart in a role=img container per DemoPage source.
    expect(screen.getByRole("img", { name: "Demo component chart" })).toBeInTheDocument();
  });

  it("shows an empty state when no runs match the slug", async () => {
    handle = installMockFetch({
      override: (url) =>
        url.match(/\/api\/runs\?case=/)
          ? new Response(JSON.stringify({ runs: [], total: 0 }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          : undefined,
    });
    mount("missing-case");
    await waitFor(() =>
      expect(screen.getByText(/No runs for this case yet/)).toBeInTheDocument(),
    );
  });
});
