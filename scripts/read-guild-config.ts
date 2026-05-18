#!/usr/bin/env -S npx tsx
/**
 * scripts/read-guild-config.ts
 *
 * Reads .guild/config.yml from the current working directory (or --cwd override),
 * merges with CLI flag overrides, and prints the resolved config as JSON to stdout.
 *
 * Resolution order (first wins):
 *   1. CLI flags passed to /guild (--loops, --loop-cap, --auto-approve, --codex-review, --codex-cap)
 *   2. .guild/config.yml keys
 *   3. Built-in defaults
 *
 * Usage:
 *   npx tsx scripts/read-guild-config.ts [--cwd <path>] [--loops=all] [--codex-review] [--codex-cap=3]
 *
 * Stdout: JSON object with resolved config.
 * Stderr: warnings for unknown keys or parse errors.
 * Exit:   0 always — config failures must not block the lifecycle.
 */

import * as fs from "fs";
import * as path from "path";

interface GuildConfig {
  loops: "none" | "spec" | "plan" | "implementation" | "all" | string;
  loop_cap: number;
  auto_approve: "none" | "spec-and-plan" | "implementation" | "all";
  codex_review: boolean;
  codex_cap: number;
}

const DEFAULTS: GuildConfig = {
  loops: "none",
  loop_cap: 16,
  auto_approve: "none",
  codex_review: false,
  codex_cap: 5,
};

const VALID_LOOPS = new Set(["none", "spec", "plan", "implementation", "all"]);
const VALID_AUTO_APPROVE = new Set(["none", "spec-and-plan", "implementation", "all"]);

function parseArgs(argv: string[]): { cwd?: string; flags: Partial<GuildConfig> } {
  const flags: Partial<GuildConfig> = {};
  let cwd: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) {
      cwd = argv[++i];
    } else if (arg.startsWith("--loops=")) {
      flags.loops = arg.slice("--loops=".length);
    } else if (arg.startsWith("--loop-cap=")) {
      const n = parseInt(arg.slice("--loop-cap=".length), 10);
      if (!isNaN(n)) flags.loop_cap = Math.min(256, Math.max(1, n));
    } else if (arg.startsWith("--auto-approve=")) {
      const v = arg.slice("--auto-approve=".length);
      if (VALID_AUTO_APPROVE.has(v)) flags.auto_approve = v as GuildConfig["auto_approve"];
    } else if (arg === "--codex-review") {
      flags.codex_review = true;
    } else if (arg.startsWith("--codex-cap=")) {
      const n = parseInt(arg.slice("--codex-cap=".length), 10);
      if (!isNaN(n)) flags.codex_cap = Math.min(10, Math.max(1, n));
    }
  }

  return { cwd, flags };
}

function parseYamlSimple(content: string): Record<string, unknown> {
  // Minimal YAML parser for flat key: value pairs only.
  // Handles strings, numbers, booleans, and ignores comments.
  const result: Record<string, unknown> = {};
  for (const raw of content.split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || !line.includes(":")) continue;
    const colonIdx = line.indexOf(":");
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (!key) continue;
    if (val === "true") result[key] = true;
    else if (val === "false") result[key] = false;
    else if (/^\d+$/.test(val)) result[key] = parseInt(val, 10);
    else result[key] = val.replace(/^["']|["']$/g, "");
  }
  return result;
}

function readFileConfig(cwd: string): Partial<GuildConfig> {
  const configPath = path.join(cwd, ".guild", "config.yml");
  if (!fs.existsSync(configPath)) return {};

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    process.stderr.write("[read-guild-config] WARN: could not read .guild/config.yml\n");
    return {};
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseYamlSimple(raw);
  } catch {
    process.stderr.write("[read-guild-config] WARN: could not parse .guild/config.yml — using defaults\n");
    return {};
  }

  const out: Partial<GuildConfig> = {};
  const KNOWN_KEYS = new Set(["loops", "loop_cap", "auto_approve", "codex_review", "codex_cap"]);
  for (const k of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(k)) {
      process.stderr.write(`[read-guild-config] WARN: unknown config key "${k}" ignored\n`);
    }
  }

  if (typeof parsed["loops"] === "string") {
    // Accept comma-separated lists and single values
    out.loops = parsed["loops"] as string;
  }
  if (typeof parsed["loop_cap"] === "number") {
    out.loop_cap = Math.min(256, Math.max(1, parsed["loop_cap"]));
  }
  if (typeof parsed["auto_approve"] === "string" && VALID_AUTO_APPROVE.has(parsed["auto_approve"] as string)) {
    out.auto_approve = parsed["auto_approve"] as GuildConfig["auto_approve"];
  }
  if (typeof parsed["codex_review"] === "boolean") {
    out.codex_review = parsed["codex_review"];
  }
  if (typeof parsed["codex_cap"] === "number") {
    out.codex_cap = Math.min(10, Math.max(1, parsed["codex_cap"]));
  }

  return out;
}

function main(): void {
  const argv = process.argv.slice(2);
  const { cwd: cwdFlag, flags } = parseArgs(argv);
  const cwd = cwdFlag ?? process.env["GUILD_CWD"] ?? process.cwd();

  const fileConfig = readFileConfig(cwd);
  const resolved: GuildConfig = { ...DEFAULTS, ...fileConfig, ...flags };

  // Validate loops — must be one of the valid values or a CSV of valid values
  const loopValues = resolved.loops.split(",").map((v) => v.trim());
  for (const v of loopValues) {
    if (!VALID_LOOPS.has(v)) {
      process.stderr.write(`[read-guild-config] WARN: unknown --loops value "${v}"; treating as "none"\n`);
      resolved.loops = "none";
      break;
    }
  }

  process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
}

main();
