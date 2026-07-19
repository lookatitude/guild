/**
 * scripts/__tests__/wiki-lint-labels.test.ts
 *
 * Wiki label taxonomy + label-coverage lint check (docs/v2/knowledge-memory.html
 * §Label Schema; deferred item 5). Verifies:
 *   - readLabelTaxonomy parses `.guild/project.yaml → label_taxonomy` (null when absent),
 *   - the check is INERT until a taxonomy is authored (no findings on opt-out repos),
 *   - durable pages missing non-empty domain/concern/status → label-coverage,
 *   - values outside the closed set → label-unknown,
 *   - structural / provenance pages are exempt.
 * Real path (temp repo, real fs, real lintWiki()).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintWiki, readLabelTaxonomy } from "../wiki-lint-checks";

function mkRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-wiki-labels-"));
}
function write(root: string, rel: string, body: string): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}
const TAXONOMY =
  "label_taxonomy:\n" +
  "  domain: [auth, billing]\n" +
  "  concern: [security, performance]\n" +
  "  status: [active, draft]\n";

function page(importance: string, labelsYaml?: string): string {
  const labels = labelsYaml ? `labels:\n${labelsYaml}` : "";
  return `---\nimportance: ${importance}\n${labels}---\n\n# Page\n\nbody.\n`;
}

describe("readLabelTaxonomy", () => {
  test("absent project.yaml → null", () => {
    expect(readLabelTaxonomy(mkRepo())).toBeNull();
  });
  test("present taxonomy → parsed closed sets", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", TAXONOMY);
    const tax = readLabelTaxonomy(r)!;
    expect(tax).not.toBeNull();
    expect(tax.domain.has("auth")).toBe(true);
    expect(tax.concern.has("security")).toBe(true);
    expect(tax.status.has("active")).toBe(true);
  });
  test("empty/missing label_taxonomy → null (inert)", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", "name: demo\n");
    expect(readLabelTaxonomy(r)).toBeNull();
  });
});

describe("label-coverage lint check", () => {
  test("INERT without a taxonomy — a durable page with no labels gets no label finding", () => {
    const r = mkRepo();
    write(r, ".guild/wiki/decisions/d.md", page("high"));
    const findings = lintWiki(r);
    expect(findings.filter((f) => f.check.startsWith("label-"))).toEqual([]);
  });

  test("durable page missing domain/concern/status → label-coverage", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", TAXONOMY);
    write(r, ".guild/wiki/decisions/d.md", page("high"));
    const labelFindings = lintWiki(r).filter((f) => f.check === "label-coverage");
    expect(labelFindings).toHaveLength(1);
    expect(labelFindings[0].detail).toMatch(/domain, concern, status/);
  });

  test("fully + validly labelled durable page → no label finding", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", TAXONOMY);
    write(
      r,
      ".guild/wiki/decisions/d.md",
      page("high", "  domain: [auth]\n  concern: [security]\n  status: active\n"),
    );
    expect(lintWiki(r).filter((f) => f.check.startsWith("label-"))).toEqual([]);
  });

  test("value outside the closed set → label-unknown", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", TAXONOMY);
    write(
      r,
      ".guild/wiki/decisions/d.md",
      page("high", "  domain: [nope]\n  concern: [security]\n  status: active\n"),
    );
    const unknown = lintWiki(r).filter((f) => f.check === "label-unknown");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].detail).toMatch(/domain value "nope"/);
  });

  test("provenance page is exempt from the label check", () => {
    const r = mkRepo();
    write(r, ".guild/project.yaml", TAXONOMY);
    // research/ path segment ⇒ provenance ⇒ not durable.
    write(r, ".guild/wiki/research/note.md", page("high"));
    expect(lintWiki(r).filter((f) => f.check.startsWith("label-"))).toEqual([]);
  });
});
