/**
 * scripts/comms/__tests__/comms-format-lint.test.ts
 *
 * TDD suite for comms-format-lint.ts (U5a — warn-mode lint core).
 *
 * Policy refs:
 *   docs/knowledge/decisions/communication-format-policy.md
 *   .guild/initiatives/active/communication-format-standardization/definition-ledger.md
 *   .guild/initiatives/active/communication-format-standardization/yaml-reader-inventory.json
 *
 * OD-4 discriminator:
 *   A file/receipt is in-scope iff its path appears in the diffRange OR it is a
 *   runtime receipt under .guild/runs/<id>/ for a run whose run.yaml.started_at
 *   is >= 2026-06-03 (policy_effective_date).
 *
 * Checks:
 *   (a) Ambiguous receipt — no/duplicate/invalid guild.handoff.v2 block.
 *   (b) New hand-rolled YAML reader — NOT in U4 allow-list.
 *   (c) New communication artifact doesn't declare its category.
 *
 * U5a discipline: WARN mode only. lintCommsFormat() must ALWAYS exit 0
 * (non-blocking). enforce flag default false; exists for U5b.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintCommsFormat, CommsLintFinding } from "../comms-format-lint";

// ── Helpers ────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "comms-lint-test-"));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  return full;
}

/** Minimal valid guild.handoff.v2 JSON block content. */
const VALID_V2_BLOCK = JSON.stringify({
  schema_version: "guild.handoff.v2",
  task_id: "T-1",
  tier: "mid",
  status: "done",
  summary: "All done.",
  artifacts: [],
  issues: [],
});

function receiptWith(blockContent: string): string {
  return `---
type: handoff_receipt
task_id: T-1
---

# Handoff

Some prose.

\`\`\`guild.handoff.v2
${blockContent}
\`\`\`
`;
}

function receiptNoBlock(): string {
  return `---
type: handoff_receipt
task_id: T-1
---

# Handoff

Frontmatter only, no machine envelope.
`;
}

function receiptTwoBlocks(): string {
  return `---
type: handoff_receipt
task_id: T-1
---

\`\`\`guild.handoff.v2
${VALID_V2_BLOCK}
\`\`\`

\`\`\`guild.handoff.v2
${VALID_V2_BLOCK}
\`\`\`
`;
}

function receiptInvalidShape(): string {
  const bad = JSON.stringify({ schema_version: "guild.handoff.v2", task_id: "", summary: "" });
  return receiptWith(bad);
}

/** Build a run directory with a run.yaml that has the given started_at. */
function buildRunDir(
  base: string,
  runId: string,
  startedAt: string,
  receiptContent: string
): { runDir: string; receiptPath: string } {
  const runDir = path.join(base, ".guild", "runs", runId);
  fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    `schema_version: guild.run.v1\nrun_id: ${runId}\nstarted_at: ${startedAt}\n`,
    "utf8"
  );
  const receiptPath = path.join(runDir, "handoffs", "receipt.md");
  fs.writeFileSync(receiptPath, receiptContent, "utf8");
  return { runDir, receiptPath };
}

// ─── Check (a): ambiguous receipts ────────────────────────────────────────

describe("check (a) — ambiguous receipt", () => {
  describe("in-scope via diffRange (path match)", () => {
    it("warns: receipt in diffRange with NO guild.handoff.v2 block", () => {
      const base = tmpDir();
      const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
      const findings = lintCommsFormat({ paths: [receiptPath] });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0].severity).toBe("warn");
      expect(warns[0].file).toBe(receiptPath);
    });

    it("warns: receipt in diffRange with DUPLICATE guild.handoff.v2 blocks", () => {
      const base = tmpDir();
      const receiptPath = writeFile(base, "handoffs/receipt.md", receiptTwoBlocks());
      const findings = lintCommsFormat({ paths: [receiptPath] });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBeGreaterThan(0);
      expect(warns[0].severity).toBe("warn");
    });

    it("warns: receipt in diffRange with INVALID v2 shape", () => {
      const base = tmpDir();
      const receiptPath = writeFile(base, "handoffs/receipt.md", receiptInvalidShape());
      const findings = lintCommsFormat({ paths: [receiptPath] });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBeGreaterThan(0);
    });

    it("does NOT warn: receipt in diffRange with valid single v2 block", () => {
      const base = tmpDir();
      const receiptPath = writeFile(base, "handoffs/receipt.md", receiptWith(VALID_V2_BLOCK));
      const findings = lintCommsFormat({ paths: [receiptPath] });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBe(0);
    });
  });

  describe("in-scope via runsDir (runtime receipts)", () => {
    it("warns: post-effective-date run with NO v2 block", () => {
      const base = tmpDir();
      const { runDir } = buildRunDir(
        base,
        "run-post",
        "2026-06-03T10:00:00Z",
        receiptNoBlock()
      );
      const findings = lintCommsFormat({ runsDir: path.join(base, ".guild", "runs") });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBeGreaterThan(0);
    });

    it("does NOT warn: pre-effective-date run (grandfathered)", () => {
      const base = tmpDir();
      buildRunDir(base, "run-old", "2026-06-02T23:59:59Z", receiptNoBlock());
      const findings = lintCommsFormat({ runsDir: path.join(base, ".guild", "runs") });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBe(0);
    });

    it("does NOT warn: indeterminate run date (fail-open)", () => {
      const base = tmpDir();
      // run.yaml exists but has no started_at
      const runDir = path.join(base, ".guild", "runs", "run-nodate");
      fs.mkdirSync(path.join(runDir, "handoffs"), { recursive: true });
      fs.writeFileSync(path.join(runDir, "run.yaml"), "schema_version: guild.run.v1\n", "utf8");
      fs.writeFileSync(
        path.join(runDir, "handoffs", "receipt.md"),
        receiptNoBlock(),
        "utf8"
      );
      const findings = lintCommsFormat({ runsDir: path.join(base, ".guild", "runs") });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBe(0);
    });
  });

  describe("OD-4 grandfathering — NOT in diffRange, no runsDir", () => {
    it("does NOT warn on a receipt not in any in-scope set", () => {
      // A receipt file exists on disk but was NOT passed in paths[] and is not
      // under the runsDir — it is an existing committed fixture.
      const base = tmpDir();
      writeFile(base, "old/receipt.md", receiptNoBlock());
      // No paths, no runsDir → nothing is in scope
      const findings = lintCommsFormat({});
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBe(0);
    });
  });

  describe("fixture/legacy-example exemption", () => {
    it("does NOT warn for a file classified as legacy-example", () => {
      const base = tmpDir();
      // The exemption is conveyed via the path itself containing "legacy-example"
      // OR via a frontmatter `classifier: legacy-example` field.
      const receiptPath = writeFile(
        base,
        "fixtures/legacy-example/receipt.md",
        receiptNoBlock()
      );
      const findings = lintCommsFormat({ paths: [receiptPath] });
      const warns = findings.filter((f) => f.check === "a");
      expect(warns.length).toBe(0);
    });
  });
});

// ─── Check (b): new hand-rolled YAML readers ──────────────────────────────

describe("check (b) — new hand-rolled YAML reader", () => {
  it("warns: new source file with hand-rolled --- frontmatter split NOT in inventory", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/new-reader.ts",
      `
function parseFm(raw: string) {
  // hand-rolled YAML reader
  const parts = raw.split('---');
  const fm = parts[1];
  return fm.split('\\n').reduce((acc, line) => {
    const [k, v] = line.split(':');
    if (k) acc[k.trim()] = v?.trim();
    return acc;
  }, {} as Record<string, string>);
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0].severity).toBe("warn");
    expect(warns[0].message).toMatch(/hand-rolled.*YAML|OD-3/i);
  });

  it("warns: new source file with /^key:\\s*/ regex YAML extraction NOT in inventory", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/another-reader.ts",
      `
// hand-rolled reader over run.yaml / .md frontmatter
function readField(raw: string, key: string) {
  const m = raw.match(new RegExp('^' + key + ':\\\\s*(.*)$', 'm'));
  return m ? m[1].trim() : null;
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("does NOT warn: inventoried reader file (grandfathered)", () => {
    // plugin/scripts/analyze-runs.ts is in the U4 inventory (reader id 7)
    // Even if passed in paths[], it is in the allow-list and must not be flagged.
    const findings = lintCommsFormat({
      paths: [
        "/Users/miguelp/Projects/guild/plugin/scripts/analyze-runs.ts",
      ],
    });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: source file that uses js-yaml (shared parser)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/good-reader.ts",
      `
import * as yaml from 'js-yaml';

function parse(raw: string) {
  return yaml.load(raw);
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: fixture/legacy-example source file even if it hand-rolls YAML", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "fixtures/legacy-example/old-reader.ts",
      `const m = raw.match(/^key:\\s*(.*)$/m);`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });
});

// ─── Check (c): undeclared artifact category ──────────────────────────────

describe("check (c) — undeclared communication artifact category", () => {
  it("warns: new .md file with no category declaration in frontmatter", () => {
    const base = tmpDir();
    const filePath = writeFile(
      base,
      "artifacts/new-receipt.md",
      `---
type: handoff_receipt
task_id: T-new
---

Some content without a category field.
`
    );
    const findings = lintCommsFormat({ paths: [filePath] });
    const warns = findings.filter((f) => f.check === "c");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0].severity).toBe("warn");
    expect(warns[0].message).toMatch(/category/i);
  });

  it("does NOT warn: new .md file that declares category in frontmatter", () => {
    const base = tmpDir();
    const filePath = writeFile(
      base,
      "artifacts/new-receipt.md",
      `---
type: handoff_receipt
task_id: T-new
artifact_category: 7
---

Content with a declared category.
`
    );
    const findings = lintCommsFormat({ paths: [filePath] });
    const warns = findings.filter((f) => f.check === "c");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: .json file (category 4/machine state; not a doc artifact)", () => {
    const base = tmpDir();
    const filePath = writeFile(base, "state/run-state.json", `{"key": "value"}`);
    const findings = lintCommsFormat({ paths: [filePath] });
    const warns = findings.filter((f) => f.check === "c");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: fixture/legacy-example file", () => {
    const base = tmpDir();
    const filePath = writeFile(
      base,
      "fixtures/legacy-example/old.md",
      `---\ntype: handoff_receipt\n---\nno category\n`
    );
    const findings = lintCommsFormat({ paths: [filePath] });
    const warns = findings.filter((f) => f.check === "c");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: non-communication .md file (README, docs, plan)", () => {
    const base = tmpDir();
    // A README-style .md is NOT a communication artifact; check (c) should only
    // fire on communication artifact types (handoff, run manifest, etc.).
    const filePath = writeFile(
      base,
      "docs/README.md",
      `# My project\n\nSome documentation without frontmatter.\n`
    );
    const findings = lintCommsFormat({ paths: [filePath] });
    const warns = findings.filter((f) => f.check === "c");
    expect(warns.length).toBe(0);
  });
});

// ─── MAJOR-1: full validator parity with hooks/lib/handoff-v2.ts ──────────
// These cases passed the OLD partial validator (isValidHandoffV2) but MUST warn
// under the full parity mirror (envelopeShapeErrors from reaping.ts pattern).

describe("check (a) — full validator parity (MAJOR-1)", () => {
  function receiptWithBlock(obj: Record<string, unknown>): string {
    return receiptWith(JSON.stringify(obj));
  }

  it("warns: unknown top-level key in v2 block", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: [],
        issues: [],
        extra_key: "should be rejected",  // unknown key
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: non-string element in artifacts array", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: [42],  // non-string element
        issues: [],
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: non-string element in issues array", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: [],
        issues: [{ nested: "object" }],  // non-string element
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: learnings present but not an array", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: [],
        issues: [],
        learnings: "should be an array",  // wrong type
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: notes present but wrong type (not string)", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: [],
        issues: [],
        notes: 123,  // should be string
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: status=escalate but no escalate_reason", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "escalate",
        summary: "needs escalation",
        artifacts: [],
        issues: [],
        // escalate_reason missing
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("does NOT warn: valid block with learnings array and notes string", () => {
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "handoffs/receipt.md",
      receiptWithBlock({
        schema_version: "guild.handoff.v2",
        task_id: "T-1",
        tier: "mid",
        status: "done",
        summary: "ok",
        artifacts: ["file.ts:1-10"],
        issues: [],
        learnings: ["learned something"],
        notes: "short note",
      })
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    const warns = findings.filter((f) => f.check === "a");
    expect(warns.length).toBe(0);
  });
});

// ─── MAJOR-2: OD-3 self-compliance — lint must not warn on itself ──────────

describe("check (b) — OD-3 self-compliance (MAJOR-2)", () => {
  it("lint does NOT warn on its own source file (comms-format-lint.ts)", () => {
    // comms-format-lint.ts uses js-yaml for frontmatter parsing (check-c) and
    // must not contain patterns that trip its own check-(b) detector.
    // If this fails, the lint is violating OD-3 on itself.
    const lintSrcPath = require("path").resolve(__dirname, "../comms-format-lint.ts");
    const findings = lintCommsFormat({ paths: [lintSrcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });
});

// ─── MAJOR-3 (strengthened): bypass resistance + pattern coverage ─────────
//
// Each fixture is ISOLATED to a single idiom so tests cannot pass for the
// wrong reason (a split('---') masking a missing key-extractor match).

describe("check (b) — bypass resistance (MAJOR-3 strengthened)", () => {
  // ── Bypass: js-yaml import does NOT exempt ──────────────────────────────

  it("warns: file with ONLY split('---') + js-yaml import (not exempted)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/sneaky-split.ts",
      // Only split('---'), no key regex. js-yaml import must NOT exempt.
      [
        "import * as yaml from 'js-yaml';",
        "function splitFm(raw: string) {",
        "  return raw.split('---')[1] || '';",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    expect(findings.filter((f) => f.check === "b").length).toBeGreaterThan(0);
  });

  it("warns: file with ONLY dynamic key-extractor + js-yaml import (not exempted)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/sneaky-dynamic.ts",
      // ONLY the dynamic new RegExp('^'+key+...) idiom — no split, no startsWith.
      // This is exactly what inventory readers #13, #14, #20 do.
      // js-yaml import must NOT exempt it.
      [
        "import * as yaml from 'js-yaml';",
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function readField(raw: string, key: string): string | null {",
        "  const m = raw.match(new RegExp('^' + key + ':\\\\s*(.*)$', 'm'));",
        "  return m ? m[1].trim() : null;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: file with ONLY literal line-anchored key regex (no split, no startsWith)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/literal-key-reader.ts",
      // ONLY the literal /^status:\s*/ form — isolated, no other idiom.
      [
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function readStatus(raw: string): string | null {",
        "  const m = raw.match(/^status:\\s*(.*)$/m);",
        "  return m ? m[1].trim() : null;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: file with ONLY template-literal dynamic key-extractor", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/template-key-reader.ts",
      // Template literal form: new RegExp(`^${key}:...`)
      [
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function readField(raw: string, key: string): string | null {",
        "  const m = raw.match(new RegExp(`^${key}:\\\\s*(.*)$`, 'm'));",
        "  return m ? m[1].trim() : null;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: file with ONLY single-string new RegExp('^key:...') extractor", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/single-string-key-reader.ts",
      // Whole anchored key pattern in one quoted string: new RegExp('^status:...').
      // No '^'+concat, no template literal, no regex literal, no split — pattern 4c.
      [
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function readStatus(raw: string): string | null {",
        "  const m = raw.match(new RegExp('^status:\\\\s*(.*)$', 'm'));",
        "  return m ? m[1].trim() : null;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("does NOT warn: file with ONLY new RegExp('^https?://...') URL (not a YAML key)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/url-regexp-builder.ts",
      [
        "function matchUrl(s: string): boolean {",
        "  return new RegExp('^https?://example', 'm').test(s);",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  // ── No false positive: URL regexes ──────────────────────────────────────

  it("does NOT warn: file with ONLY URL regex /^https?:\\/\\// (no YAML idiom)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/url-validator.ts",
      [
        "function isValidUrl(s: string): boolean {",
        "  return /^https?:\\/\\//.test(s);",
        "}",
        "function extractDomain(s: string): string | null {",
        "  const m = s.match(/^https?:\\/\\/([^\\/]+)/);",
        "  return m ? m[1] : null;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    expect(findings.filter((f) => f.check === "b").length).toBe(0);
  });

  // ── Inventory grandfathering ─────────────────────────────────────────────

  it("does NOT warn: inventoried reader file (grandfathered via U4 allow-list)", () => {
    // analyze-runs.ts is in the U4 inventory (reader id 7) — must not warn.
    const findings = lintCommsFormat({
      paths: ["/Users/miguelp/Projects/guild/plugin/scripts/analyze-runs.ts"],
    });
    expect(findings.filter((f) => f.check === "b").length).toBe(0);
  });
});

// ─── FIX A: pattern 5 — unanchored matchAll + URL false-positive ──────────
//
// Reader #19 in the U4 inventory uses an UNANCHORED matchAll:
//   raw.matchAll(/source_ref[s]?:\s*(.+)/g)
// Current pattern 5 only catches ANCHORED /^key:/ forms. A new file
// copying the unanchored idiom must also be flagged.
// Also: anchored URL matchAll — matchAll(/^https?:\/\//g) — must NOT warn.

describe("check (b) — pattern 5 matchAll (FIX A)", () => {
  it("warns: file with ONLY unanchored matchAll YAML-key pattern (reader #19 idiom)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/unanchored-matchall-reader.ts",
      // Exact idiom from knowledge-links-builder.ts:599 (reader #19) — UNANCHORED.
      // No split, no startsWith, no anchored form — isolated to test pattern 5 coverage.
      [
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function collectEdges(raw: string): string[] {",
        "  const edges: string[] = [];",
        "  for (const m of raw.matchAll(/source_ref[s]?:\\s*(.+)/g)) {",
        "    edges.push(m[1]);",
        "  }",
        "  return edges;",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("warns: file with ONLY anchored matchAll YAML-key pattern (/^status:/g)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/anchored-matchall-reader.ts",
      [
        "// hand-rolled reader over run.yaml / .md frontmatter",
        "function readAll(raw: string): string[] {",
        "  return [...raw.matchAll(/^status:\\s*(.+)/gm)].map(m => m[1]);",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  it("does NOT warn: key-like regexes in files with NO YAML surface (positive-gate guard)", () => {
    // tel:/urn:/blob: URI matchers + a glob RegExp builder — none read a YAML/MD
    // surface, so the positive YAML-surface gate exempts them (root false-positive fix).
    const base = tmpDir();
    const cases: Array<[string, string]> = [
      ["scripts/tel.ts", "export const a=(r:string)=>[...r.matchAll(/^tel:\\S+/g)];\n"],
      ["scripts/urn.ts", "export const a=(r:string)=>[...r.matchAll(/^urn:[^ ]+/g)];\n"],
      ["scripts/glob.ts", "export function globToRegExp(g:string){return new RegExp(`^${g}$`);}\n"],
      ["scripts/blob.ts", "export const a=(r:string)=>r.match(new RegExp('^blob:abc'));\n"],
    ];
    for (const [rel, body] of cases) {
      const p = writeFile(base, rel, body);
      expect(lintCommsFormat({ paths: [p] }).filter((f) => f.check === "b").length).toBe(0);
    }
  });

  it("does NOT warn: matchAll with non-slash URL schemes mailto:/data: (named-scheme guard)", () => {
    const base = tmpDir();
    const mailto = writeFile(
      base,
      "scripts/mailto-matchall.ts",
      "export const a=(r:string)=>[...r.matchAll(/^mailto:\\S+/g)];\n"
    );
    const data = writeFile(
      base,
      "scripts/data-matchall.ts",
      "export const a=(r:string)=>[...r.matchAll(/^data:[^,]+,/g)];\n"
    );
    expect(lintCommsFormat({ paths: [mailto] }).filter((f) => f.check === "b").length).toBe(0);
    expect(lintCommsFormat({ paths: [data] }).filter((f) => f.check === "b").length).toBe(0);
  });

  it("does NOT warn: anchored URL matchAll /^https?:\\/\\//g (false-positive guard)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/url-matchall.ts",
      [
        "function findUrls(raw: string): string[] {",
        "  return [...raw.matchAll(/^https?:\\/\\/\\S+/gm)].map(m => m[0]);",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: unanchored URL matchAll (no YAML key shape)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/url-unanchored-matchall.ts",
      [
        "function findAll(raw: string): string[] {",
        "  return [...raw.matchAll(/https?:\\/\\/\\S+/g)].map(m => m[0]);",
        "}",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: anchored ftp:// regex literal (URL false-positive guard)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/ftp-check.ts",
      [
        "const isFtp = (s: string) => /^ftp:\\/\\//.test(s);",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });

  it("does NOT warn: anchored file:// regex literal (URL false-positive guard)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/file-check.ts",
      [
        "const isFile = (s: string) => /^file:\\/\\//.test(s);",
      ].join("\n")
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBe(0);
  });
});

// ─── FIX B: import-safe core — no run-on-import side effect ───────────────

describe("import-safe core (FIX B)", () => {
  it("importing lintCommsFormat from the core produces no output/exit (pure exports)", () => {
    // The core must not self-invoke when imported. We test this by checking
    // that requiring the module in a child process produces no stdout/stderr
    // and exits 0 without any [comms-format-lint] output.
    const { spawnSync } = require("child_process");
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "-e",
        // Just import the core — if the CLI block runs it would print output
        "const { lintCommsFormat } = require('./comms/comms-format-lint'); process.exit(0);",
      ],
      {
        cwd: "/Users/miguelp/Projects/guild/plugin/scripts",
        encoding: "utf8",
        timeout: 15000,
      }
    );
    // Must exit 0
    expect(result.status).toBe(0);
    // Must produce NO output (no [comms-format-lint] banner, no warnings)
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    expect(combined).not.toMatch(/\[comms-format-lint\]/);
  });

  it("CLI entry file (comms-format-lint.cli.ts) warns and exits 0 on a bad receipt", () => {
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
    const { spawnSync } = require("child_process");
    const result = spawnSync(
      "npx",
      ["tsx", "comms/comms-format-lint.cli.ts", "--paths", receiptPath],
      {
        cwd: "/Users/miguelp/Projects/guild/plugin/scripts",
        encoding: "utf8",
        timeout: 15000,
      }
    );
    // Must exit 0 (warn-only)
    expect(result.status).toBe(0);
    // Must emit the WARN line
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    expect(combined).toMatch(/\[comms-format-lint\] WARN/);
  });
});

// ─── WARN mode — always exits 0 ───────────────────────────────────────────

describe("WARN mode — non-blocking contract", () => {
  it("lintCommsFormat returns an array (never throws) on any input", () => {
    expect(() => lintCommsFormat({})).not.toThrow();
    expect(Array.isArray(lintCommsFormat({}))).toBe(true);
  });

  it("all findings have severity 'warn' when enforce=false (default)", () => {
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
    const findings = lintCommsFormat({ paths: [receiptPath] });
    for (const f of findings) {
      expect(f.severity).toBe("warn");
    }
  });

  it("enforce flag is accepted without throwing (exists for U5b)", () => {
    expect(() => lintCommsFormat({ enforce: false })).not.toThrow();
    expect(() => lintCommsFormat({ enforce: true })).not.toThrow();
  });

  it("finding shape matches CommsLintFinding interface (check, severity, file, message)", () => {
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
    const findings = lintCommsFormat({ paths: [receiptPath] });
    for (const f of findings) {
      expect(["a", "b", "c"]).toContain(f.check);
      expect(f.severity).toBe("warn");
      expect(typeof f.file).toBe("string");
      expect(typeof f.message).toBe("string");
    }
  });
});
