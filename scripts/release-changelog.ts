/**
 * scripts/release-changelog.ts
 *
 * Release-changelog generator (release-discipline rule 2 / checklist step 3).
 *
 * Collects the PRs merged since the last release tag, groups them into a tidy
 * versioned section, and (with --write) prepends it to CHANGELOG.md — so the
 * changelog is authored ON the release/vX.Y.Z branch and reviewed as part of
 * the release PR. The same output (--notes) seeds the PR body, which
 * release.yml publishes verbatim as the GitHub Release notes.
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
 * Mechanics: PR numbers are recovered from the commit subjects in
 * `<since>..<end>` (squash "(#N)" AND merge-commit "Merge pull request #N"
 * shapes), deduped, then resolved via `gh pr view` for title/author/labels.
 * Grouping is by conventional-commit prefix of the PR title. Deterministic:
 * no model, no timestamps except the release date (git commit date of <end>).
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
  const bare = version.replace(/^v/, "").replace(/\./g, "\\.");
  if (new RegExp(`^## \\[?v?${bare}(\\]|\\s|—|-)`, "m").test(existing)) {
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

function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" }).trim();
}

function main(): void {
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
      process.stderr.write(`[release-changelog] unknown argument: ${a}\n`);
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

  const prs: PrInfo[] = [];
  for (const n of prNumbers) {
    try {
      const raw = sh(cwd, "gh", [
        "pr", "view", String(n),
        ...(repo ? ["--repo", repo] : []),
        "--json", "number,title,author",
      ]);
      const pr = JSON.parse(raw) as { number: number; title: string; author?: { login?: string } };
      prs.push({ number: pr.number, title: pr.title, author: pr.author?.login ?? "" });
    } catch {
      process.stderr.write(`[release-changelog] WARN: could not resolve PR #${n} via gh — listed bare\n`);
      prs.push({ number: n, title: fallbackTitle(subjects, n), author: "" });
    }
  }

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
