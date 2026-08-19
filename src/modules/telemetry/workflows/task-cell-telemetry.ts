/** Durable TaskCell lifecycle telemetry and run-level metric derivation (G11). */
import * as fs from "fs";
import * as path from "path";
import { isRefused, prepareContainedWrite } from "../../kernel";

export const TASK_CELL_LIFECYCLE_EVENT_SCHEMA = "guild.task_cell_lifecycle_event.v1" as const;
export const TASK_CELL_USAGE_SCHEMA = "guild.task_cell_usage.v1" as const;

export const TASK_CELL_LIFECYCLE_EVENTS = Object.freeze([
  "spawn_started",
  "spawned",
  "ready",
  "assignment_delivered",
  "assignment_acknowledged",
  "running",
  "handoff_submitted",
  "handoff_validated",
  "handoff_accepted",
  "termination_started",
  "terminated",
  "failed",
  "cancelled",
  "timed_out",
  "rejected",
  "orphaned",
  "reaped",
] as const);

export type TaskCellLifecycleEventName = (typeof TASK_CELL_LIFECYCLE_EVENTS)[number];
export type TaskCellTelemetrySubstrate = "tmux" | "cmux" | "in-process" | "serial" | "remote";
export type TaskCellTelemetryMechanicsMode = "native" | "wrapped" | "bridged" | "emulated" | "degraded";

export interface TaskCellLifecycleEventInput {
  event_id: string;
  event_name: TaskCellLifecycleEventName;
  at: string;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  attempt_id: string;
  instance_id: string;
  substrate: TaskCellTelemetrySubstrate;
  mechanics_mode: TaskCellTelemetryMechanicsMode;
  degradation_reasons: string[];
  specialist_type_hash?: string;
  specialist_profile_hash?: string;
  context_bundle_hash?: string;
  host_capabilities_hash?: string;
  projection_hash?: string;
  context_bundle_bytes?: number;
}

export interface TaskCellLifecycleEventV1 extends TaskCellLifecycleEventInput {
  schema_version: typeof TASK_CELL_LIFECYCLE_EVENT_SCHEMA;
}

export interface TaskCellUsageV1 {
  schema_version: typeof TASK_CELL_USAGE_SCHEMA;
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  attempt_id: string;
  instance_id: string;
  tokens: number;
  cost_usd: number;
  source: string;
  measured_at: string;
}

export interface TaskCellInstanceTelemetry {
  run_id: string;
  cell_id: string;
  logical_task_id: string;
  task_run_id: string;
  attempt: number;
  attempt_id: string;
  instance_id: string;
  substrate: TaskCellTelemetrySubstrate;
  mechanics_mode: TaskCellTelemetryMechanicsMode;
  degradation_reasons: string[];
  latency_ms: {
    spawn: number | null;
    ready: number | null;
    assign: number | null;
    ack: number | null;
    handoff: number | null;
    accept: number | null;
    terminate: number | null;
  };
  bundle: {
    specialist_type_hash: string | null;
    specialist_profile_hash: string | null;
    context_bundle_hash: string | null;
    host_capabilities_hash: string | null;
    projection_hash: string | null;
    context_bundle_bytes: number | null;
  };
  usage:
    | { status: "measured"; tokens: number; cost_usd: number; source: string; measured_at: string }
    | { status: "unavailable"; tokens: null; cost_usd: null; reason: string };
  terminal_event: Extract<TaskCellLifecycleEventName, "terminated" | "failed" | "cancelled" | "timed_out" | "rejected" | "reaped"> | null;
  orphaned: boolean;
  leaked: boolean;
}

export interface TaskCellTelemetrySummary {
  schema_version: "guild.task_cell_telemetry_summary.v1";
  run_id: string;
  ok: boolean;
  instances: TaskCellInstanceTelemetry[];
  totals: { instances: number; tokens: number | null; cost_usd: number | null };
  rates: {
    success: number;
    retry: number;
    rejection: number;
    timeout: number;
    duplicate: number;
    orphan: number;
    leak: number;
  };
}

const SAFE_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const EVENT_NAMES = new Set<string>(TASK_CELL_LIFECYCLE_EVENTS);
const SUBSTRATES = new Set<string>(["tmux", "in-process", "serial", "remote"]);
const MECHANICS = new Set<string>(["native", "wrapped", "bridged", "emulated", "degraded"]);
const TERMINAL_EVENTS = new Set<TaskCellLifecycleEventName>(["terminated", "failed", "cancelled", "timed_out", "rejected", "reaped"]);

function own(o: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(o, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validIso(value: unknown): value is string {
  return nonBlank(value) && Number.isFinite(Date.parse(value));
}

function validSegment(value: unknown): value is string {
  return nonBlank(value) && SAFE_SEGMENT.test(value) && value !== "." && value !== "..";
}

function validNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function eventRecord(value: unknown): TaskCellLifecycleEventV1 | null {
  if (!plain(value)) return null;
  const strings = ["event_id", "run_id", "cell_id", "logical_task_id", "task_run_id", "attempt_id", "instance_id"];
  if (own(value, "schema_version") !== TASK_CELL_LIFECYCLE_EVENT_SCHEMA) return null;
  if (strings.some((key) => !validSegment(own(value, key)))) return null;
  if (!EVENT_NAMES.has(String(own(value, "event_name"))) || !validIso(own(value, "at"))) return null;
  if (!Number.isInteger(own(value, "attempt")) || Number(own(value, "attempt")) < 1) return null;
  if (!SUBSTRATES.has(String(own(value, "substrate"))) || !MECHANICS.has(String(own(value, "mechanics_mode")))) return null;
  const losses = own(value, "degradation_reasons");
  if (!Array.isArray(losses) || losses.some((item) => !nonBlank(item))) return null;
  for (const key of ["specialist_type_hash", "specialist_profile_hash", "context_bundle_hash", "host_capabilities_hash", "projection_hash"]) {
    const item = own(value, key);
    if (item !== undefined && !nonBlank(item)) return null;
  }
  const bytes = own(value, "context_bundle_bytes");
  if (bytes !== undefined && (!Number.isInteger(bytes) || Number(bytes) < 0)) return null;
  return value as unknown as TaskCellLifecycleEventV1;
}

function usageRecord(value: unknown): TaskCellUsageV1 | null {
  if (!plain(value) || own(value, "schema_version") !== TASK_CELL_USAGE_SCHEMA) return null;
  for (const key of ["run_id", "cell_id", "logical_task_id", "task_run_id", "attempt_id", "instance_id"]) {
    if (!validSegment(own(value, key))) return null;
  }
  if (!Number.isInteger(own(value, "attempt")) || Number(own(value, "attempt")) < 1) return null;
  if (!validNonNegative(own(value, "tokens")) || !Number.isInteger(own(value, "tokens"))) return null;
  if (!validNonNegative(own(value, "cost_usd")) || !nonBlank(own(value, "source")) || !validIso(own(value, "measured_at"))) return null;
  return value as unknown as TaskCellUsageV1;
}

function telemetryDir(cwd: string, runId: string): string {
  if (!validSegment(runId)) throw new Error(`unsafe run id: ${JSON.stringify(runId)}`);
  const target = path.join(".guild", "runs", runId, "task-cell-telemetry", "events.jsonl");
  const prepared = prepareContainedWrite(cwd, target, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new Error(`task-cell telemetry path refused (${prepared.code})`);
  return prepared.realDir;
}

function eventsPath(cwd: string, runId: string): string {
  return path.join(telemetryDir(cwd, runId), "events.jsonl");
}

function containedChildDir(parent: string, name: string): string {
  const prepared = prepareContainedWrite(parent, path.join(name, ".containment-probe"), { policy: "physical" });
  if (isRefused(prepared)) throw new Error(`task-cell telemetry ${name} path refused (${prepared.code})`);
  return prepared.realDir;
}

export function readTaskCellLifecycleEvents(input: { cwd: string; runId: string }): TaskCellLifecycleEventV1[] {
  const file = eventsPath(input.cwd, input.runId);
  if (!fs.existsSync(file)) return [];
  const ids = new Set<string>();
  const lastAt = new Map<string, number>();
  const identities = new Map<string, Pick<TaskCellLifecycleEventV1, "cell_id" | "logical_task_id" | "task_run_id" | "attempt" | "attempt_id" | "substrate" | "mechanics_mode">>();
  const events: TaskCellLifecycleEventV1[] = [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let raw: unknown;
    try { raw = JSON.parse(line); } catch { throw new Error(`invalid telemetry ledger at line ${index + 1}`); }
    const event = eventRecord(raw);
    if (!event || event.run_id !== input.runId) throw new Error(`invalid telemetry ledger at line ${index + 1}`);
    if (ids.has(event.event_id)) throw new Error(`duplicate event_id: ${event.event_id}`);
    const identity = {
      cell_id: event.cell_id,
      logical_task_id: event.logical_task_id,
      task_run_id: event.task_run_id,
      attempt: event.attempt,
      attempt_id: event.attempt_id,
      substrate: event.substrate,
      mechanics_mode: event.mechanics_mode,
    };
    const priorIdentity = identities.get(event.instance_id);
    if (priorIdentity && JSON.stringify(priorIdentity) !== JSON.stringify(identity)) {
      throw new Error(`lifecycle identity drift for ${event.instance_id} at line ${index + 1}`);
    }
    const timestamp = Date.parse(event.at);
    const priorAt = lastAt.get(event.instance_id);
    if (priorAt !== undefined && timestamp < priorAt) throw new Error(`non-monotonic lifecycle event for ${event.instance_id} at line ${index + 1}`);
    ids.add(event.event_id);
    identities.set(event.instance_id, identity);
    lastAt.set(event.instance_id, timestamp);
    events.push(event);
  }
  return events;
}

export function appendTaskCellLifecycleEvent(input: { cwd: string; event: TaskCellLifecycleEventInput }): TaskCellLifecycleEventV1 {
  const event: TaskCellLifecycleEventV1 = { schema_version: TASK_CELL_LIFECYCLE_EVENT_SCHEMA, ...input.event };
  if (!eventRecord(event)) throw new Error("invalid guild.task_cell_lifecycle_event.v1");
  const root = telemetryDir(input.cwd, event.run_id);
  const eventIds = containedChildDir(root, "event-ids");
  const marker = path.join(eventIds, event.event_id);
  try { fs.writeFileSync(marker, `${event.at}\n`, { encoding: "utf8", flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`duplicate event_id: ${event.event_id}`);
    throw error;
  }
  fs.appendFileSync(eventsPath(input.cwd, event.run_id), `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  return event;
}

export function recordTaskCellUsage(input: { cwd: string; usage: TaskCellUsageV1 }): string {
  const usage = usageRecord(input.usage);
  if (!usage) throw new Error("invalid guild.task_cell_usage.v1");
  const dir = containedChildDir(telemetryDir(input.cwd, usage.run_id), "usage");
  const file = path.join(dir, `${usage.instance_id}.json`);
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`usage record is not a regular file: ${usage.instance_id}`);
    let existing: unknown;
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`invalid existing usage record: ${usage.instance_id}`); }
    const validated = usageRecord(existing);
    if (!validated || JSON.stringify(validated) !== JSON.stringify(usage)) throw new Error(`conflicting usage record already exists: ${usage.instance_id}`);
    return path.relative(fs.realpathSync(path.resolve(input.cwd)), file);
  }
  fs.writeFileSync(file, `${JSON.stringify(usage, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return path.relative(fs.realpathSync(path.resolve(input.cwd)), file);
}

export interface TaskCellTraceUsageImportResult {
  ok: boolean;
  imported: string[];
  unavailable: Array<{ instance_id: string; reason: string }>;
  parse_errors: number;
}

/**
 * Attribute provider usage only through the exact launcher-injected TaskCell
 * instance id. Role/task names are deliberately ignored: they are not runtime
 * identities and would merge retries or same-role parallel lanes.
 */
export function importTaskCellUsageFromTrace(input: { cwd: string; runId: string }): TaskCellTraceUsageImportResult {
  const lifecycle = readTaskCellLifecycleEvents(input);
  const instanceIds = [...new Set(lifecycle.map((item) => item.instance_id))].sort();
  if (instanceIds.length === 0) return { ok: false, imported: [], unavailable: [], parse_errors: 0 };
  const runDir = path.join(fs.realpathSync(path.resolve(input.cwd)), ".guild", "runs", input.runId);
  const canonical = path.join(runDir, "logs", "v1.4-events.jsonl");
  const legacy = path.join(runDir, "events.ndjson");
  const traceFile = fs.existsSync(canonical) ? canonical : legacy;
  if (!fs.existsSync(traceFile)) {
    return {
      ok: false,
      imported: [],
      unavailable: instanceIds.map((instance_id) => ({ instance_id, reason: "no canonical or legacy trace log" })),
      parse_errors: 0,
    };
  }
  const events: Record<string, unknown>[] = [];
  let parseErrors = 0;
  for (const rawLine of fs.readFileSync(traceFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (plain(parsed)) events.push(parsed);
      else parseErrors += 1;
    } catch { parseErrors += 1; }
  }
  if (parseErrors > 0) {
    return {
      ok: false,
      imported: [],
      unavailable: instanceIds.map((instance_id) => ({ instance_id, reason: "trace log contains parse errors" })),
      parse_errors: parseErrors,
    };
  }
  const eventIds = new Set<string>();
  for (const event of events) {
    const eventId = own(event, "event_id");
    if (!nonBlank(eventId)) continue;
    if (eventIds.has(eventId)) {
      return {
        ok: false,
        imported: [],
        unavailable: instanceIds.map((instance_id) => ({ instance_id, reason: `duplicate trace event_id ${eventId}` })),
        parse_errors: 0,
      };
    }
    eventIds.add(eventId);
  }

  const imported: string[] = [];
  const unavailable: Array<{ instance_id: string; reason: string }> = [];
  for (const instanceId of instanceIds) {
    let tokens = 0;
    let cost = 0;
    let sawTokens = false;
    let sawCost = false;
    let measuredAt: string | null = null;
    let invalidUsageField: string | null = null;
    for (const event of events) {
      if (own(event, "task_cell_instance_id") !== instanceId) continue;
      const traceTokens = own(event, "tokens");
      if (!plain(traceTokens)) {
        if (Object.prototype.hasOwnProperty.call(event, "tokens")) invalidUsageField = "tokens envelope";
        if (invalidUsageField) break;
        continue;
      }
      for (const key of ["input", "output", "cached", "cost_usd"]) {
        if (Object.prototype.hasOwnProperty.call(traceTokens, key) && !validNonNegative(own(traceTokens, key))) {
          invalidUsageField = key;
          break;
        }
      }
      if (invalidUsageField) break;
      const inputTokens = own(traceTokens, "input");
      const outputTokens = own(traceTokens, "output");
      const eventCost = own(traceTokens, "cost_usd");
      if (validNonNegative(inputTokens)) { tokens += inputTokens; sawTokens = true; }
      if (validNonNegative(outputTokens)) { tokens += outputTokens; sawTokens = true; }
      if (validNonNegative(eventCost)) { cost += eventCost; sawCost = true; }
      const at = own(event, "at") ?? own(event, "ts");
      if (validIso(at) && (measuredAt === null || Date.parse(at) > Date.parse(measuredAt))) measuredAt = at;
    }
    if (invalidUsageField) {
      unavailable.push({ instance_id: instanceId, reason: `trace usage contains invalid ${invalidUsageField}` });
      continue;
    }
    if (!sawTokens) { unavailable.push({ instance_id: instanceId, reason: "no exact-instance token usage in trace" }); continue; }
    if (!sawCost) { unavailable.push({ instance_id: instanceId, reason: "no exact-instance cost usage in trace" }); continue; }
    if (measuredAt === null) { unavailable.push({ instance_id: instanceId, reason: "trace usage has no valid timestamp" }); continue; }
    const first = lifecycle.find((item) => item.instance_id === instanceId)!;
    recordTaskCellUsage({
      cwd: input.cwd,
      usage: {
        schema_version: TASK_CELL_USAGE_SCHEMA,
        run_id: first.run_id,
        cell_id: first.cell_id,
        logical_task_id: first.logical_task_id,
        task_run_id: first.task_run_id,
        attempt: first.attempt,
        attempt_id: first.attempt_id,
        instance_id: instanceId,
        tokens: Math.round(tokens),
        cost_usd: Math.round(cost * 1_000_000_000) / 1_000_000_000,
        source: "guild.trace_event.v2",
        measured_at: measuredAt,
      },
    });
    imported.push(instanceId);
  }
  return { ok: unavailable.length === 0, imported, unavailable, parse_errors: 0 };
}

function readUsage(cwd: string, runId: string, instanceId: string): TaskCellUsageV1 | null {
  const file = path.join(telemetryDir(cwd, runId), "usage", `${instanceId}.json`);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error(`invalid usage record: ${instanceId}`); }
  const usage = usageRecord(raw);
  if (!usage || usage.run_id !== runId || usage.instance_id !== instanceId) throw new Error(`invalid usage record: ${instanceId}`);
  return usage;
}

function millis(events: readonly TaskCellLifecycleEventV1[], from: TaskCellLifecycleEventName, to: TaskCellLifecycleEventName): number | null {
  const a = events.find((item) => item.event_name === from);
  const b = events.find((item) => item.event_name === to);
  if (!a || !b) return null;
  const value = Date.parse(b.at) - Date.parse(a.at);
  return value >= 0 ? value : null;
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

export function summarizeTaskCellTelemetry(input: { cwd: string; runId: string }): TaskCellTelemetrySummary {
  const events = readTaskCellLifecycleEvents(input);
  const byInstance = new Map<string, TaskCellLifecycleEventV1[]>();
  for (const event of events) {
    const list = byInstance.get(event.instance_id);
    if (list) list.push(event); else byInstance.set(event.instance_id, [event]);
  }

  const instances: TaskCellInstanceTelemetry[] = [];
  let duplicateCount = 0;
  for (const [instanceId, raw] of byInstance) {
    const ordered = [...raw].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = ordered[0];
    const metadata = ordered.find((item) => item.event_name === "spawn_started") ?? first;
    const terminals = ordered.filter((item) => TERMINAL_EVENTS.has(item.event_name));
    const terminal = terminals.at(-1) ?? null;
    const spawnCount = ordered.filter((item) => item.event_name === "spawn_started").length;
    if (spawnCount > 1) duplicateCount += spawnCount - 1;
    const usage = readUsage(input.cwd, input.runId, instanceId);
    const degradation = [...new Set(ordered.flatMap((item) => item.degradation_reasons))].sort();
    instances.push({
      run_id: first.run_id,
      cell_id: first.cell_id,
      logical_task_id: first.logical_task_id,
      task_run_id: first.task_run_id,
      attempt: first.attempt,
      attempt_id: first.attempt_id,
      instance_id: instanceId,
      substrate: first.substrate,
      mechanics_mode: first.mechanics_mode,
      degradation_reasons: degradation,
      latency_ms: {
        spawn: millis(ordered, "spawn_started", "spawned"),
        ready: millis(ordered, "spawned", "ready"),
        assign: millis(ordered, "ready", "assignment_delivered"),
        ack: millis(ordered, "assignment_delivered", "assignment_acknowledged"),
        handoff: millis(ordered, "running", "handoff_submitted"),
        accept: millis(ordered, "handoff_validated", "handoff_accepted"),
        terminate: millis(ordered, "termination_started", terminal?.event_name ?? "terminated"),
      },
      bundle: {
        specialist_type_hash: metadata.specialist_type_hash ?? null,
        specialist_profile_hash: metadata.specialist_profile_hash ?? null,
        context_bundle_hash: metadata.context_bundle_hash ?? null,
        host_capabilities_hash: metadata.host_capabilities_hash ?? null,
        projection_hash: metadata.projection_hash ?? null,
        context_bundle_bytes: metadata.context_bundle_bytes ?? null,
      },
      usage: usage
        ? { status: "measured", tokens: usage.tokens, cost_usd: usage.cost_usd, source: usage.source, measured_at: usage.measured_at }
        : { status: "unavailable", tokens: null, cost_usd: null, reason: "no measured usage record" },
      terminal_event: terminal ? terminal.event_name as TaskCellInstanceTelemetry["terminal_event"] : null,
      orphaned: ordered.some((item) => item.event_name === "orphaned"),
      leaked: terminal === null,
    });
  }
  instances.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
  const total = instances.length;
  const measured = instances.filter((item) => item.usage.status === "measured");
  const attemptsByTask = new Map<string, number>();
  for (const item of instances) attemptsByTask.set(item.logical_task_id, Math.max(attemptsByTask.get(item.logical_task_id) ?? 0, item.attempt));
  const retryCount = instances.filter((item) => item.attempt > 1).length;
  const rejectionCount = instances.filter((item) => item.terminal_event === "rejected").length;
  const timeoutCount = instances.filter((item) => item.terminal_event === "timed_out").length;
  const orphanCount = instances.filter((item) => item.orphaned).length;
  const leakCount = instances.filter((item) => item.leaked).length;
  const successCount = instances.filter((item) => item.terminal_event === "terminated" || item.terminal_event === "reaped").length;
  return {
    schema_version: "guild.task_cell_telemetry_summary.v1",
    run_id: input.runId,
    ok: total > 0 && measured.length === total && duplicateCount === 0 && orphanCount === 0 && leakCount === 0,
    instances,
    totals: {
      instances: total,
      tokens: measured.length === total ? measured.reduce((sum, item) => sum + (item.usage.status === "measured" ? item.usage.tokens : 0), 0) : null,
      cost_usd: measured.length === total ? measured.reduce((sum, item) => sum + (item.usage.status === "measured" ? item.usage.cost_usd : 0), 0) : null,
    },
    rates: {
      success: rate(successCount, total),
      retry: rate(retryCount, total),
      rejection: rate(rejectionCount, total),
      timeout: rate(timeoutCount, total),
      duplicate: rate(duplicateCount, total),
      orphan: rate(orphanCount, total),
      leak: rate(leakCount, total),
    },
  };
}
