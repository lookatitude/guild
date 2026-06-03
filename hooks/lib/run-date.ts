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
 * ## YAML-reader classification (U4 inventory)
 *
 * This file is a **bounded-legacy** hooks-side YAML reader:
 *   - `js-yaml` is not in the hooks package dependencies (and cannot easily be
 *     added without a separate bundling pass); the hook scripts run via `npx tsx`
 *     and the build uses per-file `esbuild`.
 *   - The read is intentionally narrow: a single top-level scalar field
 *     (`started_at`) from `run.yaml`, which is machine-authored by
 *     `scripts/lib/run-lifecycle.ts` in a known, stable format.
 *   - The pattern (`/^started_at:[ \t]*(.*)$/m`) mirrors the approach used in
 *     `scripts/lib/run-lifecycle.ts:readStartFacts()` (the authoritative reader
 *     on the scripts side — also bounded; not exported so hooks cannot reuse it
 *     directly).
 *   - This is NOT a general YAML parser. It reads exactly one field from one
 *     known file shape.
 *
 * If `js-yaml` is ever added to the hooks package (or `readStartFacts` is
 * exported from `scripts/lib/run-lifecycle.ts`), migrate this reader to reuse
 * that instead, and reclassify the inventory entry from `bounded-legacy` to
 * `shared-parser` / `reuse`.
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
 * YAML-reader note: uses a targeted field-extraction regex identical to
 * `scripts/lib/run-lifecycle.ts:readStartFacts()`. This is a bounded scalar
 * read — NOT a general YAML parser — justified by the absence of js-yaml in
 * the hooks package deps and the narrow, stable shape of run.yaml. See file
 * header for the full classification rationale.
 *
 * @param runDir  Absolute path to the run directory
 *                (e.g. `/path/to/.guild/runs/run-<id>/`).
 */
export function readRunStartedAt(runDir: string): Date | null {
  const runYamlPath = path.join(runDir, "run.yaml");
  try {
    if (!fs.existsSync(runYamlPath)) return null;
    const raw = fs.readFileSync(runYamlPath, "utf8");
    // Targeted field extraction — mirrors run-lifecycle.ts readStartFacts().
    // Matches a bare top-level `started_at: <value>` line (the run-lifecycle
    // writer always emits this as a bare YAML scalar on its own line).
    const m = raw.match(/^started_at:[ \t]*(.*)$/m);
    if (!m || !m[1] || m[1].trim() === "") return null;
    const d = new Date(m[1].trim());
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
