/**
 * scripts/__tests__/gitignore-policy.test.ts
 *
 * init-config-goal lane L3 (§E13 / V13) — the `.gitignore` managed-block policy.
 * Init/repair preserve existing user content, collapse prior managed blocks into one
 * canonical block, and add one anchored ignore line per detected child git repo.
 * Anti-vacuity (V13): removing any required ignore/include line fails the test — the
 * expected line list below is an INDEPENDENT oracle (not imported from the impl), so a
 * dropped line in the implementation cannot silently shrink the expectation.
 *
 * Exercises the REAL fs path (temp dirs + defaultInitGuildIO).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { updateGitignore, defaultInitGuildIO } from "../lib/init-guild";

const BEGIN = "# BEGIN Guild managed";
const END = "# END Guild managed";

// Independent oracle — the EXACT required managed lines in EXACT order (spec §.gitignore
// policy). Duplicated here on purpose: if the impl drops a line, the impl output loses it
// and these assertions fail (non-vacuous).
const REQUIRED_LINES: string[] = [
  ".guild",
  "!/.guild/",
  "!.guild/wiki/",
  "!.guild/wiki/**",
  "!.guild/initiatives/",
  "!.guild/initiatives/**",
  "!.guild/spec/",
  "!.guild/spec/**",
  "!.guild/plan/",
  "!.guild/plan/**",
  "!.guild/prd/",
  "!.guild/prd/**",
  "!.guild/team/",
  "!.guild/team/**",
  "!.guild/reflections/",
  "!.guild/reflections/**",
  "!.guild/evolve/",
  "!.guild/evolve/**",
  "!.guild/indexes/",
  "!.guild/indexes/**",
  "!.guild/workspace.json",
  "!.guild/settings.json",
  "!.guild/runs/",
  "!.guild/runs/*/",
  ".guild/runs/*/**",
  "!.guild/runs/*/handoffs/",
  "!.guild/runs/*/handoffs/**",
  "!.guild/runs/*/verify.md",
  "!.guild/runs/*/review.md",
  "!.guild/runs/*/provenance.json",
  "!.guild/runs/*/run.yaml",
  "!.guild/runs/*/summary.md",
  "!.guild/runs/*/share-payloads.flag",
  ".guild/settings.local.json",
  ".guild/hosts/",
  "**/*.structural-cache.json",
];

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-gi-"));
}
function giPath(root: string): string {
  return path.join(root, ".gitignore");
}
function read(root: string): string {
  return fs.readFileSync(giPath(root), "utf8");
}
/** Extract the lines strictly between the (single) BEGIN/END managed markers. */
function managedLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const b = lines.indexOf(BEGIN);
  const e = lines.indexOf(END);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(e).toBeGreaterThan(b);
  return lines.slice(b + 1, e);
}

describe("§E13 .gitignore policy (V13)", () => {
  const tmpDirs: string[] = [];
  afterAll(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  });
  function tmp(): string {
    const d = mkTmp();
    tmpDirs.push(d);
    return d;
  }

  it("creates a new .gitignore with the canonical managed block (LF + trailing newline)", () => {
    const root = tmp();
    const out = updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    expect(out.applied).toBe(true);
    const text = read(root);
    expect(text.includes("\r\n")).toBe(false); // LF
    expect(text.endsWith("\n")).toBe(true); // trailing newline
    // Anti-vacuity: the managed block equals EXACTLY the required lines, in order.
    expect(managedLines(text)).toEqual(REQUIRED_LINES);
    // Exactly one managed block.
    expect(text.split(BEGIN).length - 1).toBe(1);
    expect(text.split(END).length - 1).toBe(1);
  });

  it("anti-vacuity: EVERY required ignore/include line is present in the managed block", () => {
    const root = tmp();
    updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    const ml = managedLines(read(root));
    for (const required of REQUIRED_LINES) {
      expect(ml).toContain(required);
    }
    // Spot-check load-bearing share/local lines explicitly.
    expect(ml).toContain("!.guild/settings.json"); // shared
    expect(ml).toContain(".guild/settings.local.json"); // local-only re-ignore
    expect(ml).toContain("**/*.structural-cache.json"); // local-only derived cache
    expect(ml).toContain(".guild/hosts/"); // local-only
  });

  it("preserves existing user lines byte-for-byte and in order, before the managed block", () => {
    const root = tmp();
    fs.writeFileSync(giPath(root), "node_modules/\ndist/\n# my comment\ncustom.secret\n");
    updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    const text = read(root);
    const lines = text.split("\n");
    expect(lines.slice(0, 4)).toEqual(["node_modules/", "dist/", "# my comment", "custom.secret"]);
    expect(lines.indexOf("node_modules/")).toBeLessThan(lines.indexOf(BEGIN));
    expect(managedLines(text)).toEqual(REQUIRED_LINES);
  });

  it("is idempotent — a second init/repair makes no change", () => {
    const root = tmp();
    fs.writeFileSync(giPath(root), "node_modules/\n");
    updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    const after1 = read(root);
    const out2 = updateGitignore({ cwd: root, mode: "repair", childGitRepos: [], io: defaultInitGuildIO() });
    const after2 = read(root);
    expect(out2.applied).toBe(false);
    expect(after2).toBe(after1);
  });

  it("collapses MULTIPLE / partial managed blocks into one canonical block", () => {
    const root = tmp();
    // Two stale managed blocks, one with a missing line.
    fs.writeFileSync(
      giPath(root),
      [
        "node_modules/",
        BEGIN,
        ".guild",
        "!.guild/wiki/",
        END,
        "keepme/",
        BEGIN,
        ".guild/hosts/",
        END,
        "",
      ].join("\n")
    );
    updateGitignore({ cwd: root, mode: "repair", childGitRepos: [], io: defaultInitGuildIO() });
    const text = read(root);
    expect(text.split(BEGIN).length - 1).toBe(1); // exactly one block
    expect(managedLines(text)).toEqual(REQUIRED_LINES);
    // Non-Guild user lines survive.
    const lines = text.split("\n");
    expect(lines).toContain("node_modules/");
    expect(lines).toContain("keepme/");
  });

  it("first-adoption dedup: stray EXACT Guild policy lines in the body are removed (no dup)", () => {
    const root = tmp();
    fs.writeFileSync(giPath(root), [".guild", "!.guild/wiki/", "node_modules/", ""].join("\n"));
    updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    const text = read(root);
    // ".guild" must appear exactly once (inside the managed block only).
    expect(text.split("\n").filter((l) => l === ".guild").length).toBe(1);
    expect(text.split("\n").filter((l) => l === "!.guild/wiki/").length).toBe(1);
    expect(text.split("\n")).toContain("node_modules/");
  });

  it("workspace: adds one anchored ignore line per detected child git repo (preserve-if-present)", () => {
    const root = tmp();
    const children = [path.join(root, "plugin"), path.join(root, "website"), path.join(root, "benchmark")];
    const out = updateGitignore({ cwd: root, mode: "init", childGitRepos: children, io: defaultInitGuildIO() });
    expect(out.applied).toBe(true);
    const lines = read(root).split("\n");
    expect(lines).toContain("/plugin/");
    expect(lines).toContain("/website/");
    expect(lines).toContain("/benchmark/");
    // Re-run is idempotent (no duplicate child lines).
    updateGitignore({ cwd: root, mode: "repair", childGitRepos: children, io: defaultInitGuildIO() });
    const lines2 = read(root).split("\n");
    expect(lines2.filter((l) => l === "/plugin/").length).toBe(1);
  });

  it("preserves CRLF newline style", () => {
    const root = tmp();
    fs.writeFileSync(giPath(root), "node_modules/\r\ndist/\r\n");
    updateGitignore({ cwd: root, mode: "init", childGitRepos: [], io: defaultInitGuildIO() });
    const text = read(root);
    expect(text.includes("\r\n")).toBe(true);
    // No lone LF (every newline is CRLF).
    expect(/[^\r]\n/.test(text)).toBe(false);
    expect(managedLines(text)).toEqual(REQUIRED_LINES);
  });
});
