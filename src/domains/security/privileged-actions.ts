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
 * Matching is by whole token (split on non-alphanumerics, lower-cased), so
 * `release-notes` is release-like but `unreleased` is not.
 */

export const RELEASE_LIKE_TOKENS = Object.freeze([
  "release", "releases", "publish", "deploy", "deployment", "ship", "merge", "promote", "rollout",
] as const);

export const PRIVILEGED_TOKENS = Object.freeze([
  "permission", "permissions", "grant", "grants", "secret", "secrets", "credential", "credentials",
  "admin", "sudo", "privilege", "privileged",
] as const);

export interface ActionClassification {
  /** Input values carrying a release-like token, sorted and unique. */
  release: string[];
  /** Input values carrying a privileged token, sorted and unique. */
  privileged: string[];
}

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Classify action identifiers (capabilities, role, artifact types). Pure. */
export function classifyActionTokens(values: readonly string[]): ActionClassification {
  const release = new Set<string>();
  const privileged = new Set<string>();
  for (const v of values) {
    if (typeof v !== "string") continue;
    const t = tokens(v);
    if (t.some((x) => (RELEASE_LIKE_TOKENS as readonly string[]).includes(x))) release.add(v);
    if (t.some((x) => (PRIVILEGED_TOKENS as readonly string[]).includes(x))) privileged.add(v);
  }
  return { release: [...release].sort(), privileged: [...privileged].sort() };
}
