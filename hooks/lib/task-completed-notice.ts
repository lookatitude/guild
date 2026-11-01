/**
 * hooks/lib/task-completed-notice.ts — the CD4 unbound E00 TaskCompleted path.
 *
 * Without a presented run binding, an E00 lane's TaskCompleted may only leave an
 * untrusted claim at .guild/runs/<run>/outbox/<instance>/task-completed-notice.json.
 * Everything before that write is read-only: the layout marker is classified here
 * (never bootstrapped or migrated), the receipt is secret-checked in memory (never
 * scrubbed in place), and a receipt that would need redaction refuses with no notice.
 *
 * Containment is cooperative_local hygiene: every outbox level is lstat'd, created
 * non-recursively and refused when it is not a plain directory, the leaf is created
 * O_EXCL|O_NOFOLLOW and an existing leaf is opened O_NOFOLLOW|O_NONBLOCK only after it
 * lstat's as a small single-link regular file. That stops accidental or worker-placed
 * links; it is not isolation from a same-UID racer (lstat → mkdir → open is not atomic).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { CURRENT_LAYOUT_VERSION, markerPath } from "./ensure-layout.js";
import { applySecretsPolicy } from "./security/secrets.js";
import { readSecurityConfig } from "./security/config.js";
import { taskCellPaths, type readTaskAssignmentV2 } from "../../src/domains/dispatch/index.js";
import { durableGuildDir } from "../../src/domains/state";

type Assignment = NonNullable<ReturnType<typeof readTaskAssignmentV2>>;

/** Must equal TASK_COMPLETED_NOTICE_SCHEMA in task-cell-controller.ts (not on the dispatch index). */
export const TASK_COMPLETED_NOTICE_SCHEMA = "guild.task_completed_notice.v1";

export type PackageIdentity = { id: string; sha256: string } | null;

export type NoticeRefusal =
  | "layout_root_unsafe"
  | "layout_marker_unsafe"
  | "layout_marker_malformed"
  | "layout_stale"
  | "layout_future"
  | "assignment_shape_unproven"
  | "secret_scrub_required"
  | "outbox_unsafe"
  | "notice_unsafe"
  | "notice_conflict"
  | "notice_write_failed";

const MAX_SMALL_FILE_BYTES = 64 * 1024;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK = fs.constants.O_NONBLOCK ?? 0;
const NOTICE_KEYS = ["assignment_id", "instance_id", "noticed_at", "package_identity", "run_id", "schema_version"];

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** A small single-link regular file, read without following a link or blocking on a FIFO. */
function isSmallRegular(st: fs.Stats): boolean {
  return st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.size <= MAX_SMALL_FILE_BYTES;
}

function readSmallRegular(p: string, expected: fs.Stats): Buffer | null {
  let fd: number;
  try {
    fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.dev !== expected.dev || st.ino !== expected.ino || st.size > MAX_SMALL_FILE_BYTES) return null;
    return fs.readFileSync(fd);
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** The controller's assignment id: `<task_run_id>:<attempt>:<instance_id>`. */
export function assignmentIdOf(a: Assignment): string {
  return `${a.task_run_id}:${a.attempt}:${a.instance_id}`;
}

/**
 * Read-only layout and shape check (h-r1 Q2a). A missing marker passes only on an
 * assignment proved current by the canonical TaskCell path rules; a present marker must
 * be a safe file at exactly CURRENT_LAYOUT_VERSION. Returns the realpath'd root.
 */
export function checkUnboundLayout(
  guildRoot: string,
  assignment: Assignment,
): { ok: true; realRoot: string } | { ok: false; reason: NoticeRefusal } {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync(guildRoot);
    const gd = fs.lstatSync(durableGuildDir(realRoot));
    if (!gd.isDirectory() || gd.isSymbolicLink()) return { ok: false, reason: "layout_root_unsafe" };
  } catch {
    return { ok: false, reason: "layout_root_unsafe" };
  }

  // Canonical ids and exact path: taskCellPaths throws on an unsafe segment.
  try {
    const expected = taskCellPaths({
      run_id: assignment.run_id,
      logical_task_id: assignment.logical_task_id,
      attempt: assignment.attempt,
      instance_id: assignment.instance_id,
    }).assignment_path.replace(/\\/g, "/");
    if (assignment.assignment_path !== expected) return { ok: false, reason: "assignment_shape_unproven" };
    const st = lstatOrNull(path.join(realRoot, expected));
    if (st === null || !st.isFile() || st.isSymbolicLink()) return { ok: false, reason: "assignment_shape_unproven" };
  } catch {
    return { ok: false, reason: "assignment_shape_unproven" };
  }

  const marker = markerPath(realRoot);
  let st: fs.Stats | null;
  try {
    st = lstatOrNull(marker);
  } catch {
    return { ok: false, reason: "layout_marker_unsafe" };
  }
  if (st === null) return { ok: true, realRoot };
  if (!isSmallRegular(st)) return { ok: false, reason: "layout_marker_unsafe" };
  const bytes = readSmallRegular(marker, st);
  if (bytes === null) return { ok: false, reason: "layout_marker_unsafe" };
  let version: unknown;
  try {
    version = (JSON.parse(bytes.toString("utf8")) as { storage_layout_version?: unknown }).storage_layout_version;
  } catch {
    return { ok: false, reason: "layout_marker_malformed" };
  }
  if (typeof version !== "number" || !Number.isInteger(version)) return { ok: false, reason: "layout_marker_malformed" };
  if (version === CURRENT_LAYOUT_VERSION) return { ok: true, realRoot };
  return { ok: false, reason: version > CURRENT_LAYOUT_VERSION ? "layout_future" : "layout_stale" };
}

/** True when the configured secrets policy leaves the receipt byte-identical (pure, in memory). */
export function receiptIsSecretClean(guildRoot: string, content: string): boolean {
  try {
    const result = applySecretsPolicy(content, readSecurityConfig(guildRoot).secrets_policy, { noTruncate: true });
    return result.ok === true && result.value === content;
  } catch {
    return false;
  }
}

function samePackage(a: unknown, b: PackageIdentity): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || Array.isArray(a)) return false;
  const o = a as Record<string, unknown>;
  return Object.keys(o).sort().join(",") === "id,sha256" && o["id"] === b.id && o["sha256"] === b.sha256;
}

function isCanonicalIso(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const t = Date.parse(v);
  return !Number.isNaN(t) && new Date(t).toISOString() === v;
}

/**
 * Exclusively create the notice, or accept an existing one only when it is this exact
 * claim (schema, run, assignment, instance and package identity, with this hook's own
 * canonical noticed_at). An existing notice is never overwritten, renamed or removed.
 */
export function writeExclusiveNotice(
  realRoot: string,
  assignment: Assignment,
  packageIdentity: PackageIdentity,
): { ok: true; created: boolean; path: string } | { ok: false; reason: NoticeRefusal } {
  const levels = ["runs", assignment.run_id, "outbox", assignment.instance_id];
  let dir = durableGuildDir(realRoot);
  try {
    for (const seg of levels) {
      dir = path.join(dir, seg);
      let st = lstatOrNull(dir);
      if (st === null) {
        try {
          fs.mkdirSync(dir, { mode: 0o700 });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "EEXIST") return { ok: false, reason: "outbox_unsafe" };
        }
        st = lstatOrNull(dir);
      }
      if (st === null || st.isSymbolicLink() || !st.isDirectory()) return { ok: false, reason: "outbox_unsafe" };
    }
    if (fs.realpathSync(dir) !== path.join(durableGuildDir(realRoot), ...levels)) return { ok: false, reason: "outbox_unsafe" };
  } catch {
    return { ok: false, reason: "outbox_unsafe" };
  }

  const noticePath = path.join(dir, "task-completed-notice.json");
  const notice = {
    schema_version: TASK_COMPLETED_NOTICE_SCHEMA,
    run_id: assignment.run_id,
    assignment_id: assignmentIdOf(assignment),
    instance_id: assignment.instance_id,
    package_identity: packageIdentity,
    noticed_at: new Date().toISOString(),
  };
  let fd: number;
  try {
    fd = fs.openSync(noticePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return verifyExistingNotice(noticePath, notice);
    return { ok: false, reason: "notice_write_failed" };
  }
  try {
    fs.writeFileSync(fd, JSON.stringify(notice, null, 2) + "\n");
    fs.fsyncSync(fd);
  } catch {
    // Only the file this call just created is removed, so a retry is not blocked by a partial claim.
    const created = fs.fstatSync(fd);
    fs.closeSync(fd);
    const now = lstatOrNull(noticePath);
    if (now !== null && now.dev === created.dev && now.ino === created.ino) fs.unlinkSync(noticePath);
    return { ok: false, reason: "notice_write_failed" };
  }
  fs.closeSync(fd);
  return { ok: true, created: true, path: noticePath };
}

function verifyExistingNotice(
  noticePath: string,
  expected: Record<string, unknown>,
): { ok: true; created: false; path: string } | { ok: false; reason: NoticeRefusal } {
  let st: fs.Stats | null;
  try {
    st = lstatOrNull(noticePath);
  } catch {
    return { ok: false, reason: "notice_unsafe" };
  }
  if (st === null || !isSmallRegular(st)) return { ok: false, reason: "notice_unsafe" };
  const bytes = readSmallRegular(noticePath, st);
  if (bytes === null) return { ok: false, reason: "notice_unsafe" };
  let existing: Record<string, unknown>;
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, reason: "notice_conflict" };
    existing = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "notice_conflict" };
  }
  const same =
    Object.keys(existing).sort().join(",") === NOTICE_KEYS.join(",") &&
    ["schema_version", "run_id", "assignment_id", "instance_id"].every((k) => existing[k] === expected[k]) &&
    samePackage(existing["package_identity"], expected["package_identity"] as PackageIdentity) &&
    isCanonicalIso(existing["noticed_at"]);
  return same ? { ok: true, created: false, path: noticePath } : { ok: false, reason: "notice_conflict" };
}
