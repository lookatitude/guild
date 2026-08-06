/**
 * scripts/lib/pane-adapter.ts
 *
 * CH-2 — provider-neutral PaneAdapter implementations for mixed-host tmux teams.
 *
 * Contract (BY POINTER): ADR: v2-cross-host-orchestration (workspace wiki)
 *   §CH-2 (PaneAdapter interface + ClaudePaneAdapter / CodexPaneAdapter),
 *   §CH-6 (fail-fast preflight). The `PaneAdapter` / `PaneSpec` / `PreflightResult`
 *   TYPES are defined in ./team-backend.ts (the lowest-level lib) so the backend
 *   can type against them without importing this file — this module imports the
 *   types + the shared pane primitives one-directionally (no cycle).
 *
 * Ships FOUR bespoke adapters, registered in an `ADAPTERS` map keyed by `host_kind`:
 *   - ClaudePaneAdapter — emits the SAME command as the legacy `paneCommand`
 *     (byte-identical to the shipped launcher); injects the agent-team env gate
 *     + GUILD_RUN_ID; preflight `claude --version`.
 *   - CodexPaneAdapter — emits `codex exec '<prompt>'`; injects GUILD_RUN_ID only
 *     (NO Claude team env gate); preflight `codex --version` AND usable auth,
 *     where usable auth = a non-empty auth.json at CODEX_HOME/auth.json OR a
 *     non-empty OPENAI_API_KEY (refuses to spawn if both are absent — CH-6).
 *   - AntigravityPaneAdapter / PiPaneAdapter — the two other LIVE-VALIDATED
 *     (2026-06-14) CLI hosts.
 *
 * PLUS one GENERIC adapter, `WrappedCliPaneAdapter`, constructed on demand by
 * `buildAdapters()` for every registry row (host-registry-schema.ts) that is a real
 * `adapter_binding:"self"` CLI surface, is `dispatch_selectable:true`, and has no
 * bespoke class above — today cursor / github-copilot / opencode / rovo-dev (G4b
 * host-reachability fix: these 4 wrapped-CLI hosts had a `dispatch_selectable:true`
 * registry row but NO adapter of any kind, so a lane routed to them could never
 * actually spawn a pane). Adding a future plain wrapped-CLI host now needs ONLY a
 * registry row — zero adapter-file edits — unless its real CLI needs a bespoke
 * invocation shape, in which case give it its own class exactly like the four above
 * (CH-2 extension point unchanged).
 *
 * Invariant: adapters never touch project or run state. They are pure
 * command/env builders plus injectable probes. The one exception is scoped and
 * deliberate: the issue-#94 codex enforcement probe creates a throwaway temp
 * directory (removed in a `finally`) and executes Guild's own gate binary
 * against it, because the fact it must establish — that the gate really refuses
 * — cannot be read off the filesystem.
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
import {
  DISPATCH_PRODUCER_ENV,
  DISPATCH_PRODUCER_TOKEN,
} from "./core/contracts/team-backend";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostRegistryEntry } from "./host-registry-schema";
import { registryIdToCanonicalHostKind } from "./host-id-namespace";
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

/**
 * Minimal fs seam — the operations used by CodexPaneAdapter.preflight() plus
 * (issue #94) the codex PreToolUse enforcement probe, which must READ the codex
 * hooks manifest to learn which command is registered.
 */
export interface FsSeam {
  existsSync(path: string): boolean;
  statSync(path: string): { size: number };
  readFileSync?(path: string, encoding: "utf8"): string;
}

export interface AdapterOpts {
  /** Test seam: override the version-probe runner. */
  run?: RunFn;
  /** Test seam: override env lookups (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
  /** Test seam: override filesystem operations (defaults to node:fs). */
  fs?: FsSeam;
  /**
   * ISSUE #94 — opt-in permission-bypass argv for a CODEX pane (e.g.
   * `["--dangerously-bypass-approvals-and-sandbox"]`).
   *
   * TWO GATES, exactly mirroring the remote-Claude design in
   * RemoteTeamBackend.claudeLaunchArgs (rf-wi-04 items 1+3). The flag reaches a
   * codex pane ONLY when BOTH hold:
   *   (a) the caller EXPLICITLY passed it here, AND
   *   (b) probeCodexPreToolUseEnforcement() proves the deny actually EXECUTES.
   *
   * DEFAULT is `[]` (bare) — the safe posture, and byte-identical to the
   * pre-issue-#94 command. Withholding the flag only ever launches bare.
   */
  codexLaunchArgs?: string[];
  /**
   * ISSUE #94 — the PROJECT root a codex pane will run against. The bypass
   * probe judges the project's own `bypass_permissions_policy`, so it must read
   * the TARGET project's config, not the launcher's working directory: a
   * launcher sitting in a hard-blocking project while dispatching into a
   * permissive one would otherwise grant the flag on the wrong project's
   * policy. Defaults to `process.cwd()`.
   */
  projectCwd?: string;
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

// ── T6-R2-F5: the selected model reaches the real pane process ───────────────
//
// `spec.model` is set ONLY when the evidenced M2 gate froze a selection for
// this lane (dispatchModelForSpecialist). Every adapter below therefore emits
// its legacy command byte-identically whenever it is absent.
//
// Each host's model flag is LIVE-VERIFIED on this machine, never guessed:
//   claude --model <model>   (claude --help)
//   codex exec -m <MODEL>    (codex exec --help)
//   agy --model <model>      (agy --help)
//   pi --model <pattern>     (pi --help)
// The GENERIC WrappedCliPaneAdapter covers registry rows whose CLI shape we have
// NOT verified, so it injects NO model flag — it exports GUILD_MODEL only and
// the host keeps its own model resolution (honest degradation, never invented).

/** `<flag> <model> ` argv fragment for a verified host flag, or "" when no model. */
function modelArg(spec: PaneSpec, flag: string): string {
  return spec.model !== undefined && spec.model.length > 0
    ? `${flag} ${shellQuote(spec.model)} `
    : "";
}
/** `export GUILD_MODEL=…; ` fragment — the provenance every pane can read back. */
function modelExport(spec: PaneSpec): string {
  return spec.model !== undefined && spec.model.length > 0
    ? `export GUILD_MODEL=${shellQuote(spec.model)}; `
    : "";
}
/** The `GUILD_MODEL` (+ params) entries for an adapter's env map, or {} when no model. */
function modelEnv(spec: PaneSpec): Record<string, string> {
  if (spec.model === undefined || spec.model.length === 0) return {};
  return {
    GUILD_MODEL: spec.model,
    ...(spec.modelParams !== undefined
      ? { GUILD_MODEL_PARAMS: JSON.stringify(spec.modelParams) }
      : {}),
  };
}

// ── Universal structured producer marker (rf-wi-03 / G3) ─────────────────────
//
// Every producer-composed dispatch carries GUILD_DISPATCH_PRODUCER. The Claude
// adapter gets it via `paneCommand` (command) already; every OTHER adapter emits
// it here so the marker is universal across ALL pane backends (Codex / Pi /
// Antigravity / wrapped-CLI), including remote dispatch which routes through
// these adapters. Both channels — the shell `export …` fragment (command) and
// the env map (env) — so the marker rides whichever the launcher/transport uses.
/** `export GUILD_DISPATCH_PRODUCER=…; ` fragment for a non-Claude pane command. */
function producerMarkerExport(): string {
  return `export ${DISPATCH_PRODUCER_ENV}=${shellQuote(DISPATCH_PRODUCER_TOKEN)}; `;
}
/** The producer-marker entry for any adapter's env map. */
function producerMarkerEnv(): Record<string, string> {
  return { [DISPATCH_PRODUCER_ENV]: DISPATCH_PRODUCER_TOKEN };
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
    // T6-R2-F5: `spec.model` (evidenced M2 selection) becomes `claude --model`.
    return paneCommand(
      spec.prompt,
      spec.runId,
      spec.capability_scope,
      spec.taskId,
      spec.specialist,
      // `undefined` keeps paneCommand's own GUILD_PANE_DEBUG default — the
      // shim's export surface stays frozen (rearch parity) while the model
      // still reaches the pane. `[]` launchArgs (issue #54): the ClaudePaneAdapter
      // stays the BARE path (no permission-mode flags); `spec.model` rides the
      // trailing `model` param so T6 model selection still reaches the pane.
      undefined,
      [],
      spec.model,
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      GUILD_RUN_ID: spec.runId,
      ...modelEnv(spec),
      ...producerMarkerEnv(),
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

// ── ISSUE #94: codex PreToolUse enforcement probe ─────────────────────────────

/** The bypass flag a codex pane may be granted, and ONLY behind the probe. */
export const CODEX_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";

/**
 * Shipped WITH the bypass, never alone. Codex runs an enabled hook only when it
 * carries persisted hook trust — granted interactively and readable nowhere the
 * CLI exposes — so without this a bypassed pane's Guild gate can silently no-op.
 * See CodexPaneAdapter.command() for the full rationale.
 */
export const CODEX_HOOK_TRUST_FLAG = "--dangerously-bypass-hook-trust";

/** Outcome of probeCodexPreToolUseEnforcement — every check is separately reportable. */
export interface CodexEnforcementProbeResult {
  /** True iff EVERY check below passes. The only thing the bypass gate reads. */
  enforced: boolean;
  /** Operator-facing explanation; always populated, pass or fail. */
  detail: string;
  /** The manifest the verdict was drawn from, when one was found. */
  manifest?: string;
  checks: {
    /** The codex hooks manifest exists AND registers a PreToolUse command. */
    manifest_registers_pretooluse: boolean;
    /** The registered command's script is actually on disk. */
    bridge_present: boolean;
    /**
     * EVERY hook the manifest registers resolves to a Guild-shipped script.
     * Gates the hook-trust flag: proving Guild's bridge enforces says nothing
     * about a third party's hook in the same manifest.
     */
    sole_owner: boolean;
    /** The bridge, when EXECUTED, really emits permissionDecision:"deny". */
    deny_functional: boolean;
    /**
     * ...and STILL denies under `permission_mode:"bypassPermissions"` — the mode
     * the granted pane actually runs in. Distinct fact: the project's
     * `bypass_permissions_policy` decides this one, and its default (`audit`)
     * ALLOWS an out-of-scope call.
     */
    deny_under_bypass: boolean;
  };
}

export interface CodexProbeOpts {
  env?: NodeJS.ProcessEnv;
  fs?: FsSeam;
  run?: RunFn;
  /**
   * The project root whose security config the bypass leg is judged against.
   * Defaults to `process.cwd()`. The probe reads this project's config and
   * writes nothing into it — its run dir is always a scratch directory, so any
   * approval_request the gate emits lands there and is deleted.
   */
  cwd?: string;
  /**
   * Where a Guild install may have written its codex manifest, beyond
   * `$CODEX_HOME/hooks.json`. Defaults to the packaged
   * `<plugin-root>/hooks/codex-hooks.json` resolved from the env.
   */
  manifestPaths?: string[];
}

interface CodexHookManifest {
  hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
}

/** Extract the first `PreToolUse` command string from a codex hooks manifest. */
function preToolUseCommandFrom(manifestRaw: string): string | null {
  try {
    const m = JSON.parse(manifestRaw) as CodexHookManifest;
    const cmd = m.hooks?.["PreToolUse"]?.[0]?.hooks?.[0]?.command;
    return typeof cmd === "string" && cmd.trim().length > 0 ? cmd.trim() : null;
  } catch {
    return null;
  }
}

/** Every hook command a codex manifest registers, across all events. */
function allHookCommandsFrom(manifestRaw: string): string[] {
  try {
    const m = JSON.parse(manifestRaw) as CodexHookManifest;
    return Object.values(m.hooks ?? {})
      .flat()
      .flatMap((g) => g?.hooks ?? [])
      .map((h) => (h?.command ?? "").trim())
      .filter((c) => c.length > 0);
  } catch {
    return [];
  }
}


/**
 * Expand `${NAME}` / `${NAME:-DEFAULT}` references, where DEFAULT may itself
 * contain further references — the `${A:-${B:-${C}}}` chain Guild's generated
 * hook commands use.
 *
 * OUTERMOST-FIRST, matching the shell: when `A` is set, `B` and `C` are never
 * consulted, so an unset `C` must NOT sink the expansion. An innermost-first
 * pass got this backwards and rejected Guild's own install.
 *
 * Returns null when a reference is genuinely unresolvable (unset, no default) —
 * "cannot resolve" must read as "cannot prove", never as an empty string.
 */
function expandVarRefs(input: string, env: NodeJS.ProcessEnv): string | null {
  let out = "";
  let i = 0;
  while (i < input.length) {
    const open = input.indexOf("${", i);
    if (open === -1) {
      out += input.slice(i);
      break;
    }
    out += input.slice(i, open);
    // Find the matching close brace, honouring nesting.
    let depth = 0;
    let close = -1;
    for (let j = open + 1; j < input.length; j += 1) {
      if (input[j] === "{") depth += 1;
      else if (input[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1) return null; // unbalanced — refuse to guess
    const body = input.slice(open + 2, close);
    const sep = body.indexOf(":-");
    const name = (sep === -1 ? body : body.slice(0, sep)).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
    // EXACT `${VAR:-default}` semantics — the default applies when VAR is unset
    // OR empty, and a non-empty value is used VERBATIM. Trimming it here made
    // the probe resolve a path the shell would not: a root with a trailing
    // space vouched for the trimmed (valid) bridge while the real command kept
    // the space and failed to load.
    const value = env[name];
    if (value !== undefined && value !== "") {
      out += value;
    } else if (sep === -1) {
      return null; // unset, no default
    } else {
      const fallback = expandVarRefs(body.slice(sep + 2), env);
      if (fallback === null) return null;
      out += fallback;
    }
    i = close + 1;
  }
  return out;
}

/**
 * The ONLY hook-command shape the probe will vouch for:
 *
 *     node "<path>.js" [plain args...]
 *
 * The script may be single- or double-quoted, or bare with no spaces; trailing
 * arguments must be plain tokens (Guild's own SessionStart hook carries
 * `--host codex-cli`). They are PARSED, not discarded, and the probe executes
 * the script WITH them, so the command that earns the grant is exactly the
 * command that was proven. Nothing else is accepted. Not because other shapes cannot work, but because anything else
 * cannot be VERIFIED: a probe that pulls the first quoted token out of a command
 * and then runs `node <that token>` proves the token, not the command. Empirically
 * `node "<trusted bridge>"; touch /tmp/marker` satisfied a token-only check while
 * the shell ran the `touch` — so the command that earns the grant must be exactly
 * the command the probe executed, with no room for a second one.
 *
 * Anchored, no alternation over user input, and every shell operator
 * (`; & | > < ( ) \` $ \\` and newline) is rejected before parsing.
 */
const SAFE_HOOK_COMMAND_RE =
  /^node[ \t]+(?:"([^"]+)"|'([^']+)'|([^ \t]+\.js))((?:[ \t]+[A-Za-z0-9_.:/=@,+-]+)*)$/;

/** Shell characters that would give a command a second effect. */
const SHELL_OPERATOR_RE = /[;&|<>()`\\\n\r]/;

/**
 * Resolve the script (and its args) out of a registered hook command such as
 * `node "${GUILD_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}}/hooks/dist/x.js"`.
 *
 * ORDER MATTERS, and getting it wrong is exploitable: expanding variables into
 * the command string BEFORE parsing quotes lets a quote character carried in an
 * env VALUE be read as shell syntax, so the probe can resolve — and successfully
 * execute — a path that is not the one the shell would run. So the command is
 * matched against SAFE_HOOK_COMMAND_RE FIRST, unexpanded, and variables are
 * expanded only INSIDE the captured token.
 *
 * QUOTING FOLLOWS THE SHELL, not convenience:
 *   - double-quoted / bare  → `${VAR}` EXPANDS, and (double-quoted only) the
 *     result may contain spaces, because the shell passes it as one word. A
 *     legitimate plugin root with an internal space used to be rejected here.
 *   - single-quoted         → the shell expands NOTHING, so a `${` inside one
 *     is a literal path component. Expanding it would vouch for a path the
 *     shell never produces, so such a command is refused outright.
 *   - the separator is `[ \t]`, the shell's own IFS whitespace. JavaScript `\s`
 *     also matches NBSP and friends, which the shell treats as part of the
 *     WORD — `node<NBSP>"…"` is a command named `node<NBSP>"…"`, not `node`.
 *
 * An unset variable with no `:-` default yields null ("cannot resolve" ⇒ cannot
 * prove ⇒ FAIL), never the empty string — an empty expansion would turn
 * `${UNSET}/hooks/dist/x.js` into a plausible absolute path and make the verdict
 * depend on whether that path happens to exist.
 */
function parseHookCommand(
  command: string,
  env: NodeJS.ProcessEnv,
): { script: string; args: string[] } | null {
  const raw = command.trim();
  if (SHELL_OPERATOR_RE.test(raw)) return null;
  const m = SAFE_HOOK_COMMAND_RE.exec(raw);
  if (m === null) return null;
  const doubleQuoted = m[1];
  const singleQuoted = m[2];
  const bare = m[3];
  const token = doubleQuoted ?? singleQuoted ?? bare ?? "";
  if (token.length === 0) return null;

  let script: string;
  if (singleQuoted !== undefined) {
    // The shell would use these bytes verbatim. A `${` here is literal, and a
    // literal `${` in a path is not something Guild ever generates.
    if (singleQuoted.includes("${")) return null;
    script = singleQuoted;
  } else {
    const expanded = expandVarRefs(token, env);
    if (expanded === null || expanded.length === 0) return null;
    // A value that smuggled quoting or expansion syntax in is not a path we can
    // vouch for — the shell would read it differently than we just did.
    if (/["'`$\\]/.test(expanded)) return null;
    // A BARE word is split on IFS, so an expansion carrying whitespace becomes
    // several arguments. Inside double quotes it stays one word, so spaces are
    // legitimate there.
    if (doubleQuoted === undefined && /[ \t]/.test(expanded)) return null;
    script = expanded;
  }
  if (!script.endsWith(".js")) return null;

  const args: string[] = [];
  for (const arg of (m[4] ?? "").split(/[ \t]+/).filter((a) => a.length > 0)) {
    const argExpanded = expandVarRefs(arg, env);
    if (argExpanded === null) return null;
    if (/["'`$\\]/.test(argExpanded) || /[ \t]/.test(argExpanded)) return null;
    args.push(argExpanded);
  }
  return { script, args };
}

/** The script path alone, for the ownership scan. */
function scriptPathFrom(command: string, env: NodeJS.ProcessEnv): string | null {
  return parseHookCommand(command, env)?.script ?? null;
}

/** realpath, or null when the path does not exist / cannot be resolved. */
function realpathOrNull(p: string): string | null {
  try {
    return nodefs.realpathSync(p);
  } catch {
    return null;
  }
}

/** True when `child` is `root` itself or lies beneath it. Both must be real paths. */
function isInside(root: string, child: string): boolean {
  const rel = nodepath.relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !nodepath.isAbsolute(rel));
}

/**
 * ISSUE #94 — prove that codex-side PreToolUse enforcement is REAL on this box.
 *
 * WHY THIS IS NOT A FILE-PRESENCE CHECK. On-box (codex-cli 0.146.0), codex gates
 * hooks behind PERSISTED HOOK TRUST. With a valid hooks.json registering a
 * working deny hook, the raw binary ran the tool ANYWAY: the hook never
 * executed, produced no output, and emitted NO WARNING. Presence is therefore a
 * false positive on codex, so this probe ends with an EXECUTION test.
 *
 * Five checks, ALL required:
 *   1. manifest_registers_pretooluse — a Guild codex manifest (either
 *      `$CODEX_HOME/hooks.json` or the packaged `<plugin>/hooks/codex-hooks.json`)
 *      registers a PreToolUse command. Guild's generated command carries
 *      `${GUILD_PLUGIN_ROOT:-…}` chains, so they are EXPANDED from the env
 *      rather than rejected.
 *   2. bridge_present  — the registered script exists on disk.
 *   3. sole_owner      — EVERY hook the manifest registers resolves to a script
 *      under the same Guild plugin root. Proving Guild's bridge enforces says
 *      nothing about a third party's hook sharing that manifest, and the pane
 *      grant carries `--dangerously-bypass-hook-trust`, which would run theirs
 *      too. A foreign hook therefore withholds the whole grant.
 *   4. deny_functional — executing the bridge yields a parsed PreToolUse
 *      response whose decision is exactly `deny`, on a zero exit status.
 *
 * FAIL-CLOSED by construction: every error path (missing file, unreadable
 * manifest, unresolvable command, non-zero exit, unparseable or unexpected
 * stdout, thrown exception) leaves `enforced:false`. The only way to `true` is
 * an observed deny from a manifest Guild solely owns.
 */
export function probeCodexPreToolUseEnforcement(
  opts: CodexProbeOpts = {},
): CodexEnforcementProbeResult {
  const env = opts.env ?? process.env;
  const fsSeam = opts.fs ?? nodefs;
  const run = opts.run ?? defaultRun;
  const checks = {
    manifest_registers_pretooluse: false,
    bridge_present: false,
    sole_owner: false,
    deny_functional: false,
    deny_under_bypass: false,
  };
  const fail = (detail: string): CodexEnforcementProbeResult => ({
    enforced: false,
    detail,
    checks,
  });
  const readSeam = (p: string): string =>
    fsSeam.readFileSync ? fsSeam.readFileSync(p, "utf8") : nodefs.readFileSync(p, "utf8");

  // 1. SOME Guild codex manifest registers PreToolUse.
  //
  // EVERY source codex loads is enumerated, not just the one that happens to
  // register PreToolUse, because the grant carries CODEX_HOOK_TRUST_FLAG and
  // that flag runs EVERY enabled hook without persisted trust — a foreign hook
  // in any of them is a hook Guild would be authorizing. Per codex's hooks
  // documentation the sources are:
  //   - `$CODEX_HOME/hooks.json`         (operator-global)
  //   - `$CODEX_HOME/config.toml`        (inline `[hooks]` table)
  //   - `<project>/.codex/hooks.json`    (repository-local)
  //   - enabled plugins                  (NOT enumerable from here — see below)
  // plus the manifest Guild's generated codex package ships as
  // `<plugin-root>/hooks/codex-hooks.json`.
  const projectCwd = opts.cwd ?? process.cwd();
  const codexHome = (env["CODEX_HOME"] ?? "").trim() || nodepath.join(os.homedir(), ".codex");
  // NOT trimmed: the trusted root must be the bytes the shell would use, or the
  // probe vouches for a different path than the one that runs.
  const pluginRoot =
    env["GUILD_PLUGIN_ROOT"] ?? env["PLUGIN_ROOT"] ?? env["CLAUDE_PLUGIN_ROOT"] ?? "";
  const candidates =
    opts.manifestPaths ??
    [
      nodepath.join(codexHome, "hooks.json"),
      nodepath.join(projectCwd, ".codex", "hooks.json"),
      ...(pluginRoot.length > 0 ? [nodepath.join(pluginRoot, "hooks", "codex-hooks.json")] : []),
    ];

  // PLUGINS ARE THE HONEST LIMIT. Codex plugins can carry their own hooks, and
  // Guild has no reliable way to enumerate an enabled plugin's hook set from
  // here. Rather than assert a containment it cannot check, the probe REFUSES
  // the grant whenever a plugin directory is present at all: the trust-bypass
  // flag would run those hooks too, and "we did not look" is not a proof.
  const pluginsDir = nodepath.join(codexHome, "plugins");
  let pluginEntries: string[] = [];
  try {
    pluginEntries = fsSeam.existsSync(pluginsDir) ? nodefs.readdirSync(pluginsDir) : [];
  } catch {
    pluginEntries = ["<unreadable>"];
  }
  if (pluginEntries.length > 0) {
    return fail(
      `codex PreToolUse enforcement NOT proven (grant withheld): ${pluginsDir} contains ` +
        `${pluginEntries.length} plugin(s), whose hooks Guild cannot enumerate. The grant ` +
        `carries ${CODEX_HOOK_TRUST_FLAG}, which would run them untrusted, and Guild will not ` +
        `authorize hooks it has not inspected. Codex panes launch BARE.`,
    );
  }

  // An inline `[hooks]` table in config.toml is likewise a source we cannot
  // parse into commands with confidence, so its presence withholds the grant.
  const configPath = nodepath.join(codexHome, "config.toml");
  try {
    if (fsSeam.existsSync(configPath) && /^\s*\[hooks[.\]]/m.test(readSeam(configPath))) {
      return fail(
        `codex PreToolUse enforcement NOT proven (grant withheld): ${configPath} declares an ` +
          `inline [hooks] table. Guild vouches only for hook sources it can parse into ` +
          `commands. Move the hooks into hooks.json or drop the grant. Codex panes launch BARE.`,
      );
    }
  } catch {
    return fail(
      `codex PreToolUse enforcement NOT proven: ${configPath} exists but cannot be read, so ` +
        `its hooks cannot be vouched for. Codex panes launch BARE.`,
    );
  }

  // EVERY candidate that exists is read, not just the first with a PreToolUse
  // entry. Codex loads them all, so an ownership proof drawn from one manifest
  // says nothing about a foreign hook sitting in another.
  const present: Array<{ path: string; raw: string }> = [];
  for (const candidate of candidates) {
    try {
      if (!fsSeam.existsSync(candidate)) continue;
      present.push({ path: candidate, raw: readSeam(candidate) });
    } catch {
      return fail(
        `codex PreToolUse enforcement NOT proven: ${candidate} exists but cannot be read, ` +
          `so its hooks cannot be vouched for. Codex panes launch BARE.`,
      );
    }
  }
  const registering = present.find((m) => preToolUseCommandFrom(m.raw) !== null);
  const command = registering ? preToolUseCommandFrom(registering.raw) : null;
  if (registering === undefined || command === null) {
    return fail(
      `codex PreToolUse enforcement NOT proven: no codex hooks manifest registering a ` +
        `PreToolUse hook was found (looked at ${candidates.join(", ") || "no candidate paths"}). ` +
        `Install/refresh the Guild codex package. Codex panes launch BARE (bypass withheld).`,
    );
  }
  const manifestPath = registering.path;
  checks.manifest_registers_pretooluse = true;

  // 2. the registered bridge is on disk, INSIDE a root we did not learn from it.
  //
  // The ownership root must be independent of the command being vetted. An
  // earlier draft derived it by walking three parents up from the registered
  // script — self-authenticating, and trivially defeated: a hook registered at
  // `/tmp/x.js` yields the root `/`, under which every path on the box is
  // "Guild's". The root now comes from the environment (the same plugin-root
  // chain the install uses), realpath-resolved so a symlink cannot escape it.
  const trustedRoot = pluginRoot.length > 0 ? realpathOrNull(pluginRoot) : null;
  if (trustedRoot === null) {
    return fail(
      `codex PreToolUse enforcement NOT proven: no resolvable Guild plugin root ` +
        `(GUILD_PLUGIN_ROOT / PLUGIN_ROOT / CLAUDE_PLUGIN_ROOT). Without one there is no ` +
        `independent way to tell Guild's hooks from anyone else's, and the grant carries ` +
        `${CODEX_HOOK_TRUST_FLAG}. Codex panes launch BARE.`,
    );
  }
  const parsed = parseHookCommand(command, env);
  const script = parsed?.script ?? null;
  const scriptReal = script === null ? null : realpathOrNull(script);
  if (script === null || scriptReal === null || !fsSeam.existsSync(script)) {
    return fail(
      `codex PreToolUse enforcement NOT proven: the PreToolUse command in ${manifestPath} ` +
        `(${command}) does not resolve to a script on disk — the issue-#55 defect class ` +
        `(a signal whose binary is absent can never fire). If the command uses ` +
        `\${GUILD_PLUGIN_ROOT}, export it for this process.`,
    );
  }
  if (!isInside(trustedRoot, scriptReal)) {
    return fail(
      `codex PreToolUse enforcement NOT proven: the registered PreToolUse script ${scriptReal} ` +
        `is outside the Guild plugin root ${trustedRoot}. Guild will not vouch for a bridge ` +
        `it did not ship. Codex panes launch BARE.`,
    );
  }
  checks.bridge_present = true;

  // 3. Guild solely owns EVERY manifest codex will load.
  const foreign: string[] = [];
  for (const manifest of present) {
    for (const cmd of allHookCommandsFrom(manifest.raw)) {
      const p = scriptPathFrom(cmd, env);
      const real = p === null ? null : realpathOrNull(p);
      if (real === null || !isInside(trustedRoot, real)) {
        foreign.push(`${manifest.path}: ${cmd}`);
      }
    }
  }
  if (foreign.length > 0) {
    return fail(
      `codex PreToolUse enforcement NOT proven (grant withheld): hook command(s) outside the ` +
        `Guild plugin root ${trustedRoot} — ${foreign.join("; ")}. The pane grant carries ` +
        `${CODEX_HOOK_TRUST_FLAG}, which would run those untrusted too, so a hook set Guild ` +
        `does not solely own never earns the bypass.`,
    );
  }
  checks.sole_owner = true;

  // 4/5. THE EXECUTION TESTS — the checks that presence cannot give us.
  //
  // The bridge is fed a synthetic PreToolUse event in codex's own on-box payload
  // shape, for a tool OUTSIDE an explicit capability scope, so a working bridge
  // MUST refuse it — and on a codex host that refusal must be `deny`, because
  // codex has no `ask` primitive.
  //
  // TWICE, because the granted pane does not run in the default mode. Codex
  // under `--dangerously-bypass-approvals-and-sandbox` reports
  // `permission_mode:"bypassPermissions"` (captured verbatim on-box), and Guild
  // routes that through `bypass_permissions_policy`, whose DEFAULT (`audit`)
  // records an out-of-scope call and ALLOWS it. A probe that only exercised the
  // default mode would prove enforcement for a pane that does not exist and
  // grant the flag to one that is not enforced. So:
  //   4. deny_functional    — refuses in the ordinary mode (the bridge works).
  //   5. deny_under_bypass  — still refuses under bypassPermissions (THIS
  //      project's policy actually hard-blocks). Under the default `audit` this
  //      fails, and it SHOULD: there is nothing there to justify a bypass.
  //
  // The event's `cwd` is the REAL project root, so the policy under test is the
  // project's own rather than one the probe invented; the run dir is always a
  // scratch directory, so no probe artifact ever lands in a real run's file bus.
  const sandbox = nodefs.mkdtempSync(nodepath.join(os.tmpdir(), "guild-codex-probe-"));
  const attempt = (
    permissionMode: string | undefined,
  ): { status: number | null; decision: string | null } => {
    const runDir = nodepath.join(sandbox, "run");
    nodefs.mkdirSync(runDir, { recursive: true });
    const r = run("node", [script, ...(parsed?.args ?? [])], {
      input: JSON.stringify({
        session_id: "guild-codex-enforcement-probe",
        transcript_path: "",
        cwd: projectCwd,
        hook_event_name: "PreToolUse",
        ...(permissionMode !== undefined ? { permission_mode: permissionMode } : {}),
        tool_name: "Bash",
        tool_input: { command: "guild-codex-enforcement-probe" },
        tool_use_id: "guild-probe",
      }),
      env: {
        // process.env FIRST so the child keeps PATH (without it `node` may not
        // even resolve, which would read as "no deny" — a false NEGATIVE that
        // silently withholds the flag). `env` (the injectable seam) overrides it.
        ...process.env,
        ...env,
        GUILD_RUN_ID: "run-guild-codex-enforcement-probe",
        GUILD_RUN_DIR: runDir,
        // Pinned, not inherited: an ambient GUILD_CWD from the launcher's own
        // session takes priority over the event's `cwd` inside the hook, which
        // would silently judge the wrong project's policy.
        GUILD_CWD: projectCwd,
        // Force the refusal: an explicit scope that does not contain Bash.
        GUILD_CAPABILITY_SCOPE: JSON.stringify(["Read"]),
        GUILD_HOST: "codex-cli",
        GUILD_HOST_ID: "codex-cli",
      },
      encoding: "utf8",
    });
    return { status: r.status ?? null, decision: parsePreToolUseDecision(r.stdout ?? "") };
  };

  let plain: { status: number | null; decision: string | null };
  let bypassed: { status: number | null; decision: string | null };
  try {
    plain = attempt(undefined);
    bypassed = attempt("bypassPermissions");
  } catch (e) {
    return fail(`codex PreToolUse enforcement NOT proven: probing the bridge threw (${String(e)}).`);
  } finally {
    try {
      nodefs.rmSync(sandbox, { recursive: true, force: true });
    } catch {
      // A leaked temp dir must never change the verdict.
    }
  }

  if (plain.status !== 0) {
    return fail(
      `codex PreToolUse enforcement NOT proven: the bridge (${script}) exited ` +
        `${String(plain.status)}. A gate that cannot complete cleanly is not a gate. ` +
        `Codex panes launch BARE.`,
    );
  }
  if (plain.decision !== "deny") {
    return fail(
      `codex PreToolUse enforcement NOT proven: the bridge (${script}) answered ` +
        `${plain.decision === null ? "no parseable PreToolUse response" : `"${plain.decision}"`} ` +
        `for an out-of-scope tool call, not "deny". Codex honours only deny, and a hook can be ` +
        `registered and present yet never enforce (codex requires persisted hook trust). ` +
        `Codex panes launch BARE.`,
    );
  }
  checks.deny_functional = true;

  if (bypassed.status !== 0 || bypassed.decision !== "deny") {
    return fail(
      `codex PreToolUse enforcement NOT proven UNDER BYPASS: with ` +
        `permission_mode="bypassPermissions" — the mode the flag itself puts the pane in — ` +
        `the bridge answered ` +
        `${bypassed.decision === null ? "no parseable PreToolUse response" : `"${bypassed.decision}"`} ` +
        `(exit ${String(bypassed.status)}) for an out-of-scope tool call. That is this project's ` +
        `bypass_permissions_policy talking: the default "audit" records and ALLOWS. Set ` +
        `bypass_permissions_policy=deny (or run under a non-interactive autonomy mode, which ` +
        `forces it) to earn the flag. Codex panes launch BARE.`,
    );
  }
  checks.deny_under_bypass = true;

  return {
    enforced: true,
    manifest: manifestPath,
    detail:
      `codex PreToolUse enforcement PROVEN: ${manifestPath} registers ${script} (and no ` +
      `non-Guild hook), which exited 0 emitting permissionDecision:"deny" for an ` +
      `out-of-scope tool call — including under permission_mode="bypassPermissions".`,
    checks,
  };
}

/**
 * Parse a hook's stdout into its PreToolUse decision. STRICT by design: the
 * whole output must be one JSON object carrying a PreToolUse
 * `hookSpecificOutput`. A substring scan would let an unrelated log line
 * mentioning `"permissionDecision":"deny"` masquerade as a verdict.
 * Returns null when nothing valid is present.
 */
function parsePreToolUseDecision(stdout: string): string | null {
  const text = stdout.trim();
  if (text.length === 0) return null;
  try {
    const parsed = JSON.parse(text) as {
      hookSpecificOutput?: { hookEventName?: string; permissionDecision?: string };
    };
    const out = parsed.hookSpecificOutput;
    if (!out || out.hookEventName !== "PreToolUse") return null;
    return typeof out.permissionDecision === "string" ? out.permissionDecision : null;
  } catch {
    return null;
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
  /** ISSUE #94 — opt-in bypass argv; see AdapterOpts.codexLaunchArgs. Default []. */
  private codexLaunchArgs: string[];
  /** ISSUE #94 — the target project whose policy the probe judges. */
  private projectCwd: string | undefined;

  constructor(opts: AdapterOpts = {}) {
    this.run = opts.run ?? defaultRun;
    this.env_ = opts.env ?? process.env;
    this.fs_ = opts.fs ?? nodefs;
    this.codexLaunchArgs = opts.codexLaunchArgs ?? [];
    this.projectCwd = opts.projectCwd;
  }

  /**
   * ISSUE #94 — is codex-side PreToolUse deny enforcement PROVEN on this box?
   * Exposed so a caller can record the verdict (pass or fail) in a run trace
   * rather than only observing its effect on the launch command.
   */
  /**
   * ISSUE #94 — a copy of this adapter carrying `args` as its opt-in bypass
   * argv. The resolver is built once, at launcher start, where the project's
   * `RuntimePermissionConfig` is not in hand; the per-pane composer HAS it. So
   * the argv is applied here, at compose time, from the same resolved host_mode
   * ladder Claude panes use — rather than baked in from the defaults and
   * described as if it were configured.
   */
  withLaunchArgs(args: string[], projectCwd?: string): CodexPaneAdapter {
    return new CodexPaneAdapter({
      run: this.run,
      env: this.env_,
      fs: this.fs_,
      codexLaunchArgs: args,
      ...(projectCwd !== undefined ? { projectCwd } : {}),
      ...(this.projectCwd !== undefined && projectCwd === undefined
        ? { projectCwd: this.projectCwd }
        : {}),
    });
  }

  probeEnforcement(): CodexEnforcementProbeResult {
    return probeCodexPreToolUseEnforcement({
      env: this.env_,
      fs: this.fs_,
      run: this.run,
      ...(this.projectCwd !== undefined ? { cwd: this.projectCwd } : {}),
    });
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
    //
    // ISSUE #94 — CODEX-SIDE PreToolUse ENFORCEMENT IS NOW WIRED, and the pane
    // bypass flag is gated on PROVEN enforcement. This closes the rf-wi-04 (G4)
    // followup that deliberately left a codex pane bare.
    //
    // What landed (the 4 preconditions rf-wi-04 named, in order):
    //   (a) ON-BOX CONFIRMED (codex-cli 0.146.0, isolated CODEX_HOME): a
    //       PreToolUse hook returning permissionDecision:"deny" blocks the tool
    //       call ("hook: PreToolUse Blocked"); the control run executed.
    //   (b) The codex capability rows now record hooks.pre_tool_use: true and
    //       permissions.deny: true (host-capabilities-schema.ts). `ask_mode`
    //       stays null — codex has a deny layer but NO ask primitive.
    //   (c) writeCodexHookBridge registers PreToolUse -> hooks/dist/pre-tool-use.js
    //       and ships that binary. It is Guild's EXISTING enforcement binary, not
    //       a codex-only fork: codex's PreToolUse payload is the same snake_case
    //       shape pre-tool-use.ts already consumes, and its HK-07 gate degrades
    //       ask -> approval_request + deny, which is exactly what codex enforces.
    //   (d) probeCodexPreToolUseEnforcement() gates the bypass flag below.
    //
    // WHY THE PROBE EXECUTES RATHER THAN STATS. Codex gates hooks behind
    // persisted hook trust: on-box, an untrusted-but-present hook SILENTLY never
    // ran and the tool executed, with no warning. File presence is a false
    // positive here, so the probe demands an observed deny.
    //
    // TWO GATES, both required, mirroring RemoteTeamBackend.claudeLaunchArgs:
    // an explicit operator opt-in AND a passing probe. Default stays BARE.
    //
    // AND THE HOOK-TRUST COUPLING. The probe proves the BRIDGE enforces; it
    // cannot prove codex will RUN it. Hook trust is granted through an
    // interactive prompt and persisted nowhere the CLI exposes — `codex doctor
    // --json` (0.146.0) reports install/config/auth health and says nothing
    // about hooks, and no trust store is discoverable on disk. On-box, the same
    // hooks.json without trust meant the hook never fired, silently, and the
    // command ran. A bypass flag on such a pane is precisely the regression this
    // issue exists to prevent, so the two flags ship TOGETHER: a codex pane that
    // is granted the sandbox bypass also runs Guild's gate rather than silently
    // skipping it for want of trust.
    // The extra flag's own cost — other enabled hooks in that CODEX_HOME also
    // run untrusted — is contained by the probe's sole_owner check, which
    // withholds the whole grant when any manifest codex loads registers a hook
    // outside Guild's plugin root. It never appears on a pane that is not
    // being bypassed.
    //
    // THIRD GATE — the pane must have something to enforce. `capability_scope`
    // is optional, and an absent scope means "no tool restrictions": the bridge
    // then falls through cleanly and denies nothing. Bypassing native approval
    // on such a pane trades a real gate for no gate, so an unscoped pane never
    // receives the flag however green the probe is.
    const scoped = (spec.capability_scope?.length ?? 0) > 0;
    const bypassGranted =
      this.codexLaunchArgs.length > 0 && scoped && this.probeEnforcement().enforced;
    const bypassFragment = bypassGranted
      ? `${[...this.codexLaunchArgs, CODEX_HOOK_TRUST_FLAG].map(shellQuote).join(" ")} `
      : "";
    const taskFragment =
      spec.taskId ? `export GUILD_TASK_ID=${shellQuote(spec.taskId)}; ` : "";
    // G-9 / C2-D1: GUILD_SPECIALIST arms the PostToolUse heartbeat writer
    // (lane panes only; Codex panes run no Claude PostToolUse hook — the wired
    // codex events are SessionStart, UserPromptSubmit and, since issue #94,
    // PreToolUse — but the env parity keeps the heartbeat contract uniform
    // across adapters).
    const specialistFragment =
      spec.specialist ? `export GUILD_SPECIALIST=${shellQuote(spec.specialist)}; ` : "";
    const scopeFragment =
      spec.capability_scope !== undefined
        ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(spec.capability_scope))}; `
        : "";
    // ISSUE #94 — the PreToolUse bridge resolves the host from the environment it
    // inherits. Without this a codex pane's gate read as Claude, decided `ask`,
    // and codex — which has no ask primitive — enforced nothing. Codex's
    // SessionStart wiring runs update-check, not the bootstrap that writes the
    // capability manifest, so the identity has to come from the pane itself.
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      `export GUILD_HOST=codex-cli; export GUILD_HOST_ID=codex-cli; ` +
      producerMarkerExport() +
      taskFragment +
      specialistFragment +
      taskAssignmentExport(spec) +
      scopeFragment +
      modelExport(spec) +
      `codex exec ${bypassFragment}${modelArg(spec, "-m")}${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      // ISSUE #94 — keep env() in step with command(): the PreToolUse bridge
      // resolves the codex capability row from these.
      GUILD_HOST: "codex-cli",
      GUILD_HOST_ID: "codex-cli",
      ...modelEnv(spec),
      ...producerMarkerEnv(),
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
      producerMarkerExport() +
      taskFragment + specialistFragment + taskAssignmentExport(spec) + scopeFragment +
      modelExport(spec) +
      `agy ${modelArg(spec, "--model")}${AGY_PROMPT_FLAG} ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      ...modelEnv(spec),
      ...producerMarkerEnv(),
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
      producerMarkerExport() +
      taskFragment + specialistFragment + taskAssignmentExport(spec) + scopeFragment +
      modelExport(spec) +
      `pi ${modelArg(spec, "--model")}-p ${shellQuote(spec.prompt)}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      ...modelEnv(spec),
      ...producerMarkerEnv(),
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

// ── WrappedCliPaneAdapter (generic, registry-parameterized — G4b) ────────────

/**
 * Generic PaneAdapter for a "plain wrapped-CLI" registry row — ONE implementation
 * parameterized by the host's `HostRegistryEntry` (detection.bin/subcommand,
 * capabilities.permissions.launch_modes) instead of a bespoke per-host file.
 * `buildAdapters()` constructs one of these for every `adapter_binding:"self"`,
 * `surface_kind:"cli"`, `dispatch_selectable:true` registry row that has no bespoke
 * class above (today: cursor, github-copilot, opencode, rovo-dev).
 *
 * Invocation shape: `<bin> [subcommand] -p '<prompt>'` — the same non-interactive
 * print-mode convention already LIVE-VALIDATED for pi/antigravity (PiPaneAdapter /
 * AntigravityPaneAdapter), not a fresh per-host guess. `subcommand` covers the two
 * hosts whose capability is a subcommand of a shared bin (github-copilot → `gh
 * copilot`, rovo-dev → `acli rovodev`); absent for cursor/opencode (their own bin).
 *
 * `capabilities.permissions.launch_modes` is read (not hardcoded) so a future
 * live-verified row that fills in real launch-mode argv flows through with zero
 * adapter-code change — every current wrapped-CLI row ships that block empty
 * (INFERRED/off-box), so `launchModeArgs()` returns `[]` today.
 *
 * INFERRED posture (provenance:"inferred" on every row this adapter serves):
 * `preflight()` only checks the binary (+ subcommand) responds to `--version` — it
 * does NOT gate on `detection.requires_auth` (the registry's `auth_probe` is a
 * detection-time signal for `guild-run`/team-compose availability checks, not
 * something this adapter re-implements); a host that actually needs auth will fail
 * at spawn time with its own error, which is no worse than the pre-fix state where
 * the host could not be dispatched to AT ALL.
 */
export class WrappedCliPaneAdapter implements PaneAdapter {
  readonly hostKind: HostKind;
  readonly adapterVersion = ADAPTER_VERSION;
  private run: RunFn;
  private readonly bin: string;
  private readonly subcommand: string | null;
  private readonly requiresAuth: boolean;

  constructor(row: HostRegistryEntry, hostKind: HostKind, opts: AdapterOpts = {}) {
    if (!row.detection.bin) {
      throw new Error(
        `WrappedCliPaneAdapter: registry row "${row.host_id}" has no detection.bin — ` +
          `a "self"-bound CLI adapter requires one (an agents-file row should never reach here).`
      );
    }
    this.hostKind = hostKind;
    this.run = opts.run ?? defaultRun;
    this.bin = row.detection.bin;
    this.subcommand = row.detection.subcommand ?? null;
    this.requiresAuth = row.detection.requires_auth;
  }

  private argvPrefix(): string[] {
    return this.subcommand ? [this.subcommand] : [];
  }

  private display(): string {
    return this.subcommand ? `${this.bin} ${this.subcommand}` : this.bin;
  }

  preflight(): PreflightResult {
    // Probe shape mirrors the install-detection SoT: subcommand hosts are
    // probed as `<bin> <subcommand> --help` (a wrapper subcommand like
    // `gh copilot` or `acli rovodev` may not implement --version), bare CLIs
    // as `<bin> --version`.
    const probeArgs = this.subcommand ? [this.subcommand, "--help"] : ["--version"];
    const r = this.run(this.bin, probeArgs);
    if (r.status !== 0) {
      return {
        ok: false,
        message:
          `\`${this.display()}\` not found or not runnable (${this.display()} ${probeArgs[probeArgs.length - 1]} failed). ` +
          `Install it and ensure \`${this.bin}\` is on PATH.` +
          (this.requiresAuth
            ? ` This host also requires its own auth (registry auth_probe) — sign in before dispatching a lane here.`
            : ""),
      };
    }
    return {
      ok: true,
      message:
        `${this.display()} ${probeArgs[probeArgs.length - 1]} ok` +
        (this.requiresAuth
          ? ` — NOTE: this host requires auth (registry auth_probe); the probe verifies the binary, not the session. An unauthenticated CLI will fail at lane spawn.`
          : ""),
    };
  }

  command(spec: PaneSpec): string {
    const taskFragment = spec.taskId ? `export GUILD_TASK_ID=${shellQuote(spec.taskId)}; ` : "";
    const specialistFragment = spec.specialist ? `export GUILD_SPECIALIST=${shellQuote(spec.specialist)}; ` : "";
    const scopeFragment = spec.capability_scope !== undefined
      ? `export GUILD_CAPABILITY_SCOPE=${shellQuote(JSON.stringify(spec.capability_scope))}; ` : "";
    // No verified model flag for a generic wrapped CLI → GUILD_MODEL only; the
    // host resolves its own model. Never invent a flag onto an unprobed binary.
    // opencode: `-p` is silently ignored and the TUI opens (VERIFIED 2026-07-30,
    // opencode 1.18.5 — issue #104); its non-interactive form is `run '<prompt>'`.
    const promptArgs =
      this.hostKind === "opencode" ? ["run", shellQuote(spec.prompt)] : ["-p", shellQuote(spec.prompt)];
    const argv = [this.bin, ...this.argvPrefix(), ...promptArgs].join(" ");
    return (
      `export GUILD_RUN_ID=${shellQuote(spec.runId)}; ` +
      producerMarkerExport() +
      taskFragment + specialistFragment + taskAssignmentExport(spec) + scopeFragment +
      modelExport(spec) +
      `${argv}; ` +
      `exec $SHELL`
    );
  }

  env(spec: PaneSpec): Record<string, string> {
    return {
      GUILD_RUN_ID: spec.runId,
      ...modelEnv(spec),
      ...producerMarkerEnv(),
      ...(spec.specialist ? { GUILD_SPECIALIST: spec.specialist } : {}),
      ...(spec.taskId ? { GUILD_TASK_ID: spec.taskId } : {}),
      ...(spec.capability_scope !== undefined
        ? { GUILD_CAPABILITY_SCOPE: JSON.stringify(spec.capability_scope) } : {}),
      ...taskAssignmentEnv(spec),
    };
  }

  /** No Claude hooks on any wrapped CLI → file-bus receipts + approvals only. */
  expectedOutputs(): Array<"heartbeat" | "handoff_receipt" | "approval_request"> {
    return ["handoff_receipt", "approval_request"];
  }
}

// ── Adapter registry + resolver ───────────────────────────────────────────────

/**
 * Build the `host_kind` → adapter map. Constructed per call so test seams (run /
 * env overrides) propagate to every adapter. A future BESPOKE host adds one row
 * here; a future PLAIN wrapped-CLI host needs no edit at all (see the generic loop
 * below).
 *
 * Wired Rung-1 (tmux CLI pane) bespoke adapters: claude + codex (reference,
 * live-validated) and antigravity-2 + pi (also LIVE-VALIDATED 2026-06-14 — see
 * each class's own STATUS comment). Gemini was discarded 2026-06-14 (sunset in
 * favour of Antigravity). claude-code-desktop/web, codex-app, and the claude.ai
 * connector are NOT Rung-1 tmux panes — different substrate/dispatch surfaces
 * (host-adapter-contract.md Surface 8 ladder), so they never get a PaneAdapter.
 *
 * G4b — the generic loop: every registry row (host-registry-schema.ts) that is
 * `adapter_binding:"self"`, `surface_kind:"cli"`, `dispatch_selectable:true`, AND
 * resolves to a HostKind (registryIdToCanonicalHostKind) with no bespoke adapter
 * already registered above gets a `WrappedCliPaneAdapter`. `resolveAdapter` throws
 * on an unregistered key.
 */
export function buildAdapters(opts: AdapterOpts = {}): Partial<Record<HostKind, PaneAdapter>> {
  const adapters: Partial<Record<HostKind, PaneAdapter>> = {
    claude: new ClaudePaneAdapter(opts),
    codex: new CodexPaneAdapter(opts),
    "antigravity-2": new AntigravityPaneAdapter(opts),
    pi: new PiPaneAdapter(opts),
  };
  for (const id of HOST_IDS) {
    const row = HOST_REGISTRY_ROWS[id];
    if (row.adapter_binding !== "self" || row.surface_kind !== "cli" || !row.dispatch_selectable) {
      continue;
    }
    const hostKind = registryIdToCanonicalHostKind(id);
    if (!hostKind || adapters[hostKind]) continue; // no HostKind surface, or already bespoke
    adapters[hostKind] = new WrappedCliPaneAdapter(row, hostKind, opts);
  }
  return adapters;
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
