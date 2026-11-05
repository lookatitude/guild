import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function fixture() {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "guild-a08-managed-"));
  let api: any; try { api = await import("./managed-run"); } catch(error) { fs.rmSync(runtime,{recursive:true,force:true}); throw error; }
  return { runtime, api, close: () => fs.rmSync(runtime,{recursive:true,force:true}) };
}
it("managed ownership claim is durable and replay cannot admit another process", async () => {
  const f = await fixture(); try {
    const input = { source_id:"source:fixture", operation_id:"op-fixture", run_id:"run-20261025-230000-fixture", attempt_id:"attempt-1", launch_hash:"sha256:"+"a".repeat(64), max_duration_ms:30000 };
    const first = f.api.claimManagedAttempt(f.runtime,input);
    expect(first.created).toBe(true);
    const replay = f.api.claimManagedAttempt(f.runtime,input);
    expect(replay.created).toBe(false);
    expect(replay.identity).toEqual(first.identity);
    expect(() => f.api.claimManagedAttempt(f.runtime,{...input,launch_hash:"sha256:"+"b".repeat(64)})).toThrow();
  } finally { f.close(); }
});
it("unknown dispatch acceptance reconciles to recovery_needed without an automatic relaunch", async () => {
  const f = await fixture(); try {
    const claim = f.api.claimManagedAttempt(f.runtime,{ source_id:"source:fixture",operation_id:"op-uncertain",run_id:"run-20261025-230000-uncertain",attempt_id:"attempt-1",launch_hash:"sha256:"+"a".repeat(64),max_duration_ms:30000 });
    const result = f.api.reconcileManagedAttempt(f.runtime,claim.identity,{ verifyOwnedWorker: () => false });
    expect(result.state).toBe("recovery_needed");
    expect(result.can_relaunch).toBe(false);
  } finally { f.close(); }
});
it("strict monetary admission refuses unqualified and zero budgets before any process or lifecycle effect", async () => {
  const f = await fixture(); try {
    for(const max_usd of [0,1]) expect(() => f.api.assertManagedBudgetAdmission({max_usd,mode:"strict",qualified:false})).toThrow();
    expect(fs.readdirSync(f.runtime)).toEqual([]);
  } finally { f.close(); }
});
