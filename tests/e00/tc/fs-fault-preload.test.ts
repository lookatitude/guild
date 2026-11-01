/**
 * E00-T0 · F5 (round-2 preflight) controls for tc/fs-fault-preload.cjs (runs at
 * TA): the injector fails exactly the first acceptance bus append and every
 * sidecar create with EACCES, writes nothing for the failed calls, logs only
 * secret-free facts, and is inert for any process that is not the controller
 * entry, for any path outside the planned root, and without a plan.
 */
import { describe, it, expect, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import { ownedTempDir, teardownOwned } from "../support/e00-harness";

afterEach(teardownOwned);

const PRELOAD = path.join(__dirname, "fs-fault-preload.cjs");
const RUN = "run-e00-tc";

const PROBE = `
const fs = require("fs"), path = require("path");
const [root, outside] = [process.env.ROOT, process.env.OUTSIDE];
const bus = path.join(root, ".guild/runs/${RUN}/bus/log.jsonl");
const acc = (sha) => JSON.stringify({ event: "artifact.published", path: ".guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1/handoff-acceptance.json", sha256: sha, ts: "2026-10-26T14:00:00.000Z" }) + "\\n";
const other = JSON.stringify({ event: "artifact.published", path: ".guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1/assignment.json", sha256: "c", ts: "t" }) + "\\n";
const r = {};
const attempt = (k, f) => { try { f(); r[k] = "ok"; } catch (e) { r[k] = e.code || "threw"; } };
attempt("other_append", () => fs.appendFileSync(bus, other));
attempt("acceptance_first", () => fs.appendFileSync(bus, acc("a")));
attempt("acceptance_second", () => fs.appendFileSync(bus, acc("a")));
const side = path.join(root, ".guild/runs/${RUN}/controller/reconciliations/i1");
fs.mkdirSync(side, { recursive: true });
attempt("sidecar_wx", () => fs.writeFileSync(path.join(side, "acceptance.json"), "{}", { flag: "wx" }));
attempt("sidecar_open", () => fs.openSync(path.join(side, "validation.json"), "wx"));
attempt("outside_root", () => fs.writeFileSync(path.join(outside, "x.json"), "{}"));
process.stdout.write(JSON.stringify({ r, bus: fs.readFileSync(bus, "utf8").split("\\n").filter(Boolean).length, side: fs.readdirSync(side) }));
`;

function setup(entryName: string, withPlan = true) {
  const root = ownedTempDir("guild-e00-fsfault-");
  const outside = ownedTempDir("guild-e00-fsfault-out-");
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN, "bus"), { recursive: true });
  const plan = path.join(root, ".tc-fault-plan.json");
  if (withPlan) fs.writeFileSync(plan, JSON.stringify({ root, runId: RUN, failFirstAcceptanceAppend: true, sidecarEacces: true }));
  const entry = path.join(root, entryName);
  fs.writeFileSync(entry, PROBE);
  const r = spawnSync("node", [entry], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, E00_TC_FAULT_PLAN: plan, ROOT: root, OUTSIDE: outside },
  });
  expect(r.status).toBe(0);
  const log = fs.existsSync(path.join(root, ".tc-fault-log.jsonl"))
    ? fs.readFileSync(path.join(root, ".tc-fault-log.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  return { out: JSON.parse(r.stdout), log };
}

describe("TC fs fault preload (infrastructure controls)", () => {
  it("in the controller entry: fails only the first acceptance append and every sidecar create; writes nothing for them", () => {
    const { out, log } = setup("task-cell-controller.js");
    expect(out.r).toEqual({ other_append: "ok", acceptance_first: "EACCES", acceptance_second: "ok", sidecar_wx: "EACCES", sidecar_open: "EACCES", outside_root: "ok" });
    expect(out.bus).toBe(2);
    expect(out.side).toEqual([]);
    expect(log.map((e) => e.kind)).toEqual(["preload_active", "acceptance_append_failed", "acceptance_append_ok", "sidecar_write_failed", "sidecar_write_failed"]);
    expect(log[1]).toMatchObject({ sha256: "a" });
    expect(log[2]).toMatchObject({ sha256: "a" });
  });

  it("is inert in any other entry script", () => {
    const { out, log } = setup("fixture-worker.mjs.cjs");
    expect(out.r).toEqual({ other_append: "ok", acceptance_first: "ok", acceptance_second: "ok", sidecar_wx: "ok", sidecar_open: "ok", outside_root: "ok" });
    expect(log).toEqual([]);
  });

  it("reaches calls made through an esbuild node/cjs bundle's `import * as fs` (the compiled package shape)", () => {
    const esbuild = path.join(__dirname, "..", "..", "..", "scripts", "node_modules", ".bin", "esbuild");
    const root = ownedTempDir("guild-e00-fsfault-esb-");
    fs.mkdirSync(path.join(root, ".guild", "runs", RUN, "bus"), { recursive: true });
    const src = path.join(root, "probe-src.ts");
    fs.writeFileSync(src, [
      'import * as fs from "fs";',
      'import * as path from "path";',
      `const bus = path.join(process.env.ROOT!, ".guild/runs/${RUN}/bus/log.jsonl");`,
      `const line = JSON.stringify({ event: "artifact.published", path: ".guild/runs/${RUN}/x/handoff-acceptance.json", sha256: "b", ts: "t" }) + "\\n";`,
      'const r: string[] = [];',
      'for (let i = 0; i < 2; i++) { try { fs.appendFileSync(bus, line); r.push("ok"); } catch (e) { r.push((e as NodeJS.ErrnoException).code ?? "threw"); } }',
      'process.stdout.write(JSON.stringify(r));',
    ].join("\n"));
    const out = path.join(root, "task-cell-controller.js");
    const b = spawnSync(esbuild, [src, "--bundle", "--platform=node", "--format=cjs", `--outfile=${out}`, "--log-level=error"], { encoding: "utf8", timeout: 60000 });
    expect(b.status).toBe(0);
    const plan = path.join(root, ".tc-fault-plan.json");
    fs.writeFileSync(plan, JSON.stringify({ root, runId: RUN, failFirstAcceptanceAppend: true, sidecarEacces: true }));
    const r = spawnSync("node", [out], { encoding: "utf8", timeout: 30000, env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, E00_TC_FAULT_PLAN: plan, ROOT: root } });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(["EACCES", "ok"]);
  });

  it("is inert without a fault plan", () => {
    const { out, log } = setup("task-cell-controller.js", false);
    expect(Object.values(out.r).every((v) => v === "ok")).toBe(true);
    expect(log).toEqual([]);
  });
});

// C-R1 F3/F5 fault modes: validation publish, accepting writes, rejection writes.
const PROBE_CR1 = `
const fs = require("fs"), path = require("path");
const root = process.env.ROOT;
const inst = path.join(root, ".guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1");
fs.mkdirSync(inst, { recursive: true });
const bus = path.join(root, ".guild/runs/${RUN}/bus/log.jsonl");
const val = JSON.stringify({ event: "artifact.published", path: ".guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1/handoff-validation.json", sha256: "v", ts: "t" }) + "\\n";
const acc = path.join(inst, "handoff-acceptance.json");
const accepted = JSON.stringify({ downstream_release_at: "2026-10-26T13:00:00.000Z", termination_authorized_at: "2026-10-26T13:00:00.000Z" });
const rejected = JSON.stringify({ downstream_release_at: null, termination_authorized_at: "2026-10-26T13:00:00.000Z" });
const r = {};
const attempt = (k, f) => { try { f(); r[k] = "ok"; } catch (e) { r[k] = e.code || "threw"; } };
attempt("validation_first", () => fs.appendFileSync(bus, val));
attempt("validation_second", () => fs.appendFileSync(bus, val));
for (let i = 1; i <= 3; i++) attempt("accepted_" + i, () => fs.writeFileSync(acc, accepted));
const afterAccepted = fs.existsSync(acc);
fs.rmSync(acc, { force: true });
attempt("rejection", () => fs.writeFileSync(acc, rejected));
process.stdout.write(JSON.stringify({ r, bus: fs.readFileSync(bus, "utf8").split("\\n").filter(Boolean).length, afterAccepted, afterRejection: fs.existsSync(acc) }));
`;

function setupCr1(plan: Record<string, unknown>) {
  const root = ownedTempDir("guild-e00-fsfault-cr1-");
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN, "bus"), { recursive: true });
  const planFile = path.join(root, ".tc-fault-plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ root, runId: RUN, ...plan }));
  const entry = path.join(root, "task-cell-controller.js");
  fs.writeFileSync(entry, PROBE_CR1);
  const r = spawnSync("node", [entry], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, E00_TC_FAULT_PLAN: planFile, ROOT: root },
  });
  expect(r.status).toBe(0);
  const logFile = path.join(root, ".tc-fault-log.jsonl");
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { out: JSON.parse(r.stdout), kinds: log.map((e) => e.kind) };
}

describe("TC fs fault preload C-R1 modes (infrastructure controls)", () => {
  it("failFirstValidationAppend fails only the first validation publish and writes nothing for it", () => {
    const { out, kinds } = setupCr1({ failFirstValidationAppend: true });
    expect(out.r).toMatchObject({ validation_first: "EACCES", validation_second: "ok" });
    expect(out.bus).toBe(1);
    expect(kinds.filter((k) => k.startsWith("validation_"))).toEqual(["validation_append_failed", "validation_append_ok"]);
  });

  it("failAcceptedWrites: N fails exactly the first N accepting writes before any byte; rejections pass", () => {
    const { out, kinds } = setupCr1({ failAcceptedWrites: 2 });
    expect(out.r).toMatchObject({ accepted_1: "EACCES", accepted_2: "EACCES", accepted_3: "ok", rejection: "ok" });
    expect(out.afterAccepted).toBe(true);
    expect(kinds.filter((k) => k === "accepted_write_failed").length).toBe(2);
  });

  it("failRejectionWrites fails every rejection write and leaves no file; accepting writes pass", () => {
    const { out, kinds } = setupCr1({ failRejectionWrites: true });
    expect(out.r).toMatchObject({ accepted_1: "ok", rejection: "EACCES" });
    expect(out.afterRejection).toBe(false);
    expect(kinds).toContain("rejection_write_failed");
  });

  it("without the C-R1 keys every C-R1 call passes", () => {
    const { out } = setupCr1({});
    expect(Object.values(out.r).every((v) => v === "ok")).toBe(true);
  });
});

// C-R2 fault modes: one lifecycle event line, and final.json creates.
const PROBE_CR2 = `
const fs = require("fs"), path = require("path");
const root = process.env.ROOT;
const tel = path.join(root, ".guild/runs/${RUN}/task-cell-telemetry");
fs.mkdirSync(tel, { recursive: true });
const events = path.join(tel, "events.jsonl");
const ev = (name, task) => JSON.stringify({ event_name: name, logical_task_id: task, instance_id: "i1" }) + "\\n";
const ev1 = path.join(root, ".guild/runs/${RUN}/controller/acceptance-evidence/i1");
fs.mkdirSync(ev1, { recursive: true });
const r = {};
const attempt = (k, f) => { try { f(); r[k] = "ok"; } catch (e) { r[k] = e.code || "threw"; } };
attempt("other_event", () => fs.appendFileSync(events, ev("handoff_submitted", "T1")));
attempt("other_task", () => fs.appendFileSync(events, ev("handoff_validated", "T2")));
attempt("target_first", () => fs.appendFileSync(events, ev("handoff_validated", "T1")));
attempt("target_second", () => fs.appendFileSync(events, ev("handoff_validated", "T1")));
attempt("final_wx", () => fs.writeFileSync(path.join(ev1, "final.json"), "{}", { flag: "wx" }));
const ev2 = path.join(root, ".guild/runs/${RUN}/controller/acceptance-evidence/i2");
fs.mkdirSync(ev2, { recursive: true });
attempt("final_open", () => fs.closeSync(fs.openSync(path.join(ev2, "final.json"), "wx")));
attempt("pre_json", () => fs.writeFileSync(path.join(ev1, "pre.json"), "{}", { flag: "wx" }));
process.stdout.write(JSON.stringify({ r, lines: fs.readFileSync(events, "utf8").split("\\n").filter(Boolean).length, final: fs.existsSync(path.join(ev1, "final.json")) }));
`;

function setupCr2(plan: Record<string, unknown>) {
  const root = ownedTempDir("guild-e00-fsfault-cr2-");
  const planFile = path.join(root, ".tc-fault-plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ root, runId: RUN, ...plan }));
  const entry = path.join(root, "task-cell-controller.js");
  fs.writeFileSync(entry, PROBE_CR2);
  const r = spawnSync("node", [entry], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, E00_TC_FAULT_PLAN: planFile, ROOT: root },
  });
  expect(r.status).toBe(0);
  const logFile = path.join(root, ".tc-fault-log.jsonl");
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { out: JSON.parse(r.stdout), kinds: log.map((e) => e.kind) };
}

describe("TC fs fault preload C-R2 modes (infrastructure controls)", () => {
  it("failEventAppend fails only the first append of that event for that task; the line is not written", () => {
    const { out, kinds } = setupCr2({ failEventAppend: { event_name: "handoff_validated", logical_task_id: "T1" } });
    expect(out.r).toMatchObject({ other_event: "ok", other_task: "ok", target_first: "EACCES", target_second: "ok" });
    expect(out.lines).toBe(3);
    expect(kinds.filter((k) => k === "event_append_failed").length).toBe(1);
  });

  it("failFinalWrites fails every final.json create (writeFileSync and openSync) and leaves no file; pre.json passes", () => {
    const { out, kinds } = setupCr2({ failFinalWrites: true });
    expect(out.r).toMatchObject({ final_wx: "EACCES", final_open: "EACCES", pre_json: "ok" });
    expect(out.final).toBe(false);
    expect(kinds.filter((k) => k === "final_write_failed").length).toBe(2);
  });

  it("without the C-R2 keys every C-R2 call passes", () => {
    const { out } = setupCr2({});
    expect(Object.values(out.r).every((v) => v === "ok")).toBe(true);
  });
});

// C-R5 fault mode: the first handle write after the instance's terminal seal.
const PROBE_CR5 = `
const fs = require("fs"), path = require("path");
const root = process.env.ROOT;
const handles = path.join(root, ".guild/runs/${RUN}/controller/handles");
const inst = path.join(root, ".guild/runs/${RUN}/task-cells/T1/attempts/1/instances/i1");
fs.mkdirSync(handles, { recursive: true });
fs.mkdirSync(inst, { recursive: true });
const r = {};
const attempt = (k, f) => { try { f(); r[k] = "ok"; } catch (e) { r[k] = e.code || "threw"; } };
attempt("before_seal", () => fs.writeFileSync(path.join(handles, "i1.json"), "{}"));
fs.writeFileSync(path.join(inst, "terminal.json"), "{}");
attempt("other_instance", () => fs.writeFileSync(path.join(handles, "i2.json"), "{}"));
attempt("after_seal_first", () => fs.writeFileSync(path.join(handles, "i1.json"), "{\\"x\\":1}"));
attempt("after_seal_second", () => fs.writeFileSync(path.join(handles, "i1.json"), "{\\"x\\":2}"));
process.stdout.write(JSON.stringify({ r, handle: fs.readFileSync(path.join(handles, "i1.json"), "utf8") }));
`;

function setupCr5(plan: Record<string, unknown>) {
  const root = ownedTempDir("guild-e00-fsfault-cr5-");
  const planFile = path.join(root, ".tc-fault-plan.json");
  fs.writeFileSync(planFile, JSON.stringify({ root, runId: RUN, ...plan }));
  const entry = path.join(root, "task-cell-controller.js");
  fs.writeFileSync(entry, PROBE_CR5);
  const r = spawnSync("node", [entry], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, E00_TC_FAULT_PLAN: planFile, ROOT: root },
  });
  expect(r.status).toBe(0);
  const logFile = path.join(root, ".tc-fault-log.jsonl");
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { out: JSON.parse(r.stdout), kinds: log.map((e) => e.kind) };
}

describe("TC fs fault preload C-R5 mode (infrastructure controls)", () => {
  it("failFirstHandleWriteAfterSeal fails only the first post-seal write of that instance's handle", () => {
    const { out, kinds } = setupCr5({ failFirstHandleWriteAfterSeal: true });
    expect(out.r).toEqual({ before_seal: "ok", other_instance: "ok", after_seal_first: "EACCES", after_seal_second: "ok" });
    expect(out.handle).toBe("{\"x\":2}");
    expect(kinds.filter((k) => k === "handle_write_failed_after_seal")).toHaveLength(1);
  });

  it("without the key every handle write passes", () => {
    const { out } = setupCr5({});
    expect(Object.values(out.r).every((v) => v === "ok")).toBe(true);
  });
});
