import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OPERATION_KINDS,
  ACCEPTED_CONFORMANCE_ARTIFACTS,
  buildOperationEvidence,
  buildReleaseClaim,
  verifyReleaseClaim,
} from "../../src/modules/distribution/workflows/release-distribution-contract";

const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const archive = Buffer.from("deterministic archive bytes");
const sourceCommit = "66ee3496bed86bca8fc4dd8973c34327308fbaf8";

function claim() {
  return buildReleaseClaim({
    archive,
    archive_path: `release/guild-${sourceCommit}.tar.gz`,
    source_commit: sourceCommit,
    manifest: { entries: [{ path: "plugin.json", sha256: sha("plugin") }] },
    contract_versions: {
      runtime: "guild.runtime_boundary_contract.v1",
      receipt: "guild.handoff.v2",
      artifact: "guild.artifact.v1",
    },
    conformance_artifacts: ACCEPTED_CONFORMANCE_ARTIFACTS.map((entry) => ({ ...entry })),
    operations: OPERATION_KINDS.map((kind) =>
      buildOperationEvidence({
        kind,
        destination: kind === "render" ? `release/guild-${sourceCommit}.tar.gz` : "not-exercised",
        manager: { identity: "guild-release-builder", path: "/usr/bin/git" },
        evidence_class: kind === "render" || kind === "verify" ? "release-builder" : "unsupported",
        outcome: kind === "render" || kind === "verify" ? "succeeded" : "refused",
        refusal_reason:
          kind === "render" || kind === "verify" ? undefined : "operator manager evidence unavailable",
      })
    ),
  });
}

test("six operation kinds are complete, distinct, and cannot be conflated", () => {
  const value = claim();
  expect(value.operations.map((row) => row.kind)).toEqual(OPERATION_KINDS);
  expect(new Set(value.operations.map((row) => row.kind)).size).toBe(6);
  expect(verifyReleaseClaim(value, archive)).toEqual([]);
  const conflated = { ...value, operations: value.operations.map((row) => ({ ...row, kind: "render" as const })) };
  expect(verifyReleaseClaim(conflated, archive)).toContain("operation kinds must be complete and distinct");
});

test("every operation records destination, observed manager identity/path, evidence class, and honest refusal", () => {
  for (const row of claim().operations) {
    expect(row.destination).toBeTruthy();
    expect(row.manager.identity).toBeTruthy();
    expect(row.manager.path.startsWith("/")).toBe(true);
    expect(row.evidence_class).toMatch(/^(release-builder|operator|fixture|unsupported)$/);
    if (row.evidence_class !== "operator" && row.kind === "activate") {
      expect(row.outcome).toBe("refused");
      expect(row.refusal_reason).toBeTruthy();
    }
  }
});

test.each([
  ["archive bytes", (v: ReturnType<typeof claim>) => v, Buffer.from("tampered")],
  ["checksum", (v: ReturnType<typeof claim>) => ({ ...v, archive_sha256: "0".repeat(64) }), archive],
  ["manifest", (v: ReturnType<typeof claim>) => ({ ...v, manifest: { entries: [] } }), archive],
  ["source commit", (v: ReturnType<typeof claim>) => ({ ...v, source_commit: "0".repeat(40) }), archive],
  ["contract version", (v: ReturnType<typeof claim>) => ({ ...v, contract_versions: { ...v.contract_versions, receipt: "bad" } }), archive],
  ["conformance hash", (v: ReturnType<typeof claim>) => ({ ...v, conformance_artifacts: v.conformance_artifacts.map((entry, index) => index === 0 ? { ...entry, sha256: "0".repeat(64) } : entry) }), archive],
])("rejects %s tampering", (_label, mutate, bytes) => {
  expect(verifyReleaseClaim(mutate(claim()) as ReturnType<typeof claim>, bytes).length).toBeGreaterThan(0);
});

test("render/install alone cannot establish activation or support", () => {
  const value = claim();
  expect(value.host_support.supported).toBe(false);
  expect(value.host_support.reason).toMatch(/activation/i);
});

test("release builder derives a clean non-parent candidate HEAD and rejects working-tree mismatch", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-release-head-"));
  const out = path.join(root, "..", `${path.basename(root)}-release`);
  const builder = path.resolve(__dirname, "..", "build-release-candidate.ts");
  const tsx = path.resolve(__dirname, "..", "node_modules", ".bin", "tsx");
  try {
    execFileSync("git", ["init", "-q", root]);
    fs.writeFileSync(path.join(root, "candidate.txt"), "parent\n");
    execFileSync("git", ["-C", root, "add", "candidate.txt"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Guild", "-c", "user.email=guild@example.invalid", "commit", "-qm", "parent"]);
    fs.writeFileSync(path.join(root, "candidate.txt"), "candidate\n");
    execFileSync("git", ["-C", root, "add", "candidate.txt"]);
    execFileSync("git", ["-C", root, "-c", "user.name=Guild", "-c", "user.email=guild@example.invalid", "commit", "-qm", "candidate"]);
    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const parent = execFileSync("git", ["-C", root, "rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
    expect(head).not.toBe(parent);

    execFileSync(tsx, [builder, root, out]);
    const release = JSON.parse(fs.readFileSync(path.join(out, "guild-release-contract.v1.json"), "utf8"));
    expect(release.source_commit).toBe(head);
    expect(release.archive_path).toBe(`release/guild-${head}.tar.gz`);
    expect(fs.existsSync(path.join(out, `guild-${head}.tar.gz`))).toBe(true);

    fs.writeFileSync(path.join(root, "candidate.txt"), "mismatched working tree\n");
    expect(() => execFileSync(tsx, [builder, root, out], { stdio: "pipe" })).toThrow(/source working tree must be clean/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
