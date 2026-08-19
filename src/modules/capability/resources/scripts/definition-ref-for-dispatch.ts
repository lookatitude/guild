#!/usr/bin/env -S npx tsx
import { definitionRefForDispatch } from "./lib/capability/definition-ref-for-dispatch";

export function main(argv: string[] = process.argv.slice(2)): number {
  let cwd = process.cwd();
  let name = "";
  let definition = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice(6);
    else if (arg === "--name" && argv[i + 1]) name = argv[++i];
    else if (arg.startsWith("--name=")) name = arg.slice(7);
    else if (arg === "--definition" && argv[i + 1]) definition = argv[++i];
    else if (arg.startsWith("--definition=")) definition = arg.slice(13);
    else { process.stderr.write(`unknown argument: ${arg}\n`); return 1; }
  }
  if (!name || !definition) {
    process.stderr.write("usage: definition-ref-for-dispatch.ts --cwd <root> --name <id> --definition <relative-path>\n");
    return 1;
  }
  const result = definitionRefForDispatch(cwd, { name, definition });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "resolved" ? 0 : 2;
}

if (require.main === module) process.exit(main());
