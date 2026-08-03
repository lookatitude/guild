/**
 * tests/universal-host/check-surface-pins.test.ts
 *
 * CI enforcement + falsifiability for the G6b checklist-as-code
 * (`check-surface-pins.ts`). Two obligations:
 *   1. The COMMITTED tree is clean — `checkSurfacePins()` returns ok with zero
 *      violations. This is the standing green that a surface-editing lane's
 *      re-extraction + re-ratification must restore before it commits.
 *   2. The detector is LIVE — injected synthetic drift (a wrong ratified tree, a
 *      tampered registry) produces the exact violation + remedy. Anti-vacuity: a
 *      detector that always returned `ok` would pass obligation 1 and be useless.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  checkSurfacePins,
  renderSurfacePinReport,
  type SurfacePinReport,
} from "./check-surface-pins";
import { RATIFIED_TREES } from "./live-surface-anchor";

describe("check-surface-pins — committed tree is clean (CI standing green)", () => {
  it("reports ok with zero violations against the committed registries + pins", () => {
    const report = checkSurfacePins();
    if (!report.ok) {
      // Surface the actionable checklist in the failure output.
      throw new Error(renderSurfacePinReport(report));
    }
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
  });
});

describe("check-surface-pins — detector is live (falsifiability)", () => {
  it("FLAGS a stale skills tree pin with the re-ratify remedy", () => {
    const report = checkSurfacePins({
      ratifiedTrees: { ...RATIFIED_TREES, skills: "0".repeat(40) },
    });
    expect(report.ok).toBe(false);
    const v = report.violations.find(
      (x) => x.kind === "tree_pin_stale" && x.surface === "skills",
    );
    expect(v).toBeDefined();
    expect(v!.remedy).toContain("re-ratify RATIFIED_TREES");
  });

  it("FLAGS a stale commands tree pin independently", () => {
    const report = checkSurfacePins({
      ratifiedTrees: { ...RATIFIED_TREES, commands: "0".repeat(40) },
    });
    expect(
      report.violations.some((x) => x.kind === "tree_pin_stale" && x.surface === "commands"),
    ).toBe(true);
  });

  it("FLAGS a tampered skill registry (render ≠ committed) with the re-extract remedy", () => {
    // Copy the real registry, corrupt one WAVE2 body, point the check at the copy.
    const realPath = path.resolve(__dirname, "../..", "skill-src", "skill-registry.json");
    const registry = JSON.parse(fs.readFileSync(realPath, "utf8")) as {
      schema_version: string;
      skills: { id: string; body: string }[];
    };
    const target = registry.skills.find((s) => s.id === "execute-plan")!;
    target.body = target.body + "\nDRIFT INJECTED\n";
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "surface-pins-")), "reg.json");
    fs.writeFileSync(tmp, JSON.stringify(registry));

    const report = checkSurfacePins({ skillRegistryPath: tmp });
    const v = report.violations.find(
      (x) => x.kind === "registry_stale" && x.id === "execute-plan",
    );
    expect(v).toBeDefined();
    expect(v!.remedy).toContain("re-extract skill-src/skill-registry.json");
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  });

  it("FLAGS a command file present on disk but ABSENT from the registry (F1 id-set)", () => {
    // Drop one command entry from a registry copy → on-disk stems ≠ registry ids.
    const realPath = path.resolve(__dirname, "../..", "command-src", "command-registry.json");
    const registry = JSON.parse(fs.readFileSync(realPath, "utf8")) as {
      commands: { id: string }[];
    };
    registry.commands.pop();
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-idset-")), "reg.json");
    fs.writeFileSync(tmp, JSON.stringify(registry));
    const report = checkSurfacePins({ commandRegistryPath: tmp });
    expect(
      report.violations.some(
        (v) => v.kind === "registry_stale" && v.surface === "commands" && v.detail.includes("on-disk"),
      ),
    ).toBe(true);
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  });

  it("FLAGS a structurally-invalid command registry (F1 validity)", () => {
    const realPath = path.resolve(__dirname, "../..", "command-src", "command-registry.json");
    const registry = JSON.parse(fs.readFileSync(realPath, "utf8")) as Record<string, unknown> & {
      commands: unknown[];
    };
    (registry.commands[0] as Record<string, unknown>).unknown_junk_key = true;
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cmd-invalid-")), "reg.json");
    fs.writeFileSync(tmp, JSON.stringify(registry));
    const report = checkSurfacePins({ commandRegistryPath: tmp });
    expect(
      report.violations.some(
        (v) => v.kind === "registry_stale" && v.detail.includes("fail-closed-valid"),
      ),
    ).toBe(true);
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  });

  it("FLAGS a skill registry whose id-set drifts from WAVE2 (F1 id-set)", () => {
    const realPath = path.resolve(__dirname, "../..", "skill-src", "skill-registry.json");
    const registry = JSON.parse(fs.readFileSync(realPath, "utf8")) as { skills: { id: string }[] };
    registry.skills.pop();
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "skill-idset-")), "reg.json");
    fs.writeFileSync(tmp, JSON.stringify(registry));
    const report = checkSurfacePins({ skillRegistryPath: tmp });
    expect(
      report.violations.some(
        (v) => v.kind === "registry_stale" && v.surface === "skills" && v.detail.includes("WAVE2"),
      ),
    ).toBe(true);
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  });

  it("renders an actionable multi-line checklist on drift", () => {
    const drifted: SurfacePinReport = checkSurfacePins({
      ratifiedTrees: { ...RATIFIED_TREES, skills: "0".repeat(40) },
    });
    const text = renderSurfacePinReport(drifted);
    expect(text).toContain("[surface-pins] DRIFT");
    expect(text).toContain("compute pins AFTER sync");
    expect(text).toContain("sync-module-resources");
  });
});
