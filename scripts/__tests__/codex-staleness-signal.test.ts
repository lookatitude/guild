/**
 * scripts/__tests__/codex-staleness-signal.test.ts
 *
 * HOST-NEUTRAL STALENESS SIGNAL — Codex wiring rail
 * (initiative cross-host-release-distribution, work item xhrd-wi-04 / G4).
 *
 * THE DEFECT. Guild's update-check reached exactly one host. `hooks/hooks.json`
 * wired it into Claude's SessionStart; the generated Codex package wired only
 * `UserPromptSubmit` (the prompt bridge) and did not even SHIP
 * `hooks/dist/update-check.js`. A Codex user three releases behind was told
 * nothing — which is how the reporting machine sat at 2.2.0 while stable
 * shipped 2.3.2.
 *
 * NOT A HOST LIMITATION. Codex supports SessionStart natively; a live
 * `~/.codex/hooks.json` registers ten events including it. Guild simply never
 * wired it — the same shape as the git-marketplace finding in G1/G3.
 *
 * WHY `--host` IS EXPLICIT RATHER THAN DETECTED. Each per-host package names
 * its own host in its hook manifest, so the AC-7 capability row supplies that
 * host's real command with NO install receipt required. That matters: a
 * host-native `codex plugin add` never writes a receipt, which is precisely the
 * reporting machine's state.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  computeSignal,
  renderSignalLine,
  readInstalledVersion,
  updateCapsForHost,
} from "../lib/update-check";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/** The reporting machine's exact situation: stable, installed 2.2.0, latest 2.3.2. */
const STATE = { channel: "stable", version: "2.2.0", ref: "main", commit: null } as never;
const CACHE = {
  schema_version: "guild.update_check_cache.v1",
  checked_at: "2026-07-26T00:00:00Z",
  remote: { latest_tag: "2.3.2", latest_sha: null },
} as never;

/** Mirrors the hostId → hostKind resolution in hooks/update-check.ts's main(). */
function signalFor(hostId: string) {
  const caps = updateCapsForHost(hostId);
  const hostKind =
    caps?.apply === "marketplace_cli" ? "claude" : caps?.apply === "self_update" ? "wrapper" : "agents-file";
  return computeSignal({ state: STATE, cache: CACHE, hostKind, hostId } as never) as {
    update_available: boolean;
    command: string | null;
  };
}

describe("the signal names the CORRECT command per host", () => {
  it("Codex gets the reinstall command — never Claude's pair, never guild-run (option A)", () => {
    const s = signalFor("codex-cli");
    expect(s.update_available).toBe(true);
    // Operator decision: codex-cli is reinstall_command. install.sh --update
    // re-renders receipted installs and detect+advises native ones; a
    // guild-run self-update of the manager-owned cache is incoherent.
    expect(s.command).toMatch(/install\.sh \| bash -s -- --update$/);
    expect(s.command).not.toMatch(/^claude /);
    expect(s.command).not.toMatch(/guild-run/);
  });

  it("Claude still gets the full two-command pair", () => {
    const s = signalFor("claude-code-cli");
    expect(s.command).toBe("claude plugin marketplace update guild && claude plugin update guild@guild");
  });

  it("a file-surface host is told install.sh --update, not guild-run", () => {
    const s = signalFor("agents-file");
    expect(s.command).toMatch(/install\.sh \| bash -s -- --update$/);
    expect(s.command).not.toMatch(/guild-run/);
  });

  it("an UNKNOWN host fails closed — signal emitted, no command invented", () => {
    const s = signalFor("not-a-real-host");
    expect(s.update_available).toBe(true);
    expect(s.command).toBeNull();
    // Still tells the user they are stale; just refuses to name a wrong command.
    expect(renderSignalLine(s as never)).toMatch(/2\.2\.0 → 2\.3\.2/);
  });

  it("renders the reported scenario end to end for Codex", () => {
    expect(renderSignalLine(signalFor("codex-cli") as never)).toBe(
      "Guild update available on stable: 2.2.0 → 2.3.2 — run: curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update"
    );
  });

  it("strips the tag's v prefix — the signal renders VERSIONS, not tags", () => {
    // The real cache stores latest_tag verbatim from ls-remote ("v2.4.0"); the
    // synthetic CACHE above hides that by seeding a bare version. The v2.4.0
    // validation pass observed "2.2.0 → v2.4.0" live: installed was a version,
    // available a tag. Both sides must speak the same vocabulary.
    const cache = {
      schema_version: "guild.update_check_cache.v1",
      checked_at: "2026-07-29T00:00:00Z",
      remote: { latest_tag: "v2.4.0", latest_sha: null },
    } as never;
    const s = computeSignal({ state: STATE, cache, hostKind: "wrapper", hostId: "codex-cli" } as never) as {
      update_available: boolean;
    };
    expect(s.update_available).toBe(true);
    const line = renderSignalLine(s as never);
    expect(line).toMatch(/2\.2\.0 → 2\.4\.0/);
    expect(line).not.toContain("v2.4.0");
  });
});

// Asserting on build-host-packages.ts's SOURCE TEXT proves nothing about what it
// EMITS — a regex matches while the render could be misplaced or unusable. These
// render for real and inspect the output. The version-resolution case matters
// most: this rail's first version injected a synthetic state carrying
// version "2.2.0", so it could not have caught that a real Codex package
// resolved to null and the signal never fired at all.
describe("the RENDERED Codex package (not the source text)", () => {
  let out: string;
  let codexRoot: string;

  // The renderer writes guild.inventory.json back into --root (loadInventory's
  // documented side effect), so this block needs a WRITABLE root: it snapshots
  // and restores that file around the render.
  //
  // It HARD-FAILS rather than skipping when the root is read-only. An earlier
  // revision used describe.skip; a mode-0444 checkout then reported
  // "5 passed, 4 skipped", suite PASS, exit 0 — silently deleting the only
  // proof that the version-resolution blocker is fixed, with nothing in CI
  // rejecting skips. A test that cannot run must say so loudly.
  const inventoryPath = path.join(PLUGIN_ROOT, "guild.inventory.json");
  let inventoryBefore: Buffer | null = null;

  beforeAll(() => {
    try {
      fs.accessSync(inventoryPath, fs.constants.W_OK);
    } catch {
      throw new Error(
        `${inventoryPath} is not writable, so the renderer cannot run and the ` +
          "version-resolution regression cannot be proven. This block must not be " +
          "skipped — make the checkout writable and re-run."
      );
    }
    inventoryBefore = fs.readFileSync(inventoryPath);
    out = fs.mkdtempSync(path.join(os.tmpdir(), "guild-codex-render-"));
    execFileSync(
      "npx",
      ["tsx", "build-host-packages.ts", "--root", "..", "--out", out, "--generated-at", "1970-01-01T00:00:00Z"],
      { cwd: path.join(PLUGIN_ROOT, "scripts"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    codexRoot = path.join(out, "codex");
  }, 900_000);

  afterAll(() => {
    if (out) fs.rmSync(out, { recursive: true, force: true });
    // Restore byte-for-byte: the render is a side effect of the test, not a
    // change to the repository under test.
    // A failed restore leaves the checkout mutated; that must fail the run
    // rather than pass green with a modified inventory.
    if (inventoryBefore !== null) fs.writeFileSync(inventoryPath, inventoryBefore);
  });

  it("wires SessionStart at --host codex-cli in the EMITTED manifest", () => {
    const m = JSON.parse(fs.readFileSync(path.join(codexRoot, "hooks", "codex-hooks.json"), "utf8")) as {
      hooks: Record<string, { hooks: { command: string }[] }[]>;
    };
    const cmd = m.hooks["SessionStart"]?.[0]?.hooks?.[0]?.command ?? "";
    expect(cmd).toContain("hooks/dist/update-check.js");
    expect(cmd).toContain("--host codex-cli");
    // additive — the prompt bridge must survive
    expect(m.hooks["UserPromptSubmit"]?.[0]?.hooks?.[0]?.command ?? "").toContain("codex-guild-prompt-bridge");
  });

  it("SHIPS the binary that entry points at", () => {
    expect(fs.existsSync(path.join(codexRoot, "hooks", "dist", "update-check.js"))).toBe(true);
  });

  it("REGRESSION: version resolves from the package's OWN manifest", () => {
    // The blocker. The Codex package carries .codex-plugin/plugin.json and NOT
    // .claude-plugin/plugin.json; reading only the latter returned null, so
    // computeSignal saw no installed version and reported up-to-date forever.
    expect(fs.existsSync(path.join(codexRoot, ".codex-plugin", "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(codexRoot, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(readInstalledVersion(codexRoot)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("agents tree ships the update-check bundle its AGENTS.md preamble names (G4 file-surface fallback)", () => {
    const agentsRoot = path.join(out, "agents");
    // The instruction and its binary must ship together (issue-#55 class).
    expect(fs.existsSync(path.join(agentsRoot, "hooks", "dist", "update-check.js"))).toBe(true);
    const md = fs.readFileSync(path.join(agentsRoot, "AGENTS.md"), "utf8");
    expect(md).toContain("node hooks/dist/update-check.js --host agents-file");
    expect(md).toContain("## Update check (once per session)");
    // The honesty sentences ARE the fix — pin them, or a revert to
    // "silence means current" stays green (round-2 gate finding).
    expect(md).toContain("Silence is NOT proof of currency");
    expect(md).toContain("treat the package's age as unknown");
  });

  it("end to end: a stale RENDERED package produces a Codex-shaped signal", () => {
    const installed = readInstalledVersion(codexRoot);
    expect(installed).not.toBeNull();
    const state = { channel: "stable", version: installed, ref: "main", commit: null } as never;
    const cache = {
      schema_version: "guild.update_check_cache.v1",
      checked_at: "2026-07-26T00:00:00Z",
      remote: { latest_tag: "99.0.0", latest_sha: null },
    } as never;
    const s = computeSignal({ state, cache, hostKind: "wrapper", hostId: "codex-cli" } as never) as {
      update_available: boolean;
      command: string | null;
    };
    expect(s.update_available).toBe(true);
    expect(s.command).toMatch(/install\.sh \| bash -s -- --update$/);
  });
});

// RECEIPT MINTING (xhrd-wi-05): the SessionStart hook is the earliest Guild
// code a host-native install ever runs, so it mints the package-local receipt
// that `guild-run update` needs. Spawn-based on purpose: the child process
// gets a REAL environment, so HOME isolation works here (unlike in-process
// jest, where env mutations never reach os.homedir()).
describe("update-check mints a package-local receipt for host-native installs", () => {
  const HOOK = path.join(PLUGIN_ROOT, "hooks", "dist", "update-check.js");
  let base: string;
  let pkg: string;
  let home: string;

  const runHook = (extraEnv: Record<string, string> = {}) =>
    execFileSync("node", [HOOK, "--host", "codex-cli"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, GUILD_PLUGIN_ROOT: pkg, ...extraEnv },
    });

  beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), "guild-mint-"));
    pkg = path.join(base, "pkg");
    home = path.join(base, "home");
    fs.mkdirSync(path.join(pkg, ".codex-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pkg, ".codex-plugin", "plugin.json"),
      '{\n  "name": "guild",\n  "version": "2.3.2"\n}\n'
    );
    fs.mkdirSync(path.join(home, ".guild"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".guild", "update-check.json"),
      JSON.stringify({
        schema_version: "guild.update_check_cache.v1",
        checked_at: "2099-01-01T00:00:00Z",
        source_repo: "fixture",
        remote: { latest_tag: "9.9.9", latest_sha: null },
      })
    );
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("mints host/version/channel from the package itself, and still emits the signal", () => {
    const out = runHook();
    expect(out).toContain("2.3.2 → 9.9.9 — run: curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update");
    const r = JSON.parse(fs.readFileSync(path.join(pkg, "guild-install-receipt.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(r["schema_version"]).toBe("guild.install_receipt.v1");
    expect(r["host"]).toBe("codex-cli");
    expect(r["version"]).toBe("2.3.2");
    expect(r["channel"]).toBe("stable");
    expect(r["commit"]).toBeNull();
    // Identification-only markers: the channel above is an ASSUMED default,
    // and these fields are what say so. Their absence would silently restore
    // a receipt that reads as authoritative.
    expect(r["managed_by"]).toBe("host-native");
    expect(r["channel_confidence"]).toBe("assumed-default");
  });

  it("does NOT clobber an existing receipt on later sessions", () => {
    runHook();
    const first = fs.readFileSync(path.join(pkg, "guild-install-receipt.json"), "utf8");
    runHook();
    expect(fs.readFileSync(path.join(pkg, "guild-install-receipt.json"), "utf8")).toBe(first);
  });

  it("fail-open: an unwritable package root still emits the signal, no receipt, no crash", () => {
    fs.chmodSync(pkg, 0o555);
    try {
      const out = runHook();
      expect(out).toContain("2.3.2 → 9.9.9");
      expect(fs.existsSync(path.join(pkg, "guild-install-receipt.json"))).toBe(false);
    } finally {
      fs.chmodSync(pkg, 0o755);
    }
  });

  it("the minted receipt is accepted by self-update's readReceipt", () => {
    runHook();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readReceipt } = require("../lib/self-update") as typeof import("../lib/self-update");
    const r = readReceipt(pkg);
    expect(r).not.toBeNull();
    expect(r!.host).toBe("codex-cli");
  });
});
