import * as path from "node:path";
import {
  manifestCommitment,
  resolveCurrentDefinitionRef,
  verifyAgainstTip,
  type AdoptionManifestV1,
} from "../core/contracts/adoption-manifest";
import type { ProjectDefinitionRefV1 } from "../core/contracts/project-definition-ref";
import { resolveDefinitionArtifact } from "../definition-artifact-resolver";
import { resolveWorkspaceProjectRoot } from "../workspace-project-root";
import { scanReceiptJournal } from "../../../src/modules/telemetry";
import {
  adoptionCommitmentJournalRelpath,
  readAdoptionManifest,
} from "./adoption-migrate";

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
  const legacyJournal = path.join(root, ".guild", "runs", last.run_id, "receipts", "journal.jsonl");
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

export function definitionRefForDispatch(projectRoot: string, specialist: {
  name: string;
  definition?: string;
  definition_ref?: ProjectDefinitionRefV1;
}): DefinitionRefDispatchResult {
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
