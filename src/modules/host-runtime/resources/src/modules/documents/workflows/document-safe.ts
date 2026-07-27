/**
 * src/modules/documents/workflows/document-safe.ts
 *
 * Total, hostile-value-proof primitives for the documents module (BF-02).
 *
 * Every function here is TOTAL: it returns an explicit result for any input,
 * including inputs designed to attack the reader — throwing getters, proxies
 * with throwing `get`/`has`/`ownKeys` traps, sparse arrays, cycles, hostile
 * `toJSON`, revoked proxies, and absurd depth/width.
 *
 * Two rules keep that property:
 *
 *   1. Untrusted values are only ever touched through the `safe*` helpers,
 *      which wrap every observable operation in try/catch. In particular the
 *      module never uses `in`, bare `Object.keys`, `forEach`/`map` (which skip
 *      sparse holes), or `JSON.stringify` (which invokes `toJSON`) on
 *      untrusted input.
 *   2. Canonical JSON is emitted by an explicit walker, so serialization can
 *      never re-enter user code.
 */

import { createHash } from "node:crypto";

/** Error namespace shared by every documents-module diagnostic. */
export const DOCUMENTS_ERROR_NAMESPACE = "guild.documents";

/** A single deterministic diagnostic. Ordering is stabilized before return. */
export interface DocumentIssue {
  path: string;
  code: string;
  message: string;
}

// ── Bounds ───────────────────────────────────────────────────────────────────
// Bounds exist so a hostile input costs a deterministic error, not unbounded
// work. They are part of the contract, not tuning knobs.

export const MAX_CANONICAL_DEPTH = 32;
export const MAX_CANONICAL_NODES = 20_000;
export const MAX_ARRAY_ITEMS = 512;
export const MAX_OBJECT_KEYS = 128;
export const MAX_STRING_LENGTH = 20_000;
export const MAX_ISSUES = 64;

// ── Safe access ──────────────────────────────────────────────────────────────

export type SafeRead =
  | { ok: true; value: unknown }
  | { ok: false; reason: string };

/** Read a property without ever propagating a hostile getter/proxy throw. */
export function safeGet(target: unknown, key: string): SafeRead {
  try {
    return { ok: true, value: (target as Record<string, unknown>)[key] };
  } catch {
    return { ok: false, reason: "property read threw" };
  }
}

/** `Object.keys` behind a guard — an `ownKeys` trap may throw or be revoked. */
export function safeOwnKeys(
  target: unknown
): { ok: true; keys: string[] } | { ok: false; reason: string } {
  try {
    return { ok: true, keys: Object.keys(target as object) };
  } catch {
    return { ok: false, reason: "own-key enumeration threw" };
  }
}

/**
 * Own-property test that never uses `in` (a `has` trap can throw) and never
 * consults the prototype chain. A sparse array hole answers `false` here,
 * which is what makes hole detection possible.
 */
export function safeHasOwn(target: unknown, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(target as object, key);
  } catch {
    return false;
  }
}

/** `Array.isArray` behind a guard (a revoked proxy throws). */
export function safeIsArray(value: unknown): boolean {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

/** Array length as a validated non-negative integer, or an explicit reason. */
export function safeArrayLength(
  value: unknown
): { ok: true; length: number } | { ok: false; reason: string } {
  const read = safeGet(value, "length");
  if (!read.ok) return { ok: false, reason: read.reason };
  const length = read.value;
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    return { ok: false, reason: "array length is not a non-negative integer" };
  }
  return { ok: true, length };
}

/** True for non-null, non-array objects — without touching any trap. */
export function isObjectLike(value: unknown): boolean {
  return typeof value === "object" && value !== null && !safeIsArray(value);
}

// ── Issue helpers ────────────────────────────────────────────────────────────

export function issue(path: string, code: string, message: string): DocumentIssue {
  return { path, code, message: `${DOCUMENTS_ERROR_NAMESPACE}: ${message}` };
}

/** Append an issue unless the bound is already reached (keeps output bounded). */
export function pushIssue(
  issues: DocumentIssue[],
  path: string,
  code: string,
  message: string
): void {
  if (issues.length >= MAX_ISSUES) return;
  issues.push(issue(path, code, message));
}

/** Deterministic ordering: by path, then code, then message. */
export function sortIssues(issues: readonly DocumentIssue[]): DocumentIssue[] {
  return [...issues].sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) ||
      (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
  );
}

// ── Canonical JSON ───────────────────────────────────────────────────────────

export type CanonicalJsonResult =
  | { ok: true; json: string }
  | { ok: false; errors: DocumentIssue[] };

/**
 * Deterministic canonical JSON with lexicographically sorted object keys.
 *
 * Total by construction — an unrepresentable or hostile value yields an
 * explicit error list rather than a throw. Notably this walker never invokes
 * `toJSON`, never skips sparse holes, and rejects `undefined` outright instead
 * of silently dropping the key the way `JSON.stringify` would.
 */
export function canonicalDocumentJson(value: unknown): CanonicalJsonResult {
  const errors: DocumentIssue[] = [];
  const active = new Set<unknown>();
  let nodes = 0;

  const walk = (node: unknown, path: string, depth: number): string | null => {
    if (errors.length >= MAX_ISSUES) return null;
    if (depth > MAX_CANONICAL_DEPTH) {
      pushIssue(errors, path, "depth_exceeded", `value nests deeper than ${MAX_CANONICAL_DEPTH}`);
      return null;
    }
    nodes += 1;
    if (nodes > MAX_CANONICAL_NODES) {
      pushIssue(errors, path, "size_exceeded", `value exceeds ${MAX_CANONICAL_NODES} nodes`);
      return null;
    }

    if (node === null) return "null";

    const kind = typeof node;
    if (kind === "boolean") return node === true ? "true" : "false";
    if (kind === "string") {
      const text = node as string;
      if (text.length > MAX_STRING_LENGTH) {
        pushIssue(errors, path, "string_too_long", `string exceeds ${MAX_STRING_LENGTH} characters`);
        return null;
      }
      // Safe: `node` is a primitive string, so no user code can run here.
      return JSON.stringify(text);
    }
    if (kind === "number") {
      const num = node as number;
      if (!Number.isFinite(num)) {
        pushIssue(errors, path, "non_finite_number", "numbers must be finite");
        return null;
      }
      return Object.is(num, -0) ? "0" : String(num);
    }
    if (kind !== "object") {
      pushIssue(errors, path, "unsupported_type", `${kind} has no canonical JSON form`);
      return null;
    }

    if (active.has(node)) {
      pushIssue(errors, path, "cycle_detected", "value contains a cycle");
      return null;
    }
    active.add(node);
    try {
      if (safeIsArray(node)) {
        const length = safeArrayLength(node);
        if (!length.ok) {
          pushIssue(errors, path, "array_length_unreadable", length.reason);
          return null;
        }
        if (length.length > MAX_ARRAY_ITEMS) {
          pushIssue(errors, path, "array_too_long", `array exceeds ${MAX_ARRAY_ITEMS} items`);
          return null;
        }
        const parts: string[] = [];
        for (let index = 0; index < length.length; index += 1) {
          const key = String(index);
          if (!safeHasOwn(node, key)) {
            pushIssue(errors, `${path}[${index}]`, "sparse_array_hole", "array holes have no canonical JSON form");
            return null;
          }
          const read = safeGet(node, key);
          if (!read.ok) {
            pushIssue(errors, `${path}[${index}]`, "property_read_threw", read.reason);
            return null;
          }
          const encoded = walk(read.value, `${path}[${index}]`, depth + 1);
          if (encoded === null) return null;
          parts.push(encoded);
        }
        return `[${parts.join(",")}]`;
      }

      const keys = safeOwnKeys(node);
      if (!keys.ok) {
        pushIssue(errors, path, "own_keys_threw", keys.reason);
        return null;
      }
      if (keys.keys.length > MAX_OBJECT_KEYS) {
        pushIssue(errors, path, "object_too_wide", `object exceeds ${MAX_OBJECT_KEYS} keys`);
        return null;
      }
      const sorted = [...keys.keys].sort();
      const parts: string[] = [];
      for (const key of sorted) {
        const read = safeGet(node, key);
        if (!read.ok) {
          pushIssue(errors, `${path}.${key}`, "property_read_threw", read.reason);
          return null;
        }
        if (read.value === undefined) {
          pushIssue(errors, `${path}.${key}`, "undefined_value", "undefined has no canonical JSON form");
          return null;
        }
        const encoded = walk(read.value, `${path}.${key}`, depth + 1);
        if (encoded === null) return null;
        parts.push(`${JSON.stringify(key)}:${encoded}`);
      }
      return `{${parts.join(",")}}`;
    } finally {
      active.delete(node);
    }
  };

  let json: string | null;
  try {
    json = walk(value, "$", 0);
  } catch {
    // Defence in depth: the walker is guarded end to end, but a decision this
    // module makes must never be able to escape as an exception.
    pushIssue(errors, "$", "internal_guard", "canonical JSON walk was interrupted");
    json = null;
  }
  if (json === null) {
    if (errors.length === 0) {
      pushIssue(errors, "$", "internal_guard", "canonical JSON walk produced no output");
    }
    return { ok: false, errors: sortIssues(errors) };
  }
  return { ok: true, json };
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/** `sha256:<64 lowercase hex>` over the UTF-8 bytes of `text`. */
export function sha256Of(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

export const DOCUMENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type DocumentHashResult =
  | { ok: true; hash: string }
  | { ok: false; errors: DocumentIssue[] };

/** Content hash of any canonicalizable value. Total. */
export function hashCanonicalValue(value: unknown): DocumentHashResult {
  const canonical = canonicalDocumentJson(value);
  if (!canonical.ok) return { ok: false, errors: canonical.errors };
  return { ok: true, hash: sha256Of(canonical.json) };
}

// ── Freezing ─────────────────────────────────────────────────────────────────

/**
 * Deep-freeze a value the module itself constructed. Only ever called on
 * normalized output, never on untrusted input.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
