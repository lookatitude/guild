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
  validateAdoptionEntry,
  validateAdoptionManifestV1,
  type AdoptionEntry,
  type AdoptionManifestV1,
} from "../lib/core/contracts/adoption-manifest";
import {
  MAX_DEFINITION_ID,
  MAX_PROJECT_ID,
  MAX_RELATIVE_PATH,
  MAX_SKILLS,
  MAX_SOURCE_COMMIT,
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


// ── Defect 6 — bounding COUNTS is not bounding BYTES ───────────────────────

describe("D6 — every scalar at every nesting level is byte-bounded, by registration", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced): each of these accepted an 8,388,608-byte
   * value —
   *
   *   ref.project_id · ref.id · ref.relative_path · ref.source_commit
   *   skills[].id · skills[].relative_path
   *
   * — so a ref with 256 skills whose ids were hundreds of MB validated, times 4,096
   * S3 entries. `MAX_SKILLS` and `MAX_ENTRIES` bound HOW MANY; nothing bounded HOW
   * BIG. This is the rung that has now been missed twice in this lane, so the
   * coverage below is REGISTRATION-driven rather than a list of remembered fields:
   * a new key added to either closed shape without a bound is a RED BUILD.
   */
  const validRef = () => ref("A", "a");
  const validSkill = () => ({
    id: "s1",
    relative_path: ".guild/skills/s1/SKILL.md",
    content_hash: H("a"),
  });

  /** Every string-valued ref field, against the bound that governs it. */
  const REF_SCALAR_BOUNDS: Record<string, number> = {
    project_id: MAX_PROJECT_ID,
    id: MAX_DEFINITION_ID,
    relative_path: MAX_RELATIVE_PATH,
    source_commit: MAX_SOURCE_COMMIT,
    content_hash: 71, // "sha256:" + 64 hex, fixed by regex
    specialist_profile_hash: 64, // raw hex, fixed by regex
    specialist_type_hash: 64,
  };
  /** Fields bounded by something OTHER than a byte cap. Each must say which. */
  const REF_NON_SCALAR: Record<string, string> = {
    schema_version: "frozen literal - one legal value",
    kind: "closed vocabulary - DEFINITION_KINDS",
    skills: "collection - bounded by MAX_SKILLS, elements bounded below",
  };

  const SKILL_SCALAR_BOUNDS: Record<string, number> = {
    id: MAX_DEFINITION_ID,
    relative_path: MAX_RELATIVE_PATH,
    content_hash: 71,
  };

  it("REGISTRATION IS TOTAL for the ref — a new field must be classified", () => {
    expect([...Object.keys(REF_SCALAR_BOUNDS), ...Object.keys(REF_NON_SCALAR)].sort()).toEqual(
      Object.keys(validRef()).sort()
    );
  });

  it("REGISTRATION IS TOTAL for a pinned skill", () => {
    expect(Object.keys(SKILL_SCALAR_BOUNDS).sort()).toEqual(Object.keys(validSkill()).sort());
  });

  const HUGE = "x".repeat(8 * 1024 * 1024);

  it.each(Object.keys(REF_SCALAR_BOUNDS))("ref.%s rejects an 8 MiB value", (field) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), [field]: HUGE })).toBeNull();
  });

  it.each(Object.keys(SKILL_SCALAR_BOUNDS))("skills[].%s rejects an 8 MiB value", (field) => {
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), [field]: HUGE }],
      })
    ).toBeNull();
  });

  // ── the bound is EXACT, not merely "not 8 MiB" ──────────────────────────

  it("accepts project_id at exactly MAX_PROJECT_ID and rejects at +1", () => {
    const at = "p".repeat(MAX_PROJECT_ID);
    expect(validateProjectDefinitionRefV1({ ...validRef(), project_id: at })).not.toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), project_id: at + "p" })).toBeNull();
  });

  it("accepts id at exactly MAX_DEFINITION_ID and rejects at +1", () => {
    const at = "i".repeat(MAX_DEFINITION_ID);
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: at })).not.toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: at + "i" })).toBeNull();
  });

  it("accepts source_commit at exactly MAX_SOURCE_COMMIT and rejects at +1", () => {
    const at = "c".repeat(MAX_SOURCE_COMMIT);
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: at })).not.toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: at + "c" })).toBeNull();
    // …and an explicit null is still the way to say "outside a git tree".
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: null })).not.toBeNull();
  });

  it("accepts relative_path at exactly MAX_RELATIVE_PATH and rejects at +1", () => {
    const at = "d/".repeat((MAX_RELATIVE_PATH - 4) / 2) + "a.md";
    expect(at.length).toBe(MAX_RELATIVE_PATH);
    expect(validateProjectDefinitionRefV1({ ...validRef(), relative_path: at })).not.toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), relative_path: "d/" + at })).toBeNull();
  });

  it("skills[].id and skills[].relative_path are exact at their bounds too", () => {
    const idAt = "s".repeat(MAX_DEFINITION_ID);
    const pathAt = "d/".repeat((MAX_RELATIVE_PATH - 4) / 2) + "a.md";
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: idAt, relative_path: pathAt }],
      })
    ).not.toBeNull();
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [{ ...validSkill(), id: idAt + "s" }] })
    ).toBeNull();
  });

  // ── Rule 6's other half: a bounded scalar is still SHAPE-checked ─────────
  // Built with fromCharCode so no literal control byte appears in this source,
  // matching the convention in adoption-manifest-hardening.test.ts.

  const CONTROLS: Array<[string, string]> = [
    ["NUL (U+0000)", String.fromCharCode(0x00)],
    ["newline (U+000A)", String.fromCharCode(0x0a)],
    ["NEL (U+0085)", String.fromCharCode(0x85)],
    ["LINE SEPARATOR (U+2028)", String.fromCharCode(0x2028)],
    ["PARAGRAPH SEPARATOR (U+2029)", String.fromCharCode(0x2029)],
  ];

  it.each(CONTROLS)("a control character is rejected in ref.id — %s", (_label, ch) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: `a${ch}b` })).toBeNull();
  });

  it("the same control class is rejected in project_id, source_commit and skill ids", () => {
    const NEL = String.fromCharCode(0x85);
    expect(validateProjectDefinitionRefV1({ ...validRef(), project_id: `a${NEL}b` })).toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: `a${NEL}b` })).toBeNull();
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: `a${NEL}b` }],
      })
    ).toBeNull();
  });

  it("S3 rejects an oversized S2 ref carried as an entry destination", () => {
    // The levels compose: bounding S2 is what bounds an S3 entry, and an S3 entry
    // is what MAX_ENTRIES multiplies. A hole at the innermost level defeats both
    // outer counts, which is the whole shape of this defect.
    expect(
      validateAdoptionManifestV1(
        chain([{ from: loc("A", "a"), to: { ...ref("B", "b"), id: "x".repeat(8 * 1024 * 1024) } }])
      )
    ).toBeNull();
  });
});


// ── Defect 7 — the query is the ONE closed key set that ignored symbols ────

describe("D7 — a symbol-keyed query field is rejected, like every other closed shape", () => {
  /**
   * PRISTINE-TIP BEHAVIOUR (reproduced): `{kind, id, [Symbol("payload")]: huge}`
   * resolved. The query's closed-key check loops `getOwnPropertyNames`, which does
   * not see symbols, so an arbitrary symbol-keyed payload rode along.
   *
   * THIS CONTRADICTED AN EXISTING TEST — and the existing test's own NAME, "a
   * symbol-keyed query field is rejected", was on the right side of it while its
   * ASSERTION (`resolved`) was on the wrong one. Its comment claimed
   * "isPlainDataObject's symbol check is what catches this"; `isPlainDataObject` in
   * this contract has no symbol check at all (null/type/array/Proxy/prototype, and
   * nothing else). So the assertion was pinning behaviour the author believed was
   * something else.
   *
   * The rule the rest of the file keeps: `hasExactKeys` — used for the locator, the
   * entry and the manifest — opens with `getOwnPropertySymbols(o).length > 0 →
   * false`. The query was the only closed key set validated by a hand-rolled loop,
   * and the only one that let symbols through. The assertion was corrected, with
   * that reasoning recorded at the old test.
   */
  const m = () => chain([{ from: loc("A", "a"), to: ref("B", "b") }]);

  it("rejects a symbol-keyed query", () => {
    const q: Record<string | symbol, unknown> = { kind: "agent", id: "A" };
    q[Symbol("payload")] = "x".repeat(1024);
    expect(resolveHistorical(m(), q).status).toBe("ambiguous");
  });

  it("rejects a WELL-KNOWN symbol too — not just fresh ones", () => {
    const q: Record<string | symbol, unknown> = { kind: "agent", id: "A" };
    (q as Record<symbol, unknown>)[Symbol.iterator] = () => undefined;
    expect(resolveHistorical(m(), q).status).toBe("ambiguous");
  });

  it("rejects a NON-ENUMERABLE symbol — `getOwnPropertySymbols` sees those too", () => {
    const q: Record<string, unknown> = { kind: "agent", id: "A" };
    Object.defineProperty(q, Symbol("hidden"), { value: 1, enumerable: false });
    expect(resolveHistorical(m(), q).status).toBe("ambiguous");
  });

  it("and an ordinary symbol-free query still resolves", () => {
    // Both directions, so the rule cannot be met by always answering `ambiguous`.
    expect(resolveHistorical(m(), { kind: "agent", id: "A" }).status).toBe("resolved");
  });

  it("the query now matches `hasExactKeys` on symbols — the same rule, one file", () => {
    // The closed shapes validated by `hasExactKeys` already behaved this way; this
    // asserts the query is no longer the exception.
    const entryWithSymbol: Record<string | symbol, unknown> = {
      ...chain([{ from: loc("A", "a"), to: ref("B", "b") }]).entries[0],
    };
    entryWithSymbol[Symbol("x")] = 1;
    expect(validateAdoptionEntry(entryWithSymbol)).toBeNull();
  });
});


// ── Defect 8 — the trailing guard is dead, so pin what KEEPS it dead ───────

describe("D8 — traversal terminates by strict monotonicity, not by its loop bound", () => {
  /**
   * The post-loop `return` in `resolveHistoricalInner` cannot fire. Verified by
   * SENTINEL against the pristine tip's own structure: with that statement replaced
   * by a marker, 200,855 valid fuzzed manifests over 2,410,260 walks reached it ZERO
   * times, as did a maximal linear chain at `MAX_ENTRIES` consuming all 4,096 hops,
   * and the whole S2/S3 suite was indifferent to the substitution.
   *
   * It is KEPT rather than deleted — deleting it requires `for (;;)`, trading a
   * provably-dead line for a hang if the invariant below is ever broken — so the
   * tests here pin THE INVARIANT, which is the thing that can actually regress. A
   * test that appeared to cover the dead statement would be the vacuous kind this
   * lane has been burned by.
   *
   * ANTI-VACUITY, INCLUDING THE PROBE THAT DID NOT DISCRIMINATE, because reporting
   * only the sweep that worked is how a weak test passes for a strong one:
   *
   *   - deleting the forward-only filter outright → 16 RED across the S3 suites.
   *     The invariant is genuinely pinned.
   *   - relaxing `e.sequence <= minSequence` to `<` → NOTHING RED, and that is
   *     correct rather than a coverage gap: the two differ only when an entry could
   *     be re-selected at its own sequence, which requires returning to the identity
   *     it departs from, and the cycle guard already answers `ambiguous` there. The
   *     weakening is semantically equivalent under that guard, so no test should
   *     redden. Recorded so the next author does not read it as a hole and "fix" it.
   */
  it("a walk consumes at most one entry per hop, at the cap", () => {
    const partials = [];
    for (let i = 0; i < MAX_ENTRIES; i++) {
      partials.push({ from: loc(`r${i}`, "1"), to: ref(`r${i + 1}`, "1") });
    }
    const m = chain(partials);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    const r = resolveHistorical(m, { kind: "agent", id: "r0" });
    // Exits through a real branch (`resolved`), never through the loop bound.
    expect(r.status).toBe("resolved");
    expect(r.trail.length).toBe(MAX_ENTRIES);
  });

  it("the trail is STRICTLY INCREASING — the property that bounds the walk", () => {
    // If this ever stopped holding, the loop bound would become load-bearing and
    // the post-loop return would stop being dead. This is the real guard.
    const partials = [
      { from: loc("A", "a"), to: ref("B", "b") },
      { from: loc("B", "b"), to: ref("C", "c") },
      rb(2, { from: loc("C", "c"), to: ref("B", "b") }),
      rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
    ];
    const m = chain(partials);
    const r = resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") });
    expect(r.trail).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < r.trail.length; i++) {
      expect(r.trail[i]).toBeGreaterThan(r.trail[i - 1]);
    }
  });

  it("no trail ever exceeds the entry count, on any status", () => {
    const shapes: AdoptionManifestV1[] = [
      chain([{ from: loc("A", "a"), to: ref("B", "b") }]),
      chain([
        { from: loc("A", "a"), to: ref("B", "b") },
        rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
        { from: loc("A", "a"), to: ref("B", "b") },
      ]),
      chain([
        { from: loc("E", "e"), to: ref("D", "d") },
        { from: loc("D", "d"), to: ref("A", "a") },
        rb(2, { from: loc("A", "a"), to: ref("D", "d") }),
        rb(1, { from: loc("D", "d"), to: ref("E", "e") }),
        { from: loc("E", "e"), to: ref("D", "d") },
      ]),
      chain([{ from: loc("A", "a"), to: null, reason: "removed", detail: "gone" }]),
    ];
    for (const m of shapes) {
      for (const id of ["A", "B", "C", "D", "E"]) {
        for (const hash of ["a", "b", "c", "d", "e"]) {
          const r = resolveHistorical(m, { kind: "agent", id, content_hash: H(hash) });
          expect(r.trail.length).toBeLessThanOrEqual(m.entries.length);
          // and the dead statement's signature — a full-length trail with no
          // terminal answer — never appears.
          expect(r.trail.length === m.entries.length && r.status === "ambiguous").toBe(false);
        }
      }
    }
  });
});


// ── Codex round 1 (post-fix) — findings against MY fixes, not the pristine tip ──

describe("D1-R1 — a destination's undo stack is per ERA, not for all time", () => {
  /**
   * FOUND BY CODEX AGAINST MY OWN D1 FIX, and reproduced before changing anything:
   *
   *   A→X(1), X→Y(2), B→X(3), X→B(4 rb 3)
   *     entries 1-3 valid; A resolves to Y, B resolves to X
   *     entry 4 REJECTED by my `lineage.length !== 1` rule
   *
   * X's stack was [1,3]. Sequence 1 was outstanding but no longer RIDING X — that
   * lineage departed to Y at sequence 2. So `length === 1` was not equivalent to
   * "no other lineage rides this destination", which is the property D1 claims to
   * enforce. My rule rejected a legitimate history: precisely the failure mode this
   * file has now produced four times, and the one I was warned to expect.
   *
   * FIX: an identity that is adopted away and later RE-CREATED by a fresh adoption
   * starts a NEW ERA; the previous era's adoptions onto it are no longer unwindable
   * through it, so the stale stack is dropped. A ROLLBACK landing on it restores the
   * SAME era and keeps the stack — that distinction is what preserves sequential
   * rollback of a multi-step migration.
   */
  it("accepts the rollback after destination reuse that my first rule rejected", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          { from: loc("B", "b"), to: ref("X", "3") },
          rb(3, { from: loc("X", "3"), to: ref("B", "b") }),
        ])
      )
    ).not.toBeNull();
  });

  it("a ROLLBACK landing on a departed identity keeps its era — stack preserved", () => {
    // `A→X(1), X→Y(2), Y→X(3 rb 2), X→A(4 rb 1)`: entry 3 restores the SAME X, so
    // sequence 1 is still unwindable through it at entry 4. If the era-clear fired
    // on rollback landings too, entry 4 would break — and with it every sequential
    // rollback of a multi-step migration.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          rb(2, { from: loc("Y", "e"), to: ref("X", "3") }),
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });

  it("the D1 rejection still stands where the lineages ARE concurrent", () => {
    // `U→X(1), N→X(2), X→N(3 rb 2)`: nothing departed X between 1 and 2, so both
    // adoptions ride the same era of X and the partial un-collapse is still refused.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("U", "1"), to: ref("X", "3") },
          { from: loc("N", "2"), to: ref("X", "3") },
          rb(2, { from: loc("X", "3"), to: ref("N", "2") }),
        ])
      )
    ).toBeNull();
  });

  it("a stale PREVIOUS-era adoption cannot be rolled back through the new era", () => {
    // After the era boundary at 3, sequence 1 is gone from X's stack, so naming it
    // finds a different top and is rejected — the LIFO rule doing its job across
    // the boundary rather than being bypassed by it.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          { from: loc("B", "b"), to: ref("X", "3") },
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
        ])
      )
    ).toBeNull();
  });
});


describe("D6-R1 — S2 identities are TOKEN-shaped, and the commit bound fits real git", () => {
  /**
   * THREE CODEX FINDINGS AGAINST MY OWN D6 FIX, all reproduced first.
   *
   * #3 (P1) `{...ref, id: "../outside"}` and a pinned skill `id: "../../secret"`
   *   both VALIDATED. I bounded these scalars and never SHAPE-checked them — half of
   *   Rule 6. S3's legacy locator and query both require `TOKEN_RE`, so such a
   *   destination could resolve once and then never legally become a later `from`
   *   identity: the same identity, legal on one side of the manifest and illegal on
   *   the other. That is the D4 disagreement reappearing across the S2/S3 seam.
   *
   * #4 (P2) `MAX_SOURCE_COMMIT = 128` rejected a real 137-character
   *   `git describe --tags --long` output, though the field is documented as "a sha,
   *   a tag, a describe string". A bound that rejects the documented input is a
   *   defect in the bound, not in the input.
   *
   * #5 (P2) was about my RATIONALE, not the number, and is answered in the source:
   *   S3's `historical_path` is ABSOLUTE and S2's `relative_path` is RELATIVE, so
   *   they are different fields and equal caps never made them "consistent". The cap
   *   stands on the file's own stated policy — deliberately stricter than the
   *   filesystem — and the comment now says that instead of the wrong thing.
   */
  const validRef = () => ref("A", "a");
  const validSkill = () => ({
    id: "s1",
    relative_path: ".guild/skills/s1/SKILL.md",
    content_hash: H("a"),
  });

  it.each([
    ["parent traversal", "../outside"],
    ["nested traversal", "../../secret"],
    ["path separator", "a/b"],
    ["leading dot", ".hidden"],
    ["leading dash", "-flag"],
    ["absolute", "/etc/passwd"],
    ["space", "a b"],
  ])("ref.id rejects a non-token identity — %s", (_label, bad) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: bad })).toBeNull();
  });

  it.each([
    ["parent traversal", "../outside"],
    ["nested traversal", "../../secret"],
    ["path separator", "a/b"],
  ])("skills[].id rejects a non-token identity — %s", (_label, bad) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [{ ...validSkill(), id: bad }] })
    ).toBeNull();
  });

  it("project_id is token-shaped too — S3's manifest project_id already was", () => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), project_id: "../other" })).toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), project_id: "plugin" })).not.toBeNull();
  });

  it.each([
    ["plain slug", "plugin-runtime-architect"],
    ["dotted", "guild.review"],
    ["underscored", "doc_writer"],
    ["digits", "r0"],
    ["single char", "a"],
  ])("…and every REAL identity shape still validates — %s", (_label, good) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: good })).not.toBeNull();
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [{ ...validSkill(), id: good }] })
    ).not.toBeNull();
  });

  it("an S2 identity is now legal on BOTH sides of the manifest seam", () => {
    // The point of the shape rule: what S2 accepts as a destination id, S3 accepts
    // as a later source id. Previously `../outside` passed one and failed the other.
    const good = "plugin-runtime-architect";
    expect(validateProjectDefinitionRefV1({ ...validRef(), id: good })).not.toBeNull();
    expect(
      validateAdoptionManifestV1(chain([{ from: loc(good, "a"), to: ref("B", "b") }]))
    ).not.toBeNull();
  });

  it("accepts a real 137-char `git describe --tags --long` output", () => {
    const describe137 = "release-" + "c".repeat(118) + "-1-g02bcf9f";
    expect(describe137.length).toBe(137);
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), source_commit: describe137 })
    ).not.toBeNull();
  });

  it("…and source_commit is still bounded, exactly at MAX_SOURCE_COMMIT", () => {
    const at = "c".repeat(MAX_SOURCE_COMMIT);
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: at })).not.toBeNull();
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: at + "c" })).toBeNull();
  });

  it("source_commit is NOT token-shaped — a git ref legitimately contains `/`", () => {
    // Over-tightening this the way ids were tightened would be its own defect:
    // `refs/tags/v1` and `feature/x-1-gabc1234` are ordinary values.
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), source_commit: "refs/tags/v2.5.0" })
    ).not.toBeNull();
  });
});
