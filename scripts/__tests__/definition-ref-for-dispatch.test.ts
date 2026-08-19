import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ADOPTION_MANIFEST_SCHEMA, type AdoptionManifestV1 } from "../lib/core/contracts/adoption-manifest";
import { PROJECT_DEFINITION_REF_SCHEMA, type ProjectDefinitionRefV1 } from "../lib/core/contracts/project-definition-ref";
import { commitAdoptionManifest } from "../lib/capability/adoption-migrate";
import { definitionRefForDispatch, readCommittedAdoptionManifest } from "../lib/capability/definition-ref-for-dispatch";

const digest = (bytes: string) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("committed definition ref producer", () => {
  function fixture(commit = true) {
    const root = mkdtempSync(join(tmpdir(), "guild-dispatch-ref-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Guild Test"], { cwd: root });
    mkdirSync(join(root, ".guild/agents"), { recursive: true });
    writeFileSync(join(root, ".guild/agents/architect.md"), "architect bytes\n");
    execFileSync("git", ["add", ".guild/agents/architect.md"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "definition bytes"], { cwd: root });
    const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const ref: ProjectDefinitionRefV1 = {
      schema_version: PROJECT_DEFINITION_REF_SCHEMA,
      project_id: "fixture",
      layer: "project-guild",
      kind: "agent",
      id: "architect",
      relative_path: ".guild/agents/architect.md",
      content_hash: digest("architect bytes\n"),
      source_commit: source,
      specialist_profile_hash: "a".repeat(64),
      specialist_type_hash: "b".repeat(64),
      skills: [],
    };
    const manifest: AdoptionManifestV1 = {
      schema_version: ADOPTION_MANIFEST_SCHEMA,
      project_id: "fixture",
      entries: [{
        sequence: 1,
        kind: "agent",
        from: { project_id: "fixture", id: "old-architect", historical_path: "/legacy/old-architect.md", content_hash: digest("old"), home: "plugin-shipped" },
        to: ref,
        reason: "migrated",
        detail: null,
        reverses_sequence: null,
        adopted_at: "2026-08-10T06:00:00Z",
        run_id: "run-definition-ref",
        authorized_by: "cap-loc-D09",
        prev_digest: null,
      }],
    };
    writeFileSync(join(root, ".guild/adoption-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (commit) expect(commitAdoptionManifest(root, manifest, "migration.cutover")?.durable).toBe(true);
    return { root, ref };
  }

  it("resolves the exact current ref only after a durable external commitment", () => {
    const f = fixture();
    try {
      expect(readCommittedAdoptionManifest(f.root).status).toBe("committed");
      expect(definitionRefForDispatch(f.root, { name: "architect", definition: f.ref.relative_path })).toEqual({ status: "resolved", ref: f.ref });
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("refuses a valid but uncommitted manifest", () => {
    const f = fixture(false);
    try { expect(definitionRefForDispatch(f.root, { name: "architect", definition: f.ref.relative_path }).status).toBe("capability_absent"); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("refuses bytes tampered after the commitment", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.root, f.ref.relative_path), "tampered\n");
      expect(definitionRefForDispatch(f.root, { name: "architect", definition: f.ref.relative_path }).status).toBe("invalid_request");
    } finally { rmSync(f.root, { recursive: true, force: true }); }
  });

  it("resolves a committed cross-project successor through workspace federation", () => {
    const workspace = mkdtempSync(join(tmpdir(), "guild-federated-dispatch-ref-"));
    const source = join(workspace, "website");
    const destination = join(workspace, "plugin");
    try {
      mkdirSync(join(workspace, ".guild"), { recursive: true });
      mkdirSync(join(source, ".guild"), { recursive: true });
      mkdirSync(join(destination, ".guild/agents"), { recursive: true });
      writeFileSync(join(workspace, ".guild/workspace.json"), JSON.stringify({
        schema_version: "guild.workspace.v1",
        sub_guilds: [{ name: "website", path: "website" }, { name: "plugin", path: "plugin" }],
      }));
      writeFileSync(join(destination, ".guild/agents/diagram-motion-designer.md"), "canonical diagram bytes\n");
      const ref: ProjectDefinitionRefV1 = {
        schema_version: PROJECT_DEFINITION_REF_SCHEMA,
        project_id: "plugin", layer: "project-guild", kind: "agent", id: "diagram-motion-designer",
        relative_path: ".guild/agents/diagram-motion-designer.md", content_hash: digest("canonical diagram bytes\n"),
        source_commit: null, specialist_profile_hash: "a".repeat(64), specialist_type_hash: "b".repeat(64), skills: [],
      };
      const manifest: AdoptionManifestV1 = {
        schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: "website", entries: [{
          sequence: 1, kind: "agent",
          from: { project_id: "website", id: "diagram-motion-designer", historical_path: join(source, ".guild/agents/diagram-motion-designer.md"), content_hash: digest("old website bytes\n"), home: "project-guild" },
          to: ref, reason: "collapsed", detail: "canonicalized at umbrella", reverses_sequence: null,
          adopted_at: "2026-08-10T06:00:00Z", run_id: "run-federated-ref", authorized_by: "cap-loc-D10", prev_digest: null,
        }],
      };
      writeFileSync(join(source, ".guild/adoption-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      expect(commitAdoptionManifest(source, manifest, "migration.cutover")?.durable).toBe(true);
      expect(definitionRefForDispatch(source, { name: ref.id, definition: ref.relative_path })).toEqual({ status: "resolved", ref });
    } finally { rmSync(workspace, { recursive: true, force: true }); }
  });
});
