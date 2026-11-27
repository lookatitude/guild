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

  it("never quotes a path tail that needs shell expansion (braces, globs, ~) after the root", () => {
    const re = /printf %s "\$\{GUILD_PLUGIN_ROOT:-\$\{r:-[^}]*\}\}"\)([^\s`'")]*)/g;
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(re)) {
        if (/[{}*?~[\]]/.test(m[1])) offenders.push(`${path.relative(ROOT, f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** A `node` stub that records its argv, one per line, so the test sees exactly what node receives. */
  function stubBin(): { bin: string; argvFile: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-stub-"));
    const argvFile = path.join(dir, "argv.txt");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "node"), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${argvFile}"\n`, {
      mode: 0o755,
    });
    return { bin, argvFile };
  }

  function lineOf(file: string, needle: string): string {
    return fs
      .readFileSync(path.join(ROOT, file), "utf8")
      .split("\n")
      .find((l) => l.includes(needle))!
      .replace(/ \\$/, "");
  }

  /** Run a doc line under `shell`; `substituteRoot` mimics Claude Code's exact-token replacement. */
  function run(
    line: string,
    substituteRoot: string | null,
    env: Record<string, string>,
    shell = "bash",
  ): { argv: string[]; stderr: string } {
    const { bin, argvFile } = stubBin();
    const cmd = substituteRoot === null ? line : line.replaceAll("${CLAUDE_PLUGIN_ROOT}", () => substituteRoot);
    const r = spawnSync(shell, ["-c", cmd], {
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, ARGUMENTS: "x", ...env },
    });
    const argv = fs.existsSync(argvFile) ? fs.readFileSync(argvFile, "utf8").split("\n").slice(0, -1) : [];
    return { argv, stderr: r.stderr ?? "" };
  }

  const LINES: Array<[string, string, string]> = [
    ["commands/guild.md", "classify-intake.js", "runtime/scripts/classify-intake.js"],
    ["skills/meta/execute-plan/SKILL.md", "write-task-run.js", "runtime/scripts/write-task-run.js"],
  ];

  const sentinelDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "guild-sentinel-"));

  const shells = ["bash", ...(fs.existsSync("/bin/bash") && "/bin/bash" !== "bash" ? ["/bin/bash"] : [])];

  for (const shell of shells) {
    for (const [file, needle, rel] of LINES) {
      describe(`${file} under ${shell}`, () => {
        const line = lineOf(file, needle);

        it("passes node exactly one argv for a host-substituted root with spaces", () => {
          const root = "/opt/Guild Install";
          const { argv } = run(line, root, { HOME: os.tmpdir() }, shell);
          expect(argv[0]).toBe(`${root}/${rel}`);
        });

        const hostile = (s: string) => [
          ["$(...)", `/opt/$(touch ${s}/PWNED)/guild`],
          ["backticks", `/opt/\`touch ${s}/PWNED\`/guild`],
          ["$HOME", "/opt/$HOME/guild"],
          ["$VAR and ${VAR}", "/opt/$PATH/${HOME}/guild"],
          ["double quotes", '/opt/a"b/guild'],
          ["$$ (replace-pattern chars, literal)", "/opt/$$/guild"],
          ["$& (replace-pattern chars, literal)", "/opt/$&/guild"],
          ["semicolon and newline-free metachars", "/opt/a;b&c|d>e/guild"],
        ];

        for (const [label] of hostile("X")) {
          it(`never evaluates a substituted root containing ${label}`, () => {
            const s = sentinelDir();
            const root = hostile(s).find(([l]) => l === label)![1];
            const { argv } = run(line, root, { HOME: os.tmpdir() }, shell);
            expect(argv[0]).toBe(`${root}/${rel}`);
            expect(fs.existsSync(path.join(s, "PWNED"))).toBe(false);
          });
        }

        it("does not evaluate a hostile substituted root even when GUILD_PLUGIN_ROOT is set", () => {
          const s = sentinelDir();
          const { argv } = run(line, `/opt/$(touch ${s}/PWNED)/guild`, { HOME: os.tmpdir(), GUILD_PLUGIN_ROOT: "/g r" }, shell);
          expect(argv[0]).toBe(`/g r/${rel}`);
          expect(fs.existsSync(path.join(s, "PWNED"))).toBe(false);
        });

        it("non-substituting host: literal token falls back to the env var, taken verbatim", () => {
          const s = sentinelDir();
          const root = `/env/$(touch ${s}/PWNED)/a b`;
          const { argv } = run(line, null, { HOME: os.tmpdir(), CLAUDE_PLUGIN_ROOT: root }, shell);
          expect(argv[0]).toBe(`${root}/${rel}`);
          expect(fs.existsSync(path.join(s, "PWNED"))).toBe(false);
        });

        it("non-substituting host, no env: GUILD_PLUGIN_ROOT wins, then the install.sh dist", () => {
          expect(run(line, null, { HOME: os.tmpdir(), GUILD_PLUGIN_ROOT: "/g" }, shell).argv[0]).toBe(`/g/${rel}`);
          expect(run(line, null, { HOME: "/h" }, shell).argv[0]).toBe(`/h/.local/share/guild/dist/claude-code/${rel}`);
        });
      });
    }
  }
});
