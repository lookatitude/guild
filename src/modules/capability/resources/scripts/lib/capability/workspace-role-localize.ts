import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../frontmatter";
import { resolveWorkspaceProjectRoot } from "../workspace-project-root";
import {
  SPECIALIST_PROFILE_SCHEMA,
  SPECIALIST_TYPE_SCHEMA,
  hashSpecialistProfile,
  hashSpecialistType,
  validateSpecialistProfileV1,
  validateSpecialistTypeV2,
} from "../core/contracts/specialist-identity";
import {
  PROJECT_DEFINITION_REF_SCHEMA,
  validateProjectDefinitionRefV1,
  type DefinitionLayer,
  type ProjectDefinitionRefV1,
} from "../core/contracts/project-definition-ref";
import {
  ADOPTION_MANIFEST_SCHEMA,
  entryDigest,
  validateAdoptionEntry,
  validateAdoptionManifestV1,
  type AdoptionEntry,
  type AdoptionManifestV1,
  type LegacyHome,
} from "../core/contracts/adoption-manifest";
import { commitAdoptionManifest, readAdoptionManifest } from "./adoption-migrate";

export const WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA = "guild.workspace_role_localization_plan.v1" as const;
export const WORKSPACE_ROLE_LOCALIZATION_RESULT_SCHEMA = "guild.workspace_role_localization_result.v1" as const;

export interface WorkspaceRoleLocalizationPlanItem {
  id: string;
  disposition: "stay" | "two_home" | "collapse";
  destination: { project_id: string; relative_path: string };
  manifest_project_id: string;
  source:
    | { mode: "template_origin" }
    | { mode: "historical"; project_id: string; historical_path: string; home: LegacyHome; content_hash: string | null };
  detail: string;
  label: string;
}

export interface WorkspaceRoleLocalizationPlan {
  schema_version: typeof WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA;
  run_id: string;
  adopted_at: string;
  authorized_by: string;
  items: WorkspaceRoleLocalizationPlanItem[];
}

const hashBytes = (bytes: Buffer) => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
const relativePath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]+/).some((part) => part === "" || part === "." || part === "..");
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const tierForModel = (model: string | null): "cheap" | "mid" | "powerful" => {
  const value = (model ?? "").toLowerCase();
  if (value.includes("opus")) return "powerful";
  if (value.includes("haiku")) return "cheap";
  return "mid";
};

function gitCommitForBytes(root: string, rel: string, bytes: Buffer): string | null {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const committed = execFileSync("git", ["show", `${commit}:${rel}`], { cwd: root, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"] });
    return committed.equals(bytes) ? commit : null;
  } catch {
    return null;
  }
}

function buildDestination(root: string, projectId: string, rel: string) {
  const bytes = fs.readFileSync(path.join(root, rel));
  const fm = parseFrontmatter(bytes.toString("utf8"));
  if (!fm) throw new Error(`${projectId}:${rel} has no parseable frontmatter`);
  const id = typeof fm["name"] === "string" ? fm["name"] : path.basename(rel, ".md");
  const allSkills = stringList(fm["skills"]);
  const localSkills: Array<{ id: string; relative_path: string; content_hash: string }> = [];
  for (const skillId of allSkills) {
    const skillRel = `.guild/skills/${skillId}/SKILL.md`;
    const skillAbs = path.join(root, skillRel);
    try {
      if (!fs.lstatSync(skillAbs).isFile()) continue;
      localSkills.push({ id: skillId, relative_path: skillRel, content_hash: hashBytes(fs.readFileSync(skillAbs)) });
    } catch {
      // Shared/plugin skills are not project-local refs.
    }
  }
  const typeId = typeof fm["specialist_type"] === "string" ? fm["specialist_type"] : id;
  const version = typeof fm["version"] === "string" || typeof fm["version"] === "number" ? String(fm["version"]) : "1";
  const specialistType = validateSpecialistTypeV2({
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id: typeId,
    version,
    role: id,
    capability_tags: [...new Set(allSkills)],
    compatible_skill_refs: [...new Set(allSkills)],
    semantic_tool_requirements: [],
    default_model_tier: tierForModel(typeof fm["model"] === "string" ? fm["model"] : null),
    constraints: {
      ...(typeof fm["scope"] === "string" ? { scope: fm["scope"] } : {}),
      ...(typeof fm["work_class"] === "string" ? { work_class: fm["work_class"] } : {}),
    },
    eval_fixture_refs: [],
  });
  if (!specialistType) throw new Error(`${projectId}:${rel} could not mint a specialist type`);
  const typeHash = hashSpecialistType(specialistType);
  const profile = validateSpecialistProfileV1({
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id: id,
    version,
    derived_from: { type_id: typeId, type_version: version, type_hash: typeHash },
    project_instructions: null,
    local_skill_refs: localSkills.map((skill) => skill.id),
  });
  if (!profile) throw new Error(`${projectId}:${rel} could not mint a specialist profile`);
  const layer: DefinitionLayer = projectId === "umbrella" ? "umbrella-guild" : "project-guild";
  const ref = validateProjectDefinitionRefV1({
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: projectId,
    layer,
    kind: "agent",
    id,
    relative_path: rel,
    content_hash: hashBytes(bytes),
    source_commit: gitCommitForBytes(root, rel, bytes),
    specialist_profile_hash: hashSpecialistProfile(profile),
    specialist_type_hash: typeHash,
    skills: localSkills,
  });
  if (!ref) throw new Error(`${projectId}:${rel} could not mint a definition ref`);
  return { bytes, fm, specialist_type: specialistType, profile, ref };
}

function templateOrigin(workspaceRoot: string, item: WorkspaceRoleLocalizationPlanItem, fm: Record<string, unknown>) {
  const derived = typeof fm["derived_from_template"] === "string" ? fm["derived_from_template"] : "guild.agent_template.v1";
  const plugin = resolveWorkspaceProjectRoot(workspaceRoot, "plugin");
  if (plugin.status === "resolved") {
    if (derived === "guild.specialist_template.v1") {
      const sourcePath = path.join(plugin.root, "templates", "specialists", `${item.id}.md`);
      try {
        const bytes = fs.readFileSync(sourcePath);
        return { project_id: "plugin", id: item.id, historical_path: sourcePath, content_hash: hashBytes(bytes), home: "plugin-shipped" as const };
      } catch {
        // fall through to the abstract template locator
      }
    }
    const typeId = typeof fm["specialist_type"] === "string" ? fm["specialist_type"] : item.id;
    return { project_id: "plugin", id: item.id, historical_path: path.join(plugin.root, "templates", "agent-types", `${derived}-${typeId}.md`), content_hash: null, home: "plugin-shipped" as const };
  }
  throw new Error("plugin root unavailable for template-origin locator");
}

export function applyWorkspaceRoleLocalization(workspaceRootInput: string, plan: WorkspaceRoleLocalizationPlan) {
  const workspaceRoot = fs.realpathSync(workspaceRootInput);
  if (!plan || plan.schema_version !== WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA || !token(plan.run_id) || !token(plan.authorized_by) || !Array.isArray(plan.items)) {
    return { status: "refused" as const, detail: "invalid workspace role-localization plan" };
  }
  const manifests = new Map<string, { root: string; prior: AdoptionManifestV1 | null; entries: AdoptionEntry[] }>();
  const results: Array<Record<string, unknown>> = [];
  try {
    for (const item of plan.items) {
      if (!token(item.id) || !token(item.destination?.project_id) || !token(item.manifest_project_id) || !relativePath(item.destination?.relative_path)) throw new Error(`invalid plan item ${item?.id ?? "unknown"}`);
      const destinationRoot = resolveWorkspaceProjectRoot(workspaceRoot, item.destination.project_id);
      const manifestRoot = resolveWorkspaceProjectRoot(workspaceRoot, item.manifest_project_id);
      if (destinationRoot.status !== "resolved") throw new Error(destinationRoot.detail);
      if (manifestRoot.status !== "resolved") throw new Error(manifestRoot.detail);
      const destination = buildDestination(destinationRoot.root, item.destination.project_id, item.destination.relative_path);
      if (destination.ref.id !== item.id) throw new Error(`${item.id} disagrees with destination frontmatter name`);
      let bucket = manifests.get(item.manifest_project_id);
      if (!bucket) {
        const prior = readAdoptionManifest(manifestRoot.root);
        bucket = { root: manifestRoot.root, prior, entries: [...(prior?.entries ?? [])] };
        manifests.set(item.manifest_project_id, bucket);
      }
      const from = item.source.mode === "template_origin"
        ? templateOrigin(workspaceRoot, item, destination.fm)
        : { project_id: item.source.project_id, id: item.id, historical_path: item.source.historical_path, content_hash: item.source.content_hash, home: item.source.home };
      const duplicate = bucket.entries.some((entry) => entry.kind === "agent" && entry.from.project_id === from.project_id && entry.from.id === from.id && entry.from.historical_path === from.historical_path && entry.to?.content_hash === destination.ref.content_hash && entry.to?.project_id === destination.ref.project_id);
      if (!duplicate) {
        const reason = item.disposition === "collapse" ? "collapsed" : "migrated";
        const entry: AdoptionEntry = {
          sequence: bucket.entries.length + 1,
          kind: "agent",
          from,
          to: destination.ref,
          reason,
          detail: reason === "collapsed" ? item.detail : null,
          reverses_sequence: null,
          adopted_at: plan.adopted_at,
          run_id: plan.run_id,
          authorized_by: plan.authorized_by,
          prev_digest: bucket.entries.length === 0 ? null : entryDigest(bucket.entries[bucket.entries.length - 1]),
        };
        if (!validateAdoptionEntry(entry)) throw new Error(`invalid adoption entry for ${item.id}`);
        bucket.entries.push(entry);
      }
      results.push({ id: item.id, disposition: item.disposition, label: item.label, manifest_project_id: item.manifest_project_id, specialist_type: destination.specialist_type, profile: destination.profile, definition_ref: destination.ref });
    }

    const validated = new Map<string, AdoptionManifestV1>();
    for (const [projectId, bucket] of manifests) {
      const manifest = validateAdoptionManifestV1({ schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: projectId, entries: bucket.entries });
      if (!manifest) throw new Error(`constructed manifest did not validate for ${projectId}`);
      validated.set(projectId, manifest);
    }
    for (const [projectId, manifest] of validated) {
      const bucket = manifests.get(projectId)!;
      const manifestPath = path.join(bucket.root, ".guild", "adoption-manifest.json");
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      const receipt = commitAdoptionManifest(bucket.root, manifest, "migration.cutover");
      if (!receipt?.durable) throw new Error(`manifest commitment failed for ${projectId}`);
    }
    return { status: "applied" as const, schema_version: WORKSPACE_ROLE_LOCALIZATION_RESULT_SCHEMA, workspace_root: workspaceRoot, run_id: plan.run_id, manifests: [...validated.keys()].sort(), roles: results };
  } catch (error) {
    return { status: "refused" as const, detail: error instanceof Error ? error.message : String(error) };
  }
}
