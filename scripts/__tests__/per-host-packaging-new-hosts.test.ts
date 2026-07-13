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
  type NewHostRenderSpec,
} from "../lib/per-host-packaging";
import { renderLauncherScript } from "../lib/guild-run-wrapper";

const RENDERED_AT = "2026-06-15T12:00:00Z";
/** Matches exposeGuildSkillTree's actual on-disk skill-tree root for these packages. */
const AGENTS_SKILL_ROOT = ".agents/skills/guild";
const antigravitySpec: NewHostRenderSpec = { agentsSkillRoot: AGENTS_SKILL_ROOT, provenance: "verified" };

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
  const pkg = renderAgentsPackage(manifest(), { renderedAt: RENDERED_AT }, AGENTS_SKILL_ROOT);

  it("emits an AGENTS.md that bootstraps using-guild + points at the bundled skill tree", () => {
    expect(pkg.schema_version).toBe("agents-package.v1");
    expect(pkg.agents_md).toContain("using-guild");
    expect(pkg.agents_md).toContain(".agents/skills/guild/");
    expect(pkg.agents_md).toContain("guild-run"); // CLI launcher pointer
    expect(pkg.agents_md).toContain(RENDERED_AT); // provenance stamp
  });

  it("points the using-guild bootstrap at SKILL.src.md — the ONLY file that ships for that skill", () => {
    // Audit fix: this used to say SKILL.md, but using-guild deliberately ships only
    // SKILL.src.md (it's injected via a SessionStart hook on Claude Code instead of
    // being loaded through the native skill mechanism) — the old text was a dangling
    // pointer for every AGENTS.md-consuming host.
    expect(pkg.agents_md).toContain(".agents/skills/guild/meta/using-guild/SKILL.src.md");
    expect(pkg.agents_md).not.toContain(".agents/skills/guild/meta/using-guild/SKILL.md");
  });

  it("exposes command names (SC-1) and skills remapped under the package's skill-tree root", () => {
    // The neutral manifest's `./skills/<tier>/` is Claude-shaped; AGENTS.md packages
    // expose skills under agentsSkillRoot instead (same audit fix as Pi/Antigravity).
    expect(pkg.skills).toEqual([".agents/skills/guild/meta/", ".agents/skills/guild/specialists/"]);
    expect(pkg.commands).toEqual(["guild", "init"]); // command NAMES from paths
  });

  it("degrades agents/hooks/mcp (render-or-degrade) with recorded reasons", () => {
    const fields = (pkg._unsupported ?? []).map((u) => u.field);
    expect(fields).toContain("agents");
    expect(fields).toContain("hooks");
    expect(fields).toContain("mcpServers");
  });
});

describe("P1-L6 renderAntigravityManifest — verified target host", () => {
  const m = renderAntigravityManifest(manifest(), { renderedAt: RENDERED_AT }, antigravitySpec);

  it("renders the extension shape + records verified provenance derived from the spec", () => {
    expect(m.schema_version).toBe("antigravity-manifest.v1");
    expect(m._provenance).toBe("verified");
    expect(m._source_version).toBe("2.0.0");
    expect(m.commands?.map((c) => c.name)).toEqual(["guild", "init"]);
    expect(m.skills).toEqual([".agents/skills/guild/meta/", ".agents/skills/guild/specialists/"]);
  });

  it("derives _provenance from spec.provenance rather than a hardcoded literal (audit fix)", () => {
    const inferred = renderAntigravityManifest(manifest(), { renderedAt: RENDERED_AT }, {
      agentsSkillRoot: AGENTS_SKILL_ROOT,
      provenance: "inferred",
    });
    expect(inferred._provenance).toBe("inferred");
  });

  it("commands omit source_path — commands/*.md never ships in an Antigravity package (audit fix)", () => {
    const cmd = (m.commands ?? []).find((c) => c.name === "guild");
    expect(cmd?.source_path).toBeUndefined();
    const fields = (m._unsupported ?? []).map((u) => u.field);
    expect(fields).toContain("commands[].source_path");
  });

  it("flags agents/hooks/mcp as unsupported in the CLI package surface", () => {
    const fields = (m._unsupported ?? []).map((u) => u.field);
    expect(fields).toContain("agents");
    expect(fields).toContain("hooks");
    expect(fields.some((f) => f.startsWith("mcpServers"))).toBe(true);
  });

  it("a manifest with no agents/hooks/mcp/commands renders no _unsupported", () => {
    const clean = renderAntigravityManifest(
      { name: "g", version: "1.0.0", description: "d", skills: ["./skills/meta/"] },
      { renderedAt: RENDERED_AT },
      antigravitySpec
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
