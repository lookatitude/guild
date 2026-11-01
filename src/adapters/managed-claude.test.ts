import { execFileSync } from "node:child_process";
import { it, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
it("native Claude builder pins no-tools safe settings, explicit model/session and honest threshold while zero/codex refuse",async()=>{
 const api=await import("./managed-claude");const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"guild-claude-plan-")));
 try{const input={sourceRoot:root,host_id:"claude-code-cli",model:"claude-haiku-4-5-20251001",brief:"Reply with READY only.",max_usd:0.01,max_duration_ms:30000,native_session_id:"71da0f7c-1234-4567-9123-72a6534fb176",operation:"run.start",qualification:"probe"};const plan=api.buildManagedClaudeLaunch(input);
 expect(plan.classification).toBe("qualification_probe");expect(plan.strict_usd_qualified).toBe(false);expect(plan.budget_mode).toBe("native_estimated_spend_threshold");expect(plan.args).toContain("--safe-mode");expect(plan.args).toContain("--restricted");expect(plan.args).not.toContain("--bare");expect(plan.args).not.toContain("--no-session-persistence");expect(plan.args[plan.args.indexOf("--tools")+1]).toBe("");expect(plan.args[plan.args.indexOf("--setting-sources")+1]).toBe("");expect(plan.args[plan.args.indexOf("--session-id")+1]).toBe(input.native_session_id);expect(plan.args[plan.args.indexOf("--max-budget-usd")+1]).toBe("0.01");expect(Object.keys(plan.env).some(key=>/TOKEN|API_KEY|GUILD_RUN_ID|CLAUDECODE/.test(key))).toBe(false);
 expect(()=>api.buildManagedClaudeLaunch({...input,max_usd:0})).toThrow();expect(()=>api.buildManagedClaudeLaunch({...input,host_id:"codex-cli"})).toThrow();expect(()=>api.buildManagedClaudeLaunch({...input,model:"some-alias"})).toThrow();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
it("native result parser retains safe session/model/estimate provenance and treats reset/truncation as unknown",async()=>{
 const api=await import("./managed-claude");const session="71da0f7c-1234-4567-9123-72a6534fb176",model="claude-haiku-4-5-20251001";
 const records=[{type:"assistant",uuid:"msg-safe",session_id:session,message:{model,content:[{type:"text",text:"never persist opaque-response"}]}},{type:"result",subtype:"success",uuid:"result-safe",session_id:session,total_cost_usd:0.007,usage:{input_tokens:31,output_tokens:2}}];
 const parser=api.createManagedClaudeParser({session_id:session,model,baseline_usd:0});for(const event of records)parser.push(Buffer.from(JSON.stringify(event)+"\n"));const result=parser.finish();expect(result.state).toBe("observed_native_estimate");expect(result.cost_usd).toBe(0.007);expect(result.basis).toBe("api_equivalent_native_estimate");expect(result.native_session_id).toBe(session);expect(result.model).toBe(model);expect(JSON.stringify(result)).not.toContain("opaque-response");
 const reset=api.createManagedClaudeParser({session_id:session,model,baseline_usd:0.01});for(const event of records)reset.push(Buffer.from(JSON.stringify(event)+"\n"));expect(reset.finish().state).toBe("unknown");
 const truncated=api.createManagedClaudeParser({session_id:session,model,baseline_usd:0});truncated.push(Buffer.alloc(1048577,120));expect(truncated.finish().state).toBe("unknown");
});

it("private candidate admission is source/package/profile bound and a schema toggle cannot become normal observed qualification",async()=>{
 const api=await import("./managed-claude"),state=await import("../domains/state");const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),"guild-native-auth-"))),source=path.join(root,"project"),pkg=path.join(root,"package");try{
 fs.mkdirSync(path.join(source,".guild"),{recursive:true});execFileSync("git",["init","--quiet",source]);fs.writeFileSync(path.join(source,".guild/guild.yaml"),"schema_version: guild.root.v1\nkind: project\n");fs.mkdirSync(path.join(pkg,"runtime/scripts"),{recursive:true});for(const name of ["stack-operations","stack-run-worker","stack-qualify-host"])fs.writeFileSync(path.join(pkg,"runtime/scripts",name+".js"),"fixed fixture "+name);
 const p=api.MANAGED_CLAUDE_PROFILE,hash=(name:string)=>state.stackHash(fs.readFileSync(path.join(pkg,"runtime/scripts",name+".js"))),auth={schema_version:"guild.stack.managed_candidate_authorization.v1",source_root:source,source_id:new state.StackScope(source).discover().root.source_id,package_root:pkg,facade_sha256:hash("stack-operations"),worker_sha256:hash("stack-run-worker"),operator_entry_sha256:hash("stack-qualify-host"),host_binary_sha256:p.binary_sha256,model:p.model,profile:p.profile,policy_sha256:p.policy_sha256,review_manifest_sha256:"sha256:"+"a".repeat(64),allowed_operations:["run.start","run.rerun"],max_queries:6,aggregate_estimate_stop_usd:0.1};const file=path.join(root,"authorization.json");fs.writeFileSync(file,JSON.stringify(auth),{mode:0o600});
 expect(api.createManagedClaudeRuntime({sourceRoot:source,packageRoot:pkg,authorizationFile:file}).availability).toEqual(["run.start","run.rerun"]);
 fs.writeFileSync(file,JSON.stringify({...auth,schema_version:"guild.stack.managed_host_qualification.v1"}));expect(()=>api.createManagedClaudeRuntime({sourceRoot:source,packageRoot:pkg,authorizationFile:file})).toThrow();
 fs.writeFileSync(file,JSON.stringify({...auth,source_id:"source:foreign"}));expect(()=>api.createManagedClaudeRuntime({sourceRoot:source,packageRoot:pkg,authorizationFile:file})).toThrow();
 fs.writeFileSync(file,JSON.stringify(auth));fs.chmodSync(file,0o644);expect(()=>api.createManagedClaudeRuntime({sourceRoot:source,packageRoot:pkg,authorizationFile:file})).toThrow();
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
