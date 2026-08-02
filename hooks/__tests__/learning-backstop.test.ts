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
// T3b (session_context §5): the Stop entry's checkpoint writes are binding-
// gated; real-path fixtures mint the run's binding so authorized writes pass.
import { mintTestBinding } from "../test-support/mint-binding";
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
    for (const k of ["GUILD_RUN_ID", "GUILD_CWD", "GUILD_RUN_DIR", "GUILD_RUN_BINDING_REF"]) {
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
    // Rework F1: the writer requires the caller-PRESENTED pair — export the
    // full envelope (a minted record alone no longer authorizes).
    const ref = mintTestBinding(root, RUN_ID);
    const { exitCode, stderr } = runEntry({
      GUILD_RUN_ID: RUN_ID,
      GUILD_RUN_BINDING_REF: ref,
      GUILD_CWD: root,
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("[learning-backstop] wrote 2 backstop checkpoint(s)");
    expect(fs.existsSync(learningFile("planning"))).toBe(true);
    expect(fs.existsSync(learningFile("development"))).toBe(true);
    const content = fs.readFileSync(learningFile("development"), "utf8");
    expect(content).toMatch(/^  backstop: true$/m);
  });

  it("does NOT resolve the run id from the current-run-id sentinel when env is unset (T3b §5: sentinel is intake-only, never a writer identity)", () => {
    // CORRECTED (T3b): this test previously ENCODED the retired sentinel-write
    // defect (sentinel resolved a writer identity and the backstop wrote under
    // it). Under session_context §5 the sentinel never authorizes a write:
    // with no explicit binding env, the entry fails closed and writes nothing —
    // even with a minted, open binding record present (no envelope, no write).
    writeRunYaml(BLOCK_PHASES_LOG);
    mintTestBinding(root, RUN_ID);
    fs.writeFileSync(
      path.join(root, ".guild", "runs", "current-run-id"),
      RUN_ID + "\n",
      "utf8",
    );
    const { exitCode } = runEntry({ GUILD_CWD: root });
    expect(exitCode).toBe(0);
    expect(fs.existsSync(learningFile("development"))).toBe(false);
  });

  it("is a silent no-op (exit 0) with no resolvable run", () => {
    const { exitCode, stderr } = runEntry({ GUILD_CWD: root });
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("backstop checkpoint");
    expect(fs.existsSync(path.join(runDir, "learning"))).toBe(false);
  });
});

// ── METRIC 2: backstop_rate = 0% on the golden full-learn fixture ──────────────
//
// A healthy 6-phase run (init/ideate/plan/build/qa/ops) where the deterministic
// emitter (recordPhase → emitPhaseCheckpoint) has already written a real
// guild.learning_checkpoint.v1 for EVERY phase must produce backstop_rate = 0%:
// runLearningBackstop() must write nothing.
//
// Golden fixture: hooks/__tests__/fixtures/golden-full-learn-run/
//   .guild/runs/run-golden-full-6phase-learn/run.yaml          — 6-phase phases_log
//   .guild/runs/run-golden-full-6phase-learn/learning/<phase>-<id>.yaml × 6
//
// The fixture represents the REAL deterministic-emit output — all-none verdicts,
// no backstop marker (the absence of backstop:true is load-bearing; that marker
// distinguishes fail-open backstop writes from real emitter output).
//
// Anti-vacuity control: deleting ONE phase checkpoint and re-running backstop
// must produce written.length === 1, proving the metric can fail.

const GOLDEN_FIXTURE_DIR = path.resolve(
  __dirname,
  "fixtures/golden-full-learn-run",
);
const GOLDEN_RUN_ID = "run-golden-full-6phase-learn";
// The 6 canonical lifecycle tokens → checkpoint phases (from PHASE_TOKEN_TO_CHECKPOINT)
const GOLDEN_CHECKPOINT_PHASES = [
  "init",
  "ideation",
  "planning",
  "development",
  "quality",
  "operations",
] as const;

describe("METRIC 2 — backstop_rate = 0% on golden full-learn fixture", () => {
  let goldenRoot: string;

  beforeEach(() => {
    // Copy the golden fixture into a tmpdir so tests can mutate it (anti-vacuity).
    goldenRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-golden-learn-"));
    // Recursive copy of the fixture tree
    function copyDir(src: string, dest: string): void {
      fs.mkdirSync(dest, { recursive: true });
      for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) {
          copyDir(s, d);
        } else {
          fs.copyFileSync(s, d);
        }
      }
    }
    copyDir(GOLDEN_FIXTURE_DIR, goldenRoot);
  });

  afterEach(() => {
    fs.rmSync(goldenRoot, { recursive: true, force: true });
  });

  it("fixture sanity: golden run.yaml contains all 6 phase tokens", () => {
    const raw = fs.readFileSync(
      path.join(goldenRoot, ".guild", "runs", GOLDEN_RUN_ID, "run.yaml"),
      "utf8",
    );
    for (const token of ["init", "ideate", "plan", "build", "qa", "ops"]) {
      expect(raw).toContain(`phase: ${token}`);
    }
  });

  it("fixture sanity: all 6 checkpoint files exist with no backstop marker", () => {
    const learningDir = path.join(
      goldenRoot, ".guild", "runs", GOLDEN_RUN_ID, "learning",
    );
    for (const cp of GOLDEN_CHECKPOINT_PHASES) {
      const p = path.join(learningDir, `${cp}-${GOLDEN_RUN_ID}.yaml`);
      expect(fs.existsSync(p)).toBe(true);
      const content = fs.readFileSync(p, "utf8");
      // Real emitter output: no backstop marker
      expect(content).not.toContain("backstop: true");
      // Valid checkpoint envelope
      expect(content).toContain("version: guild.learning_checkpoint.v1");
    }
  });

  it("backstop_rate = 0%: runLearningBackstop writes nothing when all checkpoints exist", () => {
    const result = runLearningBackstop({ guildRoot: goldenRoot, runId: GOLDEN_RUN_ID });
    // All 6 phases already have checkpoints → backstop writes nothing
    expect(result.written).toHaveLength(0);
    // All 6 checkpoint phases are recognised as already-existing
    expect(result.skippedExisting.sort()).toEqual([...GOLDEN_CHECKPOINT_PHASES].sort());
    expect(result.errors).toHaveLength(0);
    expect(result.unknownTokens).toHaveLength(0);
  });

  it("ANTI-VACUITY: deleting one checkpoint → backstop writes exactly 1", () => {
    // Delete the 'development' phase checkpoint (simulates a run where recordPhase
    // did not emit the checkpoint — the exact scenario METRIC 2 guards against).
    const missingPhase = "development";
    const missingFile = path.join(
      goldenRoot, ".guild", "runs", GOLDEN_RUN_ID, "learning",
      `${missingPhase}-${GOLDEN_RUN_ID}.yaml`,
    );
    fs.unlinkSync(missingFile);

    const result = runLearningBackstop({ guildRoot: goldenRoot, runId: GOLDEN_RUN_ID });
    // Must write the backstop for the missing phase
    expect(result.written).toEqual([missingPhase]);
    expect(result.written).toHaveLength(1);
    // The written backstop has backstop: true (distinguishable from real emitter output)
    const backstopContent = fs.readFileSync(missingFile, "utf8");
    expect(backstopContent).toMatch(/^  backstop: true$/m);
    // Proves the metric CAN fail (rate > 0%) — anti-vacuity gate passes
  });
});
