/**
 * scripts/lib/isolated-host-install.ts
 *
 * Real install + activation of the built Guild host package into a throwaway
 * config root (operator decision D2, 2026-10-19). Claude gets its own
 * CLAUDE_CONFIG_DIR, Codex its own CODEX_HOME, both with HOME, TMPDIR and XDG_*
 * inside the same root under OS temp. The live ~/.claude and ~/.codex are never
 * a target: the root is refused when it resolves into them, and a watched set
 * of live install-state files must be byte-identical after the run.
 *
 * Observation, not inference: `real_install_activation` is verified only when
 * the host's own install + list commands report Guild enabled inside the root;
 * `native_plugin_load` only when a started host shows Guild loaded (Claude: the
 * stream-json init lists the plugin and its commands and a Guild SessionStart
 * hook fired; Codex: the rendered model-visible prompt lists a Guild skill from
 * the isolated install). Neither path needs host auth: no model turn runs.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ISOLATED_INSTALL_EVIDENCE_PREFIX, type SmokeCheck } from "./host-public-state";

export type IsolatedInstallHost = "claude-code-cli" | "codex-cli";

export const ISOLATED_INSTALL_REFUSALS = Object.freeze([
  "isolated_root_in_live_config",
  "isolated_root_outside_os_temp",
  "isolated_root_not_fresh",
  "package_build_failed",
  "marketplace_add_failed",
  "plugin_install_failed",
  "plugin_not_enabled",
  "install_path_escaped",
  "host_start_failed",
  "plugin_load_not_observed",
  "live_config_mutated",
  "live_config_unreadable",
] as const);
export type IsolatedInstallRefusal = (typeof ISOLATED_INSTALL_REFUSALS)[number];

export interface IsolatedInstallOptions {
  host: IsolatedInstallHost;
  /** The host executable. */
  bin: string;
  /** A build-host-packages output dir (holds `claude-code/` and `codex-marketplace/`). */
  packagesRoot: string;
  /** The throwaway root. Must not exist yet or be empty; created by this module. */
  isolatedRoot: string;
  expectedVersion: string;
  /** The operator's real HOME. Defaults to os.homedir(). */
  realHome?: string;
  /** The OS temp root the isolated root must sit under. Defaults to os.tmpdir(). */
  tmpRoot?: string;
}

export interface IsolatedInstallResult {
  ok: boolean;
  code: "ok" | IsolatedInstallRefusal;
  detail: string;
  /** Always exactly `real_install_activation` + `native_plugin_load`. */
  checks: SmokeCheck[];
}

interface Verdict {
  ok: boolean;
  code: "ok" | IsolatedInstallRefusal;
  detail: string;
}

/** realpath of `p`, or of its nearest existing ancestor with the rest appended. */
function resolveReal(p: string): string {
  const abs = resolve(p);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  if (parent === abs) return abs;
  return join(resolveReal(parent), basename(abs));
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The live config dirs an isolated root must never resolve into. */
function liveConfigDirs(realHome: string): string[] {
  return [join(realHome, ".claude"), join(realHome, ".codex")].map(resolveReal);
}

/**
 * Refuse a root that resolves inside (or contains) the real HOME config dirs,
 * or that is not under the OS temp root. Symlinks are resolved first.
 */
export function checkIsolatedRoot(root: string, realHome: string = homedir(), tmpRoot: string = tmpdir()): Verdict {
  const real = resolveReal(root);
  const home = resolveReal(realHome);
  for (const live of liveConfigDirs(realHome)) {
    if (isInside(real, live)) return { ok: false, code: "isolated_root_in_live_config", detail: `root resolves inside the live ${basename(live)} config` };
  }
  if (isInside(home, real)) return { ok: false, code: "isolated_root_in_live_config", detail: "root contains the real HOME" };
  if (!isInside(real, resolveReal(tmpRoot))) return { ok: false, code: "isolated_root_outside_os_temp", detail: "root is not under the OS temp root" };
  return { ok: true, code: "ok", detail: "root is under the OS temp root and outside the real HOME config" };
}

/**
 * Digest of the live install state a real install would change: the install
 * and settings files are hashed, the plugin cache and marketplace trees are
 * listed in full (name, size, mtime; symlinks not followed). ~/.claude.json is
 * deliberately not watched: a concurrent live session rewrites it constantly,
 * and HOME is redirected, so the host's own path for it is the isolated copy.
 */
export function snapshotLiveConfig(realHome: string): string {
  const files = [
    ".claude/settings.json",
    ".claude/plugins/installed_plugins.json",
    ".claude/plugins/known_marketplaces.json",
    ".codex/config.toml",
  ];
  const trees = [".claude/plugins/cache", ".claude/plugins/marketplaces", ".codex/plugins"];
  const parts: string[] = [];
  for (const rel of files) {
    const p = join(realHome, rel);
    parts.push(`${rel}=${existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : "absent"}`);
  }
  const list = (dir: string, prefix: string): string[] => {
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      return [];
    }
    return names.flatMap((name) => {
      const full = join(dir, name);
      let st: ReturnType<typeof lstatSync>;
      try {
        st = lstatSync(full);
      } catch {
        return [`${prefix}${name}:gone`]; // removed between readdir and lstat
      }
      const row = `${prefix}${name}:${st.size}:${st.mtimeMs}`;
      return st.isDirectory() ? [row, ...list(full, `${prefix}${name}/`)] : [row];
    });
  };
  for (const rel of trees) parts.push(`${rel}/[${list(join(realHome, rel), "").join(",")}]`);
  return parts.join("\n");
}

const ENV_ALLOWLIST = Object.freeze(["PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME", "SHELL"]);

/**
 * Allowlisted env with HOME/TMPDIR/XDG_* and the host config root inside
 * `hostRoot`. Nothing else is inherited: no CLAUDE_*, CODEX_*, GUILD_* or keys.
 */
export function isolatedEnv(host: IsolatedInstallHost, hostRoot: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) if (process.env[key] !== undefined) env[key] = process.env[key];
  const roots: Record<string, string> = {
    HOME: join(hostRoot, "home"),
    TMPDIR: join(hostRoot, "tmp"),
    XDG_CONFIG_HOME: join(hostRoot, "xdg", "config"),
    XDG_DATA_HOME: join(hostRoot, "xdg", "data"),
    XDG_STATE_HOME: join(hostRoot, "xdg", "state"),
    XDG_CACHE_HOME: join(hostRoot, "xdg", "cache"),
  };
  if (host === "claude-code-cli") roots.CLAUDE_CONFIG_DIR = join(hostRoot, "claude-config");
  else roots.CODEX_HOME = join(hostRoot, "codex-home");
  for (const dir of Object.values(roots)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { ...env, ...roots };
}

interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runHost(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, timeout = 120_000): Ran {
  const r = spawnSync(bin, args, { cwd, env, encoding: "utf8", timeout });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.error ? r.error.message : (r.stderr ?? "") };
}

function failDetail(label: string, r: Ran): string {
  const tail = r.stderr.trim().split("\n").slice(-1)[0] ?? "";
  return `${label} exited ${String(r.status)}${tail ? `: ${tail.slice(0, 200)}` : ""}`;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function marketplaceName(manifest: string): string {
  const parsed = parseJson(existsSync(manifest) ? readFileSync(manifest, "utf8") : "") as { name?: unknown } | undefined;
  return typeof parsed?.name === "string" && parsed.name.length > 0 ? parsed.name : "guild";
}

interface Step {
  verdict: Verdict;
  /** Evidence for the install check once install is observed. */
  installEvidence?: string;
  loadEvidence?: string;
}

function claudeFlow(o: IsolatedInstallOptions, hostRoot: string, env: NodeJS.ProcessEnv): Step {
  const pkg = join(o.packagesRoot, "claude-code");
  const pluginId = `guild@${marketplaceName(join(pkg, ".claude-plugin", "marketplace.json"))}`;
  const work = join(hostRoot, "work");
  mkdirSync(work, { recursive: true });
  const add = runHost(o.bin, ["plugin", "marketplace", "add", pkg], work, env);
  if (add.status !== 0) return { verdict: { ok: false, code: "marketplace_add_failed", detail: failDetail("claude plugin marketplace add", add) } };
  const install = runHost(o.bin, ["plugin", "install", pluginId], work, env);
  if (install.status !== 0) return { verdict: { ok: false, code: "plugin_install_failed", detail: failDetail("claude plugin install", install) } };
  const list = runHost(o.bin, ["plugin", "list", "--json"], work, env);
  const entries = parseJson(list.stdout);
  const entry = Array.isArray(entries)
    ? (entries as Array<Record<string, unknown>>).find((e) => e && e.id === pluginId)
    : undefined;
  if (list.status !== 0 || !entry || entry.enabled !== true || entry.version !== o.expectedVersion || typeof entry.installPath !== "string") {
    return { verdict: { ok: false, code: "plugin_not_enabled", detail: `claude plugin list does not show ${pluginId} ${o.expectedVersion} enabled` } };
  }
  if (!isInside(resolveReal(entry.installPath), resolveReal(hostRoot))) {
    return { verdict: { ok: false, code: "install_path_escaped", detail: "claude reported an install path outside the isolated root" } };
  }
  const installEvidence =
    `${ISOLATED_INSTALL_EVIDENCE_PREFIX} claude plugin marketplace add + install ${pluginId} into an OS-temp CLAUDE_CONFIG_DIR; ` +
    `plugin list shows ${o.expectedVersion} enabled with its install path inside the isolated root`;

  // A model turn is not needed: init and SessionStart hooks run before the API call.
  const session = runHost(
    o.bin,
    ["-p", "--output-format", "stream-json", "--verbose", "--include-hook-events", "--max-turns", "1", "Reply with OK."],
    work,
    env,
    180_000,
  );
  const events = session.stdout.split("\n").map(parseJson).filter((e): e is Record<string, unknown> => !!e && typeof e === "object");
  if (events.length === 0) {
    return { verdict: { ok: false, code: "host_start_failed", detail: failDetail("claude -p", session) }, installEvidence };
  }
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const plugins = Array.isArray(init?.plugins) ? (init.plugins as Array<Record<string, unknown>>) : [];
  const loaded = plugins.find((p) => p.name === "guild" && p.source === pluginId && p.version === o.expectedVersion);
  const commands = Array.isArray(init?.slash_commands) ? (init.slash_commands as unknown[]).filter((c): c is string => typeof c === "string" && c.startsWith("guild:")) : [];
  const hookFired = events.some(
    (e) => e.subtype === "hook_response" && e.hook_event === "SessionStart" && e.exit_code === 0 && typeof e.output === "string" && e.output.includes("Guild"),
  );
  if (!loaded || !commands.includes("guild:guild") || !hookFired) {
    const missing = [!loaded && "init plugin entry", !commands.includes("guild:guild") && "guild:guild command", !hookFired && "Guild SessionStart hook"].filter(Boolean).join(", ");
    return { verdict: { ok: false, code: "plugin_load_not_observed", detail: `claude session did not show: ${missing}` }, installEvidence };
  }
  const mcp = Array.isArray(init?.mcp_servers)
    ? (init.mcp_servers as Array<Record<string, unknown>>).filter((m) => typeof m.name === "string" && m.name.startsWith("plugin:guild:") && m.status === "connected").length
    : 0;
  return {
    verdict: { ok: true, code: "ok", detail: "install and plugin load observed" },
    installEvidence,
    loadEvidence:
      `${ISOLATED_INSTALL_EVIDENCE_PREFIX} claude -p session init listed plugin ${pluginId} ${o.expectedVersion} with ${commands.length} guild:* commands ` +
      `(guild:guild resolves) and ${mcp} Guild MCP servers connected; a Guild SessionStart hook fired (exit 0)`,
  };
}

/** Every string inside a JSON value, joined by newlines. */
function jsonText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(jsonText).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(jsonText).join("\n");
  return "";
}

const CODEX_PROBE_SKILL = "guild:guild-quality";

function codexFlow(o: IsolatedInstallOptions, hostRoot: string, env: NodeJS.ProcessEnv): Step {
  const pkg = join(o.packagesRoot, "codex-marketplace");
  const work = join(hostRoot, "work");
  mkdirSync(work, { recursive: true });
  const add = runHost(o.bin, ["plugin", "marketplace", "add", pkg, "--json"], work, env);
  const mkt = (parseJson(add.stdout) as { marketplaceName?: unknown } | undefined)?.marketplaceName;
  if (add.status !== 0 || typeof mkt !== "string") {
    return { verdict: { ok: false, code: "marketplace_add_failed", detail: failDetail("codex plugin marketplace add", add) } };
  }
  const pluginId = `guild@${mkt}`;
  const install = runHost(o.bin, ["plugin", "add", pluginId, "--json"], work, env);
  const installed = parseJson(install.stdout) as { pluginId?: unknown; version?: unknown; installedPath?: unknown } | undefined;
  if (install.status !== 0 || installed?.pluginId !== pluginId || installed.version !== o.expectedVersion || typeof installed.installedPath !== "string") {
    return { verdict: { ok: false, code: "plugin_install_failed", detail: failDetail("codex plugin add", install) } };
  }
  const installedRoot = resolveReal(installed.installedPath);
  if (!isInside(installedRoot, resolveReal(hostRoot))) {
    return { verdict: { ok: false, code: "install_path_escaped", detail: "codex reported an install path outside the isolated root" } };
  }
  const list = runHost(o.bin, ["plugin", "list", "--json"], work, env);
  const listed = (parseJson(list.stdout) as { installed?: unknown } | undefined)?.installed;
  const entry = Array.isArray(listed) ? (listed as Array<Record<string, unknown>>).find((e) => e && e.pluginId === pluginId) : undefined;
  if (list.status !== 0 || !entry || entry.installed !== true || entry.enabled !== true || entry.version !== o.expectedVersion) {
    return { verdict: { ok: false, code: "plugin_not_enabled", detail: `codex plugin list does not show ${pluginId} ${o.expectedVersion} enabled` } };
  }
  const installEvidence =
    `${ISOLATED_INSTALL_EVIDENCE_PREFIX} codex plugin marketplace add + add ${pluginId} into an OS-temp CODEX_HOME; ` +
    `plugin list shows ${o.expectedVersion} installed and enabled with its install path inside the isolated root`;

  // `debug prompt-input` starts the host's session assembly and renders the
  // model-visible input without a model call.
  const prompt = runHost(o.bin, ["debug", "prompt-input", "guild isolated host smoke"], work, env, 180_000);
  if (prompt.status !== 0) return { verdict: { ok: false, code: "host_start_failed", detail: failDetail("codex debug prompt-input", prompt) }, installEvidence };
  const text = jsonText(parseJson(prompt.stdout));
  const skillsRoot = join(installedRoot, ".agents", "skills");
  const alias = [...text.matchAll(/- `(r\d+)` = `([^`]+)`/g)].find((m) => resolveReal(m[2]) === skillsRoot)?.[1];
  const line = text.split("\n").find((l) => l.startsWith(`- ${CODEX_PROBE_SKILL}:`));
  const file = alias && line ? new RegExp(`\\(file: ${alias}/([^)]+)\\)`).exec(line)?.[1] : undefined;
  if (!alias || !file || !existsSync(join(skillsRoot, file))) {
    return {
      verdict: { ok: false, code: "plugin_load_not_observed", detail: `codex prompt input does not list ${CODEX_PROBE_SKILL} from the isolated install` },
      installEvidence,
    };
  }
  const count = text.split("\n").filter((l) => l.startsWith("- guild:") && l.includes(`(file: ${alias}/`)).length;
  return {
    verdict: { ok: true, code: "ok", detail: "install and plugin load observed" },
    installEvidence,
    loadEvidence:
      `${ISOLATED_INSTALL_EVIDENCE_PREFIX} codex debug prompt-input renders ${count} model-visible guild:* skills from the isolated install root; ` +
      `${CODEX_PROBE_SKILL} resolves to ${file}`,
  };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function refused(code: string, detail: string): string {
  return `isolated-install refused ${code}: ${detail}`;
}

/**
 * Install the built package into `isolatedRoot` through the host's real install
 * path and observe Guild load. Never throws; every failure is a closed refusal.
 */
export function runIsolatedInstall(o: IsolatedInstallOptions): IsolatedInstallResult {
  const realHome = o.realHome ?? homedir();
  const guard = checkIsolatedRoot(o.isolatedRoot, realHome, o.tmpRoot ?? tmpdir());
  const build = (step: Step): IsolatedInstallResult => {
    const v = step.verdict;
    return {
      ok: v.ok,
      code: v.code,
      detail: v.detail,
      checks: [
        { concern: "real_install_activation", state: step.installEvidence ? "verified" : "refused", evidence: step.installEvidence ?? refused(v.code, v.detail) },
        { concern: "native_plugin_load", state: step.loadEvidence ? "verified" : "refused", evidence: step.loadEvidence ?? refused(v.code, v.detail) },
      ],
    };
  };
  if (!guard.ok) return build({ verdict: guard });

  const hostRoot = join(o.isolatedRoot, o.host === "claude-code-cli" ? "claude" : "codex");
  // A pre-existing host root (or a symlink planted there) could redirect writes.
  if (existsSync(hostRoot) || isSymlink(hostRoot)) {
    return build({ verdict: { ok: false, code: "isolated_root_not_fresh", detail: "the per-host config root already exists" } });
  }
  mkdirSync(hostRoot, { recursive: true, mode: 0o700 });
  const hostGuard = checkIsolatedRoot(hostRoot, realHome, o.tmpRoot ?? tmpdir());
  if (!hostGuard.ok) return build({ verdict: hostGuard });
  const snapshot = (): string | null => {
    try {
      return snapshotLiveConfig(realHome);
    } catch {
      return null;
    }
  };
  const unreadable: Step = { verdict: { ok: false, code: "live_config_unreadable", detail: "the live HOME install state could not be read" } };
  const before = snapshot();
  if (before === null) return build(unreadable);
  let step: Step;
  try {
    const env = isolatedEnv(o.host, hostRoot);
    step = o.host === "claude-code-cli" ? claudeFlow(o, hostRoot, env) : codexFlow(o, hostRoot, env);
  } catch (err) {
    step = { verdict: { ok: false, code: "host_start_failed", detail: (err as Error).message.slice(0, 200) } };
  }
  const after = snapshot();
  if (after === null) return build(unreadable);
  if (after !== before) {
    return build({ verdict: { ok: false, code: "live_config_mutated", detail: "the live HOME install state changed during the isolated run" } });
  }
  return build(step);
}
