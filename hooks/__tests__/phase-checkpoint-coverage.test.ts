/**
 * hooks/__tests__/phase-checkpoint-coverage.test.ts
 *
 * METRIC 1 — phase_checkpoint_coverage = 100%.
 *
 * The per-phase learning checkpoint is supposed to leave a
 * `learning/<phase>-<runId>.yaml` for EVERY phase a run recorded in its
 * run.yaml `phases_log`. The Stop-hook backstop (hooks/lib/learning-backstop.ts)
 * is the deterministic guarantee. This file is the COVERAGE AUDIT that proves the
 * guarantee holds AND that a silently-dropped phase cannot pass unnoticed.
 *
 * (a) For a run, the set of mapped phases_log tokens == the set of emitted
 *     learning/<phase>-<runId>.yaml files (coverage == 100%). The audit is
 *     computed from first principles here (parse phases_log → map → list the
 *     checkpoint dir) rather than trusting the sweep's own bookkeeping.
 *
 *     Anti-vacuity: the audit FAILS when a phase token does not resolve to a
 *     checkpoint via PHASE_TOKEN_TO_CHECKPOINT — i.e. unknownTokens > 0. A
 *     phase that the mapping silently drops (audit: learning-backstop.ts:175,
 *     the `phase === undefined` skip) is therefore CAUGHT, not swept under the
 *     rug as "covered".
 *
 * Source of truth under test:
 *   - parsePhasesLogPhases / PHASE_TOKEN_TO_CHECKPOINT / runLearningBackstop
 *     (hooks/lib/learning-backstop.ts)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  parsePhasesLogPhases,
  runLearningBackstop,
  PHASE_TOKEN_TO_CHECKPOINT,
  type BackstopResult,
} from "../lib/learning-backstop";
import { writeCheckpoint, type CheckpointPhase } from "../emit-learning-checkpoint";

const RUN_ID = "run-cov-2026-06-21";

let root: string;
let runDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-phasecov-"));
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  runDir = path.join(root, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeRunYaml(phasesLogLines: string[]): void {
  const lines = [
    "schema_version: guild.run.v1",
    `run_id: ${RUN_ID}`,
    "command: /guild:build",
    "phase: build",
    "status: closed",
    ...phasesLogLines,
  ];
  fs.writeFileSync(path.join(runDir, "run.yaml"), lines.join("\n") + "\n", "utf8");
}

/** List the checkpoint phases that actually have an emitted YAML on disk. */
function emittedCheckpointPhases(): string[] {
  const dir = path.join(runDir, "learning");
  if (!fs.existsSync(dir)) return [];
  const suffix = `-${RUN_ID}.yaml`;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();
}

// ── The coverage audit (computed independently of the sweep bookkeeping) ─────

interface CoverageReport {
  /** Distinct checkpoint phases the phases_log demands (after mapping). */
  expected: CheckpointPhase[];
  /** Distinct checkpoint phases with an emitted file on disk. */
  emitted: string[];
  /** phases_log tokens that map to NO checkpoint phase (the silent-drop set). */
  unknownTokens: string[];
  /** Demanded phases with no emitted checkpoint file. */
  missing: string[];
  /** coverage == 100% AND no unknown tokens. */
  complete: boolean;
}

function auditCoverage(): CoverageReport {
  const raw = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
  const tokens = parsePhasesLogPhases(raw);

  const expected: CheckpointPhase[] = [];
  const unknownTokens: string[] = [];
  const seen = new Set<CheckpointPhase>();
  for (const tok of tokens) {
    const mapped = PHASE_TOKEN_TO_CHECKPOINT[tok];
    if (mapped === undefined) {
      unknownTokens.push(tok); // METRIC-1a: a dropped phase is recorded, never hidden
      continue;
    }
    if (!seen.has(mapped)) {
      seen.add(mapped);
      expected.push(mapped);
    }
  }

  const emitted = emittedCheckpointPhases();
  const emittedSet = new Set(emitted);
  const missing = expected.filter((p) => !emittedSet.has(p)).sort();

  return {
    expected: [...expected].sort() as CheckpointPhase[],
    emitted,
    unknownTokens,
    missing,
    // 100% coverage requires BOTH every demanded phase emitted AND zero silent drops.
    complete: missing.length === 0 && unknownTokens.length === 0,
  };
}

describe("phase_checkpoint_coverage = 100% (METRIC 1a)", () => {
  it("after the backstop sweep, mapped phases_log tokens == emitted checkpoint files (100% coverage)", () => {
    writeRunYaml([
      "phases_log:",
      "  - phase: ideate",
      "    at: 2026-06-21T00:00:00Z",
      "  - phase: plan",
      "    at: 2026-06-21T01:00:00Z",
      "  - phase: build",
      "    at: 2026-06-21T02:00:00Z",
    ]);

    // The model emitted the build checkpoint itself; the sweep backfills the rest.
    writeCheckpoint({
      runId: RUN_ID,
      phase: "development",
      evidenceRef: ".guild/runs/x/review.md",
      guildRoot: root,
    });
    const sweep: BackstopResult = runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    expect(sweep.errors).toEqual([]);

    const cov = auditCoverage();
    // ideate→ideation, plan→planning, build→development
    expect(cov.expected).toEqual(["development", "ideation", "planning"]);
    // Every demanded phase has an emitted checkpoint file — the two relations match.
    expect(cov.emitted).toEqual(cov.expected);
    expect(cov.missing).toEqual([]);
    expect(cov.unknownTokens).toEqual([]);
    expect(cov.complete).toBe(true);
  });

  it("checkpoint-native inline tokens reach 100% coverage too", () => {
    writeRunYaml([
      "phases_log:",
      "  - { phase: ideation, at: 2026-06-21, artifact: .guild/spec/x.md }",
      "  - { phase: planning, at: 2026-06-21, artifact: .guild/plan/x.md }",
      "  - { phase: development, at: 2026-06-21, artifact: .guild/runs/x/review.md }",
    ]);
    runLearningBackstop({ guildRoot: root, runId: RUN_ID });

    const cov = auditCoverage();
    expect(cov.expected).toEqual(["development", "ideation", "planning"]);
    expect(cov.emitted).toEqual(cov.expected);
    expect(cov.complete).toBe(true);
  });

  it("a duplicated phase token counts once and still reaches 100%", () => {
    writeRunYaml([
      "phases_log:",
      "  - phase: build",
      "    at: 2026-06-21T00:00:00Z",
      "  - phase: build",
      "    at: 2026-06-21T01:00:00Z",
    ]);
    runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    const cov = auditCoverage();
    expect(cov.expected).toEqual(["development"]);
    expect(cov.emitted).toEqual(["development"]);
    expect(cov.complete).toBe(true);
  });
});

describe("a silently-dropped phase is CAUGHT (METRIC 1a anti-vacuity — learning-backstop.ts:175)", () => {
  it("an unmapped phases_log token makes the coverage audit FAIL (unknownTokens > 0)", () => {
    writeRunYaml([
      "phases_log:",
      "  - phase: deploy", // NOT in PHASE_TOKEN_TO_CHECKPOINT
      "    at: 2026-06-21T00:00:00Z",
      "  - phase: build",
      "    at: 2026-06-21T01:00:00Z",
    ]);
    const sweep = runLearningBackstop({ guildRoot: root, runId: RUN_ID });

    // The sweep itself flags the unknown token rather than silently covering it.
    expect(sweep.unknownTokens).toEqual(["deploy"]);

    const cov = auditCoverage();
    // The known phase IS covered…
    expect(cov.expected).toEqual(["development"]);
    expect(cov.emitted).toEqual(["development"]);
    expect(cov.missing).toEqual([]);
    // …but the audit is NOT complete: the dropped `deploy` phase is surfaced,
    // so a phase the mapping forgets cannot masquerade as 100% covered.
    expect(cov.unknownTokens).toEqual(["deploy"]);
    expect(cov.complete).toBe(false);
  });

  it("proves the gate is non-vacuous: the SAME run.yaml with `deploy` removed passes 100%", () => {
    // Anti-vacuity twin of the previous case — a known-good control. The only
    // difference is the unmapped token; flipping it flips `complete`.
    writeRunYaml([
      "phases_log:",
      "  - phase: build",
      "    at: 2026-06-21T01:00:00Z",
    ]);
    runLearningBackstop({ guildRoot: root, runId: RUN_ID });
    const cov = auditCoverage();
    expect(cov.unknownTokens).toEqual([]);
    expect(cov.complete).toBe(true);
  });

  it("PHASE_TOKEN_TO_CHECKPOINT does NOT define a `deploy` mapping (the dropped token is genuinely unknown)", () => {
    // Guards the previous test from rotting: if someone adds a `deploy` mapping,
    // this assertion fails loudly so the anti-vacuity fixture is re-chosen.
    expect(PHASE_TOKEN_TO_CHECKPOINT["deploy"]).toBeUndefined();
  });
});
