/**
 * scripts/__tests__/emit-remote-orphan.test.ts
 *
 * rf-wi-04 (G4) item 2 — the orphaned-remote-lane signal must be DURABLE, not
 * stderr-only, so a retry that discards the failed attempt's envelope cannot
 * drop the record (codex review round 3 High). Asserts the emitter writes both
 * a stderr warning AND a queryable NDJSON record under .guild/runs/<run-id>/.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  emitRemoteOrphan,
  REMOTE_ORPHAN_EVENT,
  REMOTE_ORPHAN_SCHEMA,
  REMOTE_ORPHAN_SINK_RELPATH,
} from "../lib/emit-remote-orphan";
import { validateText } from "../v1.4-log-validator";

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rf04-orphan-"));
}

describe("emitRemoteOrphan — durable orphaned-lane signal", () => {
  it("writes a stderr warning AND a full-detail record in the DEDICATED remote-orphans sink", () => {
    const cwd = tmpRepo();
    const runId = "run-orphan-1";
    const warnings: string[] = [];
    emitRemoteOrphan(cwd, runId, "[guild][remote-orphan] lane a on u@box (ssh-u@box-1) may be LIVE", (m) => warnings.push(m));

    // 1. stderr warning present.
    expect(warnings.join("")).toMatch(/\[guild\]\[remote-orphan\]/);

    // 2. full-detail NDJSON record in the DEDICATED sink (not the canonical log).
    const sink = path.join(cwd, ".guild", "runs", runId, REMOTE_ORPHAN_SINK_RELPATH);
    expect(fs.existsSync(sink)).toBe(true);
    const lines = fs.readFileSync(sink, "utf8").trim().split("\n").filter(Boolean);
    const rec = lines.map((l) => JSON.parse(l)).find((r) => r.event_name === REMOTE_ORPHAN_EVENT);
    expect(rec).toBeDefined();
    expect(rec.schema_version).toBe(REMOTE_ORPHAN_SCHEMA);
    expect(rec.run_id).toBe(runId);
    expect(rec.message).toMatch(/may be LIVE/);
    expect(rec.message).toMatch(/ssh-u@box-1/); // actionable identity preserved
    expect(typeof rec.at).toBe("string");
  });

  it("keeps the canonical v1.4 log VALID (invalid === 0) — the trace line carries the actionable detail (round-4 fix)", () => {
    const cwd = tmpRepo();
    const runId = "run-orphan-2";
    emitRemoteOrphan(cwd, runId, "[guild][remote-orphan] lane b on u@box2 may be LIVE", () => {});
    const canonical = path.join(cwd, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
    expect(fs.existsSync(canonical)).toBe(true);
    const text = fs.readFileSync(canonical, "utf8");
    const summary = validateText(text);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.invalid).toBe(0); // no custom schema pollutes the canonical log
    // the valid trace line carries the actionable orphan message, not generic text.
    const traceLine = text.trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.schema_version === "guild.trace.degradation.v1");
    expect(traceLine.reason).toMatch(/may be LIVE/);
  });

  it("never throws even when the run dir cannot be created", () => {
    // A path whose parent is a FILE — mkdirSync would throw; emitter must swallow.
    const base = tmpRepo();
    const filePath = path.join(base, "not-a-dir");
    fs.writeFileSync(filePath, "x");
    expect(() =>
      emitRemoteOrphan(filePath, "run-x", "[guild][remote-orphan] x", () => {}),
    ).not.toThrow();
  });
});
