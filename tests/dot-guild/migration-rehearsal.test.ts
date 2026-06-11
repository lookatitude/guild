/**
 * tests/dot-guild/migration-rehearsal.test.ts
 *
 * THE END-TO-END v1→v2 MIGRATION REHEARSAL — a permanent regression test that
 * walks the FULL pipeline on a realistic v1 fixture tree using the REAL
 * filesystem (realFs, temp dir) and the REAL CLI verb for the human gate.
 * No injected fs seam — this is the real path (the injected-seam lesson:
 * green isolation tests prove the helper, not the wiring).
 *
 * Fixture: v1 config.yml (mapped + unmapped keys) + project.yaml
 * (wiki.share_mode) + a legacy run (metadata.json, no run.yaml) + a wiki with
 * ungraded pages incl. one already-graded + one provenance page.
 *
 * Pipeline: dry-run → assert report + zero mutation → migrate → assert v2
 * shape (settings.json, run.yaml + provenance.json, snapshot dir, drafted
 * grades, .unmigrated-v1.json carry) → CLI --accept-grades → flags stripped.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { runMigration } from "../../scripts/dot-guild/convert/index";
import { fixedClock } from "../../scripts/dot-guild/convert/seams";

const ISO = "2026-06-11T09:00:00.000Z";
const STAMP = "20260611T090000Z";

const MIGRATE_CLI = path.resolve(__dirname, "../../scripts/dot-guild/migrate-guild.ts");
const SCRIPTS_DIR = path.resolve(__dirname, "../../scripts");

// ── Fixture builder ──────────────────────────────────────────────────────────

function write(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

const FM_BASE =
  "type: standard\nowner: orchestrator\nconfidence: high\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\nsensitivity: internal\n";

/** A realistic v1 `.guild/` tree (Example-Project fake data only). */
function buildV1Fixture(root: string): void {
  // v1 config surface: mapped keys (codex_review/auto_approve/loop_cap) + one
  // unmapped key that must carry into .unmigrated-v1.json.
  write(
    root,
    ".guild/config.yml",
    "codex_review: true\nauto_approve: spec-and-plan\nloop_cap: 8\nexample_custom_knob: 42\n"
  );
  // Identity file with the v1 wiki.share_mode key (moves to settings.json).
  write(root, ".guild/project.yaml", "name: Example Project\nslug: example-project\nwiki:\n  share_mode: private\n");
  // Legacy run: metadata.json, NO run.yaml → reconstructed run.yaml + provenance.json.
  write(
    root,
    ".guild/runs/run-legacy-1/metadata.json",
    JSON.stringify({ run_id: "run-legacy-1", started_at: "2026-02-02T10:00:00Z", status: "closed" }, null, 2)
  );
  write(root, ".guild/runs/run-legacy-1/events.ndjson", '{"type":"event","name":"example"}\n');
  // The wiki: two ungraded pages (standards → high, context → medium), one
  // frontmatter-less page, one ALREADY graded, one provenance, structural index.
  write(root, ".guild/wiki/index.md", "# Example wiki index\n");
  write(root, ".guild/wiki/standards/test-standard.md", `---\n${FM_BASE}---\n\n# Test Standard\n\nFake body.\n`);
  write(root, ".guild/wiki/context/example-context.md", `---\n${FM_BASE}---\n\n# Example Context\n\nFake body.\n`);
  write(root, ".guild/wiki/concepts/bare-concept.md", "# Bare Concept\n\nNo frontmatter on this v1 page.\n");
  write(
    root,
    ".guild/wiki/decisions/example-graded.md",
    `---\ntype: decision\nowner: orchestrator\nconfidence: high\nimportance: critical\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\nsensitivity: internal\n---\n\n# Already graded\n`
  );
  write(root, ".guild/wiki/research/example-spike.md", `---\n${FM_BASE}---\n\n# Spike notes (provenance)\n`);
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(root: string, rel: string): boolean {
  return fs.existsSync(path.join(root, rel));
}

// ─────────────────────────────────────────────────────────────────────────────

describe("v1→v2 migration rehearsal (real fs, full pipeline, human gate)", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-migration-rehearsal-"));
    buildV1Fixture(root);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("step 1 — dry-run: plan + report only, ZERO mutation", () => {
    const before = snapshotTree(root);
    const res = runMigration({ root, mode: "dry-run", clock: fixedClock(ISO) });
    expect(res.workspace).toBe(false);
    const child = res.children[0];
    expect(child.detect.classification).toBe("v1");
    expect(child.action).toBe("dry-run");

    // The report names every leg of the plan.
    expect(child.reportBody).toContain("`config.yml`");
    expect(child.reportBody).toContain("settings.json");
    expect(child.reportBody).toContain("example_custom_knob");
    expect(child.reportBody).toContain("Drafted wiki importance grades — REVIEW REQUIRED");
    expect(child.reportBody).toContain("WOULD be drafted");
    expect(child.reportBody).toContain("| `wiki/standards/test-standard.md` | high | standards/** → high |");
    expect(child.reportBody).toContain("| `wiki/context/example-context.md` | medium | default → medium |");
    expect(child.reportBody).toContain("--accept-grades");

    // Dry-run wrote NOTHING except its own report file.
    const after = snapshotTree(root);
    const newFiles = [...after.keys()].filter((k) => !before.has(k));
    expect(newFiles).toEqual([path.join(".guild", `.migration-report-${STAMP}.md`)]);
    for (const [k, v] of before) expect(after.get(k)).toBe(v);
  });

  test("step 2 — migrate: snapshot-first, full v2 shape, grades drafted", () => {
    const res = runMigration({ root, mode: "migrate", clock: fixedClock(ISO) });
    const child = res.children[0];
    expect(child.action).toBe("migrate");
    expect(child.error).toBeUndefined();
    expect(child.snapshot?.verified).toBe(true);

    // Snapshot dir holds the ORIGINAL v1 sources.
    const snapRel = path.join(".guild", child.snapshot!.destRel);
    expect(exists(root, path.join(snapRel, "config.yml"))).toBe(true);
    expect(exists(root, path.join(snapRel, "runs/run-legacy-1/metadata.json"))).toBe(true);
    expect(read(root, path.join(snapRel, "wiki/standards/test-standard.md"))).not.toContain("importance");

    // settings.json: mapped keys landed.
    const settings = JSON.parse(read(root, ".guild/settings.json"));
    expect(settings.review).toBe("cross");
    expect(settings.auto_approve).toEqual(["spec", "plan"]);
    expect(settings.loop_cap).toBe(8);
    expect(settings.defaults?.wiki?.share_mode).toBe("private");

    // config.yml removed; project.yaml kept (identity) with share_mode stripped.
    expect(exists(root, ".guild/config.yml")).toBe(false);
    expect(read(root, ".guild/project.yaml")).toContain("Example Project");
    expect(read(root, ".guild/project.yaml")).not.toContain("share_mode");

    // Legacy run reconstructed.
    const runYaml = read(root, ".guild/runs/run-legacy-1/run.yaml");
    expect(runYaml).toContain("schema_version: guild.run.v1");
    expect(runYaml).toContain("run_id: run-legacy-1");
    const prov = JSON.parse(read(root, ".guild/runs/run-legacy-1/provenance.json"));
    expect(prov.schema_version).toBe("guild.provenance.v1");
    expect(exists(root, ".guild/runs/run-legacy-1/metadata.json")).toBe(false);
    expect(exists(root, ".guild/runs/run-legacy-1/events.ndjson")).toBe(true); // carry-forward

    // .unmigrated-v1.json carries the unmapped key verbatim.
    const unmig = JSON.parse(read(root, ".guild/.unmigrated-v1.json"));
    expect(unmig.schema_version).toBe("guild.unmigrated.v1");
    expect(unmig.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "example_custom_knob", value: 42 })])
    );

    // Wiki grades drafted (the gate is now armed).
    const std = read(root, ".guild/wiki/standards/test-standard.md");
    expect(std).toMatch(/^importance: high$/m);
    expect(std).toMatch(/^importance_draft: true$/m);
    expect(std).toMatch(/^graded_by: guild-migrate$/m);
    const ctx = read(root, ".guild/wiki/context/example-context.md");
    expect(ctx).toMatch(/^importance: medium$/m);
    const bare = read(root, ".guild/wiki/concepts/bare-concept.md");
    expect(bare.startsWith("---\nimportance: medium\nimportance_draft: true\ngraded_by: guild-migrate\n---\n")).toBe(true);
    // Already-graded + provenance pages untouched.
    expect(read(root, ".guild/wiki/decisions/example-graded.md")).not.toContain("importance_draft");
    expect(read(root, ".guild/wiki/research/example-spike.md")).not.toContain("importance");
    expect(read(root, ".guild/wiki/index.md")).toBe("# Example wiki index\n");

    // The written report (same stamp ⇒ overwrites the dry-run report) ends
    // with the review table + instruction.
    const report = read(root, path.join(".guild", `.migration-report-${STAMP}.md`));
    expect(report).toContain("were drafted a v2 `importance:` grade"); // migrate wording, not dry-run
    const gateIdx = report.indexOf("## Drafted wiki importance grades — REVIEW REQUIRED (human gate)");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(report.slice(gateIdx)).not.toMatch(/\n## (?!Drafted)/);
    expect(report).toContain("--accept-grades");
  });

  test("step 3 — the human gate: CLI --accept-grades strips flags, keeps grades", () => {
    // Operator reviews the table and edits one drafted grade before accepting.
    const ctxPath = path.join(root, ".guild/wiki/context/example-context.md");
    fs.writeFileSync(ctxPath, fs.readFileSync(ctxPath, "utf8").replace("importance: medium", "importance: high"), "utf8");

    const stdout = execSync(`npx tsx ${JSON.stringify(MIGRATE_CLI)} --accept-grades --root=${JSON.stringify(root)}`, {
      cwd: SCRIPTS_DIR,
      encoding: "utf8",
    });
    expect(stdout).toContain("accepted: wiki/standards/test-standard.md (importance: high)");
    expect(stdout).toContain("accepted: wiki/context/example-context.md (importance: high)"); // edited grade kept
    expect(stdout).toContain("accepted: wiki/concepts/bare-concept.md (importance: medium)");
    expect(stdout).toContain("Accepted 3 drafted grade(s)");

    for (const rel of [
      ".guild/wiki/standards/test-standard.md",
      ".guild/wiki/context/example-context.md",
      ".guild/wiki/concepts/bare-concept.md",
    ]) {
      const page = read(root, rel);
      expect(page).toMatch(/^importance: (high|medium)$/m);
      expect(page).not.toContain("importance_draft");
      expect(page).not.toContain("graded_by");
    }
    // Body + base frontmatter survived the whole pipeline.
    expect(read(root, ".guild/wiki/standards/test-standard.md")).toContain("# Test Standard\n\nFake body.");
    expect(read(root, ".guild/wiki/standards/test-standard.md")).toMatch(/^confidence: high$/m);

    // Idempotent: a second accept finds nothing pending.
    const again = execSync(`npx tsx ${JSON.stringify(MIGRATE_CLI)} --accept-grades --root=${JSON.stringify(root)}`, {
      cwd: SCRIPTS_DIR,
      encoding: "utf8",
    });
    expect(again).toContain("No drafted wiki importance grades pending");
  });
});

/** Map of every file under root → content (for the zero-mutation assertion). */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const recur = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) recur(full);
      else out.set(path.relative(root, full), fs.readFileSync(full, "utf8"));
    }
  };
  recur(root);
  return out;
}
