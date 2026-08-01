/**
 * scripts/lib/capability/profile-emit.ts
 *
 * D1 (consumer half) — the emission path for `guild.project_capability_profile.v1`.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THE INVARIANT: a full Learn emits a PROFILE and mutates NOTHING.          │
 * │ Zero live agent / skill / registry / config writes.                       │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * S1's contract declares that invariant (`mutation_performed` is the literal
 * `false`) and CHECKS it (the validator rejects unequal before/after tree hashes).
 * But a declaration and a check are both cheap if nothing ever computes a REAL
 * hash — a caller could pass the same fabricated constant twice and satisfy A1.6
 * while having rewritten the roster. Assertion A1.7 exists precisely because of
 * that hole: it demands a REAL Learn run whose hashes match shell-computed ones.
 *
 * So this module computes them for real, over the actual filesystem, in a form a
 * shell can independently reproduce (see `TREE_HASH_RECIPE`). The hash is not a
 * detail of the implementation; it is the evidence.
 *
 * HOW THE ORDERING MAKES THE PROOF SOUND
 *
 *   0. resolve OPTIONS      — own-data descriptor reads, before any filesystem work
 *   1. hash BEFORE          — over `.guild/agents/**`, `.guild/skills/**`, registries,
 *                             OR the caller's run-start baseline (see below)
 *   2. derive               — read-only
 *   3. hash AFTER           — same three trees
 *   4. refuse if they differ — a Learn run that mutated CANNOT emit a profile
 *   5. validate             — S1's validator, with the resolved budget
 *   6. write                — into `.guild/runs/<run-id>/capability/`, and ONLY there
 *   7. hash again, POST-WRITE — and DELETE the profile if the write escaped
 *
 * Step 7 is the one that is easy to leave out and the one that catches the real
 * bug. Steps 1–4 prove the DERIVATION did not mutate; only a post-write re-hash
 * proves the EMISSION did not. A writer that appends to `.guild/agents/registry.yaml`
 * on its way out would sail through steps 1–6.
 *
 * HOW WIDE THE WINDOW ACTUALLY IS — the honest caveat
 *
 * Derivation happens in the CALLER, so with no `baselineHashes` the compared
 * window covers the EMISSION only, not the whole Learn run: a stage that wrote to
 * `.guild/agents/` early and called this at the end would be measured across a
 * window in which nothing happened. `baselineHashes` (run-start snapshot, passed
 * by `guild:learn` step 12b) widens the window to the whole run and is what makes
 * the B1 shell recipe — hash, run Learn, hash — genuinely bracketing. Omitting it
 * is still valid; the profile then claims only what it can see, which is the
 * correct fallback rather than a fabricated wider claim.
 *
 * EVERY WRITE GOES THROUGH THE CONTEXT-MANAGER CONTRACT
 *
 * `classifyContextManagerWrite` is not consulted as a courtesy — it is the same
 * function that bounds the agent, so the emitter cannot write anywhere the agent
 * may not. A contract only used by the surface it describes is decoration; used by
 * the code that does the work, it is a boundary.
 *
 * CONTRACT: no clock (timestamps are caller-supplied), no network. Filesystem
 * reads plus exactly one bounded write. NEVER throws — every failure is a typed
 * refusal, because a thrown emitter would abort the Learn run it is a side-report of.
 *
 * C5 DUAL-HOME: mirrored under src/modules/capability/resources/. Edit here only.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { types as nodeTypes } from "util";

import {
  DEFAULT_SUGGESTION_BUDGET,
  type CapabilityCandidate,
  type BoundaryFact,
  type CoverageVerdict,
  type DomainFact,
  type MethodFact,
  type ProjectCapabilityProfileV1,
  type ResolverMode,
  PROJECT_CAPABILITY_PROFILE_SCHEMA,
  validateProjectCapabilityProfileV1,
} from "../core/contracts/project-capability-profile";
import { isRealRunDir } from "./candidate-surface";
import { classifyContextManagerWrite } from "./context-manager-contract";

// ── The hash recipe, stated so a shell can reproduce it ──────────────────────

/**
 * A1.7 requires the profile's hashes to match hashes computed by a SHELL, not by
 * this module. That is only checkable if the recipe is written down, so it is —
 * and `scripts/capability-profile.ts hash-tree` prints the same value, giving the
 * conformance run two independent computations to compare.
 *
 *   for each ENTRY under the root, in ascending byte order of its POSIX-relative path:
 *     a regular file  →  "<relpath>\0<sha256-hex-of-file-bytes>\n"
 *     a directory     →  "<relpath>\0dir\n"
 *     anything else   →  "<relpath>\0symlink\n"
 *   sha256 over that concatenation, lowercase hex
 *
 * DIRECTORIES AND SYMLINKS ARE IN THE DIGEST, and that is a correction, not a
 * flourish (Codex round 2, finding 4). With files alone, deleting an empty
 * `.guild/agents` directory, or swapping a directory for a symlink to an identical
 * tree, both left the hash byte-identical — changes the no-mutation claim is
 * specifically about.
 *
 * An ABSENT root hashes the empty string — which is the same value an empty root
 * produces, and deliberately so: for the no-mutation comparison what matters is
 * that "absent" is STABLE, and absent-vs-empty is a distinction `feedstock.absent`
 * already records where it means something.
 *
 * The NUL separator is load-bearing: with a plain separator, the pair
 * (`a`, hash `b/c`) and (`a/b`, hash `c`) could serialize identically, so two
 * different trees could hash the same. NUL cannot occur in a path.
 */
export const TREE_HASH_RECIPE =
  'sha256( concat( sorted( "<relpath>\\0" + (file ? sha256(bytes) : kind) + "\\n" ) ) )';

/** The three trees whose immutability the profile asserts. Closed and frozen. */
export const HASHED_TREES = Object.freeze([
  ".guild/agents",
  ".guild/skills",
] as const);

/** The registry projections, hashed together as one value. Closed and frozen. */
export const HASHED_REGISTRIES = Object.freeze([
  ".guild/agents/registry.yaml",
  ".guild/skills/registry.yaml",
] as const);

/** A tree hash: bare 64 lowercase hex, the same shape S1 enforces. */
const TREE_HASH_RE = /^[0-9a-f]{64}$/;

const EMPTY_TREE_HASH = createHash("sha256").update("").digest("hex");

function sha256File(abs: string): string | null {
  try {
    return createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Every file under `absRoot`, POSIX-relative, sorted. Deterministic and total:
 * an unreadable entry is SKIPPED rather than thrown on, because a hash that
 * crashes on a permissions edge cannot serve as the stable half of a comparison.
 * Symlinks are not followed — a symlinked tree would let the same bytes appear at
 * two paths, and following one out of the root would hash something else entirely.
 */
const MAX_TREE_DEPTH = 32;

/**
 * A tree entry as it contributes to the hash. Directories are listed TOO — see
 * `hashTree` for why an empty directory has to be visible.
 */
interface TreeEntry {
  rel: string;
  kind: "file" | "dir" | "symlink";
}

/**
 * CODEX-REVIEW FIX (round 2, finding 4). The previous walk SKIPPED symlinks,
 * SKIPPED unreadable entries, SKIPPED anything past the depth cap, and listed no
 * directories. Each omission made a real change invisible to the comparison:
 *
 *   - `.guild/agents` replaced by a symlink to an identical external tree
 *   - an empty `.guild/agents` directory deleted
 *   - a file added below 33 nested directories
 *   - a file made unreadable (skipped by the `continue`, which is precisely the
 *     accept-by-attrition rule 6 forbids)
 *
 * The walk now RECORDS rather than skips, and signals failure rather than
 * truncating. `null` means "this tree could not be listed completely" — the caller
 * turns that into a refusal, because a partial listing cannot be the stable half
 * of a no-mutation comparison. Absent is never success.
 */
function listTree(absRoot: string, rel = "", depth = 0): TreeEntry[] | null {
  if (depth > MAX_TREE_DEPTH) return null; // truncation would hide a deep change
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch (e) {
    // An absent root is legitimately empty; anything else is an unreadable tree.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    return null;
  }
  const out: TreeEntry[] = [];
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) {
      // RECORDED, not followed. Following would let external bytes masquerade as
      // tree content; skipping would make the swap invisible.
      out.push({ rel: childRel, kind: "symlink" });
    } else if (e.isDirectory()) {
      out.push({ rel: childRel, kind: "dir" });
      const child = listTree(path.join(absRoot, e.name), childRel, depth + 1);
      if (child === null) return null;
      out.push(...child);
    } else if (e.isFile()) {
      out.push({ rel: childRel, kind: "file" });
    } else {
      out.push({ rel: childRel, kind: "symlink" }); // socket/fifo/device — recorded as non-file
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/**
 * Hash one directory tree per `TREE_HASH_RECIPE`, or return `null` when the tree
 * cannot be listed completely.
 *
 * `null` is a REFUSAL SIGNAL, not an error value to paper over: an unreadable
 * entry, a too-deep tree, or a symlinked root all mean the hash would describe
 * less than the tree, and a hash that silently covers a subset cannot support a
 * no-mutation claim about the whole.
 *
 * Directories and symlinks appear in the digest with their KIND, so that
 * deleting an empty directory, or swapping a directory for a symlink to an
 * identical tree, both move the hash (Codex round 2, finding 4). An ABSENT root
 * still hashes empty — that case is stable and meaningful.
 */
export function hashTree(projectRoot: string, relRoot: string): string | null {
  const abs = path.join(projectRoot, relRoot);

  // The ROOT'S OWN type matters: replacing `.guild/agents` with a symlink to an
  // identical external tree left the old walk's output byte-identical.
  try {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return null; // a symlinked root is not this tree
    if (!st.isDirectory()) return null;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return null;
    return EMPTY_TREE_HASH; // absent — stable and meaningful
  }

  const entries = listTree(abs);
  if (entries === null) return null;
  if (entries.length === 0) return EMPTY_TREE_HASH;

  const h = createHash("sha256");
  for (const e of entries) {
    if (e.kind !== "file") {
      h.update(`${e.rel}\0${e.kind}\n`); // presence + kind, no content to read
      continue;
    }
    const fileHash = sha256File(path.join(abs, e.rel));
    if (fileHash === null) return null; // unreadable — REFUSE, never skip (rule 6)
    h.update(`${e.rel}\0${fileHash}\n`);
  }
  return h.digest("hex");
}

/**
 * Hash an explicit FILE LIST as one value, using the same recipe. Used for the
 * two registry projections, which are hashed together because S1 carries a single
 * `registry_hash_*` pair — one value, one comparison, no way to check one and
 * forget the other.
 *
 * A missing file contributes nothing, so "both registries absent" and "no registry
 * files" agree — the same stability argument as `hashTree`.
 */
export function hashFileSet(projectRoot: string, relPaths: readonly string[]): string | null {
  const h = createHash("sha256");
  let any = false;
  for (const rel of [...relPaths].sort()) {
    const abs = path.join(projectRoot, rel);
    let exists: boolean;
    try {
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) return null; // a symlinked registry is not this file
      exists = st.isFile();
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") return null;
      exists = false;
    }
    if (!exists) continue; // genuinely absent — contributes nothing, stably
    const fileHash = sha256File(abs);
    if (fileHash === null) return null; // present but unreadable — REFUSE, never skip
    any = true;
    h.update(`${rel}\0${fileHash}\n`);
  }
  return any ? h.digest("hex") : EMPTY_TREE_HASH;
}

export interface TreeHashes {
  agents: string;
  skills: string;
  registries: string;
}

/**
 * The three hashes S1's `mutation_evidence` compares. One call, one snapshot.
 *
 * Returns `null` when ANY of the three could not be computed completely — the
 * snapshot is all-or-nothing, because two of three hashes cannot support a claim
 * about the tree as a whole.
 */
export function snapshotTreeHashes(projectRoot: string): TreeHashes | null {
  const agents = hashTree(projectRoot, HASHED_TREES[0]);
  const skills = hashTree(projectRoot, HASHED_TREES[1]);
  const registries = hashFileSet(projectRoot, HASHED_REGISTRIES);
  if (agents === null || skills === null || registries === null) return null;
  return { agents, skills, registries };
}

function sameHashes(a: TreeHashes, b: TreeHashes): boolean {
  return a.agents === b.agents && a.skills === b.skills && a.registries === b.registries;
}

// ── Feedstock ────────────────────────────────────────────────────────────────

/**
 * Feedstock inputs, in the order they appear in `FeedstockBinding`. The NAMES are
 * what land in `feedstock.absent`, so they are frozen: an absence record whose
 * vocabulary drifts cannot be compared across runs.
 */
export const FEEDSTOCK_INPUTS = Object.freeze([
  { name: "codebase_map", rel: ".guild/indexes/codebase-map.json" },
  { name: "knowledge_graph", rel: ".guild/indexes/knowledge-graph.json" },
  { name: "roster", rel: ".guild/agents/registry.yaml" },
] as const);

export interface FeedstockSnapshot {
  codebase_map_hash: string | null;
  knowledge_graph_hash: string | null;
  roster_hash: string | null;
  absent: string[];
}

/**
 * A1.9 — absent feedstock is RECORDED, never silently omitted.
 *
 * A profile built with no knowledge graph says so, and a reader downgrades its
 * trust accordingly instead of mistaking absence for emptiness. This is the
 * "absent is never success" rule (spec README rule 4) at the input boundary.
 */
export function snapshotFeedstock(projectRoot: string): FeedstockSnapshot {
  const absent: string[] = [];
  const hashes: Record<string, string | null> = {};
  for (const input of FEEDSTOCK_INPUTS) {
    const h = sha256File(path.join(projectRoot, input.rel));
    if (h === null) absent.push(input.name);
    hashes[input.name] = h;
  }
  return {
    codebase_map_hash: hashes.codebase_map ?? null,
    knowledge_graph_hash: hashes.knowledge_graph ?? null,
    roster_hash: hashes.roster ?? null,
    absent,
  };
}

// ── Emission ─────────────────────────────────────────────────────────────────

/** Where a run's profile lives. Project-relative; inside the contract's write roots. */
export function profileRelPath(runId: string): string {
  return `.guild/runs/${runId}/capability/profile.json`;
}

/**
 * Closed refusal vocabulary. Every failure is one of these — a caller branches on
 * the code, never on a message.
 */
export const EMIT_REFUSAL_CODES = Object.freeze([
  "resolver_mode_disabled",
  "invalid_run_id",
  "invalid_project_id",
  "invalid_generated_at",
  "invalid_options",
  "invalid_baseline",
  "hash_incomplete",
  "escapes_project_root",
  "mutation_detected",
  "profile_invalid",
  "write_forbidden",
  "write_failed",
  "post_write_mutation",
] as const);
export type EmitRefusalCode = (typeof EMIT_REFUSAL_CODES)[number];

/**
 * How wide the no-mutation comparison actually was.
 *
 * CODEX-REVIEW FIX (round 2, finding 3). The emitted artifact cannot record this —
 * S1's shape is closed and frozen — so a reader of the FILE alone genuinely cannot
 * tell a whole-run claim from an emission-only one. Recording it on the RESULT and
 * in the CLI output is the honest half that is available: a caller now knows which
 * claim it just made instead of assuming the stronger one.
 *
 * Widening S1 to carry this is owed work on that contract, not something this
 * module can do.
 */
export type MutationWindow = "run" | "emission";

export type EmitResult =
  | {
      status: "emitted";
      rel_path: string;
      profile: ProjectCapabilityProfileV1;
      hashes: TreeHashes;
      /** "run" when a run-start baseline was supplied; "emission" otherwise. */
      window: MutationWindow;
    }
  | { status: "refused"; code: EmitRefusalCode; detail: string };

/**
 * The derived material a caller supplies. This module owns the INVARIANT
 * (hash, validate, bounded write); it does not own domain derivation — that is
 * `scripts/learn/lib/domain.ts`'s job, consumed by pointer per S1's open question
 * rather than re-derived here.
 */
export interface DerivedFacts {
  domains: DomainFact[];
  boundaries: BoundaryFact[];
  repeated_methods: MethodFact[];
  coverage: CoverageVerdict;
  candidates: CapabilityCandidate[];
}

export interface EmitProfileOptions {
  /** Project root — the directory holding `.guild/`. */
  projectRoot: string;
  runId: string;
  projectId: string;
  /** RFC3339 UTC, caller-supplied. This module has no clock. */
  generatedAt: string;
  sourceCommit: string | null;
  resolverMode: ResolverMode;
  /** Resolved `capability.suggestion_budget`. */
  suggestionBudget?: number;
  facts: DerivedFacts;
  /**
   * RUN-START tree hashes, widening the no-mutation window to the WHOLE Learn run.
   *
   * ── THE LIMITATION THIS EXISTS TO CLOSE, STATED PLAINLY ──────────────────────
   * Derivation happens in the CALLER, before this function is entered. So without
   * a baseline, the BEFORE and AFTER snapshots bracket only the emission itself —
   * a handful of feedstock reads. A Learn stage that wrote to `.guild/agents/`
   * during stage 4 and then called the emitter at stage 12b would be measured
   * across a window in which nothing happened, and would emit a profile asserting
   * a clean run. The check would be real and the claim still wrong.
   *
   * Passing hashes captured at RUN START closes that: `before` becomes the run's
   * actual starting state, so any mutation anywhere in the run lands inside the
   * compared window. `guild:learn` step 12b passes it; `capability-profile.ts
   * hash-tree --json` at run start produces it.
   *
   * OMITTING IT IS STILL VALID — the emitter then reports honestly on the only
   * window it can see, rather than pretending to a wider one. The narrower claim
   * is the correct fallback; a fabricated wider one would not be.
   */
  baselineHashes?: TreeHashes;
}

/** RFC3339 UTC, shape-checked. `"not-rfc3339"` is not a timestamp (Codex r2, L). */
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

const EMIT_OPTION_KEYS = [
  "projectRoot",
  "runId",
  "projectId",
  "generatedAt",
  "sourceCommit",
  "resolverMode",
  "suggestionBudget",
  "facts",
  "baselineHashes",
] as const;

/**
 * Read the ENTIRE options object through own-data descriptors, ONCE per field,
 * before any filesystem work.
 *
 * CODEX-REVIEW FIX (round 2, finding 2). Only `baselineHashes` was descriptor-read;
 * every other field used ordinary property access, and `baselineHashes` itself was
 * fetched twice by plain access before its nested validation ran. Reproduced: a
 * `facts` getter created `.guild/agents/transient.md` on its first read and removed
 * it on its second — it fired FIVE times, and emission still returned `emitted`
 * because the endpoints matched.
 *
 * That is rule 4 exactly: caller code executing inside the validation window is
 * what makes an endpoint comparison meaningless. Nothing caller-supplied may run
 * between a snapshot and the read it guards, so every field is captured here, in
 * one pass, with Proxy / prototype / symbol-key / unknown-key / accessor rejection.
 *
 * Returns the frozen capture, or `null` to mean "reject".
 */
interface CapturedOptions {
  projectRoot: string;
  runId: string;
  projectId: string;
  generatedAt: string;
  sourceCommit: string | null;
  resolverMode: string;
  suggestionBudget: number;
  facts: unknown;
  baselineHashes: unknown;
}

function captureEmitOptions(opts: unknown): CapturedOptions | null {
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) return null;
  if (nodeTypes.isProxy(opts)) return null;
  const proto = Object.getPrototypeOf(opts);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(opts).length > 0) return null;
  for (const k of Object.getOwnPropertyNames(opts)) {
    if (!(EMIT_OPTION_KEYS as readonly string[]).includes(k)) return null;
  }

  const read = (k: string): { present: boolean; value: unknown } | null => {
    const d = Object.getOwnPropertyDescriptor(opts, k);
    if (!d) return { present: false, value: undefined };
    if (!("value" in d)) return null; // accessor — NEVER fired
    return { present: true, value: d.value };
  };

  const fields: Record<string, { present: boolean; value: unknown }> = {};
  for (const k of EMIT_OPTION_KEYS) {
    const r = read(k);
    if (r === null) return null;
    fields[k] = r;
  }

  const projectRoot = fields.projectRoot.value;
  const runId = fields.runId.value;
  const projectId = fields.projectId.value;
  const generatedAt = fields.generatedAt.value;
  const sourceCommit = fields.sourceCommit.value;
  const resolverMode = fields.resolverMode.value;
  if (typeof projectRoot !== "string" || projectRoot.length === 0) return null;
  if (typeof runId !== "string" || typeof projectId !== "string") return null;
  if (typeof generatedAt !== "string") return null;
  if (sourceCommit !== null && sourceCommit !== undefined && typeof sourceCommit !== "string") {
    return null;
  }
  if (typeof resolverMode !== "string") return null;

  let budget = DEFAULT_SUGGESTION_BUDGET;
  if (fields.suggestionBudget.present && fields.suggestionBudget.value !== undefined) {
    const b = fields.suggestionBudget.value;
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0) return null;
    budget = b;
  }

  return Object.freeze({
    projectRoot,
    runId,
    projectId,
    generatedAt,
    sourceCommit: (sourceCommit ?? null) as string | null,
    resolverMode,
    suggestionBudget: budget,
    facts: fields.facts.value,
    baselineHashes: fields.baselineHashes.value,
  });
}

/**
 * PHYSICAL containment: does `abs` actually live under `projectRoot` once every
 * symlink is resolved?
 *
 * CODEX-REVIEW FIX (round 2, finding 1). `classifyContextManagerWrite` is a pure
 * LEXICAL check, so it cannot know that `.guild/runs/<id>/capability` is a symlink
 * to `/tmp/out`. Reproduced: the classifier allowed it, the emitter reported
 * `emitted`, and the file was written to `/tmp/out/profile.json` — the bounded-write
 * guarantee was simply false.
 *
 * Resolving the deepest EXISTING ancestor is what makes this work before the leaf
 * exists: the directories are created first, so the check runs against the real
 * destination rather than a path that is not there yet.
 */
function isContainedRealPath(projectRoot: string, abs: string): boolean {
  try {
    const rootReal = fs.realpathSync(projectRoot);
    let probe = abs;
    // Walk up to the deepest ancestor that exists, then resolve it.
    for (;;) {
      if (fs.existsSync(probe)) break;
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
    const probeReal = fs.realpathSync(probe);
    const rel = path.relative(rootReal, probeReal);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

/**
 * Validate a caller-supplied baseline, fail-closed.
 *
 * Read through own-property DESCRIPTORS with Proxy / prototype / symbol-key /
 * unknown-key / accessor rejection — the OPTIONS-FIRST rule (spec README rule 4).
 * This is not ceremony: the baseline is the `before` half of the no-mutation
 * comparison, so a getter that returned one value here and another on a second
 * read would let a mutated run produce a matching pair. It is read EXACTLY ONCE
 * per field, before any filesystem work.
 *
 * Returns the sanitized hashes, or `null` for "reject".
 */
function resolveBaselineHashes(value: unknown): TreeHashes | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  if (nodeTypes.isProxy(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;

  const keys = ["agents", "skills", "registries"] as const;
  const own = Object.getOwnPropertyNames(value);
  if (own.length !== keys.length) return null;
  for (const k of own) if (!(keys as readonly string[]).includes(k)) return null;

  const out: Record<string, string> = {};
  for (const k of keys) {
    const desc = Object.getOwnPropertyDescriptor(value, k);
    if (!desc || !("value" in desc)) return null; // accessor — never fired
    if (typeof desc.value !== "string" || !TREE_HASH_RE.test(desc.value)) return null;
    out[k] = desc.value;
  }
  return { agents: out.agents, skills: out.skills, registries: out.registries };
}

/**
 * Modes under which a profile is emitted at all.
 *
 * `legacy` means "this project resolves the way it always has" — emitting a
 * capability profile there would be doing localization work in a project that has
 * not opted into it. Every other mode is at or past `observe`, which is exactly
 * "profile and propose, change nothing".
 */
export const PROFILE_EMITTING_MODES = Object.freeze([
  "observe",
  "shadow",
  "project-local",
  "strict",
] as const);

const EMITTING_MODE_SET: ReadonlySet<string> = new Set<string>(PROFILE_EMITTING_MODES);

// A project id: bounded, no separators, no control characters (rule 6).
const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const ID_MAX_LEN = 128;

function isSafeId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX_LEN && RUN_ID_RE.test(v);
}

/**
 * A RUN id must additionally match the shape DISCOVERY uses, or the profile is
 * written where nothing will ever look for it. `isRealRunDir` is imported from
 * the surface rather than re-stated here so there is exactly one definition.
 */
function isSafeRunId(v: unknown): v is string {
  return isSafeId(v) && isRealRunDir(v);
}

/**
 * Emit the profile, or refuse. NEVER throws.
 *
 * The full ordering, and why each step is where it is, is in the file header.
 */
export function emitCapabilityProfile(opts: EmitProfileOptions): EmitResult {
  try {
    // ── 0 — OPTIONS FIRST, in ONE pass, before any filesystem work ────────────
    // Rule 4. Every field is captured through own-data descriptors here so that
    // nothing caller-supplied can execute later, between a snapshot and the read
    // it guards. A getter that mutated the roster between two reads is exactly
    // what made the endpoint comparison meaningless (Codex round 2, finding 2).
    const o = captureEmitOptions(opts);
    if (o === null) {
      return {
        status: "refused",
        code: "invalid_options",
        detail: "options object is hostile or malformed (Proxy / accessor / unknown key / bad type)",
      };
    }

    if (!EMITTING_MODE_SET.has(o.resolverMode)) {
      return {
        status: "refused",
        code: "resolver_mode_disabled",
        detail: `resolver_mode "${o.resolverMode}" does not emit capability profiles`,
      };
    }
    if (!isSafeRunId(o.runId)) {
      return {
        status: "refused",
        code: "invalid_run_id",
        detail: "run id is not a discoverable run-YYYYMMDD-HHMMSS-<slug>",
      };
    }
    if (!isSafeId(o.projectId)) {
      return {
        status: "refused",
        code: "invalid_project_id",
        detail: "project id is not a safe slug",
      };
    }
    // A timestamp is an identifier-shaped scalar: shape-checked, not merely
    // non-empty. "not-rfc3339" was accepted and emitted (Codex round 2, L).
    if (o.generatedAt.length > 64 || !RFC3339_RE.test(o.generatedAt)) {
      return {
        status: "refused",
        code: "invalid_generated_at",
        detail: "generated_at is not an RFC3339 timestamp",
      };
    }

    let baseline: TreeHashes | null = null;
    if (o.baselineHashes !== undefined) {
      baseline = resolveBaselineHashes(o.baselineHashes);
      if (baseline === null) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baselineHashes is not three bare 64-hex tree hashes",
        };
      }
    }
    const window: MutationWindow = baseline === null ? "emission" : "run";

    const root = o.projectRoot;

    // ── 1 — BEFORE ────────────────────────────────────────────────────────────
    // A caller-supplied run-start baseline widens the compared window to the whole
    // Learn run; without one it brackets the emission only, and the result says so
    // via `window` rather than leaving the reader to assume the wider claim.
    const before = baseline ?? snapshotTreeHashes(root);
    if (before === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be hashed completely",
      };
    }

    // ── 2 derive (in the caller, read-only) — 3 AFTER ─────────────────────────
    const feedstock = snapshotFeedstock(root);
    const after = snapshotTreeHashes(root);
    if (after === null) {
      return {
        status: "refused",
        code: "hash_incomplete",
        detail: "the agents/skills/registry trees could not be re-hashed completely",
      };
    }

    // ── 4 — a run that mutated cannot emit ────────────────────────────────────
    // There is no "report the mutation" branch, because S1's type has no way to
    // express one.
    if (!sameHashes(before, after)) {
      return {
        status: "refused",
        code: "mutation_detected",
        detail: "agents/skills/registry tree changed during Learn — no profile emitted",
      };
    }

    const profile: ProjectCapabilityProfileV1 = {
      schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
      project_id: o.projectId,
      run_id: o.runId,
      generated_at: o.generatedAt,
      source_commit: o.sourceCommit,
      feedstock,
      domains: (o.facts as DerivedFacts)?.domains,
      boundaries: (o.facts as DerivedFacts)?.boundaries,
      repeated_methods: (o.facts as DerivedFacts)?.repeated_methods,
      coverage: (o.facts as DerivedFacts)?.coverage,
      candidates: (o.facts as DerivedFacts)?.candidates,
      resolver_mode: o.resolverMode as ResolverMode,
      mutation_performed: false,
      mutation_evidence: {
        agents_tree_hash_before: before.agents,
        agents_tree_hash_after: after.agents,
        skills_tree_hash_before: before.skills,
        skills_tree_hash_after: after.skills,
        registry_hash_before: before.registries,
        registry_hash_after: after.registries,
      },
    };

    // ── 5 — S1's validator, not a second opinion of it ────────────────────────
    // An invalid profile is never written: a file on disk that fails validation is
    // worse than no file, because a reader has to discover the failure instead of
    // the absence.
    const validated = validateProjectCapabilityProfileV1(profile, {
      suggestionBudget: o.suggestionBudget,
    });
    if (validated === null) {
      return {
        status: "refused",
        code: "profile_invalid",
        detail: "assembled profile failed guild.project_capability_profile.v1 validation",
      };
    }

    // ── 6 — the ONE write ─────────────────────────────────────────────────────
    // LEXICAL bound first, through the same function that bounds the agent, then
    // the PHYSICAL bound, which the pure contract cannot check.
    const rel = profileRelPath(o.runId);
    const verdict = classifyContextManagerWrite(rel);
    if (verdict.allowed !== true) {
      return {
        status: "refused",
        code: "write_forbidden",
        detail: `context-manager contract refused "${rel}": ${verdict.reason}`,
      };
    }

    const abs = path.join(root, rel);
    let priorBytes: Buffer | null = null;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      // PHYSICAL containment, AFTER mkdir so the real destination exists and BEFORE
      // the write. A symlinked `capability/` directory pointed the file at /tmp and
      // the emitter still reported success (Codex round 2, finding 1).
      if (!isContainedRealPath(root, abs)) {
        return {
          status: "refused",
          code: "escapes_project_root",
          detail: `"${rel}" resolves outside the project root once symlinks are followed`,
        };
      }
      // Capture the previous bytes so a post-write refusal RESTORES rather than
      // destroys a profile that was valid a moment ago (Codex round 2, finding 12).
      try {
        priorBytes = fs.readFileSync(abs);
      } catch {
        priorBytes = null; // no previous profile — nothing to restore
      }
      fs.writeFileSync(abs, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    } catch (e) {
      return { status: "refused", code: "write_failed", detail: String(e) };
    }

    // ── 7 — POST-WRITE re-hash ────────────────────────────────────────────────
    // Steps 1-4 prove the derivation was clean; only this proves the EMISSION was.
    // If the write escaped its bounds, undo it: a run that mutated must not leave
    // behind an artifact asserting it did not.
    const post = snapshotTreeHashes(root);
    if (post === null || !sameHashes(after, post)) {
      try {
        if (priorBytes === null) fs.rmSync(abs, { force: true });
        else fs.writeFileSync(abs, priorBytes);
      } catch {
        /* best effort — the refusal below is the report either way */
      }
      return {
        status: "refused",
        code: post === null ? "hash_incomplete" : "post_write_mutation",
        detail:
          post === null
            ? "post-write hashing was incomplete — profile rolled back"
            : "profile emission itself changed a hashed tree — profile rolled back",
      };
    }

    return { status: "emitted", rel_path: rel, profile: validated, hashes: after, window };
  } catch (e) {
    // A thrown emitter would abort the Learn run this is a side-report of.
    return { status: "refused", code: "write_failed", detail: String(e) };
  }
}

/** Read a previously emitted profile. Returns the VALIDATED profile or null. */
export function readCapabilityProfile(
  projectRoot: string,
  runId: string,
  opts: { suggestionBudget?: number } = {}
): ProjectCapabilityProfileV1 | null {
  try {
    if (!isSafeRunId(runId)) return null;
    const abs = path.join(projectRoot, profileRelPath(runId));
    const raw: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
    return validateProjectCapabilityProfileV1(raw, {
      suggestionBudget: opts.suggestionBudget ?? DEFAULT_SUGGESTION_BUDGET,
    });
  } catch {
    return null;
  }
}
