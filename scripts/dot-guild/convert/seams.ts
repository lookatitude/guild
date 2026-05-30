/**
 * scripts/dot-guild/convert/seams.ts — real (node) implementations of the Fs +
 * Clock seams, plus the parse helpers (json / yaml / frontmatter schema_version).
 *
 * The probe + convert NEVER call node:fs directly — they go through the injected
 * Fs so W1d can drive everything in-memory (scrub.ts seam discipline).
 *
 * YAML: js-yaml is a transitive dependency (no @types ship for it), so it is
 * required at runtime and given a minimal local type. This mirrors scrub.ts's
 * runtime-require of docs-hygiene/scan.ts.
 */

import * as fs from "fs";
import * as crypto from "crypto";
import * as path from "path";
import type { Fs, Clock } from "./types";

// Minimal js-yaml surface (no @types/js-yaml installed). tsx/ts-jest resolve at
// runtime; the cast keeps tsc clean.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const yaml = require("js-yaml") as { load(s: string): unknown };

/** Real node-backed Fs. */
export const realFs: Fs = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p) => fs.readFileSync(p, "utf8"),
  readBytes: (p) => fs.readFileSync(p),
  writeFileSync: (p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data, "utf8");
  },
  writeBytes: (p, data) => {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  },
  mkdirSync: (p, opts) => {
    // recursive:false ⇒ non-recursive mkdir ⇒ throws EEXIST if taken (the lock).
    fs.mkdirSync(p, opts.recursive ? { recursive: true } : undefined);
  },
  rmFileSync: (p) => fs.rmSync(p, { force: true }),
  readdirSync: (p) =>
    fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    })),
  sha256: (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
};

/** Real wall-clock. */
export const realClock: Clock = {
  stamp: () => isoToStamp(new Date().toISOString()),
  iso: () => new Date().toISOString(),
};

/** "2026-05-30T13:41:15.123Z" → "20260530T134115Z". */
export function isoToStamp(iso: string): string {
  // YYYY-MM-DDTHH:MM:SS(.fff)Z → strip separators + fractional seconds.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso.replace(/[^0-9A-Za-z]/g, "");
  const [, y, mo, d, h, mi, s] = m;
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

/** Build a fixed-time Clock for tests. */
export function fixedClock(iso: string): Clock {
  return { stamp: () => isoToStamp(iso), iso: () => iso };
}

// ── Parse helpers ──────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

/** Strict JSON parse. */
export function parseJson(content: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(content) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** YAML parse via js-yaml (full nested support — NOT the flat-key shim). */
export function parseYaml(content: string): ParseResult {
  try {
    const value = yaml.load(content);
    return { ok: true, value: value === undefined ? null : value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Extract a `schema_version:` value from a markdown/frontmatter or yaml/json head.
 * Bounded: caller passes at most the first ~4 KiB (P10 head cap). Returns the raw
 * stamp string or null. Matches both `schema_version: x` (yaml) and
 * `"schema_version": "x"` (json) forms; quotes/whitespace tolerant.
 */
export function extractSchemaVersion(head: string): string | null {
  const m = head.match(/schema_version["'\s]*[:=]\s*["']?([A-Za-z0-9_.]+)/);
  return m ? m[1] : null;
}
