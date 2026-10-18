/**
 * learn-route.test.ts — the bare `/guild:learn` router (G10 R1-R2).
 *
 * Every target shape the learn skill documents maps to exactly one route, every
 * sub-verb maps to its chapter, and an unknown token maps to usage. The planted
 * control swaps the brownfield mapping and proves the oracle notices.
 */

import { describe, it, expect } from "bun:test";

import {
  LEARN_CHAPTERS,
  LEARN_ROUTES,
  LEARN_SUB_VERBS,
  LearnRouteError,
  classifyLearnTarget,
  learnRouteFor,
  routeLearn,
  type LearnTargetFacts,
  type LearnTargetKind,
  type LearnRouteResult,
  type LearnRouteInput,
} from ".";

type Router = (input: LearnRouteInput) => LearnRouteResult;

type Child = LearnTargetFacts["detection"]["sub_guilds"][number];

function child(name: string, kind: Child["kind"]): Child {
  return { name, path: name, kind, remote: null, has_wiki: false, has_indexes: false, last_seen_commit: null };
}

function facts(over: Partial<LearnTargetFacts> = {}): LearnTargetFacts {
  return {
    detection: { kind: "regular", sub_guilds: [] },
    has_git: true,
    guild_dir: "populated",
    wiki_populated: false,
    tracked_files: 120,
    ...over,
  };
}

const BROWNFIELD = facts();
const EXISTING_GUILD = facts({ wiki_populated: true });
const GREENFIELD_EMPTY = facts({ has_git: false, guild_dir: "absent", tracked_files: 0 });
const SPARSE_GIT = facts({ guild_dir: "empty", tracked_files: 5 });
const WORKSPACE = facts({
  detection: { kind: "workspace", sub_guilds: [child("a", "sub-guild"), child("b", "sub-guild")] },
});
const MIXED = facts({
  detection: { kind: "workspace", sub_guilds: [child("a", "sub-guild"), child("b", "sub-project")] },
});
const PLAIN_DIR = facts({ has_git: false, guild_dir: "absent", tracked_files: 40 });

describe("classifyLearnTarget — the five documented shapes", () => {
  const cases: Array<[string, LearnTargetFacts, LearnTargetKind]> = [
    ["brownfield git repo with .guild/", BROWNFIELD, "regular_project"],
    ["brownfield git repo with no .guild/", facts({ guild_dir: "absent" }), "regular_project"],
    ["populated .guild/wiki/", EXISTING_GUILD, "existing_guild_project"],
    ["greenfield empty dir", GREENFIELD_EMPTY, "new_or_sparse_project"],
    ["sparse git repo, empty .guild/, 5 files", SPARSE_GIT, "new_or_sparse_project"],
    ["workspace, uniform children", WORKSPACE, "workspace"],
    ["workspace mode=on, no children", facts({ detection: { kind: "workspace", sub_guilds: [] } }), "workspace"],
    ["children mix .git-only and .guild/", MIXED, "mixed_or_uncertain"],
    ["no .git/, no .guild/, many files", PLAIN_DIR, "mixed_or_uncertain"],
  ];
  for (const [name, f, kind] of cases) {
    it(`${name} -> ${kind}`, () => {
      expect(classifyLearnTarget(f)).toBe(kind);
    });
  }

  it("6 tracked files is no longer sparse", () => {
    expect(classifyLearnTarget(facts({ guild_dir: "empty", tracked_files: 6 }))).toBe("regular_project");
  });
});

describe("routeLearn — bare /guild:learn", () => {
  it("brownfield -> full learn pipeline that reaches K1-K6 after the OQ1 gate", () => {
    const r = routeLearn({ argv: [], target: BROWNFIELD });
    expect(r.route).toBe("full_learn");
    expect(r.target_kind).toBe("regular_project");
    expect(r.knowledge_tier).toBe("after_oq1_gate");
    expect(r.chapter).toBeNull();
  });

  it("existing Guild project -> full learn pipeline", () => {
    const r = routeLearn({ argv: [], target: EXISTING_GUILD });
    expect(r.route).toBe("full_learn");
    expect(r.knowledge_tier).toBe("after_oq1_gate");
  });

  it("greenfield / sparse -> cheap map only, no K1-K6", () => {
    for (const t of [GREENFIELD_EMPTY, SPARSE_GIT]) {
      const r = routeLearn({ argv: [], target: t });
      expect(r.route).toBe("cheap_map_only");
      expect(r.knowledge_tier).toBe("not_run");
    }
  });

  it("workspace, learn_fanout auto -> workspace full learn with K1-K6 deferred", () => {
    const r = routeLearn({ argv: [], target: WORKSPACE });
    expect(r.route).toBe("workspace_full_learn");
    expect(r.knowledge_tier).toBe("deferred");
  });

  it("workspace, learn_fanout plan-only -> plan only", () => {
    const r = routeLearn({ argv: [], target: WORKSPACE, learnFanout: "plan-only" });
    expect(r.route).toBe("workspace_plan_only");
    expect(r.knowledge_tier).toBe("not_run");
  });

  it("workspace, --dry-run overrides learn_fanout auto -> plan only", () => {
    const r = routeLearn({ argv: ["--dry-run"], target: WORKSPACE, learnFanout: "auto" });
    expect(r.route).toBe("workspace_plan_only");
    expect(r.dry_run).toBe(true);
  });

  it("mixed or uncertain -> ask one targeted question", () => {
    for (const t of [MIXED, PLAIN_DIR]) {
      const r = routeLearn({ argv: [], target: t });
      expect(r.route).toBe("confirm_target");
      expect(r.knowledge_tier).toBeNull();
    }
  });

  it("flags alone keep it bare and forward verbatim; --cwd is extracted", () => {
    const r = routeLearn({ argv: ["--rigor=deep", "--cwd", "/x/y", "--include-lockfiles"], target: BROWNFIELD });
    expect(r.route).toBe("full_learn");
    expect(r.cwd_override).toBe("/x/y");
    expect(r.forward).toEqual(["--rigor=deep", "--cwd", "/x/y", "--include-lockfiles"]);
  });

  for (const argv of [["--cwd"], ["--cwd="], ["--cwd", "--dry-run"], ["map", "--cwd"], ["--cwd", "", "."], ["--cwd", "", "map"]]) {
    it(`--cwd without a value is refused: ${JSON.stringify(argv)}`, () => {
      expect(() => routeLearn({ argv, target: BROWNFIELD })).toThrow(LearnRouteError);
    });
  }

  it("bare without target facts is refused, never guessed", () => {
    expect(() => routeLearn({ argv: [], target: null })).toThrow(LearnRouteError);
  });
});

describe("routeLearn — sub-verbs and unknown tokens", () => {
  it("the sub-verb set is exactly the skill's seven chapters", () => {
    expect([...LEARN_SUB_VERBS]).toEqual(["map", "graph", "knowledge", "onboard", "diff", "explain", "harvest"]);
  });

  for (const verb of LEARN_SUB_VERBS) {
    it(`${verb} -> chapter references/learn-${verb}.md, target facts not needed`, () => {
      const r = routeLearn({ argv: [verb, "src/a.ts", "--rigor=quick"], target: null });
      expect(r.route).toBe("chapter");
      expect(r.chapter).toBe(verb);
      expect(r.chapter_file).toBe(`references/learn-${verb}.md`);
      expect(r.target_kind).toBeNull();
      expect(r.forward).toEqual(["src/a.ts", "--rigor=quick"]);
    });
  }

  it("a flag before the sub-verb does not hide it", () => {
    const r = routeLearn({ argv: ["--rigor=deep", "graph"], target: null });
    expect(r.chapter).toBe("graph");
    expect(r.forward).toEqual(["--rigor=deep"]);
  });

  it("the --cwd value is never read as a sub-verb", () => {
    const r = routeLearn({ argv: ["--cwd", "map"], target: BROWNFIELD });
    expect(r.route).toBe("full_learn");
    expect(r.cwd_override).toBe("map");
  });

  for (const token of ["Map", "learn", "foo", "harvest-all"]) {
    it(`unknown token "${token}" -> usage, never a pipeline`, () => {
      const r = routeLearn({ argv: [token], target: BROWNFIELD });
      expect(r.route).toBe("usage");
      expect(r.token).toBe(token);
      expect(r.chapter).toBeNull();
      expect(r.knowledge_tier).toBeNull();
      expect(r.usage).toContain("map|graph|knowledge|onboard|diff|explain|harvest");
    });
  }
});

describe("route table — closed and anti-vacuous", () => {
  it("every target kind maps to a member of the closed route enum", () => {
    const kinds: LearnTargetKind[] = [
      "regular_project",
      "existing_guild_project",
      "new_or_sparse_project",
      "workspace",
      "mixed_or_uncertain",
    ];
    for (const k of kinds) expect(LEARN_ROUTES).toContain(learnRouteFor(k, { learnFanout: "auto", dryRun: false }));
    expect(Object.keys(LEARN_CHAPTERS).sort()).toEqual([...LEARN_SUB_VERBS].sort());
  });

  it("CONTROL: a planted wrong mapping fails the same oracle the real router passes", () => {
    expect(mappingFailures(routeLearn)).toEqual([]);
    const brownfieldToMap: Router = (input) => {
      const real = routeLearn(input);
      return real.target_kind === "regular_project" ? { ...real, route: "cheap_map_only", knowledge_tier: "not_run" } : real;
    };
    const mapToGraph: Router = (input) => {
      const real = routeLearn(input);
      return real.chapter === "map" ? { ...real, chapter: "graph", chapter_file: "references/learn-graph.md" } : real;
    };
    const unknownToPipeline: Router = (input) => {
      const real = routeLearn(input);
      return real.route === "usage" ? routeLearn({ ...input, argv: [] }) : real;
    };
    expect(mappingFailures(brownfieldToMap)).toContain("brownfield");
    expect(mappingFailures(mapToGraph)).toContain("map");
    expect(mappingFailures(unknownToPipeline)).toContain("unknown");
  });
});

/** The documented mapping, as an oracle over any router. Returns the failed case names. */
function mappingFailures(route: Router): string[] {
  const failed: string[] = [];
  const b = route({ argv: [], target: BROWNFIELD });
  if (b.route !== "full_learn" || b.knowledge_tier !== "after_oq1_gate") failed.push("brownfield");
  if (route({ argv: [], target: GREENFIELD_EMPTY }).route !== "cheap_map_only") failed.push("greenfield");
  if (route({ argv: [], target: WORKSPACE }).route !== "workspace_full_learn") failed.push("workspace");
  if (route({ argv: [], target: MIXED }).route !== "confirm_target") failed.push("mixed");
  for (const verb of LEARN_SUB_VERBS) {
    const r = route({ argv: [verb], target: null });
    if (r.route !== "chapter" || r.chapter !== verb || r.chapter_file !== `references/learn-${verb}.md`) failed.push(verb);
  }
  if (route({ argv: ["foo"], target: BROWNFIELD }).route !== "usage") failed.push("unknown");
  return failed;
}
