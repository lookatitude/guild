import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  manifestCommitment,
  resolveCurrentDefinitionRef,
  verifyAgainstTip,
  type AdoptionManifestV1,
} from "../core/contracts/adoption-manifest";
import {
  PROJECT_DEFINITION_REF_SCHEMA,
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "../core/contracts/project-definition-ref";
import { parseFrontmatter } from "../frontmatter";
import { inlineSpecialistIdentity } from "./inline-specialist-identity";
import { resolvePluginRoot } from "../../../src/domains/kernel";
import { resolveDefinitionArtifact } from "../definition-artifact-resolver";
import { resolveWorkspaceProjectRoot } from "../workspace-project-root";
import { scanReceiptJournal } from "../../../src/domains/telemetry";
import {
  adoptionCommitmentJournalRelpath,
  readAdoptionManifest,
} from "./adoption-migrate";
import { durableGuildDir } from "../state/storage";

export type CommittedManifestResult =
  | { status: "committed"; manifest: AdoptionManifestV1 }
  | { status: "absent" | "invalid" | "uncommitted"; detail: string };

export function readCommittedAdoptionManifest(projectRoot: string): CommittedManifestResult {
  const manifest = readAdoptionManifest(projectRoot);
  if (manifest === null) return { status: "absent", detail: "no valid adoption manifest" };
  const commitment = manifestCommitment(manifest);
  const last = manifest.entries[manifest.entries.length - 1];
  if (!commitment.ok || commitment.digest === null || last === undefined) {
    return { status: "invalid", detail: "adoption manifest has no committable tip" };
  }
  const root = path.resolve(projectRoot);
  const canonicalJournal = path.join(root, adoptionCommitmentJournalRelpath(last.run_id));
  const legacyJournal = path.join(durableGuildDir(root), "runs", last.run_id, "receipts", "journal.jsonl");
  const canonicalScan = scanReceiptJournal(canonicalJournal);
  // Backward compatibility for manifests committed before the tracked authority
  // existed. Once present, the canonical journal is authoritative: corruption
  // fails closed instead of silently falling back to mutable local run state.
  const scan = canonicalScan.integrity === "absent"
    ? scanReceiptJournal(legacyJournal)
    : canonicalScan;
  if (scan.integrity !== "intact" || scan.observation_state !== "checked_clean" || scan.blocks_clean_close) {
    return { status: "uncommitted", detail: `receipt journal is ${scan.integrity}/${scan.observation_state}` };
  }
  const record = [...scan.records].reverse().find((candidate) =>
    candidate.run_id === last.run_id &&
    (candidate.event_name === "migration.cutover" || candidate.event_name === "migration.rollback") &&
    candidate.outcome_type === "guild.migration_outcome.v1" &&
    candidate.disposition === "succeeded" &&
    candidate.observation_state === "checked_clean" &&
    verifyAgainstTip(manifest, candidate.output_hash)
  );
  if (!record) return { status: "uncommitted", detail: "no durable receipt commits the current manifest tip" };
  return { status: "committed", manifest };
}

export type DefinitionRefDispatchResult =
  | { status: "resolved"; ref: ProjectDefinitionRefV1 }
  | { status: "invalid_request" | "capability_absent"; detail: string };

/**
 * #221: a shipped agent (`agents/<name>.md` in the plugin) has nothing to adopt,
 * so there is no manifest entry to read. Synthesize its ref from the shipped
 * bytes: layer `plugin-shipped`, hash over the file, identity from the same
 * inline derivation the launcher uses for the lane. Fails closed on any path
 * that is not the role-matched shipped file inside the real plugin root.
 */
function shippedDefinitionRef(
  pluginRoot: string,
  lane: ShippedLane,
): DefinitionRefDispatchResult {
  const { name, definition } = lane;
  if (definition !== `agents/${name}.md` || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    return { status: "invalid_request", detail: `shipped specialist ${name} must use definition agents/${name}.md` };
  }
  let bytes: Buffer;
  try {
    const realRoot = fs.realpathSync(pluginRoot);
    const abs = path.join(realRoot, definition);
    if (!fs.lstatSync(abs).isFile()) throw new Error("not a regular file");
    if (fs.realpathSync(abs) !== abs) {
      return { status: "invalid_request", detail: `shipped definition ${definition} resolves outside the plugin tree` };
    }
    bytes = fs.readFileSync(abs);
  } catch {
    return { status: "capability_absent", detail: `shipped definition ${definition} is not readable in the plugin` };
  }
  const fm = parseFrontmatter(bytes.toString("utf8"));
  if (!fm || fm["name"] !== name) {
    return { status: "invalid_request", detail: `shipped definition ${definition} does not declare name ${name}` };
  }
  const identity = inlineSpecialistIdentity(
    {
      name,
      definition_source: "shipped",
      definition,
      ...(lane.default_tier !== undefined ? { default_tier: lane.default_tier } : {}),
      ...(lane.tier !== undefined ? { tier: lane.tier } : {}),
      ...(lane.capability_scope !== undefined ? { capability_scope: lane.capability_scope } : {}),
    },
    bytes,
    [],
    null,
  );
  const ref = validateProjectDefinitionRefV1({
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: "plugin",
    layer: "plugin-shipped",
    kind: "agent",
    id: name,
    relative_path: definition,
    content_hash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    source_commit: null,
    specialist_profile_hash: identity.profileHash,
    specialist_type_hash: identity.typeHash,
    skills: [],
  });
  if (!ref) return { status: "invalid_request", detail: `shipped definition ${definition} yields an invalid ref` };
  return { status: "resolved", ref };
}

interface ShippedLane {
  name: string;
  definition: string;
  tier?: string;
  default_tier?: string;
  capability_scope?: string[];
}

export function definitionRefForDispatch(projectRoot: string, specialist: {
  name: string;
  definition?: string;
  definition_source?: string;
  definition_ref?: ProjectDefinitionRefV1;
  tier?: string;
  default_tier?: string;
  capability_scope?: string[];
}, opts: { pluginRoot?: string } = {}): DefinitionRefDispatchResult {
  if (specialist.definition_source === "shipped") {
    if (!specialist.definition) return { status: "invalid_request", detail: `shipped specialist ${specialist.name} has no definition path` };
    return shippedDefinitionRef(opts.pluginRoot ?? resolvePluginRoot(__dirname), {
      name: specialist.name,
      definition: specialist.definition,
      tier: specialist.tier,
      default_tier: specialist.default_tier,
      capability_scope: specialist.capability_scope,
    });
  }
  if (!specialist.definition) return { status: "invalid_request", detail: `project specialist ${specialist.name} has no definition path` };
  const committed = readCommittedAdoptionManifest(projectRoot);
  if (committed.status !== "committed") {
    return { status: "capability_absent", detail: `${committed.status}: ${committed.detail}` };
  }
  const current = resolveCurrentDefinitionRef(committed.manifest, {
    kind: "agent", id: specialist.name, relative_path: specialist.definition,
  });
  if (current.status !== "resolved" || current.ref === null) {
    return { status: "capability_absent", detail: `no unique committed current ref for ${specialist.name}` };
  }
  if (specialist.definition_ref !== undefined && JSON.stringify(specialist.definition_ref) !== JSON.stringify(current.ref)) {
    return { status: "invalid_request", detail: `team definition_ref disagrees with committed ref for ${specialist.name}` };
  }
  let artifactRoot = projectRoot;
  if (current.ref.project_id !== committed.manifest.project_id) {
    const federated = resolveWorkspaceProjectRoot(projectRoot, current.ref.project_id);
    if (federated.status !== "resolved") return federated;
    artifactRoot = federated.root;
  }
  const artifact = resolveDefinitionArtifact(artifactRoot, current.ref);
  if (artifact.status !== "resolved") return artifact;
  return { status: "resolved", ref: current.ref };
}
