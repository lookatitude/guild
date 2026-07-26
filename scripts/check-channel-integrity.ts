#!/usr/bin/env -S npx tsx
/**
 * scripts/check-channel-integrity.ts
 *
 * CHANNEL-INTEGRITY GATE — release-discipline rule 8 (sync-back), mechanized.
 * (initiative cross-host-release-distribution, work item xhrd-wi-06 / G6.)
 *
 * THE RULE IT ENFORCES.
 * `.guild/wiki/standards/release-discipline.md` rule 8: after a release merges
 * to `main`, `next` must be advanced to the release point. Branches ARE
 * distribution channels — `main` = stable, `next` = beta — so a `next` whose
 * version trails `main`'s means BETA USERS ARE RUNNING OLDER CODE THAN STABLE.
 * That inverts the whole point of a beta channel and is invisible without a
 * check: every per-PR gate stays green while the channel silently rots.
 *
 * WHY IT WAS NEEDED.
 * Rule 8's sync-back clause was prose only. v2.3.2 merged to `main` on 2026-07-25; the sync-back
 * never happened. `next` sat at 2.3.1 while `main` shipped 2.3.2 and nothing
 * anywhere reported it. Prose does not enforce process — CI does.
 *
 * WHAT IT CHECKS.
 * Reads `.claude-plugin/plugin.json`'s `version` from both channel refs and
 * fails when next < main. Version, not commit identity, is deliberate: `next`
 * legitimately carries commits `main` lacks (that is what an integration branch
 * IS), so "next is behind main" can only be judged on the released version.
 *
 * PRERELEASE HANDLING — full SemVer §11 precedence, NOT a bare triple compare.
 * A naive "ignore the suffix" comparison produces a FALSE PASS on exactly the
 * case that matters: `main` at `2.3.2` with `next` at `2.3.2-rc1` would read as
 * "in sync" when SemVer says `2.3.2-rc1 < 2.3.2` — beta genuinely trailing
 * stable. So: equal triples ⇒ a version WITH a prerelease is LOWER than one
 * without; two prereleases compare identifier-by-identifier (numeric
 * identifiers numerically and below alphanumerics). `next` at `2.4.0-rc1` is
 * still correctly ahead of `main` at `2.3.2`.
 *
 * DETECTION, NOT PREVENTION — stated plainly so nobody over-trusts this.
 * `release.yml` tags and publishes on the merged-PR event; a workflow triggered
 * by `push` runs concurrently and CANNOT block that publication. This gate
 * reports that the sync-back debt exists; it does not stop a release from being
 * cut while the debt is outstanding. Closing that gap means adding the check to
 * the release path itself — a followup, not this lane.
 *
 * NOT A MERGE-SHAPE CHECK. Rule 8 also constrains HOW the sync-back lands (a
 * fast-forward when ancestry allows, otherwise a delta-copy PR). That is a
 * property of the fix, not of the resulting state, and is left to review. This
 * gate answers exactly one question: is beta behind stable?
 *
 * Usage:
 *   npx tsx scripts/check-channel-integrity.ts [--stable <ref>] [--beta <ref>] [--json]
 *
 * Exit: 0 ok (beta >= stable) · 2 gate failure (beta trails stable) · 1 IO/usage error.
 *
 * Owned by tooling-engineer. Read-only: it runs `git show` and nothing else.
 */

import { execFileSync } from "node:child_process";

export const MANIFEST_PATH = ".claude-plugin/plugin.json";

export interface ParsedVersion {
  /** Raw MAJOR/MINOR/PATCH digit strings — compared without a precision ceiling. */
  core: [string, string, string];
  triple: [number, number, number];
  /** Dot-separated prerelease identifiers; empty ⇒ a full release. */
  prerelease: string[];
}

export interface ChannelState {
  ref: string;
  version: string;
  core: [string, string, string];
  triple: [number, number, number];
  prerelease: string[];
}

export interface IntegrityResult {
  stable: ChannelState;
  beta: ChannelState;
  ok: boolean;
  reason: string;
}

/**
 * Parse "2.3.2" / "v2.3.2" / "2.4.0-rc1" into its triple + prerelease identifiers.
 *
 * The pattern is FULLY ANCHORED on purpose: an unanchored prefix match would
 * silently accept "2.3.2junk" as 2.3.2. Build metadata (`+sha`) is accepted and
 * discarded — SemVer §10 says it carries no precedence.
 */
const NUM_ID = "0|[1-9]\\d*";
const PRE_ID = `(?:${NUM_ID}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const SEMVER_RE = new RegExp(
  `^v?(${NUM_ID})\\.(${NUM_ID})\\.(${NUM_ID})` +
    `(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?` +
    `(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
);

export function parseVersion(version: string): ParsedVersion {
  const m = SEMVER_RE.exec(version.trim());
  if (!m) throw new Error(`unparseable version "${version}" (want MAJOR.MINOR.PATCH[-prerelease][+build])`);
  return {
    core: [m[1], m[2], m[3]],
    triple: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Compare two digit strings numerically with NO precision ceiling.
 *
 * `Number()` silently collapses values above 2^53 — `9007199254740992` and
 * `9007199254740993` compare EQUAL — which SemVer §11.4.1 forbids and which
 * would let the gate false-pass. Length-then-lexical is exact for arbitrary
 * precision and needs no BigInt.
 */
function cmpNumericString(a: string, b: string): number {
  const x = a.replace(/^0+(?=\d)/, "");
  const y = b.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length - y.length;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Back-compat shim — the triple alone, for callers that only need MAJOR.MINOR.PATCH. */
export function parseTriple(version: string): [number, number, number] {
  return parseVersion(version).triple;
}

/** Returns <0 if a<b, 0 if equal, >0 if a>b. */
export function compareTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * SemVer §11 precedence, including the prerelease rules a bare triple compare
 * gets wrong:
 *   - equal triples: a version WITH a prerelease is LOWER than one without
 *     (2.3.2-rc1 < 2.3.2) — the false-PASS case this gate exists to catch;
 *   - two prereleases: compare identifiers left to right; numeric identifiers
 *     compare numerically and rank BELOW alphanumeric ones; a longer identifier
 *     list wins when all preceding identifiers are equal.
 *
 * Numeric comparison goes through cmpNumericString(), NOT Number(), so values
 * beyond 2^53 order correctly (§11.4.1 has no precision limit).
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i++) {
    const t = cmpNumericString(a.core[i], b.core[i]);
    if (t !== 0) return t;
  }

  const aPre = a.prerelease;
  const bPre = b.prerelease;
  if (aPre.length === 0 && bPre.length === 0) return 0;
  if (aPre.length === 0) return 1; // a is a full release, b is a prerelease ⇒ a > b
  if (bPre.length === 0) return -1;

  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    const x = aPre[i];
    const y = bPre[i];
    if (x === undefined) return -1; // fewer identifiers ⇒ lower precedence
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = cmpNumericString(x, y);
      if (d !== 0) return d;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // numeric identifiers rank below alphanumeric
    } else if (x !== y) {
      return x < y ? -1 : 1; // ASCII ordering
    }
  }
  return 0;
}

/** Read the plugin version at a git ref. Injectable reader so the rail can test without a repo. */
export function versionAtRef(ref: string, read: (r: string) => string = gitShowManifest): string {
  const raw = read(ref);
  const parsed = JSON.parse(raw) as { version?: unknown };
  const v = parsed.version;
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`${ref}:${MANIFEST_PATH} has no usable "version" field`);
  }
  return v;
}

function gitShowManifest(ref: string): string {
  return execFileSync("git", ["show", `${ref}:${MANIFEST_PATH}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function checkChannelIntegrity(
  stableRef: string,
  betaRef: string,
  read: (r: string) => string = gitShowManifest
): IntegrityResult {
  const sv = versionAtRef(stableRef, read);
  const bv = versionAtRef(betaRef, read);
  const sp = parseVersion(sv);
  const bp = parseVersion(bv);
  const stable: ChannelState = { ref: stableRef, version: sv, ...sp };
  const beta: ChannelState = { ref: betaRef, version: bv, ...bp };
  const cmp = compareVersions(bp, sp);
  return cmp < 0
    ? {
        stable,
        beta,
        ok: false,
        reason:
          `beta channel (${betaRef}) is at ${bv} while stable (${stableRef}) is at ${sv} — ` +
          `beta users are running OLDER code than stable. The release-discipline rule-8 sync-back did not land.`,
      }
    : {
        stable,
        beta,
        ok: true,
        reason:
          cmp === 0
            ? `both channels at ${bv} — in sync.`
            : `beta (${bv}) is ahead of stable (${sv}) — normal for an integration branch.`,
      };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  let stableRef = "origin/main";
  let betaRef = "origin/next";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stable" && argv[i + 1] !== undefined) stableRef = argv[++i];
    else if (a.startsWith("--stable=")) stableRef = a.slice("--stable=".length);
    else if (a === "--beta" && argv[i + 1] !== undefined) betaRef = argv[++i];
    else if (a.startsWith("--beta=")) betaRef = a.slice("--beta=".length);
    else if (a === "--json") json = true;
    else {
      process.stderr.write(
        `unknown argument: ${a}\n` +
          "usage: check-channel-integrity.ts [--stable <ref>] [--beta <ref>] [--json]\n"
      );
      return 1;
    }
  }

  let result: IntegrityResult;
  try {
    result = checkChannelIntegrity(stableRef, betaRef);
  } catch (err) {
    process.stderr.write(
      `check-channel-integrity: ${String(err instanceof Error ? err.message : err)}\n` +
        `(fetch both refs first: git fetch origin main next)\n`
    );
    return 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }

  if (!result.ok) {
    process.stderr.write(`check-channel-integrity: GATE FAILURE — ${result.reason}\n`);
    process.stderr.write(
      "\nFix (release-discipline rule 8) — advance next to the release point WITHOUT a looping merge commit:\n" +
        "  # 1. Decide by ANCESTRY, not by dates: is the release point a descendant of next?\n" +
        "  git merge-base --is-ancestor origin/next <release-tag> && echo ff-possible || echo diverged\n" +
        "  # 2a. ff-possible -> fast-forward:\n" +
        "  git checkout next && git merge --ff-only <release-tag>\n" +
        "  # 2b. diverged -> sync-back PR carrying the release delta (version bump + changelog\n" +
        "  #      + regenerated inventory). Ancestry is already lost, so the merge style no\n" +
        "  #      longer matters; the channels will agree on content + version, not on SHA.\n" +
        "  # NOTE: only a MERGE COMMIT preserves ancestry. Squash AND rebase both rewrite\n" +
        "  #       SHAs, so either forces 2b every time. Use a merge commit for release PRs\n" +
        "  #       whenever you want the fast-forward sync-back in 2a to stay possible.\n"
    );
    return 2;
  }

  process.stdout.write(`check-channel-integrity: OK — ${result.reason}\n`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
