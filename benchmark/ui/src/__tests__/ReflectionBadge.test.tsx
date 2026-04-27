// ReflectionBadge.test.tsx
//
// Component-isolated render tests for `<ReflectionBadge>` (P4 / Q19).
// Complements the wire-through tests in `ComparePage.test.tsx` by pinning
// the kept-vs-discarded branching, the short-ref truncation rule, and the
// discard-reason paragraph in isolation from the page surface.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReflectionApplied } from "../../../src/types";
import { ReflectionBadge } from "../components/ReflectionBadge";

const BASE: ReflectionApplied = {
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

describe("ReflectionBadge — kept branch", () => {
  it("renders the kept badge, plugin-ref-delta with short refs, and suppresses the discard reason", () => {
    render(<ReflectionBadge reflection={BASE} />);

    const badge = screen.getByTestId("reflection-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Reflection applied");

    const kept = screen.getByTestId("keep-discard-badge");
    expect(kept).toHaveAttribute("data-kept", "true");
    expect(kept).toHaveTextContent("kept");

    const cell = screen.getByTestId("plugin-ref-delta");
    // shortRef slices to 7 chars when input length > 8.
    expect(cell).toHaveTextContent("abcdef1");
    expect(cell).toHaveTextContent("0987654");
    expect(cell.textContent).toMatch(/→/);

    // No discard-reason paragraph when kept=true.
    expect(screen.queryByText(/Discarded —/)).toBeNull();
  });
});

describe("ReflectionBadge — discarded branch", () => {
  it("renders the discarded badge plus a discard-reason paragraph naming the worst component + delta", () => {
    const discarded: ReflectionApplied = {
      ...BASE,
      kept: false,
      delta_summary: {
        guild_score_delta: -3.4,
        worst_component_delta: -2.5,
        worst_component: "gates",
      },
    };

    render(<ReflectionBadge reflection={discarded} />);

    const kept = screen.getByTestId("keep-discard-badge");
    expect(kept).toHaveAttribute("data-kept", "false");
    expect(kept).toHaveTextContent("discarded");

    // Discard-reason paragraph fires only on the !kept branch.
    expect(screen.getByText(/Discarded —/)).toBeInTheDocument();
    // Worst-component name appears verbatim inside a <code> tag.
    expect(screen.getByText("gates")).toBeInTheDocument();
    // worst_component_delta rendered with .toFixed(2) — assert the formatted form.
    expect(screen.getByText(/-2\.50 pts/)).toBeInTheDocument();
    // signed() prefixes negative deltas with `-` (no extra `+`).
    expect(screen.getByText(/Δ guild_score -3\.40/)).toBeInTheDocument();
  });
});
