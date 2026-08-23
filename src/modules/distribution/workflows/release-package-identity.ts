/**
 * Complete generated-package identity for cross-host local activation.
 *
 * Module-resource manifests prove the authored projection, but generated host
 * packages also contain launchers, manifests, templates, MCP configuration,
 * package metadata, and vendored runtime dependencies. This contract hashes
 * every shipped physical file in every generated package (excluding only this
 * identity file and narrowly enumerated host-managed install/cache metadata),
 * then gives every package the same release-wide digest map. A launcher can
 * therefore prove both its own complete package and the selected Claude package
 * came from one build, without trusting version strings alone.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const RELEASE_PACKAGE_IDENTITY_FILE = ".guild-release-identity.json" as const;
export const RELEASE_PACKAGE_IDENTITY_SCHEMA = "guild.release_package_identity.v1" as const;
export const RELEASE_PACKAGE_INSTALL_RECEIPT_FILE = "guild-install-receipt.json" as const;
export const NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE = ".guild-native-claude-package-identity.json" as const;
export const NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA = "guild.native_claude_package_identity.v1" as const;

export const RELEASE_PACKAGE_NAMES = Object.freeze([
  "agents",
  "antigravity",
  "claude-code",
  "codex",
  "cursor",
  "github-copilot",
  "opencode",
  "pi",
  "rovo-dev",
] as const);

/**
 * Runtime packages copied from scripts/node_modules into every generated host
 * package. They are intentionally gitignored, so a source-commit claim must
 * bind their complete physical trees separately from Git cleanliness.
 */
export const LOCKED_SCRIPT_RUNTIME_DIGESTS = Object.freeze({
  "js-yaml": "sha256:aed429d107470e399343ecdab88c44e948c3e2dcc0eb8f60c86649ce399feda9",
  argparse: "sha256:0e9075c2cc084f6926b4259cd3d8f0157a78b869d5c38601f21d6dc9ae77d281",
} as const);

export type ReleasePackageName = (typeof RELEASE_PACKAGE_NAMES)[number];

export interface ReleasePackageIdentityV1 {
  schema_version: typeof RELEASE_PACKAGE_IDENTITY_SCHEMA;
  release_version: string;
  release_id: string;
  source_commit: string | null;
  current_package: ReleasePackageName;
  package_digests: Record<string, string>;
  native_claude_payload_digest: string;
}

export interface NativeClaudePackageIdentityV1 {
  schema_version: typeof NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA;
  release_version: string;
  payload_digest: string;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function physicalRoot(candidate: string): string {
  if (!path.isAbsolute(candidate)) throw new Error("release package root is not absolute");
  const stats = fs.lstatSync(candidate);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("release package root is not a physical directory");
  }
  return fs.realpathSync(candidate);
}

function readPhysicalFileEntry(filePath: string, label: string): { content: Buffer; mode: number } {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a physical regular file`);
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const current = fs.fstatSync(descriptor);
    if (!current.isFile()) throw new Error(`${label} changed type`);
    return { content: fs.readFileSync(descriptor), mode: current.mode };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readPhysicalFile(filePath: string, label: string): Buffer {
  return readPhysicalFileEntry(filePath, label).content;
}

function normalizedRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function updateDigestWithFile(
  digest: ReturnType<typeof createHash>,
  relativePath: string,
  absolutePath: string,
  executableOverride?: boolean,
): void {
  const physical = readPhysicalFileEntry(absolutePath, `package file ${relativePath}`);
  digest.update("file\0");
  digest.update(normalizedRelativePath(relativePath));
  digest.update("\0");
  digest.update((executableOverride ?? ((physical.mode & 0o111) !== 0)) ? "1" : "0");
  digest.update("\0");
  digest.update(String(physical.content.length));
  digest.update("\0");
  digest.update(physical.content);
  digest.update("\0");
}

export interface ReleasePackageDigestOptions {
  /**
   * Ignore only root metadata written by supported host plugin managers after
   * the immutable payload is copied. Never enable this for dependency trees.
   */
  ignoreHostManagedMetadata?: boolean;
}

function isHostManagedPackageMetadata(relativePath: string): boolean {
  const normalized = normalizedRelativePath(relativePath);
  return normalized === ".codex-marketplace-install.json" ||
    normalized === ".in_use" ||
    normalized.startsWith(".in_use/");
}

function assertNoHostManagedMetadataAtEmission(root: string): void {
  for (const name of [".codex-marketplace-install.json", ".in_use"] as const) {
    try {
      fs.lstatSync(path.join(root, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw new Error(`generated package contains reserved host-managed metadata: ${name}`);
  }
}

/** Hash every included physical file path, executable bit, size, and byte. */
export function computeReleasePackageDigest(
  packageRoot: string,
  options: ReleasePackageDigestOptions = {},
): string {
  const root = physicalRoot(packageRoot);
  const digest = createHash("sha256");

  const visit = (directory: string, relativeDirectory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      // Both files are post-digest metadata: the identity is self-referential,
      // while install.sh writes the receipt after copying the immutable package.
      // Neither is executable runtime; every shipped runtime byte remains bound.
      if (
        relativePath === RELEASE_PACKAGE_IDENTITY_FILE ||
        relativePath === RELEASE_PACKAGE_INSTALL_RECEIPT_FILE ||
        (options.ignoreHostManagedMetadata === true && isHostManagedPackageMetadata(relativePath))
      ) continue;
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
        throw new Error(`release package contains a symlink: ${normalizedRelativePath(relativePath)}`);
      }
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !stats.isFile()) {
        throw new Error(`release package contains a non-regular entry: ${normalizedRelativePath(relativePath)}`);
      }
      updateDigestWithFile(digest, relativePath, absolutePath);
    }
  };

  visit(root, "");
  return `sha256:${digest.digest("hex")}`;
}

/**
 * Hash the exact Git-tracked native Claude marketplace payload. Claude's
 * marketplace cache materializes this tracked tree byte-for-byte but omits
 * `.git`; ignored development dependencies and build output are deliberately
 * absent from the claim.
 */
export function computeTrackedNativeClaudePayloadDigest(pluginRoot: string): string {
  const root = physicalRoot(pluginRoot);
  const tracked = execFileSync("git", ["-C", root, "ls-files", "--stage", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).split("\0").filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const metadata = tab < 0 ? [] : entry.slice(0, tab).split(" ");
      const relativePath = tab < 0 ? "" : entry.slice(tab + 1);
      const mode = metadata[0];
      const stage = metadata[2];
      if ((mode !== "100644" && mode !== "100755") || stage !== "0" || relativePath.length === 0) {
        throw new Error(`native Claude tracked entry is not a regular stage-0 file: ${entry}`);
      }
      return { relativePath, executable: mode === "100755" };
    })
    .filter(({ relativePath }) => normalizedRelativePath(relativePath) !== NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE)
    .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  if (tracked.length === 0) throw new Error("native Claude payload has no tracked files");
  const digest = createHash("sha256");
  for (const { relativePath, executable } of tracked) {
    if (path.isAbsolute(relativePath) || relativePath.split(path.sep).includes("..")) {
      throw new Error(`native Claude tracked path is unsafe: ${relativePath}`);
    }
    updateDigestWithFile(digest, relativePath, path.join(root, relativePath), executable);
  }
  return `sha256:${digest.digest("hex")}`;
}

/**
 * Hash a materialized native Claude cache. The committed identity plus narrowly
 * enumerated root metadata written by Claude/Codex/Git are excluded. Runtime
 * lookalikes at any nested path, ignored dependencies, build output, and every
 * other planted extra still refuse.
 */
export function computePhysicalNativeClaudePayloadDigest(packageRoot: string): string {
  const root = physicalRoot(packageRoot);
  const digest = createHash("sha256");
  const files: Array<{ relativePath: string; absolutePath: string }> = [];
  const visit = (directory: string, relativeDirectory: string): void => {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      const normalized = normalizedRelativePath(relativePath);
      if (
        normalized === NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE ||
        normalized === RELEASE_PACKAGE_INSTALL_RECEIPT_FILE ||
        normalized === ".codex-marketplace-install.json" ||
        normalized === ".in_use" ||
        normalized.startsWith(".in_use/")
      ) continue;
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath);
      if (normalized === ".git") {
        if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
          throw new Error("native Claude package root .git metadata is not physical");
        }
        if (entry.isDirectory() && stats.isDirectory()) continue;
        if (entry.isFile() && stats.isFile()) {
          const pointer = fs.readFileSync(absolutePath, "utf8").match(/^gitdir:\s*(.+?)\s*$/);
          if (!pointer) {
            throw new Error("native Claude package root .git metadata is not a valid worktree pointer");
          }
          const pointerPath = path.resolve(root, pointer[1]);
          const pointerStats = fs.lstatSync(pointerPath);
          if (pointerStats.isSymbolicLink() || !pointerStats.isDirectory()) {
            throw new Error("native Claude package root .git worktree target is not a physical directory");
          }
          continue;
        }
        throw new Error("native Claude package root .git metadata is not physical");
      }
      if (normalized === "scripts/node_modules") {
        assertLockedNativeScriptRuntimeClosure(root);
        continue;
      }
      if (entry.isSymbolicLink() || stats.isSymbolicLink()) {
        throw new Error(`native Claude package contains a symlink: ${normalized}`);
      }
      if (entry.isDirectory() && stats.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !stats.isFile()) {
        throw new Error(`native Claude package contains a non-regular entry: ${normalized}`);
      }
      files.push({ relativePath, absolutePath });
    }
  };
  visit(root, "");
  for (const file of files.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)) {
    updateDigestWithFile(digest, file.relativePath, file.absolutePath);
  }
  return `sha256:${digest.digest("hex")}`;
}

function parseNativeClaudeIdentity(raw: Buffer): NativeClaudePackageIdentityV1 {
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("native Claude package identity is not an object");
  }
  const record = parsed as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(record).sort()) !==
      JSON.stringify(["payload_digest", "release_version", "schema_version"]) ||
    record["schema_version"] !== NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA ||
    typeof record["release_version"] !== "string" || record["release_version"].length === 0 ||
    typeof record["payload_digest"] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record["payload_digest"])
  ) {
    throw new Error("native Claude package identity has an invalid shape");
  }
  return {
    schema_version: NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
    release_version: record["release_version"] as string,
    payload_digest: record["payload_digest"] as string,
  };
}

export function writeNativeClaudePackageIdentity(
  pluginRoot: string,
  releaseVersion: string,
): NativeClaudePackageIdentityV1 {
  if (releaseVersion.length === 0) throw new Error("native Claude release version is empty");
  const root = physicalRoot(pluginRoot);
  const identity: NativeClaudePackageIdentityV1 = {
    schema_version: NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
    release_version: releaseVersion,
    payload_digest: computeTrackedNativeClaudePayloadDigest(root),
  };
  fs.writeFileSync(
    path.join(root, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
    `${JSON.stringify(identity, null, 2)}\n`,
    { mode: 0o644 },
  );
  return identity;
}

export function assertNativeClaudePackageIdentityCurrent(
  pluginRoot: string,
  releaseVersion: string,
): NativeClaudePackageIdentityV1 {
  const root = physicalRoot(pluginRoot);
  const identity = parseNativeClaudeIdentity(readPhysicalFile(
    path.join(root, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
    "native Claude package identity",
  ));
  if (identity.release_version !== releaseVersion) {
    throw new Error("native Claude package identity version is stale");
  }
  if (identity.payload_digest !== computeTrackedNativeClaudePayloadDigest(root)) {
    throw new Error("native Claude package identity payload digest is stale");
  }
  return identity;
}

export function readVerifiedNativeClaudePackageIdentity(
  packageRoot: string,
): NativeClaudePackageIdentityV1 {
  const root = physicalRoot(packageRoot);
  const identity = parseNativeClaudeIdentity(readPhysicalFile(
    path.join(root, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
    "native Claude package identity",
  ));
  if (computePhysicalNativeClaudePayloadDigest(root) !== identity.payload_digest) {
    throw new Error("native Claude complete payload digest differs");
  }
  if (manifestVersion(root, "claude-code") !== identity.release_version) {
    throw new Error("native Claude manifest version does not match package identity");
  }
  return identity;
}

/** Fail closed unless every ignored executable build/runtime dependency is pinned. */
export function assertLockedScriptRuntimeDependencies(pluginRoot: string): void {
  const root = physicalRoot(pluginRoot);
  for (const [dependency, expectedDigest] of Object.entries(LOCKED_SCRIPT_RUNTIME_DIGESTS)) {
    const dependencyRoot = path.join(root, "scripts", "node_modules", dependency);
    let actualDigest: string;
    try {
      actualDigest = computeReleasePackageDigest(dependencyRoot);
    } catch (error) {
      throw new Error(`locked script runtime dependency cannot be verified for ${dependency}: ${String(error)}`);
    }
    if (actualDigest !== expectedDigest) {
      throw new Error(`locked script runtime dependency digest differs for ${dependency}`);
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function parsePhysicalJson(filePath: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readPhysicalFile(filePath, label).toString("utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid: ${String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} is not an object`);
  }
  return parsed as Record<string, unknown>;
}

/**
 * Accept the one ignored tree a documented native Claude marketplace install
 * may add after Git materialization: `npm install --omit=dev` for scripts/.
 * The closure is not trusted by pathname. Its two dependency trees must match
 * reviewed digests, npm's hidden lock must be the exact production projection
 * of the tracked package lock, and the sole executable shim must be the
 * expected relative link into that verified closure. Everything else refuses.
 */
function assertLockedNativeScriptRuntimeClosure(pluginRoot: string): void {
  const root = physicalRoot(pluginRoot);
  const nodeModules = path.join(root, "scripts", "node_modules");
  const nodeModulesStats = fs.lstatSync(nodeModules);
  if (nodeModulesStats.isSymbolicLink() || !nodeModulesStats.isDirectory()) {
    throw new Error("locked native script runtime root is not a physical directory");
  }
  const expectedRootEntries = [".bin", ".package-lock.json", ...Object.keys(LOCKED_SCRIPT_RUNTIME_DIGESTS)]
    .sort();
  const actualRootEntries = fs.readdirSync(nodeModules).sort();
  if (canonicalJson(actualRootEntries) !== canonicalJson(expectedRootEntries)) {
    throw new Error("locked native script runtime contains an unexpected or missing root entry");
  }

  assertLockedScriptRuntimeDependencies(root);

  const sourceLock = parsePhysicalJson(
    path.join(root, "scripts", "package-lock.json"),
    "tracked scripts package lock",
  );
  const installedLock = parsePhysicalJson(
    path.join(nodeModules, ".package-lock.json"),
    "installed scripts package lock",
  );
  const expectedLockKeys = ["lockfileVersion", "name", "packages", "requires"].sort();
  if (canonicalJson(Object.keys(installedLock).sort()) !== canonicalJson(expectedLockKeys)) {
    throw new Error("installed scripts package lock has an invalid shape");
  }
  const sourcePackages = sourceLock["packages"];
  const installedPackages = installedLock["packages"];
  if (
    sourceLock["name"] !== installedLock["name"] ||
    sourceLock["lockfileVersion"] !== installedLock["lockfileVersion"] ||
    sourceLock["requires"] !== installedLock["requires"] ||
    sourcePackages === null || typeof sourcePackages !== "object" || Array.isArray(sourcePackages) ||
    installedPackages === null || typeof installedPackages !== "object" || Array.isArray(installedPackages)
  ) {
    throw new Error("installed scripts package lock differs from the tracked lock metadata");
  }
  const expectedPackages = Object.fromEntries(
    Object.keys(LOCKED_SCRIPT_RUNTIME_DIGESTS).sort().map((dependency) => {
      const packagePath = `node_modules/${dependency}`;
      const entry = (sourcePackages as Record<string, unknown>)[packagePath];
      if (entry === undefined) {
        throw new Error(`tracked scripts package lock is missing ${dependency}`);
      }
      return [packagePath, entry];
    }),
  );
  if (canonicalJson(installedPackages) !== canonicalJson(expectedPackages)) {
    throw new Error("installed scripts package lock is not the exact production projection");
  }

  const binRoot = path.join(nodeModules, ".bin");
  const binStats = fs.lstatSync(binRoot);
  if (binStats.isSymbolicLink() || !binStats.isDirectory()) {
    throw new Error("locked native script runtime .bin is not a physical directory");
  }
  const binEntries = fs.readdirSync(binRoot);
  if (binEntries.length !== 1 || binEntries[0] !== "js-yaml") {
    throw new Error("locked native script runtime .bin contains an unexpected or missing entry");
  }
  const shimPath = path.join(binRoot, "js-yaml");
  const shimStats = fs.lstatSync(shimPath);
  if (!shimStats.isSymbolicLink() || fs.readlinkSync(shimPath) !== "../js-yaml/bin/js-yaml.js") {
    throw new Error("locked native script runtime js-yaml shim is invalid");
  }
  const shimTarget = path.resolve(binRoot, fs.readlinkSync(shimPath));
  const expectedTarget = path.join(nodeModules, "js-yaml", "bin", "js-yaml.js");
  if (shimTarget !== expectedTarget) {
    throw new Error("locked native script runtime js-yaml shim escapes its verified dependency");
  }
  readPhysicalFile(expectedTarget, "locked native script runtime js-yaml target");
}

export function computeReleaseIdentityId(
  releaseVersion: string,
  packageDigests: Record<string, string>,
  sourceCommit: string | null = null,
  nativeClaudePayloadDigest: string | null = null,
): string {
  // Claude and Codex are deterministic release anchors: their generated
  // manifests intentionally carry no render timestamp. Several degraded host
  // manifests do carry `_rendered_at`, so hashing the complete nine-package map
  // here made the same release receive a different id on every install render.
  // Each package's complete (timestamp-sensitive) digest is still re-verified
  // against its own identity; these two immutable anchors provide the stable
  // cross-install lineage needed to pair a generated launcher with Claude.
  const releaseAnchors = {
    "claude-code": packageDigests["claude-code"],
    codex: packageDigests["codex"],
  };
  if (
    !/^sha256:[a-f0-9]{64}$/.test(releaseAnchors["claude-code"] ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(releaseAnchors.codex ?? "")
  ) {
    throw new Error("release identity requires deterministic Claude and Codex anchors");
  }
  return `sha256:${sha256(JSON.stringify({
    release_version: releaseVersion,
    release_anchors: releaseAnchors,
    source_commit: sourceCommit,
    native_claude_payload_digest: nativeClaudePayloadDigest,
  }))}`;
}

function manifestVersion(root: string, packageName: ReleasePackageName): string {
  const jsonManifestByPackage: Partial<Record<ReleasePackageName, string>> = {
    "claude-code": path.join(".claude-plugin", "plugin.json"),
    codex: path.join(".codex-plugin", "plugin.json"),
    pi: "pi-manifest.json",
    antigravity: "plugin.json",
    cursor: "cursor-manifest.json",
    "github-copilot": "github-copilot-manifest.json",
    opencode: "opencode-manifest.json",
    "rovo-dev": "rovo-dev-manifest.json",
  };
  const manifestPath = jsonManifestByPackage[packageName];
  if (manifestPath !== undefined) {
    const parsed = JSON.parse(
      readPhysicalFile(path.join(root, manifestPath), `${packageName} package manifest`).toString("utf8"),
    ) as unknown;
    const version =
      parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)["version"]
        : undefined;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`${packageName} package manifest has no version`);
    }
    return version;
  }

  const agents = readPhysicalFile(path.join(root, "AGENTS.md"), "agents package manifest")
    .toString("utf8");
  const matches = [...agents.matchAll(/<!-- rendered_at: [^\n]* · source_version: ([^\s]+) -->/g)];
  if (matches.length !== 1 || !matches[0]![1]) {
    throw new Error("agents package manifest has no unique source version");
  }
  return matches[0]![1];
}

function assertKnownPackageName(value: string): asserts value is ReleasePackageName {
  if (!(RELEASE_PACKAGE_NAMES as readonly string[]).includes(value)) {
    throw new Error(`unknown release package name: ${value}`);
  }
}

function assertManifestMatchesIdentity(
  root: string,
  packageName: ReleasePackageName,
  releaseVersion: string,
): void {
  if (manifestVersion(root, packageName) !== releaseVersion) {
    throw new Error(`${packageName} manifest version does not match release identity`);
  }
}

/** Emit the same release-wide digest map into every generated package. */
export function writeReleasePackageIdentitySet(
  releaseVersion: string,
  packageRoots: Record<string, string>,
  sourceCommit: string | null = null,
  nativeClaudePayloadDigest = "",
): Record<string, ReleasePackageIdentityV1> {
  if (releaseVersion.length === 0) throw new Error("release version is empty");
  if (sourceCommit !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceCommit)) {
    throw new Error("release identity source commit is invalid");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(nativeClaudePayloadDigest)) {
    throw new Error("release identity native Claude payload digest is invalid");
  }
  const sortedRoots = Object.entries(packageRoots)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const suppliedNames = sortedRoots.map(([packageName]) => packageName);
  if (JSON.stringify(suppliedNames) !== JSON.stringify([...RELEASE_PACKAGE_NAMES])) {
    throw new Error("release identity requires the exact generated package set");
  }

  const packageDigests: Record<string, string> = {};
  for (const [packageName, packageRoot] of sortedRoots) {
    assertKnownPackageName(packageName);
    const root = physicalRoot(packageRoot);
    assertManifestMatchesIdentity(root, packageName, releaseVersion);
    // The exclusion is only for metadata added by a host after install. A
    // builder may never ship content under those unbound names.
    assertNoHostManagedMetadataAtEmission(root);
    packageDigests[packageName] = computeReleasePackageDigest(root, {
      ignoreHostManagedMetadata: true,
    });
  }
  const releaseId = computeReleaseIdentityId(
    releaseVersion,
    packageDigests,
    sourceCommit,
    nativeClaudePayloadDigest,
  );
  const emitted: Record<string, ReleasePackageIdentityV1> = {};
  for (const [packageName, packageRoot] of sortedRoots) {
    assertKnownPackageName(packageName);
    const identity: ReleasePackageIdentityV1 = {
      schema_version: RELEASE_PACKAGE_IDENTITY_SCHEMA,
      release_version: releaseVersion,
      release_id: releaseId,
      source_commit: sourceCommit,
      current_package: packageName,
      package_digests: packageDigests,
      native_claude_payload_digest: nativeClaudePayloadDigest,
    };
    fs.writeFileSync(
      path.join(packageRoot, RELEASE_PACKAGE_IDENTITY_FILE),
      `${JSON.stringify(identity, null, 2)}\n`,
      { mode: 0o644 },
    );
    emitted[packageName] = identity;
  }
  return emitted;
}

function parseIdentity(raw: Buffer): ReleasePackageIdentityV1 {
  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("release package identity is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    "current_package", "native_claude_payload_digest", "package_digests", "release_id",
    "release_version", "schema_version", "source_commit",
  ].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error("release package identity has an invalid shape");
  }
  const currentPackage = record["current_package"];
  const packageDigests = record["package_digests"];
  if (
    record["schema_version"] !== RELEASE_PACKAGE_IDENTITY_SCHEMA ||
    typeof record["release_version"] !== "string" || record["release_version"].length === 0 ||
    typeof record["release_id"] !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record["release_id"]) ||
    !(record["source_commit"] === null ||
      (typeof record["source_commit"] === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(record["source_commit"]))) ||
    typeof record["native_claude_payload_digest"] !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(record["native_claude_payload_digest"]) ||
    typeof currentPackage !== "string" ||
    packageDigests === null || typeof packageDigests !== "object" || Array.isArray(packageDigests)
  ) {
    throw new Error("release package identity has invalid fields");
  }
  assertKnownPackageName(currentPackage);
  const digests = packageDigests as Record<string, unknown>;
  const normalizedDigests: Record<string, string> = {};
  for (const [packageName, digest] of Object.entries(digests)) {
    assertKnownPackageName(packageName);
    if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`release package identity has an invalid digest for ${packageName}`);
    }
    normalizedDigests[packageName] = digest;
  }
  if (
    JSON.stringify(Object.keys(normalizedDigests).sort()) !==
      JSON.stringify([...RELEASE_PACKAGE_NAMES])
  ) {
    throw new Error("release package identity does not bind the exact generated package set");
  }
  const identity: ReleasePackageIdentityV1 = {
    schema_version: RELEASE_PACKAGE_IDENTITY_SCHEMA,
    release_version: record["release_version"] as string,
    release_id: record["release_id"] as string,
    source_commit: record["source_commit"] as string | null,
    current_package: currentPackage,
    package_digests: normalizedDigests,
    native_claude_payload_digest: record["native_claude_payload_digest"] as string,
  };
  if (computeReleaseIdentityId(
    identity.release_version,
    identity.package_digests,
    identity.source_commit,
    identity.native_claude_payload_digest,
  ) !== identity.release_id) {
    throw new Error("release package identity digest map does not match release id");
  }
  return identity;
}

/** Read, structurally validate, and re-hash one complete installed package. */
export function readVerifiedReleasePackageIdentity(packageRoot: string): ReleasePackageIdentityV1 {
  const root = physicalRoot(packageRoot);
  const rawIdentity = readPhysicalFile(
    path.join(root, RELEASE_PACKAGE_IDENTITY_FILE),
    "release package identity",
  );
  if (rawIdentity.length > 64 * 1024) {
    throw new Error("release package identity exceeds 64 KiB");
  }
  const identity = parseIdentity(rawIdentity);
  const expectedDigest = identity.package_digests[identity.current_package]!;
  if (computeReleasePackageDigest(root, { ignoreHostManagedMetadata: true }) !== expectedDigest) {
    throw new Error(`complete package digest differs for ${identity.current_package}`);
  }
  assertManifestMatchesIdentity(root, identity.current_package, identity.release_version);
  return identity;
}
