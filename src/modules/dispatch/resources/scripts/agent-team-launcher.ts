#!/usr/bin/env -S npx tsx
/**
 * scripts/agent-team-launcher.ts
 *
 * Launches Claude Code's experimental agent-team backend in tmux: one pane per
 * specialist listed in .guild/team/<slug>.yaml. The orchestrator (main Claude
 * Code) runs in the first pane; each specialist runs in its own pane with
 * CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 exported, per guild-plan.md §7.3
 * (agent-team backend is opt-in, requires the env var, one team per session).
 *
 * Two launch modes, selected automatically by whether we are already inside a
 * tmux session ($TMUX env var):
 *   - new-session  ($TMUX unset): create a detached session, build the panes,
 *                  then attach the terminal to it.
 *   - in-session   ($TMUX set):   create a NEW WINDOW in the CURRENT session and
 *                  build the panes inside that window, then select it so the
 *                  team is visible. The operator's currently-active pane is
 *                  never split, and no existing pane/window is ever killed.
 * Both modes share the per-pane command/env construction (paneCommand) and the
 * specialist-splitting loop (composeTmuxCommands) so they cannot drift.
 *
 * Called by guild:execute-plan when team.yaml declares backend: agent-team.
 *
 * Usage:
 *   agent-team-launcher --team <path> [--session-name <name>] [--cwd <path>] [--dry-run]
 *
 * Options:
 *   --team <path>          (required) Path to .guild/team/<slug>.yaml.
 *   --session-name <name>  (optional, default: guild-<slug>-<timestamp>)
 *   --cwd <path>           (optional, default ".") Consuming repo root.
 *   --dry-run              (optional) Print tmux commands without executing.
 *
 * Exit codes:
 *   0  Success.
 *   1  Precondition failure (missing args, wrong backend, tmux missing,
 *      session-name collision, or — in-session — team-window collision).
 *   2  tmux command failure while creating the real session/window.
 *
 * Invariants:
 *   - Never writes to .guild/wiki/ (forbidden per tooling-engineer scope).
 *   - One team per session: when $TMUX is set we spawn the team in a NEW window
 *     of the current session (never a nested session) and refuse to clobber an
 *     existing team window of the same name.
 *   - Only auto-runs when team.yaml explicitly declares backend: agent-team.
 *   - All writes stay under <cwd>/.guild/runs/<run-id>/agent-team/.
 *   - --dry-run is always safe: it prints tmux commands + writes session.json
 *     but never invokes tmux.
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
// RE-4: the tmux spawn logic now lives behind the TeamBackend seam. The
// launcher is the CLI front-end (arg parse + D5 ladder + collision UX +
// manifest + attach) and delegates compose/probe/spawn to TmuxTeamBackend.
// See scripts/lib/team-backend.ts and the §RE-4 contract pointer there.
import {
  TmuxTeamBackend,
  RemoteTeamBackend,
  SshRemoteTransport,
  InProcessTeamBackend,
  probeTmuxAvailable,
  shellQuote,
  type Specialist,
  type LaunchMode,
  type HostKind,
  type RemoteHostTarget,
} from "./lib/team-backend";
// P1-3 A2a/A2b: dismissible detection + force-reap of dead panes.
import {
  detectDismissible,
  reapDeadMembers,
  sessionJsonPath,
  listRunnableRunIds,
} from "./lib/reaping";
// CH-1/CH-2: mixed-host pane adapters (claude + codex) for a mixed `host:` team.
import { resolveAdapter } from "./lib/pane-adapter";
// CH-1: route each specialist to its backend (local tmux vs remote) via the
// CR-1 routing function, reading guild.host_capability.v1 manifests.
import { planTeamRouting, RouteError, type RoutableHost } from "./lib/host-router";
import { normalizeHostId, registryIdToCanonicalHostKind, hostKindToRegistryId } from "./lib/host-id-namespace";
// W4 D1: registry-bridge predicates replace `=== "claude"` / `=== "codex"` / `=== "pi"` literals.
import { isClaudeCli } from "./lib/capability/rank";
// U5: typed settings projection via the resolver (replaces direct settings slice reads)
import { resolveSettings, isPlainObject } from "./lib/settings-resolver";
import {
  buildTaskAssignment,
  writeTaskAssignment,
} from "../src/modules/dispatch/workflows/task-assignment";
// R-016a: bounded retry for the ONE TS-level dispatch call site (RemoteTeamBackend.launch).
import { runWithRetry, loadRetryOpts } from "./retry-lane";
// R-016 bridge: on retry exhaustion, mark each remote lane dead via the shared writer.
// TE-03/EDIT-2: upsertLane persists per-lane routing decision into run-state.
import { markLaneDead, upsertLane, type RunStateInit } from "../hooks/lib/run-state";
// C4 (G-PHASE-COMPOSE): slugFromTeamPath now lives in team-file.ts (the inverse of
// teamFilePath) so it tolerates the <slug>.<phase>.yaml basename + is unit-tested there.
// resolveDeadLaneKeys (R-016 SSH lane-key fix): joins specialist→plan task-id so the
// SSH dead-lane checkpoint is keyed identically to the resume reader + execute-plan.
// readPlanOwnerTaskIds (TE-03): used in onDecision to map specialist name → plan task-id(s)
// without the name-key fallback that resolveDeadLaneKeys adds (that fallback is right for
// SSH dead-lanes but violates the contract for run-state keying).
import { slugFromTeamPath, resolveDeadLaneKeys, readPlanOwnerTaskIds } from "./lib/team-file";
// TE-01 CONSOLIDATED (cluster-a-rev2-CONSOLIDATED.md): launcher owns EDIT-3 (tmux/remote);
// execute-plan SKILL owns EDIT-4 (subagent/in-process) — mutually exclusive, no double-write.
import { writeTaskRun, readTaskRunCapReqs } from "./write-task-run";
import { emitReadbackDegradation } from "./lib/emit-readback-degradation"; // W2-A2(d)

const ADAPTER_VERSION = "1"; // CH-5 — PaneAdapter version recorded per pane.

// ── Types ──────────────────────────────────────────────────────────────────

interface TeamYaml {
  backend: string;
  specialists: Specialist[];
}

interface CliArgs {
  team: string | null;
  sessionName: string | null;
  cwd: string;
  dryRun: boolean;
  /** Explicit agent_mode override (D5). null = not provided → use team.yaml backend check (old behavior). */
  agentMode: "team" | "agent" | "subagent" | "auto" | null;
  /**
   * P1-3 A2b: force-reap dead members from the team registry.
   * When set, skip the normal launch path and run reapDeadMembers for the
   * specified run (--run-id) or all runs under <cwd>/.guild/runs/ that have a
   * session.json.  Exits 0 on completion.
   */
  reap: boolean;
  /**
   * P1-3: explicit run ID (used with --reap or future ops).
   * null = not provided; callers may default to scanning all runs.
   */
  runId: string | null;
  /**
   * P1-4: dismiss lanes with a valid handoff receipt (auto-dismiss loop).
   * When set, requires --run-id. Reads teammates from the run's session.json,
   * calls detectDismissible, and prints a machine-readable DISMISS line per
   * dismissible lane. Falls through to reapDeadMembers for cleanup.
   * Always exits 0 (maintenance op).
   */
  dismissCompleted: boolean;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

const VALID_AGENT_MODE_VALUES = new Set(["team", "agent", "subagent", "auto"]);

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    team: null,
    sessionName: null,
    cwd: ".",
    dryRun: false,
    agentMode: null,
    reap: false,
    runId: null,
    dismissCompleted: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team" && i + 1 < argv.length) out.team = argv[++i];
    else if (a === "--session-name" && i + 1 < argv.length) out.sessionName = argv[++i];
    else if (a === "--cwd" && i + 1 < argv.length) out.cwd = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reap") out.reap = true;
    else if (a === "--dismiss-completed") out.dismissCompleted = true;
    else if (a === "--run-id" && i + 1 < argv.length) out.runId = argv[++i];
    else if (a.startsWith("--agent-mode=")) {
      const v = a.slice("--agent-mode=".length);
      if (VALID_AGENT_MODE_VALUES.has(v)) out.agentMode = v as CliArgs["agentMode"];
    }
  }
  return out;
}

// ── Minimal YAML parser for our known schema ───────────────────────────────
//
// team.yaml is authored by guild:team-compose with a fixed shape: scalar
// top-level keys (`backend`, `allow_larger`, `spec`, …) and a `specialists:`
// list of inline-or-block maps with `name`, `scope`, `depends-on`. Rather
// than pull in js-yaml as a direct dep, we parse the narrow schema by hand
// and reject anything surprising.

function parseYaml(raw: string): TeamYaml {
  const lines = raw.split(/\r?\n/);
  let backend = "";
  const specialists: Specialist[] = [];
  let inSpecialists = false;
  let cur: Partial<Specialist> | null = null;

  const flush = () => {
    if (cur && cur.name) {
      specialists.push({
        name: cur.name,
        scope: cur.scope ?? "",
        dependsOn: cur.dependsOn ?? [],
        backend: cur.backend,
        host_kind: cur.host_kind,
        // ARCH-6 Part 1: tier precedence — scored `tier:` (Part 2, execute-plan) >
        // authoring `default_tier:` (team-compose) > undefined (opts.tier mid fallback).
        // This ensures generated teams (default_tier only) route at their roster tier,
        // not collapse to mid. Scored tier wins when execute-plan writes it.
        tier: cur.tier ?? cur.default_tier,
        capabilityRequirements: cur.capabilityRequirements, // GAP-A1/ARCH-2 (may be undefined)
        // D-CAP: thread capability_scope onto the Specialist — undefined when absent
        // (no restrictions). Populated by applyMapEntry + block-list interceptor above.
        capability_scope: cur.capability_scope,
        // Agent-definition path + source (team-compose writes them; load-bearing
        // for project-local specialists — buildPrompt embeds the adoption
        // instruction and in-process dispatch swaps to the generic subagent type).
        definition: cur.definition,
        definition_source: cur.definition_source,
      });
    }
    cur = null;
  };

  for (const rawLine of lines) {
    // Strip comments outside of quoted strings. Team yaml scope values may
    // contain colons but never unquoted `#`, so this is safe for our schema.
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;

    // Top-level keys (no leading indentation).
    if (!/^\s/.test(line)) {
      flush();
      inSpecialists = false;
      const m = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim();
      if (key === "specialists") {
        inSpecialists = true;
      } else if (key === "backend") {
        backend = stripQuotes(value);
      }
      continue;
    }

    if (!inSpecialists) continue;

    // List item opener:  "  - name: architect"
    //
    // D-CAP block-list intercept: if the current specialist has started
    // collecting capability_scope items (sentinel = []) AND this dash-line
    // carries a bare string (no key:value colon), it is a block list item for
    // capability_scope — NOT the start of a new specialist. Append and continue.
    //
    // The distinction: "  - name: foo" (key:value) → new specialist.
    //                  "      - "Read"" (bare string) → block list item.
    // Guard: /^[A-Za-z0-9_-]+\s*:/ matches any valid YAML key followed by colon.
    // Tool names like "Read", "Write", "Edit" never contain a colon, so they
    // safely fall through to the block-list path.
    const itemMatch = /^\s+-\s+(.*)$/.exec(line);
    if (itemMatch) {
      const rest = itemMatch[1];
      if (cur && Array.isArray(cur.capability_scope) && !/^[A-Za-z0-9_-]+\s*:/.test(rest)) {
        // Block list item for capability_scope — append, do NOT flush.
        cur.capability_scope.push(stripQuotes(rest));
        continue;
      }
      flush();
      cur = {};
      applyMapEntry(cur, rest);
      continue;
    }

    // Continuation of current map item: "    scope: …"
    if (cur && /^\s+\S/.test(line)) {
      const content = line.replace(/^\s+/, "");
      applyMapEntry(cur, content);
    }
  }
  flush();

  if (!backend) {
    throw new Error("team.yaml missing required top-level `backend:` key");
  }
  return { backend, specialists };
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function applyMapEntry(target: Partial<Specialist>, raw: string): void {
  const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
  if (!m) return;
  const key = m[1];
  const value = m[2].trim();
  if (key === "name") target.name = stripQuotes(value);
  else if (key === "scope") target.scope = stripQuotes(value);
  else if (key === "depends-on" || key === "depends_on" || key === "dependsOn") {
    target.dependsOn = parseFlowList(value);
  } else if (key === "backend") target.backend = stripQuotes(value);
  // Agent-definition path (team-compose writes it): `.guild/agents/<role>.md`
  // for project-local specialists (load-bearing), `agents/<role>.md` for
  // shipped ones (informational).
  // Only the explicit `definition_source` key is accepted — a generic `source:`
  // is common provenance metadata and must never silently change dispatch
  // semantics (codex G-lane finding).
  else if (key === "definition") target.definition = stripQuotes(value);
  else if (key === "definition_source") {
    const v = stripQuotes(value).trim().toLowerCase();
    if (v === "shipped" || v === "project") {
      target.definition_source = v as "shipped" | "project";
    }
  }
  // CH-1: per-specialist `host:` brand. Only the known brands are accepted; an
  // unknown value is ignored (the pane defaults to the orchestrator host,
  // claude), keeping the parser lenient like the rest of the known schema.
  else if (key === "host" || key === "host_kind") {
    const hk = parseHostKind(value);
    if (hk) target.host_kind = hk;
  }
  // ARCH-6: per-specialist scored tier — explicit `tier:` key written by
  // execute-plan Part 2 (highest-scored override across the specialist's lanes).
  else if (key === "tier") {
    const t = stripQuotes(value).trim().toLowerCase();
    if (t === "cheap" || t === "mid" || t === "powerful") {
      target.tier = t as "cheap" | "mid" | "powerful";
    }
  }
  // ARCH-6 Part 1: `default_tier:` is what guild:team-compose writes at authoring time.
  // Parsed into a SEPARATE field so flush() can apply tier ?? default_tier precedence.
  else if (key === "default_tier") {
    const t = stripQuotes(value).trim().toLowerCase();
    if (t === "cheap" || t === "mid" || t === "powerful") {
      target.default_tier = t as "cheap" | "mid" | "powerful";
    }
  }
  // GAP-A1/ARCH-2: capability requirements from team.yaml, forwarded by
  // planTeamRouting into route()'s capabilityGap() intersection (true round-trip:
  // same object feeds both the route decision AND the task_run writer).
  else if (key === "needs_parallel" || key === "needs-parallel") {
    target.capabilityRequirements = {
      ...target.capabilityRequirements,
      needs_parallel: stripQuotes(value).trim() === "true",
    };
  } else if (key === "needs_pr" || key === "needs-pr") {
    target.capabilityRequirements = {
      ...target.capabilityRequirements,
      needs_pr: stripQuotes(value).trim() === "true",
    };
  } else if (key === "needs_network" || key === "needs-network") {
    target.capabilityRequirements = {
      ...target.capabilityRequirements,
      needs_network: stripQuotes(value).trim() === "true",
    };
  } else if (key === "isolation" && !target.capabilityRequirements?.isolation) {
    // Only parsed as capability requirement if not already set by `host:` parsing.
    const iv = stripQuotes(value).trim().toLowerCase();
    if (iv === "worktree" || iv === "none") {
      target.capabilityRequirements = {
        ...target.capabilityRequirements,
        isolation: iv as "worktree" | "none",
      };
    }
  }
  // D-CAP (Wave-3): per-specialist tool allow-list. Supports both YAML shapes
  // team-compose may emit:
  //   Block list (team-compose/SKILL.md §"Capability scope defaults"):
  //     capability_scope:
  //       - "Read"
  //       - "Write"
  //   Flow list (inline):
  //     capability_scope: ["Read", "Write"]
  // Block list: this call sets the sentinel [] — the YAML block items (`- "Read"`)
  // are appended by the block-list interceptor in parseYaml (they match the list-
  // item opener regex before reaching the continuation handler, so applyMapEntry
  // never sees them directly).
  else if (key === "capability_scope") {
    if (value.startsWith("[")) {
      // Flow list: parse inline.
      target.capability_scope = parseFlowList(value);
    } else {
      // Block list sentinel: items follow as `- "item"` lines, parsed by parseYaml.
      target.capability_scope = [];
    }
  }
}

/** Collapse the app/web/desktop/connector registry HostKinds onto their bare
 * family HostKind ("claude"/"codex") — the same collapse the old hand-typed
 * literal table applied. Shared by both resolution paths below. */
function collapseAppVariant(registryKind: HostKind | null): HostKind | null {
  if (!registryKind) return null;
  if (
    registryKind === "claude-code-desktop" ||
    registryKind === "claude-code-web" ||
    registryKind === "claude-ai-connector"
  ) {
    return "claude";
  }
  if (registryKind === "codex-app") return "codex";
  return registryKind;
}

/**
 * STRICT registry-bridge resolution (`normalizeHostId` + `registryIdToCanonicalHostKind`):
 * exact registry id or exact legacy alias only, NO prefix fuzz. DERIVED from the
 * registry instead of a private per-host literal list — G4b (host-reachability
 * fix): a NEW registry host (cursor/github-copilot/opencode/rovo-dev) resolves
 * through this same path with ZERO launcher edits (their canonical HostKind
 * literal is their registry host_id; see host-id-namespace.ts
 * HOSTKIND_TO_REGISTRY_ID). Used by `parseHostKind` (team.yaml per-specialist
 * `host:`), which must REJECT an operator typo (e.g. "claudee") rather than
 * silently collapsing it onto a real host — `normalizeHostId` is deliberately
 * strict for exactly this reason (see its own doc comment).
 */
function resolveHostKindStrict(value: string): HostKind | null {
  const normalized = normalizeHostId(value);
  const registryKind = normalized ? registryIdToCanonicalHostKind(normalized) : null;
  return collapseAppVariant(registryKind);
}

/**
 * TOLERANT registry-bridge resolution: additionally rescues an unrecognized
 * `claude-*`/`codex-*`/`antigravity*` variant via `hostKindToRegistryId`'s
 * prefix-collapse (host-id-namespace.ts PREFIX_COLLAPSE, byte-aligned with
 * provider-detect.ts resolveAuthorHost()) plus a supplemental "pi" prefix check
 * this launcher has always applied (broader than the shared prefix table, which
 * intentionally excludes "pi"). Used ONLY by `paneHostKindForStartingHost`
 * (GUILD_ORCHESTRATOR_HOST/GUILD_HOST env-var resolution), which has always been
 * more forgiving than team.yaml parsing — NOT applied to `parseHostKind`.
 */
function resolveHostKindTolerant(value: string): HostKind | null {
  const strict = resolveHostKindStrict(value);
  if (strict) return strict;
  const registryId = hostKindToRegistryId(value);
  const registryKind = registryId ? registryIdToCanonicalHostKind(registryId) : null;
  const collapsed = collapseAppVariant(registryKind);
  if (collapsed) return collapsed;
  if (value.toLowerCase().startsWith("pi")) return "pi";
  return null;
}

function parseHostKind(value: string): HostKind | undefined {
  const v = stripQuotes(value).trim().toLowerCase();
  return resolveHostKindStrict(v) ?? undefined;
}

function paneHostKindForStartingHost(value: string | undefined): HostKind | null {
  const raw = (value ?? "").trim();
  if (!raw) return "claude";
  return resolveHostKindTolerant(raw);
}

function resolveOrchestratorHostKind(env: NodeJS.ProcessEnv = process.env): HostKind | null {
  return paneHostKindForStartingHost(
    env["GUILD_ORCHESTRATOR_HOST"] ?? env["GUILD_HOST_ID"] ?? env["GUILD_HOST"]
  );
}

function parseFlowList(value: string): string[] {
  const t = value.trim();
  if (!t || t === "[]") return [];
  if (t.startsWith("[") && t.endsWith("]")) {
    return t
      .slice(1, -1)
      .split(",")
      .map((s) => stripQuotes(s.trim()))
      .filter(Boolean);
  }
  return [];
}

// ── tmux command composition ───────────────────────────────────────────────
//
// buildPrompt / paneCommand / shellQuote / composeTmuxCommands and the tmux
// probes (availability, session/window collision, current-session name) moved
// to scripts/lib/team-backend.ts (RE-4) and are reached through a single
// `tmux` TmuxTeamBackend instance in main(). slugFromTeamPath stays here — it
// is CLI-path parsing, not tmux behavior.

// slugFromTeamPath moved to scripts/lib/team-file.ts (C4) — imported above. It is
// the inverse of teamFilePath and tolerates the per-phase `<slug>.<phase>.yaml`
// basename. Kept out of this file so it is unit-testable without the launcher's
// hooks-heavy import chain (run-state's transitive .js imports break ts-jest).

// ── Manifest write ─────────────────────────────────────────────────────────

interface Manifest {
  run_id: string;
  mode: LaunchMode;
  session_name: string;
  // Non-null only in in-session mode: the window we created in the current
  // session. Null in new-session mode (the whole session is ours).
  window_name: string | null;
  created_at: string;
  orchestrator_host_kind: HostKind;
  orchestrator_pane_id: string;
  // CH-5: `host_kind` + `adapter_version` are additive optional per-pane fields
  // under the lenient-reader rule (no schema_version bump). Existing readers
  // ignore them; resume/telemetry read host_kind from here rather than
  // re-inferring the CLI brand.
  // D-CAP: `capability_scope` is additive + optional (same lenient-reader rule).
  // Absent ⇒ no tool restrictions. Populated from Specialist.capability_scope
  // (parsed from team.yaml's `capability_scope:` block list). Used by the
  // injection half (paneCommand / composeInProcessDispatch) pending the
  // env-propagation spike (Wave-3 Step 2).
  teammate_panes: Array<{
    specialist: string;
    pane_id: string;
    host_kind: HostKind;
    adapter_version: string;
    capability_scope?: string[];
  }>;
  env: Record<string, string>;
}

function buildManifest(opts: {
  runId: string;
  mode: LaunchMode;
  // Session name (new-session) or the resolved current session (in-session).
  sessionName: string;
  // Window name — only set in in-session mode.
  windowName: string | null;
  specialists: Specialist[];
  dryRun: boolean;
  realPaneIds: { orchestrator: string; teammates: Record<string, string> } | null;
  orchestratorHostKind?: HostKind;
}): Manifest {
  const {
    runId,
    mode,
    sessionName,
    windowName,
    specialists,
    dryRun,
    realPaneIds,
    orchestratorHostKind = "claude",
  } = opts;
  const paneHosts = [
    orchestratorHostKind,
    ...specialists.map((s) => s.host_kind ?? orchestratorHostKind),
  ];
  // W4 D1: registry bridge — exact isClaudeCli() replaces `.includes("claude")` literal check.
  const hasClaudePane = paneHosts.some((h) => isClaudeCli(h));
  return {
    run_id: runId,
    mode,
    session_name: sessionName,
    window_name: windowName,
    created_at: new Date().toISOString(),
    orchestrator_host_kind: orchestratorHostKind,
    orchestrator_pane_id: dryRun
      ? "(dry-run: not spawned)"
      : realPaneIds?.orchestrator ?? "(unknown)",
    teammate_panes: specialists.map((s) => ({
      specialist: s.name,
      pane_id: dryRun
        ? "(dry-run: not spawned)"
        : realPaneIds?.teammates?.[s.name] ?? "(unknown)",
      host_kind: s.host_kind ?? orchestratorHostKind,
      adapter_version: ADAPTER_VERSION,
      // D-CAP: capability_scope is additive+optional — undefined is omitted by JSON.stringify.
      capability_scope: s.capability_scope,
    })),
    env: {
      ...(hasClaudePane ? { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1" } : {}),
      // GUILD_RUN_ID is exported into each pane at spawn time (see composeTmuxCommands)
      // so hooks inside the panes converge on this run-id.
      GUILD_RUN_ID: runId,
    },
  };
}

function makeRunId(): string {
  // Launcher has no session_id — use compact ISO timestamp with "run-" prefix
  // to match the hooks' convention (run-<session_id> / run-<timestamp>).
  // Kept sortable for filesystem listing.
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function writeManifest(cwd: string, manifest: Manifest): string {
  const runId = manifest.run_id;
  const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "session.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return out;
}

/**
 * Write the cross-host work-assignment channel: one `guild.task_assignment.v1`
 * per specialist at `.guild/runs/<run-id>/tasks/<specialist>.json` (launcher writes,
 * specialist pane reads via `readTaskAssignment`; docs/v2 §08).
 *
 * MUST run in the pre-routing block over the FULL specialist list, BEFORE any
 * local/remote dispatch — so (a) remote/cross-host specialists (the whole point of
 * the channel) get their file even though they are later filtered out of the local
 * tmux pool, and (b) every pane's file exists on disk before its process spawns and
 * tries to read it. `ownerMap` resolves the plan task-id (and thus the context-bundle
 * pointer). Best-effort + non-throwing — a write failure is logged, never aborts.
 */
function writeTaskAssignments(
  cwd: string,
  runId: string,
  specialists: Specialist[],
  ownerMap: Map<string, string[]>,
  orchestratorHostKind: string,
): number {
  const runDir = path.join(cwd, ".guild", "runs", runId);
  let written = 0;
  for (const s of specialists) {
    const taskIds = ownerMap.get(s.name);
    const repTaskId = taskIds && taskIds.length > 0 ? taskIds[0] : null;
    // Context-bundle pointer: the conventional per-specialist bundle path
    // (.guild/context/<run-id>/<specialist>-<task-id>.md) when a plan task-id exists.
    const contextRef = repTaskId
      ? path.join(".guild", "context", runId, `${s.name}-${repTaskId}.md`)
      : null;
    try {
      const assignment = buildTaskAssignment({
        runId,
        specialist: s.name,
        taskId: repTaskId,
        scope: s.scope ?? "",
        dependsOn: s.dependsOn ?? [],
        contextRef,
        hostKind: s.host_kind ?? orchestratorHostKind,
        adapterVersion: ADAPTER_VERSION,
        now: () => new Date().toISOString(),
      });
      if (writeTaskAssignment(runDir, assignment)) written += 1;
    } catch (err) {
      process.stderr.write(
        `[agent-team-launcher] WARN: task-assignment write for ${s.name} failed: ${
          err instanceof Error ? err.message : String(err)
        }\n`,
      );
    }
  }
  return written;
}

// ── Cross-host routing inputs (CH-1) ─────────────────────────────────────────
//
// Best-effort load of the guild.host_capability.v1 manifests the CR-1 router
// reads. Absent dir / unreadable files ⇒ empty list (single-host behavior).

function loadHostManifests(cwd: string): RoutableHost[] {
  const dir = path.join(cwd, ".guild", "hosts");
  let ids: string[];
  try {
    ids = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RoutableHost[] = [];
  for (const id of ids) {
    try {
      const raw = fs.readFileSync(path.join(dir, id, "capability.json"), "utf8");
      const m = JSON.parse(raw) as RoutableHost;
      if (m && typeof m.host_id === "string") out.push(m);
    } catch {
      // skip a missing/unreadable manifest — the router excludes absent hosts.
    }
  }
  return out;
}

// ── defaults.cross_host config reader ─────────────────────────────────────────
//
// SECURITY: stores address/port/user only — NO secrets, NO passwords.
// Auth via ssh keys/agent. This mirrors read-guild-config.ts DefaultsBlock.cross_host.

interface CrossHostEndpointCfg {
  address: string;
  port?: number;
  user?: string;
  /** Remote login shell — wraps the spawn cmd so off-PATH brands (codex) resolve. */
  login_shell?: string;
}
interface CrossHostConfig {
  enabled: boolean;
  hosts: Record<string, CrossHostEndpointCfg>;
  /**
   * R-015: CR-3 level-4 Claude-only fallback (v2-cross-host-orchestration ADR CR-3).
   * Default true — matches host-router.ts RouteOptions.fallbackToClaude default.
   */
  fallback_to_claude: boolean;
  /**
   * R-018: Host capability manifest freshness TTL in seconds (ADR CR-5).
   * Default 3600 — matches host-router.ts DEFAULT_TTL_S.
   */
  capability_manifest_ttl_s: number;
}

/**
 * Read defaults.cross_host (+ defaults.capability_manifest_ttl_s) via the settings resolver.
 * Graceful on missing/parse errors — returns the built-in defaults.
 *
 * Inherits from workspace settings when the project is a child of a workspace
 * (the resolver's 5-layer chain applies). A child without its own cross_host config
 * will receive the workspace value via inheritance.
 *
 * Value guards (restores the old direct-reader's strict checks):
 *   - enabled: must be EXACTLY boolean true to activate cross-host; any other
 *     truthy value (string "yes", number 1, etc.) is treated as false.
 *     This matches the old `ch.enabled === true` guard.
 *   - hosts: must be a plain object; any non-object value falls back to {}.
 *     This matches the old `typeof ch.hosts === "object" && ch.hosts !== null` guard.
 *   - fallback_to_claude (R-015): bool; defaults to true (preserves CR-3 behavior).
 *   - capability_manifest_ttl_s (R-018): positive number; defaults to 3600 (1 hour, CR-5).
 */
function loadCrossHostConfig(cwd: string): CrossHostConfig {
  try {
    const { config } = resolveSettings({ cwd });
    const ch = config.defaults.cross_host as Record<string, unknown> | undefined;
    // R-018: capability_manifest_ttl_s lives under defaults.*, not under cross_host.
    const defs = config.defaults as Record<string, unknown>;
    const rawTtl = defs["capability_manifest_ttl_s"];
    return {
      enabled: ch?.enabled === true,
      hosts: isPlainObject(ch?.hosts)
        ? (ch.hosts as Record<string, CrossHostEndpointCfg>)
        : {},
      // R-015: fallback_to_claude — must be EXACTLY false to disable; default true.
      fallback_to_claude: ch?.["fallback_to_claude"] === false ? false : true,
      // R-018: manifest TTL — must be a positive number; default 3600.
      capability_manifest_ttl_s:
        typeof rawTtl === "number" && rawTtl > 0 ? rawTtl : 3600,
    };
  } catch {
    return { enabled: false, hosts: {}, fallback_to_claude: true, capability_manifest_ttl_s: 3600 };
  }
}

// `defaults.cross_host.enabled` is the canonical settings.json key.
// GUILD_CROSS_HOST_ENABLED env mirrors it with higher precedence when explicitly set.
function crossHostEnabled(env: NodeJS.ProcessEnv, cwd: string): boolean {
  const v = (env["GUILD_CROSS_HOST_ENABLED"] ?? "").trim().toLowerCase();
  // Explicit env wins in both directions (set to 1 or 0).
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  // Env not set → fall through to settings.json defaults.cross_host.enabled.
  return loadCrossHostConfig(cwd).enabled;
}

// ── R-009: statusline env gate ────────────────────────────────────────────────
//
// Reads `statusline` from the resolved settings and exports GUILD_STATUSLINE=1
// into the launcher's process env so paneCommand() (team-backend.ts) propagates
// it into every specialist pane. Only acts when the env var is not already set;
// a pre-existing GUILD_STATUSLINE=1 (user-exported in shell before starting
// Claude Code) is preserved as-is. Failure to read settings is non-fatal.
function applyStatuslineEnv(cwd: string): void {
  if (process.env["GUILD_STATUSLINE"] === "1") return;
  try {
    const { config } = resolveSettings({ cwd });
    // R-009: config.statusline is wired in ResolvedConfig + DEFAULTS by tooling-engineer.
    if (config.statusline === true) {
      process.env["GUILD_STATUSLINE"] = "1";
    }
  } catch {
    // Non-fatal: missing settings.json or resolver error → leave env unset.
  }
}

// ── D5 dispatch ladder ─────────────────────────────────────────────────────
//
// Resolves the execution backend per D5 (v2x-command-surface-dispatch-and-
// internalization.md). Explicit `agent_mode` wins over auto-detection.
// auto resolution order:
//   1. $TMUX set → team (in-session window — PRESERVE shipped in-session fix)
//   2. tmux installed → team (new detached session)
//   3. Host (claude|codex) signals independent agent support → agent
//   4. Fallback → subagent

type AgentModeExplicit = "team" | "agent" | "subagent" | "auto";
interface ResolvedMode {
  mode: "team" | "agent" | "subagent";
  reason: string;
}

/**
 * Returns true when the host signals it supports independent (non-tmux) agents.
 * Signaled via GUILD_INDEPENDENT_AGENTS_SUPPORTED env var. When absent, falls
 * back to GUILD_HOST: claude|auto is assumed to support them; codex currently
 * does not. This env probe is intentionally cheap — no subprocess spawn.
 */
function hostSupportsIndependentAgents(): boolean {
  const explicit = process.env["GUILD_INDEPENDENT_AGENTS_SUPPORTED"];
  if (explicit !== undefined) {
    const s = explicit.trim().toLowerCase();
    return !(s === "0" || s === "false" || s === "no" || s === "off");
  }
  // Default: assume claude (the expected host) supports independent agents.
  // W4 D1: registry bridge — exact isClaudeCli() replaces `=== "claude"` literal.
  // "auto" still maps to true (unset host defaults to Claude behavior).
  const host = (process.env["GUILD_HOST"] ?? "auto").toLowerCase();
  return isClaudeCli(host as HostKind) || host === "auto";
}

/**
 * Resolve the D5 ladder. `dryRun=true` still checks $TMUX and tmux availability
 * so the dry-run output accurately reflects what a real launch would choose.
 *
 * When `explicit` is non-null and not "auto", that value is used directly
 * (subject to availability: pinning "team" on a tmux-less host warns + falls
 * back to "subagent" for real runs; dry-run leaves team as-is to show intent).
 */
function resolveAgentMode(explicit: AgentModeExplicit | null, dryRun: boolean): ResolvedMode {
  const val: AgentModeExplicit = explicit ?? "auto";

  if (val === "team") {
    // Pinned team: validate tmux availability for real launches.
    if (!dryRun && !probeTmuxAvailable()) {
      process.stderr.write(
        "[agent-team-launcher] WARN: agent_mode=team pinned but tmux is not available — " +
          "falling back to subagent. Install tmux or use agent_mode=auto.\n"
      );
      return { mode: "subagent", reason: "agent_mode=team pinned but tmux unavailable → subagent fallback" };
    }
    return { mode: "team", reason: "explicit agent_mode=team" };
  }

  if (val === "agent") {
    return { mode: "agent", reason: "explicit agent_mode=agent" };
  }

  if (val === "subagent") {
    return { mode: "subagent", reason: "explicit agent_mode=subagent" };
  }

  // auto — D5 ladder
  // Step 1: inside a tmux session → team in-session (preserves shipped fix)
  if (process.env["TMUX"]) {
    return { mode: "team", reason: "auto: $TMUX set → team in-session" };
  }

  // Step 2: tmux installed but not currently inside one → team new-session
  if (probeTmuxAvailable()) {
    return { mode: "team", reason: "auto: tmux installed → team new-session" };
  }

  // Step 3: host signals independent agent support → agent
  if (hostSupportsIndependentAgents()) {
    return { mode: "agent", reason: "auto: host supports independent agents → agent" };
  }

  // Step 4: fallback
  return { mode: "subagent", reason: "auto: no tmux, no independent-agent support → subagent" };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // ── P1-3 A2b: --reap path ──────────────────────────────────────────────────
  // When --reap is passed, skip the normal launch flow and force-reap dead
  // members from the session registry.  Requires --cwd (defaults to ".").
  // Optionally scoped to a single run via --run-id; without it, all runs that
  // have a session.json are checked.
  //
  // Usage:
  //   agent-team-launcher.ts --reap --cwd /path/to/repo [--run-id run-2026-...]
  //
  // Exit 0 always (reaping is a maintenance op, never a hard failure).
  if (args.reap) {
    const cwd = path.resolve(args.cwd);
    const runIds: string[] = args.runId
      ? [args.runId]
      : listRunnableRunIds(cwd);

    if (runIds.length === 0) {
      process.stdout.write(
        "[agent-team-launcher] --reap: no runs with session.json found " +
          `under ${path.join(cwd, ".guild", "runs")}\n`
      );
      process.exit(0);
    }

    let totalReaped = 0;
    for (const runId of runIds) {
      const sjPath = sessionJsonPath(cwd, runId);
      if (!fs.existsSync(sjPath)) continue;

      const result = reapDeadMembers(sjPath);
      if (result.reaped.length > 0) {
        totalReaped += result.reaped.length;
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — reaped ${result.reaped.length} ` +
            `dead pane(s): [${result.reaped.join(", ")}]; ` +
            `live: [${result.live.join(", ") || "none"}]; ` +
            `skipped: [${result.skipped.join(", ") || "none"}]; ` +
            `session.json ${result.updated ? "updated" : "NOT updated (write failed)"}\n`
        );
      } else if (result.skipped.length > 0) {
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — all panes skipped ` +
            `(dry-run placeholders or tmux unavailable): [${result.skipped.join(", ")}]\n`
        );
      } else {
        process.stdout.write(
          `[agent-team-launcher] --reap: run "${runId}" — all panes live ` +
            `[${result.live.join(", ") || "none"}]; nothing to reap.\n`
        );
      }
    }

    process.stdout.write(
      `[agent-team-launcher] --reap: done. ` +
        `${totalReaped} dead pane(s) pruned across ${runIds.length} run(s).\n`
    );
    process.exit(0);
  }

  // ── P1-4: --dismiss-completed path ────────────────────────────────────────
  // Resolves teammates from the run's session.json, calls detectDismissible,
  // and emits a machine-readable DISMISS line per dismissible lane. Also runs
  // reapDeadMembers to clean up any dead panes (the "already gone" fall-through).
  //
  // NOTE (spec §4 known limitation): the launcher is a one-shot process, not a
  // daemon; it cannot push dismissals mid-run. This mode is invoked by the lead
  // when the teammate-idle hook emits an [AUTO-DISMISS] directive — the hook fires
  // deterministically, the lead/launcher consumes it deterministically. That
  // removes the agent's responsibility for the second step without adding a
  // background reaper daemon (out of scope).
  //
  // Usage:
  //   agent-team-launcher.ts --dismiss-completed --run-id <id> [--cwd <path>]
  //
  // Exit 0 always (maintenance op, never a hard failure).
  if (args.dismissCompleted) {
    const cwd = path.resolve(args.cwd);
    if (!args.runId) {
      process.stdout.write(
        "[agent-team-launcher] --dismiss-completed: --run-id <id> is required\n"
      );
      process.exit(0);
    }
    const runId = args.runId;
    const runDir = path.join(cwd, ".guild", "runs", runId);
    const sjPath = sessionJsonPath(cwd, runId);

    if (!fs.existsSync(sjPath)) {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: no session.json for run "${runId}"\n`
      );
      process.exit(0);
    }

    let sessionManifest: { teammate_panes?: Array<{ specialist: string }> };
    try {
      sessionManifest = JSON.parse(fs.readFileSync(sjPath, "utf8")) as typeof sessionManifest;
    } catch {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: could not parse session.json for run "${runId}"\n`
      );
      process.exit(0);
    }

    const teammates = (sessionManifest.teammate_panes ?? []).map((p) => p.specialist);
    if (teammates.length === 0) {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: run "${runId}" has no teammates\n`
      );
      process.exit(0);
    }

    const dismissibles = detectDismissible(runDir, teammates);
    let dismissCount = 0;
    for (const entry of dismissibles) {
      if (entry.dismissible) {
        dismissCount++;
        process.stdout.write(
          `[DISMISS] specialist="${entry.specialist}" task="${entry.taskId}" receipt="${entry.receiptPath}"\n`
        );
      }
    }

    if (dismissCount === 0) {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: no dismissible lanes found for run "${runId}"\n`
      );
    }

    // Fall-through: reap any panes that are already dead.
    reapDeadMembers(sjPath);

    process.exit(0);
  }

  if (!args.team) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: --team <path> is required.\n"
    );
    process.exit(1);
  }

  if (!fs.existsSync(args.team)) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: team file not found: ${args.team}\n`
    );
    process.exit(1);
  }

  let team: TeamYaml;
  try {
    team = parseYaml(fs.readFileSync(args.team, "utf8"));
  } catch (err) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: could not parse ${args.team}: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  // ── D5 dispatch ladder ────────────────────────────────────────────────────
  // When --agent-mode is provided, run the D5 ladder. Non-team modes emit a
  // JSON signal so the caller (guild:execute-plan) can route accordingly.
  // When --agent-mode is absent, fall through to the legacy team.backend check
  // for backward compatibility with existing callers.
  if (args.agentMode !== null) {
    const { mode: resolvedMode, reason } = resolveAgentMode(args.agentMode, args.dryRun);

    if (resolvedMode === "agent") {
      // D5 rung 3 (in-process / independent agents, no tmux). dispatch.md
      // §"In-process dispatchPlan consumption" + SKILL.md §"Backend + routing"
      // both document that the launcher actually CONSTRUCTS InProcessTeamBackend
      // and returns its declarative dispatchPlan here — this rung was previously
      // half-built (the launcher only ever emitted {backend,reason,slug} and
      // exited, never constructing the backend). InProcessTeamBackend.launch()
      // is a pure, synchronous computation (no live session, no subprocess) —
      // fully usable from this one-shot CLI process, so there is no need to
      // fall back to hand-rolling the descriptors: construct the real backend.
      const slug = slugFromTeamPath(args.team);
      // Reuse the caller's run-id when supplied (--run-id) so GUILD_RUN_ID inside
      // each dispatchPlan descriptor's env matches the run directory the caller
      // already created (guild:execute-plan §Input 4). Only mint a fresh one
      // (e.g. for a standalone `--dry-run` preview with no caller-supplied id).
      const runId = args.runId ?? makeRunId();
      const cwd = path.resolve(args.cwd);
      const orchestratorHostKind = resolveOrchestratorHostKind(process.env) ?? undefined;
      const inProcess = new InProcessTeamBackend();
      const result = inProcess.launch({
        slug,
        runId,
        cwd,
        specialists: team.specialists,
        targetName: args.sessionName ?? `guild-${slug}`,
        mode: process.env["TMUX"] ? "in-session" : "new-session",
        dryRun: args.dryRun,
        orchestratorHostKind,
        teamPath: args.team,
      });
      const signal = {
        backend: resolvedMode,
        reason,
        slug,
        ok: result.ok,
        dispatchPlan: result.dispatchPlan,
        orchestratorPaneId: result.orchestratorPaneId,
        teammatePaneIds: result.teammatePaneIds,
        notes: result.notes,
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
    }

    if (resolvedMode !== "team") {
      // subagent: execute-plan constructs the Agent() call itself directly
      // from team.yaml + the plan (SKILL.md §"Capability-scope env injection")
      // — there is no launcher-side descriptor to compute for this rung, so the
      // signal stays the plain {backend, reason, slug} shape.
      const signal = {
        backend: resolvedMode,
        reason,
        slug: slugFromTeamPath(args.team),
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
    }
    // resolvedMode === "team" → fall through to the tmux launch below.
    // (Skip the legacy team.backend check — agent_mode=team|auto overrides it.)
  } else {
    // Legacy behavior: require team.yaml to declare backend: agent-team.
    if (team.backend !== "agent-team") {
      process.stderr.write(
        `[agent-team-launcher] ERROR: team.yaml declares backend: ${team.backend || "(missing)"}.\n` +
          `  This launcher only runs when backend is exactly "agent-team".\n` +
          `  For backend: subagent, use the standard guild:execute-plan dispatch path\n` +
          `  (it invokes specialists via the Agent tool, not tmux).\n`
      );
      process.exit(1);
    }
  }

  // Launch-mode selection (guild-plan.md §7.3, one team per session). If we are
  // already inside a tmux session ($TMUX set), DO NOT refuse — instead spawn the
  // team in a NEW WINDOW of the current session (in-session mode) so the panes
  // are visible. Outside tmux we create + attach a fresh detached session.
  const mode: LaunchMode = process.env["TMUX"] ? "in-session" : "new-session";

  if (team.specialists.length === 0) {
    process.stderr.write(
      "[agent-team-launcher] ERROR: team.yaml has no specialists; nothing to spawn.\n"
    );
    process.exit(1);
  }

  const slug = slugFromTeamPath(args.team);
  // The `-t` target name. In new-session mode it is the session name and carries
  // a timestamp so back-to-back runs never self-collide. In in-session mode it
  // is the window name: deterministic (no timestamp) so the one-team-per-session
  // guard below actually fires when the same team is re-launched in a session.
  const targetName =
    args.sessionName ??
    (mode === "in-session"
      ? `guild-${slug}`
      : `guild-${slug}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const cwd = path.resolve(args.cwd);
  const orchestratorHostKind = resolveOrchestratorHostKind(process.env);
  if (!orchestratorHostKind) {
    const rawHost =
      process.env["GUILD_ORCHESTRATOR_HOST"] ??
      process.env["GUILD_HOST_ID"] ??
      process.env["GUILD_HOST"] ??
      "";
    process.stderr.write(
      `[agent-team-launcher] unsupported starting host "${rawHost}". Set ` +
        "GUILD_HOST_ID to a registered Guild host id, or add a PaneAdapter before launching a team.\n"
    );
    process.exit(1);
  }

  // R-009: apply statusline env gate before pane commands are composed.
  // If settings.json resolves statusline: true (via --statusline flag or
  // `config set statusline true`), export GUILD_STATUSLINE=1 into the process
  // env so paneCommand() propagates it into every specialist pane. A pre-
  // existing GUILD_STATUSLINE=1 (user-exported in shell) is never cleared.
  applyStatuslineEnv(cwd);

  // Mint the unified run-id ONCE per launcher invocation and thread it through
  // both prompts and the manifest. Exported into each pane's env so hooks
  // inside (capture-telemetry, maybe-reflect, agent-team handlers) converge
  // on the same `.guild/runs/<run-id>/` path. Defined here (before the cross-
  // host block) so both remote + local tmux paths share the same run ID.
  const runId = makeRunId();

  // ── W2-A2: pre-routing task_run writes (single-source for capability routing) ─
  // Write ALL task_runs for ALL specialists BEFORE any routing decision. After
  // writing, read back capability_requirements from disk and update each
  // specialist in-place so planTeamRouting reads EXACTLY what was written.
  // This makes the written task_run file the single source of truth:
  //   team.yaml → parser → writer → disk → reader → planTeamRouting
  // Any future drift between writer and router is a compile-time shape error,
  // not a silent runtime divergence.
  {
    const preRoutingOwnerMap = readPlanOwnerTaskIds(cwd, slug);
    for (const spec of team.specialists) {
      const taskIds = preRoutingOwnerMap.get(spec.name);
      const effectiveTaskIds = taskIds && taskIds.length > 0 ? taskIds : [spec.name];
      const cr = spec.capabilityRequirements;
      for (const taskId of effectiveTaskIds) {
        writeTaskRun(cwd, runId, taskId, {
          specialist: spec.name,
          host: cr ? {
            capabilityRequirements: {
              needsPr: cr.needs_pr,
              needsParallel: cr.needs_parallel,
              needsNetwork: cr.needs_network,
              isolation: cr.isolation,
            },
          } : undefined,
        });
      }
    }
    // ── D-CAP scope-file writer: write per-task-id scope files BEFORE spawn ──
    // Closes the "reader-without-writer" gap in the PreToolUse hook file-fallback:
    // pre-tool-use.ts:488 reads <runDir>/scope/<taskId>.json when GUILD_CAPABILITY_SCOPE
    // is absent from env (e.g. cross-host SSH or any env where injection is unreliable),
    // but nothing previously wrote that file. Writing here (inside the pre-routing block,
    // same task-id resolution as writeTaskRun) guarantees the file is on disk BEFORE any
    // pane opens via tmux or SSH.  Absent capability_scope → no file (additive,
    // byte-identical to unscoped behavior — the gate only fires if the file is present).
    {
      const runDir = path.join(cwd, ".guild", "runs", runId);
      for (const spec of team.specialists) {
        if (spec.capability_scope === undefined) continue;
        const taskIds = preRoutingOwnerMap.get(spec.name);
        const effectiveTaskIds = taskIds && taskIds.length > 0 ? taskIds : [spec.name];
        for (const taskId of effectiveTaskIds) {
          const scopeDir = path.join(runDir, "scope");
          fs.mkdirSync(scopeDir, { recursive: true });
          fs.writeFileSync(
            path.join(scopeDir, `${taskId}.json`),
            JSON.stringify({ capability_scope: spec.capability_scope, autonomy_contract: null }),
            "utf8",
          );
        }
      }
    }
    // ── guild.task_assignment.v1: cross-host work-assignment channel (docs/v2 §08) ──
    // Write ALL assignments here — full pre-routing list, BEFORE any local/remote
    // dispatch — so remote specialists (later filtered out of the local tmux pool)
    // still get their file, and every file is on disk before its pane spawns.
    {
      const taWritten = writeTaskAssignments(
        cwd,
        runId,
        team.specialists,
        preRoutingOwnerMap,
        orchestratorHostKind,
      );
      if (taWritten > 0) {
        process.stdout.write(
          `[agent-team-launcher] wrote ${taWritten} task assignment(s) → .guild/runs/${runId}/tasks/\n`,
        );
      }
    }

    // Read back from each specialist's representative task_run file and update the
    // in-memory specialist object. planTeamRouting then routes from disk-sourced data.
    //
    // W2-A2(d): readback failure is benign (launcher is sole writer — fallback ==
    // what was just written, so no routing drift is possible). BUT a silent fallback
    // violates Guild's never-silent-degradation principle. On read-failure:
    //   - fall back to spec.capabilityRequirements (the in-memory value we JUST wrote)
    //   - emit a stderr warning + a NDJSON degradation record to v1.4-events.jsonl
    // This converts "silent fail-open" to "observable benign fallback".
    for (const spec of team.specialists) {
      const taskIds = preRoutingOwnerMap.get(spec.name);
      // All task-ids for this specialist share the same specialist-level CR.
      // Use the first one as the representative file.
      const repTaskId = (taskIds && taskIds.length > 0) ? taskIds[0] : spec.name;
      const fromDisk = readTaskRunCapReqs(cwd, runId, repTaskId);
      if (fromDisk !== undefined) {
        spec.capabilityRequirements = fromDisk;
      } else {
        // W2-A2(d): observable benign fallback — emit degradation signal.
        emitReadbackDegradation(cwd, runId, repTaskId, spec.name);
      }
      // D-CAP: populate spec.taskId with the representative plan task-id so
      // composeTmuxCommands / composeInProcessDispatch / RemoteTeamBackend can inject
      // GUILD_TASK_ID into every spawn env (scope-file locator for the hook fallback).
      spec.taskId = repTaskId;
    }
  }

  // ── CH-1 routing: local tmux vs remote, via host-router ──────────────────
  // When cross-host is enabled (env OR defaults.cross_host.enabled in settings.json)
  // AND host-capability manifests exist, route each specialist THROUGH the CR-1
  // routing function and detect any that resolve to a remote host.
  //
  // For each remote-routed specialist:
  //   - endpoint configured in defaults.cross_host.hosts → dispatch via RemoteTeamBackend
  //   - endpoint NOT configured → surface + refuse (safe, no partial dispatch)
  //
  // Disabled OR no manifests → inert, single-host behavior byte-identical to today.
  if (crossHostEnabled(process.env, cwd)) {
    const manifests = loadHostManifests(cwd);
    if (manifests.length > 0) {
      const explicitLocalHostId = (process.env["GUILD_HOST_ID"] ?? "").trim();
      const localHostFromKind = normalizeHostId((process.env["GUILD_HOST"] ?? "").trim());
      // W4 D1: registry bridge — hostKindToRegistryId replaces the inline switch of
      // `=== "codex"` / `=== "pi"` / `=== "antigravity-2"` literals. Unknown or
      // dropped host kinds must not silently become Claude; require an explicit local id.
      const localHostId =
        explicitLocalHostId ||
        localHostFromKind ||
        hostKindToRegistryId(orchestratorHostKind);
      if (!localHostId) {
        process.stderr.write(
          `[agent-team-launcher] cross-host routing cannot infer a local registry host id from ` +
            `GUILD_HOST="${orchestratorHostKind}". Set GUILD_HOST_ID to the local capability manifest id.\n`
        );
        process.exit(1);
      }
      try {
        // Load cross-host config here so R-015/R-018 values are available
        // for both the routing decision AND the endpoint lookup below.
        const chConfig = loadCrossHostConfig(cwd);
        const routes = planTeamRouting(team.specialists, manifests, {
          localHostId,
          crossHostEnabled: true,
          // R-015: pass defaults.cross_host.fallback_to_claude → RouteOptions.fallbackToClaude
          fallbackToClaude: chConfig.fallback_to_claude,
          // R-018: pass defaults.capability_manifest_ttl_s → RouteOptions.manifestTtlS
          manifestTtlS: chConfig.capability_manifest_ttl_s,
          // TE-03/EDIT-2: persist each routing decision (selected host + degraded +
          // independence + per-lane tier + model) into run-state via upsertLane.
          // Fires on BOTH the qualifying path (degraded:false) and the degrade-not-throw
          // path (degraded:true) — host-router calls opts.onDecision in both branches.
          //
          // TE-03 fix: d.taskId = specialist NAME (planTeamRouting sets taskId=s.name).
          // RunStateV1.lanes is task-id keyed. Fan-out upsertLane over the specialist's
          // plan task-id(s) via resolveDeadLaneKeys — the SAME join the SSH dead-lane
          // path already uses (L~1032). Skip when no plan task-ids are found (plan absent
          // or specialist not in plan) — NO name-key fallback (that's the contract violation).
          onDecision: (d) => {
            // d.taskId is the specialist NAME (planTeamRouting sets taskId = s.name).
            // RunStateV1.lanes is TASK-ID keyed. Map name → plan task-id(s) via the
            // block-scoped plan parse (same join the SSH dead-lane path uses, minus the
            // name-key fallback: resolveDeadLaneKeys returns [specName] when the plan is
            // absent, which would reintroduce the contract violation here).
            const ownerMap = readPlanOwnerTaskIds(cwd, slug);
            const taskIds = ownerMap.get(d.taskId); // undefined when plan absent / not-in-plan
            if (!taskIds || taskIds.length === 0) {
              // No plan task-id — skip. Do NOT persist under the specialist name.
              return;
            }
            const hostBlock = {
              selected: d.host,
              degraded: d.degraded,
              independence: d.independence,
              tier: d.tier,
              model: d.model,
              modelParams: d.modelParams,
            };
            for (const taskId of taskIds) {
              upsertLane(
                path.join(cwd, ".guild", "runs", runId),
                { runId, planSlug: slug, programId: null },
                taskId,
                { host: hostBlock }
              );
            }
          },
        });
        // EDIT-2: surface degraded routes in stderr — never silent (mirrors the
        // remote-no-endpoint surfacing pattern above).
        const degradedRoutes = routes.filter((r) => r.decision.degraded);
        if (degradedRoutes.length > 0) {
          const degradedLines = degradedRoutes
            .map(
              (r) =>
                `    - ${r.specialist} → ${r.decision.host} (${r.hostKind}) [DEGRADED]: no fully-qualifying host; weak independence recorded (TE-02/TE-03)`
            )
            .join("\n");
          process.stderr.write(
            `[agent-team-launcher] WARN: ${degradedRoutes.length} lane(s) degraded — routing to least-bad host:\n${degradedLines}\n`
          );
        }
        const remote = routes.filter((r) => r.backend === "remote");
        if (remote.length > 0) {
          // chConfig already loaded above — reuse it.
          // Partition: specialists with endpoint config vs. those without.
          const withEndpoint = remote.filter((r) => !!chConfig.hosts[r.decision.host]);
          const noEndpoint = remote.filter((r) => !chConfig.hosts[r.decision.host]);

          if (noEndpoint.length > 0) {
            // Safe surface+refuse: never silently drop a specialist.
            const lines = noEndpoint
              .map(
                (r) =>
                  `    - ${r.specialist} → ${r.decision.host} (${r.hostKind}) — no SSH endpoint configured`
              )
              .join("\n");
            process.stderr.write(
              `[agent-team-launcher] ERROR: ${noEndpoint.length} specialist(s) route to a REMOTE host ` +
                `with no SSH endpoint in defaults.cross_host.hosts:\n${lines}\n` +
                `  Add defaults.cross_host.hosts["<host_id>"].address to .guild/settings.json\n` +
                `  or drop \`host:\` from team.yaml to keep those specialists local.\n`
            );
            process.exit(1);
          }

          // All remote specialists have endpoints — dispatch via RemoteTeamBackend.
          // SECURITY: endpoint carries address/user only; auth via ssh keys/agent (no passwords).
          const remoteSpecialists = withEndpoint.map(
            (r) => team.specialists.find((s) => s.name === r.specialist)!
          );

          const resolveHostTarget = (spec: Specialist): RemoteHostTarget => {
            const r = routes.find((rt) => rt.specialist === spec.name)!;
            const entry = chConfig.hosts[r.decision.host];
            // Build ssh endpoint: [user@]address. Port belongs in ~/.ssh/config.
            // SECURITY: address/user only — no passwords.
            const endpoint = entry.user
              ? `${entry.user}@${entry.address}`
              : entry.address;
            // login_shell wraps the remote spawn cmd (`<shell> -lic '<cmd>'`) so a
            // brand off the default non-interactive ssh PATH (codex/linuxbrew) is
            // found; absent ⇒ no wrap (claude is on PATH). See SshRemoteTransport.spawn.
            return {
              hostId: r.decision.host,
              hostKind: r.hostKind,
              endpoint,
              ...(entry.login_shell ? { loginShell: entry.login_shell } : {}),
            };
          };

          const remoteBackend = new RemoteTeamBackend({
            transport: new SshRemoteTransport(),
            resolveHostTarget,
            resolveAdapter: resolveAdapter(),
          });

          // R-016a: wrap the ONE real TS-level dispatch call site in bounded retry.
          // RemoteTeamBackend.launch() returns { ok:false } on transient SSH connection
          // failure — exactly the retryable scenario. We throw on !ok inside the
          // dispatchFn so runWithRetry re-attempts up to defaults.retry.max_attempts with
          // backoff; dry-run never fails (ok:true), so it makes a single pass.
          // On exhaustion, onExhausted marks every remote lane dead via the shared
          // markLaneDead writer (same checkpoint the prose path writes via mark-lane-dead.ts).
          const retryOpts = loadRetryOpts(cwd);
          const runDir = path.join(cwd, ".guild", "runs", runId);
          const init: RunStateInit = { runId, planSlug: slug, programId: null };

          let remoteResult;
          try {
            const outcome = await runWithRetry(
              () => {
                // W2-A2: task_runs for remote specialists are already written in the
                // pre-routing block above (single-source: written file drives routing).
                // Do NOT re-write here; on retry the existing files are correct.
                const res = remoteBackend.launch({
                  slug,
                  runId,
                  cwd,
                  specialists: remoteSpecialists,
                  targetName,
                  mode,
                  dryRun: args.dryRun,
                  teamPath: args.team, // C13: resolved per-phase path → orchestrator prompt
                });
                if (!res.ok) {
                  // Throw so runWithRetry retries; carry the notes for the final error.
                  throw new Error(
                    `remote dispatch failed — ${res.notes?.join("; ") ?? "unknown"}`
                  );
                }
                return Promise.resolve(res);
              },
              {
                ...retryOpts,
                onExhausted: (signal) => {
                  // Mark every remote lane dead + write resume.json (resume.enabled honored
                  // inside markLaneDead). One writer for both SSH + prose paths (R-016 bridge).
                  //
                  // R-016 lane-key fix: key the checkpoint by the PLAN TASK-ID (e.g.
                  // `T2-backend`), NOT the specialist name (`backend`). team.yaml carries
                  // only names; the task-id↔owner map lives in the plan, so we JOIN via
                  // resolveDeadLaneKeys(cwd, slug, spec.name). This makes the SSH write key
                  // identical to the resume-lanes.ts read key + execute-plan re-entry key
                  // (run-state lanes are task-id-keyed). A specialist that owns several
                  // lanes dead-letters each (an undispatchable specialist runs none of them).
                  for (const spec of remoteSpecialists) {
                    const laneKeys = resolveDeadLaneKeys(cwd, slug, spec.name);
                    // Fallback (no plan task-id) → keyed by spec.name; warn so a
                    // name-keyed checkpoint that resume can't map is never silent.
                    if (laneKeys.length === 1 && laneKeys[0] === spec.name) {
                      process.stderr.write(
                        `[agent-team-launcher] WARN: no plan task-id for specialist "${spec.name}" ` +
                          `(.guild/plan/${slug}.md) — keying its dead-lane checkpoint by specialist name; ` +
                          `/guild:resume may not map it to a plan lane.\n`,
                      );
                    }
                    for (const laneKey of laneKeys) {
                      try {
                        markLaneDead(runDir, init, laneKey, signal, cwd);
                      } catch (e) {
                        process.stderr.write(
                          `[agent-team-launcher] WARN: could not mark lane "${laneKey}" dead — ${(e as Error).message}\n`,
                        );
                      }
                    }
                  }
                },
              }
            );
            remoteResult = outcome.result;
            if (outcome.attempts > 1) {
              process.stderr.write(
                `[agent-team-launcher] remote dispatch succeeded on attempt ${outcome.attempts}/${retryOpts.maxAttempts}\n`
              );
            }
          } catch (err) {
            // Retry exhausted — lanes already marked dead by onExhausted.
            process.stderr.write(
              `[agent-team-launcher] ERROR: remote dispatch failed after ` +
                `${retryOpts.maxAttempts} attempt(s) — ${(err as Error).message}\n`
            );
            process.exit(2);
          }

          if (args.dryRun) {
            process.stdout.write(
              `[agent-team-launcher] dry-run — remote dispatch (${remoteSpecialists.length} specialist(s)):\n`
            );
            for (const cmd of remoteResult.plannedCommands ?? []) {
              process.stdout.write(`  ${cmd}\n`);
            }
          }

          // Remove dispatched-remote specialists from the local tmux pool.
          const remoteNames = new Set(remote.map((r) => r.specialist));
          team.specialists = team.specialists.filter((s) => !remoteNames.has(s.name));

          if (team.specialists.length === 0) {
            // All specialists dispatched remotely — no local tmux session needed.
            if (args.dryRun) {
              process.stdout.write(
                "[agent-team-launcher] dry-run: all specialists remote; no local tmux session.\n"
              );
            } else {
              process.stdout.write(
                "[agent-team-launcher] all specialists dispatched remotely.\n"
              );
            }
            process.exit(0);
          }
        }
      } catch (err) {
        if (err instanceof RouteError) {
          process.stderr.write(
            `[agent-team-launcher] ERROR: cross-host routing failed — ${err.message}\n`
          );
          process.exit(1);
        }
        throw err;
      }
    }
  }

  // CH-1/R8: wire pane adapters whenever any actual pane host is not Claude.
  // A pure-Claude team keeps the resolver-less path (byte-identical legacy
  // regression anchor). Specialists without `host:` inherit the orchestrator host.
  const adapterBacked = [
    orchestratorHostKind,
    ...team.specialists.map((s) => s.host_kind ?? orchestratorHostKind),
  ].some((hostKind) => hostKind !== "claude");

  // RE-4: the tmux spawn logic lives behind the TeamBackend seam. The launcher
  // drives one TmuxTeamBackend for probes (availability, collision), pure
  // command composition (plan), and the spawn/teardown loop. The launcher keeps
  // the CLI-specific UX (exact error messages, exit codes, manifest, attach).
  const tmux = new TmuxTeamBackend(adapterBacked ? { resolveAdapter: resolveAdapter() } : {});

  // For real (non-dry-run) launches: tmux must be installed, and the target must
  // not already exist (refuse to clobber). Which collision we check depends on
  // the mode: a session name (new-session) or a team window in the current
  // session (in-session). dry-run skips this — it never invokes tmux.
  if (!args.dryRun) {
    if (!tmux.isAvailable()) {
      process.stderr.write(
        "[agent-team-launcher] ERROR: `tmux` is not installed or not on PATH.\n" +
          "  Install tmux (macOS: `brew install tmux`; Debian/Ubuntu: `apt install tmux`),\n" +
          "  then re-run. (Without tmux, use backend: subagent — guild:execute-plan\n" +
          "  dispatches specialists via the Agent tool, no tmux required.)\n"
      );
      process.exit(1);
    }
    if (mode === "in-session") {
      // One-team-per-session guard (§7.3): refuse to clobber an existing team
      // window of the same name in the current session.
      if (tmux.windowExists(targetName)) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: a Guild team window "${targetName}" already exists ` +
            `in the current tmux session.\n` +
            `  Refusing to clobber it (one team per session, guild-plan.md §7.3).\n` +
            `  Switch to it:  tmux select-window -t ${shellQuote(targetName)}\n` +
            `  Or remove it:  tmux kill-window -t ${shellQuote(targetName)}\n` +
            `  Then re-run, or pass --session-name <unique-name> for a differently-named window.\n`
        );
        process.exit(1);
      }
    } else if (tmux.sessionExists(targetName)) {
      process.stderr.write(
        `[agent-team-launcher] ERROR: tmux session "${targetName}" already exists.\n` +
          `  Refusing to clobber. Re-run with --session-name <unique-name>.\n`
      );
      process.exit(1);
    }

    // CH-6/R8: fail-fast preflight for adapter-backed teams. Probe every
    // actually-present pane host BEFORE any pane
    // spawns; on failure abort naming the specialist + host + missing
    // dependency, with ZERO panes opened (no partial spawn). No-op for a
    // pure-claude team (no resolver wired → preflight returns ok).
    if (adapterBacked) {
      const pf = tmux.preflight(team.specialists, orchestratorHostKind);
      if (!pf.ok) {
        const lines = pf.failures
          .map((f) => `    - ${f.specialist} [${f.hostKind}]: ${f.message}`)
          .join("\n");
        process.stderr.write(
          `[agent-team-launcher] ERROR: mixed-host preflight failed ` +
            `(CH-6 fail-fast — zero panes opened):\n${lines}\n`
        );
        process.exit(1);
      }
    }
  }

  const plan = tmux.plan({
    mode,
    targetName,
    cwd,
    slug,
    runId,
    specialists: team.specialists,
    dryRun: args.dryRun,
    orchestratorHostKind,
    // C13: the path the launcher was handed (--team, already resolved by the
    // dispatch layer via resolveTeamFile) IS the resolved per-phase team file —
    // thread it into the orchestrator prompt so the persisted reference matches.
    teamPath: args.team,
  });
  const commands = plan.commands;

  // W2-A2: task_runs for local specialists are already written in the pre-routing
  // block above (single-source: written file drives routing). No re-write here.
  // All task_run files — both remote-routed and local — are written ONCE, BEFORE
  // routing, so the written descriptor is the authoritative capability source.

  if (args.dryRun) {
    process.stdout.write(
      "[agent-team-launcher] dry-run — would execute the following tmux commands:\n"
    );
    for (const c of commands) process.stdout.write(`  ${c.display}\n`);
    // new-session mode finishes by attaching the terminal; in-session mode does
    // NOT attach (the select-window above already surfaced the team window).
    if (mode === "new-session") {
      process.stdout.write(
        `  tmux attach-session -t ${shellQuote(targetName)}\n`
      );
    }

    const manifestPath = writeManifest(
      cwd,
      buildManifest({
        runId,
        mode,
        sessionName: mode === "in-session" ? "(dry-run: current tmux session)" : targetName,
        windowName: mode === "in-session" ? targetName : null,
        specialists: team.specialists,
        dryRun: true,
        realPaneIds: null,
        orchestratorHostKind,
      })
    );
    process.stdout.write(
      `[agent-team-launcher] wrote session manifest → ${manifestPath}\n`
    );
    process.exit(0);
  }

  // Real run: execute the plan through the backend. The backend runs each tmux
  // command, tears down the partial target on first failure (kill-window
  // in-session / kill-session new-session), and collects teammate pane ids.
  const outcome = tmux.spawn(plan);
  if (!outcome.ok) {
    process.stderr.write(
      `[agent-team-launcher] tmux command failed: ${outcome.failedCommand?.display ?? "(unknown)"}\n` +
        `  stderr: ${outcome.stderr}\n`
    );
    process.exit(2);
  }

  const manifestPath = writeManifest(
    cwd,
    buildManifest({
      runId,
      mode,
      sessionName:
        mode === "in-session"
          ? tmux.currentSessionName() ?? "(current tmux session)"
          : targetName,
      windowName: mode === "in-session" ? targetName : null,
      specialists: team.specialists,
      dryRun: false,
      realPaneIds: {
        orchestrator: outcome.orchestratorPaneId,
        teammates: outcome.teammatePaneIds,
      },
      orchestratorHostKind,
    })
  );

  if (mode === "in-session") {
    // Already attached to this session — selecting the window (done above) is
    // what surfaces the team. Do NOT attach; just tell the operator where it is.
    process.stdout.write(
      `[agent-team-launcher] team window "${targetName}" created in the current session; ` +
        `manifest → ${manifestPath}\n` +
        `  Switch to it any time with: tmux select-window -t ${shellQuote(targetName)}\n`
    );
    process.exit(0);
  }

  process.stdout.write(
    `[agent-team-launcher] session ${targetName} created; manifest → ${manifestPath}\n`
  );

  // Attach user's terminal to the new session.
  const attach = spawnSync("tmux", ["attach-session", "-t", targetName], {
    stdio: "inherit",
  });
  process.exit(attach.status ?? 0);
}

main().catch((err) => {
  process.stderr.write(`[agent-team-launcher] FATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
