import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as routerShim from "./capability/router";
import * as rankShim from "./capability/rank";
import * as tiebreakShim from "./capability/tiebreak";
import * as tierShim from "./capability/tier-defaults";
import * as routerModule from "../../src/domains/config/index";
import * as rankModule from "../../src/domains/config/index";
import * as tiebreakModule from "../../src/domains/config/index";
import * as tierModule from "../../src/domains/config/index";

describe("capability routing compatibility shims", () => {
  test("scripts/lib/capability re-exports src/modules/capability implementations", () => {
    expect(routerShim.route).toBe(routerModule.route);
    expect(routerShim.resolveModel).toBe(routerModule.resolveModel);
    expect(routerShim.resolveModelParams).toBe(routerModule.resolveModelParams);
    expect(routerShim.planTeamRouting).toBe(routerModule.planTeamRouting);
    expect(routerShim.RouteError).toBe(routerModule.RouteError);

    expect(rankShim.affinityBoost).toBe(rankModule.affinityBoost);
    expect(rankShim.backendForMode).toBe(rankModule.backendForMode);
    expect(rankShim.getDefaultModelTierMap).toBe(rankModule.getDefaultModelTierMap);
    expect(rankShim.isClaudeHost).toBe(rankModule.isClaudeHost);
    expect(rankShim.isCodexHost).toBe(rankModule.isCodexHost);

    expect(tiebreakShim.hostKindRank).toBe(tiebreakModule.hostKindRank);

    expect(tierShim.CLAUDE_TIER_FALLBACK).toBe(tierModule.CLAUDE_TIER_FALLBACK);
    expect(tierShim.tierDefaults).toBe(tierModule.tierDefaults);
    expect(tierShim.tierDefaultsForHost).toBe(tierModule.tierDefaultsForHost);
    expect(tierShim.defaultTierModels).toBe(tierModule.defaultTierModels);
    expect(tierShim.defaultTiersMap).toBe(tierModule.defaultTiersMap);
  });

  test("preserves routing behavior through the legacy host-router surface", () => {
    const routed = routerShim.route(
      { taskId: "shim-route", tier: "mid", mode: "auto", workType: "adversarial_review" },
      [
        {
          schema_version: "guild.host_capability.v1",
          host_id: "claude",
          host_kind: "claude",
          advertised_at: "2026-06-21T10:00:00Z",
          source: "test",
          tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
          supported_tiers: ["cheap", "mid", "powerful"],
          models: ["haiku", "sonnet", "opus"],
          tool_support: {
            subagent: true,
            agent_team: true,
            independent_agents: true,
            tmux: true,
            mcp: true,
            pre_tool_use_ask: true,
          },
        },
        {
          schema_version: "guild.host_capability.v1",
          host_id: "codex",
          host_kind: "codex",
          advertised_at: "2026-06-21T10:00:00Z",
          source: "test",
          tier_models: { cheap: "gpt-4o-mini", mid: "gpt-4o", powerful: "o3" },
          supported_tiers: ["cheap", "mid", "powerful"],
          models: ["gpt-4o-mini", "gpt-4o", "o3"],
          tool_support: {
            subagent: true,
            agent_team: false,
            independent_agents: false,
            tmux: false,
            mcp: true,
            pre_tool_use_ask: false,
          },
        },
      ],
      { now: Date.parse("2026-06-21T10:01:00Z"), crossHostEnabled: true }
    );

    expect(routed.hostKind).toBe("codex");
    expect(routed.model).toBe("gpt-4o");
    expect(rankShim.affinityBoost("adversarial_review", "codex")).toBeGreaterThan(
      rankShim.affinityBoost("adversarial_review", "claude")
    );
    expect(tiebreakShim.hostKindRank("claude")).toBe(0);
  });

  test("only module files define capability routing internals", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const shimFiles = [
      "scripts/lib/capability/router.ts",
      "scripts/lib/capability/rank.ts",
      "scripts/lib/capability/tiebreak.ts",
      "scripts/lib/capability/tier-defaults.ts",
    ];
    for (const file of shimFiles) {
      const content = fs.readFileSync(path.join(repoRoot, file), "utf8");
      expect(content).toMatch(/src\/domains\/config/);
      expect(content).not.toMatch(/export\s+function\s+(route|affinityBoost|hostKindRank|tierDefaults)/);
    }

    const router = fs.readFileSync(path.join(repoRoot, "src/domains/config/router.ts"), "utf8");
    const rank = fs.readFileSync(path.join(repoRoot, "src/domains/config/rank.ts"), "utf8");
    const tiebreak = fs.readFileSync(path.join(repoRoot, "src/domains/config/tiebreak.ts"), "utf8");
    const tierDefaults = fs.readFileSync(path.join(repoRoot, "src/domains/config/tier-defaults.ts"), "utf8");
    expect(router).toMatch(/export\s+function\s+route/);
    expect(rank).toMatch(/export\s+function\s+affinityBoost/);
    expect(tiebreak).toMatch(/export\s+function\s+hostKindRank/);
    expect(tierDefaults).toMatch(/export\s+function\s+tierDefaults/);
    expect(rank).toMatch(/from\s+["']\.\/host-id-namespace["']/);
    expect(rank).not.toMatch(/\.\.\/\.\.\/adapters/);
    expect(tierDefaults).toMatch(/from\s+["']\.\/host-registry-schema["']/);
    expect(tierDefaults).not.toMatch(/\.\.\/\.\.\/adapters/);
    expect(rank).not.toMatch(/\.\.\/\.\.\/adapters\//);
    expect(tierDefaults).not.toMatch(/\.\.\/\.\.\/adapters\//);
  });
});
