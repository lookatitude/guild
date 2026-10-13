/**
 * src/domains/distribution/check-domain-ownership.ts
 *
 * `npm run check:modules` after the T12 fold: the DOMAIN-ownership check.
 *
 * The pre-fold check proved that every host surface had exactly one owning
 * module and that cross-module imports went through `index.ts`. Both halves
 * survive; what changes is the code half. TypeScript now lives in
 * `src/domains/<id>/` and the question is no longer "which module declared this
 * file" but "is every domain file owned exactly once" — one tree, one owner, no
 * second copy left behind in the retired `src/modules/<id>/workflows/`.
 *
 * Failures here are layout defects (KTD1, KTD27, KTD36), not style notes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { buildInventory, PLUGIN_ROOT } from "./build-inventory";
import { ADAPTER_TREE, DOMAIN_IDS, MODULE_TO_DOMAIN, domainTree } from "./domain-fold";
import {
  formatModuleHealthValidation,
  formatOwnershipValidation,
  loadModuleManifests,
  moduleManifestFiles,
  validateModuleHealth,
  validateModuleOwnership,
} from "../kernel";

export interface DomainOwnershipViolation {
  rule:
    | "unknown_domain"
    | "missing_domain"
    | "missing_domain_index"
    | "workflows_tree"
    | "module_holds_implementation"
    | "retired_module_tree"
    | "misplaced_module_manifest"
    | "unmapped_module"
    | "unclaimed_domain"
    | "duplicate_file_owner";
  detail: string;
}

export interface DomainOwnershipResult {
  ok: boolean;
  domains: number;
  files: number;
  violations: DomainOwnershipViolation[];
}

const toPosix = (value: string): string => value.split(path.sep).join("/");

function listDirs(abs: string): string[] {
  try {
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function walkTs(abs: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) walkTs(p, out);
    else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function walkFiles(abs: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(abs, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** Trees a shim may re-export from: the twelve domains, plus the adapter tree
 * that `host-runtime` folded into (KTD4). Never another module. */
const isShimTarget = (target: string): boolean =>
  target === ADAPTER_TREE || target.startsWith(`${ADAPTER_TREE}/`) || target.startsWith("src/domains/");

type ShimToken = { kind: "str" | "id" | "punct"; text: string };

/**
 * Lex a shim candidate into string literals, identifiers and punctuation with
 * comments dropped. Strings are recognised BEFORE comments, so a string that
 * spells `/*` or `*\/` can never open or close a comment (codex G-lane r2: a
 * regex stripper erased an implementation hidden between two such re-exports).
 * Template literals are lexed as strings and refused by the grammar below.
 */
const isLineTerminator = (c: string): boolean => c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029";
const isShimSpace = (c: string): boolean => isLineTerminator(c) || /\s/.test(c);

function lexShim(src: string): ShimToken[] {
  const out: ShimToken[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (isShimSpace(c)) { i++; continue; }
    // A line comment ends at ANY ECMAScript line terminator (LF, CR, U+2028,
    // U+2029), not only LF: a declaration after "// …<CR>" is a new line to the
    // engine and must be a new statement here (codex G-lane r3).
    if (c === "/" && src[i + 1] === "/") { while (i < n && !isLineTerminator(src[i]!)) i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      if (j === -1) { out.push({ kind: "punct", text: "/*" }); i = n; continue; } // unterminated: refused by the grammar
      i = j + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; j++; }
      out.push({ kind: "str", text: c === "`" ? "`" + src.slice(i + 1, j) : src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(src[j]!)) j++;
      out.push({ kind: "id", text: src.slice(i, j) });
      i = j;
      continue;
    }
    out.push({ kind: "punct", text: c });
    i++;
  }
  return out;
}

/**
 * A shim is a file whose statements are ONLY `export … from` / `export * from`
 * (value or type) naming a domain or the adapter tree. Returns why `abs` is not
 * one, or null when it is.
 *
 * Grammar (one statement): `export` [`type`] (`*` [`as` name] | `{` [item {, item} [,]] `}`)
 * `from` "specifier" [`;`] where item = [`type`] name [`as` name] and name is an
 * identifier or a string literal. Anything else is an implementation.
 */
export function shimDefect(root: string, abs: string): string | null {
  const toks = lexShim(fs.readFileSync(abs, "utf8"));
  if (toks.length === 0) return "it re-exports nothing";
  let i = 0;
  const at = (k: number): ShimToken | undefined => toks[k];
  const isId = (t: ShimToken | undefined, text?: string): boolean =>
    t !== undefined && t.kind === "id" && (text === undefined || t.text === text);
  const isPunct = (t: ShimToken | undefined, text: string): boolean =>
    t !== undefined && t.kind === "punct" && t.text === text;
  const isName = (t: ShimToken | undefined): boolean =>
    t !== undefined && (t.kind === "id" || (t.kind === "str" && !t.text.startsWith("`")));
  const excerpt = (k: number): string => toks.slice(k, k + 8).map((t) => (t.kind === "str" ? JSON.stringify(t.text) : t.text)).join(" ").slice(0, 60);

  while (i < toks.length) {
    const start = i;
    if (!isId(at(i), "export")) return `statement is not a re-export: ${excerpt(start)}`;
    i++;
    if (isId(at(i), "type")) i++;
    if (isPunct(at(i), "*")) {
      i++;
      if (isId(at(i), "as")) { i++; if (!isName(at(i))) return `statement is not a re-export: ${excerpt(start)}`; i++; }
    } else if (isPunct(at(i), "{")) {
      i++;
      while (!isPunct(at(i), "}")) {
        if (isId(at(i), "type")) i++;
        if (!isName(at(i))) return `statement is not a re-export: ${excerpt(start)}`;
        i++;
        if (isId(at(i), "as")) { i++; if (!isName(at(i))) return `statement is not a re-export: ${excerpt(start)}`; i++; }
        if (isPunct(at(i), ",")) i++;
        else if (!isPunct(at(i), "}")) return `statement is not a re-export: ${excerpt(start)}`;
      }
      i++;
    } else {
      return `statement is not a re-export: ${excerpt(start)}`;
    }
    if (!isId(at(i), "from")) return `statement is not a re-export: ${excerpt(start)}`;
    i++;
    const spec = at(i);
    if (spec === undefined || spec.kind !== "str" || spec.text.startsWith("`")) return "re-export specifier is not a string literal";
    i++;
    if (isPunct(at(i), ";")) i++;
    // The specifier is compared UNDECODED, so an escape sequence could spell a
    // different path than the one checked ("\x2e\x2e/" is "../" to the engine,
    // codex G-lane r4). No real shim escapes anything: refuse the backslash.
    if (spec.text.includes("\\")) return `re-export specifier contains an escape sequence: ${spec.text}`;
    if (!spec.text.startsWith(".")) return `re-exports from a package specifier: ${spec.text}`;
    const target = toPosix(path.relative(root, path.resolve(path.dirname(abs), spec.text)));
    if (!isShimTarget(target)) {
      return `re-exports from ${target}, not a domain`;
    }
  }
  return null;
}

/**
 * Every domain file is owned exactly once. The ownership key is the tree the
 * file sits in, so a file that also still exists under the retired module tree
 * has two owners and fails.
 */
export function validateDomainOwnership(root: string = PLUGIN_ROOT): DomainOwnershipResult {
  const violations: DomainOwnershipViolation[] = [];
  const expected = new Set(DOMAIN_IDS);

  const present = listDirs(path.join(root, "src", "domains"));
  for (const d of present) {
    if (!expected.has(d)) {
      violations.push({ rule: "unknown_domain", detail: `src/domains/${d} is not one of the twelve domains (KTD1)` });
    }
  }
  for (const d of DOMAIN_IDS) {
    if (!present.includes(d)) {
      violations.push({ rule: "missing_domain", detail: `src/domains/${d} does not exist` });
      continue;
    }
    if (!fs.existsSync(path.join(root, "src", "domains", d, "index.ts"))) {
      violations.push({ rule: "missing_domain_index", detail: `src/domains/${d}/index.ts is missing (KTD27)` });
    }
  }
  if (!fs.existsSync(path.join(root, ADAPTER_TREE, "index.ts"))) {
    violations.push({ rule: "missing_domain_index", detail: `${ADAPTER_TREE}/index.ts is missing (KTD4)` });
  }

  // Ownership: one tree, one owner. A file still present under the retired
  // `workflows/` tree is a second copy, which is what KTD36 forbids.
  const owner = new Map<string, string>();
  let files = 0;
  for (const tree of [...DOMAIN_IDS.map(domainTree), ADAPTER_TREE]) {
    for (const abs of walkTs(path.join(root, tree))) {
      const rel = toPosix(path.relative(path.join(root, tree), abs));
      files += 1;
      const prior = owner.get(rel);
      if (prior && prior !== tree) {
        violations.push({ rule: "duplicate_file_owner", detail: `${rel} is owned by both ${prior} and ${tree}` });
      }
    }
  }

  // T16 retired src/modules: each ownership manifest sits beside its fold
  // domain, so a manifest in another tree is a second home for the module.
  for (const { id, path: abs } of moduleManifestFiles(root)) {
    const domain = MODULE_TO_DOMAIN.get(id);
    const rel = toPosix(path.relative(root, abs));
    if (!domain) {
      violations.push({ rule: "unmapped_module", detail: `${rel}: module ${id} has no domain home in the KTD36 fold` });
      continue;
    }
    const expected = `${domainTree(domain)}/modules/${id}.manifest.json`;
    if (rel !== expected) {
      violations.push({ rule: "misplaced_module_manifest", detail: `${rel} belongs at ${expected}` });
    }
  }
  // Nothing may come back under the retired tree. A .ts file there is a second
  // home for code that belongs in a domain; anything else is a leftover.
  const modulesDir = path.join(root, "src", "modules");
  for (const abs of walkFiles(modulesDir)) {
    const rel = toPosix(path.relative(root, abs));
    const id = toPosix(path.relative(modulesDir, abs)).split("/")[0];
    const domain = MODULE_TO_DOMAIN.get(id);
    if (/\.ts$/.test(abs)) {
      violations.push({
        rule: "module_holds_implementation",
        detail: `${rel} is TypeScript in the retired module tree; it belongs in ${domain ? domainTree(domain) : "a domain"}`,
      });
    } else {
      violations.push({ rule: "retired_module_tree", detail: `${rel} sits in the retired src/modules tree` });
    }
  }
  const claimed = new Set<string>();
  for (const domain of MODULE_TO_DOMAIN.values()) claimed.add(domain);
  for (const d of DOMAIN_IDS) {
    if (!claimed.has(d)) {
      violations.push({ rule: "unclaimed_domain", detail: `no module folds into ${d}; the KTD36 map is not surjective` });
    }
  }

  for (const tree of ["src", "scripts", "hooks", "mcp-servers"]) {
    for (const abs of walkTs(path.join(root, tree))) {
      if (path.basename(path.dirname(abs)) !== "workflows") continue;
      if (!toPosix(path.relative(root, abs)).startsWith("src/")) continue;
      violations.push({ rule: "workflows_tree", detail: `${toPosix(path.relative(root, abs))} lives under a retired workflows/ tree (KTD27)` });
    }
  }

  return { ok: violations.length === 0, domains: DOMAIN_IDS.length, files, violations };
}

export function formatDomainOwnership(result: DomainOwnershipResult): string {
  if (result.ok) return "";
  return [
    `check-domain-ownership: ${result.violations.length} violation(s)`,
    ...result.violations.map((v) => `  [${v.rule}] ${v.detail}`),
  ].join("\n");
}

export function parseRoot(argv: string[]): string | { error: string } {
  let root = PLUGIN_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else return { error: `unknown argument: ${arg}` };
  }
  return root;
}

export function runDomainOwnershipCheck(argv: string[] = process.argv.slice(2)): number {
  const root = parseRoot(argv);
  if (typeof root !== "string") {
    process.stderr.write(`${root.error}\nusage: check-domain-ownership.ts [--root <pluginRoot>]\n`);
    return 1;
  }
  try {
    const domains = validateDomainOwnership(root);
    const inventory = buildInventory(root);
    const manifests = loadModuleManifests(root);
    const ownership = validateModuleOwnership(inventory, manifests);
    const health = validateModuleHealth(root, manifests, (id) => `${domainTree(MODULE_TO_DOMAIN.get(id) ?? id)}/index.ts`);
    if (!domains.ok || !ownership.ok || !health.ok) {
      const details = [
        formatDomainOwnership(domains),
        formatOwnershipValidation(ownership),
        formatModuleHealthValidation(health),
      ]
        .filter((message) => message.length > 0)
        .join("\n");
      process.stderr.write(details + "\n");
      return 2;
    }
    process.stdout.write(
      `check-domain-ownership: ${domains.domains} domains own ${domains.files} TypeScript files, ` +
        `each exactly once; ${manifests.length} modules own ${inventory.commands.length} commands, ` +
        `${inventory.skills.length} skills, ${inventory.agents.length} agents, ` +
        `${inventory.hooks.length} hooks, ${inventory.mcp_servers.length} mcp servers, ` +
        `${inventory.scripts.length} scripts\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}
