/**
 * src/modules/state/workflows/storage-artifact-registry.ts
 *
 * Proposal §26 Phase 0 in its machine-readable form: every production Guild
 * artifact, classified. The registry replaces the ad-hoc path joins scattered
 * across 100+ consumers — a writer looks its artifact up here and asks
 * `GuildStorage` for the path, instead of building `.guild/...` itself.
 *
 * The five §31 questions must be answerable for every row. `assertRegistered`
 * is what stops an unclassified writer from appearing (Phase 0 deliverable).
 *
 * CONTRACT: pure data + lookups. No fs, no clock.
 */

import { deepFreeze } from "../../kernel";
import type { ArtifactPolicy } from "./storage-policy";
import { DURABLE_CLASSES } from "./storage-policy";

export const STORAGE_ARTIFACT_REGISTRY_SCHEMA = "guild.storage_artifact_registry.v1" as const;

/**
 * The classification. `id` is the stable key a writer cites; `description` is what
 * `maintain gc --dry-run` prints.
 *
 * Ordering is by storage class so a reader can see the KTD15 split at a glance:
 * canonical/durable-record stay in `.guild/`; everything below them left.
 */
export const STORAGE_ARTIFACT_REGISTRY: readonly ArtifactPolicy[] = deepFreeze([
  // ── canonical: the knowledge a user would mourn ───────────────────────────
  {
    id: "root-identity",
    storageClass: "canonical",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description: ".guild/guild.yaml — root identity (workspace or project).",
  },
  {
    id: "project-config",
    storageClass: "canonical",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description: ".guild/settings.json — policy-only durable config (U-CFG owns the split).",
  },
  {
    id: "wiki-page",
    storageClass: "canonical",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description: ".guild/wiki/** — synthesized knowledge, decisions, standards, glossary.",
  },
  {
    id: "definition-agent",
    storageClass: "canonical",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description: ".guild/agents/*.md — minted specialist profiles (KTD20); never overwritten by feedstock.",
  },
  {
    id: "definition-skill",
    storageClass: "canonical",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description: ".guild/skills/<name>/SKILL.md — project-authored skills (KTD20).",
  },
  {
    id: "definition-source",
    storageClass: "durable-record",
    scope: "project",
    shareable: false,
    rebuildable: false,
    retention: { kind: "permanent" },
    cleanupOwner: "never",
    description:
      "definition(\"sources\", <id>) — ingested blobs kept as durable sources (KTD47/R59). Replaces the retired raw sources tree.",
  },
  {
    id: "initiative-record",
    storageClass: "durable-record",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "until-archive" },
    cleanupOwner: "initiative-archive",
    description: ".guild/initiatives/{active,archived}/** — durable work records.",
  },
  {
    id: "run-record",
    storageClass: "durable-record",
    scope: "project",
    shareable: true,
    rebuildable: false,
    retention: { kind: "until-archive" },
    cleanupOwner: "initiative-archive",
    description:
      ".guild/runs/<run-id>/** — the KTD16 frozen run record the benchmark reads (logs/v1.4-events.jsonl).",
  },
  {
    id: "analysis-artifact",
    storageClass: "durable-record",
    scope: "project",
    shareable: true,
    rebuildable: true,
    retention: { kind: "until-archive" },
    cleanupOwner: "initiative-archive",
    description: ".guild/analysis/** and .guild/recommendations/** — KTD16 producer outputs.",
  },

  // ── runtime: needed while something runs, not truth afterwards ────────────
  {
    id: "layout-journal",
    storageClass: "runtime",
    scope: "local",
    shareable: false,
    rebuildable: false,
    retention: { kind: "ttl", ttl_hours: 24 * 30 },
    cleanupOwner: "cache-gc",
    description:
      "<state>/roots/<root-id>/journal/** — the layout-upgrade journal, deliberately OUTSIDE .guild (KTD23; T07 writes it).",
  },
  {
    id: "run-lease",
    storageClass: "runtime",
    scope: "local",
    shareable: false,
    rebuildable: false,
    retention: { kind: "run-scoped" },
    cleanupOwner: "run-close",
    description: "<state>/roots/<root-id>/runs/<run-id>/** — leases and live execution state.",
  },

  // ── cache: derived, rebuildable, off the repo ─────────────────────────────
  {
    id: "index-sqlite",
    storageClass: "cache",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "ttl", ttl_hours: 24 * 30 },
    cleanupOwner: "cache-gc",
    description: "BM25/recall SQLite index — rebuildable from the wiki (was .guild/index.sqlite).",
  },
  {
    id: "codebase-map",
    storageClass: "cache",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "ttl", ttl_hours: 24 * 14 },
    cleanupOwner: "cache-gc",
    description: "CodebaseMap cheap-scan output — rebuildable by learn-map.",
  },
  {
    id: "knowledge-graph",
    storageClass: "cache",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "ttl", ttl_hours: 24 * 30 },
    cleanupOwner: "cache-gc",
    description: "KnowledgeGraph + knowledge-links recall projection — rebuildable by learn-graph.",
  },
  {
    id: "model-catalog",
    storageClass: "cache",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "ttl", ttl_hours: 24 * 7 },
    cleanupOwner: "cache-gc",
    description: "Provider/model catalog — refetched on miss; never durable truth (KTD22).",
  },

  // ── managed resources: things with an owner and a reaper ──────────────────
  {
    id: "lane-worktree",
    storageClass: "managed-resource",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "run-scoped" },
    cleanupOwner: "resource-reaper",
    description: "<worktrees>/<root-id>/<run-id>/<lane-id> — managed lane worktree; dirty trees are preserved.",
  },

  // ── temporary: scratch, deleted on close ──────────────────────────────────
  {
    id: "run-scratch",
    storageClass: "temporary",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "run-scoped" },
    cleanupOwner: "run-close",
    description:
      "temporary(<run-id>) — research/experiment working files (KTD34/R51). Never a durable tree; deleted by closeRun.",
  },
  {
    id: "session-scratch",
    storageClass: "temporary",
    scope: "local",
    shareable: false,
    rebuildable: true,
    retention: { kind: "ttl", ttl_hours: 24 },
    cleanupOwner: "scratch-janitor",
    description: "temporary() with no run — swept by the 24h janitor after a crash or reboot.",
  },
]);

const BY_ID = new Map(STORAGE_ARTIFACT_REGISTRY.map((p) => [p.id, p]));

export function artifactPolicy(id: string): ArtifactPolicy | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Phase 0's test hook: a writer that names an unregistered artifact fails here
 * rather than silently inventing a home.
 */
export function assertRegistered(id: string): ArtifactPolicy {
  const policy = BY_ID.get(id);
  if (!policy) {
    throw new Error(
      `guild storage: '${id}' is not in ${STORAGE_ARTIFACT_REGISTRY_SCHEMA}. ` +
        `Classify it (class, scope, shareable, rebuildable, retention, cleanup owner) before writing it.`,
    );
  }
  return policy;
}

/** Registry self-consistency: truth is never rebuildable, and vice versa. */
export function validateRegistry(
  rows: readonly ArtifactPolicy[] = STORAGE_ARTIFACT_REGISTRY,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) problems.push(`duplicate artifact id: ${row.id}`);
    seen.add(row.id);
    if (DURABLE_CLASSES.has(row.storageClass) && row.rebuildable && row.storageClass === "canonical") {
      problems.push(`${row.id}: canonical artifacts are never rebuildable`);
    }
    if (!DURABLE_CLASSES.has(row.storageClass) && row.cleanupOwner === "never") {
      problems.push(`${row.id}: a non-durable artifact needs a cleanup owner`);
    }
    if (row.retention.kind === "ttl" && !(row.retention.ttl_hours > 0)) {
      problems.push(`${row.id}: ttl retention needs a positive ttl_hours`);
    }
  }
  return problems;
}
