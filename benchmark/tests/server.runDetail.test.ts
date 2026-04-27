import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { RunDetailResponse } from "../src/types.js";
import { req, seedRun } from "./server.helpers.js";

// HTTP integration — GET /api/runs/:run_id.
describe("server / GET /api/runs/:run_id", () => {
  let runsDir: string;
  let casesDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-detail-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-cases-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
  });

  it("returns the joined RunDetailResponse with parsed events", async () => {
    await seedRun(runsDir, "demo-001");
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/demo-001"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");

    const body = (await res.json()) as RunDetailResponse;
    expect(Object.keys(body).sort()).toEqual(["events", "metrics", "run", "score"]);
    expect(body.run.run_id).toBe("demo-001");
    expect(body.score.guild_score).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    // Type-level pin: parsed events must carry the discriminated `type` field.
    for (const ev of body.events) {
      expect(typeof ev.type).toBe("string");
    }
  });

  it("returns 404 for an unknown run id", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/missing-run-001"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/run not found/);
  });

  it("returns 400 for an invalid (unsafe) run id", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/..%2Fescape"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid run_id/);
  });

  it("returns 404 with the not-yet-scored message when score.json is missing", async () => {
    await seedRun(runsDir, "unscored-001", { withScore: false });
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/unscored-001"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not yet scored/);
  });

  it("returns 404 when run.json is missing entirely", async () => {
    await seedRun(runsDir, "broken-001");
    await unlink(join(runsDir, "broken-001", "run.json"));
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/broken-001"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/run\.json not found/);
  });

  it("returns an empty events array when events.ndjson is absent", async () => {
    await seedRun(runsDir, "noevents-001", { withEvents: false });
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/noevents-001"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunDetailResponse;
    expect(body.events).toEqual([]);
  });
});
