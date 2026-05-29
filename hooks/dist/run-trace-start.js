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

// lib/run-trace.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
var crypto = __toESM(require("crypto"));
function runDir(root, runId) {
  return path2.join(root, ".guild", "runs", runId);
}
function liveLogPath(root, runId) {
  return path2.join(runDir(root, runId), "logs", "v1.4-events.jsonl");
}
function resolveRunIdForTrace(root, env) {
  const fromEnv = env.GUILD_RUN_ID;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  const legacy = readSentinel(path2.join(root, ".guild", "runs", "current-run-id"));
  if (legacy) return legacy;
  const b2 = readSentinel(path2.join(root, ".guild", "current-run-id"));
  if (b2) return b2;
  return null;
}
function readSentinel(p) {
  try {
    const v = fs2.readFileSync(p, "utf8").trim();
    return v.length > 0 ? v : null;
  } catch {
    return null;
  }
}
function appendTraceLine(file, event) {
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  fs2.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
}
function readTraceLines(file) {
  try {
    return fs2.readFileSync(file, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
function emitRunStarted(root, runId, opts = {}) {
  try {
    const file = liveLogPath(root, runId);
    if (readTraceLines(file).some((e) => e.event_name === "run_started")) return;
    appendTraceLine(file, {
      schema_version: "guild.trace_event.v1",
      event_id: `evt-${crypto.randomUUID()}`,
      event_name: "run_started",
      run_id: runId,
      at: opts.now ?? (/* @__PURE__ */ new Date()).toISOString()
    });
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: emitRunStarted failed: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}

// run-trace-start.ts
async function readStdin() {
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const root = resolveGuildRoot(cwd);
  const runId = resolveRunIdForTrace(root, { GUILD_RUN_ID: process.env["GUILD_RUN_ID"] });
  if (!runId) {
    process.exit(0);
  }
  emitRunStarted(root, runId);
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[run-trace-start] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
