/**
 * src/domains/distribution/domain-fold.ts
 *
 * The KTD36 fold, as data. Twelve domains (KTD1); `adapters` and `src/runtime`
 * are the host-projection trees and deliberately NOT a thirteenth domain.
 *
 * This map is the single source the domain-ownership check and the coverage
 * draft both read, so "which domain owns this module's exports" is answered in
 * one place instead of restated in prose.
 */

import { frozenList, sealMap } from "../kernel";

/** The closed twelve. A thirteenth entry is a failed review, not a new domain. */
export const DOMAIN_IDS: readonly string[] = frozenList([
  "config",
  "dispatch",
  "distribution",
  "evolve",
  "kernel",
  "knowledge",
  "lifecycle",
  "review",
  "security",
  "state",
  "teams",
  "telemetry",
]);

/** Host maps and the remaining host-runtime projection (KTD4). Not a domain. */
export const ADAPTER_TREE = "src/adapters" as const;

/** Every live `src/modules/<id>` and the tree its public exports folded into. */
export const MODULE_TO_DOMAIN: ReadonlyMap<string, string> = sealMap(
  [
    ["kernel", "kernel"],
    ["state", "state"],
    ["migrations", "state"],
    ["workspace", "state"],
    ["security", "security"],
    ["config", "config"],
    ["capability", "config"],
    ["prompting", "config"],
    ["lifecycle", "lifecycle"],
    ["initiatives", "lifecycle"],
    ["operations", "lifecycle"],
    ["loops", "lifecycle"],
    ["intake", "lifecycle"],
    ["documents", "lifecycle"],
    ["knowledge", "knowledge"],
    ["context", "knowledge"],
    ["learning", "knowledge"],
    ["teams", "teams"],
    ["specialists", "teams"],
    ["templates", "teams"],
    ["dispatch", "dispatch"],
    ["communication", "dispatch"],
    ["review", "review"],
    ["quality", "review"],
    ["evolution", "evolve"],
    ["evals", "evolve"],
    ["telemetry", "telemetry"],
    // Manifest-only module: the status dashboard launcher is a producer surface
    // (KTD66) whose read models belong with run telemetry. T01 proposed it; T12
    // ratifies it — the module owns host surfaces and no TypeScript of its own.
    ["dashboard", "telemetry"],
    ["distribution", "distribution"],
    ["docs-sync", "distribution"],
    // Not a domain: the host maps project into src/adapters (KTD1/KTD4).
    ["host-runtime", "adapters"],
  ],
  "MODULE_TO_DOMAIN",
);

/** Repo-relative tree a fold target lives in. */
export function domainTree(domain: string): string {
  return domain === "adapters" ? ADAPTER_TREE : `src/domains/${domain}`;
}

/** One domain's row in the `guild.coverage.v1` `domains[]` block. */
export interface DomainCoverageRow {
  id: string;
  tree: string;
  modules: string[];
  exports: number;
  /** Domain exports no module_export row claims. Non-empty is a failed review. */
  orphans: string[];
}

export interface DomainBijection {
  ok: boolean;
  rows: DomainCoverageRow[];
  orphans: number;
  /** Rows pointing at a symbol the domain index does not actually export. */
  missing: string[];
}

/**
 * KTD36 bijection: every `module:<m>#<name>` row names a symbol its domain index
 * really exports, and every domain export is claimed by at least one row. A hole
 * on either side means a module's public API did not survive the fold intact —
 * which is exactly the silent deletion KTD36 forbids.
 *
 * `claims` is `module_export` row id -> `domain:<id>#<name>` target.
 */
export function checkDomainBijection(
  surfaces: ReadonlyMap<string, ReadonlySet<string>>,
  foldedInto: ReadonlyMap<string, readonly string[]>,
  claims: Iterable<readonly [string, string]>,
): DomainBijection {
  const claimed = new Map<string, Set<string>>();
  const missing: string[] = [];
  for (const [rowId, target] of claims) {
    const m = /^domain:([^#]+)#(.+)$/.exec(target);
    if (!m) continue;
    const [, domain, name] = m;
    if (!surfaces.get(domain)?.has(name)) missing.push(`${rowId} -> ${target}`);
    let set = claimed.get(domain);
    if (!set) claimed.set(domain, (set = new Set()));
    set.add(name);
  }
  const rows = [...DOMAIN_IDS, "adapters"].map((id) => ({
    id,
    tree: domainTree(id),
    modules: [...(foldedInto.get(id) ?? [])].sort(),
    exports: surfaces.get(id)?.size ?? 0,
    orphans: [...(surfaces.get(id) ?? [])].filter((n) => !claimed.get(id)?.has(n)).sort(),
  }));
  const orphans = rows.reduce((total, row) => total + row.orphans.length, 0);
  return { ok: orphans === 0 && missing.length === 0, rows, orphans, missing };
}
