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
        [".guild/wiki/decisions/multi-host-runtime-convergence.md", /status: accepted/, /Implementation shipped through MH-09/, /D8 cumulative rail/],
        ["website/src/content/docs/architecture.mdx", /31 ownership-scoped modules/, /module: 'documents'/, /Release Conformance And Rollback/],
        ["website/src/content/docs/migration-v1-to-v2.mdx", /Compatibility Window And Independent Rollback/, /Adapter rollback/, /Transport rollback/, /Consumer rollback/],
      ] as const;
      for (const [relativePath, ...patterns] of requiredReconciliations) {
        const absolutePath = path.join(umbrellaRoot!, relativePath);
        expect(fs.existsSync(absolutePath)).toBe(true);
        const body = fs.readFileSync(absolutePath, "utf8");
        for (const pattern of patterns) expect(body).toMatch(pattern);
      }
    });

    it("parses the real document's prefix cells without structural or prefix drift", () => {
      const parsed = parseSpineDoc(realHtml);
      const section = sectionFor(realHtml, "owned inventory");

      expect(parsed.structuralErrors.filter((error) => /prefix/i.test(error))).toEqual([]);
      expect(section.discrepancies.filter((error) => /prefixes/i.test(error))).toEqual([]);
    });

    it("ANTI-VACUITY edges: dropping a dependency reports DRIFT for context", () => {
      const mutated = realHtml.replace(
        "<td>config, knowledge, learning, security, state, telemetry</td>",
        "<td>config, knowledge, learning, security, state</td>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/context.*DRIFT|context.*expected/i);
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
      const mutated = realHtml.replace(
        "<td>capability, config, dispatch, distribution, lifecycle, prompting, review, security</td>",
        "<td>capability, capability, config, dispatch, distribution, lifecycle, prompting, review, security</td>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "reverse dependencies");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/host-runtime.*duplicate.*capability/i);
    });

    it("ANTI-VACUITY identifiers: an em dash in a module id reports DRIFT", () => {
      const mutated = realHtml.replace(
        "<tr><td>host-runtime</td><td>substrate</td><td>config, lifecycle, state</td></tr>",
        "<tr><td>host—runtime</td><td>substrate</td><td>config, lifecycle, state</td></tr>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "dependency edges");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/host-runtime.*missing row/i);
      expect(section.discrepancies.join("\n")).toMatch(/host—runtime.*extra row/i);
    });

    it("ANTI-VACUITY fan-in: changing 8 to 9 reports DRIFT for host-runtime", () => {
      const mutated = realHtml.replace(
        /(<tr><td>host-runtime<\/td><td>[\s\S]*?<\/td><td>)8(<\/td><\/tr>)/,
        "$19$2",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "reverse dependencies");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/host-runtime.*9/);
    });

    it("ANTI-VACUITY owned inventory: changing a count reports DRIFT for config", () => {
      const mutated = realHtml.replace(
        "<tr><td>config</td><td>1</td><td></td><td></td><td></td><td></td><td>13</td>",
        "<tr><td>config</td><td>1</td><td></td><td></td><td></td><td></td><td>12</td>",
      );
      expect(mutated).not.toBe(realHtml);

      const section = sectionFor(mutated, "owned inventory");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(/config.*scripts.*12/);
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
      const mutated = realHtml.replace("258 scripts</strong>", "257 scripts</strong>");
      expect(mutated).not.toBe(realHtml);

      // The derived script total tracks the live inventory, so assert against the
      // derivation rather than pinning a number that every new script would break.
      const expectedScripts = deriveSpineTables(pluginRoot).totals.scripts;
      const section = sectionFor(mutated, "grand totals");
      expect(section.status).toBe("DRIFT");
      expect(section.discrepancies.join("\n")).toMatch(
        new RegExp(`scripts.*expected ${expectedScripts}.*found 257`, "i"),
      );
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
      const mutated = realHtml.replace("<strong>substrate</strong> (13)", "<strong>substrate</strong> (13) (999)");
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
