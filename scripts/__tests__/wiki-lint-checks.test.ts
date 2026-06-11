import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { lintWiki } from "../wiki-lint-checks";

function page(dir: string, name: string, body: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), body);
}

describe("wiki-lint-checks (deterministic core of /guild:wiki lint)", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-wlc-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("flags importance_draft pages (pending-grade-review)", () => {
    page(path.join(root, ".guild", "wiki"), "a.md", "---\nimportance: high\nimportance_draft: true\ngraded_by: guild-migrate\n---\nbody");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].check).toBe("pending-grade-review");
    expect(f[0].detail).toMatch(/accept-grades/);
  });

  it("flags consumable pages missing importance; exempts via the SHARED grader predicate", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "ungraded.md", "---\ntitle: x\n---\nbody");
    page(w, "prov.md", "---\ncategory: provenance\n---\nbody");
    page(w, "typed.md", "---\ntype: research\n---\nbody");
    page(path.join(w, "research"), "by-path.md", "---\ntitle: r\n---\nbody");
    page(path.join(w, "ideation"), "idea.md", "body no fm");
    page(w, "index.md", "# idx");
    page(w, "README.md", "# readme");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].check).toBe("missing-importance");
    expect(f[0].file).toContain("ungraded.md");
  });

  it("architecture-map.md is NOT structural — the grader grades it, so lint flags it ungraded", () => {
    const w = path.join(root, ".guild", "wiki");
    page(w, "architecture-map.md", "---\ntitle: map\n---\nbody");
    const f = lintWiki(root);
    expect(f).toHaveLength(1);
    expect(f[0].file).toContain("architecture-map.md");
  });

  it("clean wiki (graded, accepted) → zero findings; missing wiki dir → zero", () => {
    page(path.join(root, ".guild", "wiki"), "a.md", "---\nimportance: medium\n---\nbody");
    expect(lintWiki(root)).toHaveLength(0);
    expect(lintWiki(path.join(root, "nope"))).toHaveLength(0);
  });
});
