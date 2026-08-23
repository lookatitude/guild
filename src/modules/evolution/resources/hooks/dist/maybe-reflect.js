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

// maybe-reflect.ts
var fs4 = __toESM(require("fs"));
var path5 = __toESM(require("path"));
var import_child_process = require("child_process");

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

// ../src/modules/lifecycle/workflows/run-binding.ts
var fsReal = __toESM(require("fs"));
var path3 = __toESM(require("path"));

// ../src/modules/kernel/workflows/module-manifest.ts
var OWNED_INVENTORY_CATEGORIES = Object.freeze([
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts"
]);

// ../src/modules/kernel/workflows/path-containment.ts
var fs2 = __toESM(require("node:fs"));
var path2 = __toESM(require("node:path"));
var CONTAINMENT_REFUSAL_CODES = Object.freeze([
  "root-unresolvable",
  "no-existing-ancestor",
  "dangling-symlink",
  "physical-symlink",
  "outside-root",
  "leaf-not-regular-file",
  "mkdir-failed",
  "parent-traversal",
  "destination-moved"
]);
function isRefused(r) {
  return "code" in r;
}
function escapes(rel) {
  return rel === ".." || rel.startsWith(`..${path2.sep}`) || path2.isAbsolute(rel);
}
function refuse(code, detail) {
  return Object.freeze({ contained: false, code, detail });
}
function hasParentSegment(p) {
  return p.split(/[\\/]/).includes("..");
}
function lstatOrNull(p) {
  try {
    return fs2.lstatSync(p);
  } catch {
    return null;
  }
}
function checkContained(root, target, options = {}) {
  const policy = options.policy ?? "resolve";
  let realRoot;
  try {
    realRoot = fs2.realpathSync(path2.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  const abs = path2.isAbsolute(target) ? path2.resolve(target) : path2.resolve(realRoot, target);
  let probe = abs;
  let probeStat = null;
  for (; ; ) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path2.dirname(probe);
    if (parent === probe) {
      return refuse("no-existing-ancestor", `no existing ancestor of ${abs}`);
    }
    probe = parent;
  }
  if (options.requireRegularFileLeaf && probe === abs && !probeStat.isFile()) {
    const what = probeStat.isSymbolicLink() ? "symlink" : probeStat.isDirectory() ? "directory" : "special file";
    return refuse(
      "leaf-not-regular-file",
      `${abs} exists and is not a regular file (${what}); refusing to write through it`
    );
  }
  let realProbe;
  try {
    realProbe = fs2.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }
  const rel = path2.relative(realRoot, realProbe);
  if (rel !== "" && escapes(rel)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }
  if (policy === "physical") {
    const parsed = path2.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path2.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path2.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal;
      try {
        segReal = fs2.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path2.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing \u2014 symlinked path segment: ${walk}`);
      }
    }
  }
  const tail = path2.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path2.join(realProbe, tail);
  return Object.freeze({ contained: true, realRoot, realPath });
}
function prepareContainedWrite(root, target, options = {}) {
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) \u2014 parent traversal cannot be resolved before symlinks`
    );
  }
  let canonRoot;
  try {
    canonRoot = fs2.realpathSync(path2.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path2.isAbsolute(target) ? path2.resolve(target) : path2.resolve(canonRoot, target);
  const dir = path2.dirname(abs);
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;
  try {
    fs2.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${err?.message ?? "unknown"}`);
  }
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;
  let realDir;
  try {
    realDir = fs2.realpathSync(dir);
  } catch {
    return refuse("dangling-symlink", `${dir} stopped resolving between the check and the write`);
  }
  return Object.freeze({
    contained: true,
    realRoot: post.realRoot,
    realPath: post.realPath,
    realDir
  });
}
function writeContainedFile(root, target, bytes, options = {}) {
  const prepared = prepareContainedWrite(root, target, {
    ...options,
    requireRegularFileLeaf: options.requireRegularFileLeaf ?? true
  });
  if (isRefused(prepared)) {
    return { written: false, code: prepared.code, detail: prepared.detail };
  }
  const dest = prepared.realPath;
  const tmp = `${dest}.tmp-${process.pid}`;
  let provenDir;
  try {
    provenDir = fs2.statSync(prepared.realDir);
  } catch (err) {
    return { written: false, code: "write-failed", detail: err?.message ?? "unknown" };
  }
  let fd = null;
  let created = false;
  try {
    fd = fs2.openSync(
      tmp,
      fs2.constants.O_WRONLY | fs2.constants.O_CREAT | fs2.constants.O_EXCL | fs2.constants.O_NOFOLLOW,
      384
    );
    created = true;
    const nowDir = fs2.statSync(prepared.realDir);
    if (nowDir.dev !== provenDir.dev || nowDir.ino !== provenDir.ino) {
      return {
        written: false,
        code: "destination-moved",
        detail: "the destination directory was replaced between the containment proof and the write"
      };
    }
    let off = 0;
    while (off < bytes.length) {
      const n = fs2.writeSync(fd, bytes, off, bytes.length - off);
      if (n <= 0) return { written: false, code: "write-failed", detail: "no progress on write" };
      off += n;
    }
    const writtenId = fs2.fstatSync(fd);
    fs2.fsyncSync(fd);
    fs2.closeSync(fd);
    fd = null;
    fs2.renameSync(tmp, dest);
    created = false;
    let landedId = null;
    try {
      landedId = fs2.lstatSync(dest);
    } catch {
      landedId = null;
    }
    const after = checkContained(root, dest, { policy: options.policy });
    if (isRefused(after) || landedId === null || landedId.dev !== writtenId.dev || landedId.ino !== writtenId.ino) {
      try {
        fs2.rmSync(dest, { force: true });
      } catch {
      }
      return {
        written: false,
        code: "destination-moved",
        detail: isRefused(after) ? `the written file resolved outside the root after the rename [${after.code}]` : "the file at the destination is not the file this call wrote"
      };
    }
    return { written: true, realPath: dest };
  } catch (err) {
    return { written: false, code: "write-failed", detail: err?.message ?? "unknown" };
  } finally {
    if (fd !== null) {
      try {
        fs2.closeSync(fd);
      } catch {
      }
    }
    if (created) {
      try {
        fs2.rmSync(tmp, { force: true });
      } catch {
      }
    }
  }
}

// ../src/modules/lifecycle/workflows/run-binding.ts
function realBindingFs() {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    writeFileAtomicContained: (root, p, c) => {
      const result = writeContainedFile(root, p, Buffer.from(c, "utf8"), { policy: "physical" });
      if (!result.written) {
        throw new Error(`pending substantive operation marker write refused [${result.code}]: ${result.detail}`);
      }
    },
    writeFileExclusive: (p, c) => {
      fsReal.mkdirSync(path3.dirname(p), { recursive: true });
      try {
        fsReal.writeFileSync(p, c, { encoding: "utf8", flag: "wx" });
        return true;
      } catch (error) {
        if (error.code === "EEXIST") return false;
        throw error;
      }
    },
    readFile: (p) => fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null,
    exists: (p) => fsReal.existsSync(p)
  };
}
function runBindingPath(root, runId) {
  return path3.join(root, ".guild", "runs", runId, "binding.json");
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
  const fs5 = opts.fs ?? realBindingFs();
  const raw = fs5.readFile(runBindingPath(opts.root, opts.run_id));
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

// lib/self-build.ts
var fs3 = __toESM(require("fs"));
var path4 = __toESM(require("path"));
var SELF_BUILD_MARKER = "Guild \u2014 repo orientation";
function fileContainsMarker(p) {
  try {
    if (!fs3.existsSync(p)) return false;
    return fs3.readFileSync(p, "utf8").includes(SELF_BUILD_MARKER);
  } catch {
    return false;
  }
}
function detectSelfBuild(root) {
  const directPath = path4.join(root, "AGENTS.md");
  if (fileContainsMarker(directPath)) return { armed: true, path: directPath };
  const nestedPath = path4.join(root, "plugin", "AGENTS.md");
  if (fileContainsMarker(nestedPath)) return { armed: true, path: nestedPath };
  return { armed: false, path: null };
}

// maybe-reflect.ts
async function readStdin() {
  return new Promise((resolve3) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve3(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve3(""));
  });
}
function loadEvents(eventsFile) {
  if (!fs4.existsSync(eventsFile)) return [];
  const content = fs4.readFileSync(eventsFile, "utf8");
  const events = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
    }
  }
  return events;
}
function gateCheck(events) {
  if (events.length === 0) return false;
  const hasSpecialist = events.some(
    (e) => e.event === "SubagentStop" && e.specialist && e.specialist.trim().length > 0
  );
  const isFileEditCall = (e) => (e.event === "PostToolUse" || e.event === "tool_call") && (e.tool === "Write" || e.tool === "Edit");
  const hasFileEdit = events.some(isFileEditCall);
  const hasError = events.some((e) => e.ok === false || e.status === "err");
  return hasSpecialist && hasFileEdit && !hasError;
}
function devteamSubagentGateCheck(events, cwd) {
  if (process.env["GUILD_ENABLE_DEVTEAM_REFLECT"] !== "1") {
    return { passed: false, reason: "GUILD_ENABLE_DEVTEAM_REFLECT != 1" };
  }
  const dispatchCount = events.filter(
    (e) => e.event === "SubagentStop" && typeof e.specialist === "string" && e.specialist.trim().length > 0
  ).length;
  if (dispatchCount < 3) {
    return {
      passed: false,
      reason: `dispatch count ${dispatchCount} < 3`
    };
  }
  const specDir = path5.join(resolveGuildRoot(cwd), ".guild", "spec");
  const slug = process.env["GUILD_SPEC_SLUG"];
  if (slug && slug.trim().length > 0) {
    const specPath = path5.join(specDir, `${slug}.md`);
    if (!fs4.existsSync(specPath)) {
      return { passed: false, reason: `spec not found: ${specPath}` };
    }
  } else {
    if (!fs4.existsSync(specDir)) {
      return { passed: false, reason: `spec dir not found: ${specDir}` };
    }
    let anySpec = false;
    try {
      const entries = fs4.readdirSync(specDir);
      anySpec = entries.some((name) => name.endsWith(".md"));
    } catch {
      anySpec = false;
    }
    if (!anySpec) {
      return { passed: false, reason: `no *.md spec under ${specDir}` };
    }
  }
  return { passed: true, reason: "all guards met" };
}
function writeStubSummary(runDir, runId, events) {
  const specialists = [
    ...new Set(events.map((e) => e.specialist).filter(Boolean))
  ];
  const tools = [...new Set(events.map((e) => e.tool).filter(Boolean))];
  const editCount = events.filter(
    (e) => e.tool === "Write" || e.tool === "Edit"
  ).length;
  const totalMs = events.reduce((acc, e) => acc + (e.ms ?? 0), 0);
  const lines = [
    `# Run summary: ${runId}`,
    "",
    `Generated: ${(/* @__PURE__ */ new Date()).toISOString()} (stub \u2014 trace-summarize.ts not yet available)`,
    "",
    "## Specialists dispatched",
    specialists.length > 0 ? specialists.map((s) => `- ${s}`).join("\n") : "- (none)",
    "",
    "## Tool activity",
    `- Total events: ${events.length}`,
    `- File edits: ${editCount}`,
    `- Unique tools: ${tools.join(", ") || "(none)"}`,
    `- Total duration: ${totalMs}ms`,
    "",
    "## Outcome",
    "Gate passed: specialist dispatched, file edited, no errors.",
    "",
    "<!-- fallback summary from maybe-reflect.ts \u2014 scripts/trace-summarize.ts was unavailable at this cwd. Install/restore scripts/trace-summarize.ts for the richer summary that guild:reflect prefers. -->"
  ];
  const summaryPath = path5.join(runDir, "summary.md");
  fs4.writeFileSync(summaryPath, lines.join("\n") + "\n", "utf8");
  process.stderr.write(`[maybe-reflect] wrote fallback summary to ${summaryPath}
`);
}
function tryRealSummarizer(cwd, runId) {
  const summarizerPath = path5.join(cwd, "scripts", "trace-summarize.ts");
  if (!fs4.existsSync(summarizerPath)) return false;
  const result = (0, import_child_process.spawnSync)(
    "npx",
    ["tsx", summarizerPath, "--run-id", runId, "--cwd", cwd],
    {
      cwd,
      encoding: "utf8",
      timeout: 15e3,
      env: { ...process.env }
    }
  );
  if (result.status !== 0) {
    process.stderr.write(
      `[maybe-reflect] trace-summarize.ts exited ${result.status}: ${result.stderr ?? ""}
`
    );
    return false;
  }
  return true;
}
var CODEX_SKIP_THRESHOLD = 3;
var CODEX_SKIP_EXIT_CODE = 2;
function reflectionRecordsCodexSkip(content) {
  const declared = content.match(/^[ \t]*codex_review:[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*$/im) ?? content.match(/<!--[ \t]*codex_review:[ \t]*([A-Za-z][A-Za-z0-9_-]*)[ \t]*-->/i);
  if (declared) return declared[1].toUpperCase() !== "RAN";
  const m = content.match(/skill_improvement:\s*\[([^\]]*)\]/);
  if (m && m[1].includes("guild:codex-review")) return true;
  return false;
}
function evaluateCodexSkipGuard(guildRoot) {
  try {
    const { armed } = detectSelfBuild(guildRoot);
    if (!armed) return { armed: false, streak: 0 };
    const reflectionsDir = path5.join(guildRoot, ".guild", "reflections");
    if (!fs4.existsSync(reflectionsDir)) return { armed: true, streak: 0 };
    const files = fs4.readdirSync(reflectionsDir).filter((f) => f.endsWith(".md")).map((f) => path5.join(reflectionsDir, f)).map((p) => {
      let mtime = 0;
      try {
        mtime = fs4.statSync(p).mtimeMs;
      } catch {
        mtime = 0;
      }
      return { path: p, mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    let streak = 0;
    for (const { path: p } of files) {
      let content = "";
      try {
        content = fs4.readFileSync(p, "utf8");
      } catch {
        break;
      }
      if (reflectionRecordsCodexSkip(content)) {
        streak += 1;
      } else {
        break;
      }
    }
    return { armed: true, streak };
  } catch {
    return { armed: false, streak: 0 };
  }
}
function clearCodexSkipSentinel(guildRoot) {
  try {
    const sentinel = path5.join(guildRoot, ".guild", "codex-skip-streak.json");
    if (!fs4.existsSync(sentinel)) return;
    fs4.rmSync(sentinel);
    process.stderr.write(
      `[maybe-reflect] codex-skip streak broken \u2014 cleared stale sentinel: ${sentinel}
`
    );
  } catch (err) {
    process.stderr.write(
      `[maybe-reflect] WARN: failed to clear codex-skip sentinel: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
function writeCodexSkipSentinel(guildRoot, streak) {
  try {
    const guildDir = path5.join(guildRoot, ".guild");
    fs4.mkdirSync(guildDir, { recursive: true });
    const sentinel = path5.join(guildDir, "codex-skip-streak.json");
    const data = {
      schema_version: "guild.codex_skip_streak.v1",
      streak,
      threshold: CODEX_SKIP_THRESHOLD,
      blocked: true,
      updated_at: (/* @__PURE__ */ new Date()).toISOString(),
      reason: "codex adversarial review skipped on >= 3 consecutive self-build reflections (FU-E)",
      clear_by: "run guild:codex-review at the next gate, OR record a reflection without a codex_review: SKIPPED marker, OR delete this file after an explicit operator override"
    };
    fs4.writeFileSync(sentinel, JSON.stringify(data, null, 2) + "\n", "utf8");
    process.stderr.write(
      `[maybe-reflect] wrote codex-skip sentinel: ${sentinel}
`
    );
  } catch (err) {
    process.stderr.write(
      `[maybe-reflect] WARN: failed to write codex-skip sentinel: ${err instanceof Error ? err.message : String(err)}
`
    );
  }
}
async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = JSON.parse(raw.trim());
  } catch {
    process.stderr.write("[maybe-reflect] WARN: invalid JSON on stdin; treating as non-task stop.\n");
    process.exit(0);
  }
  const cwd = process.env["GUILD_CWD"] ?? payload.cwd ?? process.cwd();
  const guildRoot = resolveGuildRoot(cwd);
  const codexGuard = evaluateCodexSkipGuard(guildRoot);
  if (codexGuard.armed && codexGuard.streak < CODEX_SKIP_THRESHOLD) {
    clearCodexSkipSentinel(guildRoot);
  }
  if (codexGuard.armed && codexGuard.streak >= CODEX_SKIP_THRESHOLD) {
    writeCodexSkipSentinel(guildRoot, codexGuard.streak);
    process.stderr.write(
      `
[maybe-reflect] \u26A0\u26A0\u26A0 DISCIPLINE HARD-FAIL \u26A0\u26A0\u26A0
[maybe-reflect] codex adversarial review has been SKIPPED on ${codexGuard.streak}
[maybe-reflect] consecutive self-build reflections (>= 3 threshold reached).
[maybe-reflect] A blocking sentinel was written to:
[maybe-reflect]   .guild/codex-skip-streak.json  (blocked: true)
[maybe-reflect] The NEXT G-gate (G-spec/G-plan/G-lane) must REFUSE to pass
[maybe-reflect] until codex review runs or the streak is cleared. To clear:
[maybe-reflect]   1. wire codex (\`codex --version\` + \`codex login\`, or OPENAI_API_KEY) and run
[maybe-reflect]      \`guild:codex-review\` at the gate, OR
[maybe-reflect]   2. record a reflection WITHOUT a codex_review: SKIPPED marker
[maybe-reflect]      (a real review breaks the consecutive streak), OR
[maybe-reflect]   3. delete .guild/codex-skip-streak.json after an explicit
[maybe-reflect]      operator override.
[maybe-reflect] See plugin/CLAUDE.md \xA7'Codex adversarial review'.

`
    );
    process.exit(CODEX_SKIP_EXIT_CODE);
  }
  const reflectAuth = authorizeHookWrite(guildRoot);
  if (reflectAuth.ok === false) {
    process.stderr.write(formatBindingRejected("maybe-reflect", reflectAuth));
    process.exit(0);
  }
  const runId = reflectAuth.run_id;
  const eventsRunDir = path5.join(guildRoot, ".guild", "runs", runId);
  const canonicalEventsFile = path5.join(eventsRunDir, "logs", "v1.4-events.jsonl");
  const legacyEventsFile = path5.join(eventsRunDir, "events.ndjson");
  const eventsFile = fs4.existsSync(canonicalEventsFile) ? canonicalEventsFile : legacyEventsFile;
  const events = loadEvents(eventsFile);
  const hookEvent = payload.hook_event_name ?? "Stop";
  if (hookEvent === "SubagentStop") {
    const result = devteamSubagentGateCheck(events, guildRoot);
    if (!result.passed) {
      process.stderr.write(
        `[maybe-reflect] dev-team gate failed for run ${runId}: ${result.reason} \u2014 skipping reflection.
`
      );
      process.exit(0);
    }
  } else {
    if (!gateCheck(events)) {
      process.stderr.write(
        `[maybe-reflect] gate failed for run ${runId} \u2014 skipping reflection.
`
      );
      process.exit(0);
    }
  }
  const runDir = path5.join(guildRoot, ".guild", "runs", runId);
  const usedRealSummarizer = tryRealSummarizer(cwd, runId);
  if (!usedRealSummarizer) {
    writeStubSummary(runDir, runId, events);
  }
  process.stdout.write(`GUILD_REFLECT run_id=${runId}
`);
  process.exit(0);
}
main().catch((err) => {
  process.stderr.write(
    `[maybe-reflect] FATAL: ${err instanceof Error ? err.message : String(err)}
`
  );
  process.exit(0);
});
