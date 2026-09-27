/**
 * hooks/__tests__/session-start-bootstrap.test.ts
 *
 * R48 / R47 (KTD31): a new session on a Guild root always bootstraps Guild —
 * layout bootstrap, surface projection, prompt compose with the model-family
 * dialect, run binding — and a missing plugin or compile output fails closed.
 * Drives `bootstrapSession`, the function the SessionStart hook runs.
 */
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

import { bootstrapSession, REQUIRED_COMPILE_OUTPUTS } from "../using-guild-bootstrap";
import { approxTokens, readSessionBinding } from "../../src/domains/config";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");

function guildRoot(tag: string, runId?: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `guild-r48-${tag}-`)));
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  if (runId) {
    fs.mkdirSync(path.join(root, ".guild", "runs", runId), { recursive: true });
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), `${runId}\n`);
  }
  return root;
}

/** A plugin root with the using-guild source and the compile outputs, minus `drop`. */
function pluginRoot(drop: string | null): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-r48-plugin-"));
  const src = path.join("skills", "meta", "using-guild", "SKILL.src.md");
  fs.mkdirSync(path.join(root, path.dirname(src)), { recursive: true });
  fs.copyFileSync(path.join(PLUGIN_ROOT, src), path.join(root, src));
  for (const rel of REQUIRED_COMPILE_OUTPUTS) {
    if (rel === drop) continue;
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "// compiled\n");
  }
  return root;
}

describe("R48 SessionStart on a Guild root always projects Guild", () => {
  it("R48 · SessionStart on a Guild root bootstraps layout, projects the surface, composes, and binds the run", () => {
    const runId = "run-r48-bind";
    const root = guildRoot("bind", runId);
    const out = bootstrapSession({ cwd: root, env: { CODEX_HOME: "/x" }, pluginRoot: PLUGIN_ROOT });
    expect(out.kind).toBe("inject");
    if (out.kind !== "inject") return;
    expect(out.context).toContain("# using-guild");
    expect(out.context).toContain("Guild dialect: openai model family");
    // Codex rungs are inferred, so the projection states what degrades.
    expect(out.context).toContain("Guild on codex: dispatch lead_only");
    const binding = readSessionBinding(path.join(root, ".guild", "runs", runId));
    expect(binding).toMatchObject({
      host_family: "codex",
      model_family: "openai",
      prompt_compose: { dialect_id: "dialect:openai" },
    });
    expect(binding!.prompt_compose.hash).toMatch(/^[0-9a-f]{64}$/);
    // The layout bootstrap ran: the root carries the layout marker now.
    expect(fs.existsSync(path.join(root, ".guild", "storage-layout.json"))).toBe(true);
  });

  it("R48 · plugin missing or compile outputs missing on a Guild root fails closed", () => {
    const root = guildRoot("missing");
    const none = bootstrapSession({ cwd: root, env: { CLAUDECODE: "1" }, pluginRoot: null });
    expect(none).toMatchObject({ kind: "fail_closed", exitCode: 2 });
    for (const rel of REQUIRED_COMPILE_OUTPUTS) {
      const out = bootstrapSession({ cwd: root, env: { CLAUDECODE: "1" }, pluginRoot: pluginRoot(rel) });
      expect(out.kind).toBe("fail_closed");
      if (out.kind === "fail_closed") {
        expect(out.reason).toContain(rel);
        expect(out.context).toContain("Do not continue as a non-Guild session");
      }
    }
    // The same root with every output present bootstraps.
    expect(bootstrapSession({ cwd: root, env: { CLAUDECODE: "1" }, pluginRoot: pluginRoot(null) }).kind).toBe("inject");
  });

  it("R48 · a layout newer than this build fails closed instead of starting a vanilla session", () => {
    const root = guildRoot("future");
    fs.writeFileSync(
      path.join(root, ".guild", "storage-layout.json"),
      JSON.stringify({ storage_layout_version: 999 }),
    );
    const out = bootstrapSession({ cwd: root, env: { CLAUDECODE: "1" }, pluginRoot: PLUGIN_ROOT });
    expect(out).toMatchObject({ kind: "fail_closed", exitCode: 2 });
  });

  it("R48 · off a Guild root the gateway is offered without binding anything", () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r48-plain-")));
    fs.mkdirSync(path.join(dir, ".git"));
    const out = bootstrapSession({ cwd: dir, env: { CLAUDECODE: "1" }, pluginRoot: PLUGIN_ROOT });
    expect(out.kind).toBe("inject");
    expect(fs.existsSync(path.join(dir, ".guild"))).toBe(false);
  });
});

describe("R48 a throwing bootstrap step on a Guild root fails closed", () => {
  const DIST_JS = path.join(PLUGIN_ROOT, "hooks", "dist", "using-guild-bootstrap.js");

  /** A Guild root whose active run path is a regular file: bindSession's mkdir throws EEXIST. */
  function runPathIsAFile(): string {
    const root = guildRoot("runfile");
    fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "run-file\n");
    fs.writeFileSync(path.join(root, ".guild", "runs", "run-file"), "not a directory\n");
    return root;
  }

  /** The lane env carries GUILD_RUN_ID / GUILD_RUN_DIR; strip them so the sentinel decides. */
  function hookEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, GUILD_PLUGIN_ROOT: PLUGIN_ROOT };
    delete env["GUILD_RUN_ID"];
    delete env["GUILD_RUN_DIR"];
    return env;
  }

  function spawnHook(bundle: string, cwd: string) {
    return spawnSync("node", [bundle], { input: JSON.stringify({ cwd }), encoding: "utf8", env: hookEnv() });
  }

  it("R48 · the run path being a regular file fails closed with the cause, not an empty stdout", () => {
    const saved = process.env["GUILD_RUN_ID"];
    delete process.env["GUILD_RUN_ID"];
    try {
      const out = bootstrapSession({ cwd: runPathIsAFile(), env: { CLAUDECODE: "1" }, pluginRoot: PLUGIN_ROOT });
      expect(out).toMatchObject({ kind: "fail_closed", exitCode: 2 });
      if (out.kind === "fail_closed") expect(out.reason).toContain("EEXIST");
    } finally {
      if (saved !== undefined) process.env["GUILD_RUN_ID"] = saved;
    }

    const res = spawnHook(DIST_JS, runPathIsAFile());
    expect(res.status).toBe(2);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
    expect(res.stderr).toContain("FAIL CLOSED: bootstrap error: EEXIST");
    const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext as string;
    expect(ctx).toContain("GUILD FAILED CLOSED");
    expect(ctx).toContain("EEXIST");
  });

  it("CONTROL: the old swallow restored in a copied bundle leaves stdout empty and exit 0 (red)", () => {
    const src = fs.readFileSync(DIST_JS, "utf8");
    const guard = "return failClosed(`bootstrap error: ${err instanceof Error ? err.message : String(err)}`);";
    const topLevel = "if (!onGuildRoot) process.exit(0);";
    expect(src).toContain(guard);
    expect(src).toContain(topLevel);
    const planted = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-r48-swallow-")), "planted.js");
    fs.writeFileSync(planted, src.replace(guard, "throw err;").replace(topLevel, "process.exit(0);"));
    const res = spawnHook(planted, runPathIsAFile());
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("FATAL: EEXIST");
  });
});

describe("KTD28 every rung loss the Codex bootstrap reports lands on the run", () => {
  const DIST_JS = path.join(PLUGIN_ROOT, "hooks", "dist", "using-guild-bootstrap.js");
  const RUNG_NAMES = ["spawn", "tool_projection", "hooks", "skills", "commands", "mcp", "compaction"];

  function lossLines(root: string, runId: string): Array<{ attempted: string }> {
    const log = path.join(root, ".guild", "runs", runId, "logs", "v1.4-events.jsonl");
    if (!fs.existsSync(log)) return [];
    return fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.schema_version === "guild.trace.degradation.v1" && e.surface === "host-capability");
  }

  function withoutRunEnv<T>(fn: () => T): T {
    const saved = { id: process.env["GUILD_RUN_ID"], dir: process.env["GUILD_RUN_DIR"] };
    delete process.env["GUILD_RUN_ID"];
    delete process.env["GUILD_RUN_DIR"];
    try {
      return fn();
    } finally {
      if (saved.id !== undefined) process.env["GUILD_RUN_ID"] = saved.id;
      if (saved.dir !== undefined) process.env["GUILD_RUN_DIR"] = saved.dir;
    }
  }

  /** A Codex session: no Claude signal, only CODEX_HOME. */
  function spawnCodex(bundle: string, cwd: string) {
    return spawnSync("node", [bundle], {
      input: JSON.stringify({ cwd }),
      encoding: "utf8",
      env: { PATH: process.env["PATH"], HOME: process.env["HOME"], CODEX_HOME: "/x", GUILD_PLUGIN_ROOT: PLUGIN_ROOT },
    });
  }

  it("KTD28 · a Codex bootstrap on a run writes seven loss records, one per rung", () => {
    const runId = "run-codex-losses";
    const root = guildRoot("losses", runId);
    const out = withoutRunEnv(() => bootstrapSession({ cwd: root, env: { CODEX_HOME: "/x" }, pluginRoot: PLUGIN_ROOT }));
    expect(out.kind).toBe("inject");
    const lines = lossLines(root, runId);
    expect(lines).toHaveLength(7);
    expect(lines.map((l) => l.attempted.split(":")[0]).sort()).toEqual([...RUNG_NAMES].sort());
    if (out.kind === "inject") expect(out.context).not.toContain("could NOT record");
  });

  it("KTD28 · an unwritable event log is said in the context, never claimed as recorded", () => {
    const runId = "run-codex-unwritable";
    const root = guildRoot("unwritable", runId);
    fs.writeFileSync(path.join(root, ".guild", "runs", runId, "logs"), "not a directory\n");
    const out = withoutRunEnv(() => bootstrapSession({ cwd: root, env: { CODEX_HOME: "/x" }, pluginRoot: PLUGIN_ROOT }));
    expect(out.kind).toBe("inject");
    if (out.kind === "inject") {
      expect(out.context).toContain(`Guild could NOT record 7 of 7 rung losses on run ${runId}`);
      expect(out.context).toContain("isolated spawn is refused");
    }
  });

  it("KTD28 · the compiled hook records the seven losses; CONTROL: the recording removed from a copied bundle leaves none (red)", () => {
    const runId = "run-codex-bundle";
    const real = guildRoot("bundle", runId);
    expect(spawnCodex(DIST_JS, real).status).toBe(0);
    expect(lossLines(real, runId)).toHaveLength(7);

    const src = fs.readFileSync(DIST_JS, "utf8");
    const call = /else notes\.push\(\.\.\.recordProjectionLosses\([^;]*;/;
    expect(src).toMatch(call);
    const planted = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-ktd28-planted-")), "planted.js");
    fs.writeFileSync(planted, src.replace(call, ""));
    const bare = guildRoot("bundle-ctl", runId);
    expect(spawnCodex(planted, bare).status).toBe(0);
    expect(lossLines(bare, runId)).toHaveLength(0);
  });
});

describe("R47 the model-family dialect is composed at session bind", () => {
  it("R47 · the dialect composed at bind follows the model family, fits 200 tokens, and changes the bound hash", () => {
    const hashes: string[] = [];
    for (const [env, family, dialect] of [
      [{ CLAUDECODE: "1" }, "anthropic", "dialect:anthropic"],
      [{ CODEX_HOME: "/x" }, "openai", "dialect:openai"],
    ] as const) {
      const runId = `run-r47-${family}`;
      const root = guildRoot(`r47-${family}`, runId);
      const out = bootstrapSession({ cwd: root, env, pluginRoot: PLUGIN_ROOT });
      expect(out.kind).toBe("inject");
      const binding = readSessionBinding(path.join(root, ".guild", "runs", runId))!;
      expect(binding.model_family).toBe(family);
      expect(binding.prompt_compose.dialect_id).toBe(dialect);
      hashes.push(binding.prompt_compose.hash);
      const fragment = fs.readFileSync(
        path.join(PLUGIN_ROOT, "src", "surfaces", "prompts", "dialects", `${family}.md`),
        "utf8",
      );
      expect(approxTokens(fragment)).toBeLessThanOrEqual(200);
    }
    expect(new Set(hashes).size).toBe(2);
  });
});
