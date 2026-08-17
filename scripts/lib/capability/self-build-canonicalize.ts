import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SPECIALIST_PROFILE_SCHEMA, SPECIALIST_TYPE_SCHEMA, hashSpecialistProfile, hashSpecialistType, validateSpecialistProfileV1, validateSpecialistTypeV2, type SpecialistProfileV1, type SpecialistTypeV2 } from "../core/contracts/specialist-identity";
import { PROJECT_DEFINITION_REF_SCHEMA, validateProjectDefinitionRefV1, type ProjectDefinitionRefV1 } from "../core/contracts/project-definition-ref";
import { ADOPTION_MANIFEST_SCHEMA, entryDigest, manifestCommitment, resolveCurrentDefinitionRef, validateAdoptionEntry, validateAdoptionManifestV1, validateLegacyLocator, type AdoptionEntry, type LegacyLocator } from "../core/contracts/adoption-manifest";
import { FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA, validateFederationDefinitionManifestRefV1 } from "../core/contracts/federation-definition-manifest-ref";
import { tierForModel } from "../roster";
import { commitAdoptionManifest, readAdoptionManifest } from "./adoption-migrate";
import { definitionRefForDispatch, readCommittedAdoptionManifest } from "./definition-ref-for-dispatch";
import { writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import { resolveCapability } from "../../../src/modules/capability/workflows/resolver-mode";
import {
  executeResolverRollback,
  readFeatureGateRegistry,
  shadowCompareCapability,
  writeFeatureGateRegistry,
} from "./strangler-control";

export const SELF_BUILD_REFS_SCHEMA = "guild.self_build_definition_refs.v1" as const;
export const SELF_BUILD_REFS_RELPATH = ".guild/artifacts/capability/self-build-definition-refs.json";
export const SELF_BUILD_ROLLBACK_BUNDLE_SCHEMA = "guild.self_build_rollback_bundle.v1" as const;
export const SELF_BUILD_ROLLBACK_DRILL_SCHEMA = "guild.self_build_rollback_drill.v1" as const;
export const SELF_BUILD_ROLLBACK_BUNDLE_RELPATH = ".guild/artifacts/capability/self-build-rollback-bundle/index.json";
export const SELF_BUILD_FEDERATION_REF_RELPATH = ".guild/workspace-knowledge/federated-definition-manifests/plugin.json";

export interface SelfBuildRollbackBundleOptions {
  projectRoot: string;
  projectId: string;
  legacySourceRoot: string;
  roles: readonly string[];
}

export interface SelfBuildRollbackDrillOptions {
  projectRoot: string;
  projectId: string;
  runId: string;
  actor: string;
  rolledBackAt: string;
  rolledForwardAt: string;
  roles: readonly string[];
}

export interface SelfBuildFederationOptions {
  workspaceRoot: string;
  workspaceProjectId: string;
  pluginRoot: string;
  pluginProjectId: string;
  legacySourceRoot: string;
  historicalRoot: string;
  runId: string;
  authorizedBy: string;
  adoptedAt: string;
  roles: readonly string[];
}

interface SelfBuildRollbackBundleRole {
  id: string;
  legacy_relative_path: string;
  legacy_content_hash: string;
  snapshot_relative_path: string;
  local_relative_path: string;
  local_content_hash: string;
}

interface SelfBuildRollbackBundleV1 {
  schema_version: typeof SELF_BUILD_ROLLBACK_BUNDLE_SCHEMA;
  project_id: string;
  adoption_manifest_commitment: string;
  roles: SelfBuildRollbackBundleRole[];
}

const roleIds = (roles: readonly string[]): string[] | null => {
  const unique = [...new Set(roles)].sort();
  return unique.length > 0 && unique.every((id) => /^[a-z0-9][a-z0-9-]*$/.test(id)) ? unique : null;
};

const readRegular = (target: string): Buffer | null => {
  try {
    const stat = fs.lstatSync(target);
    return stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(target) : null;
  } catch {
    return null;
  }
};

const writeInside = (root: string, relativePath: string, bytes: Buffer): string | null => {
  const target = path.join(root, relativePath);
  const result = writeContainedFile(root, target, bytes, { policy: "physical" });
  return result.written ? target : null;
};

/**
 * Bind the retired workspace `.claude/agents` fork to the plugin-owned refs.
 * `legacySourceRoot` may be a reviewed snapshot; `historicalRoot` remains the
 * absolute root literally recorded by old context bundles.
 */
export function federateSelfBuildDefinitions(options: SelfBuildFederationOptions) {
  const roles = roleIds(options.roles);
  if (!roles) return { status: "refused" as const, detail: "roles must be unique canonical ids" };
  let workspaceRoot: string;
  let pluginRoot: string;
  let legacySourceRoot: string;
  let historicalRoot: string;
  try {
    workspaceRoot = fs.realpathSync(options.workspaceRoot);
    pluginRoot = fs.realpathSync(options.pluginRoot);
    legacySourceRoot = fs.realpathSync(options.legacySourceRoot);
    historicalRoot = fs.realpathSync(options.historicalRoot);
  } catch (error) {
    return { status: "refused" as const, detail: `one or more roots are unavailable: ${(error as Error).message}` };
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.workspaceProjectId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options.pluginProjectId)) {
    return { status: "refused" as const, detail: "project ids must be canonical tokens" };
  }

  const pluginManifest = readAdoptionManifest(pluginRoot);
  if (!pluginManifest || pluginManifest.project_id !== options.pluginProjectId) {
    return { status: "refused" as const, detail: "plugin adoption manifest is absent, invalid, or belongs to another project" };
  }
  const pluginCommitment = manifestCommitment(pluginManifest);
  if (!pluginCommitment.ok) return { status: "refused" as const, detail: "plugin adoption manifest has no valid commitment" };

  let refsArtifact: Record<string, unknown>;
  try {
    const raw = readRegular(path.join(pluginRoot, SELF_BUILD_REFS_RELPATH));
    if (!raw) return { status: "refused" as const, detail: "plugin self-build refs artifact is absent" };
    refsArtifact = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
  } catch (error) {
    return { status: "refused" as const, detail: `plugin self-build refs artifact is invalid: ${(error as Error).message}` };
  }
  if (refsArtifact.schema_version !== SELF_BUILD_REFS_SCHEMA || refsArtifact.project_id !== options.pluginProjectId || !Array.isArray(refsArtifact.roles)) {
    return { status: "refused" as const, detail: "plugin self-build refs artifact has the wrong envelope" };
  }
  const refById = new Map<string, ProjectDefinitionRefV1>();
  for (const row of refsArtifact.roles) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { status: "refused" as const, detail: "plugin refs artifact contains a malformed role" };
    const record = row as Record<string, unknown>;
    if (typeof record.id !== "string") return { status: "refused" as const, detail: "plugin refs artifact contains an unnamed role" };
    const ref = validateProjectDefinitionRefV1(record.definition_ref);
    if (!ref || ref.project_id !== options.pluginProjectId || ref.kind !== "agent" || ref.id !== record.id || refById.has(record.id)) {
      return { status: "refused" as const, detail: `plugin definition ref is invalid or duplicated for ${record.id}` };
    }
    if (definitionRefForDispatch(pluginRoot, { name: ref.id, definition: ref.relative_path, definition_ref: ref }).status !== "resolved") {
      return { status: "refused" as const, detail: `plugin definition ref no longer resolves for ${ref.id}` };
    }
    refById.set(ref.id, ref);
  }

  const prior = readAdoptionManifest(workspaceRoot) ?? {
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: options.workspaceProjectId,
    entries: [],
  };
  if (prior.project_id !== options.workspaceProjectId) return { status: "refused" as const, detail: "workspace manifest project id disagrees" };
  const entries: AdoptionEntry[] = [...prior.entries];
  let appended = 0;
  for (const id of roles) {
    const ref = refById.get(id);
    if (!ref) return { status: "refused" as const, detail: `plugin definition ref is absent for ${id}` };
    const legacyBytes = readRegular(path.join(legacySourceRoot, ".claude", "agents", `${id}.md`));
    if (!legacyBytes) return { status: "refused" as const, detail: `reviewed umbrella legacy bytes are absent for ${id}` };
    const historicalPath = path.join(historicalRoot, ".claude", "agents", `${id}.md`);
    const locator = validateLegacyLocator({
      project_id: options.workspaceProjectId,
      id,
      historical_path: historicalPath,
      content_hash: hashBytes(legacyBytes),
      home: "dot-claude-agents",
    });
    if (!locator) return { status: "refused" as const, detail: `umbrella historical locator is invalid for ${id}` };
    const existing = entries.find((entry) =>
      entry.kind === "agent" &&
      entry.from.project_id === locator.project_id &&
      entry.from.historical_path === locator.historical_path &&
      entry.from.content_hash === locator.content_hash
    );
    if (existing) {
      if (existing.to.project_id !== ref.project_id || existing.to.relative_path !== ref.relative_path || existing.to.content_hash !== ref.content_hash) {
        return { status: "refused" as const, detail: `umbrella historical locator already maps elsewhere for ${id}` };
      }
      continue;
    }
    const entry: AdoptionEntry = {
      sequence: entries.length + 1,
      kind: "agent",
      from: locator,
      to: ref,
      reason: "rehomed",
      detail: null,
      reverses_sequence: null,
      adopted_at: options.adoptedAt,
      run_id: options.runId,
      authorized_by: options.authorizedBy,
      prev_digest: entries.length === 0 ? null : entryDigest(entries[entries.length - 1]),
    };
    if (!validateAdoptionEntry(entry)) return { status: "refused" as const, detail: `umbrella transition did not validate for ${id}` };
    entries.push(entry);
    appended += 1;
  }

  const workspaceManifest = validateAdoptionManifestV1({
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: options.workspaceProjectId,
    entries,
  });
  if (!workspaceManifest) return { status: "refused" as const, detail: "workspace manifest became invalid" };
  const priorCommitState = appended === 0 ? readCommittedAdoptionManifest(workspaceRoot) : null;
  const federationRef = validateFederationDefinitionManifestRefV1({
    schema_version: FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA,
    project_id: options.pluginProjectId,
    manifest_path: ".guild/adoption-manifest.json",
    manifest_commitment: pluginCommitment.digest,
    source_commit: null,
  });
  if (!federationRef) return { status: "refused" as const, detail: "federation manifest reference did not validate" };

  const manifestPath = writeInside(workspaceRoot, ".guild/adoption-manifest.json", Buffer.from(`${JSON.stringify(workspaceManifest, null, 2)}\n`, "utf8"));
  if (!manifestPath) return { status: "refused" as const, detail: "workspace adoption manifest write was refused" };
  const federationRefPath = writeInside(workspaceRoot, SELF_BUILD_FEDERATION_REF_RELPATH, Buffer.from(`${JSON.stringify(federationRef, null, 2)}\n`, "utf8"));
  if (!federationRefPath) return { status: "refused" as const, detail: "federation manifest reference write was refused" };
  if (appended > 0 || priorCommitState?.status !== "committed") {
    const receipt = commitAdoptionManifest(workspaceRoot, workspaceManifest, "migration.cutover");
    if (!receipt?.durable) return { status: "refused" as const, detail: receipt?.failure?.message ?? "workspace manifest commitment failed" };
  }
  const committed = readCommittedAdoptionManifest(workspaceRoot);
  if (committed.status !== "committed") return { status: "refused" as const, detail: `workspace manifest remains ${committed.status}: ${committed.detail}` };
  return {
    status: "prepared" as const,
    appended,
    manifest_path: manifestPath,
    federation_ref_path: federationRefPath,
    plugin_manifest_commitment: pluginCommitment.digest,
  };
}

function readRollbackBundle(root: string): SelfBuildRollbackBundleV1 | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, SELF_BUILD_ROLLBACK_BUNDLE_RELPATH), "utf8")) as Record<string, unknown>;
    if (raw.schema_version !== SELF_BUILD_ROLLBACK_BUNDLE_SCHEMA || typeof raw.project_id !== "string" || typeof raw.adoption_manifest_commitment !== "string" || !Array.isArray(raw.roles)) return null;
    const roles: SelfBuildRollbackBundleRole[] = [];
    for (const value of raw.roles) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const row = value as Record<string, unknown>;
      if (typeof row.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(row.id) || typeof row.legacy_relative_path !== "string" || typeof row.legacy_content_hash !== "string" || typeof row.snapshot_relative_path !== "string" || typeof row.local_relative_path !== "string" || typeof row.local_content_hash !== "string") return null;
      roles.push(row as unknown as SelfBuildRollbackBundleRole);
    }
    if (new Set(roles.map((row) => row.id)).size !== roles.length) return null;
    return {
      schema_version: SELF_BUILD_ROLLBACK_BUNDLE_SCHEMA,
      project_id: raw.project_id,
      adoption_manifest_commitment: raw.adoption_manifest_commitment,
      roles,
    };
  } catch {
    return null;
  }
}

export function prepareSelfBuildRollbackBundle(options: SelfBuildRollbackBundleOptions) {
  let root: string;
  let legacySourceRoot: string;
  try {
    root = fs.realpathSync(options.projectRoot);
    legacySourceRoot = fs.realpathSync(options.legacySourceRoot);
  } catch (error) {
    return { status: "refused" as const, detail: `project or legacy source root is unreadable: ${(error as Error).message}` };
  }
  const roles = roleIds(options.roles);
  if (!roles) return { status: "refused" as const, detail: "roles must be a non-empty canonical set" };
  const manifest = readAdoptionManifest(root);
  if (!manifest || manifest.project_id !== options.projectId) return { status: "refused" as const, detail: "adoption manifest absent or belongs to another project" };
  const commitment = manifestCommitment(manifest);
  if (!commitment.ok) return { status: "refused" as const, detail: "adoption manifest has no valid commitment" };

  const rows: SelfBuildRollbackBundleRole[] = [];
  const snapshotWrites: Array<{ relativePath: string; bytes: Buffer }> = [];
  for (const id of roles) {
    const legacyRelativePath = `.claude/agents/${id}.md`;
    const legacyBytes = readRegular(path.join(legacySourceRoot, legacyRelativePath));
    if (!legacyBytes) return { status: "refused" as const, detail: `legacy snapshot source is missing or not a regular file for ${id}` };
    const legacyHash = hashBytes(legacyBytes);
    const origin = manifest.entries.find((entry) => entry.kind === "agent" && entry.from.project_id === options.projectId && entry.from.id === id && entry.from.home === "dot-claude-agents");
    if (!origin || origin.from.content_hash !== legacyHash) return { status: "refused" as const, detail: `legacy bytes do not match the adoption origin for ${id}` };

    const localRelativePath = `.guild/agents/${id}.md`;
    const current = resolveCurrentDefinitionRef(manifest, { kind: "agent", id, relative_path: localRelativePath });
    const localBytes = readRegular(path.join(root, localRelativePath));
    if (current.status !== "resolved" || !current.ref || !localBytes || current.ref.content_hash !== hashBytes(localBytes)) return { status: "refused" as const, detail: `current project definition is not dispatchable for ${id}` };

    const snapshotRelativePath = `.guild/artifacts/capability/self-build-rollback-bundle/legacy/${id}.md`;
    snapshotWrites.push({ relativePath: snapshotRelativePath, bytes: legacyBytes });
    rows.push({ id, legacy_relative_path: legacyRelativePath, legacy_content_hash: legacyHash, snapshot_relative_path: snapshotRelativePath, local_relative_path: localRelativePath, local_content_hash: current.ref.content_hash });
  }

  for (const write of snapshotWrites) {
    if (!writeInside(root, write.relativePath, write.bytes)) return { status: "refused" as const, detail: `snapshot write was refused for ${write.relativePath}` };
  }
  const bundle: SelfBuildRollbackBundleV1 = { schema_version: SELF_BUILD_ROLLBACK_BUNDLE_SCHEMA, project_id: options.projectId, adoption_manifest_commitment: commitment.digest, roles: rows };
  const indexPath = writeInside(root, SELF_BUILD_ROLLBACK_BUNDLE_RELPATH, Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, "utf8"));
  if (!indexPath) return { status: "refused" as const, detail: "rollback bundle index write was refused" };
  return { status: "prepared" as const, bundle_path: indexPath, roles: rows.length, adoption_manifest_commitment: commitment.digest };
}

export function runSelfBuildRollbackDrill(options: SelfBuildRollbackDrillOptions) {
  const refused = (detail: string) => ({ status: "refused" as const, detail, legacy_dispatches: [] as string[], project_dispatches: [] as string[], receipt_path: "" });
  let root: string;
  try { root = fs.realpathSync(options.projectRoot); }
  catch (error) { return refused(`project root is unreadable: ${(error as Error).message}`); }
  const roles = roleIds(options.roles);
  if (!roles) return refused("roles must be a non-empty canonical set");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.runId) || !options.actor.trim() || !Number.isFinite(Date.parse(options.rolledBackAt)) || !Number.isFinite(Date.parse(options.rolledForwardAt))) return refused("run, actor, or timestamps are invalid");
  const manifest = readAdoptionManifest(root);
  const bundle = readRollbackBundle(root);
  if (!manifest || manifest.project_id !== options.projectId || !bundle || bundle.project_id !== options.projectId) return refused("manifest or rollback bundle is absent/invalid");
  const commitment = manifestCommitment(manifest);
  if (!commitment.ok || commitment.digest !== bundle.adoption_manifest_commitment) return refused("rollback bundle is not bound to the current adoption manifest");
  const selected = roles.map((id) => bundle.roles.find((row) => row.id === id)).filter((row): row is SelfBuildRollbackBundleRole => row !== undefined);
  if (selected.length !== roles.length) return refused("rollback bundle does not cover every requested role");
  const priorGate = readFeatureGateRegistry(root);
  if (!priorGate || priorGate.resolver_mode === "legacy") return refused("feature-gate registry must be present above the legacy rung");

  const projectDispatches: string[] = [];
  const localBefore = new Map<string, Buffer>();
  for (const row of selected) {
    const localBytes = readRegular(path.join(root, row.local_relative_path));
    const current = resolveCurrentDefinitionRef(manifest, { kind: "agent", id: row.id, relative_path: row.local_relative_path });
    if (!localBytes || hashBytes(localBytes) !== row.local_content_hash || current.status !== "resolved" || !current.ref) return refused(`project definition changed or no longer resolves for ${row.id}`);
    const dispatch = definitionRefForDispatch(root, { name: row.id, definition: row.local_relative_path, definition_ref: current.ref });
    if (dispatch.status !== "resolved") return refused(`project dispatch refused for ${row.id}`);
    localBefore.set(row.id, localBytes);
    projectDispatches.push(row.id);
  }

  const createdLegacy: string[] = [];
  for (const row of selected) {
    const legacyTarget = path.join(root, row.legacy_relative_path);
    const existing = readRegular(legacyTarget);
    if (existing && hashBytes(existing) !== row.legacy_content_hash) return refused(`conflicting legacy projection exists for ${row.id}`);
    const snapshot = readRegular(path.join(root, row.snapshot_relative_path));
    if (!snapshot || hashBytes(snapshot) !== row.legacy_content_hash) return refused(`rollback snapshot is missing or corrupt for ${row.id}`);
    if (!existing) {
      if (!writeInside(root, row.legacy_relative_path, snapshot)) return refused(`legacy projection write was refused for ${row.id}`);
      createdLegacy.push(row.legacy_relative_path);
    }
  }

  const cleanupCreatedLegacy = (): boolean => {
    let cleaned = true;
    for (const relativePath of createdLegacy) {
      const target = path.join(root, relativePath);
      const row = selected.find((candidate) => candidate.legacy_relative_path === relativePath)!;
      const bytes = readRegular(target);
      if (bytes === null) continue;
      if (hashBytes(bytes) !== row.legacy_content_hash) { cleaned = false; continue; }
      try { fs.rmSync(target); }
      catch { cleaned = false; }
      if (fs.existsSync(target)) cleaned = false;
    }
    const legacyDir = path.join(root, ".claude", "agents");
    try {
      if (fs.existsSync(legacyDir) && fs.readdirSync(legacyDir).length === 0) fs.rmdirSync(legacyDir);
      const claudeDir = path.dirname(legacyDir);
      if (fs.existsSync(claudeDir) && fs.readdirSync(claudeDir).length === 0) fs.rmdirSync(claudeDir);
    } catch { cleaned = false; }
    return cleaned;
  };

  const shadowComparison = selected.map((row) => {
    const legacyBytes = readRegular(path.join(root, row.legacy_relative_path));
    const projectBytes = readRegular(path.join(root, row.local_relative_path));
    const legacyIdentity = legacyBytes ? frontmatter(legacyBytes) : null;
    const projectIdentity = projectBytes ? frontmatter(projectBytes) : null;
    if (!legacyIdentity || !projectIdentity) throw new Error(`unreadable shadow definition for ${row.id}`);
    const policyValue = (identity: Record<string, unknown>, key: "model" | "version" | "work_class" | "skills") =>
      key === "skills"
        ? (Array.isArray(identity.skills) ? [...identity.skills].sort() : [])
        : identity[key] ?? null;
    const policyDelta: Record<string, { legacy: unknown; project: unknown }> = {};
    for (const key of ["model", "version", "work_class", "skills"] as const) {
      const legacy = policyValue(legacyIdentity, key);
      const project = policyValue(projectIdentity, key);
      if (JSON.stringify(legacy) !== JSON.stringify(project)) policyDelta[key] = { legacy, project };
    }
    const comparison = shadowCompareCapability(
      {
        kind: "agent",
        capability_id: row.id,
        project_definition: row.local_relative_path,
        compatibility_asset: row.legacy_relative_path,
      },
      (relativePath) => {
        const bytes = readRegular(path.join(root, relativePath));
        const identity = bytes ? frontmatter(bytes) : null;
        if (!bytes || !identity) throw new Error(`unreadable shadow definition for ${row.id}`);
        return {
          // Lifecycle normalization deliberately excludes composition policy. The
          // D09 merge authorizes different self-build bytes (notably the richer
          // research-digester profile), so model/work_class/skills are recorded as
          // an explicit policy_delta below rather than mislabeled as transport or
          // receipt drift.
          normalized: { name: identity.name },
          receipt: { disposition: "resolved", role: row.id },
        };
      },
    );
    return {
      id: row.id,
      status: comparison.status,
      normalized_equivalent: comparison.status === "match" || comparison.status === "drift" ? comparison.normalized_equivalent : false,
      receipt_equivalent: comparison.status === "match" || comparison.status === "drift" ? comparison.receipt_equivalent : false,
      policy_delta: policyDelta,
      legacy_content_hash: row.legacy_content_hash,
      local_content_hash: row.local_content_hash,
    };
  });
  if (shadowComparison.some((row) => row.status !== "match")) {
    const cleaned = cleanupCreatedLegacy();
    return refused(`self-build shadow comparison drifted${cleaned ? "" : "; temporary legacy projections require manual cleanup"}`);
  }

  const rollback = executeResolverRollback({ projectRoot: root, to: "legacy", reason: "S05-RD-01 self-build rollback drill", actor: options.actor, recordedAt: options.rolledBackAt });
  if (rollback.status !== "rolled_back") {
    const cleaned = cleanupCreatedLegacy();
    return refused(`resolver rollback failed: ${rollback.detail}${cleaned ? "" : "; temporary legacy projections require manual cleanup"}`);
  }
  const legacyDispatches: string[] = [];
  for (const row of selected) {
    const resolution = resolveCapability({ mode: "legacy", intent: "dispatch", kind: "agent", capability_id: row.id, project_definition: row.local_relative_path, compatibility_asset: row.legacy_relative_path });
    const legacyBytes = readRegular(path.join(root, row.legacy_relative_path));
    if (resolution.status !== "resolved" || resolution.source !== "compatibility" || resolution.path !== row.legacy_relative_path || !legacyBytes || hashBytes(legacyBytes) !== row.legacy_content_hash) return refused(`legacy dispatch refused for ${row.id}`);
    legacyDispatches.push(row.id);
  }

  const rolledBackGate = readFeatureGateRegistry(root);
  if (!rolledBackGate || rolledBackGate.resolver_mode !== "legacy") return refused("resolver rollback did not persist the legacy rung");
  writeFeatureGateRegistry(root, {
    ...rolledBackGate,
    resolver_mode: priorGate.resolver_mode,
    revision: rolledBackGate.revision + 1,
    updated_at: options.rolledForwardAt,
    updated_by: options.actor,
    history: [...rolledBackGate.history, { from: "legacy", to: priorGate.resolver_mode, reason: "S05-RD-01 drill roll-forward", recorded_at: options.rolledForwardAt, actor: options.actor }],
  });

  const legacyProjectionsRemoved = cleanupCreatedLegacy();

  let localDefinitionsUnchanged = true;
  for (const row of selected) {
    const after = readRegular(path.join(root, row.local_relative_path));
    if (!after || !after.equals(localBefore.get(row.id)!)) localDefinitionsUnchanged = false;
  }
  const finalGate = readFeatureGateRegistry(root);
  if (!finalGate || finalGate.resolver_mode !== priorGate.resolver_mode || !legacyProjectionsRemoved || !localDefinitionsUnchanged) return refused("roll-forward did not restore the prior mode and filesystem state");

  const receiptRelativePath = `.guild/runs/${options.runId}/receipts/S05-RD-01-self-build-rollback.json`;
  const receipt = {
    schema_version: SELF_BUILD_ROLLBACK_DRILL_SCHEMA,
    project_id: options.projectId,
    run_id: options.runId,
    adoption_manifest_commitment: commitment.digest,
    roles,
    rollback: { resolver_mode: "legacy", revision: rolledBackGate.revision, recorded_at: options.rolledBackAt, dispatches: legacyDispatches },
    roll_forward: { resolver_mode: priorGate.resolver_mode, revision: finalGate.revision, recorded_at: options.rolledForwardAt, dispatches: projectDispatches },
    shadow_comparison: shadowComparison,
    first_project_run_executes_different_bytes: selected.some(
      (row) => row.legacy_content_hash !== row.local_content_hash,
    ),
    local_definitions_unchanged: localDefinitionsUnchanged,
    legacy_projections_removed: legacyProjectionsRemoved,
  };
  const receiptPath = writeInside(root, receiptRelativePath, Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"));
  if (!receiptPath) return refused("rollback drill receipt write was refused");
  return { status: "passed" as const, receipt_path: receiptPath, legacy_dispatches: legacyDispatches, project_dispatches: projectDispatches };
}

const hashBytes = (bytes: Buffer) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;

function frontmatter(bytes: Buffer): Record<string, unknown> | null {
  const text = bytes.toString("utf8");
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return null;
  const out: Record<string, unknown> = {};
  const lines = match[1].split("\n");
  for (let i = 0; i < lines.length; i++) {
    const scalar = /^(name|model|version|work_class):\s*["']?([^"']+?)["']?\s*$/.exec(lines[i]);
    if (scalar) { out[scalar[1]] = scalar[2].trim(); continue; }
    if (/^skills:\s*$/.test(lines[i])) {
      const skills: string[] = [];
      while (i + 1 < lines.length) {
        const item = /^\s+-\s+(.+?)\s*$/.exec(lines[i + 1]);
        if (!item) break;
        skills.push(item[1].replace(/^['"]|['"]$/g, "")); i++;
      }
      out.skills = skills;
    }
  }
  return typeof out.name === "string" ? out : null;
}

function identityForAgent(bytes: Buffer, id: string): { profile: SpecialistProfileV1; refHashes: { profile: string; type: string } } | null {
  const fm = frontmatter(bytes);
  if (!fm || fm.name !== id) return null;
  const skills = Array.isArray(fm.skills) ? fm.skills.filter((skill): skill is string => typeof skill === "string") : [];
  const type: SpecialistTypeV2 = {
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id: id,
    version: typeof fm.version === "string" ? fm.version : "1",
    role: id,
    capability_tags: ["guild-self-build"],
    compatible_skill_refs: [...new Set(skills)],
    semantic_tool_requirements: [],
    default_model_tier: tierForModel(typeof fm.model === "string" ? fm.model : null) ?? "mid",
    constraints: typeof fm.work_class === "string" ? { work_class: fm.work_class } : {},
    eval_fixture_refs: [],
  };
  const validType = validateSpecialistTypeV2(type);
  if (!validType) return null;
  const typeHash = hashSpecialistType(validType);
  const profile = validateSpecialistProfileV1({
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id: id,
    version: typeof fm.version === "string" ? fm.version : "1",
    derived_from: { type_id: id, type_version: validType.version, type_hash: typeHash },
    project_instructions: null,
    local_skill_refs: [...new Set(skills)],
  });
  if (!profile) return null;
  return { profile, refHashes: { profile: hashSpecialistProfile(profile), type: typeHash } };
}

export function canonicalizeSelfBuildDefinitions(options: { projectRoot: string; projectId: string; runId: string; authorizedBy: string; adoptedAt: string; roles: readonly string[] }) {
  const root = fs.realpathSync(options.projectRoot);
  const prior = readAdoptionManifest(root) ?? { schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: options.projectId, entries: [] };
  if (prior.project_id !== options.projectId) return { status: "refused" as const, detail: "manifest project id disagrees" };
  const entries: AdoptionEntry[] = [...prior.entries];
  const refs: Array<{ id: string; profile: SpecialistProfileV1; definition_ref: ProjectDefinitionRefV1; bytes_changed: boolean }> = [];
  const appendTransition = (kind: "agent", from: LegacyLocator, to: ProjectDefinitionRefV1): AdoptionEntry | null => {
    const entry: AdoptionEntry = {
      sequence: entries.length + 1,
      kind,
      from,
      to,
      reason: "migrated",
      detail: null,
      reverses_sequence: null,
      adopted_at: options.adoptedAt,
      run_id: options.runId,
      authorized_by: options.authorizedBy,
      prev_digest: entries.length === 0 ? null : entryDigest(entries[entries.length - 1]),
    };
    if (!validateAdoptionEntry(entry)) return null;
    entries.push(entry);
    return entry;
  };
  for (const id of [...new Set(options.roles)].sort()) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return { status: "refused" as const, detail: `invalid role id ${id}` };
    const oldPath = path.join(root, ".claude", "agents", `${id}.md`);
    const newPath = path.join(root, ".guild", "agents", `${id}.md`);
    let newBytes: Buffer;
    try {
      if (fs.lstatSync(newPath).isSymbolicLink()) return { status: "refused" as const, detail: `symlink definition for ${id}` };
      newBytes = fs.readFileSync(newPath);
    } catch (error) {
      return { status: "refused" as const, detail: `missing current definition for ${id}: ${(error as Error).message}` };
    }
    let oldBytes: Buffer | null = null;
    try {
      if (fs.lstatSync(oldPath).isSymbolicLink()) return { status: "refused" as const, detail: `symlink legacy definition for ${id}` };
      oldBytes = fs.readFileSync(oldPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { status: "refused" as const, detail: `unreadable legacy definition for ${id}: ${(error as Error).message}` };
    }
    const identity = identityForAgent(newBytes, id);
    if (!identity) return { status: "refused" as const, detail: `could not project specialist identity for ${id}` };
    const ref = validateProjectDefinitionRefV1({
      schema_version: PROJECT_DEFINITION_REF_SCHEMA,
      project_id: options.projectId,
      layer: "project-guild",
      kind: "agent",
      id,
      relative_path: `.guild/agents/${id}.md`,
      content_hash: hashBytes(newBytes),
      source_commit: null,
      specialist_profile_hash: identity.refHashes.profile,
      specialist_type_hash: identity.refHashes.type,
      skills: [],
    });
    if (!ref) return { status: "refused" as const, detail: `invalid definition ref for ${id}` };
    let origin = entries.find((entry) => entry.kind === "agent" && entry.from.id === id && entry.from.project_id === options.projectId && entry.from.historical_path === oldPath);
    if (!origin) {
      if (oldBytes === null) return { status: "refused" as const, detail: `legacy definition and adoption origin are both absent for ${id}` };
      const locator = validateLegacyLocator({ project_id: options.projectId, id, historical_path: oldPath, content_hash: hashBytes(oldBytes), home: "dot-claude-agents" });
      if (!locator || !appendTransition("agent", locator, ref)) return { status: "refused" as const, detail: `constructed origin entry did not validate for ${id}` };
      origin = entries[entries.length - 1];
    }

    const currentManifest = validateAdoptionManifestV1({ schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: options.projectId, entries });
    if (!currentManifest) return { status: "refused" as const, detail: `manifest became invalid while resolving ${id}` };
    const operative = resolveCurrentDefinitionRef(currentManifest, { kind: "agent", id, relative_path: ref.relative_path });
    if (operative.status !== "resolved" || !operative.ref) return { status: "refused" as const, detail: `current self-build ref is ${operative.status} for ${id}` };
    if (operative.ref.content_hash !== ref.content_hash || operative.ref.specialist_profile_hash !== ref.specialist_profile_hash || operative.ref.specialist_type_hash !== ref.specialist_type_hash) {
      const locator = validateLegacyLocator({
        project_id: operative.ref.project_id,
        id: operative.ref.id,
        historical_path: path.join(root, operative.ref.relative_path),
        content_hash: operative.ref.content_hash,
        home: operative.ref.layer,
      });
      if (!locator || !appendTransition("agent", locator, ref)) return { status: "refused" as const, detail: `constructed corrective entry did not validate for ${id}` };
    }
    refs.push({ id, profile: identity.profile, definition_ref: ref, bytes_changed: origin.from.content_hash !== ref.content_hash });
  }
  const manifest = validateAdoptionManifestV1({ schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: options.projectId, entries });
  if (!manifest) return { status: "refused" as const, detail: "constructed manifest did not validate" };
  const manifestPath = path.join(root, ".guild", "adoption-manifest.json");
  const artifactPath = path.join(root, SELF_BUILD_REFS_RELPATH);
  const manifestWrite = writeContainedFile(root, manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), { policy: "physical" });
  if (!manifestWrite.written) return { status: "refused" as const, detail: `manifest write refused [${manifestWrite.code}]: ${manifestWrite.detail}` };
  const artifactWrite = writeContainedFile(root, artifactPath, Buffer.from(`${JSON.stringify({ schema_version: SELF_BUILD_REFS_SCHEMA, project_id: options.projectId, first_run_executes_different_bytes: refs.some((row) => row.bytes_changed), roles: refs }, null, 2)}\n`, "utf8"), { policy: "physical" });
  if (!artifactWrite.written) return { status: "refused" as const, detail: `refs artifact write refused [${artifactWrite.code}]: ${artifactWrite.detail}` };
  const receipt = commitAdoptionManifest(root, manifest, "migration.cutover");
  if (!receipt?.durable) return { status: "refused" as const, detail: receipt?.failure?.message ?? "manifest commitment failed" };
  for (const row of refs) {
    const verified = definitionRefForDispatch(root, { name: row.id, definition: row.definition_ref.relative_path, definition_ref: row.definition_ref });
    if (verified.status !== "resolved") return { status: "refused" as const, detail: `post-commit dispatch verification failed for ${row.id}` };
  }
  return { status: "prepared" as const, manifest_path: manifestPath, artifact_path: artifactPath, roles: refs.length, bytes_changed: refs.filter((row) => row.bytes_changed).map((row) => row.id) };
}
