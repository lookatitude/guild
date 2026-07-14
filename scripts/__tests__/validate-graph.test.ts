/**
 * scripts/__tests__/validate-graph.test.ts
 *
 * G2b fix #1 regression coverage: learn/validate-graph.ts must version-dispatch
 * (guild.knowledge_graph.v2 input → validateGraphV2, everything else → the v1
 * validateGraph) and must NEVER silently overwrite an on-disk v2 knowledge
 * graph (carrying the knowledge tier — wiki_page/topic/diagram nodes +
 * knowledge edges) with a non-v2-validated result unless --force is passed.
 *
 * Before the fix, validate-graph.ts always called the v1 validateGraph, which
 * drops topic/concept/claim/entity/diagram nodes as "unknown type" (they are
 * not in the v1 NODE_TYPES closed set) and stamps the output
 * "guild.knowledge_graph.v1" — silently stripping the knowledge tier a prior
 * learn-knowledge run produced.
 *
 * Usage: npx jest --testPathPattern=validate-graph --no-coverage
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import {
  isV2Input,
  isV2Result,
  validateWithDispatch,
  checkDowngradeGuard,
  KNOWLEDGE_GRAPH_V2,
} from "../learn/validate-graph";

const LEARN_DIR = path.resolve(__dirname, "../learn");

function tsx(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", path.join(LEARN_DIR, "validate-graph.ts"), ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function singleLayer(fileNodeIds: string[]): Record<string, unknown>[] {
  return [{ id: "layer:default", name: "Default", description: "", nodeIds: fileNodeIds }];
}

/** A v2 graph with a file node + a topic (knowledge-tier) node whose anchor resolves. */
function makeV2Graph(): Record<string, unknown> {
  return {
    version: "guild.knowledge_graph.v2",
    kind: "knowledge",
    generated_from_commit: "abc123",
    project: { name: "test", description: "" },
    nodes: [
      { id: "file:src/index.ts", type: "file", name: "index.ts", source_refs: ["src/index.ts"], confidence: "high" },
      {
        id: "topic:guild-core",
        type: "topic",
        name: "Guild Core",
        source_refs: ["docs/README.md#guild-core"],
        confidence: "high",
        category: "architecture",
        importance: "high",
        importance_score: 0.9,
        topic_path: ["guild", "core"],
      },
    ],
    edges: [],
    layers: singleLayer(["file:src/index.ts"]),
    tour: [],
  };
}

/** A v1-shaped graph (no knowledge-tier nodes) that would clobber a v2 graph if written over it. */
function makeV1Graph(): Record<string, unknown> {
  return {
    version: "guild.knowledge_graph.v1",
    generated_from_commit: "def456",
    project: { name: "test", description: "" },
    nodes: [
      { id: "file:src/index.ts", type: "file", name: "index.ts", source_refs: ["src/index.ts"], confidence: "high" },
    ],
    edges: [],
    layers: [],
    tour: [],
  };
}

function makeFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "validate-graph-"));
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export function main() {}\n");
  fs.writeFileSync(path.join(dir, "docs", "README.md"), "# Guild Core\n\nSome content.\n");
  return dir;
}

// ---------------------------------------------------------------------------
// Unit — isV2Input / isV2Result
// ---------------------------------------------------------------------------

describe("isV2Input / isV2Result", () => {
  test("isV2Input true for guild.knowledge_graph.v2", () => {
    expect(isV2Input({ version: KNOWLEDGE_GRAPH_V2 })).toBe(true);
  });
  test("isV2Input false for v1 / missing / non-object", () => {
    expect(isV2Input({ version: "guild.knowledge_graph.v1" })).toBe(false);
    expect(isV2Input({})).toBe(false);
    expect(isV2Input(null)).toBe(false);
    expect(isV2Input("x")).toBe(false);
  });
  test("isV2Result mirrors isV2Input over validated data", () => {
    expect(isV2Result({ version: KNOWLEDGE_GRAPH_V2 })).toBe(true);
    expect(isV2Result({ version: "guild.knowledge_graph.v1" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit — validateWithDispatch
// ---------------------------------------------------------------------------

describe("validateWithDispatch", () => {
  let dir: string;
  beforeAll(() => { dir = makeFixtureRepo(); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("v2 input dispatches to validateGraphV2 — topic node survives", () => {
    const result = validateWithDispatch(makeV2Graph(), dir);
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe(KNOWLEDGE_GRAPH_V2);
    expect(result.data?.nodes.some((n) => n.type === "topic")).toBe(true);
  });

  test("v1 input dispatches to the v1 validator", () => {
    const result = validateWithDispatch(makeV1Graph(), dir);
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe("guild.knowledge_graph.v1");
  });

  test("unversioned input falls back to the v1 validator", () => {
    const g = makeV1Graph();
    delete (g as Record<string, unknown>).version;
    const result = validateWithDispatch(g, dir);
    expect(result.success).toBe(true);
    expect(result.data?.version).toBe("guild.knowledge_graph.v1");
  });
});

// ---------------------------------------------------------------------------
// Unit — checkDowngradeGuard
// ---------------------------------------------------------------------------

describe("checkDowngradeGuard", () => {
  let dir: string;
  let graphPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "downgrade-guard-"));
    graphPath = path.join(dir, "knowledge-graph.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("refuses when on-disk is v2 and result is not v2 and force is false", () => {
    fs.writeFileSync(graphPath, JSON.stringify(makeV2Graph()));
    const guard = checkDowngradeGuard(graphPath, makeV1Graph(), false);
    expect(guard.refused).toBe(true);
    expect(guard.onDiskVersion).toBe(KNOWLEDGE_GRAPH_V2);
  });

  test("allows when --force is set even if it would downgrade", () => {
    fs.writeFileSync(graphPath, JSON.stringify(makeV2Graph()));
    const guard = checkDowngradeGuard(graphPath, makeV1Graph(), true);
    expect(guard.refused).toBe(false);
  });

  test("allows when result is also v2 (no downgrade)", () => {
    fs.writeFileSync(graphPath, JSON.stringify(makeV2Graph()));
    const guard = checkDowngradeGuard(graphPath, makeV2Graph(), false);
    expect(guard.refused).toBe(false);
  });

  test("allows when nothing is on disk yet", () => {
    const guard = checkDowngradeGuard(graphPath, makeV1Graph(), false);
    expect(guard.refused).toBe(false);
  });

  test("allows when on-disk graph is v1 (no tier to protect)", () => {
    fs.writeFileSync(graphPath, JSON.stringify(makeV1Graph()));
    const guard = checkDowngradeGuard(graphPath, makeV1Graph(), false);
    expect(guard.refused).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLI integration — end-to-end regression via the real CLI process
// ---------------------------------------------------------------------------

describe("validate-graph.ts CLI — v2 knowledge-tier survival + downgrade guard", () => {
  let repo: string;

  beforeEach(() => { repo = makeFixtureRepo(); });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  test("regression: feeding a v2 graph through the CLI preserves the knowledge tier", () => {
    const inputPath = path.join(repo, "v2-input.json");
    fs.writeFileSync(inputPath, JSON.stringify(makeV2Graph()));

    const r = tsx(["--cwd", repo, "--in", inputPath]);
    expect(r.code).toBe(0);

    const written = JSON.parse(
      fs.readFileSync(path.join(repo, ".guild/indexes/knowledge-graph.json"), "utf8"),
    );
    expect(written.version).toBe(KNOWLEDGE_GRAPH_V2);
    expect(written.nodes.some((n: { type: string }) => n.type === "topic")).toBe(true);
  });

  test("refuses to clobber an on-disk v2 graph with a v1-validated result (no --force)", () => {
    const graphPath = path.join(repo, ".guild/indexes/knowledge-graph.json");
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, JSON.stringify(makeV2Graph(), null, 2) + "\n");

    const inputPath = path.join(repo, "v1-input.json");
    fs.writeFileSync(inputPath, JSON.stringify(makeV1Graph()));

    const r = tsx(["--cwd", repo, "--in", inputPath]);
    expect(r.code).toBe(2);

    // On-disk v2 graph must be untouched — the knowledge tier survives.
    const stillOnDisk = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    expect(stillOnDisk.version).toBe(KNOWLEDGE_GRAPH_V2);
    expect(stillOnDisk.nodes.some((n: { type: string }) => n.type === "topic")).toBe(true);
  });

  test("--force deliberately downgrades an on-disk v2 graph", () => {
    const graphPath = path.join(repo, ".guild/indexes/knowledge-graph.json");
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, JSON.stringify(makeV2Graph(), null, 2) + "\n");

    const inputPath = path.join(repo, "v1-input.json");
    fs.writeFileSync(inputPath, JSON.stringify(makeV1Graph()));

    const r = tsx(["--cwd", repo, "--in", inputPath, "--force"]);
    expect(r.code).toBe(0);

    const written = JSON.parse(fs.readFileSync(graphPath, "utf8"));
    expect(written.version).toBe("guild.knowledge_graph.v1");
  });
});
