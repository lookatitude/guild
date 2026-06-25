import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/ingest-importance";
import * as moduleImpl from "../../src/modules/knowledge/workflows/ingest-importance";

describe("ingest-importance compatibility shim", () => {
  test("scripts/lib/ingest-importance re-exports src/modules/knowledge", () => {
    expect(shim.RECALL_IMPORTANCE_KEY).toBe(moduleImpl.RECALL_IMPORTANCE_KEY);
    expect(shim.RECALL_IMPORTANCE_PINNED_KEY).toBe(moduleImpl.RECALL_IMPORTANCE_PINNED_KEY);
    expect(shim.isValidScore).toBe(moduleImpl.isValidScore);
    expect(shim.ingestImportanceScore).toBe(moduleImpl.ingestImportanceScore);
    expect(shim.parseRecallImportance).toBe(moduleImpl.parseRecallImportance);
    expect(shim.isRecallImportancePinned).toBe(moduleImpl.isRecallImportancePinned);
    expect(shim.resolveRecallImportance).toBe(moduleImpl.resolveRecallImportance);
    expect(shim.stampRecallImportance).toBe(moduleImpl.stampRecallImportance);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/ingest-importance.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/knowledge/workflows/ingest-importance.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/knowledge\/workflows\/ingest-importance/);
    expect(oldPath).not.toMatch(/export\s+function\s+ingestImportanceScore/);
    expect(modulePath).toMatch(/export\s+function\s+ingestImportanceScore/);
    expect(modulePath).toMatch(/from\s+["']\.\.\/\.\.\/state["']/);
    expect(modulePath).not.toMatch(/state\/workflows\/frontmatter/);
  });
});
