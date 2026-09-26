/**
 * src/domains/kernel/yaml-loader.ts
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

function pluginLocalScriptsRoots(): string[] {
  return [
    // Source TS layout (src/domains/<id>) and the bundled agent-team hook layout
    // (hooks/agent-team/dist) both sit three levels under plugin/.
    path.resolve(__dirname, "..", "..", "..", "scripts"),
    // Bundled hook layout (hooks/dist) and src/adapters both sit two levels under.
    path.resolve(__dirname, "..", "..", "scripts"),
    // src/adapters/model-discovery and any deeper nesting.
    path.resolve(__dirname, "..", "..", "..", "..", "scripts"),
  ];
}

function tryScriptsRoot(scriptsRoot: string): YamlApi | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(require.resolve("js-yaml", { paths: [scriptsRoot] })) as YamlApi;
  } catch {
    return null;
  }
}

export function loadYamlApi(): YamlApi {
  // Plugin-local roots first: a generated package must prefer its own vendored
  // copy over anything ambient, so a consumer repo's node_modules can never
  // shadow Guild's js-yaml (self-contained package invariant).
  const tried: string[] = [];
  for (const scriptsRoot of pluginLocalScriptsRoots()) {
    tried.push(scriptsRoot);
    const api = tryScriptsRoot(scriptsRoot);
    if (api) return api;
  }
  // Literal specifier: esbuild statically inlines this into the compiled hook
  // dists, so installed hooks carry js-yaml even when no node_modules exists on
  // disk (issue #14 — fresh installs ship none). In unbundled layouts
  // (tsx/ts-jest) this is plain node resolution and runs only after every
  // plugin-local root failed.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("js-yaml") as YamlApi;
  } catch {
    // Fall through to the cwd-relative last resort.
  }
  // Last resort: a scripts/ dir under the consumer cwd (plugin-checkout runs).
  const cwdRoot = path.resolve(process.cwd(), "scripts");
  tried.push(cwdRoot);
  const api = tryScriptsRoot(cwdRoot);
  if (api) return api;
  throw new Error(
    `Guild needs the js-yaml package and could not resolve it. ` +
      `Fix: npm install --prefix <plugin-root>/scripts (roots tried: ${tried.join(", ")})`
  );
}
