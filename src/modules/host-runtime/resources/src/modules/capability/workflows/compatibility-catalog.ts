/**
 * src/modules/capability/workflows/compatibility-catalog.ts
 *
 * THE COMPATIBILITY CATALOG — `guild.compatibility_catalog.v1`.
 *
 * Closes audit gap D7. The finding was specific and worth restating, because it
 * is what shapes this file: the plan described a "frozen catalog" of the shipped
 * surface, but nothing enumerated it, nothing marked it deprecated, and nothing
 * stopped a migrated project from being offered a shipped template as a fresh
 * suggestion — *"the opposite of a frozen catalog"*.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * A READ-ONLY enumeration of the 73 shipped compatibility assets:
 *
 *     15  specialist TYPE templates   <pluginRoot>/templates/specialists/*.md
 *     58  domain skills               <pluginRoot>/skills/specialists/<id>/SKILL.md
 *
 * Each entry carries its canonical id, its plugin-relative path, the sha256 of
 * the bytes on disk, and a DEPRECATION MARKER. D03 is explicit that the markers
 * land at the START of the observe phase, not at removal, so consumers get the
 * whole window of warning.
 *
 * ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * It never writes. It never mutates a shipped file. It is not a resolver — it
 * tells you what the compatibility surface CONTAINS; `resolver-mode.ts` decides
 * whether a given mode may read it. Keeping those apart is what stops "the asset
 * exists" from drifting into "the asset may be used".
 *
 * ── THE SUGGESTION EXCLUSION ────────────────────────────────────────────────
 * `suggestableAssets()` is the D7 rule made executable: once a project has
 * migrated (it has an adoption manifest, or its resolver mode has passed the
 * legacy-authoritative rungs), NO catalog entry may be offered as a new
 * capability suggestion. The catalog remains READABLE — replay and rollback need
 * it for the whole v2 major, per D03 — but it stops being a menu.
 *
 * ── THE G5 EMISSION SEAM ────────────────────────────────────────────────────
 * `compatibilityUsageForRead()` turns one catalog read into a validated
 * `guild.compatibility_usage.v1` payload, routing the (mode, intent) → reason
 * decision through `classifyCompatibilityRead` so the counting rule has exactly
 * one definition. It returns the PAYLOAD; durability, ordering and hashing stay
 * with the MH-06 receipt journal, which S8 is explicit about not duplicating.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { types as nodeTypes } from "util";

import {
  COMPATIBILITY_USAGE_SCHEMA,
  parseCompatibilityUsageV1,
  type CompatibilityAssetKind,
  type CompatibilityUsageV1,
} from "./compatibility-usage";
import {
  classifyCompatibilityRead,
  type CapabilityResolutionIntent,
  type ResolverModeFailure,
} from "./resolver-mode";
import type { CapabilityResolverMode } from "../../config";

// ---------------------------------------------------------------------------
// Identity + the shipped-surface census
// ---------------------------------------------------------------------------

export const COMPATIBILITY_CATALOG_SCHEMA = "guild.compatibility_catalog.v1" as const;

/**
 * The expected census of the shipped compatibility surface.
 *
 * Asserted, not assumed: `buildCompatibilityCatalog` reports the real counts and
 * a `census_matches` flag rather than silently trusting these numbers. A catalog
 * that under-enumerates would make G5's "required_asset_ids" short, and a short
 * required set is a removal gate that passes over assets nobody instrumented.
 */
export const SHIPPED_TEMPLATE_COUNT = 15;
export const SHIPPED_DOMAIN_SKILL_COUNT = 58;
export const SHIPPED_COMPATIBILITY_ASSET_COUNT =
  SHIPPED_TEMPLATE_COUNT + SHIPPED_DOMAIN_SKILL_COUNT;

/** Where each kind lives, relative to the plugin install root. */
export const COMPATIBILITY_ASSET_ROOTS: Readonly<Record<CompatibilityAssetKind, string>> =
  Object.freeze({
    shipped_template: "templates/specialists",
    shipped_domain_skill: "skills/specialists",
  });

/**
 * Deprecation status of a catalog entry.
 *
 * `deprecated` is the state D03 puts the whole surface into at the start of the
 * observe phase. `removal_cleared` is set ONLY by a passing G5 verdict — never by
 * this file, and never by elapsed time.
 */
export const COMPATIBILITY_DEPRECATION_STATES = Object.freeze([
  "active",
  "deprecated",
  "removal_cleared",
] as const);
export type CompatibilityDeprecationState =
  (typeof COMPATIBILITY_DEPRECATION_STATES)[number];

const DEPRECATION_STATE_SET: ReadonlySet<string> = new Set(COMPATIBILITY_DEPRECATION_STATES);

// ---------------------------------------------------------------------------
// Hardening primitives (same idiom as the sibling contracts)
// ---------------------------------------------------------------------------

const MAX_SCALAR_LEN = 1024;
const MAX_ID_LEN = 128;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CANONICAL_ID = /^[a-z0-9][a-z0-9._-]*$/;

function isCanonicalId(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_ID_LEN &&
    !CONTROL_CHARS.test(v) &&
    CANONICAL_ID.test(v)
  );
}

function readOptions(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (nodeTypes.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowedKeys.includes(key)) return null;
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (!desc || !("value" in desc)) return null;
    out[key] = desc.value;
  }
  return out;
}

function readArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || nodeTypes.isProxy(value)) return null;
  const lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lenDesc ||
    !("value" in lenDesc) ||
    typeof lenDesc.value !== "number" ||
    !Number.isSafeInteger(lenDesc.value) ||
    lenDesc.value < 0
  ) {
    return null;
  }
  const out: unknown[] = [];
  for (let i = 0; i < lenDesc.value; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !("value" in d)) return null; // hole or accessor
    out.push(d.value);
  }
  return out;
}

/** POSIX-spelled, plugin-relative, canonical. The one spelling a catalog path has. */
function toCanonicalRelPath(absPath: string, root: string): string | null {
  const rel = path.relative(root, absPath);
  if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  if (posix.length > MAX_SCALAR_LEN || CONTROL_CHARS.test(posix)) return null;
  for (const seg of posix.split("/")) {
    if (seg.length === 0 || seg === "." || seg === "..") return null;
  }
  return posix;
}

/** Bare 64-hex sha256 — the catalog's content_hash spelling. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Describe an untrusted value for an error message WITHOUT throwing.
 * CODEX #13: `JSON.stringify` throws on a BigInt and on a cyclic object, so the
 * error path was the one path that could crash a module claiming it never throws.
 */
function describe(v: unknown): string {
  try {
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "string") return v.length > 120 ? `"${v.slice(0, 117)}..."` : `"${v}"`;
    if (typeof v === "symbol") return "Symbol()";
    if (typeof v === "function") return "[function]";
    if (v === null) return "null";
    if (typeof v === "object") return Array.isArray(v) ? "[array]" : "[object]";
    return String(v);
  } catch {
    return "[unprintable]";
  }
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

export interface CompatibilityCatalogEntry {
  readonly kind: CompatibilityAssetKind;
  /** Canonical id: template role slug, or domain-skill directory name. */
  readonly id: string;
  /** Plugin-install-relative, POSIX-spelled. */
  readonly path: string;
  /** Bare 64-hex sha256 of the bytes on disk — the S8 `content_hash` spelling. */
  readonly content_hash: string;
  readonly deprecation: CompatibilityDeprecationState;
  /**
   * The decision record that put this entry into its deprecation state, or null
   * while `active`. A deprecation with no authority is a rumour.
   */
  readonly deprecated_by: string | null;
}

export interface CompatibilityCatalog {
  readonly schema_version: typeof COMPATIBILITY_CATALOG_SCHEMA;
  /** Sorted by (kind, id) — deterministic, so two builds diff cleanly. */
  readonly entries: readonly CompatibilityCatalogEntry[];
  readonly template_count: number;
  readonly domain_skill_count: number;
  /**
   * Whether the enumerated counts match the expected census. FALSE is not fatal
   * here — it is REPORTED, so the caller (and G5's required-asset set) can refuse
   * to treat a short enumeration as complete.
   */
  readonly census_matches: boolean;
  /** Unreadable or non-canonical entries, named rather than skipped. */
  readonly problems: readonly string[];
}

/** An empty, well-formed catalog carrying the reason it is empty. */
function emptyCatalog(problem: string): CompatibilityCatalog {
  return Object.freeze({
    schema_version: COMPATIBILITY_CATALOG_SCHEMA,
    entries: Object.freeze([] as CompatibilityCatalogEntry[]),
    template_count: 0,
    domain_skill_count: 0,
    census_matches: false,
    problems: Object.freeze([problem]),
  });
}

const BUILD_KEYS = ["pluginRoot", "deprecation", "deprecatedBy"] as const;

/**
 * Enumerate the shipped compatibility surface. READ-ONLY: opens files, writes
 * nothing, and never mutates what it reads.
 *
 * `deprecation` is supplied by the CALLER rather than inferred, because the state
 * is a migration-window fact (D03 puts the surface into `deprecated` at the start
 * of observe) and not a property of the bytes. Defaulting it here would let the
 * catalog assert a lifecycle position it has no way to know.
 *
 * A file that cannot be read, or whose name is not a canonical id, is recorded in
 * `problems` AND excluded — never silently skipped into a shorter census. The
 * `census_matches` flag is how a caller tells "58 skills" from "58 skills minus
 * the three I could not read".
 */
export function buildCompatibilityCatalog(opts: unknown): CompatibilityCatalog {
  const o = readOptions(opts, BUILD_KEYS);
  if (o === null) {
    return emptyCatalog("options object rejected (proxy/accessor/symbol/unknown key)");
  }

  const pluginRoot = o["pluginRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0 || CONTROL_CHARS.test(pluginRoot)) {
    return emptyCatalog("pluginRoot must be a non-empty, control-character-free path");
  }

  const deprecationRaw = o["deprecation"] ?? "active";
  if (typeof deprecationRaw !== "string" || !DEPRECATION_STATE_SET.has(deprecationRaw)) {
    return emptyCatalog(`not a deprecation state: ${describe(deprecationRaw)}`);
  }
  const deprecation = deprecationRaw as CompatibilityDeprecationState;

  const deprecatedByRaw = o["deprecatedBy"] ?? null;
  if (
    deprecatedByRaw !== null &&
    (typeof deprecatedByRaw !== "string" ||
      deprecatedByRaw.length === 0 ||
      deprecatedByRaw.length > MAX_ID_LEN ||
      CONTROL_CHARS.test(deprecatedByRaw))
  ) {
    return emptyCatalog("deprecatedBy must be null or a bounded, control-character-free token");
  }
  // A deprecated entry with no authorizing record is refused outright: the marker
  // is what a consumer acts on, and an unattributable marker cannot be argued with.
  if (deprecation !== "active" && deprecatedByRaw === null) {
    return emptyCatalog(`deprecation "${deprecation}" requires a deprecatedBy decision record`);
  }
  const deprecatedBy = deprecatedByRaw as string | null;

  const root = path.resolve(pluginRoot);
  const problems: string[] = [];
  const entries: CompatibilityCatalogEntry[] = [];

  const push = (kind: CompatibilityAssetKind, id: string, abs: string): void => {
    const rel = toCanonicalRelPath(abs, root);
    if (rel === null) {
      problems.push(`${kind} "${id}": path is not canonical plugin-relative (${abs})`);
      return;
    }
    let bytes: Buffer;
    try {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        // A symlinked catalog entry could point outside the install tree, so its
        // hash would not describe the shipped bytes at all.
        problems.push(`${kind} "${id}": symlink, refusing to catalog`);
        return;
      }
      if (!st.isFile()) {
        problems.push(`${kind} "${id}": not a regular file`);
        return;
      }
      bytes = fs.readFileSync(abs);
    } catch (err) {
      problems.push(`${kind} "${id}": unreadable (${(err as Error).message})`);
      return;
    }
    entries.push(
      Object.freeze({
        kind,
        id,
        path: rel,
        content_hash: crypto.createHash("sha256").update(bytes).digest("hex"),
        deprecation,
        deprecated_by: deprecatedBy,
      }),
    );
  };

  // ── Templates: one .md per specialist TYPE ──
  const templateDir = path.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_template);
  try {
    for (const e of fs.readdirSync(templateDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      const id = e.name.slice(0, -3);
      if (!isCanonicalId(id)) {
        problems.push(`shipped_template "${e.name}": file stem is not a canonical id`);
        continue;
      }
      push("shipped_template", id, path.join(templateDir, e.name));
    }
  } catch (err) {
    problems.push(`templates/specialists unreadable (${(err as Error).message})`);
  }

  // ── Domain skills: one directory per skill, holding SKILL.md ──
  const skillDir = path.join(root, COMPATIBILITY_ASSET_ROOTS.shipped_domain_skill);
  try {
    for (const e of fs.readdirSync(skillDir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (!e.isDirectory()) continue;
      if (!isCanonicalId(e.name)) {
        problems.push(`shipped_domain_skill "${e.name}": directory name is not a canonical id`);
        continue;
      }
      push("shipped_domain_skill", e.name, path.join(skillDir, e.name, "SKILL.md"));
    }
  } catch (err) {
    problems.push(`skills/specialists unreadable (${(err as Error).message})`);
  }

  entries.sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const templateCount = entries.filter((e) => e.kind === "shipped_template").length;
  const skillCount = entries.filter((e) => e.kind === "shipped_domain_skill").length;

  return Object.freeze({
    schema_version: COMPATIBILITY_CATALOG_SCHEMA,
    entries: Object.freeze(entries),
    template_count: templateCount,
    domain_skill_count: skillCount,
    census_matches:
      problems.length === 0 &&
      templateCount === SHIPPED_TEMPLATE_COUNT &&
      skillCount === SHIPPED_DOMAIN_SKILL_COUNT,
    problems: Object.freeze(problems),
  });
}

// ---------------------------------------------------------------------------
// The suggestion exclusion (the D7 rule)
// ---------------------------------------------------------------------------

/**
 * DISCRIMINATED BY A STRING. See the note on `CompatibilityReadClassification` —
 * the repo transpiles non-strict, where a boolean discriminant does not narrow and
 * a consumer silently loses the refusal arm.
 */
const ENTRY_KEYS = [
  "kind",
  "id",
  "path",
  "content_hash",
  "deprecation",
  "deprecated_by",
] as const;

/**
 * Validate ONE catalog entry completely, returning a FRESH frozen copy or null.
 *
 * CODEX #9: `suggestableAssets` checked only `id` and `deprecation`, so an entry
 * carrying `kind:"not-a-kind"`, `path:"../../outside"` and a non-hash
 * `content_hash` was returned to the caller as a usable suggestion — a traversing
 * path handed out by the very function that decides what may be adopted.
 * CODEX #4: the same gap let `requiredAssetIdsForG5` accept a forged catalog.
 * ONE validator now serves both, so the two can never disagree about what a
 * well-formed entry is.
 *
 * Returns a FRESH copy rather than freezing the caller's object: freezing an input
 * is a side effect on someone else's data, and returning the caller's object keeps
 * a mutable alias to a value we just validated (a time-of-check/time-of-use gap).
 */
export function readCatalogEntry(raw: unknown): CompatibilityCatalogEntry | null {
  const e = readOptions(raw, ENTRY_KEYS);
  if (e === null) return null;
  const kind = e["kind"];
  if (kind !== "shipped_template" && kind !== "shipped_domain_skill") return null;
  const id = e["id"];
  if (!isCanonicalId(id)) return null;
  const p = e["path"];
  if (typeof p !== "string" || !isCanonicalCatalogPath(p)) return null;
  const hash = e["content_hash"];
  if (typeof hash !== "string" || !SHA256_HEX.test(hash)) return null;
  const dep = e["deprecation"];
  if (typeof dep !== "string" || !DEPRECATION_STATE_SET.has(dep)) return null;
  const by = e["deprecated_by"];
  if (by !== null && (typeof by !== "string" || by.length === 0 || by.length > MAX_ID_LEN || CONTROL_CHARS.test(by))) {
    return null;
  }
  // The same rule the builder enforces: a non-active marker with no authorizing
  // record is unattributable, and an unattributable deprecation cannot be argued with.
  if (dep !== "active" && by === null) return null;
  return Object.freeze({
    kind: kind as CompatibilityAssetKind,
    id,
    path: p,
    content_hash: hash,
    deprecation: dep as CompatibilityDeprecationState,
    deprecated_by: by as string | null,
  });
}

/** A canonical, plugin-relative catalog path. Rejected, never normalized. */
function isCanonicalCatalogPath(v: string): boolean {
  if (v.length === 0 || v.length > MAX_SCALAR_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false;
  if (/^[A-Za-z]:/.test(v)) return false;
  if (v.startsWith("/")) return false;
  if (v.endsWith("/")) return false;
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false;
    if (seg === "." || seg === "..") return false;
    if (/[. ]$/.test(seg)) return false; // Windows trailing-dot/space alias
  }
  return true;
}

export type SuggestableAssets =
  | { readonly status: "ok"; readonly entries: readonly CompatibilityCatalogEntry[] }
  | { readonly status: "refused"; readonly failure: ResolverModeFailure; readonly detail: string };

const SUGGESTABLE_KEYS = ["catalog", "project_migrated"] as const;

/**
 * Which catalog entries may be offered as NEW capability suggestions.
 *
 * The D7 rule: once a project has migrated, the answer is NONE. Not "the
 * non-deprecated ones", not "the ones with no local equivalent" — none. A
 * migrated project's capability suggestions come from its own profile; offering
 * it a shipped template would re-seed the exact dependence the migration removed,
 * and would keep G5's dependence count permanently above zero.
 *
 * The catalog itself stays readable — replay and rollback need it for the whole
 * v2 major (D03). This function governs the MENU, not the archive.
 *
 * `project_migrated` is a caller-supplied FACT (an adoption manifest exists, or
 * the resolver mode has passed the legacy-authoritative rungs), not something
 * inferred here. Inferring it would put a migration-state heuristic inside a
 * read-only enumerator.
 */
export function suggestableAssets(request: unknown): SuggestableAssets {
  const o = readOptions(request, SUGGESTABLE_KEYS);
  if (o === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "request rejected (proxy/accessor/symbol/unknown key)",
    };
  }
  const migrated = o["project_migrated"];
  if (typeof migrated !== "boolean") {
    return {
      status: "refused",
      failure: "invalid_request",
      // Not defaulted to `false`: a missing flag reading as "not migrated" would
      // silently re-open the menu on exactly the projects the rule protects.
      detail: "project_migrated must be an explicit boolean",
    };
  }

  const catalog = o["catalog"];
  const catalogOpts = readOptions(catalog, [
    "schema_version",
    "entries",
    "template_count",
    "domain_skill_count",
    "census_matches",
    "problems",
  ]);
  if (catalogOpts === null || catalogOpts["schema_version"] !== COMPATIBILITY_CATALOG_SCHEMA) {
    return { status: "refused", failure: "invalid_request", detail: "catalog is not a guild.compatibility_catalog.v1" };
  }
  const rawEntries = readArray(catalogOpts["entries"]);
  if (rawEntries === null) {
    return { status: "refused", failure: "invalid_request", detail: "catalog.entries is not a dense plain array" };
  }

  if (migrated) return { status: "ok", entries: Object.freeze([]) };

  const out: CompatibilityCatalogEntry[] = [];
  for (const raw of rawEntries) {
    // FULLY validated (CODEX #9). A malformed entry REJECTS the whole answer
    // rather than being skipped: skipping until a well-formed one matches is
    // accept-by-attrition, and here it would silently shrink the menu without
    // saying so.
    const entry = readCatalogEntry(raw);
    if (entry === null) {
      return {
        status: "refused",
        failure: "invalid_request",
        detail: "catalog contains an entry that is not a well-formed guild.compatibility_catalog.v1 entry",
      };
    }
    // An un-migrated project may still be offered ACTIVE entries only. A
    // `deprecated` entry is one D03 has already told consumers to stop adopting.
    if (entry.deprecation !== "active") continue;
    out.push(entry);
  }
  return { status: "ok", entries: Object.freeze(out) };
}

// ---------------------------------------------------------------------------
// The G5 emission seam
// ---------------------------------------------------------------------------

export type CompatibilityUsageEmission =
  | { readonly status: "ok"; readonly payload: CompatibilityUsageV1 }
  | { readonly status: "refused"; readonly failure: ResolverModeFailure; readonly detail: string };

const EMISSION_KEYS = ["entry", "mode", "intent", "synthetic", "specialist_id"] as const;

/**
 * Turn ONE catalog read into a validated `guild.compatibility_usage.v1` payload.
 *
 * This is the wiring gap-audit F4 named: G5 depended on telemetry nothing
 * emitted. S8 supplied the payload type and the rollup; this supplies the point
 * where a real read becomes a real record.
 *
 * Three properties are deliberate:
 *
 *   1. the reason comes from `classifyCompatibilityRead`, never from the caller —
 *      the counting rule has ONE definition, and a call site cannot label its own
 *      dependence read as benign;
 *   2. `synthetic` is REQUIRED and explicit, per S8 invariant 3 — it is set at the
 *      emission point because G5's criterion is "zero NON-TEST reads", and a
 *      filter applied downstream is a filter that can be wrong;
 *   3. the result is round-tripped through `parseCompatibilityUsageV1` before it
 *      is returned, so a payload this function builds can never be one the rollup
 *      later rejects as unreadable — an unreadable record BLOCKS G5, and a block
 *      caused by our own emitter would be the worst kind of mystery.
 *
 * Emission stays with the MH-06 receipt journal; this returns the payload only.
 */
export function compatibilityUsageForRead(request: unknown): CompatibilityUsageEmission {
  const o = readOptions(request, EMISSION_KEYS);
  if (o === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "emission request rejected (proxy/accessor/symbol/unknown key)",
    };
  }

  // FULLY validated (CODEX #9 / #4 share this reader): an entry with a bad kind,
  // a traversing path, or a non-sha256 content_hash must never become a telemetry
  // record — the payload it produced would either be rejected downstream as
  // UNREADABLE (which blocks G5 mysteriously) or, worse, land in the corpus
  // describing bytes nobody can identify.
  const entry = readCatalogEntry(o["entry"]);
  if (entry === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail: "entry is not a well-formed guild.compatibility_catalog.v1 entry",
    };
  }

  const synthetic = o["synthetic"];
  if (typeof synthetic !== "boolean") {
    return {
      status: "refused",
      failure: "invalid_request",
      // Never defaulted: "missing" reading as "not synthetic" would pull tooling
      // reads into the dependence count and make the gate unreachable.
      detail: "synthetic must be an explicit boolean set at the emission point",
    };
  }

  const specialistIdRaw = o["specialist_id"] ?? null;
  if (specialistIdRaw !== null && !isCanonicalId(specialistIdRaw)) {
    return { status: "refused", failure: "invalid_request", detail: "specialist_id must be null or a canonical id" };
  }

  const classification = classifyCompatibilityRead({
    mode: o["mode"] as CapabilityResolverMode,
    intent: o["intent"] as CapabilityResolutionIntent,
  });
  if (classification.status === "refused") {
    // A read the mode does not permit produces NO record. Emitting one anyway
    // would put a row into the gate's corpus describing something that should not
    // have happened, and the honest signal is the typed refusal.
    return { status: "refused", failure: classification.failure, detail: classification.detail };
  }

  const candidate = {
    schema_version: COMPATIBILITY_USAGE_SCHEMA,
    asset_kind: entry.kind,
    asset_id: entry.id,
    asset_path: entry.path,
    content_hash: entry.content_hash,
    reason: classification.reason,
    resolver_mode: o["mode"],
    synthetic,
    specialist_id: specialistIdRaw,
  };

  const payload = parseCompatibilityUsageV1(candidate);
  if (payload === null) {
    return {
      status: "refused",
      failure: "invalid_request",
      detail:
        "constructed payload failed guild.compatibility_usage.v1 validation (check entry id/path/content_hash)",
    };
  }
  return { status: "ok", payload };
}

/**
 * The `required_asset_ids` a G5 evaluation must be accountable for.
 *
 * REFUSED unless the catalog is provably complete. This is the most dangerous
 * function in the file: its output decides which of the 73 shipped files a
 * removal gate may clear, and a SHORT required set is the classic false clean —
 * an asset absent from the required list can never be reported as "never
 * instrumented", so nobody notices it was never measured.
 *
 * CODEX #4: this trusted the catalog's own `census_matches` boolean. That flag is
 * caller-supplied data on a plain object, so a hand-built catalog carrying ONE
 * real entry, `template_count: 15`, `domain_skill_count: 58` and
 * `census_matches: true` produced a one-element required set; two clean rollups
 * then passed `evaluateG5` with 72 assets entirely outside accountability.
 *
 * The counts are therefore RECOMPUTED from fully-validated entries and checked
 * against the shipped census, the declared counts must agree with the real ones,
 * and `problems` must be empty. The flag is corroborating evidence now, not proof.
 */
export function requiredAssetIdsForG5(
  catalog: unknown,
): { readonly status: "ok"; readonly ids: readonly string[] } | { readonly status: "refused"; readonly detail: string } {
  const c = readOptions(catalog, [
    "schema_version",
    "entries",
    "template_count",
    "domain_skill_count",
    "census_matches",
    "problems",
  ]);
  if (c === null || c["schema_version"] !== COMPATIBILITY_CATALOG_SCHEMA) {
    return { status: "refused", detail: "not a guild.compatibility_catalog.v1" };
  }

  const raw = readArray(c["entries"]);
  if (raw === null) return { status: "refused", detail: "entries is not a dense plain array" };

  const ids: string[] = [];
  const seen = new Set<string>();
  let templates = 0;
  let skills = 0;
  for (const item of raw) {
    // FULLY validated, not merely id-checked — the same reader `suggestableAssets`
    // uses, so the two can never disagree about what a well-formed entry is.
    const e = readCatalogEntry(item);
    if (e === null) {
      return {
        status: "refused",
        detail: "catalog contains an entry that is not a well-formed catalog entry",
      };
    }
    // The two kinds share ONE id namespace in the G5 rollup, so a collision would
    // let one asset's dependence read mask another's zero.
    if (seen.has(e.id)) {
      return { status: "refused", detail: `catalog contains a duplicate asset id: ${e.id}` };
    }
    seen.add(e.id);
    ids.push(e.id);
    if (e.kind === "shipped_template") templates += 1;
    else skills += 1;
  }

  // RECOMPUTED, never taken on trust (CODEX #4).
  if (templates !== SHIPPED_TEMPLATE_COUNT || skills !== SHIPPED_DOMAIN_SKILL_COUNT) {
    return {
      status: "refused",
      detail: `catalog holds ${templates} template(s) and ${skills} domain skill(s); the shipped surface is ${SHIPPED_TEMPLATE_COUNT} and ${SHIPPED_DOMAIN_SKILL_COUNT} — refusing to derive a G5 required set from an incomplete enumeration`,
    };
  }
  // A declared count that disagrees with the real one means the catalog is lying
  // about itself. Refuse rather than quietly preferring the recomputed number.
  if (c["template_count"] !== templates || c["domain_skill_count"] !== skills) {
    return { status: "refused", detail: "catalog declares counts that disagree with its own entries" };
  }
  const problems = readArray(c["problems"]);
  if (problems === null) return { status: "refused", detail: "problems is not a dense plain array" };
  if (problems.length > 0) {
    return {
      status: "refused",
      detail: `catalog reported ${problems.length} problem(s); an incomplete scan is not an accountability set`,
    };
  }
  if (c["census_matches"] !== true) {
    return { status: "refused", detail: "catalog does not claim a matching census" };
  }

  ids.sort();
  return { status: "ok", ids: Object.freeze(ids) };
}
