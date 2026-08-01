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
  isUnstampedAdoption,
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

function rawD9(over: Partial<AdoptionEntry>): AdoptionEntry {
  return {
    sequence: 1,
    kind: "agent",
    from: loc("SRC", "f"),
    to: ref("DST", "a"),
    reason: "migrated",
    detail: null,
    reverses_sequence: null,
    adopted_at: "2026-08-01T00:00:00Z",
    run_id: "run-cap-loc",
    authorized_by: "cap-loc-D07",
    prev_digest: null,
    ...over,
  } as AdoptionEntry;
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

  /**
   * A TEST WAS DELETED HERE, and the reason is recorded because deleting coverage
   * needs more justification than adding it.
   *
   * It claimed "an origin that PRE-DATES the log stamps 0, and no rollback can claim
   * it". Codex round 6 (#4) proved it VACUOUS — forcing `originStamp()` to return 2
   * left it green, because its rollback was already authorized through
   * `trail.includes(2)` and the stamp was never consulted. My rewrite of it was worse:
   * the fixture I built to isolate the stamp did not validate at all.
   *
   * The claim is in fact UNOBSERVABLE, which is why no fixture isolates it: a
   * pre-dating origin stamps 0, and `reverses_sequence` is floored at 1 by the entry
   * validator, so the two can never be equal and no input distinguishes a 0 stamp
   * from any other unmatched value. It is dead-by-construction in the same sense as
   * the post-loop return in `resolveHistoricalInner` — and the house rule is to delete
   * an untestable assertion rather than ship it looking like evidence.
   *
   * The half of the rule that IS observable — a rollback of the entry that INTRODUCED
   * the walk's origin is authorized — is pinned by the test above and by the
   * pre-existing D19-R1.1, both of which redden when the `originSequence` term is
   * dropped.
   */
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
    // `id` and `relative_path` are BOUND to each other, so overriding one alone made
    // the locator invalid for the other's reason and the bound was never consulted
    // (codex round 6, #4). Oversizing `id` therefore oversizes its path with it, and
    // each case now fails for the bound it names.
    const skill =
      field === "id"
        ? { ...validSkill(), id: HUGE, relative_path: `.guild/skills/${HUGE}/SKILL.md` }
        : { ...validSkill(), [field]: HUGE };
    expect(validateProjectDefinitionRefV1({ ...validRef(), skills: [skill] })).toBeNull();
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
    // The path is built FROM the id: since codex round 2 #3 a pinned skill's id must
    // name its own directory, so a bound test that varied one and pinned the other
    // would now be testing an impossible shape rather than the bound.
    const idAt = "s".repeat(MAX_DEFINITION_ID);
    // Under a DOCUMENTED skills root since codex round 6 #1 — the locator's root is
    // bound too, so padding has to live inside the tree rather than replace it.
    const head = ".guild/skills/";
    const tail = `/${idAt}/SKILL.md`;
    const pathAt = `${head}${"d".repeat(MAX_RELATIVE_PATH - head.length - tail.length)}${tail}`;
    expect(pathAt.length).toBe(MAX_RELATIVE_PATH);
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: idAt, relative_path: pathAt }],
      })
    ).not.toBeNull();
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: idAt, relative_path: `${head}d${pathAt.slice(head.length)}` }],
      })
    ).toBeNull();
    const idOver = "s".repeat(MAX_DEFINITION_ID + 1);
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: idOver, relative_path: `.guild/skills/${idOver}/SKILL.md` }],
      })
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
          // A "full-length ambiguous trail is the dead statement's signature" clause
          // stood here and was FALSE (codex round 5, #6): the valid unlabelled loop
          // `A@a→B@b, B@b→A@a` yields `ambiguous` with `trail.length === 2 === entries
          // .length`, from the legitimate cycle guard and not from the post-loop
          // return. The shapes iterated here never produced it, so a false claim
          // passed as a green assertion — the same vacuity codex found in my symbol
          // test. Removed rather than narrowed: the length bound and the strict
          // monotonicity assertion are the properties that actually keep the
          // statement dead, and they are asserted directly.
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
    ["leading dash", "-flag"],
    ["leading dot", ".hidden"],
    ["space", "a b"],
  ])("skills[].id rejects a non-token identity — %s", (_label, bad) => {
    // THE PATH IS BUILT FROM THE ID, and that is the whole point (codex round 6, #3).
    // These fixtures used to vary `id` while pinning `.guild/skills/s1/SKILL.md`, so
    // they failed the owning-directory binding and NEVER reached token validation:
    // codex replaced `isIdentityToken` with a bare bounded-string check and all 359
    // assertions still passed. Building the path from the id is what makes the
    // directory binding satisfiable, so the token rule is the only thing left to
    // reject them.
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [{ ...validSkill(), id: bad, relative_path: `.guild/skills/${bad}/SKILL.md` }],
      })
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
      validateProjectDefinitionRefV1({
        ...validRef(),
        // path built from the id — the two are bound since codex round 2 #3
        skills: [{ ...validSkill(), id: good, relative_path: `.guild/skills/${good}/SKILL.md` }],
      })
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


describe("D1-R2 — an era is SUSPENDED by reuse, never destroyed", () => {
  /**
   * FOUND BY CODEX AGAINST MY OWN ERA FIX — the fifth wrong rule on this file, and
   * reproduced before rewriting:
   *
   *   A→X(1), X→Y(2), B→X(3), X→B(4 rb 3), Y→X(5 rb 2), X→A(6 rb 1)
   *     prefixes 1-5 valid; the whole history REJECTED; resolving A -> ambiguous
   *
   * This is strict LIFO with no collapse anywhere: 3 occupies the vacated X, 4 undoes
   * it, 5 restores X's ORIGINAL era, 6 unwinds 1. My first era rule DELETED X's stack
   * at 3, so by 6 there was nothing left to pop. "Drop the stale era" was right about
   * which era is in force and wrong about what happens to the one underneath.
   *
   * FIX: a STACK of eras. Reuse PUSHES; exhausting an era POPS it and the suspended
   * era comes back into force. Nothing is discarded, so "what rides this identity
   * right now" stays answerable at every depth.
   */
  it("accepts the suspend-and-restore history my first era rule rejected", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          { from: loc("B", "b"), to: ref("X", "3") },
          rb(3, { from: loc("X", "3"), to: ref("B", "b") }),
          rb(2, { from: loc("Y", "e"), to: ref("X", "3") }),
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });

  it("…and resolves the original lineage through it", () => {
    const m = chain([
      { from: loc("A", "a"), to: ref("X", "3") },
      { from: loc("X", "3"), to: ref("Y", "e") },
      { from: loc("B", "b"), to: ref("X", "3") },
      rb(3, { from: loc("X", "3"), to: ref("B", "b") }),
      rb(2, { from: loc("Y", "e"), to: ref("X", "3") }),
      rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("a") }).status).toBe(
      "resolved"
    );
  });

  it("nesting deeper still unwinds — three eras of one identity", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Y", "e") },
          { from: loc("B", "b"), to: ref("X", "3") },
          { from: loc("X", "3"), to: ref("Z", "4") },
          { from: loc("C", "c"), to: ref("X", "3") },
          rb(5, { from: loc("X", "3"), to: ref("C", "c") }),
          rb(4, { from: loc("Z", "4"), to: ref("X", "3") }),
          rb(3, { from: loc("X", "3"), to: ref("B", "b") }),
          rb(2, { from: loc("Y", "e"), to: ref("X", "3") }),
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
        ])
      )
    ).not.toBeNull();
  });

  it("but a SUSPENDED era's sequence still cannot be reached past the era above it", () => {
    // Suspension is not a bypass: while era 2 is in force, naming era 1's sequence
    // finds a different current top and is rejected. The LIFO discipline holds
    // across the boundary rather than being tunnelled through it.
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

  it("and D1's partial un-collapse is STILL rejected within one era", () => {
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
});

describe("D6-R2 — a pinned skill's declared id is bound to the bytes it names", () => {
  /**
   * CODEX ROUND 2, #3 (P1), reproduced first. Both of these VALIDATED:
   *
   *   { id: "read-only-review",
   *     relative_path: ".guild/skills/deploy-production/SKILL.md", content_hash: … }
   *
   *   two DISTINCT ids naming the SAME `relative_path`
   *
   * `PinnedSkillRef.id` is documented as "the `.guild/skills/<id>/` directory name",
   * but id and path were checked independently — so a consumer selecting
   * `read-only-review` was handed the deploy skill's pinned bytes under a trusted
   * name. This is the same category as D3: an invariant the doc states and the
   * validator did not keep.
   *
   * The dedup gap is the same defect from the other side: the bundle rejected
   * duplicate IDS ("ambiguous about which bytes ride") while accepting duplicate
   * LOCATORS, which is ambiguous about exactly the same thing.
   */
  const validRef = () => ref("A", "a");
  const skill = (id: string, path?: string) => ({
    id,
    relative_path: path ?? `.guild/skills/${id}/SKILL.md`,
    content_hash: H("a"),
  });

  it("rejects a skill whose id does not name its own directory", () => {
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [skill("read-only-review", ".guild/skills/deploy-production/SKILL.md")],
      })
    ).toBeNull();
  });

  it("rejects two distinct ids naming the SAME locator — via the binding, not a second guard", () => {
    // Recorded precisely, because it changed what shipped. A separate duplicate-path
    // guard was written for this and then DELETED: once each id must name its own
    // directory, two entries sharing a path share that directory and therefore share
    // an id, which the duplicate-ID rule already rejects. The sweep proved it —
    // weakening the locator guard reddened nothing — so it was an untestable guard,
    // of the class this task removes rather than ships.
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [skill("s1"), { ...skill("s2"), relative_path: ".guild/skills/s1/SKILL.md" }],
      })
    ).toBeNull();
  });

  it("still rejects duplicate ids, as before", () => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [skill("s1"), skill("s1")] })
    ).toBeNull();
  });

  it.each([
    [".guild project layout", "s1", ".guild/skills/s1/SKILL.md"],
    ["plugin tiered layout", "tdd", "skills/meta/tdd/SKILL.md"],
    ["long real slug", "cross-host-runtime-boundary-review", ".guild/skills/cross-host-runtime-boundary-review/SKILL.md"],
  ])("accepts every real layout — %s", (_label, id, path) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [skill(id, path)] })
    ).not.toBeNull();
  });

  it("rejects a path with no directory at all to own the id", () => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [skill("s1", "SKILL.md")] })
    ).toBeNull();
  });

  it("a bundle of several distinct, well-formed skills still validates", () => {
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [skill("s1"), skill("s2"), skill("s3")],
      })
    ).not.toBeNull();
  });
});


describe("D1-R3 / D3-R3 / D6-R3 — codex round 3, all reproduced against my own fixes", () => {
  const validRef = () => ref("A", "a");

  /**
   * R3 #1 (P1). D1 guards the DEPARTURE side of a rollback; the LANDING side was
   * unguarded. Reproduced: `A→X(1), B→A(2), X→A(3 rb 1), A→B(4 rb 2)` VALIDATED and
   * resolving A answered `resolved → B` on trail [1,3,4], when A's own rollback
   * should have left it at A. Entry 2 re-created `A`, so entry 3 restored it on top
   * of a live occupant and entry 4 then passed `length === 1` while performing
   * exactly the partial un-collapse D1 forbids.
   */
  it("R3#1 rejects a rollback restoring an identity something else already rides", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("B", "b"), to: ref("A", "a") },
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
          rb(2, { from: loc("A", "a"), to: ref("B", "b") }),
        ])
      )
    ).toBeNull();
  });

  it("R3#1 …and it is rejected at entry 3, where the collision happens", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: ref("X", "3") },
          { from: loc("B", "b"), to: ref("A", "a") },
          rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
        ])
      )
    ).toBeNull();
  });

  it.each([
    [
      "plain forward-append rollback",
      [
        { from: loc("A", "a"), to: ref("B", "b") },
        rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      ],
    ],
    [
      "sequential rollback of a multi-step migration",
      [
        { from: loc("A", "a"), to: ref("B", "b") },
        { from: loc("B", "b"), to: ref("C", "c") },
        rb(2, { from: loc("C", "c"), to: ref("B", "b") }),
        rb(1, { from: loc("B", "b"), to: ref("A", "a") }),
      ],
    ],
    [
      "suspend-and-restore across eras",
      [
        { from: loc("A", "a"), to: ref("X", "3") },
        { from: loc("X", "3"), to: ref("Y", "e") },
        { from: loc("B", "b"), to: ref("X", "3") },
        rb(3, { from: loc("X", "3"), to: ref("B", "b") }),
        rb(2, { from: loc("Y", "e"), to: ref("X", "3") }),
        rb(1, { from: loc("X", "3"), to: ref("A", "a") }),
      ],
    ],
  ])("R3#1 leaves the legitimate landings alone — %s", (_label, parts) => {
    expect(validateAdoptionManifestV1(chain(parts as Array<Partial<AdoptionEntry>>))).not.toBeNull();
  });

  /**
   * R3 #3 (P1). `A@null→removed(1), B→A@a(2)` VALIDATED: the tombstone was keyed on
   * `A@null` and the landing was `A@a`. If A's unrecoverable bytes WERE `a`, that
   * re-created exactly the removed definition. Absence of evidence is not evidence
   * of different bytes — the rule this file already applies to a null target hash in
   * the rollback proof.
   */
  it("R3#3 a hash-less removal tombstones the whole id", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: { ...loc("A", "a"), content_hash: null }, to: null, reason: "removed", detail: "bytes unrecoverable" },
          { from: loc("B", "b"), to: ref("A", "a") },
        ])
      )
    ).toBeNull();
  });

  it("R3#3 …for ANY bytes, not just the one that happened to be tried", () => {
    for (const h of ["a", "b", "c"]) {
      expect(
        validateAdoptionManifestV1(
          chain([
            { from: { ...loc("A", "a"), content_hash: null }, to: null, reason: "removed", detail: "bytes unrecoverable" },
            { from: loc("B", "b"), to: ref("A", h) },
          ])
        )
      ).toBeNull();
    }
  });

  it("R3#3 …while a KNOWN-bytes removal still retires only those bytes", () => {
    // The conservative widening applies ONLY where the evidence is missing.
    // Over-widening it would be its own defect.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "gone" },
          { from: loc("B", "b"), to: ref("A", "b") },
        ])
      )
    ).not.toBeNull();
  });

  /**
   * R3 #4 (P2). `isBoundedScalar` used `string.length` — UTF-16 CODE UNITS — while
   * the surrounding documentation promised byte limits and a byte ceiling. A
   * 1,023-code-unit path of `é` was accepted at 2,041 UTF-8 bytes.
   */
  it("R3#4 the bound is UTF-8 BYTES, not code units", () => {
    const accented = "é".repeat(MAX_RELATIVE_PATH - 6) + "/a.md";
    expect(accented.length).toBeLessThanOrEqual(MAX_RELATIVE_PATH);
    expect(Buffer.byteLength(accented, "utf8")).toBeGreaterThan(MAX_RELATIVE_PATH);
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), relative_path: accented })
    ).toBeNull();
  });

  it("R3#4 …and an ASCII value at exactly the cap is unaffected", () => {
    // The two measures coincide for the values these fields really hold, so nothing
    // legitimate narrowed.
    const at = "d".repeat(MAX_RELATIVE_PATH - 5) + "/a.md";
    expect(Buffer.byteLength(at, "utf8")).toBe(MAX_RELATIVE_PATH);
    expect(validateProjectDefinitionRefV1({ ...validRef(), relative_path: at })).not.toBeNull();
  });
});


describe("R4 — codex round 4: the tombstone's source side, and bounds before EVERY enumeration", () => {
  const validRef = () => ref("A", "a");

  /**
   * R4 #1 (P1). My round-3 tombstone was checked only against `to`, so this
   * validated and resolving `A@a` answered `resolved → C` on trail [2]:
   *
   *   A@null→removed(1), A@a→C(2)
   *
   * `A@a` had never been SEEN as dead, so default liveness presumed it live and it
   * departed straight out of the log. The claim "a hash-less removal tombstones the
   * whole (kind, id)" was true on the landing side and false on the source side —
   * the reported instance fixed and the CLASS left open, which is exactly the
   * failure this task exists to stop repeating. Now checked on both sides.
   */
  const removedNull = () => ({
    from: { ...loc("A", "a"), content_hash: null },
    to: null,
    reason: "removed" as const,
    detail: "bytes unrecoverable",
  });

  it("R4#1 a tombstoned id cannot depart as a SOURCE either", () => {
    expect(
      validateAdoptionManifestV1(chain([removedNull(), { from: loc("A", "a"), to: ref("C", "c") }]))
    ).toBeNull();
  });

  it("R4#1 …for any bytes, and the query no longer resolves through it", () => {
    for (const h of ["a", "b", "c"]) {
      const m = chain([removedNull(), { from: loc("A", h), to: ref("C", "c") }]);
      expect(validateAdoptionManifestV1(m)).toBeNull();
      expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H(h) }).status).toBe(
        "ambiguous"
      );
    }
  });

  it("R4#1 …and both sides agree: landing is still barred too", () => {
    expect(
      validateAdoptionManifestV1(chain([removedNull(), { from: loc("B", "b"), to: ref("A", "a") }]))
    ).toBeNull();
  });

  it("R4#1 a KNOWN-bytes removal still bars only those bytes, on both sides", () => {
    // The widening applies only where the evidence is missing — asserted from the
    // source side as well, since that is the side that was wrong.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "gone" },
          { from: loc("A", "b"), to: ref("C", "c") },
        ])
      )
    ).not.toBeNull();
  });

  /**
   * R4 #4 (P2). D5 moved the cap ahead of `getOwnPropertyNames` and left it BEHIND
   * `getOwnPropertySymbols`, which is an enumeration too. An oversized array carrying
   * 100,000 symbol keys took 160.6ms (entries) / 131.1ms (skills) to reject, against
   * ~0.5ms for the same arrays without symbols. Bounding one enumeration and leaving
   * the other ahead of the bound is not a bound.
   */
  /**
   * A RATIO, not an absolute threshold — and the first version of this test was
   * VACUOUS, which is worth recording. It asserted "< 40ms" while a 100,000-symbol
   * scan costs ~12ms on this machine, so it passed with the guard weakened. Codex's
   * 160.6ms/131.1ms were measured on different hardware, and pinning cost to a
   * machine-specific constant pins nothing portable.
   *
   * The ratio is self-calibrating: with the cap ahead of BOTH enumerations, rejecting
   * a symbol-laden oversized array costs the same as rejecting a bare one, so the
   * ratio is ~1. With the symbol scan ahead of the cap it is ~50x on any machine,
   * because the numerator grows with the symbol count and the denominator does not.
   */
  const MAX_SYMBOL_COST_RATIO = 6;
  const SYMBOLS = 300_000;
  const withSymbols = (n: number, symbols: number): unknown[] => {
    const a = new Array(n).fill(null);
    for (let i = 0; i < symbols; i++) {
      (a as unknown as Record<symbol, unknown>)[Symbol(`k${i}`)] = 1;
    }
    return a;
  };
  const timeMs = (f: () => unknown): number => {
    f();
    const t = process.hrtime.bigint();
    f();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };

  it("R4#4 symbols do not make an oversized ENTRIES array cost more to reject", () => {
    const mk = (entries: unknown[]) => ({
      schema_version: ADOPTION_MANIFEST_SCHEMA,
      project_id: "plugin",
      entries,
    });
    const laden = mk(withSymbols(MAX_ENTRIES + 1, SYMBOLS));
    const bare = mk(withSymbols(MAX_ENTRIES + 1, 0));
    expect(validateAdoptionManifestV1(laden)).toBeNull();
    expect(validateAdoptionManifestV1(bare)).toBeNull();
    const ladenMs = timeMs(() => validateAdoptionManifestV1(laden));
    const bareMs = timeMs(() => validateAdoptionManifestV1(bare));
    expect(ladenMs / Math.max(bareMs, 0.01)).toBeLessThan(MAX_SYMBOL_COST_RATIO);
  });

  it("R4#4 symbols do not make an oversized SKILLS array cost more to reject", () => {
    const laden = { ...validRef(), skills: withSymbols(MAX_SKILLS + 1, SYMBOLS) };
    const bare = { ...validRef(), skills: withSymbols(MAX_SKILLS + 1, 0) };
    expect(validateProjectDefinitionRefV1(laden)).toBeNull();
    expect(validateProjectDefinitionRefV1(bare)).toBeNull();
    const ladenMs = timeMs(() => validateProjectDefinitionRefV1(laden));
    const bareMs = timeMs(() => validateProjectDefinitionRefV1(bare));
    expect(ladenMs / Math.max(bareMs, 0.01)).toBeLessThan(MAX_SYMBOL_COST_RATIO);
  });

  it("R4#4 …and an IN-BOUNDS array with a symbol key is still rejected outright", () => {
    // The cap running first must not let a symbol-carrying array through when it is
    // small enough to pass the count — the shape rule still has to fire.
    const skills = withSymbols(0, 1);
    expect(validateProjectDefinitionRefV1({ ...validRef(), skills })).toBeNull();
    const entries = withSymbols(0, 1);
    expect(
      validateAdoptionManifestV1({
        schema_version: ADOPTION_MANIFEST_SCHEMA,
        project_id: "plugin",
        entries,
      })
    ).toBeNull();
  });
});


describe("R5 — codex round 5: both halves of every hash/no-hash pairing", () => {
  const validRef = () => ref("A", "a");
  const skill = (id: string, path?: string) => ({
    id,
    relative_path: path ?? `.guild/skills/${id}/SKILL.md`,
    content_hash: H("a"),
  });

  /**
   * R5 #1 (P1). The round-4 fix closed "the REMOVAL did not know its bytes" and left
   * "the LATER ENTRY does not know its bytes" open — the instance-not-class shape,
   * for the third time. `A@a→null(removed)`, `A@null→C(2)` validated, because
   * `A@null` is a different `identityOf` key and nothing had marked it dead. Unknown
   * bytes could BE the retired bytes.
   */
  it("R5#1 a known-byte removal also bars a later HASH-LESS source", () => {
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "gone" },
          { from: { ...loc("A", "a"), content_hash: null }, to: ref("C", "c") },
        ])
      )
    ).toBeNull();
  });

  it("R5#1 …and known-vs-known, where the hashes really differ, still passes", () => {
    // The rule closes the pairings where one side is UNKNOWN. It must not swallow the
    // case where both sides are known and genuinely different — that is a different
    // definition sharing an id, which D3 already asserted stays legal.
    expect(
      validateAdoptionManifestV1(
        chain([
          { from: loc("A", "a"), to: null, reason: "removed", detail: "gone" },
          { from: loc("A", "b"), to: ref("C", "c") },
        ])
      )
    ).not.toBeNull();
  });

  it.each([
    ["hash-less removal, known source", null, "a"],
    ["hash-less removal, hash-less source", null, null],
    ["known removal, hash-less source", "a", null],
  ])("R5#1 every UNKNOWN-bearing pairing is closed — %s", (_label, removalHash, sourceHash) => {
    expect(
      validateAdoptionManifestV1(
        chain([
          {
            from: { ...loc("A", "a"), content_hash: removalHash === null ? null : H(removalHash) },
            to: null,
            reason: "removed",
            detail: "gone",
          },
          {
            from: { ...loc("A", "a"), content_hash: sourceHash === null ? null : H(sourceHash) },
            to: ref("C", "c"),
          },
        ])
      )
    ).toBeNull();
  });

  /**
   * R5 #2 (P1). Binding the owning DIRECTORY was half the binding: `id:
   * "deploy-production"` at `.guild/skills/deploy-production/README.md` validated,
   * and the hash verifies the README's bytes correctly while the consumer believes it
   * received the pinned skill DEFINITION.
   */
  it("R5#2 a pinned skill must name a skill BODY, not any file in its directory", () => {
    expect(
      validateProjectDefinitionRefV1({
        ...validRef(),
        skills: [skill("deploy-production", ".guild/skills/deploy-production/README.md")],
      })
    ).toBeNull();
  });

  it.each([
    [".guild project layout", "s1", ".guild/skills/s1/SKILL.md"],
    ["plugin tiered layout", "tdd", "skills/meta/tdd/SKILL.md"],
  ])("R5#2 …and both documented layouts still validate — %s", (_label, id, path) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [skill(id, path)] })
    ).not.toBeNull();
  });

  /**
   * R5 #3 (P2). D6 claimed "every scalar is BOUNDED and SHAPE-CHECKED"; this one was
   * only bounded. The grammar deliberately still admits `/`, which is why the token
   * shape was withheld from this field in the first place.
   */
  it.each([
    ["prose with spaces", "not a commit"],
    ["traversal-shaped", "../../not-a-ref"],
    ["leading dot", ".hidden"],
    ["emoji prose", "🚨 arbitrary prose 🚨"],
    ["embedded traversal", "refs/../../etc"],
  ])("R5#3 source_commit rejects a non-commit-ish — %s", (_label, bad) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: bad })).toBeNull();
  });

  it.each([
    ["abbreviated sha", "abc1234"],
    ["full sha", "a".repeat(40)],
    ["qualified ref", "refs/tags/v2.5.0"],
    ["describe output", "release-2.5.0-1-g02bcf9f"],
    ["prerelease tag", "v2.5.0-beta.1"],
  ])("R5#3 …and every real git spelling still validates — %s", (_label, good) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), source_commit: good })
    ).not.toBeNull();
  });
});


describe("R6 — codex round 6: the locator's ROOT, and git's own ref rules", () => {
  const validRef = () => ref("A", "a");
  const sk = (id: string, path: string) => ({ id, relative_path: path, content_hash: H("a") });

  /**
   * R6 #1 (P1). `<id>/SKILL.md` was still only two of the three components. A
   * binding is a binding when ROOT, owning DIRECTORY and BODY FILENAME are all
   * fixed; I closed them one round at a time, which is the instance-not-class habit
   * this file keeps punishing.
   */
  it.each([
    ["docs tree", "docs/tdd/SKILL.md"],
    ["agents tree", ".guild/agents/tdd/SKILL.md"],
    ["scratch tree", "tmp/tdd/SKILL.md"],
    ["bare", "tdd/SKILL.md"],
  ])("R6#1 a skill locator outside a skills root is rejected — %s", (_label, path) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), skills: [sk("tdd", path)] })).toBeNull();
  });

  it.each([
    ["project layout", ".guild/skills/tdd/SKILL.md"],
    ["plugin tiered layout", "skills/meta/tdd/SKILL.md"],
  ])("R6#1 …and both documented roots still validate — %s", (_label, path) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), skills: [sk("tdd", path)] })
    ).not.toBeNull();
  });

  /**
   * R6 #2 (P2). My round-5 grammar was an allowlist invented from the examples in
   * front of me, and it disagreed with `git check-ref-format` in BOTH directions —
   * rejecting real tags and accepting invalid ones. The rule is now git's own,
   * expressed as git expresses it: a denylist of what a ref name may not contain.
   */
  it.each([
    ["at-sign tag", "refs/tags/release@2026"],
    ["non-ASCII tag", "refs/tags/rélease-v1"],
    ["abbreviated sha", "abc1234"],
    ["full sha", "a".repeat(40)],
    ["qualified ref", "refs/tags/v2.5.0"],
    ["describe output", "release-2.5.0-1-g02bcf9f"],
    ["prerelease tag", "v2.5.0-beta.1"],
  ])("R6#2 a REAL git ref is accepted — %s", (_label, good) => {
    expect(
      validateProjectDefinitionRefV1({ ...validRef(), source_commit: good })
    ).not.toBeNull();
  });

  it.each([
    ["double dot anywhere", "refs/tags/release..v1"],
    ["empty segment", "refs//tags/v1"],
    ["lock suffix", "refs/tags/v1.lock"],
    ["trailing slash", "refs/tags/v1/"],
    ["dot-leading segment", "refs/tags/.hidden"],
    ["leading dot", ".hidden"],
    ["trailing dot", "refs/tags/v1."],
    ["forbidden caret", "refs/tags/v1^"],
    ["forbidden tilde", "refs/tags/v1~1"],
    ["forbidden colon", "refs/tags/v1:x"],
    ["forbidden question", "refs/tags/v1?"],
    ["forbidden asterisk", "refs/tags/v1*"],
    ["forbidden bracket", "refs/tags/v1[x]"],
    ["forbidden backslash", "refs\\tags\\v1"],
    ["reflog syntax", "HEAD@{1}"],
    ["bare at", "@"],
    ["whitespace prose", "not a commit"],
    ["traversal prose", "../../not-a-ref"],
  ])("R6#2 …and an INVALID ref is rejected — %s", (_label, bad) => {
    expect(validateProjectDefinitionRefV1({ ...validRef(), source_commit: bad })).toBeNull();
  });
});


// ── Defect 9 — a verbatim REHOME is unresolvable, so it must be refused ─────

describe("D9 — an adoption whose successor IS its source is refused, not silently written", () => {
  /**
   * REPORTED by the resolver lane, REPRODUCED here before anything changed, and it
   * is worse than reported. The claim was that a verbatim rehome "dies at liveness";
   * what actually happens is:
   *
   *   from: architect@a (home: umbrella-guild)  ->  to: architect@a (project ref)
   *     validates:      TRUE
   *     resolve:        ambiguous, trail [1]      <- written fine, unreadable
   *     can continue:   false
   *     can roll back:  false
   *
   * So the manifest ACCEPTS an entry that provably cannot be read back. The write
   * side says yes and the read side says `ambiguous`, because `identityOf` ignores
   * the owning layer: `from` and `to` are literally one identity, so traversal's
   * cycle guard sees the walk return to where it started.
   *
   * That is why the refusal costs NOTHING that exists today — the entry carries no
   * resolvable information now. It converts a silent write-then-unreadable into an
   * explicit rejection at the entry validator, where a producer meets it immediately.
   *
   * The REAL fix is a location-bearing identity, which needs a schema change (`to`
   * has no home/layer field at all) and is the SAME decision as the cross-project
   * conflation gap. Both are escalated together; this rule is the honest interim.
   */
  const umbrella = (id: string, hash: string) => ({
    id,
    historical_path: `/umbrella/.guild/agents/${id}.md`,
    content_hash: H(hash),
    home: "umbrella-guild" as const,
  });

  it("REFUSES a verbatim rehome — same kind, id and bytes on both sides", () => {
    expect(
      validateAdoptionManifestV1(
        chain([{ from: umbrella("architect", "a"), to: ref("architect", "a"), reason: "rehomed" }])
      )
    ).toBeNull();
  });

  it("…at the ENTRY validator, so a producer meets it immediately", () => {
    expect(
      validateAdoptionEntry(
        rawD9({ from: umbrella("architect", "a"), to: ref("architect", "a"), reason: "rehomed" })
      )
    ).toBeNull();
  });

  it.each(["migrated", "collapsed", "rehomed", "renamed", "rolled_back"])(
    "…whatever the reason claims to be doing — %s",
    (reason) => {
      expect(
        validateAdoptionEntry(
          rawD9({
            from: umbrella("architect", "a"),
            to: ref("architect", "a"),
            reason: reason as AdoptionEntry["reason"],
            detail: "note",
            reverses_sequence: reason === "rolled_back" ? null : null,
          })
        )
      ).toBeNull();
    }
  );

  it("`isUnstampedAdoption` names the reason a producer needs", () => {
    // The contract returns `null`, never a typed reason, so this predicate is the
    // only channel through which "why" can travel. A producer that gets `null` can
    // ask this and learn that the adoption must stamp provenance.
    expect(
      isUnstampedAdoption(
        rawD9({ from: umbrella("architect", "a"), to: ref("architect", "a"), reason: "rehomed" })
      )
    ).toBe(true);
  });

  // ── the STAMPED adoption — the shape that must keep working ──────────────

  const stamped = () => ({
    from: umbrella("architect", "a"),
    to: ref("architect", "b"), // provenance stamped ⇒ different bytes ⇒ distinct identity
    reason: "rehomed" as const,
  });

  it("a STAMPED adoption validates, resolves, and continues", () => {
    const m = chain([stamped()]);
    expect(validateAdoptionManifestV1(m)).not.toBeNull();
    const r = resolveHistorical(m, { kind: "agent", id: "architect", content_hash: H("a") });
    expect(r.status).toBe("resolved");
    expect(r.ref?.content_hash).toBe(H("b"));
    expect(
      validateAdoptionManifestV1(
        chain([
          stamped(),
          {
            from: { ...umbrella("architect", "b"), home: "project-guild" as const },
            to: ref("architect2", "c"),
          },
        ])
      )
    ).not.toBeNull();
  });

  it("…and `isUnstampedAdoption` is false for it", () => {
    expect(isUnstampedAdoption(rawD9(stamped()))).toBe(false);
  });

  it("a same-ID adoption with DIFFERENT bytes is untouched — only identity matters", () => {
    // The rule keys on the whole identity, not on the id. A genuine same-id upgrade
    // (bytes changed) is an ordinary adoption and must stay legal.
    expect(
      validateAdoptionManifestV1(
        chain([{ from: umbrella("architect", "a"), to: ref("architect", "b") }])
      )
    ).not.toBeNull();
  });

  it("a same-BYTES adoption under a DIFFERENT id is untouched too", () => {
    expect(
      validateAdoptionManifestV1(
        chain([{ from: umbrella("architect", "a"), to: ref("architect-renamed", "a") }])
      )
    ).not.toBeNull();
  });

  it("`isUnstampedAdoption` never throws on hostile input", () => {
    for (const hostile of [null, undefined, 42, "x", {}, new Proxy({}, { get() { throw new Error("boom"); } })]) {
      expect(() => isUnstampedAdoption(hostile)).not.toThrow();
      expect(isUnstampedAdoption(hostile)).toBe(false);
    }
  });

  // ── the property the resolver lane asked me to confirm my fixes preserve ──

  it("a bare-id query is ambiguous ONLY when the id really has two distinct sources", () => {
    // Two sources = same id, DIFFERENT bytes. Pinning `content_hash` disambiguates.
    const two = chain([
      { from: umbrella("A", "a"), to: ref("B", "b") },
      { from: umbrella("A", "c"), to: ref("D", "d") },
    ]);
    expect(validateAdoptionManifestV1(two)).not.toBeNull();
    expect(resolveHistorical(two, { kind: "agent", id: "A" }).status).toBe("ambiguous");
    expect(resolveHistorical(two, { kind: "agent", id: "A", content_hash: H("a") }).ref?.id).toBe("B");
    expect(resolveHistorical(two, { kind: "agent", id: "A", content_hash: H("c") }).ref?.id).toBe("D");
  });

  it("…and NOT for adopt→rollback→re-adopt, which is ONE identity and one history", () => {
    // Worth pinning because the two are easy to conflate: identical bytes across a
    // rollback are a re-adoption, not two sources, and a bare-id query resolves.
    const readopt = chain([
      { from: umbrella("A", "a"), to: ref("B", "b") },
      rb(1, { from: umbrella("B", "b"), to: ref("A", "a") }),
      { from: umbrella("A", "a"), to: ref("C", "c") },
    ]);
    expect(validateAdoptionManifestV1(readopt)).not.toBeNull();
    expect(resolveHistorical(readopt, { kind: "agent", id: "A" }).status).toBe("resolved");
  });
});
