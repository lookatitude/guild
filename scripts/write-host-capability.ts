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
import * as os from "os";
import * as path from "path";
import { probeTmuxAvailable } from "./lib/team-backend";

// ── Schema (guild.host_capability.v1) ────────────────────────────────────────

export type HostKind = "claude" | "codex";

export interface HostCapabilityManifest {
  schema_version: "guild.host_capability.v1";
  host_id: string;
  host_kind: HostKind;
  detected_at: string;
  source: string;
  /** Stable tier → concrete model id (cost-aware tiering ladder). */
  tiers: {
    cheap: string;
    mid: string;
    powerful: string;
  };
  /** Flat list of models this host can reach. */
  models: string[];
  /** Runtime feature support consulted by the cross-host router. */
  tool_support: {
    subagent: boolean;
    agent_team: boolean;
    independent_agents: boolean;
    tmux: boolean;
    mcp: boolean;
  };
}

// Built-in tier ladder (host-agnostic default; see cost-aware-tiering ADR §1).
const DEFAULT_TIERS: HostCapabilityManifest["tiers"] = {
  cheap: "haiku",
  mid: "sonnet",
  powerful: "opus",
};

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

function resolveHostKind(host: HostKind | undefined, env: NodeJS.ProcessEnv): HostKind {
  if (host === "claude" || host === "codex") return host;
  const raw = (env["GUILD_HOST"] ?? "").trim().toLowerCase();
  if (raw === "codex") return "codex";
  // "claude", "auto", unset, or anything unexpected → claude (the expected host).
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
  return hostKind === "claude";
}

/** Best-effort read of `.guild/settings.json` models block. Never throws. */
function readSettingsModels(cwd: string): {
  tiers?: Partial<HostCapabilityManifest["tiers"]>;
  list?: string[];
} {
  try {
    const raw = fs.readFileSync(path.join(cwd, ".guild", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as { models?: { tiers?: unknown; list?: unknown } };
    const models = parsed.models ?? {};
    const out: { tiers?: Partial<HostCapabilityManifest["tiers"]>; list?: string[] } = {};
    if (models.tiers && typeof models.tiers === "object") {
      out.tiers = models.tiers as Partial<HostCapabilityManifest["tiers"]>;
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
  const tiers: HostCapabilityManifest["tiers"] = {
    cheap: settings.tiers?.cheap ?? DEFAULT_TIERS.cheap,
    mid: settings.tiers?.mid ?? DEFAULT_TIERS.mid,
    powerful: settings.tiers?.powerful ?? DEFAULT_TIERS.powerful,
  };
  const models =
    settings.list && settings.list.length > 0
      ? settings.list
      : Array.from(new Set([tiers.cheap, tiers.mid, tiers.powerful]));

  const probe = opts.probeTmux ?? (() => probeTmuxAvailable());
  const tmux = probe();

  return {
    schema_version: "guild.host_capability.v1",
    host_id: hostId,
    host_kind: hostKind,
    detected_at: new Date().toISOString(),
    source: opts.source ?? "bootstrap",
    tiers,
    models,
    tool_support: {
      subagent: true, // always available — the universal fallback backend.
      agent_team: tmux, // tmux-backed team panes require tmux.
      independent_agents: resolveIndependentAgents(hostKind, env),
      tmux,
      mcp: true, // Claude Code MCP loader is available on supported hosts.
    },
  };
}

export function writeHostCapability(opts: BuildCapabilityOpts): string {
  const manifest = buildCapability(opts);
  const hostDir = path.join(opts.cwd, ".guild", "hosts", manifest.host_id);
  fs.mkdirSync(hostDir, { recursive: true });
  const manifestPath = path.join(hostDir, "capability.json");
  const tmpPath = path.join(
    os.tmpdir(),
    `guild-host-capability-${Date.now()}-${process.pid}.json.tmp`
  );
  // Atomic write: temp → rename (never a partial capability.json).
  fs.writeFileSync(tmpPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, manifestPath);
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
      const v = argv[++i];
      if (v === "claude" || v === "codex") out.host = v;
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
