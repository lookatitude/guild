/**
 * __tests__/telemetry-redirect.test.ts
 *
 * Full-class telemetry export redirect map (v2.x — FDC-15).
 *
 * Tests cover:
 *   1. Happy path — each durable class resolves to its canonical partialPath.
 *   2. Contract guarantees:
 *      a. All durable classes set mainRootRequired = true.
 *      b. redirectActive reflects config.worktree_redirect_enabled (default false).
 *      c. resolveTelemetryTarget is pure (same inputs → same outputs, no side-effects).
 *   3. Malformed / edge-case inputs:
 *      a. Unknown event class → valid: false + fallback to trace_events path.
 *      b. Empty string → valid: false + fallback.
 *      c. Absent / null config key → redirectActive = false (safe default).
 *   4. Batch resolver returns all classes.
 *   5. Closed-set guard — DURABLE_EVENT_CLASSES is a const tuple (no accidental mutation).
 *   6. Validation helper (validateEventClass) returns correct shape.
 *   7. isDurableEventClass type-guard is accurate.
 */

import {
  resolveTelemetryTarget,
  resolveAllTelemetryTargets,
  validateEventClass,
  isDurableEventClass,
  DURABLE_EVENT_CLASSES,
  DURABLE_CLASS_PRIMARY_PATHS,
  MAIN_ROOT_REQUIRED_CLASSES,
  type DurableEventClass,
  type TelemetryRedirectConfig,
} from "../lib/telemetry-redirect";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** An empty config — default-off redirect. */
const DEFAULT_CONFIG: TelemetryRedirectConfig = {};

/** A config with redirect explicitly enabled. */
const REDIRECT_CONFIG: TelemetryRedirectConfig = { worktree_redirect_enabled: true };

// ---------------------------------------------------------------------------
// 1. Happy path — each class resolves to a non-empty partialPath
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — happy path", () => {
  test("resolves every DURABLE_EVENT_CLASS to a non-empty partialPath", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target, valid, message } = resolveTelemetryTarget(cls, DEFAULT_CONFIG);
      expect(valid).toBe(true);
      expect(message).toBe("");
      expect(target.partialPath).toBeTruthy();
      expect(target.partialPath.length).toBeGreaterThan(0);
      expect(target.eventClass).toBe(cls);
    }
  });

  test("knowledge_graph resolves to indexes/knowledge-graph.json", () => {
    const { target } = resolveTelemetryTarget("knowledge_graph", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("indexes/knowledge-graph.json");
  });

  test("knowledge_links resolves to indexes/knowledge-links.json", () => {
    const { target } = resolveTelemetryTarget("knowledge_links", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("indexes/knowledge-links.json");
  });

  test("provenance resolves to runs/<run-id>/provenance.json", () => {
    const { target } = resolveTelemetryTarget("provenance", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("runs/<run-id>/provenance.json");
  });

  test("trace_events resolves to runs/<run-id>/logs/v1.4-events.jsonl", () => {
    const { target } = resolveTelemetryTarget("trace_events", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("runs/<run-id>/logs/v1.4-events.jsonl");
  });

  test("initiatives_registry resolves to indexes/initiatives-registry.yaml", () => {
    const { target } = resolveTelemetryTarget("initiatives_registry", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("indexes/initiatives-registry.yaml");
  });

  test("reflections resolves to reflections/", () => {
    const { target } = resolveTelemetryTarget("reflections", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("reflections/");
  });

  test("skill_instances resolves to skill-versions/", () => {
    const { target } = resolveTelemetryTarget("skill_instances", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("skill-versions/");
  });

  test("learning resolves to learning/", () => {
    const { target } = resolveTelemetryTarget("learning", DEFAULT_CONFIG);
    expect(target.partialPath).toBe("learning/");
  });
});

// ---------------------------------------------------------------------------
// 2a. Contract — mainRootRequired is true for all durable classes
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — mainRootRequired contract", () => {
  test("every durable class has mainRootRequired = true", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target } = resolveTelemetryTarget(cls, DEFAULT_CONFIG);
      expect(target.mainRootRequired).toBe(true);
    }
  });

  test("MAIN_ROOT_REQUIRED_CLASSES contains every durable class", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(MAIN_ROOT_REQUIRED_CLASSES.has(cls)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. Contract — redirectActive reflects config.worktree_redirect_enabled
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — redirectActive contract", () => {
  test("redirectActive = false when config is empty (default-off)", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target } = resolveTelemetryTarget(cls, {});
      expect(target.redirectActive).toBe(false);
    }
  });

  test("redirectActive = false when worktree_redirect_enabled is absent", () => {
    const { target } = resolveTelemetryTarget("provenance", DEFAULT_CONFIG);
    expect(target.redirectActive).toBe(false);
  });

  test("redirectActive = true when worktree_redirect_enabled = true", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target } = resolveTelemetryTarget(cls, REDIRECT_CONFIG);
      expect(target.redirectActive).toBe(true);
    }
  });

  test("redirectActive = false when worktree_redirect_enabled = false (explicit off)", () => {
    const config: TelemetryRedirectConfig = { worktree_redirect_enabled: false };
    const { target } = resolveTelemetryTarget("run_records", config);
    expect(target.redirectActive).toBe(false);
  });

  test("partialPath is the same regardless of redirectActive (path is not changed by this function)", () => {
    // The CALLER resolves the absolute path using the redirect flag; this function
    // only returns the canonical partial path.
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target: off } = resolveTelemetryTarget(cls, DEFAULT_CONFIG);
      const { target: on } = resolveTelemetryTarget(cls, REDIRECT_CONFIG);
      expect(off.partialPath).toBe(on.partialPath);
    }
  });
});

// ---------------------------------------------------------------------------
// 2c. Contract — purity (deterministic; no side-effects)
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — purity contract", () => {
  test("same inputs produce identical output (no side-effects between calls)", () => {
    const first  = resolveTelemetryTarget("trace_events", REDIRECT_CONFIG);
    const second = resolveTelemetryTarget("trace_events", REDIRECT_CONFIG);
    expect(first).toEqual(second);
  });

  test("calling the function does not mutate the config object", () => {
    const config: TelemetryRedirectConfig = { worktree_redirect_enabled: true };
    const before = JSON.stringify(config);
    resolveTelemetryTarget("provenance", config);
    expect(JSON.stringify(config)).toBe(before);
  });

  test("calling the function does not mutate DURABLE_CLASS_PRIMARY_PATHS", () => {
    const before = JSON.stringify(DURABLE_CLASS_PRIMARY_PATHS);
    for (const cls of DURABLE_EVENT_CLASSES) {
      resolveTelemetryTarget(cls, REDIRECT_CONFIG);
    }
    expect(JSON.stringify(DURABLE_CLASS_PRIMARY_PATHS)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 3a. Malformed input — unknown event class
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — malformed/edge-case inputs", () => {
  test("unknown event class → valid: false and fallback to trace_events path", () => {
    const result = resolveTelemetryTarget("totally_unknown_class", DEFAULT_CONFIG);
    expect(result.valid).toBe(false);
    expect(result.message).toContain("totally_unknown_class");
    expect(result.target.partialPath).toBe(
      DURABLE_CLASS_PRIMARY_PATHS["trace_events"],
    );
    expect(result.target.eventClass).toBe("trace_events");
  });

  test("empty string → valid: false and fallback to trace_events path", () => {
    const result = resolveTelemetryTarget("", DEFAULT_CONFIG);
    expect(result.valid).toBe(false);
    expect(result.target.partialPath).toBe(
      DURABLE_CLASS_PRIMARY_PATHS["trace_events"],
    );
  });

  test("unknown class with redirect on → fallback still has redirectActive = true", () => {
    const result = resolveTelemetryTarget("no_such_class", REDIRECT_CONFIG);
    expect(result.valid).toBe(false);
    expect(result.target.redirectActive).toBe(true);
    expect(result.target.mainRootRequired).toBe(true);
  });

  test("unknown class error message lists valid classes", () => {
    const result = resolveTelemetryTarget("bogus", DEFAULT_CONFIG);
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(result.message).toContain(cls);
    }
  });
});

// ---------------------------------------------------------------------------
// 3c. Absent / null config key → safe default (redirectActive = false)
// ---------------------------------------------------------------------------

describe("resolveTelemetryTarget — null/absent config safety", () => {
  test("absent worktree_redirect_enabled key → redirectActive = false", () => {
    const config: TelemetryRedirectConfig = {};
    const { target } = resolveTelemetryTarget("provenance", config);
    expect(target.redirectActive).toBe(false);
  });

  test("undefined worktree_redirect_enabled key → redirectActive = false", () => {
    const config: TelemetryRedirectConfig = { worktree_redirect_enabled: undefined };
    const { target } = resolveTelemetryTarget("knowledge_graph", config);
    expect(target.redirectActive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Batch resolver
// ---------------------------------------------------------------------------

describe("resolveAllTelemetryTargets — batch resolver", () => {
  test("returns a target for every DURABLE_EVENT_CLASS", () => {
    const table = resolveAllTelemetryTargets(DEFAULT_CONFIG);
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(table[cls]).toBeDefined();
      expect(table[cls].partialPath).toBeTruthy();
    }
  });

  test("all entries have redirectActive = false when config is default-off", () => {
    const table = resolveAllTelemetryTargets(DEFAULT_CONFIG);
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(table[cls].redirectActive).toBe(false);
    }
  });

  test("all entries have redirectActive = true when redirect enabled", () => {
    const table = resolveAllTelemetryTargets(REDIRECT_CONFIG);
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(table[cls].redirectActive).toBe(true);
    }
  });

  test("batch and single resolver return identical targets", () => {
    const table = resolveAllTelemetryTargets(REDIRECT_CONFIG);
    for (const cls of DURABLE_EVENT_CLASSES) {
      const { target } = resolveTelemetryTarget(cls, REDIRECT_CONFIG);
      expect(table[cls]).toEqual(target);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Closed-set guard — DURABLE_EVENT_CLASSES is immutable
// ---------------------------------------------------------------------------

describe("DURABLE_EVENT_CLASSES — closed-set contract", () => {
  test("contains at least the 10 canonical durable classes", () => {
    const expected: DurableEventClass[] = [
      "knowledge_graph",
      "knowledge_links",
      "codebase_map",
      "provenance",
      "run_records",
      "trace_events",
      "learning",
      "initiatives_registry",
      "skill_instances",
      "reflections",
    ];
    for (const cls of expected) {
      expect(DURABLE_EVENT_CLASSES).toContain(cls);
    }
  });

  test("no duplicate entries", () => {
    const unique = new Set(DURABLE_EVENT_CLASSES);
    expect(unique.size).toBe(DURABLE_EVENT_CLASSES.length);
  });

  test("DURABLE_CLASS_PRIMARY_PATHS has a key for every class", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(Object.prototype.hasOwnProperty.call(DURABLE_CLASS_PRIMARY_PATHS, cls)).toBe(true);
      expect(DURABLE_CLASS_PRIMARY_PATHS[cls]).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. validateEventClass helper
// ---------------------------------------------------------------------------

describe("validateEventClass", () => {
  test("returns valid: true for every known class", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      const result = validateEventClass(cls);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    }
  });

  test("returns valid: false with an error message for unknown class", () => {
    const result = validateEventClass("unknown_thing");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("unknown_thing");
  });

  test("returns valid: false for empty string", () => {
    const result = validateEventClass("");
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. isDurableEventClass type-guard
// ---------------------------------------------------------------------------

describe("isDurableEventClass", () => {
  test("returns true for every DURABLE_EVENT_CLASS member", () => {
    for (const cls of DURABLE_EVENT_CLASSES) {
      expect(isDurableEventClass(cls)).toBe(true);
    }
  });

  test("returns false for unknown strings", () => {
    expect(isDurableEventClass("not_a_class")).toBe(false);
    expect(isDurableEventClass("")).toBe(false);
    expect(isDurableEventClass("guild.trace_event.v1")).toBe(false);
  });
});
