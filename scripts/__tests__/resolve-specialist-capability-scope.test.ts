import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SCRIPT = path.resolve(__dirname, "../resolve-specialist-capability-scope.ts");
const TSX = path.resolve(__dirname, "../node_modules/.bin/tsx");

function fixture(teamBody: string): { root: string; team: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scope-resolver-"));
  const team = path.join(root, ".guild", "team", "example.build.yaml");
  fs.mkdirSync(path.dirname(team), { recursive: true });
  fs.writeFileSync(team, `backend: subagent\nspecialists:\n${teamBody}`, "utf8");
  return { root, team };
}

function digest(file: string): string {
  return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function run(
  root: string,
  team: string,
  role: string,
  taskId: string,
  teamSha256: string = digest(team),
) {
  return spawnSync(
    TSX,
    [
      SCRIPT,
      "--team", team,
      "--team-sha256", teamSha256,
      "--cwd", root,
      "--run-id", "run-20260819-scope",
      "--task-id", taskId,
      "--role", role,
    ],
    { encoding: "utf8" },
  );
}

describe("resolve-specialist-capability-scope CLI", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("materializes an omitted canonical SEO scope on the real direct-subagent path", () => {
    const { root, team } = fixture("  - name: seo\n    scope: optimize supplied exports\n");
    roots.push(root);
    const result = run(root, team, "seo", "T1-seo");
    expect(result.status).toBe(0);
    const resolved = JSON.parse(result.stdout);
    expect(resolved.capability_scope).toEqual(["Read", "Write", "Edit", "Glob", "Grep"]);
    expect(JSON.parse(resolved.env.GUILD_CAPABILITY_SCOPE)).not.toContain("WebSearch");
    expect(resolved.scope_path).toBeNull();
    expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
  });

  it("keeps researcher as the sole omitted-scope native-web default", () => {
    const { root, team } = fixture("  - name: researcher\n    scope: gather sources\n");
    roots.push(root);
    const result = run(root, team, "researcher", "T2-research");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).capability_scope).toEqual([
      "Read", "Glob", "Grep", "WebSearch", "WebFetch",
    ]);
  });

  it("preserves an approval-bound explicit non-researcher exception", () => {
    const { root, team } = fixture(
      "  - name: seo\n    scope: approved fresh search\n    capability_scope: [Read, WebSearch]\n",
    );
    roots.push(root);
    const result = run(root, team, "seo", "T3-seo-approved");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).capability_scope).toEqual(["Read", "WebSearch"]);
  });

  it("refuses unsafe task identifiers before producing scope env", () => {
    const { root, team } = fixture("  - name: seo\n    scope: optimize supplied exports\n");
    roots.push(root);
    const result = run(root, team, "seo", "../escape");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("task-id must be a safe path segment");
    expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
  });

  it("refuses team bytes changed after the launcher emitted its approval-bound digest", () => {
    const { root, team } = fixture("  - name: seo\n    scope: supplied exports\n");
    roots.push(root);
    const approvedDigest = digest(team);
    fs.writeFileSync(
      team,
      "backend: subagent\nspecialists:\n  - name: seo\n    scope: changed\n    capability_scope: [Read, WebSearch]\n",
      "utf8",
    );
    const result = run(root, team, "seo", "T4-seo", approvedDigest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("team bytes changed after the launcher approval check");
    expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
  });

  it("refuses an out-of-root substituted team file even when its digest matches", () => {
    const { root } = fixture("  - name: seo\n    scope: supplied exports\n");
    roots.push(root);
    const substituted = path.join(root, "substituted-team.yaml");
    fs.writeFileSync(
      substituted,
      "backend: subagent\nspecialists:\n  - name: seo\n    scope: changed\n    capability_scope: [Read, WebSearch]\n",
      "utf8",
    );
    const result = run(root, substituted, "seo", "T5-seo");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("team path is not a physical regular file under .guild/team");
    expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
  });

  it("refuses a symlinked .guild/team root even when the outside digest matches", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scope-team-root-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scope-outside-team-"));
    roots.push(root, outside);
    fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
    const team = path.join(outside, "example.build.yaml");
    fs.writeFileSync(
      team,
      "backend: subagent\nspecialists:\n  - name: seo\n    scope: supplied exports\n",
      "utf8",
    );
    fs.symlinkSync(outside, path.join(root, ".guild", "team"), "dir");
    const result = run(root, path.join(root, ".guild", "team", path.basename(team)), "seo", "T6-seo");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("team path is not a physical regular file under .guild/team");
    expect(fs.existsSync(path.join(root, ".guild", "runs"))).toBe(false);
  });

  it("does not touch a symlinked scope ancestor because the direct Agent rung is env-only", () => {
    const { root, team } = fixture("  - name: seo\n    scope: supplied exports\n");
    roots.push(root);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scope-outside-"));
    roots.push(outside);
    const runDir = path.join(root, ".guild", "runs", "run-20260819-scope");
    fs.mkdirSync(runDir, { recursive: true });
    fs.symlinkSync(outside, path.join(runDir, "scope"), "dir");
    const result = run(root, team, "seo", "T6-seo");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).scope_path).toBeNull();
    expect(fs.existsSync(path.join(outside, "T6-seo.json"))).toBe(false);
  });
});
