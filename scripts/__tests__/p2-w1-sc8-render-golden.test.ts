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
  renderHostConfig,
  type RenderConfigInput,
  type ConfigSource,
} from "../lib/config-render";
import { resolveBaselineGolden } from "../lib/permission-policy-schema";
import { HOST_IDS } from "../lib/host-registry-schema";

const NOW = "2026-06-17T00:00:00Z";
const GOLDEN_PATH = path.join(__dirname, "fixtures", "p2-w1-sc8-render-golden.json");

function baseInput(over: Partial<RenderConfigInput> = {}): RenderConfigInput {
  return {
    config: {
      models: { tiers: { cheap: { "claude-code-cli": "haiku" }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } },
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

  it("a secret value never appears in ANY rendered host shape", () => {
    const all = renderAllHostConfigs(
      baseInput({
        config: { roles: { host: "claude-code-cli", note: `token=${SECRET}` } } as RenderConfigInput["config"],
        sources: {}, // enforce the local-guard (empty = nothing local, but the secret scan still runs)
      })
    );
    for (const id of HOST_IDS) {
      expect(JSON.stringify(all[id])).not.toContain(SECRET);
    }
  });

  // FIX 2 (codex anti-vacuity): drive the REAL provenance-withhold path with a `sources`
  // map (not redactionPatterns over a string), exercising BOTH feeders the renderer guards:
  // the models tier slot AND the permission feeder (auto_approve / security.bypass).
  it("a LOCAL-scoped models slot value is withheld from the shared render (provenance path)", () => {
    const LOCAL_MODEL = "LOCAL-ONLY-MODEL-ZEPHYR";
    const sources: Record<string, ConfigSource> = { "models.tiers.cheap.claude-code-cli": "project-local" };
    const r = renderHostConfig(
      "claude-code-cli",
      baseInput({
        config: {
          models: { tiers: { cheap: { "claude-code-cli": LOCAL_MODEL }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } },
        } as RenderConfigInput["config"],
        sources,
      })
    );
    // the local-only override never surfaces, anywhere
    expect(JSON.stringify(r)).not.toContain(LOCAL_MODEL);
    expect(r.models?.cheap).not.toBe(LOCAL_MODEL);
    // it was withheld via the provenance guard (recorded redaction), and fails closed
    expect(r._redactions?.some((x) => x.field === "models.tiers.cheap.claude-code-cli" && x.reason === "local-scope")).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it("a LOCAL-scoped permission FEEDER withholds the whole derived permission block (provenance path)", () => {
    const sources: Record<string, ConfigSource> = { auto_approve: "workspace-local" };
    const r = renderHostConfig("claude-code-cli", baseInput({ config: { auto_approve: ["Bash"] } as RenderConfigInput["config"], sources }));
    expect(r.permissions).toBeUndefined(); // the derived block is withheld, not leaked
    expect(
      r._redactions?.some((x) => x.field === "permissions" && x.reason === "local-scope" && /auto_approve/.test(x.detail))
    ).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("ANTI-VACUITY control: the SAME slot marked NON-local (project) IS emitted (withhold is source-driven)", () => {
    const SHARED_MODEL = "sonnet-shared-override";
    const sources: Record<string, ConfigSource> = { "models.tiers.cheap.claude-code-cli": "project" }; // not local
    const r = renderHostConfig(
      "claude-code-cli",
      baseInput({
        config: {
          models: { tiers: { cheap: { "claude-code-cli": SHARED_MODEL }, mid: { "claude-code-cli": "sonnet" }, powerful: { "claude-code-cli": "opus" } } },
        } as RenderConfigInput["config"],
        sources,
      })
    );
    expect(r.models?.cheap).toBe(SHARED_MODEL); // a non-local override DOES render → guard isn't always-on
  });
});
