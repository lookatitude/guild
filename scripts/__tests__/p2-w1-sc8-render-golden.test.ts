/**
 * scripts/__tests__/p2-w1-sc8-render-golden.test.ts
 *
 * SC-W1-8 (AC23 + per-host rendering) — the AUTHORITATIVE per-host render GOLDEN that pins
 * the exact rendered shape for ALL FIVE registry hosts (claude / codex / .agents / pi /
 * antigravity), rendered via the SHIPPED `renderAllHostConfigs()` from the host-registry
 * capability rows (single SoT). Plus the cross-host SECRET / LOCAL-LEAK negative: a
 * secret-bearing AND a local-scope value must NOT appear in ANY rendered host shape.
 *
 * Lives in scripts/__tests__ (not tests/universal-host) because config-render.ts
 * transitively loads docs-hygiene/scan.ts, which only the scripts/ jest project transforms.
 *
 * Re-baselining the golden is an EXPLICIT, LW1-9-signed action (R5): regenerate only when a
 * deliberate render-shape change lands, never to make a red test green silently.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  renderAllHostConfigs,
  type RenderConfigInput,
} from "../lib/config-render";
import { resolveBaselineGolden } from "../lib/permission-policy-schema";
import { HOST_IDS } from "../lib/host-registry-schema";

const NOW = "2026-06-17T00:00:00Z";
const GOLDEN_PATH = path.join(__dirname, "fixtures", "p2-w1-sc8-render-golden.json");

function baseInput(over: Partial<RenderConfigInput> = {}): RenderConfigInput {
  return {
    config: {
      models: { tiers: { cheap: { claude: "haiku" }, mid: { claude: "sonnet" }, powerful: { claude: "opus" } } },
      security: { bypass_permissions_policy: "audit" },
      auto_approve: [],
      ...((over.config as object) ?? {}),
    } as RenderConfigInput["config"],
    permissions: over.permissions ?? resolveBaselineGolden(),
    sources: over.sources,
    options: { renderedAt: NOW, sourceVersion: "2.0.0", ...(over.options ?? {}) },
  };
}

describe("SC-W1-8 — per-host render golden (5 hosts)", () => {
  it("renders byte-identically to the committed golden for all five hosts", () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, "utf8"));
    const rendered = renderAllHostConfigs(baseInput());
    expect(rendered).toEqual(golden);
    expect(Object.keys(golden).sort()).toEqual([...HOST_IDS].sort()); // anti-vacuity
  });

  it("is deterministic (same input + renderedAt ⇒ byte-identical across two renders)", () => {
    expect(JSON.stringify(renderAllHostConfigs(baseInput()))).toBe(
      JSON.stringify(renderAllHostConfigs(baseInput()))
    );
  });
});

describe("SC-W1-8 — cross-host secret / local-leak negative (F-9)", () => {
  const SECRET = "ghp_0123456789abcdefghijABCDEFGHIJ012345";
  const LOCAL_ONLY = "LOCAL-ONLY-CODENAME-ZEPHYR";

  it("a secret value never appears in ANY rendered host shape", () => {
    const all = renderAllHostConfigs(
      baseInput({ config: { roles: { host: "claude", note: `token=${SECRET}` } } as RenderConfigInput["config"] })
    );
    for (const id of HOST_IDS) {
      expect(JSON.stringify(all[id])).not.toContain(SECRET);
    }
  });

  it("a local/secret-codename value is withheld from every shared host output", () => {
    const all = renderAllHostConfigs(
      baseInput({
        config: { roles: { host: "claude", note: LOCAL_ONLY } } as RenderConfigInput["config"],
        options: { renderedAt: NOW, redactionPatterns: ["LOCAL-ONLY-CODENAME-[A-Z]+"] },
      })
    );
    for (const id of HOST_IDS) {
      expect(JSON.stringify(all[id])).not.toContain(LOCAL_ONLY);
    }
  });
});
