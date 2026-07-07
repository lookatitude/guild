/**
 * scripts/__tests__/ideation-min-build-cli.test.ts
 *
 * The skill-invocable surface that wires the (pure) ideation-min-build resolver
 * into /guild:ideate: detects init-wiki absence on disk and returns a stamped
 * resolver baseline, else {needsMinBuild:false}. docs/v2 03-lifecycle §"A min-build spec".
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLI = path.resolve(__dirname, "../ideation-min-build-cli.ts");

function run(cwd: string, extra: string[] = []): { code: number; out: Record<string, unknown> } {
  const r = spawnSync("npx", ["tsx", CLI, "--cwd", cwd, "--now", "2026-06-27T00:00:00Z", ...extra], {
    encoding: "utf8",
  });
  return { code: r.status ?? -1, out: JSON.parse(r.stdout.trim() || "{}") };
}

function tmpRepo(withWiki: boolean): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-imb-"));
  if (withWiki) {
    fs.mkdirSync(path.join(d, ".guild", "wiki"), { recursive: true });
    fs.writeFileSync(path.join(d, ".guild", "wiki", "index.md"), "# wiki\n");
  }
  return d;
}

describe("ideation-min-build-cli", () => {
  it("returns needsMinBuild:false when an init wiki exists", () => {
    const { code, out } = run(tmpRepo(true));
    expect(code).toBe(0);
    expect(out).toEqual({ needsMinBuild: false });
  });

  it("returns a stamped resolver baseline when no init wiki exists", () => {
    const { code, out } = run(tmpRepo(false), ["--description", "a task queue service"]);
    expect(code).toBe(0);
    expect(out.needsMinBuild).toBe(true);
    const spec = out.spec as Record<string, unknown>;
    expect(spec.grounded_in).toBe("init_minimal");
    expect(spec.goal).toBe("a task queue service");
    expect(typeof spec.gap).toBe("string");
    const fm = out.frontmatter as Record<string, unknown>;
    expect(fm).toMatchObject({ grounded_in: "init_minimal", resolver_built: true, resolved_at: "2026-06-27T00:00:00Z" });
    expect(fm.gap).toBe(spec.gap);
  });

  it("placeholders the goal when no description is supplied", () => {
    const { out } = run(tmpRepo(false));
    const spec = out.spec as Record<string, unknown>;
    expect(String(spec.goal)).toContain("PLACEHOLDER");
  });
});
