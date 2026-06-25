/**
 * scripts/lib/guild-run-wrapper.ts
 *
 * L3 — the PURE planning core of the `guild-run <host>` wrapper (SC-5). Given a
 * WrapperRequest it resolves, from the host's `guild.host_capabilities.v1` row:
 *   - the launch-mode argv (permission mode → flags), DEGRADING and RECORDING the
 *     loss when the host cannot express the requested mode (AC20: never silently
 *     claim a mode, never escalate to a HIGHER-autonomy mode the host happens to
 *     have);
 *   - the bootstrap-context injection method (Claude: system-prompt arg; Codex:
 *     instruction file) per caps.bootstrap.context_injection;
 *   - the structured-output instruction (request a fenced contract block);
 *   - the full argv + env + the capture intentions (session id / stdout / stderr
 *     / exit / receipt paths).
 *
 * Contract authority (consumed, never redefined):
 *   scripts/lib/host-capabilities-schema.ts — HOST_CAPABILITY_ROWS + PermissionMode
 *   docs/knowledge/decisions/guild-inventory-and-parity-contracts.md (L0 ADR)
 *
 * PURITY: no I/O, no spawn, no clock. The spawn + capture + repair loop live in
 * scripts/guild-run.ts; this module is fully unit-testable (L6 SC-5).
 *
 * CODEX ARGV CAVEAT (L0 followup): Codex launch flags + the `exec` invocation
 * shape are INFERRED off-box. They are confirmed on the live Codex host
 * (192.168.10.21) at SC-3; until then treat the codex plan as provisional.
 *
 * Owned by tooling-engineer (L3); consumes L0; feeds L6.
 */

import {
  HOST_CAPABILITY_ROWS,
  type GuildHostCapabilitiesV1,
  type PermissionMode,
} from "./host-capabilities-schema";
// W4 D1: registry-bridge predicates replace `=== "claude"` / `=== "codex"` literals.
// host here is a HostKind-compatible string ("claude" | "codex" | …).
import { isAntigravityCli, isClaudeCli, isCodexCli, isPiCli } from "./capability/rank";
import type { HostKind } from "./host-types";

// ---------------------------------------------------------------------------
// Request / plan types
// ---------------------------------------------------------------------------

export interface WrapperRequest {
  /** Host id: "claude" | "codex". */
  host: string;
  /** Requested Guild permission mode. */
  mode: PermissionMode;
  /** Working directory the host runs in. */
  cwd: string;
  /** Writable roots to advertise to the host/sandbox (recorded; host-dependent). */
  writableRoots?: string[];
  /** Bootstrap context text to inject (the using-guild bootstrap). */
  bootstrap?: string;
  /** The user/task prompt. */
  prompt?: string;
  /** Request a structured result of this wire schema_version (fenced block). */
  structuredOutput?: { wire_schema_version: string };
  /** Resume a prior session by id. */
  resume?: { sessionId: string };
  /** R5 host-native model params requested for this run. */
  modelParams?: WrapperModelParams;
}

export interface WrapperModelParams {
  model?: string;
  effort?: string;
  reasoning?: string;
  thinking?: string;
  verbosity?: string;
  [key: string]: string | undefined;
}

export interface LaunchModeResolution {
  requested: PermissionMode;
  /**
   * The mode whose flags were applied. AUTHORITATIVE ONLY WHEN `host_default` is
   * falsy: the `PermissionMode` union has no "host-default" member, so when
   * `host_default === true` NO mode was applied and this field is NOT meaningful
   * (it echoes `requested` purely as a placeholder) — consumers MUST branch on
   * `host_default` first and treat the host's intrinsic default as authoritative.
   * `args.length === 0 && host_default` is the unambiguous machine signal.
   */
  effective: PermissionMode;
  /** The argv flags appended for the effective mode ([] when host_default). */
  args: string[];
  /** True when the host could not express the requested mode. */
  degraded: boolean;
  /**
   * True when NO recipe at-or-below the requested mode existed and the wrapper
   * fell back to the host's OWN default (no autonomy flags). When set, `effective`
   * is a non-authoritative placeholder — read THIS flag, not `effective`.
   */
  host_default?: boolean;
  /** AC20 record of the loss (present iff degraded). */
  reason?: string;
}

export interface BootstrapInjection {
  /** caps.bootstrap.context_injection verbatim (the advertised method). */
  method: string;
  /** How the wrapper concretely injects it. */
  via: "system_prompt_arg" | "instruction_file" | "none";
  /** Extra argv contributed by injection (e.g. ["--append-system-prompt", text]). */
  args: string[];
  /** Instruction files the wrapper must write before launch. */
  files: Array<{ path: string; content: string }>;
}

export interface WrapperPlan {
  host: string;
  /** Host CLI binary to spawn. */
  command: string;
  /** Full argv. */
  args: string[];
  /** Environment overlay. */
  env: Record<string, string>;
  cwd: string;
  /** The final assembled prompt text (bootstrap-prefixed + structured-output suffixed). */
  prompt: string;
  launch: LaunchModeResolution;
  bootstrap: BootstrapInjection;
  /** R5 model params mapped to host-native argv where supported. */
  model_params: {
    requested: WrapperModelParams | null;
    args: string[];
    unsupported_model_params: string[];
    degraded: boolean;
  };
  /** The structured-output instruction appended to the prompt (if requested). */
  structured_output_instruction?: string;
  /** What the wrapper captures from the run. */
  capture: {
    session_id: boolean;
    stdout: boolean;
    stderr: boolean;
    exit: boolean;
    receipt_paths: boolean;
  };
}

// ---------------------------------------------------------------------------
// Launch-mode resolution (degrade-and-record; never escalate)
// ---------------------------------------------------------------------------

/** Permission modes in ascending autonomy. Index ordering drives degradation. */
export const AUTONOMY_ORDER: PermissionMode[] = [
  "read_only",
  "ask",
  "accept_edits",
  "auto",
  "bypass_all",
];

/**
 * Resolve launch flags for `requested` from caps.permissions.launch_modes.
 *   - present → use it (no degradation).
 *   - absent  → degrade to the HIGHEST-autonomy mode that is ≤ requested (closest
 *               safe fallback). If none exists, run with NO autonomy flags (host
 *               default) — NEVER pick a higher-autonomy mode the host happens to
 *               advertise. Always records the loss (AC20).
 */
export function resolveLaunchMode(
  caps: GuildHostCapabilitiesV1,
  requested: PermissionMode
): LaunchModeResolution {
  const lm = caps.permissions.launch_modes ?? {};
  const direct = lm[requested];
  if (direct) {
    return { requested, effective: requested, args: [...direct], degraded: false };
  }

  const reqIdx = AUTONOMY_ORDER.indexOf(requested);
  let best: PermissionMode | null = null;
  for (const mode of Object.keys(lm) as PermissionMode[]) {
    const idx = AUTONOMY_ORDER.indexOf(mode);
    if (idx >= 0 && idx <= reqIdx) {
      if (best === null || idx > AUTONOMY_ORDER.indexOf(best)) best = mode;
    }
  }

  if (best) {
    return {
      requested,
      effective: best,
      args: [...(lm[best] as string[])],
      degraded: true,
      reason:
        `host "${caps.host_kind}" has no launch recipe for "${requested}"; ` +
        `degraded to the closest lower-autonomy mode "${best}" (minimum-loss).`,
    };
  }

  return {
    requested,
    effective: requested,
    args: [],
    degraded: true,
    host_default: true,
    reason:
      `host "${caps.host_kind}" advertises no launch recipe at or below "${requested}"; ` +
      `running with the host's OWN default (no autonomy flags, effective mode is nominal) — ` +
      `will NOT escalate to a higher mode.`,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap injection
// ---------------------------------------------------------------------------

/** Where the wrapper writes a host instruction file, relative to cwd. */
export const INSTRUCTION_FILENAMES: Record<string, string> = {
  codex: "AGENTS.md",
  pi: "AGENTS.md",
  antigravity: "AGENTS.md",
  "antigravity-2": "AGENTS.md",
};

/**
 * Plan bootstrap-context injection from caps.bootstrap.context_injection.
 *   - "hookSpecificOutput.additionalContext" (Claude) → --append-system-prompt arg.
 *   - "instruction_file" (Codex) → write the host instruction file (AGENTS.md).
 *   - anything else / no bootstrap → via:"none".
 */
export function planBootstrapInjection(
  caps: GuildHostCapabilitiesV1,
  request: WrapperRequest
): BootstrapInjection {
  const method = caps.bootstrap.context_injection;
  if (!request.bootstrap || request.bootstrap.trim() === "") {
    return { method, via: "none", args: [], files: [] };
  }

  if (method === "hookSpecificOutput.additionalContext") {
    // One-shot wrapper: additionalContext is a hook channel; the equivalent for a
    // CLI launch is the appended system prompt.
    return {
      method,
      via: "system_prompt_arg",
      args: ["--append-system-prompt", request.bootstrap],
      files: [],
    };
  }

  if (method === "instruction_file") {
    const fname = INSTRUCTION_FILENAMES[caps.host_kind] ?? "AGENTS.md";
    return {
      method,
      via: "instruction_file",
      args: [],
      files: [{ path: fname, content: request.bootstrap }],
    };
  }

  // Unknown injection method → record but inject nothing (fail-safe).
  return { method, via: "none", args: [], files: [] };
}

// ---------------------------------------------------------------------------
// Structured-output instruction
// ---------------------------------------------------------------------------

export function structuredOutputInstruction(wire: string): string {
  return [
    ``,
    `When you finish, emit your result as a SINGLE fenced code block and nothing after it:`,
    "```" + wire,
    `{ ... a valid ${wire} object ... }`,
    "```",
    `The block MUST validate against the ${wire} contract. Do not add prose after it.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Full invocation plan
// ---------------------------------------------------------------------------

/** Host CLI binary per host id. */
export const HOST_BINARY: Record<string, string> = {
  claude: "claude",
  codex: "codex",
  pi: "pi",
  antigravity: "agy",
  "antigravity-2": "agy",
};

export function planModelParamArgs(host: string, params?: WrapperModelParams): WrapperPlan["model_params"] {
  if (!params || Object.keys(params).length === 0) {
    return { requested: null, args: [], unsupported_model_params: [], degraded: false };
  }
  const requested = { ...params };
  // W4 D1: registry bridge — exact isClaudeCli/isCodexCli replace `=== "claude"` / `=== "codex"` literals.
  // `host` carries a HostKind-compatible string; behavior-neutral for all existing values.
  if (isClaudeCli(host as HostKind)) {
    const unsupported = Object.keys(requested).filter((key) => !["model", "effort"].includes(key));
    const args = [
      ...(requested.model ? ["--model", requested.model] : []),
      ...(requested.effort ? ["--effort", requested.effort] : []),
    ];
    return { requested, args, unsupported_model_params: unsupported, degraded: unsupported.length > 0 };
  }
  if (isCodexCli(host as HostKind)) {
    const unsupported = Object.keys(requested).filter((key) => !["model", "effort", "reasoning"].includes(key));
    const reasoningEffort = requested.reasoning ?? requested.effort;
    const args = [
      ...(requested.model ? ["--model", requested.model] : []),
      ...(reasoningEffort ? ["-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`] : []),
    ];
    return { requested, args, unsupported_model_params: unsupported, degraded: unsupported.length > 0 };
  }
  return {
    requested,
    args: [],
    unsupported_model_params: Object.keys(requested),
    degraded: true,
  };
}

/**
 * Build the complete, pure invocation plan for a host run. Throws (explicit) for
 * a host with no capability row — we never guess a host's launch shape.
 */
export function planWrapperInvocation(
  request: WrapperRequest,
  capsOverride?: GuildHostCapabilitiesV1
): WrapperPlan {
  const caps = capsOverride ?? HOST_CAPABILITY_ROWS[request.host];
  if (!caps) {
    throw new Error(
      `guild-run: no guild.host_capabilities.v1 row for host "${request.host}" ` +
        `(known: ${Object.keys(HOST_CAPABILITY_ROWS).join(", ")})`
    );
  }

  const launch = resolveLaunchMode(caps, request.mode);
  const bootstrap = planBootstrapInjection(caps, request);
  const modelParams = planModelParamArgs(request.host, request.modelParams);

  const soInstruction = request.structuredOutput
    ? structuredOutputInstruction(request.structuredOutput.wire_schema_version)
    : undefined;

  const promptParts: string[] = [];
  if (request.prompt) promptParts.push(request.prompt);
  if (soInstruction) promptParts.push(soInstruction);
  const prompt = promptParts.join("\n");

  const binary = HOST_BINARY[request.host] ?? request.host;

  // Argv assembly. Claude: non-interactive print mode (`-p`). Codex: `exec`
  // subcommand (INFERRED — confirm on-box at SC-3).
  // W4 D1: registry bridge — exact isClaudeCli/isCodexCli replace `=== "claude"` / `=== "codex"`.
  const args: string[] = [];
  if (isCodexCli(request.host as HostKind)) args.push("exec");
  args.push(...launch.args, ...modelParams.args, ...bootstrap.args);
  if (request.resume) {
    // Claude resumes by id with --resume; codex resume shape is INFERRED.
    args.push("--resume", request.resume.sessionId);
  }
  if (isClaudeCli(request.host as HostKind)) {
    args.push("-p", prompt);
  } else if (isPiCli(request.host as HostKind) || isAntigravityCli(request.host as HostKind)) {
    args.push("-p", prompt);
  } else {
    args.push(prompt);
  }

  const env: Record<string, string> = {};
  if (request.writableRoots && request.writableRoots.length > 0) {
    // Advertised for the wrapper/sandbox layer; host-dependent enforcement.
    env["GUILD_WRITABLE_ROOTS"] = request.writableRoots.join(":");
  }

  const plan: WrapperPlan = {
    host: request.host,
    command: binary,
    args,
    env,
    cwd: request.cwd,
    prompt,
    launch,
    bootstrap,
    model_params: modelParams,
    capture: {
      session_id: caps.sessions.resume_by_id,
      stdout: true,
      stderr: true,
      exit: true,
      receipt_paths: true,
    },
  };
  if (soInstruction) plan.structured_output_instruction = soInstruction;
  return plan;
}

// ---------------------------------------------------------------------------
// Launcher-script rendering (the generated `guild-run` entrypoint per host)
// ---------------------------------------------------------------------------

/**
 * Render a thin POSIX launcher that pins the host and forwards args to the
 * guild-run CLI. This is the per-host "wrapper path" artifact (SC-5) emitted into
 * each dist tree's bin/. The launcher itself does no logic — the CLI does.
 *
 * Self-containment: the CLI is resolved relative to THIS package's own bundled
 * scripts/ (build:hosts copies scripts/ into every host tree), so the launcher
 * works from a standalone install. `GUILD_RUN_CLI` overrides it; if neither
 * resolves to a real file, the launcher fails LOUDLY (never silently calls the
 * wrong path).
 */
export function renderLauncherScript(host: string): string {
  return [
    "#!/usr/bin/env bash",
    "# Generated by guild-run-wrapper.ts (L3). Do not edit — regenerate via build:hosts.",
    `# guild-run wrapper for host: ${host}`,
    "set -euo pipefail",
    "# Resolve through symlinks (npm-style bin symlinks point at this file) so",
    "# SCRIPT_DIR is the REAL package bin/, not the symlink's location.",
    'SOURCE="${BASH_SOURCE[0]}"',
    "_hops=0",
    'while [ -h "$SOURCE" ]; do',
    "  _hops=$((_hops+1))",
    '  if [ "$_hops" -gt 40 ]; then echo "guild-run: symlink resolution exceeded 40 hops (cycle?)" >&2; exit 1; fi',
    '  DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"',
    '  SOURCE="$(readlink "$SOURCE")"',
    '  case "$SOURCE" in /*) ;; *) SOURCE="$DIR/$SOURCE" ;; esac',
    "done",
    'SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"',
    "# The CLI is bundled in this package at <pkg>/scripts/guild-run.ts (bin/ is a sibling of scripts/).",
    'CANDIDATE="$SCRIPT_DIR/../scripts/guild-run.ts"',
    'GUILD_RUN="${GUILD_RUN_CLI:-$CANDIDATE}"',
    'if [ ! -f "$GUILD_RUN" ]; then',
    '  echo "guild-run: cannot locate guild-run.ts (looked at: $CANDIDATE). Set GUILD_RUN_CLI." >&2',
    "  exit 1",
    "fi",
    `exec npx tsx "$GUILD_RUN" --host ${host} "$@"`,
    "",
  ].join("\n");
}
