/**
 * scripts/__tests__/adoption-manifest.test.ts
 *
 * Conformance for `guild.adoption_manifest.v1` (gap-audit F1, plan risk R11,
 * decisions cap-loc-D03/D07/D09/D10). Ids map to the wave-5 matrix §S3 and to the
 * three STANDING assertion classes XA/XB/XC.
 *
 * A3.10 is the single most important negative in the whole matrix: an unknown
 * identity must return `not_found` and NEVER fall back to current content. A
 * reader that silently resolved to today's file would make every historical run
 * quietly WRONG rather than loudly unresolvable.
 */

import {
  ADOPTION_MANIFEST_SCHEMA,
  ADOPTION_REASONS,
  entryDigest,
  resolveHistorical,
  validateAdoptionEntry,
  validateAdoptionManifestV1,
  validateLegacyLocator,
  type AdoptionEntry,
  type AdoptionManifestV1,
} from "../lib/core/contracts/adoption-manifest";
import {
  PROJECT_DEFINITION_REF_SCHEMA,
  type ProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";

const H = (c: string) => `sha256:${c.repeat(64)}`;
const IDENT = (c: string) => c.repeat(64);

function ref(id: string, hash = "a"): ProjectDefinitionRefV1 {
  return {
    schema_version: PROJECT_DEFINITION_REF_SCHEMA,
    project_id: "plugin",
    kind: "agent",
    id,
    relative_path: `.guild/agents/${id}.md`,
    content_hash: H(hash),
    source_commit: "abc1234",
    specialist_profile_hash: IDENT("c"),
    specialist_type_hash: IDENT("d"),
    skills: [],
  };
}

function loc(id: string, hash = "f") {
  return {
    id,
    historical_path: `/Users/miguelp/Projects/guild/.claude/agents/${id}.md`,
    content_hash: H(hash),
    home: "dot-claude-agents" as const,
  };
}

function rawEntry(over: Partial<AdoptionEntry> & { sequence: number }): AdoptionEntry {
  return {
    kind: "agent",
    from: loc("plugin-architect"),
    to: ref("plugin-architect"),
    reason: "migrated",
    detail: null,
    reverses_sequence: null,
    adopted_at: "2026-08-01T00:00:00Z",
    run_id: "run-cap-loc",
    authorized_by: "cap-loc-D09",
    prev_digest: null,
    ...over,
  } as AdoptionEntry;
}

/** Build a manifest with a CORRECT hash chain — the writer's job in production. */
function chain(partials: Array<Partial<AdoptionEntry>>): AdoptionManifestV1 {
  const entries: AdoptionEntry[] = [];
  let prev: string | null = null;
  partials.forEach((p, i) => {
    const e = rawEntry({ ...p, sequence: i + 1, prev_digest: prev });
    entries.push(e);
    prev = entryDigest(e);
  });
  return { schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: "plugin", entries };
}

describe("shape", () => {
  it("accepts a well-formed chained manifest and returns a FRESH object", () => {
    const m = chain([{}]);
    const out = validateAdoptionManifestV1(m);
    expect(out).not.toBeNull();
    expect(out).toEqual(m);
    expect(out).not.toBe(m);
    expect(out!.entries).not.toBe(m.entries);
  });

  it("exposes the six closed reasons", () => {
    expect([...ADOPTION_REASONS]).toEqual([
      "migrated",
      "collapsed",
      "rehomed",
      "renamed",
      "removed",
      "rolled_back",
    ]);
  });

  it("rejects an unknown or missing key (closed shape, both directions)", () => {
    expect(validateAdoptionManifestV1({ ...chain([]), extra: 1 })).toBeNull();
    const bad: Record<string, unknown> = { ...chain([]) };
    delete bad.project_id;
    expect(validateAdoptionManifestV1(bad)).toBeNull();
  });
});

// ── A3.1/A3.2 — append-only, PROVEN by the hash chain ───────────────────────

describe("A3.1/A3.2 — append-only is proven, not merely conventional", () => {
  it("accepts a correctly chained 3-entry manifest", () => {
    const m = chain([{}, { from: loc("b") }, { from: loc("c") }]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
  });

  it("REJECTS deletion-with-renumbering — the only deletion anyone would perform", () => {
    const m = chain([{}, { from: loc("b") }, { from: loc("c") }]);
    // Drop entry 2 and renumber 3 → 2. A gap-free 1..N check alone would PASS this.
    const tampered: AdoptionManifestV1 = {
      ...m,
      entries: [m.entries[0], { ...m.entries[2], sequence: 2 }],
    };
    expect(validateAdoptionManifestV1(tampered)).toBeNull();
  });

  it("REJECTS an edited earlier entry — the chain breaks at the cut", () => {
    const m = chain([{}, { from: loc("b") }]);
    const tampered: AdoptionManifestV1 = {
      ...m,
      entries: [{ ...m.entries[0], authorized_by: "forged" }, m.entries[1]],
    };
    expect(validateAdoptionManifestV1(tampered)).toBeNull();
  });

  it("rejects a plain gap", () => {
    const m = chain([{}, { from: loc("b") }]);
    expect(
      validateAdoptionManifestV1({ ...m, entries: [m.entries[0], { ...m.entries[1], sequence: 3 }] })
    ).toBeNull();
  });

  it("sequence 1 must have a NULL prev_digest; later entries must not", () => {
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, prev_digest: IDENT("e") }))).toBeNull();
    expect(validateAdoptionEntry(rawEntry({ sequence: 2, prev_digest: null }))).toBeNull();
  });

  it("entryDigest is deterministic and key-order independent", () => {
    const e = rawEntry({ sequence: 1 });
    const reordered = JSON.parse(JSON.stringify({ ...e })) as AdoptionEntry;
    expect(entryDigest(e)).toBe(entryDigest(reordered));
  });
});

// ── XB — Rule 5: canonical-only locators (alias dedup bypass) ───────────────

describe("XB — non-canonical locators are REJECTED, never normalized", () => {
  const aliases = [
    ["dot segment", "/a/./x.md"],
    ["parent segment", "/a/../x.md"],
    ["doubled slash", "/a//x.md"],
    ["trailing slash", "/a/x/"],
    ["backslash", "\\a\\x.md"],
    ["windows drive", "C:/a/x.md"],
  ] as const;

  it.each(aliases)("rejects %s in historical_path", (_l, p) => {
    expect(validateLegacyLocator({ ...loc("x"), historical_path: p })).toBeNull();
  });

  it("XB.2 dedup is sound BY CONSTRUCTION — only one spelling validates", () => {
    const canonical = "/Users/miguelp/Projects/guild/.claude/agents/x.md";
    const alias = "/Users/miguelp/Projects/guild/.claude/./agents/x.md";
    expect(validateLegacyLocator({ ...loc("x"), historical_path: canonical })).not.toBeNull();
    expect(validateLegacyLocator({ ...loc("x"), historical_path: alias })).toBeNull();
  });

  it("XB.3 two spellings of one file cannot BOTH enter the manifest", () => {
    const m = chain([
      { from: { ...loc("a"), historical_path: "/g/.claude/agents/a.md" } },
      { from: { ...loc("a"), historical_path: "/g/.claude/./agents/a.md" }, to: ref("a2") },
    ]);
    // The aliased second entry is malformed ⇒ the WHOLE manifest rejects (XC.6).
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("an absolute historical_path IS allowed — that is its job", () => {
    expect(validateLegacyLocator(loc("x"))).not.toBeNull();
  });

  it("but the SUCCESSOR ref still may not be absolute (S2's rule)", () => {
    const bad = rawEntry({
      sequence: 1,
      to: { ...ref("x"), relative_path: "/absolute/x.md" } as ProjectDefinitionRefV1,
    });
    expect(validateAdoptionEntry(bad)).toBeNull();
  });
});

// ── XC — Rule 6: bounded, shape-checked scalars ────────────────────────────

describe("XC — every scalar is bounded and shape-checked (body smuggling)", () => {
  const BODY = "x".repeat(12_000); // the 12 KB agent definition that fooled S4

  it("XC.1 rejects a 12 KB body in every free-text scalar", () => {
    expect(validateLegacyLocator({ ...loc("x"), id: BODY })).toBeNull();
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, detail: BODY }))).toBeNull();
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, run_id: BODY }))).toBeNull();
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, authorized_by: BODY }))).toBeNull();
  });

  it("XC.2 rejects control characters — a body has a newline, an id never does", () => {
    expect(validateLegacyLocator({ ...loc("x"), id: "a\nb" })).toBeNull();
    expect(
      validateAdoptionEntry(rawEntry({ sequence: 1, detail: "line1\nline2" }))
    ).toBeNull();
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, run_id: "run\u0000x" }))).toBeNull();
  });

  it("XC.3 content_hash is sha256-shaped, not any string", () => {
    expect(validateLegacyLocator({ ...loc("x"), content_hash: "deadbeef" })).toBeNull();
    expect(validateLegacyLocator({ ...loc("x"), content_hash: null })).not.toBeNull();
  });

  it("XC.4 adopted_at is RFC3339-shaped", () => {
    for (const bad of ["yesterday", "2026-08-01", "01/08/2026"]) {
      expect(validateAdoptionEntry(rawEntry({ sequence: 1, adopted_at: bad }))).toBeNull();
    }
    expect(
      validateAdoptionEntry(rawEntry({ sequence: 1, adopted_at: "2026-08-01T12:00:00.123Z" }))
    ).not.toBeNull();
  });

  it("XC.5 ids are token-shaped and NOT path-shaped", () => {
    for (const bad of ["a/../b", "a/b", "/abs", "has space"]) {
      expect(validateLegacyLocator({ ...loc("x"), id: bad })).toBeNull();
    }
  });

  it("XC.6 NO accept-by-attrition — a malformed entry rejects the whole manifest", () => {
    const m = chain([{}, { from: loc("b") }]);
    const withMalformed: AdoptionManifestV1 = {
      ...m,
      entries: [{ ...m.entries[0], run_id: "bad id with spaces" }, m.entries[1]],
    };
    // A validator that skipped the malformed entry and accepted the valid one
    // would turn malformed input into a silent pass.
    expect(validateAdoptionManifestV1(withMalformed)).toBeNull();
  });
});

// ── A3.4/A3.5 + the TYPED rollback reference ───────────────────────────────

describe("A3.4/A3.5 — reason couples to `to`, `detail`, and `reverses_sequence`", () => {
  it('reason "removed" REQUIRES to === null, and vice versa', () => {
    expect(
      validateAdoptionEntry(rawEntry({ sequence: 1, reason: "removed", detail: "d" }))
    ).toBeNull();
    expect(
      validateAdoptionEntry(rawEntry({ sequence: 1, to: null, reason: "migrated" }))
    ).toBeNull();
  });

  it.each(["collapsed", "removed", "rolled_back"] as const)(
    "%s REQUIRES a detail — the lossy reasons must be explained",
    (reason) => {
      const to = reason === "removed" ? null : ref("x");
      const rev = reason === "rolled_back" ? 1 : null;
      expect(
        validateAdoptionEntry(
          rawEntry({ sequence: 2, reason, to, detail: null, reverses_sequence: rev, prev_digest: IDENT("a") })
        )
      ).toBeNull();
    }
  );

  it("reverses_sequence is non-null IFF rolled_back", () => {
    expect(
      validateAdoptionEntry(rawEntry({ sequence: 1, reason: "migrated", reverses_sequence: 1 }))
    ).toBeNull();
    expect(
      validateAdoptionEntry(
        rawEntry({ sequence: 2, reason: "rolled_back", detail: "d", reverses_sequence: null, prev_digest: IDENT("a") })
      )
    ).toBeNull();
  });

  it("a rollback may not reference itself or a FUTURE sequence", () => {
    for (const rev of [2, 3]) {
      expect(
        validateAdoptionEntry(
          rawEntry({ sequence: 2, reason: "rolled_back", detail: "d", reverses_sequence: rev, prev_digest: IDENT("a") })
        )
      ).toBeNull();
    }
  });

  it("the manifest PROVES the rollback actually reverses its target", () => {
    // A "rolled_back" label attached to an unrelated edge must be rejected.
    const m = chain([
      { from: loc("A"), to: ref("B") },
      {
        from: loc("UNRELATED"), // does not match entry 1's successor
        to: ref("A", "b"),
        reason: "rolled_back",
        detail: "claims to reverse 1",
        reverses_sequence: 1,
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("authorized_by is mandatory and token-shaped — no adoption without authorization", () => {
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, authorized_by: "" }))).toBeNull();
  });
});

// ── The reader contract ─────────────────────────────────────────────────────

/** A genuine rollback: entry 2's `from` matches entry 1's successor exactly. */
function rollbackManifest(): AdoptionManifestV1 {
  const to1 = ref("B");
  return chain([
    { from: loc("A"), to: to1 },
    {
      from: { id: "B", historical_path: "/g/.guild/agents/B.md", content_hash: to1.content_hash, home: "project-guild" },
      // A GENUINE rollback returns to the target's SOURCE identity — same id AND
      // same bytes. Codex round 2 (#3) tightened the validator to require this;
      // the old fixture returned to a DIFFERENT hash, which is not a reversal.
      to: ref("A", "f"),
      reason: "rolled_back",
      detail: "reverses sequence 1 — cutover reverted",
      reverses_sequence: 1,
      authorized_by: "cap-loc-D03",
    },
  ]);
}

describe("A3.7 — chains, including forward-append rollback", () => {
  it("A → B → C resolves to C with the full trail", () => {
    const b = ref("B");
    const m = chain([
      { from: loc("A"), to: b },
      {
        from: { id: "B", historical_path: "/g/.guild/agents/B.md", content_hash: b.content_hash, home: "project-guild" },
        to: ref("C"),
      },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("C");
    expect(r.trail).toEqual([1, 2]);
  });

  it("ROLLBACK as a forward append: A resolves to A' (not B)", () => {
    const r = resolveHistorical(rollbackManifest(), { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("A");
    expect(r.ref?.content_hash).toBe(H("f")); // back to the ORIGINAL bytes
    expect(r.trail).toEqual([1, 2]);
  });

  it("the INTERMEDIATE era still resolves — B was genuinely used", () => {
    const r = resolveHistorical(rollbackManifest(), { kind: "agent", id: "B" });
    expect(r.status).toBe("resolved");
    expect(r.trail).toEqual([2]);
  });
});

describe("A3.10/A3.11 — not_found is a REAL answer", () => {
  it("an unknown id returns not_found and NEVER current content", () => {
    const r = resolveHistorical(chain([{ from: loc("A"), to: ref("B") }]), {
      kind: "agent",
      id: "totally-unknown",
    });
    expect(r.status).toBe("not_found");
    expect(r.ref).toBeNull(); // ← the R11 rule
    expect(r.trail).toEqual([]);
  });

  it("removed is DISTINCT from not_found", () => {
    const m = chain([
      { from: loc("A"), to: null, reason: "removed", detail: "dropped" },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("removed");
    expect(resolveHistorical(m, { kind: "agent", id: "B" }).status).toBe("not_found");
  });

  it("an empty manifest returns not_found, not an error", () => {
    expect(resolveHistorical(chain([]), { kind: "agent", id: "A" }).status).toBe("not_found");
  });

  it("an INVALID manifest yields ambiguous — never a partial walk", () => {
    expect(resolveHistorical({ nonsense: true }, { kind: "agent", id: "A" })).toEqual({
      status: "ambiguous",
      ref: null,
      trail: [],
    });
  });
});

// ── identity-matched traversal (codex round 1, #2) ─────────────────────────

describe("traversal matches IDENTITY, not bare ids", () => {
  it("a later UNRELATED definition reusing an id cannot hijack the chain", () => {
    const b = ref("B");
    const m = chain([
      { from: loc("A"), to: b },
      // An unrelated later adoption of a DIFFERENT "B" (different bytes).
      {
        from: { id: "B", historical_path: "/g/other/B.md", content_hash: H("9"), home: "project-guild" },
        to: ref("WRONG"),
      },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    // Must resolve to the real successor, never to WRONG.
    expect(r.ref?.id).toBe("B");
    expect(r.trail).toEqual([1]);
  });

  it("kind is part of identity — an agent chain never follows a skill entry", () => {
    const m = chain([{ from: loc("A"), to: ref("B") }]);
    expect(resolveHistorical(m, { kind: "skill", id: "A" }).status).toBe("not_found");
  });

  it("a caller-supplied content_hash disambiguates the first hop", () => {
    const m = chain([{ from: loc("A", "f"), to: ref("B") }]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") }).status).toBe(
      "resolved"
    );
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("9") }).status).toBe(
      "not_found"
    );
  });
});

describe("A3.6 — many-to-one legal, one-to-many ambiguous", () => {
  it("a COLLAPSE resolves both predecessors to the survivor", () => {
    const survivor = ref("diagram-motion-designer");
    const m = chain([
      { from: loc("umbrella-dmd"), to: survivor, reason: "collapsed", detail: "merged (D10)", authorized_by: "cap-loc-D10" },
      { from: loc("benchmark-dmd"), to: survivor, reason: "collapsed", detail: "merged (D10)", authorized_by: "cap-loc-D10" },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "umbrella-dmd" }).ref?.id).toBe(
      "diagram-motion-designer"
    );
    expect(resolveHistorical(m, { kind: "agent", id: "benchmark-dmd" }).ref?.id).toBe(
      "diagram-motion-designer"
    );
  });

  it("a FORK is ambiguous, never a guess", () => {
    const m = chain([
      { from: loc("A"), to: ref("B") },
      { from: loc("A"), to: ref("C") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
  });
});

// ── API-boundary hardening (codex round 1, #5) ─────────────────────────────

describe("the resolver is self-validating and returns a FROZEN ref", () => {
  it("the returned ref is deep-frozen — a caller cannot mutate the manifest through it", () => {
    const r = resolveHistorical(chain([{ from: loc("A"), to: ref("B") }]), {
      kind: "agent",
      id: "A",
    });
    expect(Object.isFrozen(r.ref)).toBe(true);
    expect(Object.isFrozen(r.ref!.skills)).toBe(true);
  });

  it("mutating the input manifest AFTER validation cannot affect a prior result", () => {
    const m = chain([{ from: loc("A"), to: ref("B") }]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    (m.entries as AdoptionEntry[]).push(rawEntry({ sequence: 2, from: loc("B") }));
    expect(r.ref?.id).toBe("B"); // the earlier result is a snapshot
  });

  it("a Proxy manifest smuggled through a type assertion is REJECTED", () => {
    const m = chain([{ from: loc("A"), to: ref("B") }]);
    expect(resolveHistorical(new Proxy(m, {}), { kind: "agent", id: "A" }).status).toBe(
      "ambiguous"
    );
  });
});

// ── hardening ───────────────────────────────────────────────────────────────

describe("hardening — fail-closed, never throws", () => {
  it("rejects primitives, arrays, null", () => {
    for (const v of [null, undefined, 1, "x", []]) {
      expect(validateAdoptionManifestV1(v)).toBeNull();
    }
  });

  it("rejects an accessor field WITHOUT invoking it", () => {
    let fired = false;
    const m: Record<string, unknown> = { ...chain([]) };
    Object.defineProperty(m, "entries", {
      get() {
        fired = true;
        return [];
      },
      enumerable: true,
      configurable: true,
    });
    expect(validateAdoptionManifestV1(m)).toBeNull();
    expect(fired).toBe(false);
  });

  it("rejects a Proxy and a polluted entries prototype", () => {
    expect(validateAdoptionManifestV1(new Proxy(chain([]), {}))).toBeNull();
    const arr: unknown[] = [];
    Object.setPrototypeOf(arr, { polluted: true });
    expect(validateAdoptionManifestV1({ ...chain([]), entries: arr })).toBeNull();
  });

  it("rejects a symbol-keyed field (getOwnPropertyNames does not see symbols)", () => {
    const m: Record<string | symbol, unknown> = { ...chain([]) };
    m[Symbol("x")] = 1;
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("does not throw on a throwing getter", () => {
    const m: Record<string, unknown> = { ...chain([]) };
    Object.defineProperty(m, "project_id", {
      get() {
        throw new Error("boom");
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => validateAdoptionManifestV1(m)).not.toThrow();
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });
});


// ── CYCLE / ROUND-TRIP SEMANTICS (the D3 close-out) ────────────────────────
//
// My suite previously had ZERO cycle tests. I had one in the draft I discarded,
// dropped it in the rewrite, and never re-added it — a coverage regression that
// survived four codex rounds, because the FIX was reviewed and the TEST was not.
//
// These assert BOTH DIRECTIONS, so the rule cannot be satisfied by always
// answering one way: a legitimate round trip / re-adoption must RESOLVE, and a
// genuine destination conflict must be AMBIGUOUS.

describe("cycle + round-trip semantics", () => {
  const A = (h: string) => loc("A", h);

  it("TERMINATION is structural — forward-only bounds the walk, no visited-set needed", () => {
    // A tight A->B->A loop. minSequence strictly increases, so an entry can never
    // be revisited and the walk is bounded by entry count. An identity-visited set
    // would add nothing here — and would BREAK the re-adoption case below.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
    ]);
    const t0 = Date.now();
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe("resolved");
  });

  it("DIRECTION 1 — round trip to DIFFERENT bytes resolves to the rollback destination", () => {
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "e") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("A");
    expect(r.ref?.content_hash).toBe(H("e"));
    expect(r.trail).toEqual([1, 2]);
  });

  it("DIRECTION 1b — round trip to IDENTICAL bytes ALSO resolves (not ambiguous)", () => {
    // The spec-author call: landing back on byte-identical content is an ordinary
    // rollback, not a cycle. A resolves to where A now lives, which is A.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("f"));
  });

  it("DIRECTION 2 — RE-ADOPTION after a round trip resolves to the LATEST edge", () => {
    // adopt -> roll back -> re-adopt. Entries 1 and 3 both start from A, so the old
    // multiplicity check called this a fork and answered "nothing" for a history
    // D03 is explicitly designed to record.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
      { from: A("f"), to: ref("B", "b") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B");
    // The trail is [3], NOT [1,2,3]. An earlier version took the EARLIEST match to
    // record "complete provenance" — and that resolved to the WRONG BYTES on
    // A->B(1), B->C(2), A->B(3): it took 1, walked into 2, and returned C while the
    // latest history said B. The receipt records what was CONSULTED to reach the
    // answer; consulting superseded edges would misreport the current history.
    expect(r.trail).toEqual([3]);
  });

  it("REGRESSION (codex r4 #1) — a duplicate edge must not steer resolution to the wrong bytes", () => {
    // A->B(1), B->C(2), A->B(3). Entries 1 and 3 share a destination, so the
    // earliest-match version selected 1, followed 2, and returned C. The latest
    // history (3) says B, and B is the answer.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      { from: A("f"), to: ref("B", "b") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B"); // NOT "C"
    expect(r.trail).toEqual([3]);
  });

  it("REGRESSION (codex r4 #2) — different SOURCE hashes are two identities, not one", () => {
    // With a hash-less query the predicate treats from.content_hash as a wildcard,
    // so A@h1->B and A@h2->B would look like one re-adopted source. They are two.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: A("e"), to: ref("B", "b") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
  });

  it("REGRESSION (codex r5) — same id+hash at DIFFERENT source paths are two sources", () => {
    // A(/p1,h)->B, B->C, A(/p2,h)->B. Without the full-locator check a pathless
    // query returned B and a /p1-qualified query returned C — one manifest, two
    // answers, depending only on how you asked.
    const m = chain([
      { from: { id: "A", historical_path: "/g/p1/A.md", content_hash: H("f"), home: "project-guild" }, to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      { from: { id: "A", historical_path: "/g/p2/A.md", content_hash: H("f"), home: "project-guild" }, to: ref("B", "b") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
  });

  it("REGRESSION (codex r4 #3) — same bytes at DIFFERENT paths are different locators", () => {
    // This function resolves a REFERENCE, not a digest. Equal content at two paths
    // must not collapse into one destination.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
      { from: A("f"), to: { ...ref("B", "b"), relative_path: ".guild/agents/B-moved.md" } },
    ]);
    expect(
      resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") }).status
    ).toBe("ambiguous");
  });

  it("REGRESSION (codex r4 #4) — entryDigest never throws on a hostile entry", () => {
    const hostile = new Proxy(rawEntry({ sequence: 1 }), {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => entryDigest(hostile)).not.toThrow();
    // The sentinel can never collide with a real digest, so a chain built on it fails.
    expect(entryDigest(hostile)).toBe("invalid-entry");
  });

  it("DIRECTION 3 — a genuine DESTINATION CONFLICT is still ambiguous", () => {
    // Same source bytes adopted to two DIFFERENT successors. No principled pick
    // exists, so guessing would silently resolve to the wrong bytes.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: A("f"), to: ref("C", "c") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("ambiguous");
    expect(r.ref).toBeNull();
    expect(r.trail).toEqual([1, 2]); // both conflicting entries named in the receipt
  });

  it("THE DISCRIMINATOR IS THE DESTINATION, not the multiplicity", () => {
    // Both manifests have two entries starting from A. Only the destinations differ.
    // If multiplicity alone decided, these would answer the same — and one would be wrong.
    const sameDest = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
      { from: A("f"), to: ref("B", "b") },
    ]);
    const diffDest = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: A("f"), to: ref("C", "c") },
    ]);
    expect(resolveHistorical(sameDest, { kind: "agent", id: "A", content_hash: H("f") }).status).toBe(
      "resolved"
    );
    expect(resolveHistorical(diffDest, { kind: "agent", id: "A", content_hash: H("f") }).status).toBe(
      "ambiguous"
    );
  });

  it("a longer legitimate chain with two round trips still resolves", () => {
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.trail.length).toBeGreaterThanOrEqual(2);
  });
});
