/**
 * scripts/__tests__/codex-git-install-mcp.test.ts
 *
 * CODEX GIT-INSTALL MCP DECLARATION (issue #114).
 *
 * THE DEFECT. A Codex git-ref install (`codex plugin marketplace add
 * lookatitude/guild --ref main`) materializes THE REPO as the plugin payload.
 * With no Codex manifest at the repo root, Codex fell back to Claude's
 * `.mcp.json`, whose args are `${CLAUDE_PLUGIN_ROOT}/mcp-servers/<n>/dist/index.js`.
 * Codex does NOT expand that placeholder for MCP server args, so it spawned
 * `node '${CLAUDE_PLUGIN_ROOT}/…'`, node exited on the nonexistent path, and every
 * session opened with:
 *
 *     ⚠ MCP client for `guild-memory` failed to start: … connection closed
 *     ⚠ MCP client for `guild-telemetry` failed to start: … connection closed
 *
 * MEASURED on codex 0.146.0 / guild 2.4.0 (all three forms, functional oracle =
 * ask Codex to call `wiki_list` and see whether the tool exists):
 *
 *   | args form                                   | result        |
 *   |---------------------------------------------|---------------|
 *   | `${CLAUDE_PLUGIN_ROOT}/mcp-servers/…`       | NOT started   |
 *   | `mcp-servers/…` (bare relative)             | NOT started   |
 *   | `./mcp-servers/…` (dot-slash)               | NOT started   |
 *   | `/abs/path/to/…/dist/index.js`              | STARTED (ok)  |
 *
 * Codex resolves `./`-prefixed paths for the `skills`/`hooks` contract fields but
 * performs NO resolution for MCP server args — only absolute paths work. An
 * absolute path cannot be published: the install root is a version-keyed cache
 * dir (`~/.codex/plugins/cache/guild/guild/<version>/`) unknown at publish time.
 *
 * THE FIX. Ship a Codex manifest at the repo root that explicitly declares NO MCP
 * servers, so Codex stops falling back to Claude's file. This makes the git-install
 * path match the ALREADY-SHIPPED behavior of the rendered Codex package, whose
 * `renderCodexPluginJson` never emits `mcpServers` for exactly this reason — which
 * is why a local-marketplace install was always silent while the git install was not.
 *
 * WHY THE MANIFEST IS MINIMAL. It carries `name`, `version`, `mcpServers` — no more.
 *   - No `skills`/`hooks` paths: the rendered package points at `./.agents/skills/`,
 *     a layout that does NOT exist in the repo. Declaring it would break skill
 *     discovery for git installs. Omitted → Codex keeps its working default
 *     discovery (verified live: 113 guild skills still visible after this change).
 *   - `version` IS required and IS generated. Omitting it made `codex plugin list`
 *     report the plugin as "local" instead of the real version (measured against a
 *     control install on a ref without this manifest, which reported 2.4.0). To
 *     avoid a second hand-kept version site (wi-02), this file joined the
 *     GENERATED + drift-gated install surface in build-host-packages.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  renderCodexGitInstallManifest,
  renderCodexPluginJson,
} from "../../src/modules/distribution/workflows/per-host-packaging";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8")) as Record<string, unknown>;
}

describe("the repo root ships a Codex manifest that declares no MCP servers", () => {
  const manifestRel = path.join(".codex-plugin", "plugin.json");

  it("exists — without it, Codex falls back to Claude's .mcp.json", () => {
    expect(fs.existsSync(path.join(PLUGIN_ROOT, manifestRel))).toBe(true);
  });

  it("declares mcpServers as an EMPTY object (the suppression signal)", () => {
    const m = readJson(manifestRel);
    expect(m["mcpServers"]).toEqual({});
    // Verified live via `codex mcp list`: 2 declared servers → 0 with this file.
  });

  it("stays minimal — no skills/hooks paths that would break git-install discovery", () => {
    const m = readJson(manifestRel);
    expect(Object.keys(m).sort()).toEqual(["mcpServers", "name", "version"]);
    expect(m["name"]).toBe("guild");
    // Guard the specific footgun: the rendered layout's skills path does not
    // exist in the repo, so it must never be declared here.
    expect(m["skills"]).toBeUndefined();
    expect(m["hooks"]).toBeUndefined();
  });

  it("carries the CANONICAL version verbatim — a missing one makes codex report \"local\"", () => {
    const canonical = readJson(path.join(".claude-plugin", "plugin.json"))["version"];
    expect(typeof canonical).toBe("string");
    expect(readJson(manifestRel)["version"]).toBe(canonical);
  });

  it("is GENERATED from the canonical manifest, not hand-kept (wi-02)", () => {
    // Same renderer the install-surface sync uses, fed the canonical manifest:
    // its output must equal the committed file, so a hand-bump cannot survive.
    const canonical = readJson(path.join(".claude-plugin", "plugin.json"));
    const rendered = renderCodexGitInstallManifest(canonical as never, {
      renderedAt: "1970-01-01T00:00:00Z",
    } as never) as unknown as Record<string, unknown>;
    expect(rendered).toEqual(readJson(manifestRel));
    expect(rendered["mcpServers"]).toEqual({});
  });
});

describe("Claude's contract is untouched", () => {
  it(".mcp.json still uses ${CLAUDE_PLUGIN_ROOT} for both servers", () => {
    const mcp = readJson(".mcp.json") as { mcpServers: Record<string, { args?: string[] }> };
    const names = Object.keys(mcp.mcpServers).sort();
    expect(names).toEqual(["guild-memory", "guild-telemetry"]);
    for (const n of names) {
      // Claude DOES expand this; the fix must not "fix" it into a relative path.
      expect(mcp.mcpServers[n].args?.[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    }
  });
});

describe("parity with the rendered Codex package", () => {
  it("renderCodexPluginJson still omits mcpServers — same decision, both paths", () => {
    const rendered = renderCodexPluginJson(
      {
        name: "guild",
        version: "9.9.9",
        description: "d",
      } as never,
      { renderedAt: "1970-01-01T00:00:00Z" } as never
    ) as unknown as Record<string, unknown>;
    expect(rendered["mcpServers"]).toBeUndefined();
  });
});
