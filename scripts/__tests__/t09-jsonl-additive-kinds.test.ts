/**
 * t09-jsonl-additive-kinds.test.ts — U-LOOP observability fixtures
 * (KTD38 / R53 / R70 / R75).
 *
 * The named "Done when" clauses this file pins:
 *   - harvest / redirect / CAS / curator ride the EXISTING v1.4 run log; there is
 *     no third JSONL and the frozen twelve are unchanged
 *   - loop-round events still land on that same log (the one review gate's
 *     round record)
 *   - refreshTouched never reaches the explicit Stage-2 extractor
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { EVENT_TYPES as SCHEMA_EVENT_TYPES } from "../../src/domains/lifecycle";
import { EVENT_TYPES as VALIDATOR_EVENT_TYPES, validateEvent } from "../v1.4-log-validator";

const TS = "2026-09-16T12:00:00.000Z";
const RUN = "run-t09";

/** The twelve v1.4 kinds that were frozen before this lane. */
const FROZEN_TWELVE = [
  "phase_start", "phase_end", "specialist_dispatch", "specialist_receipt",
  "loop_round_start", "loop_round_end", "tool_call", "hook_event",
  "gate_decision", "assumption_logged", "escalation", "codex_review_round",
];

describe("the four additive kinds are additive (KTD38 / R53)", () => {
  it("leaves the frozen twelve in place and adds exactly four", () => {
    const schema = [...SCHEMA_EVENT_TYPES];
    for (const want of FROZEN_TWELVE) expect(schema).toContain(want);
    expect(schema.filter((e) => !FROZEN_TWELVE.includes(e)).sort()).toEqual([
      "cas_event", "curator_event", "harvest_event", "redirect_event",
    ]);
  });

  it("the schema and the shipped validator agree on the kind list", () => {
    expect([...SCHEMA_EVENT_TYPES].sort()).toEqual([...VALIDATOR_EVENT_TYPES].sort());
  });

  it("a harvest_event validates, and carries a path rather than a body", () => {
    const r = validateEvent({
      ts: TS, event: "harvest_event", run_id: RUN,
      op_id: "op-1", trigger: "redirect_threshold", status: "written",
      decision_id: "decision:x", wiki_path: ".guild/wiki/decisions/x.md",
    });
    expect(r.ok).toBe(true);
  });

  it("a refused harvest_event without a reason is REJECTED", () => {
    const r = validateEvent({
      ts: TS, event: "harvest_event", run_id: RUN,
      op_id: "op-1", trigger: "harvest", status: "refused",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/refuse_reason/);
  });

  it("an out-of-enum harvest status is REJECTED", () => {
    const r = validateEvent({
      ts: TS, event: "harvest_event", run_id: RUN,
      op_id: "op-1", trigger: "harvest", status: "maybe",
    });
    expect(r.ok).toBe(false);
  });

  it("redirect / cas / curator events validate", () => {
    expect(
      validateEvent({ ts: TS, event: "redirect_event", run_id: RUN, agent_id: "backend", topic_key: "retries", count: 3, fired: true }).ok,
    ).toBe(true);
    expect(
      validateEvent({ ts: TS, event: "cas_event", run_id: RUN, target: "/x/y.md", outcome: "lost", expected_hash: "a", actual_hash: "b" }).ok,
    ).toBe(true);
    expect(
      validateEvent({ ts: TS, event: "curator_event", run_id: RUN, target_type: "playbook", target_path: "/p.md", op: "replace", span: "Retries", applied: true }).ok,
    ).toBe(true);
  });

  it("a loop-round event still validates on the same log (R70)", () => {
    const r = validateEvent({
      ts: TS, event: "loop_round_end", run_id: RUN, lane_id: "lane-1",
      loop_layer: "L2", round_number: 1, terminated: "satisfied", terminator: "reviewer",
    });
    expect(r.ok).toBe(true);
  });
});

describe("refreshTouched does not reach Stage-2 (R62 / R75)", () => {
  it("names neither the extractor nor its wrapper", () => {
    const body = fs.readFileSync(
      path.resolve(__dirname, "..", "..", "src/domains/knowledge/refresh-touched.ts"),
      "utf8",
    );
    for (const forbidden of ["extract-structural", "analyze-structural", "knowledge-graph.json", "knowledge-recall.json", "validate-graph"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it("the explicit Stage-2 entrypoint still exists for the learn path", () => {
    expect(fs.existsSync(path.resolve(__dirname, "..", "learn", "extract-structural.ts"))).toBe(true);
  });
});
