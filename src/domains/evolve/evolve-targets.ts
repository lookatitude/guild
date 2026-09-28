/**
 * evolve-targets.ts — the closed evolve target enum and the one-gate/two-homes law
 * (KTD18 / KTD63 / R32 / R74).
 *
 * Guild has ONE evolve gate and TWO homes for what comes out of it:
 *
 *   PROJECT RSI — `skill | playbook | profile | glossary`. The consuming repo owns
 *     these. A span-replace lands under that repo's own `.guild/` (its minted
 *     specialist profiles, its project skills, its playbooks, its wiki glossary) and
 *     never in the plugin install dir or the plugin's starter feedstock (DH-3).
 *
 *   PLUGIN RSI — `assembler | command | agent | hook | adapter | learn_script |
 *     domain_ts`. These are machinery. The pipeline may only write a CANDIDATE under
 *     the plugin's own `.guild/evolve/`; promotion into `src/surfaces/**` (or `src/`
 *     for the four KTD63 types) is a HUMAN commit after compile + D5 + adapter-matrix
 *     tests. Nothing here is reachable from the automatic path.
 *
 * Two further rules live here because they are properties of the TARGET, not of the
 * writer that happens to be running:
 *
 *   - AUTO-PATH FAIL-CLOSED (R74). The KTD33 auto path is the cheap curator only. It
 *     may touch project playbooks and project skills. Every other target — and every
 *     machinery target without exception — refuses with `next_need: "operator"`. A
 *     refusal is not an error to route around: it is the gate.
 *   - PERMISSIONS ARE PROPOSAL-ONLY (D5). `permission` is deliberately NOT in the
 *     enum, AND D5 is enforced as a CONTENT class rather than a target token —
 *     `classifyPermissionContent` below. The token check alone waved through a
 *     `--target=playbook --auto` delta that rewrote a playbook's `## Permissions`
 *     span from "requires operator approval" to "always allowed", which is the
 *     exact edit D5 exists to stop.
 *   - FILE CLASS BEATS THE TOKEN. `classifyFileClass` refuses an executable or
 *     structured-data file whatever token the caller passed: directory containment
 *     is not the KTD63 rule, and a markdown heading inside a `//` comment made
 *     `.guild/skills/script.ts` a valid span target.
 *
 * Pure and IO-free. The writers that act on these verdicts live in `evolve-delta.ts`
 * (span replace) and `compact-history.ts` (inverse record + rollback).
 */

import { frozenList, sealMap, sealSet } from "../kernel";

export const EVOLVE_DELTA_SCHEMA = "guild.evolve_delta.v1" as const;

/** The closed target enum. Sealed: a 12th target is a code change, not a config key. */
export const EVOLVE_TARGETS = frozenList([
  // project home
  "skill",
  "playbook",
  "profile",
  "glossary",
  // plugin home
  "assembler",
  "command",
  "agent",
  "hook",
  "adapter",
  "learn_script",
  "domain_ts",
] as const);
export type EvolveTarget = (typeof EVOLVE_TARGETS)[number];

/** Where an applied delta for this target is allowed to land. */
export type EvolveHome = "project" | "plugin";

const PROJECT_TARGETS: ReadonlySet<string> = sealSet(
  ["skill", "playbook", "profile", "glossary"],
  "PROJECT_TARGETS",
);

/**
 * The four KTD63 types. They share the plugin home with `assembler | command | agent`
 * but are called out separately because their human gate additionally requires
 * compile + D5 + adapter-matrix tests before a promotion stands (R74).
 */
export const HUMAN_ONLY_TARGETS: ReadonlySet<string> = sealSet(
  ["hook", "adapter", "learn_script", "domain_ts"],
  "HUMAN_ONLY_TARGETS",
);

/**
 * Targets the KTD33 automatic path may write. Project playbooks and project skills,
 * and nothing else.
 *
 * `profile` and `glossary` are project-home yet still NOT here: a minted specialist
 * profile is the agent's own definition and a glossary term is a durable contract —
 * both are human evolve (KTD70 lets a harvest DECISION name a `glossary_term:`, which
 * is harvest's write, not the curator's).
 */
export const AUTO_PATH_TARGETS: ReadonlySet<string> = sealSet(
  ["playbook", "skill"],
  "AUTO_PATH_TARGETS",
);

export function isEvolveTarget(value: unknown): value is EvolveTarget {
  return typeof value === "string" && (EVOLVE_TARGETS as readonly string[]).includes(value);
}

/** The home a target writes into. Throws on an unknown token — the enum is closed. */
export function evolveHome(target: EvolveTarget): EvolveHome {
  if (!isEvolveTarget(target)) {
    throw new EvolveTargetRefusal(
      `'${String(target)}' is not an evolve target; the enum is closed to ` +
        `${EVOLVE_TARGETS.join(" | ")} (KTD18)`,
      "unknown_target",
    );
  }
  return PROJECT_TARGETS.has(target) ? "project" : "plugin";
}

export type EvolveRefusalKind =
  | "unknown_target"
  | "auto_path_forbidden"
  | "human_gate"
  | "scope"
  | "hash_required"
  | "hash_mismatch"
  | "span_missing"
  | "permission"
  | "not_a_definition_file"
  | "curator_shape"
  | "history_unreadable"
  | "injection"
  | "secret";

/** A fail-closed evolve refusal. Carries the `next_need` T0 surfaces. */
export class EvolveTargetRefusal extends Error {
  readonly kind: EvolveRefusalKind;
  /** What unblocks it. Always `operator` — every refusal here wants a human. */
  readonly next_need: "operator";
  constructor(message: string, kind: EvolveRefusalKind) {
    super(message);
    this.name = "EvolveTargetRefusal";
    this.kind = kind;
    this.next_need = "operator";
  }
}

export interface AutoPathVerdict {
  allowed: boolean;
  target: EvolveTarget;
  home: EvolveHome;
  /** Set when `allowed` is false. */
  next_need?: "operator";
  reason?: string;
}

/**
 * May the KTD33 automatic path write this target? Returns a verdict rather than
 * throwing, so a caller enumerating targets can report every refusal at once.
 */
export function classifyAutoPath(target: EvolveTarget): AutoPathVerdict {
  const home = evolveHome(target);
  if (AUTO_PATH_TARGETS.has(target)) return { allowed: true, target, home };
  const reason = HUMAN_ONLY_TARGETS.has(target)
    ? `'${target}' is a KTD63 human-only target: promotion is a human commit after ` +
      `compile + D5 + adapter-matrix tests (R74)`
    : home === "plugin"
      ? `'${target}' is plugin machinery: the auto path may only write a candidate under ` +
        `the plugin's own .guild/evolve/, never the install tree (KTD18)`
      : `'${target}' is not on the cheap curator's auto path (${[...AUTO_PATH_TARGETS].join(", ")})`;
  return { allowed: false, target, home, next_need: "operator", reason };
}

/** The throwing form. Use at a write boundary; `classifyAutoPath` to report. */
export function assertAutoPathAllowed(target: EvolveTarget): void {
  const verdict = classifyAutoPath(target);
  if (!verdict.allowed) {
    throw new EvolveTargetRefusal(
      verdict.reason ?? `auto path refuses '${target}'`,
      HUMAN_ONLY_TARGETS.has(target) ? "human_gate" : "auto_path_forbidden",
    );
  }
}

/**
 * D5 — permissions are proposal-only. `permission` is not in the enum, so a caller
 * naming it lands here rather than in `evolveHome`'s generic unknown-token message.
 * The distinct refusal kind is what the D5 poison fixture asserts on: a future enum
 * addition that quietly makes `permission` resolvable would flip this test red.
 */
export function assertNotPermissionEdit(target: string): void {
  if (/^permissions?$/i.test(target.trim()) || /^d5$/i.test(target.trim())) {
    throw new EvolveTargetRefusal(
      `permissions are proposal-only (D5): '${target}' can never promote through any evolve path`,
      "permission",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// D5 is a CONTENT class, not a target token (codex G-lane r1 #1)
// ─────────────────────────────────────────────────────────────────────────────

// The classifier lives in the security domain so the harvest span-replace, the
// evolve writer and its rollback all screen through ONE copy (T15).
export {
  blockUnits,
  classifyPermissionContent,
  isPermissionSentence,
  sentences,
  type BlockUnit,
  type PermissionContentReason,
  type PermissionContentVerdict,
} from "../security";

// ─────────────────────────────────────────────────────────────────────────────
// File class beats the target token (codex G-lane r1 #2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extensions the evolve writer may NEVER write, whatever token the caller passed.
 * Directory containment is not the KTD63 rule: `.guild/skills/script.ts` is inside
 * the project's own skills tree and is still executable code, and a markdown
 * heading inside a `//` comment made it a valid span target.
 */
const EXECUTABLE_EXTENSIONS: ReadonlySet<string> = sealSet(
  [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".bash", ".zsh", ".py", ".rb", ".json", ".yaml", ".yml", ".toml"],
  "EXECUTABLE_EXTENSIONS",
);

/** Extensions the auto path and the project home DO write: prose definitions. */
const TEXT_DEFINITION_EXTENSIONS: ReadonlySet<string> = sealSet(
  [".md", ".markdown", ".mdx", ".txt", ""],
  "TEXT_DEFINITION_EXTENSIONS",
);

export interface FileClassVerdict {
  /** True when the path is a markdown/text definition file. */
  writable: boolean;
  /** The target class the CONTENT implies when `writable` is false. */
  reclassified_as?: EvolveTarget;
  detail?: string;
}

/**
 * Classify a write target by its file, not by the token the caller passed.
 *
 * A `.ts`/`.sh`/`.json` file is `domain_ts` or `learn_script` class regardless of
 * `--target=skill`, and so is a file whose first bytes are not text (a NUL in the
 * head is the cheap, encoding-independent binary test). Both are KTD63 human-only,
 * so the write fails closed and the delta becomes a candidate.
 */
export function classifyFileClass(absPath: string, head?: string | null): FileClassVerdict {
  const lower = absPath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const slash = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
  const ext = dot > slash ? lower.slice(dot) : "";

  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    const script = ext === ".sh" || ext === ".bash" || ext === ".zsh" || ext === ".py" || ext === ".rb";
    return {
      writable: false,
      reclassified_as: script ? "learn_script" : "domain_ts",
      detail: `'${ext}' is executable or structured code; the evolve auto path writes prose definitions only (KTD63)`,
    };
  }
  if (typeof head === "string" && head.includes("\u0000")) {
    return {
      writable: false,
      reclassified_as: "domain_ts",
      detail: "the file's first bytes are not text",
    };
  }
  if (!TEXT_DEFINITION_EXTENSIONS.has(ext)) {
    return {
      writable: false,
      reclassified_as: "domain_ts",
      detail: `'${ext}' is not a markdown/text definition extension`,
    };
  }
  return { writable: true };
}

/**
 * The 5-way LearningCheckpoint verdict → evolve routing (KTD57 → KTD18).
 *
 * `decision` is NOT an evolve target: it routes to harvest, which is the only
 * automatic wiki writer (KTD35). Mapping it onto a target here would create the
 * second promotion path the one-promotion-law forbids.
 */
export type CheckpointRoute =
  | { route: "harvest" }
  | { route: "curator"; target: EvolveTarget }
  | { route: "human-queue" }
  | { route: "no-op" };

const VERDICT_TARGET_MAP: ReadonlyMap<string, CheckpointRoute> = sealMap(
  [
    ["decision", { route: "harvest" } as CheckpointRoute],
    ["playbook_span", { route: "curator", target: "playbook" } as CheckpointRoute],
    ["skill_def", { route: "curator", target: "skill" } as CheckpointRoute],
    ["reflect", { route: "human-queue" } as CheckpointRoute],
    ["none", { route: "no-op" } as CheckpointRoute],
  ],
  "VERDICT_TARGET_MAP",
);

/**
 * Route one checkpoint verdict. An unrecognized verdict is `human-queue`, never a
 * write: a classifier that grows a sixth verdict must not silently reach the curator.
 */
export function routeCheckpointVerdict(verdict: string): CheckpointRoute {
  return VERDICT_TARGET_MAP.get(verdict) ?? { route: "human-queue" };
}
