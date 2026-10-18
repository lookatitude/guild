/**
 * G05 R2 — R-DECL gates every machinery-agent surface manifest (team-lead,
 * context-manager, developer, advisor), and planted drift in any of them
 * turns the rail RED. Drift is planted in a temp copy of the repo surfaces,
 * so the shipped files stay untouched.
 */

import { describe, test, expect, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EXEMPLARS, run } from "../../tests/rearch/r-decl";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const TEMP: string[] = [];
afterAll(() => {
  for (const d of TEMP) fs.rmSync(d, { recursive: true, force: true });
});

const manifestAgents = fs
  .readdirSync(path.join(PLUGIN_ROOT, "agents"))
  .filter((f) => f.endsWith(".md"))
  .filter((f) => fs.readFileSync(path.join(PLUGIN_ROOT, "agents", f), "utf8").split("\n").some((line) => line.trimEnd() === "surface_manifest:"))
  .map((f) => `agents/${f}`)
  .sort();

/** Copy every exemplar into a temp root, applying `mutate` to one file. */
function rootWith(target: string, mutate: (s: string) => string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r-decl-"));
  TEMP.push(root);
  for (const rel of EXEMPLARS) {
    const src = fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), rel === target ? mutate(src) : src);
  }
  return root;
}

describe("G05 R2 — R-DECL covers the machinery-agent manifests", () => {
  test("every agents/*.md carrying a surface_manifest is an R-DECL exemplar", () => {
    expect(manifestAgents).toEqual(["agents/advisor.md", "agents/context-manager.md", "agents/developer.md", "agents/team-lead.md"]);
    for (const rel of manifestAgents) expect(EXEMPLARS).toContain(rel);
  });

  test("the shipped exemplars are GREEN", () => {
    const r = run();
    expect(r.violations).toEqual([]);
    expect(r.pass).toBe(true);
  });

  test("anti-vacuity: an unmodified temp copy is GREEN", () => {
    expect(run(rootWith("agents/team-lead.md", (s) => s)).pass).toBe(true);
  });

  for (const rel of ["agents/team-lead.md", "agents/context-manager.md", "agents/developer.md"]) {
    test(`planted tier drift in ${rel} turns R-DECL RED`, () => {
      const r = run(rootWith(rel, (s) => s.replace(/^(  type: )\S+$/m, "$1cheap")));
      expect(r.pass).toBe(false);
      expect(r.violations.some((v) => v.startsWith(`[${rel}]`))).toBe(true);
    });

    test(`planted description drift in ${rel} turns R-DECL RED`, () => {
      const r = run(rootWith(rel, (s) => s.replace(/^(  description: )(.*)$/m, '$1"drifted description"')));
      expect(r.pass).toBe(false);
      expect(r.violations.some((v) => v.startsWith(`[${rel}]`) && v.includes("description"))).toBe(true);
    });
  }

  test("a manifest-carrying agent left out of EXEMPLARS turns R-DECL RED", () => {
    const root = rootWith("agents/team-lead.md", (s) => s);
    fs.writeFileSync(
      path.join(root, "agents", "rogue.md"),
      "---\nname: rogue\nmodel: opus\nsurface_manifest:\n  schema_version: guild.surface_manifest.v1\n  kind: agent\n  name: rogue\n---\n# rogue\n",
    );
    const r = run(root);
    expect(r.pass).toBe(false);
    expect(r.violations.some((v) => v.includes("agents/rogue.md"))).toBe(true);
  });
});
