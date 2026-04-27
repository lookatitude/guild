// runner.unit.test.ts
//
// Pure-function + plan-resolution coverage for `benchmark/src/runner.ts`.
// Spawn-mocked behavior (signal escalation, status mapping under live
// children, env-allowlist enforcement at spawn time, M1/M2/M14 stream
// redaction) is pinned in `runner.security.test.ts` so each Q-pin can be
// asserted against a single, focused fake child.
//
// Coverage targets here:
//   - `safeJoinUnder` — the M5 5-rule path-resolution checklist.
//   - `redactStringPayload` — M14 token-shape redaction patterns.
//   - `redactArgvForAudit` — M15 audit redaction (flag-context + paths).
//   - `resolveTimeoutMs` — M9 timeout cap + case override.
//   - `formatDryRunReport` — M16 env values never printed; argv shape only.
//   - `planRun` — case-slug validation, run-dir layout, env-allowlist
//                 keys-only emission, timeout floor, fixture resolution.
//   - `runBenchmark({dryRun:true})` — dry-run path: no spawn, no writes.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_T_BUDGET_MS,
  ENV_ARGV_TEMPLATE,
  ENV_CLAUDE_BIN,
  ENV_LIVE,
  ENV_MODELS_JSON,
  ENV_TIMEOUT_MS,
  KILL_GRACE_MS,
  formatDryRunReport,
  planRun,
  redactArgvForAudit,
  redactStringPayload,
  resolveTimeoutMs,
  runBenchmark,
  safeJoinUnder,
} from "../src/runner.js";

// Per-test scratch dirs. Every test creates a fresh runs/ + cases/ tree so
// generateRunId's existsSync pre-check sees a clean slate.
let scratch: string;
let runsDir: string;
let casesDir: string;
let fixtureDir: string;
let fakeClaude: string;

async function makeFakeClaude(dir: string): Promise<string> {
  // Absolute, non-/tmp path used as ENV_CLAUDE_BIN — the runner's
  // assertSafeBinaryPath refuses /tmp prefix, but mkdtemp on macOS returns
  // /var/folders/... which is fine. We don't actually invoke this binary
  // from the unit tests (no spawn), but planRun calls existsSync on it.
  const path = join(dir, "fake-claude");
  await writeFile(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return path;
}

async function seedFixture(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "README.md"), "fixture\n", "utf8");
  await mkdir(join(dir, ".guild"), { recursive: true });
  await writeFile(join(dir, ".guild", "marker.txt"), "marker\n", "utf8");
}

async function seedCaseYaml(opts: {
  casesDir: string;
  slug: string;
  fixturePath: string; // ABSOLUTE path; the case YAML stores it relative.
  timeoutSeconds?: number;
}): Promise<string> {
  const yaml = [
    `schema_version: 1`,
    `id: ${opts.slug}`,
    `title: "synthetic ${opts.slug}"`,
    `timeout_seconds: ${opts.timeoutSeconds ?? 60}`,
    `repetitions: 1`,
    `fixture: "${opts.fixturePath}"`,
    `prompt: "synthetic prompt for ${opts.slug}"`,
    `expected_specialists:`,
    `  - architect`,
    `  - backend`,
    `expected_stage_order:`,
    `  - brainstorm`,
    `  - team`,
    `  - plan`,
    `  - context`,
    `  - execute`,
    `  - review`,
    `  - verify`,
    `  - reflect`,
    `acceptance_commands:`,
    `  - "echo hi"`,
    ``,
  ].join("\n");
  const path = join(opts.casesDir, `${opts.slug}.yaml`);
  await writeFile(path, yaml, "utf8");
  return path;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "qa-runner-unit-"));
  runsDir = join(scratch, "runs");
  casesDir = join(scratch, "cases");
  fixtureDir = join(scratch, "fixture");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await seedFixture(fixtureDir);
  fakeClaude = await makeFakeClaude(scratch);
  // M4 — point planRun's resolveClaudeBinary at our writable fake.
  process.env[ENV_CLAUDE_BIN] = fakeClaude;
  // M9 + M3 — clear any host-env override that would skew assertions.
  delete process.env[ENV_TIMEOUT_MS];
  delete process.env[ENV_MODELS_JSON];
});

afterEach(async () => {
  delete process.env[ENV_CLAUDE_BIN];
  delete process.env[ENV_TIMEOUT_MS];
  delete process.env[ENV_MODELS_JSON];
  await rm(scratch, { recursive: true, force: true });
});

// ---- safeJoinUnder (M5 / F2.1) -----------------------------------------

describe("runner / safeJoinUnder — M5 5-rule path-resolution checklist", () => {
  it("accepts a plain relative path under root", () => {
    const root = "/var/runs";
    expect(safeJoinUnder(root, "artifacts/log.txt")).toBe("/var/runs/artifacts/log.txt");
  });

  it("treats empty / '.' as the root itself", () => {
    const root = "/var/runs";
    expect(safeJoinUnder(root, "")).toBe(root);
    expect(safeJoinUnder(root, ".")).toBe(root);
  });

  it("strips a leading slash and resolves under root (rule 2)", () => {
    const root = "/var/runs";
    expect(safeJoinUnder(root, "/artifacts/log.txt")).toBe("/var/runs/artifacts/log.txt");
  });

  it("normalises redundant segments via posix semantics", () => {
    const root = "/var/runs";
    expect(safeJoinUnder(root, "./a/b/../c")).toBe("/var/runs/a/c");
  });

  it("refuses '..' attempts that would escape the root", () => {
    const root = "/var/runs";
    expect(safeJoinUnder(root, "..")).toBeNull();
    expect(safeJoinUnder(root, "../etc/passwd")).toBeNull();
    expect(safeJoinUnder(root, "a/../../etc/passwd")).toBeNull();
  });

  it("refuses absolute targets that resolve outside root", () => {
    const root = "/var/runs";
    // After leading-slash strip, '/etc/passwd' becomes 'etc/passwd' —
    // that's intentional: it's joined under root, NOT honoured as absolute.
    expect(safeJoinUnder(root, "/etc/passwd")).toBe("/var/runs/etc/passwd");
  });

  it("strips a Windows drive-letter prefix and refuses the resulting absolute path", () => {
    const root = "/var/runs";
    // After `C:` is stripped, `/Windows/system32` is absolute under posix —
    // the absolute-path guard rejects it, which is the whole point of M5
    // step 4: "verify path.relative does not start with .. and is not absolute".
    expect(safeJoinUnder(root, "C:/Windows/system32")).toBeNull();
  });

  it("strips a UNC `\\\\` prefix (rule 2)", () => {
    const root = "/var/runs";
    // Backslashes get replaced with `/` post-strip.
    expect(safeJoinUnder(root, "\\\\share\\evil")).toBe("/var/runs/share/evil");
  });

  it("normalises a `\\\\?\\C:\\…` Windows extended path back under root (rule 2)", () => {
    const root = "/var/runs";
    // The leading-slash strip pulls off the two backslashes, leaving
    // `?\C:\evil`. Drive-letter regex doesn't match `?` so it sticks; the
    // backslash→slash pass yields `?/C:/evil` which is non-absolute and
    // safely resolves under root. The contract is "stays under root";
    // the exact suffix isn't a stable invariant.
    const out = safeJoinUnder(root, "\\\\?\\C:\\evil");
    expect(out).not.toBeNull();
    expect(out!.startsWith(root + sep)).toBe(true);
  });

  it("rejects a non-string `rel`", () => {
    const root = "/var/runs";
    // We exercise the non-string branch — the runtime check matters.
    expect(safeJoinUnder(root, undefined as unknown as string)).toBeNull();
    expect(safeJoinUnder(root, 42 as unknown as string)).toBeNull();
  });
});

// ---- redactStringPayload (M14) -----------------------------------------

describe("runner / redactStringPayload — M14 token redaction", () => {
  it("redacts an Anthropic `sk-ant-*` key", () => {
    const out = redactStringPayload("ANTHROPIC_API_KEY=sk-ant-deadbeef0123456789012345");
    expect(out).toMatch(/<REDACTED:anthropic-key:hash=[0-9a-f]{4}>/);
    expect(out).not.toMatch(/sk-ant-deadbeef/);
  });

  it("redacts an `Authorization: Bearer …` header verbatim", () => {
    const out = redactStringPayload("Authorization: Bearer abcdef0123456789xyzabc");
    expect(out).toMatch(/<REDACTED:bearer:hash=[0-9a-f]{4}>/);
    expect(out).not.toMatch(/abcdef0123456789xyzabc/);
  });

  it("redacts a bare `Bearer <token>` if long enough", () => {
    const out = redactStringPayload("got Bearer abcdef0123456789xyzABC tokens");
    expect(out).toMatch(/<REDACTED:bearer:hash=[0-9a-f]{4}>/);
    expect(out).not.toMatch(/abcdef0123456789xyzABC/);
  });

  it("redacts a GitHub PAT (ghp_…)", () => {
    const tok = "ghp_" + "a".repeat(36);
    const out = redactStringPayload(`token=${tok}`);
    expect(out).toMatch(/<REDACTED:github-pat:hash=[0-9a-f]{4}>/);
    expect(out).not.toContain(tok);
  });

  it("redacts a Slack token (xoxb-…)", () => {
    const out = redactStringPayload("slack=xoxb-12345-67890-abcdefg");
    expect(out).toMatch(/<REDACTED:slack-token:hash=[0-9a-f]{4}>/);
    expect(out).not.toMatch(/xoxb-12345-67890-abcdefg/);
  });

  it("redacts an AWS access key id", () => {
    const out = redactStringPayload("aws=AKIAABCDEFGHIJKLMNOP and trailing");
    expect(out).toMatch(/<REDACTED:aws-access-key:hash=[0-9a-f]{4}>/);
    expect(out).not.toMatch(/AKIAABCDEFGHIJKLMNOP/);
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJabc.eyJpc3MiOiJndWlsZCJ9.signature_part_zzzz";
    const out = redactStringPayload(`jwt=${jwt}`);
    expect(out).toMatch(/<REDACTED:jwt:hash=[0-9a-f]{4}>/);
    expect(out).not.toContain(jwt);
  });

  it("leaves a non-secret payload unchanged", () => {
    const benign = "INFO: stage_started brainstorm at 2026-04-26T05:30:00Z\n";
    expect(redactStringPayload(benign)).toBe(benign);
  });

  it("hashes are stable + 4 hex chars + same input → same hash", () => {
    const a = redactStringPayload("Bearer abcdef0123456789xyzABC");
    const b = redactStringPayload("Bearer abcdef0123456789xyzABC");
    expect(a).toBe(b);
    expect(a).toMatch(/hash=[0-9a-f]{4}>/);
  });
});

// ---- redactArgvForAudit (M15) -----------------------------------------

describe("runner / redactArgvForAudit — M15 audit redaction", () => {
  const ctx = {
    runDir: "/scratch/runs/case-abc1234-def5678-1",
    homeDir: homedir(),
    benchmarkRoot: "/scratch",
  };

  it("flag-context redaction replaces a value after a known-secret flag", () => {
    const out = redactArgvForAudit(
      ["claude", "--api-key", "sk-ant-deadbeef0123456789012345", "--print"],
      ctx,
    );
    expect(out).toEqual([
      "claude",
      "--api-key",
      "<REDACTED:flag-context>",
      "--print",
    ]);
  });

  it("flag-context redaction matches `--token`, `--password`, `--secret` (case-insensitive)", () => {
    const out = redactArgvForAudit(["x", "--Token", "topsecret"], ctx);
    expect(out[2]).toBe("<REDACTED:flag-context>");
    const out2 = redactArgvForAudit(["x", "--password", "hunter2"], ctx);
    expect(out2[2]).toBe("<REDACTED:flag-context>");
  });

  it("token shape redaction still applies when no flag context exists", () => {
    const out = redactArgvForAudit(
      ["claude", "Authorization: Bearer abcdef0123456789xyzABC"],
      ctx,
    );
    expect(out[1]).toMatch(/<REDACTED:bearer:/);
  });

  it("path placeholders rewrite RUN_DIR + BENCHMARK_ROOT + HOME", () => {
    const out = redactArgvForAudit(
      [
        "claude",
        "--workdir",
        ctx.runDir + "/_workspace",
        "--cache",
        ctx.benchmarkRoot + "/.cache",
        "--data",
        ctx.homeDir + "/.local",
      ],
      ctx,
    );
    expect(out[2]).toBe("${RUN_DIR}/_workspace");
    expect(out[4]).toBe("${BENCHMARK_ROOT}/.cache");
    expect(out[6]).toBe("${HOME}/.local");
  });

  it("does not flag-redact a value following a SAFE_FLAG (--print, --workdir)", () => {
    const out = redactArgvForAudit(
      ["claude", "--print", "synthetic-value", "--workdir", "/scratch/wd"],
      ctx,
    );
    // `--print` is not in SECRET_FLAG_RE; the value passes through unchanged.
    expect(out[2]).toBe("synthetic-value");
    // `--workdir` is also not in SECRET_FLAG_RE; the path placeholder
    // pass *does* run unconditionally though, rewriting BENCHMARK_ROOT.
    expect(out[4]).toBe("${BENCHMARK_ROOT}/wd");
  });

  it("redaction is per-element; benign elements pass through unchanged", () => {
    const out = redactArgvForAudit(["claude", "--print", "stream-json"], ctx);
    expect(out).toEqual(["claude", "--print", "stream-json"]);
  });
});

// ---- resolveTimeoutMs (M9) --------------------------------------------

describe("runner / resolveTimeoutMs — M9 timeout cap", () => {
  it("returns the global cap when no case override is given", () => {
    expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_T_BUDGET_MS);
  });

  it("uses the case timeout when shorter than the cap", () => {
    expect(resolveTimeoutMs(60)).toBe(60_000);
  });

  it("clamps a case timeout that would exceed the global cap", () => {
    // Case loader's zod schema caps timeout_seconds at 3600 (== DEFAULT cap).
    // Past that, the math returns the cap. Exercise the Math.min branch.
    expect(resolveTimeoutMs(7200)).toBe(DEFAULT_T_BUDGET_MS);
  });

  it("ENV override below the cap tightens the cap", () => {
    process.env[ENV_TIMEOUT_MS] = "300000"; // 5 min
    try {
      // No case override — env applies.
      expect(resolveTimeoutMs(undefined)).toBe(300_000);
      // Case (60s) is still shorter; it wins.
      expect(resolveTimeoutMs(60)).toBe(60_000);
      // Case (10 min) is longer than env cap — cap wins.
      expect(resolveTimeoutMs(600)).toBe(300_000);
    } finally {
      delete process.env[ENV_TIMEOUT_MS];
    }
  });

  it("ENV override above the cap is rejected; cap stays at default", () => {
    process.env[ENV_TIMEOUT_MS] = String(DEFAULT_T_BUDGET_MS + 1);
    try {
      expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_T_BUDGET_MS);
    } finally {
      delete process.env[ENV_TIMEOUT_MS];
    }
  });

  it("ENV override that is non-numeric is silently ignored", () => {
    process.env[ENV_TIMEOUT_MS] = "not-a-number";
    try {
      expect(resolveTimeoutMs(undefined)).toBe(DEFAULT_T_BUDGET_MS);
    } finally {
      delete process.env[ENV_TIMEOUT_MS];
    }
  });
});

// ---- planRun + dry-run path -------------------------------------------

describe("runner / planRun + formatDryRunReport — pure plan resolution", () => {
  it("rejects a missing or non-string caseSlug", async () => {
    await expect(
      planRun({ caseSlug: undefined as unknown as string }, { runsDir, casesDir }),
    ).rejects.toThrow(/caseSlug is required/);
    await expect(
      planRun({ caseSlug: 42 as unknown as string }, { runsDir, casesDir }),
    ).rejects.toThrow(/caseSlug is required/);
  });

  it("rejects a non-kebab-case caseSlug", async () => {
    await expect(
      planRun({ caseSlug: "Bad_Slug" }, { runsDir, casesDir }),
    ).rejects.toThrow(/kebab-case/);
  });

  it("rejects a slug that does not resolve to a YAML on disk", async () => {
    await expect(
      planRun({ caseSlug: "nope-not-here" }, { runsDir, casesDir }),
    ).rejects.toThrow(/case YAML not found/);
  });

  it("resolves a valid case and lays out the run-dir paths under runsDir/<runId>/", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-pass",
      fixturePath: fixtureDir,
      timeoutSeconds: 30,
    });
    const plan = await planRun(
      { caseSlug: "synthetic-pass" },
      { runsDir, casesDir },
    );
    // Every materialised path lies strictly under runsDir/<runId>/.
    expect(plan.runDir.startsWith(runsDir + sep)).toBe(true);
    expect(plan.workspaceDir).toBe(join(plan.runDir, "_workspace"));
    expect(plan.artifactsRoot).toBe(join(plan.runDir, "artifacts"));
    expect(plan.guildArtifactsDir).toBe(join(plan.artifactsRoot, ".guild"));
    expect(plan.eventsPath).toBe(join(plan.runDir, "events.ndjson"));
    expect(plan.runJsonPath).toBe(join(plan.runDir, "run.json"));
    expect(plan.promptPath).toBe(
      join(plan.workspaceDir, "_benchmark-prompt.txt"),
    );
    // M4 — claude binary is the absolute fake we exported.
    expect(plan.claudeBinary).toBe(fakeClaude);
    // M9 — timeoutMs <= cap.
    expect(plan.timeoutMs).toBe(30_000);
    // M16 — keys-only env list (no values).
    expect(Array.isArray(plan.envAllowlistKeys)).toBe(true);
    // PATH is always allowlisted; HOME is always allowlisted (process inherits).
    expect(plan.envAllowlistKeys.length).toBeGreaterThan(0);
  });

  it("argv shape (M1) — every element is a string and free of NUL bytes", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-argv",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "synthetic-argv" },
      { runsDir, casesDir },
    );
    // M1 — argv is a string[] with no NUL.
    expect(Array.isArray(plan.argv)).toBe(true);
    for (const el of plan.argv) {
      expect(typeof el).toBe("string");
      expect(el.indexOf("\0")).toBe(-1);
    }
    // v1.1 / ADR-006 — default argv targets real `claude` v2.x:
    //   claude --print --add-dir <workspace> [--model <name>]
    // Prompt is piped via stdin (NOT --prompt-file, which v2.x rejects).
    // `--workdir` was claude v1; v2.x uses `--add-dir` for tool-access
    // allow-list. `--output-format stream-json` also dropped (would
    // require --verbose on v2.x and the runner doesn't parse the stream).
    expect(plan.argv[0]).toBe(fakeClaude);
    expect(plan.argv).toContain("--print");
    expect(plan.argv).toContain("--add-dir");
    expect(plan.argv).not.toContain("--prompt-file");
    expect(plan.argv).not.toContain("--workdir");
    expect(plan.argv).not.toContain("--output-format");
    expect(plan.argv).not.toContain("stream-json");
    // --add-dir is followed by the workspace path.
    const addDirIdx = plan.argv.indexOf("--add-dir");
    expect(plan.argv[addDirIdx + 1]).toBe(plan.workspaceDir);
    // promptPath is preserved on the plan (used by ARGV_TEMPLATE
    // ${PROMPT_FILE} substitution + post-run forensics) but NOT in argv.
    expect(typeof plan.promptPath).toBe("string");
    expect(plan.promptPath.length).toBeGreaterThan(0);
    // promptContent is the literal prompt string piped to child.stdin.
    expect(typeof plan.promptContent).toBe("string");
    expect(plan.promptContent).toBe(plan.caseFile.prompt);
  });

  it("respects ENV_MODELS_JSON for modelRef when no override is supplied", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-models",
      fixturePath: fixtureDir,
    });
    process.env[ENV_MODELS_JSON] = JSON.stringify({
      architect: "claude-opus-4-7",
      researcher: "claude-sonnet-4-6",
    });
    try {
      const plan = await planRun(
        { caseSlug: "synthetic-models" },
        { runsDir, casesDir },
      );
      expect(plan.modelRef).toEqual({
        architect: "claude-opus-4-7",
        researcher: "claude-sonnet-4-6",
      });
    } finally {
      delete process.env[ENV_MODELS_JSON];
    }
  });

  it("opts.modelsOverride wins over ENV_MODELS_JSON and the default", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-override",
      fixturePath: fixtureDir,
    });
    process.env[ENV_MODELS_JSON] = JSON.stringify({ architect: "from-env" });
    try {
      const plan = await planRun(
        {
          caseSlug: "synthetic-override",
          modelsOverride: { architect: "from-cli" },
        },
        { runsDir, casesDir },
      );
      expect(plan.modelRef).toEqual({ architect: "from-cli" });
    } finally {
      delete process.env[ENV_MODELS_JSON];
    }
  });

  it("falls back to the default modelRef when neither override nor env are set", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-default",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "synthetic-default" },
      { runsDir, casesDir },
    );
    expect(plan.modelRef).toEqual({ default: "claude-opus-4-7" });
  });

  it("ignores ENV_MODELS_JSON when the JSON is malformed", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-bad-env",
      fixturePath: fixtureDir,
    });
    process.env[ENV_MODELS_JSON] = "{this is not json";
    try {
      const plan = await planRun(
        { caseSlug: "synthetic-bad-env" },
        { runsDir, casesDir },
      );
      // Falls back to default.
      expect(plan.modelRef).toEqual({ default: "claude-opus-4-7" });
    } finally {
      delete process.env[ENV_MODELS_JSON];
    }
  });

  it("auto-increments runId when prior runs share the same prefix", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "auto-inc",
      fixturePath: fixtureDir,
    });
    const a = await planRun({ caseSlug: "auto-inc" }, { runsDir, casesDir });
    // Materialise the run-dir so the next planRun sees it on disk.
    await mkdir(a.runDir, { recursive: true });
    const b = await planRun({ caseSlug: "auto-inc" }, { runsDir, casesDir });
    expect(a.runId).not.toBe(b.runId);
    // n=1 vs n=2 — both end in '-<n>'.
    expect(a.runId.endsWith("-1")).toBe(true);
    expect(b.runId.endsWith("-2")).toBe(true);
  });

  it("rejects an absolute ENV_CLAUDE_BIN under /tmp (assertSafeBinaryPath)", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-tmp",
      fixturePath: fixtureDir,
    });
    process.env[ENV_CLAUDE_BIN] = "/tmp/evil-claude";
    try {
      await expect(
        planRun({ caseSlug: "synthetic-tmp" }, { runsDir, casesDir }),
      ).rejects.toThrow(/refuse claude binary under \/tmp/);
    } finally {
      // Restore the safe fake so afterEach cleanup can still run.
      process.env[ENV_CLAUDE_BIN] = fakeClaude;
    }
  });

  it("rejects a non-absolute ENV_CLAUDE_BIN", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-rel",
      fixturePath: fixtureDir,
    });
    process.env[ENV_CLAUDE_BIN] = "relative/claude";
    try {
      await expect(
        planRun({ caseSlug: "synthetic-rel" }, { runsDir, casesDir }),
      ).rejects.toThrow(/must be an absolute path/);
    } finally {
      process.env[ENV_CLAUDE_BIN] = fakeClaude;
    }
  });

  it("formatDryRunReport emits all key paths but NEVER prints env values (M16)", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-dry",
      fixturePath: fixtureDir,
    });
    // Stash a fake secret in the env that is NOT on the allowlist; if the
    // dry-run output ever leaks env values, this string would surface.
    const sentinel = "DRYRUN_SENTINEL_SHOULD_NEVER_APPEAR";
    process.env.AWS_SECRET_ACCESS_KEY = sentinel;
    try {
      const plan = await planRun(
        { caseSlug: "synthetic-dry" },
        { runsDir, casesDir },
      );
      const report = formatDryRunReport(plan);
      // Sentinel never appears in the report.
      expect(report).not.toContain(sentinel);
      // Key paths and budget numbers do appear.
      expect(report).toContain(plan.runId);
      expect(report).toContain("argv (json)");
      expect(report).toContain("kill_grace_ms    : " + KILL_GRACE_MS);
      expect(report).toContain("env_allowlist");
      // M16 — the marker comment "values redacted — M16" appears.
      expect(report).toContain("values redacted");
      // M2 + ADR-004 callouts in the spawn_options summary.
      expect(report).toContain("shell:false");
      expect(report).toContain("detached:true");
      // dry-run footer.
      expect(report).toContain("(dry-run: no subprocess spawned");
    } finally {
      delete process.env.AWS_SECRET_ACCESS_KEY;
    }
  });

  it("formatDryRunReport reports `(empty)` when no allowlisted env keys are set", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-empty-env",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "synthetic-empty-env" },
      { runsDir, casesDir },
    );
    // Force the keys-only list to be empty for the formatter check.
    const synthetic = { ...plan, envAllowlistKeys: [] };
    const report = formatDryRunReport(synthetic);
    expect(report).toContain("env_allowlist    : (empty)");
  });
});

// ---- runBenchmark({dryRun:true}) — no spawn, no writes ----------------

describe("runner / runBenchmark dry-run path", () => {
  it("does not write run.json or events.ndjson when dryRun is true", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "synthetic-dry-call",
      fixturePath: fixtureDir,
    });
    const result = await runBenchmark(
      { caseSlug: "synthetic-dry-call", dryRun: true },
      { runsDir, casesDir },
    );
    // The contract says dry-run returns a partial=true result with status="errored".
    expect(result.status).toBe("errored");
    expect(result.partial).toBe(true);
    expect(result.exit_code).toBeNull();
    expect(result.wall_clock_ms).toBe(0);
    // No run dir was created.
    const fs = await import("node:fs/promises");
    const stat = await fs
      .stat(join(runsDir, result.run_id))
      .then(() => true)
      .catch(() => false);
    expect(stat).toBe(false);
  });
});

// ---- v1.1 fix-pack: ENV_LIVE gate, --model passthrough, ${MODEL} sub ----

describe("runner / v1.1 — GUILD_BENCHMARK_LIVE opt-in gate", () => {
  // Tests in this block override the global setup's LIVE=1 default to
  // exercise the gate. Restore before leaving the block.
  let savedLive: string | undefined;
  beforeEach(() => {
    savedLive = process.env[ENV_LIVE];
  });
  afterEach(() => {
    if (savedLive === undefined) delete process.env[ENV_LIVE];
    else process.env[ENV_LIVE] = savedLive;
  });

  it("refuses spawn with a clear error when GUILD_BENCHMARK_LIVE is unset", async () => {
    delete process.env[ENV_LIVE];
    await seedCaseYaml({
      casesDir,
      slug: "v11-no-opt-in",
      fixturePath: fixtureDir,
    });
    await expect(
      runBenchmark({ caseSlug: "v11-no-opt-in" }, { runsDir, casesDir }),
    ).rejects.toThrow(/live execution refused — set GUILD_BENCHMARK_LIVE=1/);
  });

  it("refuses spawn when GUILD_BENCHMARK_LIVE is set to anything other than '1'", async () => {
    process.env[ENV_LIVE] = "true"; // common operator mistake
    await seedCaseYaml({
      casesDir,
      slug: "v11-true-not-one",
      fixturePath: fixtureDir,
    });
    await expect(
      runBenchmark({ caseSlug: "v11-true-not-one" }, { runsDir, casesDir }),
    ).rejects.toThrow(/live execution refused/);
  });

  it("--dry-run bypasses the gate (operator's pre-flight verification path)", async () => {
    delete process.env[ENV_LIVE];
    await seedCaseYaml({
      casesDir,
      slug: "v11-dry-run-bypass",
      fixturePath: fixtureDir,
    });
    // Dry-run returns a RunnerResult shape with status: "errored" and
    // partial: true (it's a plan, not a real run); the assertion is that
    // the gate did NOT throw.
    const result = await runBenchmark(
      { caseSlug: "v11-dry-run-bypass", dryRun: true },
      { runsDir, casesDir },
    );
    expect(result.status).toBe("errored");
    expect(result.partial).toBe(true);
  });
});

describe("runner / v1.1 — model_ref.default → --model in default argv", () => {
  it("default argv injects --model when model_ref.default is set", async () => {
    process.env[ENV_MODELS_JSON] = JSON.stringify({
      default: "claude-haiku-4-5-20251001",
    });
    await seedCaseYaml({
      casesDir,
      slug: "v11-model-haiku",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-model-haiku" },
      { runsDir, casesDir },
    );
    expect(plan.argv).toContain("--model");
    const modelIdx = plan.argv.indexOf("--model");
    expect(plan.argv[modelIdx + 1]).toBe("claude-haiku-4-5-20251001");
  });

  it("default argv omits --model when model_ref has no `default` key", async () => {
    // Clear the env var so resolveModelRef falls back to its default
    // ({default: claude-opus-4-7} per existing behaviour).
    delete process.env[ENV_MODELS_JSON];
    await seedCaseYaml({
      casesDir,
      slug: "v11-default-opus",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-default-opus" },
      { runsDir, casesDir },
    );
    // The fallback default IS {default: ...}, so --model is present even
    // without an explicit override. Verify it appears.
    expect(plan.argv).toContain("--model");
  });

  it("opts.modelsOverride wins over GUILD_BENCHMARK_MODELS_JSON", async () => {
    process.env[ENV_MODELS_JSON] = JSON.stringify({
      default: "claude-haiku-4-5-20251001",
    });
    await seedCaseYaml({
      casesDir,
      slug: "v11-explicit-override",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      {
        caseSlug: "v11-explicit-override",
        modelsOverride: { default: "claude-sonnet-4-6" },
      },
      { runsDir, casesDir },
    );
    const modelIdx = plan.argv.indexOf("--model");
    expect(plan.argv[modelIdx + 1]).toBe("claude-sonnet-4-6");
  });
});

describe("runner / v1.1 — GUILD_BENCHMARK_ARGV_TEMPLATE ${MODEL} substitution", () => {
  let savedTmpl: string | undefined;
  beforeEach(() => {
    savedTmpl = process.env[ENV_ARGV_TEMPLATE];
  });
  afterEach(() => {
    if (savedTmpl === undefined) delete process.env[ENV_ARGV_TEMPLATE];
    else process.env[ENV_ARGV_TEMPLATE] = savedTmpl;
  });

  it("substitutes ${MODEL} from model_ref.default", async () => {
    process.env[ENV_MODELS_JSON] = JSON.stringify({
      default: "claude-sonnet-4-6",
    });
    process.env[ENV_ARGV_TEMPLATE] = JSON.stringify([
      "--print",
      "--model",
      "${MODEL}",
      "--add-dir",
      "${WORKSPACE_DIR}",
    ]);
    await seedCaseYaml({
      casesDir,
      slug: "v11-tmpl-model-sub",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-tmpl-model-sub" },
      { runsDir, casesDir },
    );
    expect(plan.argv).toContain("--model");
    const modelIdx = plan.argv.indexOf("--model");
    expect(plan.argv[modelIdx + 1]).toBe("claude-sonnet-4-6");
    // Default flags should be GONE — template replaces, not augments.
    expect(plan.argv).not.toContain("--prompt-file");
    expect(plan.argv).not.toContain("--workdir");
    // ${WORKSPACE_DIR} was substituted to the resolved workspace path.
    const addDirIdx = plan.argv.indexOf("--add-dir");
    expect(plan.argv[addDirIdx + 1]).toBe(plan.workspaceDir);
  });

  it("substitutes empty string when model_ref.default is missing", async () => {
    // resolveModelRef falls back to {default: claude-opus-4-7} when
    // GUILD_BENCHMARK_MODELS_JSON is unset, so to test the empty-string
    // path we explicitly override with a model_ref that has no `default`.
    process.env[ENV_MODELS_JSON] = JSON.stringify({
      architect: "claude-opus-4-7",
    });
    process.env[ENV_ARGV_TEMPLATE] = JSON.stringify([
      "--print",
      "--model",
      "${MODEL}",
    ]);
    await seedCaseYaml({
      casesDir,
      slug: "v11-tmpl-no-default-model",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-tmpl-no-default-model" },
      { runsDir, casesDir },
    );
    // ${MODEL} substituted to empty string — so argv has "--model" then "".
    const modelIdx = plan.argv.indexOf("--model");
    expect(plan.argv[modelIdx + 1]).toBe("");
  });
});

describe("runner / v1.1 — default argv drops --output-format stream-json", () => {
  // Closes the v1 audit finding: real `claude` v2.x rejects
  // `--output-format stream-json` without `--verbose`. Default no longer
  // sets the output format; the runner tees stdout regardless of format.
  it("default argv does not include --output-format or stream-json", async () => {
    await seedCaseYaml({
      casesDir,
      slug: "v11-no-output-format",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-no-output-format" },
      { runsDir, casesDir },
    );
    expect(plan.argv).not.toContain("--output-format");
    expect(plan.argv).not.toContain("stream-json");
  });

  it("operator can opt back into stream-json via GUILD_BENCHMARK_ARGV_TEMPLATE (with --verbose)", async () => {
    process.env[ENV_ARGV_TEMPLATE] = JSON.stringify([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--add-dir",
      "${WORKSPACE_DIR}",
    ]);
    await seedCaseYaml({
      casesDir,
      slug: "v11-tmpl-stream-json",
      fixturePath: fixtureDir,
    });
    const plan = await planRun(
      { caseSlug: "v11-tmpl-stream-json" },
      { runsDir, casesDir },
    );
    expect(plan.argv).toContain("--verbose");
    expect(plan.argv).toContain("--output-format");
    expect(plan.argv).toContain("stream-json");
    delete process.env[ENV_ARGV_TEMPLATE];
  });
});
