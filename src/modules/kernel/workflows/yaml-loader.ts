/**
 * src/modules/kernel/workflows/yaml-loader.ts
 *
 * Runtime loader for the plugin's package-local js-yaml dependency. Modules
 * should go through this single resolver instead of embedding ad hoc paths.
 */

import * as path from "node:path";

export interface YamlApi {
  JSON_SCHEMA: unknown;
  DEFAULT_SCHEMA: unknown;
  load(text: string, opts?: { schema?: unknown }): unknown;
  dump(value: unknown, opts?: unknown): string;
}

function candidateScriptsRoots(): string[] {
  return [
    // Source/runtime TS layout: src/modules/kernel/workflows -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "..", "scripts"),
    // Bundled hook layout: hooks/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "scripts"),
    // Bundled agent-team hook layout: hooks/agent-team/dist -> plugin/scripts.
    path.resolve(__dirname, "..", "..", "..", "scripts"),
    path.resolve(process.cwd(), "scripts"),
  ];
}

export function loadYamlApi(): YamlApi {
  const tried: string[] = [];
  for (const scriptsRoot of candidateScriptsRoots()) {
    tried.push(scriptsRoot);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(require.resolve("js-yaml", { paths: [scriptsRoot] })) as YamlApi;
    } catch {
      // Try the next known plugin layout.
    }
  }
  throw new Error(`Cannot resolve js-yaml from plugin scripts roots: ${tried.join(", ")}`);
}
