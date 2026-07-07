/**
 * tests/universal-host/p1-l10-permission-policy.test.ts
 *
 * P1-L10 — the RUNTIME permission policy (hook-engineer), the live integration
 * assertions the SC-7 contract deferred to L10 ("its default behavior must equal
 * this baseline golden — asserted live when L10 lands"; eval-engineer P1-Ltest
 * followup: "L10 should add LIVE integration assertions ... policy resolution").
 *
 * Drives the SHIPPED L10 functions on the REAL path (resolvePermissionPolicy /
 * resolveEffectivePolicy / resolveHostLaunch / guildGateRequired) — NO seam, NO
 * re-implementation. The launch flags come from the real registry rows via the
 * real L3 resolveLaunchMode; the gate decision from the real L0 gateRequired.
 *
 * Coverage maps to the security-auditor's staged matrix:
 *   T-O1–O5  orthogonality (host_mode ⊥ guild_gates) across all 5 host_modes,
 *            incl. T-O5 (widened auto-safe still cannot lift the hard set).
 *   T-R1–R5  the 4 safety rails on the integrated effective decision.
 *   default == C2 baseline golden, byte-for-byte (the load-bearing fact).
 *   host-native launch-flag fidelity + AC20 minimum-loss degradation.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import {
  HOST_MODES,
  GATE_TYPES,
  PHASES,
  resolveBaselineGolden,
  cellKey,
  ALWAYS_ASK_HARD_SET,
  type HostMode,
  type GateType,
} from "../../scripts/lib/permission-policy-schema";

import {
  resolvePermissionPolicy,
  resolveEffectivePolicy,
  resolveHostLaunch,
  guildGateRequired,
  autoApproveCovers,
  RUNTIME_DEFAULT_CONFIG,
  type RuntimePermissionConfig,
} from "../../scripts/lib/permission-policy";

const FIX = path.resolve(__dirname, "fixtures");
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(FIX, "permissions-baseline-golden.json"), "utf8")
);
const VIOLATION = JSON.parse(
  fs.readFileSync(path.join(FIX, "permissions-orthogonality-violation.json"), "utf8")
);

const HARD_SET = ["release", "security", "ops", "destructive"] as GateType[];
const okCtx = { first_run: false, dry_run_done: true };

// ── (A) DEFAULT == baseline golden, byte-for-byte ───────────────────────────

describe("P1-L10 — the runtime default reproduces the C2 baseline golden", () => {
  it("resolvePermissionPolicy(default) EQUALS the committed golden fixture", () => {
    expect(resolvePermissionPolicy(RUNTIME_DEFAULT_CONFIG)).toEqual(BASELINE);
  });

  it("resolvePermissionPolicy(default) EQUALS the L0 reference resolver output", () => {
    // The production resolver delegates to the very generator the golden came from.
    expect(resolvePermissionPolicy(RUNTIME_DEFAULT_CONFIG)).toEqual(resolveBaselineGolden());
  });

  it("no-arg default is the same as the explicit default config", () => {
    expect(resolvePermissionPolicy()).toEqual(resolvePermissionPolicy(RUNTIME_DEFAULT_CONFIG));
  });

  it("every default cell is {ask, ask, audit}", () => {
    const table = resolvePermissionPolicy();
    for (const phase of PHASES) {
      for (const gate of GATE_TYPES) {
        expect(table[cellKey(phase, gate)]).toEqual({ host_mode: "ask", guild_gates: "ask", bypass: "audit" });
      }
    }
  });
});

// ── (B) ORTHOGONALITY through the PRODUCTION resolver (T-O1–O4) ──────────────

describe("P1-L10 — orthogonality: a host bypass never skips a Guild gate (real path)", () => {
  it("for EVERY host_mode override, every hard-set gate stays required + never skips", () => {
    for (const mode of HOST_MODES) {
      const config: RuntimePermissionConfig = {
        auto_approve: [],
        bypass_permissions_policy: "audit",
        host_mode: mode,
      };
      for (const gate of HARD_SET) {
        const eff = resolveEffectivePolicy({ host: "claude", phase: "build", gate_type: gate, config, ctx: okCtx });
        // The host autonomy axis reflects the override...
        expect(eff.decision.host_mode).toBe(mode);
        // ...but the Guild-gate axis is unmoved.
        expect(eff.gate_required).toBe(true);
        expect(eff.effective_skip).toBe(false);
      }
    }
  });

  it("bypass_all host LAUNCHES under bypassPermissions yet the release gate still fires", () => {
    const eff = resolveEffectivePolicy({
      host: "claude",
      phase: "build",
      gate_type: "release",
      config: { auto_approve: [], bypass_permissions_policy: "audit", host_mode: "bypass_all" },
      ctx: okCtx,
    });
    expect(eff.host_launch.args).toEqual(["--permission-mode", "bypassPermissions"]); // host autonomy on
    expect(eff.gate_required).toBe(true); // Guild gate unaffected
    expect(eff.effective_skip).toBe(false);
  });

  it("guildGateRequired is host_mode-blind: identical across all 5 host_modes", () => {
    for (const gate of GATE_TYPES) {
      const ref = guildGateRequired("ask", gate);
      // No host_mode parameter exists on guildGateRequired — prove the EFFECTIVE
      // decision (which DOES carry host_mode) never changes the gate answer.
      const across = HOST_MODES.map((m) =>
        resolveEffectivePolicy({
          host: "claude",
          phase: "build",
          gate_type: gate,
          config: { auto_approve: [], bypass_permissions_policy: "audit", host_mode: m },
          ctx: okCtx,
        }).gate_required
      );
      expect(across).toEqual(HOST_MODES.map(() => ref));
    }
  });

  it("reproduces the committed orthogonality-violation fixture via the real resolver", () => {
    const { gate_type, guild_gates, host_mode, phase } = VIOLATION.scenario;
    expect(VIOLATION.expected.gate_required).toBe(true);
    // The fixture is bypass_all + guild_gates:ask on a release gate ⇒ required.
    expect(guildGateRequired(guild_gates, gate_type as GateType)).toBe(true);
    const eff = resolveEffectivePolicy({
      host: "claude",
      phase,
      gate_type: gate_type as GateType,
      config: { auto_approve: [], bypass_permissions_policy: "audit", host_mode: host_mode as HostMode },
      ctx: okCtx,
    });
    expect(eff.gate_required).toBe(true);
    expect(eff.effective_skip).toBe(false);
  });

  it("non-vacuity: a host_mode-CONSULTING resolver would skip; the real one never does", () => {
    const buggy = (m: HostMode): boolean => (m === "bypass_all" ? true : false); // WRONG: bypass ⇒ skip
    const real = resolveEffectivePolicy({
      host: "claude",
      phase: "ops",
      gate_type: "release",
      config: { auto_approve: [], bypass_permissions_policy: "audit", host_mode: "bypass_all" },
      ctx: okCtx,
    }).effective_skip;
    expect(buggy("bypass_all")).toBe(true);
    expect(real).toBe(false);
    expect(real).not.toBe(buggy("bypass_all"));
  });
});

// ── (B2) T-O5 — widened auto-safe still cannot pierce the hard set ───────────

describe("P1-L10 — T-O5: widening auto-safe never lifts the always-ask hard set", () => {
  it("auto-approving a phase flips ONLY {plan,qa}; hard set stays required even under bypass_all", () => {
    const config: RuntimePermissionConfig = {
      auto_approve: ["all"], // widen as far as the vocabulary allows
      bypass_permissions_policy: "allow",
      host_mode: "bypass_all", // and turn host autonomy all the way up
    };
    for (const phase of PHASES) {
      // soft gates auto-proceed
      for (const soft of ["plan", "qa"] as GateType[]) {
        const eff = resolveEffectivePolicy({ host: "claude", phase, gate_type: soft, config, ctx: okCtx });
        expect(eff.decision.guild_gates).toBe("auto-safe");
        expect(eff.gate_required).toBe(false);
      }
      // hard set is unliftable
      for (const hard of HARD_SET) {
        const eff = resolveEffectivePolicy({ host: "claude", phase, gate_type: hard, config, ctx: okCtx });
        expect(ALWAYS_ASK_HARD_SET.has(hard)).toBe(true);
        expect(eff.decision.guild_gates).toBe("ask"); // never flipped
        expect(eff.gate_required).toBe(true);
        expect(eff.effective_skip).toBe(false);
      }
    }
  });
});

// ── (C) host-native launch-flag fidelity + AC20 minimum-loss ────────────────

describe("P1-L10 — host launch-flag mappings (registry-driven, host autonomy ONLY)", () => {
  it("Claude maps every mode to its exact --permission-mode recipe", () => {
    expect(resolveHostLaunch("claude", "read_only").args).toEqual(["--tools", "Read,Grep,Glob"]);
    expect(resolveHostLaunch("claude", "ask").args).toEqual(["--permission-mode", "default"]);
    expect(resolveHostLaunch("claude", "accept_edits").args).toEqual(["--permission-mode", "acceptEdits"]);
    expect(resolveHostLaunch("claude", "auto").args).toEqual(["--permission-mode", "auto"]);
    expect(resolveHostLaunch("claude", "bypass_all").args).toEqual(["--permission-mode", "bypassPermissions"]);
    for (const m of HOST_MODES) expect(resolveHostLaunch("claude", m).degraded).toBe(false);
  });

  it("Codex bypass_all maps to its --dangerously-bypass recipe", () => {
    const r = resolveHostLaunch("codex", "bypass_all");
    expect(r.args).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(r.degraded).toBe(false);
  });

  it("Codex 'auto'/'accept_edits' degrade to the host default — never escalate (AC20)", () => {
    for (const m of ["auto", "accept_edits", "ask", "read_only"] as HostMode[]) {
      const r = resolveHostLaunch("codex", m);
      // No recipe at-or-below ⇒ host default (no flags); NEVER the higher bypass recipe.
      expect(r.degraded).toBe(true);
      expect(r.args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
      expect(typeof r.reason).toBe("string");
    }
  });

  it("an unknown host degrades to the host default + records it, claiming no mode", () => {
    const r = resolveHostLaunch("nonesuch", "bypass_all");
    expect(r.unknown_host).toBe(true);
    expect(r.args).toEqual([]);
    expect(r.degraded).toBe(true);
    expect(r.host_default).toBe(true);
  });
});

// ── (D) the 4 safety rails on the integrated decision (T-R1–R5) ─────────────

describe("P1-L10 — safety rails on the effective decision", () => {
  const softConfig: RuntimePermissionConfig = { auto_approve: ["all"], bypass_permissions_policy: "audit" };

  it("T-R1 — ops/destructive never auto-skip (effective_skip false even when auto-approved)", () => {
    for (const gate of ["ops", "destructive"] as GateType[]) {
      const eff = resolveEffectivePolicy({ host: "claude", phase: "build", gate_type: gate, config: softConfig, ctx: okCtx });
      expect(eff.gate_required).toBe(true);
      expect(eff.effective_skip).toBe(false);
      expect(eff.rails.rails.find((r) => r.rail === 1)!.pass).toBe(true);
    }
  });

  it("T-R2 — a first run must not auto-skip a skippable gate", () => {
    const eff = resolveEffectivePolicy({
      host: "claude", phase: "build", gate_type: "plan", config: softConfig,
      ctx: { first_run: true, dry_run_done: true },
    });
    expect(eff.gate_required).toBe(false); // plan is skippable under all
    expect(eff.rails.rails.find((r) => r.rail === 2)!.pass).toBe(false);
    expect(eff.rails.ok).toBe(false);
    expect(eff.effective_skip).toBe(false); // rail blocks the skip
  });

  it("T-R3 — the always-ask hard set is unconditional", () => {
    for (const gate of HARD_SET) {
      const eff = resolveEffectivePolicy({ host: "claude", phase: "build", gate_type: gate, config: softConfig, ctx: okCtx });
      expect(eff.rails.rails.find((r) => r.rail === 3)!.pass).toBe(true);
    }
  });

  it("T-R4 — an autonomous skip requires a completed pre-flight dry-run", () => {
    const eff = resolveEffectivePolicy({
      host: "claude", phase: "build", gate_type: "plan", config: softConfig,
      ctx: { first_run: false, dry_run_done: false },
    });
    expect(eff.gate_required).toBe(false);
    expect(eff.rails.rails.find((r) => r.rail === 4)!.pass).toBe(false);
    expect(eff.effective_skip).toBe(false);
  });

  it("T-R5 — a fully-safe skippable cell (plan, not first run, dry-run done) actually skips", () => {
    const eff = resolveEffectivePolicy({ host: "claude", phase: "build", gate_type: "plan", config: softConfig, ctx: okCtx });
    expect(eff.gate_required).toBe(false);
    expect(eff.rails.ok).toBe(true);
    expect(eff.effective_skip).toBe(true);
  });
});

// ── (E) auto_approve token vocabulary (F2: "all" + spec→phase migration) ─────

describe("P1-L10 — auto_approve token vocabulary (F2)", () => {
  it("autoApproveCovers mirrors the live predicate: includes('all') OR exact token", () => {
    expect(autoApproveCovers([], "plan")).toBe(false);
    expect(autoApproveCovers(["all"], "anything")).toBe(true);
    expect(autoApproveCovers(["plan"], "plan")).toBe(true);
    expect(autoApproveCovers(["plan"], "build")).toBe(false);
  });

  it("'all' flips every soft gate but no hard-set gate", () => {
    const table = resolvePermissionPolicy({ auto_approve: ["all"], bypass_permissions_policy: "audit" });
    for (const phase of PHASES) {
      expect(table[cellKey(phase, "plan")].guild_gates).toBe("auto-safe");
      expect(table[cellKey(phase, "qa")].guild_gates).toBe("auto-safe");
      for (const hard of HARD_SET) expect(table[cellKey(phase, hard)].guild_gates).toBe("ask");
    }
  });

  it("'spec' token migrates to the ideate phase; 'build' to the build phase", () => {
    const spec = resolvePermissionPolicy({ auto_approve: ["spec"], bypass_permissions_policy: "audit" });
    expect(spec[cellKey("ideate", "plan")].guild_gates).toBe("auto-safe");
    expect(spec[cellKey("build", "plan")].guild_gates).toBe("ask"); // other phases untouched

    const build = resolvePermissionPolicy({ auto_approve: ["build"], bypass_permissions_policy: "audit" });
    expect(build[cellKey("build", "plan")].guild_gates).toBe("auto-safe");
    expect(build[cellKey("build", "qa")].guild_gates).toBe("auto-safe");
    expect(build[cellKey("ideate", "plan")].guild_gates).toBe("ask");
  });

  it("the bypass policy passes through to every cell", () => {
    for (const policy of ["deny", "audit", "allow"] as const) {
      const table = resolvePermissionPolicy({ auto_approve: [], bypass_permissions_policy: policy });
      for (const phase of PHASES) {
        for (const gate of GATE_TYPES) expect(table[cellKey(phase, gate)].bypass).toBe(policy);
      }
    }
  });
});

// ── (F) CLI honors the LIVE config without an explicit --cwd (codex R1 fix) ──

describe("P1-L10 — CLI reads the live .guild/settings.json from cwd (no false-clean audit)", () => {
  const CLI = path.resolve(__dirname, "../../scripts/permission-policy.ts");

  it("a widened settings.json at the run cwd is reflected WITHOUT passing --cwd", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l10-cli-"));
    try {
      fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".guild", "settings.json"),
        JSON.stringify({
          defaults: { gates: { auto_approve: ["all"] } },
          security: { bypass_permissions_policy: "allow" },
        }),
      );
      // Run the CLI WITH cwd=tmp but NO --cwd flag — the fix makes loadConfig default
      // to process.cwd(), so it must pick up the widened live config (not the default).
      const out = execFileSync("npx", ["tsx", CLI, "resolve"], { cwd: tmp, encoding: "utf8" });
      const parsed = JSON.parse(out);
      expect(parsed.config.auto_approve).toEqual(["all"]);
      expect(parsed.config.bypass_permissions_policy).toBe("allow");
      // The widened config flips the soft gates but the hard set stays required.
      expect(parsed.table[cellKey("build", "plan")].guild_gates).toBe("auto-safe");
      expect(parsed.table[cellKey("build", "release")].guild_gates).toBe("ask");
      for (const phase of PHASES) {
        for (const gate of GATE_TYPES) expect(parsed.table[cellKey(phase, gate)].bypass).toBe("allow");
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("the `effective` subcommand honors the live config without --cwd (soft + hard gate)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l10-cli-eff-"));
    try {
      fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, ".guild", "settings.json"),
        JSON.stringify({
          defaults: { gates: { auto_approve: ["all"] } },
          security: { bypass_permissions_policy: "allow" },
        }),
      );
      const run = (gate: string) =>
        JSON.parse(
          execFileSync("npx", ["tsx", CLI, "effective", "--host", "claude", "--phase", "build", "--gate", gate], {
            cwd: tmp,
            encoding: "utf8",
          }),
        );
      // Soft gate: live config widened ⇒ skippable (default ctx: not first run, dry-run done).
      const soft = run("plan");
      expect(soft.decision.bypass).toBe("allow");
      expect(soft.decision.guild_gates).toBe("auto-safe");
      expect(soft.gate_required).toBe(false);
      expect(soft.effective_skip).toBe(true);
      // Hard-set gate: even under the widened live config it stays required + never skips.
      const hard = run("release");
      expect(hard.decision.bypass).toBe("allow");
      expect(hard.decision.guild_gates).toBe("ask");
      expect(hard.gate_required).toBe(true);
      expect(hard.effective_skip).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("a cwd with no settings.json fails safe to the default golden posture", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "l10-cli-empty-"));
    try {
      const out = execFileSync("npx", ["tsx", CLI, "resolve"], { cwd: tmp, encoding: "utf8" });
      const parsed = JSON.parse(out);
      expect(parsed.config).toEqual({ auto_approve: [], bypass_permissions_policy: "audit" });
      expect(parsed.table).toEqual(resolveBaselineGolden());
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
