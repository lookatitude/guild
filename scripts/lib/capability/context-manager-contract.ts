/**
 * scripts/lib/capability/context-manager-contract.ts
 *
 * F5 — the WRITTEN CONTRACT for the `context-manager` installed agent.
 *
 * ┌───────────────────────────────────────────────────────────────────────────┐
 * │ THIS FILE IS A BLOCKER, NOT A DESCRIPTION.                                │
 * │ Decision cap-loc-D01 §Recommendation.4 makes the contract a PRECONDITION  │
 * │ on registering the agent — "that contract is the deliverable that closes  │
 * │ audit F5 and it is a blocker on registration, not a follow-up."           │
 * │ `agents/context-manager.md` may not ship until this module does.          │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT R13 IS, AND WHY PROSE CANNOT CLOSE IT
 *
 * The plan's risk R13 (High/High) is "context manager becomes a universal domain
 * expert or policy engine". The plan prescribed "bounded artifacts" and then never
 * bounded them. A skill-body sentence saying "do not promote knowledge" is exactly
 * the prose-only enforcement that has failed repeatedly in this codebase (spec
 * README rule 5). So the bound is expressed the only way a bound survives: as a
 * CLOSED WRITE-ROOT ALLOWLIST and a CLOSED OPERATION VOCABULARY, both checked by
 * a function, with the forbidden roots named EXPLICITLY rather than left to fall
 * off the end of the allowlist.
 *
 * Naming the forbidden roots separately is not redundancy. An allowlist alone
 * degrades silently: add a sixth allowed root one day and `.guild/agents/` might
 * be inside it by accident. `FORBIDDEN_WRITE_ROOTS` is checked FIRST and wins, so
 * "may not write agent definitions" stays true no matter what the allowlist grows
 * into. `contractSelfCheck()` proves the two never overlap.
 *
 * THE FOUR HARD NON-GOALS (cap-loc-D01 §Recommendation.4, verbatim)
 *
 *   may NOT write agent/skill definitions   → `.guild/agents/**`, `.guild/skills/**`
 *   may NOT promote knowledge               → `.guild/wiki/**`, `.guild/knowledge/**`
 *   may NOT decide project questions        → no `decide_*` operation exists
 *   may NOT be imported by the neutral core → NEUTRAL_CORE_IMPORT_ALLOWED = false
 *
 * WHAT IT MAY DO
 *
 * Read broadly; write ONLY run-scoped context and artifact material. That is the
 * whole role: a bounded context assembler with its own window, so a project-local
 * role is not also the thing that assembles its own context (D01 §Option A).
 *
 * CONTRACT: pure data + pure predicates. No I/O, no clock, NEVER throws.
 *
 * C5 DUAL-HOME: mirrored at
 * src/modules/capability/resources/scripts/lib/capability/context-manager-contract.ts.
 * `scripts/lib/**` is the SoT; run `sync:module-resources` — never hand-edit the mirror.
 */

// ── Frozen schema string ─────────────────────────────────────────────────────

export const CONTEXT_MANAGER_CONTRACT_SCHEMA = "guild.context_manager_contract.v1" as const;

/** The agent id, as it appears at `agents/<id>.md` and in the inventory. */
export const CONTEXT_MANAGER_AGENT_ID = "context-manager" as const;

/**
 * Default tier — `mid` (cap-loc-D01 §Recommendation.4: "tier (`mid`)").
 *
 * Deliberately NOT `powerful`: a context assembler that runs at the advisor's tier
 * would make the cheap-labor model pay expensive-supervision prices on every lane,
 * and assembling context is not the kind of judgment the escalation net exists for.
 * Deliberately NOT `cheap` either: summarization that drops the load-bearing half
 * of a bundle is the failure this role exists to prevent.
 */
export const CONTEXT_MANAGER_TIER = "mid" as const;

/**
 * D01's non-negotiable: this contract lands BEFORE the agent registers.
 *
 * Exported as data so the registration guard is a test that reads the contract,
 * not a reviewer who remembers the decision.
 */
export const CONTEXT_MANAGER_REGISTRATION_REQUIRES_CONTRACT = true as const;

/**
 * R13's fourth non-goal, as a checkable constant. The neutral core must never
 * import this agent's machinery — a core that depends on an agent has made the
 * agent load-bearing infrastructure, which is precisely how a bounded assembler
 * becomes a policy engine.
 */
export const CONTEXT_MANAGER_NEUTRAL_CORE_IMPORT_ALLOWED = false as const;

// ── Tool scope ───────────────────────────────────────────────────────────────

/**
 * The agent's tool allowlist (cap-loc-D01: "tool scope (read + bounded write …)").
 *
 * `Bash` is ABSENT and its absence is the point: a shell is a universal write
 * primitive, so granting it would make every path check below decorative. The
 * write bound is only real if the tool set cannot route around it.
 *
 * `Write`/`Edit` are present but constrained by `classifyContextManagerWrite` —
 * the tool grants the verb, the path allowlist grants the target.
 */
export const CONTEXT_MANAGER_TOOLS = Object.freeze([
  "Read",
  "Grep",
  "Glob",
  "Write",
  "Edit",
] as const);
export type ContextManagerTool = (typeof CONTEXT_MANAGER_TOOLS)[number];

/** Tools explicitly WITHHELD, each with the reason, so a future widening is argued. */
export const CONTEXT_MANAGER_WITHHELD_TOOLS = Object.freeze([
  "Bash", // a shell is a universal write primitive — it would void the path allowlist
  "Task", // spawning lanes is orchestration; this role assembles, it does not dispatch
  "WebFetch", // context comes from the project, not the internet
  "WebSearch",
] as const);

// ── Capability scope ─────────────────────────────────────────────────────────

/**
 * The CLOSED operation vocabulary (cap-loc-D01: "an explicit `capability_scope`").
 *
 * Every verb here is an assembly verb. There is deliberately no `decide_*`,
 * `promote_*`, `register_*`, `approve_*`, or `create_*` member — R13's "policy
 * engine" failure mode is not forbidden by a rule the agent could reinterpret, it
 * is unexpressible in the vocabulary the agent is scoped to.
 */
export const CONTEXT_MANAGER_CAPABILITY_SCOPE = Object.freeze([
  "assemble_context_bundle",
  "summarize_for_bundle",
  "resolve_recall_query",
  "record_context_receipt",
  "emit_capability_profile",
] as const);
export type ContextManagerOperation = (typeof CONTEXT_MANAGER_CAPABILITY_SCOPE)[number];

const CAPABILITY_SCOPE_SET: ReadonlySet<string> = new Set<string>(
  CONTEXT_MANAGER_CAPABILITY_SCOPE
);

/**
 * Operations named as FORBIDDEN even though no allowed verb implies them.
 *
 * Same reasoning as `FORBIDDEN_WRITE_ROOTS`: an allowlist that merely omits
 * something records nothing about whether the omission was deliberate. A reviewer
 * proposing `promote_knowledge` next quarter should hit a constant that says no,
 * not an absence they can read as an oversight.
 */
export const CONTEXT_MANAGER_FORBIDDEN_OPERATIONS = Object.freeze([
  "write_agent_definition",
  "write_skill_definition",
  "promote_knowledge",
  "register_capability",
  "approve_candidate",
  "decide_project_question",
  "advance_resolver_mode",
] as const);
export type ContextManagerForbiddenOperation =
  (typeof CONTEXT_MANAGER_FORBIDDEN_OPERATIONS)[number];

const FORBIDDEN_OPERATION_SET: ReadonlySet<string> = new Set<string>(
  CONTEXT_MANAGER_FORBIDDEN_OPERATIONS
);

// ── Read/write boundary ──────────────────────────────────────────────────────

/**
 * The ONLY roots this agent may write under (cap-loc-D01: "bounded write to
 * `.guild/context/**` and `.guild/artifacts/**` only", plus the run-scoped root
 * the capability profile is emitted into).
 *
 * `.guild/runs/` is here because S1's profile is a RUN artifact — it is bound to
 * `run_id` and lives with the replayable evidence. It is not a widening: a run
 * directory holds evidence, never definitions, and `FORBIDDEN_WRITE_ROOTS` still
 * wins if the two ever overlap.
 */
export const CONTEXT_MANAGER_WRITE_ROOTS = Object.freeze([
  ".guild/context",
  ".guild/artifacts",
  ".guild/runs",
] as const);
export type ContextManagerWriteRoot = (typeof CONTEXT_MANAGER_WRITE_ROOTS)[number];

/**
 * Roots this agent may NEVER write under, checked BEFORE the allowlist.
 *
 * Order is load-bearing. If the allowlist were checked first, adding a broader
 * allowed root later would silently re-admit a forbidden one; checked first, the
 * denial holds no matter how the allowlist evolves. `contractSelfCheck()` asserts
 * the two sets are disjoint today, so the ordering is belt-and-braces rather than
 * papering over an existing overlap.
 */
export const CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS = Object.freeze([
  ".guild/agents", // may NOT write agent definitions
  ".guild/skills", // may NOT write skill definitions
  ".guild/wiki", // may NOT promote knowledge
  ".guild/knowledge",
  ".guild/memory",
  ".guild/teams",
  ".guild/initiatives",
  ".guild/settings.json",
  ".guild/guild.yaml",
  ".guild/workspace.json",
] as const);

/** Roots the agent may READ. Broad by design — reading is not the risk R13 names. */
export const CONTEXT_MANAGER_READ_ROOTS = Object.freeze([
  ".guild",
  "docs",
  "src",
  "scripts",
] as const);

// ── Path hardening ───────────────────────────────────────────────────────────

/**
 * Cap on a write path. A path is an identifier-shaped scalar; an unbounded one is
 * a body field waiting to be used (spec README rule 6 — S4 shipped a `child_commit`
 * that carried a 12 KB agent definition).
 */
export const CONTEXT_MANAGER_PATH_MAX_LEN = 512;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Canonical project-relative path: forward slashes, no empty/`.`/`..` segments, no
 * leading or trailing slash, no backslashes, no control characters, bounded.
 *
 * REJECTS non-canonical spellings; never normalizes (spec README rule 5). If
 * `.guild/context/./x.md` were normalized to `.guild/context/x.md`, then two
 * spellings would name one file and any downstream dedup over raw strings would
 * be unsound. Rejecting makes raw-string comparison correct by construction.
 */
export function isCanonicalRelPath(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.length === 0 || v.length > CONTEXT_MANAGER_PATH_MAX_LEN) return false;
  if (CONTROL_CHARS.test(v)) return false;
  if (v.includes("\\")) return false;
  if (v.startsWith("/")) return false; // absolute — not project-relative
  if (/^[A-Za-z]:/.test(v)) return false; // drive-letter absolute
  for (const seg of v.split("/")) {
    if (seg.length === 0) return false; // leading, trailing, or doubled slash
    if (seg === "." || seg === "..") return false; // alias or traversal
  }
  return true;
}

/**
 * SEGMENT-WISE containment: is `path` at or under `root`?
 *
 * Deliberately not `path.startsWith(root + "/")` alone — that is correct, but the
 * near-miss `startsWith(root)` (no separator) is the classic bug where
 * `.guild/contextual-notes/x` reads as being under `.guild/context`. Comparing
 * segment arrays makes the near-miss unwritable rather than merely avoided.
 *
 * A path EQUAL to the root counts as under it, so `.guild/settings.json` as a
 * forbidden "root" denies the file itself.
 */
function isUnderRoot(path: string, root: string): boolean {
  if (path === root) return true;
  const p = path.split("/");
  const r = root.split("/");
  if (p.length <= r.length) return false;
  for (let i = 0; i < r.length; i++) if (p[i] !== r[i]) return false;
  return true;
}

// ── The decision ─────────────────────────────────────────────────────────────

/** Closed refusal vocabulary. A caller branches on these, never on a message string. */
export const CONTEXT_MANAGER_DENY_REASONS = Object.freeze([
  "malformed_path",
  "forbidden_root",
  "outside_write_roots",
] as const);
export type ContextManagerDenyReason = (typeof CONTEXT_MANAGER_DENY_REASONS)[number];

export type ContextManagerWriteVerdict =
  | { allowed: true; root: ContextManagerWriteRoot }
  | { allowed: false; reason: ContextManagerDenyReason };

/**
 * May the context-manager write `relPath`? The R13 bound, as a function.
 *
 * Fail-closed in every direction: a malformed path is a refusal, not a repair; an
 * unrecognized location is a refusal, not a default-allow. NEVER throws.
 *
 * @param relPath project-root-relative, canonical spelling only.
 */
export function classifyContextManagerWrite(relPath: unknown): ContextManagerWriteVerdict {
  try {
    if (!isCanonicalRelPath(relPath)) return { allowed: false, reason: "malformed_path" };

    // FORBIDDEN FIRST — see CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS on why order matters.
    for (const forbidden of CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS) {
      if (isUnderRoot(relPath, forbidden)) return { allowed: false, reason: "forbidden_root" };
    }

    for (const root of CONTEXT_MANAGER_WRITE_ROOTS) {
      // Equality with a write root means "write the directory itself" — not a file,
      // so it is not an allowed write. Require strictly-under.
      if (relPath !== root && isUnderRoot(relPath, root)) return { allowed: true, root };
    }

    return { allowed: false, reason: "outside_write_roots" };
  } catch {
    return { allowed: false, reason: "malformed_path" };
  }
}

/** Is `op` inside the declared capability scope? Closed set; unknown ⇒ false. */
export function isContextManagerOperation(op: unknown): op is ContextManagerOperation {
  return typeof op === "string" && CAPABILITY_SCOPE_SET.has(op);
}

/** Is `op` one of the explicitly-named forbidden operations? */
export function isContextManagerForbiddenOperation(
  op: unknown
): op is ContextManagerForbiddenOperation {
  return typeof op === "string" && FORBIDDEN_OPERATION_SET.has(op);
}

/** Is `tool` inside the declared tool scope? Closed set; unknown ⇒ false. */
export function isContextManagerTool(tool: unknown): tool is ContextManagerTool {
  return typeof tool === "string" && (CONTEXT_MANAGER_TOOLS as readonly string[]).includes(tool);
}

// ── Self-check ───────────────────────────────────────────────────────────────

/**
 * Internal-consistency check over the contract's own vocabularies.
 *
 * Exists because every guarantee above is a relationship BETWEEN two frozen lists,
 * and a list edited in isolation can silently void one. Returns a list of problem
 * strings — EMPTY means consistent. Never throws.
 */
export function contractSelfCheck(): string[] {
  const problems: string[] = [];

  // 1. Allowed and forbidden write roots must be disjoint, in BOTH containment
  //    directions — an allowed root nested under a forbidden one (or vice versa)
  //    is the overlap the FORBIDDEN-first ordering would then be hiding.
  // Widened to `string` deliberately. TypeScript can already prove these two
  // literal unions are disjoint TODAY — which is why the comparison would
  // otherwise be flagged as unintentional. The runtime check is for TOMORROW: the
  // literal types change the moment someone edits a list, and a compile-time proof
  // that vanishes with the edit it was meant to police is not a guard.
  const allowedRoots: readonly string[] = CONTEXT_MANAGER_WRITE_ROOTS;
  const forbiddenRoots: readonly string[] = CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS;
  for (const allowed of allowedRoots) {
    for (const forbidden of forbiddenRoots) {
      if (allowed === forbidden || isUnderRoot(allowed, forbidden) || isUnderRoot(forbidden, allowed)) {
        problems.push(`write root "${allowed}" overlaps forbidden root "${forbidden}"`);
      }
    }
  }

  // 2. Every root must itself be a canonical path, or the containment comparison
  //    is being done against a spelling `classifyContextManagerWrite` would reject.
  for (const root of [...CONTEXT_MANAGER_WRITE_ROOTS, ...CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS]) {
    if (!isCanonicalRelPath(root)) problems.push(`root "${root}" is not canonical`);
  }

  // 3. The allowed and forbidden OPERATION vocabularies must not intersect.
  for (const op of CONTEXT_MANAGER_CAPABILITY_SCOPE) {
    if (FORBIDDEN_OPERATION_SET.has(op)) problems.push(`operation "${op}" is both allowed and forbidden`);
  }

  // 4. R13's structural guarantee: no allowed operation may be a creation,
  //    promotion, registration, or decision verb. Checked by PREFIX so a future
  //    `promote_anything` cannot be added without tripping this.
  for (const op of CONTEXT_MANAGER_CAPABILITY_SCOPE) {
    if (/^(decide|promote|register|approve|create|delete|install)_/.test(op)) {
      problems.push(`operation "${op}" is an authority verb — R13 forbids it`);
    }
  }

  // 5. A withheld tool must not also be granted.
  for (const tool of CONTEXT_MANAGER_WITHHELD_TOOLS) {
    if ((CONTEXT_MANAGER_TOOLS as readonly string[]).includes(tool)) {
      problems.push(`tool "${tool}" is both granted and withheld`);
    }
  }

  return problems;
}
