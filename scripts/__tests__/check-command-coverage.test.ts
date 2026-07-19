/**
 * scripts/__tests__/check-command-coverage.test.ts
 *
 * Umbrella-side command-coverage check (complement to check-doc-sync).
 * TDD: written before/with the implementation.
 *
 * Covers:
 *  - isTokenCovered: namespaced token, leading-slash variant, file-ref variant.
 *  - WORD-BOUNDARY false-positive guard (the critical one): `stat` must NOT be covered by
 *    `guild:status`, and `status` must NOT be covered by `guild:stat`.
 *  - evaluateCommandCoverage partition + stable sort.
 *  - collectCommandTokens / gatherKnowledgeText against tmp fixtures.
 *  - CLI exit codes: 0 covered, 1 uncovered, 0 with --warn, 2 bad input.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";

import {
  isTokenCovered,
  evaluateCommandCoverage,
  collectCommandTokens,
  gatherKnowledgeText,
  htmlToText,
} from "../workspace/check-command-coverage";

describe("isTokenCovered — namespaced + file-ref forms", () => {
  test("guild:<token> counts as covered", () => {
    expect(isTokenCovered("build", "the guild:build command does X")).toBe(true);
  });
  test("/guild:<token> (leading slash) counts as covered", () => {
    expect(isTokenCovered("init", "run /guild:init first")).toBe(true);
  });
  test("commands/<token>.md file reference counts as covered", () => {
    expect(isTokenCovered("plan", "see commands/plan.md for details")).toBe(true);
  });
  test("absent token is not covered", () => {
    expect(isTokenCovered("nonexistent", "guild:build and guild:plan only")).toBe(false);
  });
});

describe("isTokenCovered — word-boundary false-positive guard (critical)", () => {
  test("'stat' is NOT covered by 'guild:status'", () => {
    expect(isTokenCovered("stat", "only guild:status appears here")).toBe(false);
  });
  test("'status' is NOT covered by 'guild:stat'", () => {
    expect(isTokenCovered("status", "only guild:stat appears here")).toBe(false);
  });
  test("'stat' IS covered by an exact 'guild:stat'", () => {
    expect(isTokenCovered("stat", "guild:stat exactly")).toBe(true);
  });
  test("'stats' is covered by 'guild:stats' but not by 'guild:status'", () => {
    expect(isTokenCovered("stats", "guild:stats here")).toBe(true);
    expect(isTokenCovered("stats", "only guild:status here")).toBe(false);
  });
});

describe("evaluateCommandCoverage — partition", () => {
  test("partitions covered / uncovered and sorts uncovered", () => {
    const text = "guild:build guild:plan /guild:init commands/qa.md";
    const r = evaluateCommandCoverage(["build", "plan", "init", "qa", " zzz".trim(), "missing"], text);
    expect(r.covered.sort()).toEqual(["build", "init", "plan", "qa"]);
    expect(r.uncovered).toEqual(["missing", "zzz"]); // sorted
  });
  test("empty token list → both empty", () => {
    expect(evaluateCommandCoverage([], "anything")).toEqual({ covered: [], uncovered: [] });
  });
});

describe("collectCommandTokens / gatherKnowledgeText — fixtures", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-cov-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("collectCommandTokens reads <token>.md basenames, sorted, .md only", () => {
    const cmds = path.join(dir, "commands");
    fs.mkdirSync(cmds);
    fs.writeFileSync(path.join(cmds, "build.md"), "x");
    fs.writeFileSync(path.join(cmds, "plan.md"), "x");
    fs.writeFileSync(path.join(cmds, "README.txt"), "ignore me");
    expect(collectCommandTokens(cmds)).toEqual(["build", "plan"]);
  });

  test("gatherKnowledgeText reads .md recursively and concatenates", () => {
    const k = path.join(dir, "knowledge");
    fs.mkdirSync(path.join(k, "architecture"), { recursive: true });
    fs.writeFileSync(path.join(k, "index.md"), "guild:build");
    fs.writeFileSync(path.join(k, "architecture", "surface.md"), "guild:plan");
    const text = gatherKnowledgeText(k);
    expect(text).toContain("guild:build");
    expect(text).toContain("guild:plan");
  });

  // docs/v2 became an all-HTML set; a .md-only walk silently drops it and coverage
  // collapses to wiki-only. These fixtures are REAL files on disk — no injected seam.
  test("gatherKnowledgeText reads .html recursively alongside .md", () => {
    const k = path.join(dir, "knowledge");
    fs.mkdirSync(path.join(k, "docs-v2"), { recursive: true });
    fs.writeFileSync(path.join(k, "index.md"), "guild:build");
    fs.writeFileSync(
      path.join(k, "docs-v2", "lifecycle.html"),
      "<html><body><h2>Verbs</h2><p>Run <code>/guild:migrate</code> to convert.</p></body></html>",
    );
    const text = gatherKnowledgeText(k);
    expect(text).toContain("guild:build");
    expect(text).toContain("/guild:migrate");
    expect(isTokenCovered("migrate", text)).toBe(true);
  });

  test("gatherKnowledgeText tag-strips HTML: a token split by markup does not leak markup", () => {
    const k = path.join(dir, "knowledge");
    fs.mkdirSync(k, { recursive: true });
    fs.writeFileSync(path.join(k, "page.html"), "<p><em>guild:plan</em></p>");
    const text = gatherKnowledgeText(k);
    expect(text).not.toContain("<em>");
    expect(isTokenCovered("plan", text)).toBe(true);
  });

  test("gatherKnowledgeText ignores non-reference extensions", () => {
    const k = path.join(dir, "knowledge");
    fs.mkdirSync(k, { recursive: true });
    fs.writeFileSync(path.join(k, "notes.txt"), "guild:ghost");
    fs.writeFileSync(path.join(k, "page.html"), "guild:plan");
    const text = gatherKnowledgeText(k);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(isTokenCovered("plan", text)).toBe(true);
  });
});

describe("htmlToText — markup must neither hide nor manufacture coverage", () => {
  test("tags become whitespace, prose survives", () => {
    expect(htmlToText("<p>see <code>guild:qa</code> here</p>")).toMatch(/see\s+guild:qa\s+here/);
  });
  test("a token inside an HTML comment does NOT count as coverage", () => {
    const text = htmlToText("<p>nothing</p><!-- TODO document guild:ghost -->");
    expect(isTokenCovered("ghost", text)).toBe(false);
  });
  test("a token inside script/style bodies does NOT count as coverage", () => {
    const text = htmlToText(
      `<script>var x = "guild:ghost";</script><style>/* guild:phantom */</style><p>ok</p>`,
    );
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(isTokenCovered("phantom", text)).toBe(false);
  });
  test("a token that appears only in an attribute does NOT count as coverage", () => {
    const text = htmlToText(`<a href="/docs#guild:ghost" title="guild:ghost">link</a>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
  });
  // ── Adversarial-review regressions (round 1) ────────────────────────────────
  // A regex tag-strip is not an HTML tokenizer. Both inputs below produced a FALSE
  // PASS against the first cut — a command counted as documented when it was not.
  // These fail against a `<[^>]*>` / `<script>…</script>` implementation.
  test("a '>' inside a quoted attribute does NOT end the tag and leak attribute text", () => {
    const text = htmlToText(`<a title=">guild:ghost">visible</a>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("visible");
  });
  test("an UNCLOSED script body is dropped, not leaked", () => {
    const text = htmlToText(`<p>ok</p><script>const x = "guild:ghost";`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
  });
  test("an unclosed style body is dropped, not leaked", () => {
    expect(isTokenCovered("phantom", htmlToText(`<style>/* guild:phantom */`))).toBe(false);
  });
  test("an unterminated tag consumes to EOF rather than leaking its contents", () => {
    expect(isTokenCovered("ghost", htmlToText(`<p>ok</p><a href="x" data-y="guild:ghost`))).toBe(
      false,
    );
  });
  test("an unterminated comment is dropped, not leaked", () => {
    expect(isTokenCovered("ghost", htmlToText(`<p>ok</p><!-- guild:ghost`))).toBe(false);
  });
  test("a token inside CDATA does not count", () => {
    expect(isTokenCovered("ghost", htmlToText(`<p>ok</p><![CDATA[ guild:ghost ]]>`))).toBe(false);
  });
  // Round-2 self-audit: allowing whitespace after `<` / `</` leaked in BOTH directions.
  test("a '</ script>' pseudo-close does NOT end the raw-text run early", () => {
    // A browser is still inside the script here, so nothing after it is prose.
    expect(isTokenCovered("ghost", htmlToText(`<script>a</ script>guild:ghost`))).toBe(false);
  });
  test("legal '<script >' / '</script >' (space AFTER the name) is still handled", () => {
    const text = htmlToText(`<script >var x = "guild:ghost";</script >ok`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
  });
  test("a '</script>' inside a JS string still terminates the script, per HTML", () => {
    expect(isTokenCovered("ghost", htmlToText(`<script>var s="guild:ghost</script>";`))).toBe(
      false,
    );
  });

  test("real prose still survives all of the above (no over-stripping)", () => {
    const text = htmlToText(
      `<!doctype html><html><body><h1 class="t">Verbs</h1>` +
        `<p>Run <code>/guild:migrate</code> — see <a href="#x" title="a>b">here</a>.</p>` +
        `</body></html>`,
    );
    expect(isTokenCovered("migrate", text)).toBe(true);
    expect(text).toContain("Verbs");
    expect(text).toContain("here");
  });

  test("entities are decoded in one pass, with no ordering hazard", () => {
    expect(htmlToText("<p>&lt;guild:plan&gt;</p>")).toContain("<guild:plan>");
    expect(htmlToText("<p>a&nbsp;b</p>")).toMatch(/a\s+b/);
    // Both directions of the chained-replace ordering trap:
    expect(htmlToText("<p>&amp;lt;</p>")).toContain("&lt;"); // must NOT become '<'
    expect(htmlToText("<p>&amp;#58;</p>")).toContain("&#58;"); // must NOT become ':'
  });
  test("numeric entities are decoded, so an encoded colon still counts as coverage", () => {
    expect(isTokenCovered("migrate", htmlToText("<p>guild&#58;migrate</p>"))).toBe(true);
    expect(isTokenCovered("migrate", htmlToText("<p>guild&#x3A;migrate</p>"))).toBe(true);
  });
  test("an unknown entity is left verbatim rather than guessed", () => {
    expect(htmlToText("<p>&bogus;</p>")).toContain("&bogus;");
  });
});

describe("CLI — exit codes", () => {
  const SCRIPT = path.resolve(__dirname, "../workspace/check-command-coverage.ts");
  const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;
  let dir: string;

  function setup(
    commands: string[],
    knowledge: string,
    opts: { knowledgeFile?: string } = {},
  ): { cmds: string; know: string } {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-cmd-cov-cli-"));
    const cmds = path.join(dir, "commands");
    const know = path.join(dir, "knowledge");
    fs.mkdirSync(cmds);
    fs.mkdirSync(know);
    for (const c of commands) fs.writeFileSync(path.join(cmds, `${c}.md`), `# ${c}\n`);
    fs.writeFileSync(path.join(know, opts.knowledgeFile ?? "index.md"), knowledge);
    return { cmds, know };
  }

  function run(args: string[]): { status: number; out: string; err: string } {
    const { spawnSync } = require("child_process") as typeof import("child_process");
    const r = spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", env: ENV, timeout: 120_000 });
    return { status: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  }

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test("all covered → exit 0", () => {
    const { cmds, know } = setup(["build", "plan"], "guild:build and guild:plan");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/all 2 commands covered/);
  });

  test("uncovered command → exit 1 (real gate)", () => {
    const { cmds, know } = setup(["build", "ghost"], "guild:build only");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/guild:ghost/);
  });

  test("uncovered command with --warn → exit 0 (advisory)", () => {
    const { cmds, know } = setup(["build", "ghost"], "guild:build only");
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know, "--warn"]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/guild:ghost/);
  });

  test("all-HTML knowledge dir (post docs/v2 conversion) → exit 0", () => {
    const { cmds, know } = setup(
      ["build", "migrate"],
      "<html><body><p>Run <code>/guild:build</code> then <code>guild:migrate</code>.</p></body></html>",
      { knowledgeFile: "lifecycle.html" },
    );
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/all 2 commands covered/);
  });

  test("HTML knowledge dir missing a command → exit 1 (gate still bites)", () => {
    const { cmds, know } = setup(
      ["build", "ghost"],
      "<html><body><p><code>/guild:build</code> only</p></body></html>",
      { knowledgeFile: "lifecycle.html" },
    );
    const r = run(["--commands-dir", cmds, "--knowledge-dir", know]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/guild:ghost/);
  });

  test("missing args → exit 2", () => {
    const r = run([]);
    expect(r.status).toBe(2);
  });

  test("nonexistent dir → exit 2", () => {
    const r = run(["--commands-dir", "/no/such/dir", "--knowledge-dir", "/also/missing"]);
    expect(r.status).toBe(2);
  });
});
