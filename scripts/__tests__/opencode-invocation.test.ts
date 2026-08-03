/**
 * scripts/__tests__/opencode-invocation.test.ts
 *
 * OPENCODE NON-INTERACTIVE INVOCATION (issue #104 host verification).
 *
 * THE DEFECT. The G4b wrapped-CLI convention assumed `-p '<prompt>'` for all
 * four new-CLI hosts. Live verification on opencode 1.18.5 (2026-07-30) showed
 * `opencode -p "test"` silently IGNORES the flag and opens the interactive TUI
 * — for a wrapper that means a hung pane, not an error. The real
 * non-interactive form is the `run` subcommand with a positional message
 * (`opencode run "<prompt>"`), confirmed live end to end (the model answered).
 *
 * Both argv-producing sites must agree: the guild-run wrapper plan and the
 * WrappedCliPaneAdapter pane command.
 */

import { planWrapperInvocation } from "../lib/guild-run-wrapper";
import { WrappedCliPaneAdapter } from "../lib/pane-adapter";
import { HOST_REGISTRY_ROWS } from "../lib/host-registry";
import type { HostKind } from "../lib/host-types";

function planArgs(host: string): string[] {
  const plan = planWrapperInvocation({ host, prompt: "hello world", cwd: "/tmp" } as never) as {
    args: string[];
  };
  return plan.args;
}

describe("guild-run wrapper plan — opencode uses `run`, not `-p`", () => {
  it("opencode: positional `run <prompt>`", () => {
    const args = planArgs("opencode");
    expect(args).toEqual(["run", "hello world"]);
    expect(args).not.toContain("-p");
  });

  it("the verified `-p` hosts are untouched (cursor, github-copilot)", () => {
    // cursor-agent -p: flag accepted live; gh copilot -p: real completion ran.
    expect(planArgs("cursor")).toEqual(["-p", "hello world"]);
    expect(planArgs("github-copilot")).toEqual(["copilot", "-p", "hello world"]);
  });

  it("rovo-dev keeps the (still-INFERRED) convention — auth-walled from verification", () => {
    expect(planArgs("rovo-dev")).toEqual(["rovodev", "-p", "hello world"]);
  });
});

describe("WrappedCliPaneAdapter pane command — opencode uses `run`, not `-p`", () => {
  function paneCommand(hostId: string): string {
    const row = HOST_REGISTRY_ROWS[hostId as keyof typeof HOST_REGISTRY_ROWS];
    const adapter = new WrappedCliPaneAdapter(row as never, hostId as HostKind);
    return adapter.command({
      runId: "r1",
      laneId: "l1",
      prompt: "hello world",
      cwd: "/tmp",
    } as never);
  }

  it("opencode pane spawns `opencode run '<prompt>'`", () => {
    const cmd = paneCommand("opencode");
    expect(cmd).toContain("opencode run 'hello world'");
    expect(cmd).not.toContain("opencode -p");
  });

  it("cursor pane keeps `-p` (verified live)", () => {
    expect(paneCommand("cursor")).toContain("cursor-agent -p 'hello world'");
  });
});
