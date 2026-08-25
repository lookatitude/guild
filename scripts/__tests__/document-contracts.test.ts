/**
 * scripts/__tests__/document-contracts.test.ts
 *
 * MH-05 — HTML-native typed document contracts (DC-01..DC-09).
 *
 * Red-first anchor for the three blocking findings carried from
 * review/G-lane:MH-05/result-1.json:
 *
 *   BF-01  a projection is never authority on its own — forged, stale,
 *          mismatched and unbound projections must fail closed.
 *   BF-02  validation is total and deterministic over hostile JS values
 *          (sparse arrays, throwing getters, proxies, hostile toJSON) and
 *          nothing reported valid may crash a downstream step.
 *   BF-03  a shipped lifecycle consumer adopts the typed authority flow
 *          (asserted in check-lane-liveness.test.ts).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  DOCUMENTS_MODULE_SOURCE_FILES,
  DOCUMENT_KINDS,
  canonicalDocumentJson,
  decideFromDocumentSources,
  decideFromReceiptDocument,
  documentContentHash,
  documentRoundTripEvidence,
  evaluateDocumentServiceBoundary,
  extractDocumentHtmlBinding,
  hasCanonicalReceiptWrapper,
  importLegacyMarkdown,
  migrateDocumentRecord,
  parseReceiptDocument,
  projectDocumentRecord,
  renderDocumentHtml,
  resolveDocumentAuthority,
  scanHtmlForActivePayloads,
  validateDocumentRecord,
  verifyRenderedDocumentBinding,
} from "../../src/modules/documents";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CONTENT_HASH_PATTERN = new RegExp("^sha256" + ":[0-9a-f]{64}$");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function verifyRecord(): Record<string, unknown> {
  return {
    schema_version: "guild.document.v1",
    kind: "verify",
    id: "doc-verify-0001",
    title: "Wave 3 verification",
    provenance: {
      author_id: "artifact-services",
      author_family: "claude",
      host_id: "claude-code-cli",
      created_at: "2026-07-27T00:00:00.000Z",
      source: "authored",
    },
    body: {
      outcome: "pass",
      checks: [{ id: "chk-1", name: "documents suite", result: "pass" }],
    },
  };
}

// ---------------------------------------------------------------------------
// BF-01 — projection-only authority must fail closed
// ---------------------------------------------------------------------------

describe("BF-01 forged projection authority", () => {
  it("refuses a well-shaped projection when no canonical record is present", () => {
    const record = verifyRecord();
    const valid = validateDocumentRecord(record);
    expect(valid.valid).toBe(true);

    const genuine = projectDocumentRecord(valid.record!);
    expect(genuine.ok).toBe(true);

    // A structurally perfect, genuinely-derived projection presented ALONE.
    const decision = decideFromDocumentSources({ projection: genuine.projection! });

    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.disposition).toBe("unknown");
    expect(decision.content_hash).toBeNull();
    expect(decision.refusals).toContain("projection_unbound_no_canonical_record");
  });

  it("refuses a forged projection carrying an attacker-chosen content hash", () => {
    const forged = {
      schema_version: "guild.document_projection.v1",
      record_id: "doc-verify-0001",
      record_kind: "verify",
      record_schema_version: "guild.document.v1",
      content_hash: `sha256:${"0".repeat(64)}`,
      disposition: "succeeded",
      signals: [],
      binding: `sha256:${"0".repeat(64)}`,
    };

    const decision = decideFromDocumentSources({ projection: forged });
    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.disposition).not.toBe("succeeded");
    expect(decision.content_hash).toBeNull();
  });

  it("refuses a stale projection that no longer matches its canonical record", () => {
    const record = verifyRecord();
    const valid = validateDocumentRecord(record);
    const stale = projectDocumentRecord(valid.record!).projection!;

    const moved = verifyRecord();
    (moved["body"] as Record<string, unknown>)["outcome"] = "fail";
    const movedValid = validateDocumentRecord(moved);

    const decision = decideFromDocumentSources({
      record: movedValid.record!,
      projection: stale,
    });

    expect(decision.gate_signal).toBe("refuse");
    expect(decision.refusals.length).toBeGreaterThan(0);
  });

  it("grants authority to a canonical record", () => {
    const valid = validateDocumentRecord(verifyRecord());
    const decision = decideFromDocumentSources({ record: valid.record! });

    expect(decision.authority).toBe("canonical_record");
    expect(decision.gate_signal).toBe("advance");
    expect(decision.disposition).toBe("succeeded");
    expect(decision.content_hash).toMatch(CONTENT_HASH_PATTERN);
    expect(decision.refusals).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BF-02 — validation is total over hostile JS values
// ---------------------------------------------------------------------------

describe("BF-02 hostile-value validation", () => {
  it("rejects a sparse array instead of reporting it valid", () => {
    const record = verifyRecord();
    const sparse: unknown[] = [];
    sparse[2] = { id: "chk-1", name: "n", result: "pass" };
    (record["body"] as Record<string, unknown>)["checks"] = sparse;

    const result = validateDocumentRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.record).toBeNull();
  });

  it("returns a deterministic error for a throwing getter rather than throwing", () => {
    const record = verifyRecord();
    Object.defineProperty(record, "schema_version", {
      get() {
        throw new Error("schema getter boom");
      },
      configurable: true,
      enumerable: true,
    });

    let result!: ReturnType<typeof validateDocumentRecord>;
    expect(() => {
      result = validateDocumentRecord(record);
    }).not.toThrow();
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.message).join("\n")).toMatch(/property read threw/);
    expect(result.errors.map((error) => error.code)).toContain("property_read_threw");
  });

  it("returns a deterministic error for a hostile proxy rather than throwing", () => {
    const hostile = new Proxy(verifyRecord(), {
      has() {
        throw new Error("has trap boom");
      },
      ownKeys() {
        throw new Error("ownKeys trap boom");
      },
      get() {
        throw new Error("get trap boom");
      },
    });

    let result!: ReturnType<typeof validateDocumentRecord>;
    expect(() => {
      result = validateDocumentRecord(hostile);
    }).not.toThrow();
    expect(result.valid).toBe(false);
    expect(result.record).toBeNull();
  });

  it("never reports valid a record that would crash hashing or projection", () => {
    const hostileCases: Array<() => unknown> = [
      () => {
        const record = verifyRecord();
        const sparse: unknown[] = [];
        sparse[1] = { id: "c", name: "n", result: "pass" };
        (record["body"] as Record<string, unknown>)["checks"] = sparse;
        return record;
      },
      () => {
        const record = verifyRecord();
        (record["title"] as unknown) = {
          toJSON() {
            throw new Error("hostile toJSON");
          },
        };
        return record;
      },
      () => {
        const record = verifyRecord();
        const cyclic: Record<string, unknown> = {};
        cyclic["self"] = cyclic;
        (record["body"] as Record<string, unknown>)["checks"] = cyclic;
        return record;
      },
    ];

    for (const build of hostileCases) {
      const input = build();
      const result = validateDocumentRecord(input);
      expect(result.valid).toBe(false);

      // And the downstream steps stay total for the same hostile input.
      expect(() => documentContentHash(input)).not.toThrow();
      expect(() => projectDocumentRecord(input)).not.toThrow();
      expect(() => canonicalDocumentJson(input)).not.toThrow();
    }
  });

  it("holds the invariant across a hostile-value sweep at every field position", () => {
    const hostileValues: Array<() => unknown> = [
      () => undefined,
      () => null,
      () => Number.NaN,
      () => Infinity,
      () => Symbol("s"),
      () => 10n,
      () => () => "fn",
      () => ({ toJSON() { throw new Error("hostile toJSON"); } }),
      () => {
        const sparse: unknown[] = [];
        sparse[3] = "x";
        return sparse;
      },
      () => {
        const cyclic: Record<string, unknown> = {};
        cyclic["self"] = cyclic;
        return cyclic;
      },
      () => new Proxy({}, { get() { throw new Error("get boom"); }, ownKeys() { throw new Error("keys boom"); } }),
      () => {
        const withGetter = {};
        Object.defineProperty(withGetter, "any", { get() { throw new Error("boom"); }, enumerable: true });
        return withGetter;
      },
      () => "x".repeat(30_000),
      () => Object.create(null),
    ];

    const positions = ["schema_version", "kind", "id", "title", "provenance", "body"];

    for (const makeValue of hostileValues) {
      for (const position of positions) {
        const record = verifyRecord();
        record[position] = makeValue();

        // 1. Validation is total.
        let result!: ReturnType<typeof validateDocumentRecord>;
        expect(() => {
          result = validateDocumentRecord(record);
        }).not.toThrow();

        // 2. Every downstream step is total on the same input.
        expect(() => documentContentHash(record)).not.toThrow();
        expect(() => projectDocumentRecord(record)).not.toThrow();
        expect(() => renderDocumentHtml(record)).not.toThrow();
        expect(() => canonicalDocumentJson(record)).not.toThrow();
        expect(() => decideFromDocumentSources({ record })).not.toThrow();

        // 3. The core BF-02 invariant: valid implies every later step succeeds.
        if (result.valid) {
          expect(documentContentHash(record).ok).toBe(true);
          expect(projectDocumentRecord(record).ok).toBe(true);
          expect(renderDocumentHtml(record).ok).toBe(true);
        } else {
          expect(result.record).toBeNull();
          expect(result.errors.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("a validated record always hashes, projects and renders", () => {
    const bodies: Record<string, unknown> = {
      plan: { objectives: ["o"], steps: [{ id: "s1", title: "t", status: "done" }] },
      spec: { requirements: [{ id: "r1", statement: "s", priority: "must" }] },
      handoff: { task_id: "T1", status: "completed", artifacts: [], issues: [] },
      review: { verdict: "approved", findings: [] },
      verify: { outcome: "pass", checks: [{ id: "c1", name: "n", result: "pass" }] },
    };
    for (const kind of DOCUMENT_KINDS) {
      const record = { ...verifyRecord(), kind, id: `doc-${kind}-0001`, body: bodies[kind] };
      const validation = validateDocumentRecord(record);
      expect(validation.valid).toBe(true);
      expect(documentContentHash(validation.record!).ok).toBe(true);
      expect(projectDocumentRecord(validation.record!).ok).toBe(true);
      expect(renderDocumentHtml(validation.record!).ok).toBe(true);
    }
  });

  it("hashes lone surrogates stably (canonical JSON escapes them before hashing)", () => {
    const record = verifyRecord();
    record["title"] = "lone \ud800 high and \udc00 low";
    const first = documentContentHash(record);
    const second = documentContentHash(record);
    expect(first.ok).toBe(true);
    expect(first.hash).toBe(second.hash);
    expect(first.hash).toMatch(CONTENT_HASH_PATTERN);
    // The canonical form contains no raw lone surrogate, so the UTF-8 encoding
    // step cannot silently substitute U+FFFD and move the hash.
    const canonical = canonicalDocumentJson(validateDocumentRecord(record).record!);
    expect(canonical.json).toContain("\\ud800");
  });

  it("resolveDocumentAuthority is total over hostile sources", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("source get boom");
        },
        has() {
          throw new Error("source has boom");
        },
      }
    );
    expect(() => resolveDocumentAuthority(hostile)).not.toThrow();
    const resolved = resolveDocumentAuthority(hostile);
    expect(resolved.authority).toBe("none");
  });

  it("is deterministic — the same hostile input yields the same errors", () => {
    const build = (): Record<string, unknown> => {
      const record = verifyRecord();
      delete (record["provenance"] as Record<string, unknown>)["host_id"];
      (record["body"] as Record<string, unknown>)["outcome"] = "maybe";
      return record;
    };
    const first = validateDocumentRecord(build());
    const second = validateDocumentRecord(build());
    expect(first.errors).toEqual(second.errors);
    expect(first.errors.length).toBeGreaterThanOrEqual(1);

    // Multi-error inputs keep a stable order too.
    const multi = (): Record<string, unknown> => ({ ...verifyRecord(), zebra: 1, alpha: 2 });
    const a = validateDocumentRecord(multi());
    const b = validateDocumentRecord(multi());
    expect(a.errors.length).toBeGreaterThan(1);
    expect(a.errors).toEqual(b.errors);
    expect(a.errors.map((error) => error.path)).toEqual([...a.errors.map((e) => e.path)].sort());
  });

  it("rejects an array whose length getter throws", () => {
    const record = verifyRecord();
    // A real array behind a proxy: Array.isArray still reports true, but every
    // read — including `length` — is hostile.
    const lying = new Proxy([{ id: "c", name: "n", result: "pass" }], {
      get(target, key) {
        if (key === "length") throw new Error("length boom");
        return Reflect.get(target, key);
      },
    });
    (record["body"] as Record<string, unknown>)["checks"] = lying;
    expect(() => validateDocumentRecord(record)).not.toThrow();
    const result = validateDocumentRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("array_length_unreadable");
    expect(() => documentContentHash(record)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// BF-02 — nested identity is unambiguous
//
// A canonical record whose nested items share an id has no stable identity:
// two `dup` checks collapse into one evidence reference, and a projection
// signal can no longer be traced back to the item that produced it.
// ---------------------------------------------------------------------------

describe("BF-02 nested item identity", () => {
  /** One case per canonical item array, each carrying two items with one id. */
  const duplicateCases = [
    {
      kind: "plan",
      array: "steps",
      body: {
        objectives: ["converge the runtime"],
        steps: [
          { id: "dup", title: "first", status: "done" },
          { id: "dup", title: "second", status: "blocked" },
        ],
      },
    },
    {
      kind: "spec",
      array: "requirements",
      body: {
        requirements: [
          { id: "dup", statement: "first", priority: "must" },
          { id: "dup", statement: "second", priority: "may" },
        ],
      },
    },
    {
      kind: "review",
      array: "findings",
      body: {
        verdict: "approved",
        findings: [
          { id: "dup", severity: "note", statement: "first" },
          { id: "dup", severity: "blocking", statement: "second" },
        ],
      },
    },
    {
      kind: "verify",
      array: "checks",
      body: {
        outcome: "pass",
        checks: [
          { id: "dup", name: "first", result: "pass" },
          { id: "dup", name: "second", result: "fail" },
        ],
      },
    },
  ];

  const build = (kind: string, body: unknown): Record<string, unknown> => ({
    ...verifyRecord(),
    kind,
    id: `doc-${kind}-0001`,
    body,
  });

  const clone = (body: unknown): any => JSON.parse(JSON.stringify(body));

  it("refuses duplicate item ids in every canonical item array", () => {
    for (const { kind, array, body } of duplicateCases) {
      const result = validateDocumentRecord(build(kind, body));
      expect(result.valid).toBe(false);
      expect(result.record).toBeNull();
      expect(result.errors.map((error) => error.code)).toContain("duplicate_item_id");
      // The error names the *later* occurrence, so the first item stays the
      // one that owns the identity.
      expect(result.errors.some((error) => error.path === `$.body.${array}[1].id`)).toBe(true);
    }
  });

  it("accepts the same arrays once every id is distinct", () => {
    for (const { kind, array, body } of duplicateCases) {
      const fixed = clone(body);
      fixed[array][1].id = "dup-2";
      const result = validateDocumentRecord(build(kind, fixed));
      expect(result.valid).toBe(true);
      expect(result.record).not.toBeNull();
    }
  });

  it("treats ids differing only in case as distinct identities", () => {
    const result = validateDocumentRecord(
      build("verify", {
        outcome: "pass",
        checks: [
          { id: "C1", name: "upper", result: "pass" },
          { id: "c1", name: "lower", result: "pass" },
        ],
      })
    );
    expect(result.valid).toBe(true);
  });

  it("stays total and deterministic on a duplicate-carrying record", () => {
    const build3 = (): Record<string, unknown> =>
      build("verify", {
        outcome: "pass",
        checks: [
          { id: "dup", name: "a", result: "pass" },
          { id: "other", name: "b", result: "pass" },
          { id: "dup", name: "c", result: "fail" },
        ],
      });

    const first = validateDocumentRecord(build3());
    const second = validateDocumentRecord(build3());
    expect(first.valid).toBe(false);
    expect(first.errors).toEqual(second.errors);

    // Downstream steps stay total, and nothing may be decided from it.
    expect(() => documentContentHash(build3())).not.toThrow();
    expect(() => projectDocumentRecord(build3())).not.toThrow();
    expect(() => renderDocumentHtml(build3())).not.toThrow();
    const decision = decideFromDocumentSources({ record: build3() });
    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.content_hash).toBeNull();
  });

  it("refuses a duplicate id hidden behind hostile item values", () => {
    const hostile: Record<string, unknown>[] = [
      { id: "dup", name: "plain", result: "pass" },
      new Proxy(
        { id: "dup", name: "trapped", result: "pass" },
        {
          get(target, key) {
            if (key === "name") throw new Error("name boom");
            return Reflect.get(target, key);
          },
        }
      ) as Record<string, unknown>,
    ];
    const record = build("verify", { outcome: "pass", checks: hostile });
    let result!: ReturnType<typeof validateDocumentRecord>;
    expect(() => {
      result = validateDocumentRecord(record);
    }).not.toThrow();
    expect(result.valid).toBe(false);
    expect(result.record).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DC-01 / DC-02 — canonical records and closed, non-coercing validation
// ---------------------------------------------------------------------------

describe("DC-01 canonical records", () => {
  const samples: Record<string, Record<string, unknown>> = {
    plan: {
      objectives: ["converge the runtime"],
      steps: [{ id: "s1", title: "land contracts", status: "active" }],
    },
    spec: {
      requirements: [{ id: "r1", statement: "records must be typed", priority: "must" }],
    },
    handoff: { task_id: "MH-05", status: "completed", artifacts: ["a.ts"], issues: [] },
    review: { verdict: "approved", findings: [] },
    verify: { outcome: "pass", checks: [{ id: "c1", name: "suite", result: "pass" }] },
  };

  it("accepts exactly the five canonical kinds with stable ids and schema versions", () => {
    expect([...DOCUMENT_KINDS].sort()).toEqual(["handoff", "plan", "review", "spec", "verify"]);
    for (const kind of DOCUMENT_KINDS) {
      const record = { ...verifyRecord(), kind, id: `doc-${kind}-0001`, body: samples[kind] };
      const result = validateDocumentRecord(record);
      expect(result.valid).toBe(true);
      expect(result.record!.kind).toBe(kind);
      expect(result.record!.id).toBe(`doc-${kind}-0001`);
      expect(result.record!.schema_version).toBe("guild.document.v1");
    }
  });

  it("returns a frozen normalized record that does not alias the input", () => {
    const input = verifyRecord();
    const result = validateDocumentRecord(input);
    expect(Object.isFrozen(result.record)).toBe(true);
    expect(result.record).not.toBe(input);
    // Mutating the caller's object cannot move the validated record.
    (input["body"] as Record<string, unknown>)["outcome"] = "fail";
    expect(result.record!.kind === "verify" && result.record!.body.outcome).toBe("pass");
  });
});

describe("DC-02 closed validation", () => {
  it("rejects an out-of-vocabulary kind", () => {
    const record = { ...verifyRecord(), kind: "postmortem" };
    const result = validateDocumentRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("value_not_in_vocabulary");
  });

  it("rejects unknown keys instead of ignoring them", () => {
    const record = { ...verifyRecord(), smuggled: "payload" };
    const result = validateDocumentRecord(record);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("unexpected_key");
  });

  it("requires full provenance", () => {
    for (const field of ["author_id", "author_family", "host_id", "created_at", "source"]) {
      const record = verifyRecord();
      delete (record["provenance"] as Record<string, unknown>)[field];
      expect(validateDocumentRecord(record).valid).toBe(false);
    }
  });

  it("does not coerce: wrong types and impossible instants are errors", () => {
    const numericStatus = verifyRecord();
    (numericStatus["body"] as Record<string, unknown>)["outcome"] = 1;
    expect(validateDocumentRecord(numericStatus).valid).toBe(false);

    const notReal = verifyRecord();
    (notReal["provenance"] as Record<string, unknown>)["created_at"] = "2026-02-30T00:00:00.000Z";
    const result = validateDocumentRecord(notReal);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain("not_a_real_instant");

    const localTime = verifyRecord();
    (localTime["provenance"] as Record<string, unknown>)["created_at"] = "2026-07-27T00:00:00+01:00";
    expect(validateDocumentRecord(localTime).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DC-03 — record-only projections, evidence outranks claim
// ---------------------------------------------------------------------------

describe("DC-03 projections", () => {
  it("demotes a review verdict contradicted by its own blocking findings", () => {
    const record = {
      ...verifyRecord(),
      kind: "review",
      id: "doc-review-0001",
      body: {
        verdict: "approved",
        findings: [{ id: "BF-01", severity: "blocking", statement: "forged projection authority" }],
      },
    };
    const projected = projectDocumentRecord(record);
    expect(projected.ok).toBe(true);
    expect(projected.projection!.disposition).toBe("in_review");
    expect(projected.projection!.signals).toContain("verdict_demoted_by_blocking_findings");
    expect(projected.projection!.signals).toContain("BF-01");
  });

  it("demotes a verify outcome contradicted by a failing check", () => {
    const record = verifyRecord();
    (record["body"] as Record<string, unknown>)["checks"] = [
      { id: "c1", name: "suite", result: "fail" },
    ];
    const projected = projectDocumentRecord(record);
    expect(projected.projection!.disposition).toBe("failed");
    expect(projected.projection!.signals).toContain("outcome_demoted_by_failed_check");
  });

  it("demotes a completed handoff that still carries open issues", () => {
    const record = {
      ...verifyRecord(),
      kind: "handoff",
      id: "doc-handoff-0001",
      body: { task_id: "MH-05", status: "completed", artifacts: [], issues: ["unresolved"] },
    };
    expect(projectDocumentRecord(record).projection!.disposition).toBe("in_review");
  });

  it("is derived from the record, not from rendered prose", () => {
    const record = validateDocumentRecord(verifyRecord()).record!;
    const rendered = renderDocumentHtml(record);
    expect(rendered.ok).toBe(true);
    // Rewriting the visible prose must not move the projection or the hash.
    const tamperedProse = rendered.html!.replace("Wave 3 verification", "Everything Succeeded");
    expect(verifyRenderedDocumentBinding(tamperedProse, record)).toEqual([]);
    expect(projectDocumentRecord(record).projection!.disposition).toBe("succeeded");
  });
});

// ---------------------------------------------------------------------------
// DC-04 / DC-05 — deterministic, self-contained, inert HTML
// ---------------------------------------------------------------------------

describe("DC-04/DC-05 HTML rendering", () => {
  const hostile = (): Record<string, unknown> => {
    const record = verifyRecord();
    record["title"] = `<script>alert(1)</script> & "quotes" 'and' <img src=x onerror=boom>`;
    (record["body"] as Record<string, unknown>)["checks"] = [
      { id: "c1", name: `javascript:alert(1)`, result: "pass" },
    ];
    return record;
  };

  it("is byte-for-byte deterministic", () => {
    const first = renderDocumentHtml(verifyRecord());
    const second = renderDocumentHtml(verifyRecord());
    expect(first.ok && second.ok).toBe(true);
    expect(first.html).toBe(second.html);
  });

  it("is self-contained — no resource-loading attributes at all", () => {
    const rendered = renderDocumentHtml(verifyRecord());
    expect(rendered.html).not.toMatch(/\s(?:src|href|srcset|poster|action|background)\s*=/i);
    expect(rendered.html).not.toMatch(/@import|url\s*\(/i);
    expect(scanHtmlForActivePayloads(rendered.html!)).toEqual([]);
  });

  it("neutralizes hostile content instead of emitting it as markup", () => {
    const rendered = renderDocumentHtml(hostile());
    expect(rendered.ok).toBe(true);
    expect(rendered.html).not.toMatch(/<script/i);
    expect(rendered.html).not.toMatch(/<img/i);
    // The payload survives only as inert escaped text, never as live markup.
    expect(rendered.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered.html).toContain("&lt;img src=x onerror=boom&gt;");
    // And the structural scan proves no emitted tag carries an event handler.
    expect(scanHtmlForActivePayloads(rendered.html!)).toEqual([]);
  });

  it("preserves a machine-readable provenance binding", () => {
    const record = validateDocumentRecord(hostile()).record!;
    const rendered = renderDocumentHtml(record);
    const extracted = extractDocumentHtmlBinding(rendered.html);
    expect(extracted.ok).toBe(true);
    expect(extracted.binding!.content_hash).toBe(documentContentHash(record).hash);
    expect(verifyRenderedDocumentBinding(rendered.html, record)).toEqual([]);
  });

  it("detects a tampered content hash, including entity-ambiguity tampering", () => {
    const record = validateDocumentRecord(verifyRecord()).record!;
    const rendered = renderDocumentHtml(record);

    const swapped = rendered.html!.replace(
      /(<meta name="guild.content_hash" content=")[^"]*(">)/,
      `$1sha256:${"0".repeat(64)}$2`
    );
    expect(verifyRenderedDocumentBinding(swapped, record)).toEqual(["content_hash"]);

    const ambiguous = rendered.html!.replace(
      /(<meta name="guild.content_hash" content=")[^"]*(">)/,
      "$1sha256&#x3a;deadbeef$2"
    );
    expect(verifyRenderedDocumentBinding(ambiguous, record)).toEqual(["binding_unreadable"]);
  });

  it("flags a document whose markup was replaced with an active payload", () => {
    const rendered = renderDocumentHtml(verifyRecord());
    const injected = rendered.html!.replace("<footer>", "<footer><script>x()</script>");
    expect(scanHtmlForActivePayloads(injected)).toContain("disallowed element: <script>");
  });
});

// ---------------------------------------------------------------------------
// DC-06 — bounded, explicitly partial legacy import
// ---------------------------------------------------------------------------

describe("DC-06 legacy import", () => {
  const markdown = [
    "# Verification report",
    "",
    "Some prose.",
    "",
    "## Details",
    "<div>inline html</div>",
    "| a | b |",
    "```",
    "code",
    "```",
  ].join("\n");

  it("produces an explicitly non-canonical partial record plus warnings", () => {
    const result = importLegacyMarkdown(markdown);
    expect(result.status).toBe("imported");
    expect(result.record!.canonical).toBe(false);
    expect(result.record!.completeness).toBe("partial");
    const codes = result.warnings.map((warning) => warning.code);
    expect(codes).toContain("legacy_record_is_not_canonical");
    expect(codes).toContain("legacy_kind_inferred");
    expect(codes).toContain("legacy_inline_html_dropped");
    expect(codes).toContain("legacy_lines_unparsed");
  });

  it("cannot be validated as a canonical record or used as authority", () => {
    const legacy = importLegacyMarkdown(markdown).record!;
    expect(validateDocumentRecord(legacy).valid).toBe(false);

    const decision = decideFromDocumentSources({ legacy_record: legacy });
    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.refusals).toContain("legacy_record_is_not_canonical");
  });

  it("rejects oversized input rather than silently truncating", () => {
    const huge = "x".repeat(70_000);
    const result = importLegacyMarkdown(huge);
    expect(result.status).toBe("rejected");
    expect(result.record).toBeNull();
    expect(result.warnings.map((warning) => warning.code)).toContain("legacy_bounds_exceeded");
  });

  it("is total over non-string input", () => {
    expect(() => importLegacyMarkdown(null)).not.toThrow();
    expect(importLegacyMarkdown(null).status).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// DC-07 — machine decisions never read prose when structured data exists
// ---------------------------------------------------------------------------

describe("DC-07 machine decisions", () => {
  it("refuses HTML-only and Markdown-only sources", () => {
    const rendered = renderDocumentHtml(verifyRecord()).html!;
    const htmlOnly = decideFromDocumentSources({ html: rendered });
    expect(htmlOnly.authority).toBe("none");
    expect(htmlOnly.refusals).toContain("html_is_not_machine_authority");

    const markdownOnly = decideFromDocumentSources({ markdown: "# All good\nEverything passed." });
    expect(markdownOnly.authority).toBe("none");
    expect(markdownOnly.refusals).toContain("markdown_is_not_machine_authority");
  });

  it("refuses when no source is supplied at all", () => {
    expect(decideFromDocumentSources({}).refusals).toContain("no_document_source");
  });

  it("ignores contradictory prose when the canonical record is present", () => {
    const record = validateDocumentRecord(verifyRecord()).record!;
    const lyingHtml = "<html><body>THIS RUN FAILED CATASTROPHICALLY</body></html>";
    const decision = decideFromDocumentSources({ record, html: lyingHtml });
    expect(decision.authority).toBe("canonical_record");
    expect(decision.disposition).toBe("succeeded");
  });

  it("holds rather than advances on a trusted negative result", () => {
    const record = verifyRecord();
    (record["body"] as Record<string, unknown>)["outcome"] = "fail";
    const decision = decideFromDocumentSources({ record });
    expect(decision.authority).toBe("canonical_record");
    expect(decision.gate_signal).toBe("hold");
    expect(decision.disposition).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// DC-08 — service boundaries
// ---------------------------------------------------------------------------

describe("DC-08 service boundaries", () => {
  it("the shipped documents module uses only its declared boundary dependencies", () => {
    const files = DOCUMENTS_MODULE_SOURCE_FILES.map((relative) => ({
      path: relative,
      text: fs.readFileSync(path.join(REPO_ROOT, relative), "utf8"),
    }));
    expect(files).toHaveLength(DOCUMENTS_MODULE_SOURCE_FILES.length);
    const report = evaluateDocumentServiceBoundary(files);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("requires external parsers to stay behind a public module seam", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text:
          'import * as yaml from "js-yaml";\n' +
          'import { load } from "js-yaml/lib/loader";\n',
      },
    ]);
    expect(report.violations).toEqual([
      {
        path: "src/modules/documents/workflows/x.ts",
        line: 1,
        specifier: "js-yaml",
        reason: "external_package_import",
      },
      {
        path: "src/modules/documents/workflows/x.ts",
        line: 2,
        specifier: "js-yaml/lib/loader",
        reason: "external_package_import",
      },
    ]);
  });

  it("detects a host-internal import", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'import { hostRegistry } from "../../host-runtime/workflows/lib/host-registry";\n',
      },
    ]);
    expect(report.ok).toBe(false);
    expect(report.violations[0]!.reason).toBe("host_internal_import");
  });

  it("detects a private import of an otherwise allowed module", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'import { sweepLaneLiveness } from "../../lifecycle/workflows/check-lane-liveness";\n',
      },
    ]);
    expect(report.violations[0]!.reason).toBe("private_module_import");
  });

  it("allows a public entrypoint import of an allowed module", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'import { emit } from "../../telemetry";\nimport * as fs from "node:fs";\n',
      },
    ]);
    expect(report.ok).toBe(true);
  });

  it("flags a constructed specifier instead of silently missing it (F-01)", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'const specifier = "../../host-runtime";\nvoid import(specifier);\n',
      },
    ]);
    expect(report.ok).toBe(false);
    expect(report.violations.map((violation) => violation.reason)).toContain("indirect_specifier");
  });

  it("does not raise phantom violations from commented-out code", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: '// import { x } from "../../host-runtime/workflows/y";\n/* require(dynamic) */\n',
      },
    ]);
    expect(report.ok).toBe(true);
  });

  // — F-01: an import edge the evaluator cannot see is a hole in the proof, so
  //   re-export and aliased-require forms must be visible too.

  it("detects a host-internal edge introduced by export-from (F-01)", () => {
    for (const text of [
      'export { hostRegistry } from "../../host-runtime/workflows/lib/host-registry";\n',
      'export * from "../../host-runtime/workflows/lib/host-registry";\n',
      'export * as host from "../../host-runtime/workflows/lib/host-registry";\n',
      'export type { HostId } from "../../host-runtime/workflows/lib/host-registry";\n',
      'export {\n  hostRegistry,\n} from "../../host-runtime/workflows/lib/host-registry";\n',
    ]) {
      const report = evaluateDocumentServiceBoundary([
        { path: "src/modules/documents/workflows/x.ts", text },
      ]);
      expect(report.ok).toBe(false);
      expect(report.violations[0]!.reason).toBe("host_internal_import");
      expect(report.violations[0]!.specifier).toBe(
        "../../host-runtime/workflows/lib/host-registry"
      );
    }
  });

  it("classifies a re-export exactly as it classifies the matching import", () => {
    const cases: Array<[string, string]> = [
      ["../../lifecycle/workflows/check-lane-liveness", "private_module_import"],
      ["../../review", "undeclared_module_import"],
      ["yaml", "external_package_import"],
    ];
    for (const [specifier, reason] of cases) {
      const report = evaluateDocumentServiceBoundary([
        {
          path: "src/modules/documents/workflows/x.ts",
          text: `export { thing } from "${specifier}";\n`,
        },
      ]);
      expect(report.violations.map((violation) => violation.reason)).toEqual([reason]);
    }
  });

  it("sees a specifier through a string-named binding clause", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'import { "host registry" as registry } from "../../host-runtime/workflows/x";\n',
      },
    ]);
    expect(report.violations.map((violation) => violation.reason)).toEqual([
      "host_internal_import",
    ]);
  });

  it("does not read a specifier out of an ordinary string that ends in from", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text:
          'export const NOTE = "this record was derived from ";\n' +
          'export const OTHER = \'and also from \';\n',
      },
    ]);
    expect(report.violations).toEqual([]);
  });

  it("attributes a specifier to real code, never to prose that mentions import", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text:
          'const sentence = "import x from ";\n' +
          'import { bad } from "../../host-runtime/a";\n',
      },
    ]);
    // The sentence must not swallow the statement underneath it: the real
    // import is still found, with its own specifier and reason.
    expect(report.violations).toEqual([
      {
        path: "src/modules/documents/workflows/x.ts",
        line: 2,
        specifier: "../../host-runtime/a",
        reason: "host_internal_import",
      },
    ]);
  });

  it("allows the shipped index shape: re-exporting the module's own workflows", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/index.ts",
        text: 'export * from "./workflows/document-records";\nexport * from "./workflows/document-safe";\n',
      },
    ]);
    expect(report.ok).toBe(true);
  });

  it("detects an aliased require and resolves the call made through it (F-01)", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text: 'const load = require;\nload("../../host-runtime/workflows/secret");\n',
      },
    ]);
    expect(report.ok).toBe(false);
    const reasons = report.violations.map((violation) => violation.reason);
    // The aliasing itself is unprovable, and the call through the alias names
    // the specifier it actually reaches.
    expect(reasons).toContain("indirect_specifier");
    expect(reasons).toContain("host_internal_import");
    expect(
      report.violations.some(
        (violation) => violation.specifier === "../../host-runtime/workflows/secret"
      )
    ).toBe(true);
  });

  it("detects a require handed to another value position", () => {
    for (const text of [
      "const loader = { load: require };\n",
      "register(require);\n",
      "export const boot = require;\n",
    ]) {
      const report = evaluateDocumentServiceBoundary([
        { path: "src/modules/documents/workflows/x.ts", text },
      ]);
      expect(report.violations.map((violation) => violation.reason)).toContain(
        "indirect_specifier"
      );
    }
  });

  it("detects a require built at runtime through createRequire", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text:
          'import { createRequire } from "node:module";\n' +
          'const load = createRequire(import.meta.url);\n' +
          'load("../../host-runtime/workflows/secret");\n',
      },
    ]);
    expect(report.ok).toBe(false);
    expect(report.violations.map((violation) => violation.reason)).toContain(
      "indirect_specifier"
    );
  });

  it("does not flag require property reads or the word require in a string", () => {
    const report = evaluateDocumentServiceBoundary([
      {
        path: "src/modules/documents/workflows/x.ts",
        text:
          "if (require.main === module) main();\n" +
          'const help = "callers must require nothing at runtime";\n' +
          'const also = `templates may say require too`;\n',
      },
    ]);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DC-09 — evolution, hashing, round trips
// ---------------------------------------------------------------------------

describe("DC-09 evolution", () => {
  it("reports a current record as current", () => {
    const result = migrateDocumentRecord(verifyRecord());
    expect(result.status).toBe("current");
    expect(result.record).not.toBeNull();
  });

  it("migrates a known older version deterministically", () => {
    const v0 = {
      schema_version: "guild.document.v0",
      type: "verify",
      id: "doc-verify-0001",
      title: "Wave 3 verification",
      meta: {
        author: "artifact-services",
        family: "claude",
        host: "claude-code-cli",
        timestamp: "2026-07-27T00:00:00.000Z",
      },
      body: { outcome: "pass", checks: [{ id: "chk-1", name: "documents suite", result: "pass" }] },
    };
    const first = migrateDocumentRecord(v0);
    const second = migrateDocumentRecord(v0);
    expect(first.status).toBe("migrated");
    expect(first.from_version).toBe("guild.document.v0");
    expect(first.record!.provenance.source).toBe("migrated");
    expect(documentContentHash(first.record!).hash).toBe(documentContentHash(second.record!).hash);
  });

  it("returns an explicit unsupported result for an unknown version", () => {
    const result = migrateDocumentRecord({ ...verifyRecord(), schema_version: "guild.document.v99" });
    expect(result.status).toBe("unsupported");
    expect(result.record).toBeNull();
    expect(result.errors.map((error) => error.code)).toContain("unsupported_schema_version");
  });

  it("hashes canonical JSON exactly as node:crypto does", () => {
    const record = validateDocumentRecord(verifyRecord()).record!;
    const canonical = canonicalDocumentJson(record);
    expect(canonical.ok).toBe(true);
    const expected = createHash("sha256").update(canonical.json!, "utf8").digest("hex");
    expect(documentContentHash(record).hash).toBe(`sha256:${expected}`);
  });

  it("orders canonical JSON keys stably regardless of insertion order", () => {
    const forward = canonicalDocumentJson({ a: 1, b: { c: 2, d: 3 } });
    const reverse = canonicalDocumentJson({ b: { d: 3, c: 2 }, a: 1 });
    expect(forward.json).toBe(reverse.json);
  });

  it("provides stable round-trip evidence", () => {
    for (const record of [verifyRecord(), { ...verifyRecord(), title: "unicode 🌍 <&> test" }]) {
      const evidence = documentRoundTripEvidence(record);
      expect(evidence.checks.filter((check) => !check.ok)).toEqual([]);
      expect(evidence.stable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Receipt bridge — the typed path shipped lifecycle consumers use
// ---------------------------------------------------------------------------

describe("receipt bridge", () => {
  const receipt = (overrides: { status?: string; block?: string } = {}): string =>
    [
      "---",
      "schema_version: guild.handoff_receipt.v1",
      "agent: artifact-services",
      "model_family: claude",
      "host: claude-code-cli",
      "generated_at: 2026-07-27T00:00:00.000Z",
      "task: MH-05 document contracts",
      "---",
      "",
      "## What changed",
      "",
      "Narrative prose that no machine decision may read.",
      "",
      "```json",
      overrides.block ??
        JSON.stringify(
          {
            schema_version: "guild.handoff.v2",
            task_id: "MH-05",
            tier: "mid",
            status: overrides.status ?? "done",
            summary: "typed document contracts",
            artifacts: ["src/modules/documents/index.ts"],
            issues: [],
            learnings: [],
          },
          null,
          2
        ),
      "```",
      "",
    ].join("\n");

  const frozenReceipt = (): string =>
    [
      "---",
      "schema_version: guild.handoff_receipt.v1",
      "ids:",
      "  initiative_id: null",
      "  run_id: run-20260727-000000-document-contracts",
      "  task_id: MH-05",
      "  task_run_id: trun-mh-05-001",
      "specialist: artifact-services",
      "host:",
      "  selected: claude-code",
      "  degraded: false",
      "  native_ref: null",
      "  independence: strong",
      "scope:",
      "  objective: Prove the frozen receipt contract",
      "  in_scope:",
      "    - src/modules/documents",
      "  out_of_scope_touched: []",
      "status: completed",
      "changed_files: []",
      "evidence: []",
      "assumptions: []",
      "open_risks: []",
      "followups: []",
      "produced_at: 2026-07-27T00:00:00.000Z",
      "---",
      "",
      "## changed_files",
      "- none",
      "",
      "## opens_for",
      "- lead",
      "",
      "## assumptions",
      "- none",
      "",
      "## evidence",
      "- document-contract fixture",
      "",
      "## followups",
      "- none",
      "",
      "```guild.handoff.v2",
      JSON.stringify({
        schema_version: "guild.handoff.v2",
        task_id: "MH-05",
        tier: "mid",
        status: "done",
        summary: "typed document contracts",
        artifacts: [],
        issues: [],
        learnings: [],
      }),
      "```",
      "",
    ].join("\n");

  it("parses a real-shape receipt into a canonical handoff record", () => {
    const parsed = parseReceiptDocument(receipt());
    expect(parsed.status).toBe("parsed");
    expect(parsed.record!.kind).toBe("handoff");
    expect(parsed.record!.body.task_id).toBe("MH-05");
    expect(parsed.record!.body.status).toBe("completed");
    expect(parsed.record!.provenance.source).toBe("imported");
  });

  it("parses the frozen structured-host receipt without legacy scalar provenance", () => {
    const parsed = parseReceiptDocument(frozenReceipt());
    expect(parsed.status).toBe("parsed");
    expect(parsed.errors).toEqual([]);
    expect(parsed.record!.provenance).toMatchObject({
      author_id: "artifact-services",
      host_id: "claude-code",
      created_at: "2026-07-27T00:00:00.000Z",
    });
  });

  it("recognizes only the complete canonical receipt wrapper", () => {
    expect(hasCanonicalReceiptWrapper(frozenReceipt())).toBe(true);
    expect(hasCanonicalReceiptWrapper(
      frozenReceipt().replace("## followups\n- none\n", "")
    )).toBe(false);
  });

  it("keeps the legacy scalar-host envelope as an explicit transition shape", () => {
    const parsed = parseReceiptDocument(receipt({
      block: JSON.stringify({
        schema_version: "guild.handoff.v2",
        task_id: "MH-05",
        tier: "standard",
        status: "complete",
        summary: "legacy receipt",
        artifacts: [],
        issues: [],
      }),
    }));
    expect(parsed.status).toBe("parsed");
    expect(parsed.record!.provenance.host_id).toBe("claude-code-cli");
    expect(parsed.record!.body.status).toBe("completed");
  });

  it("refuses a structured host mapping missing a frozen required field", () => {
    const malformed = frozenReceipt().replace("  independence: strong\n", "");
    const parsed = parseReceiptDocument(malformed);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.errors.map((error) => error.path)).toContain(
      "$.frontmatter.host.independence"
    );
  });

  it("refuses a frozen receipt missing the required nullable initiative id", () => {
    const malformed = frozenReceipt().replace("  initiative_id: null\n", "");
    const parsed = parseReceiptDocument(malformed);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.errors.map((error) => error.path)).toContain(
      "$.frontmatter.ids.initiative_id"
    );
  });

  it("refuses a syntactically valid timestamp that names no real calendar instant", () => {
    const malformed = frozenReceipt().replace(
      "produced_at: 2026-07-27T00:00:00.000Z",
      "produced_at: 2026-02-30T12:00:00.000Z"
    );
    const parsed = parseReceiptDocument(malformed);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "$.frontmatter.produced_at",
        code: "invalid_timestamp",
      }),
    ]));
  });

  it("accepts the contract-named guild.handoff.v2 fence used by lane receipts", () => {
    const namedFence = receipt().replace("```json", "```guild.handoff.v2");
    expect(parseReceiptDocument(namedFence).status).toBe("parsed");
    expect(decideFromReceiptDocument(namedFence).gate_signal).toBe("advance");
  });

  it("yields an advance decision for a completed receipt", () => {
    const decision = decideFromReceiptDocument(receipt());
    expect(decision.authority).toBe("canonical_record");
    expect(decision.gate_signal).toBe("advance");
    expect(decision.disposition).toBe("succeeded");
  });

  it("holds — never advances — for a blocked receipt", () => {
    const decision = decideFromReceiptDocument(receipt({ status: "blocked" }));
    expect(decision.gate_signal).toBe("hold");
    expect(decision.disposition).toBe("blocked");
  });

  it("refuses a receipt with no structured block", () => {
    const prose = ["---", "agent: x", "---", "", "## Done", "", "All good!", ""].join("\n");
    const decision = decideFromReceiptDocument(prose);
    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.refusals).toContain("receipt_not_structured");
  });

  it("refuses a receipt missing required provenance", () => {
    const noProvenance = receipt().replace("host: claude-code-cli\n", "");
    expect(decideFromReceiptDocument(noProvenance).gate_signal).toBe("refuse");
  });

  // — BF-03: the envelope declares which contract the document is written to.
  //   Reading provenance out of an envelope that declares a different schema
  //   would let an untrusted document borrow this contract's authority.

  it("refuses a receipt whose frontmatter declares a different envelope schema", () => {
    const wrongEnvelope = receipt().replace(
      "schema_version: guild.handoff_receipt.v1",
      "schema_version: guild.other.v9"
    );
    const parsed = parseReceiptDocument(wrongEnvelope);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.record).toBeNull();
    expect(parsed.errors.map((error) => error.code)).toContain("wrong_frontmatter_schema");

    const decision = decideFromReceiptDocument(wrongEnvelope);
    expect(decision.authority).toBe("none");
    expect(decision.gate_signal).toBe("refuse");
    expect(decision.disposition).toBe("unknown");
    expect(decision.content_hash).toBeNull();
    expect(decision.refusals).toContain("receipt_envelope_schema_unsupported");
  });

  it("refuses a receipt with no frontmatter schema_version at all", () => {
    const noEnvelope = receipt().replace("schema_version: guild.handoff_receipt.v1\n", "");
    const parsed = parseReceiptDocument(noEnvelope);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.errors.map((error) => error.code)).toContain("missing_frontmatter_schema");
    expect(decideFromReceiptDocument(noEnvelope).gate_signal).toBe("refuse");
  });

  it("does not accept a machine-block schema_version as the envelope schema", () => {
    // The two schema declarations are separate contracts: a correct machine
    // block cannot vouch for the envelope that carries the provenance.
    const swapped = receipt().replace(
      "schema_version: guild.handoff_receipt.v1",
      "schema_version: guild.handoff.v2"
    );
    expect(decideFromReceiptDocument(swapped).gate_signal).toBe("refuse");
  });

  it("refuses an envelope that declares the same key twice", () => {
    // Two readers of the same file must not be able to disagree: YAML
    // implementations split on first-wins vs last-wins.
    const doubled = receipt().replace(
      "schema_version: guild.handoff_receipt.v1",
      "schema_version: guild.handoff_receipt.v1\nschema_version: guild.other.v9"
    );
    const parsed = parseReceiptDocument(doubled);
    expect(parsed.status).toBe("unparsable");
    expect(parsed.errors.map((error) => error.code)).toContain("frontmatter_unreadable");
    expect(decideFromReceiptDocument(doubled).gate_signal).toBe("refuse");
  });

  it("does not let a frontmatter key reach the prototype chain", () => {
    const polluted = receipt().replace(
      "task: MH-05 document contracts",
      "__proto__: { agent: attacker }\ntask: MH-05 document contracts"
    );
    const parsed = parseReceiptDocument(polluted);
    // The odd key is inert data, so the receipt still parses on its own merits
    // and its provenance is unchanged.
    expect(parsed.status).toBe("parsed");
    expect(parsed.record!.provenance.author_id).toBe("artifact-services");
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
  });

  it("still trusts a well-formed envelope, quoted or not", () => {
    for (const declared of [
      "schema_version: guild.handoff_receipt.v1",
      'schema_version: "guild.handoff_receipt.v1"',
      "schema_version:   guild.handoff_receipt.v1  ",
    ]) {
      const variant = receipt().replace("schema_version: guild.handoff_receipt.v1", declared);
      expect(decideFromReceiptDocument(variant).gate_signal).toBe("advance");
    }
  });

  it("finds the machine block behind an earlier non-JSON fenced block", () => {
    // A real receipt carries other fenced blocks (a ```text hash table, for
    // instance). Naive fence matching pairs the wrong delimiters and hides the
    // machine block entirely, which would fail the receipt closed for no
    // reason — and, worse, make a genuine receipt indistinguishable from a
    // forged one.
    const withPreamble = receipt().replace(
      "## What changed",
      ["## Changed paths", "", "```text", "abc123  src/modules/documents/index.ts", "```", "", "## What changed"].join(
        "\n"
      )
    );
    const parsed = parseReceiptDocument(withPreamble);
    expect(parsed.status).toBe("parsed");
    expect(decideFromReceiptDocument(withPreamble).gate_signal).toBe("advance");
  });

  it("ignores a non-JSON fenced block that merely looks like a machine block", () => {
    const decoy = receipt().replace(
      "## What changed",
      ["```text", JSON.stringify({ schema_version: "guild.handoff.v2", task_id: "X" }), "```", "", "## What changed"].join(
        "\n"
      )
    );
    // The decoy is not JSON-tagged, so it is skipped rather than treated as a
    // second conflicting block.
    expect(parseReceiptDocument(decoy).status).toBe("parsed");
  });

  it("refuses a receipt carrying two conflicting structured blocks", () => {
    const doubled = receipt().replace(
      "```\n",
      "```\n\n```json\n" +
        JSON.stringify({ schema_version: "guild.handoff.v2", task_id: "MH-05", status: "complete" }) +
        "\n```\n"
    );
    expect(decideFromReceiptDocument(doubled).gate_signal).toBe("refuse");
  });

  it("refuses an out-of-vocabulary status rather than guessing", () => {
    expect(decideFromReceiptDocument(receipt({ status: "mostly-fine" })).gate_signal).toBe("refuse");
  });

  it("refuses a machine block that violates the strict guild.handoff.v2 shape", () => {
    const invalid = frozenReceipt().replace(
      '"tier":"mid"',
      '"tier":"standard","unreviewed":true',
    );
    expect(parseReceiptDocument(invalid).status).toBe("unparsable");
  });

  it("is total over hostile receipt input", () => {
    for (const input of [null, 42, {}, "```json\n{\n```", "---\nx\n"]) {
      expect(() => decideFromReceiptDocument(input)).not.toThrow();
      expect(decideFromReceiptDocument(input).gate_signal).toBe("refuse");
    }
  });
});
