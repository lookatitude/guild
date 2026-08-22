import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

/**
 * Materialize the exact committed native Claude package a launcher test needs.
 * The production resolver intentionally refuses this repository's developer
 * checkout because ignored executable dependencies are not part of its
 * committed native-package identity. Dependencies are supplied through the
 * test process NODE_PATH and never copied into the verified package tree.
 */
export function createExactClaudePluginFixture(): string {
  const pluginRoot = path.resolve(__dirname, "../../..");
  const dependencyRoot = path.join(pluginRoot, "scripts", "node_modules");
  const inheritedNodePath = process.env["NODE_PATH"]?.trim();
  process.env["NODE_PATH"] = inheritedNodePath
    ? `${dependencyRoot}${path.delimiter}${inheritedNodePath}`
    : dependencyRoot;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-exact-claude-plugin-"));
  const archive = execFileSync("git", ["-C", pluginRoot, "archive", "--format=tar", "HEAD"], {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
  });
  const extracted = spawnSync("tar", ["-xf", "-", "-C", root], {
    input: archive,
    encoding: "utf8",
  });
  if (extracted.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`could not materialize exact Claude package fixture: ${extracted.stderr}`);
  }
  return root;
}
