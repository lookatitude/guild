/**
 * KTD59 — `indexed: true` is a FRONTMATTER decision, and the plugin manifest's
 * `skills` glob is derived from it. Codex G-lane r1: the first cut scanned the
 * whole file, so a skill whose BODY contained the line `indexed: true` (a fenced
 * YAML example, a quoted contract snippet) would silently join the host catalog.
 *
 * These fixtures pin both directions on the real `discoverSurfaces` resolver.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverSurfaces } from "../../src/modules/distribution/workflows/build-inventory";

const FRONTMATTER_MARKED = `---
name: guild-marked
description: An assembler that declares itself indexed in its frontmatter.
when_to_use: Never — fixture only.
type: meta
indexed: true
---

# marked

Body text.
`;

const BODY_ONLY = `---
name: guild-body-only
description: A chapter-shaped skill whose BODY merely quotes the marker.
when_to_use: Never — fixture only.
type: meta
---

# body only

The manifest derivation reads this key from the frontmatter, like so:

indexed: true

\`\`\`yaml
indexed: true
\`\`\`
`;

const HOSTILE_FRONTMATTER = `---
name: guild-hostile
description: Ships §10.1.1 (type, owner): a colon-and-paren description that is not valid YAML as a whole.
when_to_use: Never — fixture only.
type: meta
indexed: true
---

# hostile

Body text.
`;

function withSkillTree(
  skills: Record<string, string>,
  fn: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-indexed-marker-"));
  try {
    for (const [rel, content] of Object.entries(skills)) {
      const abs = path.join(root, "skills", rel, "SKILL.md");
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function indexedIds(root: string): string[] {
  return discoverSurfaces(root)
    .skills.filter((s) => s.indexed === true)
    .map((s) => s.id)
    .sort();
}

describe("KTD59 indexed marker — frontmatter only", () => {
  it("indexes a skill whose FRONTMATTER declares indexed: true", () => {
    withSkillTree({ "meta/marked": FRONTMATTER_MARKED }, (root) => {
      expect(indexedIds(root)).toEqual(["guild-marked"]);
    });
  });

  it("does NOT index a skill whose BODY merely contains the line indexed: true", () => {
    withSkillTree({ "meta/body-only": BODY_ONLY }, (root) => {
      expect(indexedIds(root)).toEqual([]);
    });
  });

  it("discriminates the two in one tree (the body-only marker cannot borrow the other's)", () => {
    withSkillTree(
      { "meta/marked": FRONTMATTER_MARKED, "meta/body-only": BODY_ONLY },
      (root) => {
        expect(indexedIds(root)).toEqual(["guild-marked"]);
      },
    );
  });

  it("still indexes a skill whose frontmatter is YAML-HOSTILE as a whole", () => {
    // 58 of the 76 shipped skill pages carry an unquoted `description:` with
    // colons/parens and do not parse as a YAML document — 4 of the 17 assemblers
    // among them. Handing the block to js-yaml would drop those from the glob.
    withSkillTree({ "meta/hostile": HOSTILE_FRONTMATTER }, (root) => {
      expect(indexedIds(root)).toEqual(["guild-hostile"]);
    });
  });

  it("the live tree indexes exactly the 17 assemblers", () => {
    const live = discoverSurfaces(path.resolve(__dirname, "..", ".."));
    expect(live.skills.filter((s) => s.indexed === true)).toHaveLength(17);
  });
});
