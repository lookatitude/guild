import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { parseYaml } from "./frontmatter";
import { guildRootId } from "./storage-roots";

export class StackError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export const stackHash = (bytes: string | Buffer) =>
  "sha256:" + createHash("sha256").update(bytes).digest("hex");
export function stackId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
  )
    throw new StackError("invalid_id", "Invalid source or entity identity");
  return value;
}
export function stackContained(
  root: string,
  relative: string,
  missing = false,
): string {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    /[\\%\x00-\x1f]/.test(relative) ||
    relative.split("/").some((x) => !x || x === "." || x === "..")
  )
    throw new StackError("path_refused", "Invalid relative record path", 403);
  const target = path.join(root, ...relative.split("/"));
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const st = fs.lstatSync(current);
      if (st.isSymbolicLink())
        throw new StackError(
          "path_refused",
          "Linked record path is not permitted",
          403,
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && missing) break;
      throw error;
    }
  }
  const ancestor = (() => {
    let p = target;
    while (!fs.existsSync(p)) p = path.dirname(p);
    return fs.realpathSync(p);
  })();
  const rel = path.relative(fs.realpathSync(root), ancestor);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new StackError("path_refused", "Record escaped owning root", 403);
  return target;
}
export function stackRead(
  root: string,
  relative: string,
  optional = false,
): string | null {
  try {
    const p = stackContained(root, relative);
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 1024 * 1024)
      throw new StackError(
        "record_too_large",
        "Record is not a bounded regular file",
        413,
      );
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    if (optional && (e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export interface StackSource {
  source_id: string;
  root_id: string;
  kind: "workspace" | "project";
  realpath: string;
  layout_version: number;
  revision: string;
  health: "healthy" | "unavailable" | "unsupported";
  read_only_reason: string | null;
}
export class StackScope {
  readonly root: string;
  constructor(root: string) {
    if (!path.isAbsolute(root))
      throw new StackError(
        "invalid_root",
        "An absolute Guild root is required",
      );
    this.root = fs.realpathSync(root);
  }
  source(root: string): StackSource {
    const manifest = stackRead(root, ".guild/guild.yaml")!;
    const doc = parseYaml(manifest) as any;
    if (
      !doc ||
      doc.schema_version !== "guild.root.v1" ||
      !["workspace", "project"].includes(doc.kind)
    )
      throw new StackError(
        "invalid_root",
        "Missing or malformed Guild root manifest",
        422,
      );
    const marker = stackRead(root, ".guild/storage-layout.json", true);
    let version = 1;
    if (marker) {
      let parsed: any;
      try {
        parsed = JSON.parse(marker);
      } catch {
        throw new StackError(
          "invalid_layout",
          "Malformed storage layout marker",
          422,
        );
      }
      version = parsed.storage_layout_version;
      if (!Number.isInteger(version) || version < 1 || version > 2)
        throw new StackError(
          "unsupported_layout",
          "Unsupported storage layout version",
          422,
        );
    }
    const workspace =
      doc.kind === "workspace"
        ? stackRead(root, ".guild/workspace.json")
        : null;
    return {
      source_id: "source:" + guildRootId(root),
      root_id: guildRootId(root),
      kind: doc.kind,
      realpath: root,
      layout_version: version,
      revision: stackHash(
        manifest + "\n" + (marker ?? "") + "\n" + (workspace ?? ""),
      ),
      health: "healthy",
      read_only_reason:
        version < 2
          ? "Layout activation is required before management writes"
          : null,
    };
  }
  discover(): { root: StackSource; children: StackSource[] } {
    const root = this.source(this.root);
    const children: StackSource[] = [];
    if (root.kind === "workspace") {
      let doc: any;
      try {
        doc = JSON.parse(stackRead(this.root, ".guild/workspace.json")!);
      } catch {
        throw new StackError(
          "invalid_workspace",
          "Malformed workspace descriptor",
          422,
        );
      }
      if (
        doc.schema_version !== "guild.workspace.v1" ||
        doc.is_workspace !== true ||
        !Array.isArray(doc.sub_guilds)
      )
        throw new StackError(
          "invalid_workspace",
          "Workspace descriptor is unsupported",
          422,
        );
      const used = new Set([this.root]);
      for (const child of doc.sub_guilds) {
        if (
          !child ||
          typeof child.name !== "string" ||
          typeof child.path !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(child.path)
        )
          throw new StackError(
            "invalid_workspace",
            "Workspace children must be immediate registered projects",
            422,
          );
        const candidate = path.join(this.root, child.path);
        try {
          const st = fs.lstatSync(candidate);
          if (st.isSymbolicLink() || !st.isDirectory())
            throw new StackError(
              "path_refused",
              "Workspace child is not a physical project directory",
              403,
            );
          const physical = fs.realpathSync(candidate);
          if (path.dirname(physical) !== this.root || used.has(physical))
            throw new StackError(
              "invalid_workspace",
              "Duplicate or escaping workspace child",
              422,
            );
          used.add(physical);
          const source = this.source(physical);
          if (source.kind !== "project")
            throw new StackError(
              "invalid_workspace",
              "Nested workspaces are not supported",
              422,
            );
          children.push(source);
        } catch (error) {
          if (
            error instanceof StackError &&
            ["invalid_workspace", "path_refused"].includes(error.code)
          )
            throw error;
          children.push({
            source_id: "source:" + guildRootId(candidate),
            root_id: guildRootId(candidate),
            kind: "project",
            realpath: candidate,
            layout_version: 1,
            revision: stackHash("unavailable:" + child.path),
            health: "unavailable",
            read_only_reason:
              "Registered project is unavailable or has an invalid layout",
          });
        }
      }
    }
    return { root, children };
  }
}
