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

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  amp: "&",
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
 */
function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (dec !== undefined) return safeFromCodePoint(Number(dec), whole);
    if (hex !== undefined) return safeFromCodePoint(parseInt(hex, 16), whole);
    const named = NAMED_ENTITIES[String(name).toLowerCase()];
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

    // Raw-text elements: everything up to the matching close tag is markup-language
    // content, never prose. No close tag ⇒ consume to EOF (fail closed).
    //
    // Tag-name matching is EXACT — no whitespace between `<`/`</` and the name — because
    // that is what HTML actually permits, and being loose here leaks in both directions:
    //   - a permissive OPEN (`<   script>`) outran the fixed lookahead window, so the tag
    //     fell through to the ordinary-tag path and its whole JS body became "text";
    //   - a permissive CLOSE (`</ script>`) ended the raw-text run early — a browser would
    //     still be inside the script — so the remainder leaked out as "text".
    // Both were FALSE PASSES. `<script >` / `</script >` (space AFTER the name) IS legal,
    // and is still handled.
    const raw = /^<(script|style)\b/i.exec(html.slice(lt, lt + 8));
    if (raw) {
      const tagEnd = scanTagEnd(html, lt);
      const close = new RegExp(`</${raw[1]}\\s*>`, "i").exec(html.slice(tagEnd));
      i = close ? tagEnd + close.index + close[0].length : n;
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
