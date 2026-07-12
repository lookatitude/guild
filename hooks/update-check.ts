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
} from "../scripts/lib/update-check";

function readUpdateConfig(cwd: string): { mode: UpdateMode; cadenceHours: number } {
  const defaults = { mode: "notify" as UpdateMode, cadenceHours: 24 };
  try {
    const raw = fs.readFileSync(path.join(cwd, ".guild", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as {
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

  const state = resolveInstallState(pluginRoot);
  if (state.channel === "dev") return; // AC-5: dev installs are silent

  const cacheFile = cachePath();
  const cache = readCache(cacheFile);

  // Background refresh when stale — the signal from a fresh check lands next
  // session; THIS session never waits on the network (AC-4).
  if (!cacheIsFresh(cache, cadenceHours, new Date())) {
    spawnDetached(process.execPath, [__filename, "--refresh"]);
  }

  const signal = computeSignal({ state, cache, hostKind: "claude" });
  const line = renderSignalLine(signal);
  if (!line) return;

  if (mode === "auto") {
    const target = signal.available ?? "";
    if (!alreadyStaged(target)) {
      // Headless staged update (OQ-2 resolved: non-TTY-safe CLI; takes effect
      // next session). Chained via a shell so the marketplace refresh lands
      // before the plugin update.
      spawnDetached("/bin/sh", [
        "-c",
        "claude plugin marketplace update guild && claude plugin update guild@guild",
      ]);
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
