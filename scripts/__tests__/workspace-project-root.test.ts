import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveWorkspaceProjectRoot } from "../lib/workspace-project-root";

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-workspace-root-"));
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "website", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "workspace.json"), JSON.stringify({
    schema_version: "guild.workspace.v1",
    sub_guilds: [{ name: "plugin", path: "plugin" }, { name: "website", path: "website" }],
  }));
  return root;
}

describe("workspace project-root resolution", () => {
  it("resolves umbrella and an immediate child from a nested start", () => {
    const root = fixture();
    const realRoot = fs.realpathSync(root);
    expect(resolveWorkspaceProjectRoot(path.join(root, "website", "nested"), "umbrella")).toEqual({
      status: "resolved", root: realRoot, workspace_root: realRoot,
    });
    expect(resolveWorkspaceProjectRoot(path.join(root, "website", "nested"), "plugin")).toEqual({
      status: "resolved", root: path.join(realRoot, "plugin"), workspace_root: realRoot,
    });
  });

  it("fails closed for unknown and escaping child paths", () => {
    const root = fixture();
    expect(resolveWorkspaceProjectRoot(root, "missing").status).toBe("capability_absent");
    fs.writeFileSync(path.join(root, ".guild", "workspace.json"), JSON.stringify({
      schema_version: "guild.workspace.v1", sub_guilds: [{ name: "plugin", path: "../outside" }],
    }));
    expect(resolveWorkspaceProjectRoot(root, "plugin").status).toBe("invalid_request");
  });

  it("fails closed when an intermediate symlink resolves a declared child outside the workspace", () => {
    const root = fixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-workspace-outside-"));
    fs.mkdirSync(path.join(outside, "escaped"));
    fs.symlinkSync(outside, path.join(root, "projects"));
    fs.writeFileSync(path.join(root, ".guild", "workspace.json"), JSON.stringify({
      schema_version: "guild.workspace.v1",
      sub_guilds: [{ name: "escaped", path: "projects/escaped" }],
    }));

    const result = resolveWorkspaceProjectRoot(root, "escaped");
    expect(result.status).toBe("invalid_request");
    expect(result).toEqual(expect.objectContaining({ detail: expect.stringMatching(/project root escapes workspace/) }));
  });
});
