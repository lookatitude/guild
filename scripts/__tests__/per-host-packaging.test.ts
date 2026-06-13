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
 *   renderGeminiToml:
 *     - happy path: produces valid TOML structure with required sections
 *     - commands render as [[commands]] blocks
 *     - MCP stdio + HTTP both rendered (Gemini supports both)
 *     - agents/skills/hooks flagged as UNSUPPORTED comments
 *     - _rendered_at comes from caller opts, not the clock
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
  renderGeminiToml,
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
  it("produces the correct schema_version", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out.schema_version).toBe("codex-plugin.v1");
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

  it("renders commands as CodexCommandEntry descriptors", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    expect(out.commands).toBeDefined();
    expect(out.commands).toHaveLength(4);
    const names = (out.commands ?? []).map((c) => c.name);
    expect(names).toContain("guild");
    expect(names).toContain("init");
    expect(names).toContain("plan");
    expect(names).toContain("build");
  });

  it("each command entry carries the original source_path", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    const guildCmd = (out.commands ?? []).find((c) => c.name === "guild");
    expect(guildCmd?.source_path).toBe("./commands/guild.md");
  });

  it("renders stdio MCP servers in the mcpServers block", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    expect(out.mcpServers).toBeDefined();
    const memSrv = (out.mcpServers ?? []).find((s) => s.id === "guild-memory");
    expect(memSrv).toBeDefined();
    expect(memSrv?.command).toBe("node");
    expect(memSrv?.args).toEqual(["./mcp-servers/guild-memory/index.js"]);
  });

  it("uses caller-supplied _rendered_at, never calls the clock", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out._rendered_at).toBe(FIXED_TS);
  });

  it("records _source_version from the manifest version", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out._source_version).toBe("2.0.0");
  });

  it("produces no _unsupported array for a minimal manifest with no unsupported fields", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out._unsupported).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderCodexPluginJson — render-or-degrade contract
// ---------------------------------------------------------------------------

describe("renderCodexPluginJson — render-or-degrade", () => {
  it("flags HTTP MCP servers in _unsupported (Codex does not support HTTP MCP)", () => {
    const manifest: GuildPluginManifest = {
      ...minimalManifest,
      mcpServers: [{ id: "remote-srv", transport: "http", url: "https://example.com/mcp" }],
    };
    const out = renderCodexPluginJson(manifest, opts);
    expect(out.mcpServers).toBeUndefined();
    expect(out._unsupported).toBeDefined();
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field.includes("remote-srv"))).toBe(true);
    expect(u.some((f) => f.reason.toLowerCase().includes("http"))).toBe(true);
  });

  it("flags agents in _unsupported when agents are present", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field === "agents")).toBe(true);
  });

  it("flags skills in _unsupported when skills are present", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field === "skills")).toBe(true);
  });

  it("flags hooks in _unsupported when hooks are present", () => {
    const out = renderCodexPluginJson(fullManifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field === "hooks")).toBe(true);
  });

  it("flags a stdio MCP server missing a command field in _unsupported", () => {
    const manifest: GuildPluginManifest = {
      ...minimalManifest,
      mcpServers: [{ id: "no-cmd-srv", transport: "stdio" }],
    };
    const out = renderCodexPluginJson(manifest, opts);
    const u = out._unsupported ?? [];
    expect(u.some((f) => f.field.includes("no-cmd-srv"))).toBe(true);
  });

  it("does not silently omit any unsupported field — all flags present together", () => {
    // A manifest with ALL unsupported field types must produce _unsupported entries
    // for all of them (agents + skills + hooks + HTTP MCP).
    const manifest: GuildPluginManifest = {
      ...fullManifest,
      mcpServers: [
        { id: "guild-memory", transport: "stdio", command: "node", args: [] },
        { id: "http-srv", transport: "http", url: "https://example.com/mcp" },
      ],
    };
    const out = renderCodexPluginJson(manifest, opts);
    const u = out._unsupported ?? [];
    const fields = u.map((f) => f.field);
    // All four unsupported categories must be flagged
    expect(fields).toContain("agents");
    expect(fields).toContain("skills");
    expect(fields).toContain("hooks");
    expect(fields.some((f) => f.includes("http-srv"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderCodexPluginJson — edge cases
// ---------------------------------------------------------------------------

describe("renderCodexPluginJson — edge cases", () => {
  it("does not produce an empty commands array for a manifest with no commands", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out.commands).toBeUndefined();
  });

  it("does not produce an empty mcpServers array for a manifest with no servers", () => {
    const out = renderCodexPluginJson(minimalManifest, opts);
    expect(out.mcpServers).toBeUndefined();
  });

  it("is deterministic — same input + same opts always produces byte-identical output", () => {
    const a = JSON.stringify(renderCodexPluginJson(fullManifest, opts));
    const b = JSON.stringify(renderCodexPluginJson(fullManifest, opts));
    expect(a).toBe(b);
  });

  it("two different renderedAt values produce different _rendered_at in output", () => {
    const out1 = renderCodexPluginJson(minimalManifest, { renderedAt: "2026-01-01T00:00:00Z" });
    const out2 = renderCodexPluginJson(minimalManifest, { renderedAt: "2026-06-13T00:00:00Z" });
    expect(out1._rendered_at).not.toBe(out2._rendered_at);
  });
});

// ---------------------------------------------------------------------------
// renderGeminiToml — happy path
// ---------------------------------------------------------------------------

describe("renderGeminiToml — happy path", () => {
  it("produces a string output", () => {
    const out = renderGeminiToml(minimalManifest, opts);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
  });

  it("includes the [extension] section with required fields", () => {
    const out = renderGeminiToml(minimalManifest, opts);
    expect(out).toContain("[extension]");
    expect(out).toContain('name = "guild"');
    expect(out).toContain('version = "2.0.0"');
    expect(out).toContain("description =");
  });

  it("includes optional metadata when present", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain('homepage = "https://guildstack.dev/"');
    expect(out).toContain('repository = "https://github.com/lookatitude/guild"');
    expect(out).toContain('license = "MIT"');
  });

  it("includes keywords as a TOML array", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("keywords = [");
    expect(out).toContain('"agents"');
  });

  it("renders the [extension.author] section when author is present", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("[extension.author]");
    expect(out).toContain('name = "Miguel Pinto"');
    expect(out).toContain('email = "guild@lookatitude.com"');
  });

  it("renders commands as [[commands]] blocks", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("[[commands]]");
    expect(out).toContain('name = "guild"');
    expect(out).toContain('name = "init"');
    expect(out).toContain('name = "plan"');
  });

  it("each command block includes source_path", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain('source_path = "./commands/guild.md"');
  });

  it("renders stdio MCP servers as [[mcp_servers]] blocks", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("[[mcp_servers]]");
    expect(out).toContain('id = "guild-memory"');
    expect(out).toContain('transport = "stdio"');
    expect(out).toContain('command = "node"');
  });

  it("renders HTTP MCP servers (Gemini supports both transports)", () => {
    const manifest: GuildPluginManifest = {
      ...minimalManifest,
      mcpServers: [
        { id: "remote-srv", transport: "http", url: "https://example.com/mcp", description: "Remote" },
      ],
    };
    const out = renderGeminiToml(manifest, opts);
    expect(out).toContain('transport = "http"');
    expect(out).toContain('url = "https://example.com/mcp"');
    expect(out).not.toContain("UNSUPPORTED");
  });

  it("embeds _rendered_at from caller opts", () => {
    const out = renderGeminiToml(minimalManifest, opts);
    expect(out).toContain(`_rendered_at = "${FIXED_TS}"`);
  });

  it("embeds _source_version from the manifest version", () => {
    const out = renderGeminiToml(minimalManifest, opts);
    expect(out).toContain('_source_version = "2.0.0"');
  });
});

// ---------------------------------------------------------------------------
// renderGeminiToml — render-or-degrade
// ---------------------------------------------------------------------------

describe("renderGeminiToml — render-or-degrade", () => {
  it("flags agents as an UNSUPPORTED comment", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("UNSUPPORTED");
    expect(out).toContain("agents");
  });

  it("flags skills as an UNSUPPORTED comment", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("UNSUPPORTED");
    expect(out).toContain("skills");
  });

  it("flags hooks as an UNSUPPORTED comment", () => {
    const out = renderGeminiToml(fullManifest, opts);
    expect(out).toContain("UNSUPPORTED");
    expect(out).toContain("hooks");
  });

  it("does not produce UNSUPPORTED for a minimal manifest with no unsupported fields", () => {
    const out = renderGeminiToml(minimalManifest, opts);
    expect(out).not.toContain("UNSUPPORTED");
  });
});

// ---------------------------------------------------------------------------
// renderGeminiToml — edge cases
// ---------------------------------------------------------------------------

describe("renderGeminiToml — edge cases", () => {
  it("is deterministic — same input + same opts always produces byte-identical output", () => {
    const a = renderGeminiToml(fullManifest, opts);
    const b = renderGeminiToml(fullManifest, opts);
    expect(a).toBe(b);
  });

  it("handles description with double-quotes via TOML escaping", () => {
    const manifest: GuildPluginManifest = {
      name: "guild",
      version: "1.0.0",
      description: 'A plugin with "quotes" in the description.',
    };
    const out = renderGeminiToml(manifest, opts);
    // The output must be valid TOML (quotes escaped) and must contain the escaped form
    expect(out).toContain('\\"quotes\\"');
    // The [extension] block must still be present
    expect(out).toContain("[extension]");
  });

  it("two different renderedAt values produce different TOML output", () => {
    const out1 = renderGeminiToml(minimalManifest, { renderedAt: "2026-01-01T00:00:00Z" });
    const out2 = renderGeminiToml(minimalManifest, { renderedAt: "2026-06-13T00:00:00Z" });
    expect(out1).not.toBe(out2);
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
  it("all three renderers accept the same GuildPluginManifest without throwing", () => {
    expect(() => renderCodexPluginJson(fullManifest, opts)).not.toThrow();
    expect(() => renderGeminiToml(fullManifest, opts)).not.toThrow();
    expect(() => renderPiManifest(fullManifest, opts)).not.toThrow();
  });

  it("all three renderers preserve name, version, description from the source manifest", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);
    const gemini = renderGeminiToml(fullManifest, opts);

    expect(codex.name).toBe(fullManifest.name);
    expect(codex.version).toBe(fullManifest.version);
    expect(pi.name).toBe(fullManifest.name);
    expect(pi.version).toBe(fullManifest.version);
    // TOML output must contain the name and version strings
    expect(gemini).toContain(`"${fullManifest.name}"`);
    expect(gemini).toContain(`"${fullManifest.version}"`);
  });

  it("all three renderers flag unsupported fields — none silently omit", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);
    const gemini = renderGeminiToml(fullManifest, opts);

    // Codex: agents + skills + hooks flagged
    expect(codex._unsupported?.some((f) => f.field === "agents")).toBe(true);
    // Pi: agents + hooks + MCP flagged
    expect(pi._unsupported?.some((f) => f.field === "agents")).toBe(true);
    // Gemini: UNSUPPORTED comment block present for agents/skills/hooks
    expect(gemini).toContain("UNSUPPORTED");
  });

  it("_rendered_at is consistent across all three renderers for the same opts", () => {
    const codex = renderCodexPluginJson(fullManifest, opts);
    const pi = renderPiManifest(fullManifest, opts);
    const gemini = renderGeminiToml(fullManifest, opts);

    expect(codex._rendered_at).toBe(FIXED_TS);
    expect(pi._rendered_at).toBe(FIXED_TS);
    expect(gemini).toContain(`_rendered_at = "${FIXED_TS}"`);
  });
});
