#!/usr/bin/env -S npx tsx
/**
 * classify-proposal.ts — the ONE specific-vs-systemic classifier, extracted
 * from skill-prose into a deterministic pure module (VC-K5 dual-output).
 *
 * Contract (cite, do not re-spell beyond the code):
 *   IFACE-CLASSIFIER-1 — docs/.../phases/P3-learning-loop.md §"P3 · Interfaces"
 *   (producer task P3-classifier-004; ONE classifier, TWO entry points).
 *   Canonical predicate source: target-architecture.md §"One-vs-template
 *   classifier + migration" + continuous-knowledge-and-learning-loop.md
 *   signature rows agent_template / skill_template (§194-196, VC-K5).
 *
 * Dual-output model (VC-K5): a defect ALWAYS yields a per-instance
 * (specific) proposal on the existing per-instance evolve queue; when the
 * systemic predicate holds, the SAME classifier additionally emits the
 * `<target>_template: systemic-proposal` token (the staging route). Systemic
 * is therefore a SUPERSET output, never an either-or — both tokens flow
 * through this single interface.
 *
 * Zero runtime deps (pure function; Node builtins only for the CLI shim).
 *
 * Usage (CLI shim, genuinely executable):
 *   npx tsx classify-proposal.ts --distinct=3 --same-run --same-signature \
 *     --user-approved [--target=skill|agent] [--subject=<name>]
 *   → prints the {verdict, outputs} JSON; exit 0.
 */

export type ClassifierTarget = "skill" | "agent";

export interface ClassifyProposalInput {
  /** Count of distinct subjects (skills/agents) exhibiting the same defect. */
  distinct_subject_count: number;
  /** Did the qualifying instances co-occur in a single run? */
  same_run: boolean;
  /** Same machine-checkable defect signature across the instances? */
  same_signature: boolean;
  /** Explicit user approval at the existing interactive template-change gate? */
  user_approved: boolean;
  /** Which definitional surface the defect lives on (default "skill"). */
  target?: ClassifierTarget;
  /** Subject name for the per-instance proposal token (default placeholder). */
  subject?: string;
}

export interface ClassifyProposalResult {
  verdict: "specific" | "systemic";
  /**
   * Verdict tokens emitted. The per-instance `<target>_def: proposal:<subject>`
   * is always present; the systemic `<target>_template: systemic-proposal`
   * token is appended iff verdict === "systemic".
   */
  outputs: string[];
}

/**
 * IFACE-CLASSIFIER-1 predicate (cited above; the code IS the implementation):
 *   systemic iff
 *     (distinct_subject_count >= 3 OR (distinct_subject_count >= 2 AND same_run))
 *     AND same_signature
 *     AND user_approved
 *   else specific.
 */
export function classifyProposal(input: ClassifyProposalInput): ClassifyProposalResult {
  const target: ClassifierTarget = input.target ?? "skill";
  const subject = input.subject ?? "<skill>";

  const countGate =
    input.distinct_subject_count >= 3 ||
    (input.distinct_subject_count >= 2 && input.same_run === true);

  const systemic = countGate && input.same_signature === true && input.user_approved === true;

  // Per-instance proposal — the existing per-instance evolve queue route.
  const perInstance = `${target}_def: proposal:${subject}`;
  const outputs: string[] = [perInstance];

  if (systemic) {
    // The exact token P3 emits + P4 gate/migration consume (IFACE-CLASSIFIER-1).
    outputs.push(`${target}_template: systemic-proposal`);
  }

  return { verdict: systemic ? "systemic" : "specific", outputs };
}

// ---- CLI shim (genuinely executable) ----

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

export function runClassifyProposalCli(argv: string[] = process.argv.slice(2)): void {
  const distinct = parseInt(parseFlag(argv, "distinct") ?? "0", 10);
  const target = (parseFlag(argv, "target") as ClassifierTarget) ?? "skill";
  const subject = parseFlag(argv, "subject");
  const res = classifyProposal({
    distinct_subject_count: Number.isFinite(distinct) ? distinct : 0,
    same_run: hasFlag(argv, "same-run"),
    same_signature: hasFlag(argv, "same-signature"),
    user_approved: hasFlag(argv, "user-approved"),
    target: target === "agent" ? "agent" : "skill",
    ...(subject ? { subject } : {}),
  });
  process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}

// esbuild inlines this module into the hook bundles (hooks/dist/*.js), where
// `require.main === module` is true for EVERY inlined module — gate on the exact argv basename so
// only a direct `classify-proposal` invocation runs the CLI, never a hook bundle.
if (require.main === module && /^classify-proposal\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  runClassifyProposalCli();
}
