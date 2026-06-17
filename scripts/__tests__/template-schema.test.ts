/**
 * scripts/__tests__/template-schema.test.ts
 *
 * P2-Wave-3 SC-W3-1 — guild.template.v1 schema + fail-closed validator + PURE instantiator.
 * Canonical contract: scripts/lib/template-schema.ts (header); .guild/spec/universal-host-p2-wave3.md SC-W3-1.
 *
 * Coverage:
 *  - The schema constant + a valid example pass validateTemplateV1.
 *  - The validator catches every violation class (bad schema_version, empty id, empty
 *    required arrays, missing/bad artifact_skeletons, unknown keys, exotic input).
 *  - instantiateTemplate seeds a guild.explore.v1 / guild.define.v1 pair that passes the
 *    reused W1 validators; an invalid template fails closed (throws, emits nothing).
 *  - Every shipped template under templates/products/ loads, validates, and instantiates
 *    to W1-valid artifacts.
 *  - **AC37 NO-SELF-EDIT NEGATIVE TEST** — instantiation NEVER writes/edits a runtime
 *    permission, skill, or agent file. Proven anti-vacuously with write-deny instrumentation
 *    (every fs mutator throws if called) AND a known-positive control (the deny harness
 *    really trips on a real write).
 */

import * as fs from "fs";
import * as path from "path";
import {
  TEMPLATE_SCHEMA_VERSION,
  TEMPLATE_V1_EXAMPLE,
  validateTemplateV1,
  isTemplateV1,
  instantiateTemplate,
  runSelfCheck,
} from "../lib/template-schema";
import { EXPLORE_SCHEMA_VERSION, validateExploreV1 } from "../lib/explore-schema";
import { DEFINE_SCHEMA_VERSION, validateDefineV1 } from "../lib/define-schema";

describe("guild.template.v1 — constant + valid example", () => {
  it("exposes the frozen schema constant", () => {
    expect(TEMPLATE_SCHEMA_VERSION).toBe("guild.template.v1");
  });

  it("accepts the canonical example", () => {
    const r = validateTemplateV1(TEMPLATE_V1_EXAMPLE);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(isTemplateV1(TEMPLATE_V1_EXAMPLE)).toBe(true);
  });

  it("runSelfCheck passes (valid + instantiates-valid + fail-closed + no-throw)", () => {
    const { pass, details } = runSelfCheck();
    expect(pass).toBe(true);
    expect(details).toContain("valid-sample=true");
    expect(details).toContain("instantiates-valid=true");
  });
});

describe("guild.template.v1 — fail-closed validator", () => {
  it("rejects a non-object", () => {
    expect(validateTemplateV1(null).valid).toBe(false);
    expect(validateTemplateV1([]).valid).toBe(false);
    expect(validateTemplateV1("nope").valid).toBe(false);
  });

  it("rejects a wrong schema_version", () => {
    const r = validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, schema_version: "guild.template.v2" });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects an empty id", () => {
    const r = validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, id: "  " });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('"id"'))).toBe(true);
  });

  it.each([
    "specialists",
    "context_questions",
    "default_checks",
    "docs_expectations",
    "release_gates",
  ])("rejects an empty %s array", (field) => {
    const r = validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, [field]: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes(field))).toBe(true);
  });

  it.each([
    "specialists",
    "context_questions",
    "default_checks",
    "docs_expectations",
    "release_gates",
  ])("rejects a missing %s field", (field) => {
    const { [field as keyof typeof TEMPLATE_V1_EXAMPLE]: _drop, ...rest } = TEMPLATE_V1_EXAMPLE;
    expect(validateTemplateV1(rest).valid).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    const r = validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, surprise: true });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("unknown key"))).toBe(true);
  });

  it("rejects a missing artifact_skeletons", () => {
    const { artifact_skeletons: _drop, ...rest } = TEMPLATE_V1_EXAMPLE;
    expect(validateTemplateV1(rest).valid).toBe(false);
  });

  it("rejects an explore skeleton that would not instantiate to a valid explore artifact", () => {
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

  it("rejects a define skeleton with duplicate AC ids (reused W1 validator)", () => {
    const broken = {
      ...TEMPLATE_V1_EXAMPLE,
      artifact_skeletons: {
        ...TEMPLATE_V1_EXAMPLE.artifact_skeletons,
        define: {
          ...TEMPLATE_V1_EXAMPLE.artifact_skeletons.define,
          acceptance_criteria: [
            { id: "AC-1", text: "first" },
            { id: "AC-1", text: "dup" },
          ],
        },
      },
    };
    const r = validateTemplateV1(broken);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes("artifact_skeletons.define"))).toBe(true);
  });

  it("rejects an explore skeleton carrying a stray schema_version (strict seed keys)", () => {
    const broken = {
      ...TEMPLATE_V1_EXAMPLE,
      artifact_skeletons: {
        ...TEMPLATE_V1_EXAMPLE.artifact_skeletons,
        explore: { ...TEMPLATE_V1_EXAMPLE.artifact_skeletons.explore, schema_version: EXPLORE_SCHEMA_VERSION },
      },
    };
    expect(validateTemplateV1(broken).valid).toBe(false);
  });

  it("never throws on exotic input", () => {
    expect(() => validateTemplateV1({ ...TEMPLATE_V1_EXAMPLE, schema_version: 1 as unknown })).not.toThrow();
    const circular: Record<string, unknown> = { ...TEMPLATE_V1_EXAMPLE };
    circular.self = circular;
    expect(() => validateTemplateV1(circular)).not.toThrow();
    expect(validateTemplateV1(circular).valid).toBe(false);
  });

  it("fails closed (no throw) on hostile objects: throwing getter, throwing toString, Proxy ownKeys trap", () => {
    const g: Record<string, unknown> = {};
    Object.defineProperty(g, "id", { get() { throw new Error("boom-getter"); }, enumerable: true });
    const toStr: unknown = { schema_version: "x", id: { toString() { throw new Error("boom-toString"); } } };
    const proxy: unknown = new Proxy({}, { ownKeys() { throw new Error("boom-ownKeys"); }, get() { return undefined; } });
    for (const hostile of [g, toStr, proxy]) {
      expect(() => validateTemplateV1(hostile)).not.toThrow();
      expect(validateTemplateV1(hostile).valid).toBe(false);
    }
  });
});

describe("guild.template.v1 — instantiator seeds valid W1 artifacts", () => {
  it("instantiates an explore + define pair passing the reused W1 validators", () => {
    const { explore, define } = instantiateTemplate(TEMPLATE_V1_EXAMPLE);
    expect(explore.schema_version).toBe(EXPLORE_SCHEMA_VERSION);
    expect(define.schema_version).toBe(DEFINE_SCHEMA_VERSION);
    expect(validateExploreV1(explore).valid).toBe(true);
    expect(validateDefineV1(define).valid).toBe(true);
  });

  it("returns deep copies (mutating the output never mutates the template)", () => {
    const before = JSON.stringify(TEMPLATE_V1_EXAMPLE);
    const { explore, define } = instantiateTemplate(TEMPLATE_V1_EXAMPLE);
    explore.assumptions.push("mutation");
    define.acceptance_criteria.push({ id: "AC-X", text: "mutation" });
    expect(JSON.stringify(TEMPLATE_V1_EXAMPLE)).toBe(before);
  });

  it("fails closed on an invalid template — throws, emits nothing", () => {
    expect(() => instantiateTemplate({ schema_version: "guild.template.v1" })).toThrow(
      /cannot instantiate invalid/
    );
  });
});

describe("templates/products/ tree — every shipped template is valid + instantiable", () => {
  const dir = path.resolve(__dirname, "..", "..", "templates", "products");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".template.json"));

  it("ships at least one product template", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s loads, validates, and instantiates to W1-valid artifacts", (file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const r = validateTemplateV1(raw);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    const { explore, define } = instantiateTemplate(raw);
    expect(validateExploreV1(explore).valid).toBe(true);
    expect(validateDefineV1(define).valid).toBe(true);
  });
});

/**
 * AC37 NO-SELF-EDIT — the property SC-W3-1 names explicitly:
 * "instantiation NEVER writes/edits a runtime permission, skill, or agent file."
 *
 * Proven by deny-instrumenting EVERY fs mutator so any write trips the harness, running a
 * full instantiation (example + every shipped template + the fail-closed path), and
 * asserting ZERO writes. The harness is proven non-vacuous by a known-positive control:
 * an actual write under the same instrumentation MUST trip it.
 */
describe("AC37 no-self-edit — instantiation performs ZERO file writes", () => {
  const MUTATORS = [
    "writeFile",
    "writeFileSync",
    "appendFile",
    "appendFileSync",
    "rename",
    "renameSync",
    "rm",
    "rmSync",
    "unlink",
    "unlinkSync",
    "mkdir",
    "mkdirSync",
    "open",
    "openSync",
    "createWriteStream",
    "truncate",
    "truncateSync",
  ] as const;

  function withWriteDeny<T>(body: () => T): { result: T; writes: string[] } {
    const writes: string[] = [];
    const spies = MUTATORS.map((name) => {
      const orig = (fs as unknown as Record<string, unknown>)[name];
      if (typeof orig !== "function") return null;
      const spy = jest.spyOn(fs as unknown as Record<string, (...a: unknown[]) => unknown>, name as never)
        .mockImplementation(((...args: unknown[]) => {
          writes.push(`${name}(${String(args[0])})`);
          throw new Error(`DENY: fs.${name} called during instantiation`);
        }) as never);
      return spy;
    });
    try {
      const result = body();
      return { result, writes };
    } finally {
      spies.forEach((s) => s?.mockRestore());
    }
  }

  it("control: the deny harness actually trips on a real write (anti-vacuous)", () => {
    const { writes } = withWriteDeny(() => {
      try {
        fs.writeFileSync("/tmp/should-never-happen-ac37", "x");
      } catch {
        /* expected — the deny harness threw */
      }
      return null;
    });
    expect(writes.length).toBeGreaterThan(0);
  });

  it("instantiating the example writes NOTHING", () => {
    const { result, writes } = withWriteDeny(() => instantiateTemplate(TEMPLATE_V1_EXAMPLE));
    expect(writes).toEqual([]);
    expect(validateExploreV1(result.explore).valid).toBe(true);
    expect(validateDefineV1(result.define).valid).toBe(true);
  });

  it("instantiating every shipped template writes NOTHING", () => {
    const dir = path.resolve(__dirname, "..", "..", "templates", "products");
    // Read the files OUTSIDE the deny window (reads are allowed; only writes are denied).
    const raws = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".template.json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

    const { writes } = withWriteDeny(() => raws.map((raw) => instantiateTemplate(raw)));
    expect(writes).toEqual([]);
  });

  it("the fail-closed path (invalid template) also writes NOTHING", () => {
    const { writes } = withWriteDeny(() => {
      try {
        instantiateTemplate({ schema_version: "guild.template.v1" });
      } catch {
        /* expected fail-closed throw — must still produce no writes */
      }
      return null;
    });
    expect(writes).toEqual([]);
  });
});
