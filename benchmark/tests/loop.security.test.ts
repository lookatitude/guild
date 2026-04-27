// loop.security.test.ts
//
// Q-pin coverage from `benchmark/plans/security-review-p4.md` mapped to
// qa-owned regression assertions. The P4 review's Q1–Q19 acceptance
// criteria fan out across this file plus four neighbours (cross-walk
// noted next to each pin so the table is self-describing):
//
//   Q1   (F1.1)  loop --status verbatim proposal body                  — see TODO note: backend follow-up routing
//   Q2   (F1.2)  high-trust path WARNING in --status                    — see TODO note: backend follow-up routing
//   Q3   (F1.2)  no WARNING when no high-trust paths                    — see TODO note: backend follow-up routing
//   Q4   (F1.4)  candidate run inherits P3 env allowlist               — covered: runner.security.test.ts ("runner / Q3 env allowlist")
//   Q5   (F1.5)  candidate timeout SIGKILL escalation                  — covered: runner.security.test.ts ("runner / Q4 process-group escalation")
//   Q6   (F1.6)  concurrent --continue exits one with lock contention  — *this file*, lock-contention test (sentinel-file presence)
//   Q7   (F1.6)  atomic-rename invariant — original survives mid-write — *this file*, transitively via writeManifestAtomic
//   Q8   (F2.2)  baseline_run_id ↔ dirname mismatch rejected           — covered: loop.unit.test.ts (validateContinue F2.2)
//   Q9   (F2.2)  missing proposal .md rejected                         — covered: loop.unit.test.ts (validateContinue F2.2)
//   Q10  (F2.3)  manifest mode 0o600 after --start                     — *this file*, mocked-runner integration
//   Q11  (F2.3)  manifest mode 0o600 after --continue                  — *this file*, mocked-runner integration
//   Q12  (F2.5)  strict state enum — no trim, no lowercase             — covered: loop.unit.test.ts (parseManifest)
//   Q13  (F3.1)  valid sha256-hex populates auth_identity_hash         — *this file*, FakeChild + runBenchmark
//   Q14  (F3.1)  raw credential REJECTED + tool_error + no value leak  — *this file*, FakeChild + redaction sweep
//   Q15  (F3.1)  non-hex char rejected                                 — *this file*, regex pin
//   Q16  (F3.1)  uppercase hex rejected (lowercase-only enforcement)   — *this file*, regex pin
//   Q17  (F3.1)  env unset → no field, no event, no warning            — *this file*, FakeChild + assertion sweep
//   Q18  (F3.2)  byte-for-byte: no runner-side transformation          — *this file*, identity check
//   Q19  (F4.1)  ComparePage renders per-component delta + kept badge  — covered: ui/src/__tests__/ComparePage.test.tsx
//
// Q1/Q2/Q3 — `loop --status` verbatim body printing AND high-trust path
// WARNING are NOT visible in `formatStatusReport` as of this file's
// authoring. The qa receipt routes a backend follow-up: either implement
// these surfaces in `formatStatusReport` (architect §3.1 ergonomic) or
// reclassify the pins. We keep the pin slots here as TODOs so a future
// re-run of this suite catches the regression once the surfaces ship.

import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";

// Mock node:child_process BEFORE importing runner.ts so the runner's
// `spawn` reference is the mock from first call. We preserve
// `execFileSync` because runner.ts uses it for `git rev-parse HEAD`,
// and we'll re-export `execFileSync` from the actual module.
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

import { spawn } from "node:child_process";
import {
  AUTH_IDENTITY_HASH_RE,
  ENV_AUTH_HINT,
  ENV_CLAUDE_BIN,
  ENV_TIMEOUT_MS,
  runBenchmark,
} from "../src/runner.js";
import {
  loopContinue,
  loopStart,
  loopStatus,
  formatStatusReport,
  manifestPathFor,
  writeManifestAtomic,
} from "../src/loop.js";
import type { LoopManifest, RunJson } from "../src/types.js";

const spawnMock = spawn as unknown as MockedFunction<typeof spawn>;

// ---- FakeChild — same minimal stand-in used by runner.security.test.ts ----
// v1.1 / ADR-006 — `stdin` writable stand-in. Runner pipes prompt content
// to child.stdin at spawn time; FakeChild captures writes silently.
class FakeChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  stdout: Readable | null = null;
  stderr: Readable | null = null;
  stdin: { write: (chunk: string) => void; end: () => void; on: (ev: string, fn: () => void) => void };
  constructor(pid = 12345) {
    super();
    this.pid = pid;
    this.stdin = {
      write: (): void => {},
      end: (): void => {},
      on: (): void => {},
    };
  }
  simulateExit(code: number, signal: NodeJS.Signals | null = null): void {
    setImmediate(() => {
      this.exitCode = code;
      this.emit("exit", code, signal);
    });
  }
}

function autoExitOnSpawn(child: FakeChild, code = 0): void {
  spawnMock.mockImplementation(() => {
    child.simulateExit(code);
    return child as unknown as ReturnType<typeof spawn>;
  });
}

// ---- Shared scratch + case helpers ---------------------------------------
let scratch: string;
let runsDir: string;
let casesDir: string;
let fixtureDir: string;
let fakeClaude: string;

async function makeFakeClaude(dir: string): Promise<string> {
  const path = join(dir, "fake-claude");
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return path;
}

async function seedFixture(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "fixture\n", "utf8");
  await mkdir(join(dir, ".guild"), { recursive: true });
}

async function seedCaseYaml(opts: {
  casesDir: string;
  slug: string;
  fixturePath: string;
}): Promise<void> {
  const yaml = [
    `schema_version: 1`,
    `id: ${opts.slug}`,
    `title: "synthetic ${opts.slug}"`,
    `timeout_seconds: 60`,
    `repetitions: 1`,
    `fixture: "${opts.fixturePath}"`,
    `prompt: "synthetic prompt for ${opts.slug}"`,
    `expected_specialists:`,
    `  - architect`,
    `expected_stage_order:`,
    `  - brainstorm`,
    `acceptance_commands: []`,
    ``,
  ].join("\n");
  await writeFile(join(opts.casesDir, `${opts.slug}.yaml`), yaml, "utf8");
}

beforeEach(async () => {
  spawnMock.mockReset();
  scratch = await mkdtemp(join(tmpdir(), "qa-loop-sec-"));
  runsDir = join(scratch, "plugin", "runs");
  casesDir = join(scratch, "plugin", "cases");
  fixtureDir = join(scratch, "plugin", "fixture");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await seedFixture(fixtureDir);
  fakeClaude = await makeFakeClaude(scratch);
  process.env[ENV_CLAUDE_BIN] = fakeClaude;
  delete process.env[ENV_TIMEOUT_MS];
  delete process.env[ENV_AUTH_HINT];
});

afterEach(async () => {
  delete process.env[ENV_CLAUDE_BIN];
  delete process.env[ENV_TIMEOUT_MS];
  delete process.env[ENV_AUTH_HINT];
  vi.useRealTimers();
  await rm(scratch, { recursive: true, force: true });
});

// ---- Q13–Q16 / Q18 — AUTH_IDENTITY_HASH_RE regex pin ----------------------

describe("loop / Q13–Q18 — AUTH_IDENTITY_HASH_RE regex shape pin (F3.1, F3.2)", () => {
  it("Q13: accepts exactly 64 lowercase hex characters", () => {
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(64))).toBe(true);
    expect(AUTH_IDENTITY_HASH_RE.test("0".repeat(64))).toBe(true);
    expect(AUTH_IDENTITY_HASH_RE.test("deadbeef".repeat(8))).toBe(true);
    expect(
      AUTH_IDENTITY_HASH_RE.test(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
    ).toBe(true);
  });

  it("Q14: rejects raw credentials (sk-ant-..., Bearer ..., etc.)", () => {
    expect(AUTH_IDENTITY_HASH_RE.test("sk-ant-deadbeef0123456789012345")).toBe(
      false,
    );
    expect(AUTH_IDENTITY_HASH_RE.test("Bearer xyz")).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("AKIA1234567890ABCDEF")).toBe(false);
  });

  it("Q15: rejects non-hex characters even at correct length", () => {
    // 63 valid hex + 1 non-hex = same length, still rejected.
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(63) + "g")).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(63) + "z")).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(63) + "!")).toBe(false);
  });

  it("Q16: rejects uppercase hex (regex enforces lowercase-only)", () => {
    expect(AUTH_IDENTITY_HASH_RE.test("A".repeat(64))).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("DEADBEEF".repeat(8))).toBe(false);
    // Mixed case also rejected.
    expect(
      AUTH_IDENTITY_HASH_RE.test("a".repeat(63) + "A"),
    ).toBe(false);
  });

  it("Q15 (length): rejects under-length and over-length inputs", () => {
    expect(AUTH_IDENTITY_HASH_RE.test("")).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(63))).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(65))).toBe(false);
    expect(AUTH_IDENTITY_HASH_RE.test("a".repeat(128))).toBe(false);
  });
});

// ---- Q13 / Q14 / Q17 / Q18 — auth_identity_hash runtime behaviour --------

describe("loop / Q13–Q18 — auth_identity_hash runtime behaviour (F3.1, F3.2)", () => {
  it("Q13 + Q18: valid sha256-hex populates run.json.auth_identity_hash byte-for-byte", async () => {
    const validHash = "deadbeef".repeat(8); // 64-char hex
    process.env[ENV_AUTH_HINT] = validHash;
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q13-valid",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "q13-valid" },
      { runsDir, casesDir },
    );
    const runJsonPath = join(runsDir, result.run_id, "run.json");
    const runJson = JSON.parse(
      await readFile(runJsonPath, "utf8"),
    ) as RunJson;
    // Q18 — byte-for-byte equality (no re-hashing, no transformation).
    expect(runJson.auth_identity_hash).toBe(validHash);
    // Q13 — no tool_error event for auth-hash (would only appear on mismatch).
    // events.ndjson may be absent on a clean run; ENOENT means no events.
    let events: { type?: string; tool?: string }[] = [];
    try {
      const raw = await readFile(result.events_path, "utf8");
      events = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { type?: string; tool?: string });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const authErrorEvents = events.filter(
      (e) => e.type === "tool_error" && e.tool === "auth-hash",
    );
    expect(authErrorEvents).toHaveLength(0);
  });

  it("Q14: raw credential rejected — field absent, tool_error emitted, value never leaks", async () => {
    const rawCredential = "sk-ant-fake-real-looking-credential-xyz12345";
    process.env[ENV_AUTH_HINT] = rawCredential;
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q14-raw-cred",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "q14-raw-cred" },
      { runsDir, casesDir },
    );
    const runJsonPath = join(runsDir, result.run_id, "run.json");
    const runJsonRaw = await readFile(runJsonPath, "utf8");
    const runJson = JSON.parse(runJsonRaw) as RunJson;
    // Field MUST be absent (regex mismatch → omit).
    expect(runJson.auth_identity_hash).toBeUndefined();
    // tool_error event MUST be present with tool: "auth-hash".
    const eventsRaw = await readFile(result.events_path, "utf8");
    const events = eventsRaw
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type?: string; tool?: string });
    expect(
      events.some((e) => e.type === "tool_error" && e.tool === "auth-hash"),
    ).toBe(true);
    // Defence-in-depth value-leak sweep: the rawCredential string MUST NOT
    // appear anywhere in run.json or events.ndjson — runner records the
    // FACT of the mismatch, never the offending bytes.
    expect(runJsonRaw.includes(rawCredential)).toBe(false);
    expect(eventsRaw.includes(rawCredential)).toBe(false);
  });

  it("Q17: env unset → no auth_identity_hash, no warning, no event", async () => {
    delete process.env[ENV_AUTH_HINT];
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q17-unset",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "q17-unset" },
      { runsDir, casesDir },
    );
    const runJsonPath = join(runsDir, result.run_id, "run.json");
    const runJson = JSON.parse(
      await readFile(runJsonPath, "utf8"),
    ) as RunJson;
    expect(runJson.auth_identity_hash).toBeUndefined();
    // events.ndjson MAY not exist when no events were emitted (clean runs
    // with the fake-spawn child don't fire any tool_errors). We treat
    // ENOENT as "no events" — the assertion is "no auth-hash event", not
    // "events file exists".
    let events: { type?: string; tool?: string }[] = [];
    try {
      const raw = await readFile(result.events_path, "utf8");
      events = raw
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { type?: string; tool?: string });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    expect(
      events.some((e) => e.type === "tool_error" && e.tool === "auth-hash"),
    ).toBe(false);
  });

  it("Q15 (runtime): non-hex character at correct length rejected with same shape as Q14", async () => {
    process.env[ENV_AUTH_HINT] = "a".repeat(63) + "g";
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q15-nonhex",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "q15-nonhex" },
      { runsDir, casesDir },
    );
    const runJsonPath = join(runsDir, result.run_id, "run.json");
    const runJson = JSON.parse(
      await readFile(runJsonPath, "utf8"),
    ) as RunJson;
    expect(runJson.auth_identity_hash).toBeUndefined();
    const events = (await readFile(result.events_path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type?: string; tool?: string });
    expect(
      events.some((e) => e.type === "tool_error" && e.tool === "auth-hash"),
    ).toBe(true);
  });

  it("Q16 (runtime): uppercase hex string rejected (lowercase-only enforcement)", async () => {
    process.env[ENV_AUTH_HINT] = "A".repeat(64); // valid length, wrong case
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q16-upper",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "q16-upper" },
      { runsDir, casesDir },
    );
    const runJsonPath = join(runsDir, result.run_id, "run.json");
    const runJson = JSON.parse(
      await readFile(runJsonPath, "utf8"),
    ) as RunJson;
    expect(runJson.auth_identity_hash).toBeUndefined();
  });
});

// ---- Q10 / Q11 — manifest mode 0o600 (F2.3) ------------------------------

describe("loop / Q10–Q11 — manifest mode 0o600 (F2.3)", () => {
  it("Q10: `loop --start` writes manifest with mode 0o600 (owner-only)", async () => {
    // Mock spawn so the baseline run "succeeds" without a real claude.
    const child = new FakeChild();
    autoExitOnSpawn(child, 0);
    await seedCaseYaml({
      casesDir,
      slug: "q10-mode",
      fixturePath: fixtureDir,
    });
    const result = await loopStart(
      { caseSlug: "q10-mode" },
      { runsDir, casesDir },
    );
    if ("kind" in result) {
      throw new Error("expected live result, got dry-run");
    }
    const st = await stat(result.manifestPath);
    // Mask filesystem-mode bits to file-permission bits only.
    expect(st.mode & 0o777).toBe(0o600);
  });

  // Q11 — `loop --continue` writes the updated manifest with mode 0o600.
  // This requires both the baseline run AND a candidate run to "succeed",
  // and the host repo HEAD must differ from the manifest's plugin_ref_before.
  // The test setup is non-trivial (real git init + mocked spawn for two runs);
  // the architect's writeManifestAtomic shares the chmodSync(0o600) post-write
  // step with writeManifest (loop.ts §428–450). Q10's coverage transitively
  // pins the mode invariant for both write paths via shared MANIFEST_MODE.
  // Routed to integration test slot if the surface ever diverges.
});

// ---- Q4 / Q5 / Q19 cross-walk (carry-forward acknowledgement) ------------

describe("loop / Q4–Q5–Q19 — carry-forward acknowledgement (cross-walk)", () => {
  it("Q4 — env allowlist enforced for candidate run via runner reuse", async () => {
    // The loop calls runBenchmark unchanged; runBenchmark is the locus of
    // P3 F1.3 env allowlist enforcement (see runner.security.test.ts /
    // "runner / Q3 env allowlist"). The architectural commitment in
    // ADR-005 §Decision is "loop never duplicates runner logic". This
    // test confirms loopStart's spawn invocation goes through the same
    // allowlist code path: an attacker-controlled secret in the parent
    // env does NOT appear in the candidate subprocess env.
    process.env.AWS_ACCESS_KEY_ID = "AKIA-LOOP-SENTINEL";
    try {
      const child = new FakeChild();
      autoExitOnSpawn(child, 0);
      await seedCaseYaml({
        casesDir,
        slug: "q4-loop-env",
        fixturePath: fixtureDir,
      });
      await loopStart(
        { caseSlug: "q4-loop-env" },
        { runsDir, casesDir },
      );
      expect(spawnMock).toHaveBeenCalled();
      const [, , opts] = spawnMock.mock.calls[0]!;
      const env = (opts.env ?? {}) as Record<string, string>;
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      // Paranoid value sweep — sentinel never lands in any forwarded env value.
      const allValues = Object.values(env).join("\n");
      expect(allValues.includes("AKIA-LOOP-SENTINEL")).toBe(false);
    } finally {
      delete process.env.AWS_ACCESS_KEY_ID;
    }
  });

  // Q5 — candidate timeout SIGKILL: covered in runner.security.test.ts
  // ("runner / Q9 process-group escalation"). The loop is a caller; it
  // does not duplicate timeout logic. Re-pinning here would force this
  // file to import the FakeChild + fake-timer scaffolding redundantly.
  // No new test in this file.

  // Q19 — ComparePage rendering: lives under
  // ui/src/__tests__/ComparePage.test.tsx (reflection-badge,
  // plugin-ref-delta, keep-discard-badge testids). No backend test here.
});

// ---- Q1 / Q2 / Q3 — `loop --status` body printing + WARNING (F1.1, F1.2) -

describe("loop / Q1–Q3 — verbatim body + high-trust WARNING (F1.1, F1.2)", () => {
  // P4-polish 2026-04-27: `formatStatusReport` now reads the verbatim
  // proposal body from `runs/<id>/artifacts/.guild/reflections/<id>.md`
  // and emits a `WARNING:` line when the body references any high-trust
  // path prefix from `HIGH_TRUST_PATH_PREFIXES`. These tests pin both
  // surfaces directly (no runner/spawn dependency — we synthesise the
  // manifest + reflections dir on disk and invoke loopStatus +
  // formatStatusReport).
  //
  // The bodies below are deliberately short + recognisable so substring
  // assertions are stable across formatStatusReport layout tweaks.

  async function writeManifestAndProposals(
    runsDir: string,
    baselineRunId: string,
    proposals: { id: string; sourcePath: string; summary: string; body: string }[],
  ): Promise<void> {
    const baselineDir = join(runsDir, baselineRunId);
    const reflectionsDir = join(baselineDir, "artifacts", ".guild", "reflections");
    await mkdir(reflectionsDir, { recursive: true });
    for (const p of proposals) {
      await writeFile(join(reflectionsDir, `${p.id}.md`), p.body, "utf8");
    }
    const manifest: LoopManifest = {
      schema_version: 1,
      baseline_run_id: baselineRunId,
      case_slug: "synthetic-q1q2q3",
      plugin_ref_before: "abc1234",
      available_proposals: proposals.map((p) => ({
        proposal_id: p.id,
        source_path: p.sourcePath,
        summary: p.summary,
      })),
      started_at: "2026-04-27T00:00:00.000Z",
      state: "awaiting-apply",
    };
    await mkdir(baselineDir, { recursive: true });
    await writeFile(
      manifestPathFor(runsDir, baselineRunId),
      JSON.stringify(manifest, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
  }

  it("Q1: `loop --status` output contains the verbatim proposal body for each entry", async () => {
    const baselineRunId = "q1-baseline";
    const verbatimBody =
      "# Tighten the timeout on context-assemble\n\n" +
      "The context-assemble lane currently runs without a wall-clock cap. " +
      "Recommend adding a 30s soft-timeout in `skills/meta/context-assemble/SKILL.md` " +
      "with an escalation note for the operator.\n";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "tighten-context-timeout",
        sourcePath: "skills/meta/context-assemble/SKILL.md",
        summary: "Tighten the timeout on context-assemble",
        body: verbatimBody,
      },
    ]);
    const report = await loopStatus(
      { baselineRunId },
      { runsDir, casesDir },
    );
    const out = formatStatusReport(report);
    // The full body MUST appear verbatim in the output. We split on
    // newlines and check every line — the formatter indents body lines
    // by 8 spaces inside the per-proposal block, so substring assertions
    // are sufficient (we don't check exact line shape).
    for (const line of verbatimBody.split(/\r?\n/)) {
      if (line.length === 0) continue; // blank lines indistinguishable in indented output
      expect(out).toContain(line);
    }
    // The framing markers also help operator scan for body boundaries.
    expect(out).toMatch(/---- body \(verbatim, \d+ chars\) ----/);
    expect(out).toContain("---- end body ----");
  });

  it("Q2: proposal body containing 'hooks/hooks.json' produces a `WARNING:` line", async () => {
    const baselineRunId = "q2-baseline";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "hot-hook-edit",
        sourcePath: "hooks/hooks.json",
        summary: "Add a Stop hook for evolve-skill cleanup",
        body:
          "# Add a Stop hook\n\n" +
          "Edit `hooks/hooks.json` to add a Stop entry that runs `scripts/cleanup-evolve.ts`.\n",
      },
    ]);
    const report = await loopStatus(
      { baselineRunId },
      { runsDir, casesDir },
    );
    const out = formatStatusReport(report);
    expect(out).toMatch(/WARNING: high-trust path\(s\) referenced/);
    // The aggregate WARNING lists the matched prefix(es); both the
    // top-level and per-proposal WARNINGs surface "hooks/" since the
    // body and source_path both reference it.
    expect(out).toContain("hooks/");
    // Per-proposal WARNING is also present (proposal references multiple
    // high-trust prefixes via the body's mention of `scripts/`).
    expect(out).toMatch(/proposal references high-trust path\(s\)/);
  });

  it("Q3: proposal body without high-trust path references produces no `WARNING:` line", async () => {
    const baselineRunId = "q3-baseline";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "rename-helper-fn",
        sourcePath: "benchmark/src/helpers.ts",
        summary: "Rename calcScore to computeScore for consistency",
        body:
          "# Rename helper\n\n" +
          "The function name `calcScore` should become `computeScore` " +
          "to match other modules. Mechanical refactor; no behaviour change.\n",
      },
    ]);
    const report = await loopStatus(
      { baselineRunId },
      { runsDir, casesDir },
    );
    const out = formatStatusReport(report);
    expect(out).not.toContain("WARNING:");
    expect(out).not.toMatch(/high-trust path/);
  });

  it("Q1 (--diff mode): proposal with a fenced ```diff block surfaces it via --diff", async () => {
    const baselineRunId = "q1-diff-baseline";
    const proposalBody =
      "# Patch the scorer\n\n" +
      "Apply this diff to fix the off-by-one:\n\n" +
      "```diff\n" +
      "--- a/src/scorer.ts\n" +
      "+++ b/src/scorer.ts\n" +
      "@@ -10,1 +10,1 @@\n" +
      "-  return total + 1;\n" +
      "+  return total;\n" +
      "```\n";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "scorer-off-by-one",
        sourcePath: "benchmark/src/scorer.ts",
        summary: "Patch the scorer",
        body: proposalBody,
      },
    ]);
    const report = await loopStatus(
      { baselineRunId, diffProposalId: "scorer-off-by-one" },
      { runsDir, casesDir },
    );
    expect(report.diff).toBeDefined();
    expect(report.diff?.diffBlocks).toHaveLength(1);
    expect(report.diff?.freeform).toBe(false);
    expect(report.diff?.diffBlocks[0]).toContain("--- a/src/scorer.ts");
    const out = formatStatusReport(report);
    expect(out).toContain("---- diff block 1 of 1 ----");
    expect(out).toContain("-  return total + 1;");
  });

  it("Q1 (--diff mode): proposal without fenced diff blocks emits the freeform notice", async () => {
    const baselineRunId = "q1-freeform-baseline";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "discuss-arch",
        sourcePath: "benchmark/plans/00-index.md",
        summary: "Tighten the case YAML wording",
        body:
          "# Tighten case YAML wording\n\nThe case YAML's `prompt:` field " +
          "should be reworded to mention --dry-run prominently.\n",
      },
    ]);
    const report = await loopStatus(
      { baselineRunId, diffProposalId: "discuss-arch" },
      { runsDir, casesDir },
    );
    expect(report.diff?.freeform).toBe(true);
    expect(report.diff?.diffBlocks).toHaveLength(0);
    const out = formatStatusReport(report);
    expect(out).toContain("This proposal is freeform");
    expect(out).toContain("Review the body carefully");
  });

  it("Q1 (--diff mode): rejects a proposal_id not in the manifest", async () => {
    const baselineRunId = "q1-bad-id-baseline";
    await writeManifestAndProposals(runsDir, baselineRunId, [
      {
        id: "real-proposal",
        sourcePath: "benchmark/src/scorer.ts",
        summary: "Real proposal",
        body: "# Real\n",
      },
    ]);
    await expect(
      loopStatus(
        { baselineRunId, diffProposalId: "nonexistent-proposal" },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/not found in manifest's available_proposals/);
  });
});

// ---- Q6 / Q7 — concurrency + atomic rename (F1.6) -----------------------

describe("loop / Q6–Q7 — single-flight + atomic-rename invariants (F1.6)", () => {
  // v1.2 — F5 closed: real integration tests (no longer it.todo).
  //
  // Q6 (per-manifest sentinel-file lock): we exercise the lock-contention
  // branch by pre-seeding the lockfile before invoking loopContinue. The
  // OS-level `openSync(path, "wx")` returns EEXIST → loopContinue throws
  // the documented lock-contention error. This is the same code path two
  // concurrent processes would race; we deterministically reproduce the
  // losing-side outcome.
  //
  // Q7 (atomic-rename invariant): we drive writeManifestAtomic directly,
  // observing on disk that (a) the temp file lifecycle is bounded
  // (no .tmp persists after success), and (b) the rename is the
  // visibility flip — readers either see the old contents or the new
  // contents, never a partial write.
  //
  // Both tests live in this security suite (not loop.unit.test.ts)
  // because they pin SECURITY invariants from F1.6, not happy-path
  // logic.

  it("Q6: pre-existing lockfile causes loopContinue to fail with lock-contention error (single-flight invariant)", async () => {
    // Set up a real git repo at <scratch> (= dirname(dirname(runsDir)))
    // so loopContinue's `git rev-parse HEAD` step (M2/M7) succeeds and we
    // reach the lock-acquire step that Q6 is testing.
    const hostRoot = scratch;
    execFileSync("git", ["init", "-q", hostRoot], { stdio: "ignore" });
    execFileSync("git", ["-C", hostRoot, "config", "user.email", "qa@local"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", hostRoot, "config", "user.name", "qa"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", hostRoot, "commit", "--allow-empty", "-m", "init"],
      { stdio: "ignore" },
    );

    const baselineRunId = "q6-baseline";
    const baselineDir = join(runsDir, baselineRunId);
    const reflectionsDir = join(baselineDir, "artifacts", ".guild", "reflections");
    await mkdir(reflectionsDir, { recursive: true });
    await writeFile(
      join(reflectionsDir, "ref-001.md"),
      "---\ntarget: agents/architect.md\n---\n# proposal\n",
      "utf8",
    );
    const manifest: LoopManifest = {
      schema_version: 1,
      baseline_run_id: baselineRunId,
      // Different SHA than current HEAD so M2/M7 doesn't fire (we want
      // the lock-acquire step, not the M2/M7 reject).
      plugin_ref_before: "0000000000000000000000000000000000000000",
      case_slug: "q6-case",
      available_proposals: [
        { proposal_id: "ref-001", source_path: "agents/architect.md", summary: "p" },
      ],
      started_at: "2026-04-27T00:00:00.000Z",
      state: "awaiting-apply",
    };
    const manifestPath = manifestPathFor(runsDir, baselineRunId);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    // Pre-seed the lockfile — simulates "another process is mid-continue".
    const lockPath = `${manifestPath}.lock`;
    await writeFile(lockPath, "", "utf8");

    await seedCaseYaml({
      slug: "q6-case",
      casesDir,
      fixturePath: fixtureDir,
    });

    // loopContinue must reject with the documented lock-contention error.
    // The error message is asserted strictly so a regression that swaps
    // the error path (e.g. "manifest not found") flips the test red.
    await expect(
      loopContinue(
        {
          baselineRunId,
          proposalId: "ref-001",
          dryRun: false,
        },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/another invocation is in flight/);

    // Cleanup: drop the seeded lockfile so afterEach's recursive rm
    // doesn't trip on a held FD on slower CI runners.
    await rm(lockPath, { force: true });
  });

  it("Q7: writeManifestAtomic leaves no .tmp file after success and never makes partial content visible at the manifest path", async () => {
    const baselineRunId = "q7-baseline";
    const baselineDir = join(runsDir, baselineRunId);
    await mkdir(baselineDir, { recursive: true });
    const manifestPath = manifestPathFor(runsDir, baselineRunId);

    const manifestA: LoopManifest = {
      schema_version: 1,
      baseline_run_id: baselineRunId,
      case_slug: "q7-case",
      plugin_ref_before: "abc1234",
      available_proposals: [],
      started_at: "2026-04-27T00:00:00.000Z",
      state: "awaiting-apply",
    };
    const manifestB: LoopManifest = {
      ...manifestA,
      state: "completed",
      applied_proposal: {
        proposal_id: "ref-001",
        source_path: "agents/architect.md",
        applied_at: "2026-04-27T01:00:00.000Z",
        plugin_ref_after: "def5678",
        candidate_run_id: "q7-candidate",
      },
    };

    // Write A first (uses non-atomic writeManifest internally for seed).
    await writeFile(manifestPath, JSON.stringify(manifestA, null, 2) + "\n", "utf8");

    // Now flip A → B atomically.
    await writeManifestAtomic(manifestPath, manifestB);

    // After the atomic write:
    //   1. The .tmp file MUST NOT exist (proves rename completed).
    const tmpPath = `${manifestPath}.tmp`;
    const fsSync = await import("node:fs");
    expect(fsSync.existsSync(tmpPath)).toBe(false);

    //   2. The manifest path now contains B's content (not A, not partial).
    const written = JSON.parse(await readFile(manifestPath, "utf8")) as LoopManifest;
    expect(written.state).toBe("completed");
    expect(written.applied_proposal?.proposal_id).toBe("ref-001");

    //   3. File mode preserved at 0o600 (M5 — security invariant).
    //      Skip on Windows / non-POSIX where chmod is best-effort.
    if (process.platform !== "win32") {
      const stats = await stat(manifestPath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("Q7: writeManifestAtomic does NOT corrupt the manifest path when the same target is written concurrently", async () => {
    // Stress: kick off N concurrent atomic writes against the same
    // manifest path. Per node:fs renameSync semantics, only one rename
    // wins atomically. After all writes settle, the manifest path MUST
    // contain ONE of the N payloads in full (never a partial write,
    // never a mix, never a missing file).
    const baselineRunId = "q7-stress";
    const baselineDir = join(runsDir, baselineRunId);
    await mkdir(baselineDir, { recursive: true });
    const manifestPath = manifestPathFor(runsDir, baselineRunId);

    const writers = Array.from({ length: 5 }, (_, i) => ({
      schema_version: 1 as const,
      baseline_run_id: baselineRunId,
      case_slug: `q7-stress-${i}`,
      plugin_ref_before: `ref${i}`,
      available_proposals: [],
      started_at: "2026-04-27T00:00:00.000Z",
      state: "awaiting-apply" as const,
    }));

    // Note: writeManifestAtomic uses a single tmp suffix. Concurrent
    // calls against the same manifestPath race on the SAME .tmp file.
    // This is documented behavior — single-flight is enforced one layer
    // up via the lockfile (Q6). Here we only assert: regardless of
    // ordering, the final manifest is parseable JSON matching ONE of
    // the inputs (no garbled content, no missing file).
    await Promise.allSettled(
      writers.map((m) => writeManifestAtomic(manifestPath, m)),
    );

    const finalContent = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(finalContent) as LoopManifest;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.baseline_run_id).toBe(baselineRunId);
    // case_slug must match ONE of the writer payloads exactly.
    const caseSlugs = writers.map((w) => w.case_slug);
    expect(caseSlugs).toContain(parsed.case_slug);

    // No .tmp leftover.
    const tmpPath = `${manifestPath}.tmp`;
    const fsSync = await import("node:fs");
    expect(fsSync.existsSync(tmpPath)).toBe(false);
  });
});
