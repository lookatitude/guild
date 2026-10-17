import { describe, it, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as path from "node:path";
import * as yaml from "js-yaml";
import {
  MIGRATION_BOUNDARY_SCHEMA,
  createMigrationBoundary,
  validateMigrationBoundary,
} from "./migration-evidence";

const git = (root: string, ...args: string[]): string =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

function fixture(version = "2.7.0-beta.2") {
  const root = mkdtempSync(join(tmpdir(), "guild-migration-boundary-repo-"));
  const eventPath = join(root, "push.json");
  git(root, "init", "-q", "-b", "next");
  git(root, "config", "user.name", "Guild Test");
  git(root, "config", "user.email", "guild@example.invalid");
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, ".codex-plugin"), { recursive: true });
  mkdirSync(join(root, "hooks/dist"), { recursive: true });
  const claudeManifest = `${JSON.stringify({ name: "guild", version }, null, 2)}\n`;
  const codexManifest = `${JSON.stringify({ name: "guild", version, host: "codex" }, null, 2)}\n`;
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), claudeManifest);
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), codexManifest);
  writeFileSync(join(root, "payload.txt"), "boundary bytes\n");
  writeFileSync(join(root, "hooks/dist/pre-tool-use.js"), "// runtime producer\n");
  git(root, "add", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "hooks/dist/pre-tool-use.js", "payload.txt");
  git(root, "commit", "-qm", "beta boundary");
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "update-ref", "refs/remotes/origin/next", commit);
  const event = {
    ref: "refs/heads/next",
    after: commit,
    repository: { full_name: "lookatitude/guild", pushed_at: 1787299200 },
    head_commit: { id: commit, timestamp: "2026-08-21T08:00:00Z" },
  };
  writeFileSync(eventPath, `${JSON.stringify(event)}\n`);
  const claudePackageRoot = join(root, "runtime-packages", "claude-code");
  const codexPackageRoot = join(root, "runtime-packages", "codex");
  mkdirSync(join(claudePackageRoot, ".claude-plugin"), { recursive: true });
  mkdirSync(join(codexPackageRoot, ".codex-plugin"), { recursive: true });
  mkdirSync(join(claudePackageRoot, "hooks/dist"), { recursive: true });
  mkdirSync(join(codexPackageRoot, "hooks/dist"), { recursive: true });
  writeFileSync(join(claudePackageRoot, ".claude-plugin", "plugin.json"), claudeManifest);
  writeFileSync(join(codexPackageRoot, ".codex-plugin", "plugin.json"), codexManifest);
  writeFileSync(join(claudePackageRoot, "hooks/dist/pre-tool-use.js"), "// runtime producer\n");
  writeFileSync(join(codexPackageRoot, "hooks/dist/pre-tool-use.js"), "// runtime producer\n");
  writeFileSync(join(claudePackageRoot, "runtime.js"), "claude runtime\n");
  writeFileSync(join(codexPackageRoot, "runtime.js"), "codex runtime\n");
  return { root, eventPath, commit, event, claudePackageRoot, codexPackageRoot };
}

function create(value: ReturnType<typeof fixture>) {
  return createMigrationBoundary({
    pluginRoot: value.root,
    claudePackageRoot: value.claudePackageRoot,
    codexPackageRoot: value.codexPackageRoot,
    eventPath: value.eventPath,
    repository: "lookatitude/guild",
    runId: "32460000000",
    runAttempt: 1,
  });
}

describe("hash-bound next migration boundary", () => {
  it("derives the exact beta version, commit, manifest, tree, event and workflow identity", () => {
    const value = fixture();
    try {
      const boundary = create(value);
      expect(boundary).toEqual(expect.objectContaining({
        schema_version: MIGRATION_BOUNDARY_SCHEMA,
        channel: "next",
        release: "2.7.0-beta.2",
        source_commit: value.commit,
        source_tree_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        merged_at: "2026-08-21T08:00:00.000Z",
        event_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        boundary_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }));
      expect(boundary.packages["claude-code-cli"]).toEqual(expect.objectContaining({ host_id: "claude-code-cli", manifest_path: ".claude-plugin/plugin.json", manifest_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), tree_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }));
      expect(boundary.packages["codex-cli"]).toEqual(expect.objectContaining({ host_id: "codex-cli", manifest_path: ".codex-plugin/plugin.json", manifest_sha256: expect.stringMatching(/^[0-9a-f]{64}$/), tree_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }));
      expect(boundary.workflow).toEqual({
        repository: "lookatitude/guild",
        run_id: "32460000000",
        run_attempt: 1,
        event: "push",
        ref: "refs/heads/next",
      });
      expect(validateMigrationBoundary(JSON.parse(JSON.stringify(boundary)))).toEqual(boundary);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it.each([
    ["event ref", (value: ReturnType<typeof fixture>) => { value.event.ref = "refs/heads/main"; }],
    ["event commit", (value: ReturnType<typeof fixture>) => { value.event.after = "0".repeat(40); }],
    ["head commit", (value: ReturnType<typeof fixture>) => { value.event.head_commit.id = "0".repeat(40); }],
    ["repository", (value: ReturnType<typeof fixture>) => { value.event.repository.full_name = "attacker/guild"; }],
  ])("refuses a mismatched %s", (_label, mutate) => {
    const value = fixture();
    try {
      mutate(value);
      writeFileSync(value.eventPath, `${JSON.stringify(value.event)}\n`);
      expect(() => create(value)).toThrow();
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it("accepts the offset timestamp shape GitHub uses in real push payloads", () => {
    const value = fixture();
    try {
      value.event.head_commit.timestamp = "2026-08-21T13:30:00+05:30";
      writeFileSync(value.eventPath, `${JSON.stringify(value.event)}\n`);
      expect(create(value).merged_at).toBe("2026-08-21T08:00:00.000Z");
    } finally { rmSync(value.root, { recursive: true, force: true }); }
  });

  it("refuses a stale checkout/origin-next split view", () => {
    const value = fixture();
    try {
      writeFileSync(join(value.root, "payload.txt"), "later bytes\n");
      git(value.root, "add", "payload.txt");
      git(value.root, "commit", "-qm", "later next");
      git(value.root, "update-ref", "refs/remotes/origin/next", git(value.root, "rev-parse", "HEAD"));
      expect(() => create(value)).toThrow(/checkout.*event.*origin\/next/i);
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it.each(["2.7.0", "2.7.0-rc.1", "2.7.0-beta.01", "2.7.0-beta.0x2"])(
    "refuses non-canonical next boundary version %s",
    (version) => {
      const value = fixture(version);
      try {
        expect(() => create(value)).toThrow(/beta\.N|prerelease/i);
      } finally {
        rmSync(value.root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ["release", (boundary: any) => { boundary.release = "2.7.0-beta.3"; }],
    ["source commit", (boundary: any) => { boundary.source_commit = "0".repeat(40); }],
    ["tree", (boundary: any) => { boundary.source_tree_hash = `sha256:${"0".repeat(64)}`; }],
    ["package hash", (boundary: any) => { boundary.packages["claude-code-cli"].tree_sha256 = "0".repeat(64); }],
    ["event hash", (boundary: any) => { boundary.event_sha256 = "0".repeat(64); }],
    ["workflow run", (boundary: any) => { boundary.workflow.run_id = "0"; }],
  ])("the public validator refuses a tampered %s", (_label, mutate) => {
    const value = fixture();
    try {
      const boundary: any = JSON.parse(JSON.stringify(create(value)));
      mutate(boundary);
      expect(validateMigrationBoundary(boundary)).toBeNull();
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it("refuses unknown/private-material fields rather than normalizing them away", () => {
    const value = fixture();
    try {
      const boundary: any = JSON.parse(JSON.stringify(create(value)));
      boundary.private_seeds = ["secret"];
      expect(validateMigrationBoundary(boundary)).toBeNull();
    } finally {
      rmSync(value.root, { recursive: true, force: true });
    }
  });

  it("the post-merge workflow emits only when the canonical next beta version changes", () => {
    const workflowPath = path.resolve(__dirname, "../../../.github/workflows/capability-migration-boundary.yml");
    const raw = require("node:fs").readFileSync(workflowPath, "utf8") as string;
    const parsed = yaml.load(raw) as any;
    const push = parsed.on?.push ?? parsed.true?.push;
    expect(push?.branches).toEqual(["next"]);
    expect(push?.paths).toEqual([".claude-plugin/plugin.json"]);
    expect(raw).toContain('ref: ${{ github.sha }}');
    expect(raw).toContain('--event "$GITHUB_EVENT_PATH"');
    expect(raw).toContain('--run-id "$GITHUB_RUN_ID"');
    expect(raw).toContain("git fetch --no-tags origin refs/heads/next:refs/remotes/origin/next");
    expect(raw).not.toContain("git update-ref refs/remotes/origin/next");
    expect(raw).toContain("Classify a new beta boundary");
    expect(raw).toContain('current" != "$previous');
    expect(raw).toContain("steps.boundary.outputs.emit == 'true'");
    expect(parsed.permissions).toEqual(expect.objectContaining({ contents: "read", "id-token": "write", attestations: "write" }));
    expect(raw).toContain("uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7");
    expect(raw).toContain("uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7");
    expect(raw).toContain("uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4");
    expect(raw).toContain("uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f # v6");
    expect(raw).toContain('npm --prefix scripts run emit:migration-boundary');
    expect(raw).toContain('npm --prefix scripts run build:hosts');
    expect(raw).toContain('--claude-package-root "$GITHUB_WORKSPACE/dist/claude-code"');
    expect(raw).toContain('--codex-package-root "$GITHUB_WORKSPACE/dist/codex"');
    expect(raw).toContain('subject-path: ${{ runner.temp }}/capability-migration-boundaries/*.json');
    expect(raw).toContain('capability-migration-boundary-${{ github.sha }}');
  });
});

// ─── G02 — content-addressed compaction wire (A02 dossier 54f61a6d3ab5…) ─────
import { createHash } from "node:crypto";
import { mkdtempSync as mkdtemp2, rmSync as rm2, writeFileSync as write2, readFileSync as read2, mkdirSync as mkdir2, symlinkSync as symlink2 } from "node:fs";
import {
  BOUNDARY_STORE_RELPATH,
  CAPABILITY_PACKAGE_MANIFEST_SCHEMA,
  MAX_FILES_PER_PACKAGE,
  MIGRATION_BOUNDARY_SCHEMA_V2,
  PACKAGE_MANIFEST_STORE_RELPATH,
  capabilityPackageManifestDigest,
  hydrateMigrationBoundary,
  persistMigrationBoundaryWire,
  readCapabilityPackageManifest,
  resolveMigrationBoundaryRef,
  resolveMigrationPackageRef,
  validateCapabilityPackageManifest,
  validateMigrationBoundaryRef,
  validateMigrationBoundaryV2,
  writeCapabilityPackageManifest,
} from "./migration-evidence";

const canon = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canon(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const hex = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");

// Exact positive example vectors ratified in the A02 dossier (§examples.positive).
const CLAUDE_MANIFEST = {
  schema_version: CAPABILITY_PACKAGE_MANIFEST_SCHEMA,
  host_id: "claude-code-cli",
  manifest_path: ".claude-plugin/plugin.json",
  manifest_sha256: "a".repeat(64),
  producer_sha256: "b".repeat(64),
  tree_sha256: "d86a5feadb04baef35884b2aedd3f8bc32dc3e9722635a9a746cb1b3e373fb3d",
  install_surface_sha256: "553f973ced030455fc60aedba9603febc336b7de04b805871406b3085e666c72",
  files: [
    { path: ".claude-plugin/plugin.json", sha256: "a".repeat(64) },
    { path: "runtime/scripts/run-analysis.js", sha256: "c".repeat(64) },
  ],
  install_files: [{ path: ".claude-plugin/plugin.json", sha256: "a".repeat(64) }],
};
const CODEX_MANIFEST = {
  schema_version: CAPABILITY_PACKAGE_MANIFEST_SCHEMA,
  host_id: "codex-cli",
  manifest_path: ".codex-plugin/plugin.json",
  manifest_sha256: "1".repeat(64),
  producer_sha256: "2".repeat(64),
  tree_sha256: "89559584a4e012bf164117603a66ac96261059259dce67ca87450ff9147f2334",
  install_surface_sha256: "b0c62f313c7d4f0d4a40c7a963b9f2ba10920a0a45ebfa7d6a5e0037a78448b8",
  files: [
    { path: ".codex-plugin/plugin.json", sha256: "1".repeat(64) },
    { path: "runtime/scripts/run-analysis.js", sha256: "3".repeat(64) },
  ],
  install_files: [{ path: ".codex-plugin/plugin.json", sha256: "1".repeat(64) }],
};
const DOSSIER_CLAUDE_DIGEST = "b7f72fcb4c60f013da81e0ca2114395589eec82b2f13869a200ef568da2fdf6a";
const DOSSIER_CODEX_DIGEST = "866c12880488d8aeb0845780fa03e60485af2458391b4251dacd10c90bc79f2b";
const DOSSIER_BOUNDARY_V2 = {
  schema_version: MIGRATION_BOUNDARY_SCHEMA_V2,
  channel: "next",
  release: "3.1.0-beta.2",
  source_commit: "0".repeat(40),
  source_tree_hash: `sha256:${"d".repeat(64)}`,
  merged_at: "2026-10-17T12:00:00.000Z",
  package_refs: {
    "claude-code-cli": {
      host_id: "claude-code-cli",
      manifest_path: ".claude-plugin/plugin.json",
      manifest_sha256: "a".repeat(64),
      producer_sha256: "b".repeat(64),
      tree_sha256: "d86a5feadb04baef35884b2aedd3f8bc32dc3e9722635a9a746cb1b3e373fb3d",
      install_surface_sha256: "553f973ced030455fc60aedba9603febc336b7de04b805871406b3085e666c72",
      package_manifest_sha256: DOSSIER_CLAUDE_DIGEST,
    },
    "codex-cli": {
      host_id: "codex-cli",
      manifest_path: ".codex-plugin/plugin.json",
      manifest_sha256: "1".repeat(64),
      producer_sha256: "2".repeat(64),
      tree_sha256: "89559584a4e012bf164117603a66ac96261059259dce67ca87450ff9147f2334",
      install_surface_sha256: "b0c62f313c7d4f0d4a40c7a963b9f2ba10920a0a45ebfa7d6a5e0037a78448b8",
      package_manifest_sha256: DOSSIER_CODEX_DIGEST,
    },
  },
  workflow: { repository: "lookatitude/guild", run_id: "123456789", run_attempt: 1, event: "push", ref: "refs/heads/next" },
  event_sha256: "e".repeat(64),
  boundary_hash: "c07eda8f67829b6998cb26ce941c92cc7b934eb254f735a85f905b0f66265b97",
};
const DOSSIER_BOUNDARY_RAW_SHA = "1c55150fc25418b3ea0b954bf4a018adefdb9ee369f444371cad58d056ca7681";

describe("G02 — capability package manifest v1 (content-addressed)", () => {
  it("reproduces the dossier's ratified canonical bytes and digests exactly", () => {
    const claude = validateCapabilityPackageManifest(CLAUDE_MANIFEST);
    const codex = validateCapabilityPackageManifest(CODEX_MANIFEST);
    expect(claude).not.toBeNull();
    expect(codex).not.toBeNull();
    expect(capabilityPackageManifestDigest(claude!)).toBe(DOSSIER_CLAUDE_DIGEST);
    expect(capabilityPackageManifestDigest(codex!)).toBe(DOSSIER_CODEX_DIGEST);
  });

  it("enforces the 4096-file ceiling, stored sort order and the install subset binding", () => {
    const tooMany = {
      ...CLAUDE_MANIFEST,
      files: Array.from({ length: MAX_FILES_PER_PACKAGE + 1 }, (_entry, index) => ({ path: `lib/f${String(index).padStart(5, "0")}.js`, sha256: hex(`f${index}`) })),
    };
    expect(validateCapabilityPackageManifest({ ...tooMany, tree_sha256: hex(canon(tooMany.files)) })).toBeNull();
    const unsorted = { ...CLAUDE_MANIFEST, files: [CLAUDE_MANIFEST.files[1], CLAUDE_MANIFEST.files[0]] };
    expect(validateCapabilityPackageManifest(unsorted)).toBeNull();
    const foreignSubset = { ...CLAUDE_MANIFEST, install_files: [{ path: "not/in/files.js", sha256: "9".repeat(64) }] };
    expect(validateCapabilityPackageManifest(foreignSubset)).toBeNull();
    const wrongTree = { ...CLAUDE_MANIFEST, tree_sha256: "9".repeat(64) };
    expect(validateCapabilityPackageManifest(wrongTree)).toBeNull();
    expect(validateCapabilityPackageManifest({ ...CLAUDE_MANIFEST, extra: true })).toBeNull();
  });

  it("writes and reads blobs with raw-digest verification before parse", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-manifest-store-"));
    try {
      const written = writeCapabilityPackageManifest(root, CLAUDE_MANIFEST);
      expect(written.package_manifest_sha256).toBe(DOSSIER_CLAUDE_DIGEST);
      expect(written.path).toBe(`${PACKAGE_MANIFEST_STORE_RELPATH}/${DOSSIER_CLAUDE_DIGEST}.json`);
      expect(readCapabilityPackageManifest(root, DOSSIER_CLAUDE_DIGEST)).toEqual(validateCapabilityPackageManifest(CLAUDE_MANIFEST)!);
      // idempotent re-write of identical bytes
      expect(writeCapabilityPackageManifest(root, CLAUDE_MANIFEST).package_manifest_sha256).toBe(DOSSIER_CLAUDE_DIGEST);
    } finally { rm2(root, { recursive: true, force: true }); }
  });

  it("refuses a missing blob, a tampered blob (before parse) and a non-canonical rendering", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-manifest-store-"));
    try {
      expect(() => readCapabilityPackageManifest(root, "f".repeat(64))).toThrow(/blob missing/);
      const written = writeCapabilityPackageManifest(root, CLAUDE_MANIFEST);
      const blobPath = join(root, written.path);
      const bytes = read2(blobPath);
      bytes[10] = bytes[10] === 120 ? 121 : 120;
      write2(blobPath, bytes);
      expect(() => readCapabilityPackageManifest(root, DOSSIER_CLAUDE_DIGEST)).toThrow(/tampered.*before parse/);
      // A pretty-printed blob stored at the digest of ITS OWN bytes still fails
      // identity: stored bytes must be the canonical rendering.
      const pretty = Buffer.from(JSON.stringify(validateCapabilityPackageManifest(CLAUDE_MANIFEST), null, 2), "utf8");
      const prettyDigest = hex(pretty);
      mkdir2(join(root, PACKAGE_MANIFEST_STORE_RELPATH), { recursive: true });
      write2(join(root, PACKAGE_MANIFEST_STORE_RELPATH, `${prettyDigest}.json`), pretty);
      expect(() => readCapabilityPackageManifest(root, prettyDigest)).toThrow(/identity mismatch/);
    } finally { rm2(root, { recursive: true, force: true }); }
  });

  it("refuses a symlinked blob path (no-follow containment)", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-manifest-store-"));
    try {
      const written = writeCapabilityPackageManifest(root, CODEX_MANIFEST);
      const blobPath = join(root, written.path);
      const aside = join(root, "aside.json");
      write2(aside, read2(blobPath));
      rm2(blobPath);
      symlink2(aside, blobPath);
      expect(() => readCapabilityPackageManifest(root, written.package_manifest_sha256)).toThrow(/refused|not a regular file|ELOOP/);
    } finally { rm2(root, { recursive: true, force: true }); }
  });
});

describe("G02 — migration boundary v2 wire + content-addressed refs", () => {
  it("validates the dossier's positive boundary example and recomputes its ratified hashes", () => {
    const boundary = validateMigrationBoundaryV2(DOSSIER_BOUNDARY_V2);
    expect(boundary).not.toBeNull();
    expect(boundary!.boundary_hash).toBe(DOSSIER_BOUNDARY_V2.boundary_hash);
    expect(hex(canon(boundary))).toBe(DOSSIER_BOUNDARY_RAW_SHA);
  });

  it("refuses the dossier's changed-field and unknown-version negative examples", () => {
    expect(validateMigrationBoundaryV2({ ...DOSSIER_BOUNDARY_V2, release: "3.1.0-beta.3" })).toBeNull();
    expect(validateMigrationBoundaryV2({ ...DOSSIER_BOUNDARY_V2, schema_version: "guild.capability_migration_boundary.v3" })).toBeNull();
    expect(validateMigrationBoundaryV2({ ...DOSSIER_BOUNDARY_V2, workflow: { ...DOSSIER_BOUNDARY_V2.workflow, event: "workflow_dispatch" } })).toBeNull();
  });

  it("persists wire bytes, resolves refs, and hydrates manifests with full identity validation", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-boundary-store-"));
    try {
      writeCapabilityPackageManifest(root, CLAUDE_MANIFEST);
      writeCapabilityPackageManifest(root, CODEX_MANIFEST);
      const bytes = Buffer.from(canon(validateMigrationBoundaryV2(DOSSIER_BOUNDARY_V2)), "utf8");
      const ref = persistMigrationBoundaryWire(root, bytes);
      expect(ref).toEqual({
        boundary_hash: DOSSIER_BOUNDARY_V2.boundary_hash,
        path: `${BOUNDARY_STORE_RELPATH}/${DOSSIER_BOUNDARY_RAW_SHA}.json`,
        sha256: DOSSIER_BOUNDARY_RAW_SHA,
        wire_version: MIGRATION_BOUNDARY_SCHEMA_V2,
      });
      expect(validateMigrationBoundaryRef(ref)).toEqual(ref);
      const wire = resolveMigrationBoundaryRef(root, ref);
      expect(wire.wire_version).toBe(MIGRATION_BOUNDARY_SCHEMA_V2);
      const view = hydrateMigrationBoundary(root, wire);
      expect(view.boundary_hash).toBe(DOSSIER_BOUNDARY_V2.boundary_hash);
      expect(view.packages["claude-code-cli"].files).toHaveLength(2);
      expect(view.packages["codex-cli"].install_files).toHaveLength(1);
    } finally { rm2(root, { recursive: true, force: true }); }
  });

  it("refuses the dossier's missing-ref and tampered-ref controls before any materialization", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-boundary-store-"));
    try {
      writeCapabilityPackageManifest(root, CLAUDE_MANIFEST);
      writeCapabilityPackageManifest(root, CODEX_MANIFEST);
      const missingRef = {
        boundary_hash: DOSSIER_BOUNDARY_V2.boundary_hash,
        path: `${BOUNDARY_STORE_RELPATH}/${"f".repeat(64)}.json`,
        sha256: "f".repeat(64),
        wire_version: MIGRATION_BOUNDARY_SCHEMA_V2,
      };
      expect(() => resolveMigrationBoundaryRef(root, missingRef)).toThrow(/blob missing/);
      const bytes = Buffer.from(canon(validateMigrationBoundaryV2(DOSSIER_BOUNDARY_V2)), "utf8");
      const ref = persistMigrationBoundaryWire(root, bytes);
      const blobPath = join(root, ref.path);
      const stored = read2(blobPath);
      stored[20] = stored[20] === 120 ? 121 : 120;
      write2(blobPath, stored);
      expect(() => resolveMigrationBoundaryRef(root, ref)).toThrow(/tampered.*before parse/);
    } finally { rm2(root, { recursive: true, force: true }); }
  });

  it("treats a ref whose inline binding fields disagree with the resolved blob as tampered_ref", () => {
    const root = mkdtemp2(join(tmpdir(), "g02-boundary-store-"));
    try {
      writeCapabilityPackageManifest(root, CLAUDE_MANIFEST);
      // codex ref resolving to a CLAUDE blob is tampered_ref (host identity).
      const crossRef = { ...DOSSIER_BOUNDARY_V2.package_refs["codex-cli"], package_manifest_sha256: DOSSIER_CLAUDE_DIGEST };
      expect(() => resolveMigrationPackageRef(root, crossRef as never)).toThrow(/tampered package manifest ref/);
      // binding-field drift against the right blob is also tampered_ref.
      const drifted = { ...DOSSIER_BOUNDARY_V2.package_refs["claude-code-cli"], producer_sha256: "9".repeat(64) };
      expect(() => resolveMigrationPackageRef(root, drifted as never)).toThrow(/tampered package manifest ref/);
    } finally { rm2(root, { recursive: true, force: true }); }
  });

  it("refuses an unknown wire version at ref validation and at dispatch", () => {
    expect(validateMigrationBoundaryRef({
      boundary_hash: "0".repeat(64),
      path: `${BOUNDARY_STORE_RELPATH}/${"0".repeat(64)}.json`,
      sha256: "0".repeat(64),
      wire_version: "guild.capability_migration_boundary.v3",
    })).toBeNull();
    const root = mkdtemp2(join(tmpdir(), "g02-boundary-store-"));
    try {
      const unknown = Buffer.from(canon({ ...DOSSIER_BOUNDARY_V2, schema_version: "guild.capability_migration_boundary.v3" }), "utf8");
      expect(() => persistMigrationBoundaryWire(root, unknown)).toThrow(/unknown boundary wire version/);
    } finally { rm2(root, { recursive: true, force: true }); }
  });
});
