/**
 * __tests__/instantiate-template.test.ts
 *
 * LW3-5 (SC-W3-1 producer) — lane self-test for the template producer. Proves the producer
 * instantiates a guild.template.v1 into a W1-valid explore/define pair, fails closed on a
 * bad template / bad JSON, resolves ids and paths, and (anti-vacuous) that the SHIPPED
 * `templates/products/*.template.json` files each produce W1-valid artifacts.
 *
 * The AUTHORITATIVE cross-cutting eval is LW3-6 (eval-engineer); this is the lane gate.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  produceSkeletons,
  produceFromTemplateFile,
  resolveTemplatePath,
  parseProducerArgs,
  safeSlug,
  assertNotRuntimeTree,
  writeSkeletonPair,
} from "../instantiate-template";
import { validateExploreV1, EXPLORE_SCHEMA_VERSION } from "../lib/explore-schema";
import { validateDefineV1, DEFINE_SCHEMA_VERSION } from "../lib/define-schema";
import { TEMPLATE_V1_EXAMPLE } from "../lib/template-schema";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

describe("produceSkeletons — template → W1-valid pair", () => {
  it("instantiates the example template to artifacts that pass the W1 validators", () => {
    const { explore, define } = produceSkeletons(TEMPLATE_V1_EXAMPLE);
    expect(explore.schema_version).toBe(EXPLORE_SCHEMA_VERSION);
    expect(define.schema_version).toBe(DEFINE_SCHEMA_VERSION);
    expect(validateExploreV1(explore).valid).toBe(true);
    expect(validateDefineV1(define).valid).toBe(true);
  });

  it("fails closed on an invalid template (missing required field)", () => {
    const bad = { ...TEMPLATE_V1_EXAMPLE, specialists: [] };
    expect(() => produceSkeletons(bad)).toThrow();
  });

  it("fails closed on a non-object template", () => {
    expect(() => produceSkeletons(null)).toThrow();
    expect(() => produceSkeletons("nope")).toThrow();
  });

  it("fail-closed: rejects a SPARSE array in the template (would serialize to null)", () => {
    // sparse acceptance_criteria — a hole the forEach-based validators would skip
    const sparseAC = JSON.parse(JSON.stringify(TEMPLATE_V1_EXAMPLE));
    const holed: unknown[] = [];
    holed[1] = { id: "AC-1", text: "ok" }; // index 0 is a hole
    sparseAC.artifact_skeletons.define.acceptance_criteria = holed;
    expect(() => produceSkeletons(sparseAC)).toThrow(/sparse array hole/);

    // sparse specialists — required string[] with a hole
    const sparseSpec = JSON.parse(JSON.stringify(TEMPLATE_V1_EXAMPLE));
    const s: unknown[] = [];
    s[1] = "backend";
    sparseSpec.specialists = s;
    expect(() => produceSkeletons(sparseSpec)).toThrow(/sparse array hole/);
  });
});

describe("AC37 containment — safeSlug + assertNotRuntimeTree", () => {
  const PLUG = "/plug";

  it("safeSlug rejects traversal / separators / dot-dirs / absolute", () => {
    expect(() => safeSlug("../../skills/meta/x")).toThrow();
    expect(() => safeSlug("a/b")).toThrow();
    expect(() => safeSlug("..")).toThrow();
    expect(() => safeSlug(".")).toThrow();
    expect(() => safeSlug("/abs")).toThrow();
    expect(safeSlug("cli-tool")).toBe("cli-tool");
    expect(safeSlug("my_app.v2")).toBe("my_app.v2");
  });

  it("positive containment: throws for ANY in-plugin target except .guild (no deny-list to drift)", () => {
    for (const tree of [
      "skills/meta/product-template",
      "agents",
      "commands",
      ".claude-plugin/x",
      ".claude/agents",
      "dist/claude-code/skills", // rendered host-package surface
      "node_modules/pkg",
      "some-future-tree", // not enumerated anywhere — still denied
      "..guild/explore", // a sibling literally named "..guild" — INSIDE the root, must not escape
    ]) {
      expect(() => assertNotRuntimeTree(`/plug/${tree}`, PLUG)).toThrow(/AC37/);
    }
    // the plugin root itself is also refused
    expect(() => assertNotRuntimeTree("/plug", PLUG)).toThrow(/AC37/);
  });

  it("genuinely-outside targets (.. traversal / sibling repo) are allowed", () => {
    expect(() => assertNotRuntimeTree("/other/.guild/explore", PLUG)).not.toThrow();
    expect(() => assertNotRuntimeTree("/plug/../sibling/.guild", PLUG)).not.toThrow();
  });

  it("assertNotRuntimeTree allows a .guild artifact root (inside or outside the plugin root)", () => {
    expect(() => assertNotRuntimeTree("/plug/.guild/explore", PLUG)).not.toThrow();
    expect(() => assertNotRuntimeTree("/some/repo/.guild/explore", PLUG)).not.toThrow();
  });

  it("anti-vacuous: follows a real symlink that escapes into a runtime tree and throws", () => {
    const root = fs.mkdtempSync(path.join(require("os").tmpdir(), "lw35-"));
    try {
      const pluginRoot = path.join(root, "plugin");
      fs.mkdirSync(path.join(pluginRoot, "skills"), { recursive: true });
      const guildDir = path.join(root, "repo", ".guild");
      fs.mkdirSync(guildDir, { recursive: true });
      // .guild/explore -> plugin/skills  (a malicious symlink escape)
      fs.symlinkSync(path.join(pluginRoot, "skills"), path.join(guildDir, "explore"));
      expect(() => assertNotRuntimeTree(path.join(guildDir, "explore"), pluginRoot)).toThrow(/AC37/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // codex G-lane LW3-5 FINDING: a target OUTSIDE the plugin root that lands in a forbidden
  // runtime sub-tree of the CONSUMING repo (e.g. `--out-dir=skills`) was previously allowed.
  it("consuming-root deny-list: refuses skills/agents/.claude-agents subtrees of the consuming repo", () => {
    const PLUG = "/nx-plug";
    const REPO = "/nx-repo";
    for (const tree of ["skills/explore", "agents", "commands/x", "hooks", ".claude-plugin/y", "dist/z", ".claude/agents"]) {
      expect(() => assertNotRuntimeTree(`${REPO}/${tree}`, PLUG, REPO)).toThrow(/AC37/);
    }
    // the normal .guild artifact target and an arbitrary build dir stay allowed
    expect(() => assertNotRuntimeTree(`${REPO}/.guild/explore`, PLUG, REPO)).not.toThrow();
    expect(() => assertNotRuntimeTree(`${REPO}/build/explore`, PLUG, REPO)).not.toThrow();
    // `.claude/settings` is NOT `.claude/agents` — must not be over-blocked
    expect(() => assertNotRuntimeTree(`${REPO}/.claude/settings`, PLUG, REPO)).not.toThrow();
  });

  // codex re-gate FINDING: case-insensitive hosts (macOS/Windows) resolve `Skills/` to the same
  // tree as `skills/` — the segment comparison must be case-normalized or the guard is bypassable.
  it("consuming-root deny-list is case-insensitive (Skills/ Agents/ HOOKS/ .Claude/Agents)", () => {
    const PLUG = "/nx-plug";
    const REPO = "/nx-repo";
    for (const tree of ["Skills/explore", "Agents", "HOOKS", ".claude-PLUGIN/x", "DIST/z", ".Claude/Agents"]) {
      expect(() => assertNotRuntimeTree(`${REPO}/${tree}`, PLUG, REPO)).toThrow(/AC37/);
    }
  });

  // codex re-gate FINDING: Windows ignores trailing dots/spaces in a path component, so `skills.`
  // and `skills ` resolve to the same dir as `skills` — the segment must be canonicalized.
  it("consuming-root deny-list canonicalizes Win32 trailing dot/space aliases", () => {
    const PLUG = "/nx-plug";
    const REPO = "/nx-repo";
    for (const tree of ["skills.", "skills ", "SKILLS. ", "agents.", ".Claude./Agents."]) {
      expect(() => assertNotRuntimeTree(`${REPO}/${tree}/x`, PLUG, REPO)).toThrow(/AC37/);
    }
    // a genuinely different dir whose name merely CONTAINS a dot stays allowed (not over-stripped)
    expect(() => assertNotRuntimeTree(`${REPO}/skills.archive/x`, PLUG, REPO)).not.toThrow();
  });
});

describe("AC37 no-self-edit — fs-spy anti-vacuous write proof (writeSkeletonPair)", () => {
  const produced = produceSkeletons(TEMPLATE_V1_EXAMPLE);
  let tmp: string;
  let repo: string;
  let plugin: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "lw35-write-"));
    repo = path.join(tmp, "repo");
    plugin = path.join(tmp, "plugin");
    fs.mkdirSync(repo, { recursive: true });
    fs.mkdirSync(plugin, { recursive: true });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("CONTROL (proves the spy is not vacuous): a legit .guild write DOES fire fs.writeFileSync", () => {
    const writeSpy = jest.spyOn(fs, "writeFileSync");
    const mkdirSpy = jest.spyOn(fs, "mkdirSync");
    const { explorePath, definePath } = writeSkeletonPair(produced, { cwd: repo, pluginRoot: plugin, slug: "cli-tool" });
    // the spy DID observe writes — so a forbidden-path zero-call assertion below is meaningful
    expect(writeSpy).toHaveBeenCalled();
    expect(mkdirSpy).toHaveBeenCalled();
    // and EVERY write landed under the consuming repo's .guild tree, nowhere else
    const guildRoot = path.join(repo, ".guild");
    for (const call of writeSpy.mock.calls) {
      expect(String(call[0])).toContain(guildRoot);
    }
    expect(fs.existsSync(explorePath)).toBe(true);
    expect(fs.existsSync(definePath)).toBe(true);
  });

  it("AC37: --out-dir=skills (consuming-repo runtime tree) throws with ZERO fs mutation", () => {
    const writeSpy = jest.spyOn(fs, "writeFileSync");
    const mkdirSpy = jest.spyOn(fs, "mkdirSync");
    expect(() =>
      writeSkeletonPair(produced, { cwd: repo, pluginRoot: plugin, outDir: "skills", slug: "cli-tool" })
    ).toThrow(/AC37/);
    // the guard ran BEFORE any mkdir/write — nothing touched the skills tree (or anywhere)
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(repo, "skills"))).toBe(false);
  });

  it("AC37: --out-dir=agents and an absolute consuming-repo skills/ path both refuse with zero writes", () => {
    for (const outDir of ["agents", path.join(repo, "skills")]) {
      const writeSpy = jest.spyOn(fs, "writeFileSync");
      const mkdirSpy = jest.spyOn(fs, "mkdirSync");
      expect(() =>
        writeSkeletonPair(produced, { cwd: repo, pluginRoot: plugin, outDir, slug: "cli-tool" })
      ).toThrow(/AC37/);
      expect(mkdirSpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
      jest.restoreAllMocks();
    }
  });
});

describe("produceFromTemplateFile — read + parse + produce", () => {
  it("produces a W1-valid pair from injected file contents", () => {
    const res = produceFromTemplateFile("/virtual/cli-tool.template.json", () =>
      JSON.stringify(TEMPLATE_V1_EXAMPLE)
    );
    expect(validateExploreV1(res.explore).valid).toBe(true);
    expect(validateDefineV1(res.define).valid).toBe(true);
  });

  it("fails closed on malformed JSON", () => {
    expect(() => produceFromTemplateFile("/virtual/x.json", () => "{not json")).toThrow(/not valid JSON/);
  });

  it("fails closed on a read error", () => {
    expect(() =>
      produceFromTemplateFile("/virtual/missing.json", () => {
        throw new Error("ENOENT");
      })
    ).toThrow(/cannot read template file/);
  });
});

describe("resolveTemplatePath", () => {
  it("maps a bare id to templates/products/<id>.template.json", () => {
    expect(resolveTemplatePath("cli-tool", "/plug", "/work")).toBe(
      "/plug/templates/products/cli-tool.template.json"
    );
  });
  it("treats a .json reference as a literal path (resolved against cwd)", () => {
    expect(resolveTemplatePath("custom/foo.json", "/plug", "/work")).toBe("/work/custom/foo.json");
  });
});

describe("parseProducerArgs", () => {
  it("parses the positional ref + flags", () => {
    const a = parseProducerArgs(["cli-tool", "--slug=my-cli", "--out-dir=/tmp/out", "--stdout"]);
    expect(a.ref).toBe("cli-tool");
    expect(a.slug).toBe("my-cli");
    expect(a.outDir).toBe("/tmp/out");
    expect(a.stdout).toBe(true);
  });
  it("first bare token wins as ref; flags unset default to null/false", () => {
    const a = parseProducerArgs(["web-app"]);
    expect(a.ref).toBe("web-app");
    expect(a.slug).toBeNull();
    expect(a.stdout).toBe(false);
  });
});

describe("anti-vacuous: shipped product templates each produce W1-valid artifacts", () => {
  const dir = path.join(PLUGIN_ROOT, "templates", "products");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".template.json")) : [];

  it("there is at least one shipped product template", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} → W1-valid explore + define`, () => {
      const res = produceFromTemplateFile(path.join(dir, f));
      expect(validateExploreV1(res.explore).valid).toBe(true);
      expect(validateDefineV1(res.define).valid).toBe(true);
    });
  }
});
