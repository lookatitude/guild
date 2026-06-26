/**
 * learn/lib/resolved-call.ts — shared shape for G2 call resolution.
 *
 * A ResolvedCall is a caller→callee edge with provenance and a confidence tier:
 *   high   — type/import-resolved to a unique internal declaration (IDE-grade)
 *   medium — import not confirmed, but exactly one global definition matches
 *   low    — heuristic/ambiguous pick (kept, NOT dropped — see G2 gate item 3)
 */
export interface ResolvedCall {
  /** caller node id (function:<rel>:<name> | function:<rel>:<Class>.<method>) */
  from: string;
  /** callee node id (same id scheme) */
  to: string;
  confidence: "high" | "medium" | "low";
  /** true when caller and callee live in different files */
  crossFile: boolean;
  /** how the callee was referenced */
  kind: "function" | "method" | "dynamic";
  /** which resolver produced this (provenance) */
  backend: "ts-compiler" | "py-imports" | "g1-syntactic";
}
