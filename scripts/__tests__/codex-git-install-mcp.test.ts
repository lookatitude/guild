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
 * THE FORM THAT WORKS. Measured on codex 0.146.0 (functional oracle = ask Codex to
 * call `wiki_list` and see whether the tool exists and answers):
 *
 *   | declaration                                 | server starts?         |
 *   |---------------------------------------------|------------------------|
 *   | args `${CLAUDE_PLUGIN_ROOT}/mcp-servers/…`  | NO                     |
 *   | args `mcp-servers/…` (no cwd)               | NO                     |
 *   | args `./mcp-servers/…` (no cwd)             | NO                     |
 *   | args absolute                               | yes, but unpublishable |
 *   | args `mcp-servers/…` + `cwd: "."`           | YES                    |
 *
 * Codex resolves a RELATIVE plugin MCP `cwd` beneath the plugin root, so
 * `cwd: "."` + plugin-relative args is the only form that is both resolvable and
 * publishable — an absolute path cannot be committed, because the install root is
 * `~/.codex/plugins/cache/guild/guild/<version>/`, unknown at publish time.
 *
 * A first attempt at this fix shipped `mcpServers: {}` (suppress rather than fix).
 * The adversarial gate caught that it disabled working functionality: the
 * experiment had varied only `args` and never `cwd`. Verified independently before
 * this rewrite — with `cwd: "."` the server starts and returns real wiki results.
 *
 * WHY THE MAP IS ALWAYS EMITTED EXPLICITLY. The rendered Codex package's
 * `renderCodexPluginJson` emits no `mcpServers` and is silent — but that is because
 * the rendered tree ships NO `.mcp.json` to fall back to, NOT because omission and
 * `{}` are equivalent. For a payload that does carry `.mcp.json` (the repo),
 * omitting the field re-enables the broken fallback. Omission ≠ empty ≠ populated.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { checkClaudeInstallSurface } from "../build-host-packages";
// buildInventory (not the private loadInventory) — the latter WRITES
// guild.inventory.json, the documented side effect that flakes sibling suites.
import { buildInventory } from "../build-inventory";
import {
  renderCodexGitInstallManifest,
  renderCodexPluginJson,
} from "../../src/modules/distribution/workflows/per-host-packaging";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const MANIFEST_REL = path.join(".codex-plugin", "plugin.json");
const STAMP = "1970-01-01T00:00:00Z";

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8")) as Record<string, unknown>;
}

type Entry = { type?: string; command?: string; args?: string[]; cwd?: string };

describe("the repo-root Codex manifest declares servers Codex can actually start", () => {
  it("declares BOTH Guild MCP servers (not an empty map)", () => {
    const m = readJson(MANIFEST_REL) as { mcpServers: Record<string, Entry> };
    expect(Object.keys(m.mcpServers).sort()).toEqual(["guild-memory", "guild-telemetry"]);
  });

  it("every server uses plugin-relative args + cwd '.' — the only resolvable publishable form", () => {
    const m = readJson(MANIFEST_REL) as { mcpServers: Record<string, Entry> };
    for (const [name, e] of Object.entries(m.mcpServers)) {
      expect(e.cwd).toBe(".");
      expect(e.command).toBe("node");
      expect(e.args?.length).toBeGreaterThan(0);
      for (const a of e.args ?? []) {
        // The three measured failure modes must never reappear.
        expect(a).not.toContain("${CLAUDE_PLUGIN_ROOT}");
        expect(a.startsWith("/")).toBe(false);
        expect(a.startsWith("./")).toBe(false);
      }
      expect(e.args?.[0]).toBe(`mcp-servers/${name}/dist/index.js`);
      expect(e.args).toContain("--no-cwd-fallback");
    }
  });

  it("each declared entrypoint EXISTS at that plugin-relative path", () => {
    // A declaration that resolves to nothing is the original bug in a new costume.
    const m = readJson(MANIFEST_REL) as { mcpServers: Record<string, Entry> };
    for (const e of Object.values(m.mcpServers)) {
      expect(fs.existsSync(path.join(PLUGIN_ROOT, e.args?.[0] ?? ""))).toBe(true);
    }
  });

  it("stays minimal otherwise — no skills/hooks keys (they would break git-install discovery)", () => {
    const m = readJson(MANIFEST_REL);
    expect(Object.keys(m).sort()).toEqual(["mcpServers", "name", "version"]);
    // The rendered package points skills at ./.agents/skills/, absent from the repo.
    expect(m["skills"]).toBeUndefined();
    // Codex defaults to root hooks/hooks.json, which is what a git install had.
    expect(m["hooks"]).toBeUndefined();
  });

  it('carries the CANONICAL version verbatim — a missing one makes codex report "local"', () => {
    const canonical = readJson(path.join(".claude-plugin", "plugin.json"))["version"];
    expect(typeof canonical).toBe("string");
    expect(readJson(MANIFEST_REL)["version"]).toBe(canonical);
  });
});

describe("the manifest is GENERATED, and the drift gate is WIRED to it", () => {
  it("equals the renderer's output for the live inventory (no hand-editing)", () => {
    const inv = buildInventory(PLUGIN_ROOT, STAMP) as unknown as { mcp_servers: unknown[] };
    const claude = readJson(path.join(".claude-plugin", "plugin.json"));
    const rendered = renderCodexGitInstallManifest(
      {
        name: claude["name"] as string,
        version: claude["version"] as string,
        description: "d",
        mcpServers: inv.mcp_servers,
      } as never,
      { renderedAt: STAMP } as never
    );
    const committed = readJson(MANIFEST_REL) as { mcpServers: unknown };
    expect(rendered.mcpServers).toEqual(committed.mcpServers);
  });

  // The gate's round-1 finding: the equality test above would still pass if
  // `.codex-plugin/plugin.json` were dropped from CLAUDE_INSTALL_SURFACE_FILES,
  // leaving the file ungated. These cases exercise the CHECKER itself.
  it("RED: a skewed Codex root manifest is reported stale by the install-surface check", () => {
    const abs = path.join(PLUGIN_ROOT, MANIFEST_REL);
    const original = fs.readFileSync(abs);
    try {
      const skewed = JSON.parse(original.toString()) as Record<string, unknown>;
      skewed["version"] = "9.9.9";
      fs.writeFileSync(abs, JSON.stringify(skewed, null, 2) + "\n");
      const check = checkClaudeInstallSurface(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT, STAMP) as never, STAMP);
      expect(check.ok).toBe(false);
      expect(check.stale.map((s) => s.path)).toContain(".codex-plugin/plugin.json");
    } finally {
      fs.writeFileSync(abs, original);
    }
  });

  it("RED: a MISSING Codex root manifest is reported stale too", () => {
    const abs = path.join(PLUGIN_ROOT, MANIFEST_REL);
    const original = fs.readFileSync(abs);
    try {
      fs.rmSync(abs);
      const check = checkClaudeInstallSurface(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT, STAMP) as never, STAMP);
      expect(check.ok).toBe(false);
      expect(check.stale.find((s) => s.path === ".codex-plugin/plugin.json")?.reason).toBe("missing");
    } finally {
      fs.writeFileSync(abs, original);
    }
  });

  it("GREEN: the committed surface is clean as generated", () => {
    const check = checkClaudeInstallSurface(PLUGIN_ROOT, buildInventory(PLUGIN_ROOT, STAMP) as never, STAMP);
    expect(check.stale.map((s) => s.path)).not.toContain(".codex-plugin/plugin.json");
  });
});

describe("the renderer refuses a declaration it cannot make resolvable", () => {
  it("throws on an absolute arg it cannot rebase onto cwd '.'", () => {
    expect(() =>
      renderCodexGitInstallManifest(
        {
          name: "guild",
          version: "1.0.0",
          description: "d",
          mcpServers: [{ id: "x", transport: "stdio", command: "node", args: ["/opt/x/index.js"] }],
        } as never,
        { renderedAt: STAMP } as never
      )
    ).toThrow(/cannot be made plugin-relative/);
  });

  it("strips the ${CLAUDE_PLUGIN_ROOT} prefix rather than passing it through", () => {
    const out = renderCodexGitInstallManifest(
      {
        name: "guild",
        version: "1.0.0",
        description: "d",
        mcpServers: [
          { id: "y", transport: "stdio", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/a/b.js"] },
        ],
      } as never,
      { renderedAt: STAMP } as never
    );
    // The flag rides alongside every declaration (see mcp-project-root-scoping.test.ts
    // for why cwd "." without it is the data-leak configuration).
    expect(out.mcpServers["y"].args).toEqual(["a/b.js", "--no-cwd-fallback"]);
    expect(out.mcpServers["y"].cwd).toBe(".");
  });
});

describe("Claude's contract is untouched", () => {
  it(".mcp.json still uses ${CLAUDE_PLUGIN_ROOT} for both servers", () => {
    const mcp = readJson(".mcp.json") as { mcpServers: Record<string, { args?: string[] }> };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["guild-memory", "guild-telemetry"]);
    for (const n of Object.keys(mcp.mcpServers)) {
      // Claude DOES expand this; the Codex fix must not "fix" Claude's file.
      expect(mcp.mcpServers[n].args?.[0]).toContain("${CLAUDE_PLUGIN_ROOT}");
    }
  });
});

describe("the rendered Codex package is a DIFFERENT case, not the same decision", () => {
  it("renderCodexPluginJson omits mcpServers — safe only because that tree ships no .mcp.json", () => {
    const rendered = renderCodexPluginJson(
      { name: "guild", version: "9.9.9", description: "d" } as never,
      { renderedAt: STAMP } as never
    ) as unknown as Record<string, unknown>;
    expect(rendered["mcpServers"]).toBeUndefined();
    // The asymmetry that makes omission safe there and unsafe here: the repo DOES
    // carry a .mcp.json for Codex to fall back to, so the repo-root manifest must
    // state the map explicitly rather than omit it.
    expect(fs.existsSync(path.join(PLUGIN_ROOT, ".mcp.json"))).toBe(true);
  });
});
