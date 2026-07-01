#!/usr/bin/env -S npx tsx
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// using-guild-bootstrap.ts
var using_guild_bootstrap_exports = {};
__export(using_guild_bootstrap_exports, {
  buildSessionStartInjection: () => buildSessionStartInjection,
  gatewayContext: () => gatewayContext
});
module.exports = __toCommonJS(using_guild_bootstrap_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// lib/guild-hook-event.ts
async function readHookStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", () => resolve(""));
  });
}
function emitClaudeHookEvent(raw) {
  const parsed = JSON.parse(raw.trim());
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  return { ...parsed, host: "claude" };
}

// using-guild-bootstrap.ts
var USING_GUILD_SRC_REL = path.join(
  "skills",
  "meta",
  "using-guild",
  "SKILL.src.md"
);
function resolveUsingGuildSrc() {
  const fromEnv = process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    const candidate = path.join(fromEnv, USING_GUILD_SRC_REL);
    if (fs.existsSync(candidate)) return candidate;
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, USING_GUILD_SRC_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function gatewayContext(src) {
  return src.replace(/\r\n/g, "\n").trim();
}
function buildSessionStartInjection(gatewayBody) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: gatewayBody
    }
  });
}
async function main() {
  const raw = await readHookStdin();
  let _payload = {};
  try {
    _payload = emitClaudeHookEvent(raw);
  } catch {
  }
  const srcPath = resolveUsingGuildSrc();
  if (srcPath === null) {
    process.stderr.write(
      "[using-guild-bootstrap] warn: using-guild SKILL.src.md not found; skipping context injection.\n"
    );
    process.exit(0);
  }
  let context;
  try {
    context = gatewayContext(fs.readFileSync(srcPath, "utf8"));
  } catch (err) {
    process.stderr.write(
      `[using-guild-bootstrap] warn: failed to read ${srcPath}: ${err instanceof Error ? err.message : String(err)}; skipping.
`
    );
    process.exit(0);
  }
  if (context.length === 0) {
    process.stderr.write(
      "[using-guild-bootstrap] warn: using-guild source is empty; skipping.\n"
    );
    process.exit(0);
  }
  process.stdout.write(buildSessionStartInjection(context));
  process.exit(0);
}
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      `[using-guild-bootstrap] FATAL: ${err instanceof Error ? err.message : String(err)}
`
    );
    process.exit(0);
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  buildSessionStartInjection,
  gatewayContext
});
