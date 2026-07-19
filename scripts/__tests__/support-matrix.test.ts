import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_IDS } from "../lib/host-registry-schema";
import { REVIEW_PROGRESS_STATES, validateReviewProgressEvent } from "../lib/review-progress";
import { loadCommittedReceipts } from "../lib/host-smoke-store";
import {
  FORBIDDEN_FINAL_STATES,
  LIFECYCLE_PHASES,
  MATRIX_OPERATIONS,
  generateSupportMatrix,
  renderSupportMatrixMarkdown,
  validateSupportMatrix,
  type SupportMatrix,
} from "../lib/support-matrix";

describe("R12 generated support matrix", () => {
  // verified-multi-host-support §6.5: the matrix reads the COMMITTED smoke receipts
  // (never re-runs smoke). generatedAt on/after the receipts' capture keeps staleness
  // honest; the two-field host-support gate then promotes any host with a valid receipt.
  const matrix: SupportMatrix = generateSupportMatrix("2026-07-04T10:30:00Z", loadCommittedReceipts());

  it("is generated for every canonical host id from adapter outputs", () => {
    expect(matrix.schema_version).toBe("guild.support_matrix.v1");
    expect(matrix.source).toBe("host-adapter-results-and-review-progress-schema");
    expect(matrix.host_ids).toEqual([...HOST_IDS]);
    expect(matrix.rows.map((row) => row.host_id)).toEqual([...HOST_IDS]);
  });

  it("validates with no forbidden final states", () => {
    const validation = validateSupportMatrix(matrix);
    expect(validation).toEqual({ valid: true, errors: [] });
    for (const row of matrix.rows) {
      expect(FORBIDDEN_FINAL_STATES).not.toContain(row.final_state as never);
      expect(["verified", "degraded", "unavailable", "enqueue_only", "manual_instruction"]).toContain(row.final_state);
    }
  });

  it("has every required operation cell for every host", () => {
    for (const row of matrix.rows) {
      expect(Object.keys(row.operations).sort()).toEqual([...MATRIX_OPERATIONS].sort());
      for (const op of MATRIX_OPERATIONS) {
        expect(row.operations[op].reason).toEqual(expect.any(String));
        expect(row.operations[op].evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("proves unsupported or degraded primitives with visible receipts", () => {
    const requiredOps = ["hook_normalization", "permission_decision", "model_params", "dispatch", "memory"] as const;
    for (const row of matrix.rows) {
      for (const op of requiredOps) {
        const cell = row.operations[op];
        if (cell.state !== "verified") {
          expect(cell.receipt).toBeDefined();
          expect(JSON.stringify(cell.receipt)).toMatch(/guild\.|degradation|receipt|host_adapter/);
        }
      }
    }
  });

  it("has anti-vacuous review-progress coverage for every canonical state", () => {
    expect(matrix.review_progress_scenarios.map((event) => event.state)).toEqual([...REVIEW_PROGRESS_STATES]);
    for (const event of matrix.review_progress_scenarios) {
      expect(validateReviewProgressEvent(event)).toEqual({ valid: true, errors: [] });
    }
    for (const row of matrix.rows) {
      expect(row.operations.review_progress.state).toBe("verified");
      expect(JSON.stringify(row.operations.review_progress.receipt)).toContain("guild.review_progress_coverage.v1");
    }
  });

  it("has lifecycle smoke cells for every host and phase", () => {
    for (const row of matrix.rows) {
      expect(Object.keys(row.lifecycle_smoke.phases).sort()).toEqual([...LIFECYCLE_PHASES].sort());
      for (const phase of LIFECYCLE_PHASES) {
        const cell = row.lifecycle_smoke.phases[phase];
        expect(cell.evidence).toContain(`lifecycle:${phase}`);
        if (cell.state !== "verified") expect(cell.receipt).toBeDefined();
      }
      expect(["verified", "degraded", "unavailable", "enqueue_only", "manual_instruction"]).toContain(row.lifecycle_smoke.state);
    }
  });

  it("fails validation for a forbidden final state", () => {
    const bad: SupportMatrix = {
      ...matrix,
      rows: matrix.rows.map((row, index) => index === 0 ? { ...row, final_state: "contract-only" as never } : row),
    };
    const validation = validateSupportMatrix(bad);
    expect(validation.valid).toBe(false);
    expect(validation.errors.join("\n")).toContain("forbidden final state contract-only");
  });

  it("renders markdown from the generated matrix", () => {
    const md = renderSupportMatrixMarkdown(matrix);
    expect(md).toContain("# Generated Host Support Matrix");
    for (const host of HOST_IDS) expect(md).toContain(`| ${host} |`);
    expect(md).toContain("## Coverage Operations");
    expect(md).toContain("Pi dispatch uses pi -p through tmux/plain-process substrate");
    expect(md).toContain("Antigravity dispatch uses agy -p through tmux/plain-process substrate");
  });

  it("the real --check path ignores only the generated timestamp and rejects committed content drift", () => {
    const scriptsDir = join(__dirname, "..");
    const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-check-"));
    const outputPath = join(tempDir, "host-support-matrix.md");
    const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");
    const generatedAt = "2026-07-19T00:00:00.000Z";

    try {
      const generate = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect({ status: generate.status, output: `${generate.stdout}${generate.stderr}` }).toEqual(
        expect.objectContaining({ status: 0 }),
      );

      const expected = readFileSync(outputPath, "utf8");
      const timestampOnlyCommitted = expected.replace(/^Generated: .*$/m, "Generated: 2000-01-01T00:00:00.000Z");
      expect(timestampOnlyCommitted).not.toBe(expected);
      writeFileSync(outputPath, timestampOnlyCommitted);

      const timestampOnly = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--check", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect({
        status: timestampOnly.status,
        output: `${timestampOnly.stdout}${timestampOnly.stderr}`,
      }).toEqual(expect.objectContaining({ status: 0 }));

      const drifted = expected.replace(
        "| claude-code-cli | Supported |",
        "| claude-code-cli | Unsupported |",
      );
      expect(drifted).not.toBe(expected);
      writeFileSync(outputPath, drifted);

      const contentDrift = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--check", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(contentDrift.status).not.toBe(0);
      expect(`${contentDrift.stdout}${contentDrift.stderr}`).toContain("drift");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each([
    ["2026-07-19T00:00:00Z", "2026-07-19T00:00:00.000Z"],
    ["2026-07-19", "2026-07-19T00:00:00.000Z"],
  ])(
    "canonicalizes accepted --generated-at value %s so its generated file passes --check",
    (generatedAt, canonicalGeneratedAt) => {
      const scriptsDir = join(__dirname, "..");
      const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-canonical-"));
      const outputPath = join(tempDir, "host-support-matrix.md");
      const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");

      try {
        const generate = spawnSync(
          tsxBin,
          ["generate-support-matrix.ts", "--generated-at", generatedAt, "--out", outputPath],
          { cwd: scriptsDir, encoding: "utf8" },
        );
        expect({ status: generate.status, output: `${generate.stdout}${generate.stderr}` }).toEqual(
          expect.objectContaining({ status: 0 }),
        );
        expect(readFileSync(outputPath, "utf8").match(/^Generated: .*$/m)?.[0]).toBe(
          `Generated: ${canonicalGeneratedAt}`,
        );

        const check = spawnSync(
          tsxBin,
          ["generate-support-matrix.ts", "--check", "--generated-at", generatedAt, "--out", outputPath],
          { cwd: scriptsDir, encoding: "utf8" },
        );
        expect({ status: check.status, output: `${check.stdout}${check.stderr}` }).toEqual(
          expect.objectContaining({ status: 0 }),
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("rejects an unparseable --generated-at before writing output", () => {
    const scriptsDir = join(__dirname, "..");
    const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-invalid-date-"));
    const outputPath = join(tempDir, "host-support-matrix.md");
    const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");

    try {
      const generate = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--generated-at", "NOT-A-DATE", "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(generate.status).toBe(1);
      expect(`${generate.stdout}${generate.stderr}`).toMatch(/--generated-at.*ISO-8601/i);
      expect(() => readFileSync(outputPath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects a rollover --generated-at timestamp before writing output", () => {
    const scriptsDir = join(__dirname, "..");
    const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-rollover-"));
    const outputPath = join(tempDir, "host-support-matrix.md");
    const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");

    try {
      const generate = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--generated-at", "2026-02-29T00:00:00Z", "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(generate.status).toBe(1);
      expect(`${generate.stdout}${generate.stderr}`).toMatch(/--generated-at.*calendar|rollover/i);
      expect(() => readFileSync(outputPath, "utf8")).toThrow();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("the real --check path rejects malformed Generated metadata", () => {
    const scriptsDir = join(__dirname, "..");
    const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-malformed-"));
    const outputPath = join(tempDir, "host-support-matrix.md");
    const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");
    const generatedAt = "2026-07-19T00:00:00.000Z";

    try {
      const generate = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(generate.status).toBe(0);
      const malformed = readFileSync(outputPath, "utf8").replace(
        /^Generated: .*$/m,
        "Generated: NOT-A-TIMESTAMP and altered metadata",
      );
      writeFileSync(outputPath, malformed);

      const check = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--check", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(check.status).toBe(1);
      expect(`${check.stdout}${check.stderr}`).toMatch(/Generated:.*(malformed|timestamp|canonical)/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("the real --check path rejects a second Generated metadata line", () => {
    const scriptsDir = join(__dirname, "..");
    const tempDir = mkdtempSync(join(tmpdir(), "guild-support-matrix-duplicate-"));
    const outputPath = join(tempDir, "host-support-matrix.md");
    const tsxBin = join(scriptsDir, "node_modules", ".bin", "tsx");
    const generatedAt = "2026-07-19T00:00:00.000Z";

    try {
      const generate = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(generate.status).toBe(0);
      const expected = readFileSync(outputPath, "utf8");
      const duplicated = expected.replace(
        /^(Generated: .*?)$/m,
        "$1\nGenerated: 2000-01-01T00:00:00.000Z",
      );
      expect(duplicated).not.toBe(expected);
      writeFileSync(outputPath, duplicated);

      const check = spawnSync(
        tsxBin,
        ["generate-support-matrix.ts", "--check", "--generated-at", generatedAt, "--out", outputPath],
        { cwd: scriptsDir, encoding: "utf8" },
      );
      expect(check.status).toBe(1);
      expect(`${check.stdout}${check.stderr}`).toMatch(/Generated:.*(exactly one|duplicate|found 2)/i);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
