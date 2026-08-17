import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { checkWorkspaceRosterScopes } from "../lib/roster";

const SCRIPT = path.resolve(__dirname, "../roster-resolve.ts");

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-workspace-roster-"));
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".guild", "workspace.json"),
    JSON.stringify({ schema_version: "guild.workspace.v1", sub_guilds: [{ name: "website", path: "website" }] })
  );
  return root;
}

function writeAgent(root: string, project: string, name: string, extra = ""): void {
  const dir = project === "umbrella"
    ? path.join(root, ".guild", "agents")
    : path.join(root, project, ".guild", "agents");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.md`), `---\nname: ${name}\n${extra}---\n# ${name}\n`);
}

describe("workspace duplicate-roster scope contract", () => {
  it("passes reciprocal workspace/project variants", () => {
    const root = fixture();
    writeAgent(root, "umbrella", "website-content-orchestrator", "scope: workspace\ncounterpart: website\n");
    writeAgent(root, "website", "website-content-orchestrator", "scope: project\ncounterpart: umbrella\n");
    const result = checkWorkspaceRosterScopes(root);
    expect(result.pass).toBe(true);
    expect(result.duplicate_names).toEqual(["website-content-orchestrator"]);
  });

  it("fails when either duplicate lacks scope or counterpart", () => {
    const root = fixture();
    writeAgent(root, "umbrella", "product-voice-steward", "scope: workspace\n");
    writeAgent(root, "website", "product-voice-steward");
    const result = checkWorkspaceRosterScopes(root);
    expect(result.pass).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "DUPLICATE_COUNTERPART_MISSING",
      "DUPLICATE_SCOPE_MISSING",
    ]));
  });

  it("rejects a third home instead of guessing a counterpart", () => {
    const root = fixture();
    const manifestPath = path.join(root, ".guild", "workspace.json");
    fs.writeFileSync(manifestPath, JSON.stringify({
      schema_version: "guild.workspace.v1",
      sub_guilds: [{ name: "website", path: "website" }, { name: "benchmark", path: "benchmark" }],
    }));
    writeAgent(root, "umbrella", "diagram-motion-designer", "scope: workspace\ncounterpart: website\n");
    writeAgent(root, "website", "diagram-motion-designer", "scope: project\ncounterpart: umbrella\n");
    writeAgent(root, "benchmark", "diagram-motion-designer", "scope: project\ncounterpart: umbrella\n");
    const result = checkWorkspaceRosterScopes(root);
    expect(result.issues.filter((issue) => issue.code === "DUPLICATE_MULTIPLE_HOMES")).toHaveLength(3);
  });

  it("exposes a fail-closed CLI", () => {
    const root = fixture();
    writeAgent(root, "umbrella", "site-validation-reviewer");
    writeAgent(root, "website", "site-validation-reviewer");
    const run = spawnSync("npx", ["tsx", SCRIPT, "--check-workspace-scopes", "--cwd", root], {
      encoding: "utf8",
      timeout: 120_000,
    });
    expect(run.status).toBe(2);
    expect(JSON.parse(run.stdout).pass).toBe(false);
  });
});
