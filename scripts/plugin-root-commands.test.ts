/**
 * #289: command/skill markdown must resolve the installed plugin root with no
 * user-set env var, and every `Skill: guild:<id>` a command dispatches must be a
 * shipped skill (a SKILL.md, not only SKILL.src.md).
 *
 * Claude Code substitutes the exact token `${CLAUDE_PLUGIN_ROOT}` in command and
 * skill text (it does not touch `${CLAUDE_PLUGIN_ROOT:-...}`), and does not export
 * the variable to the Bash tool, so the exact token must appear in the text.
 */
import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe("dispatched skills ship a SKILL.md", () => {
  const dispatched = new Set<string>();
  for (const f of fs.readdirSync(path.join(ROOT, "commands"))) {
    const text = fs.readFileSync(path.join(ROOT, "commands", f), "utf8");
    for (const m of text.matchAll(/^Skill: guild:([a-z0-9-]+)/gm)) dispatched.add(m[1]);
  }
  const skillDirs = walk(path.join(ROOT, "skills"))
    .filter((p) => p.endsWith("SKILL.md") || p.endsWith("SKILL.src.md"))
    .map((p) => p.replace(/\/SKILL(\.src)?\.md$/, ""));

  it("finds the dispatch targets", () => {
    expect(dispatched.has("using-guild")).toBe(true);
  });

  for (const id of dispatched) {
    it(`guild:${id} resolves to a SKILL.md`, () => {
      const dir = skillDirs.find((d) => path.basename(d) === id);
      expect(dir).toBeDefined();
      expect(fs.existsSync(path.join(dir!, "SKILL.md"))).toBe(true);
    });
  }

  it("using-guild SKILL.md is byte-identical to the SKILL.src.md the bootstrap hook injects", () => {
    const dir = path.join(ROOT, "skills", "meta", "using-guild");
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(
      fs.readFileSync(path.join(dir, "SKILL.src.md"), "utf8"),
    );
  });
});

describe("plugin-root shell lines", () => {
  const files = [...walk(path.join(ROOT, "commands")), ...walk(path.join(ROOT, "skills"))].filter((p) =>
    p.endsWith(".md"),
  );

  it("never hide the substitutable token behind a default (${CLAUDE_PLUGIN_ROOT:-...})", () => {
    const bad = files.filter((f) => fs.readFileSync(f, "utf8").includes("${CLAUDE_PLUGIN_ROOT:-"));
    expect(bad.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  function runClassifyLine(substituteRoot: string | null, env: Record<string, string>): string {
    const line = fs
      .readFileSync(path.join(ROOT, "commands", "guild.md"), "utf8")
      .split("\n")
      .find((l) => l.includes("classify-intake.js"))!;
    let cmd = line;
    if (substituteRoot !== null) cmd = cmd.replaceAll("${CLAUDE_PLUGIN_ROOT}", substituteRoot);
    const r = spawnSync("bash", ["-c", cmd], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ARGUMENTS: "x", ...env },
    });
    return (r.stdout ?? "").trim() + (r.stderr ?? "").trim();
  }

  function fakeRoot(tag: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `guild-root-${tag}-`));
    fs.mkdirSync(path.join(root, "runtime", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "runtime", "scripts", "classify-intake.js"), `console.log("ROOT:${tag}")`);
    return root;
  }

  it("resolves the host-substituted root with no env var and a HOME that has no dist", () => {
    const root = fakeRoot("subst");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home-"));
    expect(runClassifyLine(root, { HOME: home })).toBe("ROOT:subst");
  });

  it("an explicit GUILD_PLUGIN_ROOT still wins", () => {
    const sub = fakeRoot("subst2");
    const explicit = fakeRoot("explicit");
    expect(runClassifyLine(sub, { HOME: os.tmpdir(), GUILD_PLUGIN_ROOT: explicit })).toBe("ROOT:explicit");
  });

  it("without substitution (other hosts) falls back to CLAUDE_PLUGIN_ROOT, then the install.sh dist", () => {
    const viaEnv = fakeRoot("env");
    expect(runClassifyLine(null, { HOME: os.tmpdir(), CLAUDE_PLUGIN_ROOT: viaEnv })).toBe("ROOT:env");
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "guild-home2-"));
    const dist = path.join(home, ".local", "share", "guild", "dist", "claude-code");
    fs.mkdirSync(path.join(dist, "runtime", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dist, "runtime", "scripts", "classify-intake.js"), `console.log("ROOT:dist")`);
    expect(runClassifyLine(null, { HOME: home })).toBe("ROOT:dist");
  });
});
