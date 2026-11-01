#!/usr/bin/env node
/** Packaged Guild Stack facade. Usage: node runtime/scripts/stack-operations.js --cwd /absolute/guild-root */
import * as path from "node:path";
import { StackFacade } from "../src/domains/lifecycle";
import { loadManagedClaudeRuntime } from "../src/adapters";
import { StackError } from "../src/domains/state";
import { stackValidator } from "./lib/stack-contract-validator";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (argv.length !== 2 || argv[0] !== "--cwd" || !path.isAbsolute(argv[1]))
      throw new StackError(
        "invalid_arguments",
        "Expected --cwd and one absolute Guild root",
      );
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 65536)
        throw new StackError(
          "request_too_large",
          "Request exceeds 65536 bytes",
          413,
        );
      chunks.push(bytes);
    }
    let input: unknown;
    try {
      input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new StackError("invalid_json", "Expected one JSON request");
    }
    const facade = new StackFacade({
      root: argv[1],
      managed: loadManagedClaudeRuntime(argv[1],path.resolve(__dirname, "../.."),stackValidator()),
      packageRoot: path.resolve(__dirname, "../.."),
      validate: stackValidator(),
    });
    const output = JSON.stringify(facade.dispatch(input));
    if (Buffer.byteLength(output) > 1048576)
      throw new StackError(
        "response_too_large",
        "Response requires a narrower projection",
        413,
      );
    process.stdout.write(output + "\n");
    return 0;
  } catch (error) {
    const known = error instanceof StackError;
    process.stdout.write(
      JSON.stringify({
        error: {
          code: known ? error.code : "producer_failed",
          message: known ? error.message : "Packaged operation failed",
          retryable: false,
        },
      }) + "\n",
    );
    return 1;
  }
}
if (require.main === module)
  main().then((code) => {
    process.exitCode = code;
  });
