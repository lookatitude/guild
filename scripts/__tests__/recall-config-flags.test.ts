/**
 * __tests__/recall-config-flags.test.ts — compositeRecall + importanceAtIngest as
 * first-class, configurable, ENABLED-BY-DEFAULT config-object flags (docs/v2/knowledge-memory.md).
 * Also locks the merge-fix: a user's settings.json value must actually be honored
 * (compositeRecall previously had NO merge logic — silently dropped).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveSettings } from "../lib/settings-resolver";
import { DEFAULTS } from "../read-guild-config";

function mkRepo(settings?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-flags-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
  }
  return dir;
}
const repos: string[] = [];
afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const repo = (s?: unknown): string => { const d = mkRepo(s); repos.push(d); return d; };
const models = (cwd: string) => resolveSettings({ cwd }).config.models;

describe("defaults — both features ENABLED by default (operator decision 2026-06-21)", () => {
  it("compositeRecall + importanceAtIngest default to true; importanceGate stays 3", () => {
    const m = models(repo());
    expect(m.compositeRecall).toBe(true);
    expect(m.importanceAtIngest).toBe(true);
    expect(m.importanceGate).toBe(3);
  });
});

describe("merge — a settings.json value is honored (regression: compositeRecall had no merge)", () => {
  it("compositeRecall:false in settings.json is RESPECTED (was silently dropped before the fix)", () => {
    const m = models(repo({ models: { compositeRecall: false } }));
    expect(m.compositeRecall).toBe(false);
  });
  it("importanceAtIngest:false in settings.json is RESPECTED", () => {
    const m = models(repo({ models: { importanceAtIngest: false } }));
    expect(m.importanceAtIngest).toBe(false);
  });
  it("anti-vacuity: an absent override leaves the default true (the merge isn't blanket-forcing false)", () => {
    const m = models(repo({ models: { importanceGate: 4 } }));
    expect(m.compositeRecall).toBe(true);
    expect(m.importanceAtIngest).toBe(true);
    expect(m.importanceGate).toBe(4);
  });
});

describe("dual-source-of-truth guard — the two DEFAULTS blocks must agree", () => {
  // settings-resolver.ts (the live resolveSettings path) and read-guild-config.ts (CLI/scaffold)
  // EACH carry a DEFAULTS.models block. They drifted once (this lane: compositeRecall was flipped
  // in read-guild-config but the live resolver still defaulted false). This guard fails the moment
  // they diverge again — covering EVERY models key, not just the two this lane touched.
  it("resolveSettings (live) defaults == read-guild-config DEFAULTS.models for a fresh repo", () => {
    const live = models(repo());
    expect(live).toEqual(DEFAULTS.models);
  });
});
