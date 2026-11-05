/**
 * CD4 unbound E00 notice helpers: read-only layout classification, the in-memory
 * secret check, and exclusive / idempotent notice creation. The real-hook path is
 * covered by tests/e00 (frozen CD4 + H1 reds); these pin the helper rules directly.
 */
import { describe, it, expect, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildTaskCell, writeTaskCell } from "../../src/domains/dispatch";
import { mintRunBinding } from "../../src/domains/lifecycle";
import { CURRENT_LAYOUT_VERSION } from "../lib/ensure-layout";
import {
  TASK_COMPLETED_NOTICE_SCHEMA,
  checkUnboundLayout,
  receiptIsSecretClean,
  writeExclusiveNotice,
} from "../lib/task-completed-notice";

const RUN_ID = "run-tcn";
const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-tcn-")));
  roots.push(root);
  const bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  const c = buildTaskCell({
    runId: RUN_ID, logicalTaskId: "task-001", taskRunId: "task-001.tr1", attempt: 1, attemptId: "task-001.att1",
    instanceId: "task-001.a1.i1", cellId: "cell-task-001", goalId: "goal", phaseId: "build", stepId: "task-001",
    teamId: "guild-team", workerRole: "backend", specialistTypeId: "backend", specialistTypeVersion: "1",
    specialistTypeHash: "sha256:type", specialistProfileId: "backend", specialistProfileHash: "sha256:profile",
    contextBundleId: `.guild/context/${RUN_ID}/backend-task-001.md`, contextBundleHash: "sha256:ctx",
    hostId: "claude-code-cli", adapterId: "claude-code-cli@1", hostCapabilitiesHash: "sha256:caps",
    substrate: "tmux", modelTier: "mid", objective: "notice", scopePaths: ["hooks"],
    outputSchema: "guild.handoff_receipt.v1", acceptanceTests: ["bun test"],
    projection: { tools: ["read"], permissions: [], recorded_losses: [] }, autonomyPolicy: "supervised",
    budgets: { tokens: null, wall_clock_ms: null, cost_usd: null }, leadBindingId: "lead",
    now: () => "2026-10-26T13:00:00.000Z",
  });
  writeTaskCell(root, c, { binding_ref: bindingRef });
  const a = c.assignment;
  const outbox = path.join(root, ".guild", "runs", RUN_ID, "outbox", a.instance_id);
  return { root, a, outbox, notice: path.join(outbox, "task-completed-notice.json"), marker: path.join(root, ".guild", "storage-layout.json") };
}
const setMarker = (m: string, body: string) => fs.writeFileSync(m, body);

describe("checkUnboundLayout", () => {
  it("absent marker + canonical current assignment proceeds", () => {
    const f = fixture();
    expect(checkUnboundLayout(f.root, f.a)).toEqual({ ok: true, realRoot: f.root });
  });

  it("current marker proceeds; stale, future, malformed and unsafe markers refuse", () => {
    const f = fixture();
    setMarker(f.marker, JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION }));
    expect(checkUnboundLayout(f.root, f.a).ok).toBe(true);
    const cases: Array<[string, () => void]> = [
      ["layout_stale", () => setMarker(f.marker, JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION - 1 }))],
      ["layout_future", () => setMarker(f.marker, JSON.stringify({ storage_layout_version: CURRENT_LAYOUT_VERSION + 1 }))],
      ["layout_marker_malformed", () => setMarker(f.marker, "{ nope")],
      ["layout_marker_malformed", () => setMarker(f.marker, JSON.stringify({ storage_layout_version: "2" }))],
      ["layout_marker_unsafe", () => { fs.rmSync(f.marker); fs.mkdirSync(f.marker); }],
      ["layout_marker_unsafe", () => { fs.rmSync(f.marker, { recursive: true }); const t = path.join(f.root, "m.json"); fs.writeFileSync(t, "{}"); fs.symlinkSync(t, f.marker); }],
    ];
    for (const [reason, arrange] of cases) {
      arrange();
      expect(checkUnboundLayout(f.root, f.a)).toEqual({ ok: false, reason });
    }
  });

  it("an assignment whose recorded path is not its canonical path is unproven", () => {
    const f = fixture();
    expect(checkUnboundLayout(f.root, { ...f.a, assignment_path: `${f.a.assignment_path}.x` }).ok).toBe(false);
    expect(checkUnboundLayout(f.root, { ...f.a, instance_id: "../escape" })).toEqual({ ok: false, reason: "assignment_shape_unproven" });
  });

  it("never writes", () => {
    const f = fixture();
    const before = fs.readdirSync(f.root, { recursive: true }).sort();
    checkUnboundLayout(f.root, f.a);
    expect(fs.readdirSync(f.root, { recursive: true }).sort()).toEqual(before);
  });
});

describe("receiptIsSecretClean", () => {
  it("is true only when the policy leaves the bytes unchanged", () => {
    const f = fixture();
    expect(receiptIsSecretClean(f.root, "## evidence\nplain text\n")).toBe(true);
    expect(receiptIsSecretClean(f.root, "## evidence\nkey AKIAABCDEFGHIJKLMNOP\n")).toBe(false);
  });
});

describe("writeExclusiveNotice", () => {
  const pkg = { id: "rel-1", sha256: "c".repeat(64) };

  it("creates the notice 0600 with the stable key and a canonical timestamp", () => {
    const f = fixture();
    const r = writeExclusiveNotice(f.root, f.a, pkg);
    expect(r).toEqual({ ok: true, created: true, path: f.notice });
    const n = JSON.parse(fs.readFileSync(f.notice, "utf8"));
    expect(n).toMatchObject({ schema_version: TASK_COMPLETED_NOTICE_SCHEMA, run_id: RUN_ID, instance_id: f.a.instance_id, package_identity: pkg });
    expect(new Date(Date.parse(n.noticed_at)).toISOString()).toBe(n.noticed_at);
    expect(fs.statSync(f.notice).mode & 0o777).toBe(0o600);
  });

  it("an identical repeat succeeds without rewriting; a different package identity is a conflict", () => {
    const f = fixture();
    writeExclusiveNotice(f.root, f.a, pkg);
    const bytes = fs.readFileSync(f.notice);
    expect(writeExclusiveNotice(f.root, f.a, pkg)).toEqual({ ok: true, created: false, path: f.notice });
    expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "notice_conflict" });
    expect(writeExclusiveNotice(f.root, f.a, { ...pkg, sha256: "d".repeat(64) })).toEqual({ ok: false, reason: "notice_conflict" });
    expect(fs.readFileSync(f.notice).equals(bytes)).toBe(true);
  });

  it("refuses an existing notice with a non-canonical timestamp or extra keys, keeping its bytes", () => {
    const f = fixture();
    writeExclusiveNotice(f.root, f.a, null);
    const n = JSON.parse(fs.readFileSync(f.notice, "utf8"));
    for (const bad of [{ ...n, noticed_at: "2026-10-26T13:00:00Z" }, { ...n, noticed_at: 1 }, { ...n, extra: true }]) {
      const body = JSON.stringify(bad);
      fs.rmSync(f.notice);
      fs.writeFileSync(f.notice, body);
      expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "notice_conflict" });
      expect(fs.readFileSync(f.notice, "utf8")).toBe(body);
    }
  });

  it("refuses a hard-linked or oversized existing notice without reading it", () => {
    const f = fixture();
    writeExclusiveNotice(f.root, f.a, null);
    const link = path.join(f.root, "hard");
    fs.linkSync(f.notice, link);
    expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "notice_unsafe" });
    fs.rmSync(link);
    fs.rmSync(f.notice);
    fs.writeFileSync(f.notice, "x".repeat(64 * 1024 + 1));
    expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "notice_unsafe" });
  });

  it("refuses a symlinked or non-directory outbox level and creates nothing through it", () => {
    const f = fixture();
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-tcn-out-")));
    roots.push(outside);
    fs.mkdirSync(path.dirname(f.outbox), { recursive: true });
    fs.symlinkSync(outside, f.outbox);
    expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "outbox_unsafe" });
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(f.outbox);
    fs.writeFileSync(f.outbox, "file");
    expect(writeExclusiveNotice(f.root, f.a, null)).toEqual({ ok: false, reason: "outbox_unsafe" });
  });

  it("creates missing outbox levels non-recursively with mode 0700", () => {
    const f = fixture();
    writeExclusiveNotice(f.root, f.a, null);
    expect(fs.statSync(f.outbox).mode & 0o777).toBe(0o700);
  });
});
