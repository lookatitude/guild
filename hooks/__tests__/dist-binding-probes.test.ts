/**
 * hooks/__tests__/dist-binding-probes.test.ts
 *
 * T3b REWORK ROUND 2 — COMPILED-DIST negative controls for the four G-lane
 * blocking findings (review packet G-lane:T3b-hook-run-binding round 1).
 * Hooks run from the committed esbuild bundles, NOT from source — a
 * source-only fix is a no-op in production (hooks.json invokes
 * `node dist/<hook>.js`). Every probe here spawns the ACTUAL bundle the
 * host runs, with a hermetic env, against a throwaway repo root.
 *
 *  - F1 (dist/run-trace-start.js): a valid OPEN binding record exists on
 *    disk; GUILD_RUN_ID alone / a blank ref / a closed binding / a
 *    mismatched ref must produce NO trace write. Positive control: the
 *    exact pair writes run_started (anti-vacuity).
 *  - F2 (dist/post-tool-use.js): absent/blank/closed/mismatched refs must
 *    produce NO heartbeat and NO temp file even with GUILD_RUN_ID +
 *    GUILD_SPECIALIST exported. Positive control included.
 *  - F3 (agent-team/dist/teammate-idle.js): absent/closed/mismatched/
 *    moved-sentinel probes must produce NO agent-bus write anywhere
 *    (including a run-<session_id> fabricated target); the read-only
 *    stdout nudge still fires. Positive control included.
 *  - F4 (dist/run-trace-close.js): requiring the bundle as a MODULE must
 *    not execute main() (import-time process.exit(0) inside a Jest worker
 *    silently truncated the 50-suite aggregate — the false-green rail).
 *
 * If a bundle is missing the suite FAILS (never skips): stale/absent dist
 * is exactly the failure mode this suite exists to catch. Run
 * `npm run build` in hooks/ after any source edit.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mintTestBinding } from "../test-support/mint-binding";

const DIST_RUN_TRACE_START = path.resolve(__dirname, "../dist/run-trace-start.js");
const DIST_POST_TOOL_USE = path.resolve(__dirname, "../dist/post-tool-use.js");
const DIST_TEAMMATE_IDLE = path.resolve(__dirname, "../agent-team/dist/teammate-idle.js");
const DIST_RUN_TRACE_CLOSE = path.resolve(__dirname, "../dist/run-trace-close.js");
const SRC_RUN_TRACE_CLOSE = path.resolve(__dirname, "../run-trace-close.ts");

const RUN_ID = "run-dist-probe";
const SPECIALIST = "backend";

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-dist-probe-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  runDir = path.join(root, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Hermetic base env: node's needs, minus every ambient GUILD_* key. */
function hermeticEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GUILD_") && k !== "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS") {
      base[k] = v;
    }
  }
  return { ...base, ...extra };
}

function spawnBundle(
  bundle: string,
  input: string,
  env: Record<string, string>,
): { status: number; stdout: string; stderr: string } {
  expect(fs.existsSync(bundle)).toBe(true); // fail loud on missing/stale dist
  const r = spawnSync(process.execPath, [bundle], {
    input,
    encoding: "utf8",
    env: hermeticEnv(env),
    timeout: 20000,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Every file under dir (recursive, relative paths); [] when dir is absent. */
function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true }).map(String);
}

// ── F1 — dist/run-trace-start.js ────────────────────────────────────────────

describe("F1 COMPILED probe — dist/run-trace-start.js fails closed without a caller-presented ref", () => {
  const promptPayload = () =>
    JSON.stringify({ session_id: "sess-1", cwd: root, hook_event_name: "UserPromptSubmit" });

  function traceLines(): string[] {
    const f = path.join(runDir, "logs", "v1.4-events.jsonl");
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, "utf8").split("\n").filter((l) => l.trim().length > 0);
  }

  it("GUILD_RUN_ID alone (valid OPEN record on disk) writes NOTHING + emits binding_rejected", () => {
    mintTestBinding(root, RUN_ID); // the loadable-open-record escape the review probed
    const r = spawnBundle(DIST_RUN_TRACE_START, promptPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
    });
    expect(r.status).toBe(0);
    expect(traceLines()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_absent)");
  });

  it("a WHITESPACE ref (valid OPEN record on disk) writes NOTHING", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_RUN_TRACE_START, promptPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: "   ",
    });
    expect(r.status).toBe(0);
    expect(traceLines()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_absent)");
  });

  it("a CLOSED binding writes NOTHING even with the exact nonce", () => {
    const ref = mintTestBinding(root, RUN_ID, { state: "closed" });
    const r = spawnBundle(DIST_RUN_TRACE_START, promptPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: ref,
    });
    expect(r.status).toBe(0);
    expect(traceLines()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_closed)");
  });

  it("a MISMATCHED ref writes NOTHING", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_RUN_TRACE_START, promptPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: "rb-forged-nonce",
    });
    expect(r.status).toBe(0);
    expect(traceLines()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_mismatch)");
  });

  it("[positive control] the exact pair writes run_started (anti-vacuity)", () => {
    const ref = mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_RUN_TRACE_START, promptPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: ref,
    });
    expect(r.status).toBe(0);
    const lines = traceLines().map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.some((e) => e["event_name"] === "run_started")).toBe(true);
  });
});

// ── F2 — dist/post-tool-use.js heartbeat leg ────────────────────────────────

describe("F2 COMPILED probe — dist/post-tool-use.js heartbeat requires the verified envelope", () => {
  const postPayload = () =>
    JSON.stringify({
      session_id: "sess-1",
      cwd: root,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "ls" },
      tool_response: { success: true },
    });

  function expectNoHeartbeatAndNoTemp(): void {
    expect(fs.existsSync(path.join(runDir, "in-progress"))).toBe(false);
    expect(filesUnder(runDir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  }

  it("ABSENT ref (GUILD_RUN_ID + GUILD_SPECIALIST only, OPEN record on disk): no heartbeat, no temp file", () => {
    mintTestBinding(root, RUN_ID); // the exact escaped-mutation setup from the review probe
    const r = spawnBundle(DIST_POST_TOOL_USE, postPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_SPECIALIST: SPECIALIST,
    });
    expect(r.status).toBe(0);
    expectNoHeartbeatAndNoTemp();
  });

  it("BLANK ref: no heartbeat, no temp file", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_POST_TOOL_USE, postPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: "   ",
      GUILD_SPECIALIST: SPECIALIST,
    });
    expect(r.status).toBe(0);
    expectNoHeartbeatAndNoTemp();
  });

  it("CLOSED binding: no heartbeat, no temp file", () => {
    const ref = mintTestBinding(root, RUN_ID, { state: "closed" });
    const r = spawnBundle(DIST_POST_TOOL_USE, postPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: ref,
      GUILD_SPECIALIST: SPECIALIST,
    });
    expect(r.status).toBe(0);
    expectNoHeartbeatAndNoTemp();
  });

  it("MISMATCHED ref: no heartbeat, no temp file", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_POST_TOOL_USE, postPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: "rb-forged-nonce",
      GUILD_SPECIALIST: SPECIALIST,
    });
    expect(r.status).toBe(0);
    expectNoHeartbeatAndNoTemp();
  });

  it("[positive control] the exact pair writes the heartbeat (anti-vacuity)", () => {
    const ref = mintTestBinding(root, RUN_ID);
    const r = spawnBundle(DIST_POST_TOOL_USE, postPayload(), {
      GUILD_CWD: root,
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: ref,
      GUILD_SPECIALIST: SPECIALIST,
    });
    expect(r.status).toBe(0);
    const hb = path.join(runDir, "in-progress", `${SPECIALIST}.json`);
    expect(fs.existsSync(hb)).toBe(true);
    expect(JSON.parse(fs.readFileSync(hb, "utf8"))["last_action"]).toBe("Bash");
  });
});

// ── F3 — agent-team/dist/teammate-idle.js bus emit ──────────────────────────

describe("F3 COMPILED probe — agent-team/dist/teammate-idle.js idle bus event requires the verified envelope", () => {
  const SESSION = "sess-idle-probe";
  const idlePayload = () =>
    JSON.stringify({
      session_id: SESSION,
      cwd: root,
      hook_event_name: "TeammateIdle",
      teammate_name: SPECIALIST,
      team_name: "guild",
    });

  /** All agent-bus event files anywhere under .guild/runs (any run dir). */
  function busFiles(): string[] {
    const runsDir = path.join(root, ".guild", "runs");
    return filesUnder(runsDir).filter((f) => f.endsWith(path.join("agent-bus", "events.ndjson")));
  }

  function spawnIdle(env: Record<string, string>): ReturnType<typeof spawnBundle> {
    return spawnBundle(DIST_TEAMMATE_IDLE, idlePayload(), {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      ...env,
    });
  }

  it("ABSENT binding (no GUILD_RUN_ID, no ref, no record): NO bus write anywhere — no run-<session_id> fabrication; nudge still emitted", () => {
    const r = spawnIdle({});
    expect(r.status).toBe(0);
    expect(busFiles()).toEqual([]);
    // The fabricated fallback target must not exist at all.
    expect(fs.existsSync(path.join(root, ".guild", "runs", `run-${SESSION}`, "agent-bus"))).toBe(false);
    // Read-only nudge leg is intact (the hook is still useful without a binding).
    expect(r.stdout).toContain("[TeammateIdle");
    expect(r.stderr).toContain("binding_rejected");
  });

  it("GUILD_RUN_ID alone (OPEN record on disk): NO bus write", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnIdle({ GUILD_RUN_ID: RUN_ID });
    expect(r.status).toBe(0);
    expect(busFiles()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_absent)");
  });

  it("CLOSED binding: NO bus write even with the exact nonce", () => {
    const ref = mintTestBinding(root, RUN_ID, { state: "closed" });
    const r = spawnIdle({ GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: ref });
    expect(r.status).toBe(0);
    expect(busFiles()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_closed)");
  });

  it("MISMATCHED ref: NO bus write", () => {
    mintTestBinding(root, RUN_ID);
    const r = spawnIdle({ GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: "rb-forged-nonce" });
    expect(r.status).toBe(0);
    expect(busFiles()).toEqual([]);
    expect(r.stderr).toContain("binding_rejected (binding_mismatch)");
  });

  it("MOVED SENTINEL: a sentinel pointing at a validly-bound run cannot authorize or redirect the bus write", () => {
    mintTestBinding(root, RUN_ID);
    const sentinel = path.join(root, ".guild", "runs", "current-run-id");
    fs.writeFileSync(sentinel, `${RUN_ID}\n`, "utf8");
    const first = spawnIdle({});
    // Move the sentinel to a second bound run between invocations (SC-1).
    const OTHER = "run-dist-probe-other";
    fs.mkdirSync(path.join(root, ".guild", "runs", OTHER), { recursive: true });
    mintTestBinding(root, OTHER, { ref: "rb-other" });
    fs.writeFileSync(sentinel, `${OTHER}\n`, "utf8");
    const second = spawnIdle({});
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(busFiles()).toEqual([]); // neither invocation wrote to either run
  });

  it("[positive control] the exact pair writes the idle bus event under the BOUND run (anti-vacuity)", () => {
    const ref = mintTestBinding(root, RUN_ID);
    const r = spawnIdle({ GUILD_RUN_ID: RUN_ID, GUILD_RUN_BINDING_REF: ref });
    expect(r.status).toBe(0);
    const busFile = path.join(runDir, "agent-bus", "events.ndjson");
    expect(fs.existsSync(busFile)).toBe(true);
    const events = fs
      .readFileSync(busFile, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      schema_version: "guild.agent_bus_event.v1",
      run_id: RUN_ID,
      event: "idle",
      lane_id: SPECIALIST,
    });
  });
});

// ── F4 — run-trace-close import safety ──────────────────────────────────────

describe("F4 regression — run-trace-close is import-safe (no import-time main/process.exit)", () => {
  /**
   * Requiring the module must NOT schedule main(): the importer stays alive
   * long enough for a queued timer to fire. Before the fix, import-time
   * main() consumed the (closed) stdin and called process.exit(0), which
   * cancels all timers — so STILL_ALIVE never printed. Inside a Jest worker
   * the same exit(0) truncated the 50-suite aggregate into a false green.
   */
  it("COMPILED: requiring dist/run-trace-close.js does not execute main", () => {
    expect(fs.existsSync(DIST_RUN_TRACE_CLOSE)).toBe(true);
    const r = spawnSync(
      process.execPath,
      [
        "-e",
        `require(${JSON.stringify(DIST_RUN_TRACE_CLOSE)}); setTimeout(() => console.log("STILL_ALIVE"), 250);`,
      ],
      { encoding: "utf8", env: hermeticEnv({}), input: "", timeout: 20000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STILL_ALIVE");
  });

  it("SOURCE: requiring run-trace-close.ts under tsx does not execute main (twin of the Jest-worker import)", () => {
    const r = spawnSync(
      "npx",
      [
        "tsx",
        "-e",
        `require(${JSON.stringify(SRC_RUN_TRACE_CLOSE)}); setTimeout(() => console.log("STILL_ALIVE"), 250);`,
      ],
      { encoding: "utf8", env: hermeticEnv({}), input: "", timeout: 25000 },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("STILL_ALIVE");
  });

  it("[positive control] executing the compiled bundle AS THE ENTRY still runs main (exit 0, silent no-op without a run)", () => {
    const r = spawnBundle(DIST_RUN_TRACE_CLOSE, JSON.stringify({ cwd: root }), {
      GUILD_CWD: root,
    });
    expect(r.status).toBe(0); // main ran and exited via its no-active-run leg
  });
});
