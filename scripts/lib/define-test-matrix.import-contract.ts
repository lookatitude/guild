/**
 * scripts/lib/define-test-matrix.import-contract.ts
 *
 * LW2-5 COMPILE-TIME IMPORT TEST (spec SC-W2-4): proves the test-matrix generator
 * builds on Wave-1 through the **named imported interface** and does NOT re-implement
 * the traceability engine. If this file compiles, every required public export
 * resolved at its real path:
 *   - `acceptanceCriterionIds()` from `./define-schema`
 *   - `checkTraceability()` + the trace types `TraceChain` / `TraceabilityReport` /
 *     `TraceRow` / `TraceUnmet` / `TraceOrphan` from `./define-traceability`
 *
 * Pure, no I/O, no clock, no process IO at module scope. The runtime assertions are a
 * belt-and-braces check for a tsx/jest driver; the type-level usages are the contract.
 */

import { acceptanceCriterionIds } from "./define-schema";
import {
  checkTraceability,
  type TraceChain,
  type TraceabilityReport,
  type TraceRow,
  type TraceUnmet,
  type TraceOrphan,
} from "./define-traceability";
import { generateTestMatrix, type TestMatrixReport } from "./define-test-matrix";

// --- Type-level proof: each imported trace type is load-bearing here. ---
type _AssertChain = TraceChain; // structural use below
const _exampleChain: TraceChain = { qa: { resolved_ids: ["AC-1"] } };

// --- Runtime proof: the two imported functions exist and are callable. ---
const _ids: string[] = acceptanceCriterionIds({
  schema_version: "guild.define.v1",
  acceptance_criteria: [{ id: "AC-1", text: "t" }],
});

const _report: TraceabilityReport = checkTraceability(
  { schema_version: "guild.define.v1", acceptance_criteria: [{ id: "AC-1", text: "t" }] },
  _exampleChain
);
const _row: TraceRow = _report.matrix[0];
const _unmet: TraceUnmet[] = _report.unmet;
const _orphan: TraceOrphan[] = _report.orphans;

const _matrix: TestMatrixReport = generateTestMatrix(
  { schema_version: "guild.define.v1", acceptance_criteria: [{ id: "AC-1", text: "t" }] },
  { tests: [{ id: "T1", covers: ["AC-1"] }] }
);

/** True iff every required import resolved AND is wired correctly at runtime. */
export const IMPORT_CONTRACT_OK: boolean =
  typeof acceptanceCriterionIds === "function" &&
  typeof checkTraceability === "function" &&
  typeof generateTestMatrix === "function" &&
  _ids.length === 1 &&
  _row.id === "AC-1" &&
  Array.isArray(_unmet) &&
  Array.isArray(_orphan) &&
  _matrix.ac_ids.length === 1;

// Reference the alias so it is not flagged unused under noUnusedLocals.
export type ImportContractChain = _AssertChain;
