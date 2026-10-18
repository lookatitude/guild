#!/usr/bin/env -S npx tsx
import { definitionRefForDispatch } from "./lib/capability/definition-ref-for-dispatch";

export function main(argv: string[] = process.argv.slice(2)): number {
  let cwd = process.cwd();
  let name = "";
  let definition = "";
  let source = "project";
  const lane: { tier?: string; default_tier?: string; capability_scope?: string[] } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && argv[i + 1]) cwd = argv[++i];
    else if (arg.startsWith("--cwd=")) cwd = arg.slice(6);
    else if (arg === "--name" && argv[i + 1]) name = argv[++i];
    else if (arg.startsWith("--name=")) name = arg.slice(7);
    else if (arg === "--definition" && argv[i + 1]) definition = argv[++i];
    else if (arg.startsWith("--definition=")) definition = arg.slice(13);
    else if (arg === "--source" && argv[i + 1]) source = argv[++i];
    else if (arg.startsWith("--source=")) source = arg.slice(9);
    else if (arg === "--tier" && argv[i + 1]) lane.tier = argv[++i];
    else if (arg === "--default-tier" && argv[i + 1]) lane.default_tier = argv[++i];
    else if (arg === "--capability-scope" && argv[i + 1] !== undefined) lane.capability_scope = argv[++i].split(",").filter(Boolean);
    else { process.stderr.write(`unknown argument: ${arg}\n`); return 1; }
  }
  if (!name || !definition || (source !== "project" && source !== "shipped")) {
    process.stderr.write("usage: definition-ref-for-dispatch.ts --cwd <root> --name <id> --definition <relative-path> [--source project|shipped] [--tier T] [--default-tier T] [--capability-scope a,b]\n");
    return 1;
  }
  const result = definitionRefForDispatch(cwd, { name, definition, definition_source: source, ...lane });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "resolved" ? 0 : 2;
}

if (require.main === module) process.exit(main());
