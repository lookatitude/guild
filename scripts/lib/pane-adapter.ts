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
 * Adding a future host (Gemini, …) is one new adapter file + one ADAPTERS row —
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
    // Byte-identical to the shipped Claude-only pane command.
    return paneCommand(spec.prompt, spec.runId);
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: spec.runId,
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
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      `codex exec ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return { GUILD_RUN_ID: spec.runId };
  }

  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["heartbeat", "handoff_receipt", "approval_request"];
  }
}

// ── Adapter registry + resolver ───────────────────────────────────────────────

/**
 * Build the `host_kind` → adapter map. Constructed per call so test seams (run /
 * env overrides) propagate to every adapter. A future host adds one row here.
 *
 * PHASE-1-DISPATCH-WAVE-1: return type widened from
 * `Record<HostKind, PaneAdapter>` to `Partial<Record<HostKind, PaneAdapter>>`
 * because HostKind widened from 2 to 9 hosts in Wave-1; only claude + codex
 * are wired up today. `resolveAdapter` below already throws on an unknown
 * key, so the runtime semantics are unchanged. Per-host adapter
 * implementations land in their own downstream initiatives.
 */
export function buildAdapters(opts: AdapterOpts = {}): Partial<Record<HostKind, PaneAdapter>> {
  return {
    claude: new ClaudePaneAdapter(opts),
    codex: new CodexPaneAdapter(opts),
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
 * is always the claude host (CH-4); each specialist uses its `host_kind` (absent
 * ⇒ claude). Returns ALL failures so the caller can name every blocker, but the
 * contract is fail-fast: if `ok` is false, the launcher MUST open zero panes.
 */
export function preflightTeam(
  specialists: Array<{ name: string; host_kind?: HostKind }>,
  resolver: AdapterResolver
): { ok: boolean; failures: PreflightFailure[] } {
  const panes: Array<{ name: string; hostKind: HostKind }> = [
    { name: "orchestrator", hostKind: "claude" },
    ...specialists.map((s) => ({ name: s.name, hostKind: s.host_kind ?? "claude" })),
  ];
  const failures: PreflightFailure[] = [];
  for (const pane of panes) {
    const r = resolver(pane.hostKind).preflight();
    if (!r.ok) {
      failures.push({ specialist: pane.name, hostKind: pane.hostKind, message: r.message });
    }
  }
  return { ok: failures.length === 0, failures };
}
