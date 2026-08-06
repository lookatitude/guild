/**
 * scripts/__tests__/remote-hook-enforcement-probe.test.ts
 *
 * ISSUE #94 (secondary) — TIGHTEN RemoteTransport.probeHooks FROM PRESENCE TO
 * EXECUTION.
 *
 * THE INHERITED WEAKNESS. rf-wi-04 / PR #88 shipped `probeHooks` as a
 * file-presence test — `[ -f "$root/hooks/hooks.json" ]` — and documented the
 * gap honestly: presence proves the bundle is ON DISK, not that the host LOADED
 * it. A stale or partial remote checkout pointed at by GUILD_PLUGIN_ROOT is a
 * false positive. PR #88 compensated by making the remote bypass opt-in on top
 * of the proof, and filed the tighter proof as a followup.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKED. The codex half of this same issue
 * CONFIRMED the failure mode on real hardware rather than in theory: with a
 * valid hooks manifest registering a working deny hook, codex ran the tool
 * ANYWAY because the hook was untrusted — no execution, no output, NO WARNING.
 * "Registered and present" and "actually enforcing" are genuinely different
 * states, and only one of them is safe to grant a bypass against.
 *
 * WHAT THIS CHANGES. The probe now EXECUTES the far host's own enforcement
 * binary (`$GUILD_PLUGIN_ROOT/hooks/dist/pre-tool-use.js`) against a synthetic
 * PreToolUse event and requires a real gating decision back. A stale checkout
 * that merely contains a hooks.json no longer passes.
 *
 * WHAT THIS DOES NOT CLAIM — the precise residual. The followup's literal
 * wording was "query the live remote Claude for its LOADED hook set". That is
 * NOT achievable: Claude Code exposes no such query. `claude doctor` (checked
 * on 2.1.223) reports install health, settings validity and MCP wiring — it
 * does not enumerate loaded hooks, and there is no other documented surface.
 * So this probe proves ENFORCEMENT IS EXECUTABLE ON THE FAR HOST, which is
 * strictly stronger than file presence and weaker than introspecting the live
 * session's hook table. The remote bypass therefore REMAINS opt-in on top.
 *
 * RED before the fix.
 */

import { SshRemoteTransport } from "../lib/host/remote-backend";
import type { RunFn, RunResult } from "../lib/core/contracts/team-backend";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PLUGIN_ROOT } from "../build-inventory";
import type { RemoteHostTarget } from "../lib/core/contracts/team-backend";

function target(hostId: string, hostKind: string, loginShell?: string): RemoteHostTarget {
  return {
    hostId,
    hostKind,
    endpoint: `user@${hostId}`,
    ...(loginShell ? { loginShell } : {}),
  } as RemoteHostTarget;
}

function recording(result: RunResult): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: RunFn = (cmd, args) => {
    calls.push({ cmd, args });
    return result;
  };
  return { run, calls };
}

describe("probeHooks EXECUTES the remote enforcement binary (not just stat)", () => {
  it("invokes the remote hooks/dist/pre-tool-use.js rather than only testing hooks.json", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    const remoteCmd = calls[0].args.at(-1) ?? "";
    expect(remoteCmd).toContain("hooks/dist/pre-tool-use.js");
  });

  it("feeds it a PreToolUse event — the probe must exercise the gate, not the filesystem", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    const remoteCmd = calls[0].args.at(-1) ?? "";
    expect(remoteCmd).toContain("PreToolUse");
    // A scope that excludes the probed tool is what forces a gating decision.
    expect(remoteCmd).toContain("GUILD_CAPABILITY_SCOPE");
  });

  it("accepts the enforcement signal as proof", () => {
    const { run } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    expect(new SshRemoteTransport({ run }).probeHooks(target("box", "claude")).installed).toBe(true);
  });

  /**
   * THE REGRESSION THIS EXISTS FOR: the stale-checkout false positive. Under the
   * old presence probe this host PASSED (hooks.json is right there on disk); the
   * binary never produced a decision, so nothing was ever enforcing.
   */
  it("FAILS a host whose bundle is present but produces no gating decision", () => {
    const { run } = recording({ status: 0, stdout: "", stderr: "" });
    const r = new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    expect(r.installed).toBe(false);
    expect(r.detail).toMatch(/BARE|withheld/i);
  });

  /**
   * REGISTRATION IS A SEPARATE FACT FROM EXECUTABILITY. An execution-only probe
   * passes on a tree that merely CONTAINS the binary — a resources mirror, a
   * vendored copy — while the host has wired nothing. The snippet must require
   * that hooks.json actually names the hook.
   */
  it("requires hooks.json to REGISTER the hook, not just ship the binary", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    const remoteCmd = calls[0].args.at(-1) ?? "";
    expect(remoteCmd).toContain("hooks/hooks.json");
    expect(remoteCmd).toContain(String.raw`grep -q "hooks/dist/pre-tool-use.js"`);
  });

  /**
   * A hook that crashes after printing must not pass. Left inside a pipeline,
   * `grep`'s status — not node's — decides, so node's output is captured into a
   * variable and its exit status checked before the match.
   */
  it("checks node's own exit status rather than the pipeline's", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude"));
    const remoteCmd = calls[0].args.at(-1) ?? "";
    expect(remoteCmd).toContain("out=$(");
    expect(remoteCmd).not.toMatch(/pre-tool-use\.js" 2>\/dev\/null \| grep/);
  });

  it("FAILS when the ssh hop itself fails (fail-closed, never assume enforcing)", () => {
    const { run } = recording({ status: 255, stdout: "", stderr: "ssh: connect refused" });
    expect(new SshRemoteTransport({ run }).probeHooks(target("box", "claude")).installed).toBe(false);
  });

  it("still login-shell-wraps the probe when the host carries a loginShell", () => {
    const { run, calls } = recording({ status: 0, stdout: "GUILD_HOOKS_ENFORCING\n", stderr: "" });
    new SshRemoteTransport({ run }).probeHooks(target("box", "claude", "zsh"));
    expect(calls[0].args.at(-1)).toMatch(/^zsh -lic /);
  });
});

// ── the snippet is REALLY executed, not just string-matched ──────────────────

describe("the generated remote snippet behaves as claimed when actually run", () => {
  /**
   * Every other test here inspects the shell text or feeds back a canned marker.
   * That proves the transport reads the signal, not that the signal means
   * anything. These run the ACTUAL generated snippet under `sh` against real
   * trees — the only way to know the conjuncts hold.
   */
  const snippet = (): string => {
    let cmd = "";
    new SshRemoteTransport({
      run: (_c, a) => {
        cmd = a.at(-1) ?? "";
        return { status: 0, stdout: "", stderr: "" };
      },
    }).probeHooks(target("box", "claude"));
    return cmd;
  };

  const runSnippet = (root: string): string =>
    spawnSync("sh", ["-c", snippet()], {
      encoding: "utf8",
      env: { ...process.env, GUILD_PLUGIN_ROOT: root },
    }).stdout ?? "";

  it("emits the signal against a real Guild plugin root", () => {
    expect(runSnippet(PLUGIN_ROOT)).toContain("GUILD_HOOKS_ENFORCING");
  });

  /** The stale/partial-checkout false positive the old presence probe allowed. */
  it("emits NOTHING for a tree that ships the binary but registers nothing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-remote94-"));
    try {
      fs.mkdirSync(path.join(dir, "hooks", "dist"), { recursive: true });
      fs.copyFileSync(
        path.join(PLUGIN_ROOT, "hooks", "dist", "pre-tool-use.js"),
        path.join(dir, "hooks", "dist", "pre-tool-use.js"),
      );
      expect(runSnippet(dir)).not.toContain("GUILD_HOOKS_ENFORCING");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits nothing when no plugin root is set at all", () => {
    expect(runSnippet("")).not.toContain("GUILD_HOOKS_ENFORCING");
  });
});
