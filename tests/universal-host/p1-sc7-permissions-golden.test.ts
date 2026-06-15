/**
 * tests/universal-host/p1-sc7-permissions-golden.test.ts
 *
 * P1 SC-7 — PERMISSIONS baseline-golden + orthogonality-violation fail-fixture.
 *
 * Two load-bearing facts:
 *   (A) BASELINE GOLDEN — under today's default config (auto_approve=[],
 *       bypass_permissions_policy="audit") every one of the 36 (phase × gate-type)
 *       cells resolves to {host_mode:"ask", guild_gates:"ask", bypass:"audit"}. The
 *       committed fixture is GENERATED from `resolveBaselineGolden()` and therefore
 *       cannot drift from the predicate.
 *   (B) ORTHOGONALITY — `host_mode` ⊥ `guild_gates`. A host bypass/YOLO mode
 *       (`bypass_all`) NEVER lifts a Guild gate; `gateRequired()` ignores host_mode
 *       entirely. Proven across ALL FIVE host_modes, and against the committed
 *       orthogonality-violation fixture (whose expected `gate_required:true` is the
 *       contract a buggy host_mode-consulting resolver would break).
 *
 * REAL PATH (no seam): the SHIPPED predicates (`gateRequired`, `gatesPermittedToSkip`,
 * `evaluateSafetyRails`, `resolveBaselineGolden`, `validateBaselineGoldenTable`) are
 * exercised directly. The baseline fixture is asserted EQUAL to the live resolver
 * output (not just "valid"), so a predicate change without a fixture regen fails.
 *
 * Status at authoring: GREEN (P1-L0 shipped the model + both fixtures). L10
 * (hook-engineer) builds the runtime policy + host-launch mappings against this; its
 * default behavior must equal this baseline golden (asserted live when L10 lands).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  HOST_MODES,
  GUILD_GATES,
  GATE_TYPES,
  PHASES,
  gateRequired,
  gatesPermittedToSkip,
  evaluateSafetyRails,
  resolveBaselineGolden,
  validateBaselineGoldenTable,
  cellKey,
  ALWAYS_ASK_HARD_SET,
  NEVER_AUTONOMOUS_GATES,
  type GateType,
  type HostMode,
} from "../../scripts/lib/permission-policy-schema";

const FIX = path.resolve(__dirname, "fixtures");
const BASELINE = JSON.parse(
  fs.readFileSync(path.join(FIX, "permissions-baseline-golden.json"), "utf8")
);
const VIOLATION = JSON.parse(
  fs.readFileSync(path.join(FIX, "permissions-orthogonality-violation.json"), "utf8")
);

// ── (A) baseline golden ─────────────────────────────────────────────────────

describe("P1 SC-7 — baseline golden (generated, cannot drift)", () => {
  it("the committed fixture EQUALS the live resolveBaselineGolden() output", () => {
    expect(BASELINE).toEqual(resolveBaselineGolden());
  });

  it("is a valid 36-cell table", () => {
    const r = validateBaselineGoldenTable(BASELINE);
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(Object.keys(BASELINE).length).toBe(PHASES.length * GATE_TYPES.length);
    expect(Object.keys(BASELINE).length).toBe(36);
  });

  it("every cell is {ask, ask, audit} (today's effective behavior)", () => {
    for (const phase of PHASES) {
      for (const gate of GATE_TYPES) {
        expect(BASELINE[cellKey(phase, gate)]).toEqual({
          host_mode: "ask",
          guild_gates: "ask",
          bypass: "audit",
        });
      }
    }
  });

  it("a non-default config flips only the SAFE gate types — hard-set cells stay ask", () => {
    const flipped = resolveBaselineGolden({ auto_approve: ["build"], bypass_permissions_policy: "audit" });
    expect(flipped[cellKey("build", "plan")].guild_gates).toBe("auto-safe");
    expect(flipped[cellKey("build", "qa")].guild_gates).toBe("auto-safe");
    // release/security/ops/destructive NEVER flip, even when the phase is auto-approved.
    for (const g of ["release", "security", "ops", "destructive"] as GateType[]) {
      expect(flipped[cellKey("build", g)].guild_gates).toBe("ask");
    }
  });
});

// ── (B) orthogonality across ALL host_modes ─────────────────────────────────

describe("P1 SC-7 — orthogonality: host_mode never lifts a Guild gate", () => {
  it("gateRequired ignores host_mode — every host_mode requires a release gate under guild_gates:ask", () => {
    const results = HOST_MODES.map((m) => gateRequired(m, "ask", "release"));
    expect(results).toEqual(HOST_MODES.map(() => true));
  });

  it("for EVERY (host_mode × gate_type) under guild_gates:ask, the gate is required", () => {
    for (const mode of HOST_MODES) {
      for (const gate of GATE_TYPES) {
        expect(gateRequired(mode, "ask", gate)).toBe(true);
      }
    }
  });

  it("bypass_all (host YOLO) under guild_gates:ask STILL requires every gate", () => {
    for (const gate of GATE_TYPES) {
      expect(gateRequired("bypass_all", "ask", gate)).toBe(true);
    }
  });

  it("the ALWAYS-ASK hard set is unliftable even under guild_gates:auto-safe, any host_mode", () => {
    for (const mode of HOST_MODES) {
      for (const gate of ["release", "security", "ops", "destructive"] as GateType[]) {
        expect(ALWAYS_ASK_HARD_SET.has(gate)).toBe(true);
        expect(gateRequired(mode, "auto-safe", gate)).toBe(true);
      }
      // auto-safe DOES permit the two non-safety gates to auto-proceed.
      expect(gateRequired(mode, "auto-safe", "plan")).toBe(false);
      expect(gateRequired(mode, "auto-safe", "qa")).toBe(false);
    }
  });

  it("gatesPermittedToSkip is conservative: only auto-safe permits anything, and only {plan, qa}", () => {
    expect([...gatesPermittedToSkip("auto-safe")].sort()).toEqual(["plan", "qa"]);
    for (const g of ["ask", "ask-on-block", "never-auto"] as const) {
      expect(gatesPermittedToSkip(g).size).toBe(0);
    }
  });
});

// ── (B2) orthogonality-violation fail-fixture (the RED discriminator) ───────

describe("P1 SC-7 — orthogonality-violation fixture proven from the real predicate", () => {
  it("the fixture's expected gate_required is reproduced by gateRequired across ALL host_modes", () => {
    const { gate_type, guild_gates } = VIOLATION.scenario;
    expect(VIOLATION.expected.gate_required).toBe(true);
    // The scenario sets host_mode=bypass_all; prove NO host_mode changes the answer.
    const across = HOST_MODES.map((m) => gateRequired(m, guild_gates, gate_type as GateType));
    expect(across).toEqual(HOST_MODES.map(() => true));
    // And the proof block the fixture committed matches the live predicate.
    expect(VIOLATION.proof.gate_required_actual).toBe(
      gateRequired(VIOLATION.scenario.host_mode as HostMode, guild_gates, gate_type as GateType)
    );
  });

  it("a buggy host_mode-CONSULTING resolver would FAIL — the real predicate does not", () => {
    // Simulate the defect the fixture guards against: "bypass_all ⇒ skip the gate".
    const buggy = (host_mode: HostMode, gate: GateType): boolean =>
      host_mode === "bypass_all" ? false /* WRONG: skips the gate */ : gateRequired(host_mode, "ask", gate);
    const realResult = gateRequired("bypass_all", "ask", "release");
    expect(buggy("bypass_all", "release")).toBe(false); // the violation
    expect(realResult).toBe(true); // the contract — real predicate refuses to skip
    expect(realResult).not.toBe(buggy("bypass_all", "release"));
  });
});

// ── (C) the 4 safety rails ──────────────────────────────────────────────────

describe("P1 SC-7 — the 4 safety rails", () => {
  const okCtx = { first_run: false, dry_run_done: true };

  it("rail 1 — ops/destructive can never be auto-skipped", () => {
    for (const gate of [...NEVER_AUTONOMOUS_GATES] as GateType[]) {
      // Even if a (hypothetical) guild_gates tried to skip it, rail 1 holds because
      // gateRequired keeps ops/destructive required; evaluateSafetyRails confirms.
      const evAuto = evaluateSafetyRails(gate, "auto-safe", okCtx);
      expect(evAuto.rails.find((r) => r.rail === 1)!.pass).toBe(true);
    }
  });

  it("rail 2 — a first run must not auto-skip a skippable gate", () => {
    const ev = evaluateSafetyRails("plan", "auto-safe", { first_run: true, dry_run_done: true });
    expect(ev.rails.find((r) => r.rail === 2)!.pass).toBe(false);
    expect(ev.ok).toBe(false);
  });

  it("rail 3 — the always-ask hard set is unconditional", () => {
    for (const gate of ["release", "security", "ops", "destructive"] as GateType[]) {
      // gateRequired already keeps these required, so 'wouldSkip' is false ⇒ rail passes;
      // the rail's PURPOSE is the backstop if a future widening tried to skip them.
      const ev = evaluateSafetyRails(gate, "auto-safe", okCtx);
      expect(ev.rails.find((r) => r.rail === 3)!.pass).toBe(true);
    }
  });

  it("rail 4 — an autonomous action requires a completed pre-flight dry-run", () => {
    const ev = evaluateSafetyRails("plan", "auto-safe", { first_run: false, dry_run_done: false });
    expect(ev.rails.find((r) => r.rail === 4)!.pass).toBe(false);
    expect(ev.ok).toBe(false);
  });

  it("a fully-safe skippable cell (plan, not first run, dry-run done) passes all rails", () => {
    const ev = evaluateSafetyRails("plan", "auto-safe", okCtx);
    expect(ev.ok).toBe(true);
    expect(ev.rails.every((r) => r.pass)).toBe(true);
  });
});
