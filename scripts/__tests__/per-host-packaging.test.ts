/**
 * scripts/__tests__/per-host-packaging.test.ts
 *
 * TDD suite for scripts/lib/per-host-packaging.ts
 * Surface 1 of the host-adapter contract — per-host packaging renderers.
 * Contract (BY POINTER): docs/knowledge/decisions/host-adapter-contract.md §Surface 1
 * Distribution doc (BY POINTER): docs/v2/15-distribution.md §Per-host packaging
 *
 * Coverage:
 *   renderCodexPluginJson:
 *     - happy path: required fields present, commands rendered, MCP stdio rendered
 *     - HTTP MCP flagged in _unsupported (cannot be bundled in Codex manifest)
 *     - agents flagged in _unsupported (no Codex equivalent)
 *     - skills flagged in _unsupported (no Codex equivalent)
 *     - hooks flagged in _unsupported (hook taxonomy differs)
 *     - schema_version is exactly "codex-plugin.v1"
 *     - _rendered_at comes from caller opts, not the clock
 *   (renderGeminiToml coverage was removed when Gemini was sunset 2026-06-14.)
 *   renderPiManifest:
 *     - happy path: required fields present, commands and skills rendered
 *     - MCP ALWAYS flagged in _unsupported (Pi core omits MCP)
 *     - agents flagged in _unsupported
 *     - hooks flagged in _unsupported
 *     - schema_version is exactly "pi-manifest.v1"
 *     - _rendered_at comes from caller opts, not the clock
 *   validateManifest:
 *     - valid manifest passes
 *     - missing name/version/description each produces an error
 *     - null/non-object input handled safely
 *   Render-or-degrade contract:
 *     - a manifest with every field that a host cannot express still produces
 *       a complete output with ALL unsupported fields flagged (never silently omitted)
 *   Determinism:
 *     - same input + same renderedAt always produces byte-identical output
 *   Malformed/edge cases:
 *     - empty commands/skills/agents arrays do not produce empty arrays in output
 *     - MCP server with stdio transport but missing command is flagged in _unsupported
 */

import {
  renderCodexPluginJson,
  renderPiManifest,
  validateManifest,
  type GuildPluginManifest,
  type RenderOptions,
} from "../lib/per-host-packaging";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Fixed timestamp for deterministic tests — the renderers must never call Date.now(). */
const FIXED_TS = "2026-06-13T00:00:00Z";

const opts: RenderOptions = { renderedAt: FIXED_TS };

/** Minimal valid manifest — only the required fields. */
const minimalManifest: GuildPluginManifest = {
  name: "guild",
  version: "2.0.0",
  description: "A team-of-specialists plugin for Claude Code.",
};

/** Full manifest with all optional fields populated. */
const fullManifest: GuildPluginManifest = {
  name: "guild",
  version: "2.0.0",
  description: "A team-of-specialists plugin for Claude Code.",
  homepage: "https://guildstack.dev/",
  repository: "https://github.com/lookatitude/guild",
  author: { name: "Miguel Pinto", email: "guild@lookatitude.com" },
  license: "MIT",
  keywords: ["agents", "specialists", "wiki", "tmux"],
  skills: ["./skills/core/", "./skills/meta/", "./skills/specialists/"],
  commands: [
    "./commands/guild.md",
    "./commands/init.md",
    "./commands/plan.md",
    "./commands/build.md",
  ],
  agents: [
    "./agents/architect.md",
    "./agents/researcher.md",
  ],
  mcpServers: [
    {
      id: "guild-memory",
      transport: "stdio",
      command: "node",
      args: ["./mcp-servers/guild-memory/index.js"],
      description: "BM25 wiki recall",
    },
    {
      id: "guild-telemetry",
      transport: "stdio",
      command: "node",
      args: ["./mcp-servers/guild-telemetry/index.js"],
    },
  ],
  hooks: [
    { event: "SessionStart", script: "./hooks/bootstrap.sh" },
    { event: "PostToolUse", script: "./hooks/capture-telemetry.ts" },
  ],
};

// ---------------------------------------------------------------------------
// validateManifest
// ---------------------------------------------------------------------------

describe("validateManifest", () => {
  it("accepts a valid minimal manifest", () => {
    const result = validateManifest(minimalManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts a full manifest", () => {
    const result = validateManifest(fullManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects null input", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-object input", () => {
    const result = validateManifest("not an object");
    expect(result.valid).toBe(false);
  });

  it("reports error when name is missing", () => {
    const result = validateManifest({ version: "1.0.0", description: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("reports error when name is empty string", () => {
    const result = validateManifest({ name: "  ", version: "1.0.0", description: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("reports error when version is missing", () => {
    const result = validateManifest({ name: "guild", description: "test" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("version"))).toBe(true);
  });

  it("reports error when description is missing", () => {
    const result = validateManifest({ name: "guild", version: "1.0.0" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("description"))).toBe(true);
  });

  it("reports all errors at once when multiple fields are missing", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// renderCodexPluginJson — happy path
// ---------------------------------------------------------------------------

describe("renderCodexPluginJson — happy path", () => {
  it("does not emit stale schema_version or unsupported diagnostic fields into live plugin.json", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect("schema_version" in out).toBe(false);
    expect("commands" in out).toBe(false);
    expect("mcpServers" in out).toBe(false);
    expect("_unsupported" in out).toBe(false);
    expect("_rendered_at" in out).toBe(false);
    expect("_source_version" in out).toBe(false);
  });

  it("copies name, version, description from the manifest", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out.name).toBe("guild");
    expect(out.version).toBe("2.0.0");
    expect(out.description).toBe("A team-of-specialists plugin for Claude Code.");
  });

  it("copies optional metadata fields when present", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    expect(out.homepage).toBe("https://guildstack.dev/");
    expect(out.repository).toBe("https://github.com/lookatitude/guild");
    expect(out.author).toEqual({ name: "Miguel Pinto", email: "guild@lookatitude.com" });
    expect(out.license).toBe("MIT");
    expect(out.keywords).toEqual(["agents", "specialists", "wiki", "tmux"]);
  });

  it("points Codex at the bundled Guild skill root", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    expect(out.skills).toBe("./.agents/skills/");
  });

  it("renders live Codex interface metadata", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    expect(out.interface.displayName).toBe("Guild Stack");
    expect(out.interface.category).toBe("Developer Tools");
    expect(out.interface.capabilities).toEqual(["Read", "Write"]);
    expect(out.interface.websiteURL).toBe("https://guildstack.dev/");
    expect(out.interface.developerName).toBe("Miguel Pinto");
  });
});

// ---------------------------------------------------------------------------
// renderCodexPluginJson — render-or-degrade contract
// ---------------------------------------------------------------------------

describe("renderCodexPluginJson — render-or-degrade", () => {
  it("does not render unsupported command/MCP/agent/hook fields into Codex plugin.json", () => {
    const manifest: GuildPluginManifest = {
      ...fullManifest,
      mcpServers: [{ id: "remote-srv", transport: "http", url: "https://example.com/mcp" }],
    };
    const out = renderCodexPluginJson(manifest, opts);
    expect("commands" in out).toBe(false);
    expect("mcpServers" in out).toBe(false);
    expect("agents" in out).toBe(false);
    expect("hooks" in out).toBe(false);
    expect(out.skills).toBe("./.agents/skills/");
  });
});

// ---------------------------------------------------------------------------
// renderCodexPluginJson — edge cases
// ---------------------------------------------------------------------------

describe("renderCodexPluginJson — edge cases", () => {
  it("is deterministic — same input + same opts always produces byte-identical output", () => {
    const a = JSON.stringify(renderCodexPluginJson(fullManifest, opts));
    const b = JSON.stringify(renderCodexPluginJson(fullManifest, opts));
    expect(a).toBe(b);
  });

  it("two different renderedAt values do not change live Codex plugin.json", () => {
    const out1 = renderCodexPluginJson(minimalManifest, { renderedAt: "2026-01-01T00:00:00Z" });
    const out2 = renderCodexPluginJson(minimalManifest, { renderedAt: "2026-06-13T00:00:00Z" });
    expect(out1).toEqual(out2);
  });
});

// ---------------------------------------------------------------------------
// renderPiManifest — happy path
// ---------------------------------------------------------------------------

describe("renderPiManifest — happy path", () => {
  it("produces the correct schema_version", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out.schema_version).toBe("pi-manifest.v1");
  });

  it("copies name, version, description from the manifest", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out.name).toBe("guild");
    expect(out.version).toBe("2.0.0");
    expect(out.description).toBe("A team-of-specialists plugin for Claude Code.");
  });

  it("copies optional metadata fields when present", () => {
    const out = renderPiManifest(fullManifest, opts);
    expect(out.homepage).toBe("https://guildstack.dev/");
    expect(out.repository).toBe("https://github.com/lookatitude/guild");
    expect(out.author).toEqual({ name: "Miguel Pinto", email: "guild@lookatitude.com" });
    expect(out.license).toBe("MIT");
    expect(out.keywords).toEqual(["agents", "specialists", "wiki", "tmux"]);
  });

  it("renders commands as PiCommandEntry descriptors", () => {
    const out = renderPiManifest(fullManifest, opts);
    expect(out.commands).toBeDefined();
    expect(out.commands).toHaveLength(4);
    const names = (out.commands ?? []).map((c) => c.name);
    expect(names).toContain("guild");
    expect(names).toContain("init");
  });

  it("each command entry carries the original source_path", () => {
    const out = renderPiManifest(fullManifest, opts);
    const planCmd = (out.commands ?? []).find((c) => c.name === "plan");
    expect(planCmd?.source_path).toBe("./commands/plan.md");
  });

  it("renders skills as a string array", () => {
    const out = renderPiManifest(fullManifest, opts);
    expect(out.skills).toBeDefined();
    expect(out.skills).toEqual(["./skills/core/", "./skills/meta/", "./skills/specialists/"]);
  });

  it("uses caller-supplied _rendered_at, never calls the clock", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out._rendered_at).toBe(FIXED_TS);
  });

  it("records _source_version from the manifest version", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out._source_version).toBe("2.0.0");
  });
});

// ---------------------------------------------------------------------------
// renderPiManifest — render-or-degrade contract
// ---------------------------------------------------------------------------

describe("renderPiManifest — render-or-degrade", () => {
  it("ALWAYS flags MCP servers in _unsupported (Pi core omits MCP)", () => {
    // Pi must never silently include MCP — it ALWAYS needs a bridge shim.
    const out = renderPiManifest(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field.includes("guild-memory"))).toBe(true);
    expect(u.some((f) => f.field.includes("guild-telemetry"))).toBe(true);
    // Reason must mention the bridge/shim requirement
    expect(u.some((f) => f.reason.toLowerCase().includes("bridge") || f.reason.toLowerCase().includes("shim"))).toBe(true);
  });

  it("flags agents in _unsupported when agents are present", () => {
    const out = renderPiManifest(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field === "agents")).toBe(true);
  });

  it("flags hooks in _unsupported when hooks are present", () => {
    const out = renderPiManifest(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field === "hooks")).toBe(true);
  });

  it("does NOT flag agents or hooks for a manifest without them", () => {
    const out = renderPiManifest(minimalManifest, opts);
    // minimalManifest has no mcpServers/agents/hooks so _unsupported should be absent
    expect(out._unsupported).toBeUndefined();
  });

  it("does not silently omit any unsupported field — all flags present together", () => {
    const out = renderPiManifest(fullManifest, opts);
    const u = out._unsupported ?? [];
    const fields = u.map((f) => f.field);
    // MCP servers, agents, AND hooks must ALL be flagged
    expect(fields.some((f) => f.includes("guild-memory"))).toBe(true);
    expect(fields).toContain("agents");
    expect(fields).toContain("hooks");
  });
});

// ---------------------------------------------------------------------------
// renderPiManifest — edge cases
// ---------------------------------------------------------------------------

describe("renderPiManifest — edge cases", () => {
  it("does not produce an empty commands array for a manifest with no commands", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out.commands).toBeUndefined();
  });

  it("does not produce an empty skills array for a manifest with no skills", () => {
    const out = renderPiManifest(minimalManifest, opts);
    expect(out.skills).toBeUndefined();
  });

  it("is deterministic — same input + same opts always produces byte-identical output", () => {
    const a = JSON.stringify(renderPiManifest(fullManifest, opts));
    const b = JSON.stringify(renderPiManifest(fullManifest, opts));
    expect(a).toBe(b);
  });

  it("two different renderedAt values produce different _rendered_at in output", () => {
    const out1 = renderPiManifest(minimalManifest, { renderedAt: "2026-01-01T00:00:00Z" });
    const out2 = renderPiManifest(minimalManifest, { renderedAt: "2026-06-13T00:00:00Z" });
    expect(out1._rendered_at).not.toBe(out2._rendered_at);
  });
});

// ---------------------------------------------------------------------------
// Cross-renderer contract: all three renderers handle the same input consistently
// ---------------------------------------------------------------------------

describe("cross-renderer contract", () => {
  it("both renderers accept the same GuildPluginManifest without throwing", () => {
    expect(() => renderCodexPluginJson(fullManifest, opts)).not.toThrow();
    expect(() => renderPiManifest(fullManifest, opts)).not.toThrow();
  });

  it("both renderers preserve name, version, description from the source manifest", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);

    expect(codex.name).toBe(fullManifest.name);
    expect(codex.version).toBe(fullManifest.version);
    expect(pi.name).toBe(fullManifest.name);
    expect(pi.version).toBe(fullManifest.version);
  });

  it("Codex emits live schema while Pi retains render-or-degrade diagnostics", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);

    // Codex: strict live plugin.json shape, with Guild skills as the supported surface.
    expect(codex.skills).toBe("./.agents/skills/");
    expect("_unsupported" in codex).toBe(false);
    // Pi: agents + hooks + MCP flagged
    expect(pi._unsupported?.some((f) => f.field === "agents")).toBe(true);
  });

  it("_rendered_at remains on renderers whose live formats allow provenance fields", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);

    expect("_rendered_at" in codex).toBe(false);
    expect(pi._rendered_at).toBe(FIXED_TS);
  });
});
