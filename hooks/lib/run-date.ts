/**
 * hooks/lib/run-date.ts
 *
 * Run-date helpers for the OD-4 discriminator (U3 runtime hook gating).
 *
 * ## Purpose
 *
 * Reads `started_at` from a run manifest (`run.yaml`) so that `task-completed.ts`
 * (and any future hook that needs the discriminator) share ONE reader rather
 * than each inlining a regex.
 *
 * ## YAML-reader classification (shared-parser / reuse)
 *
 * This file uses the ONE shared js-yaml-backed parser
 * (`scripts/lib/frontmatter.ts`, the comms-format OD-3 compliant reader) to read
 * `started_at` from `run.yaml`:
 *   - The hooks build is `esbuild --bundle`, which inlines the cross-package
 *     import of `../../scripts/lib/frontmatter` and resolves `js-yaml` from
 *     `scripts/node_modules`, so the parser ships in the bundled hook dist with
 *     no hooks-side dependency change.
 *   - `run.yaml` is a fence-less pure-YAML document (no `---` frontmatter
 *     block), and `started_at` is a single top-level scalar, so it is read with
 *     `readScalarField` — the shared ROBUST single-line reader — rather than a
 *     whole-document `parseYaml`. `readScalarField` reads the first column-0
 *     `started_at:` line, trims, and strips one pair of surrounding quotes —
 *     byte-for-byte the shape the prior line-anchored `started_at` regex reader
 *     returned (and which `new Date()` then consumes).
 *   - Because it never `yaml.load`s the surrounding block, it is sibling-
 *     tolerant: a hypothetically YAML-hostile neighbouring field does not
 *     prevent the `started_at` read — preserving the prior single-line reader's
 *     behaviour exactly, with no whole-doc-parse delta.
 *
 * ## Policy anchor
 *
 * `POLICY_EFFECTIVE_DATE` is the OD-4 enforcement boundary, canonical at:
 *   docs/knowledge/decisions/communication-format-policy.md §"policy_effective_date"
 * This is the SINGLE named constant for hooks/. U5 (lint) and U7 (negative
 * checks) read from the same policy doc. Changing the date means amending the
 * policy heading, never an ad-hoc edit here.
 *
 * Runner: imported by hooks/agent-team/task-completed.ts (tsx / esbuild dist).
 * Tests:  hooks/lib/__tests__/run-date.test.ts
 */

import * as fs from "fs";
import * as path from "path";

import { readScalarField } from "../../scripts/lib/frontmatter";

// ── Policy constant ────────────────────────────────────────────────────────

/**
 * OD-4 enforcement boundary.
 *
 * Canonical source: docs/knowledge/decisions/communication-format-policy.md
 *   §"policy_effective_date" (`policy_effective_date: 2026-06-03`)
 *
 * A runtime receipt for a run whose `run.yaml.started_at` is >= this date is
 * IN-SCOPE for envelope enforcement. Earlier runs are grandfathered.
 */
export const POLICY_EFFECTIVE_DATE = new Date("2026-06-03T00:00:00Z");

// ── Run-date reader ────────────────────────────────────────────────────────

/**
 * Read `started_at` from a run manifest and return it as a `Date`.
 *
 * Reads `run.yaml` at `<runDir>/run.yaml`, extracts the top-level
 * `started_at` scalar (format: ISO 8601, e.g. `2026-06-03T00:00:00Z`),
 * and returns a `Date` object.
 *
 * Returns `null` when:
 *   - `run.yaml` does not exist at the given path
 *   - the file cannot be read (permissions, I/O error)
 *   - the `started_at` field is absent or empty
 *   - the field value is not a valid ISO date string
 *
 * Callers MUST treat a `null` return as **indeterminate / fail-open**:
 * never enforce the policy on a run whose date cannot be confirmed.
 *
 * YAML-reader note: reads the top-level `started_at` scalar from `run.yaml` (a
 * fence-less pure-YAML document) with the shared ROBUST single-line reader
 * `readScalarField` — line-anchored, trimmed, quote-stripped, sibling-tolerant —
 * the same value the prior line-anchored `started_at` regex fed to `new Date()`.
 * See file header for the full classification rationale.
 *
 * @param runDir  Absolute path to the run directory
 *                (e.g. `/path/to/.guild/runs/run-<id>/`).
 */
export function readRunStartedAt(runDir: string): Date | null {
  const runYamlPath = path.join(runDir, "run.yaml");
  try {
    if (!fs.existsSync(runYamlPath)) return null;
    const raw = fs.readFileSync(runYamlPath, "utf8");
    // run.yaml is a whole YAML document (no `---` frontmatter fences) and
    // started_at is a single top-level scalar — read it robustly (sibling-
    // tolerant, no whole-block parse). Returns undefined when absent/empty.
    const value = readScalarField(raw, "started_at");
    if (value === undefined) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ── OD-4 discriminator ─────────────────────────────────────────────────────

/** OD-4 verdict for a single runtime receipt. */
export type RunScopeResult =
  | { inscope: true }
  | { inscope: false; reason: "grandfathered" }
  | { inscope: false; reason: "indeterminate"; warn: string };

/**
 * Apply the OD-4 discriminator (arm 2: run-date arm) to a runtime receipt.
 *
 * Policy ref: communication-format-policy.md §"OD-4 discriminator":
 *   A receipt under `.guild/runs/<run-id>/` is in-scope iff the run's
 *   `run.yaml.started_at` is >= `POLICY_EFFECTIVE_DATE`.
 *
 * Verdicts:
 *   - `{ inscope: true }` — run date >= effective date → fail-closed.
 *   - `{ inscope: false, reason: "grandfathered" }` — run date < effective
 *     date → envelope optional, lenient behavior preserved.
 *   - `{ inscope: false, reason: "indeterminate", warn }` — date cannot be
 *     determined (no run.yaml / missing field / unparseable value) →
 *     FAIL-OPEN: treat as lenient and log the warn string.
 *
 * @param runDir  Absolute path to the run directory.
 * @param taskId  Task ID (for diagnostic messages only).
 */
export function isRunInScope(runDir: string, taskId: string): RunScopeResult {
  const runDate = readRunStartedAt(runDir);
  if (runDate === null) {
    return {
      inscope: false,
      reason: "indeterminate",
      warn:
        `[task-completed] WARN: cannot determine run date for task "${taskId}" ` +
        `(no run.yaml or missing/unparseable started_at at ${runDir}/run.yaml) — ` +
        `fail-open to lenient (envelope optional for indeterminate-date runs).`,
    };
  }
  if (runDate >= POLICY_EFFECTIVE_DATE) {
    return { inscope: true };
  }
  return { inscope: false, reason: "grandfathered" };
}
