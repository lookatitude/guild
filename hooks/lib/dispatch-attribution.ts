/**
 * hooks/lib/dispatch-attribution.ts
 *
 * Shared resolver for Guild specialist attribution on an `Agent` tool dispatch
 * (issue #58 — make specialist type-erasure DETECTABLE).
 *
 * Background: a project-local specialist (`definition_source: "project"`,
 * `.guild/agents/<role>.md`) has no host-registered agent under its name, so the
 * backend dispatches it as the host-generic `subagent_type` ("general-purpose")
 * WITH its definition carried in the dispatch — env `GUILD_AGENT_DEFINITION` +
 * a definition-adoption prompt prefix (`composeInProcessDispatch` /
 * `buildPrompt`). The correct first-class dispatch and a persona-stripped
 * defective dispatch were previously BYTE-IDENTICAL: both `general-purpose`. The
 * only differentiator is exactly those two carriers. This module reads them off
 * the `Agent` tool_input so:
 *   - the PreToolUse guard can FAIL CLOSED on a lane dispatch that claims a
 *     specialist persona but is missing GUILD_AGENT_DEFINITION, and
 *   - the run-trace can stamp `attribution_specialist` (the resolved role) on
 *     the dispatch event for post-hoc audits.
 *
 * Pure + dependency-free — trivially unit-testable. Consumed by both
 * pre-tool-use.ts (the guard) and post-tool-use.ts (the trace stamp).
 */

/**
 * The host-generic subagent type project specialists dispatch as (mirrors
 * `scripts/lib/core/contracts/team-backend.ts` GENERIC_SUBAGENT_TYPE — the
 * hooks build is separate, so the constant is restated, not imported).
 */
export const GENERIC_SUBAGENT_TYPE = "general-purpose";

/** A WHOLE definition path is EXACTLY `.guild/agents/<role>.md` (role in group 1). */
const DEF_PATH_RE = /^\.guild\/agents\/([A-Za-z0-9._-]+)\.md$/;

/**
 * A safe specialist identifier — bounds what may be stamped into telemetry.
 * Deliberately the SAME shape/length as Guild's canonical run/lane id contract
 * (`RUN_ID_RE` / `LANE_ID_RE` in lib/v1.4/log-jsonl-schema.ts: leading
 * alphanumeric + up to 127 more), so a legitimate long specialist name is never
 * silently dropped. A name outside this bound yields NO role — which fails
 * CLOSED at the guard (no valid definition proof), never open.
 */
const SAFE_ROLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// ── Adoption-prompt signatures ───────────────────────────────────────────────
//
// These are deliberately PRODUCER-SPECIFIC, not loose keyword heuristics. Only
// Guild's own prompt producers emit these exact phrasings, so an ordinary
// human-written generic prompt cannot trip them — which is what keeps the guard
// from ever interfering with a non-Guild `Agent` call. (A looser "agents-file
// path + the word adopt/persona anywhere" rule was rejected in adversarial
// review: it misclassifies benign prompts like "Review .guild/agents/backend.md.
// Adopt a skeptical reviewer persona.")

/**
 * The machine-readable adoption PREFIX `buildPrompt` emits as the prompt's very
 * FIRST LINE for a project specialist. This is the primary adoption proof and
 * the primary prompt-side identity carrier: a fixed producer-owned position
 * that the lane's arbitrary appended `scope` text can neither forge nor
 * contradict.
 */
const DEFINITION_MARKER_RE = /^GUILD_AGENT_DEFINITION=(\S+)$/;

/**
 * The UNIVERSAL line-1 producer marker (rf-wi-03 / G3), emitted by `buildPrompt`
 * as the first line of every NON-project (shipped specialist / orchestrator)
 * dispatch: `GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=<role>`. It carries
 * producer identity for the dispatch class that has no GUILD_AGENT_DEFINITION
 * line, making line-1 a universal identity anchor across both classes.
 *
 * rf-wi-06 (issue #91) — the marker is now UNIVERSAL. G3/rf-wi-03 covered every
 * dispatch composed by `composeInProcessDispatch` / `buildPrompt` (team, tmux,
 * in-process, remote); rf-wi-06 marked the last uncovered class, the direct D5
 * `subagent` rung — a SKILL-authored inline `Agent()` call issued by
 * `guild:execute-plan` with no launcher descriptor at all (see
 * `scripts/agent-team-launcher.ts`'s `resolvedMode !== "team"` branch, which
 * hands the whole `Agent()` construction back to the skill; the skill stamps
 * both halves itself per its §"Capability-scope env injection" steps
 * (2b)/(2c)). With no unmarked class left, the class-gated legacy 300-char
 * producer-head parse (`ROLE_DEF_ANCHOR_RE` / `DISPATCH_PROSE_RE` /
 * `PRODUCER_HEAD_CHARS` / `anchorRole` / `proseRole` / `hasProseSignature`) and
 * the five rounds of gating it required are DELETED. Identity is now read from
 * producer-owned positions ONLY: the dispatch's own `env` map and the prompt's
 * FIRST LINE — positions the lane's arbitrary appended scope text can neither
 * forge nor contradict. Free-text prompt prose is no longer an identity carrier
 * anywhere, which is what removes the whole class of scope-text false
 * positives/negatives the gating existed to manage.
 *
 * ACCEPTED COVERAGE TRADE (rf-wi-06 adversarial review, round 1 finding 4). These
 * generic-dispatch shapes were BLOCKED before the deletion and now PASS:
 *   (a) a legacy role-definition anchor in the first 300 chars with no line-1
 *       marker and a missing/invalid/mismatched definition env;
 *   (b) legacy "dispatched as the Guild <role> specialist" prose with no other
 *       structural lane signal;
 *   (c) a role-less env producer TOKEN plus either legacy signature, with the
 *       prompt marker and role carriers stripped;
 *   (d) a malformed line-1 marker attempt rescued by a legacy anchor/prose.
 * None is producible by an intact emitter: `composeInProcessDispatch`,
 * `buildPrompt` and `paneCommand` stamp both marker halves atomically, and the
 * D5 rung is now stamped by `guild:execute-plan` itself. Every one of these is a
 * hand-rolled, pre-marker, or partially-corrupted dispatch. They are accepted as
 * unblockable because the alternative — keeping a free-text identity parse alive
 * forever — is what made five rounds of class-gating necessary and is itself a
 * standing false-positive surface. Note the consequence honestly: with no
 * canonical handoff block and no "teammate for run-id" phrasing, these also drop
 * from `prompt_only` to `none` in `classifyLaneEvidence`, so even strict
 * unmarked-lane mode cannot see them. The bounded `promptTeammate` signal is kept
 * deliberately (below) because it preserves some corrupted-lane VISIBILITY while
 * carrying no identity and never blocking.
 *
 * KNOWN GAP, NOT CLOSED HERE (rf-wi-06 adversarial review, round 1 finding 3 /
 * round 2). The producer marker is documented as a TWO-HALF contract (env +
 * prompt line 1), but only the prompt half is read by this resolver: strip
 * `GUILD_DISPATCH_PRODUCER` from an otherwise-correct dispatch and nothing here
 * denies it. Nor does anything else catch it today — `classifyLaneEvidence`
 * still grades that dispatch `structured` from its OTHER env carriers
 * (`GUILD_SPECIALIST` / `GUILD_TASK_ID` / `GUILD_AGENT_DEFINITION`), and the
 * strict `blockUnmarked` rung in `backend-degradation.ts` only ever applies to
 * `prompt_only` evidence, so it never sees this shape. Enforcing the env half is
 * therefore a NEW requirement, not something an existing rung already covers.
 * It is deliberately out of scope for issue #91: making the token REQUIRED is a
 * new blocking policy that would deny every pre-#85 dispatch and any host adapter
 * that carries the other carriers but not the token. Tracked as a followup.
 */
const PRODUCER_MARKER_HEAD = "GUILD_DISPATCH_PRODUCER=";
const PRODUCER_MARKER_VALUE_RE = /^guild\.dispatch\.v\d+$/;
const PRODUCER_MARKER_TOKEN_RE = /^[A-Za-z][A-Za-z0-9_]*=[^\s]+$/;

/**
 * Parse the producer marker's role from a prompt's FIRST LINE, or undefined
 * when the line is not a well-formed marker. The WHOLE line must parse — a
 * malformed token, a bad version, a bad role, or a duplicate `role=` rejects the
 * marker outright (adversarial review round 2, finding 3): `role=advisor/garbage`,
 * `role=advisor trailing-junk`, and `role=advisor role=backend` all yield no
 * attribution rather than a partial/last-wins guess.
 */
function producerMarkerRole(firstLine: string): string | undefined {
  if (!firstLine.startsWith(PRODUCER_MARKER_HEAD)) return undefined;
  const tokens = firstLine.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  const value = tokens[0].slice(PRODUCER_MARKER_HEAD.length);
  if (!PRODUCER_MARKER_VALUE_RE.test(value)) return undefined;
  let role: string | undefined;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (!PRODUCER_MARKER_TOKEN_RE.test(t)) return undefined; // trailing junk ⇒ reject whole line
    const eq = t.indexOf("=");
    const k = t.slice(0, eq);
    if (k === "role") {
      if (role !== undefined) return undefined; // duplicate role ⇒ reject
      role = t.slice(eq + 1);
    }
  }
  return safeRole(role);
}

/**
 * Bound for the ONE remaining prompt-text probe: the "teammate for run-id"
 * phrasing, a weak LANE SIGNATURE (`hasLaneSignature`) that never contributes
 * identity and is never blocked on. It stays bounded to the producer-owned
 * opening for the same reason identity always was — `buildPrompt` appends the
 * lane's arbitrary `scope` after it, and a scope that happens to quote a brief
 * must not read as a lane signal (#58 adversarial review round 5). Widening it
 * to the whole prompt would be a strictly looser signal, so the bound survives
 * the rf-wi-06 deletion of the identity regexes it used to share.
 */
const LANE_SIGNATURE_HEAD_CHARS = 300;

/** Bound a candidate role to a safe identifier, else drop it. */
function safeRole(v: string | undefined): string | undefined {
  return v !== undefined && SAFE_ROLE_RE.test(v) ? v : undefined;
}

export interface DispatchAttribution {
  /** subagent_type as dispatched ("" when absent). */
  subagentType: string;
  /** subagent_type === GENERIC_SUBAGENT_TYPE. */
  isGeneric: boolean;
  /** Resolved specialist role, when determinable (env > definition path > prompt). */
  specialist?: string;
  /** GUILD_AGENT_DEFINITION env carried on the dispatch, trimmed, when non-empty. */
  definitionPath?: string;
  /** GUILD_TASK_ID env carried on the dispatch, when present + non-empty. */
  taskId?: string;
  /**
   * The dispatch is a Guild project-specialist LANE: its prompt's FIRST LINE
   * carries the `GUILD_AGENT_DEFINITION=.guild/agents/<role>.md` adoption
   * marker, OR it carries BOTH GUILD_SPECIALIST + GUILD_TASK_ID env (a composed
   * team lane), OR it is host-generic while carrying the by-name class's
   * role-bearing producer marker (a class mismatch — see
   * `isMisclassedGenericMarker`). This is the class of dispatch that MUST carry
   * GUILD_AGENT_DEFINITION + the adoption prompt.
   */
  isSpecialistLane: boolean;
  /**
   * The prompt's FIRST LINE is the `GUILD_AGENT_DEFINITION=.guild/agents/<role>.md`
   * adoption marker. Producer-owned position only — prose never counts.
   */
  hasAdoptionPrompt: boolean;
  /**
   * GUILD_AGENT_DEFINITION is a well-formed `.guild/agents/<role>.md` path AND,
   * when GUILD_SPECIALIST is present, its role matches the specialist. A path
   * that is whitespace / arbitrary / role-mismatched is NOT valid proof.
   */
  hasValidDefinition: boolean;
  /**
   * Every identity carrier present on the dispatch (GUILD_SPECIALIST, the
   * definition path's role, the adoption prompt's role) names the SAME role.
   * False = the lane would adopt a persona that disagrees with its own
   * attribution — real drift, not a forgery concern.
   */
  hasConsistentIdentity: boolean;
  /** Any Guild-lane signal at all (superset of isSpecialistLane). */
  hasLaneSignature: boolean;
}

function envStr(env: Record<string, unknown>, key: string): string | undefined {
  const v = env[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Resolve specialist attribution from an `Agent` tool_input. Returns null when
 * the input is not Agent-shaped (no `subagent_type` and no `prompt`) so callers
 * cleanly fall through for non-dispatch tool calls.
 */
export function resolveDispatchAttribution(toolInput: unknown): DispatchAttribution | null {
  if (toolInput === null || typeof toolInput !== "object") return null;
  const ti = toolInput as Record<string, unknown>;
  if (!("subagent_type" in ti) && !("prompt" in ti)) return null;

  const subagentType = typeof ti.subagent_type === "string" ? ti.subagent_type : "";
  const prompt = typeof ti.prompt === "string" ? ti.prompt : "";
  const env =
    ti.env !== null && typeof ti.env === "object"
      ? (ti.env as Record<string, unknown>)
      : {};

  const definitionPathRaw = envStr(env, "GUILD_AGENT_DEFINITION");
  const definitionPath = definitionPathRaw?.trim();
  const taskId = envStr(env, "GUILD_TASK_ID");
  // Only trust GUILD_SPECIALIST as a role if it is a safe identifier — it is
  // stamped into telemetry and matched against the definition path.
  const specialistEnv = safeRole(envStr(env, "GUILD_SPECIALIST"));

  // ── Identity is parsed ONLY from producer-owned positions ────────────────
  // (1) the FIRST LINE marker, and (2) the bounded producer head. The lane's
  // arbitrary `scope` text is never parsed for identity or adoption proof.
  const firstLine = (prompt.split("\n", 1)[0] ?? "").trim();
  const markerPath = DEFINITION_MARKER_RE.exec(firstLine)?.[1];
  const markerRole = safeRole(
    markerPath !== undefined ? DEF_PATH_RE.exec(markerPath)?.[1] : undefined,
  );
  // G3 — the universal line-1 producer marker's role (shipped-specialist /
  // orchestrator dispatches, which have no GUILD_AGENT_DEFINITION line). An
  // identity carrier + lane signature, but NOT adoption proof (it never tells the
  // lane to read/adopt a definition), so it does not feed hasAdoptionPrompt.
  const producerMarkerRoleValue = producerMarkerRole(firstLine);

  const head = prompt.slice(0, LANE_SIGNATURE_HEAD_CHARS);

  /** Adoption PROOF = a producer-owned definition-adoption instruction. */
  const hasAdoptionPrompt = markerRole !== undefined;

  // A VALID definition path is EXACTLY `.guild/agents/<role>.md` — whitespace,
  // arbitrary paths, and role-mismatched paths do NOT count as proof (#58,
  // adversarial review).
  const defMatch =
    definitionPath !== undefined && definitionPath.length > 0
      ? DEF_PATH_RE.exec(definitionPath)
      : null;
  const defRole = safeRole(defMatch?.[1]);
  // A resolvable defRole is REQUIRED: a path that matches the shape but whose
  // role falls outside the identifier bound is NOT proof — fail closed rather
  // than let an unbounded role slip through as valid (adversarial review r4).
  const hasValidDefinition =
    defMatch !== null &&
    defRole !== undefined &&
    (specialistEnv === undefined || defRole === specialistEnv);

  // Every identity source that IS present must name the SAME role. Catches real
  // orchestrator drift where e.g. GUILD_SPECIALIST/definition say `devops` but
  // the prompt's line-1 marker names `frontend` — the lane would run the wrong
  // persona (adversarial review rounds 2 + 3). All carriers are read from
  // producer-owned positions only, so appended scope text can never conflict.
  const roles = [specialistEnv, defRole, markerRole, producerMarkerRoleValue].filter(
    (r): r is string => r !== undefined,
  );
  const hasConsistentIdentity = roles.every((r) => r === roles[0]);

  // Attribution role — from identity carriers ONLY. A stray `.guild/agents/x.md`
  // mention in ordinary prompt/scope text is NOT a carrier and never yields a
  // specialist.
  const specialist = specialistEnv ?? defRole ?? markerRole ?? producerMarkerRoleValue;

  const promptTeammate = /teammate for run-id/i.test(head);

  // A composed team lane always carries BOTH GUILD_SPECIALIST + GUILD_TASK_ID
  // (composeInProcessDispatch). Either the adoption proof or that env pair marks
  // a project-specialist lane that MUST carry the full contract.
  const isComposedLane = taskId !== undefined && specialistEnv !== undefined;
  // rf-wi-06 — the third entry replaces the deleted `hasProseSignature` with a
  // STRUCTURAL check of the same drift. Producer contract: the host-generic
  // subagent_type is reserved for PROJECT specialists, whose line 1 is the
  // GUILD_AGENT_DEFINITION marker (`composeInProcessDispatch` keys
  // GENERIC_SUBAGENT_TYPE on `definition_source === "project"`, and `buildPrompt`
  // emits the `GUILD_DISPATCH_PRODUCER … role=` line ONLY for the non-project,
  // dispatched-BY-NAME class). So a role-bearing producer marker on a
  // `general-purpose` dispatch is a class mismatch: the dispatch claims a Guild
  // persona while carrying no adoption proof. That is precisely the shape the
  // prose signature used to catch (rf-wi-07c round 5) — a marker whose
  // GUILD_SPECIALIST/GUILD_AGENT_DEFINITION were stripped — and it is caught
  // here from a producer-owned carrier instead of free text, so no legitimate
  // producer-composed dispatch can trip it.
  const isMisclassedGenericMarker =
    subagentType === GENERIC_SUBAGENT_TYPE && producerMarkerRoleValue !== undefined;
  const isSpecialistLane = hasAdoptionPrompt || isComposedLane || isMisclassedGenericMarker;

  const hasLaneSignature =
    isSpecialistLane ||
    promptTeammate ||
    taskId !== undefined ||
    specialistEnv !== undefined ||
    // G3 — the universal producer marker is a lane signature (not adoption proof,
    // so it stays out of isSpecialistLane / the #58 persona-strip predicate).
    producerMarkerRoleValue !== undefined;

  const out: DispatchAttribution = {
    subagentType,
    isGeneric: subagentType === GENERIC_SUBAGENT_TYPE,
    isSpecialistLane,
    hasAdoptionPrompt,
    hasValidDefinition,
    hasConsistentIdentity,
    hasLaneSignature,
  };
  if (specialist !== undefined) out.specialist = specialist;
  if (definitionPath !== undefined) out.definitionPath = definitionPath;
  if (taskId !== undefined) out.taskId = taskId;
  return out;
}

/**
 * The #58 fail-closed predicate: a Guild project-specialist LANE dispatched as
 * the host-generic type that does NOT carry the full non-stripped contract —
 * a VALID GUILD_AGENT_DEFINITION (well-formed `.guild/agents/<role>.md`,
 * role-matched), the definition-adoption prompt, AND a consistent identity
 * across all three carriers. Missing/whitespace/arbitrary/role-mismatched
 * definition, a stripped adoption prompt, or an adoption prompt naming a
 * DIFFERENT role than the dispatch claims — each makes the lane a silently
 * persona-stripped (or wrong-persona) generic agent. Block it. The intended
 * dispatch and the defective one are no longer byte-identical; this predicate
 * is what distinguishes them.
 */
export function isPersonaStrippedDispatch(attr: DispatchAttribution): boolean {
  return dispatchViolations(attr).length > 0;
}

/** Which specific carrier of the dispatch contract failed. */
export type DispatchViolation =
  | "missing_definition"
  | "missing_adoption_prompt"
  | "identity_mismatch";

/**
 * The specific invariant(s) a persona-stripped dispatch violated — empty when
 * the dispatch is fine. The deny message and the security event are built from
 * THIS, so an operator is told what actually broke ("the adoption prompt was
 * stripped") instead of a blanket, and possibly false, "GUILD_AGENT_DEFINITION
 * is missing" (adversarial review round 6).
 */
export function dispatchViolations(attr: DispatchAttribution): DispatchViolation[] {
  if (!attr.isGeneric || !attr.isSpecialistLane) return [];
  const out: DispatchViolation[] = [];
  if (!attr.hasValidDefinition) out.push("missing_definition");
  if (!attr.hasAdoptionPrompt) out.push("missing_adoption_prompt");
  if (!attr.hasConsistentIdentity) out.push("identity_mismatch");
  return out;
}

/** One actionable sentence per violated invariant. */
export function describeViolation(
  v: DispatchViolation,
  role: string,
  attr: DispatchAttribution,
): string {
  switch (v) {
    case "missing_definition":
      return (
        `no valid GUILD_AGENT_DEFINITION env` +
        (attr.definitionPath !== undefined
          ? ` (got ${JSON.stringify(attr.definitionPath)}` +
            `, expected ".guild/agents/${role}.md")`
          : ` (absent; expected ".guild/agents/${role}.md")`)
      );
    case "missing_adoption_prompt":
      return (
        `the definition-adoption prompt prefix was stripped — the prompt must ` +
        `begin with the line "GUILD_AGENT_DEFINITION=.guild/agents/${role}.md" ` +
        `so the lane is actually told to adopt its role definition`
      );
    case "identity_mismatch":
      return (
        `the dispatch's identity carriers disagree about the role ` +
        `(GUILD_SPECIALIST / GUILD_AGENT_DEFINITION / the prompt's adoption ` +
        `marker must all name the SAME specialist) — the lane would run the ` +
        `wrong persona`
      );
  }
}
