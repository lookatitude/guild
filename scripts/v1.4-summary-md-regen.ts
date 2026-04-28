#!/usr/bin/env -S npx tsx
/**
 * scripts/v1.4-summary-md-regen.ts
 *
 * Regenerates `<runDir>/logs/summary.md` from the live JSONL log + every
 * archived `.jsonl.gz` chunk + per-lane fallback files (Windows path).
 * Output is deterministic given the same input set.
 *
 * Implements the binding contract from
 * `benchmark/plans/v1.4-jsonl-schema.md` §"Post-rotation summary regen
 * contract":
 *   1. Reader takes the lockfile (handled by `snapshotLiveLog`).
 *   2. Ordering: archives in <N> ascending, then live log; within each
 *      file, by `ts` ascending. Append-order is the primary key; `ts`
 *      is the tie-breaker.
 *   3. Schema validation: every line is `JSON.parse`-able and matches
 *      schema_version: 1. Failures logged to stderr + skipped.
 *   4. Output sections: Phases / Specialist dispatches / Loop rounds /
 *      Gates / Tools / Hooks / Escalations / Assumptions / Codex review.
 *   5. Determinism: two regens against the same JSONL set produce
 *      byte-identical summary.md.
 *   6. Backwards-compat: unknown event types get a `## Unrecognized
 *      events` section.
 *
 * Usage:
 *   npx tsx scripts/v1.4-summary-md-regen.ts --run-dir <path> [--out <path>]
 *
 * Library API:
 *   import { regenerateSummary } from "./v1.4-summary-md-regen.js";
 *   const md = await regenerateSummary({ runDir });
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import {
  readAllEvents,
  summaryPath,
  type JsonlEvent,
  type ToolCallEvent,
  type HookEvent,
  type PhaseStartEvent,
  type PhaseEndEvent,
  type SpecialistDispatchEvent,
  type SpecialistReceiptEvent,
  type LoopRoundStartEvent,
  type LoopRoundEndEvent,
  type GateDecisionEvent,
  type EscalationEvent,
  type AssumptionLoggedEvent,
  type CodexReviewRoundEvent,
} from "../benchmark/src/log-jsonl.js";
import { validateEvent } from "./v1.4-log-validator.js";

// ──────────────────────────────────────────────────────────────────────────
// Latency aggregation helpers — p50 / p99
// ──────────────────────────────────────────────────────────────────────────

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

interface ToolAgg {
  count: number;
  latencies: number[];
  errCount: number;
  okCount: number;
  naCount: number;
}

interface HookAgg {
  count: number;
  latencies: number[];
  errCount: number;
  okCount: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Section builders — one per schema-doc §"Post-rotation summary regen"
// ──────────────────────────────────────────────────────────────────────────

function buildPhasesSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Phases"];
  // Walk in order; pair phase_start with the next matching phase_end.
  const pendingByPhase = new Map<string, PhaseStartEvent>();
  const closed: Array<{ start: PhaseStartEvent; end: PhaseEndEvent }> = [];
  for (const e of events) {
    if (e.event === "phase_start") {
      pendingByPhase.set(e.phase, e);
    } else if (e.event === "phase_end") {
      const start = pendingByPhase.get(e.phase);
      if (start) {
        closed.push({ start, end: e });
        pendingByPhase.delete(e.phase);
      }
    }
  }
  if (closed.length === 0 && pendingByPhase.size === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  for (const { start, end } of closed) {
    out.push(`- **${start.phase}** — ${end.duration_ms}ms — ${end.status}`);
  }
  for (const start of pendingByPhase.values()) {
    out.push(`- **${start.phase}** — (started ${start.ts}, no phase_end)`);
  }
  return out.join("\n") + "\n";
}

function buildDispatchesSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Specialist dispatches"];
  // Pair dispatches with their receipts by `lane_id + specialist`.
  const dispatched: Array<SpecialistDispatchEvent> = [];
  const receipts = new Map<string, SpecialistReceiptEvent>();
  for (const e of events) {
    if (e.event === "specialist_dispatch") dispatched.push(e);
    else if (e.event === "specialist_receipt") {
      receipts.set(`${e.lane_id}|${e.specialist}`, e);
    }
  }
  if (dispatched.length === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  for (const d of dispatched) {
    const r = receipts.get(`${d.lane_id}|${d.specialist}`);
    if (r) {
      out.push(`- ${d.specialist} / ${d.lane_id} — receipt: ${r.receipt_path}`);
    } else {
      out.push(`- ${d.specialist} / ${d.lane_id} — (no receipt yet)`);
    }
  }
  return out.join("\n") + "\n";
}

function buildLoopRoundsSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Loop rounds"];
  // Group by lane × layer; count rounds; record terminator(s).
  interface Bucket {
    rounds: number;
    terminators: string[];
    terminations: string[];
  }
  const buckets = new Map<string, Bucket>();
  for (const e of events) {
    if (e.event !== "loop_round_end") continue;
    const lane = e as LoopRoundEndEvent;
    const key = `${lane.lane_id}|${lane.loop_layer}`;
    const b = buckets.get(key) ?? { rounds: 0, terminators: [], terminations: [] };
    b.rounds = Math.max(b.rounds, lane.round_number);
    b.terminators.push(lane.terminator);
    b.terminations.push(lane.terminated);
    buckets.set(key, b);
  }
  if (buckets.size === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  out.push("| Lane | Layer | Rounds | Final terminator | Final outcome |");
  out.push("| --- | --- | --: | --- | --- |");
  // Sort keys for determinism.
  const keys = [...buckets.keys()].sort();
  for (const key of keys) {
    const [lane, layer] = key.split("|");
    const b = buckets.get(key);
    if (!b) continue;
    const lastTerminator = b.terminators[b.terminators.length - 1] ?? "";
    const lastOutcome = b.terminations[b.terminations.length - 1] ?? "";
    out.push(`| ${lane} | ${layer} | ${b.rounds} | ${lastTerminator} | ${lastOutcome} |`);
  }
  return out.join("\n") + "\n";
}

function buildGatesSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Gates"];
  const gates = events.filter((e): e is GateDecisionEvent => e.event === "gate_decision");
  if (gates.length === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  for (const g of gates) {
    out.push(`- ${g.gate} — ${g.decision} — source: ${g.source}`);
  }
  return out.join("\n") + "\n";
}

function buildToolsSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Tools"];
  const aggs = new Map<string, ToolAgg>();
  for (const e of events) {
    if (e.event !== "tool_call") continue;
    const t = e as ToolCallEvent;
    const a = aggs.get(t.tool) ?? {
      count: 0,
      latencies: [],
      errCount: 0,
      okCount: 0,
      naCount: 0,
    };
    a.count += 1;
    a.latencies.push(t.latency_ms);
    if (t.status === "ok") a.okCount += 1;
    else if (t.status === "err") a.errCount += 1;
    else a.naCount += 1;
    aggs.set(t.tool, a);
  }
  if (aggs.size === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  out.push("| Tool | Count | ok | err | n/a | p50 ms | p99 ms |");
  out.push("| --- | --: | --: | --: | --: | --: | --: |");
  const keys = [...aggs.keys()].sort();
  for (const key of keys) {
    const a = aggs.get(key);
    if (!a) continue;
    out.push(
      `| ${key} | ${a.count} | ${a.okCount} | ${a.errCount} | ${a.naCount} | ${percentile(a.latencies, 50)} | ${percentile(a.latencies, 99)} |`,
    );
  }
  return out.join("\n") + "\n";
}

function buildHooksSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Hooks"];
  const aggs = new Map<string, HookAgg>();
  for (const e of events) {
    if (e.event !== "hook_event") continue;
    const h = e as HookEvent;
    const a = aggs.get(h.hook_name) ?? {
      count: 0,
      latencies: [],
      errCount: 0,
      okCount: 0,
    };
    a.count += 1;
    a.latencies.push(h.latency_ms);
    if (h.status === "ok") a.okCount += 1;
    else a.errCount += 1;
    aggs.set(h.hook_name, a);
  }
  if (aggs.size === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  out.push("| Hook | Count | ok | err | p50 ms | p99 ms |");
  out.push("| --- | --: | --: | --: | --: | --: |");
  const keys = [...aggs.keys()].sort();
  for (const key of keys) {
    const a = aggs.get(key);
    if (!a) continue;
    out.push(
      `| ${key} | ${a.count} | ${a.okCount} | ${a.errCount} | ${percentile(a.latencies, 50)} | ${percentile(a.latencies, 99)} |`,
    );
  }
  return out.join("\n") + "\n";
}

function buildEscalationsSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Escalations"];
  const esc = events.filter((e): e is EscalationEvent => e.event === "escalation");
  if (esc.length === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  for (const e of esc) {
    out.push(
      `- ${e.lane_id ?? "(no-lane)"} — reason: ${e.reason} — choice: ${e.user_choice} — options: [${e.options_offered.join(", ")}]`,
    );
  }
  return out.join("\n") + "\n";
}

function buildAssumptionsSection(events: JsonlEvent[]): string {
  const out: string[] = ["## Assumptions"];
  const ass = events.filter(
    (e): e is AssumptionLoggedEvent => e.event === "assumption_logged",
  );
  if (ass.length === 0) {
    out.push("(none)");
    return out.join("\n") + "\n";
  }
  for (const a of ass) {
    out.push(`- ${a.specialist} / ${a.lane_id}: ${a.assumption_text}`);
  }
  return out.join("\n") + "\n";
}

function buildCodexSection(events: JsonlEvent[]): string {
  // Only emit the section if codex events exist (schema doc §6 contract:
  // "only present when codex_review_round events exist").
  const codex = events.filter(
    (e): e is CodexReviewRoundEvent => e.event === "codex_review_round",
  );
  if (codex.length === 0) return "";
  const out: string[] = ["## Codex review"];
  for (const c of codex) {
    out.push(
      `- ${c.gate} — round ${c.round_number} — satisfied: ${c.terminated_by_satisfied}`,
    );
  }
  return out.join("\n") + "\n";
}

function buildUnrecognizedSection(events: JsonlEvent[]): string {
  // Backwards-compat per schema doc §6.6 — events whose `event` field is
  // a string we don't model in this version. The reader filter already
  // dropped them; this section is informative only and emits when our
  // local filter is permissive (future schema_version > 1).
  const known = new Set<string>([
    "phase_start",
    "phase_end",
    "specialist_dispatch",
    "specialist_receipt",
    "loop_round_start",
    "loop_round_end",
    "tool_call",
    "hook_event",
    "gate_decision",
    "assumption_logged",
    "escalation",
    "codex_review_round",
  ]);
  const unknown: string[] = [];
  for (const e of events) {
    if (!known.has(e.event)) unknown.push(e.event);
  }
  if (unknown.length === 0) return "";
  const counts = new Map<string, number>();
  for (const u of unknown) counts.set(u, (counts.get(u) ?? 0) + 1);
  const out: string[] = ["## Unrecognized events"];
  for (const k of [...counts.keys()].sort()) {
    out.push(`- ${k}: ${counts.get(k) ?? 0}`);
  }
  return out.join("\n") + "\n";
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry — read all events, emit summary.md
// ──────────────────────────────────────────────────────────────────────────

export interface RegenOptions {
  /** Run dir under `.guild/runs/<run-id>/`. */
  runDir: string;
  /** Override output path; defaults to `<runDir>/logs/summary.md`. */
  outPath?: string;
}

export interface RegenResult {
  /** The exact bytes written to `summary.md`. */
  markdown: string;
  /** The path written. */
  outPath: string;
  /** Count of events read across all sources. */
  eventCount: number;
  /** Count of skipped lines (validation failures). */
  skipped: number;
}

/**
 * Regenerate the summary.md for a run. Returns the markdown string plus
 * write metadata. Writes to disk by default; pass `outPath` to redirect.
 *
 * Determinism: ordering of events is by source priority (archives first
 * in <N>-ascending order, then live, then per-lane fallback files in
 * alphabetical order); within a source, by file order. Two regens
 * against the same input set produce byte-identical output.
 */
export async function regenerateSummary(opts: RegenOptions): Promise<RegenResult> {
  let skipped = 0;
  // Architect schema doc lines 386-401: events are ordered by SOURCE
  // priority (archives in N-ascending order, then live, then per-lane
  // fallback files alphabetically); within a source, append order is
  // the primary key. `ts` is ONLY a tie-breaker for same-millisecond
  // events from parallel processes within the same file — NOT a global
  // sort key. A global ts-sort would promote a live event written at
  // 07:00:00.000Z above an archive event also at 07:00:00.000Z, which
  // is forbidden.
  //
  // Implementation: `readAllEvents` returns events in the architect's
  // source-priority order with append-order preserved within each file.
  // We do NOT re-sort; the read order IS the canonical order.
  // Architect schema lines 402-406: every line must pass `validateEvent()`
  // before inclusion; invalid lines are skipped with a callback reason.
  const events = await readAllEvents(opts.runDir, {
    onSkip: () => {
      skipped += 1;
    },
    validate: (parsed) => {
      const result = validateEvent(parsed);
      if (result.ok) return { ok: true };
      return { ok: false, reason: result.errors.join("; ") };
    },
  });
  const ordered = events;

  const sections: string[] = [
    `# Run summary — ${opts.runDir}`,
    "",
    buildPhasesSection(ordered),
    buildDispatchesSection(ordered),
    buildLoopRoundsSection(ordered),
    buildGatesSection(ordered),
    buildToolsSection(ordered),
    buildHooksSection(ordered),
    buildEscalationsSection(ordered),
    buildAssumptionsSection(ordered),
  ];
  const codex = buildCodexSection(ordered);
  if (codex.length > 0) sections.push(codex);
  const unrecognized = buildUnrecognizedSection(ordered);
  if (unrecognized.length > 0) sections.push(unrecognized);

  const md = sections.join("\n");
  const out = opts.outPath ?? summaryPath(opts.runDir);
  if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md);
  return { markdown: md, outPath: out, eventCount: ordered.length, skipped };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint
// ──────────────────────────────────────────────────────────────────────────

function isMainModule(): boolean {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return /v1\.4-summary-md-regen\.[tj]s$/.test(arg1);
}

async function cliMain(argv: string[]): Promise<number> {
  let runDir: string | undefined;
  let outPath: string | undefined;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--run-dir" && argv[i + 1]) {
      runDir = argv[++i];
    } else if (a?.startsWith("--run-dir=")) {
      runDir = a.slice("--run-dir=".length);
    } else if (a === "--out" && argv[i + 1]) {
      outPath = argv[++i];
    } else if (a?.startsWith("--out=")) {
      outPath = a.slice("--out=".length);
    }
  }
  if (!runDir) {
    process.stderr.write(
      "usage: v1.4-summary-md-regen --run-dir <path> [--out <path>]\n",
    );
    return 2;
  }
  const result = await regenerateSummary({ runDir, ...(outPath ? { outPath } : {}) });
  process.stdout.write(
    `summary regen: ${result.eventCount} events → ${result.outPath} (${result.skipped} skipped)\n`,
  );
  return 0;
}

if (isMainModule()) {
  cliMain(process.argv).then((code) => process.exit(code), (err) => {
    process.stderr.write(`summary regen failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
