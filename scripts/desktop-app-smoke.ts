/**
 * scripts/desktop-app-smoke.ts
 *
 * Operator-assisted desktop app command-surface evidence for app/connector hosts.
 * This does NOT promote public support state: app rows cannot take package-install
 * smoke receipts. It records whether the real desktop app accepted Guild's command
 * path, and which fallback was observed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "./lib/shared/scrub-redact";

export const DESKTOP_APP_HOSTS = ["claude-code-app", "codex-app"] as const;
export type DesktopAppHost = (typeof DESKTOP_APP_HOSTS)[number];

export const DESKTOP_SMOKE_RESULTS = [
  "codex-slash-forwarded",
  "codex-slash-rejected-fallback-ok",
  "claude-native-slash-ok",
  "claude-native-slash-missing-fallback-ok",
  "blocked",
  "failed",
] as const;
export type DesktopSmokeResult = (typeof DESKTOP_SMOKE_RESULTS)[number];

export interface DesktopAppSmokeReceipt {
  schema_version: "guild.desktop_app_smoke.v1";
  host_id: DesktopAppHost;
  box_id: string;
  captured_at: string;
  app_bundle_id: string;
  app_version: string | null;
  result: DesktopSmokeResult;
  public_state_effect: "none";
  command_probe: {
    attempted_input: string;
    expected_bridge: string;
    observed_behavior: string;
    fallback: string;
  };
  checks: Array<{ name: string; state: "passed" | "failed" | "blocked"; evidence: string }>;
  notes: string | null;
}

function usage(): never {
  console.error(`desktop-app-smoke

Usage:
  npx tsx desktop-app-smoke.ts --host codex-app --result codex-slash-forwarded --box-id <label> --evidence "..."
  npx tsx desktop-app-smoke.ts --host claude-code-app --result claude-native-slash-ok --box-id <label> --write

Options:
  --host <codex-app|claude-code-app>
  --result <${DESKTOP_SMOKE_RESULTS.join("|")}>
  --box-id <label>                 Stable operator-box label.
  --captured-at <YYYY-MM-DD>       Defaults to today's UTC date.
  --app-version <version>          Optional desktop app version.
  --evidence <text>                Repeatable short evidence line.
  --notes <text>                   Optional notes.
  --out <dir>                      Defaults to evidence/desktop-app-smoke.
  --write                          Write committed evidence path; otherwise prints JSON only.
`);
  process.exit(1);
}

function pluginRoot(): string {
  return join(__dirname, "..");
}

function defaultEvidenceRoot(): string {
  return join(pluginRoot(), "evidence", "desktop-app-smoke");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean | string[]> = { evidence: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      args.write = true;
      continue;
    }
    if (!arg.startsWith("--")) usage();
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) usage();
    i += 1;
    if (key === "evidence") (args.evidence as string[]).push(value);
    else args[key] = value;
  }
  return args;
}

function isDesktopAppHost(value: unknown): value is DesktopAppHost {
  return typeof value === "string" && (DESKTOP_APP_HOSTS as readonly string[]).includes(value);
}

function isResult(value: unknown): value is DesktopSmokeResult {
  return typeof value === "string" && (DESKTOP_SMOKE_RESULTS as readonly string[]).includes(value);
}

function stateFor(result: DesktopSmokeResult): "passed" | "failed" | "blocked" {
  if (result === "blocked") return "blocked";
  if (result === "failed") return "failed";
  return "passed";
}

function commandProbe(host: DesktopAppHost, result: DesktopSmokeResult): DesktopAppSmokeReceipt["command_probe"] {
  if (host === "codex-app") {
    return {
      attempted_input: "/guild:status",
      expected_bridge: "Codex plugin UserPromptSubmit hook receives /guild text from Codex App",
      observed_behavior:
        result === "codex-slash-forwarded"
          ? "slash text reached the Guild prompt bridge"
          : result === "codex-slash-rejected-fallback-ok"
            ? "Codex App rejected slash text before hooks; explicit plugin/skill fallback worked"
            : result,
      fallback: "Invoke the installed Guild plugin or bundled guild skill explicitly with @.",
    };
  }
  return {
    attempted_input: '/guild:guild "desktop smoke"',
    expected_bridge: "Claude desktop exposes the installed Guild slash command after restart",
    observed_behavior:
      result === "claude-native-slash-ok"
        ? "native Guild slash command appeared and dispatched"
        : result === "claude-native-slash-missing-fallback-ok"
          ? "native Guild slash command was unavailable; Claude Code CLI/manual packet fallback worked"
          : result,
    fallback: "Use the Claude Code CLI Guild plugin install or paste the manual Guild instruction packet.",
  };
}

function bundleId(host: DesktopAppHost): string {
  return host === "codex-app" ? "com.openai.codex" : "com.anthropic.claudefordesktop";
}

function sanitizeText(text: string): string {
  return redact(text).out;
}

export function validateDesktopAppSmokeReceipt(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["receipt must be an object"];
  const receipt = value as DesktopAppSmokeReceipt;
  if (receipt.schema_version !== "guild.desktop_app_smoke.v1") errors.push("bad schema_version");
  if (!isDesktopAppHost(receipt.host_id)) errors.push("bad host_id");
  if (receipt.app_bundle_id !== bundleId(receipt.host_id)) errors.push("app_bundle_id does not match host_id");
  if (!receipt.box_id || !/^[A-Za-z0-9._-]+$/.test(receipt.box_id)) errors.push("box_id must be [A-Za-z0-9._-]+");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receipt.captured_at)) errors.push("captured_at must be YYYY-MM-DD");
  if (!isResult(receipt.result)) errors.push("bad result");
  if (receipt.host_id === "codex-app" && typeof receipt.result === "string" && receipt.result.startsWith("claude-")) {
    errors.push("codex-app receipt cannot use claude result");
  }
  if (receipt.host_id === "claude-code-app" && typeof receipt.result === "string" && receipt.result.startsWith("codex-")) {
    errors.push("claude-code-app receipt cannot use codex result");
  }
  if (receipt.public_state_effect !== "none") errors.push("desktop app receipt must not affect public state");
  if (!receipt.command_probe || typeof receipt.command_probe !== "object") errors.push("command_probe is required");
  if (!Array.isArray(receipt.checks) || receipt.checks.length === 0) errors.push("at least one evidence check is required");
  if (Array.isArray(receipt.checks)) {
    for (const [idx, check] of receipt.checks.entries()) {
      if (!check || typeof check !== "object") {
        errors.push(`checks[${idx}] must be an object`);
        continue;
      }
      if (!["passed", "failed", "blocked"].includes(check.state)) errors.push(`checks[${idx}].state is invalid`);
      if (typeof check.evidence !== "string" || check.evidence.length === 0) errors.push(`checks[${idx}].evidence is required`);
    }
  }
  return errors;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildDesktopAppSmokeReceipt(input: {
  host: DesktopAppHost;
  result: DesktopSmokeResult;
  boxId: string;
  capturedAt?: string;
  appVersion?: string;
  evidence: string[];
  notes?: string;
}): DesktopAppSmokeReceipt {
  const checkState = stateFor(input.result);
  const evidence = input.evidence.length > 0 ? input.evidence : ["operator recorded desktop app command-surface observation"];
  return {
    schema_version: "guild.desktop_app_smoke.v1",
    host_id: input.host,
    box_id: input.boxId,
    captured_at: input.capturedAt ?? todayUtc(),
    app_bundle_id: bundleId(input.host),
    app_version: input.appVersion ? sanitizeText(input.appVersion) : null,
    result: input.result,
    public_state_effect: "none",
    command_probe: commandProbe(input.host, input.result),
    checks: evidence.map((line, idx) => ({
      name: `operator_evidence_${idx + 1}`,
      state: checkState,
      evidence: sanitizeText(line),
    })),
    notes: input.notes ? sanitizeText(input.notes) : null,
  };
}

export function writeDesktopAppSmokeReceipt(
  receipt: DesktopAppSmokeReceipt,
  evidenceRoot: string = defaultEvidenceRoot(),
): string {
  const errors = validateDesktopAppSmokeReceipt(receipt);
  if (errors.length > 0) throw new Error(errors.join("; "));
  const path = join(evidenceRoot, receipt.host_id, `${receipt.box_id}.json`);
  const serialized = `${canonical(receipt)}\n`;
  const red = redact(serialized);
  if (red.out !== serialized || red.opPaths > 0 || red.secrets.length > 0) {
    throw new Error(`refusing to write desktop app receipt with unsanitized evidence: ${path}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path) || readFileSync(path, "utf8") !== serialized) writeFileSync(path, serialized);
  return path;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host;
  const result = args.result;
  const boxId = args["box-id"];
  if (!isDesktopAppHost(host) || !isResult(result) || typeof boxId !== "string") usage();
  const receipt = buildDesktopAppSmokeReceipt({
    host,
    result,
    boxId,
    capturedAt: typeof args["captured-at"] === "string" ? args["captured-at"] : undefined,
    appVersion: typeof args["app-version"] === "string" ? args["app-version"] : undefined,
    evidence: Array.isArray(args.evidence) ? args.evidence : [],
    notes: typeof args.notes === "string" ? args.notes : undefined,
  });
  const errors = validateDesktopAppSmokeReceipt(receipt);
  if (errors.length > 0) throw new Error(errors.join("; "));
  if (args.write === true) {
    const out = typeof args.out === "string" ? args.out : defaultEvidenceRoot();
    console.log(`desktop-app-smoke: wrote ${writeDesktopAppSmokeReceipt(receipt, out)}`);
  } else {
    process.stdout.write(`${canonical(receipt)}\n`);
  }
}

if (require.main === module) main();
