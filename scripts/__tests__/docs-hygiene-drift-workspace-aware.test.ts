/**
 * scripts/__tests__/docs-hygiene-drift-workspace-aware.test.ts
 *
 * REAL-PATH test for docs-hygiene/scan.ts rule 1 (drift markers), the
 * 2026-06-13 recalibration: the `single-repo` drift pattern must NOT flag
 * workspace-AWARE prose (lines naming the `is_workspace` field or the
 * `workspace` concept) — that text documents the workspace-vs-non-workspace
 * distinction, not a surviving v1 single-repo assumption. A BARE single-repo
 * assumption (no workspace reference) must still flag, so the exemption is
 * scoped, not a blanket mute. The script is executed for real (npx tsx, temp
 * workspace), not via an injected seam.
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

const FM = [
  "---",
  "type: decision",
  "owner: architect",
  "confidence: high",
  "importance: medium",
  "created_at: 2026-01-01",
  "updated_at: 2026-01-01",
  "sensitivity: public",
  "---",
  "",
].join("\n");

describe("docs-hygiene scan rule 1 — single-repo drift exempts workspace-aware lines", () => {
  let ws: string;
  let outPath: string;

  beforeAll(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "guild-scan-drift-"));
    outPath = path.join(ws, "scan-out.md");

    // Workspace-AWARE lines that mention "single-repo" — must NOT flag.
    write(
      ws,
      "docs/knowledge/decisions/ws-aware.md",
      FM +
        "# Workspace-aware\n\n" +
        "Always present; `is_workspace:false` for single-repo.\n\n" +
        "Human label, e.g. `guild (workspace root)` or a single repo name.\n",
    );

    // A BARE single-repo assumption with no workspace reference — must flag.
    write(
      ws,
      "docs/knowledge/decisions/bare-assumption.md",
      FM + "# Bare\n\nThis tool assumes a single-repo checkout and nothing else.\n",
    );

    execSync(
      `npx tsx ${JSON.stringify(SCAN)} --workspace=${JSON.stringify(ws)} --output=${JSON.stringify(outPath)}`,
      { cwd: SCRIPTS_DIR, encoding: "utf8" },
    );
  });

  afterAll(() => {
    fs.rmSync(ws, { recursive: true, force: true });
  });

  test("does NOT flag workspace-aware single-repo prose", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).not.toContain("ws-aware.md");
  });

  test("still flags a bare single-repo assumption (exemption is scoped)", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).toContain("bare-assumption.md");
    expect(out).toContain("single-repo assumption");
  });

  test("exactly one drift flag total (the bare one)", () => {
    const out = fs.readFileSync(outPath, "utf8");
    expect(out).toContain("| Drift markers (v1/single-repo) | 1 |");
  });
});
