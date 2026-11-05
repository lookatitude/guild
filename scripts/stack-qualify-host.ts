#!/usr/bin/env node
/** Trusted operator-only qualification facade. Usage: node runtime/scripts/stack-qualify-host.js --cwd /scratch/guild-root --authorization /private/reviewed-candidate.json */
import * as fs from "node:fs";
import * as path from "node:path";
import { StackFacade } from "../src/domains/lifecycle";
import { createManagedClaudeRuntime } from "../src/adapters";
import { stackValidator } from "./lib/stack-contract-validator";
export async function main(argv=process.argv.slice(2)):Promise<number>{
 try{
  if(argv.length!==4||argv[0]!=="--cwd"||argv[2]!=="--authorization"||!path.isAbsolute(argv[1])||!path.isAbsolute(argv[3]))throw new Error();
  const packageRoot=fs.realpathSync(path.resolve(__dirname,"../..")),managed=createManagedClaudeRuntime({sourceRoot:argv[1],packageRoot,authorizationFile:argv[3],validate:stackValidator()});
  const chunks:Buffer[]=[];let size=0;for await(const chunk of process.stdin){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>65536)throw new Error();chunks.push(bytes);}
  const facade=new StackFacade({root:argv[1],packageRoot,managed,validate:stackValidator()});const out=JSON.stringify(facade.dispatch(JSON.parse(Buffer.concat(chunks).toString("utf8"))));if(Buffer.byteLength(out)>1048576)throw new Error();process.stdout.write(out+"\n");return 0;
 }catch{process.stdout.write(JSON.stringify({error:{code:"qualification_refused",message:"Reviewed operator qualification could not proceed",retryable:false}})+"\n");return 1;}
}
if(require.main===module)main().then(code=>{process.exitCode=code;});
