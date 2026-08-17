import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  canonicalizeSelfBuildDefinitions,
  federateSelfBuildDefinitions,
  prepareSelfBuildRollbackBundle,
  runSelfBuildRollbackDrill,
} from "../lib/capability/self-build-canonicalize";
import { readAdoptionManifest } from "../lib/capability/adoption-migrate";
import { manifestCommitment, resolveHistorical } from "../lib/core/contracts/adoption-manifest";
import { validateFederationDefinitionManifestRefV1 } from "../lib/core/contracts/federation-definition-manifest-ref";
import { definitionRefForDispatch, readCommittedAdoptionManifest } from "../lib/capability/definition-ref-for-dispatch";
import {
  FEATURE_GATE_REGISTRY_SCHEMA,
  readFeatureGateRegistry,
  writeFeatureGateRegistry,
} from "../lib/capability/strangler-control";
import { main as selfBuildCanonicalizeMain } from "../self-build-canonicalize";

describe("PCL-15 self-build canonicalization", () => {
  it("maps retired umbrella absolute paths to plugin-owned refs and pins the child manifest", () => {
    const workspace = mkdtempSync(join(tmpdir(), "guild-self-build-workspace-"));
    const plugin = mkdtempSync(join(tmpdir(), "guild-self-build-plugin-"));
    const legacy = mkdtempSync(join(tmpdir(), "guild-self-build-umbrella-snapshot-"));
    try {
      mkdirSync(join(plugin, ".claude/agents"), { recursive: true });
      mkdirSync(join(plugin, ".guild/agents"), { recursive: true });
      mkdirSync(join(legacy, ".claude/agents"), { recursive: true });
      writeFileSync(join(plugin, ".claude/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\nplugin old\n");
      writeFileSync(join(plugin, ".guild/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: opus\n---\nplugin current\n");
      writeFileSync(join(legacy, ".claude/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\numbrella old\n");
      expect(canonicalizeSelfBuildDefinitions({ projectRoot: plugin, projectId: "plugin", runId: "run-plugin-cutover", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] }).status).toBe("prepared");

      const result = federateSelfBuildDefinitions({ workspaceRoot: workspace, workspaceProjectId: "umbrella", pluginRoot: plugin, pluginProjectId: "plugin", legacySourceRoot: legacy, historicalRoot: workspace, runId: "run-workspace-defork", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-11T00:00:00Z", roles: ["tooling-engineer"] });
      expect(result.status).toBe("prepared");
      expect(result.appended).toBe(1);
      const manifest = readAdoptionManifest(workspace)!;
      const historical = join(realpathSync(workspace), ".claude/agents/tooling-engineer.md");
      const resolved = resolveHistorical(manifest, { kind: "agent", id: "tooling-engineer", project_id: "umbrella", layer: "dot-claude-agents", historical_path: historical });
      expect(resolved.status).toBe("resolved");
      expect(resolved.ref?.project_id).toBe("plugin");

      const federationRef = validateFederationDefinitionManifestRefV1(JSON.parse(readFileSync(result.federation_ref_path, "utf8")));
      expect(federationRef?.project_id).toBe("plugin");
      expect(federationRef?.manifest_commitment).toBe(manifestCommitment(readAdoptionManifest(plugin)!).digest);
      expect(federateSelfBuildDefinitions({ workspaceRoot: workspace, workspaceProjectId: "umbrella", pluginRoot: plugin, pluginProjectId: "plugin", legacySourceRoot: legacy, historicalRoot: workspace, runId: "run-workspace-defork", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-11T00:00:00Z", roles: ["tooling-engineer"] })).toMatchObject({ status: "prepared", appended: 0 });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
      rmSync(legacy, { recursive: true, force: true });
    }
  });

  it("repairs an uncommitted manifest tip on retry instead of returning a false prepared result", () => {
    const workspace = mkdtempSync(join(tmpdir(), "guild-self-build-workspace-retry-"));
    const plugin = mkdtempSync(join(tmpdir(), "guild-self-build-plugin-retry-"));
    const legacy = mkdtempSync(join(tmpdir(), "guild-self-build-umbrella-retry-"));
    try {
      mkdirSync(join(plugin, ".claude/agents"), { recursive: true });
      mkdirSync(join(plugin, ".guild/agents"), { recursive: true });
      mkdirSync(join(legacy, ".claude/agents"), { recursive: true });
      writeFileSync(join(plugin, ".claude/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\nplugin old\n");
      writeFileSync(join(plugin, ".guild/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: opus\n---\nplugin current\n");
      writeFileSync(join(legacy, ".claude/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\numbrella old\n");
      expect(canonicalizeSelfBuildDefinitions({ projectRoot: plugin, projectId: "plugin", runId: "run-plugin-cutover", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] }).status).toBe("prepared");

      mkdirSync(join(workspace, ".guild/workspace-knowledge"), { recursive: true });
      writeFileSync(join(workspace, ".guild/workspace-knowledge/federated-definition-manifests"), "not a directory");
      const options = { workspaceRoot: workspace, workspaceProjectId: "umbrella", pluginRoot: plugin, pluginProjectId: "plugin", legacySourceRoot: legacy, historicalRoot: workspace, runId: "run-workspace-defork-retry", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-11T00:00:00Z", roles: ["tooling-engineer"] } as const;
      expect(federateSelfBuildDefinitions(options).status).toBe("refused");
      expect(readAdoptionManifest(workspace)?.entries).toHaveLength(1);
      expect(readCommittedAdoptionManifest(workspace).status).toBe("uncommitted");

      rmSync(join(workspace, ".guild/workspace-knowledge/federated-definition-manifests"));
      const repaired = federateSelfBuildDefinitions(options);
      expect(repaired).toMatchObject({ status: "prepared", appended: 0 });
      expect(readCommittedAdoptionManifest(workspace).status).toBe("committed");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(plugin, { recursive: true, force: true });
      rmSync(legacy, { recursive: true, force: true });
    }
  });

  it("commits a profile/ref manifest and verifies dispatch before retirement", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-self-build-"));
    try {
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      mkdirSync(join(root, ".guild/agents"), { recursive: true });
      writeFileSync(join(root, ".claude/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\nold\n");
      writeFileSync(join(root, ".guild/agents/tooling-engineer.md"), "---\nname: tooling-engineer\nmodel: sonnet\n---\nnew\n");
      const result = canonicalizeSelfBuildDefinitions({ projectRoot: root, projectId: "plugin", runId: "run-pcl15", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] });
      expect(result.status).toBe("prepared");
      expect(result.bytes_changed).toEqual(["tooling-engineer"]);
      expect(existsSync(join(root, ".guild/artifacts/capability/self-build-definition-refs.json"))).toBe(true);
      const manifest = readAdoptionManifest(root)!;
      expect(resolveHistorical(manifest, { kind: "agent", id: "tooling-engineer", project_id: "plugin", layer: "dot-claude-agents", historical_path: manifest.entries[0].from.historical_path }).status).toBe("resolved");
      expect(readFileSync(join(root, ".guild/runs/run-pcl15/receipts/journal.jsonl"), "utf8")).toContain("migration.cutover");
      const stdout = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
      try {
        expect(selfBuildCanonicalizeMain(["prepare-rollback", "--project-root", root, "--project-id", "plugin", "--legacy-source-root", root, "--roles", "tooling-engineer"])).toBe(0);
      } finally {
        stdout.mockRestore();
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("append-only repins final bytes after the legacy tree was retired", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-self-build-repin-"));
    try {
      const oldPath = join(root, ".claude/agents/tooling-engineer.md");
      const newPath = join(root, ".guild/agents/tooling-engineer.md");
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      mkdirSync(join(root, ".guild/agents"), { recursive: true });
      writeFileSync(oldPath, "---\nname: tooling-engineer\nmodel: sonnet\n---\nold\n");
      writeFileSync(newPath, "---\nname: tooling-engineer\nmodel: sonnet\n---\nintermediate\n");
      expect(canonicalizeSelfBuildDefinitions({ projectRoot: root, projectId: "plugin", runId: "run-pcl15-a", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] }).status).toBe("prepared");

      const finalBytes = Buffer.from("---\nname: tooling-engineer\nmodel: sonnet\n---\nfinal\n");
      writeFileSync(newPath, finalBytes);
      rmSync(oldPath);
      const rerun = canonicalizeSelfBuildDefinitions({ projectRoot: root, projectId: "plugin", runId: "run-pcl15-b", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T01:00:00Z", roles: ["tooling-engineer"] });
      expect(rerun.status).toBe("prepared");

      const manifest = readAdoptionManifest(root)!;
      expect(manifest.entries).toHaveLength(2);
      const resolved = resolveHistorical(manifest, { kind: "agent", id: "tooling-engineer", project_id: "plugin", layer: "dot-claude-agents", historical_path: manifest.entries[0].from.historical_path });
      expect(resolved.status).toBe("resolved");
      expect(resolved.ref?.content_hash).toBe(`sha256:${createHash("sha256").update(finalBytes).digest("hex")}`);
      expect(definitionRefForDispatch(root, { name: "tooling-engineer", definition: ".guild/agents/tooling-engineer.md", definition_ref: resolved.ref! }).status).toBe("resolved");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("S05-RD-01 restores a retired legacy projection from a hash-bound snapshot and rolls forward without deleting local definitions", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-self-build-drill-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "guild-self-build-legacy-source-"));
    try {
      const oldBytes = Buffer.from("---\nname: tooling-engineer\nmodel: sonnet\n---\nold\n");
      const newBytes = Buffer.from("---\nname: tooling-engineer\nwork_class: tooling\nmodel: opus\n---\nnew\n");
      const oldPath = join(root, ".claude/agents/tooling-engineer.md");
      const newPath = join(root, ".guild/agents/tooling-engineer.md");
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      mkdirSync(join(root, ".guild/agents"), { recursive: true });
      mkdirSync(join(sourceRoot, ".claude/agents"), { recursive: true });
      writeFileSync(oldPath, oldBytes);
      writeFileSync(join(sourceRoot, ".claude/agents/tooling-engineer.md"), oldBytes);
      writeFileSync(newPath, newBytes);
      expect(canonicalizeSelfBuildDefinitions({ projectRoot: root, projectId: "plugin", runId: "run-pcl15-cutover", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] }).status).toBe("prepared");
      rmSync(join(root, ".claude"), { recursive: true, force: true });

      writeFeatureGateRegistry(root, {
        schema_version: FEATURE_GATE_REGISTRY_SCHEMA,
        resolver_mode: "project-local",
        revision: 4,
        updated_at: "2026-08-10T00:01:00Z",
        updated_by: "cutover",
        history: [],
      });

      const prepared = prepareSelfBuildRollbackBundle({
        projectRoot: root,
        projectId: "plugin",
        legacySourceRoot: sourceRoot,
        roles: ["tooling-engineer"],
      });
      expect(prepared.status).toBe("prepared");

      const drill = runSelfBuildRollbackDrill({
        projectRoot: root,
        projectId: "plugin",
        runId: "run-pcl15-s05-rd-01",
        actor: "quality",
        rolledBackAt: "2026-08-10T00:02:00Z",
        rolledForwardAt: "2026-08-10T00:03:00Z",
        roles: ["tooling-engineer"],
      });
      expect(drill.status).toBe("passed");
      expect(drill.legacy_dispatches).toEqual(["tooling-engineer"]);
      expect(drill.project_dispatches).toEqual(["tooling-engineer"]);
      expect(readFeatureGateRegistry(root)?.resolver_mode).toBe("project-local");
      expect(readFeatureGateRegistry(root)?.revision).toBe(6);
      expect(existsSync(oldPath)).toBe(false);
      expect(readFileSync(newPath).equals(newBytes)).toBe(true);
      const receipt = JSON.parse(readFileSync(drill.receipt_path, "utf8"));
      expect(receipt.schema_version).toBe("guild.self_build_rollback_drill.v1");
      expect(receipt.rollback.resolver_mode).toBe("legacy");
      expect(receipt.roll_forward.resolver_mode).toBe("project-local");
      expect(receipt.first_project_run_executes_different_bytes).toBe(true);
      expect(receipt.shadow_comparison).toEqual([
        expect.objectContaining({
          id: "tooling-engineer",
          status: "match",
          normalized_equivalent: true,
          receipt_equivalent: true,
          policy_delta: {
            model: { legacy: "sonnet", project: "opus" },
            work_class: { legacy: null, project: "tooling" },
          },
        }),
      ]);
      expect(receipt.local_definitions_unchanged).toBe(true);
      expect(receipt.legacy_projections_removed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("removes restored legacy projections when the resolver rollback write is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-self-build-drill-refusal-"));
    const sourceRoot = mkdtempSync(join(tmpdir(), "guild-self-build-drill-refusal-source-"));
    try {
      const oldBytes = Buffer.from("---\nname: tooling-engineer\nmodel: sonnet\n---\nold\n");
      const newBytes = Buffer.from("---\nname: tooling-engineer\nmodel: sonnet\n---\nnew\n");
      const oldPath = join(root, ".claude/agents/tooling-engineer.md");
      const newPath = join(root, ".guild/agents/tooling-engineer.md");
      mkdirSync(join(root, ".claude/agents"), { recursive: true });
      mkdirSync(join(root, ".guild/agents"), { recursive: true });
      mkdirSync(join(sourceRoot, ".claude/agents"), { recursive: true });
      writeFileSync(oldPath, oldBytes);
      writeFileSync(join(sourceRoot, ".claude/agents/tooling-engineer.md"), oldBytes);
      writeFileSync(newPath, newBytes);
      expect(canonicalizeSelfBuildDefinitions({ projectRoot: root, projectId: "plugin", runId: "run-cutover", authorizedBy: "cap-loc-D09", adoptedAt: "2026-08-10T00:00:00Z", roles: ["tooling-engineer"] }).status).toBe("prepared");
      rmSync(join(root, ".claude"), { recursive: true, force: true });
      writeFeatureGateRegistry(root, { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "project-local", revision: 1, updated_at: "2026-08-10T00:01:00Z", updated_by: "cutover", history: [] });
      expect(prepareSelfBuildRollbackBundle({ projectRoot: root, projectId: "plugin", legacySourceRoot: sourceRoot, roles: ["tooling-engineer"] }).status).toBe("prepared");

      const gatePath = join(root, ".guild/artifacts/capability/feature-gates.json");
      const outsideGate = join(sourceRoot, "feature-gates.json");
      renameSync(gatePath, outsideGate);
      symlinkSync(outsideGate, gatePath);
      const result = runSelfBuildRollbackDrill({ projectRoot: root, projectId: "plugin", runId: "run-s05-refused", actor: "quality", rolledBackAt: "2026-08-10T00:02:00Z", rolledForwardAt: "2026-08-10T00:03:00Z", roles: ["tooling-engineer"] });
      expect(result.status).toBe("refused");
      expect(existsSync(oldPath)).toBe(false);
      expect(readFileSync(newPath).equals(newBytes)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});
