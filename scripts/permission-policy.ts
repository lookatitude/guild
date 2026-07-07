#!/usr/bin/env -S npx tsx
/**
 * scripts/permission-policy.ts — P1-L10 runtime permission-policy CLI.
 *
 * A genuinely-executable surface over scripts/lib/permission-policy.ts so the
 * phase-scoped policy, the host-native launch-flag mapping, and the orthogonality
 * invariant are resolvable + auditable on the REAL path (the same posture as
 * oq11-gate-check.ts). Reads the live config from `<cwd>/.guild/settings.json`.
 *
 * Subcommands (all print JSON to stdout; exit 0 on success):
 *
 *   resolve  [--cwd <dir>]
 *       → the full 36-cell `<phase>.<gate_type>` policy table for the live config.
 *         Under the default config this is the C2 baseline golden byte-for-byte.
 *
 *   effective --host <id> --phase <p> --gate <t> [--cwd <dir>] [--first-run] [--no-dry-run]
 *       → the integrated effective policy for one cell: the {host_mode,guild_gates,
 *         bypass} triple, the host-native launch flags (host autonomy axis), the
 *         gate-required decision (Guild-gate axis — host_mode-blind), the 4 safety
 *         rails, and the final effective_skip.
 *
 *   launch   --host <id> --mode <host_mode>
 *       → ONLY the host-native launch flags for a host_mode (the autonomy axis in
 *         isolation; proves the flags carry host autonomy, never a Guild gate).
 *
 * Contract authority: scripts/lib/permission-policy.ts (and the L0/L3 modules it
 * consumes). This CLI adds NO policy logic — it is argv → lib → JSON.
 *
 * Owned by hook-engineer (P1-L10).
 */

import {
  resolvePermissionPolicy,
  resolveEffectivePolicy,
  resolveHostLaunch,
  readRuntimePermissionConfig,
  type RuntimePermissionConfig,
} from "./lib/permission-policy";
import {
  PHASES,
  GATE_TYPES,
  HOST_MODES,
  type Phase,
  type GateType,
  type HostMode,
} from "./lib/permission-policy-schema";

function parseFlag(argv: string[], name: string): string | undefined {
  const eq = `--${name}=`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}` && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
    if (argv[i].startsWith(eq)) return argv[i].slice(eq.length);
  }
  return undefined;
}
function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`);
}

function fail(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(2);
}

function loadConfig(argv: string[]): RuntimePermissionConfig {
  // Default to the process cwd so a bare `permission-policy resolve` from the repo
  // root reflects the LIVE .guild/settings.json — NOT a false-clean default posture
  // (codex G-lane R1 MEDIUM). readRuntimePermissionConfig fails safe to the
  // documented defaults when no settings file exists, so this stays correct off-repo.
  const cwd = parseFlag(argv, "cwd") ?? process.cwd();
  return readRuntimePermissionConfig(cwd);
}

function main(): void {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (sub === "resolve") {
    const config = loadConfig(argv);
    process.stdout.write(JSON.stringify({ config, table: resolvePermissionPolicy(config) }, null, 2) + "\n");
    process.exit(0);
  }

  if (sub === "effective") {
    const host = parseFlag(argv, "host") ?? fail("--host <id> required");
    const phase = parseFlag(argv, "phase") as Phase | undefined;
    const gate = parseFlag(argv, "gate") as GateType | undefined;
    if (!phase || !PHASES.includes(phase)) fail(`--phase must be one of ${PHASES.join("|")}`);
    if (!gate || !GATE_TYPES.includes(gate)) fail(`--gate must be one of ${GATE_TYPES.join("|")}`);
    const config = loadConfig(argv);
    const ctx = {
      first_run: hasFlag(argv, "first-run"),
      dry_run_done: !hasFlag(argv, "no-dry-run"),
    };
    const eff = resolveEffectivePolicy({ host, phase: phase!, gate_type: gate!, config, ctx });
    process.stdout.write(JSON.stringify(eff, null, 2) + "\n");
    process.exit(0);
  }

  if (sub === "launch") {
    const host = parseFlag(argv, "host") ?? fail("--host <id> required");
    const mode = parseFlag(argv, "mode") as HostMode | undefined;
    if (!mode || !HOST_MODES.includes(mode)) fail(`--mode must be one of ${HOST_MODES.join("|")}`);
    process.stdout.write(JSON.stringify(resolveHostLaunch(host, mode!), null, 2) + "\n");
    process.exit(0);
  }

  process.stderr.write(
    [
      "usage: permission-policy <resolve|effective|launch> [options]",
      "  resolve   [--cwd <dir>]",
      "  effective --host <id> --phase <p> --gate <t> [--cwd <dir>] [--first-run] [--no-dry-run]",
      "  launch    --host <id> --mode <host_mode>",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

if (require.main === module) main();
