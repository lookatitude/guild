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
  | "mkdir-failed";

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

/** `lstat`, or null when the entry is genuinely absent. Never throws. */
function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
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

  const abs = path.resolve(root, target);

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
    // Every segment BELOW the root must be a real entry, not a link — even one
    // resolving back inside the root. The walk is over the LOGICAL path, because
    // that is where a planted link actually sits; walking the RESOLVED path would
    // see only what the link points at and never the link itself. The root's own
    // link-ness is already accounted for by `realRoot`, so the walk starts one
    // segment below it and the root is never a candidate.
    const logicalRoot = path.resolve(root);
    const logicalRel = path.relative(logicalRoot, abs);
    let logical = logicalRoot;
    for (const seg of logicalRel === "" || escapes(logicalRel) ? [] : logicalRel.split(path.sep)) {
      logical = path.join(logical, seg);
      const st = lstatOrNull(logical);
      if (st !== null && st.isSymbolicLink()) {
        return refuse("physical-symlink", `refusing — symlinked path segment: ${logical}`);
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
  const abs = path.resolve(root, target);
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
  let fd: number | null = null;
  let created = false;
  try {
    fd = fs.openSync(
      tmp,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    created = true;
    let off = 0;
    while (off < bytes.length) {
      const n = fs.writeSync(fd, bytes, off, bytes.length - off);
      if (n <= 0) return { written: false, code: "write-failed", detail: "no progress on write" };
      off += n;
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, dest);
    created = false;
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
