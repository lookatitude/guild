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

/** One well-formed machine link per required section kind. */
function fullLinkSet(): DebugLinkInput[] {
  return DEBUG_BUNDLE_SECTION_KINDS.map((kind, i) => ({
    kind,
    ref: `/evidence/${kind}.json`,
    media_type: "application/json",
    hash: `sha256:${String(i).repeat(4)}`,
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
      ref: "/evidence/policy.json",
      media_type: "application/json",
      hash: "sha256:ffff",
      bound_by: { ...BINDING, operation_id: "op-does-not-exist" },
    });

    const bundle = build(mkRoot(), links);
    expect(bundle.rejected_links).toEqual([
      { kind: "policy_decision", ref: "/evidence/policy.json", reason: "unbound_operation" },
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

  it("is deterministic — identical inputs produce a byte-identical bundle", () => {
    const a = build(mkRoot(), fullLinkSet());
    const b = build(mkRoot(), fullLinkSet());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
