import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PLUGIN_ROOT_MARKER,
  resolveValidatedPluginRoot,
} from "./plugin-root";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-root-"));
}

function makePluginRoot(dir: string): string {
  fs.mkdirSync(path.join(dir, path.dirname(PLUGIN_ROOT_MARKER)), { recursive: true });
  fs.writeFileSync(path.join(dir, PLUGIN_ROOT_MARKER), "");
  return dir;
}

describe("resolveValidatedPluginRoot", () => {
  it("ignores an env root that is not a plugin root and walks up from fromDir", () => {
    const wrong = tmp();
    const real = makePluginRoot(tmp());
    const from = path.join(real, "hooks", "dist");
    fs.mkdirSync(from, { recursive: true });
    expect(resolveValidatedPluginRoot(from, { CLAUDE_PLUGIN_ROOT: wrong })).toBe(real);
  });

  it("accepts a valid env root, preferring GUILD_PLUGIN_ROOT", () => {
    const a = makePluginRoot(tmp());
    const b = makePluginRoot(tmp());
    expect(resolveValidatedPluginRoot(tmp(), { GUILD_PLUGIN_ROOT: a, CLAUDE_PLUGIN_ROOT: b })).toBe(a);
  });

  it("returns null instead of throwing when nothing resolves", () => {
    expect(resolveValidatedPluginRoot(tmp(), { CLAUDE_PLUGIN_ROOT: tmp() })).toBeNull();
  });
});
