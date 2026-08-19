import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildCompatibilityCatalog } from "../lib/capability/compatibility-catalog";
import { collectCompatibilityUsageWindow, readCompatibilityAsset, writeFrozenCompatibilityCatalog } from "../lib/capability/compatibility-loader";
import { scanReceiptJournal } from "../../src/modules/telemetry";

describe("instrumented compatibility loader", () => {
  it("freezes only the complete attributed deprecated catalog and never overwrites drift", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-freeze-"));
    try {
      const pluginRoot = join(__dirname, "../..");
      const catalog = buildCompatibilityCatalog({ pluginRoot, deprecation: "deprecated", deprecatedBy: "cap-loc-D03" });
      const target = writeFrozenCompatibilityCatalog(projectRoot, catalog);
      expect(existsSync(target)).toBe(true);
      expect(writeFrozenCompatibilityCatalog(projectRoot, catalog)).toBe(target);
      expect(() => writeFrozenCompatibilityCatalog(projectRoot, buildCompatibilityCatalog({ pluginRoot }))).toThrow(/complete/);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });
  it("reads catalog-pinned bytes only after a durable MH-06 receipt", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-load-"));
    try {
      const pluginRoot = join(__dirname, "../..");
      const catalog = buildCompatibilityCatalog({ pluginRoot, deprecation: "deprecated", deprecatedBy: "cap-loc-D03" });
      const entry = catalog.entries.find((candidate) => candidate.kind === "shipped_template")!;
      const result = readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "shadow", intent: "mint", synthetic: false, specialistId: entry.id, runId: "run-compat", operationId: "test-read-1", recordedAt: "2026-08-10T00:00:00Z" });
      expect(result.status).toBe("loaded");
      const scan = scanReceiptJournal(join(projectRoot, ".guild/runs/run-compat/receipts/journal.jsonl"));
      expect(scan.integrity).toBe("intact");
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0].outcome_type).toBe("guild.capability_outcome.v1");
      expect(scan.records[0].disposition).toBe("degraded");
      const canonicalVersion = JSON.parse(
        readFileSync(join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"),
      ).version;
      expect(scan.records[0].versions.runtime_version).toBe(canonicalVersion);
      expect(readdirSync(join(projectRoot, ".guild/runs/run-compat/receipts/payloads"))).toHaveLength(1);
      const rollup = collectCompatibilityUsageWindow({ projectRoot, runIds: ["run-compat"], windowStartRelease: "2.6.0", windowEndRelease: "2.6.0", knownAssetIds: [entry.id] });
      expect(rollup.unreadable).toBe(0);
      expect(rollup.observed_asset_ids).toEqual([entry.id]);
      expect(rollup.total_dependence_reads).toBe(0);
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("fails closed when no shipped manifest can bind the runtime version", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-version-project-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "guild-compat-version-plugin-"));
    try {
      const entry = buildCompatibilityCatalog({ pluginRoot: join(__dirname, "../..") }).entries[0];
      const result = readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-no-version", operationId: "missing-runtime-version", recordedAt: "2026-08-19T00:00:00Z" });
      expect(result).toEqual({
        status: "refused",
        detail: "compatibility runtime version is not available from a shipped plugin manifest",
      });
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs/run-no-version/receipts/journal.jsonl")).integrity).toBe("absent");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("binds receipts to a Codex-only shipped manifest version", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-codex-project-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "guild-compat-codex-plugin-"));
    try {
      const canonicalRoot = join(__dirname, "../..");
      const entry = buildCompatibilityCatalog({ pluginRoot: canonicalRoot }).entries[0];
      mkdirSync(join(pluginRoot, ".codex-plugin"), { recursive: true });
      writeFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "9.8.7-beta.6" }));
      const compatibilityPath = join(pluginRoot, entry.path);
      mkdirSync(dirname(compatibilityPath), { recursive: true });
      writeFileSync(compatibilityPath, readFileSync(join(canonicalRoot, entry.path)));

      const result = readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-codex-version", operationId: "codex-runtime-version", recordedAt: "2026-08-19T00:00:00Z" });
      expect(result.status).toBe("loaded");
      const scan = scanReceiptJournal(join(projectRoot, ".guild/runs/run-codex-version/receipts/journal.jsonl"));
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0].versions.runtime_version).toBe("9.8.7-beta.6");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("refuses a read whose mode does not permit the intent and writes no receipt", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-load-"));
    try {
      const pluginRoot = join(__dirname, "../..");
      const entry = buildCompatibilityCatalog({ pluginRoot }).entries[0];
      expect(readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "strict", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-refused", operationId: "test-refusal", recordedAt: "2026-08-10T00:00:00Z" }).status).toBe("refused");
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs/run-refused/receipts/journal.jsonl")).integrity).toBe("absent");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });
});
