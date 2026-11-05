/**
 * privileged-actions.ts — the closed vocabulary that marks a workflow action as
 * release-like or privileged regardless of the effect label it was authored with.
 *
 * A compiled workflow node declares an `effect`, but the effect is the author's
 * claim. Its capabilities, role and output artifact types are what it can actually
 * do. A node granted `deploy` that calls itself `write` is a disguised release; a
 * node granted `grant-permissions` that calls itself `review` is a disguised
 * privileged operation. Lifecycle refuses both before path dominance is checked.
 *
 * Unambiguous roots match anywhere (`deployProd`, `prodrelease`); short words
 * that occur inside ordinary words match only as whole tokens, with camel-case
 * boundaries split first (`shipIt` is release-like, `membership` is not).
 */

/** Matched anywhere in a value: no ordinary word contains them by accident. */
export const RELEASE_LIKE_ROOTS = Object.freeze(["release", "publish", "deploy", "rollout"] as const);
/** Matched as whole tokens only: `ship` is inside `membership`, `merge` inside `emergency`. */
export const RELEASE_LIKE_TOKENS = Object.freeze(["ship", "merge", "promote"] as const);

export const PRIVILEGED_ROOTS = Object.freeze(["permission", "credential", "secret", "privilege", "sudo"] as const);
export const PRIVILEGED_TOKENS = Object.freeze(["grant", "grants", "admin"] as const);

export interface ActionClassification {
  /** Input values carrying a release-like root or token, sorted and unique. */
  release: string[];
  /** Input values carrying a privileged root or token, sorted and unique. */
  privileged: string[];
}

/** Split camel/Pascal-case boundaries before lower-casing, then on non-alphanumerics. */
function tokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hits(value: string, roots: readonly string[], whole: readonly string[]): boolean {
  const flat = value.toLowerCase();
  return roots.some((r) => flat.includes(r)) || tokens(value).some((t) => whole.includes(t));
}

/** Classify action identifiers (capabilities, role, artifact types). Pure. */
export function classifyActionTokens(values: readonly string[]): ActionClassification {
  const release = new Set<string>();
  const privileged = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    if (hits(v, RELEASE_LIKE_ROOTS, RELEASE_LIKE_TOKENS)) release.add(v);
    if (hits(v, PRIVILEGED_ROOTS, PRIVILEGED_TOKENS)) privileged.add(v);
  }
  return { release: [...release].sort(), privileged: [...privileged].sort() };
}
