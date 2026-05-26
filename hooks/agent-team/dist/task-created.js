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
function markLaneInProgress(runDir, init, laneId, opts = {}) {
  return upsertLane(runDir, init, laneId, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on
  });
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
  const planDir = path3.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs3.existsSync(planDir)) return null;
  const files = fs3.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return null;
  const ids = /* @__PURE__ */ new Set();
  for (const file of files) {
    const content = fs3.readFileSync(path3.join(planDir, file), "utf8");
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
        `Task "${taskId}" has depends-on references [${deps.join(", ")}] but no plan file found at ${path3.join(resolveGuildRoot(cwd), ".guild/plan/")}. Skipping dependency check.`
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
  const runId = process.env["GUILD_RUN_ID"] ?? `run-${payload.session_id ?? "unknown"}`;
  const runDir = path3.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  try {
    markLaneInProgress(runDir, { runId }, taskId);
    process.stderr.write(
      `[task-created] run-state: lane "${taskId}" \u2192 in_progress (${path3.join(runDir, "run-state.json")}).
`
    );
  } catch (err) {
    process.stderr.write(
      `[task-created] WARN: run-state in_progress write failed (non-fatal, rebuildable cache): ${err instanceof Error ? err.message : String(err)}
`
    );
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
