import { isAbsolute } from "node:path";
import { types as nodeTypes } from "node:util";

export const FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA = "guild.federation_definition_manifest_ref.v1" as const;

export interface FederationDefinitionManifestRefV1 {
  schema_version: typeof FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA;
  project_id: string;
  manifest_path: string;
  manifest_commitment: string;
  source_commit: string | null;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,64}$/;

const EXACT_KEYS = [
  "manifest_commitment",
  "manifest_path",
  "project_id",
  "schema_version",
  "source_commit",
] as const;

function isPlainDataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (nodeTypes.isProxy(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ownDataValue(
  object: object,
  key: string,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) return { ok: false };
  return { ok: true, value: descriptor.value };
}

/** A federation points at a committed child manifest; it never copies its entries. */
export function validateFederationDefinitionManifestRefV1(value: unknown): FederationDefinitionManifestRefV1 | null {
  try {
    if (!isPlainDataObject(value)) return null;
    if (Object.getOwnPropertySymbols(value).length > 0) return null;
    const names = Object.getOwnPropertyNames(value).sort();
    if (names.join("\0") !== [...EXACT_KEYS].sort().join("\0")) return null;

    const schemaVersion = ownDataValue(value, "schema_version");
    const projectId = ownDataValue(value, "project_id");
    const manifestPath = ownDataValue(value, "manifest_path");
    const commitment = ownDataValue(value, "manifest_commitment");
    const sourceCommit = ownDataValue(value, "source_commit");
    if (
      !schemaVersion.ok ||
      !projectId.ok ||
      !manifestPath.ok ||
      !commitment.ok ||
      !sourceCommit.ok
    ) return null;
    if (schemaVersion.value !== FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA) return null;
    if (typeof projectId.value !== "string" || !TOKEN.test(projectId.value)) return null;
    if (
      typeof manifestPath.value !== "string" ||
      isAbsolute(manifestPath.value) ||
      manifestPath.value !== ".guild/adoption-manifest.json"
    ) return null;
    if (typeof commitment.value !== "string" || !DIGEST.test(commitment.value)) return null;
    if (
      sourceCommit.value !== null &&
      (typeof sourceCommit.value !== "string" || !COMMIT.test(sourceCommit.value))
    ) return null;
    return {
      schema_version: FEDERATION_DEFINITION_MANIFEST_REF_SCHEMA,
      project_id: projectId.value,
      manifest_path: manifestPath.value,
      manifest_commitment: commitment.value,
      source_commit: sourceCommit.value as string | null,
    };
  } catch {
    return null;
  }
}
