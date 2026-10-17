/**
 * PCL-FU-27 (task G03): detached release-evidence records are excluded from the
 * physical native Claude payload digest ONLY as physical regular files. Planted
 * symlink / FIFO / directory shapes at a recognized record path fail closed,
 * while recognized regular typed records keep the unchanged exclusion semantics
 * and every unrecognized file under the release directory stays digest-bound.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { computePhysicalNativeClaudePayloadDigest } from "./release-package-identity";

const RECORD_DIR = ".guild/artifacts/release/v9.9.9";
const RECORD = `${RECORD_DIR}/promotion.json`;

let root: string;

function write(relativePath: string, content: string): void {
  const absolute = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function basePackage(): void {
  write(".claude-plugin/plugin.json", JSON.stringify({ name: "guild", version: "9.9.9" }));
  write("commands/guild.md", "# guild\n");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "g03-release-identity-"));
  basePackage();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("detached release-evidence record exclusion (PCL-FU-27)", () => {
  test("a recognized regular typed record is excluded: digest equals the record-free tree", () => {
    const without = computePhysicalNativeClaudePayloadDigest(root);
    write(RECORD, JSON.stringify({ schema_version: "guild.release_promotion.v1" }));
    write(`${RECORD_DIR}/conformance.json`, JSON.stringify({ schema_version: "guild.release_conformance.v1" }));
    const withRecords = computePhysicalNativeClaudePayloadDigest(root);
    expect(withRecords).toBe(without);
  });

  test("an unrecognized file under the release directory remains digest-bound", () => {
    write(`${RECORD_DIR}/extra.json`, JSON.stringify({ planted: 1 }));
    const first = computePhysicalNativeClaudePayloadDigest(root);
    write(`${RECORD_DIR}/extra.json`, JSON.stringify({ planted: 2 }));
    const second = computePhysicalNativeClaudePayloadDigest(root);
    expect(first).not.toBe(second);
  });

  test("a symlink planted at a recognized record path fails closed (never followed, never skipped)", () => {
    write(`${RECORD_DIR}/target.json`, JSON.stringify({ real: true }));
    fs.symlinkSync(path.join(root, `${RECORD_DIR}/target.json`), path.join(root, RECORD));
    expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
      /detached release-evidence record is a symlink: \.guild\/artifacts\/release\/v9\.9\.9\/promotion\.json/,
    );
  });

  test("a symlink to an outside path at a recognized record path fails closed", () => {
    fs.mkdirSync(path.join(root, RECORD_DIR), { recursive: true });
    fs.symlinkSync("/etc/hosts", path.join(root, RECORD));
    expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
      /detached release-evidence record is a symlink/,
    );
  });

  test("a directory planted at a recognized record path fails closed", () => {
    fs.mkdirSync(path.join(root, RECORD), { recursive: true });
    expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
      /detached release-evidence record is not a regular file: \.guild\/artifacts\/release\/v9\.9\.9\/promotion\.json/,
    );
  });

  test("a FIFO planted at a recognized record path fails closed without hanging", () => {
    fs.mkdirSync(path.join(root, RECORD_DIR), { recursive: true });
    execFileSync("mkfifo", [path.join(root, RECORD)]);
    expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
      /detached release-evidence record is not a regular file/,
    );
  });

  // Deterministic TOCTOU controls: the record path is REPLACED between the
  // module's lstat (intercepted below, returning the pre-swap regular-file
  // stats) and its no-follow open, so only the open+fstat recheck can refuse.
  // Removing that guard block makes all three of these tests fail.
  function raceSwap(swap: () => void): ReturnType<typeof spyOn> {
    const realLstat = fs.lstatSync.bind(fs);
    let pending: (() => void) | null = swap;
    const spy = spyOn(fs, "lstatSync").mockImplementation(((target: fs.PathLike, opts?: fs.StatSyncOptions) => {
      const stats = realLstat(target, opts);
      if (pending !== null && typeof target === "string" && target.endsWith("promotion.json")) {
        const run = pending;
        pending = null;
        run();
      }
      return stats;
    }) as typeof fs.lstatSync);
    return spy;
  }

  test("race control: record replaced by a symlink after lstat fails closed (O_NOFOLLOW)", () => {
    write(RECORD, JSON.stringify({ schema_version: "guild.release_promotion.v1" }));
    write(`${RECORD_DIR}/target.json`, JSON.stringify({ real: true }));
    const absolute = path.join(root, RECORD);
    const spy = raceSwap(() => {
      fs.rmSync(absolute);
      fs.symlinkSync(path.join(root, `${RECORD_DIR}/target.json`), absolute);
    });
    try {
      expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(/ELOOP|symlink/);
    } finally {
      spy.mockRestore();
    }
  });

  test("race control: record replaced by a directory after lstat fails closed via fstat recheck", () => {
    write(RECORD, JSON.stringify({ schema_version: "guild.release_promotion.v1" }));
    const absolute = path.join(root, RECORD);
    const spy = raceSwap(() => {
      fs.rmSync(absolute);
      fs.mkdirSync(absolute);
    });
    try {
      expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
        /detached release-evidence record is not a regular file/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("race control: record replaced by a FIFO after lstat fails closed without hanging (O_NONBLOCK)", () => {
    write(RECORD, JSON.stringify({ schema_version: "guild.release_promotion.v1" }));
    const absolute = path.join(root, RECORD);
    const spy = raceSwap(() => {
      fs.rmSync(absolute);
      execFileSync("mkfifo", [absolute]);
    });
    try {
      const startedAt = Date.now();
      expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
        /detached release-evidence record is not a regular file/,
      );
      // Bounded completion: a blocking FIFO open would hang far past this.
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      spy.mockRestore();
    }
  });

  test("non-record payload symlinks still refuse with the existing package error", () => {
    fs.symlinkSync(path.join(root, "commands/guild.md"), path.join(root, "commands/alias.md"));
    expect(() => computePhysicalNativeClaudePayloadDigest(root)).toThrow(
      /native Claude package contains a symlink: commands\/alias\.md/,
    );
  });
});
