/**
 * scripts/release-changelog.ts
 *
 * Release-changelog generator (release-discipline rules 5 and 8).
 *
 * Collects the PRs merged since the last release tag, groups them into a tidy
 * versioned section, and (with --write) prepends it to CHANGELOG.md — so the
 * protected post-merge release job prepends the section to the metadata-only
 * stable commit. The curated direct `next -> main` PR body remains the GitHub
 * Release notes published by release.yml.
 *
 *   npx tsx release-changelog.ts --version v2.1.0            # print the section
 *   npx tsx release-changelog.ts --version v2.1.0 --write    # prepend to CHANGELOG.md
 *   npx tsx release-changelog.ts --version v2.1.0 --notes    # PR-body flavor (no H2 header)
 *
 * Options:
 *   --since <tag>   base tag (default: latest v* tag reachable from HEAD)
 *   --end <ref>     end of the range (default: HEAD)
 *   --repo <o/r>    GitHub repo for PR lookups (default: origin remote)
 *   --cwd <dir>     repo root (default: script's repo)
 *
 * Mechanics: candidate PR numbers are recovered from the commit subjects in
 * `<since>..<end>` (squash "(#N)" AND merge-commit "Merge pull request #N"
 * shapes) — a noisy heuristic, since this repo's own commits reference issue
 * numbers with the same "(#N)" shape, and a candidate number can also collide
 * with an unrelated already-merged PR. Each candidate becomes a changelog row
 * ONLY when `gh pr view` confirms it as MERGED with its merge commit actually
 * reachable in `<since>..<end>`; issue refs, unmerged PRs, and out-of-window
 * merges are dropped (no /pull/ link, no row). A gh lookup that fails
 * operationally (auth/network/rate-limit/malformed JSON) is NOT treated as
 * "not a PR" — it aborts generation instead of shipping an incomplete
 * changelog. Grouping is by conventional-commit prefix of the PR title.
 * Deterministic: no model, no timestamps except the release date (git commit
 * date of <end>).
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

export interface PrInfo {
  number: number;
  title: string;
  author: string;
}

export interface ChangelogSectionInput {
  version: string;
  date: string; // YYYY-MM-DD
  prs: PrInfo[];
  compareUrl: string | null;
}

const GROUPS: Array<{ heading: string; prefixes: string[] }> = [
  { heading: "Added", prefixes: ["feat"] },
  { heading: "Fixed", prefixes: ["fix", "hotfix"] },
  { heading: "Documentation", prefixes: ["docs", "doc"] },
  {
    heading: "Internal",
    prefixes: ["refactor", "chore", "ci", "build", "test", "perf", "style"],
  },
];
const FALLBACK_HEADING = "Changed";

/** "feat(roster): pass metadata" → { group: "Added", text: "roster: pass metadata" } */
export function classifyTitle(title: string): { heading: string; text: string } {
  const m = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/.exec(title.trim());
  if (!m) return { heading: FALLBACK_HEADING, text: title.trim() };
  const prefix = m[1].toLowerCase();
  const scope = m[2];
  const text = scope ? `${scope}: ${m[4]}` : m[4];
  for (const g of GROUPS) {
    if (g.prefixes.includes(prefix)) return { heading: g.heading, text };
  }
  return { heading: FALLBACK_HEADING, text };
}

export function extractPrNumbers(subjects: string[]): number[] {
  const nums = new Set<number>();
  for (const s of subjects) {
    const squash = /\(#(\d+)\)\s*$/.exec(s);
    if (squash) nums.add(parseInt(squash[1], 10));
    const merge = /^Merge pull request #(\d+)\b/.exec(s);
    if (merge) nums.add(parseInt(merge[1], 10));
  }
  return [...nums].sort((a, b) => a - b);
}

export interface GhPrLookup {
  number: number;
  title: string;
  author: string;
  state: string; // gh's PR state string, e.g. "MERGED" | "OPEN" | "CLOSED"
  mergeCommitOid: string | null; // gh's PullRequest.mergeCommit.oid, null if unset/unmerged
}

/** The outcome of resolving one candidate number via `gh pr view`. */
export type GhLookupOutcome =
  | { kind: "resolved"; data: GhPrLookup }
  | { kind: "not_found" } // gh confirms: no such pull request (e.g. it's an issue number)
  | { kind: "error"; message: string }; // operational failure (auth/network/rate-limit/malformed) — must abort

export interface CollectPrsResult {
  prs: PrInfo[];
  notFound: number[]; // gh confirmed these are not pull requests at all
  notConfirmedMerged: number[]; // gh resolved a PR, but not MERGED-with-commit-in-window
}

/**
 * extractPrNumbers is a noisy heuristic: commit subjects that reference an
 * issue with the same "(#NN)" shape GitHub uses for squash-merge PR numbers
 * (a convention this repo's own commits use, e.g. "(#59)" for issue #59) are
 * indistinguishable from real PR numbers at extraction time, and a candidate
 * number can also collide with a real, already-merged PR from an unrelated
 * time period. Confirmation happens here instead: a candidate becomes a
 * changelog row only when gh resolves it AND it is MERGED AND its merge
 * commit is actually reachable in `<since>..<end>` (`rangeShas`) — that last
 * check is what stops a stale, unrelated PR number from being confirmed just
 * because its number happens to appear in a commit subject in this range.
 *
 * `not_found` outcomes (issue refs, nonexistent numbers) are dropped
 * silently — never linkified, never a row. An `error` outcome (gh couldn't
 * be asked at all — auth/network/rate-limit/malformed JSON) is NOT treated
 * as "not a PR": it throws, so the caller aborts generation rather than
 * silently shipping an incomplete changelog. A candidate with NO recorded
 * outcome at all is an internal-contract violation (every candidate must be
 * looked up before this runs) and also throws — never silently dropped.
 */
export function collectConfirmedPrs(
  candidates: number[],
  outcomes: Map<number, GhLookupOutcome>,
  rangeShas: ReadonlySet<string>
): CollectPrsResult {
  const prs: PrInfo[] = [];
  const notFound: number[] = [];
  const notConfirmedMerged: number[] = [];
  for (const n of candidates) {
    const outcome = outcomes.get(n);
    if (!outcome) {
      throw new Error(`no gh lookup outcome recorded for #${n}`);
    }
    if (outcome.kind === "not_found") {
      notFound.push(n);
      continue;
    }
    if (outcome.kind === "error") {
      throw new Error(`gh lookup failed for #${n}: ${outcome.message}`);
    }
    const { data } = outcome;
    if (data.state === "MERGED" && data.mergeCommitOid && rangeShas.has(data.mergeCommitOid)) {
      prs.push({ number: data.number, title: data.title, author: data.author });
    } else {
      notConfirmedMerged.push(n);
    }
  }
  return { prs, notFound, notConfirmedMerged };
}

/**
 * gh-failure fallback: pick the commit subject belonging to EXACTLY PR #n,
 * using the same anchored shapes as extractPrNumbers (a bare substring match
 * would let #1 hit a "#10" subject). Squash subjects get their "(#n)" suffix
 * stripped so the title reads clean.
 */
export function fallbackTitle(subjects: string[], n: number): string {
  for (const s of subjects) {
    const squash = /^(.*)\(#(\d+)\)\s*$/.exec(s);
    if (squash && parseInt(squash[2], 10) === n) return squash[1].trim();
    const merge = /^Merge pull request #(\d+)\b/.exec(s);
    if (merge && parseInt(merge[1], 10) === n) return s;
  }
  return `PR #${n}`;
}

export function renderSection(input: ChangelogSectionInput, opts: { header?: boolean } = {}): string {
  const { version, date, prs, compareUrl } = input;
  const byHeading = new Map<string, string[]>();
  for (const pr of prs) {
    const { heading, text } = classifyTitle(pr.title);
    const line = `- ${text} ([#${pr.number}](${prLink(compareUrl, pr.number)}))${pr.author ? ` — @${pr.author}` : ""}`;
    byHeading.set(heading, [...(byHeading.get(heading) ?? []), line]);
  }
  const order = [...GROUPS.map((g) => g.heading), FALLBACK_HEADING];
  const parts: string[] = [];
  // Keep a Changelog heading shape, matching the existing file: "## [2.1.0] — date".
  if (opts.header !== false) parts.push(`## [${version.replace(/^v/, "")}] — ${date}`);
  if (prs.length === 0) {
    parts.push("", "_No merged PRs found in range — write this section by hand._");
  }
  for (const heading of order) {
    const lines = byHeading.get(heading);
    if (!lines || lines.length === 0) continue;
    parts.push("", `### ${heading}`, "", ...lines);
  }
  if (compareUrl) parts.push("", `**Full Changelog**: ${compareUrl}`);
  return parts.join("\n") + "\n";
}

function prLink(compareUrl: string | null, n: number): string {
  // compareUrl shape: https://github.com/<o>/<r>/compare/<a>...<b>
  const repoBase = compareUrl ? compareUrl.replace(/\/compare\/.*$/, "") : null;
  return repoBase ? `${repoBase}/pull/${n}` : `#${n}`;
}

/**
 * Prepend a version section into CHANGELOG.md: after the title/preamble AND
 * after a Keep-a-Changelog `## [Unreleased]` block when present, immediately
 * above the newest existing version section. Idempotent: if a `## <version>`
 * heading already exists, the file is returned unchanged.
 */
export function prependToChangelog(existing: string, section: string, version: string): string {
  // Match the version with or without the leading v and with or without
  // Keep-a-Changelog brackets: "## v2.1.0", "## [2.1.0] — …", "## [v2.1.0]".
  // Plain string comparison (no dynamic RegExp — the comms-format OD-3 gate
  // rejects template-built regexes as hand-rolled field extractors).
  const bare = version.replace(/^v/, "");
  const BOUNDARIES = ["]", " ", "\t", "—", "-"];
  const hasVersionHeading = existing.split("\n").some((line) => {
    if (!line.startsWith("## ")) return false;
    let rest = line.slice(3);
    if (rest.startsWith("[")) rest = rest.slice(1);
    if (rest.startsWith("v")) rest = rest.slice(1);
    if (!rest.startsWith(bare)) return false;
    const after = rest.slice(bare.length, bare.length + 1);
    return after === "" || BOUNDARIES.includes(after);
  });
  if (hasVersionHeading) {
    return existing;
  }
  const lines = existing.split("\n");
  const isH2 = (l: string) => /^## /.test(l);
  const isUnreleased = (l: string) => /^## \[?unreleased\]?/i.test(l);
  let insertAt = lines.length;
  let seenUnreleased = false;
  for (let i = 0; i < lines.length; i++) {
    if (!isH2(lines[i])) continue;
    if (isUnreleased(lines[i])) {
      seenUnreleased = true;
      continue; // the new release goes BELOW the [Unreleased] block
    }
    insertAt = i;
    break;
  }
  // File with only an [Unreleased] block (or none): append at EOF, which
  // `insertAt = lines.length` already encodes.
  void seenUnreleased;
  const before = lines.slice(0, insertAt).join("\n").replace(/\n+$/, "\n\n");
  const after = lines.slice(insertAt).join("\n");
  return `${before}${section}\n${after}`;
}

// ── Git/GitHub plumbing ─────────────────────────────────────────────────────

// stdio explicitly captured (never inherited) so a failing child's raw
// stderr never reaches the terminal ahead of our own sanitized diagnostics.
function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// gh's exact, canonical message when a number refers to something other than
// a pull request (e.g. an issue) — verified against gh 2.96.0. Anchored to
// the WHOLE trimmed message (not a substring match) and to the specific
// candidate number, so an operational error that happens to mention this
// phrase alongside other text (e.g. wrapped in an HTTP error) is never
// misclassified as "not a PR" — everything else aborts.
export function isGhNotFoundMessage(message: string, n: number): boolean {
  // Exact-string comparison (no dynamic RegExp — comms-format OD-3 gate). gh
  // emits either one space or a newline between the sentence and the
  // "(repository.pullRequest)" locator; both whole-message shapes are accepted.
  const head = `GraphQL: Could not resolve to a PullRequest with the number of ${n}.`;
  const tail = "(repository.pullRequest)";
  const trimmed = message.trim();
  if (!trimmed.startsWith(head) || !trimmed.endsWith(tail)) return false;
  const between = trimmed.slice(head.length, trimmed.length - tail.length);
  return /^\s*$/.test(between);
}

function ghErrorMessage(err: unknown): string {
  const e = err as { stderr?: unknown; message?: string };
  const stderr = typeof e.stderr === "string" ? e.stderr.trim() : "";
  return stderr || e.message || String(err);
}

/**
 * Validates `gh pr view --json number,title,author,state,mergeCommit` output.
 * A response that parses as JSON but doesn't match this shape (wrong/missing
 * `number`, non-string title/state, a malformed `mergeCommit`, or a MERGED
 * state with no usable merge-commit oid) throws — treated as an operational
 * failure by the caller, never silently accepted as a confirmed (or
 * confirmed-absent) PR. `mergeCommit` may legitimately be null/absent for an
 * unmerged PR, but a MERGED PR without one is a data-integrity problem, not
 * "not merged" — it must abort, not silently fall through to
 * `notConfirmedMerged`.
 */
const GH_PR_STATES = new Set(["OPEN", "CLOSED", "MERGED"]);
// gh's mergeCommit.oid is always a FULL git object id — 40 hex chars (sha1)
// or 64 (sha256) — never abbreviated. Anything else is malformed, not just
// "doesn't match this range". Case-insensitive match, normalized to
// lowercase below, since `git rev-list` (rangeShas) always emits lowercase.
const GIT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function parseGhPrJson(raw: string, expectedNumber: number): GhPrLookup {
  const pr = JSON.parse(raw) as {
    number?: unknown;
    title?: unknown;
    author?: { login?: unknown } | null;
    state?: unknown;
    mergeCommit?: { oid?: unknown } | null;
  };
  if (
    typeof pr.number !== "number" ||
    pr.number !== expectedNumber ||
    typeof pr.title !== "string" ||
    pr.title.trim() === "" ||
    typeof pr.state !== "string" ||
    !GH_PR_STATES.has(pr.state)
  ) {
    throw new Error(`gh returned an unexpected shape for #${expectedNumber}: ${raw}`);
  }
  let author = "";
  if (pr.author != null) {
    if (typeof pr.author !== "object" || typeof pr.author.login !== "string" || pr.author.login.trim() === "") {
      throw new Error(`gh returned a malformed author for #${expectedNumber}: ${raw}`);
    }
    author = pr.author.login;
  }
  let mergeCommitOid: string | null = null;
  if (pr.mergeCommit != null) {
    const oid = typeof pr.mergeCommit === "object" ? pr.mergeCommit.oid : undefined;
    if (typeof oid !== "string" || !GIT_OID_PATTERN.test(oid.trim())) {
      throw new Error(`gh returned a malformed mergeCommit for #${expectedNumber}: ${raw}`);
    }
    mergeCommitOid = oid.trim().toLowerCase();
  }
  if (pr.state === "MERGED" && mergeCommitOid === null) {
    throw new Error(`gh reported #${expectedNumber} as MERGED but returned no mergeCommit oid: ${raw}`);
  }
  return { number: pr.number, title: pr.title, author, state: pr.state, mergeCommitOid };
}

// Strip control/formatting characters (ASCII + Unicode Cc/Cf, including bidi
// overrides) and cap length before external (gh/commit-subject) text reaches stderr.
function sanitizeForLog(s: string, maxLen = 300): string {
  return s.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, maxLen);
}

// Top-level boundary: any exception not already handled with its own
// sanitized message (e.g. an unwrapped `git`/`fs` failure) is sanitized here
// before it reaches stderr — a raw execFileSync error can embed the child's
// full, unsanitized stderr in its `message`.
function main(): void {
  try {
    run();
  } catch (err) {
    process.stderr.write(`[release-changelog] ${sanitizeForLog(ghErrorMessage(err))} — aborting\n`);
    process.exit(1);
  }
}

function run(): void {
  const argv = process.argv.slice(2);
  let version: string | null = null;
  let since: string | null = null;
  let end = "HEAD";
  let repo: string | null = null;
  let cwd = path.resolve(__dirname, "..");
  let write = false;
  let notes = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" && i + 1 < argv.length) version = argv[++i];
    else if (a === "--since" && i + 1 < argv.length) since = argv[++i];
    else if (a === "--end" && i + 1 < argv.length) end = argv[++i];
    else if (a === "--repo" && i + 1 < argv.length) repo = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) cwd = path.resolve(argv[++i]);
    else if (a === "--write") write = true;
    else if (a === "--notes") notes = true;
    else {
      process.stderr.write(`[release-changelog] unknown argument: ${sanitizeForLog(a, 200)}\n`);
      process.exit(1);
    }
  }
  if (!version || !/^v\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    process.stderr.write(
      "[release-changelog] --version vX.Y.Z[-pre] is required (must match release.yml's tag shape)\n"
    );
    process.exit(1);
  }

  if (!since) {
    try {
      since = sh(cwd, "git", ["describe", "--tags", "--abbrev=0", "--match", "v*", end]);
    } catch {
      process.stderr.write(
        "[release-changelog] no reachable v* tag — pass --since <tag|ref> explicitly\n"
      );
      process.exit(1);
    }
  }

  if (!repo) {
    const origin = sh(cwd, "git", ["remote", "get-url", "origin"]);
    const m = /github\.com[/:]([^/]+\/[^/.]+)/.exec(origin);
    repo = m ? m[1] : null;
  }

  const subjects = sh(cwd, "git", ["log", "--format=%s", `${since}..${end}`])
    .split("\n")
    .filter(Boolean);
  const prNumbers = extractPrNumbers(subjects);
  const rangeShas = new Set(
    sh(cwd, "git", ["rev-list", `${since}..${end}`]).split("\n").filter(Boolean)
  );

  const outcomes = new Map<number, GhLookupOutcome>();
  for (const n of prNumbers) {
    try {
      const raw = sh(cwd, "gh", [
        "pr", "view", String(n),
        ...(repo ? ["--repo", repo] : []),
        "--json", "number,title,author,state,mergeCommit",
      ]);
      outcomes.set(n, { kind: "resolved", data: parseGhPrJson(raw, n) });
    } catch (err) {
      const message = ghErrorMessage(err);
      outcomes.set(n, isGhNotFoundMessage(message, n) ? { kind: "not_found" } : { kind: "error", message });
    }
  }

  let result: CollectPrsResult;
  try {
    result = collectConfirmedPrs(prNumbers, outcomes, rangeShas);
  } catch (err) {
    process.stderr.write(
      `[release-changelog] ${sanitizeForLog((err as Error).message)} — aborting (not writing a partial changelog)\n`
    );
    process.exit(1);
  }
  for (const n of result.notFound) {
    process.stderr.write(
      `[release-changelog] SKIP #${n}: gh confirms this is not a pull request (referenced via "${sanitizeForLog(fallbackTitle(subjects, n))}") — candidate omitted, no row\n`
    );
  }
  for (const n of result.notConfirmedMerged) {
    const state = (outcomes.get(n) as { kind: "resolved"; data: GhPrLookup }).data.state;
    process.stderr.write(
      `[release-changelog] SKIP #${n}: gh resolved a pull request but it is not confirmed merged within ${sanitizeForLog(since ?? "", 100)}..${sanitizeForLog(end, 100)} (state=${sanitizeForLog(state, 40)}) — candidate omitted, no row\n`
    );
  }
  const prs = result.prs;

  const date = sh(cwd, "git", ["log", "-1", "--format=%cs", end]);
  const compareUrl = repo ? `https://github.com/${repo}/compare/${since}...${version}` : null;
  const section = renderSection({ version, date, prs, compareUrl }, { header: !notes });

  if (write) {
    const clPath = path.join(cwd, "CHANGELOG.md");
    const existing = fs.existsSync(clPath) ? fs.readFileSync(clPath, "utf8") : "# Changelog\n\n";
    const updated = prependToChangelog(existing, section, version);
    if (updated === existing) {
      process.stderr.write(`[release-changelog] ${version} already present in CHANGELOG.md — unchanged\n`);
    } else {
      fs.writeFileSync(clPath, updated, "utf8");
      process.stderr.write(`[release-changelog] prepended ${version} section to CHANGELOG.md (${prs.length} PRs since ${since})\n`);
    }
  }
  process.stdout.write(section);
}

if (require.main === module) main();
