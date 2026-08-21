import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { planModeTransition } from "../../../src/modules/capability/workflows/resolver-mode";
import { writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import { FEATURE_GATE_REGISTRY_SCHEMA, FEATURE_GATE_RELPATH, readFeatureGateRegistry, writeFeatureGateRegistry } from "./strangler-control";
import {
  loadMigrationBoundary,
  loadMigrationObservation,
  verifyMigrationObservation,
  validateMigrationBoundary,
  validateMigrationObservation,
  type MigrationBoundaryV1,
  type MigrationObservationV1,
} from "./migration-evidence";

export const MIGRATION_WINDOW_SCHEMA = "guild.capability_migration_window.v2" as const;
export const MIGRATION_WINDOW_RELPATH = ".guild/artifacts/capability/migration-window.json";
export const MIN_RELEASES_PER_MODE = 3;
export const MIN_DAYS_PER_MODE = 14;

export interface MigrationWindowV1 {
  schema_version: typeof MIGRATION_WINDOW_SCHEMA;
  mode: CapabilityResolverMode;
  entered_at: string;
  releases: readonly MigrationBoundaryV1[];
  observations: readonly MigrationObservationV1[];
  actor: string;
}

const MODE = new Set(["legacy", "observe", "shadow", "project-local", "strict"]);
const BETA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

function betaOrder(value: string): readonly [number, number, number, number] | null {
  const match = BETA.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}

function strictlyNewerBeta(previous: string, next: string): boolean {
  const left = betaOrder(previous);
  const right = betaOrder(next);
  if (left === null || right === null) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (right[index] > left[index]) return true;
    if (right[index] < left[index]) return false;
  }
  return false;
}

function modeHasObservations(mode: CapabilityResolverMode): mode is "observe" | "shadow" {
  return mode === "observe" || mode === "shadow";
}

function pairEvidence(boundary: MigrationBoundaryV1, observation: MigrationObservationV1, mode: CapabilityResolverMode): boolean {
  return modeHasObservations(mode)
    && observation.mode === mode
    && observation.boundary_hash === boundary.boundary_hash
    && observation.boundary_release === boundary.release
    && observation.boundary_source_commit === boundary.source_commit;
}

export function validateMigrationWindow(value: unknown): MigrationWindowV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (Object.keys(o).sort().join(",") !== ["actor", "entered_at", "mode", "observations", "releases", "schema_version"].sort().join(",")) return null;
  if (o.schema_version !== MIGRATION_WINDOW_SCHEMA || !MODE.has(o.mode as string) || typeof o.entered_at !== "string" || !Number.isFinite(Date.parse(o.entered_at)) || typeof o.actor !== "string" || !o.actor || !Array.isArray(o.releases) || o.releases.length === 0 || !Array.isArray(o.observations) || o.observations.length !== o.releases.length) return null;
  const releases: MigrationBoundaryV1[] = [];
  const seenVersions = new Set<string>();
  const seenCommits = new Set<string>();
  let prior: MigrationBoundaryV1 | null = null;
  for (const raw of o.releases) {
    const boundary = validateMigrationBoundary(raw);
    if (boundary === null || seenVersions.has(boundary.release) || seenCommits.has(boundary.source_commit)) return null;
    if (prior !== null) {
      if (!strictlyNewerBeta(prior.release, boundary.release)) return null;
      if (Date.parse(boundary.merged_at) <= Date.parse(prior.merged_at)) return null;
    }
    seenVersions.add(boundary.release);
    seenCommits.add(boundary.source_commit);
    releases.push(boundary);
    prior = boundary;
  }
  const observations: MigrationObservationV1[] = [];
  for (let index = 0; index < o.observations.length; index += 1) {
    const observation = validateMigrationObservation(o.observations[index]);
    if (observation === null || !pairEvidence(releases[index], observation, o.mode as CapabilityResolverMode)) return null;
    observations.push(observation);
  }
  if (o.entered_at !== releases[0].merged_at) return null;
  return { schema_version: MIGRATION_WINDOW_SCHEMA, mode: o.mode as CapabilityResolverMode, entered_at: o.entered_at, releases, observations, actor: o.actor };
}

export function readMigrationWindow(projectRoot: string): MigrationWindowV1 | null {
  try {
    const value = validateMigrationWindow(JSON.parse(fs.readFileSync(path.join(path.resolve(projectRoot), MIGRATION_WINDOW_RELPATH), "utf8")));
    if (value === null) return null;
    for (const observation of value.observations) verifyMigrationObservation(projectRoot, observation);
    return value;
  }
  catch { return null; }
}

export function writeMigrationWindow(projectRoot: string, value: MigrationWindowV1): void {
  const valid = validateMigrationWindow(value);
  if (!valid) throw new Error("invalid migration window");
  const root = fs.realpathSync(projectRoot);
  const target = path.join(root, MIGRATION_WINDOW_RELPATH);
  const written = writeContainedFile(root, target, Buffer.from(`${JSON.stringify(valid, null, 2)}\n`, "utf8"), { policy: "physical" });
  if (!written.written) throw new Error(`migration window write refused [${written.code}]: ${written.detail}`);
}

export function startMigrationWindow(options: { projectRoot: string; mode: CapabilityResolverMode; boundaryPath: string; observationPath: string; actor: string }): MigrationWindowV1 {
  if (options.mode !== "observe") throw new Error("a migration window must enter at observe; later modes require evidence-bound advance");
  const root = fs.realpathSync(options.projectRoot);
  const windowPath = path.join(root, MIGRATION_WINDOW_RELPATH);
  try { fs.lstatSync(windowPath); throw new Error("migration window already exists or is invalid"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const boundary = loadMigrationBoundary(path.resolve(options.boundaryPath));
  const observation = loadMigrationObservation(options.projectRoot, path.resolve(options.observationPath));
  const value = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: options.mode, entered_at: boundary.merged_at, releases: [boundary], observations: [observation], actor: options.actor });
  if (!value) throw new Error("invalid migration-window start");
  const gatePath = path.join(root, FEATURE_GATE_RELPATH);
  let gateExists = false;
  try { fs.lstatSync(gatePath); gateExists = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (gateExists && gates === null) throw new Error("capability feature-gate registry exists but is invalid");
  if (gates && gates.resolver_mode !== "legacy" && gates.resolver_mode !== "observe") throw new Error(`cannot start observe migration from feature-gate mode ${gates.resolver_mode}`);
  const nextGates = gates?.resolver_mode === "observe" ? null : gates ? {
    ...gates,
    resolver_mode: "observe" as const,
    revision: gates.revision + 1,
    updated_at: boundary.merged_at,
    updated_by: options.actor,
    history: [...gates.history, { from: "legacy" as const, to: "observe" as const, reason: "D03 migration-window start", recorded_at: boundary.merged_at, actor: options.actor }],
  } : { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "observe" as const, revision: 0, updated_at: boundary.merged_at, updated_by: options.actor, history: [] };
  writeMigrationWindow(options.projectRoot, value);
  try { if (nextGates) writeFeatureGateRegistry(options.projectRoot, nextGates); }
  catch (error) {
    try { fs.unlinkSync(windowPath); } catch { /* returned failure remains authoritative */ }
    throw error;
  }
  return value;
}

export function recordMigrationRelease(options: { projectRoot: string; boundaryPath: string; observationPath: string }): MigrationWindowV1 {
  const current = readMigrationWindow(options.projectRoot);
  if (!current) throw new Error("migration window absent or invalid");
  const boundary = loadMigrationBoundary(path.resolve(options.boundaryPath));
  const observation = loadMigrationObservation(options.projectRoot, path.resolve(options.observationPath));
  const previous = current.releases[current.releases.length - 1];
  if (!strictlyNewerBeta(previous.release, boundary.release)) {
    throw new Error("migration release boundary must carry a strictly newer distinct beta version");
  }
  if (Date.parse(boundary.merged_at) <= Date.parse(previous.merged_at)) {
    throw new Error("migration release boundary must have a later GitHub-observed push instant");
  }
  const next = validateMigrationWindow({ ...current, releases: [...current.releases, boundary], observations: [...current.observations, observation] });
  if (next === null) throw new Error("migration release boundary does not extend the verified window");
  writeMigrationWindow(options.projectRoot, next);
  return next;
}

export function evaluateMigrationAdvance(window: MigrationWindowV1, to: CapabilityResolverMode, nextBoundary: MigrationBoundaryV1) {
  const transition = planModeTransition({ from: window.mode, to, reason: "migration-window", allow_skip: false });
  const elapsedDays = Math.floor((Date.parse(nextBoundary.merged_at) - Date.parse(window.entered_at)) / 86_400_000);
  const blockers: string[] = [];
  const lastBoundary = window.releases[window.releases.length - 1];
  if (!strictlyNewerBeta(lastBoundary.release, nextBoundary.release) || Date.parse(nextBoundary.merged_at) <= Date.parse(lastBoundary.merged_at)) blockers.push("next mode boundary must be a strictly newer beta with a later GitHub push instant");
  if (transition.status !== "allowed" || transition.direction !== "advance") blockers.push("target is not the next resolver rung");
  if ((window.mode === "observe" || window.mode === "shadow") && window.releases.length < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct releases in ${window.mode}`);
  if ((window.mode === "observe" || window.mode === "shadow") && elapsedDays < MIN_DAYS_PER_MODE) blockers.push(`need >=${MIN_DAYS_PER_MODE} days in ${window.mode}`);
  const distinctRuns = new Set(window.observations.flatMap((observation) => observation.runs.map((run) => run.run_id))).size;
  if ((window.mode === "observe" || window.mode === "shadow") && distinctRuns < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct whole-run profiles in ${window.mode}`);
  return { passed: blockers.length === 0, blockers, elapsed_days: elapsedDays, release_count: window.releases.length, run_count: distinctRuns };
}

export function advanceMigrationWindow(options: { projectRoot: string; to: CapabilityResolverMode; boundaryPath: string; observationPath: string; actor: string }) {
  const current = readMigrationWindow(options.projectRoot);
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (!current || !gates || current.mode !== gates.resolver_mode) return { status: "refused" as const, blockers: ["migration-window and feature-gate state are absent or disagree"] };
  const boundary = loadMigrationBoundary(path.resolve(options.boundaryPath));
  const observation = loadMigrationObservation(options.projectRoot, path.resolve(options.observationPath));
  const verdict = evaluateMigrationAdvance(current, options.to, boundary);
  if (!verdict.passed) return { status: "refused" as const, blockers: verdict.blockers };
  const nextWindow = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: options.to, entered_at: boundary.merged_at, releases: [boundary], observations: [observation], actor: options.actor });
  if (nextWindow === null) return { status: "refused" as const, blockers: ["next mode boundary is invalid"] };
  const nextGate = { ...gates, resolver_mode: options.to, revision: gates.revision + 1, updated_at: boundary.merged_at, updated_by: options.actor, history: [...gates.history, { from: current.mode, to: options.to, reason: "D03 migration-window advance", recorded_at: boundary.merged_at, actor: options.actor }] };
  writeFeatureGateRegistry(options.projectRoot, nextGate);
  try { writeMigrationWindow(options.projectRoot, nextWindow); }
  catch (error) { writeFeatureGateRegistry(options.projectRoot, gates); return { status: "failed" as const, blockers: [(error as Error).message] }; }
  return { status: "advanced" as const, from: current.mode, to: options.to, revision: nextGate.revision };
}

export function legacyRemovalEligibility(options: { projectLocalDefault: string; currentVersion: string; g5Passed: boolean }) {
  const parse = (value: string) => {
    const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
    return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
  };
  const cut = parse(options.projectLocalDefault); const current = parse(options.currentVersion);
  const blockers: string[] = [];
  if (!cut || !current) blockers.push("removal-floor versions must be stable semantic versions");
  if (!options.g5Passed) blockers.push("G5 has not passed");
  if (current?.major === 2) blockers.push("legacy compatibility is never removed within v2");
  if (cut && current && current.major < cut.major) blockers.push("current version predates the project-local default");
  if (cut && current && current.major === cut.major && current.minor < cut.minor + 2) blockers.push("two-minor rollback floor has not elapsed");
  return { passed: blockers.length === 0, blockers };
}
