/**
 * R-DIST — hooks dist-sync + import-canonicality rail (STRICT).
 *
 * Two strict checks:
 *
 *   1. DIST-SYNC (original). The committed hooks bundles (hooks/dist/*.js and
 *      hooks/agent-team/dist/*.js) must be byte-identical to a fresh esbuild of their
 *      `.ts` sources. A stale committed bundle = shipped hook behaviour silently
 *      diverges from source. Built to a TEMP outfile and byte-compared — the rail NEVER
 *      mutates tracked files (production source is W1's lane).
 *
 *   2. IMPORT CANONICALITY (codex G-lane fix #3). Each module W1 consolidated into
 *      scripts/lib/shared/ is the SINGLE canonical home for its concern. A consumer that
 *      imports that concern from a NON-canonical path — a relative specifier whose
 *      basename matches a canonical shared module but which resolves OUTSIDE
 *      scripts/lib/shared/ (i.e. a left-behind duplicate copy) — is a violation. The
 *      canonical version exists, so the non-canonical import must be repointed.
 *
 * Anti-vacuity: `--prove` asserts (a) the byte-compare primitive detects a 1-byte
 * divergence and accepts identical buffers, (b) the build-script parser extracts
 * entry→outfile triples, and (c) the PLANTED non-canonical import (`../dup/bm25` while
 * scripts/lib/shared/bm25.ts is canonical) TRIPS the canonicality detector, while a
 * canonical `../lib/shared/bm25` import passes.
 */
import { REPO, RailResult, report, walk, read, rel, proveAssert } from "./_common";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const HOOKS = path.join(REPO, "hooks");
const SHARED_FLOOR = "scripts/lib/shared/";

/** Pure primitive: are two byte buffers identical? */
export function bytesEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.equals(b);
}

/**
 * Diagnostic for a STALE finding: pinpoint the FIRST differing byte and show a
 * short context window from both sides. This turns an opaque "stale" into an
 * actionable fact (path-comment? version string? whitespace? real code?), which
 * is the only way to tell platform-noise from a genuinely un-rebuilt bundle when
 * the divergence only reproduces in CI (different host than the committer).
 */
export function describeByteDiff(committed: Buffer, fresh: Buffer): string {
  const n = Math.min(committed.length, fresh.length);
  let i = 0;
  while (i < n && committed[i] === fresh[i]) i++;
  const win = (b: Buffer) =>
    JSON.stringify(b.slice(Math.max(0, i - 20), i + 40).toString("utf8"));
  return (
    `committed=${committed.length}B fresh=${fresh.length}B first-diff@${i}; ` +
    `committed…${win(committed)}… vs fresh…${win(fresh)}…`
  );
}

interface Entry {
  entry: string;
  outfile: string;
}

/** Parse `esbuild <entry> ... --outfile=<out>` triples out of hooks/package.json build. */
export function parseBuildEntries(buildScript: string): Entry[] {
  const re = /esbuild\s+(\S+)\s+--bundle[^&]*?--outfile=(\S+)/g;
  const out: Entry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(buildScript))) out.push({ entry: m[1], outfile: m[2] });
  return out;
}

function esbuildBin(): string {
  const local = path.join(HOOKS, "node_modules", ".bin", "esbuild");
  return fs.existsSync(local) ? local : "npx";
}

// ───────────────────────── import canonicality ─────────────────────────

/**
 * Canonical shared module basenames (without extension). Derived from the real
 * scripts/lib/shared/ tree so the rail tracks the floor, not a hardcoded list.
 */
export function canonicalSharedBasenames(): Set<string> {
  const dir = path.join(REPO, "scripts", "lib", "shared");
  const out = new Set<string>();
  if (!fs.existsSync(dir)) return out;
  for (const f of walk(dir, (n) => n.endsWith(".ts"))) {
    out.add(path.basename(f, ".ts"));
  }
  return out;
}

export interface CanonViolation {
  file: string;
  spec: string;
  resolved: string;
  basename: string;
}

/** Extract every relative import/export specifier from a module body. */
function relativeSpecsOf(content: string): string[] {
  const re =
    /\b(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const spec = m[1] ?? m[2];
    if (spec && spec.startsWith(".")) out.push(spec);
  }
  return out;
}

/**
 * Is the file at `targetRel` (with `content`) a pure RE-EXPORT SHIM of the canonical
 * floor? A shim only `export … from "<shared>"` / `import … from "<shared>"` where every
 * relative specifier resolves into scripts/lib/shared/, and carries no local logic
 * (no `function` / `class` / `const … =` declaration body). Such a shim IS canonical —
 * importing it is allowed (it preserves a historical path while the body stays single-source).
 */
export function isReExportShim(targetRel: string, content: string): boolean {
  const tRel = targetRel.replace(/\\/g, "/");
  const specs = relativeSpecsOf(content);
  if (specs.length === 0) return false; // nothing to re-export → not a shim
  const allIntoFloor = specs.every((s) => {
    const r = path.posix.normalize(path.posix.join(path.posix.dirname(tRel), s));
    return r.startsWith(SHARED_FLOOR);
  });
  if (!allIntoFloor) return false;
  // reject local logic — a real implementation, not a shim
  const hasLocalLogic = /\b(?:function|class)\s+\w|\b(?:const|let|var)\s+\w+\s*=/.test(content);
  return !hasLocalLogic;
}

/**
 * Pure detector. Given a source file's rel-path + content + the set of canonical shared
 * basenames, flag every relative import whose basename matches a canonical shared module
 * but resolves OUTSIDE scripts/lib/shared/ (a non-canonical duplicate import). Imports
 * that already resolve into the shared floor are canonical and pass. A `resolve` callback
 * (relPath → content | null) lets the detector follow the target: if the target is itself
 * a pure re-export shim of the canonical floor, the import is canonical and passes.
 */
export function detectNonCanonicalImports(
  fileRel: string,
  content: string,
  canonical: Set<string>,
  resolve?: (targetRel: string) => string | null,
): CanonViolation[] {
  if (fileRel.replace(/\\/g, "/").startsWith(SHARED_FLOOR)) return []; // the floor itself is canonical
  const out: CanonViolation[] = [];
  const importRe =
    /\b(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content))) {
    const spec = m[1] ?? m[2];
    if (!spec || !spec.startsWith(".")) continue; // external / builtin
    const base = path.posix.basename(spec).replace(/\.(ts|js)$/, "");
    if (!canonical.has(base)) continue; // not a canonical concern
    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(fileRel.replace(/\\/g, "/")), spec),
    );
    if (resolved.startsWith(SHARED_FLOOR)) continue; // direct canonical import — fine
    // not the floor — is the target a re-export shim pointing at the floor?
    if (resolve) {
      const targetRel = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
      const targetContent = resolve(targetRel);
      if (targetContent !== null && isReExportShim(targetRel, targetContent)) continue; // shim → canonical
    }
    out.push({ file: fileRel, spec, resolved, basename: base });
  }
  return out;
}

const SOURCE_DIRS = ["scripts", "mcp-servers", "hooks"];

function isTestPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return /\.test\.ts$/.test(p) || p.includes("/__tests__/");
}

export function run(): RailResult {
  const out: RailResult = { rail: "R-DIST", pass: true, advisory: false, violations: [], notes: [] };

  // ── check 1: dist-sync ──
  const pkg = JSON.parse(fs.readFileSync(path.join(HOOKS, "package.json"), "utf8"));
  const entries = parseBuildEntries(pkg.scripts?.build ?? "");
  out.notes.push(`parsed ${entries.length} hooks build entrypoints from package.json`);

  const bin = esbuildBin();
  const esbuildPresent = fs.existsSync(path.join(HOOKS, "node_modules", ".bin", "esbuild"));
  if (bin === "npx" && !esbuildPresent) {
    out.notes.push("esbuild not installed in hooks/ — dist-sync SKIPPED (sub-check only). Run `npm ci` in hooks/.");
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "r-dist-"));
    let checked = 0;
    for (const { entry, outfile } of entries) {
      const committed = path.join(HOOKS, outfile);
      if (!fs.existsSync(committed)) {
        out.violations.push(`${outfile}: committed bundle missing (entry ${entry})`);
        continue;
      }
      const tmpOut = path.join(tmp, `${checked}.js`);
      const args = [
        bin === "npx" ? "esbuild" : entry,
        ...(bin === "npx" ? [entry] : []),
        "--bundle",
        "--platform=node",
        "--target=node18",
        "--format=cjs",
        `--outfile=${tmpOut}`,
      ];
      try {
        // Replicate the hooks build script's `export NODE_PATH=node_modules`
        // prefix (hooks/package.json): yaml-loader's literal require("js-yaml")
        // is imported from src/, outside hooks/node_modules' resolution walk,
        // so without NODE_PATH the fresh build leaves it external and the
        // byte-compare false-flags every js-yaml-carrying bundle as stale.
        execFileSync(bin, args, {
          cwd: HOOKS,
          stdio: ["ignore", "ignore", "pipe"],
          env: { ...process.env, NODE_PATH: "node_modules" },
        });
      } catch (e: any) {
        out.violations.push(`${outfile}: esbuild failed — ${String(e?.stderr ?? e).slice(0, 200)}`);
        continue;
      }
      checked++;
      const committedBuf = fs.readFileSync(committed);
      const freshBuf = fs.readFileSync(tmpOut);
      if (!bytesEqual(committedBuf, freshBuf)) {
        out.violations.push(
          `${outfile}: committed bundle is STALE vs fresh esbuild of ${entry} — run \`npm run build\` in hooks/ ` +
            `[${describeByteDiff(committedBuf, freshBuf)}]`
        );
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    out.notes.push(`rebuilt + byte-compared ${checked} bundle(s) against committed dist`);
  }

  // ── check 2: import canonicality ──
  const canonical = canonicalSharedBasenames();
  if (canonical.size === 0) {
    out.notes.push("scripts/lib/shared/ has no canonical modules yet — canonicality check inert.");
  } else {
    const resolveContent = (targetRel: string): string | null => {
      const abs = path.join(REPO, targetRel);
      return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
    };
    let scanned = 0;
    for (const d of SOURCE_DIRS) {
      for (const f of walk(path.join(REPO, d), (n) => n.endsWith(".ts"))) {
        const r = rel(f);
        if (isTestPath(r)) continue;
        scanned++;
        for (const v of detectNonCanonicalImports(r, read(f), canonical, resolveContent)) {
          out.violations.push(
            `[canonicality] ${v.file} imports "${v.spec}" (→ ${v.resolved}) — a NON-canonical copy of shared module "${v.basename}"; import from ${SHARED_FLOOR}${v.basename}`,
          );
        }
      }
    }
    out.notes.push(
      `canonicality: scanned ${scanned} non-test source files against ${canonical.size} canonical shared module(s) [${[...canonical].join(", ")}]`,
    );
  }

  out.pass = out.violations.length === 0;
  return out;
}

function prove(): void {
  console.log("\n[R-DIST] --prove (anti-vacuity)");

  // byte-compare primitive
  proveAssert(!bytesEqual(Buffer.from("abc"), Buffer.from("abd")), "byte-compare DETECTS a 1-byte divergence");
  proveAssert(bytesEqual(Buffer.from("abc"), Buffer.from("abc")), "byte-compare ACCEPTS identical bundles");

  // build-script parser
  const parsed = parseBuildEntries(
    "esbuild foo.ts --bundle --platform=node --target=node18 --format=cjs --outfile=dist/foo.js && esbuild a/b.ts --bundle --format=cjs --outfile=a/dist/b.js",
  );
  proveAssert(parsed.length === 2 && parsed[1].outfile === "a/dist/b.js", "build-script parser extracts entry→outfile triples");

  // import canonicality — PLANTED CONTROL
  const canonical = new Set(["bm25", "graph-scoring", "share-set", "safe-object"]);

  const planted = detectNonCanonicalImports(
    "scripts/learn/kg-query.ts",
    'import { bm25Score } from "../dup/bm25";\n', // a left-behind duplicate copy
    canonical,
  );
  proveAssert(
    planted.length === 1 && planted[0].basename === "bm25",
    'PLANTED CONTROL: importing "../dup/bm25" (a non-canonical copy) while scripts/lib/shared/bm25.ts is canonical TRIPS the rail',
  );

  const canonicalImport = detectNonCanonicalImports(
    "scripts/learn/kg-query.ts",
    'import { bm25Score } from "../lib/shared/bm25";\n', // resolves into scripts/lib/shared/
    canonical,
  );
  proveAssert(
    canonicalImport.length === 0,
    "importing from scripts/lib/shared/bm25 (the canonical home) PASSES the canonicality check",
  );

  // an import of a non-canonical concern is ignored
  const unrelated = detectNonCanonicalImports(
    "scripts/foo.ts",
    'import { x } from "./helpers/util";\n',
    canonical,
  );
  proveAssert(unrelated.length === 0, "an import whose basename is not a canonical concern is ignored");

  // the canonical floor itself never flags its own neighbour imports
  const floorSelf = detectNonCanonicalImports(
    "scripts/lib/shared/graph-scoring.ts",
    'import { bm25Score } from "./bm25";\n',
    canonical,
  );
  proveAssert(floorSelf.length === 0, "the shared/ floor itself is exempt (it is the canonical home)");

  // RE-EXPORT SHIM exemption — a target that only re-exports the canonical floor is
  // canonical, so importing it is allowed (the real mcp-servers/guild-memory/src/bm25.ts case).
  const shimContent = 'export { bm25Score } from "../../../scripts/lib/shared/bm25";\n';
  proveAssert(
    isReExportShim("mcp-servers/guild-memory/src/bm25.ts", shimContent),
    "isReExportShim recognises a pure re-export of the canonical floor",
  );
  const viaShim = detectNonCanonicalImports(
    "mcp-servers/guild-memory/src/index.ts",
    'import { bm25Score } from "./bm25";\n',
    canonical,
    (t) => (t === "mcp-servers/guild-memory/src/bm25.ts" ? shimContent : null),
  );
  proveAssert(
    viaShim.length === 0,
    "importing a re-export SHIM that points at the canonical floor PASSES (not a duplicate copy)",
  );

  // a target that has LOCAL LOGIC (a real duplicate implementation) is NOT a shim → flagged
  const realDup = 'export function bm25Score(q, d) { return 0; }\n'; // a genuine second copy
  proveAssert(
    !isReExportShim("scripts/dup/bm25.ts", realDup),
    "isReExportShim rejects a file carrying a local implementation (a real duplicate)",
  );
  const viaDup = detectNonCanonicalImports(
    "scripts/learn/kg-query.ts",
    'import { bm25Score } from "../dup/bm25";\n',
    canonical,
    (t) => (t === "scripts/dup/bm25.ts" ? realDup : null),
  );
  proveAssert(
    viaDup.length === 1,
    "PLANTED CONTROL: importing a non-shim duplicate copy (local bm25Score body) still TRIPS even with a resolver",
  );
}

if (require.main === module) {
  if (process.argv.includes("--prove")) prove();
  else process.exit(report(run()));
}
