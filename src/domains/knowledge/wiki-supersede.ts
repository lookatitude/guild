/**
 * src/domains/knowledge/wiki-supersede.ts
 *
 * G12 R6 — which wiki pages are superseded, so recall never returns them.
 *
 * A page is superseded when:
 *   - its own frontmatter carries `status: superseded`, or
 *   - another page names it in `supersedes:` (scalar or list). A reference may be
 *     the wiki-relative path (`decisions/x.md`), that path without `.md`, a
 *     `.guild/wiki/`-prefixed path, or a bare slug / `decision:<slug>`. A bare
 *     slug resolves only when exactly one page carries that basename — an
 *     ambiguous slug drops nothing.
 *
 * A page never supersedes itself. `supersedes: null` is the contract's "replaces
 * nothing" value. Returns absolute paths.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../state";

function walkMd(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
}

function refsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter((v) => v !== "" && v !== "null");
}

export function supersededWikiPages(wikiDir: string): Set<string> {
  const files: string[] = [];
  walkMd(wikiDir, files);
  const superseded = new Set<string>();
  if (files.length === 0) return superseded;

  const byRel = new Map<string, string>();
  const bySlug = new Map<string, string[]>();
  for (const abs of files) {
    const rel = path.relative(wikiDir, abs).split(path.sep).join("/");
    byRel.set(rel, abs);
    byRel.set(rel.slice(0, -3), abs);
    const slug = path.basename(abs, ".md");
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), abs]);
  }

  const resolve = (ref: string): string | undefined => {
    let r = ref.replace(/\\/g, "/").replace(/^decision:/, "").replace(/^\.\//, "");
    r = r.replace(/^\.guild\/wiki\//, "").replace(/^wiki\//, "");
    const hit = byRel.get(r);
    if (hit) return hit;
    if (r.includes("/")) return undefined;
    const slugHits = bySlug.get(r.replace(/\.md$/, ""));
    return slugHits?.length === 1 ? slugHits[0] : undefined;
  };

  for (const abs of files) {
    let content: string;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(content);
    if (!fm) continue;
    if (typeof fm["status"] === "string" && fm["status"].trim().toLowerCase() === "superseded") {
      superseded.add(abs);
    }
    for (const ref of refsOf(fm["supersedes"])) {
      const target = resolve(ref);
      if (target && target !== abs) superseded.add(target);
    }
  }
  return superseded;
}
