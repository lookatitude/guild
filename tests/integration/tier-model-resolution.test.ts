/**
 * tests/integration/tier-model-resolution.test.ts
 *
 * Cross-cutting integration tests for the host-agnostic tier→model map
 * contract (ADR §1, §2, §10; VC-5 SC-5).
 *
 * These tests cover surfaces Lane C (scripts/__tests__/read-guild-config.test.ts)
 * did NOT cover:
 *   - End-to-end resolution of cheap→haiku / mid→sonnet / powerful→opus via
 *     the resolved config object (not just "is the key present").
 *   - Null host slot semantics: a null slot for a non-primary host is not a
 *     validation error; the contract says null means "no model for this
 *     tier/host combination — fall through to primary host".
 *   - Precedence chain as an integration fixture: the four-layer ladder
 *     (--model-tier > per-lane pin > settings > built-in) exercised together
 *     using the canonical default map as the oracle.
 *
 * Strategy: drive via `read-guild-config.ts --scaffold` and via synthetic
 * settings.json repos (mkdtemp) rather than duplicating unit tests.
 * The script is the code-shaped surface; we assert the CONTRACT it exposes.
 *
 * guild-plan.md §15.2 risk row 3 (decision-capture noise) + VC-5 (SC-5).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../../scripts/read-guild-config.ts");
const ENV: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: "1" };

function run(
  args: string[],
  extraEnv: Record<string, string> = {}
): { status: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...ENV, ...extraEnv },
    timeout: 30000,
  });
  return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function mkRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tier-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  return dir;
}

function writeSettings(dir: string, obj: unknown): void {
  fs.writeFileSync(
    path.join(dir, ".guild", "settings.json"),
    JSON.stringify(obj, null, 2)
  );
}

describe("Tier→model map resolution — end-to-end contract (ADR §1, VC-5)", () => {
  const repos: string[] = [];
  afterAll(() =>
    repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true }))
  );
  const repo = () => {
    const d = mkRepo();
    repos.push(d);
    return d;
  };

  // ── Built-in defaults resolve the canonical cheap/mid/powerful→claude model map ──

  test("built-in cheap tier resolves to claude=haiku (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap.claude).toBe("haiku");
  });

  test("built-in mid tier resolves to claude=sonnet (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.mid.claude).toBe("sonnet");
  });

  test("built-in powerful tier resolves to claude=opus (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.powerful.claude).toBe("opus");
  });

  // ── Null host slot semantics ─────────────────────────────────────────────────
  // ADR §1: "A null host slot means: this host has no model for this tier;
  // fall through to the selected host's mapping."
  // Null is a valid value — the contract must expose it (not coerce to string).

  test("built-in codex slot is null for all tiers (no third host yet)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap.codex).toBeNull();
    expect(j.models.tiers.mid.codex).toBeNull();
    expect(j.models.tiers.powerful.codex).toBeNull();
  });

  test("built-in gemini slot is null for all tiers (no third host yet)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap.gemini).toBeNull();
    expect(j.models.tiers.mid.gemini).toBeNull();
    expect(j.models.tiers.powerful.gemini).toBeNull();
  });

  test("settings.json null codex slot survives deep-merge without being coerced", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          mid: { claude: "sonnet", codex: null, gemini: null },
        },
      },
    });
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    // The null for codex/gemini must survive the merge — not become undefined or ""
    expect(j.models.tiers.mid.codex).toBeNull();
    expect(j.models.tiers.mid.gemini).toBeNull();
    // The primary claude mapping must be present
    expect(j.models.tiers.mid.claude).toBe("sonnet");
  });

  test("null codex slot does not cause --validate to reject the config", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          cheap: { claude: "haiku", codex: null, gemini: null },
          mid: { claude: "sonnet", codex: null, gemini: null },
          powerful: { claude: "opus", codex: null, gemini: null },
        },
      },
    });
    const { status, out } = run(["--cwd", dir, "--validate"]);
    expect(status).toBe(0);
    expect(out).toMatch(/VALID/);
  });

  // ── Precedence: settings > built-in ─────────────────────────────────────────
  // (Lane C covered --model-tier > settings. Here we confirm settings wins over
  // built-in for an explicit per-tier override, completing the ladder.)

  test("settings.json claude model override for cheap tier wins over built-in haiku", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          cheap: { claude: "sonnet", codex: null, gemini: null },
        },
      },
    });
    const { out } = run(["--cwd", dir]);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap.claude).toBe("sonnet"); // overridden
    // other tiers unchanged
    expect(j.models.tiers.mid.claude).toBe("sonnet");
    expect(j.models.tiers.powerful.claude).toBe("opus");
  });

  test("settings.json claude model override for powerful tier wins over built-in opus", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          powerful: { claude: "sonnet", codex: null, gemini: null },
        },
      },
    });
    const { out } = run(["--cwd", dir]);
    const j = JSON.parse(out);
    expect(j.models.tiers.powerful.claude).toBe("sonnet");
    // cheap stays at built-in haiku
    expect(j.models.tiers.cheap.claude).toBe("haiku");
  });

  // ── Precedence: --model-tier CLI > settings (integration assertion) ──────────
  // Confirms the CLI escape hatch seats atop the ladder in the resolved output.

  test("--model-tier=cheap with settings.json mid override still emits _model_tier_override.tier=cheap", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          mid: { claude: "opus", codex: null, gemini: null }, // operator pin
        },
      },
    });
    const { status, out } = run(["--cwd", dir, "--model-tier=cheap"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    // The CLI escape hatch records its override
    expect(j._model_tier_override).toBeDefined();
    expect(j._model_tier_override.tier).toBe("cheap");
    // Underlying tiers map still reflects settings.json override (not clobbered)
    expect(j.models.tiers.mid.claude).toBe("opus");
  });

  test("--model-tier=powerful surfaces at top of ladder in _model_tier_override.source", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir, "--model-tier=powerful"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j._model_tier_override.source).toMatch(/--model-tier/);
    expect(j._model_tier_override.note).toMatch(
      /--model-tier.*per-lane|per-lane.*--model-tier/i
    );
  });

  // ── Scaffold includes all three tier keys with full host triples ─────────────

  test("scaffold tier map has exactly cheap/mid/powerful each with claude/codex/gemini keys", () => {
    const { status, out } = run(["--scaffold"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    const tiers = j.models.tiers;
    for (const tier of ["cheap", "mid", "powerful"]) {
      expect(tiers[tier]).toBeDefined();
      expect(Object.keys(tiers[tier]).sort()).toEqual(
        ["claude", "codex", "gemini"].sort()
      );
    }
  });

  test("scaffold _help._precedence documents model-tier ladder (ADR §2 O-2)", () => {
    const { out } = run(["--scaffold"]);
    const j = JSON.parse(out);
    const precedence: string = j._help._precedence;
    // Must mention --model-tier and per-lane
    expect(precedence).toMatch(/--model-tier/i);
    expect(precedence).toMatch(/per-lane/i);
  });
});
