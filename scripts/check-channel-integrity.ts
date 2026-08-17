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
 * Channel mode reads `.claude-plugin/plugin.json` from both refs. Stable must
 * be literal MAJOR.MINOR.PATCH. Divergent next must be a newer literal
 * MAJOR.MINOR.PATCH-beta.N; equal bare versions are valid only when both refs
 * resolve to the same commit. Promotion mode validates a release PR's
 * prospective merge commit against hash-bound evidence, the exact frozen
 * 31-scenario tuple, the neutral conformance evaluator, and source ancestry.
 *
 * PRERELEASE ORDERING — full SemVer §11 precedence, NOT a bare triple compare.
 * A naive "ignore the suffix" comparison produces a FALSE PASS on exactly the
 * case that matters: `main` at `2.3.2` with `next` at `2.3.2-rc1` would read as
 * "in sync" when SemVer says `2.3.2-rc1 < 2.3.2` — beta genuinely trailing
 * stable. So: equal triples ⇒ a version WITH a prerelease is LOWER than one
 * without; two prereleases compare identifier-by-identifier (numeric
 * identifiers numerically and below alphanumerics). Channel policy is stricter
 * than the generic parser: next accepts only the exact `beta.N` spelling.
 *
 * PREVENTION AND DEFENSE IN DEPTH.
 * `branch-policy.yml` runs promotion mode against GitHub's prospective merge
 * commit before a release PR may enter stable. `release.yml` re-runs the same
 * check at the actual merge commit before tagging or publishing. The standing
 * channel workflow separately reports sync-back debt on pushes and schedule.
 *
 * NOT A MERGE-SHAPE CHECK. Rule 8 also constrains HOW the sync-back lands (a
 * fast-forward when ancestry allows, otherwise a delta-copy PR). That is a
 * property of the fix, not of the resulting state, and is left to review. This
 * Channel mode answers whether the channel identities are valid and ordered;
 * promotion mode answers whether a specific stable candidate is evidence-bound.
 *
 * Usage:
 *   npx tsx scripts/check-channel-integrity.ts [--stable <ref>] [--beta <ref>] [--json]
 *   npx tsx scripts/check-channel-integrity.ts promotion --release-branch release/vX.Y.Z --head <merge-sha>
 *
 * Exit: 0 ok · 2 policy/promotion refusal · 1 IO/usage error.
 *
 * Owned by tooling-engineer. Read-only: it runs `git show` and nothing else.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  evaluateNeutralConformanceDecision,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  type NeutralConformanceAuthority,
  type NeutralConformanceEvidence,
} from "../src/modules/lifecycle/workflows/neutral-conformance-core";

export const MANIFEST_PATH = ".claude-plugin/plugin.json";
export const FROZEN_CONFORMANCE_SCENARIOS = 31;
export const FROZEN_SCENARIO_CONTRACT_SHA256 =
  "09d2b6f4c9d98245dd13da4f834fb193e1b21f76625471538e12533d70fa165e";
export const FROZEN_SCENARIO_IDS = Object.freeze([
  "MHRC-LIF-001", "MHRC-LIF-002", "MHRC-LIF-003", "MHRC-LIF-004",
  "MHRC-EVT-001", "MHRC-EVT-002",
  "MHRC-SUP-001", "MHRC-SUP-002", "MHRC-SUP-003", "MHRC-SUP-004", "MHRC-SUP-005", "MHRC-SUP-006",
  "MHRC-UNS-001", "MHRC-UNS-002", "MHRC-UNS-003",
  "MHRC-RCT-001", "MHRC-RCT-002", "MHRC-RCT-003", "MHRC-RCT-004", "MHRC-RCT-005",
  "MHRC-MOD-001", "MHRC-MOD-002", "MHRC-MOD-003", "MHRC-MOD-004",
  "MHRC-STR-001", "MHRC-STR-002", "MHRC-STR-003", "MHRC-STR-004",
  "MHRC-VER-001", "MHRC-VER-002", "MHRC-VER-003",
] as const);

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

export type PromotionDecision = "conformance_pass" | "accepted_override";

export interface PromotionRecord {
  schema: "guild.release_promotion.v1";
  version: string;
  source_commit: string;
  evidence_path: string;
  evidence_sha256: string;
  scenario_contract_sha256: string;
  decision: PromotionDecision;
  override_reason?: string;
  known_gap?: string;
}

export interface PromotionConformancePayload {
  schema: "guild.release_conformance.v1";
  scenario_contract_sha256: string;
  evidence: NeutralConformanceEvidence;
  authority: NeutralConformanceAuthority;
}

export interface PromotionResult {
  ok: boolean;
  version: string;
  releaseDir: string;
  recordPath: string;
  reason: string;
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

export function checkChannelIntegrity(
  stableRef: string,
  betaRef: string,
  read: (r: string) => string = gitShowManifest,
  resolveRef: (r: string) => string = read === gitShowManifest ? gitResolveRef : (r) => r
): IntegrityResult {
  const sv = versionAtRef(stableRef, read);
  const bv = versionAtRef(betaRef, read);
  const sp = parseVersion(sv);
  const bp = parseVersion(bv);
  const stable = { ref: stableRef, commit: resolveRef(stableRef), version: sv, ...sp };
  const beta = { ref: betaRef, commit: resolveRef(betaRef), version: bv, ...bp };
  const cmp = compareVersions(bp, sp);
  const coreCmp = compareVersions({ ...bp, prerelease: [] }, { ...sp, prerelease: [] });

  if (!BARE_CHANNEL_VERSION.test(sv)) {
    return { stable, beta, ok: false, reason: `stable channel (${stableRef}) must use exact MAJOR.MINOR.PATCH; found ${sv}.` };
  }
  if (stable.commit === beta.commit) {
    return sv === bv
      ? { stable, beta, ok: true, reason: `both channels at ${bv} on the same commit — in sync at a quiescent sync-back point.` }
      : { stable, beta, ok: false, reason: `the same commit reports different channel versions (${sv} vs ${bv}).` };
  }
  if (cmp <= 0) {
    return {
      stable,
      beta,
      ok: false,
      reason: cmp < 0
        ? `beta channel (${betaRef}) is at ${bv} while stable (${stableRef}) is at ${sv} — beta users are running OLDER code than stable. The release-discipline rule-8 sync-back did not land.`
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

function assertContainedRegularFile(root: string, candidate: string, label: string): string {
  if (isAbsolute(candidate)) throw new Error(`${label} must be repository-relative`);
  const rootReal = realpathSync(root);
  const resolved = resolve(rootReal, candidate);
  const real = realpathSync(resolved);
  const rel = relative(rootReal, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${label} escapes the repository`);
  if (!statSync(real).isFile()) throw new Error(`${label} is not a regular file`);
  return real;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function checkStablePromotion(options: {
  root: string;
  releaseBranch: string;
  head: string;
  labels?: string[];
}, evaluateConformance: (
  evidence: NeutralConformanceEvidence,
  authority: NeutralConformanceAuthority,
) => { disposition?: unknown; facts?: Record<string, unknown> } = evaluateNeutralConformanceDecision): PromotionResult {
  const { root, releaseBranch, head, labels = [] } = options;
  const match = /^release\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(releaseBranch);
  if (!match) throw new Error(`release branch must be release/vX.Y.Z; found ${releaseBranch}`);
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const manifest = JSON.parse(readFileSync(resolve(root, MANIFEST_PATH), "utf8")) as { version?: unknown };
  if (manifest.version !== version) throw new Error(`release branch ${releaseBranch} disagrees with manifest version ${String(manifest.version)}`);

  const releaseRel = `.guild/artifacts/release/v${version}`;
  const releaseDir = resolve(root, releaseRel);
  const recordRel = `${releaseRel}/promotion.json`;
  const evidenceRel = `${releaseRel}/conformance.json`;
  const recordPath = assertContainedRegularFile(root, recordRel, "promotion record");
  const evidencePath = assertContainedRegularFile(root, evidenceRel, "conformance evidence");
  const record = JSON.parse(readFileSync(recordPath, "utf8")) as PromotionRecord;
  if (record.schema !== "guild.release_promotion.v1" || record.version !== version) throw new Error("promotion record schema/version mismatch");
  if (record.evidence_path !== evidenceRel) throw new Error(`evidence_path must be ${evidenceRel}`);
  if (!/^[0-9a-f]{64}$/.test(record.evidence_sha256)) throw new Error("promotion evidence_sha256 must be lowercase SHA-256");
  const evidenceBytes = readFileSync(evidencePath);
  if (sha256(evidenceBytes) !== record.evidence_sha256) throw new Error("conformance evidence SHA-256 mismatch");
  const payload = JSON.parse(evidenceBytes.toString("utf8")) as PromotionConformancePayload;
  if (payload.schema !== "guild.release_conformance.v1") {
    throw new Error("conformance payload schema mismatch");
  }
  if (
    record.scenario_contract_sha256 !== FROZEN_SCENARIO_CONTRACT_SHA256 ||
    payload.scenario_contract_sha256 !== FROZEN_SCENARIO_CONTRACT_SHA256
  ) {
    throw new Error("promotion is not pinned to the frozen 31-scenario contract");
  }
  if (
    payload.evidence?.suite_id !== NEUTRAL_SCENARIO_SUITE_ID ||
    payload.evidence?.suite_version !== NEUTRAL_SCENARIO_SUITE_VERSION
  ) {
    throw new Error("conformance evidence is not pinned to the frozen suite id/version");
  }
  if (
    !Array.isArray(payload.evidence.required_scenario_ids) ||
    payload.evidence.required_scenario_ids.length !== FROZEN_CONFORMANCE_SCENARIOS ||
    payload.evidence.required_scenario_ids.some((id, index) => id !== FROZEN_SCENARIO_IDS[index])
  ) {
    throw new Error("conformance evidence must name all 31 frozen scenario IDs in canonical order");
  }
  if (!/^[0-9a-f]{40}$/.test(record.source_commit)) {
    throw new Error("promotion record source_commit must be an exact lowercase commit SHA");
  }
  if (
    payload.evidence.activated_runtime?.source_commit !== record.source_commit ||
    payload.authority?.identity?.source_commit !== record.source_commit
  ) {
    throw new Error("promotion source_commit does not match evidence and authority runtime identity");
  }
  const headCommit = git(["rev-parse", "--verify", `${head}^{commit}`], root);
  // `merge-base --is-ancestor` succeeds with empty stdout; non-ancestry throws.
  git(["merge-base", "--is-ancestor", record.source_commit, headCommit], root);
  const changed = git(["diff", "--name-only", `${record.source_commit}..${headCommit}`], root)
    .split("\n")
    .filter(Boolean);
  const allowed = new Set([recordRel, evidenceRel, MANIFEST_PATH, "CHANGELOG.md", "guild.inventory.json"]);
  const runtimeChange = changed.find((p) => !allowed.has(p));
  if (runtimeChange) throw new Error(`runtime change after conformance evidence: ${runtimeChange}`);

  if (record.decision === "conformance_pass") {
    const outcome = evaluateConformance(payload.evidence, payload.authority);
    if (outcome.disposition !== "succeeded" || outcome.facts?.may_promote_conformant !== true) {
      throw new Error("the frozen conformance evaluator did not approve all 31 scenarios");
    }
  } else if (record.decision === "accepted_override") {
    if (!record.override_reason?.trim() || !record.known_gap?.trim()) throw new Error("accepted_override requires override_reason and known_gap");
    if (!labels.includes("release-conformance-override-accepted")) throw new Error("accepted_override requires the exact acceptance label");
  } else {
    throw new Error(`unsupported promotion decision ${String(record.decision)}`);
  }
  return { ok: true, version, releaseDir, recordPath, reason: `hash-bound promotion evidence accepted for v${version}` };
}

export function main(argv: string[] = process.argv.slice(2)): number {
  if (argv[0] === "promotion") {
    let releaseBranch = "";
    let head = "HEAD";
    let root = process.cwd();
    let labels: string[] = [];
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--release-branch" && argv[i + 1]) releaseBranch = argv[++i];
      else if (a.startsWith("--release-branch=")) releaseBranch = a.slice(17);
      else if (a === "--head" && argv[i + 1]) head = argv[++i];
      else if (a.startsWith("--head=")) head = a.slice(7);
      else if (a === "--root" && argv[i + 1]) root = argv[++i];
      else if (a.startsWith("--root=")) root = a.slice(7);
      else if (a === "--labels-json" && argv[i + 1]) labels = JSON.parse(argv[++i]);
      else if (a.startsWith("--labels-json=")) labels = JSON.parse(a.slice(14));
      else { process.stderr.write(`unknown promotion argument: ${a}\n`); return 1; }
    }
    try {
      const result = checkStablePromotion({ root, releaseBranch, head, labels });
      process.stdout.write(`check-channel-integrity: OK — ${result.reason}\n`);
      return 0;
    } catch (err) {
      process.stderr.write(`check-channel-integrity: PROMOTION GATE FAILURE — ${String(err instanceof Error ? err.message : err)}\n`);
      return 2;
    }
  }
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
