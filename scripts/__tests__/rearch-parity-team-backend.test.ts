/**
 * scripts/__tests__/rearch-parity-team-backend.test.ts
 *
 * W3 parity test — team-backend.ts split into core/contracts + host/* + capability/backend-factory.
 *
 * Imports via the ORIGINAL path (scripts/lib/team-backend) to verify the shim resolves.
 * Anti-vacuity control: asserts different outcomes for different inputs.
 *
 * // @control: anti-vacuity-control (see bottom of file)
 */

import {
  TmuxTeamBackend,
  InProcessTeamBackend,
  SerialBackend,
  RemoteTeamBackend,
  CmuxTeamBackend,
  MockTransport,
  SshRemoteTransport,
  composeInProcessDispatch,
  composeTmuxCommands,
  buildPrompt,
  paneCommand,
  shellQuote,
  wrapLoginShell,
  binaryForHostKind,
  parseCmuxSurfaceId,
  probeTmuxAvailable,
  terminateCmuxSurface,
  type Specialist,
  type TeamLaunchRequest,
  type TeamBackend,
  type PaneAdapter,
  type PaneSpec,
} from "../lib/team-backend"; // ORIGINAL path — the shim
import * as teamBackendExports from "../lib/team-backend";

const BASE_REQ: TeamLaunchRequest = {
  slug: "my-team",
  runId: "run-001",
  cwd: "/workspace",
  specialists: [],
  targetName: "guild-my-team",
  mode: "new-session",
  dryRun: true,
};

const SPEC: Specialist = {
  name: "backend",
  scope: "api layer",
  dependsOn: [],
};

describe("team-backend shim — parity after W3 split", () => {
  // ── shim exports all expected symbols ──────────────────────────────────────
  it("exports TmuxTeamBackend", () => expect(typeof TmuxTeamBackend).toBe("function"));
  it("exports InProcessTeamBackend", () => expect(typeof InProcessTeamBackend).toBe("function"));
  it("exports SerialBackend", () => expect(typeof SerialBackend).toBe("function"));
  it("exports RemoteTeamBackend", () => expect(typeof RemoteTeamBackend).toBe("function"));
  it("exports CmuxTeamBackend", () => expect(typeof CmuxTeamBackend).toBe("function"));
  it("exports MockTransport", () => expect(typeof MockTransport).toBe("function"));
  it("exports SshRemoteTransport", () => expect(typeof SshRemoteTransport).toBe("function"));
  it("exports composeInProcessDispatch", () => expect(typeof composeInProcessDispatch).toBe("function"));
  it("exports composeTmuxCommands", () => expect(typeof composeTmuxCommands).toBe("function"));
  it("exports buildPrompt", () => expect(typeof buildPrompt).toBe("function"));
  it("exports paneCommand", () => expect(typeof paneCommand).toBe("function"));
  it("exports shellQuote", () => expect(typeof shellQuote).toBe("function"));
  it("exports wrapLoginShell", () => expect(typeof wrapLoginShell).toBe("function"));
  it("exports binaryForHostKind", () => expect(typeof binaryForHostKind).toBe("function"));
  it("exports parseCmuxSurfaceId", () => expect(typeof parseCmuxSurfaceId).toBe("function"));
  it("exports probeTmuxAvailable", () => expect(typeof probeTmuxAvailable).toBe("function"));
  it("exports terminateCmuxSurface", () => expect(typeof terminateCmuxSurface).toBe("function"));
  it("exports the exact original runtime shim surface (no helper leaks)", () => {
    expect(Object.keys(teamBackendExports).sort()).toEqual([
      "CmuxTeamBackend",
      "InProcessTeamBackend",
      "MockTransport",
      "RemoteTeamBackend",
      "SerialBackend",
      "SshRemoteTransport",
      "TmuxTeamBackend",
      "binaryForHostKind",
      "buildPrompt",
      "composeInProcessDispatch",
      "composeTmuxCommands",
      "paneCommand",
      "parseCmuxSurfaceId",
      "probeTmuxAvailable",
      "shellQuote",
      "terminateCmuxSurface",
      "wrapLoginShell",
    ]);
  });

  // ── InProcessTeamBackend ───────────────────────────────────────────────────
  it("InProcessTeamBackend.isAvailable() = true", () => {
    expect(new InProcessTeamBackend().isAvailable()).toBe(true);
  });

  it("InProcessTeamBackend.launch() returns dispatchPlan", () => {
    const backend = new InProcessTeamBackend();
    const req = { ...BASE_REQ, specialists: [SPEC] };
    const result = backend.launch(req);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("in-process");
    expect(result.dispatchPlan).toHaveLength(1);
    expect(result.dispatchPlan![0]!.name).toBe("backend");
  });

  // ── SerialBackend ──────────────────────────────────────────────────────────
  it("SerialBackend.isAvailable() = true (always the floor)", () => {
    expect(new SerialBackend().isAvailable()).toBe(true);
  });

  it("SerialBackend.launch() sets parallelism=1 + substrateDegradation", () => {
    const backend = new SerialBackend();
    const req = { ...BASE_REQ, specialists: [SPEC] };
    const result = backend.launch(req);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("serial");
    expect(result.parallelism).toBe(1);
    expect(result.substrateDegradation).toBeDefined();
  });

  // ── RemoteTeamBackend ──────────────────────────────────────────────────────
  it("RemoteTeamBackend with no transport: isAvailable() = false", () => {
    expect(new RemoteTeamBackend().isAvailable()).toBe(false);
  });

  it("RemoteTeamBackend with MockTransport: isAvailable() = true", () => {
    const transport = new MockTransport();
    expect(new RemoteTeamBackend({ transport }).isAvailable()).toBe(true);
  });

  // ── composeInProcessDispatch ───────────────────────────────────────────────
  it("composeInProcessDispatch produces one descriptor per specialist", () => {
    const req = { ...BASE_REQ, specialists: [SPEC, { ...SPEC, name: "qa" }] };
    const plan = composeInProcessDispatch(req);
    expect(plan).toHaveLength(2);
    expect(plan[0]!.name).toBe("backend");
    expect(plan[1]!.name).toBe("qa");
  });

  // ── shellQuote ─────────────────────────────────────────────────────────────
  it("shellQuote passes safe strings through", () => {
    expect(shellQuote("hello")).toBe("hello");
  });
  it("shellQuote wraps strings with spaces in single quotes", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  // ── wrapLoginShell ─────────────────────────────────────────────────────────
  it("wrapLoginShell wraps command in shell -lic", () => {
    expect(wrapLoginShell("codex run", "zsh")).toBe("zsh -lic 'codex run'");
  });

  // ── buildPrompt ────────────────────────────────────────────────────────────
  it("buildPrompt for orchestrator (null specialist) includes team slug", () => {
    const p = buildPrompt("my-team", "run-001", null);
    expect(p).toContain("my-team");
    expect(p).toContain("run-001");
    expect(p).toContain("orchestrator");
  });

  it("buildPrompt for specialist includes specialist name", () => {
    const p = buildPrompt("my-team", "run-001", SPEC);
    expect(p).toContain("backend");
    expect(p).toContain("run-001");
  });

  // ── binaryForHostKind ──────────────────────────────────────────────────────
  it("binaryForHostKind('antigravity-2') = 'agy'", () => {
    expect(binaryForHostKind("antigravity-2")).toBe("agy");
  });
  it("binaryForHostKind('claude') = 'claude'", () => {
    expect(binaryForHostKind("claude")).toBe("claude");
  });

  // ── Anti-vacuity control ───────────────────────────────────────────────────
  // @control: anti-vacuity-control
  // InProcess and Serial BOTH produce a dispatch plan for the same request,
  // but Serial adds parallelism=1 + substrateDegradation. If either were a
  // no-op, they would produce identical outputs — this control proves they differ.
  it("ANTI-VACUITY CONTROL: InProcess vs Serial have DIFFERENT result shapes", () => {
    const req = { ...BASE_REQ, specialists: [SPEC] };
    const ipResult = new InProcessTeamBackend().launch(req);
    const serialResult = new SerialBackend().launch(req);
    // Both ok=true and same dispatchPlan, but Serial adds fields InProcess doesn't have
    expect(ipResult.parallelism).toBeUndefined();
    expect(serialResult.parallelism).toBe(1);
    expect(ipResult.substrateDegradation).toBeUndefined();
    expect(serialResult.substrateDegradation).toBeDefined();
    // Dispatch plans are structurally identical (same composeInProcessDispatch call)
    expect(ipResult.dispatchPlan).toEqual(serialResult.dispatchPlan);
  });
});
