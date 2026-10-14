/**
 * scripts/check-handoff-receipts.test.ts — the review / verify-done receipt gate (#235).
 * A lane receipt that drifts from the guild.handoff.v2 contract (missing §8.2
 * sections, a plain ```json fence instead of the guild.handoff.v2 fence) is refused.
 */

import { describe, it, expect, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { checkHandoffReceipt, checkHandoffReceipts } from "./check-handoff-receipts";

const ENVELOPE = {
  schema_version: "guild.handoff.v2",
  task_id: "lane-a",
  tier: "mid",
  status: "done",
  summary: "added src/version.js",
  artifacts: ["src/version.js:1-5"],
  issues: [],
};

const VALID = [
  "---",
  "schema_version: guild.handoff_receipt.v1",
  "task_id: lane-a",
  "---",
  "",
  "## changed_files",
  "- src/version.js",
  "## opens_for",
  "- lane-b",
  "## assumptions",
  "- none",
  "## evidence",
  "- npm test: 2 pass",
  "## followups",
  "- none",
  "",
  "```guild.handoff.v2",
  JSON.stringify(ENVELOPE, null, 2),
  "```",
  "",
].join("\n");

// The drifted shape observed in team-two-lane-lifecycle on 3.1.0-beta.1.
const DRIFTED = [
  "# Lane A receipt",
  "",
  "## files changed",
  "- src/version.js",
  "## evidence",
  "- npm test: 2 pass",
  "",
  "```json",
  JSON.stringify({ task_id: "lane-a", status: "done", files_changed: ["src/version.js"] }, null, 2),
  "```",
  "",
].join("\n");

const roots: string[] = [];
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
function handoffs(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-receipts-"));
  roots.push(root);
  const dir = path.join(root, "handoffs");
  fs.mkdirSync(dir);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe("checkHandoffReceipts — refuse receipts that miss the contract", () => {
  it("accepts a receipt with the five sections and one valid guild.handoff.v2 fence", () => {
    const r = checkHandoffReceipts(handoffs({ "developer-lane-a.md": VALID }));
    expect(r.ok).toBe(true);
    expect(r.receipts).toEqual([{ file: "developer-lane-a.md", ok: true, defects: [] }]);
  });

  it("refuses the drifted '## files changed' + ```json receipt", () => {
    const r = checkHandoffReceipts(handoffs({ "developer-lane-a.md": VALID, "developer-lane-b.md": DRIFTED }));
    expect(r.ok).toBe(false);
    const bad = r.receipts.find((x) => x.file === "developer-lane-b.md")!;
    expect(bad.ok).toBe(false);
    expect(bad.defects).toContain("missing_section:changed_files");
    expect(bad.defects).toContain("missing_section:followups");
    expect(bad.defects).toContain("v2_block_count:0");
  });

  it("refuses two guild.handoff.v2 fences and an envelope that fails the strict validator", () => {
    const dup = VALID + "\n```guild.handoff.v2\n" + JSON.stringify(ENVELOPE) + "\n```\n";
    const badEnv = VALID.replace('"tier": "mid"', '"tier": "cheap|mid|powerful"');
    const r = checkHandoffReceipts(handoffs({ "developer-a.md": dup, "developer-b.md": badEnv }));
    expect(r.ok).toBe(false);
    expect(r.receipts.find((x) => x.file === "developer-a.md")!.defects).toContain("v2_block_count:2");
    expect(r.receipts.find((x) => x.file === "developer-b.md")!.defects.some((d) => d.startsWith("v2_envelope_invalid:"))).toBe(true);
  });

  it("a heading inside a fence does not count as a section", () => {
    const spoof = DRIFTED + "\n```\n## changed_files\n## opens_for\n## assumptions\n## followups\n```\n";
    const r = checkHandoffReceipts(handoffs({ "developer-lane-b.md": spoof }));
    expect(r.receipts[0].defects).toContain("missing_section:changed_files");
  });

  it("a guild.handoff.v2 fence nested inside another fence is not a block", () => {
    const nested = VALID.replace("```guild.handoff.v2", "~~~~text\n```guild.handoff.v2") + "~~~~\n";
    const r = checkHandoffReceipts(handoffs({ "developer-lane-a.md": nested }));
    expect(r.receipts[0].defects).toContain("v2_block_count:0");
  });

  it("only the canonical unindented ``` fence counts; tilde, long, or indented guild.handoff.v2 fences are refused", () => {
    const tilde = VALID.replace("```guild.handoff.v2", "~~~~guild.handoff.v2").replace(/```\n$/, "~~~~\n");
    const long = VALID.replace("```guild.handoff.v2", "````guild.handoff.v2").replace(/```\n$/, "````\n");
    const indented = VALID.replace("```guild.handoff.v2", "  ```guild.handoff.v2");
    const r = checkHandoffReceipts(handoffs({ "d-t.md": tilde, "d-l.md": long, "d-i.md": indented }));
    for (const x of r.receipts) {
      expect(x.ok).toBe(false);
      expect(x.defects).toContain("v2_block_noncanonical_fence");
    }
  });

  it("a second envelope in a ```json fence is refused (the consumer would reject it)", () => {
    const dupJson = VALID + "\n```json\n" + JSON.stringify(ENVELOPE) + "\n```\n";
    const r = checkHandoffReceipts(handoffs({ "developer-a.md": dupJson }));
    expect(r.ok).toBe(false);
    expect(r.receipts[0].defects.some((d) => d.startsWith("machine_block_unreadable:"))).toBe(true);
  });

  it("refuses a receipt whose consumer-read envelope differs from the validated fence", () => {
    // An unclosed ```text inside a tilde fence desyncs the consumer's scan so it
    // skips the canonical block and reads the later ```json envelope instead.
    const wrong = { ...ENVELOPE, task_id: "wrong-lane", tier: "invalid" };
    const body = VALID.replace("```guild.handoff.v2", "~~~~\n```text\n~~~~\n```guild.handoff.v2")
      + "\n```json\n" + JSON.stringify(wrong) + "\n```\n";
    const r = checkHandoffReceipts(handoffs({ "developer-a.md": body }));
    expect(r.ok).toBe(false);
  });

  it("--receipt mode judges one lane, not its siblings", () => {
    const dir = handoffs({ "developer-lane-a.md": VALID, "developer-lane-b.md": DRIFTED });
    expect(checkHandoffReceipt(path.join(dir, "developer-lane-a.md")).ok).toBe(true);
    expect(checkHandoffReceipt(path.join(dir, "developer-lane-b.md")).ok).toBe(false);
    expect(checkHandoffReceipt(path.join(dir, "missing.md")).ok).toBe(false);
  });

  it("an empty or missing handoffs dir is refused, never a vacuous pass", () => {
    expect(checkHandoffReceipts(handoffs({})).ok).toBe(false);
    expect(checkHandoffReceipts(path.join(os.tmpdir(), "guild-no-such-handoffs-dir")).ok).toBe(false);
  });
});

describe("review / verify-done / execute-plan gate on the receipt CLI (#235)", () => {
  const root = path.resolve(__dirname, "..");
  const GATE = "runtime/scripts/check-handoff-receipts.js";
  for (const rel of [
    "skills/meta/review/SKILL.md",
    "skills/quality/references/verify-done.md",
    "skills/meta/execute-plan/SKILL.md",
  ]) {
    it(`${rel} runs the receipt gate and fails on a non-zero exit`, () => {
      const body = fs.readFileSync(path.join(root, rel), "utf8");
      expect(body).toContain(GATE);
      expect(body).toMatch(/non-zero exit/i);
      expect(body).not.toMatch(/no `files changed`/);
    });
  }
  it("review hands off by loading the verify-done chapter and names verify.md", () => {
    const body = fs.readFileSync(path.join(root, "skills/meta/review/SKILL.md"), "utf8");
    expect(body).toContain("Read `../../quality/references/verify-done.md` and run it in place");
    expect(body).toContain("`.guild/runs/<run-id>/verify.md` (never another file name)");
  });
  it("verify-done pins the literal Overall status line", () => {
    expect(fs.readFileSync(path.join(root, "skills/quality/references/verify-done.md"), "utf8"))
      .toContain("exactly `Overall status: pass` or `Overall status: fail`");
  });
  it("the gate ships as a compiled runtime script", () => {
    expect(fs.readFileSync(path.join(root, "scripts/compile.ts"), "utf8"))
      .toContain('{ id: "check-handoff-receipts", entry: "scripts/check-handoff-receipts.ts" }');
  });
});
