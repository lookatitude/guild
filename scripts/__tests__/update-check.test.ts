/**
 * scripts/__tests__/update-check.test.ts
 *
 * Channel-aware update detection (plugin-update-lifecycle G1/G1-CH/G1-ALL):
 * semver + ls-remote parsing, .git HEAD channel resolution (loose + packed
 * refs, detached, dev-vs-managed), receipt fallback, cache TTL, the staleness
 * decision per channel, fail-open refresh, and the AC-3 signal line.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  branchToChannel,
  cacheIsFresh,
  computeSignal,
  latestStableTag,
  parseLsRemote,
  parseSemver,
  readNativeHostIdentity,
  readGitHead,
  refreshCache,
  renderSignalLine,
  resolveInstallState,
  semverLt,
  CACHE_SCHEMA,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  type InstallState,
  type UpdateCache,
} from "../lib/update-check";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cacheWith(remote: Partial<UpdateCache["remote"]>, checkedAt = new Date().toISOString()): UpdateCache {
  return {
    schema_version: CACHE_SCHEMA,
    checked_at: checkedAt,
    source_repo: "repo",
    remote: { latest_tag: null, next_head_sha: null, main_head_sha: null, ...remote },
  };
}

describe("semver + ls-remote parsing", () => {
  it("parses and orders semver; ignores prereleases for latestStableTag", () => {
    expect(parseSemver("v2.1.0")).toEqual([2, 1, 0]);
    expect(parseSemver("v2.1.0-rc1")).toBeNull();
    expect(semverLt("2.0.9", "v2.1.0")).toBe(true);
    expect(semverLt("v2.10.0", "v2.9.9")).toBe(false);
    expect(latestStableTag(["v1.0.0", "v2.1.0-rc1", "v2.0.1", "v2.1.0"])).toBe("v2.1.0");
  });

  // REGRESSION (gap-audit B5 / cap-loc-D12): the beta channel now carries a
  // prerelease identifier (2.5.0-beta.1) so the two channels are distinguishable
  // from the manifest. semverLt used to parse through parseSemver, which REJECTS
  // prereleases, and an unparseable input yields false — so every prerelease
  // install compared as "not older than anything" and reported up-to-date
  // forever. That is the same silent-staleness class the Codex update-check work
  // fixed (an install stuck at 2.2.0 while stable shipped 2.3.2).
  it("orders prerelease versions per SemVer §11 so a beta install can go stale", () => {
    // The actual regression: a beta install vs a much newer stable tag.
    expect(semverLt("2.5.0-beta.1", "99.0.0")).toBe(true);
    expect(semverLt("2.5.0-beta.1", "v2.6.0")).toBe(true);
    // Equal triples: a prerelease precedes its own release, and not vice versa.
    expect(semverLt("2.5.0-beta.1", "2.5.0")).toBe(true);
    expect(semverLt("2.5.0", "2.5.0-beta.1")).toBe(false);
    // Numeric identifiers compare NUMERICALLY (the reason for the dot form).
    expect(semverLt("2.5.0-beta.9", "2.5.0-beta.10")).toBe(true);
    expect(semverLt("2.5.0-beta.10", "2.5.0-beta.9")).toBe(false);
    // A longer identifier list wins when the shared prefix is equal.
    expect(semverLt("2.5.0-beta", "2.5.0-beta.1")).toBe(true);
    // A beta is never behind an OLDER stable.
    expect(semverLt("2.5.0-beta.1", "2.4.0")).toBe(false);
    // parseSemver stays strict — latestStableTag depends on that rejection.
    expect(parseSemver("2.5.0-beta.1")).toBeNull();
    expect(latestStableTag(["v2.5.0-beta.1", "v2.4.0"])).toBe("v2.4.0");
  });

  it("parses ls-remote output: tags (skipping ^{} peels), next and main heads", () => {
    const raw = [
      `${SHA_A}\trefs/heads/main`,
      `${SHA_B}\trefs/heads/next`,
      `${"c".repeat(40)}\trefs/tags/v2.0.1`,
      `${"d".repeat(40)}\trefs/tags/v2.1.0`,
      `${"e".repeat(40)}\trefs/tags/v2.1.0^{}`,
      `${"f".repeat(40)}\trefs/tags/not-a-version`,
    ].join("\n");
    const r = parseLsRemote(raw);
    expect(r.main_head_sha).toBe(SHA_A);
    expect(r.next_head_sha).toBe(SHA_B);
    expect(r.latest_tag).toBe("v2.1.0");
  });
});

describe("readGitHead + channel resolution", () => {
  function gitDirWith(head: string, extra: Record<string, string> = {}): string {
    const dir = mkTmp("guild-gitdir-");
    fs.mkdirSync(path.join(dir, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(dir, "HEAD"), head);
    for (const [rel, content] of Object.entries(extra)) {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    return dir;
  }

  it("resolves a loose ref", () => {
    const dir = gitDirWith("ref: refs/heads/next\n", { "refs/heads/next": `${SHA_B}\n` });
    expect(readGitHead(dir)).toEqual({ branch: "next", sha: SHA_B });
  });

  it("resolves a packed ref", () => {
    const dir = gitDirWith("ref: refs/heads/main\n", {
      "packed-refs": `# pack-refs\n${SHA_A} refs/heads/main\n`,
    });
    expect(readGitHead(dir)).toEqual({ branch: "main", sha: SHA_A });
  });

  it("handles detached HEAD", () => {
    const dir = gitDirWith(`${SHA_A}\n`);
    expect(readGitHead(dir)).toEqual({ branch: null, sha: SHA_A });
  });

  it("resolves a WORKTREE-shaped .git FILE (gitdir pointer + commondir refs)", () => {
    // Real git worktree: .git is a FILE → gitdir → private dir with HEAD +
    // commondir → shared refs. A misread here silently downgraded beta→stable
    // (codex G-lane MAJOR).
    const repo = mkTmp("guild-wtrepo-");
    const common = path.join(repo, ".git");
    fs.mkdirSync(path.join(common, "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(common, "refs", "heads", "next"), `${SHA_B}\n`);
    const wtGit = path.join(common, "worktrees", "wt1");
    fs.mkdirSync(wtGit, { recursive: true });
    fs.writeFileSync(path.join(wtGit, "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(wtGit, "commondir"), "../..\n");

    const wt = mkTmp("guild-wt-");
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${wtGit}\n`);

    const { resolveGitDir } = require("../lib/update-check");
    const resolved = resolveGitDir(path.join(wt, ".git"));
    expect(resolved).toBe(wtGit);
    expect(readGitHead(resolved!)).toEqual({ branch: "next", sha: SHA_B });
  });

  it("maps branches to channels: next → beta, anything else → stable", () => {
    expect(branchToChannel("next")).toBe("beta");
    expect(branchToChannel("main")).toBe("stable");
    expect(branchToChannel(null)).toBe("stable");
  });
});

describe("resolveInstallState", () => {
  function plantPlugin(root: string, version = "2.1.0"): void {
    fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "guild", version })
    );
  }

  it("a git checkout OUTSIDE the managed area is a dev install (AC-5)", () => {
    const home = mkTmp("guild-home-");
    const root = mkTmp("guild-devroot-");
    plantPlugin(root);
    fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(root, ".git", "refs", "heads", "next"), `${SHA_B}\n`);
    const s = resolveInstallState(root, { homedir: home });
    expect(s.channel).toBe("dev");
    expect(s.source).toBe("dev-checkout");
    expect(s.commit).toBe(SHA_B);
  });

  it("a git clone INSIDE ~/.claude/plugins reads the pinned branch as the channel", () => {
    const home = mkTmp("guild-home-");
    const root = path.join(home, ".claude", "plugins", "marketplaces", "guild");
    fs.mkdirSync(root, { recursive: true });
    plantPlugin(root);
    fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(root, ".git", "refs", "heads", "next"), `${SHA_B}\n`);
    const s = resolveInstallState(root, { homedir: home });
    expect(s).toMatchObject({
      channel: "beta",
      source: "marketplace-clone",
      commit: SHA_B,
      version: "2.1.0",
    });
  });

  it("a wrapper package resolves via the install receipt", () => {
    const home = mkTmp("guild-home-");
    const root = mkTmp("guild-pkg-");
    plantPlugin(root, "2.1.0");
    fs.writeFileSync(
      path.join(root, RECEIPT_BASENAME),
      JSON.stringify({
        schema_version: RECEIPT_SCHEMA,
        host: "codex-cli",
        channel: "beta",
        ref: "next",
        commit: SHA_B,
        version: "2.1.0",
        installed_at: "2026-07-12T00:00:00Z",
      })
    );
    const s = resolveInstallState(root, { homedir: home });
    expect(s).toMatchObject({ channel: "beta", source: "receipt", commit: SHA_B });
  });

  it("no git, no receipt → stable default with version only", () => {
    const home = mkTmp("guild-home-");
    const root = mkTmp("guild-plain-");
    plantPlugin(root, "2.0.1");
    const s = resolveInstallState(root, { homedir: home });
    expect(s).toMatchObject({ channel: "stable", source: "default", version: "2.0.1", commit: null });
  });
});

describe("cache TTL + fail-open refresh", () => {
  it("cacheIsFresh honors the TTL window and rejects clock skew", () => {
    const now = new Date("2026-07-12T12:00:00Z");
    expect(cacheIsFresh(cacheWith({}, "2026-07-12T00:00:00Z"), 24, now)).toBe(true);
    expect(cacheIsFresh(cacheWith({}, "2026-07-10T00:00:00Z"), 24, now)).toBe(false);
    expect(cacheIsFresh(cacheWith({}, "2026-07-13T00:00:00Z"), 24, now)).toBe(false); // future
    expect(cacheIsFresh(null, 24, now)).toBe(false);
  });

  it("refreshCache writes the parsed remote state; a failing runner returns null and writes nothing", () => {
    const dir = mkTmp("guild-cache-");
    const file = path.join(dir, "update-check.json");
    const ok = refreshCache({
      file,
      now: new Date("2026-07-12T12:00:00Z"),
      runner: () => `${SHA_B}\trefs/heads/next\n${"d".repeat(40)}\trefs/tags/v2.1.0\n`,
    });
    expect(ok?.remote.next_head_sha).toBe(SHA_B);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).remote.latest_tag).toBe("v2.1.0");

    const file2 = path.join(dir, "second.json");
    const fail = refreshCache({
      file: file2,
      runner: () => {
        throw new Error("offline");
      },
    });
    expect(fail).toBeNull();
    expect(fs.existsSync(file2)).toBe(false);
  });
});

describe("computeSignal — per-channel staleness", () => {
  const stableState: InstallState = { channel: "stable", version: "2.0.1", commit: null, source: "default" };
  const betaState: InstallState = { channel: "beta", version: "2.1.0", commit: SHA_A, source: "marketplace-clone" };

  it("stable: newer tag → update with the exact host command (AC-3)", () => {
    const sig = computeSignal({ state: stableState, cache: cacheWith({ latest_tag: "v2.1.0" }) });
    expect(sig).toMatchObject({
      update_available: true,
      reason: "stable-newer-tag",
      // The tag is "v2.1.0"; the signal renders VERSIONS (v prefix stripped).
      available: "2.1.0",
    });
    expect(renderSignalLine(sig)).toBe(
      "Guild update available on stable: 2.0.1 → 2.1.0 — run: claude plugin marketplace update guild && claude plugin update guild@guild"
    );
  });

  it("stable: same or older tag → up-to-date, no line", () => {
    const sig = computeSignal({ state: { ...stableState, version: "2.1.0" }, cache: cacheWith({ latest_tag: "v2.1.0" }) });
    expect(sig.update_available).toBe(false);
    expect(renderSignalLine(sig)).toBeNull();
  });

  it("stable short path: matching main commit suppresses the candidate-to-bare false update", () => {
    const sig = computeSignal({
      state: { ...stableState, version: "2.7.0-beta.20", commit: SHA_A },
      cache: cacheWith({ latest_tag: "v2.7.0", main_head_sha: SHA_A }),
    });
    expect(sig).toMatchObject({ update_available: false, reason: "up-to-date" });
    expect(renderSignalLine(sig)).toBeNull();
  });

  it("stable short path: a different main commit signals an update even when the manifest label is unchanged", () => {
    const sig = computeSignal({
      state: { ...stableState, version: "2.7.0-beta.20", commit: SHA_A },
      cache: cacheWith({ latest_tag: "v2.7.0", main_head_sha: SHA_B }),
    });
    expect(sig).toMatchObject({ update_available: true, reason: "stable-new-commit", available: "2.7.0" });
  });

  it("stable short path: a commit-less install does not compare its published candidate label below the same bare tag", () => {
    const sig = computeSignal({
      state: { ...stableState, version: "2.7.0-beta.20", commit: null },
      cache: cacheWith({ latest_tag: "v2.7.0", main_head_sha: SHA_B }),
    });
    expect(sig).toMatchObject({ update_available: false, reason: "up-to-date" });
  });

  it("beta: differing next head SHA → update (SHA labels, wrapper command honored)", () => {
    const sig = computeSignal({
      state: betaState,
      cache: cacheWith({ next_head_sha: SHA_B }),
      hostKind: "wrapper",
    });
    expect(sig).toMatchObject({ update_available: true, reason: "beta-new-commit" });
    expect(renderSignalLine(sig)).toBe(
      `Guild update available on beta (next): ${SHA_A.slice(0, 7)} → ${SHA_B.slice(0, 7)} — run: guild-run update`
    );
  });

  it("beta: matching SHA → up-to-date", () => {
    const sig = computeSignal({ state: betaState, cache: cacheWith({ next_head_sha: SHA_A }) });
    expect(sig.update_available).toBe(false);
  });

  it("dev installs and missing cache never signal (AC-4/AC-5)", () => {
    const dev = computeSignal({
      state: { channel: "dev", version: "2.1.0", commit: SHA_A, source: "dev-checkout" },
      cache: cacheWith({ latest_tag: "v9.9.9", next_head_sha: SHA_B }),
    });
    expect(dev).toMatchObject({ update_available: false, reason: "dev-install" });
    const noCache = computeSignal({ state: stableState, cache: null });
    expect(noCache).toMatchObject({ update_available: false, reason: "no-cache" });
  });
});

describe("native host channel identity", () => {
  it("reads Claude's installed commit and marketplace branch instead of inferring from a beta-shaped manifest", () => {
    const home = mkTmp("guild-native-claude-");
    const pluginRoot = path.join(home, ".claude", "plugins", "cache", "guild", "guild", "2.7.0-beta.20");
    const marketplace = path.join(home, ".claude", "plugins", "marketplaces", "guild");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(path.join(marketplace, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(marketplace, ".git", "HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(marketplace, ".git", "refs", "heads", "main"), `${SHA_A}\n`);
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({ plugins: { "guild@guild": [{ installPath: pluginRoot, gitCommitSha: SHA_A }] } })
    );
    fs.writeFileSync(
      path.join(home, ".claude", "plugins", "known_marketplaces.json"),
      JSON.stringify({ guild: { installLocation: marketplace } })
    );

    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toEqual({
      channel: "stable",
      commit: SHA_A,
    });
  });

  it("reads Codex's marketplace ref and revision", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nlast_revision = "${SHA_B}"\nsource_type = "git"\nref = "next"\n`
    );
    expect(readNativeHostIdentity("codex-cli", "/package/guild", { homedir: home, codexHome })).toEqual({
      channel: "beta",
      commit: SHA_B,
    });
  });
});
