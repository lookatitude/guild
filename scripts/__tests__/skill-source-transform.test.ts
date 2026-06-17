/**
 * scripts/__tests__/skill-source-transform.test.ts
 *
 * TDD suite for scripts/lib/skill-source-transform.ts — the LW2-1 deterministic
 * source→host (Claude) skill transformer (`guild.skill_source.v1`).
 *
 * Wave context (BY POINTER): .guild/spec/universal-host-p2-wave2.md — SC-W2-1.
 *
 * This is the LANE self-test that proves the TRANSFORMER is capable of
 * byte-identical render over the five real committed skills, via the pure inverse
 * (`extractSkillSource`) as the oracle:
 *     renderClaudeSkill(extractSkillSource(committed)) === committed   (byte-for-byte)
 * The canonical render-equivalence + drift gate against the AUTHORED
 * `plugin/skill-src/**` sources (LW2-2) is owned by eval-engineer (LW2-6); this
 * suite proves the tool those lanes depend on, not those lanes' artifacts.
 *
 * Coverage:
 *   - byte-identical round-trip over the 5 invocation-driving skills (real files)
 *   - using-guild's co-located SKILL.src.md ALSO round-trips (precedent sanity)
 *   - render is a CANONICAL re-serialization (re-render of parsed AST == render)
 *   - determinism: repeated render of the same AST is byte-identical
 *   - parser is fail-closed (no opening/closing delimiter, non-conforming line,
 *     empty frontmatter)
 *   - frontmatter ordering is preserved
 *   - body verbatim: `---` horizontal rules in the body do not re-trigger the close
 *   - assertStagingPath REFUSES the live surface, ALLOWS staging/temp
 *   - renderSkillToStaging writes only under staging + refuses a live target
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseSkillSource,
  renderClaudeSkill,
  renderClaudeSkillFromSource,
  extractSkillSource,
  serializeSkillSource,
  assertStagingPath,
  renderSkillToStaging,
  SkillSourceParseError,
  SKILL_SOURCE_SCHEMA_VERSION,
  WAVE2_SKILL_IDS,
} from "../lib/skill-source-transform";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_META = path.join(PLUGIN_ROOT, "skills", "meta");

function readSkillMd(id: string): string {
  return fs.readFileSync(path.join(SKILLS_META, id, "SKILL.md"), "utf8");
}

describe("skill-source-transform: byte-identical round-trip (SC-W2-1)", () => {
  it("renders all 5 invocation-driving skills byte-for-byte via the inverse oracle", () => {
    // Anti-vacuity: assert we actually have all five before asserting equality.
    expect(WAVE2_SKILL_IDS).toEqual([
      "review-broker",
      "execute-plan",
      "systematic-debug",
      "tdd",
      "verify-done",
    ]);

    for (const id of WAVE2_SKILL_IDS) {
      const committed = readSkillMd(id);
      const rendered = renderClaudeSkill(extractSkillSource(committed));
      expect(rendered).toBe(committed);
      // And the bytes are exactly equal (catch any encoding subtlety).
      expect(Buffer.from(rendered)).toEqual(Buffer.from(committed));
    }
  });

  it("each rendered skill preserves the canonical 4-field frontmatter in order", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const src = extractSkillSource(readSkillMd(id));
      expect(src.frontmatter.map((f) => f.key)).toEqual([
        "name",
        "description",
        "when_to_use",
        "type",
      ]);
    }
  });

  it("using-guild's co-located SKILL.src.md round-trips too (P0 precedent sanity)", () => {
    const srcText = fs.readFileSync(
      path.join(SKILLS_META, "using-guild", "SKILL.src.md"),
      "utf8",
    );
    expect(renderClaudeSkillFromSource(srcText)).toBe(srcText);
  });
});

describe("skill-source-transform: canonical re-serialization + determinism", () => {
  it("render is a canonical re-serialization (parse∘render is idempotent)", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const once = renderClaudeSkill(extractSkillSource(readSkillMd(id)));
      const twice = renderClaudeSkill(extractSkillSource(once));
      expect(twice).toBe(once);
    }
  });

  it("repeated render of the same AST is byte-identical (no clock/randomness)", () => {
    const src = extractSkillSource(readSkillMd("tdd"));
    const a = renderClaudeSkill(src);
    const b = renderClaudeSkill(src);
    expect(a).toBe(b);
  });

  it("serializeSkillSource equals renderClaudeSkill (source on-disk shape == claude shape)", () => {
    const src = extractSkillSource(readSkillMd("verify-done"));
    expect(serializeSkillSource(src)).toBe(renderClaudeSkill(src));
  });

  it("sets the v1 schema version on the parsed AST", () => {
    const src = parseSkillSource("---\nname: x\n---\nbody\n");
    expect(src.schema_version).toBe(SKILL_SOURCE_SCHEMA_VERSION);
    expect(src.schema_version).toBe("guild.skill_source.v1");
  });
});

describe("skill-source-transform: body fidelity", () => {
  it("preserves the blank line + body verbatim, including `---` rules in the body", () => {
    const text =
      "---\nname: demo\ntype: meta\n---\n\n# Demo\n\nsome text\n\n---\n\nmore text after a rule\n";
    const src = parseSkillSource(text);
    expect(src.body).toBe("\n# Demo\n\nsome text\n\n---\n\nmore text after a rule\n");
    // The standalone `---` inside the body must NOT have been treated as the close.
    expect(src.frontmatter.map((f) => f.key)).toEqual(["name", "type"]);
    expect(renderClaudeSkill(src)).toBe(text);
  });

  it("handles an empty value (`key: `) round-trip", () => {
    const text = "---\nname: x\nnote: \n---\nbody\n";
    expect(renderClaudeSkillFromSource(text)).toBe(text);
    expect(parseSkillSource(text).frontmatter).toContainEqual({ key: "note", value: "" });
  });
});

describe("skill-source-transform: fail-closed parser (F-2 — escalate, never silent diff)", () => {
  it("rejects text with no opening delimiter", () => {
    expect(() => parseSkillSource("name: x\n---\nbody\n")).toThrow(SkillSourceParseError);
  });

  it("rejects frontmatter with no closing delimiter", () => {
    expect(() => parseSkillSource("---\nname: x\nbody with no close\n")).toThrow(
      SkillSourceParseError,
    );
  });

  it("rejects a non-conforming frontmatter line (no `: ` separator)", () => {
    expect(() => parseSkillSource("---\nname x\n---\nbody\n")).toThrow(/non-conforming/);
  });

  it("rejects a missing-space frontmatter line (`key:value`) — would not round-trip", () => {
    expect(() => parseSkillSource("---\nname:x\n---\nbody\n")).toThrow(SkillSourceParseError);
  });

  it("rejects empty frontmatter", () => {
    expect(() => parseSkillSource("---\n---\nbody\n")).toThrow(/empty/);
  });
});

describe("skill-source-transform: staging guard (R2 / SC-W2-5)", () => {
  it("REFUSES a target under the live skills/ tree", () => {
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "skills", "meta", "tdd", "SKILL.md"), PLUGIN_ROOT),
    ).toThrow(/live surface/);
  });

  it("REFUSES a target under .claude-plugin/ and commands/", () => {
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, ".claude-plugin", "x.json"), PLUGIN_ROOT),
    ).toThrow(/live surface|forbidden/);
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "commands", "guild.md"), PLUGIN_ROOT),
    ).toThrow(/live surface|forbidden/);
  });

  it("ALLOWS a staging/temp target (even one whose name contains 'skills')", () => {
    const staging = path.join(os.tmpdir(), "guild-staging-xyz", "skills", "tdd", "SKILL.md");
    expect(() => assertStagingPath(staging, PLUGIN_ROOT)).not.toThrow();
  });

  it("ALLOWS the plugin/skill-src source tree as a non-live path", () => {
    // skill-src is OUTSIDE the live surface — never a forbidden render target gate,
    // though sources are read not written. The guard must not flag it as live.
    const inSrcTree = path.join(PLUGIN_ROOT, "skill-src", "tdd", "SKILL.src.md");
    expect(() => assertStagingPath(inSrcTree, PLUGIN_ROOT)).not.toThrow();
  });
});

describe("skill-source-transform: renderSkillToStaging (I/O wrapper, staging-only)", () => {
  let tmpSrc: string;
  let tmpStaging: string;

  beforeAll(() => {
    tmpSrc = fs.mkdtempSync(path.join(os.tmpdir(), "guild-skillsrc-"));
    tmpStaging = fs.mkdtempSync(path.join(os.tmpdir(), "guild-staging-"));
    // Seed a source from a real committed skill (bootstrap path LW2-2 would use).
    const id = "tdd";
    const src = extractSkillSource(readSkillMd(id));
    const dir = path.join(tmpSrc, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.src.md"), serializeSkillSource(src));
  });

  afterAll(() => {
    fs.rmSync(tmpSrc, { recursive: true, force: true });
    fs.rmSync(tmpStaging, { recursive: true, force: true });
  });

  it("renders a seeded source to staging byte-identical to the committed skill", () => {
    const { outPath, bytes } = renderSkillToStaging(tmpSrc, "tdd", tmpStaging, PLUGIN_ROOT);
    expect(outPath.startsWith(tmpStaging)).toBe(true);
    expect(bytes).toBe(readSkillMd("tdd"));
    expect(fs.readFileSync(outPath, "utf8")).toBe(readSkillMd("tdd"));
  });

  it("REFUSES to render into the live surface (guard fires before any write)", () => {
    expect(() =>
      renderSkillToStaging(tmpSrc, "tdd", path.join(PLUGIN_ROOT, "skills", "meta"), PLUGIN_ROOT),
    ).toThrow(/live surface/);
  });
});

describe("skill-source-transform: caller-root bypass is closed (codex LW2-1-B)", () => {
  const BOGUS_ROOT = path.join(os.tmpdir(), "guild-bogus-root-does-not-anchor");

  it("REJECTS a live target even when the caller supplies a MISMATCHED pluginRoot", () => {
    // The attack the guard must close: anchor the liveness check to a bogus root so
    // the real live `skills/` tree looks "outside" it. The hardened guard ignores the
    // caller's root and anchors independently → still rejected.
    const liveTarget = path.join(PLUGIN_ROOT, "skills", "meta", "tdd", "SKILL.md");
    expect(() => assertStagingPath(liveTarget, BOGUS_ROOT)).toThrow(/live surface/);
    // .claude-plugin and commands too.
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, ".claude-plugin", "x.json"), BOGUS_ROOT),
    ).toThrow(/live surface/);
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "commands", "guild.md"), BOGUS_ROOT),
    ).toThrow(/live surface/);
  });

  it("renderSkillToStaging with a live stagingRoot + bogus pluginRoot throws and writes NOTHING", () => {
    const tmpSrc = fs.mkdtempSync(path.join(os.tmpdir(), "guild-skillsrc-bypass-"));
    // A probe id that does not exist in the live tree — if the guard were bypassed,
    // this file/dir would appear under the LIVE skills/meta tree.
    const probeId = "__lw21b_bypass_probe__";
    // Seed the source UNDER the probe id so render reads it and reaches the guard.
    const srcDir = path.join(tmpSrc, probeId);
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "SKILL.src.md"),
      serializeSkillSource(extractSkillSource(readSkillMd("tdd"))),
    );
    const liveStagingRoot = path.join(PLUGIN_ROOT, "skills", "meta");
    const wouldBeDir = path.join(liveStagingRoot, probeId);
    const wouldBeFile = path.join(wouldBeDir, "SKILL.md");

    try {
      // Mismatched/bogus pluginRoot — the old code would have anchored to it and let
      // the write through. The hardened guard rejects regardless.
      expect(() =>
        renderSkillToStaging(tmpSrc, probeId, liveStagingRoot, BOGUS_ROOT),
      ).toThrow(/live surface/);
      // Crucially: NO write occurred into the live tree.
      expect(fs.existsSync(wouldBeFile)).toBe(false);
      expect(fs.existsSync(wouldBeDir)).toBe(false);
    } finally {
      // Defensive cleanup in case a regression DID write (keeps the live tree clean).
      fs.rmSync(wouldBeDir, { recursive: true, force: true });
      fs.rmSync(tmpSrc, { recursive: true, force: true });
    }
  });

  it("a symlinked stagingRoot pointing into live skills/ is still rejected", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-symlink-"));
    const link = path.join(tmpDir, "sneaky");
    let symlinkOk = true;
    try {
      fs.symlinkSync(path.join(PLUGIN_ROOT, "skills", "meta"), link, "dir");
    } catch {
      symlinkOk = false; // some envs disallow symlinks — skip the assertion there
    }
    try {
      if (symlinkOk) {
        const viaLink = path.join(link, "tdd", "SKILL.md");
        expect(() => assertStagingPath(viaLink, PLUGIN_ROOT)).toThrow(/live surface/);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
