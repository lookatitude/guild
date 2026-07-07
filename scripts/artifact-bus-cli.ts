#!/usr/bin/env -S npx tsx
/**
 * scripts/artifact-bus-cli.ts
 *
 * The agent/skill-invocable surface for the generalized artifact bus
 * (`scripts/lib/artifact-bus.ts`; v2-review-broker-and-artifact-bus.md §Group 1).
 * Specialist agents and the orchestrator publish/consume by invoking this CLI
 * (the established Guild pattern — same as `classify-intake.ts`, `read-guild-config.ts`).
 *
 * Usage (run from the consuming repo root; --run-id selects the run dir):
 *   artifact-bus-cli publish   --run-id <id> --topic <type/scope/resource> [--path <p>] [--event published|streaming|closed|retracted] [--host <id>] [--role <r>]   # body on stdin
 *   artifact-bus-cli register  --run-id <id> --subscriber-id <id> --topics <glob,glob> [--callback hook|poll|webhook-url] [--host <id>]
 *   artifact-bus-cli tail      --run-id <id> [--since <seq>]            # NDJSON events after <seq> (default -1 = all)
 *   artifact-bus-cli fanout    --run-id <id> --seq <seq>               # subscribers matching event <seq>, partitioned by callback
 *   artifact-bus-cli cas-get   --run-id <id> --sha256 <hash>          # the cas_meta.v1 header
 *
 * Output is JSON on stdout; exit 0 on success, 1 on a usage/validation error.
 */

import * as fs from "fs";
import * as path from "path";

import {
  casGet,
  fanout,
  publish,
  readBusLog,
  registerSubscriber,
  tailBusLog,
} from "./lib/artifact-bus";

function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string> } {
  const cmd = argv[0] ?? "";
  const flags: Record<string, string> = {};
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      flags[key] = val;
    }
  }
  return { cmd, flags };
}

function runDirOf(flags: Record<string, string>): string {
  const cwd = flags.cwd ?? process.cwd();
  const runId = flags["run-id"];
  if (!runId) {
    process.stderr.write("artifact-bus-cli: --run-id is required\n");
    process.exit(1);
  }
  // Fail-closed: a run id is a single safe path segment — reject `/`, `..`, and
  // anything that could escape `.guild/runs/` (path-traversal guard).
  if (!/^[A-Za-z0-9_.-]+$/.test(runId) || runId === "." || runId === "..") {
    process.stderr.write(`artifact-bus-cli: unsafe --run-id ${JSON.stringify(runId)}\n`);
    process.exit(1);
  }
  return path.join(cwd, ".guild", "runs", runId);
}

function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(): void {
  const { cmd, flags } = parseArgs(process.argv.slice(2));
  const now = () => new Date().toISOString();
  const publisher = { host_id: flags.host ?? "claude-local", role: flags.role ?? "orchestrator" };

  switch (cmd) {
    case "publish": {
      const runDir = runDirOf(flags);
      if (!flags.topic) {
        process.stderr.write("artifact-bus-cli publish: --topic is required\n");
        process.exit(1);
      }
      const body = readStdin();
      // Accept either the bare suffix (published|streaming|closed|retracted) or the
      // full canonical `artifact.<kind>`; publish() validates and fails closed.
      const raw = flags.event ?? "published";
      const eventKind = (raw.startsWith("artifact.") ? raw : `artifact.${raw}`) as never;
      const event = publish(runDir, {
        runId: flags["run-id"],
        topic: flags.topic,
        event: eventKind,
        content: body.length > 0 ? body : undefined,
        artifactPath: flags.path ?? null,
        publisher,
        now,
      });
      if (!event) {
        process.stderr.write(
          `artifact-bus-cli publish: rejected — check --topic (got ${JSON.stringify(flags.topic)}, expected ` +
            `<type>/<scope>/<resource> with type in handoff|status|context|review|approval|heartbeat) ` +
            `and --event (published|streaming|closed|retracted).\n`,
        );
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(event) + "\n");
      break;
    }
    case "register": {
      const runDir = runDirOf(flags);
      if (!flags["subscriber-id"] || !flags.topics) {
        process.stderr.write("artifact-bus-cli register: --subscriber-id and --topics are required\n");
        process.exit(1);
      }
      const sub = registerSubscriber(runDir, {
        subscriber_id: flags["subscriber-id"],
        host_id: flags.host ?? "claude-local",
        topics: flags.topics.split(",").map((t) => t.trim()).filter(Boolean),
        callback: (flags.callback as never) ?? "hook",
        now,
      });
      if (!sub) {
        process.stderr.write("artifact-bus-cli register: invalid subscriber (check id/topics/callback)\n");
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(sub) + "\n");
      break;
    }
    case "tail": {
      const runDir = runDirOf(flags);
      const since = flags.since !== undefined ? Number(flags.since) : -1;
      for (const ev of tailBusLog(runDir, since)) process.stdout.write(JSON.stringify(ev) + "\n");
      break;
    }
    case "fanout": {
      const runDir = runDirOf(flags);
      const seq = Number(flags.seq);
      const ev = readBusLog(runDir).find((e) => e.seq === seq);
      if (!ev) {
        process.stderr.write(`artifact-bus-cli fanout: no event with seq=${flags.seq}\n`);
        process.exit(1);
      }
      const out = fanout(runDir, ev);
      process.stdout.write(JSON.stringify({
        event: ev,
        hook: out.hook.map((s) => s.subscriber_id),
        poll: out.poll.map((s) => s.subscriber_id),
        webhook: out.webhook.map((s) => s.subscriber_id),
      }) + "\n");
      break;
    }
    case "cas-get": {
      const runDir = runDirOf(flags);
      if (!flags.sha256) {
        process.stderr.write("artifact-bus-cli cas-get: --sha256 is required\n");
        process.exit(1);
      }
      const meta = casGet(runDir, flags.sha256);
      if (!meta) {
        process.stderr.write(`artifact-bus-cli cas-get: no CAS entry for ${flags.sha256}\n`);
        process.exit(1);
      }
      process.stdout.write(JSON.stringify(meta) + "\n");
      break;
    }
    default:
      process.stderr.write(
        "artifact-bus-cli: unknown command. Use publish | register | tail | fanout | cas-get.\n",
      );
      process.exit(1);
  }
}

main();
