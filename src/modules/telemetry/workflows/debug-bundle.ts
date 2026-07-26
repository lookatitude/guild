/**
 * src/modules/telemetry/workflows/debug-bundle.ts
 *
 * MH-06 — the structured debugging boundary.
 *
 * Satisfies MH-06 acceptance statement 4: "Debug bundles link capability
 * snapshot, normalized events, policy decisions, transport attempts,
 * artifacts, and conformance WITHOUT PARSING PROSE."
 *
 * "Without parsing prose" is enforced, not asserted. A debug bundle is a graph
 * of typed references — each link names a machine record, its content hash, and
 * the receipt lineage it belongs to. Two rules make the boundary real:
 *
 *   BR-10  HTML, Markdown, and plain text are NOT machine protocols. A link
 *          whose media type OR file extension is prose is REJECTED — it can
 *          never satisfy a section, so a bundle can never be "complete"
 *          because someone pointed it at a rendered report.
 *
 *   BR-07  An absent observation is not success. A section with no accepted
 *          link is `not_observed` and the bundle is incomplete. The ONLY way
 *          to close a section without evidence is an explicit `not_applicable`
 *          rule, recorded with the bundle.
 *
 * Every link must also resolve to a real receipt in the journal, so a debugger
 * can traverse capability → event → policy → transport → artifact → conformance
 * by operation and correlation id alone. A link that resolves to nothing is
 * `unbound_operation` — dangling evidence is not evidence.
 *
 * DETERMINISM: the bundle carries no filesystem paths and no clock reads, so
 * identical inputs serialize byte-identically.
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import {
  scanReceiptJournal,
  readCheckpoint,
  defaultJournalIo,
  RECEIPT_CONTRACT_VERSION,
  type JournalIo,
  type JournalIntegrity,
  type ObservationState,
  type ReceiptCheckpointV1,
  type ReceiptVersions,
} from "./receipt-journal";

// ─────────────────────────────────────────────────────────────────────────────
// Closed section vocabulary — MH-06 acceptance 4, in contract order
// ─────────────────────────────────────────────────────────────────────────────

export const DEBUG_BUNDLE_SECTION_KINDS = [
  "capability_snapshot",
  "normalized_event",
  "policy_decision",
  "transport_attempt",
  "artifact",
  "conformance",
] as const;
export type DebugSectionKind = (typeof DEBUG_BUNDLE_SECTION_KINDS)[number];

/** Media types that are human presentation, never machine truth (BR-10). */
const PROSE_MEDIA_TYPES = new Set([
  "text/html",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "application/xhtml+xml",
]);

/** Extensions that betray a prose payload even under a JSON media type. */
const PROSE_EXTENSIONS = [".html", ".htm", ".xhtml", ".md", ".markdown", ".txt"];

function isProse(ref: string, mediaType: string): boolean {
  if (PROSE_MEDIA_TYPES.has(mediaType.toLowerCase().trim())) return true;
  const lower = ref.toLowerCase();
  return PROSE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Receipt lineage coordinates a link is bound to. */
export interface DebugLinkBinding {
  run_id: string;
  operation_id: string;
  correlation_id: string;
  sequence: number;
  scenario_id: string | null;
}

export interface DebugLinkInput {
  kind: DebugSectionKind;
  ref: string;
  media_type: string;
  hash: string;
  bound_by: DebugLinkBinding;
}

export interface DebugLink extends DebugLinkInput {
  /** event_id of the receipt this link resolves to — the traversal edge. */
  resolves_to_receipt: string;
}

export type LinkRejectionReason = "prose_media_type" | "unbound_operation" | "unknown_kind";

export interface RejectedLink {
  kind: string;
  ref: string;
  reason: LinkRejectionReason;
}

export interface DebugSection {
  links: DebugLink[];
  observation_state: ObservationState;
  not_applicable_rule: string | null;
}

export interface DebugBundleV1 {
  schema_version: "guild.debug_bundle.v1";
  run_id: string;
  generated_at: string;
  contract_version: string;
  versions: ReceiptVersions;
  receipt_journal: {
    integrity: JournalIntegrity;
    observation_state: ObservationState;
    last_sequence: number;
    record_count: number;
    blocks_clean_close: boolean;
    checkpoint: ReceiptCheckpointV1 | null;
  };
  sections: Record<DebugSectionKind, DebugSection>;
  complete: boolean;
  unlinked_kinds: DebugSectionKind[];
  rejected_links: RejectedLink[];
}

export interface NotApplicableDeclaration {
  kind: DebugSectionKind;
  /** The explicit typed rule that makes the observation inapplicable. */
  rule: string;
}

export interface BuildDebugBundleOptions {
  run_id: string;
  generated_at: string;
  versions: ReceiptVersions;
  journalPath: string;
  checkpointPath: string;
  links: DebugLinkInput[];
  not_applicable?: NotApplicableDeclaration[];
  io?: JournalIo;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble a debug bundle from typed links and the receipt journal.
 *
 * Pure with respect to the filesystem apart from reading the journal and
 * checkpoint. Never throws on bad input — every rejection is reported in
 * `rejected_links` so the caller sees WHY a section stayed unobserved.
 */
export function buildDebugBundle(opts: BuildDebugBundleOptions): DebugBundleV1 {
  const io = opts.io ?? defaultJournalIo;
  const scan = scanReceiptJournal(opts.journalPath, io);
  const checkpoint = readCheckpoint(opts.checkpointPath);

  const notApplicable = new Map<DebugSectionKind, string>();
  for (const d of opts.not_applicable ?? []) {
    if ((DEBUG_BUNDLE_SECTION_KINDS as readonly string[]).includes(d.kind)) notApplicable.set(d.kind, d.rule);
  }

  const accepted = new Map<DebugSectionKind, DebugLink[]>();
  for (const kind of DEBUG_BUNDLE_SECTION_KINDS) accepted.set(kind, []);
  const rejected_links: RejectedLink[] = [];

  for (const link of opts.links) {
    // 1. Closed vocabulary.
    if (!(DEBUG_BUNDLE_SECTION_KINDS as readonly string[]).includes(link.kind)) {
      rejected_links.push({ kind: String(link.kind), ref: link.ref, reason: "unknown_kind" });
      continue;
    }
    // 2. BR-10 — prose is never a machine protocol.
    if (isProse(link.ref, link.media_type)) {
      rejected_links.push({ kind: link.kind, ref: link.ref, reason: "prose_media_type" });
      continue;
    }
    // 3. The link must resolve to a real receipt, by lineage — not by prose.
    const receipt = scan.records.find(
      (r) =>
        r.run_id === link.bound_by.run_id &&
        r.operation_id === link.bound_by.operation_id &&
        r.correlation_id === link.bound_by.correlation_id &&
        r.sequence === link.bound_by.sequence,
    );
    if (!receipt) {
      rejected_links.push({ kind: link.kind, ref: link.ref, reason: "unbound_operation" });
      continue;
    }
    accepted.get(link.kind)!.push({ ...link, resolves_to_receipt: receipt.event_id });
  }

  // ── Sections (BR-07: absence is never cleanliness) ────────────────────────
  const sections = {} as Record<DebugSectionKind, DebugSection>;
  const unlinked_kinds: DebugSectionKind[] = [];

  for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
    const links = accepted.get(kind)!;
    const rule = notApplicable.get(kind) ?? null;

    let observation_state: ObservationState;
    if (rule !== null) observation_state = "not_applicable";
    else if (links.length === 0) observation_state = "not_observed";
    // A section cannot claim cleanliness on top of a damaged journal.
    else observation_state = scan.integrity === "intact" ? "checked_clean" : "not_observed";

    if (links.length === 0 && rule === null) unlinked_kinds.push(kind);
    sections[kind] = { links, observation_state, not_applicable_rule: rule };
  }

  return {
    schema_version: "guild.debug_bundle.v1",
    run_id: opts.run_id,
    generated_at: opts.generated_at,
    contract_version: RECEIPT_CONTRACT_VERSION,
    versions: opts.versions,
    receipt_journal: {
      integrity: scan.integrity,
      observation_state: scan.observation_state,
      last_sequence: scan.last_sequence,
      record_count: scan.record_count,
      blocks_clean_close: scan.blocks_clean_close,
      checkpoint,
    },
    sections,
    complete: unlinked_kinds.length === 0 && scan.integrity === "intact",
    unlinked_kinds,
    rejected_links,
  };
}
