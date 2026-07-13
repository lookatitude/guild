/**
 * scripts/comms/__tests__/no-accidental-write.test.ts
 *
 * Usage: npx jest scripts/comms/__tests__/no-accidental-write.test.ts
 *
 * TDD suite for no-accidental-write.ts (U7 — AC-6 negative gate).
 *
 * Policy ref: ADR: communication-format-policy (workspace wiki)
 *   §"Invariants / non-goals" — the five protected surfaces:
 *     (1) .guild/settings.json — must stay JSON (schema shape pinned)
 *     (2) .guild/workspace.json — unchanged (shape pinned)
 *     (3) provenance JSON — .guild/runs/<id>/provenance.json shape pinned
 *     (4) trace JSONL — logs/*.jsonl, events.ndjson line shape pinned
 *     (5) docs/knowledge frontmatter CONVENTIONS — YAML-frontmatter key-set pinned
 *
 * AC-6 exit check: the guard FAILS (exit non-zero / returns violations) on any
 * diff that alters the schema/format of these surfaces, and PASSES on a normal
 * comms-format changeset (lint scripts, skills, handoff docs, CI config).
 *
 * This is the NEGATIVE gate: the initiative must NOT touch these surfaces.
 * A violation means "this comms-format change accidentally mutated a protected
 * surface" — not "these surfaces may never change ever". Changes to these files
 * via OTHER initiatives are allowed; only changes that violate their format
 * contract within a comms-format changeset are blocked here.
 *
 * Schema-snapshot tests (separate describe blocks) pin the CURRENT shapes as
 * representative fixtures so any drift breaks CI deterministically.
 *
 * Owner: tooling-engineer.
 * Discipline: TDD — tests written before implementation (guild:tdd).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── Import will fail until the implementation exists — RED phase ──────────
import {
  checkAccidentalWrite,
  AccidentalWriteViolation,
  ProtectedSurface,
  SETTINGS_JSON_REQUIRED_KEYS,
  WORKSPACE_JSON_REQUIRED_KEYS,
  PROVENANCE_JSON_REQUIRED_KEYS,
  TRACE_JSONL_REQUIRED_KEYS,
  DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS,
} from "../no-accidental-write";

// ── Fixtures ───────────────────────────────────────────────────────────────

/**
 * Canonical representative shape of .guild/settings.json.
 * Keys must be a subset of SETTINGS_JSON_REQUIRED_KEYS.
 * Source: live .guild/settings.json at workspace root (2026-06-03).
 */
const SETTINGS_FIXTURE: Record<string, unknown> = {
  rigor: "deep",
  auto_approve: ["all"],
  review: "local",
  host: "auto",
  index: "auto",
  record_status_runs: true,
  agent_mode: "team",
  workspace: { mode: "auto" },
  loops: "all",
  loop_cap: 16,
  codex_cap: 5,
  defaults: {},
};

/**
 * Canonical representative shape of .guild/workspace.json.
 * Source: live .guild/workspace.json at workspace root (2026-06-03).
 */
const WORKSPACE_FIXTURE: Record<string, unknown> = {
  schema_version: "guild.workspace.v1",
  is_workspace: true,
  detected_at: "2026-05-27T10:23:53.623Z",
  detection: { depth: 1, rule: "immediate child has .git/ OR .guild/", mode: "auto" },
  sub_guilds: [],
};

/**
 * Canonical representative shape of .guild/runs/<id>/provenance.json.
 * Source: live provenance.json (2026-06-03).
 */
const PROVENANCE_FIXTURE: Record<string, unknown> = {
  schema_version: "guild.provenance.v1",
  run_id: "run-abc123",
  command: "/guild:build",
  initiative: null,
  retention_class: "one-off-90d",
  started_at: "2026-06-03T00:00:00Z",
  closed_at: "2026-06-03T01:00:00Z",
  status: "closed",
  run_class: "full",
  terminal_trace_event: null,
  final_learning_checkpoint: null,
  gates: {},
  touched: { tasks: [], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] },
  artifacts: {},
  benchmark_eligible: true,
};

/**
 * Canonical representative shape of a trace JSONL line.
 * Source: live events.ndjson (2026-06-03).
 */
const TRACE_LINE_FIXTURE: Record<string, unknown> = {
  ts: "2026-06-03T00:00:00.000Z",
  event: "PostToolUse",
  tool: "Bash",
  specialist: "",
  payload_digest: "abc123def456",
  ok: true,
  ms: 100,
};

/**
 * Canonical representative key-set of docs/knowledge frontmatter.
 * Source: communication-format-policy.md frontmatter (2026-06-03).
 */
const DOCS_FRONTMATTER_FIXTURE: Record<string, unknown> = {
  type: "decision",
  owner: "architect",
  confidence: "high",
  importance: "high",
  applies_to: ["plugin"],
  source_refs: [],
  related: [],
  provenance_ref: "some/path",
  created_at: "2026-06-03",
  updated_at: "2026-06-03",
  expires_at: null,
  supersedes: null,
  sensitivity: "public",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "no-acc-write-"));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

function writeJson(dir: string, relPath: string, obj: unknown): string {
  return writeFile(dir, relPath, JSON.stringify(obj, null, 2));
}

function makeSettingsPath(base: string, obj: unknown = SETTINGS_FIXTURE): string {
  return writeJson(base, ".guild/settings.json", obj);
}

function makeWorkspacePath(base: string, obj: unknown = WORKSPACE_FIXTURE): string {
  return writeJson(base, ".guild/workspace.json", obj);
}

function makeProvenancePath(base: string, runId = "run-abc123", obj: unknown = PROVENANCE_FIXTURE): string {
  return writeJson(base, `.guild/runs/${runId}/provenance.json`, obj);
}

function makeTraceJsonlPath(base: string, lines: string[] = []): string {
  const defaultLine = JSON.stringify(TRACE_LINE_FIXTURE);
  const content = (lines.length ? lines : [defaultLine]).join("\n") + "\n";
  // A REAL runtime trace surface lives under .guild/runs/<id>/ — the guard scopes
  // its trace check to that path (not arbitrary .jsonl elsewhere).
  return writeFile(base, ".guild/runs/run-test/logs/events.ndjson", content);
}

function makeDocsFrontmatterPath(base: string, fm: Record<string, unknown> = DOCS_FRONTMATTER_FIXTURE): string {
  const fmStr = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  const content = `---\n${fmStr}\n---\n\n# Some doc\n`;
  return writeFile(base, "docs/knowledge/decisions/some-decision.md", content);
}

// ── checkAccidentalWrite core behaviour ───────────────────────────────────

describe("checkAccidentalWrite — protected surface violations", () => {
  // ── settings.json ────────────────────────────────────────────────────────

  describe("settings.json", () => {
    it("PASS: settings.json in diff range that is STILL valid JSON with all required keys", () => {
      const base = tmpDir();
      const p = makeSettingsPath(base);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("FAIL: settings.json in diff is NOT valid JSON (converted to YAML)", () => {
      const base = tmpDir();
      // Simulate an accidental YAML-ification of settings.json
      const yamlContent = "rigor: deep\nauto_approve:\n  - all\nreview: local\n";
      const p = writeFile(base, ".guild/settings.json", yamlContent);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("settings.json" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/JSON/i);
    });

    it("FAIL: settings.json in diff has unknown top-level key(s) (schema restructured)", () => {
      const base = tmpDir();
      // settings.json with foreign keys not in the known schema — a restructure signal.
      // (Keys are all OPTIONAL, so a minimal valid config passes; an UNKNOWN key fails.)
      const restructured = { rigor: "deep", completely_new_key: "something", another_unknown: 42 };
      const p = makeSettingsPath(base, restructured);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("settings.json" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/unknown top-level key/i);
    });

    it("PASS: settings.json NOT in diff range — not checked even if file exists on disk", () => {
      const base = tmpDir();
      makeSettingsPath(base);
      // Pass an unrelated file in diff range
      const other = writeFile(base, "scripts/comms/comms-format-lint.ts", "// some lint code\n");
      const result = checkAccidentalWrite({ paths: [other] });
      expect(result.violations).toHaveLength(0);
    });

    it("PASS: settings.json with subset of required keys (partial valid config)", () => {
      const base = tmpDir();
      // A settings.json with only SOME required keys is fine — it's not missing all of them
      const partial = { rigor: "quick", agent_mode: "auto", review: "local" };
      const p = makeSettingsPath(base, partial);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── workspace.json ───────────────────────────────────────────────────────

  describe("workspace.json", () => {
    it("PASS: workspace.json in diff range, still valid JSON with schema_version", () => {
      const base = tmpDir();
      const p = makeWorkspacePath(base);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("FAIL: workspace.json in diff is NOT valid JSON", () => {
      const base = tmpDir();
      const p = writeFile(base, ".guild/workspace.json", "schema_version: guild.workspace.v1\n");
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("workspace.json" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/JSON/i);
    });

    it("FAIL: workspace.json in diff is missing schema_version (format drift)", () => {
      const base = tmpDir();
      const p = makeWorkspacePath(base, { is_workspace: true, sub_guilds: [] }); // no schema_version
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("workspace.json" as ProtectedSurface);
    });

    it("PASS: workspace.json NOT in diff — not checked", () => {
      const base = tmpDir();
      makeWorkspacePath(base);
      const other = writeFile(base, "skills/meta/review/SKILL.md", "# Review\n");
      const result = checkAccidentalWrite({ paths: [other] });
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── provenance.json ──────────────────────────────────────────────────────

  describe("provenance.json", () => {
    it("PASS: provenance.json in diff with valid shape", () => {
      const base = tmpDir();
      const p = makeProvenancePath(base);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("FAIL: provenance.json in diff is NOT valid JSON", () => {
      const base = tmpDir();
      const p = writeFile(base, ".guild/runs/run-abc/provenance.json", "schema_version: guild.provenance.v1\n");
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("provenance.json" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/JSON/i);
    });

    it("FAIL: provenance.json in diff missing schema_version key", () => {
      const base = tmpDir();
      const stripped = { ...PROVENANCE_FIXTURE } as Record<string, unknown>;
      delete stripped.schema_version;
      const p = makeProvenancePath(base, "run-abc", stripped);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("provenance.json" as ProtectedSurface);
    });

    it("FAIL: provenance.json schema_version changed to unknown value", () => {
      const base = tmpDir();
      const p = makeProvenancePath(base, "run-abc", {
        ...PROVENANCE_FIXTURE,
        schema_version: "guild.provenance.v99", // wrong version
      });
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].message).toMatch(/schema_version/i);
    });

    it("PASS: provenance.json NOT in diff path — not checked", () => {
      const base = tmpDir();
      makeProvenancePath(base);
      const other = writeFile(base, "scripts/comms/no-accidental-write.ts", "// guard\n");
      const result = checkAccidentalWrite({ paths: [other] });
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── trace JSONL ──────────────────────────────────────────────────────────

  describe("trace JSONL (.jsonl / events.ndjson)", () => {
    it("PASS: JSONL file in diff with all lines valid JSON objects with required keys", () => {
      const base = tmpDir();
      const p = makeTraceJsonlPath(base);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("FAIL: JSONL file in diff has a line that is NOT valid JSON", () => {
      const base = tmpDir();
      const p = makeTraceJsonlPath(base, [
        JSON.stringify(TRACE_LINE_FIXTURE),
        "this is not json at all",
        JSON.stringify(TRACE_LINE_FIXTURE),
      ]);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("trace.jsonl" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/line/i);
    });

    it("FAIL: JSONL file in diff has a line missing required 'ts' field", () => {
      const base = tmpDir();
      const lineNoTs = { event: "PostToolUse", tool: "Bash", ok: true };
      const p = makeTraceJsonlPath(base, [JSON.stringify(lineNoTs)]);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("trace.jsonl" as ProtectedSurface);
    });

    it("FAIL: JSONL file in diff has a line missing required 'event' field", () => {
      const base = tmpDir();
      const lineNoEvent = { ts: "2026-06-03T00:00:00.000Z", tool: "Bash", ok: true };
      const p = makeTraceJsonlPath(base, [JSON.stringify(lineNoEvent)]);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("PASS: JSONL file not in diff — not checked", () => {
      const base = tmpDir();
      makeTraceJsonlPath(base);
      const other = writeFile(base, "scripts/comms/comms-format-lint.cli.ts", "// cli\n");
      const result = checkAccidentalWrite({ paths: [other] });
      expect(result.violations).toHaveLength(0);
    });

    it("PASS: empty JSONL file (no lines) — no violation (empty is valid)", () => {
      const base = tmpDir();
      const p = writeFile(base, "logs/empty.jsonl", "");
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("PASS: JSONL file with blank/empty lines between JSON objects (tolerant)", () => {
      const base = tmpDir();
      const p = makeTraceJsonlPath(base, [
        JSON.stringify(TRACE_LINE_FIXTURE),
        "",
        JSON.stringify(TRACE_LINE_FIXTURE),
      ]);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });
  });

  // ── docs/knowledge frontmatter conventions ───────────────────────────────

  describe("docs/knowledge frontmatter conventions", () => {
    it("PASS: docs/knowledge .md in diff with all required frontmatter keys present", () => {
      const base = tmpDir();
      const p = makeDocsFrontmatterPath(base);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations).toHaveLength(0);
    });

    it("FAIL: docs/knowledge .md in diff with frontmatter YAML replaced by JSON object", () => {
      const base = tmpDir();
      // Simulate someone replacing YAML frontmatter with JSON-object frontmatter
      const p = writeFile(
        base,
        "docs/knowledge/decisions/some-doc.md",
        '{"type":"decision","owner":"architect"}\n\n# Some doc\n'
      );
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("docs/knowledge frontmatter" as ProtectedSurface);
    });

    it("FAIL: docs/knowledge .md in diff missing required frontmatter key 'type'", () => {
      const base = tmpDir();
      const fmNoType: Record<string, unknown> = { ...DOCS_FRONTMATTER_FIXTURE };
      delete fmNoType.type;
      const p = makeDocsFrontmatterPath(base, fmNoType);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].surface).toBe("docs/knowledge frontmatter" as ProtectedSurface);
      expect(result.violations[0].message).toMatch(/missing required/i);
    });

    it("FAIL: docs/knowledge .md in diff missing required frontmatter key 'created_at'", () => {
      const base = tmpDir();
      const fmNoCreated: Record<string, unknown> = { ...DOCS_FRONTMATTER_FIXTURE };
      delete fmNoCreated.created_at;
      const p = makeDocsFrontmatterPath(base, fmNoCreated);
      const result = checkAccidentalWrite({ paths: [p] });
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it("PASS: docs/knowledge .md NOT in diff — not checked", () => {
      const base = tmpDir();
      makeDocsFrontmatterPath(base);
      const other = writeFile(base, ".github/workflows/comms-format.yml", "# ci\n");
      const result = checkAccidentalWrite({ paths: [other] });
      expect(result.violations).toHaveLength(0);
    });

    it("PASS: .md outside docs/knowledge — not subject to frontmatter convention check", () => {
      const base = tmpDir();
      // A handoff receipt under .guild/runs/ has frontmatter but is not docs/knowledge
      const p = writeFile(
        base,
        ".guild/runs/run-abc/handoffs/receipt.md",
        "---\ntype: handoff_receipt\n---\n\n# Receipt\n"
      );
      const result = checkAccidentalWrite({ paths: [p] });
      // Should NOT fire docs/knowledge frontmatter violation (it is not under docs/knowledge)
      const docsViolations = result.violations.filter(
        (v) => v.surface === "docs/knowledge frontmatter"
      );
      expect(docsViolations).toHaveLength(0);
    });
  });
});

// ── Normal comms-format changeset — should PASS (no violations) ───────────

describe("checkAccidentalWrite — normal comms-format changes PASS", () => {
  it("PASS: lint script change (scripts/comms/comms-format-lint.ts)", () => {
    const base = tmpDir();
    const p = writeFile(base, "scripts/comms/comms-format-lint.ts", "// updated lint logic\n");
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.violations).toHaveLength(0);
  });

  it("PASS: CI workflow change (plugin/.github/workflows/comms-format.yml)", () => {
    const base = tmpDir();
    const p = writeFile(base, ".github/workflows/comms-format.yml", "name: comms-format\n");
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.violations).toHaveLength(0);
  });

  it("PASS: handoff receipt document change (under handoffs/)", () => {
    const base = tmpDir();
    // A valid handoff receipt is NOT a protected surface (only its machine envelope format matters
    // to comms-format-lint.ts — that's check (a)); the no-accidental-write guard doesn't gate it
    const p = writeFile(
      base,
      ".guild/runs/run-xyz/handoffs/u3-receipt.md",
      "---\ntype: handoff_receipt\n---\n# done\n"
    );
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.violations).toHaveLength(0);
  });

  it("PASS: skill body change", () => {
    const base = tmpDir();
    const p = writeFile(base, "skills/meta/review/SKILL.md", "# Review skill\n");
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.violations).toHaveLength(0);
  });

  it("PASS: no paths given — nothing to check", () => {
    const result = checkAccidentalWrite({ paths: [] });
    expect(result.violations).toHaveLength(0);
  });

  it("PASS: multiple unrelated changed paths — all clean", () => {
    const base = tmpDir();
    const paths = [
      writeFile(base, "scripts/comms/no-accidental-write.ts", "// guard\n"),
      writeFile(base, ".github/workflows/comms-negative.yml", "# ci\n"),
      writeFile(base, "docs/knowledge/decisions/communication-format-policy.md",
        // valid frontmatter with ALL required keys
        `---\ntype: decision\nowner: architect\nconfidence: high\nimportance: high\napplies_to: []\nsource_refs: []\nrelated: []\nprovenance_ref: some/path\ncreated_at: 2026-06-03\nupdated_at: 2026-06-03\nexpires_at: null\nsupersedes: null\nsensitivity: public\n---\n\n# Policy\n`
      ),
    ];
    const result = checkAccidentalWrite({ paths });
    expect(result.violations).toHaveLength(0);
  });
});

// ── Multiple violations reported ──────────────────────────────────────────

describe("checkAccidentalWrite — multiple violations in one call", () => {
  it("reports violations for each protected surface that is breached in one diff", () => {
    const base = tmpDir();
    const paths = [
      // settings.json broken: YAML not JSON
      writeFile(base, ".guild/settings.json", "rigor: deep\n"),
      // workspace.json broken: not JSON
      writeFile(base, ".guild/workspace.json", "schema_version: guild.workspace.v1\n"),
      // unrelated clean file
      writeFile(base, "scripts/comms/comms-format-lint.ts", "// ok\n"),
    ];
    const result = checkAccidentalWrite({ paths });
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const surfaces = result.violations.map((v) => v.surface);
    expect(surfaces).toContain("settings.json" as ProtectedSurface);
    expect(surfaces).toContain("workspace.json" as ProtectedSurface);
  });
});

// ── U7 G-lane precision fixes ─────────────────────────────────────────────

describe("checkAccidentalWrite — precision fixes (G-lane round 1)", () => {
  it("PASS: minimal valid settings.json (one optional key) — keys are all optional", () => {
    const base = tmpDir();
    const p = makeSettingsPath(base, { rigor: "deep" });
    expect(checkAccidentalWrite({ paths: [p] }).violations).toHaveLength(0);
  });

  it("FAIL: settings.json with an UNKNOWN top-level key (restructure)", () => {
    const base = tmpDir();
    const p = makeSettingsPath(base, { rigor: "deep", totallyForeign: 1 });
    const v = checkAccidentalWrite({ paths: [p] }).violations;
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toMatch(/unknown top-level key/i);
  });

  it("PASS: settings.json with an _help annotation key (underscore-prefixed allowed)", () => {
    const base = tmpDir();
    const p = makeSettingsPath(base, { rigor: "deep", _help: "annotations ok" });
    expect(checkAccidentalWrite({ paths: [p] }).violations).toHaveLength(0);
  });

  it("FAIL: docs/knowledge page with UNCLOSED frontmatter", () => {
    const base = tmpDir();
    const p = writeFile(base, "docs/knowledge/x.md", "---\ntype: decision\n# never closed\n");
    const v = checkAccidentalWrite({ paths: [p] }).violations;
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toMatch(/unclosed/i);
  });

  it("FAIL: docs/knowledge page with EMPTY frontmatter block", () => {
    const base = tmpDir();
    const p = writeFile(base, "docs/knowledge/y.md", "---\n---\n# body\n");
    const v = checkAccidentalWrite({ paths: [p] }).violations;
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].message).toMatch(/empty/i);
  });

  it("FAIL: real runtime trace under .guild/runs/<id>/ missing required fields", () => {
    const base = tmpDir();
    const p = writeFile(base, ".guild/runs/run-1/logs/v1.4-events.jsonl", '{"foo":1}\n');
    const v = checkAccidentalWrite({ paths: [p] }).violations;
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].surface).toBe("trace.jsonl" as ProtectedSurface);
  });

  it("PASS: a .jsonl NOT under .guild/runs/ is not a protected trace surface", () => {
    const base = tmpDir();
    const p = writeFile(base, "scripts/data/random.jsonl", '{"foo":1}\n');
    expect(checkAccidentalWrite({ paths: [p] }).violations).toHaveLength(0);
  });

  it("PASS: a fixture/legacy-example trace file is EXEMPT (benign fixture edit)", () => {
    const base = tmpDir();
    const p = writeFile(base, "tests/fixtures/policy-repo/.guild/runs/run-x/events.ndjson", '{"foo":1}\n');
    expect(checkAccidentalWrite({ paths: [p] }).violations).toHaveLength(0);
  });
});

// ── Schema-snapshot tests — pin current shapes ────────────────────────────

describe("Schema snapshots — required keys pin the current shapes", () => {
  // EXACT sorted key-set snapshots — any drift (add/remove a pinned key) FAILS,
  // so the schema can only change deliberately (by editing both the constant and
  // this snapshot together). Pinned from the live shapes (2026-06-03).
  const sorted = (xs: readonly string[]) => [...xs].sort();

  it("SETTINGS_JSON_REQUIRED_KEYS pins the EXACT key set", () => {
    expect(sorted(SETTINGS_JSON_REQUIRED_KEYS)).toEqual(
      ["agent_mode", "auto_approve", "defaults", "host", "review", "rigor"]
    );
  });

  it("WORKSPACE_JSON_REQUIRED_KEYS pins the EXACT key set", () => {
    expect(sorted(WORKSPACE_JSON_REQUIRED_KEYS)).toEqual(["schema_version"]);
  });

  it("PROVENANCE_JSON_REQUIRED_KEYS pins the EXACT key set", () => {
    expect(sorted(PROVENANCE_JSON_REQUIRED_KEYS)).toEqual(["run_id", "schema_version"]);
  });

  it("TRACE_JSONL_REQUIRED_KEYS pins the EXACT key set", () => {
    expect(sorted(TRACE_JSONL_REQUIRED_KEYS)).toEqual(["event", "ts"]);
  });

  it("DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS pins the EXACT key set", () => {
    expect(sorted(DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS)).toEqual(
      ["created_at", "owner", "sensitivity", "type", "updated_at"]
    );
  });

  it("SETTINGS_FIXTURE satisfies SETTINGS_JSON_REQUIRED_KEYS — fixture is representative", () => {
    for (const key of SETTINGS_JSON_REQUIRED_KEYS) {
      expect(Object.keys(SETTINGS_FIXTURE)).toContain(key);
    }
  });

  it("WORKSPACE_FIXTURE satisfies WORKSPACE_JSON_REQUIRED_KEYS — fixture is representative", () => {
    for (const key of WORKSPACE_JSON_REQUIRED_KEYS) {
      expect(Object.keys(WORKSPACE_FIXTURE)).toContain(key);
    }
  });

  it("PROVENANCE_FIXTURE satisfies PROVENANCE_JSON_REQUIRED_KEYS — fixture is representative", () => {
    for (const key of PROVENANCE_JSON_REQUIRED_KEYS) {
      expect(Object.keys(PROVENANCE_FIXTURE)).toContain(key);
    }
  });

  it("TRACE_LINE_FIXTURE satisfies TRACE_JSONL_REQUIRED_KEYS — fixture is representative", () => {
    for (const key of TRACE_JSONL_REQUIRED_KEYS) {
      expect(Object.keys(TRACE_LINE_FIXTURE)).toContain(key);
    }
  });

  it("DOCS_FRONTMATTER_FIXTURE satisfies DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS — fixture representative", () => {
    for (const key of DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS) {
      expect(Object.keys(DOCS_FRONTMATTER_FIXTURE)).toContain(key);
    }
  });

  it("settings.json provenance.json workspace.json schema_version values are stable strings", () => {
    // These are the exact version strings; if changed, the snapshot fails CI.
    expect((WORKSPACE_FIXTURE as Record<string, unknown>).schema_version).toBe("guild.workspace.v1");
    expect((PROVENANCE_FIXTURE as Record<string, unknown>).schema_version).toBe("guild.provenance.v1");
  });
});

// ── Accidental-write concrete demo — AC-6 exit criterion ─────────────────

describe("AC-6 concrete demo — accidental write to protected surface FAILS", () => {
  it("settings.json converted to YAML by accident => violation with non-zero exit signal", () => {
    const base = tmpDir();
    const p = writeFile(base, ".guild/settings.json", "rigor: deep\nauto_approve:\n  - all\n");
    const result = checkAccidentalWrite({ paths: [p] });
    // AC-6: must produce at least one violation (exit non-zero in CLI)
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.hasViolations).toBe(true);
  });

  it("workspace.json schema_version removed => violation", () => {
    const base = tmpDir();
    const p = makeWorkspacePath(base, { is_workspace: true, sub_guilds: [] });
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.hasViolations).toBe(true);
  });

  it("provenance.json schema_version set to unknown value => violation", () => {
    const base = tmpDir();
    const p = makeProvenancePath(base, "run-x", { ...PROVENANCE_FIXTURE, schema_version: "unknown.v0" });
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.hasViolations).toBe(true);
  });

  it("trace JSONL has a non-JSON line => violation", () => {
    const base = tmpDir();
    const p = makeTraceJsonlPath(base, ["not json"]);
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.hasViolations).toBe(true);
  });

  it("docs/knowledge .md has frontmatter missing 'type' => violation", () => {
    const base = tmpDir();
    const fm: Record<string, unknown> = { ...DOCS_FRONTMATTER_FIXTURE };
    delete fm.type;
    const p = makeDocsFrontmatterPath(base, fm);
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.hasViolations).toBe(true);
  });

  it("normal comms-format lint script change => NO violation (PASS)", () => {
    const base = tmpDir();
    const p = writeFile(base, "scripts/comms/comms-format-lint.ts", "// lint update\n");
    const result = checkAccidentalWrite({ paths: [p] });
    expect(result.hasViolations).toBe(false);
  });
});
