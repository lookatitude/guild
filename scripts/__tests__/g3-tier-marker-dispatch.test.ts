/**
 * scripts/__tests__/g3-tier-marker-dispatch.test.ts
 *
 * rf-wi-03 (G3) — the PRODUCER half of the tier-env + structured dispatch marker.
 *
 * Red-first proof of two defects:
 *   1. composeInProcessDispatch never sets GUILD_TIER / GUILD_TIER_SCORE on the
 *      lane's own env, so the tier guard can only ever reach `model_present` —
 *      the scored tier is invisible on the dispatch, never `scored_compliant`.
 *   2. No structured producer marker rides EVERY dispatch: only a project
 *      specialist gets a line-1 marker (GUILD_AGENT_DEFINITION), so a shipped
 *      specialist / hand-rolled lane carries nothing machine-detectable that a
 *      producer set, and the backend guard's prompt-only rung stays un-blockable.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  composeInProcessDispatch,
  buildPrompt,
  type Specialist,
  type TeamLaunchRequest,
} from "../lib/team-backend";
import {
  DISPATCH_PRODUCER_ENV,
  DISPATCH_PRODUCER_TOKEN,
} from "../lib/core/contracts/team-backend";

const LAUNCHER = path.resolve(__dirname, "..", "agent-team-launcher.ts");

function req(specialists: Specialist[], overrides: Partial<TeamLaunchRequest> = {}): TeamLaunchRequest {
  return {
    slug: "demo",
    runId: "run-test-g3",
    cwd: "/tmp/repo",
    specialists,
    targetName: "guild-demo",
    mode: "new-session",
    dryRun: false,
    ...overrides,
  };
}

describe("G3 — tier env on every scored dispatch", () => {
  it("sets GUILD_TIER from the specialist's scored tier", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "backend", scope: "api", dependsOn: [], tier: "mid" }]),
    );
    expect(plan[0].env["GUILD_TIER"]).toBe("mid");
  });

  it("falls back to default_tier when no scored tier is present", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "architect", scope: "adr", dependsOn: [], default_tier: "powerful" }]),
    );
    expect(plan[0].env["GUILD_TIER"]).toBe("powerful");
  });

  it("prefers the scored tier over default_tier", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "qa", scope: "tests", dependsOn: [], tier: "cheap", default_tier: "mid" }]),
    );
    expect(plan[0].env["GUILD_TIER"]).toBe("cheap");
  });

  it("sets GUILD_TIER_SCORE when the specialist carries a numeric score", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "backend", scope: "api", dependsOn: [], tier: "mid", score: 2 }]),
    );
    expect(plan[0].env["GUILD_TIER_SCORE"]).toBe("2");
  });

  it("omits GUILD_TIER_SCORE when no score is known (never a fake value)", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "backend", scope: "api", dependsOn: [], tier: "mid" }]),
    );
    expect("GUILD_TIER_SCORE" in plan[0].env).toBe(false);
  });

  it("omits GUILD_TIER when neither tier nor default_tier is present", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "backend", scope: "api", dependsOn: [] }]),
    );
    expect("GUILD_TIER" in plan[0].env).toBe(false);
  });
});

describe("G3 — universal structured producer marker", () => {
  it("stamps the producer marker on EVERY in-process descriptor env", () => {
    const plan = composeInProcessDispatch(
      req([
        { name: "backend", scope: "api", dependsOn: [], tier: "mid" },
        {
          name: "devops",
          scope: "ci",
          dependsOn: [],
          tier: "cheap",
          definition_source: "project",
          definition: ".guild/agents/devops.md",
        },
      ]),
    );
    for (const d of plan) {
      expect(d.env[DISPATCH_PRODUCER_ENV]).toBe(DISPATCH_PRODUCER_TOKEN);
    }
  });

  it("buildPrompt emits a line-1 producer marker for a SHIPPED specialist", () => {
    const prompt = buildPrompt("demo", "run-test-g3", {
      name: "advisor",
      scope: "review",
    });
    const firstLine = prompt.split("\n", 1)[0];
    expect(firstLine.startsWith(`${DISPATCH_PRODUCER_ENV}=${DISPATCH_PRODUCER_TOKEN}`)).toBe(true);
    expect(firstLine).toContain("role=advisor");
  });

  it("keeps the project specialist's GUILD_AGENT_DEFINITION line-1 marker intact", () => {
    const prompt = buildPrompt("demo", "run-test-g3", {
      name: "devops",
      scope: "ci",
      definition_source: "project",
      definition: ".guild/agents/devops.md",
    });
    const firstLine = prompt.split("\n", 1)[0];
    expect(firstLine).toBe("GUILD_AGENT_DEFINITION=.guild/agents/devops.md");
  });
});

describe("G3 — end-to-end: team.yaml tier + score reach the dispatch env", () => {
  it("the launcher's in-process dispatchPlan carries GUILD_TIER + GUILD_TIER_SCORE", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-g3-e2e-"));
    const teamDir = path.join(tmpDir, ".guild", "team");
    fs.mkdirSync(teamDir, { recursive: true });
    const teamPath = path.join(teamDir, "g3-slug.yaml");
    fs.writeFileSync(
      teamPath,
      [
        "spec: .guild/spec/g3-slug.md",
        "backend: subagent",
        "specialists:",
        "  - name: backend",
        '    scope: "api"',
        "    depends-on: []",
        "    tier: mid",
        "    score: 2",
        "",
      ].join("\n"),
    );
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "TMUX") env[k] = v;
    }
    const result = spawnSync(
      "npx",
      [
        "tsx",
        LAUNCHER,
        "--team",
        teamPath,
        "--cwd",
        tmpDir,
        "--agent-mode=agent",
        "--run-id",
        "run-g3-e2e",
        "--dry-run",
      ],
      { encoding: "utf8", env, timeout: 120_000 },
    );
    expect(result.status).toBe(0);
    const signal = JSON.parse(result.stdout) as {
      dispatchPlan?: Array<{ env: Record<string, string> }>;
    };
    const laneEnv = signal.dispatchPlan?.[0]?.env ?? {};
    expect(laneEnv["GUILD_TIER"]).toBe("mid");
    expect(laneEnv["GUILD_TIER_SCORE"]).toBe("2");
    expect(laneEnv[DISPATCH_PRODUCER_ENV]).toBe(DISPATCH_PRODUCER_TOKEN);
  });
});
