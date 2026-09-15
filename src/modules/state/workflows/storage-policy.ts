/**
 * src/modules/state/workflows/storage-policy.ts
 *
 * Storage classes and the one invariant that makes KTD15 mechanical (proposal §10):
 *
 *   a `runtime`, `cache`, `managed-resource` or `temporary` artifact
 *   MUST NOT resolve beneath `.guild/`
 *
 * and its mirror image:
 *
 *   a `canonical` or `durable-record` artifact MUST resolve beneath `.guild/`
 *
 * Proposal §31 asks five questions of every artifact (owner, deletable, cleaner,
 * lifetime, duplicable). `ArtifactPolicy` is those five answers as data, so a new
 * artifact either declares them or fails the registry check.
 *
 * CONTRACT: pure. No fs, no clock.
 */

import * as path from "node:path";

import { deepFreeze, sealSet } from "../../kernel";

/** Which Guild level owns the artifact. `local` is per-machine, owned by neither. */
export type GuildScope = "project" | "workspace";

/**
 * Proposal §10. The class answers "can this be deleted without losing truth?":
 * the first two say no, the last four say yes.
 */
export type StorageClass =
  | "canonical"
  | "durable-record"
  | "runtime"
  | "cache"
  | "managed-resource"
  | "temporary";

/** The four classes that are rebuildable and therefore banned from `.guild/`. */
export const NON_DURABLE_CLASSES: ReadonlySet<StorageClass> = sealSet<StorageClass>(
  ["runtime", "cache", "managed-resource", "temporary"],
  "NON_DURABLE_CLASSES",
);

/** The two classes that ARE truth and therefore must live in `.guild/`. */
export const DURABLE_CLASSES: ReadonlySet<StorageClass> = sealSet<StorageClass>(
  ["canonical", "durable-record"],
  "DURABLE_CLASSES",
);

/** How long the artifact lives, and what event ends it. */
export type RetentionPolicy =
  /** Never reclaimed; only a user deletes it. */
  | { kind: "permanent" }
  /** Lives until the owning initiative is archived. */
  | { kind: "until-archive" }
  /** Lives until the owning run closes. */
  | { kind: "run-scoped" }
  /** Reclaimed by the janitor after `ttl_hours` of inactivity. */
  | { kind: "ttl"; ttl_hours: number };

/** The five §31 answers, as data. A writer without one is an unclassified writer. */
export interface ArtifactPolicy {
  /** Stable id, unique in the registry. */
  readonly id: string;
  readonly storageClass: StorageClass;
  readonly scope: GuildScope | "local";
  /** May it leave the machine (share-set, benchmark fixtures)? */
  readonly shareable: boolean;
  /** Can Guild recreate it from other inputs? Truth is never rebuildable. */
  readonly rebuildable: boolean;
  readonly retention: RetentionPolicy;
  /** Who deletes it: "run-close", "cache-gc", "resource-reaper", "initiative-archive", "never". */
  readonly cleanupOwner: CleanupOwner;
  /** One line for the receipt and the `maintain gc` report. */
  readonly description: string;
}

export type CleanupOwner =
  | "run-close"
  | "cache-gc"
  | "resource-reaper"
  | "initiative-archive"
  | "scratch-janitor"
  | "never";

/** KTD16: the frozen plugin↔benchmark paths, relative to `.guild/`. */
export const KTD16_FROZEN_PREFIXES: readonly string[] = deepFreeze([
  "runs",
  "analysis",
  "recommendations",
]);

/** Is `rel` (a `.guild/`-relative POSIX path) inside the KTD16 freeze? */
export function isKtd16FrozenPath(rel: string): boolean {
  const head = rel.replace(/^\/+/, "").split("/")[0];
  return KTD16_FROZEN_PREFIXES.includes(head);
}

/** True when `abs` is `guildDir` itself or anything under it. */
export function isUnderDurable(abs: string, guildDir: string): boolean {
  const rel = path.relative(path.resolve(guildDir), path.resolve(abs));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export class StoragePlacementError extends Error {
  constructor(
    readonly storageClass: StorageClass,
    readonly resolvedPath: string,
    detail: string,
  ) {
    super(detail);
    this.name = "StoragePlacementError";
  }
}

/**
 * The KTD15 invariant, both directions. Every `GuildStorage` accessor runs this on
 * the path it is about to return, so a wrong home is a throw at construction time
 * rather than a stray directory discovered months later.
 *
 * KTD16 needs no exception here: the frozen paths hold run RECORDS, which are
 * `durable-record` and therefore belong under `.guild/` by the ordinary rule.
 */
export function assertClassPlacement(
  storageClass: StorageClass,
  absPath: string,
  guildDir: string,
): void {
  const under = isUnderDurable(absPath, guildDir);
  if (NON_DURABLE_CLASSES.has(storageClass)) {
    if (!under) return;
    // NO KTD16 CARVE-OUT. The freeze keeps the run RECORD under `.guild/runs/`,
    // and a run record is `durable-record`, which the rule below already allows.
    // A blanket "anything under .guild/runs passes" exemption would have let any
    // cache or scratch file live there under a KTD16 label, which is the exact
    // debris KTD15 exists to remove (codex G-lane r1 P1).
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact may not resolve beneath .guild/ (${absPath}). ` +
        `Rebuildable state belongs in the cache/state/temp root (KTD15).`,
    );
  }
  if (!under) {
    throw new StoragePlacementError(
      storageClass,
      absPath,
      `guild storage: a '${storageClass}' artifact must resolve beneath .guild/ (${absPath}). ` +
        `Truth is never written outside the repo (KTD15).`,
    );
  }
}

/**
 * Reject traversal, absolute segments, and empty or dot segments before joining.
 *
 * `.` matters as much as `..`: `temporary(".")` would otherwise resolve to the
 * scratch ROOT, and `closeRun(".")` would then delete every run's scratch instead
 * of one run's. Both separators are checked so a Windows-shaped segment cannot
 * slip a traversal past a posix-only split.
 */
export function assertSafeSegments(segments: readonly string[]): void {
  for (const raw of segments) {
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error("guild storage: empty path segment");
    }
    if (path.isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith("\\\\")) {
      throw new Error(`guild storage: absolute path segment is refused: ${raw}`);
    }
    if (raw.includes("\0")) {
      throw new Error("guild storage: NUL byte in a path segment");
    }
    for (const part of raw.split(/[\\/]/)) {
      if (part === "..") throw new Error(`guild storage: traversal segment is refused: ${raw}`);
      if (part === ".") throw new Error(`guild storage: dot segment is refused: ${raw}`);
    }
  }
}

/**
 * The durable vocabulary: which subtree of `.guild/` each logical name resolves to
 * on the shipped layout. It lives here, with the classes, because it IS policy —
 * `storage-layout.ts` only performs the join.
 *
 * Deliberately NOT the proposal §6 re-parenting (`project/knowledge/**`): rev 20
 * freezes the shipped shapes (KTD16 for runs, the wiki laws for knowledge), so the
 * map points at the trees that exist today.
 */
export const DURABLE_SUBTREES = deepFreeze({
  /** Canonical knowledge (KTD35/KTD70). */
  knowledge: "wiki",
  /**
   * The definition tree root is `.guild/` itself: `agents/`, `skills/` and `teams/`
   * already sit there (KTD20).
   */
  definitionsRoot: "",
  /**
   * `definition("sources", id)` — the one logical name that maps elsewhere, onto
   * the durable sources tree that already exists, so R59 does not invent a third home.
   */
  sources: path.join("knowledge", "sources"),
  initiatives: "initiatives",
  /** KTD16 freeze. */
  runs: "runs",
  artifacts: "artifacts",
} as const);
