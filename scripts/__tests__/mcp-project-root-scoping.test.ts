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
): { text: string } {
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
  return { text: last };
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
  return dir;
}

describe("guild-memory data root", () => {
  let foreign: string;
  beforeAll(() => {
    if (!fs.existsSync(MEMORY_BIN)) {
      throw new Error(`${MEMORY_BIN} missing — run \`npm run build\` in mcp-servers/guild-memory first.`);
    }
    foreign = makeForeignRepo();
  });
  afterAll(() => fs.rmSync(foreign, { recursive: true, force: true }));

  it("FAILS CLOSED with --no-cwd-fallback and no cwd — never silently serves Guild's own wiki", () => {
    // Launched FROM the plugin root, exactly as Codex does it.
    const { text } = callTool(MEMORY_BIN, "wiki_list", {}, { cwd: PLUGIN_ROOT, flags: ["--no-cwd-fallback"] });
    expect(text).toContain("no project root available");
    // The specific leak: Guild's own wiki root must not appear anywhere.
    expect(text).not.toContain(path.join(PLUGIN_ROOT, ".guild", "wiki"));
  });

  it("serves the FOREIGN project when cwd is passed, with no Guild content", () => {
    const { text } = callTool(
      MEMORY_BIN,
      "wiki_list",
      { cwd: foreign },
      { cwd: PLUGIN_ROOT, flags: ["--no-cwd-fallback"] }
    );
    expect(text).toContain("foreign-only-page");
    expect(text).toContain(path.join(foreign, ".guild", "wiki"));
    // Cross-project isolation: a page that exists ONLY in Guild's own wiki.
    expect(text).not.toContain("release-discipline");
  });

  it("WITHOUT the flag, the cwd fallback still works — Claude Code and dev checkouts unchanged", () => {
    // No flag, launched IN the consuming project: the pre-existing contract.
    const { text } = callTool(MEMORY_BIN, "wiki_list", {}, { cwd: foreign });
    expect(text).toContain("foreign-only-page");
    expect(text).toContain(path.join(foreign, ".guild", "wiki"));
  });
});

describe("guild-telemetry data root", () => {
  let foreign: string;
  beforeAll(() => {
    if (!fs.existsSync(TELEMETRY_BIN)) {
      throw new Error(`${TELEMETRY_BIN} missing — run \`npm run build\` in mcp-servers/guild-telemetry first.`);
    }
    foreign = makeForeignRepo();
  });
  afterAll(() => fs.rmSync(foreign, { recursive: true, force: true }));

  it("FAILS CLOSED with --no-cwd-fallback and no cwd — never exposes Guild's own runs", () => {
    const { text } = callTool(TELEMETRY_BIN, "trace_list_runs", {}, { cwd: PLUGIN_ROOT, flags: ["--no-cwd-fallback"] });
    expect(text).toContain("no project root available");
    // Guild's self-build run ids must not leak into a consumer's view.
    expect(text).not.toContain("run-2026");
  });

  it("scopes to the FOREIGN project when cwd is passed", () => {
    const { text } = callTool(
      TELEMETRY_BIN,
      "trace_list_runs",
      { cwd: foreign },
      { cwd: PLUGIN_ROOT, flags: ["--no-cwd-fallback"] }
    );
    // The foreign repo has an empty runs dir: an EMPTY result is the correct
    // answer, and proves it did not fall back to Guild's populated runs dir.
    expect(text).not.toContain("run-2026");
    expect(text).not.toContain("no project root available");
  });

  it("WITHOUT the flag, the cwd fallback still works", () => {
    const { text } = callTool(TELEMETRY_BIN, "trace_list_runs", {}, { cwd: foreign });
    expect(text).not.toContain("no project root available");
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
