/**
 * R01 · logical run and execution identity foundation (AT08, AT09).
 *
 * AT08 identity migration: a v1 open run keeps its host binding; a v2 logical
 * run owns multiple immutable executions; each task attempt belongs to exactly
 * one run/execution; a goal may collect contributions across runs. Negative
 * control: attempt reparenting and a changed original host are refused.
 *
 * AT09 binding integration: the joint versioned capability (binding, session,
 * assignment, attempt, receipt, adapter) admits a supported identity end to end
 * and keeps the host conversation distinct from the Stack session. Negative
 * control: a trace-only execution_id under an old (v1) authority binding refuses.
 *
 * Contract parity: the frozen A02 checkout is read from A02_CONTRACT_ROOT, or
 * from <umbrella>/contracts/guild-stack/v2 next to the plugin. A plugin-only
 * checkout has neither and runs the vendored cases only; set
 * R01_REQUIRE_A02=1 to make the differential mandatory.
 */
import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import {
  EXECUTION_IDENTITY_CAPABILITY,
  ExecutionIdentityRefusal,
  admitExecutionIdentity,
  assignmentEvidencePath,
  createLogicalRun,
  listGoalContributions,
  negotiateExecutionIdentity,
  readLogicalRunView,
  recordExecutionSegment,
  recordRevision,
  recordTaskAssignment,
  recordTaskAttempt,
  validateExecutionIdentityRecord,
  validateExecutionIdentityShape,
  type R01SchemaName,
} from "./execution-identity";
import { RUN_BINDING_V1_FIELDS, loadRunBinding, mintRunBinding, runBindingPath, validateRunBindingRecord } from "./run-binding";
import { SESSION_BINDING_V1_FIELDS, bindSession, bindSessionForRun, readSessionBinding, sessionBindingPath } from "../config";
import { TASK_ASSIGNMENT_V2_FIELDS, validateTaskAssignmentV2 } from "../dispatch";
import { RESERVED_IDENTITY_FIELDS, claimRunKind, readRunKind } from "../kernel";

const PLUGIN_ROOT = path.resolve(__dirname, "../../..");
const VENDORED = path.join(__dirname, "execution-identity.a02-cases.json");
const A02_ROOT = process.env["A02_CONTRACT_ROOT"] ?? path.resolve(PLUGIN_ROOT, "../contracts/guild-stack/v2");
const A02_PRESENT = fs.existsSync(path.join(A02_ROOT, "contract-bundle.json"));

interface VendoredCase {
  id: string;
  origin: "cases" | "regressions";
  schema: R01SchemaName;
  valid: boolean;
  expected_errors: string[];
  instance: Record<string, unknown>;
}
const vendored = JSON.parse(fs.readFileSync(VENDORED, "utf8")) as {
  source: { bundle_sha256: string; cases_sha256: string; regressions_sha256: string };
  schemas: R01SchemaName[];
  cases: VendoredCase[];
};

const H = (c: string) => `sha256:${c.repeat(64)}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const base = (schema: R01SchemaName) =>
  clone(vendored.cases.find((c) => c.schema === schema && c.id === `${schema}-valid`)!.instance) as any;

const RUN_V2 = "run-20261026-000000-demo";
const RUN_V2_B = "run-20261026-000001-second";
const RUN_V1 = "run-20260730-131020-legacy";
const STACK_SESSION = "stack-session-1";

let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-identity-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function logicalRun(runId: string, extra: Record<string, unknown> = {}) {
  const m = base("logical-run");
  m.run_id = runId;
  m.initial_prompt_ref = null;
  m.execution_refs = [];
  return { ...m, ...extra };
}
function segment(runId: string, executionId: string, host = "codex", hostSession = `host-session-${executionId}`) {
  const s = base("execution-segment");
  s.lineage.run_id = runId;
  s.lineage.execution_id = executionId;
  s.lineage.host_session_id = hostSession;
  s.host_session_id = hostSession;
  s.original_host_id = host;
  s.admission = "active";
  s.interval.end = null;
  s.interval.duration_ms = null;
  s.seal_evidence = null;
  return s;
}
function assignment(runId: string, executionId: string, attemptId: string, opts: { host?: string; goals?: unknown[]; task?: string } = {}) {
  const a = base("task-assignment");
  Object.assign(a.lineage, {
    run_id: runId,
    execution_id: executionId,
    host_session_id: `host-session-${executionId}`,
    logical_task_id: opts.task ?? "task-1",
    attempt_id: attemptId,
    agent_instance_id: `agent-${attemptId}`,
  });
  a.original_host_id = opts.host ?? "codex";
  a.goal_contributions = opts.goals ?? [];
  a.input_refs = [];
  return a;
}
/** An attempt whose assignment_ref names the persisted assignment (if any) byte for byte. */
function attempt(runId: string, executionId: string, attemptId: string, task = "task-1") {
  const t = base("task-attempt");
  Object.assign(t.lineage, {
    run_id: runId,
    execution_id: executionId,
    host_session_id: `host-session-${executionId}`,
    logical_task_id: task,
    attempt_id: attemptId,
    agent_instance_id: `agent-${attemptId}`,
  });
  const file = path.join(root, ".guild", assignmentEvidencePath(runId, attemptId));
  t.assignment_ref = {
    ...t.assignment_ref,
    path: assignmentEvidencePath(runId, attemptId),
    sha256: fs.existsSync(file) ? recordRevision(fs.readFileSync(file, "utf8")) : H("0"),
    schema_version: "guild.task_assignment.v3",
  };
  return t;
}
const goal = (id: string) => ({ source_id: "source-a", kind: "goal", id, revision: H("b") });

function v1Run(runId = RUN_V1): { bindingBytes: string; sessionBytes: string } {
  mintRunBinding({ root, run_id: runId });
  const runDir = path.join(root, ".guild", "runs", runId);
  const bound = bindSession({
    runDir,
    runId,
    detected: {
      host_family: "claude",
      surface: "claude",
      model_family: "anthropic",
      evidence: { cheap: "advertised", mid: "advertised", powerful: "advertised" },
      signal: "CLAUDECODE",
    },
    promptCompose: { dialect_id: "anthropic", overlay_ids: [], hash: H("f") },
    now: () => new Date("2026-07-30T13:10:20Z"),
  });
  expect(bound.ok).toBe(true);
  return {
    bindingBytes: fs.readFileSync(runBindingPath(root, runId), "utf8"),
    sessionBytes: fs.readFileSync(sessionBindingPath(runDir), "utf8"),
  };
}

function refusal(fn: () => unknown): { code: string; message: string } {
  try {
    fn();
  } catch (error) {
    if (error instanceof ExecutionIdentityRefusal) return { code: error.code, message: error.message };
    throw error;
  }
  return { code: "no-refusal", message: "" };
}
const code = (fn: () => unknown) => refusal(fn).code;

// ── Contract parity ──────────────────────────────────────────────────────────

describe("R01 validators match the frozen A02 contracts", () => {
  it("vendored subset equals the frozen A02 fixtures (mandatory when R01_REQUIRE_A02=1)", () => {
    if (!A02_PRESENT) {
      expect(process.env["R01_REQUIRE_A02"]).not.toBe("1");
      expect(vendored.source.bundle_sha256).toMatch(/^sha256:[a-f0-9]{64}$/);
      return;
    }
    const sha = (p: string) => `sha256:${crypto.createHash("sha256").update(fs.readFileSync(path.join(A02_ROOT, p))).digest("hex")}`;
    expect(sha("contract-bundle.json")).toBe(vendored.source.bundle_sha256);
    expect(sha("fixtures/cases.json")).toBe(vendored.source.cases_sha256);
    expect(sha("fixtures/regressions.json")).toBe(vendored.source.regressions_sha256);
    const cases = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures/cases.json"), "utf8")) as any[];
    const regs = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "fixtures/regressions.json"), "utf8")).cases as any[];
    const derived = [
      ...cases.filter((c) => vendored.schemas.includes(c.schema)).map((c) => ({ id: c.id, origin: "cases", schema: c.schema, valid: c.valid, expected_errors: [], instance: c.instance })),
      ...regs.filter((c) => vendored.schemas.includes(c.schema)).map((c) => ({ id: c.id, origin: "regressions", schema: c.schema, valid: c.expected_valid, expected_errors: c.expected_errors, instance: c.instance })),
    ];
    expect(vendored.cases).toEqual(derived as VendoredCase[]);
  });

  it("structural validation agrees with the frozen JSON schemas over a mutation corpus", () => {
    if (!A02_PRESENT) {
      expect(process.env["R01_REQUIRE_A02"]).not.toBe("1");
      return;
    }
    const req = createRequire(path.join(PLUGIN_ROOT, "scripts", "package.json"));
    const Ajv2020 = req("ajv/dist/2020").default;
    const addFormats = req("ajv-formats").default;
    const ajv = new Ajv2020({ strict: false, allErrors: false });
    addFormats(ajv);
    const dir = path.join(A02_ROOT, "schemas");
    for (const f of fs.readdirSync(dir)) ajv.addSchema(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    const emoji = "😀".repeat(3000);
    const leafValues: unknown[] = [null, 7, 1.5, -1, true, "", "x", emoji, "2026-02-30T00:00:00Z", "2026-10-26T25:00:00Z", H("a"), "../up", "run-1", [], {}];
    const mutate = (instance: unknown): unknown[] => {
      const out: unknown[] = [];
      const visit = (node: any, set: (v: unknown) => void, del: (() => void) | null) => {
        for (const v of leafValues) { set(v); out.push(clone(instance)); }
        if (del) { del(); out.push(clone(instance)); }
        set(node);
        if (Array.isArray(node)) node.forEach((x, i) => visit(x, (v) => { node[i] = v; }, null));
        else if (node && typeof node === "object") {
          for (const extra of ["zz_unknown", "constructor", "toString"]) { node[extra] = 1; out.push(clone(instance)); delete node[extra]; }
          for (const k of Object.keys(node)) {
            const keep = node[k];
            visit(keep, (v) => { node[k] = v; }, () => { delete node[k]; });
            node[k] = keep;
          }
        }
      };
      const doc = instance as any;
      for (const k of Object.keys(doc)) {
        const keep = doc[k];
        visit(keep, (v) => { doc[k] = v; }, () => { delete doc[k]; });
        doc[k] = keep;
      }
      return out;
    };
    const mismatches: string[] = [];
    let compared = 0;
    for (const c of vendored.cases.filter((x) => x.origin === "cases")) {
      const validate = ajv.getSchema(`https://guildstack.dev/contracts/guild-stack/v2/${c.schema}.schema.json`);
      expect(validate).toBeDefined();
      for (const m of [clone(c.instance), ...mutate(clone(c.instance))]) {
        compared++;
        // JSON round trip: the corpus is JSON, as every persisted record is.
        const value = JSON.parse(JSON.stringify(m));
        const expected = validate(value) === true;
        const actual = validateExecutionIdentityShape(c.schema, value).ok;
        if (expected !== actual) mismatches.push(`${c.id}: ajv=${expected} r01=${actual} ${JSON.stringify(value).slice(0, 160)}`);
      }
    }
    expect(compared).toBeGreaterThan(1000);
    expect(mismatches).toEqual([]);
  });

  it("covers all six R01 schemas with both valid and invalid cases", () => {
    for (const schema of vendored.schemas) {
      expect(vendored.cases.some((c) => c.schema === schema && c.valid)).toBe(true);
      expect(vendored.cases.some((c) => c.schema === schema && !c.valid)).toBe(true);
    }
  });

  for (const c of vendored.cases) {
    it(`${c.origin}:${c.id} → ${c.valid ? "valid" : "invalid"}`, () => {
      const verdict = validateExecutionIdentityRecord(c.schema, c.instance);
      expect(verdict.ok).toBe(c.valid);
      if (!verdict.ok) for (const e of c.expected_errors) expect(verdict.errors).toContain(e);
    });
  }

  it("mirrors the shared verify_contracts walk rules", () => {
    const errorsOf = (schema: R01SchemaName, v: unknown) => {
      const r = validateExecutionIdentityRecord(schema, v);
      return r.ok ? [] : r.errors;
    };
    const t = base("task-attempt");
    t.state = { ...t.state, outcome: "succeeded", acceptance: "pending" };
    expect(errorsOf("task-attempt", t)).toContain("success requires verified acceptance");
    const run = base("logical-run");
    run.state = { ...run.state, lifecycle: "closed", outcome: "pending" };
    expect(errorsOf("logical-run", run)).toContain("closed cannot have pending/unknown outcome");
    const s = base("execution-segment");
    s.interval = { ...s.interval, end: "2026-10-25T00:00:00Z" };
    expect(errorsOf("execution-segment", s)).toContain("interval cannot end before start");
    const u = base("execution-segment");
    u.interval.clock.basis = "unknown";
    expect(errorsOf("execution-segment", u)).toContain("unknown clock cannot claim duration");
    const l = clone(vendored.cases.find((c) => c.id === "execution-lineage-valid")!.instance) as any;
    l.lineage.attempt_id = "attempt-1";
    l.authority.attempt_id = "attempt-1";
    expect(errorsOf("execution-lineage", l)).toContain("attempt requires logical task");
    const o = clone(vendored.cases.find((c) => c.id === "execution-lineage-valid")!.instance) as any;
    o.observed_identity = { provider: "p", model: null, status: "observed", reason: null };
    expect(errorsOf("execution-lineage", o)).toContain("observed identity needs observed model");
    o.observed_identity = { provider: "p", model: "m", status: "unavailable", reason: null };
    expect(errorsOf("execution-lineage", o)).toContain("unavailable observed identity needs null model and reason");
  });

  it("matches JSON Schema on own properties, calendar dates and code-point lengths", () => {
    const s = base("execution-segment");
    expect(validateExecutionIdentityShape("execution-segment", JSON.parse(JSON.stringify(s).replace("{", '{"constructor":1,'))).ok).toBe(false);
    expect(validateExecutionIdentityShape("execution-segment", { ...s, interval: { ...s.interval, start: "2026-02-30T00:00:00Z" } }).ok).toBe(false);
    expect(validateExecutionIdentityShape("execution-segment", { ...s, interval: { ...s.interval, start: "2024-02-29T00:00:00+05:30" } }).ok).toBe(true);
    const run = base("logical-run");
    expect(validateExecutionIdentityShape("logical-run", { ...run, initial_command: "😀".repeat(3000) }).ok).toBe(true);
    expect(validateExecutionIdentityShape("logical-run", { ...run, initial_command: "😀".repeat(4097) }).ok).toBe(false);
    expect(validateExecutionIdentityShape("execution-segment", { ...s, admission: "paused" }).ok).toBe(false);
    expect(validateExecutionIdentityShape("execution-segment", { ...s, seal_evidence: { ...s.seal_evidence, path: "../escape.json" } }).ok).toBe(false);
    expect(validateExecutionIdentityShape("logical-run", { ...run, controller: { ...run.controller, failover: "automatic" } }).ok).toBe(false);
  });
});

// ── AT08 ─────────────────────────────────────────────────────────────────────

describe("AT08 · identity migration", () => {
  it("leaves the v1 open run host-bound and byte-identical while v2 runs own multiple immutable executions", () => {
    const before = v1Run();
    createLogicalRun(root, logicalRun(RUN_V2, { parent_run: { source_id: "source-a", kind: "run", id: RUN_V1, revision: H("c") } }));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1", "codex"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2, "exec-2", "claude"), { stack_session_id: STACK_SESSION });

    const view = readLogicalRunView(root, RUN_V2);
    expect(view.kind).toBe("v2");
    if (view.kind !== "v2") throw new Error("unreachable");
    expect(view.executions.map((e) => e.segment.lineage.execution_id)).toEqual(["exec-1", "exec-2"]);
    expect(view.execution_refs.every((r) => r.kind === "execution" && /^sha256:[a-f0-9]{64}$/.test(r.revision))).toBe(true);
    expect(view.manifest.parent_run?.id).toBe(RUN_V1);

    const v1 = readLogicalRunView(root, RUN_V1);
    expect(v1.kind).toBe("v1");
    if (v1.kind !== "v1") throw new Error("unreachable");
    expect(v1.binding.state).toBe("open");
    expect(v1.session?.host_family).toBe("claude");
    expect(fs.readFileSync(runBindingPath(root, RUN_V1), "utf8")).toBe(before.bindingBytes);
    expect(fs.readFileSync(sessionBindingPath(path.join(root, ".guild", "runs", RUN_V1)), "utf8")).toBe(before.sessionBytes);
    expect(loadRunBinding({ root, run_id: RUN_V1 })?.schema_version).toBe("guild.run_binding.v1");
  });

  it("refuses to graft a v2 logical run or execution onto a v1 host-bound run", () => {
    const before = v1Run();
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V1)))).toBe("v1_run_host_bound");
    expect(code(() => recordExecutionSegment(root, segment(RUN_V1, "exec-1"), { stack_session_id: STACK_SESSION }))).toBe("v1_run_host_bound");
    expect(fs.readFileSync(runBindingPath(root, RUN_V1), "utf8")).toBe(before.bindingBytes);
    expect(fs.existsSync(path.join(root, ".guild", "runs", RUN_V1, "lineage"))).toBe(false);
  });

  it("v1 writers refuse a v2 run, and a mixed layout refuses on read", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    expect(readRunKind(path.join(root, ".guild", "runs", RUN_V2))).toBe("v2");
    expect(() => mintRunBinding({ root, run_id: RUN_V2 })).toThrow(/already a v2 run/);
    expect(fs.existsSync(runBindingPath(root, RUN_V2))).toBe(false);
    const runDir = path.join(root, ".guild", "runs", RUN_V2);
    expect(() => bindSession({
      runDir, runId: RUN_V2,
      detected: { host_family: "codex", surface: "codex", model_family: "openai", evidence: { cheap: "advertised", mid: "advertised", powerful: "advertised" }, signal: "CODEX_HOME" },
      promptCompose: { dialect_id: "openai", overlay_ids: [], hash: H("f") },
    })).toThrow(/already a v2 run/);
    expect(fs.existsSync(sessionBindingPath(runDir))).toBe(false);
    expect(readLogicalRunView(root, RUN_V2).kind).toBe("v2");
    // A layout that an older writer mixed anyway is refused, never read as v1.
    fs.writeFileSync(runBindingPath(root, RUN_V2), JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: RUN_V2, binding_ref: "rb-00", state: "open" }));
    expect(code(() => readLogicalRunView(root, RUN_V2))).toBe("run_layout_mixed");
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V2)))).toBe("v1_run_host_bound");
    // A v1 run claims its kind, so a later v2 claim on it refuses without writing.
    v1Run();
    expect(readRunKind(path.join(root, ".guild", "runs", RUN_V1))).toBe("v1");
    fs.rmSync(runBindingPath(root, RUN_V1));
    fs.rmSync(sessionBindingPath(path.join(root, ".guild", "runs", RUN_V1)));
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V1)))).toBe("v1_run_host_bound");
    expect(fs.existsSync(path.join(root, ".guild", "runs", RUN_V1, "lineage"))).toBe(false);
  });

  it("v1 writers behind an injected fs seam still refuse a v2 run", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    const diskFs = {
      mkdirp: (p: string) => fs.mkdirSync(p, { recursive: true }),
      writeFile: (p: string, c: string) => fs.writeFileSync(p, c),
      readFile: (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null),
      exists: (p: string) => fs.existsSync(p),
    };
    expect(() => mintRunBinding({ root, run_id: RUN_V2, fs: diskFs })).toThrow(/already a v2 run/);
    expect(fs.existsSync(runBindingPath(root, RUN_V2))).toBe(false);
    const runDir = path.join(root, ".guild", "runs", RUN_V2);
    expect(() => bindSessionForRun({ runDir, runId: RUN_V2, env: { GUILD_HOST_FAMILY: "codex" }, fs: { exists: diskFs.exists, readFile: diskFs.readFile, writeFile: diskFs.writeFile } })).toThrow(/already a v2 run/);
    expect(fs.existsSync(sessionBindingPath(runDir))).toBe(false);
    // A v1 binding planted inside a v2 run reads as malformed (closed), never open.
    fs.writeFileSync(runBindingPath(root, RUN_V2), JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: RUN_V2, binding_ref: "rb-00", state: "open" }));
    expect(loadRunBinding({ root, run_id: RUN_V2 })).toBeNull();
  });

  it("refuses to claim or write through a symlinked run directory", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-outside-")));
    try {
      fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
      fs.symlinkSync(outside, path.join(root, ".guild", "runs", RUN_V2));
      expect(code(() => createLogicalRun(root, logicalRun(RUN_V2)))).toBe("v1_run_host_bound");
      expect(fs.readdirSync(outside)).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("withdraws a record linked through an ancestor swapped just before link(2)", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-outside-")));
    const dir = path.join(root, ".guild", "runs", RUN_V2, "lineage", "executions");
    fs.mkdirSync(dir, { recursive: true });
    const realLink = fs.linkSync;
    const spy = spyOn(fs, "linkSync").mockImplementation(((a: string, b: string) => {
      // Move the prepared dir (with its temp file) outside and leave a symlink behind.
      fs.renameSync(dir, path.join(outside, "executions"));
      fs.symlinkSync(path.join(outside, "executions"), dir);
      return realLink(a, b);
    }) as any);
    try {
      expect(code(() => recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION }))).toBe("record_invalid");
      expect(fs.readdirSync(path.join(outside, "executions")).filter((f) => f.endsWith(".json"))).toEqual([]);
    } finally {
      spy.mockRestore();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("validates and publishes one JSON snapshot, so toJSON cannot smuggle a secret past the checks", () => {
    const clean = logicalRun(RUN_V2);
    const dirty = { ...clean, initial_command: "/guild:build Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD" };
    Object.defineProperty(clean, "toJSON", { value: () => dirty, enumerable: false });
    expect(code(() => createLogicalRun(root, clean as any))).toBe("record_contains_secret");
    expect(fs.existsSync(path.join(root, ".guild", "runs", RUN_V2, "lineage"))).toBe(false);
  });

  it("refuses a read view whose attempt was reparented on disk to another execution", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-a"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2, "exec-b"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-a", "attempt-1"));
    recordTaskAttempt(root, attempt(RUN_V2, "exec-a", "attempt-1"));
    expect(readLogicalRunView(root, RUN_V2).kind).toBe("v2");
    const file = path.join(root, ".guild", "runs", RUN_V2, "lineage", "attempts", "attempt-1.json");
    const t = JSON.parse(fs.readFileSync(file, "utf8"));
    t.lineage.execution_id = "exec-b";
    t.lineage.host_session_id = "host-session-exec-b";
    fs.rmSync(file);
    fs.writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);
    expect(code(() => readLogicalRunView(root, RUN_V2))).toBe("attempt_reparent_refused");
  });

  it("a seam bind never overwrites an unreadable or reserved-field binding, and never resumes inside a v2 run", () => {
    v1Run();
    const runDir = path.join(root, ".guild", "runs", RUN_V1);
    const seamFs = { exists: (p: string) => fs.existsSync(p), readFile: (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), writeFile: (p: string, c: string) => fs.writeFileSync(p, c) };
    const planted = `${JSON.stringify({ ...JSON.parse(fs.readFileSync(sessionBindingPath(runDir), "utf8")), execution_id: "exec-1" })}\n`;
    fs.writeFileSync(sessionBindingPath(runDir), planted);
    const r = bindSessionForRun({ runDir, runId: RUN_V1, env: { GUILD_HOST_FAMILY: "codex" }, fs: seamFs });
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(sessionBindingPath(runDir), "utf8")).toBe(planted);
    const noRead = bindSessionForRun({ runDir, runId: RUN_V1, env: { GUILD_HOST_FAMILY: "codex" }, fs: { exists: seamFs.exists, writeFile: seamFs.writeFile } });
    expect(noRead.ok).toBe(false);
    expect(fs.readFileSync(sessionBindingPath(runDir), "utf8")).toBe(planted);
    createLogicalRun(root, logicalRun(RUN_V2));
    const v2Dir = path.join(root, ".guild", "runs", RUN_V2);
    fs.writeFileSync(sessionBindingPath(v2Dir), fs.readFileSync(sessionBindingPath(runDir), "utf8").replace(/,\s*"execution_id": "exec-1"/, ""));
    expect(() => bindSessionForRun({ runDir: v2Dir, runId: RUN_V2, env: { GUILD_HOST_FAMILY: "claude" }, fs: seamFs })).toThrow(/already a v2 run/);
  });

  it("claimRunKind withdraws a marker linked through an ancestor swapped inside link(2)", () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-outside-")));
    const runDir = path.join(root, ".guild", "runs", RUN_V2);
    fs.mkdirSync(runDir, { recursive: true });
    const realLink = fs.linkSync;
    const spy = spyOn(fs, "linkSync").mockImplementation(((a: string, b: string) => {
      fs.renameSync(runDir, path.join(outside, RUN_V2));
      fs.symlinkSync(path.join(outside, RUN_V2), runDir);
      return realLink(a, b);
    }) as any);
    try {
      expect(() => claimRunKind(runDir, "v2")).toThrow(/uncontained/);
      expect(fs.readdirSync(path.join(outside, RUN_V2)).filter((f) => f === "run-kind.json")).toEqual([]);
    } finally {
      spy.mockRestore();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("refuses a read redirected by an ancestor swapped between the containment check and open", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1", "codex"), { stack_session_id: STACK_SESSION });
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-outside-")));
    const dir = path.join(root, ".guild", "runs", RUN_V2, "lineage", "executions");
    const forged = segment(RUN_V2, "exec-1", "claude");
    fs.mkdirSync(path.join(outside, "executions"));
    fs.writeFileSync(path.join(outside, "executions", "exec-1.json"), `${JSON.stringify(forged, null, 2)}\n`);
    const realOpen = fs.openSync;
    let swapped = false;
    const spy = spyOn(fs, "openSync").mockImplementation(((p: any, flags: any, mode?: any) => {
      if (!swapped && typeof p === "string" && p.endsWith(path.join("executions", "exec-1.json")) && flags === (fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)) {
        swapped = true;
        fs.renameSync(dir, `${dir}-moved`);
        fs.symlinkSync(path.join(outside, "executions"), dir);
      }
      return realOpen(p, flags, mode);
    }) as any);
    try {
      expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1", { host: "claude" })))).toBe("record_invalid");
    } finally {
      spy.mockRestore();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("goal contributions apply the same ownership joins as the read view", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-original"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-original", "attempt-1", { goals: [goal("goal-1")] }));
    const file = path.join(root, ".guild", "runs", RUN_V2, "lineage", "assignments", "attempt-1.json");
    const a = JSON.parse(fs.readFileSync(file, "utf8"));
    a.lineage.execution_id = "exec-reparented";
    a.lineage.host_session_id = "host-session-exec-reparented";
    fs.rmSync(file);
    fs.writeFileSync(file, `${JSON.stringify(a, null, 2)}\n`);
    expect(code(() => listGoalContributions(root, "source-a", "goal-1"))).toBe("attempt_reparent_refused");
  });

  it("refuses a record whose contents name a different identity than its path", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2, "exec-2"), { stack_session_id: STACK_SESSION });
    const dir = path.join(root, ".guild", "runs", RUN_V2, "lineage", "executions");
    fs.rmSync(path.join(dir, "exec-1.json"));
    fs.copyFileSync(path.join(dir, "exec-2.json"), path.join(dir, "exec-1.json"));
    expect(code(() => readLogicalRunView(root, RUN_V2))).toBe("record_location_mismatch");
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1")))).toBe("record_location_mismatch");
  });

  it("refuses an interval that ends before it starts at microsecond precision", () => {
    const s = base("execution-segment");
    s.interval = { ...s.interval, start: "2026-10-26T00:00:00.000900Z", end: "2026-10-26T00:00:00.000100Z", duration_ms: 0 };
    const v = validateExecutionIdentityRecord("execution-segment", s);
    expect(v.ok ? [] : v.errors).toContain("interval cannot end before start");
    s.interval = { ...s.interval, start: "2026-10-26T00:00:00.000100Z", end: "2026-10-26T00:00:00.0001Z" };
    expect(validateExecutionIdentityRecord("execution-segment", s).ok).toBe(true);
    s.interval = { ...s.interval, start: "2026-10-26T01:00:00+01:00", end: "2026-10-26T00:00:00Z" };
    expect(validateExecutionIdentityRecord("execution-segment", s).ok).toBe(true);
  });

  it("refuses a sparse array instead of persisting it as null", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const a = assignment(RUN_V2, "exec-1", "attempt-1");
    a.goal_contributions = new Array(1);
    expect(code(() => recordTaskAssignment(root, a))).toBe("record_invalid");
  });

  it("writes the whole record even when the kernel accepts short writes", () => {
    const real = fs.writeSync;
    const spy = spyOn(fs, "writeSync").mockImplementation(((fd: number, buf: any, off?: any, len?: any) =>
      typeof buf === "string" ? real(fd, buf) : real(fd, buf, off ?? 0, Math.min(len ?? buf.length, 7))) as any);
    try {
      createLogicalRun(root, logicalRun(RUN_V2));
    } finally {
      spy.mockRestore();
    }
    expect(readLogicalRunView(root, RUN_V2).kind).toBe("v2");
  });

  it("refuses publication when the parent directory is swapped for a link outside the root", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r01-outside-")));
    const dir = path.join(root, ".guild", "runs", RUN_V2, "lineage", "executions");
    fs.mkdirSync(dir, { recursive: true });
    const real = fs.fsyncSync;
    let swapped = false;
    const spy = spyOn(fs, "fsyncSync").mockImplementation(((fd: number) => {
      real(fd);
      if (!swapped) { swapped = true; fs.renameSync(dir, `${dir}-moved`); fs.symlinkSync(outside, dir); }
    }) as any);
    try {
      expect(code(() => recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION }))).toBe("record_invalid");
      expect(fs.readdirSync(outside).filter((f) => f.endsWith(".json"))).toEqual([]);
    } finally {
      spy.mockRestore();
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("keeps every record immutable: an identical replay is a no-op, a changed record refuses", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V2, { phase: "qa" })))).toBe("record_immutable");
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V2)))).toBe("no-refusal");
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const changed = segment(RUN_V2, "exec-1");
    changed.issued_controller_epoch = 2;
    expect(code(() => recordExecutionSegment(root, changed, { stack_session_id: STACK_SESSION }))).toBe("record_immutable");
    expect(code(() => createLogicalRun(root, logicalRun(RUN_V2_B, { execution_refs: [{ source_id: "source-a", kind: "execution", id: "exec-9", revision: H("a") }] })))).toBe("manifest_refs_are_derived");
  });

  it("publishes atomically: a crashed writer's temp file is ignored and never blocks replay", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    const dir = path.join(root, ".guild", "runs", RUN_V2, "lineage", "executions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".exec-1.json.999.deadbeef.tmp"), '{"schema_version":"guild.execu');
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const view = readLogicalRunView(root, RUN_V2);
    if (view.kind !== "v2") throw new Error("unreachable");
    expect(view.executions.map((e) => e.segment.lineage.execution_id)).toEqual(["exec-1"]);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp") && !f.includes("deadbeef"))).toEqual([]);
  });

  it("lets concurrent identical writers all succeed and a concurrent different writer refuse", async () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    const script = path.join(root, "writer.ts");
    fs.writeFileSync(script, [
      `import { recordExecutionSegment } from ${JSON.stringify(path.join(__dirname, "execution-identity.ts"))};`,
      `const seg = JSON.parse(process.argv[3]!);`,
      `try { recordExecutionSegment(process.argv[2]!, seg, { stack_session_id: "stack-session-1" }); console.log("ok"); }`,
      `catch (e: any) { console.log(e.code ?? String(e)); }`,
    ].join("\n"));
    const same = JSON.stringify(segment(RUN_V2, "exec-race"));
    const other = segment(RUN_V2, "exec-race");
    other.issued_controller_epoch = 9;
    const procs = [same, same, same, JSON.stringify(other)].map((arg) =>
      Bun.spawn([Bun.which("bun") ?? "bun", script, root, arg], { cwd: PLUGIN_ROOT, stdout: "pipe", stderr: "pipe" }));
    const outs = await Promise.all(procs.map(async (p) => (await new Response(p.stdout).text()).trim()));
    const view = readLogicalRunView(root, RUN_V2);
    if (view.kind !== "v2") throw new Error("unreachable");
    const winner = view.executions[0]!.segment.issued_controller_epoch;
    // Exactly one byte form wins; every writer of that form reports ok, the others refuse.
    const expectedOk = winner === 9 ? [false, false, false, true] : [true, true, true, false];
    expect(outs.map((o) => o === "ok")).toEqual(expectedOk);
    expect(outs.filter((o) => o !== "ok").every((o) => o === "record_immutable")).toBe(true);
  });

  it("binds each task attempt to exactly one run and execution", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1"));
    recordTaskAttempt(root, attempt(RUN_V2, "exec-1", "attempt-1"));
    const view = readLogicalRunView(root, RUN_V2);
    if (view.kind !== "v2") throw new Error("unreachable");
    expect(view.attempts.map((a) => [a.lineage.attempt_id, a.lineage.execution_id])).toEqual([["attempt-1", "exec-1"]]);
    expect(code(() => recordTaskAttempt(root, attempt(RUN_V2, "exec-1", "attempt-orphan")))).toBe("attempt_unassigned");
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-missing", "attempt-2")))).toBe("execution_unknown");
  });

  it("refuses an attempt that does not match its persisted assignment", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1"));
    const session = attempt(RUN_V2, "exec-1", "attempt-1");
    session.lineage.host_session_id = "host-session-other";
    expect(code(() => recordTaskAttempt(root, session))).toBe("attempt_assignment_mismatch");
    const agent = attempt(RUN_V2, "exec-1", "attempt-1");
    agent.lineage.agent_instance_id = "agent-other";
    expect(code(() => recordTaskAttempt(root, agent))).toBe("attempt_assignment_mismatch");
    const ref = attempt(RUN_V2, "exec-1", "attempt-1");
    ref.assignment_ref.sha256 = H("9");
    expect(code(() => recordTaskAttempt(root, ref))).toBe("attempt_assignment_mismatch");
    const elsewhere = attempt(RUN_V2, "exec-1", "attempt-1");
    elsewhere.assignment_ref.path = "runs/run-20261026-000000-demo/evidence.json";
    expect(code(() => recordTaskAttempt(root, elsewhere))).toBe("attempt_assignment_mismatch");
  });

  it("treats an owner reservation without a published assignment as unassigned, and lets the assignment be retried", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const idx = path.join(root, ".guild", "runs", "_lineage-index", "attempts");
    fs.mkdirSync(idx, { recursive: true });
    // An interrupted recordTaskAssignment: reservation written, assignment never published.
    fs.writeFileSync(path.join(idx, "attempt-1.json"), `${JSON.stringify({ source_id: "source-a", run_id: RUN_V2, execution_id: "exec-1", logical_task_id: "task-1" }, null, 2)}\n`);
    expect(code(() => recordTaskAttempt(root, attempt(RUN_V2, "exec-1", "attempt-1")))).toBe("attempt_unassigned");
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1"));
    expect(code(() => recordTaskAttempt(root, attempt(RUN_V2, "exec-1", "attempt-1")))).toBe("no-refusal");
  });

  it("negative control: reparenting an attempt to another execution, run or task refuses", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    createLogicalRun(root, logicalRun(RUN_V2_B));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2, "exec-2"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2_B, "exec-1"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1"));
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-2", "attempt-1")))).toBe("attempt_reparent_refused");
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2_B, "exec-1", "attempt-1")))).toBe("attempt_reparent_refused");
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1", { task: "task-other" })))).toBe("attempt_reparent_refused");
    expect(code(() => recordTaskAttempt(root, attempt(RUN_V2, "exec-2", "attempt-1")))).toBe("attempt_reparent_refused");
    expect(code(() => recordTaskAttempt(root, attempt(RUN_V2, "exec-1", "attempt-1", "task-other")))).toBe("attempt_reparent_refused");
  });

  it("negative control: an assignment naming a different original host than its execution refuses", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1", "codex"), { stack_session_id: STACK_SESSION });
    expect(code(() => recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1", { host: "claude" })))).toBe("original_host_changed");
    expect(fs.existsSync(path.join(root, ".guild", "runs", "_lineage-index", "attempts", "attempt-1.json"))).toBe(false);
  });

  it("lets one goal collect contributions across logical runs", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    createLogicalRun(root, logicalRun(RUN_V2_B));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordExecutionSegment(root, segment(RUN_V2_B, "exec-1"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-a", { goals: [goal("goal-1")] }));
    recordTaskAssignment(root, assignment(RUN_V2_B, "exec-1", "attempt-b", { goals: [goal("goal-1"), goal("goal-2")] }));
    const contributions = listGoalContributions(root, "source-a", "goal-1");
    expect(contributions.map((c) => [c.run_id, c.attempt_id])).toEqual([[RUN_V2, "attempt-a"], [RUN_V2_B, "attempt-b"]]);
    const view = readLogicalRunView(root, RUN_V2_B);
    if (view.kind !== "v2") throw new Error("unreachable");
    expect(view.goal_refs.map((g) => g.id)).toEqual(["goal-1", "goal-2"]);
  });

  it("refuses an invalid record before anything reaches disk", () => {
    expect(code(() => createLogicalRun(root, { ...logicalRun(RUN_V2), extra: true } as any))).toBe("record_invalid");
    expect(fs.existsSync(path.join(root, ".guild", "runs", RUN_V2))).toBe(false);
  });

  it("refuses a record holding a secret without writing it or echoing it", () => {
    const secret = "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCD";
    const r = refusal(() => createLogicalRun(root, logicalRun(RUN_V2, { initial_command: `/guild:build ${secret}` })));
    expect(r.code).toBe("record_contains_secret");
    expect(r.message).not.toContain("sk-ant");
    expect(fs.existsSync(path.join(root, ".guild", "runs", RUN_V2))).toBe(false);
    createLogicalRun(root, logicalRun(RUN_V2));
    const s = segment(RUN_V2, "exec-1");
    s.seal_evidence = { ...base("execution-segment").seal_evidence, reason: `token=${"ghp_" + "a".repeat(36)}` };
    expect(code(() => recordExecutionSegment(root, s, { stack_session_id: STACK_SESSION }))).toBe("record_contains_secret");
  });
});

// ── AT09 ─────────────────────────────────────────────────────────────────────

describe("AT09 · binding integration", () => {
  const FULL = {
    lifecycle_binding: ["guild.run_binding.v1", "guild.run_binding.v2"],
    session: ["guild.session_binding.v1", "guild.execution_segment.v1"],
    assignment: ["guild.task_assignment.v2", "guild.task_assignment.v3"],
    attempt: ["guild.task_attempt.v1"],
    receipt: ["guild.stack.execution-lineage.v1"],
    adapter: ["guild.adapter_capability.v1"],
  };

  function binding() {
    const b = base("run-binding");
    b.run_id = RUN_V2;
    const view = readLogicalRunView(root, RUN_V2);
    if (view.kind === "v2") b.logical_run_manifest_hash = view.manifest_revision;
    return b;
  }
  function lineage(executionId = "exec-1", attemptId: string | null = null) {
    const l = clone(vendored.cases.find((c) => c.id === "execution-lineage-valid")!.instance) as any;
    Object.assign(l.lineage, {
      run_id: RUN_V2, execution_id: executionId, host_session_id: `host-session-${executionId}`,
      attempt_id: attemptId, logical_task_id: attemptId === null ? null : "task-1", agent_instance_id: attemptId === null ? null : `agent-${attemptId}`,
    });
    if (attemptId !== null) l.attempt_grant_ref = "grant-1";
    Object.assign(l.authority, { execution_id: executionId, attempt_id: attemptId });
    return l;
  }
  function setup() {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    recordTaskAssignment(root, assignment(RUN_V2, "exec-1", "attempt-1"));
  }
  const reasonsOf = (v: ReturnType<typeof admitExecutionIdentity>) => (v.ok ? [] : v.reasons);

  it("names every component of the joint capability", () => {
    expect(Object.keys(EXECUTION_IDENTITY_CAPABILITY.components).sort()).toEqual(Object.keys(FULL).sort());
  });

  it("accepts a supported identity end to end; host conversation stays distinct from the Stack session", () => {
    setup();
    const negotiation = negotiateExecutionIdentity(FULL);
    expect(negotiation.status).toBe("supported");
    for (const attemptId of [null, "attempt-1"]) {
      const admitted = admitExecutionIdentity({ root, negotiation, binding: binding(), lineage: lineage("exec-1", attemptId), stack_session_id: STACK_SESSION });
      expect(admitted).toEqual({ ok: true, run_id: RUN_V2, execution_id: "exec-1", attempt_id: attemptId, host_session_id: "host-session-exec-1", stack_session_id: STACK_SESSION });
    }
  });

  it("refuses a host session that reuses the Stack management session id", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    expect(code(() => recordExecutionSegment(root, segment(RUN_V2, "exec-1", "codex", STACK_SESSION), { stack_session_id: STACK_SESSION }))).toBe("host_session_is_stack_session");
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const verdict = admitExecutionIdentity({ root, negotiation: negotiateExecutionIdentity(FULL), binding: binding(), lineage: lineage(), stack_session_id: "host-session-exec-1" });
    expect(reasonsOf(verdict)).toContain("host_session_is_stack_session");
  });

  it("refuses the joint capability when any component is unsupported, and refuses a forged or wrong-version negotiation", () => {
    for (const component of Object.keys(FULL) as Array<keyof typeof FULL>) {
      const partial = { ...FULL, [component]: FULL[component].filter((v) => v !== (EXECUTION_IDENTITY_CAPABILITY.components as any)[component]) };
      const n = negotiateExecutionIdentity(partial);
      expect(n.status).toBe("refused");
      if (n.status === "refused") expect(n.missing).toEqual([component]);
    }
    setup();
    const v1Only = negotiateExecutionIdentity({ lifecycle_binding: ["guild.run_binding.v1"], session: ["guild.session_binding.v1"], assignment: ["guild.task_assignment.v2"] });
    expect(reasonsOf(admitExecutionIdentity({ root, negotiation: v1Only, binding: binding(), lineage: lineage(), stack_session_id: STACK_SESSION }))).toContain("capability_unsupported");
    for (const forged of [{ status: "supported", capability: "guild.execution_identity", version: 2 }, { status: "supported" }, { status: "supported", capability: "other", version: 1 }]) {
      expect(reasonsOf(admitExecutionIdentity({ root, negotiation: forged as any, binding: binding(), lineage: lineage(), stack_session_id: STACK_SESSION }))).toContain("capability_unsupported");
    }
  });

  it("negative control: a trace-only execution_id under an old v1 authority binding refuses", () => {
    v1Run();
    const v1Binding = loadRunBinding({ root, run_id: RUN_V1 })!;
    const l = lineage();
    l.lineage.run_id = RUN_V1;
    const verdict = admitExecutionIdentity({ root, negotiation: negotiateExecutionIdentity(FULL), binding: v1Binding as any, lineage: l, stack_session_id: STACK_SESSION });
    expect(reasonsOf(verdict)).toContain("v1_authority_cannot_carry_execution_identity");
  });

  it("joins binding, manifest, segment, assignment and receipt; every disagreement refuses", () => {
    setup();
    const negotiation = negotiateExecutionIdentity(FULL);
    const admit = (l: any, b: any = binding()) => reasonsOf(admitExecutionIdentity({ root, negotiation, binding: b, lineage: l, stack_session_id: STACK_SESSION }));
    const mut = (f: (l: any) => void, attemptId: string | null = null) => { const l = lineage("exec-1", attemptId); f(l); return l; };
    const bmut = (f: (b: any) => void) => { const b = binding(); f(b); return b; };

    expect(admit(lineage("exec-unrecorded"))).toContain("execution_unknown");
    expect(admit(mut((l) => { l.lineage.host_session_id = "host-session-other"; }))).toContain("host_session_mismatch");
    expect(admit(mut((l) => { l.requested_host = "claude"; }))).toContain("original_host_changed");
    expect(admit(mut((l) => { l.observed_host = "claude"; }))).toContain("original_host_changed");
    expect(admit(mut((l) => { l.adapter_capability_hash = H("d"); }))).toContain("adapter_capability_mismatch");
    expect(admit(mut((l) => { l.authority.writer_scope_hash = H("e"); }))).toContain("authority_mismatch");
    expect(admit(mut((l) => { l.authority.controller_epoch = 0; }))).toContain("stale_controller_epoch");
    expect(admit(mut((l) => { l.pins.policy = H("7"); }))).toContain("pins_mismatch");
    expect(admit(mut((l) => { l.pins.assignment = H("7"); }, "attempt-1"))).toContain("pins_mismatch");
    expect(admit(lineage(), bmut((b) => { b.run_id = RUN_V2_B; }))).toContain("binding_run_mismatch");
    expect(admit(lineage(), bmut((b) => { b.state = "sealed"; }))).toContain("binding_not_open");
    expect(admit(lineage(), bmut((b) => { b.logical_run_manifest_hash = H("6"); }))).toContain("binding_manifest_mismatch");
    expect(admit(lineage(), bmut((b) => { b.controller_host_id = "other-host"; }))).toContain("controller_mismatch");
    expect(admit(lineage("exec-1", "attempt-unassigned"))).toContain("attempt_unassigned");
    expect(admit(mut((l) => { l.lineage.logical_task_id = "task-other"; }, "attempt-1"))).toContain("attempt_reparent_refused");
    expect(admit(mut((l) => { l.lineage.agent_instance_id = "agent-other"; }, "attempt-1"))).toContain("attempt_assignment_mismatch");
    expect(admit(mut((l) => { l.attempt_grant_ref = "wrong-grant"; }, "attempt-1"))).toContain("attempt_grant_mismatch");
  });

  it("refuses an assignment issued after the authorizing controller epoch", () => {
    createLogicalRun(root, logicalRun(RUN_V2));
    recordExecutionSegment(root, segment(RUN_V2, "exec-1"), { stack_session_id: STACK_SESSION });
    const a = assignment(RUN_V2, "exec-1", "attempt-1");
    a.issued_controller_epoch = 999;
    recordTaskAssignment(root, a);
    const v = admitExecutionIdentity({ root, negotiation: negotiateExecutionIdentity(FULL), binding: binding(), lineage: lineage("exec-1", "attempt-1"), stack_session_id: STACK_SESSION });
    expect(reasonsOf(v)).toContain("stale_controller_epoch");
  });

  it("refuses admission on a mixed v1/v2 layout", () => {
    setup();
    fs.writeFileSync(runBindingPath(root, RUN_V2), JSON.stringify({ schema_version: "guild.run_binding.v1", run_id: RUN_V2, binding_ref: "rb-00", state: "open" }));
    const v = admitExecutionIdentity({ root, negotiation: negotiateExecutionIdentity(FULL), binding: { ...base("run-binding"), run_id: RUN_V2 }, lineage: lineage(), stack_session_id: STACK_SESSION });
    expect(reasonsOf(v)).toContain("run_layout_mixed");
  });
});

// ── v1 packages refuse reserved identity fields ──────────────────────────────

describe("v1 readers refuse reserved identity fields instead of silently ignoring them", () => {
  const taskCellAssignment = async () => {
    const { buildTaskCell } = await import("../dispatch");
    return buildTaskCell({
      runId: "run-g3", logicalTaskId: "lane-a", taskRunId: "lane-a.tr1", attempt: 1, attemptId: "lane-a.att1", instanceId: "lane-a.a1.i1",
      cellId: "cell-lane-a", goalId: "goal-demo", phaseId: "build", stepId: "lane-a", teamId: "demo", workerRole: "backend",
      specialistTypeId: "backend", specialistTypeVersion: "1", specialistTypeHash: "sha256:type-backend", specialistProfileId: "backend",
      specialistProfileHash: "sha256:profile-backend", contextBundleId: ".guild/context/run-g3/backend-lane-a.md", contextBundleHash: "sha256:ctx-lane-a",
      hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps", substrate: "tmux", modelTier: "mid",
      objective: "implement lane-a", outputSchema: "guild.handoff_receipt.v1",
      projection: { tools: ["read", "write"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
      budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead-binding-demo", now: () => "2026-11-05T00:00:00Z",
    } as any).assignment as any;
  };

  it("current v1 writer outputs carry no reserved field and still read", async () => {
    v1Run();
    const b = JSON.parse(fs.readFileSync(runBindingPath(root, RUN_V1), "utf8"));
    expect(validateRunBindingRecord(b, RUN_V1)).not.toBeNull();
    expect(readSessionBinding(path.join(root, ".guild", "runs", RUN_V1))).not.toBeNull();
    const a = await taskCellAssignment();
    expect(validateTaskAssignmentV2(a)).not.toBeNull();
    expect(validateTaskAssignmentV2({ ...a, done_when: [] })).not.toBeNull();
  });

  it("the reserved set equals the frozen identity contracts' field names, and each reader's legacy set covers its writer's output", async () => {
    const derived = new Set<string>();
    for (const schema of vendored.schemas) for (const k of Object.keys(base(schema))) derived.add(k);
    for (const k of Object.keys(base("task-assignment").lineage)) derived.add(k);
    derived.delete("schema_version");
    if (A02_PRESENT) {
      for (const schema of vendored.schemas) {
        const doc = JSON.parse(fs.readFileSync(path.join(A02_ROOT, "schemas", `${schema}.schema.json`), "utf8"));
        for (const k of Object.keys(doc.properties)) if (k !== "schema_version") expect(derived.has(k)).toBe(true);
      }
    }
    expect([...RESERVED_IDENTITY_FIELDS].sort()).toEqual([...derived].sort());
    v1Run();
    const b = JSON.parse(fs.readFileSync(runBindingPath(root, RUN_V1), "utf8"));
    const session = JSON.parse(fs.readFileSync(sessionBindingPath(path.join(root, ".guild", "runs", RUN_V1)), "utf8"));
    const a = await taskCellAssignment();
    for (const k of Object.keys(b)) expect(RUN_BINDING_V1_FIELDS as readonly string[]).toContain(k);
    for (const k of Object.keys(session)) expect(SESSION_BINDING_V1_FIELDS as readonly string[]).toContain(k);
    for (const k of Object.keys(a)) expect(TASK_ASSIGNMENT_V2_FIELDS as readonly string[]).toContain(k);
  });

  it("every reserved field outside a reader's own v1 schema is refused by that reader", async () => {
    v1Run();
    const runDir = path.join(root, ".guild", "runs", RUN_V1);
    const b = JSON.parse(fs.readFileSync(runBindingPath(root, RUN_V1), "utf8"));
    const session = JSON.parse(fs.readFileSync(sessionBindingPath(runDir), "utf8"));
    const a = await taskCellAssignment();
    expect(RESERVED_IDENTITY_FIELDS.length).toBeGreaterThan(10);
    let checked = 0;
    for (const field of RESERVED_IDENTITY_FIELDS) {
      if (!(RUN_BINDING_V1_FIELDS as readonly string[]).includes(field)) { checked++; expect(validateRunBindingRecord({ ...b, [field]: "x" }, RUN_V1)).toBeNull(); }
      if (!(SESSION_BINDING_V1_FIELDS as readonly string[]).includes(field)) {
        checked++;
        fs.writeFileSync(sessionBindingPath(runDir), JSON.stringify({ ...session, [field]: "x" }));
        expect(readSessionBinding(runDir)).toBeNull();
      }
      if (!(TASK_ASSIGNMENT_V2_FIELDS as readonly string[]).includes(field)) { checked++; expect(validateTaskAssignmentV2({ ...a, [field]: "x" })).toBeNull(); }
    }
    expect(checked).toBeGreaterThan(130);
    for (const f of ["authority", "adapter_capability_hash", "run_schema", "controller", "execution_refs"]) {
      expect(validateRunBindingRecord({ ...b, [f]: "x" }, RUN_V1)).toBeNull();
    }
  });
});
