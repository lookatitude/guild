import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { CapabilityResolverMode } from "../../../src/modules/config";
import { appendReceipt, makeReceiptInput, scanReceiptJournal } from "../../../src/modules/telemetry";
import { compatibilityUsageForRead, readCatalogEntry, type CompatibilityCatalog, type CompatibilityCatalogEntry } from "../../../src/modules/capability/workflows/compatibility-catalog";
import { parseCompatibilityUsageV1, rollupCompatibilityUsage, type CompatibilityUsageRollup } from "../../../src/modules/capability/workflows/compatibility-usage";
import type { CapabilityResolutionIntent } from "../../../src/modules/capability/workflows/resolver-mode";
import { checkContained, isRefused, writeContainedFile } from "../../../src/modules/kernel/workflows/path-containment";
import {
  assertWritableBinding,
  withRunBindingExclusion,
} from "../../../src/modules/lifecycle/workflows/run-binding";
import { normalizeHostId } from "../host-id-namespace";
import { hashCompatibilityRuntimeProducer, type MigrationRuntimeHost } from "./migration-evidence";

const PLUGIN_MANIFEST_CANDIDATES: ReadonlyArray<readonly [string, string]> = [
  [".claude-plugin", "plugin.json"],
  [".codex-plugin", "plugin.json"],
];

export function readRuntimeVersion(pluginRoot: string): string | null {
  for (const [dir, file] of PLUGIN_MANIFEST_CANDIDATES) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, dir, file), "utf8")) as {
        version?: string;
      };
      if (typeof manifest.version === "string" && manifest.version.length > 0) {
        return manifest.version;
      }
    } catch {
      // A host package only carries its own manifest shape; try the next one.
    }
  }
  return null;
}

interface RuntimeReceiptIdentity {
  readonly host_id: MigrationRuntimeHost;
  readonly runtime_version: string;
  readonly package_tree: string;
}

/**
 * Bind production compatibility reads to the exact attested host install
 * surface. A generated package has one manifest; a supported source install
 * may carry both and is disambiguated by the declared host (Claude by default).
 */
function runtimeReceiptIdentity(pluginRoot: string, runtimeHost: MigrationRuntimeHost): RuntimeReceiptIdentity | null {
  const expectedDirectory = runtimeHost === "claude-code-cli" ? ".claude-plugin" : ".codex-plugin";
  const manifests = PLUGIN_MANIFEST_CANDIDATES.flatMap(([directory, file]) => {
    if (directory !== expectedDirectory) return [];
    const manifestPath = path.join(pluginRoot, directory, file);
    try {
      const value = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: unknown };
      if (typeof value.version !== "string" || value.version.length === 0) return [];
      const host_id: MigrationRuntimeHost = directory === ".claude-plugin" ? "claude-code-cli" : "codex-cli";
      return [{ host_id, runtime_version: value.version }];
    } catch { return []; }
  });
  if (manifests.length === 0) return null;
  try {
    return { ...manifests[0], package_tree: `sha256:${hashCompatibilityRuntimeProducer(pluginRoot, manifests[0].host_id)}` };
  } catch {
    // A partial, redirected, or otherwise unreadable producer cannot issue a
    // receipt identity. Returning null keeps every caller on its refusal path;
    // throwing here can escape a hook guard whose outermost catch is advisory.
    return null;
  }
}

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
  runtimeHost?: MigrationRuntimeHost;
  projectRoot: string;
  entry: CompatibilityCatalogEntry;
  mode: CapabilityResolverMode;
  intent: CapabilityResolutionIntent;
  synthetic: boolean;
  specialistId: string | null;
  runId: string;
  /** Exact open lifecycle binding threaded by the dispatching host. */
  bindingRef: string;
  /** Caller-owned idempotency key for this concrete read. */
  operationId: string;
}): CompatibilityLoadResult {
  const entry = readCatalogEntry(options.entry);
  if (!entry) return { status: "refused", detail: "invalid compatibility catalog entry" };
  const root = fs.realpathSync(options.pluginRoot);
  const manifestHosts = PLUGIN_MANIFEST_CANDIDATES.flatMap(([directory, file]) => fs.existsSync(path.join(root, directory, file))
    ? [directory === ".claude-plugin" ? "claude-code-cli" as const : "codex-cli" as const]
    : []);
  const declaredHost = [process.env["GUILD_HOST_ID"], process.env["GUILD_ORCHESTRATOR_HOST"], process.env["GUILD_HOST"]]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const normalizedHost = declaredHost === undefined ? null : normalizeHostId(declaredHost);
  // A generated package's sole manifest is stronger evidence than ambient
  // cross-host/stale environment. Source installs carry both manifests and use
  // the canonical host namespace; unknown/prefix-shaped strings never select.
  const inferredHost: MigrationRuntimeHost = manifestHosts.length === 1
    ? manifestHosts[0]
    : normalizedHost === "codex-cli" || normalizedHost === "claude-code-cli"
      ? normalizedHost
      : "claude-code-cli";
  const runtimeHost: MigrationRuntimeHost = options.runtimeHost ?? inferredHost;
  const runtimeIdentity = runtimeReceiptIdentity(root, runtimeHost);
  if (runtimeIdentity === null) {
    return { status: "refused", detail: "compatibility runtime version is not available from a shipped plugin manifest" };
  }
  const target = path.join(root, entry.path);
  try {
    return withRunBindingExclusion(options.projectRoot, options.runId, () => {
      // A compatibility load is a runtime write. The caller must prove it belongs
      // to this still-open run while holding the same exclusion close uses.
      assertWritableBinding({ root: options.projectRoot, run_id: options.runId, binding_ref: options.bindingRef });
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
      const recordedAt = new Date().toISOString();
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
          recorded_at: recordedAt,
          observed_at: recordedAt,
          versions: { host_id: runtimeIdentity.host_id, host_version: "unknown", runtime_version: runtimeIdentity.runtime_version, source_version: runtimeIdentity.package_tree, contract_version: "guild.observability.v1" },
          affected_event_range: null,
        }),
      );
      if (!appended.durable || appended.sequence === null) {
        try { fs.rmSync(payloadPath, { force: true }); } catch { /* refusal below remains authoritative */ }
        return { status: "refused", detail: appended.failure?.message ?? "compatibility receipt was not durable" };
      }
      return { status: "loaded", bytes, payload: emitted.payload, receipt_sequence: appended.sequence };
    });
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
