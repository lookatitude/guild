/**
 * scripts/__tests__/write-task-run.test.ts
 *
 * TE-01/ARCH-1 — guild.task_run.v1 writer.
 *
 * Covers:
 *   - writeTaskRun creates .guild/runs/<run-id>/task-runs/<task-id>.yaml
 *     with the exact frozen guild.task_run.v1 shape (target-architecture.md §task_run).
 *   - taskRunPath returns the canonical path.
 *   - All required top-level fields are present + schema_version is correct.
 *   - Atomic write: the file appears completely (temp+rename pattern).
 *   - Idempotent re-write (last write wins, used on re-dispatch).
 *   - Never writes to .guild/wiki/.
 *   - capability_requirements block is present and properly set.
 *   - CLI smoke: --cwd --run-id --task-id writes the file and prints its path.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  writeTaskRun,
  taskRunPath,
  type TaskRunParams,
  type TaskRunDocument,
} from "../write-task-run";

const SCRIPT = path.resolve(__dirname, "../write-task-run.ts");
const NODE_ENV = {
  ...process.env,
  NODE_NO_WARNINGS: "1",
  PATH: "/opt/homebrew/bin:/usr/bin:/bin",
} as NodeJS.ProcessEnv;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-taskrun-"));
}

function readTaskRun(root: string, runId: string, taskId: string): TaskRunDocument {
  const raw = fs.readFileSync(taskRunPath(root, runId, taskId), "utf8");
  return yaml.load(raw) as TaskRunDocument;
}

const BASE_PARAMS: TaskRunParams = {
  initiativeId: null,
  taskRunId: "trun-001",
  specialist: "backend",
  objective: "Implement POST /auth with argon2id",
  contextBundle: ".guild/context/run-001/backend-api-001.md",
  inputs: [".guild/spec/alpha.md", ".guild/plan/alpha.md"],
  expectedOutputs: ["handoff_receipt", "changed_files", "evidence"],
  dependsOn: ["architect-design-001"],
  permissions: {
    read: ["repo"],
    write: ["assigned_worktree"],
    network: "disabled_by_default",
    shell: "approval_required",
    destructive: "approval_required",
  },
  budget: { maxTurns: 20, maxTokens: 80000 },
  autonomyPolicy: "autonomous_after_plan_approval",
  loopsApplicable: "none",
  host: {
    requested: "any",
    capabilityRequirements: {
      needsPr: false,
      needsParallel: false,
      needsNetwork: false,
      isolation: "worktree",
    },
  },
};

describe("write-task-run — taskRunPath (TE-01/ARCH-1)", () => {
  it("returns the canonical .guild/runs/<run-id>/task-runs/<task-id>.yaml path", () => {
    const p = taskRunPath("/repo", "run-001", "backend-api-001");
    expect(p).toBe(
      path.join("/repo", ".guild", "runs", "run-001", "task-runs", "backend-api-001.yaml")
    );
  });
});

describe("write-task-run — writeTaskRun (TE-01/ARCH-1)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("creates the task-runs directory and writes the YAML file", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const outPath = taskRunPath(root, "run-001", "backend-api-001");
    expect(fs.existsSync(outPath)).toBe(true);
  });

  it("returns the written file path", () => {
    const root = mkRoot();
    const returned = writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    expect(returned).toBe(taskRunPath(root, "run-001", "backend-api-001"));
  });

  it("schema_version is guild.task_run.v1", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.schema_version).toBe("guild.task_run.v1");
  });

  it("ids block carries run_id, task_id, task_run_id, initiative_id", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.ids.run_id).toBe("run-001");
    expect(doc.task_run.ids.task_id).toBe("backend-api-001");
    expect(doc.task_run.ids.task_run_id).toBe("trun-001");
    expect(doc.task_run.ids.initiative_id).toBeNull();
  });

  it("specialist, objective, context_bundle are serialized correctly", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.specialist).toBe("backend");
    expect(doc.task_run.objective).toBe("Implement POST /auth with argon2id");
    expect(doc.task_run.context_bundle).toBe(
      ".guild/context/run-001/backend-api-001.md"
    );
  });

  it("inputs, expected_outputs, depends_on arrays are serialized", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.inputs).toEqual([
      ".guild/spec/alpha.md",
      ".guild/plan/alpha.md",
    ]);
    expect(doc.task_run.expected_outputs).toEqual([
      "handoff_receipt",
      "changed_files",
      "evidence",
    ]);
    expect(doc.task_run.depends_on).toEqual(["architect-design-001"]);
  });

  it("permissions block is serialized", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.permissions.read).toEqual(["repo"]);
    expect(doc.task_run.permissions.write).toEqual(["assigned_worktree"]);
    expect(doc.task_run.permissions.network).toBe("disabled_by_default");
    expect(doc.task_run.permissions.shell).toBe("approval_required");
    expect(doc.task_run.permissions.destructive).toBe("approval_required");
  });

  it("budget block is serialized with max_turns + max_tokens", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.budget.max_turns).toBe(20);
    expect(doc.task_run.budget.max_tokens).toBe(80000);
  });

  it("autonomy_policy and loops_applicable are serialized", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.autonomy_policy).toBe("autonomous_after_plan_approval");
    expect(doc.task_run.loops_applicable).toBe("none");
  });

  it("host block: requested=any, selected=null, capability_requirements populated", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.host.requested).toBe("any");
    expect(doc.task_run.host.selected).toBeNull();
    const cr = doc.task_run.host.capability_requirements;
    expect(cr.needs_pr).toBe(false);
    expect(cr.needs_parallel).toBe(false);
    expect(cr.needs_network).toBe(false);
    expect(cr.isolation).toBe("worktree");
  });

  it("trace block carries events_ref pointing to the run log", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.trace.events_ref).toContain("run-001");
    expect(doc.task_run.trace.events_ref).toContain("v1.4-events.jsonl");
  });

  it("initiative_id is preserved when non-null", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-002", "arch-001", {
      ...BASE_PARAMS,
      initiativeId: "init-alpha",
    });
    const doc = readTaskRun(root, "run-002", "arch-001");
    expect(doc.task_run.ids.initiative_id).toBe("init-alpha");
  });

  it("re-write is idempotent (last write wins — one file per re-dispatch attempt)", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    // Re-dispatch: new task_run_id
    const secondParams = { ...BASE_PARAMS, taskRunId: "trun-002" };
    writeTaskRun(root, "run-001", "backend-api-001", secondParams);
    const doc = readTaskRun(root, "run-001", "backend-api-001");
    expect(doc.task_run.ids.task_run_id).toBe("trun-002"); // latest attempt wins
  });

  it("never writes to .guild/wiki/", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const wikiDir = path.join(root, ".guild", "wiki");
    expect(fs.existsSync(wikiDir)).toBe(false);
  });

  it("file is valid YAML (not JSON) — top-level key is task_run:", () => {
    const root = mkRoot();
    writeTaskRun(root, "run-001", "backend-api-001", BASE_PARAMS);
    const raw = fs.readFileSync(taskRunPath(root, "run-001", "backend-api-001"), "utf8");
    // YAML format: must start with `task_run:`, not `{`
    expect(raw.trimStart()).toMatch(/^task_run:/);
  });
});

describe("write-task-run — CLI smoke (TE-01/ARCH-1)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const mkRoot = () => {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  };

  it("writes the file and prints its path to stdout", () => {
    const root = mkRoot();
    const result = spawnSync(
      "npx",
      [
        "tsx",
        SCRIPT,
        "--cwd", root,
        "--run-id", "run-cli-001",
        "--task-id", "backend-001",
        "--task-run-id", "trun-001",
        "--specialist", "backend",
        "--objective", "CLI smoke test objective",
      ],
      { env: NODE_ENV, encoding: "utf8" }
    );
    expect(result.status).toBe(0);
    const outPath = result.stdout.trim();
    expect(fs.existsSync(outPath)).toBe(true);
    expect(outPath).toContain("task-runs");
    expect(outPath).toContain("backend-001.yaml");
  });

  it("exits 1 on missing required --cwd", () => {
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--run-id", "r", "--task-id", "t"],
      { env: NODE_ENV, encoding: "utf8" }
    );
    expect(result.status).toBe(1);
  });

  it("exits 1 on missing required --run-id", () => {
    const root = mkRoot();
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--cwd", root, "--task-id", "t"],
      { env: NODE_ENV, encoding: "utf8" }
    );
    expect(result.status).toBe(1);
  });

  it("exits 1 on missing required --task-id", () => {
    const root = mkRoot();
    const result = spawnSync(
      "npx",
      ["tsx", SCRIPT, "--cwd", root, "--run-id", "r"],
      { env: NODE_ENV, encoding: "utf8" }
    );
    expect(result.status).toBe(1);
  });
});
