#!/usr/bin/env -S npx tsx
/**
 * pane-send — the lead's gated send-keys into a lane's tmux pane (#179).
 *
 *   pane-send --target <tmux-target> --message <text> [--settle-ms <ms>] [--poll-limit <n>]
 *
 * Waits for the pane to be idle, sends the message, and confirms the pane
 * changed. Prints the closed `send` outcome as one JSON line. Exit 0 =
 * delivered; exit 1 = held (pane busy) or not confirmed; exit 2 = usage error.
 * Never fall back to a raw `tmux send-keys` on exit 1: re-run after the turn.
 */

import { spawnSync } from "node:child_process";

import { TmuxExecutionTransport, type ExecutionRunFn } from "../src/domains/dispatch";

const USAGE = "usage: pane-send --target <tmux-target> --message <text> [--settle-ms <ms>] [--poll-limit <n>]";

const run: ExecutionRunFn = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

export function main(argv: string[] = process.argv.slice(2), runFn: ExecutionRunFn = run): number {
  const values = new Map<string, string>();
  try {
    for (let i = 0; i < argv.length; i++) {
      const flag = argv[i];
      if (!["--target", "--message", "--settle-ms", "--poll-limit"].includes(flag)) {
        throw new Error(`unknown argument ${flag}`);
      }
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      values.set(flag, value);
    }
    for (const flag of ["--target", "--message"]) {
      if (!values.get(flag)) throw new Error(`${flag} is required`);
    }
    for (const flag of ["--settle-ms", "--poll-limit"]) {
      const v = values.get(flag);
      if (v !== undefined && !(Number.isInteger(Number(v)) && Number(v) >= 0)) {
        throw new Error(`${flag} must be a non-negative integer`);
      }
    }
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    return 2;
  }
  const num = (flag: string) => (values.has(flag) ? Number(values.get(flag)) : undefined);
  const transport = new TmuxExecutionTransport({
    run: runFn,
    settleMs: num("--settle-ms"),
    sendPollLimit: num("--poll-limit"),
  });
  const outcome = transport.send(
    { transport_id: "tmux", handle_id: values.get("--target")!, host_id: null, host_kind: null, invocation: null },
    values.get("--message")!,
  );
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
  return outcome.status === "succeeded" ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
