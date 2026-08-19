import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface DefinitionArtifactLocator {
  relative_path: string;
  content_hash: string;
  source_commit: string | null;
  skills: readonly { id: string; relative_path: string; content_hash: string }[];
}

export type DefinitionArtifactResolution =
  | { status: "resolved"; definition: Buffer; skills: ReadonlyMap<string, Buffer> }
  | { status: "invalid_request" | "capability_absent"; detail: string };

function digest(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readContainedRegularFile(root: string, relativePath: string): Buffer {
  if (!relativePath || isAbsolute(relativePath)) throw new Error("path must be project-root-relative");
  const parts = relativePath.split(/[\\/]/);
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error("path contains a traversal or empty segment");
  const rootReal = realpathSync(root);
  let cursor = rootReal;
  for (const part of parts) {
    cursor = resolve(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("symlinked definition artifacts are refused");
  }
  const real = realpathSync(cursor);
  const rel = relative(rootReal, real);
  if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("path escapes the project root");
  const stat = lstatSync(real);
  if (!stat.isFile()) throw new Error("artifact is not a regular file");
  return readFileSync(real);
}

function commitBytes(root: string, commit: string, relativePath: string): Buffer {
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) throw new Error("source_commit is not a git object id");
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Resolve and verify definition/skill bytes without deciding which role should run. */
export function resolveDefinitionArtifact(
  root: string,
  locator: DefinitionArtifactLocator
): DefinitionArtifactResolution {
  try {
    if (!locator || typeof locator !== "object" || !Array.isArray(locator.skills)) throw new Error("invalid artifact locator");
    const definition = readContainedRegularFile(root, locator.relative_path);
    if (digest(definition) !== locator.content_hash) throw new Error("definition content hash mismatch");
    if (locator.source_commit !== null) {
      if (!commitBytes(root, locator.source_commit, locator.relative_path).equals(definition)) throw new Error("definition differs from source_commit blob");
    }
    const skills = new Map<string, Buffer>();
    for (const skill of locator.skills) {
      if (!skill || typeof skill.id !== "string" || skills.has(skill.id)) throw new Error("invalid or duplicate skill locator");
      const bytes = readContainedRegularFile(root, skill.relative_path);
      if (digest(bytes) !== skill.content_hash) throw new Error(`skill ${skill.id} content hash mismatch`);
      if (locator.source_commit !== null && !commitBytes(root, locator.source_commit, skill.relative_path).equals(bytes)) {
        throw new Error(`skill ${skill.id} differs from source_commit blob`);
      }
      skills.set(skill.id, bytes);
    }
    return { status: "resolved", definition, skills };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const absent = /ENOENT|does not exist|exists on disk, but not in/i.test(detail);
    return { status: absent ? "capability_absent" : "invalid_request", detail };
  }
}
