/**
 * T12 (U-FOLD) done-when fixtures — R43 (code shape) and R52 (preserve-and-fold).
 *
 * Both oracles run the SHIPPED code path, not a re-implementation:
 *   - import direction: the real `no-domain-adapter-import` / `index-only-domain-imports`
 *     checks from scripts/lint/layout-laws.ts, over a planted fixture tree;
 *   - coverage bijection: the real `checkDomainBijection` the coverage draft calls,
 *     over a planted orphan;
 *   - domain ownership: the real `validateDomainOwnership` over a planted second copy.
 *
 * Each negative case is paired with the clean case, so a fixture that stops
 * flagging fails here rather than silently passing.
 */

import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  DOMAIN_IDS,
  MODULE_TO_DOMAIN,
  checkDomainBijection,
  domainTree,
  shimDefect,
  validateDomainOwnership,
} from "../../src/domains/distribution";
import { buildInventory } from "../build-inventory";
import { srcImportClosure, writeClaudeTree } from "../build-host-packages";
import { checkPackagedSource } from "../lint/packaged-install-smoke";

const REPO = path.resolve(__dirname, "..", "..");

/** Run the real layout-laws CLI. A non-zero exit means "open violations", which
 *  is the expected result for every planted fixture, so the status is not an error. */
function runLayoutLaws(root: string, check?: string): Array<{ check: string; path: string; detail: string }> {
  const args = ["tsx", path.join(REPO, "scripts", "lint", "layout-laws.ts"), `--root=${root}`, "--json"];
  if (check) args.push(`--check=${check}`);
  const run = spawnSync("npx", args, {
    cwd: path.join(REPO, "scripts"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status === null) throw new Error(`layout-laws did not run: ${run.stderr}`);
  return JSON.parse(run.stdout).violations as Array<{ check: string; path: string; detail: string }>;
}

function tmpTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return root;
}

// ---------------------------------------------------------------- R43 shape
describe("R43 — domain index-only imports (KTD4/KTD27)", () => {
  test("a planted adapter import inside a domain is REFUSED", () => {
    const root = tmpTree({
      "src/adapters/host-registry.ts": 'export const HOST_IDS = ["claude-code"] as const;\n',
      "src/adapters/index.ts": 'export * from "./host-registry";\n',
      "src/domains/config/resolver.ts": 'import { HOST_IDS } from "../../adapters";\nexport const hosts = HOST_IDS;\n',
      "src/domains/config/index.ts": 'export * from "./resolver";\n',
    });
    const hits = runLayoutLaws(root, "no-domain-adapter-import");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("src/domains/config/resolver.ts");
  });

  test("the allowed direction — adapters reading a domain INDEX — is clean", () => {
    const root = tmpTree({
      "src/domains/kernel/tier-bus.ts": 'export const TIERS = ["T0"] as const;\n',
      "src/domains/kernel/index.ts": 'export * from "./tier-bus";\n',
      "src/adapters/index.ts": 'import { TIERS } from "../domains/kernel";\nexport const t = TIERS;\n',
    });
    expect(runLayoutLaws(root, "no-domain-adapter-import")).toHaveLength(0);
    expect(runLayoutLaws(root, "index-only-domain-imports")).toHaveLength(0);
  });

  test("an adapter reaching PAST a domain index is REFUSED", () => {
    const root = tmpTree({
      "src/domains/kernel/tier-bus.ts": 'export const TIERS = ["T0"] as const;\n',
      "src/domains/kernel/index.ts": 'export * from "./tier-bus";\n',
      "src/adapters/index.ts": 'import { TIERS } from "../domains/kernel/tier-bus";\nexport const t = TIERS;\n',
    });
    const hits = runLayoutLaws(root, "index-only-domain-imports");
    expect(hits).toHaveLength(1);
  });

  test("a hook reaching PAST a domain index is REFUSED; the same hook via the index is clean", () => {
    const past = tmpTree({
      "src/domains/kernel/index.ts": 'export * from "./tier-bus";\n',
      "src/domains/kernel/tier-bus.ts": "export const TIERS = [];\n",
      "hooks/x.ts": 'import { TIERS } from "../src/domains/kernel/tier-bus";\nexport const t = TIERS;\n',
    });
    const hits = runLayoutLaws(past, "index-only-domain-imports");
    expect(hits.map((h) => h.path)).toEqual(["hooks/x.ts"]);

    const viaIndex = tmpTree({
      "src/domains/kernel/index.ts": 'export * from "./tier-bus";\n',
      "src/domains/kernel/tier-bus.ts": "export const TIERS = [];\n",
      "hooks/x.ts": 'import { TIERS } from "../src/domains/kernel";\nexport const t = TIERS;\n',
    });
    expect(runLayoutLaws(viaIndex, "index-only-domain-imports")).toHaveLength(0);
  });

  test("scripts, tests and mcp-servers are consumers too; compiled dist/ is not", () => {
    const deep = 'import { TIERS } from "../../src/domains/kernel/tier-bus";\nexport const t = TIERS;\n';
    const root = tmpTree({
      "src/domains/kernel/index.ts": 'export * from "./tier-bus";\n',
      "src/domains/kernel/tier-bus.ts": "export const TIERS = [];\n",
      "scripts/lib/a.ts": deep,
      "tests/unit/b.test.ts": deep,
      "mcp-servers/m/c.ts": deep,
      "hooks/dist/d.ts": deep,
    });
    const paths = runLayoutLaws(root, "index-only-domain-imports").map((h) => h.path).sort();
    expect(paths).toEqual(["mcp-servers/m/c.ts", "scripts/lib/a.ts", "tests/unit/b.test.ts"]);
  });

  test("the live tree has no src/**/workflows/ tree and no open index-direction violation", () => {
    expect(runLayoutLaws(REPO, "no-ts-workflows-dir")).toHaveLength(0);
    // Outside src/ the remaining private-file imports are a declared, baselined
    // worklist (file-for-file shims, lazy requires, white-box tests). Inside src/
    // there are none, and nothing is open.
    const baseline = new Set<string>(
      JSON.parse(fs.readFileSync(path.join(REPO, "scripts/lint/layout-baseline.json"), "utf8")).entries,
    );
    const hits = runLayoutLaws(REPO, "index-only-domain-imports");
    expect(hits.filter((h) => h.path.startsWith("src/"))).toEqual([]);
    expect(hits.filter((h) => !baseline.has(`${h.check}::${h.path}::${h.detail}`))).toEqual([]);
  });
});

// ------------------------------------------------------- R52 preserve-and-fold
describe("R52 — coverage domains[] bijection (KTD36)", () => {
  const surfaces = new Map<string, ReadonlySet<string>>([
    ["state", new Set(["resolveGuildRoot", "splitFrontmatter"])],
  ]);
  const folded = new Map<string, readonly string[]>([["state", ["state", "migrations"]]]);

  test("a planted orphan — a domain export no module row claims — FAILS the bijection", () => {
    const result = checkDomainBijection(surfaces, folded, [
      ["module:state#resolveGuildRoot", "domain:state#resolveGuildRoot"],
    ]);
    expect(result.ok).toBe(false);
    expect(result.orphans).toBe(1);
    expect(result.rows.find((r) => r.id === "state")?.orphans).toEqual(["splitFrontmatter"]);
  });

  test("a row pointing at a symbol the domain does not export FAILS the bijection", () => {
    const result = checkDomainBijection(surfaces, folded, [
      ["module:state#resolveGuildRoot", "domain:state#resolveGuildRoot"],
      ["module:state#splitFrontmatter", "domain:state#splitFrontmatter"],
      ["module:migrations#gone", "domain:state#gone"],
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["module:migrations#gone -> domain:state#gone"]);
  });

  test("every claimed export and no orphan is OK, and the row records the fold", () => {
    const result = checkDomainBijection(surfaces, folded, [
      ["module:state#resolveGuildRoot", "domain:state#resolveGuildRoot"],
      ["module:migrations#splitFrontmatter", "domain:state#splitFrontmatter"],
    ]);
    expect(result.ok).toBe(true);
    expect(result.rows.find((r) => r.id === "state")).toMatchObject({
      tree: "src/domains/state",
      modules: ["migrations", "state"],
      exports: 2,
      orphans: [],
    });
  });

  test("the live coverage draft is bijective with zero orphans", () => {
    const out = execFileSync(
      "npx",
      ["tsx", path.join(REPO, "scripts", "lint", "build-coverage-draft.ts"), "--check"],
      { cwd: path.join(REPO, "scripts"), encoding: "utf8" },
    );
    expect(out).toContain("0 unmapped");
    expect(out).toContain("0 domain orphans");
    expect(out).toContain("0 missing domain targets");
  });
});

/** A minimal fold: twelve domain indexes, the adapter index, and one real
 *  re-export shim per module pointing at its domain home. */
function plantShims(root: string): void {
  for (const id of DOMAIN_IDS) {
    fs.mkdirSync(path.join(root, domainTree(id)), { recursive: true });
    fs.writeFileSync(path.join(root, domainTree(id), "index.ts"), "export const x = 1;\n");
  }
  fs.mkdirSync(path.join(root, "src/adapters"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/adapters/index.ts"), "export const x = 1;\n");
  for (const [id, domain] of MODULE_TO_DOMAIN) {
    const target = domain === "adapters" ? "../../adapters" : `../../domains/${domain}`;
    fs.mkdirSync(path.join(root, "src/modules", id), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src/modules", id, "index.ts"),
      `/** shim */\nexport { x } from "${target}";\nexport type { Y } from "${target}";\n`,
    );
  }
}

// ------------------------------------------------------------ domain ownership
describe("domain ownership — every domain file is owned exactly once", () => {
  test("the fold is a closed twelve and every module has a home", () => {
    expect(DOMAIN_IDS).toHaveLength(12);
    expect(new Set(MODULE_TO_DOMAIN.values())).toEqual(new Set([...DOMAIN_IDS, "adapters"]));
    for (const id of DOMAIN_IDS) {
      expect(fs.existsSync(path.join(REPO, domainTree(id), "index.ts"))).toBe(true);
    }
  });

  test("the live tree passes", () => {
    const result = validateDomainOwnership(REPO);
    expect(result.violations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a second copy left behind under src/modules is REFUSED", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-own-"));
    plantShims(root);
    expect(validateDomainOwnership(root).ok).toBe(true);

    // The planted defect: the implementation did not move, it was copied.
    fs.writeFileSync(path.join(root, "src/modules/state/guild-root.ts"), "export const x = 1;\n");
    const after = validateDomainOwnership(root);
    expect(after.ok).toBe(false);
    expect(after.violations.map((v) => v.rule)).toContain("module_holds_implementation");
  });

  test("every real src/modules/*/index.ts is a pure re-export shim", () => {
    const ids = fs.readdirSync(path.join(REPO, "src/modules")).filter((id) =>
      fs.existsSync(path.join(REPO, "src/modules", id, "index.ts")),
    );
    expect(ids).toHaveLength(30);
    for (const id of ids) {
      expect([id, shimDefect(REPO, path.join(REPO, "src/modules", id, "index.ts"))]).toEqual([id, null]);
    }
  });

  test("a module index with a function body is REFUSED, naming the file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-body-"));
    plantShims(root);
    expect(validateDomainOwnership(root).ok).toBe(true);
    fs.writeFileSync(
      path.join(root, "src/modules/state/index.ts"),
      'export { x } from "../../domains/state";\nexport function guildRoot(): string {\n  return ".guild";\n}\n',
    );
    const after = validateDomainOwnership(root);
    expect(after.ok).toBe(false);
    const hit = after.violations.find((v) => v.rule === "module_holds_implementation");
    expect(hit?.detail).toContain("src/modules/state/index.ts");
  });

  test("comments and string-named re-exports inside a valid shim are accepted", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-ok-"));
    plantShims(root);
    fs.writeFileSync(
      path.join(root, "src/modules/state/index.ts"),
      '// header\n/* block */\nexport { x as "/*", type Y as "*/" } from "../../domains/state"\nexport * as ns from "../../domains/state";\nexport type { Z } from "../../domains/state";\n',
    );
    expect(shimDefect(root, path.join(root, "src/modules/state/index.ts"))).toBeNull();
  });

  test("a shim re-exporting from another module (not a domain) is REFUSED", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-mod-"));
    plantShims(root);
    fs.writeFileSync(path.join(root, "src/modules/state/index.ts"), 'export * from "../capability";\n');
    const after = validateDomainOwnership(root);
    expect(after.ok).toBe(false);
    const hit = after.violations.find((v) => v.rule === "module_holds_implementation");
    expect(hit?.detail).toContain("src/modules/state/index.ts");
    expect(hit?.detail).toContain("re-exports from src/modules/capability");
  });

  test.each([
    [
      "string-named re-exports that spell a comment pair (codex G-lane r2)",
      'export { x as "/*" } from "../../domains/state";\nexport const hidden = 7;\nexport { x as "*/" } from "../../domains/state";\n',
      "hidden",
    ],
    ["an import followed by a re-export", 'import { x } from "../../domains/state";\nexport { x };\n', "import"],
    ["a default export body", 'export * from "../../domains/state";\nexport default function f() { return 1; }\n', "default"],
    ["a re-export from a package specifier", 'export * from "node:fs";\n', "package specifier"],
    ["a template-literal specifier", 'export * from `../../domains/state`;\n', "not a string literal"],
    ["a bare statement after a valid re-export without semicolons", 'export * from "../../domains/state"\nconst y = 1\n', "const"],
    ["a declaration after a line comment ended by CR (codex G-lane r3)", 'export * from "../../domains/state"; // c\rexport const unlisted = 7;\n', "const"],
    ["a declaration after a line comment ended by U+2028", 'export * from "../../domains/state"; // c\u2028export const unlisted = 7;\n', "const"],
    ["a declaration after a line comment ended by U+2029", 'export * from "../../domains/state"; // c\u2029export const unlisted = 7;\n', "const"],
    ["an unterminated block comment", 'export * from "../../domains/state"; /* open\n', "not a re-export"],
    ["an escaped specifier that resolves outside the domain tree (codex G-lane r4)", 'export * from "../../domains/state/\\x2e\\x2e/\\x2e\\x2e/modules/capability/index.mjs";\n', "escape sequence"],
  ])("a shim disguising an implementation is REFUSED: %s", (_name, body, needle) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-disguise-"));
    plantShims(root);
    fs.writeFileSync(path.join(root, "src/modules/state/index.ts"), body);
    const after = validateDomainOwnership(root);
    expect(after.ok).toBe(false);
    const hit = after.violations.find((v) => v.rule === "module_holds_implementation");
    expect(hit?.detail).toContain("src/modules/state/index.ts");
    expect(hit?.detail).toContain(needle);
  });

  test("a thirteenth domain is REFUSED", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-13-"));
    fs.mkdirSync(path.join(root, "src/domains/observability"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/domains/observability/index.ts"), "export {};\n");
    const rules = validateDomainOwnership(root).violations.map((v) => v.rule);
    expect(rules).toContain("unknown_domain");
  });
});

// ------------------------------------------------- host package projection (KTD28)
describe("host packages ship a projection, not the domain tree (KTD28)", () => {
  test("the src/ closure follows imports, including eval(require), and skips unreachable files", () => {
    const root = tmpTree({
      "scripts/run.ts": 'import { used } from "../src/domains/kernel/used";\nexport const r = used;\n',
      "src/domains/kernel/used.ts": 'import { dep } from "./dep";\nexport const used = dep;\n',
      "src/domains/kernel/dep.ts":
        'export const dep = () => (eval("require") as NodeRequire)("../state/lazy");\n',
      "src/domains/state/lazy.ts": "export const lazy = 1;\n",
      "src/domains/config/model-resolver.ts": "export const unreachable = 1;\n",
    });
    const dest = tmpTree({ "scripts/run.ts": fs.readFileSync(path.join(root, "scripts/run.ts"), "utf8") });
    expect(srcImportClosure(root, dest)).toEqual([
      "src/domains/kernel/dep.ts",
      "src/domains/kernel/used.ts",
      "src/domains/state/lazy.ts",
    ]);
  });

  test("the built Claude package carries only surfaces, module shims + the closure, and its runtime starts", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "guild-t12-pkg-"));
    const pkg = writeClaudeTree(REPO, buildInventory(REPO), out, "2026-01-01T00:00:00.000Z");
    expect(checkPackagedSource(pkg, REPO)).toEqual([]);
    expect(fs.existsSync(path.join(pkg, "src/surfaces/graphs/product.yaml"))).toBe(true);
    // No retired tree and no module implementation left: only shims can be reached.
    const shipped = execFileSync("find", ["src", "-name", "*.ts"], { cwd: pkg, encoding: "utf8" }).trim().split("\n");
    expect(shipped.filter((f) => f.includes("/workflows/"))).toEqual([]);
    expect(shipped.filter((f) => f.startsWith("src/modules/") && !f.endsWith("/index.ts"))).toEqual([]);

    // Anti-vacuity: a domain file no shipped script imports is a domain copy.
    fs.writeFileSync(path.join(pkg, "src/domains/config/zz-planted.ts"), "export const x = 1;\n");
    expect(checkPackagedSource(pkg, REPO)).toEqual([
      "claude-code: ships src/domains/config/zz-planted.ts, which no shipped script imports (a domain copy, KTD28)",
    ]);

    const run = spawnSync(process.execPath, [path.join(pkg, "runtime/guild-mcp.js"), "wiki"], {
      cwd: pkg, input: "", encoding: "utf8", timeout: 20000,
    });
    expect(run.stderr).toMatch(/\bready\b/);
  }, 120000);
});
