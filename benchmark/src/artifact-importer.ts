import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import type {
  EventLine,
  ReceiptSummary,
  RunJson,
  RunRecord,
} from "./types.js";

const runJsonSchema = z.object({
  schema_version: z.number().int().positive(),
  run_id: z.string().min(1),
  case_slug: z.string().min(1),
  plugin_ref: z.string().min(1),
  model_ref: z.record(z.string(), z.string()),
  started_at: z.string().min(1),
  completed_at: z.string().min(1),
  status: z.enum(["pass", "fail", "timeout", "errored"]),
  raw_command: z.string().optional(),
  wall_clock_ms: z.number().int().nonnegative().optional(),
  wall_clock_budget_ms: z.number().int().positive().optional(),
});

const eventSchema = z.discriminatedUnion("type", [
  z.object({ ts: z.string(), type: z.literal("stage_started"), stage: z.string() }),
  z.object({
    ts: z.string(),
    type: z.literal("stage_completed"),
    stage: z.string(),
    duration_ms: z.number().int().nonnegative(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal("specialist_dispatched"),
    specialist: z.string(),
    task_id: z.string(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal("specialist_completed"),
    specialist: z.string(),
    task_id: z.string(),
    status: z.enum(["complete", "blocked", "errored"]),
  }),
  z.object({ ts: z.string(), type: z.literal("gate_passed"), gate: z.string() }),
  z.object({
    ts: z.string(),
    type: z.literal("gate_skipped"),
    gate: z.string(),
    reason: z.string().optional(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal("tool_error"),
    tool: z.string(),
    exit_code: z.number().int(),
  }),
  z.object({
    ts: z.string(),
    type: z.literal("acceptance_command"),
    command: z.string(),
    exit_code: z.number().int(),
  }),
  z.object({ ts: z.string(), type: z.literal("retry"), what: z.string() }),
]);

export interface ImportFromFixtureOpts {
  fixturePath: string;
  runsDir: string;
  runId?: string;
}

export interface ImportResult {
  runDir: string;
  runId: string;
  partial: boolean;
  missing_artifacts: string[];
}

// Imports a fixture-shaped tree under `fixturePath` into `<runsDir>/<run-id>/`.
// Fixture layout (also the on-disk shape produced by the P3 runner):
//   <fixturePath>/run.json            — required, validated against runJsonSchema
//   <fixturePath>/events.ndjson       — optional; absence sets partial=true
//   <fixturePath>/.guild/             — optional; copied verbatim to artifacts/.guild/
export async function importFixture(opts: ImportFromFixtureOpts): Promise<ImportResult> {
  const fixtureAbs = resolve(opts.fixturePath);
  if (!existsSync(fixtureAbs)) {
    throw new Error(`Fixture path does not exist: ${fixtureAbs}`);
  }
  const fixtureRunPath = join(fixtureAbs, "run.json");
  if (!existsSync(fixtureRunPath)) {
    throw new Error(`Fixture missing run.json at ${fixtureRunPath}`);
  }
  const runJson = parseRunJson(await readFile(fixtureRunPath, "utf8"));
  const runId = opts.runId ?? runJson.run_id;
  const runDir = resolve(opts.runsDir, runId);
  await mkdir(runDir, { recursive: true });

  const updatedRun: RunJson = { ...runJson, run_id: runId };
  await writeFile(join(runDir, "run.json"), JSON.stringify(updatedRun, null, 2) + "\n");

  const missing: string[] = [];
  const eventsSource = join(fixtureAbs, "events.ndjson");
  if (existsSync(eventsSource)) {
    await copyFile(eventsSource, join(runDir, "events.ndjson"));
  } else {
    missing.push("events.ndjson");
  }

  const guildSource = join(fixtureAbs, ".guild");
  const artifactsDir = join(runDir, "artifacts", ".guild");
  if (existsSync(guildSource)) {
    await mkdir(artifactsDir, { recursive: true });
    await cp(guildSource, artifactsDir, { recursive: true });
  } else {
    missing.push("artifacts/.guild");
  }

  return { runDir, runId, partial: missing.length > 0, missing_artifacts: missing };
}

export async function loadRunRecord(runDir: string): Promise<RunRecord> {
  const abs = resolve(runDir);
  const runPath = join(abs, "run.json");
  if (!existsSync(runPath)) {
    throw new Error(`run.json not found at ${runPath}`);
  }
  const run = parseRunJson(await readFile(runPath, "utf8"));

  const eventsPath = join(abs, "events.ndjson");
  const missing: string[] = [];
  let events: EventLine[] = [];
  if (existsSync(eventsPath)) {
    events = parseEventsNdjson(await readFile(eventsPath, "utf8"));
  } else {
    missing.push("events.ndjson");
  }

  const artifactsRoot = join(abs, "artifacts", ".guild");
  if (!existsSync(artifactsRoot)) {
    missing.push("artifacts/.guild");
  }

  const receipts = existsSync(artifactsRoot) ? await collectReceipts(artifactsRoot) : [];
  const hasReview = await hasArtifact(artifactsRoot, "review");
  const hasAssumptions = await hasArtifact(artifactsRoot, "assumptions");
  const hasReflection = await hasArtifact(artifactsRoot, "reflect");

  return {
    run,
    events,
    runDir: abs,
    artifactsRoot,
    receipts,
    hasReview,
    hasAssumptions,
    hasReflection,
    partial: missing.length > 0,
    missing_artifacts: missing,
  };
}

export function parseRunJson(raw: string): RunJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`run.json is not valid JSON: ${(err as Error).message}`);
  }
  const validated = runJsonSchema.safeParse(parsed);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `  - ${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("\n");
    throw new Error(`run.json failed schema validation:\n${issues}`);
  }
  return validated.data;
}

export function parseEventsNdjson(raw: string): EventLine[] {
  const out: EventLine[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `events.ndjson line ${i + 1} is not valid JSON: ${(err as Error).message}`,
      );
    }
    const validated = eventSchema.safeParse(parsed);
    if (!validated.success) {
      const issues = validated.error.issues
        .map((iss) => `  - ${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("\n");
      throw new Error(`events.ndjson line ${i + 1} failed schema:\n${issues}`);
    }
    out.push(validated.data);
  }
  return out;
}

async function collectReceipts(artifactsRoot: string): Promise<ReceiptSummary[]> {
  const summaries: ReceiptSummary[] = [];
  const runsDir = join(artifactsRoot, "runs");
  if (!existsSync(runsDir)) return summaries;
  const innerRuns = await readdir(runsDir, { withFileTypes: true });
  for (const entry of innerRuns) {
    if (!entry.isDirectory()) continue;
    const handoffsDir = join(runsDir, entry.name, "handoffs");
    if (!existsSync(handoffsDir)) continue;
    const files = await readdir(handoffsDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const filePath = join(handoffsDir, f);
      const content = await readFile(filePath, "utf8");
      summaries.push(summariseReceipt(filePath, content));
    }
  }
  return summaries;
}

function summariseReceipt(filePath: string, content: string): ReceiptSummary {
  const taskMatch = content.match(/^task_id:\s*(.+)$/m);
  const specialistMatch = content.match(/^specialist:\s*(.+)$/m);
  const statusMatch = content.match(/^status:\s*(.+)$/m);
  const evidenceMatch = content.match(/##\s*Evidence([\s\S]*?)(?=\n##\s|$)/i);
  const evidenceText = evidenceMatch ? evidenceMatch[1].trim() : "";
  const evidence_chars = evidenceText.length;
  const evidence_present = evidence_chars >= 40;
  const taskId = (taskMatch ? taskMatch[1] : basename(filePath, ".md")).trim();
  return {
    task_id: taskId,
    specialist: (specialistMatch ? specialistMatch[1] : "unknown").trim(),
    status: (statusMatch ? statusMatch[1] : "unknown").trim(),
    evidence_present,
    evidence_chars,
  };
}

async function hasArtifact(
  artifactsRoot: string,
  kind: "review" | "assumptions" | "reflect",
): Promise<boolean> {
  if (!existsSync(artifactsRoot)) return false;
  const runsDir = join(artifactsRoot, "runs");
  if (!existsSync(runsDir)) return false;
  const inner = await readdir(runsDir, { withFileTypes: true });
  for (const entry of inner) {
    if (!entry.isDirectory()) continue;
    const candidates = [
      join(runsDir, entry.name, `${kind}.md`),
      ...(kind === "reflect" ? [join(runsDir, entry.name, "reflection.md")] : []),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        const content = await readFile(c, "utf8");
        if (content.trim().length > 0) return true;
      }
    }
  }
  return false;
}
