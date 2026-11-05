/**
 * learn/lib/tsconfig-chain.ts — the tsconfig `extends` chain learn may read.
 *
 * K01: every config byte the resolver consumes must be bound into the source
 * basis. Each hop is a regular file inside the scanned worktree reached without
 * symlinks; package specifiers resolve only through node_modules inside the
 * worktree. Anything else (escape, symlink, missing, cycle, depth > 8) is an
 * unresolved input: never read, and it makes freshness unknown.
 */

import * as fs from "fs";
import * as path from "path";
import { readContainedFile } from "../../../src/domains/knowledge/source-basis";

export const TSCONFIG_MAX_DEPTH = 8;

export interface TsconfigHop {
  /** Worktree-relative POSIX path. */
  path: string;
  /** Parsed JSONC body. */
  json: Record<string, unknown>;
  /** Resolved `extends` targets, in declaration order (later ones override). */
  parents: TsconfigHop[];
}

export interface TsconfigChain {
  /** Root config first, then extended configs in resolution order. */
  hops: TsconfigHop[];
  /** `<from> -> <spec>: <reason>` for every extends that was not followed. */
  unresolved: string[];
  /**
   * Every worktree-relative path whose presence or bytes decided resolution:
   * candidates probed up to each hit and package.json files read. Bound into the
   * source basis (absent ones as null) so precedence changes move the basis.
   */
  probed: string[];
}

/** JSONC → JSON: drops a BOM, comments and trailing commas, never inside strings. */
export function parseJsonc(text: string): unknown {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Pass 1: strip comments, copying strings verbatim.
  let noComments = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
      noComments += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      noComments += "\n";
    } else if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      noComments += " ";
      i = end < 0 ? src.length : end + 1;
    } else {
      noComments += c;
    }
  }
  // Pass 2: drop a comma whose next non-space token closes an object/array.
  let out = "";
  for (let i = 0; i < noComments.length; i++) {
    const c = noComments[i];
    if (c === '"') {
      let j = i + 1;
      while (j < noComments.length && noComments[j] !== '"') j += noComments[j] === "\\" ? 2 : 1;
      out += noComments.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === ",") {
      let k = i + 1;
      while (k < noComments.length && /\s/.test(noComments[k])) k++;
      if (noComments[k] === "}" || noComments[k] === "]") continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

/** Normalize to a worktree-relative POSIX path, or null if it escapes the root. */
function contained(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

function entryPresent(root: string, rel: string): boolean {
  try {
    fs.lstatSync(path.join(root, rel));
    return true;
  } catch {
    return false;
  }
}

function readJson(root: string, rel: string): Record<string, unknown> | null {
  const bytes = readContainedFile(root, rel);
  if (!bytes) return null;
  try {
    const v = parseJsonc(bytes.toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Candidate files for an extends specifier, in TypeScript's lookup order. */
function candidates(root: string, fromRel: string, spec: string, probed: Set<string>): string[] | "escape" {
  const fromDir = path.join(root, path.posix.dirname(fromRel));
  const withJson = (p: string) => (p.endsWith(".json") ? [p] : [p, `${p}.json`]);
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec)) {
    const rels = withJson(path.resolve(fromDir, spec)).map((abs) => contained(root, abs));
    return rels.every((r) => r === null) ? "escape" : (rels.filter((r): r is string => r !== null));
  }
  // Package specifier: node_modules from the config's directory up to the root.
  // tsc order per node_modules dir: the file itself, then the package's
  // declared package.json#tsconfig, then <package>/tsconfig.json.
  const out: string[] = [];
  const push = (abs: string) => {
    const rel = contained(root, abs);
    if (rel) out.push(rel);
  };
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const base = path.join(dir, "node_modules", spec);
    for (const abs of withJson(base)) push(abs);
    const pkgRel = contained(root, path.join(base, "package.json"));
    if (pkgRel) probed.add(pkgRel);
    const pkg = pkgRel ? readJson(root, pkgRel) : null;
    if (pkg && typeof pkg.tsconfig === "string") push(path.join(base, pkg.tsconfig));
    push(path.join(base, "tsconfig.json"));
    if (contained(root, dir) === null) break; // reached the worktree root
  }
  return out;
}

export function loadTsconfigChain(root: string, rootConfig = "tsconfig.json"): TsconfigChain {
  const hops: TsconfigHop[] = [];
  const unresolved: string[] = [];
  const probedSet = new Set<string>();
  const done = (): TsconfigChain => ({ hops, unresolved, probed: [...probedSet].sort() });
  const byPath = new Map<string, TsconfigHop>();
  // Absent root config: nothing to resolve. Present but refused/malformed:
  // unresolved, so freshness stays unknown.
  probedSet.add(rootConfig);
  if (!entryPresent(root, rootConfig)) return done();
  if (!readContainedFile(root, rootConfig)) {
    unresolved.push(`${rootConfig}: not a contained regular file`);
    return done();
  }
  const first = readJson(root, rootConfig);
  if (!first) {
    unresolved.push(`${rootConfig}: unparseable`);
    return done();
  }
  const top: TsconfigHop = { path: rootConfig, json: first, parents: [] };
  hops.push(top);
  byPath.set(rootConfig, top);

  const visit = (from: TsconfigHop, stack: Set<string>): void => {
    const ext = from.json.extends;
    const specs = typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext.filter((s): s is string => typeof s === "string") : [];
    for (const spec of specs) {
      const tag = `${from.path} -> ${spec}`;
      if (stack.size > TSCONFIG_MAX_DEPTH) {
        unresolved.push(`${tag}: depth>${TSCONFIG_MAX_DEPTH}`);
        continue;
      }
      const cands = candidates(root, from.path, spec, probedSet);
      if (cands === "escape") {
        unresolved.push(`${tag}: outside worktree`);
        continue;
      }
      let hit: string | undefined;
      for (const rel of cands) {
        probedSet.add(rel);
        if (readContainedFile(root, rel) !== null) {
          hit = rel;
          break;
        }
      }
      if (!hit) {
        unresolved.push(`${tag}: not a contained regular file`);
        continue;
      }
      if (stack.has(hit)) {
        unresolved.push(`${tag}: cycle`);
        continue;
      }
      let hop = byPath.get(hit);
      if (!hop) {
        const json = readJson(root, hit);
        if (!json) {
          unresolved.push(`${tag}: unparseable`);
          continue;
        }
        hop = { path: hit, json, parents: [] };
        byPath.set(hit, hop);
        hops.push(hop);
        visit(hop, new Set([...stack, hit]));
      }
      from.parents.push(hop);
    }
  };
  visit(top, new Set([rootConfig]));
  return done();
}

/**
 * Effective `baseUrl` (worktree-relative) and `paths` for the chain, merged the
 * way tsc does: parents first (later extends override earlier), then own
 * options; `baseUrl` is relative to the config that declares it, and `paths`
 * without a `baseUrl` resolve against the declaring config's directory.
 */
export function effectiveAliasOptions(chain: TsconfigChain): { baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string } {
  const memo = new Map<TsconfigHop, { baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string }>();
  const eff = (hop: TsconfigHop): { baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string } => {
    const hit = memo.get(hop);
    if (hit) return hit;
    const out: { baseUrl?: string; paths?: Record<string, string[]>; pathsDir?: string } = {};
    for (const p of hop.parents) Object.assign(out, eff(p));
    const co = (hop.json.compilerOptions ?? {}) as Record<string, unknown>;
    if (typeof co.baseUrl === "string") out.baseUrl = path.posix.normalize(path.posix.join(path.posix.dirname(hop.path), co.baseUrl));
    if (co.paths && typeof co.paths === "object" && !Array.isArray(co.paths)) {
      out.paths = co.paths as Record<string, string[]>;
      out.pathsDir = path.posix.dirname(hop.path); // tsc: paths without baseUrl resolve here
    }
    memo.set(hop, out);
    return out;
  };
  return chain.hops.length ? eff(chain.hops[0]) : {};
}
