/**
 * hooks/__tests__/learning-backstop.test.ts
 *
 * G-7 (SC-3) — Stop-hook learning-checkpoint backstop
 * (hooks/lib/learning-backstop.ts + the hooks/learning-backstop.ts entry).
 *
 * Covers:
 *  - phases_log with 2 phases + 1 existing learning file → EXACTLY 1
 *    backstop checkpoint written, all-`none` 12-target verdict, backstop: true
 *  - idempotent on re-run (second sweep writes nothing)
 *  - lenient parse: block form (run-lifecycle shape) AND inline flow form
 *    (the real run-85d27757 run.yaml shape)
 *  - canonical lifecycle tokens map to checkpoint phases (build→development)
 *  - unknown tokens skipped; missing run.yaml / empty phases_log → no-op
 *  - REAL PATH: spawning the Stop entry via tsx with GUILD_RUN_ID set
 *
 * Fixtures mimic the REAL generated shapes:
 *  - run.yaml header from .guild/runs/run-7ad5dbfd-.../run.yaml
 *  - inline phases_log from .guild/runs/run-85d27757-.../run.yaml
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  parsePhasesLogPhases,
  runLearningBackstop,
  PHASE_TOKEN_TO_CHECKPOINT,
} from "../lib/learning-backstop";
import {
  writeCheckpoint,
  DECISION_TARGETS,
} from "../emit-learning-checkpoint";
// Shared js-yaml frontmatter parser (OD-3 compliant) — parse the checkpoint and
// read the nested decision verdicts instead of a hand-rolled dynamic RegExp.
import { parseYaml } from "../../scripts/lib/frontmatter";

const ENTRY = path.resolve(__dirname, "../learning-backstop.ts");
const RUN_ID = "run-7ad5dbfd-6c0a-4167-95d7-6d99cfd42320";

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-backstop-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  runDir = path.join(root, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Real-shape run.yaml (header mirrors run-7ad5dbfd's on-disk file). */
function writeRunYaml(phasesLogLines: string[]): void {
  const lines = [
    "schema_version: guild.run.v1",
    `run_id: ${RUN_ID}`,
    "command: /guild:build",
    "arguments: {}",
    `cwd: ${root}`,
    "target_kind: existing_guild_project",
    "workspace:",
    "  is_workspace: false",
    `  root: ${root}`,
    "project: project",
    "host:",
    "  requested: auto",
    "  resolved: claude",
    "model_tier_policy: default (full run)",
    "started_at: 2026-05-31T22:07:41Z",
    "ignore_policy: default",
    "scan_policy: default",
    "initiative_attachment: null",
    "phase: build",
    "run_class: full",
    "gates: {}",
    "status: closed",
    ...phasesLogLines,
  ];
  fs.writeFileSync(path.join(runDir, "run.yaml"), lines.join("\n") + "\n", "utf8");
}

/** The block phases_log shape written by run-lifecycle appendPhase. */
const BLOCK_PHASES_LOG = [
  "phases_log:",
  "  - phase: plan",
  "    at: 2026-06-10T00:00:00Z",
  "  - phase: build",
  "    at: 2026-06-10T01:00:00Z",
];

function learningFile(phase: string): string {
  return path.join(runDir, "learning", `${phase}-${RUN_ID}.yaml`);
}

describe("parsePhasesLogPhases — lenient parse", () => {
  it("parses the block form (run-lifecycle appendPhase shape)", () => {
    const raw = BLOCK_PHASES_LOG.join("\n");
    expect(parsePhasesLogPhases(raw)).toEqual(["plan", "build"]);
  });

  it("parses the inline flow form (real run-85d27757 shape)", () => {
    const raw = [
      "phases_log:",
      "  - { phase: ideation, at: 2026-06-10, artifact: .guild/spec/v2-gap-closure.md }",
      "  - { phase: planning, at: 2026-06-10, artifact: .guild/plan/v2-gap-closure.md }",
    ].join("\n");
    expect(parsePhasesLogPhases(raw)).toEqual(["ideation", "planning"]);
  });

  it("does NOT match the top-level phase: scalar, dedupes repeats", () => {
    const raw = [
      "phase: build",
      "phases_log:",
      "  - phase: build",
      "    at: 2026-06-10T01:00:00Z",
      "  - phase: build",
      "    at: 2026-06-10T02:00:00Z",
    ].join("\n");
    expect(parsePhasesLogPhases(raw)).toEqual(["build"]);
  });

  it("returns [] for the empty inline form (phases_log: [])", () => {
    expect(parsePhasesLogPhases("phase: null\nphases_log: []\n")).toEqual([]);
  });
});

describe("PHASE_TOKEN_TO_CHECKPOINT", () => {
  it("maps every canonical lifecycle token onto the checkpoint vocabulary", () => {
    expect(PHASE_TOKEN_TO_CHECKPOINT["init"]).toBe("init");
    expect(PHASE_TOKEN_TO_CHECKPOINT["ideate"]).toBe("ideation");
    expect(PHASE_TOKEN_TO_CHECKPOINT["plan"]).toBe("planning");
    expect(PHASE_TOKEN_TO_CHECKPOINT["build"]).toBe("development");
    expect(PHASE_TOKEN_TO_CHECKPOINT["qa"]).toBe("quality");
    expect(PHASE_TOKEN_TO_CHECKPOINT["ops"]).toBe("operations");
  });
});

describe("runLearningBackstop", () => {
  it("2 phases logged + 1 existing learning file → exactly 1 backstop, all-none, backstop:true", () => {
    writeRunYaml(BLOCK_PHASES_LOG);
    // The model DID emit the planning checkpoint (via the real emitter)…
    writeCheckpoint({
      runId: RUN_ID,
      phase: "planning",
      evidenceRef: ".guild/runs/x/review.md",
      guildRoot: root,
    });
    // …but forgot the development one.
    const result = runLearningBackstop({ guildRoot: root, runId: RUN_ID });

    expect(result.written).toEqual(["development"]);
    expect(result.skippedExisting).toEqual(["planning"]);
    expect(result.errors).toEqual([]);

    const content = fs.readFileSync(learningFile("development"), "utf8");
    // guild.learning_checkpoint.v1 envelope
    expect(content).toContain("version: guild.learning_checkpoint.v1");
    expect(content).toContain("phase: development");
    expect(content).toContain(`run_id: ${RUN_ID}`);
    // all-`none` 12-target verdict (nested under learning_checkpoint.decisions)
    const checkpoint = parseYaml(content) as {
      learning_checkpoint?: { decisions?: Record<string, unknown> };
    } | null;
    const decisions = checkpoint?.learning_checkpoint?.decisions ?? {};
    for (const target of DECISION_TARGETS) {
      expect(decisions[target]).toBe("none");
    }
    // the backstop marker
    expect(content).toMatch(/^  backstop: true$/m);

    // the model-emitted checkpoint was NOT overwritten / NOT marked backstop
    const planning = fs.readFileSync(learningFile("planning"), "utf8");
    expect(planning).not.toContain("backstop: true");
    expect(planning).toContain(".guild/runs/x/review.md");
  });

  it("is idempotent: a second sweep writes nothing", () => {
    writeRunYaml(BLOCK_PHASES_LOG);
    const first = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(first.written.sort()).toEqual(["development", "planning"]);

    const before = fs.readFileSync(learningFile("development"), "utf8");
    const second = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(second.written).toEqual([]);
    expect(second.skippedExisting.sort()).toEqual(["development", "planning"]);
    expect(fs.readFileSync(learningFile("development"), "utf8")).toBe(before);
  });

  it("handles the inline flow form with checkpoint-native tokens", () => {
    writeRunYaml([
      "phases_log:",
      "  - { phase: ideation, at: 2026-06-10, artifact: .guild/spec/v2-gap-closure.md }",
      "  - { phase: planning, at: 2026-06-10, artifact: .guild/plan/v2-gap-closure.md }",
    ]);
    const result = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(result.written).toEqual(["ideation", "planning"]);
    expect(fs.existsSync(learningFile("ideation"))).toBe(true);
    expect(fs.existsSync(learningFile("planning"))).toBe(true);
  });

  it("skips unknown tokens and reports them (never throws)", () => {
    writeRunYaml([
      "phases_log:",
      "  - phase: deploy",
      "    at: 2026-06-10T00:00:00Z",
      "  - phase: build",
      "    at: 2026-06-10T01:00:00Z",
    ]);
    const result = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(result.unknownTokens).toEqual(["deploy"]);
    expect(result.written).toEqual(["development"]);
  });

  it("no-ops on an empty phases_log (the real run-7ad5dbfd shape)", () => {
    writeRunYaml(["phases_log: []"]);
    const result = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(result.written).toEqual([]);
    expect(fs.existsSync(path.join(runDir, "learning"))).toBe(false);
  });

  it("no-ops when run.yaml is absent", () => {
    fs.rmSync(path.join(runDir, "run.yaml"), { force: true });
    const result = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(result.written).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("REAL PATH — Stop entry (hooks/learning-backstop.ts via tsx)", () => {
  function runEntry(env: Record<string, string>): {
    exitCode: number;
    stderr: string;
  } {
    const base: Record<string, string | undefined> = { ...process.env };
    for (const k of ["GUILD_RUN_ID", "GUILD_CWD", "GUILD_RUN_DIR"]) {
      delete base[k];
    }
    const result = spawnSync("npx", ["tsx", ENTRY], {
      input: JSON.stringify({
        session_id: "sess-abc123",
        cwd: root,
        hook_event_name: "Stop",
      }),
      encoding: "utf8",
      env: { ...base, ...env },
      timeout: 25000,
    });
    return { exitCode: result.status ?? 1, stderr: result.stderr ?? "" };
  }

  it("writes backstop checkpoints for the active run and exits 0", () => {
    writeRunYaml(BLOCK_PHASES_LOG);
    const { exitCode, stderr } = runEntry({
      GUILD_RUN_ID: RUN_ID,
      GUILD_CWD: root,
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("[learning-backstop] wrote 2 backstop checkpoint(s)");
    expect(fs.existsSync(learningFile("planning"))).toBe(true);
    expect(fs.existsSync(learningFile("development"))).toBe(true);
    const content = fs.readFileSync(learningFile("development"), "utf8");
    expect(content).toMatch(/^  backstop: true$/m);
  });

  it("resolves the run id from the current-run-id sentinel when env is unset", () => {
    writeRunYaml(BLOCK_PHASES_LOG);
    fs.writeFileSync(
      path.join(root, ".guild", "runs", "current-run-id"),
      RUN_ID + "\n",
      "utf8",
    );
    const { exitCode } = runEntry({ GUILD_CWD: root });
    expect(exitCode).toBe(0);
    expect(fs.existsSync(learningFile("development"))).toBe(true);
  });

  it("is a silent no-op (exit 0) with no resolvable run", () => {
    const { exitCode, stderr } = runEntry({ GUILD_CWD: root });
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("backstop checkpoint");
    expect(fs.existsSync(path.join(runDir, "learning"))).toBe(false);
  });
});
