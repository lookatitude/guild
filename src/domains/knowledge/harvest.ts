/**
 * harvest.ts — the ONE automatic wiki writer (KTD35 / KTD37 / R50 / R53 / R56).
 *
 * One promotion law: harvest writes canonical decision pages and project playbook
 * spans; everything else goes through a human. The LearningCheckpoint may enqueue
 * a harvest but never writes; a specialist never writes the wiki at all. This file
 * is therefore the whole auto-write surface, and every rule below is a gate on it.
 *
 * Fail-closed, in order, before a single byte lands:
 *
 *   1. THIS CWD ONLY (R67). The target path must resolve inside the active root.
 *      A project session writing the umbrella wiki — or a workspace session
 *      writing a child's — is refused. Federation is query-not-copy in both
 *      directions, and a write is the one operation that cannot be undone by
 *      re-reading.
 *   2. NO LABELS (R66). The concern enum is lint's, and labels are inert until a
 *      project authors a taxonomy. A harvest that stamped one would be inventing
 *      project vocabulary from a machine's guess.
 *   3. INJECTION GUARD. Content that carries directive language is refused and
 *      stays a CANDIDATE with `next_need: operator`. It is not silently dropped —
 *      a refused harvest that vanished would look identical to a harvest that
 *      never triggered.
 *   4. `scrubbedWrite` OR NOTHING. The writer is branded, and an unbranded writer
 *      is refused rather than called (see `assertScrubbedWriter`). This is the
 *      difference between "we call scrubbedWrite" as a convention and as a
 *      property: a caller that wants to bypass the scrub has to pass something
 *      that fails the brand check, and that path throws.
 *   5. CAS on the existing page. Two T0 sessions are two runs writing one wiki;
 *      the second must lose rather than clobber, and `before_hash` is how it finds
 *      out.
 *
 * After the write: index the new page for BM25 (that page, not a projection
 * rebuild — R62), replace the playbook span from a TEMPLATE, and if the op
 * superseded a decision id that is PINNED in flight, queue `replan` (KTD53). The
 * spec and the plan are never rewritten; T0 reports the stale ids and the operator
 * decides. Silently editing an approved spec because a later decision moved is how
 * a run stops matching the thing the operator approved.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// Lazy: lifecycle sits above knowledge (its event log reaches config and js-yaml),
// so a static import would load that graph in every knowledge entry, the MCP
// binary included. Only the write paths below need it.
function lifecycleApi(): typeof import("../lifecycle") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../lifecycle");
}
import { classifyPermissionContent, sanitizeForInjection } from "../security";
import { containsRecallTag } from "./recall-protect";
import { appendSecurityEvent, buildSecurityEvent, resolveRunDir } from "../security";
import { scrubbedWrite } from "../security";
import { createGuildStorage, type GuildStorage, readScalarField, type ScopedDurablePaths } from "../state";
import {
  findOp,
  isTerminalHarvestStatus,
  newOpId,
  readInverse,
  recordInverse,
  sha256,
  upsertOp,
  type HarvestInverse,
  type HarvestInverseFile,
  type HarvestOp,
  type HarvestRefuseReason,
  type HarvestTrigger,
} from "./harvest-journal";
import { refreshWikiIndexPaths } from "./wiki-index";
import { checkContained, isRefused, isWithin } from "../kernel";

export const DECISION_SCHEMA = "guild.decision.v1" as const;

/** The only writer id allowed to write the wiki automatically. */
export const HARVEST_WRITER_ID = "knowledge.harvest" as const;

/**
 * The brand a wiki writer must carry. A plain function does NOT satisfy it, which
 * is what makes "harvest bypasses scrubbedWrite" a refusal rather than a review
 * comment.
 */
export const SCRUBBED_WRITER_BRAND = "__guild_scrubbed_writer__" as const;

export interface WikiWriteResult {
  written: boolean;
  blocked: boolean;
}

export type WikiWriter = ((
  absPath: string,
  content: string,
  opts: { runDir: string; runId: string; laneId?: string },
) => WikiWriteResult) & { [SCRUBBED_WRITER_BRAND]?: true };

/** The production writer: `scrubbedWrite` on the `wiki` surface, branded. */
export const scrubbedWikiWriter: WikiWriter = Object.assign(
  (absPath: string, content: string, opts: { runDir: string; runId: string; laneId?: string }) =>
    scrubbedWrite(absPath, content, { surface: "wiki", ...opts }),
  { [SCRUBBED_WRITER_BRAND]: true as const },
);

export class HarvestRefusal extends Error {
  constructor(message: string, readonly reason: HarvestRefuseReason | "scope" | "writer" | "labels") {
    super(message);
  }
}

/** Fail closed on any writer that is not the branded scrubbing one. */
export function assertScrubbedWriter(writer: WikiWriter | undefined): WikiWriter {
  if (!writer || writer[SCRUBBED_WRITER_BRAND] !== true) {
    throw new HarvestRefusal(
      "harvest wiki write must go through scrubbedWrite; an unbranded writer is refused (R53)",
      "writer",
    );
  }
  return writer;
}

/**
 * Refuse a wiki write from anything but harvest. Callable from a specialist-facing
 * seam so "specialist Write to wiki fails closed" is a code path, not a prompt
 * instruction that a model may simply not follow.
 */
export function guardWikiWrite(writerId: string, target: string): void {
  if (writerId !== HARVEST_WRITER_ID) {
    throw new HarvestRefusal(
      `'${writerId}' may not write ${target}: the knowledge-domain harvest writer is the only wiki auto-writer (KTD35)`,
      "scope",
    );
  }
}

/** Refuse a target outside this root's own wiki (R67). */
export function assertThisCwdWiki(storage: GuildStorage, absTarget: string): void {
  const scope = storage.project ?? storage.workspace;
  const wikiRoot = scope ? path.resolve(scope.knowledge()) : null;
  const resolved = path.resolve(absTarget);
  // Containment is the kernel primitive's question, never a lexical prefix test:
  // a symlinked page or a `..` spelling must be REFUSED, not guessed (R67).
  // The primitive canonicalises the ROOT with realpath, so this cwd's own wiki
  // root must exist before the first harvest of a fresh repo can be checked.
  if (wikiRoot) fs.mkdirSync(wikiRoot, { recursive: true });
  const contained = wikiRoot ? checkContained(wikiRoot, resolved, { policy: "resolve" }) : null;
  if (!wikiRoot || contained === null || isRefused(contained)) {
    throw new HarvestRefusal(
      `harvest may only write this cwd's wiki; '${resolved}' is outside '${wikiRoot ?? "(no wiki)"}'` +
        `${contained && isRefused(contained) ? ` [${contained.code}]` : ""} (R67)`,
      "scope",
    );
  }
}

/**
 * This root's own playbooks tree. Project playbooks are DEFINITION state (KTD20),
 * so they hang off the definition tree, exactly as the wiki hangs off `knowledge()`.
 */
export function playbooksRoot(storage: GuildStorage): string {
  return path.resolve(storage.definition("playbooks"));
}

/**
 * Refuse a playbook target outside this root's own playbooks tree.
 *
 * The wiki got this check from the start; the playbook span-replace did not, so a
 * `../` spelling or a symlinked playbook let one root's harvest rewrite another
 * root's guidance — the same federation violation R67 closes for the wiki, on the
 * other durable surface harvest may write. Same kernel primitive, same policy.
 */
export function assertThisCwdPlaybook(storage: GuildStorage, absTarget: string): void {
  const root = playbooksRoot(storage);
  const resolved = path.resolve(absTarget);
  // The primitive canonicalises the ROOT with realpath, so it must exist first.
  fs.mkdirSync(root, { recursive: true });
  const contained = checkContained(root, resolved, { policy: "resolve" });
  if (contained === null || isRefused(contained)) {
    throw new HarvestRefusal(
      `harvest may only rewrite this cwd's playbooks; '${resolved}' is outside '${root}'` +
        `${contained && isRefused(contained) ? ` [${contained.code}]` : ""} (R67)`,
      "scope",
    );
  }
}

/** A harvest slug: one lower-case file-name segment under `decisions/`. */
const HARVEST_SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Frontmatter keys harvest must never stamp (R66). */
export const FORBIDDEN_HARVEST_KEYS = Object.freeze(["labels", "label_taxonomy", "concern"] as const);

export interface DecisionPage {
  id: string;
  slug: string;
  title: string;
  status: "candidate" | "canonical" | "superseded";
  trigger: HarvestTrigger;
  replaces?: string;
  source_refs: string[];
  reasoning: string;
  created_at: string;
  body: string;
  /** Set only when a decision explicitly names a glossary term (KTD70). */
  glossary_term?: string;
}

/** Render a `guild.decision.v1` page. Never stamps a label — see R66. */
export function renderDecisionPage(page: DecisionPage): string {
  const fm = [
    "---",
    "type: decision",
    `schema_version: ${DECISION_SCHEMA}`,
    `id: ${page.id}`,
    `slug: ${page.slug}`,
    `title: ${JSON.stringify(page.title)}`,
    `status: ${page.status}`,
    `trigger: ${page.trigger}`,
    ...(page.replaces ? [`replaces: ${page.replaces}`] : []),
    ...(page.glossary_term ? [`glossary_term: ${page.glossary_term}`] : []),
    `source_refs: [${page.source_refs.map((r) => JSON.stringify(r)).join(", ")}]`,
    `reasoning: ${JSON.stringify(page.reasoning)}`,
    `created_at: ${page.created_at}`,
    "---",
    "",
    `# ${page.title}`,
    "",
    page.body.trim(),
    "",
  ].join("\n");

  // Read the rendered block through the shared frontmatter reader (OD-3): the
  // self-check must not become a second hand-rolled YAML scanner.
  for (const key of FORBIDDEN_HARVEST_KEYS) {
    if (readScalarField(fm, key) !== undefined) {
      throw new HarvestRefusal(`harvest does not stamp '${key}' (R66)`, "labels");
    }
  }
  return fm;
}

export interface HarvestInput {
  run_id: string;
  /** The run record dir — `scrubbedWrite` reads the secrets policy relative to it. */
  runDir: string;
  cwd?: string;
  storage?: GuildStorage;
  trigger: HarvestTrigger;
  slug: string;
  title: string;
  body: string;
  reasoning: string;
  source_refs?: string[];
  /** Prior canonical decision id this supersedes. */
  replaces?: string;
  /**
   * The sha256 the caller last read for this page, or `null` for "it did not
   * exist". Supplying it makes the write a compare-and-swap: a second T0 session
   * that wrote the same page in between LOSES rather than clobbers (R54).
   * Omitted means last-writer-wins, which is correct for a page only this run has
   * touched.
   */
  expect_before_hash?: string | null;
  superseded_ids?: string[];
  /** Ids pinned by a working set / lane bundle / assignment / spec / packet. */
  pinned_decision_ids?: readonly string[];
  glossary_term?: string;
  /** Project playbook span to replace in the same op. */
  playbook?: { path: string; span: string; replacement: string };
  /** True when the wiki has uncommitted changes. T0 knows; this module does not shell out. */
  wiki_dirty?: boolean;
  /**
   * The effective `wiki.autopromote` policy for this cwd (KTD35). `false` makes the
   * root candidates-only: every gate below still runs, and a clean decision is
   * staged under `.guild/knowledge/candidates/decisions/` instead of the wiki, with
   * no playbook span-replace. Omitted means the shipped default, on.
   */
  autopromote?: boolean;
  /** Injected in tests. Production callers get the branded scrubbing writer. */
  writer?: WikiWriter;
  now?: string;
  op_id?: string;
}

export type NextNeed = "operator" | "commit" | null;

export interface HarvestResult {
  op: HarvestOp;
  /** True when a CANONICAL page landed. A refusal leaves a candidate instead. */
  promoted: boolean;
  wiki_path?: string;
  /** Set when a candidates-only root staged the decision (`wiki.autopromote: false`). */
  candidate_path?: string;
  decision_id?: string;
  /** KTD53: T0 must route a `replan` decision. */
  replan_queued: boolean;
  next_need: NextNeed;
  stale_decision_ids: string[];
  /**
   * True when the op refused because a target it was told to rewrite is not in
   * the shape the caller described — a named playbook span whose heading is not
   * in the file. The operator decides; harvest never invents the anchor, because
   * an inverse recorded against a span that does not exist reverts to bytes the
   * op never wrote.
   *
   * Also set when a RESUME cannot prove what the interrupted op did: the file
   * under a step matches neither the recorded before nor the recorded after, or
   * a step the journal calls `written` has no inverse at all. Resume completes
   * or confirms a step; it never guesses one.
   */
  blocked_confirm?: true;
  /** Which step blocked, and how the live bytes differ. Set with `blocked_confirm`. */
  blocked_detail?: string;
}

function emitHarvestEvent(runDir: string, runId: string, op: HarvestOp): void {
  try {
    lifecycleApi().appendEvent(runDir, {
      ts: new Date().toISOString(),
      event: "harvest_event",
      run_id: runId,
      op_id: op.op_id,
      trigger: op.trigger,
      status: op.status,
      ...(op.decision_id ? { decision_id: op.decision_id } : {}),
      ...(op.wiki_path ? { wiki_path: op.wiki_path } : {}),
      ...(op.candidate_path ? { candidate_path: op.candidate_path } : {}),
      ...(op.refuse_reason ? { refuse_reason: op.refuse_reason } : {}),
    });
  } catch {
    // Observability must never take the durable path down with it.
  }
}

/** The harvest audit kinds (KTD37) — one closed set with the rest of `guild.security_event.v1`. */
type HarvestSecurityKind =
  | "harvest_promoted"
  | "harvest_refused"
  | "playbook_auto_replace"
  | "wiki_cas_conflict"
  | "harvest_reverted";

function emitSecurity(
  runDir: string,
  runId: string,
  kind: HarvestSecurityKind,
  decision: "allow" | "blocked",
  detail: string,
): void {
  try {
    appendSecurityEvent(
      runDir,
      buildSecurityEvent({
        run_id: runId,
        event_type: kind,
        decision,
        tool: "harvest",
        detail,
      }),
    );
  } catch {
    // Same reasoning as the trace event above.
  }
}

function refuse(
  input: HarvestInput,
  op: HarvestOp,
  reason: HarvestRefuseReason,
  detail: string,
  opts: { storage?: GuildStorage; cwd?: string },
  blockedConfirm = false,
): HarvestResult {
  op.status = "refused";
  op.refuse_reason = reason;
  upsertOp(input.run_id, op, opts);
  emitHarvestEvent(input.runDir, input.run_id, op);
  emitSecurity(input.runDir, input.run_id, "harvest_refused", "blocked", `harvest refused (${reason}): ${detail}`);
  return {
    op,
    promoted: false,
    replan_queued: false,
    next_need: "operator",
    stale_decision_ids: [],
    ...(op.wiki_path ? { wiki_path: op.wiki_path } : {}),
    ...(blockedConfirm ? { blocked_confirm: true as const } : {}),
  };
}

/**
 * Stop a RESUME that cannot prove what the interrupted op did.
 *
 * Unlike `refuse`, this does NOT mark the op terminal. The op stays resumable,
 * because the operator may well be able to answer the question the resume could
 * not: whether the bytes under the step are theirs or the op's. Marking it
 * `refused` would close the op_id forever and strand the half-applied change.
 *
 * `promoted` is false even though a page may already be on disk. A resume that
 * cannot finish its steps has not promoted anything, and reporting otherwise is
 * how T0 ends up routing a replan for an op that never landed.
 */
function blockResume(
  input: HarvestInput,
  op: HarvestOp,
  step: string,
  detail: string,
): HarvestResult {
  emitHarvestEvent(input.runDir, input.run_id, op);
  emitSecurity(
    input.runDir,
    input.run_id,
    "harvest_refused",
    "blocked",
    `harvest resume blocked at ${step}: ${detail}`,
  );
  return {
    op,
    promoted: false,
    replan_queued: false,
    next_need: "operator",
    stale_decision_ids: [],
    ...(op.wiki_path ? { wiki_path: op.wiki_path } : {}),
    blocked_confirm: true as const,
    blocked_detail: `${step}: ${detail}`,
  };
}

/**
 * The lock directory serialising compare-and-write on ONE durable page, per root.
 *
 * `withStableLock` keys off a directory, and the contended resource here is the
 * PAGE, not the run: two T0 sessions are two runs writing one wiki, so a per-run
 * lock would not make them exclude each other. Runtime state, shared by every run
 * on this root.
 */
function readFileOrNull(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Write the inverse for an op_id ONCE. A second call for the same op — which is
 * what a resumed op makes — keeps the record the first one wrote. The `before`
 * bytes of an op are the bytes that were on disk before its FIRST write, and no
 * later read can recover them.
 */
function recordInverseOnce(
  runId: string,
  inverse: HarvestInverse,
  opts: { storage?: GuildStorage; cwd?: string },
): void {
  if (readInverse(runId, inverse.op_id, opts)) return;
  recordInverse(runId, inverse, opts);
}

export function harvestCasLockDir(storage: GuildStorage, absPath: string): string {
  return storage.runtime("harvest-cas", sha256(path.resolve(absPath)).slice(0, 16));
}

/**
 * Run one harvest op end to end. Resumable: pass the `op_id` of a crashed op and
 * the already-completed steps are skipped by status.
 */
export function harvestDecision(input: HarvestInput): HarvestResult {
  const storeOpts = { storage: input.storage, cwd: input.cwd };
  const storage = input.storage ?? createGuildStorage(input.cwd ?? process.cwd());
  const now = input.now ?? new Date().toISOString();
  const decisionId = `decision:${input.slug}`;

  // Resume: an op_id that is already in the journal carries the progress a crash
  // interrupted. Starting a fresh op for the same id would re-run the durable
  // write and produce a second page for one decision.
  const existing = input.op_id ? findOp(input.run_id, input.op_id, storeOpts) : null;
  const op: HarvestOp = existing ?? {
    op_id: input.op_id ?? newOpId(input.slug),
    trigger: input.trigger,
    decision_id: decisionId,
    status: "planned",
  };
  // A TERMINAL op_id is closed. Replaying one re-promoted content the operator had
  // just reverted — the revert wrote `reverted` to the journal and the replay
  // walked straight past it to the write. Promoting the same content again is a
  // NEW op with a NEW op_id, which re-passes the probe, the scrub and the CAS.
  if (existing && isTerminalHarvestStatus(existing.status)) {
    emitHarvestEvent(input.runDir, input.run_id, existing);
    emitSecurity(
      input.runDir,
      input.run_id,
      "harvest_refused",
      "blocked",
      `harvest refused (replay): op '${existing.op_id}' is terminal at '${existing.status}'`,
    );
    return {
      op: existing,
      promoted: false,
      replan_queued: false,
      next_need: "operator",
      stale_decision_ids: [],
      ...(existing.wiki_path ? { wiki_path: existing.wiki_path } : {}),
    };
  }

  if (input.superseded_ids?.length) op.superseded_ids = [...input.superseded_ids];
  if (op.status === "planned") {
    upsertOp(input.run_id, op, storeOpts);
    emitHarvestEvent(input.runDir, input.run_id, op);
  }

  // ── scope: this cwd only ──────────────────────────────────────────────────
  const scope = storage.project ?? storage.workspace;
  if (!scope) {
    return refuse(input, op, "lint", "this root owns no wiki", storeOpts);
  }
  // The slug names ONE file in `decisions/`, and it, `replaces` and `glossary_term`
  // are rendered into frontmatter unquoted. A `../` slug left the decisions tree for
  // an operator-trusted path, and a newline stamped keys the renderer never wrote.
  if (!HARVEST_SLUG_RE.test(input.slug)) {
    return refuse(input, op, "scope", `slug '${input.slug}' is not a single safe segment (${HARVEST_SLUG_RE})`, storeOpts);
  }
  for (const [key, value] of [["replaces", input.replaces], ["glossary_term", input.glossary_term]] as const) {
    if (value !== undefined && /[\r\n]/.test(value)) {
      return refuse(input, op, "scope", `${key} carries a line break; it would stamp its own frontmatter`, storeOpts);
    }
  }
  const wikiAbs = scope.knowledge("decisions", `${input.slug}.md`);
  assertThisCwdWiki(storage, wikiAbs);
  op.wiki_path = wikiAbs;

  // The playbook target, its replacement AND its anchor are gated BEFORE the wiki
  // write, so a refused playbook never leaves a promoted decision page behind
  // pointing at guidance that was not updated.
  if (input.playbook) {
    try {
      assertThisCwdPlaybook(storage, input.playbook.path);
    } catch (err) {
      return refuse(input, op, "scope", (err as Error).message, storeOpts);
    }
    const pbProbe = sanitizeForInjection(input.playbook.replacement);
    if (pbProbe.result === "flagged") {
      return refuse(
        input,
        op,
        "injection",
        `directive language in the playbook replacement (${pbProbe.matchedPatterns.join(", ")})`,
        storeOpts,
      );
    }
    // No inverse without an ANCHORED span. A missing heading used to record an
    // unchecked whole-file inverse, and revert then restored the playbook as it
    // stood before an op that never touched it — deleting every operator edit
    // since. The anchor is never synthesised: the operator decides.
    const pbText = readFileOrNull(input.playbook.path);
    const located = pbText === null ? null : locatePlaybookSpan(pbText, input.playbook.span);
    if (!located) {
      return refuse(
        input,
        op,
        "missing_anchor",
        pbText === null
          ? `playbook '${input.playbook.path}' does not exist`
          : `playbook '${input.playbook.path}' has no '${input.playbook.span}' heading`,
        storeOpts,
        true,
      );
    }
    // D5: a permission edit is proposal-only on every path, the automatic playbook
    // span-replace included. Screened on the span name, the bytes it replaces, and
    // the replacement — the same classifier the evolve writer uses.
    const d5 = classifyPermissionContent({
      span: input.playbook.span,
      beforeSpan: located.text,
      replacement: input.playbook.replacement,
    });
    if (d5.isPermissionEdit) {
      return refuse(input, op, "probe", `permissions are proposal-only (D5): ${d5.detail}`, storeOpts);
    }
  }

  // A crash AFTER the wiki write but BEFORE the BM25 refresh resumes here: the
  // page is already on disk and correct, so the op picks up at indexing (R54).
  //
  // "Already on disk and correct" is a claim about the inverse, not about the
  // status word. A step the journal calls `written` with NO inverse recorded for
  // its page is a journal that outlived its compact history: nothing here can say
  // what those bytes are, so nothing here may report a promotion. The operator
  // decides (R54 / KTD39).
  if (existing && (existing.status === "written" || existing.status === "indexed")) {
    const pageEntry = readInverse(input.run_id, op.op_id, storeOpts)?.files.find(
      (f) => f.path === wikiAbs,
    );
    if (!pageEntry || pageEntry.after_sha256 === undefined) {
      return blockResume(
        input,
        op,
        "wiki-write",
        `the journal records this op as ${existing.status} but no inverse describes '${wikiAbs}'`,
      );
    }
    // "Already on disk and correct" must be VERIFIED against the live bytes, not
    // inferred from the presence of a hash (codex G-lane r5): a page deleted or
    // replaced while the op was interrupted is a mismatch the operator resolves.
    const livePage = readFileOrNull(wikiAbs);
    const liveHash = livePage === null ? null : sha256(livePage);
    if (liveHash !== pageEntry.after_sha256) {
      return blockResume(
        input,
        op,
        "wiki-write",
        livePage === null
          ? `the journal records '${wikiAbs}' as written but the page is missing`
          : `the journal records '${wikiAbs}' as written but the live bytes do not match its after_sha256`,
      );
    }
    return finishHarvest(input, op, storage, scope.knowledge(), decisionId, now, storeOpts);
  }

  // ── probe: injection guard ────────────────────────────────────────────────
  // Sources and body (KTD37): the source refs are rendered into the page too.
  const probe = sanitizeForInjection(
    [input.title, input.body, input.reasoning, ...(input.source_refs ?? [])].join("\n"),
  );
  // The recall wrapper is the one boundary between a page and a directive. A body
  // that spells the wrapper tag at all is refused, not rewritten.
  if (containsRecallTag([input.title, input.body, input.reasoning, ...(input.source_refs ?? [])].join("\n"))) {
    return refuse(input, op, "injection", "the harvested content spells the <guild:recall> wrapper tag", storeOpts);
  }
  if (probe.result === "flagged") {
    return refuse(
      input,
      op,
      "injection",
      `directive language in the harvested content (${probe.matchedPatterns.join(", ")})`,
      storeOpts,
    );
  }
  op.status = "probed";
  upsertOp(input.run_id, op, storeOpts);
  emitHarvestEvent(input.runDir, input.run_id, op);

  // ── candidates-only root (KTD35) ──────────────────────────────────────────
  // Every gate above has run; only the destination changes.
  if (input.autopromote === false) {
    return stageDecisionCandidate(input, op, storage, scope, decisionId, now, storeOpts);
  }

  // ── CAS against whatever is on disk, UNDER THE PAGE LOCK ──────────────────
  //
  // Read, compare, and write are one critical section. Unlocked, two sessions
  // could both read the same `before`, both find their expected hash current, and
  // both write — the compare-and-swap degraded to "compare, then hope". The lock
  // is per PAGE and per ROOT, so the loser is the second writer to acquire it and
  // it loses on the hash, deterministically, with a `cas_event` on its own run.
  const lockDir = harvestCasLockDir(storage, wikiAbs);
  const cas = lifecycleApi().withStableLock(lockDir, (): HarvestResult | null => {
    const before = fs.existsSync(wikiAbs) ? fs.readFileSync(wikiAbs, "utf8") : null;
    const beforeHash = before === null ? "" : sha256(before);
    const expected =
      input.expect_before_hash !== undefined
        ? input.expect_before_hash === null
          ? ""
          : input.expect_before_hash
        : existing?.before_hash;
    if (expected !== undefined && expected !== beforeHash) {
      try {
        lifecycleApi().appendEvent(input.runDir, {
          ts: now,
          event: "cas_event",
          run_id: input.run_id,
          target: wikiAbs,
          outcome: "lost",
          expected_hash: expected,
          actual_hash: beforeHash,
        });
      } catch {
        /* observability only */
      }
      emitSecurity(input.runDir, input.run_id, "wiki_cas_conflict", "blocked", `CAS lost on ${wikiAbs}`);
      return refuse(input, op, "cas", "the page changed under this op", storeOpts);
    }
    op.before_hash = beforeHash;

    const page = renderDecisionPage({
      id: decisionId,
      slug: input.slug,
      title: input.title,
      status: "canonical",
      trigger: input.trigger,
      source_refs: input.source_refs ?? [],
      reasoning: input.reasoning,
      created_at: now,
      body: input.body,
      ...(input.replaces ? { replaces: input.replaces } : {}),
      ...(input.glossary_term ? { glossary_term: input.glossary_term } : {}),
    });

    // ── inverse FIRST, and COMPLETE ─────────────────────────────────────────
    //
    // The record that goes out before the write already describes both ends of
    // the change: the bytes that were there (`before`) and a fingerprint of the
    // bytes that are ABOUT to be there (`after_sha256`, over the exact buffer
    // handed to the writer). A crash anywhere after this point therefore leaves
    // an inverse revert can act on — it is never left holding half an op.
    //
    // The fingerprint, not the bytes: the writer scrubs, so the buffer is still
    // pre-scrub input at this point and putting it in the journal would keep a
    // redacted secret in the one durable place nobody scrubs. A hash of the
    // whole page leaks nothing and is all revert needs. It is re-stamped from
    // disk once the write lands, so the scrubbed case converges.
    //
    // Recorded exactly ONCE: a resumed op re-reading the file would record the
    // bytes it had already written as the "before", turning revert into a no-op.
    // The playbook entry is NOT recorded here — it is written immediately before
    // the playbook write, from the same buffer (see `finishHarvest`), because an
    // entry that exists means "the write may have happened".
    const inverseFiles: HarvestInverseFile[] = [
      {
        path: wikiAbs,
        before,
        ...(before === null ? {} : { before_sha256: sha256(before) }),
        after_sha256: sha256(page),
      },
    ];
    recordInverseOnce(input.run_id, { op_id: op.op_id, files: inverseFiles }, storeOpts);

    // ── write ───────────────────────────────────────────────────────────────
    const writer = assertScrubbedWriter(input.writer ?? scrubbedWikiWriter);
    storage.ensureDir(path.dirname(wikiAbs));
    const wrote = writer(wikiAbs, page, { runDir: input.runDir, runId: input.run_id });
    if (!wrote.written) {
      return refuse(
        input,
        op,
        wrote.blocked ? "secrets" : "lint",
        wrote.blocked ? "the secret scrub blocked the durable write" : "the write did not land",
        storeOpts,
      );
    }
    // What the op actually wrote, READ BACK FROM DISK. The rendered `page` is the
    // pre-scrub input: journalling it would keep a scrubbed secret in the journal
    // AND make a legitimate revert's equality check fail against the scrubbed
    // page it is comparing to.
    const landed = readFileOrNull(wikiAbs) ?? "";
    stampLandedFile(input.run_id, op.op_id, wikiAbs, landed, storeOpts);
    op.after_hash = sha256(landed);
    op.status = "written";
    upsertOp(input.run_id, op, storeOpts);
    emitHarvestEvent(input.runDir, input.run_id, op);
    try {
      lifecycleApi().appendEvent(input.runDir, {
        ts: now,
        event: "cas_event",
        run_id: input.run_id,
        target: wikiAbs,
        outcome: "won",
        expected_hash: beforeHash,
        actual_hash: beforeHash,
      });
    } catch {
      /* observability only */
    }
    return null;
  });
  if (cas) return cas;

  return finishHarvest(input, op, storage, scope.knowledge(), decisionId, now, storeOpts);
}

/**
 * `wiki.autopromote: false` (KTD35): stage the screened decision as a CANDIDATE
 * through the same scrubbing writer, never the wiki and never a playbook. An
 * existing candidate for the slug is kept; this op gets its own file beside it.
 */
function stageDecisionCandidate(
  input: HarvestInput,
  op: HarvestOp,
  storage: GuildStorage,
  scope: ScopedDurablePaths,
  decisionId: string,
  now: string,
  storeOpts: { storage?: GuildStorage; cwd?: string },
): HarvestResult {
  let candidateAbs = scope.definitions("knowledge", "candidates", "decisions", `${input.slug}.md`);
  if (fs.existsSync(candidateAbs)) {
    candidateAbs = scope.definitions("knowledge", "candidates", "decisions", `${input.slug}.${op.op_id}.md`);
  }
  const page = renderDecisionPage({
    id: decisionId,
    slug: input.slug,
    title: input.title,
    status: "candidate",
    trigger: input.trigger,
    source_refs: input.source_refs ?? [],
    reasoning: input.reasoning,
    created_at: now,
    body: input.body,
    ...(input.replaces ? { replaces: input.replaces } : {}),
    ...(input.glossary_term ? { glossary_term: input.glossary_term } : {}),
  });
  const writer = assertScrubbedWriter(input.writer ?? scrubbedWikiWriter);
  storage.ensureDir(path.dirname(candidateAbs));
  const wrote = writer(candidateAbs, page, { runDir: input.runDir, runId: input.run_id });
  if (!wrote.written) {
    return refuse(
      input,
      op,
      wrote.blocked ? "secrets" : "lint",
      wrote.blocked ? "the secret scrub blocked the candidate write" : "the candidate write did not land",
      storeOpts,
    );
  }
  delete op.wiki_path;
  op.candidate_path = candidateAbs;
  op.status = "candidate";
  upsertOp(input.run_id, op, storeOpts);
  emitHarvestEvent(input.runDir, input.run_id, op);
  return {
    op,
    promoted: false,
    candidate_path: candidateAbs,
    decision_id: decisionId,
    replan_queued: false,
    next_need: "operator",
    stale_decision_ids: [],
  };
}

/**
 * The steps after the durable wiki write: index the page, replace the playbook
 * span, queue a replan on a pin hit, report. Split out so a crash-resumed op
 * re-enters here instead of repeating the write.
 */
function finishHarvest(
  input: HarvestInput,
  op: HarvestOp,
  storage: GuildStorage,
  wikiRoot: string,
  decisionId: string,
  now: string,
  storeOpts: { storage?: GuildStorage; cwd?: string },
): HarvestResult {
  const wikiAbs = op.wiki_path as string;
  // ── index the page just written (not the recall projection — R62) ─────────
  refreshWikiIndexPaths([path.relative(wikiRoot, wikiAbs).split(path.sep).join("/")], { storage });
  op.status = "indexed";
  upsertOp(input.run_id, op, storeOpts);
  emitHarvestEvent(input.runDir, input.run_id, op);

  // ── project playbook span-replace, from a template ────────────────────────
  //
  // Inverse-first, with the journal entry as the barrier. The order is: plan the
  // replacement from the file's CURRENT bytes → write the complete inverse for
  // that plan (before-span plus the exact length and hash of the bytes that are
  // about to land) and fsync it → write the playbook → re-stamp the entry from
  // disk. The entry existing therefore means "this write may have happened", and
  // its absence means "it provably did not".
  //
  // The old order wrote the playbook first and filled the inverse afterwards, so
  // a crash in between left a span inverse with no after-side at all — and revert
  // treated that as "nothing to put back", skipped the playbook, deleted the page
  // and reported ok. That is the one outcome a reversible write may never have.
  if (input.playbook) {
    op.playbook_path = input.playbook.path;
    const outcome = applyPlaybookSpanInverseFirst(input, op, storage, storeOpts);
    try {
      lifecycleApi().appendEvent(input.runDir, {
        ts: now,
        event: "curator_event",
        run_id: input.run_id,
        target_type: "playbook",
        target_path: input.playbook.path,
        op: "replace",
        span: input.playbook.span,
        applied: outcome.applied,
        decision_id: decisionId,
      });
    } catch {
      /* observability only */
    }
    // A step that could not be DECIDED stops the op here. The page stands and the
    // op stays resumable, but nothing reports a promotion off a resume that could
    // not account for the bytes it found.
    if (outcome.block) {
      return blockResume(input, op, outcome.block.step, outcome.block.detail);
    }
  }

  // ── pin hit → replan, without rewriting the spec (KTD53 / R65) ────────────
  const pinned = new Set(input.pinned_decision_ids ?? []);
  const stale = (op.superseded_ids ?? []).filter((id) => pinned.has(id));
  const replan = stale.length > 0;
  if (replan) {
    op.pinned_in_flight = true;
    op.status = "replan_queued";
    upsertOp(input.run_id, op, storeOpts);
    emitHarvestEvent(input.runDir, input.run_id, op);
  }

  op.status = "reported";
  upsertOp(input.run_id, op, storeOpts);
  emitHarvestEvent(input.runDir, input.run_id, op);
  emitSecurity(input.runDir, input.run_id, "harvest_promoted", "allow", `harvest promoted ${decisionId} on this cwd`);

  return {
    op,
    promoted: true,
    wiki_path: wikiAbs,
    decision_id: decisionId,
    replan_queued: replan,
    next_need: input.wiki_dirty === true ? "commit" : null,
    stale_decision_ids: stale,
  };
}

/** Where a named span sits in a playbook's current bytes. */
export interface PlaybookSpanLocation {
  /** The heading line itself — the anchor revert re-locates the region by. */
  anchor: string;
  start: number;
  end: number;
  /** The region as it stands, anchor line included. */
  text: string;
}

/**
 * Locate a named span: a markdown heading and everything under it until the next
 * heading of the same or higher level.
 */
export function locatePlaybookSpan(text: string, span: string): PlaybookSpanLocation | null {
  const escaped = span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // `[ \t]`, never `\s`: `\s*$` swallowed the blank lines UNDER the heading into
  // the anchor, so re-locating the span after a write produced a longer anchor and
  // a re-render that differed from the bytes on disk by a newline. The anchor is
  // the heading LINE, exactly.
  const open = new RegExp(`^(#{1,6})[ \\t]+${escaped}[ \\t]*$`, "m");
  const m = open.exec(text);
  if (!m) return null;
  const level = m[1].length;
  const start = m.index;
  const after = text.slice(start + m[0].length);
  const next = new RegExp(`^#{1,${level}}\\s+`, "m").exec(after);
  const end = next ? start + m[0].length + next.index : text.length;
  return { anchor: m[0], start, end, text: text.slice(start, end) };
}

/** The bytes a span-replace writes for one span. Deterministic — revert compares against it. */
export function renderPlaybookSpan(anchor: string, replacement: string): string {
  return `${anchor}\n\n${replacement.trim()}\n\n`;
}

export interface PlaybookSpanInput {
  path: string;
  span: string;
  replacement: string;
}

export interface PlaybookSpanContext {
  runDir: string;
  runId: string;
  storage?: GuildStorage;
  cwd?: string;
  /** Injected in tests. Production gets the branded scrubbing writer. */
  writer?: WikiWriter;
  laneId?: string;
}

export interface PlaybookSpanResult {
  applied: boolean;
  /** True when the scrub blocked the durable write. */
  blocked?: boolean;
  anchor?: string;
  before?: string;
  after?: string;
  before_span?: string;
  after_span?: string;
  /**
   * False when the landed region could not be isolated byte-exactly (the scrub
   * moved bytes outside the span too). `after_span` is then the PLANNED bytes,
   * and a journal must not stamp it as what landed.
   */
  span_exact?: false;
}

/**
 * Replace a NAMED SPAN of a playbook with the template's replacement text.
 *
 * Replacing the span — rather than appending — is R49: the live file is
 * latest-only, and an "Update (date):" appendix is a lint fail. The reasoning that
 * justified the change lives on the decision page, not here.
 *
 * Three gates, in the same order and with the same primitives as the wiki writer,
 * because this is the OTHER durable surface harvest may write and it had none of
 * them: the target must be contained in this cwd's playbooks tree, the replacement
 * must pass the injection probe, and the bytes must go out through the branded
 * scrubbing writer. An unscreened replacement reaching a playbook is a prompt
 * injection with a persistence mechanism — the playbook is read back into every
 * later lane.
 */
export function replacePlaybookSpan(
  input: PlaybookSpanInput,
  ctx: PlaybookSpanContext,
): PlaybookSpanResult {
  const plan = planPlaybookSpan(input, ctx);
  if (!plan) return { applied: false };
  return applyPlaybookSpanPlan(plan, input, ctx);
}

/**
 * What a span-replace WILL do, computed from one read of the file — the "same
 * buffer" the inverse is written from.
 *
 * Splitting plan from apply is what lets harvest put a COMPLETE inverse on disk
 * before the first byte of the playbook moves. `after_len` / `after_sha256`
 * describe the bytes the apply step is about to write, so a record made from
 * this plan is already sufficient to undo the write it precedes.
 */
export interface PlaybookSpanPlan {
  /** The whole file as it stands. */
  before: string;
  /** The heading line that locates the region. */
  anchor: string;
  /** The region as it stands, anchor line included. */
  before_span: string;
  /** The exact region bytes the apply step writes. */
  after_span: string;
  /** The whole file the apply step hands to the writer. */
  next: string;
  /** Everything before / after the region, so the landed region can be isolated exactly. */
  head: string;
  tail: string;
}

export function planPlaybookSpan(
  input: PlaybookSpanInput,
  ctx: PlaybookSpanContext,
): PlaybookSpanPlan | null {
  const storage = ctx.storage ?? createGuildStorage(ctx.cwd ?? process.cwd());
  assertThisCwdPlaybook(storage, input.path);

  const probe = sanitizeForInjection(input.replacement);
  if (probe.result === "flagged") {
    throw new HarvestRefusal(
      `playbook replacement carries directive language (${probe.matchedPatterns.join(", ")}); ` +
        `harvest does not write an unscreened span (R53)`,
      "injection",
    );
  }

  const text = readFileOrNull(input.path);
  if (text === null) return null;
  const located = locatePlaybookSpan(text, input.span);
  if (!located) return null;

  const d5 = classifyPermissionContent({
    span: input.span,
    beforeSpan: located.text,
    replacement: input.replacement,
  });
  if (d5.isPermissionEdit) {
    throw new HarvestRefusal(`permissions are proposal-only (D5): ${d5.detail}`, "probe");
  }

  const afterSpan = renderPlaybookSpan(located.anchor, input.replacement);
  const head = text.slice(0, located.start);
  const tail = text.slice(located.end);
  return {
    before: text,
    anchor: located.anchor,
    before_span: located.text,
    after_span: afterSpan,
    next: head + afterSpan + tail,
    head,
    tail,
  };
}

/** Write a planned span-replace. The plan's bytes are what goes to the writer. */
export function applyPlaybookSpanPlan(
  plan: PlaybookSpanPlan,
  input: PlaybookSpanInput,
  ctx: PlaybookSpanContext,
): PlaybookSpanResult {
  const writer = assertScrubbedWriter(ctx.writer ?? scrubbedWikiWriter);
  const wrote = writer(input.path, plan.next, {
    runDir: ctx.runDir,
    runId: ctx.runId,
    ...(ctx.laneId ? { laneId: ctx.laneId } : {}),
  });
  if (!wrote.written) return { applied: false, blocked: wrote.blocked };
  emitSecurity(ctx.runDir, ctx.runId, "playbook_auto_replace", "allow", `span '${input.span}' replaced in ${input.path}`);

  // What LANDED, not what was handed to the writer: the writer scrubs, so
  // `plan.next` is still pre-scrub input and returning it would put a redacted
  // secret in the journal.
  //
  // The landed region is isolated by SUBTRACTING the untouched head and tail —
  // never by re-scanning for the next heading. A replacement that itself
  // contains a `## Heading` ends that re-scan early, so the recorded span
  // covered only part of what the op wrote and revert left the rest behind.
  // When the scrub moved bytes OUTSIDE the region too, the head/tail no longer
  // match and the landed region cannot be isolated exactly; the plan's own bytes
  // are reported instead, and the pre-write hash then fails revert's check
  // rather than licensing a wrong restore.
  const landed = readFileOrNull(input.path) ?? plan.next;
  const exact =
    landed.startsWith(plan.head) && landed.endsWith(plan.tail)
      ? landed.slice(plan.head.length, landed.length - plan.tail.length)
      : null;
  return {
    applied: true,
    anchor: plan.anchor,
    before: plan.before,
    after: landed,
    before_span: plan.before_span,
    after_span: exact ?? plan.after_span,
    ...(exact === null ? { span_exact: false as const } : {}),
  };
}

/**
 * Byte offset of an anchor LINE in a file, or null.
 *
 * Revert locates a region by this offset plus the recorded length. It is the
 * half of "anchor + length + hash" that replaces the old re-scan.
 */
export function locateAnchorOffset(text: string, anchor: string): number | null {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^${escaped}$`, "m").exec(text);
  return m ? m.index : null;
}

/**
 * Add the COMPLETE inverse for one more file to an op's record, before that file
 * is written. Never replaces an entry that is already there: a resumed op must
 * not overwrite the before-bytes with its own output, and an entry that exists
 * already means the write it guards may have happened.
 *
 * Returns the entry that is now on disk, or null when the op has no record.
 */
function appendInverseFileOnce(
  runId: string,
  opId: string,
  entry: HarvestInverseFile,
  opts: { storage?: GuildStorage; cwd?: string },
): HarvestInverseFile | null {
  const inverse = readInverse(runId, opId, opts);
  if (!inverse) return null;
  const existing = inverse.files.find((f) => f.path === entry.path);
  if (existing) return existing;
  inverse.files.push(entry);
  recordInverse(runId, inverse, opts);
  return entry;
}

/**
 * Re-stamp one file entry from the bytes that actually LANDED.
 *
 * The pre-write record fingerprints the buffer handed to the writer; when the
 * scrub rewrote it, that fingerprint describes bytes on no disk. This converges
 * the record on the file the reader sees. Only the after-side ever moves — the
 * before-side is captured once and is never touched again.
 */
function stampLandedFile(
  runId: string,
  opId: string,
  filePath: string,
  landed: string,
  opts: { storage?: GuildStorage; cwd?: string },
  span?: { after_span: string },
): void {
  const inverse = readInverse(runId, opId, opts);
  if (!inverse) return;
  const entry = inverse.files.find((f) => f.path === filePath);
  if (!entry) return;
  entry.after = landed;
  entry.after_sha256 = sha256(landed);
  if (span && entry.span) {
    entry.span.after_span = span.after_span;
    entry.span.after_len = span.after_span.length;
    entry.span.after_sha256 = sha256(span.after_span);
  }
  recordInverse(runId, inverse, opts);
}

/**
 * What one playbook step did. `block` is set only when the step could not be
 * decided — the op is then reported as blocked rather than promoted, and the
 * file is left exactly as it was found.
 */
interface PlaybookApplyOutcome {
  applied: boolean;
  block?: { step: string; detail: string };
}

/**
 * The playbook half of one harvest op, written inverse-first.
 *
 * Order, and the reason for it:
 *   1. plan from the file's current bytes;
 *   2. write the complete inverse for that plan (fsynced by the journal);
 *   3. write the playbook;
 *   4. re-stamp the entry from disk.
 *
 * A crash between 2 and 3 leaves a record whose after-hash matches nothing on
 * disk — revert BLOCKS and names the step, which is correct: nobody can tell
 * from here whether the write landed. A crash between 3 and 4 leaves the plan's
 * hash, which matches the file whenever the scrub did not rewrite it, so the
 * common case reverts cleanly. Neither case can produce a silent success.
 *
 * On resume the entry is already there, so the plan is never recomputed from the
 * ALREADY-replaced file: the recorded length + hash say whether the write landed,
 * and if it did not, the recorded bytes are re-applied.
 *
 * A resume has exactly two moves, and no third:
 *   (a) the region equals the recorded AFTER → the write landed; confirm it;
 *   (b) the file equals the recorded BEFORE → the write did not land; apply the
 *       span, and only when the replay renders the very bytes the record already
 *       promises.
 * Anything else BLOCKS. It used to fall back to writing `recorded.after` over the
 * WHOLE file, which is the worst available answer: the file matching neither
 * recorded state is precisely the case where an operator has edited it, and that
 * write erased their edits inside the span and everywhere else in the file at the
 * same time. Resume completes a step or confirms one; it never overwrites a file
 * it cannot account for.
 */
function applyPlaybookSpanInverseFirst(
  input: HarvestInput,
  op: HarvestOp,
  storage: GuildStorage,
  storeOpts: { storage?: GuildStorage; cwd?: string },
): PlaybookApplyOutcome {
  const pb = input.playbook as PlaybookSpanInput;
  const ctx: PlaybookSpanContext = {
    runDir: input.runDir,
    runId: input.run_id,
    storage,
    ...(input.writer ? { writer: input.writer } : {}),
  };

  const recorded = readInverse(input.run_id, op.op_id, storeOpts)?.files.find((f) => f.path === pb.path);
  if (recorded?.span?.after_len !== undefined && recorded.span.after_sha256 !== undefined) {
    // Resume. The record is the truth about what this op meant to write.
    const step = `playbook-span '${recorded.span.anchor}' in ${pb.path}`;
    const current = readFileOrNull(pb.path);
    if (current === null) {
      return { applied: false, block: { step, detail: "the playbook is gone" } };
    }
    const start = locateAnchorOffset(current, recorded.span.anchor);
    if (start !== null) {
      const region = current.slice(start, start + recorded.span.after_len);
      // (a) the region is the one this op wrote — the write landed.
      if (sha256(region) === recorded.span.after_sha256) return { applied: true };
    }
    // (b) the file is still the bytes the inverse was computed from — the write
    // did not land, so replay it, and only when the replay renders the very
    // bytes the record already promises.
    if (current === recorded.before) {
      let replay: PlaybookSpanPlan | null = null;
      try {
        replay = planPlaybookSpan(pb, ctx);
      } catch {
        replay = null;
      }
      if (replay && sha256(replay.after_span) === recorded.span.after_sha256) {
        const redone = applyPlaybookSpanPlan(replay, pb, ctx);
        if (redone.applied) {
          stampLandedFile(
            input.run_id,
            op.op_id,
            pb.path,
            redone.after ?? replay.next,
            storeOpts,
            redone.span_exact === false ? undefined : { after_span: redone.after_span as string },
          );
          return { applied: true };
        }
      }
      return {
        applied: false,
        block: {
          step,
          detail: "the recorded span could not be re-rendered from the unchanged file",
        },
      };
    }
    // Neither state. The file moved under the op — an operator edit, almost
    // always — and nothing here can tell which bytes are theirs. Report it and
    // leave every byte alone.
    return {
      applied: false,
      block: {
        step,
        detail:
          start === null
            ? "the anchor is no longer in the file, and the file is not the recorded before-bytes"
            : "the live bytes match neither the recorded before-file nor the recorded after-span",
      },
    };
  }

  let plan: PlaybookSpanPlan | null;
  try {
    plan = planPlaybookSpan(pb, ctx);
  } catch {
    return { applied: false };
  }
  if (!plan) return { applied: false };

  const stored = appendInverseFileOnce(
    input.run_id,
    op.op_id,
    {
      path: pb.path,
      before: plan.before,
      before_sha256: sha256(plan.before),
      after_sha256: sha256(plan.next),
      span: {
        anchor: plan.anchor,
        before_span: plan.before_span,
        before_sha256: sha256(plan.before_span),
        after_len: plan.after_span.length,
        after_sha256: sha256(plan.after_span),
      },
    },
    storeOpts,
  );
  if (!stored) return { applied: false };

  const result = applyPlaybookSpanPlan(plan, pb, ctx);
  if (!result.applied) return { applied: false };
  stampLandedFile(
    input.run_id,
    op.op_id,
    pb.path,
    result.after ?? plan.next,
    storeOpts,
    result.span_exact === false ? undefined : { after_span: result.after_span as string },
  );
  return { applied: true };
}

export interface RevertBlock {
  path: string;
  reason:
    | "missing-anchor"
    | "span-changed"
    | "file-changed"
    | "file-missing"
    /** The op's record has no after-side for this file: what it wrote is not knowable. */
    | "partial-inverse"
    /** The inverse was written but the bytes on disk afterwards are not the ones it meant to restore. */
    | "not-verified"
    /** The recorded inverse no longer hashes to what the op recorded: it was edited after the op. */
    | "inverse-tampered"
    /** The bytes revert would restore fail the D5 classifier or the injection probe. */
    | "content-refused";
  detail: string;
}

export interface RevertResult {
  op_id: string;
  restored: string[];
  ok: boolean;
  /**
   * True when revert REFUSED because the live bytes no longer match what the op
   * wrote. Nothing was restored and the journal is unchanged — the operator
   * decides, because the alternative is deleting their edit.
   */
  blocked_confirm?: boolean;
  blocked?: RevertBlock[];
  /** `operator` when a content gate refused the restore: the operator decides. */
  next_need?: "operator";
  detail?: string;
}

/**
 * The paragraphs that differ between two texts, plus the nearest heading above
 * them. Computed from the BYTES — never from the inverse's `span` metadata, which
 * lives in off-repo state and can be stripped or rewritten (codex G-lane r2 P1).
 *
 * The region is widened to blank-line paragraph boundaries, so a one-line edit to
 * a sentence that wraps across lines is classified as the whole sentence.
 */
function changedRegion(from: string, to: string): { heading: string; from: string; to: string } {
  const a = from.split("\n");
  const b = to.split("\n");
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  while (pre > 0 && a[pre - 1].trim() !== "") pre--;
  while (suf > 0 && a[a.length - suf].trim() !== "") suf--;
  const heading = a.slice(0, pre).reverse().find((l) => /^#{1,6}\s/.test(l)) ?? "";
  return {
    heading: heading.replace(/^#+\s*/, ""),
    from: a.slice(pre, a.length - suf).join("\n"),
    to: b.slice(pre, b.length - suf).join("\n"),
  };
}

/**
 * Screen the bytes a revert would put back with the gates a forward harvest
 * passes. A revert is a WRITE from off-repo history, so an edited inverse is the
 * same injection vector as an unscreened harvest.
 *
 * It screens `write` — the full file revert is about to hand the scrubbed
 * writer — against the live bytes, whatever shape the inverse claims to have. A
 * whole-file inverse and a span inverse go through the same D5 + probe path.
 */
function screenRevertFile(f: HarvestInverseFile, current: string | null, write: string | null): RevertBlock | null {
  if (write === null) return null; // a delete restores no content
  const region = changedRegion(current ?? "", write);
  const d5 = classifyPermissionContent({ span: region.heading, beforeSpan: region.from, replacement: region.to });
  if (d5.isPermissionEdit) {
    return { path: f.path, reason: "content-refused", detail: `permissions are proposal-only (D5): ${d5.detail}` };
  }
  const probe = sanitizeForInjection(write);
  if (probe.result === "flagged") {
    return {
      path: f.path,
      reason: "content-refused",
      detail: `the restore carries directive language (${probe.matchedPatterns.join(", ")})`,
    };
  }
  if (containsRecallTag(write)) {
    return { path: f.path, reason: "content-refused", detail: "the restore spells the <guild:recall> wrapper tag" };
  }
  return null;
}

/** A span record revert can use: every field it reads has the type it reads. */
function spanIsWellFormed(span: unknown): boolean {
  if (typeof span !== "object" || span === null || Array.isArray(span)) return false;
  const s = span as Record<string, unknown>;
  const optional = (v: unknown, t: "string" | "number") => v === undefined || typeof v === t;
  return (
    typeof s.anchor === "string" &&
    typeof s.before_span === "string" &&
    typeof s.before_sha256 === "string" &&
    optional(s.after_sha256, "string") &&
    optional(s.after_len, "number") &&
    (s.after_len === undefined || (Number.isInteger(s.after_len) && (s.after_len as number) >= 0))
  );
}

/**
 * Decide whether one recorded inverse still describes the file on disk, and what
 * bytes revert would write.
 *
 * Revert used to restore the whole file from `before`, which deleted every
 * operator edit made after the op — including edits to parts of the file the op
 * never touched. It now restores only the REGION the op wrote, and only while the
 * live bytes in that region are still the op's: anything else is `blocked_confirm`.
 */
function planRevertFile(
  f: HarvestInverseFile,
  mustHaveSpan: boolean,
): { write?: string | null; block?: RevertBlock } {
  // Shape before trust. A span-shaped op whose record no longer carries a usable
  // span is a tampered record, not a whole-file one: stripping `span` used to
  // route a playbook through the whole-file branch, which restored `before`
  // wholesale (codex G-lane r2 P1).
  if (f.span !== undefined ? !spanIsWellFormed(f.span) : mustHaveSpan) {
    return {
      block: {
        path: f.path,
        reason: "inverse-tampered",
        detail:
          f.span === undefined
            ? "this file was changed by a span op but its recorded inverse carries no span"
            : "the recorded span is malformed",
      },
    };
  }
  if (f.before !== null && typeof f.before !== "string") {
    return { block: { path: f.path, reason: "inverse-tampered", detail: "the recorded `before` is malformed" } };
  }
  const exists = fs.existsSync(f.path);
  const current = exists ? fs.readFileSync(f.path, "utf8") : null;

  // The inverse lives in off-repo runtime state. Trust it only while it still
  // hashes to what the op recorded next to it.
  const restoring = f.span ? f.span.before_span : f.before;
  const recorded = f.span ? f.span.before_sha256 : f.before_sha256;
  if (restoring !== null && (recorded === undefined || sha256(restoring) !== recorded)) {
    return {
      block: {
        path: f.path,
        reason: "inverse-tampered",
        detail: "the recorded inverse does not match its recorded hash",
      },
    };
  }

  if (f.span) {
    // A record with no after-side is a PARTIAL inverse. It used to be treated as
    // "the op wrote nothing here", so revert skipped the playbook, deleted the
    // page and reported success — the one outcome that loses an operator's file
    // while telling them it did not. Nobody can tell from here whether the write
    // landed, so the operator decides.
    if (f.span.after_len === undefined || f.span.after_sha256 === undefined) {
      return {
        block: {
          path: f.path,
          reason: "partial-inverse",
          detail: `the recorded inverse for '${f.span.anchor}' has no after-side; what the op wrote is unknown`,
        },
      };
    }
    if (current === null) {
      return { block: { path: f.path, reason: "file-missing", detail: "the playbook is gone" } };
    }
    // Anchor + LENGTH, verified by hash. Re-scanning for the next same-level
    // heading ended early whenever the replacement itself contained one, so the
    // located region covered only the first part of what the op wrote and the
    // rest stayed in the file after a "successful" revert.
    const start = locateAnchorOffset(current, f.span.anchor);
    if (start === null) {
      return {
        block: { path: f.path, reason: "missing-anchor", detail: `anchor '${f.span.anchor}' is no longer in the file` },
      };
    }
    const end = start + f.span.after_len;
    const region = current.slice(start, end);
    if (region.length !== f.span.after_len || sha256(region) !== f.span.after_sha256) {
      return {
        block: { path: f.path, reason: "span-changed", detail: `'${f.span.anchor}' is not the region this op wrote` },
      };
    }
    return { write: current.slice(0, start) + f.span.before_span + current.slice(end) };
  }

  // Whole-page op. The after-hash is recorded BEFORE the write, so a record
  // without one means the op never got as far as writing its intent down —
  // which is not the same as "nothing happened", and is not revert's call.
  if (f.after_sha256 === undefined) {
    return {
      block: {
        path: f.path,
        reason: "partial-inverse",
        detail: "the recorded inverse has no after-side; what the op wrote is unknown",
      },
    };
  }
  if (current === null) {
    return { block: { path: f.path, reason: "file-missing", detail: "the page is already gone" } };
  }
  if (sha256(current) !== f.after_sha256) {
    return {
      block: { path: f.path, reason: "file-changed", detail: "the page was edited after the harvest" },
    };
  }
  return { write: f.before };
}

/**
 * `maintain wiki revert <harvest_id>` — restore the wiki page AND the playbook
 * span from compact history (R54 / KTD48).
 *
 * Two phases. The first plans every file and writes nothing; if ANY file has moved
 * under the op the whole revert is refused as `blocked_confirm`, so a partial
 * revert can never leave half the op undone. The second applies the plan. A file
 * that did not exist before the op is DELETED rather than left as an empty page: a
 * reverted harvest must leave no trace that recall could still hit.
 */
export function revertHarvest(
  runId: string,
  opId: string,
  opts: { cwd?: string; storage?: GuildStorage; runDir?: string } = {},
): RevertResult {
  const inverse = readInverse(runId, opId, opts);
  if (!inverse) {
    return { op_id: opId, restored: [], ok: false, detail: "no compact history for this op" };
  }
  const storage = opts.storage ?? createGuildStorage(opts.cwd ?? process.cwd());

  const runDir = opts.runDir ?? resolveRunDir(storage.activeRoot, runId);
  const plans: Array<{ file: HarvestInverseFile; write: string | null }> = [];
  const blocked: RevertBlock[] = [];
  // Which files MUST carry a span is decided outside the inverse: the op's own
  // journal entry names its playbook, and only a wiki page is ever a whole-file
  // inverse. A file outside the wiki root is span-only.
  const opRecord = findOp(runId, opId, opts);
  const scopeForSpan = storage.project ?? storage.workspace;
  const wikiRootForSpan = scopeForSpan ? scopeForSpan.knowledge() : null;
  const spanOnly = (p: string): boolean =>
    (opRecord?.playbook_path !== undefined && path.resolve(opRecord.playbook_path) === path.resolve(p)) ||
    wikiRootForSpan === null ||
    !isWithin(path.resolve(p), wikiRootForSpan);
  const files = Array.isArray(inverse.files) ? inverse.files : [];
  for (const f of files) {
    if (typeof f?.path !== "string" || f.path.length === 0) {
      blocked.push({ path: String(f?.path ?? ""), reason: "inverse-tampered", detail: "the recorded file entry has no path" });
      continue;
    }
    const planned = planRevertFile(f, spanOnly(f.path));
    if (planned.block) {
      blocked.push(planned.block);
      continue;
    }
    const screened = screenRevertFile(f, readFileOrNull(f.path), planned.write ?? null);
    if (screened) blocked.push(screened);
    else plans.push({ file: f, write: planned.write ?? null });
  }
  if (blocked.length > 0) {
    const detail =
      `revert refused: ` +
      blocked.map((b) => `${b.path} (${b.reason}: ${b.detail})`).join("; ") +
      `. The operator must resolve this — revert never clobbers a later edit.`;
    const gated = blocked.some((b) => b.reason === "content-refused" || b.reason === "inverse-tampered");
    if (gated && fs.existsSync(runDir)) {
      emitSecurity(runDir, runId, "harvest_refused", "blocked", `revert of '${opId}' refused: ${detail}`);
    }
    return {
      op_id: opId,
      restored: [],
      ok: false,
      blocked_confirm: true,
      blocked,
      ...(gated ? { next_need: "operator" as const } : {}),
      detail,
    };
  }

  const writer = assertScrubbedWriter(scrubbedWikiWriter);
  const restored: string[] = [];
  const unverified: RevertBlock[] = [];
  for (const { file, write } of plans) {
    try {
      if (write === null) {
        if (fs.existsSync(file.path)) fs.rmSync(file.path);
      } else {
        storage.ensureDir(path.dirname(file.path));
        const wrote = writer(file.path, write, { runDir, runId });
        if (!wrote.written) {
          return { op_id: opId, restored, ok: false, detail: `scrubbed write refused ${file.path}` };
        }
      }
    } catch (err) {
      return { op_id: opId, restored, ok: false, detail: (err as Error).message };
    }
    // VERIFY, per step. `reverted` is terminal and closes the op_id, so it is
    // only ever written when every inverse in this op provably landed. An
    // unverified step names itself rather than disappearing into an `ok: true`.
    const back = readFileOrNull(file.path);
    const landed = write === null ? back === null : back === write;
    if (!landed) {
      unverified.push({
        path: file.path,
        reason: "not-verified",
        detail:
          write === null
            ? "the page is still on disk after the revert delete"
            : "the restored bytes are not the ones the inverse describes",
      });
      continue;
    }
    restored.push(file.path);
  }
  if (unverified.length > 0) {
    return {
      op_id: opId,
      restored,
      ok: false,
      blocked_confirm: true,
      blocked: unverified,
      detail:
        `revert could not verify: ` +
        unverified.map((b) => `${b.path} (${b.reason}: ${b.detail})`).join("; ") +
        `. The op stays OPEN — it is not marked reverted.`,
    };
  }

  const scope = storage.project ?? storage.workspace;
  if (scope) {
    const wikiRoot = scope.knowledge();
    const rel = restored
      .filter((p) => isWithin(p, wikiRoot))
      .map((p) => path.relative(wikiRoot, p).split(path.sep).join("/"));
    if (rel.length > 0) refreshWikiIndexPaths(rel, { storage });
  }

  // Preserve the op's own fields — trigger, decision id, superseded ids. Only the
  // status moves, so the journal still says WHAT was reverted, not just that
  // something was. `reverted` is TERMINAL: this op_id is closed, and a later
  // promotion of the same content is a new op that re-passes every gate.
  const prior = findOp(runId, opId, opts);
  upsertOp(
    runId,
    { ...(prior ?? { op_id: opId, trigger: "manual" as const }), op_id: opId, status: "reverted" },
    opts,
  );
  // The audit twin lands on the run the op belonged to, and only when that run
  // record exists: a revert must not invent a run directory to log into.
  if (fs.existsSync(runDir)) {
    emitSecurity(runDir, runId, "harvest_reverted", "allow", `harvest op '${opId}' reverted (${restored.length} file(s))`);
  }
  return { op_id: opId, restored, ok: true };
}
