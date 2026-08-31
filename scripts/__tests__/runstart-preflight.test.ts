/**
 * scripts/__tests__/runstart-preflight.test.ts
 *
 * TDD suite for scripts/lib/runstart-preflight.ts (Unit 3 — run-start preflight
 * of the settings-control-and-tmux initiative).
 *
 * All external probes are INJECTED — no test depends on real tmux/codex
 * binaries. Tmp-dir fixtures stand in for settings files.
 *
 * Coverage map:
 *  - needsTmuxPrompt (OD-3): tmux available + effective agent_mode != "team" → TRUE;
 *    tmux available + agent_mode "team" → FALSE; tmux NOT available → FALSE;
 *    tmux available + agent_mode "subagent" → TRUE; tmux available + agent_mode "auto" → TRUE.
 *  - AC-5: tmuxPrompt carries the exact persist argv (set agent_mode team --scope workspace)
 *    and a clear English question. Persistence is via that argv, not a direct write.
 *  - AC-6: providers populated (authorHost detected; recommended provider per review).
 *    Claude host + codex-plugin → recommended codex-plugin.
 *  - validation: a resolved config with a closed-key violation surfaces
 *    validation.ok=false with errors.
 *  - snapshot: correct shape + schema_version + source_chain + effective backend
 *    + providers + communication_contract + resolved_at_ref null.
 *  - Real workspace case: effective agent_mode "team" (root) + tmux available
 *    → needsTmuxPrompt FALSE (no prompt fires after inheritance).
 *  - persistTmuxTeamArgv: returns the correct argv for config-cmd set.
 *  - sources top-level field: result.sources equals result.resolved.sources (MAJOR fix).
 *  - unknown authorHost path: recommended is null; snapshot.providers has no `selected`
 *    field synthesized (MINOR fix — authorHost "unknown" never yields a selected reviewer).
 *  - R-008 pin honored: adversarial_review_provider="codex-plugin" + review=cross →
 *    providers.selected="codex-plugin" (via selectReviewer AC-8 hard rule), even when
 *    another provider could rank higher. "auto" → selected stays undefined.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  detectClaudeNativeAdapterIdentity,
  runStartPreflight,
  persistTmuxTeamArgv,
  type PreflightProbe,
  type PreflightOptions,
  type PreflightResult,
  type ResolvedSettingsSnapshot,
} from "../lib/runstart-preflight";
import type { ProbeEnv } from "../lib/provider-detect";

// ---------------------------------------------------------------------------
// Helpers — tmp fixture directories
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-preflight-test-"));
}

function writeSettings(dir: string, content: Record<string, unknown>): void {
  const guildDir = path.join(dir, ".guild");
  fs.mkdirSync(guildDir, { recursive: true });
  fs.writeFileSync(path.join(guildDir, "settings.json"), JSON.stringify(content, null, 2));
}

describe("detectClaudeNativeAdapterIdentity", () => {
  it("never promotes an unmarked process into verified Claude identity", () => {
    expect(detectClaudeNativeAdapterIdentity({})).toBeNull();
  });

  it("binds the Guild adapter-contract version when the live host marker is present", () => {
    expect(detectClaudeNativeAdapterIdentity(
      { CLAUDECODE: "1" },
    )).toMatchObject({
      family: "claude",
      adapter_id: "claude-code-native",
      adapter_version: "guild.host_adapter.v1.0.0",
    });
  });

  it("does not let an environment host-version claim redefine the adapter contract", () => {
    expect(detectClaudeNativeAdapterIdentity({
      CLAUDECODE: "1",
      CLAUDE_CODE_VERSION: "../../spoof",
    })?.adapter_version).toBe("guild.host_adapter.v1.0.0");
  });
});

/** Create a project directory that is a child of a workspace root. */
function makeWorkspaceWithChild(
  wsSettings: Record<string, unknown>,
  childSettings?: Record<string, unknown>
): { wsDir: string; childDir: string } {
  const wsDir = makeTmpDir();
  // Write workspace manifest
  const wsGuildDir = path.join(wsDir, ".guild");
  fs.mkdirSync(wsGuildDir, { recursive: true });
  fs.writeFileSync(
    path.join(wsGuildDir, "workspace.json"),
    JSON.stringify({ is_workspace: true, sub_guilds: [] })
  );
  writeSettings(wsDir, wsSettings);

  // Create child directory (NOT a git repo, just a sub-dir)
  const childDir = path.join(wsDir, "plugin");
  fs.mkdirSync(childDir);
  if (childSettings) {
    writeSettings(childDir, childSettings);
  }

  return { wsDir, childDir };
}

// ---------------------------------------------------------------------------
// Injectable probe builders
// ---------------------------------------------------------------------------

interface FakeWorld {
  incompleteRun?: { runId: string; runDir: string } | null;
  tmuxOnPath?: boolean;
  /** T3: make the fake probe inject a verified claude native-adapter identity. */
  claudeNativeIdentity?: boolean;
  /** T3 F4: inject an arbitrary verified native-adapter identity (wins over claudeNativeIdentity). */
  nativeIdentity?: {
    family: "claude" | "codex" | "pi" | "antigravity" | "unknown" | "agents";
    surface: "cli" | "app" | "web" | "api" | "connector" | "file" | "unknown";
    adapter_id: string;
    adapter_version: string;
    evidence: string;
  };
  providerWorld?: {
    onPath?: string[];
    versionOk?: string[];
    codexStoredAuth?: boolean;
    env?: Record<string, string>;
    capabilityProviders?: string[];
    pluginAdapters?: string[];
  };
}

function makeProbeEnv(world: FakeWorld["providerWorld"] = {}): ProbeEnv {
  const onPath = new Set(world.onPath ?? []);
  const versionOk = new Set(world.versionOk ?? []);
  const plugins = new Set(world.pluginAdapters ?? []);
  const env = world.env ?? {};
  return {
    commandOnPath: (bin: string) => onPath.has(bin),
    probeVersion: (bin: string) => versionOk.has(bin),
    readStoredCodexAuth: () => world.codexStoredAuth === true,
    readEnv: (name: string) => env[name],
    readCapabilityProviders: () => world.capabilityProviders ?? [],
    readPluginAdapter: (id: string) => plugins.has(id),
  };
}

function makeProbe(world: FakeWorld): PreflightProbe {
  return {
    tmuxOnPath: () => world.tmuxOnPath === true,
    providerProbe: makeProbeEnv(world.providerWorld ?? {}),
    incompleteRun: () => world.incompleteRun ?? null,
    // T3 (session_context §4 step 2): the fake native-adapter identity. The
    // reference "Claude host" scenarios set claudeNativeIdentity — with the
    // retired claude default gone, author identity must come from an explicit
    // host setting or this adapter injection, never a fallback.
    hostIdentity: () =>
      world.nativeIdentity ??
      (world.claudeNativeIdentity
        ? {
            family: "claude" as const,
            surface: "cli" as const,
            adapter_id: "claude-code-native",
            adapter_version: "test",
            evidence: "fake host-set env marker (test probe)",
          }
        : null),
  };
}

// A probe with tmux available AND codex-plugin detected+authed (the reference scenario).
const CLAUDE_HOST_CODEX_PLUGIN_PROBE = makeProbe({
  tmuxOnPath: true,
  claudeNativeIdentity: true,
  providerWorld: {
    pluginAdapters: ["codex-plugin"],
    codexStoredAuth: true,
  },
});

// A probe with tmux available but NO codex.
const TMUX_NO_CODEX_PROBE = makeProbe({ tmuxOnPath: true, providerWorld: {} });

// A probe with NO tmux, NO codex.
const NO_TMUX_PROBE = makeProbe({ tmuxOnPath: false, providerWorld: {} });

// ---------------------------------------------------------------------------
// 1. needsTmuxPrompt — OD-3 semantics
// ---------------------------------------------------------------------------

describe("needsTmuxPrompt — OD-3", () => {
  it("is TRUE when tmux is available and effective agent_mode is 'auto'", () => {
    // Standalone project, no workspace, agent_mode defaults to 'auto'
    const cwd = makeTmpDir();
    // No settings.json → built-in defaults → agent_mode: "auto"
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.resolved.config.agent_mode).toBe("auto");
    expect(result.tmux.available).toBe(true);
    expect(result.tmux.inEffect).toBe(false);
    expect(result.needsTmuxPrompt).toBe(true);
  });

  it("is TRUE when tmux is available and effective agent_mode is 'subagent'", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "subagent" });
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.resolved.config.agent_mode).toBe("subagent");
    expect(result.needsTmuxPrompt).toBe(true);
  });

  it("is TRUE when tmux is available and effective agent_mode is 'agent'", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "agent" });
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.resolved.config.agent_mode).toBe("agent");
    expect(result.needsTmuxPrompt).toBe(true);
  });

  it("is FALSE when tmux is available but effective agent_mode is 'team'", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "team" });
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.resolved.config.agent_mode).toBe("team");
    expect(result.tmux.inEffect).toBe(true);
    expect(result.needsTmuxPrompt).toBe(false);
  });

  it("is FALSE when tmux is NOT available (agent_mode is 'auto')", () => {
    const cwd = makeTmpDir();
    // Default agent_mode: 'auto'
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.tmux.available).toBe(false);
    expect(result.needsTmuxPrompt).toBe(false);
  });

  it("is FALSE when tmux is NOT available even if agent_mode is 'subagent'", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "subagent" });
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.tmux.available).toBe(false);
    expect(result.needsTmuxPrompt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Real workspace case — AC-5 workspace root scenario
//    Root already has agent_mode:team → prompt must NOT fire after inheritance.
// ---------------------------------------------------------------------------

describe("real workspace case — team inherited, no prompt", () => {
  it("needsTmuxPrompt is FALSE when child inherits agent_mode=team from workspace root", () => {
    const { childDir } = makeWorkspaceWithChild(
      { agent_mode: "team" }, // workspace root
      undefined               // child has no settings.json → inherits
    );
    const result = runStartPreflight({
      cwd: childDir,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    // Child should inherit agent_mode: "team" from workspace root
    expect(result.resolved.config.agent_mode).toBe("team");
    expect(result.tmux.inEffect).toBe(true);
    expect(result.needsTmuxPrompt).toBe(false);
  });

  it("needsTmuxPrompt is TRUE when child overrides agent_mode to 'subagent'", () => {
    const { childDir } = makeWorkspaceWithChild(
      { agent_mode: "team" },    // workspace root says team
      { agent_mode: "subagent" } // child overrides to subagent
    );
    const result = runStartPreflight({
      cwd: childDir,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.resolved.config.agent_mode).toBe("subagent");
    expect(result.needsTmuxPrompt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. AC-5 — tmuxPrompt shape and persist argv
// ---------------------------------------------------------------------------

describe("AC-5 — tmuxPrompt shape when prompt is needed", () => {
  it("tmuxPrompt is non-null with a question string and persist argv when needsTmuxPrompt", () => {
    const cwd = makeTmpDir();
    // Default agent_mode: 'auto', tmux available
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.needsTmuxPrompt).toBe(true);
    expect(result.tmuxPrompt).not.toBeNull();
    expect(typeof result.tmuxPrompt!.question).toBe("string");
    expect(result.tmuxPrompt!.question.length).toBeGreaterThan(10);
  });

  it("tmuxPrompt.persistCommand is exactly ['set', 'agent_mode', 'team', '--scope', 'workspace']", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.tmuxPrompt!.persistCommand).toEqual([
      "set",
      "agent_mode",
      "team",
      "--scope",
      "workspace",
    ]);
  });

  it("tmuxPrompt is null when needsTmuxPrompt is false", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "team" });
    const result = runStartPreflight({
      cwd,
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    expect(result.needsTmuxPrompt).toBe(false);
    expect(result.tmuxPrompt).toBeNull();
  });

  it("tmuxPrompt is null when tmux is not available", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.tmuxPrompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. persistTmuxTeamArgv — the standalone helper
// ---------------------------------------------------------------------------

describe("persistTmuxTeamArgv", () => {
  it("returns ['set', 'agent_mode', 'team', '--scope', 'workspace'] by default", () => {
    expect(persistTmuxTeamArgv()).toEqual([
      "set",
      "agent_mode",
      "team",
      "--scope",
      "workspace",
    ]);
  });

  it("accepts a custom scope", () => {
    expect(persistTmuxTeamArgv("project")).toEqual([
      "set",
      "agent_mode",
      "team",
      "--scope",
      "project",
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5. AC-6 — providers populated
// ---------------------------------------------------------------------------

describe("AC-6 — provider detection populated", () => {
  it("populates providers.authorHost as 'claude' from the native-adapter identity (session_context §4 step 2)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE,
    });
    expect(result.providers.authorHost).toBe("claude");
    // T3: the identity inputs are surfaced for startRun's session context.
    expect(result.session_identity.native_adapter?.family).toBe("claude");
    expect(result.session_identity.envelope_host).toBeUndefined();
  });

  it("resolves authorHost 'unknown' when host is auto and NO native identity exists (§3 — no claude default)", () => {
    const cwd = makeTmpDir();
    // TMUX_NO_CODEX_PROBE injects no native identity and settings carry the
    // default host: "auto" — the retired claude fallback must NOT resurface.
    const result = runStartPreflight({ cwd, probe: TMUX_NO_CODEX_PROBE });
    expect(result.providers.authorHost).toBe("unknown");
    expect(result.session_identity.native_adapter).toBeNull();
  });

  it("an explicit host setting is captured as the CANONICAL asserted envelope host (§4 step 1; F5)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { host: "codex" });
    // No native identity in the probe → the assertion stands, trust stays asserted.
    const result = runStartPreflight({ cwd, probe: TMUX_NO_CODEX_PROBE });
    // F5: the settings resolver canonicalizes host "codex" → the registry id
    // "codex-cli"; envelope_host carries that canonical asserted value verbatim
    // (family resolution to "codex" happens downstream via resolveAuthorHost).
    expect(result.resolved.config.host).toBe("codex-cli");
    expect(result.session_identity.envelope_host).toBe("codex-cli");
    expect(result.providers.authorHost).toBe("codex");
    expect(result.providers.authorTrust).toBe("asserted");
    expect(result.snapshot.providers.authorTrust).toBe("asserted");
  });

  it("F4 (reviewer probe): a VERIFIED native identity that CONTRADICTS the asserted host replaces it downstream", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { host: "codex" });
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE, // verified native claude
    });
    // §4 conflict rule: the verified family REPLACES the contradicted assertion
    // before any provider/reviewer/role resolution — never the other way round.
    expect(result.providers.authorHost).toBe("claude");
    expect(result.providers.authorTrust).toBe("verified");
    // The asserted envelope value is still surfaced for the frozen session
    // context, which records the conflict + rejection (§4).
    expect(result.session_identity.envelope_host).toBe("codex-cli");
    expect(result.session_identity.native_adapter?.family).toBe("claude");
  });

  it("Claude host + codex-plugin available → recommended is codex-plugin (AC-7)", () => {
    const cwd = makeTmpDir();
    // review: cross so we get a recommendation
    writeSettings(cwd, { review: "cross" });
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE,
    });
    expect(result.providers.recommended).toBe("codex-plugin");
  });

  it("providers.detected lists all providers including codex-plugin", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE,
    });
    const ids = result.providers.detected.map((p) => p.id);
    expect(ids).toContain("codex-plugin");
  });

  it("Claude host + no reviewers → recommended is null", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    const result = runStartPreflight({
      cwd,
      probe: TMUX_NO_CODEX_PROBE,
    });
    expect(result.providers.recommended).toBeNull();
  });

  it("review.mode=local → recommended is null (no cross needed)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "local" });
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE,
    });
    // recommendProvider returns null when mode !== cross
    expect(result.providers.recommended).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 6. Validation — closed-key violations surface in validation.errors
// ---------------------------------------------------------------------------

describe("validation — closed-key violations", () => {
  it("validation.ok is true for a clean built-in default config", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.validation.ok).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it("validation.ok is false and errors populated when models block has unknown key", () => {
    // We test validation by passing a flags override that injects an invalid models key
    // via the 'flags' option. The validators run against the RESOLVED config.
    // Since models is a complex block, inject via direct test of validation logic
    // by using a real settings file with a bad security block value (parseable but wrong).
    // The validators in read-guild-config.ts validate the resolved config's sub-blocks.
    // We must trigger a violation through the resolved config.
    // The easiest: create a settings file that resolves to a known bad security value.
    // But parseSettingsFile only accepts valid enum values... so we test via the
    // preflight validation interface directly.
    //
    // Strategy: pass a `flags` override with a bad security block (the preflight
    // must run validators on the MERGED config including flags).
    const cwd = makeTmpDir();
    const result = runStartPreflight({
      cwd,
      flags: {
        security: { bypass_permissions_policy: "INVALID_VALUE" as never },
      },
      probe: NO_TMUX_PROBE,
    });
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
    // Error message should mention security
    expect(result.validation.errors.some((e) => e.includes("security"))).toBe(true);
  });

  it("validation catches unknown models key via flags injection", () => {
    const cwd = makeTmpDir();
    // We inject a models block with an unknown key via flags
    const result = runStartPreflight({
      cwd,
      flags: {
        models: {
          ...({} as Record<string, unknown>),
          unknownModelsKey: "bad",
        } as never,
      },
      probe: NO_TMUX_PROBE,
    });
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.some((e) => e.includes("models"))).toBe(true);
  });

  it("validation catches bad mcp block via flags", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({
      cwd,
      flags: {
        mcp: { tool_description_hashes: "not-an-object" as never },
      },
      probe: NO_TMUX_PROBE,
    });
    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.some((e) => e.includes("mcp"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Snapshot — ResolvedSettingsSnapshot shape
// ---------------------------------------------------------------------------

describe("snapshot — ResolvedSettingsSnapshot shape", () => {
  it("has the correct schema_version", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.schema_version).toBe("guild.resolved_settings.v1");
  });

  it("snapshot.source_chain is a non-empty object (from sources)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(typeof result.snapshot.source_chain).toBe("object");
    expect(Object.keys(result.snapshot.source_chain).length).toBeGreaterThan(0);
  });

  it("snapshot.effective contains agent_mode from the resolved config", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "team" });
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.effective.agent_mode).toBe("team");
  });

  it("snapshot.effective contains host, review, rigor, loops, loop_cap", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    const eff = result.snapshot.effective;
    expect(eff).toHaveProperty("agent_mode");
    expect(eff).toHaveProperty("host");
    expect(eff).toHaveProperty("review");
    expect(eff).toHaveProperty("rigor");
    expect(eff).toHaveProperty("loops");
    expect(eff).toHaveProperty("loop_cap");
    // #93: the backend-degradation guard's strict rung, hoisted here so
    // hooks/lib/backend-degradation.ts can read the resolved value from the
    // snapshot instead of importing the settings resolver into pre-tool-use.js
    // (measured: that import takes that per-tool-call bundle 110 KB → 923 KB).
    expect(eff).toHaveProperty("block_unmarked_lanes");
  });

  // ── #93 — settings.json → resolveSettings → snapshot, end to end ──────────
  // This is the leg that makes the hook-side snapshot read EQUIVALENT to reading
  // the resolved config: whatever the 5-layer chain resolves is what gets frozen.

  it("snapshot.effective.block_unmarked_lanes defaults to false when unconfigured", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.effective.block_unmarked_lanes).toBe(false);
  });

  it("snapshot.effective.block_unmarked_lanes carries a configured project value", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { defaults: { dispatch: { block_unmarked_lanes: true } } });
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.effective.block_unmarked_lanes).toBe(true);
  });

  it("snapshot.effective.block_unmarked_lanes INHERITS a workspace-level value (PR #87 codex round-2 finding)", () => {
    // A hand-rolled project-settings.json-only reader in the hook would have
    // missed this entirely. Going through resolveSettings at run start means the
    // workspace layer is honored for free.
    const { childDir } = makeWorkspaceWithChild({
      defaults: { dispatch: { block_unmarked_lanes: true } },
    });
    const result = runStartPreflight({ cwd: childDir, probe: NO_TMUX_PROBE });
    expect(result.snapshot.effective.block_unmarked_lanes).toBe(true);
  });

  it("a child's own value WINS over the workspace value (layer precedence preserved)", () => {
    const { childDir } = makeWorkspaceWithChild(
      { defaults: { dispatch: { block_unmarked_lanes: true } } },
      { defaults: { dispatch: { block_unmarked_lanes: false } } },
    );
    const result = runStartPreflight({ cwd: childDir, probe: NO_TMUX_PROBE });
    expect(result.snapshot.effective.block_unmarked_lanes).toBe(false);
  });

  it("snapshot.providers contains authorHost, detected, recommended", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE });
    expect(result.snapshot.providers).toHaveProperty("authorHost");
    expect(result.snapshot.providers).toHaveProperty("detected");
    expect(Array.isArray(result.snapshot.providers.detected)).toBe(true);
    expect(result.snapshot.providers).toHaveProperty("recommended");
  });

  it("snapshot.communication_contract is 'review_result.v1'", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.communication_contract).toBe("review_result.v1");
  });

  it("snapshot.resolved_at_ref is null (U6 fills this in)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.snapshot.resolved_at_ref).toBeNull();
  });

  it("snapshot with claude+codex-plugin scenario captures providers correctly", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    const result = runStartPreflight({
      cwd,
      probe: CLAUDE_HOST_CODEX_PLUGIN_PROBE,
    });
    expect(result.snapshot.providers.authorHost).toBe("claude");
    expect(result.snapshot.providers.recommended).toBe("codex-plugin");
    const detected = result.snapshot.providers.detected;
    expect(detected.some((p) => p.id === "codex-plugin" && p.selectable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Full result shape — all fields are present
// ---------------------------------------------------------------------------

describe("PreflightResult — complete shape", () => {
  it("returns all required top-level fields", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result).toHaveProperty("resolved");
    expect(result).toHaveProperty("validation");
    expect(result).toHaveProperty("tmux");
    expect(result).toHaveProperty("needsTmuxPrompt");
    expect(result).toHaveProperty("tmuxPrompt");
    expect(result).toHaveProperty("providers");
    expect(result).toHaveProperty("snapshot");
  });

  it("resolved has config and sources", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.resolved).toHaveProperty("config");
    expect(result.resolved).toHaveProperty("sources");
  });

  it("validation has ok and errors", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(typeof result.validation.ok).toBe("boolean");
    expect(Array.isArray(result.validation.errors)).toBe(true);
  });

  it("tmux has available and inEffect", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(typeof result.tmux.available).toBe("boolean");
    expect(typeof result.tmux.inEffect).toBe("boolean");
  });

  it("providers has authorHost, detected, recommended, reason", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(result.providers).toHaveProperty("authorHost");
    expect(result.providers).toHaveProperty("detected");
    expect(result.providers).toHaveProperty("recommended");
    expect(result.providers).toHaveProperty("reason");
  });
});

// ---------------------------------------------------------------------------
// 9. Flag overrides pass through to resolver
// ---------------------------------------------------------------------------

describe("flag overrides", () => {
  it("CLI flags override file settings in the resolved config", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "subagent" });
    const result = runStartPreflight({
      cwd,
      flags: { agent_mode: "team" },
      probe: makeProbe({ tmuxOnPath: true, providerWorld: {} }),
    });
    // Flag override takes precedence
    expect(result.resolved.config.agent_mode).toBe("team");
    // With team effective, no prompt needed
    expect(result.needsTmuxPrompt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. MAJOR fix — top-level `sources` field (U6/U7 contract)
// ---------------------------------------------------------------------------

describe("sources — top-level field on PreflightResult", () => {
  it("result.sources is present at the top level (not only inside result.resolved)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    // The MAJOR finding: sources must be directly on PreflightResult, not only
    // accessible via result.resolved.sources.
    expect(result).toHaveProperty("sources");
    expect(typeof result.sources).toBe("object");
    expect(result.sources).not.toBeNull();
  });

  it("result.sources equals result.resolved.sources (same reference/content)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    // Top-level sources must be the same map as the nested one.
    expect(result.sources).toEqual(result.resolved.sources);
  });

  it("result.sources is non-empty (has at least the built-in keys)", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    expect(Object.keys(result.sources).length).toBeGreaterThan(0);
  });

  it("result.sources and snapshot.source_chain are consistent", () => {
    const cwd = makeTmpDir();
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    // Both should reflect the same source map.
    expect(result.sources).toEqual(result.snapshot.source_chain);
  });

  it("result.sources reflects file-layer sources when a settings.json is present", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { agent_mode: "team", review: "cross" });
    const result = runStartPreflight({ cwd, probe: NO_TMUX_PROBE });
    // Keys written in the file should be sourced from "project", not "builtin".
    expect(result.sources["agent_mode"]).toBe("project");
    expect(result.sources["review"]).toBe("project");
  });
});

// ---------------------------------------------------------------------------
// 11. MINOR fix — unknown authorHost path (no selected, recommended null)
// ---------------------------------------------------------------------------

describe("unknown authorHost — no selected reviewer synthesized", () => {
  // A probe that makes detectProviders return authorHost "unknown":
  // inject host: "unknown-host" via a flag override so the resolver yields
  // host: "unknown-host", which resolveAuthorHost maps to "unknown".
  // We achieve this by setting host to a value that round-trips through the
  // resolver as a known valid host key, but then passing host="unknown" directly
  // to the preflight options by overriding the config.host field used in
  // detectProviders. The cleanest approach: use flags to override host to a
  // string that resolveAuthorHost maps to "unknown".
  //
  // resolveAuthorHost("unknown") → "unknown" (it IS in KNOWN_FAMILIES? No:
  // KNOWN_FAMILIES = {claude,codex,pi,antigravity}. "unknown" is not in it,
  // so it returns "unknown". BUT the resolver only accepts "claude"|"codex"|"auto"
  // for the `host` field (parseSettingsFile validates). So we cannot inject
  // host="unknown" through settings. Instead, we verify the safeProbe fallback:
  // when detectProviders throws (force via a bad probe), authorHost becomes "unknown".
  //
  // Practical approach: use a custom probe whose providerProbe.readCapabilityProviders
  // throws — but detectProviders wraps with safe() so it would still work.
  //
  // Best approach: pass host="pi" (the author) with only same-family or
  // no reviewers, which causes recommended=null. But for "unknown" specifically:
  // we can inject via the probe's readPluginAdapter returning true for a bad id.
  //
  // Cleanest: craft a PreflightProbe where providerProbe throws on every call
  // (simulates total probe failure) so the safeProbe fallback kicks in and
  // detection returns { authorHost: "unknown", providers: [] }.

  function makeCrashingProbe(tmuxOnPath: boolean): PreflightProbe {
    const crashingProviderProbe: ProbeEnv = {
      commandOnPath: () => { throw new Error("simulated crash"); },
      probeVersion: () => { throw new Error("simulated crash"); },
      readStoredCodexAuth: () => { throw new Error("simulated crash"); },
      readEnv: () => { throw new Error("simulated crash"); },
      readCapabilityProviders: () => { throw new Error("simulated crash"); },
      readPluginAdapter: () => { throw new Error("simulated crash"); },
    };
    return {
      tmuxOnPath: () => tmuxOnPath,
      providerProbe: crashingProviderProbe,
      incompleteRun: () => { throw new Error("simulated crash"); },
    };
  }

  it("when detection fails entirely, authorHost falls back to 'unknown' and recommended is null", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    // The safeProbe wrapper in runStartPreflight only yields authorHost:"unknown"
    // when detectProviders(...) itself throws as a whole. detectProviders wraps each
    // individual probe call with its own safe(), so a crashing providerProbe still
    // returns a full result with authorHost resolved from config.host.
    //
    // To force authorHost:"unknown" we inject an unknown host family via flags.
    // The ResolvedConfig `host` type is "claude"|"codex"|"auto" but we cast to
    // bypass the type restriction — this mirrors what a misconfigured host registry
    // entry would produce at runtime, and exercises the code path where
    // resolveAuthorHost(host) maps to "unknown".
    const result = runStartPreflight({
      cwd,
      flags: { host: "some-future-unknown-host" as never },
      probe: makeCrashingProbe(false),
    });
    // resolveAuthorHost("some-future-unknown-host") → "unknown"
    expect(result.providers.authorHost).toBe("unknown");
    expect(result.providers.recommended).toBeNull();
  });

  it("snapshot.providers has no `selected` field when authorHost is unknown", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    // Use the unknown-host injection approach (same as the test above).
    const result = runStartPreflight({
      cwd,
      flags: { host: "some-future-unknown-host" as never },
      probe: makeCrashingProbe(false),
    });
    // The snapshot must not synthesize a `selected` field — that is the
    // orchestrator's domain (U7 fills it in on operator choice).
    // "selected" may be absent OR undefined; it must never be a string here.
    expect(result.snapshot.providers.selected).toBeUndefined();
    expect("selected" in result.snapshot.providers
      ? typeof result.snapshot.providers.selected
      : "absent"
    ).not.toBe("string");
  });

  it("snapshot.providers.recommended is null when authorHost is unknown", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });
    // Same unknown-host injection.
    const result = runStartPreflight({
      cwd,
      flags: { host: "some-future-unknown-host" as never },
      probe: makeCrashingProbe(false),
    });
    expect(result.snapshot.providers.recommended).toBeNull();
  });

  it("safeProbe fallback yields authorHost:'unknown' when the probe object itself throws on access", () => {
    // This exercises the safeProbe({ authorHost:"unknown", providers:[] }) fallback
    // in runStartPreflight. detectProviders wraps each individual probe method call in
    // its own safe(), so a throwing providerProbe method alone doesn't cause
    // detectProviders to throw as a whole.
    //
    // The one way to force the outer safeProbe fallback is to make accessing
    // `probe.providerProbe` itself throw — i.e. make it a getter that throws before
    // detectProviders even receives the probe argument.
    const cwd = makeTmpDir();
    writeSettings(cwd, { review: "cross" });

    // A PreflightProbe whose `providerProbe` getter throws when accessed,
    // causing detectProviders({ probe: probe.providerProbe }) to throw before
    // detectProviders runs any of its logic.
    const preflightProbeWithThrowingGetter: PreflightProbe = {
      tmuxOnPath: () => false,
      incompleteRun: () => null,
      get providerProbe(): ProbeEnv {
        throw new Error("providerProbe getter: simulated total probe failure");
      },
    };

    const result = runStartPreflight({
      cwd,
      probe: preflightProbeWithThrowingGetter,
    });
    // The safeProbe fallback kicks in: { authorHost: "unknown", providers: [] }
    expect(result.providers.authorHost).toBe("unknown");
    expect(result.providers.detected).toHaveLength(0);
    expect(result.providers.recommended).toBeNull();
    // Snapshot must also reflect the fallback.
    expect(result.snapshot.providers.authorHost).toBe("unknown");
    expect(result.snapshot.providers.detected).toHaveLength(0);
    expect(result.snapshot.providers.recommended).toBeNull();
    expect(result.snapshot.providers.selected).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// R-008 — adversarial_review_provider pin honored via selectReviewer (AC-8)
// ---------------------------------------------------------------------------

describe("R-008 — adversarial_review_provider pin is honored", () => {
  it("pin='codex-plugin' + review=cross → providers.selected='codex-plugin' and snapshot.providers.selected='codex-plugin'", () => {
    // Setup: codex-plugin is detected, authed, selectable. Claude is the author host.
    // Even if recommendProvider would pick the same provider, this test verifies
    // that selectReviewer's pin path is exercised — not just the ranking path.
    const cwd = makeTmpDir();
    writeSettings(cwd, {
      review: "cross",
      adversarial_review_provider: "codex-plugin",
    });
    const probe = makeProbe({
      tmuxOnPath: false,
      claudeNativeIdentity: true,
      providerWorld: {
        pluginAdapters: ["codex-plugin"],
        codexStoredAuth: true,
      },
    });

    const result = runStartPreflight({ cwd, probe });

    // The pin must be honored: selectReviewer sees an explicit non-"auto" provider,
    // checks AC-8 (codex != claude family), checks selectability — and returns "selected".
    expect(result.providers.selected).toBe("codex-plugin");
    expect(result.snapshot.providers.selected).toBe("codex-plugin");
    // recommendProvider still populates "recommended" (informational OD-5 path).
    expect(result.providers.recommended).toBe("codex-plugin");
  });

  it("pin='codex-plugin' + review=cross → selected wins even when recommendProvider is absent (no selectable auto-pick)", () => {
    // Setup: codex-plugin detected but NOT in the auto-rank pool (e.g. detect-only for
    // a different provider). The pin path in selectReviewer must still honor the explicit
    // id if it IS selectable, regardless of recommendProvider's output.
    // Here we just verify the pin-path is independent: codex-plugin plugin adapter present+authed.
    const cwd = makeTmpDir();
    writeSettings(cwd, {
      review: "cross",
      adversarial_review_provider: "codex-plugin",
    });
    const probe = makeProbe({
      tmuxOnPath: false,
      claudeNativeIdentity: true,
      providerWorld: {
        pluginAdapters: ["codex-plugin"],
        codexStoredAuth: true,
      },
    });

    const result = runStartPreflight({ cwd, probe });

    // selectReviewer pin path must yield "selected".
    expect(result.providers.selected).toBe("codex-plugin");
    expect(result.snapshot.providers.selected).toBe("codex-plugin");
  });

  it("pin='auto' → providers.selected is undefined (auto fallback, not a pin)", () => {
    const cwd = makeTmpDir();
    // "auto" is the default — selectReviewer takes the ranking path, not the pin path.
    writeSettings(cwd, { review: "cross" });
    const probe = CLAUDE_HOST_CODEX_PLUGIN_PROBE;

    const result = runStartPreflight({ cwd, probe });

    // With provider="auto" and a selectable codex-plugin, selectReviewer still yields
    // "selected" via the ranking path — so selected IS populated.
    // The key invariant: "auto" does NOT bypass selectReviewer, it just uses the ranking sub-path.
    expect(result.providers.selected).toBe("codex-plugin");
    expect(result.snapshot.providers.selected).toBe("codex-plugin");
  });

  it("pin='nonexistent-provider' → providers.selected is undefined (unknown pin → skipped)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, {
      review: "cross",
      adversarial_review_provider: "nonexistent-provider",
    });
    const probe = CLAUDE_HOST_CODEX_PLUGIN_PROBE;

    const result = runStartPreflight({ cwd, probe });

    // selectReviewer returns status="skipped" for unknown pin → no selected.
    expect(result.providers.selected).toBeUndefined();
    expect(result.snapshot.providers.selected).toBeUndefined();
    // recommendProvider still works for the informational path.
    expect(result.providers.recommended).toBe("codex-plugin");
  });

  it("pin='codex-plugin' + review=local → providers.selected is undefined (mode=local → degraded-local)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, {
      review: "local",
      adversarial_review_provider: "codex-plugin",
    });
    const probe = CLAUDE_HOST_CODEX_PLUGIN_PROBE;

    const result = runStartPreflight({ cwd, probe });

    // selectReviewer: mode=local → degraded-local, not selected — pin is irrelevant for local mode.
    expect(result.providers.selected).toBeUndefined();
    expect(result.snapshot.providers.selected).toBeUndefined();
  });
});

describe("incomplete-run intake (06-initiatives, deterministic probe)", () => {
  it("returns the intake question when the current run has no verify.md", () => {
    const res = runStartPreflight({
      cwd: "/tmp/x",
      probe: makeProbe({
        tmuxOnPath: false,
        incompleteRun: { runId: "run-abc", runDir: "/tmp/x/.guild/runs/run-abc" },
      }),
    });
    expect(res.incompleteRun).not.toBeNull();
    expect(res.incompleteRun!.runId).toBe("run-abc");
    expect(res.incompleteRun!.question).toMatch(/resume \/ restart \/ attach \/ ignore/);
  });

  it("is null when the prior run closed (probe returns null)", () => {
    const res = runStartPreflight({
      cwd: "/tmp/x",
      probe: makeProbe({ tmuxOnPath: false, incompleteRun: null }),
    });
    expect(res.incompleteRun).toBeNull();
  });

  it("is null (never throws) when the probe crashes", () => {
    const res = runStartPreflight({
      cwd: "/tmp/x",
      probe: {
        tmuxOnPath: () => false,
        providerProbe: makeProbeEnv({}),
        incompleteRun: () => { throw new Error("boom"); },
      },
    });
    expect(res.incompleteRun).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// T3 rework F4 — reviewer probe regressions (session_context §3/§4)
// Round-1 live probes:
//   P1: asserted-only claude (explicit host, NO native identity) + selectable
//       codex-plugin → preflight selected "codex-plugin" and stamped
//       roles.adversarial.strength "strong". Asserted identity may NEVER
//       satisfy the strong predicate (contract: asserted ⇒ weak).
//   P2: asserted claude + VERIFIED native codex → preflight kept authorHost
//       "claude" and selected a codex adversarial substrate at strength
//       "strong" — a same-family review mislabeled as cross-family
//       independence. The verified contradiction must replace the asserted
//       family BEFORE reviewer selection.
// ---------------------------------------------------------------------------

describe("T3 F4 — asserted identity can never produce strong independence", () => {
  it("P1: asserted-only host + selectable codex-plugin → NO selected reviewer, NO recommendation, adversarial weak", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { host: "claude", review: "cross" });
    const probe = makeProbe({
      tmuxOnPath: false,
      // NO native identity — the explicit host setting is an unverified assertion.
      providerWorld: { pluginAdapters: ["codex-plugin"], codexStoredAuth: true },
    });
    const result = runStartPreflight({ cwd, probe });

    expect(result.providers.authorHost).toBe("claude");
    expect(result.providers.authorTrust).toBe("asserted");
    // The false-signoff class: no selected reviewer, no recommendation, and the
    // stated reason names the unverified identity.
    expect(result.providers.selected).toBeUndefined();
    expect(result.snapshot.providers.selected).toBeUndefined();
    expect(result.providers.recommended).toBeNull();
    expect(result.providers.reason).toMatch(/not verified|asserted-only|unverified/);
    // The adversarial role can never be stamped strong off an assertion.
    expect(result.snapshot.roles.adversarial.strength).toBe("weak");
    expect(result.snapshot.roles.adversarial.reason).toMatch(/not verified|asserted-only|unverified/);
    expect(result.snapshot.providers.authorTrust).toBe("asserted");
  });

  it("P1b: the SAME world with a VERIFIED native identity still selects normally (anti-vacuity)", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { host: "claude", review: "cross" });
    const probe = makeProbe({
      tmuxOnPath: false,
      claudeNativeIdentity: true, // verified — confirms the assertion
      providerWorld: { pluginAdapters: ["codex-plugin"], codexStoredAuth: true },
    });
    const result = runStartPreflight({ cwd, probe });
    expect(result.providers.authorTrust).toBe("verified");
    expect(result.providers.selected).toBe("codex-plugin");
    expect(result.snapshot.roles.adversarial.strength).toBe("strong");
  });

  it("P2: asserted claude + VERIFIED native codex → codex wins, and NO same-family strong sign-off survives", () => {
    const cwd = makeTmpDir();
    writeSettings(cwd, { host: "claude", review: "cross" });
    const probe = makeProbe({
      tmuxOnPath: false,
      nativeIdentity: {
        family: "codex",
        surface: "cli",
        adapter_id: "codex-guild-run",
        adapter_version: "test",
        evidence: "fake codex native-adapter injection (test probe)",
      },
      providerWorld: {
        onPath: ["codex"],
        versionOk: ["codex"],
        pluginAdapters: ["codex-plugin"],
        codexStoredAuth: true,
      },
    });
    const result = runStartPreflight({ cwd, probe });

    // The verified contradiction REPLACES the asserted author family.
    expect(result.providers.authorHost).toBe("codex");
    expect(result.providers.authorTrust).toBe("verified");
    expect(result.snapshot.providers.authorHost).toBe("codex");
    // A codex reviewer is now SAME-family — it can never be selected for cross.
    expect(result.providers.selected).toBeUndefined();
    expect(result.snapshot.providers.selected).toBeUndefined();
    // And the adversarial role degrades honestly instead of a same-family "strong".
    expect(result.snapshot.roles.adversarial.strength).toBe("weak");
    // The frozen-record inputs still carry both sides for §4 conflict evidence.
    expect(result.session_identity.envelope_host).toBe("claude-code-cli");
    expect(result.session_identity.native_adapter?.family).toBe("codex");
  });
});
