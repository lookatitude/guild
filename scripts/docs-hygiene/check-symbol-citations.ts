#!/usr/bin/env npx tsx
/**
 * docs-hygiene/check-symbol-citations.ts
 *
 * WARN-ONLY drift detector for `file:line (symbol)` citations in the reference docs.
 *
 * Finding F-6: line-precision citations rot fast in an active repo. Across one drift
 * window every checked anchor had moved (`config-defaults.ts:117`→`:130`,
 * `extract-structural.ts:262`→`:277`, `resolve-calls.ts:215`→`:222`,
 * `validate-graph.ts:33`→`:104`, …) while the cited SYMBOL stayed put in every case.
 * Symbols are the durable anchor; line numbers are the perishable one. This script makes
 * that rot visible without pretending line numbers can be trusted.
 *
 * It reports three classes, in decreasing severity:
 *   MISSING  — the cited symbol does not appear in the cited file at all (a real stale
 *              claim: the doc points at something that no longer exists).
 *   DRIFTED  — the symbol exists, but not within --window lines of the cited anchor
 *              (the F-6 class: substance correct, line number rotted).
 *   OVERRUN  — a line-only citation points past the end of the file.
 *
 * NON-BLOCKING BY DESIGN. It always exits 0 when it ran successfully, whatever it found
 * (exit 2 only for bad input). It is a maintenance aid, not a gate: the failure mode it
 * detects is cosmetic, and wiring it blocking would red-light CI on every refactor that
 * shifts a line. A proposal for opt-in wiring is recorded in the campaign ESCALATIONS.
 *
 * Usage:
 *   npx tsx scripts/docs-hygiene/check-symbol-citations.ts \
 *     --docs-dir <path> --repo-root <path> [--window N] [--quiet]
 *
 *   --docs-dir <path>   Reference-doc tree to scan (.md and .html). Only CODE SPANS are
 *                       scanned — backticks in Markdown, `<code>` in HTML — because that
 *                       is where citations live and prose parentheticals are not.
 *   --repo-root <path>  Root the cited paths resolve against. Repeatable — a citation is
 *                       resolved against each root in order, first hit wins (a docs set
 *                       spanning an umbrella + its sub-repos needs more than one).
 *   --window N          Lines of slack before a symbol counts as DRIFTED (default 25).
 *   --quiet             Print only the summary line.
 *
 * Exit: 0 = ran (findings are reported, not fatal). 1 = bad input, per the
 * `scripts/README.md` exit-code convention. Because this check is warn-only it never
 * needs a distinct "findings present" code, so 1 is free for bad input here — unlike its
 * blocking sibling `check-command-coverage.ts`, which spends 1 on the gate signal.
 *
 * The parse/compare core is pure and filesystem-free so it is unit-testable.
 */

import * as fs from "fs";
import * as path from "path";

export type CitationKind = "MISSING" | "DRIFTED" | "OVERRUN";

export interface Citation {
  /** Path exactly as written in the doc. */
  citedPath: string;
  /** 1-based line anchor, when the citation carries one. */
  line?: number;
  /** Symbol in trailing parens, when the citation carries one. */
  symbol?: string;
  /** Doc file the citation was found in. */
  docFile: string;
}

export interface Finding extends Citation {
  kind: CitationKind;
  detail: string;
}

/**
 * Pure core. Extract the CODE SPANS of a doc — Markdown backtick spans, HTML `<code>`
 * elements — decoding entities in the HTML case.
 *
 * Scanning code spans instead of the whole page is what keeps precision usable. Ordinary
 * prose routinely puts a parenthetical right after a path ("… `settings.json` (JSON). It
 * replaces the v1 …"), and once HTML is tag-stripped to flat text there is nothing left to
 * distinguish that from a genuine `path.ts (symbolName)` citation — every such sentence
 * became a bogus MISSING. Citations per contract rule 5 are always written inside a code
 * span, so that is the only place worth looking.
 */
export function extractCodeSpans(text: string, isHtml: boolean): string[] {
  const spans: string[] = [];
  if (isHtml) {
    for (const m of text.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi)) {
      spans.push(
        m[1]
          .replace(/<[^>]*>/g, "")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/&quot;/gi, '"')
          .replace(/&apos;|&#0*39;/gi, "'")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&"),
      );
    }
    return spans;
  }
  // Markdown: fenced blocks first (so a fence's contents are one span, not a run of
  // stray inline spans), then the remaining single/double-backtick inline spans.
  let rest = text.replace(/```[\s\S]*?```/g, (block) => {
    spans.push(block.slice(3, -3));
    return "\n";
  });
  for (const m of rest.matchAll(/`{1,2}([^`\n]+)`{1,2}/g)) spans.push(m[1]);
  return spans;
}

/**
 * Pure core. Extract citations from a doc's code spans.
 *
 * Recognised forms (the symbol-anchored shapes contract rule 5 asks authors to prefer,
 * plus the bare line form they are migrating away from):
 *   `path/to/file.ts:120 (symbolName)`   → path + line + symbol
 *   `path/to/file.ts (symbolName)`       → path + symbol
 *   `path/to/file.ts:120`                → path + line
 *   `path/to/file.ts:120-133`            → path + line (range start)
 *
 * A path must contain a `/` and a file extension — a bare `foo.ts` cannot be resolved
 * unambiguously against a repo root, so it is deliberately not treated as a citation.
 * The `(symbol)` must sit immediately after the path/anchor (at most one space) and hold
 * a lone identifier: `(real implementation)` is prose, `(gatherKnowledgeText)` is a symbol.
 */
export function parseCitations(text: string, docFile: string, isHtml: boolean): Citation[] {
  const re =
    /([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.[A-Za-z0-9]+)(?::(\d+)(?:-\d+)?)?(?: ?\(([A-Za-z_$][A-Za-z0-9_$.]*)\))?/g;
  const out: Citation[] = [];
  for (const span of extractCodeSpans(text, isHtml)) {
    for (const m of span.matchAll(re)) {
      const [, citedPath, lineStr, symbol] = m;
      // A path alone, with neither a line anchor nor a symbol, is a plain file mention —
      // there is nothing to verify beyond existence, which other hygiene checks own.
      if (!lineStr && !symbol) continue;
      out.push({
        citedPath,
        line: lineStr ? Number(lineStr) : undefined,
        symbol,
        docFile,
      });
    }
  }
  return out;
}

/** Word-bounded 1-based line numbers where `symbol` appears in `lines`. */
export function findSymbolLines(lines: string[], symbol: string): number[] {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) hits.push(i + 1);
  return hits;
}

/**
 * Pure core. Compare one citation against the cited file's lines.
 * Returns null when the citation checks out.
 */
export function checkCitation(
  citation: Citation,
  lines: string[],
  window: number,
): Finding | null {
  const { symbol, line } = citation;

  if (symbol) {
    const hits = findSymbolLines(lines, symbol);
    if (hits.length === 0) {
      return { ...citation, kind: "MISSING", detail: `symbol '${symbol}' not found in file` };
    }
    if (line !== undefined && !hits.some((h) => Math.abs(h - line) <= window)) {
      const nearest = hits.reduce((a, b) => (Math.abs(b - line) < Math.abs(a - line) ? b : a));
      return {
        ...citation,
        kind: "DRIFTED",
        detail: `cited :${line}, '${symbol}' is at :${nearest} (${hits.length} occurrence(s))`,
      };
    }
    return null;
  }

  if (line !== undefined && line > lines.length) {
    return {
      ...citation,
      kind: "OVERRUN",
      detail: `cited :${line} but file has ${lines.length} line(s)`,
    };
  }
  return null;
}

// ── I/O ───────────────────────────────────────────────────────────────────────

const DOC_EXTENSIONS = [".md", ".html", ".htm"];

/** Every doc file under `dir`, raw — code-span extraction needs the markup intact. */
export function readDocs(dir: string): Array<{ file: string; text: string; isHtml: boolean }> {
  const out: Array<{ file: string; text: string; isHtml: boolean }> = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      if (!DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
      out.push({ file: abs, text: fs.readFileSync(abs, "utf8"), isHtml: !lower.endsWith(".md") });
    }
  };
  walk(dir);
  return out;
}

/** First root under which `citedPath` resolves to a file, or null. */
export function resolveCited(citedPath: string, roots: string[]): string | null {
  for (const root of roots) {
    const abs = path.resolve(root, citedPath);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

export interface ScanResult {
  findings: Finding[];
  checked: number;
  unresolved: number;
}

export function scan(docsDir: string, roots: string[], window: number): ScanResult {
  const findings: Finding[] = [];
  const fileCache = new Map<string, string[]>();
  let checked = 0;
  let unresolved = 0;

  for (const { file, text, isHtml } of readDocs(docsDir)) {
    for (const citation of parseCitations(text, file, isHtml)) {
      const abs = resolveCited(citation.citedPath, roots);
      if (!abs) {
        unresolved++;
        continue;
      }
      let lines = fileCache.get(abs);
      if (!lines) {
        lines = fs.readFileSync(abs, "utf8").split("\n");
        fileCache.set(abs, lines);
      }
      checked++;
      const finding = checkCitation(citation, lines, window);
      if (finding) findings.push(finding);
    }
  }
  return { findings, checked, unresolved };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  docsDir?: string;
  roots: string[];
  window: number;
  quiet: boolean;
} {
  let docsDir: string | undefined;
  const roots: string[] = [];
  let window = 25;
  let quiet = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--docs-dir" && argv[i + 1]) docsDir = argv[++i];
    else if (a.startsWith("--docs-dir=")) docsDir = a.slice("--docs-dir=".length);
    else if (a === "--repo-root" && argv[i + 1]) roots.push(argv[++i]);
    else if (a.startsWith("--repo-root=")) roots.push(a.slice("--repo-root=".length));
    else if (a === "--window" && argv[i + 1]) window = Number(argv[++i]);
    else if (a.startsWith("--window=")) window = Number(a.slice("--window=".length));
    else if (a === "--quiet") quiet = true;
  }
  return { docsDir, roots, window, quiet };
}

export function main(argv: string[]): number {
  const { docsDir, roots, window, quiet } = parseArgs(argv);
  if (!docsDir || roots.length === 0) {
    process.stderr.write(
      "[symbol-citations] ERROR: --docs-dir and at least one --repo-root are required\n",
    );
    return 1;
  }
  if (!fs.existsSync(docsDir) || !fs.statSync(docsDir).isDirectory()) {
    process.stderr.write(`[symbol-citations] ERROR: docs dir not found: ${docsDir}\n`);
    return 1;
  }
  for (const r of roots) {
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) {
      process.stderr.write(`[symbol-citations] ERROR: repo root not found: ${r}\n`);
      return 1;
    }
  }
  if (!Number.isFinite(window) || window < 0) {
    process.stderr.write(`[symbol-citations] ERROR: --window must be a non-negative number\n`);
    return 1;
  }

  const { findings, checked, unresolved } = scan(docsDir, roots, window);

  if (!quiet) {
    for (const f of findings) {
      const anchor = f.line !== undefined ? `:${f.line}` : "";
      process.stdout.write(
        `[symbol-citations] ${f.kind} ${path.relative(docsDir, f.docFile)} → ` +
          `${f.citedPath}${anchor} — ${f.detail}\n`,
      );
    }
  }

  const byKind = (k: CitationKind): number => findings.filter((f) => f.kind === k).length;
  process.stdout.write(
    `[symbol-citations] checked ${checked} citation(s): ` +
      `${byKind("MISSING")} MISSING, ${byKind("DRIFTED")} DRIFTED, ${byKind("OVERRUN")} OVERRUN ` +
      `(${unresolved} unresolved path(s) skipped). Warn-only — not a gate.\n`,
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
