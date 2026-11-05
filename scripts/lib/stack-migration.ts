/**
 * scripts/lib/stack-migration.ts — package A03: reversible Guild Stack v1→v2
 * migration tooling (MG1 inventory, backup/checkpoint, reader-first activation,
 * capability rollback, old-writer fencing).
 *
 * Invariants:
 *  - `inventory` / `planMigration` are pure reads: zero writes anywhere.
 *  - Originals (v1 runs, legacy analysis, knowledge exports) are never rewritten.
 *    Every write lands under `<root>/migrations/guild-stack-v2/`.
 *  - Writer activation waits for the A04 reader checkpoint plus the V01/D01/Z01
 *    package gates; rollback hides v2 capabilities and never deletes or
 *    down-converts v2 evidence.
 *  - Nothing here activates a producer: the tool only records capability state
 *    that future writers must consult through `admitWriter`.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";

/** sha256 of the frozen A02 `contracts/guild-stack/v2/contract-bundle.json` bytes (freeze.json). */
export const FROZEN_V2_BUNDLE_SHA256 =
  "sha256:05833d374acb729cad021bb7a54141d67f1429fcaaca112b6fa29a10d3ec7d94";
export const MIGRATION_HOME = "migrations/guild-stack-v2";
export const REQUIRED_ACTIVATION_GATES = ["V01", "D01", "Z01"] as const;

export type SourceKind = "v1_run" | "legacy_v1_analysis" | "legacy_knowledge_export";
export type RunState = "open" | "closed" | "archived" | "other";

export interface FileHash {
  path: string;
  sha256: string;
  bytes: number;
}

export interface Source {
  key: string;
  kind: SourceKind;
  state: RunState | null;
  run_id: string | null;
  files: FileHash[];
}

export interface Inventory {
  schema_version: "guild.stack.migration_inventory.v1";
  sources: Source[];
  v2_records: string[];
  v2_run_ids: string[];
  v1_run_ids: string[];
  open_v1_runs: string[];
}

export interface Consumer {
  name: string;
  protocol_majors: number[];
}

export type Disposition =
  | "finish_on_v1_or_link"
  | "retain_immutable_visible_as_v1"
  | "visible_with_v1_semantics_label"
  | "retain_for_k01_k04_rebuild";

export interface PlanAction {
  source_key: string;
  kind: SourceKind;
  disposition: Disposition;
  source_sha256: string;
  projection_path: string;
  checkpoint_path: string;
  writes_to_source: false;
}

export interface MigrationPlan {
  schema_version: "guild.stack.migration_plan.v1";
  contract_bundle_sha256: string;
  inventory_sha256: string;
  plan_id: string;
  canonical_writes: 0;
  consumers: Consumer[];
  open_v1_runs: string[];
  v2_records: string[];
  actions: PlanAction[];
  activation_order: string[];
}

export interface Refusal {
  code: string;
  message: string;
}

export interface CapabilityState {
  schema_version: "guild.stack.migration_capability.v1";
  plan_id: string;
  v2_read: boolean;
  v2_write: boolean;
  v2_write_ever_activated: boolean;
  run_links: RunLink[];
  reader_versions: Record<string, string> | null;
  reader_checkpoint_sha256: string | null;
  gate_receipts: Record<string, string>;
}

/** An open v1 run continues as a distinct v2 run; the v1 identity is never reused. */
export interface RunLink {
  v1_run_id: string;
  v2_run_id: string;
}

export interface TransitionResult {
  status: "activated" | "rolled_back" | "refused";
  capability: CapabilityState;
  refusal?: Refusal;
}

export class MigrationRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function sha256(buf: Buffer | string): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

function toPosix(rel: string): string {
  return rel.split(path.sep).join("/");
}

function listFiles(root: string, rel: string): string[] {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(toPosix(path.relative(root, p)));
    }
  };
  if (fs.lstatSync(abs).isDirectory()) walk(abs);
  else out.push(toPosix(rel));
  return out;
}

function hashFile(root: string, rel: string): FileHash {
  const buf = fs.readFileSync(path.join(root, rel));
  return { path: rel, sha256: sha256(buf), bytes: buf.length };
}

function sourceDigest(source: Source): string {
  return sha256(canonical(source.files));
}

function readRunYaml(root: string, rel: string): { schema: string | null; status: string | null } {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, rel), "utf8")) as Record<string, unknown> | null;
    return {
      schema: typeof doc?.schema_version === "string" ? doc.schema_version : null,
      status: typeof doc?.status === "string" ? doc.status : null,
    };
  } catch {
    return { schema: null, status: null };
  }
}

function isV2RecordPath(rel: string): boolean {
  return /^analysis\/(runs|comparisons)\/[^/]+\/(versions\/|current\.v2\.json$)/.test(rel);
}

function sourceSlug(key: string): string {
  return `${key.replace(/[^A-Za-z0-9._-]+/g, "__")}-${sha256(key).slice(0, 8)}`;
}

/** One file per (source, source-digest) generation, so a drained open run gets a successor, not an overwrite. */
function generationPath(area: "projections" | "checkpoints", key: string, digest: string): string {
  return `${MIGRATION_HOME}/${area}/${sourceSlug(key)}/${digest.slice(0, 16)}.json`;
}

/** A run id is one plain path component; aliases such as `../runs/x` are refused, never normalized. */
export function isCanonicalRunId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id) && !id.includes("..");
}

/** True when any run-identity location for `id` is (or sits under) a symlink inside the root. */
function hasRunPathAlias(root: string, id: string): boolean {
  for (const rel of ["runs", `runs/${id}`, "runs/_archive", `runs/_archive/${id}`, "analysis", "analysis/runs", `analysis/runs/${id}`]) {
    try {
      if (fs.lstatSync(path.join(root, ...rel.split("/"))).isSymbolicLink()) return true;
    } catch {
      // absent location: no alias
    }
  }
  return false;
}

/** Identity key: case-folded, because case variants name one directory on case-insensitive volumes. */
const fold = (id: string): string => id.toLowerCase();
const foldedHas = (ids: string[], id: string): boolean => ids.some((x) => fold(x) === fold(id));

function dispositionFor(source: Source): Disposition {
  if (source.kind === "v1_run") return source.state === "open" ? "finish_on_v1_or_link" : "retain_immutable_visible_as_v1";
  if (source.kind === "legacy_v1_analysis") return "visible_with_v1_semantics_label";
  return "retain_for_k01_k04_rebuild";
}

// ---------------------------------------------------------------------------
// MG1 — read-only inventory and dry-run plan
// ---------------------------------------------------------------------------

export function inventory(root: string): Inventory {
  const sources: Source[] = [];
  const v2Records: string[] = [];
  const v2RunIds: string[] = [];

  const runDirs = (base: string, archived: boolean): void => {
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs).sort()) {
      if (!archived && name === "_archive") continue;
      const rel = `${base}/${name}`;
      if (!fs.lstatSync(path.join(root, rel)).isDirectory()) continue;
      const runYaml = `${rel}/run.yaml`;
      if (!fs.existsSync(path.join(root, runYaml))) continue;
      const { schema, status } = readRunYaml(root, runYaml);
      if (schema !== null && schema !== "guild.run.v1") {
        v2Records.push(runYaml);
        v2RunIds.push(name);
        continue;
      }
      const state: RunState = archived ? "archived" : status === "open" ? "open" : status === "closed" ? "closed" : "other";
      sources.push({ key: rel, kind: "v1_run", state, run_id: name, files: listFiles(root, rel).map((f) => hashFile(root, f)) });
    }
  };
  runDirs("runs", false);
  runDirs("runs/_archive", true);

  for (const rel of listFiles(root, "analysis")) {
    if (isV2RecordPath(rel)) {
      v2Records.push(rel);
      const m = /^analysis\/runs\/([^/]+)\//.exec(rel);
      if (m && !v2RunIds.includes(m[1])) v2RunIds.push(m[1]);
      continue;
    }
    if (/^analysis\/runs\/[^/]+\/analysis\.json$/.test(rel) || /^analysis\/comparisons\/[^/]+\/comparison\.json$/.test(rel)) {
      sources.push({ key: rel, kind: "legacy_v1_analysis", state: null, run_id: null, files: [hashFile(root, rel)] });
    }
  }
  for (const rel of listFiles(root, "knowledge")) {
    sources.push({ key: rel, kind: "legacy_knowledge_export", state: null, run_id: null, files: [hashFile(root, rel)] });
  }

  sources.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    schema_version: "guild.stack.migration_inventory.v1",
    sources,
    v2_records: v2Records.sort(),
    v2_run_ids: v2RunIds.sort(),
    v1_run_ids: sources.filter((s) => s.kind === "v1_run").map((s) => s.run_id as string).sort(),
    open_v1_runs: sources.filter((s) => s.kind === "v1_run" && s.state === "open").map((s) => s.run_id as string),
  };
}

export function planMigration(root: string, opts: { consumers: Consumer[] }): MigrationPlan {
  const inv = inventory(root);
  const consumers = [...opts.consumers]
    .map((c) => ({ name: c.name, protocol_majors: [...new Set(c.protocol_majors)].sort() }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
  const actions: PlanAction[] = inv.sources.map((s) => {
    const digest = sourceDigest(s);
    return {
      source_key: s.key,
      kind: s.kind,
      disposition: dispositionFor(s),
      source_sha256: digest,
      projection_path: generationPath("projections", s.key, digest),
      checkpoint_path: generationPath("checkpoints", s.key, digest),
      writes_to_source: false,
    };
  });
  const inventorySha = sha256(canonical(inv));
  return {
    schema_version: "guild.stack.migration_plan.v1",
    contract_bundle_sha256: FROZEN_V2_BUNDLE_SHA256,
    inventory_sha256: inventorySha,
    plan_id: `mig-${sha256(canonical({ inventorySha, consumers })).slice(0, 16)}`,
    canonical_writes: 0,
    consumers,
    open_v1_runs: inv.open_v1_runs,
    v2_records: inv.v2_records,
    actions,
    activation_order: [
      "apply: backup manifest + per-source checkpoints (originals untouched)",
      "activate-readers: A04 reader checkpoint, exact reader versions",
      "activate-writers: V01/D01/Z01 gates passed, all consumers v2-capable, open v1 runs drained or linked to new v2 run ids",
      "rollback: hide v2 read/write capabilities; v2 evidence retained",
    ],
  };
}

// ---------------------------------------------------------------------------
// Contained writes — every write is under MIGRATION_HOME, no symlinked component
// ---------------------------------------------------------------------------

const HOME_REL = new RegExp(`^${MIGRATION_HOME.replace(/[/.-]/g, "\\$&")}/[A-Za-z0-9._/-]+$`);

/** Resolve a home-relative path, refusing traversal and any symlinked component below `root`. */
function homePath(root: string, rel: string): string {
  if (!HOME_REL.test(rel) || rel.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new MigrationRefused("path_outside_migration_home", rel);
  }
  let cur = root;
  for (const seg of rel.split("/")) {
    cur = path.join(cur, seg);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      break;
    }
    if (st.isSymbolicLink()) throw new MigrationRefused("symlink_in_migration_home", rel);
  }
  return path.join(root, ...rel.split("/"));
}

function ensureDir(root: string, relDir: string): void {
  let cur = root;
  for (const seg of relDir.split("/")) {
    cur = path.join(cur, seg);
    if (!fs.existsSync(cur)) fs.mkdirSync(cur);
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new MigrationRefused("symlink_in_migration_home", relDir);
  }
}

const NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

function writeHome(root: string, rel: string, body: string | Buffer): void {
  const file = homePath(root, rel);
  ensureDir(root, rel.split("/").slice(0, -1).join("/"));
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NOFOLLOW, 0o644);
  try {
    fs.writeSync(fd, typeof body === "string" ? Buffer.from(body) : body);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** Append by atomic replace: rename swaps the directory entry, so a hard-linked journal never writes through. */
function appendHome(root: string, rel: string, line: string): void {
  const existing = readHome(root, rel);
  writeHome(root, rel, Buffer.concat([existing ?? Buffer.alloc(0), Buffer.from(line)]));
}

function writeHomeJson(root: string, rel: string, value: unknown): void {
  writeHome(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function readHome(root: string, rel: string): Buffer | null {
  const file = homePath(root, rel);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function readHomeJson<T>(root: string, rel: string): T | null {
  const buf = readHome(root, rel);
  if (buf === null) return null;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    throw new MigrationRefused("migration_state_corrupt", rel);
  }
}

const H = (...parts: string[]): string => [MIGRATION_HOME, ...parts].join("/");

// ---------------------------------------------------------------------------
// Apply — backup + per-source checkpoints, restart-idempotent
// ---------------------------------------------------------------------------

interface Checkpoint {
  schema_version: "guild.stack.migration_checkpoint.v1";
  source_key: string;
  kind: SourceKind;
  state: RunState | null;
  source_sha256: string;
  files: FileHash[];
  backup_verified: true;
  projection_path: string;
}

export interface ApplyResult {
  status: "complete";
  plan_id: string;
  applied_checkpoints: number;
  skipped_checkpoints: number;
  repaired_outputs: number;
}

function projectionFor(source: Source, action: PlanAction): string {
  return `${JSON.stringify(
    {
      schema_version: "guild.stack.migration_projection.v1",
      semantics: "v1_legacy",
      source_key: source.key,
      kind: source.kind,
      state: source.state,
      run_id: source.run_id,
      disposition: action.disposition,
      source_sha256: action.source_sha256,
      files: source.files,
    },
    null,
    2,
  )}\n`;
}

function checkpointFor(source: Source, action: PlanAction): Checkpoint {
  return {
    schema_version: "guild.stack.migration_checkpoint.v1",
    source_key: source.key,
    kind: source.kind,
    state: source.state,
    source_sha256: action.source_sha256,
    files: source.files,
    backup_verified: true,
    projection_path: action.projection_path,
  };
}

/** Write or repair the blobs and projection of one generation; returns how many outputs were (re)written. */
function ensureOutputs(root: string, source: Source, action: PlanAction): number {
  let written = 0;
  for (const f of source.files) {
    const rel = H("backup", "blobs", f.sha256);
    const existing = readHome(root, rel);
    if (existing === null || sha256(existing) !== f.sha256) {
      writeHome(root, rel, fs.readFileSync(path.join(root, f.path)));
      written++;
    }
    const blob = readHome(root, rel);
    if (blob === null || sha256(blob) !== f.sha256) {
      throw new MigrationRefused("backup_hash_mismatch", `backup blob for ${f.path} does not verify`);
    }
  }
  const projection = projectionFor(source, action);
  const current = readHome(root, action.projection_path);
  if (current === null || current.toString("utf8") !== projection) {
    writeHome(root, action.projection_path, projection);
    written++;
  }
  return written;
}

/** Prior generations of a source. A successor is legal only when every prior generation was an open v1 run. */
function priorGenerations(root: string, action: PlanAction): Checkpoint[] {
  const dirRel = action.checkpoint_path.split("/").slice(0, -1).join("/");
  const dir = homePath(root, dirRel);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json") && `${dirRel}/${n}` !== action.checkpoint_path)
    .sort()
    .map((n) => readHomeJson<Checkpoint>(root, `${dirRel}/${n}`) as Checkpoint);
}

function retainedCheckpointKeys(root: string): string[] {
  const dir = homePath(root, H("checkpoints"));
  if (!fs.existsSync(dir)) return [];
  const keys = new Set<string>();
  for (const slug of fs.readdirSync(dir).sort()) {
    const slugRel = H("checkpoints", slug);
    homePath(root, slugRel);
    for (const n of fs.readdirSync(path.join(dir, slug)).filter((x) => x.endsWith(".json")).sort()) {
      const cp = readHomeJson<Checkpoint>(root, `${slugRel}/${n}`);
      if (!cp || typeof cp.source_key !== "string") throw new MigrationRefused("migration_state_corrupt", `${slugRel}/${n}`);
      keys.add(cp.source_key);
    }
  }
  return [...keys];
}

export function applyMigration(root: string, plan: MigrationPlan, opts: { failAfterSources?: number; failBeforePlanPublish?: boolean; failBeforeCheckpoint?: boolean } = {}): ApplyResult {
  // Destinations are derived, never trusted: a plan that differs from a fresh
  // plan over the same consumers (stale bytes or edited paths) is refused before any write.
  const fresh = planMigration(root, { consumers: plan.consumers });
  if (canonical(fresh) !== canonical(plan)) {
    throw new MigrationRefused("source_changed_since_plan", "sources or plan fields differ from a fresh plan; re-plan");
  }
  const byKey = new Map(inventory(root).sources.map((s) => [s.key, s]));
  const previous = readHomeJson<MigrationPlan>(root, H("plan.json"));
  const state = readHomeJson<CapabilityState>(root, H("capability.json"));
  if (previous) {
    if (!state) throw new MigrationRefused("capability_state_missing", "established migration has no capability state; refusing (fail closed)");
    if ((state.v2_read || state.v2_write) && canonical(previous.consumers) !== canonical(plan.consumers)) {
      throw new MigrationRefused("capabilities_active_consumers_changed", "roll back v2 capabilities before changing consumers");
    }
  } else if (state && canonical({ ...state, plan_id: "none" }) !== canonical(initialCapability("none"))) {
    // An initial-only capability is a first apply interrupted before plan publication: resumable.
    throw new MigrationRefused("migration_state_corrupt", "advanced capability state exists without an applied plan");
  }
  // Capability state is published before the plan, so an established plan always has capability state.
  if (!state) commit(root, "apply", initialCapability(plan.plan_id));
  // Every source a prior (possibly interrupted) apply committed to must still exist: retained
  // checkpoints plus the pending plan published before any output was written.
  const pending = readHomeJson<MigrationPlan>(root, H("pending-plan.json"));
  const committed = [...retainedCheckpointKeys(root), ...(pending?.actions ?? []).map((a) => a.source_key), ...(previous?.actions ?? []).map((a) => a.source_key)];
  const gone = [...new Set(committed)].filter((key) => !byKey.has(key)).sort();
  if (gone.length > 0) throw new MigrationRefused("source_disappeared", `checkpointed originals are gone: ${gone.join(", ")}`);
  writeHomeJson(root, H("pending-plan.json"), plan);
  let applied = 0;
  let skipped = 0;
  let repaired = 0;

  for (const action of plan.actions) {
    const source = byKey.get(action.source_key) as Source;
    for (const prior of priorGenerations(root, action)) {
      if (prior.source_key !== source.key || prior.state !== "open" || source.kind !== "v1_run") {
        throw new MigrationRefused(
          "source_changed_since_checkpoint",
          `${action.source_key} changed after an immutable checkpoint (state ${String(prior.state)})`,
        );
      }
    }
    const expected = checkpointFor(source, action);
    const existing = readHomeJson<Checkpoint>(root, action.checkpoint_path);
    if (existing) {
      if (canonical(existing) !== canonical(expected)) {
        throw new MigrationRefused("checkpoint_mismatch", `${action.checkpoint_path} does not describe the current source`);
      }
      repaired += ensureOutputs(root, source, action);
      skipped++;
      continue;
    }
    ensureOutputs(root, source, action);
    if (opts.failBeforeCheckpoint) throw new Error("injected fault before checkpoint publication");
    writeHomeJson(root, action.checkpoint_path, expected);
    applied++;
    if (opts.failAfterSources !== undefined && applied >= opts.failAfterSources && applied < plan.actions.length) {
      throw new Error(`injected fault after ${applied} source checkpoints`);
    }
  }

  writeHomeJson(root, H("backup", "manifest.json"), {
    schema_version: "guild.stack.migration_backup_manifest.v1",
    plan_id: plan.plan_id,
    hash_algorithm: "sha256-raw-file-bytes",
    files: plan.actions.flatMap((a) => (byKey.get(a.source_key) as Source).files).sort((a, b) => (a.path < b.path ? -1 : 1)),
  });
  if (opts.failBeforePlanPublish) throw new Error("injected fault before plan publication");
  writeHomeJson(root, H("plans", `${plan.plan_id}.json`), plan);
  writeHomeJson(root, H("plan.json"), plan);
  const latest = readHomeJson<CapabilityState>(root, H("capability.json")) as CapabilityState;
  if (latest.plan_id !== plan.plan_id) commit(root, "apply", { ...latest, plan_id: plan.plan_id });
  return { status: "complete", plan_id: plan.plan_id, applied_checkpoints: applied, skipped_checkpoints: skipped, repaired_outputs: repaired };
}

export function verifyBackup(root: string): { ok: boolean; mismatches: string[] } {
  const manifest = readHomeJson<{ schema_version?: string; plan_id?: string; files?: FileHash[] }>(root, H("backup", "manifest.json"));
  const plan = readHomeJson<MigrationPlan>(root, H("plan.json"));
  if (!manifest || !plan) return { ok: false, mismatches: ["backup manifest or applied plan missing"] };
  if (manifest.schema_version !== "guild.stack.migration_backup_manifest.v1" || manifest.plan_id !== plan.plan_id || !Array.isArray(manifest.files)) {
    return { ok: false, mismatches: ["backup manifest is not bound to the applied plan"] };
  }
  const required: FileHash[] = [];
  for (const action of plan.actions) {
    const cp = readHomeJson<Checkpoint>(root, action.checkpoint_path);
    if (!cp || cp.source_key !== action.source_key || cp.source_sha256 !== action.source_sha256) {
      return { ok: false, mismatches: [`checkpoint:${action.source_key}`] };
    }
    required.push(...cp.files);
  }
  required.sort((a, b) => (a.path < b.path ? -1 : 1));
  if (canonical(required) !== canonical(manifest.files)) return { ok: false, mismatches: ["backup manifest does not cover the checkpointed files exactly"] };
  const mismatches: string[] = [];
  for (const f of manifest.files) {
    const blob = readHome(root, H("backup", "blobs", f.sha256));
    if (blob === null || sha256(blob) !== f.sha256) mismatches.push(`backup:${f.path}`);
    const original = path.join(root, f.path);
    if (!fs.existsSync(original) || sha256(fs.readFileSync(original)) !== f.sha256) mismatches.push(`original:${f.path}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------
// Capability transitions
// ---------------------------------------------------------------------------

function initialCapability(planId: string): CapabilityState {
  return {
    schema_version: "guild.stack.migration_capability.v1",
    plan_id: planId,
    v2_read: false,
    v2_write: false,
    v2_write_ever_activated: false,
    run_links: [],
    reader_versions: null,
    reader_checkpoint_sha256: null,
    gate_receipts: {},
  };
}

function commit(root: string, event: string, state: CapabilityState): void {
  homePath(root, H("journal.jsonl")); // refuse a symlinked journal before capability state changes
  writeHomeJson(root, H("capability.json"), state);
  appendHome(root, H("journal.jsonl"), `${canonical({ event, capability: state })}\n`);
}

function refuse(state: CapabilityState, code: string, message: string): TransitionResult {
  return { status: "refused", capability: state, refusal: { code, message } };
}

function guarded(fn: () => TransitionResult): TransitionResult {
  try {
    return fn();
  } catch (error) {
    if (error instanceof MigrationRefused) return refuse(initialCapability("none"), error.code, error.message);
    throw error;
  }
}

/** Every transition re-proves: applied plan still matches the sources, outputs exist and verify. */
function preflight(root: string): { state: CapabilityState; plan: MigrationPlan } | { refusal: TransitionResult } {
  const state = readHomeJson<CapabilityState>(root, H("capability.json"));
  const plan = readHomeJson<MigrationPlan>(root, H("plan.json"));
  if (!state || !plan) return { refusal: refuse(initialCapability("none"), "migration_not_applied", "run apply before any activation") };
  const fresh = planMigration(root, { consumers: plan.consumers });
  if (canonical(fresh) !== canonical(plan)) {
    const planned = new Map(plan.actions.map((a) => [a.source_key, a]));
    const immutableChanged = fresh.actions.some((a) => {
      const was = planned.get(a.source_key);
      return was !== undefined && was.source_sha256 !== a.source_sha256 && was.disposition !== "finish_on_v1_or_link";
    });
    const gone = plan.actions.some((a) => !fresh.actions.some((f) => f.source_key === a.source_key));
    return {
      refusal: immutableChanged || gone
        ? refuse(state, "backup_verification_failed", "an immutable original changed or disappeared since apply")
        : refuse(state, "reapply_required", "open v1 runs progressed or new v1 sources appeared; re-run apply"),
    };
  }
  const byKey = new Map(inventory(root).sources.map((s) => [s.key, s]));
  for (const action of plan.actions) {
    const source = byKey.get(action.source_key) as Source;
    const cp = readHomeJson<Checkpoint>(root, action.checkpoint_path);
    const projection = readHome(root, action.projection_path);
    if (!cp || canonical(cp) !== canonical(checkpointFor(source, action)) || projection?.toString("utf8") !== projectionFor(source, action)) {
      return { refusal: refuse(state, "migration_outputs_incomplete", `${action.source_key}: checkpoint or projection missing; re-run apply`) };
    }
  }
  const backup = verifyBackup(root);
  if (!backup.ok) return { refusal: refuse(state, "backup_verification_failed", backup.mismatches.join(", ")) };
  return { state, plan };
}

function readReceipt(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function activateReaders(
  root: string,
  opts: { readerCheckpointPath: string; expectedReaderVersions: Record<string, string> },
): TransitionResult {
  return guarded(() => {
    const pre = preflight(root);
    if ("refusal" in pre) return pre.refusal;
    const state = pre.state;
    const receipt = readReceipt(opts.readerCheckpointPath);
    if (
      !receipt ||
      receipt.schema_version !== "guild.stack.reader_checkpoint.v1" ||
      receipt.package !== "A04" ||
      receipt.status !== "passed"
    ) {
      return refuse(state, "reader_checkpoint_invalid", "a passed A04 guild.stack.reader_checkpoint.v1 receipt is required");
    }
    if (receipt.contract_bundle_sha256 !== FROZEN_V2_BUNDLE_SHA256) {
      return refuse(state, "contract_bundle_mismatch", "reader checkpoint was not built against the frozen v2 bundle");
    }
    const versions = (receipt.reader_versions ?? {}) as Record<string, unknown>;
    const expected = opts.expectedReaderVersions;
    if (Object.keys(expected).length === 0 || canonical(versions) !== canonical(expected)) {
      return refuse(state, "reader_version_mismatch", `expected ${canonical(expected)}, receipt has ${canonical(versions)}`);
    }
    const next: CapabilityState = {
      ...state,
      v2_read: true,
      reader_versions: { ...expected },
      reader_checkpoint_sha256: `sha256:${sha256(fs.readFileSync(opts.readerCheckpointPath))}`,
    };
    commit(root, "activate_readers", next);
    return { status: "activated", capability: next };
  });
}

export function activateWriters(
  root: string,
  opts: { gateReceipts: Record<string, string>; linkOpenRuns: RunLink[] },
): TransitionResult {
  return guarded(() => {
    const pre = preflight(root);
    if ("refusal" in pre) return pre.refusal;
    const { state, plan } = pre;
    if (!state.v2_read) return refuse(state, "readers_not_active", "reader-first: activate-readers must succeed first");
    const gates: Record<string, string> = {};
    for (const id of REQUIRED_ACTIVATION_GATES) {
      const file = opts.gateReceipts[id];
      const receipt = file ? readReceipt(file) : null;
      if (!receipt) return refuse(state, "package_gate_missing", `${id} gate receipt is required`);
      if (receipt.schema_version !== "guild.stack.package_gate.v1" || receipt.package !== id) {
        return refuse(state, "package_gate_invalid", `${id} gate receipt is not a guild.stack.package_gate.v1 receipt for ${id}`);
      }
      if (receipt.status !== "passed") return refuse(state, "package_gate_not_passed", `${id} gate status is ${String(receipt.status)}`);
      gates[id] = `sha256:${sha256(fs.readFileSync(file as string))}`;
    }
    const old = plan.consumers.filter((c) => !c.protocol_majors.includes(2));
    if (old.length > 0) {
      return refuse(state, "consumer_not_v2_capable", `v1-only consumers: ${old.map((c) => c.name).join(", ")}`);
    }
    const inv = inventory(root);
    const taken = new Set([...inv.v1_run_ids, ...inv.v2_run_ids, ...state.run_links.flatMap((l) => [l.v1_run_id, l.v2_run_id])].map(fold));
    const persisted = new Map(state.run_links.map((l) => [fold(l.v1_run_id), l.v2_run_id]));
    const links = new Map<string, string>();
    for (const link of opts.linkOpenRuns) {
      const prior = persisted.get(fold(link.v1_run_id));
      if (prior !== undefined) {
        if (prior !== link.v2_run_id) {
          return refuse(state, "invalid_run_link", `${link.v1_run_id} is already linked to ${prior}; remapping is refused`);
        }
        continue;
      }
      if (!inv.open_v1_runs.includes(link.v1_run_id) || !isCanonicalRunId(link.v1_run_id) || !isCanonicalRunId(link.v2_run_id) || hasRunPathAlias(root, link.v2_run_id) || taken.has(fold(link.v2_run_id)) || links.has(fold(link.v1_run_id))) {
        return refuse(state, "invalid_run_link", `${link.v1_run_id}=${link.v2_run_id} must link an open v1 run to a new, unused v2 run id`);
      }
      taken.add(fold(link.v2_run_id));
      links.set(fold(link.v1_run_id), link.v2_run_id);
    }
    const unresolved = inv.open_v1_runs.filter((id) => !links.has(fold(id)) && !persisted.has(fold(id)));
    if (unresolved.length > 0) {
      return refuse(state, "open_v1_run_unresolved", `drain or link open v1 runs: ${unresolved.join(", ")}`);
    }
    const next: CapabilityState = {
      ...state,
      v2_write: true,
      v2_write_ever_activated: true,
      run_links: [
        ...state.run_links,
        ...opts.linkOpenRuns.filter((l) => links.get(fold(l.v1_run_id)) === l.v2_run_id).map((l) => ({ v1_run_id: l.v1_run_id, v2_run_id: l.v2_run_id })),
      ].sort((a, b) =>
        a.v1_run_id < b.v1_run_id ? -1 : 1,
      ),
      gate_receipts: gates,
    };
    commit(root, "activate_writers", next);
    return { status: "activated", capability: next };
  });
}

export function rollback(root: string, opts: { downgradeRecords?: boolean }): TransitionResult {
  return guarded(() => {
    const state = readHomeJson<CapabilityState>(root, H("capability.json"));
    if (!state) return refuse(initialCapability("none"), "migration_not_applied", "nothing to roll back");
    if (opts.downgradeRecords) {
      return refuse(state, "downgrade_mutates_v2", "v2 records are never down-converted to v1; rollback only hides capabilities");
    }
    const next: CapabilityState = { ...state, v2_read: false, v2_write: false };
    commit(root, "rollback", next);
    return { status: "rolled_back", capability: next };
  });
}

export function admitWriter(
  root: string,
  opts: { protocolMajor: number; runId: string },
): { admitted: boolean; refusal?: Refusal } {
  const no = (code: string, message: string) => ({ admitted: false, refusal: { code, message } });
  if (!isCanonicalRunId(opts.runId)) return no("invalid_run_id", `${opts.runId} is not a single canonical run id`);
  if (hasRunPathAlias(root, opts.runId)) return no("run_path_alias", `${opts.runId} resolves through a symlink`);
  let state: CapabilityState;
  try {
    const loaded = readHomeJson<CapabilityState>(root, H("capability.json"));
    if (!loaded && fs.existsSync(path.join(root, ...MIGRATION_HOME.split("/")))) {
      return no("capability_state_missing", "migration home exists without capability state; refusing (fail closed)");
    }
    state = loaded ?? initialCapability("none");
  } catch (error) {
    if (error instanceof MigrationRefused) return no(error.code, error.message);
    throw error;
  }
  const inv = inventory(root);
  if (opts.protocolMajor === 2) {
    if (!state.v2_write) return no("v2_write_disabled", "v2 write capability is not active");
    if (foldedHas(inv.v1_run_ids, opts.runId)) return no("v1_identity_immutable", `${opts.runId} is a v1 run; continue it under its linked v2 run id`);
    return { admitted: true };
  }
  if (opts.protocolMajor !== 1) return no("unsupported_protocol", `protocol ${opts.protocolMajor}`);
  if (state.v2_write) return no("v1_writer_fenced", "v1 writers are fenced while v2 writes are active");
  const touched = foldedHas(state.run_links.flatMap((l) => [l.v1_run_id, l.v2_run_id]), opts.runId) || foldedHas(inv.v2_run_ids, opts.runId);
  if (touched) return no("run_linked_to_v2", `${opts.runId} carries v2 identity`);
  return { admitted: true };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = `Usage: bun scripts/stack-migration.ts <command> --root <guild-root> [options]

Commands:
  inventory                      read-only inventory (JSON, zero writes)
  plan --consumer name@1[,2]...  dry-run plan (JSON, zero writes)
  apply --consumer ...           backup manifest + per-source checkpoints; restartable
  verify                         re-hash backup blobs and originals
  activate-readers --reader-checkpoint <file> --reader-version name=ver...
  activate-writers --gate V01=<file> --gate D01=<file> --gate Z01=<file> [--link-open-run <v1-run-id>=<new-v2-run-id>...]
  rollback                       hide v2 read/write capabilities; v2 evidence retained
  admit --protocol <1|2> --run-id <id>
`;

interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
}

function many(argv: string[], flag: string): string[] {
  const out: string[] = [];
  argv.forEach((a, i) => {
    if (a === flag && argv[i + 1] !== undefined) out.push(argv[i + 1]);
  });
  return out;
}

function one(argv: string[], flag: string): string | undefined {
  return many(argv, flag)[0];
}

function pairs(values: string[], label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of values) {
    const i = v.indexOf("=");
    if (i <= 0) throw new MigrationRefused("bad_argument", `${label} expects key=value, got ${v}`);
    out[v.slice(0, i)] = v.slice(i + 1);
  }
  return out;
}

function consumers(argv: string[]): Consumer[] {
  return many(argv, "--consumer").map((v) => {
    const [name, majors] = v.split("@");
    const protocol_majors = (majors ?? "").split(",").map(Number);
    if (!name || protocol_majors.some((n) => !Number.isInteger(n) || n < 1)) {
      throw new MigrationRefused("bad_argument", `--consumer expects name@1[,2], got ${v}`);
    }
    return { name, protocol_majors };
  });
}

export function runCli(argv: string[], io: Io): number {
  const [command] = argv;
  if (!command || command === "--help" || command === "-h") {
    io.stdout(USAGE);
    return command ? 0 : 1;
  }
  const rootArg = one(argv, "--root");
  if (!rootArg) {
    io.stderr(`stack-migration: --root <guild-root> is required\n${USAGE}`);
    return 1;
  }
  const root = path.resolve(rootArg);
  const print = (v: unknown): void => io.stdout(`${JSON.stringify(v, null, 2)}\n`);
  try {
    let result: unknown;
    switch (command) {
      case "inventory":
        result = inventory(root);
        break;
      case "plan":
        result = planMigration(root, { consumers: consumers(argv) });
        break;
      case "apply":
        result = applyMigration(root, planMigration(root, { consumers: consumers(argv) }));
        break;
      case "verify":
        result = verifyBackup(root);
        break;
      case "activate-readers":
        result = activateReaders(root, {
          readerCheckpointPath: path.resolve(one(argv, "--reader-checkpoint") ?? ""),
          expectedReaderVersions: pairs(many(argv, "--reader-version"), "--reader-version"),
        });
        break;
      case "activate-writers":
        result = activateWriters(root, {
          gateReceipts: Object.fromEntries(
            Object.entries(pairs(many(argv, "--gate"), "--gate")).map(([k, v]) => [k, path.resolve(v)]),
          ),
          linkOpenRuns: Object.entries(pairs(many(argv, "--link-open-run"), "--link-open-run")).map(([v1_run_id, v2_run_id]) => ({
            v1_run_id,
            v2_run_id,
          })),
        });
        break;
      case "rollback":
        result = rollback(root, {});
        break;
      case "admit":
        result = admitWriter(root, { protocolMajor: Number(one(argv, "--protocol")), runId: one(argv, "--run-id") ?? "" });
        break;
      default:
        io.stderr(`stack-migration: unknown command ${command}\n${USAGE}`);
        return 1;
    }
    print(result);
    const r = result as { status?: string; ok?: boolean; admitted?: boolean };
    return r.status === "refused" || r.ok === false || r.admitted === false ? 2 : 0;
  } catch (error) {
    io.stderr(`stack-migration: REFUSED — ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
