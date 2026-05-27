/**
 * scripts/__tests__/reaping.test.ts
 *
 * P1-3 A2a + A2b — launcher reaping + auto-dismiss.
 *
 * Covers:
 *   checkReceipt —
 *     - missing file → exists:false, errors populated
 *     - file with all §8.2 fields, no envelope → INVALID (strict v2 requires fenced block)
 *     - file missing one §8.2 field → hasRequiredFields:false, errors list missing
 *     - file with valid guild.handoff.v2 envelope → envelopeValid:true
 *     - file with malformed envelope (wrong schema_version) → envelopeValid:false, error listed
 *     - file with envelope that can't be parsed as JSON → envelope ignored (null)
 *
 *   detectDismissible —
 *     - no handoffs dir → all dismissible:false
 *     - one specialist with valid receipt → dismissible:true, receiptPath + taskId populated
 *     - one specialist with no receipt → dismissible:false
 *     - specialist with invalid receipt → dismissible:false, errors populated
 *     - specialist with multiple receipts, first invalid + second valid → dismissible:true
 *     - multiple teammates, mixed results
 *
 *   reapDeadMembers —
 *     - session.json missing → empty result, updated:false
 *     - all panes live → live list populated, reaped empty, updated:false
 *     - one pane dead → reaped populated, session.json rewritten without dead entry
 *     - all panes dead → all reaped, updated:true, session.json has empty teammate_panes
 *     - dry-run placeholder pane_id (starts with "(") → skipped, never reaped
 *     - tmux unavailable (run returns status=1) → all skipped, updated:false (fail-safe)
 *     - renameSync throws → updated:false (write-fail path)
 *
 * All tests use injected fs stubs and injected RunFn — no real filesystem or
 * tmux required.
 */

import * as path from "path";
import {
  checkReceipt,
  detectDismissible,
  reapDeadMembers,
  sessionJsonPath,
  listRunnableRunIds,
  type FsLike,
  type ReceiptCheckResult,
  type DismissibleEntry,
  type ReapResult,
  type SessionManifest,
} from "../lib/reaping";
import type { RunFn, RunResult } from "../lib/team-backend";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Build a minimal valid §8.2 receipt markdown. */
function validReceiptMd(extra = ""): string {
  return [
    "# Backend handoff",
    "",
    "## changed_files",
    "- src/api.ts",
    "",
    "## opens_for",
    "- qa",
    "",
    "## assumptions",
    "- Postgres is available",
    "",
    "## evidence",
    "- tests passing",
    "",
    "## followups",
    "- add index",
    extra,
  ].join("\n");
}

/** Inline a guild.handoff.v2 fence block into receipt markdown. */
function withEnvelope(md: string, envelope: Record<string, unknown>): string {
  return (
    md +
    "\n\n```guild.handoff.v2\n" +
    JSON.stringify(envelope, null, 2) +
    "\n```\n"
  );
}

/** Build a minimal valid handoff.v2 envelope object. */
function validEnvelope(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    schema_version: "guild.handoff.v2",
    task_id: "task-001",
    tier: "mid",
    status: "done",
    summary: "All done.",
    artifacts: [],
    issues: [],
    ...overrides,
  };
}

// ── In-memory fs stub ─────────────────────────────────────────────────────────

type FsStore = Map<string, string | "DIR">;

function makeFs(entries: Record<string, string | "DIR"> = {}): FsLike & {
  store: FsStore;
  writes: Array<{ path: string; content: string }>;
  renames: Array<{ old: string; new: string }>;
  failWrite: boolean;
} {
  const store: FsStore = new Map(Object.entries(entries));
  const writes: Array<{ path: string; content: string }> = [];
  const renames: Array<{ old: string; new: string }> = [];
  let failWrite = false;

  /** True when `p` is an explicit file key OR an implicit directory (has children). */
  function implicitExists(p: string): boolean {
    if (store.has(p)) return true;
    const prefix = p + "/";
    return [...store.keys()].some((k) => k.startsWith(prefix));
  }

  /** Direct children of `dir` (one level deep). */
  function directChildren(dir: string): string[] {
    const prefix = dir + "/";
    const children = new Set<string>();
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) {
        const rest = k.slice(prefix.length);
        // Only the first path segment — this is the direct child
        const child = rest.split("/")[0];
        if (child) children.add(child);
      }
    }
    return Array.from(children).sort();
  }

  const fsMod = {
    store,
    writes,
    renames,
    get failWrite() {
      return failWrite;
    },
    set failWrite(v: boolean) {
      failWrite = v;
    },
    existsSync(p: string): boolean {
      return implicitExists(p);
    },
    readdirSync(dir: string): string[] {
      if (!implicitExists(dir)) throw new Error(`ENOENT: ${dir}`);
      return directChildren(dir);
    },
    readFileSync(p: string, _enc: "utf8"): string {
      const v = store.get(p);
      if (v === undefined || v === "DIR") throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFileSync(p: string, content: string, _enc: "utf8"): void {
      if (failWrite) throw new Error("ENOSPC: simulated write failure");
      writes.push({ path: p, content });
      store.set(p, content);
    },
    renameSync(o: string, n: string): void {
      if (failWrite) throw new Error("ENOSPC: simulated rename failure");
      renames.push({ old: o, new: n });
      const v = store.get(o);
      if (v !== undefined) {
        store.delete(o);
        store.set(n, v);
      }
    },
  };
  return fsMod;
}

// ── RunFn stub for tmux ───────────────────────────────────────────────────────

function makeTmuxRun(opts: {
  livePaneIds?: string[];
  unavailable?: boolean;
} = {}): { run: RunFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: RunFn = (cmd, args) => {
    calls.push({ cmd, args });
    if (opts.unavailable) {
      return { status: 1, stdout: "", stderr: "tmux: not found" };
    }
    // list-panes -a -F "#{pane_id}"
    if (args[0] === "list-panes") {
      const ids = opts.livePaneIds ?? [];
      return { status: 0, stdout: ids.join("\n") + "\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  return { run, calls };
}

/** Build a minimal SessionManifest JSON string. */
function sessionJson(panes: Array<{ specialist: string; pane_id: string }>): string {
  const manifest: SessionManifest = {
    run_id: "run-test-001",
    teammate_panes: panes.map((p) => ({
      specialist: p.specialist,
      pane_id: p.pane_id,
      host_kind: "claude",
      adapter_version: "1",
    })),
  };
  return JSON.stringify(manifest, null, 2) + "\n";
}

// ── checkReceipt ──────────────────────────────────────────────────────────────

describe("checkReceipt — receipt validation", () => {
  const P = "/run/handoffs/backend-task-001.md";

  it("returns exists:false + error when file is missing", () => {
    const fs = makeFs();
    const r = checkReceipt(P, fs);
    expect(r.exists).toBe(false);
    expect(r.hasRequiredFields).toBe(false);
    expect(r.envelopeValid).toBeNull();
    expect(r.errors).toContain("receipt file not found");
  });

  it("returns invalid when fenced block absent (spec §2 condition 3 — strict v2 requires it)", () => {
    const fs = makeFs({ [P]: validReceiptMd() });
    const r = checkReceipt(P, fs);
    expect(r.exists).toBe(true);
    expect(r.hasRequiredFields).toBe(true);
    expect(r.envelopeValid).toBeNull(); // no block found → null
    expect(r.errors.some((e) => e.includes("no guild.handoff.v2 fenced block"))).toBe(true);
  });

  it("lists missing §8.2 fields in errors", () => {
    // Drop the 'evidence' section
    const content = validReceiptMd().replace(/## evidence[\s\S]*?(?=## |\Z)/m, "");
    const fs = makeFs({ [P]: content });
    const r = checkReceipt(P, fs);
    expect(r.hasRequiredFields).toBe(false);
    expect(r.errors.some((e) => e.includes("evidence"))).toBe(true);
  });

  it("accepts ## heading form (case-insensitive match) for §8.2 fields", () => {
    const content = [
      "## changed_files",
      "- foo",
      "## opens_for",
      "- bar",
      "## assumptions",
      "- baz",
      "## evidence",
      "- qux",
      "## followups",
      "- done",
    ].join("\n");
    const fs = makeFs({ [P]: content });
    const r = checkReceipt(P, fs);
    // §8.2 fields correctly detected (envelope-absent error is separate)
    expect(r.hasRequiredFields).toBe(true);
    expect(r.errors.some((e) => e.includes("fenced block"))).toBe(true);
  });

  it("accepts label: form for §8.2 fields", () => {
    const content = [
      "changed_files: src/api.ts",
      "opens_for: qa",
      "assumptions: none",
      "evidence: tests pass",
      "followups: none",
    ].join("\n");
    const fs = makeFs({ [P]: content });
    const r = checkReceipt(P, fs);
    expect(r.hasRequiredFields).toBe(true);
  });

  it("envelopeValid:true when valid guild.handoff.v2 block present", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope());
    const fs = makeFs({ [P]: md });
    const r = checkReceipt(P, fs);
    expect(r.envelopeValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("envelopeValid:false + error when schema_version is wrong", () => {
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ schema_version: "guild.handoff.v1" })
    );
    const fs = makeFs({ [P]: md });
    const r = checkReceipt(P, fs);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("envelopeValid:null + error when block is not valid JSON (spec §2 condition 3)", () => {
    const md = validReceiptMd() + "\n```guild.handoff.v2\nnot valid json\n```\n";
    const fs = makeFs({ [P]: md });
    const r = checkReceipt(P, fs);
    // Block tag present but JSON.parse failed → null + specific error
    expect(r.envelopeValid).toBeNull();
    expect(r.hasRequiredFields).toBe(true);
    expect(r.errors.some((e) => e.includes("not valid JSON"))).toBe(true);
  });
});

// ── checkReceipt — strict v2 shape validation (spec §2 hardening) ────────────

describe("checkReceipt — strict v2 shape (unknown-key rejection)", () => {
  const P = "/run/handoffs/backend-task-001.md";

  it("accepts a full valid envelope with all allowed keys present", () => {
    const md = withEnvelope(validReceiptMd(), {
      schema_version: "guild.handoff.v2",
      task_id: "task-001",
      tier: "mid",
      status: "done",
      summary: "All done.",
      artifacts: ["src/api.ts:1-50"],
      issues: [],
      learnings: ["lesson learned"],
      notes: "optional note",
    });
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects p2-3 drift shape: JSON block with schema: key instead of schema_version:", () => {
    // The literal p2-3 drift used `schema:` — an unknown key.
    // Both reaping.ts and hooks/lib/handoff-v2.ts must reject this.
    const driftEnvelope = {
      schema: "guild.handoff.v2",
      task_id: "p2-3",
      tier: "mid",
      status: "done",
      summary: "Done.",
      artifacts: [],
      issues: [],
    };
    const md = withEnvelope(validReceiptMd(), driftEnvelope);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    // Rejected for unknown key "schema"
    expect(r.errors.some((e) => e.includes("unknown key"))).toBe(true);
    expect(r.errors.some((e) => e.includes('"schema"'))).toBe(true);
    // Also rejected for missing schema_version (undefined !== "guild.handoff.v2")
    expect(r.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("rejects envelope with an extra/misspelled key", () => {
    const md = withEnvelope(validReceiptMd(), {
      ...validEnvelope(),
      schema_versoin: "typo-misspelled-key",
    });
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("unknown key"))).toBe(true);
    expect(r.errors.some((e) => e.includes('"schema_versoin"'))).toBe(true);
  });

  it("rejects envelope with any non-allowed extra key alongside correct schema_version", () => {
    const md = withEnvelope(validReceiptMd(), {
      ...validEnvelope(),
      extra_field: "should not be here",
    });
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes('"extra_field"'))).toBe(true);
  });
});

// ── detectDismissible ─────────────────────────────────────────────────────────

describe("detectDismissible — A2a receipt-based dismissal signal", () => {
  const RUN_DIR = "/repo/.guild/runs/run-001";
  const HANDOFFS = `${RUN_DIR}/handoffs`;

  it("returns dismissible:false for all when handoffs dir absent", () => {
    const fs = makeFs(); // empty
    const results = detectDismissible(RUN_DIR, ["backend", "qa"], fs);
    expect(results).toHaveLength(2);
    expect(results.every((r) => !r.dismissible)).toBe(true);
    expect(results.every((r) => r.receiptPath === null)).toBe(true);
  });

  it("returns dismissible:false when specialist has no receipt file", () => {
    // handoffs dir exists but no file for 'backend'
    const validMd = withEnvelope(validReceiptMd(), validEnvelope());
    const fs = makeFs({ [`${HANDOFFS}/qa-task-001.md`]: validMd });
    const results = detectDismissible(RUN_DIR, ["backend"], fs);
    const [entry] = results;
    expect(entry.dismissible).toBe(false);
    expect(entry.receiptPath).toBeNull();
    expect(entry.errors.some((e) => e.includes("no receipt"))).toBe(true);
  });

  it("returns dismissible:true with path+taskId when valid receipt present", () => {
    const rPath = `${HANDOFFS}/backend-task-001.md`;
    const fs = makeFs({ [rPath]: withEnvelope(validReceiptMd(), validEnvelope()) });
    const results = detectDismissible(RUN_DIR, ["backend"], fs);
    const [entry] = results;
    expect(entry.dismissible).toBe(true);
    expect(entry.receiptPath).toBe(rPath);
    expect(entry.taskId).toBe("task-001");
    expect(entry.errors).toHaveLength(0);
  });

  it("returns dismissible:false when receipt exists but is invalid (missing fields)", () => {
    const rPath = `${HANDOFFS}/backend-task-001.md`;
    // Missing several §8.2 fields
    const fs = makeFs({ [rPath]: "# handoff\n## changed_files\n- foo\n" });
    const results = detectDismissible(RUN_DIR, ["backend"], fs);
    const [entry] = results;
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.length).toBeGreaterThan(0);
  });

  it("picks first valid receipt when multiple receipts exist for specialist", () => {
    const bad = `${HANDOFFS}/backend-task-001.md`;
    const good = `${HANDOFFS}/backend-task-002.md`;
    const fs = makeFs({
      [bad]: "# incomplete", // invalid
      [good]: withEnvelope(validReceiptMd(), validEnvelope()), // valid (has fenced block)
    });
    const results = detectDismissible(RUN_DIR, ["backend"], fs);
    const [entry] = results;
    expect(entry.dismissible).toBe(true);
    // picks the first valid one (task-001 is checked first — sorted)
    // task-001 is invalid, task-002 is valid → dismissible:true, taskId=task-002
    expect(entry.taskId).toBe("task-002");
  });

  it("handles mixed teammates: some dismissible, some not", () => {
    const fs = makeFs({
      [`${HANDOFFS}/backend-task-001.md`]: withEnvelope(validReceiptMd(), validEnvelope()),
      [`${HANDOFFS}/qa-task-001.md`]: "# incomplete",
    });
    const results = detectDismissible(RUN_DIR, ["backend", "qa", "architect"], fs);
    const byName = Object.fromEntries(results.map((r) => [r.specialist, r]));
    expect(byName["backend"].dismissible).toBe(true);
    expect(byName["qa"].dismissible).toBe(false);
    expect(byName["architect"].dismissible).toBe(false);
    expect(byName["architect"].receiptPath).toBeNull();
  });

  it("dismissible:true for receipt with valid envelope", () => {
    const rPath = `${HANDOFFS}/backend-task-001.md`;
    const md = withEnvelope(validReceiptMd(), validEnvelope());
    const fs = makeFs({ [rPath]: md });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(true);
  });

  it("dismissible:false when envelope present but schema_version wrong", () => {
    const rPath = `${HANDOFFS}/backend-task-001.md`;
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ schema_version: "guild.handoff.v0" })
    );
    const fs = makeFs({ [rPath]: md });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  it("handles an empty teammates list", () => {
    const fs = makeFs();
    const results = detectDismissible(RUN_DIR, [], fs);
    expect(results).toHaveLength(0);
  });

  it("dismissible:false for frontmatter-only receipt (§8.2 present, no fenced block) — matches hook reject verdict", () => {
    // This is the literal p2-3 scenario: §8.2 sections present but no fenced JSON block.
    // The hook validator rejects it (no fenced block); reaping must agree (fail-closed).
    const frontmatterOnly = [
      "---",
      "schema: guild.handoff.v2",
      "task_id: p2-3",
      "---",
      "",
      "## changed_files",
      "- src/api.ts",
      "",
      "## opens_for",
      "- qa",
      "",
      "## assumptions",
      "- none",
      "",
      "## evidence",
      "- tests pass",
      "",
      "## followups",
      "- none",
    ].join("\n");
    const rPath = `${HANDOFFS}/backend-p2-3.md`;
    const fsMod = makeFs({ [rPath]: frontmatterOnly });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fsMod);
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.some((e) => e.includes("fenced block"))).toBe(true);
  });

  it("dismissible:false when envelope uses p2-3 drift key schema: instead of schema_version:", () => {
    const rPath = `${HANDOFFS}/backend-p2-3.md`;
    const driftMd = withEnvelope(validReceiptMd(), {
      schema: "guild.handoff.v2",
      task_id: "p2-3",
      tier: "mid",
      status: "done",
      summary: "Done.",
      artifacts: [],
      issues: [],
    });
    const fsMod = makeFs({ [rPath]: driftMd });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fsMod);
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.some((e) => e.includes("unknown key"))).toBe(true);
    expect(entry.errors.some((e) => e.includes('"schema"'))).toBe(true);
  });
});

// ── reapDeadMembers ───────────────────────────────────────────────────────────

describe("reapDeadMembers — A2b force-reap dead tmux panes", () => {
  const SESSION_PATH = "/repo/.guild/runs/run-001/agent-team/session.json";

  it("returns empty result when session.json is missing", () => {
    const fs = makeFs();
    const { run } = makeTmuxRun();
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r).toEqual({ reaped: [], live: [], skipped: [], updated: false });
  });

  it("returns empty result when session.json is unparseable", () => {
    const fs = makeFs({ [SESSION_PATH]: "not json {{" });
    const { run } = makeTmuxRun();
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r).toEqual({ reaped: [], live: [], skipped: [], updated: false });
  });

  it("returns empty result when teammate_panes is empty", () => {
    const fs = makeFs({ [SESSION_PATH]: sessionJson([]) });
    const { run } = makeTmuxRun({ livePaneIds: [] });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r).toEqual({ reaped: [], live: [], skipped: [], updated: false });
  });

  it("marks all live panes as live, nothing reaped, updated:false", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "%1" },
        { specialist: "qa", pane_id: "%2" },
      ]),
    });
    const { run } = makeTmuxRun({ livePaneIds: ["%1", "%2"] });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.live.sort()).toEqual(["backend", "qa"]);
    expect(r.reaped).toHaveLength(0);
    expect(r.updated).toBe(false);
  });

  it("reaps the dead pane and updates session.json (one dead of two)", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "%1" },
        { specialist: "qa", pane_id: "%2" },
      ]),
    });
    // only %1 is live; %2 is dead
    const { run } = makeTmuxRun({ livePaneIds: ["%1"] });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.reaped).toEqual(["qa"]);
    expect(r.live).toEqual(["backend"]);
    expect(r.updated).toBe(true);
    // session.json must no longer contain qa
    const written = JSON.parse(fs.store.get(SESSION_PATH) as string) as SessionManifest;
    expect(written.teammate_panes.map((p) => p.specialist)).toEqual(["backend"]);
  });

  it("reaps all panes when all dead, session.json teammate_panes becomes []", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "%10" },
        { specialist: "qa", pane_id: "%20" },
      ]),
    });
    const { run } = makeTmuxRun({ livePaneIds: [] }); // all dead
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.reaped.sort()).toEqual(["backend", "qa"]);
    expect(r.live).toHaveLength(0);
    expect(r.updated).toBe(true);
    const written = JSON.parse(fs.store.get(SESSION_PATH) as string) as SessionManifest;
    expect(written.teammate_panes).toEqual([]);
  });

  it("skips dry-run placeholder pane_ids (start with '('), never reaps them", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "(dry-run: not spawned)" },
        { specialist: "qa", pane_id: "%2" },
      ]),
    });
    const { run } = makeTmuxRun({ livePaneIds: ["%2"] });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.skipped).toEqual(["backend"]);
    expect(r.live).toEqual(["qa"]);
    expect(r.reaped).toHaveLength(0);
    expect(r.updated).toBe(false);
  });

  it("skips panes with empty pane_id", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([{ specialist: "backend", pane_id: "" }]),
    });
    const { run } = makeTmuxRun({ livePaneIds: [] });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.skipped).toEqual(["backend"]);
    expect(r.reaped).toHaveLength(0);
    expect(r.updated).toBe(false);
  });

  it("skips ALL panes when tmux is unavailable (fail-safe: no data loss)", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "%1" },
        { specialist: "qa", pane_id: "%2" },
      ]),
    });
    const { run } = makeTmuxRun({ unavailable: true });
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(r.skipped.sort()).toEqual(["backend", "qa"]);
    expect(r.reaped).toHaveLength(0);
    expect(r.updated).toBe(false);
  });

  it("returns updated:false when write fails (conservative)", () => {
    const fs = makeFs({
      [SESSION_PATH]: sessionJson([
        { specialist: "backend", pane_id: "%1" },
      ]),
    });
    fs.failWrite = true;
    const { run } = makeTmuxRun({ livePaneIds: [] }); // pane is dead
    const r = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    // The pane was classified as dead but the write failed
    expect(r.reaped).toEqual(["backend"]);
    expect(r.updated).toBe(false);
  });

  it("invokes tmux list-panes -a with #{pane_id} format", () => {
    const fs = makeFs({ [SESSION_PATH]: sessionJson([{ specialist: "backend", pane_id: "%1" }]) });
    const { run, calls } = makeTmuxRun({ livePaneIds: ["%1"] });
    reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(calls.some((c) => c.args[0] === "list-panes" && c.args.includes("-a"))).toBe(true);
    expect(calls.some((c) => c.args.includes("#{pane_id}"))).toBe(true);
  });
});

// ── sessionJsonPath + listRunnableRunIds ──────────────────────────────────────

describe("sessionJsonPath + listRunnableRunIds helpers", () => {
  it("sessionJsonPath composes the correct absolute path", () => {
    expect(sessionJsonPath("/repo", "run-001")).toBe(
      "/repo/.guild/runs/run-001/agent-team/session.json"
    );
  });

  it("listRunnableRunIds returns [] when runs dir absent", () => {
    const fs = makeFs();
    expect(listRunnableRunIds("/repo", fs)).toEqual([]);
  });

  it("listRunnableRunIds returns only run ids with session.json", () => {
    const fs = makeFs({
      "/repo/.guild/runs/run-001/agent-team/session.json": "{}",
      "/repo/.guild/runs/run-002/agent-team/session.json": "{}",
      "/repo/.guild/runs/run-003/other-file.json": "{}", // no session.json
    });
    const ids = listRunnableRunIds("/repo", fs);
    expect(ids).toContain("run-001");
    expect(ids).toContain("run-002");
    expect(ids).not.toContain("run-003");
  });

  it("listRunnableRunIds sorts lexicographically", () => {
    const fs = makeFs({
      "/repo/.guild/runs/run-b/agent-team/session.json": "{}",
      "/repo/.guild/runs/run-a/agent-team/session.json": "{}",
    });
    const ids = listRunnableRunIds("/repo", fs);
    expect(ids).toEqual(["run-a", "run-b"]);
  });
});
