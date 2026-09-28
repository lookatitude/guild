/**
 * test-preload.ts — the `bun test` preload (bunfig.toml [test]).
 *
 * 1. Strips every GUILD_* key, and the host session's own identity (CLAUDECODE,
 *    CLAUDE_*, CODEX_*), from the runner's env before any suite loads. A runner
 *    started inside a Guild lane or a host session otherwise leaks GUILD_RUN_ID,
 *    CLAUDE_PLUGIN_ROOT & co. into in-process calls and spawned hooks: fixture
 *    writes rebind to that lane's run and host detection reads the operator's
 *    session instead of the fixture. CI never has them. Tests that need an
 *    identity set it per call. The explicit live-suite opt-ins survive.
 * 2. Serves the author-plane packages (and the MCP SDK + zod) to files under
 *    src/, which has no node_modules of its own. The compile does the same with an esbuild alias
 *    (scripts/compile.ts); a runtime `onResolve` never sees bare packages.
 * 3. Gives `eval("require")` a CommonJS `require` bound to the CALLING file.
 *    Domain code reaches lazy deps that way so esbuild cannot inline them
 *    (src/domains/lifecycle/run-state.ts); tsx and the compiled bundles run it as
 *    CommonJS, but Bun evaluates the source as ESM, where `require` is not a
 *    free variable.
 * 4. Runs every test file from a fresh empty temp cwd, removed after the file.
 *    Bun starts every suite at the plugin root, whose durable .guild/ a spawned
 *    hook or CLI with no explicit cwd would upgrade or rewrite. A test that needs
 *    a directory passes it explicitly.
 * 5. Puts scripts/ and hooks/ node_modules/.bin on PATH, as `npx jest` did for
 *    every Jest project: suites spawn `npx tsx <cli>` from temp dirs, and without
 *    a local tsx on PATH npx would fetch one from the registry.
 * 6. Points `process.execPath` at the `node` on PATH. Suites spawn
 *    `process.execPath` to run the compiled hooks, runtime/ entries and tsx CLIs
 *    as a USER would; under Bun that would silently be Bun (KTD10/KTD11: the
 *    spawn path is Node). Left alone only when no node is installed.
 * 7. Loads the domain graph once, entered through lifecycle. src/domains has an
 *    import cycle (knowledge/distribution -> state -> lifecycle -> teams ->
 *    evolve/dispatch -> knowledge/distribution). CommonJS (tsx, the bundles)
 *    hands a half-built module an `undefined` binding; Bun's ESM throws a TDZ
 *    ReferenceError when a suite happens to enter through knowledge or
 *    distribution first. Entering through lifecycle evaluates every domain in
 *    an order with no read-before-init. The cycle itself is a reported defect.
 * 8. Raises the per-test timeout to 120s. Many suites spawn the compiled hooks or
 *    a tsx CLI synchronously per case; Jest never timed out a synchronous test,
 *    Bun does, and a slow CI runner takes several of them past 30s.
 *
 * TRAP: this file must live where `js-yaml` does NOT resolve (the plugin root).
 * `mock.module` keys a resolvable specifier by its resolved path, so from a
 * tree with its own node_modules the mock never matches the bare import in src/.
 */
import { afterAll, mock, setDefaultTimeout } from "bun:test";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

for (const key of Object.keys(process.env)) {
  if (/^(GUILD_SSH_LIVE_TARGET|GUILD_ADAPTER_LIVE|CODEX_BIN)$/.test(key)) continue; // explicit live-suite opt-ins
  if (/^(GUILD_|CLAUDE_|CODEX_)/.test(key) || key === "CLAUDECODE") delete process.env[key];
}

const PLUGIN_ROOT = import.meta.dir;
process.env.PATH = [
  path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin"),
  path.join(PLUGIN_ROOT, "hooks", "node_modules", ".bin"),
  process.env.PATH ?? "",
].join(path.delimiter);

const node = Bun.which("node");
if (node) process.execPath = node;

const hermeticCwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-test-cwd-"));
process.chdir(hermeticCwd);
afterAll(() => {
  try {
    process.chdir(os.tmpdir());
    fs.rmSync(hermeticCwd, { recursive: true, force: true });
  } catch {
    // best effort: the OS reaps its temp dir
  }
});

setDefaultTimeout(120_000);

const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");

for (const name of ["js-yaml", "typescript"]) {
  const resolved = require.resolve(name, { paths: [SCRIPTS] });
  mock.module(name, () => require(resolved));
}

// The MCP server source (src/runtime/mcp/) takes the SDK and zod from the lockfile
// the compile resolves them from (scripts/compile.ts MCP_DEPS).
const MCP_DEPS = path.join(PLUGIN_ROOT, "mcp-servers", "guild-memory");
for (const name of ["zod", "@modelcontextprotocol/sdk/server/mcp.js", "@modelcontextprotocol/sdk/server/stdio.js"]) {
  const resolved = require.resolve(name, { paths: [MCP_DEPS] });
  mock.module(name, () => require(resolved));
}

// Frame shape under Bun: "at eval (file:///abs/file.ts:1:8)" or "at fn (/abs/file.ts:3:1)".
function callerFile(stack: string | undefined): string | null {
  for (const line of (stack ?? "").split("\n").slice(2)) {
    const m = /\(?(?:file:\/\/)?(\/[^():]+\.[cm]?[jt]sx?):\d+:\d+\)?$/.exec(line.trim());
    if (m && m[1] !== __filename) return m[1];
  }
  return null;
}

if (typeof (globalThis as { require?: unknown }).require !== "function") {
  (globalThis as { require?: unknown }).require = (id: string) => {
    const from = callerFile(new Error().stack) ?? __filename;
    return createRequire(from)(id);
  };
}

await import(path.join(PLUGIN_ROOT, "src", "domains", "lifecycle", "index.ts"));
