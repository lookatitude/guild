import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _resetActiveRunForTests, createApp } from "../src/server.js";
import { req } from "./server.helpers.js";

// HTTP integration — POST /api/runs in P3:
//   400 on missing body / shape errors (case_slug required, kebab-case)
//   400 on plan failure (case YAML missing on disk)
// Single-flight 409 + 202 + Location are exercised by parallel-curl evidence
// in /tmp/guild-evidence-T2/03-post-runs.log; that path needs the live runner
// (claude binary + fixture clone) which is out-of-scope for unit tests here.
describe("server / POST /api/runs", () => {
  let runsDir: string;
  let casesDir: string;

  beforeEach(async () => {
    _resetActiveRunForTests();
    runsDir = await mkdtemp(join(tmpdir(), "qa-post-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-cases-"));
  });

  afterEach(async () => {
    _resetActiveRunForTests();
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
  });

  it("returns 400 when body is missing", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/runs", { method: "POST" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/JSON/i);
  });

  it("returns 400 when case_slug is omitted", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ models: { default: "claude-opus-4-7" } }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/case_slug/);
  });

  it("returns 400 when case_slug is not kebab-case", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "Bad Slug!" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/kebab-case/);
  });

  it("returns 400 when run_id contains illegal chars", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          case_slug: "demo-url-shortener-build",
          run_id: "../etc/passwd",
        }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/run_id/);
  });

  it("returns 400 when the case YAML is missing (plan failure)", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(
      req("/api/runs", {
        method: "POST",
        body: JSON.stringify({ case_slug: "no-such-case" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // planRun rejects with the underlying loader error; we just want a 400.
    expect(typeof body.error).toBe("string");
  });
});
