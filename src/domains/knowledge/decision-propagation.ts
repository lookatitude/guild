/**
 * decision-propagation.ts — K04: accepted-decision events, dependent pins, replan
 * signals, project-memory invalidation and scoped candidate publication.
 *
 * Layout, all under the owner root's durable `.guild/` (never another root):
 *
 *   knowledge/decisions/events/<seq>.json   append-only accepted-decision events, hash-chained
 *   knowledge/decisions/pins/<key>.json     one pin per dependent (plan / summary / lesson)
 *   knowledge/decisions/propagation.json    derived report; recomputable from events + pins
 *   knowledge/candidates/manifest.json      candidates by reference, pending human ingest
 *
 * Authority is an accepted event, and only a canonical wiki page of THIS root
 * becomes one: candidates (staged or edited to say "canonical") never do. A pin
 * names exact decision revisions and the dependent's own bytes as read now; it is
 * refused unless every pinned decision is current authority. Supersession never
 * edits a dependent: a plan pinning a superseded or changed decision is reported
 * `replan_required`, a summary or lesson `stale`, and the old event, page and pin
 * stay on disk. Wiki writes stay with harvest; this module writes no wiki bytes.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { checkContained, isRefused, isWithin, prepareContainedWrite, writeContainedFile } from "../kernel";
import { parseFrontmatter } from "../state";
import { acquirePublisherLock } from "./publication";
import { canonicalJson, sourceWorktreeId, type Sha256 } from "./source-basis";

export const DECISION_EVENT_SCHEMA = "guild.decision_event.v1" as const;
export const DECISION_PIN_SCHEMA = "guild.decision_pin.v1" as const;
export const DECISION_PROPAGATION_SCHEMA = "guild.decision_propagation.v1" as const;
export const DECISION_CANDIDATES_SCHEMA = "guild.decision_candidates.v1" as const;

/** C13 `common.schema.json#/$defs/entity`. */
export interface EntityRef {
  source_id: string;
  kind: "decision" | "knowledge" | "memory" | "candidate";
  id: string;
  revision: Sha256;
}

/**
 * Dependent kinds and their C13 entity mapping. The frozen kind enum has no
 * `plan`, so a plan is `knowledge` with a `plan:` id; summaries and lessons are
 * `memory` with `summary:` / `lesson:` ids.
 */
export type DependentKind = "plan" | "summary" | "lesson";

const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EVENT_FILE = /^(\d{12})\.json$/;
const SHA = /^sha256:[a-f0-9]{64}$/;
/** C13 caps both entity arrays at 100. */
export const C13_ENTITY_CAP = 100;

export interface DecisionEvent {
  schema_version: typeof DECISION_EVENT_SCHEMA;
  seq: number;
  prev_event_sha256: Sha256 | null;
  event: "accepted";
  decision: EntityRef;
  /** Page path relative to the owner `.guild/`. */
  page: string;
  /** Accepted decisions this one supersedes, at the revision that was authority. */
  supersedes: EntityRef[];
  /** Superseded ids that never had an accepted event here (legacy pages). Audit only. */
  supersedes_unrecorded: string[];
  recorded_at: string;
  op_id: string | null;
  /** The staged candidate this acceptance promoted (path relative to the owner `.guild/`), if any. */
  from_candidate?: { path: string; revision: Sha256 } | null;
}

export interface DecisionState {
  ref: EntityRef;
  page: string;
  status: "accepted" | "superseded";
  superseded_by: EntityRef | null;
  /** Every accepted revision of this id, oldest first. */
  revisions: Sha256[];
}

export interface DecisionLedger {
  head: { seq: number; sha256: Sha256 } | null;
  events: DecisionEvent[];
  decisions: Map<string, DecisionState>;
  /** Ids superseded before they had an event here (legacy pages): never authority. */
  tombstones: Map<string, EntityRef>;
}

export type Refusal<R extends string> = { status: "refused"; reason: R; detail: string };

export class DecisionLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionLedgerError";
  }
}

/** The root or every ancestor is absent: nothing was ever written there. */
function absent(code: string): boolean {
  return code === "root-unresolvable" || code === "no-existing-ancestor";
}

function sha(bytes: Buffer | string): Sha256 {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function decisionsHome(guildDir: string): string {
  return path.join(guildDir, "knowledge", "decisions");
}

/** The owner identity: same id K03 publications use for the root holding this `.guild/`. */
export function ownerSourceId(guildDir: string): string {
  return sourceWorktreeId(path.dirname(path.resolve(guildDir)));
}

function rel(guildDir: string, abs: string): string {
  return path.relative(path.resolve(guildDir), path.resolve(abs)).split(path.sep).join("/");
}

/** Bytes of a regular file inside `root`, or null when absent. Throws on escape or a non-file leaf. */
function readInside(root: string, abs: string): Buffer | null {
  const c = checkContained(root, abs, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(c)) {
    if (absent(c.code)) return null;
    throw new DecisionLedgerError(`${abs}: ${c.code}`);
  }
  try {
    return fs.readFileSync(c.realPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function writeInside(root: string, abs: string, content: string): void {
  const w = writeContainedFile(root, abs, Buffer.from(content, "utf8"));
  if (!w.written) throw new DecisionLedgerError(`write refused at ${abs}: ${w.code ?? "unknown"} ${w.detail ?? ""}`.trim());
}

/** K03's publisher lock (pid + host owner, stale reclaim) over `knowledge/decisions/lock`. */
function withLock<T>(guildDir: string, fn: () => T): T {
  const home = decisionsHome(guildDir);
  const c = checkContained(guildDir, home, { policy: "physical" });
  if (isRefused(c) && !absent(c.code)) throw new DecisionLedgerError(`decisions dir: ${c.code}`);
  const lock = acquirePublisherLock(home, { timeoutMs: 10_000 });
  if (!lock.ok) throw new DecisionLedgerError(`decision lock: ${lock.detail}`);
  try {
    return fn();
  } finally {
    lock.release();
  }
}

// ── ledger ────────────────────────────────────────────────────────────────────

function isEntity(v: unknown, kind?: string): v is EntityRef {
  const e = v as EntityRef;
  return (
    !!e &&
    typeof e === "object" &&
    typeof e.source_id === "string" &&
    ENTITY_ID.test(e.source_id) &&
    typeof e.id === "string" &&
    ENTITY_ID.test(e.id) &&
    typeof e.revision === "string" &&
    SHA.test(e.revision) &&
    (kind === undefined || e.kind === kind)
  );
}

function parseEvent(bytes: Buffer, seq: number, prev: Sha256 | null): DecisionEvent {
  let ev: DecisionEvent;
  try {
    ev = JSON.parse(bytes.toString("utf8")) as DecisionEvent;
  } catch {
    throw new DecisionLedgerError(`event ${seq} is not JSON`);
  }
  if (ev.schema_version !== DECISION_EVENT_SCHEMA || ev.event !== "accepted") throw new DecisionLedgerError(`event ${seq} has an unknown schema or kind`);
  if (ev.seq !== seq) throw new DecisionLedgerError(`event ${seq} names seq ${String(ev.seq)}`);
  if (ev.prev_event_sha256 !== prev) throw new DecisionLedgerError(`event ${seq} does not chain to its predecessor`);
  if (!isEntity(ev.decision, "decision")) throw new DecisionLedgerError(`event ${seq} has an invalid decision ref`);
  if (!Array.isArray(ev.supersedes) || !ev.supersedes.every((s) => isEntity(s, "decision"))) throw new DecisionLedgerError(`event ${seq} has an invalid supersedes list`);
  if (typeof ev.page !== "string" || !Array.isArray(ev.supersedes_unrecorded) || !ev.supersedes_unrecorded.every((x) => typeof x === "string")) throw new DecisionLedgerError(`event ${seq} is incomplete`);
  const fc = ev.from_candidate;
  if (fc != null && (typeof fc.path !== "string" || typeof fc.revision !== "string" || !SHA.test(fc.revision))) throw new DecisionLedgerError(`event ${seq} has an invalid candidate ref`);
  return ev;
}

/** Read and verify the whole ledger. Throws `DecisionLedgerError` on any gap, fork or tamper. */
export function readDecisionLedger(guildDir: string): DecisionLedger {
  const dir = path.join(decisionsHome(guildDir), "events");
  const c = checkContained(guildDir, dir, { policy: "physical" });
  const ledger: DecisionLedger = { head: null, events: [], decisions: new Map(), tombstones: new Map() };
  if (isRefused(c)) {
    if (absent(c.code)) return ledger;
    throw new DecisionLedgerError(`events dir: ${c.code}`);
  }
  if (!fs.existsSync(c.realPath)) return ledger;
  const seqs = fs
    .readdirSync(c.realPath)
    .map((n) => EVENT_FILE.exec(n))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  let prev: Sha256 | null = null;
  for (let i = 0; i < seqs.length; i++) {
    if (seqs[i] !== i + 1) throw new DecisionLedgerError(`event sequence has a gap at ${i + 1}`);
    const bytes = readInside(guildDir, path.join(c.realPath, eventName(i + 1)));
    if (!bytes) throw new DecisionLedgerError(`event ${i + 1} vanished`);
    const ev = parseEvent(bytes, i + 1, prev);
    prev = sha(bytes);
    ledger.events.push(ev);
    apply(ledger, ev);
  }
  if (prev) ledger.head = { seq: seqs.length, sha256: prev };
  return ledger;
}

function apply(ledger: DecisionLedger, ev: DecisionEvent): void {
  const decisions = ledger.decisions;
  const prior = decisions.get(ev.decision.id);
  if (prior?.status === "superseded" || ledger.tombstones.has(ev.decision.id)) throw new DecisionLedgerError(`event ${ev.seq} re-accepts superseded ${ev.decision.id}`);
  decisions.set(ev.decision.id, {
    ref: ev.decision,
    page: ev.page,
    status: "accepted",
    superseded_by: null,
    revisions: [...(prior?.revisions ?? []), ev.decision.revision],
  });
  for (const s of ev.supersedes) {
    const st = decisions.get(s.id);
    if (!st || st.status !== "accepted" || st.ref.revision !== s.revision) {
      throw new DecisionLedgerError(`event ${ev.seq} supersedes ${s.id} at a revision that was not authority`);
    }
    st.status = "superseded";
    st.superseded_by = ev.decision;
  }
  for (const id of ev.supersedes_unrecorded) {
    if (!ENTITY_ID.test(id) || decisions.has(id)) throw new DecisionLedgerError(`event ${ev.seq} has an invalid unrecorded supersession ${id}`);
    ledger.tombstones.set(id, ev.decision);
  }
}

function eventName(seq: number): string {
  return `${String(seq).padStart(12, "0")}.json`;
}

/** Create `final` exclusively: write a temp, fsync, hard-link (fails if it exists), unlink the temp. */
function createExclusive(guildDir: string, final: string, content: string): boolean {
  const prepared = prepareContainedWrite(guildDir, final, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new DecisionLedgerError(`event path: ${prepared.code}`);
  const real = path.dirname(prepared.realPath);
  const tmp = path.join(real, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o644);
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.linkSync(tmp, path.join(real, path.basename(final)));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export interface AcceptInput {
  /** Owner durable `.guild/`. */
  guildDir: string;
  /** The canonical decision page, inside `<guildDir>/wiki/`. */
  pagePath: string;
  /** Extra ids this decision supersedes (harvest's `superseded_ids`), besides the page's `replaces`. */
  supersededIds?: readonly string[];
  now?: string;
  opId?: string;
  /** The staged candidate being promoted; must sit in this owner's candidates home. */
  fromCandidate?: { path: string; revision: Sha256 };
}

export type AcceptResult =
  | { status: "recorded" | "unchanged"; event: DecisionEvent }
  | Refusal<"scope" | "not_canonical" | "superseded" | "cycle" | "ledger_corrupt" | "contention">;

/**
 * Record a canonical decision page as accepted authority. Idempotent for the same
 * id, revision and supersession set. Refuses candidates, non-canonical pages, a
 * page outside this root's wiki and re-acceptance of a superseded id.
 */
export function recordAcceptedDecision(input: AcceptInput): AcceptResult {
  const guildDir = path.resolve(input.guildDir);
  const wikiDir = path.join(guildDir, "wiki");
  let bytes: Buffer | null;
  try {
    const inWiki = checkContained(wikiDir, input.pagePath, { policy: "physical", requireRegularFileLeaf: true });
    if (isRefused(inWiki)) return { status: "refused", reason: "scope", detail: `${input.pagePath} is not a page in this root's wiki (${inWiki.code})` };
    bytes = readInside(wikiDir, input.pagePath);
  } catch (err) {
    return { status: "refused", reason: "scope", detail: (err as Error).message };
  }
  if (!bytes) return { status: "refused", reason: "scope", detail: `${input.pagePath} does not exist` };
  const fm = parseFrontmatter(bytes.toString("utf8"));
  const id = typeof fm?.["id"] === "string" ? (fm["id"] as string) : "";
  if (!fm || fm["type"] !== "decision" || fm["schema_version"] !== "guild.decision.v1" || fm["status"] !== "canonical" || !ENTITY_ID.test(id)) {
    return { status: "refused", reason: "not_canonical", detail: `${input.pagePath} is not a canonical guild.decision.v1 page` };
  }
  const replaces = typeof fm["replaces"] === "string" ? [fm["replaces"] as string] : [];
  const wanted = [...new Set([...replaces, ...(input.supersededIds ?? [])])].sort();
  if (wanted.includes(id)) return { status: "refused", reason: "cycle", detail: `${id} cannot supersede itself` };
  let fromCandidate: DecisionEvent["from_candidate"] = null;
  if (input.fromCandidate) {
    const home = path.join(guildDir, "knowledge", "candidates", "decisions");
    const c = checkContained(home, input.fromCandidate.path, { policy: "physical" });
    if (isRefused(c) || !SHA.test(input.fromCandidate.revision)) return { status: "refused", reason: "scope", detail: `${input.fromCandidate.path} is not a candidate of this root` };
    fromCandidate = { path: rel(guildDir, path.resolve(input.fromCandidate.path)), revision: input.fromCandidate.revision };
  }
  const owner = ownerSourceId(guildDir);
  const decision: EntityRef = { source_id: owner, kind: "decision", id, revision: sha(bytes) };
  const page = rel(guildDir, path.resolve(input.pagePath));

  try {
    return withLock(guildDir, (): AcceptResult => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const ledger = readDecisionLedger(guildDir);
        const cur = ledger.decisions.get(id);
        const tomb = ledger.tombstones.get(id);
        if (cur?.status === "superseded" || tomb) {
          return { status: "refused", reason: "superseded", detail: `${id} was superseded by ${(cur?.superseded_by ?? tomb)?.id ?? "?"}; it cannot become authority again` };
        }
        const supersedes: EntityRef[] = [];
        const unrecorded: string[] = [];
        for (const sid of wanted) {
          const s = ledger.decisions.get(sid);
          if (s?.status === "accepted") supersedes.push(s.ref);
          else if (!s && !ledger.tombstones.has(sid)) unrecorded.push(sid);
          // Already superseded: its successor is on record; nothing to add.
        }
        const last = cur ? [...ledger.events].reverse().find((e) => e.decision.id === id) : undefined;
        if (last && cur!.ref.revision === decision.revision && supersedes.length === 0 && unrecorded.length === 0 && (!fromCandidate || last.from_candidate?.revision === fromCandidate.revision)) {
          return { status: "unchanged", event: last };
        }
        const ev: DecisionEvent = {
          schema_version: DECISION_EVENT_SCHEMA,
          seq: (ledger.head?.seq ?? 0) + 1,
          prev_event_sha256: ledger.head?.sha256 ?? null,
          event: "accepted",
          decision,
          page,
          supersedes,
          supersedes_unrecorded: unrecorded,
          recorded_at: input.now ?? new Date().toISOString(),
          op_id: input.opId ?? null,
          from_candidate: fromCandidate,
        };
        const target = path.join(decisionsHome(guildDir), "events", eventName(ev.seq));
        if (createExclusive(guildDir, target, JSON.stringify(ev, null, 2) + "\n")) return { status: "recorded", event: ev };
      }
      return { status: "refused", reason: "contention", detail: "the ledger head kept moving" };
    });
  } catch (err) {
    if (err instanceof DecisionLedgerError) return { status: "refused", reason: "ledger_corrupt", detail: err.message };
    throw err;
  }
}

// ── pins ──────────────────────────────────────────────────────────────────────

export interface DependentPin {
  schema_version: typeof DECISION_PIN_SCHEMA;
  dependent: EntityRef;
  dependent_kind: DependentKind;
  /** Dependent path relative to the owner `.guild/`. */
  path: string;
  decisions: EntityRef[];
  pinned_at: string;
  /** Earlier pins of this dependent, oldest first. Never pruned. */
  history: Array<{ revision: Sha256; decisions: EntityRef[]; pinned_at: string }>;
}

const KIND_HOME: Record<DependentKind, { dir: string; entity: EntityRef["kind"] }> = {
  plan: { dir: "plan", entity: "knowledge" },
  summary: { dir: path.join("memory", "summaries"), entity: "memory" },
  lesson: { dir: path.join("memory", "lessons"), entity: "memory" },
};

function pinPath(guildDir: string, entityId: string): string {
  return path.join(decisionsHome(guildDir), "pins", `${crypto.createHash("sha256").update(entityId).digest("hex").slice(0, 32)}.json`);
}

export interface PinInput {
  guildDir: string;
  kind: DependentKind;
  /** Slug for the entity id (`plan:<name>` …). */
  name: string;
  /** Dependent file; must sit in this owner's home for `kind`. */
  path: string;
  decisions: ReadonlyArray<{ id: string; revision: Sha256 }>;
  /** Revision the caller last read for the existing pin; `null` for "no pin yet". Omitted: no CAS. */
  expectRevision?: Sha256 | null;
  now?: string;
}

export type PinResult = { status: "pinned"; pin: DependentPin } | Refusal<"scope" | "invalid" | "unapproved" | "cas_conflict" | "ledger_corrupt">;

/**
 * Pin a dependent to exact accepted decision revisions. The dependent revision is
 * the hash of its bytes as read now, never a caller value. Refused unless every
 * decision is current authority at that revision: a plan cannot be re-pinned to
 * clear a replan while it still names the superseded decision.
 */
export function pinDependent(input: PinInput): PinResult {
  const guildDir = path.resolve(input.guildDir);
  const home = path.join(guildDir, KIND_HOME[input.kind].dir);
  const entityId = `${input.kind}:${input.name}`;
  if (!ENTITY_ID.test(entityId)) return { status: "refused", reason: "invalid", detail: `${entityId} is not a valid entity id` };
  if (input.decisions.length === 0) return { status: "refused", reason: "invalid", detail: "a pin names at least one decision" };
  let bytes: Buffer | null;
  try {
    const c = checkContained(home, input.path, { policy: "physical", requireRegularFileLeaf: true });
    if (isRefused(c)) return { status: "refused", reason: "scope", detail: `${input.path} is outside this owner's ${KIND_HOME[input.kind].dir}/ (${c.code})` };
    bytes = readInside(home, input.path);
  } catch (err) {
    return { status: "refused", reason: "scope", detail: (err as Error).message };
  }
  if (!bytes) return { status: "refused", reason: "scope", detail: `${input.path} does not exist` };
  const owner = ownerSourceId(guildDir);
  const now = input.now ?? new Date().toISOString();
  try {
    return withLock(guildDir, (): PinResult => {
      const ledger = readDecisionLedger(guildDir);
      const refs: EntityRef[] = [];
      for (const d of [...input.decisions].sort((a, b) => a.id.localeCompare(b.id))) {
        const st = ledger.decisions.get(d.id);
        if (!st || st.status !== "accepted" || st.ref.revision !== d.revision) {
          const why = !st ? "has no accepted event" : st.status === "superseded" ? `is superseded by ${st.superseded_by?.id ?? "?"}` : "is accepted at another revision";
          return { status: "refused", reason: "unapproved", detail: `${d.id} ${why}` };
        }
        refs.push(st.ref);
      }
      const file = pinPath(guildDir, entityId);
      const prevBytes = readInside(guildDir, file);
      const prev = prevBytes ? (JSON.parse(prevBytes.toString("utf8")) as DependentPin) : null;
      if (input.expectRevision !== undefined && (prev?.dependent.revision ?? null) !== input.expectRevision) {
        return { status: "refused", reason: "cas_conflict", detail: `${entityId} is pinned at ${prev?.dependent.revision ?? "nothing"}, not ${String(input.expectRevision)}` };
      }
      const pin: DependentPin = {
        schema_version: DECISION_PIN_SCHEMA,
        dependent: { source_id: owner, kind: KIND_HOME[input.kind].entity, id: entityId, revision: sha(bytes) },
        dependent_kind: input.kind,
        path: rel(guildDir, path.resolve(input.path)),
        decisions: refs,
        pinned_at: now,
        history: prev ? [...prev.history, { revision: prev.dependent.revision, decisions: prev.decisions, pinned_at: prev.pinned_at }] : [],
      };
      writeInside(guildDir, file, JSON.stringify(pin, null, 2) + "\n");
      return { status: "pinned", pin };
    });
  } catch (err) {
    if (err instanceof DecisionLedgerError || err instanceof SyntaxError) return { status: "refused", reason: "ledger_corrupt", detail: (err as Error).message };
    throw err;
  }
}

function readPins(guildDir: string): DependentPin[] {
  const dir = path.join(decisionsHome(guildDir), "pins");
  const c = checkContained(guildDir, dir, { policy: "physical" });
  if (isRefused(c)) {
    if (absent(c.code)) return [];
    throw new DecisionLedgerError(`pins dir: ${c.code}`);
  }
  if (!fs.existsSync(c.realPath)) return [];
  const out: DependentPin[] = [];
  for (const n of fs.readdirSync(c.realPath).sort()) {
    if (!/^[a-f0-9]{32}\.json$/.test(n)) continue;
    const bytes = readInside(guildDir, path.join(c.realPath, n));
    if (!bytes) continue;
    let pin: DependentPin;
    try {
      pin = JSON.parse(bytes.toString("utf8")) as DependentPin;
    } catch {
      throw new DecisionLedgerError(`pin ${n} is not JSON`);
    }
    if (pin.schema_version !== DECISION_PIN_SCHEMA || !isEntity(pin.dependent) || !(pin.dependent_kind in KIND_HOME) || !Array.isArray(pin.decisions) || !pin.decisions.every((d) => isEntity(d, "decision"))) {
      throw new DecisionLedgerError(`pin ${n} is invalid`);
    }
    if (`${crypto.createHash("sha256").update(pin.dependent.id).digest("hex").slice(0, 32)}.json` !== n) throw new DecisionLedgerError(`pin ${n} names another dependent`);
    out.push(pin);
  }
  return out;
}

// ── propagation ───────────────────────────────────────────────────────────────

export type DependentState = "current" | "replan_required" | "stale" | "unknown";

export interface DependentStatus {
  dependent: EntityRef;
  dependent_kind: DependentKind;
  path: string;
  state: DependentState;
  /** Hash of the dependent's bytes now; null when the file is gone. */
  observed_revision: Sha256 | null;
  /** Pinned decisions that are no longer authority, with what replaced them. */
  /** Every decision this dependent pins, as pinned. */
  pinned: EntityRef[];
  stale_decisions: Array<{ pinned: EntityRef; superseded_by: EntityRef | null; reason: "superseded" | "revised" | "page_changed" | "page_missing" }>;
  reasons: string[];
}

export interface PropagationReport {
  schema_version: typeof DECISION_PROPAGATION_SCHEMA;
  owner_source_id: string;
  ledger_head: { seq: number; sha256: Sha256 } | null;
  generated_at: string;
  /** Current accepted decisions some dependent pins, at their authority revision. */
  decision_refs: EntityRef[];
  /** Plans that must be replanned; revision is the pinned plan bytes. */
  replan_required: EntityRef[];
  project_memory: { state: "current_for_basis" | "stale" | "unknown"; stale: EntityRef[]; unknown: EntityRef[] };
  dependents: DependentStatus[];
}

export type PropagationResult = { status: "ok"; report: PropagationReport; written: boolean } | Refusal<"ledger_corrupt">;

function computeReport(guildDir: string, now: string): PropagationReport {
  const ledger = readDecisionLedger(guildDir);
  const pins = readPins(guildDir);
  const pageSha = new Map<string, Sha256 | null>();
  const pageOf = (st: DecisionState): Sha256 | null => {
    if (!pageSha.has(st.page)) {
      let b: Buffer | null = null;
      try {
        b = readInside(guildDir, path.join(guildDir, st.page));
      } catch {
        b = null;
      }
      pageSha.set(st.page, b ? sha(b) : null);
    }
    return pageSha.get(st.page) ?? null;
  };
  const referenced = new Map<string, EntityRef>();
  const dependents: DependentStatus[] = [];
  for (const pin of pins) {
    const stale: DependentStatus["stale_decisions"] = [];
    for (const d of pin.decisions) {
      const st = ledger.decisions.get(d.id);
      if (!st) {
        // A pin can only be written against an accepted event; a missing one means the ledger lost it.
        throw new DecisionLedgerError(`pin ${pin.dependent.id} names ${d.id}, which the ledger does not hold`);
      }
      if (st.status === "superseded") stale.push({ pinned: d, superseded_by: st.superseded_by, reason: "superseded" });
      else if (st.ref.revision !== d.revision) stale.push({ pinned: d, superseded_by: st.ref, reason: "revised" });
      else {
        const live = pageOf(st);
        if (live === null) stale.push({ pinned: d, superseded_by: null, reason: "page_missing" });
        else if (live !== st.ref.revision) stale.push({ pinned: d, superseded_by: null, reason: "page_changed" });
        else referenced.set(st.ref.id, st.ref);
      }
      // A successor is authority only while its own page still verifies.
      const succId = st.status === "superseded" ? st.superseded_by?.id : st.ref.revision !== d.revision ? st.ref.id : undefined;
      const succ = succId ? ledger.decisions.get(succId) : undefined;
      if (succ?.status === "accepted" && pageOf(succ) === succ.ref.revision) referenced.set(succ.ref.id, succ.ref);
    }
    let observed: Sha256 | null = null;
    try {
      const b = readInside(guildDir, path.join(guildDir, pin.path));
      observed = b ? sha(b) : null;
    } catch {
      observed = null;
    }
    const reasons: string[] = stale.map((s) => `${s.pinned.id}: ${s.reason}${s.superseded_by ? ` by ${s.superseded_by.id}` : ""}`);
    const drift = observed !== pin.dependent.revision;
    if (drift) reasons.push(observed === null ? "dependent file is missing" : "dependent bytes changed since the pin; the pin was not updated");
    let state: DependentState;
    if (pin.dependent_kind === "plan") state = stale.length || drift ? "replan_required" : "current";
    else state = stale.length ? "stale" : drift ? "unknown" : "current";
    dependents.push({ dependent: pin.dependent, dependent_kind: pin.dependent_kind, path: pin.path, pinned: pin.decisions, state, observed_revision: observed, stale_decisions: stale, reasons });
  }
  const memory = dependents.filter((d) => d.dependent_kind !== "plan");
  const memStale = memory.filter((d) => d.state === "stale").map((d) => d.dependent);
  const memUnknown = memory.filter((d) => d.state === "unknown").map((d) => d.dependent);
  const byId = (a: EntityRef, b: EntityRef) => a.id.localeCompare(b.id);
  return {
    schema_version: DECISION_PROPAGATION_SCHEMA,
    owner_source_id: ownerSourceId(guildDir),
    ledger_head: ledger.head,
    generated_at: now,
    decision_refs: [...referenced.values()].sort(byId),
    replan_required: dependents.filter((d) => d.state === "replan_required").map((d) => d.dependent).sort(byId),
    project_memory: { state: memUnknown.length ? "unknown" : memStale.length ? "stale" : "current_for_basis", stale: memStale.sort(byId), unknown: memUnknown.sort(byId) },
    dependents: dependents.sort((a, b) => byId(a.dependent, b.dependent)),
  };
}

/**
 * Recompute dependent state from the ledger and pins and record it in the owner's
 * `propagation.json`. Never edits a dependent, a decision page or a pin.
 */
export function propagateDecisions(input: { guildDir: string; now?: string; write?: boolean }): PropagationResult {
  const guildDir = path.resolve(input.guildDir);
  const now = input.now ?? new Date().toISOString();
  try {
    if (input.write === false) return { status: "ok", report: computeReport(guildDir, now), written: false };
    return withLock(guildDir, () => {
      const report = computeReport(guildDir, now);
      writeInside(guildDir, path.join(decisionsHome(guildDir), "propagation.json"), JSON.stringify(report, null, 2) + "\n");
      return { status: "ok" as const, report, written: true };
    });
  } catch (err) {
    if (err instanceof DecisionLedgerError) return { status: "refused", reason: "ledger_corrupt", detail: err.message };
    throw err;
  }
}

/** What a C13 publication carries for decisions; part of the generation identity. */
export interface DecisionPublicationRefs {
  decision_refs: EntityRef[];
  replan_required: EntityRef[];
  project_memory: { state: "current_for_basis" | "stale" | "unknown"; reason: string | null; digest: Sha256 };
}

/**
 * The C13 decision fields for the owner holding `guildDir`, or null when it has
 * no ledger and no pins. Throws `DecisionLedgerError` when they cannot be read or
 * exceed the C13 cap: a publication must not claim "no replan" it cannot prove.
 */
export function decisionPublicationRefs(guildDir: string, now?: string): DecisionPublicationRefs | null {
  const home = decisionsHome(guildDir);
  if (!fs.existsSync(path.join(home, "events")) && !fs.existsSync(path.join(home, "pins"))) return null;
  const r = computeReport(path.resolve(guildDir), now ?? new Date().toISOString());
  if (r.decision_refs.length > C13_ENTITY_CAP || r.replan_required.length > C13_ENTITY_CAP) {
    throw new DecisionLedgerError(`decision refs exceed the C13 cap of ${C13_ENTITY_CAP}`);
  }
  const memStateReason =
    r.project_memory.state === "stale"
      ? `pinned decisions superseded or changed: ${r.project_memory.stale.map((e) => e.id).join(", ")}`.slice(0, 4096)
      : r.project_memory.state === "unknown"
        ? `memory changed since its pin: ${r.project_memory.unknown.map((e) => e.id).join(", ")}`.slice(0, 4096)
        : null;
  return {
    decision_refs: r.decision_refs,
    replan_required: r.replan_required,
    project_memory: {
      state: r.project_memory.state,
      reason: memStateReason,
      // Every dependent binding (its revision, pinned decisions and state) is in the digest.
      digest: sha(canonicalJson(r.dependents.map((d) => [d.dependent, d.state, d.pinned]))),
    },
  };
}

// ── candidates ────────────────────────────────────────────────────────────────

export interface CandidateEntry {
  candidate: EntityRef;
  decision_id: string | null;
  /** Relative to the owner `.guild/`. */
  path: string;
  state: "pending_human_ingest" | "missing";
  promotion_gate: "guild:wiki-ingest";
  /** Canonical pages elsewhere with the same decision id, read through, never copied. */
  conflicts: EntityRef[];
  /** For a `missing` entry: the ledger seq when it was last seen listed. */
  listed_at_seq?: number;
}

export interface CandidateManifest {
  schema_version: typeof DECISION_CANDIDATES_SCHEMA;
  owner_source_id: string;
  autopromote: boolean;
  generated_at: string;
  /** Ledger head when this manifest was built; only a later acceptance explains a vanished candidate. */
  ledger_seq: number;
  candidates: CandidateEntry[];
}

function candidateDir(guildDir: string): string {
  return path.join(guildDir, "knowledge", "candidates", "decisions");
}

function canonicalPageRef(root: string, decisionId: string): EntityRef | null {
  const slug = decisionId.startsWith("decision:") ? decisionId.slice("decision:".length) : null;
  if (!slug || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(slug)) return null;
  const wiki = path.join(root, "wiki");
  let b: Buffer | null = null;
  try {
    b = readInside(wiki, path.join(wiki, "decisions", `${slug}.md`));
  } catch {
    return null;
  }
  if (!b) return null;
  const fm = parseFrontmatter(b.toString("utf8"));
  if (fm?.["status"] !== "canonical") return null;
  return { source_id: ownerSourceId(root), kind: "decision", id: decisionId, revision: sha(b) };
}

/**
 * Publish this owner's staged decision candidates by reference. Writes only the
 * owner's `knowledge/candidates/manifest.json`; `conflictRoots` (an umbrella, a
 * sibling) are read for same-id canonical pages and never written. A candidate the
 * previous manifest listed that is gone without an accepted decision stays listed
 * as `missing`: disappearance is reported, never absorbed.
 */
export function publishDecisionCandidates(input: { guildDir: string; autopromote: boolean; conflictRoots?: readonly string[]; now?: string }): { status: "ok"; manifest: CandidateManifest; missing: string[] } | Refusal<"scope" | "ledger_corrupt"> {
  const guildDir = path.resolve(input.guildDir);
  for (const r of input.conflictRoots ?? []) {
    if (isWithin(path.resolve(r), guildDir) || isWithin(guildDir, path.resolve(r))) {
      return { status: "refused", reason: "scope", detail: `conflict root ${r} overlaps the owner root` };
    }
  }
  const owner = ownerSourceId(guildDir);
  const dir = candidateDir(guildDir);
  const entries: CandidateEntry[] = [];
  try {
    const c = checkContained(guildDir, dir, { policy: "physical" });
    if (isRefused(c) && !absent(c.code)) return { status: "refused", reason: "scope", detail: `candidates dir: ${c.code}` };
    const names = !isRefused(c) && fs.existsSync(c.realPath) ? fs.readdirSync(c.realPath).filter((n) => n.endsWith(".md")).sort() : [];
    for (const n of names) {
      const abs = path.join(dir, n);
      const b = readInside(guildDir, abs);
      if (!b) continue;
      const fm = parseFrontmatter(b.toString("utf8"));
      const decisionId = typeof fm?.["id"] === "string" && ENTITY_ID.test(fm["id"] as string) ? (fm["id"] as string) : null;
      const stem = n.slice(0, -3);
      const candId = `candidate:${stem}`.slice(0, 128);
      const conflicts: EntityRef[] = [];
      if (decisionId) {
        const own = canonicalPageRef(guildDir, decisionId);
        if (own) conflicts.push(own);
        for (const r of input.conflictRoots ?? []) {
          const other = canonicalPageRef(path.resolve(r), decisionId);
          if (other) conflicts.push(other);
        }
      }
      entries.push({
        candidate: { source_id: owner, kind: "candidate", id: ENTITY_ID.test(candId) ? candId : `candidate:${sha(stem).slice(7, 39)}`, revision: sha(b) },
        decision_id: decisionId,
        path: rel(guildDir, abs),
        state: "pending_human_ingest",
        promotion_gate: "guild:wiki-ingest",
        conflicts,
      });
    }
    const manifestPath = path.join(guildDir, "knowledge", "candidates", "manifest.json");
    const prevBytes = readInside(guildDir, manifestPath);
    const missing: string[] = [];
    const ledger = readDecisionLedger(guildDir);
    if (prevBytes) {
      const prev = JSON.parse(prevBytes.toString("utf8")) as CandidateManifest;
      const since = typeof prev.ledger_seq === "number" ? prev.ledger_seq : Number.MAX_SAFE_INTEGER;
      const present = new Set(entries.map((e) => e.path));
      for (const p of prev.candidates ?? []) {
        if (present.has(p.path)) continue;
        // Explained only by an acceptance of that id recorded after the candidate was listed
        // (a `missing` entry carries forward the seq of the manifest that first listed it).
        // Explained only by an acceptance that names THIS candidate's path and revision.
        const listedAt = p.state === "missing" && typeof p.listed_at_seq === "number" ? p.listed_at_seq : since;
        const promoted = ledger.events.some((e) => e.from_candidate?.path === p.path && e.from_candidate.revision === p.candidate.revision);
        if (promoted) continue;
        entries.push({ ...p, state: "missing", listed_at_seq: listedAt });
        missing.push(p.path);
      }
    }
    const manifest: CandidateManifest = {
      schema_version: DECISION_CANDIDATES_SCHEMA,
      owner_source_id: owner,
      autopromote: input.autopromote,
      generated_at: input.now ?? new Date().toISOString(),
      ledger_seq: ledger.head?.seq ?? 0,
      candidates: entries.sort((a, b) => a.path.localeCompare(b.path)),
    };
    writeInside(guildDir, manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return { status: "ok", manifest, missing };
  } catch (err) {
    if (err instanceof DecisionLedgerError || err instanceof SyntaxError) return { status: "refused", reason: "ledger_corrupt", detail: (err as Error).message };
    throw err;
  }
}

/**
 * Workspace read-through over children's candidate manifests. Reads only; the
 * result carries references, never candidate bodies, and nothing is written. With
 * `workspaceGuildDir`, each candidate also lists the workspace's same-id canonical
 * page as a conflict, read at query time.
 */
export function federatedCandidateView(
  children: ReadonlyArray<{ name: string; guildDir: string }>,
  opts: { workspaceGuildDir?: string } = {},
): Array<{ child: string; manifest: CandidateManifest | null; error: string | null }> {
  return children.map((ch) => {
    try {
      const b = readInside(ch.guildDir, path.join(ch.guildDir, "knowledge", "candidates", "manifest.json"));
      const manifest = b ? (JSON.parse(b.toString("utf8")) as CandidateManifest) : null;
      if (manifest && opts.workspaceGuildDir) {
        const ws = path.resolve(opts.workspaceGuildDir);
        for (const c of manifest.candidates) {
          const ref = c.decision_id ? canonicalPageRef(ws, c.decision_id) : null;
          if (ref && !c.conflicts.some((x) => x.source_id === ref.source_id && x.revision === ref.revision)) c.conflicts.push(ref);
        }
      }
      return { child: ch.name, manifest, error: null };
    } catch (err) {
      return { child: ch.name, manifest: null, error: (err as Error).message };
    }
  });
}
