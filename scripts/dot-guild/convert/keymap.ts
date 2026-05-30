/**
 * scripts/dot-guild/convert/keymap.ts — §2.1 key transforms + the §2.0a per-key
 * 4-case (C1/C2/C3/C4) classifier.
 *
 * Transform semantics match read-guild-config.ts migrateLegacyConfig() exactly
 * (codex_review→review, string auto_approve→array, defaults.agent_team→agent_mode)
 * so the converter MATERIALIZES on disk what the shim computes in memory.
 *
 * The §2.0a contract (the ONE source of truth):
 *   C1 fully-mapped, no conflict   → write v2 form, drop v1 key
 *   C2 unmapped, no conflict       → relocate verbatim to .unmigrated-v1.json
 *   C3 equal to existing v2 value  → drop redundant v1 key
 *   C4 DIFFERING vs existing v2    → preserve+flag, keep LIVE, never auto-pick
 */

import type { KeyCase, KeyOutcome, UnmigratedEntry } from "./types";

/** The v2 stamp on the relocation artifact. MUST match SCHEMA_STAMP_RE (CF-W1d-11b). */
export const UNMIGRATED_STAMP = "guild.unmigrated.v1";

/** A single v1 key → its v2 destination (top-level settings key + value). */
export interface MappedKey {
  /** dotted v1 key as it appears in the source (e.g. "codex_review", "defaults.agent_team"). */
  v1Key: string;
  /** v2 key path in settings.json (e.g. "review", "agent_mode", "auto_approve"). */
  v2Key: string;
  /** transformed v2 value. */
  v2Value: unknown;
}

/** Map a single known v1 key/value to its v2 form, or null if unmapped (C2 candidate). */
export function mapV1Key(v1Key: string, value: unknown): MappedKey | null {
  switch (v1Key) {
    case "codex_review":
      // true→cross, false→local.
      return { v1Key, v2Key: "review", v2Value: value === true ? "cross" : "local" };
    case "auto_approve":
      // STRING form only — none→[], spec-and-plan→[spec,plan], implementation→[build], all→[all].
      if (typeof value === "string") {
        return { v1Key, v2Key: "auto_approve", v2Value: autoApproveToArray(value) };
      }
      return null;
    case "defaults.agent_team":
      return { v1Key, v2Key: "agent_mode", v2Value: agentTeamToMode(value) };
    case "wiki.share_mode":
      // project.yaml → settings.json defaults.wiki.share_mode (value unchanged).
      return { v1Key, v2Key: "defaults.wiki.share_mode", v2Value: value };
    default:
      return null;
  }
}

export function autoApproveToArray(s: string): string[] {
  switch (s) {
    case "none":
      return [];
    case "spec-and-plan":
      return ["spec", "plan"];
    case "implementation":
      return ["build"];
    case "all":
      return ["all"];
    default:
      return []; // conservative: unknown string → [] (closed-key clean)
  }
}

export function agentTeamToMode(value: unknown): string {
  if (value === true || value === "on") return "team";
  if (value === false || value === "off") return "subagent";
  return "auto"; // "auto" / absent
}

/**
 * Resolve the value currently sitting at a dotted v2 key path in the target v2
 * object, or `undefined` if the path is absent.
 */
export function getPath(obj: Record<string, unknown> | undefined, dotted: string): unknown {
  if (!obj) return undefined;
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Set a dotted v2 key path on an object (creating intermediate objects). */
export function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): void {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Deep value equality (JSON-comparable). */
export function valueEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The result of classifying one v1 key against the existing v2 target. */
export interface KeyClassification {
  outcome: KeyOutcome;
  /** For C1: the mapped key to write into the v2 artifact. */
  write?: MappedKey;
  /** For C2: the verbatim entry to relocate to .unmigrated-v1.json. */
  relocate?: { key: string; value: unknown };
}

/**
 * §2.0a classifier. Given a v1 key/value found in `sourceRel` and the CURRENT v2
 * target object (e.g. the existing settings.json contents), return the C1/C2/C3/C4
 * outcome.
 *
 *   - mapped + no existing v2 value          → C1 (write v2, drop v1)
 *   - mapped + existing v2 value EQUAL        → C3 (drop redundant v1)
 *   - mapped + existing v2 value DIFFERING    → C4 (keep LIVE, surface, re-surface)
 *   - unmapped (no v2 home)                   → C2 (relocate verbatim)
 */
export function classifyKey(
  v1Key: string,
  value: unknown,
  v2Target: Record<string, unknown> | undefined
): KeyClassification {
  const mapped = mapV1Key(v1Key, value);
  if (!mapped) {
    // C2 — no v2 home.
    return {
      outcome: { key: v1Key, case: "C2", detail: `relocated verbatim (value=${JSON.stringify(value)})` },
      relocate: { key: v1Key, value },
    };
  }
  const existing = getPath(v2Target, mapped.v2Key);
  if (existing === undefined) {
    // C1 — write to v2, drop v1.
    return {
      outcome: {
        key: v1Key,
        case: "C1",
        detail: `${v1Key} → ${mapped.v2Key}=${JSON.stringify(mapped.v2Value)}`,
      },
      write: mapped,
    };
  }
  if (valueEqual(existing, mapped.v2Value)) {
    // C3 — redundant; drop v1 key, v2 already authoritative.
    return {
      outcome: {
        key: v1Key,
        case: "C3",
        detail: `redundant: ${mapped.v2Key} already = ${JSON.stringify(existing)}; v1 key dropped`,
      },
    };
  }
  // C4 — genuine conflict. Keep LIVE; never clobber/auto-pick/relocate.
  return {
    outcome: {
      key: v1Key,
      case: "C4",
      detail: `CONFLICT: ${mapped.v2Key}=${JSON.stringify(existing)} vs v1 ${v1Key}=${JSON.stringify(
        value
      )} → kept LIVE, unresolved`,
    },
  };
}

/** Build the .unmigrated-v1.json document (§2.0 shape). */
export function buildUnmigratedDoc(
  createdAt: string,
  snapshotRef: string,
  entries: UnmigratedEntry[]
): string {
  const doc = {
    schema_version: UNMIGRATED_STAMP,
    created_at: createdAt,
    snapshot_ref: snapshotRef,
    entries,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

export type { KeyCase };
