#!/usr/bin/env -S npx tsx
/**
 * src/modules/docs-sync/workflows/check-command-coverage.ts
 *
 * Umbrella-side COMPLEMENT to the plugin-side doc-sync advisory (check-doc-sync.ts).
 * Where check-doc-sync is DIFF-based (did THIS PR's surface change get a root-doc
 * update?), this is STATE-based: is the WHOLE current command surface covered by root
 * reference docs? It is meant to run from the UMBRELLA repo's CI, which can check out the
 * sibling plugin repo — so it can verify coverage the plugin-repo CI structurally cannot.
 *
 * Enforces Rule 2 of ADR: workspace-knowledge-flow (workspace wiki) as a standing
 * gate: every plugin command (plugin/commands/<token>.md) must be referenced somewhere
 * in the root reference stores (.guild/wiki/ + docs/v2/) — as the namespaced
 * `guild:<token>` / `/guild:<token>` token (word-bounded) or as a `commands/<token>.md`
 * reference. An uncovered command means a command shipped without its root reference docs
 * being updated (rollout-coupling drift).
 *
 * Reference pages are BOTH Markdown (.md — .guild/wiki/) and HTML (.html — docs/v2/, which
 * is an all-HTML set). HTML pages are tag-stripped to plain text before matching so markup
 * and attributes can neither hide a real reference nor manufacture a false one.
 *
 * Usage:
 *   npx tsx check-command-coverage.ts --commands-dir <path> --knowledge-dir <path> [--warn]
 *
 *   --commands-dir <path>   The plugin repo's commands/ dir (e.g. ./.plugin-src/commands).
 *   --knowledge-dir <path>  The staged root reference store (.guild/wiki + docs/v2).
 *   --warn                  Report but exit 0 even when commands are uncovered (advisory).
 *                           Default: exit 1 when any command is uncovered (a real gate).
 *
 * Exit: 0 = all covered (or --warn). 1 = uncovered commands found. 2 = bad input.
 *
 * Pure core (`evaluateCommandCoverage`) takes already-read inputs so it is deterministic
 * and unit-testable with no filesystem.
 */

import * as fs from "fs";
import * as path from "path";

export interface CoverageResult {
  covered: string[];
  uncovered: string[];
}

/** Escape a string for safe use inside a RegExp. Command tokens are [a-z0-9-] but escape defensively. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure core. A token is "covered" iff, across the concatenated knowledge text, it appears
 * as `guild:<token>` or `/guild:<token>` (word-bounded — so `stat` does NOT match
 * `guild:status` and vice-versa) OR as a `commands/<token>.md` file reference.
 */
export function isTokenCovered(token: string, knowledgeText: string): boolean {
  const t = escapeRegex(token);
  // Namespaced command/skill token, optional leading slash, word boundary after the token.
  const namespaced = new RegExp(`/?guild:${t}\\b`);
  // A direct reference to the command file.
  const fileRef = new RegExp(`commands/${t}\\.md\\b`);
  return namespaced.test(knowledgeText) || fileRef.test(knowledgeText);
}

/**
 * Pure core. Given the command tokens and the concatenated knowledge text, partition into
 * covered / uncovered (uncovered sorted for stable output).
 */
export function evaluateCommandCoverage(
  commandTokens: string[],
  knowledgeText: string,
): CoverageResult {
  const covered: string[] = [];
  const uncovered: string[] = [];
  for (const token of commandTokens) {
    if (isTokenCovered(token, knowledgeText)) covered.push(token);
    else uncovered.push(token);
  }
  uncovered.sort();
  return { covered, uncovered };
}

/** Read command tokens from a commands/ dir: each `<token>.md` → `<token>`. */
export function collectCommandTokens(commandsDir: string): string[] {
  const entries = fs.readdirSync(commandsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name.slice(0, -".md".length))
    .sort();
}

/** Reference-page extensions the walk reads. docs/v2 is an all-HTML set; .guild/wiki is .md. */
const KNOWLEDGE_EXTENSIONS = [".md", ".html", ".htm"] as const;

/**
 * Named entities decoded by `decodeEntities`.
 *
 * The ASCII-punctuation names matter as much as the structural ones: a doc that writes
 * `guild&colon;migrate` (or `commands&sol;migrate&period;md`) MEANS the token, and an
 * undecoded name reads as an undocumented command — a false FAIL on a blocking gate.
 * Only names whose expansion is unambiguous ASCII are listed; `&hyphen;` is U+2010, NOT
 * `-`, so decoding it would silently rewrite the text and is deliberately omitted.
 */
const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  amp: "&",
  colon: ":",
  semi: ";",
  sol: "/",
  bsol: "\\",
  period: ".",
  comma: ",",
  num: "#",
  excl: "!",
  quest: "?",
  lpar: "(",
  rpar: ")",
  lsqb: "[",
  rsqb: "]",
  lcub: "{",
  rcub: "}",
  commat: "@",
  ast: "*",
  plus: "+",
  equals: "=",
  verbar: "|",
  lowbar: "_",
  grave: "`",
  tilde: "~",
  dollar: "$",
  percnt: "%",
  // HTML defines these four legacy UPPERCASE forms. They are listed explicitly because the
  // lookup is case-SENSITIVE — see `decodeEntities`.
  LT: "<",
  GT: ">",
  QUOT: '"',
  AMP: "&",
};

/**
 * Decode HTML entities in ONE pass.
 *
 * A single pass rather than chained `.replace()` calls is deliberate: chained replaces
 * have an ordering hazard in both directions — decode `&amp;` first and a literal
 * `&amp;lt;` wrongly becomes `<`; decode it last and `&amp;#58;` still slips through a
 * numeric-entity pass. Matching every entity in one sweep makes the text a function of
 * the input alone, with no rule ordering to get wrong.
 *
 * Numeric forms are decoded too (`&#58;` is a colon — a doc writing `guild&#58;migrate`
 * means the token, and without this the gate would report the command undocumented).
 *
 * Named lookup is CASE-SENSITIVE, which HTML requires and which matters here in the
 * false-PASS direction: `&COLON;` is not an entity at all (a browser renders the eight
 * literal characters), and `&Colon;` is U+2237 `∷`, NOT a colon. Case-folding the name
 * turned `guild&COLON;ghost` into the token `guild:ghost` and manufactured coverage for a
 * command that appears nowhere on the rendered page. HTML's four legacy uppercase forms
 * are therefore listed explicitly in the table instead.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (dec !== undefined) return safeFromCodePoint(Number(dec), whole);
    if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16), whole);
    const named = NAMED_ENTITIES[String(name)];
    return named ?? whole; // unknown entity: leave it verbatim rather than guess
  });
}

function safeFromCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return fallback;
  try {
    return String.fromCodePoint(code);
  } catch {
    return fallback;
  }
}

/**
 * Pure core. Reduce an HTML page to the plain text a reader sees, so command tokens are
 * matched against prose — not markup.
 *
 * This is a small SCANNER, not a chain of regexes, and that distinction is load-bearing.
 * A `<[^>]*>` strip is not an HTML tokenizer: the first `>` ends the match even when it
 * sits inside a quoted attribute value, so
 *
 *     <a title=">guild:ghost">visible</a>
 *
 * leaks `guild:ghost">` into the "text" and MANUFACTURES coverage for a command that is
 * documented nowhere. Likewise a `<script>` with no closing tag survives a
 * `<script>…</script>` regex entirely, so a token in a JS string satisfies the gate.
 * Both are FALSE PASSES — the dangerous direction for a gate whose whole job is to fail
 * when a command is undocumented. (Found by adversarial review of the first cut.)
 *
 * So: walk the input once, tracking whether we are inside a tag and inside a quoted
 * attribute value. Ambiguity FAILS CLOSED — an unterminated tag, comment, or raw-text
 * element consumes to EOF and contributes nothing. Dropping text can only cause a false
 * FAIL, which is loud and fixable; leaking markup causes a false PASS, which is silent.
 */
export function htmlToText(html: string): string {
  const out: string[] = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out.push(html.slice(i));
      break;
    }
    out.push(html.slice(i, lt));

    // A `<` that cannot open markup is LITERAL TEXT, exactly as the HTML tokenizer treats
    // it: only a letter, `/`, `!` or `?` after `<` starts a tag, close tag, comment/
    // declaration, or processing instruction. Treating EVERY `<` as a tag made ordinary
    // prose — `if a < b then run /guild:migrate` — swallow the rest of the paragraph up to
    // the next `>`, taking any command token with it. That is a false FAIL, and on a
    // blocking gate a false FAIL on real prose is a defect too, not a safe default.
    const next = html[lt + 1];
    if (next === undefined || !/[a-zA-Z!/?]/.test(next)) {
      out.push("<");
      i = lt + 1;
      continue;
    }

    // Comment / CDATA / doctype-ish `<!…>` — drop to its terminator, or to EOF.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      out.push(" ");
      continue;
    }
    if (html.startsWith("<![CDATA[", lt)) {
      const end = html.indexOf("]]>", lt + 9);
      i = end === -1 ? n : end + 3;
      out.push(" ");
      continue;
    }

    // Elements whose content a reader never sees: everything up to the matching close tag
    // is markup-language content or non-rendered fallback, never prose. No close tag ⇒
    // consume to EOF (fail closed).
    //   script, style                      — markup-language content
    //   noscript, iframe, noembed, noframes — fallback content, not rendered when scripting
    //                                         and embedding work (the browser default)
    // Same INERT-content rule as `<template>` below; leaving any of them on the prose path
    // let a token that is nowhere on the rendered page satisfy the gate (a FALSE PASS).
    //
    // Tag-name matching is EXACT — no whitespace between `<`/`</` and the name — because
    // that is what HTML actually permits, and being loose here leaks in both directions:
    //   - a permissive OPEN (`<   script>`) outran the fixed lookahead window, so the tag
    //     fell through to the ordinary-tag path and its whole JS body became "text";
    //   - a permissive CLOSE (`</ script>`) ended the raw-text run early — a browser would
    //     still be inside the script — so the remainder leaked out as "text".
    // Both were FALSE PASSES. `<script >` / `</script >` (space AFTER the name) IS legal,
    // and is still handled — see `findRawTextClose` for what "legal" means precisely.
    const raw = /^<(script|style|noscript|iframe|noembed|noframes)(?=[\t\n\f\r />])/i.exec(
      html.slice(lt, lt + 10),
    );
    if (raw) {
      const close = findRawTextClose(html, scanTagEnd(html, lt), raw[1]);
      i = close === -1 ? n : close;
      out.push(" ");
      continue;
    }

    // `<template>` content is INERT. The parser puts it in a detached document fragment
    // that is never rendered, so nothing inside it is prose a reader can see — yet as an
    // ordinary tag its whole body counted as text and MANUFACTURED coverage for a command
    // documented nowhere (a FALSE PASS). Templates nest, so match them by depth; an
    // unclosed one consumes to EOF (fail closed).
    if (/^<template(?=[\t\n\f\r />])/i.test(html.slice(lt, lt + 10))) {
      i = skipTemplate(html, lt);
      out.push(" ");
      continue;
    }

    // An ordinary tag. Skip to the `>` that actually closes it — one not inside a
    // quoted attribute value. Unterminated ⇒ consume to EOF (fail closed).
    i = scanTagEnd(html, lt);
    out.push(" ");
  }

  return decodeEntities(out.join(""));
}

/**
 * HTML's whitespace set is exactly these five ASCII characters. JavaScript's `\s` is much
 * wider — it also matches U+00A0, U+000B, and the Unicode space separators — and using `\s`
 * to match tag syntax leaks in BOTH directions, so the distinction is load-bearing here.
 */
const HTML_SPACE = "\\t\\n\\f\\r ";

/**
 * Index just past the end tag that closes a raw-text element (`script` / `style`) opened
 * before `from`, or -1 when it is never closed (caller drops to EOF — fail closed).
 *
 * An end tag is `</name` followed by HTML whitespace, `/`, or `>` — NOT `</name` plus an
 * arbitrary `>` somewhere later. Matching `</name\s*>` got both directions wrong:
 *   - `</script >` matched, because JS `\s` covers U+00A0. HTML does not, so a browser
 *     is STILL inside the script and everything after it leaked out as prose — a FALSE PASS.
 *   - `</script foo>` and `</script/>` did NOT match, though HTML accepts both as end tags
 *     (with a parse error). The run then ran to EOF and swallowed real prose — a FALSE FAIL.
 * Once the name boundary matches, the tag ends at its own `>`, found with the quote-aware
 * scan so a `>` inside an attribute cannot end it early.
 */
function findRawTextClose(html: string, from: number, name: string): number {
  const marker = new RegExp(`</${name}(?=[${HTML_SPACE}/>])`, "i");
  const m = marker.exec(html.slice(from));
  return m ? scanTagEnd(html, from + m.index) : -1;
}

/**
 * Index just past the `>` that closes the tag starting at `start`, honouring quoted
 * attribute values so a `>` inside `title=">x"` does not end the tag. Returns the input
 * length when the tag is never closed.
 */
function scanTagEnd(html: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let j = start + 1; j < html.length; j++) {
    const c = html[j];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return j + 1;
    }
  }
  return html.length;
}

/**
 * Index just past the `</template>` closing the template that opens at `start`, honouring
 * NESTING (a `<template>` may contain another). Returns the input length when the template
 * is never closed, so an unclosed template drops the rest of the page rather than leaking it.
 *
 * This WALKS the template body with the same discipline as `htmlToText` instead of scanning
 * for `</template>` with a regex, because for an element whose body is dropped, closing too
 * EARLY is the false-PASS direction: a bare regex matches the `</template>` inside
 * `<div title="</template>">`, ending the run mid-attribute and leaking the rest of the
 * page. Quoted attributes, comments, and raw-text bodies are therefore all skipped properly.
 */
function skipTemplate(html: string, start: number): number {
  let depth = 1;
  let i = scanTagEnd(html, start);

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) return html.length;

    const next = html[lt + 1];
    if (next === undefined || !/[a-zA-Z!/?]/.test(next)) {
      i = lt + 1; // a literal `<`, not markup
      continue;
    }
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) return html.length;
      i = end + 3;
      continue;
    }
    // A `</template>` inside a raw-text or escapable-raw-text body does NOT close the
    // template — `<textarea>x</template>y</textarea>` keeps `</template>` as literal
    // content — so step over those bodies whole. Missing ANY of these elements closed the
    // template early and leaked the rest of the page (a FALSE PASS; parse5 confirms the
    // content stays inert). The list must therefore be the COMPLETE set of elements whose
    // content is not parsed as markup, not just the common two:
    //   script, style          — raw text
    //   textarea, title        — escapable raw text
    //   iframe, noembed,
    //   noframes, noscript,
    //   xmp                    — raw text in a conforming parser (noscript when scripting
    //                            is enabled, which is the browser default)
    //   plaintext              — raw text to EOF. It has NO end tag: `</plaintext>` is
    //                            literal content, so it must NOT be routed through
    //                            `findRawTextClose` (which would honour it, close the
    //                            template, and leak the tail). It ends the scan outright.
    // Unclosed ⇒ EOF, which drops the remainder (fail closed).
    if (/^<plaintext(?=[\t\n\f\r />])/i.test(html.slice(lt, lt + 11))) return html.length;

    const raw = /^<(script|style|textarea|title|iframe|noembed|noframes|noscript|xmp)(?=[\t\n\f\r />])/i.exec(
      html.slice(lt, lt + 11),
    );
    if (raw) {
      const close = findRawTextClose(html, scanTagEnd(html, lt), raw[1]);
      if (close === -1) return html.length;
      i = close;
      continue;
    }

    const end = scanTagEnd(html, lt);
    if (/^<template(?=[\t\n\f\r />])/i.test(html.slice(lt, lt + 10))) depth++;
    else if (/^<\/template(?=[\t\n\f\r />])/i.test(html.slice(lt, lt + 11)) && --depth === 0) return end;
    i = end;
  }
  return html.length;
}

/**
 * Read every reference page under knowledgeDir (recursively) and concatenate.
 * `.md` is used verbatim; `.html`/`.htm` is tag-stripped to text first (see `htmlToText`).
 */
export function gatherKnowledgeText(knowledgeDir: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!KNOWLEDGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
      const raw = fs.readFileSync(abs, "utf8");
      parts.push(lower.endsWith(".md") ? raw : htmlToText(raw));
    }
  };
  walk(knowledgeDir);
  return parts.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { commandsDir?: string; knowledgeDir?: string; warn: boolean } {
  let commandsDir: string | undefined;
  let knowledgeDir: string | undefined;
  let warn = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--commands-dir" && argv[i + 1]) commandsDir = argv[++i];
    else if (a.startsWith("--commands-dir=")) commandsDir = a.slice("--commands-dir=".length);
    else if (a === "--knowledge-dir" && argv[i + 1]) knowledgeDir = argv[++i];
    else if (a.startsWith("--knowledge-dir=")) knowledgeDir = a.slice("--knowledge-dir=".length);
    else if (a === "--warn") warn = true;
  }
  return { commandsDir, knowledgeDir, warn };
}

export function main(argv: string[]): number {
  const { commandsDir, knowledgeDir, warn } = parseArgs(argv);
  if (!commandsDir || !knowledgeDir) {
    process.stderr.write(
      "[command-coverage] ERROR: --commands-dir and --knowledge-dir are required\n",
    );
    return 2;
  }
  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    process.stderr.write(`[command-coverage] ERROR: commands dir not found: ${commandsDir}\n`);
    return 2;
  }
  if (!fs.existsSync(knowledgeDir) || !fs.statSync(knowledgeDir).isDirectory()) {
    process.stderr.write(`[command-coverage] ERROR: knowledge dir not found: ${knowledgeDir}\n`);
    return 2;
  }

  const tokens = collectCommandTokens(commandsDir);
  const knowledgeText = gatherKnowledgeText(knowledgeDir);
  const { covered, uncovered } = evaluateCommandCoverage(tokens, knowledgeText);

  if (uncovered.length === 0) {
    process.stdout.write(
      `[command-coverage] OK — all ${covered.length} commands covered in the root reference docs\n`,
    );
    return 0;
  }

  process.stdout.write(
    `[command-coverage] ${uncovered.length} of ${tokens.length} command(s) NOT covered in the root reference docs:\n` +
      uncovered.map((t) => `  - guild:${t} (plugin/commands/${t}.md)`).join("\n") +
      `\n  Rollout-coupling drift: a command shipped without its root reference docs.` +
      `\n  Fix: document each in a root reference store — .guild/wiki/ (.md) or docs/v2/ (.html)` +
      `\n  — or, if intentional, exclude it explicitly.` +
      `\n  Canon rule: .guild/wiki/decisions/workspace-knowledge-flow.md Rule 2.` +
      `\n  NOTE: docs/knowledge/ is RETIRED (2026-06-27) and no longer satisfies this gate.\n`,
  );
  return warn ? 0 : 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
