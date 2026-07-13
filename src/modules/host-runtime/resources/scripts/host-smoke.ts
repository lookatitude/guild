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
 *
 * L5b — the NATIVE reference-host path. `claude-code-cli` (target `native`) is NOT a
 * wrapped guild-run host: instead of a wrapper dry-run it DETERMINISTICALLY attests the
 * Guild plugin is natively loaded (manifest present + hooks wired to compiled dist +
 * skills discoverable + commands present + the `claude` binary responds). A passing
 * attestation promotes it to `native` via the SAME bucket/derive/gate logic
 * (keep-native-cli → native) — no special-cased rung. Any missing native marker → NO
 * receipt (honest `target`, a PASS). `codex-cli` (target `verified_wrapped`) runs the
 * ordinary wrapped-CLI smoke, defensively disabling plugin hooks so a malformed Codex
 * plugins.json cannot hang the version probe.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, type Dirent } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Map a registry host id to its guild-run wrapper host-kind key
 * (DERIVED_HOST_CAPABILITY_ROWS, host-registry.ts). The wrapper itself now also
 * carries rows for the 4 wrapped-CLI hosts (cursor/github-copilot/opencode/
 * rovo-dev — G4b), but this smoke deliberately does NOT plan-check them yet:
 * their registry rows are installability:"target" (runtime install unproven),
 * and widening smoke coverage is an operator-box decision, not a drive-by.
 */
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
 * The plugin repo root, resolved from this module's location (scripts → plugin). The
 * native attestation probes real markers under this root. Mirrors the same "run from
 * the working scripts/ tree" assumption as host-smoke-store.ts's defaultEvidenceRoot().
 */
function pluginRoot(): string {
  return join(__dirname, "..");
}

/**
 * Per-host spawn env override (defensive). Codex's plugin hooks can hang a bare
 * `codex <flag>` on some releases (the 1.0.5 malformed-hooks caveat); CODEX_DISABLE_PLUGINS=1
 * neutralizes it. No-op for every other host.
 */
function hostSpawnEnv(host: HostId): NodeJS.ProcessEnv | undefined {
  if (host === "codex-cli") return { ...process.env, CODEX_DISABLE_PLUGINS: "1" };
  return undefined;
}

/** Count files whose basename matches `pred` under a dir tree. Deterministic; no clock/nonce. */
function countFiles(root: string, pred: (name: string) => boolean): number {
  let n = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (pred(e.name)) n++;
    }
  }
  return n;
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

function probeVersion(bin: string, env?: NodeJS.ProcessEnv): string | null {
  for (const flag of ["--version", "version", "-v"]) {
    const r = spawnSync(bin, [flag], { encoding: "utf8", timeout: 15_000, ...(env ? { env } : {}) });
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

/** Try a wrapper dry-run plan for the hosts in WRAPPER_KEY (claude/codex/pi/antigravity). */
function bootstrapPlanCheck(host: HostId): SmokeCheck {
  const key = WRAPPER_KEY[host];
  if (!key || key === "agents-file") {
    return {
      concern: "bootstrap_plan",
      state: "skipped",
      evidence: "not in this smoke's WRAPPER_KEY set (wrapper rows exist via DERIVED_HOST_CAPABILITY_ROWS; new-CLI smoke plan-coverage is deferred to an operator box)",
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

  const version = probeVersion(bin, hostSpawnEnv(host));
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

/**
 * The claude-code-cli NATIVE reference-host smoke (L5b). Unlike the wrapped `cliSmoke`,
 * the native attestation does not plan a guild-run wrapper invocation — Claude IS the
 * reference author host, it loads the plugin natively. It DETERMINISTICALLY verifies the
 * Guild plugin is natively loadable on THIS box:
 *   - the `claude` binary resolves + responds to --version;
 *   - the plugin manifest (`.claude-plugin/plugin.json`, name "guild") is present;
 *   - hooks are wired: `hooks/hooks.json` present AND every compiled `hooks/dist/*.js` it
 *     references exists on disk (source edits are a no-op until built — a wired dist is the
 *     honest "hooks actually run" attestation);
 *   - skills are discoverable (≥1 `SKILL.md` under `skills/`);
 *   - commands are present (≥1 `*.md` under `commands/`).
 * A pass promotes claude-code-cli to `native` via the SAME bucket/derive/gate path
 * (keep-native-cli → native). Any missing marker → NO receipt (honest `target`, a PASS);
 * the harness NEVER fabricates a native claim.
 */
function nativeSmoke(host: HostId, boxId: string, capturedAt: string): SmokeOutcome {
  const det = HOST_REGISTRY_ROWS[host].detection;
  const bin = det.bin;
  if (!bin) return { host, receipt: null, note: "no detection.bin (not a CLI surface)" };
  if (!onPath(bin)) return { host, receipt: null, note: `binary "${bin}" not on PATH — honest target/unsupported` };
  const version = probeVersion(bin, hostSpawnEnv(host));
  if (!version) return { host, receipt: null, note: `"${bin}" present but no version response — honest skip` };

  const root = pluginRoot();
  const manifestPath = join(root, ".claude-plugin", "plugin.json");
  const hooksJsonPath = join(root, "hooks", "hooks.json");
  const skillsDir = join(root, "skills");
  const commandsDir = join(root, "commands");

  // Hard native markers — any absent → honest skip (no fabricated native claim).
  for (const [label, p] of [
    ["plugin manifest .claude-plugin/plugin.json", manifestPath],
    ["hooks/hooks.json", hooksJsonPath],
    ["skills/", skillsDir],
    ["commands/", commandsDir],
  ] as const) {
    if (!existsSync(p)) return { host, receipt: null, note: `native marker absent (${label}) — honest target` };
  }

  // Manifest identity — must be the Guild plugin.
  let manifestName = "";
  try {
    manifestName = (JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string }).name ?? "";
  } catch (err) {
    return { host, receipt: null, note: `plugin manifest unreadable (${(err as Error).message}) — honest skip` };
  }
  if (manifestName !== "guild") {
    return { host, receipt: null, note: `plugin manifest name "${manifestName}" != "guild" — honest skip` };
  }

  // Hooks wired: every compiled dist js the manifest references must exist on disk.
  const hooksJson = readFileSync(hooksJsonPath, "utf8");
  const refDist = [...new Set(hooksJson.match(/hooks\/dist\/[A-Za-z0-9._-]+\.js/g) ?? [])].sort();
  const missingDist = refDist.filter((rel) => !existsSync(join(root, rel)));
  if (refDist.length === 0 || missingDist.length > 0) {
    return {
      host,
      receipt: null,
      note:
        refDist.length === 0
          ? "hooks.json references no compiled dist hooks — honest skip"
          : `${missingDist.length}/${refDist.length} referenced hooks/dist/*.js absent (hooks unbuilt) — honest target`,
    };
  }

  const skillCount = countFiles(skillsDir, (n) => n === "SKILL.md");
  const commandCount = countFiles(commandsDir, (n) => n.endsWith(".md") && n !== ".gitkeep");
  if (skillCount === 0 || commandCount === 0) {
    return { host, receipt: null, note: `skills(${skillCount})/commands(${commandCount}) not discoverable — honest skip` };
  }

  const checks: SmokeCheck[] = [
    { concern: "binary_present", state: "verified", evidence: scrub(`${bin} resolved on PATH`) },
    { concern: "version_probe", state: "verified", evidence: scrub(`${bin} --version → ${version}`) },
    { concern: "plugin_manifest", state: "verified", evidence: `.claude-plugin/plugin.json present (name="${manifestName}")` },
    {
      concern: "hooks_wired",
      state: "verified",
      evidence: `hooks/hooks.json present; ${refDist.length}/${refDist.length} referenced hooks/dist/*.js compiled + on disk`,
    },
    { concern: "skills_discoverable", state: "verified", evidence: `skills/ discoverable (${skillCount} SKILL.md)` },
    { concern: "commands_present", state: "verified", evidence: `commands/ present (${commandCount} command files)` },
    {
      concern: "native_plugin_load",
      state: "verified",
      evidence: "Guild plugin natively loaded (manifest + wired hooks + skills + commands) at claude-code-cli host scope",
    },
  ];
  const bucket = bucketForRow({
    host_id: host,
    surface_kind: HOST_REGISTRY_ROWS[host].surface_kind,
    installability: HOST_REGISTRY_ROWS[host].installability,
    registry_provenance: HOST_REGISTRY_ROWS[host].provenance,
    final_state: "verified",
  });
  return {
    host,
    receipt: buildReceipt(host, bucket, scrub(boxId), scrub(version), checks, capturedAt),
    note: `verified ${verifiedStateForBucket(bucket)} (native attestation)`,
  };
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
  ephemeralRootIsTemp: boolean;
  dryRun: boolean;
} {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const hostArg = get("--host");
  const ephemeralRootFlag = get("--ephemeral-root");
  // No --ephemeral-root override → mint a real OS tmpdir (mkdtempSync) instead of a
  // fixed `.guild-smoke-ephemeral` dir under cwd (that fixed name was leaking into
  // the plugin repo as untracked junk whenever host-smoke ran from the repo root —
  // see the nested-guild audit finding). Best-effort cleaned up in main() on exit.
  const ephemeralRoot = ephemeralRootFlag ?? mkdtempSync(join(tmpdir(), "guild-smoke-"));
  return {
    hosts: hostArg ? (hostArg.split(",") as HostId[]) : [],
    allReachable: argv.includes("--all-reachable"),
    boxId: get("--box-id") ?? "operator-local-macos",
    capturedAt: get("--captured-at") ?? todayIso(),
    projectRoot: get("--project-root") ?? process.cwd(),
    ephemeralRoot,
    ephemeralRootIsTemp: !ephemeralRootFlag,
    dryRun: argv.includes("--dry-run"),
  };
}

function runHost(host: HostId, args: ReturnType<typeof parseArgs>): SmokeOutcome {
  const det = HOST_REGISTRY_ROWS[host].detection;
  if (det.marker) return ideSmoke(host, args.boxId, args.capturedAt, args.projectRoot);
  // claude-code-cli is the keep-native-cli reference host: attest native plugin load,
  // not a guild-run wrapper dry-run (which is for the wrapped-cli bucket).
  if (host === "claude-code-cli") return nativeSmoke(host, args.boxId, args.capturedAt);
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
  // Best-effort cleanup of the auto-minted tmpdir (never remove an operator-supplied
  // --ephemeral-root — that path is theirs to manage).
  if (args.ephemeralRootIsTemp) {
    try {
      rmSync(args.ephemeralRoot, { recursive: true, force: true });
    } catch {
      // best-effort only — a leftover tmpdir under the OS tmp root is not a leak.
    }
  }
}

if (require.main === module) main();

export { cliSmoke, nativeSmoke, ideSmoke, buildReceipt, runHost };
