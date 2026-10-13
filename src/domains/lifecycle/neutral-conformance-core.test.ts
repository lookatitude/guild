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

import { describe, it, expect } from "bun:test";
import * as fs from "fs";
import * as path from "path";

import { NEUTRAL_CORE_MEMBERS, NEUTRAL_FORBIDDEN_BOUNDARY_MATCHERS, NEUTRAL_PURE_INTRINSIC_ROOTS, analyzeNeutralCapabilityUse, evaluateNeutralCoreBoundary, extractNeutralImportSpecifiers, tokenizeNeutralSource } from ".";

import { NEUTRAL_ATTESTATION_CHAIN_LENGTH, NEUTRAL_ATTESTATION_CHAINS, NEUTRAL_ATTESTATION_CHECKSUM_CHAINS, NEUTRAL_ATTESTATION_MESSAGE_CHAINS, NEUTRAL_ATTESTATION_REF_SCHEMA, NEUTRAL_ATTESTATION_SCHEME, NEUTRAL_ATTESTATION_TREE_HEIGHT, NEUTRAL_ATTESTOR_TRUST_ROOT, NEUTRAL_CONFORMANCE_AUTHORITY_SCHEMA, NEUTRAL_CORE_SCENARIOS, NEUTRAL_CORE_WAVE_OWNER, NEUTRAL_EVIDENCE_IDENTITY_FIELDS, NEUTRAL_EVIDENCE_PROFILES, NEUTRAL_MINIMUM_ATTESTOR_QUORUM, NEUTRAL_RECEIPT_REF_SCHEMA, NEUTRAL_RECOGNIZED_ADAPTER_MAJOR, NEUTRAL_RECOGNIZED_HOST_IDS, NEUTRAL_RECOGNIZED_JOURNAL_ATTESTORS, NEUTRAL_RECOGNIZED_PLATFORMS, NEUTRAL_RECOGNIZED_RUNTIME_MAJOR, NEUTRAL_RECOGNIZED_RUNTIME_MAJORS, NEUTRAL_FULL_SUITE_SCENARIO_IDS, NEUTRAL_FULL_SUITE_EXPECTED_OUTCOME_TYPES, NEUTRAL_FULL_SUITE_EXPECTED_DISPOSITIONS, NEUTRAL_REQUIRED_CORE_SCENARIO_IDS, NEUTRAL_SCENARIO_SUITE_ID, NEUTRAL_SCENARIO_SUITE_VERSION, NEUTRAL_SUPPORT_TRANSITIONS, NEUTRAL_UNEVALUATED_SUPPORT, applyNeutralSupportTransition, deriveNeutralSupportClaim, evaluateNeutralConformanceDecision, neutralAttestationDigest, neutralAttestationReference, neutralAttestationVerifies, neutralAttestorVerificationKey, neutralJournalEntryCommitment, neutralJournalGenesis, neutralReceiptReference, neutralVerifyAttestationSignature, validateNeutralScenarioRegistry } from ".";
import type { NeutralConformanceAuthority, NeutralConformanceEvidence, NeutralEvidenceFreshnessVerdict, NeutralEvidenceIdentity, NeutralJournalAttestation, NeutralReceiptJournalEntry, NeutralScenarioResult, NeutralSupportRecord } from ".";

import { NEUTRAL_LIFECYCLE_PHASES } from ".";

const CORE_DIR = path.resolve(__dirname);

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
  // The MH-02 suites are colocated with the core they cover.
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
        label: `tests/${file}`,
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
      expect(root.startsWith(path.resolve(__dirname, "../../.."))).toBe(true);
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
    // honest bundle A — BASE_IDENTITY, jrn-run-1 #1..5, one-time key 2
    "nad1:96a0b9ccc13e6be41163e4fcdddadef4abf5803cfe82cd7d8117502f3b8c7e70":
      "nws1:02:d8794a727cc3dacff0ae960112b8a5e9edf8a558e372c04dbfc6a7fcc4a094eb9cba6c4fbbd1197dd63f50e98b5c9e113fc2316ff6cfcd3af898c126ef4429dbe0bcf40d9e151d9d71de84296a682835dabea1624828345f8977cf97ef4eae2752148b6a081318e04e15da246fd25e2e222848579264b7c2a10df83a0379397c510092f55a755f20e72cd036f81553e8424099d621fc92282d0e83e240fc2e7f32ed6d34877e190e78a0fc01387dc149988b549bbfd8195cbc508f591cb756afd2315178583654876dd8c507c15dc401f58a3f431847eaa11dbbc8d0a8473d94fded49a92534a21ff71b4871fdc26f5b8bf4a4eac5a778346b3c81456ec6fd530a7b4e59c35ff1b1fc53465ed70f2c885840d0e88d9e679dc90de685c95d9fa937b5ae665765aa56b6561e035765a3e3565c4f4b037357995c82c67f85e490665c178e6385d6f3143780a4d45bcc1e4a46299a915557c124dd81df4abf02f645e5468548e322928c71813123b83e65d6318885b51694961e684c2ba16b201ecf4f59ff9a67a370931ce52b24bc32e11555b7ae6073dd5f0a86c10ef483ccf294ab6ab3393f8e4842e27e9f573353a6f8604357c682b5870f383e73d2da113a4aaa27959423f6da5b3e6882b72691ee3137b142e6647ea54e8f6c6b141c7bdc946f893181ace9fe0693ba3867c363f8d84477d73e201d04fb04d4dac4effae0c330bf6712e40613a19b7080b3e066c746e0d14377dc0b27585ec08294f0749fa79ed1ee247e47472ad87e27f4e90de573b2bcafec4fc58d4c6eb9fbd8da23dbd95adb8c6a4deef8cc3a204b775ea7f7968a97a4e38d7d7c351ad5fcc1544866aa7eac6ec28acebe9323184ce1bc965f62971f2cbf5d2ba0cc7c7e5e4e9d4d6050b4d22fdcad19543f5807a78cd2dcd33cafbce884c480db4b3accfa8edf77fca2417c02682257c4e3498be4f775f869c4a8fc84b31255262adc726b07c1eff5c7275b229e6a55aa8ec50aceb8ffb731bdae34e53246c0be015b24cce24a6a99c559c9baa3a4d075bce591d806d780a96d5407e0c315e9fc6f2dfdf70224eaea55bfcfe09af2758025e9ecc54253b959d2fb32f7ef42c591665f5eded95e9b9977e9a111a4db34b569bac139b26ebe494015356a18e7df02ba8dd8bd8d6479157d648bbe6f3f404eec1249b45b6601226cc2f167e8029b675913a2fd82613db79c7db5d78e43d90e76d28d192097520ec231616cb5bc4cde907a3b71d1e40a0fb84789d697187975a25965fd13bea36630dfcd2a33c9d5e3e87dd7646dba22b70847a8d9bd3443343cc1f406b6c6ae899d5539bbc5906e5d21d7a71ba4ffb4631f0d75a4d8cda22c5d5c3661c1923e79a49897e9c4899a4483a6c458926690f5f32d161131cca7e351a977e0a22041b2a21c709ff2e1c7821693f350c17521c10312c47331c0033486b49eb98aee48c7b48961c3e2a5b7f3bba7fbb4e8698c23f2aeb74a8a7c3d0368196866f40f4cb49da1ea944c91e6a33da54ef65ed98d2bebdfb92f7715bcc8d95ca4027e6a4f53c8dd6bdd4b1cbb18440eafaccb1c367c7e9d4c1e5ead43cc469fea3f8b8391e4a57e632c5d888b6874e96887d935a1b6074877743d51cbc423d0f6b7bdb6a0d3a0ca2de045cc4a541047f389669bd5d1377e6442b54e3bbdb8da604b657c8bb7b0cace17b896742f346b1fc2e36aba6d7b5fad0425f9154aa69bc04043d489f8957dc763faa2cf0ad8e85c68a73a94cc000dc7194875e7629ec04b2d45ccbd93f4eeb59f1665c321b7abc03103da684a8270be111228ffbc51e65ab250cd195ae96302eda1418e7b29a77511bacf665faa6edff07929c1d27c765816b92f53095d1bc74338c6190e4aff9057447473a55ab9feb030fbcb3e40829fed6daf2d92c79f73bdcfd6520f6f12a72ef62960756e62c4187bac574934b44653d182ee07359c61fc34e803083f803a22712e7a5210b4c0e851d18cb8603a48060a07b01450875cdc20506817c0d6056f3091d2c19294ac84e088848e6000b9009751781eea452c410c1f174124cbefa771c211fec000d600c706a63c08600b323a5f955419801be03430148d121eb9fb1a25f0cda72e77bd5c43af12d72b7684829aa17831351da47f3f1b75a8a8b1f0072d3bbbb7a6abdb4000a327af1b426ec3bad8fb58376b4b1713aa37129435fe95407bb9d6ea13ead7caf03f51edfbbcbb5bea979adab451869ffd9c98bda6d165de22ad77d4bbbbe23212975fd6f5291f1ef17801ec2ce2f07f4ed16d920106bb2821619243bca05aaf054167fee2c38773687585e382c8182f93126a3e014a722718688367f77c9fa173e9ab0abd87986f64e9782f2f39352da9ebd1cde58bdeb67345bccafd6e8a1c65b94b2adab5bb19ef78bee711ca6b650bf92a85c5ed31fd1f6aec58307b3d00e5b4701877ef6d2468c7491d0496efacbf8606bfcfcfafd285708cea9da045fe47d619a654031d935bd877a0c44d5ada40e98b4eb4b5e92143b0d84014cd7cb1a27b65c993eaa3ee9b52b6534a77f68745f186ad93cb3abc694f8203d3e26f73394bcb29397ccfba99f5a58e816526c6040afb3ae1fa5d02ee41d1fe4d13722df765fb574ec86b5a90b3d21efbf9d67f985d53cef5f219e1395c3325d413eb6f90aadde6b7be612469fe5ae91f038b1687d8e3bc4524d716543540fae125cfb95dd5aebf32ef76d530360a138adb8010b9b58e9b360028a6149cf95c55751fd197c86da5ae47e95fe041482b4be3a6e43fe90c379772042cfdd08e219b7dccd7c0f61328dbfb9570cd9c3631a6e7391633955161f864d362d7aad55d5f87ea6df1221cd67486b2a8bfb0dcf1fa8ba41ca27c6fca3a0ea8d0e7b66adf3cc130eb61c0040e21e6e1c469a696f75546134780b85313f21070d705de92d393eee07199b2de998f5d110f7404ce640cbffc1dfaf04753b81b53f3eb9f58abb79fa01f743faae520d0c1249bc32682bfb738996f6cd29a417f054242a9eb:7fd7dc3f20527c87aa1f14302fea568f64982b06b867b444599d871d1424c54deb43cdc796b6f7c3052654c2a8ed0b9b1281c1619a79efd9de4c8b34b26ee25788f76873ee3bcdee5e408c35c9f0fd567f9d7fa35bfec6cc5adb2487650c82eec214cdcdc4f7deac90a5cbfa1b7132153469ecd2db58d6d5f742452952440077",
    "nad1:50ab827a3dd40563ff43ecc3c1b37cc45202f50f8f21ea7c721b2484cb4c3075":
      "nws1:02:34f21160b72e217dec0dea4df64b6932480c91f6604b9abde3a7f81cce149f12a39dbfe87544f27fda5e02e93abe7e48042b82b122ad89a185dc2b6a9655f32e056e4ba1ce7c451a9d0bf1e0b465d08c8c2b1df58f328457a5e7f56751e554aa1c904dac369b967a6a746631c4229b0be4cd53d67721e572ee95e25cc113377a03df9746919aeeb2e47e46cd3fe80cf2de244f1313fe8176d399f0a1163760163ced77642061d19091b23819701dbeec0937b49f5a0e0d6aa375f8d382c9b9ce18b1d071e55b18d38ba0cbb7b0edc5bffcb360d4a1ff49472f27d1eec92c8a98e33bc44e584bc5c5b33f65a0f6896f8b6481284e67075e5c7fd90210ba6ad1eaba298834a8dc25d73b06800358155bb3161fb9d22673089f8a132e08af4bccfc0d92bfc62f54db4b4f4ef0b18a68a586859da0044bc6c90a8643df8e556148d60454e5a351872ad0eda45d6a70a1a7dcc4c1a443710f561c2feb237ef3e6c5faf2d071616c98de08e615568e634bd90b7e51d1e40289fda70a66c3e41786ad727363f1a58e6c27291d611901289753aafde3691388562f67aec4f7df775c6563c8631c3410d0cbf55399e4c6226eb6440b166cd803b1e7fa8afefa2cf0acc833725f07b3c5ce9debc871b90cb380750d48dd4552a618850a15d83b267e2d09239582881338406a36b127efbf98cea2555d7a9e2f326f12382c5f88af948635a4953f43130494184bf18f425dcbb4cc8fee32c09dc623d393d32d68b453a23b81dec5c883aaca0c4b1ea267fefeeb5562ff1bdcddf4dd929d14930e9e758a09f6734d8090cfd89505cc363153483041a5b4a36b95cb1126278b947eb8278e11769902098c16c77310ff5272b234d9c5f14d3e03c92bcf86477e3bcffc87c0416f8d32851aa09c526dd572f1efbdd946657f0960daebb2fb323edcb248220ff3ad1459493e7fc150bca0ed3cea175f38a11f6f45934e600ef0fa7d3d375e02fcfadf1b0394f9d478c688b5dd6f3a21e4da57993732a6fd3db5d645eb8380cab60df1898c7bb0ba964e3661437a351a55bc9a52fb078de4ead8f37d75f0a9b04ecfe587ddef03a466da0ad8c704d98a0b50b12f3f35c5ca451d7ca19190d6e55138bfa05088c4eb96d25d9b7a42b19c17a81652e49bf74bdf242604458496da672f0a4d70220192391ec2dffe690bcd99a2aa6719aae205d568e2f5aa3dabd51b2410485149f8682debfcc8920e72c8365af7c2409e22b6c5e3aa98e4c7eab62f19048350449e4d1050cea5e6a232c9c686b4eac44e10d03110dc1f030043685f352dc0047ccbd2e688847da47297a723144395c05308cdd8c3974e63d0759963f3562fabe41adc85b31e8c3fd10dd13bd226095b062d4a671dcb678e2b5c170e28d4c6a8e2c8bffcf0c2f8c98cd4a25767b009f54ec7aecaecc4d3d0e2e2782cf872a0965b6b67f6d5faabacd325685284eeea3061228d42e98a96e7ce587f2575dbc0f0b534ff0e8d253efbd400c9560ab6390bb4169205cb2cd3b35185aacb9fbc70024a08bfb5f6f5ba1156eda702ccd30fea7282f0fc1a302616fcbc078e4f238c67003e939d39ca6241113282101d37433a7a26f124c0e9bad7b98d9d7b30408376a7ed2fc7f492e082118d4d88f1268ee08c071be601eada4ff6cc4af4dce600a20da401131ee8be7819ed804b0774efab48a812c3c326e01146ea446f69fa4c90b9fd61589dd35f37be5e340b1c6fb3d68ddec0621ab233d1ee6c9009cc28b4102b7afca1e56ce3fd18c606a8a412e7594468fede16513df43ab8267dc0510e2b80c52b93ca0a4a262c670a779ec8b174007f66889a753b71fa5fe71fbdbbe752fd6a9438ad192d77e415a755193fa6b249e7ee0be395b2cdce5b007c5cb87288fb2f271537aa37cd9eab54945d763e1c90d105dc4b7ed869be53b696dc1e3c82c520a0a7d4d3cc719a2806884bd454443f56aaefdcdab2928e1694afdde2b8fd41448f913d948a58d2e25fa0b12850c29c0c7039431e7c87a24c7f1da12a588f2d035098ece7565b60b4487e7a136577983d36f53f2d3a5204042868383e9d069d0ec58d1e76ba512367d1e35665ff0ae305a10c7acc2fc0a8df66252d116810dc65e0982d17aa9ca67e0b4ffefa2f429d1863b3d6926587b0b42b4eae10932ec699239f2d62877197075def990a30bc53b7d458a155563e750002c7a6c1390df987f03a41afa1c3e5baf0d7adbb0f8482b3eb5925069388798deca33b2dc454cd482ef90d831796a4951c835080546457e3fef4d5a6b827d2981699bc80a67bf2d1342ca7905c00f3af12e452d47aa3f4e4d2521f222fcc77dc0458c169f51df7bf0f89d108a9fa69206a9aef8d4fca37657922b545913c18215c8d66311cf81985bbbb934043b1107d10d5e3fb75ccc45387915b776eae5dd86afab05e29be36acbf54cd76ff431aec1ae2f38d27657997e6ad4ee121e6e02425b4ecbc2e612f1f8c3dba69918c7c62ee858748c5df7de7e312d7a22fe6e99d0cfd1a4ea03183ff383857be7886998754158507406615eb253a1064eb694f0ae3ce3bb0e12aab37d1906fde15b6c8869d9a9b29dbde7902a7b05a180a319f6b2778376a3c6ff1b83eecdb1cfb8482105d1381695d221a46eec1ce89822c0420e8eeec22f7c1debcf423783a560fb4f6467811339f63b4e617a79f541888d9276c11756968695fb0beb3387762f27f274c31112e7f9022cdb6023e1cc36bb1e5780d10fbacdb7a669a31c605022ce588626d039739b62454736c581fd4bd456065b46495216f577d7fdf6db174b8178090155095075360fa651e934b9a9cff3041531d8482fc50b44573eb75a4b0cc18d84d6b6ffdf0b547e09c18ada043d6387c0cb7e4c5033b3bc7e09fffdff731b1b138dfb13dc00d4c74fb04c1635b6d3f6ce397086d12b0423297e32f10818ebc6c261a4edadbde14ce87c3f0bbc2436522cba51592eba1cb8b5f350889da100333accf5a4c39ccda6615608ac2cfb98d6944ca:f7c573065d366ba7d22af88d1288e54a5d082671876e177bb735a4c758513f513718d74e030d494914c53cf9819bf4bd4b24e5de212651e684b3e0708a885c0ad132ec9e7b13b3909984fc7a49184c9f22c132e23a59a60d7f04b8ac578f3164497b5bf0a4cc6c1a80ec99c6b3ce6e0b5fe77e72955729cd5a5c4f75bde36990",
    "nad1:08ad11477ab0173c4cdfe36eb337f810cb398b60b98c517c4d899b9416a805e5":
      "nws1:02:f4cf937982f8ad35368f00fe96ffa1360cd74fe9825a0025b05a97d7186e41508a2a799073d3898f9eb152160fdfd9e3d7a4297a331c7a52d3b601c1c08e1b27efbc4dcbed3935ed753fb9f5b065c6d75d3a972e7999e8974ae1be5e75cc289f3ea24cb1536d4216b0db1510acbd477c5f1ab3251bbbc40e86377f83a445e83c4ce348c0fc4be5f05250c981ff0bda32c37bfcfa72c2fb5e423f9ad15d040b183fc7914746df84c1df44a54e2d27191ebf9617b6766250ef18d2cbaf3ac8cfdb757f5e9256fa2f80d2ed0b31b9f63551eac00336b1cf27c8b65efc6ffd6032192e63e48eb482af206bc6a4f48d1497936f380382ecf1fbceac266a77dc57cadf49a00da1035d5c55d2d117571c5d5f360dc721cf58c3d8f5294081bd8ddabcced8ab18c6e14aecf1c670cf5a89a1b41959d1d6e5da6231655e7d72af48ec4af4c3a1a7a03f5ccd5ed636c68d21a213277a1303afb74499d3418e4706d00755b119ccc12e7b514ab0e7e28eb2870ced8640075a853ac2968b3a3e8b63293bbe8e6798e730ca954e3b8a116988a1db89cc506ba945e1456203498e1de8f458cccf49c27730d4e21674c172152f3cc2fd56063b03339a8a05b47a8c51f2a236eff09d75d0eb0fbe417c129d5cb3944498992a74c162d27ac1b6673b85ee03423eb4c00000f2a450a7b767849bedf4fe4400efdfb33007f0daaf3c68fba1a6b6c38157f231d2ec6885373fe0c8947af03a39ecdad96ab0cb7c905613ed30c1bea8b85cf01ad7c9f8935be33f165923897d65ebe06393053cf5cb4d4fc16eb7148c0eda761656c228c32ac0f3f2d1160a785bfa4e4846b2cc08a817b7ba53822a6f810df686f9f3f08d59ee4696adb0457a538659f44dab345ae98b72a4b94f2180380d9be3f15527257aac3c2d6bbf667f3b98c1b1dcee945f2065ae4b31ebb5d22696c3ec104eca597664c75863b62a182fd6757e114804406d578876e4b18a511532fc3d7b32e508db27487367eb1c11d9919e8243280d827f9940928ef745c4ab192dbac329bfec2851a6bfa71d408e786b15a5b5b96614b1b6263307d706c5a2f8d92f7df9d292f7c63793106512ff673f541bab565d37ea051c4b2bd9389b46f6e8f0fb4d489fce54d88938456aae8d1edf164d1cf1aa71a8165ac8da99fea88abf5e7d5baf52ab173e8742dc98760ee9dde2443953b094598bcc5577b9a2473845056f5ccb684829e10d3cd3a486d4a0d62b652a15d0a74558d5a74856cbd2e49e5aa451d1600d7958fa547be9ef8677cbc1bb9122f202ce70fe7e73854bd0a8a622ed91393e7a487c9b9494bc8091b14477c15dff081a1282fbe2d88f57a2050b02811bdcd901172d87460b7ea37246f8d4c8727579cb785c0cae02f17896dbe69a124f64cb87d7736576b9ea53be49178d0a8869c8194915e29de7ac3cd7833640ca71d1e2e8827cbacb8c1188a51973886fab575c6b65819329b62f3c5b3af912b8a3247d949367978da7c8778a8ee52f6861331933e301eac794fd77655891d5298777f408b2863ad8cce30c41e130a52e97064e40ec7ff2f9280fe638d98b799afd79d6424b4fa40cd1fa275c893619a81c360b73a5a4effee7ab54db95f2fcf88ead0292fb306fe2d52972b7734927aaaca45cf8fc59b659b879a40a1a72388db215e064e60a9530db635351166edb2f5179904f1f92589518bdc2c9d82c3471d770c655d110db8dd82347ece7db4ddf6ce075a2e3e8390ec56e101ca455307811430caf2d407652bbd4a5e3c83c10d23130ebbc7f3513d9b56c958171c6fde5280b1b6e9f844a50ef1ca3017c72c407ef3b863c6c35764932d3accacf56e2d0afb51dea29c3cee5decefd55fecda8bd4ed05cf5a976115b04aa9a7e89afce5fadd5c2af013f534f2abd3fddc73d21cf772a7c529259b39a50204daa2bc7e6933ae3f69fb4d838d98b0fac6b67ac2829ecdf76e64413a6c13fc548dd03bb538fcc99ad68dd3a8bdb4d1a7a9179f113f0033833170a4d5553f4af1a7d158e5386f4d5582b470041ef0f1d4899467d097defc1489c8c7acde55c4832cde964e63ee3f1db610d1fc87e201fe83e86ff3b65cda5a0d26655b20c961963d542daf461a2f9ed8e4004b5cf2a9ea705c22861ff618156a5792ec3a8d90820f2f6986ff9b684d0444c89a882e85fcae61d9bd7a0953fe4168a7e333dfabd080c050a07d6b7b6281d1b5aa22d82203e6fb01e561aa35199708acd2310d81b872f761262843800b215961e4183551e3431bf9272142c5f3973f37c505bd07bc5d5d1cea98208313c70e9d62a1cdd46196c331c4f466f36b11abc5c80ead7d940e22b7b91a491625d68cd1ad17fcdcab45ddf5e6a31d0ede09fdce3c83362fab353f22711ed27f23b82c5c108fa4b7682342c46c79dcea51cc7c8fa2dc3262ddab26d22aaaf74520d9dd8cb00d9d5801ffc6cbdba6502cf9cea6ad3094f3edde48a69fd8682b6cc6651a9a4f7e956a5231ccb2a11fd449834c412c35c4076bc18cca2a22a5071df0fb4ad5732b173b8ca294aa24177f9b0e3e846194b72bf9becd280159211df634318d3de78566f8e9011a62ce104675332a8e7d1c9ed78ae0593ff103710aff65bafb5c81434fcddcd104c8679afbae417648d9a8bc9660b888a8f6d9f4b0aafcaf41f0f6719e66acbf54009e8eeb5389f7ab87f078f457287563ab4b0f7c309d0e2ac3cd792eabda5e197571072898b2f4aa2bf59902b659c6e099244e55ad93c5c4a6e3f77872873522e5fab7feadb2386d5b0430272a38b1325787fed3d4847406797a3e74de5e721cc6aaeb12c6ed54b75dddbd38e6bc3ed2503dfdb76ceba019841039088eb223849c3886c232cce20f6ebfb1786fd674791af51bf7bad4a22711f4654fb552aba12d30ec0e3ebb0eae8921db0a7e3c3e670deb29a273a5de169b2172fa6d028c61bb3ce895c38333d05226947021f7d4f487c819ff4b91bdade09805c8e002745641bc7a4669d033474af8e191794b39b:e6fba30b4c3625f903a9a9b906da470ce732419f8e75bb4c8827ec091bd9fc8017deb16fef911277f966cab6fe208adf91fdc6acc71e217770407e611e351758a26dd23dcd129666ca8d2f875bd46b69fe17c6b7060fb60ea834cc9a396a239162d4a5d9e7035fc34c49d3d64e459f759b98c27b83cc16821233ffa4896bebbb",
    // honest bundle B — the same journal produced under runtime guild-2.3.0-beta.1, one-time key 3
    "nad1:f5afe0cf112d7bf986b995d9cdcb458355f36a8888d392f1bd7a51b4abcea566":
      "nws1:03:b51eeb48489e522fd751fff07402fb81c9597d2d5d8c1372d858c73d0a25f22799434a90feea155f0ecf31a31527fba825a3c5dd1a08db2b35c239b3fe49734f40a7895f5928fcdcc678928c072161bc49510bffd8785839ba37dbee1992e04dee22e016209dc3cc7b9f7ecad354dc08ad1b6dd5057f71766f8bc22d0940827af3150772981ce3e25547b79014138b91aa20b519b3fea6efe11cf6cf48142dd4316e3238a478fb1c20fd8db5e4aee691ad7b48dacf5263bc7814134affe3c9274d8919edafeae2887a8807f20d140a073499b9f6b878179761e021afe5e5dc64152f692629f2836e67b400c3f6741d22bf730dc72d92f91f0e19036857b59f9958c4e09bfb4761c9cc4261d9886f84b2882384c83ed06954c72ab373625e837fa239dca3b15e179e14f3cbc120b46ba6ab2b202610d070427fdc3e1939673b78f1ffdd2784538e327785f46da70da49686013a3b005e06355d04568a92568338da1a1df574b068e1a6d0a458bbfa6e8902ff77ff30346ede8ba8b757b42e18a0cc7e893fa27798530b57ad4ac074e3d6c08551acc535683159eafa440509323991617e6aef8ea3ce8cfb3a5142c28123e64a37d2ed58eb2a5f0d8a0647ce0d461b46244ba8ab5fda7b6308762795f781cb4ae16e79cd35ca690efbb19a10a1bbd523f96dbe59cd88394f1dabe02a91dbdca76184356bacda6482c16a09e403b1a332df5e533df82f1a18a708588046e4108918fcb9680eda22287cee1e34c4ca0f177b36bb3fd7e63884d2d13d3ee8ec75afe8dd7c7f402458a5adbce2b515c3ece5db2528ca9ac17cfa3d06bee21c9df6d73332e3b07f7a13ab0c39e55f962905227e061078cd6d61aa9416ac4a1f4b2229b66fcfdcd7fdc19d46ef93651e4cbbed03ae79bcd1c5903231847c4f90f94f2f035f7313e0d00407c7c3d86d489d3041feb02007a4667b8c6b200332f68e4e9d35ddb2f8db20de6b22bb62e149ab2b2d879b02d46570681b9491bc37424191420a2a60f02c0064fd2a21eb02384e6df8333ffb90598477ebbcb0bdb012f604e16195d868002c71b64309752848e26dd76afed13cca3af8c147ac12d749144926b6dc10879b06f2e10db3feef190dce52845257b620b533b43e81f9700f5faead9f5bbe45d7241f80d88cc0fa0b7e6972b820e0978736c691f1287b77f0b1e847ca6c0d66e4e4b190629874b069fe27c78e122a195a9cb4b32db0c1056595137c4e16d1c1c63e54777f42d6d4f1f304742073425f3692b2978efb7b9cbcb323485981a223c35ba5088981dd0781efe60be7486e3f0b80f620c71e1e594fd7b49391daadba04e03e20cc0a21f4e04146dac63aa8216e0f1a95ba816a4f72a0af74eb83a7c6451834c30771a0eb3888a912f0b8bef0924242193624b16773a9d2a519a037d932ca096ee50f593b376b7c6a607126c91f2fe1a2361f4887f936b370d0cab4f10c3d577c0acd10994839e38ec5bebe0df3c16ac03b705cb7c053e3c1df74d97e32651b41dc27098e9cf4a0fc665e2cbace1ea39c2b4015ec3b75b95eb80a629b88c855acf87f082081b812ce722de439d310a280a17fed38c714832f973173f8d2654caf65459bb3a1c5c31d5866f58fcec881da2577abd2ab086c5c86d66627d03aa76e9add92a4417aff54308bde20197017fddf32e8a22d7864813f8744d17c8568ea4c51ebb17cf4a840cb981eb34db88ce0d765de8d4e3912c2d59ccd07bf86d4316ba9a814d0f037495d90c8d20ce3b90cd57d92402285edac90367f153a151e37f2dfd5a4dbb2e22ed3d8f673672b741692bee2fbbb19ed3b75948e6356e9ef39195b4650b0e80f437f5f3661f2177bf62c883334548d3dbaf6450c2206eeb788b8169d0ea2135cfceb10e29c2bed2ee45832b83e4bccb05f29d1d0de93c3e42ed4097f2d923fb77017227e77ab1fb2a8161146c7ad8b0765279c3b3c122f53d5f50b2d754405de740ceeae17979bfb5d0cdc4b1832d774c32b3686cef23cfad8b9a9b3fe21093198f2151d7dd5b6bb3ae30a9e32c9b060b06bfde9676cfbd7d8297717b70a22f0930bfabace2a08e0c2779d7b965ae1257c1a232eafa18c687bfa5fd50ba67ec368bb1458dc89f871af18582e47bcbeb11eee7ce79c0b4de1a0adac03510e1562912fd8519d0a17dc2200715a697db8b9ff7b008d20e873d8f59a8c2e166619d9fa1bc4fff11c0ed00f721d7989820402cdd94b982cd2199a45c5de16b6a2297e069ef7b0853b8fac40d873c8fa006d24bb32574d4e234c6b6828e74707ff36661aef717bb575ccad9ad2d1ae61af9007e7a87fe2b6167f16514fee9d0550ccf0741a7b2c7d3821d962c8e2e1185ed3674cfe649066222c23c9105b2af5a5e5ff75ff7a8f467dfad719b2b9cb1ddd88ff9e3dcbcb27e97ac7b9809fb2fd2d90811db784b43d9e4e07e83e86e8f1074c05de0a6252707c7ca12f1c8e7e4f806d6a942ed97533d35cf87df81ddd85196de21e16523476f599080092e104f69d4a576248c0a2f664a7d3f9064cdf1843e7253135c18ea5082ca3f52f045016f7ef999bd2bf5c0219488c5121312fabdf3eb7802a0e7c943bc768f3a1e64f5bafff26873c111bc59f1188f0e30d0b723a9f1797322d3690ac1f620d8d89c5dba2773d4f57f62f3408b211f648aeb7bdab9629368de9c993eadce1d5baa21aef699de7b7c7c19c82eb366e5bb03d1fdef3abee13de79d065dd4a71df8c493bd7c605f1ae35b76d669210d8a21193c43e931a6d3079aea6a65581a7ffbf802459b1b7b5c689e68d847cb70bc3f99d23e3c254457ac79b4c2f7c214c326671aa82d895ccc1fbacd5b52685e9d0de733e2c3f14353336e2f3ecefc74a8d321a26b8ec78a35ef96cc6a0814c9fb9dcf1c313f89b6e36156aea2ae311feefcb87ae9b2e84875846d829bd10077c591a507c7b8d98df708206fed7547a296b5fb6aa6d0059777e5ece1c588b1e6efa31fe7ad1f6fe2e04d537feb009496e7b70bd0654dcda:7cc3fb55914a28e214f09ee4e862f99367c784139a6638f724126b389ebdd34ceb43cdc796b6f7c3052654c2a8ed0b9b1281c1619a79efd9de4c8b34b26ee25788f76873ee3bcdee5e408c35c9f0fd567f9d7fa35bfec6cc5adb2487650c82eec214cdcdc4f7deac90a5cbfa1b7132153469ecd2db58d6d5f742452952440077",
    "nad1:29a7c823dd2a9ae1ee78d8d6946265eeb96fc8b80847794cca02eec32629e118":
      "nws1:03:c890d17664daafe1fc33467e3c4f0ee863a1513ee5a26037231fd45a5a0cc558359e50dcc41b84e4841e647094207c669b4e87ec7e4ba75696110fe399fe50766d1bf17614168b94a41dc6fad64deacb50d1940714a989d76255ee9a5a7903923cc91c0a6ed7229f861df77e34a3148160c0b848c8d35c213c415419c15c2d5173bb6fd97229816dd453dc7c1da6af8bc2441ee25604e50ecd8fb00b801ab4b1363533256e82d05059b3e523819ba59934b5a6821c6d1e74bde101ce0373c10b2b81e75c70285904007fcf0d2bff5170471b2b0200d11801b86fcdb8dfb67c286473b67c56ea1877a4a27479be88f48050570ee23867dd0aa473233e3b43d946fadea4a464462381e3d4b9c7aadb8b60b8e63537c70e524f6eec12a4f41e942e8890a6e07142e218fdb9dd5dc044a04f03559fde1cfca3fb37b5e5b9bbedd8b22ea4caa0bbe77983c9f72472b8a5ef3722c712fb9186763e592a8d4b1b2f605e035969ac45f80efee69b18fe07271db923601c6d3038a9e0669367886e1bf5c81bc1bbe0749942b32262894922a41cb9fa5cd7a34faf82c87e511388966efe3e026fc98b08c0c87c586ef5c8f047ead98fc4d7c9813f2c66b6cf7c32120b6818c5499ec53a6028c79560a9c4b35a53a87b9629078bb5c6c17149b2a754cebb41ef846620e4e6b67c334f616faa80fff6ffc706d35ebdc1131431cf78e6262840bb14c2652f5887bc0fe22452a56d06871b38ef13c0913174ce9bb0ee4b12a897108f09de8299b9266c9eb00e6db731eeb344c5a914f2ff16eae019ab874e1eb47c391833de263c4b2a03f09fd509d08eee494bb5d9ea7b971d93f6fdce19621b7b9ccfe34f7c203e7afb7b7d60972079dfbb2bb4e42c4de37eec2943952f8981ece1d700ee3606e6b08e5e6b189d98960a03a3e4b6ae4fd41c6e0aad8312913f1246518d1fa049e2e82988deda29de7c709a7ac7e09fda02591c3984b0416b35efaab13947638bcb108ea6ba260142a73b11fe9f63bf9aa0ab4c52f0143091eca464477d222728c773c54d41ac14801388342ea6d2e0edfbf8c103316da6626664188133b7e90dc1782451889b5a43299c0a9c96d71342d3f5528e36c1e63fd63791fdc02611323a383c6303559c0bdbf772f51c7c1ca76d6c7b9180aeb95cd15035842feab57fb9bffed2bcb52ae3d1ff3ce06e0cc3add97f837598faa296122f994d070694f719d565281cdfb0fcd97b40c1e710289155e07d0501138a38dbeac0bce034091b3418b2dc54642111ec13f69a87f607af0aff7fca51b1e484818194ffd80c31d8f4439b8a1ebf80db782fafcd8ba153a908385cbe953e291bb8671ecd60b46a74b3e18c09d6baf33984621f6ed631aab1ccd47317992b8b8c50dfd502c0535f1b2d6d3d6f12055d6bedf68b68e3c9931904bd7222ab1ab1288128a1a351c8a68ce337aa4cd08bb5e5df43b7b547dd8e0c8ec031e3e7a5cc8d8e86e421848058f550012225a5be6eb88dcf83879237a6fd44c1dcf4a69d168bd4d3d7cec7f242247eb563fc47c7225e615e5185519e7ca34f84edf9b42134d4e140058c6ff6b803d313fb40b19c159ab22b3d216d5bfdd1c6d56a6237fc80a5b0fbddb235e49fca75ce4cac27a011aaa3d75da0fdbddebcbd484e1eafeab7dd785e7c80973b40cee452a9ea6e8677b2490f779744571c19c04e7a76b1ab1b35889fa7cc9b5dbf6aa0e283a2673bd9ebccf9ac5bcd84884d5db66cb00dd671937e949bb292e750d8b5df3806cc7b01ce042d486641a2d0ef7f2b1e7aba9cb3781a041f9afed45b3e102f803e88855750fe64f24c2d33e3960023d3d1119717bc63ee81a82982e826e3940bfe00ce62e9109e3a7a99dfff9f083da04dd3a51fddd9b3483baeb14e1a703354be6d9230f0ba93ba5c6fc80c3785ff4d7e6ef902528e158034967b318ad3e51b2eb1fcf9882cd7e624e7424d73558aaf9f700378919f543d227b4124849f6aa33b770cf0b74921dbe4fb9b0e86a2b8218236f576588d9e8fc855530a86e4520972d1f2e53973ceec35d3c2ba7db49c7996dea8480bf9f9e0bd5e75ae61ddafb0c8af12d7fc25e19808b560c9c5462de091decf1bcdb121e7f6a90526ac8b89c3f872d5845dfca258427423522331f7163704d5d368276f32ac8d8d89a1f1c5c2f71aa0760ab97e0baae4af3b3a1ae2d1d2266961136dc2bc835521887e45942576f0cfe07e4f5565514e64bb6d19cba065fbf435d779ef7e8c5308bbd0438b2615de45db55aa6539750b3ad9724241f51c91168c08c2d2a4d3ac571cdb40246e5569a6a587e58fec08c1c6e65e0613241c435f6a73622a4add44c51fe8cfd3d496f88b612fc916a6eb3a6e3e08bbc0e3fa328e75b5801fa7e901036bbf563a9affbfa164e688236888d82bf6106bb3f44e3dec52a314e1b2af5f3b786b40c60dcd2da496bc80af81e12c7c605214b05b2da173a5461139d447db48224db9b03f38d05a0231dea480a78f5ece48f1d33680e7b4833925cfa6179bc993383bbdaee35e77a9d3e1ff98ed99c45860bdf5f8891d4d187dcc9608b9781d10403ec7d845252d9e1b5ae80f32180387086a7128d104868e171ff9132b2bda119d6f5612a7b53817ab05175f02c844b50bd4f59071fdf458ddaa5655810a694990cbc53e867805baad970dfcb46c74680446ebeed52c89b40281b25b2fede58892ffbd98c0cd69f099801f07373144f4cb70c1f5836b3b4b41bf9c5004cbb257f91ffe40fbe64474d2e40b05cd368f632492ce2285edd7b9641389e17aa617448661976980a52fc852ad2770f47b0d25bf70a469321bb15e34dc746dbfa55356a041907bc46a679eb68ed404e0f174917b01da1696e539cf2d0ecd49f46488950378f8ed7ff8e5feecfb59fa0e15218ecd2fcca5ad3b04f60acd37667e196b4651e8674bab8b40ed7b3d84b44cd9e3d24afcba1161522193d76222ee734db1acb324172200fa73e855ad9091f00b12f9325c146dc9a5300da678:c6311475406f077037db251e9095cd8cc0217f5c856a904cc2f3b9f8f6dace193718d74e030d494914c53cf9819bf4bd4b24e5de212651e684b3e0708a885c0ad132ec9e7b13b3909984fc7a49184c9f22c132e23a59a60d7f04b8ac578f3164497b5bf0a4cc6c1a80ec99c6b3ce6e0b5fe77e72955729cd5a5c4f75bde36990",
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

    /**
     * A21-X MH-02 extension: the FULL 31-scenario frozen-suite tuple is the
     * second (and last) core-declared required tuple. A 31-tuple submission is
     * no longer refused at the required-set gate — and nothing downstream
     * weakens: a structurally perfect 31-bundle with contract-correct outcome
     * types still dies at receipt binding, because its invented commitments
     * resolve to no observed journal entry.
     */
    it("admits the full 31-scenario tuple and refuses fabrication on receipt binding, never on the tuple", () => {
      const results = NEUTRAL_FULL_SUITE_SCENARIO_IDS.map((stableId, index) => {
        const sequence = index + 1;
        let hex = sequence.toString(16);
        while (hex.length < 16) hex = `0${hex}`;
        return {
          stable_id: stableId,
          outcome_type: NEUTRAL_FULL_SUITE_EXPECTED_OUTCOME_TYPES[index],
          disposition: "succeeded",
          reason_code: null,
          receipt_ref: `guild.receipt_ref.v1:jrn-run-1#${sequence}@nec1:${hex}`,
          evidence_identity: { ...BASE_IDENTITY },
          evidence_freshness: "fresh",
        };
      });
      const outcome = decide(
        evidence({
          required_scenario_ids: [...NEUTRAL_FULL_SUITE_SCENARIO_IDS],
          results: results as never,
        })
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_receipt_binding_unverified");
      expect(outcome.facts.may_promote_conformant).toBe(false);
    });

    it("still refuses a 31-tuple whose order is not the contract's", () => {
      const rotated = [...NEUTRAL_FULL_SUITE_SCENARIO_IDS];
      rotated.push(rotated.shift() as string);
      const outcome = decide(
        evidence({ required_scenario_ids: rotated, results: evidence().results })
      );
      expect(outcome.reason_code).toBe("scenario_required_set_mismatch");
    });

    /**
     * A journal-bound full-suite package: 31 records in canonical order, each
     * with its contract-declared type, a journal recording exactly those
     * outcomes (chained by the production functions), results citing each
     * entry's own commitment, and the trust-root attestors over the 31-root.
     * No off-repository signature exists for a 31-entry root, so a conformant
     * package built this way must refuse EXACTLY at signature verification —
     * which is what makes the stage-14 refusals below discriminating.
     */
    function fullSuitePackage(
      perRecord: (record: JournalRecord, index: number) => JournalRecord = (r) => r
    ): { pkg: NeutralConformanceEvidence; authority: NeutralConformanceAuthority } {
      const records: JournalRecord[] = NEUTRAL_FULL_SUITE_SCENARIO_IDS.map((stableId, index) => {
        const disposition = NEUTRAL_FULL_SUITE_EXPECTED_DISPOSITIONS[index];
        return perRecord(
          {
            stable_id: stableId,
            outcome_type: NEUTRAL_FULL_SUITE_EXPECTED_OUTCOME_TYPES[index] as never,
            disposition: disposition as never,
            reason_code: disposition === "succeeded" ? null : "scenario_evidence_incomplete",
          },
          index
        );
      });
      const authority = authorityFor(BASE_IDENTITY, {}, records);
      const results = records.map((record, index) => ({
        stable_id: record.stable_id,
        outcome_type: record.outcome_type,
        disposition: record.disposition,
        reason_code: record.reason_code,
        receipt_ref: neutralReceiptReference(authority, authority.observed_entries[index]),
        evidence_identity: authority.identity,
        evidence_freshness: "fresh",
      })) as unknown as NeutralScenarioResult[];
      const pkg: NeutralConformanceEvidence = {
        suite_id: NEUTRAL_SCENARIO_SUITE_ID,
        suite_version: NEUTRAL_SCENARIO_SUITE_VERSION,
        required_scenario_ids: [...NEUTRAL_FULL_SUITE_SCENARIO_IDS],
        activated_runtime: authority.identity,
        results,
        claimant_id: DEFAULT_CLAIMANT,
      } as unknown as NeutralConformanceEvidence;
      return { pkg, authority };
    }

    it("a conformant journal-bound 31-package refuses ONLY at signature verification", () => {
      const { pkg, authority } = fullSuitePackage();
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_attestation_signature_unverified");
    });

    it("an EXPLICIT refusal on an extension scenario is conformant fail-closed behaviour", () => {
      // MHRC-SUP-001 expects succeeded; an explicit closed-reason refusal,
      // journal-recorded, still reaches signature verification.
      const { pkg, authority } = fullSuitePackage((record) =>
        record.stable_id === "MHRC-SUP-001"
          ? { ...record, disposition: "refused" as never, reason_code: "scenario_evidence_incomplete" }
          : record
      );
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.reason_code).toBe("scenario_attestation_signature_unverified");
    });

    it("a FAILED extension scenario prevents promotion even fully journal-bound (codex P1)", () => {
      // MHRC-MOD-001 expects succeeded. A failed result — honestly recorded in
      // the journal and citing its own entry — must never reach signature
      // verification: with real quorum signatures it would otherwise promote.
      const { pkg, authority } = fullSuitePackage((record) =>
        record.stable_id === "MHRC-MOD-001"
          ? { ...record, disposition: "failed" as never, reason_code: "scenario_result_mismatch" }
          : record
      );
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.disposition).toBe("failed");
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(
        (outcome.facts.mismatched_scenarios as Array<{ stable_id: string }>).map((s) => s.stable_id)
      ).toEqual(["MHRC-MOD-001"]);
    });

    it("a SUCCEEDED result where the contract expects a refusal prevents promotion", () => {
      // MHRC-VER-001 expects refused: claiming success on a must-refuse
      // scenario is the fail-open signature stage 14 exists to catch.
      const { pkg, authority } = fullSuitePackage((record) =>
        record.stable_id === "MHRC-VER-001"
          ? { ...record, disposition: "succeeded" as never, reason_code: null }
          : record
      );
      const outcome = evaluateNeutralConformanceDecision(pkg, authority);
      expect(outcome.reason_code).toBe("scenario_result_mismatch");
      expect(
        (outcome.facts.mismatched_scenarios as Array<{ stable_id: string }>).map((s) => s.stable_id)
      ).toEqual(["MHRC-VER-001"]);
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

    // ---- A21-X MH-02: the recognition gate admits the v3 line, closed above --

    it("recognizes a guild-3.x runtime at the recognition gate (refusal moves past stage 9)", () => {
      const outcome = decide(
        evidence({ activated_runtime: { ...BASE_IDENTITY, runtime_version: "guild-3.0.0" } })
      );
      expect(outcome.disposition).toBe("refused");
      // The identity no longer refuses at RECOGNITION; it refuses later because
      // it does not equal the authority's identity — which is the proof major 3
      // passed stage 9 without any other stage weakening.
      expect(outcome.reason_code).toBe("scenario_identity_binding_mismatch");
    });

    it("an AUTHORITY naming guild-3.x passes the recognition gate", () => {
      const authority = authorityFor({ ...BASE_IDENTITY, runtime_version: "guild-3.0.0" });
      const outcome = evaluateNeutralConformanceDecision(evidenceFor(authority), authority);
      expect(outcome.reason_code).not.toBe("scenario_runtime_version_unrecognized");
      expect(outcome.facts.may_promote_conformant).not.toBe(true);
    });

    it("still refuses guild-4.x: the extension is closed, not a floor", () => {
      const outcome = decide(
        evidence({ activated_runtime: { ...BASE_IDENTITY, runtime_version: "guild-4.0.0" } })
      );
      expect(outcome.disposition).toBe("refused");
      expect(outcome.reason_code).toBe("scenario_runtime_version_unrecognized");
      expect(outcome.facts.recognized_runtime_majors).toEqual([2, 3]);
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
      // A21-X MH-02: recognition EXTENDS to the v3 release line; membership
      // stays a closed, deliberate core change.
      expect([...NEUTRAL_RECOGNIZED_RUNTIME_MAJORS]).toEqual([2, 3]);
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
