/**
 * scripts/__tests__/cmux-backend-selection.test.ts
 *
 * W4 (run-identity-and-dispatch): cmux is a FIRST-CLASS backend value —
 * selected by the substrate ladder and frozen into the run-start snapshot —
 * not a disguised tmux branch that only the hooks' degradation guard knows
 * about.
 *
 * Two seams under test:
 *
 *   1. `selectExecutionSubstrate` (the launcher seam): a cmux workspace
 *      (CMUX_WORKSPACE_ID present, read through the injectable probe) wins
 *      rung 0 of `team` — BEFORE any tmux probe — for both explicit team and
 *      auto. The selection's transport_id is the honest "cmux" value; a
 *      launcher seeing it must hand dispatch back to the lead (visible cmux
 *      surfaces) instead of launching tmux panes.
 *
 *   2. `runStartPreflight` (the intake freeze): the snapshot persisted to
 *      resolved-settings.json carries the resolved dispatch backend + the raw
 *      capability facts it was resolved from, so backend resolution is frozen
 *      at intake (ledger RID-D-CONSTRAINT) and later phases read the snapshot
 *      instead of re-probing.
 *
 * NEGATIVE CONTROLS: no cmux fact → the pre-cmux ladder is byte-identical
 * (reason strings pinned); explicit agent/subagent pins are never hijacked by
 * a present cmux workspace.
 *
 * NOTE (live proof boundary): these are isolation tests over injected probes.
 * Live end-to-end proof on a real cmux workspace (visible non-focus-stealing
 * surfaces) is EXPLICITLY PENDING until a live cmux session is available — no
 * test in this file claims it.
 */

import {
  selectExecutionSubstrate,
  type ExecutionCapabilityProbe,
} from "../../src/modules/dispatch/workflows/execution-transport-ports";
import {
  runStartPreflight,
  resolveRunStartDispatchBackend,
  type PreflightProbe,
} from "../lib/runstart-preflight";
import type { ProbeEnv } from "../../src/modules/host-runtime";
import * as fs from "fs";
import * as os from "os";
import * as nodePath from "path";

function probe(facts: {
  cmux?: boolean;
  inside?: boolean;
  available?: boolean;
  independent?: boolean;
}): ExecutionCapabilityProbe & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    insideCmuxWorkspace: () => (calls.push("cmux"), facts.cmux ?? false),
    insideMultiplexer: () => (calls.push("inside"), facts.inside ?? false),
    multiplexerAvailable: () => (calls.push("available"), facts.available ?? false),
    independentAgents: () => (calls.push("independent"), facts.independent ?? false),
  };
}

describe("W4 — cmux rung of the substrate ladder (first-class, not a tmux disguise)", () => {
  it("explicit team + cmux workspace → team over cmux, tmux never probed", () => {
    const p = probe({ cmux: true, available: true });
    const selection = selectExecutionSubstrate({ requested_mode: "team", dry_run: false }, p);
    expect(selection.dispatch_mode).toBe("team");
    expect(selection.transport_id).toBe("cmux");
    expect(selection.degraded_from).toBeNull();
    expect(p.calls).not.toContain("available");
    expect(p.calls).not.toContain("inside");
  });

  it("auto + cmux workspace → team over cmux (rung 0, before any tmux probe)", () => {
    const p = probe({ cmux: true, inside: true, available: true });
    const selection = selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, p);
    expect(selection.dispatch_mode).toBe("team");
    expect(selection.transport_id).toBe("cmux");
    expect(p.calls[0]).toBe("cmux");
    expect(p.calls).not.toContain("inside");
  });

  it("NEGATIVE: no cmux fact → the pre-cmux ladder is unchanged (pinned reasons)", () => {
    expect(
      selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, probe({ inside: true })).reason
    ).toBe("auto: $TMUX set → team in-session");
    expect(
      selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, probe({ available: true })).reason
    ).toBe("auto: tmux installed → team new-session");
    expect(
      selectExecutionSubstrate({ requested_mode: "team", dry_run: false }, probe({})).reason
    ).toBe("agent_mode=team pinned but tmux unavailable → subagent fallback");
  });

  it("NEGATIVE: explicit agent/subagent pins are never hijacked by a cmux workspace", () => {
    const agent = selectExecutionSubstrate({ requested_mode: "agent", dry_run: false }, probe({ cmux: true }));
    expect(agent.dispatch_mode).toBe("agent");
    expect(agent.transport_id).toBe("in-process");
    const sub = selectExecutionSubstrate({ requested_mode: "subagent", dry_run: false }, probe({ cmux: true }));
    expect(sub.dispatch_mode).toBe("subagent");
  });

  it("a probe WITHOUT the optional cmux member (legacy implementor) never selects cmux", () => {
    const legacy: ExecutionCapabilityProbe = {
      insideMultiplexer: () => false,
      multiplexerAvailable: () => true,
      independentAgents: () => false,
    };
    const selection = selectExecutionSubstrate({ requested_mode: "auto", dry_run: false }, legacy);
    expect(selection.transport_id).toBe("tmux");
  });
});

describe("W4 — resolveRunStartDispatchBackend (pure intake ladder)", () => {
  it("team/auto: cmux > tmux > subagent floor", () => {
    expect(resolveRunStartDispatchBackend("team", { cmuxWorkspacePresent: true, tmuxOnPath: true }).backend).toBe("cmux");
    expect(resolveRunStartDispatchBackend("auto", { cmuxWorkspacePresent: true, tmuxOnPath: false }).backend).toBe("cmux");
    expect(resolveRunStartDispatchBackend("team", { cmuxWorkspacePresent: false, tmuxOnPath: true }).backend).toBe("tmux");
    expect(resolveRunStartDispatchBackend("auto", { cmuxWorkspacePresent: false, tmuxOnPath: false }).backend).toBe("subagent");
  });

  it("explicit agent/subagent pins pass through untouched", () => {
    expect(resolveRunStartDispatchBackend("agent", { cmuxWorkspacePresent: true, tmuxOnPath: true }).backend).toBe("agent");
    expect(resolveRunStartDispatchBackend("subagent", { cmuxWorkspacePresent: true, tmuxOnPath: true }).backend).toBe("subagent");
  });
});

describe("W4 — run-start snapshot freezes the backend + capability facts", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(nodePath.join(os.tmpdir(), "guild-cmux-preflight-"));
  });
  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  function preflightProbe(opts: { cmux: boolean; tmux: boolean }): PreflightProbe {
    const providerProbe: ProbeEnv = {
      env: {},
      isFile: () => false,
      exec: () => ({ ok: false, stdout: "" }),
    } as unknown as ProbeEnv;
    return {
      tmuxOnPath: () => opts.tmux,
      providerProbe,
      incompleteRun: () => null,
      cmuxWorkspacePresent: () => opts.cmux,
    };
  }

  it("cmux workspace present → snapshot.dispatch freezes backend 'cmux' with the raw facts", () => {
    const result = runStartPreflight({
      cwd,
      flags: { agent_mode: "team" } as never,
      probe: preflightProbe({ cmux: true, tmux: true }),
    });
    expect(result.snapshot.dispatch).toBeDefined();
    expect(result.snapshot.dispatch.backend).toBe("cmux");
    expect(result.snapshot.dispatch.facts.cmux_workspace_present).toBe(true);
    expect(result.snapshot.dispatch.facts.tmux_on_path).toBe(true);
    expect(typeof result.snapshot.dispatch.reason).toBe("string");
  });

  it("no cmux workspace → tmux backend frozen when agent_mode resolves team-ward", () => {
    const result = runStartPreflight({
      cwd,
      flags: { agent_mode: "team" } as never,
      probe: preflightProbe({ cmux: false, tmux: true }),
    });
    expect(result.snapshot.dispatch.backend).toBe("tmux");
    expect(result.snapshot.dispatch.facts.cmux_workspace_present).toBe(false);
  });

  it("a probe without the optional cmux member records the honest false fact", () => {
    const p = preflightProbe({ cmux: false, tmux: false });
    delete (p as Partial<PreflightProbe>).cmuxWorkspacePresent;
    const result = runStartPreflight({
      cwd,
      flags: { agent_mode: "auto" } as never,
      probe: p,
    });
    expect(result.snapshot.dispatch.facts.cmux_workspace_present).toBe(false);
    expect(result.snapshot.dispatch.backend).not.toBe("cmux");
  });
});
