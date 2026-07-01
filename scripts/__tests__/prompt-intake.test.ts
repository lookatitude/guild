import {
  classifyPromptIntake,
  classifyWorkflowModality,
  shouldRecommendInitiative,
  validatePromptIntakeV1,
} from "../../src/modules/intake/workflows/prompt-intake";

describe("guild.prompt_intake.v1 ambient routing", () => {
  test("rough product idea routes to ideation when project knowledge is sufficient", () => {
    const result = classifyPromptIntake("I have an idea for a dashboard that helps creators plan launches", {
      hasProjectKnowledge: true,
    });
    expect(result.target_phase).toBe("ideate");
    expect(result.intent).toBe("product_idea");
    expect(result.proposed_next_action).toBe("run_ideation");
    expect(validatePromptIntakeV1(result).valid).toBe(true);
  });

  test("empty project with weak context routes to init interview", () => {
    const result = classifyPromptIntake("Add a customer dashboard", { emptyProject: true });
    expect(result.target_phase).toBe("init");
    expect(result.project_knowledge).toBe("empty_project");
    expect(result.proposed_next_action).toBe("ask_init_questions");
    expect(result.missing_info).toContain("project purpose, users, constraints, and initial success criteria");
  });

  test("existing project without learned context routes to brownfield learn", () => {
    const result = classifyPromptIntake("Implement invoice export", { existingProject: true });
    expect(result.target_phase).toBe("init");
    expect(result.project_knowledge).toBe("existing_project_needs_learn");
    expect(result.proposed_next_action).toBe("run_brownfield_learn");
  });

  test("workspace prompt routes to federation learn when workspace knowledge is missing", () => {
    const result = classifyPromptIntake("Build the docs sync flow across plugin and website", {
      workspace: true,
      hasProjectKnowledge: false,
    });
    expect(result.target_phase).toBe("init");
    expect(result.project_knowledge).toBe("workspace_needs_federation");
    expect(result.proposed_next_action).toBe("run_workspace_federation_learn");
  });

  test("clear feature with requirements routes to planning", () => {
    const result = classifyPromptIntake(
      "Add the export feature. Requirements: users can export CSV and tests verify permissions.",
      { hasProjectKnowledge: true },
    );
    expect(result.target_phase).toBe("plan");
    expect(result.feature_maturity).toBe("goals_needed");
    expect(result.proposed_next_action).toBe("draft_goals_and_plan_for_approval");
  });

  test("implementation request with approved plan routes to build but still asks for approval", () => {
    const result = classifyPromptIntake("Implement the approved CSV export plan", {
      hasProjectKnowledge: true,
      hasPlan: true,
    });
    expect(result.target_phase).toBe("build");
    expect(result.feature_maturity).toBe("implementation_ready");
    expect(result.proposed_next_action).toBe("ask_plan_approval_before_build");
  });

  test("QA and ops prompts route directly to their phases", () => {
    expect(classifyPromptIntake("Run browser QA for the release", { hasDevelopmentOutput: true }).target_phase).toBe("qa");
    expect(classifyPromptIntake("Deploy the release and monitor rollback risk", { hasDevelopmentOutput: true }).target_phase).toBe("ops");
  });

  test("unrelated prompt stays out of Guild lifecycle", () => {
    const result = classifyPromptIntake("What time is it?");
    expect(result.target_phase).toBe("none");
    expect(result.proposed_next_action).toBe("continue_normal_host_handling");
  });
});

describe("modality and initiative classifiers", () => {
  test.each([
    ["Run browser QA for the React dashboard", "web"],
    ["Build the Expo iOS app screen", "mobile"],
    ["Package the Electron desktop installer", "desktop_installable"],
    ["Add a backend API endpoint", "backend_service"],
    ["Create the CLI command", "cli_library"],
    ["Update the MDX docs guide", "docs_content"],
    ["Deploy with rollback monitoring", "infra_devops"],
  ])("classifies %s", (prompt, modality) => {
    expect(classifyWorkflowModality(prompt)).toBe(modality);
  });

  test("broad initiative triggers match the lifecycle plan", () => {
    expect(shouldRecommendInitiative({ projectCount: 2 })).toBe(true);
    expect(shouldRecommendInitiative({ goalCount: 2 })).toBe(true);
    expect(shouldRecommendInitiative({ taskCount: 7 })).toBe(true);
    expect(shouldRecommendInitiative({ expectedMultiSession: true })).toBe(true);
    expect(shouldRecommendInitiative({ projectCount: 1, goalCount: 1, taskCount: 4 })).toBe(false);
  });
});
