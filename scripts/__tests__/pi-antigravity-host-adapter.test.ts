import { spawnSync } from "node:child_process";
import * as path from "node:path";

import { createHostAdapter } from "../lib/host-adapter-factory";
import { PLUGIN_ROOT } from "../build-inventory";
import {
  REVIEW_PROGRESS_STATES,
  validateReviewProgressEvent,
} from "../lib/review-progress";
import { planReviewPairing, progressScenariosForPair } from "../lib/review-pairing";
import { piRequestsCodexReviewProgress, piReviewSkipProgress } from "../lib/host-adapters/pi-cli";
import { antigravityRequestsCodexReviewProgress, antigravityReviewSkipProgress } from "../lib/host-adapters/antigravity-cli";

describe("R9 Pi and Antigravity concrete host adapters", () => {
  it("factory returns concrete Pi and Antigravity adapters for canonical ids and aliases", () => {
    const pi = createHostAdapter("pi-cli");
    expect(pi.hostId).toBe("pi-cli");
    expect(createHostAdapter("pi").hostId).toBe("pi-cli");
    expect(pi.capabilities()).toMatchObject({
      host_id: "pi-cli",
      family: "pi",
      surface_kind: "cli",
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      provenance: "verified",
    });

    const agy = createHostAdapter("antigravity-cli");
    expect(agy.hostId).toBe("antigravity-cli");
    expect(createHostAdapter("antigravity").hostId).toBe("antigravity-cli");
    expect(createHostAdapter("antigravity-2").hostId).toBe("antigravity-cli");
    expect(agy.capabilities()).toMatchObject({
      host_id: "antigravity-cli",
      family: "antigravity",
      surface_kind: "cli",
      installability: "target",
      result_adapter: false,
      dispatch_selectable: true,
      provenance: "verified",
    });
  });

  it("Pi exposes bootstrap, package, command, permission, memory, dispatch, and model-param receipts", () => {
    const adapter = createHostAdapter("pi-cli");
    expect(adapter.bootstrap({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "ok",
      value: { instruction_file: "AGENTS.md", package_manifest: "pi-manifest.json", install_command: "pi install ./dist/pi" },
    });
    expect(adapter.preflight({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "degraded",
      value: { binary_probe: "pi --version", native_hooks: false, fallback: { mcp: "filesystem-bm25" } },
    });
    expect(adapter.renderCommandSurface({ commandIds: ["guild"] })).toMatchObject({
      status: "ok",
      value: { manifest_path: "pi-manifest.json", invoke: "pi -p" },
    });
    expect(adapter.renderPackage({ packageRoot: PLUGIN_ROOT })).toMatchObject({
      status: "degraded",
      value: { manifest_path: "pi-manifest.json", skill_root: ".agents/skills/guild", installability: "target" },
    });
    expect(adapter.renderPermissionDecision({ decision: { host_mode: "ask" } })).toMatchObject({
      status: "degraded",
      value: { allow_flag: "--tools", deny_flag: "--exclude-tools", native_prompt_layer: false },
    });
    expect(adapter.dispatch({ taskRun: { prompt: "Do work", runId: "run-1" } })).toMatchObject({
      status: "ok",
      value: { command: "pi", args: ["-p", "Do work"] },
    });
    expect(adapter.memory({ mode: "query", payload: { cwd: PLUGIN_ROOT, query: "guild memory" } })).toMatchObject({
      status: "degraded",
      value: { primary: { transport: "bridge-package", status: "target" } },
    });
    expect(adapter.resolveModelParams({
      tier: "powerful",
      params: { provider: "anthropic", model: "opus-4.8", effort: "xhigh" },
    })).toMatchObject({
      status: "ok",
      value: {
        modelParams: { provider: "anthropic", model: "opus-4.8", effort: "xhigh" },
        argv: ["--provider", "anthropic", "--model", "opus-4.8", "--thinking", "xhigh"],
        unsupported_model_params: [],
      },
    });
  });

  it("Antigravity exposes bootstrap, package, command, permission, memory, dispatch, and model-param receipts", () => {
    const adapter = createHostAdapter("antigravity-cli");
    expect(adapter.bootstrap({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "ok",
      value: {
        instruction_file: "AGENTS.md",
        package_manifest: "plugin.json",
        compatibility_manifest: "antigravity-manifest.json",
        validate_command: "agy plugin validate ./dist/antigravity",
      },
    });
    expect(adapter.preflight({ cwd: "/repo", runId: "run-1" })).toMatchObject({
      status: "degraded",
      value: { binary_probe: "agy --version", native_hooks: false, fallback: { mcp: "filesystem-bm25" } },
    });
    expect(adapter.renderCommandSurface({ commandIds: ["guild"] })).toMatchObject({
      status: "ok",
      value: { manifest_path: "plugin.json", compatibility_manifest_path: "antigravity-manifest.json", invoke: "agy -p" },
    });
    expect(adapter.renderPackage({ packageRoot: PLUGIN_ROOT })).toMatchObject({
      status: "degraded",
      value: { manifest_path: "plugin.json", compatibility_manifest_path: "antigravity-manifest.json", skill_root: ".agents/skills/guild", installability: "target" },
    });
    expect(adapter.renderPermissionDecision({ decision: { bypass: "audit" } })).toMatchObject({
      status: "degraded",
      value: { sandbox_flag: "--sandbox", bypass_flag: "--dangerously-skip-permissions" },
    });
    expect(adapter.dispatch({ taskRun: { prompt: "Do work", runId: "run-1" } })).toMatchObject({
      status: "ok",
      value: { command: "agy", args: ["-p", "Do work"] },
    });
    expect(adapter.memory({ mode: "query", payload: { cwd: PLUGIN_ROOT, query: "guild memory" } })).toMatchObject({
      status: "degraded",
      value: { primary: { transport: "bridge-package", status: "target" } },
    });
    expect(adapter.resolveModelParams({
      tier: "powerful",
      params: { model: "gemini-3-pro", effort: "low" },
    })).toMatchObject({
      status: "degraded",
      value: {
        modelParams: { model: "gemini-3-pro", effort: "low" },
        argv: ["--model", "gemini-3-pro"],
        unsupported_model_params: ["effort"],
      },
    });
  });

  it("records Pi and Antigravity as non-reviewers with policy skip receipts while result_adapter is false", () => {
    for (const event of [piReviewSkipProgress("run-r9"), antigravityReviewSkipProgress("run-r9")]) {
      expect(event.schema_version).toBe("guild.review_progress.v1");
      expect(event.state).toBe("skipped");
      expect(event.independence).toBe("weak");
      expect(event.policy_reason).toMatch(/no result_adapter/);
      expect(validateReviewProgressEvent(event).valid).toBe(true);
    }
  });

  it("Pi and Antigravity requester flows select Codex as a cross-family reviewer and emit success progress", () => {
    for (const plan of [piRequestsCodexReviewProgress("run-r9"), antigravityRequestsCodexReviewProgress("run-r9")]) {
      expect(plan).toMatchObject({
        status: "selected",
        reviewer_host: "codex-cli",
        independence: "strong",
      });
      expect(plan.progress.map((e) => e.state)).toEqual(["launched", "running", "heartbeat", "activity", "succeeded"]);
      for (const event of plan.progress) expect(validateReviewProgressEvent(event).valid).toBe(true);
    }
  });

  it("review-progress scenarios cover every canonical state through non-tautological lifecycle branches", () => {
    for (const authorHost of ["pi-cli", "antigravity-cli"]) {
      const scenarios = progressScenariosForPair({
        runId: "run-r9",
        gate: `G-implementation:${authorHost}`,
        roundNumber: 1,
        authorHost,
        reviewerHost: "codex-cli",
        independence: "strong",
        artifactPath: `.guild/runs/run-r9/review/G-implementation:${authorHost}/artifact.md`,
        packetPath: `.guild/runs/run-r9/review/G-implementation:${authorHost}/packet-1.md`,
        timestamp: "2026-06-18T00:00:00Z",
      });
      expect(Object.keys(scenarios).sort()).toEqual(["cancelled", "no_output", "reviewer_error", "skipped", "succeeded", "tool_error"]);
      const stateUnion = new Set(Object.values(scenarios).flat().map((e) => e.state));
      expect([...stateUnion].sort()).toEqual([...REVIEW_PROGRESS_STATES].sort());
      for (const events of Object.values(scenarios)) {
        for (const event of events) expect(validateReviewProgressEvent(event).valid).toBe(true);
      }
    }
  });

  it("review pairing blocks instead of silently skipping when policy forbids skip", () => {
    const plan = planReviewPairing({
      runId: "run-r9",
      gate: "G-implementation:pi-cli",
      roundNumber: 1,
      authorHost: "pi-cli",
      reviewerHost: "codex-cli",
      independence: "strong",
      artifactPath: ".guild/runs/run-r9/review/G-implementation:pi-cli/artifact.md",
      packetPath: ".guild/runs/run-r9/review/G-implementation:pi-cli/packet-1.md",
      timestamp: "2026-06-18T00:00:00Z",
      policyAllowsSkip: false,
      reviewerAvailable: false,
    });
    expect(plan).toMatchObject({
      status: "blocked",
      independence: "weak",
    });
    expect(plan.reason).toMatch(/policy forbids skip/);
    expect(plan.progress).toHaveLength(1);
    expect(plan.progress[0]).toMatchObject({
      state: "tool_error",
      error_code: "reviewer_unavailable",
    });
    expect(validateReviewProgressEvent(plan.progress[0]).valid).toBe(true);
  });
});

describe("R9 install.sh Pi/Antigravity dry-runs", () => {
  it("accepts --host pi-cli and prints Pi package bootstrap commands", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "pi-cli"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>");
    expect(res.stdout).toContain("would run: pi install ./dist/pi");
    expect(res.stdout).toContain("pi-manifest.json");
    expect(res.stdout).toContain("guild-run --host pi");
  });

  it("accepts --host antigravity-cli and prints Antigravity package bootstrap commands", () => {
    const script = path.resolve(PLUGIN_ROOT, "install.sh");
    const res = spawnSync("bash", [script, "--dry-run", "--host", "antigravity-cli"], {
      encoding: "utf8",
      cwd: PLUGIN_ROOT,
      env: { ...process.env, PATH: "/usr/bin:/bin" },
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("would run: npx tsx scripts/build-host-packages.ts --root . --out dist --generated-at <generated-at>");
    expect(res.stdout).toContain("would run: agy plugin validate ./dist/antigravity");
    expect(res.stdout).toContain("would run: agy plugin install ./dist/antigravity");
    expect(res.stdout).toContain("plugin.json");
    expect(res.stdout).toContain("antigravity-manifest.json");
    expect(res.stdout).toContain("guild-run --host antigravity");
  });
});
