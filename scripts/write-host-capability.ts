#!/usr/bin/env -S npx tsx
/**
 * scripts/write-host-capability.ts
 *
 * RE-5 — host-capability manifest writer.
 *
 * Contract (BY POINTER): docs/knowledge/decisions/v2-runtime-and-execution-model.md
 *   §RE-5 (host-capability manifest). Schema: guild.host_capability.v1.
 * Tier ladder (cheap/mid/powerful → model) is canonical in
 *   docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md §1/§10.
 *
 * Writes <cwd>/.guild/hosts/<host-id>/capability.json at session/bootstrap so
 * the cross-host router (RE-4 RemoteTeamBackend, lands a later wave) can read,
 * per host, which kind it is (claude|codex), which model tiers it can reach,
 * and which runtime features it supports (tmux teams, independent agents,
 * subagents, MCP). This is a DESCRIPTOR file — it never routes anything itself.
 *
 * Resolution:
 *   host kind  — --host | GUILD_HOST (claude|codex; "auto"/unset → claude).
 *   host id    — --host-id | GUILD_HOST_ID | <host kind> (names the directory).
 *   tiers      — <cwd>/.guild/settings.json `models.tiers` if present, else the
 *                built-in ladder { cheap: haiku, mid: sonnet, powerful: opus }.
 *   models     — `models.list` from settings if present, else the tier values.
 *   tmux/teams — probed via the shared TeamBackend tmux probe (RE-4).
 *   indep.     — GUILD_INDEPENDENT_AGENTS_SUPPORTED, else GUILD_HOST heuristic
 *                (claude/auto → yes; codex → no), mirroring the launcher ladder.
 *
 * Usage:
 *   npx tsx scripts/write-host-capability.ts --cwd <root> \
 *       [--host claude|codex] [--host-id <id>] [--source <label>]
 *
 * Writes:  <cwd>/.guild/hosts/<host-id>/capability.json (atomic temp→rename).
 * Stdout:  path to the written manifest.
 * Stderr:  diagnostics.
 * Exit:    0 success · 1 bad input (--cwd invalid) · 2 internal error.
 *
 * Invariant: never writes to .guild/wiki/. Writes only under .guild/hosts/.
 */

import * as fs from "fs";
import * as path from "path";
import { probeTmuxAvailable } from "./lib/team-backend";
import { atomicWrite } from "../src/modules/state";
// G-11 (SC-6): models.tiers values are a union (string | {model,effort?,verbosity?} | null);
// resolveTierModel is the ONLY place the union is unpacked. It also tolerates the
// legacy flat form (tiers.cheap = "model-name") this writer historically accepted.
import { resolveTierModel } from "../src/modules/config/workflows/tier-model";

// ── Schema (guild.host_capability.v1) ────────────────────────────────────────

import type {
  HostCapabilityManifest,
  HostKind,
} from "../src/modules/host-runtime/workflows/host-capability-manifest";
export type {
  HostCapabilityManifest,
  HostKind,
} from "../src/modules/host-runtime/workflows/host-capability-manifest";
// W4 D1: registry-bridge predicates replace `=== "claude"` literals in this file.
// Both sites gate on a CLI-NATIVE capability (in-process independent agents, native PreToolUse
// ask) that the claude desktop/web/app variants do NOT share — so they use the EXACT isClaudeCli,
// NOT the family-wide isClaudeHost (which would wrongly enable claude-code-desktop/web/app).
import { isClaudeCli } from "./lib/capability/rank";
// W4 D2: runtime tier defaults from the registry (kills DEFAULT_TIER_MODELS hand-typed literal).
import { defaultTierModels } from "./lib/capability/tier-defaults";

// Built-in tier ladder — W4 D2: runtime-from-registry via defaultTierModels().
// No hand-typed literals; reads from HOST_REGISTRY_ROWS["claude-code-cli"].capabilities.models.
// Behavior-neutral: the computed values equal the former {cheap:"haiku",mid:"sonnet",powerful:"opus"}.
// See tier-defaults.ts and the parity test (rearch-tier-defaults-parity.test.ts).
const DEFAULT_TIER_MODELS = defaultTierModels();

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface BuildCapabilityOpts {
  cwd: string;
  host?: HostKind;
  hostId?: string;
  source?: string;
  /** Test seam: override the tmux availability probe. */
  probeTmux?: () => boolean;
  /** Test seam: override env lookups (defaults to process.env). */
  env?: NodeJS.ProcessEnv;
}

/** All HostKind values from host-types.ts — kept in sync by type. (gemini was sunset 2026-06-14.) */
const ALL_HOST_KINDS: readonly HostKind[] = [
  "claude",
  "codex",
  "pi",
  "antigravity-2",
  "claude-code-desktop",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
];

function resolveHostKind(host: HostKind | undefined, env: NodeJS.ProcessEnv): HostKind {
  // Explicit --host / programmatic override takes priority.
  if (host !== undefined && (ALL_HOST_KINDS as string[]).includes(host)) return host;
  // GUILD_HOST env var (set by bootstrap for non-claude runtimes).
  const raw = (env["GUILD_HOST"] ?? "").trim().toLowerCase() as HostKind;
  if ((ALL_HOST_KINDS as string[]).includes(raw)) return raw;
  // "auto", unset, or unrecognized → claude (the reference impl / default host).
  return "claude";
}

function resolveIndependentAgents(hostKind: HostKind, env: NodeJS.ProcessEnv): boolean {
  const explicit = env["GUILD_INDEPENDENT_AGENTS_SUPPORTED"];
  if (explicit !== undefined) {
    const s = explicit.trim().toLowerCase();
    return !(s === "0" || s === "false" || s === "no" || s === "off");
  }
  // Mirror the launcher's D5 heuristic: claude supports independent agents;
  // codex currently does not.
  // W4 D1: registry bridge — EXACT claude CLI (isClaudeCli), behavior-equivalent to the
  // historical `hostKind === "claude"` (only the CLI does in-process independent agents;
  // desktop/web/app do not). isClaudeHost (family) would over-broaden this.
  return isClaudeCli(hostKind);
}

/** Best-effort read of `.guild/settings.json` models block. Never throws. */
function readSettingsModels(cwd: string): {
  /**
   * Raw `models.tiers` value — NOT unpacked here. The tier→host value union
   * (G-11: string | {model,effort?,verbosity?} | null) plus the legacy flat
   * form are normalized exclusively by resolveTierModel() in buildCapability.
   */
  tiers?: unknown;
  list?: string[];
} {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".guild", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { models?: { tiers?: unknown; list?: unknown } };
    const models = parsed.models ?? {};
    const out: { tiers?: unknown; list?: string[] } = {};
    // settings.json still uses `models.tiers` key (settings schema is unchanged)
    if (models.tiers && typeof models.tiers === "object") {
      out.tiers = models.tiers;
    }
    if (Array.isArray(models.list)) {
      out.list = (models.list as unknown[]).filter((m): m is string => typeof m === "string");
    }
    return out;
  } catch {
    return {};
  }
}

// ── Build + write ─────────────────────────────────────────────────────────────

export function buildCapability(opts: BuildCapabilityOpts): HostCapabilityManifest {
  const env = opts.env ?? process.env;
  const hostKind = resolveHostKind(opts.host, env);
  const hostId = opts.hostId ?? env["GUILD_HOST_ID"] ?? hostKind;

  const settings = readSettingsModels(opts.cwd);
  // TE-07/DQ-5: canonical field is `tier_models`; settings.json key is still `models.tiers`.
  // G-11 (SC-6): unpack the tier value union through resolveTierModel — the ONLY unpack
  // point. The manifest's tier_models stay plain strings (guild.host_capability.v1 is
  // frozen); the object form contributes its `model` here, effort/verbosity are
  // dispatch-time concerns. The legacy flat shape (tiers.cheap = "haiku-3") resolves
  // byte-identically via the helper's flat-form tolerance.
  const tierModels: HostCapabilityManifest["tier_models"] = {
    cheap: resolveTierModel(settings.tiers, "cheap", hostKind).model ?? DEFAULT_TIER_MODELS.cheap,
    mid: resolveTierModel(settings.tiers, "mid", hostKind).model ?? DEFAULT_TIER_MODELS.mid,
    powerful: resolveTierModel(settings.tiers, "powerful", hostKind).model ?? DEFAULT_TIER_MODELS.powerful,
  };
  const models =
    settings.list && settings.list.length > 0
      ? settings.list
      : Array.from(new Set([tierModels.cheap, tierModels.mid, tierModels.powerful]));

  const probe = opts.probeTmux ?? (() => probeTmuxAvailable());
  const tmux = probe();

  return {
    schema_version: "guild.host_capability.v1",
    host_id: hostId,
    host_kind: hostKind,
    // TE-07/DQ-5: write canonical `advertised_at`; router lenient-reads `advertised_at ?? detected_at`
    advertised_at: new Date().toISOString(),
    source: opts.source ?? "bootstrap",
    tier_models: tierModels,
    supported_tiers: ["cheap", "mid", "powerful"],
    models,
    tool_support: {
      subagent: true, // always available — the universal fallback backend.
      agent_team: tmux, // tmux-backed team panes require tmux.
      independent_agents: resolveIndependentAgents(hostKind, env),
      tmux,
      mcp: true, // Claude Code MCP loader is available on supported hosts.
      // HK-07: Claude Code natively supports PreToolUse ask; other hosts
      // (codex, pi) must degrade to the file-bus approval_request path.
      // W4 D1: registry bridge — EXACT isClaudeCli replaces the `=== "claude"` literal.
      // Behavior-neutral: Claude Code CLI is the ONLY host with native PreToolUse ask; the
      // desktop/web/app variants degrade to the file-bus path (isClaudeHost would wrongly include them).
      pre_tool_use_ask: isClaudeCli(hostKind),
    },
  };
}

export function writeHostCapability(opts: BuildCapabilityOpts): string {
  const manifest = buildCapability(opts);
  const hostDir = path.join(opts.cwd, ".guild", "hosts", manifest.host_id);
  fs.mkdirSync(hostDir, { recursive: true });
  const manifestPath = path.join(hostDir, "capability.json");
  // Atomic write: same-directory temp file → rename (never a partial
  // capability.json; never os.tmpdir(), which can throw EXDEV on rename).
  atomicWrite(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return manifestPath;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  cwd?: string;
  host?: HostKind;
  hostId?: string;
  source?: string;
} {
  const out: { cwd?: string; host?: HostKind; hostId?: string; source?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd" && argv[i + 1]) out.cwd = argv[++i];
    else if (a === "--host" && argv[i + 1]) {
      const v = argv[++i] as HostKind;
      if ((ALL_HOST_KINDS as string[]).includes(v)) out.host = v;
    } else if (a === "--host-id" && argv[i + 1]) out.hostId = argv[++i];
    else if (a === "--source" && argv[i + 1]) out.source = argv[++i];
  }
  return out;
}

function main(): void {
  const parsed = parseArgs(process.argv.slice(2));
  const cwd = parsed.cwd ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    process.stderr.write(
      `[write-host-capability] ERROR: --cwd "${cwd}" is not a directory\n`
    );
    process.exit(1);
  }

  try {
    const written = writeHostCapability({
      cwd,
      host: parsed.host,
      hostId: parsed.hostId,
      source: parsed.source,
    });
    process.stdout.write(written + "\n");
  } catch (e) {
    process.stderr.write(`[write-host-capability] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}
