/**
 * src/modules/kernel/workflows/path-containment.ts
 *
 * THE PATH-CONTAINMENT PRIMITIVE — one home for "prove this write lands inside
 * that root, and keep it true across the mkdir".
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────────
 * The same defect class was independently rediscovered FOUR times in this repo, by
 * lanes that did not know about each other. Three independent discoveries of one
 * class is a missing primitive, not a coincidence about symlinks:
 *
 *   1. RESOLVER LANE (`capability/adoption-migrate`), rated CRITICAL. A symlinked
 *      TARGET was refused by an lstat on the leaf — and then a symlinked PARENT
 *      directory made the leaf non-existent, so nothing fired, `mkdirSync` succeeded
 *      because the real directory already existed, and `writeFileSync` overwrote an
 *      arbitrary file outside the project WHILE THE CALL REPORTED `applied`.
 *
 *   2. LEARN LANE (`capability/profile-emit`), two variants.
 *      (a) `mkdirSync` ran BEFORE the containment check, so `mkdir -p` created
 *          directories THROUGH a symlinked ancestor before anything refused. The
 *          refusal was real but the side effect had already landed.
 *      (b) the fix's own new `isContainedRealPath` climbed with `existsSync`, which
 *          FOLLOWS symlinks — so a DANGLING symlink reads as "does not exist", the
 *          climb skipped past it and validated its in-root parent instead. A
 *          dangling symlink walked straight through the helper written to stop
 *          symlinks. The over-correction that followed ("any symlink on the climb
 *          refuses") then broke a legitimate symlinked project ROOT.
 *
 *   3. DEEP-FREEZE LANE, through a different door entirely: a symlinked
 *      `hooks/node_modules` let esbuild bake out-of-package paths into 66 committed
 *      bundles. Not a write escape — a determinism escape — but the same question
 *      ("does this path really live under that root once every link is resolved?")
 *      answered by string algebra instead of by `realpath`.
 *
 *   4. TEAMS LANE (`teams/station-signals`) had ALREADY built the pre/post pairing
 *      locally, with a comment saying it was doing so "without widening the shared
 *      helper's contract". That is the tell: the shared contract was the thing
 *      missing, and every lane paid to rebuild it.
 *
 * ── THE THREE SEMANTICS, RECONCILED ────────────────────────────────────────────
 * The lanes genuinely DISAGREED on two points, and this module picks one answer:
 *
 *   • THE CLIMB PROBE. Resolver used `existsSync`; Learn used `lstatSync`.
 *     `lstatSync` wins, and it is not a style preference: `existsSync` follows the
 *     link, so a dangling symlink is invisible to it. This is variant 2(b), and the
 *     resolver's copy still had it.
 *
 *   • WHAT A SYMLINK ON THE CLIMB MEANS. Resolver permitted any symlink whose
 *     realpath landed inside the root. Learn refused EVERY symlink except the
 *     project root itself. Teams refused every symlink, full stop.
 *     Resolved by generalizing Learn's own escape hatch: Learn special-cased the
 *     root by MATCHING ITS REALPATH. Apply that same test to every node on the
 *     climb and Learn's exception stops being an exception — a symlink is fine
 *     exactly when it resolves inside the root, which is the identical criterion
 *     the containment check already applies. That keeps the dangling-symlink catch
 *     (a dangling link cannot be realpath'd, so it refuses) AND keeps a legitimate
 *     symlinked project root working, which was Learn's regression.
 *     Teams' stricter stance is a POLICY, not a different truth about containment,
 *     so it survives as {@link ContainmentPolicy} `"physical"` rather than as a
 *     second implementation.
 *
 * ── WHY REFUSALS ARE CODED, NOT BOOLEAN ────────────────────────────────────────
 * Every refusal carries a {@link ContainmentRefusalCode}. A weakening that reddens
 * for the WRONG REASON is indistinguishable from a guard that works, so the
 * regression tests assert WHICH rule refused, never merely that something did.
 * Resolver returned a free-text reason (unassertable), Learn returned a bare
 * boolean (also unassertable), Teams threw (ditto).
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * How a symlink encountered on the path is treated.
 *
 * - `"resolve"` (default): a symlink is permitted exactly when it resolves INSIDE
 *   the root. This is the containment question itself, so it never refuses a write
 *   that genuinely lands in the tree — including through a symlinked project root.
 * - `"physical"`: no symlink is permitted anywhere BELOW the root, even one that
 *   resolves back inside it. The root's own link-ness is still fine (it is resolved
 *   separately). Use when the directory tree must be physically real — e.g. a run
 *   tree whose realpath is load-bearing evidence.
 */
export type ContainmentPolicy = "resolve" | "physical";

export type ContainmentRefusalCode =
  /** `root` itself does not resolve — there is nothing to be contained by. */
  | "root-unresolvable"
  /** The climb reached the filesystem root without finding any existing entry. */
  | "no-existing-ancestor"
  /**
   * A symlink on the path does not resolve. Variant 2(b): `existsSync` reads this
   * as "absent" and skips past it; `lstatSync` sees the link and lands here.
   */
  | "dangling-symlink"
  /** `policy: "physical"` and a symlink was found below the root. */
  | "physical-symlink"
  /** The resolved path lives outside the resolved root. Variants 1 and 3. */
  | "outside-root"
  /** `requireRegularFileLeaf` and the leaf exists as something else. */
  | "leaf-not-regular-file"
  /** The bounded `mkdir` itself failed (EEXIST on a file, EACCES, …). */
  | "mkdir-failed"
  /**
   * The target spelling contains a `..` segment, which cannot be answered
   * truthfully. `path.resolve` collapses `..` LEXICALLY, before any symlink is
   * resolved — so `root/link/../victim` with `root/link -> outside/dir` collapses
   * to `root/victim` and reads as contained, while a real write follows the link
   * first and lands in `outside/victim`. Reproduced by an adversarial pass.
   */
  | "parent-traversal"
  /**
   * The destination stopped being the destination between the containment proof
   * and the write — an ancestor directory was replaced mid-flight.
   */
  | "destination-moved";

/**
 * The CLOSED refusal vocabulary. Frozen at RUNTIME, not merely `as const`: `as
 * const` is a compile-time annotation and leaves the array mutable, which is a
 * validation bypass reachable without touching this file (rule 10 / class XF).
 */
export const CONTAINMENT_REFUSAL_CODES: readonly ContainmentRefusalCode[] = Object.freeze([
  "root-unresolvable",
  "no-existing-ancestor",
  "dangling-symlink",
  "physical-symlink",
  "outside-root",
  "leaf-not-regular-file",
  "mkdir-failed",
  "parent-traversal",
  "destination-moved",
]);

export interface ContainmentOptions {
  /** @see ContainmentPolicy. Default `"resolve"`. */
  readonly policy?: ContainmentPolicy;
  /**
   * Refuse when the leaf EXISTS but is not a regular file (symlink, FIFO, device,
   * directory). Off by default because most callers check a DIRECTORY; the
   * write-side helpers turn it on for the file they are about to replace.
   */
  readonly requireRegularFileLeaf?: boolean;
}

export interface ContainmentOk {
  readonly contained: true;
  /** `root` with every symlink resolved. */
  readonly realRoot: string;
  /**
   * The target with every symlink on its EXISTING prefix resolved and the
   * not-yet-created tail re-appended. This is where a write would actually land.
   */
  readonly realPath: string;
}

export interface ContainmentRefused {
  readonly contained: false;
  readonly code: ContainmentRefusalCode;
  /** Human-readable detail. NEVER assert on this — assert on `code`. */
  readonly detail: string;
}

export type ContainmentResult = ContainmentOk | ContainmentRefused;

/**
 * The narrowing predicate every caller should use.
 *
 * NOT `if (!r.contained)`. That reads fine and compiles under `strict`, but the
 * repo's jest transform supplies its own minimal tsconfig with `strict` OFF, and
 * without it a `true`/`false` literal discriminant widens to `boolean` and stops
 * narrowing the union — silently, in the TESTS ONLY, which is the worst place for
 * a type check to quietly stop working. A user-defined type predicate narrows
 * under every strictness setting, so the guard and its tests agree.
 */
export function isRefused(r: ContainmentResult | PrepareResult): r is ContainmentRefused {
  return "code" in r;
}

/** `path.relative` output that means "escaped `from`". Segment-aware on purpose. */
function escapes(rel: string): boolean {
  // NOT `rel.startsWith("..")` — a sibling directory literally named `..guild`
  // yields `..guild/x`, which starts with ".." and yet is INSIDE the root.
  return rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function refuse(code: ContainmentRefusalCode, detail: string): ContainmentRefused {
  return Object.freeze({ contained: false as const, code, detail });
}

/** Does the RAW spelling contain a `..` path segment? Segment-aware, not substring. */
function hasParentSegment(p: string): boolean {
  return p.split(/[\\/]/).includes("..");
}

/** `lstat`, or null when the entry is genuinely absent. Never throws. */
function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Pure, segment-aware containment over two ALREADY-RESOLVED paths: is `child` the
 * same as, or nested under, `parent`? No I/O — pair it with
 * {@link canonicalizeRealPath} when the inputs might contain links.
 *
 * The `rel !== ".."` / `rel.startsWith("../")` shape is load-bearing. A plain
 * `rel.startsWith("..")` calls a sibling directory literally named `..guild` an
 * escape, and it is not one.
 */
export function isWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || !escapes(rel);
}

/**
 * Canonicalize a path that MAY NOT EXIST YET: resolve every symlink on its
 * deepest existing prefix and re-append the missing tail.
 *
 * This is the shape three separate files had each grown their own copy of —
 * `canonicalAbs` in `command-registry.ts`, a byte-identical `canonicalAbs` in
 * `skill-source-transform.ts`, and `resolveRealTarget` in `instantiate-template.ts`
 * — and ALL THREE climbed with `existsSync`, so all three carried variant 2(b):
 * a dangling symlink read as "does not exist", the climb walked past it, and the
 * canonical path it returned was not where a write would land. The climb here uses
 * `lstat`.
 *
 * CLASSIFICATION, NOT CONTAINMENT. When the deepest existing entry is a symlink
 * that does not resolve, this climbs PAST it and re-appends the link's own name,
 * yielding the link's location resolved through its real parent. That is the right
 * answer for "which subtree is this in?" and the WRONG answer for "may I write
 * here?" — a security decision must use {@link checkContained}, which refuses a
 * dangling link outright rather than guessing where it points.
 *
 * KNOWN RESIDUAL, stated rather than hidden: this calls `path.resolve`, which
 * collapses `..` LEXICALLY, before any symlink is resolved. For a spelling like
 * `a/link/../b` where `link` is a symlink, the answer is the lexically-collapsed
 * location, not the physical one. {@link checkContained} REFUSES such spellings
 * (`parent-traversal`) precisely because it makes a security decision; this one
 * cannot refuse, because its callers need a path back rather than a verdict, and
 * they use it to classify a path they then check separately. A caller that turns
 * this result into a security verdict must guard the `..` case itself.
 */
export function canonicalizeRealPath(p: string): string {
  const abs = path.resolve(p);
  let existing = abs;
  const tail: string[] = [];
  for (;;) {
    const st = lstatOrNull(existing);
    if (st !== null) {
      try {
        const real = fs.realpathSync(existing);
        return tail.length ? path.join(real, ...tail) : real;
      } catch {
        // A present-but-unresolvable entry (a dangling link). Keep climbing so the
        // answer is anchored on a real directory instead of collapsing to `abs`.
      }
    }
    tail.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) return abs; // hit the filesystem root
    existing = parent;
  }
}

/**
 * Prove that `target` resolves inside `root`, reading the filesystem to see through
 * every symlink. Creates NOTHING. Safe to call before the destination exists.
 *
 * The check runs against the deepest ancestor that EXISTS AS A DIRECTORY ENTRY —
 * that is what makes it meaningful before the leaf is created, because the tail
 * below that ancestor is created by us, inside whatever that ancestor really is.
 */
export function checkContained(
  root: string,
  target: string,
  options: ContainmentOptions = {}
): ContainmentResult {
  const policy: ContainmentPolicy = options.policy ?? "resolve";

  let realRoot: string;
  try {
    realRoot = fs.realpathSync(path.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }

  // `path.resolve` IS NOT SAFE TO APPLY FIRST when the spelling contains `..`.
  // It collapses parent segments lexically, before any symlink is resolved, so
  // `root/link/../victim` (with `root/link -> outside/dir`) becomes `root/victim`
  // and reads as contained — while a real write follows `link` first and lands in
  // `outside/victim`. Reproduced by an adversarial pass, with the bytes on disk
  // outside the root and `contained: true` returned.
  //
  // The honest answer is a refusal, not a guess: without segment-by-segment
  // resolution this module cannot say where such a spelling lands, and a primitive
  // whose whole job is to be trustworthy must not answer a question it cannot.
  // Callers construct destinations with `path.join`, which collapses `..` at build
  // time, so a `..` surviving into this call is already unusual.
  // THE `..` REFUSAL APPLIES TO THE TARGET, NOT TO THE ROOT — and applying it to
  // the root was a regression an adversarial round caught with an ordinary input:
  // `--workspace /tmp/x/parent/../workspace`, where `parent` is a plain directory.
  // That is a normal path spelling, the predecessor accepted it, and this refused it.
  //
  // The asymmetry is principled rather than a concession. The hazard is `path.resolve`
  // collapsing `..` LEXICALLY before symlinks are resolved — and the root does not go
  // through `path.resolve` alone: it goes through `realpathSync`, which is a syscall
  // that walks the real filesystem and resolves `..` correctly against it. The target
  // is the one that cannot be resolved that way, because it may not exist yet.
  //
  // So the root is CANONICALISED FIRST and the target is resolved against the
  // canonical root — which also removes the second half of the hazard, since a `..`
  // in the root can no longer reach `path.resolve` at all.
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) — parent traversal cannot be resolved before symlinks`
    );
  }

  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(realRoot, target);

  // ── Climb to the deepest EXISTING entry ─────────────────────────────────────
  // `lstatSync`, NOT `existsSync`. `existsSync` FOLLOWS symlinks, so a DANGLING
  // symlink reads as "does not exist" and the climb walks straight past it to
  // validate its in-root parent instead — which is exactly how a dangling link
  // escaped the helper written to stop symlinks (variant 2b).
  let probe = abs;
  let probeStat: fs.Stats | null = null;
  for (;;) {
    probeStat = lstatOrNull(probe);
    if (probeStat !== null) break;
    const parent = path.dirname(probe);
    if (parent === probe) {
      return refuse("no-existing-ancestor", `no existing ancestor of ${abs}`);
    }
    probe = parent;
  }

  if (options.requireRegularFileLeaf && probe === abs && !probeStat.isFile()) {
    const what = probeStat.isSymbolicLink()
      ? "symlink"
      : probeStat.isDirectory()
        ? "directory"
        : "special file";
    return refuse(
      "leaf-not-regular-file",
      `${abs} exists and is not a regular file (${what}); refusing to write through it`
    );
  }

  // A symlink at the probe must resolve, or it is dangling and the path is not the
  // path it appears to be.
  let realProbe: string;
  try {
    realProbe = fs.realpathSync(probe);
  } catch {
    return refuse(
      "dangling-symlink",
      `${probe} is a symlink that does not resolve; refusing to write through it`
    );
  }

  const rel = path.relative(realRoot, realProbe);
  if (rel !== "" && escapes(rel)) {
    return refuse("outside-root", `${abs} resolves outside the project root (${realProbe})`);
  }

  if (policy === "physical") {
    // Walk EVERY segment of the logical path from the filesystem root down, and
    // refuse a symlink that resolves STRICTLY INSIDE the root.
    //
    // The previous version walked `path.relative(logicalRoot, abs)` and bailed when
    // that looked like an escape — which, on a case-insensitive volume, is exactly
    // what a differently-cased root spelling produces. An adversarial pass
    // reproduced it on APFS: root `.../Project`, target `.../project/alias/x`, an
    // in-root symlink at `alias`. `path.relative` is byte-comparing, saw an escape,
    // scanned ZERO segments, and the policy silently did nothing. A guard that
    // quietly inspects nothing is worse than no guard: it reports success.
    //
    // Walking from the filesystem root removes the comparison entirely. The root's
    // own link-ness is still permitted because the test is STRICTLY inside — a
    // segment whose realpath IS the root (a symlinked project root) is not below
    // it, and neither is anything above.
    const parsed = path.parse(abs);
    let walk = parsed.root;
    for (const seg of abs.slice(parsed.root.length).split(path.sep)) {
      if (seg === "" || seg === ".") continue;
      walk = path.join(walk, seg);
      const st = lstatOrNull(walk);
      if (st === null || !st.isSymbolicLink()) continue;
      let segReal: string;
      try {
        segReal = fs.realpathSync(walk);
      } catch {
        return refuse("dangling-symlink", `${walk} is a symlink that does not resolve`);
      }
      const segRel = path.relative(realRoot, segReal);
      const strictlyInside = segRel !== "" && !escapes(segRel);
      if (strictlyInside) {
        return refuse("physical-symlink", `refusing — symlinked path segment: ${walk}`);
      }
    }
  }

  const tail = path.relative(probe, abs);
  const realPath = tail === "" ? realProbe : path.join(realProbe, tail);
  return Object.freeze({ contained: true as const, realRoot, realPath });
}

export interface PreparedWrite extends ContainmentOk {
  /** The real directory the write will land in. Exists once this is returned. */
  readonly realDir: string;
}

export type PrepareResult = PreparedWrite | ContainmentRefused;

/**
 * THE PAIRING — the whole reason this module exists.
 *
 * Bounds the `mkdir` AND the write, in that order and without a gap:
 *
 *   1. PRE-CHECK the parent directory. `mkdir -p` is a SIDE EFFECT: run it first
 *      and it happily creates directories THROUGH a symlinked ancestor before any
 *      refusal is reported (variant 2a). Nothing is created until this passes.
 *   2. `mkdir -p` the parent — now proven to resolve inside the root.
 *   3. POST-CHECK the target itself. The directories that did not exist a moment
 *      ago exist now, so the check that could only see the deepest ancestor before
 *      can now see the real destination. This is also where a leaf swapped for a
 *      symlink between the two checks is caught (variant 1).
 *
 * Returns a refusal instead of throwing; the caller decides how loud to be.
 */
export function prepareContainedWrite(
  root: string,
  target: string,
  options: ContainmentOptions = {}
): PrepareResult {
  // The `..` guard must run on the RAW spelling, here as well as in
  // `checkContained`. Resolving first and then delegating would collapse the
  // parent segment before the guard ever saw it — the same
  // lexical-collapse-before-symlink-resolution mistake, made one layer up.
  if (hasParentSegment(target)) {
    return refuse(
      "parent-traversal",
      `refusing a path spelled with a ".." segment (${target}) — parent traversal cannot be resolved before symlinks`
    );
  }

  // Canonicalise the root here too, for the same reason and so both entry points
  // agree about what `abs` is. A root spelled with `..` is ordinary and legal.
  let canonRoot: string;
  try {
    canonRoot = fs.realpathSync(path.resolve(root));
  } catch {
    return refuse("root-unresolvable", `project root ${root} does not resolve`);
  }
  const abs = path.isAbsolute(target) ? path.resolve(target) : path.resolve(canonRoot, target);
  const dir = path.dirname(abs);

  // (1) PRE-CHECK — bounds the mkdir. `requireRegularFileLeaf` is deliberately NOT
  // forwarded here: the leaf under test is the DIRECTORY, and a directory is not a
  // regular file.
  const pre = checkContained(root, dir, { policy: options.policy });
  if (isRefused(pre)) return pre;

  // (2) the bounded mkdir.
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return refuse("mkdir-failed", `could not create ${dir}: ${(err as Error)?.message ?? "unknown"}`);
  }

  // (3) POST-CHECK — bounds the write.
  const post = checkContained(root, abs, options);
  if (isRefused(post)) return post;

  let realDir: string;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return refuse("dangling-symlink", `${dir} stopped resolving between the check and the write`);
  }

  return Object.freeze({
    contained: true as const,
    realRoot: post.realRoot,
    realPath: post.realPath,
    realDir,
  });
}

export interface ContainedWriteResult {
  readonly written: boolean;
  readonly code?: ContainmentRefusalCode | "write-failed";
  readonly detail?: string;
  readonly realPath?: string;
}

/**
 * `prepareContainedWrite` + an atomic, symlink-refusing write.
 *
 * The containment proof above is only as good as the write that follows it, and a
 * plain `writeFileSync` undoes it two ways: it TRUNCATES before writing (so a
 * failure part-way destroys the previous contents by the act of replacing them),
 * and it FOLLOWS a symlink planted at the leaf after the post-check. Writing to a
 * temp in the same real directory with `O_EXCL|O_NOFOLLOW` and `rename`-ing over
 * the target closes both: the replacement is atomic, and the final component can
 * never be a link this call followed.
 *
 * A SHORT WRITE IS NOT A WRITE — `writeSync` may return fewer bytes than it was
 * handed, and ignoring the count fsyncs and renames a PREFIX into place while
 * reporting success. The loop below refuses on no progress rather than spinning.
 *
 * ── WHAT THE RACE WINDOW ACTUALLY IS, STATED HONESTLY ──────────────────────────
 * The temp and the rename target `prepared.realPath` — the destination as it
 * RESOLVED when containment was proven — never the caller's logical path. With
 * `root/alias -> root/A`, a write to `root/alias/file` whose link is swapped to
 * `root/B` mid-flight still lands in `root/A/file`. Good.
 *
 * BUT AN EARLIER VERSION OF THIS COMMENT CLAIMED MORE THAN THAT, AND WAS WRONG.
 * A second adversarial pass replaced the resolved ANCESTOR itself — `rename A to
 * A-old`, then `A -> outside` — between the proof and the open, and reproduced
 * `{written: true}` with the bytes in `outside/file`. `O_NOFOLLOW` refuses a
 * symlink at the FINAL component only; it says nothing about the parents, and Node
 * exposes no `openat`, so a fully race-free bounded write is not constructible with
 * the synchronous `fs` API.
 *
 * So this does the three things that ARE constructible, and claims nothing beyond:
 *   1. RE-STAT the destination directory after the temp is created and compare
 *      device+inode with the directory containment was proven against. A replaced
 *      ancestor is a different inode.
 *   2. BIND the verification to the FILE via `fstat` on the open descriptor.
 *      `rename` preserves the inode, so the file sitting at `dest` afterwards must
 *      be the one this call wrote — an attacker who swaps an ancestor and swaps it
 *      BACK before the post-check would otherwise present a path that verifies
 *      while naming a different file.
 *   3. RE-VERIFY containment of the renamed-into-place file, and DELETE it and
 *      report failure if it escaped.
 *
 * THE WINDOW IS NOT CLOSED, AND A THIRD ADVERSARIAL ROUND STILL DROVE A WRITE
 * THROUGH ONE VARIANT OF IT. That result is recorded here rather than absorbed:
 * with the checks above in place it reproduced `written: true` with bytes outside
 * the root on one ancestor-swap shape, which I could not isolate before handing
 * over. Treat `writeContainedFile` as narrowing a race an attacker with concurrent
 * write access to the destination's ancestors can still win — not as closing it.
 * Callers whose threat model includes that attacker need a directory they control,
 * not a better check. What IS closed is the ordinary failure this class kept
 * producing: an escape reported as `applied`.
 *
 * The consequence a caller must still know: after a successful race on the NAME,
 * the path they passed no longer names the file that was written — `realPath` does,
 * which is why it is returned. Containment is what this offers; name stability is
 * not, because on a filesystem where a component can be re-pointed concurrently
 * nothing can offer it.
 */
export function writeContainedFile(
  root: string,
  target: string,
  bytes: Buffer,
  options: ContainmentOptions = {}
): ContainedWriteResult {
  const prepared = prepareContainedWrite(root, target, {
    ...options,
    requireRegularFileLeaf: options.requireRegularFileLeaf ?? true,
  });
  if (isRefused(prepared)) {
    return { written: false, code: prepared.code, detail: prepared.detail };
  }

  const dest = prepared.realPath;
  const tmp = `${dest}.tmp-${process.pid}`;

  // The identity of the directory containment was proven against. An ancestor
  // swapped for a symlink is a DIFFERENT INODE, which is the one thing about this
  // race that can be observed after the fact with the sync fs API.
  let provenDir: fs.Stats;
  try {
    provenDir = fs.statSync(prepared.realDir);
  } catch (err) {
    return { written: false, code: "write-failed", detail: (err as Error)?.message ?? "unknown" };
  }

  let fd: number | null = null;
  let created = false;
  try {
    fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    created = true;

    // (1) Did the destination directory change identity while we were opening?
    // `created` is still true here, so the `finally` block removes the temp — which
    // matters because a swapped ancestor means that temp was created OUTSIDE the
    // root, and leaving it behind litters the attacker's directory with our bytes.
    const nowDir = fs.statSync(prepared.realDir);
    if (nowDir.dev !== provenDir.dev || nowDir.ino !== provenDir.ino) {
      return {
        written: false,
        code: "destination-moved",
        detail: "the destination directory was replaced between the containment proof and the write",
      };
    }
    let off = 0;
    while (off < bytes.length) {
      const n = fs.writeSync(fd, bytes, off, bytes.length - off);
      if (n <= 0) return { written: false, code: "write-failed", detail: "no progress on write" };
      off += n;
    }
    // Bind the verification to the FILE, not to the path. `rename` preserves the
    // inode, so the identity captured here is what must be sitting at `dest`
    // afterwards — an attacker who swaps an ancestor and then swaps it BACK before
    // the post-check would otherwise present a path that verifies while naming a
    // different file.
    const writtenId = fs.fstatSync(fd);

    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, dest);
    created = false;

    // (2) Where did it ACTUALLY land? Re-verify, and if it escaped, remove it and
    // refuse. A write that escapes must never be reported as applied — that was
    // the whole of variant 1, and reporting `applied` was the part with teeth.
    let landedId: fs.Stats | null = null;
    try {
      landedId = fs.lstatSync(dest);
    } catch {
      landedId = null;
    }
    const after = checkContained(root, dest, { policy: options.policy });
    if (
      isRefused(after) ||
      landedId === null ||
      landedId.dev !== writtenId.dev ||
      landedId.ino !== writtenId.ino
    ) {
      try {
        fs.rmSync(dest, { force: true });
      } catch {
        /* best effort — the refusal is reported either way */
      }
      return {
        written: false,
        code: "destination-moved",
        detail: isRefused(after)
          ? `the written file resolved outside the root after the rename [${after.code}]`
          : "the file at the destination is not the file this call wrote",
      };
    }
    return { written: true, realPath: dest };
  } catch (err) {
    return { written: false, code: "write-failed", detail: (err as Error)?.message ?? "unknown" };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
    // Only remove a temp THIS CALL CREATED — an EEXIST failure means the temp
    // belongs to someone else, and the error path must not destroy a file the
    // success path never owned.
    if (created) {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* best effort */
      }
    }
  }
}

/**
 * Throwing wrapper for call sites whose contract is "refuse loudly".
 * `label` names the operation in the message so the thrower is identifiable.
 */
export function assertContained(
  root: string,
  target: string,
  label: string,
  options: ContainmentOptions = {}
): ContainmentOk {
  const r = checkContained(root, target, options);
  if (isRefused(r)) {
    throw new Error(`${label}: refusing path outside ${root} [${r.code}] — ${r.detail}`);
  }
  return r;
}
