import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CaseValidationError,
  loadCase,
  parseCase,
} from "../src/case-loader.js";

const CASES_DIR = resolve(__dirname, "..", "cases");

const VALID_YAML = `
schema_version: 1
id: test-case
title: Test case
timeout_seconds: 600
repetitions: 1
fixture: ../fixtures/synthetic-pass
prompt: |
  do the thing
expected_specialists:
  - architect
  - backend
expected_stage_order:
  - brainstorm
  - team
  - plan
  - context
  - execute
  - review
  - verify
  - reflect
acceptance_commands:
  - npm test
`.trim();

describe("case-loader / parseCase", () => {
  it("parses a valid case YAML into a Case object", () => {
    const c = parseCase(VALID_YAML);
    expect(c.id).toBe("test-case");
    expect(c.expected_specialists).toEqual(["architect", "backend"]);
    expect(c.expected_stage_order).toHaveLength(8);
    expect(c.acceptance_commands).toEqual(["npm test"]);
  });

  it("applies defaults for omitted optional fields", () => {
    const minimal = `
id: minimal-case
title: Minimal case
fixture: ../fixtures/synthetic-pass
prompt: do thing
expected_specialists:
  - architect
expected_stage_order:
  - brainstorm
`.trim();
    const c = parseCase(minimal);
    expect(c.schema_version).toBe(1);
    expect(c.timeout_seconds).toBe(1200);
    expect(c.repetitions).toBe(1);
    expect(c.acceptance_commands).toEqual([]);
  });

  it("rejects YAML that is not valid YAML at all", () => {
    expect(() => parseCase("::: not yaml :::\n  - [")).toThrow(
      CaseValidationError,
    );
  });

  it("rejects a case with an uppercase id (kebab-case enforced)", () => {
    const bad = VALID_YAML.replace("id: test-case", "id: TestCase");
    expect(() => parseCase(bad)).toThrow(CaseValidationError);
  });

  it("rejects a case missing required fields", () => {
    const bad = `
id: missing-fields
title: t
`.trim();
    try {
      parseCase(bad);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(CaseValidationError);
      expect((e as CaseValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("accepts a scoring_weights override that sums to 100", () => {
    const yaml = `${VALID_YAML}\nscoring_weights:\n  outcome: 40\n  delegation: 20\n  gates: 15\n  evidence: 10\n  loop_response: 10\n  efficiency: 5\n`;
    const c = parseCase(yaml);
    expect(c.scoring_weights?.outcome).toBe(40);
  });

  it("rejects a scoring_weights override that does not sum to 100", () => {
    const yaml = `${VALID_YAML}\nscoring_weights:\n  outcome: 50\n  delegation: 20\n  gates: 15\n  evidence: 10\n  loop_response: 10\n  efficiency: 5\n`;
    expect(() => parseCase(yaml)).toThrow(/sum to 100/);
  });

  it("includes the source path in the error message", () => {
    try {
      parseCase("id: BAD", "/tmp/bad.yaml");
      expect.fail("should throw");
    } catch (e) {
      expect((e as Error).message).toContain("/tmp/bad.yaml");
    }
  });
});

describe("case-loader / loadCase against shipped demo cases", () => {
  it("loads cases/demo-url-shortener-build.yaml without error", async () => {
    const c = await loadCase(join(CASES_DIR, "demo-url-shortener-build.yaml"));
    expect(c.id).toBe("demo-url-shortener-build");
    expect(c.expected_specialists).toEqual([
      "architect",
      "backend",
      "qa",
      "technical-writer",
    ]);
    expect(c.expected_stage_order).toHaveLength(8);
    expect(c.acceptance_commands).toHaveLength(5);
    expect(c.wall_clock_budget_ms).toBe(1500000);
  });

  it("loads cases/demo-context-drift-evolve.yaml without error", async () => {
    const c = await loadCase(join(CASES_DIR, "demo-context-drift-evolve.yaml"));
    expect(c.id).toBe("demo-context-drift-evolve");
    expect(c.expected_specialists).toContain("researcher");
    expect(c.acceptance_commands).toHaveLength(3);
  });
});

describe("case-loader / loadCase IO errors", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "case-loader-test-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects when the file does not exist", async () => {
    await expect(loadCase(join(dir, "missing.yaml"))).rejects.toThrow();
  });

  it("loads a freshly written valid case file from disk", async () => {
    const path = join(dir, "round-trip.yaml");
    await writeFile(path, VALID_YAML, "utf8");
    const c = await loadCase(path);
    expect(c.id).toBe("test-case");
  });
});
