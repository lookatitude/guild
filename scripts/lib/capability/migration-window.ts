import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityResolverMode } from "../../../src/domains/config";
import { planModeTransition } from "../../../src/domains/config/index";
import { checkContained, isRefused, writeContainedFile } from "../../../src/domains/kernel/index";
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
  isSubstantiveMigrationObservation,
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
  const releaseRuns = new Set(baselineBoundObservations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  const substantiveObservations = baselineBoundObservations.filter(isSubstantiveMigrationObservation);
  const substantiveRuns = new Set(substantiveObservations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if ((window.mode === "observe" || window.mode === "shadow") && substantiveRuns < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct substantive operations in ${window.mode}; compatibility-only release observations do not qualify`);
  const passed = blockers.length === 0;
  return {
    passed,
    blockers,
    elapsed_days: elapsedDays,
    release_count: baselineBoundObservations.length,
    release_run_count: releaseRuns,
    run_count: substantiveRuns,
    substantive_run_count: substantiveRuns,
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

// ─────────────────────────────────────────────────────────────────────────────
// G02 — window v5 / transition v3 / restart v2 (A02-ratified compaction wire
// dossier, digest 54f61a6d3ab5…). Additive producers/readers only: v4 windows,
// v1/v2 transitions and v1 restarts keep their validators, hashes and recovery
// paths byte-for-byte. No reset authority is added; counters never move here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MIGRATION_BOUNDARY_EVIDENCE_RELPATH,
  MIGRATION_OBSERVATION_SCHEMA_V1,
  hydrateMigrationBoundary,
  persistMigrationBoundaryWire,
  resolveMigrationBoundaryRef,
  validateMigrationBoundaryRef,
  verifyMigrationBoundaryWireProvenance,
  type MigrationBoundaryRefV1,
  type ResolvedMigrationBoundaryView,
} from "./migration-evidence";

/** Dossier io_limits.max_window_bytes: a v5 window record never exceeds 4 MiB. */
export const MAX_MIGRATION_WINDOW_BYTES = 4_194_304;

/** Bounded variant of readOptionalStateFile: refuses oversize files BEFORE reading them. */
function readOptionalStateFileBounded(projectRoot: string, relativePath: string, label: string, maxBytes: number): string | null {
  const root = fs.realpathSync(projectRoot); const target = path.join(root, relativePath);
  try { fs.lstatSync(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const checked = checkContained(root, target, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(checked)) throw new Error(`${label} refused [${checked.code}]`);
  const descriptor = fs.openSync(checked.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) throw new Error(`${label} is not a regular file`);
    if (stats.size > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte bound`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total <= maxBytes) {
      const read = fs.readSync(descriptor, buffer, total, maxBytes + 1 - total, total);
      if (read === 0) break;
      total += read;
    }
    if (total > maxBytes) throw new Error(`${label} exceeds the ${maxBytes}-byte bound`);
    return buffer.subarray(0, total).toString("utf8");
  } finally { fs.closeSync(descriptor); }
}

export const MIGRATION_WINDOW_SCHEMA_V5 = "guild.capability_migration_window.v5" as const;
export const MIGRATION_WINDOW_V5_RELPATH = ".guild/artifacts/capability/migration-window.v5.json";
export const MIGRATION_TRANSITION_SCHEMA_V3 = "guild.capability_migration_transition.v3" as const;
export const MIGRATION_RESTART_SCHEMA_V2 = "guild.capability_migration_restart.v2" as const;

interface CompletedMigrationPhaseV5 {
  readonly mode: "observe" | "shadow";
  readonly entered_at: string;
  readonly releases: readonly MigrationBoundaryRefV1[];
  readonly observations: readonly MigrationObservation[];
  readonly advanced_with: MigrationBoundaryRefV1;
}

export interface MigrationWindowV5 {
  readonly schema_version: typeof MIGRATION_WINDOW_SCHEMA_V5;
  readonly project_id: string;
  readonly mode: CapabilityResolverMode;
  readonly entered_at: string;
  readonly entry_boundary: MigrationBoundaryRefV1;
  readonly releases: readonly MigrationBoundaryRefV1[];
  readonly observations: readonly MigrationObservation[];
  readonly completed_phases: readonly CompletedMigrationPhaseV5[];
  readonly actor: string;
  readonly restart_history?: MigrationRestartHistoryRefV1;
}

export interface MigrationRestartRecordV2 {
  readonly schema_version: typeof MIGRATION_RESTART_SCHEMA_V2;
  readonly project_id: string;
  readonly reason: string;
  readonly actor: string;
  readonly restarted_at: string;
  readonly prior_window: MigrationWindowV5;
  readonly next_window: MigrationWindowV5;
  readonly restart_hash: string;
}

export interface MigrationTransitionIntentV3 {
  readonly schema_version: typeof MIGRATION_TRANSITION_SCHEMA_V3;
  readonly operation: "start" | "advance" | "restart";
  readonly prior_window: MigrationWindowV5 | null;
  readonly prior_gates: CapabilityFeatureGateRegistryV1 | null;
  readonly next_window: MigrationWindowV5;
  readonly next_gates: CapabilityFeatureGateRegistryV1;
  readonly restart_record: MigrationRestartRecordV2 | null;
  readonly intent_hash: string;
}

function validateCompletedPhaseV5(value: unknown): CompletedMigrationPhaseV5 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["mode", "entered_at", "releases", "observations", "advanced_with"]) || (record.mode !== "observe" && record.mode !== "shadow") || !canonicalInstant(record.entered_at)) return null;
  if (!Array.isArray(record.releases) || !Array.isArray(record.observations) || record.releases.length !== record.observations.length || record.releases.length === 0) return null;
  const releases: MigrationBoundaryRefV1[] = [];
  for (const raw of record.releases) {
    const ref = validateMigrationBoundaryRef(raw);
    if (!ref || releases.some((entry) => entry.boundary_hash === ref.boundary_hash)) return null;
    releases.push(ref);
  }
  const observations: MigrationObservation[] = [];
  for (const raw of record.observations) {
    const observation = validateMigrationObservation(raw);
    if (!observation) return null;
    observations.push(observation);
  }
  if (observations.some((observation) => Date.parse(observation.observed_at) < Date.parse(record.entered_at as string))) return null;
  const advancedWith = validateMigrationBoundaryRef(record.advanced_with);
  if (!advancedWith) return null;
  return Object.freeze({ mode: record.mode, entered_at: record.entered_at, releases: Object.freeze(releases), observations: Object.freeze(observations), advanced_with: advancedWith });
}

/**
 * Pure structural validator for the v5 wire shape. Deep evidence checks that
 * need boundary CONTENT (pairing, ordering, floors) run in hydration, which is
 * the project-root-aware I/O half — kept separate per C-MIGRATION.window_v5.
 */
export function validateMigrationWindowV5(value: unknown): MigrationWindowV5 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const baseKeys = ["schema_version", "project_id", "mode", "entered_at", "entry_boundary", "releases", "observations", "completed_phases", "actor"] as const;
  const hasRestartHistory = Object.prototype.hasOwnProperty.call(record, "restart_history");
  if (!exactKeys(record, hasRestartHistory ? [...baseKeys, "restart_history"] : baseKeys)) return null;
  if (record.schema_version !== MIGRATION_WINDOW_SCHEMA_V5 || typeof record.project_id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(record.project_id) || !MODES.has(record.mode as CapabilityResolverMode) || record.mode === "legacy" || !canonicalInstant(record.entered_at) || typeof record.actor !== "string" || !record.actor || !Array.isArray(record.completed_phases)) return null;
  const mode = record.mode as CapabilityResolverMode;
  const entryBoundary = validateMigrationBoundaryRef(record.entry_boundary);
  if (!entryBoundary) return null;
  if (!Array.isArray(record.releases) || !Array.isArray(record.observations) || record.releases.length !== record.observations.length) return null;
  if (mode !== "observe" && mode !== "shadow" && record.releases.length !== 0) return null;
  const releases: MigrationBoundaryRefV1[] = [];
  for (const raw of record.releases) {
    const ref = validateMigrationBoundaryRef(raw);
    if (!ref || releases.some((entry) => entry.boundary_hash === ref.boundary_hash)) return null;
    releases.push(ref);
  }
  const observations: MigrationObservation[] = [];
  for (const raw of record.observations) {
    const observation = validateMigrationObservation(raw);
    if (!observation || Date.parse(observation.observed_at) < Date.parse(record.entered_at as string)) return null;
    observations.push(observation);
  }
  const completed: CompletedMigrationPhaseV5[] = [];
  for (const raw of record.completed_phases) {
    const phase = validateCompletedPhaseV5(raw);
    if (!phase || completed.some((entry) => entry.mode === phase.mode)) return null;
    if (phase.mode === "shadow" && !completed.some((entry) => entry.mode === "observe")) return null;
    completed.push(phase);
  }
  const expectedCompletedModes: readonly string[] = mode === "observe" ? [] : mode === "shadow" ? ["observe"] : ["observe", "shadow"];
  if (completed.map((phase) => phase.mode).join(",") !== expectedCompletedModes.join(",")) return null;
  if ([...completed.flatMap((phase) => phase.observations), ...observations].some((observation) => observation.project_id !== record.project_id)) return null;
  let restartHistory: MigrationRestartHistoryRefV1 | undefined;
  if (hasRestartHistory) {
    const ref = record.restart_history;
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) return null;
    const candidate = ref as Record<string, unknown>;
    if (!exactKeys(candidate, ["path", "sha256"]) || typeof candidate.path !== "string" || typeof candidate.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(candidate.sha256)
      || candidate.path !== `${MIGRATION_RESTART_HISTORY_RELPATH}/${candidate.sha256}.json`) return null;
    restartHistory = Object.freeze({ path: candidate.path, sha256: candidate.sha256 });
  }
  return Object.freeze({
    schema_version: MIGRATION_WINDOW_SCHEMA_V5,
    project_id: record.project_id,
    mode,
    entered_at: record.entered_at,
    entry_boundary: entryBoundary,
    releases: Object.freeze(releases),
    observations: Object.freeze(observations),
    completed_phases: Object.freeze(completed),
    actor: record.actor,
    ...(restartHistory ? { restart_history: restartHistory } : {}),
  });
}

interface HydratedMigrationPhaseV5 {
  readonly mode: "observe" | "shadow";
  readonly entered_at: string;
  readonly releases: readonly ResolvedMigrationBoundaryView[];
  readonly observations: readonly MigrationObservation[];
  readonly advanced_with: ResolvedMigrationBoundaryView;
}

export interface HydratedMigrationWindowV5 {
  readonly schema_version: typeof MIGRATION_WINDOW_SCHEMA_V5;
  readonly project_id: string;
  readonly mode: CapabilityResolverMode;
  readonly entered_at: string;
  readonly entry_boundary: ResolvedMigrationBoundaryView;
  readonly releases: readonly ResolvedMigrationBoundaryView[];
  readonly observations: readonly MigrationObservation[];
  readonly completed_phases: readonly HydratedMigrationPhaseV5[];
  readonly actor: string;
  readonly restart_history?: MigrationRestartHistoryRefV1;
}

function pairHydratedEvidence(view: ResolvedMigrationBoundaryView, observation: MigrationObservation, mode: "observe" | "shadow"): boolean {
  const runtimePackageMatches = Object.values(view.packages).some((runtimePackage) => runtimePackage.host_id === observation.runtime_package.host_id
    && runtimePackage.manifest_path === observation.runtime_package.manifest_path
    && runtimePackage.manifest_sha256 === observation.runtime_package.manifest_sha256
    && runtimePackage.producer_sha256 === observation.runtime_package.producer_sha256
    && runtimePackage.tree_sha256 === observation.runtime_package.tree_sha256
    && runtimePackage.install_surface_sha256 === observation.runtime_package.install_surface_sha256);
  return observation.mode === mode
    && observation.boundary_hash === view.boundary_hash
    && observation.boundary_release === view.release
    && observation.boundary_source_commit === view.source_commit
    && observation.boundary_merged_at === view.merged_at
    && runtimePackageMatches;
}

function hydrateSeries(projectRoot: string, refs: readonly MigrationBoundaryRefV1[], observations: readonly MigrationObservation[], mode: "observe" | "shadow"): readonly ResolvedMigrationBoundaryView[] {
  const views: ResolvedMigrationBoundaryView[] = [];
  const versions = new Set<string>(); const commits = new Set<string>();
  for (let index = 0; index < refs.length; index += 1) {
    const view = hydrateMigrationBoundary(projectRoot, resolveMigrationBoundaryRef(projectRoot, refs[index]));
    const observation = observations[index];
    if (!pairHydratedEvidence(view, observation, mode)) throw new Error(`migration window v5 release ${index} does not pair with its observation`);
    if (versions.has(view.release) || commits.has(view.source_commit)) throw new Error(`migration window v5 release ${view.release} repeats a version or commit`);
    const prior = views[index - 1];
    if (prior && (!strictlyNewerBeta(prior.release, view.release) || Date.parse(view.merged_at) <= Date.parse(prior.merged_at))) throw new Error("migration window v5 releases are not strictly newer attested betas");
    versions.add(view.release); commits.add(view.source_commit); views.push(view);
  }
  return Object.freeze(views);
}

/**
 * Resolve every boundary ref of a v5 window to the exact original signed bytes
 * (raw digest verified BEFORE parse; wire-version dispatch to the original
 * validator; v2 manifests resolved with full identity validation), then run the
 * same pairing/ordering/floor checks the v4 validator applies to embedded
 * boundaries. Counters still come only from the production verifier.
 */
export function hydrateMigrationWindowV5(projectRoot: string, value: unknown): HydratedMigrationWindowV5 {
  const window = validateMigrationWindowV5(value);
  if (!window) throw new Error("migration window v5 record is invalid");
  const entryView = hydrateMigrationBoundary(projectRoot, resolveMigrationBoundaryRef(projectRoot, window.entry_boundary));
  if (Date.parse(entryView.merged_at) > Date.parse(window.entered_at)) throw new Error("migration window v5 entry boundary postdates the phase entry");
  const seriesViews = window.mode === "observe" || window.mode === "shadow"
    ? hydrateSeries(projectRoot, window.releases, window.observations, window.mode)
    : Object.freeze([] as ResolvedMigrationBoundaryView[]);
  const completed: HydratedMigrationPhaseV5[] = [];
  for (const phase of window.completed_phases) {
    const releases = hydrateSeries(projectRoot, phase.releases, phase.observations, phase.mode);
    if (releases.length < MIN_RELEASES_PER_MODE) throw new Error(`completed ${phase.mode} phase has fewer than ${MIN_RELEASES_PER_MODE} releases`);
    const distinctRuns = new Set(phase.observations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
    if (distinctRuns < MIN_RELEASES_PER_MODE) throw new Error(`completed ${phase.mode} phase has fewer than ${MIN_RELEASES_PER_MODE} distinct runs`);
    const advancedWith = hydrateMigrationBoundary(projectRoot, resolveMigrationBoundaryRef(projectRoot, phase.advanced_with));
    const last = releases[releases.length - 1];
    if (!strictlyNewerBeta(last.release, advancedWith.release) || Date.parse(advancedWith.merged_at) <= Date.parse(last.merged_at)) throw new Error(`completed ${phase.mode} phase advance boundary is not strictly newer`);
    if (Date.parse(advancedWith.merged_at) - Date.parse(phase.entered_at) < MIN_DAYS_PER_MODE * 86_400_000) throw new Error(`completed ${phase.mode} phase is shorter than the ${MIN_DAYS_PER_MODE}-day floor`);
    completed.push(Object.freeze({ mode: phase.mode, entered_at: phase.entered_at, releases, observations: phase.observations, advanced_with: advancedWith }));
  }
  return Object.freeze({ ...window, entry_boundary: entryView, releases: seriesViews, completed_phases: Object.freeze(completed) });
}

function distinctWindowV5Refs(window: MigrationWindowV5): readonly MigrationBoundaryRefV1[] {
  const refs = new Map<string, MigrationBoundaryRefV1>();
  refs.set(window.entry_boundary.sha256, window.entry_boundary);
  for (const ref of window.releases) refs.set(ref.sha256, ref);
  for (const phase of window.completed_phases) {
    for (const ref of phase.releases) refs.set(ref.sha256, ref);
    refs.set(phase.advanced_with.sha256, phase.advanced_with);
  }
  return [...refs.values()];
}

/**
 * The v5 equivalent of verifyWindowEvidence: every observation re-verifies
 * against this project root, and every referenced boundary re-establishes
 * REMOTE provenance over its exact stored bytes. Offline / 401 / 403 / 429 /
 * missing-gh failures therefore refuse here, with the local evidence left
 * intact and nothing relabelled as remotely verified.
 */
export function verifyWindowEvidenceV5(projectRoot: string, window: MigrationWindowV5, gates?: CapabilityFeatureGateRegistryV1 | null): void {
  for (const phase of [...window.completed_phases, window]) {
    for (const observation of phase.observations) verifyMigrationObservation(projectRoot, observation);
  }
  for (const ref of distinctWindowV5Refs(window)) verifyMigrationBoundaryWireProvenance(projectRoot, ref);
  verifyMigrationWindowV5RestartHistory(projectRoot, window, gates ?? null);
}

/**
 * A v5 window carrying restart_history must resolve to an intact, hash-bound
 * restart record — v1 or v2, validated by ITS OWN schema's validator — whose
 * next_window is an ancestor of the live window. Deleted or detached history
 * refuses; when gates are supplied the hash-bound gate-history entry must be
 * present exactly once (same binding rule as the v4 verifier).
 */
export function verifyMigrationWindowV5RestartHistory(projectRoot: string, window: MigrationWindowV5, gates: CapabilityFeatureGateRegistryV1 | null): void {
  const restartEntries = gates === null ? [] : gates.history.filter((entry) => entry.from === entry.to
    && (entry.from === "observe" || entry.from === "shadow")
    && entry.reason.startsWith(MIGRATION_RESTART_REASON_PREFIX));
  if (!window.restart_history) {
    // Gate history claiming a restart with no window binding is detachment,
    // exactly as the v4 verifier treats it.
    if (restartEntries.length > 0) throw new Error("migration restart feature-gate history is detached from the live window");
    return;
  }
  const { path: relativePath, sha256: restartSha } = window.restart_history;
  let gateEntry: CapabilityFeatureGateRegistryV1["history"][number] | null = null;
  if (gates) {
    const matching = restartEntries.filter((entry) => entry.reason === migrationRestartReason(restartSha));
    if (matching.length !== 1) throw new Error("migration restart feature-gate history is absent, duplicated, or not hash-bound");
    gateEntry = matching[0];
  }
  const raw = readOptionalStateFileBounded(projectRoot, relativePath, "migration restart history", MAX_MIGRATION_WINDOW_BYTES * 4);
  if (raw === null) throw new Error(`migration restart history is missing: ${relativePath}`);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`migration restart history is invalid JSON: ${relativePath}`); }
  const version = (parsed as Record<string, unknown> | null)?.schema_version;
  if (version === MIGRATION_RESTART_SCHEMA) {
    const restart = validateMigrationRestartRecord(parsed);
    if (!restart || restart.restart_hash !== restartSha) throw new Error(`migration restart history is invalid or tampered: ${relativePath}`);
    if (restart.project_id !== window.project_id) throw new Error(`migration restart history is detached from the live window: ${relativePath}`);
    if (gateEntry && (restart.restarted_at !== gateEntry.recorded_at || restart.actor !== gateEntry.actor)) {
      throw new Error(`migration restart history is detached from feature-gate state: ${relativePath}`);
    }
    // The archived v1 windows re-verify with the UNCHANGED v4 evidence verifier
    // (observations + persisted-boundary provenance).
    verifyWindowEvidence(projectRoot, restart.prior_window);
    verifyWindowEvidence(projectRoot, restart.next_window);
    const currentSuccessor = window.mode === restart.next_window.mode
      && window.entered_at === restart.next_window.entered_at
      && window.entry_boundary.boundary_hash === restart.next_window.entry_boundary.boundary_hash
      && completedPhasesSemanticallyEqualV1(projectRoot, window.completed_phases, restart.next_window.completed_phases);
    const completedSuccessor = window.completed_phases.some((phase) => phase.mode === restart.next_window.mode && phase.entered_at === restart.next_window.entered_at);
    if (!currentSuccessor && !completedSuccessor) throw new Error(`migration restart history is not an ancestor of the live window: ${relativePath}`);
    return;
  }
  if (version === MIGRATION_RESTART_SCHEMA_V2) {
    const restart = verifyMigrationRestartRecordV2(projectRoot, parsed);
    if (restart.restart_hash !== restartSha) throw new Error(`migration restart history is invalid or tampered: ${relativePath}`);
    if (restart.project_id !== window.project_id) throw new Error(`migration restart history is detached from the live window: ${relativePath}`);
    if (gateEntry && (restart.restarted_at !== gateEntry.recorded_at || restart.actor !== gateEntry.actor)) {
      throw new Error(`migration restart history is detached from feature-gate state: ${relativePath}`);
    }
    // Re-prove the archived windows' retained evidence (observations + remote
    // provenance per distinct ref). The archived records carry no
    // restart_history of their own, so this recursion terminates.
    verifyWindowEvidenceV5(projectRoot, restart.prior_window, null);
    verifyWindowEvidenceV5(projectRoot, restart.next_window, null);
    const currentSuccessor = window.mode === restart.next_window.mode
      && window.entered_at === restart.next_window.entered_at
      && window.entry_boundary.boundary_hash === restart.next_window.entry_boundary.boundary_hash
      && canonical(window.completed_phases) === canonical(restart.next_window.completed_phases);
    const completedSuccessor = window.completed_phases.some((phase) => phase.mode === restart.next_window.mode && phase.entered_at === restart.next_window.entered_at);
    if (!currentSuccessor && !completedSuccessor) throw new Error(`migration restart history is not an ancestor of the live window: ${relativePath}`);
    return;
  }
  throw new Error(`migration restart history has an unknown schema_version: ${String(version)}`);
}

/**
 * Semantic equality of a v5 window's completed phases against a v1 record's
 * embedded completed phases: each ref is RESOLVED to its original stored
 * record (raw digest verified) before its boundary identity is compared, and
 * observations compare canonically. Length-only comparison would let a
 * substituted valid phase keep the restart binding.
 */
function completedPhasesSemanticallyEqualV1(projectRoot: string, refPhases: MigrationWindowV5["completed_phases"], embeddedPhases: MigrationWindowV1["completed_phases"]): boolean {
  if (refPhases.length !== embeddedPhases.length) return false;
  for (let index = 0; index < refPhases.length; index += 1) {
    const refPhase = refPhases[index];
    const embedded = embeddedPhases[index];
    if (refPhase.mode !== embedded.mode || refPhase.entered_at !== embedded.entered_at) return false;
    if (refPhase.releases.length !== embedded.releases.length) return false;
    if (canonical(refPhase.observations) !== canonical(embedded.observations)) return false;
    for (let release = 0; release < refPhase.releases.length; release += 1) {
      const resolved = resolveMigrationBoundaryRef(projectRoot, refPhase.releases[release]);
      if (resolved.boundary.boundary_hash !== embedded.releases[release].boundary_hash) return false;
    }
    const advancedWith = resolveMigrationBoundaryRef(projectRoot, refPhase.advanced_with);
    if (advancedWith.boundary.boundary_hash !== embedded.advanced_with.boundary_hash) return false;
  }
  return true;
}

/** Hydration plus full evidence verification (observations + remote provenance + restart history). */
export function hydrateMigrationWindowV5Verified(projectRoot: string, value: unknown, gates?: CapabilityFeatureGateRegistryV1 | null): HydratedMigrationWindowV5 {
  const window = validateMigrationWindowV5(value);
  if (!window) throw new Error("migration window v5 record is invalid");
  const hydrated = hydrateMigrationWindowV5(projectRoot, window);
  verifyWindowEvidenceV5(projectRoot, window, gates);
  return hydrated;
}

/**
 * Evaluate the advance predicate over a hydrated v5 window. The counter
 * algorithm is EXACTLY the v4 evaluateMigrationAdvance (C-MIGRATION pins it);
 * a hydrated view carries the same fields that algorithm reads.
 */
export function evaluateMigrationAdvanceV5(projectRoot: string, value: unknown, to: CapabilityResolverMode, nextBoundary: { release: string; merged_at: string }): ReturnType<typeof evaluateMigrationAdvance> {
  const hydrated = hydrateMigrationWindowV5(projectRoot, value);
  return evaluateMigrationAdvance(hydrated as unknown as MigrationWindowV1, to, nextBoundary as MigrationBoundaryV1);
}

/**
 * Write a NEW v5 record whose refs point at the preserved original boundary
 * bytes. The stored v4 window is never rewritten; this is the explicit
 * migration producer, not an in-place upgrade. Refuses when a differing v5
 * record already exists (immutability of the migrated record).
 */
export function migrateMigrationWindowV4ToV5(projectRoot: string): { window: MigrationWindowV5; path: string } {
  const current = readMigrationWindow(projectRoot);
  if (!current) throw new Error("no valid v4 migration window to migrate");
  const refByHash = new Map<string, MigrationBoundaryRefV1>();
  const refFor = (boundary: MigrationBoundaryV1): MigrationBoundaryRefV1 => {
    const known = refByHash.get(boundary.boundary_hash);
    if (known) return known;
    // Prefer the exact persisted original bytes; the embedded window copy is
    // only a fallback for boundaries whose artifact was never persisted.
    const persisted = readOptionalStateFile(projectRoot, `${MIGRATION_BOUNDARY_EVIDENCE_RELPATH}/${boundary.boundary_hash}/boundary.json`, "persisted migration boundary");
    const bytes = persisted !== null ? Buffer.from(persisted, "utf8") : Buffer.from(`${JSON.stringify(boundary, null, 2)}\n`, "utf8");
    const parsed = validateMigrationBoundary(JSON.parse(bytes.toString("utf8")));
    if (!parsed || parsed.boundary_hash !== boundary.boundary_hash) throw new Error(`persisted boundary bytes do not match window state: ${boundary.boundary_hash}`);
    const ref = persistMigrationBoundaryWire(projectRoot, bytes);
    refByHash.set(boundary.boundary_hash, ref);
    return ref;
  };
  const candidate = {
    schema_version: MIGRATION_WINDOW_SCHEMA_V5,
    project_id: current.project_id,
    mode: current.mode,
    entered_at: current.entered_at,
    entry_boundary: refFor(current.entry_boundary),
    releases: current.releases.map(refFor),
    observations: current.observations,
    completed_phases: current.completed_phases.map((phase) => ({
      mode: phase.mode,
      entered_at: phase.entered_at,
      releases: phase.releases.map(refFor),
      observations: phase.observations,
      advanced_with: refFor(phase.advanced_with),
    })),
    actor: current.actor,
    ...(current.restart_history ? { restart_history: current.restart_history } : {}),
  };
  const window = validateMigrationWindowV5(JSON.parse(JSON.stringify(candidate)));
  if (!window) throw new Error("migrated v5 migration window is invalid");
  const serialized = `${JSON.stringify(window, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_MIGRATION_WINDOW_BYTES) throw new Error(`migration window v5 record exceeds the ${MAX_MIGRATION_WINDOW_BYTES}-byte bound`);
  const existing = readOptionalStateFileBounded(projectRoot, MIGRATION_WINDOW_V5_RELPATH, "migration window v5", MAX_MIGRATION_WINDOW_BYTES);
  if (existing !== null && existing !== serialized) throw new Error("migration window v5 collision refuses replacement");
  if (existing === null) {
    const target = path.join(fs.realpathSync(projectRoot), MIGRATION_WINDOW_V5_RELPATH);
    const written = writeContainedFile(projectRoot, target, serialized, { policy: "physical" });
    if (!written.written) throw new Error(`migration window v5 write refused [${written.code}]`);
  }
  return { window, path: MIGRATION_WINDOW_V5_RELPATH };
}

export function readMigrationWindowV5(projectRoot: string): MigrationWindowV5 | null {
  const raw = readOptionalStateFileBounded(projectRoot, MIGRATION_WINDOW_V5_RELPATH, "migration window v5", MAX_MIGRATION_WINDOW_BYTES);
  if (raw === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("migration window v5 record is not valid JSON"); }
  const window = validateMigrationWindowV5(parsed);
  if (!window) throw new Error("migration window v5 record is invalid");
  return window;
}

function writeMigrationWindowV5Record(projectRoot: string, value: MigrationWindowV5): void {
  const valid = validateMigrationWindowV5(JSON.parse(JSON.stringify(value)));
  if (!valid) throw new Error("invalid migration window v5");
  const serialized = `${JSON.stringify(valid, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_MIGRATION_WINDOW_BYTES) throw new Error(`migration window v5 record exceeds the ${MAX_MIGRATION_WINDOW_BYTES}-byte bound`);
  const target = path.join(fs.realpathSync(projectRoot), MIGRATION_WINDOW_V5_RELPATH);
  const written = writeContainedFile(projectRoot, target, Buffer.from(serialized), { policy: "physical" });
  if (!written.written) throw new Error(`migration window v5 write refused [${written.code}]`);
}

function restartHashV2(value: Omit<MigrationRestartRecordV2, "restart_hash">): string { return sha256(canonical(value)); }
function transitionHashV3(value: Omit<MigrationTransitionIntentV3, "intent_hash">): string { return sha256(canonical(value)); }

export function validateMigrationRestartRecordV2(value: unknown): MigrationRestartRecordV2 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schema_version", "project_id", "reason", "actor", "restarted_at", "prior_window", "next_window", "restart_hash"])) return null;
  if (record.schema_version !== MIGRATION_RESTART_SCHEMA_V2 || typeof record.project_id !== "string" || !record.project_id
    || typeof record.reason !== "string" || !record.reason.trim() || record.reason.length > 1024
    || typeof record.actor !== "string" || !record.actor.trim() || record.actor.length > 256
    || !canonicalInstant(record.restarted_at)) return null;
  if (typeof record.restart_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.restart_hash)) return null;
  const priorWindow = validateMigrationWindowV5(record.prior_window);
  const nextWindow = validateMigrationWindowV5(record.next_window);
  if (!priorWindow || !nextWindow || priorWindow.project_id !== record.project_id || nextWindow.project_id !== record.project_id) return null;
  // UNCHANGED v1 authority: restart only upgrades a window still carrying
  // legacy (v1-schema) observations. A v2-only window must refuse; restart v2
  // changes the carrier shape only, never the precondition.
  if (priorWindow.mode !== "observe" && priorWindow.mode !== "shadow") return null;
  if (!priorWindow.observations.some((observation) => observation.schema_version === MIGRATION_OBSERVATION_SCHEMA_V1)) return null;
  // Same successor-state constraints as the v1 restart validator: identical
  // mode, a fresh series at restarted_at, retained completed history, a NEW
  // entry boundary, no self-referential restart_history, same actor.
  if (nextWindow.mode !== priorWindow.mode || nextWindow.entered_at !== record.restarted_at
    || nextWindow.releases.length !== 0 || nextWindow.observations.length !== 0
    || canonical(nextWindow.completed_phases) !== canonical(priorWindow.completed_phases)
    || nextWindow.restart_history !== undefined
    || nextWindow.actor !== record.actor) return null;
  const priorLastRef = priorWindow.releases.length > 0 ? priorWindow.releases[priorWindow.releases.length - 1] : priorWindow.entry_boundary;
  if (nextWindow.entry_boundary.boundary_hash === priorLastRef.boundary_hash) return null;
  const candidate = {
    schema_version: MIGRATION_RESTART_SCHEMA_V2,
    project_id: record.project_id,
    reason: record.reason,
    actor: record.actor,
    restarted_at: record.restarted_at,
    prior_window: priorWindow,
    next_window: nextWindow,
  };
  if (record.restart_hash !== restartHashV2(candidate)) return null;
  return Object.freeze({ ...candidate, restart_hash: record.restart_hash });
}

/**
 * Hydrated restart verification: the pure validator cannot see boundary
 * CONTENT, so the v1 ordering authority — a strictly newer attested beta with
 * a later GitHub push instant than the legacy window's last boundary — is
 * enforced here against the resolved original bytes.
 */
export function verifyMigrationRestartRecordV2(projectRoot: string, value: unknown): MigrationRestartRecordV2 {
  const record = validateMigrationRestartRecordV2(value);
  if (!record) throw new Error("migration restart record v2 is invalid");
  const prior = hydrateMigrationWindowV5(projectRoot, record.prior_window);
  const previous = prior.releases.length > 0 ? prior.releases[prior.releases.length - 1] : prior.entry_boundary;
  const nextEntry = hydrateMigrationBoundary(projectRoot, resolveMigrationBoundaryRef(projectRoot, record.next_window.entry_boundary));
  if (!strictlyNewerBeta(previous.release, nextEntry.release) || Date.parse(nextEntry.merged_at) <= Date.parse(previous.merged_at)) {
    throw new Error("migration restart requires a strictly newer beta with a later GitHub push instant");
  }
  if (Date.parse(record.restarted_at) < Date.parse(nextEntry.merged_at)) throw new Error("migration restart instant predates its entry boundary");
  return record;
}

export function validateMigrationTransitionV3(value: unknown): MigrationTransitionIntentV3 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.schema_version !== MIGRATION_TRANSITION_SCHEMA_V3) return null;
  if (!exactKeys(record, ["schema_version", "operation", "prior_window", "prior_gates", "next_window", "next_gates", "restart_record", "intent_hash"])) return null;
  if ((record.operation !== "start" && record.operation !== "advance" && record.operation !== "restart") || typeof record.intent_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.intent_hash)) return null;
  const priorWindow = record.prior_window === null ? null : validateMigrationWindowV5(record.prior_window);
  const priorGates = record.prior_gates === null ? null : validateFeatureGateRegistry(record.prior_gates);
  if ((record.prior_window !== null && !priorWindow) || (record.prior_gates !== null && !priorGates)) return null;
  const nextWindow = validateMigrationWindowV5(record.next_window);
  const nextGates = validateFeatureGateRegistry(record.next_gates);
  if (!nextWindow || !nextGates || nextWindow.mode !== nextGates.resolver_mode) return null;
  const restartRecord = record.restart_record === null ? null : validateMigrationRestartRecordV2(record.restart_record);
  if ((record.restart_record !== null && !restartRecord) || (record.operation === "restart") !== (restartRecord !== null)) return null;
  const operation = record.operation as "start" | "advance" | "restart";
  const candidate = {
    schema_version: MIGRATION_TRANSITION_SCHEMA_V3,
    operation,
    prior_window: priorWindow,
    prior_gates: priorGates,
    next_window: nextWindow,
    next_gates: nextGates,
    restart_record: restartRecord,
  };
  if (record.intent_hash !== transitionHashV3(candidate)) return null;
  return Object.freeze({ ...candidate, intent_hash: record.intent_hash });
}

export type MigrationTransitionAnyVersion =
  | { readonly version: typeof MIGRATION_TRANSITION_SCHEMA_V1 | typeof MIGRATION_TRANSITION_SCHEMA; readonly intent: MigrationTransitionIntentV1 }
  | { readonly version: typeof MIGRATION_TRANSITION_SCHEMA_V3; readonly intent: MigrationTransitionIntentV3 };

/**
 * Mixed-version recovery dispatch: every nested record validates with the
 * validator of ITS OWN schema_version against its original bytes. v1/v2
 * transitions and v1 restarts keep their existing unchanged validators; an
 * unknown schema_version refuses recovery (fail closed), never best-effort
 * parses.
 */
export function validateMigrationTransitionRecord(value: unknown): MigrationTransitionAnyVersion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = (value as Record<string, unknown>).schema_version;
  if (version === MIGRATION_TRANSITION_SCHEMA_V1 || version === MIGRATION_TRANSITION_SCHEMA) {
    const intent = validateTransitionIntent(value);
    return intent ? { version: intent.schema_version, intent } : null;
  }
  if (version === MIGRATION_TRANSITION_SCHEMA_V3) {
    const intent = validateMigrationTransitionV3(value);
    return intent ? { version: MIGRATION_TRANSITION_SCHEMA_V3, intent } : null;
  }
  return null;
}

/**
 * The v1 restart precondition applied to a v5 window: only an observe/shadow
 * window still containing at least one legacy v1-schema observation may
 * restart. The current retained v2-only observations do not qualify.
 */
export function assertMigrationRestartEligibilityV5(window: MigrationWindowV5): void {
  if ((window.mode !== "observe" && window.mode !== "shadow") || !window.observations.some((observation) => observation.schema_version === MIGRATION_OBSERVATION_SCHEMA_V1)) {
    throw new Error("migration restart is only allowed for an observe or shadow window containing legacy observations");
  }
}

/**
 * Recompute the only successor a v3 intent is allowed to install, mirroring
 * verifyTransitionSemantics over v5 windows. A crafted self-hashed v3 intent
 * must never mutate live state.
 */
function verifyTransitionSemanticsV3(projectRoot: string, intent: MigrationTransitionIntentV3): void {
  let expectedWindow: MigrationWindowV5 | null = null;
  let expectedGates: CapabilityFeatureGateRegistryV1 | null = null;
  if (intent.operation === "start") {
    if (intent.restart_record !== null) throw new Error("start transition cannot carry restart history");
    if (intent.prior_window !== null || (intent.prior_gates !== null && intent.prior_gates.resolver_mode !== "legacy" && intent.prior_gates.resolver_mode !== "observe")) {
      throw new Error("start transition has an ineligible prior state");
    }
    expectedWindow = validateMigrationWindowV5({
      schema_version: MIGRATION_WINDOW_SCHEMA_V5,
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
    const priorHydrated = hydrateMigrationWindowV5(projectRoot, priorWindow);
    const nextEntryView = hydrateMigrationBoundary(projectRoot, resolveMigrationBoundaryRef(projectRoot, intent.next_window.entry_boundary));
    const verdict = evaluateMigrationAdvance(priorHydrated as unknown as MigrationWindowV1, intent.next_window.mode, nextEntryView as unknown as MigrationBoundaryV1);
    if (!verdict.passed) throw new Error(`advance transition is not evidence-qualified: ${verdict.blockers.join("; ")}`);
    const completed = priorWindow.mode === "observe" || priorWindow.mode === "shadow"
      ? [...priorWindow.completed_phases, { mode: priorWindow.mode, entered_at: priorWindow.entered_at, releases: priorWindow.releases, observations: priorWindow.observations, advanced_with: intent.next_window.entry_boundary }]
      : priorWindow.completed_phases;
    expectedWindow = validateMigrationWindowV5(JSON.parse(JSON.stringify({
      schema_version: MIGRATION_WINDOW_SCHEMA_V5,
      project_id: priorWindow.project_id,
      mode: intent.next_window.mode,
      entered_at: intent.next_window.entered_at,
      entry_boundary: intent.next_window.entry_boundary,
      releases: [],
      observations: [],
      completed_phases: completed,
      actor: intent.next_window.actor,
      ...(priorWindow.restart_history ? { restart_history: priorWindow.restart_history } : {}),
    })));
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
    verifyWindowEvidenceV5(projectRoot, priorWindow, priorGates);
    const restartRef = intent.next_window.restart_history;
    if (!intent.restart_record || !restartRef
      || restartRef.sha256 !== intent.restart_record.restart_hash
      || canonical(intent.restart_record.prior_window) !== canonical(priorWindow)
      || canonical(intent.restart_record.next_window) !== canonical(withoutRestartHistoryV5(intent.next_window))) throw new Error("restart transition history is absent or detached");
    assertMigrationRestartEligibilityV5(priorWindow);
    verifyMigrationRestartRecordV2(projectRoot, intent.restart_record);
    expectedWindow = validateMigrationWindowV5(JSON.parse(JSON.stringify({
      schema_version: MIGRATION_WINDOW_SCHEMA_V5,
      project_id: priorWindow.project_id,
      mode: priorWindow.mode,
      entered_at: intent.next_window.entered_at,
      entry_boundary: intent.next_window.entry_boundary,
      releases: [],
      observations: [],
      completed_phases: priorWindow.completed_phases,
      actor: intent.next_window.actor,
      restart_history: restartRef,
    })));
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
  // Full successor hydration BEFORE any write: every ref must resolve (missing
  // manifests refuse) and the entry boundary must not postdate entered_at.
  hydrateMigrationWindowV5(projectRoot, intent.next_window);
  verifyWindowEvidenceV5(projectRoot, intent.next_window, intent.next_gates);
}

function withoutRestartHistoryV5(value: MigrationWindowV5): MigrationWindowV5 {
  const { restart_history: _restartHistory, ...base } = value;
  return base;
}

/**
 * Mixed-version pending-transition recovery. v1/v2 intents recover through the
 * EXISTING unchanged recoverMigrationTransition; a v3 intent recovers through
 * the v5 semantics recompute with the same landed-state algebra against the
 * v5 window record and feature gates. An unknown schema_version refuses.
 */
export function recoverMigrationTransitionAnyVersion(projectRoot: string): boolean {
  let raw: string | null;
  try { raw = readOptionalStateFileBounded(projectRoot, MIGRATION_TRANSITION_RELPATH, "pending migration transition", MAX_MIGRATION_WINDOW_BYTES * 4); }
  catch (error) { throw new Error(`pending migration transition is unreadable: ${(error as Error).message}`); }
  if (raw === null) return false;
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new Error("pending migration transition is invalid JSON"); }
  const version = (parsed as Record<string, unknown> | null)?.schema_version;
  if (version === MIGRATION_TRANSITION_SCHEMA_V1 || version === MIGRATION_TRANSITION_SCHEMA) return recoverMigrationTransition(projectRoot);
  if (version !== MIGRATION_TRANSITION_SCHEMA_V3) throw new Error(`pending migration transition has an unknown schema_version: ${String(version)}`);
  const intent = validateMigrationTransitionV3(parsed);
  if (!intent) throw new Error("pending migration transition is invalid or tampered");
  verifyTransitionSemanticsV3(projectRoot, intent);
  let currentWindow: MigrationWindowV5 | null = null; let windowExists = false;
  try { const windowRaw = readOptionalStateFileBounded(projectRoot, MIGRATION_WINDOW_V5_RELPATH, "current migration window v5", MAX_MIGRATION_WINDOW_BYTES); windowExists = windowRaw !== null; currentWindow = windowRaw === null ? null : validateMigrationWindowV5(JSON.parse(windowRaw)); }
  catch { throw new Error("current migration window v5 is invalid during transition recovery"); }
  if (windowExists && !currentWindow) throw new Error("current migration window v5 is invalid during transition recovery");
  const currentGates = readFeatureGateRegistry(projectRoot);
  const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
  const windowAtPrior = same(currentWindow, intent.prior_window); const windowAtNext = same(currentWindow, intent.next_window);
  const gatesAtPrior = same(currentGates, intent.prior_gates); const gatesAtNext = same(currentGates, intent.next_gates);
  if (!windowAtPrior && !windowAtNext) throw new Error("migration window v5 changed outside the pending transition");
  if (!gatesAtPrior && !gatesAtNext) throw new Error("feature-gate registry changed outside the pending transition");
  const windowChanged = !same(intent.prior_window, intent.next_window);
  const gatesChanged = !same(intent.prior_gates, intent.next_gates);
  const anyTargetLanded = (windowChanged && windowAtNext) || (gatesChanged && gatesAtNext);
  if (windowAtPrior && gatesAtPrior && !anyTargetLanded) {
    fs.unlinkSync(transitionPath(projectRoot));
    return false;
  }
  writeMigrationWindowV5Record(projectRoot, intent.next_window);
  writeFeatureGateRegistry(projectRoot, intent.next_gates);
  if (intent.restart_record) {
    const target = path.join(fs.realpathSync(projectRoot), `${MIGRATION_RESTART_HISTORY_RELPATH}/${intent.restart_record.restart_hash}.json`);
    const written = writeContainedFile(projectRoot, target, Buffer.from(`${JSON.stringify(intent.restart_record, null, 2)}\n`), { policy: "physical" });
    if (!written.written) throw new Error(`migration restart history write refused [${written.code}]`);
  }
  fs.unlinkSync(transitionPath(projectRoot));
  return true;
}
