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

/** Ambient root overrides removed, so a developer's shell cannot steer a test. */
function cleanEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const e = { ...process.env, ...(extra ?? {}) };
  if (!extra || !("GUILD_MEMORY_WIKI_ROOT" in extra)) delete e["GUILD_MEMORY_WIKI_ROOT"];
  if (!extra || !("GUILD_TELEMETRY_CWD" in extra)) delete e["GUILD_TELEMETRY_CWD"];
  return e;
}
const MEMORY_BIN = path.join(PLUGIN_ROOT, "mcp-servers", "guild-memory", "dist", "index.js");
const TELEMETRY_BIN = path.join(PLUGIN_ROOT, "mcp-servers", "guild-telemetry", "dist", "index.js");

/** Drive a stdio MCP server through initialize + one tool call; return the call result. */
function callTool(
  bin: string,
  tool: string,
  args: Record<string, unknown>,
  opts: { cwd: string; flags?: string[]; env?: Record<string, string> }
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
    // HERMETIC: the servers honour GUILD_MEMORY_WIKI_ROOT / GUILD_TELEMETRY_CWD,
    // and a developer who exports either (both are documented) would otherwise
    // silently redirect these tests. Strip them unless a case sets them.
    env: cleanEnv(opts.env),
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

/**
 * Metadata regression coverage for BOTH servers (gate r4: the earlier version
 * covered memory only and FILTERED OUT tools lacking `cwd`, so deleting `cwd`
 * from a tool would have passed silently). Asserts the exact tool-name set and
 * requires `cwd` on every tool.
 */
describe.each([
  ["guild-memory", MEMORY_BIN, ["wiki_get", "wiki_list", "wiki_search"]],
  [
    "guild-telemetry",
    TELEMETRY_BIN,
    ["trace_cost_rollup", "trace_list_runs", "trace_query", "trace_summary"],
  ],
] as Array<[string, string, string[]]>)("%s exposed metadata in flagged mode", (_name, bin, expectedTools) => {
  function metadata(): {
    instructions: string;
    tools: Array<{ name: string; inputSchema?: { properties?: { cwd?: { description?: string } } } }>;
  } {
    const out = execFileSync("node", [bin, "--no-cwd-fallback"], {
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
      cwd: os.tmpdir(),
      env: cleanEnv(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 30_000,
    });
    const lines = out.trim().split("\n").filter(Boolean);
    const init = JSON.parse(lines[0]) as { result?: { instructions?: string } };
    const list = JSON.parse(lines[lines.length - 1]) as {
      result?: { tools?: Array<{ name: string; inputSchema?: { properties?: { cwd?: { description?: string } } } }> };
    };
    return { instructions: init.result?.instructions ?? "", tools: list.result?.tools ?? [] };
  }

  it("instructions state that cwd MUST be passed", () => {
    expect(metadata().instructions).toMatch(/MUST pass `cwd`/);
  });

  it("exposes exactly the expected tools — a renamed or dropped tool fails here", () => {
    expect(metadata().tools.map((t) => t.name).sort()).toEqual(expectedTools);
  });

  it("EVERY tool takes cwd and describes it as REQUIRED", () => {
    for (const t of metadata().tools) {
      // No filtering: a tool that lost its `cwd` param must fail, not be skipped.
      expect(t.inputSchema?.properties?.cwd).toBeDefined();
      expect(t.inputSchema?.properties?.cwd?.description ?? "").toMatch(/REQUIRED/);
    }
  });
});

describe.each([
  ["guild-memory", MEMORY_BIN, "wiki_list"],
  ["guild-telemetry", TELEMETRY_BIN, "trace_list_runs"],
] as Array<[string, string, string]>)("%s rejects a RELATIVE root in flagged mode", (_n, bin, tool) => {
  let payload: string;
  beforeAll(() => {
    payload = makeFakePluginRoot();
  });
  afterAll(() => fs.rmSync(payload, { recursive: true, force: true }));

  it("cwd '.' is refused — it would resolve to the plugin payload (gate r4 leak)", () => {
    const r = callTool(bin, tool, { cwd: "." }, { cwd: payload, flags: ["--no-cwd-fallback"] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/must be an ABSOLUTE path/);
    expect(r.text).not.toContain("PLUGINSENTINEL");
    expect(r.text).not.toContain("plugin-payload-sentinel");
  });

  it("a relative env override is refused for the same reason", () => {
    const envVar = bin === MEMORY_BIN ? "GUILD_MEMORY_WIKI_ROOT" : "GUILD_TELEMETRY_CWD";
    const out = execFileSync("node", [bin, "--no-cwd-fallback"], {
      input:
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }) +
        "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: {} } }) +
        "\n",
      cwd: payload,
      env: cleanEnv({ [envVar]: "./relative-root" }),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 30_000,
    });
    const last = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
    expect(last).toMatch(/must be an ABSOLUTE path/);
  });
});

/**
 * gate r5: `path.isAbsolute` alone was not enough — an ABSOLUTE path naming the
 * payload (directly, as a descendant, or through a symlink) still returned the
 * plugin's own data. Flagged mode now canonicalizes both roots and refuses any
 * candidate that IS the payload or lives beneath it.
 */
describe.each([
  ["guild-memory", MEMORY_BIN, "wiki_list", "GUILD_MEMORY_WIKI_ROOT"],
  ["guild-telemetry", TELEMETRY_BIN, "trace_list_runs", "GUILD_TELEMETRY_CWD"],
] as Array<[string, string, string, string]>)(
  "%s refuses payload-scoped roots in flagged mode",
  (_n, bin, tool, envVar) => {
    let payload: string;
    let link: string;
    let consumer: string;
    beforeAll(() => {
      payload = makeFakePluginRoot();
      consumer = makeForeignRepo();
      link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-payload-link-")), "link");
      fs.symlinkSync(payload, link, "dir");
    });
    afterAll(() => {
      fs.rmSync(payload, { recursive: true, force: true });
      fs.rmSync(consumer, { recursive: true, force: true });
      fs.rmSync(path.dirname(link), { recursive: true, force: true });
    });

    it("the payload root itself is refused", () => {
      const r = callTool(bin, tool, { cwd: payload }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/own plugin payload/);
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });

    it("a DESCENDANT of the payload is refused", () => {
      const r = callTool(
        bin,
        tool,
        { cwd: path.join(payload, ".guild") },
        { cwd: payload, flags: ["--no-cwd-fallback"] }
      );
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/own plugin payload/);
    });

    it("an absolute SYMLINK to the payload is refused (canonicalized)", () => {
      const r = callTool(bin, tool, { cwd: link }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/own plugin payload/);
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });

    it("the ENV override is checked the same way", () => {
      const out = execFileSync("node", [bin, "--no-cwd-fallback"], {
        input:
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } },
          }) +
          "\n" +
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: {} } }) +
          "\n",
        cwd: payload,
        env: cleanEnv({ [envVar]: payload }),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 30_000,
      });
      const last = out.trim().split("\n").filter(Boolean).pop() ?? "{}";
      expect(last).toMatch(/own plugin payload/);
      expect(last).not.toContain("PLUGINSENTINEL");
    });

    it("a REAL consumer root outside the payload still works", () => {
      const r = callTool(bin, tool, { cwd: consumer }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(false);
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });
  }
);

/**
 * gate r6: the guard validated the project ROOT, then appended the data dir
 * afterwards — so a root OUTSIDE the payload whose `.guild/<data>` symlinks back
 * INTO it still passed. The check now runs on the effective data directory,
 * which subsumes the root check, with canonicalization that resolves symlinked
 * ancestors of paths that do not exist yet.
 */
describe.each([
  ["guild-memory", MEMORY_BIN, "wiki_list", "wiki"],
  ["guild-telemetry", TELEMETRY_BIN, "trace_list_runs", "runs"],
] as Array<[string, string, string, string]>)(
  "%s refuses a root whose DATA DIR symlinks into the payload",
  (_n, bin, tool, dataDir) => {
    let payload: string;
    let trap: string;
    let consumerLink: string;
    let consumer: string;
    beforeAll(() => {
      payload = makeFakePluginRoot();
      // A project root OUTSIDE the payload whose data dir points back inside it.
      trap = fs.mkdtempSync(path.join(os.tmpdir(), "guild-nested-symlink-trap-"));
      fs.mkdirSync(path.join(trap, ".guild"), { recursive: true });
      fs.symlinkSync(path.join(payload, ".guild", dataDir), path.join(trap, ".guild", dataDir), "dir");
      // A legitimate consumer reached THROUGH a symlink must keep working.
      consumer = makeForeignRepo();
      consumerLink = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-ok-link-")), "link");
      fs.symlinkSync(consumer, consumerLink, "dir");
    });
    afterAll(() => {
      for (const d of [payload, trap, consumer, path.dirname(consumerLink)]) {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    it("the nested data-dir symlink is refused", () => {
      const r = callTool(bin, tool, { cwd: trap }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/own plugin payload/);
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });

    it("a legitimate consumer reached through a symlink still resolves", () => {
      const r = callTool(bin, tool, { cwd: consumerLink }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(false);
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });
  }
);

/**
 * Found by probing before gate round 7 reported: on a CASE-INSENSITIVE
 * filesystem (macOS default), a case-variant path names the same directory but
 * is a different STRING — the string comparison missed it and payload data
 * leaked. Identity is now decided by (device, inode), which is also immune to
 * symlinks and hardlinks; a case-folded string check backstops paths that do
 * not exist yet and therefore cannot be stat'ed.
 */
describe.each([
  ["guild-memory", MEMORY_BIN, "wiki_list"],
  ["guild-telemetry", TELEMETRY_BIN, "trace_list_runs"],
] as Array<[string, string, string]>)("%s payload identity is not string-based", (_n, bin, tool) => {
  let payload: string;
  beforeAll(() => {
    payload = makeFakePluginRoot();
  });
  afterAll(() => fs.rmSync(payload, { recursive: true, force: true }));

  it("a CASE-VARIANT of the payload path is refused where the fs is case-insensitive", () => {
    const base = path.basename(payload);
    const variant = path.join(path.dirname(payload), base.toUpperCase());
    // Only meaningful when the filesystem actually resolves the variant.
    if (!fs.existsSync(variant)) {
      expect(fs.existsSync(variant)).toBe(false); // case-sensitive fs: nothing to bypass
      return;
    }
    const r = callTool(bin, tool, { cwd: variant }, { cwd: payload, flags: ["--no-cwd-fallback"] });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/own plugin payload/);
    expect(r.text).not.toContain("PLUGINSENTINEL");
  });

  it("a trailing separator does not bypass the check", () => {
    const r = callTool(bin, tool, { cwd: payload + path.sep }, { cwd: payload, flags: ["--no-cwd-fallback"] });
    expect(r.isError).toBe(true);
  });

  it("'..' segments inside an absolute payload path do not bypass the check", () => {
    const r = callTool(
      bin,
      tool,
      { cwd: path.join(payload, ".guild", "..") },
      { cwd: payload, flags: ["--no-cwd-fallback"] }
    );
    expect(r.isError).toBe(true);
  });
});

/**
 * Positive environment-override coverage (gate r7): the env cases only proved
 * REJECTION, so a guard that refused every env root would have passed. These
 * assert a legitimate absolute override actually reads the CONSUMER's data.
 * Note the two servers take different shapes: guild-memory's variable points at
 * the wiki directory itself, guild-telemetry's at the project root.
 */
describe.each([
  ["guild-memory", MEMORY_BIN, "wiki_list", "GUILD_MEMORY_WIKI_ROOT", true],
  ["guild-telemetry", TELEMETRY_BIN, "trace_list_runs", "GUILD_TELEMETRY_CWD", false],
] as Array<[string, string, string, string, boolean]>)(
  "%s accepts a legitimate absolute env override",
  (_n, bin, tool, envVar, pointsAtWikiDir) => {
    let payload: string;
    let consumer: string;
    beforeAll(() => {
      payload = makeFakePluginRoot();
      consumer = makeForeignRepo();
    });
    afterAll(() => {
      fs.rmSync(payload, { recursive: true, force: true });
      fs.rmSync(consumer, { recursive: true, force: true });
    });

    it("reads the CONSUMER's data via the env root, with no payload bleed", () => {
      const value = pointsAtWikiDir ? path.join(consumer, ".guild", "wiki") : consumer;
      const r = callTool(bin, tool, {}, { cwd: payload, flags: ["--no-cwd-fallback"], env: { [envVar]: value } });
      expect(r.isError).toBe(false);
      expect(r.text).toContain(pointsAtWikiDir ? "foreign-only-page" : "CONSUMERSENTINEL");
      expect(r.text).not.toContain("PLUGINSENTINEL");
    });
  }
);

/**
 * Case folding must be MEASURED, not assumed: on a case-SENSITIVE filesystem
 * "/srv/Guild" (payload) and "/srv/guild/project" (consumer) are unrelated, and
 * a blanket fold would reject the consumer (gate r7 blocker).
 */
describe("case folding does not over-reject", () => {
  it("a sibling path differing only in case is accepted where the fs is case-SENSITIVE", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-case-pair-"));
    const payload = path.join(base, "Payload");
    const consumer = path.join(base, "payload-consumer");
    fs.mkdirSync(path.join(payload, ".guild", "wiki"), { recursive: true });
    fs.mkdirSync(path.join(consumer, ".guild", "wiki"), { recursive: true });
    fs.writeFileSync(
      path.join(consumer, ".guild", "wiki", "case-consumer-page.md"),
      "---\ntype: standard\n---\n\n# case consumer\n"
    );
    try {
      // Distinct directories, so this must resolve regardless of fs case behavior.
      const r = callTool(MEMORY_BIN, "wiki_list", { cwd: consumer }, { cwd: payload, flags: ["--no-cwd-fallback"] });
      expect(r.isError).toBe(false);
      expect(r.text).toContain("case-consumer-page");
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
