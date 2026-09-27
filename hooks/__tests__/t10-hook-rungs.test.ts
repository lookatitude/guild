/**
 * hooks/__tests__/t10-hook-rungs.test.ts — the T10 (U-LOOP hooks) fixtures.
 *
 * Every one of these is named verbatim in the lane's success criteria, and each
 * drives the COMPILED bundle under `hooks/dist/` rather than the `.ts` source.
 * That is deliberate: hooks run from dist (KTD7), so a test that exercised the
 * source would pass on an edit that was never rebuilt. Fixture F7 makes that
 * implicit property explicit with a dist grep.
 *
 *   F1  a green test hook adds no assistant tokens and completes ≤250ms
 *   F2  a 50k test log reaching T1 is a truncated pointer
 *   F3  the compaction fixture rehydrates from disk, never from a transcript summary
 *   F4  a skip-recorded rung still writes heartbeat files
 *   F5  `current-run-id` is never recreated
 *   F6  incomplete-run detection reads the run record + env
 *   F7  hook source edits are rebuilt into dist (dist grep proves it)
 */

import { describe, it, expect, afterEach } from "bun:test";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  COMPACTION_REHYDRATE_SCHEMA,
  rehydrateFromDisk,
  renderRehydrateInstructions,
  resolveCompactionRung,
  runRecordExists,
  snapshotIsStale,
  writeRehydrateHeartbeat,
} from "../lib/compaction-rehydrate";
import { KTD26_TOKEN_CAP, estimateTokens } from "../lib/token-cap";
import { truncateToolResultForParent } from "../lib/tool-result-truncate";
import { emitLoopEvent, LOOP_EVENT_KINDS } from "../lib/loop-events";
import { readVerifyCheck, resolveVerifyRung } from "../lib/verify-after-edit";
// Top-level, like hooks/__tests__/emit-learning-checkpoint.test.ts: a lazy
// `require()` of this module inside a test body aborts the test with an empty
// failure under ts-jest, and the checkpoint enqueue is worth a real assertion.
import { ALL_NONE_DECISIONS, writeCheckpoint } from "../emit-learning-checkpoint";

const ROOT = path.resolve(__dirname, "..", "..");
const POST_TOOL_USE = path.join(ROOT, "hooks", "dist", "post-tool-use.js");
const PRE_COMPACT = path.join(ROOT, "hooks", "dist", "pre-compact.js");
const RUN = "run-t10-fixture";

let tmp: string;

/** A Guild root with a current layout marker and one open run record. */
function makeRoot(opts: { runRecord?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t10-"));
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "touched.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(dir, ".guild", "runs", RUN, "logs"), { recursive: true });
  // Must agree with CURRENT_LAYOUT_VERSION so the bootstrap takes the marker-read
  // branch instead of trying to upgrade a throwaway fixture.
  const { CURRENT_LAYOUT_VERSION } = require(
    path.join(ROOT, "scripts", "lib", "state", "ensure-storage-layout"),
  ) as { CURRENT_LAYOUT_VERSION: number };
  fs.writeFileSync(
    path.join(dir, ".guild", "storage-layout.json"),
    `${JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION })}\n`,
  );
  if (opts.runRecord !== false) {
    fs.writeFileSync(
      path.join(dir, ".guild", "runs", RUN, "run.yaml"),
      `schema_version: guild.run.v1\nrun_id: ${RUN}\nphase: build\nstatus: open\n`,
    );
  }
  return dir;
}

/**
 * A root with `.guild/` but NO layout marker — the `unmarked` branch.
 *
 * `committed` makes it a real git repo with the tree committed, because T07's
 * upgrade chain BLOCKS its durable steps on uncommitted tracked content. An
 * uncommitted fixture exercises the blocked path (nothing is migrated); a
 * committed one exercises the path that actually writes the marker.
 */
function makeUnmarkedRoot(opts: { committed?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t10-unmarked-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "touched.ts"), "export const a = 1;\n");
  fs.mkdirSync(path.join(dir, ".guild", "runs", RUN, "logs"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".guild", "runs", RUN, "run.yaml"),
    `schema_version: guild.run.v1\nrun_id: ${RUN}\nphase: build\nstatus: open\n`,
  );
  if (opts.committed === true) {
    const git = (...args: string[]): void => {
      const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    };
    git("init", "-q", ".");
    git("add", "-A");
    git("-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-qm", "fixture");
  } else {
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  }
  return dir;
}

/** The committed variant: the upgrade chain can actually complete on it. */
function makeUnmarkedRootCommitted(): string {
  return makeUnmarkedRoot({ committed: true });
}

function runDirOf(root: string): string {
  return path.join(root, ".guild", "runs", RUN);
}

/**
 * Declare a `verify.after_edit` check that PROVES it ran.
 *
 * The marker is written by the check process itself, so its presence cannot be
 * faked by a hook that merely exits 0 — the same anti-vacuity trick the lint
 * oracle uses.
 */
function declareCheck(root: string, body: string): string {
  const marker = path.join(root, ".guild", "check.marker");
  fs.writeFileSync(
    path.join(root, ".guild", "verify.json"),
    `${JSON.stringify(
      {
        schema_version: "guild.verify_checks.v1",
        checks: { "verify.after_edit": { command: process.execPath, args: ["-e", body] } },
      },
      null,
      2,
    )}\n`,
  );
  return marker;
}

function editPayload(root: string, response: unknown = { success: true }): string {
  const edited = path.join(root, "src", "touched.ts");
  return JSON.stringify({
    session_id: "t10",
    tool_name: "Edit",
    tool_input: { file_path: edited, old_string: "a", new_string: "b" },
    tool_response: response,
  });
}

interface HookRun {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

/**
 * Drive a compiled hook. `env` is applied over a GUILD_*-free base; the jest
 * setup file already strips the runner's own, and this keeps the guarantee local
 * to the spawn so the test does not depend on setup ordering.
 */
function runHook(entry: string, input: string, env: Record<string, string>): HookRun {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GUILD_") || v === undefined) continue;
    base[k] = v;
  }
  const started = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [entry], {
    input,
    encoding: "utf8",
    env: { ...base, ...env },
    timeout: 30000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    ms: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

/** The per-invocation `verify.after_edit` logs of a run, newest last. */
function verifyLogs(root: string): string[] {
  const dir = path.join(runDirOf(root), "verify");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^after-edit\..+\.log$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  if (tmp !== undefined) fs.rmSync(tmp, { recursive: true, force: true });
});

// ── F1 ───────────────────────────────────────────────────────────────────────

describe("F1 a green verify.after_edit adds no assistant tokens and completes ≤250ms", () => {
  it("passes silently, records the pass, and stays inside the budget", () => {
    tmp = makeRoot();
    const marker = declareCheck(
      tmp,
      `require("fs").writeFileSync(${JSON.stringify(marker0(tmp))}, "ran"); process.exit(0);`,
    );
    // Best of three: the BUDGET is about the hook's own work, and a single cold
    // sample on a loaded runner measures the machine, not the hook. The p50/p95
    // report lives in scripts/lint/hot-path-budget.ts.
    const runs = [0, 1, 2].map(() =>
      runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp }),
    );
    for (const r of runs) {
      expect(r.status).toBe(0);
      // 0 assistant tokens: stdout is the model-visible channel and it is empty.
      expect(r.stdout).toBe("");
    }
    expect(fs.existsSync(marker)).toBe(true);
    expect(Math.min(...runs.map((r) => r.ms))).toBeLessThanOrEqual(250);

    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["schema_version"]).toBe("guild.rung_record.v1");
    expect(record["rung"]).toBe("native");
    expect(record["state"]).toBe("pass");
    // The rung's own recorded cost — the part of the 250ms the rung controls,
    // and the assertion that does not move with the runner's load. The
    // end-to-end p50/p95 report is `hot-path-budget.ts timings`.
    expect(record["duration_ms"] as number).toBeLessThanOrEqual(250);
  });

  it("a FAILING check is reported on stderr with the full log on disk, and never as a pass", () => {
    tmp = makeRoot();
    declareCheck(tmp, `process.stderr.write("boom\\n"); process.exit(3);`);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0); // a hook may not break the user's edit
    expect(r.stdout).toBe(""); // still zero model-visible tokens
    expect(r.stderr).toContain("boom");
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("fail");
    expect(verifyLogs(tmp)).toHaveLength(1);
  });

  it("a declared check that cannot RUN fails closed — it is never a silent pass", () => {
    tmp = makeRoot();
    fs.writeFileSync(
      path.join(tmp, ".guild", "verify.json"),
      `${JSON.stringify({
        schema_version: "guild.verify_checks.v1",
        checks: { "verify.after_edit": { command: "guild-no-such-binary-xyz", args: [] } },
      })}\n`,
    );
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("fail");
    expect(String(record["reason"])).toContain("oracle-unrunnable");
  });
});

// ── F4 ───────────────────────────────────────────────────────────────────────

describe("F4 a skip-recorded rung still writes heartbeat files", () => {
  it("no declared check ⇒ skip-recorded on disk, not a pass and not silence", () => {
    tmp = makeRoot(); // no verify.json at all
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["rung"]).toBe("skip-recorded");
    expect(record["state"]).toBe("skip-recorded");
    expect(record["reason"]).toBe("no-declared-check");
  });

  it("an unusable GUILD_RUN_DIR falls back to this root — never a relative path", () => {
    // Empty string is not nullish, so a bare `??` would accept "" and the record
    // would land at a RELATIVE "rungs/" under whatever cwd the hook inherited.
    tmp = makeRoot();
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_RUN_DIR: "",
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"))).toBe(true);
    // And a RELATIVE override is refused the same way — for every writer in the
    // hook, not only the rung: the event log used the same unguarded read and
    // created `relative/run/dir/logs/` under the process cwd.
    const r2 = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_RUN_DIR: "relative/run/dir",
    });
    expect(r2.status).toBe(0);
    expect(fs.existsSync(path.join(tmp, "relative"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "hooks", "relative"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "hooks", "logs"))).toBe(false);
    // The writes landed in the resolved run tree instead.
    expect(
      fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl")),
    ).toBe(true);
  });

  it("a host that DECLARES the rung absent is recorded as such even with a check present", () => {
    tmp = makeRoot();
    const marker = declareCheck(tmp, `require("fs").writeFileSync(${JSON.stringify(marker0(tmp))}, "ran");`);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_VERIFY_RUNG: "skip-recorded",
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(false); // nothing was spawned
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("skip-recorded");
    expect(record["reason"]).toBe("host-declared-skip-recorded");
  });

  it("a skip-recorded COMPACTION rung writes the rehydrate snapshot and the rung record", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const r = runHook(PRE_COMPACT, JSON.stringify({ session_id: "t10" }), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_COMPACTION_RUNG: "skip-recorded",
    });
    expect(r.status).toBe(0);
    // skip-recorded adds NOTHING to the model-visible channel — the files are
    // the channel. (The pre-existing re-anchor block, which is not this rung, is
    // still emitted; what must be absent is the rehydrate pointer text.)
    expect(r.stdout).not.toContain("Guild rehydrate (from disk");
    const snapshot = readJson(path.join(runDirOf(tmp), "rehydrate", "compaction.json"));
    expect(snapshot["schema_version"]).toBe(COMPACTION_REHYDRATE_SCHEMA);
    expect(snapshot["rung"]).toBe("skip-recorded");
    const rung = readJson(path.join(runDirOf(tmp), "rungs", "compaction.json"));
    expect(rung["state"]).toBe("skip-recorded");
  });

  it("the rung resolvers are three- and two-valued and never guess upward", () => {
    expect(resolveVerifyRung({}, false)).toBe("skip-recorded");
    expect(resolveVerifyRung({}, true)).toBe("native");
    expect(resolveVerifyRung({ GUILD_VERIFY_RUNG: "wrapped" }, true)).toBe("wrapped");
    // A host cannot claim a rung it has no command for.
    expect(resolveVerifyRung({ GUILD_VERIFY_RUNG: "native" }, false)).toBe("skip-recorded");
    expect(resolveCompactionRung({})).toBe("native");
    expect(resolveCompactionRung({ GUILD_COMPACTION_RUNG: "skip-recorded" })).toBe("skip-recorded");
  });
});

// ── the layout bootstrap on a hook entry ────────────────────────────────────

describe("KTD23 the bootstrap runs from a hook entry, including its cold half", () => {

  it("an UNMARKED root is upgraded through the compiled CLI, silently", () => {
    // The canonical entry loads its upgrade chain by a non-analyzable require so
    // the 50ms start path stays thin (KTD29); inside a hook BUNDLE that has no
    // resolvable target, so the wrapper spawns runtime/scripts/ensure-storage-layout.js.
    // Without that fallback this root would never be marked — the marker is the
    // proof the cold half ran, and it can only be written by the chain.
    tmp = makeUnmarkedRoot({ committed: true });
    const marker = path.join(tmp, ".guild", "storage-layout.json");
    expect(fs.existsSync(marker)).toBe(false);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: ROOT,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(fs.existsSync(marker)).toBe(true);
    const { CURRENT_LAYOUT_VERSION } = require(
      path.join(ROOT, "scripts", "lib", "state", "ensure-storage-layout"),
    ) as { CURRENT_LAYOUT_VERSION: number };
    expect(readJson(marker)["storage_layout_version"]).toBe(CURRENT_LAYOUT_VERSION);
    // Silent by contract: several hooks are budgeted to 0 bytes of stderr, so the
    // bootstrap never diagnoses from a hook (see hooks/lib/ensure-layout.ts).
    expect(r.stderr).not.toContain("layout");
  });

  it("an unmarked root with no CLI to upgrade with still works — only FUTURE refuses", () => {
    // The asymmetry KTD23 actually states: a future layout is refused, an old or
    // unmarked one is the ordinary case. Refusing here as well was tried and it
    // silenced the secret scrub and the event log on every un-upgraded project.
    tmp = makeUnmarkedRoot();
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      // Deliberately no CLAUDE_PLUGIN_ROOT / GUILD_PLUGIN_ROOT: the cold half
      // cannot run, so the root stays unmarked.
      CLAUDE_PLUGIN_ROOT: "",
      GUILD_PLUGIN_ROOT: "",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).not.toContain("layout refused");
    expect(fs.existsSync(path.join(tmp, ".guild", "storage-layout.json"))).toBe(false);
    // The hook did its job against the un-upgraded root.
    expect(
      fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json")),
    ).toBe(true);
  });
});

describe("KTD10 a compiled layout CLI that FAILS refuses the gate (codex T14 lead round 2)", () => {
  /** A plugin root whose layout CLI exists but cannot run its chain (exits 1). */
  function makeBrokenPluginRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t10-broken-plugin-"));
    const cli = path.join(root, "runtime", "scripts", "ensure-storage-layout.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    // Stands in for a bundle whose sibling chunk (upgrade-chain.js) is missing:
    // the real CLI exits 1 with "Cannot find module" in that state.
    fs.writeFileSync(cli, 'console.error("Cannot find module upgrade-chain.js"); process.exit(1);\n');
    return root;
  }

  it("PostToolUse writes NOTHING when the cold bootstrap exits non-zero", () => {
    tmp = makeUnmarkedRoot();
    const plugin = makeBrokenPluginRoot();
    declareCheck(tmp, "process.exitCode = 0;");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: plugin,
      GUILD_PLUGIN_ROOT: plugin,
    });
    expect(r.status).toBe(0); // a hook may not break the user's edit
    expect(r.stdout).toBe("");
    // The gate refused: no rung record, no marker written.
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".guild", "storage-layout.json"))).toBe(false);
  });

  it("a cold bootstrap that TIMES OUT while trapping SIGTERM (exit 0) still refuses the gate", () => {
    tmp = makeUnmarkedRoot();
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t10-hang-plugin-"));
    const cli = path.join(plugin, "runtime", "scripts", "ensure-storage-layout.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, 'process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);\n');
    declareCheck(tmp, "process.exitCode = 0;");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: plugin,
      GUILD_PLUGIN_ROOT: plugin,
      GUILD_LAYOUT_CLI_TIMEOUT_MS: "1000",
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"))).toBe(false);
  });

  it("a non-integer timeout override never throws out of the gate (silent, never-throws contract)", () => {
    tmp = makeUnmarkedRoot();
    const plugin = makeBrokenPluginRoot();
    declareCheck(tmp, "process.exitCode = 0;");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: plugin,
      GUILD_PLUGIN_ROOT: plugin,
      GUILD_LAYOUT_CLI_TIMEOUT_MS: "0.5",
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toMatch(/ERR_OUT_OF_RANGE|TypeError|RangeError/);
    // The override is ignored (not a positive integer); the broken CLI still refuses.
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"))).toBe(false);
  });

  it("SessionStart fails CLOSED (non-zero, names the cause) when the cold bootstrap exits non-zero", () => {
    const SESSION_START = path.join(ROOT, "hooks", "dist", "using-guild-bootstrap.js");
    expect(fs.existsSync(SESSION_START)).toBe(true);
    tmp = makeUnmarkedRoot();
    const plugin = makeBrokenPluginRoot();
    const r = runHook(SESSION_START, JSON.stringify({ session_id: "t10", cwd: tmp, hook_event_name: "SessionStart", source: "startup" }), {
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: plugin,
      GUILD_PLUGIN_ROOT: plugin,
    });
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}\n${r.stderr}`).toMatch(/bootstrap|compile outputs|layout/i);
  });
});

// ── a FUTURE layout fails closed (rework-r1 P1 #2) ──────────────────────────

describe("KTD23 a future layout stops every write, in every wired hook", () => {
  /** A root marked with a layout version this build cannot understand. */
  function makeFutureRoot(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t10-future-"));
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src", "touched.ts"), "export const a = 1;\n");
    fs.mkdirSync(path.join(dir, ".guild", "runs", RUN, "logs"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".guild", "runs", RUN, "run.yaml"),
      `schema_version: guild.run.v1\nrun_id: ${RUN}\nphase: build\nstatus: open\n`,
    );
    fs.writeFileSync(
      path.join(dir, ".guild", "storage-layout.json"),
      `${JSON.stringify({ storage_layout_version: 999 })}\n`,
    );
    return dir;
  }

  it("PostToolUse writes no rung record, no JSONL and no heartbeat", () => {
    tmp = makeFutureRoot();
    // A declared check as well, so the refusal is what stops the write rather
    // than there being nothing to write.
    const marker = declareCheck(tmp, "process.exitCode = 0;");
    const before = fs.readdirSync(runDirOf(tmp)).sort();
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_SPECIALIST: "developer",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("layout refused (future)");
    expect(Buffer.byteLength(r.stderr, "utf8")).toBeLessThanOrEqual(512);
    expect(fs.existsSync(marker)).toBe(false); // the oracle never ran either
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs"))).toBe(false);
    expect(fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(runDirOf(tmp), "in-progress"))).toBe(false);
    // Nothing at all appeared under the run directory.
    expect(fs.readdirSync(runDirOf(tmp)).sort()).toEqual(before);
  });

  it("PreCompact writes no hook event and no rehydrate snapshot", () => {
    tmp = makeFutureRoot();
    seedRehydrateSources(tmp);
    const before = fs.readdirSync(runDirOf(tmp)).sort();
    const r = runHook(PRE_COMPACT, JSON.stringify({ session_id: "t10" }), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("layout refused (future)");
    expect(fs.existsSync(path.join(runDirOf(tmp), "rehydrate"))).toBe(false);
    expect(fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"))).toBe(false);
    expect(fs.readdirSync(runDirOf(tmp)).sort()).toEqual(before);
  });

  it("a skip-recorded compaction rung writes no snapshot either", () => {
    tmp = makeFutureRoot();
    seedRehydrateSources(tmp);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_COMPACTION_RUNG: "skip-recorded",
    });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rehydrate"))).toBe(false);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs"))).toBe(false);
  });

  it("the 0-byte-stderr hook refuses SILENTLY and still writes nothing", () => {
    // Stop:run-trace-close is budgeted at 0 bytes of stderr
    // (hooks/__tests__/hook-output-budget.test.ts), so its refusal cannot be a
    // diagnostic. It is in the process memo instead.
    tmp = makeFutureRoot();
    const before = fs.readdirSync(runDirOf(tmp)).sort();
    const r = runHook(
      path.join(ROOT, "hooks", "dist", "run-trace-close.js"),
      JSON.stringify({ session_id: "t10", hook_event_name: "Stop" }),
      { GUILD_RUN_ID: RUN, GUILD_CWD: tmp },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
    expect(fs.readdirSync(runDirOf(tmp)).sort()).toEqual(before);
  });

  it("an UNMARKED root still bootstraps — the refusal is specific to a FUTURE layout", () => {
    tmp = makeUnmarkedRootCommitted();
    const marker = path.join(tmp, ".guild", "storage-layout.json");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      CLAUDE_PLUGIN_ROOT: ROOT,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain("layout refused");
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"))).toBe(true);
  });
});

// ── skip-recorded compaction without PreCompact (rework-r1 P2) ──────────────

describe("a skip-recorded compaction rung keeps its snapshot current from the tool path", () => {
  it("a Write event with NO PreCompact writes the snapshot and the rung record", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rehydrate"))).toBe(false);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_TASK_ID: "T10-x",
      GUILD_COMPACTION_RUNG: "skip-recorded",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const snapshot = readJson(path.join(runDirOf(tmp), "rehydrate", "compaction.json"));
    expect(snapshot["schema_version"]).toBe(COMPACTION_REHYDRATE_SCHEMA);
    expect(snapshot["rung"]).toBe("skip-recorded");
    // It MATCHES the disk state, not an empty shell.
    expect((snapshot["sources"] as Record<string, boolean>)["goal_status"]).toBe(true);
    expect((snapshot["sources"] as Record<string, boolean>)["workflow_cursor"]).toBe(true);
    expect((snapshot["sources"] as Record<string, boolean>)["assignment"]).toBe(true);
    expect((snapshot["sources"] as Record<string, boolean>)["progress_ledger"]).toBe(true);
    const recent = (snapshot["goal_status"] as Record<string, unknown>)["recent"] as unknown[];
    expect(recent).toHaveLength(5);
    const rung = readJson(path.join(runDirOf(tmp), "rungs", "compaction.json"));
    expect(rung["state"]).toBe("skip-recorded");
    expect(String(rung["reason"])).toContain("tool path");
  });

  it("the refresh is bounded by a cadence, so it is not per tool call", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const env = {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
      GUILD_COMPACTION_RUNG: "skip-recorded",
    };
    runHook(POST_TOOL_USE, editPayload(tmp), env);
    const snapPath = path.join(runDirOf(tmp), "rehydrate", "compaction.json");
    const first = readJson(snapPath)["taken_at"];
    runHook(POST_TOOL_USE, editPayload(tmp), env);
    // Inside SNAPSHOT_MAX_AGE_MS the second call leaves it alone: `snapshotIsStale`
    // is one stat, which is what keeps this inside the 250ms green budget.
    expect(readJson(snapPath)["taken_at"]).toBe(first);
    expect(snapshotIsStale(runDirOf(tmp))).toBe(false);
    expect(snapshotIsStale(runDirOf(tmp), 0)).toBe(true);
  });

  it("a NATIVE compaction rung writes no snapshot from the tool path", () => {
    // Only the skip-recorded rung needs the tool path to stand in for an event
    // the host does not have; a native host gets it from PreCompact.
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(runDirOf(tmp), "rehydrate"))).toBe(false);
  });
});

// ── F2 ───────────────────────────────────────────────────────────────────────

describe("F2 a 50k test log reaching T1 is a truncated pointer", () => {
  it("caps the payload at 2000 tokens and leaves the full bytes on disk", () => {
    tmp = makeRoot();
    const fiftyK = "FAILED test/thing.spec.ts line\n".repeat(7000); // ~50k tokens
    expect(estimateTokens(fiftyK)).toBeGreaterThan(50_000);
    const r = truncateToolResultForParent({
      text: fiftyK,
      toolName: "Bash",
      id: "span-1",
      runDir: runDirOf(tmp),
    });
    expect(r.truncated).toBe(true);
    expect(r.tokens).toBeLessThanOrEqual(KTD26_TOKEN_CAP);
    expect(r.text).toContain("truncated to the KTD26");
    expect(r.log_path).not.toBeNull();
    expect(r.text).toContain(String(r.log_path));
    expect(fs.readFileSync(r.log_path as string, "utf8")).toBe(fiftyK);
  });

  it("is the identity for a small result — the firewall does not tax the common case", () => {
    tmp = makeRoot();
    const small = "2 passed, 0 failed\n";
    const r = truncateToolResultForParent({
      text: small,
      toolName: "Bash",
      id: "span-2",
      runDir: runDirOf(tmp),
    });
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(small);
    expect(r.log_path).toBeNull();
    expect(fs.existsSync(path.join(runDirOf(tmp), "tool-results"))).toBe(false);
  });

  it("the SHIPPED hook turns a 50k-token check log into a pointer on stderr", () => {
    // This is the seam where the cap is load-bearing: a verify FAILURE is the
    // one path on which a hook pushes tool output into a parent's context, and
    // stderr is that channel. 50k tokens of check output must arrive as a
    // ≤2000-token pointer with the bytes on disk.
    tmp = makeRoot();
    declareCheck(
      tmp,
      // `process.exitCode`, not `process.exit()`: exiting immediately after a
      // 200 KB write drops the un-flushed tail and the fixture would then be
      // asserting on a truncation the harness caused.
      'process.stdout.write("FAILED test/widget.spec.ts:12 expected 1 to equal 2\\n".repeat(4000)); process.exitCode = 1;',
    );
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(estimateTokens(r.stderr)).toBeLessThanOrEqual(KTD26_TOKEN_CAP);
    expect(r.stderr).toContain("truncated to the KTD26");
    const [log] = verifyLogs(tmp);
    expect(log).toBeDefined();
    expect(r.stderr).toContain(log!);
    // The oracle itself is NOT truncated on disk.
    expect(estimateTokens(fs.readFileSync(log, "utf8"))).toBeGreaterThan(50_000);
  });

  it("the event log's result excerpt stays within the KTD26 cap", () => {
    // The JSONL field is already bounded by the schema's 4 KiB redaction cap, so
    // the pointer does not appear here — what is asserted is the CAP, which is
    // the contract, not the mechanism that happens to satisfy it.
    tmp = makeRoot();
    const fiftyK = "FAILED test/widget.spec.ts:12 expected 1 to equal 2\n".repeat(4000);
    const r = runHook(
      POST_TOOL_USE,
      editPayload(tmp, { success: true, stdout: fiftyK }),
      { GUILD_RUN_ID: RUN, GUILD_CWD: tmp },
    );
    expect(r.status).toBe(0);
    const toolCall = fs
      .readFileSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((e) => e["event"] === "tool_call");
    expect(toolCall).toBeDefined();
    const excerpt = String((toolCall as Record<string, unknown>)["result_excerpt_redacted"] ?? "");
    expect(excerpt.length).toBeGreaterThan(0);
    expect(estimateTokens(excerpt)).toBeLessThanOrEqual(KTD26_TOKEN_CAP);
  });
});

// ── F3 ───────────────────────────────────────────────────────────────────────

/** The five disk sources a compaction rehydrate reads. */
function seedRehydrateSources(root: string): void {
  const runDir = runDirOf(root);
  fs.writeFileSync(
    path.join(runDir, "workflow-cursor.json"),
    `${JSON.stringify({
      schema_version: "guild.workflow_cursor.v1",
      run_id: RUN,
      class: "product",
      graph_id: "product",
      node_id: "build",
      bound_from: "intake",
    })}\n`,
  );
  fs.mkdirSync(path.join(runDir, "goal-status"), { recursive: true });
  for (let i = 1; i <= 7; i++) {
    fs.writeFileSync(
      path.join(runDir, "goal-status", `${String(i).padStart(3, "0")}-cell-${i}.json`),
      `${JSON.stringify({
        schema_version: "guild.goal_status.v1",
        run_id: RUN,
        goal_id: "g1",
        phase_id: "build",
        cell_id: `cell-${i}`,
        team_id: "t1",
        state: "done",
        progress: 1,
        worker_count: 1,
        handoff_ids: [],
        summary: `cell ${i} finished`,
      })}\n`,
    );
  }
  const cellDir = path.join(runDir, "task-cells", "T10-x");
  const instanceDir = path.join(cellDir, "attempts", "1", "instances", "i1");
  fs.mkdirSync(instanceDir, { recursive: true });
  fs.writeFileSync(
    path.join(instanceDir, "assignment.json"),
    `${JSON.stringify({ schema_version: "guild.task_assignment.v2", logical_task_id: "T10-x" })}\n`,
  );
  fs.writeFileSync(
    path.join(cellDir, "progress-ledger.json"),
    `${JSON.stringify({
      schema_version: "guild.progress_ledger.v1",
      cell_id: "cell-1",
      run_id: RUN,
      logical_task_id: "T10-x",
      updated_at: "2026-09-16T00:00:00.000Z",
      items: [{ id: "inner-verify", state: "pass", oracle: "verify.after_edit" }],
    })}\n`,
  );
}

describe("F3 the compaction fixture rehydrates from disk, never from a transcript summary", () => {
  it("reads all five sources off disk and folds goal_status to the last five", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const s = rehydrateFromDisk({
      runDir: runDirOf(tmp),
      cwd: tmp,
      runId: RUN,
      logicalTaskId: "T10-x",
    });
    expect(s.sources).toEqual({
      working_set: false, // the card is a rebuildable cache; absent in a fresh fixture
      goal_status: true,
      assignment: true,
      progress_ledger: true,
      workflow_cursor: true,
    });
    expect(s.goal_status.recent).toHaveLength(5);
    expect(s.goal_status.recent.map((e) => e.cell_id)).toEqual([
      "cell-3",
      "cell-4",
      "cell-5",
      "cell-6",
      "cell-7",
    ]);
    expect(s.goal_status.rolling_summary).toContain("2 earlier cells");
    expect(s.progress_ledger?.items[0]?.state).toBe("pass");
    expect(s.workflow_cursor?.node_id).toBe("build");
    expect(s.assignment?.["logical_task_id"]).toBe("T10-x");
  });

  it("a host transcript summary cannot reach the rehydrate — the hook ignores its own payload text", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const decoy = "TRANSCRIPT-SUMMARY-DECOY-ba9f";
    const r = runHook(
      PRE_COMPACT,
      JSON.stringify({
        session_id: "t10",
        // Everything a host could plausibly hand a PreCompact hook.
        payload: { summary: decoy, transcript: decoy },
        custom_instructions: decoy,
      }),
      { GUILD_RUN_ID: RUN, GUILD_CWD: tmp },
    );
    expect(r.status).toBe(0);
    // The pointers came from the files...
    expect(r.stdout).toContain("Guild rehydrate (from disk, not from this summary)");
    expect(r.stdout).toContain("cell-7=done");
    expect(r.stdout).toContain("at node build");
    // ...and nothing the payload said appears in what the next turn will read.
    expect(r.stdout).not.toContain(decoy);
  });

  it("with the disk sources gone the rehydrate is empty — it has no second source to fall back on", () => {
    tmp = makeRoot();
    const s = rehydrateFromDisk({ runDir: runDirOf(tmp), cwd: tmp, runId: RUN });
    expect(Object.values(s.sources).every((v) => v === false)).toBe(true);
    expect(s.goal_status.recent).toHaveLength(0);
    // And the renderer stays inside the KTD26 budget whatever it found.
    seedRehydrateSources(tmp);
    const full = rehydrateFromDisk({
      runDir: runDirOf(tmp),
      cwd: tmp,
      runId: RUN,
      logicalTaskId: "T10-x",
    });
    expect(estimateTokens(renderRehydrateInstructions(full))).toBeLessThanOrEqual(KTD26_TOKEN_CAP);
  });

  it("R33 · T0 holds only goal_status: an assignment or a contaminated envelope on disk never reaches the rehydrated context", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const dir = path.join(runDirOf(tmp), "goal-status");
    const marker = "SMUGGLED-ASSIGNMENT-7c1e";
    // A raw assignment dropped into the goal-status channel...
    fs.writeFileSync(
      path.join(dir, "008-cell-8.json"),
      `${JSON.stringify({ schema_version: "guild.task_assignment.v2", logical_task_id: marker })}\n`,
    );
    // ...and a schema-valid goal_status carrying a nested assignment.
    fs.writeFileSync(
      path.join(dir, "009-cell-9.json"),
      `${JSON.stringify({
        schema_version: "guild.goal_status.v1",
        run_id: RUN,
        goal_id: "g1",
        phase_id: "build",
        cell_id: "cell-9",
        team_id: "t1",
        state: "running",
        progress: 0.5,
        worker_count: 1,
        handoff_ids: [],
        summary: "cell 9 running",
        detail: { inner: { schema_version: "guild.task_assignment.v2", logical_task_id: marker } },
      })}\n`,
    );
    const s = rehydrateFromDisk({ runDir: runDirOf(tmp), cwd: tmp, runId: RUN });
    expect(s.goal_status.recent.map((e) => e.cell_id)).toEqual(["cell-3", "cell-4", "cell-5", "cell-6", "cell-7"]);
    expect(JSON.stringify(s.goal_status)).not.toContain(marker);
    const r = runHook(PRE_COMPACT, JSON.stringify({ session_id: "t10" }), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cell-7=done");
    expect(r.stdout).not.toContain("cell-9");
    expect(r.stdout).not.toContain(marker);
  });

  it("writeRehydrateHeartbeat is latest-only — a second heartbeat REPLACES the first", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    const first = rehydrateFromDisk({
      runDir: runDirOf(tmp),
      cwd: tmp,
      runId: RUN,
      rung: "skip-recorded",
      now: () => "2026-09-16T00:00:00.000Z",
    });
    const paths = writeRehydrateHeartbeat(runDirOf(tmp), first);
    const second = rehydrateFromDisk({
      runDir: runDirOf(tmp),
      cwd: tmp,
      runId: RUN,
      rung: "skip-recorded",
      now: () => "2026-09-16T01:00:00.000Z",
    });
    writeRehydrateHeartbeat(runDirOf(tmp), second);
    const onDisk = readJson(paths.snapshot_path as string);
    expect(onDisk["taken_at"]).toBe("2026-09-16T01:00:00.000Z");
    expect(fs.readdirSync(path.join(runDirOf(tmp), "rehydrate")).sort()).toEqual([
      "compaction.json",
    ]);
  });
});

// ── F5 / F6 ─────────────────────────────────────────────────────────────────

describe("F5 current-run-id is never recreated · F6 detection reads the run record + env", () => {
  it("neither hook writes a sentinel, at either location, on any path", () => {
    tmp = makeRoot();
    seedRehydrateSources(tmp);
    declareCheck(tmp, "process.exit(0);");
    runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    runHook(PRE_COMPACT, JSON.stringify({ session_id: "t10" }), {
      GUILD_RUN_ID: RUN,
      GUILD_CWD: tmp,
    });
    expect(fs.existsSync(path.join(tmp, ".guild", "current-run-id"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", "current-run-id"))).toBe(false);
  });

  it("a sentinel with no GUILD_RUN_ID does NOT authorize a write (C2: intake only)", () => {
    tmp = makeRoot();
    // Both sentinel locations, both naming a real run directory.
    fs.writeFileSync(path.join(tmp, ".guild", "runs", "current-run-id"), `${RUN}\n`);
    fs.writeFileSync(path.join(tmp, ".guild", "current-run-id"), `${RUN}\n`);
    declareCheck(tmp, "process.exit(0);");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("GUILD_RUN_ID unset");
    // No tool_call event was authorized by the sentinel.
    expect(fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"))).toBe(false);
  });

  it("incomplete-run detection is the run RECORD plus env, not a sentinel", () => {
    tmp = makeRoot();
    expect(runRecordExists(runDirOf(tmp))).toBe(true);
    const withoutRecord = makeRoot({ runRecord: false });
    try {
      // A sentinel naming the run does not make it detectable...
      fs.writeFileSync(path.join(withoutRecord, ".guild", "runs", "current-run-id"), `${RUN}\n`);
      expect(runRecordExists(runDirOf(withoutRecord))).toBe(false);
      // ...and PreCompact therefore writes no rehydrate snapshot for it.
      const r = runHook(PRE_COMPACT, JSON.stringify({ session_id: "t10" }), {
        GUILD_RUN_ID: RUN,
        GUILD_CWD: withoutRecord,
        GUILD_COMPACTION_RUNG: "skip-recorded",
      });
      expect(r.status).toBe(0);
      expect(fs.existsSync(path.join(runDirOf(withoutRecord), "rehydrate"))).toBe(false);
    } finally {
      fs.rmSync(withoutRecord, { recursive: true, force: true });
    }
  });
});

// ── work-loop events ────────────────────────────────────────────────────────

describe("the four work-loop event kinds ride the EXISTING log (KTD38: no third JSONL)", () => {
  it("each kind lands on v1.4-events.jsonl and nothing else is created", () => {
    tmp = makeRoot();
    const runDir = runDirOf(tmp);
    expect(emitLoopEvent(runDir, {
      ts: "2026-09-16T00:00:00.000Z",
      event: "harvest_event",
      run_id: RUN,
      op_id: "op-1",
      trigger: "redirect_threshold",
      status: "planned",
    })).toEqual({ emitted: true });
    expect(emitLoopEvent(runDir, {
      ts: "2026-09-16T00:00:01.000Z",
      event: "redirect_event",
      run_id: RUN,
      agent_id: "developer",
      topic_key: "retry-loop",
      count: 3,
      fired: true,
    })).toEqual({ emitted: true });
    expect(emitLoopEvent(runDir, {
      ts: "2026-09-16T00:00:02.000Z",
      event: "cas_event",
      run_id: RUN,
      target: "wiki/decisions/x.md",
      outcome: "won",
    })).toEqual({ emitted: true });
    expect(emitLoopEvent(runDir, {
      ts: "2026-09-16T00:00:03.000Z",
      event: "curator_event",
      run_id: RUN,
      target_type: "playbook",
      target_path: "agents/developer.md",
      op: "replace",
      span: "## Method",
      applied: true,
    })).toEqual({ emitted: true });

    const lines = fs
      .readFileSync(path.join(runDir, "logs", "v1.4-events.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.map((e) => e["event"])).toEqual([...LOOP_EVENT_KINDS]);
    // No third JSONL: the only .jsonl files are the live log and the pairing sidecar.
    const jsonl = fs
      .readdirSync(path.join(runDir, "logs"))
      .filter((n) => n.endsWith(".jsonl"))
      .sort();
    expect(jsonl).toEqual(["v1.4-events.jsonl"]);
  });

  it("the checkpoint ENQUEUES harvest on a wiki verdict and still writes no wiki (KTD43)", () => {
    tmp = makeRoot();
    writeCheckpoint({
      runId: RUN,
      phase: "development",
      evidenceRef: "none",
      guildRoot: tmp,
      decisions: { ...ALL_NONE_DECISIONS, wiki: "record the rung decision" },
      observed: [],
    });
    const events = fs
      .readFileSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const harvest = events.find((e) => e["event"] === "harvest_event");
    expect(harvest).toBeDefined();
    // ENQUEUE, not write: status `planned`, and no page path on the event.
    expect(harvest?.["status"]).toBe("planned");
    expect(harvest?.["wiki_path"]).toBeUndefined();
    // KTD43: the checkpoint is not the writer.
    expect(fs.existsSync(path.join(tmp, ".guild", "wiki"))).toBe(false);
  });

  it("an all-none checkpoint enqueues nothing — the no-op is the common case", () => {
    tmp = makeRoot();
    writeCheckpoint({
      runId: RUN,
      phase: "development",
      evidenceRef: "none",
      guildRoot: tmp,
      decisions: { ...ALL_NONE_DECISIONS },
      observed: [],
    });
    expect(fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"))).toBe(false);
  });

  it("refuses a kind outside the closed four rather than letting the lenient reader drop it", () => {
    tmp = makeRoot();
    const r = emitLoopEvent(runDirOf(tmp), {
      ts: "2026-09-16T00:00:00.000Z",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      event: "harvest_evnt" as any,
      run_id: RUN,
    } as never);
    expect(r.emitted).toBe(false);
    expect(fs.existsSync(path.join(runDirOf(tmp), "logs", "v1.4-events.jsonl"))).toBe(false);
  });
});

// ── config reader (rework-r1 P1 #1) ─────────────────────────────────────────

describe("readVerifyCheck separates ABSENT from INVALID and never defaults a field", () => {
  it("accepts a well-formed declaration", () => {
    tmp = makeRoot();
    const p = path.join(tmp, ".guild", "verify.json");
    fs.writeFileSync(
      p,
      JSON.stringify({
        schema_version: "guild.verify_checks.v1",
        checks: { "verify.after_edit": { command: "npm", args: ["test"], timeout_ms: 500 } },
      }),
    );
    expect(readVerifyCheck(p)).toEqual({
      kind: "ok",
      spec: { command: "npm", args: ["test"], timeout_ms: 500 },
    });
  });

  it("a missing file or an undeclared oracle is ABSENT — a recorded skip, not a failure", () => {
    tmp = makeRoot();
    const p = path.join(tmp, ".guild", "verify.json");
    expect(readVerifyCheck(p)).toEqual({ kind: "absent" });
    fs.writeFileSync(
      p,
      JSON.stringify({ schema_version: "guild.verify_checks.v1", checks: { other: {} } }),
    );
    expect(readVerifyCheck(p)).toEqual({ kind: "absent" });
  });

  it("every malformed field is INVALID and names itself — never coerced to a default", () => {
    tmp = makeRoot();
    const p = path.join(tmp, ".guild", "verify.json");
    const cases: Array<[string, string]> = [
      ["{", "document (not JSON)"],
      [JSON.stringify([1, 2]), "document (not an object)"],
      [JSON.stringify({ schema_version: "guild.verify_checks.v2", checks: {} }), "schema_version"],
      [JSON.stringify({ schema_version: "guild.verify_checks.v1" }), "checks"],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": [] },
        }),
        'checks["verify.after_edit"]',
      ],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { command: "" } },
        }),
        "command",
      ],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { args: ["test"] } },
        }),
        "command",
      ],
      // The exact defect codex found: one non-string element in `args`. Coercing
      // it to [] ran bare `node`, which exits 0, and the rung recorded a PASS.
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { command: "node", args: ["-e", "process.exit(3)", 1] } },
        }),
        "args",
      ],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { command: "node", args: "not-an-array" } },
        }),
        "args",
      ],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { command: "node", timeout_ms: 0 } },
        }),
        "timeout_ms",
      ],
      [
        JSON.stringify({
          schema_version: "guild.verify_checks.v1",
          checks: { "verify.after_edit": { command: "node", timeout_ms: "30s" } },
        }),
        "timeout_ms",
      ],
    ];
    for (const [body, field] of cases) {
      fs.writeFileSync(p, body);
      expect(readVerifyCheck(p)).toEqual({ kind: "invalid", field });
    }
  });

  it("the SHIPPED hook records fail/not-ran on a malformed table and spawns nothing", () => {
    tmp = makeRoot();
    // `args` carries a number. Before the fix this ran bare `node`, exited 0 and
    // recorded `pass`; the marker proves nothing was spawned either way.
    const marker = path.join(tmp, ".guild", "spawned.marker");
    fs.writeFileSync(
      path.join(tmp, ".guild", "verify.json"),
      JSON.stringify({
        schema_version: "guild.verify_checks.v1",
        checks: {
          "verify.after_edit": {
            command: process.execPath,
            args: ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`, 1],
          },
        },
      }),
    );
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(fs.existsSync(marker)).toBe(false);
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("fail");
    expect(record["reason"]).toBe("malformed-check-table: args");
    expect(record["exit_code"]).toBeNull();
    // Never skip-recorded: a declared-but-unreadable table is not an absent one.
    expect(record["rung"]).not.toBe("skip-recorded");
  });
});

// ── the oracle log is complete, whatever its size (rework-r1 P1 #3) ─────────

describe("a large oracle output streams to disk instead of ENOBUFS", () => {
  it("a 2 MiB oracle log lands COMPLETE and the run is honoured, not reported unrunnable", () => {
    tmp = makeRoot();
    // 2 MiB is over spawnSync's 1 MiB default maxBuffer. Buffered, this spawn
    // died with ENOBUFS, the record said `oracle-unrunnable`, and the "full log
    // on disk" was a fragment.
    declareCheck(
      tmp,
      'const l = "y".repeat(1024) + "\\n";' +
        'for (let i = 0; i < 2048; i++) process.stdout.write(l);' +
        "process.exitCode = 7;",
    );
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("fail");
    expect(record["ran"]).toBeUndefined(); // `ran` is on the outcome, not the record
    expect(record["exit_code"]).toBe(7);
    expect(record["reason"]).toBe("check-failed: exit 7");
    expect(String(record["reason"])).not.toContain("oracle-unrunnable");
    const [log] = verifyLogs(tmp);
    expect(log).toBeDefined();
    expect(record["log_path"]).toBe(log);
    expect(fs.statSync(log!).size).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    expect(record["log_bytes"] as number).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    // The excerpt the host sees is still capped, and names the complete log.
    expect(estimateTokens(r.stderr)).toBeLessThanOrEqual(KTD26_TOKEN_CAP);
    expect(r.stderr).toContain(log!);
  });

  it("a PASSING check leaves no log behind — the run tree keeps only failures", () => {
    tmp = makeRoot();
    declareCheck(tmp, "process.exitCode = 0;");
    const r = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(r.status).toBe(0);
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    expect(record["state"]).toBe("pass");
    expect(record["log_path"]).toBeUndefined();
    expect(verifyLogs(tmp)).toHaveLength(0);
  });

  it("two overlapping checks on one run keep the failing check's complete log (codex G-lane r2)", async () => {
    // Check A: slow, fails with ~56 KiB of output. Check B: instant pass. B runs
    // while A is still writing; A's evidence must survive B's pass-path cleanup.
    // The FIRST oracle to claim the lock (exclusive create) is the slow failing
    // one; every later oracle passes at once. Order-based, so it holds however
    // long the hook takes to reach its spawn.
    tmp = makeRoot();
    const first = path.join(tmp, ".guild", "first-oracle");
    declareCheck(
      tmp,
      `const fs = require("fs"); let slow = false;` +
        `try { fs.writeFileSync(${JSON.stringify(first)}, "", { flag: "wx" }); slow = true; } catch {}` +
        `if (!slow) { process.exitCode = 0; } else {` +
        `  process.stdout.write("A-LINE expected 1 to equal 2\\n".repeat(2048));` +
        `  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);` +
        `  process.exitCode = 7; }`,
    );
    const base: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith("GUILD_") || v === undefined) continue;
      base[k] = v;
    }
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const a = spawn(process.execPath, [POST_TOOL_USE], {
      env: { ...base, GUILD_RUN_ID: RUN, GUILD_CWD: tmp },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let aStderr = "";
    a.stderr.on("data", (d: Buffer) => (aStderr += d.toString()));
    a.stdout.on("data", () => undefined);
    const aExit = new Promise<number | null>((resolve) => a.on("exit", (code) => resolve(code)));
    a.stdin.end(editPayload(tmp));
    // Wait until A's oracle has claimed the lock (it is then mid-sleep with its
    // log open), then run B to completion while A is still running.
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(first) && Date.now() < deadline) await sleep(25);
    expect(fs.existsSync(first)).toBe(true);
    const b = runHook(POST_TOOL_USE, editPayload(tmp), { GUILD_RUN_ID: RUN, GUILD_CWD: tmp });
    expect(b.status).toBe(0);
    expect(b.stdout).toBe("");
    expect(await aExit).toBe(0);
    const logs = verifyLogs(tmp);
    expect(logs).toHaveLength(1);
    expect(fs.statSync(logs[0]!).size).toBeGreaterThanOrEqual(2048 * 28);
    expect(fs.readFileSync(logs[0]!, "utf8")).toContain("A-LINE");
    expect(aStderr).toContain(logs[0]!);
    const record = readJson(path.join(runDirOf(tmp), "rungs", "verify-after-edit.json"));
    // Latest-only record: the last writer is A (it finished after B).
    expect(record["state"]).toBe("fail");
    expect(record["log_path"]).toBe(logs[0]);
    expect(record["log_bytes"] as number).toBeGreaterThanOrEqual(2048 * 28);
  });
});

// ── F7 ──────────────────────────────────────────────────────────────────────

describe("F7 hook source edits are rebuilt into dist", () => {
  it("every symbol this lane added to a hook source is present in the compiled bundle", () => {
    const post = fs.readFileSync(POST_TOOL_USE, "utf8");
    for (const symbol of [
      "runVerifyAfterEdit",
      "VERIFY_CHECKS_FILENAME",
      "guild.rung_record.v1",
      "truncateToolResultForParent",
      "ensureStorageLayout",
      "truncated to the KTD26",
    ]) {
      expect(post).toContain(symbol);
    }
    const pre = fs.readFileSync(PRE_COMPACT, "utf8");
    for (const symbol of [
      "rehydrateFromDisk",
      "guild.compaction_rehydrate.v1",
      "writeRehydrateHeartbeat",
      "ensureStorageLayout",
    ]) {
      expect(pre).toContain(symbol);
    }
    // And the sentinel READER is gone from both entries, source and bundle.
    //
    // The assertion is on the reader, not on the string: both files still
    // mention the sentinel in prose, and both bundles still contain it from
    // libraries that legitimately name it — the layout upgrade chain has a
    // `current-run-id-retire` step, and `lib/reanchor.ts` reads the sentinel as
    // interactive INTAKE to name a candidate run. What R71/C2 forbid is a
    // sentinel AUTHORIZING a write; that is these two entries' own run-id
    // resolution, which the F5 runtime fixture covers end to end.
    for (const src of ["post-tool-use.ts", "pre-compact.ts"]) {
      const text = fs.readFileSync(path.join(ROOT, "hooks", src), "utf8");
      expect(text).not.toContain("readCurrentRunId");
      expect(text).not.toContain('"runs", "current-run-id"');
    }
    expect(post).not.toContain("readCurrentRunId");
    expect(pre).not.toContain("readCurrentRunId");
  });
});

/** The marker path `declareCheck` uses, needed inside the check body string. */
function marker0(root: string): string {
  return path.join(root, ".guild", "check.marker");
}
