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
  NEUTRAL_ATTESTATION_CHAIN_LENGTH,
  NEUTRAL_ATTESTATION_CHAINS,
  NEUTRAL_ATTESTATION_CHECKSUM_CHAINS,
  NEUTRAL_ATTESTATION_MESSAGE_CHAINS,
  NEUTRAL_ATTESTATION_REF_SCHEMA,
  NEUTRAL_ATTESTATION_SCHEME,
  NEUTRAL_ATTESTATION_TREE_HEIGHT,
  NEUTRAL_ATTESTOR_TRUST_ROOT,
  NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
  NEUTRAL_CORE_SCENARIOS,
  NEUTRAL_CORE_WAVE_OWNER,
  NEUTRAL_EVIDENCE_IDENTITY_FIELDS,
  NEUTRAL_EVIDENCE_PROFILES,
  NEUTRAL_MINIMUM_ATTESTOR_QUORUM,
  NEUTRAL_RECEIPT_REF_SCHEMA,
  NEUTRAL_RECOGNIZED_ADAPTER_MAJOR,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS,
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
  neutralAttestationDigest,
  neutralAttestationReference,
  neutralAttestationVerifies,
  neutralAttestorVerificationKey,
  neutralJournalEntryCommitment,
  neutralJournalGenesis,
  neutralReceiptReference,
  neutralVerifyAttestationSignature,
  validateNeutralScenarioRegistry,
} from "../../src/modules/lifecycle/workflows/neutral-conformance-core";
import type {
  NeutralConformanceAuthority,
  NeutralConformanceEvidence,
  NeutralEvidenceFreshnessVerdict,
  NeutralEvidenceIdentity,
  NeutralJournalAttestation,
  NeutralReceiptJournalEntry,
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

    /**
     * The reviewer's four round-3 probes, in the exact forms reported.
     *
     * MH-02-R4-B01 moved the first one's reason code, and the move IS the fix:
     * round 4 exempted `module` as a TypeScript declaration keyword and caught
     * the probe only by its call shape, which is exactly why binding the same
     * computed value to a local first slipped through. `module` is now an
     * ordinary identifier, so the failure names the ambient binding — strictly
     * more actionable, and it fires whether or not the value is called here.
     */
    it.each([
      ["computed CommonJS access", 'const a = module["require"]("fs");', "boundary_ambient_capability"],
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
      // A call-result callee with NO ambient name and NO computed access, so the
      // indirect-callee rule is the only one that can fire. `module["require"](…)`
      // no longer reaches here: it is caught earlier and more precisely, as an
      // ambient reference to `module` (MH-02-R4-B01).
      const verdict = verdictFor('function h1() { return () => 1; }\nconst z3 = h1()();');
      expect(verdict.reason_code).toBe("boundary_indirect_callee");
      expect(
        (verdict.facts.indirect_callees as Array<{ importer: string; form: string }>)[0]
      ).toMatchObject({ importer: NEUTRAL_CORE_MEMBERS[0], form: "call_result_call" });
    });

    it("names the computed-member reach it caught, base included", () => {
      const verdict = verdictFor('const z4: any = ([] as any)["constructor"];');
      expect(verdict.reason_code).toBe("boundary_capability_reach");
      expect(
        (verdict.facts.capability_reaches as Array<{ importer: string; form: string }>)[0]
      ).toMatchObject({ importer: NEUTRAL_CORE_MEMBERS[0], form: "computed_member_reach" });
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

  // -------------------------------------------------------------------------
  // MH-02-R4-B01 — capability PROVENANCE, not call SHAPE
  //
  // Round 4 rejected a computed callee only when `]` was IMMEDIATELY followed by
  // the call parenthesis. Two reviewer probes walked straight through that, and
  // both execute: a direct Node control returns a callable `fs.readFileSync` for
  //
  //   const load = module["require"].bind(module); const io = load("fs");
  //   const C = ([] as any)["constructor"]["constructor"]; C("return process")()…
  //
  // Neither is an indirect callee. `module` was exempted as a TypeScript keyword,
  // and every call has a plain bound-identifier callee. Round 4 reported the core
  // import- AND capability-closed for both, with ZERO findings.
  //
  // Reproduced on a pristine base tree, 20 of 40 probes returned `succeeded` with
  // zero findings — the two above, twelve further alias spellings, and SIX
  // prototype-chain classes round 4 does not model at all (`({}).constructor
  // .constructor` IS the Function evaluator and needs no computed access and no
  // ambient name). The fix follows the VALUE, not the syntax.
  // -------------------------------------------------------------------------

  describe("MH-02-R4-B01 aliased and prototype-chain capability access fails closed", () => {
    function verdictFor(snippet: string) {
      const files = readCoreFiles();
      files[0] = { path: files[0].path, source: `${files[0].source}\n${snippet}\n` };
      return evaluateNeutralCoreBoundary(files);
    }

    /** The reviewer's two round-4 bypasses, in the exact forms reported. */
    it.each([
      [
        "a bound computed CommonJS loader alias",
        'const load = (module as any)["require"].bind(module); const io = load("fs"); const pa = io.readFileSync;',
      ],
      [
        "an aliased Array-constructor evaluator reaching getBuiltinModule",
        'const C: any = ([] as any)["constructor"]["constructor"]; const getP = C("return process"); const p2 = getP(); const io2 = p2.getBuiltinModule("fs"); const pb = io2.readFileSync;',
      ],
    ])("refuses %s", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "failed"]);
      expect([_label, verdict.reason_code]).not.toEqual([_label, null]);
      expect(verdict.facts.may_promote_conformant).toBeUndefined();
    });

    /**
     * Every alias spelling that leaked on the base. None is enumerated in the
     * implementation: they fail because provenance is followed to a fixpoint,
     * which is the difference between an invariant and a longer denylist.
     */
    it.each([
      ["plain assignment then call", 'let ld: any; ld = (module as any)["require"]; const i3 = ld("fs"); const q1 = i3.readFileSync;'],
      ["a computed key held in a local string", 'const key = "require"; const ld2 = (module as any)[key]; const q2 = ld2("fs");'],
      ["an array-literal prototype chain aliased in two steps", 'const pr: any = ([] as any)["constructor"]; const F2: any = pr["constructor"]; const ev = F2("return globalThis"); const q3 = ev();'],
      ["an alias declared then re-exported", 'const esc: any = (module as any)["require"]; const q4 = esc;'],
      ["an alias through an array element", 'const box: any[] = [(module as any)["require"]]; const ld3 = box[0]; const q5 = ld3("fs");'],
      ["an alias through an object-literal property", 'const bag: any = { ld: (module as any)["require"] }; const q6 = bag.ld("fs");'],
      ["an alias returned from a local function", 'function grab(): any { return (module as any)["require"]; } const ld4 = grab(); const q7 = ld4("fs");'],
      ["a comma-sequence alias", 'const ld5: any = (0, (module as any)["require"]); const q8 = ld5("fs");'],
      ["a default-parameter alias", 'function useL(ld6: any = (module as any)["require"]): any { return ld6("fs"); } const q9 = useL();'],
      ["a ternary alias", 'const ld7: any = true ? (module as any)["require"] : null; const qa = ld7("fs");'],
      ["an alias through logical-or", 'const ld8: any = (module as any)["require"] || null; const qb = ld8("fs");'],
      ["a two-hop bind then apply", 'const raw: any = (module as any)["require"]; const b2 = raw.bind(module); const b3 = b2; const qc = b3.apply(null, ["fs"]);'],
      ["destructuring the loader off the module record", 'const { require: rq } = module as any; const i4 = rq("fs"); const qd = i4.readFileSync;'],
      ["a five-hop alias chain", 'const a1: any = ({} as any).constructor; const b1 = a1; const c1 = b1; const d1 = c1; const e1 = d1; const qe = e1("x");'],
    ])("refuses %s", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "failed"]);
      expect([_label, verdict.reason_code]).not.toEqual([_label, null]);
    });

    /**
     * The prototype chain, with NO computed access and NO ambient identifier.
     * Every one of these is proven to hand back live Node I/O by a direct Node
     * control, and every one returned `succeeded` on the base.
     */
    it.each([
      ["({}).constructor.constructor", 'const FB: any = ({} as any).constructor.constructor; const gb = FB("return globalThis.process"); const pb2 = gb(); const iob = pb2.getBuiltinModule("fs"); const r1 = iob.readFileSync;'],
      ["Object.getPrototypeOf to the AsyncFunction constructor", 'const s1: any = Object.getPrototypeOf(Object.getPrototypeOf(async function () {})); const FC: any = s1.constructor; const gc = FC("return process"); const pc = gc(); const r2 = pc.getBuiltinModule("fs");'],
      ["[].constructor.constructor", 'const FD: any = ([] as any).constructor.constructor; const gd = FD("return process"); const pd = gd(); const r3 = pd.getBuiltinModule("fs");'],
      ["an intrinsic .prototype walk", 'const s2: any = (Array as any).prototype; const s3: any = s2.constructor; const FE: any = s3.constructor; const ge = FE("return process"); const r4 = ge();'],
      ["a __proto__ walk", 'const s4: any = ({} as any).__proto__; const s5: any = s4.constructor; const FF: any = s5.constructor; const gf = FF("return process"); const r5 = gf();'],
      ["Object.getOwnPropertyDescriptor on a function prototype", 'const s6: any = Object.getPrototypeOf(function () {}); const d2: any = Object.getOwnPropertyDescriptor(s6, "constructor"); const FG: any = d2.value; const r6 = FG("return process");'],
      ["new Error().constructor.constructor", 'const FH: any = (new Error("x") as any).constructor.constructor; const r7 = FH("return process");'],
    ])("refuses %s", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "failed"]);
      expect([_label, verdict.reason_code]).not.toEqual([_label, null]);
    });

    /**
     * THE FLOW IS LOAD-BEARING, not decorative.
     *
     * `t` is a locally declared binding, so under round 4's rules `t[k]` hangs
     * off a clean base and says nothing. It is a reach here ONLY because the
     * fixpoint marked `t` capability-derived first. Remove the provenance
     * analysis and this case goes quiet.
     */
    it("makes a computed access on a DERIVED local a reach, which it is not on a clean local", () => {
      const derived = analyzeNeutralCapabilityUse(
        'const seed: any = ([] as any).constructor; const t = seed; const k = "constructor"; const z = t[k];'
      );
      expect(derived.reaches.map((r) => r.form)).toEqual([
        "prototype_chain_reach",
        "computed_member_reach",
      ]);
      expect(derived.aliases).toEqual([
        expect.objectContaining({ name: "t", usage: "computed_member" }),
      ]);

      // The SAME shape on a clean local is silent — the base is what differs.
      const clean = analyzeNeutralCapabilityUse(
        'const seed2 = { constructorish: 1 }; const t2 = seed2; const k2 = "constructorish"; const z2 = t2[k2];'
      );
      expect(clean.reaches).toEqual([]);
      expect(clean.aliases).toEqual([]);
    });

    /** Provenance reaches every hop, so the chain is attributable end to end. */
    it("follows the reviewer's alias chain through every hop", () => {
      const analysis = analyzeNeutralCapabilityUse(
        'const C: any = ([] as any)["constructor"]["constructor"]; const getP = C("return process"); const p3 = getP(); const io3 = p3.getBuiltinModule("fs"); const x = io3.readFileSync;'
      );
      expect(analysis.aliases.map((a) => a.name)).toEqual(["C", "getP", "p3", "io3"]);
      expect(analysis.reaches.length).toBeGreaterThan(0);
    });

    /**
     * `module`, `this`, and `super` are no longer exempted as language words —
     * that exemption is what let the base of `module["require"]` go unexamined —
     * while the narrow TypeScript declaration head still is.
     */
    it("treats module as a value reference but not as a declaration head", () => {
      expect(
        analyzeNeutralCapabilityUse('const mv: any = (module as any).exports;').ambient
      ).toEqual([{ name: "module", usage: "reference" }]);
      expect(analyzeNeutralCapabilityUse('declare module "side-effect";').ambient).toEqual([]);
    });

    /** NON-VACUITY: the analyzer is not refuse-everything. */
    it.each([
      ["numeric index access on a local array", 'const xs = [1, 2, 3]; let acc = 0; for (let i = 0; i < xs.length; i += 1) acc += xs[i]; const c1 = xs[xs.length - 1] + acc;'],
      ["a record indexed by a local string key", 'const rec: Record<string, number> = { a: 1 }; const k3 = "a"; const c2 = rec[k3] ?? 0;'],
      ["a cast-through-parens computed access on a parameter", 'function pick(o: unknown, f: string): unknown { return (o as unknown as Record<string, unknown>)[f]; } const c3 = pick({}, "a");'],
      ["chained methods on expression results", 'const c4 = [3, 1, 2].map((v) => v + 1).filter((v) => v > 2).join(",");'],
      ["a Map keyed by a local string", 'const mm = new Map<string, number>(); const k4 = "a"; mm.set(k4, 1); const c5 = mm.get(k4) ?? 0;'],
      ["a declared function called through a local", 'function twice(v: number): number { return v * 2; } const fn = twice; const c6 = fn(21);'],
      ["pure intrinsics only", 'const c7 = JSON.stringify(Object.keys({ a: 1 }).map((k5) => String(k5).length + Math.min(1, 2)));'],
      ["a commented-out require", '// require("fs")'],
      ["a require word inside a string", 'const c8 = "require(\'fs\')";'],
    ])("still accepts %s", (_label, snippet) => {
      const verdict = verdictFor(snippet);
      expect([_label, verdict.disposition]).toEqual([_label, "succeeded"]);
      expect([_label, verdict.reason_code]).toEqual([_label, null]);
    });

    /** The live positive control: the real, unchanged core still passes. */
    it("still reports the unchanged real core closed, with zero capability findings", () => {
      const verdict = evaluateNeutralCoreBoundary(readCoreFiles());
      expect(verdict.disposition).toBe("succeeded");
      expect(verdict.facts.capability_reaches).toEqual([]);
      expect(verdict.facts.capability_aliases).toEqual([]);
      expect(verdict.facts.ambient_capabilities).toEqual([]);
      expect(verdict.facts.indirect_callees).toEqual([]);
    });

    it("pins the closed reflection vocabularies the reach rules depend on", () => {
      for (const property of ["constructor", "prototype", "__proto__"]) {
        expect(verdictFor("").facts.prototype_chain_properties).toContain(property);
      }
      for (const method of ["getPrototypeOf", "getOwnPropertyDescriptor", "bind", "call", "apply"]) {
        expect(verdictFor("").facts.reflection_method_names).toContain(method);
      }
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
    // Tolerates a freeze wrapper: `CANONICAL_PHASES` is `Object.freeze([...] as const)`
    // since the registry-freeze sweep, and a scraper pinned to the bare-literal spelling
    // reports "no match" — a FALSE FAIL that says nothing about phase-vocabulary drift.
    const match = /export const CANONICAL_PHASES(?::[^=]*)? = (?:Object\.freeze\()?\[([^\]]*)\]/.exec(source);
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

  /** Sentinel: leave it in place and the helper cites the journal honestly. */
  const RECOMPUTE = "<recompute>";

  const DEFAULT_CLAIMANT = "guild.release-candidate";
  const DEFAULT_ATTESTORS = ["guild.release-attestor", "guild.host-conformance-witness"];

  /**
   * REAL ATTESTATIONS, REPLAYED AS DATA (MH-02-R5-B01).
   *
   * These are signatures the holders of the pinned attestor private keys
   * produced, off-repository, over the two honest bundles below. They are
   * recorded here as opaque values, exactly as a real verifier would receive
   * them, and nothing in this repository can mint another one: the private
   * exponents were never written into it, and every value in
   * `NEUTRAL_ATTESTOR_TRUST_ROOT` is public by construction.
   *
   * That is what makes the negative controls in this file mean something. If the
   * suite could SIGN, then "a claimant cannot forge an attestation" would be a
   * claim about who happens to call the helper rather than about what the
   * decision requires — which is the shape of every previous round's answer, and
   * the reason each of them was reopened. A fixture is signed for one exact
   * (attestor, journal, root, entry count, range, identity) tuple; change any of
   * them and the digest changes and the fixture verifies against nothing, which
   * is precisely why the adversarial cases below cannot borrow one.
   */
  const ATTESTATION_FIXTURES: Readonly<Record<string, string>> = {
    // honest bundle A — BASE_IDENTITY, jrn-run-1 #1..5, one-time key 0
    "nad1:96a0b9ccc13e6be41163e4fcdddadef4abf5803cfe82cd7d8117502f3b8c7e70":
      "nws1:00:3934b515c407582a3a52cdfef0abbe3ceb4962a02bccd08086a48d72dcf45e9f4a5c2540e9110f18c231f87b0c0fa80dc7ad090a79eeb8bb22a2a2b48c64b13edbb6009471e4814b125dd1ff19f00ab3cd43269ef523bc9793666dc53eac6518bbe76e453e6c9f048bdb4651e83ce057dbc48788ec8b45a0e8dabc4f78873e6362cc55c1cf857b6e79e7e6157b3201020920bd1fe855b5607f63b6aedcf9512eeedb20ce5b0abccd1ad6217fdefba626e15e3fc26663ecb6cabb823806a43c24bfa6afdf3ba3a84db572df618f0f6baab02ffccc02ce2aebc5fce322e367be44a9f5f116f78e9b411dce6103a73c981eb5ced51691082c9876dbbde2b2c4a7fd3b1a9fb4eedb712823754bd7f7f37acdbe6476dc8e63934217f7557f193ce9e0e2df13c55ebe396a0e605c915fb53d43237cd5b2366d209b757129e7bcbe33c2db8e1b555450cdc1ecea5d544ef73c7df008ee727ef514a353721c823eca66c84c14d132cf69b0823ccf23c20c59670ac79f02845d94360ee4e6e010a3af3e6a439242f6d3ea3720740af43cf3183784f2ee54b927a5ec5fcc72a4bce244cace739ac20ae059ff97667682a4760c2ce83cac5f2319600c17f799fc936746b43c6c0823b035e14a289158b619e5efac4fbee5f2de3fadcbb6e94b91052ab3a5e8b0dd01b6b66c228bd71959350ed3dee816b88f64920baf1ecaa577ecc707afc507e5771b24c2ffd644e3bbeb7c579bb02c8efea0d879a934fedcb1909db50c43a17a91e2d26a7adb4dc8d242847cdea7076c0f129c62c0f80f05e5e7f0d47269f550397318bf156f728a6f7ee0365665727f9d2fc96962d368e1fcc8218ec99a0fc394e0faf4023b14f9af549bb1452ca743fbac0e56899a475eb355ca03df569f5fbcf97b1430b8a6f387076f19d0f4dc553601e89e74df6f38d67c578ff98a2893978f64185c3214870b51e60688f894dc20b4ed01a489101d58338228503b52dd0a5d03db69c1d0218124acdff4a1af80d7124216f0c9a12a290197860b5480cb0b125754e2b62d035c8efed941a5dd3544d351baf3fc21c5021fd84d8a99e7459d5d587cfc9397e1fb5ac0c7f441b7a7fcdc935941478b4a412e15ae2fc2c4f5c7a88d0f92f238fd7b32603f4c83347b3ad05a2c45e67b2ae780b2d0b892c4c77072f9f384e340225ec76c3799e0ff2551ad64946d5abcdf6bf6fd640a3595911eb393e2cf0dbb31cf6cab541ffd50c319c6f174191ea41b77552831b2d89abb4a1e90a5f4ed6e68a467f8f84546c64c2b28fdb77075c3cc675eb6cd892e43a1f75a8e63ecfb1683adcff45c4eb7e1a0c466912862dac31fc71cf5bed4eeb65e2402d18e8cf6b9a062014cdf8bc4eb56da97eae2ab2ca25bbb4b21fe127e4b74fd961cc337f4c728fb701654356baedbb101389a10142833e7a89e67ee5d9b91a705f285f29334abeb7b09285935c6dde57f72d9bf85e4e6d21d01732dcacc88e33702799421d1128192590b343b33599ef026d352b58d9b4492c77a31a0cf8a69db1cc9c51720183811a3e17c68c1250aa4b990e37033feb5762a2e80b45b486e0e9ec56f8848bfa40f76a287bce8f8cc92c952db67f55bbfeb6d51cfe311e6e95f72657ffc302a04764e6f6a84f8c79f00002e7300998abf201c70c114379c9bc9fe1c33cde8d0d07e7dd21ed81661968f1c209e5095abb90bf9c2c0e85e3186df10d53c0ccc9aa6ec2d248f6678897fc57c0aad9062f4f956415dfeed061e9bcdb08aab7131cad1a0764cf8890a6648642d2092c41fb3c0ea825bb04573c7aea46ce657ac714f60b5c5d426b5ac5401d6c4b6eee14ca04569ec2bb9ce72005f99ca0f98adf7ee2677a8e0bc035bcfb0a0312a082479d3910dc5a82ef04150d782a89875fd062fdda90518a30eb4876c3e93c2e36f589348831ecd9852592f51db80d655c7ecd4e96647f79aebc03efc285823fd710fa47df3669221a131967be863d189c69be6a0db7b384ef395224df752af4c547a1a764c7f404525c9ed016c024277f393c2c6fd350e874238d45a57637eafda79b79929eaef13aa3325a001c76315504bc8b5738a846a32175b30ebada57fbdce6f8cead1c43d9fd3807312b54a9f133f79e209c98bc257b2b5738644fdd2d507e40ee9a1629b9546ad60db89620f46c0a525a0e44bf443587f71ceef9a3dae3b7f759e8957bc4f47de96ffbc704a85f7a4921f2679ef1e144524e2f8b2e1d8aa5a2b26132f54afd5390405343356c9283c49328aa18090870a8dc7614c5cef62b71efafd4c45f81b10682b3ca3e90cf4a281ec1d8ee7d62e777e689cb5b1a8733735c892d7b8d49d80b69bf1c2c87d7b656a8ff53294ce5c8be3e540216bc43ef739163ea8e4c6985e26997ecea0112e636e960eb12077782bdffc70003912350e1eba88b785384b14ac0e9987ff1cd23097decac88f9abbfded3262312123d95c2a1d49378483b902f8b8e8c2b03b63a6ec20ce134ad6256f2a3091624a039c4399c15926519cfbf3fbe86e6237a8c3bb9f27e5ccadc3628d6b35e1f35c3fe20e6e7c0c43b4f86dcc0815417839ff569fc9e980deda748631204b252d926ac50bec8c49ea8a9c4ab8d00d1aece5ce7d76733fa9e4548e66c00db4aba0477c243d958022b24858f23d53a92275c78679a737004b51648d906d39ae7c92edf2055ab61ca247fd37520e8b1a03de942ee7cb44a7637fda7a94f07b90363b43949968ec9fe66c6a0ceed5688c96c59c0d6e9f3c0168a070ecf362566d86e7d2b988c5e22ea2bd3e5b5e49b1f0bfb0466678228f254bb10be7e585b0b7b0f1ff432ba5984131c5e41de1dfba64695b63d5847306ba6e1d33d0abe01cfc0031f73da1bff1fe0370ed960cd2d19868a0dec54fa4ee18a188bb16e80ce4b998360fcafd76d2d4f02576951584c0633666b47c3a23fe965e44956d9e8573427f2c5e91106a925985d009528b0ef110bc33a0c3c16b98083f381f941fc58adddfa501cb036ff95b78f4d654:3d29f85ee36f7deaba72ab2e0f7d74fda9ac77e84bfdf885778ed1d4f7f0d009b7292d8a3a3df7d26ed693177831db61a9d261b9621b25f8916936735981f94c289ceabd72ef487a4a62bbad52a224b117b62cddf493f1d92bf65c1249e27d0acc87a996f206bf3ca94e71aa9c2274c31d15377a7ac90105158cfc1ca41fd300",
    "nad1:50ab827a3dd40563ff43ecc3c1b37cc45202f50f8f21ea7c721b2484cb4c3075":
      "nws1:00:4e2664727709e8582eb2871dbfa2a3db49e5629f154f935de9c459efbc803a1f3b8d3cd72ea57425871f0a169ee2d35c7b15c69aa9cbf2b53e605536c5d44e4662f691e62374e8c0b87e3b179a1f5790fac3189c62ed3071583b348e7908ed4da7a6f635462c428a80afbc8c9d555f6f0770214b08150f5fc8665e29f41b8ffad2a496fdf3c42004b72c9addb6759195302205c9fec98c130960fcdd02772e613666f1d5a9bfe54bee053106a089b77524ffc98646e47bda945056a16e2c4cd0f2fcadbf1387663428572bccc10432628c9a00a833bc300fe980ab2d7beef0394d64b7d18c624107ce5eb23313a657bf1dfcc7b9f4a95cbdf4a7ccc9437cc5ecda78d717baf0b8e0145b497900fe33107071f212a0a9a42b8ac67592cd7352c1270e37f6316e4967c8ef7631133eb7a60ea5e9b821d57663f049a8bf200ee2914740f3eb4dfd796f919de811210aeb59966ee7e0f71a21a2c2987a10293140dec13b5eae1e359dce51dff3f1dcb12325088c2d6534ec2f9acc8c550bf75bcf01c2ea95d859071f0a8159b342c1c8e2e152098ee89fc3a7edf13c8298aab407253c3ac8f8a363265ab20b8ab835d34a6cd3a6c6ed3b84367bc1b65b337536d3dfaac76245517d1eb4ab03f18f1cacf580ddf924ab4ce2bc649e134b04f75c25f847a93766ece4dfdd63945455e98ddd8cc9198031d7f7166bff33b88705cb73e69c9020c1e259df9c04fbdeec8c26c6ab2838777136725c19e29ba388951bbaa0762af62cb4b4e16c49db7f74ee1db9784a6b30b955ab3eff15ff3ed6c3d2df03ba15254a98e6bfabc01cc9dba59c38163e60a075466c097e0dbde2e5c1094b1aec1fb25ff4149468efe107e7874b1899835647c0582786a435b63187acee47c14a50604dfd15ebdd035291da981387c62e1ef730a21684c7c6c5f273754cc2ffc7e495c20e4fa3e6dde3d0ea4180757a6b5585471713c7b6d85ff7e7a7ee24181a360411a87298ac3bbd0f4829d2a5117bc57b896c874376712a0c642cf724247d0ed8b216e494428d248c084d59d7d017061e091cd24ed996d0f336923829fb55a7672db67608b62a2ec8fb0fcd65147afe4b87b5171f869858004f035a20dc39050664ef9ebfa632ad4737c27fa8d0d8c7fe0967868a7bd5e9fc62d47217d5a72908d27cd128a06b7de8f97be5ea5bbaa41c69fcfdab4d657453ed68dd0b6391fdabc53be979c16f07e872817eaef4d49b5cb45d9304d67d67efc29a0c0061ab83a9ee32ed71a2f696cacf8d15bc89b7e8d06ca3a51ac5ea0b926921b7c1c1b7685d0a7708860cc71abc12b82100d88bd320b708fb4deb6a75b4f8a5a935624ec673a8f5874fe2f7bb7f871e10d978784f5d954bcfa31892fbb5b12a3d594e252bebc1f8fe935f3934da907d54e7173bc0c46d62f20e65afcd5cdc27e6e1052c0540db2478a7fb3e572d219d020967936baf679b2845f33a88650df051d0470bb6139339606775d729ae9f5a9257ba7803f036fc99b41bbd3615e099232089fca647f89c957c2b4114152d8e9cb29e58110f535cdda3f5a2df3489d87d78ef7016a27b0f08fdf8bfbe13096fc49563bc1db7d3e5c9315bff8b2ae1d5cc35b9a91238c29896f9a1b06208d2918c61178e778774b31d29b7b722cb1f12c1b1b56ffe158dfcfb279576757b9e44a11d7051494d5c155f087b482758d777130983bb908e036ca33a2b4161496a2ea77182a982a0e7d2b21a7442d5ebbedb0f4dbc2cd4b607e5a5379e76df270d81bfdebbe955b82eeb974a1aba66c036b2ea39225f0dea64fc07fa223d53d452d71eec40ad4fc740da502664cb0888e66c4a5d2ccbc57f13168416fae19dbc006ccfa14a3cdc4406516fb306c374a925826d2a3927167536c3de3c8a9ba30bfa931aab783655083783e542c9491735de4c8d7966f22468d5781c908c1768ec6e419fb36d1ce206e744db2028f0a4cf29aed8e7e38476acdbe4d32b65b0eccd2567902433df25fe447aebe70f811d6b583339c375e39920dae99a3022bf0d3c158694d509e460704169d34ff5c8ff72fae3fb3568683fe1c05f026b46662bb0ff4513e1e30dd4eaf2c3c58bc5a412446ce59426fbdc1da9bb30143a784a7fb10c11beb7bed8cd488f1ae3e366a167dbaf8b182942094187e5c815245e8a5476fbd28cfc7c3655cfb7e0b25d83dec5f2d6fa254bdcc0e6da875268646fd9914376881dad731b7b8cbb51d93bfa5b68a1ab57c681aa23a7673b9a405811e6407433566540d0049df7fefedb60c46fcc26f8131250010c567d36a2c3aa6bcdc67acd7d5cb9e66981288e83e2ea848bd30613635a923d3d8dae62d2b2727907b199f38312b2cd3f1f66e1afcf420f426806828e0f9a4065e83c587ce38da05e5fe82192ab7d2c45ad05a8d9828afaaa330d219e4f0f559e8224263084c6b107522d28a6c1e9244d08ed9a9f90e77f648c5689d48e0ce54407c34e28f8d31557d03ff9499867832a238d76806d79bb6d93e1013b8051e544402aa021ecaf53ad8902667c4365a2f9e4dca8dbfaebc91c48e0ab675f9f4d236b71a0461667adcc0b04fddb2fa200b4de23e692becb4a5b164ce49224f01d84d93414d7b7521e3d4cb7861c7280f3995fa6923d85cbd30e7d322df88729b687451017b82fde5b7dac607e5c6672665a29be0dfb6f66a4d99349dc46805b9eb6e740afc245827dbd4fa4681b321b8e5f41a2bef34d816e90e9c45e2545dfea021dd14b059dbb11f61fe3a1b0b31713dddadfa293d50dc2b25660c67b19ad0035a6af10f209d4f0ce9366d233102c066b84e72f0e387ce5321ca9bb5479c8572debec587984e1b3ed142e5f2bb236768efa809767286800401a1e3bf112e999ddf2d8ed93adb68f09402d0c9e192b2a7b142822c5c164c27d9a73d8ff45d0e557285fe18344ad7e98b3af1c31e101194bf619ef905b506b6436c4a6235602d7029c3236750657da0f98d9e6d545a1cc7258b83e28c72fc88fc3b3fb324257e6:3f370b275ebb2c2df1caa8d2f5e17b5d6288587795ffab5d379cc3d6059b76cba82461a055e896365e86bae0a01f19399842317bbfbc15f9c9cfe85eb174b9bda0ea6cd5fe83b92d46af82a2b9d6b13aedc77e411fe403775e4464d28f97c3fc0cf6f5ae8ed6033c07ae6727cdcba1513b1d51588df8e8517d1644f8904d10aa",
    "nad1:08ad11477ab0173c4cdfe36eb337f810cb398b60b98c517c4d899b9416a805e5":
      "nws1:00:70ae6144a3832458665c8d44dafd7bd6a873fb68d2f476852408c935db656bf56df97f4bc101eeb617b9456e6de15471129bfffbe58866b53a969cc51bcf8a69804b345e61be583a30357af359514c9a5dc72699a93e4a1547b619f3490cb2ba3fb21015886c3a0bdcc25bd62eaae0af33cb3ffa7cd3ddd91db3655c70edfa8a43cce0ece0faf0ff4fde07ffba053994f5c675051e935e5236ad057e8884e03e4aad413c9785e371b6ff8e023c8a8c5dead2b39139504d9ba9c8aa116c8d4d69e344a05ec9a2f14665e93ff03c8c6d564ea9b8cbf1a1e63f5f7f2a4fb044de0121fec60117c55240ba811c8a3503aa3d3a5eb952cf7b4a33f836eaf7f71097ed32765ff24111ba87f7b2fe44850bbaae177c9660215544f2280ff8d8270137e09343f7b7080eb07625c11fcc914dc5abef22771e5f5a950d3cd430377292e73d29505e5b7ea94bf0dab77aec1cf76e03f4349c821b26d6a567171df80c2e287c566a1873ca5eb01ba586711441bab5e8dca46454d72ab8f9ee16b4a6a07110fbbb5d0729376380dd581b0216e7594163bf4fd3dbdfdb42585b7eeed41de765139f3d7b8c88c654e02643ee39f7c386290737d8d39e08e908ffef09ea0111c09da2bd4773b21be394368f9d0d9c41825231d4c6f66c96a3cb755d9e3d067390fa9621733a6733128182ce44bdef404b5c208873157733adf0d447f81243b07351f90eaf0219189975f31ae8366318033e455c16cadb360f3cfbf55c88b75b2117a202961aca86f9308fa44ec440e9c7953cdb8bb325f586ebb7944c0245e6021fe6ea16a08691e5a4d51665fe3e3071b4514249a7a281586957f493dedcae327a0761bab88f0c434a991e1f6c42d5ad873083f100e3f5aaa6dade1811e655aba974f2a32ac185e6db6b5af4f7ab9b9eb228f4f18125e191ccfe9579229cf5f48ecc8fa20096b172fe931dbd078f2f8745702339f42900bad959062d1d0d627322d55f08a66a30e14565960f0a2b04c49246c332f268a12f538085e225bc3cd67ad100ff9d9820a7f4296b80db7a777c12511a4bf4c9f4a723a07c27077f491da4f310b3a5f5be4fe62c8362c30218f33f153a9d6d5352d335a8dd33c699b47088f64250c07d25bcbdf3be32ea4b16e413f7a05c2f8b1aff7ba6c7dc9e686d5f91cba68dc171031f1c81fac1ca62ae6c771fc24480f26bdcc678a472e8a0283a404843db0ab5f48085d6e7843987e94b059a18609ebb1d77870b6c0bb2bd61a2c03ffa1eda02f671b4f3b8a5da00c1d4e762d1a96fd4630614e71f19e0437bd194a270462fb4996b8812489a0ab1bfd7448c8c8ecea640f7dc440f394f0fbc194a00937d0819d99475676416d882e430e8aa2798db7463a9ac2bbf1e900b41ad213dee58a9d9fd1d1d3e62ce831764e1b9055036639151657c59226c8e6aab3b5b5a835d629ef8255afe674cf47e30abbed3915470f2a0cb703ecddacfb3e11bf011613bd1750bb4b63bdc8459e188d06e3e93ba6f68bb51681ade3a7b3be2f74685d1f54eecf826ae661e1fab92496d2194f13caa32ebbbaaf8da9add30e08cf419b8a96c43d2feec39ba3874ddbc1a9e6cc7307ae78ce9b3e8e7e5244b660aa62bd0322f5cb6bd9e5d9b60471210d861ee1a1ab04c7f1a930221d0d42f2af257c820f8da3d10e6ffd2c84f46f50a7bdaee70d2771d26ed55dd15db1c2273c86238e0e61237cfc4becc452d091a7bfd50abbd5ce842b97e2c61d782231ad5d190106e06ecea17b8b82d0795d91709715c17fceab5f7baab79050131c6e9e838a5ed14b4f2496508861fbdb1ee49408bebbf3784c5759d0fa99f53faa2ad52e49c9ec22507f6c5b3278f75708796b1cd8f2e3919d4237b9628dfd32691609fd518983b9a1ebddae99bd8e5167cca5634b7472b4efa0349a84f685c4378121cd1a82837952860ef4ab855974740d6a8b37073b771a8ba2b4c295bb5f2a13f0c25a693789e1ce6df0a1f160f0c7d4245b82e62b41047b1f31284a4b9205ccaf9c4d865dfe6326e5fbd1f52aa8ec166421a7e614957716b7b20b3abe3a430576f03d404308eb2caaadd926c49842b04bfcd1a00ed0194ba26a41d2dece5ba10add4bafe812043a69d88e95682230ab30c868bec8fc5e80b4b1a0528c872c8cc8733354ba8ebf8ef2ce12a736d59d2a47a4d309062186855a5a9a02cfbb276a91db9f21322b4d0ba296b0b095d8ef64698582b1666af4a948cc7b455c9aac32ae1e6de509694bed8bb2f138f0020a17bbfabd65450f4c78148a962ee535790f045e2d2962c19d7cf7d19378fedf7688b794ca9343ac425f67306a2fe62c57e451dc76dcb4711aa4ec363354dca441e5ac230974d3c0453b298c216485626faaf7d4703744614a2d8940bf3648633ea5cf2266162869b3e406994239ef0d0f7f3ca6b0002385aba4677dc5a8550c01e868d63bd7909f886c214178c586fcea44163af44c48617d213a3e140d19373aeed8c773c87285ee8a6d768f8fd4ac55502ff4bfcaa556572848e8fbaffab61af7c042600b21cc7fd7dbfe6c20f816adeee3c581ed1460cfaa8656595aefa053b537243ac5f03553c6eb68dc0e9201f583ad51685c7ddbc17b4b18ba9aceb9fc15ca64772883f5b1523e779b95c63774d5a57d4a83e04987ee1b13176ea3582d512be99497de257470ea660e0a88a960462915500687461ef5bd6d37ba9ad17d8064b4923a3b35dc44ee4ba8342d3035f435293429d6a1af629db9e8e3a0f7a70395f0fda55c4bd4738ebf7a7c2840a0a1c61de3458a87a57194a212dbec6bca3536ca82b3550592a5c0b265eaee37222399ae6ddc5b824b483fb8afb68d6b6e6c8381da89d9ea2d30635353b8560f62f78c2acb26fcc0f727d0b5c529bb0323c6e190a42684131d9021ab22c33c36762e341bcc600cbf072037e82e5966be155838410b3ac9fb799f2dcadff44ff1d8f94b164b550e0d774e3a216a0e3d3bfea00d45b6786a52ff47d7bccb5b40578d97230a401:4ee7f1d62f497b5a503a6f83b40cabc336a300c1ad2a3eca390e7215a2875a5bc34a6038bed088cd252b7bc897de863286049ff85488f2c1a280f70c99e048c7b943b65aa1fabef0b28a714684f0a980e382efc1414dea5d9ebfc74fcdd9307ca7ec4cf40bdfc60e841be04b9c6f09c6985c53d640182a0470928228537a0257",
    // honest bundle B — the same journal produced under runtime guild-2.3.0-beta.1, one-time key 1
    "nad1:f5afe0cf112d7bf986b995d9cdcb458355f36a8888d392f1bd7a51b4abcea566":
      "nws1:01:1ce463bdb7c17a00bfd1a47a74616a09f3f04c0a6e7f60d332a7602a6520e0af68a0e99563131db6f93a06b552b3d002f3357215f043e4c47b300a1a5bc68f81982c810ef0ed3b0e4373c0db17939d4b7e4800295d4cdbd7c4b707929663b5f226ace7f8c6f4e3781fd84ca4c5edc2c14700a994608d619648b5a3ce804928186c6743f4d71bc9ec3ecf4e3523fb0542715bc8a30081a765c7ff8a419d4174e3f8508a5653c400a6e9f29cc0882b821e11bf5017690339fa7e8df16e4721d734a8e239cddd9ac46d1a554081a8d8d2e35168ae4e036f85b1f05f06da44b5387f2b39d981914089890d99a3416e439ddf38544372de9df264e825c1b24d00fbfddecff7f8c55370f73e2f51fe8634d36bcee40cb2615d9420ec6dd6b2b7a46c9362fb569f2452a91294ca58f587a551fb985dc354ed78a95fedff15a59788cf685b1baac2d68d21f8c908857d6ee02ae4e311a8a17c605c6e115fa1261f6fa0fb26031d516a93eccbfe23ce558922d076d39e0999fe08401cc9e080a7f7b114ca6f440df812e28ba786624ab2f6d5c060e78a212b0f9cf22c3143458d1e5e138138fca75947cbe70037ca4e6e33f3c007182c19e4da866c3957cc02c745242b4e0a4170b077f4ea10dd1ee5182a748c486b2182e5a2a2dec871d051cd1bc70a5e8e68609b57d02e38bdd74443d57e7dcd38ac4ff85b9088ba5bd859b1420b61635f6aacdcca85cce6434d42e68710ca68ce8211b0a2303300e2d0a2ff75b61670014442680595ecc38cf9322e48bf32122f7c829e616f4beea4242c0d90505b3e8e1964c4bfc5af7d6b90dba1370bc080fc5e5ce13e13affba6e9001af965687d678c93a24e6471cc60e25a89793ad5f47042cb4ee4ed88e303eb885a7d58aee4183d3c798ca35faaec9dc753921fce66fdd31718080a800164242c57bb22813fe3754b264c5e633d678c087de772806234febdca6b0eb08285ab93422ca0bdd4c1fbd54ce649f1d451d07bce041f8b1aca718e6fb806780b61ea5da92264417ffd264d89a5042074cf154371fc51edd81e01d9b2ca7cac79427de86627c4d46c584936d9048c97e66a3d3e0ec98c83ea8cfe2f7ab9f60c969b80e7d1d130cc95afdf9520f421cbf077a38b0644aee4cfa3a7f437a13cee61dbb78af00422df4dd9c9226ad0780cd18cd26c9b55444a7509a373622648f2910f7f2422bc993adfee5690d19718d8c52e78736626fcfdadaf43ccd5eb3b458e25c9a6b2c4fd2b7de7443191327ddcb2567b3cd3c65f2d79b833c4acdf4e886fa80694b5669f284bcb60295cc4ff470df148daea649d7eb9f086fe91d7e529574806ba1d5dc01b3a4c1a7a56e0852a4c88ea6d3640b6eb9bb6844676f4e62d47f58b471705a12dbfb01feec8dee3739fab27218ab5d460c264f8c1219ad9600e10380db453f8c1d0cbb2e1cce6e749f223632bb3b9b018e6d619fa29b9fba3c48d591f192e1a2e79e84bf0807f74d201eb53d9e91daeaf8c614e79ae2c7883f46598e427e0d93b718d8416761d230589aa30bb1917451b7723cfecd02bb4065e010516c357898241587563ff9bb5cb84c34897af13c5914ccf16709e059a844c3a7a65a3c6779ff83ee3c731fc53ed02006a120f697c4c732ceccbc0e5e61c82b75dc205dff7e65ebe282aaaf28a3983bec4d6174c1c1da6ecabe423bd1dcf3264319251a55343636390c44e6381aa32f7f9556e257677c2a06b710bc937a506c2c824f30a43d6cd6a83ec51a730dc7ecc35f109f7e5cdd77583abe518f97a2240b901cced18665dc025c1be33e6ad4e24b345351e4e8e1d8d9c9ae9383d42a86368c4be1fddb42c621905510402dc42b1fcf70678d091db8573958e610eac8063d359dae91af9c67ca0fdced5d16e45badb488b2506195ecfc0d9da95e2d831be5fa80c6adf999638d5738981e5e8918d829138bdb25fc741a27a22bfe1d560037352f29b65ef8670ba90be7604a78d19457afb9c19d972a525c4b17cf661a2a5852c93b7aeafecac7f93a55586b3029dba8b1b0e044ee71d54a663976876e770a5cfa5322799578ccccbf3531bcbe31b98f4b10a153e8c9ece0fab38c424cb13630f37903389c54dd55527cdc4ff453ea9e33059414d517a280a2b91cd3dec23ab7da3b246e68bd7b834967fefeb2b8dcecc6d5dd355ca74e472fb5f31ed576d87186c04db4aef6a40ded7653dda7505d50f346119b17992965931d8b8974baa2027ea25b40112066f80224b8c8fba74fc53ce130bf8107c6f015d747dc8b76f51471f3d7a3a8eb483722fa059c6b18a6eed52200b017b43a5d5ec2c2f624447c75987bd043f57eb0c63eb04fe1cb481c13cb68f9d4197f25a95c8380c83291e543ea0c6c41e82761ebfb4b4b797e87e0f0e22c57615de5ff6937e396273e35cc145c06ef4a645799ba0ff39617b51e4325c556d295568b8e12437336de72c21be7fc588f7ffe898fe47a30c145feee59b497a04940f6d1f224c9d8010219ae404364f308a57d2d8d69a6c7e1cbc28cfbc81d2736a22a1055501c010daf7d3c468986943a3ae4fe1f2a4e409c02dbd332cab334086ea743ddc1b02e062298f4d8d77245bb90061ba0142640b91ab93ea68c02ef0e5eb2f40efe533a3f290dc6333b5ce12d7d2bd1775294dd3e715b4d1de2fbf6650aba1abc1b7e0ca011e473d51e3817d712db3cda767630f153c65b85736ee80d160e5ef84734c57887ae095f741b10855eedefd865ac1fca26d6bc50244baa65f342c7b9c536d8fcfdbd2f246c62330f82955928f210014c0a310aeea3ec29e2215ac147b7bcf248edd548a64d71f5d49756eef5528e75a1a32d765f3e719ed372db16a84a29b02bc75c59b66ccd873619864d8fa85bd4ca58c1b526520d83ecdd76fce3ca9892d2fcafd4e5a5f415167a3278dc618ea2b9b139af91600c998184984e7f86e419589076a1651ab229619d0c45f1ad8cb043c659e1efba2137c19ff885dc0911a98d61aeca990020c4771695a:89251a8ef2c74c2f948c653c22c5371302db897f524334185762d348d2ba7f6cb7292d8a3a3df7d26ed693177831db61a9d261b9621b25f8916936735981f94c289ceabd72ef487a4a62bbad52a224b117b62cddf493f1d92bf65c1249e27d0acc87a996f206bf3ca94e71aa9c2274c31d15377a7ac90105158cfc1ca41fd300",
    "nad1:29a7c823dd2a9ae1ee78d8d6946265eeb96fc8b80847794cca02eec32629e118":
      "nws1:01:a88ecb5cddc25f6175c8a16734167d1af19bce66fe2567920b9d0812b19761bfae88e4b1af7be843b1ab254e25aca89663bd61e8955607e06d6d8ff29cb4745e60db727344721794dafae6fb9e7370af58c311960f4a461a7c1f89dcfc059b7871d5d27c692a0d8d53d696efa6dc749ee2ac097b16e1561db57896750c2f8bdca26f83a47b116bfecae7fae89c550c801af8d54269d6fb088e79b7356b87d7e6456e205345d1bf23d4b8d74e70182a84e3be3f45c6f692e39a145686e19a57d01839757feecf1746ba6d71223677dfdce5f5d1c2ec420110a6d0a86f534352a74a90582866365089423d6f36506e82b55335f8a37c35dddeaf076b1c2c535c800ac2930bf487eb5c6051462610c3f45f59c788b040417dd082b86e809b03dccae39da01c30d770c99a1397038d88c9405f07b0418fceef17edb6e80d765e7793977c747dfb5cbeec47121d661867b0d790edacce8567f840e55ba64a6d5264867cc425cf2bcbe000b544ef90191abbe8265934a4b99e9f5964aeeacbfbb3ffd0d6bcffd278a212660307d48f0939ce7e972614f39c84986ca37953a424da32664bb56a85498bfd6c2014a92787f8cf045b60ad04551303074ea7b71c16ebda14bdc5af31d9ac2e52cccfa227a5c23bba601eac1ab6a1d35734ebf885d453ea18d59b69c0344c2e392722bf26e70ef05f5db81fb541cf7ef8f3e2a0bd9778aa5be72e6b814cf4b22d9001194983f44a41d89deabd1aeb7a086d415469415ce87fddd80cb612e5a99012f64c6a0beb8395de347e299d676e06a1caccdd08d2c5fc8f00bb3a2bee76c3d6281553efda01ee56d4bfa2ba901e7e4ece2fe316e438dffab4aee45622b703e42c1176fe0445803e4ae05e0da7931746cdd468111fcb58e68e26f38ccb98dac2d9a30b3b1f476a1f9bf660ac9a3ef9fe10fd89bd08c43e71c31e77f948df7420a7925713ce6ec9509790f9a4b3fe4b2b1790794d299aba51eb38e7ba5ba1fa146b2d36c9a9c2e8670fc2a1246266669ea59a9fea2415ecd46d76d58d64f9f3ed4f855cf25c153b6d0b271686c66785d5e733cc9b1f8361b75f508bcdd5054ab1aecf54b0672bf4dd5659d583cd3a49f70e7502fa82894e51741c84fdfb5024a487a587459258d1ee7b27568c2f2123c78c0a76636df4a4cdcc2a949b4927e7de632b61cfffe67f2f02e31d61b6186e718e0684a74fb43af5303884fd00bf2f01fa4c5af201472ddba37104f988af5c839f6575710ec7592487ea9ef8e5944eec7166fd66ac365fc7509db4671b6673c260596195abb4fda5660a65cb47cdecc4511502450dc5d0379eb6be24febe080316fd49b305800278d41d9f1e067094c7020cc170ebaa76a7fee9c4b3da22e2429b353822fe197c3da6ee1209aca611eedb9481ff2c58801890048703c06dec0dad92b25aa714eae9318cf97783a5babbae32278f781d0a68e48957f6527c4a4d5c596e290cd8e2b708ee469b8e865b94510803375c17b33fdcd5dabb6be42729814a938fa58dc00dc56f31e215ebb18b19428520077228afbccd278333b7f197a263dbd27de2156aabb67a0af599eff419a3b37977f20c1a9eaf5b84874c7803e82d5c3492242ff4149875d8cc1bbfc56954454576025ab7c6f8daafa3f60798c1eb3e37c304edaa965c7cc86f03d88634a6efb6082054fe7ff2ef1a1ccc7a4817f750b7447d8e5232692cfe3db95bf3933d7fbec25e3382bada47c659c9d5f4462371d915b0bc24ad6347f5d939b6fed72ad30a87848db6725c5a65628e9a7ba3ef2cde550f6266868dc76dfcdaa78c4cf1e9880e1a1f89895a1dfa83f311da11d96622f68523d93c9ab65de385c0da5b960757a67395e478d365730510f925591203defcdc1cb1c18844c837dff948891e890b8803dc8401c342b9bb973a092f10a34c67b5ccba99d48018d5511880163daea93c4d19edfd437261300fb04bbf3fff39862201da7822318dc95ef3c5115b2da2a47007fa6171e57550a1e33e17ae7408906d62b7f8a92c0d858b5b27b764a895f325b38ea7cf66e59b53aa0967f71c7a4ca0ee524b208be2c09bca0874ed99456ae90f708ce33f660578910acb79c51c34a5e5814551c84d1c41e1c9bf7aa09db245733f2b89fe4a8949b0275e6d8fc9883e4f5310b4657310253ae71d3fdb598bf2530ac4a97df2758016c652c758fa6e947bca86d1c688fcd5fcb39fde9b3935f700ede7efcfccb641e8744d333e22b2a8f6645aef7e57d08bcd914309767d98305f7ada6de78691ddf36ae2137e392f78bdba59b4913bd66a547e526ed421d3db309d7a7e3930cb9d9d96f02dd0761a9bf12a26fce9e9f2fdc79379142b5f3a84c88e5489769c8cfac49a06cd0fee587e7be1ff8b3e2c246a9e2542fd5df541a666cf11fdb3b7ad2cf87be70ebc273d1f629ddcaf4f654d37057b1de8b9360eec970f2b2e824b40817d1b26d1e9c587272d7ad359dfc243fc39de9793adf8a4675f713e53f4c0779fa75f6bae244627f2885c587e0e7587d77e3c76fb487acf6d7ca5073ca58479810ef09b5cb6cbd8f54bcbfa8e1a6fc3ef9416669aa06630f86640269e8dba0f92ca9a6ac5c916a506ca85e03edf9370ec860622fb1d6c11d858ddfa0341200b63f220511108565ac1a3adc44a203de373463da9b951bc493d12148634dce4101ae042904e595a1174feb8ddb920497359ead6c266c49954aac545fc0cf39446620a9b0679bb9ea4cdbc0758ed357751eb6b9fc3c7952ae1c232f543070a4d77f2dc645493c9199b5af6ae251a9bfa3e54d8a622e359d6b5d3553002a1a2d8cf261708b5c79c0b572887aa669f8bef132b478be23ba97a40336aa3764b23d99797b374bbbb0801e7bc884de72885d3e3dc1a7c54838b004a1dcb818e9ab6ce0da6c975b6f71dd3e994e8fbc3b19e0ce7a6ba609309dd774a6a8a2e7d89f75851427a78df7ab7ca3f917d366ed42991d0642d828728fee8df1d565b8e6292ec9891b7078452642f540641:4397b28c5612f1143f12508d2439190bb4c41a9907fb2a8814cbe4719954fcc9a82461a055e896365e86bae0a01f19399842317bbfbc15f9c9cfe85eb174b9bda0ea6cd5fe83b92d46af82a2b9d6b13aedc77e411fe403775e4464d28f97c3fc0cf6f5ae8ed6033c07ae6727cdcba1513b1d51588df8e8517d1644f8904d10aa",
  };

  /**
   * A structurally perfect signature over nothing — what a claimant CAN write.
   *
   * It is well-formed (`nas1:` + two 256-bit scalars in range), so it passes
   * every shape check in the core and is refused only by the verification the
   * trust root anchors. Using it as the default is deliberate: any bundle this
   * file builds that is NOT one of the two signed honest bundles carries the best
   * a self-supplying party could do, and must be refused on that basis.
   */
  const UNSIGNED = `nws1:00:${"11".repeat(32 * 67)}:${"22".repeat(32 * 4)}`;

  /** The real signature for this digest if one exists, else the claimant's best. */
  function fixtureSignature(digest: string): string {
    return ATTESTATION_FIXTURES[digest] ?? UNSIGNED;
  }

  function expectedReason(stableId: string, disposition: string): string | null {
    if (disposition === "succeeded") return null;
    return stableId === "MHRC-UNS-002" ? "policy_denied" : "gate_unsatisfied";
  }

  /** What one journal entry records, before it is chained. */
  interface JournalRecord {
    readonly stable_id: string;
    readonly outcome_type: NeutralScenarioResult["outcome_type"];
    readonly disposition: NeutralScenarioResult["disposition"];
    readonly reason_code: string | null;
  }

  function defaultRecords(): JournalRecord[] {
    return NEUTRAL_CORE_SCENARIOS.map((scenario) => {
      const disposition = scenario.expected_typed_outcome.disposition;
      return {
        stable_id: scenario.stable_id,
        outcome_type: scenario.expected_typed_outcome.type,
        disposition,
        reason_code: expectedReason(scenario.stable_id, disposition),
      };
    });
  }

  /**
   * The AUTHORITATIVE input — what the verifier itself observed, INCLUDING the
   * journal it watched being written. It is deliberately assembled here rather
   * than exported as a canned constant by the core: a shipped ready-made
   * authority would itself be a promotion path.
   *
   * MH-02-R4-B02: round 3's authority named a journal; round 4's still only named
   * one. Naming a journal is not carrying it, which is why the decision could do
   * nothing but recompute the claimant's own commitments and agree with itself.
   * This builds the real thing — chained entries covering the whole range, and a
   * quorum of distinct recognized attestations over the resulting root.
   */
  function authorityFor(
    identity: NeutralEvidenceIdentity = BASE_IDENTITY,
    patch: Partial<NeutralConformanceAuthority> = {},
    records: readonly JournalRecord[] = defaultRecords(),
    journal = "jrn-run-1",
    first = 1,
    attestors: readonly string[] = DEFAULT_ATTESTORS
  ): NeutralConformanceAuthority {
    const skeleton = {
      schema_version: NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA,
      identity,
      receipt_journal_id: journal,
      receipt_sequence_range: { first, last: first + Math.max(records.length, 1) - 1 },
      observed_entries: [] as NeutralReceiptJournalEntry[],
      attestations: [] as NeutralJournalAttestation[],
    } as NeutralConformanceAuthority;

    let previous = neutralJournalGenesis(skeleton);
    const entries: NeutralReceiptJournalEntry[] = records.map((record, index) => {
      const draft: NeutralReceiptJournalEntry = {
        sequence: first + index,
        scenario_id: record.stable_id,
        outcome_type: record.outcome_type,
        disposition: record.disposition,
        reason_code: record.reason_code,
        entry_commitment: "",
        previous_commitment: previous,
      };
      const entry_commitment = neutralJournalEntryCommitment(skeleton, previous, draft);
      previous = entry_commitment;
      return { ...draft, entry_commitment };
    });
    const withEntries = { ...skeleton, observed_entries: entries };
    const root = entries.length > 0 ? entries[entries.length - 1].entry_commitment : "nec1:0000000000000000";
    const attestations: NeutralJournalAttestation[] = attestors.map((attestor_id) => {
      const draft: NeutralJournalAttestation = {
        attestor_id,
        attested_journal_root: root,
        attested_entry_count: entries.length,
        attestation_ref: "",
        attestation_signature: "",
      };
      const digest = neutralAttestationDigest(withEntries, draft);
      return {
        ...draft,
        attestation_ref: neutralAttestationReference(withEntries, draft),
        attestation_signature: fixtureSignature(digest),
      };
    });
    return { ...withEntries, attestations, ...patch };
  }

  const AUTHORITY = authorityFor();

  /**
   * Build the ordered results that CITE one authority's journal.
   *
   * `perResult` is applied BEFORE the reference is filled in, so patching a
   * disposition, an outcome type, or a reason code produces a result that cites
   * the entry at that position — and `bundleFor` builds the journal from the
   * SAME patched records, so an honest patch stays honest end to end. That is
   * what keeps the semantic gates (wrong type, wrong disposition) reachable
   * instead of every patch collapsing into a binding failure. A test that attacks
   * the reference itself sets `receipt_ref` explicitly.
   */
  function resultsFor(
    authority: NeutralConformanceAuthority,
    perResult: (result: NeutralScenarioResult, index: number) => NeutralScenarioResult = (r) => r
  ): NeutralScenarioResult[] {
    return NEUTRAL_CORE_SCENARIOS.map((scenario, index) => {
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
      const entry = authority.observed_entries[index];
      if (entry === undefined) return { ...patched, receipt_ref: "guild.receipt_ref.v1:absent#0@nec1:0000000000000000" };
      return { ...patched, receipt_ref: neutralReceiptReference(authority, entry) };
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
      claimant_id: DEFAULT_CLAIMANT,
      ...patch,
    };
  }

  /**
   * The authority each `evidence()` package was built against.
   *
   * An honest run's journal records what actually happened, so when a test
   * patches an outcome the journal must record the PATCHED outcome — otherwise
   * every semantic test would collapse into a receipt-binding refusal and the
   * gates it means to exercise would never be reached. Pairing the two here is
   * what keeps `decide(evidence(...))` reading as "an honest producer, patched".
   */
  const AUTHORITY_FOR = new WeakMap<object, NeutralConformanceAuthority>();

  /** A complete, ordered, source-bound, journal-citing, fresh package. */
  function evidence(
    patch: Partial<NeutralConformanceEvidence> = {},
    perResult: (result: NeutralScenarioResult, index: number) => NeutralScenarioResult = (r) => r
  ): NeutralConformanceEvidence {
    // Apply the patches once to learn what the journal has to record…
    const drafts = resultsFor(AUTHORITY, perResult);
    const records: JournalRecord[] = drafts.map((draft) => ({
      stable_id: draft.stable_id,
      outcome_type: draft.outcome_type,
      disposition: draft.disposition,
      reason_code: draft.reason_code,
    }));
    // …then build the matching journal and cite it.
    const authority = authorityFor(BASE_IDENTITY, {}, records);
    const pkg = evidenceFor(authority, patch, perResult);
    AUTHORITY_FOR.set(pkg, authority);
    return pkg;
  }

  function decide(
    pkg: NeutralConformanceEvidence,
    authority: NeutralConformanceAuthority = AUTHORITY_FOR.get(pkg) ?? AUTHORITY
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

  /**
   * The reviewer's exact probe #1: zero scenarios.
   *
   * An empty package now trips the MH-02-R4-B02 independence gate before the
   * suite gate — it names no claimant, so there is nobody whose independence
   * from the attestors could be checked. Both readings refuse and neither
   * promotes; the second assertion pins that the suite gate is still reachable
   * for a package that at least says who is asking.
   */
  it("refuses an entirely empty evidence package", () => {
    const outcome = decide({} as unknown as NeutralConformanceEvidence);
    expect(outcome.disposition).toBe("refused");
    expect(outcome.reason_code).toBe("scenario_claimant_not_independent");
    expect(outcome.facts.may_promote_conformant).toBe(false);

    const named = decide({ claimant_id: DEFAULT_CLAIMANT } as unknown as NeutralConformanceEvidence);
    expect(named.disposition).toBe("refused");
    expect(named.reason_code).toBe("scenario_suite_version_mismatch");
    expect(named.facts.may_promote_conformant).toBe(false);
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
      claimant_id: DEFAULT_CLAIMANT,
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
        claimant_id: DEFAULT_CLAIMANT,
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
        claimant_id: DEFAULT_CLAIMANT,
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
        observed_entries: [],
        attestations: [],
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

    it("binds a journal entry commitment to the authority's identity, journal, chain position, and outcome", () => {
      const entry = AUTHORITY.observed_entries[0];
      expect(entry.entry_commitment).toMatch(/^nec1:[0-9a-f]{16}$/);
      expect(entry.previous_commitment).toBe(neutralJournalGenesis(AUTHORITY));
      expect(neutralReceiptReference(AUTHORITY, entry)).toBe(
        `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#1@${entry.entry_commitment}`
      );
      // Deterministic: the same inputs always commit to the same digest.
      expect(neutralJournalEntryCommitment(AUTHORITY, entry.previous_commitment, entry)).toBe(
        entry.entry_commitment
      );
      // …and every axis of the binding changes it.
      const otherSource = authorityFor({
        ...BASE_IDENTITY,
        source_commit: "e9dd73fcffea95ab33277a60d113262aac3379f2",
      });
      const otherJournal = authorityFor(BASE_IDENTITY, {}, defaultRecords(), "jrn-run-2");
      for (const other of [
        otherSource.observed_entries[0].entry_commitment,
        otherJournal.observed_entries[0].entry_commitment,
        neutralJournalEntryCommitment(AUTHORITY, entry.previous_commitment, { ...entry, sequence: 2 }),
        neutralJournalEntryCommitment(AUTHORITY, entry.previous_commitment, {
          ...entry,
          scenario_id: "MHRC-LIF-003",
        }),
        neutralJournalEntryCommitment(AUTHORITY, entry.previous_commitment, {
          ...entry,
          disposition: "refused",
          reason_code: "gate_unsatisfied",
        }),
        neutralJournalEntryCommitment(AUTHORITY, entry.previous_commitment, {
          ...entry,
          outcome_type: "guild.policy_outcome.v1",
        }),
        // The CHAIN position itself is bound: same entry, different predecessor.
        neutralJournalEntryCommitment(AUTHORITY, "nec1:0000000000000000", entry),
      ]) {
        expect(other).not.toBe(entry.entry_commitment);
      }
    });

    it.each([
      [
        "a reference into a journal the verifier never observed",
        (r: NeutralScenarioResult, i: number) => {
          const other = authorityFor(BASE_IDENTITY, {}, defaultRecords(), "other-journal");
          return { ...r, receipt_ref: neutralReceiptReference(other, other.observed_entries[i]) };
        },
        "foreign_journal",
      ],
      [
        "a sequence outside the observed range",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-001"
            ? {
                ...r,
                receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#99@${AUTHORITY.observed_entries[i].entry_commitment}`,
              }
            : r,
        "sequence_outside_observed_range",
      ],
      [
        "a commitment transplanted from another scenario's entry",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-003"
            ? {
                ...r,
                receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#${i + 1}@${AUTHORITY.observed_entries[3].entry_commitment}`,
              }
            : r,
        "commitment_is_not_the_journal_entry_commitment",
      ],
      [
        "a commitment minted by the CLAIMANT instead of read off the journal",
        (r: NeutralScenarioResult, i: number) =>
          r.stable_id === "MHRC-LIF-001"
            ? { ...r, receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#${i + 1}@nec1:abcdef0123456789` }
            : r,
        "commitment_is_not_the_journal_entry_commitment",
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
        receipt_ref: neutralReceiptReference(authority, authority.observed_entries[4 - i]),
      }));
      const outcome = decide(evidenceFor(authority, { results: descending }), authority);
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

  // -------------------------------------------------------------------------
  // MH-02-R4-B02 — the authority must CARRY the journal, not name it
  //
  // Round 4's `NeutralConformanceAuthority` held an identity, a journal id, and a
  // numeric range. No entries, no per-sequence commitments, no digest, no
  // signature. With one set of facts the decision could only RECOMPUTE each
  // commitment from the claimant's own result and check it matched the
  // claimant's own reference — two derivations of the same thing.
  //
  // So the reviewer supplied entirely fabricated but accepted-shape values —
  // source `aaaa…`, package `sha256:bbbb…`, runtime `guild-2.999.999`, adapter
  // `guild.host_adapter.v999.999.999`, host `claude-code-cli@999.999.999`,
  // platform `darwin-arm64`, release `rel-2026-07-26-forged`, journal
  // `forged-journal` 101..105, five self-generated references — and got
  // `succeeded` with `may_promote_conformant: true`. Reproduced on the base:
  // 17 of 21 forgeries promoted, including one where the authority and the
  // package were literally the same object graph.
  //
  // The inversion: commitments are TRANSPORTED by the journal and the package is
  // checked against them; the chain must verify to one root; that root needs a
  // quorum of distinct recognized attestors; and the claimant must be none of
  // them.
  //
  // Round 5 then conceded — in a PASSING test — that a party supplying all of it
  // at once still promoted, because every value being compared was a
  // deterministic function of public inputs. MH-02-R5-B01 is that concession
  // rejected: the attestations must now VERIFY against keys the core pins, and
  // the second half of this block is the proof that they do and that a
  // self-supplying party cannot produce one.
  // -------------------------------------------------------------------------

  describe("MH-02-R4-B02 + MH-02-R5-B01 promotion requires a carried, chained, independently attested journal", () => {
    /** The reviewer's forged identity, field for field — every shape accepted. */
    const FORGED_IDENTITY: NeutralEvidenceIdentity = {
      source_commit: "a".repeat(40),
      package_hash: `sha256:${"b".repeat(64)}`,
      runtime_version: "guild-2.999.999",
      adapter_version: "guild.host_adapter.v999.999.999",
      host_id: "claude-code-cli",
      host_version: "999.999.999",
      platform: "darwin-arm64",
      contract_version: 1,
      scenario_suite_id: NEUTRAL_SCENARIO_SUITE_ID,
      scenario_suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
      release_id: "rel-2026-07-26-forged",
    };

    it("refuses the reviewer's exact round-4 forgery: fabricated identity, self-generated commitments", () => {
      const authority = authorityFor(FORGED_IDENTITY, {}, defaultRecords(), "forged-journal", 101);
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.disposition).toBe("refused");
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it("refuses an authority in the ROUND-4 SHAPE — a journal named but not carried", () => {
      const honest = authorityFor();
      const named = { ...honest, observed_entries: [], attestations: [] };
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), named);
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_evidence_authority_missing");
    });

    /** Every structural attack on the carried journal. */
    it.each([
      [
        "a gap in the observed range",
        (a: NeutralConformanceAuthority) => ({ ...a, observed_entries: a.observed_entries.slice(0, 4) }),
        "scenario_journal_chain_unverified",
      ],
      [
        "an entry edited in place (the chain must break downstream)",
        (a: NeutralConformanceAuthority) => {
          const entries = [...a.observed_entries];
          // index 1 is MHRC-LIF-002, recorded `refused`; flipping it is a REAL edit.
          entries[1] = { ...entries[1], disposition: "succeeded", reason_code: null };
          return { ...a, observed_entries: entries };
        },
        "scenario_journal_chain_unverified",
      ],
      [
        "entries re-ordered without re-chaining",
        (a: NeutralConformanceAuthority) => {
          const entries = [...a.observed_entries];
          const swapped = [entries[1], entries[0], ...entries.slice(2)];
          return { ...a, observed_entries: swapped };
        },
        "scenario_journal_chain_unverified",
      ],
      [
        "an entry appended past the attested root",
        (a: NeutralConformanceAuthority) => ({
          ...a,
          receipt_sequence_range: { first: 1, last: 6 },
          observed_entries: [...a.observed_entries, { ...a.observed_entries[4], sequence: 6 }],
        }),
        "scenario_journal_chain_unverified",
      ],
    ])("refuses %s", (_label, mutate, reason) => {
      const honest = authorityFor();
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), mutate(honest));
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([_label, reason]);
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    /** Every attack on the attestor quorum. */
    it.each([
      ["a quorum of one", ["guild.release-attestor"]],
      ["two attestations from the SAME attestor", ["guild.release-attestor", "guild.release-attestor"]],
      ["an attestor the core does not recognize", ["guild.release-attestor", "acme.self-notary"]],
      ["no attestor the core recognizes at all", ["acme.self-notary", "acme.other-notary"]],
    ])("refuses %s", (_label, attestors) => {
      const authority = authorityFor(BASE_IDENTITY, {}, defaultRecords(), "jrn-run-1", 1, attestors);
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([
        _label,
        "scenario_journal_attestation_insufficient",
      ]);
    });

    it("refuses an attestation lifted from another journal with the same shape", () => {
      const honest = authorityFor();
      const other = authorityFor(BASE_IDENTITY, {}, defaultRecords(), "jrn-run-2");
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), {
        ...honest,
        attestations: other.attestations,
      });
      expect(outcome.reason_code).toBe("scenario_journal_attestation_insufficient");
      expect(
        (outcome.facts.attestation_faults as Array<{ reason: string }>).some(
          (fault) => fault.reason === "attested_root_mismatch"
        )
      ).toBe(true);
    });

    it("refuses an attestation whose reference was not bound to this identity", () => {
      const honest = authorityFor();
      const tampered: NeutralJournalAttestation[] = honest.attestations.map((a) => ({
        ...a,
        attestation_ref: `${NEUTRAL_ATTESTATION_REF_SCHEMA}:${a.attestor_id}@nad1:${"0123456789abcdef".repeat(4)}`,
      }));
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), {
        ...honest,
        attestations: tampered,
      });
      expect(outcome.reason_code).toBe("scenario_journal_attestation_insufficient");
      expect(
        (outcome.facts.attestation_faults as Array<{ reason: string }>).some(
          (fault) => fault.reason === "attestation_reference_unbound"
        )
      ).toBe(true);
    });

    /** Separation of duties. */
    it.each([
      ["a claimant that attests its own journal", "guild.release-attestor"],
      ["a claimant that is any recognized attestor", "guild.distribution-notary"],
      ["an anonymous claimant", undefined],
      ["a claimant id that is not an identifier", "x"],
    ])("refuses %s", (_label, claimantId) => {
      const authority = authorityFor();
      const pkg = { ...evidenceFor(authority), claimant_id: claimantId as unknown as string };
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.reason_code]).toEqual([_label, "scenario_claimant_not_independent"]);
    });

    /** The receipt inversion itself. */
    it("refuses a commitment the CLAIMANT derived instead of one the journal wrote", () => {
      const authority = authorityFor();
      const pkg = evidenceFor(authority, {}, (r, i) => ({
        ...r,
        // Canonical shape, right journal, right sequence — and a digest that is
        // not the entry's. This is exactly what round 4 accepted.
        receipt_ref: `${NEUTRAL_RECEIPT_REF_SCHEMA}:jrn-run-1#${i + 1}@nec1:fedcba9876543210`,
      }));
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.reason_code).toBe("scenario_receipt_binding_unverified");
      expect(
        (outcome.facts.unbound_receipt_references as Array<{ reason: string }>).every(
          (entry) => entry.reason === "commitment_is_not_the_journal_entry_commitment"
        )
      ).toBe(true);
    });

    it("refuses a claimed result that contradicts what the journal recorded", () => {
      const authority = authorityFor();
      // The journal recorded MHRC-LIF-002 as `refused`; the package claims a pass
      // while still citing that entry's own commitment.
      const pkg = evidenceFor(authority, {}, (r) =>
        r.stable_id === "MHRC-LIF-002" ? { ...r, disposition: "succeeded", reason_code: null } : r
      );
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.reason_code).toBe("scenario_receipt_binding_unverified");
      const faults = outcome.facts.unbound_receipt_references as Array<{
        reason: string;
        contradictions?: Array<{ field: string }>;
      }>;
      const contradiction = faults.find(
        (fault) => fault.reason === "claimed_result_contradicts_the_journal_entry"
      );
      expect(contradiction?.contradictions?.map((c) => c.field)).toEqual([
        "disposition",
        "reason_code",
      ]);
    });

    it("pins the adapter major, so a shape-valid adapter from an unknown contract fails", () => {
      const authority = authorityFor({
        ...BASE_IDENTITY,
        adapter_version: "guild.host_adapter.v999.999.999",
      });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.reason_code).toBe("scenario_source_identity_unrecognized");
      expect(NEUTRAL_RECOGNIZED_ADAPTER_MAJOR).toBe(1);
    });

    it("pins the closed attestor vocabulary and the quorum", () => {
      expect(NEUTRAL_MINIMUM_ATTESTOR_QUORUM).toBe(2);
      expect(NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS).toContain("guild.release-attestor");
      expect(NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS).not.toContain("acme.self-notary");
    });

    // -----------------------------------------------------------------------
    // MH-02-R5-B01 — the trust root
    //
    // Round 5's answer to "a bundle checked only against itself proves nothing"
    // was to add a second object and require the two to agree in more places. The
    // reviewer's reply was the only one available: if one party writes both
    // objects, agreement between them is still self-agreement, no matter how many
    // fields it spans. Every check up to here compares claimant-supplied values;
    // the checks below compare a claimant-supplied value against a key the CORE
    // pins, which is the only asymmetry that can make promotion unsatisfiable.
    // -----------------------------------------------------------------------

    /**
     * THE RESIDUE IS CLOSED, NOT DOCUMENTED (MH-02-R5-B01).
     *
     * Round 5 shipped this exact bundle as a PASSING test called "documents the
     * residue", on the argument that a pure core cannot import `crypto` and
     * therefore cannot tell a real attestation from a fabricated one. The first
     * half is true; the second does not follow. IMPORTING a verifier and BEING
     * one are different acts, and verification is pure arithmetic over a key the
     * core pins — so the core can refuse this, and now does.
     *
     * This is the same bundle, built the same way, by a party that controls the
     * package, the journal, every commitment, the attestor names, the claimant
     * name, and the authority object itself. Everything it can choose, it has
     * chosen well: the identity is plausible and recognized, the chain verifies,
     * the range is covered, the receipt references cite the entries' own
     * commitments, the claimant is none of the attestors. It is refused anyway,
     * on the one input it does not hold.
     */
    it("refuses a wholly self-supplied bundle: one party cannot mint the attestations", () => {
      const plausible: NeutralEvidenceIdentity = {
        ...FORGED_IDENTITY,
        runtime_version: "guild-2.2.0",
        adapter_version: "guild.host_adapter.v1.0.0",
        host_version: "2.2.0",
      };
      const authority = authorityFor(plausible, {}, defaultRecords(), "jrn-fabricated");
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_attestation_signature_unverified");
      expect(outcome.facts.may_promote_conformant).toBe(false);
      // It got ALL the way to the trust root: every structural gate passed, and
      // both attestors were accepted as recognized, distinct, root-bound parties.
      expect(outcome.facts.structurally_accepted_attestors).toEqual(DEFAULT_ATTESTORS);
      expect(outcome.facts.verified_attestors).toEqual([]);
      expect(
        (outcome.facts.signature_faults as Array<{ reason: string }>).map((f) => f.reason)
      ).toEqual([
        "attestation_signature_did_not_verify",
        "attestation_signature_did_not_verify",
      ]);
    });

    /**
     * The same party, trying harder. None of these is a shape error — each is a
     * different theory of how to satisfy a verifier you cannot sign for.
     */
    it.each([
      [
        "signatures transplanted from the honest bundle",
        (fabricated: NeutralConformanceAuthority) => ({
          ...fabricated,
          attestations: fabricated.attestations.map((attestation, index) => ({
            ...attestation,
            attestation_signature: authorityFor().attestations[index].attestation_signature,
          })),
        }),
      ],
      [
        "an all-zero signature",
        (fabricated: NeutralConformanceAuthority) => ({
          ...fabricated,
          attestations: fabricated.attestations.map((attestation) => ({
            ...attestation,
            attestation_signature: `nws1:00:${"0".repeat(64 * 67)}:${"0".repeat(64 * 4)}`,
          })),
        }),
      ],
      [
        "a signature whose authentication path is the pinned root repeated",
        (fabricated: NeutralConformanceAuthority) => ({
          ...fabricated,
          attestations: fabricated.attestations.map((attestation) => ({
            ...attestation,
            attestation_signature: `nws1:00:${"0".repeat(64 * 67)}:${(
              neutralAttestorVerificationKey(attestation.attestor_id) as string
            ).repeat(4)}`,
          })),
        }),
      ],
      [
        "one honest attestor named twice with its one real signature",
        (fabricated: NeutralConformanceAuthority) => {
          const real = authorityFor().attestations[0];
          return {
            ...fabricated,
            attestations: [real, { ...real, attestor_id: "guild.distribution-notary" }],
          };
        },
      ],
    ])("refuses %s", (_label, mutate) => {
      const plausible: NeutralEvidenceIdentity = {
        ...FORGED_IDENTITY,
        runtime_version: "guild-2.2.0",
        adapter_version: "guild.host_adapter.v1.0.0",
        host_version: "2.2.0",
      };
      const fabricated = authorityFor(plausible, {}, defaultRecords(), "jrn-fabricated");
      const outcome = evaluateNeutralConformanceDecision(
        evidenceFor(fabricated),
        mutate(fabricated)
      );
      expect([_label, outcome.disposition]).toEqual([_label, "refused"]);
      expect([_label, outcome.facts.may_promote_conformant]).toEqual([_label, false]);
    });

    /**
     * The trust root is pinned by the CORE, not supplied with the evidence, so
     * there is no input that can stand in for it.
     */
    it("pins the trust root in the core and derives recognition from it", () => {
      expect(NEUTRAL_ATTESTOR_TRUST_ROOT.map((key) => key.attestor_id)).toEqual([
        ...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS,
      ]);
      const roots = new Set<string>();
      for (const key of NEUTRAL_ATTESTOR_TRUST_ROOT) {
        expect(key.verification_root).toMatch(/^[0-9a-f]{64}$/);
        expect(key.verification_root).not.toBe("0".repeat(64));
        expect(neutralAttestorVerificationKey(key.attestor_id)).toBe(key.verification_root);
        roots.add(key.verification_root);
      }
      // Distinct roots: one compromised attestor must not be all of them.
      expect(roots.size).toBe(NEUTRAL_ATTESTOR_TRUST_ROOT.length);
      expect(neutralAttestorVerificationKey("acme.self-notary")).toBeNull();
      expect(Object.isFrozen(NEUTRAL_ATTESTOR_TRUST_ROOT)).toBe(true);
      // The authority record has no key field to override, and a decision takes
      // exactly the package and the authority — there is no third parameter, so
      // there is no input position a caller could put a trust root into.
      expect(Object.keys(authorityFor())).not.toContain("trust_root");
      expect(Object.keys(authorityFor().attestations[0]).sort()).toEqual([
        "attestation_ref",
        "attestation_signature",
        "attested_entry_count",
        "attested_journal_root",
        "attestor_id",
      ]);
      expect(evaluateNeutralConformanceDecision).toHaveLength(2);
    });

    /**
     * The scheme's shape, pinned. A reviewer can read the whole trust
     * relationship off these five numbers: 67 Winternitz chains of length 16 over
     * a 256-bit digest, under a Merkle tree of height 4.
     */
    it("pins the attestation scheme parameters", () => {
      expect(NEUTRAL_ATTESTATION_SCHEME).toBe("guild.wots_merkle.v1");
      expect(NEUTRAL_ATTESTATION_CHAIN_LENGTH).toBe(16);
      expect(NEUTRAL_ATTESTATION_MESSAGE_CHAINS).toBe(64);
      expect(NEUTRAL_ATTESTATION_CHECKSUM_CHAINS).toBe(3);
      expect(NEUTRAL_ATTESTATION_CHAINS).toBe(67);
      expect(NEUTRAL_ATTESTATION_TREE_HEIGHT).toBe(4);
      // 3 checksum symbols in base 16 must cover the largest possible checksum.
      expect(Math.pow(16, NEUTRAL_ATTESTATION_CHECKSUM_CHAINS)).toBeGreaterThan(
        NEUTRAL_ATTESTATION_MESSAGE_CHAINS * (NEUTRAL_ATTESTATION_CHAIN_LENGTH - 1)
      );
      // The signature carries one value per chain plus the authentication path.
      const signature = authorityFor().attestations[0].attestation_signature;
      expect(signature).toMatch(/^nws1:[0-9a-f]{2}:[0-9a-f]{4288}:[0-9a-f]{256}$/);
    });

    /** The verifier itself: live on real signatures, closed on everything else. */
    it("verifies a real attestation and rejects every perturbation of it", () => {
      const honest = authorityFor();
      const attestation = honest.attestations[0];
      const digest = neutralAttestationDigest(honest, attestation);
      const key = neutralAttestorVerificationKey(attestation.attestor_id) as string;
      expect(neutralAttestationVerifies(honest, attestation)).toBe(true);
      expect(neutralVerifyAttestationSignature(key, digest, attestation.attestation_signature)).toBe(
        true
      );
      const signature = attestation.attestation_signature;
      const flip = (at: number): string =>
        `${signature.slice(0, at)}${signature.charAt(at) === "0" ? "1" : "0"}${signature.slice(at + 1)}`;
      // One flipped hex character anywhere — first chain, a middle chain, the
      // checksum chains, the authentication path — is a refusal, not a warning.
      for (const at of [8, 1000, 4200, 4340, 4500]) {
        expect([at, neutralVerifyAttestationSignature(key, digest, flip(at))]).toEqual([at, false]);
      }
      // The key index is signed into the message, so re-labelling it fails.
      expect(
        neutralVerifyAttestationSignature(key, digest, `nws1:03${signature.slice(8)}`)
      ).toBe(false);
      // A different digest, and a different attestor's root, each verify nothing.
      expect(neutralVerifyAttestationSignature(key, `nad1:${"0".repeat(64)}`, signature)).toBe(false);
      expect(
        neutralVerifyAttestationSignature(
          neutralAttestorVerificationKey("guild.distribution-notary") as string,
          digest,
          signature
        )
      ).toBe(false);
      for (const malformed of [
        "",
        "nws1:",
        UNSIGNED,
        signature.slice(0, signature.length - 1),
        `${signature}0`,
        signature.replace("nws1:", "nas1:"),
        signature.replace(/^nws1:[0-9a-f]{2}:/, "nws1:0g:"),
        null,
        undefined,
        42,
      ]) {
        expect([
          typeof malformed === "string" ? malformed.slice(0, 12) : malformed,
          neutralVerifyAttestationSignature(key, digest, malformed),
        ]).toEqual([typeof malformed === "string" ? malformed.slice(0, 12) : malformed, false]);
      }
      // A root that is not a 256-bit digest is not a root.
      expect(neutralVerifyAttestationSignature("01", digest, signature)).toBe(false);
      expect(neutralVerifyAttestationSignature("0".repeat(64), digest, signature)).toBe(false);
    });

    /**
     * The signature is bound to the whole tuple, so a real attestation cannot be
     * carried onto a bundle its attestor never saw. Each mutation below leaves an
     * otherwise-honest authority and only moves the signed statement.
     */
    it.each([
      ["a different journal id", (a: NeutralConformanceAuthority) => ({ ...a, receipt_journal_id: "jrn-run-9" })],
      [
        "a different observed range",
        (a: NeutralConformanceAuthority) => ({
          ...a,
          receipt_sequence_range: { first: 1, last: 4 },
        }),
      ],
      [
        "a different attested entry count",
        (a: NeutralConformanceAuthority) => ({
          ...a,
          attestations: a.attestations.map((x) => ({ ...x, attested_entry_count: 4 })),
        }),
      ],
      [
        "a different release identity",
        (a: NeutralConformanceAuthority) => ({
          ...a,
          identity: { ...a.identity, release_id: "rel-2026-07-26-b" },
        }),
      ],
    ])("a real signature does not carry over to %s", (_label, mutate) => {
      const honest = authorityFor();
      const moved = mutate(honest);
      expect([_label, neutralAttestationVerifies(moved, moved.attestations[0])]).toEqual([
        _label,
        false,
      ]);
    });

    /**
     * ONE real attestor, repeated, is one attestor.
     *
     * The structural gate drops a duplicate from the accepted set but leaves it in
     * the list, so a quorum counted over the LIST rather than over distinct
     * parties would let a single genuine signature, pasted twice, stand in for the
     * two independent observers the quorum exists to require.
     */
    it("refuses one real attestation repeated beside an unverified second party", () => {
      const honest = authorityFor();
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), {
        ...honest,
        attestations: [
          honest.attestations[0],
          honest.attestations[0],
          { ...honest.attestations[1], attestation_signature: UNSIGNED },
        ],
      });
      expect(outcome.reason_code).toBe("scenario_attestation_signature_unverified");
      expect(outcome.facts.verified_attestors).toEqual(["guild.release-attestor"]);
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    /** A quorum of one VERIFIED attestation is still not a quorum. */
    it("refuses when only one of the two attestations verifies", () => {
      const honest = authorityFor();
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), {
        ...honest,
        attestations: [
          honest.attestations[0],
          { ...honest.attestations[1], attestation_signature: UNSIGNED },
        ],
      });
      expect(outcome.reason_code).toBe("scenario_attestation_signature_unverified");
      expect(outcome.facts.verified_attestors).toEqual(["guild.release-attestor"]);
    });

    /** An attestation that does not even carry a signature field is malformed. */
    it("refuses an authority whose attestations carry no signature at all", () => {
      const honest = authorityFor();
      const stripped = honest.attestations.map((attestation) => {
        const copy: Record<string, unknown> = { ...attestation };
        delete copy.attestation_signature;
        return copy as unknown as NeutralJournalAttestation;
      });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(honest), {
        ...honest,
        attestations: stripped,
      });
      expect(outcome.reason_code).toBe("scenario_evidence_authority_missing");
    });

    /** NON-VACUITY for the trust root: a three-attestor honest bundle promotes. */
    it("promotes an honestly attested bundle, including with the full attestor set", () => {
      const all = authorityFor(BASE_IDENTITY, {}, defaultRecords(), "jrn-run-1", 1, [
        ...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS,
      ]);
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(all), all);
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.facts.may_promote_conformant).toBe(true);
      expect(outcome.facts.verified_attestors).toEqual([...NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS]);
      // The verdict names the scheme it was reached under, so a consumer can
      // tell WHICH trust root and which construction backed the promotion.
      expect(outcome.facts.attestation_scheme).toBe(NEUTRAL_ATTESTATION_SCHEME);
    });

    /** NON-VACUITY for this whole block. */
    it("still promotes an honest package against a carried, chained, attested journal", () => {
      const authority = authorityFor();
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.disposition).toBe("succeeded");
      expect(outcome.reason_code).toBeNull();
      expect(outcome.facts.may_promote_conformant).toBe(true);
      expect(outcome.facts.journal_entry_count).toBe(5);
      expect(outcome.facts.journal_root).toBe(
        authority.observed_entries[4].entry_commitment
      );
      expect(outcome.facts.attesting_parties).toEqual([
        "guild.release-attestor",
        "guild.host-conformance-witness",
      ]);
      expect(outcome.facts.verified_attestors).toEqual([
        "guild.release-attestor",
        "guild.host-conformance-witness",
      ]);
      expect(outcome.facts.claimant_id).toBe(DEFAULT_CLAIMANT);
    });
  });
});

// ---------------------------------------------------------------------------
// FIC-110 B3 — the A21-S assembly spine belongs to the AUTHORITATIVE closure
// ---------------------------------------------------------------------------

/**
 * `neutral-conformance-assembly.ts` declares itself a host-neutral core member in
 * its own header, and its focused suite proves closure with a LOCAL regex/import
 * allowlist. That is a second, private rail. The production rail is
 * `NEUTRAL_CORE_MEMBERS` + `evaluateNeutralCoreBoundary`, and the assembler is
 * absent from it — so the 298-test closure suite never scans the module, and any
 * future boundary drift inside it passes the main rail untouched.
 *
 * These three assertions are the RED contract for that omission. They do NOT edit
 * the membership list: they require it to name the file, require the production
 * evaluator to consume the file's ACTUAL bytes, and require that membership to be
 * load-bearing rather than nominal.
 */
const ASSEMBLY_CORE_MEMBER = "neutral-conformance-assembly.ts";

describe("FIC-110 B3 — the assembly spine is inside the production closure rail", () => {
  it("declares the assembly spine in the authoritative core membership", () => {
    expect(fs.existsSync(path.join(CORE_DIR, ASSEMBLY_CORE_MEMBER))).toBe(true);
    expect([...NEUTRAL_CORE_MEMBERS]).toContain(ASSEMBLY_CORE_MEMBER);
  });

  it("scans the spine's real bytes through the production evaluator, not a local allowlist", () => {
    const files = readCoreFiles();
    const scanned = files.find((file) => file.path === ASSEMBLY_CORE_MEMBER);
    expect(scanned).toBeDefined();
    // The bytes the rail reads are the bytes on disk — not a fixture, not a slice.
    expect((scanned as { source: string }).source).toBe(
      fs.readFileSync(path.join(CORE_DIR, ASSEMBLY_CORE_MEMBER), "utf8")
    );

    const outcome = evaluateNeutralCoreBoundary(files);
    expect(outcome.disposition).toBe("succeeded");
    expect(outcome.facts.declared_members).toContain(ASSEMBLY_CORE_MEMBER);
    expect(outcome.facts.node_count).toBe(NEUTRAL_CORE_MEMBERS.length);

    // The evaluator actually resolved the spine's own edges, so the file was read
    // as a NODE of the closure rather than merely listed by it.
    const spineEdges = (outcome.facts.intra_core_edges as Array<{ importer: string; specifier: string }>)
      .filter((edge) => edge.importer === ASSEMBLY_CORE_MEMBER)
      .map((edge) => edge.specifier)
      .sort();
    expect(spineEdges).toEqual(["./neutral-conformance-core", "./neutral-runtime-contracts"]);
  });

  /** NON-VACUITY: membership must be load-bearing, not a name on a list. */
  it("fails the production rail when a forbidden edge is planted in the spine's slot", () => {
    const files = readCoreFiles().map((file) =>
      file.path === ASSEMBLY_CORE_MEMBER
        ? { path: file.path, source: `${file.source}\nimport probe from "fs";` }
        : file
    );
    const outcome = evaluateNeutralCoreBoundary(files);
    expect(outcome.disposition).toBe("failed");
    expect(outcome.reason_code).toBe("boundary_forbidden_edge");
    expect(
      (outcome.facts.forbidden_edges as Array<{ importer: string; specifier: string }>).some(
        (edge) => edge.importer === ASSEMBLY_CORE_MEMBER && edge.specifier === "fs"
      )
    ).toBe(true);
  });
});
