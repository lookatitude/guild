#!/usr/bin/env node
/** Durable Guild Stack supervisor. Usage: node runtime/scripts/stack-run-worker.js --runtime /private/path --attempt attempt-id */
import * as fs from "node:fs";
import * as path from "node:path";
import { readManagedWorkerRequest, runManagedWorker } from "../src/domains/lifecycle";
import { stackHash } from "../src/domains/state";
import { ManagedNodeProcessPort, ManagedLocalControlPort } from "../src/adapters";
export async function main(argv=process.argv.slice(2)):Promise<number> {
  let stage="arguments";
  try {
    if(argv.length!==4||argv[0]!=="--runtime"||!path.isAbsolute(argv[1])||argv[2]!=="--attempt")throw new Error("worker arguments refused");
    stage="request";
    const request=readManagedWorkerRequest(argv[1],argv[3]);
    stage="pins";
    if(fs.realpathSync(__filename)!==request.worker.entry||stackHash(fs.readFileSync(__filename))!==request.worker.entry_sha256||fs.realpathSync(process.execPath)!==request.worker.node_binary||stackHash(fs.readFileSync(process.execPath))!==request.worker.node_sha256)throw new Error("worker package pin changed");
    stage="worker";
    await runManagedWorker({runtimeDir:argv[1],sourceRoot:request.sourceRoot,identity:request.identity,launch:request.launch,process:new ManagedNodeProcessPort(),control:new ManagedLocalControlPort(argv[1])});
    return 0;
  }catch{
    if(argv.length===4&&path.isAbsolute(argv[1])&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(argv[3]))try{fs.writeFileSync(path.join(argv[1],argv[3]+".failure.json"),JSON.stringify({schema_version:"guild.stack.managed_worker_failure.v1",stage,recovery_needed:true})+"\n",{flag:"wx",mode:0o600});}catch{}
    return 1;
  }
}
if(require.main===module)main().then(code=>{process.exitCode=code;});
