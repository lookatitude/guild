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
// The REAL resolver behind the PreToolUse #58 guard — imported so the
// composer-accepted ⇒ guard-accepted property is asserted end to end rather
// than inferred from the descriptor's shape (rf-wi-06, review round 4).
import {
  dispatchViolations,
  resolveDispatchAttribution,
} from "../../hooks/lib/dispatch-attribution";

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

  it("emits a REAL score of 0 (a cheap lane's score is a legitimate value)", () => {
    const plan = composeInProcessDispatch(
      req([{ name: "reader", scope: "read", dependsOn: [], tier: "cheap", score: 0 }]),
    );
    expect(plan[0].env["GUILD_TIER_SCORE"]).toBe("0");
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

  // rf-wi-06 (issue #91), adversarial review rounds 3-4. `composeInProcessDispatch`
  // validates the definition path TRIMMED, so a padded-but-canonical value is
  // ACCEPTED — but it used to hand the RAW spec to `buildPrompt`, which
  // interpolates `definition` verbatim. The result was a dispatch the composer
  // accepted and the production PreToolUse guard DENIED: the env carrier
  // canonical, the line-1 marker padded, and a padded marker fails the
  // whole-line parse (`hasAdoptionPrompt: false` → `missing_adoption_prompt`).
  // The composer now normalizes ONCE and feeds the normalized spec to
  // `buildPrompt`, so both carriers agree by construction.
  it("normalizes a padded-but-canonical definition path so BOTH carriers are canonical", () => {
    const padded = "  .guild/agents/devops.md  ";
    const canonical = ".guild/agents/devops.md";
    const plan = composeInProcessDispatch(
      req([
        {
          name: "devops",
          scope: "ci",
          dependsOn: [],
          definition_source: "project",
          definition: padded,
        },
      ]),
    );
    expect(plan[0].env["GUILD_AGENT_DEFINITION"]).toBe(canonical);
    expect(plan[0].definitionPath).toBe(canonical);
    // The PROMPT carrier is canonical too — no padding survives into line 1.
    expect(plan[0].prompt.split("\n", 1)[0]).toBe(`GUILD_AGENT_DEFINITION=${canonical}`);
  });

  it("buildPrompt normalizes a padded definition for EVERY producer, not just in-process", () => {
    // Review round 5: the fix originally lived in `composeInProcessDispatch`,
    // leaving the PRIMARY tmux producer (and remote) still feeding the raw spec
    // to `buildPrompt`. A quoted YAML value legitimately keeps its inner
    // whitespace, so those backends could emit a padded — and therefore
    // unparseable — line-1 marker. Normalizing inside `buildPrompt` covers the
    // one choke point all backends share; assert it there.
    const prompt = buildPrompt("demo", "run-test-g3", {
      name: "devops",
      scope: "ci",
      definition_source: "project",
      definition: "  .guild/agents/devops.md  ",
    });
    expect(prompt.split("\n", 1)[0]).toBe("GUILD_AGENT_DEFINITION=.guild/agents/devops.md");
    // …and the human-readable adoption instruction quotes the canonical path too.
    expect(prompt).toContain("Your role definition is at `.guild/agents/devops.md`");
    expect(prompt).not.toContain("`  .guild/agents/devops.md  `");
  });

  it("the padded-path descriptor the composer accepts is one the #58 guard also accepts", () => {
    // The end-to-end property the previous test's parts add up to: run the
    // composed descriptor through the REAL resolver the PreToolUse guard uses.
    // Composer-accepted must imply guard-accepted, or the universal-marker
    // premise is false for the in-process emitter.
    const plan = composeInProcessDispatch(
      req([
        {
          name: "devops",
          scope: "ci",
          dependsOn: [],
          definition_source: "project",
          definition: "  .guild/agents/devops.md  ",
        },
      ]),
    );
    const attr = resolveDispatchAttribution({
      subagent_type: plan[0].subagentType,
      prompt: plan[0].prompt,
      env: plan[0].env,
    });
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.specialist).toBe("devops");
    expect(dispatchViolations(attr!)).toEqual([]);
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
