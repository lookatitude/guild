/**
 * scripts/compile.ts — the ONE compile step (U2 / KTD6, KTD7, KTD10, KTD11, KTD29, KTD60).
 *
 * Three planes:
 *   P1  author — `bun run compile` (this file) on a maintainer machine.
 *   P2  CI     — `bun run compile --check` on `next` and `main`.
 *   P3  user   — plain `node` on the committed outputs. Never Bun, never `npx tsx`.
 *
 * Outputs (all committed; KTD7):
 *   hooks/dist/*.js              the 18 hook bundles
 *   hooks/agent-team/dist/*.js   the 3 agent-team bundles
 *   runtime/guild-mcp.js         ONE MCP binary, two D-MCP ids (wiki | trace) — KTD3
 *   runtime/scripts/*.js         the closed list of CLIs a user session spawns
 *   runtime/mcp-descriptions.pins.json
 *                                MCP tool-description pins, written by THIS step —
 *                                there is no separate pinning ritual (KTD60)
 *
 * `--check` recompiles every target into a scratch dir and byte-compares it with
 * the committed copy. Any drift is a non-zero exit naming the file: CI's R-DIST
 * rail and the author loop share one oracle.
 *
 * Determinism: every esbuild invocation runs with `absWorkingDir` pinned to the
 * plugin root and a repo-relative entry path, so the banner paths esbuild writes
 * into the bundle do not encode the checkout location or the scratch dir.
 *
 * CONTRACT: no network, no clock, no randomness in any emitted byte.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Target table — the single source of truth for what ships
// ---------------------------------------------------------------------------

export interface Target {
  /** Stable id used by --only and by --check diagnostics. */
  id: string;
  /** Entry file, repo-relative. */
  entry: string;
  /** Emitted file, repo-relative. */
  out: string;
  /** Directory whose node_modules supplies `js-yaml` for the esbuild alias. */
  yamlFrom?: string;
  group: "hooks" | "agent-team" | "mcp" | "scripts";
}

/** hooks/*.ts → hooks/dist/*.js. Was a 3,500-char one-liner in hooks/package.json. */
const HOOK_IDS = [
  "capture-telemetry",
  "maybe-reflect",
  "pre-tool-use",
  "pre-compact",
  "post-tool-use",
  "run-trace-start",
  "run-trace-close",
  "run-trace",
  "detect-guild-version",
  "update-check",
  "comms-format-lint",
  "learning-backstop",
  "emit-learning-checkpoint",
  "using-guild-bootstrap",
  "session-reanchor",
  "lean-lead-guard",
  "lifecycle-gate",
  "gate-outcome-writer",
];

const AGENT_TEAM_IDS = ["task-created", "task-completed", "teammate-idle"];

/**
 * CLIs a live user session spawns. Closed list — an entry here is a promise that
 * `node <out>` works with Bun absent from PATH (KTD10). Growing it is a design
 * decision, not a convenience: anything not listed must be reached through a hook
 * bundle or a domain function, never through `npx tsx`.
 */
const RUNTIME_SCRIPT_IDS: Array<{ id: string; entry: string }> = [
  // SessionStart, from hooks/bootstrap.sh — was `npx --yes tsx`, the single
  // slowest thing on the start path and the last tsx spawn a user could hit.
  { id: "write-host-capability", entry: "scripts/write-host-capability.ts" },
  // SessionStart marker read (KTD29). Stub until T07 lands the step chain.
  { id: "ensure-storage-layout", entry: "scripts/lib/state/ensure-storage-layout.ts" },
  // `/guild:maintain gc` — scratch janitor + report-only durable sweep (U-STOR).
  { id: "storage-gc", entry: "scripts/lib/state/storage-gc.ts" },
  // NOT a CLI. The cold half of the layout upgrade (U-UPG), required by a
  // non-analyzable specifier from `ensure-storage-layout.js` so the ≤50ms
  // SessionStart bundle carries the marker read and nothing else (KTD29).
  { id: "upgrade-chain", entry: "scripts/lib/state/upgrade-chain.ts" },
  // Product-loop intake router, named by using-guild. Compiled here so T03 can
  // repoint the skill body at `node` without a second build.
  { id: "classify-intake", entry: "scripts/lib/classify-intake.ts" },
  // Stop / SubagentStop: hooks/maybe-reflect.ts spawns this. Was `npx tsx`.
  { id: "trace-summarize", entry: "scripts/trace-summarize.ts" },
  // Every script a `commands/*.md` body spawns today with `npx tsx`. Compiling
  // them here is T02's half of the fix; T04 owns swapping the command bodies to
  // `node "$GUILD_PLUGIN_ROOT/runtime/scripts/<id>.js"` (command bodies are that
  // lane's surface, not this one's).
  { id: "capability-adopt", entry: "scripts/capability-adopt.ts" },
  { id: "capability-profile", entry: "scripts/capability-profile.ts" },
  // NOT a CLI. The lazy evidence chunk `capability-profile.js` requires by a
  // run-time path so the migration-evidence chain stays out of the cheap
  // `status` bundle (KTD29). Dropping this entry breaks `capability-profile
  // baseline|emit` in a shipped package.
  { id: "capability-profile-evidence", entry: "scripts/lib/capability/capability-profile-evidence.ts" },
  { id: "config-cmd", entry: "scripts/config-cmd.ts" },
  { id: "dashboard-launch", entry: "scripts/dashboard-launch.ts" },
  { id: "migrate-guild", entry: "scripts/dot-guild/migrate-guild.ts" },
  { id: "initiative-gate", entry: "scripts/initiative-gate.ts" },
  { id: "config-ui-metadata", entry: "scripts/lib/config-ui-metadata.ts" },
  { id: "runstart-preflight", entry: "scripts/lib/runstart-preflight.ts" },
  { id: "settings-resolver", entry: "scripts/lib/settings-resolver.ts" },
  { id: "models-cmd", entry: "scripts/models-cmd.ts" },
  { id: "oq11-gate-check", entry: "scripts/oq11-gate-check.ts" },
  { id: "read-guild-config", entry: "scripts/read-guild-config.ts" },
  { id: "resume-lanes", entry: "scripts/resume-lanes.ts" },
  { id: "team-decide", entry: "scripts/team-decide.ts" },
];

/** The two D-MCP ids the single binary serves (KTD3). Never a union of the two. */
const MCP_IDS = ["wiki", "trace"] as const;
type McpId = (typeof MCP_IDS)[number];
const MCP_SOURCES: Record<McpId, { server: string; src: string }> = {
  wiki: { server: "guild-memory", src: "mcp-servers/guild-memory/src/index" },
  trace: { server: "guild-telemetry", src: "mcp-servers/guild-telemetry/src/index" },
};

/** Fixed path so the entry name esbuild records in the bundle is deterministic. */
// The name deliberately avoids the dot-guild token: layout-laws decides
// write-capability on RAW TEXT including comments, so spelling it here would
// make this build script look like a write-capable entry.
const MCP_ENTRY = "mcp-servers/.compile-entry-mcp.ts";
const MCP_OUT = "runtime/guild-mcp.js";
const PINS_OUT = "runtime/mcp-descriptions.pins.json";

export function targets(): Target[] {
  const t: Target[] = [];
  for (const id of HOOK_IDS) {
    t.push({ id: `hooks/${id}`, entry: `hooks/${id}.ts`, out: `hooks/dist/${id}.js`, yamlFrom: "hooks", group: "hooks" });
  }
  for (const id of AGENT_TEAM_IDS) {
    t.push({
      id: `agent-team/${id}`,
      entry: `hooks/agent-team/${id}.ts`,
      out: `hooks/agent-team/dist/${id}.js`,
      yamlFrom: "hooks",
      group: "agent-team",
    });
  }
  t.push({ id: "mcp/guild-mcp", entry: MCP_ENTRY, out: MCP_OUT, group: "mcp" });
  for (const s of RUNTIME_SCRIPT_IDS) {
    t.push({ id: `scripts/${s.id}`, entry: s.entry, out: `runtime/scripts/${s.id}.js`, yamlFrom: "scripts", group: "scripts" });
  }
  return t;
}

// ---------------------------------------------------------------------------
// esbuild
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-var-requires */
const esbuild = require(path.join(ROOT, "scripts", "node_modules", "esbuild")) as typeof import("esbuild");

/**
 * The esbuild `alias` map for one target. Exported because it IS the #75 fix:
 * every bundle must resolve `js-yaml` from its own package's `node_modules`, and
 * the determinism rail asserts that here now that the 3,500-char one-liner in
 * `hooks/package.json` is gone.
 */
export function aliasForTarget(t: Target): Record<string, string> {
  const alias: Record<string, string> = {};
  if (t.yamlFrom) alias["js-yaml"] = path.join(ROOT, t.yamlFrom, "node_modules", "js-yaml");
  return alias;
}

/**
 * The exact options object `buildOne` hands to esbuild. Exported so the
 * determinism suite asserts the alias on the REAL invocation path, not on a
 * helper that a refactor could disconnect from the build.
 */
export function buildOptionsForTarget(t: Target, outAbs: string): import("esbuild").BuildOptions {
  return {
    absWorkingDir: ROOT,
    entryPoints: [t.entry],
    outfile: path.relative(ROOT, outAbs),
    bundle: true,
    platform: "node",
    target: "node18",
    format: "cjs",
    alias: aliasForTarget(t),
    logLevel: "silent",
  };
}

function buildOne(t: Target, outAbs: string): void {
  const r = esbuild.buildSync(buildOptionsForTarget(t, outAbs));
  if (r.errors.length) {
    throw new Error(`esbuild failed for ${t.id}:\n${r.errors.map((e) => e.text).join("\n")}`);
  }
  normalizeShebang(outAbs);
}

/**
 * esbuild copies the ENTRY's shebang to the top of the bundle, so every committed
 * `.js` inherited `#!/usr/bin/env -S npx tsx` from its TypeScript source — and the
 * bundles are mode 0755. `node hooks/dist/x.js` was always fine, but executing the
 * bundle directly would have run `npx tsx` on it: a real `npx` on the user path
 * (KTD10/KTD11), reachable on a cold cache. Rewrite it to `node`.
 */
function normalizeShebang(outAbs: string): void {
  const src = fs.readFileSync(outAbs, "utf8");
  if (!src.startsWith("#!")) return;
  const nl = src.indexOf("\n");
  const first = src.slice(0, nl);
  if (!/\b(npx|tsx|bun)\b/.test(first)) return;
  fs.writeFileSync(outAbs, `#!/usr/bin/env node${src.slice(nl)}`);
}

// ---------------------------------------------------------------------------
// Generated MCP entry (KTD3)
// ---------------------------------------------------------------------------

/**
 * One binary, one server per process, selected by argv[2]. `--describe` prints the
 * tool descriptions the pin step hashes — the binary is its own description oracle,
 * so a pin can never describe a build other than the one that ships.
 */
function mcpEntrySource(): string {
  const imports = MCP_IDS.map((id) => {
    const rel = "./" + path.relative("mcp-servers", MCP_SOURCES[id].src).replace(/\\/g, "/");
    return `import { buildServer as build_${id}, runAsEntry as run_${id} } from "${rel}";`;
  }).join("\n");
  const cases = MCP_IDS.map(
    (id) => `  ${id}: { server: ${JSON.stringify(MCP_SOURCES[id].server)}, build: build_${id}, run: run_${id} },`,
  ).join("\n");
  return `// GENERATED by scripts/compile.ts — do not edit, do not commit.
// Single Guild MCP binary (KTD3): two D-MCP ids, one runtime/guild-mcp.js.
// Each id delegates to its own module's entry, so the stdio transport, the
// ready line, and the fatal handler stay byte-for-byte what they were.
${imports}

const REGISTRY: Record<string, { server: string; build: () => any; run: () => void }> = {
${cases}
};

const IDS = Object.keys(REGISTRY);

function describe(): void {
  const out: Record<string, { server: string; tools: Record<string, string> }> = {};
  for (const id of IDS) {
    const { server, build } = REGISTRY[id];
    const tools: Record<string, string> = {};
    const registered = (build() as any)._registeredTools;
    if (!registered || Object.keys(registered).length === 0) {
      process.stderr.write(\`[guild-mcp] describe: no registered tools for "\${id}" — SDK shape changed\\n\`);
      process.exit(2);
    }
    for (const [name, def] of Object.entries(registered as Record<string, any>)) {
      tools[name] = typeof def?.description === "string" ? def.description : "";
    }
    out[id] = { server, tools };
  }
  process.stdout.write(JSON.stringify(out, null, 2) + "\\n");
}

const arg = process.argv[2];
if (arg === "--describe") {
  describe();
} else if (!arg || !REGISTRY[arg]) {
  process.stderr.write(\`[guild-mcp] usage: guild-mcp <\${IDS.join("|")}> | --describe\\n\`);
  process.exit(2);
} else {
  REGISTRY[arg].run();
}
`;
}

// ---------------------------------------------------------------------------
// MCP description pins (KTD60)
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Run the freshly built binary's `--describe` and hash each description with the
 * same function PreToolUse uses (hooks/lib/security/mcp-hash-pin.ts hashDescription).
 * Keys are the bare tool name: the host prefix (`mcp__guild-memory__`,
 * `mcp__plugin_guild_guild-memory__`, …) varies by host and install shape, and the
 * bare names are unique across Guild's two servers.
 */
function writePins(binaryAbs: string, pinsAbs: string): void {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const raw = execFileSync(process.execPath, [binaryAbs, "--describe"], { encoding: "utf8" });
  const described = JSON.parse(raw) as Record<string, { server: string; tools: Record<string, string> }>;
  // Keyed by SERVER, never by bare tool name: a pin must never bind to a tool of
  // the same name on a server that did not declare it (codex G-lane r1).
  const servers: Record<string, { mcp_id: string; tools: Record<string, string> }> = {};
  for (const id of Object.keys(described).sort()) {
    const entry = described[id];
    if (servers[entry.server]) throw new Error(`two D-MCP ids share server "${entry.server}"`);
    const tools: Record<string, string> = {};
    for (const name of Object.keys(entry.tools).sort()) tools[name] = sha256(entry.tools[name]);
    servers[entry.server] = { mcp_id: id, tools };
  }
  const doc = {
    schema_version: "guild.mcp_description_pins.v2",
    generated_by: "scripts/compile.ts",
    binary: MCP_OUT,
    // Verified by PreToolUse at pin load: pins describe THIS binary and no other.
    binary_sha256: sha256(fs.readFileSync(binaryAbs, "utf8")),
    servers,
  };
  fs.mkdirSync(path.dirname(pinsAbs), { recursive: true });
  fs.writeFileSync(pinsAbs, JSON.stringify(doc, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function compileAll(outRoot: string, only?: string): string[] {
  const written: string[] = [];
  const entryAbs = path.join(ROOT, MCP_ENTRY);
  fs.writeFileSync(entryAbs, mcpEntrySource());
  try {
    for (const t of targets()) {
      if (only && t.group !== only) continue;
      const outAbs = path.join(outRoot, t.out);
      fs.mkdirSync(path.dirname(outAbs), { recursive: true });
      buildOne(t, outAbs);
      written.push(t.out);
    }
    if (!only || only === "mcp") {
      writePins(path.join(outRoot, MCP_OUT), path.join(outRoot, PINS_OUT));
      written.push(PINS_OUT);
    }
  } finally {
    fs.rmSync(entryAbs, { force: true });
  }
  return written;
}

/** Every directory the compile OWNS: nothing else may live under them (KTD7/KTD9). */
const OWNED_OUTPUT_ROOTS = ["hooks/dist", "hooks/agent-team/dist", "runtime"];

/** Every committed file under the owned roots, repo-relative. */
function committedOutputs(): string[] {
  const out: string[] = [];
  const walk = (absDir: string, rel: string): void => {
    if (!fs.existsSync(absDir)) return;
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(absDir, e.name), r);
      else out.push(r);
    }
  };
  for (const root of OWNED_OUTPUT_ROOTS) walk(path.join(ROOT, root), root);
  return out.sort();
}

/**
 * Files the target table no longer produces but that are still committed. A target
 * removed from the table used to leave its stale bundle shipping and unchecked —
 * `--check` only ever compared the outputs it had just written, so a deleted target
 * was invisible. Also catches a hand-dropped file under a compile-owned directory.
 */
function strayOutputs(expected: string[]): string[] {
  const known = new Set(expected);
  return committedOutputs().filter((f) => !known.has(f));
}

const GROUPS = ["hooks", "agent-team", "mcp", "scripts"];

function main(argv: string[]): number {
  const check = argv.includes("--check");
  const onlyArg = argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length) : undefined;

  // An unknown --only used to select zero targets and exit 0 — a typo in a build
  // script read as a green compile.
  if (only !== undefined && !GROUPS.includes(only)) {
    process.stderr.write(
      `compile: unknown --only=${only}. Valid groups: ${GROUPS.join(", ")}.\n`,
    );
    return 2;
  }

  if (!check) {
    const written = compileAll(ROOT, only);
    process.stdout.write(`compile — ${written.length} outputs\n`);
    for (const w of written) process.stdout.write(`  ${w}\n`);
    return 0;
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "guild-compile-check-"));
  try {
    const written = compileAll(scratch, only);
    const drift: string[] = [];
    const missing: string[] = [];
    for (const rel of written) {
      const committed = path.join(ROOT, rel);
      if (!fs.existsSync(committed)) {
        missing.push(rel);
        continue;
      }
      const a = fs.readFileSync(committed);
      const b = fs.readFileSync(path.join(scratch, rel));
      if (!a.equals(b)) drift.push(rel);
    }
    // Completeness is only meaningful over the WHOLE table: a --only run knows
    // nothing about the groups it skipped, so it must not judge them stray.
    const stray = only ? [] : strayOutputs(written);
    if (missing.length === 0 && drift.length === 0 && stray.length === 0) {
      process.stdout.write(
        `compile --check — ${written.length} outputs match a fresh compile; ` +
          `no stray files under ${OWNED_OUTPUT_ROOTS.join(", ")}\n`,
      );
      return 0;
    }
    for (const m of missing) process.stdout.write(`MISSING  ${m} — committed output absent (KTD7)\n`);
    for (const d of drift) process.stdout.write(`DRIFT    ${d} — committed bytes differ from a fresh compile\n`);
    for (const x of stray) {
      process.stdout.write(`STRAY    ${x} — committed under a compile-owned directory but produced by no target\n`);
    }
    process.stdout.write(
      `compile --check FAILED — ${missing.length} missing, ${drift.length} drifted, ` +
        `${stray.length} stray. Run \`bun run compile\`, or delete the stray file.\n`,
    );
    return 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    process.stderr.write(`compile: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(1);
  }
}
