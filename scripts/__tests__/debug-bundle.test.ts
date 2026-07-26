/**
 * scripts/__tests__/debug-bundle.test.ts
 *
 * MH-06 — structured debugging boundary
 * (src/modules/telemetry/workflows/debug-bundle.ts).
 *
 * Pins MH-06 acceptance statement 4:
 *   "Debug bundles link capability snapshot, normalized events, policy
 *    decisions, transport attempts, artifacts, and conformance without
 *    parsing prose."
 *
 * and boundary rule BR-10 ("HTML, Markdown, hook stdout, wrapper stdout, and
 * generated support prose MUST NOT be machine protocols; typed records and
 * strict JSON envelopes are machine truth") plus BR-07 (an absent observation
 * is never success).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  appendReceipt,
  makeReceiptInput,
  type ReceiptAppendInput,
} from "../../src/modules/telemetry/workflows/receipt-journal";
import {
  buildDebugBundle,
  DEBUG_BUNDLE_SECTION_KINDS,
  type DebugLinkInput,
  type EvidenceResolver,
} from "../../src/modules/telemetry/workflows/debug-bundle";

const VERSIONS = {
  host_id: "codex-local",
  host_version: "0.47.0",
  runtime_version: "2.3.2",
  source_version: "a53bc4c478a0be9e9eed2e14b0cf8f10ec725d85",
  contract_version: "guild.runtime_boundary_contract.v1",
};

const BINDING = {
  run_id: "run-mh-06",
  operation_id: "op-1",
  correlation_id: "corr-1",
  sequence: 1,
  scenario_id: "MHRC-RCT-001",
};

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-debug-bundle-"));
  tmpDirs.push(d);
  return d;
}

function seedJournal(root: string) {
  const p = {
    journal: path.join(root, "receipts", "journal.jsonl"),
    checkpoint: path.join(root, "receipts", "checkpoint.json"),
  };
  const base: ReceiptAppendInput = makeReceiptInput({
    run_id: "run-mh-06",
    operation_id: "op-1",
    correlation_id: "corr-1",
    event_id: "evt-1",
    causation_id: null,
    scenario_id: "MHRC-RCT-001",
    event_name: "receipt.append",
    outcome_type: "guild.receipt_outcome.v1",
    disposition: "succeeded",
    observation_state: "checked_clean",
    input_hash: "sha256:aaa",
    output_hash: "sha256:bbb",
    terminal: false,
    recorded_at: "2026-07-26T02:00:00.000Z",
    observed_at: "2026-07-26T02:00:00.000Z",
    versions: VERSIONS,
  });
  appendReceipt(p, base);
  return p;
}

// ── Machine evidence — real bytes, real content hashes ──────────────────────
//
// Refs are LOGICAL identifiers, so two bundles built in different temp roots
// stay byte-identical; the injected resolver owns ref → bytes. One test below
// exercises the filesystem default resolver end to end so the seam is not
// vacuous.

function sha256(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

/** Deterministic machine object for a section kind. */
function evidenceFor(kind: string): Buffer {
  return Buffer.from(
    JSON.stringify({ schema_version: `guild.${kind}.v1`, kind, run_id: "run-mh-06" }),
    "utf8",
  );
}

function refFor(kind: string): string {
  return `guild://evidence/${kind}.json`;
}

function mapResolver(entries: Record<string, { bytes: Buffer; media_type?: string | null }>): EvidenceResolver {
  return {
    resolve(ref) {
      const hit = entries[ref];
      return hit ? { bytes: hit.bytes, media_type: hit.media_type ?? null } : null;
    },
  };
}

const EVIDENCE_STORE: Record<string, { bytes: Buffer; media_type?: string | null }> = Object.fromEntries(
  DEBUG_BUNDLE_SECTION_KINDS.map((kind) => [refFor(kind), { bytes: evidenceFor(kind) }]),
);
const RESOLVER = mapResolver(EVIDENCE_STORE);

/** One well-formed, content-verified machine link per required section kind. */
function fullLinkSet(): DebugLinkInput[] {
  return DEBUG_BUNDLE_SECTION_KINDS.map((kind) => ({
    kind,
    ref: refFor(kind),
    media_type: "application/json",
    hash: sha256(evidenceFor(kind)),
    bound_by: BINDING,
  }));
}

function build(root: string, links: DebugLinkInput[], over: Record<string, unknown> = {}) {
  const p = seedJournal(root);
  return buildDebugBundle({
    run_id: "run-mh-06",
    generated_at: "2026-07-26T04:00:00.000Z",
    versions: VERSIONS,
    journalPath: p.journal,
    checkpointPath: p.checkpoint,
    links,
    evidence: RESOLVER,
    ...over,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("MH-06 acceptance 4 — debug bundle links every evidence kind", () => {
  it("exposes exactly the six contract section kinds", () => {
    expect(DEBUG_BUNDLE_SECTION_KINDS).toEqual([
      "capability_snapshot",
      "normalized_event",
      "policy_decision",
      "transport_attempt",
      "artifact",
      "conformance",
    ]);
  });

  it("builds a complete bundle when every section has a bound machine link", () => {
    const bundle = build(mkRoot(), fullLinkSet());

    expect(bundle.schema_version).toBe("guild.debug_bundle.v1");
    expect(bundle.complete).toBe(true);
    expect(bundle.unlinked_kinds).toEqual([]);
    expect(bundle.rejected_links).toEqual([]);
    for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
      expect(bundle.sections[kind].links).toHaveLength(1);
      expect(bundle.sections[kind].observation_state).toBe("checked_clean");
    }
  });

  it("binds the bundle to the receipt journal so links traverse without prose", () => {
    const bundle = build(mkRoot(), fullLinkSet());

    expect(bundle.receipt_journal.integrity).toBe("intact");
    expect(bundle.receipt_journal.last_sequence).toBe(1);
    expect(bundle.receipt_journal.record_count).toBe(1);
    expect(bundle.receipt_journal.observation_state).toBe("checked_clean");
    // Every link resolves to the journal by operation + correlation + sequence.
    for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
      expect(bundle.sections[kind].links[0].bound_by).toEqual(BINDING);
      expect(bundle.sections[kind].links[0].resolves_to_receipt).toBe("evt-1");
    }
    expect(bundle.versions).toEqual(VERSIONS);
  });

  it("BR-10: rejects prose links and never lets them satisfy a section", () => {
    const links = fullLinkSet().filter((l) => l.kind !== "conformance");
    links.push({
      kind: "conformance",
      ref: "/docs/v2/generated-support-matrix.html",
      media_type: "text/html",
      hash: "sha256:ffff",
      bound_by: BINDING,
    });

    const bundle = build(mkRoot(), links);

    expect(bundle.rejected_links).toEqual([
      {
        kind: "conformance",
        ref: "/docs/v2/generated-support-matrix.html",
        reason: "prose_media_type",
      },
    ]);
    expect(bundle.sections.conformance.links).toEqual([]);
    expect(bundle.sections.conformance.observation_state).toBe("not_observed");
    expect(bundle.complete).toBe(false);
    expect(bundle.unlinked_kinds).toEqual(["conformance"]);
  });

  it.each([
    ["text/html", "/x.html"],
    ["text/markdown", "/x.md"],
    ["text/plain", "/x.txt"],
    ["application/xhtml+xml", "/x.xhtml"],
  ])("BR-10: %s is rejected as a machine protocol", (media_type, ref) => {
    const links = fullLinkSet().filter((l) => l.kind !== "artifact");
    links.push({ kind: "artifact", ref, media_type, hash: "sha256:ffff", bound_by: BINDING });

    const bundle = build(mkRoot(), links);
    expect(bundle.rejected_links[0].reason).toBe("prose_media_type");
    expect(bundle.sections.artifact.links).toEqual([]);
  });

  it("BR-10: rejects a prose file extension even when the media type claims JSON", () => {
    const links = fullLinkSet().filter((l) => l.kind !== "artifact");
    links.push({
      kind: "artifact",
      ref: "/report.md",
      media_type: "application/json",
      hash: "sha256:ffff",
      bound_by: BINDING,
    });

    const bundle = build(mkRoot(), links);
    expect(bundle.rejected_links).toEqual([
      { kind: "artifact", ref: "/report.md", reason: "prose_media_type" },
    ]);
  });

  it("BR-07: a missing section is not_observed and the bundle is incomplete", () => {
    const links = fullLinkSet().filter((l) => l.kind !== "transport_attempt");
    const bundle = build(mkRoot(), links);

    expect(bundle.sections.transport_attempt.links).toEqual([]);
    expect(bundle.sections.transport_attempt.observation_state).toBe("not_observed");
    expect(bundle.sections.transport_attempt.observation_state).not.toBe("checked_clean");
    expect(bundle.complete).toBe(false);
    expect(bundle.unlinked_kinds).toEqual(["transport_attempt"]);
  });

  it("honours an explicit not_applicable declaration without claiming cleanliness", () => {
    const links = fullLinkSet().filter((l) => l.kind !== "transport_attempt");
    const bundle = build(mkRoot(), links, {
      not_applicable: [{ kind: "transport_attempt", rule: "host has no execution transport" }],
    });

    expect(bundle.sections.transport_attempt.observation_state).toBe("not_applicable");
    expect(bundle.sections.transport_attempt.not_applicable_rule).toBe(
      "host has no execution transport",
    );
    expect(bundle.unlinked_kinds).toEqual([]);
    expect(bundle.complete).toBe(true);
  });

  it("rejects a link that is not bound to the run's receipt lineage", () => {
    const links = fullLinkSet().filter((l) => l.kind !== "policy_decision");
    links.push({
      kind: "policy_decision",
      ref: refFor("policy_decision"),
      media_type: "application/json",
      hash: sha256(evidenceFor("policy_decision")),
      bound_by: { ...BINDING, operation_id: "op-does-not-exist" },
    });

    const bundle = build(mkRoot(), links);
    expect(bundle.rejected_links).toEqual([
      { kind: "policy_decision", ref: refFor("policy_decision"), reason: "unbound_operation" },
    ]);
    expect(bundle.sections.policy_decision.observation_state).toBe("not_observed");
    expect(bundle.complete).toBe(false);
  });

  it("rejects a link whose kind is outside the closed section vocabulary", () => {
    const links = [
      ...fullLinkSet(),
      {
        kind: "vibes" as never,
        ref: "/evidence/vibes.json",
        media_type: "application/json",
        hash: "sha256:ffff",
        bound_by: BINDING,
      },
    ];

    const bundle = build(mkRoot(), links);
    expect(bundle.rejected_links).toEqual([
      { kind: "vibes", ref: "/evidence/vibes.json", reason: "unknown_kind" },
    ]);
    expect(bundle.complete).toBe(true); // the six real sections are still satisfied
  });

  it("BR-07: an absent receipt journal makes the bundle incomplete, never clean", () => {
    const root = mkRoot();
    const bundle = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: path.join(root, "receipts", "journal.jsonl"),
      checkpointPath: path.join(root, "receipts", "checkpoint.json"),
      links: fullLinkSet(),
    });

    expect(bundle.receipt_journal.integrity).toBe("absent");
    expect(bundle.receipt_journal.observation_state).toBe("not_observed");
    expect(bundle.complete).toBe(false);
    // With no journal, nothing can be bound — every link fails the binding check.
    expect(bundle.rejected_links.map((r) => r.reason)).toEqual(
      Array(6).fill("unbound_operation"),
    );
  });

  // ── MH-06-R1-B3 ───────────────────────────────────────────────────────────
  it("MH-06-R1-B3: a bundle over a failed observation with fabricated evidence is never complete", () => {
    const root = mkRoot();
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "receipts", "checkpoint.json"),
    };
    // One durable receipt whose OBSERVATION failed — the journal itself blocks
    // a clean close, so no bundle over it can be complete and clean (BR-07).
    appendReceipt(
      p,
      makeReceiptInput({
        run_id: "run-mh-06",
        operation_id: "op-1",
        correlation_id: "corr-1",
        event_id: "evt-1",
        causation_id: null,
        scenario_id: "MHRC-RCT-003",
        event_name: "receipt.append",
        outcome_type: "guild.receipt_outcome.v1",
        disposition: "failed",
        observation_state: "observation_failed",
        input_hash: "sha256:aaa",
        output_hash: null,
        terminal: false,
        recorded_at: "2026-07-26T02:00:00.000Z",
        observed_at: null,
        versions: VERSIONS,
        affected_event_range: { from: 1, to: 1 },
      }),
    );

    // Six links with arbitrary non-SHA "hashes", refs that resolve to nothing,
    // and a fabricated scenario binding.
    const links: DebugLinkInput[] = DEBUG_BUNDLE_SECTION_KINDS.map((kind) => ({
      kind,
      ref: `/does/not/exist/${kind}.json`,
      media_type: "application/json",
      hash: "not-a-sha-at-all",
      bound_by: { ...BINDING, scenario_id: "TOTALLY-FABRICATED" },
    }));

    const bundle = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      links,
    });

    expect(bundle.receipt_journal.blocks_clean_close).toBe(true);
    expect(bundle.complete).toBe(false);
    expect(bundle.rejected_links.length).toBe(6);
    for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
      expect(bundle.sections[kind].links).toEqual([]);
      expect(bundle.sections[kind].observation_state).not.toBe("checked_clean");
    }
  });

  it("is deterministic — identical inputs produce a byte-identical bundle", () => {
    const a = build(mkRoot(), fullLinkSet());
    const b = build(mkRoot(), fullLinkSet());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BR-07 / BR-10 — the evidence itself must be machine truth
//
// A link is a claim about a machine object. These tests check the OBJECT, not
// the claim: its bytes must exist, hash as declared, and really parse as the
// declared format, and the receipt underwriting it must be successful + clean.
// ─────────────────────────────────────────────────────────────────────────────

describe("machine-evidence binding is validated, not asserted", () => {
  /** Swap one section's link, keeping the other five well-formed. */
  function withReplaced(kind: string, replacement: DebugLinkInput): DebugLinkInput[] {
    return [...fullLinkSet().filter((l) => l.kind !== kind), replacement];
  }

  it("accepts a link only after verifying the evidence content hash", () => {
    const bundle = build(mkRoot(), fullLinkSet());
    for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
      const [link] = bundle.sections[kind].links;
      expect(link.content_hash_verified).toBe(true);
      expect(link.evidence_bytes).toBe(evidenceFor(kind).length);
      expect(link.hash).toBe(sha256(evidenceFor(kind)));
    }
  });

  it("rejects a link whose declared hash does not match the resolved bytes", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("artifact", {
        kind: "artifact",
        ref: refFor("artifact"),
        media_type: "application/json",
        // A real, well-formed sha256 — of different content.
        hash: sha256(Buffer.from("{\"not\":\"the evidence\"}", "utf8")),
        bound_by: BINDING,
      }),
    );

    expect(bundle.rejected_links).toEqual([
      { kind: "artifact", ref: refFor("artifact"), reason: "evidence_hash_mismatch" },
    ]);
    expect(bundle.sections.artifact.links).toEqual([]);
    expect(bundle.sections.artifact.observation_state).toBe("not_observed");
    expect(bundle.complete).toBe(false);
  });

  it("rejects a hash that is not a sha256 reference at all", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("artifact", {
        kind: "artifact",
        ref: refFor("artifact"),
        media_type: "application/json",
        hash: "not-a-sha-at-all",
        bound_by: BINDING,
      }),
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "artifact", ref: refFor("artifact"), reason: "malformed_hash" },
    ]);
    expect(bundle.complete).toBe(false);
  });

  it("rejects a reference that resolves to nothing — dangling evidence is not evidence", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("conformance", {
        kind: "conformance",
        ref: "guild://evidence/never-stored.json",
        media_type: "application/json",
        hash: sha256(evidenceFor("conformance")),
        bound_by: BINDING,
      }),
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "conformance", ref: "guild://evidence/never-stored.json", reason: "evidence_unresolved" },
    ]);
    expect(bundle.complete).toBe(false);
  });

  it("BR-10: rejects a prose payload mislabeled application/json under a .json suffix", () => {
    // Every LABEL is machine-shaped: media type on the allow-list, non-prose
    // extension, real sha256 of the real bytes. Only the CONTENT betrays it.
    const prose = Buffer.from("# Support matrix\n\nEverything looks fine.\n", "utf8");
    const bundle = build(
      mkRoot(),
      withReplaced("conformance", {
        kind: "conformance",
        ref: "guild://evidence/mislabeled.json",
        media_type: "application/json",
        hash: sha256(prose),
        bound_by: BINDING,
      }),
      { evidence: mapResolver({ ...EVIDENCE_STORE, "guild://evidence/mislabeled.json": { bytes: prose } }) },
    );

    expect(bundle.rejected_links).toEqual([
      {
        kind: "conformance",
        ref: "guild://evidence/mislabeled.json",
        reason: "evidence_not_machine_parsable",
      },
    ]);
    expect(bundle.sections.conformance.observation_state).toBe("not_observed");
    expect(bundle.complete).toBe(false);
  });

  it("BR-10: rejects a bare JSON scalar — a machine record is a structured envelope", () => {
    const scalar = Buffer.from('"just some prose in quotes"', "utf8");
    const bundle = build(
      mkRoot(),
      withReplaced("artifact", {
        kind: "artifact",
        ref: "guild://evidence/scalar.json",
        media_type: "application/json",
        hash: sha256(scalar),
        bound_by: BINDING,
      }),
      { evidence: mapResolver({ ...EVIDENCE_STORE, "guild://evidence/scalar.json": { bytes: scalar } }) },
    );
    expect(bundle.rejected_links[0].reason).toBe("evidence_not_machine_parsable");
  });

  it("BR-10: only allow-listed machine media types satisfy a section", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("artifact", {
        kind: "artifact",
        ref: refFor("artifact"),
        media_type: "application/octet-stream",
        hash: sha256(evidenceFor("artifact")),
        bound_by: BINDING,
      }),
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "artifact", ref: refFor("artifact"), reason: "non_machine_media_type" },
    ]);
    expect(bundle.complete).toBe(false);
  });

  it("accepts a JSON-lines evidence object when every line is a machine record", () => {
    const jsonl = Buffer.from('{"a":1}\n{"a":2}\n', "utf8");
    const bundle = build(
      mkRoot(),
      withReplaced("normalized_event", {
        kind: "normalized_event",
        ref: "guild://evidence/events.jsonl",
        media_type: "application/x-ndjson",
        hash: sha256(jsonl),
        bound_by: BINDING,
      }),
      { evidence: mapResolver({ ...EVIDENCE_STORE, "guild://evidence/events.jsonl": { bytes: jsonl } }) },
    );
    expect(bundle.rejected_links).toEqual([]);
    expect(bundle.sections.normalized_event.links[0].content_hash_verified).toBe(true);
    expect(bundle.complete).toBe(true);
  });

  it("rejects JSON-lines evidence carrying a prose line", () => {
    const mixed = Buffer.from('{"a":1}\nnot json at all\n', "utf8");
    const bundle = build(
      mkRoot(),
      withReplaced("normalized_event", {
        kind: "normalized_event",
        ref: "guild://evidence/events.jsonl",
        media_type: "application/x-ndjson",
        hash: sha256(mixed),
        bound_by: BINDING,
      }),
      { evidence: mapResolver({ ...EVIDENCE_STORE, "guild://evidence/events.jsonl": { bytes: mixed } }) },
    );
    expect(bundle.rejected_links[0].reason).toBe("evidence_not_machine_parsable");
  });

  it("rejects evidence whose store-attested media type contradicts the link", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("artifact", {
        kind: "artifact",
        ref: refFor("artifact"),
        media_type: "application/json",
        hash: sha256(evidenceFor("artifact")),
        bound_by: BINDING,
      }),
      {
        evidence: mapResolver({
          ...EVIDENCE_STORE,
          [refFor("artifact")]: { bytes: evidenceFor("artifact"), media_type: "text/markdown" },
        }),
      },
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "artifact", ref: refFor("artifact"), reason: "media_type_mismatch" },
    ]);
  });

  it("rejects a link that borrows another run's receipt lineage", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("capability_snapshot", {
        kind: "capability_snapshot",
        ref: refFor("capability_snapshot"),
        media_type: "application/json",
        hash: sha256(evidenceFor("capability_snapshot")),
        bound_by: { ...BINDING, run_id: "some-other-run" },
      }),
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "capability_snapshot", ref: refFor("capability_snapshot"), reason: "foreign_run_binding" },
    ]);
    expect(bundle.complete).toBe(false);
  });

  it("rejects a link bound to a scenario the receipt was not recorded under", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("policy_decision", {
        kind: "policy_decision",
        ref: refFor("policy_decision"),
        media_type: "application/json",
        hash: sha256(evidenceFor("policy_decision")),
        bound_by: { ...BINDING, scenario_id: "MHRC-LIF-001" },
      }),
    );
    expect(bundle.rejected_links).toEqual([
      { kind: "policy_decision", ref: refFor("policy_decision"), reason: "scenario_mismatch" },
    ]);
    expect(bundle.complete).toBe(false);
  });

  it("rejects a link bound with no scenario id at all", () => {
    const bundle = build(
      mkRoot(),
      withReplaced("policy_decision", {
        kind: "policy_decision",
        ref: refFor("policy_decision"),
        media_type: "application/json",
        hash: sha256(evidenceFor("policy_decision")),
        bound_by: { ...BINDING, scenario_id: null },
      }),
    );
    expect(bundle.rejected_links[0].reason).toBe("scenario_mismatch");
  });

  it("resolves evidence through the default filesystem resolver", () => {
    const root = mkRoot();
    const store = path.join(root, "evidence");
    fs.mkdirSync(store, { recursive: true });
    const links = DEBUG_BUNDLE_SECTION_KINDS.map((kind) => {
      const file = path.join(store, `${kind}.json`);
      fs.writeFileSync(file, evidenceFor(kind));
      return {
        kind,
        ref: file,
        media_type: "application/json",
        hash: sha256(evidenceFor(kind)),
        bound_by: BINDING,
      };
    });

    const p = seedJournal(root);
    const bundle = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      links,
    });

    expect(bundle.rejected_links).toEqual([]);
    expect(bundle.complete).toBe(true);

    // Mutate one byte on disk: the same link no longer verifies.
    fs.writeFileSync(path.join(store, "artifact.json"), Buffer.from('{"tampered":true}', "utf8"));
    const after = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      links,
    });
    expect(after.rejected_links.map((r) => r.reason)).toEqual(["evidence_hash_mismatch"]);
    expect(after.complete).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BR-07 — a failed observation can never be presented as complete evidence
// ─────────────────────────────────────────────────────────────────────────────

describe("BR-07 — failed lineage blocks completion", () => {
  function base(over: Partial<ReceiptAppendInput> = {}): ReceiptAppendInput {
    return makeReceiptInput({
      run_id: "run-mh-06",
      operation_id: "op-1",
      correlation_id: "corr-1",
      event_id: "evt-1",
      causation_id: null,
      scenario_id: "MHRC-RCT-001",
      event_name: "receipt.append",
      outcome_type: "guild.receipt_outcome.v1",
      disposition: "succeeded",
      observation_state: "checked_clean",
      input_hash: "sha256:aaa",
      output_hash: "sha256:bbb",
      terminal: false,
      recorded_at: "2026-07-26T02:00:00.000Z",
      observed_at: "2026-07-26T02:00:00.000Z",
      versions: VERSIONS,
      ...over,
    });
  }

  it("refuses to underwrite evidence with a failed receipt", () => {
    const root = mkRoot();
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "receipts", "checkpoint.json"),
    };
    appendReceipt(
      p,
      base({ disposition: "failed", observation_state: "observation_failed", output_hash: null }),
    );

    const bundle = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      links: fullLinkSet(),
      evidence: RESOLVER,
    });

    expect(bundle.rejected_links.map((r) => r.reason)).toEqual(Array(6).fill("unclean_receipt"));
    expect(bundle.complete).toBe(false);
    expect(bundle.unlinked_kinds).toEqual([...DEBUG_BUNDLE_SECTION_KINDS]);
  });

  it("a journal that blocks a clean close can never produce a complete bundle", () => {
    // Every link is perfect and bound to a CLEAN receipt at sequence 1 — but a
    // later record in the same journal failed its observation.
    const root = mkRoot();
    const p = {
      journal: path.join(root, "receipts", "journal.jsonl"),
      checkpoint: path.join(root, "receipts", "checkpoint.json"),
    };
    appendReceipt(p, base());
    appendReceipt(
      p,
      base({
        event_id: "evt-2",
        operation_id: "op-2",
        correlation_id: "corr-2",
        disposition: "failed",
        observation_state: "observation_failed",
        output_hash: null,
        affected_event_range: { from: 2, to: 2 },
      }),
    );

    const bundle = buildDebugBundle({
      run_id: "run-mh-06",
      generated_at: "2026-07-26T04:00:00.000Z",
      versions: VERSIONS,
      journalPath: p.journal,
      checkpointPath: p.checkpoint,
      links: fullLinkSet(),
      evidence: RESOLVER,
    });

    expect(bundle.rejected_links).toEqual([]); // the links themselves are fine…
    expect(bundle.receipt_journal.observation_state).toBe("observation_failed");
    expect(bundle.receipt_journal.blocks_clean_close).toBe(true);
    for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
      expect(bundle.sections[kind].links).toHaveLength(1);
      expect(bundle.sections[kind].observation_state).toBe("not_observed");
    }
    expect(bundle.complete).toBe(false); // …but the lineage is not clean
  });
});
