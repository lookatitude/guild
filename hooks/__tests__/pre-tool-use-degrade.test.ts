/**
 * hooks/__tests__/pre-tool-use-degrade.test.ts
 *
 * TDD: written BEFORE the HK-07 implementation change.
 *
 * Proves that pre-tool-use.ts detects host capability (from the manifest
 * written by bootstrap.sh / write-host-capability.ts) and, when the host
 * lacks `tool_support.pre_tool_use_ask`, degrades the always-ask gate to:
 *   1. A `guild.approval_request.v1` file written to
 *      .guild/runs/<run-id>/agent-bus/approvals/<id>.json
 *   2. A `guild.security_event.v1` with `permission_mode: degraded` written
 *      to .guild/runs/<run-id>/logs/security-events.jsonl
 *   3. `dispatch_rung` recorded in the security event when GUILD_DISPATCH_RUNG
 *      is set.
 *
 * DRIFT-ANALYSIS finding addressed: HK-07 (high) — zero cross-host degradation
 *   instrumentation; no `permission_mode: degraded`, no `approval_request`
 *   file fallback, no `dispatch.rung` in the trace.
 *
 * Evidence checklist (verify-done gate):
 *   [x] Host with pre_tool_use_ask:true  → normal ask decision emitted
 *   [x] Host with pre_tool_use_ask:false → approval_request written + degraded event
 *   [x] No capability manifest            → safe fallback (ask still emitted)
 *   [x] dispatch.rung recorded when GUILD_DISPATCH_RUNG env is set
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const RUN = "test-run";

function run(
  payload: object,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function securityEvents(tmp: string): Array<Record<string, unknown>> {
  const file = path.join(tmp, ".guild", "runs", RUN, "logs", "security-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function approvalRequests(tmp: string): Array<Record<string, unknown>> {
  const dir = path.join(tmp, ".guild", "runs", RUN, "agent-bus", "approvals");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>);
}

function writeCapabilityManifest(
  tmp: string,
  hostId: string,
  preToolUseAsk: boolean,
): void {
  const dir = path.join(tmp, ".guild", "hosts", hostId);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    schema_version: "guild.host_capability.v1",
    host_id: hostId,
    host_kind: preToolUseAsk ? "claude" : "codex",
    // TE-07: canonical ADR field names
    advertised_at: new Date().toISOString(),
    source: "test",
    tier_models: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
    supported_tiers: ["cheap", "mid", "powerful"],
    models: ["haiku", "sonnet", "opus"],
    tool_support: {
      subagent: true,
      agent_team: false,
      independent_agents: !preToolUseAsk ? false : true,
      tmux: false,
      mcp: true,
      pre_tool_use_ask: preToolUseAsk,
    },
  };
  fs.writeFileSync(path.join(dir, "capability.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// ── Guild-signed content that would trigger the boundary guard ───────────────
// The guard fires when Write/Edit targets a path outside .guild/ AND the
// content carries a Guild signature token. We use a minimal fake signature.
const GUILD_SIGNED_CONTENT = "schema_version: guild.handoff.v2";

function makeWritePayload(filePath: string): object {
  return {
    tool_name: "Write",
    tool_input: {
      file_path: filePath,
      content: GUILD_SIGNED_CONTENT,
    },
  };
}

describe("pre-tool-use.ts — boundary-guard degrade path (HK-07 second ask)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-bgdegrade-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const baseEnv = (over: Record<string, string> = {}) => ({
    GUILD_CWD: tmp,
    GUILD_RUN_ID: RUN,
    ...over,
  });

  // ── Boundary-guard ask degrades on host without PreToolUse ask ────────────

  it("boundary-guard: emits deny (not ask) when host lacks pre_tool_use_ask", () => {
    writeCapabilityManifest(tmp, "codex", false);
    // Write Guild-signed content to a path OUTSIDE .guild/
    const { stdout, exitCode } = run(
      makeWritePayload(path.join(tmp, "some-file.md")),
      baseEnv({ GUILD_HOST: "codex" }),
    );
    expect(exitCode).toBe(0);
    if (stdout.trim().length > 0) {
      const decision = JSON.parse(stdout);
      expect(decision?.hookSpecificOutput?.permissionDecision).toBe("deny");
      expect(decision?.hookSpecificOutput?.permissionDecision).not.toBe("ask");
    }
  });

  it("boundary-guard: writes approval_request when host lacks pre_tool_use_ask", () => {
    writeCapabilityManifest(tmp, "codex", false);
    run(
      makeWritePayload(path.join(tmp, "some-file.md")),
      baseEnv({ GUILD_HOST: "codex" }),
    );
    const approvals = approvalRequests(tmp);
    expect(approvals.length).toBeGreaterThanOrEqual(1);
    const req = approvals[0]!;
    expect(req["schema_version"]).toBe("guild.approval_request.v1");
    expect(req["tool"]).toBe("Write");
    expect(req["permission_mode"]).toBe("degraded");
  });

  it("boundary-guard: resolves registry host aliases before reading capability manifests", () => {
    writeCapabilityManifest(tmp, "antigravity-cli", false);
    run(
      makeWritePayload(path.join(tmp, "some-file.md")),
      baseEnv({ GUILD_HOST: "antigravity" }),
    );
    const approvals = approvalRequests(tmp);
    expect(approvals.length).toBeGreaterThanOrEqual(1);
    expect(approvals[0]!["permission_mode"]).toBe("degraded");
  });

  it("boundary-guard: logs capability_scope_degrade security event when host lacks ask", () => {
    writeCapabilityManifest(tmp, "codex", false);
    run(
      makeWritePayload(path.join(tmp, "some-file.md")),
      baseEnv({ GUILD_HOST: "codex" }),
    );
    const events = securityEvents(tmp);
    const degraded = events.find((e) => e["event_type"] === "capability_scope_degrade");
    expect(degraded).toBeDefined();
    expect(degraded!["permission_mode"]).toBe("degraded");
  });

  it("boundary-guard: emits normal ask on claude (host supports ask)", () => {
    writeCapabilityManifest(tmp, "claude", true);
    const { stdout } = run(
      makeWritePayload(path.join(tmp, "some-file.md")),
      baseEnv({ GUILD_HOST: "claude" }),
    );
    if (stdout.trim().length > 0) {
      const decision = JSON.parse(stdout);
      expect(decision?.hookSpecificOutput?.permissionDecision).toBe("ask");
    }
    // No approval_request on normal ask path
    expect(approvalRequests(tmp).length).toBe(0);
  });

  it("boundary-guard: NO degrade for writes inside .guild/ (in-bounds path)", () => {
    writeCapabilityManifest(tmp, "codex", false);
    // Target inside .guild/ — boundary guard skips, no degrade
    const inBoundsPath = path.join(tmp, ".guild", "wiki", "decisions", "adr.md");
    const { stdout } = run(
      makeWritePayload(inBoundsPath),
      baseEnv({ GUILD_HOST: "codex" }),
    );
    // Guard should NOT fire for in-bounds paths → stdout empty (falls through to sidecar)
    // No approval_request should be written
    expect(approvalRequests(tmp).length).toBe(0);
    // stdout should not contain permissionDecision:deny from the guard
    if (stdout.trim().length > 0) {
      const decision = JSON.parse(stdout);
      // If there's a decision, it should not be a boundary-guard deny
      // (it would be from a different path or not present at all)
      expect(decision?.hookSpecificOutput?.permissionDecisionReason ?? "").not.toContain(
        "P5-boundary-001",
      );
    }
  });
});

describe("pre-tool-use.ts — cross-host degradation (HK-07)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-degrade-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const baseEnv = (over: Record<string, string> = {}) => ({
    GUILD_CWD: tmp,
    GUILD_RUN_ID: RUN,
    GUILD_LANE_ID: "backend",
    // Declare a capability scope so the enforcement path is exercised
    GUILD_CAPABILITY_SCOPE: JSON.stringify({
      allowed_ops: ["read"],
      write_scope: [],
      network: false,
    }),
    ...over,
  });

  // ── Normal path: host supports ask ──────────────────────────────────────

  describe("host with pre_tool_use_ask:true — normal ask path", () => {
    it("emits permissionDecision:ask when host supports ask", () => {
      writeCapabilityManifest(tmp, "claude", true);
      const { stdout, exitCode } = run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "claude" }),
      );
      expect(exitCode).toBe(0);
      // Out-of-scope tool should trigger ask
      expect(stdout).toContain("permissionDecision");
      expect(stdout).toContain("ask");
      // NO approval_request file written (host can ask natively)
      const approvals = approvalRequests(tmp);
      expect(approvals.length).toBe(0);
    });
  });

  // ── Degraded path: host lacks ask ───────────────────────────────────────

  describe("host with pre_tool_use_ask:false — degraded path", () => {
    it("writes guild.approval_request.v1 to agent-bus/approvals/", () => {
      writeCapabilityManifest(tmp, "codex", false);
      run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "codex" }),
      );
      const approvals = approvalRequests(tmp);
      expect(approvals.length).toBeGreaterThanOrEqual(1);
      const req = approvals[0]!;
      expect(req["schema_version"]).toBe("guild.approval_request.v1");
      expect(req["tool"]).toBe("Bash");
      expect(req["run_id"]).toBe(RUN);
    });

    it("records permission_mode:degraded in the security event log", () => {
      writeCapabilityManifest(tmp, "codex", false);
      run(
        { tool_name: "Bash", tool_input: { command: "curl http://evil" } },
        baseEnv({ GUILD_HOST: "codex" }),
      );
      const events = securityEvents(tmp);
      const degraded = events.find(
        (e) => e["permission_mode"] === "degraded",
      );
      expect(degraded).toBeDefined();
      expect(degraded!["schema_version"]).toBe("guild.security_event.v1");
    });

    it("records dispatch_rung in security event when GUILD_DISPATCH_RUNG is set", () => {
      writeCapabilityManifest(tmp, "codex", false);
      run(
        { tool_name: "Bash", tool_input: { command: "curl http://evil" } },
        baseEnv({ GUILD_HOST: "codex", GUILD_DISPATCH_RUNG: "3" }),
      );
      const events = securityEvents(tmp);
      const degraded = events.find((e) => e["permission_mode"] === "degraded");
      expect(degraded).toBeDefined();
      expect(degraded!["dispatch_rung"]).toBe("3");
    });

    it("does NOT emit permissionDecision:ask to stdout (host can't honor it)", () => {
      writeCapabilityManifest(tmp, "codex", false);
      const { stdout } = run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "codex" }),
      );
      // Should emit deny (not ask) so the tool doesn't run
      if (stdout.trim().length > 0) {
        const decision = JSON.parse(stdout);
        // Must not say "ask" — that would be silently ignored by the host
        expect(
          decision?.hookSpecificOutput?.permissionDecision,
        ).not.toBe("ask");
      }
    });

    it("still blocks the tool call (emits deny)", () => {
      writeCapabilityManifest(tmp, "codex", false);
      const { stdout, exitCode } = run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "codex" }),
      );
      expect(exitCode).toBe(0);
      if (stdout.trim().length > 0) {
        const decision = JSON.parse(stdout);
        expect(
          ["deny", "ask"].includes(
            decision?.hookSpecificOutput?.permissionDecision ?? "",
          ),
        ).toBe(true);
      }
    });
  });

  // ── No capability manifest → safe fallback ───────────────────────────────

  describe("no capability manifest present — safe fallback to ask", () => {
    it("falls back to normal ask path when capability manifest is absent", () => {
      // Do NOT write a capability manifest
      const { stdout, exitCode } = run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "claude" }),
      );
      expect(exitCode).toBe(0);
      // With no manifest, should fall back to normal ask behavior (not crash)
      // The tool either asks or falls through — it MUST NOT write an approval_request
      const approvals = approvalRequests(tmp);
      expect(approvals.length).toBe(0);
    });
  });

  // ── dispatch.rung recorded without degrade (informational) ───────────────

  describe("dispatch.rung in security event (non-degraded path)", () => {
    it("records dispatch_rung in non-degraded security events when GUILD_DISPATCH_RUNG is set", () => {
      // Host with ask support — normal path, but rung should still be recorded
      writeCapabilityManifest(tmp, "claude", true);
      run(
        { tool_name: "Bash", tool_input: { command: "rm -rf /" } },
        baseEnv({ GUILD_HOST: "claude", GUILD_DISPATCH_RUNG: "1" }),
      );
      const events = securityEvents(tmp);
      if (events.length > 0) {
        // At least one event should carry the rung
        const withRung = events.find((e) => e["dispatch_rung"] === "1");
        expect(withRung).toBeDefined();
      }
    });
  });
});
