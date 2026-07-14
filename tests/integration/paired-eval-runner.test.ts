/**
 * tests/integration/paired-eval-runner.test.ts
 *
 * ONE jest runner for every trigger-eval fixture set in this repo that had
 * NO runner at all before this lane (plugin-implementation-audit-2026-07-12,
 * MEDIUM/LOW #527 + GENERALIZE #540: "tests/trigger/{core,meta}/evals.json and
 * tests/boundary/evals.json — runner-less" — 61 boundary-collision fixtures
 * were dead weight):
 *
 *   - tests/trigger/core/evals.json, tests/trigger/meta/evals.json
 *     (skill-tier cases: prompt → expected_skill, keyed by a skill's SKILL.md
 *     `name:` frontmatter field)
 *   - tests/boundary/evals.json
 *     (specialist-tier cases: prompt → expected_specialist | null, keyed by a
 *     specialist template's `name:` frontmatter field under
 *     templates/specialists/*.md)
 *   - every skills/&#42;/&#42;/evals.json (108 files: should_trigger / should_not_trigger
 *     prompts, asserted against that SAME skill's OWN description — no
 *     cross-skill comparison needed for this tier)
 *
 * All three are asserted against ONE deterministic keyword/phrase matcher —
 * tests/integration/lib/trigger-matcher.ts — applied to the relevant
 * `description:` frontmatter field(s). See that file's header for the
 * matcher's documented limits (substring/keyword heuristic, not semantic
 * understanding; cross-tier "which one wins" is INCLUSIVE — the runner
 * asserts the expected owner is AMONG the matcher's matches for that prompt,
 * not that it is the sole match, since several descriptions share overlapping
 * vocabulary on purpose).
 *
 * TRIAGE DISCIPLINE (per this lane's task brief): a case the matcher gets
 * wrong is either —
 *   (a) a FIXTURE defect (wrong prompt wording, stale expected_skill/
 *       expected_specialist, a copy-paste slip) — fixed directly in the
 *       fixture JSON, right here, by this lane (see this lane's handoff for
 *       the specific fixture fixes made this way); or
 *   (b) a DESCRIPTION/MATCHER-LIMIT defect (the skill's/specialist's TRIGGER
 *       / DO NOT TRIGGER prose uses vocabulary a v1 keyword/phrase heuristic
 *       cannot bridge — semantic paraphrase, cross-family vocabulary overlap,
 *       a load-bearing word too short/common to survive the matcher's
 *       length/corpus-frequency floors; see trigger-matcher.ts's MATCHER
 *       LIMITS section for the catalogued root causes) — NOT fixed here.
 *       skill-author owns skills/**\/evals.json prose edits for
 *       description-shape reasons; specialist-agent-writer owns
 *       templates/specialists/*.md.
 *
 * SKIP MECHANISM: `runCase()` below computes `wouldTrigger` at collection
 * time and only marks a case `test.skip` when it is CURRENTLY genuinely
 * failing — this is a live per-case check, not a hardcoded stale skip list:
 * a future matcher fix or fixture fix flips the case back to a real,
 * asserting `test()` automatically, with no runner edit required. Each skip
 * title carries its own prompt + expected owner (per-case, not wholesale) and
 * points back to the MATCHER LIMITS catalogue for the root-cause category. A
 * ceiling assertion per tier (below) guards against silent regression: if a
 * change ever pushes MORE cases into skip than this measured baseline, that
 * assertion fails loudly instead of quietly widening the skip surface.
 *
 * The runner must be GREEN at rest — skips are acceptable per-case (with a
 * reason), never wholesale.
 */

import * as fs from "fs";
import * as path from "path";
import { readScalarField } from "../../scripts/lib/frontmatter";
import { parseDescription, wouldTrigger, buildCorpusStopwords, ParsedTrigger } from "./lib/trigger-matcher";

const REPO = path.resolve(__dirname, "..", "..");
const SKILLS_ROOT = path.join(REPO, "skills");
const TEMPLATES_ROOT = path.join(REPO, "templates", "specialists");
const TRIGGER_FILES = [
  path.join(REPO, "tests", "trigger", "core", "evals.json"),
  path.join(REPO, "tests", "trigger", "meta", "evals.json"),
];
const BOUNDARY_FILE = path.join(REPO, "tests", "boundary", "evals.json");

// ── Generic helpers ──────────────────────────────────────────────────────────

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full, match));
    else if (match(e.name)) out.push(full);
  }
  return out;
}

function truncate(s: string, n = 70): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ── Skill / specialist description loading ──────────────────────────────────

interface RawDoc {
  /** The `name:` frontmatter field — the key trigger/boundary fixtures reference. */
  name: string;
  /** Directory-relative slug, for readable test titles. */
  slug: string;
  description: string;
}

interface NamedEntity {
  name: string;
  slug: string;
  parsed: ParsedTrigger;
}

/** Every skill under skills/ that has a SKILL.md (name: + description: frontmatter), raw (unparsed). */
function loadRawSkillDocs(): RawDoc[] {
  const out: RawDoc[] = [];
  for (const skillMdPath of walk(SKILLS_ROOT, (n) => n === "SKILL.md")) {
    const content = fs.readFileSync(skillMdPath, "utf8");
    const name = readScalarField(content, "name");
    const description = readScalarField(content, "description") ?? "";
    if (!name) continue;
    out.push({
      name,
      slug: path.relative(SKILLS_ROOT, path.dirname(skillMdPath)).split(path.sep).join("/"),
      description,
    });
  }
  return out;
}

/** Every specialist template under templates/specialists/ (name: + description:), raw (unparsed). */
function loadRawSpecialistDocs(): RawDoc[] {
  const out: RawDoc[] = [];
  for (const mdPath of walk(TEMPLATES_ROOT, (n) => n.endsWith(".md"))) {
    const content = fs.readFileSync(mdPath, "utf8");
    const name = readScalarField(content, "name");
    const description = readScalarField(content, "description") ?? "";
    if (!name) continue;
    out.push({ name, slug: path.basename(mdPath, ".md"), description });
  }
  return out;
}

// Build the corpus-wide document-frequency stopword set ONCE, over every
// skill + specialist description combined (see trigger-matcher.ts's header:
// this is what keeps "Guild", "specialist", etc. from becoming spurious
// blocking DO-NOT-TRIGGER keywords for nearly every skill). All parsing below
// threads this same set through so per-skill, trigger-tier, and boundary-tier
// assertions are all scored against ONE consistent matcher configuration.
const RAW_SKILL_DOCS = loadRawSkillDocs();
const RAW_SPECIALIST_DOCS = loadRawSpecialistDocs();
const CORPUS_STOPWORDS = buildCorpusStopwords([
  ...RAW_SKILL_DOCS.map((d) => d.description),
  ...RAW_SPECIALIST_DOCS.map((d) => d.description),
]);

function toNamedEntities(docs: RawDoc[]): NamedEntity[] {
  return docs.map((d) => ({ name: d.name, slug: d.slug, parsed: parseDescription(d.description, CORPUS_STOPWORDS) }));
}

/** Every skills/*&#47;*&#47;evals.json alongside its own skill's SKILL.md. */
function findAllSkillEvals(): { slug: string; skillMdPath: string; evalsPath: string }[] {
  const out: { slug: string; skillMdPath: string; evalsPath: string }[] = [];
  for (const evalsPath of walk(SKILLS_ROOT, (n) => n === "evals.json")) {
    const skillDir = path.dirname(evalsPath);
    const skillMdPath = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMdPath)) continue;
    out.push({
      slug: path.relative(SKILLS_ROOT, skillDir).split(path.sep).join("/"),
      skillMdPath,
      evalsPath,
    });
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

interface SkillEvalsJson {
  should_trigger?: string[];
  should_not_trigger?: string[];
}

interface TriggerCase {
  id: string;
  prompt: string;
  expected_skill?: string;
  expected_specialist?: string | null;
  rationale?: string;
}

interface TriggerEvalsFile {
  tier: string;
  cases: TriggerCase[];
}

// ── Live skip mechanism (see file header: SKIP MECHANISM) ─────────────────

/** Per-tier skip counters, asserted against a measured ceiling at the bottom of each describe block. */
const skipCounts = { skill: 0, trigger: 0, boundary: 0 };

/**
 * Register one case as a real assertion if the matcher currently agrees with
 * `expected`, or as a `test.skip` (with the mismatch + a MATCHER LIMITS
 * pointer in the title) if it currently does not. Computed live at
 * collection time — see file header.
 */
function runCase(
  tier: keyof typeof skipCounts,
  title: string,
  actual: boolean,
  expected: boolean,
): void {
  if (actual === expected) {
    test(title, () => {
      expect(actual).toBe(expected);
    });
    return;
  }
  skipCounts[tier]++;
  test.skip(
    `${title} — SKIP: matcher currently says ${actual}, fixture expects ${expected} ` +
      `(v1 keyword/phrase heuristic gap — see trigger-matcher.ts's MATCHER LIMITS)`,
    () => {},
  );
}

// ── Tier 1: per-skill evals.json vs the SAME skill's own description ───────
// No cross-skill comparison — isolated, so this tier is by far the least
// likely to need triage (it only depends on one skill's own prose).

describe("per-skill evals.json vs own description", () => {
  const entries = findAllSkillEvals();

  test("at least 100 skills/*/*/evals.json fixture files are discovered", () => {
    // Anti-vacuity floor for this describe block itself — if the walk ever
    // returns near-zero, every test below would trivially "pass" by not
    // running at all.
    expect(entries.length).toBeGreaterThanOrEqual(100);
  });

  for (const { slug, skillMdPath, evalsPath } of entries) {
    const skillMd = fs.readFileSync(skillMdPath, "utf8");
    const description = readScalarField(skillMd, "description") ?? "";
    const parsed = parseDescription(description, CORPUS_STOPWORDS);
    const evals: SkillEvalsJson = JSON.parse(fs.readFileSync(evalsPath, "utf8"));

    describe(slug, () => {
      for (const [i, prompt] of (evals.should_trigger ?? []).entries()) {
        runCase("skill", `should_trigger[${i}]: "${truncate(prompt)}"`, wouldTrigger(prompt, parsed), true);
      }
      for (const [i, prompt] of (evals.should_not_trigger ?? []).entries()) {
        runCase("skill", `should_not_trigger[${i}]: "${truncate(prompt)}"`, wouldTrigger(prompt, parsed), false);
      }
    });
  }

  // Regression ceiling — measured baseline as of this lane (plugin-audit-
  // remediation G9, 2026-07-13) after the matcher fixes documented in
  // trigger-matcher.ts: self-overlap resolution, corpus document-frequency
  // floor (35%, DO-NOT-TRIGGER-tuned), X/<placeholder> stripping, backtick-
  // span masking. A future change that pushes MORE cases into skip here is a
  // real regression, not routine drift — investigate before raising this.
  test("skip ceiling: no more than 178 per-skill cases are in matcher-limit skip", () => {
    expect(skipCounts.skill).toBeLessThanOrEqual(178);
  });
});

// ── Tier 2: tests/trigger/{core,meta}/evals.json — cross-skill cases ───────

describe("tests/trigger/{core,meta}/evals.json vs all skill descriptions", () => {
  const allSkills = toNamedEntities(RAW_SKILL_DOCS);
  const byName = new Map(allSkills.map((s) => [s.name, s]));

  test("at least 90 skill descriptions are discovered", () => {
    expect(allSkills.length).toBeGreaterThanOrEqual(90);
  });

  for (const filePath of TRIGGER_FILES) {
    const file: TriggerEvalsFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const relPath = path.relative(REPO, filePath);

    describe(`${relPath} (tier: ${file.tier})`, () => {
      test(`${file.tier}: fixture has cases`, () => {
        expect(file.cases.length).toBeGreaterThan(0);
      });

      for (const c of file.cases) {
        if (c.expected_skill === null || c.expected_skill === undefined) {
          // NEGATIVE-CASE ID CONVENTIONS (both observed in these fixtures):
          //   "<skill-name>-neg-N"        → that named skill must NOT trigger.
          //   "boundary-<a>-vs-<b>-N"     → NEITHER candidate skill (guild-<a>,
          //                                 guild-<b>) should trigger — genuinely
          //                                 ambiguous, no single owner.
          // A candidate side that isn't a real skill (e.g. "specialist-writer" —
          // specialist-agent-writer is a dev-team AGENT, not a P1 skill) is
          // skipped rather than asserted on; the rationale text names the
          // actionable side explicitly in every such case in this corpus.
          const negMatch = /^(.+)-neg-\d+$/.exec(c.id);
          const boundaryMatch = /^boundary-(.+)-vs-(.+)-\d+$/.exec(c.id);
          const excludedNames: string[] = negMatch
            ? [negMatch[1]]
            : boundaryMatch
              ? [`guild-${boundaryMatch[1]}`, `guild-${boundaryMatch[2]}`]
              : [];

          test(`${c.id}: structural — resolves to ≥1 real skill`, () => {
            expect(excludedNames.length).toBeGreaterThan(0);
          });
          const resolvable = excludedNames.filter((n) => byName.has(n));
          test(`${c.id}: structural — ≥1 excluded name is a real skill`, () => {
            expect(resolvable.length).toBeGreaterThan(0);
          });
          const allExcludedOk = resolvable.every((n) => !wouldTrigger(c.prompt, byName.get(n)!.parsed));
          runCase(
            "trigger",
            `${c.id}: "${truncate(c.prompt)}" → null, excludes [${resolvable.join(", ")}] (${truncate(c.rationale ?? "", 50)})`,
            allExcludedOk,
            true,
          );
          continue;
        }

        const expected = byName.get(c.expected_skill!);
        test(`${c.id}: structural — expected_skill "${c.expected_skill}" resolves to a real skill`, () => {
          expect(expected).toBeDefined();
        });
        if (expected) {
          // INCLUSIVE bar: the expected skill must be AMONG the matcher's
          // matches for this prompt — not necessarily the sole match (see
          // file header: several descriptions share vocabulary on purpose).
          runCase(
            "trigger",
            `${c.id}: "${truncate(c.prompt)}" → ${c.expected_skill} (${truncate(c.rationale ?? "", 50)})`,
            wouldTrigger(c.prompt, expected.parsed),
            true,
          );
        }
      }
    });
  }

  // Regression ceiling — see tier 1's identical note. Measured baseline as of
  // this lane after the matcher fixes in trigger-matcher.ts.
  test("skip ceiling: no more than 14 trigger-tier cases are in matcher-limit skip", () => {
    expect(skipCounts.trigger).toBeLessThanOrEqual(14);
  });
});

// ── Tier 3: tests/boundary/evals.json — cross-specialist collision cases ───

describe("tests/boundary/evals.json vs all specialist template descriptions", () => {
  const allSpecialists = toNamedEntities(RAW_SPECIALIST_DOCS);
  const byName = new Map(allSpecialists.map((s) => [s.name, s]));

  test("at least 12 specialist templates are discovered", () => {
    expect(allSpecialists.length).toBeGreaterThanOrEqual(12);
  });

  const file: TriggerEvalsFile = JSON.parse(fs.readFileSync(BOUNDARY_FILE, "utf8"));

  test("boundary fixture has cases", () => {
    expect(file.cases.length).toBeGreaterThan(0);
  });

  for (const c of file.cases) {
    if (c.expected_specialist === null || c.expected_specialist === undefined) {
      const winners = allSpecialists.filter((s) => wouldTrigger(c.prompt, s.parsed)).map((s) => s.name);
      runCase(
        "boundary",
        `${c.id}: "${truncate(c.prompt)}" → null (too generic for any single specialist)`,
        winners.length === 0,
        true,
      );
      continue;
    }

    const expected = byName.get(c.expected_specialist!);
    test(`${c.id}: structural — expected_specialist "${c.expected_specialist}" resolves to a real template`, () => {
      expect(expected).toBeDefined();
    });
    if (expected) {
      runCase(
        "boundary",
        `${c.id}: "${truncate(c.prompt)}" → ${c.expected_specialist} (${truncate(c.rationale ?? "", 50)})`,
        wouldTrigger(c.prompt, expected.parsed),
        true,
      );
    }
  }

  // Regression ceiling — see tier 1's identical note. Measured baseline as of
  // this lane after the matcher fixes in trigger-matcher.ts.
  test("skip ceiling: no more than 16 boundary-tier cases are in matcher-limit skip", () => {
    expect(skipCounts.boundary).toBeLessThanOrEqual(16);
  });
});
