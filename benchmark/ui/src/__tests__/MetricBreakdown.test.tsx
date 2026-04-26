import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricBreakdown } from "../components/MetricBreakdown";
import type { Score } from "../../../src/types";
import detailFixture from "./fixtures/run-detail.json";

const SCORE = detailFixture.score as unknown as Score;

describe("MetricBreakdown — loud zeros", () => {
  it("renders the zero-reason chip with the literal reason text", () => {
    render(<MetricBreakdown score={SCORE} />);
    // outcome has raw_subscore: 0, reason: "missing_artifact" in fixture.
    const reasonChips = screen.getAllByLabelText("zero reason");
    expect(reasonChips.length).toBeGreaterThanOrEqual(1);
    expect(reasonChips[0]).toHaveTextContent("missing_artifact");
    expect(reasonChips[0]).toHaveClass("zero-reason");
  });

  it("flips the bar to the .zero class only on zero rows", () => {
    render(<MetricBreakdown score={SCORE} />);
    const allBars = screen
      .getAllByRole("progressbar")
      .map((el) => el as HTMLElement);
    // outcome label first; that one should be .zero. Others should not be.
    const outcomeBar = allBars.find((el) =>
      el.getAttribute("aria-label")?.startsWith("Outcome"),
    );
    const evidenceBar = allBars.find((el) =>
      el.getAttribute("aria-label")?.startsWith("Evidence"),
    );
    expect(outcomeBar).toBeDefined();
    expect(evidenceBar).toBeDefined();
    expect(outcomeBar).toHaveClass("zero");
    expect(evidenceBar).not.toHaveClass("zero");
  });

  it("renders one row per component (six total)", () => {
    render(<MetricBreakdown score={SCORE} />);
    expect(screen.getAllByRole("progressbar")).toHaveLength(6);
  });

  it("formats raw and weighted scores to 2 decimal places", () => {
    render(<MetricBreakdown score={SCORE} />);
    // delegation: raw 80.00 / 100, weighted 16.00.
    expect(screen.getByText("80.00 / 100")).toBeInTheDocument();
    expect(screen.getByText("weighted 16.00")).toBeInTheDocument();
  });
});
