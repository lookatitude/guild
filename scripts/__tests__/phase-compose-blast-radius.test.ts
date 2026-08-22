/**
 * scripts/__tests__/phase-compose-blast-radius.test.ts
 *
 * Lane E1 (G-PHASE-COMPOSE, OD-6) — the CROSS-CUTTING blast-radius regression for
 * the team-artifact contract change: `.guild/team/<slug>.yaml` →
 * `.guild/team/<slug>.<phase>.yaml`, fronted by `resolveTeamFile` + a `.current`
 * pointer (phase-compose-plan.md Lane E1, §4 consumer list C1–C13, §6 invariants).
 *
 * SCOPE BOUNDARY vs the T1 unit suite (scripts/__tests__/team-file.test.ts):
 *   - team-file.test.ts proves the RESOLVER PRIMITIVES in isolation.
 *   - THIS suite proves the CONTRACT CHANGE DID NOT SILENTLY BREAK A CONSUMER:
 *       (A) every consumer resolves correctly in all 3 resolver states,
 *       (B) the 6+ §6 back-compat invariants hold as binary assertions,
 *       (C) the fixture sweep covers BOTH worlds (legacy + per-phase),
 *       (D) C4 slugFromTeamPath tolerates the per-phase basename in launcher context,
 *       (E) a STATIC guard: no runtime consumer hard-codes a single-file team path,
 *       (F) the T0 foundation works end-to-end (recordPhase → readActivePhase).
 *
 * TDD discipline (CLAUDE.md): assertions are written against the SHIPPED behavior
 * the contract promises; a regression in any consumer turns one of these red. This
 * lane does NOT fix bugs — a red test is filed back to the owning lane.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  resolveTeamFile,
  teamFilePath,
  legacyTeamFilePath,
  slugFromTeamPath,
  readActivePhase,
  readCurrentPhasePointer,
  writeCurrentPhasePointer,
  CANONICAL_PHASES,
} from "../lib/team-file";
import { buildPrompt } from "../lib/team-backend";
import { appendPhase } from "../lib/run-lifecycle";

// T0 NOTE: the phase commands call `recordPhase` (hooks/lib/run-trace.ts), a thin
// wrapper that resolves runId from the current-run-id sentinel then delegates to
// `appendPhase`. run-trace.ts cannot be imported under ts-jest (it uses `.js`-suffixed
// imports the CommonJS resolver can't remap — the same quirk team-file.ts documents),
// so this suite exercises the REAL writer `appendPhase` directly with an explicit
// runId. Behaviorally identical to recordPhase's record path (recordPhase adds only
// sentinel→runId resolution, which we supply). The ts-jest-unreachability of
// hooks/lib is filed as a coverage followup, not a defect in T0's logic.

/** Minimal real-fs RunLifecycleEnv — appendPhase uses only fs.readFile/writeFile + now(). */
function realEnv() {
  return {
    now: () => "2026-06-07T00:00:00Z",
    fs: {
      mkdirp: (p: string) => fs.mkdirSync(p, { recursive: true }),
      writeFile: (p: string, c: string) => {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, c, "utf8");
      },
      readFile: (p: string): string | null => {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          return null;
        }
      },
      exists: (p: string) => fs.existsSync(p),
      removeTree: (p: string) => fs.rmSync(p, { recursive: true, force: true }),
    },
    withRunBindingExclusion: <T>(_root: string, _runId: string, fn: () => T): T => fn(),
    resolveHost: (requested: string) => ({ requested, resolved: "claude" as const }),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Paths + helpers
// ───────────────────────────────────────────────────────────────────────────

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURES = path.join(PLUGIN_ROOT, "scripts", "fixtures");

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-e1-blast-"));
  fs.mkdirSync(path.join(root, ".guild", "team"), { recursive: true });
  return root;
}

/** Stage a fixture into <root>/.guild/team/<basename>. Returns the dest path. */
function stage(root: string, fixtureFile: string, destBasename: string): string {
  const dst = path.join(root, ".guild", "team", destBasename);
  fs.copyFileSync(path.join(FIXTURES, fixtureFile), dst);
  return dst;
}

/** Seed a pre-T0 run.yaml (phase:null, empty phases_log) — the real main-path shape. */
function seedRun(root: string, runId: string): void {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "run.yaml"),
    [
      "schema_version: guild.run.v1",
      `run_id: ${runId}`,
      "command: /guild:plan",
      "run_class: full",
      "phase: null",
      "phases_log: []",
      "status: open",
      "",
    ].join("\n"),
  );
}

function readConsumer(rel: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
}

const SLUG = "pricing-feature";

// ───────────────────────────────────────────────────────────────────────────
// (A) Resolver-state matrix — every code consumer resolves in all 3 states.
//
// Consumers funnel through resolveTeamFile via one of two CALL STYLES:
//   - dispatch-critical: explicit phase (from readActivePhase)  — C1,C2,C3,C13
//   - bare-scan:         phase=null (consults .current)         — C5,C7
// The matrix exercises BOTH styles across (a) per-phase present, (b) legacy-only,
// (c) double-miss → null.
// ───────────────────────────────────────────────────────────────────────────

describe("(A) resolver-state matrix × consumer call-styles", () => {
  const STYLES = [
    { name: "dispatch-critical (C1/C2/C3/C13 — explicit phase)", phase: "build" as string | null },
    { name: "bare-scan (C5/C7 — phase=null → .current)", phase: null as string | null },
  ];

  describe.each(STYLES)("$name", ({ phase }) => {
    it("(a) per-phase file present → resolves the per-phase file", () => {
      const root = makeRoot();
      stage(root, "team-subagent.build.yaml", `${SLUG}.build.yaml`);
      if (phase === null) writeCurrentPhasePointer(root, SLUG, "build");
      const r = resolveTeamFile(root, SLUG, phase);
      expect(r).toBe(path.join(root, ".guild", "team", `${SLUG}.build.yaml`));
    });

    it("(b) legacy-only → resolves the legacy file (read-only back-compat)", () => {
      const root = makeRoot();
      stage(root, "team-subagent.yaml", `${SLUG}.yaml`);
      // bare-scan has no .current → still finds legacy; dispatch passes a phase with no per-phase file → legacy.
      const r = resolveTeamFile(root, SLUG, phase);
      expect(r).toBe(path.join(root, ".guild", "team", `${SLUG}.yaml`));
    });

    it("(c) double-miss → null (compose trigger, never a fabricated path or throw)", () => {
      const root = makeRoot();
      if (phase === null) {
        // even with a dangling .current pointer, no file ⇒ null (not a crash)
        writeCurrentPhasePointer(root, SLUG, "qa");
      }
      let r: string | null = "unset";
      expect(() => {
        r = resolveTeamFile(root, SLUG, phase);
      }).not.toThrow();
      expect(r).toBeNull();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (B) §6 back-compat invariants — each a binary assertion.
// ───────────────────────────────────────────────────────────────────────────

describe("(B) §6 back-compat invariants", () => {
  it("§6.1 legacy honored READ-ONLY — byte-identical after resolution", () => {
    const root = makeRoot();
    const legacyPath = stage(root, "team-agent-team.yaml", `${SLUG}.yaml`);
    const before = fs.readFileSync(legacyPath);
    const beforeMtime = fs.statSync(legacyPath).mtimeMs;
    // a consumer resolves + reads it across both call styles
    for (const phase of ["build", null] as (string | null)[]) {
      const r = resolveTeamFile(root, SLUG, phase);
      expect(r).toBe(legacyPath);
      fs.readFileSync(r as string); // simulate the consumer reading it
    }
    const after = fs.readFileSync(legacyPath);
    expect(after.equals(before)).toBe(true); // byte-identical
    expect(fs.statSync(legacyPath).mtimeMs).toBe(beforeMtime); // never rewritten
  });

  it("§6.3 writer never clobbers legacy — compose-pass writes only <slug>.<phase>.yaml + .current", () => {
    const root = makeRoot();
    const legacyPath = stage(root, "team-subagent.yaml", `${SLUG}.yaml`);
    const before = fs.readFileSync(legacyPath);
    // simulate the S1 compose-pass write surface (per-phase file + pointer)
    fs.writeFileSync(teamFilePath(root, SLUG, "build"), "phase: build\nspecialists: []\n");
    writeCurrentPhasePointer(root, SLUG, "build");
    // legacy untouched
    expect(fs.readFileSync(legacyPath).equals(before)).toBe(true);
    // the two writers produced exactly the intended artifacts, never <slug>.yaml anew
    const teamDir = path.join(root, ".guild", "team");
    const written = fs.readdirSync(teamDir).sort();
    expect(written).toEqual(
      [`${SLUG}.build.yaml`, `${SLUG}.current`, `${SLUG}.yaml`].sort(),
    );
  });

  it("§6.5 .current is a MIRROR, not authority — explicit phase beats a disagreeing .current", () => {
    const root = makeRoot();
    stage(root, "team-subagent.build.yaml", `${SLUG}.build.yaml`);
    stage(root, "team-agent-team.qa.yaml", `${SLUG}.qa.yaml`);
    writeCurrentPhasePointer(root, SLUG, "qa"); // mirror says qa
    // run-state authority says build → resolver honors the explicit phase, not .current
    const r = resolveTeamFile(root, SLUG, "build");
    expect(r).toBe(path.join(root, ".guild", "team", `${SLUG}.build.yaml`));
    // only when phase is null does .current speak
    expect(resolveTeamFile(root, SLUG, null)).toBe(
      path.join(root, ".guild", "team", `${SLUG}.qa.yaml`),
    );
  });

  it("§6.6 null is a TRIGGER, not a crash — no exception, no write outside .guild/team/", () => {
    const root = makeRoot();
    const teamDir = path.join(root, ".guild", "team");
    const before = fs.readdirSync(teamDir);
    expect(resolveTeamFile(root, "ghost", "build")).toBeNull();
    expect(resolveTeamFile(root, "ghost", null)).toBeNull();
    expect(fs.readdirSync(teamDir)).toEqual(before); // resolver wrote nothing
  });

  it("§6.7 per-phase WINS when both exist — for every canonical phase", () => {
    for (const phase of CANONICAL_PHASES) {
      const root = makeRoot();
      stage(root, "team-subagent.yaml", `${SLUG}.yaml`); // legacy
      fs.writeFileSync(teamFilePath(root, SLUG, phase), `phase: ${phase}\n`); // per-phase
      expect(resolveTeamFile(root, SLUG, phase)).toBe(
        path.join(root, ".guild", "team", `${SLUG}.${phase}.yaml`),
      );
    }
  });

  it("§6.8 persisted reference carries the RESOLVED path — C13 buildPrompt interpolates it, not a reconstruction", () => {
    const root = makeRoot();
    stage(root, "team-subagent.build.yaml", `${SLUG}.build.yaml`);
    const resolved = resolveTeamFile(root, SLUG, "build") as string;
    // C13: the orchestrator prompt must carry the resolved per-phase path
    const prompt = buildPrompt(SLUG, "run-xyz", null, resolved);
    expect(prompt).toContain(resolved);
    expect(prompt).toContain(`${SLUG}.build.yaml`);
    // and must NOT silently reconstruct the legacy single-file path when a resolved one exists
    expect(prompt).not.toContain(`.guild/team/${SLUG}.yaml\``);
  });

  it("§6.8 (corollary) buildPrompt falls back to legacy reconstruction ONLY when no path threaded", () => {
    // back-compat: a caller that hasn't adopted resolveTeamFile still gets a usable prompt
    const prompt = buildPrompt(SLUG, "run-xyz", null /* no teamPath */);
    expect(prompt).toContain(`.guild/team/${SLUG}.yaml`);
  });

  it("§6.9 phase-token safety — teamFilePath THROWS on non-canonical; resolvers SWALLOW", () => {
    const root = makeRoot();
    stage(root, "team-subagent.yaml", `${SLUG}.yaml`);
    // builder rejects a poisoned token (never emits a filename)
    expect(() => teamFilePath(root, SLUG, "deploy")).toThrow(/non-canonical/);
    expect(() => teamFilePath(root, SLUG, "../../etc/passwd")).toThrow();
    // resolvers tolerate the same token → fall through to legacy, no throw
    expect(() => resolveTeamFile(root, SLUG, "deploy")).not.toThrow();
    expect(resolveTeamFile(root, SLUG, "deploy")).toBe(
      path.join(root, ".guild", "team", `${SLUG}.yaml`),
    );
    // readActivePhase degrades a poisoned run-state token to null
    const runId = "run-bad";
    const runDir = path.join(root, ".guild", "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.yaml"),
      "phase: deploy\nphases_log:\n  - phase: deploy\n    at: 2026-06-07T00:00:00Z\n",
    );
    expect(readActivePhase(root, runId)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (C) Fixture sweep — both worlds present + resolvable; legacy kept as proof.
// ───────────────────────────────────────────────────────────────────────────

describe("(C) fixture sweep — legacy + per-phase siblings (C12)", () => {
  const PAIRS = [
    { legacy: "team-subagent.yaml", perPhase: "team-subagent.build.yaml", phase: "build" },
    { legacy: "team-agent-team.yaml", perPhase: "team-agent-team.qa.yaml", phase: "qa" },
    { legacy: "team-mixed-host.yaml", perPhase: "team-mixed-host.ops.yaml", phase: "ops" },
  ];

  it.each(PAIRS)("both $legacy and $perPhase exist on disk (back-compat proof retained)", ({ legacy, perPhase }) => {
    expect(fs.existsSync(path.join(FIXTURES, legacy))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURES, perPhase))).toBe(true);
  });

  it.each(PAIRS)("$perPhase resolves as a per-phase file and recovers its slug", ({ perPhase, phase }) => {
    const root = makeRoot();
    const slug = "fix-slug";
    stage(root, perPhase, `${slug}.${phase}.yaml`);
    const r = resolveTeamFile(root, slug, phase);
    expect(r).toBe(path.join(root, ".guild", "team", `${slug}.${phase}.yaml`));
    expect(slugFromTeamPath(r as string)).toBe(slug);
  });

  it.each(PAIRS)("$legacy still resolves under the legacy path and recovers its slug", ({ legacy }) => {
    const root = makeRoot();
    const slug = "fix-slug";
    stage(root, legacy, `${slug}.yaml`);
    const r = resolveTeamFile(root, slug, "build"); // no per-phase → legacy
    expect(r).toBe(path.join(root, ".guild", "team", `${slug}.yaml`));
    expect(slugFromTeamPath(r as string)).toBe(slug);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (D) C4 — slugFromTeamPath tolerates the per-phase basename in launcher context.
// (The launcher imports slugFromTeamPath and calls it on whatever --team path it
//  is handed; this asserts the real fixture basenames both round-trip.)
// ───────────────────────────────────────────────────────────────────────────

describe("(D) C4 launcher slugFromTeamPath — both basenames the launcher may receive", () => {
  it("derives the same slug from legacy and per-phase basenames", () => {
    expect(slugFromTeamPath(".guild/team/pricing-feature.yaml")).toBe("pricing-feature");
    expect(slugFromTeamPath(".guild/team/pricing-feature.build.yaml")).toBe("pricing-feature");
  });

  it("the launcher imports slugFromTeamPath from team-file (not a stale local copy)", () => {
    const src = readConsumer("scripts/agent-team-launcher.ts");
    expect(src).toMatch(/import\s*\{[^}]*slugFromTeamPath[^}]*\}\s*from\s*["']\.\/lib\/team-file["']/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (E) Static blast-radius guard — no runtime consumer hard-codes a single-file
//     team path as a LIVE read/write target. This is the "did any consumer get
//     left behind?" gate. Comment/doc lines, the guarded `teamPath ??` fallback,
//     and legacy/deprecation-annotated lines are allowed.
// ───────────────────────────────────────────────────────────────────────────

describe("(E) static guard — no consumer hard-codes a single-file team path", () => {
  // Runtime consumers that RESOLVE a team path → must reference resolveTeamFile.
  const MUST_RESOLVE: Array<[string, string]> = [
    ["C1 plan", "skills/meta/plan/SKILL.md"],
    ["C2 execute-plan", "skills/meta/execute-plan/SKILL.md"],
    ["C3 dispatch", "skills/meta/execute-plan/dispatch.md"],
    ["C5 status", "commands/status.md"],
  ];
  it.each(MUST_RESOLVE)("%s resolves via resolveTeamFile", (_label, rel) => {
    expect(readConsumer(rel)).toContain("resolveTeamFile");
  });

  // Text-only consumers → must speak the per-phase vocabulary (no logic change).
  const MUST_SPEAK_PERPHASE: Array<[string, string]> = [
    ["C7 create-specialist", "skills/meta/create-specialist/workflow.md"],
    ["C8 build", "commands/build.md"],
    ["C9 plan-cmd", "commands/plan.md"],
    ["C11 dispatching-parallel-agents", "skills/meta/dispatching-parallel-agents/SKILL.md"],
  ];
  it.each(MUST_SPEAK_PERPHASE)("%s references the per-phase filename", (_label, rel) => {
    expect(readConsumer(rel)).toMatch(/\.<phase>\.yaml|\.\$\{phase\}\.yaml/);
  });

  // C6 review confirmed no-op (reads the plan only — never resolves a team path).
  it("C6 review is a confirmed no-op consumer (no team-path resolution)", () => {
    const src = readConsumer("skills/meta/review/SKILL.md");
    expect(src).not.toMatch(/\.guild\/team\/|resolveTeamFile|teamPath/);
  });

  // C13 buildPrompt is migrated: param present + guarded fallback.
  it("C13 buildPrompt takes a teamPath param and prefers it over reconstruction", () => {
    // W3 moved buildPrompt from team-backend.ts to host/tmux-backend.ts; the module reorg
    // moved the implementation again to src/modules/prompting while the old exports stay live.
    const src = readConsumer("src/modules/prompting/workflows/team-prompt.ts");
    expect(src).toMatch(/teamPath\?\s*:\s*string/); // param exists
    expect(src).toContain("teamPath ?? `.guild/team/${slug}.yaml`"); // guarded fallback, not unconditional
  });

  // The forbidden-pattern scan: a slug-templated legacy path used as live code.
  const RUNTIME_CONSUMERS = [
    "skills/meta/plan/SKILL.md",
    "skills/meta/execute-plan/SKILL.md",
    "skills/meta/execute-plan/dispatch.md",
    "commands/status.md",
    "skills/meta/review/SKILL.md",
    "skills/meta/create-specialist/workflow.md",
    "commands/build.md",
    "commands/plan.md",
    "skills/meta/dispatching-parallel-agents/SKILL.md",
    "scripts/agent-team-launcher.ts",
    "scripts/lib/team-backend.ts",
  ];
  it.each(RUNTIME_CONSUMERS)("%s has no un-annotated single-file team construction", (rel) => {
    const lines = readConsumer(rel).split("\n");
    const offenders = lines.filter((line) => {
      const isTemplatedLegacy = /team\/(\$\{slug\}|<slug>)\.yaml/.test(line);
      if (!isTemplatedLegacy) return false;
      const annotated =
        /legacy|deprecat|read-only|honored|<phase>|resolveTeamFile|back-compat|teamPath/i.test(line);
      const trimmed = line.trimStart();
      const isComment =
        trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith(">");
      return !annotated && !isComment;
    });
    expect(offenders).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (F) T0 foundation — recordPhase (real writer) → readActivePhase (real reader).
//     Proves phase-aware composition has a real foundation: after a simulated
//     /guild:plan full-run intake, the active phase is the real token, not null.
// ───────────────────────────────────────────────────────────────────────────

describe("(F) T0 foundation — full-run phase tracking is real end-to-end", () => {
  it("pre-T0 shape reads null; appendPhase makes the active phase real and advances it", () => {
    const root = makeRoot();
    const runId = "run-e1-t0";
    seedRun(root, runId);
    const env = realEnv();

    // Pre-T0 main-path shape: phase null → readActivePhase is null (the gap T0 closes).
    expect(readActivePhase(root, runId)).toBeNull();

    // Simulated /guild:plan intake (join path) records its own phase token.
    expect(appendPhase(env, root, runId, "plan")).toBe(true);
    expect(readActivePhase(root, runId)).toBe("plan");

    // A subsequent /guild:build in the same run advances the active phase.
    expect(appendPhase(env, root, runId, "build")).toBe(true);
    expect(readActivePhase(root, runId)).toBe("build");
  });

  it("appendPhase rejects a non-canonical token (records nothing, returns false)", () => {
    const root = makeRoot();
    const runId = "run-e1-bad";
    seedRun(root, runId);
    expect(appendPhase(realEnv(), root, runId, "deploy")).toBe(false);
    expect(readActivePhase(root, runId)).toBeNull(); // still no phase recorded
  });
});
