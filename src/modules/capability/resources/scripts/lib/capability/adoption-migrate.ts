/**
 * scripts/lib/capability/adoption-migrate.ts
 *
 * THE ADOPTION MIGRATION — `guild.adoption_report.v1` + the `guild.adoption_manifest.v1`
 * writer/rollback pair.
 *
 * Closes audit gap D6. `roster.ts::migrateTeamRoster` was the roles-only,
 * script-internal precursor: it walked `.guild/team/*.yaml`, minted a project
 * instance for any `definition_source: shipped` domain role, and REWROTE the team
 * file in place. This generalizes it along three axes and reverses it on one.
 *
 *   +  ROLES **and** SKILLS. Domain skills were never covered, so a project could
 *      "migrate" and still depend on 58 shipped skills nobody counted.
 *   +  A READ-ONLY FIRST PASS. `buildAdoptionReport` writes nothing — not one
 *      capability file — and reports exact source hashes plus conflicts. An
 *      operator sees the whole blast radius before anything moves.
 *   +  PER-ITEM DISPOSITION. adopt-as-is / refine / substitute / compatibility-only,
 *      chosen per used legacy role, rather than one blanket mint-everything.
 *   +  A VERSIONED MANIFEST + ONE-COMMAND ROLLBACK, so the migration is reversible
 *      and old ids stay resolvable.
 *
 *   −  IT DOES NOT REWRITE HISTORY. `migrateTeamRoster` rewrote team files in
 *      place; this NEVER touches `.guild/team/*.yaml`, `.guild/plan/*.md`, or any
 *      handoff receipt. Those are the evidence record. R11/R14 are explicit that
 *      rollback must not destroy evidence and that receipts are never rewritten in
 *      place, and a migration that edits its own audit trail cannot be audited.
 *      Old references resolve FORWARD through `resolveHistorical(manifest, …)`.
 *
 * `migrateTeamRoster` is deliberately left intact and unchanged: it is the legacy
 * path, still reachable from `roster-resolve.ts`, and replacing it in the same
 * change would couple this migration to a CLI contract that other lanes consume.
 *
 * ── THE FOUR DISPOSITIONS ───────────────────────────────────────────────────
 *   adopt_as_is         copy the shipped asset into `.guild/`, preserving the source
 *                       version and hash IN THE STAMP AND THE MANIFEST (see
 *                       `stampProvenance` for why the copy is not byte-identical).
 *                       The default for a role in active use.
 *   refine              copy, then edit locally. Identical to adopt_as_is on the
 *                       way in — the difference is recorded in the copy's
 *                       `adopted_disposition` stamp, so a later reader can tell an
 *                       intentionally-diverging copy from one that should still
 *                       match its source.
 *   substitute          map the legacy id onto an EXISTING project definition. No
 *                       copy is made; the manifest records `rehomed` (or `renamed`
 *                       when the id changes).
 *   compatibility_only  do not localize. The legacy id stays resolvable through the
 *                       compatibility catalog, and every read of it counts as G5
 *                       dependence — which is the honest signal that this project
 *                       is not done migrating.
 *
 * All filesystem writes are confined to `applyAdoptionPlan` and `rollbackAdoption`.
 * Report building is READ-ONLY by construction — it never receives a write path.
 *
 * PLACEMENT: this lives in `scripts/lib/capability/` rather than
 * `src/modules/capability/workflows/` because it composes three contracts owned by
 * the `dispatch` module (adoption-manifest, project-definition-ref,
 * specialist-identity) plus `state`'s frontmatter reader. A module workflow may not
 * import the `scripts/` layer (check-module-ownership enforces it), and routing
 * four cross-module contracts through two other modules' public indexes would put
 * this lane's blast radius inside modules another lane is actively changing. As a
 * `scripts/lib` module it sits in the same layer as its dependencies, exactly like
 * the `roster.ts` precursor it generalizes.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { types as nodeTypes } from "util";

import {
  ADOPTION_MANIFEST_SCHEMA,
  entryDigest,
  manifestCommitment,
  validateAdoptionManifestV1,
  type AdoptionEntry,
  type AdoptionManifestV1,
  type AdoptionReason,
  type LegacyHome,
} from "../core/contracts/adoption-manifest";
import {
  checkContained,
  isRefused,
} from "../../../src/modules/kernel/workflows/path-containment";
import {
  PROJECT_DEFINITION_REF_SCHEMA,
  validateProjectDefinitionRefV1,
  type DefinitionLayer,
  type ProjectDefinitionRefV1,
} from "../core/contracts/project-definition-ref";
import {
  hashSpecialistProfile,
  hashSpecialistType,
  specialistProfileFromAgentFrontmatter,
  specialistTypeFromTemplateFrontmatter,
} from "../core/contracts/specialist-identity";
import { parseFrontmatter } from "../frontmatter";
import { AUGMENTING_AGENT_IDS } from "../roster";

import {
  COMPATIBILITY_CATALOG_SCHEMA,
  buildCompatibilityCatalog,
  readCatalogEntry,
  type CompatibilityCatalogEntry,
} from "./compatibility-catalog";

/** The catalog envelope key set, for the nested-object snapshot (CODEX #10). */
const CATALOG_KEYS = [
  "schema_version",
  "entries",
  "template_count",
  "domain_skill_count",
  "census_matches",
  "problems",
] as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const ADOPTION_REPORT_SCHEMA = "guild.adoption_report.v1" as const;

/** Where the manifest lives inside a project. One path, so rollback can find it. */
export const ADOPTION_MANIFEST_RELPATH = ".guild/adoption-manifest.json";

/**
 * Per-item operator choice. CLOSED and frozen — a disposition decides whether
 * bytes are copied and which `AdoptionReason` lands in the manifest, so it can
 * never be free text.
 */
export const ADOPTION_DISPOSITIONS = Object.freeze([
  "adopt_as_is",
  "refine",
  "substitute",
  "compatibility_only",
] as const);
export type AdoptionDisposition = (typeof ADOPTION_DISPOSITIONS)[number];

const DISPOSITION_SET: ReadonlySet<string> = new Set(ADOPTION_DISPOSITIONS);

/** Why a report item cannot be adopted cleanly. CLOSED — an operator acts on these. */
export const ADOPTION_CONFLICTS = Object.freeze([
  /** A project definition of this id already exists with DIFFERENT bytes. */
  "local_definition_differs",
  /** A project definition of this id already exists with IDENTICAL bytes. */
  "local_definition_identical",
  /** The legacy id is referenced, but no shipped asset of that id exists. */
  "legacy_asset_missing",
  /** The shipped asset could not be read (permissions, symlink, missing SKILL.md). */
  "legacy_asset_unreadable",
  /** The manifest already carries an entry for this identity. */
  "already_adopted",
] as const);
export type AdoptionConflict = (typeof ADOPTION_CONFLICTS)[number];

/** Where a legacy reference was found. Evidence, never rewritten. */
export const REFERENCE_SITES = Object.freeze([
  "team_file",
  "plan_file",
  "handoff_receipt",
  "project_agent_frontmatter",
  "project_skill_frontmatter",
] as const);
export type ReferenceSite = (typeof REFERENCE_SITES)[number];

// ---------------------------------------------------------------------------
// Hardening primitives
// ---------------------------------------------------------------------------

const MAX_ID_LEN = 128;
const MAX_SCALAR_LEN = 1024;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CANONICAL_ID = /^[a-z0-9][a-z0-9._-]*$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

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

function isCanonicalId(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= MAX_ID_LEN &&
    !CONTROL_CHARS.test(v) &&
    CANONICAL_ID.test(v)
  );
}

/**
 * A CANONICAL project-relative path. Non-canonical spellings are REJECTED, never
 * repaired: two spellings of one file would let a single legacy id appear to map
 * onto two different successors, and inventing a canonical spelling silently
 * decides what the operator meant.
 */
function isCanonicalRelPath(v: unknown): v is string {
  if (typeof v !== "string" || v.length === 0 || v.length > MAX_SCALAR_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false; // one separator convention only
  if (/^[A-Za-z]:/.test(v)) return false; // Windows drive absolute
  if (v.startsWith("/")) return false; // must be relative
  if (v.endsWith("/")) return false; // a directory is not a definition
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false; // "//" or a leading/trailing empty segment
    if (seg === "." || seg === "..") return false; // alias spellings
  }
  return true;
}

function isToken(v: unknown, max = MAX_ID_LEN): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= max &&
    !CONTROL_CHARS.test(v) &&
    TOKEN.test(v)
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
    if (!d || !("value" in d)) return null;
    out.push(d.value);
  }
  return out;
}

/** `sha256:<64 hex>` — the S2/S3 byte-hash spelling. */
function sha256Prefixed(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function toPosixRel(abs: string, root: string): string | null {
  const rel = path.relative(root, abs);
  if (rel.length === 0 || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const posix = rel.split(path.sep).join("/");
  if (posix.length > MAX_SCALAR_LEN || CONTROL_CHARS.test(posix)) return null;
  for (const seg of posix.split("/")) {
    if (seg.length === 0 || seg === "." || seg === "..") return null;
  }
  return posix;
}

/** Read a regular file's bytes, refusing symlinks. `null` on any problem. */
/**
 * Prove `abs` resolves INSIDE `root`, following every symlink on the way.
 *
 * CODEX round 2: the round-1 symlink fix was LITERAL-ONLY. It lstat-ed the LEAF
 * (`.guild/agents/qa.md`) and refused a symlinked file — but if `.guild/agents`
 * itself is a symlink to a directory outside the project, the leaf does not exist,
 * `mkdirSync(…, {recursive:true})` succeeds because the directory already does,
 * and `writeFileSync` lands the adopted template outside the project. The same
 * escape, one level up.
 *
 * MIGRATED ONTO THE SHARED PRIMITIVE (feature/path-containment, task #28) during the
 * six-branch integration. This file's own climb is gone, and losing it CLOSES A REAL
 * HOLE rather than merely deduplicating: it probed with `existsSync`, which FOLLOWS
 * symlinks, so a DANGLING symlink read as "absent", the climb stepped straight past
 * it and proved containment of its in-root PARENT instead. The shared climb probes
 * with `lstat`, sees the link itself, and refuses with `dangling-symlink`. The learn
 * lane had already found and fixed exactly this in its own copy — which is the
 * argument for one primitive, made concrete.
 *
 * Returns null when the path is contained, or a reason string when it is not. The
 * reason now carries the primitive's CLOSED refusal code alongside the prose, so a
 * caller can tell "outside the root" from "the root itself does not resolve".
 */
function escapesProjectRoot(abs: string, root: string): string | null {
  const containment = checkContained(root, abs);
  if (isRefused(containment)) {
    return `${abs} is not contained by the project root [${containment.code}] — ${containment.detail}`;
  }
  return null;
}

function readRegularFile(abs: string): Buffer | null {
  try {
    const st = fs.lstatSync(abs);
    // A symlink could point outside the tree, so its bytes do not describe the
    // asset we believe we are adopting.
    if (st.isSymbolicLink() || !st.isFile()) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && filter(e.name))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Inventory — what the project actually references
// ---------------------------------------------------------------------------

export interface LegacyReference {
  /** Project-relative path of the referencing artifact. Evidence; never rewritten. */
  readonly at: string;
  readonly site: ReferenceSite;
}

export interface AdoptionReportItem {
  readonly kind: "agent" | "skill";
  /** The legacy id as the old world spelled it. */
  readonly id: string;
  /** Plugin-relative path of the shipped asset, or null when it no longer exists. */
  readonly source_path: string | null;
  /** `sha256:<hex>` of the shipped bytes, or null when unreadable. */
  readonly source_hash: string | null;
  /** Every place the legacy id is referenced, sorted. The blast radius. */
  readonly referenced_at: readonly LegacyReference[];
  /** Conflicts an operator must resolve before adopting. Empty ⇒ clean. */
  readonly conflicts: readonly AdoptionConflict[];
  /** Project-relative path of an EXISTING local definition of this id, if any. */
  readonly existing_local_path: string | null;
  /** `sha256:<hex>` of that local definition. */
  readonly existing_local_hash: string | null;
  /** What the report RECOMMENDS. Advisory — the operator chooses. */
  readonly suggested_disposition: AdoptionDisposition;
}

export interface AdoptionReport {
  readonly schema_version: typeof ADOPTION_REPORT_SCHEMA;
  readonly project_id: string;
  /** Sorted by (kind, id). */
  readonly items: readonly AdoptionReportItem[];
  /** Catalog census, carried so a caller can refuse to act on a partial scan. */
  readonly catalog_census_matches: boolean;
  /**
   * Ids referenced by the project that the catalog does not contain. NAMED rather
   * than dropped: a reference to a shipped asset that no longer exists is exactly
   * the breakage a migration must surface, not silently omit.
   */
  readonly unresolvable_references: readonly string[];
  readonly problems: readonly string[];
  /** Always true. The first pass writes nothing; asserted so a test can pin it. */
  readonly read_only: true;
}

/** Scan one text artifact for references to catalog ids. Substring-free, token-based. */
function referencedIds(text: string, ids: ReadonlySet<string>): Set<string> {
  const found = new Set<string>();
  // Token boundaries, not substrings: `qa` must not match inside `qa-flaky-test-hunter`,
  // and `backend` must not match inside `backend-api-contract`. A substring scan here
  // would inflate the referenced set and pull unused assets into the migration.
  for (const token of text.split(/[^A-Za-z0-9._-]+/)) {
    if (token.length > 0 && ids.has(token)) found.add(token);
  }
  return found;
}

/**
 * Catalog ids a definition file DECLARES as dependencies, from its frontmatter
 * `skills:` / `external_skills:` lists only.
 *
 * The prose is deliberately not read. A specialist definition's `description`
 * carries DO-NOT-TRIGGER boundary guidance that names sibling roles, and treating
 * those as dependencies made an adopted `qa` appear to depend on architect,
 * backend, devops, marketing, mobile, researcher and security. A boundary note is
 * the opposite of a dependency — it says "this is NOT mine".
 */
function declaredSkillRefs(text: string, catalogIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  const fm = parseFrontmatter(text);
  if (fm === null) return out;
  for (const key of ["skills", "external_skills"]) {
    const v = (fm as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && catalogIds.has(item.trim())) out.add(item.trim());
      }
    } else if (typeof v === "string") {
      // The comma-separated flow spelling shipped agents use for `tools:`.
      for (const part of v.split(",")) {
        const id = part.trim();
        if (catalogIds.has(id)) out.add(id);
      }
    }
  }
  return out;
}

/**
 * Role names a team file DECLARES as `definition_source: shipped`.
 *
 * Deliberately a narrow, shape-driven read of the one structure that carries the
 * claim — a `specialists:` entry pairing `name:` with `definition_source: shipped`.
 * It is not a YAML parser and does not try to be: its only job is to notice a role
 * a team file BELIEVES the plugin ships, so that a role the catalog does not
 * contain becomes visible instead of vanishing. A role this misses is simply not
 * flagged; a role it invented would be worse, so the match is anchored and
 * conservative.
 */
function shippedRoleNames(text: string): Set<string> {
  const out = new Set<string>();
  let pendingName: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const name = /^\s*-?\s*name:\s*["']?([A-Za-z0-9][A-Za-z0-9._-]*)["']?\s*$/.exec(line);
    if (name !== null) {
      pendingName = name[1];
      continue;
    }
    if (/^\s*definition_source:\s*["']?shipped["']?\s*$/.test(line) && pendingName !== null) {
      out.add(pendingName);
      pendingName = null;
    }
  }
  return out;
}

const REPORT_KEYS = ["pluginRoot", "projectRoot", "projectId", "catalog"] as const;

function emptyReport(projectId: string, problem: string): AdoptionReport {
  return Object.freeze({
    schema_version: ADOPTION_REPORT_SCHEMA,
    project_id: projectId,
    items: Object.freeze([] as AdoptionReportItem[]),
    catalog_census_matches: false,
    unresolvable_references: Object.freeze([] as string[]),
    problems: Object.freeze([problem]),
    read_only: true as const,
  });
}

/**
 * THE READ-ONLY FIRST PASS.
 *
 * Inventories live agents/skills, team files, plan files, and handoff receipts;
 * finds every reference to a shipped template or domain skill; and reports each
 * used legacy id with its EXACT source hash and any conflicts.
 *
 * Writes NOTHING. That is the property the whole design rests on: an operator can
 * run this on a production repo, read the blast radius, and walk away having
 * changed nothing. The function is not given a write path, and the only fs calls
 * it makes are `lstat`/`read`.
 *
 * Only ACTUALLY REFERENCED assets appear. A project that never mentions
 * `sales-cold-outreach` does not get it copied — copying the whole shipped surface
 * into every project would be localization in name and vendoring in fact.
 */
export function buildAdoptionReport(opts: unknown): AdoptionReport {
  const o = readOptions(opts, REPORT_KEYS);
  if (o === null) return emptyReport("", "options object rejected (proxy/accessor/symbol/unknown key)");

  const projectIdRaw = o["projectId"];
  if (!isToken(projectIdRaw)) {
    return emptyReport("", `projectId is not a token: ${describe(projectIdRaw)}`);
  }
  const projectId = projectIdRaw;

  const pluginRoot = o["pluginRoot"];
  const projectRoot = o["projectRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0 || CONTROL_CHARS.test(pluginRoot)) {
    return emptyReport(projectId, "pluginRoot must be a non-empty, control-character-free path");
  }
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || CONTROL_CHARS.test(projectRoot)) {
    return emptyReport(projectId, "projectRoot must be a non-empty, control-character-free path");
  }
  const pRoot = path.resolve(pluginRoot);
  const projRoot = path.resolve(projectRoot);

  // The catalog may be supplied (so a caller can pin a deprecation state) or built.
  //
  // CODEX #10: the supplied catalog was cast and then read with plain property
  // access — `catalog.entries`, `catalog.problems`, `catalog.census_matches` — so a
  // Proxy on it executed its traps DURING validation, could throw straight out of a
  // function that claims never to throw, and could return a different value on each
  // of those three reads. The outer `readOptions` snapshot protected the options
  // bag but not the object NESTED inside it. It is snapshotted here, once, before
  // anything about it is inspected.
  let catalogSnap: Record<string, unknown> | null;
  const suppliedCatalog = o["catalog"];
  if (suppliedCatalog === undefined || suppliedCatalog === null) {
    catalogSnap = readOptions(buildCompatibilityCatalog({ pluginRoot: pRoot }), CATALOG_KEYS);
  } else {
    catalogSnap = readOptions(suppliedCatalog, CATALOG_KEYS);
  }
  if (catalogSnap === null || catalogSnap["schema_version"] !== COMPATIBILITY_CATALOG_SCHEMA) {
    return emptyReport(projectId, "catalog is not a guild.compatibility_catalog.v1");
  }

  const catalogEntries = readArray(catalogSnap["entries"]);
  if (catalogEntries === null) {
    return emptyReport(projectId, "catalog.entries is not a dense plain array");
  }

  const catalogProblems = readArray(catalogSnap["problems"]);
  if (catalogProblems === null) {
    return emptyReport(projectId, "catalog.problems is not a dense plain array");
  }
  const problems: string[] = catalogProblems.map((x) => (typeof x === "string" ? x : describe(x)));
  const censusMatches = catalogSnap["census_matches"] === true;

  const byId = new Map<string, CompatibilityCatalogEntry>();
  for (const raw of catalogEntries) {
    // FULLY validated through the catalog module's own reader, and stored as the
    // FRESH copy it returns — not the caller's object, which could be mutated
    // after validation.
    const e = readCatalogEntry(raw);
    if (e === null) {
      return emptyReport(projectId, "catalog contains a malformed entry");
    }
    byId.set(e.id, e);
  }
  const catalogIds: ReadonlySet<string> = new Set(byId.keys());

  // ── Gather references ──
  /** Roles a team file CLAIMS are shipped but the catalog does not contain (CODEX #5). */
  const danglingShipped = new Set<string>();
  const refs = new Map<string, LegacyReference[]>();
  const addRef = (id: string, at: string, site: ReferenceSite): void => {
    const list = refs.get(id);
    if (list === undefined) refs.set(id, [{ at, site }]);
    else if (!list.some((r) => r.at === at && r.site === site)) list.push({ at, site });
  };

  const scan = (absFiles: readonly string[], site: ReferenceSite): void => {
    for (const abs of absFiles) {
      const rel = toPosixRel(abs, projRoot);
      if (rel === null) {
        problems.push(`skipped non-canonical path: ${abs}`);
        continue;
      }
      const bytes = readRegularFile(abs);
      if (bytes === null) {
        problems.push(`unreadable ${site}: ${rel}`);
        continue;
      }
      const text = bytes.toString("utf8");

      // WHERE the ids are read from depends on the site, and this distinction is
      // load-bearing.
      //
      // A definition file's FRONTMATTER is structured — `skills:` is a real
      // dependency list. Its PROSE is not: a shipped template's `description`
      // names half the roster in its DO-NOT-TRIGGER boundary guidance ("DO NOT
      // TRIGGER for: system design (architect …), app code (backend …), CI/CD
      // (devops …)"). Scanning the whole file therefore reported architect,
      // backend, devops, marketing, mobile, researcher and security as
      // dependencies of `qa` — seven templates a migration would copy for no
      // reason, found by re-running the report over an adopted project.
      //
      // So: definition files are read through their frontmatter skill lists ONLY.
      // Plans and receipts stay a whole-text scan, because prose is the only
      // signal they have and a plan naming a role genuinely is a reference.
      const ids =
        site === "project_agent_frontmatter" || site === "project_skill_frontmatter"
          ? declaredSkillRefs(text, catalogIds)
          : referencedIds(text, catalogIds);
      for (const id of ids) {
        addRef(id, rel, site);
      }
      // CODEX #5: `unresolvable_references` was DEAD CODE. The scan only recognized
      // ids the catalog already contains, so `byId.get(id) === undefined` could
      // never fire and a team file naming a shipped role that no longer exists
      // produced an empty report with no problems — the single loudest breakage a
      // migration must surface, reported as "nothing to do".
      //
      // A team file states its own claim (`definition_source: shipped`), so a role
      // named there but absent from the catalog is detectable WITHOUT knowing the
      // catalog first. That is the only site with a machine-readable claim, which is
      // why the detection is scoped to it rather than guessed at from prose.
      if (site === "team_file") {
        for (const name of shippedRoleNames(text)) {
          // MACHINERY agents (advisor, developer) are shipped, stay shipped, and are
          // deliberately NOT part of the 73-asset compatibility surface — the plugin
          // registers them as agents rather than offering them as templates. They
          // are `definition_source: shipped` forever and correctly absent from the
          // catalog, so flagging them would make every real team file look broken.
          // Read from roster.ts's own set rather than re-listing the two names here.
          if (AUGMENTING_AGENT_IDS.has(name)) continue;
          if (!catalogIds.has(name)) danglingShipped.add(name);
        }
      }
    }
  };

  const guild = path.join(projRoot, ".guild");
  scan(listFiles(path.join(guild, "team"), (n) => n.endsWith(".yaml")), "team_file");
  scan(listFiles(path.join(guild, "plan"), (n) => n.endsWith(".md")), "plan_file");
  scan(listFiles(path.join(guild, "agents"), (n) => n.endsWith(".md")), "project_agent_frontmatter");
  for (const skillDir of listDirs(path.join(guild, "skills"))) {
    scan([path.join(skillDir, "SKILL.md")], "project_skill_frontmatter");
  }
  // Handoff receipts: `.guild/runs/<run-id>/handoffs/*.md`. HISTORICAL EVIDENCE —
  // read to learn what was used, never touched again by this module.
  for (const runDir of listDirs(path.join(guild, "runs"))) {
    scan(listFiles(path.join(runDir, "handoffs"), (n) => n.endsWith(".md")), "handoff_receipt");
  }

  // ── Existing local definitions + already-adopted identities ──
  const localAgent = (id: string): string => path.join(guild, "agents", `${id}.md`);
  const localSkill = (id: string): string => path.join(guild, "skills", id, "SKILL.md");

  const existingManifest = readAdoptionManifest(projRoot);
  const adoptedIds = new Set<string>();
  if (existingManifest !== null) {
    for (const e of existingManifest.entries) {
      // A rolled-back entry RESTORES the legacy id, so it is adoptable again. Any
      // other reason means the id already has a successor and re-adopting it would
      // fork the lineage the manifest exists to keep single.
      if (e.reason === "rolled_back") adoptedIds.delete(e.from.id);
      else adoptedIds.add(e.from.id);
    }
  }

  // ── Build one item per REFERENCED id ──
  const items: AdoptionReportItem[] = [];
  const unresolvable: string[] = [];

  for (const [id, sites] of [...refs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const entry = byId.get(id);
    if (entry === undefined) {
      unresolvable.push(id);
      continue;
    }
    const kind: "agent" | "skill" = entry.kind === "shipped_template" ? "agent" : "skill";
    const conflicts: AdoptionConflict[] = [];

    const srcAbs = path.join(pRoot, entry.path);
    const srcBytes = readRegularFile(srcAbs);
    let sourceHash: string | null = null;
    if (srcBytes === null) conflicts.push("legacy_asset_unreadable");
    else sourceHash = sha256Prefixed(srcBytes);

    const localAbs = kind === "agent" ? localAgent(id) : localSkill(id);
    const localBytes = readRegularFile(localAbs);
    let existingLocalPath: string | null = null;
    let existingLocalHash: string | null = null;
    if (localBytes !== null) {
      existingLocalPath = toPosixRel(localAbs, projRoot);
      existingLocalHash = sha256Prefixed(localBytes);
      // An ADOPTED COPY is not a divergence. It carries `adopted_source_hash` in
      // its own frontmatter, so when that names the bytes currently shipped, this
      // file IS the shipped definition plus its provenance stamp.
      //
      // Without this, re-running the report over an already-migrated project
      // reported every adopted role as `local_definition_differs` — technically
      // true (the stamp changes the bytes) and completely misleading: it reads as
      // "someone hand-edited this", which is the one conflict that tells an
      // operator to stop and merge.
      const stampedFrom = adoptedSourceHash(localBytes.toString("utf8"));
      if (stampedFrom !== null && sourceHash !== null && stampedFrom === sourceHash) {
        conflicts.push("local_definition_identical");
      } else {
        // Byte-compared, never assumed. "A local file exists" and "the local file
        // is the shipped file" are different situations with different right
        // answers: the first is a genuine conflict, the second an already-done
        // adoption.
        conflicts.push(
          sourceHash !== null && existingLocalHash === sourceHash
            ? "local_definition_identical"
            : "local_definition_differs",
        );
      }
    }
    if (adoptedIds.has(id)) conflicts.push("already_adopted");

    // The recommendation is deliberately CONSERVATIVE. Anything with a conflict
    // suggests `compatibility_only` — the disposition that changes nothing — so the
    // report never nudges an operator toward overwriting work they did by hand.
    const suggested: AdoptionDisposition =
      conflicts.length === 0
        ? "adopt_as_is"
        : conflicts.length === 1 && conflicts[0] === "local_definition_identical"
          ? "substitute"
          : "compatibility_only";

    items.push(
      Object.freeze({
        kind,
        id,
        source_path: srcBytes === null ? null : entry.path,
        source_hash: sourceHash,
        referenced_at: Object.freeze(
          [...sites].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.site < b.site ? -1 : 1)),
        ),
        conflicts: Object.freeze(conflicts),
        existing_local_path: existingLocalPath,
        existing_local_hash: existingLocalHash,
        suggested_disposition: suggested,
      }),
    );
  }

  items.sort((a, b) =>
    a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  return Object.freeze({
    schema_version: ADOPTION_REPORT_SCHEMA,
    project_id: projectId,
    items: Object.freeze(items),
    catalog_census_matches: censusMatches,
    unresolvable_references: Object.freeze(
      // Ids referenced but absent from the catalog, PLUS roles a team file claims
      // are shipped that the catalog does not contain (CODEX #5).
      [...new Set([...unresolvable, ...danglingShipped])].sort(),
    ),
    problems: Object.freeze(problems),
    read_only: true as const,
  });
}

// ---------------------------------------------------------------------------
// Manifest read/write
// ---------------------------------------------------------------------------

/** Read + validate the project's manifest. `null` when absent OR invalid. */
export function readAdoptionManifest(projectRoot: string): AdoptionManifestV1 | null {
  const abs = path.join(path.resolve(projectRoot), ADOPTION_MANIFEST_RELPATH);
  const bytes = readRegularFile(abs);
  if (bytes === null) return null;
  try {
    // Validated, not merely parsed: an invalid manifest must never be extended,
    // because appending to a broken chain manufactures a chain that verifies from
    // the new tip and hides the break underneath it.
    return validateAdoptionManifestV1(JSON.parse(bytes.toString("utf8")));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The adoption plan
// ---------------------------------------------------------------------------

export interface AdoptionDecision {
  readonly kind: "agent" | "skill";
  readonly id: string;
  readonly disposition: AdoptionDisposition;
  /**
   * Required for `substitute`: the project-relative path of the EXISTING local
   * definition the legacy id maps onto. Ignored for every other disposition.
   */
  readonly substitute_path?: string;
  /** Required for `substitute` when the id changes; defaults to `id`. */
  readonly substitute_id?: string;
  /** Operator note. Required by S3 for reasons whose information loss demands one. */
  readonly detail?: string;
}

export type AdoptionApplyOutcome =
  | {
      readonly status: "applied";
      readonly manifest_path: string;
      /** Project-relative paths written, sorted. Empty for an all-compatibility plan. */
      readonly written: readonly string[];
      /** Ids left on the compatibility surface. Each is future G5 dependence. */
      readonly compatibility_only: readonly string[];
      /**
       * Report items the plan said NOTHING about, sorted.
       *
       * CODEX #6: a plan need not cover the whole report — incremental adoption is
       * exactly what per-item dispositions are for — but silence was previously
       * indistinguishable from completion, so a one-decision plan against a
       * ten-item report reported unqualified success. These are the ids still on
       * the legacy path because nobody decided, as distinct from
       * `compatibility_only`, where somebody decided to leave them there.
       */
      readonly undecided: readonly string[];
      readonly entries_appended: number;
      /** The manifest's external commitment AFTER the append. */
      readonly manifest_digest: string;
    }
  | { readonly status: "refused"; readonly reason: string };

const APPLY_KEYS = [
  "pluginRoot",
  "projectRoot",
  "projectId",
  "report",
  "decisions",
  "runId",
  "adoptedAt",
  "authorizedBy",
  "dryRun",
] as const;

const DECISION_KEYS = [
  "kind",
  "id",
  "disposition",
  "substitute_path",
  "substitute_id",
  "detail",
] as const;

/** S3 requires a note for these reasons; the writer enforces it before it writes. */
const DETAIL_REQUIRED_REASONS: ReadonlySet<AdoptionReason> = new Set<AdoptionReason>([
  "collapsed",
  "removed",
  "rolled_back",
]);

/** The frontmatter key marking a file as an adopted copy. */
export const ADOPTION_PROVENANCE_KEY = "adopted_from";

/**
 * Stamp the adopted copy with its provenance, returning the new bytes.
 *
 * WHY THE COPY IS NOT BYTE-IDENTICAL TO ITS SOURCE
 *
 * "Preserve the source version and hash" is satisfied — both are preserved, in
 * TWO places: the manifest entry's `from.content_hash`, and these frontmatter
 * keys inside the file itself. What is deliberately NOT preserved is byte
 * equality, for a structural reason:
 *
 * S3's identity is `(kind, id, content_hash)` — it has no notion of HOME. An
 * `adopt_as_is` copy that kept the same id AND the same bytes would therefore be
 * the SAME identity as its source, and the manifest's own liveness rule marks a
 * source dead the moment it is adopted away. The entry would make its own
 * destination dead on arrival: no rollback could name it, and traversal would
 * read the migration as a closed loop rather than a hop. The stamp is what makes
 * "the shipped qa" and "this project's qa" two identities, which is exactly what
 * the migration means.
 *
 * It also mirrors what Guild already does: `mintFromTemplate` stamps
 * `generated_by:` into a minted instance for the same reason — a copied
 * definition should say where it came from.
 *
 * Inserted immediately after the opening fence, matching the file's own line
 * ending, so a CRLF source does not silently lose the stamp.
 */
function stampProvenance(
  raw: string,
  args: {
    sourceRelPath: string;
    sourceHash: string;
    sourceVersion: string;
    disposition: AdoptionDisposition;
    adoptedAt: string;
    authorizedBy: string;
  },
): string | null {
  const eol = raw.startsWith("---\r\n") ? "\r\n" : raw.startsWith("---\n") ? "\n" : null;
  // A file without a frontmatter fence is REFUSED, never wrapped in one: inventing
  // frontmatter changes what the host parses, which is a semantic edit, not a copy.
  if (eol === null) return null;
  const lines = [
    `${ADOPTION_PROVENANCE_KEY}: ${args.sourceRelPath}`,
    `adopted_source_hash: ${args.sourceHash}`,
    `adopted_source_version: ${args.sourceVersion}`,
    `adopted_disposition: ${args.disposition}`,
    `adopted_at: ${args.adoptedAt}`,
    `adopted_authorized_by: ${args.authorizedBy}`,
  ];
  return `---${eol}${lines.join(eol)}${eol}` + raw.slice(3 + eol.length);
}

/**
 * The `sha256:<hex>` an adopted copy records as the source it came from, or null
 * when this file is not an adopted copy. Shape-checked, so a hand-written value
 * that is not a hash cannot masquerade as provenance.
 */
function adoptedSourceHash(raw: string): string | null {
  const fm = parseFrontmatter(raw);
  if (fm === null) return null;
  const v = (fm as Record<string, unknown>)["adopted_source_hash"];
  return typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v) ? v : null;
}

/** The source's own declared version, or "1" when it does not carry one. */
function sourceVersionOf(raw: string): string {
  const fm = parseFrontmatter(raw);
  const v = fm === null ? null : fm["version"];
  if (typeof v === "string" && isToken(v, 64)) return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
  return "1";
}

/**
 * Apply an operator-chosen plan: copy the referenced assets, then append the
 * `guild.adoption_manifest.v1` entries that map old ids to new project-local refs.
 *
 * REFUSES rather than partially applies. Every decision is validated, every ref is
 * constructed, and the whole entry list is validated against the manifest chain
 * BEFORE a single file is written. A half-applied migration whose manifest
 * disagrees with the tree is worse than one that never started: rollback would
 * have nothing coherent to reverse.
 *
 * Copies preserve the SOURCE bytes exactly — the manifest's `from.content_hash`
 * and the new ref's `content_hash` are both taken from real bytes, so a later
 * `verifyRefAgainstBytes` can prove which version was adopted.
 *
 * `dryRun` runs every check and builds every entry without writing, so a dry run
 * never overstates what the real run can do.
 */
export function applyAdoptionPlan(opts: unknown): AdoptionApplyOutcome {
  const o = readOptions(opts, APPLY_KEYS);
  if (o === null) return { status: "refused", reason: "options object rejected (proxy/accessor/symbol/unknown key)" };

  const projectIdRaw = o["projectId"];
  if (!isToken(projectIdRaw)) return { status: "refused", reason: "projectId is not a token" };
  const projectId = projectIdRaw;

  const pluginRoot = o["pluginRoot"];
  const projectRoot = o["projectRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0) {
    return { status: "refused", reason: "pluginRoot is required" };
  }
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return { status: "refused", reason: "projectRoot is required" };
  }
  const pRoot = path.resolve(pluginRoot);
  const projRoot = path.resolve(projectRoot);

  const runId = o["runId"];
  if (!isToken(runId)) return { status: "refused", reason: "runId is not a token" };
  const authorizedBy = o["authorizedBy"];
  if (!isToken(authorizedBy)) {
    // Not optional and not defaulted. S3 requires the authorizing decision record,
    // and an unattributed migration cannot be argued with months later.
    return { status: "refused", reason: "authorizedBy must name the authorizing decision record" };
  }
  const adoptedAt = o["adoptedAt"];
  if (typeof adoptedAt !== "string" || !RFC3339.test(adoptedAt)) {
    // Caller-supplied: the contract has no clock, so a deterministic replay
    // produces byte-identical manifests.
    return { status: "refused", reason: "adoptedAt must be an RFC3339 UTC timestamp supplied by the caller" };
  }

  const dryRunRaw = o["dryRun"];
  if (dryRunRaw !== undefined && typeof dryRunRaw !== "boolean") {
    return { status: "refused", reason: "dryRun must be a boolean" };
  }
  const dryRun = dryRunRaw === true;

  const report = o["report"] as AdoptionReport | undefined;
  const reportOpts = readOptions(report, [
    "schema_version",
    "project_id",
    "items",
    "catalog_census_matches",
    "unresolvable_references",
    "problems",
    "read_only",
  ]);
  if (reportOpts === null || reportOpts["schema_version"] !== ADOPTION_REPORT_SCHEMA) {
    return { status: "refused", reason: "report is not a guild.adoption_report.v1" };
  }
  if (reportOpts["project_id"] !== projectId) {
    // The successor paths in the manifest are PROJECT-RELATIVE, and only the
    // project_id says which root they resolve against. Applying a report built for
    // another project would write a manifest whose refs point nowhere.
    return { status: "refused", reason: "report.project_id does not match projectId" };
  }
  // CODEX #6: acting on a scan that reported problems, named unresolvable
  // references, or failed its census means adopting against an incomplete picture
  // of the project — and the report is the operator's evidence for the whole plan.
  // Refuse rather than apply decisions built on it.
  const reportProblems = readArray(reportOpts["problems"]);
  if (reportProblems === null) {
    return { status: "refused", reason: "report.problems is not a dense plain array" };
  }
  if (reportProblems.length > 0) {
    return {
      status: "refused",
      reason: `report carries ${reportProblems.length} problem(s); resolve them and re-run the report before adopting`,
    };
  }
  const reportUnresolvable = readArray(reportOpts["unresolvable_references"]);
  if (reportUnresolvable === null) {
    return { status: "refused", reason: "report.unresolvable_references is not a dense plain array" };
  }
  if (reportUnresolvable.length > 0) {
    return {
      status: "refused",
      reason: `report names ${reportUnresolvable.length} unresolvable reference(s); a project citing assets that do not exist must be fixed before adopting`,
    };
  }
  if (reportOpts["catalog_census_matches"] !== true) {
    return {
      status: "refused",
      reason: "report was built from a catalog whose census does not match the shipped surface",
    };
  }

  const reportItems = readArray(reportOpts["items"]);
  if (reportItems === null) return { status: "refused", reason: "report.items is not a dense plain array" };
  const itemById = new Map<string, AdoptionReportItem>();
  for (const raw of reportItems) {
    const item = raw as AdoptionReportItem;
    if (!isCanonicalId(item?.id)) return { status: "refused", reason: "report contains an item with a non-canonical id" };
    itemById.set(`${item.kind} ${item.id}`, item);
  }

  const decisionsRaw = readArray(o["decisions"]);
  if (decisionsRaw === null) return { status: "refused", reason: "decisions is not a dense plain array" };
  if (decisionsRaw.length === 0) return { status: "refused", reason: "decisions is empty — nothing to apply" };

  // ── Validate every decision BEFORE touching the filesystem ──
  interface PlannedWrite {
    readonly absTarget: string;
    readonly relTarget: string;
    readonly bytes: Buffer;
    /** True when the target already held these exact bytes — a re-run, not a create. */
    readonly preExisting: boolean;
  }
  const writes: PlannedWrite[] = [];
  const compatibilityOnly: string[] = [];
  const pendingEntries: Array<Omit<AdoptionEntry, "sequence" | "prev_digest">> = [];
  const seenDecisions = new Set<string>();

  for (const raw of decisionsRaw) {
    const d = readOptions(raw, DECISION_KEYS);
    if (d === null) return { status: "refused", reason: "a decision was rejected (proxy/accessor/symbol/unknown key)" };

    const kind = d["kind"];
    if (kind !== "agent" && kind !== "skill") {
      return { status: "refused", reason: `decision kind must be "agent" or "skill"` };
    }
    const id = d["id"];
    if (!isCanonicalId(id)) return { status: "refused", reason: `decision id is not canonical: ${String(id)}` };

    const key = `${kind} ${id}`;
    // A duplicate decision is REFUSED, not last-wins: two dispositions for one id
    // is an operator error, and silently picking one decides what they meant.
    if (seenDecisions.has(key)) return { status: "refused", reason: `duplicate decision for ${kind} "${id}"` };
    seenDecisions.add(key);

    const disposition = d["disposition"];
    if (typeof disposition !== "string" || !DISPOSITION_SET.has(disposition)) {
      return { status: "refused", reason: `not an adoption disposition: ${describe(disposition)}` };
    }

    const item = itemById.get(key);
    if (item === undefined) {
      // Only ACTUALLY REFERENCED assets may be adopted. A decision for something
      // the report never saw would copy an asset nothing uses.
      return { status: "refused", reason: `no report item for ${kind} "${id}" — only referenced assets may be adopted` };
    }

    const detailRaw = d["detail"];
    if (detailRaw !== undefined && (typeof detailRaw !== "string" || detailRaw.length === 0 || detailRaw.length > 2048 || CONTROL_CHARS.test(detailRaw))) {
      return { status: "refused", reason: `decision detail for "${id}" must be a bounded, control-character-free string` };
    }
    const detail = (detailRaw as string | undefined) ?? null;

    if (disposition === "compatibility_only") {
      compatibilityOnly.push(id);
      continue; // no copy, no manifest entry — the legacy id stays legacy
    }

    if (item.source_hash === null || item.source_path === null) {
      return { status: "refused", reason: `${kind} "${id}" has no readable shipped source; only compatibility_only is available` };
    }

    let reason: AdoptionReason;
    let successorRelPath: string;
    let successorId: string = id;
    let successorBytes: Buffer;

    if (disposition === "substitute") {
      const subPath = d["substitute_path"];
      // CANONICAL, not merely "relative". `.guild/./agents/x.md` and
      // `.guild/agents/x.md` name one file; accepting both would let one legacy id
      // map onto what looks like two different successors. The ref validator would
      // reject the non-canonical spelling later anyway — rejecting it HERE is what
      // makes the refusal say which field was wrong.
      if (!isCanonicalRelPath(subPath)) {
        return {
          status: "refused",
          reason: `substitute for "${id}" requires a CANONICAL project-relative substitute_path (no ".", "..", "//", backslashes, or leading slash)`,
        };
      }
      const subIdRaw = d["substitute_id"];
      if (subIdRaw !== undefined) {
        if (!isCanonicalId(subIdRaw)) return { status: "refused", reason: `substitute_id for "${id}" is not canonical` };
        successorId = subIdRaw;
      }
      const abs = path.join(projRoot, subPath);
      const bytes = readRegularFile(abs);
      if (bytes === null) {
        return { status: "refused", reason: `substitute target for "${id}" is not a readable regular file: ${subPath}` };
      }
      successorRelPath = subPath;
      successorBytes = bytes;
      // `renamed` when the id moves, `rehomed` when only the location does. Two
      // reasons because a reader resolving history needs to know which changed.
      reason = successorId === id ? "rehomed" : "renamed";
    } else {
      // adopt_as_is / refine — copy the shipped bytes into the project.
      const srcBytes = readRegularFile(path.join(pRoot, item.source_path));
      if (srcBytes === null) {
        return { status: "refused", reason: `shipped source for "${id}" became unreadable` };
      }
      const observed = sha256Prefixed(srcBytes);
      if (observed !== item.source_hash) {
        // The report's hash is the operator's evidence. If the bytes changed
        // between the report and the apply, the operator approved something that
        // no longer exists.
        return {
          status: "refused",
          reason: `shipped source for "${id}" changed since the report (${item.source_hash} → ${observed})`,
        };
      }
      successorRelPath =
        kind === "agent" ? `.guild/agents/${id}.md` : `.guild/skills/${id}/SKILL.md`;
      // Stamped, not copied verbatim — see `stampProvenance` for why byte equality
      // would make the entry's own destination dead on arrival under S3's
      // (kind, id, content_hash) identity. The source version and hash are
      // preserved in the stamp AND in the manifest's `from.content_hash`.
      const rawSrc = srcBytes.toString("utf8");
      const stamped = stampProvenance(rawSrc, {
        sourceRelPath: item.source_path,
        sourceHash: observed,
        sourceVersion: sourceVersionOf(rawSrc),
        disposition: disposition as AdoptionDisposition,
        adoptedAt,
        authorizedBy,
      });
      if (stamped === null) {
        return {
          status: "refused",
          reason: `shipped source for "${id}" does not open with a '---' frontmatter fence; refusing to synthesize one`,
        };
      }
      successorBytes = Buffer.from(stamped, "utf8");
      reason = "migrated";

      const absTarget = path.join(projRoot, successorRelPath);
      const existing = readRegularFile(absTarget);
      // Compared against the STAMPED bytes: re-running the same adoption is
      // idempotent, while any hand edit (or an adoption of different source bytes)
      // is a divergence. NEVER clobber divergent local work — that is a merge, and
      // a migration tool must not perform one silently.
      if (existing !== null && !existing.equals(successorBytes)) {
        return {
          status: "refused",
          reason: `${successorRelPath} already exists with different bytes; resolve it or choose compatibility_only for "${id}"`,
        };
      }
      writes.push({
        absTarget,
        relTarget: successorRelPath,
        bytes: successorBytes,
        preExisting: existing !== null,
      });
    }

    if (DETAIL_REQUIRED_REASONS.has(reason) && detail === null) {
      return { status: "refused", reason: `reason "${reason}" for "${id}" requires a detail note` };
    }

    const ref = buildProjectDefinitionRef({
      projectId,
      // The successor is written into the ADOPTING project's own `.guild/` tree, so
      // its owning layer is `project-guild`. `layerAgreesWithPath` confirms it
      // against `successorRelPath` (`.guild/...`) rather than taking the word for it.
      layer: "project-guild",
      kind,
      id: successorId,
      relativePath: successorRelPath,
      bytes: successorBytes,
      pluginRoot: pRoot,
      legacyId: id,
    });
    if (ref === null) {
      return { status: "refused", reason: `could not build a valid project_definition_ref for ${kind} "${id}"` };
    }

    const home: LegacyHome = "plugin-shipped";
    pendingEntries.push({
      kind,
      from: {
        // INTEGRATION (five-branch stack): S3's first amendment made the legacy
        // locator's root REQUIRED (task #27, first half).
        //
        // `projectId` is NOT a guess here — it is FORCED by S3's own rollback proof.
        // `validateAdoptionManifestV1` requires a reversal to land "back in the ROOT
        // it left": `entry.to.project_id !== target.from.project_id` is a rejection.
        // The rollback path rebuilds its restored ref with THIS command's `projectId`,
        // so writing anything else on the `from` side would make every adoption this
        // command records permanently un-rollbackable.
        //
        // The plugin-shipped source and the project successor therefore share a root
        // and are told apart by `home` vs `to.layer` — which is precisely the "a move
        // WITHIN a root" case S3's SECOND amendment exists to express, and precisely
        // cap-loc-D09's own migration shape.
        project_id: projectId,
        id,
        // S3 requires an ABSOLUTE historical path — it cites what old records
        // literally wrote, and those are absolute.
        historical_path: path.join(pRoot, item.source_path),
        content_hash: item.source_hash,
        home,
      },
      to: ref,
      reason,
      detail,
      reverses_sequence: null,
      adopted_at: adoptedAt,
      run_id: runId,
      authorized_by: authorizedBy,
    });
  }

  /** Report items no decision mentioned — visible incompleteness (CODEX #6). */
  // Reads the ITEM's own id rather than re-parsing the composite map key: the key
  // is an implementation detail, and splitting it back apart is the kind of string
  // surgery that silently yields `undefined` the moment the separator changes.
  const undecidedIds = (): string[] =>
    [...itemById.entries()]
      .filter(([k]) => !seenDecisions.has(k))
      .map(([, item]) => item.id)
      .sort();

  // ── Chain the entries onto the existing manifest ──
  const existing = readAdoptionManifest(projRoot);
  const manifestAbs = path.join(projRoot, ADOPTION_MANIFEST_RELPATH);
  if (existing === null && fs.existsSync(manifestAbs)) {
    // Present but invalid. Appending would build a chain that verifies from the new
    // tip while the break sits underneath it, unreachable.
    return { status: "refused", reason: `${ADOPTION_MANIFEST_RELPATH} exists but is not a valid guild.adoption_manifest.v1` };
  }
  if (existing !== null && existing.project_id !== projectId) {
    return { status: "refused", reason: `existing manifest belongs to project "${existing.project_id}"` };
  }

  const chained = chainEntries(existing?.entries ?? [], pendingEntries);
  const nextManifest: AdoptionManifestV1 = {
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: projectId,
    entries: chained,
  };
  const validated = validateAdoptionManifestV1(nextManifest);
  if (validated === null) {
    return { status: "refused", reason: "the resulting manifest failed guild.adoption_manifest.v1 validation" };
  }
  const commitment = manifestDigestOf(validated);
  if (commitment === null) {
    return { status: "refused", reason: "could not compute the manifest commitment" };
  }

  if (dryRun) {
    return {
      status: "applied",
      manifest_path: ADOPTION_MANIFEST_RELPATH,
      written: Object.freeze(writes.map((w) => w.relTarget).sort()),
      compatibility_only: Object.freeze(compatibilityOnly.sort()),
      undecided: Object.freeze(undecidedIds()),
      entries_appended: pendingEntries.length,
      manifest_digest: commitment,
    };
  }

  // ── Write. Every POLICY check has passed; what remains can still fail on I/O. ──
  //
  // CODEX #3: this loop was unguarded, so a failing `mkdirSync` (e.g. a regular
  // file already occupying `.guild/skills/<id>`) threw EEXIST straight out of the
  // function AFTER the first file had been written and BEFORE the manifest existed
  // — a half-applied migration with no record of itself, directly contradicting
  // "refuses rather than partially applies". Every write is now undone on failure
  // and the whole call reports `refused`.
  const done: PlannedWrite[] = [];
  try {
    for (const w of writes) {
      // CODEX #1 (CRITICAL): `readRegularFile` returns null for a SYMLINK, so the
      // earlier existence check read a symlinked target as "absent" while
      // `writeFileSync` follows it — `.guild/agents/qa.md` pointing anywhere on
      // disk was silently overwritten with the adopted template, outside the
      // project entirely. Re-checked here, immediately before the write, and any
      // non-regular-file occupant is a refusal rather than a target.
      const st = fs.existsSync(w.absTarget) ? fs.lstatSync(w.absTarget) : null;
      if (st !== null && !st.isFile()) {
        throw new Error(
          `${w.relTarget} exists and is not a regular file (${st.isSymbolicLink() ? "symlink" : "special file"}); refusing to write through it`,
        );
      }
      // CODEX round 2: the leaf check above is not enough on its own — a symlinked
      // PARENT (`.guild/agents` → somewhere else) leaves the leaf non-existent, so
      // nothing above fires and the write escapes the project anyway. Containment
      // is proven through every intermediate link.
      const escape = escapesProjectRoot(w.absTarget, projRoot);
      if (escape !== null) throw new Error(`refusing to write ${w.relTarget}: ${escape}`);
      fs.mkdirSync(path.dirname(w.absTarget), { recursive: true });
      fs.writeFileSync(w.absTarget, w.bytes, { flag: "w" });
      done.push(w);
    }
    fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
    fs.writeFileSync(manifestAbs, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  } catch (err) {
    // Undo, newest first. Only files this call CREATED are removed — `preExisting`
    // was captured during planning, so a re-run over an already-adopted tree does
    // not delete the copy the previous run legitimately made.
    for (const w of [...done].reverse()) {
      if (w.preExisting) continue;
      try {
        fs.rmSync(w.absTarget);
      } catch {
        /* best effort: the reported refusal already tells the operator to check the tree */
      }
    }
    return {
      status: "refused",
      reason: `write failed and was rolled back: ${(err as Error).message}`,
    };
  }

  return {
    status: "applied",
    manifest_path: ADOPTION_MANIFEST_RELPATH,
    written: Object.freeze(writes.map((w) => w.relTarget).sort()),
    compatibility_only: Object.freeze(compatibilityOnly.sort()),
    undecided: Object.freeze(undecidedIds()),
    entries_appended: pendingEntries.length,
    manifest_digest: commitment,
  };
}

/** Assign sequences and `prev_digest` so the appended entries extend the chain. */
function chainEntries(
  existing: readonly AdoptionEntry[],
  pending: readonly Omit<AdoptionEntry, "sequence" | "prev_digest">[],
): AdoptionEntry[] {
  const out: AdoptionEntry[] = existing.map((e) => ({ ...e }));
  let seq = out.length;
  let prev = out.length === 0 ? null : entryDigest(out[out.length - 1]);
  for (const p of pending) {
    seq += 1;
    const entry: AdoptionEntry = { ...p, sequence: seq, prev_digest: prev };
    out.push(entry);
    prev = entryDigest(entry);
  }
  return out;
}

/**
 * The external commitment, or null when the manifest cannot produce one.
 *
 * DELEGATES to the contract's own `manifestCommitment` rather than re-deriving the
 * digest here. An independent re-implementation would agree today and drift the
 * first time the contract changes its domain separator or its committed fields —
 * and a commitment that disagrees with the verifier is worse than none, because
 * `verifyAgainstTip` would reject a manifest this writer just produced.
 */
function manifestDigestOf(manifest: AdoptionManifestV1): string | null {
  const c = manifestCommitment(manifest);
  return c.ok ? c.digest : null;
}

/**
 * Build the successor `guild.project_definition_ref.v1`.
 *
 * For `kind: "agent"` S2 requires BOTH identity hashes, so the type is projected
 * from the shipped template's frontmatter and the profile from the adopted file's.
 * A ref that cannot bind its identity returns null and refuses the whole apply —
 * a half-bound agent ref cannot complete the receipt chain.
 */
function buildProjectDefinitionRef(args: {
  projectId: string;
  /**
   * INTEGRATION (five-branch stack): S2 amended `ProjectDefinitionRefV1` to carry a
   * REQUIRED `layer` (task #27, second half). It is DECLARED data — the contract
   * deliberately refuses to derive it from `relative_path` — so the caller must say
   * which tier the successor bytes live in, and the validator cross-checks the
   * declaration against the path via `layerAgreesWithPath`.
   */
  layer: DefinitionLayer;
  kind: "agent" | "skill";
  id: string;
  relativePath: string;
  bytes: Buffer;
  pluginRoot: string;
  legacyId: string;
}): ProjectDefinitionRefV1 | null {
  let profileHash: string | null = null;
  let typeHash: string | null = null;

  if (args.kind === "agent") {
    const templateAbs = path.join(args.pluginRoot, "templates", "specialists", `${args.legacyId}.md`);
    const templateBytes = readRegularFile(templateAbs);
    if (templateBytes === null) return null;
    const templateFm = parseFrontmatter(templateBytes.toString("utf8"));
    if (templateFm === null) return null;
    const type = specialistTypeFromTemplateFrontmatter(templateFm);
    if (type === null) return null;
    typeHash = hashSpecialistType(type);

    const agentFm = parseFrontmatter(args.bytes.toString("utf8"));
    if (agentFm === null) return null;
    const profile = specialistProfileFromAgentFrontmatter(agentFm, {
      type_id: type.type_id,
      type_version: type.version,
      type_hash: typeHash,
    });
    if (profile === null) return null;
    profileHash = hashSpecialistProfile(profile);
  }

  return validateProjectDefinitionRefV1({
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: args.projectId,
    layer: args.layer,
    kind: args.kind,
    id: args.id,
    relative_path: args.relativePath,
    content_hash: sha256Prefixed(args.bytes),
    source_commit: null,
    specialist_profile_hash: profileHash,
    specialist_type_hash: typeHash,
    skills: [],
  });
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export type AdoptionRollbackOutcome =
  | {
      readonly status: "rolled_back";
      /**
       * Project-relative paths ACTUALLY removed, sorted — verified against disk,
       * never assumed from intent (CODEX round 3: this used to list files whose
       * removal had thrown and been swallowed).
       */
      readonly removed: readonly string[];
      /**
       * Removals that were attempted and FAILED, as `path: reason`. Reported
       * rather than swallowed: the reversal is recorded in the manifest either
       * way, so a leftover file is a real thing the operator must clear, and a
       * success report that hides it is a lie about the tree's state.
       */
      readonly removal_failed: readonly string[];
      /**
       * Adopted copies LEFT IN PLACE because they were edited after adoption.
       * Reported, never deleted: R11 says a rollback must not destroy evidence,
       * and hand-edited work is evidence.
       */
      readonly kept_local_edits: readonly string[];
      /** Ids returned to the compatibility surface, sorted. */
      readonly restored_ids: readonly string[];
      readonly entries_appended: number;
      readonly manifest_digest: string;
    }
  | { readonly status: "refused"; readonly reason: string };

const ROLLBACK_KEYS = [
  "pluginRoot",
  "projectRoot",
  "projectId",
  "runId",
  "adoptedAt",
  "authorizedBy",
  "reason",
  "sequences",
  "dryRun",
] as const;

/**
 * ONE-COMMAND ROLLBACK. Reverses adoption entries by APPENDING `rolled_back`
 * entries — never by deleting history.
 *
 * That is the R11/R14 constraint made structural: the manifest is append-only, so
 * a rollback is a new forward fact ("this adoption was reversed on this date by
 * this decision"), not an erasure. `resolveHistorical` already understands the
 * shape — a `rolled_back` edge rewinds the lineage so a later re-adoption resolves
 * as new history rather than a cycle.
 *
 * The copied FILES are removed (that is what makes the legacy path live again),
 * but only when their bytes still match what the adoption wrote. A file the
 * operator has since edited is LEFT IN PLACE and reported: deleting hand-edited
 * work to satisfy a rollback would destroy exactly the evidence R11 protects.
 *
 * Omitting `sequences` rolls back every un-reversed entry — the one-command form.
 */
export function rollbackAdoption(opts: unknown): AdoptionRollbackOutcome {
  const o = readOptions(opts, ROLLBACK_KEYS);
  if (o === null) return { status: "refused", reason: "options object rejected (proxy/accessor/symbol/unknown key)" };

  const projectRoot = o["projectRoot"];
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    return { status: "refused", reason: "projectRoot is required" };
  }
  const projRoot = path.resolve(projectRoot);

  // Required, because a reversal entry must rebuild the ORIGINAL identity as a
  // ref (S3 proves a rollback lands back on the target's source), and that means
  // re-reading the shipped bytes.
  const pluginRoot = o["pluginRoot"];
  if (typeof pluginRoot !== "string" || pluginRoot.length === 0) {
    return { status: "refused", reason: "pluginRoot is required — a reversal must rebuild the original identity" };
  }
  const pRoot = path.resolve(pluginRoot);

  const projectId = o["projectId"];
  if (!isToken(projectId)) return { status: "refused", reason: "projectId is not a token" };
  const runId = o["runId"];
  if (!isToken(runId)) return { status: "refused", reason: "runId is not a token" };
  const authorizedBy = o["authorizedBy"];
  if (!isToken(authorizedBy)) return { status: "refused", reason: "authorizedBy is not a token" };
  const adoptedAt = o["adoptedAt"];
  if (typeof adoptedAt !== "string" || !RFC3339.test(adoptedAt)) {
    return { status: "refused", reason: "adoptedAt must be an RFC3339 UTC timestamp" };
  }
  const reasonNote = o["reason"];
  if (typeof reasonNote !== "string" || reasonNote.length === 0 || reasonNote.length > 2048 || CONTROL_CHARS.test(reasonNote)) {
    // S3 REQUIRES a detail for `rolled_back`. It is the field that explains, months
    // later, why the project went back.
    return { status: "refused", reason: "reason is required for a rollback and must be a bounded plain string" };
  }
  const dryRunRaw = o["dryRun"];
  if (dryRunRaw !== undefined && typeof dryRunRaw !== "boolean") {
    return { status: "refused", reason: "dryRun must be a boolean" };
  }
  const dryRun = dryRunRaw === true;

  const manifest = readAdoptionManifest(projRoot);
  if (manifest === null) return { status: "refused", reason: `no valid ${ADOPTION_MANIFEST_RELPATH} to roll back` };
  if (manifest.project_id !== projectId) {
    return { status: "refused", reason: `manifest belongs to project "${manifest.project_id}"` };
  }

  const alreadyReversed = new Set<number>();
  for (const e of manifest.entries) {
    if (e.reason === "rolled_back" && e.reverses_sequence !== null) alreadyReversed.add(e.reverses_sequence);
  }

  let targets: AdoptionEntry[];
  const seqRaw = o["sequences"];
  if (seqRaw === undefined || seqRaw === null) {
    targets = manifest.entries.filter(
      (e) => e.reason !== "rolled_back" && !alreadyReversed.has(e.sequence),
    );
  } else {
    const list = readArray(seqRaw);
    if (list === null) return { status: "refused", reason: "sequences is not a dense plain array" };
    targets = [];
    for (const s of list) {
      if (typeof s !== "number" || !Number.isSafeInteger(s) || s < 1) {
        return { status: "refused", reason: `not a sequence number: ${String(s)}` };
      }
      const found = manifest.entries.find((e) => e.sequence === s);
      if (found === undefined) return { status: "refused", reason: `no entry at sequence ${s}` };
      if (found.reason === "rolled_back") return { status: "refused", reason: `sequence ${s} is itself a rollback` };
      // Refused, not skipped: reversing twice would make the manifest claim two
      // returns from one departure.
      if (alreadyReversed.has(s)) return { status: "refused", reason: `sequence ${s} is already reversed` };
      targets.push(found);
    }
  }

  if (targets.length === 0) return { status: "refused", reason: "nothing to roll back" };

  const removals: Array<{ abs: string; rel: string }> = [];
  const kept: string[] = [];
  const pending: Array<Omit<AdoptionEntry, "sequence" | "prev_digest">> = [];

  // Newest first, so a lineage unwinds in reverse order of how it was built.
  for (const target of [...targets].sort((a, b) => b.sequence - a.sequence)) {
    // S3's cross-entry proof: a `rolled_back` entry must start where the target
    // LANDED and finish on the target's SOURCE identity — same id, same bytes, in
    // both directions. A removal (`to === null`) has nothing to roll back to, and
    // the validator says so; refuse rather than emit an entry it will reject.
    if (target.to === null) {
      return {
        status: "refused",
        reason: `sequence ${target.sequence} is a removal with no successor — there is nothing to roll back to`,
      };
    }

    // CODEX #2: removal was driven by hash equality alone, which proves the file is
    // UNCHANGED, not that the migration CREATED it. A `substitute` writes nothing —
    // it maps a legacy id onto a definition the operator already authored — so
    // rolling one back deleted that hand-authored file. Only `migrated` entries
    // (adopt_as_is / refine) ever created a file, so only they may remove one.
    if (target.reason === "migrated") {
      const abs = path.join(projRoot, target.to.relative_path);
      const bytes = readRegularFile(abs);
      if (bytes !== null) {
        if (sha256Prefixed(bytes) === target.to.content_hash) {
          removals.push({ abs, rel: target.to.relative_path });
        } else {
          // Edited since adoption. LEFT IN PLACE and reported via `kept`, because
          // destroying hand-edited work is never the right way to undo a copy — and
          // R11 says a rollback must not destroy evidence.
          kept.push(target.to.relative_path);
        }
      }
    } else {
      // rehomed / renamed / collapsed: the successor pre-dated the migration. The
      // manifest entry is reversed, the FILE is untouched, and it is reported so the
      // operator can see the rollback deliberately left something behind.
      kept.push(target.to.relative_path);
    }

    // Rebuild the ORIGINAL identity as a ref. Its `content_hash` must equal the
    // target's `from.content_hash`, so the shipped bytes are re-read and checked
    // rather than trusted: a shipped asset that changed underneath us means the
    // identity we would be restoring is not the one that was adopted away.
    const shippedAbs = target.from.historical_path;
    const shippedBytes = readRegularFile(shippedAbs);
    if (shippedBytes === null) {
      return {
        status: "refused",
        reason: `cannot restore ${target.kind} "${target.from.id}": its original source is unreadable at ${shippedAbs}`,
      };
    }
    if (
      target.from.content_hash !== null &&
      sha256Prefixed(shippedBytes) !== target.from.content_hash
    ) {
      return {
        status: "refused",
        reason: `cannot restore ${target.kind} "${target.from.id}": the original source bytes changed since adoption`,
      };
    }
    const shippedRel = toPosixRel(shippedAbs, pRoot);
    if (shippedRel === null) {
      return {
        status: "refused",
        reason: `original source for "${target.from.id}" is not under the given pluginRoot`,
      };
    }
    // NOTE on `relative_path`: the restored definition lives on the COMPATIBILITY
    // SURFACE, which is plugin-relative, while the field is documented as
    // project-relative. The contract has no third state — `to: null` means
    // `removed`, which a rollback is not — so the plugin-relative path is recorded
    // and `home` on the `from` side says which world each end belongs to. Flagged
    // rather than hidden: a future `restored` reason with its own locator would
    // express this without the overload.
    const restored = buildProjectDefinitionRef({
      projectId,
      // S3's landing proof is explicit: `entry.to.layer !== target.from.home` is a
      // rejection — a reversal must land in the LAYER it left, not merely the root.
      // Reading the layer off the target instead of hardcoding `plugin-shipped`
      // keeps the two in step by construction rather than by coincidence.
      layer: target.from.home,
      kind: target.kind,
      id: target.from.id,
      relativePath: shippedRel,
      bytes: shippedBytes,
      pluginRoot: pRoot,
      legacyId: target.from.id,
    });
    if (restored === null) {
      return {
        status: "refused",
        reason: `could not rebuild the original identity for ${target.kind} "${target.from.id}"`,
      };
    }

    pending.push({
      kind: target.kind,
      from: {
        // The rollback DEPARTS from wherever the target LANDED, so both halves of
        // that placement are read off `target.to` rather than restated. S3's LIFO
        // unwind looks the era up under a root-and-layer-bearing identity, so a
        // restated constant that drifted from `target.to` would silently fail to
        // pop the era it names.
        project_id: target.to.project_id,
        id: target.to.id,
        historical_path: path.join(projRoot, target.to.relative_path),
        content_hash: target.to.content_hash,
        home: target.to.layer,
      },
      to: restored,
      reason: "rolled_back",
      detail: `${reasonNote} (reverses sequence ${target.sequence})`,
      reverses_sequence: target.sequence,
      adopted_at: adoptedAt,
      run_id: runId,
      authorized_by: authorizedBy,
    });
  }

  const chained = chainEntries(manifest.entries, pending);
  const next: AdoptionManifestV1 = {
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: projectId,
    entries: chained,
  };
  const validated = validateAdoptionManifestV1(next);
  if (validated === null) {
    return { status: "refused", reason: "the rolled-back manifest failed guild.adoption_manifest.v1 validation" };
  }
  const digest = manifestDigestOf(validated);
  if (digest === null) return { status: "refused", reason: "could not compute the manifest commitment" };

  const restoredIds = [...new Set(targets.map((t) => t.from.id))].sort();

  // CODEX round 2, same class as the write path: a DELETE that escapes the project
  // is worse than a write that does. Containment is proven before anything is
  // unlinked, and an escaping path aborts the whole rollback rather than being
  // skipped — a rollback that silently declines to undo part of itself would leave
  // the manifest claiming a reversal that did not happen.
  for (const r of removals) {
    const escape = escapesProjectRoot(r.abs, projRoot);
    if (escape !== null) {
      return { status: "refused", reason: `refusing to remove ${r.rel}: ${escape}` };
    }
  }

  // ── The mutation phase ──
  //
  // CODEX round 3 found TWO defects here, both the partial-application class that
  // `applyAdoptionPlan` was already fixed for but this path was not:
  //
  //   (a) THE MANIFEST WRITE COULD THROW. With a read-only manifest the EACCES
  //       escaped a function documented as never throwing — and by then the
  //       adopted copy had ALREADY been deleted, so the project was left with the
  //       file gone and no record that the reversal happened. Silent, and the
  //       worst possible ordering.
  //   (b) `removed` LIED. With a read-only parent directory `fs.rmSync` threw, the
  //       catch swallowed it, and the outcome still reported
  //       `removed: [".guild/agents/qa.md"]` while the file was still on disk.
  //       A report that claims a deletion that did not happen is worse than the
  //       failed deletion.
  //
  // THE MANIFEST IS WRITTEN FIRST, and a failure there means nothing was touched:
  // the manifest is the append-only record of truth, so if it cannot be written
  // the rollback did not happen. Removals follow, each VERIFIED, and any that
  // fails is REPORTED in `removal_failed` rather than swallowed — the reversal is
  // genuinely recorded, and the leftover file is the operator's to clear.
  const removed: string[] = [];
  const removalFailed: Array<{ path: string; reason: string }> = [];

  if (!dryRun) {
    const manifestAbs = path.join(projRoot, ADOPTION_MANIFEST_RELPATH);
    try {
      fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
      fs.writeFileSync(manifestAbs, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    } catch (err) {
      return {
        status: "refused",
        reason: `could not write ${ADOPTION_MANIFEST_RELPATH} (${(err as Error).message}); nothing was removed`,
      };
    }

    for (const r of removals) {
      try {
        fs.rmSync(r.abs);
        // Verified, not assumed: `rmSync` can succeed against a path that is then
        // re-created, and on some filesystems a failure is not an exception.
        if (fs.existsSync(r.abs)) {
          removalFailed.push({ path: r.rel, reason: "still present after removal" });
          continue;
        }
        removed.push(r.rel);
        // A skill's directory is only removed when the removal emptied it.
        const dir = path.dirname(r.abs);
        if (dir !== projRoot && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
      } catch (err) {
        // A file that vanished on its own is already in the state the rollback
        // wanted, and counts as removed. Anything else is a real failure and is
        // NAMED — never swallowed into a success report.
        if (!fs.existsSync(r.abs)) removed.push(r.rel);
        else removalFailed.push({ path: r.rel, reason: (err as Error).message });
      }
    }
  } else {
    // A dry run reports what it WOULD remove, without claiming it happened.
    removed.push(...removals.map((r) => r.rel));
  }

  return {
    status: "rolled_back",
    removed: Object.freeze(removed.sort()),
    removal_failed: Object.freeze(
      removalFailed.map((f) => `${f.path}: ${f.reason}`).sort(),
    ),
    kept_local_edits: Object.freeze([...kept].sort()),
    restored_ids: Object.freeze(restoredIds),
    entries_appended: pending.length,
    manifest_digest: digest,
  };
}
