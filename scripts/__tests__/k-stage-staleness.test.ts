/**
 * __tests__/k-stage-staleness.test.ts — SC-14 spec-correct TDD suite
 *
 * Acceptance cases (from team-lead spec):
 *   1. code-only structural edit (comments unchanged, no .md/diagram)
 *      → k1..k6 ALL FALSE, structuralSkip=false
 *   2. docs-only change (.guild/wiki/ or docs/knowledge/ page, no mermaid)
 *      → K1/K2/K4/K5/K6 TRUE; K3 FALSE; structuralSkip=true
 *
 * Additional cases:
 *   - wiki-only      → K2 true
 *   - diagram-only   → K3 true + K4 true (via k1||k2||k3)
 *   - doc-comment-only code edit → K1 true
 *   - K4 = K5 = K6 = k1 || k2 || k3
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import {
  CODE_EXTENSIONS,
  DOC_EXTENSIONS,
  DIAGRAM_EXTENSIONS,
  isCodeFile,
  isDocFile,
  isDiagramFile,
  isWikiPath,
  isKnowledgePath,
  containsMermaid,
  extractDocComments,
  extractNonCommentCode,
  sha256Hash,
  buildKStageStore,
  analyzeHashDelta,
  classifyKStages,
  readKStageTree,
  writeKStageBaseline,
  runKStageStaleness,
  knowledgeTierClobbered,
} from "../learn/k-stage-staleness";

import type { KStageStore, KHashDelta, KStageStaleness } from "../learn/k-stage-staleness";

// ---------------------------------------------------------------------------
// Section A — file type classifiers + new helpers
// ---------------------------------------------------------------------------

describe("Section A — file type classifiers", () => {
  describe("isCodeFile", () => {
    it("A1: .ts → code", () => expect(isCodeFile("src/index.ts")).toBe(true));
    it("A2: .tsx → code", () => expect(isCodeFile("src/app.tsx")).toBe(true));
    it("A3: .js → code", () => expect(isCodeFile("lib/util.js")).toBe(true));
    it("A4: .md → NOT code", () => expect(isCodeFile("docs/guide.md")).toBe(false));
    it("A5: .json → NOT code", () => expect(isCodeFile("config.json")).toBe(false));
  });

  describe("isDocFile", () => {
    it("A6: .md → doc", () => expect(isDocFile("docs/guide.md")).toBe(true));
    it("A7: .mdx → doc", () => expect(isDocFile("pages/intro.mdx")).toBe(true));
    it("A8: .ts → NOT doc", () => expect(isDocFile("src/util.ts")).toBe(false));
    it("A9: .txt → NOT doc", () => expect(isDocFile("notes.txt")).toBe(false));
  });

  describe("isDiagramFile", () => {
    it("A10: .mermaid → diagram", () => expect(isDiagramFile("diagrams/flow.mermaid")).toBe(true));
    it("A11: .mmd → diagram", () => expect(isDiagramFile("arch/overview.mmd")).toBe(true));
    it("A12: .svg → diagram", () => expect(isDiagramFile("arch/diagram.svg")).toBe(true));
    it("A13: .md → NOT diagram", () => expect(isDiagramFile("docs/arch.md")).toBe(false));
    it("A14: .ts → NOT diagram", () => expect(isDiagramFile("src/flow.ts")).toBe(false));
  });

  describe("isWikiPath", () => {
    it("A15: .guild/wiki/overview.md → wiki", () =>
      expect(isWikiPath(".guild/wiki/overview.md")).toBe(true));
    it("A16: .guild/wiki/decisions/adr-001.md → wiki", () =>
      expect(isWikiPath(".guild/wiki/decisions/adr-001.md")).toBe(true));
    it("A17: docs/knowledge/guide.md → NOT wiki", () =>
      expect(isWikiPath("docs/knowledge/guide.md")).toBe(false));
    it("A18: src/index.ts → NOT wiki", () =>
      expect(isWikiPath("src/index.ts")).toBe(false));
  });

  describe("isKnowledgePath", () => {
    it("A19: docs/knowledge/guide.md → knowledge", () =>
      expect(isKnowledgePath("docs/knowledge/guide.md")).toBe(true));
    it("A20: docs/knowledge/decisions/adr.md → knowledge", () =>
      expect(isKnowledgePath("docs/knowledge/decisions/adr.md")).toBe(true));
    it("A21: docs/guide.md → NOT knowledge", () =>
      expect(isKnowledgePath("docs/guide.md")).toBe(false));
    it("A22: .guild/wiki/x.md → NOT knowledge", () =>
      expect(isKnowledgePath(".guild/wiki/x.md")).toBe(false));
  });

  describe("containsMermaid", () => {
    it("A23: content with ```mermaid block → true", () =>
      expect(containsMermaid("# Arch\n\n```mermaid\ngraph LR; A-->B\n```\n")).toBe(true));
    it("A24: content without mermaid → false", () =>
      expect(containsMermaid("# Arch\n\nPlain text.")).toBe(false));
    it("A25: inline mermaid mention (not code fence) → false", () =>
      expect(containsMermaid("See the mermaid diagram.")).toBe(false));
  });

  describe("extractDocComments", () => {
    it("A26: JSDoc block extracted", () => {
      const code = "/** @doc A module */\nexport const x = 1;";
      expect(extractDocComments(code)).toContain("/** @doc A module */");
    });
    it("A27: // line comment extracted", () => {
      const code = "// utility\nexport const x = 1;";
      expect(extractDocComments(code)).toContain("// utility");
    });
    it("A28: no comments → empty string", () => {
      expect(extractDocComments("export const x = 1;")).toBe("");
    });
    it("A29: comment text unchanged → same hash (determinism)", () => {
      const code = "/** @doc stable */\nexport function foo() { return 1; }";
      expect(extractDocComments(code)).toBe(extractDocComments(code));
    });
    it("A30: structural code change, same comment → extractDocComments unchanged", () => {
      const v1 = "/** @doc comment */\nexport function foo() { return 1; }";
      const v2 = "/** @doc comment */\nexport function foo() { return 2; }";
      expect(extractDocComments(v1)).toBe(extractDocComments(v2));
    });
  });

  describe("extractNonCommentCode", () => {
    it("A31: strips block comments", () => {
      const code = "/** @doc A */\nexport const x = 1;";
      expect(extractNonCommentCode(code)).not.toContain("@doc");
    });
    it("A32: strips line comments", () => {
      const code = "export const x = 1; // inline";
      expect(extractNonCommentCode(code)).not.toContain("inline");
    });
    it("A33: structural change → extractNonCommentCode differs", () => {
      const v1 = "/** @doc c */\nexport function foo() { return 1; }";
      const v2 = "/** @doc c */\nexport function foo() { return 2; }";
      expect(extractNonCommentCode(v1)).not.toBe(extractNonCommentCode(v2));
    });
    it("A34: comment-only change → extractNonCommentCode unchanged", () => {
      const v1 = "/** @doc Original */\nexport function foo() { return 1; }";
      const v2 = "/** @doc UPDATED */\nexport function foo() { return 1; }";
      expect(extractNonCommentCode(v1)).toBe(extractNonCommentCode(v2));
    });
  });

  // ── Tokenizer-aware counterexamples (would fail with naive regex) ────────

  describe("extractDocComments — tokenizer-aware (must NOT misclassify non-comment tokens)", () => {
    it("A-T1: // inside double-quoted string is NOT a comment", () => {
      // Naive regex: strips "//api/v1\";" as a line comment → WRONG
      const code = 'const e = "https://api/v1";';
      expect(extractDocComments(code)).toBe("");
    });

    it("A-T2: // inside single-quoted string is NOT a comment", () => {
      const code = "const m = '//not comment';";
      expect(extractDocComments(code)).toBe("");
    });

    it("A-T3: // inside template literal is NOT a comment", () => {
      const code = "const t = `see //x`;";
      expect(extractDocComments(code)).toBe("");
    });

    it("A-T4: /* */ inside double-quoted string is NOT a comment", () => {
      // Naive regex: strips "/* x */" as a block comment → WRONG
      const code = 'const css = "a /* x */ b";';
      expect(extractDocComments(code)).toBe("");
    });

    it("A-T5: regex literal with // in it is NOT a comment", () => {
      const code = "const re = /TODO/; // real comment";
      // Only the real trailing comment should be extracted
      const comments = extractDocComments(code);
      expect(comments).toContain("// real comment");
      expect(comments).not.toContain("TODO");
    });

    it("A-T6: /* */ inside regex literal is NOT a comment", () => {
      // /[/*] TODO [*/]/ — the /* and */ are inside a regex character class
      const code = "const re = /[/*] TODO [*/]/;";
      expect(extractDocComments(code)).toBe("");
    });

    it("A-T7: multi-line template with -- (SQL-style comment) is NOT a comment", () => {
      const code = "const q = `\n  SELECT * FROM foo -- where id = 1\n`;";
      expect(extractDocComments(code)).toBe("");
    });
  });

  describe("extractNonCommentCode — tokenizer-aware (structural changes in string/regex preserved)", () => {
    it("A-T8: URL change in string → extractNonCommentCode differs (structural edit)", () => {
      const v1 = '/** @doc module */\nconst endpoint = "https://api/v1";';
      const v2 = '/** @doc module */\nconst endpoint = "https://api/v2";';
      expect(extractNonCommentCode(v1)).not.toBe(extractNonCommentCode(v2));
    });

    it("A-T9: same JSDoc + different string content → doc hashes equal, non-comment hashes differ", () => {
      const v1 = '/** @doc stable */\nconst s = "hello";';
      const v2 = '/** @doc stable */\nconst s = "world";';
      expect(extractDocComments(v1)).toBe(extractDocComments(v2));
      expect(extractNonCommentCode(v1)).not.toBe(extractNonCommentCode(v2));
    });
  });

  it("A35: CODE_EXTENSIONS, DOC_EXTENSIONS, DIAGRAM_EXTENSIONS are Sets of strings", () => {
    expect(CODE_EXTENSIONS).toBeInstanceOf(Set);
    expect(DOC_EXTENSIONS).toBeInstanceOf(Set);
    expect(DIAGRAM_EXTENSIONS).toBeInstanceOf(Set);
    expect([...CODE_EXTENSIONS].every((e) => e.startsWith("."))).toBe(true);
    expect(DIAGRAM_EXTENSIONS.has(".svg")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section B — sha256Hash
// ---------------------------------------------------------------------------

describe("Section B — sha256Hash", () => {
  it("B1: same content → same hash", () => {
    expect(sha256Hash("hello world")).toBe(sha256Hash("hello world"));
  });
  it("B2: different content → different hash", () => {
    expect(sha256Hash("hello")).not.toBe(sha256Hash("world"));
  });
  it("B3: returns a 64-char hex string (sha256)", () => {
    expect(sha256Hash("test")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("B4: empty string hashes deterministically", () => {
    expect(sha256Hash("")).toBe(sha256Hash(""));
    expect(sha256Hash("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Section C — buildKStageStore
// ---------------------------------------------------------------------------

describe("Section C — buildKStageStore", () => {
  const files = {
    "src/index.ts": "/** @doc module */\nexport default function main() {}",
    "docs/guide.md": "# Guide\n\nHello.",
    "diagrams/arch.mermaid": "graph LR; A --> B",
  };

  it("C1: version string is guild.kstage_fingerprint.v1", () => {
    expect(buildKStageStore(files).version).toBe("guild.kstage_fingerprint.v1");
  });

  it("C2: all input paths present in store.files", () => {
    const store = buildKStageStore(files);
    for (const p of Object.keys(files)) {
      expect(store.files[p]).toBeDefined();
    }
  });

  it("C3: values are sha256 hex strings", () => {
    const store = buildKStageStore(files);
    for (const v of Object.values(store.files)) {
      expect(v).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("C4: same content → same hash across calls (determinism)", () => {
    expect(buildKStageStore(files).files).toEqual(buildKStageStore(files).files);
  });

  it("C5: code file has entry in docCommentHashes", () => {
    const store = buildKStageStore(files);
    expect(store.docCommentHashes["src/index.ts"]).toBeDefined();
    expect(store.docCommentHashes["src/index.ts"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("C6: code file has entry in nonCommentHashes", () => {
    const store = buildKStageStore(files);
    expect(store.nonCommentHashes["src/index.ts"]).toBeDefined();
    expect(store.nonCommentHashes["src/index.ts"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("C7: .md file with mermaid block → path appears in mermaidDocs", () => {
    const withMermaid = {
      "docs/arch.md": "# Arch\n\n```mermaid\ngraph LR; A-->B\n```\n",
    };
    const store = buildKStageStore(withMermaid);
    expect(store.mermaidDocs).toContain("docs/arch.md");
  });

  it("C8: .md file without mermaid → NOT in mermaidDocs", () => {
    const store = buildKStageStore(files); // docs/guide.md has no mermaid
    expect(store.mermaidDocs).not.toContain("docs/guide.md");
  });

  it("C9: non-code file → NOT in docCommentHashes", () => {
    const store = buildKStageStore(files);
    expect(store.docCommentHashes["docs/guide.md"]).toBeUndefined();
    expect(store.docCommentHashes["diagrams/arch.mermaid"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Section D — analyzeHashDelta
// ---------------------------------------------------------------------------

describe("Section D — analyzeHashDelta", () => {
  const base: KStageStore = {
    version: "guild.kstage_fingerprint.v1",
    files: {
      "src/index.ts":      sha256Hash("original content"),
      "docs/guide.md":     sha256Hash("original docs"),
      "diagrams/arch.mmd": sha256Hash("graph TD; A-->B"),
    },
    docCommentHashes: {},
    nonCommentHashes: {},
    mermaidDocs: [],
  };

  it("D1: unchanged files detected", () => {
    const current = {
      "src/index.ts":      "original content",
      "docs/guide.md":     "original docs",
      "diagrams/arch.mmd": "graph TD; A-->B",
    };
    const delta = analyzeHashDelta(base, current);
    expect(delta.unchanged).toContain("src/index.ts");
    expect(delta.modified).toHaveLength(0);
    expect(delta.added).toHaveLength(0);
    expect(delta.deleted).toHaveLength(0);
  });

  it("D2: modified files detected when content changes", () => {
    const current = {
      "src/index.ts":      "MODIFIED content",
      "docs/guide.md":     "original docs",
      "diagrams/arch.mmd": "graph TD; A-->B",
    };
    const delta = analyzeHashDelta(base, current);
    expect(delta.modified).toContain("src/index.ts");
    expect(delta.unchanged).toContain("docs/guide.md");
  });

  it("D3: added files detected", () => {
    const current = {
      "src/index.ts":      "original content",
      "docs/guide.md":     "original docs",
      "diagrams/arch.mmd": "graph TD; A-->B",
      "src/new-file.ts":   "// new",
    };
    const delta = analyzeHashDelta(base, current);
    expect(delta.added).toContain("src/new-file.ts");
  });

  it("D4: deleted files detected", () => {
    const current = { "src/index.ts": "original content" };
    const delta = analyzeHashDelta(base, current);
    expect(delta.deleted).toContain("docs/guide.md");
    expect(delta.deleted).toContain("diagrams/arch.mmd");
  });

  it("D5: delta arrays are mutually exclusive", () => {
    const current = {
      "src/index.ts":      "MODIFIED",
      "diagrams/arch.mmd": "graph TD; A-->B",
      "src/new.ts":        "// new",
    };
    const delta = analyzeHashDelta(base, current);
    const all = [...delta.added, ...delta.deleted, ...delta.modified, ...delta.unchanged];
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// Section E — classifyKStages (spec-correct, three-argument signature)
// ---------------------------------------------------------------------------

describe("Section E — classifyKStages (spec-correct routing)", () => {
  const emptyStore: KStageStore = {
    version: "guild.kstage_fingerprint.v1",
    files: {},
    docCommentHashes: {},
    nonCommentHashes: {},
    mermaidDocs: [],
  };
  const emptyDelta: KHashDelta = { added: [], deleted: [], modified: [], unchanged: [] };

  // ── E1: baseline — no changes ──────────────────────────────────────────

  it("E1: no changes → all K-stages false, structuralSkip=true", () => {
    const r = classifyKStages(emptyDelta, emptyStore, {});
    expect(r.k1).toBe(false);
    expect(r.k2).toBe(false);
    expect(r.k3).toBe(false);
    expect(r.k4).toBe(false);
    expect(r.k5).toBe(false);
    expect(r.k6).toBe(false);
    expect(r.structuralSkip).toBe(true);
  });

  // ── E2: ACCEPTANCE CASE 1 ─────────────────────────────────────────────
  // structural .ts edit, doc-comments UNCHANGED → k1..k6 ALL FALSE

  it("E2 (acceptance-1): code structural edit, doc-comments unchanged → k1..k6 ALL FALSE, structuralSkip=false", () => {
    const orig = "/** @doc comment */\nexport function foo() { return 1; }";
    const modified = "/** @doc comment */\nexport function foo() { return 2; }";
    const stored = buildKStageStore({ "src/index.ts": orig });
    const current: Record<string, string> = { "src/index.ts": modified };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["src/index.ts"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(false);
    expect(r.k2).toBe(false);
    expect(r.k3).toBe(false);
    expect(r.k4).toBe(false);
    expect(r.k5).toBe(false);
    expect(r.k6).toBe(false);
    expect(r.structuralSkip).toBe(false); // structural code DID change
  });

  // ── E3: ACCEPTANCE CASE 2 ─────────────────────────────────────────────
  // docs-only wiki page, no mermaid → K1/K2/K4/K5/K6 TRUE; K3 FALSE; structuralSkip=true

  it("E3 (acceptance-2): .guild/wiki/ page, no mermaid → K1/K2/K4/K5/K6 true, K3 false, structuralSkip=true", () => {
    const stored = buildKStageStore({ ".guild/wiki/overview.md": "# Old\n\nContent." });
    const current: Record<string, string> = { ".guild/wiki/overview.md": "# Overview\n\nNew content." };
    const delta: KHashDelta = { added: [], deleted: [], modified: [".guild/wiki/overview.md"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(true);
    expect(r.k2).toBe(true);
    expect(r.k3).toBe(false);
    expect(r.k4).toBe(true);
    expect(r.k5).toBe(true);
    expect(r.k6).toBe(true);
    expect(r.structuralSkip).toBe(true);
  });

  // ── E4: docs/knowledge/ path → K2 true ────────────────────────────────

  it("E4: docs/knowledge/ page → K2 true", () => {
    const stored = buildKStageStore({ "docs/knowledge/guide.md": "# Old" });
    const current: Record<string, string> = { "docs/knowledge/guide.md": "# New" };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["docs/knowledge/guide.md"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(true);  // .md changed → k1
    expect(r.k2).toBe(true);  // knowledge path
    expect(r.structuralSkip).toBe(true);
  });

  // ── E5: .md outside wiki/knowledge → K1 true, K2 false ────────────────

  it("E5: .md outside wiki/knowledge paths → K1 true, K2 false", () => {
    const stored = buildKStageStore({ "docs/guide.md": "# Old" });
    const current: Record<string, string> = { "docs/guide.md": "# New" };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["docs/guide.md"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(true);
    expect(r.k2).toBe(false); // NOT wiki/knowledge prefix
  });

  // ── E6: standalone diagram (.mmd) → K3/K4/K5/K6 true ─────────────────

  it("E6: standalone diagram (.mmd) → K3/K4/K5/K6 true, K1/K2 false, structuralSkip=true", () => {
    const stored = buildKStageStore({ "diagrams/flow.mmd": "graph LR; A-->B" });
    const current: Record<string, string> = { "diagrams/flow.mmd": "graph LR; A-->C" };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["diagrams/flow.mmd"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(false);
    expect(r.k2).toBe(false);
    expect(r.k3).toBe(true);
    expect(r.k4).toBe(true);  // k1||k2||k3 = true (k3)
    expect(r.k5).toBe(true);
    expect(r.k6).toBe(true);
    expect(r.structuralSkip).toBe(true); // no code structural change
  });

  // ── E7: .svg diagram → K3 true ────────────────────────────────────────

  it("E7: .svg diagram changed → K3 true", () => {
    const stored = buildKStageStore({ "docs/arch.svg": "old svg" });
    const current: Record<string, string> = { "docs/arch.svg": "new svg" };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["docs/arch.svg"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k3).toBe(true);
  });

  // ── E8: doc-comment-only code edit → K1 true ──────────────────────────

  it("E8: doc-comment-only code edit → K1 true, structuralSkip=true", () => {
    const orig = "/** @doc Original comment */\nexport function foo() { return 1; }";
    const modified = "/** @doc UPDATED comment */\nexport function foo() { return 1; }";
    const stored = buildKStageStore({ "src/index.ts": orig });
    const current: Record<string, string> = { "src/index.ts": modified };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["src/index.ts"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(true);   // doc-comment changed
    expect(r.k2).toBe(false);
    expect(r.k3).toBe(false);
    expect(r.structuralSkip).toBe(true); // non-comment code unchanged
  });

  // ── E9: .md with mermaid → K3 true ────────────────────────────────────

  it("E9: .md file with mermaid block changed → K3 true", () => {
    const orig = "# Arch\n\n```mermaid\ngraph LR; A-->B\n```\n";
    const modified = "# Arch\n\n```mermaid\ngraph LR; A-->C\n```\n";
    const stored = buildKStageStore({ "docs/arch.md": orig });
    const current: Record<string, string> = { "docs/arch.md": modified };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["docs/arch.md"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k3).toBe(true);
  });

  // ── E10: .md without mermaid → K3 false ───────────────────────────────

  it("E10: .md file without mermaid changed → K3 false", () => {
    const stored = buildKStageStore({ "docs/arch.md": "# Arch\n\nPlain text." });
    const current: Record<string, string> = { "docs/arch.md": "# Arch\n\nUpdated plain text." };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["docs/arch.md"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k3).toBe(false);
  });

  // ── E11: k4 = k5 = k6 = k1 || k2 || k3 (verified across shapes) ───────

  it("E11: k4=k5=k6=k1||k2||k3 verified across delta shapes", () => {
    const shapes: Array<[KHashDelta, KStageStore, Record<string, string>]> = [
      // structural code change: k1=k2=k3=false → k4=k5=k6=false
      [
        { added: [], deleted: [], modified: ["src/a.ts"], unchanged: [] },
        buildKStageStore({ "src/a.ts": "/** c */\nfunction a(){return 1;}" }),
        { "src/a.ts": "/** c */\nfunction a(){return 2;}" },
      ],
      // wiki change: k2=true → k4=k5=k6=true
      [
        { added: [], deleted: [], modified: [".guild/wiki/x.md"], unchanged: [] },
        buildKStageStore({ ".guild/wiki/x.md": "# Old" }),
        { ".guild/wiki/x.md": "# New" },
      ],
      // diagram change: k3=true → k4=k5=k6=true
      [
        { added: [], deleted: [], modified: ["arch.mmd"], unchanged: [] },
        buildKStageStore({ "arch.mmd": "graph TD; A-->B" }),
        { "arch.mmd": "graph TD; A-->C" },
      ],
      // no changes
      [emptyDelta, emptyStore, {}],
    ];
    for (const [delta, stored, current] of shapes) {
      const r = classifyKStages(delta, stored, current);
      const base = r.k1 || r.k2 || r.k3;
      expect(r.k4).toBe(base);
      expect(r.k5).toBe(base);
      expect(r.k6).toBe(base);
    }
  });

  // ── E12: result always has reason string ──────────────────────────────

  it("E12: result always has a non-empty reason string", () => {
    const r = classifyKStages(emptyDelta, emptyStore, {});
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
  });

  // ── E13: added code file with doc-comments → K1 true ─────────────────

  it("E13: added code file with doc-comments → K1 true", () => {
    const current: Record<string, string> = {
      "src/new.ts": "/** @doc New module */\nexport const x = 1;",
    };
    const delta: KHashDelta = { added: ["src/new.ts"], deleted: [], modified: [], unchanged: [] };

    const r = classifyKStages(delta, emptyStore, current);
    expect(r.k1).toBe(true);
  });

  // ── E14: added code file with NO doc-comments → K1 false ─────────────

  it("E14: added code file with no doc-comments → K1 false", () => {
    const current: Record<string, string> = {
      "src/new.ts": "export const x = 1;",
    };
    const delta: KHashDelta = { added: ["src/new.ts"], deleted: [], modified: [], unchanged: [] };

    const r = classifyKStages(delta, emptyStore, current);
    expect(r.k1).toBe(false);
    expect(r.k2).toBe(false);
    expect(r.k3).toBe(false);
    expect(r.k6).toBe(false);
  });

  // ── E2b: URL change inside string, comment truly unchanged → k1=false ──
  // This is the critical regression the naive regex breaks.

  it("E2b (acceptance-1 string-variant): URL change in string, JSDoc unchanged → k1=false", () => {
    const orig = '/** @doc stable */\nconst endpoint = "https://api/v1";';
    const modified = '/** @doc stable */\nconst endpoint = "https://api/v2";';
    const stored = buildKStageStore({ "src/index.ts": orig });
    const current: Record<string, string> = { "src/index.ts": modified };
    const delta: KHashDelta = { added: [], deleted: [], modified: ["src/index.ts"], unchanged: [] };

    const r = classifyKStages(delta, stored, current);
    expect(r.k1).toBe(false); // URL change is structural, not doc-comment
    expect(r.k6).toBe(false);
    expect(r.structuralSkip).toBe(false); // structural code DID change
  });

  // ── E15: deleted wiki file → K1/K2 true ──────────────────────────────

  it("E15: deleted .guild/wiki/ file → K1/K2 true", () => {
    const stored = buildKStageStore({ ".guild/wiki/removed.md": "# Removed" });
    const delta: KHashDelta = { added: [], deleted: [".guild/wiki/removed.md"], modified: [], unchanged: [] };

    const r = classifyKStages(delta, stored, {});
    expect(r.k1).toBe(true);
    expect(r.k2).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section F — FS smoke (baseline + check cycle)
// ---------------------------------------------------------------------------

describe("Section F — FS smoke", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kstage-test-"));
    // main.ts has a JSDoc comment so we can test comment-unchanged structural edits
    fs.writeFileSync(
      path.join(tmpDir, "main.ts"),
      "/** @module main */\nexport const x = 1;"
    );
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Project");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("F1: readKStageTree returns a Record<string,string>", () => {
    const tree = readKStageTree(tmpDir);
    expect(typeof tree).toBe("object");
    expect(tree).not.toBeNull();
  });

  it("F2: no baseline → all K-stages stale (conservative, including k6)", () => {
    const result = runKStageStaleness(tmpDir);
    expect(result.k1).toBe(true);
    expect(result.k2).toBe(true);
    expect(result.k3).toBe(true);
    expect(result.k4).toBe(true);
    expect(result.k5).toBe(true);
    expect(result.k6).toBe(true);
  });

  it("F3: after writing baseline + no changes → all K-stages NOT stale, structuralSkip=true", () => {
    writeKStageBaseline(tmpDir);
    const result = runKStageStaleness(tmpDir);
    expect(result.k1).toBe(false);
    expect(result.k2).toBe(false);
    expect(result.k3).toBe(false);
    expect(result.k4).toBe(false);
    expect(result.k5).toBe(false);
    expect(result.k6).toBe(false);
    expect(result.structuralSkip).toBe(true);
  });

  it("F4: structural code edit (JSDoc comment unchanged) → k1..k6 ALL FALSE, structuralSkip=false", () => {
    // Baseline from F3 has: main.ts = "/** @module main */\nexport const x = 1;"
    // Modify only structural code, keep JSDoc comment identical
    fs.writeFileSync(
      path.join(tmpDir, "main.ts"),
      "/** @module main */\nexport const x = 2;"
    );
    const result = runKStageStaleness(tmpDir);
    expect(result.k1).toBe(false); // doc-comment unchanged
    expect(result.k2).toBe(false);
    expect(result.k3).toBe(false);
    expect(result.k4).toBe(false);
    expect(result.k5).toBe(false);
    expect(result.k6).toBe(false);
    expect(result.structuralSkip).toBe(false); // structural code DID change
  });

  it("F5: add docs/knowledge/ page → K1/K2/K4/K5/K6 stale, K3 false, structuralSkip=true", () => {
    // Re-baseline to capture current state (main.ts = x=2 from F4)
    writeKStageBaseline(tmpDir);

    // Add a new docs/knowledge/ file
    fs.mkdirSync(path.join(tmpDir, "docs", "knowledge"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "docs", "knowledge", "guide.md"),
      "# Guide\n\nNew knowledge page."
    );

    const result = runKStageStaleness(tmpDir);
    expect(result.k1).toBe(true);  // .md added → k1
    expect(result.k2).toBe(true);  // docs/knowledge/ path → k2
    expect(result.k3).toBe(false); // no mermaid block
    expect(result.k4).toBe(true);
    expect(result.k5).toBe(true);
    expect(result.k6).toBe(true);
    expect(result.structuralSkip).toBe(true); // no code structural changes
  });
});

// ---------------------------------------------------------------------------
// Section G — knowledge-tier clobber detection (G2b-2 fix)
// ---------------------------------------------------------------------------

describe("Section G — knowledgeTierClobbered (tier-aware staleness)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kstage-tier-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeWikiPage(dir: string): void {
    fs.mkdirSync(path.join(dir, ".guild", "wiki"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".guild", "wiki", "index.md"), "# Wiki\n\nSome page.\n");
  }

  function writeGraph(dir: string, nodes: Array<{ id: string; type: string }>): void {
    fs.mkdirSync(path.join(dir, ".guild", "indexes"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".guild", "indexes", "knowledge-graph.json"),
      JSON.stringify({ version: "guild.knowledge_graph.v2", nodes, edges: [], layers: [], tour: [] }),
    );
  }

  it("G1: no .guild/wiki/ pages → not clobbered (no tier expected)", () => {
    expect(knowledgeTierClobbered(tmpDir)).toBe(false);
  });

  it("G2: wiki pages exist but no knowledge-graph.json yet → not clobbered (never built)", () => {
    writeWikiPage(tmpDir);
    expect(knowledgeTierClobbered(tmpDir)).toBe(false);
  });

  it("G3: wiki pages exist + graph has a wiki_page node → not clobbered", () => {
    writeWikiPage(tmpDir);
    writeGraph(tmpDir, [
      { id: "file:src/index.ts", type: "file" },
      { id: "wiki_page:index", type: "wiki_page" },
    ]);
    expect(knowledgeTierClobbered(tmpDir)).toBe(false);
  });

  it("G4: wiki pages exist + graph has ONLY non-knowledge nodes → clobbered", () => {
    writeWikiPage(tmpDir);
    writeGraph(tmpDir, [{ id: "file:src/index.ts", type: "file" }]);
    expect(knowledgeTierClobbered(tmpDir)).toBe(true);
  });

  it("G5: corrupt knowledge-graph.json → not clobbered (a different concern)", () => {
    writeWikiPage(tmpDir);
    fs.mkdirSync(path.join(tmpDir, ".guild", "indexes"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".guild", "indexes", "knowledge-graph.json"), "{not json");
    expect(knowledgeTierClobbered(tmpDir)).toBe(false);
  });

  it("G6: runKStageStaleness folds a clobbered tier into K2/K4/K5/K6, even with a fresh no-op baseline", () => {
    fs.writeFileSync(path.join(tmpDir, "main.ts"), "export const x = 1;");
    writeKStageBaseline(tmpDir);

    // Simulate a clobber that touches NO tracked file (code/doc/diagram) —
    // only the derived, non-tracked knowledge-graph.json artifact changes.
    writeWikiPage(tmpDir);
    writeGraph(tmpDir, [{ id: "file:src/index.ts", type: "file" }]);

    const result = runKStageStaleness(tmpDir);
    expect(result.knowledgeTierClobbered).toBe(true);
    expect(result.k2).toBe(true);
    expect(result.k4).toBe(true);
    expect(result.k5).toBe(true);
    expect(result.k6).toBe(true);
    expect(result.reason).toMatch(/clobbered tier/);
  });

  it("G7: runKStageStaleness reports NOT clobbered when the tier survives (regression control)", () => {
    fs.writeFileSync(path.join(tmpDir, "main.ts"), "export const x = 1;");
    writeKStageBaseline(tmpDir);

    writeWikiPage(tmpDir);
    writeGraph(tmpDir, [
      { id: "file:src/index.ts", type: "file" },
      { id: "wiki_page:index", type: "wiki_page" },
    ]);

    const result = runKStageStaleness(tmpDir);
    expect(result.knowledgeTierClobbered).toBe(false);
  });
});
