/**
 * scripts/lib/cloud-task-packet.ts
 *
 * guild.cloud_task_packet.v1 — typed shape, builder, and validator.
 *
 * Contract (BY POINTER):
 *   docs/knowledge/team-and-routing/codex-openai-adapter.md §Codex-Cloud Redacted Task Packet
 *   docs/v2/dispatch-execution.html §2 (host routing flowchart, cloud_opt_in egress checkpoint)
 *
 * STATUS: [v2-contract-only] — DORMANT / INERT.
 * This module is NEVER a router default. It is reachable ONLY when:
 *   (1) the run has a human-approved per-run cloud_opt_in explicitly set to true, AND
 *   (2) the packet-egress always-ask hard-set checkpoint has been approved.
 * makeCloudTaskPacket() enforces this with a guard — it throws when either
 * condition is absent.
 *
 * Six data-minimization rules (bound by pointer to the adapter doc above):
 *   1. Ignored .guild/ artifacts are excluded (excluded_paths).
 *   2. Secret-looking content is hashed, never raw.
 *   3. Untrusted external content is quarantined (quarantined_inputs).
 *   4. No creator transcript or raw provider prompts.
 *   5. Per-run opt-in only — consent.cloud_opt_in MUST be explicitly true.
 *   6. Only redacted copies travel; originals stay on-box.
 *
 * Determinism contract: exported builder and validator functions NEVER call
 * Date.now(), Math.random(), or any I/O. The CALLER supplies packet_id,
 * approved_at, and any timestamps. A `if (require.main === module)` CLI block
 * at the bottom may use Date.now() for ad-hoc inspection only.
 *
 * Default-safe config reads: this module reads no settings key at runtime.
 * The cloud_opt_in gate is passed in by the caller (read from the run's
 * consent record). If settings.json ever adds a cloud_opt_in key, the caller
 * reads it and passes the resolved boolean here.
 *
 * Owned by tooling-engineer.
 */

// ── Schema version ─────────────────────────────────────────────────────────────

/** Canonical schema version string for this contract. */
export const CLOUD_TASK_PACKET_SCHEMA = "guild.cloud_task_packet.v1" as const;

// ── Closed enums (as const tuples so callers can iterate them) ────────────────

/** Closed set of allowed origin_host values. */
export const ORIGIN_HOSTS = ["claude-code", "codex-local"] as const;
export type OriginHost = (typeof ORIGIN_HOSTS)[number];

/** Closed set of allowed capability_requirements.isolation values. */
export const ISOLATION_KINDS = ["cloud_container", "worktree", "none"] as const;
export type IsolationKind = (typeof ISOLATION_KINDS)[number];

/** Closed set of expected_outputs values. */
export const EXPECTED_OUTPUT_KINDS = [
  "handoff_receipt",
  "pr_or_patch",
  "evidence",
] as const;
export type ExpectedOutputKind = (typeof EXPECTED_OUTPUT_KINDS)[number];

/** Closed set of return_contract.handoff_receipt values. */
export const HANDOFF_RECEIPT_MODES = ["canonical"] as const;
export type HandoffReceiptMode = (typeof HANDOFF_RECEIPT_MODES)[number];

/** Closed set of quarantined_input kinds. */
export const QUARANTINE_KINDS = ["web", "issue", "external_doc"] as const;
export type QuarantineKind = (typeof QUARANTINE_KINDS)[number];

// ── Nested shape types ────────────────────────────────────────────────────────

/**
 * Consent block. cloud_opt_in MUST be explicitly true; absent or false means
 * no packet is ever built.
 */
export interface ConsentBlock {
  /** MUST be explicitly true — human-approved per-run opt-in. */
  cloud_opt_in: true;
  /** Who approved the opt-in (always "user" in the v2-contract-only surface). */
  approved_by: "user";
  /** ISO-8601 UTC timestamp of approval — supplied by the caller. */
  approved_at: string;
}

/**
 * One allow-listed, redacted artifact copy included in the packet.
 * Originals never leave the box; only the *.redacted.md copies travel.
 */
export interface IncludedArtifact {
  /**
   * Path to the redacted copy (e.g. ".guild/spec/alpha.redacted.md").
   * Must end with ".redacted.md" or ".redacted.<ext>".
   */
  path: string;
  /** sha256 hex digest of the redacted copy — verified at egress. */
  sha256: string;
}

/**
 * Quarantined untrusted content record. Web/issue/external-doc bodies are
 * never inlined as instructions; they are summary-only and recorded here.
 */
export interface QuarantinedInput {
  kind: QuarantineKind;
  /** Path to the original under .guild/raw/sources/. */
  ref: string;
  /** sha256 hex digest of the original. */
  sha256: string;
  /** Handling note — always "summary-only, marked untrusted, NOT executed as instructions". */
  handling: "summary-only, marked untrusted, NOT executed as instructions";
}

/**
 * Capability requirements for the cloud task — mirrors task_run.host.capability_requirements.
 * Never re-spelled from task_run; this is a targeted subset for the cloud surface.
 */
export interface CloudCapabilityRequirements {
  needs_pr: boolean;
  isolation: IsolationKind;
}

/**
 * Return contract shape — declares what canonical artifacts the cloud task
 * must return.
 */
export interface ReturnContract {
  /** Always "canonical" — same handoff_receipt shape as local tasks. */
  handoff_receipt: HandoffReceiptMode;
  /** The host attribution written to the trace. */
  trace_host: "codex-cloud";
}

// ── Top-level packet shape ────────────────────────────────────────────────────

/**
 * guild.cloud_task_packet.v1 — the redacted, minimized off-box packet that
 * the codex-cloud adapter builds from a local task_run.yaml before transmitting
 * to Codex cloud.
 *
 * Contract: docs/knowledge/team-and-routing/codex-openai-adapter.md
 * Path on disk: .guild/runs/<run-id>/cloud-packets/<task-run-id>.yaml
 *
 * [v2-contract-only]: this shape is frozen and tested but the cloud adapter
 * build (the writer that calls makeCloudTaskPacket()) is unbuilt in v2.0.
 */
export interface CloudTaskPacket {
  /** Always "guild.cloud_task_packet.v1". */
  schema_version: typeof CLOUD_TASK_PACKET_SCHEMA;
  /**
   * Opaque packet id — "cpkt-<hash>" per the contract.
   * Supplied by the caller (no Date.now() here).
   */
  packet_id: string;
  /**
   * Ref to the local task_run that produced this packet.
   * NOT a copy of the task_run — only the id.
   */
  source_task_run_ref: string;
  /**
   * Opaque run id (provenance only — no structured content).
   * Cross-ref to the local run, never re-spelled.
   */
  run_id: string;
  /** Task id from the source task_run. */
  task_id: string;
  /** Which host originated the task_run that became this packet. */
  origin_host: OriginHost;
  /** Human-approved per-run consent record. */
  consent: ConsentBlock;
  /**
   * Plain task objective — must be sanitized through secret-hash +
   * untrusted-quarantine rules before landing here (caller responsibility;
   * this module validates structural shape only).
   */
  objective: string;
  /**
   * Allow-listed redacted artifact copies. Originals never travel.
   * Each path must be a redacted copy path.
   */
  included_artifacts: IncludedArtifact[];
  /**
   * Paths NEVER transmitted. The cloud-packets dir itself is always in
   * this list to prevent re-sync loops.
   */
  excluded_paths: string[];
  /**
   * Redaction policy declaration (verbatim from contract).
   * Value is fixed; callers must not vary it.
   */
  redaction_policy: "path-category-only for secrets; secret-looking content hashed; no raw provider prompts; no creator transcript";
  /**
   * Quarantined untrusted content. Empty array when no external inputs.
   */
  quarantined_inputs: QuarantinedInput[];
  /** What canonical outputs the cloud task must return. */
  expected_outputs: ExpectedOutputKind[];
  /** Cloud-specific capability requirements. */
  capability_requirements: CloudCapabilityRequirements;
  /** Budget (token/turn caps — mirrors task_run.budget). */
  budget: {
    max_turns: number;
    max_tokens: number;
  };
  /** Return contract: handoff_receipt shape + trace attribution. */
  return_contract: ReturnContract;
}

// ── Builder params ────────────────────────────────────────────────────────────

/**
 * Parameters for makeCloudTaskPacket().
 * The caller supplies all ids and timestamps — no Date.now() in the builder.
 */
export interface CloudTaskPacketParams {
  /**
   * Human-approved cloud opt-in consent.
   * The caller MUST pass this from the run's consent record; the builder
   * refuses to build a packet if cloud_opt_in is not true.
   */
  consent: ConsentBlock;
  /**
   * Boolean gate: has the packet-egress always-ask hard-set checkpoint been
   * explicitly approved for this egress attempt?
   * The caller reads this from the approval record and passes it in.
   * The builder refuses to build if false.
   */
  egressApproved: boolean;
  /** "cpkt-<hash>" — supplied by the caller. */
  packet_id: string;
  /** Ref to the local task_run (task_run_id, NOT a copy). */
  source_task_run_ref: string;
  /** Opaque run id. */
  run_id: string;
  /** Task id from the source task_run. */
  task_id: string;
  /** Originating host. */
  origin_host: OriginHost;
  /** Sanitized plain objective string. */
  objective: string;
  /** Allow-listed redacted artifact copies. */
  included_artifacts: IncludedArtifact[];
  /**
   * Additional paths to exclude beyond the canonical defaults.
   * The builder always prepends the canonical excluded_paths list.
   */
  extra_excluded_paths?: string[];
  /** Quarantined untrusted inputs (empty when none). */
  quarantined_inputs?: QuarantinedInput[];
  /** Expected output kinds. */
  expected_outputs?: ExpectedOutputKind[];
  /** Cloud capability requirements. */
  capability_requirements: CloudCapabilityRequirements;
  /** Budget. */
  budget: { max_turns: number; max_tokens: number };
}

// ── Canonical excluded paths (always included in every packet) ────────────────

/**
 * Canonical list of paths that MUST be in every cloud packet's excluded_paths.
 * Bound by the six data-minimization rules (adapter doc §Six data-minimization rules).
 * Exported so callers and tests can assert these are present.
 *
 * Note: glob patterns use "**" notation but never contain "star-slash-star"
 * in a way that would end a block comment (they use "**" only).
 */
export const CANONICAL_EXCLUDED_PATHS: readonly string[] = [
  ".guild/runs/*/logs/",
  ".guild/runs/*/events.ndjson",
  ".guild/.lock",
  ".guild/runs/*/cloud-packets/",
  ".env",
  "**/*secret*",
  "**/.git/**",
] as const;

// ── Cloud opt-in error ────────────────────────────────────────────────────────

/**
 * Thrown by makeCloudTaskPacket() when either the cloud_opt_in consent or the
 * packet-egress checkpoint approval is missing.
 *
 * This is the guard that keeps the cloud surface inert: it is impossible
 * to build a packet without explicit human approval on BOTH conditions.
 */
export class CloudOptInRequired extends Error {
  readonly reason: "missing_cloud_opt_in" | "egress_checkpoint_not_approved";
  constructor(reason: CloudOptInRequired["reason"]) {
    super(
      reason === "missing_cloud_opt_in"
        ? "guild.cloud_task_packet.v1: cloud_opt_in must be explicitly true (per-run human approval required)"
        : "guild.cloud_task_packet.v1: packet-egress always-ask checkpoint must be approved before building a cloud packet"
    );
    this.name = "CloudOptInRequired";
    this.reason = reason;
  }
}

// ── Builder ───────────────────────────────────────────────────────────────────

/**
 * makeCloudTaskPacket — pure builder for guild.cloud_task_packet.v1.
 *
 * CONTRACT:
 * - NEVER a router default. Reachable ONLY via the human-approved cloud_opt_in
 *   + packet-egress always-ask checkpoint.
 * - Throws CloudOptInRequired when either gate is absent.
 * - Deterministic: no Date.now(), no Math.random(), no I/O.
 *   All timestamps and ids are supplied by the caller.
 * - Merges CANONICAL_EXCLUDED_PATHS with any caller-supplied extra paths
 *   and deduplicates.
 *
 * @throws {CloudOptInRequired} when consent.cloud_opt_in !== true or
 *   egressApproved !== true.
 */
export function makeCloudTaskPacket(params: CloudTaskPacketParams): CloudTaskPacket {
  // ── Guard: always-ask egress gate ──────────────────────────────────────────
  // The packet-egress checkpoint fires first: it is the always-ask hard set
  // for a destructive/network-class (off-box) action. If it was not approved,
  // we must not build the packet at all — not even to inspect the consent.
  if (!params.egressApproved) {
    throw new CloudOptInRequired("egress_checkpoint_not_approved");
  }
  // ── Guard: per-run human-approved cloud opt-in ─────────────────────────────
  // consent.cloud_opt_in MUST be explicitly true (rule 5).
  if (!params.consent.cloud_opt_in) {
    throw new CloudOptInRequired("missing_cloud_opt_in");
  }

  // ── Excluded paths: canonical defaults + caller-supplied extras, deduped ───
  const extraPaths = params.extra_excluded_paths ?? [];
  const allExcluded = Array.from(
    new Set([...CANONICAL_EXCLUDED_PATHS, ...extraPaths])
  );

  return {
    schema_version: CLOUD_TASK_PACKET_SCHEMA,
    packet_id: params.packet_id,
    source_task_run_ref: params.source_task_run_ref,
    run_id: params.run_id,
    task_id: params.task_id,
    origin_host: params.origin_host,
    consent: params.consent,
    objective: params.objective,
    included_artifacts: params.included_artifacts,
    excluded_paths: allExcluded,
    redaction_policy:
      "path-category-only for secrets; secret-looking content hashed; no raw provider prompts; no creator transcript",
    quarantined_inputs: params.quarantined_inputs ?? [],
    expected_outputs: params.expected_outputs ?? [
      "handoff_receipt",
      "pr_or_patch",
      "evidence",
    ],
    capability_requirements: params.capability_requirements,
    budget: params.budget,
    return_contract: {
      handoff_receipt: "canonical",
      trace_host: "codex-cloud",
    },
  };
}

// ── Validator ─────────────────────────────────────────────────────────────────

const ORIGIN_HOST_SET = new Set<string>(ORIGIN_HOSTS);
const EXPECTED_OUTPUT_SET = new Set<string>(EXPECTED_OUTPUT_KINDS);
const QUARANTINE_KIND_SET = new Set<string>(QUARANTINE_KINDS);

/**
 * validateCloudTaskPacket — structural validator for guild.cloud_task_packet.v1.
 *
 * Returns `{ valid: true }` when the packet passes all structural checks, or
 * `{ valid: false, errors: string[] }` listing every violation.
 *
 * This validator covers the structural contract only. It does NOT verify:
 *   - that sha256 values are cryptographically correct
 *   - that redacted copies actually exist on disk
 *   - that the objective is free of secrets (that is build-time enforced)
 *
 * Callers may use this before writing the packet to disk, or in tests.
 */
export function validateCloudTaskPacket(
  packet: unknown
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!packet || typeof packet !== "object") {
    return { valid: false, errors: ["packet must be a non-null object"] };
  }

  const p = packet as Record<string, unknown>;

  // schema_version
  if (p["schema_version"] !== CLOUD_TASK_PACKET_SCHEMA) {
    errors.push(
      `schema_version must be "${CLOUD_TASK_PACKET_SCHEMA}", got ${JSON.stringify(p["schema_version"])}`
    );
  }

  // packet_id
  if (typeof p["packet_id"] !== "string" || p["packet_id"] === "") {
    errors.push("packet_id must be a non-empty string");
  }

  // source_task_run_ref
  if (
    typeof p["source_task_run_ref"] !== "string" ||
    p["source_task_run_ref"] === ""
  ) {
    errors.push("source_task_run_ref must be a non-empty string");
  }

  // run_id
  if (typeof p["run_id"] !== "string" || p["run_id"] === "") {
    errors.push("run_id must be a non-empty string");
  }

  // task_id
  if (typeof p["task_id"] !== "string" || p["task_id"] === "") {
    errors.push("task_id must be a non-empty string");
  }

  // origin_host
  if (
    typeof p["origin_host"] !== "string" ||
    !ORIGIN_HOST_SET.has(p["origin_host"])
  ) {
    errors.push(
      `origin_host must be one of [${ORIGIN_HOSTS.join(", ")}], got ${JSON.stringify(p["origin_host"])}`
    );
  }

  // consent block
  if (!p["consent"] || typeof p["consent"] !== "object") {
    errors.push("consent must be a non-null object");
  } else {
    const c = p["consent"] as Record<string, unknown>;
    if (c["cloud_opt_in"] !== true) {
      errors.push("consent.cloud_opt_in must be true");
    }
    if (c["approved_by"] !== "user") {
      errors.push(`consent.approved_by must be "user", got ${JSON.stringify(c["approved_by"])}`);
    }
    if (typeof c["approved_at"] !== "string" || c["approved_at"] === "") {
      errors.push("consent.approved_at must be a non-empty ISO-8601 string");
    }
  }

  // objective
  if (typeof p["objective"] !== "string" || p["objective"] === "") {
    errors.push("objective must be a non-empty string");
  }

  // included_artifacts
  if (!Array.isArray(p["included_artifacts"])) {
    errors.push("included_artifacts must be an array");
  } else {
    (p["included_artifacts"] as unknown[]).forEach((a, i) => {
      if (!a || typeof a !== "object") {
        errors.push(`included_artifacts[${i}] must be an object`);
        return;
      }
      const art = a as Record<string, unknown>;
      if (typeof art["path"] !== "string" || art["path"] === "") {
        errors.push(`included_artifacts[${i}].path must be a non-empty string`);
      }
      if (typeof art["sha256"] !== "string" || art["sha256"] === "") {
        errors.push(`included_artifacts[${i}].sha256 must be a non-empty string`);
      }
    });
  }

  // excluded_paths
  if (!Array.isArray(p["excluded_paths"])) {
    errors.push("excluded_paths must be an array");
  } else {
    // Rule 1 of the data-minimization rules: the cloud-packets dir itself must be excluded.
    const excl = p["excluded_paths"] as unknown[];
    const hasCloudPacketsExcluded = excl.some(
      (x) => typeof x === "string" && x.includes("cloud-packets")
    );
    if (!hasCloudPacketsExcluded) {
      errors.push(
        "excluded_paths must include a pattern excluding cloud-packets (rule 1: the packet dir itself must never be re-synced)"
      );
    }
  }

  // redaction_policy
  const REQUIRED_REDACTION_POLICY =
    "path-category-only for secrets; secret-looking content hashed; no raw provider prompts; no creator transcript";
  if (p["redaction_policy"] !== REQUIRED_REDACTION_POLICY) {
    errors.push(
      `redaction_policy must be the canonical value "${REQUIRED_REDACTION_POLICY}"`
    );
  }

  // quarantined_inputs
  if (!Array.isArray(p["quarantined_inputs"])) {
    errors.push("quarantined_inputs must be an array");
  } else {
    (p["quarantined_inputs"] as unknown[]).forEach((q, i) => {
      if (!q || typeof q !== "object") {
        errors.push(`quarantined_inputs[${i}] must be an object`);
        return;
      }
      const qi = q as Record<string, unknown>;
      if (
        typeof qi["kind"] !== "string" ||
        !QUARANTINE_KIND_SET.has(qi["kind"])
      ) {
        errors.push(
          `quarantined_inputs[${i}].kind must be one of [${QUARANTINE_KINDS.join(", ")}]`
        );
      }
      if (typeof qi["ref"] !== "string" || qi["ref"] === "") {
        errors.push(`quarantined_inputs[${i}].ref must be a non-empty string`);
      }
      if (typeof qi["sha256"] !== "string" || qi["sha256"] === "") {
        errors.push(`quarantined_inputs[${i}].sha256 must be a non-empty string`);
      }
    });
  }

  // expected_outputs
  if (!Array.isArray(p["expected_outputs"])) {
    errors.push("expected_outputs must be an array");
  } else {
    (p["expected_outputs"] as unknown[]).forEach((o, i) => {
      if (typeof o !== "string" || !EXPECTED_OUTPUT_SET.has(o)) {
        errors.push(
          `expected_outputs[${i}] must be one of [${EXPECTED_OUTPUT_KINDS.join(", ")}]`
        );
      }
    });
  }

  // capability_requirements
  if (
    !p["capability_requirements"] ||
    typeof p["capability_requirements"] !== "object"
  ) {
    errors.push("capability_requirements must be a non-null object");
  } else {
    const cr = p["capability_requirements"] as Record<string, unknown>;
    if (typeof cr["needs_pr"] !== "boolean") {
      errors.push("capability_requirements.needs_pr must be a boolean");
    }
    if (
      typeof cr["isolation"] !== "string" ||
      !new Set<string>(ISOLATION_KINDS).has(cr["isolation"])
    ) {
      errors.push(
        `capability_requirements.isolation must be one of [${ISOLATION_KINDS.join(", ")}]`
      );
    }
  }

  // budget
  if (!p["budget"] || typeof p["budget"] !== "object") {
    errors.push("budget must be a non-null object");
  } else {
    const b = p["budget"] as Record<string, unknown>;
    if (typeof b["max_turns"] !== "number" || b["max_turns"] < 1) {
      errors.push("budget.max_turns must be a positive integer");
    }
    if (typeof b["max_tokens"] !== "number" || b["max_tokens"] < 1) {
      errors.push("budget.max_tokens must be a positive integer");
    }
  }

  // return_contract
  if (!p["return_contract"] || typeof p["return_contract"] !== "object") {
    errors.push("return_contract must be a non-null object");
  } else {
    const rc = p["return_contract"] as Record<string, unknown>;
    if (rc["handoff_receipt"] !== "canonical") {
      errors.push(
        `return_contract.handoff_receipt must be "canonical", got ${JSON.stringify(rc["handoff_receipt"])}`
      );
    }
    if (rc["trace_host"] !== "codex-cloud") {
      errors.push(
        `return_contract.trace_host must be "codex-cloud", got ${JSON.stringify(rc["trace_host"])}`
      );
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * isValidCloudTaskPacket — type-predicate convenience wrapper.
 * Returns true when the packet passes validateCloudTaskPacket().
 */
export function isValidCloudTaskPacket(packet: unknown): packet is CloudTaskPacket {
  return validateCloudTaskPacket(packet).valid;
}

// ── Canonical path helper ─────────────────────────────────────────────────────

/**
 * cloudTaskPacketPath — returns the canonical disk path for a cloud task packet.
 *
 * Path: .guild/runs/<run-id>/cloud-packets/<task-run-id>.yaml
 * Bound by pointer: docs/v2/dispatch-execution.html §2 contract table.
 *
 * Pure path computation — no I/O.
 */
export function cloudTaskPacketPath(
  repoRoot: string,
  runId: string,
  taskRunId: string
): string {
  const path = require("path") as typeof import("path");
  return path.join(
    repoRoot,
    ".guild",
    "runs",
    runId,
    "cloud-packets",
    `${taskRunId}.yaml`
  );
}

// ── CLI harness (ad-hoc inspection only — never imported) ─────────────────────

if (require.main === module) {
  // Ad-hoc inspection: validate a packet file passed on stdin.
  // Uses Date.now() for the timestamp prefix — isolated to CLI-only block.
  const readline = require("readline") as typeof import("readline");
  const rl = readline.createInterface({ input: process.stdin });
  const lines: string[] = [];
  rl.on("line", (l: string) => lines.push(l));
  rl.on("close", () => {
    const raw = lines.join("\n");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      try {
        const yaml = require("js-yaml") as typeof import("js-yaml");
        parsed = yaml.load(raw);
      } catch {
        process.stderr.write("Failed to parse stdin as JSON or YAML\n");
        process.exit(1);
      }
    }
    const result = validateCloudTaskPacket(parsed);
    if (result.valid) {
      process.stdout.write(`[${new Date().toISOString()}] valid guild.cloud_task_packet.v1\n`);
      process.exit(0);
    } else {
      process.stderr.write(
        `[${new Date().toISOString()}] INVALID guild.cloud_task_packet.v1:\n` +
          (result as { valid: false; errors: string[] }).errors
            .map((e) => `  - ${e}`)
            .join("\n") +
          "\n"
      );
      process.exit(1);
    }
  });
}
