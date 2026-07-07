/**
 * scripts/__tests__/skill-source-transform.test.ts
 *
 * TDD suite for scripts/lib/skill-source-transform.ts — the LW2-1 NEUTRAL skill
 * registry (`guild.skill_src.v1`) + the deterministic source→host (Claude)
 * transformer (spec SC-W2-1, ADR step 15).
 *
 * The earlier round was GAMED: neutral sources were verbatim byte-copies of the
 * committed SKILL.md, so the transform was an IDENTITY function and proved nothing.
 * This suite asserts the corrected design (modelled on the command lane): the
 * SOURCE is a STRUCTURED JSON registry, and the renderer PROJECTS each entry into
 * Claude's SKILL.md shape — a NON-trivial JSON-entry → markdown transform.
 *
 * Coverage:
 *   - all 5 entries in the on-disk registry render BYTE-IDENTICAL to the committed SKILL.md
 *   - the transform is NON-trivial: the source body carries NO frontmatter; the
 *     renderer reconstructs the `---` fence + ordered keys from discrete fields
 *   - the on-disk registry is structured JSON, NOT a copy of any rendered SKILL.md
 *   - render reconstructs the canonical 4-key frontmatter in order, unquoted
 *   - determinism (repeat render byte-identical; no clock/random)
 *   - extractSkillV1 is the byte-identical inverse oracle
 *   - fail-closed entry + registry validators
 *   - hardened staging guard: rejects live paths, closes the caller-root bypass,
 *     rejects a symlinked stagingRoot, writes only under staging
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  validateSkillSrcV1,
  validateSkillSrcRegistryV1,
  renderSkillV1,
  renderSkillFromRegistry,
  extractSkillV1,
  parseSkillRegistry,
  loadSkillRegistry,
  assertStagingPath,
  renderSkillToStaging,
  DEFAULT_REGISTRY_PATH,
  SKILL_SRC_SCHEMA_VERSION,
  WAVE2_SKILL_IDS,
  type SkillSrcV1,
  type SkillSrcRegistryV1,
} from "../lib/skill-source-transform";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_META = path.join(PLUGIN_ROOT, "skills", "meta");

function readSkillMd(id: string): string {
  return fs.readFileSync(path.join(SKILLS_META, id, "SKILL.md"), "utf8");
}

const REGISTRY: SkillSrcRegistryV1 = loadSkillRegistry();

function entryFor(id: string): SkillSrcV1 {
  const e = REGISTRY.skills.find((s) => s.id === id);
  if (!e) throw new Error(`no registry entry for ${id}`);
  return e;
}

describe("skill-source-transform: byte-identical render FROM the structured registry (SC-W2-1)", () => {
  it("the on-disk registry is a valid guild.skill_src.v1 with the 5 invocation skills", () => {
    expect(REGISTRY.schema_version).toBe("guild.skill_src.v1");
    expect(REGISTRY.skills.map((s) => s.id).sort()).toEqual([...WAVE2_SKILL_IDS].sort());
    expect(validateSkillSrcRegistryV1(REGISTRY).valid).toBe(true);
  });

  it("renders all 5 skills BYTE-FOR-BYTE from the registry entry", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const committed = readSkillMd(id);
      const rendered = renderSkillFromRegistry(REGISTRY, id);
      expect(rendered).toBe(committed);
      expect(Buffer.from(rendered)).toEqual(Buffer.from(committed));
    }
  });

  it("reconstructs the canonical 4-key frontmatter in order, unquoted", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const rendered = renderSkillFromRegistry(REGISTRY, id);
      const head = rendered.split("\n---\n")[0]; // frontmatter incl. opening fence
      const keys = head
        .split("\n")
        .filter((l) => /^[a-z_]+: /.test(l))
        .map((l) => l.split(":")[0]);
      expect(keys).toEqual(["name", "description", "when_to_use", "type"]);
      // unquoted: the description value is emitted raw (not wrapped in quotes)
      const e = entryFor(id);
      expect(rendered).toContain(`\ndescription: ${e.description}\n`);
    }
  });
});

describe("skill-source-transform: the transform is GENUINELY non-trivial (not identity)", () => {
  it("the source body carries NO frontmatter — the renderer reconstructs it", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const e = entryFor(id);
      // body is the post-fence markdown only: it must NOT start with a `---` fence
      // and must NOT contain the frontmatter key lines (those live as discrete fields).
      expect(e.body.startsWith("---")).toBe(false);
      expect(e.body).not.toContain(`\nname: ${e.name}\n`);
      expect(e.body).not.toContain(`\ntype: ${e.type}\n`);
      // the rendered file DOES contain the reconstructed fence + keys
      const rendered = renderSkillV1(e);
      expect(rendered.startsWith("---\nname: ")).toBe(true);
    }
  });

  it("the on-disk registry file is structured JSON, NOT a copy of any rendered SKILL.md", () => {
    const registryText = fs.readFileSync(DEFAULT_REGISTRY_PATH, "utf8");
    expect(() => JSON.parse(registryText)).not.toThrow();
    expect(registryText.startsWith("{")).toBe(true);
    for (const id of WAVE2_SKILL_IDS) {
      expect(registryText).not.toBe(readSkillMd(id));
    }
    // The render output is materially different from the entry's JSON serialization
    // (proves a real serialization step, not a passthrough).
    const e = entryFor("tdd");
    expect(renderSkillV1(e)).not.toBe(JSON.stringify(e));
  });

  it("changing a structured field changes ONLY the rendered frontmatter, deterministically", () => {
    const e = entryFor("tdd");
    const mutated: SkillSrcV1 = { ...e, name: "guild-tdd-x" };
    const out = renderSkillV1(mutated);
    expect(out).toContain("\nname: guild-tdd-x\n");
    expect(out).not.toBe(readSkillMd("tdd")); // a real change in the source changes the render
    // body is untouched by a frontmatter-field change
    expect(out.endsWith(e.body)).toBe(true);
  });
});

describe("skill-source-transform: determinism + inverse oracle", () => {
  it("repeated render of the same entry is byte-identical (no clock/randomness)", () => {
    const e = entryFor("verify-done");
    expect(renderSkillV1(e)).toBe(renderSkillV1(e));
  });

  it("extractSkillV1 is the byte-identical inverse: render(extract(committed)) === committed", () => {
    for (const id of WAVE2_SKILL_IDS) {
      const committed = readSkillMd(id);
      const entry = extractSkillV1(id, committed);
      expect(entry).not.toBeNull();
      expect(renderSkillV1(entry!)).toBe(committed);
    }
  });

  it("the on-disk registry equals a fresh extraction of the committed corpus", () => {
    for (const id of WAVE2_SKILL_IDS) {
      expect(entryFor(id)).toEqual(extractSkillV1(id, readSkillMd(id)));
    }
  });

  it("exposes the v1 schema version constant", () => {
    expect(SKILL_SRC_SCHEMA_VERSION).toBe("guild.skill_src.v1");
  });
});

describe("skill-source-transform: fail-closed entry validator (F-2 — escalate, never silent diff)", () => {
  const base: SkillSrcV1 = {
    id: "demo",
    name: "guild-demo",
    description: "a one-line description",
    when_to_use: "when demoing",
    type: "meta",
    body: "\n# Demo\n\nbody\n",
  };

  it("accepts a faithful entry", () => {
    expect(validateSkillSrcV1(base).valid).toBe(true);
  });

  it("rejects a newline in a scalar field (would break single-line render)", () => {
    expect(validateSkillSrcV1({ ...base, description: "line one\nline two" }).valid).toBe(false);
    expect(validateSkillSrcV1({ ...base, when_to_use: "a\nb" }).valid).toBe(false);
  });

  it("rejects a missing/empty required field", () => {
    expect(validateSkillSrcV1({ ...base, name: "" }).valid).toBe(false);
    const { when_to_use, ...noWtu } = base;
    void when_to_use;
    expect(validateSkillSrcV1(noWtu).valid).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(validateSkillSrcV1({ ...base, extra: 1 }).valid).toBe(false);
  });

  it("rejects a non-stem id and a non-scalar name", () => {
    expect(validateSkillSrcV1({ ...base, id: "Demo Skill" }).valid).toBe(false);
    expect(validateSkillSrcV1({ ...base, name: "guild demo" }).valid).toBe(false);
  });

  it("rejects a body without the canonical blank-line head / single trailing newline", () => {
    expect(validateSkillSrcV1({ ...base, body: "# no blank line\n" }).valid).toBe(false);
    expect(validateSkillSrcV1({ ...base, body: "\n# trailing\n\n" }).valid).toBe(false);
  });

  it("never throws on exotic input", () => {
    expect(() => validateSkillSrcV1(42 as unknown)).not.toThrow();
    expect(() => validateSkillSrcV1(null)).not.toThrow();
    expect(validateSkillSrcV1(42 as unknown).valid).toBe(false);
  });

  it("FAILS CLOSED on a throwing-getter object (does not propagate the throw) — codex re-gate", () => {
    const throwingGetter = {
      get id(): string {
        throw new Error("boom from getter");
      },
    };
    expect(() => validateSkillSrcV1(throwingGetter as unknown)).not.toThrow();
    expect(validateSkillSrcV1(throwingGetter as unknown).valid).toBe(false);
  });

  it("FAILS CLOSED on a Proxy whose traps throw (ownKeys + get)", () => {
    const evil = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("boom from ownKeys trap");
        },
        get() {
          throw new Error("boom from get trap");
        },
      },
    );
    expect(() => validateSkillSrcV1(evil as unknown)).not.toThrow();
    expect(validateSkillSrcV1(evil as unknown).valid).toBe(false);
    // The registry validator must be equally fail-closed (its own access can trip the trap).
    expect(() => validateSkillSrcRegistryV1(evil as unknown)).not.toThrow();
    expect(validateSkillSrcRegistryV1(evil as unknown).valid).toBe(false);
  });

  it("FAILS CLOSED when the thrown value's toString() itself throws (no String(err) re-throw)", () => {
    // A getter throws an UNSTRINGIFIABLE object — its toString() throws too. If the
    // catch block did `String(err)`, the error would escape the catch. It must not.
    const unstringifiable = {
      toString() {
        throw new Error("toString boom");
      },
    };
    const evil = {
      get id(): string {
        throw unstringifiable as unknown as Error;
      },
    };
    expect(() => validateSkillSrcV1(evil as unknown)).not.toThrow();
    expect(validateSkillSrcV1(evil as unknown).valid).toBe(false);

    const registry = { schema_version: SKILL_SRC_SCHEMA_VERSION, skills: [evil] };
    expect(() => validateSkillSrcRegistryV1(registry as unknown)).not.toThrow();
    expect(validateSkillSrcRegistryV1(registry as unknown).valid).toBe(false);
  });

  it("registry validator FAILS CLOSED when a skills entry is a throwing Proxy", () => {
    const evilEntry = new Proxy(
      {},
      {
        get() {
          throw new Error("boom");
        },
      },
    );
    const registry = { schema_version: SKILL_SRC_SCHEMA_VERSION, skills: [evilEntry] };
    expect(() => validateSkillSrcRegistryV1(registry as unknown)).not.toThrow();
    expect(validateSkillSrcRegistryV1(registry as unknown).valid).toBe(false);
  });

  it("renderSkillV1 THROWS on an invalid entry (never emits a non-faithful artifact)", () => {
    expect(() => renderSkillV1({ ...base, description: "a\nb" })).toThrow(/refusing to render/);
  });
});

describe("skill-source-transform: fail-closed registry validator + parse", () => {
  it("rejects a wrong schema_version, non-array skills, and duplicate ids", () => {
    expect(validateSkillSrcRegistryV1({ schema_version: "nope", skills: [] }).valid).toBe(false);
    expect(validateSkillSrcRegistryV1({ schema_version: SKILL_SRC_SCHEMA_VERSION, skills: {} }).valid).toBe(false);
    const dup = {
      schema_version: SKILL_SRC_SCHEMA_VERSION,
      skills: [entryFor("tdd"), entryFor("tdd")],
    };
    expect(validateSkillSrcRegistryV1(dup).valid).toBe(false);
  });

  it("parseSkillRegistry throws on invalid JSON and on an invalid registry", () => {
    expect(() => parseSkillRegistry("{not json")).toThrow(/not valid JSON/);
    expect(() => parseSkillRegistry(JSON.stringify({ schema_version: "x", skills: [] }))).toThrow(
      /invalid guild\.skill_src\.v1/,
    );
  });
});

describe("skill-source-transform: hardened staging guard (R2 / SC-W2-5 / LW2-1-B)", () => {
  it("REFUSES targets under the live skills/, .claude-plugin/, commands/ trees", () => {
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "skills", "meta", "tdd", "SKILL.md"), PLUGIN_ROOT),
    ).toThrow(/live surface/);
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, ".claude-plugin", "x.json"), PLUGIN_ROOT),
    ).toThrow(/live surface/);
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "commands", "guild.md"), PLUGIN_ROOT),
    ).toThrow(/live surface/);
  });

  it("ALLOWS staging/temp + the plugin/skill-src source tree", () => {
    expect(() =>
      assertStagingPath(path.join(os.tmpdir(), "guild-staging-x", "skills", "tdd", "SKILL.md"), PLUGIN_ROOT),
    ).not.toThrow();
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "skill-src", "skill-registry.json"), PLUGIN_ROOT),
    ).not.toThrow();
  });

  it("closes the caller-root bypass: a MISMATCHED pluginRoot cannot route a write into live", () => {
    const bogus = path.join(os.tmpdir(), "guild-bogus-root");
    expect(() =>
      assertStagingPath(path.join(PLUGIN_ROOT, "skills", "meta", "tdd", "SKILL.md"), bogus),
    ).toThrow(/live surface/);
  });

  it("rejects a symlinked stagingRoot pointing into live skills/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-symlink-"));
    let symlinkOk = true;
    const link = path.join(tmpDir, "sneaky");
    try {
      fs.symlinkSync(path.join(PLUGIN_ROOT, "skills", "meta"), link, "dir");
    } catch {
      symlinkOk = false;
    }
    try {
      if (symlinkOk) {
        expect(() => assertStagingPath(path.join(link, "tdd", "SKILL.md"), PLUGIN_ROOT)).toThrow(
          /live surface/,
        );
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("skill-source-transform: renderSkillToStaging (staging-only writer)", () => {
  let tmpStaging: string;
  beforeAll(() => {
    tmpStaging = fs.mkdtempSync(path.join(os.tmpdir(), "guild-staging-"));
  });
  afterAll(() => {
    fs.rmSync(tmpStaging, { recursive: true, force: true });
  });

  it("renders from the registry to staging byte-identical to the committed skill", () => {
    const { outPath, bytes } = renderSkillToStaging(REGISTRY, "tdd", tmpStaging, PLUGIN_ROOT);
    expect(outPath.startsWith(tmpStaging)).toBe(true);
    expect(bytes).toBe(readSkillMd("tdd"));
    expect(fs.readFileSync(outPath, "utf8")).toBe(readSkillMd("tdd"));
  });

  it("with a live stagingRoot + bogus pluginRoot it THROWS and writes NOTHING into live", () => {
    const probeId = "lw21-rework-probe";
    const liveStagingRoot = path.join(PLUGIN_ROOT, "skills", "meta");
    const wouldBeDir = path.join(liveStagingRoot, probeId);
    const wouldBeFile = path.join(wouldBeDir, "SKILL.md");
    const probeRegistry: SkillSrcRegistryV1 = {
      schema_version: SKILL_SRC_SCHEMA_VERSION,
      skills: [{ ...entryFor("tdd"), id: probeId }],
    };
    try {
      expect(() =>
        renderSkillToStaging(probeRegistry, probeId, liveStagingRoot, path.join(os.tmpdir(), "bogus")),
      ).toThrow(/live surface/);
      expect(fs.existsSync(wouldBeFile)).toBe(false);
      expect(fs.existsSync(wouldBeDir)).toBe(false);
    } finally {
      fs.rmSync(wouldBeDir, { recursive: true, force: true });
    }
  });
});
