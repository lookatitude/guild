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

/**
 * Split a workflow `run:` body into the individual COMMAND SEGMENTS it executes.
 *
 * Substring matching on the raw body is not sufficient to decide whether a
 * command runs — two counterexamples drove this implementation:
 *   - `echo "npm run check:inventory"` merely PRINTS the string, but a
 *     `.includes`/unanchored regex counts it as the gate (false green);
 *   - `echo "#"; npm run verify:host-packages` really DOES run a rewriter, but
 *     naive truncation at the first `#` hides it (missed rewriter).
 *
 * So this scanner is quote-aware: a `#` starts a comment only when it is
 * unquoted AND in token-initial position, and segments split on unquoted
 * `;` / `&` / `|`. Callers then match ANCHORED at the start of a segment, so a
 * command must appear in command position — not inside an argument or a quoted
 * string — to count.
 *
 * Backslashes are honoured in both roles: a trailing backslash CONTINUES the
 * logical line (so `echo \` + newline + `npm run x` is one `echo` command, not
 * two), and an escaped delimiter (`echo safe\; npm run x`) does NOT split a
 * segment. Without that, a printed command could masquerade as an executed one.
 *
 * Not a full shell grammar (no heredocs, no substitutions). It is scoped to the
 * shapes this workflow actually uses, and the accompanying control case pins
 * every counterexample above so a regression is caught rather than assumed away.
 */
export function commandSegments(body: string): string[] {
  const segs: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  const push = () => {
    segs.push(cur);
    cur = "";
  };

  for (let i = 0; i < body.length; i++) {
    const c = body[i];

    // Inside single quotes NOTHING is special — not backslash, not newline.
    if (quote === "'") {
      cur += c;
      if (c === "'") quote = null;
      continue;
    }

    if (c === "\\" && i + 1 < body.length) {
      // Line continuation joins with NO separator, so `foo-\<newline>bar` is the
      // single token `foo-bar`. Inserting a space here would split a real
      // command name and hide the step.
      if (body[i + 1] === "\n") {
        i++;
        continue;
      }
      // Any other escaped character is literal — never a delimiter or comment.
      cur += c + body[i + 1];
      i++;
      continue;
    }

    if (quote === '"') {
      cur += c;
      if (c === '"') quote = null;
      continue;
    }

    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "#" && (cur === "" || /\s$/.test(cur))) {
      while (i < body.length && body[i] !== "\n") i++; // unquoted, token-initial ⇒ comment to EOL
      push();
      continue;
    }
    if (c === ";" || c === "&" || c === "|" || c === "\n") {
      push();
      continue;
    }
    cur += c;
  }
  push();
  return segs.map((x) => x.trim()).filter((x) => x.length > 0);
}

/** True when `body` runs a command matching `re` in COMMAND POSITION. */
export function runsCommand(body: string, re: RegExp): boolean {
  return commandSegments(body).some((seg) => re.test(seg));
}

/**
 * Anchored at segment start AND terminated by a real token boundary.
 *
 * `\b` is NOT a sufficient terminator for an npm script name: it matches before
 * `:` and `-`, so `npm run check:inventory:report` and
 * `npm run check:inventory-disabled` would both satisfy a `\b`-terminated
 * pattern while never invoking the gate. Colon-qualified npm scripts are a
 * realistic shape in this repo (`check:claude-install`, `build:hosts`, …), so
 * the terminator must be whitespace or end-of-segment.
 */
const END = "(?:\\s|$)";
export const GATE_RE = new RegExp(`^npm run check:inventory${END}`);
export const REWRITERS_RE = new RegExp(
  `^(npx tsx )?(?:[^\\s]*/)?build-host-packages(?:\\.ts)?${END}` +
    `|^npm run (verify:host-packages|build:hosts|sync:claude-install|check:claude-install)${END}`
);

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

    // Matching goes through the SHARED runsCommand() helper — the same function
    // case (5) controls — so a step that merely MENTIONS or PRINTS the gate
    // command cannot satisfy this assertion.
    const runs = jobs[0].steps.map((s) => s.run ?? "");

    const gateIdx = runs.findIndex((r) => runsCommand(r, GATE_RE));
    expect(gateIdx).toBeGreaterThan(-1); // the gate is wired at all

    // Any step invoking build-host-packages — directly or via a wrapper script —
    // rewrites guild.inventory.json through loadInventory(). Enumerate them all
    // rather than hardcoding the single wrapper we happen to use today.
    const rewriterIdxs = runs.flatMap((r, i) => (runsCommand(r, REWRITERS_RE) ? [i] : []));
    expect(rewriterIdxs.length).toBeGreaterThan(0); // guard: if none match, this rail proves nothing

    for (const idx of rewriterIdxs) {
      expect(gateIdx).toBeLessThan(idx);
    }
  });

  it("(5) neither the gate nor a rewriter can be satisfied by a commented-out command", () => {
    // Anti-vacuity control for (4). It drives the SAME runsCommand() +
    // GATE_RE / REWRITERS_RE that case (4) uses, so case (4) cannot regress
    // while this stays green.
    const gate = (b: string) => runsCommand(b, GATE_RE);
    const rewriter = (b: string) => runsCommand(b, REWRITERS_RE);

    // Comments must never register — including the `:;#` form that a
    // start-of-line/after-whitespace rule would have let through.
    expect(gate("# npm run check:inventory")).toBe(false);
    expect(gate("  cd scripts # npm run check:inventory")).toBe(false);
    expect(gate(":;# npm run check:inventory")).toBe(false);
    expect(gate('echo "# npm run check:inventory"')).toBe(false);
    expect(rewriter("# npm run verify:host-packages")).toBe(false);
    expect(rewriter(":;# build-host-packages.ts")).toBe(false);

    // A PRINTED command is not an executed one (round-4 counterexample 1).
    expect(gate('echo "npm run check:inventory"')).toBe(false);
    // A real rewriter preceded by a QUOTED hash must still be detected —
    // truncating at that `#` would hide it (round-4 counterexample 2).
    expect(rewriter('echo "#"; npm run verify:host-packages')).toBe(true);

    // A DIFFERENT npm script that merely shares a prefix is not the gate —
    // `\b` would wrongly accept both of these (round-5 counterexample).
    expect(gate("npm run check:inventory:report")).toBe(false);
    expect(gate("npm run check:inventory-disabled")).toBe(false);
    expect(rewriter("npm run build:hosts-legacy")).toBe(false);
    // A different basename that merely ENDS in the rewriter's name is not it.
    expect(rewriter("npx tsx dry-run-build-host-packages.ts")).toBe(false);
    // …but a real path-qualified invocation is.
    expect(rewriter("npx tsx scripts/build-host-packages.ts --root ..")).toBe(true);

    // Backslash forms: both of these run only `echo` (round-6 counterexamples).
    expect(gate("echo safe\\; npm run check:inventory")).toBe(false);
    expect(gate("echo \\\n  npm run check:inventory")).toBe(false);
    // Continuation joins with NO separator — a split command name must still be
    // detected, or a real pre-gate rewriter would be invisible (round-7).
    expect(rewriter("npm run verify:host-\\\npackages")).toBe(true);
    // …while the real forms, bare and with arguments, still match.
    expect(gate("npm run check:inventory")).toBe(true);
    expect(gate("cd scripts && npm run check:inventory -- --root ..")).toBe(true);

    // Real invocations still register, including with a trailing comment.
    expect(gate("npm run check:inventory -- --root ..")).toBe(true);
    expect(gate("npm run check:inventory # the gate")).toBe(true);
    expect(rewriter("cd scripts && npm run verify:host-packages")).toBe(true);
  });
});
