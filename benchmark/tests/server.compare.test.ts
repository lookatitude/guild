import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { Comparison } from "../src/types.js";
import { req, seedRun } from "./server.helpers.js";

// HTTP integration — GET /api/comparisons/:baseline/:candidate.
describe("server / GET /api/comparisons/:baseline/:candidate", () => {
  let runsDir: string;
  let casesDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-cmp-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-cases-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
  });

  it("computes the Comparison without writing _compare/*.json", async () => {
    await seedRun(runsDir, "set-a-1", { guild_score: 70, outcomeRaw: 50 });
    await seedRun(runsDir, "set-a-2", { guild_score: 80, outcomeRaw: 80 });
    await seedRun(runsDir, "set-b-1", { guild_score: 100, outcomeRaw: 100 });

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/comparisons/set-a/set-b"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Comparison;
    expect(body.baseline.run_count).toBe(2);
    expect(body.candidate.run_count).toBe(1);
    expect(body.guild_score_delta.delta).toBe(25);
    expect(body.status).toBe("ok");

    // Server passes write:false — no artifact churn on a GET.
    expect(existsSync(join(runsDir, "_compare", "set-a__set-b.json"))).toBe(false);
  });

  it("returns excluded_runs when refs diverge across sides (status=partial)", async () => {
    await seedRun(runsDir, "set-a-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });
    await seedRun(runsDir, "set-a-2", {
      model_ref: { architect: "claude-sonnet-4-6" },
    });
    await seedRun(runsDir, "set-b-1", {
      model_ref: { architect: "claude-opus-4-7" },
    });

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/comparisons/set-a/set-b"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Comparison;
    expect(body.excluded_runs.length).toBeGreaterThan(0);
    expect(["partial", "no_comparable_runs"]).toContain(body.status);
  });

  it("rejects invalid set ids with 400", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/comparisons/..%2Fbad/set-b"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid set id/);
  });

  it("rejects an invalid candidate set id with 400", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/comparisons/set-a/..%2Fevil"));
    expect(res.status).toBe(400);
  });
});
