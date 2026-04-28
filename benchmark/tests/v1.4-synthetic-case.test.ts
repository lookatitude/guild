// v1.4.0 — T3d-backend-platform F-7 synthetic case + scorer wiring tests.
// Pins the binding contract:
//   - case YAML loads + parses via the shared case-loader.
//   - `model_family` derived for haiku/sonnet/opus inputs.
//   - `model_family` ABSENT for unknown / missing model_ref.default.
//   - commands/guild.md `allowed-tools` line is greppable for the 4 additive entries.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { loadCase } from "../src/case-loader.js";
import { deriveModelFamily, scoreRun } from "../src/scorer.js";
import type { Case, RunRecord } from "../src/types.js";

const CASE_PATH = resolve(__dirname, "../cases/v1.4-synthetic-model-family.yaml");
const COMMANDS_GUILD = resolve(__dirname, "../../commands/guild.md");

describe("F-7 synthetic case YAML", () => {
  it("file exists at the documented path", () => {
    expect(existsSync(CASE_PATH)).toBe(true);
  });

  it("loads + parses via the shared case-loader (Case shape)", async () => {
    const c = await loadCase(CASE_PATH);
    // id is kebab-case constrained (no dots) — see case-loader regex.
    expect(c.id).toBe("v14-synthetic-model-family");
    expect(c.schema_version).toBe(1);
    expect(c.timeout_seconds).toBeGreaterThan(0);
    expect(c.repetitions).toBeGreaterThan(0);
    expect(c.expected_specialists).toContain("backend");
    expect(c.expected_stage_order.length).toBeGreaterThan(0);
    expect(typeof c.prompt).toBe("string");
    expect(c.prompt.length).toBeGreaterThan(0);
  });

  it("declares acceptance commands that exercise typecheck + scorer test", async () => {
    const c = await loadCase(CASE_PATH);
    const joined = c.acceptance_commands.join(" ");
    expect(joined).toContain("typecheck");
    expect(joined).toContain("scorer");
  });
});

describe("scorer.deriveModelFamily — F-7 mapping", () => {
  it("returns 'haiku' for any model_ref.default containing 'haiku' (case-insensitive)", () => {
    expect(deriveModelFamily({ default: "claude-haiku-4-5-20251001" })).toBe("haiku");
    expect(deriveModelFamily({ default: "Claude-HAIKU-3-5" })).toBe("haiku");
  });

  it("returns 'sonnet' for any model_ref.default containing 'sonnet'", () => {
    expect(deriveModelFamily({ default: "claude-sonnet-4-6" })).toBe("sonnet");
    expect(deriveModelFamily({ default: "claude-sonnet-3-7" })).toBe("sonnet");
  });

  it("returns 'opus' for any model_ref.default containing 'opus'", () => {
    expect(deriveModelFamily({ default: "claude-opus-4-7" })).toBe("opus");
    expect(deriveModelFamily({ default: "claude-OPUS-3" })).toBe("opus");
  });

  it("returns undefined for unknown / missing / empty inputs", () => {
    expect(deriveModelFamily({ default: "claude-unknown-tier" })).toBeUndefined();
    expect(deriveModelFamily({ default: "" })).toBeUndefined();
    expect(deriveModelFamily({})).toBeUndefined();
    expect(deriveModelFamily(undefined)).toBeUndefined();
  });
});

describe("scoreRun emits model_family on Score", () => {
  function fakeRecord(modelDefault: string): RunRecord {
    return {
      run: {
        schema_version: 1,
        run_id: "fake",
        case_slug: "smoke-noop",
        plugin_ref: "test",
        model_ref: { default: modelDefault },
        started_at: "2026-04-27T00:00:00Z",
        completed_at: "2026-04-27T00:00:01Z",
        status: "pass",
      },
      events: [],
      runDir: "/tmp/fake",
      artifactsRoot: "/tmp/fake-artifacts",
      receipts: [],
      hasReview: false,
      hasAssumptions: false,
      hasReflection: false,
      partial: true,
      missing_artifacts: ["events.ndjson"],
    };
  }

  function fakeCase(): Case {
    return {
      schema_version: 1,
      id: "smoke-noop",
      title: "smoke",
      timeout_seconds: 60,
      repetitions: 1,
      fixture: "../fixtures/synthetic-pass",
      prompt: "noop",
      expected_specialists: [],
      expected_stage_order: [],
      acceptance_commands: [],
    };
  }

  it("populates score.model_family for a haiku model_ref", () => {
    const { score } = scoreRun(fakeRecord("claude-haiku-4-5-20251001"), fakeCase());
    expect(score.model_family).toBe("haiku");
  });

  it("populates score.model_family for a sonnet model_ref", () => {
    const { score } = scoreRun(fakeRecord("claude-sonnet-4-6"), fakeCase());
    expect(score.model_family).toBe("sonnet");
  });

  it("populates score.model_family for an opus model_ref", () => {
    const { score } = scoreRun(fakeRecord("claude-opus-4-7"), fakeCase());
    expect(score.model_family).toBe("opus");
  });

  it("OMITS the model_family field when no tier is recognised", () => {
    const { score } = scoreRun(fakeRecord("claude-unknown"), fakeCase());
    expect(score.model_family).toBeUndefined();
    // Still serializes cleanly (optional field absent ≠ field with undefined).
    const json = JSON.parse(JSON.stringify(score));
    expect("model_family" in json).toBe(false);
  });
});

describe("commands/guild.md — additive allowed-tools update", () => {
  it("appends AskUserQuestion, TaskCreate, TaskUpdate, TaskList without removing v1.3 tools", () => {
    const text = readFileSync(COMMANDS_GUILD, "utf8");
    const allowedToolsLine = text
      .split("\n")
      .find((line) => line.startsWith("allowed-tools:"));
    expect(allowedToolsLine).toBeDefined();
    // v1.3 tools preserved.
    expect(allowedToolsLine).toContain("Read");
    expect(allowedToolsLine).toContain("Write");
    expect(allowedToolsLine).toContain("Edit");
    expect(allowedToolsLine).toContain("Grep");
    expect(allowedToolsLine).toContain("Glob");
    expect(allowedToolsLine).toContain("Bash");
    expect(allowedToolsLine).toContain("Agent");
    expect(allowedToolsLine).toContain("Skill");
    // v1.4 additive entries — the architect's 4 named tools.
    expect(allowedToolsLine).toContain("AskUserQuestion");
    expect(allowedToolsLine).toContain("TaskCreate");
    expect(allowedToolsLine).toContain("TaskUpdate");
    expect(allowedToolsLine).toContain("TaskList");
  });
});
