import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { buildCompatibilityCatalog } from "../lib/capability/compatibility-catalog";
import { collectCompatibilityUsageWindow, readCompatibilityAsset, writeFrozenCompatibilityCatalog } from "../lib/capability/compatibility-loader";
import { scanReceiptJournal } from "../../src/modules/telemetry";
import { closeRunBinding, mintRunBinding } from "../../src/modules/lifecycle/workflows/run-binding";

function openBinding(projectRoot: string, runId: string): string {
  return mintRunBinding({ root: projectRoot, run_id: runId }).binding_ref;
}

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
      const result = readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "shadow", intent: "mint", synthetic: false, specialistId: entry.id, runId: "run-compat", bindingRef: openBinding(projectRoot, "run-compat"), operationId: "test-read-1" });
      expect(result.status).toBe("loaded");
      const scan = scanReceiptJournal(join(projectRoot, ".guild/runs/run-compat/receipts/journal.jsonl"));
      expect(scan.integrity).toBe("intact");
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0].outcome_type).toBe("guild.capability_outcome.v1");
      expect(scan.records[0].disposition).toBe("degraded");
      expect(result).toEqual(expect.objectContaining({
        status: "loaded",
        receipt_recorded_at: scan.records[0].recorded_at,
      }));
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

  it("derives receipt time itself and refuses a post-close compatibility read", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-closed-"));
    try {
      const pluginRoot = join(__dirname, "../..");
      const entry = buildCompatibilityCatalog({ pluginRoot }).entries.find((candidate) => candidate.kind === "shipped_template")!;
      const runId = "run-closed-compat";
      const bindingRef = openBinding(projectRoot, runId);
      closeRunBinding({ root: projectRoot, run_id: runId });
      jest.useFakeTimers({ now: new Date("2000-01-01T00:00:00.000Z") });
      let result;
      try {
        result = readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId, bindingRef, operationId: "backdate-attempt" });
      } finally { jest.useRealTimers(); }
      expect(result).toEqual(expect.objectContaining({ status: "refused", detail: expect.stringMatching(/binding_closed/) }));
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs", runId, "receipts/journal.jsonl")).integrity).toBe("absent");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  it("fails closed when no shipped manifest can bind the runtime version", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-version-project-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "guild-compat-version-plugin-"));
    try {
      const entry = buildCompatibilityCatalog({ pluginRoot: join(__dirname, "../..") }).entries[0];
      const result = readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-no-version", bindingRef: openBinding(projectRoot, "run-no-version"), operationId: "missing-runtime-version" });
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

  it.each(["missing", "symlink"] as const)("refuses instead of throwing when the runtime producer is %s", (shape) => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-producer-project-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "guild-compat-producer-plugin-"));
    try {
      const canonicalRoot = join(__dirname, "../..");
      const entry = buildCompatibilityCatalog({ pluginRoot: canonicalRoot }).entries[0];
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      mkdirSync(join(pluginRoot, "scripts/lib/capability"), { recursive: true });
      writeFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), JSON.stringify({ version: "2.7.0-beta.2" }));
      if (shape === "symlink") {
        symlinkSync(join(canonicalRoot, "scripts/lib/capability/compatibility-loader.ts"), join(pluginRoot, "scripts/lib/capability/compatibility-loader.ts"));
      }
      const compatibilityPath = join(pluginRoot, entry.path);
      mkdirSync(dirname(compatibilityPath), { recursive: true });
      writeFileSync(compatibilityPath, readFileSync(join(canonicalRoot, entry.path)));

      const bindingRef = openBinding(projectRoot, "run-producer-refusal");
      expect(() => readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-producer-refusal", bindingRef, operationId: `producer-${shape}` })).not.toThrow();
      expect(readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-producer-refusal", bindingRef, operationId: `producer-${shape}` })).toEqual({ status: "refused", detail: "compatibility runtime version is not available from a shipped plugin manifest" });
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs/run-producer-refusal/receipts/journal.jsonl")).integrity).toBe("absent");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  it("prefers a generated package's sole manifest over stale cross-host environment", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "guild-compat-host-project-"));
    const pluginRoot = mkdtempSync(join(tmpdir(), "guild-compat-host-plugin-"));
    const prior = process.env["GUILD_HOST_ID"];
    try {
      const canonicalRoot = join(__dirname, "../..");
      const entry = buildCompatibilityCatalog({ pluginRoot: canonicalRoot }).entries[0];
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      mkdirSync(join(pluginRoot, "scripts/lib/capability"), { recursive: true });
      writeFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), JSON.stringify({ version: "2.7.0-beta.2" }));
      writeFileSync(join(pluginRoot, "scripts/lib/capability/compatibility-loader.ts"), "// runtime producer\n");
      const compatibilityPath = join(pluginRoot, entry.path);
      mkdirSync(dirname(compatibilityPath), { recursive: true });
      writeFileSync(compatibilityPath, readFileSync(join(canonicalRoot, entry.path)));
      process.env["GUILD_HOST_ID"] = "codex-cli";

      const result = readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-stale-host", bindingRef: openBinding(projectRoot, "run-stale-host"), operationId: "stale-host" });
      expect(result.status).toBe("loaded");
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs/run-stale-host/receipts/journal.jsonl")).records[0].versions.host_id).toBe("claude-code-cli");
    } finally {
      if (prior === undefined) delete process.env["GUILD_HOST_ID"]; else process.env["GUILD_HOST_ID"] = prior;
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
      mkdirSync(join(pluginRoot, "scripts/lib/capability"), { recursive: true });
      writeFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ version: "9.8.7-beta.6" }));
      writeFileSync(join(pluginRoot, "scripts/lib/capability/compatibility-loader.ts"), "// runtime producer\n");
      const compatibilityPath = join(pluginRoot, entry.path);
      mkdirSync(dirname(compatibilityPath), { recursive: true });
      writeFileSync(compatibilityPath, readFileSync(join(canonicalRoot, entry.path)));

      const result = readCompatibilityAsset({ pluginRoot, projectRoot, entry, mode: "observe", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-codex-version", bindingRef: openBinding(projectRoot, "run-codex-version"), operationId: "codex-runtime-version" });
      expect(result.status).toBe("loaded");
      const scan = scanReceiptJournal(join(projectRoot, ".guild/runs/run-codex-version/receipts/journal.jsonl"));
      expect(scan.records).toHaveLength(1);
      expect(scan.records[0].versions.host_id).toBe("codex-cli");
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
      expect(readCompatibilityAsset({ pluginRoot, runtimeHost: "claude-code-cli", projectRoot, entry, mode: "strict", intent: "dispatch", synthetic: false, specialistId: null, runId: "run-refused", bindingRef: openBinding(projectRoot, "run-refused"), operationId: "test-refusal" }).status).toBe("refused");
      expect(scanReceiptJournal(join(projectRoot, ".guild/runs/run-refused/receipts/journal.jsonl")).integrity).toBe("absent");
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });
});
