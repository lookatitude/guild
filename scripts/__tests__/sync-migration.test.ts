/**
 * scripts/__tests__/sync-migration.test.ts
 *
 * TDD for sync-migration.ts — F7 MIGRATION.md single-source generator.
 *
 * Verifies:
 *  - plugin/ full copy: banner injected, blockquote injected, fence markers
 *    stripped, links rewritten (architecture/ lifecycle/ decisions/), body
 *    content preserved, source_refs overridden.
 *  - root stub: pointer structure, digest extracted (no fence markers), digest
 *    links root-rewritten, canonical body NOT copied verbatim.
 *  - --check mode: in-sync → exit 0; stale → exit 1.
 *  - Missing canonical → exit 1 with message.
 *  - Missing STUB-DIGEST fences → exit 1 with message.
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../sync-migration.ts");
const FIXTURES = path.resolve(__dirname, "../fixtures");
const CANONICAL_FIXTURE = path.join(FIXTURES, "migration-canonical.md");

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

/** Seed a minimal repo layout in tmpDir: docs/knowledge/MIGRATION.md + target dirs. */
function seedRepo(tmpDir: string, canonicalFixture = CANONICAL_FIXTURE): void {
  const knowledgeDir = path.join(tmpDir, "docs", "knowledge");
  const pluginDir = path.join(tmpDir, "plugin");
  fs.mkdirSync(knowledgeDir, { recursive: true });
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.copyFileSync(canonicalFixture, path.join(knowledgeDir, "MIGRATION.md"));
}

describe("sync-migration.ts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sync-migration-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Write-mode: plugin/ full copy ──────────────────────────────────────────

  describe("plugin/ full copy (write mode)", () => {
    it("exits 0", () => {
      seedRepo(tmpDir);
      const { exitCode } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("creates plugin/MIGRATION.md", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      expect(fs.existsSync(path.join(tmpDir, "plugin", "MIGRATION.md"))).toBe(true);
    });

    it("injects HTML banner comment", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain("<!-- GENERATED FILE — DO NOT EDIT BY HAND.");
      // Banner must use the umbrella-repo-root path, not the script-relative one.
      expect(content).toContain("npx tsx plugin/scripts/sync-migration.ts");
    });

    it("injects blockquote after banner", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain("> **Generated copy — do not edit by hand.**");
    });

    it("rewrites architecture/ links for plugin/ location", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      // Original: ](architecture/command-surface.md)
      // Expected: ](../docs/knowledge/architecture/command-surface.md)
      expect(content).toContain("](../docs/knowledge/architecture/command-surface.md)");
      expect(content).not.toMatch(/\]\(architecture\//);
    });

    it("rewrites lifecycle/ links for plugin/ location", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain("](../docs/knowledge/lifecycle/phase-entrypoints.md)");
      expect(content).not.toMatch(/\]\(lifecycle\//);
    });

    it("rewrites decisions/ links for plugin/ location", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain("](../docs/knowledge/decisions/");
      expect(content).not.toMatch(/\]\(decisions\//);
    });

    it("strips STUB-DIGEST:START fence marker", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).not.toContain("<!-- STUB-DIGEST:START -->");
    });

    it("strips STUB-DIGEST:END fence marker", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).not.toContain("<!-- STUB-DIGEST:END -->");
    });

    it("preserves digest content (between fence markers) in plugin/ body", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      // The digest content should appear (link-rewritten) in the plugin/ body
      expect(content).toContain("Commands keep the `:` namespace");
    });

    it("overrides source_refs in front-matter", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain('source_refs: ["docs/knowledge/MIGRATION.md"]');
      // Must not carry the original value
      expect(content).not.toContain("plugin/guild-plan.md §13.1");
    });

    it("preserves other front-matter fields verbatim", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      expect(content).toContain("type: concept");
      expect(content).toContain("owner: architect");
    });

    it("preserves body content beyond the digest", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "plugin", "MIGRATION.md"), "utf8");
      // "Full details" section is after the digest fences
      expect(content).toContain("## Full details");
    });
  });

  // ── Write-mode: root stub ─────────────────────────────────────────────────

  describe("root stub (write mode)", () => {
    it("creates MIGRATION.md at repo root", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      expect(fs.existsSync(path.join(tmpDir, "MIGRATION.md"))).toBe(true);
    });

    it("contains pointer header", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("# Guild v1 → v2 Migration");
      expect(content).toMatch(/pointer/i);
    });

    it("contains a reference to the canonical docs/knowledge/MIGRATION.md", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("docs/knowledge/MIGRATION.md");
    });

    it("contains the digest lines (extracted from canonical)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      // Digest contains "Commands keep the `:` namespace"
      expect(content).toContain("Commands keep the `:` namespace");
      // Digest contains phase subcommands line
      expect(content).toContain("Phase subcommands");
    });

    it("root-rewrites lifecycle/ links in digest", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      // Original digest link: ](lifecycle/phase-entrypoints.md)
      // Root-rewritten: ](docs/knowledge/lifecycle/phase-entrypoints.md)
      expect(content).toContain("](docs/knowledge/lifecycle/phase-entrypoints.md)");
      expect(content).not.toMatch(/\]\(lifecycle\//);
    });

    it("root-rewrites decisions/ links in digest", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("](docs/knowledge/decisions/v2x-command-surface.md)");
      expect(content).not.toMatch(/\]\(decisions\//);
    });

    it("does NOT contain fence-marker lines", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).not.toContain("<!-- STUB-DIGEST:START -->");
      expect(content).not.toContain("<!-- STUB-DIGEST:END -->");
    });

    it("does NOT contain the full canonical body sections beyond the digest", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      // "## Full details" is a body section that appears AFTER the digest in canonical
      // The root stub should NOT include it (it only extracts the digest)
      expect(content).not.toContain("## Full details");
    });

    it("has source_refs pointing to canonical in front-matter", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain('source_refs: ["docs/knowledge/MIGRATION.md"]');
    });

    it("has generated-file banner comment", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("<!-- GENERATED FILE — DO NOT EDIT BY HAND.");
    });

    // ── Golden spec precision (must match docs-writer's golden template) ───

    it("banner says 'Repo-root pointer stub' (golden format)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("Repo-root pointer stub.");
    });

    it("banner uses umbrella-repo-root path (plugin/scripts/sync-migration.ts)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("npx tsx plugin/scripts/sync-migration.ts");
      // Must NOT use the scripts-relative path (unrunnable from repo root)
      expect(content).not.toContain("npx tsx scripts/sync-migration.ts");
    });

    it("section heading matches golden (long form with parenthetical)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain(
        "## The 30-second version (read the canonical guide for the full mapping)"
      );
    });

    it("pointer blockquote matches golden wording (multi-line)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("> **This is a pointer.** The canonical, maintained v1 → v2 migration guide");
      expect(content).toContain("> lives at **[`docs/knowledge/MIGRATION.md`](docs/knowledge/MIGRATION.md)**");
      expect(content).toContain("> generated pointer stub — do not edit it by hand.");
    });

    it("carries canonical front-matter fields (type, owner, confidence)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain("type: concept");
      expect(content).toContain("owner: architect");
      expect(content).toContain("confidence: high");
    });

    it("overrides supersedes to null in root stub front-matter", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toMatch(/^supersedes: null$/m);
    });

    it("trailing text matches golden (full-sentence, link to canonical)", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const content = fs.readFileSync(path.join(tmpDir, "MIGRATION.md"), "utf8");
      expect(content).toContain(
        "**[`docs/knowledge/MIGRATION.md`](docs/knowledge/MIGRATION.md)**."
      );
      // Must reference the full mapping / worked examples in the trailing text
      expect(content).toMatch(/removed\/renamed-command|full mapping|cheat-sheet/i);
    });
  });

  // ── Check mode ────────────────────────────────────────────────────────────

  describe("--check mode", () => {
    it("exits 0 when both targets are in-sync with canonical", () => {
      seedRepo(tmpDir);
      // Write first to populate targets
      runScript(["--cwd", tmpDir]);
      // Now check: should be in-sync
      const { exitCode } = runScript(["--check", "--cwd", tmpDir]);
      expect(exitCode).toBe(0);
    });

    it("exits 1 when plugin/MIGRATION.md is stale", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      // Mutate the plugin target to make it stale
      const pluginPath = path.join(tmpDir, "plugin", "MIGRATION.md");
      fs.appendFileSync(pluginPath, "\n<!-- stale line appended for test -->\n", "utf8");
      const { exitCode } = runScript(["--check", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
    });

    it("exits 1 when root MIGRATION.md is stale", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      // Mutate the root target
      const rootPath = path.join(tmpDir, "MIGRATION.md");
      fs.appendFileSync(rootPath, "\n<!-- stale line appended for test -->\n", "utf8");
      const { exitCode } = runScript(["--check", "--cwd", tmpDir]);
      expect(exitCode).toBe(1);
    });

    it("reports which files are stale on stderr", () => {
      seedRepo(tmpDir);
      runScript(["--cwd", tmpDir]);
      const pluginPath = path.join(tmpDir, "plugin", "MIGRATION.md");
      fs.appendFileSync(pluginPath, "\n<!-- stale -->\n", "utf8");
      const { stderr } = runScript(["--check", "--cwd", tmpDir]);
      expect(stderr).toMatch(/stale|mismatch|out.of.sync/i);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe("error cases", () => {
    it("exits 1 when canonical does not exist", () => {
      // No canonical seeded
      fs.mkdirSync(path.join(tmpDir, "plugin"), { recursive: true });
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/canonical|MIGRATION|not found/i);
    });

    it("exits 1 when canonical has no STUB-DIGEST fences", () => {
      // Seed a canonical without fence markers
      const knowledgeDir = path.join(tmpDir, "docs", "knowledge");
      fs.mkdirSync(knowledgeDir, { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(knowledgeDir, "MIGRATION.md"),
        "---\nsource_refs: [\"x\"]\n---\n\n# Migration\n\nNo fence markers here.\n",
        "utf8"
      );
      const { exitCode, stderr } = runScript(["--cwd", tmpDir]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/STUB-DIGEST|fence|marker/i);
    });
  });
});
