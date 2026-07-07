/**
 * scripts/__tests__/docs-hygiene-pending-grades.test.ts
 *
 * REAL-PATH test for docs-hygiene/scan.ts rule 7 (pending grade review):
 * pages still carrying `importance_draft: true` — drafted by the v1→v2
 * migration's wiki importance backfill and not yet accepted via
 * `migrate-guild.ts --accept-grades` — must be flagged by the deterministic
 * lint scan. The script is executed for real (npx tsx, temp workspace),
 * not via an injected seam.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";

const SCAN = path.resolve(__dirname, "../docs-hygiene/scan.ts");
const SCRIPTS_DIR = path.resolve(__dirname, "..");

function write(root: string, rel: string, content: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

describe("docs-hygiene scan rule 7 — pending grade review (importance_draft)", () => {
  let ws: string;
  let outPath: string;

  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scan-pending-"));
    outPath = path.join(ws, "scan-out.md");
    // A migration-drafted page (must flag) in the plugin wiki corpus.
    write(
      ws,
      "plugin/.guild/wiki/standards/example-drafted.md",
      "---\ntype: standard\nowner: orchestrator\nconfidence: high\nimportance: high\nimportance_draft: true\ngraded_by: guild-migrate\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\nsensitivity: internal\n---\n\n# Example drafted standard\n"
    );
    // An accepted page (must NOT flag).
    write(
      ws,
      "plugin/.guild/wiki/standards/example-accepted.md",
      "---\ntype: standard\nowner: orchestrator\nconfidence: high\nimportance: high\ncreated_at: 2026-01-01\nupdated_at: 2026-01-01\nsensitivity: internal\n---\n\n# Example accepted standard\n"
    );
    execSync(
      `npx tsx ${JSON.stringify(SCAN)} --workspace=${JSON.stringify(ws)} --output=${JSON.stringify(outPath)}`,
      { cwd: SCRIPTS_DIR, encoding: "utf8" }
    );
  });

  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  test("flags the page still carrying importance_draft: true", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).toContain("7. Pending grade review (migration draft grades)");
    expect(out).toContain("plugin/.guild/wiki/standards/example-drafted.md");
    expect(out).toContain("importance_draft: true — migration-drafted grade awaiting operator review");
    expect(out).toContain("| Pending grade review (importance_draft) | 1 |");
  });

  test("does not flag the accepted page", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).not.toContain("example-accepted.md");
  });

  test("usage section tells the operator how to accept", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).toContain("--accept-grades");
  });
});
