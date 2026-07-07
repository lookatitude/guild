/**
 * scripts/lib/telemetry-redirect.ts
 *
 * Full-class telemetry export redirect map (v2.x - FDC-15).
 * Implements the durable-write rule from 08-dispatch-execution.md section 6
 * ("Worktree redirect - the durable-write rule").
 *
 * When a lane runs in an ephemeral git worktree (parallel-write isolation,
 * FDC-15), EVERY durable Guild-owned class must be written to the MAIN repo
 * root's .guild/ directory, never the worktree's - so nothing is lost when the
 * worktree is cleaned up.
 *
 * The SHIPPED redirect is graph-family-only (scripts/learn/lib/paths.ts
 * resolves the main root via "git rev-parse --git-common-dir"); the hook-side
 * writers anchor at the nearest .git entry (hooks/lib/guild-root.ts).
 *
 * This module adds the FULL-CLASS redirect map: for every durable class listed
 * in edge-cases.md, section Concurrency, ephemeral-worktree row,
 * resolveTelemetryTarget returns the canonical .guild/-relative path and whether
 * the write MUST be anchored to the main repo root (requires worktree-redirect).
 *
 * The feature is DEFAULT-OFF and inert until wired: the redirect logic activates
 * only when config.worktree_redirect_enabled is true. All callers that do not
 * set this flag get the shipped primary path unchanged.
 *
 * Pure module: NO Date.now() / Math.random() inside exported functions.
 * The caller supplies timestamps/ids. A CLI block guarded by
 * "if (require.main === module)" may use Date.now().
 *
 * Usage:
 *   import { resolveTelemetryTarget, DURABLE_EVENT_CLASSES } from './lib/telemetry-redirect'
 *   const result = resolveTelemetryTarget('trace_events', config)
 *   // result.target.partialPath - path relative to .guild/ root
 *   // result.target.mainRootRequired - true when this class must land at the main repo root
 *   // result.target.redirectActive - true when redirect is active (config.worktree_redirect_enabled)
 */

// ---------------------------------------------------------------------------
// Event class enumeration - every durable Guild-owned class
// (edge-cases.md section Concurrency, ephemeral-worktree row +
//  08-dispatch-execution.md section 6)
// ---------------------------------------------------------------------------

/**
 * The closed set of durable Guild-owned event classes.
 *
 * Ordered from highest-criticality (provenance, run_records) to supporting
 * metadata (skill_instances, reflections).
 *
 * Tuple order is significant: it defines the canonical enum order.
 */
export const DURABLE_EVENT_CLASSES = [
  "knowledge_graph",      // .guild/indexes/knowledge-graph.json   (graph-family - shipped in paths.ts)
  "knowledge_links",      // .guild/indexes/knowledge-links.json   (graph-family - shipped in paths.ts)
  "codebase_map",         // .guild/indexes/codebase-map.json      (graph-family - shipped in paths.ts)
  "provenance",           // .guild/runs/<run-id>/provenance.json  (run-close terminal record)
  "run_records",          // .guild/runs/                          (all run artifacts)
  "trace_events",         // .guild/runs/<run-id>/logs/            (v1.4-events.jsonl per-run)
  "learning",             // .guild/learning/                      (per-phase learning artifacts)
  "initiatives_registry", // .guild/indexes/initiatives-registry.yaml
  "skill_instances",      // .guild/skill-versions/                (project skill/agent instances)
  "reflections",          // .guild/reflections/                   (post-run reflection files)
] as const;

/** Union of all durable event class names. */
export type DurableEventClass = (typeof DURABLE_EVENT_CLASSES)[number];

/** Whether a given string is a recognized DurableEventClass. */
export function isDurableEventClass(s: string): s is DurableEventClass {
  return (DURABLE_EVENT_CLASSES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/** Validation result shape (mirrors validator pattern in neighboring lib modules). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that an event class string is a member of the closed DURABLE_EVENT_CLASSES set.
 *
 * Returns { valid: true, errors: [] } on success,
 * { valid: false, errors: [...] } with a descriptive message on failure.
 */
export function validateEventClass(eventClass: string): ValidationResult {
  if (isDurableEventClass(eventClass)) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: [
      `Unknown event class "${eventClass}". ` +
        `Valid classes: ${DURABLE_EVENT_CLASSES.join(", ")}.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Primary path map - canonical .guild/-relative paths for each class
// ---------------------------------------------------------------------------

/**
 * The canonical .guild/-relative partial paths for each durable event class.
 *
 * Notes:
 *   - Paths are relative to the .guild/ directory, NOT to the repo root.
 *   - Paths with a run_id segment use the placeholder "<run-id>" - callers
 *     must substitute the actual run id before use.
 *   - The graph-family classes (knowledge_graph, knowledge_links, codebase_map)
 *     already have a shipped redirect in learn/lib/paths.ts; they are
 *     included here so the full-class map is complete and callers can enumerate
 *     all durable classes uniformly.
 *   - The placeholder "<run-id>" uses angle brackets, not a glob, to avoid the
 *     glob-pattern prohibition on runs/* paths.
 */
export const DURABLE_CLASS_PRIMARY_PATHS: Readonly<
  Record<DurableEventClass, string>
> = {
  knowledge_graph:      "indexes/knowledge-graph.json",
  knowledge_links:      "indexes/knowledge-links.json",
  codebase_map:         "indexes/codebase-map.json",
  provenance:           "runs/<run-id>/provenance.json",
  run_records:          "runs/",
  trace_events:         "runs/<run-id>/logs/v1.4-events.jsonl",
  learning:             "learning/",
  initiatives_registry: "indexes/initiatives-registry.yaml",
  skill_instances:      "skill-versions/",
  reflections:          "reflections/",
} as const;

/**
 * Which classes REQUIRE anchoring to the main repo root when in a worktree.
 *
 * All durable classes require main-root anchoring - the worktree's ephemeral
 * .guild/ must never hold durable artifacts. This set is the full closure;
 * it is kept explicit (rather than "all of them") so future non-durable
 * telemetry classes can be added to the map without implicitly requiring redirect.
 */
export const MAIN_ROOT_REQUIRED_CLASSES: ReadonlySet<DurableEventClass> =
  new Set<DurableEventClass>(DURABLE_EVENT_CLASSES);

// ---------------------------------------------------------------------------
// Config surface (read defensively - safe default when absent)
// ---------------------------------------------------------------------------

/**
 * The subset of the Guild config that this module reads.
 *
 * All fields are optional: safe defaults apply when absent so this module
 * composes with any partial config (including the shipped ResolvedConfig which
 * does not yet include the worktree_redirect_enabled key).
 *
 * The config key worktree_redirect_enabled must be added to the shared
 * settings schema (read-guild-config.ts / settings-resolver.ts) when the
 * full-class redirect is wired into a production path. Until then this module
 * reads it defensively (default: false).
 */
export interface TelemetryRedirectConfig {
  /**
   * When true, the full-class worktree redirect is active: every durable class
   * is anchored to the main repo root, not the worktree root.
   *
   * DEFAULT: false (feature is default-off / dormant until wired).
   */
  worktree_redirect_enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Resolved target (return type)
// ---------------------------------------------------------------------------

/** The resolved target for a telemetry event of a given class. */
export interface TelemetryTarget {
  /**
   * The canonical partial path for this event class, relative to the .guild/
   * directory (main repo root's .guild/ when redirectActive is true).
   */
  partialPath: string;

  /**
   * Whether this class MUST be anchored to the main repo root (as opposed to
   * the worktree's local .guild/).
   *
   * Always true for every class in DURABLE_EVENT_CLASSES. Included here so
   * callers can branch on this field without re-checking the closed set.
   */
  mainRootRequired: boolean;

  /**
   * Whether the worktree redirect is currently active (i.e., the caller should
   * resolve the main repo root and anchor writes there).
   *
   * True iff config.worktree_redirect_enabled is true.
   * False by default (default-off; inert until wired).
   */
  redirectActive: boolean;

  /**
   * The original event class that was resolved. Included for caller convenience
   * (e.g., logging, structured telemetry records).
   */
  eventClass: DurableEventClass;
}

/**
 * Result of resolving an unknown or potentially-malformed event class.
 *
 * valid is false when the event class is not in DURABLE_EVENT_CLASSES.
 * On invalid input the target falls back to the trace_events primary path
 * (the generic telemetry sink) so callers can always safely write the record.
 */
export interface TelemetryTargetResult {
  target: TelemetryTarget;
  /** Whether the event class was recognized. When false, target reflects
   * the safe fallback (trace_events primary path); callers should log a warning. */
  valid: boolean;
  /** Human-readable validation message (empty string when valid). */
  message: string;
}

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the write target for a telemetry event of a given durable class.
 *
 * This is the central routing function for the full-class worktree redirect.
 * It is PURE - no I/O, no Date.now(), no randomness. The caller is responsible
 * for resolving the actual main repo root path (via resolveMainRepoRoot from
 * learn/lib/paths.ts or equivalent) and for substituting the "<run-id>"
 * placeholder in partialPath when the class includes one.
 *
 * @param eventClass  A DurableEventClass string (or any string - malformed
 *                    inputs fall back to the trace_events path and set
 *                    valid=false in the result).
 * @param config      The Guild config (any partial superset of
 *                    TelemetryRedirectConfig). Absent keys use safe defaults.
 *
 * @returns TelemetryTargetResult with the resolved path, redirect status, and
 *          validation info.
 */
export function resolveTelemetryTarget(
  eventClass: string,
  config: TelemetryRedirectConfig,
): TelemetryTargetResult {
  const redirectActive = config.worktree_redirect_enabled === true;

  if (!isDurableEventClass(eventClass)) {
    // Unknown event class - fall back to the generic trace_events sink.
    const fallback: TelemetryTarget = {
      eventClass: "trace_events",
      partialPath: DURABLE_CLASS_PRIMARY_PATHS["trace_events"],
      mainRootRequired: true,
      redirectActive,
    };
    return {
      target: fallback,
      valid: false,
      message:
        `Unknown event class "${eventClass}"; falling back to trace_events path. ` +
        `Valid classes: ${DURABLE_EVENT_CLASSES.join(", ")}.`,
    };
  }

  const target: TelemetryTarget = {
    eventClass,
    partialPath: DURABLE_CLASS_PRIMARY_PATHS[eventClass],
    mainRootRequired: MAIN_ROOT_REQUIRED_CLASSES.has(eventClass),
    redirectActive,
  };

  return { target, valid: true, message: "" };
}

// ---------------------------------------------------------------------------
// Batch resolver (convenience - resolves all classes at once)
// ---------------------------------------------------------------------------

/**
 * Resolve all durable event classes at once against the given config.
 *
 * Returns a map from DurableEventClass to TelemetryTarget for every class in
 * DURABLE_EVENT_CLASSES. All entries are valid by construction (the input set
 * is the closed enum).
 *
 * Useful for pre-computing the full redirect table at worktree-launch time.
 */
export function resolveAllTelemetryTargets(
  config: TelemetryRedirectConfig,
): Record<DurableEventClass, TelemetryTarget> {
  const result = {} as Record<DurableEventClass, TelemetryTarget>;
  for (const cls of DURABLE_EVENT_CLASSES) {
    result[cls] = resolveTelemetryTarget(cls, config).target;
  }
  return result;
}

// ---------------------------------------------------------------------------
// CLI (if run directly - for diagnostics only; not a production path)
// ---------------------------------------------------------------------------

if (require.main === module) {
  const eventClass = process.argv[2] ?? "";
  const redirectEnabled = process.argv.includes("--redirect");
  const config: TelemetryRedirectConfig = { worktree_redirect_enabled: redirectEnabled };

  if (!eventClass || eventClass === "--all") {
    // Print the full redirect table.
    const table = resolveAllTelemetryTargets(config);
    const at = new Date().toISOString();
    process.stdout.write(
      JSON.stringify({ at, redirect_active: redirectEnabled, table }, null, 2) + "\n",
    );
  } else {
    const result = resolveTelemetryTarget(eventClass, config);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.valid) process.exit(1);
  }
}
