/**
 * scripts/__tests__/per-host-packaging-new-hosts.test.ts
 *
 * P1-L6 — the new-host renderers: renderAgentsPackage (universal AGENTS.md) and
 * renderAntigravityManifest. SC-1 (renders the inventory surfaces), SC-2 (no rendered
 * reference is invented — only inventory skills/commands appear), plus the using-guild
 * bootstrap pointer and the render-or-degrade `_unsupported` records.
 *
 * The full build-emission integration (3 dist trees, gates PASS, L7 libs bundled,
 * guild-run wrappers, 106 skills, using-guild present) is verified live by
 * `npm run build:hosts` (gates PASS) — eval-engineer owns the SC-1/SC-2 build fixtures.
 */

import {
  renderAgentsPackage,
  renderAntigravityManifest,
  type GuildPluginManifest,
} from "../lib/per-host-packaging";
import { renderLauncherScript } from "../lib/guild-run-wrapper";

const RENDERED_AT = "2026-06-15T12:00:00Z";

function manifest(): GuildPluginManifest {
  return {
    name: "guild",
    version: "2.0.0",
    description: "Specialist-team workflow engine.",
    skills: ["./skills/meta/", "./skills/specialists/"],
    commands: ["./commands/guild.md", "./commands/init.md"],
    agents: ["./agents/architect.md"],
    hooks: [{ event: "SessionStart", source_path: "./hooks/hooks.json" } as never],
    mcpServers: [{ id: "guild-memory", transport: "stdio", command: "node" } as never],
  };
}

describe("P1-L6 renderAgentsPackage — universal AGENTS.md", () => {
  const pkg = renderAgentsPackage(manifest(), { renderedAt: RENDERED_AT });

  it("emits an AGENTS.md that bootstraps using-guild + points at the bundled skill tree", () => {
    expect(pkg.schema_version).toBe("agents-package.v1");
    expect(pkg.agents_md).toContain("using-guild");
    expect(pkg.agents_md).toContain(".agents/skills/guild/");
    expect(pkg.agents_md).toContain("guild-run"); // CLI launcher pointer
    expect(pkg.agents_md).toContain(RENDERED_AT); // provenance stamp
  });

  it("exposes the inventory skills + command names (SC-1)", () => {
    expect(pkg.skills).toEqual(["./skills/meta/", "./skills/specialists/"]);
    expect(pkg.commands).toEqual(["guild", "init"]); // command NAMES from paths
  });

  it("degrades agents/hooks/mcp (render-or-degrade) with recorded reasons", () => {
    const fields = (pkg._unsupported ?? []).map((u) => u.field);
    expect(fields).toContain("agents");
    expect(fields).toContain("hooks");
    expect(fields).toContain("mcpServers");
  });
});

describe("P1-L6 renderAntigravityManifest — INFERRED host", () => {
  const m = renderAntigravityManifest(manifest(), { renderedAt: RENDERED_AT });

  it("renders the extension shape + marks the row INFERRED", () => {
    expect(m.schema_version).toBe("antigravity-manifest.v1");
    expect(m._inferred).toBe(true);
    expect(m._source_version).toBe("2.0.0");
    expect(m.commands?.map((c) => c.name)).toEqual(["guild", "init"]);
    expect(m.skills).toEqual(["./skills/meta/", "./skills/specialists/"]);
  });

  it("flags agents/hooks/mcp as unsupported (INFERRED off-box)", () => {
    const fields = (m._unsupported ?? []).map((u) => u.field);
    expect(fields).toContain("agents");
    expect(fields).toContain("hooks");
    expect(fields.some((f) => f.startsWith("mcpServers"))).toBe(true);
  });

  it("a manifest with no agents/hooks/mcp renders no _unsupported", () => {
    const clean = renderAntigravityManifest(
      { name: "g", version: "1.0.0", description: "d", skills: ["./skills/meta/"] },
      { renderedAt: RENDERED_AT }
    );
    expect(clean._unsupported).toBeUndefined();
  });
});

describe("P1-L6 guild-run wrapper path (SC-3)", () => {
  it("renderLauncherScript emits a host-pinned launcher for each new host", () => {
    for (const host of ["agents", "pi", "antigravity"]) {
      const script = renderLauncherScript(host);
      expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
      expect(script).toContain(`--host ${host}`);
      expect(script).toContain("guild-run.ts");
    }
  });
});
