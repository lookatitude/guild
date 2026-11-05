#!/usr/bin/env -S npx tsx
/**
 * scripts/task-cell-ack.ts — the packaged worker ack CLI (E00 CD10).
 *
 * Usage:
 *   task-cell-ack --assignment <absolute path to assignment.json>
 *
 * Writes ONLY <root>/.guild/runs/<run>/outbox/<instance_id>/ack-claim.json
 * (guild.assignment_ack_claim.v1). The Guild root is derived from the absolute
 * assignment path, never from the worker's cwd. This CLI holds no run
 * credential: it never publishes to the bus, never edits instance.json and
 * never writes the controller's ack — the controller validates the claim and
 * records the ack itself.
 *
 * Exit: 0 claim written (or an identical claim already present) · 1 usage · 2 refused.
 */
import { writeAckClaim } from "../src/domains/dispatch";

export function parseTaskCellAckArgs(argv: string[]): { assignmentPath: string } | { error: string } {
  const usage = "usage: task-cell-ack --assignment <absolute assignment.json path>";
  let assignmentPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--assignment" && argv[i + 1] !== undefined) assignmentPath = argv[++i];
    else if (arg.startsWith("--assignment=")) assignmentPath = arg.slice("--assignment=".length);
    else return { error: `unknown argument: ${arg}\n${usage}` };
  }
  return assignmentPath ? { assignmentPath } : { error: usage };
}

function main(): number {
  const parsed = parseTaskCellAckArgs(process.argv.slice(2));
  if ("error" in parsed) {
    process.stderr.write(parsed.error + "\n");
    return 1;
  }
  const out = writeAckClaim({ assignmentPath: parsed.assignmentPath });
  if (!out.ok) {
    process.stderr.write(`task-cell-ack: refused (${out.reason})\n`);
    return 2;
  }
  process.stdout.write(JSON.stringify({ ok: true, claim: out.claim }) + "\n");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
