/**
 * hooks/lib/__tests__/lane-attribution.test.ts
 *
 * oir-wi-57 round-5 fix: `isWorkerInvocation` / `resolveLaneAttribution`
 * replace the ad-hoc `GUILD_LANE_ID ?? GUILD_TASK_ID` pattern that was
 * broken for a present-but-blank or present-but-unsafe `GUILD_LANE_ID` —
 * `??` only falls through on null/undefined, never on those cases, so it
 * would silently mask a perfectly valid `GUILD_TASK_ID` sitting right next
 * to it and misclassify a real worker invocation as the lead's own.
 */

import { isWorkerInvocation, resolveLaneAttribution, UNATTRIBUTED_WORKER_LANE_ID } from "../lane-attribution";

describe("lane-attribution — isWorkerInvocation", () => {
  it("is false when neither var is set", () => {
    expect(isWorkerInvocation({})).toBe(false);
  });

  it("is true when GUILD_LANE_ID is a non-empty string", () => {
    expect(isWorkerInvocation({ GUILD_LANE_ID: "T1-backend" })).toBe(true);
  });

  it("is true when GUILD_TASK_ID is a non-empty string", () => {
    expect(isWorkerInvocation({ GUILD_TASK_ID: "T1-backend" })).toBe(true);
  });

  it("is false when GUILD_LANE_ID is present but EMPTY (not just absent)", () => {
    expect(isWorkerInvocation({ GUILD_LANE_ID: "" })).toBe(false);
  });

  it("is true when GUILD_LANE_ID is empty but GUILD_TASK_ID is non-empty", () => {
    // The bug this module fixes: a bare `GUILD_LANE_ID ?? GUILD_TASK_ID`
    // would have been fine here too (`""` is not nullish... wait, actually
    // this exact case is where `??` ALSO fails: `"" ?? "T1"` is `""`, not
    // `"T1"`, since `??` only falls through on null/undefined). Presence
    // detection must look at BOTH vars independently.
    expect(isWorkerInvocation({ GUILD_LANE_ID: "", GUILD_TASK_ID: "T1-backend" })).toBe(true);
  });
});

describe("lane-attribution — resolveLaneAttribution", () => {
  it("returns undefined when neither var is set (the lead's own session)", () => {
    expect(resolveLaneAttribution({})).toBeUndefined();
  });

  it("prefers a valid GUILD_LANE_ID over GUILD_TASK_ID", () => {
    expect(resolveLaneAttribution({ GUILD_LANE_ID: "T1-lane", GUILD_TASK_ID: "T2-task" })).toBe("T1-lane");
  });

  it("falls back to GUILD_TASK_ID when GUILD_LANE_ID is absent", () => {
    expect(resolveLaneAttribution({ GUILD_TASK_ID: "T2-task" })).toBe("T2-task");
  });

  it("REGRESSION: falls back to GUILD_TASK_ID when GUILD_LANE_ID is present but EMPTY", () => {
    // The exact bug a bare `??` had: `"" ?? "T2-task"` evaluates to `""`,
    // not `"T2-task"`, because `??` only falls through on null/undefined.
    expect(resolveLaneAttribution({ GUILD_LANE_ID: "", GUILD_TASK_ID: "T2-task" })).toBe("T2-task");
  });

  it("REGRESSION: falls back to GUILD_TASK_ID when GUILD_LANE_ID is present but UNSAFE", () => {
    expect(resolveLaneAttribution({ GUILD_LANE_ID: "bad lane id\nwith newline", GUILD_TASK_ID: "T2-task" })).toBe(
      "T2-task",
    );
  });

  it("never returns an unsafe value even when it is the only candidate", () => {
    expect(resolveLaneAttribution({ GUILD_LANE_ID: "bad;id" })).not.toBe("bad;id");
  });

  it("falls back to the fixed sentinel when a worker is identified but neither candidate is safe (never lane-less)", () => {
    const result = resolveLaneAttribution({ GUILD_LANE_ID: "bad;id", GUILD_TASK_ID: "also bad\nid" });
    expect(result).toBe(UNATTRIBUTED_WORKER_LANE_ID);
    expect(result).not.toBeUndefined(); // an identified worker must never be lane-less
  });

  it("returns undefined (not the sentinel) when both vars are simply absent — genuinely the lead", () => {
    expect(resolveLaneAttribution({})).toBeUndefined();
  });
});
