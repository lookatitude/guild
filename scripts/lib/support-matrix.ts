import { resolveRung, type DegradationReceipt } from "./adapter-fallback-ladders";
import {
  HOST_ADAPTER_OPERATIONS,
  type HostAdapterResult,
  type HostAdapterStatus,
} from "./host-adapter-contract";
import { createHostAdapter } from "./host-adapter-factory";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "./host-registry-schema";
import {
  REVIEW_PROGRESS_STATES,
  makeReviewProgressEvent,
  validateReviewProgressEvent,
  type ReviewProgressEvent,
} from "./review-progress";
import {
  DISPLAY_SUPPORT,
  HOST_EXPECTED_STATE,
  PUBLIC_STATES,
  VERIFICATION_STATUS,
  VERIFIED_PUBLIC_STATES,
  bucketForRow,
  deriveCurrentPublicState,
  deriveDisplaySupport,
  deriveVerificationStatus,
  hostSupportGate,
  renderDisplaySupport,
  selectValidReceipt,
  type DisplaySupport,
  type HostSmokeReceipt,
  type PublicState,
  type VerificationStatus,
} from "./host-public-state";

export const SUPPORT_MATRIX_SCHEMA = "guild.support_matrix.v1";

export const SUPPORT_STATES = [
  "verified",
  "degraded",
  "unavailable",
  "enqueue_only",
  "manual_instruction",
] as const;
export type SupportState = (typeof SUPPORT_STATES)[number];

export const FORBIDDEN_FINAL_STATES = [
  "contract-only",
  "target",
  "detect-only",
  "deferred",
] as const;

export const MATRIX_OPERATIONS = [
  "capability",
  "command_surface",
  "permission_decision",
  "preflight",
  "model_params",
  "memory",
  "dispatch",
  "hook_normalization",
  "review_progress",
  "install_or_app_refusal",
] as const;
export type MatrixOperation = (typeof MATRIX_OPERATIONS)[number];

export const LIFECYCLE_PHASES = [
  "idea",
  "research",
  "brainstorm",
  "spec",
  "plan",
  "build",
  "qa",
  "review",
  "ops",
] as const;
export type LifecyclePhase = (typeof LIFECYCLE_PHASES)[number];

export interface SupportCell {
  state: SupportState;
  status?: HostAdapterStatus;
  reason: string;
  evidence: string[];
  receipt?: unknown;
}

export interface HostSupportRow {
  host_id: HostId;
  family: string;
  surface_kind: "cli" | "app" | "file";
  installability: string;
  registry_provenance: string;
  final_state: SupportState;
  final_reason: string;
  // ── verified-multi-host-support §5 two-field honesty model (ADDITIVE) ──────────
  /** Aspirational public state echoed from the manifest (a GOAL, for display + the gate). */
  target_state: PublicState;
  /** The highest public state actually reached (committed manifest floor; null until first receipt). */
  achieved_floor: PublicState | null;
  /** Evidence-derived public state — the honesty column (verified_* iff a valid receipt). */
  current_public_state: PublicState;
  /**
   * PRESENTATION-ONLY roster label (operator policy 2026-07-04, amends R3 for display).
   * `supported` (verified) | `supported_beta` (honest installable target, receipt
   * pending) | `unsupported` (refuse / no path). Decoupled from the honesty column +
   * NEVER fed to the gate.
   */
  display_support: DisplaySupport;
  /** Internal diagnostics + fraud axis — NEVER public (R3). */
  verification_status: VerificationStatus;
  /** True iff a valid committed verified receipt promoted this row. */
  has_valid_receipt: boolean;
  /** The chosen receipt is past the 180d age horizon (annotated; still evidence). */
  receipt_stale?: boolean;
  /** Two non-stale boxes attest different public states → the gate FAILS. */
  receipt_conflict?: string | null;
  operations: Record<MatrixOperation, SupportCell>;
  lifecycle_smoke: {
    state: SupportState;
    phases: Record<LifecyclePhase, SupportCell>;
  };
}

export interface SupportMatrix {
  schema_version: typeof SUPPORT_MATRIX_SCHEMA;
  generated_at: string;
  source: "host-adapter-results-and-review-progress-schema";
  forbidden_final_states: readonly string[];
  host_ids: HostId[];
  rows: HostSupportRow[];
  review_progress_scenarios: ReviewProgressEvent[];
}

export interface MatrixValidationResult {
  valid: boolean;
  errors: string[];
}

function supportStateFromAdapter(result: HostAdapterResult): SupportState {
  const value = result.value;
  const supportState = value && typeof value === "object"
    ? (value as Record<string, unknown>)["support_state"]
    : undefined;
  if (supportState === "enqueue_only") return "enqueue_only";
  if (supportState === "manual_instruction") return "manual_instruction";
  if (supportState === "unavailable") return "unavailable";
  if (result.status === "ok") return "verified";
  if (result.status === "unavailable") return "unavailable";
  return "degraded";
}

function cellFromResult(result: HostAdapterResult, evidence: string[]): SupportCell {
  const state = supportStateFromAdapter(result);
  return {
    state,
    status: result.status,
    reason: result.receipt.reason,
    evidence,
    receipt: result.receipt,
  };
}

function receiptCell(
  state: SupportState,
  reason: string,
  evidence: string[],
  receipt: unknown,
): SupportCell {
  return { state, reason, evidence, receipt };
}

function reviewProgressScenarios(): ReviewProgressEvent[] {
  return REVIEW_PROGRESS_STATES.map((state, index) => makeReviewProgressEvent({
    runId: "run-r12-support-matrix",
    gate: "G-implementation:run-r12-support-matrix",
    roundNumber: 1,
    authorHost: "codex-app",
    reviewerHost: "claude-code-cli",
    independence: "strong",
    state,
    timestamp: "2026-06-18T00:00:00Z",
    sequence: index + 1,
    message: `review progress ${state}`,
    artifactPath: ".guild/runs/run-r12/evidence.md",
    packetPath: ".guild/runs/run-r12/review/packet-1.md",
    ...(state === "succeeded" ? { exitCode: 0 } : {}),
    ...(state === "reviewer_error" || state === "tool_error" ? { errorCode: state } : {}),
    ...(state === "skipped" ? { policyReason: "policy skip fixture" } : {}),
  }));
}

function finalStateFor(cells: SupportCell[]): SupportState {
  if (cells.every((cell) => cell.state === "verified")) return "verified";
  if (cells.some((cell) => cell.state === "enqueue_only")) return "enqueue_only";
  if (cells.some((cell) => cell.state === "manual_instruction")) return "manual_instruction";
  if (cells.every((cell) => cell.state === "unavailable")) return "unavailable";
  return "degraded";
}

function hookCell(host: HostId): SupportCell {
  const entry = HOST_REGISTRY_ROWS[host];
  const hookCaps = entry.capabilities.hooks;
  const hasNativeHook = Object.values(hookCaps).some((value) => value === true);
  if (hasNativeHook) {
    return receiptCell(
      "verified",
      "host has native hook capability in the registry row",
      ["HOST_REGISTRY_ROWS[host].capabilities.hooks"],
      { schema_version: "guild.hook_normalization_receipt.v1", host, native_hooks: true },
    );
  }
  return receiptCell(
    "degraded",
    "host has no native hooks; GuildHookEvent normalization uses forwarded/file-bus/preflight receipts",
    ["hooks/lib/guild-hook-event.ts", "adapter.preflight()"],
    resolveRung("session", host),
  );
}

function reviewCell(events: ReviewProgressEvent[]): SupportCell {
  const invalid = events.flatMap((event) => validateReviewProgressEvent(event).errors);
  return receiptCell(
    invalid.length === 0 ? "verified" : "unavailable",
    invalid.length === 0
      ? `all ${events.length} canonical review_progress.v1 states validate`
      : `invalid review progress events: ${invalid.join("; ")}`,
    ["scripts/lib/review-progress.ts"],
    {
      schema_version: "guild.review_progress_coverage.v1",
      states: events.map((event) => event.state),
      valid: invalid.length === 0,
      errors: invalid,
    },
  );
}

function lifecycleFor(host: HostId, baseCells: Record<MatrixOperation, SupportCell>): HostSupportRow["lifecycle_smoke"] {
  const phases = {} as Record<LifecyclePhase, SupportCell>;
  const dispatch = baseCells.dispatch;
  const memory = baseCells.memory;
  const review = baseCells.review_progress;
  const preflight = baseCells.preflight;
  for (const phase of LIFECYCLE_PHASES) {
    const inputs = phase === "review"
      ? [preflight, memory, dispatch, review]
      : [preflight, memory, dispatch];
    const state = finalStateFor(inputs);
    phases[phase] = receiptCell(
      state,
      state === "verified"
        ? `${phase} lifecycle smoke has verified preflight, memory, dispatch${phase === "review" ? ", and review progress" : ""}`
        : `${phase} lifecycle smoke uses explicit ${state} receipt(s), not a verified claim`,
      [`lifecycle:${phase}`, ...inputs.flatMap((cell) => cell.evidence)],
      {
        schema_version: "guild.lifecycle_smoke_receipt.v1",
        host,
        phase,
        component_states: inputs.map((cell) => cell.state),
      },
    );
  }
  return { state: finalStateFor(Object.values(phases)), phases };
}

/**
 * Generate the support matrix. PURE — the committed receipts are passed in
 * (`receiptsByHost`, loaded by `host-smoke-store.ts` in CI); the generator NEVER
 * re-runs smoke or reads the binary (ADR §6.5). `generatedAt` is the build-supplied
 * "now" used for receipt-age-only staleness (§6.3). With no receipts every target
 * host derives honest `unsupported` — a PASS unless a committed floor says otherwise.
 */
export function generateSupportMatrix(
  generatedAt = "2026-06-18T00:00:00Z",
  receiptsByHost: Record<string, HostSmokeReceipt[]> = {},
): SupportMatrix {
  const progressEvents = reviewProgressScenarios();
  const rows: HostSupportRow[] = [];
  for (const host of HOST_IDS) {
    const adapter = createHostAdapter(host);
    const entry = HOST_REGISTRY_ROWS[host];
    const capabilities = adapter.capabilities();
    const operations: Record<MatrixOperation, SupportCell> = {
      capability: receiptCell(
        capabilities.known ? "verified" : "unavailable",
        capabilities.known ? "registry and adapter capability row resolved" : "host is not known to the registry",
        ["adapter.capabilities()", "HOST_REGISTRY_ROWS"],
        capabilities,
      ),
      command_surface: cellFromResult(adapter.renderCommandSurface({ commandIds: ["guild", "status"] }), ["adapter.renderCommandSurface()"]),
      permission_decision: cellFromResult(adapter.renderPermissionDecision({ decision: { tool: "Bash", policy: "ask" } }), ["adapter.renderPermissionDecision()"]),
      preflight: cellFromResult(adapter.preflight({ cwd: "/tmp/guild-r12", runId: "run-r12", event: "SessionStart" }), ["adapter.preflight()"]),
      model_params: cellFromResult(adapter.resolveModelParams({
        tier: "powerful",
        params: { model: "r12-model", effort: "low", reasoning: "low", thinking: "low", verbosity: "low" },
      }), ["adapter.resolveModelParams()"]),
      memory: cellFromResult(adapter.memory({
        mode: "status",
        payload: {
          cwd: "/tmp/guild-r12",
          query: "r12 support matrix",
          capabilities: { filesystem: false, mcp: false, httpMcp: false, bridgePackage: false },
        },
      }), ["adapter.memory()", "scripts/lib/memory-adapter.ts"]),
      dispatch: cellFromResult(adapter.dispatch({
        taskRun: {
          schema_version: "guild.task_run.v1",
          id: `r12-${host}`,
          phases: LIFECYCLE_PHASES,
        },
      }), ["adapter.dispatch()"]),
      hook_normalization: hookCell(host),
      review_progress: reviewCell(progressEvents),
      install_or_app_refusal: cellFromResult(adapter.renderPackage({ packageRoot: "/tmp/guild-r12-package" }), ["adapter.renderPackage()", "plugin/install.sh"]),
    };
    const lifecycle_smoke = lifecycleFor(host, operations);
    const final_state = finalStateFor([
      ...Object.values(operations),
      receiptCell(lifecycle_smoke.state, "lifecycle smoke aggregate", ["lifecycle_smoke"], lifecycle_smoke),
    ]);

    // ── verified-multi-host-support §5 — derive the two-field honesty model from
    // the committed receipts (never re-run smoke). bucket + derivations are pure. ──
    const derivable = {
      host_id: host,
      surface_kind: entry.surface_kind,
      installability: entry.installability,
      registry_provenance: entry.provenance,
      final_state,
    };
    const bucket = bucketForRow(derivable);
    const selection = selectValidReceipt(host, bucket, receiptsByHost[host] ?? [], generatedAt);
    const verification_status = deriveVerificationStatus(derivable, bucket, selection.has_valid_receipt);
    const current_public_state = deriveCurrentPublicState(host, bucket, verification_status);
    const display_support = deriveDisplaySupport(current_public_state, verification_status);
    const expected = HOST_EXPECTED_STATE[host];

    rows.push({
      host_id: host,
      family: entry.family,
      surface_kind: entry.surface_kind,
      installability: entry.installability,
      registry_provenance: entry.provenance,
      final_state,
      final_reason: final_state === "verified"
        ? "all required cells and lifecycle phases are verified"
        : `host is ${final_state}; matrix contains executable receipts for the unsupported/degraded cells`,
      target_state: expected.target_state,
      achieved_floor: expected.achieved_floor,
      current_public_state,
      display_support,
      verification_status,
      has_valid_receipt: selection.has_valid_receipt,
      receipt_stale: selection.stale,
      receipt_conflict: selection.conflict,
      operations,
      lifecycle_smoke,
    });
  }
  return {
    schema_version: SUPPORT_MATRIX_SCHEMA,
    generated_at: generatedAt,
    source: "host-adapter-results-and-review-progress-schema",
    forbidden_final_states: FORBIDDEN_FINAL_STATES,
    host_ids: [...HOST_IDS],
    rows,
    review_progress_scenarios: progressEvents,
  };
}

export function validateSupportMatrix(matrix: SupportMatrix): MatrixValidationResult {
  const errors: string[] = [];
  if (matrix.schema_version !== SUPPORT_MATRIX_SCHEMA) errors.push(`schema_version must be ${SUPPORT_MATRIX_SCHEMA}`);
  const rowHosts = matrix.rows.map((row) => row.host_id);
  for (const host of HOST_IDS) {
    if (!rowHosts.includes(host)) errors.push(`missing host row ${host}`);
  }
  for (const row of matrix.rows) {
    if ((FORBIDDEN_FINAL_STATES as readonly string[]).includes(row.final_state)) {
      errors.push(`${row.host_id} uses forbidden final state ${row.final_state}`);
    }
    for (const op of MATRIX_OPERATIONS) {
      const cell = row.operations[op];
      if (!cell) {
        errors.push(`${row.host_id} missing operation ${op}`);
        continue;
      }
      if (!(SUPPORT_STATES as readonly string[]).includes(cell.state)) {
        errors.push(`${row.host_id}.${op} invalid state ${String(cell.state)}`);
      }
      if (cell.state !== "verified" && cell.receipt === undefined) {
        errors.push(`${row.host_id}.${op} is ${cell.state} without receipt`);
      }
    }
    for (const phase of LIFECYCLE_PHASES) {
      const cell = row.lifecycle_smoke.phases[phase];
      if (!cell) errors.push(`${row.host_id} missing lifecycle phase ${phase}`);
      else if (cell.state !== "verified" && cell.receipt === undefined) errors.push(`${row.host_id}.${phase} lifecycle has no receipt`);
    }
    // Two-field honesty model — the derived columns must be TOTAL + in-enum.
    if (!(PUBLIC_STATES as readonly string[]).includes(row.current_public_state)) {
      errors.push(`${row.host_id} invalid current_public_state ${String(row.current_public_state)}`);
    }
    if (!(PUBLIC_STATES as readonly string[]).includes(row.target_state)) {
      errors.push(`${row.host_id} invalid target_state ${String(row.target_state)}`);
    }
    if (!(DISPLAY_SUPPORT as readonly string[]).includes(row.display_support)) {
      errors.push(`${row.host_id} invalid display_support ${String(row.display_support)}`);
    }
    // Presentation invariant: a verified public state MUST read "supported" (not beta),
    // and a beta label MUST NOT sit on a verified public state (would hide a real receipt).
    if (row.display_support === "supported_beta" && (VERIFIED_PUBLIC_STATES as readonly string[]).includes(row.current_public_state)) {
      errors.push(`${row.host_id} display_support is supported_beta but current_public_state is verified ${row.current_public_state}`);
    }
    if (!(VERIFICATION_STATUS as readonly string[]).includes(row.verification_status)) {
      errors.push(`${row.host_id} invalid verification_status ${String(row.verification_status)}`);
    }
    if (!(row.achieved_floor === null || (PUBLIC_STATES as readonly string[]).includes(row.achieved_floor))) {
      errors.push(`${row.host_id} invalid achieved_floor ${String(row.achieved_floor)}`);
    }
  }
  for (const event of matrix.review_progress_scenarios) {
    const validation = validateReviewProgressEvent(event);
    if (!validation.valid) errors.push(...validation.errors.map((e) => `review_progress: ${e}`));
  }
  // The AC-RUN-3 two-field host-support gate (ADR §5.3) — anti-fraud + regression +
  // floor-coupling + conflict. Reads committed receipts (already stamped on the rows);
  // does NOT fail an honest target host still `unsupported`.
  const gate = hostSupportGate(matrix.rows);
  if (!gate.valid) errors.push(...gate.errors.map((e) => `host-support-gate: ${e}`));
  return { valid: errors.length === 0, errors };
}

export function renderSupportMatrixMarkdown(matrix: SupportMatrix): string {
  const lines = [
    "# Generated Host Support Matrix",
    "",
    `Generated: ${matrix.generated_at}`,
    "",
    "This file is generated from host-adapter outputs and review-progress schema validation. Do not hand-edit support cells.",
    "",
    "**Support** is the human-facing roster label: `Supported` (a committed verified receipt), `Supported (beta)` (an honest installable target — full adapter chain, operator-box receipt pending), or `Unsupported` (a refuse app/connector surface). It is a PRESENTATION derivation only, decoupled from the honesty column and never an input to the gate.",
    "**Public State** is the evidence-derived honesty column (native / verified_wrapped / verified_bridged / unsupported) — verified_* ONLY when a valid receipt exists.",
    "**Target** is aspirational; **Verification** + **Floor** are DOCS-internal diagnostics (never a public claim).",
    "",
    "| Host | Support | Surface | Installability | Public State | Target | Verification | Floor | Final State |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const row of matrix.rows) {
    const stale = row.receipt_stale ? " (stale)" : "";
    lines.push(
      `| ${row.host_id} | ${renderDisplaySupport(row.display_support)} | ${row.surface_kind} | ${row.installability} | ${row.current_public_state} | ${row.target_state} | ${row.verification_status}${stale} | ${row.achieved_floor ?? "—"} | ${row.final_state} |`,
    );
  }
  lines.push("", "## Coverage Operations", "");
  for (const row of matrix.rows) {
    lines.push(`### ${row.host_id}`, "");
    for (const op of MATRIX_OPERATIONS) {
      const cell = row.operations[op];
      lines.push(`- ${op}: ${cell.state} - ${cell.reason}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
