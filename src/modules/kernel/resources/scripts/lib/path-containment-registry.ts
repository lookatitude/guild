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
  {
    path: "src/modules/kernel/workflows/path-containment.ts",
    status: "home",
    note: "THE primitive. Kernel is the substrate module — placing it in any of the four discovering modules (capability, learning, teams, distribution) would make it that module's property and re-create the problem it solves.",
  },
  {
    path: "scripts/lib/command-registry.ts",
    status: "adopted",
    note: "`canonicalAbs`/`isUnderOrEqual` were byte-identical to skill-source-transform.ts; both now alias the primitive.",
  },
  {
    path: "scripts/lib/skill-source-transform.ts",
    status: "adopted",
    note: "The byte-identical twin of command-registry.ts. Two files, one shape, one fix that had to be applied twice.",
  },
  {
    path: "scripts/instantiate-template.ts",
    status: "adopted",
    note: "`resolveRealTarget` was the third copy of the same climb.",
  },
  {
    path: "scripts/learn/extract-structural.ts",
    status: "adopted",
    note: "Its private `assertContained` climbed with existsSync and tested containment with `rel.startsWith('..')`, which calls a sibling named `..guild` an escape.",
  },
  {
    path: "scripts/lib/roster.ts",
    status: "adopted",
    note: "The same inline climb appeared THREE times in this one file.",
  },
  {
    path: "scripts/learn/lib/similarity.ts",
    status: "adopted",
    note: "`resolveUnderRoot` realpath'd only the LEAF, so a symlinked ancestor with a not-yet-created leaf passed.",
  },
  {
    path: "src/modules/teams/workflows/station-signals.ts",
    status: "adopted",
    note: "Had already rebuilt the whole pre/post pairing locally, in a comment saying it was doing so 'without widening the shared helper's contract'. Now a caller, with `policy: \"physical\"` preserving its stricter stance.",
  },
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
