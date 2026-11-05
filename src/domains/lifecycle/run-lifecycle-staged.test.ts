import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRunLifecycle, createRealEnv } from "./run-lifecycle";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-a08-stage-"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, ".guild", "config"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "guild.yaml"), "schema_version: guild.root.v1\nkind: project\n");
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), "parent-orchestration-run\n");
  const env = createRealEnv(root, requested => ({ requested, resolved: "codex" }));
  env.now = () => "2026-10-25T23:00:00.000Z";
  const lifecycle: any = createRunLifecycle(env);
  const opts = { command: "/guild:build", arguments: { brief: "No-cost staged fixture" }, cwd: root, root,
    target_kind: "existing_guild_project", workspace: { is_workspace: false, root }, project: "fixture",
    host_requested: "codex", model_tier_policy: "explicit", ignore_policy: "project", scan_policy: "none", initiative: null,
    session_identity: { envelope_host: "codex", active_model: "explicit-fixture-model" } };
  return { root, env, lifecycle, opts, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function census(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir,n); if(fs.statSync(p).isDirectory())walk(p); else out[path.relative(root,p)] = fs.readFileSync(p,"utf8"); } };
  walk(root); return out;
}
it("staged lifecycle start is private and materializes exact lifecycle-owned bytes without changing parent sentinel", () => {
  const f = fixture(); try {
    const before = census(f.root);
    expect(typeof f.lifecycle.stageRunStart).toBe("function");
    const plan = f.lifecycle.stageRunStart(f.opts, { detached: true });
    expect(plan.schema_version).toBe("guild.run_start_plan.v1");
    expect(plan.run_id).toMatch(/^run-20261025-230000-/);
    expect(census(f.root)).toEqual(before);
    expect(plan.files.some((v: any) => v.path.endsWith("/run.yaml"))).toBe(true);
    expect(f.lifecycle.materializeRunStart(plan)).toBe(plan.run_id);
    for (const file of plan.files) expect(fs.readFileSync(path.join(f.root, file.path), "utf8")).toBe(file.bytes);
    expect(fs.readFileSync(path.join(f.root,".guild/runs/current-run-id"),"utf8")).toBe("parent-orchestration-run\n");
  } finally { f.close(); }
});
it("staged lifecycle start rejects modified plan bytes and an occupied run identity before canonical writes", () => {
  const f = fixture(); try {
    expect(typeof f.lifecycle.stageRunStart).toBe("function");
    const plan = f.lifecycle.stageRunStart(f.opts, { detached: true });
    const corrupted = structuredClone(plan); corrupted.files[0].bytes += "tamper";
    expect(() => f.lifecycle.materializeRunStart(corrupted)).toThrow();
    const dir = path.join(f.root,".guild/runs",plan.run_id); fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,"foreign.txt"),"foreign owner");
    expect(() => f.lifecycle.materializeRunStart(plan)).toThrow();
    expect(fs.readdirSync(dir)).toEqual(["foreign.txt"]);
  } finally { f.close(); }
});
