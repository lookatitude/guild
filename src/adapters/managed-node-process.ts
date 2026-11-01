import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createHash } from "node:crypto";
import { createManagedClaudeParser } from "./managed-claude";
import { managedNonceMatches, readManagedWorkerRequest, recordManagedWorkerAcceptance, readManagedWorkerAcceptance, type ManagedWorkerPackage, type ManagedProcessPort, type ManagedLaunchSpec, type ManagedOwnedProcess, type ManagedControlPort, type ManagedAttemptIdentity } from "../domains/lifecycle";
function digest(file:string):string{return 'sha256:'+createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function startToken(pid:number):string|null{
  try{
    const proc='/proc/'+pid+'/stat';
    if(fs.existsSync(proc)){const body=fs.readFileSync(proc,'utf8');return 'linux:'+body.slice(body.lastIndexOf(')')+2).split(' ')[19];}
    const started=execFileSync('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim();return started?'ps:'+started:null;
  }catch{return null;}
}
function processGroupGone(group:number):boolean{
  try{
    const rows=execFileSync('/bin/ps',['-axo','pgid=,stat='],{encoding:'utf8',timeout:1000,maxBuffer:2*1024*1024});
    return !rows.split(/\r?\n/).some(row=>{const [pgid,state]=row.trim().split(/\s+/);return Number(pgid)===group&&!state?.startsWith('Z');});
  }catch{return false;}
}
const GROUP_SENTINEL = `
const {spawn,execFileSync}=require('node:child_process');let input='';let ended=null;
process.on('SIGINT',()=>{});
process.stdin.on('data',chunk=>{input+=chunk;if(Buffer.byteLength(input)>1048576)process.exit(125);});
process.stdin.on('end',()=>{
 try{
  const spec=JSON.parse(input);
  const remaining=Date.parse(spec.deadline_at)-Date.now();
  if(!Number.isFinite(remaining)||remaining<=0)process.exit(124);
  setTimeout(()=>{try{process.kill(-process.pid,'SIGINT');}catch{}setTimeout(()=>{try{process.kill(-process.pid,'SIGKILL');}catch{}},spec.grace_ms);},remaining);
  const child=spawn(spec.binary,spec.args,{cwd:spec.cwd,env:spec.env,shell:false,detached:false,stdio:['ignore','inherit','inherit']});
  child.once('spawn',()=>{require('node:fs').writeSync(3,JSON.stringify({host_pid:child.pid})+'\\n');require('node:fs').closeSync(3);});
  child.once('error',()=>process.exit(125));
  child.once('exit',(code,signal)=>{ended={code,signal};});
  setInterval(()=>{
   if(!ended)return;
   try{const rows=execFileSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:1000,maxBuffer:2097152,detached:true});
    const live=rows.split(/\\r?\\n/).some(row=>{const [pid,group,state]=row.trim().split(/\\s+/);return Number(group)===process.pid&&Number(pid)!==process.pid&&!state?.startsWith('Z');});
    if(!live)process.exit(ended.code===null?128:ended.code);
   }catch{}
  },10);
 }catch{process.exit(125);}
});
`;
export class ManagedNodeProcessPort implements ManagedProcessPort {
  constructor(private readonly nodeBinary=process.versions.bun?execFileSync("/usr/bin/which",["node"],{encoding:"utf8",timeout:1000,maxBuffer:4096}).trim():process.execPath){}
  async start(spec:ManagedLaunchSpec,admission?:{admitted_at:string;deadline_at:string;grace_ms:number}):Promise<ManagedOwnedProcess>{
    if(process.platform==='win32')throw new Error('Managed process-group ownership unavailable on Windows');
    if(!path.isAbsolute(spec.binary)||!path.isAbsolute(spec.cwd)||spec.args.some(arg=>typeof arg!=='string'))throw new Error('Managed fixed argv invalid');
    const binary=fs.realpathSync(spec.binary);if(binary!==spec.binary||digest(binary)!==spec.binary_sha256)throw new Error('Managed executable pin changed');
    const allowed=new Set(['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','GUILD_STATE_HOME','XDG_STATE_HOME']);
    if(Object.keys(spec.env).some(key=>!allowed.has(key)))throw new Error('Managed executable environment key refused');
    const supervisor=fs.realpathSync(this.nodeBinary),supervisorHash=digest(supervisor);
    const child=spawn(supervisor,['-e',GROUP_SENTINEL],{cwd:spec.cwd,env:spec.env,shell:false,detached:true,stdio:['pipe','pipe','pipe','pipe']});
    const spawned=new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    let resolveExit!:(value:{exit_code:number|null;signal:string|null})=>void;
    const exited=new Promise<{exit_code:number|null;signal:string|null}>(resolve=>resolveExit=resolve);
    let bytes=0,hashedBytes=0;const outputHash=createHash('sha256');
    const consume=(chunk:Buffer)=>{bytes+=chunk.length;const prefix=chunk.subarray(0,Math.max(0,1048576-hashedBytes));outputHash.update(prefix);hashedBytes+=prefix.length;};
    const native=spec.budget_mode==='native_estimated_spend_threshold'&&spec.native_session_id?createManagedClaudeParser({session_id:spec.native_session_id,model:spec.model,baseline_usd:spec.native_cost_baseline_usd??0}):null;
    child.stdout!.on('data',chunk=>{consume(chunk);native?.push(chunk);});child.stderr!.on('data',consume);
    child.once('exit',(exit_code,signal)=>resolveExit({exit_code,signal}));
    child.stdin!.end(JSON.stringify({binary,args:spec.args,cwd:spec.cwd,env:spec.env,deadline_at:admission?.deadline_at??new Date(Date.now()+spec.max_duration_ms).toISOString(),grace_ms:admission?.grace_ms??250}));
    if(!child.pid)await spawned;else void spawned.catch(()=>{});
    const pid=child.pid!,token=startToken(pid);
    if(!token){try{process.kill(-pid,'SIGKILL');}catch{}throw new Error('Managed process start identity unavailable');}
    let hostPid:number|null=null;
    try{hostPid=await new Promise<number>((resolve,reject)=>{
      let message='',settled=false;const channel=child.stdio[3] as net.Socket;
      const timer=setTimeout(()=>reject(new Error('Managed host handshake timed out')),Math.min(spec.max_duration_ms,2000));
      const parse=()=>{if(settled)return;try{const value=JSON.parse(message);if(!Number.isInteger(value.host_pid)||value.host_pid<1)throw new Error();settled=true;clearTimeout(timer);channel.destroy();resolve(value.host_pid);}catch{}};
      channel.on('data',chunk=>{message+=chunk.toString();if(message.length>4096){clearTimeout(timer);reject(new Error('Managed host handshake too large'));}else parse();});channel.on('end',parse);
    });}
    catch(error){try{process.kill(-pid,'SIGKILL');}catch{}throw error;}
    const identity={pid,supervisor_pid:pid,host_pid:hostPid,process_group_id:pid,start_identity:token,executable_sha256:spec.binary_sha256,supervisor_executable_sha256:supervisorHash};
    const verify=()=>child.exitCode===null&&child.signalCode===null&&startToken(pid)===token&&digest(supervisor)===supervisorHash&&digest(binary)===spec.binary_sha256;
    return {identity,exited,verifyOwnership:verify,signalGroup:signal=>{if(!verify())return false;try{process.kill(-pid,signal);return true;}catch{return false;}},groupGone:()=>processGroupGone(pid),observation:()=>native?.finish()??{state:'unknown',cost_usd:null,basis:'no trusted provider billing observation'},outputSummary:()=>({bytes,hashed_bytes:hashedBytes,retained_bytes:0,prefix_sha256:'sha256:'+outputHash.copy().digest('hex')})};
  }
}
function controlFile(runtime:string,id:string):string{if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))throw new Error('Managed control identity invalid');return path.join(runtime,id+'.control.json');}
export class ManagedLocalControlPort implements ManagedControlPort {
  constructor(private readonly runtime:string){}
  async open(input:Parameters<ManagedControlPort['open']>[0]):Promise<()=>Promise<void>>{
    const server=net.createServer(socket=>{
      let data='';socket.setTimeout(2000,()=>socket.destroy());
      socket.on('data',chunk=>{
        data+=chunk.toString('utf8');if(Buffer.byteLength(data)>4096){socket.destroy();return;}
        if(!data.includes('\n'))return;
        try{
          const request=JSON.parse(data.slice(0,data.indexOf('\n')));
          if(request.source_id!==input.identity.source_id||request.attempt_id!==input.identity.attempt_id||typeof request.nonce!=='string'||!managedNonceMatches(request.nonce,input.nonce)||!['status','cancel'].includes(request.action))throw new Error();
          if(request.action==='cancel')input.cancel();
          const claim=input.status();
          socket.end(JSON.stringify({schema_version:'guild.stack.managed_control_status.v1',identity:claim.identity,state:claim.state,admitted_at:claim.admitted_at,deadline_at:claim.deadline_at,outcome:claim.outcome,cancel_requested:request.action==='cancel'})+'\n');
        }catch{socket.end(JSON.stringify({error:'control_refused'})+'\n');}
      });
    });
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address() as net.AddressInfo;
    fs.writeFileSync(controlFile(this.runtime,input.identity.attempt_id),JSON.stringify({schema_version:'guild.stack.managed_private_control.v1',source_id:input.identity.source_id,attempt_id:input.identity.attempt_id,port:address.port,worker_pid:process.pid,worker_start_identity:startToken(process.pid),nonce_hash:input.identity.nonce_hash}),{mode:0o600,flag:'wx'});
    return async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));};
  }
}
export async function requestManagedControl(runtime:string,identity:ManagedAttemptIdentity,nonce:string,action:'status'|'cancel'):Promise<any>{
  const file=controlFile(runtime,identity.attempt_id);if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>4096)throw new Error('Managed control record refused');
  const endpoint=JSON.parse(fs.readFileSync(file,'utf8'));
  if(endpoint.schema_version!=='guild.stack.managed_private_control.v1'||endpoint.source_id!==identity.source_id||endpoint.attempt_id!==identity.attempt_id||endpoint.nonce_hash!==identity.nonce_hash||!Number.isInteger(endpoint.port)||endpoint.port<1||endpoint.port>65535||startToken(endpoint.worker_pid)!==endpoint.worker_start_identity)throw new Error('Managed endpoint ownership unknown');
  return new Promise((resolve,reject)=>{
    const socket=net.connect(endpoint.port,'127.0.0.1');let data='';socket.setTimeout(2000,()=>{socket.destroy();reject(new Error('Managed control timeout'));});socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({source_id:identity.source_id,attempt_id:identity.attempt_id,nonce,action})+'\n'));
    socket.on('data',chunk=>{data+=chunk.toString('utf8');if(Buffer.byteLength(data)>65536){socket.destroy();reject(new Error('Managed control response too large'));}});
    socket.on('end',()=>{try{const value=JSON.parse(data);if(value.identity?.source_id!==identity.source_id||value.identity?.attempt_id!==identity.attempt_id||value.identity?.nonce_hash!==identity.nonce_hash)throw new Error('Managed control refused');resolve(value);}catch(error){reject(error);}});
  });
}

export function launchManagedWorker(runtime:string,identity:ManagedAttemptIdentity,worker:ManagedWorkerPackage):{pid:number} {
  const request=readManagedWorkerRequest(runtime,identity.attempt_id);
  if(JSON.stringify(request.identity)!==JSON.stringify(identity)||JSON.stringify(request.worker)!==JSON.stringify(worker))throw new Error("Managed fixed worker request differs");
  if(digest(worker.entry)!==worker.entry_sha256||digest(worker.node_binary)!==worker.node_sha256)throw new Error("Managed worker executable pin changed");
  const marker=controlFile(runtime,identity.attempt_id)+".launch";
  const fd=fs.openSync(marker,'wx',0o600);try{fs.writeFileSync(fd,identity.nonce_hash);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const env:Record<string,string>={};for(const name of ['PATH','HOME','TMPDIR','LANG','LC_ALL','TZ','GUILD_STATE_HOME','XDG_STATE_HOME'])if(process.env[name]!==undefined)env[name]=process.env[name]!;
  const child=spawn(worker.node_binary,[worker.entry,'--runtime',runtime,'--attempt',identity.attempt_id],{cwd:request.sourceRoot,env,shell:false,detached:true,stdio:'ignore'});
  child.once('error',()=>{});
  if(!child.pid)throw new Error('Managed worker acceptance uncertain');
  recordManagedWorkerAcceptance(runtime,identity,worker,child.pid,startToken(child.pid));child.unref();
  return {pid:child.pid};
}

export function inspectManagedWorker(runtime:string,identity:ManagedAttemptIdentity):"alive"|"dead"|"unknown" {
 try{
  const accepted=readManagedWorkerAcceptance(runtime,identity),worker=accepted.worker;
  try{process.kill(accepted.worker_pid,0);}catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH'?'dead':'unknown';}
  const state=execFileSync('/bin/ps',['-p',String(accepted.worker_pid),'-o','stat='],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim();if(!state||state.startsWith('Z'))return 'dead';
  if(!accepted.worker_start_identity||startToken(accepted.worker_pid)!==accepted.worker_start_identity||fs.realpathSync(worker.node_binary)!==worker.node_binary||fs.realpathSync(worker.entry)!==worker.entry||digest(worker.node_binary)!==worker.node_sha256||digest(worker.entry)!==worker.entry_sha256)return 'unknown';
  return 'alive';
 }catch{return 'unknown';}
}
