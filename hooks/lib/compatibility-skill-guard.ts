/**
 * PCL-09 native Skill-tool boundary.
 *
 * Claude's host-native Skill tool is the production load path for the 58
 * shipped specialist domain skills. Before such a load is allowed, verify the
 * exact catalog-pinned bytes and make its MH-06 compatibility receipt durable.
 * Universal/meta skills are outside the compatibility catalog and fall through.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildCompatibilityCatalog,
  SHIPPED_DOMAIN_SKILL_IDS,
} from "../../scripts/lib/capability/compatibility-catalog";
import { readCompatibilityAsset } from "../../scripts/lib/capability/compatibility-loader";
import { resolveSettings } from "../../scripts/lib/settings-resolver";
import type { CapabilityResolverMode } from "../../src/modules/config";
import { readHookBindingEnvelope } from "../../src/modules/lifecycle/workflows/run-binding";
import type { GuildHookEvent } from "./guild-hook-event";

export type CompatibilitySkillGuardResult =
  | { status: "not-applicable" }
  | { status: "allowed"; receipt_sequence: number }
  | { status: "denied"; reason: string };

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_ID = 128;

function boundedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 0 && value.length <= MAX_ID && SAFE_ID.test(value)
    ? value
    : null;
}

function invokedGuildSkill(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)["skill"];
  if (typeof raw !== "string") return null;
  if (!raw.startsWith("guild:")) return null;
  return boundedId(raw.slice("guild:".length));
}

const SHIPPED_DOMAIN_SKILL_ID_SET: ReadonlySet<string> = new Set(SHIPPED_DOMAIN_SKILL_IDS);

function pluginRootFrom(env: NodeJS.ProcessEnv): string | null {
  const candidates = [
    env["GUILD_PLUGIN_ROOT"],
    env["CLAUDE_PLUGIN_ROOT"],
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "../.."),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    try {
      const real = fs.realpathSync(candidate);
      if (
        fs.statSync(real).isDirectory() &&
        fs.statSync(path.join(real, "skills", "specialists")).isDirectory()
      ) {
        return real;
      }
    } catch {
      // Try the next explicit/fallback root.
    }
  }
  return null;
}

function resolverMode(projectRoot: string): CapabilityResolverMode {
  try {
    return resolveSettings({ cwd: projectRoot }).config.capability.resolver_mode;
  } catch {
    // Shared default. A settings read failure must not restore an unmeasured
    // direct compatibility load.
    return "observe";
  }
}

function stableInvocationId(payload: GuildHookEvent): string | null {
  const sessionId = boundedId(payload.session_id);
  const toolUseId = boundedId(
    payload["tool_use_id"] ?? payload["toolUseId"] ?? payload["call_id"] ?? payload["callId"],
  );
  if (sessionId === null || toolUseId === null) return null;
  return createHash("sha256")
    .update(`${sessionId}\0${toolUseId}`)
    .digest("hex")
    .slice(0, 24);
}

export function evaluateCompatibilitySkillUse(options: {
  payload: GuildHookEvent;
  projectRoot: string;
  runId: string | null;
  env?: NodeJS.ProcessEnv;
}): CompatibilitySkillGuardResult {
  if (options.payload.tool_name !== "Skill") return { status: "not-applicable" };
  const skillId = invokedGuildSkill(options.payload.tool_input);
  if (skillId === null) return { status: "not-applicable" };
  const isFrozenDomainSkill = SHIPPED_DOMAIN_SKILL_ID_SET.has(skillId);

  const env = options.env ?? process.env;
  const pluginRoot = pluginRootFrom(env);
  if (pluginRoot === null) {
    return isFrozenDomainSkill
      ? { status: "denied", reason: `PCL-09: cannot resolve the Guild plugin root for skill ${skillId}` }
      : { status: "not-applicable" };
  }

  // A valid-but-unexpected directory is still part of the live specialist
  // surface and must not bypass catalog validation merely because its identity
  // is absent from the frozen set. Genuine universal/meta skills live elsewhere
  // and continue to fall through untouched.
  const hasLiveSpecialistPath = fs.existsSync(
    path.join(pluginRoot, "skills", "specialists", skillId, "SKILL.md"),
  );
  if (!isFrozenDomainSkill && !hasLiveSpecialistPath) return { status: "not-applicable" };

  const catalog = buildCompatibilityCatalog({
    pluginRoot,
    deprecation: "deprecated",
    deprecatedBy: "cap-loc-D03",
  });
  if (!catalog.census_matches || catalog.problems.length > 0) {
    return {
      status: "denied",
      reason:
        `PCL-09: shipped domain skill ${skillId} cannot use an incomplete compatibility catalog ` +
        `(${catalog.domain_skill_count}/${SHIPPED_DOMAIN_SKILL_IDS.length} domain skills; ` +
        `${catalog.problems.length} catalog problem(s))`,
    };
  }
  const entry = catalog.entries.find(
    (candidate) => candidate.kind === "shipped_domain_skill" && candidate.id === skillId,
  );
  if (entry === undefined) {
    return { status: "denied", reason: `PCL-09: shipped domain skill ${skillId} is absent from the valid compatibility catalog` };
  }

  if (options.runId === null) {
    return {
      status: "denied",
      reason: `PCL-09: shipped domain skill ${skillId} has no valid run identity for its receipt`,
    };
  }
  const binding = readHookBindingEnvelope(env);
  if (binding === null || binding.run_id !== options.runId) {
    return {
      status: "denied",
      reason: `PCL-09: shipped domain skill ${skillId} has no matching open run binding for its receipt`,
    };
  }

  const mode = resolverMode(options.projectRoot);
  if (mode === "project-local" || mode === "strict") {
    return {
      status: "denied",
      reason: `PCL-09: shipped domain skill ${skillId} is unavailable in resolver mode ${mode}`,
    };
  }

  const invocationId = stableInvocationId(options.payload);
  if (invocationId === null) {
    return {
      status: "denied",
      reason: `PCL-09: shipped domain skill ${skillId} has no stable tool-use identity`,
    };
  }

  const specialistId = boundedId(env["GUILD_SPECIALIST"]);
  const loaded = readCompatibilityAsset({
    pluginRoot,
    projectRoot: options.projectRoot,
    entry,
    mode,
    intent: "dispatch",
    synthetic: false,
    specialistId,
    runId: options.runId,
    bindingRef: binding.binding_ref,
    operationId: `native-skill-${skillId}-${invocationId}`,
  });
  if (loaded.status !== "loaded") {
    return {
      status: "denied",
      reason: `PCL-09: shipped domain skill ${skillId} compatibility read refused — ${loaded.detail}`,
    };
  }
  return { status: "allowed", receipt_sequence: loaded.receipt_sequence };
}
