/**
 * scripts/__tests__/tmux-backend.test.ts
 *
 * G4 — worker-pane teardown (deliverable 3) + the real termination primitive
 * (deliverable 2/4), task-cell-runtime ADR D5. Non-vacuous: each assertion would
 * fail if `exec $SHELL` were restored or `terminatePane` reverted to signal-only.
 *
 *   AT14  a completed worker's pane DISAPPEARS by default (no `exec $SHELL`); an
 *         operator debug shell is opt-in AND retitled so it can never be confused
 *         with a live worker.
 *   kill+confirm  terminatePane kills the pane and CONFIRMS its death by polling.
 *   AT6   a kill that does not confirm is an ORPHAN; a reaper retry confirms it.
 *   degraded  tmux unavailable is a recorded degradation, not a silent success.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import type { RunFn } from "../lib/core/contracts/team-backend";
import {
  DEBUG_PANE_TITLE_PREFIX,
  TmuxTeamBackend,
  composeTmuxCommands,
  isDebugShellTitle,
  isPaneAlive,
  livePaneIds,
  paneCommand,
  paneDebugEnabled,
  resolveClaudePluginActivation,
  resolveClaudePluginActivationArgs,
  resolveClaudeTeamLaunchArgs,
  resolveTeamPaneHostMode,
  terminatePane,
} from "../lib/host/tmux-backend";
import { RUNTIME_DEFAULT_CONFIG, type RuntimePermissionConfig } from "../lib/permission-policy";
import {
  NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE,
  NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
  RELEASE_PACKAGE_IDENTITY_FILE,
  RELEASE_PACKAGE_NAMES,
  computeReleaseIdentityId,
  computePhysicalNativeClaudePayloadDigest,
  computeReleasePackageDigest,
  readVerifiedNativeClaudePackageIdentity,
  writeNativeClaudePackageIdentity,
  writeReleasePackageIdentitySet,
} from "../lib/release-package-identity";

const SYNTHETIC_RELEASE_RESOURCES: Record<string, string[]> = {
  dispatch: [
    path.join("scripts", "lib", "host", "tmux-backend.ts"),
    path.join("scripts", "lib", "host", "cmux-backend.ts"),
  ],
  security: [path.join("hooks", "hooks.json")],
};

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const LOCKED_RUNTIME_DEPENDENCIES = ["argparse", "js-yaml"] as const;

function installLockedNativeRuntime(root: string): void {
  const scriptsRoot = path.join(root, "scripts");
  const nodeModules = path.join(scriptsRoot, "node_modules");
  fs.mkdirSync(nodeModules, { recursive: true });
  for (const dependency of LOCKED_RUNTIME_DEPENDENCIES) {
    fs.cpSync(
      path.join(PLUGIN_ROOT, "scripts", "node_modules", dependency),
      path.join(nodeModules, dependency),
      { recursive: true },
    );
  }
  const sourceLock = JSON.parse(
    fs.readFileSync(path.join(scriptsRoot, "package-lock.json"), "utf8"),
  ) as { name: string; lockfileVersion: number; requires: boolean; packages: Record<string, unknown> };
  fs.writeFileSync(
    path.join(nodeModules, ".package-lock.json"),
    `${JSON.stringify({
      name: sourceLock.name,
      lockfileVersion: sourceLock.lockfileVersion,
      requires: sourceLock.requires,
      packages: Object.fromEntries(
        LOCKED_RUNTIME_DEPENDENCIES.map((dependency) => [
          `node_modules/${dependency}`,
          sourceLock.packages[`node_modules/${dependency}`],
        ]),
      ),
    }, null, 2)}\n`,
  );
  fs.mkdirSync(path.join(nodeModules, ".bin"));
  fs.symlinkSync("../js-yaml/bin/js-yaml.js", path.join(nodeModules, ".bin", "js-yaml"));
}

function writeSyntheticReleaseIdentity(
  owner: string,
  claude: string,
  claudeOverrides: Record<string, string> = {},
  ownerPackage = "codex",
  sourceCommit: string | null = null,
  nativeClaudePayloadDigest = `sha256:${"d".repeat(64)}`,
): void {
  for (const root of [owner, claude]) {
    for (const [moduleId, resources] of Object.entries(SYNTHETIC_RELEASE_RESOURCES)) {
      const entries = resources.map((sourcePath) => {
        const content =
          root === claude && claudeOverrides[sourcePath] !== undefined
            ? claudeOverrides[sourcePath]!
            : `same-release:${sourcePath}`;
        fs.mkdirSync(path.dirname(path.join(root, sourcePath)), { recursive: true });
        fs.writeFileSync(path.join(root, sourcePath), content);
        const resourcePath = path.join("resources", sourcePath);
        const mirrored = path.join(root, "src", "modules", moduleId, resourcePath);
        fs.mkdirSync(path.dirname(mirrored), { recursive: true });
        fs.writeFileSync(mirrored, content);
        return {
          category: sourcePath.startsWith("hooks/") ? "hooks" : "scripts",
          id: sourcePath,
          source_path: sourcePath,
          resource_path: resourcePath,
          sha256: createHash("sha256").update(content).digest("hex"),
        };
      });
      const manifest = path.join(
        root, "src", "modules", moduleId, "resources", "module-resources.json",
      );
      fs.mkdirSync(path.dirname(manifest), { recursive: true });
      fs.writeFileSync(manifest, JSON.stringify({
        schema_version: "guild.module_resources.v1",
        module_id: moduleId,
        generated_from: "synthetic-test",
        entries,
      }));
    }
  }
  const packageRoots: Record<string, string> = {
    [ownerPackage]: owner,
    "claude-code": claude,
  };
  const peers = path.join(path.dirname(owner), ".synthetic-release-peers");
  for (const packageName of RELEASE_PACKAGE_NAMES) {
    if (packageRoots[packageName] !== undefined) continue;
    const root = path.join(peers, packageName);
    packageRoots[packageName] = root;
    fs.mkdirSync(root, { recursive: true });
    if (packageName === "agents") {
      fs.writeFileSync(
        path.join(root, "AGENTS.md"),
        "<!-- rendered_at: synthetic · source_version: 2.7.0-beta.14 -->\n",
      );
      continue;
    }
    const manifestPath =
      packageName === "codex" ? path.join(".codex-plugin", "plugin.json")
      : packageName === "antigravity" ? "plugin.json"
      : packageName === "pi" ? "pi-manifest.json"
      : `${packageName}-manifest.json`;
    fs.mkdirSync(path.dirname(path.join(root, manifestPath)), { recursive: true });
    fs.writeFileSync(
      path.join(root, manifestPath),
      JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
    );
  }
  writeReleasePackageIdentitySet(
    "2.7.0-beta.14",
    packageRoots,
    sourceCommit,
    nativeClaudePayloadDigest,
  );
}

function writeNativeClaudeCacheIdentity(root: string): string {
  const payloadDigest = computePhysicalNativeClaudePayloadDigest(root);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"),
  ) as { version: string };
  fs.writeFileSync(
    path.join(root, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE),
    `${JSON.stringify({
      schema_version: NATIVE_CLAUDE_PACKAGE_IDENTITY_SCHEMA,
      release_version: manifest.version,
      payload_digest: payloadDigest,
    }, null, 2)}\n`,
  );
  return payloadDigest;
}

function createGeneratedClaudeOwner(parent: string): string {
  const root = path.join(parent, "generated-claude-owner");
  fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
  );
  writeSyntheticReleaseIdentity(root, root, {}, "claude-code");
  return root;
}

function expectExactActivation(args: string[], root: string, pluginIds = ["guild@guild"]): void {
  expect(args).toEqual([
    "--settings",
    JSON.stringify({
      enabledPlugins: Object.fromEntries(pluginIds.map((id) => [id, false])),
    }),
    "--plugin-dir",
    fs.realpathSync(root),
  ]);
}

function rewriteSyntheticIdentity(
  root: string,
  mutate: (identity: Record<string, any>) => void,
): void {
  const identityPath = path.join(root, RELEASE_PACKAGE_IDENTITY_FILE);
  const identity = JSON.parse(fs.readFileSync(identityPath, "utf8")) as Record<string, any>;
  mutate(identity);
  identity.package_digests[identity.current_package] = computeReleasePackageDigest(root);
  identity.release_id = computeReleaseIdentityId(
    identity.release_version,
    identity.package_digests,
    identity.source_commit ?? null,
    identity.native_claude_payload_digest,
  );
  fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`);
}

describe("release package identity — deterministic cross-install lineage", () => {
  const digest = (character: string): string => `sha256:${character.repeat(64)}`;

  it("keeps one release id when only timestamp-bearing host packages differ", () => {
    const first = Object.fromEntries(
      RELEASE_PACKAGE_NAMES.map((name, index) => [name, digest((index + 1).toString(16))]),
    );
    const separatelyRendered = { ...first, agents: digest("a"), pi: digest("b") };

    expect(computeReleaseIdentityId("2.7.0-beta.14", separatelyRendered)).toBe(
      computeReleaseIdentityId("2.7.0-beta.14", first),
    );
  });

  it("changes the release id when either deterministic anchor changes", () => {
    const baseline = Object.fromEntries(
      RELEASE_PACKAGE_NAMES.map((name, index) => [name, digest((index + 1).toString(16))]),
    );
    expect(computeReleaseIdentityId("2.7.0-beta.14", {
      ...baseline,
      "claude-code": digest("e"),
    })).not.toBe(computeReleaseIdentityId("2.7.0-beta.14", baseline));
    expect(computeReleaseIdentityId("2.7.0-beta.14", {
      ...baseline,
      codex: digest("f"),
    })).not.toBe(computeReleaseIdentityId("2.7.0-beta.14", baseline));
  });

  it("binds the release id to the exact clean source commit", () => {
    const baseline = Object.fromEntries(
      RELEASE_PACKAGE_NAMES.map((name, index) => [name, digest((index + 1).toString(16))]),
    );
    expect(computeReleaseIdentityId("2.7.0-beta.14", baseline, "d".repeat(40))).not.toBe(
      computeReleaseIdentityId("2.7.0-beta.14", baseline, "e".repeat(40)),
    );
  });

  it("keeps generic dependency digests sensitive to .in_use-shaped content", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-generic-digest-"));
    try {
      fs.mkdirSync(path.join(root, ".in_use"));
      fs.writeFileSync(path.join(root, ".in_use", "runtime.js"), "first");
      const before = computeReleasePackageDigest(root);
      fs.writeFileSync(path.join(root, ".in_use", "runtime.js"), "changed");
      expect(computeReleasePackageDigest(root)).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies the exact Git-archive payload shape materialized by Claude marketplace caches", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-archive-"));
    const source = path.join(parent, "source");
    const cache = path.join(parent, "cache");
    const archive = path.join(parent, "payload.tar");
    try {
      fs.mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(source, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.writeFileSync(path.join(source, "runtime.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      execFileSync("git", ["init", "-q", source]);
      execFileSync("git", ["-C", source, "config", "user.name", "Guild Test"]);
      execFileSync("git", ["-C", source, "config", "user.email", "guild-test@example.invalid"]);
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", ["-C", source, "commit", "-qm", "payload"]);
      const identity = writeNativeClaudePackageIdentity(source, "2.7.0-beta.14");
      execFileSync("git", ["-C", source, "add", NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE]);
      execFileSync("git", ["-C", source, "commit", "-qm", "identity"]);
      fs.mkdirSync(cache);
      execFileSync("git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, "HEAD"]);
      execFileSync("tar", ["-xf", archive, "-C", cache]);
      fs.symlinkSync("active-session", path.join(cache, ".in_use"));

      expect(readVerifiedNativeClaudePackageIdentity(cache)).toEqual(identity);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("detaches only typed release evidence records from the native payload identity", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-release-evidence-"));
    const source = path.join(parent, "source");
    const cache = path.join(parent, "cache");
    const archive = path.join(parent, "payload.tar");
    try {
      fs.mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(source, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0" }),
      );
      execFileSync("git", ["init", "-q", source]);
      execFileSync("git", ["-C", source, "config", "user.name", "Guild Test"]);
      execFileSync("git", ["-C", source, "config", "user.email", "guild-test@example.invalid"]);
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", ["-C", source, "commit", "-qm", "payload"]);
      const identity = writeNativeClaudePackageIdentity(source, "2.7.0");

      const evidenceDir = path.join(source, ".guild", "artifacts", "release", "v2.7.0");
      fs.mkdirSync(evidenceDir, { recursive: true });
      for (const name of ["release-basis", "scenario-documentation", "external-review"]) {
        fs.writeFileSync(path.join(evidenceDir, `${name}.json`), `${JSON.stringify({ name })}\n`);
      }
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", ["-C", source, "commit", "-qm", "release evidence"]);
      fs.mkdirSync(cache);
      execFileSync("git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, "HEAD"]);
      execFileSync("tar", ["-xf", archive, "-C", cache]);

      expect(readVerifiedNativeClaudePackageIdentity(cache)).toEqual(identity);

      fs.writeFileSync(path.join(cache, ".guild", "artifacts", "release", "v2.7.0", "payload.sh"), "exit 0\n");
      expect(() => readVerifiedNativeClaudePackageIdentity(cache)).toThrow(
        /native Claude complete payload digest differs/i,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("accepts only the lock-bound production runtime added to a native marketplace cache", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-locked-runtime-"));
    const source = path.join(parent, "source");
    const cache = path.join(parent, "cache");
    const archive = path.join(parent, "payload.tar");
    try {
      fs.mkdirSync(path.join(source, ".claude-plugin"), { recursive: true });
      fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
      fs.writeFileSync(
        path.join(source, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.copyFileSync(
        path.join(PLUGIN_ROOT, "scripts", "package-lock.json"),
        path.join(source, "scripts", "package-lock.json"),
      );
      fs.writeFileSync(path.join(source, ".gitignore"), "scripts/node_modules/\n");
      execFileSync("git", ["init", "-q", source]);
      execFileSync("git", ["-C", source, "config", "user.name", "Guild Test"]);
      execFileSync("git", ["-C", source, "config", "user.email", "guild-test@example.invalid"]);
      execFileSync("git", ["-C", source, "add", "."]);
      execFileSync("git", ["-C", source, "commit", "-qm", "payload"]);
      const identity = writeNativeClaudePackageIdentity(source, "2.7.0-beta.14");
      execFileSync("git", ["-C", source, "add", NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE]);
      execFileSync("git", ["-C", source, "commit", "-qm", "identity"]);
      fs.mkdirSync(cache);
      execFileSync("git", ["-C", source, "archive", "--format=tar", `--output=${archive}`, "HEAD"]);
      execFileSync("tar", ["-xf", archive, "-C", cache]);

      installLockedNativeRuntime(cache);

      expect(readVerifiedNativeClaudePackageIdentity(cache)).toEqual(identity);
      const installedLockPath = path.join(cache, "scripts", "node_modules", ".package-lock.json");
      const installedLock = fs.readFileSync(installedLockPath, "utf8");
      fs.writeFileSync(installedLockPath, installedLock.replace('"version": "2.0.1"', '"version": "2.0.0"'));
      expect(() => readVerifiedNativeClaudePackageIdentity(cache)).toThrow(
        /installed scripts package lock is not the exact production projection/i,
      );
      fs.writeFileSync(installedLockPath, installedLock);

      fs.symlinkSync(
        "../js-yaml/bin/js-yaml.js",
        path.join(cache, "scripts", "node_modules", ".bin", "tsx"),
      );
      expect(() => readVerifiedNativeClaudePackageIdentity(cache)).toThrow(
        /\.bin contains an unexpected or missing entry/i,
      );
      fs.rmSync(path.join(cache, "scripts", "node_modules", ".bin", "tsx"));

      fs.writeFileSync(path.join(cache, "scripts", "node_modules", "js-yaml", "index.js"), "tampered");
      expect(() => readVerifiedNativeClaudePackageIdentity(cache)).toThrow(
        /locked script runtime dependency digest differs for js-yaml/i,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("accepts only root Codex/Git cache metadata around an exact native payload", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-codex-cache-"));
    try {
      fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(root, "hooks"));
      fs.writeFileSync(path.join(root, "hooks", "guard.js"), "runtime");
      execFileSync("git", ["init", "-q", root]);
      execFileSync("git", ["-C", root, "config", "user.name", "Guild Test"]);
      execFileSync("git", ["-C", root, "config", "user.email", "guild-test@example.invalid"]);
      execFileSync("git", ["-C", root, "add", "."]);
      execFileSync("git", ["-C", root, "commit", "-qm", "payload"]);
      const identity = writeNativeClaudePackageIdentity(root, "2.7.0-beta.14");
      fs.writeFileSync(path.join(root, ".codex-marketplace-install.json"), "{}\n");
      fs.writeFileSync(path.join(root, "guild-install-receipt.json"), "{}\n");

      expect(readVerifiedNativeClaudePackageIdentity(root)).toEqual(identity);
      expect(resolveClaudePluginActivation(
        {
          GUILD_PLUGIN_ROOT: root,
          HOME: path.join(os.tmpdir(), "guild-nonexistent-home"),
        } as NodeJS.ProcessEnv,
        root,
      ).pluginRoot).toBe(fs.realpathSync(root));

      fs.mkdirSync(path.join(root, "hooks", ".git"));
      fs.writeFileSync(path.join(root, "hooks", ".git", "config"), "runtime lookalike");
      expect(() => readVerifiedNativeClaudePackageIdentity(root)).toThrow(
        /native Claude complete payload digest differs/i,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to emit an identity over pre-existing reserved host metadata", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-reserved-metadata-"));
    const owner = path.join(parent, "codex");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.writeFileSync(path.join(owner, ".codex-marketplace-install.json"), "unbound build input");
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      expect(() => writeSyntheticReleaseIdentity(owner, claude)).toThrow(
        /reserved host-managed metadata/i,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });
});

/** A scriptable fake `tmux` RunFn. `live` is mutated by kill-pane (unless killRemoves=false). */
function fakeTmux(opts: {
  live: Set<string>;
  killRemoves?: boolean;
  listFails?: boolean;
}): { run: RunFn; kills: string[] } {
  const kills: string[] = [];
  const run: RunFn = (cmd, args) => {
    if (cmd !== "tmux") return { status: 1, stdout: "", stderr: "not tmux" };
    const sub = args[0];
    if (sub === "-V") return { status: 0, stdout: "tmux 3.4\n", stderr: "" };
    if (sub === "list-panes") {
      if (opts.listFails) return { status: 1, stdout: "", stderr: "no server running" };
      return { status: 0, stdout: [...opts.live].join("\n") + (opts.live.size ? "\n" : ""), stderr: "" };
    }
    if (sub === "kill-pane") {
      const t = args[args.indexOf("-t") + 1];
      kills.push(t);
      if (opts.killRemoves !== false) opts.live.delete(t);
      return { status: 0, stdout: "", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, kills };
}

// ── AT14 — no lingering shell by default; opt-in debug shell is distinguishable ─

describe("paneCommand — worker pane teardown (deliverable 3 / AT14)", () => {
  it("does NOT append `exec $SHELL` by default — a completed worker's pane closes", () => {
    const c = paneCommand("do the thing", "run-1", undefined, "task-1", "backend", /* debug */ false);
    expect(c).not.toContain("exec $SHELL");
    // No launchArgs passed => byte-identical to paneCommand's pre-issue-#54
    // behavior (issue #54's flag-splicing is an explicit opt-in — see the
    // "host launch flags" describe block below).
    expect(c).toContain("claude 'do the thing'");
    // Ends on the worker invocation — nothing keeps the pane alive after it exits.
    expect(c.trimEnd().endsWith("claude 'do the thing'")).toBe(true);
  });

  it("opt-in debug shell retitles the pane to the debug sentinel so it is NOT a live worker", () => {
    const c = paneCommand("do the thing", "run-1", undefined, "task-1", "backend", /* debug */ true);
    expect(c).toContain("exec $SHELL"); // the operator shell only exists under opt-in
    expect(c).toContain(`${DEBUG_PANE_TITLE_PREFIX}backend`);
    expect(c).toContain("select-pane");
    expect(c).toContain("NOT a live worker");
  });

  it("paneDebugEnabled reads GUILD_PANE_DEBUG=1", () => {
    expect(paneDebugEnabled({ GUILD_PANE_DEBUG: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(paneDebugEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(paneDebugEnabled({ GUILD_PANE_DEBUG: "0" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("isDebugShellTitle distinguishes a debug shell title from a live worker title", () => {
    expect(isDebugShellTitle(`${DEBUG_PANE_TITLE_PREFIX}backend`)).toBe(true);
    expect(isDebugShellTitle("backend")).toBe(false);
    expect(isDebugShellTitle("orchestrator")).toBe(false);
  });
});

// ── issue #54 — host launch flags threaded into the pane command ────────────

describe("resolveTeamPaneHostMode — team-pane 'ask' lifts to 'bypass_all'", () => {
  it("the default config (no host_mode set) resolves to bypass_all", () => {
    expect(resolveTeamPaneHostMode(RUNTIME_DEFAULT_CONFIG)).toBe("bypass_all");
  });

  it("an explicit host_mode: 'ask' also lifts to bypass_all (same team-pane default)", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "ask" };
    expect(resolveTeamPaneHostMode(config)).toBe("bypass_all");
  });

  it("an explicit non-'ask' host_mode is honored verbatim, not overridden", () => {
    const readOnly: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "read_only" };
    expect(resolveTeamPaneHostMode(readOnly)).toBe("read_only");
    const acceptEdits: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    expect(resolveTeamPaneHostMode(acceptEdits)).toBe("accept_edits");
  });
});

describe("resolveClaudeTeamLaunchArgs — the Claude-only launch-flag resolver (issue #54)", () => {
  it("the default config (no host_mode set) resolves to the bypass flag", () => {
    expect(resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG)).toEqual(["--permission-mode", "bypassPermissions"]);
  });

  it("an explicit host_mode is honored — e.g. accept_edits maps to its own claude flag", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    expect(resolveClaudeTeamLaunchArgs(config)).toEqual(["--permission-mode", "acceptEdits"]);
  });
});

describe("resolveClaudePluginActivationArgs — exact local plugin activation", () => {
  it("turns one valid explicit Guild package root into --plugin-dir argv", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-activation-"));
    try {
      fs.mkdirSync(path.join(root, ".claude-plugin"));
      fs.writeFileSync(
        path.join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      writeNativeClaudeCacheIdentity(root);
      expectExactActivation(
        resolveClaudePluginActivationArgs(
          { CLAUDE_PLUGIN_ROOT: root } as NodeJS.ProcessEnv,
          root,
        ),
        root,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("activates the launcher-owned package when no root variable is present", () => {
    const owner = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-owner-fallback-"));
    try {
      fs.mkdirSync(path.join(owner, ".claude-plugin"));
      fs.writeFileSync(
        path.join(owner, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeNativeClaudeCacheIdentity(owner);
      expectExactActivation(
        resolveClaudePluginActivationArgs({} as NodeJS.ProcessEnv, owner),
        owner,
      );
    } finally {
      fs.rmSync(owner, { recursive: true, force: true });
    }
  });

  it("resolves a generated non-Claude owner to its identity-matched Claude sibling", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-packages-"));
    const owner = path.join(parent, "codex");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude);
      const activation = resolveClaudePluginActivation(
        { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
        owner,
      );
      expect(activation.pluginRoot).toBe(fs.realpathSync(claude));
      expectExactActivation(
        activation.args,
        claude,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("accepts identity-matched packages after hosts add only their root metadata", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-metadata-"));
    const owner = path.join(parent, "codex");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude);
      fs.writeFileSync(
        path.join(owner, ".codex-marketplace-install.json"),
        JSON.stringify({ source_type: "local" }),
      );
      fs.mkdirSync(path.join(claude, ".in_use"));
      fs.writeFileSync(path.join(claude, ".in_use", "12345"), "host-owned marker");

      expectExactActivation(
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
          owner,
        ),
        claude,
      );
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("resolves an isolated non-Claude install through Claude's registry despite a stale inherited alias", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-isolated-hosts-"));
    const owner = path.join(base, "codex-cache", "guild");
    const home = path.join(base, "home");
    const claude = path.join(home, ".claude", "plugins", "cache", "guild", "guild", "2.7.0-beta.14");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude);
      fs.writeFileSync(
        path.join(claude, "guild-install-receipt.json"),
        JSON.stringify({ schema_version: "guild.install_receipt.v1", version: "2.7.0-beta.14" }),
      );
      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: {
          "guild@guild": [{ scope: "user", installPath: claude, version: "2.7.0-beta.14" }],
        },
      }));
      expectExactActivation(
        resolveClaudePluginActivationArgs(
          {
            GUILD_PLUGIN_ROOT: owner,
            CLAUDE_PLUGIN_ROOT: path.join(base, "stale-claude-package"),
            HOME: home,
          } as NodeJS.ProcessEnv,
          owner,
        ),
        claude,
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("matches a native Claude marketplace cache without requiring .git", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-claude-cache-"));
    const owner = path.join(base, "codex-cache", "guild");
    const generatedClaude = path.join(base, "generated-claude");
    const nativeClaude = path.join(base, "native-claude");
    const home = path.join(base, "home");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(generatedClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(generatedClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(nativeClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(nativeClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(nativeClaude, "hooks"), { recursive: true });
      fs.writeFileSync(path.join(nativeClaude, "hooks", "guard.js"), "tracked-runtime");
      const nativePayloadDigest = writeNativeClaudeCacheIdentity(nativeClaude);
      fs.symlinkSync("active-session", path.join(nativeClaude, ".in_use"));
      writeSyntheticReleaseIdentity(
        owner,
        generatedClaude,
        {},
        "codex",
        "d".repeat(40),
        nativePayloadDigest,
      );
      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: {
          "guild@guild": [{
            scope: "user",
            installPath: nativeClaude,
            version: "2.7.0-beta.14",
          }],
        },
      }));

      expectExactActivation(
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner, HOME: home } as NodeJS.ProcessEnv,
          owner,
        ),
        nativeClaude,
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("treats only physical root Git metadata as non-runtime package metadata", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-worktree-metadata-"));
    const root = path.join(base, "package");
    const gitDir = path.join(base, "worktree-git-dir");
    try {
      fs.mkdirSync(root);
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(root, "runtime.js"), "exact-runtime");
      const expected = computePhysicalNativeClaudePayloadDigest(root);

      fs.writeFileSync(path.join(root, ".git"), `gitdir: ${gitDir}\n`);
      expect(computePhysicalNativeClaudePayloadDigest(root)).toBe(expected);

      fs.rmSync(path.join(root, ".git"));
      fs.symlinkSync("runtime.js", path.join(root, ".git"));
      expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
        /native Claude package root \.git metadata.*physical/i,
      );

      fs.rmSync(path.join(root, ".git"));
      fs.writeFileSync(path.join(root, ".git"), "not a worktree pointer\n");
      expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
        /not a valid worktree pointer/i,
      );
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a modified native Claude marketplace payload", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-dirty-native-claude-"));
    const owner = path.join(base, "codex-cache", "guild");
    const generatedClaude = path.join(base, "generated-claude");
    const nativeClaude = path.join(base, "native-claude");
    const home = path.join(base, "home");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(generatedClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(generatedClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(nativeClaude, ".claude-plugin"), { recursive: true });
      fs.mkdirSync(path.join(nativeClaude, "hooks"), { recursive: true });
      fs.writeFileSync(
        path.join(nativeClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.writeFileSync(path.join(nativeClaude, "hooks", "guard.js"), "original");
      const nativePayloadDigest = writeNativeClaudeCacheIdentity(nativeClaude);
      writeSyntheticReleaseIdentity(
        owner,
        generatedClaude,
        {},
        "codex",
        "d".repeat(40),
        nativePayloadDigest,
      );
      fs.writeFileSync(path.join(nativeClaude, "hooks", "guard.js"), "modified");

      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: {
          "guild@guild": [{
            scope: "user",
            installPath: nativeClaude,
            version: "2.7.0-beta.14",
          }],
        },
      }));

      expect(() => resolveClaudePluginActivationArgs(
        { GUILD_PLUGIN_ROOT: owner, HOME: home } as NodeJS.ProcessEnv,
        owner,
      )).toThrow(/native Claude complete payload digest differs/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a developer checkout with an ignored executable tsx runtime", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-dirty-native-runtime-"));
    const owner = path.join(base, "codex-cache", "guild");
    const generatedClaude = path.join(base, "generated-claude");
    const nativeClaude = path.join(base, "native-claude");
    const home = path.join(base, "home");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(generatedClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(generatedClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(nativeClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(nativeClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      const nativePayloadDigest = writeNativeClaudeCacheIdentity(nativeClaude);
      writeSyntheticReleaseIdentity(
        owner,
        generatedClaude,
        {},
        "codex",
        "d".repeat(40),
        nativePayloadDigest,
      );
      const bin = path.join(nativeClaude, "scripts", "node_modules", ".bin");
      fs.mkdirSync(bin, { recursive: true });
      fs.symlinkSync("../tsx/dist/cli.mjs", path.join(bin, "tsx"));

      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: {
          "guild@guild": [{
            scope: "user",
            installPath: nativeClaude,
            version: "2.7.0-beta.14",
          }],
        },
      }));

      expect(() => resolveClaudePluginActivationArgs(
        { GUILD_PLUGIN_ROOT: owner, HOME: home } as NodeJS.ProcessEnv,
        owner,
      )).toThrow(/locked native script runtime contains an unexpected or missing root entry/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", false],
    ["mismatched", true],
  ])("refuses a native Claude install with a %s payload identity", (_label, mismatched) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-native-claude-refusal-"));
    const owner = path.join(base, "codex-cache", "guild");
    const generatedClaude = path.join(base, "generated-claude");
    const nativeClaude = path.join(base, "native-claude");
    const home = path.join(base, "home");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(generatedClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(generatedClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(nativeClaude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(nativeClaude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      const nativePayloadDigest = mismatched
        ? writeNativeClaudeCacheIdentity(nativeClaude)
        : `sha256:${"d".repeat(64)}`;
      writeSyntheticReleaseIdentity(
        owner,
        generatedClaude,
        {},
        "codex",
        "d".repeat(40),
        mismatched ? `sha256:${"e".repeat(64)}` : nativePayloadDigest,
      );
      if (!mismatched) {
        fs.rmSync(path.join(nativeClaude, NATIVE_CLAUDE_PACKAGE_IDENTITY_FILE), { force: true });
      }
      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: {
          "guild@guild": [{
            scope: "user",
            installPath: nativeClaude,
            version: "2.7.0-beta.14",
          }],
        },
      }));

      expect(() => resolveClaudePluginActivationArgs(
        { GUILD_PLUGIN_ROOT: owner, HOME: home } as NodeJS.ProcessEnv,
        owner,
      )).toThrow(/no identity-matched installed Claude package|payload identity does not match/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a registry package with matching version but different generated runtime identity", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-registry-identity-mismatch-"));
    const owner = path.join(base, "codex-cache", "guild");
    const home = path.join(base, "home");
    const claude = path.join(home, ".claude", "plugins", "cache", "guild", "guild", "2.7.0-beta.14");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude);
      fs.writeFileSync(path.join(claude, "hooks", "hooks.json"), "different-security-hooks");
      const registry = path.join(home, ".claude", "plugins", "installed_plugins.json");
      fs.mkdirSync(path.dirname(registry), { recursive: true });
      fs.writeFileSync(registry, JSON.stringify({
        version: 2,
        plugins: { "guild@guild": [{ scope: "user", installPath: claude }] },
      }));
      expect(() =>
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner, HOME: home } as NodeJS.ProcessEnv,
          owner,
        ),
      ).toThrow(/complete package digest differs/i);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a generated Claude sibling from a different release", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-host-version-mismatch-"));
    const owner = path.join(parent, "codex");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude);
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      rewriteSyntheticIdentity(claude, (identity) => {
        identity.release_version = "2.7.0-beta.13";
      });
      expect(() =>
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
          owner,
        ),
      ).toThrow(/complete release identities do not match/i);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses a non-Codex owner whose host manifest version differs from the release identity", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pi-version-mismatch-"));
    const owner = path.join(parent, "pi");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(owner, { recursive: true });
      fs.writeFileSync(
        path.join(owner, "pi-manifest.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      writeSyntheticReleaseIdentity(owner, claude, {}, "pi");
      fs.writeFileSync(
        path.join(owner, "pi-manifest.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      const ownerIdentityPath = path.join(owner, RELEASE_PACKAGE_IDENTITY_FILE);
      const claudeIdentityPath = path.join(claude, RELEASE_PACKAGE_IDENTITY_FILE);
      const ownerIdentity = JSON.parse(fs.readFileSync(ownerIdentityPath, "utf8")) as Record<string, any>;
      ownerIdentity.package_digests.pi = computeReleasePackageDigest(owner);
      ownerIdentity.release_id = computeReleaseIdentityId(
        ownerIdentity.release_version,
        ownerIdentity.package_digests,
        ownerIdentity.source_commit ?? null,
        ownerIdentity.native_claude_payload_digest,
      );
      fs.writeFileSync(ownerIdentityPath, `${JSON.stringify(ownerIdentity, null, 2)}\n`);
      const claudeIdentity = JSON.parse(fs.readFileSync(claudeIdentityPath, "utf8")) as Record<string, any>;
      claudeIdentity.package_digests = ownerIdentity.package_digests;
      claudeIdentity.release_id = ownerIdentity.release_id;
      fs.writeFileSync(claudeIdentityPath, `${JSON.stringify(claudeIdentity, null, 2)}\n`);
      expect(() =>
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
          owner,
        ),
      ).toThrow(/manifest version.*release identity/i);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("refuses a same-release Claude package when any shipped runtime file changes", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "guild-full-runtime-mismatch-"));
    const owner = path.join(parent, "codex");
    const claude = path.join(parent, "claude-code");
    try {
      fs.mkdirSync(path.join(owner, ".codex-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(owner, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, ".claude-plugin"), { recursive: true });
      fs.writeFileSync(
        path.join(claude, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(claude, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(claude, "scripts", "package.json"), "original-runtime");
      writeSyntheticReleaseIdentity(owner, claude);
      fs.writeFileSync(path.join(claude, "scripts", "package.json"), "tampered-runtime");
      expect(() =>
        resolveClaudePluginActivationArgs(
          { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
          owner,
        ),
      ).toThrow(/complete package digest differs/i);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("fails closed on a missing explicit package root instead of silently launching the installed plugin", () => {
    expect(() =>
      resolveClaudePluginActivationArgs({
        GUILD_PLUGIN_ROOT: path.join(os.tmpdir(), "guild-missing-exact-package"),
      } as NodeJS.ProcessEnv),
    ).toThrow(/explicit Guild plugin root.*invalid/i);
  });

  it("refuses a foreign explicit Guild root even when the inherited Claude alias matches the launcher", () => {
    const first = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-first-"));
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-second-"));
    try {
      for (const root of [first, second]) {
        fs.mkdirSync(path.join(root, ".claude-plugin"));
        fs.writeFileSync(
          path.join(root, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
        );
      }
      expect(() =>
        resolveClaudePluginActivationArgs({
          CLAUDE_PLUGIN_ROOT: first,
          GUILD_PLUGIN_ROOT: second,
        } as NodeJS.ProcessEnv, first),
      ).toThrow(/does not match.*owns the launcher/i);
    } finally {
      fs.rmSync(first, { recursive: true, force: true });
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  it("prefers launcher-owned GUILD_PLUGIN_ROOT over an inherited foreign Claude alias", () => {
    const inherited = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-inherited-"));
    const owner = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-owner-"));
    try {
      for (const root of [inherited, owner]) {
        fs.mkdirSync(path.join(root, ".claude-plugin"));
        fs.writeFileSync(
          path.join(root, ".claude-plugin", "plugin.json"),
          JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
        );
      }
      writeNativeClaudeCacheIdentity(owner);
      expectExactActivation(
        resolveClaudePluginActivationArgs({
          CLAUDE_PLUGIN_ROOT: inherited,
          GUILD_PLUGIN_ROOT: owner,
        } as NodeJS.ProcessEnv, owner),
        owner,
      );
    } finally {
      fs.rmSync(inherited, { recursive: true, force: true });
      fs.rmSync(owner, { recursive: true, force: true });
    }
  });

  it("refuses one valid Guild package when it is not the package that owns the launcher", () => {
    const owner = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-owner-"));
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-foreign-"));
    try {
      fs.mkdirSync(path.join(owner, ".claude-plugin"));
      fs.writeFileSync(
        path.join(owner, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.14" }),
      );
      fs.mkdirSync(path.join(foreign, ".claude-plugin"));
      fs.writeFileSync(
        path.join(foreign, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      expect(() =>
        resolveClaudePluginActivationArgs(
          { CLAUDE_PLUGIN_ROOT: foreign } as NodeJS.ProcessEnv,
          owner,
        ),
      ).toThrow(/does not match.*owns the launcher/i);
    } finally {
      fs.rmSync(owner, { recursive: true, force: true });
      fs.rmSync(foreign, { recursive: true, force: true });
    }
  });

  it("refuses a symlinked plugin manifest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-plugin-symlink-manifest-"));
    const manifestTarget = path.join(root, "manifest-target.json");
    try {
      fs.mkdirSync(path.join(root, ".claude-plugin"));
      fs.writeFileSync(
        manifestTarget,
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      fs.symlinkSync(manifestTarget, path.join(root, ".claude-plugin", "plugin.json"));
      expect(() =>
        resolveClaudePluginActivationArgs(
          { CLAUDE_PLUGIN_ROOT: root } as NodeJS.ProcessEnv,
          root,
        ),
      ).toThrow(/manifest is not a physical regular file/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("paneCommand — launchArgs splicing (issue #54: an explicit opt-in, not a new default)", () => {
  it("refuses plugin activation argv without the paired child GUILD_PLUGIN_ROOT", () => {
    expect(() => paneCommand(
      "do the work", "run-1", undefined, "task-1", "backend", false,
      ["--plugin-dir", "/tmp/claude-package"],
    )).toThrow(/plugin-dir.*GUILD_PLUGIN_ROOT/i);
  });

  it("with no launchArgs, paneCommand is UNCHANGED from its pre-issue-#54 shape (bare claude invocation)", () => {
    const c = paneCommand("do the work", "run-1", undefined, "task-1", "backend");
    expect(c).toContain("claude 'do the work'");
    expect(c).not.toContain("--permission-mode");
  });

  it("an explicit launchArgs is spliced between the binary and the prompt", () => {
    const c = paneCommand(
      "do the work",
      "run-1",
      undefined,
      "task-1",
      "backend",
      /* debug */ false,
      resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG),
    );
    expect(c).toContain("claude --permission-mode bypassPermissions 'do the work'");
  });

  it("prompt quoting stays intact when flags are inserted ahead of the prompt", () => {
    const trickyPrompt = "do the work; then 'quote' this $VAR";
    const c = paneCommand(
      trickyPrompt,
      "run-1",
      undefined,
      "task-1",
      "backend",
      /* debug */ false,
      resolveClaudeTeamLaunchArgs(RUNTIME_DEFAULT_CONFIG),
    );
    // The whole prompt is a single shell-quoted argument, immediately after the
    // resolved flags — no unescaped shell metacharacters leak into the pane command.
    const quotedPrompt = `'${trickyPrompt.replace(/'/g, "'\\''")}'`;
    expect(c).toContain(`claude --permission-mode bypassPermissions ${quotedPrompt}`);
    expect(c.trimEnd().endsWith(quotedPrompt)).toBe(true);
  });

  it("each launchArgs token is independently shell-quoted, not just the prompt", () => {
    // A hostile-shaped launch arg (spaces, quotes, $(), ;) — if `launchArgs.map(shellQuote)`
    // were ever removed in favor of a naive `.join(" ")`, this would inject.
    const hostileArg = "--foo=bar; rm -rf / $(whoami) 'x'";
    const c = paneCommand("do the work", "run-1", undefined, "task-1", "backend", false, [hostileArg]);
    const quotedArg = `'${hostileArg.replace(/'/g, "'\\''")}'`;
    expect(c).toContain(`claude ${quotedArg} 'do the work'`);
    // Not present unquoted/raw anywhere in the command.
    expect(c).not.toContain(`claude ${hostileArg} `);
  });
});

describe("composeTmuxCommands — the real builder the launcher uses, per launch mode", () => {
  const baseOpts = {
    targetName: "guild-team",
    cwd: "/repo",
    slug: "my-slug",
    runId: "run-1",
    specialists: [{ name: "backend", scope: "backend work" } as never],
  };

  it("new-session mode: every pane command carries the resolved claude launch flags", () => {
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "new-session" });
    const orchestratorCmd = cmds[0]!.argv[cmds[0]!.argv.length - 1]!;
    expect(orchestratorCmd).toContain("claude --permission-mode bypassPermissions");

    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const paneArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(paneArg).toContain("claude --permission-mode bypassPermissions");
  });

  it("in-session mode: every pane command (orchestrator AND teammate split panes) carries the resolved flags", () => {
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "in-session" });
    const newWindowCmd = cmds.find((c) => c.argv[1] === "new-window")!;
    const orchestratorArg = newWindowCmd.argv[newWindowCmd.argv.length - 1]!;
    expect(orchestratorArg).toContain("claude --permission-mode bypassPermissions");

    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const teammateArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(teammateArg).toContain("claude --permission-mode bypassPermissions");
  });

  it("activates the exact explicit plugin package in every local Claude pane", () => {
    const pluginDir = "/tmp/Guild beta.13 exact package";
    const cmds = composeTmuxCommands({
      ...baseOpts,
      mode: "in-session",
      claudePluginActivationArgs: ["--plugin-dir", pluginDir],
      claudePluginRoot: pluginDir,
    });
    const claudeCommands = cmds
      .filter((command) => command.argv[1] === "new-window" || command.argv[1] === "split-window")
      .map((command) => command.argv[command.argv.length - 1]!);
    expect(claudeCommands).toHaveLength(2);
    for (const command of claudeCommands) {
      expect(command).toContain(
        "claude --plugin-dir '/tmp/Guild beta.13 exact package' --permission-mode bypassPermissions",
      );
      expect(command).toContain("export GUILD_PLUGIN_ROOT='/tmp/Guild beta.13 exact package';");
    }
  });

  it("an explicit non-default permissionConfig flows through to every pane", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    const cmds = composeTmuxCommands({ ...baseOpts, mode: "new-session", permissionConfig: config });
    const splitCmd = cmds.find((c) => c.argv[1] === "split-window")!;
    const paneArg = splitCmd.argv[splitCmd.argv.length - 1]!;
    expect(paneArg).toContain("claude --permission-mode acceptEdits");
    expect(paneArg).not.toContain("bypassPermissions");
  });

  // Issue #54 (round 4): a LOCAL mixed-host team's claude pane still gets the
  // resolved launch flags — composeTmuxCommands intercepts every "claude"
  // host_kind before it ever consults resolveAdapter, so the resolver is
  // called ONLY for the non-claude (codex) pane. Guards both directions:
  // (a) the claude pane never reaches the mock resolver at all, and (b) the
  // codex pane DOES reach it, with no permissionConfig-derived flags leaking
  // into what the mock returns.
  it("a local mixed-host team: the claude pane bypasses the resolver and still gets flags; the codex pane still routes through it", () => {
    const config: RuntimePermissionConfig = { ...RUNTIME_DEFAULT_CONFIG, host_mode: "accept_edits" };
    const seenSpecs: Array<{ name: string; hostKind: string }> = [];
    const cmds = composeTmuxCommands({
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      mode: "new-session",
      permissionConfig: config,
      specialists: [
        { name: "backend", scope: "backend work" } as never,
        { name: "security", scope: "audit", host_kind: "codex" } as never,
      ],
      resolveAdapter: () => ({
        hostKind: "codex",
        adapterVersion: "test",
        preflight: () => ({ ok: true, message: "ok" }),
        command: (spec) => {
          seenSpecs.push({ name: spec.name, hostKind: spec.hostKind });
          return `codex exec ${spec.prompt}`; // bare — proving no claude-flag leakage
        },
        env: () => ({}),
        expectedOutputs: () => [],
      }),
    });

    // The mock resolver was called ONLY for the codex pane, never for claude.
    expect(seenSpecs).toEqual([{ name: "security", hostKind: "codex" }]);

    const splitCmds = cmds.filter((c) => c.argv[1] === "split-window");
    const backendCmd = splitCmds.find((c) => c.argv[c.argv.length - 1]!.includes("backend work"))!;
    expect(backendCmd.argv[backendCmd.argv.length - 1]).toContain("claude --permission-mode acceptEdits");

    const codexCmd = splitCmds.find((c) => c.argv[c.argv.length - 1]!.includes("codex exec"))!;
    expect(codexCmd.argv[codexCmd.argv.length - 1]).not.toContain("--permission-mode");
    expect(codexCmd.argv[codexCmd.argv.length - 1]).not.toContain("acceptEdits");
  });
});

// ── issue #54 — TmuxTeamBackend.plan(), composeTmuxCommands's real caller ───

describe("TmuxTeamBackend.plan() — the real launcher call chain resolves the same flags", () => {
  it("a plain-Claude team's plan() carries the resolved bypass flags on every pane, end-to-end", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-generated-owner-"));
    try {
      const owner = createGeneratedClaudeOwner(parent);
      const backend = new TmuxTeamBackend({
        env: { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
        pluginOwnerRoot: owner,
      });
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: "/repo",
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
      expect(orchestratorCmd).toContain("--plugin-dir");
      expect(orchestratorCmd).toContain('enabledPlugins":{"guild@guild":false');
      expect(orchestratorCmd).toContain("--permission-mode bypassPermissions");

      const splitCmd = plan.commands.find((c) => c.argv[1] === "split-window")!;
      const teammateCmd = splitCmd.argv[splitCmd.argv.length - 1]!;
      expect(teammateCmd).toContain("--plugin-dir");
      expect(teammateCmd).toContain("--permission-mode bypassPermissions");
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it("threads the exact explicit Guild package through the real plan() caller", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-exact-plugin-"));
    try {
      fs.mkdirSync(path.join(root, ".claude-plugin"));
      fs.writeFileSync(
        path.join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "guild", version: "2.7.0-beta.13" }),
      );
      writeNativeClaudeCacheIdentity(root);
      const backend = new TmuxTeamBackend({
        env: { CLAUDE_PLUGIN_ROOT: root, GUILD_PLUGIN_ROOT: root } as NodeJS.ProcessEnv,
        pluginOwnerRoot: root,
      });
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: root,
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      for (const command of plan.commands.filter(
        (candidate) => candidate.argv[1] === "new-session" || candidate.argv[1] === "split-window",
      )) {
        expect(command.argv[command.argv.length - 1]).toContain(
          `--plugin-dir ${fs.realpathSync(root)} --permission-mode bypassPermissions`,
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses plan emission when an explicit package root is invalid", () => {
    const backend = new TmuxTeamBackend({
      env: { CLAUDE_PLUGIN_ROOT: path.join(os.tmpdir(), "missing-guild-package") } as NodeJS.ProcessEnv,
    });
    expect(() => backend.plan({
      mode: "new-session",
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      specialists: [{ name: "backend", scope: "backend work" } as never],
      dryRun: true,
    })).toThrow(/explicit Guild plugin root.*invalid/i);
  });

  it("returns a structured launch failure when exact-package planning refuses", () => {
    const backend = new TmuxTeamBackend({
      env: { GUILD_PLUGIN_ROOT: path.join(os.tmpdir(), "missing-launch-package") } as NodeJS.ProcessEnv,
    });
    const result = backend.launch({
      mode: "new-session",
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      specialists: [{ name: "backend", scope: "backend work" } as never],
      dryRun: true,
    });
    expect(result).toMatchObject({
      kind: "tmux",
      ok: false,
      plannedCommands: [],
      orchestratorPaneId: null,
      teammatePaneIds: {},
      dispatchPlan: [],
    });
    expect(result.notes.join(" ")).toMatch(/tmux plan failed.*explicit Guild plugin root.*invalid/i);
  });

  it("does not validate Claude activation for an all-Codex plan", () => {
    const backend = new TmuxTeamBackend({
      env: { GUILD_PLUGIN_ROOT: path.join(os.tmpdir(), "stale-guild-package") } as NodeJS.ProcessEnv,
      resolveAdapter: () => ({
        hostKind: "codex",
        adapterVersion: "test",
        preflight: () => ({ ok: true, message: "ok" }),
        command: (spec) => `codex exec ${spec.prompt}`,
        env: () => ({}),
        expectedOutputs: () => [],
      }),
    });
    const plan = backend.plan({
      mode: "new-session",
      targetName: "guild-team",
      cwd: "/repo",
      slug: "my-slug",
      runId: "run-1",
      orchestratorHostKind: "codex",
      specialists: [{ name: "backend", scope: "backend work", host_kind: "codex" } as never],
      dryRun: true,
    });
    for (const command of plan.commands) {
      expect(command.argv.join(" ")).not.toContain("--plugin-dir");
    }
  });

  // rf-wi-01 (G1 codex-review fix, P1) — plan() now actually reads the project's
  // registered `host_mode` (readRuntimePermissionConfig(req.cwd)) instead of
  // always defaulting to RUNTIME_DEFAULT_CONFIG. Before the fix, `config show
  // --sources` could report a configured host_mode while the real dispatch path
  // silently ignored it and launched bypassed anyway.
  it("an explicit non-'ask' host_mode in the project's settings.json is honored verbatim on the real pane", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-backend-host-mode-"));
    try {
      fs.mkdirSync(path.join(root, ".guild"), { recursive: true });
      fs.writeFileSync(path.join(root, ".guild", "settings.json"), JSON.stringify({ host_mode: "read_only" }));
      const owner = createGeneratedClaudeOwner(root);
      const backend = new TmuxTeamBackend({
        env: { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
        pluginOwnerRoot: owner,
      });
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: root,
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
      // resolveHostLaunch("claude", "read_only") -> ["--tools", "Read,Grep,Glob"], NOT bypassPermissions.
      // codex round-2 P2 fix: a POSITIVE assertion — the earlier not.toContain alone
      // would also pass for a bare `claude` command with no flags at all.
      expect(orchestratorCmd).toContain("--plugin-dir");
      expect(orchestratorCmd).toContain("--tools Read,Grep,Glob");
      expect(orchestratorCmd).not.toContain("bypassPermissions");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("no settings.json at all still falls back to the unset->bypass_all team-pane default", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmux-backend-no-settings-"));
    try {
      const owner = createGeneratedClaudeOwner(root);
      const backend = new TmuxTeamBackend({
        env: { GUILD_PLUGIN_ROOT: owner } as NodeJS.ProcessEnv,
        pluginOwnerRoot: owner,
      });
      const plan = backend.plan({
        mode: "new-session",
        targetName: "guild-team",
        cwd: root,
        slug: "my-slug",
        runId: "run-1",
        specialists: [{ name: "backend", scope: "backend work" } as never],
        dryRun: true,
      });
      const orchestratorCmd = plan.commands[0]!.argv[plan.commands[0]!.argv.length - 1]!;
      expect(orchestratorCmd).toContain("--plugin-dir");
      expect(orchestratorCmd).toContain("--permission-mode bypassPermissions");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── terminatePane — real kill + confirm (deliverable 2) ──────────────────────

describe("terminatePane — kills the pane and confirms its death", () => {
  it("kills a live pane and confirms it is gone", () => {
    const { run, kills } = fakeTmux({ live: new Set(["%1", "%2"]) });
    const out = terminatePane("%1", { run });
    expect(kills).toEqual(["%1"]);
    expect(out.ok).toBe(true);
    expect(out.confirmed).toBe(true);
    expect(out.mechanism).toBe("tmux kill-pane");
    expect(out.degraded).toBe(false);
  });

  it("is idempotent — an already-dead pane confirms with zero kills", () => {
    const { run, kills } = fakeTmux({ live: new Set(["%2"]) });
    const out = terminatePane("%1", { run });
    expect(kills).toEqual([]); // pane already absent — no kill issued
    expect(out.ok).toBe(true);
    expect(out.confirmed).toBe(true);
    expect(out.polls).toBe(0);
  });

  it("refuses a dry-run placeholder pane id", () => {
    const { run } = fakeTmux({ live: new Set(["%1"]) });
    const out = terminatePane("(dry-run: not spawned)", { run });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/placeholder/);
  });

  it("records a DEGRADATION when tmux is unavailable (host-unavailable, D5)", () => {
    const { run } = fakeTmux({ live: new Set(["%1"]), listFails: true });
    const out = terminatePane("%1", { run });
    expect(out.ok).toBe(false);
    expect(out.degraded).toBe(true);
    expect(out.error).toMatch(/unavailable/i);
  });
});

// ── AT6 — a kill that does not confirm is an orphan; the reaper retries ───────

describe("AT6 — terminate fails → orphan → reaper retry → terminated", () => {
  it("returns an unconfirmed orphan when the pane survives the kill, then confirms on retry", () => {
    // First attempt: kill does NOT remove the pane (survives) → orphan.
    const live = new Set(["%1"]);
    const first = fakeTmux({ live, killRemoves: false });
    const orphan = terminatePane("%1", { run: first.run, pollAttempts: 3 });
    expect(first.kills).toEqual(["%1"]);
    expect(orphan.ok).toBe(false);
    expect(orphan.confirmed).toBe(false);
    expect(orphan.degraded).toBe(false);
    expect(orphan.polls).toBe(3);
    expect(isPaneAlive("%1", first.run)).toBe(true); // still live — must be reaped

    // Reaper retry: kill now lands → confirmed terminated.
    const retry = fakeTmux({ live, killRemoves: true });
    const done = terminatePane("%1", { run: retry.run });
    expect(done.ok).toBe(true);
    expect(done.confirmed).toBe(true);
    expect(isPaneAlive("%1", retry.run)).toBe(false);
  });
});

// ── liveness helpers ─────────────────────────────────────────────────────────

describe("livePaneIds / isPaneAlive", () => {
  it("returns the live set, or null when tmux errors", () => {
    const ok = fakeTmux({ live: new Set(["%1", "%2"]) });
    expect(livePaneIds(ok.run)).toEqual(new Set(["%1", "%2"]));
    const bad = fakeTmux({ live: new Set(), listFails: true });
    expect(livePaneIds(bad.run)).toBeNull();
    expect(isPaneAlive("%1", bad.run)).toBe(false); // fail-closed
  });
});
