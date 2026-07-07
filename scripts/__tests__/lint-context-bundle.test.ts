/**
 * __tests__/lint-context-bundle.test.ts
 *
 * G-8 / SC-4 — deterministic context-bundle budget linter.
 *
 * Fixtures are REAL-SHAPE: bundles mirror what guild:context-assemble actually
 * writes (skills/meta/context-assemble/SKILL.md §"Output path") — frontmatter
 * naming run-id / specialist / task-id / spec / plan / source paths +
 * token_estimate, then the three layers (Universal, Role-dependent,
 * Task-dependent) with the knowledge-graph recall sub-section inside the
 * task-dependent layer.
 *
 * Includes CLI end-to-end tests via `npx tsx` subprocess (mirrors
 * mark-lane-dead.test.ts) so the REAL path — file read, exit codes, stdout
 * JSON — is exercised, not just the exported helpers.
 */

import { spawnSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  BUNDLE_TOKEN_CAP,
  GRAPH_SECTION_TOKEN_CAP,
  estimateTokens,
  extractGraphSections,
  hasDroppedForBudgetLine,
  lintBundle,
  readFrontmatterTokenEstimate,
} from "../lint-context-bundle";

const CLI = path.resolve(__dirname, "..", "lint-context-bundle.ts");

// ---------------------------------------------------------------------------
// Real-shape bundle fixture builder
// ---------------------------------------------------------------------------

function makeBundle(opts: {
  tokenEstimate?: number;
  graphChars?: number;
  fillerChars?: number;
  droppedForBudget?: boolean;
}): string {
  const fm = [
    "---",
    "run_id: run-85d27757-f47b-4ccd-adaf-f91c749a4e8f",
    "specialist: tooling-engineer",
    "task_id: P1-enforcement",
    "spec: .guild/spec/v2-gap-closure.md",
    "plan: .guild/plan/v2-gap-closure.md",
    "source_paths:",
    "  - .guild/wiki/context/project-overview.md",
    "  - .guild/wiki/standards/coding-standards.md",
    ...(opts.tokenEstimate !== undefined
      ? [`token_estimate: ${opts.tokenEstimate}`]
      : []),
    "---",
    "",
  ].join("\n");

  const universal = [
    "## Universal",
    "",
    "Guild principles: evidence over claims; bind by pointer; lowest viable tier.",
    "Project overview: Guild is a Claude Code plugin shipping 14 specialists.",
    "",
  ].join("\n");

  const role = [
    "## Role-dependent",
    "",
    "Coding standards: TypeScript strict, tsx-run scripts, no new deps.",
    "",
  ].join("\n");

  const graphBody =
    opts.graphChars !== undefined && opts.graphChars > 0
      ? "node: scripts/score-tier.ts —imports→ lib/settings-resolver.ts\n".repeat(
          Math.ceil(opts.graphChars / 60)
        )
      : "";

  const task = [
    "## Task-dependent",
    "",
    "### Lane block (verbatim)",
    "",
    "task-id: P1-enforcement · owner: tooling-engineer · depends-on: []",
    "",
    ...(graphBody
      ? ["### Knowledge graph (recall)", "", graphBody, ""]
      : []),
    ...(opts.droppedForBudget
      ? ["dropped_for_budget: 14 graph nodes below rank 0.3 (sub-cap)", ""]
      : []),
    ...(opts.fillerChars
      ? ["### Named refs", "", "ref content ".repeat(Math.ceil(opts.fillerChars / 12)), ""]
      : []),
  ].join("\n");

  return fm + universal + role + task;
}

function writeTempBundle(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lcb-test-"));
  const p = path.join(dir, "tooling-engineer-P1-enforcement.md");
  fs.writeFileSync(p, content);
  return p;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("estimateTokens", () => {
  it("is ceil(chars/4)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("readFrontmatterTokenEstimate", () => {
  it("reads token_estimate from real-shape frontmatter", () => {
    expect(readFrontmatterTokenEstimate(makeBundle({ tokenEstimate: 2900 }))).toBe(2900);
  });

  it("returns null when the key is absent", () => {
    expect(readFrontmatterTokenEstimate(makeBundle({}))).toBeNull();
  });

  it("returns null when there is no frontmatter at all", () => {
    expect(readFrontmatterTokenEstimate("## Universal\nno frontmatter here\n")).toBeNull();
  });

  it("does not read token_estimate from the body", () => {
    const content = makeBundle({}) + "\ntoken_estimate: 99999\n";
    expect(readFrontmatterTokenEstimate(content)).toBeNull();
  });
});

describe("extractGraphSections", () => {
  it("extracts the knowledge-graph section body, bounded by the next heading", () => {
    const bundle = makeBundle({ graphChars: 600, fillerChars: 200 });
    const sections = extractGraphSections(bundle);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toContain("node: scripts/score-tier.ts");
    expect(sections[0]).not.toContain("ref content");
  });

  it("matches heading variants (Knowledge Graph / knowledge-graph / KnowledgeGraph)", () => {
    for (const h of ["## Knowledge Graph", "## knowledge-graph hits", "## KnowledgeGraph"]) {
      const sections = extractGraphSections(`${h}\nnode a\n\n## Next\nother\n`);
      expect(sections).toHaveLength(1);
      expect(sections[0]).toContain("node a");
    }
  });

  it("returns [] when no graph section exists", () => {
    expect(extractGraphSections(makeBundle({}))).toEqual([]);
  });
});

describe("hasDroppedForBudgetLine", () => {
  it("detects the record line", () => {
    expect(hasDroppedForBudgetLine(makeBundle({ droppedForBudget: true }))).toBe(true);
    expect(hasDroppedForBudgetLine(makeBundle({}))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lintBundle — the verdict
// ---------------------------------------------------------------------------

describe("lintBundle", () => {
  it("passes a typical ~3k-target bundle", () => {
    const v = lintBundle(makeBundle({ tokenEstimate: 2900, graphChars: 1000 }));
    expect(v.pass).toBe(true);
    expect(v.est_tokens).toBeLessThanOrEqual(BUNDLE_TOKEN_CAP);
    expect(v.frontmatter_token_estimate).toBe(2900);
    expect(v.reasons).toEqual([]);
  });

  it("FAILs a bundle whose estimate exceeds the 6k hard cap", () => {
    // > 6000 tokens ⇒ > 24000 chars of filler.
    const v = lintBundle(makeBundle({ fillerChars: 26000 }));
    expect(v.pass).toBe(false);
    expect(v.est_tokens).toBeGreaterThan(BUNDLE_TOKEN_CAP);
    expect(v.reasons.join(" ")).toContain("hard cap");
  });

  it("FAILs an over-sub-cap graph section with no dropped_for_budget: line", () => {
    // > 1200 graph tokens ⇒ > 4800 chars in the graph section.
    const v = lintBundle(makeBundle({ graphChars: 6000 }));
    expect(v.pass).toBe(false);
    expect(v.graph_est_tokens).toBeGreaterThan(GRAPH_SECTION_TOKEN_CAP);
    expect(v.has_dropped_for_budget).toBe(false);
    expect(v.reasons.join(" ")).toContain("dropped_for_budget");
  });

  it("passes an over-sub-cap graph section WHEN the drop is recorded", () => {
    const v = lintBundle(makeBundle({ graphChars: 6000, droppedForBudget: true }));
    expect(v.pass).toBe(true);
    expect(v.graph_est_tokens).toBeGreaterThan(GRAPH_SECTION_TOKEN_CAP);
    expect(v.has_dropped_for_budget).toBe(true);
  });

  it("reports both estimates when frontmatter carries token_estimate", () => {
    const v = lintBundle(makeBundle({ tokenEstimate: 3100, graphChars: 400 }));
    expect(v.frontmatter_token_estimate).toBe(3100);
    expect(typeof v.est_tokens).toBe("number");
  });

  it("a stale over-cap frontmatter estimate is surfaced but does not FAIL", () => {
    const v = lintBundle(makeBundle({ tokenEstimate: 9000 }));
    expect(v.pass).toBe(true);
    expect(v.reasons.join(" ")).toContain("frontmatter");
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end (real path: npx tsx subprocess on a temp file)
// ---------------------------------------------------------------------------

describe("lint-context-bundle CLI (end-to-end)", () => {
  it("exits 0 with a passing verdict for an in-budget bundle", () => {
    const p = writeTempBundle(makeBundle({ tokenEstimate: 2900, graphChars: 800 }));
    const r = runCli(["--bundle", p]);
    expect(r.status).toBe(0);
    const v = JSON.parse(r.stdout);
    expect(v.pass).toBe(true);
    expect(v.frontmatter_token_estimate).toBe(2900);
  });

  it("exits 2 for an over-cap bundle", () => {
    const p = writeTempBundle(makeBundle({ fillerChars: 26000 }));
    const r = runCli(["--bundle", p]);
    expect(r.status).toBe(2);
    const v = JSON.parse(r.stdout);
    expect(v.pass).toBe(false);
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("exits 2 for an unrecorded over-sub-cap graph section", () => {
    const p = writeTempBundle(makeBundle({ graphChars: 6000 }));
    const r = runCli(["--bundle", p]);
    expect(r.status).toBe(2);
    const v = JSON.parse(r.stdout);
    expect(v.has_dropped_for_budget).toBe(false);
  });

  it("exits 1 on a missing --bundle flag (usage error)", () => {
    const r = runCli([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
  });

  it("exits 1 on an unreadable bundle path", () => {
    const r = runCli(["--bundle", "/no/such/bundle.md"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot read bundle");
  });
});
