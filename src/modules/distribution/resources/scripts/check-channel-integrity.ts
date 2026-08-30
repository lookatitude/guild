#!/usr/bin/env -S npx tsx
/**
 * scripts/check-channel-integrity.ts
 *
 * CHANNEL-INTEGRITY GATE — release-discipline channel ordering, mechanized.
 * (initiative cross-host-release-distribution, work item xhrd-wi-06 / G6.)
 *
 * THE RULE IT ENFORCES.
 * Branches ARE distribution channels — `main` = stable, `next` = beta — so a `next` whose
 * version trails `main`'s means BETA USERS ARE RUNNING OLDER CODE THAN STABLE.
 * That inverts the whole point of a beta channel and is invisible without a
 * check: every per-PR gate stays green while the channel silently rots.
 *
 * WHY IT WAS NEEDED.
 * The former sync-back clause was prose only. v2.3.2 merged to `main` on 2026-07-25; the sync-back
 * never happened. `next` sat at 2.3.1 while `main` shipped 2.3.2 and nothing
 * anywhere reported it. Prose does not enforce process — CI does.
 *
 * WHAT IT CHECKS.
 * Reads `.claude-plugin/plugin.json`'s `version` from both channel refs and
 * fails when next < main. In the short path, `main` retains the reviewed
 * `X.Y.Z-beta.N` candidate while the bare identity lives in `vX.Y.Z`; the gate
 * therefore binds that tag to main and proves next history contains main's
 * exact release tree before accepting later beta development.
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
 * DETECTION, NOT PREVENTION — stated plainly so nobody over-trusts this mode.
 * The release workflow owns prevention: it verifies promotion and tags the
 * exact reviewed merge without rewriting either protected branch. This
 * ordinary channel mode detects debt left by an interrupted or manually
 * altered channel; it is not the publication authority by itself.
 *
 * NOT A WRITE-AUTHORITY CHECK. This gate observes channel versions; branch
 * protection and the release workflow constrain writes. This mode answers
 * exactly one question: is beta behind the published stable release or missing
 * the release-tree binding that makes the short-path exception safe?
 *
 * Usage:
 *   npx tsx scripts/check-channel-integrity.ts [--stable <ref>] [--beta <ref>] [--json]
 *   npx tsx scripts/check-channel-integrity.ts promotion --source-branch next \
 *       [--head <ref>] [--stable-ref <ref>] [--root <dir>] [--json]
 *
 * Exit: 0 ok (beta >= stable) · 2 gate failure (beta trails stable) · 1 IO/usage error.
 * Promotion mode keeps the same convention: 0 promotable · 2 gate refusal · 1 usage/IO.
 *
 * PROMOTION MODE — the direct next-to-main invariant (FIC-91 / REL-P0, FIC-74 §0/B1+B5).
 * The gate governs the exact same-repository `next -> main` promotion before
 * CI tags the reviewed merge commit. `checkStablePromotion` validates
 * hash-bound `guild.release_promotion.v1` /
 * `guild.release_conformance.v1` evidence, a production-evaluator RE-RUN over
 * the transported evidence+authority, one source-commit binding, ancestry, and
 * an EXACT allowed diff. It fails closed on every malformed or missing input.
 *
 * Owned by tooling-engineer. Read-only: it runs `git show` and nothing else.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import { evaluateTransportedReleaseConformance } from "../src/modules/distribution/workflows/release-conformance-integration";

export const MANIFEST_PATH = ".claude-plugin/plugin.json";
export const MARKETPLACE_PATH = ".claude-plugin/marketplace.json";

/** Schema identifiers for the two hash-bound release-evidence records. */
export const RELEASE_PROMOTION_SCHEMA = "guild.release_promotion.v1";
export const RELEASE_CONFORMANCE_SCHEMA = "guild.release_conformance.v1";

/**
 * The frozen 31-scenario conformance contract, pinned by content hash.
 *
 * The canonical file lives in the umbrella workspace
 * (`.guild/artifacts/generated/multi-host-runtime-convergence/conformance-scenarios.v1.json`);
 * this gate binds to its BYTES, not its location, so a plugin-only checkout can
 * still verify that a conformance record names the exact frozen contract.
 */
export const FROZEN_SCENARIO_CONTRACT_SHA256 =
  "09d2b6f4c9d98245dd13da4f834fb193e1b21f76625471538e12533d70fa165e";
export const FROZEN_SCENARIO_CONTRACT_COUNT = 31;
/** Compatibility names retained for callers of the original channel gate. */
export const FROZEN_CONFORMANCE_SCENARIOS = FROZEN_SCENARIO_CONTRACT_COUNT;

/**
 * The complete frozen scenario set, in canonical contract order.
 *
 * FIC-74 requires a conformance record to NAME all 31 frozen scenario ids —
 * a count plus a hash alone can be asserted by a hand-authored record without
 * proving the canonical set. This tuple is pinned against the hash-verified
 * contract bytes by the focused suite; the gate requires exact ordered
 * equality with it.
 */
export const FROZEN_SCENARIO_CONTRACT_IDS: readonly string[] = Object.freeze([
  "MHRC-LIF-001",
  "MHRC-LIF-002",
  "MHRC-LIF-003",
  "MHRC-LIF-004",
  "MHRC-EVT-001",
  "MHRC-EVT-002",
  "MHRC-SUP-001",
  "MHRC-SUP-002",
  "MHRC-SUP-003",
  "MHRC-SUP-004",
  "MHRC-SUP-005",
  "MHRC-SUP-006",
  "MHRC-UNS-001",
  "MHRC-UNS-002",
  "MHRC-UNS-003",
  "MHRC-RCT-001",
  "MHRC-RCT-002",
  "MHRC-RCT-003",
  "MHRC-RCT-004",
  "MHRC-RCT-005",
  "MHRC-MOD-001",
  "MHRC-MOD-002",
  "MHRC-MOD-003",
  "MHRC-MOD-004",
  "MHRC-STR-001",
  "MHRC-STR-002",
  "MHRC-STR-003",
  "MHRC-STR-004",
  "MHRC-VER-001",
  "MHRC-VER-002",
  "MHRC-VER-003",
]);
/** Compatibility alias for the canonical frozen tuple. */
export const FROZEN_SCENARIO_IDS = FROZEN_SCENARIO_CONTRACT_IDS;

const BARE_CHANNEL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BETA_CHANNEL_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

export interface ParsedVersion {
  /** Raw MAJOR/MINOR/PATCH digit strings — compared without a precision ceiling. */
  core: [string, string, string];
  triple: [number, number, number];
  /** Dot-separated prerelease identifiers; empty ⇒ a full release. */
  prerelease: string[];
}

export interface ChannelState {
  ref: string;
  commit: string;
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

function gitResolveRef(ref: string): string {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitBetaContainsStableTree(stableCommit: string, betaCommit: string): boolean {
  try {
    const stableTree = execFileSync("git", ["rev-parse", "--verify", `${stableCommit}^{tree}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const betaHistoryTrees = execFileSync("git", ["log", "--format=%T", betaCommit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean);
    return betaHistoryTrees.includes(stableTree);
  } catch {
    return false;
  }
}

export function checkChannelIntegrity(
  stableRef: string,
  betaRef: string,
  read: (r: string) => string = gitShowManifest,
  resolveRef: (r: string) => string = read === gitShowManifest ? gitResolveRef : (r) => r,
  betaContainsStableTree: (stableCommit: string, betaCommit: string) => boolean =
    read === gitShowManifest ? gitBetaContainsStableTree : (stableCommit, betaCommit) => stableCommit === betaCommit
): IntegrityResult {
  const sv = versionAtRef(stableRef, read);
  const bv = versionAtRef(betaRef, read);
  const sp = parseVersion(sv);
  const bp = parseVersion(bv);
  const stable: ChannelState = { ref: stableRef, commit: resolveRef(stableRef), version: sv, ...sp };
  const beta: ChannelState = { ref: betaRef, commit: resolveRef(betaRef), version: bv, ...bp };
  const cmp = compareVersions(bp, sp);
  const coreCmp = compareVersions({ ...bp, prerelease: [] }, { ...sp, prerelease: [] });

  // In the short path, main retains the reviewed beta identifier and the
  // immutable vX.Y.Z tag is the stable identity. Bind that exception to the
  // tag at main AND prove next history still contains the exact stable tree.
  // That supports merge, squash, and rebase PR merges while preventing a
  // reset to older bytes to hide behind a reused candidate version.
  if (BETA_CHANNEL_VERSION.test(sv)) {
    const publishedVersion = sp.core.join(".");
    const stableTag = `refs/tags/v${publishedVersion}`;
    let taggedCommit: string;
    try {
      taggedCommit = resolveRef(stableTag);
    } catch {
      return { stable, beta, ok: false, reason: `stable candidate ${sv} has no published ${stableTag} tag.` };
    }
    if (taggedCommit !== stable.commit) {
      return {
        stable,
        beta,
        ok: false,
        reason: `${stableTag} resolves to ${taggedCommit}, not stable commit ${stable.commit}.`,
      };
    }
    if (!BETA_CHANNEL_VERSION.test(bv)) {
      return { stable, beta, ok: false, reason: `next must use MAJOR.MINOR.PATCH-beta.N after a short-path release; found ${bv}.` };
    }
    if (!betaContainsStableTree(stable.commit, beta.commit)) {
      return {
        stable,
        beta,
        ok: false,
        reason: `beta history at ${beta.commit} does not contain the exact stable release tree from ${stable.commit}.`,
      };
    }
    if (coreCmp < 0 || (coreCmp === 0 && cmp < 0)) {
      return {
        stable,
        beta,
        ok: false,
        reason: `beta channel (${betaRef}) is at ${bv} while published stable v${publishedVersion} came from ${sv} — beta users are running OLDER code than stable.`,
      };
    }
    return {
      stable,
      beta,
      ok: true,
      reason: sv === bv
        ? `both channels carry reviewed release candidate ${sv}; published stable v${publishedVersion} is bound to main and next contains the same release tree.`
        : `beta (${bv}) is ahead of published stable v${publishedVersion} and its history contains the exact stable release tree.`,
    };
  }

  if (!BARE_CHANNEL_VERSION.test(sv)) {
    return { stable, beta, ok: false, reason: `stable channel (${stableRef}) must use exact MAJOR.MINOR.PATCH; found ${sv}.` };
  }
  if (stable.commit === beta.commit) {
    return sv === bv
      ? { stable, beta, ok: true, reason: `both channels at ${bv} on the same commit — in sync at a quiescent release point.` }
      : { stable, beta, ok: false, reason: `the same commit reports different channel versions (${sv} vs ${bv}).` };
  }
  if (cmp <= 0) {
    return {
      stable,
      beta,
      ok: false,
      reason: cmp < 0
        ? `beta channel (${betaRef}) is at ${bv} while stable (${stableRef}) is at ${sv} — beta users are running OLDER code than stable. The protected release transaction did not converge.`
        : `diverged channels may not share bare version ${bv}; next must identify the newer beta runtime.`,
    };
  }
  if (!BETA_CHANNEL_VERSION.test(bv)) {
    return { stable, beta, ok: false, reason: `diverged next must use MAJOR.MINOR.PATCH-beta.N; found ${bv}.` };
  }
  if (coreCmp <= 0) {
    return { stable, beta, ok: false, reason: `next beta core ${bp.core.join(".")} must be newer than stable ${sp.core.join(".")}.` };
  }
  return { stable, beta, ok: true, reason: `beta (${bv}) is ahead of stable (${sv}) and identifies the divergent runtime.` };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv[0] === "promotion") return promotionMain(argv.slice(1));
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
      "\nFix — inspect and re-run the failed `Publish stable release after next merges to main` workflow.\n" +
        "  Do not hand-push a sync-back or move the published tag. Follow the failure and\n" +
        "  re-run procedure in .guild/wiki/standards/release-discipline.md.\n"
    );
    return 2;
  }

  process.stdout.write(`check-channel-integrity: OK — ${result.reason}\n`);
  return 0;
}

// ---------------------------------------------------------------------------
// PROMOTION MODE — the hash-bound stable-promotion gate (FIC-91 / REL-P0)
// ---------------------------------------------------------------------------

const BARE_TRIPLE_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * The EXACT set of paths `next` may change after the evidence source commit:
 * only the two hash-bound evidence records. Stable manifests, inventory, and
 * changelog are generated after merge by the protected release job, never on a
 * human-authored release branch.
 */
export function promotionAllowedPaths(version: string): string[] {
  return [
    `.guild/artifacts/release/v${version}/promotion.json`,
    `.guild/artifacts/release/v${version}/conformance.json`,
  ];
}

/**
 * The four git facts the gate needs, as an interface so tests can exercise the
 * full decision path against an in-memory repository. The green path is only
 * reachable that way HONESTLY: the sole conformant evidence in this repository
 * is the signed fixture bundle, whose identity names a source commit no test
 * repository can mint. Everything else — hashing, schema validation, and the
 * production evaluator re-run — always runs for real.
 */
export interface PromotionGitOps {
  /** Resolve a ref to a commit sha, or null when it names no commit. */
  resolveCommit(ref: string): string | null;
  /** The exact bytes of `<ref>:<path>`, or null when absent at that ref. */
  showBytes(ref: string, filePath: string): Buffer | null;
  isAncestor(ancestor: string, descendant: string): boolean;
  changedPaths(from: string, to: string): string[];
}

export function realPromotionGitOps(cwd: string = "."): PromotionGitOps {
  const run = (args: string[]): Buffer | null => {
    try {
      return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      return null;
    }
  };
  return {
    resolveCommit: (ref) => {
      const out = run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
      const sha = out?.toString("utf8").trim() ?? "";
      return COMMIT_SHA_RE.test(sha) ? sha : null;
    },
    showBytes: (ref, filePath) => run(["show", `${ref}:${filePath}`]),
    isAncestor: (ancestor, descendant) =>
      run(["merge-base", "--is-ancestor", ancestor, descendant]) !== null,
    changedPaths: (from, to) => {
      const out = run(["diff", "--name-only", `${from}..${to}`]);
      if (out === null) throw new Error(`git diff --name-only ${from}..${to} failed`);
      return out
        .toString("utf8")
        .split("\n")
        .filter((line) => line.length > 0);
    },
  };
}

export interface PromotionResult {
  ok: boolean;
  /** `promotable`, or the specific refusal cause. Every refusal fails closed. */
  code: string;
  reason: string;
}

function refusePromotion(code: string, reason: string): PromotionResult {
  return { ok: false, code, reason };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJsonRecord(bytes: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The direct next-to-main invariant, exactly as `branch-policy.yml` enforces it
 * on a PR into `main`. Every gate refuses with a SPECIFIC code; nothing downgrades
 * to a warning, and a missing or malformed input is always a refusal.
 */
export function checkStablePromotion(
  opts: { sourceBranch: string; headRef: string; stableRef?: string },
  git: PromotionGitOps = realPromotionGitOps()
): PromotionResult {
  // 1 — only the integration channel may be promoted to stable.
  if (opts.sourceBranch !== "next") {
    return refusePromotion(
      "source_branch_not_next",
      `source branch ${JSON.stringify(opts.sourceBranch)} is not exact "next" — stable promotion is only next -> main.`
    );
  }

  // 2 — the checked head must resolve.
  const headSha = git.resolveCommit(opts.headRef);
  if (headSha === null) {
    return refusePromotion("head_unresolvable", `head ref "${opts.headRef}" does not resolve to a commit.`);
  }

  // 3 — next must carry an exact beta version. The stable triple comes from
  //     the reviewed manifest bytes, never from a branch name.
  const manifestBytes = git.showBytes(headSha, MANIFEST_PATH);
  if (manifestBytes === null) {
    return refusePromotion("manifest_missing", `${MANIFEST_PATH} is absent at ${opts.headRef}.`);
  }
  const manifest = parseJsonRecord(manifestBytes);
  if (manifest === null || typeof manifest.version !== "string") {
    return refusePromotion("manifest_malformed", `${MANIFEST_PATH} at ${opts.headRef} has no usable version field.`);
  }
  if (!BETA_CHANNEL_VERSION.test(manifest.version)) {
    return refusePromotion(
      "manifest_version_not_beta",
      `${MANIFEST_PATH} carries ${manifest.version}; direct stable promotion requires exact MAJOR.MINOR.PATCH-beta.N on next.`
    );
  }
  const version = parseVersion(manifest.version).core.join(".");
  if (!BARE_TRIPLE_RE.test(version)) {
    return refusePromotion("manifest_version_not_beta", `${MANIFEST_PATH} did not yield a stable SemVer core.`);
  }

  // 3b — stable versions only move forward. This runs in the pre-merge gate
  // against origin/main and again post-merge against the PR's captured base
  // SHA, so a stale or mis-keyed beta triple cannot regress default installs.
  const stableRef = opts.stableRef ?? "origin/main";
  const stableSha = git.resolveCommit(stableRef);
  if (stableSha === null) {
    return refusePromotion("stable_ref_unresolvable", `stable ref "${stableRef}" does not resolve to a commit.`);
  }
  const stableManifestBytes = git.showBytes(stableSha, MANIFEST_PATH);
  if (stableManifestBytes === null) {
    return refusePromotion("stable_manifest_missing", `${MANIFEST_PATH} is absent at ${stableRef}.`);
  }
  const stableManifest = parseJsonRecord(stableManifestBytes);
  if (stableManifest === null || typeof stableManifest.version !== "string") {
    return refusePromotion(
      "stable_manifest_malformed",
      `${MANIFEST_PATH} at ${stableRef} has no usable version field.`
    );
  }
  let publishedStableVersion: string;
  if (BARE_CHANNEL_VERSION.test(stableManifest.version)) {
    publishedStableVersion = stableManifest.version;
  } else if (BETA_CHANNEL_VERSION.test(stableManifest.version)) {
    publishedStableVersion = parseVersion(stableManifest.version).core.join(".");
    const stableTag = `refs/tags/v${publishedStableVersion}`;
    const taggedStableSha = git.resolveCommit(stableTag);
    if (taggedStableSha === null) {
      return refusePromotion(
        "stable_tag_missing",
        `${MANIFEST_PATH} at ${stableRef} retains ${stableManifest.version}, but published stable tag ${stableTag} is absent.`
      );
    }
    if (taggedStableSha !== stableSha) {
      return refusePromotion(
        "stable_tag_mismatch",
        `published stable tag ${stableTag} resolves to ${taggedStableSha}, not ${stableSha} at ${stableRef}.`
      );
    }
  } else {
    return refusePromotion(
      "stable_manifest_malformed",
      `${MANIFEST_PATH} at ${stableRef} must carry exact MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-beta.N bound to its stable tag.`
    );
  }
  if (compareVersions(parseVersion(version), parseVersion(publishedStableVersion)) <= 0) {
    return refusePromotion(
      "stable_version_not_advanced",
      `derived stable version ${version} must be strictly newer than published stable ${publishedStableVersion} at ${stableRef}.`
    );
  }

  // 4 — the GENERATED marketplace manifest must agree with the canonical field.
  //     (The byte-level generation invariant is separately enforced by
  //     `check:claude-install`; this catches version drift inside the gate.)
  const marketplaceBytes = git.showBytes(headSha, MARKETPLACE_PATH);
  if (marketplaceBytes === null) {
    return refusePromotion("marketplace_missing", `${MARKETPLACE_PATH} is absent at ${opts.headRef}.`);
  }
  const marketplace = parseJsonRecord(marketplaceBytes);
  const marketplaceEntry = Array.isArray(marketplace?.plugins)
    ? (marketplace!.plugins as Array<Record<string, unknown>>).find((p) => p?.name === manifest.name)
    : undefined;
  if (marketplaceEntry === undefined) {
    return refusePromotion(
      "marketplace_malformed",
      `${MARKETPLACE_PATH} at ${opts.headRef} has no plugins[] entry named ${JSON.stringify(manifest.name)}.`
    );
  }
  if (marketplaceEntry.version !== manifest.version) {
    return refusePromotion(
      "marketplace_version_drift",
      `generated ${MARKETPLACE_PATH} carries ${JSON.stringify(marketplaceEntry.version)} while the canonical ` +
        `${MANIFEST_PATH} carries ${manifest.version}; regenerate it (npm run sync:claude-install).`
    );
  }

  // 5 — the guild.release_promotion.v1 record.
  const evidenceDir = `.guild/artifacts/release/v${version}`;
  const promotionBytes = git.showBytes(headSha, `${evidenceDir}/promotion.json`);
  if (promotionBytes === null) {
    return refusePromotion(
      "promotion_record_missing",
      `${evidenceDir}/promotion.json is absent at ${opts.headRef} — next may not reach main without it.`
    );
  }
  const promotion = parseJsonRecord(promotionBytes);
  if (promotion === null) {
    return refusePromotion("promotion_record_malformed", `${evidenceDir}/promotion.json is not a JSON object.`);
  }
  if (promotion.schema_version !== RELEASE_PROMOTION_SCHEMA) {
    return refusePromotion(
      "promotion_schema_unrecognized",
      `promotion record declares ${JSON.stringify(promotion.schema_version)}; this gate implements ${RELEASE_PROMOTION_SCHEMA}.`
    );
  }
  if (promotion.version !== version) {
    return refusePromotion(
      "promotion_version_mismatch",
      `promotion record names version ${JSON.stringify(promotion.version)} but next derives stable version ${version}.`
    );
  }
  if (typeof promotion.source_commit !== "string" || !COMMIT_SHA_RE.test(promotion.source_commit)) {
    return refusePromotion(
      "promotion_source_commit_malformed",
      `promotion.source_commit ${JSON.stringify(promotion.source_commit)} is not a 40-hex commit sha.`
    );
  }
  if (typeof promotion.evidence_sha256 !== "string" || !SHA256_HEX_RE.test(promotion.evidence_sha256)) {
    return refusePromotion(
      "promotion_evidence_hash_malformed",
      `promotion.evidence_sha256 ${JSON.stringify(promotion.evidence_sha256)} is not a 64-hex SHA-256.`
    );
  }
  if (promotion.decision !== "conformance_pass") {
    // No override path exists in this gate. An "accepted_override" record is
    // named specifically so the refusal explains the posture rather than
    // reading as a typo; a conformant decision is the ONLY promotion path.
    return promotion.decision === "accepted_override"
      ? refusePromotion(
          "promotion_override_unsupported",
          `promotion.decision "accepted_override" is not accepted — this gate has no override path; ` +
            `only decision "conformance_pass" backed by verifiable conformance evidence promotes.`
        )
      : refusePromotion(
          "promotion_decision_unrecognized",
          `promotion.decision ${JSON.stringify(promotion.decision)} is not "conformance_pass".`
        );
  }

  // 6 — the guild.release_conformance.v1 record, bound by EXACT bytes.
  const conformanceBytes = git.showBytes(headSha, `${evidenceDir}/conformance.json`);
  if (conformanceBytes === null) {
    return refusePromotion(
      "conformance_record_missing",
      `${evidenceDir}/conformance.json is absent at ${opts.headRef}.`
    );
  }
  const conformanceSha = sha256Hex(conformanceBytes);
  if (conformanceSha !== promotion.evidence_sha256) {
    return refusePromotion(
      "evidence_hash_mismatch",
      `conformance.json hashes to ${conformanceSha} but the promotion record binds ${promotion.evidence_sha256} — ` +
        `the evidence bytes are not the bytes the promotion decision was taken over.`
    );
  }
  const conformance = parseJsonRecord(conformanceBytes);
  if (conformance === null) {
    return refusePromotion("conformance_record_malformed", `${evidenceDir}/conformance.json is not a JSON object.`);
  }
  if (conformance.schema_version !== RELEASE_CONFORMANCE_SCHEMA) {
    return refusePromotion(
      "conformance_schema_unrecognized",
      `conformance record declares ${JSON.stringify(conformance.schema_version)}; this gate implements ${RELEASE_CONFORMANCE_SCHEMA}.`
    );
  }
  const contract = conformance.scenario_contract as Record<string, unknown> | undefined;
  if (
    conformance.scenario_contract_sha256 !== FROZEN_SCENARIO_CONTRACT_SHA256 ||
    contract?.sha256 !== FROZEN_SCENARIO_CONTRACT_SHA256
  ) {
    return refusePromotion(
      "scenario_contract_hash_mismatch",
      `conformance record names scenario contract ${JSON.stringify(conformance.scenario_contract_sha256)}; ` +
        `the frozen 31-scenario contract is ${FROZEN_SCENARIO_CONTRACT_SHA256}.`
    );
  }
  // 6b — the HONEST 5/31 distinction. The record must name the complete frozen
  //      contract while claiming execution of exactly the evaluator's five
  //      implemented scenarios; a record claiming more executed than the
  //      production evaluator owns is dishonest and refuses.
  //      NAMING the contract means carrying all 31 frozen scenario ids in
  //      canonical order — count + hash alone can be asserted without proving
  //      the canonical set (FIC-74 contract-completeness).
  const contractIds = Array.isArray(contract?.scenario_ids) ? (contract!.scenario_ids as unknown[]) : null;
  const contractIdsCanonical =
    contractIds !== null &&
    contractIds.length === FROZEN_SCENARIO_CONTRACT_IDS.length &&
    FROZEN_SCENARIO_CONTRACT_IDS.every((id, index) => contractIds[index] === id);
  if (!contractIdsCanonical) {
    return refusePromotion(
      "scenario_contract_ids_mismatch",
      `scenario_contract.scenario_ids must name ALL ${FROZEN_SCENARIO_CONTRACT_IDS.length} frozen scenario ids in ` +
        `canonical contract order — an omitted, substituted, duplicated, reordered, or absent id set does not ` +
        `name the frozen contract, whatever count and hash the record asserts.`
    );
  }
  // 6b — FULL-SUITE COVERAGE (A21-X). Production owns all 31 scenarios through
  //      the release-conformance integration, so the only promotable coverage
  //      statement is the COMPLETE canonical tuple: all 31 ids, in order,
  //      31 evaluated / 0 unevaluated. An honest-but-incomplete claim (the
  //      pre-A21-X 5/31 shape) can no longer back a promotion — and the count
  //      is never trusted on its own say-so: the decision re-run below is what
  //      substantiates it.
  const coverage = conformance.scenario_coverage as Record<string, unknown> | undefined;
  const evaluatedIds = Array.isArray(coverage?.evaluated_scenario_ids)
    ? (coverage!.evaluated_scenario_ids as unknown[])
    : null;
  const coverageComplete =
    contract?.scenario_count === FROZEN_SCENARIO_CONTRACT_COUNT &&
    evaluatedIds !== null &&
    evaluatedIds.length === FROZEN_SCENARIO_CONTRACT_IDS.length &&
    FROZEN_SCENARIO_CONTRACT_IDS.every((id, index) => evaluatedIds[index] === id) &&
    coverage?.evaluated_scenario_count === FROZEN_SCENARIO_CONTRACT_COUNT &&
    coverage?.unevaluated_scenario_count === 0;
  if (!coverageComplete) {
    return refusePromotion(
      "scenario_coverage_incomplete",
      `scenario_coverage must state that ALL ${FROZEN_SCENARIO_CONTRACT_COUNT} frozen scenarios were evaluated ` +
        `and assembled, naming the complete canonical id tuple in order — a record covering fewer scenarios ` +
        `(including the historical honest 5/31 shape) cannot back a stable promotion.`
    );
  }
  const recordedDecision = conformance.decision as Record<string, unknown> | undefined;
  if (recordedDecision?.disposition !== "succeeded" || recordedDecision?.may_promote_conformant !== true) {
    return refusePromotion(
      "conformance_record_decision_mismatch",
      `the conformance record's own decision is not a promotable success ` +
        `(disposition=${JSON.stringify(recordedDecision?.disposition)}, ` +
        `may_promote_conformant=${JSON.stringify(recordedDecision?.may_promote_conformant)}).`
    );
  }
  const evidence = conformance.evidence as Record<string, unknown> | undefined;
  const authority = conformance.authority as Record<string, unknown> | undefined;
  if (evidence === undefined || authority === undefined) {
    return refusePromotion(
      "conformance_record_malformed",
      `the conformance record must transport its full evaluator inputs (evidence + authority) so this gate can ` +
        `re-run the production evaluator instead of trusting the emitted verdict.`
    );
  }

  // 6c′ — NO SPLIT VIEW. The top-level activated_runtime is a SUMMARY of the
  //       evaluator input; every downstream check reads the evaluator input,
  //       and the summary must equal it exactly — otherwise a record could
  //       show one runtime to readers of the summary while transporting
  //       evaluator-green evidence for a different one.
  const evidenceActivated = (evidence.activated_runtime ?? {}) as Record<string, unknown>;
  const summaryActivated = (conformance.activated_runtime ?? {}) as Record<string, unknown>;
  const identityKeys = [...new Set([...Object.keys(evidenceActivated), ...Object.keys(summaryActivated)])].sort();
  const summaryDrift = identityKeys.filter((key) => summaryActivated[key] !== evidenceActivated[key]);
  if (summaryDrift.length > 0) {
    return refusePromotion(
      "activated_runtime_summary_mismatch",
      `the top-level activated_runtime summary diverges from the transported evaluator input on ` +
        `${summaryDrift.join(", ")} — a summary that disagrees with the evidence the evaluator judges is a ` +
        `split view, not a summary.`
    );
  }

  // 7 — ONE source-commit binding across all four records.
  const activatedRuntime = (evidence.activated_runtime ?? {}) as Record<string, unknown>;
  const authorityIdentity = (authority.identity ?? {}) as Record<string, unknown>;
  const bindings: Array<[string, unknown]> = [
    ["promotion.source_commit", promotion.source_commit],
    ["conformance.source_commit", conformance.source_commit],
    ["evidence.activated_runtime.source_commit", activatedRuntime.source_commit],
    ["authority.identity.source_commit", authorityIdentity.source_commit],
  ];
  const sourceCommit = promotion.source_commit;
  const unbound = bindings.filter(([, value]) => value !== sourceCommit);
  if (unbound.length > 0) {
    return refusePromotion(
      "source_commit_binding_mismatch",
      `every record must bind the SAME evidence source commit; ` +
        unbound.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(", ") +
        ` disagree with ${sourceCommit}.`
    );
  }

  // 8/9 — the evidence source commit must exist here and be an ancestor of head.
  if (git.resolveCommit(sourceCommit) === null) {
    return refusePromotion(
      "source_commit_unknown",
      `evidence source commit ${sourceCommit} is not a commit in this repository — the checkout cannot verify ` +
        `what the evidence was produced from.`
    );
  }
  // 8b — the evidence runtime must be the runtime the SOURCE COMMIT builds:
  //      `guild-<plugin.json version at source_commit>`. FIC-74 emits evidence
  //      at the `next` tip (SHA-T), whose manifest carries the beta shape
  //      (e.g. 2.7.0-beta.N); the protected workflow later changes ONLY metadata.
  //      Binding to the release version would make that real sequence
  //      impossible, and binding to nothing would admit evidence for a runtime
  //      the source never built — this is the truthful middle.
  const sourceManifestBytes = git.showBytes(sourceCommit, MANIFEST_PATH);
  if (sourceManifestBytes === null) {
    return refusePromotion(
      "source_manifest_missing",
      `${MANIFEST_PATH} is absent at evidence source commit ${sourceCommit} — the runtime the evidence names ` +
        `cannot be verified against what that commit builds.`
    );
  }
  const sourceManifest = parseJsonRecord(sourceManifestBytes);
  if (sourceManifest === null || typeof sourceManifest.version !== "string") {
    return refusePromotion(
      "source_manifest_malformed",
      `${MANIFEST_PATH} at evidence source commit ${sourceCommit} has no usable version field.`
    );
  }
  // Read the EVALUATOR INPUT, never the top-level summary (the summary is
  // separately required to equal it, but the binding must hold against what
  // the production evaluator actually judged).
  const expectedRuntime = `guild-${sourceManifest.version}`;
  if (activatedRuntime.runtime_version !== expectedRuntime) {
    return refusePromotion(
      "runtime_version_source_mismatch",
      `evidence names runtime ${JSON.stringify(activatedRuntime.runtime_version)} but source commit ` +
        `${sourceCommit} builds ${expectedRuntime} — evidence must name the exact runtime its source commit ` +
        `produces.`
    );
  }
  // 8c — RELEASE IDENTITY: the source manifest's SemVer CORE must equal the
  //      derived stable triple. The finalizer may only drop a prerelease identifier
  //      (2.7.0-beta.N -> 2.7.0); without this, valid
  //      evidence for an old source (e.g. 2.6.0) could authorize a
  //      metadata-only jump to any unrelated stable version.
  let sourceCore: [string, string, string];
  try {
    sourceCore = parseVersion(sourceManifest.version).core;
  } catch {
    return refusePromotion(
      "source_manifest_malformed",
      `${MANIFEST_PATH} at evidence source commit ${sourceCommit} carries unparseable version ` +
        `${JSON.stringify(sourceManifest.version)}.`
    );
  }
  if (sourceCore.join(".") !== version) {
    return refusePromotion(
      "source_version_core_mismatch",
      `evidence source commit ${sourceCommit} builds version ${sourceManifest.version} (core ` +
        `${sourceCore.join(".")}) but next derives stable version ${version} — a release may only drop the source's ` +
        `prerelease identifier, never change its core triple.`
    );
  }
  if (!git.isAncestor(sourceCommit, headSha)) {
    return refusePromotion(
      "source_commit_not_ancestor",
      `evidence source commit ${sourceCommit} is not an ancestor of ${opts.headRef} (${headSha}) — the promotion ` +
        `head does not descend from the verified source.`
    );
  }

  // 10 — the EXACT allowed diff. Anything else after the source invalidates the
  //      evidence (a runtime-path change after verification is unverified code).
  const allowed = new Set(promotionAllowedPaths(version));
  const disallowed = git.changedPaths(sourceCommit, headSha).filter((p) => !allowed.has(p));
  if (disallowed.length > 0) {
    return refusePromotion(
      "disallowed_path_changed",
      `paths changed outside the allowed promotion set: ${disallowed.join(", ")} — re-run the evidence emitter ` +
        `against the new tip instead of promoting unverified changes.`
    );
  }

  // 11 — LAST, the substance: RE-RUN the full integration/assembly decision
  //      over the transported inputs (A21-X). The gate never trusts a claimed
  //      verdict or a claimed count: the six owner packets are re-derived from
  //      source-owned slices, the REAL assembler re-joins them, and the same
  //      import-closed production decision that owns conformance semantics —
  //      including the trust-root signature verification a claimant cannot
  //      satisfy by construction — takes the only promotion decision. Running
  //      it after the structural/binding gates keeps every earlier refusal
  //      specific; the verdict is conjunctive either way, and `promotable`
  //      is unreachable without this step passing.
  const transported = evaluateTransportedReleaseConformance(evidence, authority);
  if (!transported.promotable) {
    return refusePromotion(
      "conformance_decision_not_promotable",
      `the full integration/assembly decision refused the transported evidence (stage=${transported.stage}): ` +
        `${transported.detail}.`
    );
  }

  return {
    ok: true,
    code: "promotable",
    reason:
      `next carries hash-bound full-suite conformance evidence for source ${sourceCommit} and stable ${version}, ` +
      `the integration/assembly decision re-run promotes, and the diff stays inside the allowed release set.`,
  };
}

function promotionMain(argv: string[]): number {
  let sourceBranch: string | undefined;
  let headRef = "HEAD";
  let stableRef = "origin/main";
  let root = ".";
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--source-branch" && argv[i + 1] !== undefined) sourceBranch = argv[++i];
    else if (a.startsWith("--source-branch=")) sourceBranch = a.slice("--source-branch=".length);
    else if (a === "--head" && argv[i + 1] !== undefined) headRef = argv[++i];
    else if (a.startsWith("--head=")) headRef = a.slice("--head=".length);
    else if (a === "--stable-ref" && argv[i + 1] !== undefined) stableRef = argv[++i];
    else if (a.startsWith("--stable-ref=")) stableRef = a.slice("--stable-ref=".length);
    else if (a === "--root" && argv[i + 1] !== undefined) root = argv[++i];
    else if (a.startsWith("--root=")) root = a.slice("--root=".length);
    else if (a === "--json") json = true;
    else {
      process.stderr.write(
        `unknown argument: ${a}\n` +
          "usage: check-channel-integrity.ts promotion --source-branch next [--head <ref>] [--stable-ref <ref>] [--root <dir>] [--json]\n"
      );
      return 1;
    }
  }
  if (sourceBranch === undefined) {
    process.stderr.write(
      "promotion mode requires --source-branch next\n" +
        "usage: check-channel-integrity.ts promotion --source-branch next [--head <ref>] [--stable-ref <ref>] [--root <dir>] [--json]\n"
    );
    return 1;
  }

  let result: PromotionResult;
  try {
    result = checkStablePromotion({ sourceBranch, headRef, stableRef }, realPromotionGitOps(root));
  } catch (err) {
    process.stderr.write(
      `check-channel-integrity promotion: ${String(err instanceof Error ? err.message : err)}\n`
    );
    return 1;
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  }
  if (!result.ok) {
    process.stderr.write(`check-channel-integrity promotion: GATE FAILURE — [${result.code}] ${result.reason}\n`);
    return 2;
  }
  process.stdout.write(`check-channel-integrity promotion: OK — ${result.reason}\n`);
  return 0;
}

// Kept LAST: the CLI dispatch must run only after every promotion-mode const
// above is initialized (a guard placed earlier would hit the temporal dead
// zone when the script is executed directly in promotion mode).
if (require.main === module) {
  process.exit(main());
}
