/**
 * scripts/lint/hot-path-budget.ts — the U2 hot-path oracles (KTD29, R45).
 *
 *   timings        layout-current SessionStart marker read ≤50ms; green
 *                  verify.after_edit ≤250ms. Reports p50/p95 over N runs.
 *   require-graph  which src/modules/<domain> trees a cheap entrypoint actually
 *                  loads. KTD29: "the graph may contain them; the entrypoint
 *                  must not load them."
 *
 * Both read only committed compile outputs — they measure what a user runs, not
 * what an author can run, so an `npx tsx` regression on a spawn path shows up as
 * a blown budget rather than passing silently.
 *
 * Wall-clock budgets are machine-dependent by nature, so CI runs this ADVISORY
 * (it prints and records; it does not gate). The gate is `compile --check`.
 *
 * Usage:
 *   node runtime-free:  npx tsx scripts/lint/hot-path-budget.ts timings [--runs=20]
 *                       npx tsx scripts/lint/hot-path-budget.ts require-graph
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const ROOT = path.resolve(__dirname, "..", "..");
const NODE = process.execPath;

const BUDGET_MS = {
  session_start_marker_read: 50,
  post_tool_use_hook_green: 250,
};

// ---------------------------------------------------------------------------
// timings
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i];
}

function measure(runs: number, fn: () => void): { p50: number; p95: number; max: number } {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), max: samples[samples.length - 1] };
}

/** A .guild root whose layout marker is already CURRENT — the budgeted branch. */
function makeCurrentLayoutFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hotpath-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  // Must agree with CURRENT_LAYOUT_VERSION in scripts/lib/state/ensure-storage-layout.ts.
  const { CURRENT_LAYOUT_VERSION } = require(path.join(ROOT, "scripts", "lib", "state", "ensure-storage-layout")) as {
    CURRENT_LAYOUT_VERSION: number;
  };
  fs.writeFileSync(
    path.join(dir, ".guild", "storage-layout.json"),
    JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION }, null, 2) + "\n",
  );
  return dir;
}

/**
 * A Guild root with an ACTIVE run: `.git`, `.guild/`, a current layout marker, a run
 * directory with the log dir the v1.4 tool_call channel appends to, and one source
 * file to be the edit target. This is the state `verify.after_edit` runs against.
 */
function makeActiveRunFixture(): { dir: string; runId: string; marker: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-afteredit-"));
  const runId = "run-hot-path-budget";
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "touched.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(dir, ".guild", "runs", runId, "logs"), { recursive: true });
  const { CURRENT_LAYOUT_VERSION } = require(path.join(ROOT, "scripts", "lib", "state", "ensure-storage-layout")) as {
    CURRENT_LAYOUT_VERSION: number;
  };
  fs.writeFileSync(
    path.join(dir, ".guild", "storage-layout.json"),
    JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(dir, ".guild", "runs", runId, "run.yaml"),
    `schema_version: guild.run.v1\nrun_id: ${runId}\nphase: build\n`,
  );
  // Register a REAL green project check. It writes a marker so the oracle can prove
  // the check RAN rather than inferring it from a zero exit code — an unregistered
  // or skipped check also "exits 0" (codex G-lane r2).
  const marker = path.join(dir, ".guild", "after-edit-check.marker");
  fs.writeFileSync(
    path.join(dir, ".guild", "verify.json"),
    JSON.stringify(
      {
        schema_version: "guild.verify_checks.v1",
        checks: {
          "verify.after_edit": {
            command: process.execPath,
            args: ["-e", `require("fs").writeFileSync(process.env.GUILD_CHECK_MARKER, "ran"); process.exit(0);`],
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  return { dir, runId, marker };
}

/**
 * What the shipped tree ACTUALLY has: the compiled PostToolUse path on a green edit.
 *
 * Named for what it measures (codex G-lane r3). Earlier rounds called this
 * `verify.after_edit`, but that rung does not exist on this tree — the harness was
 * spawning the check itself, so a passing result said nothing about whether the
 * shipped hook would ever spawn one. `verifyAfterEdgeRungOracle` below is the real
 * criterion, pending its owner.
 */
function runPostToolUseGreen(
  fixture: { dir: string; runId: string; marker: string },
  preToolUse: string,
  postToolUse: string,
): { stdoutBytes: number; hookExits: number[] } {
  const edited = path.join(fixture.dir, "src", "touched.ts");
  const payload = JSON.stringify({
    session_id: "hot-path-budget",
    tool_name: "Edit",
    tool_input: { file_path: edited, old_string: "a", new_string: "b" },
    tool_response: { success: true, filePath: edited },
  });
  const env = { ...process.env, GUILD_RUN_ID: fixture.runId, CLAUDE_PLUGIN_ROOT: ROOT };
  const pre = spawnSync(NODE, [preToolUse], { input: payload, cwd: fixture.dir, encoding: "utf8", env });
  const post = spawnSync(NODE, [postToolUse], { input: payload, cwd: fixture.dir, encoding: "utf8", env });
  return {
    stdoutBytes: (pre.stdout ?? "").length + (post.stdout ?? "").length,
    hookExits: [pre.status ?? -1, post.status ?? -1],
  };
}

function hookEntrypoints(): { pre: string; post: string } | null {
  const pre = path.join(ROOT, "hooks", "dist", "pre-tool-use.js");
  const post = path.join(ROOT, "hooks", "dist", "post-tool-use.js");
  for (const p of [pre, post]) {
    if (!fs.existsSync(p)) {
      process.stdout.write(`MISSING ${path.relative(ROOT, p)} — run \`bun run compile\`\n`);
      return null;
    }
  }
  return { pre, post };
}

/**
 * BLOCKING. `post_tool_use_hook_green`: the compiled PostToolUse path on a passing
 * edit exits 0 and writes nothing to stdout. Behaviour, not wall clock.
 */
function postToolUseHookGreen(): number {
  const entries = hookEntrypoints();
  if (!entries) return 1;
  const fixture = makeActiveRunFixture();
  try {
    const r = runPostToolUseGreen(fixture, entries.pre, entries.post);
    let bad = 0;
    const line = (ok: boolean, text: string): void => {
      if (!ok) bad++;
      process.stdout.write(`  ${ok ? "OK  " : "FAIL"}  ${text}\n`);
    };
    process.stdout.write("post_tool_use_hook_green — correctness (blocking)\n");
    line(r.hookExits.every((e) => e === 0), `compiled hook pair exited 0 (pre=${r.hookExits[0]}, post=${r.hookExits[1]})`);
    line(r.stdoutBytes === 0, `stdout is empty (${r.stdoutBytes} bytes — the budget is 0 tokens)`);
    return bad === 0 ? 0 : 1;
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

/**
 * `verify_after_edit_rung` — the REAL plan criterion (R45 / KTD30), PENDING.
 *
 * owner: T10. Not in any blocking job until T10 activates it. This mirrors the
 * `test.todo` convention T13 uses: a visible pending entry naming the owning lane,
 * so the criterion cannot be quietly dropped.
 *
 * The assertion, when T10 lands it: drive the SHIPPED PostToolUse entry with an Edit
 * payload in a project whose config declares a check command, and prove the HOOK —
 * not this harness — spawned that check. The marker is written by the check process
 * itself, so it can only appear if something actually ran it.
 *
 * On this tree the hook spawns nothing, so the marker is absent and this exits
 * non-zero with `rung absent`. That is the correct report: the rung is unimplemented.
 */
function verifyAfterEditRung(): number {
  const entries = hookEntrypoints();
  if (!entries) return 1;
  const fixture = makeActiveRunFixture();
  try {
    const edited = path.join(fixture.dir, "src", "touched.ts");
    const payload = JSON.stringify({
      session_id: "hot-path-budget",
      tool_name: "Edit",
      tool_input: { file_path: edited, old_string: "a", new_string: "b" },
      tool_response: { success: true, filePath: edited },
    });
    const env = {
      ...process.env,
      GUILD_RUN_ID: fixture.runId,
      CLAUDE_PLUGIN_ROOT: ROOT,
      GUILD_CHECK_MARKER: fixture.marker,
    };
    fs.rmSync(fixture.marker, { force: true });
    // ONLY the shipped hook runs. Nothing here spawns the check.
    const post = spawnSync(NODE, [entries.post], { input: payload, cwd: fixture.dir, encoding: "utf8", env });
    const checkRan = fs.existsSync(fixture.marker);
    const marker = checkRan ? fs.readFileSync(fixture.marker, "utf8").trim() : "";

    process.stdout.write("verify_after_edit_rung — PENDING (owner: T10, not gating)\n");
    if (!checkRan) {
      process.stdout.write(
        "  PENDING  rung absent — the shipped PostToolUse hook spawned no check.\n" +
          `           .guild/verify.json declared verify.after_edit; no marker was written.\n` +
          "           T10 implements the rung; this oracle turns green without edits.\n",
      );
      return 1;
    }
    let bad = 0;
    const line = (ok: boolean, text: string): void => {
      if (!ok) bad++;
      process.stdout.write(`  ${ok ? "OK  " : "FAIL"}  ${text}\n`);
    };
    line(true, `the HOOK spawned the declared check (marker "${marker}")`);
    line(post.status === 0, `PostToolUse exited 0 (actual ${post.status})`);
    line((post.stdout ?? "").length === 0, `stdout is empty (${(post.stdout ?? "").length} bytes)`);
    return bad === 0 ? 0 : 1;
  } finally {
    fs.rmSync(fixture.dir, { recursive: true, force: true });
  }
}

function timings(runs: number): number {
  const results: Array<{ id: string; budget: number; p50: number; p95: number; max: number }> = [];

  // 1. SessionStart marker read, layout CURRENT.
  const entry = path.join(ROOT, "runtime", "scripts", "ensure-storage-layout.js");
  if (!fs.existsSync(entry)) {
    process.stdout.write(`MISSING ${path.relative(ROOT, entry)} — run \`bun run compile\` (KTD10 fail-closed)\n`);
    return 1;
  }
  const fixture = makeCurrentLayoutFixture();
  try {
    const m = measure(runs, () => {
      execFileSync(NODE, [entry, `--cwd=${fixture}`], { stdio: "ignore" });
    });
    results.push({ id: "session_start_marker_read", budget: BUDGET_MS.session_start_marker_read, ...m });

    // Process spawn dominates a marker read, so also measure the in-process call:
    // that is the number the budget is actually about once T07 owns the chain.
    const mod = require(path.join(ROOT, "scripts", "lib", "state", "ensure-storage-layout")) as {
      ensureStorageLayout: (cwd: string) => unknown;
    };
    const inproc = measure(runs, () => {
      mod.ensureStorageLayout(fixture);
    });
    results.push({ id: "session_start_marker_read (in-process)", budget: BUDGET_MS.session_start_marker_read, ...inproc });
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }

  // 2. `post_tool_use_hook_green` — the compiled PostToolUse path on a passing edit,
  // timed. Wall clock only; the behavioural assertions live in the blocking
  // `post-tool-use-green` leg. NOT named verify.after_edit: that rung is T10's and
  // does not exist here (see verifyAfterEditRung).
  const preToolUse = path.join(ROOT, "hooks", "dist", "pre-tool-use.js");
  const postToolUse = path.join(ROOT, "hooks", "dist", "post-tool-use.js");
  for (const p of [preToolUse, postToolUse]) {
    if (!fs.existsSync(p)) {
      process.stdout.write(`MISSING ${path.relative(ROOT, p)} — run \`bun run compile\`\n`);
      return 1;
    }
  }
  const runFixture = makeActiveRunFixture();
  try {
    const m = measure(runs, () => {
      runPostToolUseGreen(runFixture, preToolUse, postToolUse);
    });
    results.push({ id: "post_tool_use_hook_green", budget: BUDGET_MS.post_tool_use_hook_green, ...m });
  } finally {
    fs.rmSync(runFixture.dir, { recursive: true, force: true });
  }

  let over = 0;
  process.stdout.write(`hot-path budgets — ${runs} runs each, node ${process.version}\n`);
  for (const r of results) {
    const ok = r.p95 <= r.budget;
    if (!ok) over++;
    process.stdout.write(
      `  ${ok ? "OK  " : "OVER"}  ${r.id.padEnd(40)} budget ${String(r.budget).padStart(4)}ms · ` +
        `p50 ${r.p50.toFixed(1)}ms · p95 ${r.p95.toFixed(1)}ms · max ${r.max.toFixed(1)}ms\n`,
    );
  }
  process.stdout.write("  (correctness assertions live in `post-tool-use-green`, the blocking leg)\n");
  return over === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// require-graph
// ---------------------------------------------------------------------------

/**
 * Cheap entrypoints and the domains each is ALLOWED to pull in. The check is not
 * "loads nothing" — it is "loads nothing it does not need", which only a named
 * allowlist can express. A new domain appearing here is the regression KTD29
 * cares about: a status call that drags in knowledge or evolve.
 */
const CHEAP_ENTRYPOINTS: Array<{ id: string; argv: string[]; allow: string[]; blocking: boolean; note?: string }> = [
  {
    id: "status (capability-profile)",
    argv: ["runtime/scripts/capability-profile.js", "--help"],
    allow: ["state", "config", "capability", "security", "host-runtime", "kernel"],
    blocking: true,
  },
  {
    // Known WIDE at 14 domains. T06 landed the policy/inventory split and its
    // resolver imports NO domain barrel — but the row did not narrow, and the
    // measurement says why: every `src/modules/<d>/index.ts` transitively reaches
    // all 14 through `state -> migrations -> lifecycle`, and `index-only-domain-imports`
    // (KTD27) REQUIRES a src/ file to import through that barrel. So any entrypoint
    // touching a domain from src/ loads all 14 until the domain fold cuts the graph.
    //
    // Measured on the T06 tree (esbuild bundle, one entry each):
    //   src/modules/kernel/index                     ->  1 domain
    //   src/modules/config/workflows/policy-keys     ->  2 domains (config, kernel)
    //   src/modules/config/workflows/settings-reader -> 14 domains (via the host-runtime + security barrels)
    //   src/modules/config/index                     -> 14 domains
    //   src/modules/state/index                      -> 14 domains
    //
    // So the policy key set itself is cheap; everything that names a durable PATH
    // is not, because `GuildStorage` lives behind the state barrel.
    //
    // The flip therefore belongs to T12 (U3 domain fold), which owns the barrel
    // graph. Kept reporting rather than gating so the criterion stays visible.
    id: "config show --sources",
    argv: ["runtime/scripts/config-cmd.js", "show", "--sources"],
    allow: ["state", "config", "capability", "security", "host-runtime", "kernel"],
    blocking: false,
    note: "T12 oracle — the barrel graph, not the config split, is what keeps this wide (see the comment above)",
  },
];

/** Bundled entrypoints have no require graph — read the domains from the bytes. */
function domainsInBundle(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/\/\/ src\/modules\/([a-z0-9-]+)\//g)) found.add(m[1]);
  return [...found].sort();
}

function requireGraph(): number {
  let bad = 0;
  process.stdout.write("require-graph — domains reachable from each cheap entrypoint\n");
  for (const e of CHEAP_ENTRYPOINTS) {
    const abs = path.join(ROOT, e.argv[0]);
    if (!fs.existsSync(abs)) {
      process.stdout.write(`  MISSING ${e.argv[0]} — run \`bun run compile\`\n`);
      bad++;
      continue;
    }
    const domains = domainsInBundle(abs);
    const extra = domains.filter((d) => !e.allow.includes(d));
    const label = extra.length === 0 ? "OK  " : e.blocking ? "FAIL" : "WIDE";
    process.stdout.write(
      `  ${label}  ${e.id.padEnd(30)} ${domains.length} domains: ${domains.join(", ") || "(none)"}\n`,
    );
    if (extra.length > 0) {
      process.stdout.write(`          beyond the allowlist: ${extra.join(", ")}\n`);
      if (e.note) process.stdout.write(`          ${e.note}\n`);
      if (e.blocking) bad++;
    }
  }
  return bad === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------

function main(argv: string[]): number {
  const cmd = argv[0];
  const runsArg = argv.find((a) => a.startsWith("--runs="));
  const runs = runsArg ? Number(runsArg.slice("--runs=".length)) : 20;
  if (cmd === "timings") return timings(runs);
  if (cmd === "post-tool-use-green") return postToolUseHookGreen();
  if (cmd === "verify-after-edit-rung") return verifyAfterEditRung();
  if (cmd === "require-graph") return requireGraph();
  process.stdout.write("usage: hot-path-budget.ts <timings|post-tool-use-green|verify-after-edit-rung|require-graph> [--runs=N]\n");
  return 2;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
