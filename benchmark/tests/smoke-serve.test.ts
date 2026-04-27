import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { startServer, type ServerHandle } from "../src/server.js";

// Smoke test — spin up the real server (port 0 → OS-assigned), point it at
// the existing runs/, cases/, and the built ui/dist/, then fetch the static
// fallback. We assert that:
//   1. the server actually listens (port > 0);
//   2. GET / returns the built index.html;
//   3. that index.html references at least one JS bundle (the assets the
//      Vite build emits).
//
// This is the lightweight no-browser smoke per the T4-qa context bundle
// recommendation. A full Playwright pass behind a probe-and-skip is the
// optional add-on, kept under it.skipIf so the suite never fails when the
// headless browser is not installed.

const REPO_ROOT = resolve(__dirname, "..");
const RUNS_DIR = resolve(REPO_ROOT, "runs");
const CASES_DIR = resolve(REPO_ROOT, "cases");
const UI_DIST_DIR = resolve(REPO_ROOT, "ui", "dist");

const distAvailable = existsSync(UI_DIST_DIR) && existsSync(`${UI_DIST_DIR}/index.html`);

describe("smoke / serve + built ui", () => {
  let handle: ServerHandle | undefined;

  beforeAll(async () => {
    if (!distAvailable) return;
    handle = await startServer({
      runsDir: RUNS_DIR,
      casesDir: CASES_DIR,
      uiDistDir: UI_DIST_DIR,
      port: 0,
      hostname: "127.0.0.1",
    });
  });

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it.skipIf(!distAvailable)(
    "binds 127.0.0.1 on an OS-assigned port",
    () => {
      expect(handle).toBeDefined();
      expect(handle?.hostname).toBe("127.0.0.1");
      expect(handle?.port).toBeGreaterThan(0);
    },
  );

  it.skipIf(!distAvailable)(
    "serves the built index.html with a JS bundle reference",
    async () => {
      const url = `http://127.0.0.1:${handle?.port}/`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
      const html = await res.text();
      expect(html).toContain("<!doctype html>");
      // At least one <script> with a JS bundle path anchored at /assets/.
      expect(html).toMatch(/<script[^>]+src=["']\/assets\/[^"']+\.js["']/);
    },
  );

  it.skipIf(!distAvailable)(
    "serves the API surface alongside the static UI on the same port",
    async () => {
      const url = `http://127.0.0.1:${handle?.port}/api/cases`;
      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/application\/json/);
      const body = (await res.json()) as { cases: unknown[] };
      expect(Array.isArray(body.cases)).toBe(true);
    },
  );

  // Optional Playwright pass — strictly probe-and-skip; we never declare
  // playwright as a hard dep. If the user wants the full headless run, they
  // can install playwright separately. This block stays here so the smoke
  // suite is self-documenting.
  it.skip(
    "[optional] visits each surface without runtime errors via Playwright (skipped — playwright not declared)",
    async () => {
      // Intentionally skipped: we don't declare playwright as a dependency
      // (the lighter smoke above is sufficient for the T4-qa contract).
      // Reactivate by installing playwright + replacing this with a real
      // chromium.launch() block.
    },
  );
});
