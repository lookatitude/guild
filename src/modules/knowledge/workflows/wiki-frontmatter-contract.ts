/**
 * src/modules/knowledge/workflows/wiki-frontmatter-contract.ts
 *
 * The canonical §10.1.1 wiki-page frontmatter field vocabulary, as typed
 * constants — the single source of truth every wiki-page reader/writer/
 * linter should import instead of re-spelling the field names or the closed
 * enum values by hand.
 *
 * Canonical authority (bind by pointer, do not re-derive elsewhere):
 *   guild-plan.md §10.1.1 "Required page frontmatter" — the field list + the
 *   closed enums for `type`, `confidence`, `sensitivity`.
 *   guild-plan.md §10.2 "Knowledge categorization — what goes where" — the
 *   type → wiki-directory mapping (WIKI_TYPE_TO_DIR below).
 *
 * Every durable wiki page carries this frontmatter:
 *   type: context | standard | product | entity | concept | decision | source
 *   owner: role/specialist slug that authored the page (open — no closed enum;
 *          §10.1.1 gives illustrative examples only, "orchestrator | architect |
 *          backend | copywriter | ...")
 *   confidence: low | medium | high
 *   source_refs: string[] (inline flow list or block list — citations/links)
 *   created_at: RFC3339/date string
 *   updated_at: RFC3339/date string
 *   expires_at: null | RFC3339/date string
 *   supersedes: null | string (path of the page this one replaces)
 *   sensitivity: public | internal | confidential | secret
 *
 * Consumers (as of this module's introduction, plugin-audit-remediation G9):
 *   - mcp-servers/guild-memory/src/index.ts — types WikiFrontmatter.type
 *     against WikiPageType instead of a loose `string`.
 *   - src/modules/docs-sync/workflows/wiki-lint-checks.ts — the new
 *     `invalid-type` mechanical check (a page whose `type:` is present but
 *     not in WIKI_PAGE_TYPES is flagged, mirroring the existing
 *     `invalid-category` knowledge-node check's shape).
 *
 * `owner`, `source_refs`, `created_at`, `updated_at`, `expires_at`, and
 * `supersedes` are intentionally NOT closed enums (free-form role slugs,
 * citation lists, and dates/paths) — only `type`, `confidence`, and
 * `sensitivity` have a validatable closed vocabulary, per §10.1.1.
 *
 * Pure data module: no I/O, no runtime dependencies.
 */

// ── type: ─────────────────────────────────────────────────────────────────────

export const WIKI_PAGE_TYPES = Object.freeze([
  "context",
  "standard",
  "product",
  "entity",
  "concept",
  "decision",
  "source",
] as const);

export type WikiPageType = (typeof WIKI_PAGE_TYPES)[number];

export function isWikiPageType(v: unknown): v is WikiPageType {
  return typeof v === "string" && (WIKI_PAGE_TYPES as readonly string[]).includes(v);
}

/**
 * §10.2's type → wiki-directory mapping. Directory names are the plural form
 * of their type EXCEPT "context", which stays singular as a directory too
 * (there is one context/ tree, not many "contexts").
 */
export const WIKI_TYPE_TO_DIR: Readonly<Record<WikiPageType, string>> = {
  context: "context",
  standard: "standards",
  product: "products",
  entity: "entities",
  concept: "concepts",
  decision: "decisions",
  source: "sources",
};

// ── confidence: ────────────────────────────────────────────────────────────────

export const WIKI_CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"] as const);
export type WikiConfidenceLevel = (typeof WIKI_CONFIDENCE_LEVELS)[number];

export function isWikiConfidenceLevel(v: unknown): v is WikiConfidenceLevel {
  return typeof v === "string" && (WIKI_CONFIDENCE_LEVELS as readonly string[]).includes(v);
}

// ── sensitivity: ───────────────────────────────────────────────────────────────

export const WIKI_SENSITIVITY_LEVELS = Object.freeze(["public", "internal", "confidential", "secret"] as const);
export type WikiSensitivityLevel = (typeof WIKI_SENSITIVITY_LEVELS)[number];

export function isWikiSensitivityLevel(v: unknown): v is WikiSensitivityLevel {
  return typeof v === "string" && (WIKI_SENSITIVITY_LEVELS as readonly string[]).includes(v);
}

// ── The full field-name vocabulary (documentation / drift-guard use) ──────────

/** Every §10.1.1 required-frontmatter field name, in the canonical order. */
export const WIKI_FRONTMATTER_FIELDS = Object.freeze([
  "type",
  "owner",
  "confidence",
  "source_refs",
  "created_at",
  "updated_at",
  "expires_at",
  "supersedes",
  "sensitivity",
] as const);

export type WikiFrontmatterField = (typeof WIKI_FRONTMATTER_FIELDS)[number];
