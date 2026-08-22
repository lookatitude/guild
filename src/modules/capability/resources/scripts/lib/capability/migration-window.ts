import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { planModeTransition } from "../../../src/modules/capability/workflows/resolver-mode";
import { checkContained, isRefused, writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import {
  FEATURE_GATE_REGISTRY_SCHEMA,
  FEATURE_GATE_RELPATH,
  readFeatureGateRegistry,
  validateFeatureGateRegistry,
  writeFeatureGateRegistry,
  type CapabilityFeatureGateRegistryV1,
} from "./strangler-control";
import {
  loadAttestedMigrationBoundary,
  loadMigrationBoundary,
  loadMigrationObservation,
  verifyPersistedMigrationBoundary,
  verifyMigrationObservation,
  validateMigrationBoundary,
  validateMigrationObservation,
  MIGRATION_OBSERVATION_SCHEMA,
  type MigrationBoundaryV1,
  type MigrationObservation,
} from "./migration-evidence";

export const MIGRATION_WINDOW_SCHEMA = "guild.capability_migration_window.v4" as const;
export const MIGRATION_WINDOW_RELPATH = ".guild/artifacts/capability/migration-window.json";
export const MIGRATION_TRANSITION_SCHEMA_V1 = "guild.capability_migration_transition.v1" as const;
export const MIGRATION_TRANSITION_SCHEMA = "guild.capability_migration_transition.v2" as const;
export const MIGRATION_ADVANCE_CONFORMANCE_SCHEMA = "guild.capability_migration_advance_conformance.v1" as const;
export const MIGRATION_RESTART_SCHEMA = "guild.capability_migration_restart.v1" as const;
export const MIGRATION_TRANSITION_RELPATH = ".guild/artifacts/capability/migration-transition.json";
export const MIGRATION_RESTART_HISTORY_RELPATH = ".guild/artifacts/capability/migration-window-history";
export const MIN_RELEASES_PER_MODE = 3;
export const MIN_DAYS_PER_MODE = 14;
const MIGRATION_RESTART_REASON_PREFIX = "D03 migration-window restart for baseline-bound v2 evidence";

interface CompletedMigrationPhaseV1 {
  readonly mode: "observe" | "shadow";
  readonly entered_at: string;
  readonly releases: readonly MigrationBoundaryV1[];
  readonly observations: readonly MigrationObservation[];
  readonly advanced_with: MigrationBoundaryV1;
}

export interface MigrationWindowV1 {
  readonly schema_version: typeof MIGRATION_WINDOW_SCHEMA;
  readonly project_id: string;
  readonly mode: CapabilityResolverMode;
  readonly entered_at: string;
  /** Attested beta boundary that opened the current mode. */
  readonly entry_boundary: MigrationBoundaryV1;
  readonly releases: readonly MigrationBoundaryV1[];
  readonly observations: readonly MigrationObservation[];
  readonly completed_phases: readonly CompletedMigrationPhaseV1[];
  readonly actor: string;
  /** Present after a legacy-evidence restart and carried through every successor. */
  readonly restart_history?: MigrationRestartHistoryRefV1;
}

export interface MigrationRestartHistoryRefV1 {
  readonly path: string;
  readonly sha256: string;
}

interface MigrationTransitionIntentV1 {
  readonly schema_version: typeof MIGRATION_TRANSITION_SCHEMA | typeof MIGRATION_TRANSITION_SCHEMA_V1;
  readonly operation: "start" | "advance" | "restart";
  readonly prior_window: MigrationWindowV1 | null;
  readonly prior_gates: CapabilityFeatureGateRegistryV1 | null;
  readonly next_window: MigrationWindowV1;
  readonly next_gates: CapabilityFeatureGateRegistryV1;
  readonly restart_record: MigrationRestartRecordV1 | null;
  readonly intent_hash: string;
}

export interface MigrationRestartRecordV1 {
  readonly schema_version: typeof MIGRATION_RESTART_SCHEMA;
  readonly project_id: string;
  readonly reason: string;
  readonly actor: string;
  readonly restarted_at: string;
  readonly prior_window: MigrationWindowV1;
  readonly next_window: MigrationWindowV1;
  readonly restart_hash: string;
}

const MODES = new Set<CapabilityResolverMode>(["legacy", "observe", "shadow", "project-local", "strict"]);
const BETA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function migrationRestartReason(restartHash: string): string { return `${MIGRATION_RESTART_REASON_PREFIX} [restart_hash=${restartHash}]`; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function canonicalInstant(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value;
}

function readOptionalStateFile(projectRoot: string, relativePath: string, label: string): string | null {
  const root = fs.realpathSync(projectRoot); const target = path.join(root, relativePath);
  try { fs.lstatSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const checked = checkContained(root, target, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(checked)) throw new Error(`${label} refused [${checked.code}]`);
  const descriptor = fs.openSync(checked.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { if (!fs.fstatSync(descriptor).isFile()) throw new Error(`${label} is not a regular file`); return fs.readFileSync(descriptor, "utf8"); }
  finally { fs.closeSync(descriptor); }
}

function betaOrder(value: string): readonly [number, number, number, number] | null {
  const match = BETA.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}
function strictlyNewerBeta(previous: string, next: string): boolean {
  const left = betaOrder(previous); const right = betaOrder(next);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] > left[index]) return true;
    if (right[index] < left[index]) return false;
  }
  return false;
}

function pairEvidence(boundary: MigrationBoundaryV1, observation: MigrationObservation, mode: "observe" | "shadow"): boolean {
  const runtimePackageMatches = Object.values(boundary.packages).some((runtimePackage) => runtimePackage.host_id === observation.runtime_package.host_id
    && runtimePackage.manifest_path === observation.runtime_package.manifest_path
    && runtimePackage.manifest_sha256 === observation.runtime_package.manifest_sha256
    && runtimePackage.producer_sha256 === observation.runtime_package.producer_sha256
    && runtimePackage.tree_sha256 === observation.runtime_package.tree_sha256
    && runtimePackage.install_surface_sha256 === observation.runtime_package.install_surface_sha256);
  return observation.mode === mode
    && observation.boundary_hash === boundary.boundary_hash
    && observation.boundary_release === boundary.release
    && observation.boundary_source_commit === boundary.source_commit
    && observation.boundary_merged_at === boundary.merged_at
    && runtimePackageMatches;
}

function validateSeries(rawReleases: unknown, rawObservations: unknown, mode: "observe" | "shadow", allowEmpty: boolean) {
  if (!Array.isArray(rawReleases) || !Array.isArray(rawObservations) || rawReleases.length !== rawObservations.length || (!allowEmpty && rawReleases.length === 0)) return null;
  const releases: MigrationBoundaryV1[] = []; const observations: MigrationObservation[] = [];
  const versions = new Set<string>(); const commits = new Set<string>();
  for (let index = 0; index < rawReleases.length; index += 1) {
    const boundary = validateMigrationBoundary(rawReleases[index]);
    const observation = validateMigrationObservation(rawObservations[index]);
    if (!boundary || !observation || !pairEvidence(boundary, observation, mode) || versions.has(boundary.release) || commits.has(boundary.source_commit)) return null;
    const prior = releases[index - 1];
    if (prior && (!strictlyNewerBeta(prior.release, boundary.release) || Date.parse(boundary.merged_at) <= Date.parse(prior.merged_at))) return null;
    versions.add(boundary.release); commits.add(boundary.source_commit); releases.push(boundary); observations.push(observation);
  }
  return { releases, observations };
}

function validateCompletedPhase(value: unknown): CompletedMigrationPhaseV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["mode", "entered_at", "releases", "observations", "advanced_with"]) || (record.mode !== "observe" && record.mode !== "shadow") || !canonicalInstant(record.entered_at)) return null;
  const series = validateSeries(record.releases, record.observations, record.mode, false);
  const advancedWith = validateMigrationBoundary(record.advanced_with);
  if (!series || !advancedWith) return null;
  if (series.releases.length < MIN_RELEASES_PER_MODE) return null;
  if (series.observations.some((observation) => Date.parse(observation.observed_at) < Date.parse(record.entered_at as string))) return null;
  const distinctRuns = new Set(series.observations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if (distinctRuns < MIN_RELEASES_PER_MODE) return null;
  // Legacy completed phases remain readable historical state. They never count
  // toward a new advance (evaluateMigrationAdvance checks the current phase),
  // but rejecting them here strands already-advanced windows before restart.
  const last = series.releases[series.releases.length - 1];
  if (!strictlyNewerBeta(last.release, advancedWith.release) || Date.parse(advancedWith.merged_at) <= Date.parse(last.merged_at)) return null;
  if (Date.parse(advancedWith.merged_at) - Date.parse(record.entered_at as string) < MIN_DAYS_PER_MODE * 86_400_000) return null;
  return Object.freeze({ mode: record.mode, entered_at: record.entered_at, ...series, advanced_with: advancedWith });
}

function verifyWindowBoundaryProvenance(projectRoot: string, value: MigrationWindowV1): void {
  const boundaries = new Map<string, MigrationBoundaryV1>();
  boundaries.set(value.entry_boundary.boundary_hash, value.entry_boundary);
  for (const boundary of value.releases) boundaries.set(boundary.boundary_hash, boundary);
  for (const phase of value.completed_phases) {
    for (const boundary of phase.releases) boundaries.set(boundary.boundary_hash, boundary);
    boundaries.set(phase.advanced_with.boundary_hash, phase.advanced_with);
  }
  for (const boundary of boundaries.values()) verifyPersistedMigrationBoundary(projectRoot, boundary);
}

export function validateMigrationWindow(value: unknown): MigrationWindowV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const baseKeys = ["schema_version", "project_id", "mode", "entered_at", "entry_boundary", "releases", "observations", "completed_phases", "actor"] as const;
  const hasRestartHistory = Object.prototype.hasOwnProperty.call(record, "restart_history");
  if (!exactKeys(record, hasRestartHistory ? [...baseKeys, "restart_history"] : baseKeys)) return null;
  if (record.schema_version !== MIGRATION_WINDOW_SCHEMA || typeof record.project_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(record.project_id) || !MODES.has(record.mode as CapabilityResolverMode) || record.mode === "legacy" || !canonicalInstant(record.entered_at) || typeof record.actor !== "string" || !record.actor || !Array.isArray(record.completed_phases)) return null;
  const mode = record.mode as CapabilityResolverMode;
  const entryBoundary = validateMigrationBoundary(record.entry_boundary);
  if (!entryBoundary || Date.parse(entryBoundary.merged_at) > Date.parse(record.entered_at)) return null;
  const series = mode === "observe" || mode === "shadow"
    ? validateSeries(record.releases, record.observations, mode, true)
    : Array.isArray(record.releases) && record.releases.length === 0 && Array.isArray(record.observations) && record.observations.length === 0 ? { releases: [], observations: [] } : null;
  if (!series) return null;
  if (series.observations.some((observation) => Date.parse(observation.observed_at) < Date.parse(record.entered_at as string))) return null;
  const completed: CompletedMigrationPhaseV1[] = [];
  for (const raw of record.completed_phases) {
    const phase = validateCompletedPhase(raw); if (!phase) return null;
    if (completed.some((entry) => entry.mode === phase.mode)) return null;
    if (phase.mode === "shadow" && !completed.some((entry) => entry.mode === "observe")) return null;
    completed.push(phase);
  }
  const expectedCompletedModes: readonly string[] = mode === "observe" ? [] : mode === "shadow" ? ["observe"] : ["observe", "shadow"];
  if (completed.map((phase) => phase.mode).join(",") !== expectedCompletedModes.join(",")) return null;
  if (mode === "observe" && completed.length > 0) return null;
  if (mode === "shadow" && !completed.some((phase) => phase.mode === "observe")) return null;
  if ((mode === "project-local" || mode === "strict") && !completed.some((phase) => phase.mode === "shadow")) return null;
  if ([...completed, series].some((phase) => phase.observations.some((observation) => observation.project_id !== record.project_id))) return null;
  let restartHistory: MigrationRestartHistoryRefV1 | undefined;
  if (hasRestartHistory) {
    const ref = record.restart_history;
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const candidate = ref as Record<string, unknown>;
    if (!exactKeys(candidate, ["path", "sha256"]) || typeof candidate.path !== "string" || typeof candidate.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(candidate.sha256)
      || candidate.path !== `${MIGRATION_RESTART_HISTORY_RELPATH}/${candidate.sha256}.json`) return null;
    restartHistory = Object.freeze({ path: candidate.path, sha256: candidate.sha256 });
  }
  return Object.freeze({ schema_version: MIGRATION_WINDOW_SCHEMA, project_id: record.project_id, mode, entered_at: record.entered_at, entry_boundary: entryBoundary, ...series, completed_phases: Object.freeze(completed), actor: record.actor, ...(restartHistory ? { restart_history: restartHistory } : {}) });
}

function transitionHash(value: Omit<MigrationTransitionIntentV1, "intent_hash">): string { return sha256(canonical(value)); }
function withoutRestartHistory(value: MigrationWindowV1): MigrationWindowV1 {
  const { restart_history: _restartHistory, ...base } = value;
  return base;
}
function validateTransitionIntent(value: unknown): MigrationTransitionIntentV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const legacy = record.schema_version === MIGRATION_TRANSITION_SCHEMA_V1;
  const current = record.schema_version === MIGRATION_TRANSITION_SCHEMA;
  const expectedKeys = legacy
    ? ["schema_version", "operation", "prior_window", "prior_gates", "next_window", "next_gates", "intent_hash"]
    : ["schema_version", "operation", "prior_window", "prior_gates", "next_window", "next_gates", "restart_record", "intent_hash"];
  if ((!legacy && !current) || !exactKeys(record, expectedKeys) || (record.operation !== "start" && record.operation !== "advance" && record.operation !== "restart") || (legacy && record.operation === "restart") || typeof record.intent_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.intent_hash)) return null;
  const priorWindow = record.prior_window === null ? null : validateMigrationWindow(record.prior_window);
  const priorGates = record.prior_gates === null ? null : validateFeatureGateRegistry(record.prior_gates);
  if ((record.prior_window !== null && !priorWindow) || (record.prior_gates !== null && !priorGates)) return null;
  const nextWindow = validateMigrationWindow(record.next_window); const nextGates = validateFeatureGateRegistry(record.next_gates);
  if (!nextWindow || !nextGates || nextWindow.mode !== nextGates.resolver_mode) return null;
  const restartRecord = legacy || record.restart_record === null ? null : validateMigrationRestartRecord(record.restart_record);
  if (!legacy && ((record.restart_record !== null && !restartRecord) || (record.operation === "restart") !== (restartRecord !== null))) return null;
  const operation = record.operation as "start" | "advance" | "restart";
  const candidate = legacy
    ? { schema_version: MIGRATION_TRANSITION_SCHEMA_V1, operation: operation as "start" | "advance", prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates }
    : { schema_version: MIGRATION_TRANSITION_SCHEMA, operation, prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates, restart_record: restartRecord };
  if (record.intent_hash !== sha256(canonical(candidate))) return null;
  return Object.freeze({ ...candidate, restart_record: restartRecord, intent_hash: record.intent_hash });
}

function verifyWindowEvidence(projectRoot: string, value: MigrationWindowV1): void {
  verifyWindowBoundaryProvenance(projectRoot, value);
  for (const phase of [...value.completed_phases, value]) {
    for (const observation of phase.observations) verifyMigrationObservation(projectRoot, observation);
  }
}

/** Recompute the only state pair the recorded operation is allowed to install. */
function verifyTransitionSemantics(projectRoot: string, intent: MigrationTransitionIntentV1): void {
  let expectedWindow: MigrationWindowV1 | null = null;
  let expectedGates: CapabilityFeatureGateRegistryV1 | null = null;
  if (intent.operation === "start") {
    if (intent.restart_record !== null) throw new Error("start transition cannot carry restart history");
    if (intent.prior_window !== null || (intent.prior_gates !== null && intent.prior_gates.resolver_mode !== "legacy" && intent.prior_gates.resolver_mode !== "observe")) {
      throw new Error("start transition has an ineligible prior state");
    }
    expectedWindow = validateMigrationWindow({
      schema_version: MIGRATION_WINDOW_SCHEMA,
      project_id: intent.next_window.project_id,
      mode: "observe",
      entered_at: intent.next_window.entered_at,
      entry_boundary: intent.next_window.entry_boundary,
      releases: [],
      observations: [],
      completed_phases: [],
      actor: intent.next_window.actor,
    });
    const prior = intent.prior_gates;
    expectedGates = prior?.resolver_mode === "observe"
      ? prior
      : prior
        ? { ...prior, resolver_mode: "observe", revision: prior.revision + 1, updated_at: intent.next_window.entered_at, updated_by: intent.next_window.actor, history: [...prior.history, { from: "legacy", to: "observe", reason: "D03 migration-window start", recorded_at: intent.next_window.entered_at, actor: intent.next_window.actor }] }
        : { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "observe", revision: 0, updated_at: intent.next_window.entered_at, updated_by: intent.next_window.actor, history: [] };
  } else if (intent.operation === "advance") {
    if (intent.restart_record !== null) throw new Error("advance transition cannot carry restart history");
    const priorWindow = intent.prior_window;
    const priorGates = intent.prior_gates;
    if (!priorWindow || !priorGates || priorWindow.mode !== priorGates.resolver_mode) throw new Error("advance transition has no coherent prior state");
    const verdict = intent.schema_version === MIGRATION_TRANSITION_SCHEMA_V1
      ? evaluateLegacyMigrationAdvance(priorWindow, intent.next_window.mode, intent.next_window.entry_boundary)
      : evaluateMigrationAdvance(priorWindow, intent.next_window.mode, intent.next_window.entry_boundary);
    if (!verdict.passed) throw new Error(`advance transition is not evidence-qualified: ${verdict.blockers.join("; ")}`);
    const completed = priorWindow.mode === "observe" || priorWindow.mode === "shadow"
      ? [...priorWindow.completed_phases, { mode: priorWindow.mode, entered_at: priorWindow.entered_at, releases: priorWindow.releases, observations: priorWindow.observations, advanced_with: intent.next_window.entry_boundary }]
      : priorWindow.completed_phases;
    expectedWindow = validateMigrationWindow({
      schema_version: MIGRATION_WINDOW_SCHEMA,
      project_id: priorWindow.project_id,
      mode: intent.next_window.mode,
      entered_at: intent.next_window.entered_at,
      entry_boundary: intent.next_window.entry_boundary,
      releases: [],
      observations: [],
      completed_phases: completed,
      actor: intent.next_window.actor,
      ...(priorWindow.restart_history ? { restart_history: priorWindow.restart_history } : {}),
    });
    expectedGates = {
      ...priorGates,
      resolver_mode: intent.next_window.mode,
      revision: priorGates.revision + 1,
      updated_at: intent.next_window.entered_at,
      updated_by: intent.next_window.actor,
      history: [...priorGates.history, { from: priorWindow.mode, to: intent.next_window.mode, reason: "D03 migration-window advance", recorded_at: intent.next_window.entered_at, actor: intent.next_window.actor }],
    };
  } else {
    const priorWindow = intent.prior_window;
    const priorGates = intent.prior_gates;
    if (!priorWindow || !priorGates
      || (priorWindow.mode !== "observe" && priorWindow.mode !== "shadow")
      || priorGates.resolver_mode !== priorWindow.mode) throw new Error("restart transition has no coherent observe/shadow prior state");
    // Recovery may run long after the intent was written. Re-prove the archived
    // state's retained observations and boundary attestations before installing
    // a history record that claims to preserve them.
    verifyWindowEvidence(projectRoot, priorWindow);
    const restartRef = intent.next_window.restart_history;
    if (!intent.restart_record || !restartRef
      || restartRef.sha256 !== intent.restart_record.restart_hash
      || canonical(intent.restart_record.prior_window) !== canonical(priorWindow)
      || canonical(intent.restart_record.next_window) !== canonical(withoutRestartHistory(intent.next_window))) throw new Error("restart transition history is absent or detached");
    if (!priorWindow.observations.some((observation) => observation.schema_version !== MIGRATION_OBSERVATION_SCHEMA)) throw new Error("restart transition is not a legacy-evidence upgrade");
    const previous = lastKnownBoundary(priorWindow);
    if (!previous || !strictlyNewerBeta(previous.release, intent.next_window.entry_boundary.release) || Date.parse(intent.next_window.entry_boundary.merged_at) <= Date.parse(previous.merged_at)) {
      throw new Error("restart transition boundary is not strictly newer than the legacy window");
    }
    expectedWindow = validateMigrationWindow({
      schema_version: MIGRATION_WINDOW_SCHEMA,
      project_id: priorWindow.project_id,
      mode: priorWindow.mode,
      entered_at: intent.next_window.entered_at,
      entry_boundary: intent.next_window.entry_boundary,
      releases: [],
      observations: [],
      completed_phases: priorWindow.completed_phases,
      actor: intent.next_window.actor,
      restart_history: restartRef,
    });
    expectedGates = {
      ...priorGates,
      revision: priorGates.revision + 1,
      updated_at: intent.next_window.entered_at,
      updated_by: intent.next_window.actor,
      history: [...priorGates.history, { from: priorWindow.mode, to: priorWindow.mode, reason: migrationRestartReason(intent.restart_record.restart_hash), recorded_at: intent.next_window.entered_at, actor: intent.next_window.actor }],
    };
  }
  if (!expectedWindow || !expectedGates || canonical(expectedWindow) !== canonical(intent.next_window) || canonical(expectedGates) !== canonical(intent.next_gates)) {
    throw new Error("pending migration transition is not the exact successor of its prior state");
  }
  verifyWindowEvidence(projectRoot, intent.next_window);
}

function transitionPath(projectRoot: string): string { return path.join(fs.realpathSync(projectRoot), MIGRATION_TRANSITION_RELPATH); }
function writeTransitionIntent(projectRoot: string, operation: "start" | "advance" | "restart", priorWindow: MigrationWindowV1 | null, priorGates: CapabilityFeatureGateRegistryV1 | null, nextWindow: MigrationWindowV1, nextGates: CapabilityFeatureGateRegistryV1, restartRecord: MigrationRestartRecordV1 | null = null): MigrationTransitionIntentV1 {
  const target = transitionPath(projectRoot);
  try { fs.lstatSync(target); throw new Error("a migration transition is already pending"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const candidate = { schema_version: MIGRATION_TRANSITION_SCHEMA, operation, prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates, restart_record: restartRecord };
  const intent = validateTransitionIntent({ ...candidate, intent_hash: transitionHash(candidate) });
  if (!intent) throw new Error("migration transition intent failed validation");
  const written = writeContainedFile(projectRoot, target, Buffer.from(`${JSON.stringify(intent, null, 2)}\n`), { policy: "physical" });
  if (!written.written) throw new Error(`migration transition intent refused [${written.code}]: ${written.detail}`);
  return intent;
}

function applyMigrationTransition(projectRoot: string, intent: MigrationTransitionIntentV1): void {
  verifyTransitionSemantics(projectRoot, intent);
  writeMigrationWindow(projectRoot, intent.next_window);
  writeFeatureGateRegistry(projectRoot, intent.next_gates);
  if (intent.restart_record) writeMigrationRestartRecord(projectRoot, intent.restart_record);
  fs.unlinkSync(transitionPath(projectRoot));
}

export function recoverMigrationTransition(projectRoot: string): boolean {
  let raw: string | null;
  try { raw = readOptionalStateFile(projectRoot, MIGRATION_TRANSITION_RELPATH, "pending migration transition"); }
  catch (error) { throw new Error(`pending migration transition is unreadable: ${(error as Error).message}`); }
  if (raw === null) return false;
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new Error("pending migration transition is invalid JSON"); }
  const intent = validateTransitionIntent(parsed); if (!intent) throw new Error("pending migration transition is invalid or tampered");
  // A crafted self-hashed intent must never mutate either live state file.
  // Recompute the only allowed successor and re-verify all retained evidence
  // before deciding whether an interrupted commit can roll forward.
  verifyTransitionSemantics(projectRoot, intent);
  let currentWindow: MigrationWindowV1 | null = null; let windowExists = false;
  try { const windowRaw = readOptionalStateFile(projectRoot, MIGRATION_WINDOW_RELPATH, "current migration window"); windowExists = windowRaw !== null; currentWindow = windowRaw === null ? null : validateMigrationWindow(JSON.parse(windowRaw)); }
  catch { throw new Error("current migration window is invalid during transition recovery"); }
  if (windowExists && !currentWindow) throw new Error("current migration window is invalid during transition recovery");
  const gatePath = path.join(fs.realpathSync(projectRoot), FEATURE_GATE_RELPATH);
  let gateExists = false; try { fs.lstatSync(gatePath); gateExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const currentGates = readFeatureGateRegistry(projectRoot);
  if (gateExists && !currentGates) throw new Error("current feature-gate registry is invalid during transition recovery");
  const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
  const windowAtPrior = same(currentWindow, intent.prior_window); const windowAtNext = same(currentWindow, intent.next_window);
  const gatesAtPrior = same(currentGates, intent.prior_gates); const gatesAtNext = same(currentGates, intent.next_gates);
  if (!windowAtPrior && !windowAtNext) throw new Error("migration window changed outside the pending transition");
  if (!gatesAtPrior && !gatesAtNext) throw new Error("feature-gate registry changed outside the pending transition");
  // An intent alone is not authority. If no target landed, discard it and let
  // the operator retry; only a partially/fully applied in-process commit may
  // recover forward from disk.
  const windowChanged = !same(intent.prior_window, intent.next_window);
  const gatesChanged = !same(intent.prior_gates, intent.next_gates);
  const anyTargetLanded = (windowChanged && windowAtNext) || (gatesChanged && gatesAtNext);
  if (windowAtPrior && gatesAtPrior && !anyTargetLanded) {
    fs.unlinkSync(transitionPath(projectRoot));
    return false;
  }
  writeMigrationWindow(projectRoot, intent.next_window);
  writeFeatureGateRegistry(projectRoot, intent.next_gates);
  if (intent.restart_record) writeMigrationRestartRecord(projectRoot, intent.restart_record);
  fs.unlinkSync(transitionPath(projectRoot));
  return true;
}

function readMigrationWindowVerified(projectRoot: string): MigrationWindowV1 | null {
  recoverMigrationTransition(projectRoot);
  const raw = readOptionalStateFile(projectRoot, MIGRATION_WINDOW_RELPATH, "migration window");
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("migration window is invalid JSON"); }
  const value = validateMigrationWindow(parsed);
  if (!value) throw new Error("migration window is invalid or tampered");
  verifyWindowEvidence(projectRoot, value);
  const gates = readFeatureGateRegistry(projectRoot);
  if (!gates || gates.resolver_mode !== value.mode) throw new Error("migration window and feature-gate registry are absent or disagree");
  verifyBoundMigrationRestartHistory(projectRoot, value, gates);
  return value;
}

export function readMigrationWindow(projectRoot: string): MigrationWindowV1 | null {
  try { return readMigrationWindowVerified(projectRoot); }
  catch { return null; }
}

export type MigrationWindowInspection =
  | { readonly status: "ok"; readonly window: MigrationWindowV1 }
  | { readonly status: "absent" }
  | { readonly status: "provenance_unavailable"; readonly detail: string }
  | { readonly status: "invalid_or_recovery_required" };

/** Distinguish a fail-closed remote-verification outage from damaged local state. */
export function inspectMigrationWindow(projectRoot: string): MigrationWindowInspection {
  try {
    const window = readMigrationWindowVerified(projectRoot);
    return window === null ? { status: "absent" } : { status: "ok", window };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/migration boundary GitHub (?:provenance|run) verification failed/i.test(detail)) {
      return { status: "provenance_unavailable", detail };
    }
    return { status: "invalid_or_recovery_required" };
  }
}

export function writeMigrationWindow(projectRoot: string, value: MigrationWindowV1): void {
  const valid = validateMigrationWindow(value); if (!valid) throw new Error("invalid migration window");
  const root = fs.realpathSync(projectRoot); const target = path.join(root, MIGRATION_WINDOW_RELPATH);
  const written = writeContainedFile(root, target, Buffer.from(`${JSON.stringify(valid, null, 2)}\n`), { policy: "physical" });
  if (!written.written) throw new Error(`migration window write refused [${written.code}]: ${written.detail}`);
}

export function startMigrationWindow(options: { projectRoot: string; projectId: string; mode: CapabilityResolverMode; boundaryPath: string; actor: string }): MigrationWindowV1 {
  recoverMigrationTransition(options.projectRoot);
  if (options.mode !== "observe") throw new Error("a migration window must enter at observe; later modes require evidence-bound advance");
  const root = fs.realpathSync(options.projectRoot); const windowPath = path.join(root, MIGRATION_WINDOW_RELPATH);
  try { fs.lstatSync(windowPath); throw new Error("migration window already exists or is invalid"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const attested = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot);
  const enteredAt = new Date(Math.max(Date.parse(attested.boundary.merged_at), Date.parse(attested.verified_at))).toISOString();
  const value = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, project_id: options.projectId, mode: "observe", entered_at: enteredAt, entry_boundary: attested.boundary, releases: [], observations: [], completed_phases: [], actor: options.actor });
  if (!value) throw new Error("invalid migration-window start");
  const gatePath = path.join(root, FEATURE_GATE_RELPATH); let gateExists = false;
  try { fs.lstatSync(gatePath); gateExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (gateExists && !gates) throw new Error("capability feature-gate registry exists but is invalid");
  if (gates && gates.resolver_mode !== "legacy" && gates.resolver_mode !== "observe") throw new Error(`cannot start observe migration from feature-gate mode ${gates.resolver_mode}`);
  const nextGates: CapabilityFeatureGateRegistryV1 = gates?.resolver_mode === "observe" ? gates : gates ? { ...gates, resolver_mode: "observe", revision: gates.revision + 1, updated_at: enteredAt, updated_by: options.actor, history: [...gates.history, { from: "legacy", to: "observe", reason: "D03 migration-window start", recorded_at: enteredAt, actor: options.actor }] } : { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "observe", revision: 0, updated_at: enteredAt, updated_by: options.actor, history: [] };
  const intent = writeTransitionIntent(options.projectRoot, "start", null, gates, value, nextGates); applyMigrationTransition(options.projectRoot, intent); return value;
}

function restartHash(value: Omit<MigrationRestartRecordV1, "restart_hash">): string { return sha256(canonical(value)); }

export function validateMigrationRestartRecord(value: unknown): MigrationRestartRecordV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schema_version", "project_id", "reason", "actor", "restarted_at", "prior_window", "next_window", "restart_hash"])
    || record.schema_version !== MIGRATION_RESTART_SCHEMA
    || typeof record.project_id !== "string"
    || typeof record.reason !== "string" || !record.reason.trim() || record.reason.length > 1024
    || typeof record.actor !== "string" || !record.actor.trim() || record.actor.length > 256
    || !canonicalInstant(record.restarted_at)
    || typeof record.restart_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.restart_hash)) return null;
  const priorWindow = validateMigrationWindow(record.prior_window);
  const nextWindow = validateMigrationWindow(record.next_window);
  if (!priorWindow || !nextWindow || priorWindow.project_id !== record.project_id || nextWindow.project_id !== record.project_id
    || (priorWindow.mode !== "observe" && priorWindow.mode !== "shadow")
    || nextWindow.mode !== priorWindow.mode || nextWindow.entered_at !== record.restarted_at
    || nextWindow.releases.length !== 0 || nextWindow.observations.length !== 0
    || canonical(nextWindow.completed_phases) !== canonical(priorWindow.completed_phases)
    || nextWindow.restart_history !== undefined
    || !priorWindow.observations.some((observation) => observation.schema_version !== MIGRATION_OBSERVATION_SCHEMA)) return null;
  const previous = lastKnownBoundary(priorWindow);
  if (!previous || !strictlyNewerBeta(previous.release, nextWindow.entry_boundary.release) || Date.parse(nextWindow.entry_boundary.merged_at) <= Date.parse(previous.merged_at)) return null;
  const candidate = {
    schema_version: MIGRATION_RESTART_SCHEMA,
    project_id: record.project_id,
    reason: record.reason,
    actor: record.actor,
    restarted_at: record.restarted_at,
    prior_window: priorWindow,
    next_window: nextWindow,
  };
  if (restartHash(candidate) !== record.restart_hash) return null;
  return Object.freeze({ ...candidate, restart_hash: record.restart_hash });
}

function writeMigrationRestartRecord(projectRoot: string, record: MigrationRestartRecordV1): string {
  const valid = validateMigrationRestartRecord(record);
  if (!valid) throw new Error("invalid migration restart record");
  const relativePath = `${MIGRATION_RESTART_HISTORY_RELPATH}/${valid.restart_hash}.json`;
  const target = path.join(fs.realpathSync(projectRoot), relativePath);
  const bytes = Buffer.from(`${JSON.stringify(valid, null, 2)}\n`);
  const prior = readOptionalStateFile(projectRoot, relativePath, "migration restart history");
  if (prior !== null) {
    if (prior !== bytes.toString("utf8")) throw new Error("migration restart history hash collision or replacement attempt");
    return relativePath;
  }
  const written = writeContainedFile(projectRoot, target, bytes, { policy: "physical" });
  if (!written.written) throw new Error(`migration restart history write refused [${written.code}]: ${written.detail}`);
  return relativePath;
}

function verifyBoundMigrationRestartHistory(projectRoot: string, window: MigrationWindowV1, gates: CapabilityFeatureGateRegistryV1): void {
  const restartEntries = gates.history.filter((entry) => entry.from === entry.to
    && (entry.from === "observe" || entry.from === "shadow")
    && entry.reason.startsWith(MIGRATION_RESTART_REASON_PREFIX));
  if (!window.restart_history) {
    if (restartEntries.length > 0) throw new Error("migration restart feature-gate history is detached from the live window");
    return;
  }
  const { path: relativePath, sha256: restartHash } = window.restart_history;
  const matchingEntries = restartEntries.filter((entry) => entry.reason === migrationRestartReason(restartHash));
  if (matchingEntries.length !== 1) throw new Error("migration restart feature-gate history is absent, duplicated, or not hash-bound");
  const entry = matchingEntries[0];
    const raw = readOptionalStateFile(projectRoot, relativePath, "migration restart history");
    if (raw === null) throw new Error(`migration restart history is missing: ${relativePath}`);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error(`migration restart history is invalid JSON: ${relativePath}`); }
    const restart = validateMigrationRestartRecord(parsed);
    if (!restart || restart.restart_hash !== restartHash) throw new Error(`migration restart history is invalid or tampered: ${relativePath}`);
    if (restart.project_id !== window.project_id || restart.restarted_at !== entry.recorded_at || restart.actor !== entry.actor) {
      throw new Error(`migration restart history is detached from feature-gate state: ${relativePath}`);
    }
    verifyWindowEvidence(projectRoot, restart.prior_window);
    verifyWindowEvidence(projectRoot, restart.next_window);
    const currentSuccessor = window.mode === restart.next_window.mode
      && canonical(window.completed_phases) === canonical(restart.next_window.completed_phases)
      && window.entered_at === restart.next_window.entered_at
      && window.entry_boundary.boundary_hash === restart.next_window.entry_boundary.boundary_hash;
    const completedSuccessor = window.completed_phases.some((phase) => phase.mode === restart.next_window.mode && phase.entered_at === restart.next_window.entered_at);
  if (!currentSuccessor && !completedSuccessor) throw new Error(`migration restart history is not an ancestor of the live window: ${relativePath}`);
}

/**
 * Upgrade a legacy-observation window to the baseline-bound v2 contract.
 * This is deliberately not a general timer-reset API: a current observe or shadow window
 * must contain legacy observations, the replacement boundary must be a strictly
 * newer attested beta, and the full prior state is retained content-addressably.
 */
export function restartMigrationWindow(options: { projectRoot: string; boundaryPath: string; actor: string; reason: string }) {
  recoverMigrationTransition(options.projectRoot);
  const current = readMigrationWindowVerified(options.projectRoot);
  if (!current) throw new Error("migration window is absent");
  if ((current.mode !== "observe" && current.mode !== "shadow") || !current.observations.some((observation) => observation.schema_version !== MIGRATION_OBSERVATION_SCHEMA)) {
    throw new Error("migration restart is only allowed for an observe or shadow window containing legacy observations");
  }
  if (!options.reason.trim() || options.reason.length > 1024) throw new Error("migration restart requires a bounded non-empty reason");
  if (!options.actor.trim() || options.actor.length > 256) throw new Error("migration restart requires a bounded non-empty actor");
  const attested = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot);
  const previous = lastKnownBoundary(current);
  if (!previous || !strictlyNewerBeta(previous.release, attested.boundary.release) || Date.parse(attested.boundary.merged_at) <= Date.parse(previous.merged_at)) {
    throw new Error("migration restart requires a strictly newer beta with a later GitHub push instant");
  }
  const restartedAt = new Date(Math.max(Date.parse(attested.boundary.merged_at), Date.parse(attested.verified_at))).toISOString();
  const baseNext = validateMigrationWindow({
    schema_version: MIGRATION_WINDOW_SCHEMA,
    project_id: current.project_id,
    mode: current.mode,
    entered_at: restartedAt,
    entry_boundary: attested.boundary,
    releases: [],
    observations: [],
    completed_phases: current.completed_phases,
    actor: options.actor,
  });
  if (!baseNext) throw new Error("invalid migration-window restart successor");
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (!gates || gates.resolver_mode !== current.mode) throw new Error(`migration restart requires a valid ${current.mode} feature-gate registry`);
  const restart = validateMigrationRestartRecord({
    schema_version: MIGRATION_RESTART_SCHEMA,
    project_id: current.project_id,
    reason: options.reason,
    actor: options.actor,
    restarted_at: restartedAt,
    prior_window: current,
    next_window: baseNext,
    restart_hash: restartHash({ schema_version: MIGRATION_RESTART_SCHEMA, project_id: current.project_id, reason: options.reason, actor: options.actor, restarted_at: restartedAt, prior_window: current, next_window: baseNext }),
  });
  if (!restart) throw new Error("migration restart record failed validation");
  const restartRef = Object.freeze({ path: `${MIGRATION_RESTART_HISTORY_RELPATH}/${restart.restart_hash}.json`, sha256: restart.restart_hash });
  const next = validateMigrationWindow({ ...baseNext, restart_history: restartRef });
  if (!next) throw new Error("migration-window restart successor binding failed validation");
  const nextGates: CapabilityFeatureGateRegistryV1 = {
    ...gates,
    revision: gates.revision + 1,
    updated_at: restartedAt,
    updated_by: options.actor,
    history: [...gates.history, { from: current.mode, to: current.mode, reason: migrationRestartReason(restart.restart_hash), recorded_at: restartedAt, actor: options.actor }],
  };
  const historyPath = restartRef.path;
  const intent = writeTransitionIntent(options.projectRoot, "restart", current, gates, next, nextGates, restart);
  applyMigrationTransition(options.projectRoot, intent);
  return Object.freeze({ status: "restarted" as const, window: next, history_path: historyPath, restart_hash: restart.restart_hash });
}

function lastKnownBoundary(window: MigrationWindowV1): MigrationBoundaryV1 | null {
  if (window.releases.length > 0) return window.releases[window.releases.length - 1];
  return window.entry_boundary;
}

export function recordMigrationRelease(options: { projectRoot: string; boundaryPath: string; observationPath: string }): MigrationWindowV1 {
  const current = readMigrationWindowVerified(options.projectRoot); if (!current) throw new Error("migration window is absent");
  if (current.mode !== "observe" && current.mode !== "shadow") throw new Error(`mode ${current.mode} does not collect migration observations`);
  const boundary = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot).boundary; const observation = loadMigrationObservation(options.projectRoot, path.resolve(options.observationPath));
  if (observation.schema_version !== MIGRATION_OBSERVATION_SCHEMA) throw new Error("migration release requires a baseline-bound v2 observation");
  if (observation.runs.some((run) => !("session_context" in run) || !("source_provenance_sha256" in run) || !("source_session_context_sha256" in run))) throw new Error("migration release requires a scrub-clean session-bound public projection");
  if (current.observations.some((entry) => entry.schema_version !== MIGRATION_OBSERVATION_SCHEMA)) throw new Error("migration window contains legacy observations; restart at a newer attested beta before recording v2 evidence");
  if (observation.project_id !== current.project_id) throw new Error(`migration observation project ${observation.project_id} does not match window project ${current.project_id}`);
  if (Date.parse(observation.observed_at) < Date.parse(current.entered_at)) throw new Error(`${current.mode} evidence predates entry into the current migration phase`);
  const existingIndex = current.releases.findIndex((entry) => entry.boundary_hash === boundary.boundary_hash);
  if (existingIndex >= 0) {
    if (canonical(current.releases[existingIndex]) === canonical(boundary) && canonical(current.observations[existingIndex]) === canonical(observation)) return current;
    throw new Error("migration release collision refuses replacement of an existing boundary observation");
  }
  const previous = lastKnownBoundary(current);
  const reusesEntryBoundary = current.releases.length === 0 && current.entry_boundary.boundary_hash === boundary.boundary_hash;
  if (!reusesEntryBoundary && previous && (!strictlyNewerBeta(previous.release, boundary.release) || Date.parse(boundary.merged_at) <= Date.parse(previous.merged_at))) throw new Error("migration release boundary must be a strictly newer beta with a later GitHub push instant");
  const next = validateMigrationWindow({ ...current, releases: [...current.releases, boundary], observations: [...current.observations, observation] });
  if (!next) throw new Error("migration release boundary does not extend the verified window");
  writeMigrationWindow(options.projectRoot, next); return next;
}

export function evaluateMigrationAdvance(window: MigrationWindowV1, to: CapabilityResolverMode, nextBoundary: MigrationBoundaryV1) {
  const transition = planModeTransition({ from: window.mode, to, reason: "migration-window", allow_skip: false });
  const elapsedDays = Math.floor((Date.parse(nextBoundary.merged_at) - Date.parse(window.entered_at)) / 86_400_000); const blockers: string[] = [];
  const last = lastKnownBoundary(window);
  if (last && (!strictlyNewerBeta(last.release, nextBoundary.release) || Date.parse(nextBoundary.merged_at) <= Date.parse(last.merged_at))) blockers.push("next mode boundary must be a strictly newer beta with a later GitHub push instant");
  if (transition.status !== "allowed" || transition.direction !== "advance" || transition.rungs !== 1) blockers.push("target is not the next resolver rung");
  const baselineBoundObservations = window.observations.filter((observation) => observation.schema_version === MIGRATION_OBSERVATION_SCHEMA);
  if ((window.mode === "observe" || window.mode === "shadow") && baselineBoundObservations.length < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} baseline-bound v2 releases in ${window.mode}`);
  if ((window.mode === "observe" || window.mode === "shadow") && elapsedDays < MIN_DAYS_PER_MODE) blockers.push(`need >=${MIN_DAYS_PER_MODE} days in ${window.mode}`);
  const distinctRuns = new Set(baselineBoundObservations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if ((window.mode === "observe" || window.mode === "shadow") && distinctRuns < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct whole-run profiles in ${window.mode}`);
  const passed = blockers.length === 0;
  return {
    passed,
    blockers,
    elapsed_days: elapsedDays,
    release_count: baselineBoundObservations.length,
    run_count: distinctRuns,
    conformance: Object.freeze({
      schema_version: MIGRATION_ADVANCE_CONFORMANCE_SCHEMA,
      decision: passed ? "passed" as const : "refused" as const,
      basis: "attested-boundaries+package-bound-whole-run-observations+ordered-resolver-transition" as const,
    }),
  };
}

/** Recovery-only evaluator matching the v1 transition producer's admission rules. */
function evaluateLegacyMigrationAdvance(window: MigrationWindowV1, to: CapabilityResolverMode, nextBoundary: MigrationBoundaryV1) {
  const transition = planModeTransition({ from: window.mode, to, reason: "migration-window", allow_skip: false });
  const elapsedDays = Math.floor((Date.parse(nextBoundary.merged_at) - Date.parse(window.entered_at)) / 86_400_000);
  const blockers: string[] = [];
  const last = lastKnownBoundary(window);
  if (last && (!strictlyNewerBeta(last.release, nextBoundary.release) || Date.parse(nextBoundary.merged_at) <= Date.parse(last.merged_at))) blockers.push("next mode boundary must be a strictly newer beta with a later GitHub push instant");
  if (transition.status !== "allowed" || transition.direction !== "advance" || transition.rungs !== 1) blockers.push("target is not the next resolver rung");
  if ((window.mode === "observe" || window.mode === "shadow") && window.releases.length < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct releases in ${window.mode}`);
  if ((window.mode === "observe" || window.mode === "shadow") && elapsedDays < MIN_DAYS_PER_MODE) blockers.push(`need >=${MIN_DAYS_PER_MODE} days in ${window.mode}`);
  const distinctRuns = new Set(window.observations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if ((window.mode === "observe" || window.mode === "shadow") && distinctRuns < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct whole-run profiles in ${window.mode}`);
  return { passed: blockers.length === 0, blockers };
}

export function advanceMigrationWindow(options: { projectRoot: string; to: CapabilityResolverMode; boundaryPath: string; actor: string }) {
  try { recoverMigrationTransition(options.projectRoot); }
  catch (error) { return { status: "refused" as const, blockers: [`migration transition recovery failed: ${(error as Error).message}`] }; }
  let current: MigrationWindowV1 | null;
  try { current = readMigrationWindowVerified(options.projectRoot); }
  catch (error) { return { status: "refused" as const, blockers: [`migration-window verification failed: ${(error as Error).message}`] }; }
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (!current || !gates || current.mode !== gates.resolver_mode) return { status: "refused" as const, blockers: ["migration-window and feature-gate state are absent or disagree"] };
  const attested = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot); const boundary = attested.boundary; const verdict = evaluateMigrationAdvance(current, options.to, boundary);
  if (!verdict.passed) return { status: "refused" as const, blockers: verdict.blockers };
  const completed = current.mode === "observe" || current.mode === "shadow" ? [...current.completed_phases, { mode: current.mode, entered_at: current.entered_at, releases: current.releases, observations: current.observations, advanced_with: boundary }] : current.completed_phases;
  const enteredAt = new Date(Math.max(Date.parse(boundary.merged_at), Date.parse(attested.verified_at))).toISOString();
  const nextWindow = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, project_id: current.project_id, mode: options.to, entered_at: enteredAt, entry_boundary: boundary, releases: [], observations: [], completed_phases: completed, actor: options.actor, ...(current.restart_history ? { restart_history: current.restart_history } : {}) });
  if (!nextWindow) return { status: "refused" as const, blockers: ["next migration phase is invalid"] };
  const nextGate: CapabilityFeatureGateRegistryV1 = { ...gates, resolver_mode: options.to, revision: gates.revision + 1, updated_at: enteredAt, updated_by: options.actor, history: [...gates.history, { from: current.mode, to: options.to, reason: "D03 migration-window advance", recorded_at: enteredAt, actor: options.actor }] };
  const intent = writeTransitionIntent(options.projectRoot, "advance", current, gates, nextWindow, nextGate);
  try { applyMigrationTransition(options.projectRoot, intent); }
  catch (error) { return { status: "failed" as const, blockers: [`transition intent retained for deterministic recovery: ${(error as Error).message}`] }; }
  return { status: "advanced" as const, from: current.mode, to: options.to, revision: nextGate.revision };
}

export function legacyRemovalEligibility(options: { projectLocalDefault: string; currentVersion: string; g5Passed: boolean }) {
  const parse = (value: string) => { const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value); return match ? { major: Number(match[1]), minor: Number(match[2]) } : null; };
  const cut = parse(options.projectLocalDefault); const current = parse(options.currentVersion); const blockers: string[] = [];
  if (!cut || !current) blockers.push("removal-floor versions must be stable semantic versions");
  if (!options.g5Passed) blockers.push("G5 has not passed");
  if (current?.major === 2) blockers.push("legacy compatibility is never removed within v2");
  if (cut && current && current.major < cut.major) blockers.push("current version predates the project-local default");
  if (cut && current && current.major === cut.major && current.minor < cut.minor + 2) blockers.push("two-minor rollback floor has not elapsed");
  return { passed: blockers.length === 0, blockers };
}
