import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  deriveStableVersion,
  inspectStableManifest,
  prepareStableManifest,
  shouldMarkLatest,
  stableReleaseMetadataPaths,
  verifyStableReleaseMetadata,
} from "../finalize-stable-release";

function tempRoot(version = "2.7.0-beta.20", derivedVersion = "2.7.0"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-stable-release-"));
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "guild", version }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "marketplace.json"),
    JSON.stringify({ plugins: [{ name: "guild", version: derivedVersion }] }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "guild", version: derivedVersion }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, "guild.inventory.json"),
    JSON.stringify({ plugin_version: derivedVersion, manifest: { name: "guild", version: derivedVersion } }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(root, ".guild-native-claude-package-identity.json"),
    JSON.stringify({ release_version: derivedVersion, payload_digest: `sha256:${"a".repeat(64)}` }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), `## [${derivedVersion}]\n`);
  return root;
}

describe("stable release finalization", () => {
  it("derives the bare stable triple only from an exact beta version", () => {
    expect(deriveStableVersion("2.7.0-beta.20")).toBe("2.7.0");
    for (const invalid of ["2.7.0", "2.7.0-rc.1", "2.7.0-beta", "v2.7.0-beta.20"]) {
      expect(() => deriveStableVersion(invalid)).toThrow(/MAJOR\.MINOR\.PATCH-beta\.N/);
    }
  });

  it("prepare changes only the canonical manifest and returns a stable tag", () => {
    const root = tempRoot("2.7.0-beta.20", "2.7.0-beta.20");
    const result = prepareStableManifest(root);
    expect(result).toEqual({ betaVersion: "2.7.0-beta.20", stableVersion: "2.7.0", tag: "v2.7.0" });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version).toBe("2.7.0");
    expect(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "marketplace.json"), "utf8")).plugins[0].version).toBe("2.7.0-beta.20");
  });

  it("inspect derives the identity without mutating the beta manifest", () => {
    const root = tempRoot();
    expect(inspectStableManifest(root)).toEqual({
      betaVersion: "2.7.0-beta.20",
      stableVersion: "2.7.0",
      tag: "v2.7.0",
    });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version).toBe(
      "2.7.0-beta.20"
    );
  });

  it("defines the complete and exact metadata-only release commit", () => {
    expect(stableReleaseMetadataPaths()).toEqual([
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
      ".codex-plugin/plugin.json",
      ".guild-native-claude-package-identity.json",
      "CHANGELOG.md",
      "guild.inventory.json",
    ]);
  });

  it("accepts fully propagated stable metadata and rejects missing, extra, or drifted output", () => {
    const root = tempRoot();
    prepareStableManifest(root);
    const exact = stableReleaseMetadataPaths();
    expect(verifyStableReleaseMetadata(root, "2.7.0", exact)).toEqual({
      stableVersion: "2.7.0",
      tag: "v2.7.0",
      changedPaths: exact,
    });
    expect(() => verifyStableReleaseMetadata(root, "2.7.0", exact.slice(1))).toThrow(/exact metadata path set/);
    expect(() => verifyStableReleaseMetadata(root, "2.7.0", [...exact, "src/index.ts"])).toThrow(/exact metadata path set/);
    const inventory = JSON.parse(fs.readFileSync(path.join(root, "guild.inventory.json"), "utf8"));
    inventory.manifest.version = "2.7.0-beta.20";
    fs.writeFileSync(path.join(root, "guild.inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
    expect(() => verifyStableReleaseMetadata(root, "2.7.0", exact)).toThrow(/guild\.inventory\.json/);
  });

  it("refuses stable metadata when the generated changelog section is missing", () => {
    const root = tempRoot();
    prepareStableManifest(root);
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# Changelog\n");
    expect(() => verifyStableReleaseMetadata(root, "2.7.0", stableReleaseMetadataPaths())).toThrow(
      /CHANGELOG\.md has no \[2\.7\.0\]/
    );
  });

  it("marks only a strictly newer stable version as Latest", () => {
    expect(shouldMarkLatest("2.7.0", "")).toBe(true);
    expect(shouldMarkLatest("2.7.0", "v2.6.9")).toBe(true);
    expect(shouldMarkLatest("2.7.0", "v2.7.0")).toBe(false);
    expect(shouldMarkLatest("2.7.0", "v2.8.0")).toBe(false);
    expect(() => shouldMarkLatest("2.7.0-beta.20", "v2.6.0")).toThrow(/candidate version/);
    expect(shouldMarkLatest("2.7.0", "latest")).toBe(false);
  });
});
