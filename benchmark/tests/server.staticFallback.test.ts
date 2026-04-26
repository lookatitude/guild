import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, serverDefaultsFromEnv } from "../src/server.js";
import { req } from "./server.helpers.js";

// HTTP integration — non-/api routing: static fallback when ui/dist exists,
// build-prose 404 otherwise. Plus the trivial `serverDefaultsFromEnv` checks.
describe("server / non-/api static fallback", () => {
  let runsDir: string;
  let casesDir: string;
  let distDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), "qa-static-runs-"));
    casesDir = await mkdtemp(join(tmpdir(), "qa-static-cases-"));
    distDir = await mkdtemp(join(tmpdir(), "qa-static-dist-"));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
    await rm(casesDir, { recursive: true, force: true });
    await rm(distDir, { recursive: true, force: true });
  });

  it("returns 404 with build-prose body when uiDistDir is unset", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hint?: string };
    expect(body.error).toBe("frontend not built");
    expect(body.hint).toMatch(/npm run build/);
  });

  it("returns 404 with build-prose body when uiDistDir does not exist on disk", async () => {
    const app = createApp({
      runsDir,
      casesDir,
      uiDistDir: join(distDir, "absent"),
      port: 0,
    });
    const res = await app.fetch(req("/runs"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("frontend not built");
  });

  it("returns 404 with not-found error for unknown /api/* paths", async () => {
    const app = createApp({ runsDir, casesDir, port: 0 });
    const res = await app.fetch(req("/api/unknown-endpoint"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not found");
  });

  it("serves index.html when uiDistDir is present", async () => {
    await writeFile(
      join(distDir, "index.html"),
      "<!doctype html><html><body><div id='root'></div><script src='/assets/index.js'></script></body></html>",
    );
    const app = createApp({ runsDir, casesDir, uiDistDir: distDir, port: 0 });
    const res = await app.fetch(req("/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain("<!doctype html>");
    expect(body).toContain("/assets/index.js");
  });

  it("serves a static asset when present in uiDistDir", async () => {
    await mkdir(join(distDir, "assets"), { recursive: true });
    await writeFile(
      join(distDir, "assets", "index.css"),
      "body{background:#fff}",
    );
    const app = createApp({ runsDir, casesDir, uiDistDir: distDir, port: 0 });
    const res = await app.fetch(req("/assets/index.css"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/css/);
    expect(await res.text()).toContain("background");
  });

  it("falls back to index.html for SPA paths without a file extension", async () => {
    await writeFile(
      join(distDir, "index.html"),
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    const app = createApp({ runsDir, casesDir, uiDistDir: distDir, port: 0 });
    const res = await app.fetch(req("/runs/demo-001"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
  });

  it("returns 404 build-prose when extension-keyed file is missing in dist", async () => {
    // dist exists, index.html exists, but the requested .css doesn't.
    await writeFile(join(distDir, "index.html"), "<html></html>");
    const app = createApp({ runsDir, casesDir, uiDistDir: distDir, port: 0 });
    const res = await app.fetch(req("/missing.css"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("frontend not built");
  });
});

describe("server / serverDefaultsFromEnv", () => {
  const ORIGINAL = process.env.BENCHMARK_PORT;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.BENCHMARK_PORT;
    else process.env.BENCHMARK_PORT = ORIGINAL;
  });

  it("returns 3055 / 127.0.0.1 by default", () => {
    delete process.env.BENCHMARK_PORT;
    const d = serverDefaultsFromEnv();
    expect(d.port).toBe(3055);
    expect(d.hostname).toBe("127.0.0.1");
  });

  it("honors BENCHMARK_PORT when valid", () => {
    process.env.BENCHMARK_PORT = "4099";
    expect(serverDefaultsFromEnv().port).toBe(4099);
  });

  it("rejects an out-of-range BENCHMARK_PORT", () => {
    process.env.BENCHMARK_PORT = "999999";
    expect(() => serverDefaultsFromEnv()).toThrow(/valid TCP port/);
  });

  it("rejects a non-numeric BENCHMARK_PORT", () => {
    process.env.BENCHMARK_PORT = "not-a-port";
    expect(() => serverDefaultsFromEnv()).toThrow(/valid TCP port/);
  });
});
