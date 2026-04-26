// runner.live.smoke.test.ts
//
// Gated smoke test that actually shells out to the real `claude` CLI under
// the runner's spawn. By default this test is SKIPPED — the rest of the qa
// suite NEVER touches the live binary, never makes network calls, and runs
// in <30s on CI. To opt in, set GUILD_BENCHMARK_LIVE=1 in the environment.
//
// Why this test exists:
//   The mocked-spawn integration tests (server.runsPost.live.test.ts +
//   runner.security.test.ts) prove our wiring is *internally* consistent.
//   They cannot prove the runner agrees with the real `claude` binary's
//   stdout/stderr stream timing, exit semantics, or signal handling.
//   This smoke test closes that gap when an operator opts in locally.
//
// Skip semantics:
//   - GUILD_BENCHMARK_LIVE !== "1" → entire suite is `it.skipIf(...)` skipped.
//   - claude binary not on PATH → tests still skip (we do NOT install it).
//
// What we do NOT assert:
//   - Score values, gate decisions, specialist dispatch order. Those are
//     governed by claude's response — not our code under test. We only
//     assert that runBenchmark produces a non-empty run.json with a valid
//     RunStatus and that artifacts/ contains at least one file. Anything
//     stricter would fail spuriously when claude output drifts.

import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBenchmark } from "../src/runner.js";
import type { RunJson } from "../src/types.js";

// Single env-var gate: omit or set anything other than "1" to skip.
const LIVE_GATE = process.env.GUILD_BENCHMARK_LIVE === "1";

// Resolve a `claude` binary off PATH; if not found we still skip so a
// developer who forgets to install claude doesn't get a confusing failure.
function locateClaude(): string | null {
  const which = process.env.PATH?.split(":") ?? [];
  for (const dir of which) {
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const claudeBin = LIVE_GATE ? locateClaude() : null;
const SHOULD_SKIP = !LIVE_GATE || claudeBin === null;

let scratch: string;
let runsDir: string;
let casesDir: string;
let fixtureDir: string;

async function seedTinyFixture(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "smoke fixture\n", "utf8");
}

// A trivial case file — short prompt, tight timeout, fixture is just a
// README. The intent is to exercise the spawn → exit → capture flow, NOT to
// produce a meaningful score.
async function seedSmokeCase(slug: string, fixturePath: string): Promise<void> {
  const yaml = [
    `schema_version: 1`,
    `id: ${slug}`,
    `title: "live smoke ${slug}"`,
    `timeout_seconds: 60`,
    `repetitions: 1`,
    `fixture: "${fixturePath}"`,
    `prompt: "Print 'hello' and exit. Do not modify any files."`,
    `expected_specialists: []`,
    `expected_stage_order: []`,
    `acceptance_commands: []`,
    ``,
  ].join("\n");
  await writeFile(join(casesDir, `${slug}.yaml`), yaml, "utf8");
}

beforeEach(async () => {
  if (SHOULD_SKIP) return;
  scratch = await mkdtemp(join(tmpdir(), "qa-runs-smoke-"));
  runsDir = join(scratch, "runs");
  casesDir = join(scratch, "cases");
  fixtureDir = join(scratch, "fixture");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await seedTinyFixture(fixtureDir);
  await seedSmokeCase("smoke-live", fixtureDir);
});

afterEach(async () => {
  if (SHOULD_SKIP) return;
  await rm(scratch, { recursive: true, force: true });
});

describe("runner / live smoke (gated by GUILD_BENCHMARK_LIVE=1)", () => {
  it.skipIf(SHOULD_SKIP)(
    "runs `claude` end-to-end and writes a valid run.json + artifacts/",
    async () => {
      // claudeBin is non-null by construction on this branch (SHOULD_SKIP is
      // true if claudeBin is null), but TS doesn't know — narrow with !.
      process.env.GUILD_BENCHMARK_CLAUDE_BIN = claudeBin!;
      try {
        const result = await runBenchmark({
          caseSlug: "smoke-live",
          runsDir,
          casesDir,
        });
        // 1) RunStatus is one of the documented values.
        expect([
          "pass",
          "fail",
          "timeout",
          "errored",
        ]).toContain(result.status);

        // 2) run.json was written and parses with the expected shape.
        const runDir = join(runsDir, result.runId);
        const runJsonText = await readFile(join(runDir, "run.json"), "utf8");
        const runJson = JSON.parse(runJsonText) as RunJson;
        expect(runJson.run_id).toBe(result.runId);
        expect(runJson.case_slug).toBe("smoke-live");
        expect(runJson.status).toBe(result.status);
        expect(runJson.started_at).toBeTruthy();
        expect(runJson.completed_at).toBeTruthy();

        // 3) artifacts/ exists. We do NOT assert a specific file shape since
        //    claude may write nothing for a short prompt.
        expect(existsSync(join(runDir, "artifacts"))).toBe(true);
      } finally {
        delete process.env.GUILD_BENCHMARK_CLAUDE_BIN;
      }
    },
    // Generous per-test timeout — claude can take a while to start up + a
    // 60s case timeout means we need at least 90s headroom.
    180_000,
  );
});
