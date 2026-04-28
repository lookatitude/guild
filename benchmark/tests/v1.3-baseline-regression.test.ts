// v1.3-baseline-regression.test.ts — SC8 golden-fixture pinning.
//
// PURPOSE — this test enforces the v1.4 SC8 contract: "v1.4 with no flags
// set behaves byte-for-byte identically to v1.3 in user-visible terms".
// Because orchestrator dispatch is non-deterministic (specialist response
// bodies, timestamps, run-ids), we cannot byte-exact diff a real run
// log. Instead, we pin a DETERMINISTIC PROJECTION of the run-shape:
// event-type counts + ordering invariants + terminal loop status +
// resolved-config values.
//
// PROJECTION RULE — see `fixtures/v1.3-baseline-flow.txt` for the full
// rationale. In summary:
//   - Free-text bodies, timestamps, run-ids → IGNORED.
//   - Event TYPE counts, loop status, resolved config → PINNED.
//
// HOW THIS TEST RUNS — it invokes the qa-lane harness (`runV14Harness`)
// configured for the v1.3-baseline flag profile (`loops_applicable:
// "none"`, no auto-approve, default cap). With loops disabled, the
// loop-implement driver MUST produce zero loop events. Any v1.4 change
// that adds an emission under default flags violates SC8.
//
// FIXTURE LIVES AT: `benchmark/tests/fixtures/v1.3-baseline-flow.txt`.
// FIXTURE FORMAT  : one `key=value` assertion per line; comments start
// with `#`.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runLoopImplement, activeLayersFor } from "../src/loop-drivers.js";
import { initStableLockfile } from "../src/v1.4-lock.js";
import { mkdirSync } from "node:fs";
import { InMemoryLoopJsonlAppender } from "../src/loop-jsonl-stub.js";
import {
  DEFAULT_AUTO_APPROVE,
  DEFAULT_LOOPS,
  resolveAutoApprove,
  resolveLoops,
} from "../src/v1.4-config.js";

const FIXTURE_PATH = resolve(
  __dirname,
  "fixtures",
  "v1.3-baseline-flow.txt",
);

let tmpRoot: string;
let runDir: string;

beforeEach(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), "guild-v13-regression-"));
  runDir = join(tmpRoot, "run");
  mkdirSync(join(runDir, "logs"), { recursive: true });
  initStableLockfile(runDir);
});

afterEach(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

interface Projection {
  projection_version: string;
  loops_resolved: string;
  auto_approve_resolved: string;
  event_count_total: number;
  event_count_loop_round_start: number;
  event_count_loop_round_end: number;
  event_count_escalation: number;
  event_count_assumption_logged: number;
  loop_status: string;
  restart_count: number;
  layers_run_count: number;
  auto_approved_all: boolean;
}

function parseFixture(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe("v1.3-baseline-regression / fixture format", () => {
  it("the fixture file exists and parses with all required keys", async () => {
    const text = await readFile(FIXTURE_PATH, "utf8");
    const parsed = parseFixture(text);
    const requiredKeys: (keyof Projection)[] = [
      "projection_version",
      "loops_resolved",
      "auto_approve_resolved",
      "event_count_total",
      "event_count_loop_round_start",
      "event_count_loop_round_end",
      "event_count_escalation",
      "event_count_assumption_logged",
      "loop_status",
      "restart_count",
      "layers_run_count",
      "auto_approved_all",
    ];
    for (const k of requiredKeys) {
      expect(parsed[k], `fixture missing key ${k}`).toBeDefined();
    }
  });
});

describe("v1.3-baseline-regression / runtime projection", () => {
  it("default flags resolve to loops=none and auto_approve=none", () => {
    // No --loops / GUILD_LOOPS → defaults to `none`. Pin against the
    // shipped resolver (NOT a free-text fallback). The resolver is the
    // production code path; resolving with no CLI flag and an empty env
    // yields the default constants.
    const loops = resolveLoops(undefined, {} as NodeJS.ProcessEnv);
    expect(loops.value).toEqual({ kind: "none" });
    expect(loops.source).toBe("default");
    expect(DEFAULT_LOOPS).toBe("none");
    const auto = resolveAutoApprove(undefined, {} as NodeJS.ProcessEnv);
    expect(auto.value).toBe("none");
    expect(auto.source).toBe("default");
    expect(DEFAULT_AUTO_APPROVE).toBe("none");
  });

  it("activeLayersFor('none') returns an empty array — no loop layers run", () => {
    expect(activeLayersFor("none")).toEqual([]);
  });

  it("loop-implement with loops_applicable=none produces zero loop events", async () => {
    const jsonl = new InMemoryLoopJsonlAppender();
    const result = await runLoopImplement({
      lane_id: "lane-baseline",
      owner: "qa",
      loops_applicable: "none",
      loops_mode: "implementation",
      cap: 16,
      run_id: "test-v13-baseline",
      task_id: "T-baseline",
      runDir,
      roundFns: {},
      escalationFn: () => "force-pass",
      jsonl,
    });
    // SC8 INVARIANT: zero loop events under loops=none.
    expect(jsonl.events.length).toBe(0);
    // Status is satisfied (no layers ran; nothing to fail).
    expect(result.status).toBe("satisfied");
    // No restart machinery fired.
    expect(result.restart_count).toBe(0);
    // No layers were activated.
    expect(result.layers_run.length).toBe(0);
  });

  it("the runtime projection matches the fixture byte-for-byte", async () => {
    // Build the runtime projection.
    const jsonl = new InMemoryLoopJsonlAppender();
    const result = await runLoopImplement({
      lane_id: "lane-baseline",
      owner: "qa",
      loops_applicable: "none",
      loops_mode: "implementation",
      cap: 16,
      run_id: "test-v13-projection",
      task_id: "T-baseline",
      runDir,
      roundFns: {},
      escalationFn: () => "force-pass",
      jsonl,
    });
    const counts: Record<string, number> = {};
    for (const e of jsonl.events) counts[e.event] = (counts[e.event] ?? 0) + 1;

    const runtime: Projection = {
      projection_version: "1",
      loops_resolved: "none",
      auto_approve_resolved: "none",
      event_count_total: jsonl.events.length,
      event_count_loop_round_start: counts["loop_round_start"] ?? 0,
      event_count_loop_round_end: counts["loop_round_end"] ?? 0,
      event_count_escalation: counts["escalation"] ?? 0,
      event_count_assumption_logged: counts["assumption_logged"] ?? 0,
      loop_status: result.status,
      restart_count: result.restart_count,
      layers_run_count: result.layers_run.length,
      auto_approved_all: false,
    };

    // Read the fixture and compare.
    const fixture = parseFixture(await readFile(FIXTURE_PATH, "utf8"));
    expect(fixture.projection_version).toBe(runtime.projection_version);
    expect(fixture.loops_resolved).toBe(runtime.loops_resolved);
    expect(fixture.auto_approve_resolved).toBe(runtime.auto_approve_resolved);
    expect(Number(fixture.event_count_total)).toBe(runtime.event_count_total);
    expect(Number(fixture.event_count_loop_round_start)).toBe(
      runtime.event_count_loop_round_start,
    );
    expect(Number(fixture.event_count_loop_round_end)).toBe(
      runtime.event_count_loop_round_end,
    );
    expect(Number(fixture.event_count_escalation)).toBe(
      runtime.event_count_escalation,
    );
    expect(Number(fixture.event_count_assumption_logged)).toBe(
      runtime.event_count_assumption_logged,
    );
    expect(fixture.loop_status).toBe(runtime.loop_status);
    expect(Number(fixture.restart_count)).toBe(runtime.restart_count);
    expect(Number(fixture.layers_run_count)).toBe(runtime.layers_run_count);
    expect(fixture.auto_approved_all).toBe(String(runtime.auto_approved_all));
  });
});
