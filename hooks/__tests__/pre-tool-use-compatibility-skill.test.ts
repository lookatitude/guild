/**
 * PCL-09 — native Skill-tool compatibility instrumentation on the real
 * PreToolUse path. A shipped domain skill must not be allowed to execute until
 * its catalog-pinned bytes and durable MH-06 receipt have been established.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildCompatibilityCatalog,
  SHIPPED_DOMAIN_SKILL_IDS,
} from "../../scripts/lib/capability/compatibility-catalog";
import { scanReceiptJournal } from "../../src/modules/telemetry";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const DIST_SCRIPT = path.resolve(__dirname, "../dist/pre-tool-use.js");
const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const RUN_ID = "run-pcl09-native-skill";

let projectRoot: string;

function writeMode(mode: "legacy" | "observe" | "shadow" | "project-local" | "strict"): void {
  fs.writeFileSync(
    path.join(projectRoot, ".guild", "settings.json"),
    `${JSON.stringify({ capability: { resolver_mode: mode } }, null, 2)}\n`,
    "utf8",
  );
}

function runHook(
  skill: string,
  options: {
    mode?: "legacy" | "observe" | "shadow" | "project-local" | "strict";
    toolUseId?: string;
    runId?: string;
    dist?: boolean;
    capabilityScope?: string;
    pluginRoot?: string;
    toolInput?: Record<string, unknown>;
  } = {},
): { exitCode: number; stdout: string; stderr: string } {
  writeMode(options.mode ?? "observe");
  const payload: Record<string, unknown> = {
    hook_event_name: "PreToolUse",
    cwd: projectRoot,
    session_id: "session-pcl09",
    tool_name: "Skill",
    tool_input: options.toolInput ?? { skill },
  };
  if (options.toolUseId !== undefined) payload.tool_use_id = options.toolUseId;
  const result = spawnSync(options.dist ? "node" : "npx", options.dist ? [DIST_SCRIPT] : ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      GUILD_CWD: projectRoot,
      GUILD_RUN_ID: options.runId ?? RUN_ID,
      GUILD_PLUGIN_ROOT: options.pluginRoot ?? PLUGIN_ROOT,
      CLAUDE_PLUGIN_ROOT: options.pluginRoot ?? PLUGIN_ROOT,
      CMUX_WORKSPACE_ID: "",
      TMUX: "",
      GUILD_ALLOW_UNTIERED_DISPATCH: "",
      GUILD_LANE_ID: "",
      GUILD_TASK_ID: "",
      GUILD_SPECIALIST: "backend",
      GUILD_CAPABILITY_SCOPE: options.capabilityScope ?? "",
    },
    timeout: 30000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function receipts(): ReturnType<typeof scanReceiptJournal> {
  return scanReceiptJournal(
    path.join(projectRoot, ".guild", "runs", RUN_ID, "receipts", "journal.jsonl"),
  );
}

describe("pre-tool-use.ts — PCL-09 native domain-skill reads", () => {
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pcl09-native-skill-"));
    fs.mkdirSync(path.join(projectRoot, ".git"), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, ".guild", "runs", RUN_ID), { recursive: true });
  });

  afterEach(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  it.each(["legacy", "observe", "shadow"] as const)(
    "allows a %s-mode shipped domain skill only after a durable non-synthetic receipt",
    (mode) => {
    const result = runHook("guild:backend-api-contract", { mode, toolUseId: "toolu_01ABC" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");

    const scan = receipts();
    expect(scan.integrity).toBe("intact");
    expect(scan.records).toHaveLength(1);
    const invocationHash = createHash("sha256")
      .update("session-pcl09\0toolu_01ABC")
      .digest("hex")
      .slice(0, 24);
    expect(scan.records[0]).toMatchObject({
      scenario_id: "PCL-09",
      operation_id: `compatibility-read:native-skill-backend-api-contract-${invocationHash}`,
      disposition: "degraded",
      observation_state: "checked_clean",
    });

    const payloadDir = path.join(projectRoot, ".guild", "runs", RUN_ID, "receipts", "payloads");
    const names = fs.readdirSync(payloadDir);
    expect(names).toHaveLength(1);
    const payload = JSON.parse(fs.readFileSync(path.join(payloadDir, names[0]), "utf8"));
    expect(payload).toMatchObject({
      asset_kind: "shipped_domain_skill",
      asset_id: "backend-api-contract",
      synthetic: false,
      resolver_mode: mode,
      reason: "explicit_legacy_mode",
      specialist_id: "backend",
    });
    },
  );

  it.each(["project-local", "strict"] as const)(
    "denies a shipped domain skill in %s mode without writing a compatibility receipt",
    (mode) => {
      const result = runHook("guild:backend-api-contract", {
        mode,
        toolUseId: `toolu_${mode}`,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
      expect(result.stdout).toContain("PCL-09");
      expect(receipts().integrity).toBe("absent");
    },
  );

  it("does not instrument a universal/meta Guild skill", () => {
    const result = runHook("guild:review", { toolUseId: "toolu_review" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(receipts().integrity).toBe("absent");
  });

  it.each([
    [{ name: "guild:backend-api-contract" }],
    [{ command: "guild:backend-api-contract" }],
    [{ skill: " guild:backend-api-contract" }],
    [{ skill: "guild:backend-api-contract " }],
  ])("ignores noncanonical native Skill input %j", (toolInput) => {
    const result = runHook("guild:backend-api-contract", {
      toolUseId: "toolu_noncanonical",
      toolInput,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(receipts().integrity).toBe("absent");
  });

  it("fails closed for a frozen shipped ID when the selected plugin root has an incomplete catalog", () => {
    const incompleteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pcl09-incomplete-plugin-"));
    fs.mkdirSync(path.join(incompleteRoot, "skills", "specialists"), { recursive: true });
    try {
      const result = runHook("guild:backend-api-contract", {
        toolUseId: "toolu_incomplete_catalog",
        pluginRoot: incompleteRoot,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
      expect(result.stdout).toContain("incomplete compatibility catalog");
      expect(receipts().integrity).toBe("absent");

    } finally {
      fs.rmSync(incompleteRoot, { recursive: true, force: true });
    }
  });

  it("fails closed when one frozen ID is replaced by an unexpected skill without changing the count", () => {
    const substitutedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guild-pcl09-substituted-plugin-"));
    fs.cpSync(path.join(PLUGIN_ROOT, "templates"), path.join(substitutedRoot, "templates"), {
      recursive: true,
    });
    fs.cpSync(
      path.join(PLUGIN_ROOT, "skills", "specialists"),
      path.join(substitutedRoot, "skills", "specialists"),
      { recursive: true },
    );
    fs.renameSync(
      path.join(substitutedRoot, "skills", "specialists", "technical-writer-user-manual"),
      path.join(substitutedRoot, "skills", "specialists", "zz-count-preserving-substitute"),
    );
    try {
      const result = runHook("guild:backend-api-contract", {
        toolUseId: "toolu_substituted_catalog",
        pluginRoot: substitutedRoot,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
      expect(result.stdout).toContain("incomplete compatibility catalog");
      expect(receipts().integrity).toBe("absent");

      const unexpected = runHook("guild:zz-count-preserving-substitute", {
        runId: "",
        toolUseId: "toolu_unexpected_catalog_entry",
        pluginRoot: substitutedRoot,
        capabilityScope: '["Read"]',
      });
      expect(unexpected.exitCode).toBe(0);
      expect(JSON.parse(unexpected.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
      expect(unexpected.stdout).toContain("PCL-09");
      expect(unexpected.stdout).toContain("incomplete compatibility catalog");
    } finally {
      fs.rmSync(substitutedRoot, { recursive: true, force: true });
    }
  });

  it("freezes the exact 58-ID shipped domain census used by the native guard", () => {
    const catalog = buildCompatibilityCatalog({
      pluginRoot: PLUGIN_ROOT,
      deprecation: "deprecated",
      deprecatedBy: "cap-loc-D03",
    });
    const liveIds = catalog.entries
      .filter((entry) => entry.kind === "shipped_domain_skill")
      .map((entry) => entry.id);
    expect(catalog.census_matches).toBe(true);
    expect(catalog.problems).toEqual([]);
    expect(SHIPPED_DOMAIN_SKILL_IDS).toHaveLength(58);
    expect(liveIds).toEqual([...SHIPPED_DOMAIN_SKILL_IDS]);
  });

  it("fails closed when a shipped domain-skill invocation has no stable tool-use identity", () => {
    const result = runHook("guild:backend-api-contract");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(result.stdout).toContain("stable tool-use identity");
    expect(receipts().integrity).toBe("absent");
  });

  it.each([
    ["missing", ""],
    ["malformed", "../run-escape"],
  ])("fails closed when a shipped domain skill has a %s run identity", (_label, runId) => {
    const result = runHook("guild:backend-api-contract", {
      runId,
      toolUseId: `toolu_${_label}`,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(result.stdout).toContain("valid run identity");
    expect(receipts().integrity).toBe("absent");
  });

  it("cannot downgrade a missing-run compatibility denial into an approvable scope ask", () => {
    const result = runHook("guild:backend-api-contract", {
      runId: "",
      toolUseId: "toolu_scope_bypass",
      capabilityScope: '["Read"]',
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(result.stdout).toContain("PCL-09");
    expect(result.stdout).toContain("valid run identity");
    expect(receipts().integrity).toBe("absent");
  });

  it("ships the same missing-run hard denial ahead of a scope ask in the compiled hook", () => {
    const result = runHook("guild:backend-api-contract", {
      runId: "",
      toolUseId: "toolu_scope_bypass_dist",
      capabilityScope: '["Read"]',
      dist: true,
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    });
    expect(result.stdout).toContain("PCL-09");
    expect(result.stdout).toContain("valid run identity");
  });

  it("ships the same instrumentation in the compiled hook bundle", () => {
    const result = runHook("guild:backend-api-contract", {
      toolUseId: "toolu_dist",
      dist: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(receipts().records).toHaveLength(1);
  });
});
