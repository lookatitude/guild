import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyWorkspaceRoleLocalization, WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA } from "./workspace-role-localize";
import { definitionRefForDispatch } from "./definition-ref-for-dispatch";
import { tierForModel } from "../roster";

describe("workspace role localization", () => {
  it("registers a stay ref and a cross-project collapse with durable manifests", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "guild-role-localize-"));
    try {
      for (const rel of [".guild", "plugin/templates/specialists", "website/.guild/agents", ".guild/agents"]) fs.mkdirSync(path.join(workspace, rel), { recursive: true });
      fs.writeFileSync(path.join(workspace, ".guild/workspace.json"), JSON.stringify({ schema_version: "guild.workspace.v1", sub_guilds: [{ name: "plugin", path: "plugin" }, { name: "website", path: "website" }] }));
      fs.writeFileSync(path.join(workspace, "plugin/templates/specialists/architect.md"), "---\nname: architect\n---\n");
      fs.writeFileSync(path.join(workspace, ".guild/agents/architect.md"), "---\nname: architect\nmodel: opus\nderived_from_template: guild.specialist_template.v1\nskills: []\n---\n");
      fs.writeFileSync(path.join(workspace, ".guild/agents/diagram-motion-designer.md"), "---\nname: diagram-motion-designer\nmodel: opus\nspecialist_type: diagram-production\nskills: []\n---\n");
      const oldWebsite = path.join(workspace, "website/.guild/agents/diagram-motion-designer.md");
      fs.writeFileSync(oldWebsite, "old website definition\n");
      const result = applyWorkspaceRoleLocalization(workspace, {
        schema_version: WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA,
        run_id: "run-role-localize", adopted_at: "2026-08-10T12:00:00Z", authorized_by: "cap-loc-D10",
        items: [
          { id: "architect", disposition: "stay", destination: { project_id: "umbrella", relative_path: ".guild/agents/architect.md" }, manifest_project_id: "umbrella", source: { mode: "template_origin" }, detail: "umbrella carrier", label: "umbrella product-work carrier" },
          { id: "diagram-motion-designer", disposition: "collapse", destination: { project_id: "umbrella", relative_path: ".guild/agents/diagram-motion-designer.md" }, manifest_project_id: "website", source: { mode: "historical", project_id: "website", historical_path: oldWebsite, home: "project-guild", content_hash: null }, detail: "collapsed to umbrella", label: "workspace diagram authority" },
        ],
      });
      expect(result.status).toBe("applied");
      expect(definitionRefForDispatch(workspace, { name: "architect", definition: ".guild/agents/architect.md" }).status).toBe("resolved");
      expect(definitionRefForDispatch(path.join(workspace, "website"), { name: "diagram-motion-designer", definition: ".guild/agents/diagram-motion-designer.md" }).status).toBe("resolved");
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  });

  // G06 R6: one model→tier rule. Known models follow the canonical ladder; an
  // unknown model gets "mid", the same fallback roster.ts applies.
  it("derives default_model_tier from the canonical ladder, unknown model → mid", () => {
    const tierFor = (model: string) => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "guild-role-tier-"));
      try {
        for (const rel of [".guild/agents", "plugin/templates/specialists"]) fs.mkdirSync(path.join(workspace, rel), { recursive: true });
        fs.writeFileSync(path.join(workspace, ".guild/workspace.json"), JSON.stringify({ schema_version: "guild.workspace.v1", sub_guilds: [{ name: "plugin", path: "plugin" }] }));
        fs.writeFileSync(path.join(workspace, "plugin/templates/specialists/architect.md"), "---\nname: architect\n---\n");
        fs.writeFileSync(path.join(workspace, ".guild/agents/architect.md"), `---\nname: architect\nmodel: ${model}\nderived_from_template: guild.specialist_template.v1\nskills: []\n---\n`);
        const result = applyWorkspaceRoleLocalization(workspace, {
          schema_version: WORKSPACE_ROLE_LOCALIZATION_PLAN_SCHEMA,
          run_id: "run-role-tier", adopted_at: "2026-08-10T12:00:00Z", authorized_by: "cap-loc-D10",
          items: [{ id: "architect", disposition: "stay", destination: { project_id: "umbrella", relative_path: ".guild/agents/architect.md" }, manifest_project_id: "umbrella", source: { mode: "template_origin" }, detail: "umbrella carrier", label: "umbrella product-work carrier" }],
        });
        if (result.status !== "applied") throw new Error(`localization refused: ${result.detail}`);
        return result.roles[0]!.specialist_type.default_model_tier;
      } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
    };
    expect(tierFor("opus")).toBe("powerful");
    expect(tierFor("claude-sonnet-4-6")).toBe("mid");
    expect(tierFor("haiku")).toBe("cheap");
    expect(tierFor("gpt-5.5")).toBe("mid");
    expect(tierForModel("gpt-5.5")).toBeNull();
  });
});
