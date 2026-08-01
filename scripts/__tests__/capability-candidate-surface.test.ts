/**
 * F7 — candidate surfacing, the hard precondition on D04's `observe` default.
 *
 * B5 ("Automatic Learn") is explicit: *"candidates persisted and SURFACED by
 * /guild:status. F7 is a hard precondition on the `observe` default (D04). If
 * /guild:status does not surface candidates, this row FAILS — do not waive it."*
 *
 * So the assertions here are not "the function returns an array". They are:
 *   - a real emitted profile's candidates come back out (round-trip, not fixture)
 *   - the surface is READ-ONLY, byte-for-byte (status is contractually read-only)
 *   - an empty list always says WHY (absent is never success)
 *   - the resolver-mode default flipped, and the pre-written flip test now holds
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  CANDIDATE_SCAN_LIMIT,
  listProfileRunIds,
  readLiveRosterIds,
  renderCandidateSection,
  surfaceCapabilityCandidates,
} from "../lib/capability/candidate-surface";
import { emitCapabilityProfile, type DerivedFacts } from "../lib/capability/profile-emit";
import {
  CAPABILITY_RESOLVER_MODE_AFTER_F7,
  CAPABILITY_RESOLVER_MODE_DEFAULT,
  DEFAULTS,
} from "../../src/modules/config/workflows/config-defaults";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-surface-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Facts carrying `n` candidates, all justified by one declared domain fact. */
function factsWith(n: number, kind: "agent" | "skill" = "agent"): DerivedFacts {
  return {
    domains: [
      { id: "d1", label: "dispatch", evidence_refs: ["codebase_map:src/a.ts"], confidence: "high" },
    ],
    boundaries: [],
    repeated_methods: [],
    coverage: { covered: [], uncovered: [], unmatched_roles: [] },
    candidates: Array.from({ length: n }, (_, i) => ({
      id: `c${i}`,
      kind,
      proposed_id: `${kind}-role-${i}`,
      justified_by: ["d1"],
      action: "propose" as const,
      defer_reason: null,
      confidence: "high" as const,
      owning_layer: "project",
    })),
  };
}

function emitInto(runId: string, facts: DerivedFacts) {
  return emitCapabilityProfile({
    projectRoot: tmp,
    runId,
    projectId: "fx",
    generatedAt: "2026-08-01T12:00:00Z",
    sourceCommit: null,
    resolverMode: "observe",
    suggestionBudget: 4,
    facts,
  });
}

/** Byte snapshot of everything under a root — the read-only proof. */
function snapshot(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push(`${r}:${fs.readFileSync(path.join(dir, e.name), "utf8")}`);
    }
  };
  try {
    walk(root, "");
  } catch {
    /* absent root — an empty snapshot is the right answer */
  }
  return out;
}

describe("F7 — the round trip: emitted candidates come back out", () => {
  it("surfaces the candidates a REAL emission wrote (not a hand-built fixture)", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBeNull();
    expect(s.source_run_id).toBe("run-20260801-120000-a");
    expect(s.pending.map((p) => p.candidate.proposed_id)).toEqual([
      "agent-role-0",
      "agent-role-1",
    ]);
  });

  it("the NEWEST run wins — an older profile is superseded, never merged", () => {
    expect(emitInto("run-20260801-090000-old", factsWith(3)).status).toBe("emitted");
    expect(emitInto("run-20260801-180000-new", factsWith(1)).status).toBe("emitted");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.source_run_id).toBe("run-20260801-180000-new");
    expect(s.pending).toHaveLength(1);
  });

  it("a candidate already in the roster is SATISFIED, not pending", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    // The roster directory does not exist yet — an empty project is exactly the
    // shape the observe default targets, so approving a candidate creates it.
    fs.mkdirSync(path.join(tmp, ".guild/agents"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/agents/agent-role-0.md"), "# minted\n");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.pending.map((p) => p.candidate.proposed_id)).toEqual(["agent-role-1"]);
    expect(s.satisfied.map((p) => p.candidate.proposed_id)).toEqual(["agent-role-0"]);
  });

  it("skill candidates match on `.guild/skills/<id>/SKILL.md`, not on the agent tree", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(1, "skill")).status).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(1);
    fs.mkdirSync(path.join(tmp, ".guild/skills/skill-role-0"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/skills/skill-role-0/SKILL.md"), "# s\n");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.pending).toHaveLength(0);
    expect(s.empty_reason).toBe("all_candidates_satisfied");
  });

  it("the roster is read from FILES, not from the derived registry", () => {
    // D4: files are the source of truth. A registry-based check would go wrong
    // exactly when the registry was stale — the moment it matters.
    fs.mkdirSync(path.join(tmp, ".guild/agents"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/agents/registry.yaml"), "agents: [{name: ghost}]\n");
    fs.writeFileSync(path.join(tmp, ".guild/agents/real.md"), "# real\n");
    const ids = readLiveRosterIds(tmp);
    expect([...ids.agents]).toEqual(["real"]);
    expect(ids.agents.has("ghost")).toBe(false);
  });
});

describe("F7 — READ-ONLY, because /guild:status is contractually read-only", () => {
  it("surfacing changes not one byte", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    const before = snapshot(path.join(tmp, ".guild"));
    surfaceCapabilityCandidates(tmp);
    renderCandidateSection(surfaceCapabilityCandidates(tmp));
    expect(snapshot(path.join(tmp, ".guild"))).toEqual(before);
  });

  it("creates no directory when there is nothing to read", () => {
    surfaceCapabilityCandidates(tmp);
    expect(fs.existsSync(path.join(tmp, ".guild"))).toBe(false);
  });
});

describe("F7 — an empty list always says WHY (absent is never success)", () => {
  it("distinguishes never-profiled from profiled-with-nothing", () => {
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("no_runs_directory");

    fs.mkdirSync(path.join(tmp, ".guild/runs"), { recursive: true });
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("no_profile_found");

    expect(emitInto("run-20260801-120000-a", factsWith(0)).status).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("profile_has_no_candidates");
  });

  it("a CORRUPT newest profile reports `profile_invalid` — it does NOT fall back", () => {
    // Falling back to an older profile would present stale candidates as current
    // and the reader would never learn the newest run's output was broken.
    expect(emitInto("run-20260801-090000-old", factsWith(2)).status).toBe("emitted");
    expect(emitInto("run-20260801-180000-new", factsWith(2)).status).toBe("emitted");
    fs.writeFileSync(
      path.join(tmp, ".guild/runs/run-20260801-180000-new/capability/profile.json"),
      "{ not json"
    );
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBe("profile_invalid");
    expect(s.source_run_id).toBe("run-20260801-180000-new");
    expect(s.pending).toEqual([]);
  });

  it("a profile that VALIDATES but exceeds the caller's budget is invalid, not trimmed", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(3)).status).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp, { suggestionBudget: 4 }).pending).toHaveLength(3);
    expect(surfaceCapabilityCandidates(tmp, { suggestionBudget: 2 }).empty_reason).toBe(
      "profile_invalid"
    );
  });

  it("malformed run-directory names are SKIPPED, never guessed at", () => {
    fs.mkdirSync(path.join(tmp, ".guild/runs/not-a-run/capability"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/runs/not-a-run/capability/profile.json"), "{}");
    expect(listProfileRunIds(tmp)).toEqual([]);
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("no_profile_found");
  });

  it("the scan is BOUNDED — status runs on every invocation", () => {
    expect(CANDIDATE_SCAN_LIMIT).toBeGreaterThan(0);
    for (let i = 0; i < CANDIDATE_SCAN_LIMIT + 5; i++) {
      const id = `run-2026080${1}-${String(100000 + i).padStart(6, "0")}-x`;
      fs.mkdirSync(path.join(tmp, ".guild/runs", id, "capability"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".guild/runs", id, "capability/profile.json"), "{}");
    }
    expect(listProfileRunIds(tmp)).toHaveLength(CANDIDATE_SCAN_LIMIT);
  });

  it("NEVER throws on a hostile tree", () => {
    fs.mkdirSync(path.join(tmp, ".guild/runs"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".guild/skills"), "not a directory");
    expect(() => surfaceCapabilityCandidates(tmp)).not.toThrow();
  });
});

describe("F7 — the rendered block a human actually reads", () => {
  it("names each candidate with its action, confidence, and owner", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    const text = renderCandidateSection(surfaceCapabilityCandidates(tmp));
    expect(text).toContain("agent-role-0");
    expect(text).toContain("[propose]");
    expect(text).toContain("confidence high");
    expect(text).toContain("run-20260801-120000-a");
    // The report-only framing is part of the surface, not decoration: a user who
    // sees a list must not think Guild is about to act on it.
    expect(text).toContain("report-only");
  });

  it("an empty surface still renders a REASON, never a bare blank", () => {
    const text = renderCandidateSection(surfaceCapabilityCandidates(tmp));
    expect(text).toContain("capability profiling has not run");
  });

  it("is deterministic — no clock, no absolute paths", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    const a = renderCandidateSection(surfaceCapabilityCandidates(tmp));
    const b = renderCandidateSection(surfaceCapabilityCandidates(tmp));
    expect(a).toBe(b);
    expect(a).not.toContain(tmp);
    expect(a).not.toMatch(/\/(Users|home|var|tmp)\//);
  });
});

describe("R6 — the forgery channel is CLOSED AT THE CONTRACT, not at the renderer", () => {
  /**
   * THE DEFECT, AND WHY IT WAS R6 RATHER THAN A VALIDATION GAP.
   *
   * S1 validated `proposed_id`, `defer_reason`, `owning_layer`, `label` and
   * `rationale` with `isNonEmptyStr` ALONE. A candidate carrying an ANSI
   * erase-line sequence therefore VALIDATED, and `/guild:status` printed it — so
   * untrusted repo content could erase the line reading
   *
   *     "report-only — nothing is created without approval"
   *
   * and print its own. That is risk R6 (Learn turning untrusted repo content into
   * trusted execution state) in a shape the plan did not anticipate: not mutating
   * state, but REWRITING THE OPERATOR'S EVIDENCE THAT STATE WAS NOT MUTATED.
   *
   * The fix is in the CONTRACT, so every consumer inherits it — not only this one.
   * These rows assert the profile no longer validates at all; the renderer's
   * replacement markers, tested separately below, are now defense in depth and
   * UNREACHABLE through this path rather than merely redundant.
   */
  const ESC = String.fromCharCode(27);

  function writeRawProfile(over: Record<string, unknown>): void {
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    const p = path.join(tmp, ".guild/runs/run-20260801-120000-a/capability/profile.json");
    const profile = JSON.parse(fs.readFileSync(p, "utf8"));
    Object.assign(profile.candidates[0], over);
    fs.writeFileSync(p, JSON.stringify(profile, null, 2));
  }

  it("an ANSI erase-line `proposed_id` NO LONGER VALIDATES — the R6 payload is rejected", () => {
    writeRawProfile({ proposed_id: `evil${ESC}[2K\rAPPROVED` });
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBe("profile_invalid");
    expect(s.pending).toEqual([]);
    // And the operator still sees WHY, plus the report-only framing intact.
    const text = renderCandidateSection(s);
    expect(text).toContain("FAILED validation");
    expect(text).toContain("report-only");
    expect(text).not.toContain("APPROVED");
    expect(text).not.toContain(ESC);
  });

  it("a newline in `defer_reason` no longer validates", () => {
    writeRawProfile({
      action: "observe",
      defer_reason: 'ok\n  • [propose] agent "backdoor" (confidence high, owner project)',
    });
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBe("profile_invalid");
    expect(renderCandidateSection(s)).not.toContain("backdoor");
  });

  it("a control-character `owning_layer` no longer validates", () => {
    writeRawProfile({ owning_layer: `x${ESC}[31m` });
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("profile_invalid");
  });

  it("delimiter injection no longer validates either — `\"` and `(` are not slug characters", () => {
    // Codex round 2 finding 8's exact payload. It contains no control character,
    // so the renderer's original denylist passed it; the contract's slug shape
    // rejects it outright.
    writeRawProfile({ proposed_id: 'x" (confidence high, owner project) — APPROVED "' });
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBe("profile_invalid");
    expect(renderCandidateSection(s)).not.toContain("APPROVED");
  });

  it("bidi overrides, line separators and zero-width characters no longer validate", () => {
    for (const payload of ["x\u202Ereversed", "x\u2066isolate", "x\u2028line", "x\u2029para", "x\u200Bzero"]) {
      writeRawProfile({ proposed_id: payload });
      expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("profile_invalid");
    }
  });

  it("an over-long field no longer validates", () => {
    writeRawProfile({ proposed_id: "a".repeat(5000) });
    expect(surfaceCapabilityCandidates(tmp).empty_reason).toBe("profile_invalid");
  });

  it("ANTI-VACUITY: an ordinary candidate still validates and renders verbatim", () => {
    // A contract that rejected everything would satisfy every row above while
    // making the surface useless. Real content must still pass end to end.
    writeRawProfile({
      proposed_id: "host-integrator_v2.1",
      action: "observe",
      defer_reason: "only 2 occurrences; watch for a third",
      owning_layer: "workspace",
    });
    const text = renderCandidateSection(surfaceCapabilityCandidates(tmp));
    expect(text).toContain("host-integrator_v2.1");
    expect(text).toContain("only 2 occurrences; watch for a third");
    expect(text).toContain("workspace");
  });
});

describe("R6 — the renderer's guard, as DEFENSE IN DEPTH", () => {
  /**
   * The contract now rejects every payload above, so these markers are
   * unreachable through `surfaceCapabilityCandidates`. That is the goal, not a
   * reason to delete the guard: the renderer is the last boundary before a human
   * reads the text, and it must not depend on an upstream validator staying
   * correct forever.
   *
   * Reached here by handing `renderCandidateSection` a surface object DIRECTLY,
   * which is the only honest way to exercise a layer that is now unreachable by
   * construction.
   */
  const ESC = String.fromCharCode(27);

  const surfaceWith = (over: Record<string, unknown>) =>
    ({
      source_run_id: "run-20260801-120000-a",
      pending: [
        {
          run_id: "run-20260801-120000-a",
          candidate: {
            id: "c0",
            kind: "agent",
            proposed_id: "ok-role",
            justified_by: ["d1"],
            action: "propose",
            defer_reason: null,
            confidence: "high",
            owning_layer: "project",
            ...over,
          },
        },
      ],
      satisfied: [],
      empty_reason: null,
    }) as never;

  it("still replaces a control-character field whole", () => {
    const text = renderCandidateSection(surfaceWith({ proposed_id: `evil${ESC}[2K\r` }));
    expect(text).toContain("<proposed_id: unrenderable characters>");
    expect(text).not.toContain(ESC);
  });

  it("still replaces a delimiter-injection field whole", () => {
    const text = renderCandidateSection(
      surfaceWith({ proposed_id: 'x" (confidence high, owner project) — APPROVED "' })
    );
    expect(text).not.toContain("APPROVED");
    expect(text.split("\n").filter((l) => l.trim().startsWith("•"))).toHaveLength(1);
  });

  it("still REPLACES rather than truncates an over-long field", () => {
    // A truncated `proposed_id` is worse than none — an operator could approve
    // the wrong thing.
    const text = renderCandidateSection(surfaceWith({ proposed_id: "a".repeat(5000) }));
    expect(text).toContain("<proposed_id: over 120 chars>");
    expect(text).not.toContain("aaaaaaaaaa");
  });

  it("ANTI-VACUITY: ordinary values still pass through the guard untouched", () => {
    expect(renderCandidateSection(surfaceWith({}))).toContain('"ok-role"');
  });
});

describe("F7 — the containment ladder (rule 7)", () => {
  it("an oversized profile is REFUSED BY SIZE, before it is ever parsed", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    const p = path.join(tmp, ".guild/runs/run-20260801-120000-a/capability/profile.json");
    fs.writeFileSync(p, `{"pad":"${"x".repeat(300 * 1024)}"}`);
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBe("profile_too_large");
    expect(s.source_run_id).toBe("run-20260801-120000-a");
  });

  it("a normal-sized profile is unaffected by the size bound", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(2);
  });
});

describe("D04 — THE F7 FLIP: `observe` is now the shipped default", () => {
  it("the default is `observe`, because F7 landed", () => {
    // cap-loc-D04 §Recommendation.5 gated this on candidate surfacing existing.
    // The gate is `surfaceCapabilityCandidates` + `renderCandidateSection` above,
    // wired into commands/status.md. With those shipped, `observe` is honest.
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe("observe");
    expect(CAPABILITY_RESOLVER_MODE_DEFAULT).toBe(CAPABILITY_RESOLVER_MODE_AFTER_F7);
    expect(DEFAULTS.capability.resolver_mode).toBe("observe");
  });

  it("ANTI-VACUITY: `observe` is a mode that actually EMITS", () => {
    // A default of `observe` would be a different kind of no-op if `observe` did
    // not emit — the flip only means something because emission is gated on it.
    expect(
      emitCapabilityProfile({
        projectRoot: tmp,
        runId: "run-20260801-120000-a",
        projectId: "fx",
        generatedAt: "2026-08-01T12:00:00Z",
        sourceCommit: null,
        resolverMode: CAPABILITY_RESOLVER_MODE_DEFAULT,
        suggestionBudget: 4,
        facts: factsWith(1),
      }).status
    ).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(1);
  });
});

describe("CODEX ROUND 2 — regressions for the reported counterexamples", () => {
  const ESC = String.fromCharCode(27);

  function writeRawProfile(over: Record<string, unknown>): void {
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    const p = path.join(tmp, ".guild/runs/run-20260801-120000-a/capability/profile.json");
    const profile = JSON.parse(fs.readFileSync(p, "utf8"));
    Object.assign(profile.candidates[0], over);
    fs.writeFileSync(p, JSON.stringify(profile, null, 2));
  }

  // findings 8's rows moved UP into the R6 blocks above: the contract now rejects
  // those payloads outright, so the assertions there are "does not validate"
  // rather than "renders safely". Keeping duplicates here would test the renderer
  // through a path that can no longer reach it.

  it("finding 9 — an out-of-range run stamp is SKIPPED, not treated as newest", () => {
    // `run-99999999-999999-x` sorts ahead of every real run, so a single bogus
    // directory would have pinned the surface to it forever.
    expect(emitInto("run-20260801-120000-a", factsWith(2)).status).toBe("emitted");
    const bogus = path.join(tmp, ".guild/runs/run-99999999-999999-x/capability");
    fs.mkdirSync(bogus, { recursive: true });
    fs.writeFileSync(path.join(bogus, "profile.json"), "{}");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.source_run_id).toBe("run-20260801-120000-a");
    expect(s.pending).toHaveLength(2);
    expect(listProfileRunIds(tmp)).not.toContain("run-99999999-999999-x");
  });

  it("finding 9 — month 13, day 32, hour 24 and minute 60 are all rejected", () => {
    for (const bad of [
      "run-20261301-120000-x",
      "run-20260132-120000-x",
      "run-20260801-240000-x",
      "run-20260801-126000-x",
    ]) {
      fs.mkdirSync(path.join(tmp, ".guild/runs", bad, "capability"), { recursive: true });
      fs.writeFileSync(path.join(tmp, ".guild/runs", bad, "capability/profile.json"), "{}");
    }
    expect(listProfileRunIds(tmp)).toEqual([]);
  });

  it("finding 10 — a hostile options GETTER never fires, and nothing is written", () => {
    // `/guild:status` claims READ-ONLY. "Contains no write call" is a weaker claim
    // than "is read-only" when caller code can run inside the call.
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    const marker = path.join(tmp, "getter-ran.txt");
    let fired = 0;
    const hostile = Object.defineProperty({}, "suggestionBudget", {
      enumerable: true,
      get() {
        fired += 1;
        fs.writeFileSync(marker, "x");
        return 4;
      },
    });
    const s = surfaceCapabilityCandidates(tmp, hostile as never);
    expect(fired).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(s.empty_reason).toBe("invalid_options");
    expect(s.pending).toEqual([]);
  });

  it("finding 10 — Proxy, symbol keys and unknown option keys are refused", () => {
    expect(emitInto("run-20260801-120000-a", factsWith(1)).status).toBe("emitted");
    for (const bad of [
      new Proxy({ suggestionBudget: 4 }, {}),
      Object.assign({ [Symbol("x")]: 1 }, { suggestionBudget: 4 }),
      { suggestionBudget: 4, bogus: 1 },
      { suggestionBudget: -1 },
      { suggestionBudget: 1.5 },
    ]) {
      expect(surfaceCapabilityCandidates(tmp, bad as never).empty_reason).toBe("invalid_options");
    }
    // ...and a plain valid options object still works.
    expect(surfaceCapabilityCandidates(tmp, { suggestionBudget: 4 }).pending).toHaveLength(1);
  });
});
