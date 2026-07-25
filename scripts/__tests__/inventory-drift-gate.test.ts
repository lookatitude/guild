/**
 * scripts/__tests__/inventory-drift-gate.test.ts
 *
 * INVENTORY DRIFT GATE — non-vacuity rail
 * (initiative cross-host-release-distribution, work item xhrd-wi-02 / G2).
 *
 * WHY THIS EXISTS.
 * `guild.inventory.json` is a COMMITTED release artifact: the release cut
 * regenerates it (AGENTS.md release step 1a) and every `dist/<host>` package
 * renders from it. Nothing verified that the committed copy still matched the
 * source tree, so it drifted silently — `next` shipped an inventory missing
 * `lib/emit-remote-orphan.ts` (added by PR #88) while CI stayed green.
 *
 * `build-inventory.ts --check` already implemented exactly this comparison and
 * was wired into no npm script and no workflow. xhrd-wi-02 wires it into
 * rearch-rails.yml; this rail proves the wiring gates something real.
 *
 * WHAT IT ASSERTS.
 *   1. --check PASSES on a tree whose inventory was just generated (no false
 *      positive — a green gate means green, not broken).
 *   2. --check FAILS (exit 2) when the on-disk inventory is mutated (a real
 *      drift is caught — the gate is not vacuous).
 *   3. --check FAILS (exit 2) when the inventory is absent entirely, rather
 *      than silently passing on a missing file.
 *
 * A gate that cannot fail is worthless; that is the repo's own R-VAC
 * principle, applied to this gate specifically.
 *
 * ORDERING NOTE (why the CI step sits where it does — asserted in (4)).
 * `build-host-packages.ts`'s `loadInventory()` REBUILDS the inventory and
 * WRITES it to `guild.inventory.json` as a documented side effect. If the
 * drift check ran AFTER `verify:host-packages`, it would compare the file
 * against the render that had just overwritten it and pass unconditionally.
 * The workflow step must therefore precede the install-channel gate, and (4)
 * pins that ordering so a future reorder cannot silently defang the gate.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(PLUGIN_ROOT, "scripts", "build-inventory.ts");
const WORKFLOW = path.join(PLUGIN_ROOT, ".github", "workflows", "rearch-rails.yml");

/** Run build-inventory.ts against `root`, returning exit code + stderr. */
function runCheck(root: string, invPath: string): { code: number; err: string } {
  try {
    execFileSync("npx", ["tsx", CLI, "--check", "--root", root, "--out", invPath], {
      cwd: path.join(PLUGIN_ROOT, "scripts"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, err: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? -1, err: String(err.stderr ?? "") };
  }
}

describe("inventory drift gate (build-inventory.ts --check)", () => {
  let tmp: string;
  let invPath: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-inv-gate-"));
    invPath = path.join(tmp, "guild.inventory.json");
    // Generate a KNOWN-GOOD inventory for the real plugin tree into the temp
    // path. The source tree is the live one (the inventory builder walks it);
    // only the artifact location is redirected, so the repo copy is untouched.
    execFileSync("npx", ["tsx", CLI, "--root", PLUGIN_ROOT, "--out", invPath], {
      cwd: path.join(PLUGIN_ROOT, "scripts"),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, 180_000);

  afterAll(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("(1) passes when the on-disk inventory matches the source tree", () => {
    const { code } = runCheck(PLUGIN_ROOT, invPath);
    expect(code).toBe(0);
  }, 180_000);

  it("(2) FAILS with exit 2 when the on-disk inventory has drifted", () => {
    const pristine = fs.readFileSync(invPath, "utf8");
    const parsed = JSON.parse(pristine) as { scripts?: unknown[] };
    // Simulate the exact real-world drift: a source file exists but the
    // committed inventory does not list it. Dropping an entry is equivalent to
    // never having added one.
    expect(Array.isArray(parsed.scripts)).toBe(true);
    (parsed.scripts as unknown[]).splice(0, 1);
    fs.writeFileSync(invPath, JSON.stringify(parsed, null, 2) + "\n");

    const { code, err } = runCheck(PLUGIN_ROOT, invPath);
    expect(code).toBe(2);
    expect(err).toMatch(/STALE/);

    fs.writeFileSync(invPath, pristine); // restore for (3)
  }, 180_000);

  it("(3) FAILS with exit 2 when the inventory is missing entirely", () => {
    const missing = path.join(tmp, "does-not-exist.json");
    const { code, err } = runCheck(PLUGIN_ROOT, missing);
    expect(code).toBe(2);
    expect(err).toMatch(/does not exist/);
  }, 180_000);

  it("(4) CI runs the drift gate BEFORE every step that rewrites the inventory", () => {
    // Parse the actual job/step SEQUENCE rather than raw string offsets: an
    // indexOf comparison is satisfied by a matching string in a comment, so a
    // reordering that moved the real step could still pass. We walk executable
    // `run:` bodies only, in declaration order, within the one job.
    const wf = yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as {
      jobs: Record<string, { steps: { name?: string; run?: string }[] }>;
    };
    const jobs = Object.values(wf.jobs);
    expect(jobs).toHaveLength(1); // a second job would run steps concurrently — ordering would not hold

    const runs = jobs[0].steps.map((s) => s.run ?? "");

    const gateIdx = runs.findIndex((r) => /\bnpm run check:inventory\b/.test(r));
    expect(gateIdx).toBeGreaterThan(-1); // the gate is wired at all

    // Any step invoking build-host-packages — directly or via a wrapper script —
    // rewrites guild.inventory.json through loadInventory(). Enumerate them all
    // rather than hardcoding the single wrapper we happen to use today.
    const REWRITERS = /\bbuild-host-packages\b|\bnpm run (verify:host-packages|build:hosts|sync:claude-install|check:claude-install)\b/;
    const rewriterIdxs = runs.flatMap((r, i) => (REWRITERS.test(r) ? [i] : []));
    expect(rewriterIdxs.length).toBeGreaterThan(0); // guard: if none match, this rail proves nothing

    for (const idx of rewriterIdxs) {
      expect(gateIdx).toBeLessThan(idx);
    }
  });
});
