/**
 * scripts/build-verify.ts
 *
 * verified-multi-host-support L6 (AC-BLD-1/2/3, ADR §8) — the ONE top-level plugin
 * build/verify command. Runs a fail-fast sequential chain: each step exits non-zero on
 * failure, the overall exit code is the AND of every step (0 iff all steps pass, first
 * failing step's code otherwise). This lane is ORCHESTRATION ONLY — every step reuses an
 * existing per-step script; nothing here re-implements a builder or a verifier, and the
 * esbuild runtime bundling (hooks + MCP) is preserved verbatim (AC-BLD-3).
 *
 * The 8-step chain (ADR §8; step 6b added by the plugin-audit-remediation hygiene pass —
 * build:verify previously only checked the evidence/host-smoke receipt leg and silently
 * skipped the broader share-dot-guild `.guild/runs` gate that CI's dot-guild-policy.yml
 * runs separately, so a local build:verify pass could still leak an operator-path/secret/
 * nested-.guild finding that only CI would catch):
 *   1. build hooks        (hooks/ esbuild → hooks dist)                       — existing
 *   2. build MCP servers  (mcp-servers/<server> esbuild → per-server dist)    — existing
 *   3. build host packages(build:hosts / build-host-packages.ts → dist/<h>)  — existing
 *   4. verify host packages (verify:host-packages)                            — existing
 *   5. verify installer   (verify:installer — install.sh dry-run, 12 hosts)   — L4b rail
 *   6. redaction/leak scan (dot-guild/audit.ts — the AC-SEC-1 package/receipt leg,
 *                          the §7.2 shared-redact scan over evidence/host-smoke)— L3 rail
 *   6b. full share-dot-guild audit (dot-guild/audit.ts's own CLI — the SAME script CI's
 *                          dot-guild-policy.yml runs — over the whole plugin repo: scrub.ts
 *                          dry-run + nested-.guild + scrub-coverage-gap + receipt-leak legs.
 *                          Runs the FULL (non---tracked-only) scan — a local build:verify
 *                          pass is a pre-commit posture and should also catch
 *                          untracked-but-shareable cruft, not just already-tracked paths.
 *                          Never run in CI (confirmed: no workflow invokes build:verify),
 *                          so there is no CI-safety concern about the fuller scan's cost.
 *   7. generate + validate the matrix (generate-support-matrix.ts — reads COMMITTED
 *                          receipts, runs the two-field AC-RUN-3 host-support gate +
 *                          AC-REG-4 registry validation; NEVER re-runs smoke, §6.5) — L5/L7
 *
 * Operator-only variant (ADR §8, never run in CI):
 *   build:verify --refresh-receipts
 * Runs the L5 host-smoke harness (`host-smoke.ts --all-reachable`) on THIS box FIRST to
 * re-probe reachable host binaries/editors and recapture stale/changed committed receipts,
 * THEN runs the full 8-step chain. HONESTY (ADR §5.3): an unreachable host emits no receipt
 * and stays an honest target — the harness never fabricates. FLOOR-COUPLING (ADR §5.3 (c),
 * §8): if a refresh promotes a host to a verified public state for the FIRST time, the
 * operator MUST set that host's `achieved_floor` in `scripts/lib/host-public-state.ts`
 * (HOST_EXPECTED_STATE) in the SAME commit as the receipt — otherwise step 7's gate FAILS
 * that host (a verified state with a null/mismatched floor is rejected). The gate is the
 * mechanical enforcement of the atomic coupling; this orchestrator surfaces the failure
 * rather than silently inventing a floor.
 *
 * Usage:
 *   npx tsx build-verify.ts [--refresh-receipts] [--generated-at YYYY-MM-DD]
 *   npm run build:verify            (from plugin/scripts)
 *   npm run build:verify:refresh    (operator box only)
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
// Single-source AC-SEC-1 package/receipt scan (ADR §7.2). Step 6 IMPORTS and calls the
// EXACT function `audit.ts`'s main() runs — no parallel copy of the walk/check-ignore/redact
// logic — so build:verify's redaction leg can never drift from the CI audit gate. audit.ts
// guards its own main() behind `require.main === module`, so this import is side-effect-free.
import { findPackageReceiptLeaks } from "./dot-guild/audit";

const SCRIPTS_DIR = __dirname;
const PLUGIN_ROOT = join(SCRIPTS_DIR, "..");
const HOOKS_DIR = join(PLUGIN_ROOT, "hooks");
const MCP_DIR = join(PLUGIN_ROOT, "mcp-servers");

/** The MCP servers that ship an esbuild `build` script (AC-BLD-3 — bundling preserved). */
const MCP_SERVERS = ["guild-memory", "guild-telemetry"];

/**
 * A step is either a spawned subprocess (reusing an existing per-step script) or an
 * in-process function (the ADR §6.4 evidence redaction-verify, which the ADR assigns to
 * the L6 build/verify command itself). Both return an exit code (0 = pass).
 */
interface Step {
  name: string;
  cmd?: string;
  args?: string[];
  cwd?: string;
  run?: () => number;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Run one step, streaming its output. Returns the step's exit code (non-zero = fail). */
function runStep(step: Step, index: number, total: number): number {
  const label = `[build:verify] step ${index}/${total} — ${step.name}`;
  console.log(`\n${label}`);
  console.log(`${"─".repeat(Math.min(label.length, 72))}`);
  if (step.run) {
    return step.run();
  }
  const cwd = step.cwd ?? SCRIPTS_DIR;
  console.log(`$ (cwd=${cwd.replace(PLUGIN_ROOT, ".")}) ${step.cmd} ${(step.args ?? []).join(" ")}`);
  const res = spawnSync(step.cmd!, step.args ?? [], { cwd, stdio: "inherit" });
  if (res.error) {
    console.error(`[build:verify] step ${index} spawn error: ${res.error.message}`);
    return res.status ?? 1;
  }
  // A signal-terminated child has null status — treat as failure.
  return res.status ?? 1;
}

/**
 * Step 6 (ADR §8 step 6 / §7.2): the AC-SEC-1 package/receipt redaction/leak verify. This
 * REUSES L3's single-source scan — it calls the SAME `findPackageReceiptLeaks(repoPath)`
 * that `audit.ts`'s main() runs (walk `evidence/host-smoke` → `git check-ignore` filter →
 * shared `redact`, flagging `receipt-operator-path` / `receipt-secret`), so build:verify's
 * redaction leg is byte-for-byte the CI audit's package/receipt scan — no second scanner,
 * no drift (R2). It invokes ONLY that scan function, NOT the full `audit.ts` main() — step
 * 6b (below) separately runs the full CLI (nested-guild + scrub-coverage-gap + scrub.ts
 * dry-run legs included), so both the narrow evidence-only leg and the full share-dot-guild
 * gate are covered. Any flag ⇒ non-zero (matches audit main()'s actionable-flag exit).
 * Empty/absent tree ⇒ PASS.
 */
function verifyEvidenceRedaction(): number {
  console.log("  L3 single-source package/receipt scan (findPackageReceiptLeaks) over ./evidence/host-smoke");
  const flags = findPackageReceiptLeaks(PLUGIN_ROOT);
  if (flags.length > 0) {
    console.error(`  ✗ ${flags.length} leak finding(s) in committed/shareable receipt(s):`);
    for (const f of flags) console.error(`    - [${f.kind}] ${f.file}: ${f.detail}`);
    console.error("  A committed evidence receipt must be scrubbed (shared redact) at WRITE time (ADR §6.4).");
    return 1;
  }
  console.log("  ✓ evidence/host-smoke scan clean — no operator-path / secret flags (PASS).");
  return 0;
}

function buildChain(): Step[] {
  return [
    // 1. hooks build (esbuild → hooks/dist + hooks/agent-team/dist) — existing.
    { name: "build hooks (esbuild bundle)", cmd: "npm", args: ["run", "build"], cwd: HOOKS_DIR },
    // 2. MCP server builds (esbuild → per-server dist) — existing, one per shipped server.
    ...MCP_SERVERS.map((s) => ({
      name: `build MCP server: ${s} (esbuild bundle)`,
      cmd: "npm",
      args: ["run", "build"],
      cwd: join(MCP_DIR, s),
    })),
    // 3. host package build (build:hosts → dist/<host>) — existing.
    { name: "build host packages (build:hosts)", cmd: "npm", args: ["run", "build:hosts"], cwd: SCRIPTS_DIR },
    // 4. host package verification — existing.
    { name: "verify host packages (verify:host-packages)", cmd: "npm", args: ["run", "verify:host-packages"], cwd: SCRIPTS_DIR },
    // 5. installer verification (install.sh dry-run per installable host) — L4b rail.
    { name: "verify installer (verify:installer)", cmd: "npm", args: ["run", "verify:installer"], cwd: SCRIPTS_DIR },
    // 6. redaction/leak verification — the AC-SEC-1 package/receipt leg (ADR §6.4/§8 step 6):
    //    a shared-redact verify over plugin/evidence, run BEFORE the matrix step. In-process
    //    (the ADR assigns this pass to the L6 build/verify command), reusing the SAME shared
    //    `redact` the write path + CI audit run. Scoped to evidence/host-smoke ONLY.
    {
      name: "redaction/leak verify (shared redact over plugin/evidence — AC-SEC-1)",
      run: verifyEvidenceRedaction,
    },
    // 6b. FULL share-dot-guild audit (plugin-audit-remediation hygiene pass) — the SAME
    //    dot-guild/audit.ts CLI CI's dot-guild-policy.yml runs, over the whole plugin repo
    //    (scrub.ts dry-run + nested-.guild + scrub-coverage-gap + receipt-leak legs). This
    //    used to be CI-only; a local build:verify pass now also catches it, and — because
    //    build:verify never runs in CI (no workflow invokes it) — runs the FULL scan (no
    //    --tracked-only), the more thorough local pre-commit posture (also flags
    //    untracked-but-shareable cruft, not just already-tracked paths).
    {
      name: "full share-dot-guild audit (dot-guild/audit.ts CLI)",
      cmd: "npx",
      args: ["tsx", join(SCRIPTS_DIR, "dot-guild", "audit.ts"), `--workspace=${PLUGIN_ROOT}`],
      cwd: SCRIPTS_DIR,
    },
    // 7. generate + validate the support matrix — reads COMMITTED receipts, runs the
    //    two-field AC-RUN-3 host-support gate + AC-REG-4 registry validation, NEVER re-runs
    //    smoke (§6.5). Exits non-zero on a gate/validation fail.
    {
      name: "generate + validate support matrix (host-support gate)",
      cmd: "npx",
      args: ["tsx", join(SCRIPTS_DIR, "generate-support-matrix.ts"), ...matrixArgs()],
      cwd: SCRIPTS_DIR,
    },
  ];
}

/** Pass-through matrix args (e.g. `--generated-at` for a deterministic build). */
function matrixArgs(): string[] {
  const genAt = arg("--generated-at");
  return genAt ? ["--generated-at", genAt] : [];
}

/**
 * Operator-only receipt refresh (ADR §8 `--refresh-receipts`). Re-probes reachable hosts
 * on THIS box and recaptures stale/changed committed receipts BEFORE the verify chain.
 * Returns the harness exit code; a non-zero here fails the whole command fail-fast.
 */
function refreshReceipts(): number {
  const label = "[build:verify] pre-step — refresh committed receipts (operator box, ADR §8)";
  console.log(`${label}\n${"─".repeat(Math.min(label.length, 72))}`);
  console.log(
    "  NOTE: if this promotes a host to a verified public state for the FIRST time, set its\n" +
      "  achieved_floor in scripts/lib/host-public-state.ts (HOST_EXPECTED_STATE) in the SAME\n" +
      "  commit as the receipt — step 7's gate rejects a verified state with a null/mismatched\n" +
      "  floor (ADR §5.3 (c)).",
  );
  const smokeArgs = ["tsx", join(SCRIPTS_DIR, "host-smoke.ts"), "--all-reachable"];
  const capturedAt = arg("--generated-at");
  if (capturedAt) smokeArgs.push("--captured-at", capturedAt);
  const res = spawnSync("npx", smokeArgs, { cwd: SCRIPTS_DIR, stdio: "inherit" });
  if (res.error) {
    console.error(`[build:verify] refresh-receipts spawn error: ${res.error.message}`);
    return res.status ?? 1;
  }
  return res.status ?? 1;
}

function main(): void {
  const refresh = process.argv.includes("--refresh-receipts");
  console.log(
    `[build:verify] verified-multi-host-support — top-level build/verify chain (ADR §8)` +
      (refresh ? " · --refresh-receipts (operator box)" : ""),
  );

  // Operator-only pre-step: refresh receipts on this box before the verify chain.
  if (refresh) {
    const rc = refreshReceipts();
    if (rc !== 0) {
      console.error(`\n[build:verify] FAILED at refresh-receipts (exit ${rc}). Chain aborted (fail-fast).`);
      process.exit(rc);
    }
  }

  const steps = buildChain();
  const total = steps.length;
  for (let i = 0; i < steps.length; i++) {
    const rc = runStep(steps[i], i + 1, total);
    if (rc !== 0) {
      console.error(`\n[build:verify] FAILED at step ${i + 1}/${total} — ${steps[i].name} (exit ${rc}).`);
      console.error(`[build:verify] fail-fast: remaining ${total - i - 1} step(s) skipped. Overall exit ${rc}.`);
      process.exit(rc);
    }
  }
  console.log(`\n[build:verify] ✓ all ${total} steps PASSED — build + verify GREEN end-to-end.`);
}

if (require.main === module) main();

export { buildChain, MCP_SERVERS };
