/**
 * scripts/__tests__/release-changelog.test.ts
 *
 * Pure-helper coverage for the release-changelog generator: PR-number
 * extraction (squash + merge-commit shapes), conventional-title grouping,
 * section rendering, and idempotent CHANGELOG prepending — plus a CLI-level
 * integration test (real git, a fake `gh` on PATH) covering the full v2.3.0
 * regression end to end.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  classifyTitle,
  collectConfirmedPrs,
  extractPrNumbers,
  fallbackTitle,
  isGhNotFoundMessage,
  parseGhPrJson,
  prependToChangelog,
  renderSection,
} from "../release-changelog";

describe("extractPrNumbers", () => {
  it("recovers squash and merge-commit PR numbers, deduped and sorted", () => {
    const subjects = [
      "feat(roster): pass metadata through (#21)",
      "Merge pull request #17 from lookatitude/feature/project-agent-wiring",
      "fix: tighten guard (#21)", // dup
      "chore: no pr number here",
    ];
    expect(extractPrNumbers(subjects)).toEqual([17, 21]);
  });
});

describe("collectConfirmedPrs (v2.3.0 regression — issue #72)", () => {
  // Real commit subjects from this repo's v2.2.0..v2.3.0 range: individual
  // (non-landing) commits reference ISSUE numbers with the same "(#NN)"
  // suffix shape GitHub uses for squash-merge PR numbers, e.g. "(#59)" below
  // is issue #59, not a PR. extractPrNumbers has no way to tell them apart —
  // that's expected; the fix is at confirmation time.
  const subjects = [
    "feat(hooks): active lifecycle gate + review/verify-done close backstop (#59)",
    "feat(hooks): codify lean-lead inline-shortcut expiry + hands-on-edit guard (#57)",
    "feat(hooks): runtime backend-degradation detector for team-mode lanes (#56)",
    "feat(dispatch): make specialist type-erasure detectable (#58)",
    "test(guards): re-ratify pin for the dispatch note (#60)",
    "docs: revisit legacy shim behavior (#54)",
    "Merge pull request #70 from lookatitude/lane/oir-wi-59-lifecycle-gate",
    "Merge pull request #69 from lookatitude/lane/oir-wi-60-tier-guard",
    "Merge pull request #68 from lookatitude/lane/oir-wi-57-lean-lead",
    "Merge pull request #67 from lookatitude/lane/oir-wi-56-backend-guard",
    "Merge pull request #66 from lookatitude/lane/oir-wi-58-type-attribution",
  ];

  it("extracts both the real PR numbers and the bogus issue-ref numbers (the raw candidate set is expected to be noisy)", () => {
    expect(extractPrNumbers(subjects)).toEqual([54, 56, 57, 58, 59, 60, 66, 67, 68, 69, 70]);
  });

  const rangeShas = new Set(["sha-66", "sha-67", "sha-68", "sha-69", "sha-70"]);
  const merged = (n: number, sha: string) => ({
    kind: "resolved" as const,
    data: { number: n, title: `pr ${n}`, author: "lookatitude", state: "MERGED", mergeCommitOid: sha },
  });

  it("keeps only PRs gh confirms MERGED with a merge commit reachable in <since>..<end> — issue refs (56-59), an OPEN PR (60), and a real-but-stale out-of-window merged PR (54) are all dropped, no duplicate/bare row", () => {
    const candidates = extractPrNumbers(subjects);
    const outcomes = new Map<number, import("../release-changelog").GhLookupOutcome>([
      // 54 is a REAL, already-merged PR — but merged long before this release
      // window. Its number just happens to be referenced in an in-window
      // commit subject. Must be dropped despite being a genuine MERGED PR.
      [54, merged(54, "sha-54-outside-window")],
      // 56-59: gh has nothing under these numbers as PRs — they're issues.
      [56, { kind: "not_found" }],
      [57, { kind: "not_found" }],
      [58, { kind: "not_found" }],
      [59, { kind: "not_found" }],
      // 60: gh resolves it, but it's still open — not merged at all.
      [60, { kind: "resolved", data: { number: 60, title: "some unrelated open PR", author: "someone", state: "OPEN", mergeCommitOid: null } }],
      [66, merged(66, "sha-66")],
      [67, merged(67, "sha-67")],
      [68, merged(68, "sha-68")],
      [69, merged(69, "sha-69")],
      [70, merged(70, "sha-70")],
    ]);

    const result = collectConfirmedPrs(candidates, outcomes, rangeShas);
    expect(result.prs.map((p) => p.number)).toEqual([66, 67, 68, 69, 70]);
    expect(result.notFound.slice().sort((a, b) => a - b)).toEqual([56, 57, 58, 59]);
    expect(result.notConfirmedMerged.slice().sort((a, b) => a - b)).toEqual([54, 60]);
  });

  it("throws instead of silently dropping when gh lookup fails operationally (auth/network/rate-limit) — must abort, never ship an incomplete changelog", () => {
    const outcomes = new Map<number, import("../release-changelog").GhLookupOutcome>([
      [66, { kind: "error", message: "HTTP 401: Bad credentials" }],
    ]);
    expect(() => collectConfirmedPrs([66], outcomes, rangeShas)).toThrow(/gh lookup failed for #66.*Bad credentials/);
  });

  it("throws (never silently drops) when a candidate has no recorded outcome at all — an internal-contract violation, not a confirmed absence", () => {
    expect(() => collectConfirmedPrs([99], new Map(), rangeShas)).toThrow(/no gh lookup outcome recorded for #99/);
  });
});

describe("isGhNotFoundMessage", () => {
  it("matches gh's exact canonical message for the given number", () => {
    expect(
      isGhNotFoundMessage("GraphQL: Could not resolve to a PullRequest with the number of 66. (repository.pullRequest)", 66)
    ).toBe(true);
  });

  it("rejects the canonical message when it names a DIFFERENT number", () => {
    expect(
      isGhNotFoundMessage("GraphQL: Could not resolve to a PullRequest with the number of 67. (repository.pullRequest)", 66)
    ).toBe(false);
  });

  it("rejects when the canonical phrase is only a substring of a larger operational error — must abort, not silently drop", () => {
    expect(
      isGhNotFoundMessage(
        "HTTP 502: upstream said GraphQL: Could not resolve to a PullRequest with the number of 66. (repository.pullRequest) — retry later",
        66
      )
    ).toBe(false);
  });

  it("rejects an unrelated operational error", () => {
    expect(isGhNotFoundMessage("HTTP 401: Bad credentials", 66)).toBe(false);
  });
});

describe("parseGhPrJson", () => {
  const FULL_OID = "a".repeat(40); // gh's mergeCommit.oid is always a full 40 (or 64) hex char id, never abbreviated

  it("parses a well-formed gh pr view response", () => {
    const raw = JSON.stringify({ number: 66, title: "t", author: { login: "a" }, state: "MERGED", mergeCommit: { oid: FULL_OID } });
    expect(parseGhPrJson(raw, 66)).toEqual({ number: 66, title: "t", author: "a", state: "MERGED", mergeCommitOid: FULL_OID });
  });

  it("normalizes an uppercase-hex OID to lowercase so it matches git's lowercase rev-list output", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED", mergeCommit: { oid: FULL_OID.toUpperCase() } });
    expect(parseGhPrJson(raw, 66).mergeCommitOid).toBe(FULL_OID);
  });

  it("throws on an abbreviated (non-full-length) OID — gh never returns one, so a short value is malformed, not merely non-matching", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED", mergeCommit: { oid: "abc1234" } });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/malformed mergeCommit for #66/);
  });

  it("defaults author to empty string and mergeCommitOid to null when absent", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "OPEN" });
    expect(parseGhPrJson(raw, 66)).toEqual({ number: 66, title: "t", author: "", state: "OPEN", mergeCommitOid: null });
  });

  it("throws when the returned number doesn't match the requested candidate", () => {
    const raw = JSON.stringify({ number: 67, title: "t", state: "MERGED" });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/unexpected shape for #66/);
  });

  it("throws on schema-valid JSON that's missing required fields (e.g. {}) — never fail-open to an omitted-but-unconfirmed row", () => {
    expect(() => parseGhPrJson("{}", 66)).toThrow(/unexpected shape for #66/);
  });

  it("throws on a MERGED PR with a malformed mergeCommit.oid (non-string) — must abort, not silently coerce to null and drop it as notConfirmedMerged", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED", mergeCommit: { oid: 7 } });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/malformed mergeCommit for #66/);
  });

  it("throws on a MERGED PR with no mergeCommit at all — a data-integrity problem, not a confirmed non-merge", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED" });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/MERGED but returned no mergeCommit oid/);
  });

  it("allows a null/absent mergeCommit for a genuinely unmerged state", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "OPEN", mergeCommit: null });
    expect(parseGhPrJson(raw, 66)).toEqual({ number: 66, title: "t", author: "", state: "OPEN", mergeCommitOid: null });
  });

  it("throws on a state string that isn't one of gh's real PR states (e.g. a typo'd 'MERGE')", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGE" });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/unexpected shape for #66/);
  });

  it("throws on a MERGED PR whose mergeCommit.oid is whitespace-only — must not pass a blank OID as confirmed", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED", mergeCommit: { oid: "   " } });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/malformed mergeCommit for #66/);
  });

  it("throws on a MERGED PR whose mergeCommit.oid isn't a valid git object id shape (non-hex characters)", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "MERGED", mergeCommit: { oid: "not-a-real-sha!" } });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/malformed mergeCommit for #66/);
  });

  it("throws on a blank/whitespace-only title — never renders an empty changelog bullet", () => {
    const raw = JSON.stringify({ number: 66, title: "   ", state: "OPEN" });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/unexpected shape for #66/);
  });

  it("throws on a present-but-malformed author (non-string or blank login) — keeps null/absent author valid for deleted users", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "OPEN", author: { login: "" } });
    expect(() => parseGhPrJson(raw, 66)).toThrow(/malformed author for #66/);
  });

  it("accepts a null author (a deleted gh user) as anonymous, not malformed", () => {
    const raw = JSON.stringify({ number: 66, title: "t", state: "OPEN", author: null });
    expect(parseGhPrJson(raw, 66)).toEqual({ number: 66, title: "t", author: "", state: "OPEN", mergeCommitOid: null });
  });
});

describe("release-changelog CLI (end-to-end, real git + fake gh) — issue #72", () => {
  const EXPECTED_JSON_FIELDS = "number,title,author,state,mergeCommit";

  // Validates the exact --repo/--json contract main() must send, so a
  // regression in that contract fails these tests loudly instead of passing
  // through a permissive stub.
  function writeFakeGh(binDir: string, data: Record<string, { error?: string; json?: unknown }>): void {
    const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] !== "pr" || args[1] !== "view") {
  process.stderr.write("fake gh: unexpected subcommand " + args.join(" ") + "\\n");
  process.exit(1);
}
const n = args[2];
const repo = args[args.indexOf("--repo") + 1];
const jsonFields = args[args.indexOf("--json") + 1];
if (repo !== "test/repo") {
  process.stderr.write("fake gh: unexpected --repo " + repo + "\\n");
  process.exit(1);
}
if (jsonFields !== ${JSON.stringify(EXPECTED_JSON_FIELDS)}) {
  process.stderr.write("fake gh: unexpected --json fields " + jsonFields + "\\n");
  process.exit(1);
}
const DATA = ${JSON.stringify(data)};
const entry = DATA[n];
if (!entry) {
  process.stderr.write("fake gh: unexpected pr number " + n + "\\n");
  process.exit(1);
}
if (entry.error) {
  process.stderr.write(entry.error + "\\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(entry.json));
`;
    const ghPath = path.join(binDir, "gh");
    fs.writeFileSync(ghPath, script, { mode: 0o755 });
  }

  function initRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-cli-"));
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
    spawnSync("git", ["config", "user.name", "Test"], { cwd: dir });
    return dir;
  }

  function commit(dir: string, subject: string): string {
    spawnSync("git", ["commit", "--allow-empty", "-q", "-m", subject], { cwd: dir });
    return spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  }

  function currentBranch(dir: string): string {
    return spawnSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  }

  function runCli(dir: string, binDir: string, extraArgs: string[] = []) {
    const scriptPath = path.resolve(__dirname, "../release-changelog.ts");
    return spawnSync(
      "npx",
      ["tsx", scriptPath, "--version", "v9.9.9", "--since", "since-tag", "--end", "HEAD", "--repo", "test/repo", "--cwd", dir, ...extraArgs],
      { encoding: "utf8", env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` } }
    );
  }

  it("renders only gh-confirmed merged-in-window PRs — excludes issue refs, an open PR, and a stale out-of-window merged PR; covers both a squash-style landing commit and a real two-parent merge commit", () => {
    const dir = initRepo();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-bin-"));

    // Real PR #54's actual landing commit — BEFORE the window entirely.
    const staleSha54 = commit(dir, "feat(compat): legacy shim");
    const baseBranch = currentBranch(dir);
    spawnSync("git", ["tag", "since-tag"], { cwd: dir });

    // In-window noise: issue refs and an in-window mention of the stale #54.
    commit(dir, "docs: revisit legacy shim behavior (#54)");
    commit(dir, "feat(hooks): active lifecycle gate (#59)");
    commit(dir, "feat(dispatch): type-erasure detectable (#58)");
    commit(dir, "test(guards): re-ratify pin for the dispatch note (#60)");

    // Real PR #66: a squash-style landing — one commit, no second parent,
    // subject ending in GitHub's "(#N)" suffix.
    const sha66 = commit(dir, "feat(lane-a): thing one (#66)");

    // Real PR #67: an ACTUAL two-parent merge commit (not just merge-looking text).
    spawnSync("git", ["checkout", "-q", "-b", "lane-b"], { cwd: dir });
    commit(dir, "wip: lane-b implementation");
    spawnSync("git", ["checkout", "-q", baseBranch], { cwd: dir });
    spawnSync("git", ["merge", "--no-ff", "-q", "-m", "Merge pull request #67 from lookatitude/lane-b", "lane-b"], { cwd: dir });
    const sha67 = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();

    commit(dir, "chore(release): bump version to 9.9.9");

    writeFakeGh(binDir, {
      "54": { json: { number: 54, title: "compat: legacy shim", author: { login: "lookatitude" }, state: "MERGED", mergeCommit: { oid: staleSha54 } } },
      "58": { error: "GraphQL: Could not resolve to a PullRequest with the number of 58. (repository.pullRequest)" },
      "59": { error: "GraphQL: Could not resolve to a PullRequest with the number of 59. (repository.pullRequest)" },
      "60": { json: { number: 60, title: "some unrelated open PR", author: { login: "someone" }, state: "OPEN", mergeCommit: null } },
      // Real-shaped title (this repo's actual PR #66): the PR's own title
      // embeds an issue reference with the SAME "(#NN)" shape as a squash
      // suffix. It must render as literal plain text in the changelog row —
      // never become its own /pull/58 link or row.
      "66": { json: { number: 66, title: "feat(dispatch): make specialist type-erasure detectable (#58)", author: { login: "lookatitude" }, state: "MERGED", mergeCommit: { oid: sha66 } } },
      "67": { json: { number: 67, title: "fix(lane-b): thing two", author: { login: "lookatitude" }, state: "MERGED", mergeCommit: { oid: sha67 } } },
    });

    const result = runCli(dir, binDir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("https://github.com/test/repo/pull/66");
    expect(result.stdout).toContain("https://github.com/test/repo/pull/67");
    expect(result.stdout).not.toContain("/pull/54");
    expect(result.stdout).not.toContain("/pull/58");
    expect(result.stdout).not.toContain("/pull/59");
    expect(result.stdout).not.toContain("/pull/60");
    // The issue ref embedded in PR #66's own title survives as plain text.
    expect(result.stdout).toContain("dispatch: make specialist type-erasure detectable (#58)");
  }, 30000);

  it("aborts (nonzero exit, no changelog printed) when a gh lookup fails operationally instead of silently listing the candidate bare", () => {
    const dir = initRepo();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-bin-"));

    spawnSync("git", ["commit", "--allow-empty", "-q", "-m", "chore: init"], { cwd: dir });
    spawnSync("git", ["tag", "since-tag"], { cwd: dir });
    commit(dir, "Merge pull request #66 from lookatitude/lane-a");

    writeFakeGh(binDir, {
      "66": { error: "HTTP 401: Bad credentials (https://api.github.com/graphql)" },
    });

    const result = runCli(dir, binDir);
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toMatch(/aborting/);
  }, 30000);

  it("does not misclassify an operational error that merely CONTAINS the canonical not-found phrase as a substring — must abort, not silently drop", () => {
    const dir = initRepo();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-bin-"));

    spawnSync("git", ["commit", "--allow-empty", "-q", "-m", "chore: init"], { cwd: dir });
    spawnSync("git", ["tag", "since-tag"], { cwd: dir });
    commit(dir, "Merge pull request #66 from lookatitude/lane-a");

    writeFakeGh(binDir, {
      "66": {
        error:
          "HTTP 502: upstream said GraphQL: Could not resolve to a PullRequest with the number of 66. (repository.pullRequest) — retry later",
      },
    });

    const result = runCli(dir, binDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/aborting/);
  }, 30000);

  it("with --write, aborts BEFORE touching CHANGELOG.md when a gh lookup fails operationally — proves no partial write", () => {
    const dir = initRepo();
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-changelog-bin-"));

    spawnSync("git", ["commit", "--allow-empty", "-q", "-m", "chore: init"], { cwd: dir });
    spawnSync("git", ["tag", "since-tag"], { cwd: dir });
    commit(dir, "Merge pull request #66 from lookatitude/lane-a");

    const changelogPath = path.join(dir, "CHANGELOG.md");
    const seeded = "# Changelog\n\n## [9.8.0] — 2026-01-01\n\n- prior entry\n";
    fs.writeFileSync(changelogPath, seeded, "utf8");

    writeFakeGh(binDir, {
      "66": { error: "HTTP 401: Bad credentials (https://api.github.com/graphql)" },
    });

    const result = runCli(dir, binDir, ["--write"]);
    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toMatch(/aborting/);
    expect(fs.readFileSync(changelogPath, "utf8")).toBe(seeded);
  }, 30000);
});

describe("classifyTitle", () => {
  it("groups by conventional prefix and folds the scope into the text", () => {
    expect(classifyTitle("feat(roster): pass metadata")).toEqual({
      heading: "Added",
      text: "roster: pass metadata",
    });
    expect(classifyTitle("fix: tighten guard").heading).toBe("Fixed");
    expect(classifyTitle("docs(v2): reconcile").heading).toBe("Documentation");
    expect(classifyTitle("chore: bump deps").heading).toBe("Internal");
    expect(classifyTitle("Wire project-local agents end to end").heading).toBe("Changed");
    expect(classifyTitle("feat!: breaking").heading).toBe("Added");
  });
});

describe("renderSection", () => {
  const input = {
    version: "v2.1.0",
    date: "2026-07-12",
    compareUrl: "https://github.com/lookatitude/guild/compare/v2.0.1...v2.1.0",
    prs: [
      { number: 17, title: "feat(specialists): wire project-local agents", author: "lookatitude" },
      { number: 18, title: "fix(roster): shared frontmatter reader", author: "" },
      { number: 19, title: "Establish next/main channels", author: "lookatitude" },
    ],
  };

  it("renders grouped sections with PR links, authors, and the compare link", () => {
    const out = renderSection(input);
    expect(out).toContain("## [2.1.0] — 2026-07-12"); // Keep-a-Changelog heading shape
    expect(out.indexOf("### Added")).toBeLessThan(out.indexOf("### Fixed"));
    expect(out.indexOf("### Fixed")).toBeLessThan(out.indexOf("### Changed"));
    expect(out).toContain(
      "- specialists: wire project-local agents ([#17](https://github.com/lookatitude/guild/pull/17)) — @lookatitude"
    );
    expect(out).toContain("[#18](https://github.com/lookatitude/guild/pull/18))");
    expect(out).not.toContain("#18)) — @"); // no dangling author
    expect(out).toContain("**Full Changelog**: https://github.com/lookatitude/guild/compare/v2.0.1...v2.1.0");
  });

  it("--notes flavor omits the H2 header; empty range says so explicitly", () => {
    expect(renderSection(input, { header: false })).not.toContain("## v2.1.0");
    const empty = renderSection({ ...input, prs: [] });
    expect(empty).toContain("_No merged PRs found in range — write this section by hand._");
  });
});

describe("prependToChangelog", () => {
  const section = "## v2.1.0 — 2026-07-12\n\n### Added\n\n- thing ([#1](x/pull/1))\n";

  it("inserts under the title, above the previous release", () => {
    const existing = "# Changelog\n\nintro line\n\n## v2.0.1 — 2026-07-08\n\n- old\n";
    const out = prependToChangelog(existing, section, "v2.1.0");
    expect(out.indexOf("## v2.1.0")).toBeGreaterThan(out.indexOf("# Changelog"));
    expect(out.indexOf("## v2.1.0")).toBeLessThan(out.indexOf("## v2.0.1"));
    expect(out).toContain("intro line");
  });

  it("is idempotent when the version section already exists", () => {
    const existing = `# Changelog\n\n${section}\n## v2.0.1 — old\n`;
    expect(prependToChangelog(existing, section, "v2.1.0")).toBe(existing);
  });

  it("handles a changelog with no prior releases", () => {
    const out = prependToChangelog("# Changelog\n\n", section, "v2.1.0");
    expect(out).toContain("## v2.1.0");
  });

  it("inserts BELOW an [Unreleased] block, above the newest version (Keep a Changelog)", () => {
    const existing =
      "# Changelog\n\nKeep a Changelog format.\n\n## [Unreleased]\n\n- pending thing\n\n## [2.0.1] — 2026-07-08\n\n- old\n";
    const out = prependToChangelog(existing, section, "v2.1.0");
    expect(out.indexOf("## [Unreleased]")).toBeLessThan(out.indexOf("## v2.1.0"));
    expect(out.indexOf("## v2.1.0")).toBeLessThan(out.indexOf("## [2.0.1]"));
    expect(out).toContain("- pending thing");
  });

  it("is idempotent against bracketed existing headings too", () => {
    const existing = "# Changelog\n\n## [Unreleased]\n\n## [v2.1.0] — 2026-07-12\n\n- already here\n";
    expect(prependToChangelog(existing, section, "v2.1.0")).toBe(existing);
  });
});

describe("fallbackTitle", () => {
  const subjects = [
    "feat: big change (#10)",
    "Merge pull request #100 from lookatitude/feature/x",
    "fix: tiny change (#1)",
  ];

  it("matches the exact PR number, never a superstring (#1 vs #10/#100)", () => {
    expect(fallbackTitle(subjects, 1)).toBe("fix: tiny change");
    expect(fallbackTitle(subjects, 10)).toBe("feat: big change");
    expect(fallbackTitle(subjects, 100)).toBe("Merge pull request #100 from lookatitude/feature/x");
  });

  it("falls back to a bare label when no subject matches", () => {
    expect(fallbackTitle(subjects, 7)).toBe("PR #7");
  });
});
