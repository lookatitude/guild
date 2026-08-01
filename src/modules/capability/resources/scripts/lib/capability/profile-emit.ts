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
import { classifyContextManagerWrite } from "./context-manager-contract";

// ── The hash recipe, stated so a shell can reproduce it ──────────────────────

/**
 * A1.7 requires the profile's hashes to match hashes computed by a SHELL, not by
 * this module. That is only checkable if the recipe is written down, so it is —
 * and `scripts/capability-profile.ts hash-tree` prints the same value, giving the
 * conformance run two independent computations to compare.
 *
 *   for each file under the root, in ascending byte order of its POSIX-relative path:
 *     emit  "<relpath>\0<sha256-hex-of-file-bytes>\n"
 *   sha256 over that concatenation, lowercase hex
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
  'sha256( concat( sorted( "<relpath>\\0" + sha256(file bytes) + "\\n" ) ) )';

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

function listFiles(absRoot: string, rel = "", depth = 0): string[] {
  // Depth cap: symlinks are skipped so a cycle cannot form through one, but a
  // deep real tree (or a bind mount) would still recurse without a bound, and
  // this runs inside `/guild:status`' read path.
  if (depth > MAX_TREE_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(absRoot, e.name), childRel, depth + 1));
    else if (e.isFile()) out.push(childRel);
  }
  return out.sort();
}

/** Hash one directory tree per `TREE_HASH_RECIPE`. An absent tree hashes empty. */
export function hashTree(projectRoot: string, relRoot: string): string {
  const abs = path.join(projectRoot, relRoot);
  const files = listFiles(abs);
  if (files.length === 0) return EMPTY_TREE_HASH;
  const h = createHash("sha256");
  for (const f of files) {
    const fileHash = sha256File(path.join(abs, f));
    if (fileHash === null) continue; // unreadable — skipped, per listFiles' reasoning
    h.update(`${f}\0${fileHash}\n`);
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
export function hashFileSet(projectRoot: string, relPaths: readonly string[]): string {
  const h = createHash("sha256");
  let any = false;
  for (const rel of [...relPaths].sort()) {
    const fileHash = sha256File(path.join(projectRoot, rel));
    if (fileHash === null) continue;
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

/** The three hashes S1's `mutation_evidence` compares. One call, one snapshot. */
export function snapshotTreeHashes(projectRoot: string): TreeHashes {
  return {
    agents: hashTree(projectRoot, HASHED_TREES[0]),
    skills: hashTree(projectRoot, HASHED_TREES[1]),
    registries: hashFileSet(projectRoot, HASHED_REGISTRIES),
  };
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
  "invalid_baseline",
  "mutation_detected",
  "profile_invalid",
  "write_forbidden",
  "write_failed",
  "post_write_mutation",
] as const);
export type EmitRefusalCode = (typeof EMIT_REFUSAL_CODES)[number];

export type EmitResult =
  | {
      status: "emitted";
      rel_path: string;
      profile: ProjectCapabilityProfileV1;
      hashes: TreeHashes;
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

// A run id names a directory. Bounded, no separators, no control characters —
// the same shape rules every other identifier in this wave carries (rule 6).
const RUN_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;
const ID_MAX_LEN = 128;

function isSafeId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= ID_MAX_LEN && RUN_ID_RE.test(v);
}

/**
 * Emit the profile, or refuse. NEVER throws.
 *
 * The full ordering, and why each step is where it is, is in the file header.
 */
export function emitCapabilityProfile(opts: EmitProfileOptions): EmitResult {
  try {
    if (!EMITTING_MODE_SET.has(opts.resolverMode)) {
      return {
        status: "refused",
        code: "resolver_mode_disabled",
        detail: `resolver_mode "${opts.resolverMode}" does not emit capability profiles`,
      };
    }
    if (!isSafeId(opts.runId)) {
      return { status: "refused", code: "invalid_run_id", detail: "run id is not a safe slug" };
    }
    if (!isSafeId(opts.projectId)) {
      return {
        status: "refused",
        code: "invalid_project_id",
        detail: "project id is not a safe slug",
      };
    }

    // OPTIONS FIRST — the baseline is resolved before any filesystem work, so
    // nothing caller-supplied can execute between a snapshot and the read it
    // guards (spec README rule 4).
    let baseline: TreeHashes | null = null;
    if (opts.baselineHashes !== undefined) {
      baseline = resolveBaselineHashes(opts.baselineHashes);
      if (baseline === null) {
        return {
          status: "refused",
          code: "invalid_baseline",
          detail: "baselineHashes is not three bare 64-hex tree hashes",
        };
      }
    }

    const root = opts.projectRoot;

    // 1 — BEFORE. A caller-supplied run-start baseline widens the compared window
    //     to the whole Learn run; without one it brackets the emission only, and
    //     the profile claims no more than that.
    const before = baseline ?? snapshotTreeHashes(root);

    // 2 — read-only derivation happened in the caller; 3 — AFTER.
    const feedstock = snapshotFeedstock(root);
    const after = snapshotTreeHashes(root);

    // 4 — a run that mutated cannot emit. There is no "report the mutation"
    //     branch, because S1's type has no way to express one.
    if (!sameHashes(before, after)) {
      return {
        status: "refused",
        code: "mutation_detected",
        detail: "agents/skills/registry tree changed during Learn — no profile emitted",
      };
    }

    const profile: ProjectCapabilityProfileV1 = {
      schema_version: PROJECT_CAPABILITY_PROFILE_SCHEMA,
      project_id: opts.projectId,
      run_id: opts.runId,
      generated_at: opts.generatedAt,
      source_commit: opts.sourceCommit,
      feedstock,
      domains: opts.facts.domains,
      boundaries: opts.facts.boundaries,
      repeated_methods: opts.facts.repeated_methods,
      coverage: opts.facts.coverage,
      candidates: opts.facts.candidates,
      resolver_mode: opts.resolverMode,
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

    // 5 — S1's validator, not a second opinion of it. An invalid profile is never
    //     written: a file on disk that fails validation is worse than no file,
    //     because a reader has to discover the failure instead of the absence.
    const budget = opts.suggestionBudget ?? DEFAULT_SUGGESTION_BUDGET;
    const validated = validateProjectCapabilityProfileV1(profile, { suggestionBudget: budget });
    if (validated === null) {
      return {
        status: "refused",
        code: "profile_invalid",
        detail: "assembled profile failed guild.project_capability_profile.v1 validation",
      };
    }

    // 6 — the ONE write, through the context-manager contract. The emitter cannot
    //     write anywhere the agent may not; the contract binds both.
    const rel = profileRelPath(opts.runId);
    const verdict = classifyContextManagerWrite(rel);
    if (verdict.allowed !== true) {
      return {
        status: "refused",
        code: "write_forbidden",
        detail: `context-manager contract refused "${rel}": ${verdict.reason}`,
      };
    }

    const abs = path.join(root, rel);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
    } catch (e) {
      return { status: "refused", code: "write_failed", detail: String(e) };
    }

    // 7 — POST-WRITE re-hash. Steps 1–4 prove the derivation was clean; only this
    //     proves the EMISSION was. If the write escaped its bounds, remove the
    //     profile: a run that mutated must not leave behind an artifact asserting
    //     it did not.
    const post = snapshotTreeHashes(root);
    if (!sameHashes(after, post)) {
      try {
        fs.rmSync(abs, { force: true });
      } catch {
        /* best effort — the refusal below is the report either way */
      }
      return {
        status: "refused",
        code: "post_write_mutation",
        detail: "profile emission itself changed a hashed tree — profile removed",
      };
    }

    return { status: "emitted", rel_path: rel, profile: validated, hashes: after };
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
    if (!isSafeId(runId)) return null;
    const abs = path.join(projectRoot, profileRelPath(runId));
    const raw: unknown = JSON.parse(fs.readFileSync(abs, "utf8"));
    return validateProjectCapabilityProfileV1(raw, {
      suggestionBudget: opts.suggestionBudget ?? DEFAULT_SUGGESTION_BUDGET,
    });
  } catch {
    return null;
  }
}
