/**
 * tests/contracts/_helpers.ts
 *
 * Shared harness for the T2-tdd-contract-fixtures lane
 * (run-20260730-131020-dynamic-host-model-routing).
 *
 * CHALLENGER DISCIPLINE (lane contract):
 *  - Suites in this directory assert the FROZEN contracts under
 *    .guild/runs/run-20260730-131020-dynamic-host-model-routing/contracts/
 *    AGAINST the current implementation. Tests that target a live defect are
 *    EXPECTED TO FAIL until the owning runtime lane (T2b/T3/T3b/T4/T5/T6)
 *    ships. They must fail for the intended reason, never vacuously.
 *  - Contract surfaces that do not exist yet fail via requireContractModule's
 *    explicit CONTRACT-MODULE-MISSING error — never describe.skip (skipped
 *    tests escape gates).
 *  - Every failing family carries an anti-vacuity CONTROL test (tagged
 *    "[control]") that passes today and proves the assertion logic can
 *    distinguish known-good from known-bad.
 *  - Determinism: no wall-clock dependence, no network, no unseeded
 *    randomness (seeded mulberry32 only).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

/** Absolute plugin repo root (tests/ lives directly under it). */
export const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Require a contract-owned runtime module by repo-relative path. When the
 * module does not exist yet, throw a structured, intended failure so the
 * suite fails TODAY with an unambiguous reason (failing-by-design pattern —
 * the replacement for describe.skip).
 */
export function requireContractModule<T = Record<string, unknown>>(
  repoRelPath: string,
  owningLane: string
): T {
  const abs = path.join(PLUGIN_ROOT, repoRelPath);
  const candidates = [abs, `${abs}.ts`];
  if (!candidates.some((c) => fs.existsSync(c))) {
    throw new Error(
      `CONTRACT-MODULE-MISSING: ${repoRelPath} is not implemented yet ` +
        `(owning lane: ${owningLane}). This failure is the lane-T2 ` +
        `failing-by-design signal — it clears when the runtime lane lands.`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(abs) as T;
}

/** True when the module exists on disk (used to keep controls honest). */
export function contractModuleExists(repoRelPath: string): boolean {
  const abs = path.join(PLUGIN_ROOT, repoRelPath);
  return fs.existsSync(abs) || fs.existsSync(`${abs}.ts`);
}

// ── Deterministic randomness (mulberry32) ────────────────────────────────────

/** Seeded PRNG — deterministic across runs/platforms; no Math.random. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic integer in [0, n) from a seeded rng. */
export function rngInt(rng: () => number, n: number): number {
  return Math.floor(rng() * n);
}

// ── Temp workspaces ──────────────────────────────────────────────────────────

/** Fresh throwaway workspace root with a .guild/ scaffold. */
export function mkTmpWorkspace(prefix = "guild-contract-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  return root;
}

// ── Canonical hashing (team-contracts §1 reference implementation) ───────────

/**
 * Reference canonical-YAML serialization per team-contracts §1: keys sorted in
 * Unicode CODE-POINT order at every level (NOT UTF-16 code-unit order — an
 * astral key sorts by its code point), block style, 2-space indent, plain
 * scalars where legal otherwise DOUBLE-quoted, LF, one trailing newline.
 *
 * REWORK ROUND 2 (T2B-R1-F1): this is an INDEPENDENT second implementation of
 * the §1 spec — written separately from the runtime serializer
 * (src/modules/teams/workflows/canonical-hash.ts) so the two can cross-check
 * each other; both are pinned to hand-authored golden bytes in the c12 suite.
 * The previous js-yaml delegation implemented UTF-16 key ordering and a
 * single-quoted fallback, both §1 violations.
 */
export function canonicalYaml(value: unknown): string {
  const lines = refNodeLines(value, 0);
  return lines.map((l) => `${l}\n`).join("");
}

/** Code-point comparator built on the code-point iterator (independent shape). */
function refCodePointCompare(a: string, b: string): number {
  const as = Array.from(a);
  const bs = Array.from(b);
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const ca = as[i].codePointAt(0) as number;
    const cb = bs[i].codePointAt(0) as number;
    if (ca !== cb) return ca - cb;
  }
  return as.length - bs.length;
}

const REF_PRINTABLE = (c: number): boolean =>
  (c >= 0x20 && c <= 0x7e) ||
  (c >= 0xa0 && c <= 0xd7ff) ||
  (c >= 0xe000 && c <= 0xfffd) ||
  (c >= 0x10000 && c <= 0x10ffff);

const REF_AMBIGUOUS: readonly RegExp[] = [
  /^(?:null|Null|NULL|~)$/,
  /^(?:true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/,
  /^[-+]?(?:\d[\d_]*)$/,
  /^[-+]?0[xX][0-9a-fA-F_]+$/,
  /^[-+]?0[oO]?[0-7_]+$/,
  /^[-+]?0[bB][01_]+$/,
  /^[-+]?(?:\d[\d_]*\.[\d_]*|\.\d[\d_]*)(?:[eE][-+]?\d+)?$/,
  /^[-+]?\d[\d_]*(?:[eE][-+]?\d+)$/,
  /^[-+]?\.(?:inf|Inf|INF)$/,
  /^\.(?:nan|NaN|NAN)$/,
  /^[-+]?\d[\d_]*(?::[0-5]?\d)+(?:\.[\d_]*)?$/,
  /^\d{4}-\d{1,2}-\d{1,2}(?:[Tt\s].*)?$/,
];

function refPlainSafe(s: string): boolean {
  if (s.length === 0) return false;
  if (Array.from(s).some((ch) => !REF_PRINTABLE(ch.codePointAt(0) as number))) return false;
  if (s.startsWith(" ") || s.endsWith(" ")) return false;
  if ("-?:,[]{}#&*!|>'\"%@` ".includes(s[0])) return false;
  if (s.includes(": ") || s.endsWith(":") || s.includes(" #")) return false;
  return !REF_AMBIGUOUS.some((re) => re.test(s));
}

const REF_DQ: Record<number, string> = {
  0: "\\0", 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f",
  13: "\\r", 27: "\\e", 34: '\\"', 92: "\\\\",
};

function refDoubleQuote(s: string): string {
  const body = Array.from(s)
    .map((ch) => {
      const c = ch.codePointAt(0) as number;
      if (REF_DQ[c] !== undefined) return REF_DQ[c];
      if (REF_PRINTABLE(c)) return ch;
      const h = c.toString(16).toUpperCase();
      if (c <= 0xff) return `\\x${h.padStart(2, "0")}`;
      if (c <= 0xffff) return `\\u${h.padStart(4, "0")}`;
      return `\\U${h.padStart(8, "0")}`;
    })
    .join("");
  return `"${body}"`;
}

function refScalar(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("reference canonicalYaml: non-finite number");
    return String(v);
  }
  if (typeof v === "string") return refPlainSafe(v) ? v : refDoubleQuote(v);
  throw new Error(`reference canonicalYaml: unrepresentable ${typeof v}`);
}

const refIsScalar = (v: unknown): boolean =>
  v === null || typeof v === "boolean" || typeof v === "number" || typeof v === "string";

/** Render a node to an array of complete lines at `depth` (lines-array shape). */
function refNodeLines(value: unknown, depth: number): string[] {
  const pad = "  ".repeat(depth);
  if (refIsScalar(value)) return [`${pad}${refScalar(value)}`];
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    return value.flatMap((item) => {
      if (refIsScalar(item)) return [`${pad}- ${refScalar(item)}`];
      const child = refNodeLines(item, depth + 1);
      return child.map((line, i) => (i === 0 ? `${pad}- ${line.slice(pad.length + 2)}` : line));
    });
  }
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort(refCodePointCompare);
    if (keys.length === 0) return [`${pad}{}`];
    return keys.flatMap((k) => {
      const v = o[k];
      if (v === undefined) throw new Error(`reference canonicalYaml: undefined at ${JSON.stringify(k)}`);
      const keyTok = refScalar(k);
      if (refIsScalar(v)) return [`${pad}${keyTok}: ${refScalar(v)}`];
      if (Array.isArray(v) && v.length === 0) return [`${pad}${keyTok}: []`];
      if (!Array.isArray(v) && Object.keys(v as object).length === 0) return [`${pad}${keyTok}: {}`];
      return [`${pad}${keyTok}:`, ...refNodeLines(v, depth + 1)];
    });
  }
  throw new Error("reference canonicalYaml: unrepresentable document value");
}

/** sha256 hex over a string. */
export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Reference self-referential artifact hash (team-contracts §1): sha256 over
 * canonical YAML of the artifact WITH the hash field removed (not blanked).
 */
export function selfRefHash(
  artifact: Record<string, unknown>,
  hashField: string
): string {
  const clone: Record<string, unknown> = { ...artifact };
  delete clone[hashField];
  return sha256(canonicalYaml(clone));
}

// ── Frozen-contract vocabulary (shared fixture tables) ───────────────────────

export const EVIDENCE_STATES = [
  "available",
  "advertised",
  "unknown",
  "unavailable",
] as const;

export const PURPOSES = [
  "general",
  "implementation",
  "planning",
  "research",
  "advisory",
  "adversarial",
  "security",
  "adversarial-security",
] as const;

export const REVIEW_PURPOSES = [
  "advisory",
  "adversarial",
  "security",
  "adversarial-security",
] as const;

/** model_resolution §4 — closed failure taxonomy with chain-advance verdicts. */
export const FAILURE_TAXONOMY: ReadonlyArray<{
  failure_class: string;
  advances: boolean;
}> = [
  { failure_class: "model_overloaded", advances: true },
  { failure_class: "model_unavailable", advances: true },
  { failure_class: "server_nonretryable", advances: true },
  { failure_class: "auth_error", advances: false },
  { failure_class: "billing_error", advances: false },
  { failure_class: "rate_limited", advances: false },
  { failure_class: "request_invalid", advances: false },
  { failure_class: "transport_error", advances: false },
  { failure_class: "policy_refusal", advances: false },
];

/** session_context §2 target tuple components — ALL required for cache keys. */
export const TARGET_TUPLE_COMPONENTS = [
  "target_id",
  "family",
  "surface",
  "provider_kind",
  "auth_mode",
  "account_fingerprint",
  "endpoint_fingerprint",
  "org_fingerprint",
  "tool_version",
  "adapter_id",
  "adapter_version",
  "run_scope",
] as const;

/** A fully-populated reference execution-target tuple for key-vector fixtures. */
export function referenceTargetTuple(): Record<string, string> {
  return {
    v: "guild.model_catalog.v1",
    target_id: "claude-api",
    family: "claude",
    surface: "api",
    provider_kind: "anthropic_api",
    auth_mode: "api_key",
    account_fingerprint: "fp-acct-0001",
    endpoint_fingerprint: "fp-endp-0001",
    org_fingerprint: "fp-org-0001",
    tool_version: "claude-cli 2.1.220",
    adapter_id: "claude-api-models",
    adapter_version: "1.0.0",
    run_scope: "shared",
  };
}

/** catalog §7 reference cache-key builder (canonical YAML over the full tuple). */
export function referenceCacheKey(tuple: Record<string, string>): string {
  return sha256(canonicalYaml(tuple));
}
