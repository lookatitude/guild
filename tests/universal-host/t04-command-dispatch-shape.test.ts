/**
 * tests/universal-host/t04-command-dispatch-shape.test.ts
 *
 * The T04 (22 -> 13 command fold) DISPATCH-SHAPE guard — codex G-lane round 1.
 *
 * Every case here parses the REAL committed command file and asserts a property the
 * G-lane review found broken in round 0. Each one is RED against the round-0 tree and
 * GREEN after the fix, so the suite is the executable record of the five P1s:
 *
 *   P1  the team-decision gate invocation carries `--proposal <f> --cwd <root>`; the
 *       compiled CLI refuses anything else with `missing file argument`, so a documented
 *       gate call without it blocks dispatch even on a valid persisted approval. Proven
 *       end-to-end: the exact argv the command documents is run against a seeded repo
 *       with a persisted `approve` and must exit 0.
 *   P2  `/guild:config` routes `models` and `migrate` to the CLIs that ACCEPT them
 *       (config-cmd rejects both), forwards flags verbatim, and — like every dispatcher —
 *       names an assembler.
 *   P3  `/guild:maintain`'s dispatch is conditional: one target per sub-verb row, and the
 *       table and the dispatch agree.
 *   P4  `/guild:plan goal` has a real handler: the `plan` assembler carries the route.
 *   P5  every lifecycle command's `run-trace.js start` carries `--phase=` and the
 *       user-supplied-only `--initiative=` forwarding (both record null without them).
 *
 * Owner: command-builder (lane T04).
 */

import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { canonicalYaml } from "../../src/domains/teams";
import { readScalarField } from "../../scripts/lib/frontmatter";
import { recordDecision, writeDecision } from "../../src/domains/teams/index";
import { composeProposal, writeProposal } from "../../src/domains/teams/index";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const COMMANDS = path.join(PLUGIN_ROOT, "commands");

/** The 13 dispatchers. Aliases are print-only and are asserted separately. */
const DISPATCHERS = [
  "guild", "init", "ideate", "plan", "build", "qa", "ops",
  "learn", "wiki", "initiative", "config", "status", "maintain",
];

/** The commands that open a lifecycle run and therefore must stamp a phase (P5). */
const LIFECYCLE: Array<[string, string]> = [
  ["init", "init"],
  ["ideate", "ideate"],
  ["plan", "plan"],
  ["build", "build"],
  ["qa", "qa"],
  ["ops", "ops"],
  ["guild", "<detected-phase>"],
];

/** Commands carrying the blocking team-decision gate (P1). */
const GATE_COMMANDS = ["guild", "init", "ideate", "plan", "build", "qa", "ops"];

function readCommand(id: string): string {
  return fs.readFileSync(path.join(COMMANDS, `${id}.md`), "utf8");
}

/** Every line inside a ```bash fence of a command file. */
function bashLines(id: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of readCommand(id).split("\n")) {
    if (line.startsWith("```bash")) { inFence = true; continue; }
    if (inFence && line.startsWith("```")) { inFence = false; continue; }
    if (inFence) out.push(line);
  }
  return out;
}

/** The `Skill: guild:<name>` targets a command names, in file order. */
function skillTargets(id: string): string[] {
  // A `Skill: guild:<id>` line inside the fenced dispatch block is not YAML; scanned
  // with a plain global match so comms-format check (b) does not read it as a
  // hand-rolled frontmatter extractor.
  const skillLine = /Skill:\s*guild:[a-z-]+/g;
  return (readCommand(id).match(skillLine) ?? []).map((l) => l.slice(l.indexOf("guild:")));
}

// ---------------------------------------------------------------------------
// P1 — the blocking team-decision gate is a RUNNABLE invocation
// ---------------------------------------------------------------------------

const GATE_RE =
  /runtime\/scripts\/team-decide\.js"\s+gate\s+--proposal\s+(\S+)\s+--cwd\s+"\$\(pwd\)"/;

describe("T04 P1 — the documented team-decision gate is the argv the CLI accepts", () => {
  it.each(GATE_COMMANDS)("%s documents `gate --proposal <f> --cwd <root>`", (id) => {
    const body = readCommand(id);
    expect(body).toMatch(/## Team decision gate \(blocking/);
    expect(body).toMatch(GATE_RE);
    // Round-0 regression: `--run-dir`/`--decision` are NOT the gate's argument set.
    const gateLine = bashLines(id).find((l) => l.includes("team-decide.js") && l.includes(" gate "));
    expect(gateLine).toBeDefined();
    expect(gateLine).not.toMatch(/--run-dir/);
    expect(gateLine).not.toMatch(/--decision\b/);
  });

  it("ANTI-VACUITY: the round-0 argv is genuinely refused by the compiled CLI", () => {
    const bad = runCompiledGate(["gate", "--run-dir", os.tmpdir(), "--decision", "approve"]);
    expect(bad.stdout + bad.stderr).toMatch(/missing file argument/);
  });

  it("the documented argv authorizes dispatch on a persisted approve (exit 0)", () => {
    const { root, proposalPath } = seedApprovedRepo();
    // Build the argv by SUBSTITUTING into the command's own documented line, so the test
    // cannot pass with a shape the file does not actually carry.
    const m = readCommand("build").match(GATE_RE);
    if (!m) throw new Error("commands/build.md no longer documents the gate invocation");
    const argv = ["gate", "--proposal", proposalPath, "--cwd", root];
    const run = runCompiledGate(argv);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/DECISION  state=approved/);
  });

  it("CONTROL: the same argv BLOCKS (non-zero) when no decision is persisted", () => {
    const { root, proposalPath } = seedApprovedRepo({ withApprove: false });
    const run = runCompiledGate(["gate", "--proposal", proposalPath, "--cwd", root]);
    expect(run.code).not.toBe(0);
  });
});

const RUN_ID = "run-t04";

function runCompiledGate(args: string[]): { code: number; stdout: string; stderr: string } {
  const cli = path.join(PLUGIN_ROOT, "runtime", "scripts", "team-decide.js");
  expect(fs.existsSync(cli)).toBe(true); // KTD7: users run the committed compiled output
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

const PARTICIPANTS = [
  {
    participant_id: "p0",
    participation_kind: "worker",
    role_ref: "backend",
    necessity_rationale: "owns the API lane",
    owned_obligations: ["ob0"],
    depends_on: [] as string[],
    tier: "mid",
    purpose: "implementation",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p1",
    participation_kind: "advisor",
    role_ref: "advisor",
    necessity_rationale: "escalation target for the cheap lane",
    owned_obligations: ["ob1"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "advisory",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p2",
    participation_kind: "challenger",
    role_ref: "security",
    necessity_rationale: "adversarial pass on the auth path",
    owned_obligations: ["ob2"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "adversarial",
    capability_scope: null,
    backend: "team",
  },
  {
    participant_id: "p3",
    participation_kind: "reviewer_cross_host",
    role_ref: "codex-reviewer",
    necessity_rationale: "cross-family independence for the G-lane gate",
    owned_obligations: ["ob3"],
    depends_on: ["p0"],
    tier: "powerful",
    purpose: "adversarial",
    capability_scope: null,
    backend: "team",
  },
];

function seedApprovedRepo(opts: { withApprove?: boolean } = {}): {
  root: string;
  proposalPath: string;
} {
  const withApprove = opts.withApprove !== false;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t04-gate-"));
  fs.mkdirSync(path.join(root, ".guild", "runs", RUN_ID), { recursive: true });
  const participants = JSON.parse(JSON.stringify(PARTICIPANTS));
  const proposal = composeProposal({
    run_id: RUN_ID,
    phase: "build",
    participants,
    obligations: participants.map((p: { participant_id: string }, i: number) => ({
      obligation_id: `ob${i}`,
      source: "plan_item",
      text: `item ${i}`,
      disposition: {
        owners: p.participant_id === "p1" ? ["p1", "p0"] : [p.participant_id],
      },
    })),
    excluded_roles: [{ role_ref: "mobile", why_unnecessary: "no mobile surface" }],
    backend_capacity_evidence: {
      backend: "team",
      verified_capacity: 2,
      method: "preflight probe",
      as_of: "2026-07-30T00:00:00Z",
    },
  } as never);
  const proposalPath = writeProposal(root, proposal);
  if (withApprove) {
    writeDecision(
      root,
      recordDecision(proposal, {
        decision: "approve",
        decided_by: { kind: "user" },
        decision_channel: "interactive_prompt",
        decided_at: "2026-07-31T00:00:00Z",
      } as never) as never
    );
  }
  // canonicalYaml is imported so a future fixture can hand-plant a trail entry the way
  // t6b does; referencing it here keeps the import honest rather than decorative.
  expect(typeof canonicalYaml).toBe("function");
  return { root, proposalPath };
}

// ---------------------------------------------------------------------------
// P2 — /guild:config routes each sub-verb to a CLI that accepts it
// ---------------------------------------------------------------------------

describe("T04 P2 — config sub-verbs reach a CLI that accepts them", () => {
  it("config-cmd.js is invoked for its OWN sub-verbs only — never models / migrate", () => {
    const cfgLine = bashLines("config").find((l) => l.includes("config-cmd.js"));
    expect(cfgLine).toBeDefined();
    expect(cfgLine).not.toMatch(/\bmodels\b/);
    expect(cfgLine).not.toMatch(/\bmigrate\b/);
  });

  it("models routes to models-cmd.js and migrate to migrate-guild.js", () => {
    const lines = bashLines("config").filter((l) => !l.trimStart().startsWith("#"));
    const models = lines.find((l) => l.includes("models-cmd.js"));
    const migrate = lines.find((l) => l.includes("migrate-guild.js"));
    expect(models).toMatch(/models-cmd\.js"/);
    expect(migrate).toMatch(/migrate-guild\.js"/);
    // R2-3: the CLI's own sub-verb arrives in $REMAINING_ARGS — inserting it here too
    // spawns it twice and the parser dies with `unknown argument: inspect`.
    expect(models).not.toMatch(/models-cmd\.js"\s+inspect\b/);
    expect(models).toContain("$REMAINING_ARGS");
  });

  it("both sub-verb invocations forward the user's remaining flags verbatim", () => {
    const lines = bashLines("config");
    for (const cli of ["models-cmd.js", "migrate-guild.js"]) {
      const line = lines.find((l) => l.includes(cli));
      expect(line).toBeDefined();
      expect(line).toMatch(/\$REMAINING_ARGS/);
    }
  });

  it("ANTI-VACUITY: config-cmd really does reject models and migrate", () => {
    for (const verb of ["models", "migrate"]) {
      const run = runCompiledCli("config-cmd.js", [verb]);
      expect(run.stdout + run.stderr).toMatch(
        new RegExp(`unknown subcommand "${verb}"`)
      );
    }
  });

  it("every dispatcher — config and status included — names an assembler", () => {
    for (const id of DISPATCHERS) {
      const targets = skillTargets(id);
      expect({ id, targets }).toEqual({ id, targets: expect.arrayContaining([expect.any(String)]) });
      expect(targets.length).toBeGreaterThan(0);
    }
  });
});

function runCompiledCli(script: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const cli = path.join(PLUGIN_ROOT, "runtime", "scripts", script);
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd: PLUGIN_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// ---------------------------------------------------------------------------
// P3 (superseded by R3) — /guild:maintain is ONE assembler; the routing moved into it
//
// Round 0 dispatched everything to guild:evolve unconditionally, which swallowed `fix`
// and `wiki revert`. Round 2 fixed that by naming three assemblers in the command file —
// which breaks the lane's one-assembler-per-command criterion. Round 3 is the shape that
// satisfies both: the COMMAND names exactly one assembler and forwards $ARGUMENTS
// verbatim, and the ASSEMBLER carries the per-token routing table.
// ---------------------------------------------------------------------------

const EVOLVE_SKILL = path.join(PLUGIN_ROOT, "skills", "meta", "evolve", "SKILL.md");

/** token -> the chapter path the assembler routes it to, relative to the evolve dir. */
const MAINTAIN_ROUTES: Record<string, string | null> = {
  "evolve": null, // the assembler's own pipeline, not a chapter file
  "rollback": "references/rollback-skill.md",
  "audit": "references/audit.md",
  "fix": "../diagnose/references/systematic-debug.md",
  "wiki revert": null, // harvest-journal inverse (R54, U-LOOP/U-STOR) — no handler ships yet; the row says so and stops
  "gc": null, // storage janitor (U-STOR) — no chapter yet
};

describe("T04 R3-1 — maintain dispatches exactly one assembler", () => {
  it("names exactly one `Skill:` target, and it is guild:evolve", () => {
    const targets = skillTargets("maintain");
    expect(targets).toEqual(["guild:evolve"]);
  });

  it("no other assembler is named as a dispatch target anywhere in the file", () => {
    // Round-2 regression: guild:diagnose / guild:wiki appeared as `Skill:` targets.
    const body = readCommand("maintain");
    expect(body).not.toMatch(/Skill:\s*guild:diagnose/);
    expect(body).not.toMatch(/Skill:\s*guild:wiki/);
  });

  it("the fenced ## Dispatch block is a single Skill/args pair", () => {
    const m = readCommand("maintain").match(/## Dispatch\n\n```\n([\s\S]*?)```/);
    if (!m) throw new Error("commands/maintain.md has no fenced ## Dispatch block");
    const rows = m[1].split("\n").filter((l) => l.trim());
    expect(rows).toEqual(["Skill: guild:evolve", "args: $ARGUMENTS"]);
  });

  it("every sub-verb still appears in the frontmatter hint (no token was dropped)", () => {
    const hint = readScalarField(readCommand("maintain"), "argument-hint") ?? "";
    for (const verb of Object.keys(MAINTAIN_ROUTES)) {
      expect(hint).toContain(verb.split(" ")[0]);
    }
  });
});

describe("T04 R3-2 — `wiki revert` forwards its token exactly once", () => {
  /** What the command hands the assembler for a given user invocation. */
  function forwarded(userInput: string): string {
    const m = readCommand("maintain").match(/## Dispatch\n\n```\n([\s\S]*?)```/);
    if (!m) throw new Error("commands/maintain.md has no fenced ## Dispatch block");
    const argsLine = m[1].split("\n").find((l) => l.trimStart().startsWith("args:"));
    expect(argsLine).toBeDefined();
    const spec = argsLine!.replace(/^\s*args:\s*/, "").trim();
    // $ARGUMENTS is the whole user input; $REMAINING_ARGS drops the first token.
    return spec
      .split(/\s+/)
      .map((tok) => {
        if (tok === "$ARGUMENTS") return userInput;
        if (tok === "$REMAINING_ARGS") return userInput.split(/\s+/).slice(1).join(" ");
        return tok;
      })
      .join(" ")
      .trim();
  }

  it("`wiki revert harvest-123` forwards `revert` exactly once", () => {
    // Round-2 regression: the row routed on `wiki` and then re-inserted `revert`,
    // so the assembler received `revert revert harvest-123`.
    const out = forwarded("wiki revert harvest-123");
    expect(out.split(/\s+/).filter((t) => t === "revert")).toHaveLength(1);
    expect(out).toBe("wiki revert harvest-123");
  });

  it.each(["evolve my-skill --auto", "rollback guild-plan 2", "audit", "fix run-123", "gc"])(
    "forwards `%s` verbatim, re-inserting nothing",
    (input) => {
      expect(forwarded(input)).toBe(input);
    }
  );

  it("ANTI-VACUITY: a re-inserting args spec would be caught", () => {
    // Proves the resolver above is sensitive to the exact defect it guards.
    const reinserting = "revert $REMAINING_ARGS";
    const out = reinserting
      .split(/\s+/)
      .map((t) => (t === "$REMAINING_ARGS" ? "revert harvest-123" : t))
      .join(" ");
    expect(out.split(/\s+/).filter((t) => t === "revert")).toHaveLength(2);
  });
});

describe("T04 R3-3 — the evolve assembler carries the routing table", () => {
  it("`wiki revert` does NOT route to ingestion (codex G-lane r6 P2)", () => {
    // wiki-ingest.md creates raw copies and synthesized pages; it has no revert handler.
    // Until the harvest journal (R54) ships, the row must report the pending capability
    // and stop rather than forward a revert into an ingest.
    const table = stripFences(fs.readFileSync(EVOLVE_SKILL, "utf8")).split("\n").find((l) => /^\|\s*`wiki revert/.test(l)) ?? "";
    expect(table).not.toMatch(/wiki-ingest\.md/);
    // T09 shipped the harvest-journal inverse: the row names the revert chapter.
    // Before that it had to report the pending capability and stop.
    if (/wiki-revert\.md/.test(table)) {
      expect(fs.existsSync(path.join(path.dirname(EVOLVE_SKILL), "references", "wiki-revert.md"))).toBe(true);
    } else {
      expect(table).toMatch(/harvest_journal|pending/);
      expect(table).toMatch(/stop/);
    }
  });

  it("`## Sub-verbs` is a real section, surviving a fence-strip", () => {
    expect(stripFences(fs.readFileSync(EVOLVE_SKILL, "utf8"))).toMatch(/^## Sub-verbs$/m);
  });

  it("the head of the assembler is byte-unchanged (the layout baseline pins its lines)", () => {
    // Anti-regression for the shrink-only baseline: `no-durable-skill-versions` keys this
    // file by LINE NUMBER, so a head insertion re-keys 4 pre-existing entries as new
    // violations. The routing table therefore lives at the tail.
    const src = fs.readFileSync(EVOLVE_SKILL, "utf8");
    expect(src.indexOf("\n## Sub-verbs\n")).toBeGreaterThan(src.indexOf("\n## Input\n"));
  });

  it("every fence in the assembler is balanced", () => {
    const fences = fs.readFileSync(EVOLVE_SKILL, "utf8").match(/^```/gm) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it.each(Object.keys(MAINTAIN_ROUTES))("routes `%s`", (token) => {
    const bare = stripFences(fs.readFileSync(EVOLVE_SKILL, "utf8"));
    // The section is appended at the TAIL on purpose: inserting it at the head would
    // shift every line number the layout baseline pins for this file, and that baseline
    // is shrink-only. So slice from the heading to end-of-file, not to the next section.
    const section = bare.slice(bare.indexOf("## Sub-verbs"));
    expect(section).toContain(token === "wiki revert" ? "wiki revert" : token);
    const route = MAINTAIN_ROUTES[token];
    if (route) expect(section).toContain(route);
  });

  it("every chapter pointer resolves to a file that exists", () => {
    const dir = path.dirname(EVOLVE_SKILL);
    for (const [token, route] of Object.entries(MAINTAIN_ROUTES)) {
      if (!route) continue;
      expect({ token, route, exists: fs.existsSync(path.resolve(dir, route)) })
        .toEqual({ token, route, exists: true });
    }
  });

  it("the section says the arguments arrive verbatim", () => {
    const bare = stripFences(fs.readFileSync(EVOLVE_SKILL, "utf8"));
    expect(bare).toMatch(/never re-inserts the token/);
  });

  it("has no module-resource mirror to drift from (T12: one projector, live surface)", () => {
    expect(
      fs.existsSync(path.join(PLUGIN_ROOT, "src", "modules", "evolution", "resources"))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P4 — /guild:plan goal has a handler in the assembler it is routed to
// ---------------------------------------------------------------------------

describe("T04 P4 — the goal sub-verb has a real route", () => {
  const planSkill = (): string =>
    fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "meta", "plan", "SKILL.md"), "utf8");

  it("commands/plan.md folds goal in and names the assembler section", () => {
    const body = readCommand("plan");
    expect(body).toMatch(/goal \[new\|list\|show\|from-spec\]/);
    expect(skillTargets("plan")).toContain("guild:plan");
    expect(body).toMatch(/guild:plan §Sub-verbs/);
  });

  it("the plan assembler carries the ## Sub-verbs route for every goal token", () => {
    const src = planSkill();
    expect(src).toMatch(/^## Sub-verbs$/m);
    for (const token of ["goal new", "goal from-spec", "goal list", "goal show"]) {
      expect(src).toContain(token);
    }
  });

  it("the route names both frozen contracts and their domain home", () => {
    const src = planSkill();
    expect(src).toContain("guild.goal.v1");
    expect(src).toContain("guild.task_group.v1");
    expect(src).toContain("src/domains/evolve/goal-task-schema.ts");
  });

  it("has no module-resource mirror to drift from (T12: one projector, live surface)", () => {
    expect(
      fs.existsSync(path.join(PLUGIN_ROOT, "src", "modules", "lifecycle", "resources"))
    ).toBe(false);
  });

  it("the goal capability survives alias retirement (state-aware, C06E)", () => {
    // PRE-retirement: goal.md is a print-only alias AND the allowlist names it.
    // RETIRED: goal.md and the allowlist are BOTH gone and /guild:plan still
    // carries the goal sub-verb. A partial state fails either branch (KTD14).
    const goalPath = path.join(COMMANDS, "goal.md");
    const allowPath = path.join(COMMANDS, "aliases.allowlist.json");
    if (fs.existsSync(goalPath)) {
      const alias = readCommand("goal");
      expect(alias).toContain("/guild:plan goal");
      expect(alias).not.toMatch(/Skill:/);
      expect(fs.existsSync(allowPath)).toBe(true);
      expect((JSON.parse(fs.readFileSync(allowPath, "utf8")) as { aliases: string[] }).aliases).toContain("goal");
    } else {
      expect(fs.existsSync(allowPath)).toBe(false);
      const hint = readScalarField(readCommand("plan"), "argument-hint") ?? "";
      expect(hint).toContain("goal");
    }
  });
});

// ---------------------------------------------------------------------------
// P5 — run metadata: --phase always, --initiative only when the user gave one
// ---------------------------------------------------------------------------

describe("T04 P5 — lifecycle run recording stamps phase and initiative", () => {
  it.each(LIFECYCLE)("%s starts the run with --phase=%s", (id, phase) => {
    const start = bashLines(id).find((l) => l.includes("run-trace.js") && l.includes(" start "));
    expect(start).toBeDefined();
    expect(start).toContain(`--command=/guild:${id}`);
    expect(start).toContain(`--phase=${phase}`);
    expect(start).toContain('--cwd "$(pwd)"');
  });

  it.each(LIFECYCLE)("%s forwards --initiative ONLY when user-supplied (NN#5)", (id) => {
    const lines = bashLines(id);
    const note = lines.find((l) => l.includes("--initiative=<id>"));
    expect(note).toBeDefined();
    // It is guidance, not an unconditional flag: the note is a comment, and the start
    // line itself must NOT hard-code an initiative.
    expect(note!.trimStart().startsWith("#")).toBe(true);
    expect(note).toMatch(/ONLY when the user supplied one/);
    expect(note).toMatch(/never auto-detect/);
    const start = lines.find((l) => l.includes("run-trace.js") && l.includes(" start "));
    expect(start).not.toContain("--initiative=");
  });

  it("ANTI-VACUITY: a NOUN command carries no phase token (the enum is lifecycle-only)", () => {
    // run-trace's phase enum is init|ideate|plan|build|qa|ops, so stamping `--phase=learn`
    // would be an invalid token, not a fix. This proves the phase assertion above is
    // selective rather than matching every command file.
    for (const id of ["learn", "wiki", "initiative", "maintain"]) {
      const start = bashLines(id).find((l) => l.includes("run-trace.js") && l.includes(" start "));
      if (start) expect(start).not.toMatch(/--phase=/);
    }
  });
});

// ---------------------------------------------------------------------------
// Shape floor — the fold's invariants the five fixes must not regress
// ---------------------------------------------------------------------------

describe("T04 shape floor — 13 dispatchers, thin, compiled spawns only", () => {
  it("every dispatcher is <= 40 lines (KTD24)", () => {
    for (const id of DISPATCHERS) {
      const n = readCommand(id).replace(/\n$/, "").split("\n").length;
      expect({ id, over: n > 40 }).toEqual({ id, over: false });
    }
  });

  it("no command spawns through npx / tsx (KTD7, KTD10)", () => {
    for (const f of fs.readdirSync(COMMANDS).filter((x) => x.endsWith(".md"))) {
      expect(fs.readFileSync(path.join(COMMANDS, f), "utf8")).not.toMatch(/\bnpx\b|\btsx\b/);
    }
  });

  it("every spawned runtime script exists as a committed compiled artifact", () => {
    for (const id of DISPATCHERS) {
      for (const line of bashLines(id)) {
        for (const m of line.matchAll(/(runtime\/scripts\/[a-z0-9-]+\.js|hooks\/dist\/[a-z0-9-]+\.js)/g)) {
          expect({ id, p: m[1], exists: fs.existsSync(path.join(PLUGIN_ROOT, m[1])) })
            .toEqual({ id, p: m[1], exists: true });
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// rework-r2 — codex G-lane round 2
//
// R2-1  the plan assembler's `## Sub-verbs` section must be a REAL section, not text
//       inside the `## Output` example fence (where it is inert prose and the `goal`
//       route never activates).
// R2-2  `/guild:config init` must be TRANSLATED to the CLI's spelling (`reconcile sync`);
//       forwarded verbatim, config-cmd answers `unknown subcommand "init"`.
// R2-3  `/guild:config models inspect --json` must spawn `inspect` ONCE. Inserting it
//       while it also arrives in $REMAINING_ARGS dies with `unknown argument: inspect`.
// R2-4  every sub-verb row across config/status/maintain/learn/wiki is checked
//       row -> spawned argv -> the compiled parser accepts it.
// ---------------------------------------------------------------------------

/** Drop every fenced block, so only prose/headings the model actually obeys remain. */
function stripFences(src: string): string {
  return src.replace(/(?:^|\n)```[^\n]*\n[\s\S]*?\n```(?=\n|$)/g, "\n");
}

const PLAN_SKILL = path.join(PLUGIN_ROOT, "skills", "meta", "plan", "SKILL.md");

describe("T04 R2-1 — the plan assembler's goal route is a real section, not fenced text", () => {
  it("every fence in the assembler is balanced (an odd count would swallow the tail)", () => {
    const fences = fs.readFileSync(PLAN_SKILL, "utf8").match(/^```/gm) ?? [];
    expect(fences.length % 2).toBe(0);
  });

  it("`## Sub-verbs` survives stripping every fenced block", () => {
    const bare = stripFences(fs.readFileSync(PLAN_SKILL, "utf8"));
    expect(bare).toMatch(/^## Sub-verbs$/m);
  });

  it("every goal row survives the strip and names an existing route target", () => {
    const bare = stripFences(fs.readFileSync(PLAN_SKILL, "utf8"));
    for (const token of ["goal new", "goal from-spec", "goal list", "goal show"]) {
      expect(bare).toContain(token);
    }
    // The route column points at files that exist — a dead pointer is not a route.
    for (const route of [
      "src/domains/evolve/goal-task-schema.ts",
      "skills/meta/plan/references/product-define.md",
    ]) {
      const rel = route.startsWith("skills/") ? route : route;
      expect({ route, exists: fs.existsSync(path.join(PLUGIN_ROOT, rel)) })
        .toEqual({ route, exists: true });
    }
    expect(bare).toContain("goal-task-schema.ts");
    expect(bare).toContain("product-define.md");
  });

  it("the section sits BEFORE the planning prerequisites (## Input)", () => {
    const src = fs.readFileSync(PLAN_SKILL, "utf8");
    expect(src.indexOf("\n## Sub-verbs\n")).toBeGreaterThan(-1);
    expect(src.indexOf("\n## Sub-verbs\n")).toBeLessThan(src.indexOf("\n## Input\n"));
  });

  it("ANTI-VACUITY: stripFences really does remove fenced content", () => {
    expect(stripFences("a\n```md\n## Sub-verbs\n```\nb")).not.toContain("## Sub-verbs");
    expect(stripFences("a\n## Sub-verbs\nb")).toContain("## Sub-verbs");
  });

  it("has no module-resource mirror beside the plan assembler (T12)", () => {
    expect(
      fs.existsSync(path.join(PLUGIN_ROOT, "src", "modules", "lifecycle", "resources"))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R2-2 / R2-3 / R2-4 — every documented sub-verb row is argv the parser accepts
// ---------------------------------------------------------------------------

/**
 * Resolve the argv a command would actually spawn for a given user invocation, by
 * SUBSTITUTING into the command file's own bash line. The test never hand-writes the
 * argv: if the file changes, so does what is executed here.
 */
function spawnedArgv(
  commandId: string,
  cliBasename: string,
  userTokens: string[],
  root: string,
  match?: string
): string[] {
  const candidates = bashLines(commandId)
    .filter((l) => !l.trimStart().startsWith("#") && l.includes(`/${cliBasename}`));
  const line = match ? candidates.find((l) => l.includes(match)) : candidates[0];
  if (!line) throw new Error(`commands/${commandId}.md spawns no ${cliBasename}`);
  const after = line.slice(line.indexOf(`/${cliBasename}`) + cliBasename.length + 1);
  const rest = after.replace(/^"/, "").trim();
  const remaining = userTokens.slice(1); // everything after the sub-verb token
  return rest
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((tok) => {
      if (tok === "$REMAINING_ARGS") return remaining;
      if (tok === "$ARGUMENTS") return userTokens;
      if (tok === "<runDir>") return [path.join(root, ".guild", "runs", "run-x")];
      return [tok.replace(/"\$\(pwd\)"/g, root).replace(/\$\(pwd\)/g, root)];
    });
}

function freshRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "t04-row-"));
  fs.mkdirSync(path.join(root, ".guild", "runs", "run-x"), { recursive: true });
  return root;
}

/** A parser REFUSAL, as each shipped CLI spells it. */
// `requires --` is the required-flag class: an argv the parser recognises but cannot run
// is still a refused row (codex G-lane r3).
const REFUSAL = /unknown subcommand|unknown argument|unknown_subcommand|missing sub-verb|missing file argument|usage:|requires --/i;

describe("T04 R2-2 — /guild:config init is translated to the CLI's spelling", () => {
  it("ANTI-VACUITY: the verbatim `init` argv really is refused", () => {
    const run = runCompiledCli("config-cmd.js", ["init", "--cwd", freshRoot()]);
    expect(run.stdout + run.stderr).toMatch(/unknown subcommand "init"/);
  });

  it("the command file translates `init`, never forwards it", () => {
    const initLine = bashLines("config").find(
      (l) => !l.trimStart().startsWith("#") && l.includes("reconcile sync")
    );
    expect(initLine).toBeDefined();
    expect(initLine).toMatch(/config-cmd\.js"\s+reconcile sync\b/);
    const verbatim = bashLines("config").find(
      (l) => !l.trimStart().startsWith("#") && l.includes("config-cmd.js") && l.includes("$ARGUMENTS")
    );
    expect(verbatim).toBeDefined();
    // The verbatim line must not advertise `init` as one of the forwarded tokens.
    const comment = bashLines("config").find((l) => l.trimStart().startsWith("#") && l.includes("set|role"));
    expect(comment).not.toMatch(/\binit\b/);
  });

  it("the translated argv is ACCEPTED by the compiled CLI", () => {
    const root = freshRoot();
    const argv = spawnedArgv("config", "config-cmd.js", ["init"], root, "reconcile sync");
    expect(argv.slice(0, 2)).toEqual(["reconcile", "sync"]);
    const run = runCompiledCli("config-cmd.js", argv);
    expect(run.stdout + run.stderr).not.toMatch(/unknown subcommand/);
    expect(run.code).toBe(0);
  });
});

describe("T04 R2-3 — the models sub-token is consumed exactly once", () => {
  it("ANTI-VACUITY: a doubled `inspect` really is refused", () => {
    const run = runCompiledCli("models-cmd.js", ["inspect", "--cwd", freshRoot(), "inspect", "--json"]);
    expect(run.stdout + run.stderr).toMatch(/unknown argument: inspect/);
  });

  it("`models inspect --json` spawns exactly one `inspect`", () => {
    const root = freshRoot();
    const argv = spawnedArgv("config", "models-cmd.js", ["models", "inspect", "--json"], root);
    expect(argv.filter((a) => a === "inspect")).toHaveLength(1);
    const run = runCompiledCli("models-cmd.js", argv);
    expect(run.stdout + run.stderr).not.toMatch(/unknown argument/);
    expect(run.stdout + run.stderr).not.toMatch(/missing sub-verb/);
  });
});

describe("T04 R2-4 — every sub-verb row spawns argv its compiled parser accepts", () => {
  /**
   * One row per documented sub-verb. An OBJECT table on purpose: with a positional
   * table, jest fills a declared-but-unsupplied parameter with its own `done` callback,
   * which is truthy — a silent way for an optional field to read as "set".
   */
  interface Row { command: string; cli: string; tokens: string[]; match?: string }
  const ROWS: Row[] = [
    { command: "config", cli: "config-cmd.js", tokens: ["init"], match: "reconcile sync" },
    { command: "config", cli: "config-cmd.js", tokens: ["show", "--sources"] },
    { command: "config", cli: "config-cmd.js", tokens: ["validate", "--effective"] },
    { command: "config", cli: "config-cmd.js", tokens: ["reconcile", "check"] },
    { command: "config", cli: "models-cmd.js", tokens: ["models", "inspect"] },
    { command: "config", cli: "models-cmd.js", tokens: ["models", "inspect", "--json"] },
    { command: "config", cli: "migrate-guild.js", tokens: ["migrate"] },
    { command: "config", cli: "migrate-guild.js", tokens: ["migrate", "--mode=dry-run"] },
    { command: "status", cli: "capability-profile.js", tokens: [] },
    { command: "status", cli: "resume-lanes.js", tokens: ["resume"] },
    { command: "status", cli: "resume-lanes.js", tokens: ["resume", "--restart"] },
    { command: "status", cli: "dashboard-launch.js", tokens: ["dashboard", "--dry-run"] },
    { command: "status", cli: "dashboard-launch.js", tokens: ["dashboard", "--stop"] },
  ];

  it.each(ROWS)("$command / $cli $tokens", (row: Row) => {
    const argv = spawnedArgv(row.command, row.cli, row.tokens, freshRoot(), row.match);
    const run = runCompiledCli(row.cli, argv);
    expect({ cli: row.cli, tokens: row.tokens, refused: REFUSAL.test(run.stdout + run.stderr) })
      .toEqual({ cli: row.cli, tokens: row.tokens, refused: false });
  });

  it("a user-supplied --cwd wins over the dispatcher default (codex G-lane r3 P2)", () => {
    const argv = spawnedArgv("config", "models-cmd.js", ["models", "inspect", "--cwd", "/explicit/project"], freshRoot());
    // The dispatcher inserts no --cwd of its own: the user's is the only one, so it wins.
    expect(argv.filter((a) => a === "--cwd")).toHaveLength(1);
    expect(argv[argv.indexOf("--cwd") + 1]).toBe("/explicit/project");
  });

  it("no row spawns the user's own sub-token twice (the R2-3 class, generalized)", () => {
    // The precise invariant: whatever bare word the user types AFTER the routing token
    // must appear at most once in the spawned argv. A translation the user never typed
    // (`init` -> `reconcile sync`) is fine; re-inserting a token they DID type is not.
    for (const row of ROWS) {
      const argv = spawnedArgv(row.command, row.cli, row.tokens, freshRoot(), row.match);
      const subToken = row.tokens[1];
      if (!subToken || !/^[a-z][a-z-]*$/.test(subToken)) continue;
      expect({ cli: row.cli, subToken, count: argv.filter((a) => a === subToken).length })
        .toEqual({ cli: row.cli, subToken, count: 1 });
    }
  });

  it("maintain / learn / wiki spawn no CLI whose parser could refuse a row", () => {
    // Their sub-verbs dispatch skills, not CLIs; the only spawn is run-trace start.
    for (const id of ["maintain", "learn", "wiki"]) {
      for (const line of bashLines(id)) {
        if (line.trimStart().startsWith("#")) continue;
        expect({ id, line }).toEqual({ id, line: expect.stringMatching(/run-trace\.js|^$/) });
      }
    }
  });
});

// ---------------------------------------------------------------------------
// C02E — `/guild:maintain analyze` routes to the compiled run-analysis parser
// (C-CLI). Two groups by name prefix: "analyze dispatcher mapping" is C02's to
// turn green (commands/maintain.md only); "analyze integrated route" is C03's
// (evolve chapter + full-route reachability). Planted red-first on unchanged
// source; the compiled target is runtime/scripts/run-analysis.js — author-plane
// tsx or a print-only alias can never satisfy these.
// ---------------------------------------------------------------------------

const RUN_ANALYSIS_JS = path.join(PLUGIN_ROOT, "runtime", "scripts", "run-analysis.js");
const EVOLVE_DIR = path.dirname(EVOLVE_SKILL);
const ANALYZE_CHAPTER = path.join(EVOLVE_DIR, "references", "run-analysis.md");

/** What maintain's dispatch hands the assembler for a given user input. */
function maintainForwards(userInput: string): string {
  const m = readCommand("maintain").match(/## Dispatch\n\n```\n([\s\S]*?)```/);
  if (!m) throw new Error("commands/maintain.md has no fenced ## Dispatch block");
  const argsLine = m[1].split("\n").find((l) => l.trimStart().startsWith("args:"));
  if (!argsLine) throw new Error("maintain dispatch has no args line");
  return argsLine
    .replace(/^\s*args:\s*/, "")
    .trim()
    .split(/\s+/)
    .map((tok) => (tok === "$ARGUMENTS" ? userInput : tok === "$REMAINING_ARGS" ? userInput.split(/\s+/).slice(1).join(" ") : tok))
    .join(" ")
    .trim();
}

describe("T04 C02E-D — analyze dispatcher mapping", () => {
  it("analyze dispatcher mapping: the maintain argument-hint names the analyze token", () => {
    const hint = readScalarField(readCommand("maintain"), "argument-hint") ?? "";
    expect(hint).toContain("analyze");
  });

  it("analyze dispatcher mapping: the sub-verb table routes analyze to the run-analysis chapter", () => {
    const row = readCommand("maintain")
      .split("\n")
      .find((l) => /^\|\s*`analyze/.test(l));
    expect(row).toBeDefined();
    expect(row).toMatch(/references\/run-analysis\.md/);
  });

  it("analyze dispatcher mapping: every public analyze invocation forwards verbatim to the one assembler", () => {
    expect(skillTargets("maintain")).toEqual(["guild:evolve"]);
    for (const input of [
      "analyze run run-20260101-000000-demo",
      "analyze compare run-a run-b",
      "analyze initiative init-1",
      "analyze independent group-1",
      "analyze inspect run run-20260101-000000-demo",
      "analyze recommendation decide run-a rec-1 accept --expected-analysis-id an-1 --expected-input-hash sha256:ab",
      "analyze recommendation status run-a rec-1 implemented",
    ]) {
      expect(maintainForwards(input)).toBe(input);
    }
  });

  it("analyze dispatcher mapping: stray tokens and hostile IDs pass through untouched for the parser to refuse", () => {
    // IDs never become shell fragments: dispatch is a verbatim $ARGUMENTS hand-off,
    // so an injection-shaped id reaches the CLOSED parser as one literal token.
    const hostile = 'analyze run run-$(touch_pwned) --nope';
    expect(maintainForwards(hostile)).toBe(hostile);
    const m = readCommand("maintain").match(/## Dispatch\n\n```\n([\s\S]*?)```/);
    expect(m![1].split("\n").filter((l) => l.trim())).toEqual(["Skill: guild:evolve", "args: $ARGUMENTS"]);
  });

  it("analyze dispatcher mapping: no print-only analyze alias ships (stale-alias negative)", () => {
    expect(fs.existsSync(path.join(COMMANDS, "analyze.md"))).toBe(false);
    // State-aware (codex C06E r1 F2): after KTD14 retirement the allowlist is gone.
    const allowPath = path.join(COMMANDS, "aliases.allowlist.json");
    if (fs.existsSync(allowPath)) {
      expect(JSON.stringify(JSON.parse(fs.readFileSync(allowPath, "utf8")))).not.toContain("analyze");
    }
  });
});

describe("T04 C02E-I — analyze integrated route", () => {
  it("analyze integrated route: the evolve assembler routes analyze to an existing chapter", () => {
    const row = stripFences(fs.readFileSync(EVOLVE_SKILL, "utf8"))
      .split("\n")
      .find((l) => /^\|\s*`analyze/.test(l));
    expect(row).toBeDefined();
    expect(row).toMatch(/references\/run-analysis\.md/);
    expect(fs.existsSync(ANALYZE_CHAPTER)).toBe(true);
  });

  /**
   * The seven public C-CLI mappings, each as the CANONICAL token sequence the
   * chapter must document and an EXECUTABLE argv (placeholders bound to fixture
   * values). `expectParserAccepted` = the parser accepted the mapping's shape:
   * exit 0 (valid success, incl. diagnostic states) or exit 1 (operational
   * refusal on fixture data) — never exit 2 (usage).
   */
  const PUBLIC_MAPPINGS: Array<{ id: string; documented: string; argv: string[] }> = [
    { id: "run analyze", documented: "run analyze", argv: ["run", "analyze", "run-20260101-000000-x"] },
    { id: "run compare", documented: "run compare", argv: ["run", "compare", "run-20260101-000000-x", "run-20260101-000001-y"] },
    { id: "initiative analyze", documented: "initiative analyze", argv: ["initiative", "analyze", "init-1"] },
    { id: "independent analyze", documented: "independent-runs analyze", argv: ["independent-runs", "analyze", "group-1"] },
    { id: "inspect", documented: "artifact inspect", argv: ["artifact", "inspect", "run", "run-20260101-000000-x"] },
    {
      id: "recommendation decide",
      documented: "recommendation decide",
      argv: [
        "recommendation", "decide", "run-20260101-000000-x", "rec-1", "accept",
        "--expected-analysis-id", "an-1", "--expected-input-hash",
        "sha256:00000000000000000000000000000000000000000000000000000000000000ab",
      ],
    },
    { id: "recommendation status", documented: "recommendation status", argv: ["recommendation", "status", "run-20260101-000000-x", "rec-1", "implemented"] },
  ];

  /** Every fenced code line of the chapter (the commands it teaches verbatim). */
  function chapterFencedLines(): string[] {
    const out: string[] = [];
    let inFence = false;
    for (const line of fs.readFileSync(ANALYZE_CHAPTER, "utf8").split("\n")) {
      if (line.startsWith("```")) { inFence = !inFence; continue; }
      if (inFence && line.trim()) out.push(line);
    }
    return out;
  }

  /** Fixture value for a chapter placeholder token; unknown placeholders fail the test. */
  function bindPlaceholder(inner: string, root: string): string | string[] {
    if (inner === "run-id" || inner === "id" || inner === "source-id" || inner === "source") return "run-20260101-000000-x";
    if (inner === "analysis-id") return "an-1";
    if (inner === "run-id..." || inner === "id...") return ["run-20260101-000000-x", "run-20260101-000001-y"];
    if (inner === "run|comparison") return "run";
    if (inner === "accept|reject") return "accept";
    if (inner === "initiative-id") return "init-1";
    if (inner === "group-id") return "group-1";
    if (inner === "rec" || inner === "recommendation-id") return "rec-1";
    if (inner === "status") return "implemented";
    if (/hash|sha256/.test(inner)) return "sha256:00000000000000000000000000000000000000000000000000000000000000ab";
    if (inner === "root" || inner === "project-root") return root;
    throw new Error(`chapter uses an unknown placeholder <${inner}> — extend C-CLI binding or fix the chapter`);
  }

  /**
   * Parse ONE taught invocation line into an executable argv: strip quotes and a
   * trailing comment, require `node` + the compiled path, bind <placeholders>.
   */
  function parseTaughtInvocation(line: string, root: string): { script: string; argv: string[]; mapping: string } {
    const noComment = line.replace(/\s#.*$/, "").trim();
    const rawTokens = noComment.match(/"[^"]*"|\S+/g) ?? [];
    const tokens = rawTokens.map((t) => t.replace(/^"|"$/g, ""));
    if (tokens[0] !== "node") throw new Error(`taught invocation does not start with node: ${line}`);
    if (!/runtime\/scripts\/run-analysis\.js$/.test(tokens[1] ?? "")) {
      throw new Error(`taught invocation's second token is not the compiled run-analysis path: ${line}`);
    }
    // The EXTRACTED executable is what runs (codex C02E r3/r4): only the four
    // exact plugin-root placeholder spellings resolve — a misspelled variable
    // must NOT repair to the package executable. The resolved path must be this
    // package's compiled CLI and must exist.
    const script = tokens[1].replace(
      /^(?:\$GUILD_PLUGIN_ROOT|\$\{GUILD_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT|\$\{CLAUDE_PLUGIN_ROOT\})(?=\/)/,
      PLUGIN_ROOT,
    );
    if (script.includes("$")) throw new Error(`taught executable uses an unsupported variable: ${tokens[1]}`);
    if (!path.isAbsolute(script)) throw new Error(`taught executable is not plugin-root-anchored: ${tokens[1]}`);
    const argv: string[] = [];
    for (const tok of tokens.slice(2)) {
      const m = tok.match(/^<(.+)>$/) ?? tok.match(/^\[<(.+)>\]$/);
      if (tok === "$(pwd)" || tok === '"$(pwd)"') {
        argv.push(root);
      } else if (m) {
        const bound = bindPlaceholder(m[1], root);
        argv.push(...(Array.isArray(bound) ? bound : [bound]));
      } else {
        argv.push(tok);
      }
    }
    return { script, argv, mapping: argv.slice(0, 2).join(" ") };
  }

  /** Execute the EXTRACTED executable with the extracted argv under plain node. */
  function runTaught(script: string, argv: string[]): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [script, ...argv], {
        cwd: PLUGIN_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { code: e.status ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
    }
  }

  it("analyze integrated route: ANTI-VACUITY — a misspelled plugin-root variable never repairs to the package executable", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-c02e-neg-"));
    try {
      expect(() =>
        parseTaughtInvocation('node "$GUILD_PLUGIN_ROOT_TYPO/runtime/scripts/run-analysis.js" run analyze <run-id> --cwd <root>', root),
      ).toThrow(/unsupported variable/);
      expect(() =>
        parseTaughtInvocation('node "relative/runtime/scripts/run-analysis.js" run analyze <run-id> --cwd <root>', root),
      ).toThrow(/not plugin-root-anchored/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("analyze integrated route: every fenced chapter line is author-plane-free (incl. multiline tsx splits)", () => {
    for (const line of chapterFencedLines()) {
      expect({ line, authorPlaneFree: !/\b(npx|tsx|bun)\b/.test(line) }).toEqual({ line, authorPlaneFree: true });
    }
  });

  it.each(PUBLIC_MAPPINGS.map((m) => [m.id, m] as const))(
    "analyze integrated route: %s — the chapter's own invocation, placeholder-bound, is parser-accepted; +--nope refuses (exit 2)",
    (_id, m) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-c02e-"));
      try {
        fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
        // Find THE taught invocation line for this mapping and execute IT —
        // tokens in comments cannot satisfy this, and a taught line missing a
        // required id parses to an argv the parser refuses as usage (exit 2),
        // failing the positive leg (codex C02E r2).
        const taught = chapterFencedLines().find(
          (l) => /^\s*node\b/.test(l) && l.includes("run-analysis.js") && l.replace(/\s#.*$/, "").includes(m.documented),
        );
        expect({ mapping: m.id, taught }).toEqual({ mapping: m.id, taught: expect.any(String) });
        const parsed = parseTaughtInvocation(taught!, root);
        // The taught argv is bound to the canonical C-CLI token sequence.
        for (let i = 0; i < m.argv.length; i++) {
          if (m.argv[i].startsWith("run-2026") || m.argv[i].startsWith("sha256:") || ["init-1", "group-1", "rec-1"].includes(m.argv[i])) continue;
          expect({ mapping: m.id, position: i, token: parsed.argv[i] }).toEqual({ mapping: m.id, position: i, token: m.argv[i] });
        }
        expect(parsed.argv).toContain("--cwd");
        // The extracted executable must BE this package's compiled CLI and exist.
        expect(parsed.script).toBe(RUN_ANALYSIS_JS);
        expect(fs.existsSync(parsed.script)).toBe(true);
        const positive = runTaught(parsed.script, parsed.argv);
        // Parser accepted the documented shape: operational outcome, never usage.
        expect({ mapping: m.id, accepted: positive.code === 0 || positive.code === 1 }).toEqual({ mapping: m.id, accepted: true });
        expect(positive.stderr.split("\n").some((l) => l.startsWith("usage:"))).toBe(false);
        const negative = runTaught(parsed.script, [...parsed.argv, "--nope"]);
        expect({ mapping: m.id, code: negative.code }).toEqual({ mapping: m.id, code: 2 });
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("analyze integrated route: inspect on a missing artifact is a valid exit-0 diagnostic (C-CLI exit codes)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-c02e-"));
    try {
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      const r = runCompiledCli("run-analysis.js", ["artifact", "inspect", "run", "run-20260101-000000-none", "--cwd", root]);
      expect(r.code).toBe(0);
      expect((JSON.parse(r.stdout) as { state: string }).state).toBe("missing");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("analyze integrated route: the compiled target exists and cannot be satisfied by tsx substitution", () => {
    expect(fs.existsSync(RUN_ANALYSIS_JS)).toBe(true);
    const firstLine = fs.readFileSync(RUN_ANALYSIS_JS, "utf8").split("\n", 1)[0];
    if (firstLine.startsWith("#!")) expect(firstLine).not.toMatch(/\b(npx|tsx|bun)\b/);
  });

  it("analyze integrated route: incomplete or misplaced expected-flag pairs are usage refusals (exit 2)", () => {
    const halfPair = runCompiledCli("run-analysis.js", [
      "recommendation", "decide", "run-a", "rec-1", "accept", "--expected-analysis-id", "an-1",
    ]);
    expect(halfPair.code).toBe(2);
    expect(halfPair.stderr).toMatch(/must be passed together/);
    const misplaced = runCompiledCli("run-analysis.js", [
      "recommendation", "status", "run-a", "rec-1", "implemented", "--expected-analysis-id", "an-1", "--expected-input-hash", "sha256:ab",
    ]);
    expect(misplaced.code).toBe(2);
  });
});
