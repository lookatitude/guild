import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MetricsJson, RunJson, Score } from "../src/types.js";

// Shared helpers for HTTP integration tests. We never bind a real port —
// `createApp().fetch(new Request(...))` is the in-process pattern T2 backend
// recommended (see handoffs/T2-backend.md → Follow-ups → route: qa).

export interface SeedOpts {
  status?: RunJson["status"];
  guild_score?: number;
  plugin_ref?: string;
  case_slug?: string;
  model_ref?: Record<string, string>;
  outcomeRaw?: number;
  withMetrics?: boolean;
  withScore?: boolean;
  withEvents?: boolean;
}

export async function seedRun(
  runsDir: string,
  runId: string,
  opts: SeedOpts = {},
): Promise<string> {
  const dir = join(runsDir, runId);
  await mkdir(dir, { recursive: true });

  const run: RunJson = {
    schema_version: 1,
    run_id: runId,
    case_slug: opts.case_slug ?? "demo-url-shortener-build",
    plugin_ref: opts.plugin_ref ?? "abcdef1",
    model_ref: opts.model_ref ?? { architect: "claude-opus-4-7" },
    started_at: "2026-04-26T05:30:00Z",
    completed_at: "2026-04-26T05:50:00Z",
    status: opts.status ?? "pass",
    wall_clock_ms: 1200000,
    wall_clock_budget_ms: 1500000,
  };
  await writeFile(join(dir, "run.json"), JSON.stringify(run, null, 2));

  if (opts.withScore !== false) {
    const score: Score = {
      schema_version: 1,
      run_id: runId,
      case_slug: run.case_slug,
      plugin_ref: run.plugin_ref,
      model_ref: run.model_ref,
      status: run.status,
      scored_at: "2026-04-26T05:51:00Z",
      partial: false,
      missing_artifacts: [],
      components: {
        outcome: {
          weight: 30,
          raw_subscore: opts.outcomeRaw ?? 100,
          max_subscore: 100,
          weighted: ((opts.outcomeRaw ?? 100) * 30) / 100,
        },
        delegation: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
        gates: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
        evidence: { weight: 15, raw_subscore: 100, max_subscore: 100, weighted: 15 },
        loop_response: {
          weight: 10,
          raw_subscore: 100,
          max_subscore: 100,
          weighted: 10,
        },
        efficiency: { weight: 5, raw_subscore: 100, max_subscore: 100, weighted: 5 },
      },
      guild_score: opts.guild_score ?? 100,
    };
    await writeFile(join(dir, "score.json"), JSON.stringify(score, null, 2));
  }

  if (opts.withMetrics !== false) {
    const metrics: MetricsJson = {
      schema_version: 1,
      run_id: runId,
      computed_at: "2026-04-26T05:51:00Z",
      wall_clock_ms: 1200000,
      wall_clock_budget_ms: 1500000,
      stages: [
        {
          name: "brainstorm",
          status: "passed",
          started_at: "2026-04-26T05:30:00Z",
          completed_at: "2026-04-26T05:31:00Z",
          duration_ms: 60000,
        },
      ],
      dispatched_specialists: ["architect", "backend"],
      expected_specialists: ["architect", "backend"],
      acceptance_commands: [{ command: "echo hi", passed: true }],
      expected_stage_order: ["brainstorm"],
      observed_stage_order: ["brainstorm"],
      gate_outcomes: { brainstorm: "passed" },
      retry_count: 0,
      tool_error_count: 0,
    };
    await writeFile(join(dir, "metrics.json"), JSON.stringify(metrics, null, 2));
  }

  if (opts.withEvents !== false) {
    const events = [
      { ts: "2026-04-26T05:30:00Z", type: "stage_started", stage: "brainstorm" },
      {
        ts: "2026-04-26T05:31:00Z",
        type: "stage_completed",
        stage: "brainstorm",
        duration_ms: 60000,
      },
      { ts: "2026-04-26T05:31:01Z", type: "gate_passed", gate: "brainstorm" },
    ];
    const ndjson = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    await writeFile(join(dir, "events.ndjson"), ndjson);
  }

  return dir;
}

export async function seedArtifact(
  runsDir: string,
  runId: string,
  relPath: string,
  contents: string,
): Promise<string> {
  const target = join(runsDir, runId, "artifacts", relPath);
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, contents);
  return target;
}

export async function seedCase(
  casesDir: string,
  id: string,
  title: string,
): Promise<void> {
  await mkdir(casesDir, { recursive: true });
  const yaml = [
    `schema_version: 1`,
    `id: ${id}`,
    `title: "${title}"`,
    `timeout_seconds: 1800`,
    `repetitions: 1`,
    `fixture: "fixtures/synthetic-pass"`,
    `prompt: "noop"`,
    `expected_specialists:`,
    `  - architect`,
    `  - backend`,
    `expected_stage_order:`,
    `  - brainstorm`,
    `  - team`,
    `  - plan`,
    `  - context`,
    `  - execute`,
    `  - review`,
    `  - verify`,
    `  - reflect`,
    `acceptance_commands:`,
    `  - echo hi`,
    ``,
  ].join("\n");
  await writeFile(join(casesDir, `${id}.yaml`), yaml);
}

// In-process Request shorthand. We never use https? — only the default
// http://127.0.0.1 host placeholder hono parses for us. Tests must not make
// outbound network calls.
export function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1${path}`, init);
}
