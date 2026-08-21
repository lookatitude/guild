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
  type MigrationBoundaryV1,
  type MigrationObservationV1,
} from "./migration-evidence";

export const MIGRATION_WINDOW_SCHEMA = "guild.capability_migration_window.v3" as const;
export const MIGRATION_WINDOW_RELPATH = ".guild/artifacts/capability/migration-window.json";
export const MIGRATION_TRANSITION_SCHEMA = "guild.capability_migration_transition.v1" as const;
export const MIGRATION_ADVANCE_CONFORMANCE_SCHEMA = "guild.capability_migration_advance_conformance.v1" as const;
export const MIGRATION_TRANSITION_RELPATH = ".guild/artifacts/capability/migration-transition.json";
export const MIN_RELEASES_PER_MODE = 3;
export const MIN_DAYS_PER_MODE = 14;

interface CompletedMigrationPhaseV1 {
  readonly mode: "observe" | "shadow";
  readonly entered_at: string;
  readonly releases: readonly MigrationBoundaryV1[];
  readonly observations: readonly MigrationObservationV1[];
  readonly advanced_with: MigrationBoundaryV1;
}

export interface MigrationWindowV1 {
  readonly schema_version: typeof MIGRATION_WINDOW_SCHEMA;
  readonly mode: CapabilityResolverMode;
  readonly entered_at: string;
  /** Attested beta boundary that opened the current mode. */
  readonly entry_boundary: MigrationBoundaryV1;
  readonly releases: readonly MigrationBoundaryV1[];
  readonly observations: readonly MigrationObservationV1[];
  readonly completed_phases: readonly CompletedMigrationPhaseV1[];
  readonly actor: string;
}

interface MigrationTransitionIntentV1 {
  readonly schema_version: typeof MIGRATION_TRANSITION_SCHEMA;
  readonly operation: "start" | "advance";
  readonly prior_window: MigrationWindowV1 | null;
  readonly prior_gates: CapabilityFeatureGateRegistryV1 | null;
  readonly next_window: MigrationWindowV1;
  readonly next_gates: CapabilityFeatureGateRegistryV1;
  readonly intent_hash: string;
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

function pairEvidence(boundary: MigrationBoundaryV1, observation: MigrationObservationV1, mode: "observe" | "shadow"): boolean {
  const runtimePackageMatches = Object.values(boundary.packages).some((runtimePackage) => canonical(runtimePackage) === canonical(observation.runtime_package));
  return observation.mode === mode
    && observation.boundary_hash === boundary.boundary_hash
    && observation.boundary_release === boundary.release
    && observation.boundary_source_commit === boundary.source_commit
    && observation.boundary_merged_at === boundary.merged_at
    && runtimePackageMatches;
}

function validateSeries(rawReleases: unknown, rawObservations: unknown, mode: "observe" | "shadow", allowEmpty: boolean) {
  if (!Array.isArray(rawReleases) || !Array.isArray(rawObservations) || rawReleases.length !== rawObservations.length || (!allowEmpty && rawReleases.length === 0)) return null;
  const releases: MigrationBoundaryV1[] = []; const observations: MigrationObservationV1[] = [];
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
  const last = series.releases[series.releases.length - 1];
  if (!strictlyNewerBeta(last.release, advancedWith.release) || Date.parse(advancedWith.merged_at) <= Date.parse(last.merged_at)) return null;
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
  if (!exactKeys(record, ["schema_version", "mode", "entered_at", "entry_boundary", "releases", "observations", "completed_phases", "actor"])) return null;
  if (record.schema_version !== MIGRATION_WINDOW_SCHEMA || !MODES.has(record.mode as CapabilityResolverMode) || record.mode === "legacy" || !canonicalInstant(record.entered_at) || typeof record.actor !== "string" || !record.actor || !Array.isArray(record.completed_phases)) return null;
  const mode = record.mode as CapabilityResolverMode;
  const entryBoundary = validateMigrationBoundary(record.entry_boundary);
  if (!entryBoundary || Date.parse(entryBoundary.merged_at) > Date.parse(record.entered_at)) return null;
  const series = mode === "observe" || mode === "shadow"
    ? validateSeries(record.releases, record.observations, mode, true)
    : Array.isArray(record.releases) && record.releases.length === 0 && Array.isArray(record.observations) && record.observations.length === 0 ? { releases: [], observations: [] } : null;
  if (!series) return null;
  const completed: CompletedMigrationPhaseV1[] = [];
  for (const raw of record.completed_phases) {
    const phase = validateCompletedPhase(raw); if (!phase) return null;
    if (completed.some((entry) => entry.mode === phase.mode)) return null;
    if (phase.mode === "shadow" && !completed.some((entry) => entry.mode === "observe")) return null;
    completed.push(phase);
  }
  if (mode === "observe" && completed.length > 0) return null;
  if (mode === "shadow" && !completed.some((phase) => phase.mode === "observe")) return null;
  if ((mode === "project-local" || mode === "strict") && !completed.some((phase) => phase.mode === "shadow")) return null;
  return Object.freeze({ schema_version: MIGRATION_WINDOW_SCHEMA, mode, entered_at: record.entered_at, entry_boundary: entryBoundary, ...series, completed_phases: Object.freeze(completed), actor: record.actor });
}

function transitionHash(value: Omit<MigrationTransitionIntentV1, "intent_hash">): string { return sha256(canonical(value)); }
function validateTransitionIntent(value: unknown): MigrationTransitionIntentV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, ["schema_version", "operation", "prior_window", "prior_gates", "next_window", "next_gates", "intent_hash"]) || record.schema_version !== MIGRATION_TRANSITION_SCHEMA || (record.operation !== "start" && record.operation !== "advance") || typeof record.intent_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.intent_hash)) return null;
  const priorWindow = record.prior_window === null ? null : validateMigrationWindow(record.prior_window);
  const priorGates = record.prior_gates === null ? null : validateFeatureGateRegistry(record.prior_gates);
  if ((record.prior_window !== null && !priorWindow) || (record.prior_gates !== null && !priorGates)) return null;
  const nextWindow = validateMigrationWindow(record.next_window); const nextGates = validateFeatureGateRegistry(record.next_gates);
  if (!nextWindow || !nextGates || nextWindow.mode !== nextGates.resolver_mode) return null;
  const candidate = { schema_version: MIGRATION_TRANSITION_SCHEMA, operation: record.operation as "start" | "advance", prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates };
  if (record.intent_hash !== transitionHash(candidate)) return null;
  return Object.freeze({ ...candidate, intent_hash: record.intent_hash });
}

function transitionPath(projectRoot: string): string { return path.join(fs.realpathSync(projectRoot), MIGRATION_TRANSITION_RELPATH); }
function writeTransitionIntent(projectRoot: string, operation: "start" | "advance", priorWindow: MigrationWindowV1 | null, priorGates: CapabilityFeatureGateRegistryV1 | null, nextWindow: MigrationWindowV1, nextGates: CapabilityFeatureGateRegistryV1): void {
  const target = transitionPath(projectRoot);
  try { fs.lstatSync(target); throw new Error("a migration transition is already pending"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const candidate = { schema_version: MIGRATION_TRANSITION_SCHEMA, operation, prior_window: priorWindow, prior_gates: priorGates, next_window: nextWindow, next_gates: nextGates };
  const intent = validateTransitionIntent({ ...candidate, intent_hash: transitionHash(candidate) });
  if (!intent) throw new Error("migration transition intent failed validation");
  const written = writeContainedFile(projectRoot, target, Buffer.from(`${JSON.stringify(intent, null, 2)}\n`), { policy: "physical" });
  if (!written.written) throw new Error(`migration transition intent refused [${written.code}]: ${written.detail}`);
}

export function recoverMigrationTransition(projectRoot: string): boolean {
  let raw: string | null;
  try { raw = readOptionalStateFile(projectRoot, MIGRATION_TRANSITION_RELPATH, "pending migration transition"); }
  catch (error) { throw new Error(`pending migration transition is unreadable: ${(error as Error).message}`); }
  if (raw === null) return false;
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { throw new Error("pending migration transition is invalid JSON"); }
  const intent = validateTransitionIntent(parsed); if (!intent) throw new Error("pending migration transition is invalid or tampered");
  // A crafted self-hashed intent must never mutate either live state file. The
  // exact boundary artifacts were persisted before the intent was written, so
  // remote provenance can be re-established before deterministic roll-forward.
  verifyWindowBoundaryProvenance(projectRoot, intent.next_window);
  let currentWindow: MigrationWindowV1 | null = null; let windowExists = false;
  try { const windowRaw = readOptionalStateFile(projectRoot, MIGRATION_WINDOW_RELPATH, "current migration window"); windowExists = windowRaw !== null; currentWindow = windowRaw === null ? null : validateMigrationWindow(JSON.parse(windowRaw)); }
  catch { throw new Error("current migration window is invalid during transition recovery"); }
  if (windowExists && !currentWindow) throw new Error("current migration window is invalid during transition recovery");
  const gatePath = path.join(fs.realpathSync(projectRoot), FEATURE_GATE_RELPATH);
  let gateExists = false; try { fs.lstatSync(gatePath); gateExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const currentGates = readFeatureGateRegistry(projectRoot);
  if (gateExists && !currentGates) throw new Error("current feature-gate registry is invalid during transition recovery");
  const same = (left: unknown, right: unknown): boolean => canonical(left) === canonical(right);
  if (!same(currentWindow, intent.prior_window) && !same(currentWindow, intent.next_window)) throw new Error("migration window changed outside the pending transition");
  if (!same(currentGates, intent.prior_gates) && !same(currentGates, intent.next_gates)) throw new Error("feature-gate registry changed outside the pending transition");
  writeMigrationWindow(projectRoot, intent.next_window);
  writeFeatureGateRegistry(projectRoot, intent.next_gates);
  fs.unlinkSync(transitionPath(projectRoot));
  return true;
}

export function readMigrationWindow(projectRoot: string): MigrationWindowV1 | null {
  try {
    recoverMigrationTransition(projectRoot);
    const raw = readOptionalStateFile(projectRoot, MIGRATION_WINDOW_RELPATH, "migration window");
    if (raw === null) return null;
    const value = validateMigrationWindow(JSON.parse(raw));
    if (!value) return null;
    verifyWindowBoundaryProvenance(projectRoot, value);
    for (const phase of [...value.completed_phases, value]) for (const observation of phase.observations) verifyMigrationObservation(projectRoot, observation);
    return value;
  } catch { return null; }
}

export function writeMigrationWindow(projectRoot: string, value: MigrationWindowV1): void {
  const valid = validateMigrationWindow(value); if (!valid) throw new Error("invalid migration window");
  const root = fs.realpathSync(projectRoot); const target = path.join(root, MIGRATION_WINDOW_RELPATH);
  const written = writeContainedFile(root, target, Buffer.from(`${JSON.stringify(valid, null, 2)}\n`), { policy: "physical" });
  if (!written.written) throw new Error(`migration window write refused [${written.code}]: ${written.detail}`);
}

export function startMigrationWindow(options: { projectRoot: string; mode: CapabilityResolverMode; boundaryPath: string; actor: string }): MigrationWindowV1 {
  recoverMigrationTransition(options.projectRoot);
  if (options.mode !== "observe") throw new Error("a migration window must enter at observe; later modes require evidence-bound advance");
  const root = fs.realpathSync(options.projectRoot); const windowPath = path.join(root, MIGRATION_WINDOW_RELPATH);
  try { fs.lstatSync(windowPath); throw new Error("migration window already exists or is invalid"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const attested = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot);
  const enteredAt = new Date(Math.max(Date.parse(attested.boundary.merged_at), Date.parse(attested.verified_at))).toISOString();
  const value = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: "observe", entered_at: enteredAt, entry_boundary: attested.boundary, releases: [], observations: [], completed_phases: [], actor: options.actor });
  if (!value) throw new Error("invalid migration-window start");
  const gatePath = path.join(root, FEATURE_GATE_RELPATH); let gateExists = false;
  try { fs.lstatSync(gatePath); gateExists = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (gateExists && !gates) throw new Error("capability feature-gate registry exists but is invalid");
  if (gates && gates.resolver_mode !== "legacy" && gates.resolver_mode !== "observe") throw new Error(`cannot start observe migration from feature-gate mode ${gates.resolver_mode}`);
  const nextGates: CapabilityFeatureGateRegistryV1 = gates?.resolver_mode === "observe" ? gates : gates ? { ...gates, resolver_mode: "observe", revision: gates.revision + 1, updated_at: enteredAt, updated_by: options.actor, history: [...gates.history, { from: "legacy", to: "observe", reason: "D03 migration-window start", recorded_at: enteredAt, actor: options.actor }] } : { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "observe", revision: 0, updated_at: enteredAt, updated_by: options.actor, history: [] };
  writeTransitionIntent(options.projectRoot, "start", null, gates, value, nextGates); recoverMigrationTransition(options.projectRoot); return value;
}

function lastKnownBoundary(window: MigrationWindowV1): MigrationBoundaryV1 | null {
  if (window.releases.length > 0) return window.releases[window.releases.length - 1];
  return window.entry_boundary;
}

export function recordMigrationRelease(options: { projectRoot: string; boundaryPath: string; observationPath: string }): MigrationWindowV1 {
  const current = readMigrationWindow(options.projectRoot); if (!current) throw new Error("migration window absent, invalid, or has detached evidence");
  if (current.mode !== "observe" && current.mode !== "shadow") throw new Error(`mode ${current.mode} does not collect migration observations`);
  const boundary = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot).boundary; const observation = loadMigrationObservation(options.projectRoot, path.resolve(options.observationPath));
  if (Date.parse(observation.observed_at) < Date.parse(current.entered_at)) throw new Error(`${current.mode} evidence predates entry into the current migration phase`);
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
  if ((window.mode === "observe" || window.mode === "shadow") && window.releases.length < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct releases in ${window.mode}`);
  if ((window.mode === "observe" || window.mode === "shadow") && elapsedDays < MIN_DAYS_PER_MODE) blockers.push(`need >=${MIN_DAYS_PER_MODE} days in ${window.mode}`);
  const distinctRuns = new Set(window.observations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if ((window.mode === "observe" || window.mode === "shadow") && distinctRuns < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct whole-run profiles in ${window.mode}`);
  const passed = blockers.length === 0;
  return {
    passed,
    blockers,
    elapsed_days: elapsedDays,
    release_count: window.releases.length,
    run_count: distinctRuns,
    conformance: Object.freeze({
      schema_version: MIGRATION_ADVANCE_CONFORMANCE_SCHEMA,
      decision: passed ? "passed" as const : "refused" as const,
      basis: "attested-boundaries+package-bound-whole-run-observations+ordered-resolver-transition" as const,
    }),
  };
}

export function advanceMigrationWindow(options: { projectRoot: string; to: CapabilityResolverMode; boundaryPath: string; actor: string }) {
  recoverMigrationTransition(options.projectRoot);
  const current = readMigrationWindow(options.projectRoot); const gates = readFeatureGateRegistry(options.projectRoot);
  if (!current || !gates || current.mode !== gates.resolver_mode) return { status: "refused" as const, blockers: ["migration-window and feature-gate state are absent or disagree"] };
  const attested = loadAttestedMigrationBoundary(path.resolve(options.boundaryPath), options.projectRoot); const boundary = attested.boundary; const verdict = evaluateMigrationAdvance(current, options.to, boundary);
  if (!verdict.passed) return { status: "refused" as const, blockers: verdict.blockers };
  const completed = current.mode === "observe" || current.mode === "shadow" ? [...current.completed_phases, { mode: current.mode, entered_at: current.entered_at, releases: current.releases, observations: current.observations, advanced_with: boundary }] : current.completed_phases;
  const enteredAt = new Date(Math.max(Date.parse(boundary.merged_at), Date.parse(attested.verified_at))).toISOString();
  const nextWindow = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: options.to, entered_at: enteredAt, entry_boundary: boundary, releases: [], observations: [], completed_phases: completed, actor: options.actor });
  if (!nextWindow) return { status: "refused" as const, blockers: ["next migration phase is invalid"] };
  const nextGate: CapabilityFeatureGateRegistryV1 = { ...gates, resolver_mode: options.to, revision: gates.revision + 1, updated_at: enteredAt, updated_by: options.actor, history: [...gates.history, { from: current.mode, to: options.to, reason: "D03 migration-window advance", recorded_at: enteredAt, actor: options.actor }] };
  writeTransitionIntent(options.projectRoot, "advance", current, gates, nextWindow, nextGate);
  try { recoverMigrationTransition(options.projectRoot); }
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
