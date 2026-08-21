import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { validateRunRecordDir } from "../../src/modules/lifecycle/workflows/run-record-validate";
import { validateText } from "../../scripts/v1.4-log-validator";
import { runTsCli } from "./ts-runtime-helper";

const SCRUB = path.resolve(__dirname, "../../scripts/dot-guild/scrub.ts");
const AUDIT = path.resolve(__dirname, "../../scripts/dot-guild/audit.ts");
const RUN_ID = "run-20260821-120000-shareable-evidence";
const SHA = "0123456789abcdef".repeat(4);
const PRIVATE_PATH = "/Users/operator/Projects/private-workspace/socket.sock";
const PROVIDER_KEY = "sk-abcdefghijklmnop";

function handoff(): string {
  return [
    "---",
    "schema_version: guild.handoff_receipt.v1",
    "task_id: FU11",
    "specialist: tooling-engineer",
    "model_family: codex",
    "host: codex-cli",
    "generated_at: 2026-08-21T12:00:00.000Z",
    "---",
    "",
    "## changed_files", `- ${PRIVATE_PATH}`,
    "", "## opens_for", "- lead",
    "", "## assumptions", "- none",
    "", "## evidence", `- token ${PROVIDER_KEY}`,
    "", "## followups", "- none",
    "",
    "```guild.handoff.v2",
    JSON.stringify({
      schema_version: "guild.handoff.v2",
      task_id: "FU11",
      tier: "powerful",
      status: "done",
      summary: "defensive shareable-run fixture",
      artifacts: ["logs/v1.4-events.jsonl:1"],
      issues: [],
    }, null, 2),
    "```",
    "",
  ].join("\n");
}

function write(root: string, rel: string, body: string): void {
  const target = path.join(root, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body);
}

function fixture(): { root: string; run: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-shareable-minimum-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, ".gitignore"), [
    ".guild", "!.guild/", "!.guild/runs/", "!.guild/runs/*/", ".guild/runs/*/**",
    "!.guild/runs/*/run.yaml", "!.guild/runs/*/provenance.json",
    "!.guild/runs/*/logs/", "!.guild/runs/*/logs/v1.4-events.jsonl",
    "!.guild/runs/*/handoffs/", "!.guild/runs/*/handoffs/**", "",
  ].join("\n"));
  const run = path.join(root, ".guild", "runs", RUN_ID);
  write(root, `.guild/runs/${RUN_ID}/run.yaml`, `schema_version: guild.run.v1\nrun_id: ${RUN_ID}\nstatus: closed\n`);
  write(root, `.guild/runs/${RUN_ID}/provenance.json`, `${JSON.stringify({
    schema_version: "guild.provenance.v1",
    run_id: RUN_ID,
    artifacts: { tree_sha256: SHA },
  }, null, 2)}\n`);
  const log = [
    {
      schema_version: "guild.trace_event.v1",
      event_id: "evt-123e4567-e89b-12d3-a456-426614174000",
      event_name: "run_started",
      run_id: RUN_ID,
      at: "2026-08-21T12:00:00.000Z",
    },
    {
      ts: "2026-08-21T12:00:01.000Z",
      event: "tool_call",
      run_id: RUN_ID,
      tool: "Bash",
      command_redacted: `connect ${PRIVATE_PATH}`,
      status: "ok",
      latency_ms: 1,
      result_excerpt_redacted: `credential ${PROVIDER_KEY}`,
      span_id: "0123456789abcdef",
    },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  write(root, `.guild/runs/${RUN_ID}/logs/v1.4-events.jsonl`, log);
  write(root, `.guild/runs/${RUN_ID}/handoffs/tooling-engineer-FU11.md`, handoff());
  return { root, run, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe("FU11 shareable-run minimum-set defensive path", () => {
  it("validates all four artifact classes, catches planted leaks, scrubs without breaking schemas, then audits clean", () => {
    const f = fixture();
    try {
      expect(validateRunRecordDir(f.run).ok).toBe(true);
      expect(validateText(fs.readFileSync(path.join(f.run, "logs/v1.4-events.jsonl"), "utf8")).invalid).toBe(0);
      expect(spawnSync("git", ["-C", f.root, "check-ignore", "-q", `.guild/runs/${RUN_ID}/logs/v1.4-events.jsonl`]).status).toBe(1);

      const before = runTsCli(AUDIT, [`--workspace=${f.root}`], { cwd: f.root });
      expect(before.status).toBe(1);
      expect(before.out).toContain("logs/v1.4-events.jsonl");
      expect(before.out).toMatch(/operator-path/);
      expect(before.out).toMatch(/secret/);

      const scrub = runTsCli(SCRUB, [`--workspace=${f.root}`], { cwd: f.root });
      expect(scrub.status).toBe(0);
      const sharedBytes = [
        "run.yaml", "provenance.json", "logs/v1.4-events.jsonl", "handoffs/tooling-engineer-FU11.md",
      ].map((rel) => fs.readFileSync(path.join(f.run, rel), "utf8")).join("\n");
      expect(sharedBytes).not.toContain(PRIVATE_PATH);
      expect(sharedBytes).not.toContain(PROVIDER_KEY);
      expect(sharedBytes).toContain(SHA);
      expect(validateRunRecordDir(f.run).ok).toBe(true);
      expect(validateText(fs.readFileSync(path.join(f.run, "logs/v1.4-events.jsonl"), "utf8")).invalid).toBe(0);

      const after = runTsCli(AUDIT, [`--workspace=${f.root}`], { cwd: f.root });
      expect(after.status).toBe(0);
      expect(after.out).toContain("No actionable flags");
    } finally { f.cleanup(); }
  });

  it("fails closed on a newly trackable lifecycle log outside the scanned contract", () => {
    const f = fixture();
    try {
      fs.appendFileSync(path.join(f.root, ".gitignore"), `!.guild/runs/*/logs/unscanned.jsonl\n`);
      write(f.root, `.guild/runs/${RUN_ID}/logs/unscanned.jsonl`, `${JSON.stringify({ path: PRIVATE_PATH })}\n`);
      const audit = runTsCli(AUDIT, [`--workspace=${f.root}`], { cwd: f.root });
      expect(audit.status).toBe(1);
      expect(audit.out).toMatch(/scrub-uncovered/);
      expect(audit.out).toContain("logs/unscanned.jsonl");
    } finally { f.cleanup(); }
  });
});
