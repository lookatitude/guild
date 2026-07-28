import * as crypto from "node:crypto";

export const RELEASE_CLAIM_SCHEMA = "guild.release_claim.v1" as const;
export const OPERATION_KINDS = ["render", "install", "activate", "update", "uninstall", "verify"] as const;
export const ACCEPTED_CONFORMANCE_ARTIFACTS = [
  { path: "handoffs/tooling-engineer-MH-08.md", sha256: "6168cd3381edd6a8f4cb234e4cb1c714147c65ea11c92cd9210c6429663fcdb1" },
  { path: "validation/mh-08-r12-done-lead-validation.json", sha256: "23dee57b587426ef56fbbc60e38d0008eb8c972890d1ceb3cbe0ddde3bcebb85" },
  { path: "review/G-lane:MH-08/result-12-r2.json", sha256: "5141b2b45caee0e47ca21dd853db22f8d885161935b19049c2392036710d0bd4" },
  { path: "validation/mh-08-r12-review-r2-lead-validation.json", sha256: "0f8054585bd4aeae1780e49c67cf6e65efe7023aeafceeed6fe336090c0fc27e" },
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];
export type EvidenceClass = "release-builder" | "operator" | "fixture" | "unsupported";

export interface OperationEvidence {
  kind: OperationKind;
  destination: string;
  manager: { identity: string; path: string };
  evidence_class: EvidenceClass;
  outcome: "succeeded" | "refused";
  refusal_reason?: string;
}

export interface ReleaseClaim {
  schema_version: typeof RELEASE_CLAIM_SCHEMA;
  archive_path: string;
  archive_sha256: string;
  archive_size: number;
  source_commit: string;
  manifest: { entries: Array<{ path: string; sha256: string }> };
  manifest_sha256: string;
  contract_versions: {
    runtime: "guild.runtime_boundary_contract.v1";
    receipt: "guild.handoff.v2";
    artifact: "guild.artifact.v1";
  };
  conformance_artifacts: Array<{ path: string; sha256: string }>;
  operations: OperationEvidence[];
  host_support: { supported: false; reason: string };
  public_api: {
    artifact: "archive_sha256+manifest_sha256";
    receipt: "operations+conformance_artifacts";
  };
}

export type ReleaseClaimInput = Omit<
  ReleaseClaim,
  "schema_version" | "archive_sha256" | "archive_size" | "manifest_sha256" | "host_support" | "public_api"
> & { archive: Buffer };

function sha256(value: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildOperationEvidence(value: OperationEvidence): OperationEvidence {
  return { ...value, manager: { ...value.manager } };
}

export function buildReleaseClaim(input: ReleaseClaimInput): ReleaseClaim {
  const { archive, ...value } = input;
  return {
    schema_version: RELEASE_CLAIM_SCHEMA,
    ...value,
    archive_sha256: sha256(archive),
    archive_size: archive.length,
    manifest_sha256: sha256(stableJson(value.manifest)),
    host_support: {
      supported: false,
      reason: "operator activation evidence unavailable; render/install alone cannot establish support",
    },
    public_api: {
      artifact: "archive_sha256+manifest_sha256",
      receipt: "operations+conformance_artifacts",
    },
  };
}

export function verifyReleaseClaim(claim: ReleaseClaim, archive: Buffer): string[] {
  const errors: string[] = [];
  if (claim.schema_version !== RELEASE_CLAIM_SCHEMA) errors.push("release contract-version mismatch");
  if (claim.archive_sha256 !== sha256(archive) || claim.archive_size !== archive.length) {
    errors.push("archive checksum/size mismatch");
  }
  if (claim.manifest_sha256 !== sha256(stableJson(claim.manifest)) || claim.manifest.entries.length === 0) {
    errors.push("manifest mismatch");
  }
  if (
    !/^[a-f0-9]{40}$/.test(claim.source_commit) ||
    claim.archive_path !== `release/guild-${claim.source_commit}.tar.gz`
  ) {
    errors.push("source-commit mismatch");
  }
  if (
    claim.contract_versions.runtime !== "guild.runtime_boundary_contract.v1" ||
    claim.contract_versions.receipt !== "guild.handoff.v2" ||
    claim.contract_versions.artifact !== "guild.artifact.v1"
  ) {
    errors.push("contract-version mismatch");
  }
  if (stableJson(claim.conformance_artifacts) !== stableJson(ACCEPTED_CONFORMANCE_ARTIFACTS)) {
    errors.push("conformance-artifact hash mismatch");
  }
  if (
    claim.operations.length !== OPERATION_KINDS.length ||
    claim.operations.some((row, index) => row.kind !== OPERATION_KINDS[index]) ||
    new Set(claim.operations.map((row) => row.kind)).size !== OPERATION_KINDS.length
  ) {
    errors.push("operation kinds must be complete and distinct");
  }
  for (const row of claim.operations) {
    if (!row.destination || !row.manager.identity || !row.manager.path.startsWith("/")) {
      errors.push(`${row.kind}: destination and observed manager identity/path required`);
    }
    if (row.outcome === "refused" && !row.refusal_reason) errors.push(`${row.kind}: refusal reason required`);
    if (row.kind === "activate" && row.evidence_class !== "operator" && row.outcome !== "refused") {
      errors.push("activation requires operator evidence");
    }
  }
  if (claim.host_support.supported !== false) errors.push("unsupported host cannot be promoted");
  return errors;
}

export function serializeReleaseClaim(claim: ReleaseClaim): string {
  return JSON.stringify(claim, null, 2) + "\n";
}
