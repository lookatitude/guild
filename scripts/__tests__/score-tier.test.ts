/**
 * __tests__/score-tier.test.ts
 *
 * Unit + CLI integration tests for scripts/score-tier.ts.
 * Tests the pure `scoreTier` function and the CLI wrapper.
 *
 * ADR: docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §2
 */

import { spawnSync } from "child_process";
import * as path from "path";
import { scoreTier } from "../score-tier";
import type { TierSignals, ScorerOpts } from "../score-tier";

const SCRIPT = path.resolve(__dirname, "..", "score-tier.ts");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function runCli(args: string[]): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function parseOut(out: string): {
  score: number;
  tier: string;
  model?: string;
  modelParams?: Record<string, string>;
  effort?: string;
  reasoning?: string;
  thinking?: string;
  verbosity?: string;
} {
  return JSON.parse(out.trim());
}

// ── Pure function: work-type verb mapping (ADR §2 rubric) ────────────────────

describe("scoreTier — work-type verb mapping", () => {
  test("read → score 0 → cheap", () => {
    const r = scoreTier({ workType: "read" });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("cheap");
  });

  test("summarize → score 0 → cheap", () => {
    const r = scoreTier({ workType: "summarize" });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("cheap");
  });

  test("draft → score 1 → mid", () => {
    const r = scoreTier({ workType: "draft" });
    expect(r.score).toBe(1);
    expect(r.tier).toBe("mid");
  });

  test("extract → score 1 → mid", () => {
    const r = scoreTier({ workType: "extract" });
    expect(r.score).toBe(1);
    expect(r.tier).toBe("mid");
  });

  test("architect → score 2 → mid (below powerful threshold of 3)", () => {
    // architect alone = 2, which is < threshold.powerful(3) → mid
    const r = scoreTier({ workType: "architect" });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("review → score 2 → mid (below powerful threshold of 3)", () => {
    const r = scoreTier({ workType: "review" });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("schema → score 2 → mid (below powerful threshold of 3)", () => {
    const r = scoreTier({ workType: "schema" });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });
});

// ── Pure function: signal addends ─────────────────────────────────────────────

describe("scoreTier — signal addends", () => {
  test("architect + sensitivity → score 3 → powerful", () => {
    const r = scoreTier({ workType: "architect", sensitivity: true });
    expect(r.score).toBe(3);
    expect(r.tier).toBe("powerful");
  });

  test("review + sensitivity → score 3 → powerful", () => {
    const r = scoreTier({ workType: "review", sensitivity: true });
    expect(r.score).toBe(3);
    expect(r.tier).toBe("powerful");
  });

  test("schema + hasUpstreamContract → score 3 → powerful", () => {
    const r = scoreTier({ workType: "schema", hasUpstreamContract: true });
    expect(r.score).toBe(3);
    expect(r.tier).toBe("powerful");
  });

  test("priorEscalation bumps read from cheap to mid", () => {
    const r = scoreTier({ workType: "read", priorEscalation: true });
    expect(r.score).toBe(1);
    expect(r.tier).toBe("mid");
  });

  test("priorEscalation bumps draft from mid to mid (score 2, still mid)", () => {
    const r = scoreTier({ workType: "draft", priorEscalation: true });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("draft + priorEscalation + sensitivity → score 3 → powerful", () => {
    const r = scoreTier({ workType: "draft", priorEscalation: true, sensitivity: true });
    expect(r.score).toBe(3);
    expect(r.tier).toBe("powerful");
  });

  test("blastRadius contributes per unit (blastRadius=2 → +2)", () => {
    const r = scoreTier({ workType: "read", blastRadius: 2 });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("blastRadius=0 contributes nothing", () => {
    const r = scoreTier({ workType: "read", blastRadius: 0 });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("cheap");
  });

  test("all signals combined → large score → powerful", () => {
    const r = scoreTier({
      workType: "architect",
      blastRadius: 1,
      hasUpstreamContract: true,
      sensitivity: true,
      priorEscalation: true,
    });
    // 2 (architect) + 1 (blastRadius) + 1 (dependsOn) + 1 (security) + 1 (priorEscalation) = 6
    expect(r.score).toBe(6);
    expect(r.tier).toBe("powerful");
  });
});

// ── Pure function: threshold bands ────────────────────────────────────────────

describe("scoreTier — threshold band cutoffs", () => {
  test("score 0 → cheap (default thresholds {mid:1, powerful:3})", () => {
    const r = scoreTier({ workType: "read" });
    expect(r.tier).toBe("cheap");
  });

  test("score 1 → mid (at mid threshold)", () => {
    const r = scoreTier({ workType: "draft" });
    expect(r.score).toBe(1);
    expect(r.tier).toBe("mid");
  });

  test("score 2 → mid (between mid and powerful)", () => {
    const r = scoreTier({ workType: "architect" });
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("score 3 → powerful (at powerful threshold)", () => {
    const r = scoreTier({ workType: "architect", sensitivity: true });
    expect(r.score).toBe(3);
    expect(r.tier).toBe("powerful");
  });

  test("custom thresholds: {mid:2, powerful:4} — score 1 → cheap", () => {
    const opts: ScorerOpts = { thresholds: { mid: 2, powerful: 4 } };
    const r = scoreTier({ workType: "draft" }, opts); // score=1
    expect(r.score).toBe(1);
    expect(r.tier).toBe("cheap");
  });

  test("custom thresholds: {mid:2, powerful:4} — score 2 → mid", () => {
    const opts: ScorerOpts = { thresholds: { mid: 2, powerful: 4 } };
    const r = scoreTier({ workType: "architect" }, opts); // score=2
    expect(r.score).toBe(2);
    expect(r.tier).toBe("mid");
  });

  test("custom thresholds: {mid:2, powerful:4} — score 4 → powerful", () => {
    const opts: ScorerOpts = { thresholds: { mid: 2, powerful: 4 } };
    const r = scoreTier({ workType: "architect", sensitivity: true, hasUpstreamContract: true }, opts); // 2+1+1=4
    expect(r.score).toBe(4);
    expect(r.tier).toBe("powerful");
  });
});

// ── Pure function: model-tier pin override ─────────────────────────────────────

describe("scoreTier — modelTierPin override", () => {
  test("pin=cheap overrides a draft signal (mid score)", () => {
    const r = scoreTier({ workType: "draft" }, { modelTierPin: "cheap" });
    expect(r.score).toBe(1);   // raw score unchanged
    expect(r.tier).toBe("cheap"); // pin wins
  });

  test("pin=powerful overrides a read signal (cheap score)", () => {
    const r = scoreTier({ workType: "read" }, { modelTierPin: "powerful" });
    expect(r.score).toBe(0);
    expect(r.tier).toBe("powerful");
  });

  test("pin=mid overrides a schema+sensitivity (powerful score)", () => {
    const r = scoreTier(
      { workType: "schema", sensitivity: true },
      { modelTierPin: "mid" }
    );
    expect(r.score).toBe(3); // raw score still 3
    expect(r.tier).toBe("mid");
  });
});

// ── Pure function: model resolution from tiers map ────────────────────────────

describe("scoreTier — model resolution", () => {
  test("resolves claude model for cheap tier (default map)", () => {
    const r = scoreTier({ workType: "read" });
    expect(r.tier).toBe("cheap");
    expect(r.model).toBe("haiku");
  });

  test("resolves claude model for mid tier (default map)", () => {
    const r = scoreTier({ workType: "draft" });
    expect(r.tier).toBe("mid");
    expect(r.model).toBe("sonnet");
  });

  test("resolves claude model for powerful tier (default map)", () => {
    const r = scoreTier({ workType: "architect", sensitivity: true });
    expect(r.tier).toBe("powerful");
    expect(r.model).toBe("opus");
  });

  test("null host slot returns undefined model (codex not wired)", () => {
    const r = scoreTier({ workType: "read" }, { host: "codex" });
    expect(r.model).toBeUndefined();
  });

  test("custom tiers map is respected", () => {
    const opts: ScorerOpts = {
      tiers: {
        cheap:    { claude: "haiku-3",  codex: null },
        mid:      { claude: "sonnet-4", codex: null },
        powerful: { claude: "opus-4",   codex: null },
      },
    };
    const r = scoreTier({ workType: "draft" }, opts);
    expect(r.model).toBe("sonnet-4");
  });
});

// ── Determinism: same inputs → same outputs ───────────────────────────────────

describe("scoreTier — determinism", () => {
  test("identical calls produce identical results", () => {
    const signals: TierSignals = {
      workType: "draft",
      blastRadius: 1,
      hasUpstreamContract: true,
      sensitivity: false,
      priorEscalation: false,
    };
    const r1 = scoreTier(signals);
    const r2 = scoreTier(signals);
    const r3 = scoreTier(signals);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

// ── CLI integration ───────────────────────────────────────────────────────────

describe("score-tier.ts CLI", () => {
  test("read workType → cheap tier output", () => {
    const { status, out } = runCli(["--signals", JSON.stringify({ workType: "read" })]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.score).toBe(0);
    expect(j.tier).toBe("cheap");
    expect(j.model).toBe("haiku");
  });

  test("draft workType → mid tier output", () => {
    const { status, out } = runCli(["--signals", JSON.stringify({ workType: "draft" })]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.score).toBe(1);
    expect(j.tier).toBe("mid");
    expect(j.model).toBe("sonnet");
  });

  test("architect + sensitivity → powerful tier output", () => {
    const { status, out } = runCli([
      "--signals",
      JSON.stringify({ workType: "architect", sensitivity: true }),
    ]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.score).toBe(3);
    expect(j.tier).toBe("powerful");
    expect(j.model).toBe("opus");
  });

  test("--model-tier pin overrides scored tier (CLI)", () => {
    const { status, out } = runCli([
      "--signals",
      JSON.stringify({ workType: "read" }),
      "--model-tier",
      "powerful",
    ]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.score).toBe(0);     // raw score unchanged
    expect(j.tier).toBe("powerful"); // pin wins
    expect(j.model).toBe("opus");
  });

  test("--model-tier=cheap pin overrides scored mid", () => {
    const { status, out } = runCli([
      "--signals",
      JSON.stringify({ workType: "draft" }),
      "--model-tier=cheap",
    ]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("cheap");
    expect(j.model).toBe("haiku");
  });

  test("missing --signals exits 0 with cheap fallback (non-blocking)", () => {
    const { status, out } = runCli([]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("cheap");
  });

  test("invalid JSON exits 0 with cheap fallback (non-blocking)", () => {
    const { status, out } = runCli(["--signals", "{bad json"]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("cheap");
  });

  test("summarize workType → cheap", () => {
    const { status, out } = runCli(["--signals", JSON.stringify({ workType: "summarize" })]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("cheap");
  });

  test("extract workType → mid", () => {
    const { status, out } = runCli(["--signals", JSON.stringify({ workType: "extract" })]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("mid");
  });

  test("schema + security → powerful", () => {
    const { status, out } = runCli([
      "--signals",
      JSON.stringify({ workType: "schema", sensitivity: true }),
    ]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.tier).toBe("powerful");
  });

  test("priorEscalation bumps read to mid via CLI", () => {
    const { status, out } = runCli([
      "--signals",
      JSON.stringify({ workType: "read", priorEscalation: true }),
    ]);
    expect(status).toBe(0);
    const j = parseOut(out);
    expect(j.score).toBe(1);
    expect(j.tier).toBe("mid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G-11/R5 — models.tiers value union consumed via resolveTierModel():
// string | {model, effort?, reasoning?, thinking?, verbosity?} | null. String
// behavior byte-identical (covered above); object form surfaces modelParams.
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as os from "os";

describe("scoreTier — G-11 object-form tier values", () => {
  test("object form resolves model and surfaces full modelParams", () => {
    const r = scoreTier(
      { workType: "architect", sensitivity: true }, // score 3 → powerful
      {
        tiers: {
          powerful: {
            claude: {
              model: "opus-4.5",
              effort: "high",
              reasoning: "xhigh",
              thinking: "enabled",
              verbosity: "low",
            },
          },
        },
      }
    );
    expect(r.tier).toBe("powerful");
    expect(r.model).toBe("opus-4.5");
    expect(r.modelParams).toEqual({
      model: "opus-4.5",
      effort: "high",
      reasoning: "xhigh",
      thinking: "enabled",
      verbosity: "low",
    });
    expect(r.effort).toBe("high");
    expect(r.reasoning).toBe("xhigh");
    expect(r.thinking).toBe("enabled");
    expect(r.verbosity).toBe("low");
  });

  test("string form output keeps legacy model and adds modelParams without effort axes", () => {
    const r = scoreTier({ workType: "architect", sensitivity: true });
    expect(r.model).toBe("opus");
    expect(r.modelParams).toEqual({ model: "opus" });
    expect(r).not.toHaveProperty("effort");
    expect(r).not.toHaveProperty("reasoning");
    expect(r).not.toHaveProperty("thinking");
    expect(r).not.toHaveProperty("verbosity");
  });

  test("object form without effort surfaces only model", () => {
    const r = scoreTier(
      { workType: "draft" }, // score 1 → mid
      { tiers: { mid: { claude: { model: "sonnet-4" } } } }
    );
    expect(r.model).toBe("sonnet-4");
    expect(r).not.toHaveProperty("effort");
  });

  test("enabled=false static-mid path unpacks the object form too", () => {
    const r = scoreTier(
      { workType: "architect", sensitivity: true },
      {
        enabled: false,
        tiers: { mid: { claude: { model: "sonnet-4", effort: "medium" } } },
      }
    );
    expect(r.tier).toBe("mid");
    expect(r.model).toBe("sonnet-4");
    expect(r.modelParams).toEqual({ model: "sonnet-4", effort: "medium" });
    expect(r.effort).toBe("medium");
  });

  test("null host slot still yields undefined model under the union", () => {
    const r = scoreTier(
      { workType: "draft" },
      { tiers: { mid: { claude: null } } }
    );
    expect(r.model).toBeUndefined();
  });

  test("CLI: object form in .guild/settings.json reaches the scorer (real resolver path)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-score-g11-"));
    try {
      fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(dir, ".guild", "settings.json"),
        JSON.stringify({
          models: {
            tiers: { powerful: { claude: { model: "opus-4.5", effort: "high" } } },
          },
        })
      );
      const { status, out } = runCli([
        "--signals",
        JSON.stringify({ workType: "architect", sensitivity: true }),
        "--cwd",
        dir,
      ]);
      expect(status).toBe(0);
      const j = JSON.parse(out.trim());
      expect(j.tier).toBe("powerful");
      expect(j.model).toBe("opus-4.5");
      expect(j.modelParams).toEqual({ model: "opus-4.5", effort: "high" });
      expect(j.effort).toBe("high");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
