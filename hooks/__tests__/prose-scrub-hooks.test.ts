/**
 * hooks/__tests__/prose-scrub-hooks.test.ts
 *
 * #108 / D2 on the real compiled hooks: PreToolUse refuses a prose Write/Edit that
 * carries a credential shape (naming the span); PostToolUse never rewrites prose,
 * and restores the prior bytes when a credential reached disk past PreToolUse.
 * Each refusal sits beside a planted clean control.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { mintTestBinding } from "../test-support/mint-binding";
import { hermeticEnv } from "../test-support/hermetic-env";

const PRE = path.resolve(__dirname, "../dist/pre-tool-use.js");
const POST = path.resolve(__dirname, "../dist/post-tool-use.js");
const RUN = "run-prose-hooks";
const SESSION = "prose-hooks-session";

const PROBE = [
  "1 path: app/Http/Middleware/EnforceSessionMaxDuration.php",
  "2 bare: PollExternalWebhookJournalJobTest",
  "3 short: ApiPerformanceMonitor",
  "4 header: Authorization: Bearer abc123",
  "5 home: ~/.claude/settings.json",
  "6 safe: config/queue.php",
  "7 hash: 816654c",
  "",
].join("\n");

// Assembled in pieces so this fixture never carries a scannable secret.
const GHP = `ghp_${"A1b2".repeat(9)}`;

let tmp: string;
let runDir: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-prose-hooks-")));
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  runDir = path.join(tmp, ".guild", "runs", RUN);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(tmp, ".guild", "runs", "current-run-id"), RUN, "utf8");
  mintTestBinding(tmp, RUN);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function env(): NodeJS.ProcessEnv {
  return { ...hermeticEnv(), GUILD_CWD: tmp, GUILD_RUN_ID: RUN, GUILD_RUN_BINDING_REF: `rb-test-${RUN}` };
}

type Tool = "Write" | "Edit" | "MultiEdit";

function pre(tool: Tool, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): { decision?: string; reason?: string } {
  const r = spawnSync(process.execPath, [PRE], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: toolInput, session_id: SESSION, cwd: tmp, ...extra }),
    encoding: "utf8",
    env: { ...env(), GUILD_CWD: typeof extra["cwd"] === "string" ? extra["cwd"] : tmp },
    timeout: 30000,
  });
  for (const line of (r.stdout ?? "").split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const h = JSON.parse(line).hookSpecificOutput;
      if (h?.permissionDecision) return { decision: h.permissionDecision, reason: h.permissionDecisionReason };
    } catch {
      /* not this line */
    }
  }
  return {};
}

function post(tool: Tool, toolInput: Record<string, unknown>, extra: Record<string, unknown> = {}): { exit: number; stdout: string } {
  const r = spawnSync(process.execPath, [POST], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: tool,
      tool_input: toolInput,
      tool_response: { success: true },
      session_id: SESSION,
      cwd: tmp,
      ...extra,
    }),
    encoding: "utf8",
    env: env(),
    timeout: 30000,
  });
  return { exit: r.status ?? 1, stdout: r.stdout ?? "" };
}

function events(): Array<Record<string, unknown>> {
  const f = path.join(runDir, "logs", "security-events.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function wikiPage(name: string): string {
  const p = path.join(tmp, ".guild", "wiki", name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return p;
}

describe("#108 prose surfaces through the real hooks", () => {
  it("the issue's 7-line probe survives an Edit byte-identical", () => {
    const page = wikiPage("probe.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const input = { file_path: page, old_string: "7 hash: 816654c\n", new_string: "7 hash: 816654c\n8 added: line\n" };

    expect(pre("Edit", input).decision).not.toBe("deny");
    const expected = PROBE + "8 added: line\n";
    fs.writeFileSync(page, expected, "utf8"); // the tool applies the edit
    expect(post("Edit", input).exit).toBe(0);

    expect(fs.readFileSync(page, "utf8")).toBe(expected);
    expect(fs.existsSync(page + ".quarantined")).toBe(false);
  });

  it("PreToolUse refuses a wiki Write carrying a credential and names the span; the clean control is allowed", () => {
    const page = wikiPage("leak.md");
    const denied = pre("Write", { file_path: page, content: `# Page\n\nUse ${GHP} here.\n` });
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("line 3, column 5");
    expect(denied.reason).toContain("GitHub personal access token");
    expect(denied.reason).not.toContain(GHP);
    expect(events().some((e) => e["event_type"] === "secret_scrub_blocked" && e["decision"] === "deny")).toBe(true);

    expect(pre("Write", { file_path: page, content: PROBE }).decision).not.toBe("deny");
  });

  it("PreToolUse refuses an Edit whose result would carry a credential", () => {
    const page = wikiPage("edit.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const denied = pre("Edit", { file_path: page, old_string: "6 safe", new_string: `6 ${GHP}` });
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("line 6, column 3");
  });

  it("PostToolUse restores the prior bytes when a credential reached disk past PreToolUse", () => {
    const page = wikiPage("restore.md");
    fs.writeFileSync(page, PROBE, "utf8");
    // PreToolUse cannot predict this Edit (old_string absent at Pre time), so it
    // snapshots and allows; the file then changes underneath before the tool runs.
    const input = { file_path: page, old_string: "not-present-yet", new_string: `leak ${GHP}` };
    expect(pre("Edit", input).decision).not.toBe("deny");
    fs.writeFileSync(page, `${PROBE}leak ${GHP}\n`, "utf8");

    const r = post("Edit", input);
    expect(r.exit).toBe(0);
    expect(fs.readFileSync(page, "utf8")).toBe(PROBE);
    expect(r.stdout).toContain("line 8, column 6");
    expect(r.stdout).not.toContain(GHP);
    const blocked = events().find((e) => e["event_type"] === "secret_scrub_blocked" && e["decision"] === "blocked");
    expect(blocked).toBeDefined();
    expect(String(blocked!["detail"])).toContain("restored");
  });

  it("PostToolUse removes a new prose file whose prior state was absent", () => {
    const page = wikiPage("fresh.md");
    const input = { file_path: page, old_string: "x", new_string: "y" };
    pre("Edit", input); // Edit on a missing file: content unknowable, prior = absent
    fs.writeFileSync(page, `leak ${GHP}\n`, "utf8");
    post("Edit", input);
    expect(fs.existsSync(page)).toBe(false);
  });

  it("without a PreToolUse snapshot PostToolUse reports and leaves the file untouched (never rewrites)", () => {
    const page = wikiPage("nosnap.md");
    const content = `leak ${GHP}\n`;
    fs.writeFileSync(page, content, "utf8");
    const r = post("Write", { file_path: page, content });
    expect(r.exit).toBe(0);
    expect(fs.readFileSync(page, "utf8")).toBe(content);
    expect(fs.existsSync(page + ".quarantined")).toBe(false);
    expect(r.stdout).toContain("line 1, column 6");
    expect(events().some((e) => e["event_type"] === "secret_scrub_blocked" && String(e["detail"]).includes("not restored"))).toBe(true);
  });

  it("MultiEdit is gated: a credential in any edit is denied; one past PreToolUse is undone", () => {
    const page = wikiPage("multi.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const leaky = { file_path: page, edits: [{ old_string: "6 safe", new_string: "6 fine" }, { old_string: "7 hash", new_string: `7 ${GHP}` }] };
    const denied = pre("MultiEdit", leaky);
    expect(denied.decision).toBe("deny");
    expect(denied.reason).toContain("line 7, column 3");
    // CONTROL: a clean MultiEdit is allowed.
    expect(pre("MultiEdit", { file_path: page, edits: [{ old_string: "6 safe", new_string: "6 fine" }] }).decision).not.toBe("deny");

    const blind = { file_path: page, edits: [{ old_string: "not-present-yet", new_string: GHP }] };
    expect(pre("MultiEdit", blind, { tool_use_id: "toolu_multi" }).decision).not.toBe("deny");
    fs.writeFileSync(page, `${PROBE}${GHP}\n`, "utf8");
    post("MultiEdit", blind, { tool_use_id: "toolu_multi" });
    expect(fs.readFileSync(page, "utf8")).toBe(PROBE);
  });

  it("a symlink outside .guild that points at a wiki page is gated like the page", () => {
    const page = wikiPage("linked.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const link = path.join(tmp, "notes-link.md");
    fs.symlinkSync(page, link);
    const denied = pre("Write", { file_path: link, content: `x ${GHP}\n` });
    expect(denied.decision).toBe("deny");
    // A dangling link to a page that does not exist yet is gated, and the undo
    // removes the page it created, not just the link.
    const target = path.join(tmp, ".guild", "wiki", "later.md");
    const dangling = path.join(tmp, "dangling.md");
    fs.symlinkSync(target, dangling);
    expect(pre("Write", { file_path: dangling, content: `x ${GHP}\n` }).decision).toBe("deny");
    fs.writeFileSync(dangling, `x ${GHP}\n`, "utf8"); // follows the link, creates the page
    post("Write", { file_path: dangling, content: `x ${GHP}\n` }, { tool_response: { type: "create", originalFile: null } });
    expect(fs.existsSync(target)).toBe(false);
    // CONTROL: a plain file outside .guild is not a prose surface.
    const plain = path.join(tmp, "plain.md");
    expect(pre("Write", { file_path: plain, content: `x ${GHP}\n` }).reason ?? "").not.toContain("prose write");
  });

  it("with no snapshot PostToolUse restores the host-reported originalFile", () => {
    const page = wikiPage("host-original.md");
    fs.writeFileSync(page, `${PROBE}leak ${GHP}\n`, "utf8");
    const input = { file_path: page, content: `${PROBE}leak ${GHP}\n` };
    post("Write", input, { tool_response: { type: "update", filePath: page, originalFile: PROBE } });
    expect(fs.readFileSync(page, "utf8")).toBe(PROBE);

    const created = wikiPage("host-created.md");
    fs.writeFileSync(created, `leak ${GHP}\n`, "utf8");
    post("Write", { file_path: created, content: `leak ${GHP}\n` }, { tool_response: { type: "create", filePath: created, originalFile: null } });
    expect(fs.existsSync(created)).toBe(false);
  });

  it("overlapping writes keep separate snapshots, and a prior that carries a credential is never restored", () => {
    const page = wikiPage("overlap.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const first = { file_path: page, old_string: "absent-1", new_string: GHP };
    const second = { file_path: page, old_string: "absent-2", new_string: "y" };
    pre("Edit", first, { tool_use_id: "toolu_1" });
    fs.writeFileSync(page, `${PROBE}${GHP}\n`, "utf8"); // call 1 leaks
    pre("Edit", second, { tool_use_id: "toolu_2" }); // call 2 snapshots the leaked bytes
    post("Edit", first, { tool_use_id: "toolu_1" });
    expect(fs.readFileSync(page, "utf8")).toBe(PROBE);

    // The leaked snapshot of call 2 is not "restored" as if it were clean.
    fs.writeFileSync(page, `${PROBE}${GHP}\n`, "utf8");
    const r = post("Edit", second, { tool_use_id: "toolu_2" });
    expect(r.stdout).toContain("it also carries a credential");
    expect(fs.readFileSync(page, "utf8")).toBe(`${PROBE}${GHP}\n`);
  });

  it("a relative path is resolved against the tool's cwd, not the Guild root", () => {
    const page = wikiPage("rel.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const sub = path.join(tmp, "sub");
    fs.mkdirSync(sub);
    const denied = pre("Write", { file_path: "../.guild/wiki/rel.md", content: `x ${GHP}\n` }, { cwd: sub });
    expect(denied.decision).toBe("deny");
    // CONTROL: the clean write through the same relative path is allowed.
    expect(pre("Write", { file_path: "../.guild/wiki/rel.md", content: PROBE }, { cwd: sub }).decision).not.toBe("deny");
  });

  it("run-root share-set Markdown (summary.md, verify.md, review.md) is gated; run.yaml is not prose", () => {
    for (const name of ["summary.md", "verify.md", "review.md"]) {
      expect(pre("Write", { file_path: path.join(runDir, name), content: `x ${GHP}\n` }).decision).toBe("deny");
      expect(pre("Write", { file_path: path.join(runDir, name), content: PROBE }).decision).not.toBe("deny");
    }
    expect(pre("Write", { file_path: path.join(runDir, "quality", "summary.md"), content: `x ${GHP}\n` }).decision).toBe("deny");
    expect(pre("Write", { file_path: path.join(runDir, "run.yaml"), content: `x ${GHP}\n` }).reason ?? "").not.toContain("prose write");
  });

  it("a late PostToolUse never undoes a different call's write", () => {
    const page = wikiPage("late.md");
    fs.writeFileSync(page, PROBE, "utf8");
    const clean = `${PROBE}clean edit\n`;
    const leak = `${clean}${GHP}\n`;
    // Call 1 writes clean bytes; call 2 then leaks before call 1's PostToolUse runs.
    fs.writeFileSync(page, leak, "utf8");
    const r1 = post("Write", { file_path: page, content: clean }, { tool_response: { type: "update", originalFile: PROBE } });
    expect(r1.stdout).toContain("another write changed the file");
    expect(fs.readFileSync(page, "utf8")).toBe(leak);
    // Call 2's own PostToolUse restores call 1's clean result.
    post("Write", { file_path: page, content: leak }, { tool_response: { type: "update", originalFile: clean } });
    expect(fs.readFileSync(page, "utf8")).toBe(clean);
  });

  it("review and handoff markdown get the same refusal; a non-prose path is not gated", () => {
    const review = path.join(runDir, "review", "review.md");
    const handoff = path.join(runDir, "handoffs", "backend-T1.md");
    expect(pre("Write", { file_path: review, content: `x ${GHP}\n` }).decision).toBe("deny");
    expect(pre("Write", { file_path: handoff, content: `x ${GHP}\n` }).decision).toBe("deny");
    const other = path.join(tmp, ".guild", "knowledge", "candidates", "c.md");
    expect(pre("Write", { file_path: other, content: `x ${GHP}\n` }).reason ?? "").not.toContain("prose write");
  });
});
