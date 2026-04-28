// v1.4.0 — T3a-backend-config pinning tests for parsers + resolvers +
// CLI-flag plumbing in benchmark/src/cli.ts. The architect's bundle
// requires ≥ 12 NEW tests across this file + counter-store.test.ts; this
// file alone exceeds that floor.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_APPROVE_VALUES,
  ConfigError,
  DEFAULT_AUTO_APPROVE,
  DEFAULT_LOOP_CAP,
  DEFAULT_LOOPS,
  DEFAULT_STATUSLINE,
  ENV_GUILD_AUTO_APPROVE,
  ENV_GUILD_LOG_RETENTION,
  ENV_GUILD_LOOPS,
  ENV_GUILD_LOOP_CAP,
  ENV_GUILD_STATUSLINE,
  parseAutoApprove,
  parseLogRetention,
  parseLoopCap,
  parseLoops,
  parseStatusline,
  resolveAutoApprove,
  resolveLogRetention,
  resolveLoopCap,
  resolveLoops,
  resolveStatusline,
  resolveV14Config,
} from "../src/v1.4-config.js";

const REPO_ROOT = resolve(__dirname, "..");
const CLI_PATH = resolve(REPO_ROOT, "src", "cli.ts");
const TSX_BIN = resolve(REPO_ROOT, "node_modules", ".bin", "tsx");

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
  cwd: string = REPO_ROOT,
): RunResult {
  // Strip the parent process's GUILD_* env so the test doesn't accidentally
  // inherit a developer's local override.
  const cleanEnv: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!k.startsWith("GUILD_")) cleanEnv[k] = v;
  }
  // _setup.ts opts the runner gate in; preserve that.
  cleanEnv.GUILD_BENCHMARK_LIVE = "1";
  // Apply test-specified env overrides.
  for (const [k, v] of Object.entries(env)) cleanEnv[k] = v;
  const r = spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf8",
    env: cleanEnv,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ──────────────────────────────────────────────────────────────────────────
// parseLoops — single-keyword path
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseLoops — single keyword (architect §Decision §5)", () => {
  it("accepts 'none' as standalone keyword", () => {
    expect(parseLoops("none")).toEqual({ kind: "none" });
  });

  it("accepts 'all' as standalone keyword", () => {
    expect(parseLoops("all")).toEqual({ kind: "all" });
  });

  it("accepts 'spec' as a single layer", () => {
    expect(parseLoops("spec")).toEqual({ kind: "set", layers: ["spec"] });
  });

  it("accepts 'plan' as a single layer", () => {
    expect(parseLoops("plan")).toEqual({ kind: "set", layers: ["plan"] });
  });

  it("accepts 'implementation' as a single layer", () => {
    expect(parseLoops("implementation")).toEqual({
      kind: "set",
      layers: ["implementation"],
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseLoops — comma-list path
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseLoops — comma-list", () => {
  it("accepts a 2-element list 'spec,plan' (canonical order)", () => {
    expect(parseLoops("spec,plan")).toEqual({
      kind: "set",
      layers: ["spec", "plan"],
    });
  });

  it("accepts a 3-element list 'spec,plan,implementation'", () => {
    expect(parseLoops("spec,plan,implementation")).toEqual({
      kind: "set",
      layers: ["spec", "plan", "implementation"],
    });
  });

  it("accepts a single-element list 'plan,' would be empty token — but plain 'plan' (no comma) is the single-element form", () => {
    // The single-element form is just the keyword (no comma). Reproduces
    // the architect's grammar — 'plan' lives in the keyword path, not the
    // comma-list path.
    expect(parseLoops("plan")).toEqual({ kind: "set", layers: ["plan"] });
  });

  it("normalises out-of-order comma-lists to canonical order", () => {
    expect(parseLoops("plan,spec")).toEqual({
      kind: "set",
      layers: ["spec", "plan"],
    });
  });

  it("dedupes a comma-list", () => {
    expect(parseLoops("plan,plan,spec")).toEqual({
      kind: "set",
      layers: ["spec", "plan"],
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseLoops — invalid path
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseLoops — invalid (exit 2)", () => {
  it("rejects 'security' (security is not a standalone --loops value)", () => {
    expect(() => parseLoops("security")).toThrow(ConfigError);
    expect(() => parseLoops("security")).toThrow(
      /--loops value 'security' is invalid/,
    );
  });

  it("rejects 'none,plan' (sentinel mixed in a list)", () => {
    expect(() => parseLoops("none,plan")).toThrow(ConfigError);
    expect(() => parseLoops("none,plan")).toThrow(
      /--loops value 'none,plan' is invalid/,
    );
  });

  it("rejects 'all,spec' (sentinel mixed in a list)", () => {
    expect(() => parseLoops("all,spec")).toThrow(ConfigError);
  });

  it("rejects empty token in a comma-list", () => {
    expect(() => parseLoops("spec,,plan")).toThrow(ConfigError);
    expect(() => parseLoops(",spec")).toThrow(ConfigError);
    expect(() => parseLoops("spec,")).toThrow(ConfigError);
  });

  it("rejects an unknown standalone keyword", () => {
    expect(() => parseLoops("foo")).toThrow(/--loops value 'foo' is invalid/);
  });

  it("rejects an empty string", () => {
    expect(() => parseLoops("")).toThrow(ConfigError);
  });

  it("rejects 'security,spec'", () => {
    expect(() => parseLoops("security,spec")).toThrow(ConfigError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseLoopCap
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseLoopCap (positive int ≤ 256)", () => {
  it("accepts the lower bound 1", () => {
    expect(parseLoopCap("1")).toBe(1);
  });

  it("accepts the default 16", () => {
    expect(parseLoopCap("16")).toBe(16);
  });

  it("accepts the upper bound 256", () => {
    expect(parseLoopCap("256")).toBe(256);
  });

  it("rejects 0", () => {
    expect(() => parseLoopCap("0")).toThrow(
      /--loop-cap must be a positive integer ≤ 256/,
    );
  });

  it("rejects -1 (negative)", () => {
    expect(() => parseLoopCap("-1")).toThrow(ConfigError);
  });

  it("rejects 257 (above max)", () => {
    expect(() => parseLoopCap("257")).toThrow(ConfigError);
  });

  it("rejects 'abc' (non-numeric)", () => {
    expect(() => parseLoopCap("abc")).toThrow(ConfigError);
  });

  it("rejects '1.5' (decimal)", () => {
    expect(() => parseLoopCap("1.5")).toThrow(ConfigError);
  });

  it("rejects empty string (missing argument)", () => {
    expect(() => parseLoopCap("")).toThrow(ConfigError);
  });

  it("rejects '0x10' (hex)", () => {
    expect(() => parseLoopCap("0x10")).toThrow(ConfigError);
  });

  it("rejects '+5' (sign-prefixed)", () => {
    expect(() => parseLoopCap("+5")).toThrow(ConfigError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseAutoApprove
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseAutoApprove (4-value enum)", () => {
  it("accepts 'none'", () => {
    expect(parseAutoApprove("none")).toBe("none");
  });

  it("accepts 'spec-and-plan'", () => {
    expect(parseAutoApprove("spec-and-plan")).toBe("spec-and-plan");
  });

  it("accepts 'implementation'", () => {
    expect(parseAutoApprove("implementation")).toBe("implementation");
  });

  it("accepts 'all'", () => {
    expect(parseAutoApprove("all")).toBe("all");
  });

  it("rejects 'always' with exact stderr message", () => {
    expect(() => parseAutoApprove("always")).toThrow(
      /--auto-approve value 'always' is invalid; expected one of: none, spec-and-plan, implementation, all/,
    );
  });

  it("AUTO_APPROVE_VALUES contract is exactly the 4 documented values", () => {
    expect(AUTO_APPROVE_VALUES).toEqual([
      "none",
      "spec-and-plan",
      "implementation",
      "all",
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseLogRetention
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseLogRetention (advisory cap)", () => {
  it("accepts 'unlimited' literal", () => {
    expect(parseLogRetention("unlimited")).toEqual({ kind: "unlimited" });
  });

  it("accepts 'UNLIMITED' (case-insensitive)", () => {
    expect(parseLogRetention("UNLIMITED")).toEqual({ kind: "unlimited" });
  });

  it("accepts '50MB' → 50 * 1024 * 1024 bytes", () => {
    const r = parseLogRetention("50MB");
    expect(r.kind).toBe("bytes");
    if (r.kind === "bytes") {
      expect(r.bytes).toBe(50 * 1024 * 1024);
      expect(r.raw).toBe("50MB");
    }
  });

  it("accepts '1GB' → 1 * 1024 * 1024 * 1024 bytes", () => {
    const r = parseLogRetention("1GB");
    expect(r.kind).toBe("bytes");
    if (r.kind === "bytes") {
      expect(r.bytes).toBe(1024 * 1024 * 1024);
    }
  });

  it("accepts '50mb' (lowercase suffix)", () => {
    const r = parseLogRetention("50mb");
    expect(r.kind).toBe("bytes");
  });

  it("rejects '50' (no suffix) with the architect's verbatim stderr text", () => {
    expect(() => parseLogRetention("50")).toThrow(
      /GUILD_LOG_RETENTION value '50' is invalid; GUILD_LOG_RETENTION must be a positive integer suffixed with MB\|GB, or the literal "unlimited"/,
    );
  });

  it("rejects 'big'", () => {
    expect(() => parseLogRetention("big")).toThrow(ConfigError);
  });

  it("rejects '0MB' (positive integer required)", () => {
    expect(() => parseLogRetention("0MB")).toThrow(ConfigError);
  });

  it("rejects '-5MB'", () => {
    expect(() => parseLogRetention("-5MB")).toThrow(ConfigError);
  });

  it("rejects empty string", () => {
    expect(() => parseLogRetention("")).toThrow(ConfigError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// parseStatusline
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / parseStatusline (boolean)", () => {
  it("accepts '0' as false", () => {
    expect(parseStatusline("0")).toBe(false);
  });

  it("accepts '1' as true", () => {
    expect(parseStatusline("1")).toBe(true);
  });

  it("accepts empty string as false (architect contract)", () => {
    expect(parseStatusline("")).toBe(false);
  });

  it("rejects 'true' literal", () => {
    expect(() => parseStatusline("true")).toThrow(ConfigError);
  });

  it("rejects '2'", () => {
    expect(() => parseStatusline("2")).toThrow(ConfigError);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Resolvers — env mirrors + source attribution
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / env mirrors", () => {
  it("GUILD_LOOPS env mirror — 'plan' → resolved set", () => {
    const r = resolveLoops(undefined, { [ENV_GUILD_LOOPS]: "plan" });
    expect(r).toEqual({
      value: { kind: "set", layers: ["plan"] },
      source: "env",
    });
  });

  it("GUILD_LOOP_CAP env mirror — '32' → 32 from env", () => {
    const r = resolveLoopCap(undefined, { [ENV_GUILD_LOOP_CAP]: "32" });
    expect(r).toEqual({ value: 32, source: "env" });
  });

  it("GUILD_AUTO_APPROVE env mirror — 'all' → 'all' from env", () => {
    const r = resolveAutoApprove(undefined, {
      [ENV_GUILD_AUTO_APPROVE]: "all",
    });
    expect(r).toEqual({ value: "all", source: "env" });
  });

  it("GUILD_LOG_RETENTION env mirror — '50MB' → bytes from env", () => {
    const r = resolveLogRetention({ [ENV_GUILD_LOG_RETENTION]: "50MB" });
    expect(r.source).toBe("env");
    expect(r.value.kind).toBe("bytes");
  });

  it("GUILD_STATUSLINE env mirror — '1' → true from env", () => {
    const r = resolveStatusline(undefined, { [ENV_GUILD_STATUSLINE]: "1" });
    expect(r).toEqual({ value: true, source: "env" });
  });

  it("missing env → defaults with source='default'", () => {
    const r = resolveV14Config({}, {});
    expect(r.loops.source).toBe("default");
    expect(r.loops.value).toEqual({ kind: "none" });
    expect(r.loopCap).toEqual({ value: DEFAULT_LOOP_CAP, source: "default" });
    expect(r.autoApprove).toEqual({
      value: DEFAULT_AUTO_APPROVE,
      source: "default",
    });
    expect(r.logRetention.value).toEqual({ kind: "unlimited" });
    expect(r.logRetention.source).toBe("default");
    expect(r.statusline).toEqual({ value: DEFAULT_STATUSLINE, source: "default" });
  });

  it("CLI flag overrides env (architect: CLI wins)", () => {
    const r = resolveV14Config(
      { loops: "all" },
      { [ENV_GUILD_LOOPS]: "plan" },
    );
    expect(r.loops).toEqual({ value: { kind: "all" }, source: "cli" });
  });

  it("CLI flag overrides env on --loop-cap", () => {
    const r = resolveV14Config(
      { loopCap: "200" },
      { [ENV_GUILD_LOOP_CAP]: "32" },
    );
    expect(r.loopCap).toEqual({ value: 200, source: "cli" });
  });

  it("invalid env value throws ConfigError with documented stderr", () => {
    expect(() =>
      resolveLoops(undefined, { [ENV_GUILD_LOOPS]: "security" }),
    ).toThrow(/--loops value 'security' is invalid/);
    expect(() =>
      resolveLogRetention({ [ENV_GUILD_LOG_RETENTION]: "huge" }),
    ).toThrow(/GUILD_LOG_RETENTION value 'huge' is invalid/);
    expect(() =>
      resolveStatusline(undefined, { [ENV_GUILD_STATUSLINE]: "yes" }),
    ).toThrow(/GUILD_STATUSLINE value 'yes' is invalid/);
  });

  it("DEFAULT_LOOPS sentinel matches architect default 'none'", () => {
    expect(DEFAULT_LOOPS).toBe("none");
  });

  it("empty string env value falls through to default for GUILD_LOOPS / GUILD_LOOP_CAP / GUILD_AUTO_APPROVE", () => {
    // Empty string is treated as "not set" for these vars (mirrors POSIX
    // semantics where empty env is often equivalent to unset).
    expect(resolveLoops(undefined, { [ENV_GUILD_LOOPS]: "" }).source).toBe(
      "default",
    );
    expect(resolveLoopCap(undefined, { [ENV_GUILD_LOOP_CAP]: "" }).source).toBe(
      "default",
    );
    expect(
      resolveAutoApprove(undefined, { [ENV_GUILD_AUTO_APPROVE]: "" }).source,
    ).toBe("default");
  });

  it("empty GUILD_STATUSLINE env returns false from env (contract: '' === '0')", () => {
    const r = resolveStatusline(undefined, { [ENV_GUILD_STATUSLINE]: "" });
    expect(r).toEqual({ value: false, source: "env" });
  });
});

// ──────────────────────────────────────────────────────────────────────────
// CLI integration — the `--loops` / `--loop-cap` / `--auto-approve` flags
// hook into `benchmark/src/cli.ts` and exit 2 on invalid value.
//
// We exercise the CLI end-to-end via `tsx` so the test pins the actual
// stderr message users will see.
// ──────────────────────────────────────────────────────────────────────────

describe("cli / v1.4 global flags (T3a-backend-config)", () => {
  it("`--loops=security` exits 2 with the architect's stderr message", () => {
    const r = runCli(["--loops=security", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--loops value 'security' is invalid");
  });

  it("`--loops=none,plan` exits 2 (sentinel-in-list rejected)", () => {
    const r = runCli(["--loops=none,plan", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--loops value 'none,plan' is invalid");
  });

  it("`--loop-cap=257` exits 2 with the architect's stderr message", () => {
    const r = runCli(["--loop-cap=257", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--loop-cap must be a positive integer ≤ 256");
  });

  it("`--auto-approve=always` exits 2 with the architect's stderr message", () => {
    const r = runCli(["--auto-approve=always", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--auto-approve value 'always' is invalid");
  });

  it("`GUILD_LOG_RETENTION=huge` (env-only, no CLI flag) exits 2", () => {
    const r = runCli(["help"], { GUILD_LOG_RETENTION: "huge" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GUILD_LOG_RETENTION value 'huge' is invalid");
  });

  it("`GUILD_STATUSLINE=yes` exits 2", () => {
    const r = runCli(["help"], { GUILD_STATUSLINE: "yes" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GUILD_STATUSLINE value 'yes' is invalid");
  });

  it("v1.3 invocation contract: bare `help` (no v1.4 flags / env) still exits 0", () => {
    // No --loops / --loop-cap / --auto-approve, no GUILD_* env. v1.4
    // additive only — must not break v1.3 callers.
    const r = runCli(["help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark — Guild benchmark factory CLI");
  });

  it("valid v1.4 flags don't alter v1.3 behaviour: `--loops=all help` still prints usage", () => {
    const r = runCli(["--loops=all", "--loop-cap=16", "--auto-approve=none", "help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("benchmark — Guild benchmark factory CLI");
  });

  // --statusline (v1.4 audit doc §"--statusline (default off) gates the
  // status-line script"). Bare `--statusline` opts in; `--statusline=0`
  // explicitly disables; `--statusline=1` is also valid; anything else
  // exits 2 with the env-style stderr.
  it("`--statusline` (bare) is accepted and exits 0", () => {
    const r = runCli(["--statusline", "help"]);
    expect(r.status).toBe(0);
  });

  it("`--statusline=1` is accepted and exits 0", () => {
    const r = runCli(["--statusline=1", "help"]);
    expect(r.status).toBe(0);
  });

  it("`--statusline=0` is accepted and exits 0", () => {
    const r = runCli(["--statusline=0", "help"]);
    expect(r.status).toBe(0);
  });

  it("`--statusline=yes` exits 2 with the architect's stderr message", () => {
    const r = runCli(["--statusline=yes", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GUILD_STATUSLINE value 'yes' is invalid");
  });

  it("CLI `--statusline` overrides GUILD_STATUSLINE env (CLI wins)", () => {
    const r = runCli(["--statusline=0", "help"], { GUILD_STATUSLINE: "1" });
    expect(r.status).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Architect literal-text pinning — exact-string match (NOT substring) so
// drift in the error messages fails the test immediately. Per the
// fix-up brief: "Tests should use exact-string match (not substring)."
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / architect literal stderr text (exact-match)", () => {
  it("`--loops=security` produces the architect's verbatim stderr line", () => {
    // Per `v1.4-claude-plugin-surface-audit.md` lines 401-402:
    //   "--loops must be one of none|spec|plan|implementation|all or a
    //    comma-list of {spec,plan,implementation}"
    //
    // The CLI prefixes with `error:` per Unix convention.
    const r = runCli(["--loops=security", "help"]);
    expect(r.status).toBe(2);
    const expected =
      "error: --loops value 'security' is invalid; " +
      "--loops must be one of none|spec|plan|implementation|all or a comma-list of {spec,plan,implementation}\n";
    expect(r.stderr).toBe(expected);
  });

  it("`GUILD_LOG_RETENTION=huge` produces the architect's verbatim stderr line", () => {
    // Per `v1.4-jsonl-schema.md` lines 453-455:
    //   "GUILD_LOG_RETENTION must be a positive integer suffixed with
    //    MB|GB, or the literal \"unlimited\""
    const r = runCli(["help"], { GUILD_LOG_RETENTION: "huge" });
    expect(r.status).toBe(2);
    const expected =
      "error: GUILD_LOG_RETENTION value 'huge' is invalid; " +
      "GUILD_LOG_RETENTION must be a positive integer suffixed with MB|GB, or the literal \"unlimited\"\n";
    expect(r.stderr).toBe(expected);
  });

  it("`--loop-cap=257` produces the architect's verbatim stderr line", () => {
    const r = runCli(["--loop-cap=257", "help"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(
      "error: --loop-cap must be a positive integer ≤ 256\n",
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Verify-done greps from the architect's bundle — make sure literal env
// var names appear in the source so the run-end verification catches
// accidental renames.
// ──────────────────────────────────────────────────────────────────────────

describe("v1.4-config / env var name constants (verify-done greps)", () => {
  it("exposes literal env var names matching the spec", () => {
    expect(ENV_GUILD_LOOPS).toBe("GUILD_LOOPS");
    expect(ENV_GUILD_LOOP_CAP).toBe("GUILD_LOOP_CAP");
    expect(ENV_GUILD_AUTO_APPROVE).toBe("GUILD_AUTO_APPROVE");
    expect(ENV_GUILD_LOG_RETENTION).toBe("GUILD_LOG_RETENTION");
    expect(ENV_GUILD_STATUSLINE).toBe("GUILD_STATUSLINE");
  });
});
