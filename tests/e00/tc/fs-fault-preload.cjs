/**
 * tests/e00/tc/fs-fault-preload.cjs — test-only Node builtin-fs fault injector
 * for the TC tier (F5, round-2 preflight). Loaded ONLY into the TC controller
 * child via NODE_OPTIONS="--require <this file>" plus E00_TC_FAULT_PLAN=<abs plan>.
 * It is not a production flag or test mode: no plugin source reads it.
 *
 * Scope guards (all must hold, otherwise every call passes through untouched):
 *   - this process's entry script basename is task-cell-controller.js or .ts;
 *   - the plan file exists and names the absolute fixture root;
 *   - the target path resolves inside that root.
 * Faults (each driven by the plan, each recorded in <root>/.tc-fault-log.jsonl):
 *   - failFirstAcceptanceAppend: the FIRST append to the run's bus/log.jsonl
 *     carrying an artifact.published line for a handoff-acceptance.json path throws
 *     EACCES (no bytes written); later appends pass and are logged as observed;
 *   - sidecarEacces: any file create/write under controller/reconciliations/ throws EACCES;
 *   - failFirstValidationAppend (C-R1 F3): the FIRST bus append carrying an
 *     artifact.published line for a handoff-validation.json path throws EACCES;
 *   - failAcceptedWrites: N (C-R1 F5): the first N writes of a handoff-acceptance.json
 *     whose record releases downstream (downstream_release_at non-null) throw EACCES
 *     before any byte is written;
 *   - failRejectionWrites (C-R1 F5): every write of a handoff-acceptance.json whose
 *     record is a rejection (downstream_release_at null) throws EACCES;
 *   - failEventAppend {event_name, logical_task_id} (C-R2): the FIRST append to the run's
 *     task-cell-telemetry/events.jsonl of that event for that task throws EACCES (its
 *     marker is already written, so the event is incomplete); later appends pass;
 *   - failFinalWrites (C-R2): every create/write of a controller acceptance-evidence
 *     .../final.json throws EACCES before any byte;
 *   - failFirstHandleWriteAfterSeal (C-R5): the FIRST write of controller/handles/<iid>.json
 *     made after that instance's terminal.json exists throws EACCES (a cleanup step
 *     failing after the physical seal); later handle writes pass.
 * The log records only kind, root-relative path, the bus event sha256/ts, and time.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const planPath = process.env.E00_TC_FAULT_PLAN || "";
const entry = path.basename(process.argv[1] || "");
const isController = entry === "task-cell-controller.js" || entry === "task-cell-controller.ts";

function loadPlan() {
  try {
    const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    return plan && typeof plan.root === "string" && path.isAbsolute(plan.root) ? plan : null;
  } catch {
    return null;
  }
}

const plan = isController && path.isAbsolute(planPath) ? loadPlan() : null;

if (plan) {
  const root = fs.realpathSync(plan.root);
  const busLog = path.join(root, ".guild", "runs", plan.runId, "bus", "log.jsonl");
  const sidecarDir = path.join(root, ".guild", "runs", plan.runId, "controller", "reconciliations") + path.sep;
  const logFile = path.join(root, ".tc-fault-log.jsonl");
  const orig = {
    appendFileSync: fs.appendFileSync,
    writeFileSync: fs.writeFileSync,
    openSync: fs.openSync,
  };
  let acceptanceAppendFailed = false;

  const resolve = (p) => {
    if (typeof p !== "string" && !(p instanceof Buffer) && !(p instanceof URL)) return null;
    const s = p instanceof URL ? p.pathname : String(p);
    const abs = path.resolve(s);
    try {
      return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      return abs;
    }
  };
  const inRoot = (abs) => abs !== null && (abs === root || abs.startsWith(root + path.sep));
  const record = (o) => orig.appendFileSync.call(fs, logFile, JSON.stringify({ ...o, at: new Date().toISOString() }) + "\n");
  const eacces = (syscall, abs) => {
    const e = new Error(`EACCES: permission denied (e00 tc fault), ${syscall} '${abs}'`);
    e.code = "EACCES";
    e.errno = -13;
    e.syscall = syscall;
    e.path = abs;
    return e;
  };
  const acceptanceEvent = (data) => {
    try {
      const line = String(data).trim();
      const ev = JSON.parse(line);
      return ev && ev.event === "artifact.published" && typeof ev.path === "string" && ev.path.endsWith("handoff-acceptance.json") ? ev : null;
    } catch {
      return null;
    }
  };
  const isSidecar = (abs) => abs !== null && inRoot(abs) && abs.startsWith(sidecarDir) && path.extname(abs) === ".json";
  let validationAppendFailed = false;
  let acceptedWritesFailed = 0;
  const validationEvent = (data) => {
    try {
      const ev = JSON.parse(String(data).trim());
      return ev && ev.event === "artifact.published" && typeof ev.path === "string" && ev.path.endsWith("handoff-validation.json") ? ev : null;
    } catch {
      return null;
    }
  };
  /** "accepted" | "rejection" for a handoff-acceptance.json write inside the root, else null. */
  const acceptanceWrite = (abs, data) => {
    if (abs === null || !inRoot(abs) || path.basename(abs) !== "handoff-acceptance.json") return null;
    try {
      const rec = JSON.parse(String(data));
      return rec && rec.downstream_release_at !== null && rec.downstream_release_at !== undefined ? "accepted" : "rejection";
    } catch {
      return null;
    }
  };

  const eventsLog = path.join(root, ".guild", "runs", plan.runId, "task-cell-telemetry", "events.jsonl");
  const evidenceDir = path.join(root, ".guild", "runs", plan.runId, "controller", "acceptance-evidence") + path.sep;
  const isFinal = (abs) => abs !== null && abs.startsWith(evidenceDir) && path.basename(abs) === "final.json";
  let eventAppendFailed = false;
  const handlesDir = path.join(root, ".guild", "runs", plan.runId, "controller", "handles") + path.sep;
  const isHandle = (abs) => abs !== null && abs.startsWith(handlesDir) && path.extname(abs) === ".json";
  let handleSealFaulted = false;
  // True when an instances/<iid>/terminal.json exists under the run's task-cells (read-only walk; reads are not faulted).
  const sealedInstance = (iid) => {
    const cells = path.join(root, ".guild", "runs", plan.runId, "task-cells");
    try {
      return fs.readdirSync(cells, { recursive: true }).some((rel) => {
        const parts = String(rel).split(path.sep);
        return parts.length >= 2 && parts[parts.length - 1] === "terminal.json" && parts[parts.length - 2] === iid;
      });
    } catch {
      return false;
    }
  };
  const targetEvent = (data) => {
    const want = plan.failEventAppend;
    if (!want || eventAppendFailed) return null;
    try {
      const ev = JSON.parse(String(data).trim());
      return ev && ev.event_name === want.event_name && ev.logical_task_id === want.logical_task_id ? ev : null;
    } catch {
      return null;
    }
  };

  fs.appendFileSync = function (p, data, options) {
    const abs = resolve(p);
    if (abs === eventsLog) {
      const ev = targetEvent(data);
      if (ev) {
        eventAppendFailed = true;
        record({ kind: "event_append_failed", event_name: ev.event_name, logical_task_id: ev.logical_task_id });
        throw eacces("open", abs);
      }
      return orig.appendFileSync.call(fs, p, data, options);
    }
    if (abs === busLog) {
      const vev = validationEvent(data);
      if (vev && plan.failFirstValidationAppend) {
        if (!validationAppendFailed) {
          validationAppendFailed = true;
          record({ kind: "validation_append_failed", path: vev.path, sha256: vev.sha256, ts: vev.ts });
          throw eacces("open", abs);
        }
        const out = orig.appendFileSync.call(fs, p, data, options);
        record({ kind: "validation_append_ok", path: vev.path, sha256: vev.sha256, ts: vev.ts });
        return out;
      }
      const ev = acceptanceEvent(data);
      if (ev && plan.failFirstAcceptanceAppend && !acceptanceAppendFailed) {
        acceptanceAppendFailed = true;
        record({ kind: "acceptance_append_failed", path: ev.path, sha256: ev.sha256, ts: ev.ts });
        throw eacces("open", abs);
      }
      const out = orig.appendFileSync.call(fs, p, data, options);
      if (ev) record({ kind: "acceptance_append_ok", path: ev.path, sha256: ev.sha256, ts: ev.ts });
      return out;
    }
    if (plan.sidecarEacces && isSidecar(abs)) {
      record({ kind: "sidecar_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    return orig.appendFileSync.call(fs, p, data, options);
  };

  fs.writeFileSync = function (p, data, options) {
    const abs = resolve(p);
    if (plan.failFirstHandleWriteAfterSeal && !handleSealFaulted && isHandle(abs) && sealedInstance(path.basename(abs, ".json"))) {
      handleSealFaulted = true;
      record({ kind: "handle_write_failed_after_seal", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    if (plan.failFinalWrites && isFinal(abs)) {
      record({ kind: "final_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    const acc = acceptanceWrite(abs, data);
    if (acc === "accepted" && acceptedWritesFailed < (Number(plan.failAcceptedWrites) || 0)) {
      acceptedWritesFailed++;
      record({ kind: "accepted_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    if (acc === "rejection" && plan.failRejectionWrites) {
      record({ kind: "rejection_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    if (acc !== null) record({ kind: `${acc}_write_ok`, path: path.relative(root, abs) });
    if (plan.sidecarEacces && isSidecar(abs)) {
      record({ kind: "sidecar_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    return orig.writeFileSync.call(fs, p, data, options);
  };

  fs.openSync = function (p, flags, mode) {
    const abs = resolve(p);
    const writing = typeof flags === "string" ? /[wa+]/.test(flags) : typeof flags === "number" && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT)) !== 0;
    if (plan.failFinalWrites && writing && isFinal(abs)) {
      record({ kind: "final_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    if (plan.sidecarEacces && writing && isSidecar(abs)) {
      record({ kind: "sidecar_write_failed", path: path.relative(root, abs) });
      throw eacces("open", abs);
    }
    return orig.openSync.call(fs, p, flags, mode);
  };

  record({ kind: "preload_active", entry });
}
