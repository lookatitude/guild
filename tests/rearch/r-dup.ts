/**
 * R-DUP — duplication rail (STRICT).
 *
 * §4 enforcement rail: a known duplicated concern must collapse to ONE canonical
 * implementation. Each signature below is a distinctive substring of a concern that
 * Wave-1 (tooling-engineer) consolidated into scripts/lib/shared/. The rail counts how
 * many CANONICAL SOURCE files contain the signature; the concern is GREEN only when the
 * signature lives in exactly one file — the canonical home — and that canonical file is
 * present among the hits.
 *
 * SCOPING (codex G-lane fix #1):
 *   - Match scope = real source under scripts/ + mcp-servers/ + hooks/ + src/, EXCLUDING:
 *       · *.test.ts  — parity/equivalence tests legitimately re-state a signature (a
 *         REF copy, a DIVERGENT copy) to assert the canonical body matches; counting
 *         them is a false positive (the original substring matcher tripped on
 *         graph-scoring-parity.test.ts + safe-object-parity.test.ts).
 *       · generated resources/ projections — installed-payload mirrors are checked
 *         independently by R-DIST and are not a second canonical implementation.
 *       · canonical module homes are the surviving hits we ASSERT are present, not
 *         violations. During the module reorg, some canonical homes move under src/modules
 *         while scripts/lib/shared keeps compatibility shims.
 *   - A concern is RED if it appears in >1 non-test source file, OR if the canonical
 *     file is NOT among the hits (the dedup pointed at the wrong home / lost the body).
 *
 * Anti-vacuity / planted control (codex fix #1): `--prove` plants the literal
 * `export const __DUP_PROBE__ = 1` into TWO synthetic source files and asserts the rail
 * TRIPS; removing it from one (→ single-source) asserts it goes CLEAN; and a hit set
 * missing the canonical file is asserted RED.
 */
import { REPO, RailResult, report, walk, read, rel, proveAssert } from "./_common";
import * as path from "path";

interface DupSig {
  id: string;
  /** Distinctive substring (plain text, matched with String.includes — no regex). */
  signature: string;
  /** Canonical destination W1 established. After W1 the signature lives only here. */
  canonical: string;
}

/** The four concerns W1 collapsed (see spawn-w1.sh P_TOOL units 1–4). */
export const DUP_SIGS: DupSig[] = [
  {
    id: "bm25-scorer",
    signature: "export function bm25Score(",
    canonical: "src/modules/knowledge/workflows/bm25.ts",
  },
  {
    id: "kg-graph-scoring",
    // the term-scoring haystack line shared by kg-query.ts scoreNode + recall.ts scoreKgNode
    signature: '(node.source_refs ?? []).join(" ")}`.toLowerCase()',
    canonical: "src/modules/knowledge/workflows/graph-scoring.ts",
  },
  {
    id: "scrub-share-set",
    // The share-set membership concern (formerly the keep-in-sync literal duplicated in
    // scrub.ts + audit.ts). W1 collapsed it to a single canonical API; we match the
    // canonical exported function (a stable, reformatting-proof signature — the pre-W1
    // single-line literal was reflowed multi-line, so a literal-substring match is brittle).
    // A re-introduced duplicate of the concern would re-declare inShareSet().
    signature: "export function inShareSet(",
    canonical: "src/modules/security/workflows/share-set.ts",
  },
  {
    id: "proto-poison-keys",
    // MATCHES THE KEY LIST, NOT ITS WRAPPER — the same brittleness lesson recorded
    // for scrub-share-set directly above, learned again the same way. This read
    // `new Set([...])` until feature/deep-freeze-collections sealed the canonical
    // body into `sealSet([...], "PROTO_POISON_KEYS")` (#22). The wrapper changed,
    // the signature did not, and the rail went RED reporting ZERO hits — "dedup lost
    // the canonical body" — when nothing had been lost at all.
    //
    // That branch is RED on this rail on its own tip, before any merge; the
    // integration only surfaced it. The list itself is what a copy-paste duplicate
    // actually carries, so matching it is both wrapper-proof and STRICTLY STRONGER
    // than the old signature: an inline `new Set([...])` copy, a `sealSet([...])`
    // copy, and a bare array copy all now hit, where only the first did before.
    signature: '["__proto__", "prototype", "constructor"]',
    canonical: "src/modules/security/workflows/safe-object.ts",
  },
];

export interface DupFinding {
  id: string;
  /** non-test source files (incl. the canonical floor) containing the signature. */
  hits: string[];
  /** true iff the canonical file is among the hits. */
  canonicalPresent: boolean;
  reason: "too-many" | "canonical-missing";
}

/** A path is a test file we must NOT count toward duplication. */
export function isTestPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return /\.test\.ts$/.test(p) || p.includes("/__tests__/");
}

/** A generated installed-resource projection is not canonical source. */
export function isGeneratedResourceProjectionPath(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  return p.startsWith("src/modules/") && p.includes("/resources/");
}

/**
 * Pure detector. `files` is filename→content over the REAL source scope (tests already
 * filtered by the caller). A concern is a violation when either:
 *   - it appears in more than one NON-TEST source file (genuine duplication), or
 *   - the canonical file is not among the hits (the canonical body went missing).
 */
export function detectDups(files: Map<string, string>, sigs: DupSig[]): DupFinding[] {
  const out: DupFinding[] = [];
  for (const sig of sigs) {
    const hits: string[] = [];
    for (const [name, content] of files) {
      if (isTestPath(name)) continue; // exclude tests from the match scope
      if (isGeneratedResourceProjectionPath(name)) continue;
      if (content.includes(sig.signature)) hits.push(name);
    }
    const canonicalPresent = hits.some((h) => h.replace(/\\/g, "/") === sig.canonical);
    if (hits.length > 1) {
      out.push({ id: sig.id, hits, canonicalPresent, reason: "too-many" });
    } else if (hits.length === 1 && !canonicalPresent) {
      // single source, but it is NOT the canonical home → wrong surviving hit
      out.push({ id: sig.id, hits, canonicalPresent, reason: "canonical-missing" });
    } else if (hits.length === 0) {
      // signature gone entirely — canonical body lost (also a regression)
      out.push({ id: sig.id, hits, canonicalPresent: false, reason: "canonical-missing" });
    }
  }
  return out;
}

const SOURCE_DIRS = ["scripts", "mcp-servers", "hooks", "src"];

export function run(): RailResult {
  const files = new Map<string, string>();
  for (const d of SOURCE_DIRS) {
    for (const f of walk(path.join(REPO, d), (n) => n.endsWith(".ts"))) {
      files.set(rel(f), read(f));
    }
  }
  const findings = detectDups(files, DUP_SIGS);
  const out: RailResult = {
    rail: "R-DUP",
    pass: findings.length === 0,
    advisory: false,
    violations: [],
    notes: [
      `scanned ${files.size} .ts source files under ${SOURCE_DIRS.join(", ")} (test files excluded from match scope)`,
      `${DUP_SIGS.length} concerns; GREEN when each lives in exactly the canonical file (generated resources excluded)`,
    ],
  };
  for (const v of findings) {
    const sig = DUP_SIGS.find((s) => s.id === v.id)!;
    if (v.reason === "too-many") {
      out.violations.push(
        `[${v.id}] DUPLICATED across ${v.hits.length} non-test source files (expected only ${sig.canonical}): ${v.hits.join(", ")}`,
      );
    } else {
      out.violations.push(
        `[${v.id}] canonical home ${sig.canonical} NOT among the ${v.hits.length} hit(s) [${v.hits.join(", ") || "none"}] — dedup lost the canonical body`,
      );
    }
  }
  return out;
}

function prove(): void {
  console.log("\n[R-DUP] --prove (anti-vacuity / planted control)");
  const probeSig: DupSig = {
    id: "dup-probe",
    signature: "export const __DUP_PROBE__ = 1",
    canonical: "scripts/lib/shared/probe.ts",
  };

  // PLANTED CONTROL: the probe literal in TWO source files must TRIP the rail.
  const planted = new Map<string, string>([
    ["scripts/lib/shared/probe.ts", "export const __DUP_PROBE__ = 1;"],
    ["scripts/recall.ts", "export const __DUP_PROBE__ = 1; // planted duplicate"],
  ]);
  const trip = detectDups(planted, [probeSig]);
  proveAssert(
    trip.length === 1 && trip[0].reason === "too-many",
    "PLANTED CONTROL: `export const __DUP_PROBE__ = 1` in TWO source files TRIPS the rail",
  );

  // Removing it from the non-canonical file → single-source on the canonical home → CLEAN.
  const removed = new Map<string, string>([
    ["scripts/lib/shared/probe.ts", "export const __DUP_PROBE__ = 1;"],
    ["scripts/recall.ts", "export const x = 1; // probe removed"],
  ]);
  proveAssert(
    detectDups(removed, [probeSig]).length === 0,
    "control removed → single-source on the canonical file → rail goes CLEAN",
  );

  // The surviving hit MUST be the canonical file: if the only hit is a non-canonical
  // file, the rail is RED (dedup pointed at the wrong home).
  const wrongHome = new Map<string, string>([
    ["scripts/recall.ts", "export const __DUP_PROBE__ = 1;"],
  ]);
  const wrong = detectDups(wrongHome, [probeSig]);
  proveAssert(
    wrong.length === 1 && wrong[0].reason === "canonical-missing",
    "rail is RED when the single surviving hit is NOT the canonical file",
  );

  // Test files are EXCLUDED from the match scope (the false positive codex caught):
  // canonical file + a *.test.ts both carrying the signature → still single-source → CLEAN.
  const withTest = new Map<string, string>([
    ["scripts/lib/shared/probe.ts", "export const __DUP_PROBE__ = 1;"],
    ["scripts/__tests__/probe-parity.test.ts", "const REF = `export const __DUP_PROBE__ = 1`;"],
  ]);
  proveAssert(
    detectDups(withTest, [probeSig]).length === 0,
    "test files are EXCLUDED from the match scope (parity tests are not counted as duplicates)",
  );
  const withGeneratedProjection = new Map<string, string>([
    ["src/modules/knowledge/workflows/probe.ts", "export const __DUP_PROBE__ = 1;"],
    [
      "src/modules/host-runtime/resources/src/modules/knowledge/workflows/probe.ts",
      "export const __DUP_PROBE__ = 1;",
    ],
  ]);
  const generatedProbe: DupSig = {
    ...probeSig,
    canonical: "src/modules/knowledge/workflows/probe.ts",
  };
  proveAssert(
    detectDups(withGeneratedProjection, [generatedProbe]).length === 0,
    "generated resource projections are EXCLUDED from canonical-source duplication counts",
  );
  proveAssert(
      isTestPath("scripts/__tests__/graph-scoring-parity.test.ts") &&
      isTestPath("scripts/foo.test.ts") &&
      !isTestPath("src/modules/knowledge/workflows/graph-scoring.ts") &&
      isGeneratedResourceProjectionPath(
        "src/modules/host-runtime/resources/src/modules/knowledge/workflows/graph-scoring.ts",
      ) &&
      !isGeneratedResourceProjectionPath("src/modules/knowledge/workflows/graph-scoring.ts"),
    "isTestPath classifies *.test.ts and /__tests__/ as tests, real source as non-test",
  );
}

if (require.main === module) {
  if (process.argv.includes("--prove")) {
    prove();
  } else {
    process.exit(report(run()));
  }
}
