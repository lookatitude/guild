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
  isRunInScope,
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

// ── checkReceipt — full required-field parity with validateHandoffV2 (BLOCKER fix) ─
//
// These tests verify that reaping's envelope validator matches the FULL semantics
// of validateHandoffV2 in hooks/lib/handoff-v2.ts — not just unknown-key and
// schema_version checks.  A receipt that would be REJECTED by task-completed must
// also be REJECTED by detectDismissible (AC-3 full consumer agreement).
//
// Each case: a structurally valid fenced block that is missing one required field
// or violates a size cap.  All must produce envelopeValid:false + a matching error.

describe("checkReceipt — full v2 required-field parity (mirror of validateHandoffV2)", () => {
  const P = "/run/handoffs/backend-task-001.md";

  it("rejects envelope missing task_id — task_id must be a non-empty string", () => {
    const { task_id: _dropped, ...noTaskId } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noTaskId);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("task_id"))).toBe(true);
  });

  it("rejects envelope with empty task_id string", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ task_id: "  " }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("task_id"))).toBe(true);
  });

  it("rejects envelope missing tier", () => {
    const { tier: _dropped, ...noTier } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noTier);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("rejects envelope with invalid tier value", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ tier: "ultra" }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("tier"))).toBe(true);
  });

  it("rejects envelope missing status", () => {
    const { status: _dropped, ...noStatus } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noStatus);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects envelope with invalid status value", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ status: "pending" }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("status"))).toBe(true);
  });

  it("rejects envelope missing summary", () => {
    const { summary: _dropped, ...noSummary } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noSummary);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("rejects envelope with empty summary string", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ summary: "   " }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("summary"))).toBe(true);
  });

  it("rejects envelope with summary over 600 chars (SC-7 bloat rejection)", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ summary: "x".repeat(601) }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("summary") && e.includes("cap"))).toBe(true);
  });

  it("rejects envelope missing artifacts", () => {
    const { artifacts: _dropped, ...noArtifacts } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noArtifacts);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("artifacts"))).toBe(true);
  });

  it("rejects envelope where artifacts is not an array", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ artifacts: "not-an-array" }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("artifacts"))).toBe(true);
  });

  it("rejects envelope missing issues", () => {
    const { issues: _dropped, ...noIssues } = validEnvelope() as Record<string, unknown>;
    const md = withEnvelope(validReceiptMd(), noIssues);
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("issues"))).toBe(true);
  });

  it("rejects envelope where issues is not an array", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope({ issues: "not-an-array" }));
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("issues"))).toBe(true);
  });

  it("rejects escalate status without escalate_reason (conditional required field)", () => {
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ status: "escalate" })
      // escalate_reason is absent → must fail
    );
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("escalate_reason"))).toBe(true);
  });

  it("accepts escalate status WITH a non-empty escalate_reason", () => {
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ status: "escalate", escalate_reason: "need architect review" })
    );
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects escalate status with empty escalate_reason string", () => {
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ status: "escalate", escalate_reason: "  " })
    );
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("escalate_reason"))).toBe(true);
  });

  it("rejects notes over 200 chars (O-4 cap)", () => {
    const md = withEnvelope(
      validReceiptMd(),
      validEnvelope({ notes: "n".repeat(201) })
    );
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    expect(r.errors.some((e) => e.includes("notes") && e.includes("cap"))).toBe(true);
  });

  it("dismissible:false when envelope has only schema_version (missing all other required fields)", () => {
    // This is the exact case the BLOCKER identified: the old envelopeShapeErrors
    // would have accepted this (schema_version OK + no unknown keys) but
    // validateHandoffV2 rejects it (missing task_id, tier, status, summary, etc.).
    const md = withEnvelope(validReceiptMd(), { schema_version: "guild.handoff.v2" });
    const fsMod = makeFs({ [P]: md });
    const r = checkReceipt(P, fsMod);
    expect(r.envelopeValid).toBe(false);
    // Must report multiple missing required fields
    expect(r.errors.some((e) => e.includes("task_id"))).toBe(true);
    expect(r.errors.some((e) => e.includes("tier"))).toBe(true);
    expect(r.errors.some((e) => e.includes("status"))).toBe(true);
    expect(r.errors.some((e) => e.includes("summary"))).toBe(true);
    expect(r.errors.some((e) => e.includes("artifacts"))).toBe(true);
    expect(r.errors.some((e) => e.includes("issues"))).toBe(true);
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

  it("dismissible:false for frontmatter-only receipt (§8.2 present, no fenced block) — in-scope run, matches hook reject verdict", () => {
    // This is the literal p2-3 scenario: §8.2 sections present but no fenced JSON block.
    // The hook validator rejects it (no fenced block). For an in-scope run (>= policy_effective_date)
    // reaping must agree (fail-closed).  A run.yaml with an in-scope date is required so the
    // OD-4 discriminator enforces the fail-closed path (undeterminable → fail-open, not tested here).
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
    const fsMod = makeFs({
      [rPath]: frontmatterOnly,
      // in-scope run: envelope is required → fail-closed
      [`${RUN_DIR}/run.yaml`]: "schema_version: guild.run.v1\nrun_id: run-001\nstarted_at: 2026-06-03T00:00:00.000Z\nstatus: open\n",
    });
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

  it("uses the cmux workspace surface registry for cmux manifests", () => {
    const fs = makeFs({
      [SESSION_PATH]: JSON.stringify({
        run_id: "run-001",
        backend: "cmux",
        session_name: "workspace:7",
        teammate_panes: [
          { specialist: "backend", task_id: "T1", pane_id: "surface:1", host_kind: "claude", adapter_version: "1" },
          { specialist: "qa", task_id: "T2", pane_id: "surface:2", host_kind: "claude", adapter_version: "1" },
        ],
      }),
    });
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      return { status: 0, stdout: '{"surfaces":[{"id":"surface:1"}]}', stderr: "" };
    };
    const result = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });
    expect(result.live).toEqual(["backend"]);
    expect(result.reaped).toEqual(["qa"]);
    expect(calls).toContainEqual({
      cmd: "cmux",
      args: ["list-pane-surfaces", "--workspace", "workspace:7", "--json"],
    });
  });

  it("reaps only the dead cmux task surface when one specialist owns multiple tasks", () => {
    const fs = makeFs({
      [SESSION_PATH]: JSON.stringify({
        run_id: "run-001",
        backend: "cmux",
        session_name: "workspace:7",
        teammate_panes: [
          {
            specialist: "backend",
            task_id: "T1",
            dispatch_key: "backend--T1--a1",
            pane_id: "surface:1",
            host_kind: "claude",
            adapter_version: "1",
          },
          {
            specialist: "backend",
            task_id: "T2",
            dispatch_key: "backend--T2--a1",
            pane_id: "surface:2",
            host_kind: "claude",
            adapter_version: "1",
          },
        ],
      }),
    });
    const run: RunFn = () => ({
      status: 0,
      stdout: '{"surfaces":[{"id":"surface:2"}]}',
      stderr: "",
    });

    const result = reapDeadMembers(SESSION_PATH, { run, fsMod: fs });

    expect(result.reaped).toEqual(["backend"]);
    expect(result.live).toEqual(["backend"]);
    const written = JSON.parse(fs.store.get(SESSION_PATH) as string) as SessionManifest;
    expect(written.teammate_panes).toEqual([
      expect.objectContaining({
        task_id: "T2",
        dispatch_key: "backend--T2--a1",
        pane_id: "surface:2",
      }),
    ]);
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

// ── OD-4 discriminator — isRunInScope ─────────────────────────────────────────
//
// policy_effective_date: 2026-06-03 (ADR: communication-format-policy (workspace wiki))
// A runtime receipt written for a run whose started_at / run-id timestamp is
//   >= 2026-06-03  → in-scope (fail-closed on missing envelope)
//   <  2026-06-03  → grandfathered (fail-open / lenient: §8.2 alone is enough)
//   undeterminable → fail-open lenient + warn log

/** Minimal run.yaml content fragment with a given started_at date. */
function runYaml(startedAt: string): string {
  return `schema_version: guild.run.v1\nrun_id: run-test\nstarted_at: ${startedAt}\nstatus: open\n`;
}

describe("isRunInScope — OD-4 discriminator", () => {
  const RUN_DIR = "/repo/.guild/runs/run-test";

  it("returns true for started_at on the effective date (2026-06-03)", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-03T00:00:00.000Z") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(true);
  });

  it("returns true for started_at after the effective date", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-04T12:30:00.000Z") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(true);
  });

  it("returns false for started_at before the effective date (grandfathered)", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-02T23:59:59.000Z") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });

  it("returns false for a clearly legacy started_at (grandfathered)", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-01-15T08:00:00.000Z") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });

  it("returns false (fail-open) when run.yaml is absent — undeterminable date", () => {
    const fs = makeFs(); // no run.yaml
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });

  it("returns false (fail-open) when run.yaml has no started_at line — undeterminable date", () => {
    const fs = makeFs({
      [`${RUN_DIR}/run.yaml`]: "schema_version: guild.run.v1\nrun_id: run-test\nstatus: open\n",
    });
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });

  it("returns false (fail-open) when started_at is unparseable — undeterminable date", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("NOT-A-DATE") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });

  it("parses date-only ISO form (YYYY-MM-DD) correctly — on the boundary", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-03") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(true);
  });

  it("parses date-only ISO form (YYYY-MM-DD) correctly — day before boundary", () => {
    const fs = makeFs({ [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-02") });
    expect(isRunInScope(RUN_DIR, fs)).toBe(false);
  });
});

// ── OD-4 discriminator — detectDismissible grandfathering ─────────────────────
//
// When a receipt has §8.2 fields but no fenced v2 envelope, the dismissal result
// depends on whether the run is in-scope (OD-4):
//   in-scope run  → dismissible:false (fail-closed — envelope required)
//   legacy run    → dismissible:true  (grandfathered — §8.2 alone is enough)
//   no run.yaml   → dismissible:true  (fail-open — undeterminable date is lenient)

describe("detectDismissible — OD-4 grandfathering via run.yaml", () => {
  const RUN_DIR = "/repo/.guild/runs/run-od4";
  const HANDOFFS = `${RUN_DIR}/handoffs`;
  const RECEIPT_PATH = `${HANDOFFS}/backend-task-001.md`;

  // A receipt that has all §8.2 fields but NO fenced v2 block (legacy shape).
  const legacyReceiptMd = validReceiptMd();

  it("dismissible:false for in-scope run (>= 2026-06-03) with no envelope — fail-closed", () => {
    const fs = makeFs({
      [RECEIPT_PATH]: legacyReceiptMd,
      [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-03T00:00:00.000Z"),
    });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.some((e) => e.includes("fenced block") || e.includes("envelope"))).toBe(true);
  });

  it("dismissible:true for grandfathered run (< 2026-06-03) with no envelope — §8.2 alone is enough", () => {
    const fs = makeFs({
      [RECEIPT_PATH]: legacyReceiptMd,
      [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-02T23:59:59.000Z"),
    });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(true);
    expect(entry.errors).toHaveLength(0);
  });

  it("dismissible:true when run.yaml absent and receipt has §8.2 fields — fail-open on undeterminable date", () => {
    const fs = makeFs({ [RECEIPT_PATH]: legacyReceiptMd });
    // No run.yaml → date is undeterminable → fail-open (lenient)
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(true);
    expect(entry.errors).toHaveLength(0);
  });

  it("dismissible:true for in-scope run WITH valid envelope — envelope present and valid", () => {
    const md = withEnvelope(validReceiptMd(), validEnvelope());
    const fs = makeFs({
      [RECEIPT_PATH]: md,
      [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-03T00:00:00.000Z"),
    });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(true);
    expect(entry.errors).toHaveLength(0);
  });

  it("dismissible:false for grandfathered run with invalid envelope shape (shape errors still reject)", () => {
    // Even for a legacy run, a PRESENT but malformed envelope is still invalid.
    // Grandfathering only applies when NO envelope exists (the old shape).
    const md = withEnvelope(validReceiptMd(), validEnvelope({ schema_version: "guild.handoff.v0" }));
    const fs = makeFs({
      [RECEIPT_PATH]: md,
      [`${RUN_DIR}/run.yaml`]: runYaml("2026-06-01T00:00:00.000Z"),
    });
    const [entry] = detectDismissible(RUN_DIR, ["backend"], fs);
    expect(entry.dismissible).toBe(false);
    expect(entry.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });
});
