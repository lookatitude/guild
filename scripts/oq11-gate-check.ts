#!/usr/bin/env -S npx tsx
/**
 * oq11-gate-check.ts — the OQ11 non-interactive hard-fail gate check.
 *
 * Contract (cite, do not re-spell beyond the code):
 *   plugin/commands/guild.md §"Non-interactive / CI behaviour (OQ11)"
 *   (decisions/command-clean-slate.md #7; command-surface.md §5.1/§5.4;
 *    phases/P0-oq11-noninteractive.md §4). Introduces NO new gate — it reuses
 *   the existing gate machinery's non-interactive branch.
 *
 * Predicate: HARD-FAIL (exit non-zero, autonomy NOT granted) iff an
 * interactive gate is reached AND the context is non-interactive (no TTY)
 * AND no `--auto-approve=` covers that gate AND no explicit named phase verb
 * was given. Otherwise proceed (no hard-fail). Guild NEVER implicitly grants
 * autonomy: the non-interactive proceed paths are EXPLICIT grants only
 * (auto-approve coverage or the named-phase verb path); the interactive path
 * defers to the human prompt (no autonomy granted by this check).
 *
 * Zero runtime deps (pure function; Node builtins only for the CLI).
 *
 * Usage (CLI, genuinely executable):
 *   npx tsx oq11-gate-check.ts --gate=plan [--non-interactive|--interactive]
 *     [--auto-approve=spec,plan,build|all] [--named-phase]
 *   → prints a JSON result; on hard-fail prints the actionable message to
 *     stderr and exits non-zero.
 */

export interface CheckGateInput {
  /** Is the context interactive (a TTY a human can answer at)? */
  interactive: boolean;
  /** Gates pre-approved via --auto-approve (e.g. ["spec","plan"] or ["all"]). */
  auto_approve: string[];
  /** Was an explicit named phase verb given (deterministic CI contract path)? */
  named_phase: boolean;
  /** The interactive gate being reached (e.g. "spec" | "plan" | "build"). */
  gate: string;
}

export interface CheckGateResult {
  hard_fail: boolean;
  exit_code: number;
  autonomy_granted: boolean;
}

/** True iff --auto-approve explicitly covers this gate ("all" or the gate name). */
function autoApproveCovers(autoApprove: string[], gate: string): boolean {
  return autoApprove.includes("all") || autoApprove.includes(gate);
}

export function checkGate(input: CheckGateInput): CheckGateResult {
  const covered = autoApproveCovers(input.auto_approve, input.gate);

  // OQ11 trigger — all of: non-interactive AND uncovered AND no named phase.
  const hard_fail = input.interactive === false && !covered && input.named_phase === false;

  // Autonomy is granted ONLY on a non-interactive proceed via an EXPLICIT
  // grant (auto-approve coverage or the named-phase verb). Interactive proceed
  // defers to the human (no autonomy granted). Hard-fail never grants.
  const autonomy_granted = !hard_fail && input.interactive === false;

  return { hard_fail, exit_code: hard_fail ? 1 : 0, autonomy_granted };
}

/** The OQ11 actionable hard-fail message (guild.md §OQ11). */
export function hardFailMessage(gate: string): string {
  return [
    `error: interactive gate '${gate}' reached in a non-interactive context`,
    `       (no TTY) with no --auto-approve covering it and no explicit phase verb.`,
    ``,
    `Guild will not implicitly grant autonomy. Fix — name the phase and`,
    `pre-approve the soft gate explicitly, e.g.:`,
    ``,
    `  /guild build --auto-approve=spec,plan,build`,
    `  /guild qa`,
    `  /guild ops <runbook>`,
    ``,
    `exit: non-zero  ·  no gate auto-satisfied  ·  no gated action taken`,
  ].join("\n");
}

// ---- CLI ----

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

function main(): void {
  const argv = process.argv.slice(2);
  const gate = parseFlag(argv, "gate") ?? "plan";

  // interactive: explicit flags win; else fall back to real TTY detection.
  let interactive: boolean;
  if (hasFlag(argv, "interactive")) interactive = true;
  else if (hasFlag(argv, "non-interactive")) interactive = false;
  else interactive = Boolean(process.stdout.isTTY);

  const aaRaw = parseFlag(argv, "auto-approve");
  const auto_approve = aaRaw ? aaRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const named_phase = hasFlag(argv, "named-phase");

  const res = checkGate({ interactive, auto_approve, named_phase, gate });

  process.stdout.write(JSON.stringify(res) + "\n");
  if (res.hard_fail) {
    process.stderr.write(hardFailMessage(gate) + "\n");
  }
  process.exit(res.exit_code);
}

if (require.main === module) main();
