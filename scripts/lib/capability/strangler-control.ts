import * as fs from "node:fs";
import * as path from "node:path";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import {
  planModeTransition,
  resolveCapability,
  resolverModeRank,
  type CapabilityResolutionRequest,
} from "../../../src/modules/capability/workflows/resolver-mode";

export const FEATURE_GATE_REGISTRY_SCHEMA = "guild.capability_feature_gates.v1" as const;
export const SHADOW_COMPARISON_SCHEMA = "guild.capability_shadow_comparison.v1" as const;
export const FEATURE_GATE_RELPATH = ".guild/artifacts/capability/feature-gates.json";

export interface CapabilityFeatureGateRegistryV1 {
  schema_version: typeof FEATURE_GATE_REGISTRY_SCHEMA;
  resolver_mode: CapabilityResolverMode;
  revision: number;
  updated_at: string;
  updated_by: string;
  history: readonly {
    from: CapabilityResolverMode;
    to: CapabilityResolverMode;
    reason: string;
    recorded_at: string;
    actor: string;
  }[];
}

const MODES = new Set<CapabilityResolverMode>(["legacy", "observe", "shadow", "project-local", "strict"]);

export function validateFeatureGateRegistry(value: unknown): CapabilityFeatureGateRegistryV1 | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;
  if (o.schema_version !== FEATURE_GATE_REGISTRY_SCHEMA || !MODES.has(o.resolver_mode as CapabilityResolverMode)) return null;
  if (!Number.isSafeInteger(o.revision) || (o.revision as number) < 0 || typeof o.updated_at !== "string" || typeof o.updated_by !== "string" || !Array.isArray(o.history)) return null;
  const history: Array<CapabilityFeatureGateRegistryV1["history"][number]> = [];
  for (const raw of o.history) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const h = raw as Record<string, unknown>;
    if (!MODES.has(h.from as CapabilityResolverMode) || !MODES.has(h.to as CapabilityResolverMode) || typeof h.reason !== "string" || !h.reason.trim() || typeof h.recorded_at !== "string" || typeof h.actor !== "string") return null;
    history.push({ from: h.from as CapabilityResolverMode, to: h.to as CapabilityResolverMode, reason: h.reason, recorded_at: h.recorded_at, actor: h.actor });
  }
  return { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: o.resolver_mode as CapabilityResolverMode, revision: o.revision as number, updated_at: o.updated_at, updated_by: o.updated_by, history };
}

export function readFeatureGateRegistry(projectRoot: string): CapabilityFeatureGateRegistryV1 | null {
  try { return validateFeatureGateRegistry(JSON.parse(fs.readFileSync(path.join(path.resolve(projectRoot), FEATURE_GATE_RELPATH), "utf8"))); }
  catch { return null; }
}

export function writeFeatureGateRegistry(projectRoot: string, registry: CapabilityFeatureGateRegistryV1): void {
  const valid = validateFeatureGateRegistry(registry);
  if (!valid) throw new Error("invalid capability feature-gate registry");
  const root = fs.realpathSync(projectRoot);
  const target = path.join(root, FEATURE_GATE_RELPATH);
  const written = writeContainedFile(root, target, Buffer.from(`${JSON.stringify(valid, null, 2)}\n`, "utf8"), { policy: "physical" });
  if (!written.written) throw new Error(`feature-gate registry write refused [${written.code}]: ${written.detail}`);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface ShadowArtifact { normalized: unknown; receipt: unknown }

export function shadowCompareCapability(
  request: Omit<CapabilityResolutionRequest, "mode" | "intent">,
  load: (path: string, source: "compatibility" | "project") => ShadowArtifact,
) {
  const legacy = resolveCapability({ ...request, mode: "shadow", intent: "shadow_compare" });
  const project = resolveCapability({ ...request, mode: "shadow", intent: "dispatch" });
  if (legacy.status !== "resolved" || project.status !== "resolved" || legacy.source !== "compatibility" || project.source !== "project") {
    return { schema_version: SHADOW_COMPARISON_SCHEMA, status: "refused" as const, binding: null, legacy, project };
  }
  const legacyArtifact = load(legacy.path, "compatibility");
  const projectArtifact = load(project.path, "project");
  const normalized_equivalent = canonical(legacyArtifact.normalized) === canonical(projectArtifact.normalized);
  const receipt_equivalent = canonical(legacyArtifact.receipt) === canonical(projectArtifact.receipt);
  return {
    schema_version: SHADOW_COMPARISON_SCHEMA,
    status: normalized_equivalent && receipt_equivalent ? "match" as const : "drift" as const,
    binding: "compatibility" as const,
    side_effects_permitted: false as const,
    normalized_equivalent,
    receipt_equivalent,
    legacy,
    project,
  };
}

export function executeResolverRollback(options: {
  projectRoot: string;
  to: CapabilityResolverMode;
  reason: string;
  actor: string;
  recordedAt: string;
}) {
  const current = readFeatureGateRegistry(options.projectRoot);
  if (!current) return { status: "refused" as const, detail: "feature-gate registry absent or invalid" };
  if (resolverModeRank(options.to) >= resolverModeRank(current.resolver_mode)) return { status: "refused" as const, detail: "rollback target must be a lower resolver rung" };
  const transition = planModeTransition({ from: current.resolver_mode, to: options.to, reason: options.reason, allow_skip: true });
  if (transition.status !== "allowed") return { status: "refused" as const, detail: transition.detail };
  if (transition.direction !== "regress") return { status: "refused" as const, detail: "transition is not a regression" };
  const next: CapabilityFeatureGateRegistryV1 = {
    ...current,
    resolver_mode: options.to,
    revision: current.revision + 1,
    updated_at: options.recordedAt,
    updated_by: options.actor,
    history: [...current.history, { from: current.resolver_mode, to: options.to, reason: options.reason, recorded_at: options.recordedAt, actor: options.actor }],
  };
  try { writeFeatureGateRegistry(options.projectRoot, next); }
  catch (error) { return { status: "failed" as const, detail: error instanceof Error ? error.message : String(error) }; }
  return { status: "rolled_back" as const, from: current.resolver_mode, to: options.to, revision: next.revision };
}
