import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import { req, seedArtifact, seedRun } from "./server.helpers.js";

// HTTP integration — GET /api/runs/:run_id/artifacts/*.
describe("server / GET /api/runs/:run_id/artifacts/*", () => {
  let runsDir: string;
  let casesDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-artifact-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-cases-"));
    await seedRun(runsDir, "demo-001");
    await seedArtifact(
      runsDir,
      "demo-001",
      ".guild/runs/demo-001/review.md",
      "# Review\n\nLooks good.\n",
    );
    await seedArtifact(
      runsDir,
      "demo-001",
      ".guild/runs/demo-001/handoffs/T2-backend.md",
      "Handoff body.\n",
    );
    await seedArtifact(
      runsDir,
      "demo-001",
      ".guild/runs/demo-001/score-snapshot.json",
      JSON.stringify({ ok: true }) + "\n",
    );
    await seedArtifact(
      runsDir,
      "demo-001",
      ".guild/runs/demo-001/events.ndjson",
      `{"ts":"2026-04-26T05:30:00Z","type":"stage_started","stage":"plan"}\n`,
    );
    await seedArtifact(runsDir, "demo-001", "logo.png", "PNGBYTES");
    await seedArtifact(runsDir, "demo-001", "trace.bin", "BINARY");
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
  });

  it("returns raw bytes with text/plain for .md", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs/demo-001/artifacts/.guild/runs/demo-001/review.md"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^text\/plain/);
    expect(await res.text()).toContain("Review");
  });

  it("returns text/plain for .ndjson", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs/demo-001/artifacts/.guild/runs/demo-001/events.ndjson"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^text\/plain/);
  });

  it("returns application/json for .json", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs/demo-001/artifacts/.guild/runs/demo-001/score-snapshot.json"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
  });

  it("returns image/png for .png", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/demo-001/artifacts/logo.png"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toBe("image/png");
  });

  it("returns application/octet-stream for unknown extensions", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/demo-001/artifacts/trace.bin"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toBe("application/octet-stream");
  });

  it("returns 404 for an unknown artifact path", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs/demo-001/artifacts/missing/file.md"),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/artifact not found/);
  });

  it("rejects path traversal probes with 400 (URL-encoded)", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs/demo-001/artifacts/..%2F..%2F..%2Fetc%2Fpasswd"),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/path traversal denied/);
  });

  it("returns 400 for an invalid (unsafe) run id on artifacts", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/..%2Fbad/artifacts/anything"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid run_id/);
  });

  it("returns 404 when path resolves to a directory, not a file", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs/demo-001/artifacts/.guild"));
    expect(res.status).toBe(404);
  });
});
