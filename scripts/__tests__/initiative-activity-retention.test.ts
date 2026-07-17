/**
 * scripts/__tests__/initiative-activity-retention.test.ts
 *
 * Initiative activity event schema (item 12) + run retention enforcement
 * (item 14). docs/v2/initiatives.md §Directory / §Per-run provenance.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ACTIVITY_SCHEMA, ACTIVITY_EVENTS, makeActivityRow, isValidActivityRow, appendActivity, readActivity,
} from "../lib/initiative-activity";
import { isExpired, findExpiredRuns, sweepExpiredRuns } from "../lib/retention";

const TS = "2026-06-13T00:00:00Z";

describe("initiative activity schema (item 12)", () => {
  test("closed event vocabulary", () => {
    expect(ACTIVITY_EVENTS).toContain("status_change");
    expect(ACTIVITY_EVENTS).toContain("closed");
  });
  test("makeActivityRow builds a valid row; omits empty optionals", () => {
    const r = makeActivityRow({ ts: TS, initiative_id: "init_x", event: "created", detail: "new" });
    expect(r.schema_version).toBe(ACTIVITY_SCHEMA);
    expect(r.actor).toBeUndefined();
    expect(isValidActivityRow(r)).toBe(true);
  });
  test("isValidActivityRow rejects off-enum / malformed", () => {
    expect(isValidActivityRow({ schema_version: ACTIVITY_SCHEMA, ts: TS, initiative_id: "x", event: "bogus", detail: "d" })).toBe(false);
    expect(isValidActivityRow({ event: "created" })).toBe(false);
  });
  test("append + read round-trips, skipping malformed lines; refuses invalid append", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-act-"));
    const file = path.join(dir, "activity.jsonl");
    appendActivity(file, makeActivityRow({ ts: TS, initiative_id: "i", event: "created", detail: "a" }));
    appendActivity(file, makeActivityRow({ ts: TS, initiative_id: "i", event: "status_change", detail: "b", actor: "orchestrator" }));
    fs.appendFileSync(file, "{not json\n"); // malformed line tolerated on read
    const rows = readActivity(file);
    expect(rows.map((r) => r.event)).toEqual(["created", "status_change"]);
    expect(() => appendActivity(file, { schema_version: "x" } as never)).toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("run retention (item 14)", () => {
  const NOW = Date.parse("2026-06-13T00:00:00Z");
  test("only one-off-90d runs expire, and only past the window", () => {
    expect(isExpired({ retention_class: "one-off-90d", closed_at: "2026-01-01T00:00:00Z" }, NOW)).toBe(true);  // >90d
    expect(isExpired({ retention_class: "one-off-90d", closed_at: "2026-06-01T00:00:00Z" }, NOW)).toBe(false); // <90d
    expect(isExpired({ retention_class: "until-archive", closed_at: "2020-01-01T00:00:00Z" }, NOW)).toBe(false); // never by age
    expect(isExpired({ retention_class: "one-off-90d" }, NOW)).toBe(false); // no closed_at
  });

  test("findExpiredRuns + sweep (dry-run default never deletes; --apply removes)", () => {
    const g = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ret-"));
    const mkRun = (id: string, rc: string, closed: string) => {
      const p = path.join(g, "runs", id);
      fs.mkdirSync(p, { recursive: true });
      fs.writeFileSync(path.join(p, "provenance.json"), JSON.stringify({ run_id: id, retention_class: rc, closed_at: closed }));
    };
    mkRun("run-old", "one-off-90d", "2026-01-01T00:00:00Z"); // expired
    mkRun("run-new", "one-off-90d", "2026-06-10T00:00:00Z"); // fresh
    mkRun("run-keep", "until-archive", "2020-01-01T00:00:00Z"); // never

    expect(findExpiredRuns(g, NOW).map((r) => r.run_id)).toEqual(["run-old"]);

    const dry = sweepExpiredRuns(g, NOW);
    expect(dry.dryRun).toBe(true);
    expect(fs.existsSync(path.join(g, "runs", "run-old"))).toBe(true); // not deleted

    const applied = sweepExpiredRuns(g, NOW, { dryRun: false });
    expect(applied.removed.map((r) => r.run_id)).toEqual(["run-old"]);
    expect(fs.existsSync(path.join(g, "runs", "run-old"))).toBe(false);
    expect(fs.existsSync(path.join(g, "runs", "run-keep"))).toBe(true);

    fs.rmSync(g, { recursive: true, force: true });
  });
});
