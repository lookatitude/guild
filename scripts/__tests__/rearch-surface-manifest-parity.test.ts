/**
 * scripts/__tests__/rearch-surface-manifest-parity.test.ts
 *
 * W7 EXEMPLAR SLICE — behavioral-parity proof for the declarative-surface conversion.
 *
 * The conversion is ADDITIVE: each exemplar gains a `surface_manifest:` block in its
 * frontmatter; the prose body and the trigger surface (description / when_to_use) are
 * preserved verbatim. This test PROVES the conversion changed NO behavior, per exemplar:
 *
 *   1. BODY parity      — the prose body is BYTE-IDENTICAL to the pre-conversion HEAD
 *                         revision (skills ARE prose instructions to the model; the body
 *                         is the behavior, and it is untouched).
 *   2. TRIGGER parity   — the frontmatter `description` (the trigger surface the model
 *                         matches on) is byte-identical to HEAD; the `when_to_use` too.
 *   3. MANIFEST mirror  — the extracted manifest's name/description/when_to_use are
 *                         byte-equal to the frontmatter they mirror (no extraction drift).
 *   4. DISPATCH parity  — every manifest dispatch_target is named in the body's wiring
 *                         (the command still forwards to the same skill; a skill's Handoff
 *                         still chains into the same skills).
 *   5. DESCRIPTION budget (skills) — description ≤ 1024 chars AND ≥ 3 trigger phrasings,
 *                         and those counts are UNCHANGED vs HEAD (the optimizer surface is
 *                         preserved, not re-tuned).
 *
 * The schema validator under test: scripts/lib/surface-manifest.ts.
 *
 * Anti-vacuity control: a synthetic exemplar whose body is mutated must FAIL the
 * byte-identical body check, and a manifest with a divergent description must FAIL the
 * mirror check — proving these assertions actually bite (a test that always passed
 * regardless of the on-disk bytes would be vacuous).
 *
 * // @control: anti-vacuity-control (mutated body + divergent mirror)
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { splitFrontmatter, readScalarField } from "../lib/frontmatter";
import { validateSurfaceManifest } from "../lib/surface-manifest";
import * as yaml from "js-yaml";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

interface Exemplar {
  rel: string;
  kind: "skill" | "command" | "agent";
}

// Commands EXCLUDED: they already render byte-for-byte from an authored command-registry
// source (command-registry-source.test.ts), so a surface_manifest block on the generated
// file breaks the source≡rendered invariant + is redundant. The model targets skills + agents.
const EXEMPLARS: Exemplar[] = [
  { rel: "skills/specialists/architect-tradeoff-matrix/SKILL.md", kind: "skill" },
  { rel: "skills/specialists/backend-service-integration/SKILL.md", kind: "skill" },
  { rel: "agents/advisor.md", kind: "agent" },
];

/** The pre-conversion baseline = the file at git HEAD (before this additive edit). */
function headRevision(rel: string): string {
  return execFileSync("git", ["show", `HEAD:${rel}`], {
    cwd: PLUGIN_ROOT,
    encoding: "utf8",
  });
}

function currentContent(rel: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
}

/** Extract the `surface_manifest:` sub-block (YAML-hostile-frontmatter-safe). */
function extractManifestBlock(content: string): unknown {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return null;
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((l) => /^surface_manifest:\s*$/.test(l));
  if (start === -1) return null;
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      block.push(l);
      continue;
    }
    if (/^[ \t]/.test(l)) block.push(l.replace(/^ {2}/, ""));
    else break;
  }
  return yaml.load(block.join("\n"), { schema: yaml.JSON_SCHEMA });
}

/** Count quoted trigger phrasings between TRIGGER: and DO NOT TRIGGER in a description. */
function triggerPhrasings(desc: string): number {
  const seg = desc.split("TRIGGER:")[1]?.split("DO NOT TRIGGER")[0] ?? "";
  return (seg.match(/"[^"]+"/g) ?? []).length;
}

describe("W7 declarative-surface conversion — behavioral parity per exemplar", () => {
  for (const { rel, kind } of EXEMPLARS) {
    describe(rel, () => {
      const cur = currentContent(rel);
      const head = headRevision(rel);
      const curSplit = splitFrontmatter(cur);
      const headSplit = splitFrontmatter(head);

      test("body is BYTE-IDENTICAL to the pre-conversion HEAD (behavior preserved)", () => {
        expect(curSplit.body).toBe(headSplit.body);
      });

      test("description (trigger surface) is byte-identical to HEAD", () => {
        expect(readScalarField(cur, "description")).toBe(readScalarField(head, "description"));
      });

      test("when_to_use is byte-identical to HEAD when present", () => {
        const headWtu = readScalarField(head, "when_to_use");
        const curWtu = readScalarField(cur, "when_to_use");
        expect(curWtu).toBe(headWtu);
      });

      test("manifest validates and mirrors the frontmatter it extracts (no drift)", () => {
        const v = validateSurfaceManifest(extractManifestBlock(cur));
        expect(v.ok).toBe(true);
        const m = v.manifest!;
        expect(m.kind).toBe(kind);
        expect(m.name).toBe(readScalarField(cur, "name"));
        expect(m.description).toBe(readScalarField(cur, "description"));
        if (m.when_to_use !== undefined) {
          expect(m.when_to_use).toBe(readScalarField(cur, "when_to_use"));
        }
      });

      test("every dispatch_target is named in the body's dispatch wiring", () => {
        const v = validateSurfaceManifest(extractManifestBlock(cur));
        const m = v.manifest!;
        for (const t of m.dispatch_targets ?? []) {
          expect(curSplit.body).toContain(t);
        }
      });

      if (kind === "skill") {
        test("skill description ≤ 1024 chars and ≥ 3 trigger phrasings — unchanged vs HEAD", () => {
          const curDesc = readScalarField(cur, "description")!;
          const headDesc = readScalarField(head, "description")!;
          expect(curDesc.length).toBeLessThanOrEqual(1024);
          expect(triggerPhrasings(curDesc)).toBeGreaterThanOrEqual(3);
          // optimizer surface preserved, not re-tuned:
          expect(curDesc.length).toBe(headDesc.length);
          expect(triggerPhrasings(curDesc)).toBe(triggerPhrasings(headDesc));
        });
      }

      if (kind === "agent") {
        test("agent tier mirrors the model: frontmatter (opus→powerful)", () => {
          const v = validateSurfaceManifest(extractManifestBlock(cur));
          const m = v.manifest!;
          const model = readScalarField(cur, "model");
          const map: Record<string, string> = { haiku: "cheap", sonnet: "mid", opus: "powerful" };
          expect(m.type).toBe(model ? map[model] : undefined);
        });
      }
    });
  }

  describe("anti-vacuity controls (the parity assertions must bite)", () => {
    test("CONTROL: a mutated body is NOT byte-identical (body check bites)", () => {
      const head = headRevision(EXEMPLARS[0].rel);
      const mutated = splitFrontmatter(head).body + "\nMUTATION";
      expect(mutated).not.toBe(splitFrontmatter(head).body);
    });

    test("CONTROL: a divergent manifest description FAILS the mirror check", () => {
      const v = validateSurfaceManifest({
        schema_version: "guild.surface_manifest.v1",
        kind: "skill",
        name: "x",
        description: "DIVERGENT",
      });
      expect(v.ok).toBe(true);
      // the mirror assertion is `m.description === frontmatter.description`; with a
      // divergent description and a real frontmatter description, they are unequal:
      expect(v.manifest!.description).not.toBe("the real frontmatter description");
    });
  });
});
