import * as fs from "node:fs";
import * as path from "node:path";
import { buildPrompt as teamBackendBuildPrompt } from "../lib/team-backend";
import { buildPrompt as tmuxBackendBuildPrompt } from "../lib/host/tmux-backend";
import { buildPrompt as moduleBuildPrompt } from "../../src/modules/prompting/workflows/team-prompt";

describe("team prompt module compatibility", () => {
  test("legacy backend paths re-export the src/modules/prompting renderer", () => {
    expect(teamBackendBuildPrompt).toBe(moduleBuildPrompt);
    expect(tmuxBackendBuildPrompt).toBe(moduleBuildPrompt);
  });

  test("uses the canonical Team Lead and teammate prompt wording", () => {
    const orchestrator = teamBackendBuildPrompt("demo", "run-001", null, ".guild/team/demo.build.yaml");
    expect(orchestrator).toContain("You are the Team Lead for team `demo`, run-id `run-001`.");
    expect(orchestrator).not.toContain("Guild orchestrator");
    expect(orchestrator).toContain("the team at `.guild/team/demo.build.yaml`");
    expect(orchestrator).toContain("guild:review → guild:verify-done → guild:reflect");
    expect(orchestrator).toContain("guild:context-assemble");

    const teammate = teamBackendBuildPrompt("demo", "run-001", {
      name: "backend",
      scope: "api",
      dependsOn: [],
    });
    expect(teammate).toContain("You are the `backend` teammate for run-id `run-001`.");
    expect(teammate).toContain("Read the exact `context_bundle_id` named by your assignment —");
    expect(teammate).toContain("auto-memory (§9.1)");
    expect(teammate).toContain("§8.2 handoff receipt");
    expect(teammate).toContain("assignment's exact `channels.handoff_path`");
    // task-cell-runtime D5: the read-ack gate — read + validate the assignment and
    // acknowledge it BEFORE working; `running` is reachable only after the ack.
    expect(teammate).toContain("$GUILD_TASK_ASSIGNMENT");
    expect(teammate).toContain("assignment-ack.json");
    expect(teammate).toContain("acknowledged (D5)");
  });

  test("only the prompting module defines buildPrompt", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const tmuxBackend = fs.readFileSync(path.join(repoRoot, "scripts/lib/host/tmux-backend.ts"), "utf8");
    const moduleFile = fs.readFileSync(path.join(repoRoot, "src/modules/prompting/workflows/team-prompt.ts"), "utf8");

    expect(tmuxBackend).toMatch(/src\/modules\/prompting\/workflows\/team-prompt/);
    expect(tmuxBackend).not.toMatch(/export\s+function\s+buildPrompt/);
    expect(moduleFile).toMatch(/export\s+function\s+buildPrompt/);
    expect(moduleFile).toMatch(/from\s+["']\.\.\/\.\.\/host-runtime["']/);
    expect(moduleFile).not.toMatch(/host-runtime\/workflows\/host-registry/);
  });
});
