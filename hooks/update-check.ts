/**
 * hooks/update-check.ts — SessionStart update signal (plugin-update-lifecycle
 * G1 AC-1..AC-5, AC-8; channel-aware per G1-CH; Claude-family hosts).
 *
 * Deterministic, offline-fast, fail-open:
 *   - NEVER hits the network in the SessionStart path. It reads the machine
 *     cache (~/.guild/update-check.json) and, when the cache is older than the
 *     configured cadence, spawns ITSELF detached with --refresh to do the one
 *     `git ls-remote` in the background — the signal appears next session.
 *   - Dev installs (working checkout / operator symlink) are silent (AC-5).
 *   - `defaults.update.mode: off` silences everything; `notify` (default)
 *     prints the one-line signal; `auto` additionally stages the headless
 *     marketplace update (effective NEXT session — Claude Code loads plugins
 *     at startup), once per available target (staged-marker dedupe).
 *   - Any error → exit 0 silent. Session start is never blocked or slowed.
 *
 * Wrapper hosts get the same core via `guild-run update` + install.sh --update;
 * this hook is the Claude-family apply adapter (see release-discipline + the
 * initiative's G1-ALL table).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import {
  cacheIsFresh,
  cachePath,
  computeSignal,
  readCache,
  refreshCache,
  renderSignalLine,
  resolveInstallState,
  type UpdateMode,
  updateCapsForHost,
} from "../scripts/lib/update-check";

function readUpdateConfig(cwd: string): { mode: UpdateMode; cadenceHours: number } {
  const defaults = { mode: "notify" as UpdateMode, cadenceHours: 24 };
  try {
    // The REAL config source of truth (AC-6): workspace + local + project
    // layering with deep merge — never a raw single-file read (codex G-lane
    // MAJOR: a workspace-level `defaults.update.mode: off` must be honored).
    const { resolveSettings } = require("../src/modules/config/workflows/settings-resolver") as {
      resolveSettings: (o: { cwd: string }) => { config: Record<string, unknown> };
    };
    const parsed = resolveSettings({ cwd }).config as {
      defaults?: { update?: { mode?: string; cadence_hours?: number } };
    };
    const u = parsed.defaults?.update ?? {};
    const mode =
      u.mode === "auto" || u.mode === "notify" || u.mode === "off"
        ? (u.mode as UpdateMode)
        : defaults.mode;
    const cadenceHours =
      typeof u.cadence_hours === "number" && u.cadence_hours > 0
        ? u.cadence_hours
        : defaults.cadenceHours;
    return { mode, cadenceHours };
  } catch {
    return defaults;
  }
}

function stagedMarkerPath(): string {
  return path.join(os.homedir(), ".guild", "update-staged.json");
}

/** true when an auto-update for this exact target was already staged. */
function alreadyStaged(target: string): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(stagedMarkerPath(), "utf8")) as {
      target?: string;
    };
    return m.target === target;
  } catch {
    return false;
  }
}

function markStaged(target: string): void {
  try {
    fs.mkdirSync(path.dirname(stagedMarkerPath()), { recursive: true });
    fs.writeFileSync(
      stagedMarkerPath(),
      JSON.stringify({ target, staged_at: new Date().toISOString() }) + "\n",
      "utf8"
    );
  } catch {
    // marker is best-effort; worst case we re-stage the same update
  }
}

function spawnDetached(cmd: string, args: string[]): void {
  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // fail-open
  }
}

function main(): void {
  // Detached worker mode: the single networked call, then exit.
  if (process.argv.includes("--refresh")) {
    refreshCache({});
    return;
  }

  const pluginRoot =
    process.env["GUILD_PLUGIN_ROOT"] ?? process.env["CLAUDE_PLUGIN_ROOT"];
  if (!pluginRoot) return;

  const { mode, cadenceHours } = readUpdateConfig(process.cwd());
  if (mode === "off") return;

  // Which host is this signal for? The per-host package's hook manifest names
  // its own host (`--host codex-cli`), so no detection is needed and no receipt
  // is required — a host-native install that never wrote one still gets the
  // right command. Absent the flag we stay on the Claude default, which is what
  // hooks/hooks.json has always meant.
  const hostArg = process.argv.indexOf("--host");
  let hostId = "claude-code-cli";
  if (hostArg !== -1) {
    const raw = process.argv[hostArg + 1];
    // A trailing `--host`, or `--host --refresh`, must NOT collapse to
    // undefined: computeSignal treats an undefined hostId as permission to use
    // the coarse hostKind fallback, which would name the agents-file installer
    // command on a host we cannot identify. Keep it a defined-but-unknown
    // string so the AC-7 row lookup fails and the command comes back null.
    hostId = raw === undefined || raw.startsWith("-") || raw === "" ? "unknown-host" : raw;
  }
  const caps = updateCapsForHost(hostId);
  // AC-7 honesty: an unknown id yields caps === null, computeSignal then emits
  // command: null, and renderSignalLine degrades rather than naming a wrong one.
  const hostKind: "claude" | "wrapper" | "agents-file" =
    caps?.apply === "marketplace_cli" ? "claude" : caps?.apply === "self_update" ? "wrapper" : "agents-file";

  const state = resolveInstallState(pluginRoot);
  if (state.channel === "dev") return; // AC-5: dev installs are silent

  const cacheFile = cachePath();
  const cache = readCache(cacheFile);

  // Background refresh when stale — the signal from a fresh check lands next
  // session; THIS session never waits on the network (AC-4).
  if (!cacheIsFresh(cache, cadenceHours, new Date())) {
    spawnDetached(process.execPath, [__filename, "--refresh"]);
  }

  const signal = computeSignal({ state, cache, hostKind, hostId });
  const line = renderSignalLine(signal);
  if (!line) return;

  // AUTO MODE IS GATED ON auto_capable, not merely on having a command.
  // Codex declares `auto_capable: false` — its command (`guild-run update`)
  // refuses without an install receipt, which a host-native `codex plugin add`
  // never writes. Running it anyway and then marking the target staged would
  // report success for an update that silently failed. A host that cannot
  // auto-apply degrades to notify-only, which is the honest signal.
  if (mode === "auto" && caps?.auto_capable !== true) {
    process.stdout.write(
      `${line}\n[guild-update] auto mode: ${hostId} cannot auto-apply — run the command above.\n`
    );
    return;
  }

  if (mode === "auto") {
    // Stage per host: the marker keyed on target alone meant Claude staging
    // version X made every other host report "already staged" for X.
    const target = `${hostId}@${signal.available ?? ""}`;
    if (!alreadyStaged(target)) {
      // Headless staged update (OQ-2 resolved: non-TTY-safe CLI; takes effect
      // next session). The command comes from the AC-7 capability row, NOT a
      // hardcoded Claude chain — auto-mode on a non-Claude host used to run
      // `claude …`, which is simply the wrong binary. A host with no declared
      // apply command stages nothing and falls through to notify-only.
      spawnDetached("/bin/sh", ["-c", caps.command]);
      markStaged(target);
      process.stdout.write(
        `${line}\n[guild-update] auto mode: update staged — it takes effect next session.\n`
      );
      return;
    }
    process.stdout.write(
      `${line}\n[guild-update] auto mode: already staged — restart to apply.\n`
    );
    return;
  }

  process.stdout.write(`${line}\n`);
}

try {
  main();
} catch {
  // AC-4: never block or noise session start on an error path.
}
process.exit(0);
