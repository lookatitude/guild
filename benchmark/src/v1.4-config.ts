// v1.4.0 adversarial-loops configuration: CLI flag parsers + env mirrors.
//
// Owners:
//   - T3a-backend-config (this file): parsing + invalid-value rejection.
//   - T3b/T3c (parallel lanes): consume the resolved values via the
//     exported resolver functions.
//
// Contracts (verbatim from the architect's bundle):
//   - `--loops` / `GUILD_LOOPS`           — single keyword OR comma-list
//   - `--loop-cap` / `GUILD_LOOP_CAP`     — positive integer ≤ 256
//   - `--auto-approve` / `GUILD_AUTO_APPROVE` — none|spec-and-plan|implementation|all
//   - `GUILD_LOG_RETENTION`               — "unlimited" or "<N>MB"/"<N>GB"
//   - `GUILD_STATUSLINE`                  — "0"|"1" (empty string treated as "0")
//
// CLI overrides env. Env-only vars (`GUILD_LOG_RETENTION`, `GUILD_STATUSLINE`)
// have no CLI flag in v1.4.0; the resolvers accept env-only.
//
// Error surface: every parser throws `ConfigError` whose `.message` is the
// EXACT stderr line from the spec. The CLI catches it, prints to stderr,
// and exits 2.

/** All Guild v1.4 env var names referenced verbatim for grep-evidence. */
export const ENV_GUILD_LOOPS = "GUILD_LOOPS";
export const ENV_GUILD_LOOP_CAP = "GUILD_LOOP_CAP";
export const ENV_GUILD_AUTO_APPROVE = "GUILD_AUTO_APPROVE";
export const ENV_GUILD_LOG_RETENTION = "GUILD_LOG_RETENTION";
export const ENV_GUILD_STATUSLINE = "GUILD_STATUSLINE";

/** Default values per architect contract. */
export const DEFAULT_LOOPS = "none" as const;
export const DEFAULT_LOOP_CAP = 16;
export const DEFAULT_AUTO_APPROVE = "none" as const;
export const DEFAULT_LOG_RETENTION = "unlimited" as const;
export const DEFAULT_STATUSLINE = false as const;

export const LOOP_CAP_MAX = 256;

/** Source attribution returned alongside every resolved value. */
export type ConfigSource = "cli" | "env" | "default";

export interface Resolved<T> {
  value: T;
  source: ConfigSource;
}

/** Carries the architect's exact stderr message. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
// --loops / GUILD_LOOPS
// ──────────────────────────────────────────────────────────────────────────

/** The 3 valid layer tokens in a comma-list. */
export const LOOP_LAYERS = ["spec", "plan", "implementation"] as const;
export type LoopLayer = (typeof LOOP_LAYERS)[number];

/** Single-keyword sentinels (cannot appear in a comma-list). */
export const LOOP_SENTINELS = ["none", "all"] as const;
export type LoopSentinel = (typeof LOOP_SENTINELS)[number];

/**
 * Parsed --loops value.
 *  - "none"  → no loops active (default)
 *  - "all"   → all 3 layers active
 *  - "spec" / "plan" / "implementation" / comma-list → explicit layer set
 *
 * Always normalised: kind="set" carries a deduped, ordered subset of LOOP_LAYERS.
 */
export type LoopsConfig =
  | { kind: "none" }
  | { kind: "all" }
  | { kind: "set"; layers: LoopLayer[] };

/**
 * The architect contract's literal stderr text for `--loops` invalid
 * values, per `v1.4-claude-plugin-surface-audit.md` line 401-402:
 *
 *   "--loops must be one of none|spec|plan|implementation|all or a
 *    comma-list of {spec,plan,implementation}"
 *
 * Tests pin this string with exact-match (not substring). We prefix
 * with `error:` per Unix CLI convention so operators see a clear
 * error indicator on the first line of stderr.
 */
const LOOPS_INVALID_MSG = (raw: string): string =>
  `error: --loops value '${raw}' is invalid; ` +
  `--loops must be one of none|spec|plan|implementation|all or a comma-list of {spec,plan,implementation}`;

/**
 * Parse a `--loops` argument or `GUILD_LOOPS` env value.
 * @throws ConfigError with the architect's exact stderr message on any rejection.
 *
 * Reject reasons (all surface the same canonical error message):
 *   - `security` (anywhere)
 *   - `none,*` or `*,none` (sentinel mixed in a list)
 *   - `all,*`  or `*,all`
 *   - empty token (`,foo` / `foo,,bar` / `foo,`)
 *   - unknown token (`xxx`, `random,plan`)
 *   - whitespace-only
 */
export function parseLoops(raw: string): LoopsConfig {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigError(LOOPS_INVALID_MSG(raw ?? ""));
  }
  // Single-keyword path. Sentinels are accepted only as standalone tokens.
  if (!raw.includes(",")) {
    if (raw === "none") return { kind: "none" };
    if (raw === "all") return { kind: "all" };
    if ((LOOP_LAYERS as readonly string[]).includes(raw)) {
      return { kind: "set", layers: [raw as LoopLayer] };
    }
    throw new ConfigError(LOOPS_INVALID_MSG(raw));
  }
  // Comma-list path. Each token must be a layer; sentinels rejected; security rejected.
  const tokens = raw.split(",");
  const seen = new Set<LoopLayer>();
  for (const tok of tokens) {
    if (tok.length === 0) {
      throw new ConfigError(LOOPS_INVALID_MSG(raw));
    }
    if (!(LOOP_LAYERS as readonly string[]).includes(tok)) {
      // Catches `none`, `all`, `security`, anything else.
      throw new ConfigError(LOOPS_INVALID_MSG(raw));
    }
    seen.add(tok as LoopLayer);
  }
  // Preserve the canonical layer order (spec, plan, implementation) for
  // determinism; consumers should not depend on input order.
  const layers = LOOP_LAYERS.filter((l) => seen.has(l));
  return { kind: "set", layers };
}

/**
 * Resolve the --loops setting from CLI flag → env → default ("none").
 * CLI value is the raw string from argv (already validated upstream is fine,
 * but we re-validate to keep this resolver independent).
 */
export function resolveLoops(
  cliValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Resolved<LoopsConfig> {
  if (cliValue !== undefined) {
    return { value: parseLoops(cliValue), source: "cli" };
  }
  const envValue = env[ENV_GUILD_LOOPS];
  if (envValue !== undefined && envValue.length > 0) {
    return { value: parseLoops(envValue), source: "env" };
  }
  return { value: { kind: "none" }, source: "default" };
}

// ──────────────────────────────────────────────────────────────────────────
// --loop-cap / GUILD_LOOP_CAP
// ──────────────────────────────────────────────────────────────────────────

const LOOP_CAP_INVALID_MSG = "error: --loop-cap must be a positive integer ≤ 256";

/**
 * Parse a `--loop-cap` argument or `GUILD_LOOP_CAP` env value.
 * Accepts only base-10 positive integers in the range [1, 256].
 * Rejects: non-integer, negative, zero, > 256, empty string, whitespace,
 * decimal, hex, sign-prefixed, scientific notation.
 * @throws ConfigError with the architect's exact stderr message.
 */
export function parseLoopCap(raw: string): number {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigError(LOOP_CAP_INVALID_MSG);
  }
  // Base-10 unsigned integer only — no sign, no decimal, no hex, no exponent.
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigError(LOOP_CAP_INVALID_MSG);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0 || n > LOOP_CAP_MAX) {
    throw new ConfigError(LOOP_CAP_INVALID_MSG);
  }
  return n;
}

export function resolveLoopCap(
  cliValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Resolved<number> {
  if (cliValue !== undefined) {
    return { value: parseLoopCap(cliValue), source: "cli" };
  }
  const envValue = env[ENV_GUILD_LOOP_CAP];
  if (envValue !== undefined && envValue.length > 0) {
    return { value: parseLoopCap(envValue), source: "env" };
  }
  return { value: DEFAULT_LOOP_CAP, source: "default" };
}

// ──────────────────────────────────────────────────────────────────────────
// --auto-approve / GUILD_AUTO_APPROVE
// ──────────────────────────────────────────────────────────────────────────

export const AUTO_APPROVE_VALUES = [
  "none",
  "spec-and-plan",
  "implementation",
  "all",
] as const;
export type AutoApproveMode = (typeof AUTO_APPROVE_VALUES)[number];

const AUTO_APPROVE_INVALID_MSG = (raw: string): string =>
  `error: --auto-approve value '${raw}' is invalid; ` +
  `expected one of: none, spec-and-plan, implementation, all`;

export function parseAutoApprove(raw: string): AutoApproveMode {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigError(AUTO_APPROVE_INVALID_MSG(raw ?? ""));
  }
  if ((AUTO_APPROVE_VALUES as readonly string[]).includes(raw)) {
    return raw as AutoApproveMode;
  }
  throw new ConfigError(AUTO_APPROVE_INVALID_MSG(raw));
}

export function resolveAutoApprove(
  cliValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Resolved<AutoApproveMode> {
  if (cliValue !== undefined) {
    return { value: parseAutoApprove(cliValue), source: "cli" };
  }
  const envValue = env[ENV_GUILD_AUTO_APPROVE];
  if (envValue !== undefined && envValue.length > 0) {
    return { value: parseAutoApprove(envValue), source: "env" };
  }
  return { value: DEFAULT_AUTO_APPROVE, source: "default" };
}

// ──────────────────────────────────────────────────────────────────────────
// GUILD_LOG_RETENTION
// ──────────────────────────────────────────────────────────────────────────

export type LogRetention =
  | { kind: "unlimited" }
  | { kind: "bytes"; bytes: number; raw: string };

/**
 * The architect contract's literal stderr text for `GUILD_LOG_RETENTION`
 * invalid values, per `v1.4-jsonl-schema.md` line 453-455:
 *
 *   "GUILD_LOG_RETENTION must be a positive integer suffixed with
 *    MB|GB, or the literal \"unlimited\""
 */
const LOG_RETENTION_INVALID_MSG = (raw: string): string =>
  `error: GUILD_LOG_RETENTION value '${raw}' is invalid; ` +
  `GUILD_LOG_RETENTION must be a positive integer suffixed with MB|GB, or the literal "unlimited"`;

const BYTES_PER_MB = 1024 * 1024;
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Parse a GUILD_LOG_RETENTION value.
 *   - `unlimited` (case-insensitive) → no cap
 *   - `<N>MB` / `<N>GB` (case-insensitive suffix; integer N > 0) → byte cap
 *
 * The cap is **advisory only** in v1.4 (no archive deletion); this parser
 * just normalises the value. The architect's contract: when the parsed
 * value is finite and footprint exceeds it, the runner emits stderr +
 * `assumption_logged` events but does NOT delete archives.
 */
export function parseLogRetention(raw: string): LogRetention {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new ConfigError(LOG_RETENTION_INVALID_MSG(raw ?? ""));
  }
  const lower = raw.toLowerCase();
  if (lower === "unlimited") return { kind: "unlimited" };
  // Accept <N>MB / <N>GB. N must be a positive integer; whitespace not allowed.
  const match = /^([0-9]+)(mb|gb)$/.exec(lower);
  if (!match) {
    throw new ConfigError(LOG_RETENTION_INVALID_MSG(raw));
  }
  const n = Number.parseInt(match[1] as string, 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ConfigError(LOG_RETENTION_INVALID_MSG(raw));
  }
  const unit = match[2] as "mb" | "gb";
  const bytes = unit === "mb" ? n * BYTES_PER_MB : n * BYTES_PER_GB;
  return { kind: "bytes", bytes, raw };
}

export function resolveLogRetention(
  env: NodeJS.ProcessEnv = process.env,
): Resolved<LogRetention> {
  const envValue = env[ENV_GUILD_LOG_RETENTION];
  if (envValue !== undefined && envValue.length > 0) {
    return { value: parseLogRetention(envValue), source: "env" };
  }
  return { value: { kind: "unlimited" }, source: "default" };
}

// ──────────────────────────────────────────────────────────────────────────
// GUILD_STATUSLINE
// ──────────────────────────────────────────────────────────────────────────

const STATUSLINE_INVALID_MSG = (raw: string): string =>
  `error: GUILD_STATUSLINE value '${raw}' is invalid; expected '0' or '1'`;

/**
 * Parse a GUILD_STATUSLINE value.
 *   - "0"           → false (default)
 *   - ""            → false (empty string treated as "0" per contract)
 *   - "1"           → true
 *   - anything else → exit 2
 *
 * The same parser is reused for the `--statusline` CLI flag — bare
 * `--statusline` (no value) is treated as `1` (operator opted in);
 * `--statusline=0` / `=1` / `=` use the env value-set above.
 */
export function parseStatusline(raw: string): boolean {
  if (typeof raw !== "string") {
    throw new ConfigError(STATUSLINE_INVALID_MSG(String(raw)));
  }
  if (raw === "" || raw === "0") return false;
  if (raw === "1") return true;
  throw new ConfigError(STATUSLINE_INVALID_MSG(raw));
}

/**
 * Resolve `--statusline` (CLI) → `GUILD_STATUSLINE` (env) → default
 * (`false`).
 *
 * CLI value (`cliValue`) semantics:
 *   - `undefined`       → flag absent on CLI; fall through to env.
 *   - `"true"`          → bare `--statusline` (no `=value`) — opt-in (`true`).
 *   - `""`              → `--statusline=` (empty value) — explicit "0" (`false`).
 *   - `"0"` / `"1"`     → boolean.
 *   - anything else     → ConfigError with the env-style stderr message.
 */
export function resolveStatusline(
  cliValue?: string,
  env: NodeJS.ProcessEnv = process.env,
): Resolved<boolean> {
  if (cliValue !== undefined) {
    // Bare `--statusline` (no `=value`) treated as opt-in.
    if (cliValue === "true") {
      return { value: true, source: "cli" };
    }
    return { value: parseStatusline(cliValue), source: "cli" };
  }
  const envValue = env[ENV_GUILD_STATUSLINE];
  if (envValue === undefined) {
    return { value: DEFAULT_STATUSLINE, source: "default" };
  }
  // Empty string is documented as equivalent to "0" — explicitly an env
  // *source*, not the default.
  return { value: parseStatusline(envValue), source: "env" };
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregate resolver — convenience for callers (T3b/T3c) that want the
// fully-resolved v1.4 config in one call.
// ──────────────────────────────────────────────────────────────────────────

export interface V14Config {
  loops: Resolved<LoopsConfig>;
  loopCap: Resolved<number>;
  autoApprove: Resolved<AutoApproveMode>;
  logRetention: Resolved<LogRetention>;
  statusline: Resolved<boolean>;
}

export interface V14CliFlags {
  loops?: string;
  loopCap?: string;
  autoApprove?: string;
  /**
   * `--statusline` CLI flag value. The same encoding as parseStatusline
   * accepts: `"true"` for bare `--statusline`, `"0"`/`"1"` for explicit.
   */
  statusline?: string;
}

/**
 * Resolve the full v1.4 config. CLI flags override env; env overrides default.
 * Throws ConfigError on any invalid value (caller maps to exit 2).
 */
export function resolveV14Config(
  cli: V14CliFlags = {},
  env: NodeJS.ProcessEnv = process.env,
): V14Config {
  return {
    loops: resolveLoops(cli.loops, env),
    loopCap: resolveLoopCap(cli.loopCap, env),
    autoApprove: resolveAutoApprove(cli.autoApprove, env),
    logRetention: resolveLogRetention(env),
    statusline: resolveStatusline(cli.statusline, env),
  };
}
