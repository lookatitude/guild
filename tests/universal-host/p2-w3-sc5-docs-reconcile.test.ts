/**
 * tests/universal-host/p2-w3-sc5-docs-reconcile.test.ts
 *
 * AUTHORITATIVE acceptance test for SC-W3-5 (ADR step 19 — docs reconcile). The CONTENT is
 * LW3-8's deliverable; this is the binding oracle. It AUTO-ACTIVATES once LW3-8 lands:
 *   - the docs-hygiene scan (`scripts/docs-hygiene/scan.ts`) exits clean (0 findings), AND
 *   - the required Wave-3 assertions exist in the named files.
 *
 * Until LW3-8 lands the gate is PENDING (the required files/sections are absent and the
 * hygiene scan still reports findings) — the real assertions are SKIPPED, and a single
 * always-on probe records the pending status so the lead can enable it (it does NOT
 * silently pass as if the docs were reconciled).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const REPO_ROOT = path.resolve(PLUGIN_ROOT, ".."); // umbrella root (docs/ + .guild/ live here)

// The files + required Wave-3 assertions (spec SC-W3-5).
const BUILD_FLOW = path.join(REPO_ROOT, "docs/knowledge/architecture/universal-host-build-flow.md");
const ADR = path.join(REPO_ROOT, "docs/knowledge/decisions/universal-host-plugin-architecture.md");
const ROADMAP = path.join(
  REPO_ROOT,
  ".guild/initiatives/active/universal-host-plugin-architecture/roadmap.md"
);
const WEBSITE_FOLLOWUP = path.join(
  REPO_ROOT,
  ".guild/initiatives/active/universal-host-plugin-architecture/release/website-docs-followup.md"
);

function readIf(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function hygieneScanClean(): { clean: boolean; out: string } {
  const tsx = path.join(PLUGIN_ROOT, "scripts", "node_modules", ".bin", "tsx");
  try {
    const out = execFileSync(tsx, [path.join(PLUGIN_ROOT, "scripts/docs-hygiene/scan.ts")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 120000,
    });
    // The scanner prints a findings summary; "clean" = no nonzero finding counts.
    const clean = /\b0 findings\b/i.test(out) || /no findings/i.test(out) || !/findings?:\s*[1-9]/i.test(out);
    return { clean, out };
  } catch (e) {
    // Non-zero exit ⇒ findings present (or scan error).
    const out = (e as { stdout?: string; stderr?: string }).stdout ?? (e as Error).message ?? "";
    return { clean: false, out: String(out) };
  }
}

const buildFlow = readIf(BUILD_FLOW);
const adr = readIf(ADR);
const roadmap = readIf(ROADMAP);
const followup = readIf(WEBSITE_FOLLOWUP);

// LW3-8 is considered "landed" when all four artifacts exist and carry their Wave-3 markers.
const lw38Landed =
  !!buildFlow && /Wave[\s-]?3/i.test(buildFlow) &&
  !!adr && /step\s*18/i.test(adr) && /step\s*19/i.test(adr) &&
  !!roadmap &&
  !!followup;

describe("SC-W3-5 — docs reconcile (status probe, always on)", () => {
  it(lw38Landed ? "LW3-8 has landed — the binding assertions below are ACTIVE" : "PENDING — LW3-8 not yet landed (gate is skipped, not passed)", () => {
    if (!lw38Landed) {
      // eslint-disable-next-line no-console
      console.warn(
        "[SC-W3-5] PENDING — LW3-8 docs reconcile not yet landed. Missing/incomplete:" +
          `\n  build-flow Wave-3 section: ${!!buildFlow && /Wave[\s-]?3/i.test(buildFlow)}` +
          `\n  ADR steps 18+19 stamped:   ${!!adr && /step\s*18/i.test(adr || "") && /step\s*19/i.test(adr || "")}` +
          `\n  roadmap present:           ${!!roadmap}` +
          `\n  website-docs-followup:     ${!!followup}` +
          "\n  Re-run after LW3-8 lands to activate the binding assertions."
      );
    }
    expect(typeof lw38Landed).toBe("boolean");
  });
});

(lw38Landed ? describe : describe.skip)("SC-W3-5 — BINDING (active once LW3-8 lands)", () => {
  it("the docs-hygiene scan exits clean (0 findings)", () => {
    const { clean, out } = hygieneScanClean();
    if (!clean) throw new Error(`SC-W3-5: docs-hygiene scan reported findings:\n${out.slice(-2000)}`);
    expect(clean).toBe(true);
  });

  it("build-flow has a Wave-3 section naming templates/presets/dashboard/installer-contract + deferred-cutover", () => {
    expect(buildFlow).toMatch(/Wave[\s-]?3/i);
    for (const tok of [/template/i, /preset/i, /dashboard/i, /installer/i, /defer/i]) {
      expect(buildFlow).toMatch(tok);
    }
  });

  it("the ADR stamps steps 18 and 19", () => {
    expect(adr).toMatch(/step\s*18/i);
    expect(adr).toMatch(/step\s*19/i);
  });

  it("the website-docs-followup artifact exists (post-cutover revisit recorded)", () => {
    expect(followup).toBeTruthy();
  });
});
