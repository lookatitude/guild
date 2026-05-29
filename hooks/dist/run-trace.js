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
var path3 = __toESM(require("path"));

// ../scripts/lib/run-lifecycle.ts
var crypto = __toESM(require("crypto"));
var fsNode = __toESM(require("fs"));
var path2 = __toESM(require("path"));
function runDir(root, runId) {
  return path2.join(root, ".guild", "runs", runId);
}
function runYamlPath(root, runId) {
  return path2.join(runDir(root, runId), "run.yaml");
}
function provenancePath(root, runId) {
  return path2.join(runDir(root, runId), "provenance.json");
}
function metadataPath(root, runId) {
  return path2.join(runDir(root, runId), "metadata.json");
}
function logsDir(root, runId) {
  return path2.join(runDir(root, runId), "logs");
}
function sentinelPath(root) {
  return path2.join(root, ".guild", "runs", "current-run-id");
}
function logRefFor(runId) {
  return `.guild/runs/${runId}/logs/v1.4-events.jsonl`;
}
function utcCompact(nowIso) {
  const d = new Date(nowIso);
  const iso = Number.isNaN(d.getTime()) ? nowIso : d.toISOString();
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
  const digits = iso.replace(/\D/g, "");
  return `${digits.slice(0, 8)}-${digits.slice(8, 14)}`;
}
function makeRunId(initiative, nowIso) {
  if (initiative) return `run-${initiative}-${utcCompact(nowIso)}`;
  return `run-${crypto.randomUUID()}`;
}
function yamlScalar(v) {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (v === "") return '""';
  if (/^[\w./:@+-]+$/.test(v) && !/^\d{4}-\d{2}/.test(v)) return v;
  if (/^[^\s#:][^#]*$/.test(v) && !v.includes(": ") && !/[:#]$/.test(v)) return v;
  return JSON.stringify(v);
}
function serializeRunYaml(rec) {
  const lines = [];
  const emit = (obj, indent) => {
    const pad = "  ".repeat(indent);
    for (const [k, val] of Object.entries(obj)) {
      if (val === void 0) continue;
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${pad}${k}: []`);
        } else if (val.every((x) => typeof x !== "object" || x === null)) {
          lines.push(`${pad}${k}: [${val.map((x) => yamlScalar(x)).join(", ")}]`);
        } else {
          lines.push(`${pad}${k}:`);
          for (const item of val) {
            if (item && typeof item === "object") {
              const entries = Object.entries(item);
              entries.forEach(([ik, iv], i) => {
                const prefix = i === 0 ? `${pad}  - ` : `${pad}    `;
                lines.push(`${prefix}${ik}: ${yamlScalar(iv)}`);
              });
            } else {
              lines.push(`${pad}  - ${yamlScalar(item)}`);
            }
          }
        }
      } else if (val && typeof val === "object") {
        const entries = Object.entries(val);
        if (entries.length === 0) {
          lines.push(`${pad}${k}: {}`);
        } else {
          lines.push(`${pad}${k}:`);
          emit(val, indent + 1);
        }
      } else {
        lines.push(`${pad}${k}: ${yamlScalar(val)}`);
      }
    }
  };
  emit(rec, 0);
  return lines.join("\n") + "\n";
}
function buildRunManifest(opts, runId, env) {
  const host = env.resolveHost(opts.host_requested);
  const runClass = opts.run_class ?? "full";
  const workspace = {
    is_workspace: opts.workspace.is_workspace,
    root: opts.workspace.root
  };
  if (opts.workspace.sub_guilds && opts.workspace.sub_guilds.length > 0) {
    workspace["sub_guilds"] = opts.workspace.sub_guilds;
  }
  const hostBlock = {
    requested: host.requested,
    resolved: host.resolved
  };
  if (host.capabilities_ref) hostBlock["capabilities_ref"] = host.capabilities_ref;
  const phase = opts.phase ?? null;
  return {
    schema_version: "guild.run.v1",
    run_id: runId,
    command: opts.command,
    arguments: opts.arguments,
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    workspace,
    project: opts.project,
    host: hostBlock,
    model_tier_policy: opts.model_tier_policy,
    started_at: env.now(),
    ignore_policy: opts.ignore_policy,
    scan_policy: opts.scan_policy,
    initiative_attachment: opts.initiative,
    // NN#5: scalar record ONLY
    phase,
    run_class: runClass,
    gates: {},
    status: "open",
    phases_log: phase ? [{ phase, at: env.now() }] : []
  };
}
function emptyTouched() {
  return { tasks: [], agents: [], skills: [], decisions: [], features: [], files: [], runs: [] };
}
function mergeTouched(supplied) {
  const base = emptyTouched();
  if (!supplied) return base;
  for (const k of Object.keys(base)) {
    const v = supplied[k];
    if (Array.isArray(v)) base[k] = v;
  }
  return base;
}
function readStartFacts(env, root, runId) {
  const raw = env.fs.readFile(runYamlPath(root, runId));
  if (raw === null) {
    throw new Error(
      `[run-lifecycle] closeRun("${runId}"): no run.yaml at ${runYamlPath(root, runId)} \u2014 cannot close a run that was never started.`
    );
  }
  const get = (key) => {
    const m = raw.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const command = get("command") ?? "";
  const initRaw = get("initiative_attachment");
  const initiative = initRaw === null || initRaw === "null" || initRaw === "" ? null : initRaw;
  const runClassRaw = get("run_class");
  const run_class = runClassRaw === "lightweight" ? "lightweight" : "full";
  const started_at = get("started_at") ?? "";
  const self_build = /^[\s\S]*self_build:[ \t]*true/m.test(raw);
  return { command, initiative, run_class, started_at, self_build };
}
function flipRunStatus(env, root, runId, status) {
  const p = runYamlPath(root, runId);
  const raw = env.fs.readFile(p);
  if (raw === null) return;
  const next = raw.replace(/^status:[ \t]*.*$/m, `status: ${status}`);
  env.fs.writeFile(p, next);
}
function createRunLifecycle(env) {
  return {
    startRun(opts) {
      const runId = makeRunId(opts.initiative, env.now());
      const root = opts.root;
      env.fs.mkdirp(logsDir(root, runId));
      const manifest = buildRunManifest(opts, runId, env);
      env.fs.writeFile(runYamlPath(root, runId), serializeRunYaml(manifest));
      env.fs.writeFile(sentinelPath(root), runId);
      return runId;
    },
    closeRun(runId, opts) {
      const root = resolveCloseRoot(env, runId);
      const facts = readStartFacts(env, root, runId);
      const runClass = facts.run_class;
      const now = env.now();
      const finalCheckpoint = runClass === "lightweight" ? null : opts.final_learning_checkpoint ?? null;
      const terminalTraceEvent = {
        event_id: `evt-${crypto.randomUUID()}`,
        event_name: "run_closed",
        at: now,
        log_ref: logRefFor(runId)
      };
      const provenance = {
        schema_version: "guild.provenance.v1",
        run_id: runId,
        command: facts.command,
        initiative: facts.initiative,
        retention_class: facts.initiative ? "until-archive" : "one-off-90d",
        started_at: facts.started_at,
        closed_at: now,
        status: opts.status,
        run_class: runClass,
        terminal_trace_event: terminalTraceEvent,
        final_learning_checkpoint: finalCheckpoint,
        gates: opts.gates ?? {},
        touched: mergeTouched(opts.touched),
        artifacts: opts.artifacts ?? {},
        benchmark_eligible: opts.status === "closed"
      };
      if (opts.coverage) provenance.coverage = opts.coverage;
      env.fs.writeFile(provenancePath(root, runId), JSON.stringify(provenance, null, 2) + "\n");
      const a = opts.artifacts ?? {};
      const metadata = {
        run_id: runId,
        initiative: facts.initiative,
        spec: a["spec"] ?? null,
        plan: a["plan"] ?? null,
        team: a["team"] ?? null,
        backend: a["backend"] ?? null,
        started_at: facts.started_at,
        self_build: facts.self_build
      };
      env.fs.writeFile(metadataPath(root, runId), JSON.stringify(metadata, null, 2) + "\n");
      flipRunStatus(env, root, runId, opts.status);
    }
  };
}
function resolveCloseRoot(env, runId) {
  const hint = env.__rootHint;
  if (hint) return hint;
  const cwd = process.cwd();
  if (env.fs.exists(runYamlPath(cwd, runId))) return cwd;
  return cwd;
}
function createRealEnv(root, resolveHost) {
  const env = {
    now: () => (/* @__PURE__ */ new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fs: {
      mkdirp(absPath) {
        fsNode.mkdirSync(absPath, { recursive: true });
      },
      writeFile(absPath, contents) {
        fsNode.mkdirSync(path2.dirname(absPath), { recursive: true });
        fsNode.writeFileSync(absPath, contents, "utf8");
      },
      readFile(absPath) {
        try {
          return fsNode.readFileSync(absPath, "utf8");
        } catch {
          return null;
        }
      },
      exists(absPath) {
        return fsNode.existsSync(absPath);
      }
    },
    resolveHost,
    __rootHint: root
  };
  return env;
}
function readRecordStatusRuns(root) {
  try {
    const raw = fsNode.readFileSync(path2.join(root, ".guild", "settings.json"), "utf8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj["record_status_runs"] === "boolean") {
      return obj["record_status_runs"];
    }
  } catch {
    return true;
  }
  return true;
}

// lib/run-trace.ts
function runDir2(root, runId) {
  return path3.join(root, ".guild", "runs", runId);
}
function skippedFilesPath(root, runId) {
  return path3.join(runDir2(root, runId), "learn", "skipped-files.json");
}
function defaultResolveHost(requested) {
  const raw = (process.env["GUILD_HOST"] ?? requested ?? "").trim().toLowerCase();
  const resolved = raw === "codex" ? "codex" : raw === "gemini" ? "gemini" : raw === "pi" ? "pi" : "claude";
  return { requested, resolved };
}
function startAndCloseRun(root, resolveHost, opts = {}) {
  const runClass = opts.run_class ?? "full";
  const command = opts.command ?? "/guild:learn";
  const cwd = opts.cwd ?? root;
  const targetKind = opts.target_kind ?? "existing_guild_project";
  const tierPolicy = runClass === "lightweight" ? "n/a (read-only lightweight run)" : "default (full run)";
  const scanPolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const ignorePolicy = runClass === "lightweight" ? "n/a (no scan)" : "default";
  const phase = runClass === "lightweight" ? command.replace(/^\/guild:/, "") : null;
  try {
    const lifecycle = createRunLifecycle(createRealEnv(root, resolveHost));
    const runId = lifecycle.startRun({
      command,
      arguments: {},
      cwd,
      root,
      target_kind: targetKind,
      workspace: { is_workspace: false, root },
      project: runClass === "lightweight" ? command.replace(/^\/guild:/, "") : "project",
      host_requested: process.env["GUILD_HOST"] ?? "auto",
      model_tier_policy: tierPolicy,
      ignore_policy: ignorePolicy,
      scan_policy: scanPolicy,
      initiative: null,
      phase,
      run_class: runClass
    });
    lifecycle.closeRun(runId, { status: "closed" });
    return runId;
  } catch (err) {
    process.stderr.write(
      `[run-trace] WARN: startAndCloseRun failed: ${err instanceof Error ? err.message : String(err)}
`
    );
    return null;
  }
}
function recordStatusLightweight(root, resolveHost, opts = {}) {
  if (!readRecordStatusRuns(root)) return null;
  return startAndCloseRun(root, resolveHost, {
    command: "/guild:status",
    cwd: opts.cwd,
    target_kind: opts.target_kind,
    run_class: "lightweight"
  });
}
function writeSkippedFiles(root, runId, entries) {
  const out = skippedFilesPath(root, runId);
  const body = {
    schema_version: "guild.skipped_files.v1",
    run_id: runId,
    generated_at: (/* @__PURE__ */ new Date()).toISOString(),
    skipped_count: entries.length,
    skipped: entries
  };
  fs2.mkdirSync(path3.dirname(out), { recursive: true });
  fs2.writeFileSync(out, JSON.stringify(body, null, 2) + "\n", "utf8");
  return out;
}

// run-trace.ts
function flag(argv, name) {
  const prefix = `--${name}=`;
  const eqMatch = argv.find((a) => a.startsWith(prefix));
  if (eqMatch) return eqMatch.slice(prefix.length);
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : void 0;
}
async function readStdin() {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve2) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve2(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve2(""));
  });
}
var USAGE = "usage: run-trace.ts <start|status|skipped> [--cwd <root>] [--run-id <id>]\n  start   --command=/guild:learn [--run-class=full|lightweight] [--cwd <root>]\n  status  [--cwd <root>]   (alias: start --run-class=lightweight + OQ6 gate)\n  skipped --run-id <id>    [--cwd <root>] < entries.json\n";
async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];
  const cwd = flag(argv, "cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
  const root = resolveGuildRoot(cwd);
  if (sub === "start") {
    const command = flag(argv, "command") ?? "/guild:learn";
    const runClassRaw = flag(argv, "run-class");
    const runClass = runClassRaw === "lightweight" ? "lightweight" : "full";
    const runId = startAndCloseRun(root, defaultResolveHost, {
      command,
      cwd,
      run_class: runClass
    });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }
  if (sub === "status") {
    const runId = recordStatusLightweight(root, defaultResolveHost, { cwd });
    if (runId) process.stdout.write(runId + "\n");
    process.exit(0);
  }
  if (sub === "skipped") {
    const runId = flag(argv, "run-id") ?? process.env["GUILD_RUN_ID"];
    if (!runId) {
      process.stderr.write("[run-trace] usage: skipped --run-id <id> [--cwd <root>] < entries.json\n");
      process.exit(1);
    }
    const raw = await readStdin();
    let entries = [];
    try {
      const parsed = JSON.parse(raw.trim() || "[]");
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      process.stderr.write("[run-trace] skipped: invalid JSON on stdin; writing empty set.\n");
    }
    const out = writeSkippedFiles(root, runId, entries);
    process.stdout.write(out + "\n");
    process.exit(0);
  }
  process.stderr.write("[run-trace] " + USAGE);
  process.exit(1);
}
main().catch((err) => {
  process.stderr.write(
    `[run-trace] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(1);
});
