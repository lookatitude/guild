/**
 * scripts/__tests__/check-bundle-determinism.test.ts
 *
 * Anti-vacuity + regression coverage for the issue #75 bundle-determinism rail.
 *
 * The regression this pins: two hook entrypoints bundle first-party TypeScript from
 * ../scripts/**, whose bare `import * as yaml from "js-yaml"` esbuild resolved from the
 * IMPORTER's directory. So the bundled js-yaml came from plugin/scripts/node_modules
 * (4.1.1) when that sibling package happened to be installed, and from
 * plugin/hooks/node_modules (4.3.0) via the old `NODE_PATH=node_modules` fallback when
 * it did not — same sources, same lockfile, different committed bytes.
 *
 * A rail that cannot fail is worthless, so every detector here is exercised against a
 * PLANTED violation (must trip) AND a clean control (must pass). The final block runs
 * the rail against the REAL repository, so the fix cannot silently regress.
 */
import * as fs from "fs";
import * as path from "path";
import {
  aliasFlagFor,
  checkBuildScript,
  committedBundles,
  countModuleHeaders,
  findExternalDependencyRequires,
  findForeignModulePaths,
  findRuntimeNodeModulesRequires,
  findViolations,
  normalizeOutfile,
  parseBuildScript,
  parseEsbuildInvocations,
} from "../check-bundle-determinism";

const REPO = path.resolve(__dirname, "..", "..");

// The exact shape esbuild emits: a `// <path>` module header per bundled module.
const cleanBundle = [
  "// node_modules/js-yaml/index.js",
  'var require_js_yaml = __commonJS({ "node_modules/js-yaml/index.js"(exports, module) {} });',
  "// lib/guild-root.ts",
  "var GUILD = 1;",
].join("\n");

// The real defect fingerprint, verbatim from the pre-fix hooks/dist/detect-guild-version.js.
const foreignBundle = [
  "// ../scripts/node_modules/js-yaml/lib/common.js",
  'var require_common = __commonJS({ "../scripts/node_modules/js-yaml/lib/common.js"(exports, module) {} });',
  "// ../scripts/dot-guild/convert/detect.ts",
  "var detect = 1;",
].join("\n");

describe("findForeignModulePaths — bundle provenance detector", () => {
  it("PLANTED CONTROL: trips on a module resolved from a sibling package's node_modules", () => {
    expect(findForeignModulePaths(foreignBundle)).toEqual([
      "../scripts/node_modules/js-yaml/lib/common.js",
    ]);
  });

  it("CLEAN CONTROL: a hooks-local node_modules path is correct and does NOT trip", () => {
    expect(findForeignModulePaths(cleanBundle)).toEqual([]);
  });

  it("does NOT flag first-party ../scripts/** SOURCE modules — cross-package source bundling is version-controlled and deterministic", () => {
    const sourceOnly = ["// ../scripts/lib/artifact-bus.ts", "var bus = 1;"].join("\n");
    expect(findForeignModulePaths(sourceOnly)).toEqual([]);
  });

  it("flags an ABSOLUTE node_modules path (a machine-specific resolution)", () => {
    const abs = "// /Users/someone/Projects/guild/node_modules/js-yaml/index.js";
    expect(findForeignModulePaths(abs)).toEqual([
      "/Users/someone/Projects/guild/node_modules/js-yaml/index.js",
    ]);
  });

  it("only matches esbuild's line-anchored module headers, not arbitrary mentions in code", () => {
    const incidental = 'var msg = "see ../scripts/node_modules/js-yaml for details";';
    expect(findForeignModulePaths(incidental)).toEqual([]);
  });
});

describe("parseEsbuildInvocations — build-script tokenizer", () => {
  const script =
    "esbuild a.ts --bundle --platform=node --format=cjs --alias:js-yaml=./node_modules/js-yaml --outfile=dist/a.js " +
    "&& esbuild sub/b.ts --bundle --format=cjs --outfile=sub/dist/b.js";

  it("extracts entry, outfile and the FULL flag list per invocation", () => {
    const parsed = parseEsbuildInvocations(script);
    expect(parsed.map((p) => [p.entry, p.outfile])).toEqual([
      ["a.ts", "dist/a.js"],
      ["sub/b.ts", "sub/dist/b.js"],
    ]);
    expect(parsed[0].flags).toContain("--alias:js-yaml=./node_modules/js-yaml");
    expect(parsed[0].flags).toContain("--bundle");
  });

  it("returns nothing for a script with no esbuild invocation", () => {
    expect(parseEsbuildInvocations("tsc -p . && echo done")).toEqual([]);
  });
});

/**
 * These are the bypasses a skeptical reviewer planted against the first version of this
 * rail. Each one made a real defect invisible while the rail still reported PASS, so
 * each gets a permanent control.
 */
describe("adversarial bypasses — the rail must not silently check a SUBSET of the build", () => {
  const good = `esbuild a.ts --bundle --format=cjs ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`;

  it("BYPASS: an esbuild --outdir invocation is reported, not skipped", () => {
    const script = `${good} && esbuild b.ts --bundle --format=cjs --outdir=dist`;
    expect(parseBuildScript(script).unrecognized).toHaveLength(1);
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v.some((x) => /not a recognised/.test(x.detail))).toBe(true);
  });

  it("BYPASS: an esbuild invocation hidden behind a shell variable is reported, not skipped", () => {
    const script = `${good} && $BUILD b.ts --bundle --outfile=dist/b.js`;
    expect(parseBuildScript(script).unrecognized).toHaveLength(1);
    expect(checkBuildScript(script, ["js-yaml"]).some((x) => /not a recognised/.test(x.detail))).toBe(true);
  });

  it("BYPASS: an invocation with two --outfile targets is reported, not silently half-checked", () => {
    const script = `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js --outfile=dist/b.js`;
    expect(parseBuildScript(script).unrecognized).toHaveLength(1);
  });

  it("BYPASS: a DUPLICATE alias trips — esbuild takes the LAST one, so `includes()` is not enough", () => {
    const script = `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --alias:js-yaml=../scripts/node_modules/js-yaml --outfile=dist/a.js`;
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toMatch(/2 times[\s\S]*takes the LAST/);
  });

  it("BYPASS: an alias pointing somewhere other than hooks/node_modules trips", () => {
    const script = "esbuild a.ts --bundle --alias:js-yaml=../scripts/node_modules/js-yaml --outfile=dist/a.js";
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("wrong target");
  });

  it("BYPASS: --minify trips, because it strips the module headers the provenance scan reads", () => {
    const script = `${good} --minify`;
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v.some((x) => /minif/i.test(x.detail))).toBe(true);
  });

  it("BYPASS: a build hidden inside `sh -c '…'` behind `;`/`||` is NOT modelled as a clean decoy", () => {
    const script =
      "sh -c 'esbuild b.ts --bundle --outfile=elsewhere/b.js' ; true || " +
      `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`;
    const parsed = parseBuildScript(script);
    // The wrapper and the `true` are both reported; only the genuinely plain command parses.
    expect(parsed.unrecognized.length).toBeGreaterThanOrEqual(1);
    expect(checkBuildScript(script, ["js-yaml"]).some((x) => /not a recognised/.test(x.detail))).toBe(true);
  });

  it("BYPASS: any shell metacharacter makes a segment unrecognised (no partial shell parsing)", () => {
    for (const seg of [
      "esbuild $(cat entry) --bundle --outfile=dist/a.js",
      "esbuild a.ts --bundle --outfile=dist/a.js > /dev/null",
      "esbuild `cat e` --bundle --outfile=dist/a.js",
    ]) {
      expect(parseBuildScript(seg).invocations).toHaveLength(0);
      expect(parseBuildScript(seg).unrecognized).toHaveLength(1);
    }
  });

  it("BYPASS: externalising a declared dependency trips — un-bundled means unverifiable", () => {
    const script =
      `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --external:./node_modules/js-yaml --outfile=dist/a.js`;
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("externalises the declared dependency");
  });

  it("BYPASS: --external:js-yaml (bare package form) also trips", () => {
    const script = `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --external:js-yaml --outfile=dist/a.js`;
    expect(checkBuildScript(script, ["js-yaml"]).some((x) => /externalises/.test(x.detail))).toBe(true);
  });

  it("does NOT trip on an --external for a package that is not a declared dependency", () => {
    const script = `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --external:fsevents --outfile=dist/a.js`;
    expect(checkBuildScript(script, ["js-yaml"])).toEqual([]);
  });

  it("BYPASS: --packages=external trips (it un-bundles everything at once)", () => {
    const script = `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --packages=external --outfile=dist/a.js`;
    expect(checkBuildScript(script, ["js-yaml"]).some((x) => /packages=external/.test(x.detail))).toBe(true);
  });

  it("BYPASS: an externalised dep leaves a runtime require() that the ARTIFACT guard catches", () => {
    // The flag guard can be evaded by spelling; this is the same defect seen in the output.
    const externalised = ['// dist/a.js', 'var y = require("./node_modules/js-yaml");'].join("\n");
    expect(findForeignModulePaths(externalised)).toEqual([]); // provenance sees nothing…
    expect(findRuntimeNodeModulesRequires(externalised)).toEqual(["./node_modules/js-yaml"]);
  });

  it("BYPASS: an invocation missing --bundle trips (transpiled, not bundled)", () => {
    const script = `esbuild a.ts --format=cjs ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`;
    const v = checkBuildScript(script, ["js-yaml"]);
    expect(v.some((x) => /missing --bundle/.test(x.detail))).toBe(true);
  });

  it("BYPASS: a bare require(\"<declared dep>\") in a bundle is caught by the artifact guard", () => {
    // The un-bundled form leaves the plain package specifier rather than a node_modules path,
    // so the node_modules guard alone would miss it.
    const unbundled = ['// dist/a.js', 'var yaml = require("js-yaml");'].join("\n");
    expect(findRuntimeNodeModulesRequires(unbundled)).toEqual([]);
    expect(findExternalDependencyRequires(unbundled, ["js-yaml"])).toEqual(["js-yaml"]);
  });

  it("the bare-require guard ignores node builtins and undeclared packages", () => {
    const bundle = 'var fs = require("fs"), p = require("path"), x = require("lodash");';
    expect(findExternalDependencyRequires(bundle, ["js-yaml"])).toEqual([]);
  });

  it("the bare-require guard catches a subpath require of a declared dep", () => {
    expect(findExternalDependencyRequires('require("js-yaml/lib/loader");', ["js-yaml"])).toEqual([
      "js-yaml/lib/loader",
    ]);
  });

  it("BYPASS: two invocations writing the SAME outfile are not deduped away", () => {
    const script =
      `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js && ` +
      `esbuild b.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`;
    expect(parseBuildScript(script).invocations.map((i) => i.outfile)).toEqual(["dist/a.js", "dist/a.js"]);
  });

  it("normalizes ./dist/a.js and dist/a.js to the same target (no spurious stale/outside pair)", () => {
    expect(normalizeOutfile("./dist/a.js")).toBe("dist/a.js");
    expect(normalizeOutfile("dist/./a.js")).toBe("dist/a.js");
    expect(normalizeOutfile("agent-team/dist/b.js")).toBe("agent-team/dist/b.js");
  });

  it("BYPASS: a bundle with no module headers is flagged instead of passing vacuously", () => {
    // A minified bundle carrying a foreign js-yaml: findForeignModulePaths sees nothing…
    const minified = 'var a=1;var require_common=__commonJS({"x"(){}});';
    expect(findForeignModulePaths(minified)).toEqual([]);
    // …so the rail asserts its own precondition instead of trusting that empty result.
    expect(countModuleHeaders(minified)).toBe(0);
    expect(countModuleHeaders(cleanBundle)).toBeGreaterThan(0);
  });
});

describe("checkBuildScript — build-configuration detector", () => {
  const pinned = `esbuild a.ts --bundle --format=cjs ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`;

  it("CLEAN CONTROL: a fully pinned invocation passes", () => {
    expect(checkBuildScript(pinned, ["js-yaml"])).toEqual([]);
  });

  it("PLANTED CONTROL: an invocation missing the dependency pin trips", () => {
    const unpinned = "esbuild a.ts --bundle --format=cjs --outfile=dist/a.js";
    const v = checkBuildScript(unpinned, ["js-yaml"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain(aliasFlagFor("js-yaml"));
  });

  it("PLANTED CONTROL: reintroducing the NODE_PATH ambient fallback trips", () => {
    const v = checkBuildScript(`export NODE_PATH=node_modules && ${pinned}`, ["js-yaml"]);
    expect(v.some((x) => /NODE_PATH/.test(x.detail))).toBe(true);
  });

  it("PLANTED CONTROL: catches a NEW entrypoint added without the pin", () => {
    const mixed = `${pinned} && esbuild new-hook.ts --bundle --format=cjs --outfile=dist/new-hook.js`;
    const v = checkBuildScript(mixed, ["js-yaml"]);
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe("hooks/dist/new-hook.js");
  });

  it("pins EVERY declared runtime dependency, not just js-yaml", () => {
    const v = checkBuildScript(pinned, ["js-yaml", "semver"]);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain(aliasFlagFor("semver"));
  });

  it("REFUSES TO PASS VACUOUSLY on a build script it cannot parse", () => {
    const v = checkBuildScript("node build.mjs", ["js-yaml"]);
    // Both facts are reported: the segment is unmodelled, AND nothing at all was parsed.
    expect(v.some((x) => /not a recognised/.test(x.detail))).toBe(true);
    expect(v.some((x) => /no esbuild invocation could be parsed/.test(x.detail))).toBe(true);
  });

  it("REFUSES TO PASS VACUOUSLY when no runtime dependency is declared", () => {
    const v = checkBuildScript(pinned, []);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("nothing to pin");
  });
});

describe("output set ↔ committed bundle set (real fixture trees on disk)", () => {
  let root: string;

  const writeFixture = (buildScript: string, bundles: Record<string, string>) => {
    fs.mkdirSync(path.join(root, "hooks", "dist"), { recursive: true });
    fs.mkdirSync(path.join(root, "hooks", "agent-team", "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "hooks", "package.json"),
      JSON.stringify({ dependencies: { "js-yaml": "^4.1.0" }, scripts: { build: buildScript } }),
    );
    for (const [rel, body] of Object.entries(bundles)) {
      fs.writeFileSync(path.join(root, "hooks", rel), body);
    }
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(require("os").tmpdir(), "bundle-det-"));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("CLEAN CONTROL: a matched build script and dist tree passes", () => {
    writeFixture(`esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`, {
      "dist/a.js": cleanBundle,
    });
    expect(findViolations(root)).toEqual([]);
  });

  it("PLANTED CONTROL: an output written outside the scanned directories is flagged", () => {
    writeFixture(
      `esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js && ` +
        `esbuild b.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=elsewhere/b.js`,
      { "dist/a.js": cleanBundle },
    );
    const v = findViolations(root);
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe("hooks/elsewhere/b.js");
    expect(v[0].detail).toContain("would never be provenance-checked");
  });

  it("PLANTED CONTROL: a committed bundle with no producing invocation is flagged as stale output", () => {
    writeFixture(`esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`, {
      "dist/a.js": cleanBundle,
      "dist/orphan.js": cleanBundle,
    });
    const v = findViolations(root);
    expect(v).toHaveLength(1);
    expect(v[0].file).toBe("hooks/dist/orphan.js");
    expect(v[0].detail).toContain("no producing esbuild invocation");
  });

  it("PLANTED CONTROL: a foreign-resolved dependency in a real committed bundle is flagged", () => {
    writeFixture(`esbuild a.ts --bundle ${aliasFlagFor("js-yaml")} --outfile=dist/a.js`, {
      "dist/a.js": foreignBundle,
    });
    const v = findViolations(root);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toContain("../scripts/node_modules/js-yaml/lib/common.js");
  });
});

describe("the REAL repository", () => {
  it("enumerates the committed hook bundles (the rail is not scanning an empty set)", () => {
    const bundles = committedBundles(path.join(REPO, "hooks"));
    expect(bundles.length).toBeGreaterThanOrEqual(20);
    expect(bundles.some((b) => b.endsWith(path.join("agent-team", "dist", "task-completed.js")))).toBe(true);
  });

  it("has no violations — every committed bundle resolves deps from hooks/node_modules", () => {
    expect(findViolations(REPO)).toEqual([]);
  });

  it("REGRESSION (#75): the two entrypoints that bundle ../scripts/** carry no foreign js-yaml", () => {
    // These are the exact two bundles the issue reported as non-reproducible.
    for (const rel of ["dist/detect-guild-version.js", "agent-team/dist/task-completed.js"]) {
      const text = fs.readFileSync(path.join(REPO, "hooks", rel), "utf8");
      expect(findForeignModulePaths(text)).toEqual([]);
      expect(text).toContain("node_modules/js-yaml/");
    }
  });

  it("REGRESSION (#75): the hooks build script pins js-yaml on every invocation and sets no NODE_PATH", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "hooks", "package.json"), "utf8"));
    const build = String(pkg.scripts.build);
    expect(build).not.toMatch(/NODE_PATH/);
    const invocations = parseEsbuildInvocations(build);
    expect(invocations.length).toBeGreaterThanOrEqual(20);
    for (const inv of invocations) {
      expect(inv.flags).toContain(aliasFlagFor("js-yaml"));
    }
  });
});
