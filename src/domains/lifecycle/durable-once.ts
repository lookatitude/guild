/**
 * src/domains/lifecycle/durable-once.ts — contained write-once records under a
 * project's `.guild/` for R04 closure and transfer journals.
 *
 * A record is fsynced to a private temp file and published with link(2), so a
 * crash leaves either the whole record or nothing, and two writers racing for
 * one path cannot both win. Every path is checked with the kernel containment
 * helpers under the physical policy (no symlink below the root) and reads use
 * O_NOFOLLOW with a size bound.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { checkContained, isRefused, prepareContainedWrite } from "../kernel";

export const MAX_RECORD_BYTES = 1 << 20;

export class DurableOnceError extends Error {
  constructor(readonly code: "containment_refused" | "io_failed", detail: string) {
    super(`durable record refused (${code}): ${detail}`);
    this.name = "DurableOnceError";
  }
}

export function sha256Hex(bytes: Buffer | string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}
export const hashOf = (bytes: Buffer | string): string => `sha256:${sha256Hex(bytes)}`;

/** Deterministic JSON: object keys sorted, arrays in order. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

function fsyncDir(dir: string): void {
  let fd: number | null = null;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch {
    /* directory fsync is unsupported on some filesystems */
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function readFd(fd: number, max: number): string | null {
  const st = fs.fstatSync(fd);
  if (!st.isFile() || st.size > max) return null;
  const buf = Buffer.alloc(st.size);
  let off = 0;
  while (off < st.size) {
    const n = fs.readSync(fd, buf, off, st.size - off, off);
    if (n <= 0) break;
    off += n;
  }
  return buf.subarray(0, off).toString("utf8");
}

/** Read a contained regular file; null when absent, a non-file, oversized or refused by containment. */
export function readOnce(root: string, rel: string, max = MAX_RECORD_BYTES): string | null {
  const r = checkContained(root, rel, { policy: "physical" });
  if (isRefused(r)) return null;
  let fd: number;
  try {
    fd = fs.openSync(r.realPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  } catch (e) {
    const c = (e as NodeJS.ErrnoException).code;
    if (c === "ENOENT" || c === "ELOOP" || c === "ENOTDIR") return null;
    throw e;
  }
  try {
    return readFd(fd, max);
  } finally {
    fs.closeSync(fd);
  }
}

/** Names in a contained directory, sorted; empty when absent. Bounded by `max`. */
export function listOnce(root: string, rel: string, max = 10_000): string[] {
  const r = checkContained(root, rel, { policy: "physical" });
  if (isRefused(r)) return [];
  let names: string[];
  try {
    if (!fs.lstatSync(r.realPath).isDirectory()) return [];
    names = fs.readdirSync(r.realPath);
  } catch {
    return [];
  }
  if (names.length > max) throw new DurableOnceError("io_failed", `${rel} holds more than ${max} entries`);
  return names.filter((n) => !n.startsWith(".")).sort();
}

/**
 * Publish `bytes` at `rel` once. Returns "created" when this call linked it,
 * otherwise the bytes already there (which may differ; the caller decides).
 * `beforeLink` runs after fsync and immediately before link(2).
 */
export function publishOnce(root: string, rel: string, bytes: Buffer, beforeLink?: () => void): { created: true } | { created: false; existing: string | null } {
  if (bytes.length > MAX_RECORD_BYTES) throw new DurableOnceError("io_failed", `${rel} exceeds the size bound`);
  const prepared = prepareContainedWrite(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(prepared)) throw new DurableOnceError("containment_refused", `${rel} (${prepared.code})`);
  const final = prepared.realPath;
  const tmp = path.join(path.dirname(final), `.${path.basename(final)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  let created = false;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    try {
      let off = 0;
      while (off < bytes.length) {
        const n = fs.writeSync(fd, bytes, off, bytes.length - off);
        if (n <= 0) throw new DurableOnceError("io_failed", "short write");
        off += n;
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    beforeLink?.();
    try {
      fs.linkSync(tmp, final);
      created = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  fsyncDir(path.dirname(final));
  const after = checkContained(root, rel, { policy: "physical", requireRegularFileLeaf: true });
  if (isRefused(after) || after.realPath !== final) {
    if (created) fs.rmSync(final, { force: true });
    throw new DurableOnceError("containment_refused", `${rel}: containment changed during publication`);
  }
  if (created) return { created: true };
  return { created: false, existing: readOnce(root, rel) };
}
