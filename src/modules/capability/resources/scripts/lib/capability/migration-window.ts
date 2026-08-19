import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { planModeTransition } from "../../../src/modules/capability/workflows/resolver-mode";
import { writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import { FEATURE_GATE_REGISTRY_SCHEMA, readFeatureGateRegistry, writeFeatureGateRegistry } from "./strangler-control";

export const MIGRATION_WINDOW_SCHEMA = "guild.capability_migration_window.v1" as const;
export const MIGRATION_WINDOW_RELPATH = ".guild/artifacts/capability/migration-window.json";
export const MIN_RELEASES_PER_MODE = 3;
export const MIN_DAYS_PER_MODE = 14;

export interface MigrationWindowV1 {
  schema_version: typeof MIGRATION_WINDOW_SCHEMA;
  mode: CapabilityResolverMode;
  entered_at: string;
  releases: readonly { version: string; observed_at: string }[];
  actor: string;
}

const MODE = new Set(["legacy", "observe", "shadow", "project-local", "strict"]);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function validateMigrationWindow(value: unknown): MigrationWindowV1 | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.schema_version !== MIGRATION_WINDOW_SCHEMA || !MODE.has(o.mode as string) || typeof o.entered_at !== "string" || !Number.isFinite(Date.parse(o.entered_at)) || typeof o.actor !== "string" || !o.actor || !Array.isArray(o.releases)) return null;
  const releases: Array<{ version: string; observed_at: string }> = [];
  const seen = new Set<string>();
  for (const raw of o.releases) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.version !== "string" || !SEMVER.test(r.version) || seen.has(r.version) || typeof r.observed_at !== "string" || !Number.isFinite(Date.parse(r.observed_at))) return null;
    seen.add(r.version);
    releases.push({ version: r.version, observed_at: r.observed_at });
  }
  return { schema_version: MIGRATION_WINDOW_SCHEMA, mode: o.mode as CapabilityResolverMode, entered_at: o.entered_at, releases, actor: o.actor };
}

export function readMigrationWindow(projectRoot: string): MigrationWindowV1 | null {
  try { return validateMigrationWindow(JSON.parse(fs.readFileSync(path.join(path.resolve(projectRoot), MIGRATION_WINDOW_RELPATH), "utf8"))); }
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

export function startMigrationWindow(options: { projectRoot: string; mode: CapabilityResolverMode; release: string; recordedAt: string; actor: string }): MigrationWindowV1 {
  if (readMigrationWindow(options.projectRoot)) throw new Error("migration window already exists");
  const value = validateMigrationWindow({ schema_version: MIGRATION_WINDOW_SCHEMA, mode: options.mode, entered_at: options.recordedAt, releases: [{ version: options.release, observed_at: options.recordedAt }], actor: options.actor });
  if (!value) throw new Error("invalid migration-window start");
  writeMigrationWindow(options.projectRoot, value);
  if (!readFeatureGateRegistry(options.projectRoot)) writeFeatureGateRegistry(options.projectRoot, { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: options.mode, revision: 0, updated_at: options.recordedAt, updated_by: options.actor, history: [] });
  return value;
}

export function recordMigrationRelease(options: { projectRoot: string; release: string; recordedAt: string }): MigrationWindowV1 {
  const current = readMigrationWindow(options.projectRoot);
  if (!current) throw new Error("migration window absent or invalid");
  if (!SEMVER.test(options.release) || !Number.isFinite(Date.parse(options.recordedAt))) throw new Error("invalid release observation");
  if (current.releases.some((release) => release.version === options.release)) return current;
  const next = { ...current, releases: [...current.releases, { version: options.release, observed_at: options.recordedAt }] };
  writeMigrationWindow(options.projectRoot, next);
  return next;
}

export function evaluateMigrationAdvance(window: MigrationWindowV1, to: CapabilityResolverMode, at: string, conformancePassed: boolean) {
  const transition = planModeTransition({ from: window.mode, to, reason: "migration-window", allow_skip: false });
  const elapsedDays = Math.floor((Date.parse(at) - Date.parse(window.entered_at)) / 86_400_000);
  const blockers: string[] = [];
  if (transition.status !== "allowed" || transition.direction !== "advance") blockers.push("target is not the next resolver rung");
  if ((window.mode === "observe" || window.mode === "shadow") && window.releases.length < MIN_RELEASES_PER_MODE) blockers.push(`need >=${MIN_RELEASES_PER_MODE} distinct releases in ${window.mode}`);
  if ((window.mode === "observe" || window.mode === "shadow") && elapsedDays < MIN_DAYS_PER_MODE) blockers.push(`need >=${MIN_DAYS_PER_MODE} days in ${window.mode}`);
  if (!conformancePassed) blockers.push("conformance gate has not passed");
  return { passed: blockers.length === 0, blockers, elapsed_days: elapsedDays, release_count: window.releases.length };
}

export function advanceMigrationWindow(options: { projectRoot: string; to: CapabilityResolverMode; release: string; recordedAt: string; actor: string; conformancePassed: boolean }) {
  const current = readMigrationWindow(options.projectRoot);
  const gates = readFeatureGateRegistry(options.projectRoot);
  if (!current || !gates || current.mode !== gates.resolver_mode) return { status: "refused" as const, blockers: ["migration-window and feature-gate state are absent or disagree"] };
  const verdict = evaluateMigrationAdvance(current, options.to, options.recordedAt, options.conformancePassed);
  if (!verdict.passed) return { status: "refused" as const, blockers: verdict.blockers };
  const nextWindow: MigrationWindowV1 = { schema_version: MIGRATION_WINDOW_SCHEMA, mode: options.to, entered_at: options.recordedAt, releases: [{ version: options.release, observed_at: options.recordedAt }], actor: options.actor };
  const nextGate = { ...gates, resolver_mode: options.to, revision: gates.revision + 1, updated_at: options.recordedAt, updated_by: options.actor, history: [...gates.history, { from: current.mode, to: options.to, reason: "D03 migration-window advance", recorded_at: options.recordedAt, actor: options.actor }] };
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
