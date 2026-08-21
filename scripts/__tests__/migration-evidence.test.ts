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
} from "../lib/capability/migration-evidence";

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
  const claudeManifest = `${JSON.stringify({ name: "guild", version }, null, 2)}\n`;
  const codexManifest = `${JSON.stringify({ name: "guild", version, host: "codex" }, null, 2)}\n`;
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), claudeManifest);
  writeFileSync(join(root, ".codex-plugin", "plugin.json"), codexManifest);
  writeFileSync(join(root, "payload.txt"), "boundary bytes\n");
  git(root, "add", ".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "payload.txt");
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
  writeFileSync(join(claudePackageRoot, ".claude-plugin", "plugin.json"), claudeManifest);
  writeFileSync(join(codexPackageRoot, ".codex-plugin", "plugin.json"), codexManifest);
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
    const workflowPath = path.resolve(__dirname, "../..", ".github/workflows/capability-migration-boundary.yml");
    const raw = require("node:fs").readFileSync(workflowPath, "utf8") as string;
    const parsed = yaml.load(raw) as any;
    const push = parsed.on?.push ?? parsed.true?.push;
    expect(push?.branches).toEqual(["next"]);
    expect(push?.paths).toEqual([".claude-plugin/plugin.json"]);
    expect(raw).toContain('ref: ${{ github.sha }}');
    expect(raw).toContain('--event "$GITHUB_EVENT_PATH"');
    expect(raw).toContain('--run-id "$GITHUB_RUN_ID"');
    expect(parsed.permissions).toEqual(expect.objectContaining({ contents: "read", "id-token": "write", attestations: "write" }));
    expect(raw).toContain("uses: actions/attest@v4");
    expect(raw).toContain('npm --prefix scripts run emit:migration-boundary');
    expect(raw).toContain('npm --prefix scripts run build:hosts');
    expect(raw).toContain('--claude-package-root "$GITHUB_WORKSPACE/dist/claude-code"');
    expect(raw).toContain('--codex-package-root "$GITHUB_WORKSPACE/dist/codex"');
    expect(raw).toContain('subject-path: ${{ runner.temp }}/capability-migration-boundaries/*.json');
    expect(raw).toContain('capability-migration-boundary-${{ github.sha }}');
  });
});
