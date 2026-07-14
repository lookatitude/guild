/**
 * R-REACH — script/lib reachability rail.
 *
 * Flags:
 *   (a) a top-level `scripts/*.ts` file, or
 *   (b) a top-level `scripts/lib/*.ts` module over 5KB,
 * that has ZERO importers/invocations anywhere in the repo OUTSIDE of:
 *   - any `__tests__/` directory (its own or any other jest test file — a
 *     green isolation test is not a real caller; see the repo's own
 *     "injected-seam tests mask real-path misses" lesson, hit twice already),
 *   - any `resources/` directory (the module-resource mirrors under each
 *     `src/modules/<id>/resources/` tree — byte-identical copies of the SAME
 *     file; a passive copy is not a consumer),
 *   - the candidate file itself.
 *
 * A "reference" is a textual match of the file's basename in a plausible
 * import/require specifier OR a literal invocation path (a skill's
 * "Usage: npx tsx scripts/foo.ts" line, a hook's spawn argument, a CI
 * workflow step, a package.json script, a module manifest's `owns.scripts`
 * entry). This is a LINT, not a type-checker — like every other rail in this
 * suite it trades perfect precision for a fast, dependency-free scan that
 * catches the class of defect this audit found ~20 instances of:
 * plugin-implementation-audit-2026-07-12, GENERALIZE — "Add a lightweight
 * 'reachability' rail (like r-vac) that fails when a scripts/*.ts CLI or a
 * >5KB scripts/lib module has no importer outside __tests__/ and resources
 * mirrors — this audit found ~20 such files, and the pattern keeps
 * recurring."
 *
 * SCOPE NOTE: this rail matches the audit's literal wording — direct
 * children of `scripts/` and `scripts/lib/` only, NOT the domain packages
 * (`scripts/learn/**`, `scripts/dot-guild/**`, `scripts/workspace/**`,
 * `scripts/docs-hygiene/**`) or nested lib dirs (`scripts/lib/shared/**`,
 * `scripts/lib/core/**`). Those already have their own tracked audit findings
 * (dead CLIs inside scripts/learn, scripts/workspace, scripts/docs-hygiene);
 * folding them into this rail is a natural follow-up for its NEXT cycle, not
 * silent scope creep now.
 *
 * ALLOWLIST: a small, reason-carrying, review-dated exemption list (below).
 * Every entry needs BOTH a `reason` and a `reviewBy` (YYYY-MM-DD). An entry
 * whose `reviewBy` date has passed is EXPIRED and reported as a violation
 * again — an unreviewed "trust me" is itself a defect.
 *
 * GRADUATION: this rail ships ADVISORY-first (see `ADVISORY` below) — the
 * audit-remediation wave that introduced it (2026-07) found the live tree
 * mid-cleanup by several concurrent lanes, so a first run needed the
 * allowlist rather than a hard gate. Flip `ADVISORY` to `false` (and update
 * run-all.ts's STRICT rail list + docstring) once one full cycle runs with
 * zero unallowlisted findings.
 *
 * Anti-vacuity: `--prove` runs the pure detector against a synthetic corpus:
 * a candidate with a real (non-test, non-mirror) importer is ACCEPTED; one
 * with no real importer is FLAGGED; an ALLOWLIST entry suppresses a finding;
 * an EXPIRED allowlist entry does not.
 */
import { REPO, RailResult, report, walk, read, rel, proveAssert } from "./_common";
import * as fs from "fs";
import * as path from "path";

// ── ADVISORY / graduation switch — see header GRADUATION note ────────────────
const ADVISORY = true;

const SCRIPTS_DIR = path.join(REPO, "scripts");
const LIB_DIR = path.join(SCRIPTS_DIR, "lib");
const SIZE_THRESHOLD_BYTES = 5 * 1024;

// A file counts as corpus (scanned for references) if it has one of these
// extensions — the realistic set of places a script gets wired from
// (code, docs/skills, CI, shell, and hand-authored JSON manifests).
const CORPUS_EXT_RE = /\.(ts|js|md|yml|yaml|sh|json)$/;

/**
 * Files that are pure INVENTORY/ownership bookkeeping — they enumerate every
 * script that exists (dead or wired) by name, so a naive text-match against
 * them "finds" a reference to literally everything and defeats the rail.
 * package-lock.json is excluded for the unrelated reason that it is huge and
 * never a wiring signal either way.
 */
const NON_WIRING_BASENAMES = new Set([
  "package-lock.json",
  "guild.inventory.json",
  "module.manifest.json",
  "module-resources.json",
]);

function isCorpusFile(name: string): boolean {
  if (NON_WIRING_BASENAMES.has(name)) return false;
  return CORPUS_EXT_RE.test(name);
}

// ── Allowlist ─────────────────────────────────────────────────────────────────

export interface AllowlistEntry {
  /** Path relative to the plugin repo root, e.g. "scripts/evolve-loop.ts". */
  path: string;
  /** Why this file is legitimately dormant right now (not "TODO" / "leave it"). */
  reason: string;
  /** ISO date (YYYY-MM-DD) by which this exemption must be re-reviewed. */
  reviewBy: string;
}

/**
 * Known-legitimately-dormant files as of this rail's introduction
 * (plugin-audit-remediation, lane G9, 2026-07-13). Re-validate at `reviewBy`.
 *
 * NOTE: several files the original audit flagged as dead (the init-guild
 * cluster, failure-ingestion, counterfactual-replay, trace-replay,
 * sqlite-projections, dependency-graph-reader/schema, etc.) were removed
 * entirely by concurrent cleanup lanes in this same remediation wave and no
 * longer exist on disk — they need no entry here.
 */
export const ALLOWLIST: AllowlistEntry[] = [
  {
    path: "scripts/lib/skill-source-transform.ts",
    reason:
      "skill-src/skill-registry.json neutral-registry pilot (ADR step 15) is a stalled-but-intentional " +
      "pilot per the audit (skills/meta area, medium/incomplete-wiring) — owned by skill-author, not a " +
      "silent dead-code case; tracked separately, not this lane's call to delete or wire.",
    reviewBy: "2026-10-01",
  },
];

function findAllowlistEntry(relPath: string): AllowlistEntry | undefined {
  return ALLOWLIST.find((e) => e.path === relPath);
}

export function isExpired(entry: AllowlistEntry, todayIso: string): boolean {
  return entry.reviewBy < todayIso;
}

// ── Reference detection (pure) ────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * PATH form — a plausible import/require specifier or slashed path ending in
 * `basename`, requiring a SLASH-OR-QUOTE boundary (`/'"`) immediately before
 * it, so a bare English word cannot false-positive. Extension is optional
 * (import specifiers usually omit it).
 *
 * Deliberately does NOT include backtick in the leading-boundary set: this
 * codebase's own doc convention is to backtick-cite a filename in a comment
 * (`` `skill-source-transform.ts helper()` ``) purely as a cross-reference,
 * not an invocation — that citation form is handled by the bare-CLI path
 * below, which additionally REQUIRES a same-line CLI-runner cue.
 */
function pathFormRegex(basename: string): RegExp {
  const b = escapeRegExp(basename);
  return new RegExp(`[\\/'"]${b}(?:\\.(?:ts|js))?(?=[\\/'"\`)\\s.,;:]|$)`, "m");
}

/**
 * BARE-CLI form — `basename.ts` / `basename.js` with the LITERAL extension
 * present, allowed after a plain whitespace boundary (or start-of-content) —
 * this is how npm scripts invoke a sibling file (`"npx tsx build-verify.ts"`
 * in scripts/package.json has no leading slash). The mandatory extension is
 * what keeps this form from matching ordinary prose ("the retention window"
 * has no `.ts`/`.js` suffix).
 *
 * This form alone is still too loose: a doc COMMENT that merely cites a
 * filename with its extension (`` * skill-source-transform.ts `helper()` ``)
 * matches it too, without being a real invocation — the comment-cross-
 * reference analog of the "injected-seam test" defect this rail targets. So
 * a bare-CLI match only counts when its OWN LINE also contains a CLI-runner
 * cue (`tsx` or `node`) — a real invocation line ("npx tsx foo.ts", "node
 * foo.js") always carries one; a doc cross-reference comment normally does
 * not.
 */
function bareCliFormRegex(basename: string): RegExp {
  const b = escapeRegExp(basename);
  return new RegExp(`(?:^|[\\s\\/'"\`])${b}\\.(?:ts|js)(?=[\\/'"\`)\\s.,;:]|$)`, "gm");
}

const CLI_RUNNER_CUE_RE = /\b(?:tsx|node)\b/i;

/** True iff `content` contains a bare-CLI-form match whose OWN LINE also carries a CLI-runner cue. */
function hasCliInvocationLine(basename: string, content: string): boolean {
  const re = bareCliFormRegex(basename);
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const lineStart = content.lastIndexOf("\n", m.index) + 1;
    const lineEndIdx = content.indexOf("\n", m.index);
    const line = content.slice(lineStart, lineEndIdx === -1 ? content.length : lineEndIdx);
    if (CLI_RUNNER_CUE_RE.test(line)) return true;
  }
  return false;
}

/** Combined matcher: PATH form (any occurrence) OR a genuine bare-CLI invocation line. */
export function isReferenced(basename: string, content: string): boolean {
  return pathFormRegex(basename).test(content) || hasCliInvocationLine(basename, content);
}

export interface CorpusFile {
  relPath: string;
  content: string;
}

/**
 * Pure detector: which corpus files reference `candidateRelPath`, excluding
 * the candidate itself, any path under a `__tests__` segment, and any path
 * under a `resources` segment.
 */
export function findReferences(candidateRelPath: string, corpus: CorpusFile[]): string[] {
  const basename = path.basename(candidateRelPath).replace(/\.ts$/, "");
  const refs: string[] = [];
  for (const f of corpus) {
    if (f.relPath === candidateRelPath) continue;
    const segs = f.relPath.split(/[\\/]/);
    if (segs.includes("__tests__")) continue;
    if (segs.includes("resources")) continue;
    // A *.test.ts file is a test by NAMING CONVENTION regardless of which
    // directory it lives in — tests/universal-host/*.test.ts is exactly as
    // much an isolation test as scripts/__tests__/*.test.ts; both must be
    // excluded or a test suite living outside a literal `__tests__/` dir
    // (this repo has several: tests/universal-host, tests/rearch itself,
    // tests/trigger, tests/boundary) would silently launder a dead module as
    // "referenced" the moment its own test imports it (real near-miss this
    // rail's first live run hit: skill-source-transform.ts is imported only
    // by tests/universal-host/p2-w2-sc*.test.ts, which the audit itself
    // calls "test-only").
    if (/\.test\.ts$/.test(f.relPath)) continue;
    if (isReferenced(basename, f.content)) refs.push(f.relPath);
  }
  return refs;
}

// ── Candidate enumeration ──────────────────────────────────────────────────────

function listTopLevelScripts(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(SCRIPTS_DIR, e.name));
}

function listTopLevelLibModulesOverThreshold(): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(LIB_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => path.join(LIB_DIR, e.name))
    .filter((f) => {
      try {
        return fs.statSync(f).size > SIZE_THRESHOLD_BYTES;
      } catch {
        return false;
      }
    });
}

// ── Rail entrypoint ────────────────────────────────────────────────────────────

export function run(): RailResult {
  const out: RailResult = { rail: "R-REACH", pass: true, advisory: ADVISORY, violations: [], notes: [] };

  const scriptCandidates = listTopLevelScripts();
  const libCandidates = listTopLevelLibModulesOverThreshold();
  const candidates: { abs: string; kind: "script" | "lib" }[] = [
    ...scriptCandidates.map((abs) => ({ abs, kind: "script" as const })),
    ...libCandidates.map((abs) => ({ abs, kind: "lib" as const })),
  ];

  const corpusAbsFiles = walk(REPO, isCorpusFile);
  const corpus: CorpusFile[] = corpusAbsFiles.map((f) => ({ relPath: rel(f), content: read(f) }));
  const todayIso = new Date().toISOString().slice(0, 10);

  let flagged = 0;
  let allowlistedActive = 0;
  let allowlistedExpired = 0;

  for (const { abs, kind } of candidates) {
    const relPath = rel(abs);
    const refs = findReferences(relPath, corpus);
    if (refs.length > 0) continue; // reachable — nothing to report

    const entry = findAllowlistEntry(relPath);
    if (entry) {
      if (isExpired(entry, todayIso)) {
        allowlistedExpired++;
        out.violations.push(
          `${relPath}: ALLOWLIST ENTRY EXPIRED (reviewBy ${entry.reviewBy} has passed) — re-review: ${entry.reason}`,
        );
      } else {
        allowlistedActive++;
        out.notes.push(`allowlisted: ${relPath} — ${entry.reason} (review by ${entry.reviewBy})`);
      }
      continue;
    }

    let size = 0;
    try {
      size = fs.statSync(abs).size;
    } catch {
      /* unreadable — report with size 0 */
    }
    flagged++;
    out.violations.push(
      `${relPath} (${kind}, ${size}B): zero importers/invocations outside __tests__/, resources mirrors, and itself`,
    );
  }

  out.notes.push(
    `scanned ${candidates.length} candidate(s): ${scriptCandidates.length} top-level scripts/*.ts + ` +
      `${libCandidates.length} scripts/lib/*.ts module(s) over ${SIZE_THRESHOLD_BYTES}B, against a ` +
      `${corpus.length}-file corpus`,
  );
  out.notes.push(
    `${flagged} unreferenced (unallowlisted), ${allowlistedActive} allowlisted, ${allowlistedExpired} EXPIRED allowlist entrie(s)`,
  );
  out.notes.push(
    ADVISORY
      ? "ADVISORY for this cycle — flip ADVISORY (this file) + run-all.ts's rail list to STRICT after one clean run"
      : "STRICT — a scripts/*.ts CLI or >5KB scripts/lib module with zero real callers blocks CI",
  );
  out.pass = out.violations.length === 0;
  return out;
}

// ── Anti-vacuity self-test ────────────────────────────────────────────────────

function prove(): void {
  console.log("\n[R-REACH] --prove (anti-vacuity)");

  // (1) a candidate with a REAL (non-test, non-mirror) importer is accepted.
  const corpusWithRealImporter: CorpusFile[] = [
    { relPath: "scripts/foo.ts", content: "// candidate itself" },
    { relPath: "scripts/bar.ts", content: `import { thing } from "./foo";` },
  ];
  const refsFound = findReferences("scripts/foo.ts", corpusWithRealImporter);
  proveAssert(
    refsFound.length === 1 && refsFound[0] === "scripts/bar.ts",
    "a real importer (scripts/bar.ts importing './foo') is FOUND as a reference",
  );

  // (2) a candidate referenced ONLY from a __tests__ file and a resources
  // mirror is FLAGGED (zero real references) — the exact injected-seam pattern.
  const corpusSeamOnly: CorpusFile[] = [
    { relPath: "scripts/foo.ts", content: "// candidate itself" },
    { relPath: "scripts/__tests__/foo.test.ts", content: `import { thing } from "../foo";` },
    { relPath: "src/modules/x/resources/scripts/foo.ts", content: "// mirror copy" },
  ];
  const refsSeamOnly = findReferences("scripts/foo.ts", corpusSeamOnly);
  proveAssert(
    refsSeamOnly.length === 0,
    "PLANTED CONTROL: a candidate referenced only from __tests__/ and a resources/ mirror has ZERO real references",
  );

  // (3) a doc-string invocation mention (no import syntax) still counts as a
  // real reference — e.g. a skill's "Usage: npx tsx scripts/foo.ts" line.
  const corpusDocMention: CorpusFile[] = [
    { relPath: "scripts/foo.ts", content: "// candidate itself" },
    { relPath: "skills/meta/thing/SKILL.md", content: "Usage: npx tsx scripts/foo.ts --run-id <id>" },
  ];
  const refsDoc = findReferences("scripts/foo.ts", corpusDocMention);
  proveAssert(
    refsDoc.length === 1,
    "a plain-prose invocation mention (skill doc 'npx tsx scripts/foo.ts') counts as a real reference",
  );

  // (4) basename boundary correctness: "scripts/lib/retention.ts" must not be
  // falsely matched by unrelated prose containing the bare word "retention".
  const corpusFalsePositiveGuard: CorpusFile[] = [
    { relPath: "scripts/lib/retention.ts", content: "// candidate itself" },
    { relPath: "docs/some-doc.md", content: "The retention window for old data is 90 days." },
  ];
  const refsFalsePositive = findReferences("scripts/lib/retention.ts", corpusFalsePositiveGuard);
  proveAssert(
    refsFalsePositive.length === 0,
    "a bare English word ('retention window') is NOT matched as a path reference (boundary-anchored regex)",
  );

  // (5b) bare-CLI form: an npm script invoking a sibling file with NO leading
  // path ("npx tsx build-verify.ts" in scripts/package.json) still counts —
  // this is a real near-miss the first live run hit (build-verify.ts was
  // wrongly flagged until this form was added).
  const corpusBareCli: CorpusFile[] = [
    { relPath: "scripts/build-verify.ts", content: "// candidate itself" },
    { relPath: "scripts/package.json", content: '{"scripts":{"build:verify":"npx tsx build-verify.ts"}}' },
  ];
  proveAssert(
    findReferences("scripts/build-verify.ts", corpusBareCli).length === 1,
    "a bare 'npx tsx build-verify.ts' npm-script invocation (no leading path) counts as a real reference",
  );
  // ...and the same bare word WITHOUT the .ts/.js extension still does not
  // false-positive against prose (the extension is what makes form 2 safe).
  const corpusBareWordNoExt: CorpusFile[] = [
    { relPath: "scripts/build-verify.ts", content: "// candidate itself" },
    { relPath: "docs/some-doc.md", content: "please build-verify your changes before shipping" },
  ];
  proveAssert(
    findReferences("scripts/build-verify.ts", corpusBareWordNoExt).length === 0,
    "a bare mention with NO .ts/.js extension does NOT count (avoids prose false positives)",
  );

  // (4b) a *.test.ts file OUTSIDE a `__tests__/` directory (e.g.
  // tests/universal-host/foo.test.ts) is STILL a test by naming convention —
  // real near-miss: skill-source-transform.ts is imported only by
  // tests/universal-host/*.test.ts, which is not under __tests__/.
  const corpusNamedTestOutsideDir: CorpusFile[] = [
    { relPath: "scripts/lib/foo.ts", content: "// candidate itself" },
    {
      relPath: "tests/universal-host/some-equivalence.test.ts",
      content: `import { render } from "../../scripts/lib/foo";`,
    },
  ];
  proveAssert(
    findReferences("scripts/lib/foo.ts", corpusNamedTestOutsideDir).length === 0,
    "PLANTED CONTROL: a *.test.ts file outside __tests__/ is still excluded (naming convention, not directory name)",
  );

  // (5c) a doc COMMENT that merely cites "foo.ts" with its extension (no CLI
  // cue on that line) is NOT a real invocation — real near-miss:
  // command-registry.ts says "` skill-source-transform.ts assertStagingPath`"
  // in a comment, which is a cross-reference, not a call.
  const corpusCommentCitation: CorpusFile[] = [
    { relPath: "scripts/lib/foo.ts", content: "// candidate itself" },
    {
      relPath: "scripts/lib/bar.ts",
      content: "// HARDENED to the `foo.ts assertStagingPath` standard.",
    },
  ];
  proveAssert(
    findReferences("scripts/lib/foo.ts", corpusCommentCitation).length === 0,
    "PLANTED CONTROL: a doc-comment citing 'foo.ts' with no tsx/node cue on the same line is NOT a real reference",
  );
  // ...but a REAL invocation line with the same "foo.ts" text DOES count.
  const corpusRealInvocationLine: CorpusFile[] = [
    { relPath: "scripts/lib/foo.ts", content: "// candidate itself" },
    { relPath: "hooks/dispatch.ts", content: 'execFileSync("npx", ["tsx", "foo.ts"]);' },
  ];
  proveAssert(
    findReferences("scripts/lib/foo.ts", corpusRealInvocationLine).length === 1,
    "a real invocation line ('npx', 'tsx', 'foo.ts' together) IS a real reference",
  );

  // (5) inventory/ownership bookkeeping files must not manufacture a false
  // reference — every script is named in SOME module.manifest.json / the
  // root guild.inventory.json regardless of whether anything actually calls
  // it (this is the exact near-miss this rail's first live run hit: it
  // reported 0 findings until these files were excluded from the corpus).
  proveAssert(!isCorpusFile("module.manifest.json"), "module.manifest.json is EXCLUDED from the corpus (pure ownership bookkeeping)");
  proveAssert(!isCorpusFile("guild.inventory.json"), "guild.inventory.json is EXCLUDED from the corpus (pure inventory bookkeeping)");
  proveAssert(!isCorpusFile("module-resources.json"), "module-resources.json is EXCLUDED (generated hash manifest, not wiring)");
  proveAssert(isCorpusFile("SKILL.md"), "a real doc file (SKILL.md) IS in the corpus");

  // (6) allowlist suppression + expiry.
  const activeEntry: AllowlistEntry = { path: "scripts/foo.ts", reason: "test", reviewBy: "2099-01-01" };
  proveAssert(!isExpired(activeEntry, "2026-07-13"), "an allowlist entry with a future reviewBy is NOT expired");
  const expiredEntry: AllowlistEntry = { path: "scripts/foo.ts", reason: "test", reviewBy: "2020-01-01" };
  proveAssert(isExpired(expiredEntry, "2026-07-13"), "an allowlist entry with a past reviewBy IS expired");
}

if (require.main === module) {
  if (process.argv.includes("--prove")) prove();
  else process.exit(report(run()));
}
