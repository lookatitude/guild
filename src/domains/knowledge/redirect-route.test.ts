/**
 * redirect-route.test.ts — R50 through the real trigger: three T0-routed
 * redirects on one (agent, topic) go through the real ledger, and the THIRD one
 * harvests via the ledger's own `fires_harvest`. The control forces that
 * comparison to false and the harvest must not happen.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createGuildStorage, type GuildStorage } from "../state";
import { readRedirectLedger, routeRedirect, searchWiki } from ".";
import * as ledgerModule from "./redirect-ledger";

const RUN_ID = "run-r50";

let sandbox: string;
let storage: GuildStorage;
let runDir: string;

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r50-route-"));
  const root = path.join(sandbox, "repo");
  const external = path.join(sandbox, "external");
  fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
  storage = createGuildStorage(root, {
    activeRoot: root,
    profile: "standalone",
    env: {
      GUILD_STATE_HOME: path.join(external, "state"),
      GUILD_CACHE_HOME: path.join(external, "cache"),
      GUILD_WORKTREE_HOME: path.join(external, "worktrees"),
      GUILD_TEMP_HOME: path.join(external, "temp"),
    } as NodeJS.ProcessEnv,
  });
  runDir = storage.project!.runRecord(RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

const DECISION = {
  slug: "prefer-idempotent-retries",
  title: "Prefer idempotent retries over at-most-once delivery",
  body: "Every queue consumer must be idempotent. At-most-once delivery loses work on a redeploy.",
  reasoning: "The operator redirected the same approach three times in this run.",
  source_refs: [`run:${RUN_ID}`],
};

function redirect() {
  return routeRedirect({
    run_id: RUN_ID,
    agent_id: "backend",
    topic_key: "retry-semantics",
    correction: "Make every queue consumer idempotent.",
    runDir,
    storage,
    decision: DECISION,
  });
}

function pagePath(): string {
  return storage.project!.knowledge("decisions", `${DECISION.slug}.md`);
}

function events(): Array<Record<string, unknown>> {
  const p = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Drive three redirects; report what each one did. */
function threeRedirects() {
  const out: Array<{ fired: boolean; harvested: boolean; pageExists: boolean }> = [];
  for (let i = 0; i < 3; i++) {
    const r = redirect();
    out.push({ fired: r.redirect.fires_harvest, harvested: r.harvest !== null, pageExists: fs.existsSync(pagePath()) });
  }
  return out;
}

describe("R50 — the third T0-routed redirect harvests through the real ledger", () => {
  it("the second redirect writes nothing; the third lands the decision page and the events", () => {
    const steps = threeRedirects();
    expect(steps).toEqual([
      { fired: false, harvested: false, pageExists: false },
      { fired: false, harvested: false, pageExists: false },
      { fired: true, harvested: true, pageExists: true },
    ]);

    expect(readRedirectLedger(RUN_ID, { storage }).entries).toEqual([
      expect.objectContaining({ agent_id: "backend", topic_key: "retry-semantics", count: 3 }),
    ]);
    const page = fs.readFileSync(pagePath(), "utf8");
    expect(page).toMatch(/^status: canonical$/m);
    expect(page).toMatch(/^trigger: redirect_threshold$/m);
    expect(searchWiki("idempotent retries queue consumer", { storage }).hits.map((h) => h.rel)).toContain(
      `decisions/${DECISION.slug}.md`,
    );

    const ev = events();
    expect(ev.filter((e) => e.event === "redirect_event").map((e) => [e.count, e.fired])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    const harvest = ev.filter((e) => e.event === "harvest_event");
    expect(harvest.length).toBeGreaterThan(0);
    expect(harvest.every((e) => e.trigger === "redirect_threshold")).toBe(true);
    // Every harvest event comes after the third redirect event, none before.
    const thirdAt = ev.findIndex((e) => e.event === "redirect_event" && e.count === 3);
    expect(ev.findIndex((e) => e.event === "harvest_event")).toBeGreaterThan(thirdAt);

    // A fourth redirect does not re-harvest.
    expect(redirect().harvest).toBeNull();
  });

  // Runs last: mock.module is not undone for the rest of this file.
  it("CONTROL: with the threshold comparison forced to false, no redirect harvests", () => {
    const real = ledgerModule.recordRedirect;
    mock.module(path.join(import.meta.dir, "redirect-ledger.ts"), () => ({
      ...ledgerModule,
      recordRedirect: (...args: Parameters<typeof real>) => ({ ...real(...args), fires_harvest: false }),
    }));
    const steps = threeRedirects();
    expect(steps.map((s) => s.harvested)).toEqual([false, false, false]);
    expect(fs.existsSync(pagePath())).toBe(false);
    expect(events().some((e) => e.event === "harvest_event")).toBe(false);
    expect(readRedirectLedger(RUN_ID, { storage }).entries[0].count).toBe(3);
  });
});
