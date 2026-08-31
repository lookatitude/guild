/**
 * scripts/lib/path-containment-registry.ts
 *
 * THE REGISTRATION SIDE OF THE PATH-CONTAINMENT RAIL.
 *
 * A shared shape has as many homes as the repo gives it, and each is a place a
 * change can stop. That is not a hypothesis here — it is what happened. Before the
 * primitive existed, ONE containment shape lived in eight places:
 *
 *   - `scripts/lib/command-registry.ts`         (`canonicalAbs` + `isUnderOrEqual`)
 *   - `scripts/lib/skill-source-transform.ts`   (BYTE-IDENTICAL copy of both)
 *   - `scripts/instantiate-template.ts`         (`resolveRealTarget`, same shape)
 *   - `scripts/learn/extract-structural.ts`     (`assertContained`, same climb)
 *   - `scripts/lib/roster.ts`                   (the same inline climb, THREE times)
 *   - `scripts/learn/lib/similarity.ts`         (`resolveUnderRoot`, leaf-only)
 *   - `src/modules/teams/workflows/station-signals.ts` (the full pre/post pairing)
 *   - plus the `resources/` MIRROR of each of the above
 *
 * Six of those climbed with `existsSync`, which follows symlinks — so six copies
 * carried the same dangling-symlink hole, and fixing any one of them would have
 * left five. The S3 lane learned this the hard way twice in one week: a schema
 * amendment reached its contract but not a structural duplicate in another module
 * (invisible to TypeScript, found only by grep), and then a SECOND resources mirror
 * of the same file surfaced via `git status` rather than via any gate.
 *
 * So the primitive alone is not the deliverable. THIS is: a build-time rail that
 * fails when a NEW home appears without registration. A fourth independent
 * discovery of the class would mean the primitive shipped without reaching
 * everywhere it was needed; the rail is what makes that impossible to do quietly.
 *
 * ── TWO SITES THAT ARE NOT ON THIS BRANCH YET, AND WILL RED WHEN THEY ARRIVE ───
 * The two lanes that FOUND this class most painfully are not merged into this
 * base, so their call sites could not be migrated here:
 *
 *   feature/cap-loc-learn      scripts/lib/capability/profile-emit.ts
 *   feature/cap-loc-resolver   scripts/lib/capability/adoption-migrate.ts
 *
 * That is not a gap left to good intentions. Running this rail against each lane's
 * worktree TODAY reports, by name:
 *
 *   learn-profiling:  [unregistered-site]   scripts/lib/capability/profile-emit.ts
 *                     [unregistered-mirror] …/capability/resources/…/profile-emit.ts
 *   resolver-modes:   [unregistered-site]   scripts/lib/capability/adoption-migrate.ts
 *                     [unregistered-mirror] …/capability/resources/…/adoption-migrate.ts
 *
 * So the integration that brings those lanes onto one tip CANNOT go green until
 * both adopt the primitive or register a reasoned waiver. The migration of the two
 * discovering lanes is therefore mechanical rather than remembered — which is the
 * whole point, since "remembered" is what failed four times.
 */

/** How a registered site relates to the shared primitive. */
export type ContainmentSiteStatus =
  /** THE primitive. Exactly one file may hold this. */
  | "home"
  /** Imports the primitive. The normal state for a migrated call site. */
  | "adopted"
  /**
   * Declares containment logic of its own, deliberately, with a stated reason.
   * A waiver is a decision that must be re-argued, never a way to stay quiet: the
   * rail prints every waiver on each run.
   */
  | "waived";

export interface ContainmentSite {
  /** Repo-relative POSIX path. */
  readonly path: string;
  readonly status: ContainmentSiteStatus;
  /** Why — required for `waived`, documentation for the rest. */
  readonly note: string;
}

/**
 * THE REGISTRY. Every file in `src/**`, `scripts/**` or `hooks/**` that the
 * scanner identifies as containing path-containment logic MUST appear here, and
 * every entry here must still exist and still match its declared status.
 *
 * Both directions are enforced, which matters: a one-way check ("every registered
 * file is fine") passes trivially once the registry is emptied, and a one-way
 * check the other way ("every found file is registered") passes trivially once the
 * scanner stops finding anything.
 *
 * CONSIDERED AND DELIBERATELY NOT REGISTERED. Two files realpath a path without
 * bounding a write, and the rail's own `registration-without-site` rule is what
 * forced this note rather than a comfortable-looking waiver:
 *
 *   - `src/modules/telemetry/workflows/receipt-journal.ts` canonicalizes a journal
 *     path for LOCK IDENTITY (two names for one file must take one lock). It is
 *     not asking whether a write is contained.
 *   - `scripts/lib/update-check.ts` realpaths the plugin root to IDENTIFY the
 *     install. Same: no root-bounded write, no containment decision to share.
 *
 * Registering either as `waived` would have added a rule with NOTHING TO FEEL IT —
 * an entry that can never fail, sitting in a registry whose whole job is to fail.
 * The rail rejected both on exactly that ground.
 */
export const CONTAINMENT_SITES: readonly ContainmentSite[] = Object.freeze([
  Object.freeze({
    path: "src/modules/kernel/workflows/path-containment.ts",
    status: "home",
    note: "THE primitive. Kernel is the substrate module — placing it in any of the four discovering modules (capability, learning, teams, distribution) would make it that module's property and re-create the problem it solves.",
  }),
  Object.freeze({
    path: "scripts/lib/command-registry.ts",
    status: "adopted",
    note: "`canonicalAbs`/`isUnderOrEqual` were byte-identical to skill-source-transform.ts; both now alias the primitive.",
  }),
  Object.freeze({
    path: "scripts/lib/skill-source-transform.ts",
    status: "adopted",
    note: "The byte-identical twin of command-registry.ts. Two files, one shape, one fix that had to be applied twice.",
  }),
  Object.freeze({
    path: "scripts/instantiate-template.ts",
    status: "adopted",
    note: "`resolveRealTarget` was the third copy of the same climb.",
  }),
  Object.freeze({
    path: "scripts/learn/extract-structural.ts",
    status: "adopted",
    note: "Its private `assertContained` climbed with existsSync and tested containment with `rel.startsWith('..')`, which calls a sibling named `..guild` an escape.",
  }),
  Object.freeze({
    path: "scripts/lib/roster.ts",
    status: "adopted",
    note: "The same inline climb appeared THREE times in this one file.",
  }),
  Object.freeze({
    path: "scripts/learn/lib/similarity.ts",
    status: "adopted",
    note: "`resolveUnderRoot` realpath'd only the LEAF, so a symlinked ancestor with a not-yet-created leaf passed.",
  }),
  Object.freeze({
    path: "scripts/check-bundle-determinism.ts",
    status: "adopted",
    note: "VARIANT 3's production adoption. A symlinked hooks/node_modules baked out-of-package paths into 66 committed bundles; this rail found it only from the fingerprint left behind. It now asks the primitive up front, with `policy: \"physical\"`. The esbuild METAFILE paths it checks afterwards are recorded strings with nothing on disk to resolve, and are deliberately left alone.",
  }),
  Object.freeze({
    path: "src/modules/lifecycle/workflows/run-lifecycle.ts",
    status: "adopted",
    note: "THE TENTH HOME, and the rail found it — not a human sweep. Its `assertContained` was PURELY LEXICAL (path.resolve + startsWith(base + sep)), guarding a mkdirSync + write into `.guild/runs`: a symlinked runs directory walked straight through it while it reported success. Its own docstring said it mirrored a further copy in `promote-upstream.ts`. Now `policy: \"physical\"`, since a run tree whose realpath is load-bearing provenance must be physically real; the strict-subdirectory half stays local because containment permits equality.",
  }),
  Object.freeze({
    path: "src/modules/workspace/workflows/promote-upstream.ts",
    status: "adopted",
    note: "THE ELEVENTH HOME — the one run-lifecycle.ts named in its own docstring (\"mirrors the containment assertion in promote-upstream.ts\") and that the rail could not see, because this copy was INLINE rather than factored into a named helper. Purely lexical, guarding a mkdirSync into `.guild/runs`. Now `prepareContainedWrite` with `policy: \"physical\"`, which replaces the bare mkdir too; the strict-subdirectory rule stays local because containment permits equality.",
  }),
  Object.freeze({
    path: "scripts/dot-guild/audit.ts",
    status: "waived",
    note: "WAIVER: its boolean-returning path helper classifies LEAK CANDIDATES for a read-only audit — a verdict about whether a file is exposed, not about whether a write is contained. There is no root-bounded write in this file. Unlike the two waivers this registry rejected earlier, this one has something to feel it: the scanner DOES see the site, so `registration-without-site` keeps the waiver honest.",
  }),
  Object.freeze({
    path: "src/modules/teams/workflows/station-signals.ts",
    status: "adopted",
    note: "Had already rebuilt the whole pre/post pairing locally, in a comment saying it was doing so 'without widening the shared helper's contract'. Now a caller, with `policy: \"physical\"` preserving its stricter stance.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/profile-emit.ts",
    status: "adopted",
    note: "THE ELEVENTH HOME, and it was invisible to the sweep that found the first ten: it lives on feature/cap-loc-learn, which is not an ancestor of this registry's branch, so the two only met at the six-branch integration (task #30). It was the STRICTEST of the four rediscoveries — the one that FOUND the dangling-symlink defect (`lstat`, not `existsSync`) — and it carried a project-root escape hatch so a symlinked project root still worked. Both survive adoption: the dangling catch as the `dangling-symlink` refusal, the root exception generalised into matching realpath at every node. Default `policy: \"resolve\"`, the behaviour this lane shipped and tested.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/adoption-migrate.ts",
    status: "adopted",
    note: "THE TWELFTH HOME, from feature/cap-loc-resolver, and likewise unreachable from this registry's base until the integration merged both. Adopting it CLOSES A HOLE rather than merely deduplicating: its climb probed with `existsSync`, which follows symlinks, so a DANGLING symlink read as absent and the climb proved containment of the in-root PARENT instead — the exact defect the learn lane had already found and fixed in its own copy, still live here. Two lanes, one shape, one fixed and one not: the case for a single primitive, made concrete.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/compatibility-loader.ts",
    status: "adopted",
    note: "PCL-09 catalog and usage-payload writes now use the shared bounded writer; compatibility reads use the same primitive with physical-file policy.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/migration-window.ts",
    status: "adopted",
    note: "PCL-10 migration-window state previously repeated a realpath-prefix write check; it now uses the shared bounded writer.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/migration-evidence.ts",
    status: "adopted",
    note: "PCL-FU-06 immutable baseline, observation, restart-history, and atomic publication paths use the shared physical containment primitive; its additional descriptor and directory-identity checks strengthen multi-file evidence publication without creating a second containment verdict.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/self-build-canonicalize.ts",
    status: "adopted",
    note: "PCL-15 adoption-manifest and definition-ref artifacts are project-bounded writes and now use the shared primitive.",
  }),
  Object.freeze({
    path: "scripts/lib/capability/strangler-control.ts",
    status: "adopted",
    note: "PCL-08 feature-gate state previously repeated a realpath-prefix write check; it now uses the shared bounded writer.",
  }),
  Object.freeze({
    path: "scripts/lib/workspace-project-root.ts",
    status: "waived",
    note: "WAIVER: the private upward walk discovers the nearest workspace manifest and performs no write or containment verdict. The later project-root boundary decision separately delegates to checkContained and fails closed on refusal.",
  }),
  Object.freeze({
    path: "scripts/activated-host-conformance.ts",
    status: "waived",
    note: "WAIVER: activated-host capture owns a stricter multi-file evidence transaction inside a process-created private stage: nofollow regular-file reads, exclusive creation, descriptor-bound executable copies, pre/post package and consumer snapshots, atomic directory rename, and directory fsync. Its path-relative checks classify the Codex cache/workspace separation rule; replacing the transaction with the shared single-file bounded writer would discard the atomic triple-publication and sealed-runtime guarantees. Adversarial tests pin symlink refusal, package/consumer drift, partial-write rollback, and durability failures.",
  }),
  Object.freeze({
    path: "src/modules/dispatch/workflows/task-assignment-v2.ts",
    status: "adopted",
    note: "TaskCell assignment, attempt, instance, and acknowledgment reads/writes use the shared physical containment primitive so a symlinked run-tree channel cannot escape the project.",
  }),
  Object.freeze({
    path: "src/modules/telemetry/workflows/task-cell-telemetry.ts",
    status: "adopted",
    note: "TaskCell telemetry and usage directories are created only through the shared physical prepareContainedWrite pairing.",
  }),
  Object.freeze({
    path: "src/modules/telemetry/workflows/run-analysis.ts",
    status: "waived",
    note: "WAIVER: the analyzer intentionally owns a stricter transactional containment layer: symlink-refusing input walks, O_EXCL temporary files, atomic rename, inode-owned locks, and a validated multi-file recovery journal. Replacing it with the single-file primitive would discard transaction and lock guarantees; adversarial analyzer tests pin escape, symlink, journal, and recovery behavior.",
  }),
]);

/** Repo-relative path of the one file that may hold `status: "home"`. */
export const CONTAINMENT_HOME = "src/modules/kernel/workflows/path-containment.ts";

/**
 * Directories the scanner sweeps. `resources/` mirrors live UNDER these, and are
 * swept too — the S3 lane's second mirror surfaced via `git status` rather than a
 * gate precisely because a scan stopped at the live tree.
 */
export const CONTAINMENT_SCAN_ROOTS: readonly string[] = Object.freeze([
  "src",
  "scripts",
  "hooks",
]);
