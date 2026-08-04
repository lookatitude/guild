/**
 * tests/dot-guild/ts-runtime-helper.ts
 *
 * T6B-R2-B1 — package-local TypeScript runtime for the real-CLI dot-guild tests.
 *
 * These suites drive the SHIPPED scrub.ts / audit.ts CLIs as subprocesses (no injected
 * seam). They used to launch them with ambient `npx tsx`, which made the whole security
 * rail depend on machine state OUTSIDE the repo: PATH, network, and a writable ~/.npm
 * cache. On a host whose ~/.npm is root-owned, every real-CLI case died with EPERM and
 * the rail reported 1/3 suites green — the tests could not tell "the gate is broken"
 * from "npm could not start".
 *
 * The launcher below reuses the SAME resolver the shipped audit uses
 * (`resolveScrubRuntime` in scripts/dot-guild/audit.ts) so the tests exercise the real
 * resolution path rather than a parallel test-only copy. It resolves tsx from the repo's
 * own node_modules (plugin/tests/node_modules or plugin/scripts/node_modules) and spawns
 * `node <tsx cli> <script>` directly — no npm, no cache, no network.
 */

import * as path from "path";
import { spawnSync } from "child_process";
import { resolveScrubRuntime, type ScrubRuntime } from "../../scripts/dot-guild/audit";

/** The package-local runtime, or a loud throw — never a silent ambient-npx fallback. */
export function packageLocalTsRuntime(): ScrubRuntime {
  const runtime = resolveScrubRuntime([
    path.resolve(__dirname, "../.."),        // plugin/tests → plugin/
    path.resolve(__dirname, "../../scripts"), // plugin/scripts/node_modules/tsx
  ]);
  if (!runtime) {
    throw new Error(
      "no package-local TypeScript runtime (tsx) resolved — run `npm ci` in plugin/tests " +
        "or plugin/scripts; these tests deliberately do NOT fall back to ambient npx",
    );
  }
  return runtime;
}

export interface TsRunResult { status: number | null; stdout: string; stderr: string; out: string; }

/**
 * Run a repo TypeScript CLI through the package-local runtime.
 * `env` entries are layered over the current environment (used by the fail-closed
 * probes to hand the audit a deliberately broken GUILD_TSX_RUNTIME).
 */
export function runTsCli(
  script: string,
  args: string[] = [],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): TsRunResult {
  const runtime = packageLocalTsRuntime();
  const result = spawnSync(runtime.command, [...runtime.prefixArgs, script, ...args], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  });
  // A launch failure of the TEST harness itself is a hard error, not a quiet 0-status.
  if (result.error) {
    throw new Error(`package-local runtime ${runtime.source} failed to launch: ${result.error.message}`);
  }
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { status: result.status, stdout, stderr, out: stdout + stderr };
}
