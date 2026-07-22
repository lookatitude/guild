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
  // `\b` treats `-` as a boundary, so a HYPHEN-SUFFIXED skill token satisfied a shorter
  // command token — `guild:learn-map` covered `learn`, and an undocumented `/guild:learn`
  // passed the gate silently. Command tokens are [a-z0-9-], so the boundary must exclude
  // `-` as well.
  test("'learn' is NOT covered by the hyphen-suffixed skill token 'guild:learn-map'", () => {
    expect(isTokenCovered("learn", "see guild:learn-map for the cheap scan")).toBe(false);
    expect(isTokenCovered("learn", "run /guild:learn-graph")).toBe(false);
    expect(isTokenCovered("learn", "run /guild:learn to do it all")).toBe(true);
  });
  test("the hyphen boundary applies to the commands/<token>.md form too", () => {
    // The suffix must come AFTER `.md` to be a real test: `commands/learn-map.md` was
    // already rejected by `commands/learn\.md\b` (the `-map` precedes the `.md`), so it
    // proves nothing. `commands/learn.md-map` is what `\b` accepted and the new boundary
    // rejects — measured against both.
    expect(isTokenCovered("learn", "see commands/learn.md-map")).toBe(false);
    expect(isTokenCovered("learn", "see commands/learn.md")).toBe(true);
  });
  // With no LEADING boundary the pattern matched mid-word, so any word ending in the
  // prefix manufactured coverage.
  test("a mid-word match does NOT count: 'notguild:learn' / 'notcommands/learn.md'", () => {
    expect(isTokenCovered("learn", "notguild:learn")).toBe(false);
    expect(isTokenCovered("learn", "notcommands/learn.md")).toBe(false);
    expect(isTokenCovered("learn", "x-guild:learn")).toBe(false);
  });
  test("the legitimate leading forms still match", () => {
    expect(isTokenCovered("learn", "run /guild:learn")).toBe(true);
    expect(isTokenCovered("learn", "guild:learn at line start")).toBe(true);
    expect(isTokenCovered("learn", "see plugin/commands/learn.md")).toBe(true);
    expect(isTokenCovered("learn", "(guild:learn)")).toBe(true);
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
  // DELIBERATE DIVERGENCE FROM HTML, verified against parse5: in an HTML (non-foreign)
  // context `<![CDATA[` is a bogus COMMENT that ends at the first `>`, so a browser renders
  // `b) guild:ghost ]]>` as prose and would count this as covered. The scanner instead
  // treats it as an XML CDATA section and drops through `]]>`. That is the FAIL-CLOSED
  // direction (at worst a loud false FAIL) and it is pre-existing behaviour; making it
  // HTML-accurate would open a real leak — `<![CDATA[ >guild:ghost` would manufacture
  // coverage. Kept as-is, on purpose, and pinned here so the choice is not silently lost.
  //
  // The CDATA input MUST contain a `>` before the `]]>`. Without one, the ordinary-tag
  // path stops at the very same `]]>` and swallows the identical span, so the assertion
  // holds with the `<![CDATA[` branch DELETED — a vacuous test that proves nothing. With
  // the inner `>` the two paths diverge: delete the branch and the tag scan ends at
  // `a > b`, leaking `guild:ghost` and turning this red. (Measured, not assumed.)
  test("a token inside CDATA does not count (non-vacuous: inner '>' splits the paths)", () => {
    const text = htmlToText(`<p>ok</p><![CDATA[ if (a > b) guild:ghost ]]><p>tail</p>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
    expect(text).toContain("tail"); // and the page after the CDATA is not lost
  });
  // Round-2 self-audit: allowing whitespace after `<` / `</` leaked in BOTH directions.
  test("a '</ script>' pseudo-close does NOT end the raw-text run early", () => {
    // A browser is still inside the script here, so nothing after it is prose.
    expect(isTokenCovered("ghost", htmlToText(`<script>a</ script>guild:ghost`))).toBe(false);
  });
  // Characterization (NOT a regression — this already held pre-fix, and re-verifying it was
  // the point). A pseudo-close is inert to a browser, so the raw-text run must continue
  // THROUGH it and end only at the next real `</script>` — neither leaking the span it
  // covers nor eating the page past the real close.
  test("a pseudo-close does not end the run, but a later REAL close still does", () => {
    const text = htmlToText(`<script>a</ script>guild:ghost</script><p>tail</p>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("tail");
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

  // ── Adversarial-review regressions (round 2) ────────────────────────────────
  // Each of the four below was measured against the pre-fix scanner and observed to fail
  // there; they are regressions, not restatements of behaviour that already held.

  // FALSE PASS: <template> content is inert — parsed into a detached fragment and never
  // rendered — so it is not prose, but the ordinary-tag path let its whole body count.
  // FALSE PASS: <noscript>/<iframe>/<noembed>/<noframes> hold fallback content that a
  // browser with scripting and embedding enabled never renders — the same inert-content
  // rule as <template>, at top level.
  test("top-level non-rendered fallback content does NOT count as coverage", () => {
    for (const el of ["noscript", "iframe", "noembed", "noframes"]) {
      const text = htmlToText(`<p>ok</p><${el}>guild:ghost</${el}><p>tail</p>`);
      expect(isTokenCovered("ghost", text)).toBe(false);
      expect(text).toContain("ok");
      expect(text).toContain("tail");
    }
  });

  test("a token inside an inert <template> does NOT count as coverage", () => {
    const text = htmlToText(`<p>ok</p><template><p>guild:ghost</p></template><p>tail</p>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
    expect(text).toContain("tail"); // the template ends; the page after it survives
  });
  test("nested <template>s are matched by depth, not by the first close tag", () => {
    const text = htmlToText(
      `<template><template>guild:ghost</template>guild:phantom</template>real prose`,
    );
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(isTokenCovered("phantom", text)).toBe(false);
    expect(text).toContain("real prose"); // the OUTER close ends it — depth, not first-match
  });
  test("a '</template>' inside a quoted attribute does NOT close the template early", () => {
    // Closing early is the false-PASS direction for a dropped body: it would leak the rest.
    const text = htmlToText(`<template><div title="</template>">guild:ghost</div></template>ok`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
  });
  test("a '</template>' inside a script body does NOT close the template early", () => {
    const text = htmlToText(`<template><script>var s="</template>";</script>guild:ghost</template>ok`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("ok");
  });
  test("an unclosed <template> is dropped, not leaked", () => {
    expect(isTokenCovered("ghost", htmlToText(`<p>ok</p><template>guild:ghost`))).toBe(false);
  });

  // FALSE FAIL: a `<` that cannot open markup is literal text. Treating it as a tag ate
  // the rest of the paragraph — and any command token in it — up to the next `>`.
  test("a literal '<' in prose does NOT swallow the trailing prose", () => {
    const text = htmlToText(`<p>if a < b then run /guild:migrate to convert</p>`);
    expect(isTokenCovered("migrate", text)).toBe(true);
    expect(text).toContain("to convert");
  });
  test("literal-'<' handling does NOT reopen the quoted-attribute leak", () => {
    // `<a` IS a tag open, so the round-1 guard must still apply in full.
    const text = htmlToText(`<a title=">guild:ghost">visible</a>`);
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("visible");
  });
  test("a trailing '<' at EOF is emitted, not treated as an unterminated tag", () => {
    // The `<` itself is the assertion. Checking only that `guild:qa` survives is VACUOUS —
    // it precedes the `<`, so it survives with the fix reverted too (measured).
    const text = htmlToText(`<p>guild:qa</p> a <`);
    expect(text).toContain("<");
    expect(text).toContain("guild:qa");
  });

  // FALSE PASS: HTML whitespace is exactly [\t\n\f\r ]. JS `\s` also matches U+00A0 and
  // U+000B, so `</script >` satisfied a `</script\s*>` matcher while a browser stayed
  // inside the script — and the whole JS body after it leaked out as "prose".
  // (parse5 confirms the token stays under the script node for both characters.)
  test("a NON-HTML-whitespace 'close' does not end the script (U+00A0, U+000B)", () => {
    expect(isTokenCovered("ghost", htmlToText(`<script>a</script >guild:ghost`))).toBe(false);
    expect(isTokenCovered("ghost", htmlToText(`<script>a</script>guild:ghost`))).toBe(false);
  });
  test("every real HTML whitespace DOES still close the script", () => {
    for (const ws of ["\t", "\n", "\f", "\r", " "]) {
      const text = htmlToText(`<script>a</script${ws}>/guild:migrate`);
      expect(isTokenCovered("migrate", text)).toBe(true);
    }
  });

  // FALSE FAIL: HTML accepts `</script foo>` and `</script/>` as end tags (with a parse
  // error). Requiring `</script\s*>` rejected both, so the raw-text run swallowed the real
  // prose that followed, to EOF.
  test("'</script foo>' and '</script/>' close the script, so following prose survives", () => {
    expect(isTokenCovered("migrate", htmlToText(`<script>a</script foo>/guild:migrate`))).toBe(true);
    expect(isTokenCovered("migrate", htmlToText(`<script>a</script/>/guild:migrate`))).toBe(true);
  });
  test("a '>' inside the END tag's attributes does not end it early", () => {
    // The token must sit AFTER the embedded `>` but still inside the quotes — otherwise a
    // naive first-`>` scan exposes the same trailing prose and the test proves nothing.
    const text = htmlToText(`<script>a</script foo="x>guild:ghost">/guild:migrate`);
    expect(isTokenCovered("ghost", text)).toBe(false); // would leak on a first-`>` scan
    expect(isTokenCovered("migrate", text)).toBe(true); // and the real prose still survives
  });

  // FALSE FAIL: an HTML tag name ends at whitespace, `/` or `>`. Matching the raw-text and
  // template names with `\b` let `<script:demo>` / `<templates>`-alikes claim the element,
  // consuming the rest of the page to EOF and losing every token in it.
  test("a namespaced element is NOT mistaken for <script>, so its prose survives", () => {
    const text = htmlToText(`<script:demo>/guild:migrate</script:demo>`);
    expect(isTokenCovered("migrate", text)).toBe(true);
  });
  test("<template-ish> element names do not claim the template branch", () => {
    expect(isTokenCovered("qa", htmlToText(`<template:slot>guild:qa</template:slot>`))).toBe(true);
  });

  // FALSE PASS: `</template>` inside a textarea/title body is literal content, not a close
  // tag, so it must not end the template early and leak the remainder.
  test("a '</template>' inside a <textarea> does NOT close the template early", () => {
    const text = htmlToText(
      `<template><textarea>x</template>guild:ghost</textarea></template><p>tail</p>`,
    );
    expect(isTokenCovered("ghost", text)).toBe(false);
    expect(text).toContain("tail");
  });

  test("every raw-text element inside a template blocks the early close", () => {
    // Not just script/textarea: iframe, xmp, noembed, noframes and plaintext all keep
    // `</template>` as literal content, and missing any one of them leaks the page tail.
    for (const el of ["iframe", "xmp", "noembed", "noframes", "noscript"]) {
      const text = htmlToText(
        `<template><${el}></template>guild:ghost</${el}></template><p>tail</p>`,
      );
      expect(isTokenCovered("ghost", text)).toBe(false);
      expect(text).toContain("tail");
    }
    // <plaintext> has no end tag — it runs to EOF, so the template can never close and the
    // remainder is dropped. Fail closed, which is the safe direction.
    const pt = htmlToText(`<template><plaintext></template>guild:ghost</template><p>tail</p>`);
    expect(isTokenCovered("ghost", pt)).toBe(false);
  });
  test("'</plaintext>' is literal content, not an end tag, so nothing after it leaks", () => {
    // Routing plaintext through the ordinary raw-text close honoured `</plaintext>`, which
    // then closed the template and leaked the page tail. It must consume to EOF instead.
    const text = htmlToText(
      `<template><plaintext></template>inert</plaintext></template>guild:ghost`,
    );
    expect(isTokenCovered("ghost", text)).toBe(false);
  });

  // FALSE PASS: entity names are case-SENSITIVE. `&COLON;` is not an entity (a browser
  // renders it literally) and `&Colon;` is U+2237, not `:` — case-folding either one
  // manufactured a `guild:` token that is nowhere on the rendered page.
  test("entity names are case-sensitive: '&COLON;' / '&Colon;' do NOT become ':'", () => {
    expect(isTokenCovered("ghost", htmlToText("<p>guild&COLON;ghost</p>"))).toBe(false);
    expect(isTokenCovered("ghost", htmlToText("<p>guild&Colon;ghost</p>"))).toBe(false);
    expect(htmlToText("<p>guild&COLON;ghost</p>")).toContain("&COLON;");
  });
  test("HTML's legacy UPPERCASE forms are still decoded", () => {
    expect(htmlToText("<p>&LT;x&GT;</p>")).toContain("<x>");
    expect(htmlToText("<p>a&AMP;b</p>")).toContain("a&b");
  });

  // FALSE FAIL: a named entity for punctuation left undecoded reads as a different token.
  test("named punctuation entities are decoded, so an encoded colon still counts", () => {
    expect(isTokenCovered("migrate", htmlToText("<p>guild&colon;migrate</p>"))).toBe(true);
    expect(isTokenCovered("migrate", htmlToText("<p>&sol;guild&colon;migrate</p>"))).toBe(true);
    expect(isTokenCovered("plan", htmlToText("<p>commands&sol;plan&period;md</p>"))).toBe(true);
  });
  test("the one-pass ordering guarantee still holds for the new names", () => {
    expect(htmlToText("<p>&amp;colon;</p>")).toContain("&colon;"); // must NOT become ':'
  });
  test("an ambiguous name is NOT decoded ('&hyphen;' is U+2010, not '-')", () => {
    expect(htmlToText("<p>guild:learn&hyphen;map</p>")).toContain("&hyphen;");
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
