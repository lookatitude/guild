/**
 * src/modules/teams/workflows/station-signals.ts
 *
 * G6b-1 (task-cell-runtime P0.6, ADDITIVE) — the `guild.station_signals.v1`
 * caller-supplied composition-signals contract + fail-closed validator, plus the
 * team_plan/team_result emission-to-disk helpers the G6b station wiring needs.
 *
 * G6a (`station-composer.ts`) is the deterministic composer: it takes a typed
 * `StationSignals` block and emits a `guild.team_plan.v1`. G6b-1 supplies the two
 * seams that composer left for the wiring layer:
 *
 *   1. A DURABLE, VALIDATABLE signals envelope. Signals in G6b are supplied
 *      EXPLICITLY (operator decision — no auto-inference here); this is the typed
 *      block a caller provides. G6b-2 will populate it from the spec/plan. The
 *      envelope wraps the G6a `StationSignals` fields + `schema_version` + an
 *      optional `source_ref` (which spec/plan the signals were read from).
 *
 *   2. Emission-to-disk. `writeTeamPlan` / `writeTeamResult` persist a composed
 *      plan/result to the canonical run tree (`.guild/runs/<run-id>/team-plan/…`,
 *      `.../team-result/…`), with matching readers. All four are FAIL-CLOSED: they
 *      validate through the G6a validators before writing/after reading, and refuse
 *      any path that would escape the run tree.
 *
 * Contract idioms mirror the G2 seam
 * (`scripts/lib/core/contracts/task-cell-backend.ts`) and G6a: frozen literal
 * schema strings, and validators that return the typed value or NULL — never
 * throw, never repair. Vocabulary reuse: `StationSignals`, `StationId`,
 * `TeamPlanV1`, `TeamResultV1`, and their validators are imported from G6a, never
 * re-declared. `assertWithinRunTree` is imported from G2 for containment.
 *
 * ADDITIVE: nothing here is wired to a station or a shipping path — G6b-2 wires
 * it. No existing file is edited.
 */

import * as fs from "fs";
import * as path from "path";

import { assertWithinRunTree } from "../../../../scripts/lib/core/contracts/task-cell-backend";
import {
  isStation,
  validateTeamPlanV1,
  validateTeamResultV1,
  type StationId,
  type StationSignals,
  type TeamPlanV1,
  type TeamResultV1,
} from "./station-composer";

// ── guild.station_signals.v1 ─────────────────────────────────────────────────

export const STATION_SIGNALS_SCHEMA = "guild.station_signals.v1" as const;

/**
 * The closed set of composition-signal keys — the runtime mirror of the G6a
 * `StationSignals` field list. It is the allow-list the validator checks against:
 * a signals object carrying ANY key outside this set is rejected (fail-closed —
 * an unknown signal must never silently no-op).
 *
 * The two compile-time assertions below make this list impossible to drift from
 * `StationSignals`: if G6a adds or removes a signal field, this file stops
 * compiling until the array is reconciled.
 */
export const STATION_SIGNAL_KEYS = [
  "multi_component",
  "auth_touched",
  "backend_present",
  "user_facing_ui",
  "public_docs",
  "search_discoverability",
] as const;

export type StationSignalKey = (typeof STATION_SIGNAL_KEYS)[number];

// Compile-time guard: STATION_SIGNAL_KEYS ≡ keyof StationSignals (both directions).
// Either a missing key or an extra key breaks one of these two assignments.
type _KeysCoverSignals = StationSignalKey extends keyof StationSignals ? true : never;
type _SignalsCoverKeys = keyof StationSignals extends StationSignalKey ? true : never;
const _keysCoverSignals: _KeysCoverSignals = true;
const _signalsCoverKeys: _SignalsCoverKeys = true;
void _keysCoverSignals;
void _signalsCoverKeys;

const SIGNAL_KEY_SET: ReadonlySet<string> = new Set<string>(STATION_SIGNAL_KEYS);

/**
 * A plain JSON-shaped data object: non-null, non-array, whose prototype is
 * `Object.prototype` or `null`. Rejecting any other prototype closes the
 * prototype-carried-key hole — an inherited `auth_touched: true` on
 * `Object.create({ auth_touched: true })` would otherwise slip past an
 * own-key scan (`Object.keys`/`Object.entries` see no own keys) and later be
 * read *through the prototype chain* by the G6a composer (`signals[rule.signal]`),
 * firing a rule that was never validated. Fail-closed: an exotic prototype ⇒ reject.
 */
function isPlainDataObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * `guild.station_signals.v1` — the caller-supplied composition-signals envelope.
 *
 * `signals` is the exact G6a `StationSignals` block (every field an optional
 * boolean; absent ⇒ false). `source_ref` is an optional pointer to the spec/plan
 * the signals were derived from (G6b-2 sets it; the deterministic path leaves it
 * absent). The envelope is deliberately additive around `StationSignals` so the
 * composer input surface is unchanged — `signalsOf(block)` projects it straight
 * back to what `composeStationTeam` expects.
 */
export interface StationSignalsV1 {
  schema_version: typeof STATION_SIGNALS_SCHEMA;
  signals: StationSignals;
  /** Optional provenance: which spec/plan these signals were read from. */
  source_ref?: string | null;
}

/** The all-false signals envelope — the composer input when a caller supplies none. */
export function emptyStationSignalsV1(): StationSignalsV1 {
  // NULL-prototype signals: the composer reads `signals[key]` via bracket access,
  // so an absent signal on a plain `{}` would resolve a polluted
  // `Object.prototype.<signal>` to `true`. A null prototype has no such chain.
  return { schema_version: STATION_SIGNALS_SCHEMA, signals: Object.create(null) as StationSignals };
}

/**
 * Project a validated envelope back to the plain `StationSignals` block the G6a
 * `composeStationTeam` reads. Absent signals stay absent (the composer treats
 * `!== true` as false), so this is a straight pass-through of `.signals`.
 */
export function signalsOf(block: StationSignalsV1): StationSignals {
  return block.signals;
}

/**
 * Fail-closed validation of a `guild.station_signals.v1` envelope. Returns the
 * typed block or NULL — never throws, never repairs. Rejects:
 *   - a non-object, or a wrong/missing `schema_version`;
 *   - a `signals` that is not a plain object;
 *   - ANY signal key outside `STATION_SIGNAL_KEYS` (unknown signal → reject);
 *   - ANY present signal value that is not a boolean (absent is legal ⇒ false);
 *   - a `source_ref` that is present but not a non-empty string or null;
 *   - any unknown top-level key (the envelope shape is closed).
 */
export function validateStationSignalsV1(obj: unknown): StationSignalsV1 | null {
  // Contract: NEVER throws (G2 idiom). Any exotic input — a throwing own getter,
  // a Proxy trap on an own-key operation (`ownKeys`/`getOwnPropertyDescriptor`),
  // etc. — is treated as invalid and mapped to `null` here.
  try {
    return validateStationSignalsV1Inner(obj);
  } catch {
    return null;
  }
}

/**
 * The own DATA value of `key` on `o`, or a "not a plain data field" signal. We
 * read every field through its own-property DESCRIPTOR and require a data
 * descriptor (`"value" in desc`) — a validator must never invoke a
 * caller-supplied getter: a getter could return a different value on each read,
 * or throw. `{ kind: "absent" }` = no own property; `{ kind: "accessor" }` = an
 * own getter/setter (rejected); `{ kind: "data", value }` = a plain own value.
 */
function ownDataProp(
  o: object,
  key: string
): { kind: "absent" } | { kind: "accessor" } | { kind: "data"; value: unknown } {
  const desc = Object.getOwnPropertyDescriptor(o, key);
  if (!desc) return { kind: "absent" };
  if (!("value" in desc)) return { kind: "accessor" };
  return { kind: "data", value: desc.value };
}

function validateStationSignalsV1Inner(obj: unknown): StationSignalsV1 | null {
  if (!isPlainDataObject(obj)) return null;
  const o = obj;
  if (Object.getOwnPropertySymbols(o).length > 0) return null;

  // Closed top-level shape — scan own property NAMES only (getOwnPropertyNames
  // also catches non-enumerable own keys a plain Object.keys scan would miss).
  for (const k of Object.getOwnPropertyNames(o)) {
    if (k !== "schema_version" && k !== "signals" && k !== "source_ref") return null;
  }

  // Read each field via its OWN DATA descriptor — never through the prototype
  // chain (defeats `Object.prototype.signals = {...}` pollution) and never via a
  // caller getter (accessor descriptors are rejected). `schema_version` +
  // `signals` are required own data; a non-own `source_ref` is treated as absent.
  const schema = ownDataProp(o, "schema_version");
  if (schema.kind !== "data" || schema.value !== STATION_SIGNALS_SCHEMA) return null;

  const signalsProp = ownDataProp(o, "signals");
  if (signalsProp.kind !== "data") return null;
  const signals = signalsProp.value;
  if (!isPlainDataObject(signals)) return null; // rejects exotic prototypes (see isPlainDataObject)
  if (Object.getOwnPropertySymbols(signals).length > 0) return null;

  // NULL-prototype output: the composer reads `signals[key]` via bracket access,
  // so even this sanitized object must NOT resolve an absent signal through a
  // polluted `Object.prototype.<signal>`. A null prototype closes that read-side gap.
  const cleanSignals = Object.create(null) as Partial<Record<StationSignalKey, boolean>>;
  for (const k of Object.getOwnPropertyNames(signals)) {
    if (!SIGNAL_KEY_SET.has(k)) return null; // unknown signal key
    const prop = ownDataProp(signals, k);
    if (prop.kind !== "data") return null; // accessor signal field → reject
    if (typeof prop.value !== "boolean") return null; // present ⇒ must be boolean
    cleanSignals[k as StationSignalKey] = prop.value;
  }

  const srProp = ownDataProp(o, "source_ref");
  if (srProp.kind === "accessor") return null; // accessor source_ref → reject
  let sourceRef: string | null | undefined;
  if (srProp.kind === "data") {
    const sr = srProp.value;
    if (!(sr === null || (typeof sr === "string" && sr.length > 0))) return null;
    sourceRef = sr as string | null;
  }

  // Return a FRESH, sanitized envelope built only from validated own-data keys.
  // Downstream (`signalsOf` → composer) then never reads a value through a
  // prototype chain or a getter, even if the input object carried an exotic shape.
  const clean: StationSignalsV1 = {
    schema_version: STATION_SIGNALS_SCHEMA,
    signals: cleanSignals as StationSignals,
  };
  if (sourceRef !== undefined) clean.source_ref = sourceRef;
  return clean;
}

// ── Emission to the canonical run tree ───────────────────────────────────────

/**
 * Where team plans/results live under a run:
 *   .guild/runs/<run-id>/team-plan/<station>.json
 *   .guild/runs/<run-id>/team-result/<station>.json
 *
 * One file per (run, station). The station segment is the composer's own
 * `StationId` (a closed enum — always a safe segment); the only untrusted segment
 * is `run_id`, which is validated below. `assertWithinRunTree` is the final
 * fail-closed containment check — no record may be scattered outside the
 * authoritative run tree (mirrors G2 D6).
 */
const TEAM_PLAN_DIR = "team-plan" as const;
const TEAM_RESULT_DIR = "team-result" as const;

/** Safe single path segment — same rule G2's `taskCellPaths` enforces on ids. */
const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function assertSafeRunId(runId: string): void {
  if (!SAFE_SEGMENT.test(runId) || runId === "." || runId === "..") {
    throw new Error(`unsafe run_id path segment: ${JSON.stringify(runId)}`);
  }
}

/**
 * Build (and fail-closed validate) the canonical path for one team artifact.
 * Throws on an unsafe `run_id`, an unknown `station`, or a computed path that
 * would escape the run tree.
 */
function teamArtifactPath(
  cwd: string,
  runId: string,
  kind: typeof TEAM_PLAN_DIR | typeof TEAM_RESULT_DIR,
  station: StationId,
  guildDir = ".guild"
): string {
  assertSafeRunId(runId);
  if (!isStation(station)) {
    throw new Error(`unknown station "${station}" — cannot emit a team artifact for it`);
  }
  const runDir = path.join(cwd, guildDir, "runs", runId);
  const p = path.join(runDir, kind, `${station}.json`);
  assertWithinRunTree(runDir, p, `${kind}/${station}.json`);
  return p;
}

export interface EmitOptions {
  /** Override the `.guild` directory name (tests point it at a temp tree). */
  guildDir?: string;
}

/**
 * Real-path containment guard against a symlink escape, then create the target
 * directory. `assertWithinRunTree` (G2) compares resolved *logical* strings, so a
 * pre-planted symlink at `.guild/runs/<run-id>/team-plan` — or a symlinked run
 * root — would let `fs.writeFileSync` follow the link and land OUTSIDE the run
 * tree while the logical path still "contains". We close that here, locally
 * (without widening the shared G2 helper's contract):
 *
 *   1. BEFORE creating anything, refuse if a sensitive path segment (the run root
 *      or the kind dir) already exists AS a symlink — no side-effect dir gets
 *      created through a planted link.
 *   2. AFTER `mkdir`, resolve the parent + the runs container through
 *      `realpathSync` and require the REAL parent to sit under the REAL runs
 *      container with the expected `run_id` segment intact (belt-and-suspenders:
 *      also catches a symlinked runs-internal ancestor).
 *   3. Refuse an existing symlink at the final file path (never overwrite through
 *      a link).
 *
 * Throws on any breach; nothing is written.
 */
function prepareEmitDir(
  cwd: string,
  runId: string,
  filePath: string,
  guildDir: string,
  label: string
): void {
  const guildRoot = path.join(cwd, guildDir);
  const runsContainer = path.join(guildRoot, "runs");
  const kindDir = path.dirname(filePath);

  const notASymlink = (seg: string): void => {
    try {
      if (fs.lstatSync(seg).isSymbolicLink()) {
        throw new Error(`${label}: refusing — symlinked run path segment: ${seg}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  };

  // (1) BEFORE creating anything: refuse if ANY sensitive existing segment is a
  //     symlink — the `.guild` root, the `runs` container, the run root, or the
  //     kind dir. Checking the CONTAINERS first (and before mkdir) closes the
  //     escape where `.guild` or `.guild/runs` is itself a symlink to an outside
  //     directory: a bare `mkdirSync(runsContainer, {recursive})` would otherwise
  //     follow that link and make the external target the authoritative realpath.
  for (const seg of [guildRoot, runsContainer, path.join(runsContainer, runId), kindDir]) {
    notASymlink(seg);
  }

  // (2) create the kind dir (recursive also creates `.guild/runs/<runId>`); every
  //     existing ancestor was just proven to be a real (non-symlink) directory.
  fs.mkdirSync(kindDir, { recursive: true });

  // (3) post-mkdir real-path containment, ANCHORED ON THE REAL cwd (the trusted
  //     root) — not the runs container, which a symlink could redirect. The
  //     resolved kind dir must sit under `<realCwd>/<guildDir>/runs/<runId>/`.
  const realCwd = fs.realpathSync(cwd);
  const expectedRunsReal = path.join(realCwd, guildDir, "runs");
  const realParent = fs.realpathSync(kindDir);
  const rel = path.relative(expectedRunsReal, realParent);
  const firstSeg = rel.split(path.sep)[0];
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel) || firstSeg !== runId) {
    throw new Error(`${label}: refusing to write outside the run tree (symlinked path)`);
  }

  // (4) refuse an existing symlink at the final file path.
  notASymlink(filePath);
}

/**
 * Generic hardened writer for a run-tree team artifact (T2b: proposal /
 * decision / schedule persistence rides the SAME symlink-hardened containment
 * path as team_plan/team_result emission — one guard, no lookalike copies).
 * `filename` must be a safe single segment. With `immutable: true` an existing
 * file is NEVER overwritten (team-contracts §1: artifacts are immutable; a
 * change is a NEW artifact, never an edit). Returns the path written.
 */
export function writeRunArtifact(
  cwd: string,
  runId: string,
  kind: typeof TEAM_PLAN_DIR | typeof TEAM_RESULT_DIR,
  filename: string,
  content: string,
  opts: EmitOptions & { immutable?: boolean } = {}
): string {
  assertSafeRunId(runId);
  if (!SAFE_SEGMENT.test(filename) || filename === "." || filename === "..") {
    throw new Error(`writeRunArtifact: unsafe filename segment: ${JSON.stringify(filename)}`);
  }
  if (kind !== TEAM_PLAN_DIR && kind !== TEAM_RESULT_DIR) {
    throw new Error(`writeRunArtifact: unknown artifact kind: ${JSON.stringify(kind)}`);
  }
  const guildDir = opts.guildDir ?? ".guild";
  const runDir = path.join(cwd, guildDir, "runs", runId);
  const p = path.join(runDir, kind, filename);
  assertWithinRunTree(runDir, p, `${kind}/${filename}`);
  prepareEmitDir(cwd, runId, p, guildDir, "writeRunArtifact");
  if (opts.immutable && fs.existsSync(p)) {
    throw new Error(
      `writeRunArtifact: ${kind}/${filename} already exists — artifacts are immutable (§1); write a NEW version instead of editing`
    );
  }
  fs.writeFileSync(p, content, "utf8");
  return p;
}

/**
 * Persist a composed `guild.team_plan.v1` to
 * `.guild/runs/<run-id>/team-plan/<station>.json`. FAIL-CLOSED: the plan is
 * re-validated with the G6a `validateTeamPlanV1` before ANY write — an invalid
 * plan throws and nothing is written. Returns the absolute-ish path written.
 */
export function writeTeamPlan(
  cwd: string,
  runId: string,
  plan: unknown,
  opts: EmitOptions = {}
): string {
  const valid = validateTeamPlanV1(plan);
  if (!valid) {
    throw new Error("writeTeamPlan: refusing to write an invalid guild.team_plan.v1");
  }
  const guildDir = opts.guildDir ?? ".guild";
  const p = teamArtifactPath(cwd, runId, TEAM_PLAN_DIR, valid.station, guildDir);
  prepareEmitDir(cwd, runId, p, guildDir, "writeTeamPlan");
  fs.writeFileSync(p, JSON.stringify(valid, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Persist a `guild.team_result.v1` to
 * `.guild/runs/<run-id>/team-result/<station>.json`. FAIL-CLOSED via
 * `validateTeamResultV1` (which also enforces the G2 D3 distinct-`instance_id`
 * freshness invariant). Returns the path written.
 */
export function writeTeamResult(
  cwd: string,
  runId: string,
  result: unknown,
  opts: EmitOptions = {}
): string {
  const valid = validateTeamResultV1(result);
  if (!valid) {
    throw new Error("writeTeamResult: refusing to write an invalid guild.team_result.v1");
  }
  const guildDir = opts.guildDir ?? ".guild";
  const p = teamArtifactPath(cwd, runId, TEAM_RESULT_DIR, valid.station, guildDir);
  prepareEmitDir(cwd, runId, p, guildDir, "writeTeamResult");
  fs.writeFileSync(p, JSON.stringify(valid, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Read + fail-closed validate a persisted `guild.team_plan.v1`. Returns the
 * typed plan or NULL — a missing file, unreadable file, unparseable JSON, or an
 * invalid plan all return NULL (never throw for the not-found/invalid case; only
 * an unsafe `run_id`/`station` path is a hard throw).
 */
export function readTeamPlan(
  cwd: string,
  runId: string,
  station: StationId,
  opts: EmitOptions = {}
): TeamPlanV1 | null {
  const p = teamArtifactPath(cwd, runId, TEAM_PLAN_DIR, station, opts.guildDir);
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateTeamPlanV1(parsed);
}

/**
 * Read + fail-closed validate a persisted `guild.team_result.v1`. Same NULL-on-
 * missing/invalid contract as `readTeamPlan`.
 */
export function readTeamResult(
  cwd: string,
  runId: string,
  station: StationId,
  opts: EmitOptions = {}
): TeamResultV1 | null {
  const p = teamArtifactPath(cwd, runId, TEAM_RESULT_DIR, station, opts.guildDir);
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateTeamResultV1(parsed);
}
