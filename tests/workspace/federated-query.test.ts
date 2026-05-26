/**
 * tests/workspace/federated-query.test.ts
 *
 * Cross-cutting deliverable 3 — FEDERATED-QUERY FAN-OUT (SC-4, spec §3).
 *
 * Drives scripts/workspace/federated-query.ts END-TO-END as a subprocess against
 * a manifest produced by write-manifest.ts (so the two scripts are exercised as
 * an integrated pipeline, not in isolation). Asserts:
 *   - one query step per has_wiki sub_guild (sub_guilds without a wiki are skipped)
 *   - each query step carries a per-sub cwd (absolute path to that sub-guild dir)
 *   - each query step is tagged with sub_guild.name
 *   - the query string propagates verbatim to every step
 *   - a terminal merge_and_tag step is always appended
 *   - --scope <name> narrows the fan-out to exactly one sub-guild
 *   - --scope on a non-wiki / unknown sub-guild yields 0 query steps (+ warn)
 *   - tool is wiki_search (the read-only guild-memory recall verb)
 *
 * Pipeline: write-manifest.ts → federated-query.ts (real manifest, no fixtures by hand).
 */

import * as path from "path";
import {
  WRITE_MANIFEST,
  FEDERATED_QUERY,
  runScript,
  parseJsonStdout,
  makeTempRoot,
  rmTree,
  plantSubGuild,
  plantSubProject,
} from "./_fixtures";

interface QueryStep {
  type: "query";
  sub_guild: string;
  tool: string;
  cwd: string;
  query: string;
}
interface MergeStep {
  type: "merge_and_tag";
  description: string;
}
interface FanOutPlan {
  query: string;
  steps: Array<QueryStep | MergeStep>;
}

function buildManifest(root: string): void {
  const res = runScript(WRITE_MANIFEST, ["--cwd", root]);
  expect(res.exitCode).toBe(0);
}

function fanOut(root: string, query: string, scope?: string): { plan: FanOutPlan; stderr: string; exitCode: number } {
  const args = ["--cwd", root, "--query", query];
  if (scope) args.push("--scope", scope);
  const res = runScript(FEDERATED_QUERY, args);
  const plan = parseJsonStdout<FanOutPlan>(res, "federated-query.ts");
  return { plan, stderr: res.stderr, exitCode: res.exitCode };
}

const querySteps = (plan: FanOutPlan): QueryStep[] =>
  plan.steps.filter((s): s is QueryStep => s.type === "query");

const mergeSteps = (plan: FanOutPlan): MergeStep[] =>
  plan.steps.filter((s): s is MergeStep => s.type === "merge_and_tag");

describe("federated query fan-out (e2e: write-manifest → federated-query)", () => {
  let root: string;
  afterEach(() => {
    if (root) rmTree(root);
  });

  test("one query step per has_wiki sub_guild; non-wiki subs are skipped", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true }); // has_wiki
    plantSubGuild(root, "tools", { wiki: true }); // has_wiki
    plantSubGuild(root, "skeleton", { wiki: false }); // .guild but NO wiki
    plantSubProject(root, "svc-api"); // .git only, no .guild → no wiki
    buildManifest(root);

    const { plan } = fanOut(root, "auth flow");
    const qs = querySteps(plan);
    expect(qs.map((s) => s.sub_guild).sort()).toEqual(["plugin", "tools"]);
    // skeleton (no wiki) and svc-api (no wiki) excluded
    expect(qs.map((s) => s.sub_guild)).not.toContain("skeleton");
    expect(qs.map((s) => s.sub_guild)).not.toContain("svc-api");
  });

  test("each query step carries a per-sub absolute cwd pointing at its sub dir", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    buildManifest(root);

    const { plan } = fanOut(root, "data layer");
    for (const step of querySteps(plan)) {
      expect(path.isAbsolute(step.cwd)).toBe(true);
      // cwd resolves to <root>/<sub_guild>
      expect(path.resolve(step.cwd)).toBe(path.resolve(root, step.sub_guild));
    }
  });

  test("each query step is tagged with sub_guild.name and uses wiki_search", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    buildManifest(root);

    const { plan } = fanOut(root, "release discipline");
    const qs = querySteps(plan);
    expect(qs).toHaveLength(1);
    expect(qs[0].sub_guild).toBe("plugin");
    expect(qs[0].tool).toBe("wiki_search");
  });

  test("the query string propagates verbatim to plan + every query step", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    buildManifest(root);

    const Q = "how does the evolve loop gate promotions?";
    const { plan } = fanOut(root, Q);
    expect(plan.query).toBe(Q);
    for (const step of querySteps(plan)) {
      expect(step.query).toBe(Q);
    }
  });

  test("a terminal merge_and_tag step is always appended", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    buildManifest(root);

    const { plan } = fanOut(root, "x");
    const merges = mergeSteps(plan);
    expect(merges).toHaveLength(1);
    // it is the LAST step
    expect(plan.steps[plan.steps.length - 1].type).toBe("merge_and_tag");
    expect(merges[0].description.toLowerCase()).toContain("tag");
  });

  test("--scope narrows fan-out to exactly one named sub-guild", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "tools", { wiki: true });
    plantSubGuild(root, "docs-site", { wiki: true });
    buildManifest(root);

    const { plan } = fanOut(root, "q", "tools");
    const qs = querySteps(plan);
    expect(qs).toHaveLength(1);
    expect(qs[0].sub_guild).toBe("tools");
    // merge step still appended
    expect(mergeSteps(plan)).toHaveLength(1);
  });

  test("--scope on an unknown sub-guild yields 0 query steps + a warning", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    buildManifest(root);

    const { plan, stderr, exitCode } = fanOut(root, "q", "does-not-exist");
    expect(exitCode).toBe(0); // scope-miss is a warning, not a hard error
    expect(querySteps(plan)).toHaveLength(0);
    expect(stderr.toLowerCase()).toContain("does-not-exist");
    // merge step is still present so the skill layer knows the (empty) shape
    expect(mergeSteps(plan)).toHaveLength(1);
  });

  test("--scope targeting a sub-guild with no wiki yields 0 query steps", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    plantSubGuild(root, "skeleton", { wiki: false }); // no wiki
    buildManifest(root);

    const { plan } = fanOut(root, "q", "skeleton");
    expect(querySteps(plan)).toHaveLength(0);
  });

  test("zero has_wiki sub-guilds: 0 query steps, merge step present, exit 0", () => {
    root = makeTempRoot();
    plantSubGuild(root, "skeleton-a", { wiki: false });
    plantSubProject(root, "svc-api");
    buildManifest(root);

    const { plan, exitCode, stderr } = fanOut(root, "q");
    expect(exitCode).toBe(0);
    expect(querySteps(plan)).toHaveLength(0);
    expect(mergeSteps(plan)).toHaveLength(1);
    expect(stderr.toLowerCase()).toContain("no sub_guilds");
  });

  test("missing --query is a hard error (exit 1)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    buildManifest(root);
    const res = runScript(FEDERATED_QUERY, ["--cwd", root]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("query");
  });

  test("missing workspace.json is a hard error (exit 1)", () => {
    root = makeTempRoot();
    plantSubGuild(root, "plugin", { wiki: true });
    // intentionally do NOT build the manifest
    const res = runScript(FEDERATED_QUERY, ["--cwd", root, "--query", "q"]);
    expect(res.exitCode).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("workspace.json");
  });
});
