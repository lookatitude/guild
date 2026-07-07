/**
 * scripts/lib/pane-adapter.ts
 *
 * CH-2 — provider-neutral PaneAdapter implementations for mixed-host tmux teams.
 *
 * Contract (BY POINTER): docs/knowledge/decisions/v2-cross-host-orchestration.md
 *   §CH-2 (PaneAdapter interface + ClaudePaneAdapter / CodexPaneAdapter),
 *   §CH-6 (fail-fast preflight). The `PaneAdapter` / `PaneSpec` / `PreflightResult`
 *   TYPES are defined in ./team-backend.ts (the lowest-level lib) so the backend
 *   can type against them without importing this file — this module imports the
 *   types + the shared pane primitives one-directionally (no cycle).
 *
 * Ships two adapters, registered in an `ADAPTERS` map keyed by `host_kind`:
 *   - ClaudePaneAdapter — emits the SAME command as the legacy `paneCommand`
 *     (byte-identical to the shipped launcher); injects the agent-team env gate
 *     + GUILD_RUN_ID; preflight `claude --version`.
 *   - CodexPaneAdapter — emits `codex exec '<prompt>'`; injects GUILD_RUN_ID only
 *     (NO Claude team env gate); preflight `codex --version` AND usable auth,
 *     where usable auth = a non-empty auth.json at CODEX_HOME/auth.json OR a
 *     non-empty OPENAI_API_KEY (refuses to spawn if both are absent — CH-6).
 *
 * Adding a future host is one new adapter file + one ADAPTERS row —
 * no launcher-core change (CH-2 extension point).
 *
 * Invariant: never writes anything. Adapters are pure command/env builders plus
 * a read-only preflight probe (injectable for tests).
 */

import {
  paneCommand,
  shellQuote,
  type AdapterResolver,
  type HostKind,
  type PaneAdapter,
  type PaneSpec,
  type PreflightResult,
  type RunFn,
} from "./team-backend";
import { spawnSync } from "child_process";
import * as nodefs from "fs";
import * as nodepath from "path";
import * as os from "os";

const ADAPTER_VERSION = "1";

// ── Injectable probe runner (test seam) ──────────────────────────────────────
//
// Mirrors team-backend's RunFn so adapters can be tested without spawning real
// `claude` / `codex` binaries. Defaults to a real spawnSync version probe.

const defaultRun: RunFn = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts } as never);
  return {
    status: r.status,
    stdout: (r.stdout as string | null) ?? "",
    stderr: (r.stderr as string | null) ?? "",
  };
};

/** Minimal fs seam — only the two operations used by CodexPaneAdapter.preflight(). */
export interface FsSeam {
  existsSync(path: string): boolean;
  statSync(path: string): { size: number };
}

export interface AdapterOpts {
  /** Test seam: override the version-probe runner. */
  run?: RunFn;
  /** Test seam: override env lookups (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Test seam: override filesystem operations (defaults to node:fs). */
  fs?: FsSeam;
}

// ── ClaudePaneAdapter ─────────────────────────────────────────────────────────

/**
 * guild.task_assignment.v1 — the run-relative path to a pane's own assignment file.
 * Shared by every non-Claude adapter so the cross-host channel reaches Codex /
 * Antigravity / Pi panes too (the Claude adapter gets it via `paneCommand`). docs/v2 §08.
 */
function taskAssignmentPathFor(spec: PaneSpec): string {
  return `.guild/runs/${spec.runId}/tasks/${spec.specialist}.json`;
}
/** `export GUILD_TASK_ASSIGNMENT=…; ` fragment, or "" when no specialist is set. */
function taskAssignmentExport(spec: PaneSpec): string {
  return spec.specialist
    ? `export GUILD_TASK_ASSIGNMENT=${shellQuote(taskAssignmentPathFor(spec))}; `
    : "";
}
/** The `GUILD_TASK_ASSIGNMENT` entry for an adapter's env map, or {} when no specialist. */
function taskAssignmentEnv(spec: PaneSpec): Record<string, string> {
  return spec.specialist ? { GUILD_TASK_ASSIGNMENT: taskAssignmentPathFor(spec) } : {};
}

/**
 * Claude Code pane. `command()` delegates to the shared `paneCommand`, so a
 * Claude-only team built through the adapter path is byte-identical to the
 * legacy inline path (the launcher regression anchor).
 */
export class ClaudePaneAdapter implements PaneAdapter {
  readonly hostKind = "claude" as const;
  readonly adapterVersion = ADAPTER_VERSION;
  private run: RunFn;

  constructor(opts: AdapterOpts = {}) {
    this.run = opts.run ?? defaultRun;
  }

  preflight(): PreflightResult {
    const r = this.run("claude", ["--version"]);
    if (r.status !== 0) {
      return {
        ok: false,
        message:
          "`claude` binary not found or not runnable (claude --version failed). " +
          "Install Claude Code and ensure it is on PATH.",
      };
    }
    return { ok: true, message: "claude --version ok" };
  }

  command(spec: PaneSpec): string {
    // D-CAP: pass taskId + capability_scope so paneCommand injects GUILD_TASK_ID
    // (scope-file locator) and optionally GUILD_CAPABILITY_SCOPE (env fast-path).
    // G-9 / C2-D1: pass specialist so lane panes export GUILD_SPECIALIST
    // (the PostToolUse heartbeat writer's trigger).
    return paneCommand(
      spec.prompt,
      spec.runId,
      spec.capability_scope,
      spec.taskId,
      spec.specialist,
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: spec.runId,
      // G-9 / C2-D1: GUILD_SPECIALIST arms the PostToolUse heartbeat writer.
      ...(spec.specialist ? { GUILD_SPECIALIST: spec.specialist } : {}),
      // D-CAP: GUILD_TASK_ID locates the scope file; GUILD_CAPABILITY_SCOPE is the fast-path.
      ...(spec.taskId ? { GUILD_TASK_ID: spec.taskId } : {}),
      ...(spec.capability_scope !== undefined
        ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) }
        : {}),
    };
  }

  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["heartbeat", "handoff_receipt", "approval_request"];
  }
}

// ── CodexPaneAdapter ──────────────────────────────────────────────────────────

/**
 * Codex CLI pane. Emits `codex exec '<prompt>'`. Does NOT inject the Claude
 * agent-team env gate (Codex panes cannot join Claude Code's event bus — CH-3).
 * Exports GUILD_RUN_ID so hooks/telemetry converge on the shared run path.
 * Preflight requires `codex --version` AND usable auth (CH-6):
 *   (a) a non-empty auth.json at ${CODEX_HOME:-$HOME/.codex}/auth.json, OR
 *   (b) a non-empty OPENAI_API_KEY.
 * Refuses to spawn only when BOTH are absent.
 */
export class CodexPaneAdapter implements PaneAdapter {
  readonly hostKind = "codex" as const;
  readonly adapterVersion = ADAPTER_VERSION;
  private run: RunFn;
  private env_: NodeJS.ProcessEnv;
  private fs_: FsSeam;

  constructor(opts: AdapterOpts = {}) {
    this.run = opts.run ?? defaultRun;
    this.env_ = opts.env ?? process.env;
    this.fs_ = opts.fs ?? nodefs;
  }

  /** Resolve the auth.json path, honouring CODEX_HOME env override. */
  private authJsonPath(): string {
    const codexHome = (this.env_["CODEX_HOME"] ?? "").trim();
    const base = codexHome || nodepath.join(os.homedir(), ".codex");
    return nodepath.join(base, "auth.json");
  }

  /** Returns true when auth.json exists at the resolved path and is non-empty. */
  private hasAuthJson(): boolean {
    const p = this.authJsonPath();
    try {
      if (!this.fs_.existsSync(p)) return false;
      return this.fs_.statSync(p).size > 0;
    } catch {
      return false;
    }
  }

  preflight(): PreflightResult {
    const r = this.run("codex", ["--version"]);
    if (r.status !== 0) {
      return {
        ok: false,
        message:
          "`codex` binary not found or not runnable (codex --version failed). " +
          "Install the Codex CLI and ensure it is on PATH.",
      };
    }
    const key = (this.env_["OPENAI_API_KEY"] ?? "").trim();
    const authJson = this.hasAuthJson();
    if (!key && !authJson) {
      const authJsonPath = this.authJsonPath();
      return {
        ok: false,
        message:
          "no OPENAI_API_KEY and no codex login session at " +
          `${authJsonPath} — run \`codex login\` or set OPENAI_API_KEY ` +
          "(CH-6 fail-fast).",
      };
    }
    const authDesc = key ? "OPENAI_API_KEY present" : `codex login session (${this.authJsonPath()})`;
    return { ok: true, message: `codex --version ok; ${authDesc}` };
  }

  command(spec: PaneSpec): string {
    // Self-contained: export the run id, run `codex exec` with the staging
    // prompt, then keep the pane alive so the operator can inspect handoffs.
    // NO CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS — Codex is not on the Claude bus.
    // D-CAP: export GUILD_TASK_ID (scope-file locator) and optionally
    // GUILD_CAPABILITY_SCOPE (env fast-path) so D-CAP enforces on Codex panes.
    const taskFragment =
      spec.taskId ? `export GUILD_TASK_ID=${shellQuote(spec.taskId)}; ` : "";
    // G-9 / C2-D1: GUILD_SPECIALIST arms the PostToolUse heartbeat writer
    // (lane panes only; Codex panes run no Claude hooks today, but the env
    // parity keeps the heartbeat contract uniform across adapters).
    const specialistFragment =
      spec.specialist ? `export GUILD_SPECIALIST=${shellQuote(spec.specialist)}; ` : "";
    const scopeFragment =
      spec.capability_scope !== undefined
        ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(spec.capability_scope))}; `
        : "";
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      taskFragment +
      specialistFragment +
      taskAssignmentExport(spec) +
      scopeFragment +
      `codex exec ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      // G-9 / C2-D1: GUILD_SPECIALIST arms the PostToolUse heartbeat writer.
      ...(spec.specialist ? { GUILD_SPECIALIST: spec.specialist } : {}),
      // D-CAP: GUILD_TASK_ID locates the scope file; GUILD_CAPABILITY_SCOPE is the fast-path.
      ...(spec.taskId ? { GUILD_TASK_ID: spec.taskId } : {}),
      ...(spec.capability_scope !== undefined
        ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) }
        : {}),
      ...taskAssignmentEnv(spec),
    };
  }

  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["heartbeat", "handoff_receipt", "approval_request"];
  }
}

// ── AntigravityPaneAdapter ────────────────────────────────────────────────────

/**
 * Antigravity CLI pane (Rung-1 tmux substrate), invoked via the `agy` command
 * (the headless CLI; the bare `antigravity` binary is the Electron IDE GUI and
 * cannot run headless in a pane). Keeps the pane alive after the run. File-bus
 * coordination only (no Claude agent-team gate, no Claude hooks → no heartbeat).
 * Gemini was discarded 2026-06-14 (sunset in favour of Antigravity).
 *
 * STATUS: LIVE-VALIDATED 2026-06-14 against agy 1.0.8 — `agy --help` confirms
 * `-p` is the short alias for `--print` ("Run a single prompt non-interactively
 * and print the response"); `agy -p '<prompt>'` returned the expected output
 * end-to-end. (For fully-autonomous panes, agy also offers
 * `--dangerously-skip-permissions`; left off here — Guild's capability_scope +
 * the host permission model govern autonomy, not a blanket bypass.)
 */
const AGY_PROMPT_FLAG = "-p"; // agy --print (verified, agy 1.0.8)

export class AntigravityPaneAdapter implements PaneAdapter {
  readonly hostKind = "antigravity-2" as const;
  readonly adapterVersion = ADAPTER_VERSION;
  private run: RunFn;
  private env_: NodeJS.ProcessEnv;

  constructor(opts: AdapterOpts = {}) {
    this.run = opts.run ?? defaultRun;
    this.env_ = opts.env ?? process.env;
  }

  preflight(): PreflightResult {
    const r = this.run("agy", ["--version"]);
    if (r.status !== 0) {
      return {
        ok: false,
        message:
          "`agy` (Antigravity CLI) not found or not runnable (agy --version failed). " +
          "Install the Antigravity CLI and ensure `agy` is on PATH (the GUI `antigravity` binary is not headless).",
      };
    }
    return { ok: true, message: "agy --version ok" };
  }

  command(spec: PaneSpec): string {
    const taskFragment = spec.taskId ? `export GUILD_TASK_ID=${shellQuote(spec.taskId)}; ` : "";
    const specialistFragment = spec.specialist ? `export GUILD_SPECIALIST=${shellQuote(spec.specialist)}; ` : "";
    const scopeFragment = spec.capability_scope !== undefined
      ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(spec.capability_scope))}; ` : "";
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      taskFragment + specialistFragment + taskAssignmentExport(spec) + scopeFragment +
      `agy ${AGY_PROMPT_FLAG} ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      ...(spec.specialist ? { GUILD_SPECIALIST: spec.specialist } : {}),
      ...(spec.taskId ? { GUILD_TASK_ID: spec.taskId } : {}),
      ...(spec.capability_scope !== undefined
        ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) } : {}),
      ...taskAssignmentEnv(spec),
    };
  }

  /** No Claude PostToolUse hook → no heartbeat; file-bus receipts + approvals only. */
  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["handoff_receipt", "approval_request"];
  }
}

// ── PiPaneAdapter ─────────────────────────────────────────────────────────────

/**
 * Pi CLI pane (Rung-1 tmux substrate). `pi` is a multi-provider AI coding
 * assistant (read/bash/edit/write tools; default provider google) — NOT
 * Inflection's Pi. Emits `pi -p '<prompt>'` (non-interactive print mode) then
 * keeps the pane alive. File-bus coordination only (no Claude hooks → no
 * heartbeat).
 *
 * STATUS: LIVE-VALIDATED 2026-06-14 against pi 0.79.3 — `pi --help` confirms
 * `--print, -p` is "Non-interactive mode: process prompt and exit"; `pi -p
 * '<prompt>'` returned the expected output end-to-end. Auth is multi-provider
 * and resolved by pi itself (`--api-key` defaults to provider env vars / pi
 * config), so preflight gates ONLY on the binary — hard-gating a single API-key
 * env var would be wrong for a multi-provider CLI (CH-6 fail-fast applies to the
 * binary; the provider key is pi's own concern and errors at call time if absent).
 */
export class PiPaneAdapter implements PaneAdapter {
  readonly hostKind = "pi" as const;
  readonly adapterVersion = ADAPTER_VERSION;
  private run: RunFn;

  constructor(opts: AdapterOpts = {}) {
    this.run = opts.run ?? defaultRun;
  }

  preflight(): PreflightResult {
    const r = this.run("pi", ["--version"]);
    if (r.status !== 0) {
      return {
        ok: false,
        message:
          "`pi` binary not found or not runnable (pi --version failed). " +
          "Install the Pi CLI and ensure it is on PATH.",
      };
    }
    return { ok: true, message: "pi --version ok (multi-provider; pi resolves its own auth)" };
  }

  command(spec: PaneSpec): string {
    const taskFragment = spec.taskId ? `export GUILD_TASK_ID=${shellQuote(spec.taskId)}; ` : "";
    const specialistFragment = spec.specialist ? `export GUILD_SPECIALIST=${shellQuote(spec.specialist)}; ` : "";
    const scopeFragment = spec.capability_scope !== undefined
      ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(spec.capability_scope))}; ` : "";
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      taskFragment + specialistFragment + taskAssignmentExport(spec) + scopeFragment +
      `pi -p ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      ...(spec.specialist ? { GUILD_SPECIALIST: spec.specialist } : {}),
      ...(spec.taskId ? { GUILD_TASK_ID: spec.taskId } : {}),
      ...(spec.capability_scope !== undefined
        ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) } : {}),
      ...taskAssignmentEnv(spec),
    };
  }

  /** Pi core lacks MCP + Claude hooks → file-bus receipts + approvals only. */
  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["handoff_receipt", "approval_request"];
  }
}

// ── Adapter registry + resolver ───────────────────────────────────────────────

/**
 * Build the `host_kind` → adapter map. Constructed per call so test seams (run /
 * env overrides) propagate to every adapter. A future host adds one row here.
 *
 * Return type is `Partial<Record<HostKind, PaneAdapter>>` (HostKind has 9 hosts).
 * Wired Rung-1 (tmux CLI pane) adapters: claude + codex (reference, live-validated)
 * and antigravity-2 (the `agy` CLI) + pi ([v2-contract-only] — command construction
 * unit-tested, live validation + exact prompt-flag pending the runtime). Gemini was
 * discarded 2026-06-14 (sunset in favour of Antigravity). The remaining HostKinds
 * are NOT Rung-1 tmux panes — claude-code-desktop/web, codex-app, and the claude.ai
 * connector use different substrate/dispatch surfaces (host-adapter-contract.md
 * Surface 8 ladder). `resolveAdapter` throws on an unregistered key.
 */
export function buildAdapters(opts: AdapterOpts = {}): Partial<Record<HostKind, PaneAdapter>> {
  return {
    claude: new ClaudePaneAdapter(opts),
    codex: new CodexPaneAdapter(opts),
    "antigravity-2": new AntigravityPaneAdapter(opts),
    pi: new PiPaneAdapter(opts),
  };
}

/**
 * The default resolver wired into `TmuxTeamBackend` for mixed-host teams.
 * Throws on an unknown host_kind rather than silently falling back — an
 * unregistered brand is a programming error, not a routable state.
 */
export function resolveAdapter(opts: AdapterOpts = {}): AdapterResolver {
  const adapters = buildAdapters(opts);
  return (hostKind: HostKind): PaneAdapter => {
    const adapter = adapters[hostKind];
    if (!adapter) {
      throw new Error(
        `No PaneAdapter registered for host_kind="${hostKind}" ` +
          `(known: ${Object.keys(adapters).join(", ")}). ` +
          `Add an adapter in scripts/lib/pane-adapter.ts (CH-2 extension point).`
      );
    }
    return adapter;
  };
}

// ── Fail-fast team preflight (CH-6) ───────────────────────────────────────────

export interface PreflightFailure {
  specialist: string;
  hostKind: HostKind;
  message: string;
}

/**
 * Probe every distinct pane host BEFORE any pane spawns. The orchestrator pane
 * is the starting host (default claude for backward compatibility); each
 * specialist uses its `host_kind` (absent ⇒ orchestrator host). Returns ALL
 * failures so the caller can name every blocker, but the contract is fail-fast:
 * if `ok` is false, the launcher MUST open zero panes.
 */
export function preflightTeam(
  specialists: Array<{ name: string; host_kind?: HostKind }>,
  resolver: AdapterResolver,
  orchestratorHostKind: HostKind = "claude",
): { ok: boolean; failures: PreflightFailure[] } {
  const panes: Array<{ name: string; hostKind: HostKind }> = [
    { name: "orchestrator", hostKind: orchestratorHostKind },
    ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? orchestratorHostKind })),
  ];
  const failures: PreflightFailure[] = [];
  const probed = new Set<HostKind>();
  for (const pane of panes) {
    if (probed.has(pane.hostKind)) continue;
    probed.add(pane.hostKind);
    const r = resolver(pane.hostKind).preflight();
    if (!r.ok) {
      failures.push({ specialist: pane.name, hostKind: pane.hostKind, message: r.message });
    }
  }
  return { ok: failures.length === 0, failures };
}
