/**
 * scripts/__tests__/initiative-gate.test.ts
 *
 * TDD suite for scripts/initiative-gate.ts — the deterministic bridge that
 * makes the D8 close gate (`d8CloseGate` + `populateReleaseDocsWorkItems`,
 * scripts/lib/initiative.ts / initiative-workitems.ts) reachable from
 * `/guild:initiative close` (plugin-implementation-audit-2026-07-12 G3).
 *
 * Covers: legacy-status mapping (fail-closed on the unrecognized), manifest
 * lookup (active/archived), the `close-check` and `docs-workitems`
 * sub-commands end-to-end over two fixture initiatives — one that PASSES the
 * gate and one that FAILS on the docs leg — and CLI arg parsing.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  loadInitiativeManifest,
  buildD8Input,
  parseGateArgs,
  runCloseCheck,
  runDocsWorkitems,
} from "../initiative-gate";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-initiative-gate-test-"));
}

function writeManifest(root: string, bucket: "active" | "archived", id: string, yaml: string): void {
  const dir = path.join(root, ".guild", "initiatives", bucket, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "initiative.yaml"), yaml, "utf8");
}

const PASSING_YAML = `initiative:
  id: fixture-passing
  title: "Fixture initiative that clears D8"
  execution_status: done
  release_status: released
  documentation_status: updated
`;

// release resolved, but documentation_status is a legacy value this repo's
// corpus actually uses ("pending") that maps to update_required — i.e. the
// docs leg is NOT resolved, so the gate must fail on it alone.
const FAILING_DOCS_YAML = `initiative:
  id: fixture-failing-docs
  title: "Fixture initiative that fails only the docs leg"
  execution_status: done
  release_status: released
  documentation_status: pending
`;

// ---------------------------------------------------------------------------
// loadInitiativeManifest
// ---------------------------------------------------------------------------

describe("loadInitiativeManifest", () => {
  test("finds an active initiative's manifest and unwraps the initiative: map", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-passing", PASSING_YAML);
    const loaded = loadInitiativeManifest(root, "fixture-passing");
    expect(loaded).not.toBeNull();
    expect(loaded!.raw.id).toBe("fixture-passing");
    expect(loaded!.path.endsWith(path.join("active", "fixture-passing", "initiative.yaml"))).toBe(true);
  });

  test("falls back to archived/ when not found in active/", () => {
    const root = makeRoot();
    writeManifest(root, "archived", "fixture-archived", PASSING_YAML);
    const loaded = loadInitiativeManifest(root, "fixture-archived");
    expect(loaded).not.toBeNull();
    expect(loaded!.path).toContain(`${path.sep}archived${path.sep}`);
  });

  test("returns null when no manifest exists in either bucket", () => {
    const root = makeRoot();
    expect(loadInitiativeManifest(root, "does-not-exist")).toBeNull();
  });

  test("returns null when the file has no top-level initiative: map", () => {
    const root = makeRoot();
    writeManifest(root, "active", "malformed", "not_initiative:\n  id: x\n");
    expect(loadInitiativeManifest(root, "malformed")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildD8Input — legacy mapping, fail-closed on the unrecognized
// ---------------------------------------------------------------------------

describe("buildD8Input", () => {
  test("passes canonical enum values through untouched, no warnings", () => {
    const { input, warnings } = buildD8Input(
      { execution_status: "done", release_status: "released", documentation_status: "updated" },
      true,
    );
    expect(input).toEqual({
      execVerified: true,
      execution_status: "done",
      release_status: "released",
      documentation_status: "updated",
    });
    expect(warnings).toEqual([]);
  });

  test("maps the repo's real legacy spellings (in_progress, pending, in-sync)", () => {
    const { input, warnings } = buildD8Input(
      { execution_status: "in_progress", release_status: "released", documentation_status: "in-sync" },
      false,
    );
    expect(input.execution_status).toBe("active");
    expect(input.documentation_status).toBe("no_update_required");
    expect(warnings.some((w) => w.includes("in_progress"))).toBe(true);
    expect(warnings.some((w) => w.includes("in-sync"))).toBe(true);
  });

  test("an unrecognized value is treated as UNRESOLVED, never guessed toward resolved", () => {
    const { input, warnings } = buildD8Input(
      { execution_status: "done", release_status: "released", documentation_status: "bogus-value" },
      true,
    );
    expect(input.documentation_status).toBe("not_assessed"); // least-resolved fallback
    expect(warnings.some((w) => w.includes("bogus-value"))).toBe(true);
  });

  test("a missing field is treated as UNRESOLVED with a warning", () => {
    const { input, warnings } = buildD8Input({ execution_status: "done" }, true);
    expect(input.release_status).toBe("not_released");
    expect(input.documentation_status).toBe("not_assessed");
    expect(warnings.some((w) => w.includes("release_status"))).toBe(true);
    expect(warnings.some((w) => w.includes("documentation_status"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseGateArgs
// ---------------------------------------------------------------------------

describe("parseGateArgs", () => {
  test("parses close-check with all flags", () => {
    const parsed = parseGateArgs(["close-check", "--initiative", "foo", "--root", "/tmp/x", "--exec-verified=true"]);
    expect(parsed).toEqual({ command: "close-check", initiative: "foo", root: path.resolve("/tmp/x"), execVerified: true });
  });

  test("defaults root to cwd and execVerified to false", () => {
    const parsed = parseGateArgs(["docs-workitems", "--initiative=bar"]);
    expect("error" in parsed).toBe(false);
    if (!("error" in parsed)) {
      expect(parsed.initiative).toBe("bar");
      expect(parsed.execVerified).toBe(false);
      expect(parsed.root).toBe(path.resolve("."));
    }
  });

  test("errors on missing sub-command", () => {
    expect(parseGateArgs([])).toHaveProperty("error");
  });

  test("errors on missing --initiative", () => {
    expect(parseGateArgs(["close-check"])).toHaveProperty("error");
  });

  test("errors on an unknown flag", () => {
    expect(parseGateArgs(["close-check", "--initiative", "x", "--bogus"])).toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// runCloseCheck / runDocsWorkitems — end-to-end over the two fixtures
// ---------------------------------------------------------------------------

describe("runCloseCheck — fixture: fully-resolved initiative PASSES", () => {
  test("canClose true, pass true, no blockers", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-passing", PASSING_YAML);
    const out = runCloseCheck(root, "fixture-passing", true);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      expect(out.pass).toBe(true);
      expect(out.result.canClose).toBe(true);
      expect(out.result.blockers).toEqual([]);
      expect(out.result.legs).toEqual({ exec: true, release: true, docs: true });
    }
  });
});

describe("runCloseCheck — fixture: docs leg unresolved FAILS", () => {
  test("canClose false, pass false, docs leg + only the docs leg blocked", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-failing-docs", FAILING_DOCS_YAML);
    const out = runCloseCheck(root, "fixture-failing-docs", true);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      expect(out.pass).toBe(false);
      expect(out.result.canClose).toBe(false);
      expect(out.result.legs).toEqual({ exec: true, release: true, docs: false });
      expect(out.result.blockers).toEqual(["docs leg unresolved: documentation_status not 'updated'/'no_update_required'"]);
      // "pending" is a recognized legacy alias (update_required), so it should
      // NOT also appear as an "unrecognized value" warning.
      expect(out.warnings.some((w) => w.includes("unrecognized"))).toBe(false);
    }
  });
});

describe("runCloseCheck — exec leg unresolved when --exec-verified is omitted (fail-closed default)", () => {
  test("execVerified defaults false, exec leg blocked even with execution_status done", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-passing", PASSING_YAML);
    const out = runCloseCheck(root, "fixture-passing", false);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      expect(out.pass).toBe(false);
      expect(out.result.legs.exec).toBe(false);
    }
  });
});

describe("runCloseCheck — missing initiative", () => {
  test("returns an error, not a thrown exception", () => {
    const root = makeRoot();
    const out = runCloseCheck(root, "does-not-exist", true);
    expect(out).toHaveProperty("error");
  });
});

describe("runDocsWorkitems", () => {
  test("a fully-resolved initiative emits NO work items", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-passing", PASSING_YAML);
    const out = runDocsWorkitems(root, "fixture-passing", true);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      expect(out.work_items).toEqual([]);
    }
  });

  test("the docs-failing initiative emits exactly one docs work item (release already resolved)", () => {
    const root = makeRoot();
    writeManifest(root, "active", "fixture-failing-docs", FAILING_DOCS_YAML);
    const out = runDocsWorkitems(root, "fixture-failing-docs", true);
    expect("error" in out).toBe(false);
    if (!("error" in out)) {
      expect(out.work_items.map((w) => w.type)).toEqual(["docs"]);
      expect(out.work_items[0].id).toBe("fixture-failing-docs-wi-docs");
      expect(out.work_items[0].depends_on).toEqual([]); // release already resolved
    }
  });
});
