/**
 * hooks/lib/learning-backstop.ts
 *
 * G-7 (SC-3) — Stop-hook learning-checkpoint BACKSTOP.
 *
 * Design intent: the per-phase `guild.learning_checkpoint.v1` is supposed to
 * be "automatic", but its firing is model-remembered (the skill calls
 * emit-learning-checkpoint at each phase boundary). This backstop makes the
 * guarantee deterministic: at Stop, every phase recorded in the run's
 * `run.yaml` `phases_log` that has NO `learning/<phase>-<run-id>.yaml` gets
 * an all-`none` 12-target checkpoint via the existing writeCheckpoint(),
 * marked `backstop: true` so analytics can tell a guaranteed no-op record
 * from a model-emitted verdict.
 *
 * Lenient run.yaml parsing — both phases_log shapes that exist on disk:
 *   block form (run-lifecycle appendPhase):
 *     phases_log:
 *       - phase: build
 *         at: 2026-06-10T01:00:00Z
 *   inline flow form (operator/hand-written runs):
 *     phases_log:
 *       - { phase: ideation, at: 2026-06-10, artifact: ... }
 *
 * Phase-token vocabulary join: phases_log carries CANONICAL lifecycle tokens
 * ({init,ideate,plan,build,qa,ops} — scripts/lib/run-lifecycle.ts), while the
 * checkpoint contract uses the 7-value VALID_PHASES set
 * ({init,ideation,planning,development,quality,operations,reflection} —
 * emit-learning-checkpoint.ts). PHASE_TOKEN_TO_CHECKPOINT maps the former to
 * the latter and passes already-checkpoint-shaped tokens through unchanged.
 * Unknown tokens are skipped (reported, never thrown).
 *
 * Idempotent: an existing `learning/<phase>-<run-id>.yaml` (model-emitted OR
 * a previous backstop) is never overwritten. Fail-open: per-phase failures
 * are collected, never thrown.
 *
 * Entry: hooks/learning-backstop.ts (Stop event — wired AFTER maybe-reflect
 * and run-trace-close in hooks/hooks.json).
 * Tests: hooks/__tests__/learning-backstop.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  writeCheckpoint,
  type CheckpointPhase,
} from "../emit-learning-checkpoint.js";

// ── Phase-token mapping ─────────────────────────────────────────────────────

/**
 * run.yaml phases_log token → checkpoint phase. Canonical lifecycle tokens
 * map onto the checkpoint vocabulary; checkpoint-native tokens pass through.
 */
export const PHASE_TOKEN_TO_CHECKPOINT: Record<string, CheckpointPhase> = {
  // canonical lifecycle tokens (CANONICAL_PHASES, scripts/lib/run-lifecycle.ts)
  init: "init",
  ideate: "ideation",
  plan: "planning",
  build: "development",
  qa: "quality",
  ops: "operations",
  // checkpoint-native tokens (VALID_PHASES) — identity pass-through
  ideation: "ideation",
  planning: "planning",
  development: "development",
  quality: "quality",
  operations: "operations",
  reflection: "reflection",
};

// ── Lenient phases_log parse ────────────────────────────────────────────────

/** Strip surrounding single/double quotes from a YAML scalar token. */
function unquote(token: string): string {
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    return token.slice(1, -1);
  }
  return token;
}

/**
 * Extract the ordered, de-duplicated list of phase tokens recorded in
 * run.yaml's `phases_log`. Lenient line-scan (no YAML dependency — same
 * posture as scripts/lib/team-file.ts readActivePhase):
 *   - inline flow item:  `- { phase: ideation, at: ..., ... }`
 *   - block item:        `  - phase: build`
 * Lines outside the phases_log block cannot false-positive: both regexes
 * require a `- ` list-item marker immediately followed by `phase:` (the
 * top-level `phase:` scalar has no list marker).
 */
export function parsePhasesLogPhases(runYamlRaw: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const line of runYamlRaw.split("\n")) {
    // Inline flow form first: - { phase: <tok>, ... }
    let m = line.match(/^\s*-\s*\{\s*phase:\s*([^,}\s]+)/);
    if (!m) {
      // Block form: - phase: <tok>
      m = line.match(/^\s*-\s+phase:\s*([^\s#]+)\s*(?:#.*)?$/);
    }
    if (m) {
      const token = unquote(m[1]);
      if (token.length > 0 && !seen.has(token)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

// ── Backstop sweep ──────────────────────────────────────────────────────────

export interface BackstopResult {
  /** Checkpoint phases for which a backstop record was written this sweep. */
  written: CheckpointPhase[];
  /** Checkpoint phases skipped because learning/<phase>-<runId>.yaml exists. */
  skippedExisting: CheckpointPhase[];
  /** phases_log tokens that map to no known checkpoint phase (skipped). */
  unknownTokens: string[];
  /** Per-phase write failures (fail-open — collected, never thrown). */
  errors: string[];
}

const EMPTY_RESULT: BackstopResult = {
  written: [],
  skippedExisting: [],
  unknownTokens: [],
  errors: [],
};

export interface RunLearningBackstopOpts {
  /** The repo root that owns .guild/ (resolveGuildRoot output). */
  guildRoot: string;
  /** The run to sweep. */
  runId: string;
  /** Override for `<guildRoot>/.guild/runs/<runId>` (tests). */
  runDir?: string;
}

/**
 * Sweep the run's phases_log and write an all-`none` `backstop: true`
 * checkpoint for every phase that lacks `learning/<phase>-<runId>.yaml`.
 *
 * No run.yaml / empty phases_log → no-op (a run that never recorded a phase
 * owes no checkpoint). Never throws.
 */
export function runLearningBackstop(opts: RunLearningBackstopOpts): BackstopResult {
  try {
    const runDir =
      opts.runDir ?? path.join(opts.guildRoot, ".guild", "runs", opts.runId);

    let raw: string;
    try {
      raw = fs.readFileSync(path.join(runDir, "run.yaml"), "utf8");
    } catch {
      return { ...EMPTY_RESULT }; // no run.yaml → nothing to backstop
    }

    const result: BackstopResult = {
      written: [],
      skippedExisting: [],
      unknownTokens: [],
      errors: [],
    };

    const tokens = parsePhasesLogPhases(raw);
    const phasesSeen = new Set<CheckpointPhase>();
    for (const token of tokens) {
      const phase = PHASE_TOKEN_TO_CHECKPOINT[token];
      if (phase === undefined) {
        result.unknownTokens.push(token);
        continue;
      }
      if (phasesSeen.has(phase)) continue; // two tokens mapping to one phase
      phasesSeen.add(phase);

      const checkpointFile = path.join(
        runDir,
        "learning",
        `${phase}-${opts.runId}.yaml`
      );
      if (fs.existsSync(checkpointFile)) {
        result.skippedExisting.push(phase);
        continue;
      }

      try {
        // All-`none` 12-target verdict (writeCheckpoint's default decisions)
        // + the additive backstop marker. evidenceRef points at the source
        // of truth the sweep derived the phase from.
        writeCheckpoint({
          runId: opts.runId,
          phase,
          evidenceRef: `backstop:.guild/runs/${opts.runId}/run.yaml#phases_log`,
          guildRoot: opts.guildRoot,
          backstop: true,
        });
        result.written.push(phase);
      } catch (err) {
        result.errors.push(
          `${phase}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return result;
  } catch (err) {
    return {
      ...EMPTY_RESULT,
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
