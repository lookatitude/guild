/**
 * __tests__/memory-adapter-composite.test.ts — ANTI-VACUITY for the "enabled by default"
 * wiring: the host-adapter memory path (queryGuildMemory → fallbackPayload → recall) must
 * pass a config-resolved `composite` to recall when models.compositeRecall is on, NOT just
 * the recall CLI. Before this lane, fallbackPayload called recall() with no composite, so
 * flipping the default would have been a silent no-op on every host-adapter recall.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import * as recallModule from "../lib/recall";
import { queryGuildMemory, type MemoryQuery } from "../lib/memory-adapter";

function mkRepo(settings?: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-madapter-"));
  fs.mkdirSync(path.join(dir, ".guild", "wiki", "decisions"), { recursive: true });
  // a real wiki page so recall has something to scan
  fs.writeFileSync(
    path.join(dir, ".guild", "wiki", "decisions", "d1.md"),
    "---\ntype: decision\nowner: x\n---\n\nauthentication token rotation policy\n",
  );
  if (settings !== undefined) {
    fs.writeFileSync(path.join(dir, ".guild", "settings.json"), JSON.stringify(settings, null, 2));
  }
  return dir;
}
const repos: string[] = [];
afterEach(() => jest.restoreAllMocks());
afterAll(() => repos.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
const repo = (s?: unknown): string => { const d = mkRepo(s); repos.push(d); return d; };

const query = (cwd: string): MemoryQuery => ({
  cwd, query: "authentication token", capabilities: { filesystem: true },
});

describe("queryGuildMemory wires config→composite into recall (non-vacuous)", () => {
  it("passes a composite config to recall when compositeRecall is ON (default)", () => {
    const spy = jest.spyOn(recallModule, "recall");
    const cwd = repo(); // no settings → default compositeRecall=true
    queryGuildMemory(query(cwd));
    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0][1] as { composite?: { importanceGate: number } };
    expect(opts.composite).toBeDefined();
    expect(opts.composite!.importanceGate).toBe(3);
  });

  it("CONTROL — passes NO composite when compositeRecall is explicitly OFF", () => {
    const spy = jest.spyOn(recallModule, "recall");
    const cwd = repo({ models: { compositeRecall: false } });
    queryGuildMemory(query(cwd));
    expect(spy).toHaveBeenCalled();
    const opts = spy.mock.calls[0][1] as { composite?: unknown };
    expect(opts.composite).toBeUndefined();
  });

  it("honors a custom importanceGate from settings", () => {
    const spy = jest.spyOn(recallModule, "recall");
    const cwd = repo({ models: { importanceGate: 5 } });
    queryGuildMemory(query(cwd));
    const opts = spy.mock.calls[0][1] as { composite?: { importanceGate: number } };
    expect(opts.composite!.importanceGate).toBe(5);
  });
});
