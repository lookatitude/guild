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
