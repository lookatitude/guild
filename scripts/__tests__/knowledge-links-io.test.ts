/**
 * scripts/__tests__/knowledge-links-io.test.ts
 *
 * G2b-4 fix: the ONE shared load/append/write helper for
 * `.guild/indexes/knowledge-links.json`, used by all in-scope producers
 * (knowledge-links-builder.ts, learn/lib/domain.ts, knowledge-links-traverse.ts).
 *
 * Regression coverage for the drift this replaces: two producers wrote a
 * top-level `version` key, two wrote `schema_version`, and the traverse
 * module's append/tombstone path would silently drop `schema_version` on
 * rewrite (re-writing its own private `version`-keyed shape). This helper
 * standardizes on `schema_version` for every write while tolerating the
 * legacy `version` key on read.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  loadKnowledgeLinksDoc,
  writeKnowledgeLinksDoc,
  appendKnowledgeLinksBatch,
  KNOWLEDGE_LINKS_SCHEMA_VERSION,
  type KnowledgeLink,
} from "../learn/lib/knowledge-links-io";

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-io-"));
  file = path.join(dir, "knowledge-links.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const L = (from: string, to: string, type: string, run_id = "r1"): KnowledgeLink => ({
  from,
  to,
  type,
  run_id,
});

describe("loadKnowledgeLinksDoc", () => {
  test("missing file → empty doc, current schema_version", () => {
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.links).toEqual([]);
    expect(doc.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
  });

  test("reads the current schema_version key", () => {
    fs.writeFileSync(file, JSON.stringify({ schema_version: "guild.knowledge_links.v1", links: [L("a", "b", "touches")] }));
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.schema_version).toBe("guild.knowledge_links.v1");
    expect(doc.links).toHaveLength(1);
  });

  test("tolerates the legacy version key on read", () => {
    fs.writeFileSync(file, JSON.stringify({ version: "guild.knowledge_links.v1", links: [L("a", "b", "touches")] }));
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.schema_version).toBe("guild.knowledge_links.v1");
    expect(doc.links).toHaveLength(1);
  });

  test("prefers schema_version over version when both are present", () => {
    fs.writeFileSync(file, JSON.stringify({ schema_version: "v2-ish", version: "v1-ish", links: [] }));
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.schema_version).toBe("v2-ish");
  });

  test("corrupt JSON → empty doc, no throw", () => {
    fs.writeFileSync(file, "{not json");
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.links).toEqual([]);
  });

  test("missing links array → empty doc", () => {
    fs.writeFileSync(file, JSON.stringify({ schema_version: "x" }));
    const doc = loadKnowledgeLinksDoc(file);
    expect(doc.links).toEqual([]);
  });
});

describe("writeKnowledgeLinksDoc", () => {
  test("always writes schema_version, never version", () => {
    writeKnowledgeLinksDoc(file, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [L("a", "b", "touches")] });
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
    expect(onDisk.version).toBeUndefined();
  });

  test("creates parent directories as needed", () => {
    const nested = path.join(dir, "a", "b", "knowledge-links.json");
    writeKnowledgeLinksDoc(nested, { schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [] });
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("appendKnowledgeLinksBatch — the append path preserves the schema_version key", () => {
  test("fresh file: writes schema_version + the batch", () => {
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    expect(res).toEqual({ added: 1, total: 1 });
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
    expect(onDisk.version).toBeUndefined();
    expect(onDisk.links).toHaveLength(1);
  });

  test("appending to a schema_version-keyed file PRESERVES schema_version (regression)", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ schema_version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [L("decision:a", "run:r1", "decided_by")] }),
    );
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    expect(res).toEqual({ added: 1, total: 2 });

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
    expect(onDisk.version).toBeUndefined(); // never regresses to the legacy key
    expect(onDisk.links).toHaveLength(2);
  });

  test("appending to a LEGACY version-keyed file UPGRADES it to schema_version", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ version: KNOWLEDGE_LINKS_SCHEMA_VERSION, links: [L("decision:a", "run:r1", "decided_by")] }),
    );
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    expect(res).toEqual({ added: 1, total: 2 });

    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
    expect(onDisk.version).toBeUndefined();
    expect(onDisk.links).toHaveLength(2);
    // Pre-existing link content survives the upgrade.
    expect(onDisk.links.some((l: KnowledgeLink) => l.from === "decision:a")).toBe(true);
  });

  test("dedupes by from|to|type — appending an identical link twice adds it once", () => {
    appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    expect(res).toEqual({ added: 0, total: 1 });
  });

  test("run_id is excluded from the dedup key", () => {
    appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches", "run-1")]);
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches", "run-2")]);
    expect(res.added).toBe(0); // same from|to|type, different run_id — still deduped
  });

  test("corrupt on-disk file is treated as empty and rebuilt cleanly", () => {
    fs.writeFileSync(file, "{not json");
    const res = appendKnowledgeLinksBatch(file, [L("domain:x", "file:a.ts", "touches")]);
    expect(res).toEqual({ added: 1, total: 1 });
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.schema_version).toBe(KNOWLEDGE_LINKS_SCHEMA_VERSION);
  });
});
