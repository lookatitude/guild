/**
 * scripts/__tests__/project-definition-ref.test.ts
 *
 * Conformance for `guild.project_definition_ref.v1` (decision cap-loc-D05,
 * spec S2). Assertion ids map to the wave-5 conformance matrix §S2.
 *
 * The load-bearing ones:
 *   A2.1/A2.2  absolute + traversing paths rejected (R10 worktree safety)
 *   A2.4       kind ⇄ identity-hash coupling
 *   A2.5       this module NEVER computes an identity hash (static, below)
 *   A2.6       byte/hash mismatch is fail-closed
 */

import * as fs from "fs";
import * as path from "path";

import {
  PROJECT_DEFINITION_REF_SCHEMA,
  DEFINITION_KINDS,
  isProjectRelativePath,
  isValidContentHash,
  validatePinnedSkillRef,
  validateProjectDefinitionRefV1,
  isProjectDefinitionRefV1,
  verifyRefAgainstBytes,
  type ProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const IDENT_P = "c".repeat(64); // identity hashes are RAW hex, not "sha256:"-prefixed
const IDENT_T = "d".repeat(64);

function agentRef(over: Partial<ProjectDefinitionRefV1> = {}): ProjectDefinitionRefV1 {
  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: "plugin",
    kind: "agent",
    id: "plugin-runtime-architect",
    relative_path: ".guild/agents/plugin-runtime-architect.md",
    content_hash: HASH_A,
    source_commit: "59aca7e",
    specialist_profile_hash: IDENT_P,
    specialist_type_hash: IDENT_T,
    skills: [],
    ...over,
  };
}

function skillRef(over: Partial<ProjectDefinitionRefV1> = {}): ProjectDefinitionRefV1 {
  return agentRef({
    kind: "skill",
    id: "cross-host-runtime-boundary-review",
    relative_path: ".guild/skills/cross-host-runtime-boundary-review/SKILL.md",
    specialist_profile_hash: null,
    specialist_type_hash: null,
    ...over,
  });
}

describe("guild.project_definition_ref.v1 — shape", () => {
  it("accepts a well-formed agent ref and returns a FRESH object", () => {
    const input = agentRef();
    const out = validateProjectDefinitionRefV1(input);
    expect(out).not.toBeNull();
    expect(out).toEqual(input);
    expect(out).not.toBe(input); // fresh, not the caller's object
    expect(out!.skills).not.toBe(input.skills);
  });

  it("accepts a well-formed skill ref with null identity hashes", () => {
    expect(validateProjectDefinitionRefV1(skillRef())).not.toBeNull();
  });

  it("exposes exactly the two kinds", () => {
    expect([...DEFINITION_KINDS]).toEqual(["agent", "skill"]);
  });

  it("rejects an unknown top-level key (closed shape)", () => {
    const bad = { ...agentRef(), extra: 1 };
    expect(validateProjectDefinitionRefV1(bad)).toBeNull();
  });

  it("rejects a MISSING top-level key (closed shape, both directions)", () => {
    const bad: Record<string, unknown> = { ...agentRef() };
    delete bad.source_commit;
    expect(validateProjectDefinitionRefV1(bad)).toBeNull();
  });

  it("rejects the wrong schema_version", () => {
    expect(
      validateProjectDefinitionRefV1({ ...agentRef(), schema_version: "guild.project_definition_ref.v2" })
    ).toBeNull();
  });
});

// ── A2.1 / A2.2 — path safety (R10) ─────────────────────────────────────────

describe("A2.1/A2.2 — relative_path safety", () => {
  const bad = [
    ["absolute posix", "/Users/miguelp/Projects/guild/.guild/agents/x.md"],
    ["windows drive", "C:/guild/.guild/agents/x.md"],
    ["windows backslash", ".guild\\agents\\x.md"],
    ["parent traversal", "../../etc/passwd"],
    ["embedded traversal", ".guild/agents/../../../etc/passwd"],
    ["trailing slash", ".guild/agents/"],
    ["dot prefix", "./.guild/agents/x.md"],
    ["doubled slash", ".guild//agents/x.md"],
    ["empty", ""],
    ["bare dot", "."],
    ["NUL byte", ".guild/agents/x\u0000.md"],
  ] as const;

  it.each(bad)("rejects %s", (_label, p) => {
    expect(isProjectRelativePath(p)).toBe(false);
    expect(validateProjectDefinitionRefV1(agentRef({ relative_path: p }))).toBeNull();
  });

  it("accepts a canonical project-relative path", () => {
    expect(isProjectRelativePath(".guild/agents/architect.md")).toBe(true);
  });

  it("accepts a path containing a dot inside a segment (not a traversal)", () => {
    expect(isProjectRelativePath(".guild/agents/my.role.md")).toBe(true);
  });
});

// ── A2.3 — content hash shape ───────────────────────────────────────────────

describe("A2.3 — content_hash is sha256: + 64 lowercase hex", () => {
  it.each([
    ["no prefix", "a".repeat(64)],
    ["uppercase", `sha256:${"A".repeat(64)}`],
    ["too short", `sha256:${"a".repeat(63)}`],
    ["too long", `sha256:${"a".repeat(65)}`],
    ["wrong algo", `md5:${"a".repeat(64)}`],
    ["empty", ""],
  ])("rejects %s", (_l, h) => {
    expect(isValidContentHash(h)).toBe(false);
    expect(validateProjectDefinitionRefV1(agentRef({ content_hash: h }))).toBeNull();
  });

  it("accepts the canonical form", () => {
    expect(isValidContentHash(HASH_A)).toBe(true);
  });
});

// ── A2.4 — kind ⇄ identity-hash coupling ────────────────────────────────────

describe("A2.4 — kind and identity hashes are coupled", () => {
  it("agent WITHOUT a profile hash is invalid", () => {
    expect(validateProjectDefinitionRefV1(agentRef({ specialist_profile_hash: null }))).toBeNull();
  });

  it("agent WITHOUT a type hash is invalid", () => {
    expect(validateProjectDefinitionRefV1(agentRef({ specialist_type_hash: null }))).toBeNull();
  });

  it("skill WITH a profile hash is invalid (claiming an identity it has not got)", () => {
    expect(
      validateProjectDefinitionRefV1(skillRef({ specialist_profile_hash: IDENT_P }))
    ).toBeNull();
  });

  it("rejects a prefixed identity hash — identity hashes are RAW hex", () => {
    expect(
      validateProjectDefinitionRefV1(agentRef({ specialist_profile_hash: `sha256:${IDENT_P}` }))
    ).toBeNull();
  });
});

// ── A2.5 — this module NEVER computes an identity hash (static assertion) ───

describe("A2.5 — identity is never recomputed here", () => {
  it("the module source contains no identity-hash computation", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "lib", "core", "contracts", "project-definition-ref.ts"),
      "utf8"
    );
    // Strip block + line comments: the header LEGITIMATELY names these functions
    // when explaining the boundary. Only real code references are a violation.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/hashSpecialistProfile/);
    expect(code).not.toMatch(/hashSpecialistType/);
    expect(code).not.toMatch(/from ["'].*specialist-identity/);
    // and no crypto: a locator envelope does not hash — the artifact service does
    expect(code).not.toMatch(/require\(["']crypto["']\)|from ["']crypto["']/);
  });
});

// ── Hardening: exotic inputs map to null, never throw ───────────────────────

describe("hardening — fail-closed, never throws", () => {
  it("rejects null / primitives / arrays", () => {
    for (const v of [null, undefined, 1, "x", true, []]) {
      expect(validateProjectDefinitionRefV1(v)).toBeNull();
    }
  });

  it("rejects an exotic prototype", () => {
    const proto = { specialist_profile_hash: IDENT_P };
    const obj = Object.create(proto);
    Object.assign(obj, agentRef());
    expect(validateProjectDefinitionRefV1(obj)).toBeNull();
  });

  it("rejects an accessor field without invoking it", () => {
    let fired = false;
    const obj = { ...agentRef() };
    Object.defineProperty(obj, "content_hash", {
      get() {
        fired = true;
        return HASH_A;
      },
      enumerable: true,
      configurable: true,
    });
    expect(validateProjectDefinitionRefV1(obj)).toBeNull();
    expect(fired).toBe(false); // the getter was NEVER called
  });

  it("rejects a Proxy outright", () => {
    const p = new Proxy(agentRef(), {});
    expect(validateProjectDefinitionRefV1(p)).toBeNull();
  });

  it("rejects a symbol-keyed field", () => {
    const obj: Record<string | symbol, unknown> = { ...agentRef() };
    obj[Symbol("x")] = 1;
    expect(validateProjectDefinitionRefV1(obj)).toBeNull();
  });

  it("does not throw on a throwing getter", () => {
    const obj = { ...agentRef() };
    Object.defineProperty(obj, "skills", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => validateProjectDefinitionRefV1(obj)).not.toThrow();
    expect(validateProjectDefinitionRefV1(obj)).toBeNull();
  });
});

// ── skills[] ────────────────────────────────────────────────────────────────

describe("skills bundle", () => {
  const s1 = {
    id: "a",
    relative_path: ".guild/skills/a/SKILL.md",
    content_hash: HASH_A,
  };

  it("accepts a populated bundle", () => {
    const out = validateProjectDefinitionRefV1(agentRef({ skills: [s1] }));
    expect(out!.skills).toHaveLength(1);
    expect(out!.skills[0]).not.toBe(s1); // fresh
  });

  it("rejects a duplicate skill id (ambiguous bundle)", () => {
    expect(
      validateProjectDefinitionRefV1(agentRef({ skills: [s1, { ...s1 }] }))
    ).toBeNull();
  });

  it("rejects a sparse hole", () => {
    const sparse: unknown[] = [s1];
    sparse[2] = s1; // index 1 is a hole
    expect(validateProjectDefinitionRefV1(agentRef({ skills: sparse as never }))).toBeNull();
  });

  it("rejects a skill with an absolute path", () => {
    expect(
      validateProjectDefinitionRefV1(
        agentRef({ skills: [{ ...s1, relative_path: "/abs/SKILL.md" }] })
      )
    ).toBeNull();
  });

  it("validatePinnedSkillRef rejects an unknown key", () => {
    expect(validatePinnedSkillRef({ ...s1, extra: 1 })).toBeNull();
  });

  it("rejects a non-array skills", () => {
    expect(validateProjectDefinitionRefV1(agentRef({ skills: {} as never }))).toBeNull();
  });
});

// ── A2.6 — verification is fail-closed ──────────────────────────────────────

describe("A2.6 — verifyRefAgainstBytes is fail-closed", () => {
  it("passes when the hash matches", () => {
    expect(verifyRefAgainstBytes(agentRef(), HASH_A)).toEqual({ ok: true, failure: null });
  });

  it("hash mismatch ⇒ hash_mismatch, never a re-hash-and-continue", () => {
    expect(verifyRefAgainstBytes(agentRef(), HASH_B)).toEqual({
      ok: false,
      failure: "hash_mismatch",
    });
  });

  it("unreadable bytes ⇒ bytes_absent, NEVER 'assume fine'", () => {
    expect(verifyRefAgainstBytes(agentRef(), null)).toEqual({
      ok: false,
      failure: "bytes_absent",
    });
  });

  it("an invalid ref fails as invalid_ref even when bytes match", () => {
    const bad = agentRef({ relative_path: "/absolute/x.md" });
    expect(verifyRefAgainstBytes(bad, HASH_A)).toEqual({ ok: false, failure: "invalid_ref" });
  });

  it("a malformed actual hash ⇒ hash_mismatch", () => {
    expect(verifyRefAgainstBytes(agentRef(), "not-a-hash").failure).toBe("hash_mismatch");
  });
});

describe("isProjectDefinitionRefV1", () => {
  it("returns a plain boolean", () => {
    expect(isProjectDefinitionRefV1(agentRef())).toBe(true);
    expect(isProjectDefinitionRefV1({})).toBe(false);
  });

  // Codex adversarial review round 1: this must NOT be a type predicate. A
  // predicate narrows the caller's ORIGINAL (unsanitized, mutable) object while
  // validation produced a fresh copy — reopening the TOCTOU gap at the API
  // boundary. Guard the contract with a compile-time assertion.
  it("is NOT a type predicate — callers must carry the validator's return value", () => {
    const fn: (v: unknown) => boolean = isProjectDefinitionRefV1;
    expect(typeof fn(agentRef())).toBe("boolean");
  });
});

// ── Codex adversarial review round 1 — regression coverage ─────────────────

describe("skills[] — prototype and out-of-band key hardening (codex round 1)", () => {
  const s1 = { id: "a", relative_path: ".guild/skills/a/SKILL.md", content_hash: HASH_A };

  it("rejects an array with a NON-Array.prototype prototype", () => {
    const arr: unknown[] = [s1];
    Object.setPrototypeOf(arr, { polluted: true });
    expect(validateProjectDefinitionRefV1(agentRef({ skills: arr as never }))).toBeNull();
  });

  it("rejects a subclassed array (accept-and-repair would normalize it away)", () => {
    class Sneaky extends Array {}
    const arr = Sneaky.from([s1]) as unknown[];
    expect(validateProjectDefinitionRefV1(agentRef({ skills: arr as never }))).toBeNull();
  });

  it("rejects an extra non-index own key", () => {
    const arr: unknown[] = [s1];
    Object.defineProperty(arr, "constructor", {
      value: "smuggled",
      enumerable: true,
      configurable: true,
    });
    expect(validateProjectDefinitionRefV1(agentRef({ skills: arr as never }))).toBeNull();
  });

  it("rejects a non-canonical index key like '01'", () => {
    const arr: unknown[] = [s1];
    Object.defineProperty(arr, "01", { value: s1, enumerable: true, configurable: true });
    expect(validateProjectDefinitionRefV1(agentRef({ skills: arr as never }))).toBeNull();
  });

  it("rejects an own index BEYOND length (out-of-band data)", () => {
    const arr: unknown[] = [s1];
    Object.defineProperty(arr, "5", { value: s1, enumerable: true, configurable: true });
    expect(validateProjectDefinitionRefV1(agentRef({ skills: arr as never }))).toBeNull();
  });

  it("still accepts a plain literal array", () => {
    expect(validateProjectDefinitionRefV1(agentRef({ skills: [s1] }))).not.toBeNull();
  });
});
