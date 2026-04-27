// backward-compat.test.ts
//
// P4 schema bumped two optional fields: `RunJson.auth_identity_hash` and
// `Comparison.reflection_applied`. Both are optional; existing P1/P2/P3
// fixtures must continue to parse cleanly under the bumped schema. This
// file pins that backward-compat boundary.
//
// We assert against the imported types from `types.ts` rather than
// hand-rolled shapes — TypeScript's structural-typing means a successful
// `as RunJson` / `as Comparison` cast against a real fixture is the
// strongest "still parses" evidence we can produce.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Comparison, RunJson, Score } from "../src/types.js";
import { COMPONENT_KEYS } from "../src/types.js";

const FIXTURES_ROOT = resolve(__dirname, "..", "fixtures");

async function readJson<T>(rel: string): Promise<T> {
  const raw = await readFile(resolve(FIXTURES_ROOT, rel), "utf8");
  return JSON.parse(raw) as T;
}

describe("backward-compat / RunJson — auth_identity_hash optional under P4 schema", () => {
  it("synthetic-pass run.json (P1 fixture) parses against the P4-bumped RunJson type without auth_identity_hash", async () => {
    const run = await readJson<RunJson>("synthetic-pass/run.json");
    expect(run.schema_version).toBe(1);
    expect(run.run_id).toBe("synthetic-pass-001");
    expect(run.status).toBe("pass");
    // Field is optional at the type level; absence is the legacy shape.
    expect(run.auth_identity_hash).toBeUndefined();
    // Required P1 fields remain present.
    expect(run.case_slug).toBeTruthy();
    expect(run.plugin_ref).toBeTruthy();
    expect(typeof run.started_at).toBe("string");
    expect(typeof run.completed_at).toBe("string");
  });

  it("synthetic-fail run.json (P1 fixture) parses without auth_identity_hash", async () => {
    const run = await readJson<RunJson>("synthetic-fail/run.json");
    expect(run.schema_version).toBe(1);
    expect(run.status).toBe("fail");
    expect(run.auth_identity_hash).toBeUndefined();
  });

  it("synthetic-timeout run.json (P1 fixture) parses without auth_identity_hash", async () => {
    const run = await readJson<RunJson>("synthetic-timeout/run.json");
    expect(run.schema_version).toBe(1);
    expect(run.status).toBe("timeout");
    expect(run.auth_identity_hash).toBeUndefined();
  });

  it("a synthetic RunJson WITH auth_identity_hash also parses (forward-compat)", () => {
    const run: RunJson = {
      schema_version: 1,
      run_id: "future-run-123",
      case_slug: "demo-url-shortener-build",
      plugin_ref: "abc1234",
      model_ref: { architect: "claude-opus-4-7" },
      started_at: "2026-04-26T05:30:00Z",
      completed_at: "2026-04-26T05:50:00Z",
      status: "pass",
      auth_identity_hash:
        "deadbeef".repeat(8), // 64-char hex — passes the F3.1 regex
    };
    expect(run.auth_identity_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("backward-compat / Comparison — reflection_applied optional under P4 schema", () => {
  it("UI fixture comparison.json (P2 shape, no reflection_applied) parses against the P4-bumped Comparison type", async () => {
    // The UI fixture is the same shape the API returns for a non-loop
    // comparison — i.e., what every P1/P2/P3 comparison produced.
    const path = resolve(
      __dirname,
      "..",
      "ui",
      "src",
      "__tests__",
      "fixtures",
      "comparison.json",
    );
    const raw = await readFile(path, "utf8");
    const cmp = JSON.parse(raw) as Comparison;
    expect(cmp.schema_version).toBe(1);
    expect(cmp.status).toBeTruthy();
    expect(cmp.reflection_applied).toBeUndefined();
    // Per-component delta has all six keys (P1 schema invariant).
    for (const key of COMPONENT_KEYS) {
      expect(cmp.per_component_delta[key]).toBeDefined();
      expect(typeof cmp.per_component_delta[key].delta).toBe("number");
    }
    expect(typeof cmp.guild_score_delta.delta).toBe("number");
  });

  it("a synthetic Comparison WITH reflection_applied parses (forward-compat)", () => {
    const cmp: Comparison = {
      schema_version: 1,
      baseline: {
        set_id: "set-a",
        run_count: 1,
        pass_count: 1,
        fail_count: 0,
        timeout_count: 0,
        errored_count: 0,
        mean_guild_score: 70,
        canonical_model_ref: { architect: "claude-opus-4-7" },
        canonical_plugin_ref: "abc1234",
        runs: [],
      },
      candidate: {
        set_id: "set-b",
        run_count: 1,
        pass_count: 1,
        fail_count: 0,
        timeout_count: 0,
        errored_count: 0,
        mean_guild_score: 75,
        canonical_model_ref: { architect: "claude-opus-4-7" },
        canonical_plugin_ref: "def5678",
        runs: [],
      },
      status: "ok",
      excluded_runs: [],
      per_component_delta: {
        outcome: { baseline: 60, candidate: 70, delta: 10 },
        delegation: { baseline: 70, candidate: 75, delta: 5 },
        gates: { baseline: 80, candidate: 78, delta: -2 },
        evidence: { baseline: 75, candidate: 76, delta: 1 },
        loop_response: { baseline: 100, candidate: 100, delta: 0 },
        efficiency: { baseline: 80, candidate: 80, delta: 0 },
      },
      guild_score_delta: { baseline: 70, candidate: 75, delta: 5 },
      generated_at: "2026-04-26T17:30:00Z",
      reflection_applied: {
        proposal_id: "ref-2026-04-26",
        source_path: "agents/architect.md",
        applied_at: "2026-04-26T17:00:00Z",
        plugin_ref_before: "abc1234",
        plugin_ref_after: "def5678",
        kept: true,
        delta_summary: {
          guild_score_delta: 5,
          worst_component_delta: -2,
          worst_component: "gates",
        },
      },
    };
    expect(cmp.reflection_applied?.kept).toBe(true);
    expect(cmp.reflection_applied?.proposal_id).toBe("ref-2026-04-26");
  });
});

describe("backward-compat / Score — schema unchanged at P4", () => {
  // P4 did NOT bump Score. This test guards against accidental drift —
  // if a future P-phase extends Score, it must remain optional-only at
  // the type level so existing fixtures still parse.
  it("a synthetic Score parses cleanly with the legacy shape", () => {
    const score: Score = {
      schema_version: 1,
      run_id: "synthetic-pass-001",
      case_slug: "demo-url-shortener-build",
      plugin_ref: "abcdef1",
      model_ref: { architect: "claude-opus-4-7" },
      status: "pass",
      scored_at: "2026-04-26T05:51:00Z",
      partial: false,
      missing_artifacts: [],
      components: {
        outcome: {
          weight: 30,
          raw_subscore: 100,
          max_subscore: 100,
          weighted: 30,
        },
        delegation: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
        gates: { weight: 20, raw_subscore: 100, max_subscore: 100, weighted: 20 },
        evidence: { weight: 15, raw_subscore: 100, max_subscore: 100, weighted: 15 },
        loop_response: {
          weight: 10,
          raw_subscore: 100,
          max_subscore: 100,
          weighted: 10,
        },
        efficiency: { weight: 5, raw_subscore: 100, max_subscore: 100, weighted: 5 },
      },
      guild_score: 100,
    };
    expect(score.guild_score).toBe(100);
    expect(score.components.outcome.weighted).toBe(30);
  });
});
