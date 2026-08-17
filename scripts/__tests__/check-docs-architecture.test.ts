import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import {
  deriveSpineTables,
  diffSpine,
  findSpineInAncestors,
  parseSpineDoc,
  renderSpineSnippet,
} from "../check-docs-architecture";

const pluginRoot = path.resolve(__dirname, "../..");
const realDocCandidates = [
  path.resolve(pluginRoot, "../docs/v2/architecture/architecture-spine.html"),
  path.resolve(pluginRoot, "../../..", "docs/v2/architecture/architecture-spine.html"),
];
const realDocPath = realDocCandidates.find((candidate) => fs.existsSync(candidate));
const realHtml = realDocPath ? fs.readFileSync(realDocPath, "utf8") : undefined;
const umbrellaRoot = realDocPath ? path.resolve(path.dirname(realDocPath), "../../..") : undefined;
const scriptsDir = path.resolve(__dirname, "..");
const tsxBin = path.join(scriptsDir, "node_modules", ".bin", "tsx");
const canExerciseEacces =
  process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;

function fixtureManifest(id: string, dependsOn: string[] = []) {
  return {
    schema_version: "guild.module_manifest.v1",
    id,
    title: id,
    kind: "substrate",
    implementation_mode: "resource-only",
    description: `${id} fixture`,
    depends_on: dependsOn,
    owns: {},
  };
}

function writeDerivationFixture(manifests: Array<ReturnType<typeof fixtureManifest>>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-docs-architecture-"));
  for (const manifest of manifests) {
    const moduleDir = path.join(root, "src", "modules", manifest.id);
    fs.mkdirSync(moduleDir, { recursive: true });
    fs.writeFileSync(path.join(moduleDir, "module.manifest.json"), JSON.stringify(manifest));
  }
  fs.writeFileSync(
    path.join(root, "guild.inventory.json"),
    JSON.stringify({ commands: [], skills: [], agents: [], hooks: [], mcp_servers: [], scripts: [] }),
  );
  return root;
}

function sectionFor(html: string, dataset: string) {
  const result = diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(html));
  const section = result.sections.find((candidate) => candidate.dataset === dataset);
  if (!section) throw new Error(`missing diff section ${dataset}`);
  return section;
}

/*
 * ── RR-2 anti-vacuity harness ────────────────────────────────────────────────
 *
 * An anti-vacuity mutation must be derived from THE DOCUMENT UNDER TEST, never
 * transcribed into this file. A transcribed row rots the moment the spine
 * legitimately evolves: the `.replace()` silently no-ops and the mutation stops
 * exercising the rail. The only thing standing between that and a green-but-
 * blind gate is `expect(mutated).not.toBe(realHtml)` — which is exactly what
 * went red here (a stale `host-runtime` depends_on row and a stale
 * `258 scripts</strong>` total), and the tempting "fix" is to re-transcribe the
 * new literal and re-arm the same trap.
 *
 * So every real-document mutation below goes through `documentRow` /
 * `documentCell`, which read the document's own bytes and THROW when the anchor
 * does not resolve to exactly one row. Each mutation additionally proves:
 *   (a) the mutation changed bytes,
 *   (b) the unmutated document does NOT already carry the discrepancy, and
 *   (c) the mutated document DOES carry it.
 * (b)+(c) are a baseline-delta control, which stays valid even while an
 * unrelated user-gated DRIFT sits in the same dataset (see the note on
 * `baselineDiscrepancies`).
 */

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The verbatim header row that anchors each real-document table. */
const TABLE_HEADER: Record<string, string> = {
  "dependency edges": "<tr><th>Module</th><th>kind</th><th>depends_on</th></tr>",
  "reverse dependencies": "<tr><th>Module</th><th>depended on by</th><th>fan-in</th></tr>",
  "owned inventory":
    "<tr><th>Module</th><th>commands</th><th>skills</th><th>agents</th><th>hooks</th><th>mcp</th><th>scripts</th><th>prefixes</th></tr>",
};

/**
 * Extract `moduleId`'s row VERBATIM from the `dataset` table of `html`.
 * Throws (never returns a non-match) when the anchor is ambiguous or absent —
 * a missing anchor must be a loud failure, not a silent no-op mutation.
 */
function documentRow(html: string, dataset: string, moduleId: string): string {
  const header = TABLE_HEADER[dataset];
  if (!header) throw new Error(`no header anchor registered for dataset ${dataset}`);
  const headerAt = html.indexOf(header);
  if (headerAt < 0) throw new Error(`[${dataset}] header row not found in the document`);
  if (html.indexOf(header, headerAt + 1) >= 0) throw new Error(`[${dataset}] header row is ambiguous`);
  const tableEnd = html.indexOf("</table>", headerAt);
  if (tableEnd < 0) throw new Error(`[${dataset}] table is unterminated`);

  const table = html.slice(headerAt, tableEnd);
  const rows = table.match(new RegExp(`<tr><td>${escapeRegExp(moduleId)}</td>[\\s\\S]*?</tr>`, "g")) ?? [];
  if (rows.length !== 1) {
    throw new Error(`[${dataset}] expected exactly one row for ${moduleId}; found ${rows.length}`);
  }
  return rows[0];
}

/** The inner HTML of every `<td>` in a row, in document order. */
function rowCells(row: string): string[] {
  return [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((match) => match[1]);
}

/** The inner HTML of cell `index` of a row (0 = the module-id cell). */
function documentCell(row: string, index: number): string {
  const cells = rowCells(row);
  if (index >= cells.length) throw new Error(`row has ${cells.length} cells; no cell ${index}: ${row}`);
  return cells[index];
}

/** Rewrite cell `index` of a row, asserting the row actually changed. */
function withCell(row: string, index: number, next: string): string {
  let seen = -1;
  const mutated = row.replace(/<td>([\s\S]*?)<\/td>/g, (whole, inner: string) => {
    seen += 1;
    return seen === index ? `<td>${next}</td>` : whole;
  });
  if (seen < index) throw new Error(`row has ${seen + 1} cells; no cell ${index}: ${row}`);
  if (mutated === row) throw new Error(`cell ${index} rewrite did not change the row: ${row}`);
  return mutated;
}

/** Splice a document-derived row back into the document, asserting bytes changed. */
function withRow(html: string, original: string, mutatedRow: string): string {
  if (mutatedRow === original) throw new Error("mutated row is byte-identical to the original row");
  const mutated = html.replace(original, mutatedRow);
  if (mutated === html) throw new Error("row splice did not change the document");
  return mutated;
}

/** The integer a document cell renders, tolerating the `<strong>` emphasis the doc uses. */
function cellInteger(cell: string): number {
  const text = cell.replace(/<[^>]+>/g, "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`cell is not an integer: ${JSON.stringify(cell)}`);
  return Number(text);
}

/**
 * Discrepancies the UNMUTATED document already reports for `dataset`.
 *
 * The spine currently carries a user-gated DRIFT (the document says 287 scripts
 * / dispatch 9 / telemetry 9 where the owned manifests + `guild.inventory.json`
 * — the authority the checker names — derive 285/8/8). That baseline is user
 * WIP and is NOT this suite's to reconcile or to pin. So instead of asserting a
 * blanket `OK` on datasets that carry it, each mutation asserts its own
 * discrepancy is ABSENT from this baseline and PRESENT after the mutation. That
 * control cannot be satisfied by a no-op mutation, and it does not go red when
 * the user lands (or reverts) the WIP.
 */
function baselineDiscrepancies(html: string, dataset: string): string {
  return sectionFor(html, dataset).discrepancies.join("\n");
}

/** Assert a mutation introduced a NEW discrepancy the untouched document did not have. */
function expectNewDiscrepancy(original: string, mutated: string, dataset: string, pattern: RegExp): void {
  expect(baselineDiscrepancies(original, dataset)).not.toMatch(pattern);
  const section = sectionFor(mutated, dataset);
  expect(section.status).toBe("DRIFT");
  expect(section.discrepancies.join("\n")).toMatch(pattern);
}

describe("check:docs-architecture", () => {
  it("derives the real 31-module architecture spine and exact kind counts", () => {
    const derived = deriveSpineTables(pluginRoot);

    expect(derived.moduleCount).toBe(31);
    expect(derived.edges).toHaveLength(31);
    expect(derived.ownedInventory).toHaveLength(31);
    expect(derived.kindCounts).toEqual({
      substrate: 13,
      capability: 12,
      operator: 5,
      build: 1,
    });
  });

  if (!realHtml) {
    it.skip("parses the real umbrella HTML (skipped: architecture-spine.html is absent)", () => {});
    it.skip("detects all real-document anti-vacuity mutations (skipped: umbrella doc is absent)", () => {});
  } else {
    it("parses every architecture dataset from the real umbrella HTML", () => {
      const parsed = parseSpineDoc(realHtml);

      expect(parsed.structuralErrors).toEqual([]);
      expect(Object.keys(parsed.kindCounts)).toHaveLength(4);
      expect(parsed.edges).toHaveLength(31);
      expect(parsed.fanIn.length).toBeGreaterThan(0);
      expect(parsed.ownedInventory).toHaveLength(31);
      expect(parsed.totals).toBeDefined();

      const requiredReconciliations = [
        ["docs/v2/architecture/README.html", /31 implementation modules/, /documents\.html/, /eight tightly-coupled sibling pairs/],
        ["docs/v2/architecture/modules/documents.html", /guild\.document\.v1/, /Record-only projection/, /plugin\/src\/modules\/documents\/index\.ts/],
        ["docs/v2/conformance-and-rollback.html", /Compatibility window/, /Host adapter/, /Transport/, /Consumer/, /Receipt journal/],
        ["docs/v2/conformance-and-rollback.html", /Stable-channel scope/, /v2\.5\.0/, /31 scenarios and 5 are implemented/],
        ["docs/v2/distribution.html", /Stable-channel scope/, /v2\.5\.0/, /31 scenarios and 5 are implemented/],
        ["docs/v2/observability.html", /Stable-channel scope/, /v2\.5\.0/, /31 scenarios and 5 are implemented/],
        [".guild/wiki/decisions/multi-host-runtime-convergence.md", /status: accepted/, /Implementation shipped through MH-09/, /D8 cumulative rail/],
        ["website/src/content/docs/architecture.mdx", /31 ownership-scoped modules/, /module: 'documents'/, /Release Conformance And Rollback/],
        ["website/src/content/docs/migration-v1-to-v2.mdx", /Compatibility Window And Independent Rollback/, /Adapter rollback/, /Transport rollback/, /Consumer rollback/],
      ] as const;
      for (const [relativePath, ...patterns] of requiredReconciliations) {
        const absolutePath = path.join(umbrellaRoot!, relativePath);
        expect(fs.existsSync(absolutePath)).toBe(true);
        const body = fs.readFileSync(absolutePath, "utf8");
        for (const pattern of patterns) expect(body).toMatch(pattern);
        if (relativePath.startsWith("docs/v2/") && /Stable-channel scope/.test(body)) {
          expect(body).not.toMatch(/not in a stable release|origin\/main contains none|2\.5\.0-beta\.1/);
        }
      }
    });

    it("parses the real document's prefix cells without structural or prefix drift", () => {
      const parsed = parseSpineDoc(realHtml);
      const section = sectionFor(realHtml, "owned inventory");

      expect(parsed.structuralErrors.filter((error) => /prefix/i.test(error))).toEqual([]);
      expect(section.discrepancies.filter((error) => /prefixes/i.test(error))).toEqual([]);
    });

    it("ANTI-VACUITY edges: dropping a dependency reports DRIFT for context", () => {
      // Derived from the document: take context's own depends_on list and drop its
      // last entry, whatever that list currently is.
      const row = documentRow(realHtml, "dependency edges", "context");
      const dependsOn = documentCell(row, 2).split(",").map((entry) => entry.trim());
      expect(dependsOn.length).toBeGreaterThan(1);
      const dropped = dependsOn[dependsOn.length - 1];
      const mutated = withRow(realHtml, row, withCell(row, 2, dependsOn.slice(0, -1).join(", ")));
      expect(mutated).not.toBe(realHtml);

      expectNewDiscrepancy(
        realHtml,
        mutated,
        "dependency edges",
        new RegExp(`module context: depends_on DRIFT;.*${escapeRegExp(dropped)}`, "i"),
      );
    });

    it("ANTI-VACUITY edges: a dependency plus none is parsed as real content and reports DRIFT", () => {
      const mutated = realHtml.replace(
        "<td>kernel</td><td>substrate</td><td><em>(none — the root)</em></td>",
        "<td>kernel</td><td>substrate</td><td>bogus-dependency, none</td>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/kernel.*bogus-dependency.*none/i);
    });

    it("decodes a named em-dash entity in the root dependency sentinel", () => {
      const mutated = realHtml.replace(
        "<td>kernel</td><td>substrate</td><td><em>(none — the root)</em></td>",
        "<td>kernel</td><td>substrate</td><td><em>(none &mdash; the root)</em></td>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(section.status).toBe("OK");
      expect(section.discrepancies).toEqual([]);
    });

    it("ANTI-VACUITY fan-in: a duplicated dependant reports DRIFT and names the duplicate", () => {
      // Derived from the document: duplicate host-runtime's own first dependant.
      const row = documentRow(realHtml, "reverse dependencies", "host-runtime");
      const dependants = documentCell(row, 1).split(",").map((entry) => entry.trim());
      expect(dependants.length).toBeGreaterThan(0);
      const duplicated = dependants[0];
      const mutated = withRow(realHtml, row, withCell(row, 1, [duplicated, ...dependants].join(", ")));
      expect(mutated).not.toBe(realHtml);

      expectNewDiscrepancy(
        realHtml,
        mutated,
        "reverse dependencies",
        new RegExp(`host-runtime.*duplicate.*${escapeRegExp(duplicated)}`, "i"),
      );
    });

    it("ANTI-VACUITY identifiers: an em dash in a module id reports DRIFT", () => {
      // F-1 regression guard. This mutation used to transcribe host-runtime's whole
      // edge row (`config, lifecycle, state`); the module gained `kernel`, the
      // literal stopped matching, and the mutation silently became a no-op. Derive
      // the row from the document so the hyphen->em-dash swap always lands.
      const row = documentRow(realHtml, "dependency edges", "host-runtime");
      const mutated = withRow(realHtml, row, withCell(row, 0, "host—runtime"));
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(baselineDiscrepancies(realHtml, "dependency edges")).toBe("");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/host-runtime.*missing row/i);
      expect(section.discrepancies.join("\n")).toMatch(/host—runtime.*extra row/i);
    });

    it("ANTI-VACUITY fan-in: bumping the rendered fan-in count reports DRIFT for host-runtime", () => {
      // Was pinned to the literal `8`. Derive the documented count instead, so the
      // mutation still bites the day host-runtime gains or loses a dependant.
      const row = documentRow(realHtml, "reverse dependencies", "host-runtime");
      const documented = cellInteger(documentCell(row, 2));
      const bogus = documented + 1;
      const mutated = withRow(realHtml, row, withCell(row, 2, String(bogus)));
      expect(mutated).not.toBe(realHtml);

      expectNewDiscrepancy(
        realHtml,
        mutated,
        "reverse dependencies",
        new RegExp(`module host-runtime: fan-in DRIFT; expected \\d+; found ${bogus}`),
      );
    });

    it("ANTI-VACUITY owned inventory: changing a count reports DRIFT for config", () => {
      // Was pinned to config's whole rendered row including its `13` scripts count —
      // one new config script and the mutation silently stops mutating. Derive the
      // documented count and perturb it. Cell 6 is `scripts` (module, commands,
      // skills, agents, hooks, mcp, scripts, prefixes).
      const row = documentRow(realHtml, "owned inventory", "config");
      const documented = cellInteger(documentCell(row, 6));
      const bogus = documented + 1;
      const mutated = withRow(realHtml, row, withCell(row, 6, String(bogus)));
      expect(mutated).not.toBe(realHtml);

      expectNewDiscrepancy(
        realHtml,
        mutated,
        "owned inventory",
        new RegExp(`module config: scripts DRIFT; expected \\d+; found ${bogus}`),
      );
    });

    it("ANTI-VACUITY prefixes: residual text outside code reports DRIFT for docs-sync", () => {
      const mutated = realHtml.replace(
        /(<tr><td>docs-sync<\/td>[\s\S]*?<td><code>docs-hygiene\/<\/code>)(<\/td><\/tr>)/,
        "$1 bogus-prefix/$2",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "owned inventory");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/docs-sync.*prefixes.*bogus-prefix\//i);
    });

    it("ANTI-VACUITY totals: changing a grand total reports DRIFT for inventory scripts", () => {
      // F-2 regression guard. The SOURCE literal was pinned to `258 scripts` while
      // the document had long since moved on, so the replace no-opped. Read the
      // documented total out of the document and perturb it to a value that is
      // neither what the document says nor what the manifests derive.
      const totalsMatch = realHtml.match(/(\d+) scripts<\/strong>/);
      expect(totalsMatch).not.toBeNull();
      const documented = Number(totalsMatch![1]);
      const expectedScripts = deriveSpineTables(pluginRoot).totals.scripts;
      const bogus = Math.max(documented, expectedScripts) + 1;

      const mutated = realHtml.replace(`${documented} scripts</strong>`, `${bogus} scripts</strong>`);
      expect(mutated).not.toBe(realHtml);

      expectNewDiscrepancy(
        realHtml,
        mutated,
        "grand totals",
        new RegExp(`scripts: expected ${expectedScripts}; found ${bogus}`, "i"),
      );
    });

    // ── RR-2 planted controls: the harness itself must not be able to go vacuous ──
    //
    // F-1/F-2's root cause was a mutation built from a stale transcribed literal.
    // These controls prove the replacement machinery FAILS LOUDLY on exactly that
    // shape instead of degrading into a no-op that reports a clean document.

    it("PLANTED CONTROL: a stale/absent row anchor throws instead of silently no-opping", () => {
      expect(() => documentRow(realHtml, "dependency edges", "no-such-module")).toThrow(
        /expected exactly one row for no-such-module; found 0/i,
      );
      // The F-1 shape: a real module whose transcribed row text has gone stale.
      expect(() => withRow(realHtml, "<tr><td>host-runtime</td><td>substrate</td><td>config, lifecycle, state</td></tr>", "<tr><td>host—runtime</td></tr>")).toThrow(
        /row splice did not change the document/i,
      );
      // The F-2 shape: a mutation whose replacement equals the original.
      const row = documentRow(realHtml, "dependency edges", "host-runtime");
      expect(() => withRow(realHtml, row, row)).toThrow(/byte-identical/i);
      expect(() => withCell(row, 0, documentCell(row, 0))).toThrow(/did not change the row/i);
    });

    it("PLANTED CONTROL: the rail reports the untouched document clean on every dataset it derives", () => {
      // Datasets whose baseline is clean must be PROVED clean, so a DRIFT after a
      // mutation is attributable to the mutation and nothing else.
      for (const dataset of ["kind counts", "dependency edges", "reverse dependencies"]) {
        const section = sectionFor(realHtml, dataset);
        expect({ dataset, status: section.status, discrepancies: section.discrepancies }).toEqual({
          dataset,
          status: "OK",
          discrepancies: [],
        });
      }
      expect(parseSpineDoc(realHtml).structuralErrors).toEqual([]);
    });

    it("ANTI-VACUITY structural: deleting a whole expected table is a hard failure", () => {
      const mutated = realHtml.replace(
        /<table>\s*<thead>\s*<tr><th>Module<\/th><th>depended on by<\/th><th>fan-in<\/th><\/tr>[\s\S]*?<\/table>/,
        "",
      );
      expect(mutated).not.toBe(realHtml);

      const parsed = parseSpineDoc(mutated);
      const result = diffSpine(deriveSpineTables(pluginRoot), parsed);
      expect(result.ok).toBe(false);
      expect(parsed.structuralErrors.join("\n")).toMatch(/reverse dependencies.*table.*not found/i);
    });
  }

  it("diffs a print-style document made from the derived rows cleanly", () => {
    const derived = deriveSpineTables(pluginRoot);
    const printed = renderSpineSnippet(derived);
    const result = diffSpine(derived, parseSpineDoc(printed));

    expect(result.ok).toBe(true);
    expect(result.sections.every((section) => section.status === "OK")).toBe(true);
  });

  it("ROUND 3 multiplicity: parses a bogus module row from a second tbody", () => {
    const derived = deriveSpineTables(pluginRoot);
    const printed = renderSpineSnippet(derived);
    const closingOwnedTable = "</tbody></table>\n</section>";
    const mutated = printed.replace(
      closingOwnedTable,
      "</tbody><tbody><tr><td>bogus-module</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr></tbody></table>\n</section>",
    );
    expect(mutated).not.toBe(printed);

    const section = sectionFor(mutated, "owned inventory");
    expect(section.status).toBe("DRIFT");
    expect(section.discrepancies.join("\n")).toMatch(/bogus-module.*extra.*row/i);
  });

  it("ROUND 3 multiplicity: rejects a duplicate kind count bullet structurally", () => {
    const derived = deriveSpineTables(pluginRoot);
    const printed = renderSpineSnippet(derived);
    const substrateBullet = `<li><strong>substrate</strong> (${derived.kindCounts.substrate})</li>`;
    const mutated = printed.replace(
      substrateBullet,
      `${substrateBullet}\n<li><strong>substrate</strong> (999)</li>`,
    );
    expect(mutated).not.toBe(printed);

    const parsed = parseSpineDoc(mutated);
    const result = diffSpine(derived, parsed);
    expect(result.ok).toBe(false);
    expect(parsed.structuralErrors.join("\n")).toMatch(/kind counts.*duplicate.*substrate/i);
  });

  it("ROUND 3 multiplicity: rejects a duplicate grand-totals record structurally", () => {
    const derived = deriveSpineTables(pluginRoot);
    const printed = renderSpineSnippet(derived);
    const totals = derived.totals;
    const grandTotals = `<strong>${totals.commands} commands · ${totals.skills} skills · ${totals.agents} agents · ${totals.hooks} hooks · ${totals.mcp_servers} MCP servers · ${totals.scripts} scripts</strong>`;
    const mutated = printed.replace(
      grandTotals,
      `${grandTotals}<strong>999 commands · 999 skills · 999 agents · 999 hooks · 999 MCP servers · 999 scripts</strong>`,
    );
    expect(mutated).not.toBe(printed);

    const parsed = parseSpineDoc(mutated);
    const result = diffSpine(derived, parsed);
    expect(result.ok).toBe(false);
    expect(parsed.structuralErrors.join("\n")).toMatch(/grand totals.*duplicate/i);
  });

  it("ROUND 3 entities: treats thin-space between code prefixes as whitespace", () => {
    const derived = deriveSpineTables(pluginRoot);
    const row = derived.ownedInventory.find((candidate) => candidate.prefixes.length >= 2);
    expect(row).toBeDefined();
    const printed = renderSpineSnippet(derived);
    const adjacentPrefixes = `<code>${row!.prefixes[0]}</code> <code>${row!.prefixes[1]}</code>`;
    const mutated = printed.replace(
      adjacentPrefixes,
      `<code>${row!.prefixes[0]}</code>&thinsp;<code>${row!.prefixes[1]}</code>`,
    );
    expect(mutated).not.toBe(printed);

    const result = diffSpine(derived, parseSpineDoc(mutated));
    expect(result.ok).toBe(true);
    expect(result.sections.every((section) => section.status === "OK")).toBe(true);
  });

  it("ROUND 3 entities: preserves single-pass decoding for amp-escaped mdash", () => {
    const derived = deriveSpineTables(pluginRoot);
    const printed = renderSpineSnippet(derived);
    const mutated = printed.replace("(none — the root)", "(none &amp;mdash; the root)");
    expect(mutated).not.toBe(printed);

    const section = sectionFor(mutated, "dependency edges");
    expect(section.status).toBe("DRIFT");
    expect(section.discrepancies.join("\n")).toContain("&mdash;");
  });

  it("rejects duplicated depends_on entries in manifests during real derivation", () => {
    const root = writeDerivationFixture([
      fixtureManifest("kernel"),
      fixtureManifest("feature", ["kernel", "kernel"]),
    ]);

    try {
      expect(() => deriveSpineTables(root)).toThrow(/module feature.*duplicate depends_on.*kernel/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("derives every fan-in count from the same dependant list that is rendered", () => {
    const derived = deriveSpineTables(pluginRoot);
    for (const row of derived.fanIn) expect(row.fanIn).toBe(row.dependedOnBy.length);

    const parsed = parseSpineDoc(renderSpineSnippet(derived));
    for (const row of parsed.fanIn) expect(row.fanIn).toBe(row.dependedOnBy.length);
  });

  (canExerciseEacces ? it : it.skip)(
    "--if-present fails closed with EACCES instead of treating it as a missing document",
    () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-docs-eacces-"));
      const deniedDir = path.join(tempDir, "denied");
      const docsPath = path.join(deniedDir, "architecture-spine.html");
      fs.mkdirSync(deniedDir);
      fs.writeFileSync(docsPath, "<html></html>");
      fs.chmodSync(deniedDir, 0o000);

      try {
        const result = spawnSync(
          tsxBin,
          ["check-docs-architecture.ts", "--root", pluginRoot, "--docs", docsPath, "--if-present"],
          { cwd: scriptsDir, encoding: "utf8" },
        );
        const output = `${result.stdout}${result.stderr}`;
        expect({ status: result.status, output }).toEqual(expect.objectContaining({ status: 1 }));
        expect(output).toMatch(/EACCES/);
        expect(output).not.toContain("SKIP");
      } finally {
        fs.chmodSync(deniedDir, 0o700);
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("--if-present fails closed with ENOTDIR when a parent component is a file", () => {
    const docsPath = path.join(pluginRoot, "guild.inventory.json", "architecture-spine.html");
    const result = spawnSync(
      tsxBin,
      ["check-docs-architecture.ts", "--root", pluginRoot, "--docs", docsPath, "--if-present"],
      { cwd: scriptsDir, encoding: "utf8" },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toMatch(/ENOTDIR/);
    expect(output).not.toContain("SKIP");
  });

  // ROUND-4 anti-vacuity: a record a reader can SEE must never be invisible to the rail.
  if (realHtml) {
    const structuralErrorsFor = (html: string) => parseSpineDoc(html).structuralErrors.join("\n");

    it("ANTI-VACUITY: a row injected outside <thead>/<tbody> (a <tfoot>) is rejected, not skipped", () => {
      const closing = realHtml.indexOf("</tbody>") + "</tbody>".length;
      const mutated = `${realHtml.slice(0, closing)}<tfoot><tr><td>bogus-module</td><td>substrate</td><td>kernel</td></tr></tfoot>${realHtml.slice(closing)}`;
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(structuralErrorsFor(mutated)).toMatch(/outside <thead>\/<tbody>/i);
    });

    it("ANTI-VACUITY: a duplicated target <section> is rejected rather than first-wins", () => {
      const mutated = realHtml.replace(
        '<section id="the-four-kinds">',
        '<section id="the-four-kinds"><ul><li><strong>substrate</strong> (999)</li></ul></section><section id="the-four-kinds">',
      );
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(structuralErrorsFor(mutated)).toMatch(/exactly one section #the-four-kinds; found 2/i);
    });

    it("ANTI-VACUITY: a kind bullet carrying a second visible count is rejected", () => {
      // Derive the rendered bullet rather than pinning `(13)` — a kind-count change
      // would otherwise turn this mutation into a no-op.
      const substrate = deriveSpineTables(pluginRoot).kindCounts.substrate;
      const bullet = `<strong>substrate</strong> (${substrate})`;
      expect(realHtml).toContain(bullet);
      const mutated = realHtml.replace(bullet, `${bullet} (999)`);
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(structuralErrorsFor(mutated)).toMatch(/has 2 counts; expected exactly one/i);
    });

    it("ANTI-VACUITY: named entities are case-sensitive — &mDaSh; must not decode to an em dash", () => {
      // The rendered page would show the literal text `&mDaSh;`, so the rail must not
      // launder it into the em-dash sentinel and report the document clean.
      const mutated = realHtml.replace(/\(none — the root\)/g, "(none &mDaSh; the root)");
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(section.status).toBe("DRIFT");
    });

    it("legitimate whitespace entities between <code> prefixes do NOT false-positive", () => {
      for (const entity of ["&thinsp;", "&numsp;", "&ensp;", "&#8201;", "&#x2009;"]) {
        const mutated = realHtml.replace("<code>docs-hygiene/</code>", `<code>docs-hygiene/</code>${entity}`);
        expect(mutated).not.toBe(realHtml);

        const discrepancies = sectionFor(mutated, "owned inventory").discrepancies.join("\n");
        expect(discrepancies).not.toMatch(/prefixes/);
      }
    });

    it("ANTI-VACUITY: an extra visible <thead> row is rejected (only <tbody> rows are compared)", () => {
      const mutated = realHtml.replace(
        "<tr><th>Module</th><th>kind</th><th>depends_on</th></tr>",
        "<tr><th>Module</th><th>kind</th><th>depends_on</th></tr><tr><td>kernel</td><td>operator</td><td>bogus</td></tr>",
      );
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(parseSpineDoc(mutated).structuralErrors.join("\n")).toMatch(/exactly 1 header row; found 2/i);
    });

    it("ANTI-VACUITY: duplicate-section detection is serialization-independent (unquoted id=)", () => {
      const mutated = realHtml.replace(
        '<section id="the-four-kinds">',
        "<section id=the-four-kinds><ul><li><strong>substrate</strong> (999)</li></ul></section><section id=\"the-four-kinds\">",
      );
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(parseSpineDoc(mutated).structuralErrors.join("\n")).toMatch(/exactly one section #the-four-kinds; found 2/i);
    });

    it.each([
      ["data-id", '<section data-id=the-four-kinds>'],
      ["prefix-sharing id", '<section id="the-four-kinds-extra">'],
    ])("does not accept %s as the #the-four-kinds anchor", (_label, replacement) => {
      // \\b matches after a hyphen, so a \\bid= matcher also matched `data-id=` — a document with
      // no real anchor would satisfy the lookup and the whole dataset would go unchecked.
      const mutated = realHtml.replace('<section id="the-four-kinds">', replacement);
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
      expect(parseSpineDoc(mutated).structuralErrors.join("\n")).toMatch(/section #the-four-kinds not found/i);
    });

    it("accepts legitimate whitespace around the id attribute's = (formatter output)", () => {
      const mutated = realHtml.replace('<section id="the-four-kinds">', '<section id = "the-four-kinds">');
      expect(mutated).not.toBe(realHtml);

      const parsed = parseSpineDoc(mutated);
      expect(parsed.structuralErrors.join("\n")).not.toMatch(/section #the-four-kinds not found/i);
      expect(Object.keys(parsed.kindCounts)).toHaveLength(4);
    });

    it("ignores commented-out markup a browser would not render", () => {
      const table = realHtml.match(/<table>[\s\S]*?<\/table>/)?.[0];
      expect(table).toBeDefined();
      const mutated = realHtml.replace(table as string, `<!-- ${table} -->\n${table}`);
      expect(mutated).not.toBe(realHtml);

      // Same rendered document => same verdict as the untouched original.
      const derived = deriveSpineTables(pluginRoot);
      const before = diffSpine(derived, parseSpineDoc(realHtml));
      const after = diffSpine(derived, parseSpineDoc(mutated));
      expect(parseSpineDoc(mutated).structuralErrors).toEqual(parseSpineDoc(realHtml).structuralErrors);
      expect(after.sections.map((s) => s.status)).toEqual(before.sections.map((s) => s.status));
    });

    it.each([
      ["before the kind list", "<h2>The four kinds</h2>", '<h2>The four kinds</h2><section id="nested-note"><p>note</p></section>'],
      ["immediately after the opener", '<section id="the-four-kinds">', '<section id="the-four-kinds"><section id="inner"><p>x</p></section>'],
    ])("a legitimately nested <section> %s does not truncate the parent", (_label, from, to) => {
      // <section> nests; stopping at the first </section> would cut the parent short and report
      // false drift on a document whose rendered counts never changed.
      const mutated = realHtml.replace(from, to);
      expect(mutated).not.toBe(realHtml);

      const parsed = parseSpineDoc(mutated);
      expect(parsed.structuralErrors.join("\n")).not.toMatch(/#the-four-kinds/i);
      expect(Object.keys(parsed.kindCounts)).toHaveLength(4);
    });

    it("ANTI-VACUITY: correct markup hidden in a non-rendered <template> cannot mask a wrong table", () => {
      const table = realHtml.match(/<table>[\s\S]*?<\/table>/)?.[0];
      expect(table).toBeDefined();
      // The visible table is wrong; the correct one is parked in a <template> a browser never renders.
      const wrong = "<table><thead><tr><th>Module</th><th>kind</th><th>depends_on</th></tr></thead><tbody><tr><td>bogus-module</td><td>substrate</td><td>kernel</td></tr></tbody></table>";
      const mutated = realHtml.replace(table as string, `<template>${table}</template>${wrong}`);
      expect(mutated).not.toBe(realHtml);

      expect(diffSpine(deriveSpineTables(pluginRoot), parseSpineDoc(mutated)).ok).toBe(false);
    });
  }
});

/**
 * Umbrella-doc resolution (gap-audit C6 / P-103).
 *
 * The CLI's default resolution used to be a single level up from the plugin
 * root. In a git WORKTREE (`plugin/.worktrees/<name>`) that resolves to
 * `plugin/.worktrees`, which has no `docs/`, so the checker found nothing —
 * and because doc-sync.yml invokes it with `--if-present`, "found nothing"
 * degraded to a silent SKIP. A drift gate that reports success without reading
 * the document is worse than no gate. The ancestor walk fixes that; these
 * cases pin both the found and not-found halves.
 */
describe("check:docs-architecture — umbrella doc resolution", () => {
  const made: string[] = [];

  afterAll(() => {
    for (const dir of made.reverse()) fs.rmSync(dir, { recursive: true, force: true });
  });

  function scratch(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spine-resolve-"));
    made.push(dir);
    // realpath: macOS tmpdir is a /var -> /private/var symlink, and the walk
    // compares resolved paths.
    return fs.realpathSync(dir);
  }

  function plantSpine(umbrella: string): string {
    const docDir = path.join(umbrella, "docs", "v2", "architecture");
    fs.mkdirSync(docDir, { recursive: true });
    const file = path.join(docDir, "architecture-spine.html");
    fs.writeFileSync(file, "<!doctype html><p>fixture</p>", "utf8");
    return file;
  }

  it("finds the doc one level up (the plain-checkout layout, unchanged)", () => {
    const umbrella = scratch();
    const planted = plantSpine(umbrella);
    const pluginDir = path.join(umbrella, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });

    expect(findSpineInAncestors(pluginDir)).toBe(planted);
  });

  it("finds the doc from a nested worktree root (the case that silently SKIPped)", () => {
    const umbrella = scratch();
    const planted = plantSpine(umbrella);
    const worktree = path.join(umbrella, "plugin", ".worktrees", "some-branch");
    fs.mkdirSync(worktree, { recursive: true });

    expect(findSpineInAncestors(worktree)).toBe(planted);
  });

  it("prefers the NEAREST ancestor when two umbrellas nest", () => {
    const outer = scratch();
    plantSpine(outer);
    const inner = path.join(outer, "nested", "umbrella");
    fs.mkdirSync(inner, { recursive: true });
    const innerPlanted = plantSpine(inner);
    const pluginDir = path.join(inner, "plugin");
    fs.mkdirSync(pluginDir, { recursive: true });

    expect(findSpineInAncestors(pluginDir)).toBe(innerPlanted);
  });

  it("ANTI-VACUITY: returns undefined when no ancestor has the document", () => {
    const lonely = path.join(scratch(), "plugin");
    fs.mkdirSync(lonely, { recursive: true });

    expect(findSpineInAncestors(lonely)).toBeUndefined();
  });
});
