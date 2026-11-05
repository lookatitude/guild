/**
 * E00-T0 · EAT04 / CD12 / R4-F2 / R4-F3 — broker review authority inputs and
 * the lifted gate evaluator.
 *
 * Positive controls: scripts/verify-gate-pass.test.ts stays byte-identical
 * (its own suite must keep passing against the future shim); the CLI keeps its
 * stdout/exit contract.
 * Expected red (absent capability): src/domains/distribution evaluateGatePass,
 * validateReviewResultV1Strict, the pinned schema copy, validateReviewInvocationV1.
 *
 * Proposed test contract (handoff): validateReviewResultV1Strict(value) and
 * validateReviewInvocationV1(value) return the typed record when valid and
 * null (or { ok: false }) otherwise.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { PLUGIN, ownedTempDir, requireExport, requireFile, sha256, teardownOwned } from "./support/e00-harness";

afterEach(teardownOwned);

const GATE_TEST_SHA256_AT_RELEASE = "059a3736acca3f989c93d58520e4388eea07d9063310c42b63d10e4b219d2b86";
// Pinned canonical run schema: review/G-plan-E00-design/result-schema.json (lead clarification).
const SCHEMA_SHA256 = "be9e6257e237a2a6cf6a3fa8568f66021e1d8fd1c2913f6e6fb084ca8d0b3d53";
const CLI = path.join(PLUGIN, "scripts", "verify-gate-pass.ts");
const ARTIFACT = Buffer.from("candidate packet bytes\n");
const PACKET = "run-e00-T1-a1-review";

function result(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: "review_result.v1",
    packet_id: PACKET,
    artifact_sha256_reviewed: sha256(ARTIFACT),
    verdict: "satisfied",
    blocking_findings: [],
    verification: ["checked the candidate"],
    limits: ["fixture"],
    ...over,
  };
}

const finding = { id: "B1", path: "src/x.ts", line: 1, title: "t", trigger: "t", impact: "i", required: "r" };

function accepted(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  return !(typeof v === "object" && (v as { ok?: unknown }).ok === false);
}

function runCli(resultRaw: string | null, packetId: string): { status: number; verdict: unknown } {
  const dir = ownedTempDir("guild-e00-gate-");
  const art = path.join(dir, "artifact.bin");
  const res = path.join(dir, "result.json");
  fs.writeFileSync(art, ARTIFACT);
  if (resultRaw !== null) fs.writeFileSync(res, resultRaw);
  const r = spawnSync("npx", ["tsx", CLI, "--result", res, "--artifact", art, "--packet-id", packetId], { encoding: "utf8", cwd: dir, timeout: 60000 });
  return { status: r.status ?? -1, verdict: JSON.parse(r.stdout) };
}

describe("gate evaluator — preserved CLI suite (positive control)", () => {
  it("scripts/verify-gate-pass.test.ts is byte-identical to the release baseline", () => {
    expect(sha256(fs.readFileSync(path.join(PLUGIN, "scripts", "verify-gate-pass.test.ts")))).toBe(GATE_TEST_SHA256_AT_RELEASE);
  });

  it("the CLI half of the parity harness runs today: satisfied exits 0, issues exits 2", () => {
    const ok = runCli(JSON.stringify(result()), PACKET);
    expect(ok.status).toBe(0);
    expect(ok.verdict).toMatchObject({ pass: true, recomputed_sha256: sha256(ARTIFACT) });
    const bad = runCli(JSON.stringify(result({ verdict: "issues" })), PACKET);
    expect(bad.status).toBe(2);
    expect(bad.verdict).toMatchObject({ pass: false, conditions: { satisfied: false } });
  });
});

describe("gate evaluator parity — src/domains/distribution vs CLI (expected red)", () => {
  const cases: Array<[string, string | null, string]> = [
    ["satisfied", JSON.stringify(result()), PACKET],
    ["packet mismatch", JSON.stringify(result()), "other-packet"],
    ["sha mismatch", JSON.stringify(result({ artifact_sha256_reviewed: "0".repeat(64) })), PACKET],
    ["issues verdict", JSON.stringify(result({ verdict: "issues" })), PACKET],
    ["blocking findings", JSON.stringify(result({ blocking_findings: [finding] })), PACKET],
    ["unparseable", "{not json", PACKET],
    ["missing result", null, PACKET],
  ];
  for (const [label, raw, packetId] of cases) {
    it(`identical conditions, recomputed sha and reasons: ${label}`, async () => {
      const evaluate = await requireExport<(o: unknown) => Record<string, unknown>>("src/domains/distribution/index.ts", "evaluateGatePass");
      const lib = evaluate({ resultRaw: raw, artifactBytes: ARTIFACT, packetId, forcePass: false });
      const cli = runCli(raw, packetId);
      expect(cli.verdict).toEqual(lib);
      expect(cli.status).toBe(lib["pass"] === true ? 0 : 2);
    });
  }

  it("re-exports sha256Hex from the public distribution index", async () => {
    const hex = await requireExport<(b: Buffer) => string>("src/domains/distribution/index.ts", "sha256Hex");
    expect(hex(ARTIFACT)).toBe(sha256(ARTIFACT));
  });
});

describe("validateReviewResultV1Strict (CD12 e, expected red)", () => {
  async function strict() {
    return requireExport<(v: unknown) => unknown>("src/domains/distribution/index.ts", "validateReviewResultV1Strict");
  }

  it("accepts a canonical satisfied result and an issues result with a full finding", async () => {
    const v = await strict();
    expect(accepted(v(result()))).toBe(true);
    expect(accepted(v(result({ verdict: "issues", blocking_findings: [finding] })))).toBe(true);
  });

  for (const [label, value] of [
    ["missing schema_version", (() => { const r = result(); delete r["schema_version"]; return r; })()],
    ["wrong schema_version const", result({ schema_version: "review_result.v2" })],
    ["missing verification", (() => { const r = result(); delete r["verification"]; return r; })()],
    ["missing limits", (() => { const r = result(); delete r["limits"]; return r; })()],
    ["extra top-level property", result({ notes: "x" })],
    ["verdict outside satisfied|issues", result({ verdict: "approved" })],
    ["finding missing a required field", result({ verdict: "issues", blocking_findings: [{ ...finding, impact: undefined }] })],
    ["finding with an extra property", result({ verdict: "issues", blocking_findings: [{ ...finding, severity: "high" }] })],
    ["verification not a string array", result({ verification: [1] })],
  ] as const) {
    it(`refuses ${label}`, async () => {
      const v = await strict();
      expect(accepted(v(JSON.parse(JSON.stringify(value))))).toBe(false);
    });
  }

  it("ships the pinned schema copy and agrees with its closed shape", async () => {
    const v = await strict();
    const file = requireFile("src/domains/distribution/schemas/review_result.v1.schema.json");
    const bytes = fs.readFileSync(file);
    expect(sha256(bytes)).toBe(SCHEMA_SHA256);
    const schema = JSON.parse(bytes.toString("utf8"));
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(["artifact_sha256_reviewed", "blocking_findings", "limits", "packet_id", "schema_version", "verdict", "verification"]);
    for (const key of schema.required as string[]) {
      const r = result();
      delete r[key];
      expect(accepted(v(r))).toBe(false);
    }
  });
});

describe("validateReviewInvocationV1 (CD12 c, expected red)", () => {
  const invocation = {
    schema_version: "guild.review_invocation.v1",
    invocation_id: "inv-1", packet_id: PACKET, request_id: "req-1",
    reviewer_participant_id: "e00-design-security", participation_kind: "reviewer_cross_host", role_ref: "security-auditor",
    request: { path: "r.json", sha256: "a".repeat(64) }, candidate: { path: "c.json", sha256: "b".repeat(64) },
    packet: { path: "p.txt", sha256: "c".repeat(64) }, result: { path: "res.json", sha256: "d".repeat(64) },
    adapter_exit: { path: "e.json", sha256: "e".repeat(64) },
    started_at: "2026-10-26T12:00:00.000Z", finished_at: "2026-10-26T12:05:00.000Z", exit: 0,
    reviewer_family: "openai", author_family: "anthropic", independence: "cross_family",
    requested_model: "m", served_model: "m",
  };

  it("accepts a complete record", async () => {
    const v = await requireExport<(x: unknown) => unknown>("src/domains/distribution/index.ts", "validateReviewInvocationV1");
    expect(accepted(v(invocation))).toBe(true);
  });

  for (const field of ["invocation_id", "packet_id", "participation_kind", "role_ref", "adapter_exit", "exit", "served_model", "finished_at"]) {
    it(`refuses a record missing ${field}`, async () => {
      const v = await requireExport<(x: unknown) => unknown>("src/domains/distribution/index.ts", "validateReviewInvocationV1");
      const copy: Record<string, unknown> = { ...invocation };
      delete copy[field];
      expect(accepted(v(copy))).toBe(false);
    });
  }
});
