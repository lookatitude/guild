/**
 * scripts/lib/trace-replay.ts
 *
 * Data builders for the two deferred [v2.x] MCP replay tools:
 *   - trace_replay_timeline  (G-2 in .guild/spec/v2-gap-closure.md)
 *   - trace_context_replay   (G-2, same tracker)
 *
 * Neither function performs any I/O. Both are PURE over already-parsed
 * guild.trace_event.v1 (and the additive .v2) rows plus the
 * guild.context_refs.v1 JSON shape. The callers (the deferred MCP tools,
 * when registered) read the files and pass the parsed structures in.
 *
 * Contract boundary: frozen in v2 so replay tools can land without a schema
 * break. Bind by pointer:
 *   - event schema:    docs/v2/12-observability.md §Replay & diagnosis
 *   - context-refs:    docs/knowledge/observability/run-replay-and-evolution-workflows.md
 *                      §Run Record Contract (guild.context_refs.v1)
 *
 * Determinism contract: no Date.now() / Math.random() inside exported lib
 * functions. Timestamps and ids come from the parsed events; the caller
 * supplies any wall-clock or id values it needs.
 *
 * Default-off: these builders are dormant until the deferred MCP tools are
 * registered. No existing hook or script imports this module.
 */

// ── Event types (lenient superset — v1 frozen + v2 additive) ─────────────────

/**
 * Loose-typed parsed row from guild.trace_event.v1 (and .v2 additive fields).
 * Only `ts`, `event`, and `run_id` are required by the v1 contract. All other
 * fields may be absent — the replay builders never require absent fields.
 */
export interface TraceEventRow {
  /** RFC-3339 UTC timestamp. Required by v1. */
  ts: string;
  /** Event discriminator. Required by v1. */
  event: string;
  /** Run id. Required by v1 for structured events; absent on legacy ndjson rows. */
  run_id?: string;
  /** Lane id (present on lane-scoped events). */
  lane_id?: string;
  /** v2 span_id — deterministically generated at write time by the hook. */
  span_id?: string;
  /** v2 parent_span_id — threaded via GUILD_PARENT_SPAN_ID by the orchestrator. */
  parent_span_id?: string;
  /** v2 tier. */
  tier?: string;
  /** v2 model. */
  model?: string;
  /** v2 tokens block. Present only on LLM-call events. */
  tokens?: {
    input?: number;
    output?: number;
    cached?: number;
    cost_usd?: number;
  };
  /** Catch-all for all other frozen v1 fields and future v2 additions. */
  [key: string]: unknown;
}

// ── context-refs schema (guild.context_refs.v1) ───────────────────────────────

/** A single source file entry inside a context bundle. */
export interface ContextSourceRef {
  /** Relative path (from the repo root) of the source wiki / doc page. */
  path: string;
  /** SHA-256 hex of the source file at bundle-creation time. */
  sha256: string;
}

/** A single context bundle entry in context-refs.json. */
export interface ContextBundle {
  /** Task id the bundle was assembled for. */
  task_id: string;
  /** Specialist name. */
  specialist: string;
  /** Relative path to the bundle markdown file. */
  path: string;
  /** SHA-256 hex of the bundle file itself. */
  sha256: string;
  /** Source files included in the bundle. */
  source_refs: ContextSourceRef[];
}

/**
 * Parsed guild.context_refs.v1 file.
 * Schema frozen in v2 (docs/v2/12-observability.md §context-refs.json).
 */
export interface ContextRefs {
  schema_version: "guild.context_refs.v1";
  run_id: string;
  bundles: ContextBundle[];
}

// ── Timeline builder — trace_replay_timeline ─────────────────────────────────

/**
 * Classification of a drift condition discovered by context replay
 * when comparing bundle source hashes against current wiki.
 */
export type DriftKind = "missing" | "changed" | "superseded" | "stale" | "ok";

/** A single entry in the ordered replay timeline. */
export interface TimelineEntry {
  /** Stable position in source-append order (0-based). */
  index: number;
  /** RFC-3339 UTC timestamp from the event. */
  ts: string;
  /** Event discriminator from the parsed row. */
  event: string;
  /** Lane id when present. */
  lane_id: string | undefined;
  /** v2 span_id when present. */
  span_id: string | undefined;
  /** v2 parent_span_id when present — builds the span tree. */
  parent_span_id: string | undefined;
  /** v2 tier when present. */
  tier: string | undefined;
  /** v2 model when present. */
  model: string | undefined;
  /**
   * v2 tokens block — present only on LLM-call events that carried it.
   * Undefined = not an LLM-call event or token data was not recorded.
   */
  tokens:
    | {
        input?: number;
        output?: number;
        cached?: number;
        cost_usd?: number;
      }
    | undefined;
  /** The full raw row for callers that need non-promoted fields. */
  raw: TraceEventRow;
}

/**
 * Aggregated cost / token totals derived from a set of timeline entries.
 * All numeric fields default to 0 when no matching events were found.
 */
export interface CostBreakdown {
  /** Total LLM input tokens across all entries. */
  total_input_tokens: number;
  /** Total LLM output tokens across all entries. */
  total_output_tokens: number;
  /** Total LLM cached tokens across all entries. */
  total_cached_tokens: number;
  /** Total LLM cost in USD across all entries. */
  total_cost_usd: number;
  /** Per-tier breakdown. Keys are tier strings; values are the same shape. */
  by_tier: Record<
    string,
    {
      input: number;
      output: number;
      cached: number;
      cost_usd: number;
    }
  >;
}

/** Output of buildReplayTimeline. */
export interface ReplayTimeline {
  /**
   * Source-append-ordered list of all parseable events.
   * The v1.4 JSONL spec (docs/v2/12-observability.md) treats append-order
   * as the primary key; ts is a tie-breaker for same-millisecond events
   * from parallel processes. The timeline preserves that order verbatim.
   */
  entries: TimelineEntry[];
  /** Aggregate cost/token breakdown over the whole timeline. */
  cost: CostBreakdown;
  /** Total number of events (includes events with no tokens). */
  event_count: number;
  /**
   * Distinct lane ids seen in the timeline, sorted alphabetically.
   * Empty array when no lane-scoped events were present.
   */
  lanes: string[];
  /**
   * True when every event row carried a run_id and all run_ids were
   * identical. Callers use this to detect a mixed-run JSONL.
   */
  single_run: boolean;
  /** The run_id seen across events (or undefined when mixed / absent). */
  run_id: string | undefined;
}

/**
 * Build an ordered replay timeline + cost breakdown from a list of parsed
 * guild.trace_event.v1 (or .v2) rows.
 *
 * Pure: no I/O, no Date.now, no Math.random. The caller reads
 * `.guild/runs/<run-id>/logs/v1.4-events.jsonl` (primary) or
 * `.guild/runs/<run-id>/events.ndjson` (legacy fallback), parses each
 * line as JSON, and passes the array here.
 *
 * Contract guarantees (tested):
 *   - Returns an empty timeline for an empty input array.
 *   - Preserves input order verbatim (index === position in input array).
 *   - Each entry.index is its 0-based position in entries[].
 *   - cost totals are the correct sum of tokens across all entries.
 *   - by_tier groups are summed correctly per tier key.
 *   - lanes is deduplicated and sorted alphabetically.
 *   - single_run is true iff all run_ids are identical non-empty strings.
 *   - Rows with missing / malformed ts are included (ts preserved as-is).
 *   - Rows with no tokens contribute 0 to all cost totals.
 *
 * @param events  Parsed rows from the canonical v1.4-events.jsonl (or
 *                events.ndjson). Malformed JSON lines must be filtered by
 *                the caller before passing here.
 */
export function buildReplayTimeline(events: TraceEventRow[]): ReplayTimeline {
  const entries: TimelineEntry[] = [];
  const cost: CostBreakdown = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cached_tokens: 0,
    total_cost_usd: 0,
    by_tier: {},
  };
  const laneSet = new Set<string>();
  const runIds = new Set<string>();

  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    if (!row) continue;

    const ts = typeof row.ts === "string" ? row.ts : "";
    const event = typeof row.event === "string" ? row.event : "";
    const lane_id =
      typeof row.lane_id === "string" && row.lane_id.length > 0
        ? row.lane_id
        : undefined;
    const span_id =
      typeof row.span_id === "string" && row.span_id.length > 0
        ? row.span_id
        : undefined;
    const parent_span_id =
      typeof row.parent_span_id === "string" && row.parent_span_id.length > 0
        ? row.parent_span_id
        : undefined;
    const tier =
      typeof row.tier === "string" && row.tier.length > 0 ? row.tier : undefined;
    const model =
      typeof row.model === "string" && row.model.length > 0 ? row.model : undefined;
    const tokens =
      row.tokens !== null &&
      typeof row.tokens === "object" &&
      !Array.isArray(row.tokens)
        ? (row.tokens as TraceEventRow["tokens"])
        : undefined;

    // Accumulate cost totals.
    if (tokens !== undefined) {
      const input = typeof tokens.input === "number" && isFinite(tokens.input) ? tokens.input : 0;
      const output = typeof tokens.output === "number" && isFinite(tokens.output) ? tokens.output : 0;
      const cached = typeof tokens.cached === "number" && isFinite(tokens.cached) ? tokens.cached : 0;
      const costUsd =
        typeof tokens.cost_usd === "number" && isFinite(tokens.cost_usd)
          ? tokens.cost_usd
          : 0;
      cost.total_input_tokens += input;
      cost.total_output_tokens += output;
      cost.total_cached_tokens += cached;
      cost.total_cost_usd += costUsd;

      if (tier !== undefined) {
        if (!cost.by_tier[tier]) {
          cost.by_tier[tier] = { input: 0, output: 0, cached: 0, cost_usd: 0 };
        }
        const bucket = cost.by_tier[tier]!;
        bucket.input += input;
        bucket.output += output;
        bucket.cached += cached;
        bucket.cost_usd += costUsd;
      }
    }

    // Track lane ids and run ids.
    if (lane_id !== undefined) laneSet.add(lane_id);
    if (typeof row.run_id === "string" && row.run_id.length > 0) {
      runIds.add(row.run_id);
    }

    entries.push({
      index: i,
      ts,
      event,
      lane_id,
      span_id,
      parent_span_id,
      tier,
      model,
      tokens,
      raw: row,
    });
  }

  const lanes = Array.from(laneSet).sort();
  const single_run = runIds.size === 1;
  const run_id = runIds.size === 1 ? Array.from(runIds)[0] : undefined;

  return {
    entries,
    cost,
    event_count: entries.length,
    lanes,
    single_run,
    run_id,
  };
}

// ── Context replay builder — trace_context_replay ─────────────────────────────

/**
 * Drift status of a single source ref compared against the current wiki.
 *
 * "ok"          — the file exists and its sha256 matches.
 * "changed"     — the file exists but its sha256 differs.
 * "missing"     — the file does not exist at the recorded path.
 * "superseded"  — the file no longer exists but a newer version is present
 *                 (caller must supply the superseded-detection logic; the
 *                 builder classifies as "superseded" only when the caller's
 *                 currentSha map contains a superseded marker).
 * "stale"       — caller signals the content is outdated without a direct
 *                 sha mismatch (e.g. older than a time threshold).
 */
export interface SourceRefDrift {
  /** Relative path of the source file (from context-refs.json). */
  path: string;
  /** SHA-256 recorded at bundle-creation time. */
  recorded_sha256: string;
  /** Drift classification. */
  drift: DriftKind;
  /** Current SHA-256 as supplied by the caller, or undefined when not available. */
  current_sha256: string | undefined;
}

/** Context replay result for a single context bundle. */
export interface BundleContextReplay {
  task_id: string;
  specialist: string;
  /** Relative path of the bundle file. */
  bundle_path: string;
  /** SHA-256 of the bundle itself at creation time. */
  bundle_sha256: string;
  /**
   * True when the bundle file was present and its sha256 matched
   * `current_sha_map[bundle_path]` (when the caller supplies a sha map).
   * True by default when the caller passes no sha map (cannot verify).
   */
  bundle_intact: boolean;
  /** Per-source-ref drift analysis. */
  source_drifts: SourceRefDrift[];
  /**
   * Summary drift classification for this whole bundle:
   *   "ok"          — bundle intact and all source refs ok.
   *   "changed"     — at least one source ref changed.
   *   "missing"     — at least one source ref missing.
   *   "stale"       — at least one source ref stale (no worse class present).
   *   "superseded"  — at least one source ref superseded (no worse class present).
   */
  overall_drift: DriftKind;
}

/** Output of buildContextReplay. */
export interface ContextReplayResult {
  run_id: string;
  /**
   * Context bundle replay for the requested task_run_id, or for all bundles
   * when task_run_id is undefined. Bundles are returned in input order from
   * context-refs.json.
   */
  bundles: BundleContextReplay[];
  /**
   * True when context-refs.json was present and parseable and at least one
   * bundle was found. False when context-refs.json is absent (incomplete trace)
   * or the requested task_run_id had no matching bundle.
   */
  complete: boolean;
  /**
   * When complete is false, a human-readable diagnostic reason. Never
   * fabricates context — a missing bundle causes "incomplete trace" status,
   * not synthetic content.
   */
  incomplete_reason: string | undefined;
}

/**
 * Drift severity order for summary classification. Higher index = worse drift.
 */
const DRIFT_SEVERITY: DriftKind[] = ["ok", "stale", "superseded", "changed", "missing"];

function maxDrift(a: DriftKind, b: DriftKind): DriftKind {
  const ai = DRIFT_SEVERITY.indexOf(a);
  const bi = DRIFT_SEVERITY.indexOf(b);
  return ai >= bi ? a : b;
}

/**
 * Classify a single source ref against the caller-supplied current sha map.
 *
 * @param recorded  The ContextSourceRef from context-refs.json.
 * @param currentShaMap  Optional map from relative path → current sha256.
 *   Pass an empty object or omit it to skip hash verification.
 *   A path mapped to `null` signals "file deleted / missing".
 *   A path mapped to `"SUPERSEDED"` signals that a newer version is present
 *   under a different path (caller convention — not enforced by this module).
 */
function classifySourceRef(
  recorded: ContextSourceRef,
  currentShaMap: Record<string, string | null | undefined>,
): SourceRefDrift {
  const current = Object.prototype.hasOwnProperty.call(currentShaMap, recorded.path)
    ? currentShaMap[recorded.path]
    : undefined;

  let drift: DriftKind;
  const current_sha256 =
    typeof current === "string" && current !== "SUPERSEDED" ? current : undefined;

  if (current === undefined) {
    // No sha-map entry — cannot verify; default "ok" (absence of evidence).
    drift = "ok";
  } else if (current === null) {
    drift = "missing";
  } else if (current === "SUPERSEDED") {
    drift = "superseded";
  } else if (current !== recorded.sha256) {
    drift = "changed";
  } else {
    drift = "ok";
  }

  return {
    path: recorded.path,
    recorded_sha256: recorded.sha256,
    drift,
    current_sha256,
  };
}

/**
 * Reconstruct the context a given task_run saw, from the run's
 * guild.context_refs.v1 record.
 *
 * Pure: no I/O, no Date.now, no Math.random. The caller reads
 * `.guild/runs/<run-id>/context-refs.json`, parses it as JSON, and passes
 * the result here alongside an optional sha map for drift detection.
 *
 * Contract guarantees (tested):
 *   - Returns complete=false + incomplete_reason when contextRefs is null/absent.
 *   - Returns complete=false + incomplete_reason when task_run_id is provided and
 *     no matching bundle exists.
 *   - Returns complete=true + all bundles when task_run_id is undefined.
 *   - Returns complete=true + matching bundle when task_run_id matches exactly one
 *     bundle's task_id.
 *   - Never fabricates a context bundle; missing bundle → incomplete trace.
 *   - Source ref drift is classified correctly per the sha map input.
 *   - overall_drift is the worst drift class seen across all source refs for
 *     a bundle.
 *   - bundle_intact defaults to true when no currentShaMap is provided for the
 *     bundle path.
 *
 * Failure/privacy edge cases (binding: docs/v2/12-observability.md §Failure +
 * privacy edge cases):
 *   - A run with no initiative replays fine (reported as one-off).
 *   - A missing context bundle makes replay report an incomplete trace and
 *     suggest diagnostic mode — never fabricate the bundle.
 *
 * @param contextRefs  Parsed guild.context_refs.v1 (from context-refs.json),
 *   or null when the file was absent (→ incomplete trace result).
 * @param task_run_id  Optional task_id to filter to. Pass undefined to return
 *   all bundles.
 * @param currentShaMap  Optional map from relative path → current sha256 string,
 *   null (file deleted), or "SUPERSEDED" (renamed/replaced). Omit to skip hash
 *   verification (all source refs classified "ok").
 */
export function buildContextReplay(
  contextRefs: ContextRefs | null,
  task_run_id: string | undefined,
  currentShaMap: Record<string, string | null | undefined> = {},
): ContextReplayResult {
  // Missing context-refs.json — incomplete trace, never fabricate.
  if (contextRefs === null) {
    return {
      run_id: "",
      bundles: [],
      complete: false,
      incomplete_reason:
        "context-refs.json absent — context bundle was not recorded for this run " +
        "(incomplete trace). Use diagnostic mode to inspect the raw event log.",
    };
  }

  const run_id = contextRefs.run_id;
  const allBundles = Array.isArray(contextRefs.bundles) ? contextRefs.bundles : [];

  // Filter to the requested task_run_id when supplied.
  const targetBundles =
    task_run_id !== undefined
      ? allBundles.filter((b) => b.task_id === task_run_id)
      : allBundles;

  // No match for the requested task_run_id.
  if (task_run_id !== undefined && targetBundles.length === 0) {
    return {
      run_id,
      bundles: [],
      complete: false,
      incomplete_reason:
        `context bundle for task_id "${task_run_id}" not found in context-refs.json — ` +
        "the bundle was not recorded or the task id does not match. Use diagnostic mode.",
    };
  }

  const bundles: BundleContextReplay[] = targetBundles.map((bundle) => {
    const sourceRefs = Array.isArray(bundle.source_refs) ? bundle.source_refs : [];

    // Classify each source ref.
    const source_drifts: SourceRefDrift[] = sourceRefs.map((ref) =>
      classifySourceRef(ref, currentShaMap),
    );

    // Determine bundle_intact.
    const bundleCurrentSha = Object.prototype.hasOwnProperty.call(
      currentShaMap,
      bundle.path,
    )
      ? currentShaMap[bundle.path]
      : undefined;
    const bundle_intact =
      bundleCurrentSha === undefined
        ? true // no sha map entry — cannot verify, assume intact
        : bundleCurrentSha !== null &&
          bundleCurrentSha !== "SUPERSEDED" &&
          bundleCurrentSha === bundle.sha256;

    // Compute overall drift: worst drift class across all source refs.
    let overall_drift: DriftKind = bundle_intact ? "ok" : "missing";
    for (const sd of source_drifts) {
      overall_drift = maxDrift(overall_drift, sd.drift);
    }

    return {
      task_id: bundle.task_id,
      specialist: bundle.specialist,
      bundle_path: bundle.path,
      bundle_sha256: bundle.sha256,
      bundle_intact,
      source_drifts,
      overall_drift,
    };
  });

  return {
    run_id,
    bundles,
    complete: true,
    incomplete_reason: undefined,
  };
}

// ── Validation helpers ────────────────────────────────────────────────────────

/**
 * Validate a parsed context-refs.json object.
 * Returns { valid: true } when the object is a well-formed guild.context_refs.v1,
 * or { valid: false, errors: string[] } listing all violations found.
 *
 * Bound by pointer to the schema at:
 *   docs/knowledge/observability/run-replay-and-evolution-workflows.md
 *   §Run Record Contract
 */
export function validateContextRefs(raw: unknown): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["root must be a non-null object"] };
  }
  const obj = raw as Record<string, unknown>;

  if (obj["schema_version"] !== "guild.context_refs.v1") {
    errors.push(
      `schema_version must be "guild.context_refs.v1"; got ${JSON.stringify(obj["schema_version"])}`,
    );
  }
  if (typeof obj["run_id"] !== "string" || obj["run_id"].length === 0) {
    errors.push("run_id must be a non-empty string");
  }
  if (!Array.isArray(obj["bundles"])) {
    errors.push("bundles must be an array");
  } else {
    for (let i = 0; i < (obj["bundles"] as unknown[]).length; i++) {
      const b = (obj["bundles"] as unknown[])[i];
      const prefix = `bundles[${i}]`;
      if (b === null || typeof b !== "object" || Array.isArray(b)) {
        errors.push(`${prefix} must be an object`);
        continue;
      }
      const bObj = b as Record<string, unknown>;
      if (typeof bObj["task_id"] !== "string" || bObj["task_id"].length === 0) {
        errors.push(`${prefix}.task_id must be a non-empty string`);
      }
      if (typeof bObj["specialist"] !== "string" || bObj["specialist"].length === 0) {
        errors.push(`${prefix}.specialist must be a non-empty string`);
      }
      if (typeof bObj["path"] !== "string" || bObj["path"].length === 0) {
        errors.push(`${prefix}.path must be a non-empty string`);
      }
      if (typeof bObj["sha256"] !== "string" || bObj["sha256"].length === 0) {
        errors.push(`${prefix}.sha256 must be a non-empty string`);
      }
      if (!Array.isArray(bObj["source_refs"])) {
        errors.push(`${prefix}.source_refs must be an array`);
      } else {
        for (let j = 0; j < (bObj["source_refs"] as unknown[]).length; j++) {
          const s = (bObj["source_refs"] as unknown[])[j];
          const sp = `${prefix}.source_refs[${j}]`;
          if (s === null || typeof s !== "object" || Array.isArray(s)) {
            errors.push(`${sp} must be an object`);
            continue;
          }
          const sObj = s as Record<string, unknown>;
          if (typeof sObj["path"] !== "string" || sObj["path"].length === 0) {
            errors.push(`${sp}.path must be a non-empty string`);
          }
          if (typeof sObj["sha256"] !== "string" || sObj["sha256"].length === 0) {
            errors.push(`${sp}.sha256 must be a non-empty string`);
          }
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
