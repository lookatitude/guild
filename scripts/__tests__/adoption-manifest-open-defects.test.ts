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
  entryDigest,
  resolveHistorical,
  validateAdoptionManifestV1,
  type AdoptionEntry,
  type AdoptionManifestV1,
} from "../lib/core/contracts/adoption-manifest";
import {
  PROJECT_DEFINITION_REF_SCHEMA,
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
