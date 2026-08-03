#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/audit.ts — share-dot-guild dry-run audit (SC-7, SC-11).
 *
 * Runs scrub.ts --dry-run over each repo's .guild/runs/ and emits a markdown report.
 * Exit 0 = no actionable flags; exit 1 = operator-path or secret flags found (CI fail).
 *
 * FAIL-CLOSED (T6B-R2-B1). The scrub coverage pass is a SECURITY gate, so "the scrub
 * never ran" must never render as "no actionable flags". Three properties hold:
 *   1. scrub.ts is launched through a REPOSITORY/PACKAGE-LOCAL runtime (the tsx CLI
 *      resolved from this repo's own node_modules), never through ambient `npx` — an
 *      unreadable/root-owned ~/.npm cache can no longer decide whether the gate runs.
 *   2. spawn `error` AND non-zero/null `status` are both checked.
 *   3. the scrub's OWN summary marker must appear in the output — a runtime that exits
 *      0 without actually running scrub is still a failure.
 * Any of the three failing emits a `scrub-unavailable` flag: actionable ⇒ non-zero exit
 * + an explicit "scrub coverage could not run" message, and the report says FAIL-CLOSED
 * instead of "No actionable flags".
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/audit.ts [--workspace=<path>] [--repos=<csv>] [--output=<path>] [--tracked-only]
 *
 * Env: GUILD_TSX_RUNTIME=<path>  explicit runtime executable override for exotic hosts
 * where no node_modules/tsx is present. It is NOT an escape hatch: a bad override still
 * fails closed (spawn error / non-zero status / missing scrub summary marker).
 *
 * --tracked-only restricts every scan to `git ls-files`-tracked paths (skips the
 * untracked-file scanning legs) — a cheaper, noise-free gate for an
 * already-checked-out CI tree; the default (no flag) additionally scans
 * untracked-but-shareable files, which is the more thorough posture wanted for a
 * local pre-commit / build:verify run.
 */

import * as fs from "fs";
import { deepFreeze } from "../../src/modules/kernel/workflows/sealed-collections";
import * as path from "path";
import { spawnSync } from "child_process";
// Canonical single-source share-set membership (re-arch WAVE 1) — the former
// "keep in sync" mirror of scrub.ts (SCRUB_SHARED_NAMES + inScrubShareSet) is gone.
import { inShareSet } from "../lib/shared/share-set";
// Canonical single-source redaction applier (verified-multi-host-support L0 §6.4).
// The package/receipt leak scan (§7.2) runs the SAME `redact` the write path runs,
// in-memory, so the scan and the scrub can never drift.
import { redact } from "../lib/shared/scrub-redact";
// T4 dynamic-host-model-routing: coverage leg for the model-catalog discovery
// cache (.guild/indexes/model-catalog/ — guild.model_catalog.v1 §7). Cache
// entries are runtime-local machine state and must never be git-shared; a
// tracked/trackable cache file is an actionable flag (CI fail). This is the
// audit.ts half of the two-leg scrub-policy update (scrub.ts warns at scrub
// time with the same canonical path constants).
import {
  MODEL_CATALOG_CACHE_REL,
  modelCatalogCacheDir,
} from "../../src/modules/capability/workflows/catalog-cache";

const args = process.argv.slice(2);
const wsArg   = args.find(a => a.startsWith("--workspace="));
const reposArg = args.find(a => a.startsWith("--repos="));
const outArg  = args.find(a => a.startsWith("--output="));
// --tracked-only: skip the untracked-file scanning legs (findScrubCoverageGaps'
// disk walk, findNestedGuildLeaks' disk walk, findPackageReceiptLeaks' disk walk)
// and restrict every scan to `git ls-files`-tracked paths only. A raw filesystem
// walk over a local dev tree picks up untracked-but-not-yet-ignored scratch/build
// cruft that was never going to be committed (see the plugin-audit-remediation
// hygiene pass), which is noise for a gate that's supposed to answer "would this
// be shared" for an ALREADY-CHECKED-OUT tree (CI) rather than "could this
// accidentally be added" (the fuller local pre-commit posture, the default).
const trackedOnly = args.includes("--tracked-only");

// dot-guild/ → scripts/ → plugin/ → workspace = three "..".
const WORKSPACE = wsArg ? path.resolve(wsArg.split("=")[1]) : path.resolve(__dirname, "../../..");
// T7-H3/M1 fail-closed: a RELATIVE --repos entry resolves against --workspace, never
// against the process CWD (an earlier probe resolved `--repos=repo` to
// `<plugin-cwd>/repo` and reported a clean pass over a path that does not exist).
const repoList: string[] = (reposArg
  ? reposArg.split("=").slice(1).join("=").split(",").map(p => p.trim()).filter(Boolean)
  : [WORKSPACE]
).map(p => path.resolve(WORKSPACE, p));
const outputPath = outArg ? outArg.split("=")[1] : undefined;

export interface FileFlag { runId: string; file: string; kind: "operator-path" | "secret" | "payload-excluded" | "nested-guild" | "scrub-uncovered" | "receipt-operator-path" | "receipt-secret" | "catalog-cache-tracked" | "scrub-unavailable" | "audit-unavailable"; detail: string; }

// ── T7-H3 — the git probes fail CLOSED (audit-fail-open-on-subprocess-failure) ─
//
// `git check-ignore` exits 0 (some ignored), 1 (none ignored) or 128 (generic
// fatal). 128 is NOT a "not a git repo" signal: it is also what
// `safe.directory` dubious-ownership (ubiquitous in containers/CI), a corrupt
// `.git/config`/index, and an unreadable `.git` produce. The three call sites
// used to `continue`/`return` on 128, which SUBTRACTS flags — the report then
// rendered "No actionable flags — safe to proceed with SC-10 commits" over a
// tree carrying the machine-local fingerprint salt in the index.
//
// The fix mirrors T6B's `scrub-unavailable` posture exactly: any spawn error,
// and any non-zero/non-1 status, becomes an `audit-unavailable` ACTIONABLE flag
// (non-zero exit, FAIL-CLOSED banner). "Genuinely not a git repo" is determined
// POSITIVELY — never inferred from an error code.

/** The one shape of "a git-dependent leg of the audit could not run" — always actionable. */
function auditUnavailableFlag(repoPath: string, detail: string): FileFlag {
  return {
    runId: "(git)",
    file: repoPath,
    kind: "audit-unavailable",
    // Redact: git stderr / spawn messages can carry operator paths.
    detail: redact(`git-backed audit leg could not run over ${repoPath}: ${detail}`).out,
  };
}

/** Compact, redacted description of a failed `spawnSync` (error OR bad status). */
function spawnFailureDetail(
  argv: string,
  res: { error?: Error; status: number | null; signal?: NodeJS.Signals | null; stderr?: string },
): string {
  if (res.error) return `\`${argv}\` failed to launch: ${res.error.message}`;
  const tail = (res.stderr ?? "").trim().split("\n").slice(-3).join(" | ").slice(0, 300);
  const how = res.status === null ? `on signal ${res.signal}` : `status ${res.status}`;
  return `\`${argv}\` exited ${how}${tail ? ` — ${tail}` : ""}`;
}

/**
 * Is `p` inside a git work tree, determined WITHOUT consulting a git exit code?
 * Walks up looking for a `.git` entry (dir for a normal clone, file for a
 * worktree/submodule). This is the POSITIVE "not a git repo" determination the
 * audit needs so a broken-git tree can never masquerade as a non-repo.
 */
function hasGitDirUpward(p: string): boolean {
  let dir = path.resolve(p);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export type RepoGitStatus =
  | { kind: "repo" }
  | { kind: "missing" }
  | { kind: "not-a-repo" }
  | { kind: "unavailable"; detail: string };

/**
 * Classify a repo path for the git-backed legs. `repo` ⇒ probes may run;
 * `missing` / `unavailable` ⇒ FAIL CLOSED (actionable flag); `not-a-repo` ⇒ the
 * git legs are genuinely inapplicable (nothing is shareable via git) and are
 * skipped — but ONLY when the filesystem, not a git error code, says so.
 */
export function classifyRepoGit(repoPath: string): RepoGitStatus {
  if (!fs.existsSync(repoPath)) return { kind: "missing" };
  const res = spawnSync("git", ["-C", repoPath, "rev-parse", "--git-dir"], { encoding: "utf8" });
  if (!res.error && res.status === 0) return { kind: "repo" };
  if (!hasGitDirUpward(repoPath)) return { kind: "not-a-repo" };
  // A `.git` exists but git refuses to speak: dubious ownership, corrupt
  // config/index, unreadable .git. NEVER treated as "nothing shareable".
  return { kind: "unavailable", detail: spawnFailureDetail("git rev-parse --git-dir", res) };
}

/**
 * Result of a git probe. A SINGLE shape (not a discriminated union) on purpose:
 * this suite compiles under a non-strict ts-jest tsconfig where boolean-literal
 * discriminants do not narrow, and a security guard must not depend on that.
 * `ok === false` ⇒ `detail` explains why and the payload is EMPTY — callers must
 * never read an empty payload as "nothing is tracked / nothing is ignored".
 */
interface GitProbeResult<T> { ok: boolean; value: T; detail: string }

/** `git check-ignore --stdin -z` over `rels`, fail-closed on anything but 0/1. */
function checkIgnore(repoPath: string, rels: string[]): GitProbeResult<Set<string>> {
  const res = spawnSync("git", ["-C", repoPath, "check-ignore", "--stdin", "-z"], {
    input: rels.join("\0"),
    encoding: "utf8",
  });
  // 0 = some ignored, 1 = none ignored. ANY other status (128 included) or a
  // spawn error means trackability is UNKNOWN — never "nothing is shareable".
  if (res.error || (res.status !== 0 && res.status !== 1)) {
    return {
      ok: false,
      value: new Set<string>(),
      detail: spawnFailureDetail("git check-ignore --stdin -z", res),
    };
  }
  return {
    ok: true,
    value: new Set((res.stdout ?? "").split("\0").filter(Boolean)),
    detail: "",
  };
}

// SC-7 blind-spot guard: scrub.ts's share-set is now the canonical single-source
// module (scripts/lib/shared/share-set.ts, imported as inShareSet). audit.ts only
// parses scrub's per-file dry-run lines, so any run-dir file that is git-trackable
// (would be committed/shared) but OUTSIDE the share-set never reaches a redaction
// pass and silently escapes the SC-7 leak gate. The check below flags exactly
// those files — using the SAME share-set scrub uses (no drift possible).
// Control/meta files that are intentionally git-trackable but NOT redacted by
// scrub (they carry no operator content). share-payloads.flag is the per-run
// opt-in sentinel; .gitignore itself is allow-list config. Exempt so they do
// not false-positive as "uncovered".
const SCRUB_COVERAGE_EXEMPT_NAMES = new Set(["share-payloads.flag", ".gitignore"]);

/**
 * `git -C repoPath ls-files -z` → the set of repo-relative paths git actually
 * tracks. T7-H3: a failed `ls-files` used to return an EMPTY set, which
 * SUBTRACTS flags (every "is this tracked?" answer becomes "no"). It now
 * reports the failure so the caller can raise `audit-unavailable`.
 */
function trackedFileSetResult(repoPath: string): GitProbeResult<Set<string>> {
  const res = spawnSync("git", ["-C", repoPath, "ls-files", "-z"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    return {
      ok: false,
      value: new Set<string>(),
      detail: spawnFailureDetail("git ls-files -z", res),
    };
  }
  return {
    ok: true,
    value: new Set((res.stdout ?? "").split("\0").filter(Boolean)),
    detail: "",
  };
}

/**
 * Convenience wrapper for the legs that only need the set. `flags` collects an
 * `audit-unavailable` entry when git could not answer — the set is EMPTY in
 * that case, so the caller must never interpret it as "nothing is tracked".
 */
function trackedFileSetOrFlag(repoPath: string, flags: FileFlag[]): Set<string> {
  const res = trackedFileSetResult(repoPath);
  if (!res.ok) {
    flags.push(auditUnavailableFlag(repoPath, res.detail));
    return new Set<string>();
  }
  return res.value;
}

// SC-7 blind-spot guard: walk each run dir; for every file that git would track
// (NOT ignored = would be shared), flag it if scrub.ts has no coverage for it.
// Uses `git check-ignore` against the repo's allow-list — a non-zero exit means
// the path is NOT ignored, i.e. it WOULD be committed/shared.
function findScrubCoverageGaps(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const runsDir = path.join(repoPath, ".guild", "runs");
  if (!fs.existsSync(runsDir)) return flags;

  let runEntries: fs.Dirent[];
  try { runEntries = fs.readdirSync(runsDir, { withFileTypes: true }); } catch { return flags; }

  // --tracked-only: restrict to git ls-files output — a checked-out CI tree has
  // no untracked files anyway, so this is just a cheaper, noise-free equivalent
  // there; for a local dev tree it skips untracked scratch/build cruft entirely.
  const tracked = trackedOnlyMode ? trackedFileSetOrFlag(repoPath, flags) : null;

  for (const runEnt of runEntries) {
    if (!runEnt.isDirectory()) continue;
    const runDir = path.join(runsDir, runEnt.name);
    const hasFlag = fs.existsSync(path.join(runDir, "share-payloads.flag"));

    // Collect every file under this run dir.
    const files: string[] = [];
    (function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) files.push(full);
      }
    })(runDir);
    if (files.length === 0) continue;

    const rel = (p: string) => path.relative(repoPath, p);
    let shareable: (relToRepo: string) => boolean;
    if (tracked) {
      // tracked-only: "would be shared" ⇔ already tracked (no ignore-status guessing).
      shareable = (relToRepo) => tracked.has(relToRepo);
    } else {
      // Batch-query git for trackability: stdin = NUL-separated paths; stdout
      // lists the IGNORED ones. Anything absent from stdout is git-trackable.
      // T7-H3: an unusable answer is FAIL-CLOSED (`audit-unavailable`), never a
      // silent `continue` — a skipped run dir used to read as a clean one.
      const checked = checkIgnore(repoPath, files.map(rel));
      if (!checked.ok) {
        flags.push(auditUnavailableFlag(repoPath,
          `${checked.detail} (scrub-coverage leg over run "${runEnt.name}" — trackability unknown)`));
        continue;
      }
      const ignored = checked.value;
      shareable = (relToRepo) => !ignored.has(relToRepo);
    }

    for (const abs of files) {
      const relToRepo = rel(abs);
      if (!shareable(relToRepo)) continue;           // not ignored/tracked ⇒ not shared
      const base = path.basename(abs);
      if (SCRUB_COVERAGE_EXEMPT_NAMES.has(base)) continue;
      const relToRun = path.relative(runDir, abs);
      if (inShareSet(relToRun, hasFlag)) continue; // scrub covers it
      flags.push({
        runId: runEnt.name,
        file: relToRun,
        kind: "scrub-uncovered",
        detail: "git-trackable (would be shared) but outside scrub.ts's share-set — no redaction pass; SC-7 blind spot",
      });
    }
  }
  return flags;
}

// verified-multi-host-support L0 §7.2 — the REAL AC-SEC-1 package/receipt-tree leak
// scan. SEPARATE, PATH-ANCHORED from scrub.ts's `.guild/runs`-scoped share-set: this
// scan is anchored to the committed evidence stores (`evidence/host-smoke`, ADR §6.1,
// plus desktop app command-smoke receipts under `evidence/desktop-app-smoke`)
// — it does NOT widen share-set.ts's SHARED_SCRUBBED_NAMES (that basename set is one
// function on two call sites; widening it would leak these basenames into the runs
// share-set — security round-3 F2). The narrow-allowlisted paths here are DISJOINT
// from /dist/ (fully .gitignore-ignored, regenerated) so the runs scan and this scan
// neither overlap nor gap.
const PACKAGE_RECEIPT_SCAN_ROOTS = ["evidence/host-smoke", "evidence/desktop-app-smoke"];

// §7.2 exact file selection — mirrors the existing `.guild/runs` coverage guard
// (findScrubCoverageGaps): walk the anchored root on disk (local build:verify sees
// tracked+staged+untracked; CI's checkout has only tracked files, so the SAME code
// naturally sees only tracked), then batch-query `git check-ignore --stdin -z` and
// scan ONLY the files git would track (would be shared). Per non-ignored file run the
// SHARED `redact` in-memory and flag an operator-path finding iff `opPaths > 0` and a
// secret finding iff `secrets.length > 0` (round-2 minor: the two counters are
// INDEPENDENT — never conflated; `out === content` is L8's separate no-op assertion,
// NOT used here). On git status 128 (not a git repo) SKIP (additive, like the guard).
export function findPackageReceiptLeaks(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const tracked = trackedOnlyMode ? trackedFileSetOrFlag(repoPath, flags) : null;
  for (const rootRel of PACKAGE_RECEIPT_SCAN_ROOTS) {
    const scanRoot = path.join(repoPath, rootRel);
    if (!fs.existsSync(scanRoot)) continue;

    const files: string[] = [];
    (function walk(dir: string): void {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) files.push(full);
      }
    })(scanRoot);
    if (files.length === 0) continue;

    const rel = (p: string) => path.relative(repoPath, p);
    let shareable: (relToRepo: string) => boolean;
    if (tracked) {
      shareable = (relToRepo) => tracked.has(relToRepo);
    } else {
      // T7-H3: fail closed — an unusable check-ignore answer raises
      // `audit-unavailable` instead of silently skipping the receipt scan.
      const checked = checkIgnore(repoPath, files.map(rel));
      if (!checked.ok) {
        flags.push(auditUnavailableFlag(repoPath,
          `${checked.detail} (package/receipt leak leg over "${rootRel}" — trackability unknown)`));
        continue;
      }
      const ignored = checked.value;
      shareable = (relToRepo) => !ignored.has(relToRepo);
    }

    for (const abs of files) {
      const relToRepo = rel(abs);
      if (!shareable(relToRepo)) continue; // not ignored/tracked ⇒ not shared ⇒ skip
      let content: string;
      try { content = fs.readFileSync(abs, "utf8"); } catch { continue; }
      const { opPaths, secrets } = redact(content);
      if (opPaths > 0) {
        flags.push({
          runId: "(evidence)",
          file: relToRepo,
          kind: "receipt-operator-path",
          detail: `${opPaths} operator path(s) present in a committed/shareable receipt — would leak on commit`,
        });
      }
      if (secrets.length > 0) {
        flags.push({
          runId: "(evidence)",
          file: relToRepo,
          kind: "receipt-secret",
          detail: `${secrets.length} secret pattern(s) present in a committed/shareable receipt — [${secrets.map(s => s.category).join(", ")}]`,
        });
      }
    }
  }
  return flags;
}

// FU-F: declared fixture exemptions (mirror plugin/.gitignore — keep in sync).
// Any .guild/ under one of these glob roots is a test fixture, not a leak.
// `(?:[^/]+/)*` matches zero or more intermediate directory segments — the
// fixture .guild/ can live directly under fixtures/ OR nested below it.
// Exported so the exemption-parity test (scripts/dot-guild/__tests__/exemption-parity.test.ts)
// can assert directly against the SAME array — no hand-copied mirror to drift.
export const FIXTURE_EXEMPT_PATTERNS = deepFreeze([
  /\/benchmark\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/mcp-servers\/guild-memory\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /\/mcp-servers\/guild-telemetry\/fixtures(?:-v14|-alt-cwd)?\/(?:[^/]+\/)*\.guild(\/|$)/,
  // `/plugin` is OPTIONAL: matches both the workspace layout (.../plugin/tests/...)
  // and the plugin-repo-root CI checkout (.../tests/..., no /plugin/ segment) — the
  // exemptions must hold regardless of where the plugin tree is rooted.
  /(?:\/plugin)?\/tests\/dot-guild\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  /(?:\/plugin)?\/tests\/wiki-lint\/fixtures\/(?:[^/]+\/)*\.guild(\/|$)/,
  // G-7 (SC-3) learning-backstop golden fixture — a single named fixture dir, not a
  // glob of many, but the same optional-`/plugin` shape as the tests/ patterns above
  // (workspace layout has a `/plugin` segment; the plugin-repo-root CI checkout does not).
  /(?:\/plugin)?\/hooks\/__tests__\/fixtures\/golden-full-learn-run\/(?:[^/]+\/)*\.guild(\/|$)/,
]);

// FU-F: ONE .guild/ per project (= git repo) root. Walk the workspace, classify
// every .guild/ directory as repo-root / fixture-exempt / leak. Surface leaks
// to the audit report so the SC-7 risk gate (and CI) catches them.
function findNestedGuildLeaks(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache"]);
  // --tracked-only: a nested .guild/ with NO tracked files inside it is untracked
  // local cruft (e.g. a leftover ephemeral smoke-test dir) rather than a real leak
  // into the shared tree — skip it. Computed lazily, once, only when needed.
  let tracked: Set<string> | null = null;
  const hasTrackedFileUnder = (relDir: string): boolean => {
    if (!tracked) tracked = trackedFileSetOrFlag(repoPath, flags);
    const prefix = relDir.endsWith(path.sep) ? relDir : relDir + path.sep;
    for (const f of tracked) if (f === relDir || f.startsWith(prefix)) return true;
    return false;
  };
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (skipDirs.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name === ".guild") {
        // Repo root? Parent has .git (file or dir).
        const parent = path.dirname(full);
        const hasGit = fs.existsSync(path.join(parent, ".git"));
        if (hasGit) continue; // legitimate per-repo .guild/
        // Fixture-exempt? Resolve to absolute so the leading-slash regexes match
        // regardless of whether the walk started from a relative or absolute path.
        const absFull = path.resolve(full);
        if (FIXTURE_EXEMPT_PATTERNS.some(p => p.test(absFull))) continue;
        const relToRepo = path.relative(repoPath, full) || full;
        if (trackedOnlyMode && !hasTrackedFileUnder(relToRepo)) continue; // untracked-only ⇒ not a leak
        // Leak.
        flags.push({
          runId: "(workspace)",
          file: relToRepo,
          kind: "nested-guild",
          detail: "non-repo-root .guild/ outside declared fixtures — violates the one-.guild-per-repo invariant",
        });
        // Do NOT descend further into a nested .guild/ — its contents inherit the same status.
        continue;
      }
      walk(full);
    }
  }
  walk(repoPath);
  return flags;
}

/**
 * T4 catalog-cache coverage leg: any file under .guild/indexes/model-catalog/
 * that git would share (tracked, or trackable because the .gitignore deny is
 * missing) is an actionable leak — the cache holds target-fingerprint-keyed
 * snapshots plus the machine-local fingerprint salt and must stay
 * runtime-local. Complements the .gitignore deny with a non-vacuous gate.
 */
export function findModelCatalogCacheLeaks(repoPath: string, trackedOnlyMode = false): FileFlag[] {
  const flags: FileFlag[] = [];
  const cacheDir = modelCatalogCacheDir(repoPath);
  if (!fs.existsSync(cacheDir)) {
    // No cache on disk. Still catch the tracked-file case: anything under the
    // cache path already in the index is a leak even if deleted locally.
    for (const rel of trackedFileSetOrFlag(repoPath, flags)) {
      if (rel.startsWith(`${MODEL_CATALOG_CACHE_REL}/`)) {
        flags.push({
          runId: "(workspace)",
          file: rel,
          kind: "catalog-cache-tracked",
          detail: "model-catalog cache file is git-TRACKED — runtime-local state must never be shared",
        });
      }
    }
    return flags;
  }

  const files: string[] = [];
  (function walk(dir: string): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) files.push(full);
    }
  })(cacheDir);

  const rels = files.map((f) => path.relative(repoPath, f));
  const tracked = trackedFileSetOrFlag(repoPath, flags);
  let leaking: string[];
  if (trackedOnlyMode) {
    leaking = rels.filter((r) => tracked.has(r));
  } else {
    // T7-H3 (the reproduced fail-open): `if (checked.status === 128) return flags;`
    // returned BEFORE consulting `tracked`, so a broken-git tree with the
    // machine-local `.fp-salt` force-committed rendered as "No actionable flags".
    // Now an unusable answer is an actionable `audit-unavailable` flag, and the
    // already-tracked leg still runs (it needs no check-ignore answer at all).
    const checked = checkIgnore(repoPath, rels);
    if (!checked.ok) {
      flags.push(auditUnavailableFlag(repoPath,
        `${checked.detail} (model-catalog cache leg — trackability unknown; the cache-dir .gitignore deny is UNVERIFIED)`));
      leaking = rels.filter((r) => tracked.has(r));
    } else {
      const ignored = checked.value;
      leaking = rels.filter((r) => !ignored.has(r) || tracked.has(r));
    }
  }
  for (const rel of leaking) {
    flags.push({
      runId: "(workspace)",
      file: rel,
      kind: "catalog-cache-tracked",
      detail: tracked.has(rel)
        ? "model-catalog cache file is git-TRACKED — runtime-local state must never be shared"
        : "model-catalog cache file is git-trackable — the .gitignore deny for the cache dir is missing/bypassed",
    });
  }
  return flags;
}

// ── T6B-R2-B1: package-local scrub runtime + fail-closed coverage pass ──────────
//
// The audit used to run `spawnSync("npx", ["tsx", scrub.ts, ...])` and read only
// stdout/stderr. That is a fail-OPEN security gate on two counts: (a) ambient `npx`
// depends on machine state OUTSIDE the repo (PATH, a root-owned/unreadable ~/.npm
// cache — the exact EPERM the Codex host hit), and (b) neither `result.error` nor
// `result.status` was checked, so a scrub that NEVER RAN parsed as zero flags and the
// CLI printed "No actionable flags" over a tree carrying a live bearer token.

/** A launchable TypeScript runtime: `command` + args to prepend before the script path. */
export interface ScrubRuntime { command: string; prefixArgs: string[]; source: string; }

/** Explicit operator override for hosts with no resolvable node_modules/tsx. */
const TSX_RUNTIME_ENV = "GUILD_TSX_RUNTIME";

/** Scrub's OWN end-of-run markers. Absence ⇒ scrub did not actually run (anti-vacuity). */
const SCRUB_SUMMARY_MARKER = /\[(?:dry-run|scrub)\]\s+\d+ run\(s\),\s+\d+ file\(s\) in scope/;
const SCRUB_NO_RUNS_MARKER = /\[scrub\] No run dirs found under /;

/** Walk up from `startDir` looking for a repo-local tsx (dist/cli.mjs, then .bin/tsx). */
function walkUpForTsx(startDir: string): ScrubRuntime | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const cli = path.join(dir, "node_modules", "tsx", "dist", "cli.mjs");
    if (fs.existsSync(cli)) return { command: process.execPath, prefixArgs: [cli], source: cli };
    const bin = path.join(dir, "node_modules", ".bin", "tsx");
    if (fs.existsSync(bin)) return { command: bin, prefixArgs: [], source: bin };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the TypeScript runtime used to launch scrub.ts — repository/package-local
 * ONLY. Order: explicit env override → tsx resolved from this module's own node_modules
 * chain (`require.resolve`) → an upward disk walk from each search root. Returns null
 * when nothing is available, which the caller turns into a FAIL-CLOSED audit — it never
 * falls back to ambient `npx`.
 */
export function resolveScrubRuntime(searchRoots: string[] = [__dirname]): ScrubRuntime | null {
  const override = (process.env[TSX_RUNTIME_ENV] ?? "").trim();
  if (override) return { command: override, prefixArgs: [], source: `$${TSX_RUNTIME_ENV}=${override}` };
  try {
    const cli = path.join(path.dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
    if (fs.existsSync(cli)) return { command: process.execPath, prefixArgs: [cli], source: cli };
  } catch { /* tsx not resolvable from here — fall through to the disk walk */ }
  for (const root of searchRoots) {
    const found = walkUpForTsx(root);
    if (found) return found;
  }
  return null;
}

/** The one shape of "the scrub coverage pass could not run" — always actionable. */
function scrubUnavailableFlag(repoPath: string, detail: string): FileFlag {
  return {
    runId: "(scrub)",
    file: "scripts/dot-guild/scrub.ts",
    kind: "scrub-unavailable",
    // Redact the reason: spawn/stderr text can carry operator paths.
    detail: redact(`scrub coverage could not run over ${repoPath}: ${detail}`).out,
  };
}

function auditRepo(repoPath: string): { flags: FileFlag[]; } {
  const scrubScript = path.resolve(__dirname, "scrub.ts");
  const runtime = resolveScrubRuntime([__dirname, repoPath]);
  if (!runtime) {
    return { flags: [scrubUnavailableFlag(repoPath,
      `no repository-local TypeScript runtime (tsx) could be resolved from ${__dirname} or ${repoPath} ` +
      `— run \`npm ci\` in plugin/scripts (or set ${TSX_RUNTIME_ENV}); ambient npx is deliberately NOT used`)] };
  }

  const result = spawnSync(
    runtime.command,
    [...runtime.prefixArgs, scrubScript, "--dry-run", `--workspace=${repoPath}`],
    { encoding: "utf8" },
  );

  // (a) the subprocess never launched (ENOENT/EACCES/EPERM/…).
  if (result.error) {
    return { flags: [scrubUnavailableFlag(repoPath,
      `scrub subprocess failed to launch via ${runtime.source}: ${result.error.message}`)] };
  }
  const raw = (result.stdout ?? "") + (result.stderr ?? "");
  // (b) it launched but failed (non-zero exit, or null = killed by a signal).
  if (result.status !== 0) {
    const tail = raw.trim().split("\n").slice(-5).join(" | ").slice(0, 400);
    return { flags: [scrubUnavailableFlag(repoPath,
      `scrub exited ${result.status === null ? `on signal ${result.signal}` : `status ${result.status}`} ` +
      `via ${runtime.source}${tail ? ` — ${tail}` : ""}`)] };
  }
  // (c) it exited 0 but produced none of scrub's own markers ⇒ the coverage pass did
  //     not actually happen (e.g. an override runtime that is not tsx). Fail closed:
  //     an unparsed/empty output must never be read as "clean".
  if (!SCRUB_SUMMARY_MARKER.test(raw) && !SCRUB_NO_RUNS_MARKER.test(raw)) {
    return { flags: [scrubUnavailableFlag(repoPath,
      `scrub exited 0 via ${runtime.source} but emitted no scrub summary marker — ` +
      `the coverage pass did not run, so this tree is NOT certified`)] };
  }

  const flags: FileFlag[] = [];

  for (const line of raw.split("\n")) {
    // "[dry-run] <runId>/<file>: paths=N secrets=M ..."
    const m = line.match(/\[dry-run\]\s+([^/\s]+)\/(.+?):\s+paths=(\d+)\s+secrets=(\d+)/);
    if (m) {
      const [, runId, file, pStr, sStr] = m;
      if (parseInt(pStr) > 0) flags.push({ runId, file, kind: "operator-path", detail: `${pStr} operator path(s) would be redacted` });
      if (parseInt(sStr) > 0) flags.push({ runId, file, kind: "secret", detail: `${sStr} secret pattern(s) found` });
    }
    // summary excluded count
    const ex = line.match(/(\d+) payload\(s\) excluded/);
    if (ex && parseInt(ex[1]) > 0)
      flags.push({ runId: "(summary)", file: "events.ndjson / logs/payloads/**", kind: "payload-excluded", detail: `${ex[1]} payload file(s) excluded (no share-payloads.flag)` });
  }
  return { flags };
}

function renderReport(repoResults: Array<{ repo: string; flags: FileFlag[] }>, now: string): string {
  const total = repoResults.reduce((n, r) => n + r.flags.length, 0);
  let out = `---\ntype: artifact\ninitiative: share-dot-guild\ntask: B-tooling\ncreated_at: ${now}\n---\n\n`;
  out += `# .guild/ audit report — share-dot-guild\n\nGenerated by \`audit.ts\` on ${now}. SC-7 risk-gate artifact (Decision J).\n\n## Summary\n\n| Repo | Flags |\n|---|---|\n`;
  for (const r of repoResults) out += `| \`${r.repo}\` | ${r.flags.length} |\n`;
  out += `| **Total** | **${total}** |\n\n`;
  // FAIL-CLOSED (T6B-R2-B1): when the scrub coverage pass could not run, the report
  // must NEVER read as a clean bill of health. A scrub-unavailable flag is itself a
  // flag, so `total > 0` here — the "No actionable flags" branch is unreachable.
  const scrubUnavailable = repoResults.some(r => r.flags.some(f => f.kind === "scrub-unavailable"));
  // T7-H3/M1: the git-backed legs get the SAME banner — a tree whose
  // trackability could not be determined is not a certified tree.
  const auditUnavailable = repoResults.some(r => r.flags.some(f => f.kind === "audit-unavailable"));
  out += scrubUnavailable
    ? `**FAIL-CLOSED — scrub coverage could not run.** This report does NOT certify the tree: ` +
      `the redaction/secret pass never executed, so absence of operator-path/secret flags means nothing. ` +
      `Restore the repository-local runtime and re-run before any commit.\n`
    : auditUnavailable
    ? `**FAIL-CLOSED — a git-backed audit leg could not run.** This report does NOT certify the tree: ` +
      `trackability ("would this be shared?") is UNKNOWN for at least one repo/leg, so absence of ` +
      `catalog-cache / scrub-coverage / receipt flags means nothing. Repair the repo path or the git ` +
      `environment (e.g. \`git config --global --add safe.directory <path>\`) and re-run before any commit.\n`
    : total === 0
    ? `No actionable flags — safe to proceed with SC-10 commits.\n`
    : `**Action required before SC-10 commits.** Resolve each flag (scrub-adjust / exclude / accept).\n`;

  for (const r of repoResults) {
    out += `\n## Repo: \`${r.repo}\`\n\n`;
    if (r.flags.length === 0) { out += `No flags.\n`; continue; }
    out += `| Run ID | File | Kind | Detail | Suggested action |\n|---|---|---|---|---|\n`;
    for (const f of r.flags) {
      const action = f.kind === "operator-path" ? "Run scrub.ts before commit"
        : f.kind === "secret" ? "Rotate credential; scrub.ts will redact"
        : f.kind === "receipt-operator-path" ? "Scrub the receipt at write time via the shared redact() (L5), OR remove it from the committed evidence receipt allow-list so it is not shared"
        : f.kind === "receipt-secret" ? "Rotate the credential; the receipt MUST be redacted (shared redact()) before it is staged — evidence receipts are shared-scrubbed"
        : f.kind === "nested-guild" ? "DELETE the nested .guild/ — it's a leftover; resolver enforces one-.guild-per-repo. If legitimate fixture, add its path to FIXTURE_EXEMPT_PATTERNS"
        : f.kind === "scrub-uncovered" ? "Add the file's basename to scrub.ts SHARED_SCRUBBED_NAMES (so it gets a redaction pass), OR exempt it in SCRUB_COVERAGE_EXEMPT_NAMES if it carries no operator content, OR remove it from the .gitignore allow-list so it is not shared"
        : f.kind === "catalog-cache-tracked" ? "git rm --cached the file and restore the .guild/indexes/model-catalog/ deny line in .gitignore — the discovery cache is runtime-local and never shared"
        : f.kind === "scrub-unavailable" ? "FAIL-CLOSED: restore the repository-local TypeScript runtime (`npm ci` in plugin/scripts, or set GUILD_TSX_RUNTIME to a working runtime) and re-run — the audit cannot certify a tree it never scrubbed"
        : f.kind === "audit-unavailable" ? "FAIL-CLOSED: fix the repo path (--repos entries resolve against --workspace) or the git environment (`git config --global --add safe.directory <path>`, repair .git/config) and re-run — the audit cannot certify a tree whose trackability it could not determine"
        : "Informational — add share-payloads.flag to opt in";
      out += `| \`${f.runId}\` | \`${f.file}\` | ${f.kind} | ${f.detail} | ${action} |\n`;
    }
  }
  out += `\n---\n\nRe-run: \`npx tsx plugin/scripts/dot-guild/audit.ts\`\n`;
  return out;
}

function main(): void {
  const now = new Date().toISOString().slice(0, 10);
  const repoResults: Array<{ repo: string; flags: FileFlag[] }> = [];

  for (const repo of repoList) {
    // T7-M1 fail-closed repo resolution. `repoList` entries used to be raw
    // caller strings resolved against the process CWD with NO existence check,
    // so `--repos=/does/not/exist` (or a typo'd/renamed repo in a CI
    // invocation) produced "No actionable flags. OK." with exit 0 — the whole
    // leak gate vacuous while reporting success. Every entry is now resolved to
    // an absolute path against --workspace, PRINTED, and classified; a missing
    // path, a non-work-tree, or a git that cannot answer is an actionable
    // `audit-unavailable` flag (non-zero exit), never a clean pass.
    process.stderr.write(`[audit] Scanning ${repo} ...\n`);
    const gitStatus = classifyRepoGit(repo);
    if (gitStatus.kind !== "repo") {
      const detail =
        gitStatus.kind === "missing"
          ? "the repo path does not exist — nothing was scanned; a typo'd/renamed --repos entry must never render as a clean pass"
          : gitStatus.kind === "not-a-repo"
            ? "the path exists but is not inside a git work tree — the leak gate answers 'would this be shared?' and has no answer here"
            : gitStatus.detail;
      repoResults.push({
        repo: path.relative(WORKSPACE, repo) || path.basename(repo),
        flags: [auditUnavailableFlag(repo, detail)],
      });
      continue;
    }
    const { flags } = auditRepo(repo);
    // FU-F: also walk for nested-.guild leaks at any depth.
    const nestedLeaks = findNestedGuildLeaks(repo, trackedOnly);
    // SC-7 blind-spot guard: flag git-trackable run files scrub doesn't cover.
    const coverageGaps = findScrubCoverageGaps(repo, trackedOnly);
    // AC-SEC-1 (verified-multi-host-support §7.2): the REAL package/receipt-tree leak
    // scan — a planted operator-path/secret in a committed evidence receipt is flagged
    // non-vacuously. Path-anchored + independent of the runs share-set.
    const receiptLeaks = findPackageReceiptLeaks(repo, trackedOnly);
    // T4: model-catalog cache exclusion coverage (guild.model_catalog.v1 §7).
    const catalogCacheLeaks = findModelCatalogCacheLeaks(repo, trackedOnly);
    repoResults.push({ repo: path.relative(WORKSPACE, repo) || path.basename(repo), flags: [...flags, ...nestedLeaks, ...coverageGaps, ...receiptLeaks, ...catalogCacheLeaks] });
  }

  const report = renderReport(repoResults, now);
  process.stdout.write(report);

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, report, "utf8");
    process.stderr.write(`[audit] Report written to ${outputPath}\n`);
  }

  // FAIL-CLOSED first, and loudly: a tree whose scrub pass never ran is NOT clean, and
  // the operator must see WHY rather than a generic flag count. (These flags are also
  // actionable, so the exit code would be non-zero regardless — this is belt AND braces.)
  const scrubFailures = repoResults.flatMap(r => r.flags.filter(f => f.kind === "scrub-unavailable"));
  if (scrubFailures.length > 0) {
    for (const f of scrubFailures) process.stderr.write(`[audit] FAIL-CLOSED: ${f.detail}\n`);
    process.stderr.write(`[audit] scrub coverage could not run — this audit does NOT certify the tree. Exiting non-zero.\n`);
    process.exit(1);
  }

  // T7-H3/M1: same posture for the git-backed legs.
  const gitFailures = repoResults.flatMap(r => r.flags.filter(f => f.kind === "audit-unavailable"));
  if (gitFailures.length > 0) {
    for (const f of gitFailures) process.stderr.write(`[audit] FAIL-CLOSED: ${f.detail}\n`);
    process.stderr.write(`[audit] a git-backed audit leg could not run — trackability is UNKNOWN, so this audit does NOT certify the tree. Exiting non-zero.\n`);
    process.exit(1);
  }

  const actionable = repoResults.reduce((n, r) => n + r.flags.filter(f => f.kind !== "payload-excluded").length, 0);
  if (actionable > 0) {
    process.stderr.write(`[audit] ${actionable} actionable flag(s) — CI/gate should fail.\n`);
    process.exit(1);
  }
  process.stderr.write(`[audit] No actionable flags. OK.\n`);
}

// Guarded so importing this module (e.g. build-verify.ts reusing the single-source
// `findPackageReceiptLeaks` scan — verified-multi-host-support L6, ADR §8 step 6) does
// NOT run the full audit. As a direct script (`npx tsx audit.ts`) it still runs main().
if (require.main === module) main();
