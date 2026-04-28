// server.runsPost.live.test.ts
//
// HTTP integration covering the live POST /api/runs path through Hono +
// `runBenchmark` end-to-end. We mock `node:child_process.spawn` so the
// runner's spawn returns a FakeChild that emits a clean exit — that lets
// us drive 202+Location, 409 single-flight, and slot-recovery without
// shelling out to the real `claude` CLI (constraint per T4-qa brief).
//
// Why we mock spawn here rather than use a fake-claude shell script:
// `spawnAndWait` (runner.ts §spawnAndWait) does `await once(child, "exit")`
// THEN `await Promise.all([once(child.stdout,"end"), once(child.stderr,"end")])`.
// With a fast-exit child whose stdio is empty, 'end' fires BEFORE 'exit',
// so the post-exit `once(stream,"end")` deadlocks. Filed as a backend
// follow-up; the workaround here is to set FakeChild.stdout/stderr = null
// so the runner's `if (child.stdout)` guard short-circuits the once.

import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from "node:child_process";
import {
  _resetActiveRunForTests,
  createApp,
} from "../src/server.js";
import { ENV_CLAUDE_BIN } from "../src/runner.js";
import type { RunPostResponse } from "../src/types.js";
import { req } from "./server.helpers.js";

const spawnMock = spawn as unknown as MockedFunction<typeof spawn>;

class FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  stdout = null;
  stderr = null;
  // v1.1 / ADR-006 — stdin writable stand-in.
  stdin = {
    write: (): void => {},
    end: (): void => {},
    on: (): void => {},
  };
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
  // Defer through setImmediate so `await once(child, "exit")` can register
  // its listener before the event fires.
  scheduleCleanExit(code = 0): void {
    setImmediate(() => {
      this.exitCode = code;
      this.emit("exit", code, null);
    });
  }
}

let scratch: string;
let runsDir: string;
let casesDir: string;
let fixtureDir: string;
let fakeClaudeBin: string;
let nextPid = 30000;

async function seedFixture(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, ".guild"), { recursive: true });
  await writeFile(join(dir, ".guild", "marker.txt"), "marker\n", "utf8");
  await writeFile(join(dir, "README.md"), "fixture\n", "utf8");
}

async function seedLiveCase(opts: { slug: string; fixturePath: string }): Promise<void> {
  const yaml = [
    `schema_version: 1`,
    `id: ${opts.slug}`,
    `title: "live case ${opts.slug}"`,
    `timeout_seconds: 60`,
    `repetitions: 1`,
    `fixture: "${opts.fixturePath}"`,
    `prompt: "live test prompt"`,
    `expected_specialists:`,
    `  - architect`,
    `expected_stage_order:`,
    `  - brainstorm`,
    `acceptance_commands: []`,
    ``,
  ].join("\n");
  await writeFile(join(casesDir, `${opts.slug}.yaml`), yaml, "utf8");
}

// Wait for a runner's `run.json` to appear on disk — the runner only
// writes this AFTER spawnAndWait + capturePostRun complete. Polling a file
// path beats polling via POST (which would start *another* runner and
// race afterEach cleanup).
async function waitForRunJson(runId: string, capMs: number): Promise<boolean> {
  const target = join(runsDir, runId, "run.json");
  const start = Date.now();
  while (Date.now() - start < capMs) {
    if (existsSync(target)) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

// T9-flake-fix: `waitForRunJson` returns when the runner has WRITTEN run.json,
// but `runBenchmark` resolves a few microtasks LATER and only then does the
// `.finally` block on the POST handler clear `activeRun`. Tests that POST
// twice in sequence (the "slot clears after run completes" assertion) can
// therefore race the slot-clear and observe a 409 even though the system
// is functioning correctly.
//
// Poll-via-probe oracle: POST a body whose `case_slug` is shape-valid but
// has NO matching YAML on disk. Server flow:
//   - shape parse passes (slot not yet checked)
//   - if `activeRun` is held → 409 (oracle: still busy)
//   - else: claims slot, awaits planRun, catch-block sets `activeRun = null`
//     SYNCHRONOUSLY then returns 400 (oracle: idle, AND the slot is now
//     guaranteed-null when control returns to the test thread)
// Any non-409 response means the slot is clear by the time the await resolves.
async function waitForSlotClear(
  app: ReturnType<typeof createApp>,
  capMs: number,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < capMs) {
    const probe = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "t9-slot-clear-probe" }),
        headers: { "content-type": "application/json" },
      }),
    );
    // Drain the body so the response is fully consumed before the next probe.
    await probe.text();
    if (probe.status !== 409) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

// Install a spawn mock that returns FakeChild with a deferred clean exit.
function mockCleanSpawn(): { child: FakeChild } {
  const child = new FakeChild(nextPid++);
  spawnMock.mockImplementation(() => {
    child.scheduleCleanExit(0);
    return child as unknown as ReturnType<typeof spawn>;
  });
  return { child };
}

beforeEach(async () => {
  spawnMock.mockReset();
  _resetActiveRunForTests();
  scratch = await mkdtemp(join(tmpdir(), "qa-runs-live-"));
  runsDir = join(scratch, "runs");
  casesDir = join(scratch, "cases");
  fixtureDir = join(scratch, "fixture");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await seedFixture(fixtureDir);
  // Even though spawn is mocked, planRun's `resolveClaudeBinary()` still
  // needs ENV_CLAUDE_BIN to point at an existing absolute path.
  fakeClaudeBin = join(scratch, "fake-claude");
  await writeFile(fakeClaudeBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env[ENV_CLAUDE_BIN] = fakeClaudeBin;
});

afterEach(async () => {
  _resetActiveRunForTests();
  delete process.env[ENV_CLAUDE_BIN];
  await rm(scratch, { recursive: true, force: true });
});

describe("server / POST /api/runs (live, with mocked spawn)", () => {
  it("returns 202 with Location header + RunPostResponse body on success", async () => {
    await seedLiveCase({ slug: "live-202", fixturePath: fixtureDir });
    mockCleanSpawn();
    const app = createApp({ runsDir, casesDir, port: 0 });

    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "live-202" }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(res.status).toBe(202);
    const location = res.headers.get("Location");
    expect(location).toBeTruthy();
    expect(location).toMatch(/^\/api\/runs\//);
    const body = (await res.json()) as RunPostResponse;
    expect(body.run_id).toMatch(/^live-202-/);
    expect(body.location).toBe(location);
    expect(typeof body.started_at).toBe("string");
    expect(new Date(body.started_at).toString()).not.toBe("Invalid Date");

    // Drain so the next test starts clean.
    await waitForRunJson(body.run_id, 2000);
  });

  it("Location header points at the GET-able run detail path for the new run", async () => {
    await seedLiveCase({ slug: "live-loc", fixturePath: fixtureDir });
    mockCleanSpawn();
    const app = createApp({ runsDir, casesDir, port: 0 });

    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "live-loc" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as RunPostResponse;
    expect(body.location).toBe(`/api/runs/${body.run_id}`);
    await waitForRunJson(body.run_id, 2000);
  });

  it("returns 409 with run_id identifier when a second POST races a still-active run", async () => {
    await seedLiveCase({ slug: "live-409", fixturePath: fixtureDir });
    // Use a child whose exit is delayed so the slot stays held while we
    // fire the racing POST. We schedule exit on the SECOND spawn call so
    // the first runner stays in flight indefinitely from the test's
    // perspective.
    const child1 = new FakeChild(nextPid++);
    spawnMock.mockImplementationOnce(() => {
      // First runner: don't schedule exit yet — keep the slot held.
      return child1 as unknown as ReturnType<typeof spawn>;
    });
    const app = createApp({ runsDir, casesDir, port: 0 });

    const body = JSON.stringify({ case_slug: "live-409" });
    const headers = { "content-type": "application/json" };
    const [r1, r2] = await Promise.all([
      app.fetch(req("/api/runs", { method: "POST", body, headers })),
      app.fetch(req("/api/runs", { method: "POST", body, headers })),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([202, 409]);

    const conflicted = r1.status === 409 ? r1 : r2;
    const accepted = r1.status === 202 ? r1 : r2;
    const conflictBody = (await conflicted.json()) as Record<string, unknown>;
    const acceptedBody = (await accepted.json()) as RunPostResponse;

    // v1.2 — F11 closed: only `current_run_id` is present in the 409 body.
    // The deprecated `run_id` alias from v1.1 is removed. Pin the absence
    // explicitly so a regression flips the suite red.
    expect(typeof conflictBody.error).toBe("string");
    expect(conflictBody.run_id).toBeUndefined();
    const conflictRunId = conflictBody.current_run_id as string;
    expect(conflictRunId).toBeTruthy();
    // The slot may have been claimed before planRun resolved, in which case
    // the conflict body identifies the placeholder ("<resolving>"). After
    // planRun resolved, it becomes the real run_id. Pin BOTH possibilities.
    expect([acceptedBody.run_id, "<resolving>"]).toContain(conflictRunId);

    // Now release the held child so the runner finishes and the slot clears.
    child1.scheduleCleanExit(0);
    await waitForRunJson(acceptedBody.run_id, 2000);
  });

  it("clears the in-flight slot after the run completes (subsequent POST gets 202, not 409)", async () => {
    await seedLiveCase({ slug: "live-clear", fixturePath: fixtureDir });
    mockCleanSpawn();
    const app = createApp({ runsDir, casesDir, port: 0 });

    const r1 = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "live-clear" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(r1.status).toBe(202);
    const body1 = (await r1.json()) as RunPostResponse;
    // Wait for runner 1 to fully drain (run.json appears) before firing
    // runner 2 — otherwise the second POST could race the slot-clear and
    // return 409 even though the system is functioning correctly.
    expect(await waitForRunJson(body1.run_id, 3000)).toBe(true);
    // T9-flake-fix: run.json is written INSIDE runBenchmark; activeRun is
    // cleared a few microtasks later in the post-handler `.finally`. Poll
    // for slot-clear via the missing-case probe so r2 doesn't race the
    // self-clear and observe a stale 409.
    expect(await waitForSlotClear(app, 3000)).toBe(true);

    // Re-arm the spawn mock for the second runner (mockImplementation
    // resets on each call; we want every spawn to schedule a clean exit).
    mockCleanSpawn();
    const r2 = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "live-clear" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(r2.status).toBe(202);
    const body2 = (await r2.json()) as RunPostResponse;
    expect(body2.run_id).not.toBe(body1.run_id);
    await waitForRunJson(body2.run_id, 2000);
  });

  it("clears the in-flight slot if planRun fails (so caller can retry)", async () => {
    // No case YAML for "missing-case" → planRun rejects; server clears
    // activeRun and the next POST against a valid case must be 202.
    await seedLiveCase({ slug: "live-recover", fixturePath: fixtureDir });
    const app = createApp({ runsDir, casesDir, port: 0 });

    const r1 = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "missing-case" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(r1.status).toBe(400);

    mockCleanSpawn();
    const r2 = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "live-recover" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(r2.status).toBe(202);
    const body2 = (await r2.json()) as RunPostResponse;
    await waitForRunJson(body2.run_id, 2000);
  });
});
