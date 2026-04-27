// loop.unit.test.ts
//
// P4 learning-loop orchestrator unit coverage. Pure-function + manifest
// IO + dry-run + validateContinue rejection paths. Spawn-based smoke for
// `loop --continue` against a real candidate is NOT exercised here — the
// runner's spawn surface is already pinned in runner.security.test.ts and
// would dominate this file's failure signal. We focus on:
//
//   - parseManifest        — schema_version (M8), state enum (M6/F2.5),
//                            proposal_id allowlist (M13), required-field
//                            invariants, applied_proposal optional handling.
//   - parseProposalBody    — frontmatter target/path extraction, header
//                            stripping, 160-char summary trimming.
//   - PROPOSAL_ID_RE       — accepts/rejects per security F2.1 / M13.
//   - manifestPathFor      — path composition.
//   - readGitHead          — falls back to "unknown" when not a git repo.
//   - loopStart (dry-run)  — no spawn, no manifest write; report shape.
//   - loopContinue (validation rejections, dry-run path) —
//                            argv validation (missing --baseline-run-id /
//                            --apply, bad proposal_id), manifest-not-found,
//                            state≠awaiting-apply (M6), baseline_run_id ↔
//                            dirname mismatch (F2.2), baseline_run_id ↔
//                            opts mismatch, proposal not in
//                            available_proposals (M13), empty
//                            available_proposals, missing proposal .md
//                            (F2.2), plugin_ref unchanged (M2/M7),
//                            plugin_ref readable failure (M2/M7).
//   - loopStatus           — happy path + missing-arg + missing-manifest.
//   - format*              — line-shape stability of the three formatters.
//
// Mitigation cross-walk: M2 / M6 / M7 / M8 / M13 / M14 (atomicity is
// observable via writeManifestAtomic's tmp file behaviour, but is not
// directly testable without a real run, so we cover it transitively via
// completeManifest invariants in the integration smoke).

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROPOSAL_ID_RE,
  formatContinueDryRun,
  formatStartDryRun,
  formatStatusReport,
  loopAbort,
  loopContinue,
  loopStart,
  loopStatus,
  manifestPathFor,
  parseManifest,
  parseProposalBody,
  readGitHead,
} from "../src/loop.js";
import type {
  LoopContinueOptions,
  LoopManifest,
  LoopStartOptions,
} from "../src/types.js";
import { ENV_CLAUDE_BIN } from "../src/runner.js";

// Per-test scratch tree. Layout:
//   <scratch>/                 ← validateContinue treats THIS as hostRepoRoot
//     fake-claude              (chmod 0o755 — never invoked because dry-run)
//     plugin/
//       cases/<slug>.yaml
//       runs/                  (passed as ctx.runsDir)
//       fixture/               (case fixture)
//
// validateContinue resolves hostRepoRoot as `dirname(dirname(runsDir))`,
// i.e. `dirname(dirname(<scratch>/plugin/runs)) === <scratch>`. We
// intentionally do NOT `git init` <scratch> by default, so
// `readGitHead(<scratch>)` returns "unknown" — that's the deterministic
// signal we test against in the plugin_ref-readable rejection path.
// Tests that need a concrete SHA call `git init <scratch>` themselves.
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
}): Promise<string> {
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

function defaultManifest(overrides: Partial<LoopManifest> = {}): LoopManifest {
  return {
    schema_version: 1,
    baseline_run_id: "synthetic-pass-001",
    case_slug: "demo-url-shortener-build",
    plugin_ref_before: "abc1234abc1234abc1234abc1234abc1234abc1",
    available_proposals: [
      {
        proposal_id: "ref-001",
        source_path: "agents/architect.md",
        summary: "Tighten architect briefing",
      },
    ],
    started_at: "2026-04-26T05:00:00Z",
    state: "awaiting-apply",
    ...overrides,
  };
}

async function seedManifest(
  runsDir: string,
  baselineRunId: string,
  manifest: LoopManifest,
): Promise<string> {
  const dir = join(runsDir, baselineRunId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "loop-manifest.json");
  await writeFile(path, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return path;
}

async function seedProposalMd(
  runsDir: string,
  baselineRunId: string,
  proposalId: string,
  body = "---\ntarget: agents/architect.md\n---\n# Tighten architect briefing\n",
): Promise<string> {
  const reflectionsDir = join(
    runsDir,
    baselineRunId,
    "artifacts",
    ".guild",
    "reflections",
  );
  await mkdir(reflectionsDir, { recursive: true });
  const path = join(reflectionsDir, `${proposalId}.md`);
  await writeFile(path, body, "utf8");
  return path;
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "qa-loop-unit-"));
  const pluginRoot = join(scratch, "plugin");
  runsDir = join(pluginRoot, "runs");
  casesDir = join(pluginRoot, "cases");
  fixtureDir = join(pluginRoot, "fixture");
  await mkdir(runsDir, { recursive: true });
  await mkdir(casesDir, { recursive: true });
  await seedFixture(fixtureDir);
  fakeClaude = await makeFakeClaude(scratch);
  process.env[ENV_CLAUDE_BIN] = fakeClaude;
});

afterEach(async () => {
  delete process.env[ENV_CLAUDE_BIN];
  await rm(scratch, { recursive: true, force: true });
});

// ---- PROPOSAL_ID_RE (M13 / security F2.1) -------------------------------

describe("loop / PROPOSAL_ID_RE — M13 path-traversal allowlist", () => {
  it("accepts simple alphanumeric ids", () => {
    expect(PROPOSAL_ID_RE.test("ref-001")).toBe(true);
    expect(PROPOSAL_ID_RE.test("a")).toBe(true);
    expect(PROPOSAL_ID_RE.test("PROPOSAL_42")).toBe(true);
    expect(PROPOSAL_ID_RE.test("a.b.c")).toBe(true);
    expect(PROPOSAL_ID_RE.test("dot-_combo.42")).toBe(true);
  });

  it("rejects path-separator characters", () => {
    // Note: the regex itself permits "." and "-", so the literal token ".."
    // passes the *regex*. The full path-traversal defence is layered:
    // (1) regex blocks `/` and `\`, (2) safeJoinUnder rejects the resolved
    // path, (3) cross-check against available_proposals[].proposal_id rejects
    // any token that wasn't produced by enumerateProposals().
    expect(PROPOSAL_ID_RE.test("../etc/passwd")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a/b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a\\b")).toBe(false);
  });

  it("rejects shell metacharacters and whitespace", () => {
    expect(PROPOSAL_ID_RE.test("a;b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a$b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a|b")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a`b")).toBe(false);
  });

  it("rejects NUL byte", () => {
    expect(PROPOSAL_ID_RE.test("a\u0000b")).toBe(false);
  });

  it("rejects empty and over-128 inputs", () => {
    expect(PROPOSAL_ID_RE.test("")).toBe(false);
    expect(PROPOSAL_ID_RE.test("a".repeat(129))).toBe(false);
    expect(PROPOSAL_ID_RE.test("a".repeat(128))).toBe(true);
  });
});

// ---- parseManifest (M6, M8, M13, schema invariants) ---------------------

describe("loop / parseManifest — manifest schema invariants", () => {
  it("parses a minimal happy-path manifest", () => {
    const m = defaultManifest();
    const out = parseManifest(JSON.stringify(m), "in-memory");
    expect(out.schema_version).toBe(1);
    expect(out.baseline_run_id).toBe(m.baseline_run_id);
    expect(out.case_slug).toBe(m.case_slug);
    expect(out.state).toBe("awaiting-apply");
    expect(out.available_proposals).toHaveLength(1);
    expect(out.available_proposals[0]?.proposal_id).toBe("ref-001");
    expect(out.applied_proposal).toBeUndefined();
  });

  it("parses an applied_proposal block when present", () => {
    const m = defaultManifest({
      state: "completed",
      applied_proposal: {
        proposal_id: "ref-001",
        source_path: "agents/architect.md",
        applied_at: "2026-04-26T17:00:00Z",
        plugin_ref_after: "def5678def5678def5678def5678def5678def56",
        candidate_run_id: "synthetic-pass-002",
      },
    });
    const out = parseManifest(JSON.stringify(m), "in-memory");
    expect(out.state).toBe("completed");
    expect(out.applied_proposal?.proposal_id).toBe("ref-001");
    expect(out.applied_proposal?.candidate_run_id).toBe("synthetic-pass-002");
  });

  it("parses an abort_reason when present", () => {
    const m = defaultManifest({
      state: "aborted",
      abort_reason: "operator cancelled",
    });
    const out = parseManifest(JSON.stringify(m), "in-memory");
    expect(out.state).toBe("aborted");
    expect(out.abort_reason).toBe("operator cancelled");
  });

  it("M8 — rejects schema_version != 1 (forwards-incompat)", () => {
    const m = { ...defaultManifest(), schema_version: 2 };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /schema_version=2/,
    );
  });

  it("M6/F2.5 — rejects unknown state values (no coercion, no trim)", () => {
    const m = { ...defaultManifest(), state: "AWAITING-APPLY" }; // wrong case
    expect(() =>
      parseManifest(JSON.stringify(m), "/tmp/x.json"),
    ).toThrow(/invalid state/);
  });

  it("rejects malformed JSON with a useful message", () => {
    expect(() => parseManifest("{not json}", "/tmp/x.json")).toThrow(
      /not valid JSON/,
    );
  });

  it("rejects a non-object root", () => {
    expect(() => parseManifest(JSON.stringify([]), "/tmp/x.json")).toThrow(
      /must be a JSON object/,
    );
    expect(() => parseManifest("null", "/tmp/x.json")).toThrow(
      /must be a JSON object/,
    );
  });

  it("rejects missing required string fields", () => {
    const m = defaultManifest();
    const broken = { ...m, baseline_run_id: "" };
    expect(() => parseManifest(JSON.stringify(broken), "/tmp/x.json")).toThrow(
      /baseline_run_id/,
    );
    const broken2 = { ...m, case_slug: undefined };
    expect(() =>
      parseManifest(JSON.stringify(broken2), "/tmp/x.json"),
    ).toThrow(/case_slug/);
  });

  it("rejects available_proposals not being an array", () => {
    const m = { ...defaultManifest(), available_proposals: "nope" };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /available_proposals must be an array/,
    );
  });

  it("M13 — rejects an available_proposals[i].proposal_id that fails the allowlist", () => {
    const m = {
      ...defaultManifest(),
      available_proposals: [
        { proposal_id: "../escape", source_path: "x", summary: "y" },
      ],
    };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /not a valid id \(M13\)/,
    );
  });

  it("rejects an available_proposals[i] that's not an object", () => {
    const m = { ...defaultManifest(), available_proposals: ["not-an-object"] };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /is not an object/,
    );
  });

  it("rejects an available_proposals[i] with non-string source_path", () => {
    const m = {
      ...defaultManifest(),
      available_proposals: [
        { proposal_id: "ref-001", source_path: 42, summary: "y" },
      ],
    };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /source_path must be a string/,
    );
  });

  it("rejects an available_proposals[i] with non-string summary", () => {
    const m = {
      ...defaultManifest(),
      available_proposals: [
        { proposal_id: "ref-001", source_path: "x", summary: null },
      ],
    };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /summary must be a string/,
    );
  });

  it("M13 — rejects applied_proposal.proposal_id that fails the allowlist", () => {
    const m = {
      ...defaultManifest(),
      applied_proposal: {
        proposal_id: "../escape",
        source_path: "x",
        applied_at: "now",
        plugin_ref_after: "abc",
        candidate_run_id: "y",
      },
    };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /applied_proposal.proposal_id invalid \(M13\)/,
    );
  });

  it("rejects applied_proposal that's not an object", () => {
    const m = { ...defaultManifest(), applied_proposal: "nope" };
    expect(() => parseManifest(JSON.stringify(m), "/tmp/x.json")).toThrow(
      /applied_proposal must be an object/,
    );
  });
});

// ---- parseProposalBody --------------------------------------------------

describe("loop / parseProposalBody — frontmatter + summary extraction", () => {
  it("extracts target: from frontmatter", () => {
    const body = "---\ntarget: agents/architect.md\n---\n# Tighten briefing\n";
    const { sourcePath, summary } = parseProposalBody(body);
    expect(sourcePath).toBe("agents/architect.md");
    expect(summary).toBe("Tighten briefing");
  });

  it("extracts path: from frontmatter as a fallback", () => {
    const body = "---\npath: skills/core/foo.md\n---\n# update foo\n";
    const { sourcePath, summary } = parseProposalBody(body);
    expect(sourcePath).toBe("skills/core/foo.md");
    expect(summary).toBe("update foo");
  });

  it("strips surrounding double and single quotes from frontmatter values", () => {
    const dq = parseProposalBody(
      `---\ntarget: "agents/with space.md"\n---\nsummary line\n`,
    );
    expect(dq.sourcePath).toBe("agents/with space.md");
    const sq = parseProposalBody(
      `---\ntarget: 'agents/with space.md'\n---\nsummary line\n`,
    );
    expect(sq.sourcePath).toBe("agents/with space.md");
  });

  it("returns empty sourcePath when no frontmatter is present", () => {
    const { sourcePath, summary } = parseProposalBody("# Naked header\n");
    expect(sourcePath).toBe("");
    expect(summary).toBe("Naked header");
  });

  it("strips multiple leading `#` markers from the summary line", () => {
    const out = parseProposalBody("---\n---\n### Triple hash\n");
    expect(out.summary).toBe("Triple hash");
  });

  it("trims the summary to <= 160 chars", () => {
    const long = "x".repeat(300);
    const out = parseProposalBody(`---\n---\n${long}\n`);
    expect(out.summary.length).toBe(160);
    expect(out.summary).toBe("x".repeat(160));
  });

  it("skips blank lines until it finds the first non-empty line", () => {
    const out = parseProposalBody("---\n---\n\n\n  \n# Real header\n");
    expect(out.summary).toBe("Real header");
  });

  it("handles unterminated frontmatter (no closing ---) by emitting empty summary", () => {
    const out = parseProposalBody("---\ntarget: agents/x.md\nno closing");
    // Frontmatter never terminates → bodyStart pushed past EOF → summary empty.
    expect(out.sourcePath).toBe("agents/x.md");
    expect(out.summary).toBe("");
  });
});

// ---- manifestPathFor + readGitHead --------------------------------------

describe("loop / manifestPathFor", () => {
  it("composes <runsDir>/<baselineRunId>/loop-manifest.json", () => {
    const out = manifestPathFor("/tmp/runs", "run-x");
    expect(out).toBe(resolve("/tmp/runs/run-x/loop-manifest.json"));
  });

  it("normalises redundant segments via path.resolve semantics", () => {
    const out = manifestPathFor("/tmp/runs/", "run-y");
    expect(out).toBe(resolve("/tmp/runs/run-y/loop-manifest.json"));
  });
});

describe("loop / readGitHead — git rev-parse fallback", () => {
  it("returns 'unknown' when the path is not a git repo", () => {
    // <scratch> has no .git — the host of this test does, but we point at scratch.
    expect(readGitHead(scratch)).toBe("unknown");
  });

  it("returns a 40-char SHA when the path is a real git repo", () => {
    // Initialise a throwaway git repo in <scratch>/git-host.
    const gitHost = join(scratch, "git-host");
    execFileSync("git", ["init", "-q", gitHost], { stdio: "ignore" });
    execFileSync("git", ["-C", gitHost, "config", "user.email", "qa@local"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", gitHost, "config", "user.name", "qa"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", gitHost, "commit", "--allow-empty", "-m", "init"],
      { stdio: "ignore" },
    );
    const head = readGitHead(gitHost);
    expect(head).toMatch(/^[a-f0-9]{40}$/);
  });
});

// ---- loopStart (dry-run) ------------------------------------------------

describe("loop / loopStart --dry-run", () => {
  it("returns a plan-shaped report without writing the manifest", async () => {
    const slug = "demo-url-shortener-build";
    await seedCaseYaml({ casesDir, slug, fixturePath: fixtureDir });
    const opts: LoopStartOptions = { caseSlug: slug, dryRun: true };
    const result = await loopStart(opts, { runsDir, casesDir });
    expect("kind" in result && result.kind === "start").toBe(true);
    if ("kind" in result && result.kind === "start") {
      expect(result.caseSlug).toBe(slug);
      expect(result.baselineRunId).toBeTruthy();
      expect(result.manifestPath).toContain("loop-manifest.json");
      expect(result.reflectionsDir).toContain(".guild/reflections");
      expect(Array.isArray(result.argv)).toBe(true);
      expect(result.argv.length).toBeGreaterThan(0);
    }
  });

  it("rejects when --case is missing", async () => {
    const opts = { dryRun: true } as unknown as LoopStartOptions;
    await expect(loopStart(opts, { runsDir, casesDir })).rejects.toThrow(
      /--case <slug> is required/,
    );
  });

  it("formatStartDryRun emits each documented field on its own line", async () => {
    const slug = "demo-url-shortener-build";
    await seedCaseYaml({ casesDir, slug, fixturePath: fixtureDir });
    const result = await loopStart(
      { caseSlug: slug, dryRun: true },
      { runsDir, casesDir },
    );
    if (!("kind" in result) || result.kind !== "start") {
      throw new Error("expected dry-run shape");
    }
    const out = formatStartDryRun(result);
    expect(out).toContain("benchmark loop --start --dry-run");
    expect(out).toContain("baseline_run_id");
    expect(out).toContain("manifest_path");
    expect(out).toContain("plugin_ref_before");
    expect(out).toContain("baseline_argv");
    expect(out).toContain("(dry-run: no subprocess spawned");
  });
});

// ---- loopContinue — argv & manifest preconditions -----------------------

describe("loop / loopContinue — input preconditions (M13 + arg shape)", () => {
  it("rejects when --baseline-run-id is missing", async () => {
    const opts = { proposalId: "ref-001" } as unknown as LoopContinueOptions;
    await expect(
      loopContinue(opts, { runsDir, casesDir }),
    ).rejects.toThrow(/--baseline-run-id <id> is required/);
  });

  it("rejects when --apply (proposalId) is missing", async () => {
    const opts = {
      baselineRunId: "synthetic-pass-001",
    } as unknown as LoopContinueOptions;
    await expect(
      loopContinue(opts, { runsDir, casesDir }),
    ).rejects.toThrow(/--apply <proposal-id> is required/);
  });

  it("M13 — rejects a proposalId that fails PROPOSAL_ID_RE before any disk read", async () => {
    const opts: LoopContinueOptions = {
      baselineRunId: "synthetic-pass-001",
      proposalId: "../etc/passwd",
    };
    await expect(
      loopContinue(opts, { runsDir, casesDir }),
    ).rejects.toThrow(/not a valid proposal_id.*M13/);
  });

  it("rejects when manifest does not exist on disk", async () => {
    const opts: LoopContinueOptions = {
      baselineRunId: "synthetic-pass-001",
      proposalId: "ref-001",
    };
    await expect(
      loopContinue(opts, { runsDir, casesDir }),
    ).rejects.toThrow(/manifest not found/);
  });
});

// ---- loopContinue — validateContinue rejection paths --------------------

describe("loop / loopContinue — validateContinue rejection paths", () => {
  const baselineRunId = "synthetic-pass-001";

  it("M6 — rejects when manifest.state === 'completed'", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId, state: "completed" }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/state is "completed".*M6/);
  });

  it("M6 — rejects when manifest.state === 'aborted'", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId, state: "aborted" }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/state is "aborted".*M6/);
  });

  it("F2.2 — rejects baseline_run_id ↔ dirname mismatch (replay defence)", async () => {
    // Seed manifest under <runsDir>/<dir>/loop-manifest.json BUT with
    // manifest.baseline_run_id pointing at a different id. F2.2 catches
    // an attacker who copies a valid manifest into another directory.
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: "WRONG-id" }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/does not match directory.*F2\.2/);
  });

  it("rejects when --baseline-run-id arg differs from manifest.baseline_run_id", async () => {
    // Both manifest dirname AND manifest.baseline_run_id point at
    // baselineRunId; the operator passed a different --baseline-run-id.
    // We seed under that operator-supplied dir so the file-exists check
    // succeeds, then catch the cross-arg mismatch on the next line.
    const operatorId = "operator-run-id";
    await seedManifest(
      runsDir,
      operatorId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    await seedProposalMd(runsDir, operatorId, "ref-001");
    // Manifest file exists at runs/operator-run-id/loop-manifest.json,
    // but manifest.baseline_run_id === baselineRunId, NOT operatorId.
    // The dirname-mismatch (F2.2) check fires first since dirname=
    // operatorId !== manifest.baseline_run_id=baselineRunId.
    await expect(
      loopContinue(
        { baselineRunId: operatorId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/does not match directory/);
  });

  it("M13 — rejects --apply value not present in available_proposals", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-not-in-list");
    await expect(
      loopContinue(
        {
          baselineRunId,
          proposalId: "ref-not-in-list",
          dryRun: true,
        },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/not in available_proposals.*M13/);
  });

  it("rejects when available_proposals is empty (baseline produced no proposals)", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({
        baseline_run_id: baselineRunId,
        available_proposals: [],
      }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/produced no proposals/);
  });

  it("F2.2 — rejects when proposal .md file is missing from disk", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    // Note: no seedProposalMd — the manifest CLAIMS ref-001 exists, but
    // the .md file is absent. F2.2 catches an attacker who tampered with
    // the manifest after the baseline ran.
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/proposal file.*not found on disk.*F2\.2/);
  });

  it("M2/M7 — rejects when host repo HEAD is unreadable (no git repo at host root)", async () => {
    // Our scratch host has no .git, so readGitHead returns "unknown".
    // Per loop.ts line 632-636, currentHead==="unknown" rejects with the
    // M2/M7 message.
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/cannot read host repo HEAD.*M2\/M7/);
  });

  it("M2/M7 — rejects when host HEAD equals manifest.plugin_ref_before (operator forgot to commit)", async () => {
    // Initialise <scratch> (= dirname(dirname(runsDir)) = host) as a real
    // git repo so readGitHead returns a concrete SHA.
    execFileSync("git", ["init", "-q", scratch], { stdio: "ignore" });
    execFileSync("git", ["-C", scratch, "config", "user.email", "qa@local"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", scratch, "config", "user.name", "qa"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", scratch, "commit", "--allow-empty", "-m", "init"],
      { stdio: "ignore" },
    );
    const currentHead = readGitHead(scratch);
    expect(currentHead).toMatch(/^[a-f0-9]{40}$/);
    // Manifest.plugin_ref_before === currentHead → M2/M7 fires.
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({
        baseline_run_id: baselineRunId,
        plugin_ref_before: currentHead,
      }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    await expect(
      loopContinue(
        { baselineRunId, proposalId: "ref-001", dryRun: true },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/equals manifest\.plugin_ref_before.*M2\/M7/);
  });
});

// ---- loopContinue — dry-run happy path ----------------------------------

describe("loop / loopContinue --dry-run happy path", () => {
  it("returns a continue dry-run report when all validations pass", async () => {
    const slug = "demo-url-shortener-build";
    const baselineRunId = "synthetic-pass-001";
    await seedCaseYaml({ casesDir, slug, fixturePath: fixtureDir });
    // Init <scratch> (= host root per dirname(dirname(runsDir))) so the
    // plugin_ref M2/M7 check sees a concrete SHA, not "unknown".
    execFileSync("git", ["init", "-q", scratch], { stdio: "ignore" });
    execFileSync("git", ["-C", scratch, "config", "user.email", "qa@local"], {
      stdio: "ignore",
    });
    execFileSync("git", ["-C", scratch, "config", "user.name", "qa"], {
      stdio: "ignore",
    });
    execFileSync(
      "git",
      ["-C", scratch, "commit", "--allow-empty", "-m", "init"],
      { stdio: "ignore" },
    );
    // Set plugin_ref_before to a different SHA so M2/M7 doesn't fire.
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({
        baseline_run_id: baselineRunId,
        case_slug: slug,
        plugin_ref_before: "0".repeat(40), // ≠ real HEAD
      }),
    );
    await seedProposalMd(runsDir, baselineRunId, "ref-001");
    const result = await loopContinue(
      { baselineRunId, proposalId: "ref-001", dryRun: true },
      { runsDir, casesDir },
    );
    expect("kind" in result && result.kind === "continue").toBe(true);
    if ("kind" in result && result.kind === "continue") {
      expect(result.proposalId).toBe("ref-001");
      expect(result.proposalSourcePath).toBe("agents/architect.md");
      expect(result.candidateRunId).toBeTruthy();
      expect(result.pluginRefBefore).toBe("0".repeat(40));
      expect(result.pluginRefAfter).toMatch(/^[a-f0-9]{40}$/);
      expect(result.comparisonPath).toContain("_compare");
      // formatContinueDryRun stable output shape.
      const out = formatContinueDryRun(result);
      expect(out).toContain("benchmark loop --continue --dry-run");
      expect(out).toContain("manifest_path");
      expect(out).toContain("plugin_ref_before");
      expect(out).toContain("plugin_ref_after");
      expect(out).toContain("apply (proposal_id)  : ref-001");
      expect(out).toContain("manifest_state_after : completed");
    }
  });
});

// ---- loopStatus ---------------------------------------------------------

describe("loop / loopStatus", () => {
  const baselineRunId = "synthetic-pass-001";

  it("rejects when --baseline-run-id is missing", async () => {
    await expect(
      loopStatus(
        { baselineRunId: "" } as unknown as { baselineRunId: string },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/--baseline-run-id <id> is required/);
  });

  it("rejects when manifest does not exist", async () => {
    await expect(
      loopStatus({ baselineRunId }, { runsDir, casesDir }),
    ).rejects.toThrow(/manifest not found/);
  });

  it("returns the manifest when it exists", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    const r = await loopStatus({ baselineRunId }, { runsDir, casesDir });
    expect(r.manifest.baseline_run_id).toBe(baselineRunId);
    expect(r.manifest.state).toBe("awaiting-apply");
    expect(r.manifestPath).toContain("loop-manifest.json");
  });

  it("formatStatusReport prints state, proposals, and the next-step hint", async () => {
    await seedManifest(
      runsDir,
      baselineRunId,
      defaultManifest({ baseline_run_id: baselineRunId }),
    );
    const r = await loopStatus({ baselineRunId }, { runsDir, casesDir });
    const out = formatStatusReport(r);
    expect(out).toContain("benchmark loop --status");
    expect(out).toContain("state             : awaiting-apply");
    expect(out).toContain("available_proposals (1)");
    expect(out).toContain("- ref-001");
    expect(out).toContain("Next: apply a proposal");
    expect(out).toContain("--apply ref-001");
  });

  it("formatStatusReport renders applied_proposal block when state=completed", async () => {
    const m = defaultManifest({
      baseline_run_id: baselineRunId,
      state: "completed",
      applied_proposal: {
        proposal_id: "ref-001",
        source_path: "agents/architect.md",
        applied_at: "2026-04-26T17:00:00Z",
        plugin_ref_after: "def5678def5678def5678def5678def5678def56",
        candidate_run_id: "synthetic-pass-002",
      },
    });
    await seedManifest(runsDir, baselineRunId, m);
    const r = await loopStatus({ baselineRunId }, { runsDir, casesDir });
    const out = formatStatusReport(r);
    expect(out).toContain("state             : completed");
    expect(out).toContain("applied_proposal:");
    expect(out).toContain("proposal_id      : ref-001");
    expect(out).toContain("candidate_run_id : synthetic-pass-002");
    // No "Next: apply a proposal" hint when state != awaiting-apply.
    expect(out).not.toContain("Next: apply a proposal");
  });
});

// v1.2 — F1: loop --abort closes the deferred action that P4 reserved
// state="aborted" for but never wired. Mirrors continue/status arg
// validation; refuses on terminal states; cleans up the lockfile.
describe("loop / loopAbort", () => {
  const baselineRunId = "synthetic-pass-001";

  it("rejects when --baseline-run-id is missing", async () => {
    await expect(
      loopAbort({ baselineRunId: "" }, { runsDir, casesDir }),
    ).rejects.toThrow(/--baseline-run-id <id> is required/);
  });

  it("rejects when --baseline-run-id contains illegal characters (M13 allowlist)", async () => {
    await expect(
      loopAbort(
        { baselineRunId: "../etc/passwd" },
        { runsDir, casesDir },
      ),
    ).rejects.toThrow(/contains illegal characters/);
  });

  it("rejects when manifest is missing", async () => {
    await expect(
      loopAbort({ baselineRunId }, { runsDir, casesDir }),
    ).rejects.toThrow(/manifest not found/);
  });

  it("flips manifest state to aborted on awaiting-apply manifest", async () => {
    const m = defaultManifest({ baseline_run_id: baselineRunId });
    const path = await seedManifest(runsDir, baselineRunId, m);
    const report = await loopAbort({ baselineRunId }, { runsDir, casesDir });
    expect(report.manifestStateBefore).toBe("awaiting-apply");
    expect(report.manifestStateAfter).toBe("aborted");
    expect(report.manifestPath).toBe(path);
    // Verify on disk.
    const after = JSON.parse(
      await (await import("node:fs/promises")).readFile(path, "utf8"),
    ) as LoopManifest;
    expect(after.state).toBe("aborted");
  });

  it("refuses to abort a completed manifest", async () => {
    const m = defaultManifest({
      baseline_run_id: baselineRunId,
      state: "completed",
      applied_proposal: {
        proposal_id: "ref-001",
        source_path: "agents/architect.md",
        applied_at: "2026-04-26T17:00:00Z",
        plugin_ref_after: "def5678def5678def5678def5678def5678def56",
        candidate_run_id: "synthetic-pass-002",
      },
    });
    await seedManifest(runsDir, baselineRunId, m);
    await expect(
      loopAbort({ baselineRunId }, { runsDir, casesDir }),
    ).rejects.toThrow(/cannot abort a completed loop/);
  });

  it("refuses to re-abort an already-aborted manifest (idempotent error)", async () => {
    const m = defaultManifest({
      baseline_run_id: baselineRunId,
      state: "aborted",
    });
    await seedManifest(runsDir, baselineRunId, m);
    await expect(
      loopAbort({ baselineRunId }, { runsDir, casesDir }),
    ).rejects.toThrow(/already "aborted"/);
  });

  it("removes a present lockfile when aborting", async () => {
    const m = defaultManifest({ baseline_run_id: baselineRunId });
    const manifestPath = await seedManifest(runsDir, baselineRunId, m);
    const lockPath = `${manifestPath}.lock`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(lockPath, "", "utf8");
    const report = await loopAbort({ baselineRunId }, { runsDir, casesDir });
    expect(report.lockfileExisted).toBe(true);
    const fsSync = await import("node:fs");
    expect(fsSync.existsSync(lockPath)).toBe(false);
  });

  it("--dry-run reports the proposed transition without mutating disk", async () => {
    const m = defaultManifest({ baseline_run_id: baselineRunId });
    const manifestPath = await seedManifest(runsDir, baselineRunId, m);
    const report = await loopAbort(
      { baselineRunId, dryRun: true },
      { runsDir, casesDir },
    );
    expect(report.manifestStateAfter).toBe("aborted");
    // Still awaiting-apply on disk.
    const fs = await import("node:fs/promises");
    const after = JSON.parse(await fs.readFile(manifestPath, "utf8")) as LoopManifest;
    expect(after.state).toBe("awaiting-apply");
  });
});
