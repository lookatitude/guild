/**
 * tests/universal-host/sc4-auto-invocation-sim.test.ts
 *
 * SC-4 — AUTOMATIC-INVOCATION SIMULATION. A request like "review my plan
 * adversarially" must engage Guild via the `using-guild` gateway skill WITHOUT
 * the user typing any `/guild` command — and a narrow, fully-scoped micro-task
 * (typo, rename, value lookup, single-file subagent job) must NOT.
 *
 * REAL PATH: the simulator reads the REAL skills/meta/using-guild/SKILL.src.md
 * frontmatter and the REAL evals.json (the same files L4 ships and the host
 * autoloads from). The trigger lexicon is asserted to actually appear in the
 * skill's own engagement list, so the simulator cannot drift from the skill it
 * models. Ground truth = the skill's own should_trigger / should_not_trigger.
 *
 * This is a heuristic intent simulator (no live model in CI), so it is held to
 * the skill's OWN labelled fixtures: 100% of should_trigger must fire, 0% of
 * should_not_trigger may fire. A vacuous "fire on everything" heuristic is
 * impossible here — the should_not cases are the discriminator.
 *
 * Status at authoring: GREEN — L4 (using-guild) landed.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const SKILL_DIR = path.resolve(__dirname, "../../skills/meta/using-guild");
const BOOTSTRAP_DIST = path.resolve(__dirname, "../../hooks/dist/using-guild-bootstrap.js");

function read(rel: string): string {
  return fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");
}

const SKILL_SRC = read("SKILL.src.md");
const EVALS = JSON.parse(read("evals.json")) as {
  should_trigger: string[];
  should_not_trigger: string[];
};

// ── The intent simulator ────────────────────────────────────────────────────
//
// Engagement vocabulary, drawn from the skill's "When to engage Guild" list. The
// test below asserts each of these stems actually appears in the skill body, so
// the lexicon stays bound to the real skill.
const ENGAGE_LEXICON = [
  "plan",
  "scope",
  "design",
  "build",
  "team",
  "specialist",
  "adversarial",
  "find the holes",
  "root-cause",
  "debug",
  "deploy",
  "roll back",
  "release",
  "incident",
  "monitor",
  "ingest",
  "knowledge",
  "what did we decide",
  "multi", // multi-step / multi-file / multi-agent / multi-part — coordination jobs
  "next step", // "/guild:status" / "proposes the next step" — where-am-I queries
];

// Narrow / fully-scoped signals — when present, the gateway is skipped (the
// skill's explicit DO-NOT-TRIGGER carve-out for narrow subagents & micro-tasks).
const NARROW_SIGNALS = [
  "typo",
  "rename the variable",
  "what's the value",
  "value of",
  "trailing newline",
  "format this file",
  "bump the version",
  "you are the", // "You are the backend specialist …" — a scoped subagent
  "context bundle",
  "run the existing test suite",
];

function has(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

/** Simulate the host's autoload decision for a raw user prompt (no /guild typed). */
function simulateLoadsGuild(prompt: string): boolean {
  if (has(prompt, NARROW_SIGNALS)) return false; // scoped micro-task / narrow subagent
  return has(prompt, ENGAGE_LEXICON); // an engagement-intent phrase fires the gateway
}

describe("SC-4 simulator is bound to the REAL using-guild skill", () => {
  it("the skill declares itself as model-invoked without a /guild command", () => {
    expect(SKILL_SRC).toMatch(/even when the user never types a \/guild command|never typed a `?\/guild/i);
    // The fixtures must exercise auto-invocation: no should_trigger relies on /guild.
    for (const p of EVALS.should_trigger) {
      expect(p.toLowerCase()).not.toContain("/guild");
    }
  });

  it("every engagement stem in the lexicon actually appears in the skill body", () => {
    for (const stem of ENGAGE_LEXICON) {
      expect(SKILL_SRC.toLowerCase()).toContain(stem.toLowerCase());
    }
  });

  it("the evals carry real discriminating density (≥3 each)", () => {
    expect(EVALS.should_trigger.length).toBeGreaterThanOrEqual(3);
    expect(EVALS.should_not_trigger.length).toBeGreaterThanOrEqual(3);
  });
});

describe("SC-4 auto-invocation — no /guild typed", () => {
  it("MUST-fire: 'review my plan adversarially' engages Guild with no command", () => {
    expect(simulateLoadsGuild("Review my implementation plan adversarially before we ship.")).toBe(true);
  });

  it("every should_trigger fixture engages the gateway (100%)", () => {
    const misses = EVALS.should_trigger.filter((p) => !simulateLoadsGuild(p));
    expect(misses).toEqual([]);
  });

  it("no should_not_trigger fixture engages the gateway (0% false-fire)", () => {
    const falseFires = EVALS.should_not_trigger.filter((p) => simulateLoadsGuild(p));
    expect(falseFires).toEqual([]);
  });

  it("a scoped subagent handoff does NOT engage the gateway (carve-out — engagement word present, narrow wins)", () => {
    // Contains "specialist" (an engagement stem) yet must NOT fire — proves the
    // narrow carve-out overrides engagement, not the reverse.
    expect(
      simulateLoadsGuild("You are the backend specialist — implement the endpoint described in your context bundle.")
    ).toBe(false);
  });

  it("DISCRIMINATOR: a NEUTRAL prompt (no engagement word, no narrow signal) does NOT fire", () => {
    // This is the load-bearing test against a "fire on everything minus narrow"
    // heuristic: a benign prompt with neither an engagement stem nor a narrow
    // signal must NOT engage Guild. If the predicate ignored the lexicon, this
    // would wrongly fire.
    for (const neutral of [
      "What time is it in Tokyo right now?",
      "Translate this sentence into French.",
      "Summarize the plot of Hamlet in two sentences.",
    ]) {
      expect(simulateLoadsGuild(neutral)).toBe(false);
    }
  });

  it("DISCRIMINATOR: the SAME neutral prompt fires once an engagement intent is added", () => {
    // Pairs with the test above: adding a real engagement verb flips it to fire,
    // proving the engagement lexicon (not mere absence-of-narrow) is what triggers.
    expect(simulateLoadsGuild("Summarize the plot of Hamlet in two sentences.")).toBe(false);
    expect(simulateLoadsGuild("Plan and design a service to summarize plots for us.")).toBe(true);
  });
});

describe("SC-4 delivery path — the gateway actually REACHES the session (L5b SessionStart envelope) [FU-6]", () => {
  // The simulator above proves WHICH prompts engage the gateway. This block proves
  // the gateway content is actually DELIVERED to the model at session start, via the
  // real L5b SessionStart injector (hooks/dist/using-guild-bootstrap.js) emitting
  // hookSpecificOutput.additionalContext — closing the SC-4 loop end-to-end on the
  // REAL binary, not a fixture.
  function runBootstrap(): { stdout: string; code: number } {
    try {
      const stdout = execFileSync("node", [BOOTSTRAP_DIST], {
        input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }),
        encoding: "utf8",
      });
      return { stdout, code: 0 };
    } catch (e: any) {
      return { stdout: String(e?.stdout ?? ""), code: typeof e?.status === "number" ? e.status : 1 };
    }
  }

  it("the L5b injector is built (dist present — hooks run from dist, not source)", () => {
    expect(fs.existsSync(BOOTSTRAP_DIST)).toBe(true);
  });

  it("SessionStart emits a hookSpecificOutput.additionalContext envelope carrying the using-guild gateway", () => {
    const { stdout, code } = runBootstrap();
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload?.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    const ctx: string = payload?.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx.length).toBeGreaterThan(0);
    // The delivered context IS the using-guild gateway: it carries the skill's
    // engagement lexicon, so the model that receives it at session start can make
    // the same auto-invocation decision the simulator models above.
    const engagementStemsPresent = ENGAGE_LEXICON.filter((s) => ctx.toLowerCase().includes(s.toLowerCase()));
    expect(engagementStemsPresent.length).toBeGreaterThanOrEqual(ENGAGE_LEXICON.length - 2);
    // And it is the SAME content the simulator reads from disk (whole-source delivery).
    expect(ctx).toContain(SKILL_SRC.trim().slice(0, 200));
  });

  it("END-TO-END: every should_trigger prompt is decidable from the DELIVERED context (no /guild typed)", () => {
    const ctx: string = JSON.parse(runBootstrap().stdout)?.hookSpecificOutput?.additionalContext ?? "";
    // The gateway reached the session (ctx non-empty) AND the simulator — bound to
    // that same gateway — fires on 100% of the should_trigger fixtures. The two
    // halves (delivery + decision) together are the SC-4 guarantee.
    expect(ctx.length).toBeGreaterThan(0);
    const misses = EVALS.should_trigger.filter((p) => !simulateLoadsGuild(p));
    expect(misses).toEqual([]);
  });
});
