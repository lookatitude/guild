/**
 * __tests__/tier-threading.test.ts
 *
 * G-13 (SC-8, v2-gap-closure) — scored-tier → router threading.
 *
 * Asserts that the tier resolved by the cost auto-scorer (score-tier.ts, ADR §2)
 * is the tier that reaches planTeamRouting / route() — NOT the `mid` default —
 * on BOTH levels:
 *
 *   Part A (API, real shapes): scoreTier() on a fixture lane that scores
 *     powerful → the scored tier is threaded into planTeamRouting via the
 *     specialist's `tier:` field (ARCH-6) and lands in the routing decision.
 *     A control specialist WITHOUT a tier proves the `mid` fallback still
 *     applies only when no scored tier exists.
 *
 *   Part B (real production caller): the full chain the live dispatch path uses —
 *     scoreTier() → writeBackScoredTier() writes `tier:` into team.yaml →
 *     agent-team-launcher.ts parses team.yaml (tier ?? default_tier) → its
 *     cross-host routing block calls planTeamRouting() → onDecision persists
 *     {host, tier, model} into run-state.json keyed by the plan task-id.
 *     The launcher is spawned as a real subprocess (its hooks-heavy import
 *     chain cannot be imported under ts-jest) with --dry-run, and the test
 *     reads the run-state file the production onDecision wrote. If the caller
 *     dropped the scored tier, lanes[task].host.tier would be "mid".
 *
 * No injected seams on the asserted path: the manifest is written by the real
 * write-host-capability builder, team.yaml by the real write-back helper, and
 * Part B exercises the real launcher binary end-to-end.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { scoreTier } from "../score-tier";
import { planTeamRouting, type RoutableHost } from "../lib/host-router";
import { buildCapability, writeHostCapability } from "../write-host-capability";
import { writeBackScoredTier } from "../lib/write-back-scored-tier";

const LAUNCHER = path.resolve(__dirname, "..", "agent-team-launcher.ts");

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS) fs.rmSync(d, { recursive: true, force: true });
});
function mkRepo(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tier-thread-"));
  TEMP_DIRS.push(d);
  fs.mkdirSync(path.join(d, ".guild"), { recursive: true });
  return d;
}

/** Fixture lane signals that deterministically score POWERFUL (ADR §2):
 *  architect verb (+2) + security sensitivity (+1) = 3 ≥ thresholds.powerful (3). */
const POWERFUL_SIGNALS = { workType: "architect" as const, sensitivity: true };

// ─────────────────────────────────────────────────────────────────────────────
// Part A — scored tier reaches planTeamRouting (API level, real manifest shape)
// ─────────────────────────────────────────────────────────────────────────────

describe("G-13 Part A — scoreTier output threads into planTeamRouting (ARCH-6)", () => {
  // Real-shape manifest from the real builder (no hand-tuned fixture).
  const manifest: RoutableHost = buildCapability({
    cwd: mkRepo(),
    env: {},
    probeTmux: () => false,
  });

  test("fixture lane scores powerful (precondition)", () => {
    const scored = scoreTier(POWERFUL_SIGNALS);
    expect(scored.score).toBeGreaterThanOrEqual(3);
    expect(scored.tier).toBe("powerful");
  });

  test("the SCORED tier — not the mid default — reaches the routing decision", () => {
    const scored = scoreTier(POWERFUL_SIGNALS);

    const routes = planTeamRouting(
      [
        // The scored lane: tier comes from the auto-scorer result.
        { name: "sec-arch", scope: "security review", dependsOn: [], tier: scored.tier },
        // Control lane: NO tier → must fall back to the opts default (mid).
        { name: "doc-check", scope: "docs", dependsOn: [] },
      ],
      [manifest],
      { localHostId: manifest.host_id }
    );

    const secArch = routes.find((r) => r.specialist === "sec-arch")!;
    const docCheck = routes.find((r) => r.specialist === "doc-check")!;

    // The scored tier must survive intact into the decision (no silent mid collapse).
    expect(secArch.decision.tier).toBe("powerful");
    expect(secArch.decision.model).toBe("opus");
    // Fallback applies ONLY when no scored tier exists.
    expect(docCheck.decision.tier).toBe("mid");
    expect(docCheck.decision.model).toBe("sonnet");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Part B — the real production caller (agent-team-launcher.ts) threads the
// scored tier from team.yaml into planTeamRouting and persists it in run-state.
// ─────────────────────────────────────────────────────────────────────────────

describe("G-13 Part B — launcher (production caller) threads the scored tier end-to-end", () => {
  test("scored tier written to team.yaml lands in run-state lanes[task].host.tier via planTeamRouting", () => {
    const repo = mkRepo();
    const slug = "tierthread";

    // 1. The plan: maps owners → task-ids (the join the launcher's onDecision uses).
    fs.mkdirSync(path.join(repo, ".guild", "plan"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".guild", "plan", `${slug}.md`),
      [
        "# Plan — tier threading fixture",
        "",
        "## Lane: security architecture",
        "- task-id: T1-route",
        "- owner: sec-arch",
        "",
        "## Lane: docs check",
        "- task-id: T2-check",
        "- owner: doc-check",
        "",
      ].join("\n")
    );

    // 2. The team file (authoring shape — no tier yet), then the PRODUCTION
    //    write-back: score the lane and write `tier:` exactly as execute-plan does.
    fs.mkdirSync(path.join(repo, ".guild", "team"), { recursive: true });
    const teamPath = path.join(repo, ".guild", "team", `${slug}.yaml`);
    fs.writeFileSync(
      teamPath,
      [
        "backend: agent-team",
        "specialists:",
        "  - name: sec-arch",
        "    scope: security review",
        "  - name: doc-check",
        "    scope: docs",
        "",
      ].join("\n")
    );
    const scored = scoreTier(POWERFUL_SIGNALS);
    expect(scored.tier).toBe("powerful"); // fixture precondition
    const wb = writeBackScoredTier(teamPath, "sec-arch", scored.tier);
    expect(wb.ok).toBe(true);

    // 3. A real host-capability manifest from the real writer (fresh ⇒ routable).
    const manifestPath = writeHostCapability({
      cwd: repo,
      host: "claude",
      env: {},
      probeTmux: () => false,
    });
    expect(fs.existsSync(manifestPath)).toBe(true);

    // 4. Run the REAL launcher (dry-run: no tmux spawned; the routing block +
    //    run-state persistence run before any spawn). Cross-host enabled via env
    //    so the planTeamRouting block engages.
    const env = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;
    delete env["TMUX"]; // force new-session mode regardless of the test runner's env
    env["GUILD_HOST_ID"] = "claude";
    env["GUILD_HOST"] = "claude";
    env["GUILD_CROSS_HOST_ENABLED"] = "1";
    env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1";

    const r = spawnSync(
      "npx",
      [
        "tsx",
        LAUNCHER,
        "--team",
        teamPath,
        "--cwd",
        repo,
        "--agent-mode=team",
        "--dry-run",
        "--session-name",
        "guild-tierthread-test",
      ],
      { encoding: "utf8", env }
    );
    if (r.status !== 0) {
      throw new Error(`launcher exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    }

    // 5. Read the run-state the production onDecision wrote. If the launcher
    //    dropped the scored tier, T1-route would carry "mid" here.
    const runsDir = path.join(repo, ".guild", "runs");
    const runDirs = fs
      .readdirSync(runsDir)
      .filter((d) => fs.existsSync(path.join(runsDir, d, "run-state.json")));
    expect(runDirs.length).toBe(1);
    const state = JSON.parse(
      fs.readFileSync(path.join(runsDir, runDirs[0], "run-state.json"), "utf8")
    ) as { lanes: Record<string, { host?: { tier?: string; model?: string; selected?: string } }> };

    // The scored lane routes at its SCORED tier…
    expect(state.lanes["T1-route"]).toBeDefined();
    expect(state.lanes["T1-route"].host?.tier).toBe("powerful");
    expect(state.lanes["T1-route"].host?.model).toBe("opus");
    expect(state.lanes["T1-route"].host?.selected).toBe("claude");
    // …while the unscored control lane falls back to mid (proving no global pin).
    expect(state.lanes["T2-check"]).toBeDefined();
    expect(state.lanes["T2-check"].host?.tier).toBe("mid");
    expect(state.lanes["T2-check"].host?.model).toBe("sonnet");
  });
});
