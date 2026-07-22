/**
 * scripts/comms/__tests__/comms-format-lint.test.ts
 *
 * TDD suite for comms-format-lint.ts (U5a — warn-mode lint core).
 *
 * Policy refs:
 *   ADR: communication-format-policy (workspace wiki)
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

  // ── YAML-surface gate: a bare '.md' substring is not a YAML surface ──────
  //
  // Regression for the OD-3 Markdown false positive: scripts/generate-support-matrix.ts
  // parsed a plain Markdown metadata line (`Generated: <iso>`) with an anchored
  // regex. It never touched YAML, but the old gate accepted any file merely
  // CONTAINING '.md', so pattern (3) fired and a correct parse had to be
  // rewritten around the detector. The gate now requires a real YAML signal.
  it("does NOT warn: anchored regex over a Markdown metadata line with only a '.md' path", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/generate-matrix.ts",
      `
const OUT = join(__dirname, "..", "docs", "generated", "host-support-matrix.md");

function normalizeGeneratedAt(markdown: string): string {
  const line = markdown.split(/\\r?\\n/).find((l) => l.startsWith("Generated:"));
  const match = line?.match(/^Generated: (\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)$/);
  return match?.[1] ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
  });

  // Companion true-positive: same anchored-key idiom, but over a real YAML
  // surface (.yml path). Must still be flagged — the gate tightened, it did not
  // turn off. This case fails if the YAML signal list is emptied.
  it("warns: anchored key regex over a real .yml surface is still flagged", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/read-team-yml.ts",
      `
const TEAM_FILE = ".guild/team/current.yml";

function readStatus(raw: string): string {
  const match = raw.match(/^status:\\s*(.*)$/m);
  return match?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
    expect(warns[0].message).toMatch(/hand-rolled.*YAML|OD-3/i);
  });

  // Frontmatter readers carry the '---' delimiter in a code position even when
  // they never say "yaml" or "frontmatter" and only name a .md path.
  it("warns: hand-rolled .md frontmatter reader signalled by the '---' delimiter", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/read-doc-meta.ts",
      `
function readTitle(doc: string): string {
  const end = doc.indexOf("---", 3);
  const head = doc.slice(3, end);
  const match = head.match(/^title:\\s*(.*)$/m);
  return match?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // The delimiter signal must survive the unquoted regex-literal form too —
  // split(/---/) carries no quote around the dashes.
  it("warns: frontmatter reader that locates the delimiter via split(/---/)", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/split-doc.ts",
      `
function readMeta(doc: string): string {
  const head = doc.split(/---/)[1] ?? "";
  const match = head.match(/^owner:\\s*(.*)$/m);
  return match?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // Dash sequences that are NOT frontmatter delimiters must not resurrect the
  // false positive: a long comment rule, a Markdown table rule, and a --flag.
  it("does NOT warn: dash runs that are comment rules, table rules, or CLI flags", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/render-report.ts",
      `
// ----------------------------------------------------------------
const OUT = arg("--out") ?? "report.md";

function render(rows: string[]): string {
  const table = ["| host | tier |", "|---|---|", ...rows].join("\\n");
  const stamp = table.match(/^Generated: (.*)$/m);
  return stamp ? table : "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
  });

  // Codex adversarial review, round 1 HIGH: the most common frontmatter
  // delimiter idiom of all is a newline-aware regex — split(/\r?\n---\r?\n/) —
  // where the dashes touch \n and \r, not a quote. An adjacency set of only
  // quotes/slashes/anchors lets this real reader escape once '.md' is dropped.
  it("warns: frontmatter reader using a newline-aware delimiter regex", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/read-newline-delimited.ts",
      `
const PATH = "README.md";

function readTitle(raw: string): string {
  const head = raw.split(/\\r?\\n---\\r?\\n/)[1] ?? "";
  const match = head.match(/^title:\\s*(.*)$/m);
  return match?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // Codex adversarial review, round 1 MED: a bare quoted "yaml" in a format
  // list is not a YAML surface. Only an import/require of the module counts.
  it("does NOT warn: quoted 'yaml' in a format list is not a YAML surface", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/list-formats.ts",
      `
const SUPPORTED = ["json", "yaml", "toml"];

function readStamp(report: string): string {
  const stamp = report.match(/^Generated:\\s*(.*)$/m);
  return stamp?.[1] ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
  });

  // …but an actual import of the 'yaml' module still is a YAML surface.
  it("warns: import of the 'yaml' module alongside a hand-rolled key regex", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/import-yaml-but-hand-roll.ts",
      `
import { parse } from "yaml";

function readStatus(raw: string): string {
  const match = raw.match(/^status:\\s*(.*)$/m);
  return match?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // Codex adversarial review, round 2 MED: the delimiter clause must require a
  // delimiter on BOTH sides. Leading-adjacency alone re-opens the false-positive
  // class — prose that merely starts a dash run, a caret-prefixed suffix, and a
  // dollar-suffixed prefix are all not frontmatter delimiters.
  it("does NOT warn: dash runs delimited on only one side", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/one-sided-dashes.ts",
      `
const TEMPLATE = "Summary\\n--- details";
const HEADING = "^---suffix";
const TRAILER = "prefix---$";

export function readStamp(raw: string): string {
  return raw.match(/^Generated:\\s*(.*)$/m)?.[1] ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
  });

  // Codex adversarial review, round 2 MED: 'js-yaml' must be recognised as a
  // module specifier, not as a bare substring — an incidental mention in a URL
  // or comment is not a YAML surface.
  it("does NOT warn: incidental 'js-yaml' mention in a URL is not a YAML surface", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/help-text.ts",
      `
const HELP = "See https://example.test/migrations/js-yaml-to-json";

export function readStamp(raw: string): string {
  return raw.match(/^Generated:\\s*(.*)$/m)?.[1] ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
  });

  // …but a real js-yaml import alongside a hand-rolled regex still warns. A
  // js-yaml dependency does not license hand-rolling next to it.
  it("warns: js-yaml import alongside a hand-rolled key regex", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/import-jsyaml-but-hand-roll.ts",
      `
import * as yaml from "js-yaml";

export function readStatus(raw: string): string {
  return raw.match(/^status:\\s*(.*)$/m)?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // Codex adversarial review, round 3 MED: the quantified fence /^-{3}$/ spells
  // the delimiter with ONE dash and a quantifier, so the literal-dash clauses
  // cannot see it. The old '.md' signal caught this reader; the tightened gate
  // must not lose it.
  it("warns: frontmatter reader using the quantified fence /^-{3}$/", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/quantified-fence.ts",
      `
const PATH = "README.md";
const FENCE = /^-{3}$/;

export function readTitle(lines: string[]): string {
  const end = lines.findIndex((l) => FENCE.test(l));
  const head = lines.slice(0, end).join("\\n");
  return head.match(/^title:\\s*(.*)$/m)?.[1]?.trim() ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns.length).toBeGreaterThan(0);
  });

  // Codex adversarial review, round 4 MED: the quantified-fence clause must be
  // anchor-to-anchor. An embedded -{3} quantifier in an unrelated regex is not
  // a frontmatter fence and must not confer candidacy.
  it("does NOT warn: embedded -{3} quantifier in an unrelated regex", () => {
    const base = tmpDir();
    const srcPath = writeFile(
      base,
      "scripts/slug-matcher.ts",
      `
const SLUG = /item-{3}id/;

export function readStamp(raw: string): string {
  return raw.match(/^Generated:\\s*(.*)$/m)?.[1] ?? "";
}
`
    );
    const findings = lintCommsFormat({ paths: [srcPath] });
    const warns = findings.filter((f) => f.check === "b");
    expect(warns).toEqual([]);
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
        cwd: require("node:path").resolve(__dirname, "../.."),
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
        cwd: require("node:path").resolve(__dirname, "../.."),
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

// ─── U5b ENFORCE mode — CLI exit-code contract ────────────────────────────
//
// These tests exercise the CLI entry (comms-format-lint.cli.ts) directly via
// spawnSync to verify the exit-code policy:
//   --enforce + ≥1 finding  → exit 1 (blocking)
//   --enforce + 0 findings  → exit 0 (clean)
//   no --enforce + ≥1 finding → exit 0 (warn-only; U5a behaviour preserved)
//
// The core (lintCommsFormat) is NOT tested for exit codes — it is a pure
// function that returns findings; exit-code policy is CLI-only.

describe("U5b ENFORCE mode — CLI exit-code contract", () => {
  const { spawnSync } = require("child_process");
  const CLI_CWD = require("node:path").resolve(__dirname, "../..");

  function runCli(args: string[]): { status: number | null; combined: string } {
    const result = spawnSync(
      "npx",
      ["tsx", "comms/comms-format-lint.cli.ts", ...args],
      {
        cwd: CLI_CWD,
        encoding: "utf8",
        timeout: 20000,
      }
    );
    return {
      status: result.status,
      combined: (result.stdout ?? "") + (result.stderr ?? ""),
    };
  }

  it("--enforce + finding => exit 1 (blocking)", () => {
    // A receipt with no guild.handoff.v2 block produces check-(a) finding.
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
    const { status, combined } = runCli(["--paths", receiptPath, "--enforce"]);
    expect(status).toBe(1);
    // Findings must still be printed (authors need to see what failed).
    expect(combined).toMatch(/\[comms-format-lint\]/);
    // The ENFORCE banner must appear.
    expect(combined).toMatch(/ENFORCE/);
  });

  it("--enforce + no finding => exit 0 (clean)", () => {
    // A fully-compliant receipt: valid v2 block + artifact_category declared.
    // check (a): valid v2 block — no finding.
    // check (c): artifact_category present — no finding.
    // This represents a receipt that satisfies OD-2 (valid envelope) and the
    // "new artifact must declare its category" discipline.
    const base = tmpDir();
    const compliantContent = `---
type: handoff_receipt
task_id: T-1
artifact_category: "7"
---

# Handoff

Some prose.

\`\`\`guild.handoff.v2
${VALID_V2_BLOCK}
\`\`\`
`;
    const receiptPath = writeFile(base, "handoffs/receipt.md", compliantContent);
    const { status } = runCli(["--paths", receiptPath, "--enforce"]);
    expect(status).toBe(0);
  });

  it("no --enforce + finding => exit 0 (warn-only; U5a behaviour preserved)", () => {
    // Even with a bad receipt, omitting --enforce must exit 0.
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptNoBlock());
    const { status, combined } = runCli(["--paths", receiptPath]);
    expect(status).toBe(0);
    // Findings are still printed (advisory annotations).
    expect(combined).toMatch(/\[comms-format-lint\] WARN/);
  });

  it("no paths, no --enforce => exit 0 (nothing to check)", () => {
    const { status } = runCli([]);
    expect(status).toBe(0);
  });

  it("--enforce with no changed paths => exit 0 (nothing to enforce)", () => {
    const { status } = runCli(["--enforce"]);
    expect(status).toBe(0);
  });
});

// ─── FIX C: looksLikeReceipt false-positive + check-(c) human-knowledge-doc exemption ──
//
// Three targeted regressions from the U5b safety-check STOP:
//   (1) A type:decision doc under docs/knowledge/ that MENTIONS guild.handoff.v2
//       in prose must produce NO check-(a), NO check-(c) findings.
//   (2) A genuine handoff_receipt with no artifact_category still fires check-(c)
//       when NOT under docs/knowledge/ (behaviour unchanged).
//   (3) A real receipt with a duplicate block still fires check-(a) (detection intact).

describe("FIX C — looksLikeReceipt narrowing + human-knowledge-doc exemption", () => {
  it("(1) type:decision doc under docs/knowledge/ mentioning guild.handoff.v2 in prose => NO check-(a), NO check-(c)", () => {
    // This is the exact pattern that caused the safety-check STOP:
    // communication-format-policy.md has type:decision, is under docs/knowledge/,
    // and documents the ```guild.handoff.v2 fence in its body prose.
    // The old looksLikeReceipt classified it as a receipt via the fence-content
    // heuristic; the new logic exempts it because type: is not handoff_receipt
    // and the path is not under /handoffs/ or /receipts/.
    // check-(c) must also be silent because docs/knowledge/ is category-2 by
    // established convention (isHumanKnowledgeDoc exemption).
    const base = tmpDir();
    const policyDoc = writeFile(
      base,
      "docs/knowledge/decisions/communication-format-policy.md",
      `---
type: decision
owner: architect
confidence: high
---

# Communication-format policy

A valid v1 receipt MUST embed exactly ONE fenced \`\`\`guild.handoff.v2\`\`\`
JSON block as machine truth.

The fence format is documented here for human readers.
`
    );
    const findings = lintCommsFormat({ paths: [policyDoc] });
    // No check-(a): this is not a receipt despite mentioning the fence in prose.
    expect(findings.filter((f) => f.check === "a").length).toBe(0);
    // No check-(c): docs/knowledge/ files are category-2 by convention.
    expect(findings.filter((f) => f.check === "c").length).toBe(0);
    // No findings at all.
    expect(findings.length).toBe(0);
  });

  it("(1b) type:standard / type:reflection under docs/knowledge/ => NO check-(c)", () => {
    // Other human knowledge doc types must also be exempt from check-(c).
    const base = tmpDir();
    const standard = writeFile(
      base,
      "docs/knowledge/standards/some-standard.md",
      `---\ntype: standard\nowner: architect\n---\n\n# A standard\n`
    );
    const reflection = writeFile(
      base,
      "docs/knowledge/reflections/some-reflection.md",
      `---\ntype: reflection\nowner: lead\n---\n\n# Reflection\n`
    );
    expect(lintCommsFormat({ paths: [standard] }).filter((f) => f.check === "c").length).toBe(0);
    expect(lintCommsFormat({ paths: [reflection] }).filter((f) => f.check === "c").length).toBe(0);
  });

  it("(2) genuine handoff_receipt without artifact_category, NOT under docs/knowledge/ => check-(c) still fires", () => {
    // Receipts outside docs/knowledge/ are machine-communication artifacts and must
    // still be required to declare their category. This verifies the exemption is
    // location-scoped and does not silently exempt real receipts.
    const base = tmpDir();
    const receiptPath = writeFile(
      base,
      "artifacts/new-receipt.md",
      `---
type: handoff_receipt
task_id: T-new
---

Some content without a category field.
`
    );
    const findings = lintCommsFormat({ paths: [receiptPath] });
    // check-(c) must still fire: not under docs/knowledge/, type is in COMM_ARTIFACT_TYPES.
    expect(findings.filter((f) => f.check === "c").length).toBeGreaterThan(0);
  });

  it("(3) genuine receipt with duplicate guild.handoff.v2 blocks => check-(a) still fires", () => {
    // The detection narrowing must not prevent real receipt violations from being caught.
    // A file under /handoffs/ with two v2 blocks is still an ambiguous receipt.
    const base = tmpDir();
    const receiptPath = writeFile(base, "handoffs/receipt.md", receiptTwoBlocks());
    const findings = lintCommsFormat({ paths: [receiptPath] });
    expect(findings.filter((f) => f.check === "a").length).toBeGreaterThan(0);
  });
});
