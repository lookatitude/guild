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

  // Post host-adapter-migration: the resolved tier map is keyed by the canonical
  // v2 host ids (claude→claude-code-cli, codex→codex-cli). `gemini` is DROPPED
  // entirely (D10 — no registry row, normalizeHostId("gemini")===null), so the
  // former gemini null-slot assertions retarget to a real canonical non-primary
  // host (pi-cli). This is a test-expectation update: the resolved OUTPUT object is
  // intentionally closed to the canonical key set; normalizeHostId only aliases
  // INPUT/lookup keys at the resolveTierModel seam, never injects legacy output keys.
  test("built-in cheap tier resolves to claude-code-cli=haiku (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap["claude-code-cli"]).toBe("haiku");
  });

  test("built-in mid tier resolves to claude-code-cli=sonnet (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.mid["claude-code-cli"]).toBe("sonnet");
  });

  test("built-in powerful tier resolves to claude-code-cli=opus (zero-config)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.powerful["claude-code-cli"]).toBe("opus");
  });

  // ── Null host slot semantics ─────────────────────────────────────────────────
  // ADR §1: "A null host slot means: this host has no model for this tier;
  // fall through to the selected host's mapping."
  // Null is a valid value — the contract must expose it (not coerce to string).

  test("built-in codex-cli slot is null for all tiers (non-primary host)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap["codex-cli"]).toBeNull();
    expect(j.models.tiers.mid["codex-cli"]).toBeNull();
    expect(j.models.tiers.powerful["codex-cli"]).toBeNull();
  });

  test("built-in pi-cli slot is null for all tiers (non-primary host; gemini dropped per D10)", () => {
    const dir = repo();
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap["pi-cli"]).toBeNull();
    expect(j.models.tiers.mid["pi-cli"]).toBeNull();
    expect(j.models.tiers.powerful["pi-cli"]).toBeNull();
  });

  test("settings.json null non-primary slot survives deep-merge without being coerced", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null },
        },
      },
    });
    const { status, out } = run(["--cwd", dir]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    // The null for codex-cli/pi-cli must survive the merge — not become undefined or ""
    expect(j.models.tiers.mid["codex-cli"]).toBeNull();
    expect(j.models.tiers.mid["pi-cli"]).toBeNull();
    // The primary claude-code-cli mapping must be present
    expect(j.models.tiers.mid["claude-code-cli"]).toBe("sonnet");
  });

  test("null non-primary slot does not cause --validate to reject the config", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          cheap: { "claude-code-cli": "haiku", "codex-cli": null, "pi-cli": null },
          mid: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null },
          powerful: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null },
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

  test("settings.json claude-code-cli model override for cheap tier wins over built-in haiku", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          cheap: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null },
        },
      },
    });
    const { out } = run(["--cwd", dir]);
    const j = JSON.parse(out);
    expect(j.models.tiers.cheap["claude-code-cli"]).toBe("sonnet"); // overridden
    // other tiers unchanged
    expect(j.models.tiers.mid["claude-code-cli"]).toBe("sonnet");
    expect(j.models.tiers.powerful["claude-code-cli"]).toBe("opus");
  });

  test("settings.json claude-code-cli model override for powerful tier wins over built-in opus", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          powerful: { "claude-code-cli": "sonnet", "codex-cli": null, "pi-cli": null },
        },
      },
    });
    const { out } = run(["--cwd", dir]);
    const j = JSON.parse(out);
    expect(j.models.tiers.powerful["claude-code-cli"]).toBe("sonnet");
    // cheap stays at built-in haiku
    expect(j.models.tiers.cheap["claude-code-cli"]).toBe("haiku");
  });

  // ── Precedence: --model-tier CLI > settings (integration assertion) ──────────
  // Confirms the CLI escape hatch seats atop the ladder in the resolved output.

  test("--model-tier=cheap with settings.json mid override still emits _model_tier_override.tier=cheap", () => {
    const dir = repo();
    writeSettings(dir, {
      models: {
        tiers: {
          mid: { "claude-code-cli": "opus", "codex-cli": null, "pi-cli": null }, // operator pin
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
    expect(j.models.tiers.mid["claude-code-cli"]).toBe("opus");
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

  test("scaffold tier map has exactly cheap/mid/powerful each with the canonical 9 host-id keys", () => {
    const { status, out } = run(["--scaffold"]);
    expect(status).toBe(0);
    const j = JSON.parse(out);
    const tiers = j.models.tiers;
    // G4b (host-reachability): the registry grew from 9 to 16 host ids (4
    // wrapped-CLI + 3 agents-file IDE hosts); config-defaults.ts's DEFAULTS.models.tiers
    // now carries a slot for every one of them (see
    // scripts/__tests__/config-defaults-tiers-host-ids.test.ts for the drift guard).
    const CANONICAL_HOST_KEYS = [
      "claude-code-cli",
      "codex-cli",
      "pi-cli",
      "antigravity-cli",
      "agents-file",
      "claude-code-app",
      "claude-code-web",
      "codex-app",
      "claude-ai-connector",
      "cursor",
      "github-copilot",
      "opencode",
      "rovo-dev",
      "kiro",
      "qoder",
      "trae",
    ];
    for (const tier of ["cheap", "mid", "powerful"]) {
      expect(tiers[tier]).toBeDefined();
      expect(Object.keys(tiers[tier]).sort()).toEqual(CANONICAL_HOST_KEYS.slice().sort());
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
