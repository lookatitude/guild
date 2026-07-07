/**
 * scripts/__tests__/check-roster-consistency.test.ts
 *
 * TDD for check-roster-consistency.ts
 *
 * Covers:
 *  - parseRosterTierMap: extracts all rows from a well-formed table
 *  - parseAgentFrontmatter: extracts name + model from YAML front matter
 *  - compareRosterToAgents: detects MODEL_MISMATCH, MISSING_FILE, NOT_IN_ROSTER
 *  - CLI (spawnSync): consistent → exit 0; planted drift → exit 1 + right message
 *  - CLI: missing roster file → exit 1
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  parseRosterTierMap,
  parseAgentFrontmatter,
  compareRosterToAgents,
} from "../check-roster-consistency";

const SCRIPT = path.resolve(__dirname, "../check-roster-consistency.ts");

// ── Helpers ────────────────────────────────────────────────────────────────

function runScript(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Build a minimal but realistic specialist-roster.md that contains a
 * "Complete default-tier map" table section.
 *
 * Also includes a preceding 5-column tiered-worker roster table (similar to
 * the real file) so the parser's section-scoping is exercised in tests.
 */
function buildRosterMd(rows: { role: string; group: string; tier: string; model: string }[]): string {
  const tableRows = rows
    .map(r => `| \`${r.role}\` | ${r.group} | \`${r.tier}\` | \`${r.model}\` |`)
    .join("\n");
  return `# Specialist Roster

Some preamble text.

## Tiered-worker roster

This table has a different shape and must NOT be parsed.

| Role | Default tier | \`model:\` | Placement | One-line scope |
|---|---|---|---|---|
| \`researcher (per-topic)\` | \`cheap\`→\`mid\` | \`sonnet\` | **retiered** | Gather sources. |
| \`advisor\` | \`powerful\` | \`opus\` | **NEW** | Escalation only. |

### Complete default-tier map (all ${rows.length} dispatchable roles)

| Role | Group | Default tier | \`model:\` |
|---|---|---|---|
${tableRows}

Notes following the table.
`;
}

/** Build a minimal agents/<name>.md frontmatter. */
function buildAgentMd(name: string, model: string): string {
  return `---
name: ${name}
description: "A test specialist."
model: ${model}
tools: Read, Write
skills:
  - guild-principles
---

# ${name}

Body text.
`;
}

/** Create a synthetic plugin root with roster + agent files. */
function seedPluginRoot(
  tmpDir: string,
  rosterContent: string,
  agents: { name: string; model: string }[]
): void {
  const docsDir = path.join(tmpDir, "docs");
  const agentsDir = path.join(tmpDir, "agents");
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(agentsDir, { recursive: true });

  fs.writeFileSync(path.join(docsDir, "specialist-roster.md"), rosterContent, "utf8");

  for (const { name, model } of agents) {
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), buildAgentMd(name, model), "utf8");
  }
}

// ── Unit tests: parseRosterTierMap ─────────────────────────────────────────

describe("parseRosterTierMap", () => {
  it("parses a single-row tier map", () => {
    const md = buildRosterMd([{ role: "architect", group: "engineering", tier: "powerful", model: "opus" }]);
    const map = parseRosterTierMap(md);
    expect(map.size).toBe(1);
    expect(map.get("architect")).toEqual({ role: "architect", model: "opus" });
  });

  it("parses all rows in a multi-row table", () => {
    const rows = [
      { role: "architect", group: "engineering", tier: "powerful", model: "opus" },
      { role: "backend",   group: "engineering", tier: "mid",      model: "sonnet" },
      { role: "security",  group: "engineering", tier: "powerful", model: "opus" },
    ];
    const map = parseRosterTierMap(buildRosterMd(rows));
    expect(map.size).toBe(3);
    expect(map.get("backend")).toEqual({ role: "backend", model: "sonnet" });
    expect(map.get("security")).toEqual({ role: "security", model: "opus" });
  });

  it("stops reading at blank line after table", () => {
    const md = buildRosterMd([
      { role: "architect", group: "eng", tier: "powerful", model: "opus" },
      { role: "backend",   group: "eng", tier: "mid",      model: "sonnet" },
    ]);
    const map = parseRosterTierMap(md);
    // Should only have the two rows, not accidentally parse prose
    expect(map.size).toBe(2);
  });

  it("returns an empty map when no tier table is present", () => {
    const map = parseRosterTierMap("# No table here\n\nJust prose.\n");
    expect(map.size).toBe(0);
  });

  it("strips backticks from role and model values", () => {
    const md = buildRosterMd([{ role: "doc-writer", group: "content", tier: "cheap→mid", model: "sonnet" }]);
    const map = parseRosterTierMap(md);
    const entry = map.get("doc-writer");
    expect(entry?.role).toBe("doc-writer");
    expect(entry?.model).toBe("sonnet");
  });
});

// ── Unit tests: parseAgentFrontmatter ──────────────────────────────────────

describe("parseAgentFrontmatter", () => {
  it("extracts name and model from valid frontmatter", () => {
    const md = buildAgentMd("architect", "opus");
    const fm = parseAgentFrontmatter(md, "architect.md");
    expect(fm).not.toBeNull();
    expect(fm!.name).toBe("architect");
    expect(fm!.model).toBe("opus");
  });

  it("falls back to filename stem when frontmatter has no name:", () => {
    const md = `---\nmodel: sonnet\ntools: Read\n---\n\n# backend\n`;
    const fm = parseAgentFrontmatter(md, "backend.md");
    expect(fm!.name).toBe("backend");
    expect(fm!.model).toBe("sonnet");
  });

  it("returns null when there is no frontmatter", () => {
    const fm = parseAgentFrontmatter("# Just a heading\n\nNo front matter.", "nofm.md");
    expect(fm).toBeNull();
  });

  it("returns null when frontmatter has no model:", () => {
    const md = `---\nname: quirk\ntools: Read\n---\n\n# quirk\n`;
    const fm = parseAgentFrontmatter(md, "quirk.md");
    expect(fm).toBeNull();
  });
});

// ── Unit tests: compareRosterToAgents ──────────────────────────────────────

describe("compareRosterToAgents", () => {
  const rosterMap = new Map([
    ["architect", { role: "architect", model: "opus" }],
    ["backend",   { role: "backend",   model: "sonnet" }],
  ]);

  it("returns no issues when roster matches agents exactly", () => {
    const agentMap = new Map([
      ["architect", { name: "architect", model: "opus" }],
      ["backend",   { name: "backend",   model: "sonnet" }],
    ]);
    const issues = compareRosterToAgents(rosterMap, agentMap);
    expect(issues).toHaveLength(0);
  });

  it("reports MODEL_MISMATCH when agent file has wrong model", () => {
    const agentMap = new Map([
      ["architect", { name: "architect", model: "sonnet" }], // ← wrong (should be opus)
      ["backend",   { name: "backend",   model: "sonnet" }],
    ]);
    const issues = compareRosterToAgents(rosterMap, agentMap);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("MODEL_MISMATCH");
    expect(issues[0].message).toMatch(/architect/);
    expect(issues[0].message).toMatch(/opus/);
    expect(issues[0].message).toMatch(/sonnet/);
  });

  it("reports MISSING_FILE when an agent file is absent", () => {
    const agentMap = new Map([
      ["backend", { name: "backend", model: "sonnet" }],
      // architect file is missing
    ]);
    const issues = compareRosterToAgents(rosterMap, agentMap);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("MISSING_FILE");
    expect(issues[0].message).toMatch(/architect/);
  });

  it("reports NOT_IN_ROSTER when an agent file has no roster row", () => {
    const agentMap = new Map([
      ["architect", { name: "architect", model: "opus" }],
      ["backend",   { name: "backend",   model: "sonnet" }],
      ["phantom",   { name: "phantom",   model: "sonnet" }], // ← no roster row
    ]);
    const issues = compareRosterToAgents(rosterMap, agentMap);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("NOT_IN_ROSTER");
    expect(issues[0].message).toMatch(/phantom/);
  });

  it("reports multiple issues simultaneously", () => {
    const agentMap = new Map([
      ["architect", { name: "architect", model: "haiku" }],  // MODEL_MISMATCH
      // backend missing (MISSING_FILE)
      ["ghost",     { name: "ghost",     model: "sonnet" }], // NOT_IN_ROSTER
    ]);
    const issues = compareRosterToAgents(rosterMap, agentMap);
    const kinds = issues.map(i => i.kind).sort();
    expect(kinds).toContain("MODEL_MISMATCH");
    expect(kinds).toContain("MISSING_FILE");
    expect(kinds).toContain("NOT_IN_ROSTER");
  });
});

// ── CLI integration tests ──────────────────────────────────────────────────

describe("CLI: check-roster-consistency.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-roster-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("consistent fixture", () => {
    it("exits 0 when roster and agents match", () => {
      const rows = [
        { role: "architect", group: "engineering", tier: "powerful", model: "opus" },
        { role: "backend",   group: "engineering", tier: "mid",      model: "sonnet" },
      ];
      seedPluginRoot(tmpDir, buildRosterMd(rows), [
        { name: "architect", model: "opus" },
        { name: "backend",   model: "sonnet" },
      ]);
      const { exitCode, stdout } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/consistent/i);
    });
  });

  describe("planted drift: MODEL_MISMATCH", () => {
    it("exits 1 and reports MODEL_MISMATCH", () => {
      const rows = [
        { role: "architect", group: "engineering", tier: "powerful", model: "opus" },
        { role: "backend",   group: "engineering", tier: "mid",      model: "sonnet" },
      ];
      seedPluginRoot(tmpDir, buildRosterMd(rows), [
        { name: "architect", model: "sonnet" }, // ← wrong — roster says opus
        { name: "backend",   model: "sonnet" },
      ]);
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/MODEL_MISMATCH/);
      expect(stderr).toMatch(/architect/);
      expect(stderr).toMatch(/opus/);
    });
  });

  describe("planted drift: MISSING_FILE", () => {
    it("exits 1 and reports MISSING_FILE", () => {
      const rows = [
        { role: "architect", group: "engineering", tier: "powerful", model: "opus" },
        { role: "backend",   group: "engineering", tier: "mid",      model: "sonnet" },
      ];
      // Only seed backend; architect.md is absent
      seedPluginRoot(tmpDir, buildRosterMd(rows), [
        { name: "backend", model: "sonnet" },
      ]);
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/MISSING_FILE/);
      expect(stderr).toMatch(/architect/);
    });
  });

  describe("planted drift: NOT_IN_ROSTER", () => {
    it("exits 1 and reports NOT_IN_ROSTER", () => {
      const rows = [
        { role: "backend", group: "engineering", tier: "mid", model: "sonnet" },
      ];
      // Seed backend + a phantom agent that has no roster row
      seedPluginRoot(tmpDir, buildRosterMd(rows), [
        { name: "backend", model: "sonnet" },
        { name: "phantom", model: "sonnet" },
      ]);
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/NOT_IN_ROSTER/);
      expect(stderr).toMatch(/phantom/);
    });
  });

  describe("input errors", () => {
    it("exits 1 when --cwd has no docs/specialist-roster.md", () => {
      // tmpDir has no docs/ folder at all
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/roster file not found|ERROR/i);
    });

    it("exits 1 when --cwd has no agents/ directory", () => {
      // Create docs/specialist-roster.md but no agents/
      const rows = [{ role: "backend", group: "eng", tier: "mid", model: "sonnet" }];
      fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "docs", "specialist-roster.md"),
        buildRosterMd(rows),
        "utf8"
      );
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/agents directory not found|ERROR/i);
    });
  });

  describe("against live plugin root", () => {
    it("is consistent on the current codebase (exit 0)", () => {
      // Smoke-test: run against the real plugin/ directory
      const pluginRoot = path.resolve(__dirname, "../..");
      const { exitCode, stdout, stderr } = runScript(["--cwd", pluginRoot]);
      if (exitCode !== 0) {
        // Surface any drift as a helpful failure message
        throw new Error(
          `check-roster-consistency found drift in live codebase:\n${stderr}`
        );
      }
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/consistent/i);
    });
  });
});
