import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { RunsListResponse } from "../src/types.js";
import { req, seedRun } from "./server.helpers.js";

// HTTP integration — GET /api/runs (with optional ?case= filter).
describe("server / GET /api/runs", () => {
  let runsDir: string;
  let casesDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-runs-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-cases-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
  });

  it("returns the rows + total for every scored run", async () => {
    await seedRun(runsDir, "alpha-001", { case_slug: "alpha", guild_score: 81.5 });
    await seedRun(runsDir, "alpha-002", { case_slug: "alpha", guild_score: 73 });
    await seedRun(runsDir, "beta-001", { case_slug: "beta", guild_score: 99 });

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");

    const body = (await res.json()) as RunsListResponse;
    expect(body.total).toBe(3);
    expect(body.runs.map((r) => r.run_id).sort()).toEqual([
      "alpha-001",
      "alpha-002",
      "beta-001",
    ]);
    for (const row of body.runs) {
      expect(typeof row.guild_score).toBe("number");
      expect(typeof row.started_at).toBe("string");
    }
  });

  it("filters by ?case=<slug> and returns only matching rows", async () => {
    await seedRun(runsDir, "alpha-001", { case_slug: "alpha" });
    await seedRun(runsDir, "alpha-002", { case_slug: "alpha" });
    await seedRun(runsDir, "beta-001", { case_slug: "beta" });

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs?case=alpha"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsListResponse;
    expect(body.total).toBe(2);
    expect(body.runs.every((r) => r.case_slug === "alpha")).toBe(true);
  });

  it("returns an empty list with total=0 when ?case= matches nothing", async () => {
    await seedRun(runsDir, "alpha-001", { case_slug: "alpha" });
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs?case=nonesuch"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsListResponse;
    expect(body).toEqual({ runs: [], total: 0 });
  });

  it("hides directories that are missing score.json (unscored runs)", async () => {
    await seedRun(runsDir, "scored-001", { case_slug: "alpha" });
    await seedRun(runsDir, "unscored-001", {
      case_slug: "alpha",
      withScore: false,
    });
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs"));
    const body = (await res.json()) as RunsListResponse;
    expect(body.runs.map((r) => r.run_id)).toEqual(["scored-001"]);
  });

  it("returns an empty list when runsDir does not exist", async () => {
    const app = createApp({
      runsDir: join(runsDir, "does-not-exist"),
      casesDir,
      port: 0,
    });
    const res = await app.fetch(req("/api/runs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsListResponse;
    expect(body).toEqual({ runs: [], total: 0 });
  });

  it("ignores the _compare directory", async () => {
    await seedRun(runsDir, "scored-001");
    // _compare should not be enumerated as a run, even with malformed contents.
    const compareDir = join(runsDir, "_compare");
    await seedRun(runsDir, "_compare/decoy", { withScore: false });
    void compareDir;

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs"));
    const body = (await res.json()) as RunsListResponse;
    expect(body.runs.map((r) => r.run_id)).toEqual(["scored-001"]);
  });

  // v1.3 — F4: pin that the LIST endpoint forwards auth_identity_hash
  // when the source run.json carries it. Frontend filter UI reads from
  // /api/runs (not /api/runs/:id), so this is the load-bearing surface
  // for the badge/filter to work without an extra round-trip.
  it("forwards auth_identity_hash on rows whose run.json has the field (F4)", async () => {
    const realHash = "a".repeat(64); // matches AUTH_IDENTITY_HASH_RE shape
    await seedRun(runsDir, "with-hash-001", {
      case_slug: "alpha",
      auth_identity_hash: realHash,
    });
    await seedRun(runsDir, "without-hash-001", { case_slug: "alpha" });

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as RunsListResponse;
    expect(body.total).toBe(2);
    const withHash = body.runs.find((r) => r.run_id === "with-hash-001");
    const withoutHash = body.runs.find((r) => r.run_id === "without-hash-001");
    expect(withHash).toBeDefined();
    expect(withHash?.auth_identity_hash).toBe(realHash);
    // Field is omitted (not undefined inside JSON) when source run.json
    // lacked it — frontend can branch on `field in row`.
    expect(withoutHash).toBeDefined();
    expect(withoutHash?.auth_identity_hash).toBeUndefined();
  });
});
