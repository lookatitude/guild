/**
 * hooks/lib/__tests__/run-date.test.ts
 *
 * Unit tests for hooks/lib/run-date.ts
 *
 * Covers:
 *   readRunStartedAt:
 *     - returns a Date for a well-formed started_at line
 *     - returns null when run.yaml is absent
 *     - returns null when started_at field is missing
 *     - returns null when started_at value is not a valid ISO date
 *
 *   isRunInScope (OD-4 discriminator):
 *     - in-scope: started_at == policy_effective_date (boundary, inclusive)
 *     - in-scope: started_at after policy_effective_date
 *     - grandfathered: started_at before policy_effective_date
 *     - indeterminate: no run.yaml
 *     - indeterminate: malformed started_at
 *
 *   POLICY_EFFECTIVE_DATE:
 *     - equals 2026-06-03T00:00:00Z
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  POLICY_EFFECTIVE_DATE,
  readRunStartedAt,
  isRunInScope,
  RunScopeResult,
} from "../run-date";

/** Narrow a RunScopeResult to the indeterminate variant for assertions. */
function asIndeterminate(
  r: RunScopeResult
): { inscope: false; reason: "indeterminate"; warn: string } {
  // Cast first so TypeScript doesn't fight the discriminated union narrowing
  // in this ts-jest commonjs transform context.
  const cast = r as { inscope: boolean; reason?: string; warn?: string };
  if (cast.inscope) throw new Error("expected inscope:false");
  if (cast.reason !== "indeterminate") {
    throw new Error(`expected reason=indeterminate; got ${cast.reason}`);
  }
  return r as { inscope: false; reason: "indeterminate"; warn: string };
}

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeRunYaml(startedAt: string): string {
  return [
    `schema_version: guild.run.v1`,
    `run_id: run-test-001`,
    `command: /guild:build`,
    `started_at: ${startedAt}`,
    `status: open`,
  ].join("\n") + "\n";
}

function setupRunDir(startedAtValue?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
  if (startedAtValue !== undefined) {
    fs.writeFileSync(path.join(dir, "run.yaml"), makeRunYaml(startedAtValue));
  }
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── POLICY_EFFECTIVE_DATE ─────────────────────────────────────────────────

describe("POLICY_EFFECTIVE_DATE", () => {
  it("is 2026-06-03T00:00:00Z", () => {
    expect(POLICY_EFFECTIVE_DATE.toISOString()).toBe("2026-06-03T00:00:00.000Z");
  });

  it("is a valid Date", () => {
    expect(POLICY_EFFECTIVE_DATE instanceof Date).toBe(true);
    expect(isNaN(POLICY_EFFECTIVE_DATE.getTime())).toBe(false);
  });
});

// ── readRunStartedAt ──────────────────────────────────────────────────────

describe("readRunStartedAt", () => {
  let dir: string;

  afterEach(() => cleanup(dir));

  it("returns a Date for a well-formed ISO started_at line", () => {
    dir = setupRunDir("2026-06-04T12:00:00Z");
    const result = readRunStartedAt(dir);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-06-04T12:00:00.000Z");
  });

  it("returns correct Date for the exact policy_effective_date value", () => {
    dir = setupRunDir("2026-06-03T00:00:00Z");
    const result = readRunStartedAt(dir);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(POLICY_EFFECTIVE_DATE.getTime());
  });

  it("returns null when run.yaml does not exist", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
    // No run.yaml written
    const result = readRunStartedAt(dir);
    expect(result).toBeNull();
  });

  it("returns null when started_at field is absent from run.yaml", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
    fs.writeFileSync(
      path.join(dir, "run.yaml"),
      "schema_version: guild.run.v1\nrun_id: run-no-date\nstatus: open\n"
    );
    const result = readRunStartedAt(dir);
    expect(result).toBeNull();
  });

  it("returns null when started_at is not a valid ISO date string", () => {
    dir = setupRunDir("not-a-date");
    const result = readRunStartedAt(dir);
    expect(result).toBeNull();
  });

  it("returns null when started_at is empty", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
    fs.writeFileSync(
      path.join(dir, "run.yaml"),
      "schema_version: guild.run.v1\nrun_id: run-empty\nstarted_at: \nstatus: open\n"
    );
    const result = readRunStartedAt(dir);
    expect(result).toBeNull();
  });

  it("handles a pre-effective-date date correctly", () => {
    dir = setupRunDir("2026-06-02T23:59:59Z");
    const result = readRunStartedAt(dir);
    expect(result).not.toBeNull();
    expect(result!.toISOString()).toBe("2026-06-02T23:59:59.000Z");
  });
});

// ── isRunInScope ──────────────────────────────────────────────────────────

describe("isRunInScope", () => {
  let dir: string;

  afterEach(() => cleanup(dir));

  describe("in-scope (started_at >= policy_effective_date)", () => {
    it("returns { inscope: true } when started_at equals the effective date boundary", () => {
      dir = setupRunDir("2026-06-03T00:00:00Z");
      const result = isRunInScope(dir, "task-boundary");
      expect(result).toEqual({ inscope: true });
    });

    it("returns { inscope: true } when started_at is after the effective date", () => {
      dir = setupRunDir("2026-07-01T10:00:00Z");
      const result = isRunInScope(dir, "task-future");
      expect(result).toEqual({ inscope: true });
    });

    it("returns { inscope: true } for one second after effective date", () => {
      dir = setupRunDir("2026-06-03T00:00:01Z");
      const result = isRunInScope(dir, "task-one-sec-after");
      expect(result).toEqual({ inscope: true });
    });
  });

  describe("grandfathered (started_at < policy_effective_date)", () => {
    it("returns { inscope: false, reason: 'grandfathered' } when started_at is before the effective date", () => {
      dir = setupRunDir("2026-06-02T23:59:59Z");
      const result = isRunInScope(dir, "task-legacy");
      expect(result).toEqual({ inscope: false, reason: "grandfathered" });
    });

    it("returns grandfathered for an old run date well before the effective date", () => {
      dir = setupRunDir("2026-01-01T00:00:00Z");
      const result = isRunInScope(dir, "task-old");
      expect(result).toEqual({ inscope: false, reason: "grandfathered" });
    });
  });

  describe("indeterminate (fail-open) — no run.yaml or bad started_at", () => {
    it("returns { inscope: false, reason: 'indeterminate' } with a warn when run.yaml is absent", () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
      const result = isRunInScope(dir, "task-no-yaml");
      const narrowed = asIndeterminate(result);
      expect(narrowed.inscope).toBe(false);
      expect(narrowed.reason).toBe("indeterminate");
      expect(narrowed.warn).toMatch(/fail.open|indeterminate|cannot.*date/i);
    });

    it("returns indeterminate with warn when started_at is a garbage value", () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
      fs.writeFileSync(
        path.join(dir, "run.yaml"),
        "schema_version: guild.run.v1\nrun_id: run-bad\nstarted_at: not-a-date\n"
      );
      const result = isRunInScope(dir, "task-bad-date");
      const narrowed = asIndeterminate(result);
      expect(narrowed.inscope).toBe(false);
      expect(narrowed.reason).toBe("indeterminate");
      expect("warn" in narrowed).toBe(true);
    });

    it("includes the task ID in the warn message", () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-run-date-test-"));
      const result = isRunInScope(dir, "task-my-specific-id");
      const narrowed = asIndeterminate(result);
      expect(narrowed.warn).toContain("task-my-specific-id");
    });
  });
});
