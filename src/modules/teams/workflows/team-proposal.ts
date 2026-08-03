/**
 * src/modules/teams/workflows/team-proposal.ts
 *
 * T2b (dynamic-host-model-routing) — `guild.team_proposal.v2`: the immutable,
 * UNCAPPED phase proposal (team-contracts §2–§3).
 *
 * The logical team is TASK-DERIVED AND UNCAPPED. There is NO specialist-count
 * cap, NO default size target, and NO truncation path anywhere in this module:
 * the composer proposes EVERY participant it can justify, the validator rejects
 * a proposal on coverage/structure grounds only — size is never a rejection
 * reason. Backend/host limits are a scheduling concern (team-schedule.ts §5),
 * never a roster input.
 *
 * Closed schema: `validateProposal` rejects unknown keys at every level, which
 * is what structurally retires `cap` / `capped` / `dropped_roles` /
 * `max_team_size` / `team_size` — a truncation artifact cannot even be
 * expressed in v2.
 */

import * as crypto from "crypto";
import * as fs from "fs";

import {
  canonicalYaml,
  isSha256Hex,
  selfReferentialHash,
  cloneArtifact,
} from "./canonical-hash";
import { writeRunArtifact } from "./station-signals";

export const TEAM_PROPOSAL_SCHEMA = "guild.team_proposal.v2" as const;
export const PROPOSAL_HASH_ALGORITHM = "sha256" as const;
export const PROPOSAL_HASH_SCOPE =
  "canonical_yaml_with_proposal_hash_field_omitted" as const;

// ── Vocabulary (frozen contract enums) ───────────────────────────────────────

export const PARTICIPATION_KINDS = Object.freeze([
  "worker",
  "advisor",
  "challenger",
  "reviewer_local",
  "reviewer_cross_host",
] as const);
export type ParticipationKind = (typeof PARTICIPATION_KINDS)[number];

export const PROPOSAL_TIERS = Object.freeze(["cheap", "mid", "powerful"] as const);
export type ProposalTier = (typeof PROPOSAL_TIERS)[number];

/** model_policy §2 purpose enum (the closed set participants may carry). */
export const PARTICIPANT_PURPOSES = Object.freeze([
  "general",
  "implementation",
  "planning",
  "research",
  "advisory",
  "adversarial",
  "security",
  "adversarial-security",
] as const);

export const OBLIGATION_SOURCES = Object.freeze([
  "success_criterion",
  "plan_item",
  "ownership_boundary",
  "risk",
  "implied_rule",
  "review_gate",
] as const);

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProposalParticipant {
  participant_id: string;
  participation_kind: ParticipationKind;
  role_ref: string;
  necessity_rationale: string;
  owned_obligations: string[];
  depends_on: string[];
  tier: ProposalTier;
  purpose: (typeof PARTICIPANT_PURPOSES)[number];
  capability_scope: string[] | null;
  backend: string;
}

export interface ProposalObligation {
  obligation_id: string;
  source: (typeof OBLIGATION_SOURCES)[number];
  text: string;
  disposition: {
    owners?: string[];
    exclusion?: { rationale: string; user_accepted: boolean };
  };
}

export interface ExcludedRole {
  role_ref: string;
  why_unnecessary: string;
}

export interface BackendCapacityEvidence {
  backend: string;
  verified_capacity: number;
  method: string;
  as_of: string;
}

export interface ArtifactRef {
  path: string;
  sha256: string;
}

export interface TeamProposalV2 {
  schema_version: typeof TEAM_PROPOSAL_SCHEMA;
  run_id: string;
  phase: string;
  spec_ref?: ArtifactRef;
  plan_ref?: ArtifactRef;
  // §3 frozen fields — ALL REQUIRED (G-lane rework F2: a proposal missing any
  // of these is INVALID; the gate fails closed, never "checks when present").
  proposal_version: number;
  parent_proposal_hash: string | null;
  proposal_hash_algorithm: typeof PROPOSAL_HASH_ALGORITHM;
  proposal_hash_scope: typeof PROPOSAL_HASH_SCOPE;
  proposal_hash?: string;
  participants: ProposalParticipant[];
  obligations: ProposalObligation[];
  excluded_roles: ExcludedRole[];
  backend_capacity_evidence?: BackendCapacityEvidence;
  proposed_schedule?: { waves: string[][] };
  provenance?: string;
}

export interface ProposalVerdict {
  valid: boolean;
  /** Structural/coverage findings; EMPTY when valid. Size is NEVER a reason. */
  reasons: string[];
}

// ── Key closure (the schema is CLOSED — unknown keys reject) ─────────────────

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  "schema_version",
  "run_id",
  "phase",
  "spec_ref",
  "plan_ref",
  "proposal_version",
  "parent_proposal_hash",
  "proposal_hash_algorithm",
  "proposal_hash_scope",
  "proposal_hash",
  "participants",
  "obligations",
  "excluded_roles",
  "backend_capacity_evidence",
  "proposed_schedule",
  "provenance",
]);

const PARTICIPANT_KEYS: ReadonlySet<string> = new Set([
  "participant_id",
  "participation_kind",
  "role_ref",
  "necessity_rationale",
  "owned_obligations",
  "depends_on",
  "tier",
  "purpose",
  "capability_scope",
  "backend",
]);

const OBLIGATION_KEYS: ReadonlySet<string> = new Set([
  "obligation_id",
  "source",
  "text",
  "disposition",
]);

const isNonEmptyStr = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);

// ── validateProposal ─────────────────────────────────────────────────────────

/**
 * Fail-closed validation of a `guild.team_proposal.v2` (team-contracts §3).
 * Enforces: closed schema (unknown keys reject — including every retired
 * cap/size key), unique participant ids, non-empty necessity rationale,
 * dependency-valid `depends_on` (resolvable ids, acyclic), and the
 * obligation-to-owner coverage matrix (every obligation maps to ≥1 present
 * participant OR an explicit exclusion with rationale + user acceptance; an
 * unowned obligation INVALIDATES the proposal). Roster SIZE is never checked
 * and never a rejection reason.
 */
export function validateProposal(obj: unknown): ProposalVerdict {
  const reasons: string[] = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { valid: false, reasons: ["proposal must be a plain object"] };
  }
  const o = obj as Record<string, unknown>;

  for (const key of Object.keys(o)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      reasons.push(
        `unknown key "${key}" — guild.team_proposal.v2 is a closed schema (truncation/override keys are structurally rejected)`
      );
    }
  }
  if (o["schema_version"] !== TEAM_PROPOSAL_SCHEMA) {
    reasons.push(`schema_version must be ${TEAM_PROPOSAL_SCHEMA}`);
  }
  if (!isNonEmptyStr(o["run_id"])) reasons.push("run_id must be a non-empty string");
  if (!isNonEmptyStr(o["phase"])) reasons.push("phase must be a non-empty string");

  // §3 frozen fields are REQUIRED (rework F2) — absence is invalid, never skipped.
  const version = o["proposal_version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    reasons.push("proposal_version is required and must be a positive integer");
  }
  if (!("parent_proposal_hash" in o)) {
    reasons.push("parent_proposal_hash is required (null for version 1, the parent's sha256 for a restructure)");
  } else if (o["parent_proposal_hash"] === null) {
    if (typeof version === "number" && version > 1) {
      reasons.push("parent_proposal_hash must be the parent proposal's sha256 when proposal_version > 1 (restructure chain)");
    }
  } else if (!isSha256Hex(o["parent_proposal_hash"])) {
    reasons.push("parent_proposal_hash must be null or a sha256 hex string");
  } else if (version === 1) {
    reasons.push("parent_proposal_hash must be null for proposal_version 1 (no restructure parent exists)");
  }
  if (!isSha256Hex(o["proposal_hash"])) {
    reasons.push("proposal_hash is required and must be a sha256 hex string (§1 self-referential hash)");
  }
  if (o["proposal_hash_scope"] !== PROPOSAL_HASH_SCOPE) {
    reasons.push(`proposal_hash_scope is required and must be exactly "${PROPOSAL_HASH_SCOPE}"`);
  }
  if (o["proposal_hash_algorithm"] !== PROPOSAL_HASH_ALGORITHM) {
    reasons.push(`proposal_hash_algorithm is required and must be "${PROPOSAL_HASH_ALGORITHM}"`);
  }
  // spec_ref / plan_ref: optional in this build, but when present the §3 shape
  // ({path, sha256}) is enforced — a malformed ref never passes silently.
  for (const refKey of ["spec_ref", "plan_ref"] as const) {
    const ref = o[refKey];
    if (ref === undefined) continue;
    if (
      ref === null ||
      typeof ref !== "object" ||
      Array.isArray(ref) ||
      !isNonEmptyStr((ref as Record<string, unknown>)["path"]) ||
      !isSha256Hex((ref as Record<string, unknown>)["sha256"]) ||
      Object.keys(ref).some((k) => k !== "path" && k !== "sha256")
    ) {
      reasons.push(`${refKey} must be {path: non-empty string, sha256: sha256 hex} (closed shape)`);
    }
  }
  if (o["provenance"] !== undefined && !isNonEmptyStr(o["provenance"])) {
    reasons.push("provenance, when present, must be a non-empty string");
  }

  // participants
  const ids = new Set<string>();
  if (!Array.isArray(o["participants"])) {
    reasons.push("participants must be an array");
  } else {
    for (const [i, raw] of (o["participants"] as unknown[]).entries()) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        reasons.push(`participants[${i}] must be an object`);
        continue;
      }
      const p = raw as Record<string, unknown>;
      for (const key of Object.keys(p)) {
        if (!PARTICIPANT_KEYS.has(key)) {
          reasons.push(`participants[${i}] unknown key "${key}" (closed schema)`);
        }
      }
      if (!isNonEmptyStr(p["participant_id"])) {
        reasons.push(`participants[${i}].participant_id must be a non-empty string`);
      } else if (ids.has(p["participant_id"])) {
        reasons.push(`duplicate participant_id "${p["participant_id"]}"`);
      } else {
        ids.add(p["participant_id"]);
      }
      if (!PARTICIPATION_KINDS.includes(p["participation_kind"] as ParticipationKind)) {
        reasons.push(`participants[${i}].participation_kind must be one of ${PARTICIPATION_KINDS.join("|")}`);
      }
      if (!isNonEmptyStr(p["role_ref"])) {
        reasons.push(`participants[${i}].role_ref must be a non-empty string`);
      }
      if (!isNonEmptyStr(p["necessity_rationale"])) {
        reasons.push(`participants[${i}].necessity_rationale is required and must be non-empty`);
      }
      if (!isStrArray(p["owned_obligations"])) {
        reasons.push(`participants[${i}].owned_obligations must be a string array`);
      }
      if (!isStrArray(p["depends_on"])) {
        reasons.push(`participants[${i}].depends_on must be a string array`);
      }
      if (!PROPOSAL_TIERS.includes(p["tier"] as ProposalTier)) {
        reasons.push(`participants[${i}].tier must be one of ${PROPOSAL_TIERS.join("|")}`);
      }
      if (!PARTICIPANT_PURPOSES.includes(p["purpose"] as never)) {
        reasons.push(`participants[${i}].purpose must be a model_policy §2 purpose`);
      }
      if (!(p["capability_scope"] === null || isStrArray(p["capability_scope"]))) {
        reasons.push(`participants[${i}].capability_scope must be null or a string array`);
      }
      if (!isNonEmptyStr(p["backend"])) {
        reasons.push(`participants[${i}].backend must be a non-empty string`);
      }
    }
  }

  // depends_on: resolvable + acyclic (Kahn)
  if (Array.isArray(o["participants"]) && reasons.length === 0) {
    const participants = o["participants"] as ProposalParticipant[];
    for (const p of participants) {
      for (const dep of p.depends_on) {
        if (!ids.has(dep)) {
          reasons.push(`participant "${p.participant_id}" depends_on unresolvable id "${dep}"`);
        }
        if (dep === p.participant_id) {
          reasons.push(`participant "${p.participant_id}" depends on itself`);
        }
      }
    }
    if (reasons.length === 0) {
      const placed = new Set<string>();
      let progressed = true;
      while (progressed && placed.size < participants.length) {
        progressed = false;
        for (const p of participants) {
          if (placed.has(p.participant_id)) continue;
          if (p.depends_on.every((d) => placed.has(d))) {
            placed.add(p.participant_id);
            progressed = true;
          }
        }
      }
      if (placed.size < participants.length) {
        reasons.push("depends_on must form a DAG — a dependency cycle was detected");
      }
    }
  }

  // obligations + the coverage matrix
  if (!Array.isArray(o["obligations"])) {
    reasons.push("obligations must be an array");
  } else {
    const obligationIds = new Set<string>();
    for (const [i, raw] of (o["obligations"] as unknown[]).entries()) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        reasons.push(`obligations[${i}] must be an object`);
        continue;
      }
      const ob = raw as Record<string, unknown>;
      for (const key of Object.keys(ob)) {
        if (!OBLIGATION_KEYS.has(key)) {
          reasons.push(`obligations[${i}] unknown key "${key}" (closed schema)`);
        }
      }
      if (!isNonEmptyStr(ob["obligation_id"])) {
        reasons.push(`obligations[${i}].obligation_id must be a non-empty string`);
      } else if (obligationIds.has(ob["obligation_id"])) {
        reasons.push(`duplicate obligation_id "${ob["obligation_id"]}"`);
      } else {
        obligationIds.add(ob["obligation_id"]);
      }
      if (!OBLIGATION_SOURCES.includes(ob["source"] as never)) {
        reasons.push(`obligations[${i}].source must be one of ${OBLIGATION_SOURCES.join("|")}`);
      }
      if (!isNonEmptyStr(ob["text"])) {
        reasons.push(`obligations[${i}].text must be non-empty`);
      }
      const disp = ob["disposition"];
      if (disp === null || typeof disp !== "object" || Array.isArray(disp)) {
        reasons.push(`obligations[${i}].disposition must be an object`);
        continue;
      }
      const d = disp as Record<string, unknown>;
      const owners = d["owners"];
      const exclusion = d["exclusion"];
      if (owners !== undefined && !isStrArray(owners)) {
        reasons.push(`obligations[${i}].disposition.owners must be a string array`);
        continue;
      }
      const ownedByPresent =
        Array.isArray(owners) && owners.some((owner) => ids.has(owner as string));
      if (!ownedByPresent) {
        // No present owner ⇒ only an explicit, user-accepted exclusion saves it.
        if (exclusion === undefined) {
          reasons.push(
            `unowned obligation "${String(ob["obligation_id"])}" — every obligation maps to ≥1 present participant or an explicit exclusion; an unowned obligation invalidates the proposal`
          );
        } else if (
          exclusion === null ||
          typeof exclusion !== "object" ||
          !isNonEmptyStr((exclusion as Record<string, unknown>)["rationale"]) ||
          typeof (exclusion as Record<string, unknown>)["user_accepted"] !== "boolean"
        ) {
          reasons.push(
            `obligations[${i}].disposition.exclusion must carry a rationale and a user_accepted boolean`
          );
        } else if ((exclusion as Record<string, unknown>)["user_accepted"] !== true) {
          reasons.push(
            `obligation "${String(ob["obligation_id"])}" exclusion is not user-accepted — user acceptance is required`
          );
        }
      }
    }
  }

  // excluded_roles
  if (!Array.isArray(o["excluded_roles"])) {
    reasons.push("excluded_roles must be an array");
  } else {
    for (const [i, raw] of (o["excluded_roles"] as unknown[]).entries()) {
      if (
        raw === null ||
        typeof raw !== "object" ||
        !isNonEmptyStr((raw as Record<string, unknown>)["role_ref"]) ||
        !isNonEmptyStr((raw as Record<string, unknown>)["why_unnecessary"])
      ) {
        reasons.push(`excluded_roles[${i}] must carry role_ref and why_unnecessary`);
      }
    }
  }

  // backend_capacity_evidence (optional; scheduling-only — never a roster input)
  if (o["backend_capacity_evidence"] !== undefined) {
    const e = o["backend_capacity_evidence"];
    if (
      e === null ||
      typeof e !== "object" ||
      !isNonEmptyStr((e as Record<string, unknown>)["backend"]) ||
      typeof (e as Record<string, unknown>)["verified_capacity"] !== "number" ||
      !isNonEmptyStr((e as Record<string, unknown>)["method"]) ||
      !isNonEmptyStr((e as Record<string, unknown>)["as_of"])
    ) {
      reasons.push("backend_capacity_evidence must carry backend/verified_capacity/method/as_of");
    }
  }

  // proposed_schedule (optional, NON-BINDING preview — §5 owns the binding schedule)
  if (o["proposed_schedule"] !== undefined) {
    const s = o["proposed_schedule"];
    const waves = (s as Record<string, unknown> | null)?.["waves"];
    if (
      s === null ||
      typeof s !== "object" ||
      !Array.isArray(waves) ||
      !(waves as unknown[]).every((w) => isStrArray(w))
    ) {
      reasons.push("proposed_schedule.waves must be an array of participant-id arrays");
    }
  }

  // Embedded-hash integrity (ALWAYS verified for a structurally sound proposal
  // — the hash field is required above): the §1 recomputation with the hash
  // field omitted must equal the embedded value. Fail closed on mismatch.
  if (reasons.length === 0 && isSha256Hex(o["proposal_hash"])) {
    const recomputed = selfReferentialHash(o, "proposal_hash");
    if (recomputed !== o["proposal_hash"]) {
      reasons.push("proposal_hash mismatch — recomputed §1 hash differs from the embedded value");
    }
  }

  return { valid: reasons.length === 0, reasons };
}

// ── composeProposal ──────────────────────────────────────────────────────────

export interface ComposeProposalInput {
  run_id: string;
  phase: string;
  participants: ProposalParticipant[];
  obligations: ProposalObligation[];
  excluded_roles?: ExcludedRole[];
  spec_ref?: ArtifactRef;
  plan_ref?: ArtifactRef;
  backend_capacity_evidence?: BackendCapacityEvidence;
  proposal_version?: number;
  parent_proposal_hash?: string | null;
  provenance?: string;
}

/**
 * Compose a full, justified `guild.team_proposal.v2` (team-contracts §3).
 * UNCAPPED by construction: every supplied participant is kept — there is no
 * limiter, no default target, and no drop path. Derives a NON-BINDING
 * dependency-aware `proposed_schedule` preview (singleton-respecting Kahn
 * levels), stamps the §1 hash convention fields, computes `proposal_hash` with
 * the hash field omitted, validates fail-closed, and returns the immutable
 * artifact. Throws on an invalid composition — a proposal that cannot pass its
 * own validator must never be emitted.
 */
export function composeProposal(input: ComposeProposalInput): TeamProposalV2 {
  const proposal: TeamProposalV2 = {
    schema_version: TEAM_PROPOSAL_SCHEMA,
    run_id: input.run_id,
    phase: input.phase,
    proposal_version: input.proposal_version ?? 1,
    parent_proposal_hash: input.parent_proposal_hash ?? null,
    proposal_hash_algorithm: PROPOSAL_HASH_ALGORITHM,
    proposal_hash_scope: PROPOSAL_HASH_SCOPE,
    participants: cloneArtifact(input.participants),
    obligations: cloneArtifact(input.obligations),
    excluded_roles: cloneArtifact(input.excluded_roles ?? []),
    ...(input.spec_ref ? { spec_ref: cloneArtifact(input.spec_ref) } : {}),
    ...(input.plan_ref ? { plan_ref: cloneArtifact(input.plan_ref) } : {}),
    ...(input.backend_capacity_evidence
      ? { backend_capacity_evidence: cloneArtifact(input.backend_capacity_evidence) }
      : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  };
  proposal.proposed_schedule = { waves: dependencyWaves(proposal.participants) };
  proposal.proposal_hash = selfReferentialHash(
    proposal as unknown as Record<string, unknown>,
    "proposal_hash"
  );
  const verdict = validateProposal(proposal);
  if (!verdict.valid) {
    throw new Error(
      `composeProposal: refusing to emit an invalid guild.team_proposal.v2 — ${verdict.reasons.join("; ")}`
    );
  }
  return proposal;
}

/**
 * Dependency-aware wave partition (Kahn levels) used for the NON-BINDING §3
 * preview. Unbounded width — concurrency bounding is §5's job, not the
 * proposal's. Throws on a cycle (composeProposal validates the DAG anyway).
 */
export function dependencyWaves(
  participants: ReadonlyArray<Pick<ProposalParticipant, "participant_id" | "depends_on">>,
  maxWidth: number = Number.POSITIVE_INFINITY
): string[][] {
  const placed = new Set<string>();
  const waves: string[][] = [];
  const all = participants.map((p) => p.participant_id);
  while (placed.size < all.length) {
    const ready = participants
      .filter(
        (p) =>
          !placed.has(p.participant_id) && p.depends_on.every((d) => placed.has(d))
      )
      .map((p) => p.participant_id);
    if (ready.length === 0) {
      throw new Error("dependencyWaves: dependency cycle — depends_on must form a DAG");
    }
    const wave = Number.isFinite(maxWidth) ? ready.slice(0, maxWidth) : ready;
    wave.forEach((id) => placed.add(id));
    waves.push(wave);
  }
  return waves;
}

// ── Immutable persistence (team-contracts §1: artifacts are immutable) ────────

/**
 * Persist a proposal under `.guild/runs/<run-id>/team-plan/` as
 * `<phase>.proposal.v<version>.yaml` (canonical YAML bytes — the §1 audit trail
 * shows the exact bytes proposed). IMMUTABLE: an existing file at the path is
 * never overwritten — a changed proposal is a NEW version, never an edit.
 */
export function writeProposal(
  cwd: string,
  proposal: TeamProposalV2,
  opts: { guildDir?: string } = {}
): string {
  const verdict = validateProposal(proposal);
  if (!verdict.valid) {
    throw new Error(
      `writeProposal: refusing to persist an invalid proposal — ${verdict.reasons.join("; ")}`
    );
  }
  const version = proposal.proposal_version ?? 1;
  const filename = `${proposal.phase}.proposal.v${version}.yaml`;
  return writeRunArtifact(cwd, proposal.run_id, "team-plan", filename, canonicalYaml(proposal), {
    guildDir: opts.guildDir,
    immutable: true,
  });
}

/** SHA-256 over exact persisted file bytes (§1 external-reference rule). */
export function fileSha256(absPath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}
