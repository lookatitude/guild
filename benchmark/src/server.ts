import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  parseEventsNdjson,
  parseRunJson,
} from "./artifact-importer.js";
import { loadCase } from "./case-loader.js";
import { compareSets } from "./compare.js";
import { planRun, runBenchmark } from "./runner.js";
import type {
  CaseSummary,
  CasesListResponse,
  Comparison,
  EventLine,
  MetricsJson,
  RunDetailResponse,
  RunJson,
  RunOptions,
  RunPostRequest,
  RunPostResponse,
  RunsListResponse,
  RunsListRow,
  Score,
} from "./types.js";

export interface ServerOpts {
  runsDir: string;
  casesDir: string;
  uiDistDir?: string;
  port: number;
  hostname?: string;
}

export interface ServerHandle {
  port: number;
  hostname: string;
  close: () => Promise<void>;
}

// Concurrency guard for POST /api/runs. The runner spawns `claude` (a heavy
// detached subprocess); architect §5.3 + ADR-001 require single-flight per
// server process. A new POST while an active run exists returns 409.
//
// Module-scope state is intentional — server is single-process, single-host
// (127.0.0.1 bind, M11). State resets on process restart. There is no
// persistence and no cross-process locking: that's the boundary.
interface ActiveRun {
  run_id: string;
  case_slug: string;
  started_at: string;
}
let activeRun: ActiveRun | null = null;

export function _resetActiveRunForTests(): void {
  activeRun = null;
}

export function createApp(opts: ServerOpts): Hono {
  const app = new Hono();
  const runsDir = resolve(opts.runsDir);
  const casesDir = resolve(opts.casesDir);
  const uiDistDir = opts.uiDistDir ? resolve(opts.uiDistDir) : undefined;

  // Logging middleware: every request emits `method path status duration_ms`
  // to stdout. ADR §Decision §2 — re-read on every request, no cache; the
  // log line is the operator's only visibility into request flow.
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;
    process.stdout.write(
      `${c.req.method} ${c.req.path} ${c.res.status} ${elapsed}ms\n`,
    );
  });

  // ---- API: GET /api/runs (with optional ?case=<slug> filter) -----------
  app.get("/api/runs", async (c) => {
    const caseFilter = c.req.query("case");
    const rows = await listRunRows(runsDir, caseFilter);
    const body: RunsListResponse = { runs: rows, total: rows.length };
    return c.json(body);
  });

  // ---- API: GET /api/runs/:run_id (joined detail) ------------------------
  app.get("/api/runs/:run_id", async (c) => {
    const runId = c.req.param("run_id");
    const runDir = resolveRunDir(runsDir, runId);
    if (!runDir) {
      return c.json({ error: "invalid run_id" }, 400);
    }
    if (!existsSync(runDir)) {
      return c.json({ error: `run not found: ${runId}` }, 404);
    }
    const runPath = join(runDir, "run.json");
    const metricsPath = join(runDir, "metrics.json");
    const scorePath = join(runDir, "score.json");
    const eventsPath = join(runDir, "events.ndjson");
    if (!existsSync(runPath)) {
      return c.json({ error: `run.json not found for ${runId}` }, 404);
    }
    if (!existsSync(scorePath) || !existsSync(metricsPath)) {
      return c.json(
        { error: `run ${runId} not yet scored (no score.json/metrics.json)` },
        404,
      );
    }
    const run: RunJson = parseRunJson(await readFile(runPath, "utf8"));
    const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as MetricsJson;
    const score = JSON.parse(await readFile(scorePath, "utf8")) as Score;
    let events: EventLine[] = [];
    if (existsSync(eventsPath)) {
      events = parseEventsNdjson(await readFile(eventsPath, "utf8"));
    }
    const body: RunDetailResponse = { run, metrics, score, events };
    return c.json(body);
  });

  // ---- API: GET /api/runs/:run_id/artifacts/* (raw passthrough) ----------
  app.get("/api/runs/:run_id/artifacts/*", async (c) => {
    const runId = c.req.param("run_id");
    const runDir = resolveRunDir(runsDir, runId);
    if (!runDir) return c.json({ error: "invalid run_id" }, 400);
    const artifactsRoot = join(runDir, "artifacts");
    // Hono's `*` capture is exposed as a wildcard param. We use the raw
    // request path since param("*") behavior varies by Hono version.
    const prefix = `/api/runs/${runId}/artifacts/`;
    const url = new URL(c.req.url);
    const decodedPath = decodeURIComponent(url.pathname);
    if (!decodedPath.startsWith(prefix)) {
      return c.json({ error: "bad path" }, 400);
    }
    const rest = decodedPath.slice(prefix.length);
    const target = safeJoinUnder(artifactsRoot, rest);
    if (!target) {
      return c.json({ error: "path traversal denied" }, 400);
    }
    if (!existsSync(target)) {
      return c.json({ error: `artifact not found: ${rest}` }, 404);
    }
    const stats = await stat(target);
    if (!stats.isFile()) {
      return c.json({ error: "not a file" }, 404);
    }
    const buf = await readFile(target);
    return new Response(buf, {
      status: 200,
      headers: { "content-type": artifactContentType(rest) },
    });
  });

  // ---- API: GET /api/comparisons/:baseline/:candidate --------------------
  app.get("/api/comparisons/:baseline/:candidate", async (c) => {
    const baseline = c.req.param("baseline");
    const candidate = c.req.param("candidate");
    if (!isSafeSetId(baseline) || !isSafeSetId(candidate)) {
      return c.json({ error: "invalid set id" }, 400);
    }
    // Re-read on every request (ADR §Decision §2). Pass `write: false` so
    // we don't churn `_compare/*.json` on each GET; the underlying scores
    // remain canonical.
    const result = await compareSets({
      runsDir,
      baseline,
      candidate,
      write: false,
    });
    const body: Comparison = result.comparison;
    return c.json(body);
  });

  // ---- API: GET /api/cases ----------------------------------------------
  app.get("/api/cases", async (c) => {
    const cases = await listCases(casesDir);
    const body: CasesListResponse = { cases };
    return c.json(body);
  });

  // ---- API: POST /api/runs (live runner — kicks off detached subprocess) -
  // Body: RunPostRequest { case_slug, run_id?, models? }.
  // Returns 202 + Location header + RunPostResponse on success.
  // Returns 409 if a run is already in flight (single-flight per process).
  // Returns 400 on shape errors (missing case_slug, bad run_id, etc).
  app.post("/api/runs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "request body must be valid JSON" }, 400);
    }
    const parseResult = parseRunPostRequest(body);
    if (!parseResult.ok) {
      return c.json({ error: parseResult.error }, 400);
    }
    const req = parseResult.value;

    // Single-flight gate (architect §5.3). Claim the slot SYNCHRONOUSLY
    // before any `await` — otherwise two near-simultaneous POSTs both pass
    // the null check, both await planRun, and both mutate activeRun.
    if (activeRun) {
      return c.json(
        {
          error: "another run is already in flight",
          run_id: activeRun.run_id,
          started_at: activeRun.started_at,
        },
        409,
      );
    }
    const startedAt = new Date().toISOString();
    activeRun = {
      run_id: "<resolving>",
      case_slug: req.case_slug,
      started_at: startedAt,
    };

    // Plan resolution is async but local — validates case YAML, resolves
    // claude binary, generates run_id. Errors surface as 400; clear the
    // slot on failure so the next caller can proceed.
    const runOpts: RunOptions = {
      caseSlug: req.case_slug,
      ...(req.run_id ? { runId: req.run_id } : {}),
      ...(req.models ? { modelsOverride: req.models } : {}),
    };
    let plan;
    try {
      plan = await planRun(runOpts, { runsDir, casesDir });
    } catch (err) {
      activeRun = null;
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: `plan failed: ${message}` }, 400);
    }

    // Promote placeholder slot to the resolved run_id.
    activeRun = {
      run_id: plan.runId,
      case_slug: req.case_slug,
      started_at: plan.startedAtIso,
    };

    // Fire-and-forget. Errors land in stderr — the operator polls
    // GET /api/runs/<run_id> for terminal state. activeRun is cleared in
    // both success and failure paths via finally.
    void runBenchmark(runOpts, { runsDir, casesDir })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`runner error (${plan.runId}): ${msg}\n`);
      })
      .finally(() => {
        activeRun = null;
      });

    const responseBody: RunPostResponse = {
      run_id: plan.runId,
      location: `/api/runs/${plan.runId}`,
      started_at: plan.startedAtIso,
    };
    c.header("Location", `/api/runs/${plan.runId}`);
    return c.json(responseBody, 202);
  });

  // ---- Static fallback for non-/api paths --------------------------------
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) {
      return c.json({ error: "not found" }, 404);
    }
    if (uiDistDir && existsSync(uiDistDir)) {
      const served = await serveStaticFile(uiDistDir, c.req.path);
      if (served) return served;
    }
    return c.json(
      {
        error: "frontend not built",
        hint: "cd benchmark/ui && npm run build",
      },
      404,
    );
  });

  return app;
}

export function serverDefaultsFromEnv(): { port: number; hostname: string } {
  const envPort = process.env.BENCHMARK_PORT;
  const port = envPort ? Number.parseInt(envPort, 10) : 3055;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `BENCHMARK_PORT must be a valid TCP port (1-65535); got ${envPort}`,
    );
  }
  return { port, hostname: "127.0.0.1" };
}

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const app = createApp(opts);
  const hostname = opts.hostname ?? "127.0.0.1";
  return new Promise<ServerHandle>((resolveStart, rejectStart) => {
    try {
      const server = serve(
        { fetch: app.fetch, hostname, port: opts.port },
        (info) => {
          resolveStart({
            port: info.port,
            hostname,
            close: () =>
              new Promise<void>((resolveClose, rejectClose) => {
                server.close((err) => {
                  if (err) rejectClose(err);
                  else resolveClose();
                });
              }),
          });
        },
      );
      server.on("error", (err) => rejectStart(err));
    } catch (err) {
      rejectStart(err);
    }
  });
}

// ---- helpers ------------------------------------------------------------

async function listRunRows(
  runsDir: string,
  caseFilter: string | undefined,
): Promise<RunsListRow[]> {
  if (!existsSync(runsDir)) return [];
  const entries = await readdir(runsDir, { withFileTypes: true });
  const rows: RunsListRow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "_compare") continue;
    const dir = join(runsDir, entry.name);
    const runPath = join(dir, "run.json");
    const scorePath = join(dir, "score.json");
    if (!existsSync(runPath) || !existsSync(scorePath)) continue;
    let run: RunJson;
    let score: Score;
    try {
      run = parseRunJson(await readFile(runPath, "utf8"));
      score = JSON.parse(await readFile(scorePath, "utf8")) as Score;
    } catch {
      continue;
    }
    if (caseFilter && run.case_slug !== caseFilter) continue;
    rows.push({
      run_id: run.run_id,
      case_slug: run.case_slug,
      plugin_ref: run.plugin_ref,
      status: run.status,
      guild_score: score.guild_score,
      started_at: run.started_at,
    });
  }
  rows.sort((a, b) =>
    a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0,
  );
  return rows;
}

async function listCases(casesDir: string): Promise<CaseSummary[]> {
  if (!existsSync(casesDir)) return [];
  const entries = await readdir(casesDir, { withFileTypes: true });
  const out: CaseSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.ya?ml$/i.test(entry.name)) continue;
    const path = join(casesDir, entry.name);
    try {
      const c = await loadCase(path);
      out.push({
        id: c.id,
        title: c.title,
        expected_specialists: c.expected_specialists,
        expected_stage_order: c.expected_stage_order,
      });
    } catch {
      // Skip malformed YAMLs in the listing — case-loader's own error
      // path is exercised by the score CLI.
      continue;
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

// POST /api/runs body validator. Returns a tagged result so the handler can
// emit a meaningful 400 rather than relying on a thrown Error's message.
function parseRunPostRequest(
  raw: unknown,
):
  | { ok: true; value: RunPostRequest }
  | { ok: false; error: string } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  const caseSlug = obj.case_slug;
  if (typeof caseSlug !== "string" || caseSlug.length === 0) {
    return { ok: false, error: "case_slug is required and must be a string" };
  }
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(caseSlug)) {
    return { ok: false, error: "case_slug must be kebab-case" };
  }
  let runId: string | undefined;
  if (obj.run_id !== undefined) {
    if (typeof obj.run_id !== "string" || !isSafeSetId(obj.run_id)) {
      return { ok: false, error: "run_id must match [A-Za-z0-9._-]+" };
    }
    runId = obj.run_id;
  }
  let models: Record<string, string> | undefined;
  if (obj.models !== undefined) {
    if (
      obj.models === null ||
      typeof obj.models !== "object" ||
      Array.isArray(obj.models)
    ) {
      return { ok: false, error: "models must be an object" };
    }
    models = {};
    for (const [k, v] of Object.entries(obj.models as Record<string, unknown>)) {
      if (typeof v !== "string") {
        return { ok: false, error: `models.${k} must be a string` };
      }
      models[k] = v;
    }
  }
  return {
    ok: true,
    value: {
      case_slug: caseSlug,
      ...(runId ? { run_id: runId } : {}),
      ...(models ? { models } : {}),
    },
  };
}

function resolveRunDir(runsDir: string, runId: string): string | null {
  if (!isSafeSetId(runId)) return null;
  return join(runsDir, runId);
}

// run-id / set-id naming surface — `<case-slug>-<plugin_ref_short>-<model_ref_hash>-<n>`
// (P1 T2 confirmation). Restrict to characters used by that pattern.
function isSafeSetId(id: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(id) && id !== "." && id !== ".." && id !== "_compare";
}

function safeJoinUnder(root: string, rest: string): string | null {
  const normalisedRest = normalize(rest).replace(/^([\\/]+)/, "");
  if (normalisedRest === ".." || normalisedRest.startsWith(`..${sep}`)) return null;
  const target = resolve(root, normalisedRest);
  const rel = relative(root, target);
  if (rel.startsWith("..") || resolve(root, rel) !== target) return null;
  return target;
}

function artifactContentType(restPath: string): string {
  const ext = extname(restPath).toLowerCase();
  switch (ext) {
    case ".md":
    case ".ndjson":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
    case ".mjs":
      return "application/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

async function serveStaticFile(
  distRoot: string,
  reqPath: string,
): Promise<Response | null> {
  const cleaned = reqPath.replace(/^\/+/, "");
  const target = safeJoinUnder(distRoot, cleaned || "index.html");
  if (!target) return null;
  if (existsSync(target)) {
    const stats = await stat(target);
    if (stats.isFile()) {
      const buf = await readFile(target);
      return new Response(buf, {
        status: 200,
        headers: { "content-type": artifactContentType(target) },
      });
    }
  }
  // SPA fallback — non-asset paths resolve to index.html so client routing works.
  if (extname(cleaned) === "") {
    const indexPath = join(distRoot, "index.html");
    if (existsSync(indexPath)) {
      const buf = await readFile(indexPath);
      return new Response(buf, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  }
  return null;
}
