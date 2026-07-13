import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  classifyMemoryPath,
  discoverGuild,
  isCanonicalGuildMemoryPath,
  workspaceReadThroughSources,
} from "../lib/guild-discovery";
import { queryGuildMemory, selectMemoryTransport } from "../lib/memory-adapter";
import {
  assertProjectCreatedArtifactPath,
  resolveGuildArtifactPath,
} from "../lib/guild-artifact-paths";
import { collectBenchmarkGuildArtifacts } from "../lib/benchmark-guild-artifacts";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-r6-"));
}

function touch(file: string, text = ""): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function seedWorkspace(root: string, entries: Array<{ name: string; hasWiki?: boolean; hasIndexes?: boolean }>): void {
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  const sub_guilds = entries.map((entry) => {
    const child = path.join(root, entry.name);
    fs.mkdirSync(path.join(child, ".git"), { recursive: true });
    fs.mkdirSync(path.join(child, ".guild"), { recursive: true });
    if (entry.hasWiki) touch(path.join(child, ".guild", "wiki", "decisions", "child.md"), "# Child\n\nfederated auth knowledge");
    if (entry.hasIndexes) fs.mkdirSync(path.join(child, ".guild", "indexes"), { recursive: true });
    touch(path.join(child, "AGENTS.md"), `# ${entry.name} agents\n`);
    return {
      name: entry.name,
      path: entry.name,
      kind: "sub-guild",
      remote: null,
      has_wiki: Boolean(entry.hasWiki),
      has_indexes: Boolean(entry.hasIndexes),
      last_seen_commit: null,
    };
  });
  touch(path.join(root, ".guild", "workspace.json"), JSON.stringify({
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    sub_guilds,
  }, null, 2));
}

describe("R6 Guild discovery and two-level federation", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const root = () => {
    const dir = mkTmp();
    tmpDirs.push(dir);
    return dir;
  };

  it("resolves a workspace root and canonical .guild memory paths", () => {
    const ws = root();
    seedWorkspace(ws, [{ name: "plugin", hasWiki: true, hasIndexes: true }]);
    const d = discoverGuild(ws);
    expect(d.level).toBe("workspace");
    expect(d.activeRoot).toBe(ws);
    expect(d.workspaceRoot).toBe(ws);
    expect(d.federationDepth).toBe(0);
    expect(d.canonicalMemory.wiki).toBe(path.join(ws, ".guild", "wiki"));
    expect(d.canonicalMemory.raw).toBe(path.join(ws, ".guild", "raw"));
    expect(d.canonicalMemory.indexes).toBe(path.join(ws, ".guild", "indexes"));
    expect(d.canonicalMemory.indexSqlite).toBe(path.join(ws, ".guild", "index.sqlite"));
  });

  it("resolves cwd drift inside an immediate sub-project back to that project root", () => {
    const ws = root();
    seedWorkspace(ws, [{ name: "plugin", hasWiki: true }]);
    const nested = path.join(ws, "plugin", "src", "deep");
    fs.mkdirSync(nested, { recursive: true });
    const d = discoverGuild(nested);
    expect(d.level).toBe("project");
    expect(d.activeRoot).toBe(path.join(ws, "plugin"));
    expect(d.workspaceRoot).toBe(ws);
    expect(d.registeredName).toBe("plugin");
    expect(d.federationDepth).toBe(1);
  });

  it("federation read-through lists immediate child AGENTS.md and .guild paths without copying files", () => {
    const ws = root();
    seedWorkspace(ws, [
      { name: "plugin", hasWiki: true, hasIndexes: true },
      { name: "benchmark", hasWiki: false },
    ]);
    const before = fs.readdirSync(path.join(ws, ".guild")).sort();
    const sources = workspaceReadThroughSources(ws);
    const after = fs.readdirSync(path.join(ws, ".guild")).sort();
    expect(after).toEqual(before);
    expect(sources.map((s) => s.name).sort()).toEqual(["benchmark", "plugin"]);
    const plugin = sources.find((s) => s.name === "plugin");
    expect(plugin?.sourceTag).toBe("sub_guild:plugin");
    expect(plugin?.agentsPath).toBe(path.join(ws, "plugin", "AGENTS.md"));
    expect(plugin?.wikiDir).toBe(path.join(ws, "plugin", ".guild", "wiki"));
    const benchmark = sources.find((s) => s.name === "benchmark");
    expect(benchmark?.wikiDir).toBeNull();
  });

  it("does not recurse into grandchildren for workspace read-through", () => {
    const ws = root();
    seedWorkspace(ws, [{ name: "plugin", hasWiki: true }]);
    fs.mkdirSync(path.join(ws, "plugin", "nested", ".git"), { recursive: true });
    fs.mkdirSync(path.join(ws, "plugin", "nested", ".guild", "wiki"), { recursive: true });
    const sources = workspaceReadThroughSources(ws);
    expect(sources.map((s) => s.name)).toEqual(["plugin"]);
    expect(sources.some((s) => s.childRoot.includes("nested"))).toBe(false);
  });

  it("ignores non-root .guild detritus below a registered sub-project repo", () => {
    const ws = root();
    seedWorkspace(ws, [{ name: "plugin", hasWiki: true }]);
    const plugin = path.join(ws, "plugin");
    fs.mkdirSync(path.join(plugin, "scripts", ".guild", "runs"), { recursive: true });
    const nested = path.join(plugin, "scripts", "lib");
    fs.mkdirSync(nested, { recursive: true });
    const d = discoverGuild(nested);
    expect(d.activeRoot).toBe(plugin);
    expect(d.level).toBe("project");
    expect(d.workspaceRoot).toBe(ws);
    expect(d.registeredName).toBe("plugin");
    expect(workspaceReadThroughSources(plugin)).toEqual([]);
  });

  it("honors workspace.mode overrides for active root level classification", () => {
    const forcedOff = root();
    seedWorkspace(forcedOff, [{ name: "plugin", hasWiki: true }]);
    touch(path.join(forcedOff, ".guild", "settings.json"), JSON.stringify({ workspace: { mode: "off" } }));
    expect(discoverGuild(forcedOff).level).toBe("project");

    const forcedOn = root();
    fs.mkdirSync(path.join(forcedOn, ".git"), { recursive: true });
    touch(path.join(forcedOn, ".guild", "settings.json"), JSON.stringify({ workspace: { mode: "on" } }));
    expect(discoverGuild(forcedOn).level).toBe("workspace");
  });
});

describe("R6 MemoryAdapter and canonical memory boundaries", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const repo = () => {
    const dir = mkTmp();
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    touch(path.join(dir, ".guild", "wiki", "decisions", "auth.md"), "# Auth\n\nauthentication adapter memory");
    touch(path.join(dir, ".guild", "raw", "sources", "src", "metadata.json"), "{}");
    fs.mkdirSync(path.join(dir, ".guild", "indexes"), { recursive: true });
    touch(path.join(dir, ".guild", "index.sqlite"), "");
    return dir;
  };

  it("selects MCP, HTTP MCP, bridge, then filesystem/BM25 by capability", () => {
    expect(selectMemoryTransport({ mcp: true, httpMcp: true })).toBe("mcp");
    expect(selectMemoryTransport({ httpMcp: true, bridgePackage: true })).toBe("http-mcp");
    expect(selectMemoryTransport({ bridgePackage: true })).toBe("bridge-package");
    expect(selectMemoryTransport({})).toBe("filesystem-bm25");
  });

  it("uses native MCP/HTTP/bridge payloads when supplied", () => {
    const cwd = repo();
    const mcp = queryGuildMemory({
      cwd,
      query: "auth",
      capabilities: { mcp: true },
      runtime: { mcp: () => ({ results: [{ path: "mcp" }] }) },
    });
    expect(mcp.transport).toBe("mcp");
    expect(mcp.degraded).toBe(false);
    const http = queryGuildMemory({
      cwd,
      query: "auth",
      capabilities: { httpMcp: true },
      runtime: { httpMcp: () => ({ results: [{ path: "http" }] }) },
    });
    expect(http.transport).toBe("http-mcp");
    const bridge = queryGuildMemory({
      cwd,
      query: "auth",
      capabilities: { bridgePackage: true },
      runtime: { bridgePackage: () => ({ results: [{ path: "bridge" }] }) },
    });
    expect(bridge.transport).toBe("bridge-package");
  });

  it("falls back to filesystem/BM25 with a degraded receipt when MCP transport is unavailable", () => {
    const cwd = repo();
    const receipt = queryGuildMemory({
      cwd,
      query: "authentication adapter",
      capabilities: { mcp: true },
      limit: 3,
    });
    expect(receipt.transport).toBe("filesystem-bm25");
    expect(receipt.degraded).toBe(true);
    expect(receipt.degradation_reason).toContain("mcp unavailable");
    expect(receipt.payload.recall?.source).toBe("file-bm25");
    expect(receipt.active_root).toBe(cwd);
  });

  it("treats undefined native transport output as unavailable and records fallback", () => {
    const cwd = repo();
    const receipt = queryGuildMemory({
      cwd,
      query: "authentication adapter",
      capabilities: { httpMcp: true },
      runtime: { httpMcp: () => undefined },
    });
    expect(receipt.transport).toBe("filesystem-bm25");
    expect(receipt.degraded).toBe(true);
    expect(receipt.degradation_reason).toContain("http-mcp unavailable");
  });

  it("accepts only .guild wiki/raw/indexes/index.sqlite as canonical Guild memory", () => {
    const cwd = repo();
    expect(isCanonicalGuildMemoryPath(path.join(cwd, ".guild", "wiki", "decisions", "auth.md"), cwd)).toBe(true);
    expect(isCanonicalGuildMemoryPath(path.join(cwd, ".guild", "raw", "sources", "src", "metadata.json"), cwd)).toBe(true);
    expect(isCanonicalGuildMemoryPath(path.join(cwd, ".guild", "indexes", "knowledge-graph.json"), cwd)).toBe(true);
    expect(isCanonicalGuildMemoryPath(path.join(cwd, ".guild", "index.sqlite"), cwd)).toBe(true);
    expect(classifyMemoryPath(path.join(cwd, "MEMORY.md"), cwd)).toBe("host-global");
    expect(classifyMemoryPath(path.join(os.homedir(), ".codex", "memory.md"), cwd)).toBe("host-global");
    expect(classifyMemoryPath(path.join(cwd, "notes.md"), cwd)).toBe("outside-guild");
  });
});

describe("R6 .guild write locations and benchmark artifact fixture", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const repo = () => {
    const dir = mkTmp();
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    return dir;
  };

  it("resolves wiki-ingest, decisions, agents, skills, and tools under active .guild", () => {
    const cwd = repo();
    expect(resolveGuildArtifactPath({ cwd, kind: "wiki-ingest", category: "concepts", slug: "auth-model" }))
      .toBe(path.join(cwd, ".guild", "wiki", "concepts", "auth-model.md"));
    expect(resolveGuildArtifactPath({ cwd, kind: "decision", slug: "use-bm25" }))
      .toBe(path.join(cwd, ".guild", "wiki", "decisions", "use-bm25.md"));
    expect(resolveGuildArtifactPath({ cwd, kind: "agent", slug: "qa" }))
      .toBe(path.join(cwd, ".guild", "agents", "qa.md"));
    expect(resolveGuildArtifactPath({ cwd, kind: "skill", slug: "review" }))
      .toBe(path.join(cwd, ".guild", "skills", "review", "SKILL.md"));
    expect(resolveGuildArtifactPath({ cwd, kind: "tool", slug: "search" }))
      .toBe(path.join(cwd, ".guild", "tools", "search.json"));
  });

  it("rejects project-created artifacts outside active .guild or under a plugin INSTALL dir (no .git)", () => {
    const cwd = repo();
    // A true install cache has NO .git — that is the R6 rejection case.
    const pluginInstall = path.join(cwd, "plugin-install");
    fs.mkdirSync(pluginInstall, { recursive: true });
    expect(() => assertProjectCreatedArtifactPath(path.join(cwd, "AGENTS.md"), cwd)).toThrow(/active \.guild/);
    expect(() => resolveGuildArtifactPath({ cwd: pluginInstall, kind: "agent", slug: "x", pluginInstallRoot: pluginInstall }))
      .toThrow(/plugin install dir/);
  });

  it("ALLOWS a plugin SOURCE CHECKOUT (has .git) to write its own .guild (self-build exemption)", () => {
    const cwd = repo();
    const sourceCheckout = path.join(cwd, "plugin-src");
    fs.mkdirSync(path.join(sourceCheckout, ".git"), { recursive: true });
    // Self-build: the plugin repo is simultaneously the consuming project.
    expect(resolveGuildArtifactPath({ cwd: sourceCheckout, kind: "agent", slug: "x", pluginInstallRoot: sourceCheckout }))
      .toBe(path.join(sourceCheckout, ".guild", "agents", "x.md"));
  });

  it("uses plugin install env vars as a default rejection boundary", () => {
    const cwd = repo();
    const pluginInstall = path.join(cwd, "plugin-install-env");
    fs.mkdirSync(pluginInstall, { recursive: true }); // install cache: no .git
    const old = process.env["GUILD_PLUGIN_ROOT"];
    process.env["GUILD_PLUGIN_ROOT"] = pluginInstall;
    try {
      expect(() => resolveGuildArtifactPath({ cwd: pluginInstall, kind: "skill", slug: "x" }))
        .toThrow(/plugin install dir/);
    } finally {
      if (old === undefined) delete process.env["GUILD_PLUGIN_ROOT"];
      else process.env["GUILD_PLUGIN_ROOT"] = old;
    }
  });

  it("collects a host-neutral benchmark .guild artifact set and excludes unsanitized runs", () => {
    const cwd = repo();
    touch(path.join(cwd, ".guild", "agents", "qa.md"), "# QA");
    touch(path.join(cwd, ".guild", "skills", "review", "SKILL.md"), "# Review");
    touch(path.join(cwd, ".guild", "tools", "search.json"), "{}");
    touch(path.join(cwd, ".guild", "wiki", "decisions", "auth.md"), "# Auth");
    touch(path.join(cwd, ".guild", "initiatives", "active", "r6", "summary.md"), "# R6");
    touch(path.join(cwd, ".guild", "runs", "sanitized", "run.yaml"), "id: sanitized\nprivacy:\n  sanitized: true\n");
    touch(path.join(cwd, ".guild", "runs", "raw", "run.yaml"), "id: raw\nprivacy:\n  sanitized: false\n");
    const artifacts = collectBenchmarkGuildArtifacts(cwd);
    expect(artifacts.map((a) => [a.kind, a.path])).toEqual([
      ["agent", ".guild/agents/qa.md"],
      ["initiative", ".guild/initiatives/active/r6/summary.md"],
      ["sanitized-run-stub", ".guild/runs/sanitized/run.yaml"],
      ["skill", ".guild/skills/review/SKILL.md"],
      ["tool", ".guild/tools/search.json"],
      ["wiki", ".guild/wiki/decisions/auth.md"],
    ]);
    expect(artifacts.every((a) => a.sanitized)).toBe(true);
    expect(artifacts.some((a) => a.path.includes("/raw/"))).toBe(false);
  });
});
