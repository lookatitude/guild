/**
 * src/modules/state/workflows/upgrade-steps.ts
 *
 * THE PINNED STEP CATALOG (spec gap G-b). Nine ids, fixed for layout 2. A step id
 * is a contract: it is what the journal resumes by, what `config migrate` prints,
 * and what T09 / T11 / T17 reference. Renaming one breaks every journal on disk.
 *
 *   v1-content                 §21.7   durable     legacy `.guild` content conversion
 *   settings-policy-split      §21.6   durable     settings.json → config/{project,workspace}.json
 *   ktd22-host-identity-strip  KTD22   durable     host/model ids off initiative + team files
 *   caches-out                 §21.11  safe-local  derived indexes/catalogs off `.guild`
 *   closed-run-receipts        §21.10  durable     a receipt per terminal legacy run
 *   current-run-id-retire      §21.10  safe-local  the singleton sentinel V2 never recreates
 *   skill-versions-delete      §21.12  safe-local  leftover version-snapshot trees (R60)
 *   registry-yaml-retire       KTD56   durable     derived registries out, authored ones preserved
 *   glossary-create            R80     durable     the root glossary page if missing (KTD70)
 *
 * TWO CLASSES, ONE RULE (§21.3). `safe-local` steps touch nothing git tracks under
 * `.guild/` and therefore run even on a dirty tree. `durable` steps rewrite tracked
 * paths and run ONLY when the paths they declare are clean — otherwise the runner
 * blocks them, leaves v1 content in place, and prints the dirty paths.
 *
 * DELETION IS CLASSIFIED, NOT ASSUMED. `classifyPath` answers derived-vs-durable
 * for one repo-relative path. A step that wants to delete anything NOT derived
 * returns `blocked_confirm` with the exact question; it never deletes and never
 * decides on the operator's behalf (the lane's autonomy contract).
 *
 * IDEMPOTENCE IS PER STEP, NOT PER RUN. Each `apply` re-detects its own need and
 * returns `skipped` when there is nothing to do. That is what makes "already-
 * converted unmarked v2" a no-op and what makes crash-resume safe.
 *
 * CONTRACT: no network, no git, no process spawn (the runner owns the git gate).
 * Everything outside `.guild/` is reached through the injected `GuildStorage`.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { GLOSSARY_FEEDSTOCK } from "./upgrade-glossary";
import { isContainedRealDir, lstatSafe, readdirSafe, removeContainedTree } from "./storage-fs";
import { DURABLE_SUBTREES } from "./storage-policy";
import type { GuildStorage } from "./storage-layout";
// The step catalog is a closed collection: deep-frozen through the kernel primitive
// the closed-collection rail trusts (steps and their `affects` lists included).
import { deepFreeze, loadYamlApi } from "../../kernel";

export type StepClass = "safe-local" | "durable";

/**
 * Repo-relative prefix of the canonical knowledge tree. Derived from
 * `DURABLE_SUBTREES`, never spelled by hand, so repointing the tree moves the
 * dirty-gate declaration with it (KTD15).
 */
const KNOWLEDGE_PREFIX = `.guild/${DURABLE_SUBTREES.knowledge}`;

/**
 * The v1 converter, injected. The converter lives on the host-facing `scripts/`
 * side; a domain module must not reach into it (module-boundary law, KTD27), so
 * the CLI and the activation entry pass it down. With no provider the step is a
 * recorded `skipped`, never a silent success.
 */
export type V1ContentConverter = (opts: { root: string; dryRun: boolean }) => {
  classification: string;
  action: string;
  changed: number;
  reportPath?: string;
  /** A pipeline-level abort (snapshot verify failed, corrupt tree). */
  error?: string;
  /** Non-fatal converter complaints. Also treated as a step FAILURE (see below). */
  warnings?: readonly string[];
};

export interface UpgradeStepContext {
  /** Repo root. `.guild/` hangs off it. */
  root: string;
  guildDir: string;
  storage: GuildStorage;
  /** When true a step computes its result and writes NOTHING. */
  dryRun: boolean;
  now(): string;
  v1?: V1ContentConverter;
  /** Injected by the entry point (see PolicyClassifier). */
  policy?: PolicyClassifier;
}

export interface UpgradeStepResult {
  status: "completed" | "skipped" | "blocked_confirm" | "failed";
  detail: string;
  /** Repo-relative paths the step wrote, moved or removed. */
  paths: string[];
  /** Present only on `blocked_confirm` — the exact question, verbatim. */
  question?: string;
}

export interface UpgradeStep {
  id: string;
  cls: StepClass;
  /** Proposal / law reference this step implements. Printed by `config migrate`. */
  source: string;
  /**
   * Repo-relative durable prefixes this step may rewrite. The runner intersects
   * these with the dirty tracked set; an empty list means "no durable surface".
   */
  affects: readonly string[];
  apply(ctx: UpgradeStepContext): UpgradeStepResult;
}

// ── Derived-vs-durable ───────────────────────────────────────────────────────

/**
 * Repo-relative (to `.guild/`) paths that are REBUILDABLE. Deleting one loses
 * nothing a later run cannot recompute, so a step may remove it without asking.
 * Everything not matched here is durable: a step may move or preserve it, never
 * delete it unattended.
 */
const DERIVED_PATTERNS: readonly RegExp[] = Object.freeze([
  /^indexes(\/|$)/,
  /^index\.sqlite$/,
  /^hosts(\/|$)/,
  /^current-run-id$/,
  /^agents\/registry\.yaml$/,
  /^skills\/registry\.yaml$/,
  /^bus\/\.lock$/,
  /(^|\/)\.tmp-[^/]+$/,
]);

export type PathClass = "derived" | "durable";

/** Classify ONE path, given relative to `.guild/`. */
export function classifyPath(relToGuild: string): PathClass {
  const rel = relToGuild.split(path.sep).join("/");
  return DERIVED_PATTERNS.some((re) => re.test(rel)) ? "derived" : "durable";
}

// ── Small shared helpers ─────────────────────────────────────────────────────

function rel(ctx: UpgradeStepContext, abs: string): string {
  return path.relative(ctx.root, abs).split(path.sep).join("/");
}

/**
 * The canonical knowledge tree for this root, through the storage API. A step
 * never spells the tree's on-disk name: `DURABLE_SUBTREES.knowledge` owns that,
 * and repointing it must move every writer at once (KTD15).
 */
function knowledgeDir(ctx: UpgradeStepContext, ...segments: string[]): string {
  const scope = ctx.storage.project ?? ctx.storage.workspace;
  if (!scope) throw new Error("root owns no durable scope: cannot name the knowledge tree");
  return scope.knowledge(...segments);
}

function readIfFile(abs: string): string | null {
  const st = lstatSafe(abs);
  if (!st || !st.isFile()) return null;
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function writeFile(ctx: UpgradeStepContext, abs: string, text: string): void {
  if (ctx.dryRun) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Every file under `dir`, absolute, depth-first. Bounded to `dir`; no symlink walk. */
function filesUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSafe(dir)) {
    const abs = path.join(dir, name);
    const st = lstatSafe(abs);
    if (!st) continue;
    if (st.isDirectory()) filesUnder(abs, out);
    else if (st.isFile()) out.push(abs);
  }
  return out;
}

function setByPath(target: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let node = target;
  for (const seg of parts.slice(0, -1)) {
    const next = node[seg];
    if (typeof next !== "object" || next === null || Array.isArray(next)) node[seg] = {};
    node = node[seg] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

function getByPath(source: unknown, dotted: string): unknown {
  let node: unknown = source;
  for (const seg of dotted.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** Flatten a settings tree to dotted leaves (objects recurse; arrays are leaves). */
function flatten(value: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/**
 * The closed policy-key contract (KTD22), INJECTED — never imported.
 *
 * `state` must not pull the `config` barrel into its own graph: doing so drags
 * config's whole transitive fan-out into every bundle that touches storage, which
 * is exactly the KTD29 regression `require-graph` exists to catch (measured: the
 * `status` entrypoint went from 2 domains to 15). The entry point that already
 * needs config passes these three functions down instead.
 */
export interface PolicyClassifier {
  canonicalPolicyKey(dotted: string): string;
  isPolicyKey(dotted: string): boolean;
  findHostIdentity(key: string, value: unknown): { kind: string; token: string } | null;
}

/**
 * Fallback when no classifier was injected. It classifies NOTHING, which makes the
 * two policy steps report `skipped` with the reason rather than quietly transfer
 * the wrong keys or strip the wrong lines. Silence would be the dangerous default.
 */
export const NO_CLASSIFIER: PolicyClassifier = {
  canonicalPolicyKey: (dotted) => dotted,
  isPolicyKey: () => false,
  findHostIdentity: () => null,
};

// ── 1. v1-content (§21.7) ────────────────────────────────────────────────────

const v1Content: UpgradeStep = {
  id: "v1-content",
  cls: "durable",
  source: "proposal §21.7",
  affects: [".guild"],
  apply(ctx) {
    if (!ctx.v1) {
      return {
        status: "skipped",
        detail: "no v1 converter provided by this entry point; legacy content left untouched",
        paths: [],
      };
    }
    const r = ctx.v1({ root: ctx.root, dryRun: ctx.dryRun });
    // A converter complaint is a STEP FAILURE, never a silent pass. The converter
    // aborts on a failed snapshot verify and on a corrupt tree; swallowing that
    // here would let the runner validate a tree the converter refused to touch and
    // stamp the marker over it.
    const complaints = [r.error, ...(r.warnings ?? [])].filter((m): m is string => typeof m === "string" && m !== "");
    if (complaints.length > 0 || r.action === "error" || r.action === "corrupt-blocked") {
      return {
        status: "failed",
        detail: `v1 converter reported ${complaints.length || 1} problem(s): ${complaints.join("; ") || r.action}`,
        paths: [],
      };
    }
    if (r.classification === "v2" || r.classification === "none" || r.action === "v2-noop" || r.action === "none") {
      return { status: "skipped", detail: `v1 converter: ${r.classification}/${r.action} — nothing to convert`, paths: [] };
    }
    return {
      status: "completed",
      detail: `v1 converter: ${r.classification}/${r.action}, ${r.changed} artifact(s)`,
      paths: [".guild"],
    };
  },
};

// ── 2. settings-policy-split (§21.6) ─────────────────────────────────────────

/**
 * ONE-TIME transfer of POLICY keys out of the v1 `settings.json` grab-bag into the
 * scoped policy files. The hybrid root is the case the proposal calls out: the
 * single legacy file served BOTH roles, so it splits into both targets — once.
 *
 * Inventory keys (`models.tiers.*`, `host`, `host_profiles`, `roles.*.host`) are
 * NOT transferred: KTD22 makes them session state, and `ktd22-host-identity-strip`
 * is not their home either — they simply do not survive the split. `settings.json`
 * itself is LEFT IN PLACE (it is durable, not derived; deleting it is the
 * operator's call), so nothing is lost when a user disagrees with the split.
 */
const settingsPolicySplit: UpgradeStep = {
  id: "settings-policy-split",
  cls: "durable",
  source: "proposal §21.6",
  affects: [".guild/settings.json", ".guild/config"],
  apply(ctx) {
    const legacy = readIfFile(path.join(ctx.guildDir, "settings.json"));
    if (legacy === null) return { status: "skipped", detail: "no .guild/settings.json to split", paths: [] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(legacy);
    } catch {
      return { status: "skipped", detail: ".guild/settings.json is not parseable JSON — preserved, not split", paths: [] };
    }

    if (!ctx.policy) {
      return { status: "skipped", detail: "no policy classifier injected; settings.json left unsplit", paths: [] };
    }
    const cfg = ctx.policy;
    const flat = flatten(parsed);
    const policy: Record<string, unknown> = {};
    let dropped = 0;
    for (const [key, value] of Object.entries(flat)) {
      const canonical = cfg.canonicalPolicyKey(key);
      if (!cfg.isPolicyKey(canonical)) {
        dropped += 1;
        continue;
      }
      if (cfg.findHostIdentity(canonical, value) !== null) {
        dropped += 1;
        continue;
      }
      setByPath(policy, canonical, value);
    }

    // Which scopes this root owns decides which files receive the transfer. The
    // storage API already answers that (`profile`), so the step does not re-derive it.
    const targets: string[] = [];
    if (ctx.storage.project) targets.push(ctx.storage.project.config());
    if (ctx.storage.workspace) targets.push(ctx.storage.workspace.config());
    if (targets.length === 0) return { status: "skipped", detail: "root owns no durable config scope", paths: [] };

    const written: string[] = [];
    for (const target of targets) {
      const existing = readIfFile(target);
      let base: Record<string, unknown> = {};
      if (existing !== null) {
        // A TARGET we cannot parse is the operator's file in an unknown state.
        // Starting from `{}` and writing over it destroys whatever was there, so
        // the step stops and asks. It never replaces a malformed durable target.
        try {
          const value = JSON.parse(existing) as unknown;
          if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("top level is not a JSON object");
          }
          base = value as Record<string, unknown>;
        } catch (e) {
          const where = rel(ctx, target);
          return {
            status: "blocked_confirm",
            detail: `${where} is not parseable JSON (${(e as Error).message}) — left byte-identical, not replaced`,
            paths: [where],
            question:
              `settings-policy-split cannot read ${where}: ${(e as Error).message}. ` +
              `Fix or remove that file, then re-run the upgrade. Replace it with a fresh policy file?`,
          };
        }
      }
      // ONCE: a key already present in the policy file is the user's, not ours.
      let added = 0;
      for (const [key, value] of Object.entries(flatten(policy))) {
        if (getByPath(base, key) !== undefined) continue;
        setByPath(base, key, value);
        added += 1;
      }
      if (added === 0) continue;
      writeFile(ctx, target, `${JSON.stringify(base, null, 2)}\n`);
      written.push(rel(ctx, target));
    }

    if (written.length === 0) {
      return { status: "skipped", detail: "policy keys already present in every scoped config file", paths: [] };
    }
    return {
      status: "completed",
      detail:
        `split ${Object.keys(flatten(policy)).length} policy key(s) into ${written.join(" + ")}` +
        (dropped > 0 ? `; ${dropped} non-policy/inventory key(s) not transferred (KTD22)` : "") +
        (written.length === 2 ? "; hybrid root — the legacy dual-role file was split into both scopes" : ""),
      paths: written,
    };
  },
};

// ── 3. ktd22-host-identity-strip ─────────────────────────────────────────────

/** Keys whose presence in a durable record pins the work to one host (KTD22). */
const PINNED_KEYS = /^(host|host_id|host_family|model|model_id|model_name|models)$/;

/**
 * A timestamp js-yaml resolves to a `Date`. Dates are never host identity, and the
 * two identity tests below must agree whether they are handed the raw line text or
 * the parsed value — so both sides skip the value-based test for a timestamp.
 */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}([Tt ].*)?$/;

/** A YAML scalar we are willing to judge. Mappings and sequences are recursed into. */
function isPlainScalar(v: unknown): boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/**
 * THE ONE identity decision, called from both sides of this step: the line scanner
 * (which has the raw text of the value) and the verification transform (which has
 * the parsed value). They must never disagree, or a correct edit reads as a
 * corruption and the step blocks for no reason.
 */
function isIdentityEntry(key: string, raw: string | undefined, parsed: unknown, cfg: PolicyClassifier): boolean {
  const isDate = parsed instanceof Date || (raw !== undefined && TIMESTAMP_RE.test(raw));
  const text = raw !== undefined ? raw : isPlainScalar(parsed) ? String(parsed) : undefined;
  const scalar = raw !== undefined ? raw !== "" : isPlainScalar(parsed) && String(parsed) !== "";
  if (!scalar) return false;
  // A multi-line value is a block scalar: prose, never a host pin. The line scanner
  // only ever sees its `|` header, so the parsed side must agree and skip it too —
  // otherwise a note that merely MENTIONS a host id reads as identity on one side.
  if (text !== undefined && text.includes("\n")) return false;
  if (PINNED_KEYS.test(key)) return true;
  if (isDate || text === undefined) return cfg.findHostIdentity(key, "") !== null;
  return cfg.findHostIdentity(key, text) !== null;
}

// ── the verification transform ───────────────────────────────────────────────

/**
 * What the file's DATA must look like after the edit. Never used to produce output —
 * output is always the original bytes minus the lines we removed. This exists only
 * so the step can prove its text surgery changed exactly what it meant to change.
 *
 * Anything that is not a plain object or array is opaque: a `Date`, a number, a
 * boolean and `null` pass through untouched. Rebuilding them was the r1 defect.
 */
function expectedAfterStrip(node: unknown, cfg: PolicyClassifier): unknown {
  if (Array.isArray(node)) {
    const out: unknown[] = [];
    for (const item of node) {
      const wasNonEmptyMapping = isPlainObject(item) && Object.keys(item as object).length > 0;
      const next = expectedAfterStrip(item, cfg);
      // An item whose ONLY content was identity is the item this step removes.
      if (wasNonEmptyMapping && isPlainObject(next) && Object.keys(next as object).length === 0) continue;
      out.push(next);
    }
    return out;
  }
  if (!isPlainObject(node)) return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isIdentityEntry(key, undefined, value, cfg)) continue;
    out[key] = expectedAfterStrip(value, cfg);
  }
  return out;
}

function isPlainObject(v: unknown): boolean {
  return v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
}

/** Structural equality that understands `Date` (js-yaml's timestamp type). */
function sameData(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameData(item, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every(
      (k) => kb.includes(k) && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return a === b;
}

// ── the line scanner ─────────────────────────────────────────────────────────

interface ScanLine {
  idx: number;
  indent: number;
  dash: boolean;
  /** Column the key starts at (after `- ` on a dash line). */
  keyCol: number;
  key: string | null;
  /** Inline value text with a trailing comment and surrounding quotes removed. */
  value: string | undefined;
  /** The trailing `# comment` on this line, verbatim, or null. */
  comment: string | null;
  /** Inline value exactly as written, for flow / anchor detection. */
  rawValue: string;
}

/** `key: |`, `key: >`, with an optional explicit indentation / chomping indicator. */
const BLOCK_SCALAR = /:\s*[|>]([0-9]?)[+-]?\s*(#.*)?$/;
const MAP_ENTRY = /^(\s*)(?:(-)(\s+))?("[^"]*"|'[^']*'|[^\s#][^:]*?):(?:(\s+)(.*))?$/;

/**
 * Split an inline value from its trailing `# comment`.
 *
 * The comment half is what r2 threw away with the line. It is the operator's note
 * about the entry, not part of the entry, so it survives the entry's removal.
 */
export function splitInlineValue(rawValue: string): { value: string; comment: string | null } {
  // `key:   # note` has NO value: the whole tail is the comment, and the key still
  // opens a block. Reading the comment as the value hid such a key from the
  // empty-container repair.
  if (rawValue.trimStart().startsWith("#")) return { value: "", comment: rawValue.trim() };
  const quote = /^["']/.exec(rawValue.trimStart());
  if (quote) {
    const text = rawValue.trimStart();
    const q = text[0];
    let i = 1;
    while (i < text.length) {
      if (q === '"' && text[i] === "\\") i += 2;
      // A doubled apostrophe is an ESCAPED quote inside a single-quoted scalar
      // (codex G-lane r4): it does not close the value.
      else if (q === "'" && text[i] === "'" && text[i + 1] === "'") i += 2;
      else if (text[i] === q) break;
      else i += 1;
    }
    const rest = text.slice(i + 1).trim();
    return { value: text.slice(1, i), comment: rest.startsWith("#") ? rest : null };
  }
  // YAML opens a comment at `#` preceded by ANY whitespace, tab included (r4).
  const hash = rawValue.search(/[ \t]#/);
  if (hash >= 0) return { value: rawValue.slice(0, hash).trim(), comment: rawValue.slice(hash + 1).trim() };
  return { value: rawValue.trim(), comment: null };
}

/**
 * Index the document's structural lines. Lines inside a block scalar (`key: |`)
 * are NOT indexed: their content is user text and must never be read as YAML.
 *
 * THE CONTENT INDENT IS THE KEY'S, NOT THE DASH'S. For `  - notes: |` the scalar's
 * content is indented relative to `notes`, not relative to `-`. Taking it from the
 * dash swallowed the item's sibling keys (`host:`, `role:`) as scalar text, so the
 * pin was never seen and the step reported `skipped` with the identity still there.
 * The indent comes from the explicit indicator when there is one, otherwise from
 * the first non-empty line after the header; a sibling at the key column ends it.
 */
function scanLines(lines: string[]): { scan: ScanLine[]; protectedLines: Set<number> } {
  const scan: ScanLine[] = [];
  const protectedLines = new Set<number>();
  /** Set while a block scalar header has been seen but its content indent is not known yet. */
  let pending: { base: number; explicit: number | null } | null = null;
  let contentIndent: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const blank = line.trim() === "";
    const indent = line.length - line.trimStart().length;

    if (pending !== null || contentIndent !== null) {
      if (blank) {
        protectedLines.add(i);
        continue;
      }
      if (contentIndent === null) {
        const base = pending!.base;
        const resolved = pending!.explicit !== null ? base + pending!.explicit : indent;
        if (resolved <= base) {
          // An empty block scalar: this line already belongs to the parent again.
          pending = null;
        } else {
          contentIndent = resolved;
          pending = null;
          if (indent >= contentIndent) {
            protectedLines.add(i);
            continue;
          }
          contentIndent = null;
        }
      } else if (indent >= contentIndent) {
        protectedLines.add(i);
        continue;
      } else {
        contentIndent = null;
      }
    }

    if (blank || /^\s*#/.test(line)) continue;
    const m = MAP_ENTRY.exec(line);
    if (!m) continue;
    const [, pad, dash, dashGap, key, , rawValue] = m;
    const keyCol = pad.length + (dash ? 1 + (dashGap ?? "").length : 0);
    const header = BLOCK_SCALAR.exec(line);
    if (header) {
      pending = { base: keyCol, explicit: header[1] === "" ? null : Number(header[1]) };
      contentIndent = null;
    }
    const split = rawValue === undefined ? null : splitInlineValue(rawValue);
    scan.push({
      idx: i,
      indent: pad.length,
      dash: dash === "-",
      keyCol,
      key: key.replace(/^["'](.*)["']$/, "$1"),
      value: split === null ? undefined : split.value,
      comment: split === null ? null : split.comment,
      rawValue: rawValue ?? "",
    });
  }
  return { scan, protectedLines };
}

/**
 * Every comment in the document, as written. Full-line comments and trailing ones,
 * never a `#` inside a block scalar (that is prose). The step compares this list
 * before and after and FAILS on any loss — a check the parsed-data comparison
 * structurally cannot make, because comments are not data.
 */
export function commentsIn(text: string): string[] {
  const lines = text.split("\n");
  const { protectedLines } = scanLines(lines);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (protectedLines.has(i)) continue;
    const line = lines[i];
    if (/^\s*#/.test(line)) {
      out.push(line.trim());
      continue;
    }
    const m = MAP_ENTRY.exec(line);
    if (!m) continue;
    const rawValue = m[6];
    if (rawValue === undefined) continue;
    const { comment } = splitInlineValue(rawValue);
    if (comment !== null) out.push(comment);
  }
  return out.sort();
}

export interface YamlStripResult {
  next: string;
  removed: string[];
  /** Set when the document does not parse — the step blocks, never rewrites. */
  parseError?: string;
  /** Set when the edit cannot be made safely — the step blocks, never rewrites. */
  blockReason?: string;
  /** 1-based line the block refers to, when there is one. */
  blockLine?: number;
  /** Comments the edit dropped. Non-empty means the STEP fails; it never writes. */
  lostComments?: string[];
}

/**
 * LINE-SURGICAL host/model identity removal.
 *
 * js-yaml is used to VALIDATE and to VERIFY, never to re-emit. The output is the
 * original bytes with the offending lines removed, so comments, timestamps,
 * quoting style, key order and blank lines survive byte-identical — the r1
 * parse-strip-dump rewrote all of them (and turned `Date` values into `{}`).
 *
 * Three edits, and nothing else:
 *   - a mapping entry `host: codex-cli`  →  that line is deleted;
 *   - a sequence item whose ONLY content is identity  →  that item's lines are
 *     deleted (and the parent gets `[]` if the sequence empties);
 *   - a sequence item whose FIRST line carries the identity but which has more
 *     keys  →  that line is deleted and the `-` moves onto the item's next line,
 *     so the item survives and the sequence stays a sequence.
 * A mapping that empties gets `{}` on its parent line.
 *
 * Anything it cannot place safely — a multi-document file, an anchor or alias on
 * the offending node, a flow mapping carrying identity, a tab-indented file, an
 * unexpected continuation indent — returns `blockReason` and is never rewritten.
 */
export function stripHostIdentityFromYaml(
  text: string,
  cfg: PolicyClassifier,
  /**
   * The comment reader, injected so the self-check below can be exercised against
   * a reader that loses one. Production never passes it.
   */
  commentsOf: (value: string) => string[] = commentsIn,
): YamlStripResult {
  const yaml = loadYamlApi();
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (e) {
    return { next: text, removed: [], parseError: (e as Error).message };
  }
  if (doc === null || doc === undefined || typeof doc !== "object") {
    return { next: text, removed: [] };
  }

  const lines = text.split("\n");
  const { scan, protectedLines } = scanLines(lines);

  const removed: string[] = [];
  const deleted = new Set<number>();
  /** line index → the exact replacement text (the `-` promotion). */
  const rewritten = new Map<number, string>();
  /** Dash lines that were deleted only because the `-` moved down: the item SURVIVES. */
  const promotedItems = new Set<number>();
  /** Deleted line index → the `# comment` it carried, kept in the entry's place. */
  const keptComments = new Map<number, { indent: number; text: string }>();
  const block = (reason: string, line?: number): YamlStripResult => ({
    next: text,
    removed: [],
    blockReason: reason,
    blockLine: line === undefined ? undefined : line + 1,
  });

  for (let n = 0; n < scan.length; n += 1) {
    const node = scan[n];
    if (node.key === null || node.value === undefined) continue;

    const flow = /^[[{]/.test(node.rawValue.trim());
    if (flow) {
      // A flow mapping is one line of YAML we would have to re-emit to edit. We
      // do not: if it carries identity the file BLOCKS, it is never rewritten.
      const pairs = node.rawValue.matchAll(/([A-Za-z_][\w.-]*)\s*:\s*([^,{}[\]]+)/g);
      for (const [, k, v] of pairs) {
        if (isIdentityEntry(k, v.trim(), undefined, cfg)) {
          return block(`flow-style mapping carries host/model identity (${k}: ${v.trim()})`, node.idx);
        }
      }
      continue;
    }

    if (!isIdentityEntry(node.key, node.value, undefined, cfg)) continue;

    // ── from here on we intend to EDIT: every global guard applies. ──────────
    if (/^\t| \t/.test(lines[node.idx]) || lines.some((l, i) => !protectedLines.has(i) && /^\t/.test(l))) {
      return block("tab-indented YAML cannot be edited by line", node.idx);
    }
    if (lines.some((l, i) => i > 0 && !protectedLines.has(i) && /^(---|\.\.\.)\s*$/.test(l))) {
      return block("multi-document YAML", node.idx);
    }
    // Anchors, aliases and merge keys move content between lines, so a line edit
    // cannot reason about what the offending node actually belongs to. Any of them
    // ANYWHERE in a file we intend to edit blocks it.
    const anchorAt = lines.findIndex((l, i) => !protectedLines.has(i) && /(^|\s)(<<:|[&*][A-Za-z_])/.test(l));
    if (anchorAt >= 0) return block("anchor or alias in the document", anchorAt);

    removed.push(`${node.key}: ${node.value}`);
    // The entry goes; the operator's note about it does not.
    if (node.comment !== null) keptComments.set(node.idx, { indent: node.indent, text: node.comment });

    if (!node.dash) {
      deleted.add(node.idx);
      continue;
    }

    // A dash line: the identity sits on the line that OPENS the sequence item.
    const body: number[] = [];
    for (let k = n + 1; k < scan.length; k += 1) {
      if (scan[k].indent <= node.indent) break;
      if (scan[k].indent === node.keyCol) body.push(scan[k].idx);
    }
    if (body.length === 0) {
      // The item was nothing but identity: the whole item goes.
      deleted.add(node.idx);
      continue;
    }
    // The item has more keys: delete the identity line and MOVE the `-` onto the
    // item's next key line. Exactly two lines change; every other byte survives.
    const promote = body[0];
    promotedItems.add(node.idx);
    const promoted = lines[promote];
    if (promoted.length - promoted.trimStart().length !== node.keyCol) {
      return block("sequence item continuation is not at the key column", promote);
    }
    const dashGap = " ".repeat(node.keyCol - node.indent - 1);
    deleted.add(node.idx);
    rewritten.set(promote, `${" ".repeat(node.indent)}-${dashGap}${promoted.trimStart()}`);
  }

  if (removed.length === 0) return { next: text, removed: [] };

  // A container every one of whose children we deleted must not be left dangling:
  // give it an explicit empty value on its own parent line.
  for (let n = 0; n < scan.length; n += 1) {
    const parent = scan[n];
    if (parent.key === null || (parent.value !== undefined && parent.value !== "")) continue;
    if (deleted.has(parent.idx) || rewritten.has(parent.idx)) continue;
    // Direct children: the run of following lines that belong to this key, taken
    // at the FIRST child's indent. A sequence may sit at the parent's own indent.
    const direct: ScanLine[] = [];
    let childIndent: number | null = null;
    for (let k = n + 1; k < scan.length; k += 1) {
      const c = scan[k];
      if (c.indent < parent.indent) break;
      if (c.indent === parent.indent && !c.dash) break;
      if (childIndent === null) childIndent = c.indent;
      if (c.indent < childIndent) break;
      if (c.indent === childIndent) direct.push(c);
    }
    if (direct.length === 0) continue;
    if (!direct.every((c) => deleted.has(c.idx) && !promotedItems.has(c.idx))) continue;
    const empty = direct[0].dash ? "[]" : "{}";
    // The container collapses onto ONE line, so a comment kept "in place of the
    // entry" would sit under a `{}` that has no block any more. It moves above.
    const moved: string[] = [];
    for (const child of direct) {
      const kept = keptComments.get(child.idx);
      if (kept === undefined) continue;
      moved.push(`${" ".repeat(parent.indent)}${kept.text}`);
      keptComments.delete(child.idx);
    }
    // The parent may carry its own trailing comment (`agents:   # the roster`).
    // Appending `: []` after it would fold the comment into the key, so the value
    // is inserted before the comment and the comment is re-attached verbatim.
    const parentLine = lines[parent.idx];
    const parentComment = parent.comment;
    const upToComment = parentComment === null ? "" : parentLine.slice(0, parentLine.lastIndexOf(parentComment));
    const head = parentComment === null
      ? parentLine.replace(/:\s*$/, "")
      : upToComment.replace(/[:\s]*$/, "");
    // Keep the operator's spacing between the value and the comment.
    const tail = parentComment === null ? "" : `${/(\s*)$/.exec(upToComment)?.[1] ?? " "}${parentComment}`;
    rewritten.set(parent.idx, [...moved, `${head}: ${empty}${tail}`].join("\n"));
  }

  const next = lines
    .map((line, i) => {
      if (!deleted.has(i)) return rewritten.get(i) ?? line;
      const kept = keptComments.get(i);
      return kept === undefined ? null : `${" ".repeat(kept.indent)}${kept.text}`;
    })
    .filter((line): line is string => line !== null)
    .join("\n");

  // The proof. The edited text must parse, and its DATA must be exactly the
  // original data minus the identity we meant to remove. Anything else — a
  // collapsed sequence, a swallowed sibling, a mangled scalar — blocks here and
  // the file is left byte-identical.
  let after: unknown;
  try {
    after = yaml.load(next);
  } catch (e) {
    return block(`the line edit produced unparseable YAML (${(e as Error).message})`);
  }
  if (!sameData(after, expectedAfterStrip(doc, cfg))) {
    return block("the line edit would change data other than the host/model identity");
  }

  // The second proof, and the one the data comparison cannot make: comments are not
  // data, so `sameData` is blind to losing one. Every comment present before must be
  // present after. A loss is a STEP FAILURE, not a quiet success.
  const before = commentsOf(text);
  const afterComments = commentsOf(next);
  const pool = [...afterComments];
  const lost: string[] = [];
  for (const comment of before) {
    const at = pool.indexOf(comment);
    if (at < 0) lost.push(comment);
    else pool.splice(at, 1);
  }
  if (lost.length > 0) return { next: text, removed: [], lostComments: lost };

  return { next, removed };
}

const ktd22Strip: UpgradeStep = {
  id: "ktd22-host-identity-strip",
  cls: "durable",
  source: "KTD22 / R38",
  affects: [".guild/initiatives", ".guild/team", ".guild/teams"],
  apply(ctx) {
    if (!ctx.policy) {
      return { status: "skipped", detail: "no policy classifier injected; host/model pins left in place", paths: [] };
    }
    const cfg = ctx.policy;
    const roots = ["initiatives", "team", "teams"].map((d) => path.join(ctx.guildDir, d));
    const touched: string[] = [];
    let removedTotal = 0;
    for (const dir of roots) {
      if (!isContainedRealDir(dir, ctx.guildDir)) continue;
      for (const abs of filesUnder(dir)) {
        if (!/\.ya?ml$/.test(abs)) continue;
        const text = readIfFile(abs);
        if (text === null) continue;
        const { next, removed, parseError, blockReason, blockLine, lostComments } =
          stripHostIdentityFromYaml(text, cfg);
        if (parseError !== undefined) {
          const where = rel(ctx, abs);
          return {
            status: "blocked_confirm",
            detail: `${where} is not parseable YAML (${parseError}) — left byte-identical, not rewritten`,
            paths: [where],
            question:
              `ktd22-host-identity-strip cannot parse ${where}: ${parseError}. ` +
              `Fix that file, then re-run the upgrade. Skip it and continue?`,
          };
        }
        if (lostComments !== undefined && lostComments.length > 0) {
          return {
            status: "failed",
            detail:
              `${rel(ctx, abs)}: the strip would drop ${lostComments.length} comment(s) ` +
              `(${lostComments.join(" / ")}) — nothing was written`,
            paths: [rel(ctx, abs)],
          };
        }
        if (blockReason !== undefined) {
          const where = blockLine === undefined ? rel(ctx, abs) : `${rel(ctx, abs)}:${blockLine}`;
          return {
            status: "blocked_confirm",
            detail: `${where} carries host/model identity this step cannot remove by line (${blockReason}) — left byte-identical`,
            paths: [rel(ctx, abs)],
            question:
              `ktd22-host-identity-strip cannot safely edit ${where}: ${blockReason}. ` +
              `Remove the host/model identity there by hand, then re-run the upgrade. Skip it and continue?`,
          };
        }
        if (removed.length === 0) continue;
        writeFile(ctx, abs, next);
        touched.push(rel(ctx, abs));
        removedTotal += removed.length;
      }
    }
    if (touched.length === 0) {
      return { status: "skipped", detail: "no host or model identity pinned in durable initiative/team files", paths: [] };
    }
    return {
      status: "completed",
      detail: `stripped ${removedTotal} host/model pin(s) from ${touched.length} durable file(s)`,
      paths: touched,
    };
  },
};

// ── 4. caches-out (§21.11) ───────────────────────────────────────────────────

/**
 * Derived data leaves `.guild/` (KTD15). The proposal's safe default is chosen
 * deliberately: DELETE rather than copy, and let V2 rebuild lazily on the platform
 * cache root. Everything removed here is `classifyPath === "derived"`; the guard
 * is asserted, not assumed, so widening `caches-out` later cannot quietly start
 * deleting knowledge.
 */
const CACHE_TARGETS: readonly string[] = Object.freeze(["indexes", "index.sqlite", "hosts"]);

const cachesOut: UpgradeStep = {
  id: "caches-out",
  cls: "safe-local",
  source: "proposal §21.11",
  affects: [],
  apply(ctx) {
    const removed: string[] = [];
    for (const name of CACHE_TARGETS) {
      const abs = path.join(ctx.guildDir, name);
      const st = lstatSafe(abs);
      if (!st) continue;
      if (classifyPath(name) !== "derived") {
        return {
          status: "blocked_confirm",
          detail: `refusing to remove non-derived path .guild/${name}`,
          paths: [rel(ctx, abs)],
          question: `caches-out wants to delete .guild/${name}, which is not classified derived. Delete it?`,
        };
      }
      if (ctx.dryRun) {
        removed.push(rel(ctx, abs));
        continue;
      }
      if (st.isDirectory()) {
        if (removeContainedTree(abs, ctx.guildDir) !== null) removed.push(rel(ctx, abs));
      } else {
        fs.rmSync(abs, { force: true });
        removed.push(rel(ctx, abs));
      }
    }
    if (removed.length === 0) return { status: "skipped", detail: "no derived cache left under .guild", paths: [] };
    return {
      status: "completed",
      detail: `removed ${removed.length} derived cache path(s); V2 rebuilds them on the platform cache root`,
      paths: removed,
    };
  },
};

// ── 5. closed-run-receipts (§21.10) ──────────────────────────────────────────

const TERMINAL_STATUSES: readonly string[] = Object.freeze([
  "closed",
  "complete",
  "completed",
  "done",
  "failed",
  "aborted",
  "cancelled",
  "canceled",
]);

/**
 * The run's OWN status, at depth 1 of the run record — never a nested one.
 *
 * A regex over the file matched `status: done` wherever it appeared, so one
 * finished TASK inside an active run read as a terminal run and earned a receipt.
 * The document is parsed and only the top-level `status` key is consulted. A file
 * that does not parse, or that has no top-level status, is NOT terminal: an open
 * run is never silently closed (§21.10).
 */
function terminalRunStatus(runYaml: string): string | null {
  let doc: unknown;
  try {
    doc = loadYamlApi().load(runYaml);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const value = (doc as Record<string, unknown>)["status"];
  if (typeof value !== "string") return null;
  const status = value.trim().toLowerCase();
  return TERMINAL_STATUSES.includes(status) ? status : null;
}

/**
 * A receipt per TERMINAL legacy run. Two things this step deliberately does not do:
 *
 *   - it never writes a receipt for a run that is not provably terminal (§21.10:
 *     an open run must not be silently converted to closed);
 *   - it never removes the legacy payload. §21.10 removes it after validation, but
 *     `runs/**` is durable, not derived, so unattended deletion is outside this
 *     lane's autonomy contract. The payload stays; a later gc proposes it.
 */
const closedRunReceipts: UpgradeStep = {
  id: "closed-run-receipts",
  cls: "durable",
  source: "proposal §21.10",
  affects: [".guild/runs"],
  apply(ctx) {
    const runsDir = path.join(ctx.guildDir, "runs");
    if (!isContainedRealDir(runsDir, ctx.guildDir)) {
      return { status: "skipped", detail: "no .guild/runs tree", paths: [] };
    }
    const written: string[] = [];
    let open = 0;
    for (const name of readdirSafe(runsDir)) {
      if (name.startsWith("_")) continue;
      const runDir = path.join(runsDir, name);
      if (!isContainedRealDir(runDir, ctx.guildDir)) continue;
      const receipt = path.join(runDir, "receipt.json");
      if (lstatSafe(receipt)) continue;
      const runYaml = readIfFile(path.join(runDir, "run.yaml"));
      if (runYaml === null) continue;
      const status = terminalRunStatus(runYaml);
      if (status === null) {
        open += 1;
        continue;
      }
      writeFile(
        ctx,
        receipt,
        `${JSON.stringify(
          {
            schema_version: "guild.run_receipt.v1",
            run_id: name,
            status,
            source: "layout-upgrade",
            generated_at: ctx.now(),
          },
          null,
          2,
        )}\n`,
      );
      written.push(rel(ctx, receipt));
    }
    if (written.length === 0) {
      return {
        status: "skipped",
        detail: `every legacy run already has a receipt or is not terminal (${open} left open)`,
        paths: [],
      };
    }
    return {
      status: "completed",
      detail: `wrote ${written.length} run receipt(s); ${open} non-terminal run(s) left untouched (never falsely closed)`,
      paths: written,
    };
  },
};

// ── 6. current-run-id-retire (§21.10) ────────────────────────────────────────

const currentRunIdRetire: UpgradeStep = {
  id: "current-run-id-retire",
  cls: "safe-local",
  source: "proposal §21.10",
  affects: [],
  apply(ctx) {
    const abs = path.join(ctx.guildDir, "current-run-id");
    const text = readIfFile(abs);
    if (text === null) return { status: "skipped", detail: "no current-run-id sentinel", paths: [] };
    const captured = text.trim();
    if (classifyPath("current-run-id") !== "derived") {
      return {
        status: "blocked_confirm",
        detail: "current-run-id is not classified derived",
        paths: [rel(ctx, abs)],
        question: "current-run-id-retire wants to delete .guild/current-run-id. Delete it?",
      };
    }
    if (!ctx.dryRun) fs.rmSync(abs, { force: true });
    return {
      status: "completed",
      detail: `captured run binding "${captured}" and retired the singleton sentinel; V2 writers never recreate it`,
      paths: [rel(ctx, abs)],
    };
  },
};

// ── 7. skill-versions-delete (§21.12 / R60) ──────────────────────────────────

/**
 * The leftover v1 version-snapshot tree goes away (R60: compact history replaces
 * it). §21.12 forbids losing unique content, so the two rules meet here:
 *
 *   - a snapshot whose bytes are ALREADY the live durable skill body is redundant
 *     → derived-equivalent → deleted;
 *   - a snapshot that is not → UNIQUE content → `blocked_confirm`, never deleted.
 *
 * The legacy directory name is named ONCE, in `LEGACY_VERSION_TREE`, so this is the
 * only line in the domain that spells the retired tree (KTD48 grep).
 */
const LEGACY_VERSION_TREE = "skill-versions";
const skillVersionsDelete: UpgradeStep = {
  id: "skill-versions-delete",
  cls: "safe-local",
  source: "proposal §21.12 / R60",
  affects: [],
  apply(ctx) {
    const dir = path.join(ctx.guildDir, LEGACY_VERSION_TREE);
    if (!isContainedRealDir(dir, ctx.guildDir)) {
      return { status: "skipped", detail: `no leftover ${LEGACY_VERSION_TREE} tree`, paths: [] };
    }
    const snapshots = filesUnder(dir);
    if (snapshots.length === 0) {
      if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
      return { status: "completed", detail: `removed the empty ${LEGACY_VERSION_TREE} tree`, paths: [rel(ctx, dir)] };
    }

    // Live bodies, by content hash. A snapshot matching one is already preserved.
    const live = new Set<string>();
    const skillsDir = path.join(ctx.guildDir, "skills");
    if (isContainedRealDir(skillsDir, ctx.guildDir)) {
      for (const abs of filesUnder(skillsDir)) {
        const text = readIfFile(abs);
        if (text !== null) live.add(sha256(text));
      }
    }

    const unique = snapshots.filter((abs) => {
      const text = readIfFile(abs);
      return text === null || !live.has(sha256(text));
    });
    if (unique.length > 0) {
      return {
        status: "blocked_confirm",
        detail: `${unique.length} legacy snapshot(s) carry content no live skill body has`,
        paths: unique.slice(0, 10).map((abs) => rel(ctx, abs)),
        question:
          `skill-versions-delete found ${unique.length} snapshot(s) under .guild/${LEGACY_VERSION_TREE}/ whose content ` +
          `is NOT in any live .guild/skills/** body, so they are not derived. Review them and either keep the ` +
          `tree or remove it yourself, then re-run \`config migrate --mode=migrate\`.`,
      };
    }

    if (!ctx.dryRun) removeContainedTree(dir, ctx.guildDir);
    return {
      status: "completed",
      detail: `removed ${snapshots.length} redundant snapshot(s); every one matched a live skill body`,
      paths: [rel(ctx, dir)],
    };
  },
};

// ── 8. registry-yaml-retire (KTD56 / R68) ────────────────────────────────────

/**
 * Authored `loops/registry.yaml` and `workflows/registry.yaml` stop being the
 * source of truth (class graphs are, KTD56). The generated-from-graphs path does
 * not exist in this cut, so the honest move is PRESERVE-AND-FLAG: the authored
 * file is relocated under `artifacts/legacy/`, never deleted.
 *
 * `agents/registry.yaml` and `skills/registry.yaml` are different: both are DERIVED
 * indexes of the `*.md` files beside them (roster-resolve regenerates either on
 * demand), so those are removed.
 */
const AUTHORED_REGISTRIES: readonly string[] = Object.freeze(["loops/registry.yaml", "workflows/registry.yaml"]);
const DERIVED_REGISTRIES: readonly string[] = Object.freeze(["agents/registry.yaml", "skills/registry.yaml"]);

const registryYamlRetire: UpgradeStep = {
  id: "registry-yaml-retire",
  cls: "durable",
  source: "KTD56 / R68",
  affects: [".guild/loops", ".guild/workflows", ".guild/agents/registry.yaml", ".guild/skills/registry.yaml"],
  apply(ctx) {
    const changed: string[] = [];

    for (const relPath of DERIVED_REGISTRIES) {
      const abs = path.join(ctx.guildDir, relPath);
      if (!lstatSafe(abs)) continue;
      if (classifyPath(relPath) !== "derived") continue;
      if (!ctx.dryRun) fs.rmSync(abs, { force: true });
      changed.push(rel(ctx, abs));
    }

    for (const relPath of AUTHORED_REGISTRIES) {
      const abs = path.join(ctx.guildDir, relPath);
      const text = readIfFile(abs);
      if (text === null) continue;
      const target = path.join(ctx.guildDir, "artifacts", "legacy", relPath.replace("/", "-"));
      if (lstatSafe(target)) continue;
      writeFile(ctx, target, text);
      if (!ctx.dryRun) fs.rmSync(abs, { force: true });
      changed.push(`${rel(ctx, abs)} → ${rel(ctx, target)}`);
    }

    if (changed.length === 0) {
      return { status: "skipped", detail: "no registry YAML left to retire", paths: [] };
    }
    return {
      status: "completed",
      detail: `retired ${changed.length} registry file(s); authored ones were preserved under artifacts/legacy/, not deleted`,
      paths: changed,
    };
  },
};

// ── 9. glossary-create (R80 / KTD70) ─────────────────────────────────────────

const glossaryCreate: UpgradeStep = {
  id: "glossary-create",
  cls: "durable",
  source: "R80 / KTD70",
  // The KNOWLEDGE TREE, not just the file: a durable step must not write into a
  // tree whose tracked pages are dirty, even when its own target does not exist yet.
  affects: [KNOWLEDGE_PREFIX],
  apply(ctx) {
    // Named through the storage API (KTD15); `knowledge()` IS the canonical tree.
    const abs = knowledgeDir(ctx, "glossary.md");
    if (lstatSafe(abs)) {
      return {
        status: "skipped",
        detail: "project glossary already exists — feedstock never replaces it (R80)",
        paths: [],
      };
    }
    writeFile(ctx, abs, GLOSSARY_FEEDSTOCK);
    return { status: "completed", detail: "created the root glossary page from plugin feedstock", paths: [rel(ctx, abs)] };
  },
};

// ── The catalog ──────────────────────────────────────────────────────────────

/**
 * ORDER IS PART OF THE CONTRACT. `v1-content` runs first because every later step
 * reads the post-conversion shape. `glossary-create` runs last so a v1 knowledge tree that
 * the converter renames cannot end up with the feedstock in the wrong tree.
 */
export const UPGRADE_STEPS: readonly UpgradeStep[] = deepFreeze([
  v1Content,
  settingsPolicySplit,
  ktd22Strip,
  cachesOut,
  closedRunReceipts,
  currentRunIdRetire,
  skillVersionsDelete,
  registryYamlRetire,
  glossaryCreate,
]);

/** Pinned step ids, in run order. The receipt for spec gap G-b quotes this list. */
export const UPGRADE_STEP_IDS: readonly string[] = Object.freeze(UPGRADE_STEPS.map((s) => s.id));

export function upgradeStep(id: string): UpgradeStep | undefined {
  return UPGRADE_STEPS.find((s) => s.id === id);
}
