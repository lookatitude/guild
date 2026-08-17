import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { appendReceipt, makeReceiptInput, scanReceiptJournal } from "../../../src/modules/telemetry";
import { compatibilityUsageForRead, readCatalogEntry, type CompatibilityCatalog, type CompatibilityCatalogEntry } from "../../../src/modules/capability/workflows/compatibility-catalog";
import { parseCompatibilityUsageV1, rollupCompatibilityUsage, type CompatibilityUsageRollup } from "../../../src/modules/capability/workflows/compatibility-usage";
import type { CapabilityResolutionIntent } from "../../../src/modules/capability/workflows/resolver-mode";
import { checkContained, isRefused, writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";

export type CompatibilityLoadResult =
  | { status: "loaded"; bytes: Buffer; payload: unknown; receipt_sequence: number }
  | { status: "refused"; detail: string };

export const FROZEN_COMPATIBILITY_CATALOG_RELPATH = ".guild/artifacts/capability/compatibility-catalog.json";

/** Persist the observe-phase catalog as an immutable reviewable project artifact. */
export function writeFrozenCompatibilityCatalog(projectRoot: string, catalog: CompatibilityCatalog): string {
  if (!catalog.census_matches || catalog.entries.length === 0 || catalog.entries.some((entry) => entry.deprecation !== "deprecated" || !entry.deprecated_by)) {
    throw new Error("only a complete, attributed, deprecated compatibility catalog can be frozen");
  }
  const root = fs.realpathSync(projectRoot);
  const target = path.join(root, FROZEN_COMPATIBILITY_CATALOG_RELPATH);
  const proposed = Buffer.from(`${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  if (fs.existsSync(target)) {
    if (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isFile()) throw new Error("compatibility catalog target is not a regular file");
    if (!fs.readFileSync(target).equals(proposed)) throw new Error("frozen compatibility catalog already exists with different bytes");
    return target;
  }
  const written = writeContainedFile(root, target, proposed, { policy: "physical" });
  if (!written.written) throw new Error(`compatibility catalog write refused [${written.code}]: ${written.detail}`);
  return written.realPath ?? target;
}

/** The sole production loader for shipped templates/domain skills during migration. */
export function readCompatibilityAsset(options: {
  pluginRoot: string;
  projectRoot: string;
  entry: CompatibilityCatalogEntry;
  mode: CapabilityResolverMode;
  intent: CapabilityResolutionIntent;
  synthetic: boolean;
  specialistId: string | null;
  runId: string;
  /** Caller-owned idempotency key for this concrete read. */
  operationId: string;
  recordedAt: string;
}): CompatibilityLoadResult {
  const entry = readCatalogEntry(options.entry);
  if (!entry) return { status: "refused", detail: "invalid compatibility catalog entry" };
  const root = fs.realpathSync(options.pluginRoot);
  const target = path.join(root, entry.path);
  try {
    const contained = checkContained(root, target, { policy: "physical", requireRegularFileLeaf: true });
    if (isRefused(contained)) return { status: "refused", detail: `compatibility asset refused [${contained.code}]` };
    const bytes = fs.readFileSync(contained.realPath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== entry.content_hash) return { status: "refused", detail: "compatibility asset bytes do not match the catalog" };
    const emitted = compatibilityUsageForRead({ entry, mode: options.mode, intent: options.intent, synthetic: options.synthetic, specialist_id: options.specialistId });
    if (emitted.status !== "ok") return { status: "refused", detail: emitted.detail };
    const payloadBytes = Buffer.from(`${JSON.stringify(emitted.payload, null, 2)}\n`, "utf8");
    const payloadHash = createHash("sha256").update(payloadBytes).digest("hex");
    const receipts = path.join(path.resolve(options.projectRoot), ".guild", "runs", options.runId, "receipts");
    const safeOperation = options.operationId.replace(/[^a-zA-Z0-9._-]/g, "-");
    if (!safeOperation || safeOperation.length > 160) return { status: "refused", detail: "operationId is not a bounded identity" };
    const payloadRel = path.posix.join("payloads", `${safeOperation}-${payloadHash.slice(0, 16)}.compatibility-usage.json`);
    const payloadPath = path.join(receipts, payloadRel);
    if (fs.existsSync(payloadPath)) {
      if (!fs.lstatSync(payloadPath).isFile() || !fs.readFileSync(payloadPath).equals(payloadBytes)) return { status: "refused", detail: "compatibility payload identity collision" };
    } else {
      const written = writeContainedFile(options.projectRoot, payloadPath, payloadBytes, { policy: "physical" });
      if (!written.written) return { status: "refused", detail: `compatibility payload write refused [${written.code}]: ${written.detail}` };
    }
    const appended = appendReceipt(
      { journal: path.join(receipts, "journal.jsonl"), checkpoint: path.join(receipts, "checkpoint.json") },
      makeReceiptInput({
        run_id: options.runId,
        operation_id: `compatibility-read:${options.operationId}`,
        correlation_id: `compatibility-read:${options.operationId}`,
        event_id: `compatibility-read:${options.operationId}:${payloadHash.slice(0, 12)}`,
        causation_id: null,
        scenario_id: "PCL-09",
        event_name: "task.dispatch",
        outcome_type: "guild.capability_outcome.v1",
        disposition: "degraded",
        observation_state: "checked_clean",
        input_hash: actual,
        output_hash: payloadHash,
        terminal: false,
        recorded_at: options.recordedAt,
        observed_at: options.recordedAt,
        versions: { host_id: "local", host_version: "unknown", runtime_version: "2.6.0", source_version: "guild.compatibility_catalog.v1", contract_version: "guild.observability.v1" },
        affected_event_range: null,
      }),
    );
    if (!appended.durable || appended.sequence === null) {
      try { fs.rmSync(payloadPath, { force: true }); } catch { /* refusal below remains authoritative */ }
      return { status: "refused", detail: appended.failure?.message ?? "compatibility receipt was not durable" };
    }
    return { status: "loaded", bytes, payload: emitted.payload, receipt_sequence: appended.sequence };
  } catch (error) {
    return { status: "refused", detail: error instanceof Error ? error.message : String(error) };
  }
}

export function collectCompatibilityUsageWindow(options: {
  projectRoot: string;
  runIds: readonly string[];
  windowStartRelease: string;
  windowEndRelease: string;
  knownAssetIds: readonly string[];
}): CompatibilityUsageRollup {
  const records = [];
  let unreadable = 0;
  for (const runId of options.runIds) {
    if (!/^run-[a-zA-Z0-9._-]+$/.test(runId)) {
      return rollupCompatibilityUsage({ window_start_release: options.windowStartRelease, window_end_release: options.windowEndRelease, known_asset_ids: options.knownAssetIds, records: [], unreadable: 1 });
    }
    const receipts = path.join(path.resolve(options.projectRoot), ".guild", "runs", runId, "receipts");
    const scan = scanReceiptJournal(path.join(receipts, "journal.jsonl"));
    unreadable += scan.rejected.length + (scan.blocks_clean_close && scan.integrity !== "absent" ? 1 : 0);
    for (const receipt of scan.records) {
      if (receipt.scenario_id !== "PCL-09" || !receipt.operation_id.startsWith("compatibility-read:")) continue;
      const payloadDir = path.join(receipts, "payloads");
      let matched = false;
      try {
        for (const name of fs.readdirSync(payloadDir)) {
          if (!name.endsWith(".compatibility-usage.json")) continue;
          const candidate = path.join(payloadDir, name);
          if (fs.lstatSync(candidate).isSymbolicLink() || !fs.lstatSync(candidate).isFile()) continue;
          const bytes = fs.readFileSync(candidate);
          if (createHash("sha256").update(bytes).digest("hex") !== receipt.output_hash) continue;
          const parsed = parseCompatibilityUsageV1(JSON.parse(bytes.toString("utf8")));
          if (parsed) records.push(parsed);
          else unreadable += 1;
          matched = true;
          break;
        }
      } catch { /* counted below */ }
      if (!matched) unreadable += 1;
    }
  }
  return rollupCompatibilityUsage({
    window_start_release: options.windowStartRelease,
    window_end_release: options.windowEndRelease,
    known_asset_ids: options.knownAssetIds,
    records,
    unreadable,
  });
}
