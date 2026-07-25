/**
 * scripts/__tests__/version-source-of-truth.test.ts
 *
 * VERSION SOURCE-OF-TRUTH RAIL
 * (initiative cross-host-release-distribution, work item xhrd-wi-02 / G2).
 *
 * G2's contract: ONE canonical version field, with every host manifest
 * GENERATED from it, plus a drift gate that fails a release whose host
 * manifests disagree.
 *
 * The canonical field is `.claude-plugin/plugin.json`'s `version`:
 *   plugin.json → readManifest()        (build-inventory.ts)
 *               → inv.manifest.version  (guild.inventory.json)
 *               → every per-host renderer in per-host-packaging.ts
 *
 * This rail pins BOTH halves of the contract:
 *   (A) PROPAGATION — each host renderer emits the canonical version verbatim,
 *       asserted as a pure function so no host can quietly hardcode or drop it.
 *   (B) THE GATE — a skewed committed `.claude-plugin/marketplace.json` is
 *       actually REJECTED by `build-host-packages.ts --check-claude-install`.
 *
 * (B) is the red-first half. Without it, (A) would only prove the renderers
 * agree with each other while a hand-edited committed manifest drifted freely —
 * which is the exact failure mode the release procedure used to allow, because
 * the checklist asked operators to bump TWO manifests by hand.
 *
 * Companion rail: inventory-drift-gate.test.ts covers guild.inventory.json,
 * the other committed artifact in the same chain.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  renderClaudeMarketplacePackage,
  renderClaudePluginPackage,
  renderCodexPluginJson,
} from "../../src/modules/distribution/workflows/per-host-packaging";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const MARKETPLACE = path.join(PLUGIN_ROOT, ".claude-plugin", "marketplace.json");
const PLUGIN_MANIFEST = path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");

/** A minimal neutral manifest carrying a version no real release could collide with. */
const SENTINEL = "9.9.9";
const manifest = {
  name: "guild",
  version: SENTINEL,
  description: "test manifest",
  homepage: "https://guildstack.dev",
  repository: "https://github.com/lookatitude/guild",
  author: { name: "Test", email: "t@example.com" },
  license: "MIT",
  keywords: ["agents"],
};

describe("(A) version propagates from the canonical field into every host renderer", () => {
  const opts = { renderedAt: "1970-01-01T00:00:00Z" };

  it("Claude plugin manifest carries the canonical version", () => {
    const out = renderClaudePluginPackage(manifest as never, opts as never) as { version?: string };
    expect(out.version).toBe(SENTINEL);
  });

  it("Claude marketplace manifest carries the canonical version (the file Codex reads over git)", () => {
    const out = renderClaudeMarketplacePackage(manifest as never, opts as never);
    expect(out.plugins[0].version).toBe(SENTINEL);
  });

  it("Codex plugin manifest carries the canonical version", () => {
    const out = renderCodexPluginJson(manifest as never, opts as never) as { version?: string };
    expect(out.version).toBe(SENTINEL);
  });

  it("no renderer silently substitutes a different version", () => {
    const rendered = [
      (renderClaudePluginPackage(manifest as never, opts as never) as { version?: string }).version,
      renderClaudeMarketplacePackage(manifest as never, opts as never).plugins[0].version,
      (renderCodexPluginJson(manifest as never, opts as never) as { version?: string }).version,
    ];
    expect(new Set(rendered)).toEqual(new Set([SENTINEL]));
  });
});

describe("(B) the drift gate rejects a skewed committed host manifest", () => {
  /** Run the install-surface check; return its exit code. */
  function runCheck(): number {
    try {
      execFileSync("npx", ["tsx", "build-host-packages.ts", "--root", "..", "--check-claude-install"], {
        cwd: path.join(PLUGIN_ROOT, "scripts"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return 0;
    } catch (e) {
      return (e as { status?: number }).status ?? -1;
    }
  }

  it("FAILS when .claude-plugin/marketplace.json's version disagrees with plugin.json", () => {
    const pristine = fs.readFileSync(MARKETPLACE, "utf8");
    const canonical = (JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, "utf8")) as { version: string }).version;
    expect(canonical).not.toBe(SENTINEL); // the skew below must be a real change

    try {
      const skewed = JSON.parse(pristine) as { plugins: { version: string }[] };
      skewed.plugins[0].version = SENTINEL;
      fs.writeFileSync(MARKETPLACE, JSON.stringify(skewed, null, 2) + "\n");

      // RED: a hand-edited committed manifest that disagrees with the canonical
      // field must not survive CI.
      expect(runCheck()).not.toBe(0);
    } finally {
      fs.writeFileSync(MARKETPLACE, pristine);
    }

    // GREEN again once restored — proves the failure was the skew, not a
    // pre-existing broken tree (which would make the assertion above vacuous).
    expect(runCheck()).toBe(0);
  }, 600_000);
});
