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

import { bashWikiPath, bashWords, isWithin, resolvesUnderWiki } from "../lib/security/lane-wiki-guard";
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

  it("bashWords strips quotes and escapes and re-lexes substitutions, double-quoted ones included", () => {
    expect(bashWords(`echo "$(printf x > .guild/w\\iki/s.md)"`)).toContain(".guild/wiki/s.md");
    expect(bashWords("printf x > .guild/\"wiki\"/q.md")).toContain(".guild/wiki/q.md");
  });

  it("G-lane r1: a symlink popped by `..` is resolved physically, not lexically", () => {
    fs.symlinkSync(path.join(repo, ".guild", "wiki", "decisions"), path.join(repo, "alias"));
    // alias/.. is .guild/wiki on disk; a lexical normalize would say <repo>/escape.md.
    expect(refused(runHook("task", "Write", { file_path: "alias/../escape.md", content: "e" }))).toBe(true);
    expect(refused(runHook("task", "Write", { file_path: `${repo}/alias/../e2.md`, content: "e" }))).toBe(true);
    // CONTROL: a plain `..` out of a real directory still leaves the wiki.
    expect(refused(runHook("task", "Write", { file_path: ".guild/wiki/../outside.md", content: "o" }))).toBe(false);
  });

  it("G-lane r1: a wiki child whose name starts with `..` is inside the wiki", () => {
    expect(refused(runHook("task", "Write", { file_path: ".guild/wiki/..hidden", content: "h" }))).toBe(true);
    const wiki = path.join(repo, ".guild", "wiki");
    expect(isWithin(wiki, path.join(wiki, "..hidden"))).toBe(true);
    // CONTROL: the parent and a sibling are not.
    expect(isWithin(wiki, path.dirname(wiki))).toBe(false);
    expect(isWithin(wiki, path.join(repo, ".guild", "wikix"))).toBe(false);
  });

  it("G-lane r1: quoted redirections, writer commands and interpreter literals into the wiki are refused", () => {
    expect(refused(runHook("task", "Bash", { command: `printf x > .guild/"wiki"/quote.md` }))).toBe(true);
    expect(refused(runHook("task", "Bash", { command: "cp /dev/null .guild/wiki/copy.md" }))).toBe(true);
    expect(
      refused(runHook("task", "Bash", { command: `node -e "require('fs').writeFileSync('.guild/wiki/n.md','x')"` })),
    ).toBe(true);
    // CONTROL: the lead may still write it.
    expect(refused(runHook("lead", "Bash", { command: "cp /dev/null .guild/wiki/copy.md" }))).toBe(false);
  });

  it("G-lane r2: a double-quoted substitution and a git output option into the wiki are refused", () => {
    const sub = path.join(repo, ".guild", "wiki", "substitution.md");
    const diff = path.join(repo, ".guild", "wiki", "diff.md");
    expect(refused(runHook("task", "Bash", { command: 'echo "$(printf x > .guild/wiki/substitution.md)"' }))).toBe(true);
    expect(
      refused(runHook("task", "Bash", { command: "git diff --no-index --output=.guild/wiki/diff.md /dev/null /dev/null" })),
    ).toBe(true);
    expect(fs.existsSync(sub) || fs.existsSync(diff)).toBe(false);
    expect(refusalEvents().length).toBe(2);
    // CONTROL: a lane Bash that names no wiki path passes; the lead runs the same command untouched.
    expect(runHook("task", "Bash", { command: "git diff --stat && echo ok > out.txt" }).permissionDecision).toBeUndefined();
    expect(
      runHook("lead", "Bash", { command: 'echo "$(printf x > .guild/wiki/substitution.md)"' }).permissionDecision,
    ).toBeUndefined();
  });

  it("bashWikiPath: any command naming a wiki path is refused, whatever the verb (no reader allowlist)", () => {
    const wiki = path.join(repo, ".guild", "wiki");
    const hit = (c: string): string | null => bashWikiPath(c, (t) => resolvesUnderWiki([wiki], t, repo));
    for (const c of [
      'echo "$(printf x > .guild/wiki/substitution.md)"',
      "echo \"`cp a .guild/wiki/b`\"",
      "git diff --no-index --output=.guild/wiki/diff.md /dev/null /dev/null",
      "cat .guild/wiki/x.md",
      "grep -r foo .guild/wiki",
      "git log .guild/wiki",
      "sed -i s/a/b/ .guild/wiki/x",
      "dd if=a of=.guild/wiki/x",
      `python3 -c "open('.guild/wiki/p','w')"`,
      "cat a | tee .guild/wi\\ki/t",
      "echo ${X:-.guild/wiki/d} > /dev/null",
      "x 2> .guild/wiki/e",
      `ls ${wiki}`,
    ]) {
      expect(hit(c)).not.toBeNull();
    }
    for (const c of ["echo ok > out.txt 2>&1", "bun test --isolate hooks", "cat .guild/knowledge/candidates/x.md"]) {
      expect(hit(c)).toBeNull();
    }
  });

  it("G-lane r3: a quoted interpreter path with spaces into the wiki is refused (symlink alias, absolute)", () => {
    fs.symlinkSync(path.join(repo, ".guild", "wiki"), path.join(repo, "wiki alias"));
    const repro = `node -e "require('fs').writeFileSync('wiki alias/bypass.md','x')"`;
    expect(refused(runHook("task", "Bash", { command: repro }))).toBe(true);
    const abs = `python3 -c 'open("${repo}/wiki alias/abs.md","w")'`;
    expect(refused(runHook("task", "Bash", { command: abs }))).toBe(true);
    expect(refusalEvents().length).toBe(2);
    // CONTROL: a spaced literal outside the wiki passes; the lead runs the repro untouched.
    const other = `node -e "require('fs').writeFileSync('out dir/x.md','x')"`;
    expect(runHook("task", "Bash", { command: other }).permissionDecision).toBeUndefined();
    expect(runHook("lead", "Bash", { command: repro }).permissionDecision).toBeUndefined();
  });

  it("G-lane r3: bashWikiPath keeps spaces in literals and absolute runs under a spaced repo", () => {
    const spaced = path.join(tmp, "my repo");
    const wiki = path.join(spaced, ".guild", "wiki");
    fs.mkdirSync(wiki, { recursive: true });
    fs.symlinkSync(wiki, path.join(spaced, "wiki alias"));
    const hit = (c: string): string | null => bashWikiPath(c, (t) => resolvesUnderWiki([wiki], t, spaced));
    for (const c of [
      `node -e "require('fs').writeFileSync('wiki alias/bypass.md','x')"`,
      `node -e "require('fs').writeFileSync('${spaced}/.guild/wiki/abs.md','x')"`,
      `python3 -c 'open("${wiki}/p.md","w")'`,
      // a stray apostrophe before the literal must not shift quote pairing
      `node -e "// don't\nrequire('fs').writeFileSync('wiki alias/b','x')"`,
      `bash -c "node -e \\"require('fs').writeFileSync('wiki alias/n','x')\\""`,
      `echo x > ${spaced.replace(" ", "\\ ")}/.guild/wiki/esc.md`,
    ]) {
      expect(hit(c)).not.toBeNull();
    }
    // CONTROL: spaced paths outside the wiki are not refused.
    for (const c of [
      `node -e "require('fs').writeFileSync('wiki aliasx/b.md','x')"`,
      `python3 -c 'open("${spaced}/.guild/knowledge/candidates/x.md","w")'`,
      "echo 'hello world' > out.txt",
    ]) {
      expect(hit(c)).toBeNull();
    }
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

  it("G-lane r4: a command past the scan ceiling is refused, not half-scanned", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "t15-scan-cap-"));
    const wiki = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wiki, { recursive: true });
    fs.symlinkSync(wiki, path.join(repo, "wiki alias"));
    const hit = (c: string): string | null => bashWikiPath(c, (t) => resolvesUnderWiki([wiki], t, repo));
    const padded = `node -e "${"/*''*/".repeat(1500)}require('fs').writeFileSync('wiki alias/bypass.md','x')"`;
    expect(hit(padded)).not.toBeNull();
    // CONTROL: a large command with no wiki path under the ceiling still passes.
    expect(hit(`echo ${"a ".repeat(200)}`)).toBeNull();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("G-lane r5: a backslash is part of a POSIX name, so ..\\x.md stays inside the wiki", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "t15-backslash-"));
    const wiki = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wiki, { recursive: true });
    expect(resolvesUnderWiki([wiki], path.join(".guild", "wiki", "..\\bypass.md"), repo)).toBe(true);
    // CONTROL: a real climb out of the wiki is still outside it.
    expect(resolvesUnderWiki([wiki], path.join(".guild", "wiki", "..", "outside.md"), repo)).toBe(false);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("G-lane r6: a literal ~ that is a repo symlink to the wiki is refused", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "t15-tilde-"));
    const wiki = path.join(repo, ".guild", "wiki");
    fs.mkdirSync(wiki, { recursive: true });
    fs.symlinkSync(wiki, path.join(repo, "~"));
    const hit = (c: string): string | null => bashWikiPath(c, (t) => resolvesUnderWiki([wiki], t, repo));
    expect(hit("printf x > '~/bypass.md'")).not.toBeNull();
    // CONTROL: ~ under a repo with no such link resolves to HOME, not the wiki.
    fs.unlinkSync(path.join(repo, "~"));
    expect(hit("printf x > '~/bypass.md'")).toBeNull();
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
