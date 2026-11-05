/**
 * E00-T0 · EAT03 / CD9 — typed oracle codec over the existing ledger path.
 *
 * Positive controls (green today, must stay green): canonical typed targets
 * travel through validateDoneWhen / readDoneWhen / initProgressLedger /
 * ledgerBoundToAssignment unchanged; a foreign ledger stays refused; the
 * conformance named_check path still validates.
 * Expected red: ledger writes without a binding are accepted today; the
 * declared decodeExecutableTarget / validateExecutableDoneWhen do not exist.
 *
 * Proposed test contract (handoff): decodeExecutableTarget(kind, target) and
 * validateExecutableDoneWhen(doneWhen, { scope_paths, dependencies }) return
 * { ok: true, ... } | { ok: false, reason }; only oracle_kind_unsupported_in_e00
 * is a declared reason code, other refusals are asserted as ok:false.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import {
  initProgressLedger, ledgerBoundToAssignment, progressLedgerPath, readDoneWhen, readProgressLedger,
  recordOracleOutcome, validateDoneWhen,
} from "../../src/domains/dispatch";
import {
  FIXED_NOW, canonicalJson, driveLane, isTypedBindingRejection, isTypedBindingResult, makeRuntime, requireExport, teardownOwned, tempRoot,
} from "./support/e00-harness";

afterEach(teardownOwned);

/** F6: only a typed binding refusal counts; any other exception fails the test. */
function typedLedgerRefusal(run: () => unknown): boolean {
  try {
    return isTypedBindingResult(run());
  } catch (error) {
    if (isTypedBindingRejection(error)) return true;
    throw error;
  }
}

const CMD = canonicalJson({ argv: ["bun", "test", "src/api"], cwd: "src/api", timeout_ms: 120000 });
const ART = canonicalJson({ path: "src/api/routes.ts", sha256: null });
const ACC = canonicalJson({ logical_task_id: "T0" });
const TYPED = [
  { id: "tests", oracle: "command", target: CMD },
  { id: "routes", oracle: "artifact_exists", target: ART },
  { id: "upstream", oracle: "acceptance_record", target: ACC },
];
const CTX = { scope_paths: ["src/api"], dependencies: [{ logical_task_id: "T0", accepted_artifact_ref: null }] };

type Decode = (kind: string, target: string) => { ok: boolean; reason?: string; value?: unknown };
type Validate = (doneWhen: unknown, ctx: typeof CTX) => { ok: boolean; reason?: string };

async function validator(): Promise<Validate> {
  return requireExport<Validate>("src/domains/dispatch/index.ts", "validateExecutableDoneWhen");
}

describe("EAT03 positive — typed targets through the unchanged legacy ledger path", () => {
  it("validateDoneWhen accepts canonical typed target strings and keeps id+kind", () => {
    const check = validateDoneWhen(TYPED);
    expect(check.ok).toBe(true);
    expect((check as { items: Array<{ id: string; oracle: string; target: string }> }).items).toEqual(TYPED);
  });

  it("initProgressLedger + ledgerBoundToAssignment bind a typed ledger to its own assignment", async () => {
    const root = tempRoot("guild-e00-oracle-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", doneWhen: TYPED });
    expect(readDoneWhen(d.assignment).ok).toBe(true);
    const ledger = readProgressLedger({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1" });
    expect(ledgerBoundToAssignment(ledger, d.assignment).ok).toBe(true);
  });

  it("a foreign assignment's ledger is refused", async () => {
    const root = tempRoot("guild-e00-oracle-");
    const rt = makeRuntime(root);
    const d = await driveLane(root, rt, { logicalTaskId: "T1", role: "backend", doneWhen: TYPED });
    const ledger = readProgressLedger({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1" })!;
    expect(ledgerBoundToAssignment({ ...ledger, assignment_id: "T1.tr9:1:other" }, d.assignment).ok).toBe(false);
  });

  it("the conformance named_check path still validates (legacy)", () => {
    expect(validateDoneWhen([{ id: "api", oracle: "named_check", target: "npm test -- api" }]).ok).toBe(true);
  });
});

describe("EAT03 ledger write without binding (expected red)", () => {
  it("initProgressLedger refuses with no binding and writes no ledger", () => {
    const root = tempRoot("guild-e00-ledger-");
    expect(typedLedgerRefusal(() => initProgressLedger({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1", cell_id: "cell-T1", assignment_id: "T1.tr1:1:i", done_when: TYPED, now: () => FIXED_NOW }))).toBe(true);
    expect(fs.existsSync(path.join(root.cwd, progressLedgerPath({ run_id: root.runId, logical_task_id: "T1" })))).toBe(false);
  });

  it("recordOracleOutcome refuses with no binding and leaves the ledger bytes unchanged", () => {
    const root = tempRoot("guild-e00-ledger-");
    const init = (initProgressLedger as (i: unknown) => { ok: boolean; path?: string })({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1", cell_id: "cell-T1", assignment_id: "T1.tr1:1:i", done_when: TYPED, now: () => FIXED_NOW, binding: { binding_ref: root.bindingRef } });
    expect(init.ok).toBe(true);
    const file = path.join(root.cwd, progressLedgerPath({ run_id: root.runId, logical_task_id: "T1" }));
    const before = fs.readFileSync(file);
    expect(typedLedgerRefusal(() => recordOracleOutcome({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1", item_id: "tests", state: "pass", now: () => FIXED_NOW }))).toBe(true);
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("recordOracleOutcome refuses a mismatched binding", () => {
    const root = tempRoot("guild-e00-ledger-");
    (initProgressLedger as (i: unknown) => unknown)({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1", cell_id: "cell-T1", assignment_id: "T1.tr1:1:i", done_when: TYPED, now: () => FIXED_NOW, binding: { binding_ref: root.bindingRef } });
    expect(typedLedgerRefusal(() => (recordOracleOutcome as (i: unknown) => unknown)({ cwd: root.cwd, run_id: root.runId, logical_task_id: "T1", item_id: "tests", state: "pass", now: () => FIXED_NOW, binding: { binding_ref: "rb-other-run" } }))).toBe(true);
  });
});

describe("EAT03 / CD9 executable oracle codec (declared, expected red)", () => {
  it("decodeExecutableTarget round-trips the canonical encodings", async () => {
    const decode = await requireExport<Decode>("src/domains/dispatch/index.ts", "decodeExecutableTarget");
    expect(decode("command", CMD)).toMatchObject({ ok: true, value: { argv: ["bun", "test", "src/api"], cwd: "src/api", timeout_ms: 120000 } });
    expect(decode("artifact_exists", ART)).toMatchObject({ ok: true, value: { path: "src/api/routes.ts", sha256: null } });
    expect(decode("acceptance_record", ACC)).toMatchObject({ ok: true, value: { logical_task_id: "T0" } });
  });

  it("refuses non-canonical encodings (key order, whitespace)", async () => {
    const decode = await requireExport<Decode>("src/domains/dispatch/index.ts", "decodeExecutableTarget");
    expect(decode("command", JSON.stringify({ timeout_ms: 120000, cwd: "src/api", argv: ["bun"] })).ok).toBe(false);
    expect(decode("command", JSON.stringify({ argv: ["bun"], cwd: "src/api", timeout_ms: 1 }, null, 1)).ok).toBe(false);
  });

  it("refuses targets that fail typed decoding", async () => {
    const decode = await requireExport<Decode>("src/domains/dispatch/index.ts", "decodeExecutableTarget");
    for (const bad of [
      canonicalJson({ argv: [], cwd: "src/api", timeout_ms: 1000 }),
      canonicalJson({ argv: ["bun"], cwd: "src/api", timeout_ms: 600001 }),
      canonicalJson({ argv: "bun test", cwd: "src/api", timeout_ms: 1000 }),
      "not json",
    ]) expect(decode("command", bad).ok).toBe(false);
    expect(decode("artifact_exists", canonicalJson({ path: "src/api/x.ts", sha256: "zz" })).ok).toBe(false);
    expect(decode("acceptance_record", canonicalJson({})).ok).toBe(false);
  });

  it("validateExecutableDoneWhen accepts the typed positive set", async () => {
    expect((await validator())(TYPED, CTX)).toMatchObject({ ok: true });
  });

  for (const kind of ["named_check", "verify.after_edit"]) {
    it(`refuses ${kind} with oracle_kind_unsupported_in_e00`, async () => {
      expect((await validator())([{ id: "x", oracle: kind, target: "npm test" }], CTX)).toMatchObject({ ok: false, reason: "oracle_kind_unsupported_in_e00" });
    });
  }

  for (const [label, doneWhen] of [
    ["empty done_when", []],
    ["missing target", [{ id: "tests", oracle: "command" }]],
    ["command cwd outside scope_paths", [{ id: "tests", oracle: "command", target: canonicalJson({ argv: ["bun"], cwd: "src/other", timeout_ms: 1000 }) }]],
    ["command cwd escaping the root", [{ id: "tests", oracle: "command", target: canonicalJson({ argv: ["bun"], cwd: "../x", timeout_ms: 1000 }) }]],
    ["artifact path outside scope_paths", [{ id: "a", oracle: "artifact_exists", target: canonicalJson({ path: "etc/passwd", sha256: null }) }]],
    ["acceptance_record on a non-dependency", [{ id: "u", oracle: "acceptance_record", target: canonicalJson({ logical_task_id: "T9" }) }]],
    ["non-canonical target encoding", [{ id: "tests", oracle: "command", target: JSON.stringify({ timeout_ms: 1000, argv: ["bun"], cwd: "src/api" }) }]],
  ] as const) {
    it(`refuses ${label}`, async () => {
      expect((await validator())(doneWhen, CTX).ok).toBe(false);
    });
  }
});
