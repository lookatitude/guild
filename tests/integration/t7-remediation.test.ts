/**
 * tests/integration/t7-remediation.test.ts
 *
 * T7 security-audit remediation — regression pins for H2, M3, M4.
 *
 * H2  A second, unverified `independence: "strong"` producer reached a SHARED,
 *     git-tracked artifact (`run-state.json`, in SHARED_SCRUBBED_NAMES and
 *     git re-included) and was the DEFAULT path, while the §7a block writer
 *     had zero production callers. Pinned here at the PERSISTENCE boundary:
 *     no lane record may carry "strong" without a WRITTEN, hash-bound §7a
 *     adjudication on record — whoever the producer is.
 *
 * T7R-R1-B2  Round 1's guard was RUN-WIDE: `hasStrongAdjudication(runDir)` asked
 *     only whether ANY block in the run was strong, so one legitimate strong
 *     adjudication unlocked `strong` for arbitrary UNRELATED lanes. Pinned below
 *     as the reviewer's exact counterexample — lane-a holds a valid strong block,
 *     and unrelated-lane-b's write THROWS and leaves the checkpoint untouched —
 *     plus per-key negatives for each binding component.
 *
 * M3  `persistInspectionReport` verified the run binding on an INJECTABLE
 *     `BindingFs` and wrote with Node's REAL `fs` — authorization and effect on
 *     different filesystems (the injected-seam-masks-real-path class). Pinned:
 *     an always-open fake fs authorizes nothing, and the seam is gone.
 *
 * M4  The exact-key confirmation arbiter had NO production callers, so one
 *     degradation approval could be reused across a different target, purpose,
 *     or fallback shape. Pinned: approval under one key never satisfies a key
 *     differing in ANY component.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { upsertLane } from "../../hooks/lib/run-state";
import {
  findBoundAdjudications,
  loadWrittenAdjudications,
  persistIndependenceAdjudication,
} from "../../src/modules/capability/workflows/independence-record";
import { validateWrittenAdjudication } from "../../src/modules/capability/workflows/independence-predicates";
import { persistInspectionReport } from "../../src/modules/capability/workflows/inspection-persist";
import {
  BindingRejectedError,
  mintRunBinding,
} from "../../src/modules/lifecycle/workflows/run-binding";
import {
  claimConfirmation,
  loadConfirmationEntries,
  recordConfirmationDecision,
} from "../../src/modules/dispatch/workflows/confirmation-gate";

const RUN_ID = "run-t7-remediation";

function tmpRoot(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `t7-${tag}-`));
}

function runDirOf(root: string): string {
  return path.join(root, ".guild", "runs", RUN_ID);
}

/** A verified/cross-family/served producer+reviewer pair — the ONE strong case. */
const VERIFIED_CLAUDE = {
  host_family: "claude",
  host_trust: "verified",
  served_model: "claude-opus-5",
  served_model_family: "claude",
  finalized: true,
  status: "served",
};
const VERIFIED_CODEX = {
  host_family: "codex",
  host_trust: "verified",
  served_model: "gpt-5.6-sol",
  served_model_family: "gpt",
  finalized: true,
  status: "served",
};
/**
 * The lane whose OWN dispatch the §7a block adjudicates. T7R-R1-B2: a lane's
 * producing dispatch IS that lane, so `producer_ref.dispatch_id === lane key`.
 */
const LANE_A = "lane-a";
/** A different lane with no adjudication of its own — the reviewer's lane-b. */
const LANE_B = "unrelated-lane-b";
const PRODUCER_A = { dispatch_id: LANE_A, receipt_hash: "a".repeat(64) };
const REVIEWER_A = { dispatch_id: "d-reviewer-a", receipt_hash: "b".repeat(64) };

// -- H2 ----------------------------------------------------------------------

describe("T7-H2 - no unearned `strong` reaches the shared run-state artifact", () => {
  let root: string;
  let bindingRef: string;
  beforeEach(() => {
    root = tmpRoot("h2");
    fs.mkdirSync(runDirOf(root), { recursive: true });
    bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const hostBlock = (
    independence: "strong" | "weak",
    independence_ref?: { producer_ref: typeof PRODUCER_A; reviewer_ref: typeof REVIEWER_A },
  ) => ({
    selected: "codex",
    degraded: false,
    independence,
    ...(independence_ref ? { independence_ref } : {}),
    tier: "mid" as const,
    model: "gpt-5.6-sol",
  });

  /** Write the ONE legitimate strong adjudication: lane-a's own dispatch pair. */
  function adjudicateLaneA(overrides: Record<string, unknown> = {}) {
    const input = {
      root,
      binding: { run_id: RUN_ID, binding_ref: bindingRef },
      label: LANE_A,
      producer_ref: PRODUCER_A,
      reviewer_ref: REVIEWER_A,
      producer: VERIFIED_CLAUDE,
      reviewer: VERIFIED_CODEX,
      requested_independence: "require_cross_family",
      ...overrides,
    };
    return persistIndependenceAdjudication(input as never);
  }

  const runStateExists = () => fs.existsSync(path.join(runDirOf(root), "run-state.json"));

  test("THE FINDING: upsertLane REFUSES independence:'strong' with no §7a block on record", () => {
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
      }),
    ).toThrow(/independence_not_adjudicated/);
  });

  test("a bare `strong` with NO declared binding refuses (a verdict is never a loose string)", () => {
    adjudicateLaneA(); // even WITH a valid block on record
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, { host: hostBlock("strong") }),
    ).toThrow(/independence_binding_missing/);
    expect(runStateExists()).toBe(false);
  });

  test("the refused write leaves NOTHING on disk - run-state.json is never created", () => {
    try {
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
      });
    } catch {
      /* expected */
    }
    expect(runStateExists()).toBe(false);
  });

  test("ANTI-VACUITY: `weak` always persists (degrading is never gated)", () => {
    const state = upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
      host: hostBlock("weak"),
    });
    expect(state.lanes[LANE_A].host?.independence).toBe("weak");
    expect(runStateExists()).toBe(true);
  });

  test("ANTI-VACUITY: with its OWN written §7a strong block, the bound lane persists `strong`", () => {
    const written = adjudicateLaneA();
    // The verdict is COMPUTED by the canonical predicate, never asserted.
    expect(written.independence).toBe("strong");
    expect(
      findBoundAdjudications(runDirOf(root), {
        lane_id: LANE_A,
        producer_ref: PRODUCER_A,
        reviewer_ref: REVIEWER_A,
      }),
    ).toHaveLength(1);

    const state = upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
      host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
    });
    expect(state.lanes[LANE_A].host?.independence).toBe("strong");
    // The shared artifact carries the binding, so a reader can re-verify it.
    expect(state.lanes[LANE_A].host?.independence_ref?.producer_ref).toEqual(PRODUCER_A);
  });

  // ── T7R-R1-B2: THE RUN-WIDE HOLE ────────────────────────────────────────────

  test("THE R1 COUNTEREXAMPLE: lane-a's valid strong block does NOT unlock unrelated lane-b", () => {
    // Exactly the reviewer's live counterexample: a legitimate strong
    // adjudication over finalized Claude/Codex receipts, labelled lane-a, then
    // an upsert of an unrelated lane on an unverified host. Round 1 wrote it.
    expect(adjudicateLaneA().independence).toBe("strong");

    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_B, {
        host: {
          selected: "pi",
          degraded: false,
          independence: "strong",
          // lane-b copies lane-a's refs verbatim — the strongest form of the attack.
          independence_ref: { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A },
          tier: "mid",
          model: "unverified-model",
        },
      }),
    ).toThrow(/independence_binding_lane_mismatch/);
    // NOTHING was written: no run-state.json at all, so no `independence: strong`.
    expect(runStateExists()).toBe(false);
  });

  test("lane-b cannot buy authorization by naming ITSELF over lane-a's receipt hashes", () => {
    adjudicateLaneA();
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_B, {
        host: hostBlock("strong", {
          // lane-consistent, but no block on record binds THIS producer dispatch.
          producer_ref: { dispatch_id: LANE_B, receipt_hash: PRODUCER_A.receipt_hash },
          reviewer_ref: REVIEWER_A,
        }),
      }),
    ).toThrow(/independence_not_adjudicated/);
    expect(runStateExists()).toBe(false);
  });

  test("a DIFFERENT producer receipt hash for the same lane is not the adjudicated pair", () => {
    adjudicateLaneA();
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", {
          producer_ref: { dispatch_id: LANE_A, receipt_hash: "c".repeat(64) },
          reviewer_ref: REVIEWER_A,
        }),
      }),
    ).toThrow(/independence_not_adjudicated/);
    expect(runStateExists()).toBe(false);
  });

  test("a DIFFERENT reviewer receipt hash is not the adjudicated pair", () => {
    adjudicateLaneA();
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", {
          producer_ref: PRODUCER_A,
          reviewer_ref: { dispatch_id: REVIEWER_A.dispatch_id, receipt_hash: "d".repeat(64) },
        }),
      }),
    ).toThrow(/independence_not_adjudicated/);
    expect(runStateExists()).toBe(false);
  });

  test("a non-sha256 declared receipt hash is not a binding at all", () => {
    adjudicateLaneA();
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", {
          producer_ref: { dispatch_id: LANE_A, receipt_hash: "not-a-hash" } as never,
          reviewer_ref: REVIEWER_A,
        }),
      }),
    ).toThrow(/independence_binding_missing/);
    expect(runStateExists()).toBe(false);
  });

  test("TWO blocks binding the SAME pair are ambiguous and refuse (filename order never decides)", () => {
    adjudicateLaneA();
    // A second file, same binding, opposite verdict — hand-planted the way a
    // duplicate label would land it.
    fs.writeFileSync(
      path.join(runDirOf(root), "independence", `${LANE_A}-dupe.json`),
      JSON.stringify({
        producer_ref: PRODUCER_A,
        reviewer_ref: REVIEWER_A,
        independence: "weak",
        predicate_trace: "duplicate binding, opposite verdict",
      }) + "\n",
      "utf8",
    );
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
      }),
    ).toThrow(/independence_adjudication_ambiguous/);
    expect(runStateExists()).toBe(false);
  });

  test("a WEAK adjudication on record does NOT unlock `strong` (same-family pair)", () => {
    const written = adjudicateLaneA({
      // Same host family => the §7 truth table returns weak.
      reviewer: { ...VERIFIED_CODEX, host_family: "claude" },
    });
    expect(written.independence).toBe("weak");
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
      }),
    ).toThrow(/independence_not_adjudicated/);
    expect(runStateExists()).toBe(false);
  });

  test("a hand-planted FRAGMENT `{independence:'strong'}` is not an adjudication", () => {
    // §7a admits no provisional strong: a file asserting the verdict without
    // the backward receipt refs + predicate trace unlocks nothing.
    const dir = path.join(runDirOf(root), "independence");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "forged.json"),
      JSON.stringify({ independence: "strong" }) + "\n",
      "utf8",
    );
    expect(validateWrittenAdjudication({ independence: "strong" })).toBeNull();
    expect(loadWrittenAdjudications(runDirOf(root))).toEqual([]);
    expect(() =>
      upsertLane(runDirOf(root), { runId: RUN_ID }, LANE_A, {
        host: hostBlock("strong", { producer_ref: PRODUCER_A, reviewer_ref: REVIEWER_A }),
      }),
    ).toThrow(/independence_not_adjudicated/);
  });

  test("a block whose receipt refs are not sha256 is rejected (hash-bound, not label-bound)", () => {
    const dir = path.join(runDirOf(root), "independence");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "unbound.json"),
      JSON.stringify({
        producer_ref: { dispatch_id: LANE_A, receipt_hash: "not-a-hash" },
        reviewer_ref: REVIEWER_A,
        independence: "strong",
        predicate_trace: "claims strong",
      }) + "\n",
      "utf8",
    );
    expect(loadWrittenAdjudications(runDirOf(root))).toEqual([]);
    expect(
      findBoundAdjudications(runDirOf(root), {
        lane_id: LANE_A,
        producer_ref: PRODUCER_A,
        reviewer_ref: REVIEWER_A,
      }),
    ).toEqual([]);
  });

  test("the §7a writer refuses to run before BOTH receipts are finalized", () => {
    expect(() =>
      persistIndependenceAdjudication({
        root,
        binding: { run_id: RUN_ID, binding_ref: bindingRef },
        label: "premature",
        producer_ref: PRODUCER_A,
        reviewer_ref: REVIEWER_A,
        producer: VERIFIED_CLAUDE,
        reviewer: { ...VERIFIED_CODEX, finalized: false },
        requested_independence: "require_cross_family",
      }),
    ).toThrow(/adjudication_premature/);
  });

  test("the §7a writer fails closed without the run's verified binding", () => {
    expect(() =>
      persistIndependenceAdjudication({
        root,
        binding: { run_id: RUN_ID, binding_ref: "rb-forged" },
        label: "unbound",
        producer_ref: PRODUCER_A,
        reviewer_ref: REVIEWER_A,
        producer: VERIFIED_CLAUDE,
        reviewer: VERIFIED_CODEX,
        requested_independence: "require_cross_family",
      }),
    ).toThrow(BindingRejectedError);
    expect(fs.existsSync(path.join(runDirOf(root), "independence"))).toBe(false);
  });
});

// -- M3 ----------------------------------------------------------------------

describe("T7-M3 - inspection persistence verifies and writes on the SAME real fs", () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot("m3");
    fs.mkdirSync(runDirOf(root), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const report = {
    schema_version: "guild.model_inspection.v1",
    run_id: RUN_ID,
  } as never;

  test("THE FINDING: an always-open fake BindingFs authorizes NOTHING on the real disk", () => {
    // Before the fix this object was handed to assertWritableBinding while the
    // write used Node's real `fs` - a permissive fake gated a real write. The
    // parameter is gone, so the fake is inert and the REAL (absent) binding
    // decides: refusal, and nothing reaches disk.
    const alwaysOpenFs = {
      mkdirp: () => undefined,
      writeFile: () => undefined,
      exists: () => true,
      readFile: () =>
        JSON.stringify({ run_id: RUN_ID, binding_ref: "rb-anything", state: "open" }),
    };
    expect(() =>
      persistInspectionReport({
        root,
        report,
        binding: { run_id: RUN_ID, binding_ref: "rb-anything" },
        label: "T7-lane",
        // Deliberately passed the way a JS caller could still try to.
        fs: alwaysOpenFs,
      } as never),
    ).toThrow(BindingRejectedError);
    expect(fs.existsSync(path.join(runDirOf(root), "inspection"))).toBe(false);
  });

  test("the fs seam is GONE from the module source (no reintroduction by accident)", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/capability/workflows/inspection-persist.ts"),
      "utf8",
    );
    // Scan CODE lines only — the module's own header explains the removed seam.
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    // No BindingFs-typed parameter, and nothing threads a caller fs into the gate.
    expect(code).not.toMatch(/fs\?:\s*BindingFs/);
    expect(code).not.toMatch(/fs:\s*input\.fs/);
  });

  test("ANTI-VACUITY: with the run's REAL minted binding the write succeeds", () => {
    const binding = mintRunBinding({ root, run_id: RUN_ID });
    const { absPath } = persistInspectionReport({
      root,
      report,
      binding: { run_id: RUN_ID, binding_ref: binding.binding_ref },
      label: "T7-lane",
    });
    expect(fs.existsSync(absPath)).toBe(true);
  });
});

// -- M4 ----------------------------------------------------------------------

describe("T7-M4 - the exact-key confirmation arbiter is wired and never leaks approval", () => {
  let root: string;
  let bindingRef: string;
  const baseKey = {
    run_id: RUN_ID,
    purpose: "implementation",
    target_id: "claude-code-cli:claude-opus-5",
    policy_hash: "c".repeat(64),
    catalog_hash: "d".repeat(64),
    fallback_hash: "e".repeat(64),
  };

  beforeEach(() => {
    root = tmpRoot("m4");
    fs.mkdirSync(runDirOf(root), { recursive: true });
    bindingRef = mintRunBinding({ root, run_id: RUN_ID }).binding_ref;
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const claim = (key: Record<string, string>) =>
    claimConfirmation({ root, binding: { run_id: RUN_ID, binding_ref: bindingRef }, key });

  test("byte-identical keys share ONE prompt, durably (across separate calls)", () => {
    const first = claim(baseKey);
    const second = claim({ ...baseKey });
    expect(second.prompt_id).toBe(first.prompt_id);
    expect(loadConfirmationEntries(root, RUN_ID)).toHaveLength(1);
  });

  test.each([
    ["target_id", { target_id: "codex-cli:gpt-5.6-sol" }],
    ["purpose", { purpose: "adversarial" }],
    ["fallback_hash", { fallback_hash: "f".repeat(64) }],
    ["policy_hash", { policy_hash: "9".repeat(64) }],
    ["catalog_hash", { catalog_hash: "8".repeat(64) }],
  ])("THE FINDING: approval under one key does NOT satisfy a key differing in %s", (_c, delta) => {
    claim(baseKey);
    recordConfirmationDecision({
      root,
      binding: { run_id: RUN_ID, binding_ref: bindingRef },
      key: baseKey,
      decision: "approved",
    });
    expect(claim(baseKey).already_decided).toBe(true);

    const other = claim({ ...baseKey, ...(delta as Record<string, string>) });
    expect(other.prompt_id).not.toBe(0);
    expect(other.already_decided).toBe(false); // a DIFFERENT question
    expect(other.decision).toBeNull();
  });

  test("a PARTIAL key fails closed inside the arbiter - it can never claim a confirmation", () => {
    const { fallback_hash: _dropped, ...partial } = baseKey;
    expect(() => claim(partial as Record<string, string>)).toThrow(/confirmation_key_incomplete/);
  });

  test("a CONTRADICTORY second decision for one key is refused (one key, one answer)", () => {
    const rec = (decision: string) =>
      recordConfirmationDecision({
        root,
        binding: { run_id: RUN_ID, binding_ref: bindingRef },
        key: baseKey,
        decision,
      });
    rec("approved");
    expect(rec("approved").decision?.decision).toBe("approved"); // idempotent
    expect(() => rec("rejected")).toThrow(/contradictory_decision/);
  });

  test("caller fields outside the closed 6-tuple never reach the durable record (L3 hygiene)", () => {
    claim({ ...baseKey, operator_note: "/Users/someone/secret/path" } as Record<string, string>);
    const [entry] = loadConfirmationEntries(root, RUN_ID);
    expect(Object.keys(entry.key).sort()).toEqual(
      ["catalog_hash", "fallback_hash", "policy_hash", "purpose", "run_id", "target_id"],
    );
  });

  test("the claim fails closed without the run's verified binding", () => {
    expect(() =>
      claimConfirmation({
        root,
        binding: { run_id: RUN_ID, binding_ref: "rb-forged" },
        key: baseKey,
      }),
    ).toThrow(BindingRejectedError);
  });

  test("the arbiter now HAS a production caller (the real dispatch-model step)", () => {
    // The audit's exact grep: `claimPrompt|createRunLocalState|confirmation-arbiter`
    // outside tests/resources returned only a re-export and a doc comment.
    const gateSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/dispatch/workflows/confirmation-gate.ts"),
      "utf8",
    );
    // T8R/F2: the caller now reaches the arbiter through capability's PUBLIC
    // entrypoint (src/modules/capability/index.ts) — the module-boundary rail
    // rejects a private cross-module workflow import. What must stay true is
    // that the REAL arbiter API is imported, not merely that some path matches,
    // so pin the named bindings inside that exact import statement.
    const capabilityImport = /import\s*\{([\s\S]*?)\}\s*from\s*"\.\.\/\.\.\/capability";/.exec(gateSrc);
    expect(capabilityImport).not.toBeNull();
    const importedNames = String(capabilityImport?.[1] ?? "");
    for (const api of ["claimPrompt", "createRunLocalState", "recordDecision", "decisionFor"]) {
      expect(importedNames).toContain(api);
    }
    const productionSrc = fs.readFileSync(
      path.resolve(__dirname, "../../src/modules/dispatch/workflows/task-assignment-v2.ts"),
      "utf8",
    );
    expect(productionSrc).toMatch(/claimConfirmation\(/);
    // ...and the launcher BLOCKS on an undecided required confirmation.
    const launcherSrc = fs.readFileSync(
      path.resolve(__dirname, "../../scripts/agent-team-launcher.ts"),
      "utf8",
    );
    expect(launcherSrc).toMatch(/confirmation_required/);
  });
});
