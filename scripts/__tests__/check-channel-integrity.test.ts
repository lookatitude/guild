/**
 * scripts/__tests__/check-channel-integrity.test.ts
 *
 * CHANNEL-INTEGRITY GATE — non-vacuity + correctness rail.
 * (initiative cross-host-release-distribution, work item xhrd-wi-06 / G6.)
 *
 * Guards `scripts/check-channel-integrity.ts`, which mechanizes
 * release-discipline rule 8's sync-back clause: after a release merges to `main`, `next` must be
 * advanced to the release point, or the BETA channel serves older code than
 * STABLE.
 *
 * The regression this rail pins is real, not hypothetical: v2.3.2 merged to
 * main on 2026-07-25 and the sync-back never landed, leaving next at 2.3.1
 * with every other CI gate green. Case (1) below reproduces exactly that state.
 *
 * The reader is injected, so these run against fixed version pairs rather than
 * live git — the rail must keep asserting the same thing after the real
 * channels are fixed, which a live-repo test could not do.
 */

import {
  checkChannelIntegrity,
  compareTriple,
  compareVersions,
  parseTriple,
  parseVersion,
  versionAtRef,
  MANIFEST_PATH,
} from "../check-channel-integrity";

/** Fake `git show <ref>:.claude-plugin/plugin.json` over a ref→version map. */
function readerFor(versions: Record<string, string>): (ref: string) => string {
  return (ref: string) => {
    const v = versions[ref];
    if (v === undefined) throw new Error(`fatal: path '${MANIFEST_PATH}' does not exist in '${ref}'`);
    return JSON.stringify({ name: "guild", version: v });
  };
}

describe("check-channel-integrity", () => {
  describe("the regression it exists to catch", () => {
    it("(1) FAILS when beta trails stable — the real v2.3.2 state", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.3.2", "origin/next": "2.3.1" })
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/OLDER code than stable/);
      expect(r.stable.version).toBe("2.3.2");
      expect(r.beta.version).toBe("2.3.1");
    });

    it("(2) PASSES once the sync-back lands (both at 2.3.2)", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.3.2", "origin/next": "2.3.2" }),
        () => "same-commit"
      );
      expect(r.ok).toBe(true);
      expect(r.reason).toMatch(/in sync/);
    });

    it("(3) PASSES when a newer beta identifies the divergent integration state", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.3.2", "origin/next": "2.4.0-beta.1" })
      );
      expect(r.ok).toBe(true);
      expect(r.reason).toMatch(/ahead of stable/);
    });

    it("PASSES the short-path release state when both refs carry the exact reviewed beta version on the same commit", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.7.0-beta.20", "origin/next": "2.7.0-beta.20" }),
        () => "release-commit"
      );
      expect(r.ok).toBe(true);
      expect(r.reason).toMatch(/reviewed release candidate/);
    });

    it("PASSES the real post-release state with distinct commits and the exact stable tree in next history", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.7.0-beta.20", "origin/next": "2.7.0-beta.20" }),
        (ref) => ({ "origin/main": "release-merge", "origin/next": "reviewed-next-head", "refs/tags/v2.7.0": "release-merge" })[ref] ?? ref,
        () => true
      );
      expect(r.ok).toBe(true);
      expect(r.reason).toMatch(/same release tree/);
    });

    it("PASSES the normal beta advance after a short-path release", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.7.0-beta.20", "origin/next": "2.8.0-beta.1" }),
        (ref) => ({ "origin/main": "release-commit", "origin/next": "beta-commit", "refs/tags/v2.7.0": "release-commit" })[ref] ?? ref,
        (ancestor, descendant) => ancestor === "release-commit" && descendant === "beta-commit"
      );
      expect(r.ok).toBe(true);
      expect(r.reason).toMatch(/ahead of published stable/);
    });

    it("FAILS when a shared candidate version hides a beta commit outside main ancestry", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.7.0-beta.20", "origin/next": "2.7.0-beta.20" }),
        (ref) => ({ "origin/main": "release-commit", "origin/next": "older-diverged-commit", "refs/tags/v2.7.0": "release-commit" })[ref] ?? ref,
        () => false
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/does not contain the exact stable release tree/);
    });

    it("FAILS closed when a candidate-valued main has no corresponding published stable tag", () => {
      const r = checkChannelIntegrity(
        "origin/main",
        "origin/next",
        readerFor({ "origin/main": "2.7.0-beta.20", "origin/next": "2.8.0-beta.1" }),
        (ref) => {
          if (ref === "refs/tags/v2.7.0") throw new Error("unknown ref");
          return ref;
        },
        () => true
      );
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/no published refs\/tags\/v2\.7\.0 tag/);
    });

    it("FAILS when different commits report the same bare version", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.6.0", b: "2.6.0" }));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/diverged channels/);
    });

    it("FAILS when divergent next uses a future bare version", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.6.0", b: "2.7.0" }));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/beta\.N/);
    });

    it("FAILS when divergent next uses a non-beta prerelease", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.6.0", b: "2.7.0-rc.1" }));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/beta\.N/);
    });

    it.each(["v2.7.0-beta.1", "2.7.0-beta.1+candidate.sha"])(
      "FAILS when divergent next is not the literal MAJOR.MINOR.PATCH-beta.N form (%s)",
      (version) => {
        const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.6.0", b: version }));
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/beta\.N/);
      },
    );

    it.each(["v2.6.0", "2.6.0+stable"])(
      "FAILS when stable is not the literal MAJOR.MINOR.PATCH form (%s)",
      (version) => {
        const r = checkChannelIntegrity("s", "b", readerFor({ s: version, b: "2.7.0-beta.1" }));
        expect(r.ok).toBe(false);
        expect(r.reason).toMatch(/exact MAJOR\.MINOR\.PATCH/);
      },
    );
  });

  describe("version comparison", () => {
    it("orders on the full triple, not lexically (2.10.0 > 2.9.0)", () => {
      // A string compare would call "2.10.0" < "2.9.0" and miss a real regression.
      expect(compareTriple(parseTriple("2.10.0"), parseTriple("2.9.0"))).toBeGreaterThan(0);
      const r = checkChannelIntegrity(
        "s",
        "b",
        readerFor({ s: "2.9.0", b: "2.10.0-beta.1" })
      );
      expect(r.ok).toBe(true);
    });

    it("catches a major-version regression", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "3.0.0", b: "2.99.99" }));
      expect(r.ok).toBe(false);
    });

    it("a beta prerelease on a HIGHER triple is ahead (2.4.0-beta.1 > 2.3.2)", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.3.2", b: "2.4.0-beta.1" }));
      expect(r.ok).toBe(true);
    });

    it("tolerates a leading v", () => {
      expect(parseTriple("v2.3.2")).toEqual([2, 3, 2]);
    });

    it("refuses to guess at an unparseable version", () => {
      expect(() => parseTriple("latest")).toThrow(/unparseable version/);
    });
  });

  // SemVer §11 prerelease precedence. A bare-triple comparison gets every case
  // in this block wrong, and the first one is a FALSE PASS on exactly the
  // scenario the gate exists to catch — beta shipping an rc of the version
  // stable already released.
  describe("prerelease precedence (the false-PASS class)", () => {
    it("FAILS when beta is a prerelease of the version stable already shipped (2.3.2-rc1 < 2.3.2)", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.3.2", b: "2.3.2-rc1" }));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/OLDER code than stable/);
    });

    it("FAILS when stable carries any prerelease identifier", () => {
      const r = checkChannelIntegrity("s", "b", readerFor({ s: "2.3.2-rc1", b: "2.3.2" }));
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/stable channel.*exact MAJOR\.MINOR\.PATCH/);
    });

    it("orders prerelease identifiers numerically (rc2 > rc1 is not a lexical compare)", () => {
      expect(compareVersions(parseVersion("2.3.2-rc.2"), parseVersion("2.3.2-rc.10"))).toBeLessThan(0);
      expect(compareVersions(parseVersion("2.3.2-rc2"), parseVersion("2.3.2-rc1"))).toBeGreaterThan(0);
    });

    it("ranks a numeric identifier below an alphanumeric one (SemVer §11.4.3)", () => {
      expect(compareVersions(parseVersion("2.3.2-1"), parseVersion("2.3.2-alpha"))).toBeLessThan(0);
    });

    it("ranks a shorter identifier list lower when the prefix is equal (§11.4.4)", () => {
      expect(compareVersions(parseVersion("2.3.2-rc"), parseVersion("2.3.2-rc.1"))).toBeLessThan(0);
    });

    it("treats equal prereleases as equal", () => {
      expect(compareVersions(parseVersion("2.3.2-rc1"), parseVersion("2.3.2-rc1"))).toBe(0);
    });
  });

  // SemVer §11.4.1 sets no precision ceiling. Number() collapses above 2^53,
  // which would make two distinct versions compare EQUAL and let the gate pass.
  describe("arbitrary-precision numeric ordering", () => {
    it("orders numeric prerelease identifiers beyond 2^53", () => {
      expect(
        compareVersions(parseVersion("1.0.0-x.9007199254740992"), parseVersion("1.0.0-x.9007199254740993"))
      ).toBeLessThan(0);
    });

    it("orders core versions beyond 2^53", () => {
      expect(
        compareVersions(parseVersion("9007199254740992.0.0"), parseVersion("9007199254740993.0.0"))
      ).toBeLessThan(0);
    });

    it("still orders ordinary versions correctly", () => {
      expect(compareVersions(parseVersion("2.10.0"), parseVersion("2.9.0"))).toBeGreaterThan(0);
    });
  });

  describe("parser strictness", () => {
    it("rejects an empty prerelease identifier (§9)", () => {
      expect(() => parseVersion("1.0.0-alpha..1")).toThrow(/unparseable version/);
    });

    it("rejects leading zeroes in a numeric prerelease identifier (§9)", () => {
      expect(() => parseVersion("1.0.0-01")).toThrow(/unparseable version/);
    });

    it("rejects leading zeroes in a core identifier (§2)", () => {
      expect(() => parseVersion("01.0.0")).toThrow(/unparseable version/);
    });

    it("still accepts a legitimate alphanumeric identifier with a leading zero", () => {
      // "0a" is alphanumeric, not numeric, so the leading-zero ban does not apply.
      expect(parseVersion("1.0.0-0a").prerelease).toEqual(["0a"]);
    });

    it("REJECTS a trailing-garbage version instead of prefix-matching it", () => {
      // An unanchored /^v?(\d+)\.(\d+)\.(\d+)/ would read this as 2.3.2.
      expect(() => parseVersion("2.3.2junk")).toThrow(/unparseable version/);
    });

    it("rejects a partial version", () => {
      expect(() => parseVersion("2.3")).toThrow(/unparseable version/);
    });

    it("accepts and ignores build metadata (SemVer §10 — no precedence)", () => {
      expect(compareVersions(parseVersion("2.3.2+abc123"), parseVersion("2.3.2"))).toBe(0);
    });
  });

  describe("manifest reading", () => {
    it("rejects a manifest with no version rather than defaulting", () => {
      const read = () => JSON.stringify({ name: "guild" });
      expect(() => versionAtRef("origin/main", read)).toThrow(/no usable "version"/);
    });

    it("rejects an empty version string", () => {
      const read = () => JSON.stringify({ name: "guild", version: "" });
      expect(() => versionAtRef("origin/main", read)).toThrow(/no usable "version"/);
    });

    it("propagates a missing ref instead of silently passing", () => {
      expect(() => checkChannelIntegrity("origin/main", "origin/nope", readerFor({ "origin/main": "2.3.2" }))).toThrow(
        /does not exist/
      );
    });
  });
});
