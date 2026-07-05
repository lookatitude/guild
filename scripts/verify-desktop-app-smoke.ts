/**
 * scripts/verify-desktop-app-smoke.ts
 *
 * Validates committed desktop app smoke receipts. This gate is deliberately
 * about evidence quality, not support promotion: app receipts always carry
 * public_state_effect:none and never feed the host public-state matrix.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DESKTOP_APP_HOSTS,
  type DesktopAppHost,
  type DesktopAppSmokeReceipt,
  validateDesktopAppSmokeReceipt,
} from "./desktop-app-smoke";

type DesktopStatus = "passed" | "fallback" | "blocked" | "failed" | "missing";

interface HostSummary {
  host: DesktopAppHost;
  status: DesktopStatus;
  receiptCount: number;
  latestResult: string | null;
}

interface Verification {
  ok: boolean;
  errors: string[];
  summaries: HostSummary[];
}

function pluginRoot(): string {
  return join(__dirname, "..");
}

function defaultEvidenceRoot(): string {
  return join(pluginRoot(), "evidence", "desktop-app-smoke");
}

function usage(): never {
  console.error(`verify-desktop-app-smoke

Usage:
  npx tsx verify-desktop-app-smoke.ts [--root <plugin-root>] [--evidence <dir>] [--require codex-app,claude-code-app]

The verifier fails malformed receipts. It only requires receipts for hosts named
with --require; otherwise missing desktop receipts are reported but not failures.
`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const out: { root?: string; evidence?: string; require: DesktopAppHost[] } = { require: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usage();
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();
    i += 1;
    if (arg === "--root") out.root = value;
    else if (arg === "--evidence") out.evidence = value;
    else if (arg === "--require") {
      out.require = value.split(",").filter(Boolean).map((host) => {
        if (!(DESKTOP_APP_HOSTS as readonly string[]).includes(host)) usage();
        return host as DesktopAppHost;
      });
    } else usage();
  }
  return out;
}

function resultStatus(receipt: DesktopAppSmokeReceipt): DesktopStatus {
  switch (receipt.result) {
    case "codex-slash-forwarded":
    case "claude-native-slash-ok":
      return "passed";
    case "codex-slash-rejected-fallback-ok":
    case "claude-native-slash-missing-fallback-ok":
      return "fallback";
    case "blocked":
      return "blocked";
    case "failed":
      return "failed";
  }
}

function stronger(a: DesktopStatus, b: DesktopStatus): DesktopStatus {
  const rank: Record<DesktopStatus, number> = { missing: 0, failed: 1, blocked: 2, fallback: 3, passed: 4 };
  return rank[b] > rank[a] ? b : a;
}

export function verifyDesktopAppSmokeReceipts(options: {
  pluginRoot?: string;
  evidenceRoot?: string;
  requireHosts?: DesktopAppHost[];
} = {}): Verification {
  const evidenceRoot = options.evidenceRoot ?? join(options.pluginRoot ?? pluginRoot(), "evidence", "desktop-app-smoke");
  const required = new Set(options.requireHosts ?? []);
  const errors: string[] = [];
  const summaries: HostSummary[] = [];

  for (const host of DESKTOP_APP_HOSTS) {
    const dir = join(evidenceRoot, host);
    let status: DesktopStatus = "missing";
    let latestResult: string | null = null;
    let receiptCount = 0;

    if (existsSync(dir)) {
      for (const file of readdirSync(dir).filter((name) => name.endsWith(".json")).sort()) {
        const full = join(dir, file);
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(full, "utf8"));
        } catch (err) {
          errors.push(`${host}/${file}: invalid JSON: ${(err as Error).message}`);
          continue;
        }
        const receiptErrors = validateDesktopAppSmokeReceipt(parsed);
        if (receiptErrors.length > 0) {
          errors.push(`${host}/${file}: ${receiptErrors.join("; ")}`);
          continue;
        }
        const receipt = parsed as DesktopAppSmokeReceipt;
        receiptCount += 1;
        latestResult = receipt.result;
        status = stronger(status, resultStatus(receipt));
      }
    }

    if (required.has(host)) {
      if (status === "missing") errors.push(`${host}: required desktop app smoke receipt missing`);
      else if (status === "blocked" || status === "failed") {
        errors.push(`${host}: required desktop app smoke receipt does not prove usability (status=${status})`);
      }
    }
    summaries.push({ host, status, receiptCount, latestResult });
  }

  return { ok: errors.length === 0, errors, summaries };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const evidenceRoot = args.evidence ?? (args.root ? join(args.root, "evidence", "desktop-app-smoke") : defaultEvidenceRoot());
  const result = verifyDesktopAppSmokeReceipts({ evidenceRoot, requireHosts: args.require });
  if (!result.ok) {
    console.error("verify-desktop-app-smoke: FAIL");
    for (const error of result.errors) console.error(`  ${error}`);
    process.exit(2);
  }
  const summary = result.summaries.map((row) => `${row.host}:${row.status}`).join(", ");
  console.log(`verify-desktop-app-smoke: PASS (${summary})`);
}

if (require.main === module) main();
