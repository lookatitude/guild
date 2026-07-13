/**
 * scripts/__tests__/docs-count.test.ts
 *
 * DOCS-COUNT RAIL (plugin-implementation-audit-2026-07-12, item G9-6).
 *
 * Asserts that headline counts claimed in README.md / CONTRIBUTING.md /
 * AGENTS.md ("N skills", "N commands", "N specialist templates", "N
 * specialist skills", "N machinery agents") match the live inventory truth —
 * guild.inventory.json's generated arrays for skills/commands/agents, and a
 * direct file-count of templates/specialists (*.md) and skills/specialists
 * (one SKILL.md per subdirectory) for the two specialist counts
 * (guild.inventory.json tracks no "specialist"
 * array — specialists are TEMPLATES minted on demand, not a shipped inventory
 * category).
 *
 * MATCHER SCOPE (deliberately conservative, per this lane's task brief — "keep
 * the matcher conservative... to avoid false positives"): each pattern below
 * requires the number to be IMMEDIATELY adjacent to its exact phrase as
 * currently used in these three files (verified by direct grep before writing
 * this rail — see the per-pattern comments). A looser "any number near the
 * word specialist" match would conflate "15 specialist TEMPLATES" with "58
 * specialist SKILLS" (both real, both correct, different ground truths) —
 * this rail keeps them as two distinct, separately-checked patterns instead.
 *
 * A pattern that matches ZERO times in a file is NOT a finding — it means
 * that file makes no claim of that kind (e.g. none of the three files
 * currently state a bare "N commands" claim). Only a MISMATCHED claim
 * (pattern matched, number ≠ ground truth) is a violation.
 *
 * KNOWN CONCURRENT STATE: guild.inventory.json is actively being reconciled
 * by a parallel lane (G7, per this lane's task brief) at the time this rail
 * was authored. If this rail is red at hand-off, the counts below are STILL
 * the ground truth this rail measures against right now — see this lane's
 * report for which specific claims were pending G7's landing.
 */

import * as fs from "fs";
import * as path from "path";

const REPO = path.resolve(__dirname, "..", "..");
const INVENTORY_PATH = path.join(REPO, "guild.inventory.json");
const TARGET_FILES = ["README.md", "CONTRIBUTING.md", "AGENTS.md"];
const SPECIALIST_TEMPLATES_DIR = path.join(REPO, "templates", "specialists");
const SPECIALIST_SKILLS_DIR = path.join(REPO, "skills", "specialists");

interface InventoryArrays {
  skills: unknown[];
  commands: unknown[];
  agents: unknown[];
}

function loadInventory(): InventoryArrays {
  const raw = JSON.parse(fs.readFileSync(INVENTORY_PATH, "utf8"));
  return {
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    commands: Array.isArray(raw.commands) ? raw.commands : [],
    agents: Array.isArray(raw.agents) ? raw.agents : [],
  };
}

/** Count of templates/specialists/*.md (the 15 domain specialist type templates). */
function countSpecialistTemplates(): number {
  try {
    return fs.readdirSync(SPECIALIST_TEMPLATES_DIR).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** Count of skills/specialists subdirectories that contain a SKILL.md (the specialist-tier skills). */
function countSpecialistSkills(): number {
  try {
    return fs
      .readdirSync(SPECIALIST_SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(SPECIALIST_SKILLS_DIR, e.name, "SKILL.md")))
      .length;
  } catch {
    return 0;
  }
}

interface CountClaim {
  raw: string;
  claimed: number;
}

/** Extract every "<N> <exact phrase>" claim from `content`, word-boundary anchored. */
function extractClaims(content: string, phraseRe: RegExp): CountClaim[] {
  const claims: CountClaim[] = [];
  const re = new RegExp(phraseRe.source, phraseRe.flags.includes("g") ? phraseRe.flags : phraseRe.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    claims.push({ raw: m[0], claimed: parseInt(m[1], 10) });
  }
  return claims;
}

// Each pattern requires the number IMMEDIATELY followed by its exact phrase
// (verified live in README.md/CONTRIBUTING.md/AGENTS.md before writing this
// rail — e.g. "111 skills", "15 domain specialist type templates", "58
// specialist skills", "2 machinery agents"). `(?:domain )?` and `(?: type)?`
// are optional qualifiers observed across the three files' varying phrasing
// of the SAME specialist-template claim.
const PATTERNS: { name: string; re: RegExp; groundTruth: () => number }[] = [
  {
    name: "skills",
    re: /\b(\d+)\s+skills\b/gi,
    groundTruth: () => loadInventory().skills.length,
  },
  {
    name: "commands",
    re: /\b(\d+)\s+commands\b/gi,
    groundTruth: () => loadInventory().commands.length,
  },
  {
    name: "machinery agents",
    re: /\b(\d+)\s+machinery\s+agents\b/gi,
    groundTruth: () => loadInventory().agents.length,
  },
  {
    name: "specialist templates",
    re: /\b(\d+)\s+(?:domain\s+)?specialist\s+(?:type\s+)?templates\b/gi,
    groundTruth: countSpecialistTemplates,
  },
  {
    name: "specialist skills",
    re: /\b(\d+)\s+specialist\s+skills\b/gi,
    groundTruth: countSpecialistSkills,
  },
];

describe("docs-count rail — README/CONTRIBUTING/AGENTS claimed counts vs guild.inventory.json", () => {
  it("guild.inventory.json exists and parses (anti-vacuity floor for this whole rail)", () => {
    expect(fs.existsSync(INVENTORY_PATH)).toBe(true);
    expect(() => loadInventory()).not.toThrow();
  });

  for (const file of TARGET_FILES) {
    const filePath = path.join(REPO, file);

    describe(file, () => {
      it("exists", () => {
        expect(fs.existsSync(filePath)).toBe(true);
      });

      if (!fs.existsSync(filePath)) return;

      const content = fs.readFileSync(filePath, "utf8");

      for (const { name, re, groundTruth } of PATTERNS) {
        const claims = extractClaims(content, re);
        // No claim of this kind in this file → nothing to assert (see file
        // header: absence is not a finding, only a MISMATCHED claim is).
        for (const [i, claim] of claims.entries()) {
          it(`"${name}" claim [${i}] ("${claim.raw}") matches live count`, () => {
            expect(claim.claimed).toBe(groundTruth());
          });
        }
      }
    });
  }
});

describe("docs-count rail — ground-truth counts (documented, for the handoff report)", () => {
  it("reports the current live counts", () => {
    const inv = loadInventory();
    const counts = {
      skills: inv.skills.length,
      commands: inv.commands.length,
      machinery_agents: inv.agents.length,
      specialist_templates: countSpecialistTemplates(),
      specialist_skills: countSpecialistSkills(),
    };
    // Not a real assertion — this test exists to print ground truth into the
    // jest output for a human triaging a red run (see file header note on
    // G7's concurrent guild.inventory.json reconciliation).
    // eslint-disable-next-line no-console
    console.log("[docs-count] live ground truth:", JSON.stringify(counts));
    expect(counts.skills).toBeGreaterThan(0);
  });
});
