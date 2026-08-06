/**
 * scripts/__tests__/codex-pretooluse-enforcement.test.ts
 *
 * ISSUE #94 — CODEX-SIDE PreToolUse DENY ENFORCEMENT + PROBE-GATED PANE BYPASS.
 *
 * THE DEFECT (inherited from rf-wi-04 / PR #88 as an explicit followup). PR #88
 * established — against an earlier, WRONG "infeasible" claim — that Codex-side
 * PreToolUse deny is feasible at the CLI level. But Guild wired none of it:
 * the generated codex hook bundle registered ONLY SessionStart (update-check)
 * and UserPromptSubmit (prompt bridge), and the Codex capability rows still
 * read `hooks.pre_tool_use: false` (INFERRED, "confirm on-box", never verified).
 * A codex pane therefore launches with NO tool-call enforcement, which is why
 * PR #88 correctly refused to extend a permission-bypass flag to codex panes:
 * a bypass there would have been a net safety REGRESSION.
 *
 * ON-BOX CONFIRMATION (this lane, codex-cli 0.146.0, isolated CODEX_HOME —
 * the real ~/.codex was never written):
 *
 *   E1  A PreToolUse hook emitting {"hookSpecificOutput":{"hookEventName":
 *       "PreToolUse","permissionDecision":"deny",...}} BLOCKS the tool call:
 *         hook: PreToolUse Blocked
 *         ERROR codex_core::tools::router: error=Command blocked by PreToolUse
 *         hook: <reason>. Command: echo GUILD_DENY_MARKER_HELLO
 *       and the model stops ("The tool call was blocked by a PreToolUse hook").
 *
 *   E2  CONTROL — identical config, marker absent: `hook: PreToolUse Completed`,
 *       the command EXECUTES. So the deny, not the sandbox, is causal.
 *
 *   E3  PRESENCE != ENFORCEMENT (the decisive finding). With the SAME hooks.json
 *       but the raw binary (no --dangerously-bypass-hook-trust), the hook NEVER
 *       RAN — zero stdin captures, no `hook:` lines, NO warning — and the command
 *       executed. Codex gates hooks behind persisted hook trust, and an untrusted
 *       hook file SILENTLY no-ops. A file-presence check is therefore NOT a proof
 *       of enforcement on codex; it is a false positive waiting to happen.
 *
 *   E4  The Codex PreToolUse payload is snake_case and Claude-shaped:
 *       {session_id, turn_id, transcript_path, cwd, hook_event_name:"PreToolUse",
 *        model, permission_mode, tool_name, tool_input:{command}, tool_use_id}
 *
 *   E5  Guild's REAL enforcement binary already speaks it. hooks/dist/pre-tool-use.js
 *       fed an E4-shaped event emits `ask` by default, but with a codex host
 *       manifest ({tool_support.pre_tool_use_ask:false}, which
 *       write-host-capability.ts:198 already writes for every non-Claude-CLI host)
 *       its HK-07 degradation emits exactly `permissionDecision:"deny"` AND writes
 *       guild.approval_request.v1 to agent-bus/approvals/.
 *
 * So the fix is a REUSE, not a rewrite: register the EXISTING, already-tested
 * enforcement binary on Codex's PreToolUse event, and gate the pane bypass on a
 * probe that proves ENFORCEMENT EXECUTES rather than that a file exists (E3).
 *
 * These tests are RED before the fix.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { buildHostPackages } from "../build-host-packages";
import { PLUGIN_ROOT, UNSTAMPED_GENERATED_AT } from "../build-inventory";
import { CODEX_CAPABILITIES } from "../lib/host-capabilities-schema";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry-schema";
import { composeTmuxCommands, resolveCodexTeamLaunchArgs } from "../lib/host/tmux-backend";
import {
  CodexPaneAdapter,
  probeCodexPreToolUseEnforcement,
  resolveAdapter,
} from "../lib/pane-adapter";
import type { PaneSpec } from "../lib/team-backend";

// ── shared fixtures ──────────────────────────────────────────────────────────

/** The E4 payload shape, captured verbatim from the live codex 0.146.0 run. */
const CODEX_PRETOOLUSE_EVENT = {
  session_id: "019fd513-f21e-73c2-99cb-c6db0b038ad8",
  turn_id: "019fd513-f268-7020-8ac4-c8a4897d29c9",
  transcript_path: "/tmp/rollout.jsonl",
  cwd: "/tmp/work",
  hook_event_name: "PreToolUse",
  model: "gpt-5.6-sol",
  permission_mode: "bypassPermissions",
  tool_name: "Bash",
  tool_input: { command: "echo GUILD_DENY_MARKER_HELLO" },
  tool_use_id: "exec-3daaf58a-1f84-4adf-8227-1bd5db23ec7d",
};

function paneSpec(over: Partial<PaneSpec> = {}): PaneSpec {
  return {
    name: "backend",
    scope: "lane",
    runId: "run-94",
    slug: "codex-deny",
    prompt: "do the thing",
    hostKind: "codex",
    specialist: "backend",
    // The third bypass gate: an unscoped pane has nothing to enforce, so it
    // never earns the flag. Every bypass fixture here is deliberately scoped.
    capability_scope: ["Read", "Edit"],
    ...over,
  } as PaneSpec;
}

/** A CODEX_HOME whose hooks.json registers PreToolUse -> Guild's bridge. */
function makeCodexHome(opts: {
  registerPreToolUse?: boolean;
  bridgePresent?: boolean;
  /** Make the bridge emit something OTHER than a deny (the E3 silent-no-op class). */
  bridgeDenies?: boolean;
}): { codexHome: string; bridgePath: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
  const {
    registerPreToolUse = true,
    bridgePresent = true,
    bridgeDenies = true,
  } = opts;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-"));
  const bridgePath = path.join(dir, "hooks", "dist", "pre-tool-use.js");
  fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
  if (bridgePresent) {
    // A stand-in for hooks/dist/pre-tool-use.js. The probe must EXECUTE it and
    // read its decision — never merely stat it (E3).
    fs.writeFileSync(
      bridgePath,
      bridgeDenies
        ? `let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{` +
            `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",` +
            `permissionDecision:"deny",permissionDecisionReason:"probe"}}))});`
        : // Silently allows — exactly what an untrusted/broken hook looks like.
          `let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.exit(0)});`,
    );
  }
  const manifest = registerPreToolUse
    ? {
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: `node "${bridgePath}"` }] }],
        },
      }
    : { hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node bridge.js" }] }] } };
  fs.writeFileSync(path.join(dir, "hooks.json"), JSON.stringify(manifest));
  return {
    codexHome: dir,
    bridgePath,
    // The ownership root is taken from the ENVIRONMENT, never learned from the
    // command being vetted — so every fixture declares one, and the stub bridge
    // lives under it.
    env: { CODEX_HOME: dir, GUILD_PLUGIN_ROOT: dir },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}


/**
 * A throwaway project root whose `bypass_permissions_policy` hard-blocks. The
 * probe judges the bypass leg against a REAL project's policy, and the default
 * (`audit`) records-and-allows — so a fixture that wants the grant must be a
 * project that actually denies.
 */
function makeDenyingProject(): { cwd: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-proj-"));
  fs.mkdirSync(path.join(dir, ".guild"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".guild", "settings.json"),
    JSON.stringify({ security: { bypass_permissions_policy: "deny" } }),
  );
  return { cwd: dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ── 1. capability rows ───────────────────────────────────────────────────────

describe("the Codex capability rows record the ON-BOX-CONFIRMED PreToolUse deny", () => {
  it("flips hooks.pre_tool_use to true (E1: the deny actually blocks the tool call)", () => {
    expect(CODEX_CAPABILITIES.hooks.pre_tool_use).toBe(true);
  });

  it("flips permissions.deny to true — a PreToolUse deny IS a deny primitive", () => {
    expect(CODEX_CAPABILITIES.permissions.deny).toBe(true);
  });

  it("HONESTY: `ask` stays unsupported — Codex has no PreToolUse ask primitive", () => {
    // The whole reason E5's degradation matters. Flipping this would silently
    // re-enable an `ask` that codex rejects.
    expect(CODEX_CAPABILITIES.permissions.ask_mode).toBeNull();
  });

  it("HONESTY: events NOT verified on-box stay false", () => {
    expect(CODEX_CAPABILITIES.hooks.subagent_stop).toBe(false);
    expect(CODEX_CAPABILITIES.hooks.task_created).toBe(false);
  });

  it("the codex-cli registry row inherits the flip (single source of truth)", () => {
    expect(HOST_REGISTRY_ROWS["codex-cli"].capabilities.hooks.pre_tool_use).toBe(true);
  });

  it("HONESTY: codex-app is NOT flipped — only the CLI was confirmed on-box", () => {
    expect(HOST_REGISTRY_ROWS["codex-app"].capabilities.hooks.pre_tool_use).toBe(false);
  });
});

// ── 2. the generated codex package wires the bridge ──────────────────────────

describe("the generated Codex package wires PreToolUse to Guild's enforcement binary", () => {
  let distRoot: string;
  let manifest: {
    hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>;
  };

  beforeAll(() => {
    distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-dist-"));
    buildHostPackages({
      root: PLUGIN_ROOT,
      distRoot,
      generatedAt: UNSTAMPED_GENERATED_AT,
      gates: false,
      syncClaudeInstall: false,
      checkClaudeInstall: false,
    });
    manifest = JSON.parse(
      fs.readFileSync(path.join(distRoot, "codex", "hooks", "codex-hooks.json"), "utf8"),
    );
  });

  afterAll(() => {
    fs.rmSync(distRoot, { recursive: true, force: true });
  });

  it("registers a PreToolUse hook (the event that was missing entirely)", () => {
    expect(Object.keys(manifest.hooks)).toContain("PreToolUse");
    expect(manifest.hooks["PreToolUse"]?.[0]?.hooks?.[0]?.type).toBe("command");
  });

  it("points PreToolUse at Guild's REAL enforcement binary (reuse, not a rewrite)", () => {
    const cmd = manifest.hooks["PreToolUse"]?.[0]?.hooks?.[0]?.command ?? "";
    expect(cmd).toContain("pre-tool-use.js");
  });

  it("SHIPS that binary — the issue-#55 defect class (signal without its binary)", () => {
    expect(fs.existsSync(path.join(distRoot, "codex", "hooks", "dist", "pre-tool-use.js"))).toBe(true);
  });

  it("does not disturb the SessionStart / UserPromptSubmit wiring PR #88 landed", () => {
    expect(manifest.hooks["SessionStart"]?.[0]?.hooks?.[0]?.command ?? "").toContain("update-check");
    expect(manifest.hooks["UserPromptSubmit"]?.[0]?.hooks?.[0]?.command ?? "").toContain(
      "codex-guild-prompt-bridge",
    );
  });
});

// ── 3. the probe proves ENFORCEMENT, not file presence (E3) ──────────────────

describe("probeCodexPreToolUseEnforcement proves the deny EXECUTES", () => {
  it("passes when the manifest registers PreToolUse AND the bridge really denies", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const r = probeCodexPreToolUseEnforcement({ env });
      expect(r.enforced).toBe(true);
      expect(r.checks.deny_functional).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("FAILS when no codex hooks manifest exists at all", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-empty-"));
    try {
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: dir, GUILD_PLUGIN_ROOT: dir },
      });
      expect(r.enforced).toBe(false);
      expect(r.checks.manifest_registers_pretooluse).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("FAILS when the manifest wires other events but not PreToolUse (the pre-fix state)", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ registerPreToolUse: false });
    try {
      const r = probeCodexPreToolUseEnforcement({ env });
      expect(r.enforced).toBe(false);
      expect(r.checks.manifest_registers_pretooluse).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("FAILS when the manifest registers a bridge that is not on disk", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ bridgePresent: false });
    try {
      const r = probeCodexPreToolUseEnforcement({ env });
      expect(r.enforced).toBe(false);
      expect(r.checks.bridge_present).toBe(false);
    } finally {
      cleanup();
    }
  });

  /** THE E3 REGRESSION TEST: registered + present, but silently allows. */
  it("FAILS when the registered bridge is present but does NOT deny (E3 silent no-op)", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ bridgeDenies: false });
    try {
      const r = probeCodexPreToolUseEnforcement({ env });
      expect(r.checks.manifest_registers_pretooluse).toBe(true);
      expect(r.checks.bridge_present).toBe(true);
      // ...and yet:
      expect(r.checks.deny_functional).toBe(false);
      expect(r.enforced).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ── 3b. the probe must pass against Guild's REAL bridge ──────────────────────

/**
 * THE PROBE'S OWN DEFECT CLASS — a gate that can never open is not a gate.
 *
 * The stubs in §3 deny unconditionally, so they prove the probe's plumbing but
 * NOT that the probe passes against the binary it actually ships. On-box the
 * real `hooks/dist/pre-tool-use.js` emits `deny` ONLY through the HK-07
 * degradation, and that leg needs THREE things the probe must supply itself:
 *   - a resolvable run id + run dir (`gate()` bails to plain `ask` without them),
 *   - a codex host-capability manifest carrying `pre_tool_use_ask:false`,
 *     discoverable from the payload `cwd` via resolveGuildRoot,
 *   - a capability scope the probed tool is outside of.
 * Verified on-box: omit the run id and the same binary answers `ask`, which the
 * probe reads as NOT-enforced — so a genuinely enforcing codex box would be
 * denied the flag forever. Fail-closed, but permanently closed.
 */
describe("the probe passes against Guild's REAL enforcement binary", () => {
  it("reports enforced when the manifest registers hooks/dist/pre-tool-use.js", () => {
    const realBridge = path.join(PLUGIN_ROOT, "hooks", "dist", "pre-tool-use.js");
    expect(fs.existsSync(realBridge)).toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-real-"));
    const project = makeDenyingProject();
    try {
      fs.writeFileSync(
        path.join(dir, "hooks.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${realBridge}"` }] }] },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: dir, GUILD_PLUGIN_ROOT: PLUGIN_ROOT },
        cwd: project.cwd,
      });
      expect(r.detail).toContain("PROVEN");
      expect(r.enforced).toBe(true);
      expect(r.checks.deny_under_bypass).toBe(true);
    } finally {
      project.cleanup();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves no probe sandbox behind (the probe cleans up after itself)", () => {
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("guild-codex-probe-"));
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      probeCodexPreToolUseEnforcement({ env });
      const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("guild-codex-probe-"));
      expect(after.length).toBe(before.length);
    } finally {
      cleanup();
    }
  });
});


// ── 3c. the probe binds to what Guild actually installs, and fails closed ────

describe("the probe binds to the INSTALLED Guild manifest", () => {
  /**
   * Guild's generated codex manifest does not hard-code a path: it emits
   * `node "${GUILD_PLUGIN_ROOT:-${PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}}/hooks/dist/..."`
   * and ships as `<plugin>/hooks/codex-hooks.json`, not `$CODEX_HOME/hooks.json`.
   * A probe that reads only CODEX_HOME and rejects any `${VAR}` rejects Guild's
   * own install — the gate would be permanently shut on a correct box.
   */
  it("accepts the generated package: plugin-root manifest + ${VAR} command", () => {
    const distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-pkg-"));
    try {
      buildHostPackages({
        root: PLUGIN_ROOT,
        distRoot,
        generatedAt: UNSTAMPED_GENERATED_AT,
        gates: false,
        syncClaudeInstall: false,
        checkClaudeInstall: false,
      });
      const codexRoot = path.join(distRoot, "codex");
      const project = makeDenyingProject();
      const r = probeCodexPreToolUseEnforcement({
        env: {
          // No CODEX_HOME manifest at all — only the packaged one.
          CODEX_HOME: path.join(distRoot, "no-such-codex-home"),
          GUILD_PLUGIN_ROOT: codexRoot,
        },
        cwd: project.cwd,
      });
      project.cleanup();
      expect(r.manifest).toBe(path.join(codexRoot, "hooks", "codex-hooks.json"));
      expect(r.enforced).toBe(true);
    } finally {
      fs.rmSync(distRoot, { recursive: true, force: true });
    }
  });

  /** A `${VAR}` nobody exported must read as "cannot prove", not "assume fine". */
  it("FAILS when the registered command's ${VAR} cannot be resolved", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-unres-"));
    try {
      fs.writeFileSync(
        path.join(dir, "hooks.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { hooks: [{ type: "command", command: 'node "${NO_SUCH_ROOT_VAR}/hooks/x.js"' }] },
            ],
          },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: dir, GUILD_PLUGIN_ROOT: dir },
      });
      expect(r.enforced).toBe(false);
      expect(r.checks.bridge_present).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the probe is genuinely fail-closed", () => {
  /** A nonzero exit is a broken gate, whatever it printed on the way out. */
  it("FAILS when the bridge prints a deny but exits nonzero", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const r = probeCodexPreToolUseEnforcement({
        env,
        run: () => ({
          status: 17,
          stdout: JSON.stringify({
            hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
          }),
          stderr: "",
        }),
      });
      expect(r.enforced).toBe(false);
    } finally {
      cleanup();
    }
  });

  /** A log line that merely MENTIONS a deny is not a decision. */
  it("FAILS on chatter containing the deny substring but no parseable response", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const r = probeCodexPreToolUseEnforcement({
        env,
        run: () => ({
          status: 0,
          stdout: 'log: last run emitted "permissionDecision":"deny" for Bash\n',
          stderr: "",
        }),
        });
      expect(r.enforced).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('FAILS when the response is a well-formed "ask" (codex cannot honour it)', () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const r = probeCodexPreToolUseEnforcement({
        env,
        run: () => ({
          status: 0,
          stdout: JSON.stringify({
            hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask" },
          }),
          stderr: "",
        }),
      });
      expect(r.enforced).toBe(false);
    } finally {
      cleanup();
    }
  });

  /**
   * The hook-trust flag runs EVERY enabled hook in that CODEX_HOME untrusted,
   * not only Guild's. Proving Guild's bridge denies says nothing about a
   * third party's hook sharing the manifest, so a foreign entry withholds the
   * whole grant rather than silently auto-trusting someone else's code.
   */
  it("FAILS when the manifest also registers a non-Guild hook (sole-owner gate)", () => {
    const { codexHome, bridgePath, env, cleanup } = makeCodexHome({});
    try {
      const manifestPath = path.join(codexHome, "hooks.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      manifest.hooks["SessionStart"] = [
        { hooks: [{ type: "command", command: 'node "/opt/someone-else/hook.js"' }] },
      ];
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const r = probeCodexPreToolUseEnforcement({ env });
      expect(r.checks.bridge_present).toBe(true);
      expect(r.checks.sole_owner).toBe(false);
      expect(r.enforced).toBe(false);
      expect(r.detail).toContain("/opt/someone-else/hook.js");
      expect(bridgePath).toContain("pre-tool-use.js");
    } finally {
      cleanup();
    }
  });
});


// ── 3d. round-2 hardening: the gate cannot be talked into opening ────────────

describe("the bypass leg is judged against the project's REAL policy", () => {
  /**
   * The granted flag puts the pane in `permission_mode:"bypassPermissions"`
   * (captured verbatim on-box), and Guild routes that through
   * `bypass_permissions_policy`, whose default `audit` RECORDS an out-of-scope
   * call and allows it. Proving a deny in the ordinary mode would have granted
   * the flag to a pane that enforces nothing.
   */
  it("FAILS against a default-policy project (audit records and allows)", () => {
    const realBridge = path.join(PLUGIN_ROOT, "hooks", "dist", "pre-tool-use.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-audit-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-auditproj-"));
    try {
      fs.writeFileSync(
        path.join(dir, "hooks.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${realBridge}"` }] }] },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: dir, GUILD_PLUGIN_ROOT: PLUGIN_ROOT },
        cwd: project,
      });
      // The bridge itself is fine — it is the bypass posture that is not.
      expect(r.checks.deny_functional).toBe(true);
      expect(r.checks.deny_under_bypass).toBe(false);
      expect(r.enforced).toBe(false);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ownership is proven independently of the command being vetted", () => {
  /** No env-declared plugin root ⇒ nothing to check ownership against. */
  it("FAILS when no Guild plugin root is resolvable from the environment", () => {
    const { codexHome, cleanup } = makeCodexHome({});
    try {
      const r = probeCodexPreToolUseEnforcement({ env: { CODEX_HOME: codexHome } });
      expect(r.enforced).toBe(false);
      expect(r.detail).toContain("plugin root");
    } finally {
      cleanup();
    }
  });

  /**
   * The root must NOT be derived by walking parents up from the registered
   * script: a hook at `/tmp/x.js` would yield `/`, under which every path on the
   * box counts as Guild's — and the grant carries the hook-trust flag.
   */
  it("FAILS when the registered bridge sits outside the declared plugin root", () => {
    const { codexHome, cleanup } = makeCodexHome({});
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-outside-"));
    try {
      const stray = path.join(elsewhere, "deny.js");
      fs.writeFileSync(stray, "process.stdout.write('{}')");
      fs.writeFileSync(
        path.join(codexHome, "hooks.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${stray}"` }] }] },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: codexHome, GUILD_PLUGIN_ROOT: codexHome },
      });
      expect(r.checks.bridge_present).toBe(false);
      expect(r.enforced).toBe(false);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
      cleanup();
    }
  });

  /**
   * Codex loads EVERY manifest, so a foreign hook in the one that happens not to
   * register PreToolUse is still a hook the trust flag would run untrusted.
   */
  it("FAILS on a foreign hook in the OTHER manifest codex also loads", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ registerPreToolUse: false });
    const pkg = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex94-pkg2-"));
    try {
      // CODEX_HOME's manifest registers someone else's SessionStart hook...
      fs.writeFileSync(
        path.join(codexHome, "hooks.json"),
        JSON.stringify({
          hooks: {
            SessionStart: [{ hooks: [{ type: "command", command: 'node "/opt/foreign-hook.js"' }] }],
          },
        }),
      );
      // ...while the packaged manifest carries a perfectly good Guild bridge.
      const bridge = path.join(pkg, "hooks", "dist", "pre-tool-use.js");
      fs.mkdirSync(path.dirname(bridge), { recursive: true });
      fs.writeFileSync(
        bridge,
        `let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{` +
          `process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",` +
          `permissionDecision:"deny"}}))});`,
      );
      fs.writeFileSync(
        path.join(pkg, "hooks", "codex-hooks.json"),
        JSON.stringify({
          hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${bridge}"` }] }] },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: { CODEX_HOME: codexHome, GUILD_PLUGIN_ROOT: pkg },
      });
      expect(r.checks.bridge_present).toBe(true);
      expect(r.checks.sole_owner).toBe(false);
      expect(r.enforced).toBe(false);
      expect(r.detail).toContain("/opt/foreign-hook.js");
      expect(env["CODEX_HOME"]).toBe(codexHome);
    } finally {
      fs.rmSync(pkg, { recursive: true, force: true });
      cleanup();
    }
  });

  /**
   * Expanding variables into the command BEFORE parsing quotes lets a quote
   * character carried in an env VALUE be read as shell syntax — so the probe
   * could resolve and run a path the shell would never execute.
   */
  it("FAILS when an env value smuggles quote characters into the path", () => {
    const { codexHome, cleanup } = makeCodexHome({});
    try {
      fs.writeFileSync(
        path.join(codexHome, "hooks.json"),
        JSON.stringify({
          hooks: {
            PreToolUse: [
              { hooks: [{ type: "command", command: 'node "${SNEAKY_ROOT}/hooks/dist/x.js"' }] },
            ],
          },
        }),
      );
      const r = probeCodexPreToolUseEnforcement({
        env: {
          CODEX_HOME: codexHome,
          GUILD_PLUGIN_ROOT: codexHome,
          SNEAKY_ROOT: `${codexHome}" "`,
        },
      });
      expect(r.enforced).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ── 4. the pane bypass flag is gated on the probe ────────────────────────────

const BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";
const HOOK_TRUST_FLAG = "--dangerously-bypass-hook-trust";

describe("the codex pane permission-bypass flag is gated on a PASSING probe", () => {
  it("DEFAULT is bare — no bypass flag even on a fully enforcing host", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const cmd = new CodexPaneAdapter({ env }).command(paneSpec());
      expect(cmd).not.toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });

  it("opted in + probe PASSES => the flag is applied", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec());
      expect(cmd).toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });

  it("opted in + probe FAILS => the flag is WITHHELD (pane launches bare)", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ registerPreToolUse: false });
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec());
      expect(cmd).not.toContain(BYPASS_FLAG);
      // Still a working pane — withholding only ever launches bare.
      expect(cmd).toContain("codex exec");
    } finally {
      cleanup();
    }
  });

  /**
   * E3 CLOSED, NOT MERELY DOCUMENTED. The probe can prove the bridge enforces;
   * it CANNOT prove codex will run it, because hook trust is granted through an
   * interactive prompt and is persisted nowhere the CLI exposes (`codex doctor
   * --json` on 0.146.0 reports install/config/auth health and no hook trust;
   * no trust store is discoverable on disk). Verified on-box: same hooks.json,
   * untrusted, `codex exec` ran the command and the hook never fired — silently.
   *
   * So granting the sandbox bypass ALONE would reintroduce the exact regression
   * #94 exists to prevent: a bypassed pane whose enforcement silently no-ops.
   * The two flags are therefore coupled — the bypass is only ever handed to a
   * pane whose Guild hook is guaranteed to run.
   */
  it("couples the bypass with --dangerously-bypass-hook-trust (E3 is otherwise open)", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec());
      expect(cmd).toContain(HOOK_TRUST_FLAG);
    } finally {
      cleanup();
    }
  });

  it("does NOT emit the hook-trust flag when the bypass is withheld", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ registerPreToolUse: false });
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec());
      expect(cmd).not.toContain(HOOK_TRUST_FLAG);
    } finally {
      cleanup();
    }
  });

  it("opted in + bridge present but NOT denying (E3) => the flag is WITHHELD", () => {
    const { codexHome, env, cleanup } = makeCodexHome({ bridgeDenies: false });
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec());
      expect(cmd).not.toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });
});

// ── 5. the pane the flag is granted to can actually enforce ──────────────────

describe("a bypassed codex pane is one that can actually enforce", () => {
  /**
   * The bridge resolves its host from the environment. A codex pane that
   * exported nothing read as Claude, chose `ask`, and codex — which has no ask
   * primitive — enforced NOTHING. Codex's SessionStart wiring runs update-check,
   * not the bootstrap that writes the capability manifest, so the identity has
   * to come from the pane.
   */
  it("exports the codex host identity so the gate resolves the codex row", () => {
    const cmd = new CodexPaneAdapter({ env: {} }).command(paneSpec());
    expect(cmd).toContain("GUILD_HOST_ID=codex-cli");
  });

  it("env() agrees with command() on that identity", () => {
    const e = new CodexPaneAdapter({ env: {} }).env(paneSpec());
    expect(e["GUILD_HOST_ID"]).toBe("codex-cli");
  });

  /** An unscoped pane has no allow-set, so the bridge denies nothing. */
  it("WITHHOLDS the bypass from an unscoped pane even when the probe passes", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec({ capability_scope: undefined }));
      expect(cmd).not.toContain(BYPASS_FLAG);
      expect(cmd).not.toContain(HOOK_TRUST_FLAG);
    } finally {
      cleanup();
    }
  });

  it("WITHHOLDS it from an empty-scope pane too (empty allow-set is not a gate)", () => {
    const { codexHome, env, cleanup } = makeCodexHome({});
    try {
      const cmd = new CodexPaneAdapter({
        env,
        codexLaunchArgs: [BYPASS_FLAG],
      }).command(paneSpec({ capability_scope: [] }));
      expect(cmd).not.toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });
});

// ── 6. the gate is reachable from production, not only from tests ────────────

describe("the codex bypass argv reaches a pane through the real compose path", () => {
  const specialist = (over: Record<string, unknown> = {}) => ({
    name: "backend",
    host_kind: "codex",
    capability_scope: ["Read", "Edit"],
    ...over,
  });

  const compose = (codexHome: string, over: Record<string, unknown> = {}) =>
    composeTmuxCommands({
      mode: "new-session",
      targetName: "guild-94",
      cwd: PLUGIN_ROOT,
      slug: "codex-deny",
      runId: "run-94",
      specialists: [specialist()] as never,
      resolveAdapter: resolveAdapter({ env: { CODEX_HOME: codexHome, GUILD_PLUGIN_ROOT: codexHome } }),
      orchestratorHostKind: "codex",
      ...over,
    } as never)
      .map((c) => c.argv.join(" "))
      .join("\n");

  it("resolveCodexTeamLaunchArgs yields the codex bypass flag for a team pane", () => {
    expect(resolveCodexTeamLaunchArgs()).toContain(BYPASS_FLAG);
  });

  /**
   * The resolver is built once, before the project's permission config is in
   * hand. Baking the DEFAULT argv in there and calling it "the resolved ladder"
   * would be false — an explicit read_only/accept_edits host_mode yields no
   * codex bypass at all. So the argv is applied at compose time, where the
   * config actually is.
   */
  it("applies the bypass through composeTmuxCommands (probe passing)", () => {
    const { codexHome, cleanup } = makeCodexHome({});
    try {
      expect(compose(codexHome)).toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });

  it("...and the same path launches bare when the probe fails", () => {
    const { codexHome, cleanup } = makeCodexHome({ registerPreToolUse: false });
    try {
      expect(compose(codexHome)).not.toContain(BYPASS_FLAG);
    } finally {
      cleanup();
    }
  });

  /** An operator who configured a stricter host_mode gets no bypass at all. */
  it("honours a configured host_mode: read_only yields no bypass flag", () => {
    const { codexHome, cleanup } = makeCodexHome({});
    try {
      const out = compose(codexHome, {
        permissionConfig: { host_mode: "read_only" },
      });
      expect(out).not.toContain(BYPASS_FLAG);
      expect(out).toContain("codex exec");
    } finally {
      cleanup();
    }
  });
});

// ── 7. the codex identity export must not leak to other hosts ────────────────

describe("only the codex adapter claims the codex host identity", () => {
  /**
   * The identity export was briefly copied into every other adapter, which both
   * corrupts attribution and would have applied codex's ask-less degradation to
   * unrelated hosts. Their env() must stay codex-free.
   */
  it.each(["claude", "pi", "antigravity-2", "cursor", "opencode"] as const)("%s panes do not export codex identity", (kind) => {
    const resolver = resolveAdapter({ env: {} });
    const e = resolver(kind as never).env(paneSpec({ hostKind: kind as never }));
    expect(e["GUILD_HOST_ID"]).toBeUndefined();
    expect(resolver(kind as never).command(paneSpec({ hostKind: kind as never }))).not.toContain(
      "GUILD_HOST_ID=codex-cli",
    );
  });
});
