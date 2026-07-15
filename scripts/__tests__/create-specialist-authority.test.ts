import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(__dirname, "../..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("create-specialist creation authority", () => {
  const skill = readRepoFile("skills/meta/create-specialist/SKILL.md");
  const workflow = readRepoFile("skills/meta/create-specialist/workflow.md");

  test("an explicit human request is not blocked solely by missing historical evidence", () => {
    expect(skill).toMatch(
      /explicit human request[\s\S]*does not require historical extraction evidence/i
    );
    expect(workflow).toMatch(
      /human-requested[\s\S]*do not require historical runs, reflections, or prior gap records/i
    );
  });

  test("evolution-proposed specialists still require the historical extraction signals", () => {
    expect(skill).toMatch(
      /evolution[^\n]*proposed[\s\S]*historical extraction signals[\s\S]*must all pass/i
    );
    expect(workflow).toMatch(
      /evolution-proposed[\s\S]*same skill cluster appears across ≥3 unrelated tasks/i
    );
  });

  test("human-requested specialists still pass prospective gates before registration", () => {
    expect(workflow).toMatch(
      /human-requested[\s\S]*boundary scan[\s\S]*boundary-edit gate[\s\S]*new-specialist gate[\s\S]*register/i
    );
    expect(workflow).toMatch(
      /absence of an applicable historical corpus[^.]*does not block registration/i
    );
  });
});
