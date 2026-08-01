/**
 * scripts/__tests__/adoption-manifest-hardening.test.ts
 *
 * Regression coverage for the SEVEN defects codex raised against the
 * `guild.adoption_manifest.v1` rewrite. Split from the main suite because these
 * are adversarial-round regressions rather than contract conformance — each one
 * pins a specific hole shut.
 *
 * Notably #4 is the STANDING opts-TOCTOU class (spec README rule 4) applied to
 * this file's OWN new API: the query boundary was unhardened even though the rule
 * had just been written down.
 */

import {
  ADOPTION_MANIFEST_SCHEMA,
  entryDigest,
  manifestCommitment,
  resolveHistorical,
  validateAdoptionEntry,
  validateAdoptionManifestV1,
  validateLegacyLocator,
  verifyAgainstTip,
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

// ── #1 — the self-derived chain has an HONEST limit; the tip digest closes it ──

describe("#1 — an external tip digest closes what a self-derived chain cannot", () => {
  it("TRUNCATION re-chains trivially and PASSES plain validation — the documented limit", () => {
    const m = chain([{}, { from: loc("b") }, { from: loc("c") }]);
    const truncated: AdoptionManifestV1 = { ...m, entries: m.entries.slice(0, 2) };
    // Stated in the module header rather than hidden: dropping the tail leaves a
    // structurally valid chain, because the validator derives it from what it was given.
    expect(validateAdoptionManifestV1(truncated)).not.toBeNull();
  });

  it("but an EXTERNALLY COMMITTED tip catches the truncation", () => {
    const m = chain([{}, { from: loc("b") }, { from: loc("c") }]);
    const committedTip = manifestCommitment(m).digest;
    const truncated: AdoptionManifestV1 = { ...m, entries: m.entries.slice(0, 2) };
    expect(verifyAgainstTip(m, committedTip)).toBe(true);
    expect(verifyAgainstTip(truncated, committedTip)).toBe(false); // ← the catch
  });

  it("verifyAgainstTip is fail-closed on an invalid manifest or malformed tip", () => {
    const m = chain([{}]);
    expect(verifyAgainstTip({ nonsense: true }, manifestCommitment(m).digest)).toBe(false);
    expect(verifyAgainstTip(m, "not-a-digest")).toBe(false);
  });

  it("an EMPTY manifest still has a real commitment — distinct from invalid", () => {
    // codex round 3 (#2): null conflated "invalid" with "validly empty". A
    // committer must be able to tell those apart.
    const empty = manifestCommitment(chain([]));
    expect(empty.ok).toBe(true);
    expect(empty.empty).toBe(true);
    expect(verifyAgainstTip(chain([]), empty.digest)).toBe(true);

    const invalid = manifestCommitment({ nonsense: true });
    expect(invalid.ok).toBe(false);
    expect(invalid.digest).toBeNull();
  });

  it("#1 the commitment binds project_id — a valid commitment cannot be REPLAYED under another project", () => {
    const m = chain([{}, { from: loc("b") }]);
    const committed = manifestCommitment(m).digest;
    // Same entries, different namespace. Successor paths are project-RELATIVE, so
    // only project_id says which root they resolve against.
    const replayed: AdoptionManifestV1 = { ...m, project_id: "website" };
    expect(verifyAgainstTip(m, committed)).toBe(true);
    expect(verifyAgainstTip(replayed, committed)).toBe(false);
  });

  it("#2 the commitment API is hardened — a Proxy yields ok:false, never a throw", () => {
    const m = chain([{}]);
    const hostile = new Proxy(m, {
      get() {
        throw new Error("boom");
      },
    });
    expect(() => manifestCommitment(hostile)).not.toThrow();
    expect(manifestCommitment(hostile).ok).toBe(false);
  });
});

// ── #2 — a null content_hash is NOT a wildcard ──────────────────────────────

describe("#2 — absence of a hash is not agreement", () => {
  it("an unrelated entry recording no hash cannot continue a known-identity chain", () => {
    const b = ref("B");
    const m = chain([
      { from: loc("A"), to: b },
      // Same id, NO recorded hash — previously a wildcard that hijacked the chain
      // and resolved a historical run to WRONG's bytes.
      {
        from: { id: "B", historical_path: "/g/other/B.md", content_hash: null, home: "project-guild" },
        to: ref("WRONG"),
      },
    ]);
    const r = resolveHistorical(m, { kind: "agent", id: "A" });
    expect(r.ref?.id).toBe("B");
    expect(r.trail).toEqual([1]);
  });

  it("a supplied query hash is not satisfied by an entry with a null hash", () => {
    const m = chain([
      {
        from: { id: "A", historical_path: "/g/A.md", content_hash: null, home: "project-guild" },
        to: ref("B"),
      },
    ]);
    expect(resolveHistorical(m, { kind: "agent", id: "A", content_hash: H("f") }).status).toBe(
      "not_found"
    );
  });
});

// ── #3 — a rollback must LAND on the target's source identity ───────────────

describe("#3 — a rollback proves reversal, not just its starting point", () => {
  it("rejects a migration wearing a rollback label", () => {
    const b = ref("B");
    const m = chain([
      { from: loc("A"), to: b },
      {
        from: {
          id: "B",
          historical_path: "/g/.guild/agents/B.md",
          content_hash: b.content_hash,
          home: "project-guild",
        },
        to: ref("C"), // does NOT return to A
        reason: "rolled_back",
        detail: "claims to reverse 1",
        reverses_sequence: 1,
      },
    ]);
    expect(validateAdoptionManifestV1(m)).toBeNull();
  });
});

// ── #4 — the QUERY boundary (the standing opts-TOCTOU class) ────────────────

describe("#4 — the query boundary is hardened, own-data only", () => {
  const m = () => chain([{ from: loc("A"), to: ref("B") }]);

  it("a prototype-polluted EMPTY query cannot resolve an identity", () => {
    const proto = { kind: "agent", id: "A" };
    const polluted = Object.create(proto) as Record<string, unknown>;
    // Inherited fields must not be read — the caller supplied nothing.
    expect(resolveHistorical(m(), polluted).status).toBe("ambiguous");
  });

  it("an accessor on the query is REJECTED and NEVER invoked", () => {
    let fired = false;
    const q: Record<string, unknown> = { kind: "agent" };
    Object.defineProperty(q, "id", {
      get() {
        fired = true;
        return "A";
      },
      enumerable: true,
      configurable: true,
    });
    expect(resolveHistorical(m(), q).status).toBe("ambiguous");
    expect(fired).toBe(false);
  });

  it("an unknown query key is REJECTED, not ignored", () => {
    expect(resolveHistorical(m(), { kind: "agent", id: "A", bogus: 1 }).status).toBe("ambiguous");
  });

  it("a symbol-keyed query field is rejected (getOwnPropertyNames does not see symbols)", () => {
    const q: Record<string | symbol, unknown> = { kind: "agent", id: "A" };
    q[Symbol("x")] = 1;
    // ASSERTION CORRECTED (codex round 5, #7). This read `resolved`, and its comment
    // read "isPlainDataObject's symbol check is what catches this" — but
    // `isPlainDataObject` in `adoption-manifest.ts` has NO symbol check
    // (null/type/array/Proxy/prototype, and nothing else). So the assertion pinned
    // behaviour the author believed came from somewhere it does not exist, against a
    // title that already stated the intended rule.
    //
    // The rest of the file was never in doubt: `hasExactKeys`, which validates the
    // locator, the entry and the manifest, opens with
    // `getOwnPropertySymbols(o).length > 0 → false`. The query was the only closed
    // key set checked by a hand-rolled `getOwnPropertyNames` loop, and the only one
    // that let a symbol-keyed payload through. The rule was right and this line was
    // wrong. Further cases in adoption-manifest-open-defects.test.ts (D7).
    expect(resolveHistorical(m(), q).status).toBe("ambiguous");
  });

  it("a Proxy query does not escape the never-throws contract", () => {
    const hostile = new Proxy(
      { kind: "agent", id: "A" },
      {
        get() {
          throw new Error("boom");
        },
      }
    );
    expect(() => resolveHistorical(m(), hostile)).not.toThrow();
    expect(resolveHistorical(m(), hostile).status).toBe("ambiguous");
  });

  it("a non-canonical query path is rejected — the alias rule applies to the query too", () => {
    expect(
      resolveHistorical(m(), { kind: "agent", id: "A", historical_path: "/g/./A.md" }).status
    ).toBe("ambiguous");
  });
});

// ── #5 / #6 — one spelling per field; C1 controls rejected ──────────────────

describe("#5 — exactly one path spelling is legal per field", () => {
  it("a RELATIVE historical_path is rejected — history cites ABSOLUTE paths", () => {
    // Allowing both meant `agents/a.md` and `/proj/agents/a.md` could identify one
    // file while both validated — the alias hole one level up from the segment check.
    expect(validateLegacyLocator({ ...loc("x"), historical_path: "agents/x.md" })).toBeNull();
  });

  it("an absolute historical_path is accepted", () => {
    expect(validateLegacyLocator(loc("x"))).not.toBeNull();
  });
});

describe("#6 — control rejection covers C1 and the Unicode line separators", () => {
  // Built with fromCharCode so no literal control byte appears in this source.
  const NEL = String.fromCharCode(0x85); // C1 NEL — was previously accepted
  const LS = String.fromCharCode(0x2028); // LINE SEPARATOR
  const PS = String.fromCharCode(0x2029); // PARAGRAPH SEPARATOR
  const APC = String.fromCharCode(0x9f); // C1 APC

  it.each([
    ["NEL (U+0085)", NEL],
    ["LINE SEPARATOR (U+2028)", LS],
    ["PARAGRAPH SEPARATOR (U+2029)", PS],
    ["APC (U+009F)", APC],
  ])("rejects %s in detail", (_label, ch) => {
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, detail: `a${ch}b` }))).toBeNull();
  });

  it("rejects them in historical_path too", () => {
    expect(
      validateLegacyLocator({ ...loc("x"), historical_path: `/g/a${NEL}b.md` })
    ).toBeNull();
  });

  it("still accepts ordinary text", () => {
    expect(validateAdoptionEntry(rawEntry({ sequence: 1, detail: "an ordinary note" }))).not.toBeNull();
  });
});
