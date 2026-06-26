/**
 * scripts/__tests__/repair.test.ts
 *
 * V7 (init-config-goal §V line 262) — `repairGuildInstall` on an incomplete
 * `.guild/`:
 *   - RESTORES a missing required file (the explicit repair behavior), while
 *   - a MODIFIED user file remains BYTE-IDENTICAL (the spec's explicit anti-vacuity:
 *     repair never clobbers user-authored content), and
 *   - the fail-closed SECURITY reconcile (§E7b) is wired into the repair path.
 *
 * Real-fs, deterministic stamp. Anti-vacuous: the restored file is shown absent
 * before and present after; a healthy install repairs to ZERO creations (so the
 * "restored" assertion is not vacuously true); the user bytes are read back exact.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  initializeGuild,
  repairGuildInstall,
  type SecurityReconcileContext,
  type SecurityReconcileOutcome,
} from "../lib/init-guild";

const NOW = "2026-01-01T00:00:00Z";
const tmps: string[] = [];
afterAll(() => {
  for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ }
});
function mkRoot(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "guild-repair-"));
  tmps.push(d);
  return d;
}

describe("repairGuildInstall — restore-missing + keep-modified byte-identical (V7)", () => {
  it("restores a MISSING required file while a MODIFIED user file stays byte-identical", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: NOW });

    // A user hand-edited project.yaml (marker removed) — repair must NOT clobber it.
    const projectYaml = path.join(root, ".guild", "project.yaml");
    const userContent = "# hand-edited\nname: my-project\nnotes: do not overwrite me\n";
    fs.writeFileSync(projectYaml, userContent);

    // A required floor file is missing → install is installed_needs_repair.
    const codebaseMap = path.join(root, ".guild", "indexes", "codebase-map.json");
    fs.rmSync(codebaseMap);
    expect(fs.existsSync(codebaseMap)).toBe(false); // genuinely absent before repair

    const result = repairGuildInstall(root, { now: NOW });

    // detection drove the repair off the missing required entry
    expect(result.detection.state).toBe("installed_needs_repair");
    expect(result.detection.problem?.problem).toBe("missing_required_manifest_entry");

    // RESTORED — present after, and reported created
    expect(fs.existsSync(codebaseMap)).toBe(true);
    const restored = result.entries.find((e) => e.path === ".guild/indexes/codebase-map.json");
    expect(restored?.status).toBe("created");

    // PRESERVED — the user's modified bytes are untouched (skipped_user_modified)
    const kept = result.entries.find((e) => e.path === ".guild/project.yaml");
    expect(kept?.status).toBe("skipped_user_modified");
    expect(fs.readFileSync(projectYaml, "utf8")).toBe(userContent);

    // fail-closed security reconcile ran as part of repair
    expect(result.security).toBeDefined();
    expect(typeof result.security.applied).toBe("boolean");
  });

  it("anti-vacuity: a HEALTHY install repairs to ZERO creations (restore above was real)", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: NOW });
    const result = repairGuildInstall(root, { now: NOW });
    expect(result.detection.state).toBe("single_project");
    expect(result.entries.filter((e) => e.status === "created")).toEqual([]);
  });

  it("the fail-closed security reconcile seam is invoked in the repair path (mode='repair')", () => {
    const root = mkRoot();
    initializeGuild(root, "single_project", { now: NOW });
    fs.rmSync(path.join(root, ".guild", "indexes", "codebase-map.json"));

    const calls: Array<{ cwd: string; mode: string }> = [];
    const spy = (ctx: SecurityReconcileContext): SecurityReconcileOutcome => {
      calls.push({ cwd: ctx.cwd, mode: ctx.mode });
      return { applied: false, note: "spy", coerced: [] };
    };
    repairGuildInstall(root, { now: NOW, reconcileSecurity: spy });
    expect(calls).toEqual([{ cwd: root, mode: "repair" }]);
  });
});
