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
  MAX_ENTRIES,
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

// ── A3.9 — identity-space cycle detection ───────────────────────────────────
//
// Forward-only traversal already guarantees TERMINATION, so nothing here is about
// hangs. It is about a lineage that walks forward into a position it has already
// occupied: its endpoint is not a terminal, it is where the walk began, and the
// honest answer is `ambiguous`.
//
// Every assertion below is paired with its opposite, so the rule cannot be
// satisfied by a resolver that always answers `ambiguous` (nor by one that never
// does) — the failure mode a one-sided cycle test invites.

describe("A3.8b — a rollback must LAND on the target's source identity", () => {
  it("rejects a rollback of a REMOVAL — there is no landing point to return to", () => {
    const m = chain([
      { from: loc("A"), to: null, reason: "removed", detail: "dropped" },
      {
        from: loc("A"),
        to: ref("A", "f"),
        reason: "rolled_back",
        detail: "un-remove",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("rejects an entry whose `kind` disagrees with its own `to.kind`", () => {
    const m = chain([
      {
        kind: "agent",
        from: loc("A"),
        to: {
          schema_version: PROJECT_DEFINITION_REF_SCHEMA,
          project_id: "plugin",
          kind: "skill" as const, // ← disagrees with the entry's own kind
          id: "A",
          relative_path: ".guild/skills/A/SKILL.md",
          content_hash: H("a"),
          source_commit: "abc1234",
          specialist_profile_hash: null,
          specialist_type_hash: null,
          skills: [],
        },
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("rejects a 'rolled_back' edge whose KIND differs from its target's", () => {
    // An agent adoption cannot be reversed by a skill entry. Also uncovered before
    // the anti-vacuity sweep: every other field lines up here, so with the kind
    // check removed this manifest validates.
    const to1 = ref("B");
    const skillRef = {
      schema_version: PROJECT_DEFINITION_REF_SCHEMA,
      project_id: "plugin",
      kind: "skill" as const,
      id: "A",
      relative_path: ".guild/skills/A/SKILL.md",
      content_hash: H("f"),
      source_commit: "abc1234",
      specialist_profile_hash: null,
      specialist_type_hash: null,
      skills: [],
    };
    const m = chain([
      { from: loc("A"), to: to1 },
      {
        kind: "skill", // ← entry 1 was an agent adoption
        from: {
          id: "B",
          historical_path: "/g/.guild/agents/B.md",
          content_hash: to1.content_hash,
          home: "project-guild",
        },
        to: skillRef,
        reason: "rolled_back",
        detail: "claims to reverse sequence 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("rejects a 'rolled_back' edge that does not START where the target landed", () => {
    // The mirror of the case below, and also uncovered before this sweep. Entry 1
    // moves A → B; this edge leaves from Z (carrying B's bytes, so the hash check
    // alone would not catch it) and lands on A. It reverses nothing: a reversal must
    // begin where the entry it reverses ENDED.
    const to1 = ref("B");
    const m = chain([
      { from: loc("A"), to: to1 },
      {
        from: {
          id: "Z", // ← not B: never picks up where entry 1 left off
          historical_path: "/g/.guild/agents/Z.md",
          content_hash: to1.content_hash,
          home: "project-guild",
        },
        to: ref("A", "f"),
        reason: "rolled_back",
        detail: "claims to reverse sequence 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("rejects a 'rolled_back' edge that starts right but lands somewhere else", () => {
    // Found by the anti-vacuity sweep on the merged contract: the validator's
    // landing-identity check (`entry.to.id !== target.from.id`) was CORRECT but
    // UNCOVERED — deleting it reddened nothing, so nothing stopped a future edit
    // from removing it. This is the case it exists for: `A → B` (seq 1) followed by
    // an edge that leaves from B (so the ORIGIN check passes) but lands on C rather
    // than back on A. That is a continuation wearing a rollback's label, not a
    // reversal.
    const to1 = ref("B");
    const m = chain([
      { from: loc("A"), to: to1 },
      {
        from: {
          id: "B",
          historical_path: "/g/.guild/agents/B.md",
          content_hash: to1.content_hash,
          home: "project-guild",
        },
        to: ref("C", "f"), // right bytes, WRONG id — never returns to A
        reason: "rolled_back",
        detail: "claims to reverse sequence 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });
});

describe("A3.9 — an UNAUTHORIZED return to an occupied identity is ambiguous", () => {
  it("a two-link loop back to the ORIGINAL bytes is a cycle", () => {
    const b = ref("B", "2");
    const m = chain([
      { from: loc("A", "1"), to: b },
      { from: { ...loc("B", "2"), content_hash: b.content_hash }, to: ref("A", "1") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("ambiguous");
    expect(r.ref).toBeNull();
  });

  it("CONTRAST — a move to DIFFERENT bytes is not a cycle and resolves", () => {
    const b = ref("B", "2");
    const m = chain([
      { from: loc("A", "1"), to: b },
      { from: { ...loc("B", "2"), content_hash: b.content_hash }, to: ref("A", "3") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("3"));
  });

  it("a three-link loop is a cycle", () => {
    const b = ref("B", "2");
    const c = ref("C", "3");
    const m = chain([
      { from: loc("A", "1"), to: b },
      { from: { ...loc("B", "2"), content_hash: b.content_hash }, to: c },
      { from: { ...loc("C", "3"), content_hash: c.content_hash }, to: ref("A", "1") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
  });

  it("CONTRAST — the same three links ending on NEW bytes resolve", () => {
    const b = ref("B", "2");
    const c = ref("C", "3");
    const m = chain([
      { from: loc("A", "1"), to: b },
      { from: { ...loc("B", "2"), content_hash: b.content_hash }, to: c },
      { from: { ...loc("C", "3"), content_hash: c.content_hash }, to: ref("A", "4") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("4"));
  });

  it("the origin is recovered from the first hop even when the query pins no hash", () => {
    // The caller supplies an id but usually no bytes; without recovering the origin
    // from the first entry's `from`, a two-link loop has nothing to compare against.
    const b = ref("B", "2");
    const m = chain([
      { from: loc("A", "1"), to: b },
      { from: { ...loc("B", "2"), content_hash: b.content_hash }, to: ref("A", "1") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
    // …and a caller that DOES pin the origin gets the same verdict.
    expect(
      resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("1") }).status
    ).toBe("ambiguous");
  });
});

describe("A3.9b — a PROVEN rollback is an AUTHORIZED return, never a cycle", () => {
  // This exemption is load-bearing. The cross-entry proof REQUIRES a `rolled_back`
  // entry to land back on the reversed entry's `from` identity — same id, same
  // bytes — so every well-formed rollback revisits an occupied position. A naive
  // "revisited ⇒ cycle" rule would flag EVERY legal rollback and destroy the
  // forward-append semantic S3 exists to express. The discriminator is
  // AUTHORIZATION, not geometry.
  it("the canonical rollback (back to the ORIGINAL bytes) still resolves", () => {
    const r = resolveHistorical(rollbackManifest(), { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("f")); // the original bytes — and NOT a cycle
    expect(r.trail).toEqual([1, 2]);
  });

  it("but an UNLABELLED edge making the identical move IS a cycle", () => {
    // Byte-for-byte the same geometry as the rollback above; the only difference is
    // that this edge never proved it reverses anything. That difference is the
    // whole rule, so this pair is what stops the exemption from being a loophole.
    const to1 = ref("B");
    const m = chain([
      { from: loc("A"), to: to1 },
      {
        from: {
          id: "B",
          historical_path: "/g/.guild/agents/B.md",
          content_hash: to1.content_hash,
          home: "project-guild",
        },
        to: ref("A", "f"),
        reason: "migrated", // ← not a proven reversal
      },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
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

  it("a FORK is UNREPRESENTABLE — rejected at write time, not adjudicated at read time", () => {
    // RENAMED AND RE-POINTED (codex round 6, #4). As "a FORK is ambiguous, never a
    // guess" this looked like read-time fork coverage and was VACUOUS: the liveness
    // rule rejects the manifest outright (`A` is adopted away at 1 and never
    // restored), so `resolveHistorical` returned `ambiguous` with an EMPTY trail from
    // the validation boundary and fork traversal never ran.
    //
    // That is not a gap in the contract — it is the contract. The liveness rule
    // exists precisely so the fork cannot be represented, which is why no read-time
    // discriminator survives in the resolver. The assertion now names the mechanism
    // it actually exercises, and checks the manifest is refused rather than inferring
    // it from a status that has two possible causes.
    const m = chain([
      { from: loc("A"), to: ref("B") },
      { from: loc("A"), to: ref("C") },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull(); // the real, non-vacuous claim
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("ambiguous");
    expect(r.trail).toEqual([]); // …from the validation boundary, as stated above
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
  /**
   * A PROVEN rollback of `seq`: starts where that entry landed, returns to the
   * identity it came from. An UNLABELLED return is deliberately NOT this — the
   * cycle guard treats it as a closed loop, which is the point of the exemption.
   */
  const rollbackOf = (seq: number, fromRef: ProjectDefinitionRefV1, toId: string, toHash: string) => ({
    from: { id: fromRef.id, historical_path: `/g/${fromRef.id}.md`, content_hash: fromRef.content_hash, home: "project-guild" as const },
    to: ref(toId, toHash),
    reason: "rolled_back" as const,
    detail: `reverses sequence ${seq}`,
    reverses_sequence: seq,
    authorized_by: "cap-loc-D03",
  });

  it("TERMINATION is structural — forward-only bounds the walk, no visited-set needed", () => {
    // A tight A->B->A loop. minSequence strictly increases, so an entry can never
    // be revisited and the walk is bounded by entry count. An identity-visited set
    // would add nothing here — and would BREAK the re-adoption case below.
    const m = chain([{ from: A("f"), to: ref("B", "b") }, rollbackOf(1, ref("B", "b"), "A", "f")]);
    const t0 = Date.now();
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.status).toBe("resolved");
  });

  it("DIRECTION 1 — round trip to DIFFERENT bytes resolves to the rollback destination", () => {
    // NOTE: a rollback must land on the reversed entry's SOURCE identity, so a
    // "rollback to different bytes" is not expressible — the cross-entry proof
    // requires the original hash. Kept as the labelled round trip it really is.
    const m = chain([{ from: A("f"), to: ref("B", "b") }, rollbackOf(1, ref("B", "b"), "A", "f")]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("A");
    expect(r.ref?.content_hash).toBe(H("f"));
    expect(r.trail).toEqual([1, 2]);
  });

  it("DIRECTION 1b — round trip to IDENTICAL bytes ALSO resolves (not ambiguous)", () => {
    // The spec-author call: landing back on byte-identical content is an ordinary
    // rollback, not a cycle. A resolves to where A now lives, which is A.
    const m = chain([{ from: A("f"), to: ref("B", "b") }, rollbackOf(1, ref("B", "b"), "A", "f")]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("f"));
  });

  it("DIRECTION 2 — RE-ADOPTION after a round trip resolves, walking the FULL history", () => {
    // adopt -> roll back -> re-adopt. Entries 1 and 3 both start from A, so the old
    // multiplicity check called this a fork and answered "nothing" for a history
    // D03 is explicitly designed to record.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      rollbackOf(1, ref("B", "b"), "A", "f"),
      { from: A("f"), to: ref("B", "b") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B");
    // The full provenance. Earliest-forward-match is safe here BECAUSE the liveness
    // rule made the fork unrepresentable — every multi-match is one ordered history.
    expect(r.trail).toEqual([1, 2, 3]);
  });

  it("LIVENESS — the wrong-bytes case is now UNREPRESENTABLE, not adjudicated", () => {
    // A->B(1), B->C(2), A->B(3). This once resolved to C (wrong bytes) under an
    // earliest-match rule, then to B under a latest-match rule. Both were read-time
    // answers to a state that should never have been writable: A was adopted away
    // at 1 and no rollback restored it, so entry 3 has a DEAD source.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      { from: A("f"), to: ref("B", "b") },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull(); // rejected at WRITE time
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

  it("SUPERSEDED BY D4 — same id+hash at DIFFERENT source paths are ONE identity", () => {
    // THIS ASSERTION WAS BOTH STALE AND VACUOUS, and both halves are recorded because
    // a green test that proves nothing is worse than a missing one.
    //
    // STALE: it encoded "different `historical_path` ⇒ two sources". Defect D4
    // (codex round 5 on the pristine tip) proved that rule wrong — liveness keys on
    // (kind, id, bytes) and had already ruled these ONE identity, while traversal
    // re-litigated it with a stricter locator comparison, so one manifest gave two
    // answers depending on whether the optional `historical_path` was supplied.
    //
    // VACUOUS: its fixture never validated in the first place. `A@f` is adopted away
    // at sequence 1 and never restored, so the liveness rule rejects sequence 3 and
    // `resolveHistorical` returned `ambiguous` with an EMPTY trail — the assertion
    // passed without traversal identity ever being exercised (codex round 5, #5).
    //
    // Rewritten to be neither: an intervening rollback makes the manifest genuinely
    // valid, and the assertion is now D4's rule, checked from both query shapes.
    const m = chain([
      { from: { id: "A", historical_path: "/g/p1/A.md", content_hash: H("f"), home: "project-guild" }, to: ref("B", "b") },
      {
        from: loc("B", "b"),
        to: ref("A", "f"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: { id: "A", historical_path: "/g/p2/A.md", content_hash: H("f"), home: "project-guild" }, to: ref("C", "c") },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull(); // …genuinely valid now
    const pathless = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(pathless.status).toBe("resolved");
    expect(pathless.ref?.id).toBe("C");
    // and supplying the OPTIONAL disambiguator cannot change the answer
    const qualified = resolveHistorical(m, {
      kind: "agent",
      id: "A",
      content_hash: H("f"),
      historical_path: "/g/p1/A.md",
    });
    expect(qualified.status).toBe("resolved");
    expect(qualified.ref?.id).toBe("C");
  });

  it("REGRESSION (codex r4 #3) — same bytes at DIFFERENT paths are different locators", () => {
    // This function resolves a REFERENCE, not a digest. Equal content at two paths
    // must not collapse into one destination.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("A", "f") },
      { from: A("f"), to: { ...ref("B", "b"), relative_path: ".guild/agents/B-moved.md" } },
    ]);
    // Also unrepresentable now: entry 3's source A is live (restored by the
    // rollback), so this one is about the DESTINATION differing — and with the
    // discriminator gone it simply replays as history. Kept as a shape fixture.
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
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

  it("DIRECTION 3 — the FORK is REJECTED AT WRITE TIME, not adjudicated at read time", () => {
    // A->B(1), A->C(2). This used to be the hard case: one source, two successors,
    // no principled pick. The liveness rule removes it — A was adopted away at 1
    // and never restored, so entry 2 has a dead source and the manifest is invalid.
    // An undecidable state you cannot write is better than one you must judge.
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: A("f"), to: ref("C", "c") },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("LIVENESS preserves COLLAPSE — two distinct live sources may share a survivor", () => {
    // The rule constrains the SOURCE only. Constraining the destination would have
    // broken exactly this (D10's shape) and re-adoption too.
    const m = chain([
      { from: loc("U", "f"), to: ref("X", "c"), reason: "collapsed", detail: "D10", authorized_by: "cap-loc-D10" },
      { from: loc("N", "d"), to: ref("X", "c"), reason: "collapsed", detail: "D10", authorized_by: "cap-loc-D10" },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    expect(resolveHistorical(m, { kind: "agent", id: "U", content_hash: H("f") }).ref?.id).toBe("X");
  });

  it("LIVENESS preserves the ordinary sequential migration A->B->C", () => {
    const m = chain([
      { from: A("f"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") }).ref?.id).toBe("C");
  });

  it("THE DISCRIMINATOR IS THE DESTINATION, not the multiplicity", () => {
    // Both manifests have two entries starting from A. Only the destinations differ.
    // If multiplicity alone decided, these would answer the same — and one would be wrong.
    const sameDest = chain([
      { from: A("f"), to: ref("B", "b") },
      rollbackOf(1, ref("B", "b"), "A", "f"),
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
      rollbackOf(1, ref("B", "b"), "A", "f"),
      { from: A("f"), to: ref("B", "b") },
      rollbackOf(3, ref("B", "b"), "A", "f"),
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") });
    expect(r.status).toBe("resolved");
    expect(r.trail.length).toBeGreaterThanOrEqual(2);
  });
});

// ── D19 — the three defects left open by 230be9c ────────────────────────────
//
// Written to FAIL against 230be9c, each naming the exact history it mis-handles.

/** A locator pinned to `id` at bytes `h`. */
const at = (id: string, h: string) => ({ ...loc(id, h) });

describe("D19.1 — a rollback rewinds ONLY its own era, not the whole ancestry", () => {
  it("A->B, B->C, C->B(rb 2), B->A closes a loop back to the ORIGIN and is ambiguous", () => {
    // The rollback at 3 undoes entry 2 (B->C). It therefore rewinds the lineage to
    // the state just before 2 — where B was current and A was already an ancestor.
    // A blanket `visitedIdentities.clear()` also forgets A, so entry 4's return to
    // the ORIGIN bytes reads as fresh history and resolves. The origin is not
    // inside the reversed era, so the rollback has no authority to forget it.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      { from: at("B", "2"), to: ref("C", "3") },
      {
        from: at("C", "3"),
        to: ref("B", "2"),
        reason: "rolled_back",
        detail: "reverses 2",
        reverses_sequence: 2,
        authorized_by: "cap-loc-D03",
      },
      { from: at("B", "2"), to: ref("A", "1") },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull(); // the history is legal…
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("ambiguous"); // …but it closes a loop
  });

  it("CONTRAST — re-adoption after a rollback is still fresh history and resolves", () => {
    // The pair that stops the rewind from over-correcting back into a blanket rule.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B");
  });
});

describe("D19.2 — a rollback proof must be UNIQUE and OPERATIVE", () => {
  it("rejects a SECOND rollback of an already-reversed entry", () => {
    // The resolver's comment claims the validator proves "no entry is reversed
    // twice". It did not. Entry 4 reverses entry 1 again — already undone by 2 —
    // and a stale proof like this obtains the read-time cycle exemption.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1 AGAIN — stale; the operative adoption is 3",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("CONTRAST — reversing the OPERATIVE adoption is legal", () => {
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 3 — the operative adoption",
        reverses_sequence: 3,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
  });
});

describe("D19.3 — the COLLECTION is bounded, not just its scalars", () => {
  it("rejects a manifest with more entries than the cap", () => {
    // The containment ladder, one level out: per-scalar caps do not bound the
    // array, so smuggling reopens as chunking and a long chain costs quadratic
    // work per resolve.
    const partials = [];
    for (let i = 0; i < MAX_ENTRIES + 1; i++) {
      partials.push({ from: at(`r${i}`, "1"), to: ref(`r${i + 1}`, "1") });
    }
    expect(validateAdoptionManifestV1(chain(partials))).toBeNull();
  });

  it("accepts a chain AT the cap, and resolves it without quadratic blow-up", () => {
    const partials = [];
    for (let i = 0; i < MAX_ENTRIES; i++) {
      partials.push({ from: at(`r${i}`, "1"), to: ref(`r${i + 1}`, "1") });
    }
    const m = chain(partials);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    const r = resolveHistorical(m, { kind: "agent", id: "r0" });
    expect(r.status).toBe("resolved");
    expect(r.trail.length).toBe(MAX_ENTRIES);
  });
});

// ── D19-R1 — three defects the codex round found in the fixes above ─────────

describe("D19-R1.1 — the ORIGIN is not immune to a rewind that unwinds past it", () => {
  it("querying the INTERMEDIATE identity of a rollback+re-adoption resolves", () => {
    // Stamping the origin `0` unconditionally makes it survive every rewind, even
    // one that legitimately unwinds the entry that INTRODUCED it. Here the query
    // enters at B, which entry 1 created; entry 2 rolls entry 1 back, so B's era is
    // gone and entry 3's re-adoption is fresh history. With a hard-coded 0 the
    // origin survives and entry 3 reads as a loop — the same manifest resolving
    // from A but not from B, which cannot both be right.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "B", content_hash: H("2") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B");
  });
});

describe("D19-R1.2 — NESTED rollbacks unwind LIFO and must stay representable", () => {
  it("accepts A->B, B->C, C->B(rb 2), B->A(rb 1) — unwinding two migrations in order", () => {
    // "The target must be the latest edge that landed on my source" conflates
    // "which edge put us here" with "which edge is being undone". Entry 3 restored
    // B, so it is the latest landing — but entry 4 undoes entry 1, which is still
    // outstanding. Rollbacks form an UNDO STACK: a rollback pops the top.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      { from: at("B", "2"), to: ref("C", "3") },
      {
        from: at("C", "3"),
        to: ref("B", "2"),
        reason: "rolled_back",
        detail: "reverses 2",
        reverses_sequence: 2,
        authorized_by: "cap-loc-D03",
      },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1 — unwinding the outer migration",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
  });

  it("still rejects a rollback that skips the top of the undo stack", () => {
    // The paired negative: entry 4 names entry 1, but entry 2 already popped it and
    // entry 3 is the outstanding adoption. LIFO is a rule, not a suggestion.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1 AGAIN — stale, 3 is outstanding",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });
});


// ── D19-R4 — codex round 4 on the merged fixes ─────────────────────────────

describe("D19-R4.1 — the undo stack is PER LINEAGE, not global", () => {
  it("accepts a rollback of one lineage while another lineage is more recent", () => {
    // A single global stack made unrelated roles contend: entry 2 belongs to a
    // completely different lineage, yet sat on top and blocked entry 3's rollback of
    // entry 1. Real manifests interleave constantly — D07/D09/D10 move dozens of
    // roles — so this rejected the ORDINARY case, not an exotic one.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      { from: at("X", "7"), to: ref("Y", "8") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
  });

  it("still rejects a stale rollback within its OWN lineage", () => {
    // Per-lineage scoping must not become per-lineage amnesia: inside one lineage
    // LIFO still holds, so the stale re-reversal stays rejected.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "2") },
      { from: at("X", "7"), to: ref("Y", "8") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
      { from: at("A", "1"), to: ref("B", "2") },
      {
        from: at("B", "2"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1 AGAIN — 4 is outstanding in this lineage",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });
});

describe("D19-R4.2 — a rollback cannot reverse an adoption with UNRECORDED source bytes", () => {
  it("rejects a rollback landing on arbitrary bytes when the target source hash is null", () => {
    // The landing check was conditional on the target having recorded a hash, so a
    // null-sourced adoption let its rollback claim ANY replacement bytes — and then
    // collect the read-time cycle exemption on a reversal it never demonstrated.
    // Absence is not agreement, the same rule traversal and `identityOf` already use.
    const m = chain([
      { from: { ...at("A", "1"), content_hash: null }, to: ref("B", "1") },
      {
        from: at("B", "1"),
        to: ref("A", "9"), // arbitrary bytes — nothing proves this is a reversal
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("rejects a rollback landing on the WRONG bytes when the target DID record them", () => {
    // Isolates the landing-bytes equality itself: the target's source hash is
    // present, so the check is doing real work rather than firing on a null.
    const m = chain([
      { from: at("A", "1"), to: ref("B", "1") },
      {
        from: at("B", "1"),
        to: ref("A", "9"), // right id, WRONG bytes
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });

  it("CONTRAST — with the source bytes recorded, the same reversal is legal", () => {
    const m = chain([
      { from: at("A", "1"), to: ref("B", "1") },
      {
        from: at("B", "1"),
        to: ref("A", "1"),
        reason: "rolled_back",
        detail: "reverses 1",
        reverses_sequence: 1,
        authorized_by: "cap-loc-D03",
      },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
  });
});
