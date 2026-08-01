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
