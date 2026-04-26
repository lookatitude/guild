import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import type { CasesListResponse } from "../src/types.js";
import { req, seedCase } from "./server.helpers.js";

// HTTP integration — GET /api/cases.
describe("server / GET /api/cases", () => {
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

  it("returns CasesListResponse with sorted cases", async () => {
    await seedCase(casesDir, "demo-context-drift", "Diagnose drift");
    await seedCase(casesDir, "demo-url-shortener-build", "Build url shortener");

    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/cases"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");

    const body = (await res.json()) as CasesListResponse;
    expect(body.cases.map((c) => c.id)).toEqual([
      "demo-context-drift",
      "demo-url-shortener-build",
    ]);
    for (const c of body.cases) {
      expect(Array.isArray(c.expected_specialists)).toBe(true);
      expect(Array.isArray(c.expected_stage_order)).toBe(true);
    }
  });

  it("returns an empty list when casesDir is missing", async () => {
    const app = createApp({
      runsDir,
      casesDir: join(casesDir, "absent"),
      port: 0,
    });
    const res = await app.fetch(req("/api/cases"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cases: [] });
  });

  it("skips malformed YAML files silently", async () => {
    await seedCase(casesDir, "good-case", "Good");
    await writeFile(join(casesDir, "bad.yaml"), "not: valid: case: shape");
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/cases"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as CasesListResponse;
    expect(body.cases.map((c) => c.id)).toEqual(["good-case"]);
  });
});
