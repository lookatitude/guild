/**
 * plugin-manifest-commands: every commands/*.md must be registered in the
 * plugin.json `commands` array (MC-1, gap-run-20260611) — a shipped command
 * file missing from the manifest silently fails to register.
 */
import * as fs from "fs";
import * as path from "path";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

describe("plugin.json commands array covers commands/*.md", () => {
  it("every commands/*.md is listed", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
    );
    const listed = new Set<string>(manifest.commands ?? []);
    const files = fs
      .readdirSync(path.join(PLUGIN_ROOT, "commands"))
      .filter((f) => f.endsWith(".md"))
      .map((f) => `./commands/${f}`);
    const missing = files.filter((f) => !listed.has(f));
    expect(missing).toEqual([]);
  });

  it("no listed command points at a missing file", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
    );
    const dangling = (manifest.commands ?? []).filter(
      (c: string) => !fs.existsSync(path.join(PLUGIN_ROOT, c))
    );
    expect(dangling).toEqual([]);
  });
});
