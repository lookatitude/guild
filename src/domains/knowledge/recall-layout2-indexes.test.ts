/** #283: recall finds knowledge indexes on the layout 2 cache root, and a legacy `.guild/indexes` as fallback. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { knowledgeIndexesDir } from "../state";
import { recall } from "./recall";

const TMP: string[] = [];
const saved = process.env.GUILD_CACHE_HOME;
beforeAll(() => {
  const c = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rl2-cache-"));
  TMP.push(c);
  process.env.GUILD_CACHE_HOME = c;
});
afterAll(() => {
  if (saved === undefined) delete process.env.GUILD_CACHE_HOME;
  else process.env.GUILD_CACHE_HOME = saved;
  for (const d of TMP) fs.rmSync(d, { recursive: true, force: true });
});

const doc = {
  schema_version: "guild.knowledge_links.v2",
  nodes: [{ id: "topic:zebracache", type: "topic", name: "zebracache policy", confidence: 1, source_refs: [] }],
  edges: [],
};

function root(layout: number): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-rl2-")));
  TMP.push(d);
  fs.mkdirSync(path.join(d, ".guild"), { recursive: true });
  fs.writeFileSync(path.join(d, ".guild", "storage-layout.json"), JSON.stringify({ storage_layout_version: layout }));
  return d;
}

const hit = (r: ReturnType<typeof recall>): boolean => JSON.stringify(r).includes("zebracache");

test("layout 2: recall reads knowledge-recall.json from the cache root", () => {
  const r = root(2);
  const dir = knowledgeIndexesDir(r);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "knowledge-recall.json"), JSON.stringify(doc));
  expect(dir.startsWith(path.join(r, ".guild"))).toBe(false);
  expect(hit(recall("zebracache", { cwd: r }))).toBe(true);
});

test("layout 2: a legacy .guild/indexes is still read until the upgrade removes it", () => {
  const r = root(2);
  const dir = path.join(r, ".guild", "indexes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "knowledge-recall.json"), JSON.stringify(doc));
  expect(hit(recall("zebracache", { cwd: r }))).toBe(true);
});
