/**
 * hooks/test-support/mint-binding.ts — test-only fixture helper (T3b).
 *
 * Mints a valid guild.run_binding.v1 record for a fixture run so binding-gated
 * hook writers (session_context §5 fail-closed) accept the test's writes.
 * Lives OUTSIDE __tests__/ because jest's default testMatch treats every .ts
 * under __tests__/ as a test file.
 *
 * Deliberately writes the record directly (not via mintRunBinding) so tests
 * can also fabricate closed/mismatched/malformed records for negative
 * controls without fighting the one-mint-per-run guard.
 */

import * as fs from "fs";
import * as path from "path";

export interface MintTestBindingOpts {
  state?: "open" | "closed";
  /** Override the nonce (default: deterministic per runId). */
  ref?: string;
  /** Write a schema-invalid record (negative control). */
  malformed?: boolean;
}

/** Write binding.json for the run under root; returns the nonce. */
export function mintTestBinding(
  root: string,
  runId: string,
  opts: MintTestBindingOpts = {},
): string {
  const ref = opts.ref ?? `rb-test-${runId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const p = path.join(root, ".guild", "runs", runId, "binding.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const record = opts.malformed
    ? { schema_version: "guild.run_binding.v1", run_id: runId } // fails validation
    : {
        schema_version: "guild.run_binding.v1",
        run_id: runId,
        binding_ref: ref,
        state: opts.state ?? "open",
      };
  fs.writeFileSync(p, JSON.stringify(record, null, 2) + "\n", "utf8");
  return ref;
}
