/**
 * scripts/__tests__/release-changelog.test.ts
 *
 * Pure-helper coverage for the release-changelog generator: PR-number
 * extraction (squash + merge-commit shapes), conventional-title grouping,
 * section rendering, and idempotent CHANGELOG prepending.
 */

import {
  classifyTitle,
  extractPrNumbers,
  fallbackTitle,
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
