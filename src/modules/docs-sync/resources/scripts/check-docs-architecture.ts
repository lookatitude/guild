/**
 * scripts/check-docs-architecture.ts
 *
 * Fail-closed drift rail for the umbrella docs/v2 architecture spine. The plugin
 * manifests and guild.inventory.json are authoritative; this checker derives the
 * documented tables and compares them with architecture-spine.html. A normal
 * checkout resolves the document at <pluginRoot>/../docs/v2/... by default.
 * Missing/unparseable documentation and every discrepancy fail closed; only
 * --if-present may skip a document that is genuinely absent. --print never writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  OWNED_INVENTORY_CATEGORIES,
  loadModuleManifests,
  type ModuleKind,
  type ModuleManifest,
  type ModuleOwns,
  type OwnedInventoryCategory,
} from "./lib/module-manifest";

const KINDS: readonly ModuleKind[] = ["substrate", "capability", "operator", "build"];
const TOTAL_CATEGORIES = ["commands", "skills", "agents", "hooks", "mcp_servers", "scripts"] as const;
const PREFIX_KEYS: readonly (keyof ModuleOwns)[] = [
  "command_id_prefixes",
  "skill_id_prefixes",
  "agent_id_prefixes",
  "hook_id_prefixes",
  "mcp_server_id_prefixes",
  "script_id_prefixes",
];

export interface DependencyEdgeRow {
  module: string;
  kind: ModuleKind | string;
  dependsOn: string[];
}

export interface FanInRow {
  module: string;
  dependedOnBy: string[];
  fanIn: number;
}

export interface OwnedInventoryRow {
  module: string;
  counts: Record<OwnedInventoryCategory, number>;
  prefixes: string[];
}

export type InventoryTotals = Record<(typeof TOTAL_CATEGORIES)[number], number>;

export interface SpineTables {
  moduleCount: number;
  kindCounts: Record<ModuleKind, number>;
  edges: DependencyEdgeRow[];
  fanIn: FanInRow[];
  ownedInventory: OwnedInventoryRow[];
  totals: InventoryTotals;
}

export interface ParsedSpineDoc {
  kindCounts: Partial<Record<ModuleKind, number>>;
  edges: DependencyEdgeRow[];
  fanIn: FanInRow[];
  ownedInventory: OwnedInventoryRow[];
  totals?: InventoryTotals;
  structuralErrors: string[];
}

export type DiffStatus = "OK" | "DRIFT";

export interface DiffSection {
  dataset: string;
  status: DiffStatus;
  discrepancies: string[];
}

export interface SpineDiff {
  ok: boolean;
  sections: DiffSection[];
}

interface InventoryFile {
  commands: unknown[];
  skills: unknown[];
  agents: unknown[];
  hooks: unknown[];
  mcp_servers: unknown[];
  scripts: unknown[];
}

interface LocatedTable {
  html: string;
  headers: string[];
}

const TABLES = {
  edges: { dataset: "dependency edges", headers: ["module", "kind", "depends_on"] },
  fanIn: { dataset: "reverse dependencies", headers: ["module", "depended on by", "fan-in"] },
  owned: {
    dataset: "owned inventory",
    headers: ["module", "commands", "skills", "agents", "hooks", "mcp", "scripts", "prefixes"],
  },
} as const;

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function ownCount(manifest: ModuleManifest, category: OwnedInventoryCategory): number {
  return (manifest.owns[category] as string[] | undefined)?.length ?? 0;
}

function readInventory(root: string): InventoryFile {
  const inventoryPath = path.join(root, "guild.inventory.json");
  const parsed = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as Record<string, unknown>;
  for (const category of TOTAL_CATEGORIES) {
    if (!Array.isArray(parsed[category])) {
      throw new Error(`${path.relative(root, inventoryPath)}: ${category} must be an array`);
    }
  }
  return parsed as unknown as InventoryFile;
}

export function deriveSpineTables(root: string): SpineTables {
  const manifests = loadModuleManifests(root);
  if (manifests.length === 0) {
    throw new Error(`no module manifests found under ${path.join(root, "src", "modules")}`);
  }

  for (const manifest of manifests) {
    const seen = new Set<string>();
    for (const dependency of manifest.depends_on ?? []) {
      if (seen.has(dependency)) {
        throw new Error(`module ${manifest.id}: duplicate depends_on entry ${JSON.stringify(dependency)}`);
      }
      seen.add(dependency);
    }
  }

  const kindCounts = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<ModuleKind, number>;
  for (const manifest of manifests) kindCounts[manifest.kind] += 1;

  const edges = manifests
    .map((manifest) => ({
      module: manifest.id,
      kind: manifest.kind,
      dependsOn: sorted(manifest.depends_on ?? []),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

  const reverse = new Map<string, string[]>(manifests.map((manifest) => [manifest.id, []]));
  for (const manifest of manifests) {
    for (const dependency of manifest.depends_on ?? []) {
      const dependants = reverse.get(dependency);
      if (!dependants) throw new Error(`module ${manifest.id} depends on unknown module ${dependency}`);
      dependants.push(manifest.id);
    }
  }
  const fanIn = [...reverse.entries()]
    .map(([module, dependants]) => {
      const dependedOnBy = sorted([...new Set(dependants)]);
      return { module, dependedOnBy, fanIn: dependedOnBy.length };
    })
    .filter((row) => row.fanIn >= 1)
    .sort((a, b) => b.fanIn - a.fanIn || a.module.localeCompare(b.module));

  const ownedInventory = manifests
    .map((manifest) => ({
      module: manifest.id,
      counts: Object.fromEntries(
        OWNED_INVENTORY_CATEGORIES.map((category) => [category, ownCount(manifest, category)]),
      ) as Record<OwnedInventoryCategory, number>,
      prefixes: sorted(
        PREFIX_KEYS.flatMap((key) => (manifest.owns[key] as string[] | undefined) ?? []),
      ),
    }))
    .sort((a, b) => a.module.localeCompare(b.module));

  const inventory = readInventory(root);
  const totals = Object.fromEntries(
    TOTAL_CATEGORIES.map((category) => [category, inventory[category].length]),
  ) as InventoryTotals;

  return { moduleCount: manifests.length, kindCounts, edges, fanIn, ownedInventory, totals };
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    emsp: "\u2003",
    ensp: "\u2002",
    gt: ">",
    hairsp: "\u200a",
    hellip: "…",
    lt: "<",
    mdash: "—",
    middot: "·",
    nbsp: "\u00a0",
    ndash: "–",
    quot: '"',
    numsp: "\u2007",
    puncsp: "\u2008",
    thinsp: "\u2009",
  };
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]+));/g,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
      if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
      if (hexadecimal !== undefined) return String.fromCodePoint(parseInt(hexadecimal, 16));
      // HTML named entities are CASE-SENSITIVE. Decoding `&mDaSh;` as an em dash would let a
      // document that renders visibly-wrong text compare equal to the derived truth. Leave an
      // unrecognized name undecoded so it surfaces as drift rather than being laundered away.
      return named[name ?? ""] ?? entity;
    },
  );
}

export function normalizeHtmlIdentifier(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+/g, " ")
    .trim();
}

export function normalizeHtmlProse(value: string): string {
  return normalizeHtmlIdentifier(value).replace(/[\u2013\u2014]/g, "-");
}

function sameHeaders(found: readonly string[], expected: readonly string[]): boolean {
  return found.length === expected.length && found.every((header, index) => header === expected[index]);
}

function locateTable(
  html: string,
  dataset: string,
  expectedHeaders: readonly string[],
  errors: string[],
): LocatedTable | undefined {
  const matches: LocatedTable[] = [];
  for (const tableMatch of html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)) {
    const tableHtml = tableMatch[0];
    const thead = tableHtml.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1];
    if (!thead) continue;
    const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) =>
      normalizeHtmlProse(match[1]).toLowerCase(),
    );
    if (sameHeaders(headers, expectedHeaders)) matches.push({ html: tableHtml, headers });
  }

  if (matches.length === 0) {
    errors.push(`[${dataset}] expected table not found by header sequence: ${expectedHeaders.join(" | ")}`);
    return undefined;
  }
  if (matches.length > 1) {
    errors.push(`[${dataset}] found ${matches.length} tables with header sequence: ${expectedHeaders.join(" | ")}`);
    return undefined;
  }
  return matches[0];
}

function tableRows(table: LocatedTable, dataset: string, errors: string[]): string[][] {
  const tbodies = [...table.html.matchAll(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/gi)];
  if (tbodies.length === 0) {
    errors.push(`[${dataset}] expected table has no parseable tbody`);
    return [];
  }
  // A row a reader can SEE must never be invisible to the rail. Rows outside the accepted
  // row groups (an injected <tfoot>, or a bare <tr> after </tbody>) are rejected rather than
  // skipped — silently ignoring visible markup is exactly the vacuity this gate exists to stop.
  // <thead> carries exactly ONE row: the header. Only <tbody> rows are parsed and compared, so an
  // extra <thead> row would render visibly yet never be checked.
  const theadRows = [...table.html.matchAll(/<thead\b[^>]*>([\s\S]*?)<\/thead>/gi)]
    .flatMap((thead) => [...thead[1].matchAll(/<tr\b/gi)]).length;
  if (theadRows !== 1) {
    errors.push(`[${dataset}] expected table <thead> to hold exactly 1 header row; found ${theadRows}`);
  }
  const bodyRows = tbodies.flatMap((tbody) => [...tbody[1].matchAll(/<tr\b/gi)]).length;
  const totalRows = [...table.html.matchAll(/<tr\b/gi)].length;
  if (totalRows > theadRows + bodyRows) {
    errors.push(
      `[${dataset}] expected table has ${totalRows - theadRows - bodyRows} row(s) outside <thead>/<tbody> (e.g. <tfoot> or a stray <tr>)`,
    );
  }
  const rows: string[][] = [];
  for (const tbody of tbodies) {
    for (const rowMatch of tbody[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rowMatch[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
      if (cells.length !== table.headers.length) {
        errors.push(
          `[${dataset}] row has ${cells.length} cells; expected ${table.headers.length}: ${normalizeHtmlProse(rowMatch[0])}`,
        );
        continue;
      }
      rows.push(cells);
    }
  }
  return rows;
}

function duplicateEntries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return sorted([...duplicates]);
}

function reportDuplicateEntries(
  values: readonly string[],
  dataset: string,
  module: string,
  field: string,
  errors: string[],
): void {
  for (const duplicate of duplicateEntries(values)) {
    errors.push(`[${dataset}] module ${module}: duplicate ${field} entry ${JSON.stringify(duplicate)}`);
  }
}

function parseList(
  cell: string,
  dataset: string,
  module: string,
  field: string,
  errors: string[],
): string[] {
  const prose = normalizeHtmlProse(cell);
  if (prose === "(none - the root)") return [];
  const identifierText = normalizeHtmlIdentifier(cell);
  if (!identifierText) {
    errors.push(
      `[${dataset}] module ${module}: ${field} is empty; expected exact sentinel "(none — the root)"`,
    );
    return [];
  }
  const values = identifierText.split(",").map((item) => item.trim()).filter(Boolean);
  reportDuplicateEntries(values, dataset, module, field, errors);
  return sorted(values);
}

function parseInteger(cell: string, dataset: string, module: string, field: string, errors: string[]): number {
  const text = normalizeHtmlProse(cell);
  if (!/^\d+$/.test(text)) {
    errors.push(`[${dataset}] module ${module}: ${field} must be an integer; found ${JSON.stringify(text)}`);
    return Number.NaN;
  }
  return Number(text);
}

function parseOptionalInteger(
  cell: string,
  dataset: string,
  module: string,
  field: string,
  errors: string[],
): number {
  const text = normalizeHtmlProse(cell);
  return text === "" ? 0 : parseInteger(cell, dataset, module, field, errors);
}

function parsePrefixes(cell: string, module: string, errors: string[]): string[] {
  const codes = [...cell.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)].map((match) =>
    normalizeHtmlIdentifier(match[1]),
  );
  const residualValues = normalizeHtmlIdentifier(
    cell.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, " "),
  ).split(/[\s,;·|]+/).filter(Boolean);
  const values = codes.length > 0
    ? [...codes.filter(Boolean), ...residualValues]
    : normalizeHtmlIdentifier(cell).split(/\s+/).filter(Boolean);
  reportDuplicateEntries(values, TABLES.owned.dataset, module, "prefixes", errors);
  return sorted(values);
}

function sectionById(html: string, id: string, dataset?: string, errors?: string[]): string | undefined {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Accept every valid serialization of the attribute (double-quoted, single-quoted, unquoted) —
  // duplicate detection must not depend on how the document happens to be written.
  // \s (not \b) before `id=`: \b matches after a hyphen, so \bid= also matched `data-id=`,
  // letting a document with NO real #id anchor satisfy the section lookup.
  const opener = new RegExp(
    `<section\\b[^>]*\\sid\\s*=\\s*(?:["']${escaped}["']|${escaped}(?=[\\s/>]))[^>]*>`,
    "gi",
  );
  // <section> nests legitimately, so the element ends at its BALANCED close, not the first
  // </section>. Stopping at the first one truncates the parent and reports false drift on a
  // document whose rendered content never changed.
  const boundary = /<section\b[^>]*>|<\/section\s*>/gi;
  const matches: string[] = [];
  for (const open of html.matchAll(opener)) {
    const bodyStart = open.index! + open[0].length;
    boundary.lastIndex = bodyStart;
    let depth = 1;
    let end = -1;
    for (let token = boundary.exec(html); token; token = boundary.exec(html)) {
      depth += token[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = token.index + token[0].length;
        break;
      }
    }
    if (end === -1) {
      errors?.push(`[${dataset}] section #${id} is not closed`);
      continue;
    }
    matches.push(html.slice(open.index!, end));
  }
  // Exactly one section is the contract. A duplicate would let a second, contradictory
  // (and visibly rendered) copy hide behind the first.
  if (matches.length > 1 && errors && dataset) {
    errors.push(`[${dataset}] expected exactly one section #${id}; found ${matches.length}`);
  }
  return matches[0];
}

function assertUniqueModules(rows: readonly { module: string }[], dataset: string, errors: string[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.module)) errors.push(`[${dataset}] duplicate row for module ${row.module}`);
    seen.add(row.module);
  }
}

export function parseSpineDoc(rawHtml: string): ParsedSpineDoc {
  // The rail must see EXACTLY what a browser renders — no more, no less.
  //  - Comments: keeping a superseded table as `<!-- <table>...</table> -->` is a plausible human
  //    edit; treating it as live markup would report false DRIFT on a correct document.
  //  - <template>/<script>/<style>: their contents are NOT rendered, so correct markup hidden
  //    inside one could mask a visibly-wrong table and let the whole check pass vacuously.
  // Both directions are failures; strip all non-rendered containers before any structural match.
  const html = rawHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(template|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const structuralErrors: string[] = [];
  const kindCounts: Partial<Record<ModuleKind, number>> = {};
  const kindBulletOccurrences = Object.fromEntries(KINDS.map((kind) => [kind, 0])) as Record<ModuleKind, number>;

  const kindsSection = sectionById(html, "the-four-kinds", "kind counts", structuralErrors);
  if (!kindsSection) {
    structuralErrors.push("[kind counts] expected section #the-four-kinds not found");
  } else {
    for (const item of kindsSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
      const strong = item[1].match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1];
      const bulletText = normalizeHtmlProse(item[1]);
      const counts = [...bulletText.matchAll(/\((\d+)\)/g)].map((match) => match[1]);
      // `substrate (13) (999)` renders both numbers; taking the first would hide the second.
      if (counts.length > 1) {
        structuralErrors.push(
          `[kind counts] bullet for ${normalizeHtmlIdentifier(item[1]).slice(0, 40)} has ${counts.length} counts; expected exactly one`,
        );
      }
      const count = counts.length === 1 ? counts[0] : undefined;
      const kind = strong ? normalizeHtmlIdentifier(strong).toLowerCase() : "";
      if (KINDS.includes(kind as ModuleKind)) {
        const moduleKind = kind as ModuleKind;
        kindBulletOccurrences[moduleKind] += 1;
        if (count !== undefined && kindCounts[moduleKind] === undefined) {
          kindCounts[moduleKind] = Number(count);
        }
      }
    }
    for (const kind of KINDS) {
      if (kindBulletOccurrences[kind] > 1) {
        structuralErrors.push(
          `[kind counts] duplicate ${kind} count bullet; found ${kindBulletOccurrences[kind]}; expected exactly one`,
        );
      }
      if (kindCounts[kind] === undefined) {
        structuralErrors.push(`[kind counts] expected ${kind} count bullet not found`);
      }
    }
  }

  const edgeTable = locateTable(html, TABLES.edges.dataset, TABLES.edges.headers, structuralErrors);
  const edges: DependencyEdgeRow[] = edgeTable
    ? tableRows(edgeTable, TABLES.edges.dataset, structuralErrors).map((cells) => {
        const module = normalizeHtmlIdentifier(cells[0]);
        return {
          module,
          kind: normalizeHtmlIdentifier(cells[1]).toLowerCase(),
          dependsOn: parseList(
            cells[2],
            TABLES.edges.dataset,
            module,
            "depends_on",
            structuralErrors,
          ),
        };
      })
    : [];
  assertUniqueModules(edges, TABLES.edges.dataset, structuralErrors);

  const fanInTable = locateTable(html, TABLES.fanIn.dataset, TABLES.fanIn.headers, structuralErrors);
  const fanIn: FanInRow[] = fanInTable
    ? tableRows(fanInTable, TABLES.fanIn.dataset, structuralErrors).map((cells) => {
        const module = normalizeHtmlIdentifier(cells[0]);
        return {
          module,
          dependedOnBy: parseList(
            cells[1],
            TABLES.fanIn.dataset,
            module,
            "depended on by",
            structuralErrors,
          ),
          fanIn: parseInteger(cells[2], TABLES.fanIn.dataset, module, "fan-in", structuralErrors),
        };
      })
    : [];
  assertUniqueModules(fanIn, TABLES.fanIn.dataset, structuralErrors);

  const ownedTable = locateTable(html, TABLES.owned.dataset, TABLES.owned.headers, structuralErrors);
  const ownedInventory: OwnedInventoryRow[] = ownedTable
    ? tableRows(ownedTable, TABLES.owned.dataset, structuralErrors).map((cells) => {
        const module = normalizeHtmlIdentifier(cells[0]);
        const values = cells.slice(1, 7);
        return {
          module,
          counts: {
            commands: parseOptionalInteger(values[0], TABLES.owned.dataset, module, "commands", structuralErrors),
            skills: parseOptionalInteger(values[1], TABLES.owned.dataset, module, "skills", structuralErrors),
            agents: parseOptionalInteger(values[2], TABLES.owned.dataset, module, "agents", structuralErrors),
            hooks: parseOptionalInteger(values[3], TABLES.owned.dataset, module, "hooks", structuralErrors),
            mcp_servers: parseOptionalInteger(values[4], TABLES.owned.dataset, module, "mcp", structuralErrors),
            scripts: parseOptionalInteger(values[5], TABLES.owned.dataset, module, "scripts", structuralErrors),
          },
          prefixes: parsePrefixes(cells[7], module, structuralErrors),
        };
      })
    : [];
  assertUniqueModules(ownedInventory, TABLES.owned.dataset, structuralErrors);

  let totals: InventoryTotals | undefined;
  const ownedSection = sectionById(html, "owned-inventory-totals-per-module", "grand totals", structuralErrors);
  if (!ownedSection) {
    structuralErrors.push("[grand totals] expected section #owned-inventory-totals-per-module not found");
  } else {
    const totalsRecords: InventoryTotals[] = [];
    for (const strongMatch of ownedSection.matchAll(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi)) {
      const text = normalizeHtmlProse(strongMatch[1]);
      const match = text.match(
        /^(\d+) commands\s*·\s*(\d+) skills\s*·\s*(\d+) agents\s*·\s*(\d+) hooks\s*·\s*(\d+) MCP servers\s*·\s*(\d+) scripts$/i,
      );
      if (match) {
        totalsRecords.push({
          commands: Number(match[1]),
          skills: Number(match[2]),
          agents: Number(match[3]),
          hooks: Number(match[4]),
          mcp_servers: Number(match[5]),
          scripts: Number(match[6]),
        });
      }
    }
    if (totalsRecords.length === 0) {
      structuralErrors.push("[grand totals] expected inventory grand-totals prose not found");
    } else {
      totals = totalsRecords[0];
      if (totalsRecords.length > 1) {
        structuralErrors.push(
          `[grand totals] duplicate inventory grand-totals records; found ${totalsRecords.length}; expected exactly one`,
        );
      }
    }
  }

  return { kindCounts, edges, fanIn, ownedInventory, totals, structuralErrors };
}

function formatSet(values: readonly string[]): string {
  return values.length > 0 ? `[${sorted(values).join(", ")}]` : "[]";
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rowsByModule<T extends { module: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.module, row]));
}

function structuralFor(parsed: ParsedSpineDoc, dataset: string): string[] {
  return parsed.structuralErrors
    .filter((error) => error.startsWith(`[${dataset}]`))
    .map((error) => error.replace(/^\[[^\]]+\]\s*/, ""));
}

export function diffSpine(expected: SpineTables, found: ParsedSpineDoc): SpineDiff {
  const sections: DiffSection[] = [];

  const kindDiscrepancies = structuralFor(found, "kind counts");
  for (const kind of KINDS) {
    if (found.kindCounts[kind] !== expected.kindCounts[kind]) {
      kindDiscrepancies.push(
        `${kind}: expected ${expected.kindCounts[kind]}; found ${found.kindCounts[kind] ?? "(missing)"}`,
      );
    }
  }
  sections.push({
    dataset: "kind counts",
    status: kindDiscrepancies.length ? "DRIFT" : "OK",
    discrepancies: kindDiscrepancies,
  });

  const edgeDiscrepancies = structuralFor(found, TABLES.edges.dataset);
  const expectedEdges = rowsByModule(expected.edges);
  const foundEdges = rowsByModule(found.edges);
  for (const [module, row] of expectedEdges) {
    const actual = foundEdges.get(module);
    if (!actual) {
      edgeDiscrepancies.push(`module ${module}: missing row; expected kind ${row.kind}, depends_on ${formatSet(row.dependsOn)}`);
      continue;
    }
    if (actual.kind !== row.kind) {
      edgeDiscrepancies.push(`module ${module}: kind DRIFT; expected ${row.kind}; found ${actual.kind}`);
    }
    if (!sameSet(actual.dependsOn, row.dependsOn)) {
      edgeDiscrepancies.push(
        `module ${module}: depends_on DRIFT; expected ${formatSet(row.dependsOn)}; found ${formatSet(actual.dependsOn)}`,
      );
    }
  }
  for (const [module, row] of foundEdges) {
    if (!expectedEdges.has(module)) {
      edgeDiscrepancies.push(`module ${module}: extra row; found kind ${row.kind}, depends_on ${formatSet(row.dependsOn)}`);
    }
  }
  sections.push({
    dataset: TABLES.edges.dataset,
    status: edgeDiscrepancies.length ? "DRIFT" : "OK",
    discrepancies: edgeDiscrepancies,
  });

  const fanInDiscrepancies = structuralFor(found, TABLES.fanIn.dataset);
  const expectedFanIn = rowsByModule(expected.fanIn);
  const foundFanIn = rowsByModule(found.fanIn);
  for (const [module, row] of expectedFanIn) {
    const actual = foundFanIn.get(module);
    if (!actual) {
      fanInDiscrepancies.push(
        `module ${module}: missing row; expected depended on by ${formatSet(row.dependedOnBy)}, fan-in ${row.fanIn}`,
      );
      continue;
    }
    if (!sameSet(actual.dependedOnBy, row.dependedOnBy)) {
      fanInDiscrepancies.push(
        `module ${module}: depended on by DRIFT; expected ${formatSet(row.dependedOnBy)}; found ${formatSet(actual.dependedOnBy)}`,
      );
    }
    if (actual.fanIn !== row.fanIn) {
      fanInDiscrepancies.push(`module ${module}: fan-in DRIFT; expected ${row.fanIn}; found ${actual.fanIn}`);
    }
    if (actual.fanIn !== actual.dependedOnBy.length) {
      fanInDiscrepancies.push(
        `module ${module}: found fan-in ${actual.fanIn} does not equal found dependant-list length ${actual.dependedOnBy.length}`,
      );
    }
  }
  for (const [module, row] of foundFanIn) {
    if (!expectedFanIn.has(module)) {
      fanInDiscrepancies.push(
        `module ${module}: extra reverse-dependency row; expected absent (fan-in 0); found fan-in ${row.fanIn}`,
      );
    }
  }
  sections.push({
    dataset: TABLES.fanIn.dataset,
    status: fanInDiscrepancies.length ? "DRIFT" : "OK",
    discrepancies: fanInDiscrepancies,
  });

  const ownedDiscrepancies = structuralFor(found, TABLES.owned.dataset);
  const expectedOwned = rowsByModule(expected.ownedInventory);
  const foundOwned = rowsByModule(found.ownedInventory);
  for (const [module, row] of expectedOwned) {
    const actual = foundOwned.get(module);
    if (!actual) {
      ownedDiscrepancies.push(`module ${module}: missing owned-inventory row`);
      continue;
    }
    for (const category of OWNED_INVENTORY_CATEGORIES) {
      if (actual.counts[category] !== row.counts[category]) {
        const label = category === "mcp_servers" ? "mcp" : category;
        ownedDiscrepancies.push(
          `module ${module}: ${label} DRIFT; expected ${row.counts[category]}; found ${actual.counts[category]}`,
        );
      }
    }
    if (!sameSet(actual.prefixes, row.prefixes)) {
      ownedDiscrepancies.push(
        `module ${module}: prefixes DRIFT; expected ${formatSet(row.prefixes)}; found ${formatSet(actual.prefixes)}`,
      );
    }
  }
  for (const [module] of foundOwned) {
    if (!expectedOwned.has(module)) ownedDiscrepancies.push(`module ${module}: extra owned-inventory row`);
  }
  sections.push({
    dataset: TABLES.owned.dataset,
    status: ownedDiscrepancies.length ? "DRIFT" : "OK",
    discrepancies: ownedDiscrepancies,
  });

  const totalDiscrepancies = structuralFor(found, "grand totals");
  for (const category of TOTAL_CATEGORIES) {
    const actual = found.totals?.[category];
    if (actual !== expected.totals[category]) {
      const label = category === "mcp_servers" ? "MCP servers" : category;
      totalDiscrepancies.push(
        `${label}: expected ${expected.totals[category]}; found ${actual ?? "(missing)"}`,
      );
    }
  }
  sections.push({
    dataset: "grand totals",
    status: totalDiscrepancies.length ? "DRIFT" : "OK",
    discrepancies: totalDiscrepancies,
  });

  return { ok: sections.every((section) => section.status === "OK"), sections };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function countCell(value: number): string {
  return value === 0 ? "" : String(value);
}

export function renderSpineSnippet(derived: SpineTables): string {
  const kinds = KINDS.map(
    (kind) => `<li><strong>${kind}</strong> (${derived.kindCounts[kind]})</li>`,
  ).join("\n");
  const edges = derived.edges
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.module)}</td><td>${row.kind}</td><td>${
          row.dependsOn.length ? row.dependsOn.map(escapeHtml).join(", ") : "<em>(none — the root)</em>"
        }</td></tr>`,
    )
    .join("\n");
  const fanIn = derived.fanIn
    .map(
      (row, index) =>
        `<tr><td>${escapeHtml(row.module)}</td><td>${row.dependedOnBy
          .map(escapeHtml)
          .join(", ")}</td><td>${index === 0 ? `<strong>${row.fanIn}</strong>` : row.fanIn}</td></tr>`,
    )
    .join("\n");
  const owned = derived.ownedInventory
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.module)}</td>${OWNED_INVENTORY_CATEGORIES.map(
          (category) => `<td>${countCell(row.counts[category])}</td>`,
        ).join("")}<td>${row.prefixes.map((prefix) => `<code>${escapeHtml(prefix)}</code>`).join(" ")}</td></tr>`,
    )
    .join("\n");
  const totals = derived.totals;

  return [
    '<section id="the-four-kinds">',
    "<ul>",
    kinds,
    "</ul>",
    "</section>",
    "<!-- dependency edges rows -->",
    "<table><thead><tr><th>Module</th><th>kind</th><th>depends_on</th></tr></thead><tbody>",
    edges,
    "</tbody></table>",
    "<!-- reverse dependencies rows (fan-in >= 1 only) -->",
    "<table><thead><tr><th>Module</th><th>depended on by</th><th>fan-in</th></tr></thead><tbody>",
    fanIn,
    "</tbody></table>",
    '<section id="owned-inventory-totals-per-module">',
    `<p><strong>${totals.commands} commands · ${totals.skills} skills · ${totals.agents} agents · ${totals.hooks} hooks · ${totals.mcp_servers} MCP servers · ${totals.scripts} scripts</strong></p>`,
    "<!-- owned inventory rows -->",
    "<table><thead><tr><th>Module</th><th>commands</th><th>skills</th><th>agents</th><th>hooks</th><th>mcp</th><th>scripts</th><th>prefixes</th></tr></thead><tbody>",
    owned,
    "</tbody></table>",
    "</section>",
  ].join("\n");
}

interface CliOptions {
  root: string;
  docs?: string;
  ifPresent: boolean;
  print: boolean;
}

function valueAfter(args: readonly string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${args[index]} requires a path`);
  return value;
}

function parseArgs(args: readonly string[]): CliOptions {
  let root = path.resolve(__dirname, "..");
  let docs: string | undefined;
  let ifPresent = false;
  let print = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--root") root = path.resolve(valueAfter(args, index++));
    else if (token === "--docs") docs = path.resolve(valueAfter(args, index++));
    else if (token === "--if-present") ifPresent = true;
    else if (token === "--print") print = true;
    else throw new Error(`unknown argument ${token}`);
  }
  return { root, docs, ifPresent, print };
}

function resolveDocsPath(options: CliOptions): string {
  if (options.docs) return options.docs;
  if (process.env.GUILD_UMBRELLA_DOCS) return path.resolve(process.env.GUILD_UMBRELLA_DOCS);
  if (process.env.GUILD_UMBRELLA_ROOT) {
    return path.resolve(
      process.env.GUILD_UMBRELLA_ROOT,
      "docs/v2/architecture/architecture-spine.html",
    );
  }
  return path.resolve(options.root, "../docs/v2/architecture/architecture-spine.html");
}

function errnoCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code) return code;
  }
  return "UNKNOWN";
}

function readArchitectureDoc(docsPath: string, ifPresent: boolean): string | undefined {
  try {
    const stat = fs.statSync(docsPath);
    if (!stat.isFile()) {
      const error = new Error("path is not a regular file") as NodeJS.ErrnoException;
      error.code = stat.isDirectory() ? "EISDIR" : "EINVAL";
      throw error;
    }
    return fs.readFileSync(docsPath, "utf8");
  } catch (error) {
    const code = errnoCode(error);
    // Only ENOENT proves genuine absence. Broken or inaccessible paths must fail closed.
    if (ifPresent && code === "ENOENT") return undefined;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read architecture doc (${code}): ${docsPath}: ${message}`);
  }
}

export function main(args: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseArgs(args);
    const derived = deriveSpineTables(options.root);
    if (options.print) {
      console.log(renderSpineSnippet(derived));
      return 0;
    }

    const docsPath = resolveDocsPath(options);
    const html = readArchitectureDoc(docsPath, options.ifPresent);
    if (html === undefined) {
      console.log(`check:docs-architecture: SKIP — architecture doc is missing: ${docsPath}`);
      return 0;
    }

    const parsed = parseSpineDoc(html);
    const diff = diffSpine(derived, parsed);
    for (const section of diff.sections) {
      console.log(`${section.dataset}: ${section.status}`);
      for (const discrepancy of section.discrepancies) console.log(`  - ${discrepancy}`);
    }
    const discrepancyCount = diff.sections.reduce(
      (count, section) => count + section.discrepancies.length,
      0,
    );
    const driftedDatasets = diff.sections.filter((section) => section.status === "DRIFT").length;
    console.log(
      diff.ok
        ? "check:docs-architecture: OK — all 5 architecture datasets match"
        : `check:docs-architecture: DRIFT — ${discrepancyCount} discrepancy(s) across ${driftedDatasets} dataset(s)`,
    );
    return diff.ok ? 0 : 1;
  } catch (error) {
    console.error(`check:docs-architecture: ERROR — ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
