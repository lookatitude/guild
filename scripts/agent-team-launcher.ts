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
 *   --dry-run              (optional) Print a pure preview; execute and write nothing.
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
 *   - All real-launch writes stay inside the bound run tree.
 *   - --dry-run is a pure preview: it prints the resolved plan but never invokes
 *     a substrate or writes session, task, receipt, evidence, or run-tree state.
 */

import { spawnSync } from "child_process";
import { createHash } from "crypto";
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
  CmuxTeamBackend,
  probeTmuxAvailable,
  shellQuote,
  type Specialist,
  type LaunchMode,
  type HostKind,
  type RemoteHostTarget,
} from "./lib/team-backend";
import {
  resolvedSpecialistCapabilityScope,
  specialistDispatchKey,
} from "./lib/core/contracts/team-backend";
import {
  buildStationTaskCellResult,
  expandTaskCellLaunchLanes,
  type TaskCellLaunchLane,
} from "./lib/task-cell-launch-plan";
import { writeTeamResult } from "../src/modules/teams/workflows/station-signals";
import type { TaskCellSubstrate } from "./lib/core/contracts/task-cell-backend";
import { validateProjectDefinitionRefV1 } from "./lib/core/contracts/project-definition-ref";
import {
  SPECIALIST_PROFILE_SCHEMA,
  SPECIALIST_TYPE_SCHEMA,
  hashSpecialistProfile,
  hashSpecialistType,
  specialistProfileFromAgentFrontmatter,
  specialistTypeFromTemplateFrontmatter,
  type SpecialistProfileV1,
  type SpecialistTypeV2,
} from "./lib/core/contracts/specialist-identity";
import { parseFrontmatter } from "./lib/frontmatter";
import { definitionRefForDispatch } from "./lib/capability/definition-ref-for-dispatch";
import { buildCompatibilityCatalog, type CompatibilityCatalog } from "./lib/capability/compatibility-catalog";
import { readCompatibilityAsset } from "./lib/capability/compatibility-loader";
import type { CapabilityResolverMode } from "../src/modules/config";
// P1-3 A2b: force-reap of dead panes. (Receipt-based `detectDismissible` is
// retired from the dismiss path — dismissal is acceptance-gated in G4, below.)
import {
  reapDeadMembers,
  sessionJsonPath,
  listRunnableRunIds,
} from "./lib/reaping";
// task-cell-runtime G4: real, confirmed pane termination (replaces signal-only
// [DISMISS]) + the acceptance gate that authorizes it.
import { terminatePane } from "./lib/host/tmux-backend";
import { cmuxLaneStatusKey, terminateCmuxSurface } from "./lib/host/cmux-backend";
// #76 — pane-path dispatch receipts into the orchestrating run's trace.
import { emitPaneDispatchEvents } from "./lib/host/pane-dispatch-trace";
// rf-wi-04 item 2 — durable sink for orphaned remote lanes (Q2a).
import { emitRemoteOrphan } from "./lib/emit-remote-orphan";
import {
  findRunAcceptances,
  findRunTaskCells,
  findOrphanedAttempts,
  readAssignmentForInstance,
  readAttemptForInstance,
  isTerminationAuthorized,
  sealTerminalAttempt,
  markAttemptOrphaned,
  type RunAcceptance,
  type TaskCellInstanceIds,
} from "../src/modules/dispatch/workflows/task-cell-acceptance";
import { reconcileTaskCellLifecycleTelemetry } from "../src/modules/dispatch/workflows/task-cell-telemetry-reconcile";
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
// T3 rework F3 (session_context §5): descriptor writers fail closed without the
// run's minted binding. The launcher resolves the nonce explicitly (env envelope
// from the orchestrator → the addressed run's own minted record → mint, ONLY
// when this launcher itself minted a fresh standalone run-id) and threads it
// into every v1/v2 descriptor write. A sentinel value never participates.
import {
  loadRunBinding,
  readHookBindingEnvelope,
} from "../src/modules/lifecycle/workflows/run-binding";
import { assertCanonicalRunId } from "../src/modules/lifecycle/workflows/run-lifecycle";
// MH-04: the substrate DECISION lives behind the versioned execution port
// (`guild.execution.transports.v1`), never in this launcher. The launcher reads
// host FACTS through the capability probe below and reports what the port decided.
// MH-04 BF-2: execution MECHANICS live there too — every dispatch rung resolves
// its transport through `HostExecutionRuntime.transportFor()` and runs through
// the resolved port. See the composition seam below (§MH-04 transport wiring).
import {
  isTeamDispatchPort,
  resolveInjectionSupport,
  selectExecutionSubstrate,
  type ExecutionCapabilityProbe,
  type ExecutionDispatchMode,
  type ExecutionTransportPort,
  type HostExecutionRuntime,
  type TeamDispatchPort,
} from "../src/modules/dispatch/workflows/execution-transport-ports";
import {
  TeamDispatchExecutionTransport,
  createHostExecutionRuntime,
} from "../src/modules/dispatch/workflows/execution-transport-adapters";
// task-cell-runtime G3: the authoritative `guild.task_assignment.v2` channel
// (per-attempt, one immutable file per task a specialist owns; no representative-
// first-task collapse). Replaces v1 as the PRODUCTION write; v1 is retained above
// only as the frozen-backend pane pointer (GUILD_TASK_ASSIGNMENT — out of G3 scope).
import {
  buildTaskCell,
  planProductionDispatchModel,
  writeTaskCell,
  type ProductionDispatchModelOutcome,
} from "../src/modules/dispatch/workflows/task-assignment-v2";
import { createPreviewConfirmationSession } from "../src/modules/dispatch/workflows/confirmation-gate";
// T8R F3: the PRODUCTION writer for M0 inspection evidence. `persistInspectionReport`
// previously had no production caller at all — `guild models inspect` is read-only by
// contract — so the M2 gate's evidence dir was always empty in a real run and the
// derived resolver inputs were always null. Recording happens HERE, once per run on the
// real dispatch path, and is inert at the ADR defaults (v2 flags off ⇒ no write).
import { recordRunInspectionEvidence } from "../src/modules/capability/workflows/inspection-record";
import { readRoutingFlags } from "../src/modules/capability/workflows/routing-rollout";
// T6 rework F5: the legacy tier→model label for the shadow comparison comes
// from the SAME unpack point the legacy path uses (models.tiers), never a
// parallel implementation.
import { resolveTierModel } from "../src/modules/config/workflows/tier-model";
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
import { slugFromTeamPath, phaseFromTeamPath, readActivePhase, resolveDeadLaneKeys, readPlanOwnerTaskIds } from "./lib/team-file";
// T7-H1: the approve-before-dispatch gate, wired on the REAL dispatch path.
// The gate itself (dispatchGate → preDispatchGate) was correct and unreachable;
// this is the join. It runs BEFORE the D5 ladder so every rung — tmux team,
// in-process agent, and the subagent signal execute-plan acts on — is covered.
import {
  assertDispatchApproved,
  resolveApprovalOverride,
} from "../src/modules/teams/workflows/dispatch-approval";
// TE-01 CONSOLIDATED (cluster-a-rev2-CONSOLIDATED.md): launcher owns EDIT-3 (tmux/remote);
// execute-plan SKILL owns EDIT-4 (subagent/in-process) — mutually exclusive, no double-write.
import { writeTaskRun, readTaskRunCapReqs } from "./write-task-run";
import { emitReadbackDegradation } from "./lib/emit-readback-degradation"; // W2-A2(d)
import { captureHostCapabilitySnapshot } from "../src/modules/host-runtime";

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
   * task-cell-runtime G4: acceptance-gated teardown. When set, requires --run-id.
   * Terminates a lane ONLY when a durable `guild.handoff_acceptance.v1` record
   * authorizes it (accepted or rejected) — a receipt on disk alone never does (D5).
   * Kills the shared per-specialist pane only once ALL that specialist's task-cells
   * are terminal (G4 M2), then seals `guild.task_attempt.v1` terminal records; a
   * kill that fails to confirm parks the attempt orphaned for `--reap` to retry.
   * Falls through to reapDeadMembers for registry hygiene. Always exits 0.
   */
  dismissCompleted: boolean;
  /**
   * T7-H1 LEGACY: accepted and ignored. Approve-before-dispatch verification is
   * now UNCONDITIONAL, so there is nothing left to force on.
   */
  requireApproval: boolean;
  /**
   * T7R-R1-B1: the ONE audited escape hatch. `--approval-override "<reason>"`
   * lets an un-migrated caller dispatch DESPITE an approval refusal. The value
   * is the operator's stated reason; a boolean-shaped value ("1"/"true"/…) is
   * REFUSED, and the override is written to a durable audit log before any pane
   * is created. It is reported as a degradation, never as a pass.
   */
  approvalOverride: string | null;
}

// ── CLI parsing ────────────────────────────────────────────────────────────

const VALID_AGENT_MODE_VALUES = new Set(["team", "agent", "subagent", "auto"]);

function requiredOptionValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new Error(`${option} requires a non-flag value`);
  }
  return value;
}

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
    requireApproval: false,
    approvalOverride: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--team") out.team = requiredOptionValue(argv, i++, a);
    else if (a === "--session-name") out.sessionName = requiredOptionValue(argv, i++, a);
    else if (a === "--cwd") out.cwd = requiredOptionValue(argv, i++, a);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--reap") out.reap = true;
    else if (a === "--dismiss-completed") out.dismissCompleted = true;
    else if (a === "--require-approval") out.requireApproval = true;
    else if (a === "--approval-override") out.approvalOverride = requiredOptionValue(argv, i++, a);
    else if (a.startsWith("--approval-override=")) {
      out.approvalOverride = a.slice("--approval-override=".length);
    }
    else if (a === "--run-id") out.runId = requiredOptionValue(argv, i++, a);
    else if (a.startsWith("--agent-mode=")) {
      const v = a.slice("--agent-mode=".length);
      if (VALID_AGENT_MODE_VALUES.has(v)) out.agentMode = v as CliArgs["agentMode"];
    }
  }
  if (out.reap && out.dismissCompleted) {
    throw new Error("--reap and --dismiss-completed are mutually exclusive maintenance modes");
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

export function parseYaml(raw: string): TeamYaml {
  const lines = raw.split(/\r?\n/);
  let backend = "";
  const specialists: Specialist[] = [];
  let inSpecialists = false;
  let cur: Partial<Specialist> | null = null;

  const flush = () => {
    if (cur && cur.name) {
      if (cur.definition_ref && cur.definition_ref.id !== cur.name) {
        throw new Error(`team.yaml definition_ref id ${cur.definition_ref.id} disagrees with specialist ${cur.name}`);
      }
      if (cur.definition_ref && cur.definition && cur.definition_ref.relative_path !== cur.definition) {
        throw new Error(`team.yaml definition_ref path ${cur.definition_ref.relative_path} disagrees with definition ${cur.definition}`);
      }
      specialists.push({
        name: cur.name,
        participant_id: cur.participant_id,
        scope: cur.scope ?? "",
        dependsOn: cur.dependsOn ?? [],
        backend: cur.backend,
        host_kind: cur.host_kind,
        // ARCH-6 Part 1: tier precedence — scored `tier:` (Part 2, execute-plan) >
        // authoring `default_tier:` (team-compose) > undefined (opts.tier mid fallback).
        // This ensures generated teams (default_tier only) route at their roster tier,
        // not collapse to mid. Scored tier wins when execute-plan writes it.
        tier: cur.tier ?? cur.default_tier,
        // rf-wi-03 (G3): the raw cost score, carried through to GUILD_TIER_SCORE
        // on the dispatch env (audit-only). Undefined until a producer writes it.
        score: cur.score,
        capabilityRequirements: cur.capabilityRequirements, // GAP-A1/ARCH-2 (may be undefined)
        // FU09: explicit approved scopes win; canonical roles otherwise receive
        // their source-owned runtime default. Unknown/project roles retain the
        // legacy optional behavior until their approved team record supplies one.
        declared_capability_scope:
          cur.capability_scope === undefined ? undefined : [...cur.capability_scope],
        capability_scope: resolvedSpecialistCapabilityScope({
          name: cur.name,
          scope: cur.scope ?? "",
          dependsOn: cur.dependsOn ?? [],
          capability_scope: cur.capability_scope,
        }),
        // Agent-definition path + source (team-compose writes them; load-bearing
        // for project-local specialists — buildPrompt embeds the adoption
        // instruction and in-process dispatch swaps to the generic subagent type).
        definition: cur.definition,
        definition_source: cur.definition_source,
        definition_ref: cur.definition_ref,
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
  else if (key === "participant_id" || key === "participant-id") {
    target.participant_id = stripQuotes(value);
  }
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
  else if (key === "definition_ref") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripQuotes(value));
    } catch {
      throw new Error("team.yaml definition_ref must be single-line JSON");
    }
    const ref = validateProjectDefinitionRefV1(parsed);
    if (!ref) throw new Error("team.yaml definition_ref is invalid");
    if (target.name && target.name !== ref.id) {
      throw new Error(`team.yaml definition_ref id ${ref.id} disagrees with specialist ${target.name}`);
    }
    if (target.definition && target.definition !== ref.relative_path) {
      throw new Error(`team.yaml definition_ref path ${ref.relative_path} disagrees with definition ${target.definition}`);
    }
    target.definition_ref = ref;
  }
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
  // rf-wi-03 (G3): the raw cost-scorer `score:` for this specialist, when a
  // producer wrote one back to team.yaml. composeInProcessDispatch carries it as
  // GUILD_TIER_SCORE (audit-only — the tier guard never gates on it). Populating
  // this key is the execute-plan writeback's job (a followup owned by rf-wi-06,
  // the SKILL-surface lane); the parse + descriptor plumbing is complete here so
  // the value flows the moment the writeback emits it.
  else if (key === "score") {
    const s = stripQuotes(value).trim();
    // Guard the empty string — Number("") === 0 would fabricate a score of 0
    // where none was written ("never a fake value"). A real 0 (cheap lane) is a
    // non-empty "0" and still parses.
    if (s.length > 0) {
      const n = Number(s);
      if (Number.isFinite(n)) target.score = n;
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
  backend: "tmux" | "cmux";
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
  // D-CAP/FU09: `capability_scope` remains additive for unknown/project roles,
  // but canonical role omissions are materialized from source-owned defaults
  // before this manifest or any dispatch carrier is emitted.
  teammate_panes: Array<{
    specialist: string;
    task_id?: string;
    dispatch_key?: string;
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
  backend?: "tmux" | "cmux";
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
    backend = "tmux",
  } = opts;
  const paneHosts = [
    orchestratorHostKind,
    ...specialists.map((s) => s.host_kind ?? orchestratorHostKind),
  ];
  // W4 D1: registry bridge — exact isClaudeCli() replaces `.includes("claude")` literal check.
  const hasClaudePane = paneHosts.some((h) => isClaudeCli(h));
  return {
    run_id: runId,
    backend,
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
      task_id: s.taskId,
      dispatch_key: specialistDispatchKey(s),
      pane_id: dryRun
        ? "(dry-run: not spawned)"
        : realPaneIds?.teammates?.[specialistDispatchKey(s)] ?? "(unknown)",
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

function writeManifest(cwd: string, manifest: Manifest): string {
  const runId = manifest.run_id;
  const dir = path.join(cwd, ".guild", "runs", runId, "agent-team");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, "session.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return out;
}

/**
 * Emit the authoritative `guild.task_assignment.v2` channel (ADR
 * `task-cell-runtime-contract.md` D6): ONE immutable assignment file — plus its
 * `guild.task_attempt.v1` companion — per TASK a specialist owns. Never keyed by
 * specialist name, never collapsed to a representative first task. A specialist
 * owning ≥2 tasks therefore lands ≥2 distinct files at distinct canonical run-tree
 * paths, none overwritten (P0.3 / adversarial test 1); each carries its own
 * instance id, context pointer, and handoff path.
 *
 * Fail-closed (D6) — a malformed assignment or an overwrite is a HARD dispatch
 * failure, NOT log-and-continue: `writeTaskCell` throws and the throw propagates
 * out of `main()` to a non-zero exit. This deliberately drops the v1 writer's
 * "warn and keep going" behavior for the v2 production path.
 */
/**
 * T6 F5: the ONE lane model-routing step, shared by every dispatch rung.
 *
 * Reads the rollout flags + the legacy `models.tiers` label ONCE, then plans
 * per dispatch attempt through the production function. The returned planner
 * STAMPS `s.modelProvenance` — which is what the backends consume
 * (`dispatchModelForSpecialist`) to spawn the lane at the selected model — so
 * the tmux rung (task cells) and the in-process rung both route identically
 * instead of only the tmux rung carrying provenance.
 *
 * At M0/M1 the plan returns the legacy selection and stamps no model: every
 * backend's command/descriptor stays byte-identical to today.
 */
function makeLaneModelPlanner(
  cwd: string,
  runId: string,
  orchestratorHostKind: string,
  bindingRef: string,
  preview: boolean,
): (
  s: Specialist,
  logicalTaskId: string,
) => { outcome: ProductionDispatchModelOutcome; laneTier: "cheap" | "mid" | "powerful" } {
  const previewConfirmationSession = preview
    ? createPreviewConfirmationSession(cwd, runId)
    : undefined;
  let rawSettings: unknown;
  try {
    rawSettings = JSON.parse(
      fs.readFileSync(path.join(cwd, ".guild", "settings.json"), "utf8"),
    );
  } catch {
    rawSettings = undefined;
  }
  const settingsObj = isPlainObject(rawSettings) ? (rawSettings as Record<string, unknown>) : {};
  const { flags: routingFlags } = readRoutingFlags(rawSettings);
  const modelsBlock = isPlainObject(settingsObj["models"])
    ? (settingsObj["models"] as Record<string, unknown>)
    : {};
  let previewStageEvolutionNoticeEmitted = false;
  // ── T8R F3: record this run's M0 inspection evidence ONCE, before any lane
  // plans a model. This is the production write that was missing: without it
  // `.guild/runs/<id>/inspection/` stays empty in every real run, so
  // `deriveResolveInputsFromM0Evidence` finds nothing and M2 can never reach a
  // v2 selection no matter how the flags are set.
  //
  // Inert at the ADR defaults — the recorder returns `recorded: false` and
  // writes nothing unless `model_routing.shadow` or `model_routing.enabled` is
  // on, so M0 dispatch stays byte-identical to legacy. An unverifiable binding
  // THROWS out of the binding-verified writer rather than dispatching on
  // unbound evidence; absence (no session context, no usable report) is
  // reported honestly and never fabricated.
  if (!preview) {
    const inspection = recordRunInspectionEvidence({
      root: cwd,
      binding: { run_id: runId, binding_ref: bindingRef },
      now: new Date().toISOString(),
    });
    if (inspection.recorded) {
      process.stdout.write(
        `[agent-team-launcher] M0 inspection evidence recorded for ${runId} → ${inspection.ref}\n`,
      );
    }
  }
  return (s, logicalTaskId) => {
    const hostKind = s.host_kind ?? orchestratorHostKind;
    // The legacy selection this lane would dispatch with today — the SAME
    // models.tiers unpack the legacy path uses. An unresolvable tier slot is
    // recorded honestly, never invented.
    const laneTier = s.tier ?? s.default_tier ?? "mid";
    const legacyResolved = resolveTierModel(modelsBlock["tiers"], laneTier, hostKind);
    const legacy = {
      model: legacyResolved.model ?? "unspecified",
      source: `tier_map:${laneTier}${legacyResolved.model ? "" : ":unresolved"}`,
    };
    const outcome = planProductionDispatchModel({
      cwd,
      runId,
      dispatchId: `${logicalTaskId}.att1`,
      binding: { binding_ref: bindingRef },
      legacy,
      settings: rawSettings,
      request: { purpose: "implementation" },
      preview,
      previewConfirmationSession,
    });
    // A pure preview cannot persist the M0 inspection + M1 comparison that a
    // fresh real run creates between lane plans. With both staged legs opted
    // in, a later real lane can therefore reach M2 (and §6 confirmation) even
    // while every preview lane honestly remains legacy against the unchanged
    // tree. Make that unresolved transition operator-visible once; exit 0 is
    // never presented as proof that the real run is confirmation-ready.
    if (
      preview &&
      !previewStageEvolutionNoticeEmitted &&
      routingFlags["model_routing.shadow"] === "on" &&
      routingFlags["model_routing.enabled"] === "on" &&
      outcome.selection.source === "legacy" &&
      /M[01] not evidenced/.test(outcome.selection.reason)
    ) {
      previewStageEvolutionNoticeEmitted = true;
      process.stdout.write(
        `[agent-team-launcher] BLOCKED PREVIEW: this pure preview cannot persist the fresh-run ` +
          `M0/M1 evidence that real dispatch creates between lanes; a later-lane M2 selection ` +
          `may therefore require §6 confirmation. Do not treat preview exit 0 as dispatch-ready.\n`,
      );
    }
    // The specialist dispatch contract carries the provenance on the real path
    // — this is the object every backend reads the selected model from.
    s.modelProvenance = outcome.provenance;
    if (outcome.shadowArtifacts.comparisonPath) {
      process.stdout.write(
        `[agent-team-launcher] M1 shadow comparison recorded for ${logicalTaskId} → ` +
          `${path.relative(cwd, outcome.shadowArtifacts.comparisonPath)}\n`,
      );
    }
    if (outcome.selection.source === "v2") {
      process.stdout.write(
        `[agent-team-launcher] M2 v2 selection for ${logicalTaskId}: ` +
          `${outcome.selection.model} (${outcome.selection.reason})\n`,
      );
    }
    // T7-M4 — §6 exact-key confirmation gate on the REAL dispatch path.
    // A v2 selection that DEGRADES and whose purpose policy requires
    // confirmation may not dispatch on an unanswered prompt. Guild never
    // auto-approves a degradation, and an approval recorded for a different
    // target / purpose / policy / catalog / fallback shape is a DIFFERENT key
    // and therefore no approval at all (the arbiter enforces that, exactly).
    // Inert at M0/M1: legacy selections degrade nothing, so nothing is claimed.
    if (!preview && outcome.confirmation.required && !outcome.confirmation.decided) {
      throw new Error(
        `confirmation_required: refusing to dispatch ${logicalTaskId} — ${outcome.confirmation.reason}`,
      );
    }
    if (outcome.confirmation.required) {
      process.stdout.write(
        `[agent-team-launcher] §6 confirmation prompt ${outcome.confirmation.prompt_id} for ` +
          `${logicalTaskId} ${preview ? "previewed" : `already decided "${outcome.confirmation.decision}"`}\n`,
      );
      if (preview && !outcome.confirmation.decided) {
        process.stdout.write(
          `[agent-team-launcher] BLOCKED PREVIEW: a real dispatch of ${logicalTaskId} will refuse ` +
            `until §6 prompt ${outcome.confirmation.prompt_id} receives a user decision.\n`,
        );
      }
    }
    return { outcome, laneTier };
  };
}

function sha256Prefixed(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function readRegularFile(file: string): Buffer | null {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() ? fs.readFileSync(file) : null;
  } catch {
    return null;
  }
}

const compatibilityCatalogCache = new Map<string, CompatibilityCatalog>();

function compatibilityResolverMode(cwd: string): CapabilityResolverMode {
  try {
    return resolveSettings({ cwd }).config.capability.resolver_mode;
  } catch {
    // The shared default is observe. A settings read failure must not silently
    // turn an instrumented legacy read back into an unmeasured direct read.
    return "observe";
  }
}

function readSpecialistTemplateCompatibility(
  cwd: string,
  runId: string,
  logicalTaskId: string,
  specialist: TaskCellLaunchLane,
  runtimeRoot: string,
): Buffer | null {
  const mode = compatibilityResolverMode(cwd);
  if (mode === "project-local" || mode === "strict") return null;

  let catalog = compatibilityCatalogCache.get(runtimeRoot);
  if (!catalog) {
    catalog = buildCompatibilityCatalog({
      pluginRoot: runtimeRoot,
      deprecation: "deprecated",
      deprecatedBy: "cap-loc-D03",
    });
    compatibilityCatalogCache.set(runtimeRoot, catalog);
  }
  const entry = catalog.entries.find(
    (candidate) => candidate.kind === "shipped_template" && candidate.id === specialist.name,
  );
  if (!entry) return null;

  const loaded = readCompatibilityAsset({
    pluginRoot: runtimeRoot,
    projectRoot: cwd,
    entry,
    mode,
    intent: "dispatch",
    synthetic: false,
    specialistId: specialist.name,
    runId,
    operationId: `task-cell-identity-${safeSegment(logicalTaskId)}-${safeSegment(specialist.name)}`,
    recordedAt: new Date().toISOString(),
  });
  if (loaded.status !== "loaded") {
    throw new Error(
      `compatibility_read_refused: ${specialist.name}/${logicalTaskId} — ${loaded.detail}`,
    );
  }
  return loaded.bytes;
}

function specialistIdentity(
  cwd: string,
  runId: string,
  logicalTaskId: string,
  specialist: TaskCellLaunchLane,
): {
  typeId: string;
  typeVersion: string;
  typeHash: string;
  profileId: string;
  profileHash: string;
} {
  const ref = specialist.definition_ref;
  if (ref?.specialist_type_hash && ref.specialist_profile_hash) {
    return {
      typeId: specialist.name,
      typeVersion: "1",
      typeHash: ref.specialist_type_hash,
      profileId: specialist.name,
      profileHash: ref.specialist_profile_hash,
    };
  }

  const runtimeRoot = process.env["GUILD_PLUGIN_ROOT"] ??
    process.env["CLAUDE_PLUGIN_ROOT"] ?? path.resolve(__dirname, "..");
  const definitionRoot = specialist.definition_source === "project" ? cwd : runtimeRoot;
  const definitionPath = specialist.definition
    ? path.resolve(definitionRoot, specialist.definition)
    : null;
  const definitionBytes = definitionPath ? readRegularFile(definitionPath) : null;
  const templateBytes = readSpecialistTemplateCompatibility(
    cwd,
    runId,
    logicalTaskId,
    specialist,
    runtimeRoot,
  );
  const templateFm = templateBytes ? parseFrontmatter(templateBytes.toString("utf8")) : null;
  const projectedType = templateFm
    ? specialistTypeFromTemplateFrontmatter(templateFm)
    : null;
  const pinnedSkillIds = (ref?.skills ?? []).map((skill) => skill.id);
  const inlineType: SpecialistTypeV2 = projectedType ?? {
    schema_version: SPECIALIST_TYPE_SCHEMA,
    type_id: specialist.name,
    version: "inline-team-v1",
    role: specialist.name,
    capability_tags: [],
    compatible_skill_refs: pinnedSkillIds,
    semantic_tool_requirements: specialist.capability_scope ?? [],
    default_model_tier: specialist.tier ?? specialist.default_tier ?? "mid",
    constraints: {
      definition_source: specialist.definition_source ?? "inline-team",
      definition_path: specialist.definition ?? null,
      definition_content_hash: definitionBytes ? sha256Prefixed(definitionBytes) : null,
    },
    eval_fixture_refs: [],
  };
  const typeHash = hashSpecialistType(inlineType);
  const definitionFm = definitionBytes ? parseFrontmatter(definitionBytes.toString("utf8")) : null;
  const projectedProfile = definitionFm
    ? specialistProfileFromAgentFrontmatter(definitionFm, {
        type_id: inlineType.type_id,
        type_version: inlineType.version,
        type_hash: typeHash,
      })
    : null;
  const profile: SpecialistProfileV1 = projectedProfile ?? {
    schema_version: SPECIALIST_PROFILE_SCHEMA,
    profile_id: specialist.name,
    version: "inline-team-v1",
    derived_from: {
      type_id: inlineType.type_id,
      type_version: inlineType.version,
      type_hash: typeHash,
    },
    project_instructions: definitionBytes
      ? `definition_content_hash=${sha256Prefixed(definitionBytes)}`
      : `inline_team_contract=${sha256Prefixed(JSON.stringify({
          name: specialist.name,
          scope: specialist.scope,
          dependsOn: specialist.dependsOn,
          capability_scope: specialist.capability_scope ?? [],
        }))}`,
    local_skill_refs: pinnedSkillIds,
  };
  return {
    typeId: inlineType.type_id,
    typeVersion: inlineType.version,
    typeHash,
    profileId: profile.profile_id,
    profileHash: hashSpecialistProfile(profile),
  };
}

function contextBundleHash(cwd: string, relativePath: string, dryRun: boolean): string {
  const bytes = readRegularFile(path.resolve(cwd, relativePath));
  if (bytes) return sha256Prefixed(bytes);
  if (dryRun) return sha256Prefixed(`dry-run-missing-context:${relativePath}`);
  throw new Error(`missing regular TaskCell context bundle: ${relativePath}`);
}

function hostCapabilitiesHash(cwd: string, runId: string, hostId: string, dryRun: boolean): string {
  const manifest = readRegularFile(path.join(cwd, ".guild", "hosts", hostId, "capability.json"));
  if (manifest) return sha256Prefixed(manifest);
  const captured = captureHostCapabilitySnapshot({ host: hostId, runId });
  if (captured.disposition === "succeeded" && captured.snapshot) {
    return captured.snapshot.snapshot_hash;
  }
  if (dryRun) return sha256Prefixed(`dry-run-host-capabilities:${hostId}`);
  throw new Error(`no capability manifest or registry snapshot for selected host: ${hostId}`);
}

function emitTaskCellsV2(
  cwd: string,
  runId: string,
  slug: string,
  specialists: readonly TaskCellLaunchLane[],
  phaseId: string,
  substrate: TaskCellSubstrate,
  hostIdFor: (specialist: TaskCellLaunchLane) => string,
  bindingRef: string | null,
  dryRun: boolean,
): number {
  // §5 + D6: the v2 channel is HARD fail-closed — a run with no verifiable
  // binding cannot dispatch. Throw (propagates to a non-zero exit).
  if (bindingRef === null) {
    throw new Error(
      `binding_rejected: refusing to emit guild.task_assignment.v2 cells for ` +
        `${runId} — no minted run binding is resolvable (session_context §5)`,
    );
  }
  // Fix B (run-identity-and-dispatch): a DRY preflight persists NOTHING. The
  // records this function writes are immutable attempt-1 files whose overwrite
  // guard fails closed — a dry run that wrote them poisoned the run id for the
  // next real launch. Pre-fix, this flag only relaxed hash computation while
  // the writes below still ran unconditionally.
  if (dryRun) return 0;
  let written = 0;
  // Resolved decision 2: the launcher reuses the parent orchestrator as lead, so
  // every cell carries a `lead_binding_id` (no distinct Team Lead instance minted).
  const leadBindingId = `lead-binding-${safeSegment(slug)}`;
  for (const s of specialists) {
    const hostId = hostIdFor(s);
    const logicalTaskId = s.taskId;
    const identity = specialistIdentity(cwd, runId, logicalTaskId, s);
    const tools = s.capability_scope ?? [];
    // Fresh, per-TASK context pointer — never shared across a specialist's tasks (D3).
    const contextRef = path.join(".guild", "context", runId, `${s.name}-${logicalTaskId}.md`);
    const cell = buildTaskCell({
        runId,
        logicalTaskId,
        taskRunId: `${logicalTaskId}.tr1`,
        attempt: 1,
        attemptId: `${logicalTaskId}.att1`,
        instanceId: s.task_cell_instance_id,
        cellId: `cell-${logicalTaskId}`,
        goalId: `goal-${safeSegment(slug)}`,
        phaseId,
        stepId: logicalTaskId,
        teamId: safeSegment(slug),
        workerRole: s.name,
        specialistTypeId: identity.typeId,
        specialistTypeVersion: identity.typeVersion,
        specialistTypeHash: identity.typeHash,
        specialistProfileId: identity.profileId,
        specialistProfileHash: identity.profileHash,
        contextBundleId: contextRef,
        contextBundleHash: contextBundleHash(cwd, contextRef, dryRun),
        hostId,
        adapterId: `${hostId}@${ADAPTER_VERSION}`,
        hostCapabilitiesHash: hostCapabilitiesHash(cwd, runId, hostId, dryRun),
        substrate,
        modelTier: s.tier ?? s.default_tier ?? "mid",
        modelId: s.modelProvenance?.selected_model ?? null,
        // objective must be non-empty (D6 fail-closed); fall back for a degenerate
        // team file rather than dropping the lane silently.
        objective: s.scope && s.scope.length > 0 ? s.scope : `implement ${logicalTaskId}`,
        nonGoals: [],
        scopePaths: [],
        outputSchema: "guild.handoff_receipt.v1",
        acceptanceTests: [],
        dependencies: (s.dependsOn ?? []).map((d) => ({
          logical_task_id: d,
          accepted_artifact_ref: null,
        })),
        projection: { tools, permissions: [], recorded_losses: [] },
        autonomyPolicy: "supervised",
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
        deadline: null,
        leadBindingId,
        now: () => new Date().toISOString(),
    });
    writeTaskCell(cwd, cell, { binding_ref: bindingRef });
    written += 1;
  }
  return written;
}

/**
 * Settle immutable cmux TaskCell attempts after a launch failure.
 *
 * The backend returns only rollback survivors in `unconfirmedPaneIds`. Those
 * exact instances remain non-terminal and orphaned for the reaper. Every other
 * written attempt is sealed `failed`; no launch failure may strand a normal
 * attempt in an unexplained open state.
 */
export function settleFailedCmuxTaskCells(input: {
  cwd: string;
  runId: string;
  lanes: readonly TaskCellLaunchLane[];
  unconfirmedPaneIds: Readonly<Record<string, string>>;
  reason: string;
  now?: () => string;
}): { failed: number; orphaned: number; errors: string[] } {
  const now = input.now ?? (() => new Date().toISOString());
  let failed = 0;
  let orphaned = 0;
  const errors: string[] = [];
  for (const lane of input.lanes) {
    const logicalTaskId = lane.taskId ?? lane.name;
    const instanceId = lane.task_cell_instance_id;
    if (!instanceId) {
      errors.push(`${logicalTaskId}: missing task_cell_instance_id`);
      continue;
    }
    const ids: TaskCellInstanceIds = {
      run_id: input.runId,
      logical_task_id: logicalTaskId,
      attempt: 1,
      instance_id: instanceId,
    };
    try {
      if (input.unconfirmedPaneIds[specialistDispatchKey(lane)]) {
        markAttemptOrphaned(input.cwd, ids);
        orphaned += 1;
      } else {
        sealTerminalAttempt({
          cwd: input.cwd,
          ids,
          terminal_state: "failed",
          reason: input.reason,
          now,
        });
        failed += 1;
      }
    } catch (error) {
      errors.push(`${logicalTaskId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { failed, orphaned, errors };
}

/**
 * Collapse anything outside the safe path-segment class ([A-Za-z0-9_.-]) so a
 * canonical run-tree segment is never silently rejected by `taskCellPaths`. Plan
 * task-ids and specialist names are already slug-safe; this is defensive.
 */
function safeSegment(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function writeLaunchTeamResult(
  cwd: string,
  runId: string,
  teamPath: string,
  lanes: readonly TaskCellLaunchLane[],
): string {
  return writeTeamResult(cwd, runId, buildLaunchTeamResult(runId, teamPath, lanes));
}

function buildLaunchTeamResult(
  runId: string,
  teamPath: string,
  lanes: readonly TaskCellLaunchLane[],
): ReturnType<typeof buildStationTaskCellResult> {
  const station = phaseFromTeamPath(teamPath) ?? "build";
  const planRef = path.join(".guild", "runs", runId, "team-plan", `${station}.json`);
  return buildStationTaskCellResult(station, planRef, lanes);
}

/**
 * Resolve the run's minted binding nonce for descriptor writes (T3 F3, §5).
 *
 *  1. The orchestrator-exported hook envelope (GUILD_RUN_ID +
 *     GUILD_RUN_BINDING_REF), accepted ONLY when it names this exact run.
 *  2. The explicitly-addressed run's own minted record (schema-validated on
 *     load — a malformed record loads as null and is refused, F1).
 *  3. When THIS launcher minted a fresh standalone run-id (no --run-id), it is
 *     the run-starting actor: mint the binding before any write (F2).
 *
 * Returns null when a caller-supplied run has no verifiable binding — the
 * descriptor writers then fail closed (`binding_rejected`), never fail open.
 */
function resolveLaunchBindingRef(cwd: string, runId: string): string | null {
  const envelope = readHookBindingEnvelope(process.env);
  if (envelope && envelope.run_id === runId) return envelope.binding_ref;
  const record = loadRunBinding({ root: cwd, run_id: runId });
  if (record) return record.binding_ref;
  return null;
}

/**
 * W1/W2: consume the lifecycle-owned identity. The launcher is a dispatch
 * consumer, never a run-starting actor: an explicit caller id wins, otherwise
 * the lifecycle sentinel is inherited. Both paths are strict and binding-
 * backed before any dispatch state can be created.
 */
function resolveLifecycleRunId(cwd: string, callerRunId: string | null): string {
  let source = "--run-id";
  let candidate = callerRunId;
  if (!candidate) {
    source = ".guild/runs/current-run-id";
    const sentinel = path.join(cwd, ".guild", "runs", "current-run-id");
    try {
      candidate = fs.readFileSync(sentinel, "utf8").trim();
    } catch {
      throw new Error(
        "lifecycle run id required: pass --run-id or start the Guild lifecycle so .guild/runs/current-run-id exists",
      );
    }
  }
  assertCanonicalRunId(candidate);
  if (!loadRunBinding({ root: cwd, run_id: candidate })) {
    throw new Error(
      `binding_rejected: lifecycle run id ${candidate} from ${source} has no minted run binding`,
    );
  }
  return candidate;
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
    const ch = config.defaults.cross_host;
    // R-018: capability_manifest_ttl_s lives under defaults.*, not under cross_host.
    const rawTtl = config.defaults.capability_manifest_ttl_s;
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
// The ladder itself (D5, v2x-command-surface-dispatch-and-internalization.md) is
// NOT decided here. MH-04 moved it behind `selectExecutionSubstrate` in the
// versioned execution port, because a generic launcher may not own substrate,
// lifecycle, or gate policy (runtime-boundary contract BR-04 / MHRC-MOD-003).
//
// What stays here is the launcher's legitimate half: reading host FACTS
// (`$TMUX`, tmux availability, the host's independent-agent signal) and printing
// whatever the port decided. The facts are read LAZILY, through the probe below,
// so the port performs exactly the probes the shipped ladder performed — an
// explicit `--agent-mode` pin still spawns no `tmux -V` subprocess.

type AgentModeExplicit = "team" | "agent" | "subagent" | "auto";
interface ResolvedMode {
  mode: ExecutionDispatchMode;
  reason: string;
  /**
   * W4: the transport the selection named ("cmux" | "tmux" | "in-process" |
   * null). Carried so the launcher can hand a cmux-selected team back to the
   * lead (visible cmux surfaces) instead of disguising it as a tmux launch.
   */
  transport: string | null;
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
 * The launcher's host-fact probe. Every member is a FACT read, not a decision:
 * am I inside a multiplexer, is one installed, does this host signal independent
 * agents. The port calls only the ones its ladder needs.
 */
const executionCapabilityProbe: ExecutionCapabilityProbe = {
  // W4: the cmux workspace fact — rung 0 of `team` in the ladder, checked
  // before any tmux probe. A cheap env read, no subprocess.
  insideCmuxWorkspace: () => (process.env["CMUX_WORKSPACE_ID"] ?? "").trim().length > 0,
  insideMultiplexer: () => !!process.env["TMUX"],
  multiplexerAvailable: () => probeTmuxAvailable(),
  independentAgents: () => hostSupportsIndependentAgents(),
};

// ── MH-04 transport wiring — the launcher's ONLY substrate construction site ──
//
// BF-2: no dispatch path below constructs or drives a backend. Each rung asks
// this seam for the bounded transport PORT its substrate is behind, hands it to
// the versioned runtime, resolves it through `transportFor()`, and executes
// through the resolved port. The functions here exist solely to inject a shipped
// substrate into a bounded adapter — they perform no dispatch themselves.

/** The in-process (Agent-tool) substrate, behind the versioned dispatch port. */
function inProcessTransportPort(): ExecutionTransportPort {
  return new TeamDispatchExecutionTransport({
    transport_id: "in-process",
    backend: new InProcessTeamBackend(),
    supports_definition_injection: true,
  });
}

/** The remote (ssh) substrate, behind the versioned dispatch port. */
function remoteTransportPort(opts: {
  resolveHostTarget: (spec: Specialist) => RemoteHostTarget;
  warn?: (message: string) => void;
}): ExecutionTransportPort {
  return new TeamDispatchExecutionTransport({
    transport_id: "remote",
    backend: new RemoteTeamBackend({
      transport: new SshRemoteTransport(),
      resolveHostTarget: opts.resolveHostTarget,
      resolveAdapter: resolveAdapter(),
      warn: opts.warn,
    }),
  });
}

/**
 * The tmux substrate, behind the versioned dispatch port. tmux is the one
 * substrate that owns an addressable session namespace, so the SAME backend is
 * injected twice: once as the launch backend, once as the session seam that
 * carries availability, collision, preflight and session identity.
 */
function tmuxTransportPort(adapterBacked: boolean): ExecutionTransportPort {
  const backend = new TmuxTeamBackend(
    adapterBacked ? { resolveAdapter: resolveAdapter() } : {}
  );
  return new TeamDispatchExecutionTransport({
    transport_id: "tmux",
    backend,
    session: backend,
    // Fix A (run-identity-and-dispatch): the tmux substrate now demonstrably
    // carries the exact ref — paneCommand exports GUILD_DEFINITION_REF on the
    // claude branch, and both the backend launch and the session path expose
    // the per-specialist forwarding proof on dispatch_plan, which reportLaunch
    // verifies via portHonoredInjection before claiming success. Declaring
    // without that proof was refused by contract ("opt-in only after this
    // substrate demonstrably carries the exact ref").
    supports_definition_injection: true,
  });
}

/** First-class cmux surface substrate behind the same run-scoped port. */
function cmuxTransportPort(workspaceId: string, adapterBacked: boolean): ExecutionTransportPort {
  return new TeamDispatchExecutionTransport({
    transport_id: "cmux",
    backend: new CmuxTeamBackend({
      workspaceId,
      ...(adapterBacked ? { resolveAdapter: resolveAdapter() } : {}),
    }),
    supports_definition_injection: true,
  });
}

interface ResolvedDispatchPort {
  port: TeamDispatchPort | null;
  detail: string;
}

/**
 * Resolve a transport through the versioned runtime.
 *
 * EVERY failure is a closed typed outcome the launcher translates into its own
 * UX: an unregistered transport, a port pinned to a foreign contract major, and
 * a port that cannot perform run-scoped dispatch all come back refused. There is
 * no fallback to direct construction — a launcher that could fall back would not
 * actually depend on the runtime.
 */
function resolveDispatchPort(
  runtime: HostExecutionRuntime,
  transportId: string
): ResolvedDispatchPort {
  const bound = runtime.transportFor(transportId);
  if (bound.status !== "succeeded" || !bound.value) {
    return {
      port: null,
      detail:
        bound.detail ??
        `the runtime refused transport "${transportId}" (${bound.status}/${bound.reason_code ?? "no reason"})`,
    };
  }
  if (!isTeamDispatchPort(bound.value)) {
    return {
      port: null,
      detail: `transport "${transportId}" resolved but does not implement run-scoped dispatch`,
    };
  }
  return { port: bound.value, detail: "" };
}

// ── W4: the frozen run-start backend decision (independent-review blocker 1) ─

interface FrozenDispatchResolution {
  backend: "cmux" | "tmux" | "agent" | "subagent";
  reason: string;
}

/**
 * Read the run's frozen `snapshot.dispatch` block from
 * `.guild/runs/<run-id>/resolved-settings.json` (written once by
 * runStartPreflight/U6 at intake). A genuinely absent file is a legacy run and
 * keeps the ambient ladder. A present malformed file is a broken authority
 * record and fails closed; it must never authorize an ambient backend switch.
 */
function readFrozenDispatchResolution(
  cwd: string,
  runId: string | null
): FrozenDispatchResolution | null {
  if (runId === null || runId.length === 0) return null;
  const snapshotPath = path.join(cwd, ".guild", "runs", runId, "resolved-settings.json");
  if (!fs.existsSync(snapshotPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  } catch {
    throw new Error(`frozen dispatch authority is unreadable: ${snapshotPath}`);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(`frozen dispatch authority is not an object: ${snapshotPath}`);
  }
  const snapshot = parsed as Record<string, unknown>;
  if (snapshot["schema_version"] !== "guild.resolved_settings.v1") {
    throw new Error(`frozen dispatch authority has the wrong schema: ${snapshotPath}`);
  }
  const dispatch = snapshot["dispatch"];
  if (dispatch === null || typeof dispatch !== "object") {
    throw new Error(`frozen dispatch authority has no valid dispatch block: ${snapshotPath}`);
  }
  const d = dispatch as Record<string, unknown>;
  const backend = d["backend"];
  if (backend !== "cmux" && backend !== "tmux" && backend !== "agent" && backend !== "subagent") {
    throw new Error(`frozen dispatch authority has an invalid backend: ${snapshotPath}`);
  }
  return {
    backend,
    reason:
      typeof d["reason"] === "string" && d["reason"].length > 0
        ? d["reason"]
        : "run-start snapshot.dispatch",
  };
}

/** Map a frozen backend value onto the launcher's resolved-mode vocabulary. */
function resolvedModeFromFrozen(frozen: FrozenDispatchResolution): ResolvedMode {
  const reason = `frozen at run start (snapshot.dispatch): ${frozen.reason}`;
  switch (frozen.backend) {
    case "cmux":
      return { mode: "team", transport: "cmux", reason };
    case "tmux":
      return { mode: "team", transport: "tmux", reason };
    case "agent":
      return { mode: "agent", transport: "in-process", reason };
    case "subagent":
      return { mode: "subagent", transport: null, reason };
  }
}

/** Resolved scopes that cannot safely cross the current direct-Agent boundary. */
function scopedDirectRoles(team: TeamYaml): string[] {
  return team.specialists
    .filter((specialist) => specialist.capability_scope !== undefined)
    .map((specialist) => specialist.name)
    .sort();
}

/** Emit the shared fail-closed diagnostic for every direct-Agent selection path. */
function writeScopedDirectRefusal(backend: "agent" | "subagent", roles: string[]): void {
  process.stderr.write(
    `[agent-team-launcher] REFUSED (capability-scope carriage): backend "${backend}" ` +
      `dispatches through Agent(), but the host capability contract cannot prove that ` +
      `GUILD_CAPABILITY_SCOPE reaches the child hook. Scoped role(s): ` +
      `[${roles.join(", ")}]. Use a code-backed cmux/tmux/remote backend, or ` +
      `ship and verify an explicit child-env-carriage capability before enabling this rung.\n`,
  );
}

/**
 * Ask the execution port which substrate this dispatch gets, then report it.
 *
 * W4 AUTHORITY ORDER (blocker 1): when the run carries a frozen
 * `snapshot.dispatch` decision, that decision IS the answer — no ambient
 * CMUX/tmux re-probe happens and a mid-run environment change cannot select a
 * different backend than the run-start freeze (RID-D-CONSTRAINT). Only a run
 * with no frozen block (legacy snapshot predating W4) falls through to the
 * ambient ladder, byte-identical to the shipped behavior.
 *
 * `dryRun=true` reports intent: the port leaves a pinned `team` alone rather than
 * degrading it, exactly as the shipped ladder did. The degradation WARNING is
 * authored by the port (it is part of the decision); the launcher only writes it
 * to stderr, which is the launcher's own job.
 */
function resolveAgentMode(
  explicit: AgentModeExplicit | null,
  dryRun: boolean,
  frozen: FrozenDispatchResolution | null,
  probe: ExecutionCapabilityProbe = executionCapabilityProbe
): ResolvedMode {
  if (frozen !== null) {
    const resolved = resolvedModeFromFrozen(frozen);
    process.stderr.write(
      `[agent-team-launcher] dispatch backend ${resolved.transport ?? resolved.mode} — ${resolved.reason}\n`,
    );
    return resolved;
  }
  const selection = selectExecutionSubstrate(
    { requested_mode: explicit, dry_run: dryRun },
    probe
  );
  if (selection.warning) process.stderr.write(selection.warning);
  return {
    mode: selection.dispatch_mode,
    reason: selection.reason,
    transport: selection.transport_id,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // FU08: maintenance modes are side-effecting launch-surface operations too.
  // Their previews deliberately stop before liveness probes, pane termination,
  // attempt sealing, or session rewrites and report the candidates readable
  // from disk. A real invocation recomputes every effect from current state.
  if (args.dryRun && (args.reap || args.dismissCompleted)) {
    const cwd = path.resolve(args.cwd);
    if (args.dismissCompleted && !args.runId) {
      process.stdout.write(
        "[agent-team-launcher] --dismiss-completed pure preview: --run-id <id> is required; " +
          "liveness probes, termination, attempt sealing, and session writes were withheld.\n",
      );
      return;
    }
    const runIds = args.runId ? [args.runId] : listRunnableRunIds(cwd);
    const operation = args.reap ? "--reap" : "--dismiss-completed";
    const candidates = runIds.flatMap((runId) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(sessionJsonPath(cwd, runId), "utf8")) as {
          teammate_panes?: unknown[];
        };
        return [{ runId, panes: parsed.teammate_panes?.length ?? 0 }];
      } catch {
        return [];
      }
    });
    process.stdout.write(
      `[agent-team-launcher] ${operation} pure preview: ${candidates.length} run session(s), ` +
        `${candidates.reduce((sum, candidate) => sum + candidate.panes, 0)} pane candidate(s). ` +
        `Liveness probes, termination, attempt sealing, and session writes were withheld. ` +
        `A real ${operation} recomputes authorization/liveness before applying effects.\n`,
    );
    return;
  }

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
    let totalOrphansReaped = 0;
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

      // G4 M1 — reaper RETRY on parked orphans. A dismiss whose kill did not confirm
      // parked the attempt `orphaned` (still non-terminal). Re-attempt termination
      // now: a pane that has since died confirms gone → seal `terminated`; one still
      // alive is re-killed. A retry that STILL fails bumps `reap_attempts` and stays
      // parked (adversarial test 6). This is the production end-to-end retry.
      const orphans = findOrphanedAttempts(cwd, runId);
      if (orphans.length > 0) {
        const paneBySpec = new Map<string, string>();
        const paneByTask = new Map<string, string>();
        let manifestBackend: "tmux" | "cmux" = "tmux";
        try {
          const sj = JSON.parse(fs.readFileSync(sjPath, "utf8")) as {
            backend?: "tmux" | "cmux";
            teammate_panes?: Array<{ specialist?: string; task_id?: string; pane_id?: string }>;
          };
          manifestBackend = sj.backend === "cmux" ? "cmux" : "tmux";
          for (const p of sj.teammate_panes ?? []) {
            if (p.specialist && p.pane_id) paneBySpec.set(p.specialist, p.pane_id);
            if (p.task_id && p.pane_id) paneByTask.set(p.task_id, p.pane_id);
          }
        } catch { /* session.json unreadable — orphans stay parked */ }
        const nowIso = () => new Date().toISOString();
        for (const ids of orphans) {
          const specialist = readAssignmentForInstance(cwd, ids)?.worker_role ?? null;
          const paneId = paneByTask.get(ids.logical_task_id) ?? (specialist ? paneBySpec.get(specialist) : undefined);
          const hasRealPane = !!paneId && !paneId.startsWith("(");
          // No live pane (pruned/gone) → the pane died; confirm the orphan terminal.
          if (!hasRealPane) {
            try {
              sealTerminalAttempt({ cwd, ids, terminal_state: "terminated", reason: "reaper: pane already gone", orphaned: true, now: nowIso });
              totalOrphansReaped++;
              process.stdout.write(
                `[REAPED] run "${runId}" specialist="${specialist ?? "unknown"}" ` +
                  `logical_task="${ids.logical_task_id}" instance="${ids.instance_id}" ` +
                  `— orphan sealed terminated (pane already gone)\n`
              );
            } catch { /* best-effort */ }
            continue;
          }
          const outcome = manifestBackend === "cmux"
            ? terminateCmuxSurface(paneId as string)
            : terminatePane(paneId as string);
          if (outcome.ok && outcome.confirmed) {
            try {
              sealTerminalAttempt({ cwd, ids, terminal_state: "terminated", reason: "reaper retry confirmed pane death", orphaned: true, now: nowIso });
              totalOrphansReaped++;
              process.stdout.write(
                `[REAPED] run "${runId}" specialist="${specialist}" ` +
                  `logical_task="${ids.logical_task_id}" instance="${ids.instance_id}" ` +
                  `— orphan sealed terminated (mechanism="${outcome.mechanism}")\n`
              );
            } catch { /* best-effort */ }
          } else if (!outcome.degraded) {
            try { markAttemptOrphaned(cwd, ids); } catch { /* best-effort */ }
            process.stdout.write(
              `[ORPHAN] run "${runId}" specialist="${specialist}" ` +
                `instance="${ids.instance_id}" — reaper retry did not confirm; still parked (reap_attempts bumped)\n`
            );
          }
          // outcome.degraded (tmux unavailable) → leave parked, no bump; retried next --reap.
        }
      }
    }

    process.stdout.write(
      `[agent-team-launcher] --reap: done. ` +
        `${totalReaped} dead pane(s) pruned, ${totalOrphansReaped} orphan(s) sealed terminated across ${runIds.length} run(s).\n`
    );
    process.exit(0);
  }

  // ── --dismiss-completed path (task-cell-runtime G4: accepted-handoff shutdown) ──
  // Resolves the run's durable `guild.handoff_acceptance.v1` records and terminates
  // ONLY the lanes those records authorize (a receipt on disk never authorizes
  // dismissal — D5). Kills a shared per-specialist pane only once ALL that
  // specialist's task-cells are terminal (G4 M2), seals `guild.task_attempt.v1`
  // terminal records, and parks any unconfirmed kill orphaned for `--reap` to retry.
  // Falls through to reapDeadMembers for registry hygiene.
  //
  // NOTE (known limitation): the launcher is a one-shot process, not a daemon; it
  // cannot push dismissals mid-run. The lead invokes this mode when the
  // teammate-idle hook signals an acceptance-authorized idle lane — the hook decides
  // deterministically (durable acceptance record), the launcher terminates
  // deterministically. No background reaper daemon (the periodic `--reap` sweep,
  // which now also retries parked orphans, covers eventual cleanup).
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

    let sessionManifest: {
      backend?: "tmux" | "cmux";
      session_name?: string;
      teammate_panes?: Array<{
        specialist: string;
        task_id?: string;
        dispatch_key?: string;
        pane_id?: string;
      }>;
    };
    try {
      sessionManifest = JSON.parse(fs.readFileSync(sjPath, "utf8")) as typeof sessionManifest;
    } catch {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: could not parse session.json for run "${runId}"\n`
      );
      process.exit(0);
    }

    const panes = sessionManifest.teammate_panes ?? [];
    if (panes.length === 0) {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: run "${runId}" has no teammates\n`
      );
      process.exit(0);
    }

    // ── task-cell-runtime G4 (ADR D5): acceptance-GATED, REAL termination ──────
    // The old path emitted a signal-only `[DISMISS]` on RECEIPT existence and then
    // relied on the reaper to prune already-dead panes — it never terminated a live
    // worker, and a receipt on disk authorized nothing (P0.4). Now: a lane is
    // dismissed ONLY when a durable `guild.handoff_acceptance.v1` authorizes its
    // termination; the launcher then performs the REAL kill (terminatePane) and
    // CONFIRMS the pane is gone before sealing the terminal `guild.task_attempt.v1`.
    // A kill that fails to confirm parks the attempt `orphaned` for the reaper
    // (adversarial test 6); tmux being unavailable is a recorded degradation.
    const paneBySpecialist = new Map<string, string>();
    for (const p of panes) {
      if (p.pane_id) paneBySpecialist.set(p.specialist, p.pane_id);
    }

    // Only acceptances that AUTHORIZE termination (accepted OR explicitly rejected).
    const authorized: RunAcceptance[] = findRunAcceptances(cwd, runId).filter((ra) =>
      isTerminationAuthorized(ra.acceptance)
    );

    let terminatedCount = 0;
    let orphanedCount = 0;
    let deferredCount = 0;
    const now = () => new Date().toISOString();
    const keyOf = (i: TaskCellInstanceIds) =>
      `${i.logical_task_id}/${i.attempt}/${i.instance_id}`;
    // Idempotency (G4 round-2): an attempt already sealed terminal on a PRIOR
    // --dismiss-completed pass is skipped — a re-run must not re-kill or re-seal.
    const isAttemptTerminal = (ids: TaskCellInstanceIds): boolean =>
      readAttemptForInstance(cwd, ids)?.terminal_state != null;

    // G4 M2 — a SHARED per-specialist pane may be killed ONLY when EVERY task-cell
    // that specialist owns is terminal (accepted or rejected). Otherwise a kill
    // triggered by one accepted task would destroy that specialist's OTHER
    // still-running task-cells in the same pane. (Per-INSTANCE panes are the
    // pane-per-task backend item; until then this guard keeps termination safe.)
    const ownedBySpecialist = new Map<string, TaskCellInstanceIds[]>();
    for (const cell of findRunTaskCells(cwd, runId)) {
      if (!cell.worker_role) continue;
      const arr = ownedBySpecialist.get(cell.worker_role) ?? [];
      arr.push(cell.ids);
      ownedBySpecialist.set(cell.worker_role, arr);
    }
    const authBySpecialist = new Map<string, RunAcceptance[]>();
    for (const ra of authorized) {
      const specialist = readAssignmentForInstance(cwd, ra.ids)?.worker_role ?? null;
      if (!specialist) continue;
      const arr = authBySpecialist.get(specialist) ?? [];
      arr.push(ra);
      authBySpecialist.set(specialist, arr);
    }

    // A rejected acceptance still authorizes teardown, but writes a rejection
    // terminal event — never a silent kill (D5). Accepted → `terminated`.
    const sealOne = (specialist: string, ra: RunAcceptance, mechanism: string, paneLabel: string): void => {
      const rejected = ra.acceptance.downstream_release_at === null;
      const terminalState = rejected ? "rejected" : "terminated";
      const terminalReason = rejected ? "handoff rejected by acceptance authority" : null;
      try {
        sealTerminalAttempt({ cwd, ids: ra.ids, terminal_state: terminalState, reason: terminalReason, now });
        terminatedCount++;
        process.stdout.write(
          `[TERMINATED] specialist="${specialist}" logical_task="${ra.ids.logical_task_id}" ` +
            `instance="${ra.ids.instance_id}" pane="${paneLabel}" state=${terminalState} mechanism="${mechanism}"\n`
        );
      } catch (err) {
        process.stderr.write(
          `[agent-team-launcher] --dismiss-completed: could not seal terminal record for ` +
            `${ra.ids.logical_task_id}/${ra.ids.instance_id}: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    };

    if (sessionManifest.backend === "cmux") {
      // cmux owns one surface per concrete task lane, so terminate by the
      // immutable logical task id rather than collapsing multiple tasks onto a
      // role-level handle. This is the lifecycle counterpart to W4's per-lane
      // launch contract.
      for (const [specialist, accs] of authBySpecialist) {
        for (const ra of accs.filter((candidate) => !isAttemptTerminal(candidate.ids))) {
          const pane = panes.find(
            (candidate) =>
              candidate.task_id === ra.ids.logical_task_id ||
              candidate.dispatch_key === ra.ids.logical_task_id,
          );
          const surfaceId = pane?.pane_id;
          if (!surfaceId || surfaceId.startsWith("(")) {
            sealOne(specialist, ra, "none (no live cmux surface)", "(none)");
            continue;
          }
          const outcome = terminateCmuxSurface(surfaceId);
          if (outcome.ok && outcome.confirmed) {
            sealOne(specialist, ra, outcome.mechanism, surfaceId);
            if (pane?.dispatch_key && sessionManifest.session_name) {
              spawnSync("cmux", [
                "clear-status",
                cmuxLaneStatusKey(runId, pane.dispatch_key),
                "--workspace",
                sessionManifest.session_name,
              ]);
            }
          } else if (outcome.degraded) {
            deferredCount++;
            process.stdout.write(
              `[DEGRADED] specialist="${specialist}" surface="${surfaceId}" ` +
                `reason="${outcome.error ?? "cmux unavailable"}" — termination deferred\n`,
            );
          } else {
            try { markAttemptOrphaned(cwd, ra.ids); } catch { /* best effort */ }
            orphanedCount++;
            process.stdout.write(
              `[ORPHAN] specialist="${specialist}" logical_task="${ra.ids.logical_task_id}" ` +
                `instance="${ra.ids.instance_id}" surface="${surfaceId}" ` +
                `reason="${outcome.error ?? "surface survived close"}"\n`,
            );
          }
        }
      }
    } else for (const [specialist, accs] of authBySpecialist) {
      const owned = ownedBySpecialist.get(specialist) ?? accs.map((a) => a.ids);
      const authKeys = new Set(accs.map((a) => keyOf(a.ids)));
      // A cell counts as terminal when it is authorized THIS pass OR was already
      // sealed on a prior pass — so a partly-processed specialist still converges.
      const allOwnedTerminal = owned.every(
        (ids) => authKeys.has(keyOf(ids)) || isAttemptTerminal(ids)
      );
      // Only acceptances whose attempt is NOT already sealed need action this pass.
      const pendingAccs = accs.filter((ra) => !isAttemptTerminal(ra.ids));
      if (pendingAccs.length === 0) continue; // idempotent no-op on re-run
      const paneId = paneBySpecialist.get(specialist);
      // A placeholder pane_id ("(dry-run…)") is not a real pane.
      const hasRealPane = !!paneId && !paneId.startsWith("(");

      // No live pane bound (already gone / not tmux): the pane holds no live work,
      // so sealing the authorized attempts is safe regardless of siblings.
      if (!hasRealPane) {
        for (const ra of pendingAccs) sealOne(specialist, ra, "none (no live pane)", "(none)");
        continue;
      }

      // Live shared pane, but the specialist still has un-accepted task-cells →
      // DEFER: keep the pane ALIVE so its other tasks are not killed mid-flight.
      if (!allOwnedTerminal) {
        deferredCount += pendingAccs.length;
        process.stdout.write(
          `[DEFER] specialist="${specialist}" pane="${paneId}" — ${pendingAccs.length}/${owned.length} ` +
            `owned task-cell(s) accepted; pane kept ALIVE until ALL are terminal (G4 M2)\n`
        );
        continue;
      }

      // All of this specialist's task-cells are terminal → kill the shared pane ONCE.
      const outcome = terminatePane(paneId as string);
      if (outcome.ok && outcome.confirmed) {
        for (const ra of pendingAccs) sealOne(specialist, ra, outcome.mechanism, paneId as string);
      } else if (outcome.degraded) {
        process.stdout.write(
          `[DEGRADED] specialist="${specialist}" pane="${paneId}" reason="${outcome.error ?? "tmux unavailable"}" ` +
            `— host-unavailable, termination deferred (recorded degradation)\n`
        );
      } else {
        // Kill did not confirm — park EVERY pending attempt orphaned; --reap retries.
        for (const ra of pendingAccs) {
          try { markAttemptOrphaned(cwd, ra.ids); } catch { /* best-effort */ }
          orphanedCount++;
          process.stdout.write(
            `[ORPHAN] specialist="${specialist}" logical_task="${ra.ids.logical_task_id}" ` +
              `instance="${ra.ids.instance_id}" pane="${paneId}" reason="${outcome.error ?? "pane survived kill"}" ` +
              `— parked terminating for reaper retry (adversarial test 6)\n`
          );
        }
      }
    }

    if (terminatedCount === 0 && orphanedCount === 0 && deferredCount === 0) {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: no acceptance-authorized lanes to ` +
          `terminate for run "${runId}" (a receipt on disk does NOT authorize dismissal — ` +
          `D5). ${authorized.length === 0 ? "No guild.handoff_acceptance.v1 records found." : ""}\n`
      );
    } else {
      process.stdout.write(
        `[agent-team-launcher] --dismiss-completed: run "${runId}" — terminated ` +
          `${terminatedCount} lane(s), ${orphanedCount} orphaned (reaper will retry), ` +
          `${deferredCount} deferred (shared pane kept alive until all its task-cells are terminal — G4 M2).\n`
      );
    }

    if (
      sessionManifest.backend === "cmux" &&
      terminatedCount > 0 &&
      orphanedCount === 0 &&
      deferredCount === 0 &&
      sessionManifest.session_name
    ) {
      spawnSync("cmux", ["clear-progress", "--workspace", sessionManifest.session_name]);
    }

    // Fall-through: reap any panes that are already dead (registry hygiene).
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
  let teamRaw: string;
  try {
    teamRaw = fs.readFileSync(args.team, "utf8");
    team = parseYaml(teamRaw);
  } catch (err) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: could not parse ${args.team}: ${(err as Error).message}\n`
    );
    process.exit(1);
  }

  for (const specialist of team.specialists) {
    if (specialist.definition_source !== "project") continue;
    const resolved = definitionRefForDispatch(path.resolve(args.cwd), specialist);
    if (resolved.status !== "resolved") {
      process.stderr.write(
        `[agent-team-launcher] REFUSED (project definition): ${specialist.name}: ${resolved.detail}\n` +
          `  NO pane was created and NO dispatch plan was emitted.\n`,
      );
      process.exit(1);
    }
    specialist.definition_ref = resolved.ref;
  }

  // Resolve once, before approval lookup or backend selection, then thread the
  // same lifecycle identity through every dispatch rung.
  try {
    args.runId = resolveLifecycleRunId(path.resolve(args.cwd), args.runId);
  } catch (err) {
    process.stderr.write(
      `[agent-team-launcher] REFUSED (run identity): ${(err as Error).message}\n` +
        "  NO pane was created and NO dispatch plan was emitted.\n",
    );
    process.exit(1);
  }

  // ── T7-H1: APPROVE-BEFORE-DISPATCH GATE ───────────────────────────────────
  //
  // Placed HERE — after the team file is parsed, before the D5 ladder — so it
  // covers EVERY rung: the tmux team launch below, the in-process agent rung,
  // and the `{backend: "subagent"}` signal guild:execute-plan dispatches from.
  // Nothing downstream of this point may create a pane, emit a dispatch plan,
  // or hand a roster to the caller without a verified approval when the
  // approval regime is active for the run.
  //
  // The verdict is fully delegated: dispatch-approval.ts loads the trail and
  // hands it to preDispatchGate → dispatchGate. No gate logic is re-spelled in
  // the launcher, and no flag here can record an approval.
  {
    const gateSlug = slugFromTeamPath(args.team);
    const gateRunId = args.runId ?? "";
    const gateCwd = path.resolve(args.cwd);
    // Phase from the team-file basename (`<slug>.<phase>.yaml`), else the run's
    // active phase, else "build" — the phase the trail is keyed by.
    const gatePhase =
      phaseFromTeamPath(args.team) ??
      (gateRunId ? readActivePhase(gateCwd, gateRunId) : null) ??
      "build";
    const scheduled = team.specialists.map((s) => s.participant_id ?? s.name);
    const scheduledRoleRefs = Object.fromEntries(
      team.specialists.map((s) => [s.participant_id ?? s.name, s.name]),
    );
    const scheduledCapabilityScopes = Object.fromEntries(
      team.specialists.map((s) => [
        s.participant_id ?? s.name,
        s.declared_capability_scope ?? null,
      ]),
    );
    let previewOverrideReason: string | null = null;
    if (args.dryRun) {
      try {
        previewOverrideReason = resolveApprovalOverride({
          env: process.env,
          overrideReason: args.approvalOverride,
        });
      } catch (err) {
        process.stderr.write(
          `[agent-team-launcher] REFUSED (approve-before-dispatch gate): ${(err as Error).message}\n` +
            `  NO pane was created and NO dispatch plan was emitted.\n`,
        );
        process.exit(1);
      }
    }
    const approvalEnv = args.dryRun
      ? { ...process.env, GUILD_DISPATCH_APPROVAL_OVERRIDE: undefined }
      : process.env;
    // T7R-R1-B1: verification is MANDATORY here — including the standalone /
    // no-run-id call, which the gate refuses outright (`no_run_id`) because a
    // dispatch whose approval cannot even be looked up is never approved.
    // The ONLY way past a refusal is `--approval-override "<reason>"`, which is
    // recorded to a durable audit log and reported below as a DEGRADATION.
    let verdict: ReturnType<typeof assertDispatchApproved>;
    try {
      verdict = assertDispatchApproved({
        cwd: gateCwd,
        runId: gateRunId,
        phase: gatePhase,
        teamPath: args.team,
        scheduledParticipants: scheduled,
        scheduledRoleRefs,
        scheduledCapabilityScopes,
        env: approvalEnv,
        // A preview never consumes or records an override. The real dispatch
        // must re-present it so the durable degradation audit stays truthful.
        overrideReason: args.dryRun ? null : args.approvalOverride,
        forced: args.requireApproval,
      });
    } catch (err) {
      // An unreasoned override attempt (e.g. `--approval-override 1`) throws.
      process.stderr.write(
        `[agent-team-launcher] REFUSED (approve-before-dispatch gate): ${(err as Error).message}\n` +
          `  NO pane was created and NO dispatch plan was emitted.\n`,
      );
      process.exit(1);
    }
    if (!verdict.allowed && !args.dryRun) {
      process.stderr.write(
        `[agent-team-launcher] REFUSED (approve-before-dispatch gate, ${verdict.refusal}): ${verdict.reason}\n` +
          `  team:     ${args.team}\n` +
          `  run/phase: ${gateRunId || "(none)"} / ${gatePhase}\n` +
          `  proposal: ${verdict.proposal_path ?? "(none)"}\n` +
          `  gate mode: ${verdict.mode} — ${verdict.mode_reason}\n` +
          `  NO pane was created and NO dispatch plan was emitted. Persist the composed proposal ` +
          `and record a current guild.team_decision.v1 approve over the CURRENT proposal bytes, ` +
          `then re-run:\n` +
          `    npx tsx scripts/team-decide.ts persist --proposal <f> --cwd ${gateCwd}\n` +
          `    npx tsx scripts/team-decide.ts record  --proposal <f> --cwd ${gateCwd} ` +
          `--decision approve --decided-by operator:<id> --channel terminal_prompt\n`,
      );
      process.exit(1);
    }
    if (!verdict.allowed && args.dryRun) {
      // T7-H1 scope: the approve-before-dispatch gate protects a REAL dispatch —
      // a pane spawn / agent launch with side effects. `--dry-run` emits a
      // DECLARATIVE preview plan only: no pane, no agent, no run-tree write.
      // A preview that cannot dispatch is not a dispatch, so it is not gated —
      // but it is loudly stamped UNVERIFIED so a plan is never mistaken for an
      // approved one. The real (non-dry-run) path above stays MANDATORY.
      process.stderr.write(
        `[agent-team-launcher] NOTICE (--dry-run preview): approve-before-dispatch NOT verified ` +
          `(${verdict.refusal}: ${verdict.reason}). Emitting a preview plan only — NO pane, NO ` +
          `dispatch, NO run-tree write. A real dispatch still requires a persisted ` +
          `guild.team_proposal.v2 + a current approve decision.\n`,
      );
      if (previewOverrideReason !== null) {
        process.stderr.write(
          `[agent-team-launcher] NOTICE (--dry-run preview): approval override validated but withheld. ` +
            `A real dispatch must re-present the reason; preview created no override audit record.\n`,
        );
      }
    } else if (verdict.degradation) {
      // Loud, non-silent, and explicitly a degradation — not a pass.
      process.stderr.write(
        `[agent-team-launcher] DEGRADATION: approve-before-dispatch verification was ` +
          `OVERRIDDEN by the operator.\n` +
          `  refusal overridden: ${verdict.refusal} — ${verdict.reason}\n` +
          `  operator reason:    ${verdict.override_reason}\n` +
          `  audit record:       ${verdict.override_audit_path}\n` +
          `  This dispatch is NOT approval-verified.\n`,
      );
    } else {
      process.stdout.write(
        `[agent-team-launcher] approve-before-dispatch gate PASSED (${verdict.mode_reason}): ` +
          `${verdict.reason}${verdict.decision_hash ? ` [decision ${verdict.decision_hash.slice(0, 12)}…]` : ""}\n`,
      );
    }
  }

  // ── D5 dispatch ladder ────────────────────────────────────────────────────
  // When --agent-mode is provided, run the D5 ladder. Non-team modes emit a
  // JSON signal so the caller (guild:execute-plan) can route accordingly.
  // When --agent-mode is absent, fall through to the legacy team.backend check
  // for backward compatibility with existing callers.
  // Blocker 1 (W4): the frozen run-start decision is read ONCE, after the
  // lifecycle identity gate resolved args.runId, and is authoritative for
  // BOTH the --agent-mode branch and the legacy fallthrough below.
  const frozenDispatch = readFrozenDispatchResolution(path.resolve(args.cwd), args.runId);

  // A frozen cmux authority uses the one full cmux implementation even when a
  // legacy caller omits the now-redundant --agent-mode flag. Keeping a separate
  // handoff-only branch made dry and real invocations indistinguishable and
  // skipped the preview's withheld-check/artifact disclosures.
  if (args.agentMode !== null || frozenDispatch?.backend === "cmux") {
    const { mode: resolvedMode, reason, transport } = resolveAgentMode(
      args.agentMode ?? "team",
      args.dryRun,
      frozenDispatch,
    );

    // W4 (run-identity-and-dispatch): cmux is a real run-scoped transport. It
    // owns one non-focus-stealing visible surface per concrete task lane and
    // the same TaskCell/scope/trace/manifest obligations as tmux.
    if (resolvedMode === "team" && transport === "cmux") {
      const cwd = path.resolve(args.cwd);
      const runId = args.runId;
      const slug = slugFromTeamPath(args.team);
      const ambientWorkspaceId = (process.env["CMUX_WORKSPACE_ID"] ?? "").trim();
      if (!ambientWorkspaceId && !args.dryRun) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: run is frozen to cmux but CMUX_WORKSPACE_ID is absent; ` +
            `refusing to redirect the run to another substrate.\n`,
        );
        process.exit(1);
      }
      const workspaceId = ambientWorkspaceId || "(frozen-cmux-workspace-dry-run)";
      if (team.specialists.length === 0) {
        process.stderr.write("[agent-team-launcher] ERROR: team.yaml has no specialists; nothing to spawn.\n");
        process.exit(1);
      }
      const orchestratorHostKind = resolveOrchestratorHostKind(process.env) ?? "claude";
      const ownerMap = readPlanOwnerTaskIds(cwd, slug);
      const lanes = expandTaskCellLaunchLanes(runId, team.specialists, ownerMap);
      const adapterBacked = lanes.some(
        (lane) => (lane.host_kind ?? orchestratorHostKind) !== "claude",
      );
      const runtime = createHostExecutionRuntime({
        transports: { cmux: cmuxTransportPort(workspaceId, adapterBacked) },
      });
      const resolved = resolveDispatchPort(runtime, "cmux");
      if (!resolved.port) {
        process.stderr.write(`[agent-team-launcher] ERROR: cmux dispatch unavailable — ${resolved.detail}\n`);
        process.exit(1);
      }
      const port = resolved.port;
      if (!args.dryRun && port.available().status !== "succeeded") {
        process.stderr.write("[agent-team-launcher] ERROR: `cmux` is unavailable for the frozen cmux run.\n");
        process.exit(1);
      }

      const bindingRef = resolveLaunchBindingRef(cwd, runId);
      if (bindingRef === null) {
        throw new Error(`binding_rejected: cmux TaskCell dispatch ${runId} has no minted run binding`);
      }
      const planLaneModel = makeLaneModelPlanner(
        cwd,
        runId,
        orchestratorHostKind,
        bindingRef,
        args.dryRun,
      );
      for (const lane of lanes) planLaneModel(lane, lane.taskId);
      const phaseId = phaseFromTeamPath(args.team) ?? "build";
      const launchRequest = {
        slug,
        runId,
        cwd,
        specialists: lanes,
        targetName: workspaceId,
        mode: "in-session" as LaunchMode,
        dryRun: true,
        // A real dispatch first runs the adapter-only preflight while keeping
        // cmux surfaces closed. An operator dry-run suppresses even that
        // subprocess and remains a pure preview.
        preflightOnly: !args.dryRun,
        orchestratorHostKind,
        teamPath: args.team,
      };
      // Plan first: adapter preflights and definition-ref carriage must pass
      // before immutable attempt-1 records exist.
      const preview = port.launch(launchRequest);
      if (preview.status !== "succeeded" || !preview.value) {
        process.stderr.write(`[agent-team-launcher] ERROR: cmux preflight refused — ${preview.detail ?? preview.status}\n`);
        process.exit(1);
      }

      if (!args.dryRun) {
        for (const spec of team.specialists) {
          const taskIds = ownerMap.get(spec.name) ?? [spec.name];
          for (const taskId of taskIds) {
            writeTaskRun(cwd, runId, taskId, {
              specialist: spec.name,
              host: spec.capabilityRequirements
                ? {
                    capabilityRequirements: {
                      needsPr: spec.capabilityRequirements.needs_pr,
                      needsParallel: spec.capabilityRequirements.needs_parallel,
                      needsNetwork: spec.capabilityRequirements.needs_network,
                      isolation: spec.capabilityRequirements.isolation,
                    },
                  }
                : undefined,
            });
          }
        }
      }
      const cellCount = emitTaskCellsV2(
        cwd,
        runId,
        slug,
        lanes,
        phaseId,
        "cmux",
        (lane) =>
          hostKindToRegistryId(lane.host_kind ?? orchestratorHostKind) ||
          String(lane.host_kind ?? orchestratorHostKind),
        bindingRef,
        args.dryRun,
      );
      const launched = args.dryRun
        ? preview
        : port.launch({ ...launchRequest, dryRun: false, preflightOnly: false });
      const result = launched.value;
      if (launched.status !== "succeeded" || !result || !result.ok) {
        const detail = launched.detail ?? launched.status;
        if (!args.dryRun) {
          const settled = settleFailedCmuxTaskCells({
            cwd,
            runId,
            lanes,
            unconfirmedPaneIds: result?.teammate_pane_ids ?? {},
            reason: `cmux dispatch failed: ${detail}`,
          });
          process.stderr.write(
            `[agent-team-launcher] cmux failure lifecycle: ${settled.failed} failed, ` +
              `${settled.orphaned} orphaned${settled.errors.length ? `; errors: ${settled.errors.join("; ")}` : ""}\n`,
          );
        }
        process.stderr.write(`[agent-team-launcher] ERROR: cmux dispatch failed — ${detail}\n`);
        process.exit(2);
      }

      if (!args.dryRun) {
        const lifecycle = reconcileTaskCellLifecycleTelemetry({
          cwd,
          runId,
          instanceIds: lanes
            .map((lane) => lane.task_cell_instance_id)
            .filter((id): id is string => typeof id === "string"),
          launchConfirmedAt: new Date().toISOString(),
        });
        if (!lifecycle.ok) {
          process.stderr.write(
            `[agent-team-launcher] WARN: cmux TaskCell lifecycle telemetry incomplete — ${lifecycle.findings.join("; ")}\n`,
          );
        }
        const emitted = emitPaneDispatchEvents({
          cwd,
          runId,
          target: workspaceId,
          surface: "cmux",
          lanes: lanes.map((lane) => ({
            specialist: lane.name,
            taskId: lane.taskId,
            paneId: result.teammate_pane_ids[specialistDispatchKey(lane)],
          })),
        });
        if (emitted < lanes.length) {
          process.stderr.write(`[agent-team-launcher] WARN: recorded ${emitted}/${lanes.length} cmux dispatch receipt(s).\n`);
        }
      }
      const teamResultPreview = buildLaunchTeamResult(runId, args.team, lanes);
      const manifestPreview = buildManifest({
          runId,
          mode: "in-session",
          sessionName: workspaceId,
          windowName: null,
          specialists: lanes,
          dryRun: args.dryRun,
          realPaneIds: args.dryRun
            ? null
            : { orchestrator: "", teammates: result.teammate_pane_ids },
          orchestratorHostKind,
          backend: "cmux",
        });
      const resultPath = args.dryRun
        ? null
        : writeTeamResult(cwd, runId, teamResultPreview);
      const manifestPath = args.dryRun ? null : writeManifest(cwd, manifestPreview);
      const signal = {
        backend: "cmux",
        reason,
        slug,
        ok: result.ok,
        taskCellsWritten: cellCount,
        teammatePaneIds: result.teammate_pane_ids,
        plannedCommands: result.planned_commands,
        notes: result.notes,
        teamResult: resultPath,
        manifest: manifestPath,
        ...(args.dryRun ? { teamResultPreview, manifestPreview } : {}),
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
    }

    let directScopedRoles: string[] = [];
    if (resolvedMode !== "team") {
      directScopedRoles = scopedDirectRoles(team);
      if (directScopedRoles.length > 0 && !args.dryRun) {
        writeScopedDirectRefusal(resolvedMode, directScopedRoles);
        process.exit(1);
      }
    }

    if (resolvedMode === "agent") {
      // D5 rung 3 (in-process / independent agents, no tmux). dispatch.md
      // §"In-process dispatchPlan consumption" + SKILL.md §"Backend + routing"
      // both document that this rung returns the backend's declarative
      // dispatchPlan. MH-04 BF-2: it no longer constructs the backend — it
      // resolves the in-process transport through HostExecutionRuntime and
      // launches through the resolved port. Scoped dry-run descriptors are
      // explicitly labeled preview-only; production scoped dispatch is refused
      // above before this backend can write TaskCells.
      const slug = slugFromTeamPath(args.team);
      // W1: the lifecycle id was resolved once above; this rung cannot mint.
      const runId = args.runId;
      const cwd = path.resolve(args.cwd);
      const orchestratorHostKind = resolveOrchestratorHostKind(process.env) ?? undefined;
      const ownerMap = readPlanOwnerTaskIds(cwd, slug);
      const launchLanes = expandTaskCellLaunchLanes(runId, team.specialists, ownerMap);
      const bindingRef = resolveLaunchBindingRef(cwd, runId);
      if (bindingRef === null) {
        throw new Error(`binding_rejected: in-process TaskCell dispatch ${runId} has no minted run binding`);
      }
      const planLaneModel = makeLaneModelPlanner(
        cwd,
        runId,
        orchestratorHostKind ?? "claude",
        bindingRef,
        args.dryRun,
      );
      for (const lane of launchLanes) planLaneModel(lane, lane.taskId);
      if (!args.dryRun) {
        const phaseId = phaseFromTeamPath(args.team) ?? "build";
        const hostId = hostKindToRegistryId(orchestratorHostKind ?? "claude") || String(orchestratorHostKind ?? "claude");
        const written = emitTaskCellsV2(
          cwd,
          runId,
          slug,
          launchLanes,
          phaseId,
          "in-process",
          () => hostId,
          bindingRef,
          args.dryRun,
        );
        process.stderr.write(
          `[agent-team-launcher] emitted ${written} in-process guild.task_assignment.v2 cell(s) → ` +
            `.guild/runs/${runId}/task-cells/\n`,
        );
      }
      const runtime = createHostExecutionRuntime({
        transports: { "in-process": inProcessTransportPort() },
      });
      const resolved = resolveDispatchPort(runtime, "in-process");
      if (!resolved.port) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: in-process dispatch is unavailable — ${resolved.detail}\n`
        );
        process.exit(1);
      }
      const launched = resolved.port.launch({
        slug,
        runId,
        cwd,
        specialists: launchLanes,
        targetName: args.sessionName ?? `guild-${slug}`,
        mode: process.env["TMUX"] ? "in-session" : "new-session",
        dryRun: args.dryRun,
        orchestratorHostKind,
        teamPath: args.team,
      });
      const result = launched.value;
      if (!result) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: in-process dispatch failed — ` +
            `${launched.detail ?? launched.status}\n`
        );
        process.exit(1);
      }
      if (!args.dryRun) {
        const resultPath = writeLaunchTeamResult(cwd, runId, args.team, launchLanes);
        process.stderr.write(`[agent-team-launcher] wrote TaskCell team_result → ${resultPath}\n`);
      }
      const signal = {
        backend: resolvedMode,
        reason,
        slug,
        ok: result.ok,
        dispatchPlan: result.dispatch_plan,
        orchestratorPaneId: result.orchestrator_pane_id,
        teammatePaneIds: result.teammate_pane_ids,
        notes: result.notes,
        dispatchAllowed: !args.dryRun && directScopedRoles.length === 0,
        previewOnly: args.dryRun || directScopedRoles.length > 0,
        teamPath: path.resolve(args.team),
        teamSha256: sha256Prefixed(teamRaw),
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
    }

    if (resolvedMode !== "team") {
      // subagent: execute-plan constructs the Agent() call itself directly
      // from team.yaml + the plan (SKILL.md §"Capability-scope env injection")
      // — there is no launcher-side descriptor to compute for this rung, so the
      // signal stays declarative and carries an explicit dispatchAllowed /
      // previewOnly decision in addition to its approval-bound team identity.
      const signal = {
        backend: resolvedMode,
        reason,
        slug: slugFromTeamPath(args.team),
        dispatchAllowed: !args.dryRun && directScopedRoles.length === 0,
        previewOnly: args.dryRun || directScopedRoles.length > 0,
        teamPath: path.resolve(args.team),
        teamSha256: sha256Prefixed(teamRaw),
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
    // Blocker 1 (W4): frozen cmux already took the full implementation above;
    // a legacy run frozen to agent/subagent is not a tmux launch at all.
    if (frozenDispatch !== null && frozenDispatch.backend !== "tmux") {
      const resolved = resolvedModeFromFrozen(frozenDispatch);
      const directScopedRoles = resolved.mode === "team" ? [] : scopedDirectRoles(team);
      if (resolved.mode !== "team" && directScopedRoles.length > 0 && !args.dryRun) {
        writeScopedDirectRefusal(resolved.mode, directScopedRoles);
        process.exit(1);
      }
      const signal = {
        backend: resolved.transport === "cmux" ? "cmux" : resolved.mode,
        reason: resolved.reason,
        slug: slugFromTeamPath(args.team),
        ...(resolved.mode === "team"
          ? {}
          : {
              dispatchAllowed: !args.dryRun && directScopedRoles.length === 0,
              previewOnly: args.dryRun || directScopedRoles.length > 0,
              teamPath: path.resolve(args.team),
              teamSha256: sha256Prefixed(teamRaw),
            }),
      };
      process.stdout.write(JSON.stringify(signal) + "\n");
      process.exit(0);
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

  // Resolve the unified run-id ONCE per launcher invocation and thread it
  // through both prompts and the manifest. Exported into each pane's env so
  // hooks inside (capture-telemetry, maybe-reflect, agent-team handlers)
  // converge on the same `.guild/runs/<run-id>/` path. Defined here (before the
  // cross-host block) so both remote + local tmux paths share the same run ID.
  //
  // task-cell-runtime P0.5 + RID W1: the lifecycle id resolved above is the
  // only identity every tmux/remote artifact receives. This launcher has no
  // fallback minter.
  const runId = args.runId;

  // T6 F5: per-task v2 (M2 gated-on) model selections from the production
  // dispatch-model step — consumed by run-state persistence and cross-host
  // routing below. Empty at M0/M1 (legacy selections write nothing here).
  const v2ModelByTask = new Map<
    string,
    { model: string; effort: string | null; tier: "cheap" | "mid" | "powerful" }
  >();
  const preRoutingOwnerMap = readPlanOwnerTaskIds(cwd, slug);
  // Validate global one-task/one-owner identity before routing partitions the
  // team; otherwise a duplicate split across local/remote subsets could evade
  // each subset's collision check.
  const globalLaunchLanes = expandTaskCellLaunchLanes(runId, team.specialists, preRoutingOwnerMap);
  let launchBindingRef: string | null = null;
  const routedHostByRole = new Map<string, string>();
  const modelProvenanceByTask = new Map<string, Specialist["modelProvenance"]>();

  // ── W2-A2/FU08: production writes; preview plans from identical inputs ────
  // A real dispatch writes task_runs before routing and reads them back as the
  // single source of truth. A dry-run keeps the same in-memory input and model/
  // routing computation but MUST NOT materialize that channel or any evidence.
  {
    if (!args.dryRun) {
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
    }
    // Scope enforcement is carried by the backend's real process environment.
    // Do not write a pathname fallback: the shared writer cannot close a
    // same-user concurrent ancestor swap, and raw writes can follow a planted
    // scope symlink outside the project.
    // ── T3 F3: resolve the run's minted binding ONCE for both descriptor channels ──
    // (env envelope → the run's own minted record). null ⇒ dispatch and preview
    // both fail closed; preview may read the binding but never consumes it.
    launchBindingRef = resolveLaunchBindingRef(cwd, runId);

    // Resolve models before routing, but DO NOT persist TaskCell identity yet.
    // Host/substrate are routing outcomes and immutable v2 records must bind the
    // selected facts rather than the pre-routing guess.
    if (launchBindingRef === null) {
      throw new Error(`binding_rejected: TaskCell dispatch ${runId} has no minted run binding`);
    }
    {
      const planLaneModel = makeLaneModelPlanner(
        cwd,
        runId,
        orchestratorHostKind,
        launchBindingRef,
        args.dryRun,
      );
      for (const specialist of team.specialists) {
        const taskIds = preRoutingOwnerMap.get(specialist.name);
        const effectiveTaskIds = taskIds && taskIds.length > 0 ? taskIds : [specialist.name];
        for (const rawTaskId of effectiveTaskIds) {
          const taskId = safeSegment(rawTaskId);
          const { outcome, laneTier } = planLaneModel(specialist, taskId);
          modelProvenanceByTask.set(
            taskId,
            specialist.modelProvenance ? { ...specialist.modelProvenance } : undefined,
          );
        if (outcome.selection.source !== "v2") continue;
        v2ModelByTask.set(taskId, {
          model: outcome.selection.model,
          effort: outcome.selection.effort,
          tier: laneTier,
        });
      }
      }
      // Single-host path (the cross-host block below may not run at all):
      // persist a gated-on v2 selection into run-state per lane NOW, so the
      // selection is consumed, not just logged. M0/M1 (source legacy) writes
      // nothing — byte-identical legacy behavior.
      if (!args.dryRun) {
        for (const [taskId, sel] of v2ModelByTask) {
          upsertLane(
            path.join(cwd, ".guild", "runs", runId),
            { runId, planSlug: slug, programId: null },
            taskId,
            {
              host: {
                selected: hostKindToRegistryId(orchestratorHostKind) || String(orchestratorHostKind),
                degraded: false,
                independence: "weak",
                tier: sel.tier,
                model: sel.model,
                modelParams: { model: sel.model, ...(sel.effort ? { effort: sel.effort } : {}) },
              },
            },
          );
        }
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
      if (!args.dryRun) {
        const fromDisk = readTaskRunCapReqs(cwd, runId, repTaskId);
        if (fromDisk !== undefined) {
          spec.capabilityRequirements = fromDisk;
        } else {
          // W2-A2(d): observable benign fallback — emit degradation signal.
          emitReadbackDegradation(cwd, runId, repTaskId, spec.name);
        }
      }
      // D-CAP: populate spec.taskId with the representative plan task-id so
      // composeTmuxCommands / composeInProcessDispatch / RemoteTeamBackend can inject
      // GUILD_TASK_ID into every spawn env as the lane's runtime identity carrier.
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
            if (args.dryRun) return;
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
            for (const taskId of taskIds) {
              // T6 F5: a gated-on M2 selection is authoritative for the lane's
              // persisted model — the router's tier-map model is the legacy leg.
              const v2 = v2ModelByTask.get(taskId);
              const hostBlock = {
                selected: d.host,
                degraded: d.degraded,
                independence: d.independence,
                tier: v2?.tier ?? d.tier,
                model: v2?.model ?? d.model,
                modelParams: v2
                  ? { model: v2.model, ...(v2.effort ? { effort: v2.effort } : {}) }
                  : d.modelParams,
              };
              upsertLane(
                path.join(cwd, ".guild", "runs", runId),
                { runId, planSlug: slug, programId: null },
                taskId,
                { host: hostBlock }
              );
            }
          },
        });
        for (const route of routes) routedHostByRole.set(route.specialist, route.decision.host);
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
          const remoteLaunchLanes = expandTaskCellLaunchLanes(
            runId,
            remoteSpecialists,
            preRoutingOwnerMap,
          ).map((lane) => ({
            ...lane,
            modelProvenance: modelProvenanceByTask.get(lane.taskId),
          }));
          const phaseId = phaseFromTeamPath(args.team) ?? "build";
          const remoteCellsWritten = emitTaskCellsV2(
            cwd,
            runId,
            slug,
            remoteLaunchLanes,
            phaseId,
            "remote",
            (lane) => {
              const route = routes.find((candidate) => candidate.specialist === lane.name);
              if (!route) throw new Error(`missing selected remote host for ${lane.name}`);
              return route.decision.host;
            },
            launchBindingRef,
            args.dryRun || args.runId === null,
          );
          if (!args.dryRun) {
            process.stdout.write(
              `[agent-team-launcher] emitted ${remoteCellsWritten} remote guild.task_assignment.v2 cell(s) → ` +
                `.guild/runs/${runId}/task-cells/\n`,
            );
          }

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

          // MH-04 BF-2: the remote rung resolves the remote transport through the
          // versioned runtime and dispatches through the resolved port. A runtime
          // that refuses the transport refuses the dispatch — it never falls back
          // to constructing RemoteTeamBackend here.
          const remoteRuntime = createHostExecutionRuntime({
            transports: {
              remote: remoteTransportPort({
                resolveHostTarget,
                // rf-wi-04 item 2 (codex review Q2a) — route the orphaned-lane
                // warning to a DURABLE run-scoped sink. launch() is wrapped in
                // bounded retry below; a later successful attempt discards the
                // failed attempt's envelope, so the orphan must be persisted at
                // detection time (NDJSON events log + trace), not left on stderr.
                warn: args.dryRun
                  ? (msg) => process.stderr.write(`[agent-team-launcher] dry-run remote warning: ${msg}\n`)
                  : (msg) => emitRemoteOrphan(cwd, runId, msg),
              }),
            },
          });
          const resolvedRemote = resolveDispatchPort(remoteRuntime, "remote");
          if (!resolvedRemote.port) {
            process.stderr.write(
              `[agent-team-launcher] ERROR: remote dispatch is unavailable — ${resolvedRemote.detail}\n`
            );
            process.exit(1);
          }
          const remotePort = resolvedRemote.port;

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
                const attempt = remotePort.launch({
                  slug,
                  runId,
                  cwd,
                  specialists: remoteLaunchLanes,
                  targetName,
                  mode,
                  dryRun: args.dryRun,
                  teamPath: args.team ?? undefined, // C13: resolved per-phase path → orchestrator prompt
                });
                const res = attempt.value;
                if (!res || !res.ok) {
                  // Throw so runWithRetry retries; carry the notes for the final error.
                  throw new Error(
                    `remote dispatch failed — ` +
                      `${res?.notes?.join("; ") ?? attempt.detail ?? "unknown"}`
                  );
                }
                return Promise.resolve(res);
              },
              {
                ...retryOpts,
                onExhausted: (signal) => {
                  if (args.dryRun) return;
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
          for (const spec of remoteLaunchLanes) {
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
              `[agent-team-launcher] dry-run — remote dispatch (${remoteLaunchLanes.length} task cell(s)):\n`
            );
            for (const cmd of remoteResult.planned_commands ?? []) {
              process.stdout.write(`  ${cmd}\n`);
            }
            for (const note of remoteResult.notes ?? []) {
              process.stdout.write(`[agent-team-launcher] NOTE: ${note}\n`);
            }
          } else {
            const lifecycle = reconcileTaskCellLifecycleTelemetry({
              cwd,
              runId,
              instanceIds: remoteLaunchLanes
                .map((lane) => lane.task_cell_instance_id)
                .filter((id): id is string => typeof id === "string"),
              launchConfirmedAt: new Date().toISOString(),
            });
            if (!lifecycle.ok) {
              process.stderr.write(
                `[agent-team-launcher] WARN: remote TaskCell lifecycle telemetry incomplete — ` +
                  `${lifecycle.findings.join("; ")}\n`,
              );
            }
            // ── #76: remote lanes are pane-dispatched too ────────────────────
            // A remote lane opens a pane on the FAR host, so its hooks write
            // into that host's context — exactly the same blind spot as a local
            // tmux pane, and reached via a different code path that returns
            // before (and, for an all-remote team, exits before) the local
            // spawn emit below. Recorded here, after the retry loop settled on
            // a COMMITTED batch (a partial remote spawn tears every pane back
            // down, so an aborted attempt has no live lane to record); skipped
            // on dry-run, which dispatches nothing.
            const emittedRemote = emitPaneDispatchEvents({
              cwd,
              runId,
              // NO pane_target: `targetName` is this machine's tmux session /
              // window name and means nothing on the far host, where each lane
              // lives in its own independently-named detached `ssh-…` session.
              // A wrong target is worse than an absent one — pane_id carries
              // the real remote handle.
              target: "",
              surface: "remote",
              lanes: remoteLaunchLanes.map((s) => ({
                specialist: s.name,
                taskId: s.taskId,
                paneId: remoteResult.teammate_pane_ids?.[specialistDispatchKey(s)],
              })),
            });
            if (emittedRemote > 0) {
              process.stdout.write(
                `[agent-team-launcher] recorded ${emittedRemote} remote dispatch(es) → ` +
                  `.guild/runs/${runId}/logs/v1.4-events.jsonl\n`,
              );
            }
            if (emittedRemote < remoteLaunchLanes.length) {
              process.stderr.write(
                `[agent-team-launcher] WARN: recorded ${emittedRemote}/${remoteLaunchLanes.length} remote ` +
                  `dispatch receipt(s) — this run's trace under-reports its task cells (#76).\n`,
              );
            }
          }

          // Remove dispatched-remote specialists from the local tmux pool.
          const remoteNames = new Set(remote.map((r) => r.specialist));
          team.specialists = team.specialists.filter((s) => !remoteNames.has(s.name));

          if (team.specialists.length === 0) {
            // All specialists dispatched remotely — no local tmux session needed.
            if (args.dryRun) {
              process.stdout.write(
                "[agent-team-launcher] dry-run: all specialists remote; no local tmux session and no state written.\n"
              );
            } else {
              const resultPath = writeLaunchTeamResult(cwd, runId, args.team, globalLaunchLanes);
              process.stdout.write(`[agent-team-launcher] wrote TaskCell team_result → ${resultPath}\n`);
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

  // Route selection is now complete. Expand each remaining local specialist
  // into one concrete worker per owned task, then bind immutable TaskCell
  // identity to the actual local tmux substrate and selected host.
  {
    const localLaunchLanes = expandTaskCellLaunchLanes(runId, team.specialists, preRoutingOwnerMap)
      .map((lane) => ({
        ...lane,
        modelProvenance: modelProvenanceByTask.get(lane.taskId),
      }));
    // Fix B (run-identity-and-dispatch): identity is EXPANDED here, but the
    // immutable attempt-1 records are NOT persisted yet — emitTaskCellsV2 now
    // runs after the pre-pane gates (availability, collision, mixed-host
    // preflight, definition-injection support), so a refused launch exits with
    // zero task-cell records instead of poisoning attempt 1 for the next try.
    team.specialists = localLaunchLanes;
  }

  // CH-1/R8: wire pane adapters whenever any actual pane host is not Claude.
  // A pure-Claude team keeps the resolver-less path (byte-identical legacy
  // regression anchor). Specialists without `host:` inherit the orchestrator host.
  const adapterBacked = [
    orchestratorHostKind,
    ...team.specialists.map((s) => s.host_kind ?? orchestratorHostKind),
  ].some((hostKind) => hostKind !== "claude");

  // RE-4: the tmux spawn logic lives behind the TeamBackend seam. MH-04 BF-2:
  // that seam is now reached ONLY through the versioned execution runtime — the
  // launcher resolves the tmux transport and drives probes (availability,
  // collision, preflight), the run-scoped launch, and session identity through
  // the resolved port. The launcher keeps the CLI-specific UX (exact error
  // messages, exit codes, manifest, attach).
  const tmuxRuntime = createHostExecutionRuntime({
    transports: { tmux: tmuxTransportPort(adapterBacked) },
  });
  const resolvedTmux = resolveDispatchPort(tmuxRuntime, "tmux");
  if (!resolvedTmux.port) {
    process.stderr.write(
      `[agent-team-launcher] ERROR: tmux dispatch is unavailable — ${resolvedTmux.detail}\n`
    );
    process.exit(1);
  }
  const tmuxPort = resolvedTmux.port;

  // The one run-scoped launch request, shared by the preflight probe and the
  // launch itself so the two can never describe different runs.
  const launchRequest = {
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
  };

  // For real (non-dry-run) launches: tmux must be installed, and the target must
  // not already exist (refuse to clobber). Which collision we check depends on
  // the mode: a session name (new-session) or a team window in the current
  // session (in-session). dry-run skips this — it never invokes tmux.
  if (!args.dryRun) {
    if (tmuxPort.available().status !== "succeeded") {
      process.stderr.write(
        "[agent-team-launcher] ERROR: `tmux` is not installed or not on PATH.\n" +
          "  Install tmux (macOS: `brew install tmux`; Debian/Ubuntu: `apt install tmux`),\n" +
          "  then re-run. (Without tmux, use backend: subagent — guild:execute-plan\n" +
          "  dispatches specialists via the Agent tool, no tmux required.)\n"
      );
      process.exit(1);
    }
    // A collision probe that does not come back succeeded is NOT "no collision":
    // an unreadable namespace is refused rather than treated as a free name.
    const collisionFor = (scope: "session" | "window"): boolean => {
      const probed = tmuxPort.collision({ target_name: targetName, scope });
      if (probed.status !== "succeeded" || !probed.value) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: could not probe the tmux ${scope} namespace — ` +
            `${probed.detail ?? probed.status}\n`
        );
        process.exit(1);
      }
      return probed.value.exists;
    };
    if (mode === "in-session") {
      // One-team-per-session guard (§7.3): refuse to clobber an existing team
      // window of the same name in the current session.
      if (collisionFor("window")) {
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
    } else if (collisionFor("session")) {
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
      const probed = tmuxPort.preflight(launchRequest);
      if (probed.status !== "succeeded" || !probed.value) {
        process.stderr.write(
          `[agent-team-launcher] ERROR: mixed-host preflight could not run — ` +
            `${probed.detail ?? probed.status}\n`
        );
        process.exit(1);
      }
      const pf = probed.value;
      if (!pf.ok) {
        const lines = pf.failures
          .map((f) => `    - ${f.specialist} [${f.host_kind}]: ${f.message}`)
          .join("\n");
        process.stderr.write(
          `[agent-team-launcher] ERROR: mixed-host preflight failed ` +
            `(CH-6 fail-fast — zero panes opened):\n${lines}\n`
        );
        process.exit(1);
      }
    }
  }

  // Fix B (run-identity-and-dispatch): definition-injection support is checked
  // BEFORE any immutable record is written. A lane carrying a pinned
  // definition_ref on a port that has not declared (or cannot honor) injection
  // would be refused inside launch() — after the pre-fix code had already
  // persisted attempt-1 records. Refuse HERE, with zero records on disk.
  for (const lane of team.specialists) {
    if (lane.definition_ref === undefined) continue;
    const verdict = resolveInjectionSupport({ definition_ref: lane.definition_ref }, tmuxPort);
    if (verdict.kind === "refuse") {
      process.stderr.write(
        `[agent-team-launcher] ERROR: transport "tmux" refuses definition_ref injection for ` +
          `${lane.name} (${verdict.reason_code}) — refusing BEFORE any attempt-1 record is written.\n`,
      );
      process.exit(1);
    }
  }

  // Fix B: the immutable guild.task_assignment.v2 + guild.task_attempt.v1
  // records are persisted ONLY now — after availability, collision, mixed-host
  // preflight and injection-support gates all passed. A dry run persists
  // nothing (emitTaskCellsV2 returns before any write).
  {
    const phaseId = phaseFromTeamPath(args.team) ?? "build";
    const localCellsWritten = emitTaskCellsV2(
      cwd,
      runId,
      slug,
      team.specialists as TaskCellLaunchLane[],
      phaseId,
      "tmux",
      (lane) =>
        routedHostByRole.get(lane.name) ??
        hostKindToRegistryId(lane.host_kind ?? orchestratorHostKind) ??
        String(lane.host_kind ?? orchestratorHostKind),
      launchBindingRef,
      args.dryRun || args.runId === null,
    );
    if (!args.dryRun) {
      process.stdout.write(
        `[agent-team-launcher] emitted ${localCellsWritten} tmux guild.task_assignment.v2 cell(s) → ` +
          `.guild/runs/${runId}/task-cells/\n`,
      );
    }
  }

  // MH-04 BF-2: ONE run-scoped launch through the resolved port. A dry run asks
  // the port for the launch it WOULD perform (the substrate is planned, never
  // invoked); a real run asks it to perform one. Either way the launcher reads a
  // closed typed outcome and owns only the UX.
  const launched = tmuxPort.launch(launchRequest);
  const launchResult = launched.value;
  if (!launchResult) {
    process.stderr.write(
      `[agent-team-launcher] tmux dispatch failed: ${launched.detail ?? launched.status}\n`
    );
    process.exit(2);
  }

  // W2-A2: task_runs for local specialists are already written in the pre-routing
  // block above (single-source: written file drives routing). No re-write here.
  // All task_run files — both remote-routed and local — are written ONCE, BEFORE
  // routing, so the written descriptor is the authoritative capability source.

  if (args.dryRun) {
    process.stdout.write(
      "[agent-team-launcher] dry-run — would execute the following tmux commands:\n"
    );
    for (const c of launchResult.planned_commands) process.stdout.write(`  ${c}\n`);
    for (const note of launchResult.notes ?? []) {
      process.stdout.write(`[agent-team-launcher] NOTE: ${note}\n`);
    }
    // new-session mode finishes by attaching the terminal; in-session mode does
    // NOT attach (the select-window above already surfaced the team window).
    if (mode === "new-session") {
      process.stdout.write(
        `  tmux attach-session -t ${shellQuote(targetName)}\n`
      );
    }

    const manifestPreview = buildManifest({
        runId,
        mode,
        sessionName: mode === "in-session" ? "(dry-run: current tmux session)" : targetName,
        windowName: mode === "in-session" ? targetName : null,
        specialists: team.specialists,
        dryRun: true,
        realPaneIds: null,
        orchestratorHostKind,
      });
    process.stdout.write(
      "[agent-team-launcher] session manifest preview (not written):\n" +
        JSON.stringify(manifestPreview, null, 2) +
        "\n[agent-team-launcher] dry-run complete — no state written.\n",
    );
    process.exit(0);
  }

  // Real run: the port executed the plan through the substrate, tearing down the
  // partial target on first failure (kill-window in-session / kill-session
  // new-session) and collecting teammate pane ids. The exact failed command and
  // its stderr survive as typed fields, so this message is unchanged.
  if (!launchResult.ok) {
    process.stderr.write(
      `[agent-team-launcher] tmux command failed: ${launchResult.failed_command ?? "(unknown)"}\n` +
        `  stderr: ${launchResult.failure_detail ?? ""}\n`
    );
    process.exit(2);
  }

  const lifecycle = reconcileTaskCellLifecycleTelemetry({
    cwd,
    runId,
    instanceIds: team.specialists
      .map((lane) => lane.task_cell_instance_id)
      .filter((id): id is string => typeof id === "string"),
    launchConfirmedAt: new Date().toISOString(),
  });
  if (!lifecycle.ok) {
    process.stderr.write(
      `[agent-team-launcher] WARN: tmux TaskCell lifecycle telemetry incomplete — ` +
        `${lifecycle.findings.join("; ")}\n`,
    );
  }

  const teamResultPath = writeLaunchTeamResult(cwd, runId, args.team, globalLaunchLanes);
  process.stdout.write(`[agent-team-launcher] wrote TaskCell team_result → ${teamResultPath}\n`);

  const currentSessionName = (): string | null => {
    const identity = tmuxPort.sessionIdentity();
    if (identity.status !== "succeeded" || !identity.value) return null;
    return identity.value.session_name;
  };

  // ── #76: pane dispatch → the ORCHESTRATING run's trace ───────────────────
  // The panes are separate interactive host sessions; their own hooks write
  // into their own contexts, and the lead makes no `Agent` call for the
  // #58/#66 attribution path to stamp. Without this emit a 10-lane pane run
  // reads as a solo run (`specialists_dispatched: [(none)]`). Emitted HERE —
  // after spawn confirmed ok, so a receipt means the pane really opened — and
  // only on the real path (dry-run exits above, having dispatched nothing).
  {
    const emitted = emitPaneDispatchEvents({
      cwd,
      runId,
      target: targetName,
      surface: "tmux",
      lanes: team.specialists.map((s) => ({
        specialist: s.name,
        taskId: s.taskId,
        paneId: launchResult.teammate_pane_ids[specialistDispatchKey(s)],
      })),
    });
    if (emitted > 0) {
      process.stdout.write(
        `[agent-team-launcher] recorded ${emitted} pane dispatch(es) → ` +
          `.guild/runs/${runId}/logs/v1.4-events.jsonl\n`,
      );
    }
    // The count sums emitTraceEvent's own per-write verdicts, so a shortfall is
    // a REAL gap in the run record. Never silent (the whole point of #76 is a
    // trace you can trust) — but never fatal: the panes are up, the team runs.
    if (emitted < team.specialists.length) {
      process.stderr.write(
        `[agent-team-launcher] WARN: recorded ${emitted}/${team.specialists.length} pane ` +
          `dispatch receipt(s) — this run's trace under-reports its specialists (#76).\n`,
      );
    }
  }

  const manifestPath = writeManifest(
    cwd,
    buildManifest({
      runId,
      mode,
      sessionName:
        mode === "in-session"
          ? currentSessionName() ?? "(current tmux session)"
          : targetName,
      windowName: mode === "in-session" ? targetName : null,
      specialists: team.specialists,
      dryRun: false,
      realPaneIds: {
        orchestrator: launchResult.orchestrator_pane_id ?? "",
        teammates: launchResult.teammate_pane_ids,
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

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[agent-team-launcher] FATAL: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
