/**
 * tests/universal-host/sc5-wrapper-path-parity.test.ts
 *
 * SC-5 — WRAPPER-PATH PARITY. A Guild result produced THROUGH the guild-run
 * wrapper must be equivalent to the same result produced on the host's NATIVE
 * path. The wrapper adds bootstrap/skill injection and result normalization; it
 * must not change the meaning of a result. On Claude (native dispatch + native
 * skills) the wrapper path and the native path must agree byte-for-byte after
 * normalization; on Codex the wrapper IS the path (no native agent-team/skills).
 *
 * REAL PATH: the green-now invariant is that the result contract is PATH-
 * INDEPENDENT — the same envelope validated/normalized via the L0 registry yields
 * the same verdict regardless of which path produced it. The live wrapper-vs-
 * native run goes live when scripts/guild-run.ts (L3) lands (guarded below).
 *
 * Status at authoring:
 *   GREEN now — path-independence of the result/normalization layer + capability
 *   rows that define the native vs wrapper paths.
 *   RED until L3 — the real guild-run wrapper-vs-native parity run.
 */

import {
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
  validateHostCapabilitiesV1,
} from "../../scripts/lib/host-capabilities-schema";
import { CONTRACT_VALIDATORS } from "../../scripts/lib/result-contracts";
import { normalizeJson } from "../../scripts/lib/equivalence-contract";
import { normalizeResult } from "../../scripts/lib/result-normalizer";
import {
  planWrapperInvocation,
  renderLauncherScript,
} from "../../scripts/lib/guild-run-wrapper";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const GUILD_RUN = path.join(PLUGIN_ROOT, "scripts", "guild-run.ts");

/** Invoke the REAL guild-run.ts CLI in --dry-run mode and return the parsed plan. */
function dryRunPlan(host: string, bootstrapFile: string): Record<string, unknown> {
  const res = spawnSync(
    "npx",
    [
      "tsx", GUILD_RUN,
      "--host", host,
      "--mode", "ask",
      "--prompt", "do the thing",
      "--contract", "guild.handoff.v2",
      "--bootstrap-file", bootstrapFile,
      "--dry-run",
    ],
    { cwd: PLUGIN_ROOT, encoding: "utf8" }
  );
  if (res.status !== 0) {
    throw new Error(`guild-run --dry-run (${host}) failed: ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout) as Record<string, unknown>;
}

const VALID_HANDOFF = {
  schema_version: "guild.handoff.v2",
  task_id: "eval-engineer-L6",
  tier: "mid",
  status: "done",
  summary: "Lane result — identical regardless of producing path.",
  artifacts: [],
  issues: [],
};

describe("SC-5 capability rows define the native vs wrapper dispatch paths", () => {
  it("both rows validate", () => {
    expect(validateHostCapabilitiesV1(CLAUDE_CAPABILITIES).valid).toBe(true);
    expect(validateHostCapabilitiesV1(CODEX_CAPABILITIES).valid).toBe(true);
  });

  it("Claude has a NATIVE path (native skills + independent agents) — the parity baseline", () => {
    expect(CLAUDE_CAPABILITIES.skills.native_skills).toBe(true);
    expect(CLAUDE_CAPABILITIES.dispatch.independent_agents).toBe(true);
  });

  it("Codex has NO native skill/agent path — the guild-run wrapper IS its path", () => {
    expect(CODEX_CAPABILITIES.skills.native_skills).toBe(false);
    expect(CODEX_CAPABILITIES.bootstrap.wrapper_injection).toBe(true);
  });
});

describe("SC-5 result contract is PATH-INDEPENDENT (the parity invariant)", () => {
  it("an identical envelope validates the same whether produced natively or via the wrapper", () => {
    const validate = CONTRACT_VALIDATORS["guild.handoff.v2"]!;
    // The wrapper may re-serialize (reorder keys, restamp provenance) — parity
    // requires that this round-trip does not change the verdict. Model the wrapper
    // round-trip as a key-reordered + provenance-stamped re-serialization.
    const nativeResult = validate(VALID_HANDOFF);
    const wrapperRoundTrip = {
      issues: [],
      artifacts: [],
      summary: VALID_HANDOFF.summary,
      status: "done",
      tier: "mid",
      task_id: "eval-engineer-L6",
      schema_version: "guild.handoff.v2",
    };
    const wrapperResult = validate(wrapperRoundTrip);
    expect(nativeResult.valid).toBe(true);
    expect(wrapperResult.valid).toBe(true);
    expect(wrapperResult.valid).toBe(nativeResult.valid);
  });

  it("normalization makes key-order / provenance differences from the wrapper non-failures", () => {
    const native = { ...VALID_HANDOFF };
    const viaWrapper = { ...VALID_HANDOFF, _rendered_at: "2026-06-14T00:00:00Z", _source_version: "2.0.0" };
    // After normalization the wrapper's added provenance is stripped → equal.
    expect(JSON.stringify(normalizeJson(viaWrapper))).toBe(JSON.stringify(normalizeJson(native)));
  });
});

// ── L3 wrapper-path parity — REAL path (guild-run-wrapper.ts landed) ─────────
// The wrapper normalizes a result the same way regardless of which host path
// produced it; and the per-host launch plan differs only in HOW bootstrap is
// injected, not in WHAT result is captured.

const FENCE = (wire: string, obj: unknown): string =>
  "```" + wire + "\n" + JSON.stringify(obj, null, 2) + "\n```";

describe("SC-5 wrapper normalizes a result identically to the native path (real path)", () => {
  it("the SAME logical handoff result, emitted natively vs wrapper-wrapped, normalizes equal", () => {
    // Native path: the host emits a clean fenced block, keys in one order.
    const nativeRaw = FENCE("guild.handoff.v2", {
      schema_version: "guild.handoff.v2",
      task_id: "eval-engineer-L6",
      tier: "mid",
      status: "done",
      summary: "result",
      artifacts: [],
      issues: [],
    });
    // Wrapper path: surrounding narration + a different key order (what a real CLI
    // capture looks like). Parity requires the normalized value to be identical.
    const wrapperRaw =
      "Starting run…\n\n" +
      FENCE("guild.handoff.v2", {
        issues: [],
        artifacts: [],
        summary: "result",
        status: "done",
        tier: "mid",
        task_id: "eval-engineer-L6",
        schema_version: "guild.handoff.v2",
      }) +
      "\n\nRun complete.\n";

    const native = normalizeResult(nativeRaw, "guild.handoff.v2");
    const wrapped = normalizeResult(wrapperRaw, "guild.handoff.v2");
    expect(native.ok).toBe(true);
    expect(wrapped.ok).toBe(true);
    // The parity invariant: canonical (key-sorted, provenance-stripped) values equal.
    expect(JSON.stringify(normalizeJson(wrapped.value))).toBe(JSON.stringify(normalizeJson(native.value)));
  });
});

describe("SC-5 per-host launch plan — same captured result, host-specific path", () => {
  const baseReq = {
    mode: "ask" as const,
    cwd: "/repo",
    bootstrap: "USING-GUILD bootstrap context",
    prompt: "do the thing",
    structuredOutput: { wire_schema_version: "guild.handoff.v2" },
  };

  it("Claude injects bootstrap via the system prompt (native), writes NO instruction file", () => {
    const plan = planWrapperInvocation({ host: "claude", ...baseReq });
    expect(plan.command).toBe("claude");
    expect(plan.bootstrap.via).toBe("system_prompt_arg");
    expect(plan.bootstrap.files).toEqual([]);
    expect(plan.capture.stdout).toBe(true);
    expect(plan.capture.exit).toBe(true);
  });

  it("Codex injects bootstrap via an AGENTS.md instruction file (no native skills)", () => {
    const plan = planWrapperInvocation({ host: "codex", ...baseReq });
    expect(plan.command).toBe("codex");
    expect(plan.bootstrap.via).toBe("instruction_file");
    expect(plan.bootstrap.files.map((f) => f.path)).toContain("AGENTS.md");
    // Result capture is IDENTICAL across hosts — the parity guarantee at the seam.
    expect(plan.capture).toEqual(planWrapperInvocation({ host: "claude", ...baseReq }).capture);
  });

  it("the structured-output instruction (the fenced-result contract) is host-independent", () => {
    const claude = planWrapperInvocation({ host: "claude", ...baseReq });
    const codex = planWrapperInvocation({ host: "codex", ...baseReq });
    expect(claude.structured_output_instruction).toBe(codex.structured_output_instruction);
    expect(claude.structured_output_instruction).toContain("guild.handoff.v2");
  });

  it("both hosts render a launcher script (the per-host wrapper-path artifact)", () => {
    expect(renderLauncherScript("claude")).toContain("claude");
    expect(renderLauncherScript("codex")).toContain("codex");
  });
});

describe("SC-5 the REAL guild-run.ts CLI wires the wrapper path (--dry-run, real entrypoint)", () => {
  let bootstrapFile: string;
  beforeAll(() => {
    bootstrapFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "guild-l6-")), "bootstrap.txt");
    fs.writeFileSync(bootstrapFile, "USING-GUILD bootstrap context");
  });
  afterAll(() => {
    try {
      fs.rmSync(path.dirname(bootstrapFile), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("claude: the CLI emits a plan injecting bootstrap via the system prompt + structured-output contract", () => {
    const plan = dryRunPlan("claude", bootstrapFile);
    expect(plan["command"]).toBe("claude");
    expect((plan["bootstrap"] as Record<string, unknown>)["via"]).toBe("system_prompt_arg");
    expect(plan["args"] as string[]).toContain("--append-system-prompt");
    expect(plan["structured_output_instruction"]).toContain("guild.handoff.v2");
    expect(plan["capture"]).toMatchObject({ stdout: true, exit: true });
  });

  it("codex: the CLI emits a plan injecting bootstrap via an AGENTS.md instruction file", () => {
    const plan = dryRunPlan("codex", bootstrapFile);
    expect(plan["command"]).toBe("codex");
    const bootstrap = plan["bootstrap"] as { via: string; files: Array<{ path: string }> };
    expect(bootstrap.via).toBe("instruction_file");
    expect(bootstrap.files.map((f) => f.path)).toContain("AGENTS.md");
  });

  it("PARITY: the result-capture contract emitted by the CLI is IDENTICAL across hosts", () => {
    const claude = dryRunPlan("claude", bootstrapFile);
    const codex = dryRunPlan("codex", bootstrapFile);
    // The wrapper captures the same result surface regardless of host path — the
    // seam-level guarantee behind wrapper-path parity.
    expect(codex["capture"]).toEqual(claude["capture"]);
    expect(codex["structured_output_instruction"]).toEqual(claude["structured_output_instruction"]);
  });
});
