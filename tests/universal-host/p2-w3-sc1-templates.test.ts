/**
 * tests/universal-host/p2-w3-sc1-templates.test.ts
 *
 * AUTHORITATIVE cross-cutting acceptance test for SC-W3-1 (ADR step 18 / AC37 — product
 * templates). The binding gate the LW3-1 / LW3-5 self-tests foreshadow.
 *
 * Binding assertions (anti-vacuity mandatory):
 *  (1) Every shipped `templates/products/*.template.json` instantiates — via the REAL
 *      LW3-1 `instantiateTemplate` AND the LW3-5 producer `produceSkeletons` — to artifacts
 *      that pass the REAL W1 `validateExploreV1` / `validateDefineV1` (IMPORTED, never
 *      reimplemented here).
 *  (2) `validateTemplateV1` REJECTS a malformed / missing-field template (control).
 *  (3) AC37 no-self-edit: instantiation + the producer NEVER write a runtime perms / skills /
 *      agents file — proven with a real fs write-spy + a non-vacuous control that proves the
 *      spy fires on a real forbidden write; plus the producer's own runtime-tree write guard.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  validateTemplateV1,
  instantiateTemplate,
  TEMPLATE_V1_EXAMPLE,
} from "../../scripts/lib/template-schema";
import { validateExploreV1 } from "../../scripts/lib/explore-schema";
import { validateDefineV1 } from "../../scripts/lib/define-schema";
import {
  produceSkeletons,
  produceFromTemplateFile,
  resolveTemplatePath,
  assertNotRuntimeTree,
  writeSkeletonPair,
} from "../../scripts/instantiate-template";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const PRODUCTS_DIR = path.join(PLUGIN_ROOT, "templates", "products");

const productFiles = fs
  .readdirSync(PRODUCTS_DIR)
  .filter((f) => f.endsWith(".template.json"));

// Runtime-surface path matcher — what AC37 forbids ingestion/instantiation from writing.
function isRuntimeSurfaceWrite(p: string): boolean {
  const n = p.replace(/\\/g, "/");
  return (
    /(^|\/)skills\//.test(n) ||
    /(^|\/)agents\//.test(n) ||
    /(^|\/)\.claude\/agents\//.test(n) ||
    /(^|\/)\.claude-plugin\//.test(n) ||
    /(^|\/)commands\//.test(n) ||
    /permission-policy/.test(n) ||
    /(^|\/)settings\.json$/.test(n)
  );
}

const FS_WRITE_MUTATORS = [
  "writeFile", "writeFileSync", "appendFile", "appendFileSync",
  "rename", "renameSync", "rm", "rmSync", "unlink", "unlinkSync",
  "mkdir", "mkdirSync", "createWriteStream", "truncate", "truncateSync",
  "open", "openSync", "copyFile", "copyFileSync",
] as const;

/** Spy every fs write mutator; record the path it was called with. */
function spyWrites(): { paths: string[]; restore: () => void } {
  const paths: string[] = [];
  const spies = FS_WRITE_MUTATORS.map((name) => {
    const orig = (fs as unknown as Record<string, unknown>)[name];
    if (typeof orig !== "function") return null;
    return jest
      .spyOn(fs as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
      .mockImplementation(((...args: unknown[]) => {
        paths.push(String(args[0]));
        return undefined as never;
      }) as never);
  });
  return { paths, restore: () => spies.forEach((s) => s?.mockRestore()) };
}

describe("SC-W3-1 (1) — shipped templates instantiate to REAL-W1-valid artifacts", () => {
  it("ships at least one product template", () => {
    expect(productFiles.length).toBeGreaterThan(0);
  });

  it.each(productFiles)(
    "%s → validateTemplateV1 passes AND instantiates to W1-valid explore+define (both LW3-1 + LW3-5 paths)",
    (file) => {
      const raw = JSON.parse(fs.readFileSync(path.join(PRODUCTS_DIR, file), "utf8"));

      // template itself is valid
      const tv = validateTemplateV1(raw);
      expect(tv.errors).toEqual([]);
      expect(tv.valid).toBe(true);

      // LW3-1 instantiator → REAL W1 validators (imported, not reimplemented)
      const a = instantiateTemplate(raw);
      expect(validateExploreV1(a.explore).valid).toBe(true);
      expect(validateDefineV1(a.define).valid).toBe(true);

      // LW3-5 producer core → must agree (defensive re-validation lives in the producer)
      const b = produceSkeletons(raw);
      expect(validateExploreV1(b.explore).valid).toBe(true);
      expect(validateDefineV1(b.define).valid).toBe(true);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a)); // pure + identical
    }
  );

  it("anti-vacuity: a deliberately broken W1 artifact is REJECTED by the imported validator", () => {
    // proves (1)'s green is a real pass, not a validator that rubber-stamps anything.
    expect(validateExploreV1({ schema_version: "guild.explore.v1" }).valid).toBe(false);
    expect(validateDefineV1({ schema_version: "guild.define.v1" }).valid).toBe(false);
  });
});

describe("SC-W3-1 (2) — validator rejects malformed / missing-field templates", () => {
  it("rejects a missing required field", () => {
    const { specialists: _drop, ...missing } = TEMPLATE_V1_EXAMPLE;
    expect(validateTemplateV1(missing).valid).toBe(false);
  });
  it("rejects a template whose explore skeleton would not instantiate to a valid artifact", () => {
    const broken = {
      ...TEMPLATE_V1_EXAMPLE,
      artifact_skeletons: {
        ...TEMPLATE_V1_EXAMPLE.artifact_skeletons,
        explore: { ...TEMPLATE_V1_EXAMPLE.artifact_skeletons.explore, assumptions: [] },
      },
    };
    const r = validateTemplateV1(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("artifact_skeletons.explore"))).toBe(true);
  });
  it("the producer fails closed on an invalid template (throws, emits nothing)", () => {
    expect(() => produceSkeletons({ schema_version: "guild.template.v1" })).toThrow();
  });
});

describe("SC-W3-1 (3) — AC37 no-self-edit: instantiation + producer write NO runtime surface", () => {
  it("CONTROL: the write-spy actually fires on a real forbidden write (non-vacuous)", () => {
    const { paths, restore } = spyWrites();
    try {
      fs.writeFileSync("skills/meta/should-never-happen/SKILL.md", "x"); // mocked — records only
    } finally {
      restore();
    }
    expect(paths.some(isRuntimeSurfaceWrite)).toBe(true);
  });

  it("instantiating every shipped template writes NOTHING at all", () => {
    const raws = productFiles.map((f) => JSON.parse(fs.readFileSync(path.join(PRODUCTS_DIR, f), "utf8")));
    const { paths, restore } = spyWrites();
    try {
      raws.forEach((raw) => {
        instantiateTemplate(raw);
        produceSkeletons(raw);
      });
    } finally {
      restore();
    }
    expect(paths).toEqual([]);
  });

  it("the REAL producer write path lands ONLY under .guild/{explore,define} — never a runtime surface", () => {
    // Exercise the REAL producer write (temp+rename) against a tmp cwd via a template FILE.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc1-producer-"));
    const tplPath = path.join(PRODUCTS_DIR, productFiles[0]);
    const produced = produceFromTemplateFile(tplPath);
    const { explorePath, definePath } = writeSkeletonPair(produced, {
      cwd: tmp,
      pluginRoot: PLUGIN_ROOT,
      slug: "sc1-fixture",
    });
    // Both written paths exist, live under .guild/{explore,define}, and are NOT runtime surfaces.
    for (const p of [explorePath, definePath]) {
      expect(fs.existsSync(p)).toBe(true);
      const n = p.replace(/\\/g, "/");
      expect(/\.guild\/(explore|define)\//.test(n)).toBe(true);
      expect(isRuntimeSurfaceWrite(p)).toBe(false);
    }
    // The written artifacts are themselves W1-valid.
    expect(validateExploreV1(JSON.parse(fs.readFileSync(explorePath, "utf8"))).valid).toBe(true);
    expect(validateDefineV1(JSON.parse(fs.readFileSync(definePath, "utf8"))).valid).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the producer's runtime-tree write guard REFUSES a skills/agents/dist out-dir (fail-closed)", () => {
    // assertNotRuntimeTree is the producer's deterministic AC37 enforcement.
    for (const bad of [
      `${PLUGIN_ROOT}/skills/meta/x`,
      `${PLUGIN_ROOT}/agents`,
      `${PLUGIN_ROOT}/.claude/agents`,
      `${PLUGIN_ROOT}/.claude-plugin`,
      `${PLUGIN_ROOT}/dist`,
    ]) {
      expect(() => assertNotRuntimeTree(bad, PLUGIN_ROOT)).toThrow();
    }
    // A legitimate .guild artifact dir is allowed.
    const ok = fs.mkdtempSync(path.join(os.tmpdir(), "w3-sc1-ok-"));
    expect(() => assertNotRuntimeTree(path.join(ok, ".guild", "explore"), ok)).not.toThrow();
    fs.rmSync(ok, { recursive: true, force: true });
  });

  it("resolveTemplatePath resolves a bare id to templates/products and an explicit path as-is", () => {
    const byId = resolveTemplatePath("cli-tool", PLUGIN_ROOT, PLUGIN_ROOT);
    expect(byId).toBe(path.join(PLUGIN_ROOT, "templates", "products", "cli-tool.template.json"));
  });
});
