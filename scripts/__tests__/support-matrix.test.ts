import { HOST_IDS } from "../lib/host-registry-schema";
import { REVIEW_PROGRESS_STATES, validateReviewProgressEvent } from "../lib/review-progress";
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
  const matrix: SupportMatrix = generateSupportMatrix("2026-06-18T10:30:00Z");

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
  });
});
