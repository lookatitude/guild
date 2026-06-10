/**
 * hooks/__tests__/security-events.test.ts
 *
 * Unit tests for the guild.security_event.v1 emitter (hooks/lib/security/events.ts).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendSecurityEvent,
  buildSecurityEvent,
  emitRecallQuarantine,
  KNOWN_GUILD_HOST_KINDS,
  resolveHostResolution,
  resolveRunDir,
  SECURITY_EVENT_SCHEMA_VERSION,
} from "../lib/security/events";

describe("buildSecurityEvent", () => {
  it("stamps schema_version + ISO ts and carries core fields", () => {
    const ev = buildSecurityEvent({
      run_id: "run-1",
      event_type: "capability_scope_violation",
      decision: "ask",
      tool: "Bash",
      detail: "out of scope",
    });
    expect(ev.schema_version).toBe(SECURITY_EVENT_SCHEMA_VERSION);
    expect(ev.schema_version).toBe("guild.security_event.v1");
    expect(ev.run_id).toBe("run-1");
    expect(ev.event_type).toBe("capability_scope_violation");
    expect(ev.decision).toBe("ask");
    expect(ev.tool).toBe("Bash");
    expect(() => new Date(ev.ts).toISOString()).not.toThrow();
  });

  it("redacts secrets in the detail field", () => {
    const ev = buildSecurityEvent({
      run_id: "run-1",
      event_type: "secret_scrub_failure",
      decision: "allow",
      tool: "",
      detail: "leaked token=sk-ant-abcdefghijklmnopqrstuvwxyz0123",
    });
    expect(ev.detail).not.toContain("sk-ant-abcdefghijklmnopqrstuvwxyz0123");
    expect(ev.detail).toContain("[REDACTED]");
  });

  it("omits optional fields when not provided", () => {
    const ev = buildSecurityEvent({
      run_id: "run-1",
      event_type: "bypass_permission_allowed",
      decision: "allow",
      tool: "Write",
    });
    expect(ev.lane_id).toBeUndefined();
    expect(ev.policy).toBeUndefined();
    expect(ev.permission_mode).toBeUndefined();
    expect(ev.detail).toBe("");
  });

  it("includes optional lane_id / policy / permission_mode", () => {
    const ev = buildSecurityEvent({
      run_id: "run-1",
      lane_id: "backend",
      event_type: "capability_scope_violation",
      decision: "deny",
      tool: "Bash",
      detail: "blocked",
      policy: "deny",
      permission_mode: "bypassPermissions",
    });
    expect(ev.lane_id).toBe("backend");
    expect(ev.policy).toBe("deny");
    expect(ev.permission_mode).toBe("bypassPermissions");
  });

  // ── HK-05 (D-AUDIT): host attribution ─────────────────────────────────────

  describe("HK-05: host field is auto-stamped on every security event", () => {
    const ORIG_HOST_ID = process.env["GUILD_HOST_ID"];
    const ORIG_HOST    = process.env["GUILD_HOST"];

    afterEach(() => {
      // Restore env so other tests are not affected
      if (ORIG_HOST_ID === undefined) {
        delete process.env["GUILD_HOST_ID"];
      } else {
        process.env["GUILD_HOST_ID"] = ORIG_HOST_ID;
      }
      if (ORIG_HOST === undefined) {
        delete process.env["GUILD_HOST"];
      } else {
        process.env["GUILD_HOST"] = ORIG_HOST;
      }
    });

    it("defaults host to 'claude' when no env vars set", () => {
      delete process.env["GUILD_HOST_ID"];
      delete process.env["GUILD_HOST"];
      const ev = buildSecurityEvent({
        run_id: "run-1",
        event_type: "capability_scope_violation",
        decision: "ask",
        tool: "Bash",
      });
      expect(ev.host).toBe("claude");
    });

    it("uses GUILD_HOST_ID when set", () => {
      process.env["GUILD_HOST_ID"] = "codex-host-42";
      delete process.env["GUILD_HOST"];
      const ev = buildSecurityEvent({
        run_id: "run-1",
        event_type: "secret_scrub_blocked",
        decision: "blocked",
        tool: "Write",
      });
      expect(ev.host).toBe("codex-host-42");
    });

    it("resolves GUILD_HOST=codex → host 'codex' when no GUILD_HOST_ID", () => {
      delete process.env["GUILD_HOST_ID"];
      process.env["GUILD_HOST"] = "codex";
      const ev = buildSecurityEvent({
        run_id: "run-1",
        event_type: "injection_attempt_detected",
        decision: "deny",
        tool: "",
      });
      expect(ev.host).toBe("codex");
    });

    it("host is present on the on-disk JSON record", () => {
      process.env["GUILD_HOST_ID"] = "test-host-99";
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-secev-host-"));
      try {
        const ev = buildSecurityEvent({
          run_id: "r",
          event_type: "capability_scope_violation",
          decision: "ask",
          tool: "Bash",
        });
        appendSecurityEvent(tmp, ev);
        const line = fs.readFileSync(path.join(tmp, "logs", "security-events.jsonl"), "utf8").trim();
        const rec = JSON.parse(line) as { host?: string };
        expect(rec.host).toBe("test-host-99");
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});

describe("HK-10: resolveHostResolution — 9-host canonical set + degradation flag", () => {
  it("covers all 9 canonical hosts with no degradation", () => {
    for (const kind of KNOWN_GUILD_HOST_KINDS) {
      const r = resolveHostResolution({ GUILD_HOST: kind });
      expect(r.id).toBe(kind);
      expect(r.degraded).toBe(false);
      expect(r.rawUnknown).toBe("");
    }
  });

  it("returns id=GUILD_HOST_ID unchanged when explicitly set", () => {
    const r = resolveHostResolution({ GUILD_HOST_ID: "my-custom-host-42", GUILD_HOST: "codex" });
    expect(r.id).toBe("my-custom-host-42");
    expect(r.degraded).toBe(false);
  });

  it("returns id='claude' + degraded=false when GUILD_HOST absent", () => {
    const r = resolveHostResolution({});
    expect(r.id).toBe("claude");
    expect(r.degraded).toBe(false);
    expect(r.rawUnknown).toBe("");
  });

  it("returns id='claude' + degraded=true + rawUnknown when GUILD_HOST is unrecognized", () => {
    const r = resolveHostResolution({ GUILD_HOST: "unknown-ai-fork" });
    expect(r.id).toBe("claude");
    expect(r.degraded).toBe(true);
    expect(r.rawUnknown).toBe("unknown-ai-fork");
  });

  it("KNOWN_GUILD_HOST_KINDS has exactly 9 entries", () => {
    expect(KNOWN_GUILD_HOST_KINDS.length).toBe(9);
  });
});

describe("recall_quarantine event type (D-AUDIT/D-RECALL schema registration)", () => {
  // Verifies that:
  //   1. "recall_quarantine" is a valid SecurityEventType (TypeScript would fail to compile
  //      if it were not — this test is the runtime complement).
  //   2. `emitRecallQuarantine` writes a well-formed record with host: auto-stamped (HK-05).
  //   3. The on-disk record carries event_type: "recall_quarantine" and decision: "blocked".
  let tmp: string;
  const ORIG_HOST_ID = process.env["GUILD_HOST_ID"];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-secev-recall-"));
    process.env["GUILD_HOST_ID"] = "recall-host-7";
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (ORIG_HOST_ID === undefined) delete process.env["GUILD_HOST_ID"];
    else process.env["GUILD_HOST_ID"] = ORIG_HOST_ID;
  });

  it("serializes recall_quarantine with host: auto-stamped to disk", () => {
    const ok = emitRecallQuarantine(tmp, {
      run_id: "run-recall-1",
      lane_id: "recall-lane",
      detail: "chunk scored above injection threshold",
    });
    expect(ok).toBe(true);
    const file = path.join(tmp, "logs", "security-events.jsonl");
    expect(fs.existsSync(file)).toBe(true);
    const rec = JSON.parse(fs.readFileSync(file, "utf8").trim()) as Record<string, unknown>;
    expect(rec.schema_version).toBe("guild.security_event.v1");
    expect(rec.event_type).toBe("recall_quarantine");
    expect(rec.decision).toBe("blocked");
    expect(rec.host).toBe("recall-host-7");
    expect(rec.lane_id).toBe("recall-lane");
    expect(typeof rec.detail).toBe("string");
  });

  it("uses the default detail when none supplied", () => {
    emitRecallQuarantine(tmp, { run_id: "r" });
    const rec = JSON.parse(
      fs.readFileSync(path.join(tmp, "logs", "security-events.jsonl"), "utf8").trim(),
    ) as Record<string, unknown>;
    expect(rec.event_type).toBe("recall_quarantine");
    expect(typeof rec.detail).toBe("string");
    expect((rec.detail as string).length).toBeGreaterThan(0);
  });
});

describe("appendSecurityEvent", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-secev-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("appends NDJSON lines to <runDir>/logs/security-events.jsonl", () => {
    const ok1 = appendSecurityEvent(
      tmp,
      buildSecurityEvent({ run_id: "r", event_type: "capability_scope_violation", decision: "ask", tool: "Bash" }),
    );
    const ok2 = appendSecurityEvent(
      tmp,
      buildSecurityEvent({ run_id: "r", event_type: "mcp_description_mismatch", decision: "ask", tool: "mcp__x__y" }),
    );
    expect(ok1).toBe(true);
    expect(ok2).toBe(true);
    const file = path.join(tmp, "logs", "security-events.jsonl");
    expect(fs.existsSync(file)).toBe(true);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).schema_version).toBe("guild.security_event.v1");
    expect(JSON.parse(lines[1]).tool).toBe("mcp__x__y");
  });
});

describe("resolveRunDir", () => {
  it("prefers an explicit runDir", () => {
    expect(resolveRunDir("/any", "run-1", "/explicit/dir")).toBe("/explicit/dir");
  });
  it("derives .guild/runs/<id> from resolveGuildRoot otherwise", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-rd-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    const sub = path.join(tmp, "a", "b");
    fs.mkdirSync(sub, { recursive: true });
    expect(resolveRunDir(sub, "run-9")).toBe(path.join(tmp, ".guild", "runs", "run-9"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
