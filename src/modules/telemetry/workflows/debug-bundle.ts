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
 *      a `.json` suffix is rejected on its CONTENT, not on its name;
 *   7. those parsed bytes are a TYPED envelope, not merely valid JSON. BR-10
 *      says "typed records and strict JSON envelopes are machine truth", and a
 *      two-byte `{}` is neither: it is well-formed, correctly hashed,
 *      independently resolvable — and says nothing. Six of them satisfied every
 *      section of a "complete" bundle in round 2 (MH-06-R2-B4);
 *   8. the type that envelope names RESOLVES against the closed vocabulary for
 *      THIS section. "Names a type" is not "names a real type": six objects
 *      tagged `TOTALLY.FABRICATED.ENVELOPE.v999` carry a payload, hash correctly,
 *      resolve independently, and cite a real scenario over a clean checkpointed
 *      receipt — and satisfied every section of a `complete: true` bundle in
 *      round 3 (MH-06-R3-B3). A producer that invents a schema tag can satisfy
 *      any test it writes itself; only a vocabulary it does not control can
 *      refuse it. Absent vocabulary resolves NOTHING.
 *
 * SCENARIOS, RULES AND EVIDENCE TYPES RESOLVE, THEY DO NOT MERELY MATCH.
 *   A link's `scenario_id` must resolve to a scenario the caller declared (the
 *   frozen conformance suite's `stable_id` set); agreeing with the receipt is
 *   not enough, because a producer that invents `TOTALLY-FABRICATED` stamps it
 *   on BOTH sides. Likewise a `not_applicable` declaration must cite a declared
 *   boundary rule or invariant AND carry a non-empty rationale. With no registry
 *   supplied, NOTHING resolves and every such link or declaration is refused —
 *   fail closed, never fail open.
 *
 * BR-07 also governs the bundle verdict: a bundle over a journal that blocks a
 * clean close can never be `complete`, and neither can a bundle whose receipt
 * checkpoint is absent, malformed, or disagrees with the journal — a debug
 * bundle that cannot say where the durable boundary is is not complete evidence.
 * No section over such a journal reads `checked_clean`. The ONLY way to close a
 * section without evidence is an explicit, rule-bound `not_applicable`
 * declaration, recorded with the bundle.
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
  readCheckpointState,
  compareCheckpointToJournal,
  defaultJournalIo,
  RECEIPT_CONTRACT_VERSION,
  type CheckpointAgreement,
  type CheckpointReadState,
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
 * BR-10's "typed records and strict JSON envelopes" test, applied to CONTENT.
 *
 * A typed envelope is a JSON object (not an array, not a scalar) that names its
 * own type via a non-empty `schema_version` — or a legacy `type` — AND carries
 * at least one field of actual payload beyond that tag. `{}` passes JSON.parse
 * and fails here, which is the whole point: an empty object is syntactically
 * perfect evidence of nothing.
 *
 * Returns the type it names, so the caller can then ask whether that type is a
 * type this bundle actually recognises — the tag itself is producer-controlled
 * and proves nothing on its own.
 */
function envelopeTypeTag(value: unknown): string | null {
  if (!isStructured(value) || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const tag = obj.schema_version ?? obj.type;
  if (typeof tag !== "string" || tag.trim().length === 0) return null;
  if (!Object.keys(obj).some((k) => k !== "schema_version" && k !== "type")) return null;
  return tag.trim();
}

/**
 * Every distinct type the payload names, or `null` when ANY value in it is not a
 * typed envelope. For JSON-lines that is per line: one untyped line makes the
 * whole object inadmissible, because the bundle links the object, not the lines.
 */
function envelopeTypeTags(bytes: Buffer, mediaType: string): string[] | null {
  let text: string;
  try {
    text = bytes.toString("utf8");
  } catch {
    return null;
  }
  const values: unknown[] = [];
  if (JSON_LINES_MEDIA_TYPES.has(normalizeMediaType(mediaType))) {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) return null;
    for (const line of lines) {
      try {
        values.push(JSON.parse(line));
      } catch {
        return null;
      }
    }
  } else {
    try {
      values.push(JSON.parse(text));
    } catch {
      return null;
    }
  }
  const tags: string[] = [];
  for (const value of values) {
    const tag = envelopeTypeTag(value);
    if (tag === null) return null;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
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
  | "scenario_unknown"
  | "unclean_receipt"
  | "evidence_unresolved"
  | "media_type_mismatch"
  | "evidence_hash_mismatch"
  | "evidence_not_machine_parsable"
  | "evidence_not_typed_envelope"
  | "evidence_type_unknown";

export interface RejectedLink {
  kind: string;
  ref: string;
  reason: LinkRejectionReason;
}

/** Why a `not_applicable` declaration could not close its section. */
export type NotApplicableRejectionReason = "unknown_kind" | "empty_rule" | "unknown_rule";

export interface RejectedNotApplicable {
  kind: string;
  rule_id: string;
  reason: NotApplicableRejectionReason;
}

/**
 * The closed vocabularies a bundle resolves against — the frozen conformance
 * suite's scenario `stable_id`s, the boundary-rule / invariant ids a
 * `not_applicable` declaration may cite, and the machine-envelope types each
 * section will accept as evidence.
 *
 * Supplied by the caller because this module owns the receipt boundary, not the
 * contract document (BR-06: a stable public API must not reach into a generated
 * mirror). Omitting any of them does not disable the corresponding check — it
 * makes NOTHING resolve for it.
 */
export interface DebugBundleRegistry {
  scenarios: readonly string[];
  rules: readonly string[];
  /**
   * Per-section closed vocabulary of machine-envelope types, keyed by section
   * kind: the `schema_version` (or legacy `type`) values THIS section's evidence
   * may name.
   *
   * Per-section rather than one flat list because the sections are different
   * evidence, not one bag: a capability snapshot under `capability_snapshot` and
   * a policy decision under `policy_decision` are both real records, and each in
   * the other's section is a mislinked bundle. A kind with no declared types, or
   * an absent map, resolves nothing — every link into that section is refused
   * `evidence_type_unknown`, which is the fail-closed direction (BR-07).
   */
  evidence_types?: Partial<Record<DebugSectionKind, readonly string[]>>;
}

export interface DebugSection {
  links: DebugLink[];
  observation_state: ObservationState;
  not_applicable_rule: string | null;
  /** The declared rule id the `not_applicable_rule` is bound to. */
  not_applicable_rule_id: string | null;
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
    /** Absent, malformed, or present — malformed is damage, not absence. */
    checkpoint_state: CheckpointReadState;
    /** How the checkpoint fails to describe the journal, if it does. */
    checkpoint_disagreements: CheckpointAgreement[];
  };
  sections: Record<DebugSectionKind, DebugSection>;
  complete: boolean;
  unlinked_kinds: DebugSectionKind[];
  rejected_links: RejectedLink[];
  rejected_not_applicable: RejectedNotApplicable[];
}

export interface NotApplicableDeclaration {
  kind: DebugSectionKind;
  /**
   * The declared boundary rule or invariant that makes the observation
   * inapplicable — it must resolve against `registry.rules`.
   */
  rule_id: string;
  /** Non-empty rationale. A blank string closes nothing. */
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
  /** Closed scenario/rule vocabularies. Omitted ⇒ nothing resolves. */
  registry?: DebugBundleRegistry;
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
  const checkpointRead = readCheckpointState(opts.checkpointPath, io);
  const checkpoint = checkpointRead.checkpoint;
  // The SAME agreement test reconciliation applies. A bundle that cannot say
  // where the durable boundary is has not linked the receipt journal (CI-05).
  const checkpoint_disagreements = compareCheckpointToJournal(checkpointRead, scan, opts.run_id);

  const knownScenarios = new Set(opts.registry?.scenarios ?? []);
  const knownRules = new Set(opts.registry?.rules ?? []);
  // Built for EVERY section kind up front, so an undeclared section is an empty
  // vocabulary (resolves nothing) rather than an absent lookup (resolves anything).
  const knownEvidenceTypes = new Map<DebugSectionKind, Set<string>>(
    DEBUG_BUNDLE_SECTION_KINDS.map((kind) => [kind, new Set(opts.registry?.evidence_types?.[kind] ?? [])]),
  );

  // A not_applicable declaration is the ONLY way to close a section without
  // evidence, so it is held to the same standard as evidence: real kind, real
  // rule id, real rationale. An empty rule closed six sections in round 2.
  const notApplicable = new Map<DebugSectionKind, { rule: string; rule_id: string }>();
  const rejected_not_applicable: RejectedNotApplicable[] = [];
  for (const d of opts.not_applicable ?? []) {
    const rule_id = typeof d?.rule_id === "string" ? d.rule_id : "";
    const rule = typeof d?.rule === "string" ? d.rule : "";
    if (!(DEBUG_BUNDLE_SECTION_KINDS as readonly string[]).includes(d?.kind)) {
      rejected_not_applicable.push({ kind: String(d?.kind), rule_id, reason: "unknown_kind" });
      continue;
    }
    if (rule.trim().length === 0) {
      rejected_not_applicable.push({ kind: d.kind, rule_id, reason: "empty_rule" });
      continue;
    }
    if (!knownRules.has(rule_id)) {
      rejected_not_applicable.push({ kind: d.kind, rule_id, reason: "unknown_rule" });
      continue;
    }
    notApplicable.set(d.kind, { rule, rule_id });
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
    // …and that scenario must RESOLVE. Agreeing with the receipt proves nothing
    // when the producer stamped the same invented id on both sides.
    if (!knownScenarios.has(link.bound_by.scenario_id)) {
      reject("scenario_unknown");
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
    // 7. BR-10 — a strict JSON envelope is a TYPED record, not any JSON object.
    const declaredTypes = envelopeTypeTags(resolved.bytes, link.media_type);
    if (declaredTypes === null) {
      reject("evidence_not_typed_envelope");
      continue;
    }
    // 8. …and the type it names must RESOLVE for THIS section. A tag the producer
    // invented satisfies any self-consistent check; only a vocabulary the
    // producer does not control can refuse `TOTALLY.FABRICATED.ENVELOPE.v999`.
    const sectionTypes = knownEvidenceTypes.get(link.kind)!;
    if (sectionTypes.size === 0 || declaredTypes.some((t) => !sectionTypes.has(t))) {
      reject("evidence_type_unknown");
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

  // A checkpoint that is absent, damaged, or disagreeing means the bundle cannot
  // state where the durable boundary is — no section may read clean over it.
  const durableBoundaryUnknown = checkpointRead.state !== "present" || checkpoint_disagreements.length > 0;

  for (const kind of DEBUG_BUNDLE_SECTION_KINDS) {
    const links = accepted.get(kind)!;
    const na = notApplicable.get(kind) ?? null;

    let observation_state: ObservationState;
    if (na !== null) observation_state = "not_applicable";
    else if (links.length === 0) observation_state = "not_observed";
    // A section cannot claim cleanliness on top of a journal that blocks close.
    else observation_state = scan.blocks_clean_close || durableBoundaryUnknown ? "not_observed" : "checked_clean";

    if (links.length === 0 && na === null) unlinked_kinds.push(kind);
    sections[kind] = {
      links,
      observation_state,
      not_applicable_rule: na?.rule ?? null,
      not_applicable_rule_id: na?.rule_id ?? null,
    };
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
      checkpoint_state: checkpointRead.state,
      checkpoint_disagreements,
    },
    sections,
    // A bundle is complete only when every section is closed by evidence or a
    // rule-bound declaration, the journal does not block a clean close, and the
    // durable boundary is actually known.
    complete: unlinked_kinds.length === 0 && !scan.blocks_clean_close && !durableBoundaryUnknown,
    unlinked_kinds,
    rejected_links,
    rejected_not_applicable,
  };
}
