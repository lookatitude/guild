import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { exportSanitizedRun, redactRunString, RUN_EXPORT_SCRUBBER_VERSION } from "../lib/sanitized-run-export";

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-r7-export-"));
}

function write(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function seedGoldenRun(runDir: string): void {
  write(path.join(runDir, "run.yaml"), [
    "id: run-golden",
    "phase_order: [init, ideate, plan, build, qa]",
    "active_initiative: init-123",
    "active_spec: spec/auth",
    "active_plan: plan/auth",
    "privacy:",
    "  sanitized: false",
    "",
  ].join("\n"));
  write(path.join(runDir, "provenance.json"), JSON.stringify({
    schema_version: "guild.provenance.v1",
    team: [
      { agent: "researcher", host: "claude-code-cli", phase: "init", task_id: "t1", dispatch_order: 1, depends_on: [] },
      { agent: "builder", host: "codex-cli", phase: "build", task_id: "t2", dispatch_order: 2, depends_on: ["t1"] },
    ],
    operator_steering: [
      "Use the private path /Users/alice/private/customer-roadmap.md and token=ghp_abcdefghijklmnopqrstuvwxyz",
    ],
    approvals: [{ tool: "Bash", decision: "approved", auth: "Authorization: Bearer ya29.A0AfH6SMSECRET" }],
    reviews: [{ gate: "G-plan", status: "satisfied" }],
    artifacts: ["handoffs/researcher-t1.md", "verify.md"],
  }, null, 2));
  write(path.join(runDir, "logs", "v1.4-events.jsonl"), [
    JSON.stringify({
      event: "prompt",
      prompt: "Email jane.customer@example.com about card 4111 1111 1111 1111 and sk-proj-abcdefghijklmnopqrstuvwx",
    }),
    JSON.stringify({
      event: "tool_call",
      tool: "curl",
      input: "Cookie: sessionid=abc123; password=hunter2",
      result: "customer cus_ABCDEF123456 got refresh_token=rt_verysecret",
      structured: {
        password: "structured-hunter2",
        authorization: "Bearer raw-opaque-token-value-xyz",
        refresh_token: "rt_rawsecretvalue",
        api_key: "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    }),
    JSON.stringify({
      event: "response",
      text: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    }),
  ].join("\n") + "\n");
  write(path.join(runDir, "logs", "payloads", "evt-1.json"), JSON.stringify({
    tool_result: "configured secret INTERNAL-CODE-RED and project file /Users/alice/private/foo.ts",
  }, null, 2));
  write(path.join(runDir, "handoffs", "researcher-t1.md"), [
    "# Handoff",
    "Prompt and response were captured.",
    "api key sk-abcdefghijklmnop and user_id usr_ABCDEF1234",
    "",
  ].join("\n"));
  write(path.join(runDir, "review.md"), "No blocking findings. password: letmein\n");
  write(path.join(runDir, "verify.md"), "Verified with token=xoxb-abcdefghijklmnop\n");
  write(path.join(runDir, "summary.md"), "Summary for customer@example.com\n");
}

describe("R7 sanitized run export", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const run = () => {
    const root = mkTmp();
    tmpDirs.push(root);
    const runDir = path.join(root, ".guild", "runs", "run-golden");
    seedGoldenRun(runDir);
    return runDir;
  };

  it("redacts every R7 sensitive class in an anti-vacuous string fixture", () => {
    const raw = [
      "sk-abcdefghijklmnop",
      "password=hunter2",
      "token=ghp_abcdefghijklmnopqrstuvwxyz",
      "ghp_abcdefghijklmnopqrstuvwxyzabcdefghij",
      "github_pat_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_123456",
      "AKIAABCDEFGHIJKLMNOP",
      "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sk_live_abcdefghijklmnop",
      "Cookie: session=abc",
      "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      "Authorization: Bearer ya29.A0AfH6SMSECRET",
      "4111 1111 1111 1111",
      "jane@example.com",
      "cus_ABCDEF123456",
      "INTERNAL-CODE-RED",
      "/Users/alice/private/foo.ts",
      "/home/bob/private/foo.ts",
      "C:\\Users\\carol\\private\\foo.ts",
    ].join("\n");
    const out = redactRunString(raw, {
      configuredSecrets: ["INTERNAL-CODE-RED"],
      privatePathPrefixes: ["/Users/alice/private"],
    });
    for (const secret of [
      "sk-abcdefghijklmnop",
      "hunter2",
      "ghp_abcdefghijklmnopqrstuvwxyz",
      "ghp_abcdefghijklmnopqrstuvwxyzabcdefghij",
      "github_pat_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_123456",
      "AKIAABCDEFGHIJKLMNOP",
      "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sk_live_abcdefghijklmnop",
      "session=abc",
      "BEGIN PRIVATE KEY",
      "ya29.A0AfH6SMSECRET",
      "4111 1111 1111 1111",
      "jane@example.com",
      "cus_ABCDEF123456",
      "INTERNAL-CODE-RED",
      "/Users/alice/private/foo.ts",
      "/home/bob/private/foo.ts",
      "C:\\Users\\carol\\private\\foo.ts",
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("<redacted:api-key>");
    expect(out).toContain("<redacted:password>");
    expect(out).toContain("<redacted:token>");
    expect(out).toContain("<redacted:cookie>");
    expect(out).toContain("<redacted:private-key>");
    expect(out).toContain("<redacted:auth-header>");
    expect(out).toContain("<redacted:payment-card>");
    expect(out).toContain("<redacted:email>");
    expect(out).toContain("<redacted:customer-id>");
    expect(out).toContain("<redacted:configured-secret>");
    expect(out).toContain("<redacted:private-path>");
    expect(out).toContain("<redacted:AWS access key>");
    expect(out).toContain("<redacted:GCP API key>");
    expect(out).toContain("<redacted:token>");
  });

  it("exports a replayable sanitized run while preserving JSON/JSONL structure", () => {
    const runDir = run();
    const exp = exportSanitizedRun(runDir, {
      configuredSecrets: ["INTERNAL-CODE-RED"],
      privatePathPrefixes: ["/Users/alice/private"],
    });
    expect(exp.schema_version).toBe("guild.sanitized_run_export.v1");
    expect(exp.scrubber.version).toBe(RUN_EXPORT_SCRUBBER_VERSION);
    expect(exp.replay_manifest.complete).toBe(true);
    const events = exp.files.find((f) => f.path === "logs/v1.4-events.jsonl");
    expect(events?.format).toBe("jsonl");
    expect(Array.isArray(events?.content)).toBe(true);
    const provenance = exp.files.find((f) => f.path === "provenance.json");
    expect(provenance?.format).toBe("json");
    expect(JSON.stringify(exp)).toContain("operator_steering");
    expect(JSON.stringify(exp)).toContain("dispatch_order");
    expect(JSON.stringify(exp)).toContain("tool_call");
  });

  it("contains no raw secrets or PII in the serialized export", () => {
    const runDir = run();
    const exp = exportSanitizedRun(runDir, {
      configuredSecrets: ["INTERNAL-CODE-RED"],
      privatePathPrefixes: ["/Users/alice/private"],
    });
    const serialized = JSON.stringify(exp);
    for (const secret of [
      "sk-proj-abcdefghijklmnopqrstuvwx",
      "sk-abcdefghijklmnop",
      "hunter2",
      "structured-hunter2",
      "raw-opaque-token-value-xyz",
      "rt_rawsecretvalue",
      "letmein",
      "xoxb-abcdefghijklmnop",
      "jane.customer@example.com",
      "customer@example.com",
      "4111 1111 1111 1111",
      "cus_ABCDEF123456",
      "INTERNAL-CODE-RED",
      "/Users/alice/private",
      "BEGIN PRIVATE KEY",
      "ya29.A0AfH6SMSECRET",
      "AKIAABCDEFGHIJKLMNOP",
      "AIzaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "github_pat_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_123456",
      "sk_live_abcdefghijklmnop",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    const allRedactions = exp.files.flatMap((f) => f.redactions.map((r) => r.kind));
    expect(allRedactions).toEqual(expect.arrayContaining([
      "api-key",
      "auth-header",
      "configured-secret",
      "cookie",
      "customer-id",
      "email",
      "password",
      "payment-card",
      "private-key",
      "private-path",
      "token",
    ]));
  });

  it("redacts structured sensitive JSON values by key name", () => {
    const runDir = run();
    const serialized = JSON.stringify(exportSanitizedRun(runDir));
    expect(serialized).not.toContain("structured-hunter2");
    expect(serialized).not.toContain("raw-opaque-token-value-xyz");
    expect(serialized).not.toContain("rt_rawsecretvalue");
    expect(serialized).toContain("<redacted:password>");
    expect(serialized).toContain("<redacted:auth-header>");
    expect(serialized).toContain("<redacted:token>");
    expect(serialized).toContain("<redacted:api-key>");
  });

  it("redacts source run paths and replay manifest runDir", () => {
    const runDir = run();
    const exp = exportSanitizedRun(runDir);
    expect(exp.source.run_dir).toBe("<redacted:private-path>");
    expect(exp.replay_manifest.runDir).toBe("<redacted:private-path>");
    expect(JSON.stringify(exp)).not.toContain(runDir);
  });

  it("can be parsed by benchmark/replay consumers as a stable JSON artifact", () => {
    const runDir = run();
    const serialized = JSON.stringify(exportSanitizedRun(runDir), null, 2);
    const parsed = JSON.parse(serialized);
    expect(parsed.schema_version).toBe("guild.sanitized_run_export.v1");
    expect(parsed.replay_manifest.schema_version).toBe("guild.replay_manifest.v1");
    expect(parsed.files.some((f: { path: string }) => f.path === "logs/payloads/evt-1.json")).toBe(true);
    expect(parsed.files.every((f: { sha256_sanitized: string }) => /^[a-f0-9]{64}$/.test(f.sha256_sanitized))).toBe(true);
  });
});
