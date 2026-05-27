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

// agent-team/task-completed.ts
var fs3 = __toESM(require("fs"));
var path3 = __toESM(require("path"));
var readline = __toESM(require("readline"));

// lib/guild-root.ts
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
function resolveGuildRoot(startCwd) {
  let current = path.resolve(startCwd);
  for (; ; ) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const guildDir = path.join(current, ".guild");
    if (fs.existsSync(guildDir)) {
      try {
        if (fs.statSync(guildDir).isDirectory()) {
          return current;
        }
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startCwd);
    }
    current = parent;
  }
}

// lib/handoff-v2.ts
var SUMMARY_MAX_CHARS = 600;
var NOTES_MAX_CHARS = 200;
var VALID_TIERS = /* @__PURE__ */ new Set(["cheap", "mid", "powerful"]);
var VALID_STATUSES = /* @__PURE__ */ new Set(["done", "blocked", "escalate"]);
function validateHandoffV2(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["envelope must be a non-null object"] };
  }
  const obj = value;
  if (obj["schema_version"] !== "guild.handoff.v2") {
    errors.push(
      `schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }
  if (typeof obj["task_id"] !== "string" || obj["task_id"].trim() === "") {
    errors.push("task_id must be a non-empty string");
  }
  if (typeof obj["tier"] !== "string" || !VALID_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }
  if (typeof obj["status"] !== "string" || !VALID_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > SUMMARY_MAX_CHARS) {
    errors.push(
      `summary exceeds ${SUMMARY_MAX_CHARS} char cap (bloat rejection SC-7): got ${obj["summary"].length} chars`
    );
  }
  if (!Array.isArray(obj["artifacts"])) {
    errors.push("artifacts must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["artifacts"].length; i++) {
      if (typeof obj["artifacts"][i] !== "string") {
        errors.push(`artifacts[${i}] must be a string`);
      }
    }
  }
  if (!Array.isArray(obj["issues"])) {
    errors.push("issues must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["issues"].length; i++) {
      if (typeof obj["issues"][i] !== "string") {
        errors.push(`issues[${i}] must be a string`);
      }
    }
  }
  if (obj["status"] === "escalate") {
    if (obj["escalate_reason"] === void 0 || obj["escalate_reason"] === null || typeof obj["escalate_reason"] === "string" && obj["escalate_reason"].trim() === "") {
      errors.push("escalate_reason is required and must be non-empty when status is 'escalate'");
    }
  }
  if (obj["escalate_reason"] !== void 0 && typeof obj["escalate_reason"] !== "string") {
    errors.push("escalate_reason must be a string when provided");
  }
  if (obj["learnings"] !== void 0) {
    if (!Array.isArray(obj["learnings"])) {
      errors.push("learnings must be an array when provided");
    } else {
      for (let i = 0; i < obj["learnings"].length; i++) {
        if (typeof obj["learnings"][i] !== "string") {
          errors.push(`learnings[${i}] must be a string`);
        }
      }
    }
  }
  if (obj["notes"] !== void 0) {
    if (typeof obj["notes"] !== "string") {
      errors.push("notes must be a string when provided");
    } else if (obj["notes"].length > NOTES_MAX_CHARS) {
      errors.push(
        `notes exceeds ${NOTES_MAX_CHARS} char cap (O-4 binding resolution): got ${obj["notes"].length} chars`
      );
    }
  }
  return { valid: errors.length === 0, errors };
}
function extractHandoffEnvelope(content) {
  const pattern = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/;
  const match = pattern.exec(content);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

// lib/run-state.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));

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
  const path4 = stableLockPath(runDir);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(path4), { recursive: true });
  if ((0, import_node_fs.existsSync)(path4)) return;
  try {
    const fd = (0, import_node_fs.openSync)(path4, "wx");
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

// lib/run-state.ts
var RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1";
function runStatePath(runDir) {
  return path2.join(runDir, "run-state.json");
}
function loadRunState(runDir) {
  let raw;
  try {
    raw = fs2.readFileSync(runStatePath(runDir), "utf8");
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
  fs2.mkdirSync(runDir, { recursive: true });
  const finalPath = runStatePath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs2.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs2.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs2.unlinkSync(tmpPath);
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
    state.lanes[laneId] = merged;
    state.last_checkpoint_at = now;
    writeRunStateAtomic(runDir, state);
    return state;
  });
}

// agent-team/task-completed.ts
var REQUIRED_FIELDS = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups"
];
function die(reason) {
  process.stderr.write(`[task-completed] BLOCKED: ${reason}
`);
  process.exit(1);
}
function deriveRunId(sessionId) {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}
function receiptPath(guildRoot, runId, specialist, taskId) {
  return path3.join(guildRoot, ".guild", "runs", runId, "handoffs", `${specialist}-${taskId}.md`);
}
function learningsPath(guildRoot, runId, specialist, taskId) {
  return path3.join(guildRoot, ".guild", "runs", runId, "learnings", `${specialist}-${taskId}.json`);
}
function missingFields(content) {
  return REQUIRED_FIELDS.filter((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return !pattern.test(content);
  });
}
function persistLearnings(envelope, outPath, specialist, taskId) {
  if (!envelope.learnings || envelope.learnings.length === 0) return;
  const record = {
    schema_version: "guild.learnings.v1",
    task_id: taskId,
    specialist,
    tier: envelope.tier,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    learnings: envelope.learnings
  };
  const dir = path3.dirname(outPath);
  fs3.mkdirSync(dir, { recursive: true });
  fs3.writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n", "utf8");
  process.stderr.write(`[task-completed] learnings persisted to ${outPath}
`);
}
function extractDependsOn(text) {
  const matches = text.matchAll(/depends[\s-]on:\s*([^\s,;]+)/gi);
  return Array.from(matches, (m) => m[1].trim());
}
function laneStatusFor(envelopeStatus) {
  if (envelopeStatus === null) return "done";
  return envelopeStatus === "done" ? "done" : "failed";
}
function deriveRunStateInit(runId) {
  const planSlug = process.env["GUILD_PLAN_SLUG"];
  const programId = process.env["GUILD_PROGRAM_ID"];
  const waveRaw = process.env["GUILD_WAVE_INDEX"];
  const waveIndex = waveRaw !== void 0 ? Number.parseInt(waveRaw, 10) : NaN;
  return {
    runId,
    planSlug: planSlug && planSlug.trim() !== "" ? planSlug : void 0,
    programId: programId && programId.trim() !== "" ? programId : null,
    waveIndex: Number.isFinite(waveIndex) ? waveIndex : void 0
  };
}
function persistRunState(runDir, runId, specialist, taskId, status, tier, dependsOn) {
  try {
    const patch = {
      status,
      receipt_ref: path3.join("handoffs", `${specialist}-${taskId}.md`)
    };
    if (tier !== void 0) patch.tier = tier;
    if (dependsOn.length > 0) patch.depends_on = dependsOn;
    upsertLane(runDir, deriveRunStateInit(runId), taskId, patch);
    process.stderr.write(
      `[task-completed] run-state checkpoint updated: lane "${taskId}" \u2192 ${status} (${runStatePathHint(runDir)}).
`
    );
  } catch (err) {
    process.stderr.write(
      `[task-completed] WARN: run-state checkpoint write failed (non-fatal, rebuildable cache): ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
function runStatePathHint(runDir) {
  return path3.join(runDir, "run-state.json");
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
  const sessionId = payload.session_id ?? "unknown";
  const taskId = payload.task_id ?? "(unknown)";
  const specialist = (payload.teammate_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const runId = deriveRunId(sessionId);
  const runDir = path3.join(guildRoot, ".guild", "runs", runId);
  const rPath = receiptPath(guildRoot, runId, specialist, taskId);
  if (!fs3.existsSync(rPath)) {
    die(
      `Task "${taskId}" (specialist: "${specialist}") has no handoff receipt. Expected at: ${rPath}
Write the receipt with sections: ${REQUIRED_FIELDS.join(", ")} before marking complete.`
    );
  }
  const content = fs3.readFileSync(rPath, "utf8");
  const missing = missingFields(content);
  if (missing.length > 0) {
    die(
      `Task "${taskId}" receipt at "${rPath}" is missing required \xA78.2 fields: [${missing.join(", ")}]. Add the missing sections before marking complete.`
    );
  }
  const rawEnvelope = extractHandoffEnvelope(content);
  let envelopeStatus = null;
  let laneTier;
  if (rawEnvelope !== null) {
    const { valid, errors } = validateHandoffV2(rawEnvelope);
    if (!valid) {
      die(
        `Task "${taskId}" receipt at "${rPath}" contains an invalid guild.handoff.v2 envelope.
Validation errors (SC-7 lint):
` + errors.map((e) => `  - ${e}`).join("\n")
      );
    }
    const envelope = rawEnvelope;
    envelopeStatus = envelope.status;
    laneTier = envelope.tier;
    const lPath = learningsPath(guildRoot, runId, specialist, taskId);
    persistLearnings(envelope, lPath, specialist, taskId);
    process.stderr.write(
      `[task-completed] OK: task "${taskId}" envelope validated (tier: ${envelope.tier}, status: ${envelope.status}).
`
    );
  } else {
    process.stderr.write(
      `[task-completed] NOTE: no guild.handoff.v2 envelope found in receipt \u2014 validation skipped (envelope optional for legacy receipts).
`
    );
  }
  const laneStatus = laneStatusFor(envelopeStatus);
  const dependsOn = extractDependsOn(`${payload.task_subject ?? ""} ${payload.task_description ?? ""}`);
  persistRunState(runDir, runId, specialist, taskId, laneStatus, laneTier, dependsOn);
  process.stderr.write(
    `[task-completed] OK: task "${taskId}" receipt verified at "${rPath}". Agent dismissed.
`
  );
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[task-completed] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
