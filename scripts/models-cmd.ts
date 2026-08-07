#!/usr/bin/env -S npx tsx
/**
 * scripts/models-cmd.ts
 *
 * Stable CLI shim for the public `guild models inspect` command (lane T6b).
 * The implementation lives in src/modules/capability/workflows/models-command.ts;
 * this file only threads in the ONE dependency capability may not import
 * directly - lifecycle's intake-only run-id candidate (lifecycle depends on
 * capability, so the reverse import would be a module cycle).
 *
 *   npx tsx scripts/models-cmd.ts inspect [--cwd <p>] [--run-id <id>] [--json]
 *
 * READ-ONLY: the command never writes, and it fails closed (exit 3) if its own
 * rendered output trips the canonical redaction applier.
 */

import { runModelsCommand } from "../src/modules/capability/workflows/models-command";
import { locateCandidateRunId } from "./lib/run-binding";

export function main(argv: string[] = process.argv.slice(2)): number {
  return runModelsCommand(argv, {
    candidateRunId: (root: string) => {
      const candidate = locateCandidateRunId(root);
      return candidate === null ? null : { run_id: candidate.run_id, source: candidate.source };
    },
  });
}

if (require.main === module) {
  process.exit(main());
}
