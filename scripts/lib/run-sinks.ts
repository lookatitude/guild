/**
 * scripts/lib/run-sinks.ts
 *
 * rf-wi-02 (G2) — the READERS for the two dedicated dispatch-integrity sinks
 * every run writes but nothing consumed before this lane:
 *
 *   - `<runDir>/logs/backend-degradation.jsonl` (guild.backend_degradation.v1)
 *       written by hooks/lib/backend-degradation.ts on every non-pass backend
 *       decision — a lane that ran on a DOWNGRADED backend.
 *   - `<runDir>/logs/tier-dispatch.jsonl` (guild.tier_dispatch.v1)
 *       written by hooks/lib/tier-dispatch.ts on EVERY Guild-lane dispatch
 *       decision — the compliant ones (`decision: pass`) AND the violations.
 *
 * These sinks are deliberately SEPARATE from `logs/v1.4-events.jsonl` (whose
 * event vocabulary is frozen + validated). Before this module a run with a
 * silent backend downgrade or an un-tiered dispatch was auditable-by-path only,
 * never surfaced — `guild:verify-done` and `guild:reflect` could not see it.
 *
 * This library is PURE (fs read + in-memory summarize) and dependency-free so
 * the same code drives three consumers with identical semantics:
 *   - `scripts/trace-summarize.ts`  → summary.md `## Sink audit` (reflect reads).
 *   - `scripts/audit-run-sinks.ts`  → the CLI verify-done gates on (exit 1 dirty).
 *   - future dashboards / MCP.
 *
 * It reads the receipts STRUCTURALLY (by `schema_version`) rather than importing
 * the producer types from `hooks/lib/*` — hooks is a separate build project and
 * tolerating unknown FIELDS is what a durable audit sink wants. But because this
 * is a GATE, it fails CLOSED on any OBSERVABLE integrity anomaly (see readSinkRaw
 * / isRunSinkDirty): an unparseable line, a wrong-schema record, or a
 * present-but-unreadable sink is unverifiable, and "cannot verify" must never
 * read as "clean". Only a MISSING sink (ENOENT) is clean.
 *
 * Accepted limitation (not fixable in a reader): the producers
 * (appendBackendDegradationEvent / appendTierDispatchEvent) are best-effort and
 * can DROP a receipt entirely on an unwritable run dir — no line is written, so
 * no reader can observe the loss. That is a producer-contract property; making a
 * dropped write detectable would require the producers to fail loudly, which is
 * out of this lane's scope (tracked as a followup).
 */

import * as fs from "fs";
import * as path from "path";

// ── Sink locations + schema tokens (mirror the producers) ────────────────────

/** Relative to a run dir. Mirrors hooks/lib/backend-degradation.ts RECEIPT_RELATIVE_PATH. */
export const BACKEND_DEGRADATION_SINK = "logs/backend-degradation.jsonl";
/** Relative to a run dir. Mirrors hooks/lib/tier-dispatch.ts RECEIPT_RELATIVE_PATH. */
export const TIER_DISPATCH_SINK = "logs/tier-dispatch.jsonl";

export const BACKEND_DEGRADATION_SCHEMA = "guild.backend_degradation.v1";
export const TIER_DISPATCH_SCHEMA = "guild.tier_dispatch.v1";

/**
 * The tier-dispatch reason that means UN-TIERED — the model param was absent, so
 * the dispatch carried no verifiable tier at all. Its sibling violations
 * (`tier_model_mismatch` / `tier_unverifiable`) carry an explicit model and are
 * NOT "untiered". A `decision: pass` (`scored_compliant` / `model_present`)
 * honors the tier contract.
 */
export const UNTIERED_REASON = "missing_model";

type Row = Record<string, unknown>;

// ── Defensive JSONL reader ───────────────────────────────────────────────────

interface RawSinkRead {
  rows: Row[];
  /**
   * Count of OBSERVABLE integrity anomalies in this sink — every case where the
   * sink exists but we cannot verify a record, so the audit must fail CLOSED
   * (see isRunSinkDirty): for a gate, "cannot verify this receipt" must never
   * read as "clean". Counts:
   *   - an UNPARSEABLE line (invalid JSON, or JSON that is not a plain object);
   *   - a plain object whose `schema_version` is NOT the one this dedicated sink
   *     is contracted to hold (a corrupt/tampered/foreign record — a real
   *     degradation/violation whose schema token got garbled would otherwise be
   *     silently filtered out and read clean);
   *   - the sink FILE existing but being UNREADABLE (EACCES, or a directory at
   *     the path, …) — anything but ENOENT. A missing file (ENOENT) is 0
   *     anomalies: a run that never degraded / never dispatched simply has no
   *     sink.
   * This is the reader half of codex finding 1 (rounds 1–2). The WRITE half
   * (appendTierDispatchEvent / appendBackendDegradationEvent are best-effort and
   * can drop a receipt ENTIRELY on an unwritable dir — no line is written) is a
   * producer-contract property no reader can observe, called out in the header.
   */
  anomalies: number;
}

/**
 * Read + fail-closed-scan a dedicated single-schema sink. When `expectedSchema`
 * is given, a parsed object whose `schema_version` differs is counted as an
 * anomaly AND excluded from `rows` (the summarizers re-filter defensively).
 */
function readSinkRaw(runDir: string, relPath: string, expectedSchema?: string): RawSinkRead {
  let content: string;
  try {
    content = fs.readFileSync(path.join(runDir, relPath), "utf8");
  } catch (err) {
    // ONLY a missing file is clean. Any other read failure is an EXISTING sink we
    // cannot verify → fail closed (1 anomaly).
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return { rows: [], anomalies: 0 };
    return { rows: [], anomalies: 1 };
  }
  const rows: Row[] = [];
  let anomalies = 0;
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let v: unknown;
    try {
      v = JSON.parse(t);
    } catch {
      anomalies++; // unparseable line — a corrupt receipt may hide a real violation
      continue;
    }
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      anomalies++; // valid JSON but not a receipt object
      continue;
    }
    if (expectedSchema !== undefined && (v as Row).schema_version !== expectedSchema) {
      anomalies++; // wrong/unknown schema in a dedicated sink — do not silently drop
      continue;
    }
    rows.push(v as Row);
  }
  return { rows, anomalies };
}

/**
 * Read a JSONL sink under a run dir → the parseable receipt objects (lenient,
 * schema-agnostic: drops unparseable lines, keeps every object). Missing file →
 * `[]`. The fail-closed audit path uses loadRunSinks, which reads each sink with
 * its expected schema and carries the anomaly count through to isRunSinkDirty.
 */
export function readJsonlSink(runDir: string, relPath: string): Row[] {
  return readSinkRaw(runDir, relPath).rows;
}

/** count-desc then alpha — the same ordering contract trace-summarize uses. */
function tally(values: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

// ── Backend degradation ──────────────────────────────────────────────────────

export interface BackendDegradationSummary {
  /** Every recorded degradation is dirty — an allowed downgrade is still a downgrade. */
  count: number;
  byReason: { reason: string; count: number }[];
  byDecision: { decision: string; count: number }[];
  receipts: Row[];
}

export function summarizeBackendDegradations(rows: Row[]): BackendDegradationSummary {
  const receipts = rows.filter((r) => r.schema_version === BACKEND_DEGRADATION_SCHEMA);
  return {
    count: receipts.length,
    byReason: tally(receipts.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count,
    })),
    byDecision: tally(receipts.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count,
    })),
    receipts,
  };
}

// ── Tier dispatch ────────────────────────────────────────────────────────────

export interface TierDispatchSummary {
  /** All tier-dispatch receipts (compliant + violations). */
  total: number;
  /** Receipts whose `decision !== "pass"` — the tier contract was not honored. */
  violationCount: number;
  /** Violations whose `reason === "missing_model"` — dispatched with no tier at all. */
  untieredCount: number;
  violations: Row[];
  /** byReason / byDecision are computed over the VIOLATIONS only. */
  byReason: { reason: string; count: number }[];
  byDecision: { decision: string; count: number }[];
}

export function summarizeTierDispatch(rows: Row[]): TierDispatchSummary {
  const receipts = rows.filter((r) => r.schema_version === TIER_DISPATCH_SCHEMA);
  const violations = receipts.filter((r) => String(r.decision) !== "pass");
  const untieredCount = receipts.filter((r) => String(r.reason) === UNTIERED_REASON).length;
  return {
    total: receipts.length,
    violationCount: violations.length,
    untieredCount,
    violations,
    byReason: tally(violations.map((r) => String(r.reason ?? "unknown"))).map((t) => ({
      reason: t.value,
      count: t.count,
    })),
    byDecision: tally(violations.map((r) => String(r.decision ?? "unknown"))).map((t) => ({
      decision: t.value,
      count: t.count,
    })),
  };
}

// ── Combined audit ───────────────────────────────────────────────────────────

export interface RunSinkAudit {
  runDir: string;
  degradations: BackendDegradationSummary;
  tier: TierDispatchSummary;
  /**
   * Observable integrity anomalies across both sinks (unparseable lines,
   * wrong-schema records, an unreadable-but-present sink) — fails the audit
   * CLOSED. Only a MISSING sink (ENOENT) contributes 0.
   */
  parseErrors: number;
}

export function loadRunSinks(runDir: string): RunSinkAudit {
  const deg = readSinkRaw(runDir, BACKEND_DEGRADATION_SINK, BACKEND_DEGRADATION_SCHEMA);
  const tier = readSinkRaw(runDir, TIER_DISPATCH_SINK, TIER_DISPATCH_SCHEMA);
  return {
    runDir,
    degradations: summarizeBackendDegradations(deg.rows),
    tier: summarizeTierDispatch(tier.rows),
    parseErrors: deg.anomalies + tier.anomalies,
  };
}

/**
 * A run is dirty when ANY backend degradation OR ANY tier-contract violation was
 * recorded — OR when a sink carried an UNPARSEABLE line (fail-closed: a corrupt
 * receipt is unverifiable, and for a gate that must count as dirty, not clean).
 */
export function isRunSinkDirty(a: RunSinkAudit): boolean {
  return a.degradations.count > 0 || a.tier.violationCount > 0 || a.parseErrors > 0;
}

// ── Rendering (frontmatter + markdown section) ───────────────────────────────

/** The three sink counts, ready to drop into summary.md frontmatter. */
export function sinkAuditFrontmatterLines(a: RunSinkAudit): string[] {
  return [
    `backend_degradations: ${a.degradations.count}`,
    `tier_violations: ${a.tier.violationCount}`,
    `untiered_dispatches: ${a.tier.untieredCount}`,
    `sink_parse_errors: ${a.parseErrors}`,
  ];
}

/**
 * The `## Sink audit` section. ALWAYS rendered — a clean run affirms clean
 * (verified, not silently absent); a dirty run names each degradation reason and
 * each tier violation so the run reads VISIBLY dirty in verify.md / reflections.
 */
export function renderSinkAuditSection(a: RunSinkAudit): string {
  const { degradations: d, tier: t } = a;
  const body: string[] = [];

  if (!isRunSinkDirty(a)) {
    body.push(
      `Clean — no backend degradations, no tier-contract violations` +
        (t.total > 0 ? ` (${t.total} dispatch receipt(s), all compliant).` : ".")
    );
    return ["## Sink audit", "", body.join("\n")].join("\n");
  }

  if (d.count > 0) {
    body.push(`- **backend degradations: ${d.count}** — a lane ran on a downgraded backend.`);
    for (const r of d.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of d.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (t.violationCount > 0) {
    body.push(
      `- **tier-contract violations: ${t.violationCount}** of ${t.total} dispatch receipt(s)` +
        ` — ${t.untieredCount} un-tiered (\`${UNTIERED_REASON}\`).`
    );
    for (const r of t.byReason) body.push(`  - reason \`${r.reason}\`: ${r.count}`);
    for (const r of t.byDecision) body.push(`  - decision \`${r.decision}\`: ${r.count}`);
  }
  if (a.parseErrors > 0) {
    body.push(
      `- **unverifiable sink records: ${a.parseErrors}** — treated as DIRTY (fail-closed):` +
        ` a corrupt/truncated line, a wrong-schema record, or an unreadable sink may hide a` +
        ` real degradation or tier violation. Inspect the raw jsonl.`
    );
  }
  return ["## Sink audit", "", body.join("\n")].join("\n");
}

/** One-line reflection hint when the sinks are dirty (for summary.md's Reflection hints). */
export function sinkAuditReflectionHint(a: RunSinkAudit): string | null {
  if (!isRunSinkDirty(a)) return null;
  const parts: string[] = [];
  if (a.degradations.count > 0) parts.push(`${a.degradations.count} backend degradation(s)`);
  if (a.tier.violationCount > 0)
    parts.push(
      `${a.tier.violationCount} tier-contract violation(s) (${a.tier.untieredCount} un-tiered)`
    );
  if (a.parseErrors > 0) parts.push(`${a.parseErrors} unverifiable sink record(s)`);
  return `- dispatch-integrity: ${parts.join(", ")} — see the Sink audit section; a downgraded/un-tiered run must not close clean.`;
}
