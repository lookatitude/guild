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
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var readline = __toESM(require("readline"));
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
  const planDir = path.join(cwd, ".guild", "plan");
  if (!fs.existsSync(planDir)) return null;
  const files = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return null;
  const ids = /* @__PURE__ */ new Set();
  for (const file of files) {
    const content = fs.readFileSync(path.join(planDir, file), "utf8");
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
        `Task "${taskId}" has depends-on references [${deps.join(", ")}] but no plan file found at ${path.join(cwd, ".guild/plan/")}. Skipping dependency check.`
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
