#!/usr/bin/env -S npx tsx

import * as path from "node:path";
import {
  createMigrationBoundary,
  writeMigrationBoundary,
} from "./lib/capability/migration-evidence";

function option(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`--${name} <value> is required`);
  }
  return value;
}

function positiveInteger(name: string): number {
  const value = option(name);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return Number(value);
}

try {
  const boundary = createMigrationBoundary({
    pluginRoot: path.resolve(option("root")),
    claudePackageRoot: path.resolve(option("claude-package-root")),
    codexPackageRoot: path.resolve(option("codex-package-root")),
    eventPath: path.resolve(option("event")),
    repository: option("repository"),
    runId: option("run-id"),
    runAttempt: positiveInteger("run-attempt"),
  });
  const target = writeMigrationBoundary(path.resolve(option("out")), boundary);
  process.stdout.write(`${JSON.stringify({ status: "emitted", path: target, boundary }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`capability-migration-boundary: REFUSED — ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
