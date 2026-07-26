/**
 * __tests__/neutral-conformance-core.test.ts
 *
 * MH-02 (multi-host-runtime-convergence, W1) — scenario definitions, support
 * claim semantics, and the core's own import-closure boundary verdict.
 *
 * Covers MH-02 acceptance 2 (core owns scenario definitions and typed
 * contracts/results) and acceptance 3 (core imports no host adapter, hook,
 * wrapper, launcher, PaneAdapter backend, benchmark, or website
 * implementation) — the latter proven by an import-closure scan over the
 * declared core file set.
 *
 * Repo-wide dependency-boundary enforcement (MHRC-MOD-001..004) is W4/MH-07.
 * What is proven here is narrower and self-contained: the MH-02 core is
 * import-closed, so no direct OR transitive edge can reach a forbidden
 * boundary. The scan therefore needs no dependency-graph tool of its own.
 *
 * The scan reads real repository bytes (that is the point), so this file uses
 * fs/path; the CORE itself is I/O-free and the evaluator it calls is a pure
 * function of {path, source} records.
 */

import * as fs from "fs";
import * as path from "path";

import {
  NEUTRAL_CORE_MEMBERS,
  NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS,
  NEUTRAL_PURE_INTRINSIC_ROOTS,
  analyzeNeutralCapabilityUse,
  evaluateNeutralCoreBoundary,
  extractNeutralImportSpecifiers,
  tokenizeNeutralSource,
} from "../../src/modules/lifecycle/workflows/neutral-core-boundary";

import {
  NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
  NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_CORE_WAVE_OWNER,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_RECEIPT_REF_SCHEMA,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_RECOGNIZED_PLATFORMS,
  NEUTRAL_RECOGNIZED_RUNTIME_MAJOR,
  NEUTRAL_REQUIRED_CORE_SCENARIO_IDS,
  NEUTRAL_SCENARIO_SUITE_ID,
  NEUTRAL_SCENARIO_SUITE_VERSION,
  NEUTRAL_SUPPORT_TRANSITIONS,
  NEUTRAL_UNEVALUATED_SUPPORT,
  applyNeutralSupportTransition,
  deriveNeutralSupportClaim,
  evaluateNeutralConformanceDecision,
  neutralEvidenceCommitment,
  neutralReceiptReference,
  validateNeutralScenarioRegistry,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralConformanceAuthority,
  NeutralConformanceEvidence,
  NeutralEvidenceFreshnessVerdict,
  NeutralEvidenceIdentity,
  NeutralScenarioResult,
  NeutralSupportRecord,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";

import { NEUTRAL_LIFECYCLE_PHASES } from "../../src/modules/lifecycle/workflows/neutral-runtime-contracts";

const CORE_DIR = path.resolve(__dirname, "..", "..", "src", "modules", "lifecycle", "workflows");

function readCoreFiles(): Array<{ path: string; source: string }> {
  return NEUTRAL_CORE_MEMBERS.map((member) => ({
    path: member,
    source: fs.readFileSync(path.join(CORE_DIR, member), "utf8"),
  }));
}

// ---------------------------------------------------------------------------
// Acceptance 3 — the declared core is import-closed
// ---------------------------------------------------------------------------

describe("MH-02 acceptance 3 — core import closure", () => {
  it("declares a non-empty core membership whose every file exists on disk", () => {
    expect(NEUTRAL_CORE_MEMBERS.length).toBeGreaterThan(0);
    for (const member of NEUTRAL_CORE_MEMBERS) {
      expect(fs.existsSync(path.join(CORE_DIR, member))).toBe(true);
    }
  });

  it("returns a succeeded boundary outcome for the real core sources", () => {
    const outcome = evaluateNeutralCoreBoundary(readCoreFiles());
    expect(outcome.type).toBe("guild.boundary_outcome.v1");
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.reason_code).toBeNull();
    expect(outcome.facts.forbidden_edges).toEqual([]);
    expect(outcome.facts.unclassified_edges).toEqual([]);
    expect(outcome.facts.node_count).toBe(NEUTRAL_CORE_MEMBERS.length);
    expect(typeof outcome.facts.edge_count).toBe("number");
  });

  it("proves the closure claim by rejecting each forbidden boundary class", () => {
    const forbidden: Array<[string, string]> = [
      ["host adapter", '../../host-runtime'],
      ["hook implementation", '../../../../hooks/lib/security/scrubbed-write'],
      ["wrapper / launcher", '../../dispatch/workflows/agent-team-launcher'],
      ["pane adapter backend", './pane-adapter-tmux'],
      ["benchmark internals", '../../evals/workflows/benchmark'],
      ["website internals", '../../../../website/lib/render'],
      ["generated mirror", '../resources/module-resources.json'],
      ["node io builtin", 'fs'],
    ];
    for (const [label, specifier] of forbidden) {
      const outcome = evaluateNeutralCoreBoundary([
        { path: NEUTRAL_CORE_MEMBERS[0], source: `import x from "${specifier}";` },
        ...readCoreFiles().slice(1),
      ]);
      expect([label, outcome.disposition]).toEqual([label, "failed"]);
      expect([label, outcome.reason_code]).toEqual([label, "boundary_forbidden_edge"]);
      expect(
        (outcome.facts.forbidden_edges as Array<{ specifier: string }>).some(
          (edge) => edge.specifier === specifier
        )
      ).toBe(true);
    }
  });

  it("fails an unclassified destination rather than passing it (MHRC-MOD-001 rule)", () => {
    const outcome = evaluateNeutralCoreBoundary([
      { path: NEUTRAL_CORE_MEMBERS[0], source: 'import z from "some-npm-package";' },
      ...readCoreFiles().slice(1),
    ]);
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("boundary_unclassified_edge");
  });

  it("permits intra-core relative edges only", () => {
    const outcome = evaluateNeutralCoreBoundary([
      {
        path: "neutral-lifecycle-machine.ts",
        source: 'import { neutralOutcome } from "./neutral-runtime-contracts";',
      },
      ...readCoreFiles().filter((f) => f.path !== "neutral-lifecycle-machine.ts"),
    ]);
    expect(outcome.disposition).toBe("succeeded");
  });

  it("fails when declared membership and supplied files disagree", () => {
    const missing = evaluateNeutralCoreBoundary(readCoreFiles().slice(1));
    expect(missing.disposition).toBe("failed");
    expect(missing.reason_code).toBe("boundary_membership_mismatch");

    const extra = evaluateNeutralCoreBoundary([
      ...readCoreFiles(),
      { path: "not-a-member.ts", source: "" },
    ]);
    expect(extra.disposition).toBe("failed");
    expect(extra.reason_code).toBe("boundary_membership_mismatch");
  });

  it("extracts static, type-only, re-export, dynamic, and require specifiers", () => {
    const specifiers = extractNeutralImportSpecifiers(
      [
        'import a from "./a";',
        'import type { B } from "./b";',
        'export * from "./c";',
        'export { d } from "./d";',
        'const e = await import("./e");',
        'const f = require("./f");',
      ].join("\n")
    );
    expect(specifiers.sort()).toEqual(["./a", "./b", "./c", "./d", "./e", "./f"]);
  });

  // -------------------------------------------------------------------------
  // MH-02-R1-B03 — the extractor is lexical, so indentation and comments cannot
  // hide an edge and commented-out code cannot invent one.
  // -------------------------------------------------------------------------

  describe("MH-02-R1-B03 adversarial import syntax", () => {
    /** Forms that MUST yield the specifier. Each was a bypass or is a near-miss. */
    it.each([
      ["leading-indented static", '  import * as fs from "fs";'],
      ["tab-indented static", '\timport * as fs from "fs";'],
      ["multiline static", 'import {\n  readFileSync,\n} from "fs";'],
      ["comment-separated dynamic", 'import /* core */ ("fs")'],
      ["newline-separated dynamic", 'import\n(\n"fs"\n)'],
      ["comment-separated require", 'require /* c */ ("fs")'],
      ["indented bare import", '    import "fs";'],
      ["type-only indented", '  import type { Stats } from "fs";'],
      ["re-export indented", '  export * from "fs";'],
      ["named re-export", '  export { readFileSync } from "fs";'],
      ["default+named", 'import fs, { readFileSync } from "fs";'],
      ["single quotes", "  import fs from 'fs';"],
      ["trailing line comment", 'import fs from "fs"; // the io builtin'],
      ["block comment before statement", '/* header */ import fs from "fs";'],
      ["require inside an expression", 'const x = { fs: require("fs") };'],
      ["dynamic import in a ternary", 'const p = cond ? import("fs") : null;'],
      ["node: prefixed", '  import * as fs from "node:fs";'],
    ])("extracts the specifier from a %s form", (_label, source) => {
      const specifiers = extractNeutralImportSpecifiers(source);
      expect(specifiers.some((s) => s === "fs" || s === "node:fs")).toBe(true);
    });

    /** Forms that MUST NOT yield a specifier: they are comments or strings. */
    it.each([
      ["commented-out require", '// require("fs")'],
      ["commented-out static import", '// import fs from "fs";'],
      ["block-commented import", '/* import fs from "fs"; */'],
      ["jsdoc mentioning an import", '/**\n * imports no host adapter\n * import fs from "fs"\n */'],
      ["import word inside a string", 'const s = "import fs from \\"fs\\"";'],
      ["require word inside a string", 'const s = "require(\\"fs\\")";'],
      ["from word inside a string", 'const s = "from \\"fs\\"";'],
      ["identifier merely prefixed with require", 'const requireish = requireX("fs");'],
      ["regex literal containing a require call", 'const re = /require\\("fs"\\)/;'],
      ["template literal containing an import", 'const t = `import fs from "fs"`;'],
    ])("ignores a %s", (_label, source) => {
      expect(extractNeutralImportSpecifiers(source)).toEqual([]);
    });

    it("does not misread division as a regex literal", () => {
      expect(extractNeutralImportSpecifiers('const r = 10 / 2; const s = a / b;')).toEqual([]);
    });

    it("still sees an edge hidden inside a template interpolation", () => {
      expect(extractNeutralImportSpecifiers('const t = `${require("fs")}`;')).toEqual(["fs"]);
    });

    it("gives a FORBIDDEN verdict for each previously-bypassing form", () => {
      for (const source of [
        '  import * as fs from "fs";',
        'import /* core */ ("fs")',
        'import {\n  readFileSync,\n} from "fs";',
      ]) {
        const files = NEUTRAL_CORE_MEMBERS.map((member, index) => ({
          path: member,
          source: index === 0 ? source : "",
        }));
        const verdict = evaluateNeutralCoreBoundary(files);
        expect(verdict.disposition).toBe("failed");
        expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      }
    });

    it("does NOT report a forbidden edge for a commented-out require", () => {
      const files = NEUTRAL_CORE_MEMBERS.map((member, index) => ({
        path: member,
        source: index === 0 ? '// require("fs")' : "",
      }));
      expect(evaluateNeutralCoreBoundary(files).disposition).toBe("succeeded");
    });
  });

  // -------------------------------------------------------------------------
  // MH-02-R2-B02 — closure FAILS CLOSED on what the scan cannot resolve
  //
  // The round-2 recognizer recorded a call's argument only when it was a string
  // token and silently dropped every other shape, so five valid-source probes
  // extracted zero specifiers and returned `succeeded`. Closure is a universal
  // claim: an edge whose destination the scanner cannot determine is not "no
  // edge", it is "closure unproven".
  // -------------------------------------------------------------------------

  describe("MH-02-R2-B02 unresolvable edges and lexer ambiguity fail closed", () => {
    function verdictFor(source: string) {
      return evaluateNeutralCoreBoundary(
        NEUTRAL_CORE_MEMBERS.map((member, index) => ({
          path: member,
          source: index === 0 ? source : "",
        }))
      );
    }

    /** The reviewer's four extraction probes, plus near neighbours. */
    it.each([
      ["computed require", 'const builtin = "fs"; require(builtin);'],
      ["computed dynamic import", 'const pkg = "fs"; import(pkg);'],
      ["multiline computed import", "import(\n  name\n);"],
      ["template-hole specifier", "require(`${mod}`);"],
      ["concatenated specifier", 'import("f" + "s");'],
      ["conditional specifier", 'import(cond ? "fs" : "path");'],
      ["zero-argument require", "require();"],
      ["empty-string specifier", 'require("");'],
      ["require aliased as a value", "const r = require; r(\"fs\");"],
      ["require invoked through call()", 'require.call(null, "fs");'],
      ["member-accessed require", 'const p = require.resolve("fs");'],
    ])("refuses a %s as an unresolved edge", (_label, source) => {
      const verdict = verdictFor(source);
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_unresolved_edge");
      expect((verdict.facts.unresolved_edges as unknown[]).length).toBeGreaterThan(0);
    });

    /** The reviewer's optional-call probe: previously invisible entirely. */
    it("recognises an optional require call and classifies its destination", () => {
      expect(extractNeutralImportSpecifiers('require?.("fs")')).toEqual(["fs"]);
      const verdict = verdictFor('require?.("fs")');
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      expect(
        (verdict.facts.forbidden_edges as Array<{ specifier: string; matcher_id: string }>)[0]
      ).toMatchObject({ specifier: "fs", matcher_id: "node_io_builtin" });
    });

    it("refuses an optional call with a COMPUTED specifier as unresolved", () => {
      const verdict = verdictFor("const m = \"fs\"; require?.(m);");
      expect(verdict.reason_code).toBe("boundary_unresolved_edge");
    });

    /**
     * The reviewer's lexer probe. `x++ / require("fs") / y` is valid code and
     * plain division; round 2 read the `/` as a regex start and swallowed the
     * whole call. The `/` is now division, so the call is visible again — AND
     * the undecidable position is recorded, because a parser-free lexer cannot
     * prove which reading was intended.
     */
    it.each([
      ["postfix increment", 'const v = x++ / require("fs") / y;'],
      ["postfix decrement", 'const v = x-- / require("fs") / y;'],
    ])("does not let a %s hide a require call", (_label, source) => {
      expect(extractNeutralImportSpecifiers(source)).toEqual(["fs"]);
      const verdict = verdictFor(source);
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_forbidden_edge");
      expect((verdict.facts.source_ambiguities as unknown[]).length).toBeGreaterThan(0);
    });

    it("reports an ambiguous slash that would have swallowed an import", () => {
      // After `)` the reading is genuinely undecidable. Both readings are kept
      // honest: division keeps the statement scannable, and the ambiguity is
      // recorded because the discarded reading spans a dependency word.
      const verdict = verdictFor('const v = f(a) / import("./x") / b;');
      expect(verdict.disposition).toBe("failed");
      expect(
        (verdict.facts.source_ambiguities as Array<{ kind: string }>).every(
          (entry) => entry.kind === "regex_or_division"
        )
      ).toBe(true);
    });

    it("stays SILENT on an ambiguous slash that could not have hidden an edge", () => {
      // Ordinary arithmetic after a call or a block is ambiguous too, but both
      // readings agree there is no edge, so failing there would be noise.
      //
      // Every name below is DECLARED. Under capability closure (MH-02-R3-B01) a
      // free identifier is itself a finding, so a fixture that leaned on
      // undeclared `f`/`a`/`w` would fail for that reason and prove nothing about
      // the slash.
      for (const source of [
        "function f(v: number): number { return v; } const a = 1; const r = f(a) / 2;",
        "function compute(): number { return 1; } function total(): number { return 2; } const q = compute() / total() / 3;",
        "function g() {} const w = 8; const z = w / 4;",
        "let counter = 4; const limit = 2; const n = counter++ / limit;",
      ]) {
        const verdict = verdictFor(source);
        expect([source, verdict.disposition]).toEqual([source, "succeeded"]);
        expect([source, verdict.facts.source_ambiguities]).toEqual([source, []]);
      }
    });

    it("keeps import.meta out of the edge set", () => {
      const verdict = verdictFor("const here = import.meta.url;");
      expect(verdict.disposition).toBe("succeeded");
      expect(verdict.facts.unresolved_edges).toEqual([]);
    });

    it("still resolves every ordinary form, so the tightening is not a blanket refusal", () => {
      const verdict = verdictFor(
        [
          'import a from "./neutral-runtime-contracts";',
          'export * from "./neutral-gate-policy";',
          'const c = await import("./neutral-conformance-core");',
          'const d = await import("./neutral-core-boundary");',
          "const e = await import(`./neutral-runtime-contracts`);",
        ].join("\n")
      );
      expect(verdict.disposition).toBe("succeeded");
      expect(verdict.reason_code).toBeNull();
      expect(verdict.facts.unresolved_edges).toEqual([]);
      expect(verdict.facts.source_ambiguities).toEqual([]);
    });

    /**
     * `require` is CommonJS ambient capability, and a capability that resolves to
     * a core member today resolves to `fs` tomorrow. The core reaches its
     * siblings through static ESM imports, so a bare `require` fails even when
     * its literal argument is intra-core (MH-02-R3-B01).
     */
    it("refuses an intra-core require, because require itself is the capability", () => {
      const verdict = verdictFor('const d2 = require("./neutral-core-boundary");');
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_ambient_capability");
      expect(verdict.facts.ambient_capabilities).toEqual([
        { importer: NEUTRAL_CORE_MEMBERS[0], name: "require", usage: "call" },
      ]);
    });

    it("counts unresolved edges in edge_count so the fact set stays honest", () => {
      const verdict = verdictFor('const m = "fs"; require(m);');
      expect(verdict.facts.edge_count).toBe(1);
      expect((verdict.facts.unresolved_edges as Array<{ form: string }>)[0].form).toBe("require()");
    });
  });

  // -------------------------------------------------------------------------
  // MH-02-R3-B01 — capability closure, because module edges were never the only
  // way out of the core
  //
  // Rounds 1-3 hardened the recognizer that finds `import`/`require` TOKENS.
  // Round 3 then defeated it four ways without writing either token, and each
  // one executes: the name can live in a STRING (`module["require"]("fs")`), be
  // produced by the evaluator (`eval("require")("fs")`,
  // `Function("return require")()("fs")`), or be spelled with a Unicode escape so
  // the token never lexes at all. A direct Node control confirms three of the
  // four hand back a callable `fs.readFileSync`, and the fourth hands back
  // `process.binding("fs")`.
  //
  // The fix is not four more literals. It is the invariant that subsumes them: a
  // core member may only CALL what it declares, imports from a core member, or
  // draws from a closed pure-intrinsic allowlist, and any callee the scan cannot
  // reduce to such a root fails closed.
  // -------------------------------------------------------------------------

  describe("MH-02-R3-B01 computed, evaluated, and escaped capability access fails closed", () => {
    /**
     * Inject one valid statement into ONE real member and re-run the FULL
     * five-member verdict. Full membership matters: a partial file set yields
     * `boundary_membership_mismatch`, which the round-3 code produces too, so a
     * membership artefact would make every probe below vacuous.
     */
    function verdictFor(snippet: string) {
      const files = readCoreFiles();
      files[0] = { path: files[0].path, source: `${files[0].source}\n${snippet}\n` };
      return evaluateNeutralCoreBoundary(files);
    }

    /** The reviewer's four round-3 probes, in the exact forms reported. */
    it.each([
      ["computed CommonJS access", 'const a = module["require"]("fs");', "boundary_indirect_callee"],
      ["evaluator-derived require", 'const b = eval("require")("fs");', "boundary_ambient_capability"],
      [
        "Function-derived require",
        'const c = Function("return require")()("fs");',
        "boundary_ambient_capability",
      ],
      ["identifier-escaped require", 'const d = requ\\u0069re("fs");', "boundary_forbidden_edge"],
    ])("refuses %s", (_label, snippet, reason) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "failed"]);
      expect([_label, verdict.reason_code]).toEqual([_label, reason]);
      expect(verdict.facts.may_promote_conformant).toBeUndefined();
    });

    /**
     * Neighbouring spellings of the SAME two mechanisms. None of them is
     * enumerated anywhere in the implementation: they fail because the allowlist
     * is closed, which is the difference between an invariant and a denylist.
     */
    it.each([
      ["globalThis computed access", 'const e = globalThis["require"]("fs");'],
      ["process.binding", 'const f = process.binding("fs");'],
      ["global.process.binding", 'const g = global.process.binding("fs");'],
      ["new Function evaluator", 'const h = new Function("return require")()("fs");'],
      ["indirect eval through a comma expression", 'const i2 = (0, eval)("require")("fs");'],
      [
        "prototype-chain evaluator",
        'const j = []["constructor"]["constructor"]("return require")()("fs");',
      ],
      ["evaluator aliased through a local", 'const k = eval; const k2 = k("require")("fs");'],
      ["escaped module identifier", 'const l = m\\u006Fdule["require"]("fs");'],
      ["escaped evaluator identifier", 'const m2 = ev\\u0061l("require")("fs");'],
      ["braced unicode escape", 'const n = requ\\u{69}re("fs");'],
      ["import.meta.require", 'const o = import.meta.require("fs");'],
      ["createRequire through a computed key", 'const p = module["createRequire"]("x")("fs");'],
      ["Reflect.get on the module record", 'const q = Reflect.get(module, "require")("fs");'],
      ["computed key on a local alias", 'const r = globalThis; const r2 = r["require"]("fs");'],
      ["clock read", "const s = Date.now();"],
      ["console io", 'const t = console.log("x");'],
      ["timer string evaluation", 'const u = setTimeout("x", 0);'],
      ["WebAssembly compilation", "const v = WebAssembly.compile(bytes);"],
      ["optional call on a computed member", 'const w2 = module["require"]?.("fs");'],
      ["Buffer allocation", "const x3 = Buffer.alloc(1);"],
    ])("refuses a %s that no denylist enumerates", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "failed"]);
      expect([_label, verdict.reason_code]).not.toEqual([_label, null]);
    });

    it("names the ambient binding it caught, so the failure is actionable", () => {
      const verdict = verdictFor('const y2 = eval("require")("fs");');
      expect(verdict.reason_code).toBe("boundary_ambient_capability");
      expect(verdict.facts.ambient_capabilities).toEqual([
        { importer: NEUTRAL_CORE_MEMBERS[0], name: "eval", usage: "call" },
      ]);
    });

    it("names the indirect call shape it caught", () => {
      const verdict = verdictFor('const z3 = module["require"]("fs");');
      expect(verdict.reason_code).toBe("boundary_indirect_callee");
      expect(
        (verdict.facts.indirect_callees as Array<{ importer: string; form: string }>)[0]
      ).toMatchObject({ importer: NEUTRAL_CORE_MEMBERS[0], form: "computed_member_call" });
    });

    /**
     * The escape DECODES — which is what makes the edge visible again — and the
     * obfuscation is ALSO recorded, so a core member cannot use an escaped
     * identifier even when it decodes to something innocuous.
     */
    it("decodes a Unicode identifier escape to the identifier it denotes", () => {
      expect(tokenizeNeutralSource('requ\\u0069re("fs")')[0]).toEqual({
        kind: "ident",
        value: "require",
      });
      expect(tokenizeNeutralSource('requ\\u{69}re("x")')[0].value).toBe("require");
      expect(extractNeutralImportSpecifiers('requ\\u0069re("fs")')).toEqual(["fs"]);
    });

    it("reports an escaped identifier even when it decodes to a harmless name", () => {
      const verdict = verdictFor("const har\\u006Dless = 1;");
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_ambiguous_source");
      expect(
        (verdict.facts.source_ambiguities as Array<{ kind: string }>).some(
          (entry) => entry.kind === "escaped_identifier"
        )
      ).toBe(true);
    });

    it("reports a backslash it cannot explain rather than dropping it", () => {
      const verdict = verdictFor("const bad = 1; \\ ");
      expect(verdict.disposition).toBe("failed");
      expect(
        (verdict.facts.source_ambiguities as Array<{ kind: string }>).some(
          (entry) => entry.kind === "undecodable_escape"
        )
      ).toBe(true);
    });

    /**
     * NON-VACUITY. Every refusal above is worthless if the sentinel refuses
     * everything, so the ordinary shapes the real core is written in must stay
     * clean — including the false-positive resistance rounds 1-2 established.
     */
    it.each([
      ["commented-out require", '// require("fs")'],
      ["block-commented import", '/* import fs from "fs"; */'],
      ["import word inside a template literal", 'const c3 = `import fs from "fs"`;'],
      ["require word inside a string", 'const c4 = "require(\\"fs\\")";'],
      ["regex literal containing a require call", 'const c5 = /require\\("fs"\\)/;'],
      ["plain division", "const c6 = 10 / 2; const c7 = c6 / 3;"],
      ["intra-core relative import", 'import { neutralFreeze as nf2 } from "./neutral-runtime-contracts";'],
      [
        "pure intrinsic calls",
        'const c8 = JSON.stringify(Object.keys({}).sort()); const c9 = new RegExp("^a$").test("a"); const c10 = Array.isArray([]) && Number.isFinite(1) && String(1).length > 0 && Math.max(1, 2) === 2 && new Set<string>().size === 0 && new Map<string, string>().size === 0;',
      ],
      ["local computed index access", "const c11 = [1, 2, 3]; const c12 = c11[c11.length - 1];"],
      [
        "chained method calls on an expression result",
        'const c13 = [1, 2].map((v) => v + 1).filter((v) => v > 1).join(",");',
      ],
      ["declared function called through a local", "function lf(v: number): number { return v + 1; } const c14 = lf(1);"],
      ["destructured local then used", "const pair = { a: 1, b: 2 }; const { a: c15, b: c16 } = pair; const c17 = c15 + c16;"],
      ["catch binding", "function cf(): string { try { return \"x\"; } catch (err) { return String(err); } }"],
      ["generic helper", "function gid<T>(v: T): T { return v; } const c18 = gid(1);"],
      ["thrown error with a template message", "function tf(v: string): never { throw new Error(`bad ${v}`); }"],
    ])("stays succeeded for %s", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "succeeded"]);
      expect([_label, verdict.reason_code]).toEqual([_label, null]);
    });

    it("finds zero ambient references and zero indirect callees in every real core member", () => {
      for (const file of readCoreFiles()) {
        const analysis = analyzeNeutralCapabilityUse(file.source);
        expect([file.path, analysis.ambient]).toEqual([file.path, []]);
        expect([file.path, analysis.indirect]).toEqual([file.path, []]);
      }
    });

    /**
     * The allowlist is the whole mechanism, so what it OMITS is load-bearing.
     * Every name below can reach I/O, a clock, or the evaluator, and none of them
     * may ever be added.
     */
    it("omits every capability root from the pure-intrinsic allowlist", () => {
      for (const capability of [
        "eval",
        "Function",
        "require",
        "process",
        "global",
        "globalThis",
        "console",
        "Date",
        "Reflect",
        "Proxy",
        "Buffer",
        "WebAssembly",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
        "fetch",
        "performance",
        "structuredClone",
      ]) {
        expect(NEUTRAL_PURE_INTRINSIC_ROOTS).not.toContain(capability);
      }
      // …and still contains the pure ones the core actually needs, or the real
      // core could not pass its own check.
      for (const pure of ["Object", "Array", "JSON", "RegExp", "Error", "Number", "String"]) {
        expect(NEUTRAL_PURE_INTRINSIC_ROOTS).toContain(pure);
      }
    });

    it("treats a bound parameter as bound while still refusing a computed callee on it", () => {
      // `m` IS a local binding, so the ambient rule correctly says nothing. The
      // indirect-callee rule is the backstop that still refuses the call.
      const verdict = verdictFor('const bf = (m: Record<string, (s: string) => unknown>) => m["require"]("fs");');
      expect(verdict.disposition).toBe("failed");
      expect(verdict.reason_code).toBe("boundary_indirect_callee");
    });
  });

  it("declares a forbidden matcher for every boundary class MH-02 acceptance 3 names", () => {
    const ids = NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS.map((matcher) => matcher.id);
    for (const required of [
      "host_adapter",
      "hook_implementation",
      "wrapper_or_launcher",
      "execution_transport",
      "benchmark_internals",
      "website_internals",
      "generated_mirror",
      "compatibility_shim",
      "node_io_builtin",
    ]) {
      expect(ids).toContain(required);
    }
  });
});

// ---------------------------------------------------------------------------
// MH-02-R2-B04 — the MH-02 surface is reproducible in plugin CI
//
// Round 2 pinned the contract assertions to an absolute umbrella worktree. The
// plugin test workflow checks out ONLY the plugin repository and then runs the
// whole `scripts` Jest project, so the suite that gated MH-02 could not execute
// on a clean clone or a runner — it passed solely because that private path
// happened to exist on the review machine.
//
// Removing the path once would be a fix that silently rots. This guard makes it
// an INVARIANT: the MH-02 surface may not name a machine-local root or any
// sibling repository, in tests or in source. Cross-repository equality is still
// required — it is verified at the umbrella/run level, where both repositories
// are present, and recorded in the MH-02 handoff receipt.
// ---------------------------------------------------------------------------

describe("MH-02-R2-B04 the MH-02 surface is hermetic to the plugin repository", () => {
  const TESTS_DIR = path.resolve(__dirname);
  const MH02_TEST_FILES = [
    "neutral-runtime-contracts.test.ts",
    "neutral-lifecycle-machine.test.ts",
    "neutral-conformance-core.test.ts",
  ];

  /**
   * Assembled from fragments on purpose. Writing any of these roots as one
   * contiguous literal — in the array, in a comment, anywhere in this file —
   * would be found by the very scan below, and the guard would trip on itself.
   * Interpolation keeps the matcher expressive without making the file a match.
   */
  const MACHINE_LOCAL_ROOTS = [
    `/${"Users"}/`,
    `/${"home"}/`,
    `/private/${"var"}/`,
    `.guild/${"worktrees"}`,
    `${"Projects"}/guild/`,
  ];
  const SIBLING_REPOSITORIES = [
    `worktrees/${"guild"}`,
    `codex-mh-02-${"contract"}`,
    `codex-review-mh-02-${"contract"}`,
    `codex-mh-w0-${"lead"}`,
  ];

  function surfaceSources(): Array<{ label: string; source: string }> {
    return [
      ...MH02_TEST_FILES.map((file) => ({
        label: `__tests__/${file}`,
        source: fs.readFileSync(path.join(TESTS_DIR, file), "utf8"),
      })),
      ...NEUTRAL_CORE_MEMBERS.map((member) => ({
        label: `workflows/${member}`,
        source: fs.readFileSync(path.join(CORE_DIR, member), "utf8"),
      })),
    ];
  }

  it("names no machine-local filesystem root anywhere in the MH-02 surface", () => {
    const offenders: string[] = [];
    for (const { label, source } of surfaceSources()) {
      for (const root of MACHINE_LOCAL_ROOTS) {
        if (source.indexOf(root) !== -1) offenders.push(`${label} -> ${root}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("names no sibling repository, so nothing can become a cross-repo import", () => {
    const offenders: string[] = [];
    for (const { label, source } of surfaceSources()) {
      for (const needle of SIBLING_REPOSITORIES) {
        if (source.indexOf(needle) !== -1) offenders.push(`${label} -> ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads only paths derived from this checkout", () => {
    // Both filesystem roots this suite uses resolve from __dirname, so the
    // suite relocates with the repository instead of pointing outside it.
    for (const root of [TESTS_DIR, CORE_DIR]) {
      expect(path.isAbsolute(root)).toBe(true);
      expect(root.startsWith(path.resolve(__dirname, "..", ".."))).toBe(true);
    }
  });

  it("proves the guard actually bites", () => {
    // A guard that cannot fail is not a guard. Same matcher, seeded input.
    const seeded = `const CONTRACT_DIR = "/${"Users"}/someone/.guild/${"worktrees"}/guild/x";`;
    const caught = MACHINE_LOCAL_ROOTS.filter((root) => seeded.indexOf(root) !== -1);
    expect(caught.length).toBeGreaterThan(0);
  });

  it("keeps the reconciled vocabulary declared natively rather than read as data", () => {
    const source = fs.readFileSync(
      path.join(CORE_DIR, "neutral-runtime-contracts.ts"),
      "utf8"
    );
    // The core declares the shared block itself and imports nothing to get it.
    expect(source).toContain("NEUTRAL_NORMALIZED_EVENT_VOCABULARY");
    expect(source).toContain("guild.normalized_event.v2");
    expect(extractNeutralImportSpecifiers(source)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The core carries no second phase vocabulary
// ---------------------------------------------------------------------------

describe("phase vocabulary drift guard", () => {
  it("matches the CANONICAL_PHASES literal already declared by run-lifecycle.ts", () => {
    // Read as TEXT, never imported: run-lifecycle.ts depends on hooks and
    // host-runtime, so importing it into the neutral core would break closure.
    const source = fs.readFileSync(path.join(CORE_DIR, "run-lifecycle.ts"), "utf8");
    const match = /export const CANONICAL_PHASES = \[([^\]]*)\]/.exec(source);
    expect(match).not.toBeNull();
    const declared = (match as RegExpExecArray)[1]
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter((part) => part.length > 0);
    expect(declared).toEqual([...NEUTRAL_LIFECYCLE_PHASES]);
  });
});

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

describe("neutral scenario definitions", () => {
  it("pins the suite identity it was authored against", () => {
    expect(NEUTRAL_SCENARIO_SUITE_ID).toBe("guild.conformance_scenarios.v1");
    expect(NEUTRAL_SCENARIO_SUITE_VERSION).toBe("1.0.0");
    expect(NEUTRAL_CORE_WAVE_OWNER).toEqual({
      wave_id: "W1",
      work_item_id: "MH-02",
      key: "W1/MH-02",
    });
  });

  it("defines exactly the five W1/MH-02-owned scenarios and claims no other owner's work", () => {
    expect(NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id)).toEqual([
      "MHRC-LIF-001",
      "MHRC-LIF-002",
      "MHRC-LIF-003",
      "MHRC-LIF-004",
      "MHRC-UNS-002",
    ]);
    for (const scenario of NEUTRAL_CORE_SCENARIOS) {
      expect(scenario.implementation_wave_owner).toEqual(NEUTRAL_CORE_WAVE_OWNER);
    }
  });

  it("omits every MH-06 receipt-integrity scenario", () => {
    const ids = NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id);
    for (const mh06 of [
      "MHRC-RCT-001",
      "MHRC-RCT-002",
      "MHRC-RCT-003",
      "MHRC-RCT-004",
      "MHRC-RCT-005",
    ]) {
      expect(ids).not.toContain(mh06);
    }
  });

  it("satisfies the frozen scenario_field_contract for every scenario", () => {
    const outcome = validateNeutralScenarioRegistry();
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.facts.scenario_count).toBe(5);
    expect(outcome.facts.unique_stable_ids).toBe(5);
  });

  it("rejects a duplicate stable id", () => {
    const outcome = validateNeutralScenarioRegistry([
      NEUTRAL_CORE_SCENARIOS[0],
      NEUTRAL_CORE_SCENARIOS[0],
    ]);
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("scenario_registry_invalid");
    expect(outcome.facts.errors).toContain("duplicate stable_id MHRC-LIF-001");
  });

  it("rejects an empty precondition list, an unknown category, and an unknown profile", () => {
    const base = NEUTRAL_CORE_SCENARIOS[0];
    for (const [patch, needle] of [
      [{ preconditions: [] }, "preconditions"],
      [{ category: "vibes" }, "category"],
      [{ evidence_requirements: [{ profile: "E-NOPE", assertions: ["x"] }] }, "profile"],
      [{ expected_typed_outcome: { ...base.expected_typed_outcome, disposition: "ok" } }, "disposition"],
    ] as Array<[Record<string, unknown>, string]>) {
      const outcome = validateNeutralScenarioRegistry([{ ...base, ...patch } as never]);
      expect(outcome.disposition).toBe("failed");
      expect((outcome.facts.errors as string[]).join(" ")).toContain(needle);
    }
  });

  it("references only declared evidence profiles with non-empty kinds and bindings", () => {
    for (const scenario of NEUTRAL_CORE_SCENARIOS) {
      expect(scenario.evidence_requirements.length).toBeGreaterThan(0);
      for (const requirement of scenario.evidence_requirements) {
        const profile = NEUTRAL_EVIDENCE_PROFILES[requirement.profile];
        expect(profile).toBeDefined();
        expect(profile.required_kinds.length).toBeGreaterThan(0);
        expect(profile.required_bindings.length).toBeGreaterThan(0);
        expect(requirement.assertions.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Support claim semantics — six orthogonal dimensions, never collapsed
// ---------------------------------------------------------------------------

describe("neutral support claim", () => {
  it("starts every dimension at not_evaluated", () => {
    expect(NEUTRAL_UNEVALUATED_SUPPORT).toEqual({
      recognized: "not_evaluated",
      rendered: "not_evaluated",
      installed: "not_evaluated",
      activated: "not_evaluated",
      updated: "not_evaluated",
      conformant: "not_evaluated",
    });
  });

  it("declares the five contract transition rules", () => {
    expect(NEUTRAL_SUPPORT_TRANSITIONS.map((t) => t.operation)).toEqual([
      "render",
      "install",
      "activate",
      "update",
      "verify",
    ]);
  });

  it("refuses a transition whose precondition is unproven", () => {
    const { record, outcome } = applyNeutralSupportTransition(
      NEUTRAL_UNEVALUATED_SUPPORT,
      "render",
      { satisfied: true }
    );
    expect(outcome.type).toBe("guild.support_transition_outcome.v1");
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("support_precondition_unproven");
    expect(record).toEqual(NEUTRAL_UNEVALUATED_SUPPORT);
  });

  it("promotes one dimension at a time and never implies the next", () => {
    let record: NeutralSupportRecord = {
      ...NEUTRAL_UNEVALUATED_SUPPORT,
      recognized: "satisfied",
    };
    for (const operation of ["render", "install", "activate"] as const) {
      const step = applyNeutralSupportTransition(record, operation, { satisfied: true });
      expect(step.outcome.disposition).toBe("succeeded");
      record = step.record;
    }
    expect(record.rendered).toBe("satisfied");
    expect(record.installed).toBe("satisfied");
    expect(record.activated).toBe("satisfied");
    // recognition/render/install/activate never imply conformance
    expect(record.conformant).toBe("not_evaluated");
    expect(record.updated).toBe("not_evaluated");
  });

  it("records a failed dimension without promoting it", () => {
    const record = { ...NEUTRAL_UNEVALUATED_SUPPORT, recognized: "satisfied" as const };
    const step = applyNeutralSupportTransition(record, "render", { satisfied: false });
    expect(step.outcome.disposition).toBe("failed");
    expect(step.outcome.reason_code).toBe("support_operation_failed");
    expect(step.record.rendered).toBe("failed");
  });

  it("resets activated and conformant when an update lands", () => {
    const record = {
      recognized: "satisfied" as const,
      rendered: "satisfied" as const,
      installed: "satisfied" as const,
      activated: "satisfied" as const,
      updated: "not_evaluated" as const,
      conformant: "satisfied" as const,
    };
    const step = applyNeutralSupportTransition(record, "update", { satisfied: true });
    expect(step.outcome.disposition).toBe("succeeded");
    expect(step.record.updated).toBe("satisfied");
    expect(step.record.activated).toBe("not_evaluated");
    expect(step.record.conformant).toBe("not_evaluated");
  });

  it("never collapses the six dimensions into one supported value", () => {
    const claim = deriveNeutralSupportClaim({
      recognized: "satisfied",
      rendered: "satisfied",
      installed: "failed",
      activated: "not_evaluated",
      updated: "not_evaluated",
      conformant: "unsupported",
    });
    expect(Object.keys(claim.states).sort()).toEqual([
      "activated",
      "conformant",
      "installed",
      "recognized",
      "rendered",
      "updated",
    ]);
    expect(claim.proven).toEqual(["recognized", "rendered"]);
    expect(claim.unproven).toEqual(["installed", "activated", "updated", "conformant"]);
    expect((claim as unknown as Record<string, unknown>).supported).toBeUndefined();
    expect(claim.collapsed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Conformance decision
// ---------------------------------------------------------------------------

describe("neutral conformance decision", () => {
  const required = NEUTRAL_CORE_SCENARIOS.map((s) => s.stable_id);

  /**
   * The COMPLETE identity the frozen `support_claim` rule requires: exact source,
   * package, runtime, adapter, host, platform, contract, and scenario-suite.
   *
   * MH-02-R3-B02: round 3's five-label record could not express most of this, so a
   * bundle naming no source, package, adapter, or platform at all was still
   * "complete" and still promoted `conformant=true`.
   */
  const BASE_IDENTITY: NeutralEvidenceIdentity = {
    source_commit: "b871c8d973bd8258c25ce5e87a89f68f2e63a516",
    package_hash: `sha256:${"0123456789abcdef".repeat(4)}`,
    runtime_version: "guild-2.2.0",
    adapter_version: "guild.host_adapter.v1.0.0",
    host_id: "claude-code-cli",
    host_version: "2.2.0",
    platform: "darwin-arm64",
    contract_version: 1,
    scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
    scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
    release_id: "rel-2026-07-26-a",
  };

  /**
   * The AUTHORITATIVE input — what the verifier itself observed. It is
   * deliberately assembled here rather than exported as a canned constant by the
   * core: a shipped ready-made authority would itself be a promotion path.
   */
  function authorityFor(
    identity: NeutralEvidenceIdentity = BASE_IDENTITY,
    patch: Partial<NeutralConformanceAuthority> = {}
  ): NeutralConformanceAuthority {
    return {
      schema_version: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
      identity,
      receipt_journal_id: "jrn-run-1",
      receipt_sequence_range: { first: 1, last: 5 },
      ...patch,
    };
  }

  const AUTHORITY = authorityFor();

  /** Sentinel: leave it in place and the helper commits the reference honestly. */
  const RECOMPUTE = "<recompute>";

  function expectedReason(stableId: string, disposition: string): string | null {
    if (disposition === "succeeded") return null;
    return stableId === "MHRC-UNS-002" ? "policy_denied" : "gate_unsatisfied";
  }

  /**
   * Build the ordered results for one authority.
   *
   * `perResult` is applied BEFORE the receipt reference is committed, so patching
   * a disposition, an outcome type, or a reason code produces an HONESTLY
   * committed receipt for that patched outcome — which is what a real failing run
   * looks like, and what keeps the semantic gates (wrong type, wrong disposition)
   * reachable instead of every patch collapsing into a binding failure. A test
   * that attacks the reference itself sets `receipt_ref` explicitly.
   */
  function resultsFor(
    authority: NeutralConformanceAuthority,
    perResult: (result: NeutralScenarioResult, index: number) => NeutralScenarioResult = (r) => r
  ): NeutralScenarioResult[] {
    return NEUTRAL_CORE_SCENARIOS.map((scenario, index) => {
      const sequence = authority.receipt_sequence_range.first + index;
      const disposition = scenario.expected_typed_outcome.disposition;
      const patched = perResult(
        {
          stable_id: scenario.stable_id,
          outcome_type: scenario.expected_typed_outcome.type,
          disposition,
          reason_code: expectedReason(scenario.stable_id, disposition),
          receipt_ref: RECOMPUTE,
          evidence_identity: authority.identity,
          evidence_freshness: "fresh",
        },
        index
      );
      if (patched.receipt_ref !== RECOMPUTE) return patched;
      return {
        ...patched,
        receipt_ref: neutralReceiptReference(authority, {
          stable_id: patched.stable_id,
          outcome_type: patched.outcome_type,
          disposition: patched.disposition,
          reason_code: patched.reason_code,
          sequence,
        }),
      };
    });
  }

  function evidenceFor(
    authority: NeutralConformanceAuthority,
    patch: Partial<NeutralConformanceEvidence> = {},
    perResult: (result: NeutralScenarioResult, index: number) => NeutralScenarioResult = (r) => r
  ): NeutralConformanceEvidence {
    return {
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      required_scenario_ids: [...required],
      activated_runtime: authority.identity,
      results: resultsFor(authority, perResult),
      ...patch,
    };
  }

  /** A complete, ordered, source-bound, receipt-committed, fresh package. */
  function evidence(
    patch: Partial<NeutralConformanceEvidence> = {},
    perResult: (result: NeutralScenarioResult, index: number) => NeutralScenarioResult = (r) => r
  ): NeutralConformanceEvidence {
    return evidenceFor(AUTHORITY, patch, perResult);
  }

  function decide(
    pkg: NeutralConformanceEvidence,
    authority: NeutralConformanceAuthority = AUTHORITY
  ) {
    return evaluateNeutralConformanceDecision(pkg, authority);
  }

  it("promotes only when every required scenario matched its expected disposition", () => {
    const outcome = decide(evidence());
    expect(outcome.type).toBe("guild.support_transition_outcome.v1");
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.facts.may_promote_conformant).toBe(true);
    expect(outcome.facts.activated_runtime).toEqual(BASE_IDENTITY);
    expect(outcome.facts.authority_identity).toEqual(BASE_IDENTITY);
  });

  it("counts an expected refusal as a pass (explicit refusal satisfies the scenario)", () => {
    const pkg = evidence();
    expect(pkg.results.find((r) => r.stable_id === "MHRC-LIF-002")?.disposition).toBe("refused");
    expect(decide(pkg).disposition).toBe("succeeded");
  });

  it("fails promotion when a required scenario produced the wrong disposition", () => {
    // An HONESTLY receipted failure: the receipt records `failed`, and promotion
    // is still refused. Nothing here is forged, so the refusal is about the
    // scenario outcome rather than about evidence integrity.
    const outcome = decide(
      evidence({}, (r) =>
        r.stable_id === "MHRC-LIF-001"
          ? { ...r, disposition: "failed", reason_code: "gate_unsatisfied" }
          : r
      )
    );
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("scenario_result_mismatch");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("is deterministic across repeated evaluation", () => {
    const a = decide(evidence());
    const b = decide(evidence());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  // -------------------------------------------------------------------------
  // MH-02-R1-B04 — promotion cannot be obtained without release-bound evidence
  // -------------------------------------------------------------------------

  /** The reviewer's exact probe #1: zero scenarios. */
  it("refuses an entirely empty evidence package", () => {
    const outcome = decide({} as unknown as NeutralConformanceEvidence);
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_suite_version_mismatch");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("refuses an empty required scenario set even with the right suite tuple", () => {
    const outcome = decide(evidence({ required_scenario_ids: [], results: [] }));
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
  });

  it("refuses a caller-narrowed required set that omits a core scenario", () => {
    const narrowed = required.slice(0, 2);
    const outcome = decide(
      evidence({ required_scenario_ids: narrowed, results: evidence().results.slice(0, 2) })
    );
    expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
    expect(outcome.facts.omitted_required_scenarios).toEqual(required.slice(2));
  });

  /** The reviewer's exact probe #2: five bare disposition strings. */
  it("refuses bare disposition-only records that carry no typed outcome", () => {
    const bare = {
      suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      required_scenario_ids: [...required],
      activated_runtime: BASE_IDENTITY,
      results: NEUTRAL_CORE_SCENARIOS.map((s) => ({
        stable_id: s.stable_id,
        disposition: s.expected_typed_outcome.disposition,
      })),
    } as unknown as NeutralConformanceEvidence;
    const outcome = decide(bare);
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_incomplete");
    expect(outcome.facts.may_promote_conformant).toBe(false);
  });

  it("refuses a suite id or version that is not the pinned tuple", () => {
    expect(decide(evidence({ suite_version: "9.9.9" })).reason_code).toBe(
      "scenario_suite_version_mismatch"
    );
    expect(decide(evidence({ suite_id: "other.suite" })).reason_code).toBe(
      "scenario_suite_version_mismatch"
    );
  });

  it("refuses results that are not ordered against the required set", () => {
    const pkg = evidence();
    const shuffled = [pkg.results[1], pkg.results[0], ...pkg.results.slice(2)];
    const outcome = decide(evidence({ results: shuffled }));
    expect(outcome.reason_code).toBe("scenario_results_unordered");
  });

  it("refuses a result with no receipt reference", () => {
    const outcome = decide(
      evidence({}, (r) => (r.stable_id === "MHRC-LIF-003" ? { ...r, receipt_ref: "" } : r))
    );
    expect(outcome.reason_code).toBe("scenario_receipt_reference_missing");
    // The offending value is reported verbatim, so a reader can see WHAT was
    // cited rather than only that something was wrong.
    expect(outcome.facts.results_without_receipt_reference).toEqual([
      { stable_id: "MHRC-LIF-003", receipt_ref: "" },
    ]);
  });

  it("refuses a succeeded result that carries a reason code, and a refusal that omits one", () => {
    expect(
      decide(
        evidence({}, (r) =>
          r.disposition === "succeeded" ? { ...r, reason_code: "gate_unsatisfied" } : r
        )
      ).reason_code
    ).toBe("scenario_evidence_incomplete");
    expect(
      decide(evidence({}, (r) => (r.disposition === "refused" ? { ...r, reason_code: null } : r)))
        .reason_code
    ).toBe("scenario_evidence_incomplete");
  });

  /**
   * Every axis of the frozen identity tuple is compared, using values that are
   * individually RECOGNIZED and merely different. That separates "the core does
   * not know this label" from "this evidence came from somewhere else" — the
   * second is what cross-release reuse actually looks like.
   */
  it.each([
    ["source_commit", "e9dd73fcffea95ab33277a60d113262aac3379f2"],
    ["package_hash", `sha256:${"fedcba9876543210".repeat(4)}`],
    ["runtime_version", "guild-2.9.9"],
    ["adapter_version", "guild.host_adapter.v1.0.1"],
    ["host_id", "codex-cli"],
    ["host_version", "9.9.9"],
    ["platform", "linux-x64"],
    ["release_id", "rel-2026-07-26-b"],
  ])("refuses evidence produced under a different %s than the authority observed", (field, value) => {
    const outcome = decide(
      evidence({}, (r) =>
        r.stable_id === "MHRC-LIF-001"
          ? { ...r, evidence_identity: { ...BASE_IDENTITY, [field]: value } }
          : r
      )
    );
    expect([field, outcome.reason_code]).toEqual([field, "scenario_identity_binding_mismatch"]);
    expect(outcome.facts.misbound_results).toEqual([
      { stable_id: "MHRC-LIF-001", differing_identity_fields: [field] },
    ]);
  });

  it("refuses an incomplete activated-runtime identity", () => {
    const outcome = decide(evidence({ activated_runtime: { ...BASE_IDENTITY, release_id: "" } }));
    expect(outcome.reason_code).toBe("scenario_runtime_binding_mismatch");
    expect(outcome.facts.incomplete_identities).toEqual(["activated_runtime"]);
  });

  it.each(["stale", "unknown"])("refuses %s evidence freshness", (verdict) => {
    const outcome = decide(
      evidence({}, (r) =>
        r.stable_id === "MHRC-UNS-002"
          ? { ...r, evidence_freshness: verdict as NeutralEvidenceFreshnessVerdict }
          : r
      )
    );
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_stale");
    expect(outcome.facts.non_fresh_results).toEqual([
      { stable_id: "MHRC-UNS-002", evidence_freshness: verdict },
    ]);
  });

  it("refuses when a required scenario has no result at all", () => {
    const outcome = decide(evidence({ results: evidence().results.slice(0, 4) }));
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_evidence_incomplete");
  });

  it("declares the required set itself rather than accepting the caller's", () => {
    expect(NEUTRAL_REQUIRED_CORE_SCENARIO_IDS).toEqual(required);
    expect(NEUTRAL_REQUIRED_CORE_SCENARIO_IDS).toHaveLength(5);
  });

  // -------------------------------------------------------------------------
  // MH-02-R2-B03 — the suite is not the claimant's to choose, and nominal
  // metadata is not evidence
  //
  // Round 2 still took a caller-supplied `scenarios` array (defaulted to the
  // core's, so it read as harmless) and derived the required set FROM IT. A
  // caller passing one scenario got a one-scenario suite and promoted
  // `conformant`. Six further probes promoted on forged nominal metadata.
  // -------------------------------------------------------------------------

  describe("MH-02-R2-B03 promotion is neither caller-selectable nor nominally forgeable", () => {
    /** The reviewer's exact probe: a suite of one, chosen by the claimant. */
    it("refuses a caller-selected one-scenario suite", () => {
      const only = NEUTRAL_CORE_SCENARIOS[0];
      const outcome = decide({
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        required_scenario_ids: [only.stable_id],
        activated_runtime: BASE_IDENTITY,
        results: [evidence().results[0]],
      });
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.may_promote_conformant).toBe(false);
      expect(outcome.facts.omitted_required_scenarios).toEqual(required.slice(1));
    });

    /**
     * The structural half of the same finding. The second parameter is NOT a
     * scenario set and cannot be pressed into service as one: it is the
     * authority, and anything that is not a well-formed authority is refused
     * outright rather than narrowing the suite.
     */
    it("has no scenario-set parameter, and its second parameter refuses a smuggled suite", () => {
      expect(evaluateNeutralConformanceDecision).toHaveLength(2);
      const smuggled = evaluateNeutralConformanceDecision(
        evidence(),
        [NEUTRAL_CORE_SCENARIOS[0]] as unknown as NeutralConformanceAuthority
      );
      expect(smuggled.disposition).toBe("refused");
      expect(smuggled.reason_code).toBe("scenario_evidence_authority_missing");
      expect(smuggled.facts.may_promote_conformant).toBe(false);
      // A third argument has nowhere to go and cannot change the verdict.
      const extra = (
        evaluateNeutralConformanceDecision as unknown as (
          e: NeutralConformanceEvidence,
          a: NeutralConformanceAuthority,
          s?: unknown
        ) => ReturnType<typeof evaluateNeutralConformanceDecision>
      )(evidence(), AUTHORITY, [NEUTRAL_CORE_SCENARIOS[0]]);
      expect(extra.disposition).toBe("succeeded");
      expect(extra.facts.may_promote_conformant).toBe(true);
    });

    it("refuses a required tuple that is the right SET in the wrong ORDER", () => {
      const reversedIds = [...required].reverse();
      const reversedResults = [...evidence().results].reverse();
      const outcome = decide(
        evidence({ required_scenario_ids: reversedIds, results: reversedResults })
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.tuple_misordered).toBe(true);
    });

    it("refuses a caller-INFLATED required tuple that still contains the core set", () => {
      const outcome = decide(
        evidence({
          required_scenario_ids: [...required, "MHRC-RCT-001"],
          results: [...evidence().results, { ...evidence().results[0], stable_id: "MHRC-RCT-001" }],
        })
      );
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
      expect(outcome.facts.undeclared_scenarios).toEqual(["MHRC-RCT-001"]);
    });

    /** A closed-but-wrong outcome type is evidence of a different experiment. */
    it("fails a result whose outcome TYPE is not the scenario's expected type", () => {
      const outcome = decide(
        evidence({}, (r) => ({ ...r, outcome_type: "guild.migration_outcome.v1" }))
      );
      expect(outcome.disposition).toBe("failed");
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(outcome.facts.may_promote_conformant).toBe(false);
      expect(outcome.facts.mistyped_scenarios).toHaveLength(5);
      expect((outcome.facts.mistyped_scenarios as Array<Record<string, unknown>>)[0]).toEqual({
        stable_id: "MHRC-LIF-001",
        expected_outcome_type: "guild.lifecycle_outcome.v1",
        observed_outcome_type: "guild.migration_outcome.v1",
      });
    });

    it("keeps MHRC-UNS-002's policy outcome type distinct from the lifecycle ones", () => {
      const outcome = decide(
        evidence({}, (r) =>
          r.stable_id === "MHRC-UNS-002" ? { ...r, outcome_type: "guild.lifecycle_outcome.v1" } : r
        )
      );
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(outcome.facts.mistyped_scenarios).toHaveLength(1);
    });

    it("refuses an invented reason code on a non-succeeded result", () => {
      const outcome = decide(
        evidence({}, (r) => (r.disposition === "succeeded" ? r : { ...r, reason_code: "invented_reason" }))
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_reason_code_unrecognized");
      expect(outcome.facts.unrecognized_reason_codes).toEqual([
        { stable_id: "MHRC-LIF-002", reason_code: "invented_reason" },
        { stable_id: "MHRC-UNS-002", reason_code: "invented_reason" },
      ]);
    });

    it.each([
      ["a word", "bogus"],
      ["a bare id", "receipt-1"],
      ["the schema alone", NEUTRAL_RECEIPT_REF_SCHEMA],
      ["a missing sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1`],
      ["a non-numeric sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#later`],
      ["a non-canonical sequence", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#007`],
      ["a foreign schema", "other.receipt_ref.v1:jrn-run-1#1@nec1:0123456789abcdef"],
      // The exact round-3 forgery shape: canonical, distinct, and committed to
      // nothing at all.
      ["an uncommitted canonical reference", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#1`],
      ["a malformed commitment", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#1@nec1:zzzz`],
      ["a foreign commitment scheme", `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#1@sha256:00`],
    ])("refuses %s as a receipt reference", (_label, ref) => {
      const outcome = decide(evidence({}, (r) => ({ ...r, receipt_ref: ref })));
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([_label, "scenario_receipt_reference_missing"]);
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it("refuses one receipt entry cited by two scenarios", () => {
      const shared = evidence().results[0].receipt_ref;
      const outcome = decide(evidence({}, (r) => ({ ...r, receipt_ref: shared })));
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_receipt_reference_ambiguous");
      expect(outcome.facts.duplicate_receipt_references).toHaveLength(4);
    });

    it.each([
      ["an unrecognized major", 999],
      ["a zero", 0],
      ["a string", "1" as unknown as number],
    ])("refuses %s as the contract version", (_label, version) => {
      // Patched on the CLAIM with an honest authority, so the bundle-scope gate
      // is what bites; the authority-scope gate is exercised separately below.
      const outcome = decide(
        evidence({ activated_runtime: { ...BASE_IDENTITY, contract_version: version as number } })
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_contract_version_unrecognized");
      expect(outcome.facts.recognized_contract_version).toBe(1);
    });

    it("refuses an AUTHORITY whose own contract version the core does not implement", () => {
      const authority = authorityFor({ ...BASE_IDENTITY, contract_version: 999 });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.reason_code).toBe("scenario_contract_version_unrecognized");
      expect(outcome.facts.scope).toBe("authority");
    });

    it("refuses a contract version that drifts on ONE result only", () => {
      const outcome = decide(
        evidence({}, (r) =>
          r.stable_id === "MHRC-LIF-004"
            ? { ...r, evidence_identity: { ...BASE_IDENTITY, contract_version: 2 } }
            : r
        )
      );
      expect(outcome.reason_code).toBe("scenario_contract_version_unrecognized");
      expect(outcome.facts.unrecognized_contract_versions).toEqual([
        { scope: "MHRC-LIF-004", contract_version: 2 },
      ]);
    });

    it.each([
      ["free text", "totally-unknown-runtime"],
      ["a bare semver", "2.2.0"],
      ["a foreign product", "codex-2.2.0"],
      ["an empty string", ""],
      // MH-02-R3-B02's exact probe: syntactically a runtime identity, from a major
      // this core knows nothing about. Shape is not recognition.
      ["a parseable version from an unknown major", "guild-999.999.999"],
    ])("refuses %s as a runtime version", (_label, version) => {
      const outcome = decide(
        evidence({ activated_runtime: { ...BASE_IDENTITY, runtime_version: version } })
      );
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([
        _label,
        "scenario_runtime_version_unrecognized",
      ]);
      expect(outcome.facts.recognized_runtime_major).toBe(NEUTRAL_RECOGNIZED_RUNTIME_MAJOR);
    });

    it("refuses an AUTHORITY that itself names an unrecognized runtime major", () => {
      const authority = authorityFor({ ...BASE_IDENTITY, runtime_version: "guild-999.999.999" });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.reason_code).toBe("scenario_runtime_version_unrecognized");
      expect(outcome.facts.scope).toBe("authority");
    });

    it("accepts a recognized runtime identity with a pre-release tail", () => {
      const authority = authorityFor({ ...BASE_IDENTITY, runtime_version: "guild-2.3.0-beta.1" });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.facts.may_promote_conformant).toBe(true);
    });

    /**
     * The whole point of the tightening is that HONEST evidence still promotes.
     * If every package refused, the gate would prove nothing either.
     */
    it("still promotes a complete, ordered, receipt-bound, exactly-versioned package", () => {
      const outcome = decide(evidence());
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.reason_code).toBeNull();
      expect(outcome.facts.may_promote_conformant).toBe(true);
      expect(outcome.facts.evaluated_scenarios).toHaveLength(5);
    });
  });

  // -------------------------------------------------------------------------
  // MH-02-R3-B02 — promotion is bound to an AUTHORITY and to source identity,
  // not to labels the claimant typed
  //
  // Round 3's decision read exactly ONE argument: the claimant's own bundle. A
  // complete five-scenario package with the exact ordered tuple, expected closed
  // outcome types and reason codes, distinct canonical-LOOKING receipt refs,
  // contract version 1, and `fresh` verdicts promoted `conformant=true` on a
  // binding that was entirely invented — host `invented-host`, host version
  // `not-a-version`, runtime `guild-999.999.999`, release `invented-release` —
  // and that named no source, package, adapter, or platform at all.
  //
  // Two things changed. The bundle is now compared against an AUTHORITATIVE input
  // the claimant does not author, and every identity the frozen `support_claim`
  // rule names must be present and RECOGNIZED rather than merely parseable. Every
  // receipt reference is committed to that authority.
  // -------------------------------------------------------------------------

  describe("MH-02-R3-B02 promotion requires source-bound, authority-verified evidence", () => {
    /** The reviewer's forged binding, field for field. */
    const FORGED_LABELS = {
      host_id: "invented-host",
      host_version: "not-a-version",
      runtime_version: "guild-999.999.999",
      release_id: "invented-release",
      contract_version: 1,
    };

    /** The reviewer's exact round-3 package: self-consistent, source-less, forged. */
    function forgedPackage(): NeutralConformanceEvidence {
      return {
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        required_scenario_ids: [...required],
        activated_runtime: FORGED_LABELS as unknown as NeutralEvidenceIdentity,
        results: NEUTRAL_CORE_SCENARIOS.map((scenario, index) => ({
          stable_id: scenario.stable_id,
          outcome_type: scenario.expected_typed_outcome.type,
          disposition: scenario.expected_typed_outcome.disposition,
          reason_code: expectedReason(
            scenario.stable_id,
            scenario.expected_typed_outcome.disposition
          ),
          receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:forged-journal#${index + 1}`,
          evidence_identity: FORGED_LABELS as unknown as NeutralEvidenceIdentity,
          evidence_freshness: "fresh" as NeutralEvidenceFreshnessVerdict,
        })),
      };
    }

    it("refuses the reviewer's complete forged bundle against an honest authority", () => {
      const outcome = decide(forgedPackage());
      expect(outcome.disposition).toBe("refused");
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it("refuses the forged bundle even when the AUTHORITY is forged to agree with it", () => {
      // Self-consistency across two invented inputs is still self-consistency.
      const outcome = evaluateNeutralConformanceDecision(forgedPackage(), {
        schema_version: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
        identity: FORGED_LABELS as unknown as NeutralEvidenceIdentity,
        receipt_journal_id: "forged-journal",
        receipt_sequence_range: { first: 1, last: 5 },
      });
      expect(outcome.disposition).toBe("refused");
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it.each([
      ["no authority at all", undefined],
      ["a null authority", null],
      ["an authority with no schema version", { identity: BASE_IDENTITY }],
      [
        "an authority with a foreign schema version",
        { ...AUTHORITY, schema_version: "guild.conformance_authority.v2" },
      ],
      ["an authority with an incomplete identity", { ...AUTHORITY, identity: { host_id: "claude-code-cli" } }],
      ["an authority with no journal", { ...AUTHORITY, receipt_journal_id: "" }],
      ["an authority with an inverted range", { ...AUTHORITY, receipt_sequence_range: { first: 9, last: 1 } }],
      ["an authority with a non-integer range", { ...AUTHORITY, receipt_sequence_range: { first: 1.5, last: 5 } }],
    ])("refuses %s", (_label, authority) => {
      const outcome = evaluateNeutralConformanceDecision(
        evidence(),
        authority as unknown as NeutralConformanceAuthority
      );
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([
        _label,
        "scenario_evidence_authority_missing",
      ]);
    });

    /**
     * Each forged label ISOLATED, with everything else honest and every receipt
     * honestly committed. Without this, the shape gate would fire first and the
     * recognition gates would never be proven to bite at all.
     */
    it.each([
      ["an unrecognized host id", "host_id", "invented-host", "scenario_host_identity_unrecognized"],
      ["a non-version host version", "host_version", "not-a-version", "scenario_host_identity_unrecognized"],
      [
        "an unrecognized runtime major",
        "runtime_version",
        "guild-999.999.999",
        "scenario_runtime_version_unrecognized",
      ],
      ["an invented release id", "release_id", "invented-release", "scenario_source_identity_unrecognized"],
      ["a source label that is not a revision", "source_commit", "invented-source", "scenario_source_identity_unrecognized"],
      ["a package label that is not a digest", "package_hash", "invented-package", "scenario_source_identity_unrecognized"],
      ["an unrecognized adapter version", "adapter_version", "1.0.0", "scenario_source_identity_unrecognized"],
      ["an unrecognized platform", "platform", "invented-platform", "scenario_source_identity_unrecognized"],
      ["a drifted suite id", "scenario_suite_id", "other.suite.v1", "scenario_source_identity_unrecognized"],
      ["a drifted suite version", "scenario_suite_version", "9.9.9", "scenario_source_identity_unrecognized"],
    ])("refuses %s even with everything else honest", (_label, field, value, reason) => {
      const identity = { ...BASE_IDENTITY, [field]: value } as NeutralEvidenceIdentity;
      const authority = authorityFor(identity);
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([_label, reason]);
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    /**
     * EVERY field of the frozen identity tuple is load-bearing: omit any one and
     * the bundle cannot promote. `runtime_version` is caught one gate earlier by
     * the recognition check (an absent version is not a recognized one), which is
     * a stricter answer to the same question, not a looser one.
     */
    it.each(NEUTRAL_EVIDENCE_IDENTITY_FIELDS.filter((f) => f !== "contract_version"))(
      "refuses a bundle that omits the required identity field %s",
      (field) => {
        const identity = { ...BASE_IDENTITY } as Record<string, unknown>;
        delete identity[field];
        const outcome = decide(
          evidence({ activated_runtime: identity as unknown as NeutralEvidenceIdentity })
        );
        expect([field, outcome.disposition]).toEqual([field, "refused"]);
        expect([field, outcome.facts.may_promote_conformant]).toEqual([field, false]);
        const expected =
          field === "runtime_version"
            ? "scenario_runtime_version_unrecognized"
            : "scenario_runtime_binding_mismatch";
        expect([field, outcome.reason_code]).toEqual([field, expected]);
        if (expected === "scenario_runtime_binding_mismatch") {
          expect(outcome.facts.required_identity_fields).toEqual([
            ...NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
          ]);
          expect(outcome.facts.incomplete_identities).toEqual(["activated_runtime"]);
        }
      }
    );

    it("refuses a claimed identity that disagrees with the authority's", () => {
      // Everything recognized, everything internally consistent — and produced
      // under a different source revision than the verifier observed.
      const claimed = {
        ...BASE_IDENTITY,
        source_commit: "e9dd73fcffea95ab33277a60d113262aac3379f2",
      };
      const outcome = decide(evidence({ activated_runtime: claimed }));
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_identity_binding_mismatch");
      expect(outcome.facts.differing_identity_fields).toEqual(["source_commit"]);
    });

    // ---- the receipt commitment ------------------------------------------

    it("binds a receipt reference to the authority's identity, journal, sequence, and outcome", () => {
      const input = {
        stable_id: "MHRC-LIF-001",
        outcome_type: "guild.lifecycle_outcome.v1" as const,
        disposition: "succeeded" as const,
        reason_code: null,
        sequence: 1,
      };
      const commitment = neutralEvidenceCommitment(AUTHORITY, input);
      expect(commitment).toMatch(/^nec1:[0-9a-f]{16}$/);
      expect(neutralReceiptReference(AUTHORITY, input)).toBe(
        `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#1@${commitment}`
      );
      // Deterministic: the same inputs always commit to the same digest.
      expect(neutralEvidenceCommitment(AUTHORITY, input)).toBe(commitment);
      // …and every axis of the binding changes it.
      for (const other of [
        neutralEvidenceCommitment(authorityFor({ ...BASE_IDENTITY, source_commit: "e9dd73fcffea95ab33277a60d113262aac3379f2" }), input),
        neutralEvidenceCommitment(authorityFor(BASE_IDENTITY, { receipt_journal_id: "jrn-run-2" }), input),
        neutralEvidenceCommitment(AUTHORITY, { ...input, sequence: 2 }),
        neutralEvidenceCommitment(AUTHORITY, { ...input, stable_id: "MHRC-LIF-003" }),
        neutralEvidenceCommitment(AUTHORITY, { ...input, disposition: "refused", reason_code: "gate_unsatisfied" }),
        neutralEvidenceCommitment(AUTHORITY, { ...input, outcome_type: "guild.policy_outcome.v1" }),
      ]) {
        expect(other).not.toBe(commitment);
      }
    });

    it.each([
      [
        "a reference into a journal the verifier never observed",
        (r: NeutralScenarioResult, i: number) => ({
          ...r,
          receipt_ref: neutralReceiptReference(
            authorityFor(BASE_IDENTITY, { receipt_journal_id: "other-journal" }),
            {
              stable_id: r.stable_id,
              outcome_type: r.outcome_type,
              disposition: r.disposition,
              reason_code: r.reason_code,
              sequence: i + 1,
            }
          ),
        }),
        "foreign_journal",
      ],
      [
        "a sequence outside the observed range",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-001"
            ? {
                ...r,
                receipt_ref: neutralReceiptReference(AUTHORITY, {
                  stable_id: r.stable_id,
                  outcome_type: r.outcome_type,
                  disposition: r.disposition,
                  reason_code: r.reason_code,
                  sequence: 99,
                }),
              }
            : r,
        "sequence_outside_observed_range",
      ],
      [
        "a commitment transplanted from another scenario",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-003"
            ? {
                ...r,
                receipt_ref: neutralReceiptReference(AUTHORITY, {
                  stable_id: "MHRC-LIF-004",
                  outcome_type: r.outcome_type,
                  disposition: r.disposition,
                  reason_code: r.reason_code,
                  sequence: i + 1,
                }),
              }
            : r,
        "commitment_mismatch",
      ],
      [
        "a commitment computed for a different verdict",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-001"
            ? {
                ...r,
                receipt_ref: neutralReceiptReference(AUTHORITY, {
                  stable_id: r.stable_id,
                  outcome_type: r.outcome_type,
                  disposition: "refused",
                  reason_code: "gate_unsatisfied",
                  sequence: i + 1,
                }),
              }
            : r,
        "commitment_mismatch",
      ],
    ])("refuses %s", (_label, patch, reason) => {
      const outcome = decide(evidence({}, patch as never));
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([
        _label,
        "scenario_receipt_binding_unverified",
      ]);
      expect(
        (outcome.facts.unbound_receipt_references as Array<{ reason: string }>).some(
          (entry) => entry.reason === reason
        )
      ).toBe(true);
    });

    it("refuses receipts whose sequences do not increase with the required tuple", () => {
      // The journal is an ordered spine: a receipt cannot precede the result it
      // records, so scenario N may not cite an earlier entry than scenario N-1.
      const authority = authorityFor(BASE_IDENTITY);
      const descending = resultsFor(authority, (r, i) => ({
        ...r,
        receipt_ref: neutralReceiptReference(authority, {
          stable_id: r.stable_id,
          outcome_type: r.outcome_type,
          disposition: r.disposition,
          reason_code: r.reason_code,
          sequence: 5 - i,
        }),
      }));
      const outcome = decide(evidence({ results: descending }));
      expect(outcome.reason_code).toBe("scenario_receipt_binding_unverified");
      expect(
        (outcome.facts.unbound_receipt_references as Array<{ reason: string }>).some(
          (entry) => entry.reason === "sequence_not_increasing"
        )
      ).toBe(true);
    });

    // ---- the recognized vocabularies are closed --------------------------

    it("pins the vocabularies recognition depends on", () => {
      expect(NEUTRAL_RECOGNIZED_RUNTIME_MAJOR).toBe(2);
      expect(NEUTRAL_RECOGNIZED_HOST_IDS).toContain("claude-code-cli");
      expect(NEUTRAL_RECOGNIZED_HOST_IDS).not.toContain("invented-host");
      expect(NEUTRAL_RECOGNIZED_PLATFORMS).toContain("darwin-arm64");
      expect(NEUTRAL_RECOGNIZED_PLATFORMS).not.toContain("invented-platform");
      expect(NEUTRAL_EVIDENCE_IDENTITY_FIELDS).toEqual([
        "source_commit",
        "package_hash",
        "runtime_version",
        "adapter_version",
        "host_id",
        "host_version",
        "platform",
        "contract_version",
        "scenario_suite_id",
        "scenario_suite_version",
        "release_id",
      ]);
    });

    /**
     * The frozen contract names eight identities in its `support_claim` rule. Each
     * one has to be REACHABLE by the identity tuple, or the rule is unenforceable
     * no matter how many gates run.
     */
    it("carries every identity the frozen support_claim rule names", () => {
      const fields = NEUTRAL_EVIDENCE_IDENTITY_FIELDS.join(" ");
      for (const named of [
        "source", // source_commit
        "package", // package_hash
        "runtime", // runtime_version
        "adapter", // adapter_version
        "host", // host_id + host_version
        "platform", // platform
        "contract", // contract_version
        "scenario_suite", // scenario_suite_id + scenario_suite_version
      ]) {
        expect(fields).toContain(named);
      }
    });

    /** NON-VACUITY for this whole block. */
    it("still promotes an honest, fully source-bound, authority-verified package", () => {
      const outcome = decide(evidence());
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.reason_code).toBeNull();
      expect(outcome.facts.may_promote_conformant).toBe(true);
      expect(outcome.facts.authority_journal_id).toBe("jrn-run-1");
    });
  });
});
