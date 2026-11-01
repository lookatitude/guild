import { stackValidator } from "../../scripts/lib/stack-contract-validator";
import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRunLifecycle, createRealEnv, claimManagedAttempt, managedLaunchHash, readManagedAttempt, runManagedWorker, type ManagedLaunchSpec } from "../domains/lifecycle";
import { StackScope } from "../domains/state";
import { ManagedNodeProcessPort, ManagedLocalControlPort, requestManagedControl } from "./managed-node-process";
function fixture(script:string,duration=3000) {
  const home=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"guild-managed-real-"))),root=path.join(home,"project"),runtime=path.join(home,"runtime");
  fs.mkdirSync(root,{recursive:true});execFileSync("git",["init","--quiet",root]);fs.mkdirSync(path.join(root,".guild/runs"),{recursive:true});fs.writeFileSync(path.join(root,".guild/guild.yaml"),"schema_version: guild.root.v1\nkind: project\n");fs.writeFileSync(path.join(root,".guild/runs/current-run-id"),"parent-sentinel\n");
  const lifecycle=createRunLifecycle(createRealEnv(root,requested=>({requested,resolved:"codex"})));
  const plan=lifecycle.stageRunStart({command:"/guild:build",arguments:{brief:"Local process test"},cwd:root,root,target_kind:"existing_guild_project",workspace:{is_workspace:false,root},project:"fixture",host_requested:"codex",model_tier_policy:"explicit",ignore_policy:"project",scan_policy:"none",initiative:null,session_identity:{envelope_host:"codex",active_model:"local-process-test"}},{detached:true});lifecycle.materializeRunStart(plan);
  const binary=fs.realpathSync(execFileSync("which",["node"],{encoding:"utf8"}).trim()),launch:ManagedLaunchSpec={binary,binary_sha256:"sha256:"+createHash("sha256").update(fs.readFileSync(binary)).digest("hex"),args:["-e",script],cwd:root,env:{PATH:process.env.PATH??""},max_duration_ms:duration,classification:"local_process_test",host_id:"local-test",model:"none",max_usd:0,strict_usd_qualified:false};
  const identity=claimManagedAttempt(runtime,{source_id:new StackScope(root).discover().root.source_id,operation_id:"op-process",run_id:plan.run_id,attempt_id:"attempt-1",launch_hash:managedLaunchHash(launch),max_duration_ms:duration}).identity;
  const dir=path.join(root,".guild/runs",plan.run_id,"attempts/attempt-1");
  return {home,root,runtime,launch,identity,dir,plan,run:()=>runManagedWorker({runtimeDir:runtime,sourceRoot:root,identity,launch,process:new ManagedNodeProcessPort(),control:new ManagedLocalControlPort(runtime),graceMs:50}),close:()=>fs.rmSync(home,{recursive:true,force:true})};
}
it("managed real child produces immutable safe intent and bounded output digest without raw output or nonce",async()=>{
 const f=fixture("setTimeout(()=>{process.stdout.write('x'.repeat(1200000));process.stderr.write('opaque-private-output');},100)");try{
 const outcome=await f.run();stackValidator()("https://guildstack.dev/contracts/guild-stack/p05/v1/managed-run.schema.json#/$defs/outcome",outcome);expect(outcome.state).toBe("exited");expect(outcome.exit_code).toBe(0);expect(outcome.output.bytes).toBeGreaterThan(1048576);expect(outcome.output.retained_bytes).toBe(0);expect(outcome.output.hashed_bytes).toBe(1048576);
 const intent=JSON.parse(fs.readFileSync(path.join(f.dir,"intent.json"),"utf8"));stackValidator()("https://guildstack.dev/contracts/guild-stack/p05/v1/managed-run.schema.json#/$defs/intent",intent);expect(intent.max_duration_ms).toBe(3000);expect(intent.deadline_derivation).toBe("admitted_at + max_duration_ms");expect(intent.deadline_at).toBeUndefined();
 const nonce=readManagedAttempt(f.runtime,f.identity.attempt_id).worker_nonce;const publicBytes=fs.readdirSync(f.dir).map(n=>fs.readFileSync(path.join(f.dir,n),"utf8")).join("");expect(publicBytes.includes(nonce)).toBe(false);expect(publicBytes.includes(f.plan.private_binding_ref)).toBe(false);expect(publicBytes.includes("opaque-private-output")).toBe(false);expect(fs.readFileSync(path.join(f.root,".guild/runs/current-run-id"),"utf8")).toBe("parent-sentinel\n");expect(outcome.usage.cost_usd).toBeNull();
 await expect(f.run()).rejects.toThrow();
 }finally{f.close();}
});
it("managed real process group hard deadline kills an interrupt-ignoring child and records actual admission-derived deadline",async()=>{
 const f=fixture("process.on('SIGINT',()=>{});setInterval(()=>{},100)",500);try{const outcome=await f.run();expect(outcome.state).toBe("timed_out");expect(Date.parse(outcome.deadline_at)-Date.parse(outcome.admitted_at)).toBe(500);expect(outcome.signal).toBe("SIGKILL");}finally{f.close();}
});
it("managed authenticated cancel refuses foreign nonce and stops only the admitted owned group",async()=>{
 const f=fixture("process.on('SIGINT',()=>{});setInterval(()=>{},100)",4000);try{
 const running=f.run();for(let i=0;i<100&&readManagedAttempt(f.runtime,f.identity.attempt_id).state!=="running";i++)await new Promise(r=>setTimeout(r,10));const claim=readManagedAttempt(f.runtime,f.identity.attempt_id);
 await expect(requestManagedControl(f.runtime,f.identity,"wrong-nonce","cancel")).rejects.toThrow();expect(readManagedAttempt(f.runtime,f.identity.attempt_id).state).toBe("running");
 const accepted=await requestManagedControl(f.runtime,f.identity,claim.worker_nonce,"cancel");expect(accepted.cancel_requested).toBe(true);expect(JSON.stringify(accepted).includes(claim.worker_nonce)).toBe(false);expect((await running).state).toBe("cancelled");
 }finally{f.close();}
});

it("compiled detached supervisor survives facade release and reconciles from a fresh control connection",async()=>{
 const f=fixture("setTimeout(()=>process.stdout.write('done'),500)",3000);try{
 const api=await import("../domains/lifecycle");const adapter=await import("./managed-node-process");
 const entry=path.join(f.home,"worker.js");const compiler=await import("../../scripts/compile");compiler.buildOne(compiler.targets().find(target=>target.id==="scripts/stack-run-worker")!,entry);
 execFileSync(f.launch.binary,["-e","require("+JSON.stringify(entry)+")"],{stdio:"pipe"});
 const worker={node_binary:f.launch.binary,node_sha256:f.launch.binary_sha256,entry,entry_sha256:"sha256:"+createHash("sha256").update(fs.readFileSync(entry)).digest("hex")};
 api.prepareManagedWorker(f.runtime,{sourceRoot:f.root,identity:f.identity,launch:f.launch,worker});
 const handle=adapter.launchManagedWorker(f.runtime,f.identity,worker);expect(handle.pid).toBeGreaterThan(0);
 for(let i=0;i<200&&!readManagedAttempt(f.runtime,f.identity.attempt_id).outcome;i++)await new Promise(r=>setTimeout(r,10));
 const claim=readManagedAttempt(f.runtime,f.identity.attempt_id);if(!claim.outcome)throw new Error(JSON.stringify({state:claim.state,failure:fs.existsSync(path.join(f.runtime,"attempt-1.failure.json"))?JSON.parse(fs.readFileSync(path.join(f.runtime,"attempt-1.failure.json"),"utf8")):null}));expect(claim.outcome?.state).toBe("exited");expect(api.reconcileManagedAttempt(f.runtime,f.identity,{verifyOwnedWorker:()=>false}).outcome).toEqual(claim.outcome);
 expect(()=>adapter.launchManagedWorker(f.runtime,f.identity,worker)).toThrow();
 }finally{f.close();}
});
