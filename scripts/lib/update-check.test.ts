/**
 * scripts/lib/update-check.test.ts
 *
 * Channel-aware update detection (plugin-update-lifecycle G1/G1-CH/G1-ALL):
 * semver + ls-remote parsing, .git HEAD channel resolution (loose + packed
 * refs, detached, dev-vs-managed), receipt fallback, cache TTL, the staleness
 * decision per channel, fail-open refresh, and the AC-3 signal line.
 */

import { describe, it, expect } from "bun:test";
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
} from "./update-check";
import {
  NativeConfigParseError,
  parseNativeToml,
  selectCodexMarketplaceIdentity,
} from "../../src/domains/config";

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

    const { resolveGitDir } = require("./update-check");
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

  it("reads Codex's marketplace ref and revision for a package under CODEX_HOME", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    const pluginRoot = path.join(codexHome, "marketplaces", "guild", "package");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nlast_revision = "${SHA_B}"\nsource_type = "git"\nref = "next"\n`
    );
    expect(readNativeHostIdentity("codex-cli", pluginRoot, { homedir: home, codexHome })).toEqual({
      channel: "beta",
      commit: SHA_B,
    });
  });

  it("the Codex registry never identifies a package OUTSIDE its own home (physical binding)", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    fs.mkdirSync(codexHome, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nlast_revision = "${SHA_B}"\nref = "next"\n`
    );
    const foreignRoot = mkTmp("guild-foreign-pkg-");
    expect(readNativeHostIdentity("codex-cli", foreignRoot, { homedir: home, codexHome })).toBeNull();
  });

  // codex G-lane round-2 F1: when the selected alias's marketplace directory is
  // observable on disk, a SIBLING package under CODEX_HOME is not that install.
  it("a package outside the selected alias's own marketplace directory is refused", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    fs.mkdirSync(path.join(codexHome, "marketplaces", "guild"), { recursive: true });
    const unrelated = path.join(codexHome, "unrelated", "package");
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nlast_revision = "${SHA_B}"\nref = "next"\n`
    );
    expect(readNativeHostIdentity("codex-cli", unrelated, { homedir: home, codexHome })).toBeNull();
    const inside = path.join(codexHome, "marketplaces", "guild", "package");
    fs.mkdirSync(inside, { recursive: true });
    expect(readNativeHostIdentity("codex-cli", inside, { homedir: home, codexHome })).toEqual({
      channel: "beta",
      commit: SHA_B,
    });
  });

  // codex G-lane round-3 F1: binding is order-independent across AGREEING aliases.
  it("a package under ANY agreeing alias directory binds, regardless of registration order", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    const guildDir = path.join(codexHome, "marketplaces", "guild");
    const mirrorPkg = path.join(codexHome, "marketplaces", "mirror", "package");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.mkdirSync(mirrorPkg, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nref = "next"\nlast_revision = "${SHA_B}"\n` +
        `[marketplaces.mirror]\nurl = "https://github.com/lookatitude/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`
    );
    expect(readNativeHostIdentity("codex-cli", mirrorPkg, { homedir: home, codexHome })).toEqual({
      channel: "beta",
      commit: SHA_B,
    });
  });

  // codex G-lane round-4 F1: an alias of ".." normalizes to CODEX_HOME and must
  // not bind a sibling package when a real alias directory exists.
  it("a traversal-shaped agreeing alias cannot widen the physical binding", () => {
    const home = mkTmp("guild-native-codex-");
    const codexHome = path.join(home, ".codex");
    fs.mkdirSync(path.join(codexHome, "marketplaces", "guild"), { recursive: true });
    const sibling = path.join(codexHome, "unrelated", "package");
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nref = "next"\nlast_revision = "${SHA_B}"\n` +
        `[marketplaces.".."]\nurl = "https://github.com/lookatitude/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`
    );
    expect(readNativeHostIdentity("codex-cli", sibling, { homedir: home, codexHome })).toBeNull();
  });
});

// ── F01: shared native-config parser + custom roots/aliases ─────────────────

describe("parseNativeToml — documented variants (F01-AC1)", () => {
  it("parses quoted/dotted/inline tables, both string kinds, comments and reordering", () => {
    const doc = [
      `# leading comment`,
      `title = 'literal string' # trailing comment`,
      `owner.name = "dotted key"`,
      ``,
      `[marketplaces."guild beta"]  # quoted table segment with a space`,
      `ref = "next"`,
      `last_revision = "${SHA_B}"`,
      ``,
      `[servers]`,
      `alpha = { host = "a.example", port = 8_080, active = true }`,
      ``,
      `[reordered]`,
      `z = 1`,
      `a = [1, 2,`,
      `     3]`,
      `when = 2026-10-17T00:00:00Z`,
    ].join("\n");
    const t = parseNativeToml(doc) as Record<string, any>;
    expect(t.title).toBe("literal string");
    expect(t.owner.name).toBe("dotted key");
    expect(t.marketplaces["guild beta"]).toMatchObject({ ref: "next", last_revision: SHA_B });
    expect(t.servers.alpha).toMatchObject({ host: "a.example", port: 8080, active: true });
    expect(t.reordered.a).toEqual([1, 2, 3]);
    // Datetime tokens stay verbatim strings; identity fields never accept them.
    expect(t.reordered.when).toBe("2026-10-17T00:00:00Z");
  });

  it("refuses duplicate keys and duplicate table headers (code: toml-duplicate-key)", () => {
    for (const doc of [
      `a = 1\na = 2\n`,
      `[t]\nx = 1\n[t]\ny = 2\n`,
      `[t]\nx = 1\nx = 2\n`,
      `a = 1\n[a]\nb = 2\n`,
    ]) {
      let code: string | null = null;
      try {
        parseNativeToml(doc);
      } catch (e) {
        code = (e as NativeConfigParseError).code;
      }
      expect(code).toBe("toml-duplicate-key");
    }
  });

  it("refuses unsafe keys everywhere a key can appear (code: toml-unsafe-key)", () => {
    for (const doc of [
      `__proto__ = 1\n`,
      `[__proto__]\nx = 1\n`,
      `[t]\nconstructor = 1\n`,
      `t = { prototype = 1 }\n`,
      `a."__proto__" = 1\n`,
    ]) {
      let code: string | null = null;
      try {
        parseNativeToml(doc);
      } catch (e) {
        code = (e as NativeConfigParseError).code;
      }
      expect(code).toBe("toml-unsafe-key");
    }
    // The parse never poisons Object.prototype.
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("refuses malformed documents with toml-syntax instead of guessing", () => {
    for (const doc of [`a =\n`, `[unclosed\nx = 1\n`, `a = "unterminated\n`, `a = what?\n`, `a = """multi"""\n`]) {
      let code: string | null = null;
      try {
        parseNativeToml(doc);
      } catch (e) {
        code = (e as NativeConfigParseError).code;
      }
      expect(code).toBe("toml-syntax");
    }
  });

  // codex G-lane F3 regressions: invalid TOML must never parse into a table an
  // identity could be read from.
  it("closed tables stay closed: headers cannot reopen inline/dotted-key tables, nor [[..]] a value array", () => {
    for (const doc of [
      // header reopening an inline table
      `marketplaces = { guild = { ref = "main" } }\n[marketplaces.guild]\nlast_revision = "${SHA_A}"\n`,
      // header reopening a dotted-key table
      `marketplaces.guild.ref = "main"\n[marketplaces.guild]\nlast_revision = "${SHA_A}"\n`,
      // [[..]] appending to a plain value array
      `a = [1, 2]\n[[a]]\nx = 1\n`,
    ]) {
      let code: string | null = null;
      try {
        parseNativeToml(doc);
      } catch (e) {
        code = (e as NativeConfigParseError).code;
      }
      expect(code).toBe("toml-duplicate-key");
    }
  });

  it("malformed numeric underscores and leading zeros refuse (toml-syntax), never parse", () => {
    for (const doc of [`a = 1__0\n`, `a = _1\n`, `a = 1_\n`, `a = 0x_ff\n`, `a = 01\n`, `a = 00.5\n`]) {
      let code: string | null = null;
      try {
        parseNativeToml(doc);
      } catch (e) {
        code = (e as NativeConfigParseError).code;
      }
      expect(code).toBe("toml-syntax");
    }
    expect(parseNativeToml(`a = 1_000\nb = 0xdead_beef\nc = 0.5\n`)).toMatchObject({ a: 1000, b: 0xdeadbeef, c: 0.5 });
  });

  // codex G-lane round-2 F2: an inline table is closed to DOTTED KEYS too.
  it("dotted keys cannot extend a closed inline table", () => {
    const doc = `marketplaces = { guild = { ref = "main" } }\nmarketplaces.guild.last_revision = "${SHA_A}"\n`;
    let code: string | null = null;
    try {
      parseNativeToml(doc);
    } catch (e) {
      code = (e as NativeConfigParseError).code;
    }
    expect(code).toBe("toml-duplicate-key");
  });
});

describe("selectCodexMarketplaceIdentity — alias selection + refusals (F01-AC1/AC3)", () => {
  it("selects across alias spellings, including quoted aliases and url-identified entries", () => {
    const quoted = `[marketplaces."guild"]\nref = "main"\nlast_revision = "${SHA_A}"\n`;
    expect(selectCodexMarketplaceIdentity(quoted)).toMatchObject({
      status: "selected",
      identity: { channel: "stable", commit: SHA_A },
    });
    const urlAlias = `[marketplaces.work-guild]\nurl = "https://github.com/lookatitude/guild.git"\nref = "next"\nlast_revision = "${SHA_B}"\n`;
    expect(selectCodexMarketplaceIdentity(urlAlias)).toMatchObject({
      status: "selected",
      identity: { channel: "beta", commit: SHA_B },
      alias: "work-guild",
    });
    // Agreeing duplicate aliases are not a conflict.
    expect(selectCodexMarketplaceIdentity(quoted + urlAlias.replace("next", "main").replace(SHA_B, SHA_A))).toMatchObject({
      status: "selected",
      identity: { channel: "stable", commit: SHA_A },
    });
  });

  it("refuses conflicting aliases, unknown refs, and non-SHA revisions", () => {
    const conflict =
      `[marketplaces.guild]\nref = "main"\nlast_revision = "${SHA_A}"\n` +
      `[marketplaces.guild-beta]\nurl = "https://github.com/lookatitude/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`;
    expect(selectCodexMarketplaceIdentity(conflict)).toMatchObject({
      status: "refused",
      reason: "conflicting-aliases",
    });
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.guild]\nref = "release/v9"\nlast_revision = "${SHA_A}"\n`)
    ).toMatchObject({ status: "refused", reason: "invalid-identity" });
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.guild]\nref = "main"\nlast_revision = "deadbeef"\n`)
    ).toMatchObject({ status: "refused", reason: "invalid-identity" });
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.guild]\nref = "main"\nref = "next"\nlast_revision = "${SHA_A}"\n`)
    ).toMatchObject({ status: "refused", reason: "parse-error", code: "toml-duplicate-key" });
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.guild]\n__proto__ = "x"\nref = "main"\nlast_revision = "${SHA_A}"\n`)
    ).toMatchObject({ status: "refused", reason: "parse-error", code: "toml-unsafe-key" });
    // Unrelated marketplaces are simply absent, not refused.
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.other]\nref = "next"\nlast_revision = "${SHA_B}"\n`)
    ).toMatchObject({ status: "absent" });
  });

  // codex G-lane F2 regressions: source identification is exact-origin only,
  // and an explicit source always overrides the alias name.
  it("only the canonical GitHub origin identifies Guild; alias name never overrides a foreign source", () => {
    expect(
      selectCodexMarketplaceIdentity(
        `[marketplaces.spoof]\nurl = "https://evil.example/lookatitude/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`
      )
    ).toMatchObject({ status: "absent" });
    expect(
      selectCodexMarketplaceIdentity(
        `[marketplaces.guild]\nurl = "https://github.com/someone-else/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`
      )
    ).toMatchObject({ status: "absent" });
    for (const origin of [
      "https://github.com/lookatitude/guild",
      "https://github.com/lookatitude/guild.git",
      "git@github.com:lookatitude/guild.git",
    ]) {
      expect(
        selectCodexMarketplaceIdentity(
          `[marketplaces.anything]\nurl = "${origin}"\nref = "main"\nlast_revision = "${SHA_A}"\n`
        )
      ).toMatchObject({ status: "selected", identity: { channel: "stable", commit: SHA_A } });
    }
  });

  // codex G-lane round-3 F2: remaining invalid-TOML acceptance paths refuse.
  it("array-to-table redefinition, raw control chars, and surrogate escapes refuse", () => {
    const valid = `[marketplaces.guild]\nref = "main"\nlast_revision = "${SHA_A}"\n`;
    expect(selectCodexMarketplaceIdentity(`[[a]]\n[a]\nx = 1\n${valid}`)).toMatchObject({
      status: "refused",
      reason: "parse-error",
      code: "toml-duplicate-key",
    });
    expect(selectCodexMarketplaceIdentity(`x = "nul\u0000char"\n${valid}`)).toMatchObject({
      status: "refused",
      reason: "parse-error",
      code: "toml-syntax",
    });
    expect(selectCodexMarketplaceIdentity(`x = "\\uD800"\n${valid}`)).toMatchObject({
      status: "refused",
      reason: "parse-error",
      code: "toml-syntax",
    });
  });

  // codex G-lane round-4 F2: trivia and datetime holes refuse.
  it("NUL comments, lone CR line breaks, and impossible dates refuse", () => {
    const valid = `[marketplaces.guild]\nref = "main"\nlast_revision = "${SHA_A}"\n`;
    for (const doc of [
      `# comment with nul \u0000 here\n${valid}`,
      `a = 1\r${valid}`,
      `# comment\rhidden\n${valid}`,
      `x = 2026-99-99\n${valid}`,
      `x = 2026-02-31\n${valid}`,
      `x = 2026-10-17T99:00:00Z\n${valid}`,
      `x = 2026-10-17T12:00:00+99:99\n${valid}`,
    ]) {
      expect(selectCodexMarketplaceIdentity(doc)).toMatchObject({ status: "refused", reason: "parse-error" });
    }
    // CRLF remains fine.
    expect(selectCodexMarketplaceIdentity(`a = 1\r\n${valid}`)).toMatchObject({ status: "selected" });
  });

  // codex G-lane round-4 F1: a traversal-shaped alias never participates in path binding.
  it("a '..' alias cannot bind a package outside the marketplaces root", () => {
    // Covered end-to-end in the readNativeHostIdentity suite below; here assert
    // the selection still returns both aliases so binding sees and skips "..".
    const doc =
      `[marketplaces.guild]\nref = "next"\nlast_revision = "${SHA_B}"\n` +
      `[marketplaces.".."]\nurl = "https://github.com/lookatitude/guild"\nref = "next"\nlast_revision = "${SHA_B}"\n`;
    expect(selectCodexMarketplaceIdentity(doc)).toMatchObject({ status: "selected", aliases: ["guild", ".."] });
  });

  // codex G-lane round-2 F3: malformed or internally-contradicting source metadata refuses.
  it("malformed or conflicting source fields refuse instead of falling back", () => {
    expect(
      selectCodexMarketplaceIdentity(`[marketplaces.guild]\nurl = 42\nref = "main"\nlast_revision = "${SHA_A}"\n`)
    ).toMatchObject({ status: "refused", reason: "invalid-identity" });
    expect(
      selectCodexMarketplaceIdentity(
        `[marketplaces.x]\nurl = "https://github.com/lookatitude/guild"\nrepo = "https://example.com/elsewhere"\nref = "main"\nlast_revision = "${SHA_A}"\n`
      )
    ).toMatchObject({ status: "refused", reason: "invalid-identity" });
  });
});

describe("custom roots + alias selection (F01-AC2/AC3)", () => {
  function plantClaudeRegistry(configRoot: string, pluginRoot: string, opts: {
    aliasKey?: string;
    marketplaceBranch?: string;
    extraPlugins?: Record<string, unknown>;
  } = {}): void {
    const aliasKey = opts.aliasKey ?? "guild@guild";
    const marketplace = path.join(configRoot, "plugins", "marketplaces", "guild mp");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.mkdirSync(path.join(marketplace, ".git", "refs", "heads"), { recursive: true });
    const branch = opts.marketplaceBranch ?? "next";
    fs.writeFileSync(path.join(marketplace, ".git", "HEAD"), `ref: refs/heads/${branch}\n`);
    fs.writeFileSync(path.join(marketplace, ".git", "refs", "heads", branch), `${SHA_B}\n`);
    fs.writeFileSync(
      path.join(configRoot, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          [aliasKey]: [{ installPath: pluginRoot, gitCommitSha: SHA_B }],
          ...(opts.extraPlugins ?? {}),
        },
      })
    );
    const mpName = aliasKey.includes("@") ? aliasKey.slice(aliasKey.lastIndexOf("@") + 1) : aliasKey;
    fs.writeFileSync(
      path.join(configRoot, "plugins", "known_marketplaces.json"),
      JSON.stringify({ [mpName]: { installLocation: marketplace } })
    );
  }

  it("honors an explicit CLAUDE_CONFIG_DIR root (with spaces) ahead of the defaults", () => {
    const home = mkTmp("guild-home-");
    const customRoot = path.join(mkTmp("guild-custom-"), "my claude config");
    const pluginRoot = path.join(customRoot, "plugins", "cache", "guild", "guild", "3.0.0");
    plantClaudeRegistry(customRoot, pluginRoot, { aliasKey: "guild@team-guild" });
    expect(
      readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home, claudeConfigDir: customRoot })
    ).toEqual({ channel: "beta", commit: SHA_B });
    // Without the override the same install resolves nothing — roots are never guessed.
    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toBeNull();
  });

  it("selects by physical install path across plugin aliases and refuses conflicting registrations", () => {
    const home = mkTmp("guild-home-");
    const configRoot = path.join(home, ".claude");
    const pluginRoot = path.join(configRoot, "plugins", "cache", "guild", "guild", "3.0.0");
    // A second alias for a DIFFERENT physical install must not interfere.
    plantClaudeRegistry(configRoot, pluginRoot, {
      aliasKey: "guild@guild",
      extraPlugins: { "other@elsewhere": [{ installPath: "/somewhere/else", gitCommitSha: SHA_A }] },
    });
    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toEqual({
      channel: "beta",
      commit: SHA_B,
    });

    // Conflicting registrations of the SAME physical install refuse.
    fs.writeFileSync(
      path.join(configRoot, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "guild@guild": [{ installPath: pluginRoot, gitCommitSha: SHA_B }],
          "guild@mirror": [{ installPath: pluginRoot, gitCommitSha: SHA_A }],
        },
      })
    );
    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toBeNull();

    // codex G-lane F4: one valid + one MALFORMED registration of the same
    // physical install is ambiguity about this package — refuse, don't skip.
    fs.writeFileSync(
      path.join(configRoot, "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: {
          "guild@guild": [{ installPath: pluginRoot, gitCommitSha: SHA_B }],
          "guild@broken": [{ installPath: pluginRoot, gitCommitSha: "not-a-sha" }],
        },
      })
    );
    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toBeNull();
  });

  it("refuses a marketplace clone pinned to an unknown branch instead of assuming a channel", () => {
    const home = mkTmp("guild-home-");
    const configRoot = path.join(home, ".claude");
    const pluginRoot = path.join(configRoot, "plugins", "cache", "guild", "guild", "3.0.0");
    plantClaudeRegistry(configRoot, pluginRoot, { marketplaceBranch: "release-v9" });
    expect(readNativeHostIdentity("claude-code-cli", pluginRoot, { homedir: home })).toBeNull();
  });

  it("CODEX_HOME override (with spaces) is honored for the codex registry", () => {
    const home = mkTmp("guild-home-");
    const codexHome = path.join(mkTmp("guild-codexhome-"), "codex home");
    const pluginRoot = path.join(codexHome, "marketplaces", "guild", "package");
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[marketplaces.guild]\nref = "main"\nlast_revision = "${SHA_A}"\n`
    );
    expect(readNativeHostIdentity("codex-cli", pluginRoot, { homedir: home, codexHome })).toEqual({
      channel: "stable",
      commit: SHA_A,
    });
    // Without the override the same package is outside ~/.codex: null, not guessed.
    expect(readNativeHostIdentity("codex-cli", pluginRoot, { homedir: home })).toBeNull();
  });

  it("a managed install under CLAUDE_CONFIG_DIR is NOT classified as a dev checkout (F01-AC2)", () => {
    const home = mkTmp("guild-home-");
    const customRoot = path.join(mkTmp("guild-custom-"), "cfg dir");
    const root = path.join(customRoot, "plugins", "marketplaces", "guild");
    fs.mkdirSync(path.join(root, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "guild", version: "3.0.0" }));
    fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/next\n");
    fs.writeFileSync(path.join(root, ".git", "refs", "heads", "next"), `${SHA_B}\n`);

    const withOverride = resolveInstallState(root, { homedir: home, claudeConfigDir: customRoot });
    expect(withOverride).toMatchObject({ channel: "beta", source: "marketplace-clone", commit: SHA_B });
    // The same tree WITHOUT the override is correctly a dev checkout.
    const without = resolveInstallState(root, { homedir: home });
    expect(without).toMatchObject({ channel: "dev", source: "dev-checkout" });
  });
});
