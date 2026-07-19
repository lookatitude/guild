import * as buildVerify from "../build-verify";

describe("build:verify step labels", () => {
  const formatStepLabel = (buildVerify as {
    formatStepLabel?: (step: { name: string; stage?: string }, index: number, total: number) => string;
  }).formatStepLabel;

  it("includes the ADR stage token when the step has one", () => {
    expect(formatStepLabel).toEqual(expect.any(Function));
    expect(formatStepLabel!({ name: "full share-dot-guild audit", stage: "6b" }, 8, 9)).toBe(
      "[build:verify] step 8/9 (stage 6b) — full share-dot-guild audit",
    );
  });

  it("omits the stage decoration cleanly when the step has no stage", () => {
    expect(formatStepLabel).toEqual(expect.any(Function));
    const label = formatStepLabel!({ name: "unlabelled extension" }, 10, 10);
    expect(label).toBe("[build:verify] step 10/10 — unlabelled extension");
    expect(label).not.toMatch(/\(\s*\)|stage\s*\)/);
  });

  // Anti-drift: the formatter only helps if the REAL chain actually carries stages. A step
  // added later without one would otherwise silently reintroduce the bare `step N/9` label
  // the ADR mismatch came from.
  it("labels every step in the real chain with an ADR §8 stage", () => {
    const steps = buildVerify.buildChain();
    expect(steps.length).toBeGreaterThan(0);
    const unlabelled = steps.filter((s) => !s.stage).map((s) => s.name);
    expect(unlabelled).toEqual([]);
    // Stages are ADR §8 step numbers, optionally sub-lettered (e.g. `6b`).
    for (const s of steps) expect(s.stage).toMatch(/^[1-9][0-9]*[a-z]?$/);
  });

  // The fail-fast summary is the line an operator reads when the chain breaks, so it needs
  // the stage label at least as much as the progress line does. It renders through its own
  // template, so it needs its own coverage — the progress-label tests above do not reach it.
  it("labels the fail-fast summary with the ADR stage too", () => {
    const step = { name: "full share-dot-guild audit", stage: "6b" };
    expect(buildVerify.formatFailureSummary(step, 8, 9, 1)).toBe(
      "[build:verify] FAILED at step 8/9 (stage 6b) — full share-dot-guild audit (exit 1)."
    );
  });

  it("degrades the fail-fast summary cleanly for a step with no stage", () => {
    const label = buildVerify.formatFailureSummary({ name: "unlabelled extension" }, 10, 10, 2);
    expect(label).toBe("[build:verify] FAILED at step 10/10 — unlabelled extension (exit 2).");
    expect(label).not.toMatch(/\(\s*\)|stage\s*\)/);
  });
});
