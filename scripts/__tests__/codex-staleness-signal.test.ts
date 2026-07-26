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
  it("Codex gets its own command, NOT Claude's", () => {
    const s = signalFor("codex-cli");
    expect(s.update_available).toBe(true);
    expect(s.command).toBe("guild-run update");
    // The specific regression: a Codex user must never be told to run `claude …`.
    expect(s.command).not.toMatch(/^claude /);
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
      "Guild update available on stable: 2.2.0 → 2.3.2 — run: guild-run update"
    );
  });
});

// Asserting on build-host-packages.ts's SOURCE TEXT proves nothing about what it
// EMITS — a regex matches while the render could be misplaced or unusable. These
// render for real and inspect the output. The version-resolution case matters
// most: this rail's first version injected a synthetic state carrying
// version "2.2.0", so it could not have caught that a real Codex package
// resolved to null and the signal never fired at all.
function rootIsWritable(): boolean {
  try {
    fs.accessSync(path.join(PLUGIN_ROOT, "guild.inventory.json"), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const describeRender = rootIsWritable() ? describe : describe.skip;

describeRender("the RENDERED Codex package (not the source text)", () => {
  let out: string;
  let codexRoot: string;

  // The renderer writes guild.inventory.json back into --root (loadInventory's
  // documented side effect), so this block needs a WRITABLE root. It snapshots
  // and restores that file, and skips entirely on a read-only checkout rather
  // than failing EPERM — CI checkouts are writable, so coverage is not lost
  // where it matters. `describe.skip` is deliberate over a silent pass: a
  // skipped test reports as skipped, not as green.
  const inventoryPath = path.join(PLUGIN_ROOT, "guild.inventory.json");
  let inventoryBefore: Buffer | null = null;

  beforeAll(() => {
    try {
      inventoryBefore = fs.readFileSync(inventoryPath);
    } catch {
      inventoryBefore = null;
    }
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
    if (inventoryBefore !== null) {
      try {
        fs.writeFileSync(inventoryPath, inventoryBefore);
      } catch {
        // read-only root: nothing was written, so nothing to restore
      }
    }
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
    expect(s.command).toBe("guild-run update");
  });
});
