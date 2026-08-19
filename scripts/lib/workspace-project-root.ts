import * as fs from "node:fs";
import * as path from "node:path";
import { checkContained, isRefused } from "../../src/modules/kernel/workflows/path-containment";

export type WorkspaceProjectRootResult =
  | { status: "resolved"; root: string; workspace_root: string }
  | { status: "invalid_request" | "capability_absent"; detail: string };

function nearestWorkspaceRoot(start: string): string | null {
  let cursor = fs.realpathSync(start);
  while (true) {
    const candidate = path.join(cursor, ".guild", "workspace.json");
    try {
      if (fs.lstatSync(candidate).isFile()) return cursor;
    } catch {
      // keep walking
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/** Resolve a project id from the umbrella's immediate-child workspace manifest. */
export function resolveWorkspaceProjectRoot(startRoot: string, projectId: string): WorkspaceProjectRootResult {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectId)) {
      return { status: "invalid_request", detail: "project_id is not a canonical token" };
    }
    const workspaceRoot = nearestWorkspaceRoot(path.resolve(startRoot));
    if (!workspaceRoot) return { status: "capability_absent", detail: "no enclosing .guild/workspace.json" };
    const manifestPath = path.join(workspaceRoot, ".guild", "workspace.json");
    if (fs.lstatSync(manifestPath).isSymbolicLink()) {
      return { status: "invalid_request", detail: "symlinked workspace manifest is refused" };
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      return { status: "invalid_request", detail: "workspace manifest is not an object" };
    }
    if (projectId === "umbrella") return { status: "resolved", root: workspaceRoot, workspace_root: workspaceRoot };
    const children = (manifest as Record<string, unknown>)["sub_guilds"];
    if (!Array.isArray(children)) return { status: "invalid_request", detail: "workspace sub_guilds is not an array" };
    const matches = children.filter((child) => {
      return !!child && typeof child === "object" && !Array.isArray(child) && (child as Record<string, unknown>)["name"] === projectId;
    });
    if (matches.length !== 1) return { status: "capability_absent", detail: `project_id ${projectId} does not resolve uniquely` };
    const rel = (matches[0] as Record<string, unknown>)["path"];
    const relParts = typeof rel === "string" ? rel.split(/[\\/]+/) : [];
    if (
      typeof rel !== "string" ||
      path.isAbsolute(rel) ||
      relParts.length !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(relParts[0] ?? "")
    ) {
      return { status: "invalid_request", detail: `project_id ${projectId} has an invalid path` };
    }
    const root = path.resolve(workspaceRoot, rel);
    const lexicalContainment = checkContained(workspaceRoot, root);
    if (isRefused(lexicalContainment)) {
      return { status: "invalid_request", detail: `project root escapes workspace [${lexicalContainment.code}]` };
    }
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return { status: "invalid_request", detail: "project root is not a regular directory" };
    // Lexical containment is insufficient when an intermediate component is a
    // symlink. Resolve the complete child path, then prove the resulting real
    // directory still lives under the already-canonical workspace root.
    const realRoot = fs.realpathSync(root);
    const realContainment = checkContained(workspaceRoot, realRoot);
    if (isRefused(realContainment)) {
      return { status: "invalid_request", detail: `real project root escapes workspace [${realContainment.code}]` };
    }
    return { status: "resolved", root: realRoot, workspace_root: workspaceRoot };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: /ENOENT/.test(detail) ? "capability_absent" : "invalid_request", detail };
  }
}
