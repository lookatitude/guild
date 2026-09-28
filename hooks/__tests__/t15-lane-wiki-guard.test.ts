/**
 * hooks/__tests__/t15-lane-wiki-guard.test.ts — plr-wi-15-3 (KTD35).
 *
 * "Specialists never Write the wiki" runs on the real PreToolUse hook: a lane
 * worker (GUILD_TASK_ID or GUILD_LANE_ID) is denied every write that realpaths
 * under <root>/.guild/wiki, with a guild.security_event.v1. The lead / T0 session
 * and the in-process harvest writer are unaffected. Each deny case has a planted
 * control beside it: the same write from the lead, or a non-wiki target.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { bashWriteTargets } from "../lib/security/lane-wiki-guard";
import { createGuildStorage } from "../../src/domains/state";
import { harvestDecision } from "../../src/domains/knowledge";

const PLUGIN = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(PLUGIN, "hooks", "pre-tool-use.ts");
const RUN_ID = "run-t15-wiki";

let tmp: string;
let repo: string;
let runDir: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-t15-wiki-")));
  repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".guild", "wiki", "decisions"), { recursive: true });
  fs.mkdirSync(path.join(repo, ".guild", "knowledge", "candidates"), { recursive: true });
  runDir = path.join(tmp, "run");
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Who = "task" | "lane" | "lead";

function runHook(
  who: Who,
  tool: string,
  toolInput: Record<string, unknown>,
): { permissionDecision?: string; reason?: string } {
  const r = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify({ tool_name: tool, tool_input: toolInput, cwd: repo }),
    encoding: "utf8",
    cwd: repo,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: PLUGIN,
      GUILD_CWD: repo,
      GUILD_RUN_DIR: runDir,
      GUILD_RUN_ID: RUN_ID,
      GUILD_TASK_ID: who === "task" ? "T1" : "",
      GUILD_LANE_ID: who === "lane" ? "lane-a" : "",
      GUILD_TASK_CELL_INSTANCE_ID: "",
      GUILD_CAPABILITY_SCOPE: "",
    },
    timeout: 30000,
  });
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const h = JSON.parse(line).hookSpecificOutput;
      if (h) return { permissionDecision: h.permissionDecision, reason: h.permissionDecisionReason };
    } catch {
      /* not this line */
    }
  }
  return {};
}

function refusalEvents(): Array<Record<string, unknown>> {
  const p = path.join(runDir, "logs", "security-events.jsonl");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e["event_type"] === "lane_wiki_write_refused");
}

const refused = (d: { permissionDecision?: string; reason?: string }): boolean =>
  d.permissionDecision === "deny" && /lane_wiki_write_refused/.test(d.reason ?? "");

const page = (): string => path.join(repo, ".guild", "wiki", "decisions", "x.md");

describe("plr-wi-15-3 · a lane worker never writes the wiki (KTD35)", () => {
  it("denies a GUILD_TASK_ID worker's Write under .guild/wiki, with a security event", () => {
    expect(refused(runHook("task", "Write", { file_path: page(), content: "# x\n" }))).toBe(true);
    const ev = refusalEvents();
    expect(ev.length).toBe(1);
    expect(ev[0]["schema_version"]).toBe("guild.security_event.v1");
    expect(ev[0]["decision"]).toBe("deny");
    expect(ev[0]["tool"]).toBe("Write");
  });

  it("denies a GUILD_LANE_ID worker's Edit and MultiEdit under .guild/wiki", () => {
    expect(refused(runHook("lane", "Edit", { file_path: page(), old_string: "a", new_string: "b" }))).toBe(true);
    expect(refused(runHook("lane", "MultiEdit", { file_path: page(), edits: [] }))).toBe(true);
    expect(refusalEvents()[0]["lane_id"]).toBe("lane-a");
  });

  it("CONTROL: the lead / T0 session writes the same page untouched", () => {
    const d = runHook("lead", "Write", { file_path: page(), content: "# x\n" });
    expect(d.permissionDecision).toBeUndefined();
    expect(refusalEvents()).toEqual([]);
  });

  it("CONTROL: a lane worker writes a candidate under .guild/knowledge/candidates/", () => {
    const cand = path.join(repo, ".guild", "knowledge", "candidates", "decisions", "x.md");
    expect(runHook("task", "Write", { file_path: cand, content: "# x\n" }).permissionDecision).toBeUndefined();
  });

  it("compares by realpath: a symlink or a `..` spelling into the wiki is still the wiki", () => {
    fs.symlinkSync(path.join(repo, ".guild", "wiki"), path.join(repo, "notes"));
    expect(refused(runHook("task", "Write", { file_path: path.join(repo, "notes", "y.md"), content: "y" }))).toBe(true);
    const dotdot = path.join(repo, ".guild", "knowledge", "..", "wiki", "z.md");
    expect(refused(runHook("task", "Write", { file_path: dotdot, content: "z" }))).toBe(true);
    expect(refused(runHook("task", "Write", { file_path: ".guild/wiki/rel.md", content: "r" }))).toBe(true);
  });

  it("denies a lane Bash redirection or tee into the wiki; a non-wiki redirection passes", () => {
    expect(refused(runHook("task", "Bash", { command: "echo hi > .guild/wiki/log.md" }))).toBe(true);
    expect(refused(runHook("task", "Bash", { command: `printf x | tee -a "${page()}"` }))).toBe(true);
    expect(refused(runHook("task", "Bash", { command: "echo ok > out.txt 2>&1" }))).toBe(false);
    expect(refused(runHook("lead", "Bash", { command: "echo hi >> .guild/wiki/log.md" }))).toBe(false);
  });

  it("bashWriteTargets reads redirections and tee operands, never fd duplications", () => {
    expect(bashWriteTargets("a >> b.md 2>&1 && c &> 'd e' ; x | tee -a f g >/dev/null")).toEqual([
      "b.md",
      "d e",
      "/dev/null",
      "f",
      "g",
    ]);
    expect(bashWriteTargets("cat < in.md && grep -c x 2>&1")).toEqual([]);
  });

  it("CONTROL: the in-process harvest writer is not a tool call and still promotes under a lane env", () => {
    const prev = process.env["GUILD_TASK_ID"];
    process.env["GUILD_TASK_ID"] = "T1";
    try {
      const storage = createGuildStorage(repo, {
        activeRoot: repo,
        profile: "standalone",
        env: {
          GUILD_STATE_HOME: path.join(tmp, "x", "state"),
          GUILD_CACHE_HOME: path.join(tmp, "x", "cache"),
          GUILD_WORKTREE_HOME: path.join(tmp, "x", "worktrees"),
          GUILD_TEMP_HOME: path.join(tmp, "x", "temp"),
        } as NodeJS.ProcessEnv,
      });
      const hRun = storage.project!.runRecord(RUN_ID);
      fs.mkdirSync(hRun, { recursive: true });
      const r = harvestDecision({
        run_id: RUN_ID,
        runDir: hRun,
        storage,
        trigger: "redirect_threshold",
        slug: "prefer-idempotent-retries",
        title: "Prefer idempotent retries",
        body: "Every queue consumer is idempotent.",
        reasoning: "The operator redirected the same approach three times in this run.",
        source_refs: ["run:run-t15-wiki"],
      });
      expect(r.promoted).toBe(true);
      expect(fs.existsSync(r.wiki_path!)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env["GUILD_TASK_ID"];
      else process.env["GUILD_TASK_ID"] = prev;
    }
  });
});
