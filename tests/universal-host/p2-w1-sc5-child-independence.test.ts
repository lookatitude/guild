/**
 * tests/universal-host/p2-w1-sc5-child-independence.test.ts
 *
 * SC-W1-5 (AC34) — AUTHORITATIVE child-independence test over a REAL fixture workspace
 * with three child GIT repos. Drives the SHIPPED detect→write pipeline (LW1-4) and proves:
 *   (a) `git status --porcelain` is BYTE-IDENTICAL before/after in EVERY child repo;
 *   (b) a filesystem allowlist — the set of files under each child — is identical
 *       before/after (no write lands anywhere under a child, not only under .guild/);
 *   (c) the only new artifact is the root-side reference index under <root>/.guild/;
 *   (d) a SYMLINK under <root>/.guild/ escaping into a child repo is REJECTED (the write
 *       guard resolves symlinks — codex round-2 fix), so no child write can sneak through.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  detectImpactFromWorkspace,
  writeReferenceIndex,
} from "../../scripts/lib/workspace-impact-detector";
import type { DependencyGraphV1 } from "../../scripts/lib/dependency-graph-schema";

const GRAPH: DependencyGraphV1 = {
  schema_version: "guild.dependency_graph.v1",
  nodes: [
    { id: "plugin", path: "plugin" },
    { id: "website", path: "website" },
    { id: "benchmark", path: "benchmark" },
  ],
  edges: [
    { from: "website", to: "plugin" },
    { from: "benchmark", to: "website" },
  ],
};

const CHILDREN = ["plugin", "website", "benchmark"];

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/** Recursive sorted list of files under a dir (the fs allowlist snapshot). */
function fileList(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return out.sort();
}

function mkWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-sc5-"));
  const wsDir = path.join(root, ".guild", "workspace");
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, "dependency-graph.json"), JSON.stringify(GRAPH, null, 2));
  for (const c of CHILDREN) {
    const cdir = path.join(root, c);
    fs.mkdirSync(cdir, { recursive: true });
    fs.writeFileSync(path.join(cdir, "README.md"), `# ${c}\n`);
    git(cdir, ["init", "-q"]);
    git(cdir, ["add", "-A"]);
    git(cdir, ["commit", "-q", "-m", "init"]);
  }
  return root;
}

describe("SC-W1-5 — child independence (git + fs)", () => {
  let root: string;
  beforeAll(() => {
    root = mkWorkspace();
  });
  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the detect→write pipeline leaves every child git status byte-identical and writes only root-side", () => {
    const porcelainBefore = CHILDREN.map((c) => git(path.join(root, c), ["status", "--porcelain"]));
    const filesBefore = CHILDREN.map((c) => fileList(path.join(root, c)));

    const res = detectImpactFromWorkspace(root, ["plugin"]);
    expect(res.valid).toBe(true);
    const w = writeReferenceIndex(root, res.impact!);
    expect(w.written).toBe(true);
    expect(w.path!.startsWith(path.join(root, ".guild") + path.sep)).toBe(true);

    // (a) git porcelain byte-identical in every child
    const porcelainAfter = CHILDREN.map((c) => git(path.join(root, c), ["status", "--porcelain"]));
    expect(porcelainAfter).toEqual(porcelainBefore);
    porcelainAfter.forEach((p) => expect(p).toBe("")); // each child was, and stays, clean

    // (b) fs allowlist identical in every child
    const filesAfter = CHILDREN.map((c) => fileList(path.join(root, c)));
    expect(filesAfter).toEqual(filesBefore);

    // (c) the index landed under <root>/.guild/
    expect(fs.existsSync(path.join(root, ".guild", "workspace", "impact-index.json"))).toBe(true);
  });

  it("a symlink under <root>/.guild/ escaping into a child repo is REJECTED (no child write)", () => {
    // The target child dir must EXIST so the symlink resolves into the child (a dangling
    // symlink is a different, weaker case). This is the real attack: a live dir symlink.
    const childGuild = path.join(root, "plugin", ".guild");
    fs.mkdirSync(childGuild, { recursive: true });
    const escape = path.join(root, ".guild", "escape");
    fs.symlinkSync(childGuild, escape);
    const filesBefore = fileList(path.join(root, "plugin"));

    const res = detectImpactFromWorkspace(root, ["plugin"]);
    const w = writeReferenceIndex(root, res.impact!, ".guild/escape/leak.json");
    expect(w.written).toBe(false);
    expect(w.error).toMatch(/child-independence|AC34/i);

    // No file leaked into the child through the symlink.
    expect(fileList(path.join(root, "plugin"))).toEqual(filesBefore);
    expect(git(path.join(root, "plugin"), ["status", "--porcelain"])).toBe("");
  });
});
