/**
 * lib/counterfactual-replay.ts — deterministic counterfactual diff primitive
 * (deferred v2.x feature, item 32; docs/v2/12-observability.md §Replay modes).
 *
 * Implements `diffTraces(baseEvents, variantEvents)` — a PURE, deterministic
 * structural diff over two `guild.trace_event.v1` (or v2) event sequences.
 *
 * Key design constraints:
 *   - NO Date.now() / Math.random() in exported lib functions — callers supply
 *     both event arrays. Timestamps are NEVER used as diff keys.
 *   - Events are keyed by a stable `EventSignature` composed of:
 *       event_type  (the `event` discriminator field)
 *       actor       (lane_id | specialist | gate | phase | hook_name — whichever
 *                    is present, else "_")
 *       payload_shape  (sorted JSON keys of the non-identity, non-timestamp
 *                       fields — the structural fingerprint)
 *     Two events are "the same kind of event" iff their signatures match; within
 *     a matching signature bucket, multiple occurrences are counted so a
 *     "added 3rd round of loop X" is distinguishable from "added new event type".
 *   - The diff is STRUCTURAL, not positional: order-independent within each
 *     (event_type, actor) bucket.
 *   - This module is the DIFF PRIMITIVE only. Live execution replay (re-running
 *     a run against stored fixtures in a sandboxed worktree) is explicitly out
 *     of scope here — it depends on sandbox isolation and deterministic run-id
 *     seeding that belongs in a separate surface
 *     (docs/v2/12-observability.md §"Execution replay [v2.x]").
 *
 * Exported surface:
 *   EventSignature   — stable string key for one "kind" of event
 *   TraceEvent       — lenient structural type for v1/v2 events (read-only)
 *   CounterfactualDiff — the result shape
 *   diffTraces()     — the main pure function
 *   eventSignature() — exported for tests + callers that want to inspect keys
 *   validateTraceEvent() — {valid, errors} validator (lenient: unknown fields ok)
 *
 * No filesystem I/O — callers load events from disk and pass them in.
 * CLI block at the bottom demonstrates loading from disk for direct invocation.
 */

// ── Minimal structural type for a guild.trace_event.v1 / .v2 event ───────────

/**
 * Structural type for a guild.trace_event.v1 or .v2 event. All fields are
 * optional at the type level because we accept lenient / partial inputs; the
 * validator below gates hard constraints separately.
 *
 * The `event` field is the discriminator (one of the 12 v1.4 event type names).
 * `ts` and `run_id` are the mandatory identity fields per the frozen v1 contract.
 */
export interface TraceEvent {
  readonly event: string;
  readonly ts: string;
  readonly run_id: string;
  // Actor fields (whichever is present on a given event type)
  readonly lane_id?: string;
  readonly specialist?: string;
  readonly gate?: string;
  readonly phase?: string;
  readonly hook_name?: string;
  // Remaining fields — typed loosely so v1 + v2 events both fit
  readonly [key: string]: unknown;
}

// ── EventSignature ────────────────────────────────────────────────────────────

/**
 * Opaque stable string key identifying "this kind of event" in a way that is:
 *   - Timestamp-independent (no `ts` or clock values)
 *   - Actor-aware (lane_id / specialist / gate / phase / hook_name)
 *   - Structurally fingerprinted (sorted payload-key set, minus identity fields)
 *
 * Two events are "the same kind" iff their signatures are equal. Multiple
 * occurrences of the same kind within a run are tracked by count.
 *
 * Format:  "<event_type>|<actor>|<payload_shape>"
 *   event_type   — the `event` field value (e.g. "loop_round_start")
 *   actor        — first of lane_id | specialist | gate | phase | hook_name
 *                  that is defined, else "_"
 *   payload_shape — JSON.stringify of sorted array of non-identity payload keys
 *
 * This is an opaque string — parse it only for display; never rely on the
 * separator characters being stable across versions.
 */
export type EventSignature = string & { readonly __brand: "EventSignature" };

/** Fields excluded from the payload_shape fingerprint (identity + clock). */
const IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  "event",
  "ts",
  "run_id",
  // guild.trace_event.v2 additive fields (D-OBS-1): all runtime / infra fields
  // that do NOT describe the structural shape of the event. Excluding them means
  // a v1 event and the same event with v2 fields attached hash to the same
  // signature — consistent with the lenient-v2-reader contract.
  "span_id",
  "parent_span_id",
  "tier",
  "model",
  "tokens",
  "payload_ref",
]);

/** Actor field priority: first defined one wins. */
const ACTOR_FIELD_PRIORITY: ReadonlyArray<keyof TraceEvent> = [
  "lane_id",
  "specialist",
  "gate",
  "phase",
  "hook_name",
];

/**
 * Compute the stable EventSignature for a single trace event.
 *
 * The payload_shape is the sorted, JSON-serialized list of keys present on
 * the event (excluding identity/clock fields). This fingerprints the structural
 * schema of the event, not its runtime values.
 */
export function eventSignature(evt: TraceEvent): EventSignature {
  const eventType = typeof evt.event === "string" ? evt.event : "__unknown__";

  // Actor: first defined actor-class field
  let actor = "_";
  for (const field of ACTOR_FIELD_PRIORITY) {
    const v = evt[field];
    if (typeof v === "string" && v.length > 0) {
      actor = v;
      break;
    }
  }

  // Payload shape: sorted keys of non-identity fields
  const payloadKeys = Object.keys(evt)
    .filter((k) => !IDENTITY_FIELDS.has(k))
    .sort();
  const payloadShape = JSON.stringify(payloadKeys);

  return `${eventType}|${actor}|${payloadShape}` as EventSignature;
}

// ── Diff types ────────────────────────────────────────────────────────────────

/**
 * One bucket in the diff: represents a single "kind of event" that either
 * appeared, disappeared, or changed count/values between base and variant.
 */
export interface DiffEntry {
  /** Stable key for this event kind. */
  readonly signature: EventSignature;
  /** `event` field value (redundant with signature but convenient for consumers). */
  readonly event_type: string;
  /** Actor string extracted from the signature (or "_" when absent). */
  readonly actor: string;
  /** Count in the base trace (0 when this event kind is absent in base). */
  readonly base_count: number;
  /** Count in the variant trace (0 when this event kind is absent in variant). */
  readonly variant_count: number;
  /**
   * Count delta: variant_count - base_count. Positive = more in variant,
   * negative = fewer in variant.
   */
  readonly delta: number;
  /**
   * All base events with this signature (in their original order).
   * Empty array when absent.
   */
  readonly base_events: ReadonlyArray<TraceEvent>;
  /**
   * All variant events with this signature (in their original order).
   * Empty array when absent.
   */
  readonly variant_events: ReadonlyArray<TraceEvent>;
}

/**
 * The full counterfactual diff result.
 *
 * Consumers use:
 *   added   — event kinds present in variant but not in base
 *   removed — event kinds present in base but not in variant
 *   changed — event kinds present in both but with a different count
 *   unchanged — event kinds present with the same count in both
 *
 * A "changed" entry is structural (count change) — value-level diffs within
 * individual events are deliberately out of scope; the caller can inspect
 * `base_events` vs `variant_events` directly.
 */
export interface CounterfactualDiff {
  readonly schema_version: "guild.counterfactual_diff.v1";
  /** How many events were in the base trace. */
  readonly base_total: number;
  /** How many events were in the variant trace. */
  readonly variant_total: number;
  /** Event kinds absent in base but present in variant. */
  readonly added: ReadonlyArray<DiffEntry>;
  /** Event kinds present in base but absent in variant. */
  readonly removed: ReadonlyArray<DiffEntry>;
  /**
   * Event kinds present in both but with a different occurrence count.
   * Sorted by signature for determinism.
   */
  readonly changed: ReadonlyArray<DiffEntry>;
  /**
   * Event kinds present with the same count in both.
   * Sorted by signature for determinism.
   */
  readonly unchanged: ReadonlyArray<DiffEntry>;
  /**
   * Flat list of ALL diff entries (added + removed + changed + unchanged),
   * sorted by signature. Convenient for serialization / full inspection.
   */
  readonly all_entries: ReadonlyArray<DiffEntry>;
}

// ── diffTraces (the main primitive) ──────────────────────────────────────────

/**
 * Compute the deterministic counterfactual structural diff between two event
 * sequences from a Guild trace (`guild.trace_event.v1` or `.v2`).
 *
 * Both arrays are caller-supplied; this function is PURE — no I/O, no clock.
 * Timestamps are NEVER used as diff keys (events are keyed by EventSignature).
 *
 * Algorithm:
 *   1. Build a signature → events[] map for base and variant independently.
 *   2. Union the signature key sets.
 *   3. For each signature, compute base_count, variant_count, delta.
 *   4. Classify into added / removed / changed / unchanged.
 *   5. Sort each bucket by signature for determinism.
 *
 * @param baseEvents   Events from the reference (base) trace run.
 * @param variantEvents Events from the candidate (variant) trace run.
 * @returns A deterministic CounterfactualDiff.
 */
export function diffTraces(
  baseEvents: ReadonlyArray<TraceEvent>,
  variantEvents: ReadonlyArray<TraceEvent>,
): CounterfactualDiff {
  // Step 1 — index each set by signature
  const baseIndex = buildSignatureIndex(baseEvents);
  const variantIndex = buildSignatureIndex(variantEvents);

  // Step 2 — union key sets, sorted for determinism
  const allSigs = Array.from(
    new Set([...baseIndex.keys(), ...variantIndex.keys()])
  ).sort() as EventSignature[];

  // Steps 3 & 4 — classify
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];
  const unchanged: DiffEntry[] = [];

  for (const sig of allSigs) {
    const baseEvts = baseIndex.get(sig) ?? [];
    const variantEvts = variantIndex.get(sig) ?? [];
    const entry = makeDiffEntry(sig, baseEvts, variantEvts);

    if (entry.base_count === 0) {
      added.push(entry);
    } else if (entry.variant_count === 0) {
      removed.push(entry);
    } else if (entry.delta !== 0) {
      changed.push(entry);
    } else {
      unchanged.push(entry);
    }
  }

  // Step 5 — all buckets are already sorted (allSigs is sorted)
  const all_entries = [...added, ...removed, ...changed, ...unchanged].sort(
    (a, b) => a.signature.localeCompare(b.signature),
  );

  return {
    schema_version: "guild.counterfactual_diff.v1",
    base_total: baseEvents.length,
    variant_total: variantEvents.length,
    added,
    removed,
    changed,
    unchanged,
    all_entries,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function buildSignatureIndex(
  events: ReadonlyArray<TraceEvent>,
): Map<EventSignature, TraceEvent[]> {
  const map = new Map<EventSignature, TraceEvent[]>();
  for (const evt of events) {
    const sig = eventSignature(evt);
    const bucket = map.get(sig);
    if (bucket) {
      bucket.push(evt);
    } else {
      map.set(sig, [evt]);
    }
  }
  return map;
}

function makeDiffEntry(
  sig: EventSignature,
  baseEvts: TraceEvent[],
  variantEvts: TraceEvent[],
): DiffEntry {
  // Extract event_type and actor from the signature for convenience.
  // Signature format: "<event_type>|<actor>|<payload_shape>"
  const pipeIdx = sig.indexOf("|");
  const secondPipeIdx = sig.indexOf("|", pipeIdx + 1);
  const event_type = pipeIdx >= 0 ? sig.slice(0, pipeIdx) : sig;
  const actor =
    pipeIdx >= 0 && secondPipeIdx > pipeIdx
      ? sig.slice(pipeIdx + 1, secondPipeIdx)
      : "_";

  return {
    signature: sig,
    event_type,
    actor,
    base_count: baseEvts.length,
    variant_count: variantEvts.length,
    delta: variantEvts.length - baseEvts.length,
    base_events: baseEvts,
    variant_events: variantEvts,
  };
}

// ── Validator ─────────────────────────────────────────────────────────────────

/** Validation result shape (consistent with validators in neighboring lib modules). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a single trace event object (lenient v1/v2 reader).
 *
 * Hard requirements (per frozen guild.trace_event.v1 contract):
 *   - `event` must be a non-empty string
 *   - `ts`     must be a non-empty string (RFC3339 not enforced — lenient)
 *   - `run_id` must be a non-empty string
 *
 * Unknown/additional fields are ALLOWED (v2 compatibility, lenient reader).
 * Returns { valid: true, errors: [] } on success.
 */
export function validateTraceEvent(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["event must be a non-null object"] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj["event"] !== "string" || obj["event"].length === 0) {
    errors.push('field "event" must be a non-empty string');
  }
  if (typeof obj["ts"] !== "string" || obj["ts"].length === 0) {
    errors.push('field "ts" must be a non-empty string');
  }
  if (typeof obj["run_id"] !== "string" || obj["run_id"].length === 0) {
    errors.push('field "run_id" must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a JSONL string (one JSON object per line) into validated TraceEvents.
 * Malformed lines are skipped; errors are collected and returned separately.
 *
 * @returns { events, parseErrors } — events are the valid ones; parseErrors
 *   accumulates { line, error } for any line that failed.
 */
export function parseTraceJsonl(
  jsonl: string,
): {
  events: TraceEvent[];
  parseErrors: Array<{ line: number; error: string }>;
} {
  const events: TraceEvent[] = [];
  const parseErrors: Array<{ line: number; error: string }> = [];

  const lines = jsonl.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw.length === 0) continue; // blank line — skip silently

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      parseErrors.push({ line: i + 1, error: `JSON parse error: ${String(err)}` });
      continue;
    }

    const { valid, errors } = validateTraceEvent(parsed);
    if (!valid) {
      parseErrors.push({ line: i + 1, error: `invalid event: ${errors.join("; ")}` });
      continue;
    }

    events.push(parsed as TraceEvent);
  }

  return { events, parseErrors };
}

// ── CLI entry point (uses Date.now() — only runs when executed directly) ──────

if (require.main === module) {
  // CLI usage:  npx tsx lib/counterfactual-replay.ts <base-events.jsonl> <variant-events.jsonl>
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");

  const args = process.argv.slice(2);
  if (args.length < 2) {
    process.stderr.write(
      "Usage: counterfactual-replay.ts <base-events.jsonl> <variant-events.jsonl>\n" +
        "Both files must contain guild.trace_event.v1 or .v2 events (one JSON object per line).\n" +
        "Outputs the counterfactual diff as JSON to stdout.\n",
    );
    process.exit(1);
  }

  const [basePath, variantPath] = args.map((p) => path.resolve(p));

  let baseRaw: string;
  let variantRaw: string;
  try {
    baseRaw = fs.readFileSync(basePath, "utf8");
  } catch (err) {
    process.stderr.write(`[counterfactual-replay] Cannot read base file: ${String(err)}\n`);
    process.exit(1);
  }
  try {
    variantRaw = fs.readFileSync(variantPath, "utf8");
  } catch (err) {
    process.stderr.write(`[counterfactual-replay] Cannot read variant file: ${String(err)}\n`);
    process.exit(1);
  }

  const { events: baseEvents, parseErrors: baseErrors } = parseTraceJsonl(baseRaw);
  const { events: variantEvents, parseErrors: variantErrors } = parseTraceJsonl(variantRaw);

  if (baseErrors.length > 0) {
    process.stderr.write(
      `[counterfactual-replay] ${baseErrors.length} parse error(s) in base file:\n` +
        baseErrors.map((e) => `  line ${e.line}: ${e.error}`).join("\n") + "\n",
    );
  }
  if (variantErrors.length > 0) {
    process.stderr.write(
      `[counterfactual-replay] ${variantErrors.length} parse error(s) in variant file:\n` +
        variantErrors.map((e) => `  line ${e.line}: ${e.error}`).join("\n") + "\n",
    );
  }

  const diff = diffTraces(baseEvents, variantEvents);

  // Stamp a generated_at for CLI use only (not part of the lib contract).
  const output = {
    ...diff,
    generated_at: new Date().toISOString(),
    base_path: basePath,
    variant_path: variantPath,
    base_parse_errors: baseErrors.length,
    variant_parse_errors: variantErrors.length,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + "\n");
}
