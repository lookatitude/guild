/**
 * scripts/lib/host-smoke-store.ts
 *
 * verified-multi-host-support L5 — the fs read/write of the COMMITTED smoke-receipt
 * store (ADR §6.1): `plugin/evidence/host-smoke/<host_id>/<box_id>.json`. This is the
 * ONLY I/O boundary of the state model — the derivations + gate + schema live in the
 * pure `host-public-state.ts`; the matrix generator consumes the receipts this module
 * loads. In CI the checkout carries only committed receipts, so `loadCommittedReceipts`
 * naturally sees exactly the tracked files (ADR §6.5 — the matrix NEVER re-runs smoke).
 *
 * Consumers: `scripts/generate-support-matrix.ts` (CI matrix step), `scripts/host-smoke.ts`
 * (the write path), and the support-matrix / gate tests.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalize,
  computeSmokeDigest,
  validateSmokeReceipt,
  type HostSmokeReceipt,
  SMOKE_RECEIPT_SCHEMA,
} from "./host-public-state";
import { HOST_IDS, type HostId } from "./host-registry-schema";
import { redact } from "./shared/scrub-redact";

/** The committed evidence root, relative to the plugin repo root. */
export const EVIDENCE_HOST_SMOKE_REL = "evidence/host-smoke";

/** Resolve `<plugin>/evidence/host-smoke` from this module's location (scripts/lib → plugin). */
export function defaultEvidenceRoot(): string {
  // __dirname = <plugin>/scripts/lib  →  <plugin> is two up.
  return join(__dirname, "..", "..", EVIDENCE_HOST_SMOKE_REL);
}

/**
 * Load every committed receipt, keyed by host id. Absent tree / absent host dir →
 * empty. Only files that parse + structurally validate are returned; a malformed
 * committed file is surfaced to the caller via `onWarn` (never silently promoted).
 */
export function loadCommittedReceipts(
  evidenceRoot: string = defaultEvidenceRoot(),
  onWarn?: (msg: string) => void,
): Record<HostId, HostSmokeReceipt[]> {
  const out = {} as Record<HostId, HostSmokeReceipt[]>;
  for (const host of HOST_IDS) out[host] = [];
  if (!existsSync(evidenceRoot)) return out;
  for (const host of HOST_IDS) {
    const hostDir = join(evidenceRoot, host);
    if (!existsSync(hostDir)) continue;
    for (const file of readdirSync(hostDir).filter((f) => f.endsWith(".json")).sort()) {
      const full = join(hostDir, file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(full, "utf8"));
      } catch (err) {
        onWarn?.(`skipped unparseable receipt ${host}/${file}: ${(err as Error).message}`);
        continue;
      }
      const v = validateSmokeReceipt(parsed);
      if (!v.valid) {
        onWarn?.(`skipped invalid receipt ${host}/${file}: ${v.errors.join("; ")}`);
        continue;
      }
      out[host].push(parsed as HostSmokeReceipt);
    }
  }
  return out;
}

/** The committed path for a (host, box) receipt. */
export function receiptPath(host: HostId, boxId: string, evidenceRoot: string = defaultEvidenceRoot()): string {
  return join(evidenceRoot, host, `${boxId}.json`);
}

/** Canonical serialization of a receipt (sorted keys + trailing newline) — byte-stable. */
export function serializeReceipt(receipt: HostSmokeReceipt): string {
  return `${canonicalize(receipt)}\n`;
}

export interface WriteReceiptResult {
  path: string;
  /** True when the file was (re)written; false when an unchanged, non-stale receipt was left byte-for-byte alone. */
  wrote: boolean;
  reason: string;
}

/**
 * No-churn committed write (ADR §6.3): rewrite ONLY IF the recomputed `smoke_digest`
 * differs from the committed one, OR the committed receipt is already stale. The
 * receipt is expected to be ALREADY scrubbed at construction time (ADR §6.4 — clean
 * before staging); this write path DEFENSIVELY asserts a redaction NO-OP over the
 * serialized bytes and THROWS if any operator-path/secret survived (a leak must never
 * be committed). Serialized canonically so a byte-identical re-capture is byte-stable.
 */
export function writeCommittedReceipt(
  receipt: HostSmokeReceipt,
  opts: { evidenceRoot?: string; stale?: boolean } = {},
): WriteReceiptResult {
  const evidenceRoot = opts.evidenceRoot ?? defaultEvidenceRoot();
  const host = receipt.identity.host_id as HostId;
  const path = receiptPath(host, receipt.identity.box_id, evidenceRoot);

  // Recompute the digest defensively — the write path is authoritative over identity.
  const withDigest: HostSmokeReceipt = { ...receipt, smoke_digest: computeSmokeDigest(receipt.identity) };
  const serialized = serializeReceipt(withDigest);

  // Defensive cleanliness gate (ADR §6.4 / L8 no-op): the serialized receipt MUST be
  // byte-identical after redact() — else a leak slipped past construction-time scrub.
  const red = redact(serialized);
  if (red.opPaths > 0 || red.secrets.length > 0) {
    throw new Error(
      `refusing to commit ${host}/${receipt.identity.box_id}.json — redaction is not a no-op ` +
        `(opPaths=${red.opPaths}, secrets=${red.secrets.length}); scrub at construction time`,
    );
  }

  if (existsSync(path)) {
    const committedRaw = readFileSync(path, "utf8");
    let committed: unknown;
    try {
      committed = JSON.parse(committedRaw);
    } catch {
      committed = null;
    }
    const committedDigest =
      committed && typeof committed === "object" ? (committed as Record<string, unknown>)["smoke_digest"] : undefined;
    // No-churn: identity-equal (digest match) AND not stale → leave byte-for-byte alone.
    if (committedDigest === withDigest.smoke_digest && !opts.stale) {
      return { path, wrote: false, reason: "unchanged non-stale receipt — left byte-for-byte alone (no churn)" };
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serialized);
  return { path, wrote: true, reason: "digest changed / stale / new — written" };
}

export { SMOKE_RECEIPT_SCHEMA };
