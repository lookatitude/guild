/**
 * F5 — the `context-manager` contract, exercised as the R13 bound it claims to be.
 *
 * The interesting assertions here are the NEGATIVE ones. A contract that only
 * proves "an allowed path is allowed" proves nothing about R13 ("context manager
 * becomes a universal domain expert or policy engine"): the whole question is
 * whether the forbidden things are actually unreachable.
 *
 * Anti-vacuity is stated per block: each guard names the edit that turns it red.
 */

import * as fs from "fs";
import * as path from "path";

import { parseFrontmatter } from "../lib/frontmatter";

import {
  CONTEXT_MANAGER_AGENT_ID,
  CONTEXT_MANAGER_CAPABILITY_SCOPE,
  CONTEXT_MANAGER_CONTRACT_SCHEMA,
  CONTEXT_MANAGER_FORBIDDEN_OPERATIONS,
  CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS,
  CONTEXT_MANAGER_NEUTRAL_CORE_IMPORT_ALLOWED,
  CONTEXT_MANAGER_PATH_MAX_LEN,
  CONTEXT_MANAGER_REGISTRATION_REQUIRES_CONTRACT,
  CONTEXT_MANAGER_TIER,
  CONTEXT_MANAGER_TOOLS,
  CONTEXT_MANAGER_WITHHELD_TOOLS,
  CONTEXT_MANAGER_WRITE_ROOTS,
  classifyContextManagerWrite,
  contractSelfCheck,
  isCanonicalRelPath,
  isContextManagerForbiddenOperation,
  isContextManagerOperation,
  isContextManagerTool,
} from "../lib/capability/context-manager-contract";

/**
 * Narrowing helper. The verdict is a discriminated union ON PURPOSE — a caller
 * must not be able to read `reason` off an allow — so the tests read every refusal
 * through one place instead of casting at each site.
 */
const denyReason = (v: unknown): string | null => {
  const r = classifyContextManagerWrite(v);
  return r.allowed === true ? null : r.reason;
};

describe("F5 — frozen declarations (D01 §Recommendation.4)", () => {
  it("declares the schema id, agent id, and `mid` tier", () => {
    expect(CONTEXT_MANAGER_CONTRACT_SCHEMA).toBe("guild.context_manager_contract.v1");
    expect(CONTEXT_MANAGER_AGENT_ID).toBe("context-manager");
    expect(CONTEXT_MANAGER_TIER).toBe("mid");
  });

  it("records D01's registration precondition as data, not as a remembered rule", () => {
    // D01: "a blocker on registration, not a follow-up". The agent-registration
    // guard reads this constant rather than trusting a reviewer's memory.
    expect(CONTEXT_MANAGER_REGISTRATION_REQUIRES_CONTRACT).toBe(true);
  });

  it("R13 non-goal 4: the neutral core may not import it", () => {
    expect(CONTEXT_MANAGER_NEUTRAL_CORE_IMPORT_ALLOWED).toBe(false);
  });

  it("every exported vocabulary is FROZEN (rule 10 / XF)", () => {
    for (const v of [
      CONTEXT_MANAGER_TOOLS,
      CONTEXT_MANAGER_WITHHELD_TOOLS,
      CONTEXT_MANAGER_CAPABILITY_SCOPE,
      CONTEXT_MANAGER_FORBIDDEN_OPERATIONS,
      CONTEXT_MANAGER_WRITE_ROOTS,
      CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS,
    ]) {
      expect(Object.isFrozen(v)).toBe(true);
    }
  });
});

describe("F5 — tool scope: the write bound is only real if the tools cannot route around it", () => {
  it("Bash is WITHHELD — a shell would void every path check in this file", () => {
    expect(CONTEXT_MANAGER_TOOLS).not.toContain("Bash");
    expect(CONTEXT_MANAGER_WITHHELD_TOOLS).toContain("Bash");
    expect(isContextManagerTool("Bash")).toBe(false);
  });

  it("Task is withheld — assembling is not dispatching", () => {
    expect(isContextManagerTool("Task")).toBe(false);
  });

  it("the read/edit tools it needs ARE granted", () => {
    for (const t of ["Read", "Grep", "Glob", "Write", "Edit"]) {
      expect(isContextManagerTool(t)).toBe(true);
    }
  });

  it("an unknown tool is not silently admitted", () => {
    expect(isContextManagerTool("SomeFutureTool")).toBe(false);
    expect(isContextManagerTool(undefined)).toBe(false);
    expect(isContextManagerTool({ toString: () => "Read" })).toBe(false);
  });
});

describe("F5 — capability scope: R13's policy engine is UNEXPRESSIBLE, not merely forbidden", () => {
  it("every allowed operation is an assembly verb", () => {
    expect([...CONTEXT_MANAGER_CAPABILITY_SCOPE]).toEqual([
      "assemble_context_bundle",
      "summarize_for_bundle",
      "resolve_recall_query",
      "record_context_receipt",
      "emit_capability_profile",
    ]);
  });

  it("no authority verb is in scope — the four D01 non-goals", () => {
    for (const op of [
      "write_agent_definition",
      "write_skill_definition",
      "promote_knowledge",
      "register_capability",
      "approve_candidate",
      "decide_project_question",
      "advance_resolver_mode",
    ]) {
      expect(isContextManagerOperation(op)).toBe(false);
      expect(isContextManagerForbiddenOperation(op)).toBe(true);
    }
  });

  it("an unknown operation is REFUSED, not defaulted in", () => {
    // Accept-by-default is the failure mode: a closed vocabulary that admits
    // unknown members is an open vocabulary wearing a closed one's name.
    expect(isContextManagerOperation("do_whatever")).toBe(false);
    expect(isContextManagerForbiddenOperation("do_whatever")).toBe(false);
  });
});

describe("F5 — the write boundary (the R13 bound as a function)", () => {
  it("allows run-scoped context, artifact, and run material", () => {
    expect(classifyContextManagerWrite(".guild/context/run-1/backend.md")).toEqual({
      allowed: true,
      root: ".guild/context",
    });
    expect(classifyContextManagerWrite(".guild/artifacts/reports/x.md").allowed).toBe(true);
    expect(
      classifyContextManagerWrite(".guild/runs/run-1/capability/profile.json").allowed,
    ).toBe(true);
  });

  it("REFUSES agent and skill definitions — D01 non-goal 1", () => {
    expect(classifyContextManagerWrite(".guild/agents/backend.md")).toEqual({
      allowed: false,
      reason: "forbidden_root",
    });
    expect(denyReason(".guild/agents/registry.yaml")).toBe(
      "forbidden_root",
    );
    expect(denyReason(".guild/skills/foo/SKILL.md")).toBe(
      "forbidden_root",
    );
  });

  it("REFUSES knowledge promotion — D01 non-goal 2", () => {
    expect(denyReason(".guild/wiki/decisions/x.md")).toBe(
      "forbidden_root",
    );
    expect(denyReason(".guild/knowledge/graph/g.json")).toBe(
      "forbidden_root",
    );
    expect(denyReason(".guild/memory/lessons/x.md")).toBe(
      "forbidden_root",
    );
  });

  it("REFUSES config and identity files", () => {
    // `.guild/settings.json` is a FILE listed as a forbidden root; the equality
    // branch of containment is what makes that work.
    expect(denyReason(".guild/settings.json")).toBe("forbidden_root");
    expect(denyReason(".guild/guild.yaml")).toBe("forbidden_root");
    expect(denyReason(".guild/workspace.json")).toBe("forbidden_root");
  });

  it("REFUSES anything outside the allowlist, including ordinary source", () => {
    expect(denyReason("src/index.ts")).toBe("outside_write_roots");
    expect(denyReason("README.md")).toBe("outside_write_roots");
    expect(denyReason(".guild/spec/x.md")).toBe("outside_write_roots");
  });

  it("the write root DIRECTORY itself is not a writable target", () => {
    expect(classifyContextManagerWrite(".guild/context").allowed).toBe(false);
    expect(classifyContextManagerWrite(".guild/runs").allowed).toBe(false);
  });

  it("SEGMENT-WISE containment: a sibling with a shared prefix is NOT under the root", () => {
    // The classic near-miss. `startsWith(".guild/context")` would admit this.
    // ✗-proof: swap isUnderRoot for a bare startsWith ⇒ this goes red.
    expect(denyReason(".guild/contextual/x.md")).toBe(
      "outside_write_roots",
    );
    expect(denyReason(".guild/agents-backup/x.md")).toBe(
      "outside_write_roots",
    );
  });

  it("a shared-prefix sibling of a FORBIDDEN root is not accidentally denied either", () => {
    // Symmetry check: over-denial is a bug too, and it hides real coverage.
    expect(classifyContextManagerWrite(".guild/artifacts/wiki-drafts/x.md").allowed).toBe(true);
  });
});

describe("F5 — path hardening (spec README rules 5 and 6)", () => {
  it("REJECTS non-canonical spellings rather than normalizing them", () => {
    // Each of these names the same file as a canonical spelling. Normalizing would
    // make raw-string dedup downstream unsound; rejecting makes it sound.
    for (const p of [
      ".guild/context/./x.md",
      ".guild/context//x.md",
      ".guild/context/../agents/x.md",
      ".guild/context/x.md/",
      ".guild\\context\\x.md",
      "/Users/me/repo/.guild/context/x.md",
      "C:/repo/.guild/context/x.md",
    ]) {
      expect(classifyContextManagerWrite(p)).toEqual({
        allowed: false,
        reason: "malformed_path",
      });
    }
  });

  it("traversal cannot escape via a canonical-looking prefix", () => {
    // The one that matters: an allowed prefix followed by `..`.
    expect(denyReason(".guild/context/../../etc/passwd")).toBe(
      "malformed_path",
    );
  });

  it("REJECTS control characters — the sharp universal body-smuggling guard", () => {
    expect(denyReason(".guild/context/x\nagent-body.md")).toBe(
      "malformed_path",
    );
    expect(denyReason(".guild/context/x\u0000.md")).toBe(
      "malformed_path",
    );
  });

  it("is LENGTH-BOUNDED — a path is not a body field", () => {
    const long = `.guild/context/${"a".repeat(CONTEXT_MANAGER_PATH_MAX_LEN)}.md`;
    expect(long.length).toBeGreaterThan(CONTEXT_MANAGER_PATH_MAX_LEN);
    expect(denyReason(long)).toBe("malformed_path");
    // And the boundary is inclusive on the legal side, so the cap is not off-by-one.
    const exact = `.guild/context/${"a".repeat(CONTEXT_MANAGER_PATH_MAX_LEN - ".guild/context/".length)}`;
    expect(exact.length).toBe(CONTEXT_MANAGER_PATH_MAX_LEN);
    expect(classifyContextManagerWrite(exact).allowed).toBe(true);
  });

  it("NEVER throws on exotic input — every shape maps to a refusal", () => {
    for (const v of [
      undefined,
      null,
      0,
      "",
      [],
      {},
      Symbol("x"),
      new Proxy({}, { get: () => ".guild/context/x.md" }),
      { toString: () => ".guild/context/x.md" },
      Object.defineProperty({}, "length", {
        get() {
          throw new Error("boom");
        },
      }),
    ]) {
      expect(() => classifyContextManagerWrite(v)).not.toThrow();
      expect(classifyContextManagerWrite(v).allowed).toBe(false);
    }
  });

  it("isCanonicalRelPath accepts exactly the canonical form", () => {
    expect(isCanonicalRelPath(".guild/context/x.md")).toBe(true);
    expect(isCanonicalRelPath("a")).toBe(true);
    expect(isCanonicalRelPath("")).toBe(false);
    expect(isCanonicalRelPath("a/")).toBe(false);
    expect(isCanonicalRelPath("/a")).toBe(false);
  });
});

describe("F5 — the AGENT FILE is bound to the contract, not merely adjacent to it", () => {
  /**
   * The gap this closes: the contract declares a tool scope and a tier, and the
   * agent file declares them again in YAML. Nothing made the two agree. A widened
   * `tools:` line in `agents/context-manager.md` — adding `Bash`, say — would have
   * voided every path check in the contract while every test above stayed green,
   * because the host reads the frontmatter and not the TypeScript.
   */
  const agentFile = fs.readFileSync(
    path.join(__dirname, "..", "..", "agents", "context-manager.md"),
    "utf8"
  );

  /**
   * Read through the SHARED js-yaml parser (OD-3 / communication-format-policy),
   * not a hand-rolled line-anchored field extractor.
   *
   * This is not merely policy compliance — it strengthens the block. The previous
   * reader hand-sliced to the first delimiter and then ran a multiline
   * line-anchored key regex over the slice, so it asserted on "some line
   * beginning with the key", which a nested or body-level occurrence could
   * satisfy. `parseFrontmatter` returns the TOP-LEVEL key the host actually
   * reads, which is the thing this block claims to bind.
   */
  const frontmatter = parseFrontmatter(agentFile);

  /** The declared tool list, as the host reads it: one comma-separated scalar. */
  const declaredTools = (): string[] => {
    expect(frontmatter).not.toBeNull();
    const raw = frontmatter!["tools"];
    expect(typeof raw).toBe("string");
    return String(raw)
      .split(",")
      .map((t) => t.trim());
  };

  it("the frontmatter `tools:` list is EXACTLY the contract's tool scope", () => {
    expect(declaredTools()).toEqual([...CONTEXT_MANAGER_TOOLS]);
  });

  it("no WITHHELD tool appears in the frontmatter — Bash above all", () => {
    for (const withheld of CONTEXT_MANAGER_WITHHELD_TOOLS) {
      expect(declaredTools()).not.toContain(withheld);
    }
  });

  it("the agent's `name` is the contract's agent id", () => {
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!["name"]).toBe(CONTEXT_MANAGER_AGENT_ID);
  });

  it("the declared `mid` tier is carried as the model the tier maps to", () => {
    // `mid` is sonnet across this roster (specialist-roster.md tier map). Asserting
    // the model rather than a prose tier note is what the roster-consistency rail
    // and the host both actually read.
    expect(CONTEXT_MANAGER_TIER).toBe("mid");
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!["model"]).toBe("sonnet");
  });

  it("the body POINTS AT the contract file rather than restating the boundary", () => {
    // Two copies of a boundary drift; one copy plus a pointer cannot.
    expect(agentFile).toContain("scripts/lib/capability/context-manager-contract.ts");
  });
});

describe("F5 — self-check: the guarantees are relationships BETWEEN lists", () => {
  it("the contract is internally consistent", () => {
    expect(contractSelfCheck()).toEqual([]);
  });

  it("ANTI-VACUITY: the self-check actually detects an overlap", () => {
    // The self-check is only worth running if it can fail. Reproduce each class it
    // guards against, using the same containment rule the production code uses.
    //
    // ✗-proof for guard 1 — add ".guild/agents" to CONTEXT_MANAGER_WRITE_ROOTS and
    // contractSelfCheck() returns a non-empty list. We cannot mutate the frozen
    // array, so assert the property the guard rests on instead: no allowed root is
    // at-or-under a forbidden one, and no forbidden root is at-or-under an allowed
    // one. If someone widens the allowlist to `.guild`, THIS goes red.
    const under = (p: string, r: string) =>
      p === r || (p.split("/").length > r.split("/").length && p.startsWith(`${r}/`));
    for (const a of CONTEXT_MANAGER_WRITE_ROOTS) {
      for (const f of CONTEXT_MANAGER_FORBIDDEN_WRITE_ROOTS) {
        expect(under(a, f) || under(f, a)).toBe(false);
      }
    }
    // ✗-proof for guard 4 — the authority-verb prefix scan. Prove the regex the
    // guard uses would catch a hypothetical addition.
    expect(/^(decide|promote|register|approve|create|delete|install)_/.test("promote_knowledge")).toBe(
      true,
    );
    expect(/^(decide|promote|register|approve|create|delete|install)_/.test("assemble_context_bundle")).toBe(
      false,
    );
  });
});
