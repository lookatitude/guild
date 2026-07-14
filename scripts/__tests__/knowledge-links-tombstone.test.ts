/**
 * scripts/__tests__/knowledge-links-tombstone.test.ts
 *
 * Tombstone-never-delete (docs/v2/05-knowledge-memory.md §Invalidation; deferred
 * item 8). A superseded decision / deleted artifact marks its knowledge-links
 * edge tombstoned instead of hard-deleting it: active recall skips it, the edge
 * stays in the file as history, and re-tombstoning is idempotent.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadKnowledgeLinks,
  activeLinks,
  tombstoneLinks,
  reachableKinds,
  type KnowledgeLink,
} from "../knowledge-links-traverse";

function mkFile(links: KnowledgeLink[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-kl-tomb-"));
  const file = path.join(dir, "knowledge-links.json");
  fs.writeFileSync(file, JSON.stringify({ version: "guild.knowledge_links.v1", links }, null, 2));
  return file;
}
const L = (from: string, to: string, type: string): KnowledgeLink => ({ from, to, type, run_id: "r1" });
const AT = "2026-06-13T00:00:00Z";

test("tombstoneLinks marks the edge but NEVER deletes it", () => {
  const file = mkFile([L("decision:a", "wiki:x", "supersedes"), L("decision:b", "wiki:y", "supersedes")]);
  const res = tombstoneLinks(file, { from: "decision:a" }, "superseded by decision:c", AT);
  expect(res.tombstoned).toBe(1);

  const doc = loadKnowledgeLinks(file);
  expect(doc.links).toHaveLength(2); // nothing removed
  const a = doc.links.find((l) => l.from === "decision:a")!;
  expect(a.tombstoned).toBe(true);
  expect(a.tombstoned_at).toBe(AT);
  expect(a.tombstoned_reason).toMatch(/superseded by decision:c/);
});

test("activeLinks excludes tombstoned edges", () => {
  const file = mkFile([L("decision:a", "wiki:x", "supersedes"), L("decision:b", "wiki:y", "supersedes")]);
  tombstoneLinks(file, { from: "decision:a" }, "gone", AT);
  const doc = loadKnowledgeLinks(file);
  expect(doc.links).toHaveLength(2);
  expect(activeLinks(doc).map((l) => l.from)).toEqual(["decision:b"]);
});

test("active recall (reachableKinds) does not traverse a tombstoned edge", () => {
  // task → decision via a single edge; tombstoning it breaks reachability.
  const file = mkFile([L("feature:task1", "decision:d1", "constrained_by")]);
  expect([...reachableKinds(loadKnowledgeLinks(file), "feature:task1")]).toContain("decision");

  tombstoneLinks(file, { from: "feature:task1", to: "decision:d1" }, "decision superseded", AT);
  expect([...reachableKinds(loadKnowledgeLinks(file), "feature:task1")]).not.toContain("decision");
});

test("re-tombstoning is idempotent (a second call tombstones 0 and keeps the file stable)", () => {
  const file = mkFile([L("decision:a", "wiki:x", "supersedes")]);
  expect(tombstoneLinks(file, { from: "decision:a" }, "r", AT).tombstoned).toBe(1);
  const after1 = fs.readFileSync(file, "utf8");
  expect(tombstoneLinks(file, { from: "decision:a" }, "r", "2026-09-09T00:00:00Z").tombstoned).toBe(0);
  expect(fs.readFileSync(file, "utf8")).toBe(after1); // no rewrite, original stamp preserved
});

// ── G2b-4 regression: tombstoneLinks must standardize on `schema_version` ──
// Before the fix, tombstoneLinks wrote this module's own local `{version}`
// shape via a raw fs.writeFileSync, silently dropping `schema_version` on
// rewrite whenever the on-disk file had been written by a schema_version-
// keyed producer (knowledge-links-builder.ts / the emit-learning-checkpoint
// hook). It now delegates to the shared knowledge-links-io writer.
test("tombstoneLinks rewrites the file with `schema_version` even when seeded with legacy `version`", () => {
  const file = mkFile([L("decision:a", "wiki:x", "supersedes")]); // mkFile seeds legacy `version` key
  tombstoneLinks(file, { from: "decision:a" }, "superseded", AT);

  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(onDisk.schema_version).toBe("guild.knowledge_links.v1");
  expect(onDisk.version).toBeUndefined();
  expect(onDisk.links).toHaveLength(1);
});

test("tombstoneLinks preserves `schema_version` when the on-disk file already used it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-kl-tomb-"));
  const file = path.join(dir, "knowledge-links.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ schema_version: "guild.knowledge_links.v1", links: [L("decision:a", "wiki:x", "supersedes")] }),
  );

  tombstoneLinks(file, { from: "decision:a" }, "superseded", AT);

  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  expect(onDisk.schema_version).toBe("guild.knowledge_links.v1");
  expect(onDisk.version).toBeUndefined();
});
