#!/usr/bin/env -S npx tsx
/**
 * Finalize the metadata-only stable commit after a reviewed `next -> main` PR.
 *
 * `prepare` derives X.Y.Z from the exact X.Y.Z-beta.N version on `next` and
 * changes only the canonical Claude manifest. The workflow then runs the
 * existing generators and changelog command. `verify` fails closed unless the
 * resulting commit changes exactly the six generated release-metadata paths
 * and every version-bearing record agrees on the stable triple.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const BETA_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
const STABLE_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export interface StableReleaseIdentity {
  betaVersion: string;
  stableVersion: string;
  tag: string;
}

export interface StableReleaseVerification {
  stableVersion: string;
  tag: string;
  changedPaths: string[];
}

export function shouldMarkLatest(candidateVersion: string, currentTag: string): boolean {
  if (!STABLE_VERSION_RE.test(candidateVersion)) {
    throw new Error(`candidate version ${JSON.stringify(candidateVersion)} must be exact MAJOR.MINOR.PATCH`);
  }
  if (currentTag === "") return true;
  const currentVersion = currentTag.startsWith("v") ? currentTag.slice(1) : currentTag;
  if (!STABLE_VERSION_RE.test(currentVersion)) {
    return false;
  }
  const candidate = candidateVersion.split(".").map((part) => BigInt(part));
  const current = currentVersion.split(".").map((part) => BigInt(part));
  for (let index = 0; index < candidate.length; index++) {
    if (candidate[index] > current[index]) return true;
    if (candidate[index] < current[index]) return false;
  }
  return false;
}

export function deriveStableVersion(betaVersion: string): string {
  const match = BETA_VERSION_RE.exec(betaVersion);
  if (match === null) {
    throw new Error(`source version ${JSON.stringify(betaVersion)} must be exact MAJOR.MINOR.PATCH-beta.N`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function stableReleaseMetadataPaths(): string[] {
  return [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".codex-plugin/plugin.json",
    ".guild-native-claude-package-identity.json",
    "CHANGELOG.md",
    "guild.inventory.json",
  ];
}

function readRecord(filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function prepareStableManifest(root: string): StableReleaseIdentity {
  const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
  const manifest = readRecord(manifestPath);
  if (typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} has no usable version field`);
  }
  const betaVersion = manifest.version;
  const stableVersion = deriveStableVersion(betaVersion);
  manifest.version = stableVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { betaVersion, stableVersion, tag: `v${stableVersion}` };
}

export function inspectStableManifest(root: string): StableReleaseIdentity {
  const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
  const manifest = readRecord(manifestPath);
  if (typeof manifest.version !== "string") {
    throw new Error(`${manifestPath} has no usable version field`);
  }
  const betaVersion = manifest.version;
  const stableVersion = deriveStableVersion(betaVersion);
  return { betaVersion, stableVersion, tag: `v${stableVersion}` };
}

function assertVersion(actual: unknown, stableVersion: string, label: string): void {
  if (actual !== stableVersion) {
    throw new Error(`${label} carries ${JSON.stringify(actual)}; expected stable version ${stableVersion}`);
  }
}

export function verifyStableReleaseMetadata(
  root: string,
  stableVersion: string,
  changedPaths: string[]
): StableReleaseVerification {
  if (!STABLE_VERSION_RE.test(stableVersion)) {
    throw new Error(`expected version ${JSON.stringify(stableVersion)} must be exact MAJOR.MINOR.PATCH`);
  }

  const expectedPaths = stableReleaseMetadataPaths();
  const actual = [...new Set(changedPaths)].sort();
  const expected = [...expectedPaths].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `stable release commit must change the exact metadata path set; expected ${expected.join(", ")}; ` +
        `found ${actual.join(", ") || "(none)"}`
    );
  }

  const manifest = readRecord(path.join(root, ".claude-plugin", "plugin.json"));
  assertVersion(manifest.version, stableVersion, ".claude-plugin/plugin.json");

  const marketplace = readRecord(path.join(root, ".claude-plugin", "marketplace.json"));
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const marketplaceGuild = plugins.find(
    (entry) => typeof entry === "object" && entry !== null && (entry as Record<string, unknown>).name === "guild"
  ) as Record<string, unknown> | undefined;
  assertVersion(marketplaceGuild?.version, stableVersion, ".claude-plugin/marketplace.json guild entry");

  const codex = readRecord(path.join(root, ".codex-plugin", "plugin.json"));
  assertVersion(codex.version, stableVersion, ".codex-plugin/plugin.json");

  const inventory = readRecord(path.join(root, "guild.inventory.json"));
  assertVersion(inventory.plugin_version, stableVersion, "guild.inventory.json plugin_version");
  const inventoryManifest = inventory.manifest as Record<string, unknown> | undefined;
  assertVersion(inventoryManifest?.version, stableVersion, "guild.inventory.json manifest.version");

  const identity = readRecord(path.join(root, ".guild-native-claude-package-identity.json"));
  assertVersion(identity.release_version, stableVersion, ".guild-native-claude-package-identity.json");

  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const escaped = stableVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`^## \\[${escaped}\\](?:\\s|$)`, "m").test(changelog)) {
    throw new Error(`CHANGELOG.md has no [${stableVersion}] release section`);
  }

  return { stableVersion, tag: `v${stableVersion}`, changedPaths: expectedPaths };
}

function appendGithubOutput(filePath: string, identity: StableReleaseIdentity): void {
  fs.appendFileSync(
    filePath,
    `beta_version=${identity.betaVersion}\nstable_version=${identity.stableVersion}\ntag=${identity.tag}\n`
  );
}

function changedPaths(root: string, base: string, head: string): string[] {
  return execFileSync("git", ["diff", "--name-only", `${base}..${head}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .split("\n")
    .filter(Boolean);
}

export function main(argv: string[] = process.argv.slice(2)): number {
  const mode = argv.shift();
  let root = ".";
  let githubOutput: string | undefined;
  let expectedVersion: string | undefined;
  let base: string | undefined;
  let head = "HEAD";
  let candidateVersion: string | undefined;
  let currentTag: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--root" && argv[index + 1] !== undefined) root = argv[++index];
    else if (arg === "--github-output" && argv[index + 1] !== undefined) githubOutput = argv[++index];
    else if (arg === "--expected-version" && argv[index + 1] !== undefined) expectedVersion = argv[++index];
    else if (arg === "--base" && argv[index + 1] !== undefined) base = argv[++index];
    else if (arg === "--head" && argv[index + 1] !== undefined) head = argv[++index];
    else if (arg === "--candidate-version" && argv[index + 1] !== undefined) candidateVersion = argv[++index];
    else if (arg === "--current-tag" && argv[index + 1] !== undefined) currentTag = argv[++index];
    else {
      process.stderr.write(`finalize-stable-release: unknown or incomplete argument ${JSON.stringify(arg)}\n`);
      return 1;
    }
  }

  try {
    if (mode === "inspect" || mode === "prepare") {
      const result = mode === "prepare" ? prepareStableManifest(root) : inspectStableManifest(root);
      if (githubOutput !== undefined) appendGithubOutput(githubOutput, result);
      process.stdout.write(JSON.stringify(result) + "\n");
      return 0;
    }
    if (mode === "verify") {
      if (expectedVersion === undefined || base === undefined) {
        throw new Error("verify requires --expected-version and --base");
      }
      const result = verifyStableReleaseMetadata(root, expectedVersion, changedPaths(root, base, head));
      process.stdout.write(JSON.stringify(result) + "\n");
      return 0;
    }
    if (mode === "latest") {
      if (candidateVersion === undefined || currentTag === undefined) {
        throw new Error("latest requires --candidate-version and --current-tag");
      }
      const latest = shouldMarkLatest(candidateVersion, currentTag);
      if (githubOutput !== undefined) fs.appendFileSync(githubOutput, `latest=${latest}\n`);
      process.stdout.write(JSON.stringify({ candidateVersion, currentTag: currentTag || null, latest }) + "\n");
      return 0;
    }
    throw new Error("mode must be inspect, prepare, verify, or latest");
  } catch (error) {
    process.stderr.write(`finalize-stable-release: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (require.main === module) process.exit(main());
