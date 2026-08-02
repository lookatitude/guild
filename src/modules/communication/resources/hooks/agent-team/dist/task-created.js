#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// agent-team/task-created.ts
var fs5 = __toESM(require("fs"));
var path6 = __toESM(require("path"));
var readline = __toESM(require("readline"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  const resolvedStart = path.resolve(startCwd);
  let current = resolvedStart;
  let nearestGuildDir = null;
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    if (nearestGuildDir === null) {
      const guildDir = path.join(current, ".guild");
      if (fs.existsSync(guildDir)) {
        try {
          if (fs.statSync(guildDir).isDirectory()) {
            nearestGuildDir = current;
          }
        } catch {
        }
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return nearestGuildDir ?? resolvedStart;
    }
    current = parent;
  }
}

// lib/run-state.ts
var fs3 = __toESM(require("node:fs"));
var path4 = __toESM(require("node:path"));

// lib/v1.4/v1.4-lock.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
function stableLockPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock");
}
function exclusionSentinelPath(runDir) {
  return (0, import_node_path.join)(runDir, "logs", ".lock.exclusion");
}
function initStableLockfile(runDir) {
  const path7 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path7), { recursive: true });
  if ((0, import_node_fs.existsSync)(path7)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path7, "wx");
    (0, import_node_fs.closeSync)(fd);
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }
}
var DEFAULT_BACKOFF_MS = [2, 5, 10, 25, 50, 100, 200];
var DEFAULT_TIMEOUT_MS = 5e3;
function sleepSyncMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
  }
}
function withStableLock(runDir, fn, opts = {}) {
  initStableLockfile(runDir);
  const sentinel = exclusionSentinelPath(runDir);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const start = Date.now();
  let attempt = 0;
  for (; ; ) {
    try {
      const fd = (0, import_node_fs.openSync)(sentinel, "wx");
      try {
        (0, import_node_fs.writeSync)(fd, `${process.pid}
`);
      } catch {
      }
      (0, import_node_fs.closeSync)(fd);
      try {
        return fn();
      } finally {
        try {
          (0, import_node_fs.unlinkSync)(sentinel);
        } catch {
        }
      }
    } catch (err) {
      const code = err?.code;
      if (code !== "EEXIST") throw err;
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `v1.4-lock: timed out waiting for ${sentinel} (${timeoutMs}ms). Stale lock? Remove the file if you are sure no other process holds it.`
        );
      }
      const idx = Math.min(attempt, backoff.length - 1);
      sleepSyncMs(backoff[idx]);
      attempt += 1;
    }
  }
}

// ../src/modules/capability/workflows/independence-record.ts
var fs2 = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// ../src/modules/lifecycle/workflows/run-binding.ts
var fsReal = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path2.join(root, ".guild", "runs", runId, "binding.json");
}
function validateRunBindingRecord(parsed, expectedRunId) {
  if (parsed === null || typeof parsed !== "object") return null;
  const o = parsed;
  if (o["schema_version"] !== "guild.run_binding.v1") return null;
  if (typeof o["run_id"] !== "string" || o["run_id"] !== expectedRunId) return null;
  const ref = o["binding_ref"];
  if (typeof ref !== "string" || !/^rb-[A-Za-z0-9_-]+$/.test(ref)) return null;
  if (o["state"] !== "open" && o["state"] !== "closed") return null;
  return {
    schema_version: "guild.run_binding.v1",
    run_id: o["run_id"],
    binding_ref: ref,
    state: o["state"]
  };
}
function readRunBindingRecord(opts) {
  const fs6 = opts.fs ?? realBindingFs();
  const raw = fs6.readFile(runBindingPath(opts.root, opts.run_id));
  if (raw === null) return { status: "absent" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "malformed" };
  }
  const record = validateRunBindingRecord(parsed, opts.run_id);
  if (record === null) return { status: "malformed" };
  return { status: "ok", record };
}
function verifyRunBinding(input) {
  const reject2 = (reason) => ({
    ok: false,
    diagnostic: "binding_rejected",
    reason
  });
  if (!input.run_id || !input.binding_ref) return reject2("binding_absent");
  if (!input.root) return reject2("binding_unverifiable");
  const read = readRunBindingRecord({ root: input.root, run_id: input.run_id, fs: input.fs });
  if (read.status === "absent") return reject2("binding_not_minted");
  if (read.status === "malformed") return reject2("binding_malformed");
  const record = read.record;
  if (record.state === "closed") return reject2("binding_closed");
  if (record.binding_ref !== input.binding_ref || record.run_id !== input.run_id) {
    return reject2("binding_mismatch");
  }
  return { ok: true, binding: record };
}
var HOOK_BINDING_ENV_RUN_ID = "GUILD_RUN_ID";
var HOOK_BINDING_ENV_BINDING_REF = "GUILD_RUN_BINDING_REF";
function readHookBindingEnvelope(env) {
  const run_id = env[HOOK_BINDING_ENV_RUN_ID]?.trim();
  const binding_ref = env[HOOK_BINDING_ENV_BINDING_REF]?.trim();
  if (!run_id || !binding_ref) return null;
  return { run_id, binding_ref };
}

// ../src/modules/capability/workflows/independence-predicates.ts
var ADJUDICATION_SHA256_HEX = /^[0-9a-f]{64}$/;
function asAdjudicationRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : null;
}
function validateAdjudicationRef(v) {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const dispatch_id = o["dispatch_id"];
  const receipt_hash = o["receipt_hash"];
  if (typeof dispatch_id !== "string" || dispatch_id.length === 0) return null;
  if (typeof receipt_hash !== "string" || !ADJUDICATION_SHA256_HEX.test(receipt_hash)) return null;
  return { dispatch_id, receipt_hash };
}
function validateWrittenAdjudication(v) {
  const o = asAdjudicationRecord(v);
  if (!o) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  const independence = o["independence"];
  if (independence !== "strong" && independence !== "weak") return null;
  const predicate_trace = o["predicate_trace"];
  if (typeof predicate_trace !== "string" || predicate_trace.length === 0) return null;
  return { producer_ref, reviewer_ref, independence, predicate_trace };
}

// ../src/modules/capability/workflows/independence-record.ts
var INDEPENDENCE_DIR = "independence";
function independenceDirForRunDir(runDir) {
  return path3.join(runDir, INDEPENDENCE_DIR);
}
function loadWrittenAdjudications(runDir) {
  const dir = independenceDirForRunDir(runDir);
  let names;
  try {
    names = fs2.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    let parsed;
    try {
      parsed = JSON.parse(fs2.readFileSync(path3.join(dir, name), "utf8"));
    } catch {
      continue;
    }
    const block = validateWrittenAdjudication(parsed);
    if (block) out.push(block);
  }
  return out;
}
function validateIndependenceBinding(v) {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v;
  const lane_id = o["lane_id"];
  if (typeof lane_id !== "string" || lane_id.length === 0) return null;
  const producer_ref = validateAdjudicationRef(o["producer_ref"]);
  const reviewer_ref = validateAdjudicationRef(o["reviewer_ref"]);
  if (!producer_ref || !reviewer_ref) return null;
  return { lane_id, producer_ref, reviewer_ref };
}
function sameRef(a, b) {
  return a.dispatch_id === b.dispatch_id && a.receipt_hash === b.receipt_hash;
}
function findBoundAdjudications(runDir, binding) {
  return loadWrittenAdjudications(runDir).filter(
    (b) => sameRef(b.producer_ref, binding.producer_ref) && sameRef(b.reviewer_ref, binding.reviewer_ref)
  );
}
function assertPersistableIndependence(runDir, independence, context, binding) {
  if (independence !== "strong") return;
  const where = independenceDirForRunDir(runDir);
  const bound = validateIndependenceBinding(binding);
  if (!bound) {
    throw new Error(
      `independence_binding_missing: refusing to persist independence:"strong" for ${context} \u2014 the record declares no valid \xA77a binding {lane_id, producer_ref:{dispatch_id,receipt_hash}, reviewer_ref:{dispatch_id,receipt_hash}} (receipt hashes must be sha256 hex). A strong verdict is persistable only as a claim ON a specific adjudication, never as a bare string. Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`
    );
  }
  if (bound.producer_ref.dispatch_id !== bound.lane_id) {
    throw new Error(
      `independence_binding_lane_mismatch: refusing to persist independence:"strong" for ${context} \u2014 the declared adjudication's producer dispatch is "${bound.producer_ref.dispatch_id}" but the record being written is lane "${bound.lane_id}". An adjudication of ANOTHER lane's dispatch never authorizes this one, however valid it is. Adjudicate THIS lane's own producer/reviewer receipts or persist "weak".`
    );
  }
  const matches = findBoundAdjudications(runDir, bound);
  if (matches.length === 0) {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} \u2014 no WRITTEN, hash-bound guild.model_resolution.v1 \xA77a independence_adjudication block under ${where} matches this record's binding (producer ${bound.producer_ref.dispatch_id}@${bound.producer_ref.receipt_hash.slice(0, 12)}\u2026, reviewer ${bound.reviewer_ref.dispatch_id}@${bound.reviewer_ref.receipt_hash.slice(0, 12)}\u2026). \xA77a admits NO provisional strong: a strong review verdict exists only as an adjudicated block binding BOTH parties' finalized receipts. Record the adjudication first (persistIndependenceAdjudication) or persist "weak".`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `independence_adjudication_ambiguous: refusing to persist independence:"strong" for ${context} \u2014 ${matches.length} written \xA77a blocks under ${where} bind the SAME producer/reviewer receipt pair. Which verdict applies is ambiguous, and filename order never decides. Resolve the duplicate blocks and re-adjudicate.`
    );
  }
  if (matches[0].independence !== "strong") {
    throw new Error(
      `independence_not_adjudicated: refusing to persist independence:"strong" for ${context} \u2014 the \xA77a block bound to this record adjudicated "${matches[0].independence}", not "strong" (${matches[0].predicate_trace}). The persisted value must be the ADJUDICATED one; a caller never upgrades a verdict.`
    );
  }
}

// lib/run-state.ts
var RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1";
function runStatePath(runDir) {
  return path4.join(runDir, "run-state.json");
}
function loadRunState(runDir) {
  let raw;
  try {
    raw = fs3.readFileSync(runStatePath(runDir), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || parsed["schema_version"] !== RUN_STATE_SCHEMA_VERSION) {
    return null;
  }
  return parsed;
}
function writeRunStateAtomic(runDir, state) {
  fs3.mkdirSync(runDir, { recursive: true });
  const finalPath = runStatePath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs3.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs3.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs3.unlinkSync(tmpPath);
    } catch {
    }
    throw err;
  }
}
function newCheckpoint(init, now) {
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION,
    run_id: init.runId,
    plan_slug: init.planSlug ?? init.runId,
    program_id: init.programId ?? null,
    wave_index: init.waveIndex ?? 0,
    lanes: {},
    last_checkpoint_at: now
  };
}
function upsertLane(runDir, init, laneId, patch) {
  assertPersistableIndependence(
    runDir,
    patch.host?.independence,
    `run-state lane "${laneId}"`,
    {
      lane_id: laneId,
      producer_ref: patch.host?.independence_ref?.producer_ref,
      reviewer_ref: patch.host?.independence_ref?.reviewer_ref
    }
  );
  return withStableLock(runDir, () => {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const state = loadRunState(runDir) ?? newCheckpoint(init, now);
    const prev = state.lanes[laneId];
    const merged = {
      status: patch.status ?? prev?.status ?? "pending",
      attempt: patch.attempt ?? prev?.attempt ?? 1,
      depends_on: patch.depends_on ?? prev?.depends_on ?? [],
      receipt_ref: patch.receipt_ref !== void 0 ? patch.receipt_ref : prev?.receipt_ref ?? null,
      updated_at: now
    };
    const tier = patch.tier ?? prev?.tier;
    if (tier !== void 0) merged.tier = tier;
    const host = patch.host ?? prev?.host;
    if (host !== void 0) merged.host = host;
    state.lanes[laneId] = merged;
    state.last_checkpoint_at = now;
    writeRunStateAtomic(runDir, state);
    return state;
  });
}
function markLaneInProgress(runDir, init, laneId, opts = {}) {
  return upsertLane(runDir, init, laneId, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on
  });
}

// lib/bus-emit.ts
var fs4 = __toESM(require("node:fs"));
var path5 = __toESM(require("node:path"));
var BUS_EVENT_SCHEMA_VERSION = "guild.agent_bus_event.v1";
function buildBusEvent(input) {
  const rec = {
    schema_version: BUS_EVENT_SCHEMA_VERSION,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    run_id: input.run_id,
    event: input.event
  };
  if (typeof input.lane_id === "string" && input.lane_id.length > 0) rec.lane_id = input.lane_id;
  if (typeof input.task_id === "string" && input.task_id.length > 0) rec.task_id = input.task_id;
  if (typeof input.team_name === "string" && input.team_name.length > 0) {
    rec.team_name = input.team_name;
  }
  if (typeof input.detail === "string" && input.detail.length > 0) rec.detail = input.detail;
  return rec;
}
function emitBusEvent(runDir, input) {
  try {
    const busDir = path5.join(runDir, "agent-bus");
    fs4.mkdirSync(busDir, { recursive: true });
    const record = buildBusEvent(input);
    fs4.appendFileSync(
      path5.join(busDir, "events.ndjson"),
      JSON.stringify(record) + "\n",
      "utf8"
    );
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [bus-emit] write failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return false;
  }
}

// lib/hook-binding.ts
function reject(reason, run_id) {
  return { ok: false, diagnostic: "binding_rejected", reason, run_id };
}
function authorizeHookWrite(root, opts = {}) {
  const env = opts.env ?? process.env;
  const envelope = readHookBindingEnvelope(env);
  const envRunId = env["GUILD_RUN_ID"]?.trim();
  const runId = opts.runId ?? envelope?.run_id ?? (envRunId || void 0);
  if (!runId) return reject("binding_absent", null);
  const ref = opts.bindingRef ?? (envelope && envelope.run_id === runId ? envelope.binding_ref : void 0);
  if (ref === void 0 || ref.trim().length === 0) {
    return reject("binding_absent", runId);
  }
  const verdict = verifyRunBinding({ root, run_id: runId, binding_ref: ref });
  if (verdict.ok === false) return reject(verdict.reason, runId);
  return { ok: true, run_id: runId, binding_ref: verdict.binding.binding_ref };
}
function formatBindingRejected(hook, auth) {
  if (auth.ok !== false) return "";
  return `[${hook}] binding_rejected (${auth.reason}) for run ${auth.run_id ?? "<unresolved>"} \u2014 no write performed (session_context \xA75: writers fail closed; sentinels are intake-only).
`;
}

// agent-team/task-created.ts
function die(reason) {
  process.stderr.write(`[task-created] BLOCKED: ${reason}
`);
  process.exit(1);
}
function warn(msg) {
  process.stderr.write(`[task-created] WARN: ${msg}
`);
}
function extractDependsOn(text) {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}
function loadPlanTaskIds(cwd) {
  const planDir = path6.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs5.existsSync(planDir)) return null;
  const files = fs5.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return null;
  const ids = /* @__PURE__ */ new Set();
  for (const file of files) {
    const content = fs5.readFileSync(path6.join(planDir, file), "utf8");
    const patterns = [
      /\bid:\s*(task-[\w-]+)/gi,
      /^\s*[-*]\s*(task-[\w-]+):/gim,
      /task_id:\s*(task-[\w-]+)/gi,
      /\*\*(task-[\w-]+)\*\*/gi
    ];
    for (const re of patterns) {
      for (const m of content.matchAll(re)) {
        ids.add(m[1].toLowerCase());
      }
    }
  }
  return ids.size > 0 ? ids : null;
}
async function main() {
  const agentTeamEnabled = process.env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "1";
  if (!agentTeamEnabled) {
    process.exit(0);
  }
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) {
    lines.push(line);
  }
  const raw = lines.join("\n").trim();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    die(`Invalid JSON on stdin: ${raw.slice(0, 120)}`);
  }
  const taskId = payload.task_id ?? "(unknown)";
  const subject = payload.task_subject ?? "";
  const description = payload.task_description ?? "";
  const owner = (payload.teammate_name ?? "").trim();
  const cwd = payload.cwd ?? process.cwd();
  if (!owner) {
    die(
      `Task "${taskId}" has no owner specialist assigned (teammate_name is empty). Assign a specialist before queueing this task.`
    );
  }
  const combinedText = `${subject} ${description}`.trim();
  if (!description.trim()) {
    die(
      `Task "${taskId}" is missing an output contract. Provide a task_description with success criteria or scope before queueing.`
    );
  }
  const deps = extractDependsOn(combinedText);
  if (deps.length > 0) {
    const planIds = loadPlanTaskIds(cwd);
    if (planIds === null) {
      warn(
        `Task "${taskId}" has depends-on references [${deps.join(", ")}] but no plan file found at ${path6.join(resolveGuildRoot(cwd), ".guild/plan/")}. Skipping dependency check.`
      );
    } else {
      const missing = deps.filter((d) => !planIds.has(d.toLowerCase()));
      if (missing.length > 0) {
        die(
          `Task "${taskId}" has depends-on references to unknown task IDs: [${missing.join(", ")}]. Ensure those tasks exist in the plan before adding dependencies.`
        );
      }
    }
  }
  const guildRootForRun = resolveGuildRoot(cwd);
  const runStateAuth = authorizeHookWrite(guildRootForRun);
  if (runStateAuth.ok === false) {
    process.stderr.write(formatBindingRejected("task-created", runStateAuth));
  } else {
    const runId = runStateAuth.run_id;
    const runDir = path6.join(guildRootForRun, ".guild", "runs", runId);
    try {
      markLaneInProgress(runDir, { runId }, taskId);
      process.stderr.write(
        `[task-created] run-state: lane "${taskId}" \u2192 in_progress (${path6.join(runDir, "run-state.json")}).
`
      );
    } catch (err) {
      process.stderr.write(
        `[task-created] WARN: run-state in_progress write failed (non-fatal, rebuildable cache): ${err instanceof Error ? err.message : String(err)}
`
      );
    }
    emitBusEvent(runDir, {
      run_id: runId,
      event: "dispatched",
      lane_id: owner,
      task_id: taskId,
      team_name: (payload.team_name ?? "").trim() || void 0
    });
  }
  process.stderr.write(
    `[task-created] OK: task "${taskId}" owned by "${owner}" passed all validations.
`
  );
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[task-created] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
