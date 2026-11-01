/**
 * tests/e00/support/adopted-definition.ts — a legitimate, test-owned adopted
 * specialist definition in a temp Guild root (E00-L Q3).
 *
 * Uses only the existing adoption contracts: the definition bytes are committed in
 * the root's own git repository, the guild.adoption_manifest.v1 entry names them by
 * content hash and source commit, and commitAdoptionManifest writes the durable
 * receipt that readCommittedAdoptionManifest / definitionRefForDispatch require.
 * The profile and type hashes are test-owned values the lane must repeat. Nothing
 * here is review, package or host evidence.
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { ADOPTION_MANIFEST_SCHEMA, type AdoptionManifestV1 } from "../../../scripts/lib/core/contracts/adoption-manifest";
import { PROJECT_DEFINITION_REF_SCHEMA, type ProjectDefinitionRefV1 } from "../../../scripts/lib/core/contracts/project-definition-ref";
import { commitAdoptionManifest } from "../../../scripts/lib/capability/adoption-migrate";

export const TEST_PROFILE_HASH = "c".repeat(64);
export const TEST_TYPE_HASH = "d".repeat(64);

const git = (root: string, args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

export interface AdoptedDefinition {
  ref: ProjectDefinitionRefV1;
  bytes: Buffer;
  sha256: string;
  abs: string;
}

/** Commit `<root>/.guild/agents/<role>.md` and a durably committed adoption manifest naming it. */
export function adoptDefinition(root: string, role: string, opts: { projectId?: string; body?: string } = {}): AdoptedDefinition {
  if (!fs.existsSync(path.join(root, ".git"))) {
    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "e00-t0@example.invalid"]);
    git(root, ["config", "user.name", "E00 T0 fixture"]);
  }
  const rel = `.guild/agents/${role}.md`;
  const abs = path.join(root, rel);
  const body = opts.body ?? `---\nname: ${role}\ntype: specialist\n---\nE00 T0 test-owned ${role} definition.\n`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, ["add", rel]);
  git(root, ["commit", "-qm", `adopt ${role}`]);
  const source = git(root, ["rev-parse", "HEAD"]).trim();
  const bytes = fs.readFileSync(abs);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const projectId = opts.projectId ?? "e00-fixture";
  const ref: ProjectDefinitionRefV1 = {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: projectId,
    layer: "project-guild",
    kind: "agent",
    id: role,
    relative_path: rel,
    content_hash: `sha256:${sha256}`,
    source_commit: source,
    specialist_profile_hash: TEST_PROFILE_HASH,
    specialist_type_hash: TEST_TYPE_HASH,
    skills: [],
  };
  const manifest: AdoptionManifestV1 = {
    schema_version: ADOPTION_MANIFEST_SCHEMA,
    project_id: projectId,
    entries: [{
      sequence: 1, kind: "agent",
      from: { project_id: projectId, id: role, historical_path: `/legacy/${role}.md`, content_hash: `sha256:${"0".repeat(64)}`, home: "plugin-shipped" },
      to: ref, reason: "migrated", detail: null, reverses_sequence: null,
      adopted_at: "2026-10-26T13:00:00Z", run_id: "run-e00-adopt", authorized_by: "e00-t0-fixture", prev_digest: null,
    }],
  };
  fs.writeFileSync(path.join(root, ".guild", "adoption-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (!commitAdoptionManifest(root, manifest, "migration.cutover")?.durable) throw new Error("fixture: adoption manifest commitment was not durable");
  return { ref, bytes, sha256, abs };
}
