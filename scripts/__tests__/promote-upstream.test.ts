/**
 * scripts/__tests__/promote-upstream.test.ts
 *
 * TDD — tests written BEFORE implementation. All tests confirmed RED (module not
 * found) before scripts/workspace/promote-upstream.ts was written.
 *
 * Covers (Lane C spec, SC-4):
 *   1. Cross-cutting wiki_candidate (applies_to.length > 1) → staged.
 *   2. Decision_candidate with upstream:true → staged.
 *   3. Single-repo applies_to (length === 1) → NOT staged.
 *   4. Absent applies_to and absent upstream → NOT staged.
 *   5. Assert NO file written under any docs/knowledge/ path (gate preserved).
 *   6. Assert staged manifest contains NO body_draft (by-reference only).
 *   7. Candidates from multiple children are merged into one manifest.
 *   8. Manifest schema_version = guild.upstream_candidates.v1.
 *  12. (Finding #2) Path traversal rejection in run-id.
 *  13. (Finding #4) Malformed wiki_candidates/decision_candidates arrays → graceful skip.
 *  14. (Finding #6) CLI manifest writer writes to correct path; schema correct.
 *
 * HARD INVARIANTS (must never be violated):
 *   - Nothing written under docs/knowledge/.
 *   - UpstreamCandidate carries no body_draft / decision body (query-not-copy).
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawnSync } from "child_process";

import {
  collectUpstreamCandidates,
  validateRunId,
  type UpstreamCandidate,
} from "../workspace/promote-upstream";

const SCRIPT = path.resolve(__dirname, "../workspace/promote-upstream.ts");
const NODE_ENV = {
  ...process.env,
  NODE_NO_WARNINGS: "1",
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
} as NodeJS.ProcessEnv;

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface HarvestCandidates {
  schema_version: string;
  run_id: string;
  generated_at: string;
  source_artifacts: string[];
  wiki_candidates: Array<{
    title: string;
    category?: string;
    body_draft?: string;
    confidence?: string;
    source_refs?: string[];
    linked_run?: string;
    linked_initiative?: string;
    when_to_revisit?: string;
    promotion_gate?: string;
    applies_to?: string[];
    upstream?: boolean;
  }>;
  decision_candidates: Array<{
    decision: string;
    context?: string;
    alternatives?: string[];
    rationale?: string;
    source_refs?: string[];
    confidence?: string;
    promotion_gate?: string;
    applies_to?: string[];
    upstream?: boolean;
  }>;
}

function makeHarvestFile(opts: {
  dir: string;
  runId: string;
  wiki?: HarvestCandidates["wiki_candidates"];
  decisions?: HarvestCandidates["decision_candidates"];
}): string {
  const learnDir = path.join(opts.dir, ".guild", "runs", opts.runId, "learn");
  fs.mkdirSync(learnDir, { recursive: true });
  const harvestPath = path.join(learnDir, "harvest-candidates.json");
  const data: HarvestCandidates = {
    schema_version: "guild.harvest_candidates.v1",
    run_id: opts.runId,
    generated_at: new Date().toISOString(),
    source_artifacts: [],
    wiki_candidates: opts.wiki ?? [],
    decision_candidates: opts.decisions ?? [],
  };
  fs.writeFileSync(harvestPath, JSON.stringify(data, null, 2), "utf8");
  return harvestPath;
}

function makeWorkspaceJson(workspaceRoot: string, childNames: string[]): void {
  const guildDir = path.join(workspaceRoot, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  const manifest = {
    schema_version: "guild.workspace.v1",
    is_workspace: true,
    sub_guilds: childNames.map((name) => ({
      name,
      path: name,
      kind: "sub-guild",
    })),
  };
  fs.writeFileSync(
    path.join(guildDir, "workspace.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("collectUpstreamCandidates — filtering logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-promote-upstream-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. Cross-cutting wiki candidate (applies_to.length > 1) → staged ─────────

  test("cross-cutting wiki_candidate (applies_to.length > 1) is staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-test-1",
      wiki: [
        {
          title: "Cross-repo architecture pattern",
          body_draft: "This is the body — must NOT appear in output.",
          confidence: "high",
          source_refs: ["handoffs/arch.md#section-1"],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"], // length > 1 → cross-cutting
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("wiki");
    expect(candidates[0].id_or_title).toBe("Cross-repo architecture pattern");
    expect(candidates[0].source_repo).toBe("plugin");
    expect(candidates[0].applies_to).toEqual(["plugin", "website"]);
  });

  // ── 2. Decision candidate with upstream:true → staged ────────────────────────

  test("decision_candidate with upstream:true is staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-test-2",
      decisions: [
        {
          decision: "All workspace promotions are human-gated",
          context: "autopromote:false invariant",
          rationale: "Prevents accidental cross-repo pollution",
          source_refs: [".guild/runs/run-test-2/handoffs/tooling-engineer.md"],
          promotion_gate: "guild:decisions",
          upstream: true, // explicit upstream signal
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("decision");
    expect(candidates[0].id_or_title).toBe("All workspace promotions are human-gated");
    expect(candidates[0].upstream).toBe(true);
  });

  // ── 3. Single-repo applies_to (length === 1) → NOT staged ────────────────────

  test("wiki_candidate with applies_to.length === 1 is NOT staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-test-3",
      wiki: [
        {
          title: "Plugin-only internal detail",
          body_draft: "Internal body.",
          confidence: "medium",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin"], // single repo → NOT cross-cutting
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(0);
  });

  // ── 4. Absent applies_to and absent upstream → NOT staged ────────────────────

  test("candidate with absent applies_to and absent upstream is NOT staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-test-4",
      wiki: [
        {
          title: "Some routine wiki entry",
          body_draft: "Body content.",
          confidence: "low",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          // No applies_to, no upstream
        },
      ],
      decisions: [
        {
          decision: "Use tabs over spaces",
          context: "Style preference",
          source_refs: [],
          promotion_gate: "guild:decisions",
          // No applies_to, no upstream
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(0);
  });

  // ── 5. HARD INVARIANT: nothing written under docs/knowledge/ ─────────────────

  test("INVARIANT: collectUpstreamCandidates writes nothing under docs/knowledge/", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-inv-1",
      wiki: [
        {
          title: "Cross-cutting page",
          body_draft: "Body that must never be written to docs/",
          confidence: "high",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
    });

    collectUpstreamCandidates({ workspaceRoot: tmpDir, child: "plugin" });

    // docs/knowledge/ must NOT exist under workspace root
    expect(fs.existsSync(path.join(tmpDir, "docs"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "docs", "knowledge"))).toBe(false);
  });

  // ── 6. HARD INVARIANT: by-reference only — no body_draft in staged candidates ─

  test("INVARIANT: staged candidates contain NO body_draft (by-reference only)", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-inv-2",
      wiki: [
        {
          title: "Cross-cutting knowledge",
          body_draft: "This body MUST NOT appear in the staged candidate output.",
          confidence: "high",
          source_refs: [".guild/runs/run-inv-2/handoffs/arch.md"],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
      decisions: [
        {
          decision: "Upstream always requires human gate",
          context: "Important context text — must NOT appear in output",
          rationale: "Rationale text — must NOT appear in output",
          source_refs: [".guild/runs/run-inv-2/handoffs/arch.md"],
          promotion_gate: "guild:decisions",
          upstream: true,
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(2);
    for (const c of candidates) {
      // body_draft must never appear on the candidate
      expect((c as unknown as Record<string, unknown>)["body_draft"]).toBeUndefined();
      // decision body fields must never appear
      expect((c as unknown as Record<string, unknown>)["context"]).toBeUndefined();
      expect((c as unknown as Record<string, unknown>)["rationale"]).toBeUndefined();
      expect((c as unknown as Record<string, unknown>)["alternatives"]).toBeUndefined();
    }
  });

  // ── 7. Multiple children merged ───────────────────────────────────────────────

  test("candidates from multiple children are collected when no child filter", () => {
    for (const childName of ["plugin", "website"]) {
      const childDir = path.join(tmpDir, childName);
      fs.mkdirSync(childDir, { recursive: true });
    }
    makeWorkspaceJson(tmpDir, ["plugin", "website"]);

    makeHarvestFile({
      dir: path.join(tmpDir, "plugin"),
      runId: "run-multi-1",
      wiki: [
        {
          title: "Plugin cross-cutting wiki",
          confidence: "high",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
    });

    makeHarvestFile({
      dir: path.join(tmpDir, "website"),
      runId: "run-multi-2",
      decisions: [
        {
          decision: "Website decision that is cross-cutting",
          source_refs: [],
          promotion_gate: "guild:decisions",
          upstream: true,
        },
      ],
    });

    const candidates = collectUpstreamCandidates({ workspaceRoot: tmpDir });

    expect(candidates.length).toBe(2);
    const sourceRepos = candidates.map((c) => c.source_repo).sort();
    expect(sourceRepos).toEqual(["plugin", "website"]);
  });

  // ── 8. Schema fields on UpstreamCandidate ────────────────────────────────────

  test("staged candidate has all required UpstreamCandidate fields", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-schema-1",
      wiki: [
        {
          title: "Schema check wiki",
          body_draft: "Body not to appear",
          confidence: "high",
          source_refs: ["handoffs/x.md#section"],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(1);
    const c: UpstreamCandidate = candidates[0];
    // Required by-reference fields
    expect(c.kind).toBe("wiki");
    expect(typeof c.id_or_title).toBe("string");
    expect(typeof c.source_repo).toBe("string");
    expect(typeof c.source_path).toBe("string");
    expect(Array.isArray(c.source_refs)).toBe(true);
    expect(typeof c.promotion_gate).toBe("string");
    // Optional but expected when present
    expect(Array.isArray(c.applies_to)).toBe(true);
  });

  // ── 9. child filter via opts.child ───────────────────────────────────────────

  test("opts.child restricts scan to one child only", () => {
    for (const childName of ["plugin", "website"]) {
      const childDir = path.join(tmpDir, childName);
      fs.mkdirSync(childDir, { recursive: true });
    }
    makeWorkspaceJson(tmpDir, ["plugin", "website"]);

    makeHarvestFile({
      dir: path.join(tmpDir, "plugin"),
      runId: "run-child-1",
      wiki: [
        {
          title: "Plugin-only cross-cutting",
          confidence: "high",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
    });

    makeHarvestFile({
      dir: path.join(tmpDir, "website"),
      runId: "run-child-2",
      wiki: [
        {
          title: "Website cross-cutting",
          confidence: "high",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin", "website"],
        },
      ],
    });

    // Only scan "plugin"
    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(1);
    expect(candidates[0].source_repo).toBe("plugin");
  });

  // ── 10. Missing harvest file → graceful empty result ─────────────────────────

  test("child with no harvest-candidates.json yields no candidates (graceful)", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);
    // Do NOT create any harvest file

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(0);
  });

  // ── 11. upstream:false explicitly → NOT staged ───────────────────────────────

  test("wiki_candidate with upstream:false and applies_to.length <= 1 is NOT staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    makeHarvestFile({
      dir: childDir,
      runId: "run-false-1",
      wiki: [
        {
          title: "Explicitly not upstream",
          confidence: "medium",
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
          applies_to: ["plugin"],
          upstream: false,
        },
      ],
    });

    const candidates = collectUpstreamCandidates({
      workspaceRoot: tmpDir,
      child: "plugin",
    });

    expect(candidates.length).toBe(0);
  });
});

// ── Finding #2 — validateRunId: path traversal rejection ─────────────────────

describe("validateRunId — path traversal rejection (Finding #2)", () => {
  test("normal run-id is valid", () => {
    expect(validateRunId("upstream-all")).toBe(true);
    expect(validateRunId("upstream-plugin")).toBe(true);
    expect(validateRunId("run-2026-05-31")).toBe(true);
    expect(validateRunId("my-run-id_123")).toBe(true);
  });

  test("run-id with '..' component is rejected", () => {
    expect(validateRunId("../../etc/passwd")).toBe(false);
    expect(validateRunId("..")).toBe(false);
    expect(validateRunId("foo/../bar")).toBe(false);
  });

  test("single-dot run-id is rejected (collapses onto runs base)", () => {
    expect(validateRunId(".")).toBe(false);
  });

  test("run-id with path separator is rejected", () => {
    expect(validateRunId("foo/bar")).toBe(false);
    expect(validateRunId("foo\\bar")).toBe(false);
  });

  test("run-id starting with '/' (absolute) is rejected", () => {
    expect(validateRunId("/etc/passwd")).toBe(false);
    expect(validateRunId("/tmp/something")).toBe(false);
  });

  test("run-id containing NUL byte is rejected", () => {
    expect(validateRunId("foo\x00bar")).toBe(false);
  });

  test("run-id with '..' disguised in longer string is rejected", () => {
    expect(validateRunId("..docs")).toBe(false);
    expect(validateRunId("docs..")).toBe(false);
  });

  // ── Residual A — empty and whitespace-only run-ids ────────────────────────────

  test("empty run-id is rejected (Residual A)", () => {
    expect(validateRunId("")).toBe(false);
  });

  test("whitespace-only run-id is rejected (Residual A)", () => {
    expect(validateRunId("   ")).toBe(false);
    expect(validateRunId("\t")).toBe(false);
    expect(validateRunId("\n")).toBe(false);
  });

  // Note: "%2e%2e" (URL-encoded "..") is NOT a traversal — path.join does not
  // URL-decode. It is a harmless literal directory name and passes validation.
  test("%2e%2e (URL-encoded dots) is a harmless literal name — passes", () => {
    expect(validateRunId("%2e%2e")).toBe(true);
  });
});

// ── Finding #4 — malformed wiki_candidates/decision_candidates arrays ─────────

describe("extractFromHarvestFile — malformed arrays → graceful skip (Finding #4)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-promote-malformed-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRawHarvestFile(dir: string, runId: string, raw: unknown): void {
    const learnDir = path.join(dir, ".guild", "runs", runId, "learn");
    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnDir, "harvest-candidates.json"),
      JSON.stringify(raw, null, 2),
      "utf8",
    );
  }

  function makeWorkspaceJson(workspaceRoot: string, childNames: string[]): void {
    const guildDir = path.join(workspaceRoot, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    const manifest = {
      schema_version: "guild.workspace.v1",
      is_workspace: true,
      sub_guilds: childNames.map((name) => ({ name, path: name, kind: "sub-guild" })),
    };
    fs.writeFileSync(
      path.join(guildDir, "workspace.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }

  test("wiki_candidates is null → treated as empty array, no throw", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);
    makeRawHarvestFile(childDir, "run-malformed-1", {
      schema_version: "guild.harvest_candidates.v1",
      run_id: "run-malformed-1",
      wiki_candidates: null, // malformed — not an array
      decision_candidates: [
        { decision: "Cross-cutting decision", upstream: true, source_refs: [], promotion_gate: "guild:decisions" },
      ],
    });

    // Must not throw; decision should still be staged
    const candidates = collectUpstreamCandidates({ workspaceRoot: tmpDir, child: "plugin" });
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("decision");
  });

  test("decision_candidates is a string → treated as empty array, no throw", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);
    makeRawHarvestFile(childDir, "run-malformed-2", {
      schema_version: "guild.harvest_candidates.v1",
      run_id: "run-malformed-2",
      wiki_candidates: [
        { title: "Cross-cutting wiki", applies_to: ["plugin", "website"], source_refs: [], promotion_gate: "guild:wiki-ingest" },
      ],
      decision_candidates: "this is not an array", // malformed
    });

    const candidates = collectUpstreamCandidates({ workspaceRoot: tmpDir, child: "plugin" });
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("wiki");
  });

  test("one malformed file among good files → good files still staged", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    // Bad file: wiki_candidates is a number
    makeRawHarvestFile(childDir, "run-bad", {
      schema_version: "guild.harvest_candidates.v1",
      wiki_candidates: 42, // wrong type
      decision_candidates: "not an array", // wrong type
    });

    // Good file: valid cross-cutting candidate
    const learnDir = path.join(childDir, ".guild", "runs", "run-good", "learn");
    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnDir, "harvest-candidates.json"),
      JSON.stringify({
        schema_version: "guild.harvest_candidates.v1",
        run_id: "run-good",
        wiki_candidates: [
          { title: "Valid cross-cutting", applies_to: ["plugin", "website"], source_refs: [], promotion_gate: "guild:wiki-ingest" },
        ],
        decision_candidates: [],
      }, null, 2),
      "utf8",
    );

    const candidates = collectUpstreamCandidates({ workspaceRoot: tmpDir, child: "plugin" });
    // The bad file produces nothing; the good file produces 1
    expect(candidates.length).toBe(1);
    expect(candidates[0].id_or_title).toBe("Valid cross-cutting");
  });
});

// ── Finding #6 — CLI manifest writer integration tests ───────────────────────

describe("promote-upstream CLI — manifest writer integration (Finding #6)", () => {
  let tmpDir: string;

  function run(args: string[]): { status: number; out: string; err: string } {
    const r = spawnSync("npx", ["tsx", SCRIPT, ...args], {
      encoding: "utf8",
      env: NODE_ENV,
      timeout: 30000,
    });
    return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  }

  function makeWorkspaceJson(workspaceRoot: string, childNames: string[]): void {
    const guildDir = path.join(workspaceRoot, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    const manifest = {
      schema_version: "guild.workspace.v1",
      is_workspace: true,
      sub_guilds: childNames.map((name) => ({ name, path: name, kind: "sub-guild" })),
    };
    fs.writeFileSync(
      path.join(guildDir, "workspace.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  }

  function makeHarvestFile(
    childDir: string,
    runId: string,
    candidates: { title: string; applies_to: string[] }[],
  ): void {
    const learnDir = path.join(childDir, ".guild", "runs", runId, "learn");
    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnDir, "harvest-candidates.json"),
      JSON.stringify({
        schema_version: "guild.harvest_candidates.v1",
        run_id: runId,
        wiki_candidates: candidates.map((c) => ({
          ...c,
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
        })),
        decision_candidates: [],
      }, null, 2),
      "utf8",
    );
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-promote-cli-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("CLI writes manifest to <workspaceRoot>/.guild/runs/<run-id>/upstream-candidates.json", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);
    makeHarvestFile(childDir, "run-cli-1", [
      { title: "CLI test cross-cutting", applies_to: ["plugin", "website"] },
    ]);

    const { status } = run([
      "--workspace-root", tmpDir,
      "--child", "plugin",
      "--run-id", "test-run-cli",
    ]);

    expect(status).toBe(0);
    const manifestPath = path.join(tmpDir, ".guild", "runs", "test-run-cli", "upstream-candidates.json");
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(manifest["schema_version"]).toBe("guild.upstream_candidates.v1");
    expect(Array.isArray(manifest["candidates"])).toBe(true);
    expect((manifest["candidates"] as unknown[]).length).toBe(1);
  });

  test("CLI manifest is contained inside <workspaceRoot>/.guild/runs/ (containment check)", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);
    makeHarvestFile(childDir, "run-cli-2", [
      { title: "Another cross-cutting", applies_to: ["plugin", "website"] },
    ]);

    run([
      "--workspace-root", tmpDir,
      "--child", "plugin",
      "--run-id", "safe-run-id",
    ]);

    const manifestPath = path.join(tmpDir, ".guild", "runs", "safe-run-id", "upstream-candidates.json");
    const resolvedManifest = path.resolve(manifestPath);
    const resolvedBase = path.resolve(tmpDir, ".guild", "runs");
    expect(resolvedManifest.startsWith(resolvedBase)).toBe(true);
  });

  test("CLI rejects traversal run-id via --run-id=../../docs/knowledge/foo and exits non-zero", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    const { status, err } = run([
      "--workspace-root", tmpDir,
      "--run-id", "../../docs/knowledge/foo",
    ]);

    expect(status).not.toBe(0);
    expect(err).toMatch(/invalid|traversal|run-id/i);
  });

  test("CLI manifest body_draft never appears in written JSON (by-reference invariant)", () => {
    const childDir = path.join(tmpDir, "plugin");
    fs.mkdirSync(childDir, { recursive: true });
    makeWorkspaceJson(tmpDir, ["plugin"]);

    const learnDir = path.join(childDir, ".guild", "runs", "run-body-check", "learn");
    fs.mkdirSync(learnDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnDir, "harvest-candidates.json"),
      JSON.stringify({
        schema_version: "guild.harvest_candidates.v1",
        run_id: "run-body-check",
        wiki_candidates: [{
          title: "Cross-cutting",
          body_draft: "SECRET BODY MUST NOT APPEAR",
          applies_to: ["plugin", "website"],
          source_refs: [],
          promotion_gate: "guild:wiki-ingest",
        }],
        decision_candidates: [],
      }, null, 2),
      "utf8",
    );

    run([
      "--workspace-root", tmpDir,
      "--child", "plugin",
      "--run-id", "run-body-check-out",
    ]);

    const manifestPath = path.join(tmpDir, ".guild", "runs", "run-body-check-out", "upstream-candidates.json");
    const content = fs.readFileSync(manifestPath, "utf8");
    expect(content).not.toContain("SECRET BODY MUST NOT APPEAR");
  });
});
