/**
 * src/modules/state/workflows/atomic-write.ts
 *
 * Shared atomic-write helper — same-directory temp file + rename.
 *
 * FIX (EXDEV): every prior atomic-write caller (write-run-manifest.ts,
 * write-task-run.ts, workspace/write-manifest.ts, promote-upstream.ts,
 * write-host-capability.ts) built its temp file under `os.tmpdir()` then
 * `renameSync`'d it into a `.guild/` path. POSIX `rename(2)` requires both
 * paths to be on the SAME filesystem/mount — a temp dir on a different mount
 * (e.g. a Linux tmpfs `/tmp` while the project lives on a different volume,
 * or a container with `/tmp` bind-mounted separately from the workspace)
 * makes `renameSync` throw `EXDEV: cross-device link not permitted`.
 *
 * Writing the temp file in the SAME directory as the target guarantees the
 * rename is same-filesystem, which is always atomic on POSIX and never
 * throws EXDEV.
 *
 * Usage:
 *   import { atomicWrite } from "../../state"; // from a sibling module's workflows/
 *   atomicWrite(outPath, JSON.stringify(doc, null, 2) + "\n");
 *
 * Owned by: tooling-engineer (scripts/ + src/modules/state scope).
 *
 * R6 ENFORCEMENT (guild-artifact-paths.ts): this is the one shared write
 * choke-point every project-artifact writer already goes through
 * (write-run-manifest, write-task-run, workspace/write-manifest,
 * promote-upstream, write-host-capability, artifact-bus), so it is also where
 * "never write a project-created Guild artifact into the plugin install dir"
 * (R6) stops being prose-only: every write is checked against
 * `assertNotUnderPluginInstall` before it lands.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { assertNotUnderPluginInstall } from "./plugin-install-guard";

/**
 * Write `content` to `targetPath` atomically: write to a hidden temp file in
 * the SAME directory as `targetPath`, then `renameSync` it into place.
 * Creates the target directory (recursive) first if it does not exist.
 *
 * R6: refuses (throws, writes nothing) if `targetPath` resolves under a
 * plugin install root (`GUILD_PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT`/`CODEX_PLUGIN_ROOT`,
 * or an explicit `pluginInstallRoot` override) — no Guild write path may land
 * project-created state into the plugin install dir.
 *
 * On a failed rename, the temp file is best-effort cleaned up (never left
 * behind as orphaned `.tmp-*` litter) and the original error is re-thrown.
 *
 * @param targetPath        Absolute path to the final file.
 * @param content           File content, written as utf8 text.
 * @param pluginInstallRoot Optional override for the R6 boundary check (tests only;
 *                          production callers rely on the env-var default).
 */
export function atomicWrite(targetPath: string, content: string, pluginInstallRoot?: string): void {
  assertNotUnderPluginInstall(targetPath, pluginInstallRoot);
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  const unique = `${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.tmp-${unique}`);

  fs.writeFileSync(tmpPath, content, "utf8");
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup only — never mask the original rename error
    }
    throw err;
  }
}
