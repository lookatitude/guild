#!/usr/bin/env npx tsx
/**
 * scripts/dot-guild/migrate.ts — atomic mover with SHA-256 round-trip verification.
 *
 * Copies <src> → <dst> (file-by-file); hashes each source file before copy and
 * destination file after; asserts match. If all match, removes src. Aborts on mismatch.
 * Idempotent: if src absent, exit 0 (already moved).
 *
 * Usage:
 *   npx tsx plugin/scripts/dot-guild/migrate.ts --src=<path> --dst=<path> [--dry-run]
 *
 * Lane C calls this for SC-5/SC-6 relocations. Future relocations use this tool.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkDir(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

interface FileMoveResult { rel: string; srcHash: string; dstHash: string; ok: boolean; }

function migrate(src: string, dst: string, dryRun: boolean): boolean {
  const srcAbs = path.resolve(src);
  const dstAbs = path.resolve(dst);
  const files = walkDir(srcAbs);
  const results: FileMoveResult[] = [];

  for (const srcFile of files) {
    const rel = path.relative(srcAbs, srcFile);
    const dstFile = path.join(dstAbs, rel);
    const srcHash = sha256File(srcFile);

    if (dryRun) {
      process.stdout.write(`  [dry-run] ${rel}: src-sha256=${srcHash.slice(0, 12)}...\n`);
      results.push({ rel, srcHash, dstHash: "(dry-run)", ok: true });
      continue;
    }

    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    fs.copyFileSync(srcFile, dstFile);
    const dstHash = sha256File(dstFile);
    const ok = srcHash === dstHash;
    results.push({ rel, srcHash, dstHash, ok });

    if (!ok) process.stderr.write(`[migrate] HASH MISMATCH: ${rel} src=${srcHash} dst=${dstHash}\n`);
    else process.stderr.write(`[migrate] OK: ${rel} (sha256 verified)\n`);
  }

  const allOk = results.every(r => r.ok);
  if (!dryRun) {
    if (!allOk) {
      process.stderr.write(`[migrate] ABORTING source removal — hash mismatch(es). Dst at ${dstAbs} left for inspection.\n`);
    } else {
      process.stderr.write(`[migrate] All ${results.length} file(s) verified. Removing ${srcAbs}\n`);
      fs.rmSync(srcAbs, { recursive: true, force: true });
    }
  }
  return allOk;
}

function main(): void {
  const args = process.argv.slice(2);
  const srcArg = args.find(a => a.startsWith("--src="));
  const dstArg = args.find(a => a.startsWith("--dst="));
  const dryRun = args.includes("--dry-run");

  if (!srcArg || !dstArg) {
    process.stderr.write("Usage: npx tsx migrate.ts --src=<path> --dst=<path> [--dry-run]\n");
    process.exit(1);
  }

  const src = srcArg.split("=").slice(1).join("=");
  const dst = dstArg.split("=").slice(1).join("=");

  if (!fs.existsSync(src)) {
    process.stderr.write(`[migrate] Source not found: ${src} — nothing to do.\n`);
    process.exit(0);
  }

  process.stderr.write(`[migrate] ${dryRun ? "[dry-run] " : ""}${src} → ${dst}\n`);
  const ok = migrate(src, dst, dryRun);
  const count = dryRun ? "would move" : "moved";
  process.stdout.write(`migrate: ${count} files from ${src} to ${dst}\n`);
  if (!ok) process.exit(1);
}

main();
