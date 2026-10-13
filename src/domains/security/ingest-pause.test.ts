/**
 * ingest-pause.test.ts — the pause gate compares REAL paths (rework-r2 P2).
 *
 * A symlinked directory alias, a symlinked file alias, a dangling link that will
 * land in the wiki, and a hard link to the candidate all name the paused thing.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ingestPauseBlocking, recordIngestPause } from ".";
import { createGuildStorage, type GuildStorage } from "../state";

let tmp: string;
let storage: GuildStorage;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pause-real-"));
  fs.mkdirSync(path.join(tmp, ".guild", "wiki", "concepts"), { recursive: true });
  storage = createGuildStorage(tmp, {
    activeRoot: tmp,
    profile: "standalone",
    env: { GUILD_STATE_HOME: path.join(tmp, "state"), GUILD_CACHE_HOME: path.join(tmp, "cache") } as NodeJS.ProcessEnv,
  });
  fs.writeFileSync(path.join(tmp, "candidate.md"), "poisoned", "utf8");
  recordIngestPause(storage, {
    candidate_path: path.join(tmp, "candidate.md"),
    category: "concept",
    pause_reason: "directive_probe",
    probe_patterns: ["x"],
  });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("F2 · ingest pause matches real paths, not spellings (rework-r2 P2)", () => {
  it("F2 · directory, file, dangling and hard-link aliases all block; an outside alias does not", () => {
    fs.symlinkSync(path.join(tmp, ".guild", "wiki"), path.join(tmp, "wiki-link"));
    fs.symlinkSync(path.join(tmp, "candidate.md"), path.join(tmp, "cand-link.md"));
    fs.symlinkSync(path.join(tmp, ".guild", "wiki", "concepts", "new.md"), path.join(tmp, "dangling.md"));
    fs.linkSync(path.join(tmp, "candidate.md"), path.join(tmp, "cand-hard.md"));
    for (const alias of ["wiki-link/concepts/new.md", "wiki-link", "cand-link.md", "dangling.md", "cand-hard.md"]) {
      expect(`${alias}:${ingestPauseBlocking(storage, path.join(tmp, alias)) !== null}`).toBe(`${alias}:true`);
    }
    // CONTROL: canonical still blocks; an alias to a directory outside the wiki does not.
    expect(ingestPauseBlocking(storage, path.join(tmp, ".guild", "wiki", "x.md"))).not.toBeNull();
    fs.mkdirSync(path.join(tmp, "src"));
    fs.symlinkSync(path.join(tmp, "src"), path.join(tmp, "src-link"));
    expect(ingestPauseBlocking(storage, path.join(tmp, "src-link", "x.ts"))).toBeNull();
  });
});
