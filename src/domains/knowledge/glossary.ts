/**
 * glossary.ts — `guild.glossary.v1` (KTD70 / R80).
 *
 * Every Guild root has one glossary at `.guild/wiki/glossary.md`. It is a wiki
 * page, not a skill, and it is never loaded whole: the full file in the always-on
 * prefix would blow the 2%/1500 budget on a project with a real domain vocabulary,
 * and would do it on every turn including the turns that use none of the terms.
 *
 * What this module does instead is ASSIGNMENT-SCOPED matching. Given the text of
 * one assignment, it returns only the terms that actually appear in it, capped at
 * 200 tokens of the lane bundle's 1200. A specialist working on billing gets the
 * billing terms; nobody pays for the rest.
 *
 * Precedence on the same term is project > workspace > plugin feedstock. The rule
 * exists because the feedstock ships Guild-operating terms ("run", "lane", "tier")
 * that a project may legitimately redefine for its own domain, and when it does,
 * its definition is the one its specialists must read.
 *
 * Federation is QUERY-NOT-COPY: a term that misses locally is looked up in the
 * parent's glossary and attached from there. The parent FILE is never copied into
 * the child tree — a copy is a fork that goes stale silently.
 */

import * as fs from "node:fs";

import { createGuildStorage, type GuildStorage } from "../state";

export const GLOSSARY_SCHEMA = "guild.glossary.v1" as const;

/** KTD70: glossary hits take at most 200 of the lane bundle's 1200 tokens. */
export const GLOSSARY_TERM_TOKEN_CAP = 200;

export interface GlossaryTerm {
  term: string;
  aliases?: string[];
  definition: string;
  status?: "canonical";
  /** Which root this definition came from. Diagnostics only. */
  origin?: "project" | "workspace" | "feedstock";
}

export interface Glossary {
  schema_version: typeof GLOSSARY_SCHEMA;
  terms: GlossaryTerm[];
}

const EMPTY: Glossary = Object.freeze({ schema_version: GLOSSARY_SCHEMA, terms: [] });

/**
 * Parse a `guild.glossary.v1` file.
 *
 * Both shapes the contract allows are accepted: the frontmatter `terms:` list, and
 * the prose `- **term** — definition` bullets the shipped feedstock writes. They
 * are the same data, and a project that edits its glossary by hand will write
 * whichever one it is looking at. Refusing the bullet form would mean a project's
 * own terms silently stop attaching the first time somebody edits the body.
 */
export function parseGlossary(text: string): Glossary {
  if (typeof text !== "string" || text.trim() === "") return { ...EMPTY, terms: [] };
  const terms: GlossaryTerm[] = [];
  const seen = new Set<string>();

  const push = (term: string, definition: string, aliases?: string[]): void => {
    const key = term.trim().toLowerCase();
    if (key === "" || definition.trim() === "" || seen.has(key)) return;
    seen.add(key);
    const t: GlossaryTerm = { term: term.trim(), definition: definition.trim(), status: "canonical" };
    if (aliases && aliases.length > 0) t.aliases = aliases;
    terms.push(t);
  };

  // Frontmatter `terms:` block — a small, shape-specific reader rather than a YAML
  // dependency, because this file is on the recall hot path (KTD45).
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm) {
    const block = fm[1];
    const entryRe = /^\s*-\s+term:\s*(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(block)) !== null) {
      const start = m.index + m[0].length;
      const rest = block.slice(start);
      const end = /^\s*-\s+term:/m.exec(rest);
      const chunk = end ? rest.slice(0, end.index) : rest;
      const def = /^\s*definition:\s*(.+)$/m.exec(chunk);
      const ali = /^\s*aliases:\s*\[(.*)\]\s*$/m.exec(chunk);
      push(
        unquote(m[1]),
        def ? unquote(def[1]) : "",
        ali ? ali[1].split(",").map((s) => unquote(s)).filter(Boolean) : undefined,
      );
    }
  }

  const body = fm ? text.slice(fm[0].length) : text;
  const bulletRe = /^\s*[-*]\s+\*\*(.+?)\*\*\s*(?:—|--|–|:)\s*(.+)$/gm;
  let b: RegExpExecArray | null;
  while ((b = bulletRe.exec(body)) !== null) push(b[1], b[2]);

  return { schema_version: GLOSSARY_SCHEMA, terms };
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").trim();
}

/** Read one root's glossary. Missing file → an empty glossary, never a throw. */
export function readGlossaryAt(storage: GuildStorage, scope: "project" | "workspace"): Glossary {
  const paths = scope === "project" ? storage.project : storage.workspace;
  if (!paths) return { ...EMPTY, terms: [] };
  const file = paths.knowledge("glossary.md");
  try {
    if (!fs.existsSync(file)) return { ...EMPTY, terms: [] };
    const g = parseGlossary(fs.readFileSync(file, "utf8"));
    return { ...g, terms: g.terms.map((t) => ({ ...t, origin: scope })) };
  } catch {
    return { ...EMPTY, terms: [] };
  }
}

export interface ResolveGlossaryOptions {
  cwd?: string;
  storage?: GuildStorage;
}

/**
 * The effective glossary for this root: project overlaid on workspace, project
 * winning on the same term. Nothing is written back — the overlay is computed in
 * memory on every call, which is what keeps query-not-copy honest.
 */
export function resolveGlossary(opts: ResolveGlossaryOptions = {}): Glossary {
  const storage = opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());
  const workspace = readGlossaryAt(storage, "workspace");
  const project = readGlossaryAt(storage, "project");
  const byKey = new Map<string, GlossaryTerm>();
  for (const t of workspace.terms) byKey.set(t.term.toLowerCase(), t);
  for (const t of project.terms) byKey.set(t.term.toLowerCase(), t);
  return { schema_version: GLOSSARY_SCHEMA, terms: [...byKey.values()] };
}

function termMatches(text: string, t: GlossaryTerm): boolean {
  const needles = [t.term, ...(t.aliases ?? [])];
  return needles.some((n) => {
    const esc = n.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (esc === "") return false;
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, "i").test(text);
  });
}

export interface MatchedTerms {
  terms: Array<{ term: string; definition: string }>;
  /** Tokens the attached terms cost. Always ≤ GLOSSARY_TERM_TOKEN_CAP. */
  tokens: number;
  /** Terms that matched but did not fit the cap. */
  dropped: string[];
}

/**
 * Match a glossary against ONE assignment's text and return the definitions that
 * fit the 200-token cap.
 *
 * Longest term first: when "payment intent" and "payment" both match, the specific
 * one is the one the specialist needs, and it is the one that would be crowded out
 * by a cap filled with generic entries.
 */
export function matchTerms(
  assignmentText: string,
  glossary: Glossary,
  cap: number = GLOSSARY_TERM_TOKEN_CAP,
): MatchedTerms {
  const text = typeof assignmentText === "string" ? assignmentText.toLowerCase() : "";
  const hits = glossary.terms
    .filter((t) => termMatches(text, t))
    .sort((a, b) => b.term.length - a.term.length || a.term.localeCompare(b.term));

  const out: Array<{ term: string; definition: string }> = [];
  const dropped: string[] = [];
  let tokens = 0;
  for (const t of hits) {
    const entry = { term: t.term, definition: t.definition };
    const cost = Math.ceil(`${t.term}: ${t.definition}`.length / 4);
    if (tokens + cost > cap) {
      dropped.push(t.term);
      continue;
    }
    tokens += cost;
    out.push(entry);
  }
  return { terms: out, tokens, dropped };
}

/** The Terms chapter of a specialist's ≤6k on-disk bundle. Empty on no hits. */
export function renderTermsChapter(matched: MatchedTerms): string {
  if (matched.terms.length === 0) return "";
  const lines = matched.terms.map((t) => `- **${t.term}** — ${t.definition}`);
  return `## Terms\n\n${lines.join("\n")}\n`;
}
