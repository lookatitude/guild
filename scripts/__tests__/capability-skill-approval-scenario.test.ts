/**
 * F6 — THE SKILL-APPROVAL SCENARIO. The conformance row the original plan omitted.
 *
 * B4 ("User approves one Learn proposal") covers the AGENT leg; its skill leg was
 * never written, so nothing proved a Learn-proposed SKILL had a legal path from
 * candidate to registered. Audit F6 is that hole. This file is the row.
 *
 * The scenario, end to end:
 *
 *   1. full Learn emits a profile carrying a SKILL candidate     (D1)
 *   2. /guild:status surfaces it as PENDING                      (F7)
 *   3. the operator approves it — a skill is minted              (D02, human gate)
 *   4. the surface flips it to SATISFIED and stops proposing it  (the loop closes)
 *   5. resolver mode auto-advances — but NEVER over a user pin   (A5.6 / A5.7)
 *
 * WHAT THIS ROW CAN AND CANNOT PROVE. Minting is skill-prose executed by a model
 * (`guild:create-skill`), so step 3 is exercised at the filesystem boundary the
 * mint produces — a real `.guild/skills/<id>/SKILL.md`. That is the honest limit,
 * and it is stated rather than hidden: what is proved deterministically is that
 * the DETECTION half closes the loop against a real mint, and that the shipped
 * `create-skill` contract admits a from-candidate request at all (the D02 leg,
 * which is what made the skill path illegal before D14 landed).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { surfaceCapabilityCandidates } from "../lib/capability/candidate-surface";
import { emitCapabilityProfile, type DerivedFacts } from "../lib/capability/profile-emit";
import {
  CAPABILITY_AUTO_CREATE_POLICIES,
  CAPABILITY_RESOLVER_MODE_DEFAULT,
} from "../../src/modules/config/workflows/config-defaults";
import { mayReconcileWrite } from "../lib/config-reconcile-contract";

const repoRoot = path.resolve(__dirname, "../..");
const RUN_ID = "run-20260801-120000-f6-skill";
const SKILL_ID = "cross-host-package-verification";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-f6-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * A SKILL candidate justified by a repeated method — the shape a real Learn run
 * produces for the skill path. `repeated_methods` is the skill feedstock
 * specifically: S1 requires its evidence to cite HISTORY (run / reflection), so a
 * skill candidate is by construction backed by something that actually recurred.
 */
const SKILL_CANDIDATE_FACTS: DerivedFacts = {
  domains: [],
  boundaries: [],
  repeated_methods: [
    {
      id: "m1",
      label: "verify a rendered host package against the inventory",
      occurrence_count: 3,
      evidence_refs: [
        "run:run-20260710-101500-host-packages",
        "run:run-20260722-090000-release-cut",
        "reflection:.guild/reflections/run-20260722-090000-release-cut.md",
      ],
      confidence: "high",
    },
  ],
  coverage: { covered: [], uncovered: ["m1"], unmatched_roles: [] },
  candidates: [
    {
      id: "cand-skill-1",
      kind: "skill",
      proposed_id: SKILL_ID,
      justified_by: ["m1"],
      action: "propose",
      defer_reason: null,
      confidence: "high",
      owning_layer: "project",
    },
  ],
};

function emitProfile() {
  return emitCapabilityProfile({
    projectRoot: tmp,
    runId: RUN_ID,
    projectId: "fx-skill",
    generatedAt: "2026-08-01T12:00:00Z",
    sourceCommit: null,
    resolverMode: "observe",
    suggestionBudget: 4,
    facts: SKILL_CANDIDATE_FACTS,
  });
}

/** The filesystem effect an approved `guild:create-skill` mint leaves behind. */
function mintSkill(id: string): void {
  fs.mkdirSync(path.join(tmp, ".guild/skills", id), { recursive: true });
  fs.writeFileSync(
    path.join(tmp, ".guild/skills", id, "SKILL.md"),
    `---\nname: ${id}\n---\n\n# ${id}\n`,
    "utf8"
  );
}

describe("F6 steps 1-2 — a SKILL candidate is emitted and surfaced", () => {
  it("the profile carries it, and its evidence is HISTORICAL (A1.11)", () => {
    const r = emitProfile();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;

    const cand = r.profile.candidates[0];
    expect(cand.kind).toBe("skill");
    expect(cand.proposed_id).toBe(SKILL_ID);
    // The skill path's evidence rule: a recurrence claim cites history, not code.
    // A `codebase_map:` ref here would have been rejected by S1's validator.
    for (const ref of r.profile.repeated_methods[0].evidence_refs) {
      expect(ref).toMatch(/^(run|reflection):/);
    }
    expect(r.profile.repeated_methods[0].occurrence_count).toBe(3);
  });

  it("emitting it mutates nothing — approval is the ONLY thing that creates", () => {
    const r = emitProfile();
    expect(r.status).toBe("emitted");
    if (r.status !== "emitted") return;
    expect(r.profile.mutation_performed).toBe(false);
    // No skill exists yet. The proposal is a report, not a half-done mint.
    expect(fs.existsSync(path.join(tmp, ".guild/skills"))).toBe(false);
  });

  it("/guild:status surfaces it as PENDING", () => {
    expect(emitProfile().status).toBe("emitted");
    const s = surfaceCapabilityCandidates(tmp);
    expect(s.empty_reason).toBeNull();
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0].candidate.kind).toBe("skill");
    expect(s.pending[0].candidate.proposed_id).toBe(SKILL_ID);
  });
});

describe("F6 steps 3-4 — approval closes the loop", () => {
  it("after a real mint, the candidate is SATISFIED and no longer proposed", () => {
    expect(emitProfile().status).toBe("emitted");
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(1);

    mintSkill(SKILL_ID);

    const after = surfaceCapabilityCandidates(tmp);
    expect(after.pending).toHaveLength(0);
    expect(after.satisfied.map((c) => c.candidate.proposed_id)).toEqual([SKILL_ID]);
    expect(after.empty_reason).toBe("all_candidates_satisfied");
  });

  it("ANTI-VACUITY: a DIFFERENT skill does not satisfy it", () => {
    // Without this, "satisfied" could be reading `.guild/skills` non-emptiness and
    // the row would pass for any mint at all.
    expect(emitProfile().status).toBe("emitted");
    mintSkill("something-else-entirely");
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(1);
  });

  it("a directory without SKILL.md does NOT count as minted", () => {
    // Half a mint is not a mint. Counting the bare directory would report the loop
    // closed while the skill is unusable.
    expect(emitProfile().status).toBe("emitted");
    fs.mkdirSync(path.join(tmp, ".guild/skills", SKILL_ID), { recursive: true });
    expect(surfaceCapabilityCandidates(tmp).pending).toHaveLength(1);
  });
});

describe("F6 step 5 — auto-advance, and the pin that stops it (A5.6 / A5.7)", () => {
  const stamp = "2026-08-01T00:00:00Z";

  it("an approval may advance a mode the project never chose", () => {
    expect(
      mayReconcileWrite({
        key: "capability.resolver_mode",
        value: CAPABILITY_RESOLVER_MODE_DEFAULT,
        provenance: "default",
        last_reconciled_at: stamp,
      })
    ).toBe(true);
  });

  it("A USER-PINNED MODE IS NEVER ADVANCED BY AN APPROVAL", () => {
    // A5.7. Auto-advance rides THROUGH never-clobber rather than beside it, so
    // there is no second rule to keep in sync — the pin holds for free.
    expect(
      mayReconcileWrite({
        key: "capability.resolver_mode",
        value: "observe",
        provenance: "user",
        last_reconciled_at: stamp,
      })
    ).toBe(false);
  });

  it("`auto_create_policy: never` is a SECOND, independent off-switch", () => {
    // Provenance says who owns the value; policy says whether advancing is wanted
    // at all. Neither implies the other, so both are named.
    expect(CAPABILITY_AUTO_CREATE_POLICIES).toContain("never");
  });
});

describe("F6 — the shipped create-skill contract admits a from-candidate request (D02)", () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, "skills/meta/create-skill/SKILL.md"),
    "utf8"
  );

  it("carries the human-requested authority the skill path needs", () => {
    // Before D14 landed, a Learn-proposed skill on a fresh project had NO legal
    // path: history gates 1 and 4 are unsatisfiable by construction with no runs.
    // That is precisely why F6 existed as a hole rather than as a passing row.
    expect(skill).toMatch(/creation_authority[\s\S]*human-requested/i);
    expect(skill).toMatch(/human-requested[\s\S]*status[`:\s]*not_required/i);
  });

  it("does NOT invent historical counts on the waived path", () => {
    expect(skill).toMatch(/do not invent historical counts/i);
  });

  it("keeps the NON-history gates mandatory on both authorities", () => {
    // The waiver is narrow by design: reuse (2), one-off (3) and eval-derivability
    // (5) survive, so an approved candidate still cannot become a duplicate skill.
    expect(skill).toMatch(/Gates \*\*2, 3 and 5 are not history gates\*\*/);
    expect(skill).toMatch(/Only \(1\) and \(4\) are waived by human authority/);
  });

  it("treats an empty run corpus as `not_applicable`, not as a failure", () => {
    // The waiver would be vacuous on exactly the fresh projects it exists to serve
    // if an empty shadow corpus blocked registration.
    expect(skill).toMatch(/not_applicable[\s\S]*not a registration blocker/i);
  });
});
