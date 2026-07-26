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

import * as fs from "node:fs";
import * as path from "node:path";

import {
  computeSignal,
  renderSignalLine,
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

describe("the Codex package actually carries the wiring", () => {
  const buildSrc = fs.readFileSync(path.join(PLUGIN_ROOT, "scripts", "build-host-packages.ts"), "utf8");

  it("wires SessionStart into the generated codex-hooks.json", () => {
    expect(buildSrc).toMatch(/SessionStart:\s*\[/);
    expect(buildSrc).toContain("CODEX_UPDATE_CHECK_COMMAND");
  });

  it("passes --host codex-cli so no receipt is needed", () => {
    expect(buildSrc).toMatch(/update-check\.js.*--host codex-cli/);
  });

  it("SHIPS the binary the SessionStart entry points at", () => {
    // A hook entry whose target is not in the package is the issue-#55 defect
    // class: a documented invocation that dies with ERR_MODULE_NOT_FOUND.
    expect(buildSrc).toMatch(/copyFileRequired\(\s*\n?\s*path\.join\(root, "hooks", "dist", "update-check\.js"\)/);
  });

  it("keeps the existing UserPromptSubmit bridge (additive, not a swap)", () => {
    expect(buildSrc).toMatch(/UserPromptSubmit:\s*\[/);
    expect(buildSrc).toContain("CODEX_HOOK_COMMAND");
  });
});
