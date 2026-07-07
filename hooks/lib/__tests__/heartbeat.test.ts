/**
 * Tests for hooks/lib/heartbeat.ts — structured liveness heartbeat (ADR-RE-3).
 *
 * Covers:
 *   - heartbeatPath / legacyLogPath
 *   - readHeartbeat: present, absent, corrupt, missing-timestamp → null
 *   - readHeartbeatTimeoutMs: default, configured, invalid → default
 *   - assessLiveness: fresh/stale via heartbeat, mtime fallback, none,
 *     future-dated stamp clamp, distinct-from-O-3 (no output inspection)
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  heartbeatPath,
  legacyLogPath,
  readHeartbeat,
  readHeartbeatTimeoutMs,
  assessLiveness,
} from "../heartbeat";

function writeHeartbeat(runDir: string, specialist: string, record: object): void {
  const p = heartbeatPath(runDir, specialist);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(record));
}

function writeLegacyLog(runDir: string, specialist: string, mtimeMs: number): void {
  const p = legacyLogPath(runDir, specialist);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, "working...\n");
  const t = mtimeMs / 1000;
  fs.utimesSync(p, t, t);
}

describe("heartbeat.ts", () => {
  let tmpDir: string;
  let runDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hb-"));
    runDir = path.join(tmpDir, ".guild", "runs", "run-abc");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("path helpers", () => {
    it("heartbeatPath → <runDir>/in-progress/<specialist>.json", () => {
      expect(heartbeatPath(runDir, "backend")).toBe(
        path.join(runDir, "in-progress", "backend.json")
      );
    });
    it("legacyLogPath → <runDir>/in-progress/<specialist>.log", () => {
      expect(legacyLogPath(runDir, "backend")).toBe(
        path.join(runDir, "in-progress", "backend.log")
      );
    });
  });

  describe("readHeartbeat", () => {
    it("returns null when absent", () => {
      expect(readHeartbeat(runDir, "backend")).toBeNull();
    });

    it("returns null on corrupt JSON", () => {
      const p = heartbeatPath(runDir, "backend");
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "{ broken");
      expect(readHeartbeat(runDir, "backend")).toBeNull();
    });

    it("returns null when timestamp is missing/empty", () => {
      writeHeartbeat(runDir, "backend", { step: "writing tests" });
      expect(readHeartbeat(runDir, "backend")).toBeNull();
    });

    it("parses a full record", () => {
      writeHeartbeat(runDir, "backend", {
        timestamp: "2026-05-26T14:42:00Z",
        step: "implementing",
        pct_complete: 40,
        last_action: "wrote run-state.ts",
      });
      const hb = readHeartbeat(runDir, "backend");
      expect(hb).not.toBeNull();
      expect(hb?.step).toBe("implementing");
      expect(hb?.pct_complete).toBe(40);
      expect(hb?.last_action).toBe("wrote run-state.ts");
    });
  });

  describe("readHeartbeatTimeoutMs", () => {
    it("returns the documented default when settings.json is absent", () => {
      expect(readHeartbeatTimeoutMs(tmpDir)).toBe(DEFAULT_HEARTBEAT_TIMEOUT_MS);
    });

    it("reads defaults.heartbeat_timeout_ms when configured", () => {
      const guildDir = path.join(tmpDir, ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      fs.writeFileSync(
        path.join(guildDir, "settings.json"),
        JSON.stringify({ defaults: { heartbeat_timeout_ms: 120000 } })
      );
      expect(readHeartbeatTimeoutMs(tmpDir)).toBe(120000);
    });

    it("falls back to the default on a non-positive / non-numeric value", () => {
      const guildDir = path.join(tmpDir, ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      fs.writeFileSync(
        path.join(guildDir, "settings.json"),
        JSON.stringify({ defaults: { heartbeat_timeout_ms: -5 } })
      );
      expect(readHeartbeatTimeoutMs(tmpDir)).toBe(DEFAULT_HEARTBEAT_TIMEOUT_MS);
    });
  });

  describe("assessLiveness — structured heartbeat", () => {
    it("reports FRESH from a recent heartbeat", () => {
      const now = Date.parse("2026-05-26T15:00:00Z");
      writeHeartbeat(runDir, "backend", {
        timestamp: "2026-05-26T14:59:00Z", // 60s ago
        step: "implementing",
        pct_complete: 50,
      });
      const v = assessLiveness(runDir, "backend", 600000, now);
      expect(v.source).toBe("heartbeat");
      expect(v.fresh).toBe(true);
      expect(v.ageMs).toBe(60000);
      expect(v.step).toBe("implementing");
      expect(v.pctComplete).toBe(50);
    });

    it("reports STALE when the heartbeat is older than the timeout", () => {
      const now = Date.parse("2026-05-26T15:00:00Z");
      writeHeartbeat(runDir, "backend", {
        timestamp: "2026-05-26T14:40:00Z", // 20 min ago
      });
      const v = assessLiveness(runDir, "backend", 600000, now);
      expect(v.source).toBe("heartbeat");
      expect(v.fresh).toBe(false);
      expect(v.ageMs).toBe(1200000);
    });

    it("clamps a future-dated stamp to age 0 (treated as fresh)", () => {
      const now = Date.parse("2026-05-26T15:00:00Z");
      writeHeartbeat(runDir, "backend", { timestamp: "2026-05-26T15:05:00Z" });
      const v = assessLiveness(runDir, "backend", 600000, now);
      expect(v.ageMs).toBe(0);
      expect(v.fresh).toBe(true);
    });
  });

  describe("assessLiveness — mtime fallback (backward-compat)", () => {
    it("falls back to legacy .log mtime when the JSON is absent", () => {
      const now = Date.parse("2026-05-26T15:00:00Z");
      writeLegacyLog(runDir, "backend", now - 120000); // 2 min ago
      const v = assessLiveness(runDir, "backend", 600000, now);
      expect(v.source).toBe("mtime");
      expect(v.fresh).toBe(true);
      expect(v.ageMs).toBeGreaterThanOrEqual(119000);
      expect(v.ageMs).toBeLessThanOrEqual(121000);
    });

    it("prefers the structured heartbeat over the legacy log when both exist", () => {
      const now = Date.parse("2026-05-26T15:00:00Z");
      writeLegacyLog(runDir, "backend", now - 1200000); // stale log
      writeHeartbeat(runDir, "backend", { timestamp: "2026-05-26T14:59:30Z" }); // fresh hb
      const v = assessLiveness(runDir, "backend", 600000, now);
      expect(v.source).toBe("heartbeat");
      expect(v.fresh).toBe(true);
    });
  });

  describe("assessLiveness — none", () => {
    it("reports source 'none' and not-fresh when no signal exists", () => {
      const v = assessLiveness(runDir, "backend", 600000, Date.now());
      expect(v.source).toBe("none");
      expect(v.fresh).toBe(false);
      expect(v.ageMs).toBeNull();
    });
  });
});
