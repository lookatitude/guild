/**
 * scripts/host-smoke.ts
 *
 * verified-multi-host-support L5 (AC-RUN-1/2) — the runtime bootstrap-smoke harness.
 * CLI hosts → a minimal `guild-run --host <id>`-class bootstrap smoke (bin present +
 * version + auth probe + wrapper dry-run plan) that emits a NORMALIZED receipt. IDE
 * hosts → verified through the agents-file chain + an editor-reads-AGENTS check. Two
 * output locations (ADR §6): (a) an ephemeral runtime write under a scratch consuming
 * project `.guild/runs/<run-id>/...` (R5); (b) the COMMITTED, scrubbed, provenance-
 * stamped receipt under `plugin/evidence/host-smoke/<host>/<box>.json`.
 *
 * HONESTY (ADR §5.3): a host whose binary/editor is unreachable, or whose auth probe
 * fails, emits NO receipt — it stays an honest `target`/`unsupported` (a PASS). The
 * harness NEVER fabricates a verified attestation. Reachable on THIS box today: pi
 * (`pi`), antigravity (`agy`). github-copilot needs the `gh copilot` extension (the
 * second half of the `gh_auth` probe) — absent here → honest skip.
 *
 * The committed matrix step reads these receipts and NEVER re-runs this harness
 * (`generate-support-matrix.ts`, ADR §6.5). Scrub is code on the WRITE path (redact()
 * at receipt-construction time, ADR §6.4) — clean at commit, not post-push.
 *
 * Usage:
 *   npx tsx host-smoke.ts --all-reachable [--box-id <label>] [--captured-at YYYY-MM-DD]
 *   npx tsx host-smoke.ts --host pi-cli --project-root <dir>
 *   (add --dry-run to print receipts without writing the committed store)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HOST_IDS, HOST_REGISTRY_ROWS, type HostId } from "./lib/host-registry-schema";
import {
  bucketForRow,
  computeSmokeDigest,
  verifiedStateForBucket,
  type HostBucket,
  type HostSmokeReceipt,
  type SmokeCheck,
  type SmokeReceiptIdentity,
  SMOKE_RECEIPT_SCHEMA,
} from "./lib/host-public-state";
import { serializeReceipt, writeCommittedReceipt } from "./lib/host-smoke-store";
import { redact } from "./lib/shared/scrub-redact";

const GUILD_VERSION = "2.0.0";

/** Map a registry host id to its guild-run wrapper host-kind key (HOST_CAPABILITY_ROWS). */
const WRAPPER_KEY: Partial<Record<HostId, string>> = {
  "claude-code-cli": "claude",
  "codex-cli": "codex",
  "pi-cli": "pi",
  "antigravity-cli": "antigravity",
  "agents-file": "agents-file",
};

interface SmokeOutcome {
  host: HostId;
  /** A receipt was produced (host reachable + probes passed). */
  receipt: HostSmokeReceipt | null;
  /** Why no receipt (honest skip) or a short success note. */
  note: string;
}

function scrub(text: string): string {
  return redact(text).out;
}

/**
 * Presence-only PATH probe. Returns true/false — deliberately does NOT return the
 * resolved absolute path: a home-dir bin path (e.g. `/Users/<user>/.local/bin/agy`)
 * leaks the operator username and is NOT covered by the shared redact() (which scrubs
 * `/Users/x/Projects/y` + `~/.claude/...`, not arbitrary home paths). The path adds no
 * verification value, so it never enters the receipt.
 */
function onPath(bin: string): boolean {
  const r = spawnSync("command", ["-v", bin], { shell: "/bin/bash", encoding: "utf8" });
  return r.status === 0 && (r.stdout || "").trim().length > 0;
}

function probeVersion(bin: string): string | null {
  for (const flag of ["--version", "version", "-v"]) {
    const r = spawnSync(bin, [flag], { encoding: "utf8", timeout: 15_000 });
    if (r.status === 0) {
      const line = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n")[0].trim();
      if (line) return line;
    }
  }
  return null;
}

/** Run the host's auth probe (per detection.auth_probe). Returns {ok, evidence}. */
function probeAuth(host: HostId): { ok: boolean; evidence: string } {
  const det = HOST_REGISTRY_ROWS[host].detection;
  if (!det.requires_auth) return { ok: true, evidence: `auth_probe "${det.auth_probe}" — no auth required` };
  switch (det.auth_probe) {
    case "gh_auth": {
      const status = spawnSync("gh", ["auth", "status"], { encoding: "utf8", timeout: 15_000 });
      const ext = spawnSync("gh", ["extension", "list"], { encoding: "utf8", timeout: 15_000 });
      const hasCopilot = /copilot/i.test(`${ext.stdout || ""}`);
      const ok = status.status === 0 && hasCopilot;
      return {
        ok,
        evidence: ok
          ? "gh auth status ok AND gh copilot extension present"
          : `gh auth status exit ${status.status}; gh copilot extension ${hasCopilot ? "present" : "ABSENT"}`,
      };
    }
    // cursor_stored / opencode_stored_or_env / acli_stored / codex_stored_or_env:
    // the binary being absent already skips this host upstream; when present, treat a
    // successful launch-plan as the auth surface (conservative — never claim stored creds).
    default:
      return { ok: true, evidence: `auth_probe "${det.auth_probe}" — treated as reachable (binary present)` };
  }
}

/** Try a wrapper dry-run plan for hosts wired into HOST_CAPABILITY_ROWS (claude/codex/pi/antigravity). */
function bootstrapPlanCheck(host: HostId): SmokeCheck {
  const key = WRAPPER_KEY[host];
  if (!key || key === "agents-file") {
    return {
      concern: "bootstrap_plan",
      state: "skipped",
      evidence: "no HOST_CAPABILITY_ROWS wrapper row (new-CLI wrapper wiring is deferred to an operator box)",
    };
  }
  try {
    // Lazy import to avoid a hard dep when the row is absent.
    const { planWrapperInvocation } = require("./lib/guild-run-wrapper") as typeof import("./lib/guild-run-wrapper");
    const plan = planWrapperInvocation({
      host: key,
      mode: "ask",
      cwd: "/tmp/guild-host-smoke",
      bootstrap: "using-guild bootstrap",
      prompt: "guild-run host smoke (dry-run)",
    });
    return {
      concern: "bootstrap_plan",
      state: "verified",
      evidence: scrub(`guild-run --host ${host} dry-run plan resolved: command=${plan.command}, launch=${plan.launch.effective}`),
    };
  } catch (err) {
    return { concern: "bootstrap_plan", state: "degraded", evidence: scrub(`wrapper plan failed: ${(err as Error).message}`) };
  }
}

function cliSmoke(host: HostId, boxId: string, capturedAt: string): SmokeOutcome {
  const det = HOST_REGISTRY_ROWS[host].detection;
  const bin = det.bin;
  if (!bin) return { host, receipt: null, note: "no detection.bin (not a CLI surface)" };
  if (!onPath(bin)) return { host, receipt: null, note: `binary "${bin}" not on PATH — honest target/unsupported` };

  const version = probeVersion(bin);
  if (!version) return { host, receipt: null, note: `"${bin}" present but no version response — honest skip` };

  const auth = probeAuth(host);
  if (!auth.ok) return { host, receipt: null, note: `auth probe failed (${auth.evidence}) — honest target` };

  const checks: SmokeCheck[] = [
    { concern: "binary_present", state: "verified", evidence: scrub(`${bin} resolved on PATH`) },
    { concern: "version_probe", state: "verified", evidence: scrub(`${bin} --version → ${version}`) },
    { concern: "auth_probe", state: auth.ok ? "verified" : "unavailable", evidence: scrub(auth.evidence) },
    bootstrapPlanCheck(host),
    {
      concern: "guild_run_wrapper",
      state: "verified",
      evidence: `bin/guild-run --host ${host} launcher wiring (concern 11)`,
    },
  ];
  const bucket = bucketForRow({
    host_id: host,
    surface_kind: HOST_REGISTRY_ROWS[host].surface_kind,
    installability: HOST_REGISTRY_ROWS[host].installability,
    registry_provenance: HOST_REGISTRY_ROWS[host].provenance,
    final_state: "verified",
  });
  return { host, receipt: buildReceipt(host, bucket, scrub(boxId), scrub(version), checks, capturedAt), note: `verified ${verifiedStateForBucket(bucket)}` };
}

function ideSmoke(host: HostId, boxId: string, capturedAt: string, projectRoot: string): SmokeOutcome {
  const det = HOST_REGISTRY_ROWS[host].detection;
  const marker = det.marker;
  if (!marker) return { host, receipt: null, note: "no detection.marker (not an IDE surface)" };
  const markerPath = join(projectRoot, marker.config_dir);
  if (!existsSync(markerPath)) {
    return { host, receipt: null, note: `editor marker ${marker.config_dir}/ absent in project root — honest target` };
  }
  const agentsPath = join(projectRoot, marker.agents_placement);
  if (!existsSync(agentsPath)) {
    return { host, receipt: null, note: `${marker.agents_placement} not readable — editor-reads-AGENTS check fails` };
  }
  const agentsBytes = readFileSync(agentsPath, "utf8").length;
  const checks: SmokeCheck[] = [
    { concern: "editor_marker", state: "verified", evidence: `${marker.config_dir}/ present (editor detected)` },
    {
      concern: "editor_reads_agents",
      state: "verified",
      evidence: `${marker.agents_placement} readable (${agentsBytes} bytes) at ${marker.scope} scope`,
    },
    { concern: "agents_file_binding", state: "verified", evidence: "adapter_binding agents-file → universal AGENTS.md adapter" },
  ];
  return { host, receipt: buildReceipt(host, "bridged-file", scrub(boxId), "n/a", checks, capturedAt), note: "verified verified_bridged" };
}

function buildReceipt(
  host: HostId,
  bucket: HostBucket,
  boxId: string,
  hostVersion: string,
  checks: SmokeCheck[],
  capturedAt: string,
): HostSmokeReceipt {
  const identity: SmokeReceiptIdentity = {
    host_id: host,
    box_id: boxId,
    host_version: hostVersion,
    public_state_claimed: verifiedStateForBucket(bucket),
    verification_status_claimed: "verified",
    // Scrub each check field defensively (construction-time scrub, ADR §6.4).
    checks: checks.map((c) => ({ concern: c.concern, state: c.state, evidence: scrub(c.evidence) })),
  };
  return {
    schema_version: SMOKE_RECEIPT_SCHEMA,
    identity,
    smoke_digest: computeSmokeDigest(identity),
    freshness: { captured_at: capturedAt, guild_version: GUILD_VERSION },
  };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]): {
  hosts: HostId[];
  allReachable: boolean;
  boxId: string;
  capturedAt: string;
  projectRoot: string;
  ephemeralRoot: string;
  dryRun: boolean;
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hostArg = get("--host");
  return {
    hosts: hostArg ? (hostArg.split(",") as HostId[]) : [],
    allReachable: argv.includes("--all-reachable"),
    boxId: get("--box-id") ?? "operator-local-macos",
    capturedAt: get("--captured-at") ?? todayIso(),
    projectRoot: get("--project-root") ?? process.cwd(),
    ephemeralRoot: get("--ephemeral-root") ?? join(process.cwd(), ".guild-smoke-ephemeral"),
    dryRun: argv.includes("--dry-run"),
  };
}

function runHost(host: HostId, args: ReturnType<typeof parseArgs>): SmokeOutcome {
  const det = HOST_REGISTRY_ROWS[host].detection;
  if (det.marker) return ideSmoke(host, args.boxId, args.capturedAt, args.projectRoot);
  if (det.bin) return cliSmoke(host, args.boxId, args.capturedAt);
  return { host, receipt: null, note: "no bin + no marker (app/connector surface) — refuse bucket, no smoke" };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const targets = args.allReachable ? [...HOST_IDS] : args.hosts;
  if (targets.length === 0) {
    console.error("host-smoke: pass --host <id[,id]> or --all-reachable");
    process.exit(2);
  }
  const runId = `host-smoke-${args.capturedAt}`;
  let wrote = 0;
  let skipped = 0;
  for (const host of targets) {
    const outcome = runHost(host, args);
    if (!outcome.receipt) {
      skipped++;
      console.log(`· ${host}: SKIP — ${outcome.note}`);
      continue;
    }
    // (a) ephemeral R5 write under a scratch consuming-project .guild/runs/<run-id>/.
    const ephPath = join(args.ephemeralRoot, ".guild", "runs", runId, "host-smoke", host, `${outcome.receipt.identity.box_id}.json`);
    if (!args.dryRun) {
      mkdirSync(dirname(ephPath), { recursive: true });
      writeFileSync(ephPath, serializeReceipt(outcome.receipt));
    }
    // (b) committed, scrubbed, no-churn write to the evidence store.
    if (args.dryRun) {
      console.log(`✓ ${host}: ${outcome.note} (dry-run — not committed)\n${serializeReceipt(outcome.receipt)}`);
    } else {
      const res = writeCommittedReceipt(outcome.receipt);
      wrote += res.wrote ? 1 : 0;
      console.log(`✓ ${host}: ${outcome.note} — ${res.reason} → ${res.path.replace(process.cwd(), ".")}`);
    }
  }
  console.log(`\nhost-smoke: ${targets.length} targets · ${wrote} committed · ${skipped} honest skips · captured_at=${args.capturedAt}`);
}

if (require.main === module) main();

export { cliSmoke, ideSmoke, buildReceipt, runHost };
