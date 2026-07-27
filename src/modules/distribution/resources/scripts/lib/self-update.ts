/**
 * scripts/lib/self-update.ts
 *
 * `guild-run update` — the wrapper-host apply adapter (plugin-update-lifecycle
 * G1-ALL). Wrapper/agents-file packages are Guild-managed, so unlike Claude's
 * marketplace they can TRULY self-update:
 *
 *   receipt (guild.install_receipt.v1, written by install.sh at the package
 *   root) → live ls-remote check at the receipt's channel ref → clone at that
 *   ref → re-render THIS host's package via the clone's own
 *   build-host-packages.ts → staged swap of the package contents → rewritten
 *   receipt (new commit + version).
 *
 * Safety:
 *   - Dev checkouts (a .git tree outside the managed area) REFUSE — the
 *     operator's live symlink must never be clobbered (AC-5).
 *   - No receipt → refuse with the exact recovery command (a fresh install).
 *   - Up-to-date → exit 0 without touching anything (unless --force).
 *   - The swap is staged: render lands in a sibling .update-staging dir and is
 *     copied over only after a successful render; the old tree is restored on
 *     copy failure. Not byte-atomic — documented limitation, wrapper hosts
 *     re-exec per run so a torn window is a re-run, not a corruption.
 *
 * All process/fs seams are injectable for tests.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  computeSignal,
  refreshCache,
  resolveInstallState,
  updateCapsForHost,
  RECEIPT_BASENAME,
  RECEIPT_SCHEMA,
  SOURCE_REPO_DEFAULT,
  type InstallReceipt,
} from "./update-check";

export interface SelfUpdateDeps {
  run: (cmd: string, args: string[], opts?: { cwd?: string; env?: NodeJS.ProcessEnv }) => void;
  log: (line: string) => void;
  fsi: typeof fs;
  now: () => Date;
}

/**
 * Environment for child npm/npx invocations, with the OUTER npm context
 * stripped. guild-run itself runs under `npx tsx`, which exports npm_* vars
 * (npm_config_local_prefix points at the INSTALLED PACKAGE root, npm_command,
 * npm_lifecycle_*, INIT_CWD, …). An inner `npm ci` inheriting that set
 * misresolves its project and dies with "Missing: scripts@ from lock file" —
 * reproducible ONLY through the real bin/guild-run chain, which is why every
 * mocked test missed it and a bare `npm ci --prefix` from a shell works.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    // DENYLIST, not a blanket npm_* strip: an earlier revision removed every
    // npm_ var, which also killed legitimately environment-provided settings
    // (npm_config_registry, npm_config_cafile, npm_config_userconfig, proxy
    // and cache config) that managed environments rely on. What actually
    // poisons a nested npm is the PROJECT-CONTEXT set the outer npx exports:
    //   - npm_config_local_prefix  (points at the INSTALLED PACKAGE root —
    //     the variable that made `npm ci` resolve the wrong project)
    //   - npm_package_* / npm_lifecycle_* / npm_command / npm_execpath
    //     (identify the outer invocation, not ours)
    //   - INIT_CWD (npm's original-cwd marker from the outer run)
    if (/^npm_(package_|lifecycle_)/i.test(k)) continue;
    if (/^(npm_config_local_prefix|npm_command|npm_execpath|INIT_CWD)$/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

const defaultDeps: SelfUpdateDeps = {
  run: (cmd, args, opts = {}) =>
    void execFileSync(cmd, args, { stdio: ["ignore", "inherit", "inherit"], ...opts }),
  log: (line) => process.stderr.write(`[guild-run update] ${line}\n`),
  fsi: fs,
  now: () => new Date(),
};

/**
 * dist path (relative to the render's dist root) of the tree that matches the
 * INSTALLED package root the receipt lives in — i.e. what install.sh handed
 * write_receipt, NOT merely the host's top-level dist entry.
 *
 * codex-cli is the one host where those differ: the render emits a marketplace
 * ROOT (dist/codex-marketplace with .agents/plugins/marketplace.json + the
 * plugin payload nested at plugins/guild/), while the installed root —
 * Codex's plugin cache dir, or the source fallback — has the PAYLOAD shape
 * (.codex-plugin/plugin.json at top level). Returning the marketplace root
 * here made the staged swap copy plugins/guild/... INTO the installed root,
 * burying .codex-plugin/plugin.json and bin/guild-run one level too deep and
 * corrupting the install on the first real update. This was latent while
 * Codex installs carried no receipt (runSelfUpdate refused early); the
 * xhrd-wi-05 receipt fix armed the path, so the source must be the payload.
 */
export function distDirForHost(hostId: string): string {
  if (hostId === "codex-cli") return path.join("codex-marketplace", "plugins", "guild");
  if (hostId === "pi-cli") return "pi";
  if (hostId === "antigravity-cli") return "antigravity";
  if (hostId === "agents-file" || hostId === "kiro" || hostId === "qoder" || hostId === "trae") {
    return "agents";
  }
  return hostId; // new-CLI trees are named by host id
}

export function readReceipt(pkgRoot: string, fsi: typeof fs = fs): InstallReceipt | null {
  try {
    const r = JSON.parse(
      fsi.readFileSync(path.join(pkgRoot, RECEIPT_BASENAME), "utf8")
    ) as InstallReceipt;
    return r.schema_version === RECEIPT_SCHEMA ? r : null;
  } catch {
    return null;
  }
}

export function runSelfUpdate(opts: {
  pkgRoot: string;
  force?: boolean;
  repo?: string;
  deps?: Partial<SelfUpdateDeps>;
  /**
   * Override the update-check cache file (default: cachePath() under the real
   * home). Tests MUST pass this: under jest, `process.env` mutations do not
   * reach the native environment `os.homedir()` reads, so HOME-based isolation
   * silently fails and a test run overwrites the developer's real
   * ~/.guild/update-check.json with fixture SHAs — which the update signal then
   * trusts (it does not validate source_repo).
   */
  cacheFile?: string;
}): number {
  const deps: SelfUpdateDeps = { ...defaultDeps, ...(opts.deps ?? {}) };
  const { log, run, fsi } = deps;
  const pkgRoot = path.resolve(opts.pkgRoot);
  const repo = opts.repo ?? SOURCE_REPO_DEFAULT;

  const state = resolveInstallState(pkgRoot, { fsi });
  if (state.channel === "dev") {
    log("this is a dev checkout (git working tree) — refusing to self-update; use git (AC-5).");
    return 1;
  }
  const receipt = readReceipt(pkgRoot, fsi);
  if (!receipt) {
    log(`no ${RECEIPT_BASENAME} at ${pkgRoot} — cannot determine channel/host.`);
    log("Re-install once to mint a receipt: curl -fsSL https://guildstack.dev/install.sh | bash");
    return 1;
  }

  // AC-7 honesty guard: only hosts whose capability row declares the
  // self_update apply path may be updated by guild-run — anything else gets
  // its REAL command instead of a wrong-mechanism swap.
  const caps = updateCapsForHost(receipt.host);
  if (!caps) {
    log(`host "${receipt.host}" has no update capability row — refusing to self-update an unverifiable mechanism (AC-7).`);
    return 1;
  }
  if (caps.apply !== "self_update") {
    log(`host ${receipt.host} does not use guild-run self-update (capability row: apply=${caps.apply}).`);
    log(caps.command ? `Use instead: ${caps.command}` : "This surface has no update path (notify-only).");
    return 1;
  }

  log(`host ${receipt.host}, channel ${receipt.channel} (ref ${receipt.ref}), installed ${receipt.commit?.slice(0, 7) ?? receipt.version}`);
  const cache = refreshCache({ repo, now: deps.now(), file: opts.cacheFile });
  if (!cache) {
    log("update check failed (offline / no git?) — nothing changed.");
    return 1;
  }
  const signal = computeSignal({
    state: {
      channel: receipt.channel === "beta" ? "beta" : "stable",
      version: receipt.version,
      commit: receipt.commit,
      source: "receipt",
    },
    cache,
    hostKind: "wrapper",
    hostId: receipt.host,
  });
  if (!signal.update_available && !opts.force) {
    log(`up to date (${signal.installed}).`);
    return 0;
  }
  if (signal.update_available) {
    log(`update available: ${signal.installed} → ${signal.available}`);
  } else {
    log("--force: re-rendering current ref.");
  }

  const tmp = fsi.mkdtempSync(path.join(os.tmpdir(), "guild-self-update-"));
  try {
    log(`fetching ${receipt.ref} from ${repo} …`);
    run("git", ["clone", "--depth", "1", "--branch", receipt.ref, repo, tmp]);
    const newCommit = execFileSync("git", ["-C", tmp, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    log("installing script runtime deps …");
    // cwd-form, NOT --prefix: combined with childEnv() this survives being a
    // grandchild of the wrapper's own `npx tsx` (see childEnv's doc comment).
    run("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
      cwd: path.join(tmp, "scripts"),
      env: childEnv(),
    });
    log(`rendering ${receipt.host} package …`);
    const generatedAt = deps.now().toISOString().replace(/\.\d{3}Z$/, "Z");
    run(
      "npx",
      ["tsx", "scripts/build-host-packages.ts", "--root", ".", "--out", "dist", "--generated-at", generatedAt],
      { cwd: tmp }
    );
    const rendered = path.join(tmp, "dist", distDirForHost(receipt.host));
    if (!fsi.existsSync(rendered)) {
      log(`render produced no tree at ${rendered} — aborting, nothing changed.`);
      return 1;
    }

    // REAL staged swap (codex G-lane MAJOR): build the complete replacement
    // tree in a SIBLING dir (same filesystem → atomic renames), receipt
    // included, then old→aside / new→live / drop-aside. Deleted upstream files
    // cannot survive (the whole tree is replaced), and a failure between the
    // two renames is recovered by putting the old tree back.
    const newVersion = (() => {
      try {
        return (
          JSON.parse(
            fsi.readFileSync(path.join(tmp, ".claude-plugin", "plugin.json"), "utf8")
          ) as { version?: string }
        ).version ?? receipt.version;
      } catch {
        return receipt.version;
      }
    })();
    const newReceipt: InstallReceipt = {
      ...receipt,
      commit: newCommit,
      version: newVersion,
      installed_at: deps.now().toISOString(),
    };
    const staging = `${pkgRoot}.update-staging`;
    const aside = `${pkgRoot}.update-old`;
    fsi.rmSync(staging, { recursive: true, force: true });
    fsi.rmSync(aside, { recursive: true, force: true });
    log(`staging new tree at ${staging} …`);
    fsi.cpSync(rendered, staging, { recursive: true });
    fsi.writeFileSync(
      path.join(staging, RECEIPT_BASENAME),
      JSON.stringify(newReceipt, null, 2) + "\n",
      "utf8"
    );
    log(`swapping ${pkgRoot} …`);
    fsi.renameSync(pkgRoot, aside);
    try {
      fsi.renameSync(staging, pkgRoot);
    } catch (e) {
      // Second rename failed — put the old tree back before surfacing.
      fsi.renameSync(aside, pkgRoot);
      throw e;
    }
    try {
      fsi.rmSync(aside, { recursive: true, force: true });
    } catch {
      log(`note: could not remove the previous tree at ${aside} — safe to delete manually.`);
    }
    log(`updated to ${newCommit.slice(0, 7)} (v${newVersion}). Start a fresh ${receipt.host} session to pick it up.`);
    return 0;
  } catch (e) {
    log(`update failed: ${String(e).slice(0, 300)} — package left as-is where possible.`);
    return 1;
  } finally {
    try {
      fsi.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // tmp cleanup is best-effort
    }
  }
}
