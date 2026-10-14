/**
 * #219 — re-running the stage-1 scan on an unchanged, committed repo must not
 * rewrite codebase-map.json just because HEAD moved (e.g. the commit that
 * recorded the first init). A real source change still rewrites it.
 */
import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync, execFileSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCAN = path.resolve(__dirname, "scan.ts");
let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" }).trim();
const scan = () => {
  const r = spawnSync("npx", ["tsx", SCAN, "--cwd", repo], { encoding: "utf8", timeout: 60000 });
  expect(r.status).toBe(0);
};
const mapFile = () => path.join(repo, ".guild", "indexes", "codebase-map.json");

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "scan-idem-"));
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "src/sum.js"), "exports.sum = (a, b) => a + b\n");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "seed");
});

afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

test("second scan after committing the first map leaves the map byte-identical", () => {
  scan();
  const first = fs.readFileSync(mapFile(), "utf8");
  git("add", "-A");
  git("commit", "-qm", "guild-init-1");
  scan();
  expect(fs.readFileSync(mapFile(), "utf8")).toBe(first);
});

test("control: a real source change rewrites the map at the new HEAD", () => {
  fs.writeFileSync(path.join(repo, "src/mul.js"), "exports.mul = (a, b) => a * b\n");
  git("add", "-A");
  git("commit", "-qm", "add mul");
  scan();
  const cm = JSON.parse(fs.readFileSync(mapFile(), "utf8"));
  expect(cm.generated_from_commit).toBe(git("rev-parse", "HEAD"));
  expect(cm.files.map((f: { path: string }) => f.path)).toContain("src/mul.js");
});
