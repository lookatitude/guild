/**
 * hooks/lib/__tests__/block-unmarked-lanes-config.test.ts
 *
 * Issue #93 — the GUARD half of promoting strict unmarked-lane blocking to a
 * first-class config key.
 *
 * Red-first proof of the gap: `hooks/lib/backend-degradation.ts` engaged strict
 * mode from `GUILD_BLOCK_UNMARKED_LANES` and NOTHING ELSE. An operator who set
 * the registered key `defaults.dispatch.block_unmarked_lanes: true` in
 * `.guild/settings.json` got a `config show --sources` line saying strict mode
 * was on while the guard kept its default record-not-block posture — the config
 * surface lying about live behaviour.
 *
 * The GREEN contract pinned here:
 *   - `readSnapshotBlockUnmarkedLanes` reads the run's U6 resolved-settings
 *     snapshot — the value `runstart-preflight.ts` computed from the canonical
 *     `resolveSettings()` chain, so workspace inheritance and
 *     `settings.local.json` are honored by construction (PR #87's codex round-2
 *     finding) WITHOUT wiring the resolver into `pre-tool-use.js`, which runs on
 *     every tool call (measured: that import takes its bundle 110 KB → 923 KB);
 *   - `resolveBlockUnmarkedLanes` keeps `GUILD_BLOCK_UNMARKED_LANES` as a true
 *     per-session OVERRIDE — it can force strict mode ON *and* OFF over a
 *     configured value, and an unrecognized value falls through to the snapshot.
 *
 * The END-TO-END leg (settings.json → resolveSettings → snapshot field) is pinned
 * separately by the runstart-preflight test, so this file can stay a pure,
 * fixture-driven unit test of the hook-side read.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  BLOCK_UNMARKED_ENV,
  DEFAULT_BLOCK_UNMARKED_LANES,
  isBlockUnmarkedEngaged,
  readSnapshotBlockUnmarkedLanes,
  resolveBlockUnmarkedLanes,
} from "../backend-degradation";

const RUN = "run-20260806-000000-x";
const DIRS: string[] = [];
afterAll(() => DIRS.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** A root whose run snapshot carries `effective` verbatim (raw = written as-is). */
function mkRoot(effective?: unknown, raw?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-bul-"));
  DIRS.push(dir);
  const runDir = path.join(dir, ".guild", "runs", RUN);
  fs.mkdirSync(runDir, { recursive: true });
  if (raw !== undefined) {
    fs.writeFileSync(path.join(runDir, "resolved-settings.json"), raw);
  } else if (effective !== undefined) {
    fs.writeFileSync(
      path.join(runDir, "resolved-settings.json"),
      JSON.stringify({ schema_version: "guild.resolved_settings.v1", effective }, null, 2),
    );
  }
  return dir;
}

describe("#93 — the canonical default", () => {
  it("is OFF, matching the registered schema default (record-not-block stays the default posture)", () => {
    expect(DEFAULT_BLOCK_UNMARKED_LANES).toBe(false);
  });
});

describe("#93 — readSnapshotBlockUnmarkedLanes reads the run's RESOLVED value", () => {
  it("returns true when the snapshot's effective block says true", () => {
    const root = mkRoot({ agent_mode: "team", block_unmarked_lanes: true });
    expect(readSnapshotBlockUnmarkedLanes(root, RUN)).toBe(true);
  });

  it("returns false when the snapshot's effective block says false", () => {
    const root = mkRoot({ agent_mode: "team", block_unmarked_lanes: false });
    expect(readSnapshotBlockUnmarkedLanes(root, RUN)).toBe(false);
  });

  it("returns null (= 'the run never stated a value') for a pre-#93 snapshot", () => {
    const root = mkRoot({ agent_mode: "team" });
    expect(readSnapshotBlockUnmarkedLanes(root, RUN)).toBeNull();
  });

  it("returns null (never throws) on an absent, malformed, or wrong-shaped snapshot", () => {
    expect(readSnapshotBlockUnmarkedLanes(mkRoot(), RUN)).toBeNull();
    expect(readSnapshotBlockUnmarkedLanes("/definitely/not/a/repo", RUN)).toBeNull();
    expect(readSnapshotBlockUnmarkedLanes(mkRoot(undefined, "{ not json"), RUN)).toBeNull();
    expect(readSnapshotBlockUnmarkedLanes(mkRoot(undefined, "[1,2,3]"), RUN)).toBeNull();
    expect(readSnapshotBlockUnmarkedLanes(mkRoot("not-an-object"), RUN)).toBeNull();
  });

  it("IGNORES a non-boolean value rather than coercing it (the string 'false' is truthy)", () => {
    for (const v of ["true", "false", 1, 0, null, {}]) {
      expect(readSnapshotBlockUnmarkedLanes(mkRoot({ block_unmarked_lanes: v }), RUN)).toBeNull();
    }
  });
});

describe("#93 — resolveBlockUnmarkedLanes: env is an OVERRIDE over the resolved value", () => {
  it("uses the snapshot value when the env var is unset", () => {
    expect(resolveBlockUnmarkedLanes(mkRoot({ block_unmarked_lanes: true }), RUN, {})).toBe(true);
    expect(resolveBlockUnmarkedLanes(mkRoot({ block_unmarked_lanes: false }), RUN, {})).toBe(false);
  });

  it("falls back to the registered default when neither env nor snapshot states one", () => {
    expect(resolveBlockUnmarkedLanes(mkRoot(), RUN, {})).toBe(DEFAULT_BLOCK_UNMARKED_LANES);
  });

  it("env=1/true/yes forces strict mode ON over a snapshot that says off", () => {
    const off = mkRoot({ block_unmarked_lanes: false });
    for (const v of ["1", "true", "TRUE", "yes", " Yes "]) {
      expect(resolveBlockUnmarkedLanes(off, RUN, { [BLOCK_UNMARKED_ENV]: v })).toBe(true);
    }
  });

  it("env=0/false/no forces strict mode OFF over a snapshot that says on (a real override, not a one-way latch)", () => {
    const on = mkRoot({ block_unmarked_lanes: true });
    for (const v of ["0", "false", "FALSE", "no", " No "]) {
      expect(resolveBlockUnmarkedLanes(on, RUN, { [BLOCK_UNMARKED_ENV]: v })).toBe(false);
    }
  });

  it("an UNRECOGNIZED env value falls through to the snapshot (never silently disarms it)", () => {
    const on = mkRoot({ block_unmarked_lanes: true });
    for (const v of ["", "   ", "maybe", "2"]) {
      expect(resolveBlockUnmarkedLanes(on, RUN, { [BLOCK_UNMARKED_ENV]: v })).toBe(true);
    }
  });
});

describe("#93 — the legacy env-only predicate keeps its affirmative-allowlist contract", () => {
  it("stays true only for the affirmative tokens", () => {
    for (const v of ["1", "true", "yes"]) {
      expect(isBlockUnmarkedEngaged({ [BLOCK_UNMARKED_ENV]: v })).toBe(true);
    }
    for (const v of [undefined, "", "0", "false", "no", "maybe"]) {
      expect(isBlockUnmarkedEngaged(v === undefined ? {} : { [BLOCK_UNMARKED_ENV]: v })).toBe(
        false,
      );
    }
  });
});
