/**
 * scripts/__tests__/create-skill-authority.test.ts
 *
 * Gap-audit D14 / decision cap-loc-D02 — `guild:create-skill` must carry the SAME
 * creation-authority split `guild:create-specialist` already carries: an explicit
 * human request waives ONLY the two historical-recurrence thresholds (signals 1
 * and 4 of the five §11.2.1 signals). The reuse/boundary gate (2), the one-off
 * gate (3), the eval-derivability gate (5) and the step-6 paired-eval gate stay
 * mandatory on both authorities.
 *
 * Mirrors scripts/__tests__/create-specialist-authority.test.ts so the two
 * meta-skills' contracts are held to one vocabulary by one shape of rail.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("create-skill creation authority", () => {
  const skill = readRepoFile("skills/meta/create-skill/SKILL.md");
  const workflow = readRepoFile("skills/meta/create-skill/workflow.md");

  test("an explicit human request is not blocked solely by missing historical evidence", () => {
    expect(skill).toMatch(
      /explicit human request[\s\S]*does not require historical extraction evidence/i
    );
    expect(workflow).toMatch(
      /human-requested[\s\S]*do not require historical runs, reflections, or prior gap records/i
    );
  });

  test("evolution-proposed skills still require the historical extraction signals", () => {
    expect(skill).toMatch(
      /evolution[^\n]*proposed[\s\S]*historical extraction signals[\s\S]*must all pass/i
    );
    expect(workflow).toMatch(
      /evolution-proposed creation, five thresholds must \*\*ALL\*\* agree/i
    );
  });

  test("the waiver is scoped to the two history gates only (1 and 4)", () => {
    // The whole point of D02: human authority waives history, not quality.
    expect(skill).toMatch(/waives \*\*only\*\* the two historical thresholds/i);
    expect(workflow).toMatch(
      /waives \*\*only\*\* extraction signals 1 \([\s\S]{0,120}\) and 4 \(/i
    );
  });

  test("the reuse, one-off and eval-derivability gates stay mandatory on both authorities", () => {
    expect(skill).toMatch(
      /Gates \*\*2, 3 and 5 are not history gates\*\* and stay mandatory on both authorities/i
    );
    expect(workflow).toMatch(
      /Signals \*\*2\*\*, \*\*3\*\* and \*\*5\*\* are prospective, not historical, and are gated on both authorities/i
    );
  });

  test("human-requested skills still pass the prospective gates before registration", () => {
    expect(skill).toMatch(
      /must pass the interview, boundary scan, every applicable adjacent-boundary gate, and the new-skill paired eval gate before registration/i
    );
    expect(workflow).toMatch(
      /absence of an applicable historical corpus[^.]*does not block registration/i
    );
  });

  test("an empty .guild/runs corpus is recorded not_applicable, never fabricated", () => {
    // Without this the waiver is vacuous on exactly the fresh projects it serves.
    expect(skill).toMatch(/empty or irrelevant `\.guild\/runs\/\*\/` corpus is recorded as `not_applicable`/i);
    expect(workflow).toMatch(/record shadow replay as `not_applicable`/i);
    expect(skill).toMatch(/do not invent historical counts/i);
    expect(workflow).toMatch(/Never synthesize historical evidence for a new human-requested capability/i);
  });

  test("the telemetry payload carries creation_authority, mirroring create-specialist", () => {
    expect(skill).toMatch(
      /`creation_authority` \(`human-requested`\/`evolution-proposed`\)/
    );
    // gate_failed: extraction-signals is only reachable on the evolution path.
    expect(skill).toMatch(
      /`extraction-signals` applies only to evolution-proposed creation/i
    );
  });

  test("the frontmatter advertises the split and the human-requested entry condition", () => {
    const frontmatter = skill.slice(0, skill.indexOf("\n---", 4));
    expect(frontmatter).toMatch(
      /Creation authority is human-requested[\s\S]*or evolution-proposed/i
    );
    expect(frontmatter).toMatch(/when_to_use:\s*An explicit human request/i);
  });
});
