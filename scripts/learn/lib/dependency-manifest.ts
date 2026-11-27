/**
 * learn/lib/dependency-manifest.ts — K02: source-to-derived dependency manifest.
 *
 * Global resolution reads more than a file's own bytes: every path an import
 * probe tried (hit or miss), every symbol namespace a call/base name was looked
 * up in (empty, unique or competing), and the tsconfig alias table. The manifest
 * records those reads per source file so an incremental run can name every
 * UNCHANGED file whose resolver output a change can move, including through a
 * negative dependency (a probe that missed, a name that was absent or unique).
 *
 * The manifest never decides output. Structural output always comes from global
 * resolution; the manifest's invalidation set is checked against it
 * (`selective_equivalence`). Anything the manifest cannot vouch for (no prior
 * manifest, another resolver, an unreadable file, an unresolved tsconfig, a
 * changed alias table) makes the plan `global`.
 */

import { basisDigest, type Sha256 } from "../../../src/domains/knowledge/source-basis";
import { loadTsAliases } from "./import-map";
import { loadTsconfigChain } from "./tsconfig-chain";
import type { GraphEdge } from "./schema";
import type { FileBundle } from "./structural";

export const DEPENDENCY_MANIFEST_SCHEMA = "guild.structural_dependency_manifest.v1";
/** Bumped whenever resolution reads something the manifest does not record. */
export const RESOLVER_DEPENDENCY_VERSION = "structural-resolver.v1|imports+symbols+aliases";

export type DependencyState = "current_for_basis" | "unknown";

export interface FileDependencies {
  /** Bundle content hash the entry was derived from ("" = unreadable). */
  content_hash: string;
  /** Probed paths that were in the inventory (import targets). */
  resolved: string[];
  /** Probed paths that were absent: creating one can change resolution. */
  missing: string[];
  /** Namespace keys consulted (`fn:<name>`, `class:<name>`), present or not. */
  symbols: string[];
  /** Digest of the resolver-owned edges (imports/calls/inherits/implements) sourced here. */
  outputs: Sha256;
  state: DependencyState;
}

export interface DependencyManifest {
  schema: typeof DEPENDENCY_MANIFEST_SCHEMA;
  resolver: string;
  /** Digest of the tsconfig alias table the resolver used. */
  aliases: Sha256;
  /** Sorted file inventory resolution ran against. */
  inventory: string[];
  /** Namespace key → sorted competing ids. Absent key = no symbol. */
  namespaces: Record<string, string[]>;
  files: Record<string, FileDependencies>;
  /** Non-empty ⇒ some dependencies were not enumerated: selective invalidation is off. */
  unknown: string[];
}

/** Hooks global resolution calls while it reads. */
export interface ResolutionTrace {
  probe(importer: string, rel: string, present: boolean): void;
  symbol(from: string, key: string): void;
  output(owner: string, edge: GraphEdge): void;
}

export function aliasesDigest(repoRoot: string): Sha256 {
  return basisDigest(loadTsAliases(repoRoot));
}

/** Namespace tables global resolution builds from a bundle set. */
export function namespacesOf(bundles: readonly FileBundle[]): Record<string, string[]> {
  const ns = new Map<string, Set<string>>();
  const add = (k: string, id: string) => (ns.get(k) ?? ns.set(k, new Set()).get(k)!).add(id);
  for (const b of bundles) {
    if (!b.isCode) continue;
    for (const c of b.callables) add(`fn:${c.simpleName}`, c.id);
    for (const c of b.classes) add(`class:${c.simpleName}`, c.id);
  }
  const out: Record<string, string[]> = {};
  for (const k of [...ns.keys()].sort()) out[k] = [...ns.get(k)!].sort();
  return out;
}

/** Collects one resolution pass into a manifest. */
export function createManifestRecorder(repoRoot: string, bundles: readonly FileBundle[]): {
  trace: ResolutionTrace;
  finish(): DependencyManifest;
} {
  const probes = new Map<string, Map<string, boolean>>();
  const symbols = new Map<string, Set<string>>();
  const outputs = new Map<string, string[]>();
  const trace: ResolutionTrace = {
    probe(importer, rel, present) {
      (probes.get(importer) ?? probes.set(importer, new Map()).get(importer)!).set(rel, present);
    },
    symbol(from, key) {
      (symbols.get(from) ?? symbols.set(from, new Set()).get(from)!).add(key);
    },
    output(owner, e) {
      (outputs.get(owner) ?? outputs.set(owner, []).get(owner)!).push(JSON.stringify([e.type, e.source, e.target, e.weight, e.description ?? null]));
    },
  };
  const finish = (): DependencyManifest => {
    const files: Record<string, FileDependencies> = {};
    const unknown: string[] = [];
    const sorted = [...bundles].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    for (const b of sorted) {
      const p = probes.get(b.rel) ?? new Map<string, boolean>();
      const state: DependencyState = b.contentHash === "" ? "unknown" : "current_for_basis";
      if (state === "unknown") unknown.push(`${b.rel}: unreadable`);
      files[b.rel] = {
        content_hash: b.contentHash,
        resolved: [...p].filter(([, v]) => v).map(([k]) => k).sort(),
        missing: [...p].filter(([, v]) => !v).map(([k]) => k).sort(),
        symbols: [...(symbols.get(b.rel) ?? [])].sort(),
        outputs: basisDigest([...(outputs.get(b.rel) ?? [])].sort()),
        state,
      };
    }
    const tsconfig = loadTsconfigChain(repoRoot);
    for (const u of tsconfig.unresolved) unknown.push(`tsconfig: ${u}`);
    return {
      schema: DEPENDENCY_MANIFEST_SCHEMA,
      resolver: RESOLVER_DEPENDENCY_VERSION,
      aliases: aliasesDigest(repoRoot),
      inventory: sorted.map((b) => b.rel),
      namespaces: namespacesOf(sorted),
      files,
      unknown,
    };
  };
  return { trace, finish };
}

export type InvalidationPlan =
  | { mode: "global"; reason: string; affected_unchanged: string[]; reasons: Record<string, string[]> }
  | { mode: "selective"; reason: string; affected_unchanged: string[]; reasons: Record<string, string[]> };

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Shape check: a malformed prior manifest is no manifest. */
export function isDependencyManifest(v: unknown): v is DependencyManifest {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  if (m.schema !== DEPENDENCY_MANIFEST_SCHEMA || typeof m.resolver !== "string" || typeof m.aliases !== "string") return false;
  if (!isStrArr(m.inventory) || !isStrArr(m.unknown)) return false;
  if (!m.namespaces || typeof m.namespaces !== "object" || !Object.values(m.namespaces).every(isStrArr)) return false;
  if (!m.files || typeof m.files !== "object") return false;
  return Object.values(m.files as Record<string, unknown>).every((f) => {
    const e = f as Record<string, unknown> | null;
    return !!e && typeof e.content_hash === "string" && isStrArr(e.resolved) && isStrArr(e.missing) && isStrArr(e.symbols) && typeof e.outputs === "string" && (e.state === "current_for_basis" || e.state === "unknown");
  });
}

const global = (reason: string): InvalidationPlan => ({ mode: "global", reason, affected_unchanged: [], reasons: {} });

/**
 * Unchanged files whose resolver output `next` can move, from the reads the
 * prior pass recorded. `global` whenever the prior reads cannot be trusted.
 */
export function planInvalidation(repoRoot: string, prev: unknown, next: readonly FileBundle[]): InvalidationPlan {
  if (prev === null || prev === undefined) return global("no prior dependency manifest");
  if (!isDependencyManifest(prev)) return global("prior dependency manifest malformed");
  if (prev.resolver !== RESOLVER_DEPENDENCY_VERSION) return global(`resolver changed (${prev.resolver})`);
  if (prev.unknown.length > 0) return global(`prior manifest has unknown dependencies: ${prev.unknown[0]}`);
  const tsconfig = loadTsconfigChain(repoRoot);
  if (tsconfig.unresolved.length > 0) return global(`tsconfig unresolved: ${tsconfig.unresolved[0]}`);
  if (prev.aliases !== aliasesDigest(repoRoot)) return global("alias table changed");
  if (next.some((b) => b.contentHash === "")) return global("unreadable file in the current inventory");

  const nextInv = new Set(next.map((b) => b.rel));
  const nextNs = namespacesOf(next);
  const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
    (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === (b ?? [])[i]);

  const reasons: Record<string, string[]> = {};
  for (const b of next) {
    const f = Object.prototype.hasOwnProperty.call(prev.files, b.rel) ? prev.files[b.rel] : undefined;
    if (!f || f.content_hash !== b.contentHash) continue; // changed/new: re-parsed anyway
    const why: string[] = [];
    for (const p of f.missing) if (nextInv.has(p)) why.push(`missing:${p}`);
    for (const p of f.resolved) if (!nextInv.has(p)) why.push(`removed:${p}`);
    for (const k of f.symbols) {
      const before = Object.prototype.hasOwnProperty.call(prev.namespaces, k) ? prev.namespaces[k] : undefined;
      const after = Object.prototype.hasOwnProperty.call(nextNs, k) ? nextNs[k] : undefined;
      if (!same(before, after)) why.push(`symbol:${k}`);
    }
    if (why.length) reasons[b.rel] = why;
  }
  return { mode: "selective", reason: "prior manifest covers every resolver read", affected_unchanged: Object.keys(reasons).sort(), reasons };
}

export type SelectiveEquivalence = "proven" | "violated" | "not_attempted";

/**
 * Compare the plan with the global result: every unchanged file the plan left
 * out must have identical resolver output. `violated` lists the misses.
 */
export function checkSelectiveEquivalence(
  plan: InvalidationPlan,
  prev: unknown,
  next: DependencyManifest,
): { selective_equivalence: SelectiveEquivalence; violations: string[] } {
  if (plan.mode !== "selective" || !isDependencyManifest(prev)) return { selective_equivalence: "not_attempted", violations: [] };
  const affected = new Set(plan.affected_unchanged);
  const violations: string[] = [];
  for (const [rel, f] of Object.entries(next.files)) {
    const p = Object.prototype.hasOwnProperty.call(prev.files, rel) ? prev.files[rel] : undefined;
    if (!p || p.content_hash !== f.content_hash || affected.has(rel)) continue;
    if (p.outputs !== f.outputs) violations.push(rel);
  }
  return { selective_equivalence: violations.length ? "violated" : "proven", violations: violations.sort() };
}
