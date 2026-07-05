#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    if (process.stdin.isTTY) resolve("");
  });
}

function pluginRoot() {
  if (process.env.GUILD_PLUGIN_ROOT) return process.env.GUILD_PLUGIN_ROOT;
  if (process.env.PLUGIN_ROOT) return process.env.PLUGIN_ROOT;
  if (process.env.CLAUDE_PLUGIN_ROOT) return process.env.CLAUDE_PLUGIN_ROOT;
  return path.resolve(__dirname, "..");
}

function parsePayload(raw) {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function promptFromPayload(payload) {
  if (typeof payload.prompt === "string") return payload.prompt;
  if (typeof payload.user_prompt === "string") return payload.user_prompt;
  if (payload.message && typeof payload.message === "object" && typeof payload.message.content === "string") {
    return payload.message.content;
  }
  return "";
}

function parseGuildPrompt(prompt) {
  const trimmed = prompt.trimStart();
  const match = trimmed.match(/^\/guild(?::([A-Za-z0-9_-]+)|(?:\s+([A-Za-z0-9_-]+))?)?([\s\S]*)$/);
  if (!match) return null;
  const colonVerb = match[1] || "";
  const spaceVerb = match[2] || "";
  const verb = colonVerb || (spaceVerb && !spaceVerb.startsWith("--") ? spaceVerb : "guild");
  const args =
    colonVerb || spaceVerb
      ? (match[3] || "").trim()
      : trimmed.slice("/guild".length).trim();
  return { verb, args };
}

function loadRegistry(root) {
  const registryPath = path.join(root, "command-src", "command-registry.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const commands = Array.isArray(registry.commands) ? registry.commands : [];
  return commands;
}

function commandContext(entry, args) {
  const requested = args ? `/guild:${entry.name} ${args}` : `/guild:${entry.name}`;
  const allowedTools = Array.isArray(entry.allowed_tools) ? entry.allowed_tools.join(", ") : "";
  return [
    "# Guild Codex App Command Bridge",
    "The user entered a Guild slash command in a Codex surface. Treat the request as the Guild command below.",
    `Requested command: ${requested}`,
    `Command id: ${entry.id}`,
    `Argument hint: ${entry.argument_hint || ""}`,
    `Allowed tools: ${allowedTools}`,
    args ? `User arguments: ${args}` : "User arguments: (none)",
    "## Command Description",
    entry.description || "",
    "## Command Body",
    entry.body || "",
  ].join("\n\n");
}

function emitAdditionalContext(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context,
    },
  }));
}

function emitBlock(reason) {
  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

async function main() {
  const payload = parsePayload(await readStdin());
  const parsed = parseGuildPrompt(promptFromPayload(payload));
  if (!parsed) return;

  const root = pluginRoot();
  let commands;
  try {
    commands = loadRegistry(root);
  } catch (err) {
    emitBlock(`Guild command bridge could not read command registry: ${String(err)}`);
    return;
  }

  const entry = commands.find((command) => command && command.id === parsed.verb);
  if (!entry) {
    const known = commands.map((command) => command.id).filter(Boolean).sort().join(", ");
    emitBlock(`Unknown Guild command "/guild:${parsed.verb}". Known commands: ${known}`);
    return;
  }

  emitAdditionalContext(commandContext(entry, parsed.args));
}

main().catch((err) => {
  emitBlock(`Guild command bridge failed: ${String(err)}`);
});
