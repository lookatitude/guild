/**
 * scripts/__tests__/vc-k2-knowledge-links.test.ts
 *
 * VC-K2 connectivity — converts the deferred-runtime-test register entry
 * (P7C-consolidated-validation.md §D, owner P7C-gate-001) from design-only to
 * executable + tested.
 *
 * Canonical runtime test (continuous-knowledge-and-learning-loop.md §180-183):
 * for any completed-run task-id, ONE knowledge-links.json traversal reaches the
 * 4 node kinds — (1) constraining decisions, (2) running skill/agent,
 * (3) touched feature/component, (4) describing wiki pages.
 *
 * Hermetic: builds a synthetic fixture repo in a temp dir, runs the REAL
 * brownfield engine pipeline (scan → analyze → validate → derive-domain, which
 * emits the stage-5 domain↔file `touches` batch — codebase-understanding.md
 * §"5 Domain"), then appends the per-phase LearningCheckpoint
 * `knowledge_links_batch` (the task↔decision/skill/component + component↔wiki
 * edges) the same way the live checkpoint does (append-only into the same
 * derived index — CR-A #2), then traverses. Cleans up the fixture.
 */
import { spawnSync, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  loadKnowledgeLinks,
  appendBatch,
  reachableKinds,
  allEdgesClosed,
  nonClosedEdgeTypes,
  isFullyConnected,
  CLOSED_EDGE_TYPES,
  type KnowledgeLink,
} from "../knowledge-links-traverse";

const UD = path.resolve(__dirname, "../learn");
const ENV = { ...process.env, NODE_NO_WARNINGS: "1" } as NodeJS.ProcessEnv;

function tsx(script: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync("npx", ["tsx", path.join(UD, script), ...args], {
    encoding: "utf8",
    timeout: 60000,
    env: ENV,
  });
  return { code: r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

let repo: string;
let klPath: string;

// 3 task-like nodes; each gets its own 4-kind neighborhood via closed-set edges.
// Edge-type choices (all closed-set, CR-A #2):
//   decision --constrains--> task           (constraining decision)
//   skill/agent --used_for--> task          (running skill/agent)
//   task --touches--> feature/component     (touched feature/component)
//   feature/component --learned_from--> wiki (the wiki page describing it)
const TASK_IDS = ["task:T1", "task:T2", "task:T3"];
const CHECKPOINT_BATCH: KnowledgeLink[] = [
  { from: "decision:auth-model", to: "task:T1", type: "constrains", run_id: "run-h1" },
  { from: "skill:guild-backend", to: "task:T1", type: "used_for", run_id: "run-h1" },
  { from: "task:T1", to: "component:checkout", type: "touches", run_id: "run-h1" },
  { from: "component:checkout", to: "wiki:checkout-spec", type: "learned_from", run_id: "run-h1" },

  { from: "decision:rate-limit", to: "task:T2", type: "constrains", run_id: "run-h2" },
  { from: "agent:guild-security", to: "task:T2", type: "used_for", run_id: "run-h2" },
  { from: "task:T2", to: "feature:login", type: "touches", run_id: "run-h2" },
  { from: "feature:login", to: "wiki:login-guide", type: "learned_from", run_id: "run-h2" },

  { from: "decision:caching", to: "task:T3", type: "constrains", run_id: "run-h3" },
  { from: "skill:guild-frontend", to: "task:T3", type: "used_for", run_id: "run-h3" },
  { from: "task:T3", to: "component:cart", type: "touches", run_id: "run-h3" },
  { from: "component:cart", to: "wiki:cart-notes", type: "learned_from", run_id: "run-h3" },
];

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "vc-k2-"));
  // Two modules → the engine derives ≥2 domains + domain↔file `touches` edges.
  fs.mkdirSync(path.join(repo, "src/checkout"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src/auth"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "vc-k2-fixture", version: "0.0.0" }),
  );
  fs.writeFileSync(
    path.join(repo, "src/checkout/cart.ts"),
    `export function addItem(id: string) { return id; }\nexport function total() { return 0; }\n`,
  );
  fs.writeFileSync(
    path.join(repo, "src/auth/login.ts"),
    `export function login(u: string) { return u; }\nexport function logout() { return true; }\n`,
  );
  // git-init so resolveMainRepoRoot anchors .guild/ at the fixture (not a parent repo).
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: repo });
  } catch {
    /* git optional */
  }
  klPath = path.join(repo, ".guild/indexes/knowledge-links.json");
}, 60000);

afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

test("engine pipeline emits the stage-5 knowledge-links `touches` batch", () => {
  expect(tsx("scan.ts", ["--cwd", repo]).code).toBe(0);
  expect(tsx("analyze-structural.ts", ["--cwd", repo]).code).toBe(0);
  expect(tsx("validate-graph.ts", ["--cwd", repo]).code).toBe(0);
  expect(tsx("derive-domain.ts", ["--cwd", repo, "--run-id", "run-engine"]).code).toBe(0);

  const doc = loadKnowledgeLinks(klPath);
  expect(doc.version).toBe("guild.knowledge_links.v1");
  // The engine's own batch is domain↔file `touches` — a closed-set member.
  expect(doc.links.some((l) => l.type === "touches")).toBe(true);
  expect(allEdgesClosed(doc)).toBe(true);
}, 60000);

test("append the LearningCheckpoint batch (append-only, idempotent dedupe)", () => {
  const first = appendBatch(klPath, CHECKPOINT_BATCH);
  expect(first.added).toBe(CHECKPOINT_BATCH.length);
  // Re-append is a no-op (dedupe on from|to|type) — append-only + idempotent.
  const second = appendBatch(klPath, CHECKPOINT_BATCH);
  expect(second.added).toBe(0);
  expect(second.total).toBe(first.total);
});

test("≥3 task-like nodes are present in the link graph", () => {
  const doc = loadKnowledgeLinks(klPath);
  const ids = new Set(doc.links.flatMap((l) => [l.from, l.to]));
  for (const t of TASK_IDS) expect(ids.has(t)).toBe(true);
  expect(TASK_IDS.length).toBeGreaterThanOrEqual(3);
});

test("each completed-run task-id reaches all 4 node kinds in one traversal", () => {
  const doc = loadKnowledgeLinks(klPath);
  for (const taskId of TASK_IDS) {
    const kinds = reachableKinds(doc, taskId);
    expect(kinds.has("decision")).toBe(true); // (1) constraining decisions
    expect(kinds.has("skill_agent")).toBe(true); // (2) running skill/agent
    expect(kinds.has("feature_component")).toBe(true); // (3) touched feature/component
    expect(kinds.has("wiki")).toBe(true); // (4) describing wiki pages
    expect(isFullyConnected(doc, taskId)).toBe(true);
  }
});

test("every edge in the union is from the closed edge-type set (CR-A #2)", () => {
  const doc = loadKnowledgeLinks(klPath);
  expect(nonClosedEdgeTypes(doc)).toEqual([]);
  expect(allEdgesClosed(doc)).toBe(true);
  // sanity: the checkpoint batch only used closed-set types.
  for (const l of CHECKPOINT_BATCH) expect(CLOSED_EDGE_TYPES.has(l.type)).toBe(true);
});
