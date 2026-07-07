/**
 * scripts/lib/sqlite-projections.ts
 *
 * SQLite run_state / spans / files_touched projections (ITEM-29, v2.x).
 *
 * Contract (12-observability.md §Projections, D-PS-1):
 *  - Three derived, rebuildable, deletable projections over the canonical
 *    run artifacts (run.yaml + provenance.json + v1.4-events.jsonl).
 *  - FILESYSTEM-CANONICAL: every datum is a verbatim projection of a .guild/
 *    file. Deleting these tables loses nothing durable; absence == full scan.
 *  - NO-CONTRACT-DRIFT: these projections are plugin-local conveniences only.
 *    The plugin↔benchmark contract remains the canonical JSONL. The benchmark
 *    never reads these tables.
 *  - Deterministic builders: NO Date.now() / Math.random() inside exported
 *    lib functions — callers supply timestamps and IDs via parsed inputs.
 *  - Default-off (dormant surface): writeProjections is a voluntary opt-in;
 *    no existing path calls it. Callers wire it when above the threshold.
 *  - The run sentinel (.guild/runs/current-run-id) is folded into run_state
 *    as `is_current` (boolean).
 *
 * Pure builders:
 *   buildRunState(runYaml, provenance, isCurrent) → RunStateRow
 *   buildSpans(runId, events[])                   → SpanRow[]
 *   buildFilesTouched(runId, provenance)           → FileTouchedRow[]
 *
 * Optional DB writer:
 *   writeProjections(db, runId, runYaml, provenance, events, isCurrent) → void
 *
 * SQL schema (additive to index.sqlite via index-migrate.ts v3 when it lands):
 *   run_state      (run_id PK, status, phase, run_class, command,
 *                   initiative, started_at, closed_at, is_current INTEGER,
 *                   benchmark_eligible INTEGER, data TEXT)
 *   spans          (span_id TEXT, run_id TEXT, parent_span_id TEXT,
 *                   event_type TEXT, actor TEXT, ts TEXT, tier TEXT,
 *                   model TEXT, lane_id TEXT, task_id TEXT,
 *                   tokens_input INT, tokens_output INT, tokens_cached INT,
 *                   cost_usd REAL, data TEXT,
 *                   PRIMARY KEY (run_id, span_id))
 *   files_touched  (run_id TEXT NOT NULL, path TEXT NOT NULL,
 *                   PRIMARY KEY (run_id, path))
 *
 * All functions are synchronous and never throw.
 *
 * Usage:
 *   import {
 *     buildRunState, buildSpans, buildFilesTouched, writeProjections,
 *     type RunStateRow, type SpanRow, type FileTouchedRow,
 *   } from './lib/sqlite-projections'
 */

// ── Parsed input shapes (lenient — accept unknown keys gracefully) ─────────

/**
 * Minimal fields read from run.yaml (guild.run.v1).
 * All fields are optional so the builder degrades gracefully on partial reads.
 */
export interface ParsedRunYaml {
  run_id?: string;
  status?: string;
  phase?: string | null;
  run_class?: string;
  command?: string;
  initiative_attachment?: string | null;
  started_at?: string;
  [key: string]: unknown;
}

/**
 * Minimal fields read from provenance.json (guild.provenance.v1).
 * All fields are optional for lenient parsing.
 */
export interface ParsedProvenance {
  run_id?: string;
  status?: string;
  closed_at?: string;
  run_class?: string;
  command?: string;
  initiative?: string | null;
  benchmark_eligible?: boolean;
  touched?: {
    files?: string[];
    tasks?: string[];
    agents?: string[];
    skills?: string[];
    decisions?: string[];
    features?: string[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * A single v1.4-events.jsonl event line. v1 fields are frozen; v2 additive
 * fields (span_id, parent_span_id, tier, model, tokens) are optional.
 */
export interface ParsedTraceEvent {
  ts?: string;
  event?: string;
  run_id?: string;
  lane_id?: string;
  task_id?: string;
  specialist?: string;
  /** v2 additive */
  span_id?: string;
  parent_span_id?: string;
  tier?: string;
  model?: string;
  tokens?: {
    input?: number;
    output?: number;
    cached?: number;
    cost_usd?: number;
  };
  [key: string]: unknown;
}

// ── Projection row shapes ──────────────────────────────────────────────────

/** One row in the run_state table. */
export interface RunStateRow {
  /** Canonical run identifier (from run.yaml or provenance.json). */
  run_id: string;
  /**
   * Merged status: open runs use run.yaml status; closed/failed/resumable
   * runs use provenance.json status when available.
   */
  status: string;
  /** Current phase scalar from run.yaml, or null. */
  phase: string | null;
  /** "full" | "lightweight" — from run.yaml or provenance.json. */
  run_class: string;
  /** Entry command token (e.g. "/guild:learn"). */
  command: string;
  /** Initiative slug or null (NN#5 — scalar record only). */
  initiative: string | null;
  /** RFC3339 start timestamp from run.yaml. */
  started_at: string;
  /** RFC3339 close timestamp from provenance.json, or null for open runs. */
  closed_at: string | null;
  /**
   * True when this run is the active sentinel (.guild/runs/current-run-id
   * matches this run_id). Folded in from caller-supplied isCurrent flag.
   */
  is_current: boolean;
  /** True when provenance.json says the run is benchmark-eligible. */
  benchmark_eligible: boolean;
  /** JSON blob of the full parsed run.yaml record for forward-compat reads. */
  data: string;
}

/** One row in the spans table (one per v1.4 event that carries a span_id). */
export interface SpanRow {
  /** span_id from the trace event (v2 field). Synthetic when absent: "<event>:<ts>". */
  span_id: string;
  /** Owning run identifier. */
  run_id: string;
  /** Parent span id (v2 field) or null. */
  parent_span_id: string | null;
  /** Event discriminator (e.g. "specialist_dispatch", "tool_call"). */
  event_type: string;
  /** Actor: specialist name, hook name, or "orchestrator". */
  actor: string;
  /** RFC3339 event timestamp. */
  ts: string;
  /** Model tier (v2 "tier" field) or null. */
  tier: string | null;
  /** Model id (v2 "model" field) or null. */
  model: string | null;
  /** Lane identifier or null. */
  lane_id: string | null;
  /** Task identifier or null. */
  task_id: string | null;
  /** Input token count (v2 tokens.input) or null. */
  tokens_input: number | null;
  /** Output token count (v2 tokens.output) or null. */
  tokens_output: number | null;
  /** Cached token count (v2 tokens.cached) or null. */
  tokens_cached: number | null;
  /** Cost in USD (v2 tokens.cost_usd) or null. */
  cost_usd: number | null;
  /** JSON blob of the full event for forward-compat reads. */
  data: string;
}

/** One row in the files_touched table. */
export interface FileTouchedRow {
  /** Owning run identifier. */
  run_id: string;
  /** File path from provenance.json touched.files (relative or absolute). */
  path: string;
}

// ── Validation helpers ─────────────────────────────────────────────────────

/** Result shape for validation functions. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a RunStateRow has the required fields populated. */
export function validateRunStateRow(row: RunStateRow): ValidationResult {
  const errors: string[] = [];
  if (!row.run_id) errors.push("run_id is empty");
  if (!row.status) errors.push("status is empty");
  if (!row.started_at) errors.push("started_at is empty");
  return { valid: errors.length === 0, errors };
}

/** Validate a SpanRow has minimum required fields. */
export function validateSpanRow(row: SpanRow): ValidationResult {
  const errors: string[] = [];
  if (!row.span_id) errors.push("span_id is empty");
  if (!row.run_id) errors.push("run_id is empty");
  if (!row.event_type) errors.push("event_type is empty");
  if (!row.ts) errors.push("ts is empty");
  return { valid: errors.length === 0, errors };
}

// ── Pure builder: buildRunState ────────────────────────────────────────────

/**
 * Project a parsed run.yaml + provenance.json into a RunStateRow.
 *
 * Merging rules:
 *  - run_id: prefer run.yaml; fall back to provenance.json.
 *  - status: open runs use run.yaml `status`; closed/failed runs use
 *    provenance.json `status` (the terminal value).
 *  - phase/run_class/command: prefer run.yaml; fall back to provenance.json.
 *  - initiative: prefer run.yaml initiative_attachment; fall back to
 *    provenance.json initiative.
 *  - started_at: run.yaml only (provenance.json has no started_at).
 *  - closed_at: provenance.json only; null for open runs.
 *  - is_current: caller-supplied (derived from the sentinel file).
 *  - benchmark_eligible: provenance.json only; false when provenance is absent.
 *  - data: JSON of the merged run.yaml fields (provenance is NOT folded in
 *    to keep the projection rebuildable from either source independently).
 *
 * @param runYaml   Parsed run.yaml object. May be empty ({}) for partial reads.
 * @param provenance Parsed provenance.json object. May be null when absent.
 * @param isCurrent True when .guild/runs/current-run-id equals this run's id.
 */
export function buildRunState(
  runYaml: ParsedRunYaml,
  provenance: ParsedProvenance | null,
  isCurrent: boolean,
): RunStateRow {
  const run_id = String(runYaml.run_id ?? provenance?.run_id ?? "");
  const yamlStatus = String(runYaml.status ?? "open");
  // If provenance is present and has a terminal status, it supersedes run.yaml
  // (which may still show "open" if the close path failed to flip the file).
  const terminalStatuses = new Set(["closed", "failed", "resumable"]);
  const provStatus = provenance?.status ? String(provenance.status) : null;
  const status =
    provStatus && terminalStatuses.has(provStatus) ? provStatus : yamlStatus;

  const phase: string | null =
    runYaml.phase !== undefined
      ? runYaml.phase === null || runYaml.phase === "null"
        ? null
        : String(runYaml.phase)
      : null;

  const run_class = String(
    runYaml.run_class ?? provenance?.run_class ?? "full",
  );
  const command = String(runYaml.command ?? provenance?.command ?? "");

  // NN#5: initiative is a scalar field record only — never a directory.
  const initYaml = runYaml.initiative_attachment;
  const initProv = provenance?.initiative;
  const rawInit = initYaml !== undefined ? initYaml : initProv;
  const initiative: string | null =
    rawInit == null || rawInit === "null" || rawInit === ""
      ? null
      : String(rawInit);

  const started_at = String(runYaml.started_at ?? "");
  const closed_at = provenance?.closed_at ? String(provenance.closed_at) : null;

  const benchmark_eligible = provenance?.benchmark_eligible === true;

  // data blob: the raw run.yaml record (caller-supplied; deterministic).
  const data = JSON.stringify(runYaml);

  return {
    run_id,
    status,
    phase,
    run_class,
    command,
    initiative,
    started_at,
    closed_at,
    is_current: isCurrent,
    benchmark_eligible,
    data,
  };
}

// ── Pure builder: buildSpans ───────────────────────────────────────────────

/**
 * Project a list of parsed v1.4-events.jsonl lines into SpanRow records.
 *
 * One SpanRow is emitted per event line. Events that carry a v2 `span_id`
 * use it verbatim. Events without a span_id get a synthetic id of the form
 * "<event_type>:<ts>" — stable for the same event, human-readable in queries.
 *
 * Actor resolution order:
 *   1. `specialist` field (for specialist_dispatch / specialist_receipt / loop events)
 *   2. `hook_name` field (for hook_event)
 *   3. `event` field as a discriminator fallback → "orchestrator"
 *
 * Events with an empty or missing `ts` are included with ts="unknown" so
 * the projection is total (no silently dropped events).
 *
 * @param runId  Canonical run identifier to stamp on every span row.
 * @param events Parsed JSONL event objects (one per line).
 */
export function buildSpans(runId: string, events: ParsedTraceEvent[]): SpanRow[] {
  const rows: SpanRow[] = [];

  for (const evt of events) {
    const eventType = String(evt.event ?? "unknown");
    const ts = String(evt.ts ?? "unknown");

    // Synthetic span_id when the v2 field is absent: "<event>:<ts>"
    const span_id = evt.span_id ? String(evt.span_id) : `${eventType}:${ts}`;
    const parent_span_id = evt.parent_span_id ? String(evt.parent_span_id) : null;

    // Actor resolution
    const actor = (() => {
      if (evt.specialist) return String(evt.specialist);
      if (evt.hook_name) return String(evt.hook_name);
      // gate_decision, phase_start/end, escalation → orchestrator
      return "orchestrator";
    })();

    const lane_id = evt.lane_id ? String(evt.lane_id) : null;
    const task_id = evt.task_id ? String(evt.task_id) : null;
    const tier = evt.tier ? String(evt.tier) : null;
    const model = evt.model ? String(evt.model) : null;

    const tokens_input =
      evt.tokens?.input != null ? Number(evt.tokens.input) : null;
    const tokens_output =
      evt.tokens?.output != null ? Number(evt.tokens.output) : null;
    const tokens_cached =
      evt.tokens?.cached != null ? Number(evt.tokens.cached) : null;
    const cost_usd =
      evt.tokens?.cost_usd != null ? Number(evt.tokens.cost_usd) : null;

    rows.push({
      span_id,
      run_id: runId,
      parent_span_id,
      event_type: eventType,
      actor,
      ts,
      tier,
      model,
      lane_id,
      task_id,
      tokens_input,
      tokens_output,
      tokens_cached,
      cost_usd,
      data: JSON.stringify(evt),
    });
  }

  return rows;
}

// ── Pure builder: buildFilesTouched ───────────────────────────────────────

/**
 * Project provenance.json touched.files into FileTouchedRow records.
 *
 * One row per unique path. Paths are taken verbatim from provenance.json —
 * no normalization is applied (the filesystem canonical form is what the
 * run writer stamped). Duplicate paths within a single run are deduplicated.
 *
 * When provenance is null or touched.files is empty/absent, returns [].
 *
 * @param runId      Canonical run identifier to stamp on every row.
 * @param provenance Parsed provenance.json. May be null.
 */
export function buildFilesTouched(
  runId: string,
  provenance: ParsedProvenance | null,
): FileTouchedRow[] {
  if (!provenance) return [];
  const files = provenance.touched?.files;
  if (!Array.isArray(files) || files.length === 0) return [];

  const seen = new Set<string>();
  const rows: FileTouchedRow[] = [];
  for (const f of files) {
    const p = String(f ?? "");
    if (!p || seen.has(p)) continue;
    seen.add(p);
    rows.push({ run_id: runId, path: p });
  }
  return rows;
}

// ── Optional DB writer ─────────────────────────────────────────────────────

/** Minimal SQLite statement interface (mirrors index-cache.ts stubs). */
interface SqliteStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

/** Minimal SQLite DB interface (mirrors index-cache.ts stubs). */
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

/**
 * Write the three projection tables for one run into an open SQLite database.
 *
 * This is an **optional, dormant surface** — it is NOT called by any existing
 * path. Callers opt in when they have an open DB and the run is above threshold.
 *
 * The three tables must exist in the DB before this is called. Schema DDL
 * (to be added as index-migrate.ts migration v3):
 *
 *   CREATE TABLE run_state (
 *     run_id             TEXT NOT NULL PRIMARY KEY,
 *     status             TEXT NOT NULL,
 *     phase              TEXT,
 *     run_class          TEXT NOT NULL,
 *     command            TEXT NOT NULL,
 *     initiative         TEXT,
 *     started_at         TEXT NOT NULL,
 *     closed_at          TEXT,
 *     is_current         INTEGER NOT NULL DEFAULT 0,
 *     benchmark_eligible INTEGER NOT NULL DEFAULT 0,
 *     data               TEXT
 *   );
 *   CREATE TABLE spans (
 *     span_id       TEXT NOT NULL,
 *     run_id        TEXT NOT NULL,
 *     parent_span_id TEXT,
 *     event_type    TEXT NOT NULL,
 *     actor         TEXT NOT NULL,
 *     ts            TEXT NOT NULL,
 *     tier          TEXT,
 *     model         TEXT,
 *     lane_id       TEXT,
 *     task_id       TEXT,
 *     tokens_input  INTEGER,
 *     tokens_output INTEGER,
 *     tokens_cached INTEGER,
 *     cost_usd      REAL,
 *     data          TEXT,
 *     PRIMARY KEY (run_id, span_id)
 *   );
 *   CREATE TABLE files_touched (
 *     run_id TEXT NOT NULL,
 *     path   TEXT NOT NULL,
 *     PRIMARY KEY (run_id, path)
 *   );
 *
 * All writes are upserts — re-running writeProjections for the same run_id
 * replaces the prior rows (idempotent rebuild).
 *
 * @param db         Open SQLite database (caller owns open/close/transaction).
 * @param runId      Canonical run identifier.
 * @param runYaml    Parsed run.yaml (may be empty object on partial reads).
 * @param provenance Parsed provenance.json (null for open/incomplete runs).
 * @param events     Parsed JSONL event lines (may be empty).
 * @param isCurrent  True when .guild/runs/current-run-id equals this runId.
 */
export function writeProjections(
  db: SqliteDb,
  runId: string,
  runYaml: ParsedRunYaml,
  provenance: ParsedProvenance | null,
  events: ParsedTraceEvent[],
  isCurrent: boolean,
): void {
  const runState = buildRunState(runYaml, provenance, isCurrent);
  const spans = buildSpans(runId, events);
  const filesTouched = buildFilesTouched(runId, provenance);

  // run_state upsert
  db.prepare(
    `INSERT INTO run_state
       (run_id, status, phase, run_class, command, initiative,
        started_at, closed_at, is_current, benchmark_eligible, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       status             = excluded.status,
       phase              = excluded.phase,
       run_class          = excluded.run_class,
       command            = excluded.command,
       initiative         = excluded.initiative,
       started_at         = excluded.started_at,
       closed_at          = excluded.closed_at,
       is_current         = excluded.is_current,
       benchmark_eligible = excluded.benchmark_eligible,
       data               = excluded.data`,
  ).run(
    runState.run_id,
    runState.status,
    runState.phase ?? null,
    runState.run_class,
    runState.command,
    runState.initiative ?? null,
    runState.started_at,
    runState.closed_at ?? null,
    runState.is_current ? 1 : 0,
    runState.benchmark_eligible ? 1 : 0,
    runState.data,
  );

  // spans upsert (delete-then-insert for this run so stale spans are purged)
  db.prepare("DELETE FROM spans WHERE run_id = ?").run(runId);
  const insSpan = db.prepare(
    `INSERT INTO spans
       (span_id, run_id, parent_span_id, event_type, actor, ts, tier, model,
        lane_id, task_id, tokens_input, tokens_output, tokens_cached, cost_usd, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const s of spans) {
    insSpan.run(
      s.span_id,
      s.run_id,
      s.parent_span_id ?? null,
      s.event_type,
      s.actor,
      s.ts,
      s.tier ?? null,
      s.model ?? null,
      s.lane_id ?? null,
      s.task_id ?? null,
      s.tokens_input ?? null,
      s.tokens_output ?? null,
      s.tokens_cached ?? null,
      s.cost_usd ?? null,
      s.data,
    );
  }

  // files_touched upsert (delete-then-insert for this run)
  db.prepare("DELETE FROM files_touched WHERE run_id = ?").run(runId);
  const insFile = db.prepare(
    `INSERT INTO files_touched (run_id, path) VALUES (?, ?)`,
  );
  for (const f of filesTouched) {
    insFile.run(f.run_id, f.path);
  }
}

// ── JSONL parser helper (exported for CLI and test convenience) ────────────

/**
 * Parse a v1.4-events.jsonl file content string into event objects.
 *
 * Silently skips blank lines and lines that are not valid JSON objects
 * (mirrors the lenient reader posture from 12-observability.md v2 contract).
 *
 * @param content  Raw file content (UTF-8 string).
 * @returns        Array of parsed event objects; empty if content is blank.
 */
export function parseJsonlEvents(content: string): ParsedTraceEvent[] {
  const events: ParsedTraceEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        events.push(obj as ParsedTraceEvent);
      }
    } catch {
      // skip malformed lines — lenient reader
    }
  }
  return events;
}

// ── CLI entrypoint (main — may use Date.now() / Math.random()) ────────────

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseYaml } = require("./frontmatter") as typeof import("./frontmatter");

  const argv = process.argv.slice(2);
  let runId = "";
  let guildRoot = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (argv[i] === "--cwd" && i + 1 < argv.length) guildRoot = argv[++i];
  }
  if (!runId) {
    process.stderr.write("Usage: sqlite-projections.ts --run-id <id> [--cwd <root>]\n");
    process.exit(1);
  }

  const runDir = path.join(guildRoot, ".guild", "runs", runId);
  const runYamlPath = path.join(runDir, "run.yaml");
  const provPath = path.join(runDir, "provenance.json");
  const eventsPath = path.join(runDir, "logs", "v1.4-events.jsonl");
  const sentinelPath = path.join(guildRoot, ".guild", "runs", "current-run-id");

  let runYaml: ParsedRunYaml = {};
  try {
    // Parse run.yaml via the shared js-yaml parser (OD-3). `get` returns each
    // scalar String()-coerced (null when absent), matching the old raw-text
    // shape; the consumer (toRunRow) already normalises null/"null" and
    // String()-wraps every field, so the type coercion is absorbed.
    const raw = fs.readFileSync(runYamlPath, "utf8");
    const doc = parseYaml(raw);
    const obj =
      doc !== null && typeof doc === "object" && !Array.isArray(doc)
        ? (doc as Record<string, unknown>)
        : {};
    const get = (key: string): string | null => {
      const v = obj[key];
      return v === undefined || v === null ? null : String(v);
    };
    runYaml = {
      run_id: get("run_id") ?? undefined,
      status: get("status") ?? undefined,
      phase: get("phase"),
      run_class: get("run_class") ?? undefined,
      command: get("command") ?? undefined,
      initiative_attachment: get("initiative_attachment"),
      started_at: get("started_at") ?? undefined,
    };
  } catch {
    process.stderr.write(`[sqlite-projections] WARN: could not read run.yaml at ${runYamlPath}\n`);
  }

  let provenance: ParsedProvenance | null = null;
  try {
    provenance = JSON.parse(fs.readFileSync(provPath, "utf8")) as ParsedProvenance;
  } catch {
    // open run — no provenance yet
  }

  let events: ParsedTraceEvent[] = [];
  try {
    events = parseJsonlEvents(fs.readFileSync(eventsPath, "utf8"));
  } catch {
    // no events file yet
  }

  let isCurrent = false;
  try {
    isCurrent = fs.readFileSync(sentinelPath, "utf8").trim() === runId;
  } catch {
    // no sentinel
  }

  const runState = buildRunState(runYaml, provenance, isCurrent);
  const spans = buildSpans(runId, events);
  const filesTouched = buildFilesTouched(runId, provenance);

  process.stdout.write(
    JSON.stringify({ run_state: runState, spans_count: spans.length, files_touched_count: filesTouched.length }, null, 2) + "\n",
  );
}
