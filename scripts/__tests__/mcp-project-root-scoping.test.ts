/**
 * scripts/__tests__/mcp-project-root-scoping.test.ts
 *
 * MCP DATA-ROOT SCOPING ACROSS HOSTS (issue #114, gate round 2).
 *
 * THE DEFECT THIS PINS. A Codex plugin install must declare `cwd: "."` for Codex
 * to resolve the server path at all (measured: `${CLAUDE_PLUGIN_ROOT}`-prefixed,
 * bare-relative and `./`-relative args all fail to start; only an absolute path
 * works, and that cannot be published from a version-keyed cache root). But that
 * cwd is the PLUGIN payload root, and Codex hands the child a scrubbed env —
 * measured with a probe server: `cwd = ~/.codex/plugins/cache/guild/guild/<v>`
 * and NO PWD / CODEX_* / workspace variable of any kind.
 *
 * So `process.cwd()` resolved to Guild's OWN bundled `.guild/` inside the install
 * cache. Confirmed live before this fix: `wiki_list {}` reported
 * `wiki_root = ~/.codex/plugins/cache/guild/guild/2.4.0/.guild/wiki`. That is not
 * merely a wrong answer — guild-memory would serve Guild's self-build knowledge to
 * any consumer, and guild-telemetry would expose Guild's own runs as theirs.
 *
 * WHY A FLAG AND NOT DETECTION. The pathological case is path-IDENTICAL to a
 * legitimate one: a Guild developer working in the guild checkout also has
 * cwd == plugin root, and there the repo's own wiki is exactly what they want.
 * No path inspection can separate them, and there is no host env signal. The host
 * that KNOWS its launch cwd is not the project declares it: the generated Codex
 * manifest emits `--no-cwd-fallback` alongside `cwd: "."`. The two are one unit.
 *
 * A prior round of this fix was accepted on a FALSE ORACLE — "the server starts
 * and returns 246 pages" proved startup only, and the probing prompt passed `cwd`
 * explicitly, masking the default. Hence these cases assert the RESOLVED ROOT and
 * cross-project isolation, never just a non-empty response.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const MEMORY_BIN = path.join(PLUGIN_ROOT, "mcp-servers", "guild-memory", "dist", "index.js");
const TELEMETRY_BIN = path.join(PLUGIN_ROOT, "mcp-servers", "guild-telemetry", "dist", "index.js");

/** Drive a stdio MCP server through initialize + one tool call; return the call result. */
function callTool(
  bin: string,
  tool: string,
  args: Record<string, unknown>,
  opts: { cwd: string; flags?: string[] }
): { isError: boolean; text: string } {
  const lines = [
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "scoping-test", version: "0" },
      },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } }),
    "",
  ].join("\n");
  const out = execFileSync("node", [bin, ...(opts.flags ?? [])], {
    input: lines,
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
    timeout: 30_000,
  });
  const last = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
  // Parse the envelope rather than string-matching raw text: a tool that returns
  // its error as ordinary content would otherwise read as success (gate r3).
  const parsed = JSON.parse(last) as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
    error?: { message?: string };
  };
  const text =
    parsed.result?.content?.map((c) => c.text ?? "").join("\n") ?? parsed.error?.message ?? last;
  return { isError: parsed.result?.isError === true || parsed.error !== undefined, text };
}

/**
 * A FAKE plugin payload root seeded with its own sentinel wiki page + run.
 * The servers are launched with THIS as cwd, standing in for the Codex install
 * cache. Using a controlled root (rather than Guild's real tree) keeps the
 * leak assertions hermetic — they no longer depend on Guild-owned strings like
 * "release-discipline" that could be renamed or removed (gate r3).
 */
function makeFakePluginRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-fake-plugin-payload-"));
  fs.mkdirSync(path.join(dir, ".guild", "wiki"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".guild", "runs", "run-PLUGINSENTINEL-0001", "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".guild", "wiki", "plugin-payload-sentinel.md"),
    "---\ntype: standard\n---\n\n# PLUGINSENTINEL page\n"
  );
  fs.writeFileSync(
    path.join(dir, ".guild", "runs", "run-PLUGINSENTINEL-0001", "logs", "v1.4-events.jsonl"),
    JSON.stringify({ ts: "2026-01-01T00:00:00Z", event: "run_start" }) + "\n"
  );
  return dir;
}

/** A FOREIGN consuming repo — never the plugin tree, so leakage is visible. */
function makeForeignRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-foreign-consumer-"));
  fs.mkdirSync(path.join(dir, ".guild", "wiki"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".guild", "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".guild", "wiki", "foreign-only-page.md"),
    "---\ntype: standard\n---\n\n# Foreign only page\n"
  );
  // A uniquely identifiable run so the telemetry positive case proves it READ the
  // consumer's runs, not merely that it did not error against an empty dir.
  const run = path.join(dir, ".guild", "runs", "run-CONSUMERSENTINEL-0001", "logs");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(
    path.join(run, "v1.4-events.jsonl"),
    JSON.stringify({ ts: "2026-01-01T00:00:00Z", event: "run_start" }) + "\n"
  );
  return dir;
}

describe("guild-memory data root", () => {
  let foreign: string;
  let fakePlugin: string;
  beforeAll(() => {
    if (!fs.existsSync(MEMORY_BIN)) {
      throw new Error(`${MEMORY_BIN} missing — run \`npm run build\` in mcp-servers/guild-memory first.`);
    }
    foreign = makeForeignRepo();
    fakePlugin = makeFakePluginRoot();
  });
  afterAll(() => {
    fs.rmSync(foreign, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  });

  it("FAILS CLOSED with --no-cwd-fallback and no cwd — isError, and no payload content", () => {
    // Launched from the PLUGIN payload root (seeded with its own sentinel page),
    // exactly as Codex does it.
    const r = callTool(MEMORY_BIN, "wiki_list", {}, { cwd: fakePlugin, flags: ["--no-cwd-fallback"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no project root available");
    // The leak this whole fix exists to prevent: the payload's own page must not appear.
    expect(r.text).not.toContain("plugin-payload-sentinel");
    expect(r.text).not.toContain("PLUGINSENTINEL");
  });

  it("serves the CONSUMER project when cwd is passed, with zero payload bleed", () => {
    const r = callTool(
      MEMORY_BIN,
      "wiki_list",
      { cwd: foreign },
      { cwd: fakePlugin, flags: ["--no-cwd-fallback"] }
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain("foreign-only-page");
    expect(r.text).toContain(path.join(foreign, ".guild", "wiki"));
    expect(r.text).not.toContain("plugin-payload-sentinel");
  });

  it("WITHOUT the flag, the cwd fallback still works — Claude Code and dev checkouts unchanged", () => {
    const r = callTool(MEMORY_BIN, "wiki_list", {}, { cwd: foreign });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("foreign-only-page");
    expect(r.text).toContain(path.join(foreign, ".guild", "wiki"));
  });

  it("the exposed metadata TELLS the caller cwd is required in flagged mode", () => {
    // gate r3: instructions/schema that call cwd an optional override send a
    // compliant caller into a guaranteed first-call failure.
    const out = execFileSync("node", [MEMORY_BIN, "--no-cwd-fallback"], {
      input:
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }) +
        "\n",
      cwd: fakePlugin,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 30_000,
    });
    const lines = out.trim().split("\n").filter(Boolean);
    const init = JSON.parse(lines[0]) as { result?: { instructions?: string } };
    expect(init.result?.instructions ?? "").toMatch(/MUST pass `cwd`/);
    const tools = JSON.parse(lines[lines.length - 1]) as {
      result?: { tools?: Array<{ inputSchema?: { properties?: { cwd?: { description?: string } } } }> };
    };
    const described = (tools.result?.tools ?? []).filter(
      (t) => t.inputSchema?.properties?.cwd !== undefined
    );
    expect(described.length).toBeGreaterThan(0);
    for (const t of described) {
      expect(t.inputSchema?.properties?.cwd?.description ?? "").toMatch(/REQUIRED/);
    }
  });
});

describe("guild-telemetry data root", () => {
  let foreign: string;
  let fakePlugin: string;
  beforeAll(() => {
    if (!fs.existsSync(TELEMETRY_BIN)) {
      throw new Error(`${TELEMETRY_BIN} missing — run \`npm run build\` in mcp-servers/guild-telemetry first.`);
    }
    foreign = makeForeignRepo();
    fakePlugin = makeFakePluginRoot();
  });
  afterAll(() => {
    fs.rmSync(foreign, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  });

  it("FAILS CLOSED with --no-cwd-fallback and no cwd — never lists the payload's runs", () => {
    const r = callTool(TELEMETRY_BIN, "trace_list_runs", {}, { cwd: fakePlugin, flags: ["--no-cwd-fallback"] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("no project root available");
    expect(r.text).not.toContain("PLUGINSENTINEL");
  });

  it("lists the CONSUMER's run when cwd is passed — positive proof, not just 'no error'", () => {
    const r = callTool(
      TELEMETRY_BIN,
      "trace_list_runs",
      { cwd: foreign },
      { cwd: fakePlugin, flags: ["--no-cwd-fallback"] }
    );
    expect(r.isError).toBe(false);
    // It actually READ the consumer's runs dir…
    expect(r.text).toContain("CONSUMERSENTINEL");
    // …and did not fall back to the payload's.
    expect(r.text).not.toContain("PLUGINSENTINEL");
  });

  it("WITHOUT the flag, the cwd fallback still works", () => {
    const r = callTool(TELEMETRY_BIN, "trace_list_runs", {}, { cwd: foreign });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("CONSUMERSENTINEL");
  });
});

describe("the generated Codex manifest ships the flag WITH cwd — they are one unit", () => {
  it("every declared server carries both cwd '.' and --no-cwd-fallback", () => {
    const m = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"), "utf8")
    ) as { mcpServers: Record<string, { args?: string[]; cwd?: string }> };
    const names = Object.keys(m.mcpServers);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) {
      const e = m.mcpServers[n];
      expect(e.cwd).toBe(".");
      // cwd "." without the flag is the data-leak configuration.
      expect(e.args).toContain("--no-cwd-fallback");
    }
  });

  it("the flag string the manifest emits is the one the servers actually parse", () => {
    // Guards a rename on either side silently disarming the protection.
    for (const bin of [MEMORY_BIN, TELEMETRY_BIN]) {
      expect(fs.readFileSync(bin, "utf8")).toContain("--no-cwd-fallback");
    }
  });
});
