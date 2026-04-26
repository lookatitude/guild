import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { Comparison, ReflectionApplied } from "../../../src/types";
import ComparePage from "../routes/ComparePage";
import comparisonFixture from "./fixtures/comparison.json";
import { installMockFetch } from "./fixtures/mockFetch";

function mount(initialEntries: string[] = ["/compare"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ComparePage />
    </MemoryRouter>,
  );
}

describe("ComparePage — surface", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("renders empty state when baseline + candidate are not in the URL", () => {
    handle = installMockFetch();
    mount();
    expect(
      screen.getByText(/Enter a baseline and candidate set id/),
    ).toBeInTheDocument();
  });

  it("renders the comparison summary and excluded runs when both ids are present", async () => {
    handle = installMockFetch();
    mount(["/compare?baseline=set-a&candidate=set-b"]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    });
    // Mean scores from the comparison fixture (baseline mean is unique).
    expect(screen.getByText("67.13")).toBeInTheDocument();
    // Candidate mean shows up as "100.00" — but so do DeltaTable cells; assert
    // at least one match instead of pinning to the summary cell exclusively.
    expect(screen.getAllByText("100.00").length).toBeGreaterThan(0);
    // Status from the fixture.
    expect(screen.getByText("partial")).toBeInTheDocument();
    // Excluded runs section appears since fixture has one.
    expect(
      screen.getByRole("heading", { name: "Excluded runs" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/model_ref drift/)).toBeInTheDocument();
  });

  it("writes baseline + candidate into the URL search params on input", async () => {
    handle = installMockFetch();
    mount();
    const baselineInput = screen.getByLabelText(/Baseline set id/i);
    await userEvent.type(baselineInput, "set-a");
    expect((baselineInput as HTMLInputElement).value).toBe("set-a");
  });
});

// --- P4 reflection_applied annotation (Q19, T4-qa) -------------------------
//
// These tests pin the wire from `Comparison.reflection_applied` (P4 schema
// bump) through `ComparePage` into `<ReflectionBadge>`. The default fixture
// (`fixtures/comparison.json`) intentionally omits the field — that's the
// legacy/no-loop shape (Q19 backward-compat). For the kept/discarded cases
// we override the mock to inject a reflection_applied block.

function buildComparisonWithReflection(
  reflection: ReflectionApplied,
): Comparison {
  // Spread off the existing fixture so we keep the rest of the shape stable
  // and only swap `reflection_applied` in. Cast through Comparison since the
  // fixture is JSON-typed.
  return {
    ...(comparisonFixture as unknown as Comparison),
    reflection_applied: reflection,
  };
}

const KEPT_REFLECTION: ReflectionApplied = {
  proposal_id: "ref-2026-04-26-architect",
  source_path: "agents/architect.md",
  applied_at: "2026-04-26T17:00:00Z",
  plugin_ref_before: "abcdef1234567890",
  plugin_ref_after: "0987654321fedcba",
  kept: true,
  delta_summary: {
    guild_score_delta: 5.2,
    worst_component_delta: -0.5,
    worst_component: "delegation",
  },
};

const DISCARDED_REFLECTION: ReflectionApplied = {
  ...KEPT_REFLECTION,
  proposal_id: "ref-2026-04-26-discarded",
  kept: false,
  delta_summary: {
    guild_score_delta: -3.4,
    worst_component_delta: -2.5,
    worst_component: "gates",
  },
};

describe("ComparePage — reflection_applied annotation (P4 / Q19)", () => {
  let handle: ReturnType<typeof installMockFetch> | undefined;

  afterEach(() => {
    handle?.reset();
  });

  it("does NOT render <ReflectionBadge> when comparison.reflection_applied is absent (legacy shape, Q19 backward-compat)", async () => {
    handle = installMockFetch();
    mount(["/compare?baseline=set-a&candidate=set-b"]);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    });
    // No reflection field on the default fixture → no badge.
    expect(screen.queryByTestId("reflection-badge")).toBeNull();
    expect(screen.queryByTestId("keep-discard-badge")).toBeNull();
    expect(screen.queryByTestId("plugin-ref-delta")).toBeNull();
  });

  it("renders <ReflectionBadge> with kept=true when reflection_applied.kept is true", async () => {
    handle = installMockFetch({
      override: (url) => {
        if (url.match(/\/api\/comparisons\//)) {
          return new Response(
            JSON.stringify(buildComparisonWithReflection(KEPT_REFLECTION)),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return undefined;
      },
    });
    mount(["/compare?baseline=set-a&candidate=set-b"]);

    await waitFor(() => {
      expect(screen.getByTestId("reflection-badge")).toBeInTheDocument();
    });
    const kept = screen.getByTestId("keep-discard-badge");
    expect(kept).toHaveAttribute("data-kept", "true");
    expect(kept).toHaveTextContent("kept");
    // Discard reason paragraph is suppressed when kept=true.
    expect(screen.queryByText(/Discarded —/)).toBeNull();
  });

  it("renders <ReflectionBadge> with kept=false + discard reason when reflection_applied.kept is false", async () => {
    handle = installMockFetch({
      override: (url) => {
        if (url.match(/\/api\/comparisons\//)) {
          return new Response(
            JSON.stringify(buildComparisonWithReflection(DISCARDED_REFLECTION)),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return undefined;
      },
    });
    mount(["/compare?baseline=set-a&candidate=set-b"]);

    await waitFor(() => {
      expect(screen.getByTestId("reflection-badge")).toBeInTheDocument();
    });
    const kept = screen.getByTestId("keep-discard-badge");
    expect(kept).toHaveAttribute("data-kept", "false");
    expect(kept).toHaveTextContent("discarded");
    // Discard reason paragraph names the worst component. The badge's
    // <p class="reflection-discard-reason"> wraps the worst_component name
    // in a <code> tag — scope the assertion to the badge so we don't match
    // the per-component delta table's "gates" row.
    const badge = screen.getByTestId("reflection-badge");
    expect(badge).toHaveTextContent(/Discarded —/);
    expect(badge).toHaveTextContent(/gates/);
  });

  it("plugin-ref-delta cell renders both 7-char short refs separated by an arrow", async () => {
    handle = installMockFetch({
      override: (url) => {
        if (url.match(/\/api\/comparisons\//)) {
          return new Response(
            JSON.stringify(buildComparisonWithReflection(KEPT_REFLECTION)),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return undefined;
      },
    });
    mount(["/compare?baseline=set-a&candidate=set-b"]);

    await waitFor(() => {
      expect(screen.getByTestId("plugin-ref-delta")).toBeInTheDocument();
    });
    const cell = screen.getByTestId("plugin-ref-delta");
    // ReflectionBadge's `shortRef` slices to 7 chars when length > 8.
    expect(cell).toHaveTextContent("abcdef1");
    expect(cell).toHaveTextContent("0987654");
    // The `→` glyph is wrapped in aria-hidden but should be in the DOM text.
    expect(cell.textContent).toMatch(/→/);
  });
});
