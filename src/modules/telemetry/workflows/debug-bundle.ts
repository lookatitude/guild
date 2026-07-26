/**
 * src/modules/telemetry/workflows/debug-bundle.ts
 *
 * MH-06 — the structured debugging boundary.
 *
 * Satisfies MH-06 acceptance statement 4: "Debug bundles link capability
 * snapshot, normalized events, policy decisions, transport attempts,
 * artifacts, and conformance WITHOUT PARSING PROSE."
 *
 * "Without parsing prose" is enforced, not asserted — and enforcement means
 * inspecting the EVIDENCE, not the label on it. A link is accepted only when
 * every one of these holds:
 *
 *   1. its kind is in the closed section vocabulary;
 *   2. its media type is not prose (BR-10) AND is on the machine ALLOW-LIST —
 *      a denylist would let any unlisted format through;
 *   3. its declared content hash is a real `sha256:<64 hex>`;
 *   4. it resolves to a receipt by full run/operation/correlation/sequence
 *      lineage, and the receipt's `scenario_id` matches the link's binding;
 *   5. that receipt is itself SUCCESSFUL and CLEAN — failed or unobserved
 *      lineage cannot underwrite evidence (BR-07);
 *   6. the referenced machine object actually RESOLVES, its bytes hash to the
 *      declared content hash, and those bytes really parse as the declared
 *      machine format — a Markdown payload mislabeled `application/json` under
 *      a `.json` suffix is rejected on its CONTENT, not on its name.
 *
 * BR-07 also governs the bundle verdict: a bundle over a journal that blocks a
 * clean close can never be `complete`, and no section over such a journal reads
 * `checked_clean`. The ONLY way to close a section without evidence is an
 * explicit `not_applicable` rule, recorded with the bundle.
 *
 * DETERMINISM: the bundle carries no clock reads and no resolver-supplied
 * paths, so identical inputs serialize byte-identically. Refs are logical
 * identifiers; the injected `EvidenceResolver` owns how they map to bytes.
 *
 * Owned by: tooling-engineer (scripts/ + src/modules scope per AGENTS.md).
 */

import * as fs from "node:fs";
import * as crypto from "node:crypto";
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

/**
 * The closed ALLOW-LIST of machine media types. A denylist can only reject the
 * prose we thought of; an allow-list rejects everything we did not sanction.
 */
const MACHINE_MEDIA_TYPES = new Set([
  "application/json",
  "application/jsonl",
  "application/x-ndjson",
  "application/schema+json",
]);

/** Media types whose payload must be one JSON value per line. */
const JSON_LINES_MEDIA_TYPES = new Set(["application/jsonl", "application/x-ndjson"]);

function normalizeMediaType(mediaType: string): string {
  return mediaType.toLowerCase().trim();
}

function isProse(ref: string, mediaType: string): boolean {
  if (PROSE_MEDIA_TYPES.has(normalizeMediaType(mediaType))) return true;
  const lower = ref.toLowerCase();
  return PROSE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isMachineMediaType(mediaType: string): boolean {
  const t = normalizeMediaType(mediaType);
  return MACHINE_MEDIA_TYPES.has(t) || /^application\/[a-z0-9][a-z0-9.\-_]*\+json$/.test(t);
}

const SHA256_REF = /^sha256:[0-9a-f]{64}$/;

function sha256(bytes: Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

/** A machine record is a structured envelope — a bare scalar is not one. */
function isStructured(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * Does the payload REALLY parse as the declared machine format? This is the
 * check that a mislabeled prose payload cannot survive: `# Heading` under
 * `application/json` with a `.json` suffix passes every label test and fails
 * here.
 */
function parsesAsDeclaredMachineFormat(bytes: Buffer, mediaType: string): boolean {
  let text: string;
  try {
    text = bytes.toString("utf8");
  } catch {
    return false;
  }
  if (JSON_LINES_MEDIA_TYPES.has(normalizeMediaType(mediaType))) {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return false;
    return lines.every((line) => {
      try {
        return isStructured(JSON.parse(line));
      } catch {
        return false;
      }
    });
  }
  try {
    return isStructured(JSON.parse(text));
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Evidence resolution seam
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedEvidence {
  /** The machine object's raw bytes — what the content hash is taken over. */
  bytes: Buffer;
  /** Media type the STORE attests, or null when it cannot attest one. */
  media_type: string | null;
}

/**
 * Turns a logical evidence ref into bytes. Injectable so a bundle can be built
 * over any evidence store, and so the content check is testable without
 * hand-waving a filesystem layout.
 */
export interface EvidenceResolver {
  resolve(ref: string): ResolvedEvidence | null;
}

/** Default resolver: the ref is a filesystem path. Absent file → null. */
export const filesystemEvidenceResolver: EvidenceResolver = {
  resolve(ref) {
    try {
      return { bytes: fs.readFileSync(ref), media_type: null };
    } catch {
      return null;
    }
  },
};

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
  /** Byte length of the resolved machine object (content-derived, stable). */
  evidence_bytes: number;
  /** True only when the resolved bytes hashed to `hash`. Never asserted blind. */
  content_hash_verified: boolean;
}

export type LinkRejectionReason =
  | "unknown_kind"
  | "prose_media_type"
  | "non_machine_media_type"
  | "malformed_hash"
  | "foreign_run_binding"
  | "unbound_operation"
  | "scenario_mismatch"
  | "unclean_receipt"
  | "evidence_unresolved"
  | "media_type_mismatch"
  | "evidence_hash_mismatch"
  | "evidence_not_machine_parsable";

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
  /** Where refs resolve to bytes. Defaults to the filesystem resolver. */
  evidence?: EvidenceResolver;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assemble a debug bundle from typed links and the receipt journal.
 *
 * Never throws on bad input — every rejection is reported in `rejected_links`
 * so the caller sees WHY a section stayed unobserved.
 */
export function buildDebugBundle(opts: BuildDebugBundleOptions): DebugBundleV1 {
  const io = opts.io ?? defaultJournalIo;
  const evidence = opts.evidence ?? filesystemEvidenceResolver;
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
    const reject = (reason: LinkRejectionReason): void => {
      rejected_links.push({ kind: String(link.kind), ref: link.ref, reason });
    };

    // 1. Closed vocabulary.
    if (!(DEBUG_BUNDLE_SECTION_KINDS as readonly string[]).includes(link.kind)) {
      reject("unknown_kind");
      continue;
    }
    // 2. BR-10 — prose is never a machine protocol…
    if (isProse(link.ref, link.media_type)) {
      reject("prose_media_type");
      continue;
    }
    // …and only sanctioned machine formats are machine protocols.
    if (!isMachineMediaType(link.media_type)) {
      reject("non_machine_media_type");
      continue;
    }
    // 3. A content hash that is not a hash cannot bind anything.
    if (!SHA256_REF.test(link.hash)) {
      reject("malformed_hash");
      continue;
    }
    // 4. The lineage must be THIS bundle's run — a bundle cannot borrow another
    // run's receipts to underwrite its own evidence.
    if (link.bound_by.run_id !== opts.run_id) {
      reject("foreign_run_binding");
      continue;
    }
    // …and must resolve to a real receipt, by lineage — not by prose.
    const receipt = scan.records.find(
      (r) =>
        r.run_id === link.bound_by.run_id &&
        r.operation_id === link.bound_by.operation_id &&
        r.correlation_id === link.bound_by.correlation_id &&
        r.sequence === link.bound_by.sequence,
    );
    if (!receipt) {
      reject("unbound_operation");
      continue;
    }
    // …bound to the SAME scenario the receipt was recorded under.
    if (
      typeof link.bound_by.scenario_id !== "string" ||
      link.bound_by.scenario_id.length === 0 ||
      link.bound_by.scenario_id !== receipt.scenario_id
    ) {
      reject("scenario_mismatch");
      continue;
    }
    // 5. BR-07 — a failed or unobserved receipt cannot underwrite evidence.
    if (receipt.disposition !== "succeeded" || receipt.observation_state !== "checked_clean") {
      reject("unclean_receipt");
      continue;
    }
    // 6. The referenced machine object must exist, hash as declared, and parse.
    const resolved = evidence.resolve(link.ref);
    if (!resolved) {
      reject("evidence_unresolved");
      continue;
    }
    if (resolved.media_type !== null && normalizeMediaType(resolved.media_type) !== normalizeMediaType(link.media_type)) {
      reject("media_type_mismatch");
      continue;
    }
    if (sha256(resolved.bytes) !== link.hash.toLowerCase()) {
      reject("evidence_hash_mismatch");
      continue;
    }
    if (!parsesAsDeclaredMachineFormat(resolved.bytes, link.media_type)) {
      reject("evidence_not_machine_parsable");
      continue;
    }

    accepted.get(link.kind)!.push({
      ...link,
      resolves_to_receipt: receipt.event_id,
      evidence_bytes: resolved.bytes.length,
      content_hash_verified: true,
    });
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
    // A section cannot claim cleanliness on top of a journal that blocks close.
    else observation_state = scan.blocks_clean_close ? "not_observed" : "checked_clean";

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
    // A bundle over a journal that blocks a clean close is never complete.
    complete: unlinked_kinds.length === 0 && !scan.blocks_clean_close,
    unlinked_kinds,
    rejected_links,
  };
}
