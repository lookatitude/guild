/**
 * scripts/__tests__/learn-engine.test.ts
 *
 * Smoke + unit coverage for the Guild-native codebase-understanding engine
 * (task #23). Hermetic: builds a tiny fixture repo in a temp dir so the test
 * never mutates the real repo's .guild/. Covers:
 *  - Stage 1 scan → valid codebase-map.json (`guild.codebase_map.v1`)
 *  - import-map resolution (relative + tsconfig alias)
 *  - Stage 2 partial graph (node-id invariant, source_refs)
 *  - Tolerant validate/repair ladder (alias normalize + drop + fatal)
 *  - Stages 4/5/6 (layers partition, domain+knowledge-links, BFS tour)
 *  - Staleness classifier (SKIP / STRUCTURAL)
 *  - zero runtime dependency on understand-anything (grep evidence)
 */
import { spawnSync, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const UD = path.resolve(__dirname, "../learn");

function tsx(script: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", path.join(UD, script), ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

let repo: string;

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ua-eng-"));
  fs.mkdirSync(path.join(repo, "src/services"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@svc/*": ["src/services/*"] } } }),
  );
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { express: "^4" } }),
  );
  fs.writeFileSync(
    path.join(repo, "src/index.ts"),
    `import { greet } from "./services/greeter";\nimport { log } from "@svc/logger";\nexport function main() { log(greet("x")); }\n`,
  );
  fs.writeFileSync(
    path.join(repo, "src/services/greeter.ts"),
    `export function greet(n: string) { return "hi " + n; }\nexport class Greeter { hello() { return 1; } }\n`,
  );
  fs.writeFileSync(
    path.join(repo, "src/services/logger.ts"),
    `export function log(m: string) { if (m) console.log(m); }\n`,
  );
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  } catch { /* git optional — headSha falls back to "unknown" */ }
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

test("stage 1 scan emits a valid codebase-map.json", () => {
  const r = tsx("scan.ts", ["--cwd", repo]);
  expect(r.code).toBe(0);
  const cm = JSON.parse(fs.readFileSync(path.join(repo, ".guild/indexes/codebase-map.json"), "utf8"));
  expect(cm.version).toBe("guild.codebase_map.v1");
  expect(cm.project.languages).toContain("typescript");
  expect(cm.project.frameworks).toContain("express");
  expect(cm.stats.file_count).toBeGreaterThanOrEqual(3);
  const idx = cm.files.find((f: any) => f.path === "src/index.ts");
  expect(idx).toBeTruthy();
  expect(idx.is_entrypoint).toBe(true);
  // import-map: relative + tsconfig alias both resolved
  const froms = cm.import_map.map((e: any) => `${e.from}>${e.to}:${e.kind}`);
  expect(froms).toContain("src/index.ts>src/services/greeter.ts:static");
  expect(froms).toContain("src/index.ts>src/services/logger.ts:alias");
});

test("stage 2 partial graph honors node-id + source_refs invariants", () => {
  const r = tsx("analyze-structural.ts", ["--cwd", repo, "--print"]);
  expect(r.code).toBe(0);
  const g = JSON.parse(r.out);
  expect(g.version).toBe("guild.knowledge_graph.v1");
  const greet = g.nodes.find((n: any) => n.id === "function:src/services/greeter.ts:greet");
  expect(greet).toBeTruthy();
  expect(greet.confidence).toBe("high");
  expect(greet.source_refs[0]).toMatch(/^src\/services\/greeter\.ts#L\d+-L\d+$/);
  expect(g.edges.some((e: any) => e.type === "contains" && e.target === greet.id)).toBe(true);
  expect(g.edges.some((e: any) => e.type === "imports")).toBe(true);
});

test("tolerant ladder: normalizes aliases, drops invalid, fatal on zero nodes", () => {
  const { validateGraph } = require("../learn/lib/schema");
  const ok = validateGraph({
    project: { name: "p", description: "" },
    nodes: [
      { id: "file:a.ts", type: "FILE", name: "a.ts", source_refs: ["a.ts"], confidence: "high" },
      { id: "func:a.ts:f", type: "func", name: "f" }, // alias + missing fields → fixed
      { id: "bad", type: "not_a_type", name: "x" }, // dropped
    ],
    edges: [
      { source: "file:a.ts", target: "func:a.ts:f", type: "uses", direction: "forward" }, // alias→depends_on/out
      { source: "file:a.ts", target: "ghost", type: "calls", direction: "out", weight: 1 }, // dangling→drop
    ],
  });
  expect(ok.success).toBe(true);
  const f = ok.data.nodes.find((n: any) => n.id === "func:a.ts:f");
  expect(f.type).toBe("function");
  expect(f.confidence).toBe("low");
  expect(ok.data.nodes.some((n: any) => n.id === "bad")).toBe(false);
  const e = ok.data.edges[0];
  expect(e.type).toBe("depends_on");
  expect(e.direction).toBe("out");
  expect(ok.data.edges.length).toBe(1); // dangling dropped
  expect(ok.issues.some((i: any) => i.level === "dropped")).toBe(true);

  const fatal = validateGraph({ project: { name: "p", description: "" }, nodes: [] });
  expect(fatal.success).toBe(false);
  expect(fatal.fatal).toMatch(/No valid nodes/);

  // implemented_by is NOT aliased (LOCKED invariant)
  const { EDGE_TYPE_ALIASES } = require("../learn/lib/schema");
  expect(EDGE_TYPE_ALIASES["implemented_by"]).toBeUndefined();
});

test("stages 4/5/6: layer partition, domain + knowledge-links, BFS tour", () => {
  tsx("scan.ts", ["--cwd", repo]);
  tsx("analyze-structural.ts", ["--cwd", repo]);
  expect(tsx("validate-graph.ts", ["--cwd", repo]).code).toBe(0);
  expect(tsx("assign-layers.ts", ["--cwd", repo]).code).toBe(0);
  expect(tsx("derive-domain.ts", ["--cwd", repo, "--run-id", "run-test"]).code).toBe(0);
  expect(tsx("build-tour.ts", ["--cwd", repo]).code).toBe(0);

  const g = JSON.parse(fs.readFileSync(path.join(repo, ".guild/indexes/knowledge-graph.json"), "utf8"));
  // every file node in exactly one layer
  const fileIds = g.nodes.filter((n: any) => n.type === "file").map((n: any) => n.id);
  const counts: Record<string, number> = {};
  for (const l of g.layers) for (const id of l.nodeIds) counts[id] = (counts[id] ?? 0) + 1;
  for (const id of fileIds) expect(counts[id]).toBe(1);
  // domain scaffold + persisted labels
  expect(g.nodes.some((n: any) => n.type === "domain")).toBe(true);
  expect(g.nodes.find((n: any) => n.id === "file:src/index.ts").component).toBeTruthy();
  // flow_step weights monotone within a flow
  const fs1 = g.edges.filter((e: any) => e.type === "flow_step");
  if (fs1.length > 1) expect(fs1[0].weight).toBeLessThanOrEqual(fs1[fs1.length - 1].weight);
  // knowledge-links append-only artifact
  const kl = JSON.parse(fs.readFileSync(path.join(repo, ".guild/indexes/knowledge-links.json"), "utf8"));
  expect(kl.version).toBe("guild.knowledge_links.v1");
  expect(kl.links.some((l: any) => l.type === "touches")).toBe(true);
  // tour skeleton
  expect(g.tour.length).toBeGreaterThanOrEqual(1);
});

test("staleness classifier: baseline → SKIP, then STRUCTURAL edit", () => {
  expect(tsx("staleness.ts", ["--cwd", repo, "--baseline"]).out.trim()).toBe("BASELINE");
  expect(tsx("staleness.ts", ["--cwd", repo]).out.trim()).toBe("SKIP");
  fs.writeFileSync(
    path.join(repo, "src/services/logger.ts"),
    `export function log(m: string) { return m; }\nexport function warn(m: string) { return m; }\n`,
  );
  const r = tsx("staleness.ts", ["--cwd", repo, "--print"]);
  const d = JSON.parse(r.out);
  expect(["PARTIAL", "ARCHITECTURE", "FULL"]).toContain(d.state);
});

test("zero runtime dependency on understand-anything", () => {
  const grep = spawnSync("grep", ["-rn", "understand-anything", UD], { encoding: "utf8" });
  const hits = (grep.stdout ?? "")
    .split("\n")
    .filter((l) => l && !l.includes("LICENSE-attribution.md"));
  expect(hits).toEqual([]);
});
