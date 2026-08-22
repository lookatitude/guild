import { redactShareableFile } from "../../src/modules/security/workflows/scrub-redact";

const SHA = "0123456789abcdef".repeat(4);

describe("shareable-file schema-bound SHA-256 redaction", () => {
  it("preserves only the guild.run.v1 start-snapshot SHA while redacting paths and credentials", () => {
    const input = [
      "schema_version: guild.run.v1",
      "run_id: run-20260822-080000-public-projection",
      "cwd: /Users/operator/Projects/private",
      "capability_start_snapshot_ref:",
      "  path: capability/run-start-snapshot.json",
      `  sha256: ${SHA}`,
      `operator_note: api_key=sk-abcdefghijklmnop`,
      `arbitrary_entropy: ${"f".repeat(64)}`,
      "",
    ].join("\n");
    const result = redactShareableFile(input, "run.yaml");
    expect(result.out).toContain(`sha256: ${SHA}`);
    expect(result.out).not.toContain("/Users/operator");
    expect(result.out).not.toContain("sk-abcdefghijklmnop");
    expect(result.out).not.toContain("f".repeat(64));
    expect(result.opPaths).toBe(1);
    expect(result.secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "api_key-assignment" }),
      expect.objectContaining({ category: "high-entropy hex string (potential secret)" }),
    ]));
  });

  it("fails closed when the reviewed guild.run.v1 SHA value is duplicated elsewhere", () => {
    const input = [
      "schema_version: guild.run.v1",
      "run_id: run-20260822-080000-duplicate-hash",
      "capability_start_snapshot_ref:",
      "  path: capability/run-start-snapshot.json",
      `  sha256: ${SHA}`,
      `operator_note: ${SHA}`,
      "",
    ].join("\n");
    const result = redactShareableFile(input, "run.yaml");
    expect(result.out).not.toContain(SHA);
    expect(result.secrets).toHaveLength(2);
  });

  it("preserves a reviewed SHA-256 field while redacting paths and credentials", () => {
    const input = `${JSON.stringify({
      schema_version: "guild.activated_host_public_evidence.v1",
      public_evidence_sha256: SHA,
      note: "/Users/operator/Projects/private",
      token: "sk-abcdefghijklmnop",
    }, null, 2)}\n`;
    const result = redactShareableFile(input, "provenance.json");
    expect(result.out).toContain(SHA);
    expect(result.out).not.toContain("/Users/operator");
    expect(result.out).not.toContain("sk-abcdefghijklmnop");
    expect(result.opPaths).toBe(1);
    expect(result.secrets.length).toBeGreaterThan(0);
  });

  it.each([
    ["unknown schema", { schema_version: "attacker.v1", manifest_sha256: SHA }],
    ["unreviewed field", { schema_version: "guild.activated_host_public_evidence.v1", arbitrary_entropy: SHA }],
  ])("redacts 64-hex from %s", (_label, value) => {
    const result = redactShareableFile(`${JSON.stringify(value)}\n`, "provenance.json");
    expect(result.out).not.toContain(SHA);
    expect(result.secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "high-entropy hex string (potential secret)" }),
    ]));
  });

  it("does not preserve an unreviewed occurrence that equals a reviewed hash", () => {
    const input = `${JSON.stringify({
      schema_version: "guild.activated_host_public_manifest.v1",
      manifest_sha256: SHA,
      token: SHA,
    }, null, 2)}\n`;
    const result = redactShareableFile(input, "provenance.json");
    const output = JSON.parse(result.out) as Record<string, unknown>;
    expect(output.manifest_sha256).toBe(SHA);
    expect(output.token).not.toBe(SHA);
    expect(result.secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "high-entropy hex string (potential secret)" }),
    ]));
  });

  it("does not preserve a reviewed field name at an unapproved structural path", () => {
    const input = `${JSON.stringify({
      schema_version: "guild.activated_host_public_manifest.v1",
      manifest_sha256: SHA,
      unreviewed: { sha256: "f".repeat(64) },
    }, null, 2)}\n`;
    const result = redactShareableFile(input, "provenance.json");
    expect(result.out).toContain(SHA);
    expect(result.out).not.toContain("f".repeat(64));
    expect(result.secrets).toEqual(expect.arrayContaining([
      expect.objectContaining({ category: "high-entropy hex string (potential secret)" }),
    ]));
  });

  it("preserves only reviewed hash fields in canonical JSONL lines", () => {
    const input = `${JSON.stringify({
      schema_version: "guild.trace.dispatch.v1",
      tree_sha256: SHA,
      arbitrary_entropy: "f".repeat(64),
    })}\n`;
    const result = redactShareableFile(input, "logs/v1.4-events.jsonl");
    expect(result.out).toContain(SHA);
    expect(result.out).not.toContain("f".repeat(64));
  });
});
