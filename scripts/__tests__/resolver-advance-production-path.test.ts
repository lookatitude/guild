/**
 * scripts/__tests__/resolver-advance-production-path.test.ts
 *
 * FIC45-A4-B1 — `advanceResolverModeOnApproval` must have a REAL production
 * caller. The docs (docs/v2/config-surfaces.html §capability.*) call it "the one
 * production advance path"; the adversarial docs review refused that claim
 * because only the declarations existed. The wiring under test here:
 *
 *   applyAdoptionPlan (real, non-dry-run, ≥1 entry appended — the D04 "approved
 *   capability proposal" transition) → applyResolverModeAdvanceOnApproval
 *   (config-reconcile.ts, the single persist wrapper) →
 *   advanceResolverModeOnApproval (the L0 contract) → .guild/settings.json +
 *   .guild/settings.provenance.json.
 *
 * Five obligations, each a row below:
 *   1. default-off compatibility — a project with no settings.json adopts
 *      cleanly and is never implicitly config-scaffolded;
 *   2. eligible advance — observe + reconcilable provenance + on_approval
 *      policy advances to project-local through the REAL apply;
 *   3. ineligible refusal — policy `never` and user-pinned mode both refuse,
 *      bytes untouched;
 *   4. persisted config result — the advance survives a disk re-read, stamps
 *      provenance `reconciled`, and a second approval is `already_at_target`;
 *   5. planted missing-caller/bypass controls — dry-run (full approval
 *      validation, no transaction) moves nothing, and with the single advance
 *      entrypoint stubbed out nothing else moves the config either, so row 2's
 *      signal can only come from the wired caller.
 *
 * All rows run on the real filesystem; the CLI row goes through the real
 * `capability-adopt adopt` verb with no injected seams (the recurring
 * injected-seam-tests-mask-real-path-misses defect class is exactly what this
 * file exists to prevent).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { applyAdoptionPlan, buildAdoptionReport } from "../lib/capability/adoption-migrate";
import {
  RESOLVER_ADVANCE_TARGET,
  applyResolverModeAdvanceOnApproval,
  defaultReconcileIO,
} from "../lib/config-reconcile";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const AT = "2026-08-17T09:00:00Z";

type Flat = Record<string, unknown> & { status: string };
const flat = (v: unknown): Flat => v as unknown as Flat;

let tmp: string;

function write(rel: string, body: string): void {
  const abs = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf8");
}

function readText(rel: string): string {
  return fs.readFileSync(path.join(tmp, rel), "utf8");
}

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readText(rel)) as Record<string, unknown>;
}

const SETTINGS = ".guild/settings.json";
const SIDECAR = ".guild/settings.provenance.json";

/** Materialize a minimal capability config + optional resolver_mode sidecar record. */
function settingsFixture(opts: {
  mode?: string;
  policy?: string;
  /** Sidecar provenance for resolver_mode; omitted ⇒ no record ⇒ `user`. */
  modeProvenance?: "default" | "reconciled" | "user";
}): void {
  const capability: Record<string, unknown> = {};
  if (opts.mode !== undefined) capability["resolver_mode"] = opts.mode;
  if (opts.policy !== undefined) capability["auto_create_policy"] = opts.policy;
  write(SETTINGS, `${JSON.stringify({ capability }, null, 2)}\n`);
  if (opts.modeProvenance !== undefined) {
    write(
      SIDECAR,
      `${JSON.stringify(
        {
          "capability.resolver_mode": {
            provenance: opts.modeProvenance,
            last_reconciled_at: "2026-08-01T00:00:00Z",
          },
        },
        null,
        2,
      )}\n`,
    );
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-resolver-advance-"));
  // Historical evidence referencing the shipped `qa` template and the
  // `qa-test-strategy` domain skill — same shape as adoption-migrate.test.ts.
  write(
    ".guild/team/feature.build.yaml",
    "specialists:\n  - name: qa\n    definition_source: shipped\n  - name: developer\n    definition_source: shipped\n",
  );
  write(".guild/plan/feature.md", "# plan\n\nLane 1 uses qa-test-strategy for the suite shape.\n");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function apply(over: Record<string, unknown> = {}): Flat {
  return flat(
    applyAdoptionPlan({
      pluginRoot: PLUGIN_ROOT,
      projectRoot: tmp,
      projectId: "demo",
      report: buildAdoptionReport({ pluginRoot: PLUGIN_ROOT, projectRoot: tmp, projectId: "demo" }),
      decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
      runId: "run-20260817-090000-advance",
      authorizedBy: "cap-loc-D04",
      adoptedAt: AT,
      ...over,
    }),
  );
}

const advance = (out: Flat): { advanced: boolean; reason: string } | undefined =>
  out["resolver_advance"] as { advanced: boolean; reason: string } | undefined;

describe("FIC45-A4-B1 — D04 resolver-mode advance fires on the production approval transition", () => {
  it("1. default-off compatibility: no settings.json ⇒ clean apply, no implicit config scaffold", () => {
    expect(fs.existsSync(path.join(tmp, SETTINGS))).toBe(false);
    const out = apply();
    expect(out.status).toBe("applied");
    expect(advance(out)).toEqual({ advanced: false, reason: "settings_absent" });
    // The adoption itself is untouched by the new wiring…
    expect(fs.existsSync(path.join(tmp, ".guild/agents/qa.md"))).toBe(true);
    // …and an un-initialized project is NOT silently given a settings.json.
    expect(fs.existsSync(path.join(tmp, SETTINGS))).toBe(false);
    expect(fs.existsSync(path.join(tmp, SIDECAR))).toBe(false);
  });

  it("2+4. eligible advance persists project-local with provenance `reconciled`", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" }); // policy absent ⇒ schema default on_approval
    const before = readText(SETTINGS);
    const out = apply();
    expect(out.status).toBe("applied");
    expect(advance(out)).toEqual({ advanced: true, reason: "advanced" });
    // Persisted config result — proven from a disk re-read, not the return value.
    const settings = readJson(SETTINGS) as { capability: Record<string, unknown> };
    expect(settings.capability["resolver_mode"]).toBe(RESOLVER_ADVANCE_TARGET);
    expect(readText(SETTINGS)).not.toBe(before); // anti-vacuity: bytes really moved
    const rec = readJson(SIDECAR)["capability.resolver_mode"] as Record<string, unknown>;
    expect(rec).toEqual({ provenance: "reconciled", last_reconciled_at: AT });
  });

  it("3a. ineligible refusal: auto_create_policy `never` leaves every config byte untouched", () => {
    settingsFixture({ mode: "observe", policy: "never", modeProvenance: "default" });
    const before = readText(SETTINGS);
    const sidecarBefore = readText(SIDECAR);
    const out = apply();
    expect(out.status).toBe("applied");
    expect(advance(out)).toEqual({ advanced: false, reason: "policy_never" });
    expect(readText(SETTINGS)).toBe(before);
    expect(readText(SIDECAR)).toBe(sidecarBefore);
  });

  it("3b. ineligible refusal: a user-pinned resolver_mode is immutable to the advance", () => {
    // No sidecar record ⇒ the materialization rule reads the value as `user`.
    settingsFixture({ mode: "legacy" });
    const before = readText(SETTINGS);
    const out = apply();
    expect(out.status).toBe("applied");
    expect(advance(out)).toEqual({ advanced: false, reason: "user_pinned" });
    expect(readText(SETTINGS)).toBe(before);
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe("legacy");
  });

  it("4b. a second approved proposal is `already_at_target` and rewrites nothing", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    expect(advance(apply())).toEqual({ advanced: true, reason: "advanced" });
    const afterFirst = readText(SETTINGS);
    const sidecarAfterFirst = readText(SIDECAR);
    const second = apply({
      decisions: [{ kind: "skill", id: "qa-test-strategy", disposition: "adopt_as_is" }],
      runId: "run-20260817-091500-advance2",
    });
    expect(second.status).toBe("applied");
    expect(advance(second)).toEqual({ advanced: false, reason: "already_at_target" });
    expect(readText(SETTINGS)).toBe(afterFirst);
    expect(readText(SIDECAR)).toBe(sidecarAfterFirst);
  });

  it("5a. bypass control — dry-run runs the full approval validation and moves NO config byte", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    const before = readText(SETTINGS);
    const out = apply({ dryRun: true });
    expect(out.status).toBe("applied");
    // Dry-run models the missing-caller world: were the caller absent, row 2
    // would look exactly like this — which is why row 2 asserting movement is a
    // real detection and not a vacuous pass.
    expect(advance(out)).toBeUndefined();
    expect(readText(SETTINGS)).toBe(before);
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe("observe");
  });

  it("5b. planted bypass control — with the single advance entrypoint stubbed, nothing else moves the config", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    const before = readText(SETTINGS);
    jest.isolateModules(() => {
      jest.doMock("../lib/config-reconcile", () => {
        const actual = jest.requireActual("../lib/config-reconcile");
        return {
          ...actual,
          applyResolverModeAdvanceOnApproval: () => ({
            advanced: false,
            reason: "stubbed_by_bypass_control",
            settings_path: "",
            changed: false,
          }),
        };
      });
      const { applyAdoptionPlan: isolatedApply, buildAdoptionReport: isolatedReport } =
        require("../lib/capability/adoption-migrate") as typeof import("../lib/capability/adoption-migrate");
      const out = flat(
        isolatedApply({
          pluginRoot: PLUGIN_ROOT,
          projectRoot: tmp,
          projectId: "demo",
          report: isolatedReport({ pluginRoot: PLUGIN_ROOT, projectRoot: tmp, projectId: "demo" }),
          decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }],
          runId: "run-20260817-092000-advance3",
          authorizedBy: "cap-loc-D04",
          adoptedAt: AT,
        }),
      );
      expect(out.status).toBe("applied");
      expect(advance(out)).toEqual({ advanced: false, reason: "stubbed_by_bypass_control" });
    });
    jest.dontMock("../lib/config-reconcile");
    // The stub returned "no advance" AND the disk agrees: there is no second,
    // hidden writer — the wired entrypoint is the only thing that moves the mode.
    expect(readText(SETTINGS)).toBe(before);
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe("observe");
  });

  it("6a. failure path: an injected provenance-write failure rolls back settings and reports truthfully", () => {
    // Codex A5 G-lane round 1, item 1: sequential writes could land project-local
    // in settings while the sidecar write failed — the mode would later read as
    // user-pinned. The wrapper must leave NO partial state and must not report a
    // clean no-op after mutating disk.
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    const settingsBefore = readText(SETTINGS);
    const sidecarBefore = readText(SIDECAR);
    const real = defaultReconcileIO();
    const failingIo = {
      ...real,
      writeFileText: (p: string, text: string) => {
        if (p.endsWith("settings.provenance.json")) throw new Error("injected provenance write failure");
        real.writeFileText(p, text);
      },
    };
    const out = applyResolverModeAdvanceOnApproval({ cwd: tmp, now: AT, io: failingIo });
    expect(out.advanced).toBe(false);
    expect(out.changed).toBe(false);
    expect(out.reason).toBe("write_failed: injected provenance write failure");
    // No partial state: BOTH files byte-identical to before the call.
    expect(readText(SETTINGS)).toBe(settingsBefore);
    expect(readText(SIDECAR)).toBe(sidecarBefore);
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe("observe");
  });

  it("6b. failure path: a failed rollback is reported as write_failed_partial with changed:true, never a clean no-op", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    const real = defaultReconcileIO();
    let settingsWrites = 0;
    const failingIo = {
      ...real,
      writeFileText: (p: string, text: string) => {
        if (p.endsWith("settings.provenance.json")) throw new Error("injected provenance write failure");
        if (p.endsWith("settings.json")) {
          settingsWrites += 1;
          if (settingsWrites > 1) throw new Error("injected rollback failure"); // the restore write
        }
        real.writeFileText(p, text);
      },
    };
    const out = applyResolverModeAdvanceOnApproval({ cwd: tmp, now: AT, io: failingIo });
    expect(out.advanced).toBe(false);
    expect(out.changed).toBe(true); // truthful: disk really moved
    expect(out.reason).toBe(
      "write_failed_partial: injected provenance write failure; rollback failed: injected rollback failure",
    );
    // The partial state this reason describes is real and detectable on disk.
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe(
      RESOLVER_ADVANCE_TARGET,
    );
  });

  it("6c. failure path: a partially created new sidecar is removed during rollback", () => {
    // No resolver_mode and no sidecar: the advance is eligible, and successful
    // persistence would create both. Model a filesystem writer that creates a
    // truncated sidecar before reporting failure.
    settingsFixture({ policy: "on_approval" });
    const settingsBefore = readText(SETTINGS);
    expect(fs.existsSync(path.join(tmp, SIDECAR))).toBe(false);
    const real = defaultReconcileIO();
    const failingIo = {
      ...real,
      writeFileText: (p: string, text: string) => {
        if (p.endsWith("settings.provenance.json")) {
          real.writeFileText(p, text.slice(0, Math.max(1, Math.floor(text.length / 2))));
          throw new Error("injected partial provenance write failure");
        }
        real.writeFileText(p, text);
      },
    };
    const out = applyResolverModeAdvanceOnApproval({ cwd: tmp, now: AT, io: failingIo });
    expect(out).toMatchObject({
      advanced: false,
      changed: false,
      reason: "write_failed: injected partial provenance write failure",
    });
    expect(readText(SETTINGS)).toBe(settingsBefore);
    expect(fs.existsSync(path.join(tmp, SIDECAR))).toBe(false);
  });

  it("2-cli. the real `capability-adopt adopt` verb advances an eligible project (no seams)", () => {
    settingsFixture({ mode: "observe", modeProvenance: "default" });
    const { capabilityAdoptMain } = require("../capability-adopt") as {
      capabilityAdoptMain: (argv: readonly string[]) => number;
    };
    const plan = path.join(tmp, "plan.json");
    fs.writeFileSync(plan, JSON.stringify({ decisions: [{ kind: "agent", id: "qa", disposition: "adopt_as_is" }] }));
    const out: string[] = [];
    const realWrite = process.stdout.write.bind(process.stdout);
    (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => {
      out.push(s);
      return true;
    };
    try {
      expect(
        capabilityAdoptMain([
          "adopt",
          "--project-id", "demo",
          "--project-root", tmp,
          "--plugin-root", PLUGIN_ROOT,
          "--decisions", plan,
          "--run-id", "run-20260817-093000-advcli",
          "--authorized-by", "cap-loc-D04",
          "--adopted-at", AT,
        ]),
      ).toBe(0);
    } finally {
      (process.stdout as unknown as { write: typeof realWrite }).write = realWrite;
    }
    expect(out.join("")).toContain("resolver-mode advance: advanced");
    expect((readJson(SETTINGS) as { capability: Record<string, unknown> }).capability["resolver_mode"]).toBe(
      RESOLVER_ADVANCE_TARGET,
    );
  });
});
