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
  checkStablePromotion,
  compareTriple,
  compareVersions,
  FROZEN_SCENARIO_CONTRACT_SHA256,
  FROZEN_SCENARIO_IDS,
  parseTriple,
  parseVersion,
  versionAtRef,
  MANIFEST_PATH,
} from "../check-channel-integrity";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

  describe("stable-promotion evidence gate", () => {
    function fixture(
      decision: "conformance_pass" | "accepted_override" = "conformance_pass",
      options: {
        requiredIds?: readonly string[];
        identitySource?: string;
        recordSource?: string;
        legacySummary?: boolean;
      } = {},
    ) {
      const root = mkdtempSync(join(tmpdir(), "guild-promotion-"));
      execFileSync("git", ["init", "-q"], { cwd: root });
      execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: root });
      execFileSync("git", ["config", "user.name", "Guild Test"], { cwd: root });
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "guild", version: "2.7.0" }));
      writeFileSync(join(root, "runtime.ts"), "export const runtime = true;\n");
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["commit", "-qm", "runtime candidate"], { cwd: root });
      const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const dir = join(root, ".guild/artifacts/release/v2.7.0");
      mkdirSync(dir, { recursive: true });
      const identitySource = options.identitySource ?? source;
      const evidence = {
        suite_id: "guild.conformance_scenarios.v1",
        suite_version: "1.0.0",
        required_scenario_ids: [...(options.requiredIds ?? FROZEN_SCENARIO_IDS)],
        activated_runtime: { source_commit: identitySource },
        results: [],
        claimant_id: "release-candidate",
      };
      const payload = options.legacySummary
        ? { suite_id: "neutral-31", verdict: "pass", implemented: 31, total: 31 }
        : {
            schema: "guild.release_conformance.v1",
            scenario_contract_sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
            evidence,
            authority: { identity: { source_commit: identitySource } },
          };
      const evidenceBytes = Buffer.from(JSON.stringify(payload));
      writeFileSync(join(dir, "conformance.json"), evidenceBytes);
      writeFileSync(join(dir, "promotion.json"), JSON.stringify({
        schema: "guild.release_promotion.v1",
        version: "2.7.0",
        source_commit: options.recordSource ?? source,
        evidence_path: ".guild/artifacts/release/v2.7.0/conformance.json",
        evidence_sha256: createHash("sha256").update(evidenceBytes).digest("hex"),
        scenario_contract_sha256: FROZEN_SCENARIO_CONTRACT_SHA256,
        decision,
        ...(decision === "accepted_override" ? { override_reason: "risk accepted for staged rollout", known_gap: "26 of 31 scenarios remain" } : {}),
      }));
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["commit", "-qm", "bind release evidence"], { cwd: root });
      const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      return { root, source, head, dir };
    }

    const evaluatorApproves = () => ({
      disposition: "succeeded",
      facts: { may_promote_conformant: true },
    });

    it("accepts structurally bound evidence only when the frozen evaluator approves it", () => {
      const f = fixture();
      try {
        expect(
          checkStablePromotion(
            { root: f.root, releaseBranch: "release/v2.7.0", head: f.head },
            evaluatorApproves,
          ).ok,
        ).toBe(true);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("rejects the former self-authored 31/31 summary shape", () => {
      const f = fixture("conformance_pass", { legacySummary: true });
      try {
        expect(() =>
          checkStablePromotion(
            { root: f.root, releaseBranch: "release/v2.7.0", head: f.head },
            evaluatorApproves,
          ),
        ).toThrow(/payload schema mismatch/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("rejects any narrowed frozen scenario tuple before evaluator dispatch", () => {
      const f = fixture("conformance_pass", { requiredIds: FROZEN_SCENARIO_IDS.slice(0, 5) });
      try {
        expect(() =>
          checkStablePromotion(
            { root: f.root, releaseBranch: "release/v2.7.0", head: f.head },
            evaluatorApproves,
          ),
        ).toThrow(/all 31 frozen scenario IDs/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("rejects a nominally complete payload when the real frozen evaluator refuses it", () => {
      const f = fixture();
      try {
        expect(() => checkStablePromotion({ root: f.root, releaseBranch: "release/v2.7.0", head: f.head })).toThrow(
          /frozen conformance evaluator did not approve/,
        );
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("binds source_commit to both evidence and authority identities", () => {
      const f = fixture("conformance_pass", { identitySource: "0".repeat(40) });
      try {
        expect(() =>
          checkStablePromotion(
            { root: f.root, releaseBranch: "release/v2.7.0", head: f.head },
            evaluatorApproves,
          ),
        ).toThrow(/does not match evidence and authority/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("requires source_commit to be an exact lowercase commit SHA", () => {
      const f = fixture("conformance_pass", { identitySource: "HEAD", recordSource: "HEAD" });
      try {
        expect(() =>
          checkStablePromotion(
            { root: f.root, releaseBranch: "release/v2.7.0", head: f.head },
            evaluatorApproves,
          ),
        ).toThrow(/exact lowercase commit SHA/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("fails closed when evidence bytes are tampered", () => {
      const f = fixture();
      try {
        writeFileSync(join(f.dir, "conformance.json"), readFileSync(join(f.dir, "conformance.json"), "utf8") + "\n");
        expect(() => checkStablePromotion({ root: f.root, releaseBranch: "release/v2.7.0", head: f.head })).toThrow(/SHA-256 mismatch/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("requires the exact acceptance label for an explicit override", () => {
      const f = fixture("accepted_override");
      try {
        expect(() => checkStablePromotion({ root: f.root, releaseBranch: "release/v2.7.0", head: f.head })).toThrow(/exact acceptance label/);
        expect(checkStablePromotion({ root: f.root, releaseBranch: "release/v2.7.0", head: f.head, labels: ["release-conformance-override-accepted"] }).ok).toBe(true);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("invalidates evidence when runtime changes after the source commit", () => {
      const f = fixture();
      try {
        writeFileSync(join(f.root, "runtime.ts"), "export const runtime = false;\n");
        execFileSync("git", ["add", "runtime.ts"], { cwd: f.root });
        execFileSync("git", ["commit", "-qm", "runtime changed after evidence"], { cwd: f.root });
        const changedHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
        expect(() => checkStablePromotion(
          { root: f.root, releaseBranch: "release/v2.7.0", head: changedHead },
          evaluatorApproves,
        )).toThrow(/runtime change/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("rejects a prospective merge when stable changed runtime after evidence", () => {
      const f = fixture();
      try {
        execFileSync("git", ["branch", "release-candidate", f.head], { cwd: f.root });
        execFileSync("git", ["checkout", "-qb", "stable-race", f.source], { cwd: f.root });
        writeFileSync(join(f.root, "runtime.ts"), "export const runtime = 'changed-on-stable';\n");
        execFileSync("git", ["add", "runtime.ts"], { cwd: f.root });
        execFileSync("git", ["commit", "-qm", "concurrent stable runtime change"], { cwd: f.root });
        execFileSync("git", ["merge", "--no-ff", "-qm", "prospective release merge", "release-candidate"], { cwd: f.root });
        const mergeHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: f.root, encoding: "utf8" }).trim();
        expect(() => checkStablePromotion(
          { root: f.root, releaseBranch: "release/v2.7.0", head: mergeHead },
          evaluatorApproves,
        )).toThrow(/runtime change/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });

    it("rejects a branch/manifest version mismatch", () => {
      const f = fixture();
      try {
        expect(() => checkStablePromotion({ root: f.root, releaseBranch: "release/v2.8.0", head: f.head })).toThrow(/disagrees with manifest/);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    });
  });

  describe("workflow wiring", () => {
    const workflow = (name: string) =>
      readFileSync(join(__dirname, "../..", ".github", "workflows", name), "utf8");

    it("re-evaluates accepted overrides whenever the exact label changes", () => {
      const branchPolicy = workflow("branch-policy.yml");
      expect(branchPolicy).toMatch(/types:\s*\[[^\]]*labeled[^\]]*unlabeled[^\]]*\]/);
      expect(branchPolicy).toContain("toJson(github.event.pull_request.labels.*.name)");
      expect(branchPolicy).toContain("ref: ${{ github.sha }}");
      expect(branchPolicy).toContain("CANDIDATE_HEAD: ${{ github.sha }}");
      expect(branchPolicy).not.toContain("CANDIDATE_HEAD: ${{ github.event.pull_request.head.sha }}");
    });

    it("checks the prospective next merge commit rather than only the PR head", () => {
      const channelIntegrity = workflow("channel-integrity.yml");
      expect(channelIntegrity).toContain("github.event_name == 'pull_request' && github.sha");
      expect(channelIntegrity).not.toContain("github.event.pull_request.head.sha || 'origin/next'");
      expect(channelIntegrity).toMatch(/prospective merge commit/);
    });

    it("runs the promotion gate before release publication", () => {
      const release = workflow("release.yml");
      expect(release.indexOf("Re-verify hash-bound promotion evidence before publication")).toBeGreaterThan(-1);
      expect(release.indexOf("Re-verify hash-bound promotion evidence before publication")).toBeLessThan(
        release.indexOf("Create + push annotated tag at the merge commit"),
      );
    });
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
