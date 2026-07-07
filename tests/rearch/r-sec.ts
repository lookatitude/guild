/**
 * R-SEC — Security-control inventory rail (STRICT).
 *
 * Reads the security-controls.ts manifest and enforces three assertions:
 *
 *   1. ENFORCER EXISTS (STRICT): every control with enforcer_kind="code" must
 *      have an enforcer_file that exists on disk. A control pointing at a
 *      nonexistent file is a manifest error — either the file was deleted and
 *      the control is now unenforced, or the entry was authored incorrectly.
 *
 *   2. HOSTILE TEST EXISTS (STRICT): every control (code or prose-only) must
 *      have a hostile_test that exists on disk. A control without a hostile test
 *      is untested and cannot be trusted green.
 *
 *   3. PROSE-ONLY GAP (ADVISORY): controls whose enforcer_kind is "prose-only"
 *      are flagged — they represent a security gap (the recall-not-prose lesson:
 *      a security step described only in skill prose is unreliable; it must be
 *      enforced in deterministic code on the real path). Advisory: we report the
 *      gap but do not block CI until the prose→code conversion is done.
 *
 * Anti-vacuity: `--prove` runs the detector against a planted synthetic manifest
 * that points at a nonexistent enforcer and asserts the rail TRIPS. It also plants
 * a prose-only entry and asserts the advisory advisory fires.
 *
 * Run:
 *   cd tests && npx tsx rearch/r-sec.ts
 *   cd tests && npx tsx rearch/r-sec.ts --prove
 */

import * as fs from "fs";
import * as path from "path";
import { REPO, RailResult, report, proveAssert } from "./_common";
import {
  SECURITY_CONTROLS,
  proseOnlyControls,
  type SecurityControl,
} from "./security-controls";

// ─────────────────────────────────────────────────────────────────────────────
// Core detector — pure, accepts an explicit manifest for testability
// ─────────────────────────────────────────────────────────────────────────────

export interface SecViolation {
  control_id: string;
  kind: "enforcer-missing" | "hostile-test-missing" | "prose-only-gap";
  detail: string;
}

/**
 * Run the R-SEC detector over the provided manifest.
 * Returns { enforcer: string[], hostileTest: string[], proseOnly: string[] }
 * where each list holds the control_id of failing controls.
 */
export function detectSecViolations(controls: SecurityControl[], repoRoot: string): {
  enforcer: string[];
  hostileTest: string[];
  proseOnly: string[];
  violations: SecViolation[];
} {
  const enforcer: string[] = [];
  const hostileTest: string[] = [];
  const proseOnly: string[] = [];
  const violations: SecViolation[] = [];

  for (const ctrl of controls) {
    // 1. Enforcer file must exist for code controls
    if (ctrl.enforcer_kind === "code") {
      if (!ctrl.enforcer_file || ctrl.enforcer_file.trim() === "") {
        enforcer.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "enforcer-missing",
          detail: `enforcer_file is empty for code control — no enforcer declared`,
        });
      } else {
        const absEnforcer = path.join(repoRoot, ctrl.enforcer_file);
        if (!fs.existsSync(absEnforcer)) {
          enforcer.push(ctrl.control_id);
          violations.push({
            control_id: ctrl.control_id,
            kind: "enforcer-missing",
            detail: `enforcer_file does not exist on disk: ${ctrl.enforcer_file}`,
          });
        }
      }
    }

    // 2. Hostile test must exist for ALL controls (code or prose-only)
    if (!ctrl.hostile_test || ctrl.hostile_test.trim() === "") {
      hostileTest.push(ctrl.control_id);
      violations.push({
        control_id: ctrl.control_id,
        kind: "hostile-test-missing",
        detail: `hostile_test is empty — no hostile test declared`,
      });
    } else {
      const absTest = path.join(repoRoot, ctrl.hostile_test);
      if (!fs.existsSync(absTest)) {
        hostileTest.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "hostile-test-missing",
          detail: `hostile_test does not exist on disk: ${ctrl.hostile_test}`,
        });
      }
    }

    // 3. Prose-only advisory
    if (ctrl.enforcer_kind === "prose-only") {
      proseOnly.push(ctrl.control_id);
      violations.push({
        control_id: ctrl.control_id,
        kind: "prose-only-gap",
        detail:
          `enforcer_kind=prose-only: "${ctrl.what_it_protects.slice(0, 80)}…" — ` +
          `no deterministic code enforcer; this is a security gap (recall-not-prose lesson). ` +
          `Action: implement a hook/script enforcer following the recall-protect pattern.`,
      });
    }
  }

  return { enforcer, hostileTest, proseOnly, violations };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rail runner
// ─────────────────────────────────────────────────────────────────────────────

export function run(): RailResult {
  const out: RailResult = {
    rail: "R-SEC",
    pass: true,
    advisory: false,
    violations: [],
    notes: [],
  };

  const { enforcer, hostileTest, proseOnly, violations } = detectSecViolations(
    SECURITY_CONTROLS,
    REPO,
  );

  const totalControls = SECURITY_CONTROLS.length;
  const codeControls = SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "code").length;
  const proseControls = SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "prose-only").length;

  out.notes.push(
    `manifest: ${totalControls} controls total — ${codeControls} code-enforced, ${proseControls} prose-only`,
  );
  out.notes.push(
    `enforcer-exists check: ${codeControls} code controls checked`,
  );
  out.notes.push(
    `hostile-test-exists check: ${totalControls} controls checked`,
  );

  // STRICT: enforcer-missing and hostile-test-missing block CI
  const strictViolations = violations.filter(
    (v) => v.kind === "enforcer-missing" || v.kind === "hostile-test-missing",
  );

  // ADVISORY: prose-only gaps logged but do not block
  const advisoryViolations = violations.filter((v) => v.kind === "prose-only-gap");

  for (const v of strictViolations) {
    out.violations.push(`[STRICT][${v.control_id}][${v.kind}] ${v.detail}`);
  }

  for (const v of advisoryViolations) {
    out.notes.push(`[ADVISORY][${v.control_id}][prose-only-gap] ${v.detail}`);
  }

  // Summary notes
  if (enforcer.length === 0) {
    out.notes.push(`enforcer-exists: all ${codeControls} code enforcer files exist ✓`);
  } else {
    out.notes.push(`enforcer-exists: ${enforcer.length} enforcer file(s) missing — STRICT`);
  }

  if (hostileTest.length === 0) {
    out.notes.push(`hostile-test-exists: all ${totalControls} hostile tests exist ✓`);
  } else {
    out.notes.push(`hostile-test-exists: ${hostileTest.length} hostile test file(s) missing — STRICT`);
  }

  if (proseOnly.length === 0) {
    out.notes.push(
      `prose-only-gap: 0 prose-only controls (M8 is fully deterministic code) ✓`,
    );
  } else {
    out.notes.push(
      `prose-only-gap: ${proseOnly.length} prose-only control(s) flagged (ADVISORY — not blocking) [${proseOnly.join(", ")}]`,
    );
  }

  out.pass = strictViolations.length === 0;
  // Rail is STRICT (not advisory) — prose-only gaps are recorded as notes, not violations.
  out.advisory = false;

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-vacuity proof
// ─────────────────────────────────────────────────────────────────────────────

function prove(): void {
  console.log("\n[R-SEC] --prove (anti-vacuity)");

  // (a) A code control pointing at a nonexistent enforcer_file → TRIPS the rail
  const withMissingEnforcer: SecurityControl[] = [
    {
      control_id: "TEST-MISSING-ENFORCER",
      what_it_protects: "test: nonexistent enforcer",
      enforcer_file: "scripts/lib/security/DOES_NOT_EXIST_abcxyz.ts",
      enforcer_function: "noop",
      enforcer_kind: "code",
      hostile_test: "scripts/__tests__/recall-protect.test.ts", // real file
      anti_vacuity_control: "planted nonexistent enforcer",
    },
  ];
  const { enforcer: e1 } = detectSecViolations(withMissingEnforcer, REPO);
  proveAssert(
    e1.includes("TEST-MISSING-ENFORCER"),
    "enforcer-missing detector TRIPS when enforcer_file does not exist on disk",
  );

  // (b) A control pointing at a nonexistent hostile_test → TRIPS
  const withMissingTest: SecurityControl[] = [
    {
      control_id: "TEST-MISSING-HOSTILE",
      what_it_protects: "test: nonexistent hostile test",
      enforcer_file: "scripts/lib/recall-protect.ts", // real file
      enforcer_function: "protectChunks",
      enforcer_kind: "code",
      hostile_test: "scripts/__tests__/DOES_NOT_EXIST_abcxyz.test.ts",
      anti_vacuity_control: "planted nonexistent test",
    },
  ];
  const { hostileTest: ht1 } = detectSecViolations(withMissingTest, REPO);
  proveAssert(
    ht1.includes("TEST-MISSING-HOSTILE"),
    "hostile-test-missing detector TRIPS when hostile_test file does not exist",
  );

  // (c) A prose-only entry → advisory fires
  const withProseOnly: SecurityControl[] = [
    {
      control_id: "TEST-PROSE-ONLY",
      what_it_protects: "test: prose-only control (no code enforcer)",
      enforcer_file: "",
      enforcer_function: "",
      enforcer_kind: "prose-only",
      hostile_test: "scripts/__tests__/recall-protect.test.ts", // real file
      anti_vacuity_control: "planted prose-only",
    },
  ];
  const { proseOnly: p1, violations: v1 } = detectSecViolations(withProseOnly, REPO);
  proveAssert(
    p1.includes("TEST-PROSE-ONLY"),
    "prose-only-gap advisory fires for a control with enforcer_kind='prose-only'",
  );
  // prose-only should be advisory, not a strict violation
  const strictOnly = v1.filter((v) => v.kind !== "prose-only-gap");
  proveAssert(
    strictOnly.length === 0,
    "prose-only control does NOT generate a strict (enforcer-missing) violation — only advisory",
  );

  // (d) Clean control pointing at real files → passes
  const clean: SecurityControl[] = [
    {
      control_id: "TEST-CLEAN",
      what_it_protects: "test: clean code control",
      enforcer_file: "scripts/lib/recall-protect.ts",
      enforcer_function: "protectChunks",
      enforcer_kind: "code",
      hostile_test: "scripts/__tests__/recall-protect.test.ts",
      anti_vacuity_control: "planted clean control",
    },
  ];
  const { enforcer: e2, hostileTest: ht2, proseOnly: p2 } = detectSecViolations(clean, REPO);
  proveAssert(
    e2.length === 0 && ht2.length === 0 && p2.length === 0,
    "clean control (real enforcer + real hostile_test, code-enforced) passes all checks",
  );

  // (e) The real manifest has zero prose-only controls (all M8 enforcers are code)
  const { proseOnly: realProseOnly } = detectSecViolations(SECURITY_CONTROLS, REPO);
  proveAssert(
    realProseOnly.length === 0,
    `real manifest has 0 prose-only controls — M8 is fully deterministic code (no prose-only gap found)`,
  );

  // (f) The real manifest has zero strict violations (all enforcer + test files exist)
  const { enforcer: realMissingEnforcer, hostileTest: realMissingTest } = detectSecViolations(
    SECURITY_CONTROLS,
    REPO,
  );
  proveAssert(
    realMissingEnforcer.length === 0,
    `real manifest has 0 missing enforcer files`,
  );
  proveAssert(
    realMissingTest.length === 0,
    `real manifest has 0 missing hostile test files`,
  );

  console.log("\n  All R-SEC anti-vacuity proofs passed.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (process.argv.includes("--prove")) {
    try {
      prove();
    } catch {
      process.exit(1);
    }
  } else {
    process.exit(report(run()));
  }
}
