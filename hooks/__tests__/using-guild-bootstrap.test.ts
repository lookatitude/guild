/**
 * hooks/__tests__/using-guild-bootstrap.test.ts
 *
 * L5b — using-guild SessionStart injection (DELIBERATE format change, NOT zero-delta).
 *
 * Golden test (SC-8b): pins the NEW SessionStart output — the structured
 * `hookSpecificOutput.additionalContext` envelope carrying the L4 using-guild
 * gateway. The committed golden at __tests__/golden/using-guild-session-start.json
 * is the source of truth for the payload SHAPE so later phases detect drift.
 *
 * Spawns the COMPILED dist (`dist/using-guild-bootstrap.js`) — the same binary
 * Claude Code runs at SessionStart — so a stale dist fails the test (HK dist-rebuild
 * discipline). A source-path sanity check runs the exported helpers via ts-jest.
 *
 * To regenerate the golden after an INTENTIONAL L4 SKILL.src.md change:
 *   cat fixtures/session-start.json | CLAUDE_PLUGIN_ROOT=<plugin-root> \
 *     node dist/using-guild-bootstrap.js > __tests__/golden/using-guild-session-start.json
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildSessionStartInjection,
  gatewayContext,
} from "../using-guild-bootstrap";
// Shared js-yaml frontmatter parser (OD-3 compliant) — detect the leading
// frontmatter block via the parser's splitter, not a hand-rolled startsWith('---').
import { splitFrontmatter } from "../../scripts/lib/frontmatter";

const DIST_JS = path.resolve(__dirname, "../dist/using-guild-bootstrap.js");
const FIXTURE = path.resolve(__dirname, "../fixtures/session-start.json");
const GOLDEN = path.resolve(__dirname, "./golden/using-guild-session-start.json");
const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const SKILL_SRC = path.resolve(
  PLUGIN_ROOT,
  "skills/meta/using-guild/SKILL.src.md",
);

function runHook(
  stdin: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync("node", [DIST_JS], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, ...env },
  });
  return { stdout: res.stdout, stderr: res.stderr, status: res.status };
}

describe("using-guild-bootstrap.ts (L5b SessionStart injection)", () => {
  const fixture = fs.readFileSync(FIXTURE, "utf8");

  it("emits stdout byte-identical to the committed golden (SC-8b drift guard)", () => {
    const { stdout, status } = runHook(fixture);
    const golden = fs.readFileSync(GOLDEN, "utf8");
    expect(status).toBe(0);
    expect(stdout).toBe(golden);
  });

  it("emits a well-formed hookSpecificOutput.additionalContext SessionStart envelope", () => {
    const { stdout } = runHook(fixture);
    const parsed = JSON.parse(stdout);
    expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(typeof parsed.hookSpecificOutput.additionalContext).toBe("string");
  });

  it("injects the WHOLE using-guild source verbatim (frontmatter INCLUDED)", () => {
    const { stdout } = runHook(fixture);
    const parsed = JSON.parse(stdout);
    const expected = gatewayContext(fs.readFileSync(SKILL_SRC, "utf8"));
    expect(parsed.hookSpecificOutput.additionalContext).toBe(expected);
    // Frontmatter (the richest WHEN-to-engage trigger signals) IS injected:
    // the injected context opens with a well-formed `---`-fenced frontmatter block.
    expect(
      splitFrontmatter(parsed.hookSpecificOutput.additionalContext).frontmatter,
    ).not.toBeNull();
    expect(parsed.hookSpecificOutput.additionalContext).toContain("when_to_use:");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("description:");
    // …and the gateway body too.
    expect(parsed.hookSpecificOutput.additionalContext).toContain("# using-guild");
  });

  it("is a silent no-op (no stdout, exit 0) when the skill source is absent everywhere", () => {
    // Run the SELF-CONTAINED bundled dist from an isolated temp dir whose
    // ancestors have NO using-guild skill, and point CLAUDE_PLUGIN_ROOT at an
    // equally-empty dir — so neither the env nor the walk-up fallback resolves it
    // (a genuinely partial install). The robust walk-up otherwise finds the real
    // skill from the real dist/ location, which is correct production behavior.
    const isoDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "ug-iso-"));
    const emptyRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "ug-noskill-"));
    const isoBin = path.join(isoDir, "using-guild-bootstrap.js");
    fs.copyFileSync(DIST_JS, isoBin);
    const res = spawnSync("node", [isoBin], {
      input: fixture,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: emptyRoot },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("");
    expect(res.stderr).toContain("SKILL.src.md not found");
    fs.rmSync(isoDir, { recursive: true, force: true });
    fs.rmSync(emptyRoot, { recursive: true, force: true });
  });

  it("tolerates an absent / non-JSON stdin payload (still injects)", () => {
    const empty = runHook("");
    expect(empty.status).toBe(0);
    expect(empty.stdout).toBe(fs.readFileSync(GOLDEN, "utf8"));
    const garbage = runHook("{not json");
    expect(garbage.status).toBe(0);
    expect(garbage.stdout).toBe(fs.readFileSync(GOLDEN, "utf8"));
  });
});

describe("gatewayContext / buildSessionStartInjection (unit)", () => {
  it("normalizes CRLF to LF and trims, keeping frontmatter", () => {
    expect(gatewayContext("---\r\nname: x\r\n---\r\n# Body\r\n\r\ntext\r\n")).toBe(
      "---\nname: x\n---\n# Body\n\ntext",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(gatewayContext("\n\n# Body only\n\n")).toBe("# Body only");
  });

  it("builds the canonical SessionStart envelope shape", () => {
    expect(buildSessionStartInjection("BODY")).toBe(
      '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"BODY"}}',
    );
  });
});
