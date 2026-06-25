#!/usr/bin/env -S npx tsx
/**
 * scripts/lib/dashboard-projector.ts
 *
 * P2-Wave-3 ADDITIVE CONTRACT — `guild.dashboard.v1`: a READ-ONLY projection over a
 * project's `.guild/` state surfacing the six AC36 workspace-dashboard sections
 * (ADR migration step 18 / AC36 + AC33; spec SC-W3-3, plan lane LW3-3).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 18 (AC36 dashboard / AC33 isolation)
 *   .guild/spec/universal-host-p2-wave3.md   SC-W3-3
 *   .guild/plan/universal-host-p2-wave3.md   lane LW3-3
 *
 * The SIX AC36 sections — ALL ALWAYS PRESENT (empty/zeroed, never omitted, so the
 * "all six sections present" invariant holds even over a bare repo):
 *   1. active_initiatives    — from `.guild/indexes/initiatives-registry.yaml` + active/ dir
 *   2. child_project_health  — from root `.guild/workspace.json` sub_guilds (ids/paths/flags ONLY)
 *   3. stale_knowledge       — from root `.guild/indexes/*` manifest freshness markers (NOT wiki bodies)
 *   4. lane_progress         — from the active run dir (run.yaml + handoffs/ + questions/)
 *   5. acceptance_criteria   — from the active `.guild/spec/<slug>.md` Success-criteria SC ids
 *   6. qa_release_readiness  — from run.yaml gates/status + the attached initiative's release_status
 *
 * HARD INVARIANTS (this module):
 *   - READ-ONLY. The module imports NO fs write API and exposes NO write seam. The
 *     projection is a return value; nothing is ever persisted here.
 *   - AC33 isolation (reuse of the Wave-1 read-deny discipline): every read goes through a
 *     seam that is wrapped by `guardDashboardReads`, which throws on ANY path under a
 *     `.guild/wiki/` (root OR child) using the SAME `isChildWikiPath` predicate the Wave-1
 *     impact detector uses (dependency-graph-reader.ts). The projector never constructs a
 *     `.guild/wiki` path, so in the happy path the guard never fires — but it makes any
 *     accidental wiki read FAIL CLOSED, and the anti-vacuous SC-W3-3 test (LW3-6) proves the
 *     guard is not vacuous via a positive control. No child-wiki content can reach the output.
 *   - Determinism: all exported functions are pure + synchronous; NO `Date.now()` /
 *     `Math.random()` / I/O at module scope. The caller supplies `now` (ms) + `generated_at`
 *     (ISO) so staleness + the stamp are deterministic. The `if (require.main === module)`
 *     CLI harness at the bottom is the ONLY place a real clock / real fs is read — that is
 *     the existing-path surface (tsx invocation), NOT the artifact body.
 *
 * Surfaced via an EXISTING path: invoke as `npx tsx scripts/lib/dashboard-projector.ts
 * [--project-root <abs>]` (prints the projection as JSON). NO `commands/*.md` and NO live
 * skill is added or changed this wave (F-5 / non-goals: a `/guild:dashboard` view-command
 * file is DEFERRED with the cutover bundle).
 *
 * Owned by tooling-engineer (LW3-3); the AUTHORITATIVE SC-W3-3 6-sections + sentinel/
 * write-deny anti-vacuous test is owned by eval-engineer (LW3-6). A co-located unit test
 * (scripts/__tests__/dashboard-projector.test.ts) covers the real path + isolation here.
 */

import { parseFrontmatter, parseYaml } from "../../state";

/**
 * AC33 child-wiki predicate — the VERBATIM Wave-1 read-deny rule. Canonical source:
 * `scripts/lib/dependency-graph-reader.ts` `isChildWikiPath`. It is re-declared here
 * (rather than imported) ON PURPOSE: dependency-graph-reader transitively imports
 * dependency-graph-schema.ts, which uses a BigInt literal that the in-band `scripts/`
 * jest target cannot compile — importing it would break the SC-W3-6 "scripts suite green
 * in-band" guard. The predicate is a single line; keeping it byte-identical preserves the
 * discipline. (If the canonical predicate ever changes, update both.)
 */
export function isChildWikiPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/");
  return /(^|\/)\.guild\/wiki(\/|$)/.test(norm);
}

// ── Schema constants ──────────────────────────────────────────────────────────

export const DASHBOARD_SCHEMA_VERSION = "guild.dashboard.v1" as const;

/** The six AC36 sections, in canonical order. The validator asserts ALL are present. */
export const DASHBOARD_SECTION_KEYS = [
  "active_initiatives",
  "child_project_health",
  "stale_knowledge",
  "lane_progress",
  "acceptance_criteria",
  "qa_release_readiness",
] as const;
export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];

/** A knowledge index manifest is considered stale once older than this (caller `now`). */
export const STALE_AFTER_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Bound any free-text reference field so bulk content can never ride through. */
export const REFERENCE_FIELD_MAX_LEN = 200;

// ── Read seam (READ-ONLY) + AC33 child-wiki guard ─────────────────────────────

/** READ-ONLY filesystem seam. There is deliberately NO write method. */
export interface DashboardReadSeam {
  /** True when `absPath` exists (file or dir). */
  exists(absPath: string): boolean;
  /** utf-8 read; throws on missing (callers catch). */
  readFile(absPath: string): string;
  /** Entry names in `absPath`; [] when missing / not-a-dir. */
  readDir(absPath: string): string[];
}

/**
 * Wrap a read seam so EVERY access under a `.guild/wiki/` (root or child) FAILS CLOSED —
 * the Wave-1 AC33/F-7 read-deny discipline (reuses `isChildWikiPath` verbatim), extended to
 * cover `readDir` as well as `exists`/`readFile`. `onDeny` is called before the throw so a
 * test can record the denied path (anti-vacuity).
 */
export function guardDashboardReads(
  inner: DashboardReadSeam,
  onDeny?: (deniedPath: string) => void,
): DashboardReadSeam {
  const deny = (absPath: string): void => {
    if (isChildWikiPath(absPath)) {
      if (onDeny) onDeny(absPath);
      throw new Error(
        `AC33/F-7 isolation violation: dashboard projector refused to read under a ` +
          `.guild/wiki (${absPath})`,
      );
    }
  };
  return {
    exists(absPath: string): boolean {
      deny(absPath);
      return inner.exists(absPath);
    },
    readFile(absPath: string): string {
      deny(absPath);
      return inner.readFile(absPath);
    },
    readDir(absPath: string): string[] {
      deny(absPath);
      return inner.readDir(absPath);
    },
  };
}

// ── Projection shape — `guild.dashboard.v1` ────────────────────────────────────

export interface ActiveInitiative {
  id: string;
  title: string; // bounded reference (≤ REFERENCE_FIELD_MAX_LEN)
  status: string;
  scope: string;
  path: string;
  updated_at: string;
}

export interface ChildHealth {
  name: string;
  path: string;
  kind: string;
  has_wiki: boolean;
  has_indexes: boolean;
  last_seen_commit: string;
}

export interface StaleKnowledgeItem {
  artifact: string; // e.g. "indexes/codebase-map.json"
  present: boolean;
  generated_at: string | null;
  source_commit: string | null;
  stale: boolean;
  reason: string; // bounded
}

export interface LaneProgress {
  run_id: string | null;
  phase: string | null;
  status: string | null;
  completed_lanes: string[]; // lane ids parsed from handoffs/<owner>-<laneId>.md
  handoffs_count: number;
  open_questions: string[]; // lane ids parsed from questions/<laneId>.md
}

export type AcceptanceStatus = "planned" | "in_progress" | "verified";

export interface AcceptanceCriterion {
  id: string; // e.g. "SC-W3-3"
  ac_refs: string[]; // e.g. ["AC36", "AC33"]
  title: string; // bounded one-line reference
  status: AcceptanceStatus;
}

export interface QaReleaseReadiness {
  run_status: string | null;
  phase: string | null;
  gates: Record<string, string>;
  gates_total: number;
  gates_passed: number;
  verify_present: boolean;
  review_present: boolean;
  release_status: string | null; // from the attached initiative in the registry
}

export interface DashboardProjection {
  schema_version: typeof DASHBOARD_SCHEMA_VERSION;
  generated_at: string; // caller-supplied ISO (determinism)
  project_root: string;
  sections: {
    active_initiatives: ActiveInitiative[];
    child_project_health: ChildHealth[];
    stale_knowledge: StaleKnowledgeItem[];
    lane_progress: LaneProgress;
    acceptance_criteria: AcceptanceCriterion[];
    qa_release_readiness: QaReleaseReadiness;
  };
}

export interface ProjectOpts {
  /** Monotonic-enough reference time (ms since epoch) for staleness. Caller-supplied. */
  now: number;
  /** ISO stamp written into `generated_at`. Caller-supplied (determinism). */
  generated_at: string;
  /** Optional explicit spec path for the acceptance-criteria section. */
  specPath?: string;
  /** Optional explicit run id; else `.guild/runs/current-run-id`, else newest run dir. */
  runId?: string;
}

// ── Small helpers (pure) ───────────────────────────────────────────────────────

function bound(s: unknown, max = REFERENCE_FIELD_MAX_LEN): string {
  const str = typeof s === "string" ? s : s == null ? "" : String(s);
  const oneLine = str.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

function safeReadFile(seam: DashboardReadSeam, p: string): string | null {
  try {
    if (!seam.exists(p)) return null;
    return seam.readFile(p);
  } catch {
    // A guard throw (child-wiki) must propagate so isolation fails loud; a plain
    // missing/unreadable file is soft. Distinguish by re-checking the guard predicate.
    if (isChildWikiPath(p)) throw new Error(`AC33 isolation: refused ${p}`);
    return null;
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

// ── Section 1 — active initiatives ─────────────────────────────────────────────

const CLOSED_STATUSES = new Set(["closed", "archived"]);

export function projectActiveInitiatives(
  root: string,
  seam: DashboardReadSeam,
): ActiveInitiative[] {
  const regPath = `${root}/.guild/indexes/initiatives-registry.yaml`;
  const raw = safeReadFile(seam, regPath);
  const out: ActiveInitiative[] = [];
  if (raw) {
    const parsed = parseYaml(raw);
    const list =
      isObj(parsed) && Array.isArray((parsed as { initiatives?: unknown }).initiatives)
        ? ((parsed as { initiatives: unknown[] }).initiatives)
        : [];
    for (const entry of list) {
      if (!isObj(entry)) continue;
      const finalStatus = typeof entry["final_status"] === "string" ? entry["final_status"] : "";
      const status = typeof entry["status"] === "string" ? entry["status"] : "";
      const path = typeof entry["path"] === "string" ? entry["path"] : "";
      // Active = final_status not closed AND not living under archived/.
      const archived = /(^|\/)archived\//.test(path) || CLOSED_STATUSES.has(finalStatus);
      if (archived) continue;
      out.push({
        id: bound(entry["id"], 120),
        title: bound(entry["title"]),
        status: bound(status || finalStatus, 80),
        scope: bound(entry["scope"], 40),
        path: bound(path, 160),
        updated_at: bound(entry["updated_at"], 40),
      });
    }
  }
  // Fallback / cross-check: directory listing of active/ (ids only — never descend).
  if (out.length === 0) {
    const activeDir = `${root}/.guild/initiatives/active`;
    let names: string[] = [];
    try {
      names = seam.readDir(activeDir);
    } catch {
      names = [];
    }
    for (const name of names.sort()) {
      if (name.startsWith(".")) continue;
      out.push({
        id: bound(name, 120),
        title: "",
        status: "active",
        scope: "",
        path: `.guild/initiatives/active/${name}/`,
        updated_at: "",
      });
    }
  }
  return out;
}

// ── Section 2 — child-project health (ids/paths/flags ONLY; AC33) ───────────────

export function projectChildHealth(root: string, seam: DashboardReadSeam): ChildHealth[] {
  const wsPath = `${root}/.guild/workspace.json`;
  const raw = safeReadFile(seam, wsPath);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isObj(parsed) || parsed["is_workspace"] !== true) return [];
  const subs = Array.isArray(parsed["sub_guilds"]) ? (parsed["sub_guilds"] as unknown[]) : [];
  const out: ChildHealth[] = [];
  for (const entry of subs) {
    if (!isObj(entry)) continue;
    out.push({
      name: bound(entry["name"], 80),
      path: bound(entry["path"], 160),
      kind: bound(entry["kind"], 40),
      has_wiki: entry["has_wiki"] === true,
      has_indexes: entry["has_indexes"] === true,
      last_seen_commit: bound(entry["last_seen_commit"], 64),
    });
  }
  return out;
}

// ── Section 3 — stale knowledge (index-manifest freshness; NOT wiki bodies) ─────

/** Root index manifests whose freshness markers drive the stale-knowledge section. */
const KNOWLEDGE_MANIFESTS = [
  "codebase-map.json",
  "knowledge-graph.json",
  "architecture-map.md",
  "onboarding-tour.md",
] as const;

function readFreshness(
  raw: string,
  artifact: string,
): { generated_at: string | null; source_commit: string | null } {
  let generated_at: string | null = null;
  let source_commit: string | null = null;
  if (artifact.endsWith(".json")) {
    try {
      const o = JSON.parse(raw);
      if (isObj(o)) {
        generated_at =
          (typeof o["generated_at"] === "string" && o["generated_at"]) ||
          (typeof o["updated_at"] === "string" && o["updated_at"]) ||
          null;
        source_commit =
          (typeof o["generated_from_commit"] === "string" && o["generated_from_commit"]) ||
          (typeof o["source_commit"] === "string" && o["source_commit"]) ||
          null;
      }
    } catch {
      /* unreadable JSON → no markers */
    }
  } else {
    // Markdown stub — read leading frontmatter only (NOT the body) for updated_at.
    const fm = parseFrontmatter(raw);
    if (fm) {
      generated_at =
        (typeof fm["updated_at"] === "string" && fm["updated_at"]) ||
        (typeof fm["generated_at"] === "string" && fm["generated_at"]) ||
        null;
    }
  }
  return { generated_at, source_commit };
}

export function projectStaleKnowledge(
  root: string,
  seam: DashboardReadSeam,
  now: number,
): StaleKnowledgeItem[] {
  const out: StaleKnowledgeItem[] = [];
  for (const name of KNOWLEDGE_MANIFESTS) {
    const artifact = `indexes/${name}`;
    const p = `${root}/.guild/indexes/${name}`;
    const raw = safeReadFile(seam, p);
    if (raw === null) {
      out.push({
        artifact,
        present: false,
        generated_at: null,
        source_commit: null,
        stale: true,
        reason: "knowledge artifact missing",
      });
      continue;
    }
    const { generated_at, source_commit } = readFreshness(raw, name);
    let stale = false;
    let reason = "fresh";
    if (!generated_at) {
      stale = true;
      reason = "no freshness marker (generated_at/updated_at)";
    } else {
      const ts = Date.parse(generated_at);
      if (Number.isNaN(ts)) {
        stale = true;
        reason = "unparseable freshness timestamp";
      } else if (now - ts > STALE_AFTER_DAYS * MS_PER_DAY) {
        stale = true;
        const days = Math.floor((now - ts) / MS_PER_DAY);
        reason = `older than ${STALE_AFTER_DAYS}d (age ${days}d)`;
      }
    }
    out.push({ artifact, present: true, generated_at, source_commit, stale, reason: bound(reason) });
  }
  return out;
}

// ── Run-dir resolution (shared by sections 4 + 6) ───────────────────────────────

export function resolveRunDir(
  root: string,
  seam: DashboardReadSeam,
  runId?: string,
): { runId: string; dir: string } | null {
  const runsRoot = `${root}/.guild/runs`;
  if (runId) {
    const dir = `${runsRoot}/${runId}`;
    if (seam.exists(dir)) return { runId, dir };
  }
  // current-run-id pointer
  const ptr = safeReadFile(seam, `${runsRoot}/current-run-id`);
  if (ptr) {
    const id = ptr.trim().split("\n")[0].trim();
    if (id && seam.exists(`${runsRoot}/${id}`)) return { runId: id, dir: `${runsRoot}/${id}` };
  }
  // newest run dir by lexical sort (run ids are timestamp/uuid suffixed)
  let names: string[] = [];
  try {
    names = seam.readDir(runsRoot);
  } catch {
    names = [];
  }
  const dirs = names
    .filter((n) => n.startsWith("run-"))
    .filter((n) => seam.exists(`${runsRoot}/${n}/run.yaml`))
    .sort();
  if (dirs.length === 0) return null;
  const id = dirs[dirs.length - 1];
  return { runId: id, dir: `${runsRoot}/${id}` };
}

/** Parse `<owner>-<laneId>.md` → laneId (the trailing token group). */
function laneIdFromHandoff(filename: string): string | null {
  const m = /^.*-([A-Za-z]+\d[\w-]*)\.md$/.exec(filename);
  if (m) return m[1];
  const base = filename.replace(/\.md$/, "");
  const parts = base.split("-");
  return parts.length > 1 ? parts.slice(-2).join("-") : base || null;
}

// ── Section 4 — lane progress ───────────────────────────────────────────────────

export function projectLaneProgress(
  root: string,
  seam: DashboardReadSeam,
  runId?: string,
): LaneProgress {
  const resolved = resolveRunDir(root, seam, runId);
  const empty: LaneProgress = {
    run_id: null,
    phase: null,
    status: null,
    completed_lanes: [],
    handoffs_count: 0,
    open_questions: [],
  };
  if (!resolved) return empty;
  const runRaw = safeReadFile(seam, `${resolved.dir}/run.yaml`);
  let phase: string | null = null;
  let status: string | null = null;
  if (runRaw) {
    const y = parseYaml(runRaw);
    if (isObj(y)) {
      phase = typeof y["phase"] === "string" ? y["phase"] : null;
      status = typeof y["status"] === "string" ? y["status"] : null;
    }
  }
  let handoffNames: string[] = [];
  try {
    handoffNames = seam.readDir(`${resolved.dir}/handoffs`).filter((n) => n.endsWith(".md"));
  } catch {
    handoffNames = [];
  }
  const completed = handoffNames
    .map(laneIdFromHandoff)
    .filter((x): x is string => !!x)
    .sort();
  let questionNames: string[] = [];
  try {
    questionNames = seam.readDir(`${resolved.dir}/questions`).filter((n) => n.endsWith(".md"));
  } catch {
    questionNames = [];
  }
  const openQuestions = questionNames.map((n) => n.replace(/\.md$/, "")).sort();
  return {
    run_id: resolved.runId,
    phase,
    status,
    completed_lanes: Array.from(new Set(completed)),
    handoffs_count: handoffNames.length,
    open_questions: openQuestions,
  };
}

// ── Section 5 — acceptance-criteria status ───────────────────────────────────────

const SC_LINE = /\bSC-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\b/g;
const AC_REF = /\bAC\d+\b/g;

function resolveSpecPath(
  root: string,
  seam: DashboardReadSeam,
  runId: string | null,
  explicit?: string,
): string | null {
  if (explicit) return seam.exists(explicit) ? explicit : null;
  const specDir = `${root}/.guild/spec`;
  let names: string[] = [];
  try {
    names = seam.readDir(specDir).filter((n) => n.endsWith(".md"));
  } catch {
    return null;
  }
  if (names.length === 0) return null;
  // Prefer a spec whose slug overlaps the run id's attached initiative token.
  if (runId) {
    const idTokens = runId.replace(/^run-/, "").split(/[-T]/).filter((t) => t.length > 3);
    const scored = names
      .map((n) => {
        const slug = n.replace(/\.md$/, "");
        const score = idTokens.filter((t) => slug.includes(t)).length;
        return { n, score };
      })
      .sort((a, b) => b.score - a.score || (a.n < b.n ? 1 : -1));
    if (scored[0].score > 0) return `${specDir}/${scored[0].n}`;
  }
  // Else newest spec by lexical sort.
  return `${specDir}/${names.sort()[names.length - 1]}`;
}

/** Extract the body of the `## Success criteria` section (until the next `## `). */
function successCriteriaBlock(specBody: string): string {
  const m = /^##\s+Success criteria\s*$/im.exec(specBody);
  if (!m) return "";
  const after = specBody.slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(after);
  return next ? after.slice(0, next.index) : after;
}

export function projectAcceptanceCriteria(
  root: string,
  seam: DashboardReadSeam,
  runId: string | null,
  explicitSpec?: string,
): AcceptanceCriterion[] {
  const specPath = resolveSpecPath(root, seam, runId, explicitSpec);
  if (!specPath) return [];
  const raw = safeReadFile(seam, specPath);
  if (!raw) return [];
  const block = successCriteriaBlock(raw);
  if (!block) return [];

  // Verify evidence: a run-level verify.md naming the SC id → "verified".
  let verifyText = "";
  let anyHandoff = false;
  if (runId) {
    verifyText = safeReadFile(seam, `${root}/.guild/runs/${runId}/verify.md`) ?? "";
    try {
      anyHandoff =
        seam.readDir(`${root}/.guild/runs/${runId}/handoffs`).filter((n) => n.endsWith(".md"))
          .length > 0;
    } catch {
      anyHandoff = false;
    }
  }

  const seen = new Map<string, AcceptanceCriterion>();
  for (const line of block.split("\n")) {
    const ids = line.match(SC_LINE);
    if (!ids) continue;
    const acRefs = Array.from(new Set(line.match(AC_REF) ?? []));
    for (const id of ids) {
      if (seen.has(id)) {
        // merge AC refs if a later line references the same SC
        const cur = seen.get(id)!;
        cur.ac_refs = Array.from(new Set([...cur.ac_refs, ...acRefs]));
        continue;
      }
      let status: AcceptanceStatus = "planned";
      if (verifyText && verifyText.includes(id)) status = "verified";
      else if (anyHandoff) status = "in_progress";
      seen.set(id, { id, ac_refs: acRefs, title: bound(line.replace(/^[-*\s]+/, "")), status });
    }
  }
  return Array.from(seen.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── Section 6 — QA / release readiness ───────────────────────────────────────────

export function projectQaReleaseReadiness(
  root: string,
  seam: DashboardReadSeam,
  runId?: string,
): QaReleaseReadiness {
  const resolved = resolveRunDir(root, seam, runId);
  const out: QaReleaseReadiness = {
    run_status: null,
    phase: null,
    gates: {},
    gates_total: 0,
    gates_passed: 0,
    verify_present: false,
    review_present: false,
    release_status: null,
  };
  let attachment: string | null = null;
  if (resolved) {
    const runRaw = safeReadFile(seam, `${resolved.dir}/run.yaml`);
    if (runRaw) {
      const y = parseYaml(runRaw);
      if (isObj(y)) {
        out.run_status = typeof y["status"] === "string" ? y["status"] : null;
        out.phase = typeof y["phase"] === "string" ? y["phase"] : null;
        attachment =
          typeof y["initiative_attachment"] === "string" ? y["initiative_attachment"] : null;
        if (isObj(y["gates"])) {
          for (const [k, v] of Object.entries(y["gates"] as Record<string, unknown>)) {
            out.gates[bound(k, 60)] = bound(v, 60);
          }
        }
      }
    }
    out.gates_total = Object.keys(out.gates).length;
    out.gates_passed = Object.values(out.gates).filter((v) =>
      /pass|passed|satisfied|ok|done|approved/i.test(v),
    ).length;
    out.verify_present = seam.exists(`${resolved.dir}/verify.md`);
    out.review_present = seam.exists(`${resolved.dir}/review.md`);
  }
  // Attached initiative's release_status from the registry (reference only).
  if (attachment) {
    const regRaw = safeReadFile(seam, `${root}/.guild/indexes/initiatives-registry.yaml`);
    if (regRaw) {
      const parsed = parseYaml(regRaw);
      const list =
        isObj(parsed) && Array.isArray((parsed as { initiatives?: unknown }).initiatives)
          ? (parsed as { initiatives: unknown[] }).initiatives
          : [];
      for (const e of list) {
        if (isObj(e) && e["id"] === attachment) {
          out.release_status =
            typeof e["release_status"] === "string" ? e["release_status"] : null;
          break;
        }
      }
    }
  }
  return out;
}

// ── Top-level projector ──────────────────────────────────────────────────────────

export function projectDashboard(
  projectRoot: string,
  seam: DashboardReadSeam,
  opts: ProjectOpts,
): DashboardProjection {
  // EVERY read goes through the AC33 guard — fail-closed on any .guild/wiki path.
  const guarded = guardDashboardReads(seam);
  const lane = projectLaneProgress(projectRoot, guarded, opts.runId);
  return {
    schema_version: DASHBOARD_SCHEMA_VERSION,
    generated_at: opts.generated_at,
    project_root: projectRoot,
    sections: {
      active_initiatives: projectActiveInitiatives(projectRoot, guarded),
      child_project_health: projectChildHealth(projectRoot, guarded),
      stale_knowledge: projectStaleKnowledge(projectRoot, guarded, opts.now),
      lane_progress: lane,
      acceptance_criteria: projectAcceptanceCriteria(
        projectRoot,
        guarded,
        lane.run_id,
        opts.specPath,
      ),
      qa_release_readiness: projectQaReleaseReadiness(projectRoot, guarded, opts.runId),
    },
  };
}

// ── Fail-closed validator (the SC-W3-3 "all six sections present" oracle) ─────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Fail-closed validator. Asserts schema_version, the stamp/root strings, and — the AC36
 * invariant — that ALL SIX sections are present and well-typed (arrays for the list
 * sections, objects for lane_progress / qa_release_readiness). Never throws.
 */
export function validateDashboardV1(x: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(x)) return { valid: false, errors: ["not an object"] };
  if (x["schema_version"] !== DASHBOARD_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${DASHBOARD_SCHEMA_VERSION}`);
  }
  if (typeof x["generated_at"] !== "string" || x["generated_at"] === "") {
    errors.push("generated_at must be a non-empty string");
  }
  if (typeof x["project_root"] !== "string" || x["project_root"] === "") {
    errors.push("project_root must be a non-empty string");
  }
  const sections = x["sections"];
  if (!isObj(sections)) {
    errors.push("sections must be an object");
    return { valid: errors.length === 0, errors };
  }
  for (const key of DASHBOARD_SECTION_KEYS) {
    if (!(key in sections)) {
      errors.push(`AC36: missing section "${key}"`);
    }
  }
  const arrSections: DashboardSectionKey[] = [
    "active_initiatives",
    "child_project_health",
    "stale_knowledge",
    "acceptance_criteria",
  ];
  for (const key of arrSections) {
    if (key in sections && !Array.isArray((sections as Record<string, unknown>)[key])) {
      errors.push(`section "${key}" must be an array`);
    }
  }
  for (const key of ["lane_progress", "qa_release_readiness"] as const) {
    if (key in sections && !isObj((sections as Record<string, unknown>)[key])) {
      errors.push(`section "${key}" must be an object`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── Real read seam (CLI harness ONLY) ─────────────────────────────────────────────

/**
 * Real node:fs read seam. Used ONLY by the CLI harness below — the artifact body never
 * touches fs directly (determinism). Lazy-requires node:fs so importing this module for
 * its pure exports pulls in no I/O.
 */
export function createRealReadSeam(): DashboardReadSeam {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  return {
    exists: (p) => fs.existsSync(p),
    readFile: (p) => fs.readFileSync(p, "utf-8"),
    readDir: (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  };
}

// ── CLI entrypoint (the EXISTING-path surface — tsx invocation) ────────────────────

function findProjectRoot(cwd: string): string | null {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require("node:path") as typeof import("node:path");
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".guild"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function runDashboardProjectorCli(argv: string[] = process.argv.slice(2)): void {
  let projectRoot: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--project-root" && argv[i + 1]) projectRoot = argv[++i];
    else if (argv[i].startsWith("--project-root=")) projectRoot = argv[i].split("=").slice(1).join("=");
  }
  const root = projectRoot ?? findProjectRoot(process.cwd());
  if (!root) {
    process.stderr.write(
      "[dashboard-projector] no .guild/ found at or above cwd; pass --project-root <abs>\n",
    );
    process.exit(1);
  }
  const now = Date.now();
  const projection = projectDashboard(root, createRealReadSeam(), {
    now,
    generated_at: new Date(now).toISOString(),
  });
  process.stdout.write(JSON.stringify(projection, null, 2) + "\n");
}

if (require.main === module) runDashboardProjectorCli();
