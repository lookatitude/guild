/**
 * scripts/dot-guild/__tests__/exemption-parity.test.ts
 *
 * plugin-audit-remediation hygiene pass, item 8.
 *
 * FIXTURE_EXEMPT_PATTERNS (scripts/dot-guild/audit.ts) declares which nested
 * .guild/ fixture trees are exempt from the FU-F "one .guild per repo root"
 * leak scan (findNestedGuildLeaks). The matching .gitignore re-includes
 * (plugin/.gitignore) are supposed to declare the SAME trees committable (not
 * ignored). If the two allow-lists drift out of sync in either direction:
 *
 *   (a) a path is git-ignored (not committable) but IS exempted in audit.ts
 *       — the exemption is dead: no real fixture can ever ship there, so the
 *       "exemption" is a no-op that masks the fact the fixture can't exist; OR
 *   (b) a path is committable in .gitignore but NOT exempted in audit.ts
 *       — a real fixture there would false-positive as a "nested-guild" leak.
 *
 * ...then the allow-lists have drifted. This test asserts BOTH directions for
 * one representative path per FIXTURE_EXEMPT_PATTERNS entry: audit-exempt
 * (the regex matches) AND committable (`git check-ignore` says NOT ignored).
 *
 * This test caught a REAL pre-existing drift while being written: the
 * `tests/wiki-lint/fixtures/.../.guild` entry was exempted in
 * FIXTURE_EXEMPT_PATTERNS but had no matching .gitignore re-include (fixed in
 * the same pass — see the .gitignore comment at that block).
 *
 * `git check-ignore` is unreliable for directory-anchored negation patterns
 * (lines ending in `/`) against a path that has never existed on disk — a
 * nonexistent intermediate directory segment can't be confirmed as a
 * directory, so the trailing-slash negation silently fails to apply and
 * check-ignore misreports the path as ignored. To avoid that quirk, every
 * representative path here is backed by a REAL file: either an existing
 * fixture already on disk, or a small scratch file this test creates and
 * removes (never touching any file this repo actually ships).
 */

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { FIXTURE_EXEMPT_PATTERNS } from "../audit";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function isGitIgnored(relPath: string): boolean {
  const res = spawnSync("git", ["-C", REPO_ROOT, "check-ignore", "-q", relPath]);
  return res.status === 0;
}

interface Representative {
  /** repo-relative path that should satisfy the paired FIXTURE_EXEMPT_PATTERNS entry. */
  rel: string;
  /** Set when no real fixture exists yet — this test creates + removes a scratch file. */
  scratch?: boolean;
}

// One representative per FIXTURE_EXEMPT_PATTERNS entry, in the SAME order as the
// array (index-paired — the "index parity" sanity test below guards against a
// silent reorder/miscount between this list and the source array).
const REPRESENTATIVES: Representative[] = [
  { rel: "benchmark/fixtures/exemption-parity-tmp/.guild/wiki/foo.md", scratch: true },
  { rel: "mcp-servers/guild-memory/fixtures/alt-repo/.guild/wiki/only-page.md" },
  { rel: "mcp-servers/guild-telemetry/fixtures/.guild/runs/run-alpha/events.ndjson" },
  { rel: "tests/dot-guild/fixtures/scrub/run-with-flag/.guild/runs/run-with-flag/events.ndjson" },
  { rel: "tests/wiki-lint/fixtures/exemption-parity-tmp/.guild/wiki/foo.md", scratch: true },
  {
    rel: "hooks/__tests__/fixtures/golden-full-learn-run/.guild/runs/run-golden-full-6phase-learn/run.yaml",
  },
];

describe("FIXTURE_EXEMPT_PATTERNS <-> .gitignore parity (exemption-parity)", () => {
  test("sanity: exactly one representative path per pattern (index parity)", () => {
    expect(REPRESENTATIVES).toHaveLength(FIXTURE_EXEMPT_PATTERNS.length);
  });

  describe.each(
    FIXTURE_EXEMPT_PATTERNS.map((pattern, i) => ({ pattern, i, ...REPRESENTATIVES[i] })),
  )("pattern[$i] <-> $rel", ({ pattern, rel, scratch }) => {
    const abs = path.join(REPO_ROOT, rel);
    // Computed in beforeAll, BEFORE anything is created: the first not-yet-existing
    // path segment walking up from `abs`. That's the ONLY thing this test is
    // allowed to delete in afterAll — everything at or above it pre-existed the
    // test and must be left alone (e.g. `benchmark/` doesn't exist in this repo at
    // all, so the whole `benchmark/` dir this test creates must be removed; but
    // `tests/wiki-lint/fixtures/` already exists for real, so only the
    // `exemption-parity-tmp` child it creates below that must be removed).
    let scratchRootToRemove: string | null = null;

    beforeAll(() => {
      if (scratch) {
        let dir = path.dirname(abs);
        let firstMissing = dir;
        while (!fs.existsSync(dir)) {
          firstMissing = dir;
          dir = path.dirname(dir);
        }
        scratchRootToRemove = firstMissing;
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "exemption-parity scratch file — safe to delete\n");
      }
    });

    afterAll(() => {
      if (scratch) {
        if (!scratchRootToRemove) throw new Error(`scratchRootToRemove unset for ${abs}`);
        fs.rmSync(scratchRootToRemove, { recursive: true, force: true });
      }
    });

    test("fixture sanity: the representative path exists on disk", () => {
      expect(fs.existsSync(abs)).toBe(true);
    });

    test("audit-exempt: FIXTURE_EXEMPT_PATTERNS matches the representative path", () => {
      // Matched the SAME way audit.ts matches it (findNestedGuildLeaks): resolved
      // to an absolute path, tested against the raw regex.
      expect(pattern.test(path.resolve(abs))).toBe(true);
    });

    test("committable: .gitignore does NOT ignore the representative path", () => {
      expect(isGitIgnored(rel)).toBe(false);
    });
  });

  // Anti-vacuity: prove the audit-exempt check CAN fail — a path that satisfies
  // none of the FIXTURE_EXEMPT_PATTERNS entries must not be reported as exempt.
  test("ANTI-VACUITY: an unrelated nested .guild/ path matches no pattern", () => {
    const bogus = path.resolve(REPO_ROOT, "some-other-dir/nested/.guild");
    expect(FIXTURE_EXEMPT_PATTERNS.some((p) => p.test(bogus))).toBe(false);
  });
});
