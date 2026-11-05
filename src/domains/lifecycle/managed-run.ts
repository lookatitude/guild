import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { StackError, stackHash, stackId, stackContained, createGuildStorage, StackScope } from "../state";
import { canonicalizeRealPath } from "../kernel";
import { createRunLifecycle, createRealEnv, assertCanonicalRunId } from "./run-lifecycle";
import { loadRunBinding } from "./run-binding";
import { sealExecutionSegment, EXECUTION_SEGMENT_SEAL_SCHEMA } from "./execution-identity";
import { resolveManagedRunTarget, managedExitAction, managedOutcomeHash, type ManagedSegmentIntegration } from "./managed-segment";

export interface ManagedAttemptInput {
  source_id: string;
  operation_id: string;
  run_id: string;
  attempt_id: string;
  launch_hash: string;
  max_duration_ms: number;
}
export interface ManagedAttemptIdentity extends ManagedAttemptInput { nonce_hash: string; }
export interface ManagedAttemptClaim {
  schema_version: "guild.stack.managed_private_claim.v1";
  identity: ManagedAttemptIdentity;
  worker_nonce: string;
  admitted_at: string | null;
  deadline_at: string | null;
  state: "claimed" | "running" | "recovery_needed" | "exited" | "cancelled" | "timed_out";
  worker: Record<string,unknown> | null;
  host: Record<string,unknown> | null;
  outcome: ManagedRunOutcome | null;
}
export interface ManagedUsageObservation {state:"unknown"|"observed_native_estimate";cost_usd:number|null;basis:string;native_session_id?:string|null;model?:string|null;result_subtype?:string|null;cumulative_estimate_usd?:number|null;usage?:Record<string,number>;result_sha256?:string|null;parser?:string;reason?:string;}
export interface ManagedRunOutcome {
  schema_version: "guild.stack.managed_run_outcome.v1";
  source_id: string; run_id: string; attempt_id: string;
  state: "exited" | "cancelled" | "timed_out" | "recovery_needed";
  exit_code: number | null; signal: string | null;
  admitted_at: string; ended_at: string; deadline_at: string;
  classification: "local_process_test" | "qualification_probe" | "qualified_host";
  output: { bytes: number; hashed_bytes: number; retained_bytes: 0; prefix_sha256: string };
  usage: ManagedUsageObservation;
}
export interface ManagedLaunchSpec {
  binary: string; binary_sha256: string; args: string[]; cwd: string;
  env: Record<string,string>; max_duration_ms: number;
  classification: "local_process_test" | "qualification_probe" | "qualified_host";
  host_id: string; model: string;
  max_usd: number; strict_usd_qualified: boolean;
  operation?:"run.start"|"run.rerun"|"run.resume";profile?:string;
  budget_mode?: "strict"|"native_estimated_spend_threshold";native_threshold_qualified?:boolean;policy_sha256?:string;native_session_id?:string;native_cost_baseline_usd?:number;leave_resumable?:boolean;
  /** Logical v2 runs only: the execution segment this launch supervises. */
  execution_id?:string;
}
export interface ManagedOwnedProcess {
  identity: Record<string,unknown>;
  exited: Promise<{ exit_code:number|null; signal:string|null }>;
  verifyOwnership(): boolean;
  signalGroup(signal:"SIGINT"|"SIGKILL"): boolean;
  groupGone(): boolean;
  outputSummary?(): ManagedRunOutcome["output"];
  observation?(): ManagedUsageObservation;
}
export interface ManagedProcessPort { start(spec:ManagedLaunchSpec,admission?:{admitted_at:string;deadline_at:string;grace_ms:number}): Promise<ManagedOwnedProcess>; }
export interface ManagedControlPort {
  open(input:{identity:ManagedAttemptIdentity;nonce:string;status:()=>ManagedAttemptClaim;cancel:()=>void}): Promise<()=>Promise<void>>;
}
function canonical(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as any)[k])).join(',')+'}';
}
export function managedLaunchHash(spec:ManagedLaunchSpec):string { return stackHash(canonical(spec)); }
function runtimeRoot(root:string):string {
  if(!path.isAbsolute(root))throw new StackError('invalid_runtime','Absolute managed runtime required');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  if(fs.lstatSync(root).isSymbolicLink())throw new StackError('unsafe_runtime','Linked managed runtime refused');
  fs.chmodSync(root,0o700);return canonicalizeRealPath(root);
}
function claimPath(root:string,id:string):string { return stackContained(runtimeRoot(root),stackId(id)+'.json',true); }
function syncDirectory(dir:string):void { const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} }
function publish(file:string,value:unknown,exclusive=false):void {
  const bytes=JSON.stringify(value,null,2)+'\n';
  const temp=file+'.'+randomBytes(8).toString('hex')+'.tmp';
  const fd=fs.openSync(temp,'wx',0o600);
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try { if(exclusive){fs.linkSync(temp,file);fs.unlinkSync(temp);}else fs.renameSync(temp,file);syncDirectory(path.dirname(file)); }
  finally{fs.rmSync(temp,{force:true});}
}
function exactKeys(value:any,keys:string[]):boolean {return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function assertManagedIdentity(value:any):void {
 if(!exactKeys(value,['source_id','operation_id','run_id','attempt_id','launch_hash','max_duration_ms','nonce_hash']))throw new StackError('invalid_state','Managed identity fields invalid');
 for(const key of ['source_id','operation_id','attempt_id'])stackId(value[key]);assertCanonicalRunId(value.run_id);
 if(!/^sha256:[a-f0-9]{64}$/.test(value.launch_hash)||!/^sha256:[a-f0-9]{64}$/.test(value.nonce_hash)||!Number.isSafeInteger(value.max_duration_ms)||value.max_duration_ms<1)throw new StackError('invalid_state','Managed identity pins invalid');
}
export function readManagedAttempt(root:string,attemptId:string):ManagedAttemptClaim {
  const file=claimPath(root,attemptId);if(fs.statSync(file).size>1048576)throw new StackError('invalid_state','Managed record too large');
  const value=JSON.parse(fs.readFileSync(file,'utf8'));
  assertManagedIdentity(value.identity);
  if(!exactKeys(value,['schema_version','identity','worker_nonce','admitted_at','deadline_at','state','worker','host','outcome'])||!['claimed','running','recovery_needed','exited','cancelled','timed_out'].includes(value.state)||!(/^[a-f0-9]{64}$/).test(value.worker_nonce)||[value.admitted_at,value.deadline_at].some(date=>date!==null&&(typeof date!=='string'||!Number.isFinite(Date.parse(date))))||value.schema_version!=='guild.stack.managed_private_claim.v1'||value.identity?.attempt_id!==attemptId||typeof value.worker_nonce!=='string'||stackHash(value.worker_nonce)!==value.identity.nonce_hash)throw new StackError('invalid_state','Managed claim identity invalid');
  if(value.outcome&&(value.outcome.schema_version!=='guild.stack.managed_run_outcome.v1'||value.outcome.source_id!==value.identity.source_id||value.outcome.run_id!==value.identity.run_id||value.outcome.attempt_id!==value.identity.attempt_id||!['exited','cancelled','timed_out','recovery_needed'].includes(value.outcome.state)))throw new StackError('invalid_state','Managed outcome identity invalid');
  return value;
}
export function claimManagedAttempt(root:string,input:ManagedAttemptInput):{created:boolean;identity:ManagedAttemptIdentity} {
  if(!exactKeys(input,["source_id","operation_id","run_id","attempt_id","launch_hash","max_duration_ms"]))throw new StackError("invalid_intent","Managed input fields invalid");
  for(const value of [input.source_id,input.operation_id,input.attempt_id])stackId(value);
  assertCanonicalRunId(input.run_id);
  if(!/^sha256:[a-f0-9]{64}$/.test(input.launch_hash)||!Number.isSafeInteger(input.max_duration_ms)||input.max_duration_ms<1)throw new StackError('invalid_intent','Managed launch pin/duration invalid');
  const file=claimPath(root,input.attempt_id),nonce=randomBytes(32).toString('hex');
  const value:ManagedAttemptClaim={schema_version:'guild.stack.managed_private_claim.v1',identity:{...input,nonce_hash:stackHash(nonce)},worker_nonce:nonce,admitted_at:null,deadline_at:null,state:'claimed',worker:null,host:null,outcome:null};
  try{publish(file,value,true);return {created:true,identity:value.identity};}
  catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const prior=readManagedAttempt(root,input.attempt_id);const {nonce_hash,...owned}=prior.identity;if(canonical(owned)!==canonical(input))throw new StackError('idempotency_conflict','Managed attempt already belongs to another intent');return {created:false,identity:prior.identity};}
}
export function reconcileManagedAttempt(root:string,identity:ManagedAttemptIdentity,port:{verifyOwnedWorker:(claim:ManagedAttemptClaim)=>boolean}):{state:string;can_relaunch:false;outcome:ManagedRunOutcome|null} {
  const claim=readManagedAttempt(root,identity.attempt_id);
  if(canonical(claim.identity)!==canonical(identity))throw new StackError('invalid_state','Managed source/attempt mismatch');
  if(claim.outcome)return {state:claim.outcome.state,can_relaunch:false,outcome:claim.outcome};
  return {state:port.verifyOwnedWorker(claim)?claim.state:'recovery_needed',can_relaunch:false,outcome:null};
}
export function assertManagedBudgetAdmission(input:{max_usd:number;mode:"strict"|"native_estimated_spend_threshold";qualified:boolean}):void {
  if(!Number.isFinite(input.max_usd)||input.max_usd<=0)throw new StackError('budget_refused','Positive enforceable budget required before dispatch',403);
  if(!['strict','native_estimated_spend_threshold'].includes(input.mode)||input.qualified!==true)throw new StackError('budget_unqualified','Strict USD admission is not qualified for this host',503);
}
export function managedNonceMatches(actual:string,expected:string):boolean {
  const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);
}
function updateClaim(root:string,claim:ManagedAttemptClaim):void { publish(claimPath(root,claim.identity.attempt_id),claim); }
function canonicalAttemptDir(sourceRoot:string,identity:ManagedAttemptIdentity):string {
  const base=createGuildStorage(sourceRoot).root.durable;
  const rel='runs/'+identity.run_id+'/attempts/'+stackId(identity.attempt_id);
  const out=stackContained(base,rel,true);fs.mkdirSync(out,{recursive:true,mode:0o700});return out;
}
export async function runManagedWorker(input:{runtimeDir:string;sourceRoot:string;identity:ManagedAttemptIdentity;launch:ManagedLaunchSpec;process:ManagedProcessPort;control:ManagedControlPort;onAdmitted?:(claim:ManagedAttemptClaim)=>void;graceMs?:number;integration?:ManagedSegmentIntegration}):Promise<ManagedRunOutcome> {
  const {runtimeDir,sourceRoot,identity,launch}=input;
  let claim=readManagedAttempt(runtimeDir,identity.attempt_id);
  if(canonical(claim.identity)!==canonical(identity)||managedLaunchHash(launch)!==identity.launch_hash||launch.max_duration_ms!==identity.max_duration_ms)throw new StackError('invalid_intent','Managed launch differs from claim');
  if(launch.classification!=='local_process_test')assertManagedBudgetAdmission({max_usd:launch.max_usd,mode:launch.budget_mode??'strict',qualified:launch.budget_mode==='native_estimated_spend_threshold'?launch.native_threshold_qualified===true:launch.strict_usd_qualified});
  if(new StackScope(sourceRoot).discover().root.source_id!==identity.source_id)throw new StackError('source_mismatch','Managed attempt belongs to another source',403);
  if(claim.state!=='claimed'||claim.admitted_at!==null)throw new StackError('already_admitted','Managed attempt cannot launch twice',409);
  const target=resolveManagedRunTarget({root:sourceRoot,run_id:identity.run_id,source_id:identity.source_id,host_id:launch.host_id,execution_id:launch.execution_id},input.integration);
  const owner=claimPath(runtimeDir,identity.attempt_id)+'.worker';
  try{const fd=fs.openSync(owner,'wx',0o600);fs.writeFileSync(fd,identity.nonce_hash);fs.fsyncSync(fd);fs.closeSync(fd);syncDirectory(path.dirname(owner));}catch(error){if((error as NodeJS.ErrnoException).code==='EEXIST')throw new StackError('already_admitted','Managed worker claim consumed',409);throw error;}
  const binding=loadRunBinding({root:sourceRoot,run_id:identity.run_id});
  if(target.kind==='v1'&&(!binding||binding.state!=='open'))throw new StackError('binding_refused','Managed source run has no open lifecycle binding',403);
  const dir=canonicalAttemptDir(sourceRoot,identity);let sequence=0;
  const runDir=path.dirname(path.dirname(dir));
  const pointer=(state:string)=>publish(path.join(runDir,'attempt.json'),{schema_version:'guild.stack.managed_run_attempt.v1',source_id:identity.source_id,run_id:identity.run_id,attempt_id:identity.attempt_id,state,intent_ref:'attempts/'+identity.attempt_id+'/intent.json',events_ref:'attempts/'+identity.attempt_id+'/events.jsonl',outcome_ref:claim.outcome?'attempts/'+identity.attempt_id+'/outcome.json':null});
  const hostProof=(state:'started'|'exited')=>publish(path.join(runDir,'host-dispatch.json'),{schema_version:'guild.stack.managed_host_dispatch.v1',source_id:identity.source_id,run_id:identity.run_id,attempt_id:identity.attempt_id,host_id:launch.host_id,model:claim.outcome?.usage.model??null,requested_model:launch.model,state,classification:launch.classification,admitted_at:claim.admitted_at,deadline_at:claim.deadline_at,launch_hash:identity.launch_hash,host:claim.host});
  publish(path.join(dir,'intent.json'),{schema_version:'guild.stack.managed_run_intent.v1',...identity,max_duration_ms:launch.max_duration_ms,deadline_derivation:'admitted_at + max_duration_ms',classification:launch.classification,host_id:launch.host_id,model:launch.model,native_session_id:launch.native_session_id??null,policy_sha256:launch.policy_sha256??null,binary_sha256:launch.binary_sha256,budget:{mode:launch.classification==='local_process_test'?'no_model_test':launch.budget_mode??'strict',max_usd:launch.max_usd,cost_basis:launch.budget_mode==='native_estimated_spend_threshold'?'api_equivalent_native_estimate':'unknown',in_flight_overshoot_possible:launch.budget_mode==='native_estimated_spend_threshold',strict_actual_billing_ceiling:launch.budget_mode!=='native_estimated_spend_threshold'&&launch.classification!=='local_process_test'}},true);
  const event=(name:string,data:Record<string,unknown>={})=>{
    const record={schema_version:'guild.stack.managed_run_event.v1',source_id:identity.source_id,run_id:identity.run_id,attempt_id:identity.attempt_id,sequence:++sequence,event:name,at:new Date().toISOString(),...data};
    const file=path.join(dir,'events.jsonl');const fd=fs.openSync(file,'a',0o600);try{fs.writeSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  };
  let requested:false|'cancelled'|'timed_out'=false,child:ManagedOwnedProcess|undefined;
  const stop=(why:'cancelled'|'timed_out')=>{if(!requested)requested=why;if(child?.verifyOwnership())child.signalGroup('SIGINT');};
  const closeControl=await input.control.open({identity,nonce:claim.worker_nonce,status:()=>readManagedAttempt(runtimeDir,identity.attempt_id),cancel:()=>stop('cancelled')});
  let deadline:ReturnType<typeof setTimeout>|undefined,killTimer:ReturnType<typeof setTimeout>|undefined;
  try{
    const admittedAt=new Date().toISOString();
    claim={...claim,admitted_at:admittedAt,deadline_at:new Date(Date.parse(admittedAt)+launch.max_duration_ms).toISOString()};updateClaim(runtimeDir,claim);event('admitted',{deadline_at:claim.deadline_at,duration_ms:launch.max_duration_ms,classification:launch.classification});input.onAdmitted?.(claim);
    deadline=setTimeout(()=>stop('timed_out'),launch.max_duration_ms);
    child=await input.process.start(launch,{admitted_at:claim.admitted_at!,deadline_at:claim.deadline_at!,grace_ms:input.graceMs??250});claim={...claim,state:'running',host:child.identity};updateClaim(runtimeDir,claim);event('started',{host_identity:child.identity});pointer('running');hostProof('started');
    if(requested)stop(requested);
    const poll=setInterval(()=>{if(requested&&!killTimer){killTimer=setTimeout(()=>{if(child?.verifyOwnership())child.signalGroup('SIGKILL');},input.graceMs??250);}},10);
    let exit:{exit_code:number|null;signal:string|null};try{exit=await child.exited;}finally{clearInterval(poll);}
    const gone=child.groupGone();
    const state=gone?(requested||'exited'):'recovery_needed';
    const outcome:ManagedRunOutcome={schema_version:'guild.stack.managed_run_outcome.v1',source_id:identity.source_id,run_id:identity.run_id,attempt_id:identity.attempt_id,state,exit_code:exit.exit_code,signal:exit.signal,admitted_at:claim.admitted_at!,ended_at:new Date().toISOString(),deadline_at:claim.deadline_at!,classification:launch.classification,output:child.outputSummary?.()??{bytes:0,hashed_bytes:0,retained_bytes:0,prefix_sha256:stackHash('')},usage:child.observation?.()??{state:'unknown',cost_usd:null,basis:'no trusted provider billing observation'}};
    publish(path.join(dir,'outcome.json'),outcome,true);claim={...claim,state,outcome};updateClaim(runtimeDir,claim);event(state,{exit_code:exit.exit_code,signal:exit.signal});pointer(state);if(gone)hostProof('exited');
    const exitAction=managedExitAction(target.kind,{gone,state,exit_code:exit.exit_code,leave_resumable:launch.leave_resumable===true});
    if(exitAction.action==='close_run'){const lifecycle=createRunLifecycle(createRealEnv(sourceRoot,()=>{throw new StackError('host_resolution_refused','Managed run close never resolves a host',500);}));lifecycle.closeRun(identity.run_id,{binding_ref:binding!.binding_ref,status:exitAction.status});}
    else if(exitAction.action==='seal_segment'&&target.kind==='v2')sealExecutionSegment(sourceRoot,{schema_version:EXECUTION_SEGMENT_SEAL_SCHEMA,source_id:identity.source_id,run_id:identity.run_id,execution_id:target.execution_id,segment_revision:target.segment_revision,sealed_by:{operation_id:identity.operation_id,attempt_id:identity.attempt_id,launch_hash:identity.launch_hash},outcome_state:state as 'exited'|'cancelled'|'timed_out',outcome_sha256:managedOutcomeHash(outcome),sealed_at:outcome.ended_at});
    return outcome;
  }catch(error){claim={...claim,state:'recovery_needed'};updateClaim(runtimeDir,claim);event('recovery_needed');throw error;}
  finally{if(deadline)clearTimeout(deadline);if(killTimer)clearTimeout(killTimer);await closeControl();}
}

export interface ManagedWorkerPackage { node_binary:string; node_sha256:string; entry:string; entry_sha256:string; }
export interface ManagedWorkerRequest { schema_version:"guild.stack.managed_private_request.v1";sourceRoot:string;identity:ManagedAttemptIdentity;launch:ManagedLaunchSpec;worker:ManagedWorkerPackage; }
export function prepareManagedWorker(runtime:string,input:Omit<ManagedWorkerRequest,"schema_version">):void {
  const claim=readManagedAttempt(runtime,input.identity.attempt_id);
  if(canonical(claim.identity)!==canonical(input.identity)||claim.state!=="claimed"||managedLaunchHash(input.launch)!==input.identity.launch_hash||new StackScope(input.sourceRoot).discover().root.source_id!==input.identity.source_id)throw new StackError("invalid_intent","Managed worker request does not own this claim");
  for(const file of [input.worker.node_binary,input.worker.entry])if(!path.isAbsolute(file)||fs.realpathSync(file)!==file)throw new StackError("invalid_worker","Fixed worker package path required");
  if(stackHash(fs.readFileSync(input.worker.node_binary))!==input.worker.node_sha256||stackHash(fs.readFileSync(input.worker.entry))!==input.worker.entry_sha256)throw new StackError("invalid_worker","Worker executable pin changed");
  const target=claimPath(runtime,input.identity.attempt_id)+".request";
  const request={schema_version:"guild.stack.managed_private_request.v1",...input};
  if(fs.existsSync(target)){if(canonical(JSON.parse(fs.readFileSync(target,"utf8")))!==canonical(request))throw new StackError("idempotency_conflict","Managed worker request changed");return;}
  publish(target,request,true);
}
export function readManagedWorkerRequest(runtime:string,attemptId:string):ManagedWorkerRequest {
  const target=claimPath(runtime,attemptId)+".request";
  if(fs.lstatSync(target).isSymbolicLink()||fs.statSync(target).size>1048576)throw new StackError("invalid_worker","Managed worker request refused");
  const request=JSON.parse(fs.readFileSync(target,"utf8"));
  if(request.schema_version!=="guild.stack.managed_private_request.v1"||request.identity?.attempt_id!==attemptId||canonical(readManagedAttempt(runtime,attemptId).identity)!==canonical(request.identity)||managedLaunchHash(request.launch)!==request.identity.launch_hash)throw new StackError("invalid_worker","Managed worker request identity changed");
  return request;
}

export interface ManagedWorkerAcceptance {
 schema_version:"guild.stack.managed_private_acceptance.v1";identity:ManagedAttemptIdentity;accepted_at:string;
 worker_pid:number;worker_start_identity:string|null;worker:ManagedWorkerPackage;
}
export function recordManagedWorkerAcceptance(runtime:string,identity:ManagedAttemptIdentity,worker:ManagedWorkerPackage,pid:number,start:string|null):void {
 const request=readManagedWorkerRequest(runtime,identity.attempt_id);
 if(canonical(request.identity)!==canonical(identity)||canonical(request.worker)!==canonical(worker)||!Number.isSafeInteger(pid)||pid<1||start!==null&&typeof start!=="string")throw new StackError("invalid_worker","Worker acceptance differs from reserved request");
 const accepted:ManagedWorkerAcceptance={schema_version:"guild.stack.managed_private_acceptance.v1",identity,accepted_at:new Date().toISOString(),worker_pid:pid,worker_start_identity:start,worker};
 publish(claimPath(runtime,identity.attempt_id)+".accepted.json",accepted,true);
}
export function readManagedWorkerAcceptance(runtime:string,identity:ManagedAttemptIdentity):ManagedWorkerAcceptance {
 const file=claimPath(runtime,identity.attempt_id)+".accepted.json";
 if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>16384)throw new StackError("invalid_worker","Worker acceptance refused");
 const value=JSON.parse(fs.readFileSync(file,"utf8")),request=readManagedWorkerRequest(runtime,identity.attempt_id);
 if(!exactKeys(value,["schema_version","identity","accepted_at","worker_pid","worker_start_identity","worker"])||value.schema_version!=="guild.stack.managed_private_acceptance.v1"||canonical(value.identity)!==canonical(identity)||canonical(value.worker)!==canonical(request.worker)||!Number.isSafeInteger(value.worker_pid)||value.worker_pid<1||!Number.isFinite(Date.parse(value.accepted_at))||value.worker_start_identity!==null&&typeof value.worker_start_identity!=="string")throw new StackError("invalid_worker","Worker acceptance identity invalid");
 return value;
}
export function markManagedAttemptUncertain(runtime:string,identity:ManagedAttemptIdentity):void {
 const claim=readManagedAttempt(runtime,identity.attempt_id);if(canonical(claim.identity)!==canonical(identity))throw new StackError("invalid_worker","Uncertain worker identity differs");
 if(!claim.outcome&&claim.state!=="recovery_needed")updateClaim(runtime,{...claim,state:"recovery_needed"});
}
