/**
 * scripts/__tests__/adoption-manifest-open-defects.test.ts
 *
 * Regression coverage for the EIGHT open defects codex round 5 raised against
 * `guild.adoption_manifest.v1` (S3) and `guild.project_definition_ref.v1` (S2),
 * recorded UNFIXED in 3363c61 and handed over.
 *
 * Every case here was REPRODUCED against that pristine tip before a line of the
 * contract changed — the discipline the handover commit asks for, because two
 * earlier "fixes" in this lane were written from a model of the bug rather than
 * from the bug. Each `describe` states what the pristine tip did, so a reader can
 * tell a regression pin from an aspiration.
 */

import {
  ADOPTION_MANIFEST_SCHEMA,
  MAX_ENTRIES,
  entryDigest,
  resolveHistorical,
  validateAdoptionManifestV1,
  type AdoptionEntry,
  type AdoptionManifestV1,
} from "../lib/core/contracts/adoption-manifest";
import {
  MAX_SKILLS,
  PROJECT_DEFINITION_REF_SCHEMA,
  validateProjectDefinitionRefV1,
  type ProjectDefinitionRefV1,
} from "../lib/core/contracts/project-definition-ref";

// ── Fixture builders ────────────────────────────────────────────────────────
// `H` takes a HEX character: a `content_hash` that is not `sha256:<64 hex>` is
// rejected by the scalar rules, and a non-hex fixture silently makes every
// assertion vacuous (it cost this lane one wasted reproduction round).

const HEX = /^[0-9a-f]$/;
const H = (c: string) => {
  if (!HEX.test(c)) throw new Error(`fixture hash char must be hex, got ${JSON.stringify(c)}`);
  return `sha256:${c.repeat(64)}`;
};
const IDENT = (c: string) => c.repeat(64);

function ref(id: string, hash: string): ProjectDefinitionRefV1 {
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

function loc(id: string, hash: string, path?: string) {
  return {
    id,
    historical_path: path ?? `/old/${id}.md`,
    content_hash: H(hash),
    home: "dot-claude-agents" as const,
  };
}

function chain(parts: Array<Partial<AdoptionEntry>>): AdoptionManifestV1 {
  const entries: AdoptionEntry[] = [];
  let prev: string | null = null;
  parts.forEach((p, i) => {
    const e = {
      kind: "agent",
      from: loc("SRC", "f"),
      to: ref("DST", "a"),
      reason: "migrated",
      detail: null,
      reverses_sequence: null,
      adopted_at: "2026-08-01T00:00:00Z",
      run_id: "run-cap-loc",
      authorized_by: "cap-loc-D10",
      ...p,
      sequence: i + 1,
      prev_digest: prev,
    } as AdoptionEntry;
    entries.push(e);
    prev = entryDigest(e);
  });
  return { schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: "plugin", entries };
}

const rb = (target: number, over: Partial<AdoptionEntry>): Partial<AdoptionEntry> => ({
  reason: "rolled_back",
  reverses_sequence: target,
  detail: `undo ${target}`,
  ...over,
});

// ── Defect 1 — the undo stack under COLLAPSE ────────────────────────────────

describe("D1 — a rollback cannot un-collapse ONE source out of a shared destination", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced): this manifest VALIDATED, and resolving
   * `U` walked 1,3 and answered `resolved → N`. `U` was never rolled back; it
   * landed on the identity `N` had vacated. Sequence 1 was also left permanently
   * un-unwindable, because entry 3 marks `X` dead and a later `X→U (rb 1)` is
   * then rejected by the liveness rule.
   *
   * ROOT CAUSE: the undo stack is keyed by DESTINATION, so a collapse puts two
   * lineages' adoptions on one stack. Popping the top satisfied LIFO while the
   * entry underneath was still outstanding — and the rollback edge `X→N` claims
   * the WHOLE of `X`, which lineage 1 is still using.
   */
  const collapseThenPartialRollback = () =>
    chain([
      { from: loc("U", "1"), to: ref("X", "3") },
      { from: loc("N", "2"), to: ref("X", "3") },
      rb(2, { from: loc("X", "3"), to: ref("N", "2") }),
    ]);

  it("REJECTS the partial un-collapse the pristine tip accepted", () => {
    expect(validateAdoptionManifestV1(collapseThenPartialRollback())).toBeNull();
  });

  it("so no lineage can be resolved through it at all", () => {
    // The read side inherits the rejection: an invalid manifest yields NO answer.
    expect(
      resolveHistorical(collapseThenPartialRollback(), {
        kind: "agent",
        id: "U",
        content_hash: H("1"),
      })
    ).toEqual({ status: "ambiguous", ref: null, trail: [] });
  });

  it("the rule is about OTHER OUTSTANDING adoptions, not about collapse per se", () => {
    // Collapse itself stays legal — D10's whole shape. Only a rollback out of a
    // destination that MORE THAN ONE lineage is still riding on is refused.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("U", "1"), to: ref("X", "3") },
          { from: loc("N", "2"), to: ref("X", "3") },
        ])
      )
    ).not.toBeNull();
  });

  it("a rollback out of a destination with ONE outstanding adoption still validates", () => {
    // The ordinary forward-append rollback must be untouched.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("B", "b") },
          rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });

  it("and so does a re-adoption after that rollback", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("B", "b") },
          rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
          { from: loc("A", "a"), to: ref("B", "b") },
        ])
      )
    ).not.toBeNull();
  });

  it("and so does sequential rollback of a multi-step migration", () => {
    // `A→B(1), B→C(2), C→B(3 rb 2), B→A(4 rb 1)` — the history the round-4 finding
    // proved must stay representable. Each destination carries ONE outstanding
    // adoption at its rollback, so the new rule never sees it.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("B", "b") },
          { from: loc("B", "b"), to: ref("C", "c") },
          rb(2, { from: loc("C", "c"), to: ref("B", "b") }),
          rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });

  it("and interleaved unrelated lineages still do not contend", () => {
    // The round-4 finding: a GLOBAL stack rejected this ordinary shape.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("B", "b") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });
});

// ── Defect 2 — the cycle exemption is per LINEAGE, not per EDGE ─────────────

describe("D2 — a rollback's cycle exemption cannot be borrowed by another lineage", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR of the REPORTED fixture (reproduced):
   *
   *   U→N(1), N→Z(2), C→N(3), Z→X(4), N→X(5), X→N(6 rb 5)
   *   validates: true; resolving U walked 1,2,4,6 and answered `resolved → N` —
   *   a closed loop back to the N it occupied at step 1.
   *
   * That exact fixture is now rejected EARLIER, by D1: `X` carries two outstanding
   * adoptions (4 and 5), so rolling 5 back out of it is a partial un-collapse. Said
   * out loud because it matters for honesty about coverage — the reported instance
   * is closed by the other guard, so it CANNOT pin this one.
   *
   * The class survives D1 regardless, and a differential fuzz (174,492 valid
   * manifests, 1,744,920 walks, post-D1 baseline vs fixed) found it. Every
   * divergence it found was a CLOSED LOOP the pristine code called `resolved`; the
   * shortest is pinned below. All of them are the same mechanism: a walk reaches a
   * `rolled_back` edge whose `reverses_sequence` its own trail never contains, and
   * the unconditional exemption both skipped the revisit check and rewound an era
   * the walk had no authority over.
   */
  it("the REPORTED fixture is closed — but by D1, at validation, not here", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("U", "1"), to: ref("N", "2") },
          { from: loc("N", "2"), to: ref("Z", "4") },
          { from: loc("C", "c"), to: ref("N", "2") },
          { from: loc("Z", "4"), to: ref("X", "3") },
          { from: loc("N", "2"), to: ref("X", "3") },
          rb(5, { from: loc("X", "3"), to: ref("N", "2") }),
        ])
      )
    ).toBeNull();
  });

  /**
   * `E→D(1)`, `D→A(2)`, `A→D(3 rb 2)`, `D→E(4 rb 1)`, `E→D(5)` — VALID under every
   * rule including D1 (each destination carries exactly one outstanding adoption at
   * its rollback).
   *
   * Querying `A` walks 3, 4, 5 and arrives back at `D`, the identical bytes it
   * occupied after its very first hop. Entry 3 is authorized (it reverses 2, the
   * entry that introduced this walk's origin). Entry 4 is NOT: it reverses 1, which
   * belongs to `E`'s lineage. On the pristine tip entry 4's unconditional rewind
   * (boundary 1 ⇒ forget everything) erased the `D` the walk had just occupied, so
   * the revisit check at hop 5 found nothing and answered `resolved → D` — an
   * endpoint that is not a terminal but a position already held.
   */
  const borrowedExemption = () =>
    chain([
      { from: loc("E", "e"), to: ref("D", "d") },
      { from: loc("D", "d"), to: ref("A", "a") },
      rb(2, { from: loc("A", "a"), to: ref("D", "d") }),
      rb(1, { from: loc("D", "d"), to: ref("E", "e") }),
      { from: loc("E", "e"), to: ref("D", "d") },
    ]);

  it("the manifest itself is valid — this is a READ-side defect, not a write-side one", () => {
    expect(validateAdoptionManifestV1(borrowedExemption())).not.toBeNull();
  });

  it("the closed loop is `ambiguous`, not `resolved` (pristine tip said resolved)", () => {
    const r = resolveHistorical(borrowedExemption(), {
      kind: "agent",
      id: "A",
      content_hash: H("a"),
    });
    expect(r.status).toBe("ambiguous");
    expect(r.ref).toBeNull();
    expect(r.trail).toEqual([3, 4, 5]);
  });

  it("a longer borrowed-exemption loop is caught too", () => {
    // E@e → D@d → C@c → D@d. Entry 3 is authorized (reverses the origin's
    // introduction); entry 4 reverses sequence 1, which belongs to C's lineage.
    const m = chain([
      { from: loc("C", "c"), to: ref("D", "d") },
      { from: loc("D", "d"), to: ref("E", "e") },
      rb(2, { from: loc("E", "e"), to: ref("D", "d") }),
      rb(1, { from: loc("D", "d"), to: ref("C", "c") }),
      { from: loc("B", "b"), to: ref("E", "e") },
      { from: loc("C", "c"), to: ref("D", "d") },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    expect(resolveHistorical(m, { kind: "agent", id: "E", content_hash: H("e") })).toEqual({
      status: "ambiguous",
      ref: null,
      trail: [3, 4, 6],
    });
    // and the un-pinned query, which recovers its origin bytes at the first hop
    expect(resolveHistorical(m, { kind: "agent", id: "E" }).status).toBe("ambiguous");
  });

  /**
   * THE OTHER HALF OF THE AUTHORITY SET, and the reason this rule is not simply
   * `trail.includes(...)`.
   *
   * A first attempt at this fix used bare trail membership and reddened the
   * PRE-EXISTING D19-R1.1 test — `A→B(1), B→A(2 rb 1), A→B(3)` queried at B, where
   * entry 2 unwinds the entry that CREATED the walk's starting position but the
   * walk never traversed it, having begun after it. The old test was right and the
   * new rule was wrong. Pinned here as well as there, so the next author meets the
   * constraint from both sides.
   */
  it("a rollback of the entry that INTRODUCED the origin is authorized", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      { from: loc("A", "a"), to: ref("B", "b") },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "B", content_hash: H("b") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("B");
  });

  it("an origin that PRE-DATES the log stamps 0, and no rollback can claim it", () => {
    // `U` is never any entry's destination, so nothing in the log introduced it and
    // `originSequence` is 0 — which is not a real sequence and matches no
    // `reverses_sequence` (the entry validator floors those at 1).
    const m = chain([
      { from: loc("U", "1"), to: ref("N", "2") },
      { from: loc("N", "2"), to: ref("Z", "4") },
      rb(2, { from: loc("Z", "4"), to: ref("N", "2") }),
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    // entry 3 reverses 2, which IS on U's trail — authorized, resolves.
    expect(resolveHistorical(m, { kind: "agent", id: "U", content_hash: H("1") }).status).toBe(
      "resolved"
    );
  });

  // ── the other direction: an AUTHORIZED rollback keeps its exemption ──────
  // Without these the rule could be satisfied by answering `ambiguous` always,
  // which is exactly how an earlier read-time rule on this file went wrong.

  it("the plain forward-append rollback still resolves — A→B→A' is a chain", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") });
    expect(r.status).toBe("resolved");
    expect(r.trail).toEqual([1, 2]);
  });

  it("re-adoption after a rollback still resolves", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      { from: loc("A", "a"), to: ref("B", "b") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") }).status).toBe(
      "resolved"
    );
  });

  /**
   * THE REGRESSION THIS RULE IS SHAPED AROUND, pinned so nobody tightens it into
   * "a walk may only FOLLOW a rollback it traversed the target of".
   *
   * `A→B(1), B→C(2), C→B(3 rb 2), B→A(4 rb 1)` queried at B: entry 4 reverses
   * sequence 1, which a walk starting at B never traversed — yet B's bytes really
   * did go back to A, and the honest answer is A. FOLLOWING is about where the
   * bytes went; the EXEMPTION is a claim of authority. Only the second is gated.
   */
  it("a foreign rollback may still be FOLLOWED — only its exemption is withheld", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      rb(2, { from: loc("C", "c"), to: ref("B", "b") }),
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "B", content_hash: H("b") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("A");
    expect(r.trail).toEqual([2, 3, 4]);
  });

  it("and the same manifest queried at its true origin resolves as before", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      rb(2, { from: loc("C", "c"), to: ref("B", "b") }),
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("A");
    expect(r.trail).toEqual([1, 2, 3, 4]);
  });
});

// ── Defect 3 — a REMOVAL is final ──────────────────────────────────────────

describe("D3 — a removed identity cannot be re-created by an ordinary migration", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced): `A→null(1 removed)`, `B→A(2)`, `A→C(3)`
   * VALIDATED. Every entry with a non-null destination ran `deadIds.delete(toKey)`,
   * so an ordinary `migrated` entry resurrected `A` and entry 3 then adopted it
   * away again.
   *
   * That made the file's stated KNOWN LIMITATION — "a `removed` identity cannot be
   * re-created and re-adopted, because nothing restores it… If that history is ever
   * needed it wants an explicit `restored` reason, not a hole here" — a claim the
   * code did not keep. A comment that a validator contradicts is worse than no
   * comment: it is the thing readers plan against.
   */
  it("REJECTS the resurrect-then-re-adopt the pristine tip accepted", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
          { from: loc("B", "b"), to: ref("A", "a") },
          { from: loc("A", "a"), to: ref("C", "c") },
        ])
      )
    ).toBeNull();
  });

  it("REJECTS at the LANDING, not two entries later — the class, not the instance", () => {
    // The re-adoption is only how the pristine tip's hole became visible. Landing on
    // a removed identity at all is what re-creates it, so that is where it rejects —
    // whatever the entry's reason, and whether or not anything later uses it.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
          { from: loc("B", "b"), to: ref("A", "a") },
        ])
      )
    ).toBeNull();
  });

  it.each([
    ["migrated", { reason: "migrated" as const, detail: null }],
    ["rehomed", { reason: "rehomed" as const, detail: null }],
    ["renamed", { reason: "renamed" as const, detail: null }],
    ["collapsed", { reason: "collapsed" as const, detail: "merged" }],
  ])("no reason smuggles a resurrection through — %s", (_label, over) => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
          { from: loc("B", "b"), to: ref("A", "a"), ...over },
        ])
      )
    ).toBeNull();
  });

  it("removal keys on BYTES too — a different-bytes A is a different identity", () => {
    // The liveness identity is (kind, id, content_hash). Removing `A@a` says nothing
    // about `A@b`, exactly as it says nothing about `B`. Over-broad rejection would
    // be its own defect, so the boundary is asserted, not assumed.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
          { from: loc("B", "b"), to: ref("A", "b") },
        ])
      )
    ).not.toBeNull();
  });

  it("an ordinary removal, and a removal beside unrelated traffic, still validate", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
          { from: loc("B", "b"), to: ref("C", "c") },
        ])
      )
    ).not.toBeNull();
  });

  it("and the removal still reads back as `removed`, never `not_found`", () => {
    const m = chain([
      { from: loc("A", "a"), to: null, reason: "removed", detail: "dropped in D09" },
      { from: loc("B", "b"), to: ref("C", "c") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") })).toEqual({
      status: "removed",
      ref: null,
      trail: [1],
    });
  });
});

// ── Defect 4 — ONE definition of identity ──────────────────────────────────

describe("D4 — liveness and traversal agree about what an identity IS", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced): `A@h/p1→B(1)`, `B→A@h(2 rb 1)`,
   * `A@h/p2→C(3)` VALIDATED — the liveness rule keys on (kind, id, bytes), so both
   * `A` entries are ONE identity and entry 2's rollback restored it. Yet a query
   * pinned to `A@h` with NO path answered `ambiguous`, because `oneSource`
   * additionally demanded equal `historical_path` and `home`.
   *
   * Two contradictions at once. The file says identity is (kind, id, bytes) and
   * that `historical_path` is "Optional, and DISAMBIGUATING when present" — but a
   * caller who supplied the full documented identity and omitted the optional field
   * got no answer. And the write side had already decided these were one lineage;
   * the read side re-litigated it with a different rule.
   *
   * `identityOf` is now the single answer, used by liveness, by the rollback proof
   * and by this check — the same consolidation the merged codex round applied when
   * liveness and traversal disagreed before.
   */
  const twoPathsOneIdentity = () =>
    chain([
      { from: loc("A", "a", "/h/p1.md"), to: ref("B", "b") },
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      { from: loc("A", "a", "/h/p2.md"), to: ref("C", "c") },
    ]);

  it("the manifest validates — the write side already called these one identity", () => {
    expect(validateAdoptionManifestV1(twoPathsOneIdentity())).not.toBeNull();
  });

  it("a query supplying the FULL documented identity now resolves", () => {
    const r = resolveHistorical(twoPathsOneIdentity(), {
      kind: "agent",
      id: "A",
      content_hash: H("a"),
    });
    expect(r.status).toBe("resolved");
    expect(r.ref?.id).toBe("C");
  });

  it("and agrees with the same query PLUS the optional disambiguator", () => {
    // "Optional disambiguation" must mean the answer does not depend on supplying
    // it. Before, `historical_path` was load-bearing and the doc was wrong.
    const withPath = resolveHistorical(twoPathsOneIdentity(), {
      kind: "agent",
      id: "A",
      content_hash: H("a"),
      historical_path: "/h/p1.md",
    });
    expect(withPath.status).toBe("resolved");
    expect(withPath.ref?.id).toBe("C");
  });

  it("DIFFERENT BYTES are still two sources, and still ambiguous", () => {
    // The check `oneSource` exists for a real case and must keep catching it: a
    // hash-less query for "A" spanning `A@a` and `A@b` names two genuinely
    // different definitions the caller has not distinguished.
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      { from: loc("A", "b"), to: ref("C", "c") },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    expect(resolveHistorical(m, { kind: "agent", id: "A" }).status).toBe("ambiguous");
  });

  it("…and pinning the bytes disambiguates it, which is what the field is for", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("B", "b") },
      { from: loc("A", "b"), to: ref("C", "c") },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") }).ref?.id).toBe(
      "B"
    );
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("b") }).ref?.id).toBe(
      "C"
    );
  });

  it("a differing HOME alone no longer splits one identity either", () => {
    // `home` was the other half of the disagreement. Same id, same bytes, recorded
    // from two legacy homes — one definition that two records spell differently,
    // which is precisely what this manifest exists to reconcile.
    const m = chain([
      {
        from: {
          id: "A",
          historical_path: "/old/A.md",
          content_hash: H("a"),
          home: "dot-claude-agents" as const,
        },
        to: ref("B", "b"),
      },
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      {
        from: {
          id: "A",
          historical_path: "/old/A.md",
          content_hash: H("a"),
          home: "plugin-shipped" as const,
        },
        to: ref("C", "c"),
      },
    ]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    expect(
      resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") }).ref?.id
    ).toBe("C");
  });
});

// ── Defect 5 — the bound must precede the enumeration it bounds ─────────────

describe("D5 — a collection bound is paid BEFORE the pre-check work, not after", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced, dense arrays, mean of 3 runs):
   *
   *     n         entries reject   skills reject
   *     250,000        111.8 ms        112.8 ms
   *     500,000        361.2 ms        273.9 ms
   *   1,000,000        728.2 ms        541.0 ms
   *   2,000,000      1,636.5 ms      1,392.4 ms
   *   4,000,000      2,374.9 ms      1,909.9 ms
   *
   * Linear in the INPUT, against caps of 4,096 and 256. `arrayLength()` and
   * `sanitizeSkillArr()` both materialised every own property name — an n-element
   * string array the caller had not allocated — and only then was the cap consulted.
   * The round-4 fix moved that cost one step earlier without eliminating it: a
   * rejection cost as much as an acceptance, which is what a collection bound exists
   * to prevent.
   *
   * These are TIMING assertions, unusual here and deliberate: the fix changes cost,
   * not outcome, so nothing else can observe it. The thresholds sit ~15x below the
   * measured pristine numbers so ordinary machine noise cannot flip them, and the
   * behavioural assertions beside them pin that the bound still means the same thing.
   */
  const DENSE = 4_000_000;
  /** ~15x headroom under the 2,374.9 ms / 1,909.9 ms measured on the pristine tip. */
  const CEILING_MS = 150;

  const timeMs = (f: () => unknown): number => {
    f(); // warm
    const t = process.hrtime.bigint();
    f();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };

  it("rejects a 4,000,000-entry array in O(1), not O(n)", () => {
    const entries = new Array(DENSE).fill(null);
    const m = { schema_version: ADOPTION_MANIFEST_SCHEMA, project_id: "plugin", entries };
    let out: unknown;
    const ms = timeMs(() => (out = validateAdoptionManifestV1(m)));
    expect(out).toBeNull(); // still rejected — cost changed, outcome did not
    expect(ms).toBeLessThan(CEILING_MS);
  });

  it("rejects a 4,000,000-skill bundle in O(1), not O(n)", () => {
    const r = { ...ref("A", "a"), skills: new Array(DENSE).fill(null) };
    let out: unknown;
    const ms = timeMs(() => (out = validateProjectDefinitionRefV1(r)));
    expect(out).toBeNull();
    expect(ms).toBeLessThan(CEILING_MS);
  });

  it("the bound still rejects at exactly cap+1 and accepts at the cap (entries)", () => {
    // The cheap length check must not become the ONLY check, or an array whose
    // `length` lies about its contents would slip past.
    const under = [];
    for (let i = 0; i < MAX_ENTRIES; i++) under.push({ from: loc(`r${i}`, "1"), to: ref(`r${i + 1}`, "1") });
    expect(validateAdoptionManifestV1(chain(under))).not.toBeNull();
    under.push({ from: loc(`r${MAX_ENTRIES}`, "1"), to: ref(`r${MAX_ENTRIES + 1}`, "1") });
    expect(validateAdoptionManifestV1(chain(under))).toBeNull();
  });

  it("the bound still rejects at exactly cap+1 and accepts at the cap (skills)", () => {
    const skill = (i: number) => ({
      id: `s${i}`,
      relative_path: `.guild/skills/s${i}/SKILL.md`,
      content_hash: H("a"),
    });
    const at = Array.from({ length: MAX_SKILLS }, (_v, i) => skill(i));
    expect(validateProjectDefinitionRefV1({ ...ref("A", "a"), skills: at })).not.toBeNull();
    expect(
      validateProjectDefinitionRefV1({ ...ref("A", "a"), skills: [...at, skill(MAX_SKILLS)] })
    ).toBeNull();
  });

  it("a SPARSE oversized array is rejected too — by a different guard, and that is fine", () => {
    // Checked because the early exit must not create a gap, NOT because the length
    // bound is what catches it: `new Array(n)` is rejected by the hole check in the
    // index loop either way. Recorded so nobody reads this as evidence that the
    // length bound is outcome-load-bearing in `sanitizeSkillArr` — it is not, and
    // the timing assertions above are the only thing that pins it there.
    const entries = new Array(MAX_ENTRIES + 1);
    expect(
      validateAdoptionManifestV1({
        schema_version: ADOPTION_MANIFEST_SCHEMA,
        project_id: "plugin",
        entries,
      })
    ).toBeNull();
    expect(
      validateProjectDefinitionRefV1({ ...ref("A", "a"), skills: new Array(MAX_SKILLS + 1) })
    ).toBeNull();
  });

  it("and an in-bounds array carrying EXTRA named own keys is still rejected", () => {
    // The key-count/shape scan is what catches this, and it must survive the new
    // early exit — the length bound says nothing about out-of-band properties.
    const entries: unknown[] = [];
    (entries as unknown as Record<string, unknown>).__proto__x = "smuggled";
    Object.defineProperty(entries, "extra", { value: 1, enumerable: true, configurable: true });
    expect(
      validateAdoptionManifestV1({
        schema_version: ADOPTION_MANIFEST_SCHEMA,
        project_id: "plugin",
        entries,
      })
    ).toBeNull();
  });
});
