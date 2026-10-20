/**
 * hooks/lib/__tests__/h2-dispatch-integrity.test.ts
 *
 * #144 — the ENV half of the producer marker (`GUILD_DISPATCH_PRODUCER`) is a
 * required corroborating signal:
 *   [x] env carriers WITHOUT a valid marker grade "carrier_only", never "structured"
 *   [x] carriers + a valid marker still grade "structured"
 *   [x] default posture is unchanged: carrier_only is still denied under team+substrate,
 *       and still denied by the #60 missing-model rung (no weakening)
 *   [x] strict mode (block_unmarked_lanes) denies a carrier_only lane in EVERY agent_mode
 *   [x] strict mode does not widen the prompt-only false-positive surface outside team rows
 *   [x] default posture outside team rows: carrier_only passes (pre-#85 migration path)
 *   [x] the deny message names the missing env marker
 *
 * #146 — one atomic, digest-verified snapshot read:
 *   [x] readRunSettingsSnapshot returns agent_mode + block_unmarked_lanes from ONE parse
 *   [x] an edited snapshot reads as "mismatch" and yields no values
 *   [x] a mismatched snapshot fails CLOSED: a lane with env evidence is denied in any mode
 *   [x] legacy snapshot (no sidecar) keeps pre-#146 behaviour
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resolveDispatchAttribution } from "../dispatch-attribution";
import {
  BLOCK_UNMARKED_ENV,
  buildDenyMessage,
  classifyLaneEvidence,
  PRODUCER_MARKER_ENV,
  readRunSettingsSnapshot,
  resolveBackendDegradation,
  resolveBlockUnmarkedFromSnapshot,
} from "../backend-degradation";
import { resolveTierDispatch } from "../tier-dispatch";
import { resolvedSettingsDigest } from "../../../src/domains/state";

const RUN_ID = "run-h2";

/** A composed lane: every env carrier AND the marker (an intact producer). */
const MARKED = {
  subagent_type: "guild:developer",
  prompt: "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=developer\nDo the lane.",
  env: {
    GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
    GUILD_SPECIALIST: "developer",
    GUILD_TASK_ID: "t1",
    GUILD_RUN_ID: RUN_ID,
  },
};

/** The #144 shape: same dispatch with the env marker token stripped. */
const TOKEN_STRIPPED = {
  ...MARKED,
  env: { GUILD_SPECIALIST: "developer", GUILD_TASK_ID: "t1", GUILD_RUN_ID: RUN_ID },
};

/** A bogus marker value is not a marker. */
const BOGUS_MARKER = {
  ...MARKED,
  env: { ...TOKEN_STRIPPED.env, GUILD_DISPATCH_PRODUCER: "guild.dispatch.junk" },
};

/** A hand-rolled lane: prompt text only. */
const PROMPT_ONLY = {
  subagent_type: "general-purpose",
  prompt: "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=developer\nwork",
};

function attrOf(input: Record<string, unknown>) {
  const a = resolveDispatchAttribution(input);
  if (a === null) throw new Error("expected Agent-shaped tool_input");
  return a;
}

function facts(
  input: { prompt: string } & Record<string, unknown>,
  over: Partial<Parameters<typeof resolveBackendDegradation>[0]> = {},
): Parameters<typeof resolveBackendDegradation>[0] {
  return {
    toolInput: input,
    attr: attrOf(input),
    prompt: input.prompt,
    runId: RUN_ID,
    agentMode: "team",
    substrate: "tmux",
    overrideEngaged: false,
    isLead: true,
    runFresh: true,
    blockUnmarked: false,
    ...over,
  };
}

describe("#144 — the env marker is required for STRUCTURED evidence", () => {
  it("carriers without the env marker grade carrier_only", () => {
    expect(classifyLaneEvidence(TOKEN_STRIPPED, attrOf(TOKEN_STRIPPED), TOKEN_STRIPPED.prompt, RUN_ID)).toBe(
      "carrier_only",
    );
  });
  it("a bogus marker value does not corroborate", () => {
    expect(classifyLaneEvidence(BOGUS_MARKER, attrOf(BOGUS_MARKER), BOGUS_MARKER.prompt, RUN_ID)).toBe(
      "carrier_only",
    );
  });
  it("carriers + a valid marker grade structured", () => {
    expect(classifyLaneEvidence(MARKED, attrOf(MARKED), MARKED.prompt, RUN_ID)).toBe("structured");
  });
  it("control: prompt text alone is still prompt_only", () => {
    expect(classifyLaneEvidence(PROMPT_ONLY, attrOf(PROMPT_ONLY), PROMPT_ONLY.prompt, RUN_ID)).toBe(
      "prompt_only",
    );
  });
});

describe("#144 — default posture is never weakened", () => {
  it("team + tmux: a token-stripped lane is still DENIED", () => {
    const r = resolveBackendDegradation(facts(TOKEN_STRIPPED));
    expect(r.decision).toBe("deny");
    expect(r.evidence).toBe("carrier_only");
    expect(r.reason).toBe("team_substrate_available");
  });
  it("#60: a token-stripped lane with no model param is still DENIED", () => {
    const r = resolveTierDispatch({
      toolInput: TOKEN_STRIPPED,
      attr: attrOf(TOKEN_STRIPPED),
      prompt: TOKEN_STRIPPED.prompt,
      runId: RUN_ID,
      tierModels: { cheap: "haiku", mid: "sonnet", powerful: "opus" },
      overrideEngaged: false,
      runFresh: true,
    });
    expect(r.decision).toBe("deny");
  });
  it("agent mode, strict OFF: a token-stripped lane passes (pre-#85 migration path)", () => {
    expect(resolveBackendDegradation(facts(TOKEN_STRIPPED, { agentMode: "agent" })).decision).toBe("pass");
  });
});

describe("#144 — block_unmarked_lanes catches a token-stripped lane", () => {
  for (const mode of ["agent", "subagent", "auto", "team"]) {
    it(`strict + agent_mode=${mode} + no substrate → DENY producer_marker_missing`, () => {
      const r = resolveBackendDegradation(
        facts(TOKEN_STRIPPED, { agentMode: mode, substrate: "none", blockUnmarked: true }),
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).toBe("producer_marker_missing");
    });
  }
  it("strict + no snapshot agent_mode at all → still DENY (strict is explicit)", () => {
    const r = resolveBackendDegradation(
      facts(TOKEN_STRIPPED, { agentMode: null, substrate: "none", blockUnmarked: true }),
    );
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("producer_marker_missing");
  });
  it("strict + override → allow_override, never silent", () => {
    const r = resolveBackendDegradation(
      facts(TOKEN_STRIPPED, { agentMode: "agent", blockUnmarked: true, overrideEngaged: true }),
    );
    expect(r.decision).toBe("allow_override");
    expect(r.reason).toBe("producer_marker_missing");
  });
  it("strict leaves a MARKED lane alone in agent mode", () => {
    expect(
      resolveBackendDegradation(facts(MARKED, { agentMode: "agent", blockUnmarked: true })).decision,
    ).toBe("pass");
  });
  it("strict does NOT deny prompt-only text outside the team rows (no new quoted-brief FP)", () => {
    expect(
      resolveBackendDegradation(facts(PROMPT_ONLY, { agentMode: "agent", blockUnmarked: true })).decision,
    ).toBe("pass");
  });
  it("a pane-local helper (not the lead) is never gated", () => {
    expect(
      resolveBackendDegradation(
        facts(TOKEN_STRIPPED, { agentMode: "agent", blockUnmarked: true, isLead: false }),
      ).decision,
    ).toBe("pass");
  });
  it("a stale run is never gated", () => {
    expect(
      resolveBackendDegradation(
        facts(TOKEN_STRIPPED, { agentMode: "agent", blockUnmarked: true, runFresh: false }),
      ).decision,
    ).toBe("pass");
  });
  it("the deny message names the missing env marker and the strict key", () => {
    const msg = buildDenyMessage("producer_marker_missing", "developer", "guild:developer", "none", "carrier_only");
    expect(msg).toContain(PRODUCER_MARKER_ENV);
    expect(msg).toContain("block_unmarked_lanes");
    expect(msg).toContain(BLOCK_UNMARKED_ENV);
  });
});

// ── #146 ─────────────────────────────────────────────────────────────────────

const DIRS: string[] = [];
afterAll(() => DIRS.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function mkRoot(effective: Record<string, unknown>, sidecar: "match" | "mismatch" | "none"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-h2-"));
  DIRS.push(dir);
  const runDir = path.join(dir, ".guild", "runs", RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const raw = JSON.stringify({ schema_version: "guild.resolved_settings.v1", effective }, null, 2) + "\n";
  fs.writeFileSync(path.join(runDir, "resolved-settings.json"), raw);
  if (sidecar !== "none") {
    const digest = sidecar === "match" ? resolvedSettingsDigest(raw) : `sha256:${"0".repeat(64)}`;
    fs.writeFileSync(path.join(runDir, "resolved-settings.sha256"), digest + "\n");
  }
  return dir;
}

describe("#146 — readRunSettingsSnapshot: one digest-verified parse", () => {
  it("verified: both fields come from the same read", () => {
    const s = readRunSettingsSnapshot(mkRoot({ agent_mode: "team", block_unmarked_lanes: true }, "match"), RUN_ID);
    expect(s).toEqual({ integrity: "verified", agentMode: "team", blockUnmarkedLanes: true });
  });
  it("legacy (no sidecar): values are read as before #146", () => {
    const s = readRunSettingsSnapshot(mkRoot({ agent_mode: "auto" }, "none"), RUN_ID);
    expect(s).toEqual({ integrity: "legacy", agentMode: "auto", blockUnmarkedLanes: null });
  });
  it("mismatch: the edited snapshot yields NO values", () => {
    const s = readRunSettingsSnapshot(mkRoot({ agent_mode: "agent", block_unmarked_lanes: false }, "mismatch"), RUN_ID);
    expect(s).toEqual({ integrity: "mismatch", agentMode: null, blockUnmarkedLanes: null });
  });
  it("absent: no snapshot file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guild-h2-"));
    DIRS.push(dir);
    expect(readRunSettingsSnapshot(dir, RUN_ID).integrity).toBe("absent");
  });
  // Codex r1: read errors must not downgrade a bound snapshot to "no proof".
  // A directory in place of a file gives a portable EISDIR read failure.
  const swapForDir = (root: string, name: string): void => {
    const p = path.join(root, ".guild", "runs", RUN_ID, name);
    fs.rmSync(p);
    fs.mkdirSync(p);
  };
  it("unreadable sidecar: mismatch, never legacy", () => {
    const root = mkRoot({ agent_mode: "agent" }, "match");
    swapForDir(root, "resolved-settings.sha256");
    expect(readRunSettingsSnapshot(root, RUN_ID).integrity).toBe("mismatch");
  });
  it("bound snapshot unreadable or deleted: mismatch, never absent", () => {
    const unreadable = mkRoot({ agent_mode: "team" }, "match");
    swapForDir(unreadable, "resolved-settings.json");
    expect(readRunSettingsSnapshot(unreadable, RUN_ID).integrity).toBe("mismatch");
    const deleted = mkRoot({ agent_mode: "team" }, "match");
    fs.rmSync(path.join(deleted, ".guild", "runs", RUN_ID, "resolved-settings.json"));
    expect(readRunSettingsSnapshot(deleted, RUN_ID).integrity).toBe("mismatch");
  });
  it("control: an unbound (legacy) unreadable snapshot keeps the fail-open posture", () => {
    const root = mkRoot({ agent_mode: "team" }, "none");
    swapForDir(root, "resolved-settings.json");
    expect(readRunSettingsSnapshot(root, RUN_ID).integrity).toBe("unreadable");
  });
  it("strict resolution reads the parsed snapshot; env still overrides both ways", () => {
    const snap = { integrity: "verified" as const, agentMode: "team", blockUnmarkedLanes: true };
    expect(resolveBlockUnmarkedFromSnapshot(snap, {})).toBe(true);
    expect(resolveBlockUnmarkedFromSnapshot(snap, { [BLOCK_UNMARKED_ENV]: "0" })).toBe(false);
    expect(resolveBlockUnmarkedFromSnapshot({ ...snap, blockUnmarkedLanes: null }, {})).toBe(false);
  });
});

describe("#146 — a mismatched snapshot fails CLOSED", () => {
  it("a lane with env evidence is DENIED with snapshot_integrity_failed (agent_mode unknown)", () => {
    for (const input of [MARKED, TOKEN_STRIPPED]) {
      const r = resolveBackendDegradation(
        facts(input, { agentMode: null, substrate: "none", snapshotTampered: true }),
      );
      expect(r.decision).toBe("deny");
      expect(r.reason).toBe("snapshot_integrity_failed");
    }
  });
  it("prompt-only text is recorded, not denied (quoted-brief FP stays closed)", () => {
    const r = resolveBackendDegradation(
      facts(PROMPT_ONLY, { agentMode: null, substrate: "none", snapshotTampered: true }),
    );
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("snapshot_integrity_failed");
  });
  it("the override opens the door consciously", () => {
    const r = resolveBackendDegradation(
      facts(MARKED, { agentMode: null, snapshotTampered: true, overrideEngaged: true }),
    );
    expect(r.decision).toBe("allow_override");
  });
  it("the deny message says the snapshot was edited after run start", () => {
    const msg = buildDenyMessage("snapshot_integrity_failed", "developer", "guild:developer", "none", "structured");
    expect(msg).toContain("resolved-settings.json");
    expect(msg).toContain("resolved-settings.sha256");
  });
});
