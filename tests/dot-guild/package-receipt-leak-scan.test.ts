/**
 * tests/dot-guild/package-receipt-leak-scan.test.ts
 *
 * verified-multi-host-support L3 — the REAL AC-SEC-1 leak scan, proven NON-VACUOUS.
 *
 * ADR §7.2 L3 contract: "L3 ships a test that PLANTS a secret + an operator path in a
 * fixture receipt under evidence/host-smoke and asserts the scan FLAGS it (non-zero
 * exit) — not zero-matched." This drives the SHIPPED audit.ts CLI (the exact path CI
 * runs via dot-guild-policy.yml — no injected seam), against a temp git repo carrying
 * the REAL plugin/.gitignore so the git check-ignore file-selection is exercised.
 *
 * Anti-vacuity is closed three ways:
 *   1. a clean receipt tree → exit 0 (the scan is not always-firing),
 *   2. a planted operator-path + secret in a committed/admitted receipt → exit 1 with
 *      BOTH a receipt-operator-path AND a receipt-secret flag (the scan really flags),
 *   3. a planted secret in an IGNORED adjacent file → NOT flagged (the scan honours the
 *      allow-list / disjointness — it scans only git-trackable receipts).
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFileSync } from "child_process";
// T6B-R2-B1: the audit CLI is launched through the PACKAGE-LOCAL runtime (same resolver
// the shipped audit uses), not ambient `npx` — this rail must not depend on ~/.npm.
import { runTsCli } from "./ts-runtime-helper";

const AUDIT = path.resolve(__dirname, "../../scripts/dot-guild/audit.ts");
const REAL_GITIGNORE = path.resolve(__dirname, "../../.gitignore");

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-receipt-scan-"));
  fs.copyFileSync(REAL_GITIGNORE, path.join(dir, ".gitignore"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function writeReceipt(repo: string, rel: string, body: object | string): void {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
}

function runAudit(repo: string): { status: number; out: string } {
  const r = runTsCli(AUDIT, [`--workspace=${repo}`], { cwd: repo });
  return { status: r.status ?? -1, out: r.out };
}

describe("package/receipt-tree leak scan (audit.ts §7.2, real CLI, non-vacuous)", () => {
  const repos: string[] = [];
  afterAll(() => { for (const d of repos) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } } });

  test("clean committed receipt tree → exit 0, no receipt flags", () => {
    const repo = tempRepo(); repos.push(repo);
    writeReceipt(repo, "evidence/host-smoke/cursor/box-a.json", {
      identity: { host_id: "cursor", box_id: "box-a", host_version: "1.2.3" },
    });
    writeReceipt(repo, "evidence/desktop-app-smoke/codex-app/local.json", {
      host_id: "codex-app",
      result: "blocked",
      public_state_effect: "none",
    });
    const { status, out } = runAudit(repo);
    expect(status).toBe(0);
    expect(out).not.toMatch(/receipt-operator-path|receipt-secret/);
    expect(out).toMatch(/No actionable flags/);
  });

  test("planted operator-path + secret in an admitted receipt → exit 1, BOTH flags", () => {
    const repo = tempRepo(); repos.push(repo);
    writeReceipt(repo, "evidence/desktop-app-smoke/claude-code-app/local.json", {
      identity: { host_id: "cursor", box_id: "box-a" },
      // operator path (redacted to <workspace-root>) + secret pattern.
      box_path: "/Users/alice/Projects/guildsecret/run",
      token_line: "api_key = AKIAIOSFODNN7EXAMPLE1",
    });
    const { status, out } = runAudit(repo);
    expect(status).toBe(1);
    expect(out).toMatch(/receipt-operator-path/);
    expect(out).toMatch(/receipt-secret/);
    // the flagged file is the planted receipt, not a false path.
    expect(out).toMatch(/evidence\/desktop-app-smoke\/claude-code-app\/local\.json/);
  });

  test("planted secret in an IGNORED adjacent file → NOT flagged (allow-list honoured)", () => {
    const repo = tempRepo(); repos.push(repo);
    // evidence/scratch/** is ignored by the narrow allow-list — must not be scanned.
    writeReceipt(repo, "evidence/scratch/local.json", {
      secret_line: "password = hunter2supersecret",
      box_path: "/Users/bob/Projects/guildlocal/x",
    });
    // and a clean admitted receipt so the tree is otherwise valid.
    writeReceipt(repo, "evidence/host-smoke/opencode/box-z.json", { identity: { host_id: "opencode", box_id: "box-z" } });
    writeReceipt(repo, "evidence/desktop-app-smoke/codex-app/local.json", {
      host_id: "codex-app",
      result: "blocked",
      public_state_effect: "none",
    });
    const { status, out } = runAudit(repo);
    expect(status).toBe(0);
    expect(out).not.toMatch(/receipt-operator-path|receipt-secret/);
  });
});
