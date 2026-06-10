/**
 * __tests__/verify-gate-pass.test.ts
 *
 * G-6 / SC-2 — deterministic checksum-bound gate-pass verifier.
 *
 * Fixtures are REAL-SHAPE: the result envelope mirrors the `review_result.v1`
 * field set the broker consumes (skills/meta/review-broker/SKILL.md
 * §"review_result.v1") — schema_version, verdict, findings, blocking_findings,
 * round, reviewer_host, packet_id, artifact_sha256_reviewed — and the artifact
 * is a real-shape handoff receipt (the G-lane artifact class). The sha256 in
 * the fixture is computed over the actual artifact bytes, exactly as a real
 * reviewer adapter records it.
 *
 * Includes CLI end-to-end tests via `npx tsx` subprocess (mirrors
 * mark-lane-dead.test.ts) so the REAL path — arg parsing, file reads, exit
 * codes, stdout JSON — is exercised, not just the exported helpers.
 */

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  evaluateGatePass,
  parseReviewResult,
  parseVerifyGatePassArgs,
  sha256Hex,
} from "../verify-gate-pass";

const CLI = path.resolve(__dirname, "..", "verify-gate-pass.ts");

// ---------------------------------------------------------------------------
// Real-shape fixtures
// ---------------------------------------------------------------------------

/** Real-shape G-lane artifact: a guild.handoff.v2-style receipt. */
const ARTIFACT_CONTENT = `---
schema_version: guild.handoff.v2
agent: tooling-engineer
task: P1 — enforcement scripts
status: done
evidence:
  tests: "12/12 pass — npx jest from plugin/scripts"
---

## What changed

Added the deterministic gate-pass verifier and wired it into the broker skill.
`;

/** Real-shape review_result.v1 envelope (field set per review-broker SKILL.md). */
function makeResult(artifactSha: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "review_result.v1",
    verdict: "satisfied",
    findings: [],
    blocking_findings: [],
    round: 1,
    reviewer_host: "codex",
    packet_id: "packet-G-lane-P1-r1",
    artifact_sha256_reviewed: artifactSha,
    ...overrides,
  };
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-vgp-test-"));
}

function writeFixtures(
  dir: string,
  resultOverrides: Record<string, unknown> = {},
  artifactContent: string = ARTIFACT_CONTENT
): { artifactPath: string; resultPath: string; sha: string } {
  const artifactPath = path.join(dir, "tooling-engineer-P1.md");
  fs.writeFileSync(artifactPath, artifactContent);
  const sha = createHash("sha256")
    .update(fs.readFileSync(artifactPath))
    .digest("hex");
  const resultPath = path.join(dir, "result-1.json");
  fs.writeFileSync(
    resultPath,
    JSON.stringify(makeResult(sha, resultOverrides), null, 2)
  );
  return { artifactPath, resultPath, sha };
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  const res = spawnSync("npx", ["tsx", CLI, ...args], {
    encoding: "utf8",
    timeout: 60000,
  });
  return {
    status: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

// ---------------------------------------------------------------------------
// sha256Hex
// ---------------------------------------------------------------------------

describe("sha256Hex", () => {
  it("matches node:crypto over the same bytes", () => {
    const bytes = Buffer.from(ARTIFACT_CONTENT);
    expect(sha256Hex(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex")
    );
  });
});

// ---------------------------------------------------------------------------
// parseReviewResult — lenient review_result.v1 reader
// ---------------------------------------------------------------------------

describe("parseReviewResult", () => {
  it("accepts a full real-shape envelope", () => {
    const { result, reasons } = parseReviewResult(
      JSON.stringify(makeResult("a".repeat(64)))
    );
    expect(reasons).toEqual([]);
    expect(result).not.toBeNull();
    expect(result!.packet_id).toBe("packet-G-lane-P1-r1");
    expect(result!.verdict).toBe("satisfied");
    expect(result!.blocking_findings).toEqual([]);
  });

  it("is lenient about a missing schema_version", () => {
    const env = makeResult("a".repeat(64)) as Record<string, unknown>;
    delete env["schema_version"];
    const { result } = parseReviewResult(JSON.stringify(env));
    expect(result).not.toBeNull();
  });

  it("rejects a wrong schema_version", () => {
    const { result, reasons } = parseReviewResult(
      JSON.stringify(makeResult("a".repeat(64), { schema_version: "review_result.v2" }))
    );
    expect(result).toBeNull();
    expect(reasons.join(" ")).toContain("schema_version");
  });

  it.each(["packet_id", "artifact_sha256_reviewed", "verdict", "blocking_findings"])(
    "rejects an envelope missing required field %s",
    (field) => {
      const env = makeResult("a".repeat(64)) as Record<string, unknown>;
      delete env[field];
      const { result, reasons } = parseReviewResult(JSON.stringify(env));
      expect(result).toBeNull();
      expect(reasons.join(" ")).toContain(field);
    }
  );

  it("rejects non-JSON", () => {
    const { result, reasons } = parseReviewResult("## SATISFIED\n");
    expect(result).toBeNull();
    expect(reasons.join(" ")).toContain("not valid JSON");
  });
});

// ---------------------------------------------------------------------------
// evaluateGatePass — the 5 conditions
// ---------------------------------------------------------------------------

describe("evaluateGatePass", () => {
  const artifactBytes = Buffer.from(ARTIFACT_CONTENT);
  const sha = sha256Hex(artifactBytes);

  it("passes when all five conditions hold", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha)),
      artifactBytes,
      packetId: "packet-G-lane-P1-r1",
    });
    expect(v.pass).toBe(true);
    expect(v.conditions).toEqual({
      parses: true,
      packet_id_match: true,
      sha256_match: true,
      satisfied: true,
      no_blockers: true,
    });
    expect(v.recomputed_sha256).toBe(sha);
    expect(v.reasons).toEqual([]);
  });

  it("condition 2: fails on packet_id mismatch", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha)),
      artifactBytes,
      packetId: "packet-G-lane-P1-r2",
    });
    expect(v.pass).toBe(false);
    expect(v.conditions.packet_id_match).toBe(false);
    expect(v.reasons.join(" ")).toContain("packet_id mismatch");
  });

  it("condition 2 is vacuous when no --packet-id is supplied", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha)),
      artifactBytes,
    });
    expect(v.pass).toBe(true);
    expect(v.conditions.packet_id_match).toBe(true);
  });

  it("condition 3: fails when the artifact bytes changed mid-review", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha)),
      artifactBytes: Buffer.from(ARTIFACT_CONTENT + "\nedited after review\n"),
    });
    expect(v.pass).toBe(false);
    expect(v.conditions.sha256_match).toBe(false);
    expect(v.reasons.join(" ")).toContain("artifact changed mid-review");
  });

  it("condition 3: sha comparison is case-insensitive", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha.toUpperCase())),
      artifactBytes,
    });
    expect(v.conditions.sha256_match).toBe(true);
  });

  it("condition 4: fails on verdict 'issues' without force-pass", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha, { verdict: "issues" })),
      artifactBytes,
    });
    expect(v.pass).toBe(false);
    expect(v.conditions.satisfied).toBe(false);
  });

  it("condition 4: --force-pass satisfies an 'issues' verdict", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(makeResult(sha, { verdict: "issues" })),
      artifactBytes,
      forcePass: true,
    });
    expect(v.conditions.satisfied).toBe(true);
    expect(v.pass).toBe(true);
  });

  it("condition 5: fails on remaining blocking findings even with force-pass", () => {
    const v = evaluateGatePass({
      resultRaw: JSON.stringify(
        makeResult(sha, {
          verdict: "issues",
          blocking_findings: [
            { severity: "blocking", summary: "secret committed in fixture" },
          ],
        })
      ),
      artifactBytes,
      forcePass: true,
    });
    expect(v.pass).toBe(false);
    expect(v.conditions.no_blockers).toBe(false);
    expect(v.reasons.join(" ")).toContain("blocking_findings");
  });

  it("condition 1: an unreadable result file fails the gate", () => {
    const v = evaluateGatePass({ resultRaw: null, artifactBytes });
    expect(v.pass).toBe(false);
    expect(v.conditions.parses).toBe(false);
    expect(v.recomputed_sha256).toBe(sha);
  });
});

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

describe("parseVerifyGatePassArgs", () => {
  it("parses the full flag set (both --flag value and --flag= forms)", () => {
    const a = parseVerifyGatePassArgs([
      "--result=/r.json",
      "--artifact",
      "/a.md",
      "--packet-id",
      "pkt-1",
      "--force-pass",
    ]);
    expect(a).toEqual({
      resultPath: "/r.json",
      artifactPath: "/a.md",
      packetId: "pkt-1",
      forcePass: true,
    });
  });

  it("errors when --result or --artifact is missing", () => {
    expect("error" in parseVerifyGatePassArgs([])).toBe(true);
    expect("error" in parseVerifyGatePassArgs(["--result", "/r.json"])).toBe(true);
  });

  it("errors on an unknown flag", () => {
    const a = parseVerifyGatePassArgs(["--result", "/r", "--artifact", "/a", "--bogus"]);
    expect("error" in a).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CLI end-to-end (real path: npx tsx subprocess on a temp dir)
// ---------------------------------------------------------------------------

describe("verify-gate-pass CLI (end-to-end)", () => {
  it("exits 0 and prints a passing verdict for a genuine result", () => {
    const dir = makeTempDir();
    const { artifactPath, resultPath, sha } = writeFixtures(dir);
    const r = runCli([
      "--result",
      resultPath,
      "--artifact",
      artifactPath,
      "--packet-id",
      "packet-G-lane-P1-r1",
    ]);
    expect(r.status).toBe(0);
    const verdict = JSON.parse(r.stdout);
    expect(verdict.pass).toBe(true);
    expect(verdict.recomputed_sha256).toBe(sha);
    expect(verdict.conditions.sha256_match).toBe(true);
  });

  it("exits 2 when the artifact was tampered with after review", () => {
    const dir = makeTempDir();
    const { artifactPath, resultPath } = writeFixtures(dir);
    fs.appendFileSync(artifactPath, "\nlate edit — the reviewer never saw this\n");
    const r = runCli(["--result", resultPath, "--artifact", artifactPath]);
    expect(r.status).toBe(2);
    const verdict = JSON.parse(r.stdout);
    expect(verdict.pass).toBe(false);
    expect(verdict.conditions.sha256_match).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
  });

  it("exits 2 when the result file is missing (gate fail, not usage error)", () => {
    const dir = makeTempDir();
    const { artifactPath } = writeFixtures(dir);
    const r = runCli([
      "--result",
      path.join(dir, "no-such-result.json"),
      "--artifact",
      artifactPath,
    ]);
    expect(r.status).toBe(2);
    const verdict = JSON.parse(r.stdout);
    expect(verdict.conditions.parses).toBe(false);
  });

  it("exits 1 on missing flags (usage error)", () => {
    const r = runCli([]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage:");
  });

  it("exits 1 when the artifact is unreadable (nothing to bind the gate to)", () => {
    const dir = makeTempDir();
    const { resultPath } = writeFixtures(dir);
    const r = runCli([
      "--result",
      resultPath,
      "--artifact",
      path.join(dir, "no-such-artifact.md"),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("cannot read artifact");
  });
});
