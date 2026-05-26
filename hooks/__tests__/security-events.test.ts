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
