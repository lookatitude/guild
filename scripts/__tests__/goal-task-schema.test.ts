import {
  GOAL_V1_EXAMPLE,
  TASK_GROUP_V1_EXAMPLE,
  selectGoalSurface,
  validateGoalV1,
  validateTaskGroupV1,
} from "../../src/modules/evals/workflows/goal-task-schema";

describe("guild.goal.v1", () => {
  test("accepts the P.O.V.E.R. goal example", () => {
    expect(validateGoalV1(GOAL_V1_EXAMPLE).valid).toBe(true);
  });

  test("fails closed when a P.O.V.E.R. field is missing", () => {
    const invalid = { ...GOAL_V1_EXAMPLE, risks: [] };
    const result = validateGoalV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/risks/);
  });
});

describe("guild.task_group.v1", () => {
  test("accepts the fallback task group example", () => {
    expect(validateTaskGroupV1(TASK_GROUP_V1_EXAMPLE).valid).toBe(true);
  });

  test("rejects duplicate task ids and unknown dependencies", () => {
    const invalid = {
      ...TASK_GROUP_V1_EXAMPLE,
      tasks: [
        ...TASK_GROUP_V1_EXAMPLE.tasks,
        {
          id: "T-1",
          title: "Duplicate",
          depends_on: ["missing"],
          validation: ["fails"],
          owner: "qa",
        },
      ],
    };
    const result = validateTaskGroupV1(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/duplicate/);
    expect(result.errors.join("\n")).toMatch(/unknown task/);
  });
});

describe("goal surface selection", () => {
  test("uses native /goal when supported, Guild goal otherwise, and task group on forced fallback", () => {
    expect(selectGoalSurface({ hostSupportsGoalCommand: true })).toBe("host_goal");
    expect(selectGoalSurface({ hostSupportsGoalCommand: false })).toBe("guild_goal");
    expect(selectGoalSurface({ hostSupportsGoalCommand: true, forceTaskGroupFallback: true })).toBe("task_group");
  });
});
