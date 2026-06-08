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

// agent-team/teammate-idle.ts
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
var ALLOWED_TOP_LEVEL_KEYS = /* @__PURE__ */ new Set([
  "schema_version",
  "task_id",
  "tier",
  "status",
  "summary",
  "artifacts",
  "issues",
  "escalate_reason",
  "learnings",
  "notes",
  "injection_clean"
  // HK-08 additive-optional
]);
function validateHandoffV2(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["envelope must be a non-null object"] };
  }
  const obj = value;
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_TOP_LEVEL_KEYS.has(k)) {
      errors.push(
        `unknown key "${k}" \u2014 strict guild.handoff.v2 rejects extra/misspelled keys`
      );
    }
  }
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
  if (obj["injection_clean"] !== void 0) {
    const validValues = /* @__PURE__ */ new Set(["clean", "flagged", "unverified"]);
    if (!validValues.has(obj["injection_clean"])) {
      errors.push(
        `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
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

// lib/heartbeat.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1e3;
function heartbeatPath(runDir, specialist) {
  return path2.join(runDir, "in-progress", `${specialist}.json`);
}
function legacyLogPath(runDir, specialist) {
  return path2.join(runDir, "in-progress", `${specialist}.log`);
}
function readHeartbeat(runDir, specialist) {
  let raw;
  try {
    raw = fs2.readFileSync(heartbeatPath(runDir, specialist), "utf8");
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed;
  if (typeof obj["timestamp"] !== "string" || obj["timestamp"].trim() === "") {
    return null;
  }
  const hb = { timestamp: obj["timestamp"] };
  if (typeof obj["step"] === "string") hb.step = obj["step"];
  if (typeof obj["pct_complete"] === "number") hb.pct_complete = obj["pct_complete"];
  if (typeof obj["last_action"] === "string") hb.last_action = obj["last_action"];
  return hb;
}
function readHeartbeatTimeoutMs(cwd) {
  const settingsPath = path2.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw;
  try {
    raw = fs2.readFileSync(settingsPath, "utf8");
  } catch {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  const defaults = parsed["defaults"];
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }
  const val = defaults["heartbeat_timeout_ms"];
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  return DEFAULT_HEARTBEAT_TIMEOUT_MS;
}
function assessLiveness(runDir, specialist, timeoutMs, now = Date.now()) {
  const hb = readHeartbeat(runDir, specialist);
  if (hb) {
    const parsedMs = Date.parse(hb.timestamp);
    const ageMs = Number.isNaN(parsedMs) ? 0 : Math.max(0, now - parsedMs);
    const out = {
      source: "heartbeat",
      fresh: ageMs < timeoutMs,
      ageMs
    };
    if (hb.step !== void 0) out.step = hb.step;
    if (hb.pct_complete !== void 0) out.pctComplete = hb.pct_complete;
    return out;
  }
  const logPath = legacyLogPath(runDir, specialist);
  try {
    const stat = fs2.statSync(logPath);
    const ageMs = Math.max(0, now - stat.mtimeMs);
    return { source: "mtime", fresh: ageMs < timeoutMs, ageMs };
  } catch {
    return { source: "none", fresh: false, ageMs: null };
  }
}

// agent-team/teammate-idle.ts
function deriveRunId(sessionId) {
  return process.env["GUILD_RUN_ID"] ?? `run-${sessionId}`;
}
function assessReceipts(runDir, teammate) {
  const handoffsDir = path3.join(runDir, "handoffs");
  if (!fs3.existsSync(handoffsDir)) return [];
  const prefix = `${teammate}-`;
  const results = [];
  const files = fs3.readdirSync(handoffsDir).filter((f) => f.startsWith(prefix) && f.endsWith(".md"));
  for (const file of files) {
    const taskId = file.slice(prefix.length, -".md".length);
    const rPath = path3.join(handoffsDir, file);
    let envelopeValid = false;
    let envelopeErrors = [];
    let envelopeStatus;
    try {
      const content = fs3.readFileSync(rPath, "utf8");
      const rawEnvelope = extractHandoffEnvelope(content);
      if (rawEnvelope !== null) {
        const result = validateHandoffV2(rawEnvelope);
        envelopeValid = result.valid;
        envelopeErrors = result.errors;
        if (result.valid) {
          const env = rawEnvelope;
          envelopeStatus = typeof env["status"] === "string" ? env["status"] : void 0;
        }
      } else {
        envelopeErrors = ["no guild.handoff.v2 envelope found in receipt"];
      }
    } catch (err) {
      envelopeErrors = [
        `could not read receipt: ${err instanceof Error ? err.message : String(err)}`
      ];
    }
    results.push({ taskId, receiptPath: rPath, envelopeValid, envelopeErrors, envelopeStatus });
  }
  return results;
}
function findAssignedTaskIds(cwd, teammate) {
  const planDir = path3.join(resolveGuildRoot(cwd), ".guild", "plan");
  if (!fs3.existsSync(planDir)) return [];
  const files = fs3.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  const ids = [];
  for (const file of files) {
    const content = fs3.readFileSync(path3.join(planDir, file), "utf8");
    const blocks = content.split(/\n(?=[-*#]|\w)/);
    for (const block of blocks) {
      const isAssigned = new RegExp(`(?:owner|assigned|teammate):\\s*${teammate}\\b`, "i").test(block);
      if (isAssigned) {
        const idMatch = block.match(/\bid:\s*(task-[\w-]+)/i) ?? block.match(/^\s*[-*]\s*(task-[\w-]+):/im);
        if (idMatch) ids.push(idMatch[1]);
      }
    }
  }
  return ids;
}
function renderLiveness(liveness) {
  if (liveness.source === "none") {
    return `liveness: no heartbeat or progress log found (cannot confirm activity)`;
  }
  const ageSec = liveness.ageMs !== null ? Math.round(liveness.ageMs / 1e3) : "?";
  const freshness = liveness.fresh ? "FRESH (active)" : "STALE (possible stall)";
  if (liveness.source === "heartbeat") {
    const phase = liveness.step ? ` phase="${liveness.step}"` : "";
    const pct = liveness.pctComplete !== void 0 ? ` ${liveness.pctComplete}%` : "";
    return `liveness: heartbeat ${freshness}, last progress ${ageSec}s ago${phase}${pct}`;
  }
  return `liveness: legacy log mtime ${freshness}, last touched ${ageSec}s ago (no structured heartbeat)`;
}
function composeNudge(ctx) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const livenessLine = renderLiveness(ctx.liveness);
  const hasPending = ctx.pendingTaskIds.length > 0;
  const hasInvalid = ctx.invalidReceiptTaskIds.length > 0;
  const hasValid = ctx.validReceiptTaskIds.length > 0;
  if (hasValid && !hasPending && !hasInvalid) {
    const receipts = ctx.validReceipts.map((r) => r.receiptPath).join(", ");
    const pointerLines = ctx.validReceipts.map(
      (r) => `done \xB7 ${r.taskId} \xB7 status:${r.envelopeStatus ?? "done"} \xB7 receipt:${r.receiptPath}`
    ).join("\n");
    const dismissLines = ctx.validReceipts.map(
      (r) => `[AUTO-DISMISS] teammate="${ctx.teammate}" team="${ctx.teamName}" reason=valid-receipt task=${r.taskId}`
    ).join("\n");
    return `[TeammateIdle ${timestamp}] [LANE-COMPLETE] teammate="${ctx.teammate}" team="${ctx.teamName}" status=safe-to-dismiss
${livenessLine}
Valid guild.handoff.v2 receipt(s) confirmed: ${receipts}
${pointerLines}
${dismissLines}
The launcher may safely dismiss this pane.
`;
  }
  if (hasPending) {
    const paths = ctx.pendingTaskIds.map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`).join(", ");
    return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle but has ${ctx.pendingTaskIds.length} incomplete task(s): [${ctx.pendingTaskIds.join(", ")}].
${livenessLine}
write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.
Required sections: changed_files, opens_for, assumptions, evidence, followups.
Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):
\`\`\`guild.handoff.v2
{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }
\`\`\`
Or, if still working, update the structured heartbeat at ${ctx.runDir}/in-progress/${ctx.teammate}.json ({ timestamp, step, pct_complete, last_action }) to signal progress.
`;
  }
  if (hasInvalid) {
    const paths = ctx.invalidReceiptTaskIds.map((tid) => `${ctx.runDir}/handoffs/${ctx.teammate}-${tid}.md`).join(", ");
    return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") has a receipt but the guild.handoff.v2 envelope is missing or invalid.
${livenessLine}
write your guild.handoff.v2 receipt to ${paths}; do not paste it in chat.
Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):
\`\`\`guild.handoff.v2
{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }
\`\`\`
`;
  }
  const taskIdHint = process.env["GUILD_TASK_ID"] ?? "<task-id>";
  return `[TeammateIdle ${timestamp}] Teammate "${ctx.teammate}" (team: "${ctx.teamName}") is idle.
${livenessLine}
If you have an active task, write your guild.handoff.v2 receipt to ${ctx.runDir}/handoffs/${ctx.teammate}-${taskIdHint}.md; do not paste it in chat.
Required sections: changed_files, opens_for, assumptions, evidence, followups.
Required format: a strict fenced JSON block (the envelope is JSON inside the fenced block, NOT YAML frontmatter; a frontmatter-only receipt is rejected):
\`\`\`guild.handoff.v2
{ "schema_version": "guild.handoff.v2", "task_id": "...", "tier": "cheap|mid|powerful", "status": "done|blocked|escalate", "summary": "...", "artifacts": [], "issues": [] }
\`\`\`
Heartbeat path: ${ctx.runDir}/in-progress/${ctx.teammate}.json ({ timestamp, step, pct_complete, last_action }).
If all tasks are complete, no action is needed.
`;
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
    process.stderr.write(`[teammate-idle] WARN: Invalid JSON on stdin: ${raw.slice(0, 120)}
`);
    process.exit(0);
  }
  const sessionId = payload.session_id ?? "unknown";
  const teammate = (payload.teammate_name ?? "").trim() || "unknown";
  const teamName = (payload.team_name ?? "").trim() || "unknown";
  const cwd = payload.cwd ?? process.cwd();
  const runId = deriveRunId(sessionId);
  const runDir = path3.join(resolveGuildRoot(cwd), ".guild", "runs", runId);
  const receiptAssessments = assessReceipts(runDir, teammate);
  const validReceiptTaskIds = receiptAssessments.filter((r) => r.envelopeValid).map((r) => r.taskId);
  const invalidReceiptTaskIds = receiptAssessments.filter((r) => !r.envelopeValid).map((r) => r.taskId);
  const completedIds = new Set(receiptAssessments.map((r) => r.taskId));
  const assignedIds = findAssignedTaskIds(cwd, teammate);
  const pendingTaskIds = assignedIds.filter((id) => !completedIds.has(id));
  const hasReceipt = receiptAssessments.length > 0;
  const timeoutMs = readHeartbeatTimeoutMs(cwd);
  const liveness = assessLiveness(runDir, teammate, timeoutMs);
  process.stderr.write(
    `[teammate-idle] INFO: teammate="${teammate}" assigned=[${assignedIds.join(",")}] validReceipts=[${validReceiptTaskIds.join(",")}] invalidReceipts=[${invalidReceiptTaskIds.join(",")}] pending=[${pendingTaskIds.join(",")}] liveness=${liveness.source}/${liveness.fresh ? "fresh" : "stale"} ageMs=${liveness.ageMs ?? "n/a"} timeoutMs=${timeoutMs}
`
  );
  const validReceipts = receiptAssessments.filter((r) => r.envelopeValid);
  const ctx = {
    teammate,
    teamName,
    runId,
    hasReceipt,
    liveness,
    pendingTaskIds,
    invalidReceiptTaskIds,
    validReceiptTaskIds,
    validReceipts,
    runDir
  };
  process.stdout.write(composeNudge(ctx));
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[teammate-idle] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
