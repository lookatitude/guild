/**
 * hooks/__tests__/emit-learning-checkpoint.test.ts
 *
 * TDD: written BEFORE the HK-03 implementation.
 *
 * Verifies that emit-learning-checkpoint.ts:
 *   - writes a valid `guild.learning_checkpoint.v1` YAML record to
 *     `.guild/runs/<run-id>/learning/<phase>-<run-id>.yaml`
 *   - includes ALL 12 required decision keys (VC-K4 machine-check)
 *   - defaults all decisions to `none` when no verdict block is supplied
 *   - accepts a verdict block (the SK-13 seam) and serializes non-`none` verdicts
 *   - appends non-`none` verdicts to `.guild/reflections/<run-id>.md`
 *   - rejects an invalid phase enum token (writes nothing, exits 0)
 *   - exports `writeCheckpoint()` so skill-author (SK-13) can call it
 *
 * DRIFT-ANALYSIS finding addressed: SK-13 / HK-03 (high) — the per-phase
 *   `guild.learning_checkpoint.v1` is unimplemented; once-at-Stop pattern replaced.
 *
 * VC-K4 evidence: `decisions` carries exactly 12 keys + all-`none` is valid.
 * VC-K7 evidence: nothing auto-promotes; non-`none` only routes to reflections queue.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  writeCheckpoint,
  ALL_NONE_DECISIONS,
  DECISION_TARGETS,
  VALID_PHASES,
  type CheckpointPhase,
  type CheckpointDecisions,
} from "../emit-learning-checkpoint";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRoot(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-lc-"));
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  return tmp;
}

function checkpointPath(root: string, runId: string, phase: CheckpointPhase): string {
  return path.join(root, ".guild", "runs", runId, "learning", `${phase}-${runId}.yaml`);
}

function reflectionsPath(root: string, runId: string): string {
  return path.join(root, ".guild", "reflections", `${runId}.md`);
}

function readCheckpoint(p: string): string {
  return fs.readFileSync(p, "utf8");
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("emit-learning-checkpoint — HK-03", () => {
  let root: string;
  const RUN = "run-test-2026-06-07";

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ── Schema constants ─────────────────────────────────────────────────────

  describe("schema constants", () => {
    it("DECISION_TARGETS has exactly 12 entries (VC-K4)", () => {
      expect(DECISION_TARGETS.length).toBe(12);
    });

    it("DECISION_TARGETS contains the 12 canonical keys", () => {
      const expected = [
        "memory", "wiki", "knowledge_graph", "domain_model",
        "agent_def", "skill_def", "agent_template", "skill_template",
        "config", "task_tracking", "workflow_rules", "review_policy",
      ];
      expect([...DECISION_TARGETS].sort()).toEqual([...expected].sort());
    });

    it("ALL_NONE_DECISIONS has all 12 keys set to 'none'", () => {
      expect(Object.keys(ALL_NONE_DECISIONS).length).toBe(12);
      for (const v of Object.values(ALL_NONE_DECISIONS)) {
        expect(v).toBe("none");
      }
    });

    it("VALID_PHASES contains all 7 phase tokens", () => {
      const expected = ["init", "ideation", "planning", "development", "quality", "operations", "reflection"];
      expect([...VALID_PHASES].sort()).toEqual([...expected].sort());
    });
  });

  // ── Happy path: default all-none ─────────────────────────────────────────

  describe("writeCheckpoint — default all-none (HK-03 advisory default)", () => {
    it("creates the checkpoint file at the correct path", () => {
      const written = writeCheckpoint({
        runId: RUN,
        phase: "development",
        evidenceRef: `.guild/runs/${RUN}/logs/v1.4-events.jsonl`,
        guildRoot: root,
      });
      expect(written).toBe(checkpointPath(root, RUN, "development"));
      expect(fs.existsSync(written)).toBe(true);
    });

    it("writes the nested learning_checkpoint: wrapper (contract §1 shape)", () => {
      writeCheckpoint({ runId: RUN, phase: "planning", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "planning"));
      // Must have top-level learning_checkpoint: key
      expect(content).toContain("learning_checkpoint:");
      // Must NOT have schema_version at top level (only nested version: field)
      expect(content).not.toMatch(/^schema_version:/m);
    });

    it("writes top-level comment # guild.learning_checkpoint.v1", () => {
      writeCheckpoint({ runId: RUN, phase: "planning", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "planning"));
      expect(content).toMatch(/^#.*guild\.learning_checkpoint\.v1/m);
    });

    it("writes nested version: field (not schema_version)", () => {
      writeCheckpoint({ runId: RUN, phase: "planning", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "planning"));
      expect(content).toContain("version: guild.learning_checkpoint.v1");
      expect(content).not.toContain("schema_version:");
    });

    it("includes the phase field nested under learning_checkpoint", () => {
      writeCheckpoint({ runId: RUN, phase: "quality", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "quality"));
      expect(content).toContain("phase: quality");
    });

    it("includes the run_id field", () => {
      writeCheckpoint({ runId: RUN, phase: "init", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "init"));
      expect(content).toContain(`run_id: ${RUN}`);
    });

    it("includes observed: [] when no observed facts supplied (contract §1 REQUIRED)", () => {
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain("observed: []");
    });

    it("serializes observed facts when supplied", () => {
      writeCheckpoint({
        runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root,
        observed: ["handoff receipt present", "skill-def proposal in followups"],
      });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain("handoff receipt present");
      expect(content).toContain("skill-def proposal in followups");
    });

    it("includes the evidence_ref field", () => {
      const ref = `.guild/runs/${RUN}/handoffs/backend.md`;
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: ref, guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain(ref);
    });

    it("includes the routed_to field pointing to reflections/<run-id>.md", () => {
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain(`reflections/${RUN}.md`);
    });

    it("includes all 12 decision keys nested under decisions: (VC-K4)", () => {
      writeCheckpoint({ runId: RUN, phase: "operations", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "operations"));
      // decisions: block must appear
      expect(content).toContain("decisions:");
      for (const key of DECISION_TARGETS) {
        expect(content).toContain(`${key}:`);
      }
    });

    it("all decisions default to 'none' when no verdict block supplied (VC-K4)", () => {
      writeCheckpoint({ runId: RUN, phase: "ideation", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "ideation"));
      const matches = content.match(/:\s*none\b/g);
      expect(matches).not.toBeNull();
      expect((matches ?? []).length).toBeGreaterThanOrEqual(12);
    });

    it("does NOT append to reflections when all decisions are none (VC-K7)", () => {
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      expect(fs.existsSync(reflectionsPath(root, RUN))).toBe(false);
    });

    it("includes knowledge_links_batch: [] when no links supplied", () => {
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain("knowledge_links_batch: []");
    });

    it("contract §1 field order: version, phase, run_id, observed, decisions, knowledge_links_batch, routed_to, evidence_ref", () => {
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      const versionIdx = content.indexOf("version:");
      const phaseIdx = content.indexOf("phase:");
      const runIdIdx = content.indexOf("run_id:");
      const observedIdx = content.indexOf("observed:");
      const decisionsIdx = content.indexOf("decisions:");
      const klbIdx = content.indexOf("knowledge_links_batch:");
      const routedIdx = content.indexOf("routed_to:");
      const evidenceIdx = content.indexOf("evidence_ref:");
      expect(versionIdx).toBeLessThan(phaseIdx);
      expect(phaseIdx).toBeLessThan(runIdIdx);
      expect(runIdIdx).toBeLessThan(observedIdx);
      expect(observedIdx).toBeLessThan(decisionsIdx);
      expect(decisionsIdx).toBeLessThan(klbIdx);
      expect(klbIdx).toBeLessThan(routedIdx);
      expect(routedIdx).toBeLessThan(evidenceIdx);
    });
  });

  // ── Verdict block seam (SK-13 integration) ────────────────────────────────

  describe("writeCheckpoint — with explicit verdict block (SK-13 seam)", () => {
    it("writes non-none verdict for a single target", () => {
      const decisions: CheckpointDecisions = {
        ...ALL_NONE_DECISIONS,
        wiki: "candidate:.guild/wiki/decisions/test.md",
      };
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root, decisions });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain("wiki: candidate:");
    });

    it("appends non-none verdict to reflections/<run-id>.md", () => {
      const decisions: CheckpointDecisions = {
        ...ALL_NONE_DECISIONS,
        task_tracking: "update:TASK-42",
      };
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root, decisions });
      expect(fs.existsSync(reflectionsPath(root, RUN))).toBe(true);
      const ref = fs.readFileSync(reflectionsPath(root, RUN), "utf8");
      expect(ref).toContain("task_tracking");
      expect(ref).toContain("update:TASK-42");
    });

    it("appends multiple non-none verdicts to reflections", () => {
      const decisions: CheckpointDecisions = {
        ...ALL_NONE_DECISIONS,
        skill_def: "proposal:guild:new-skill",
        config: "proposal:models.tiers.cheap",
      };
      writeCheckpoint({ runId: RUN, phase: "planning", evidenceRef: "none", guildRoot: root, decisions });
      const ref = fs.readFileSync(reflectionsPath(root, RUN), "utf8");
      expect(ref).toContain("skill_def");
      expect(ref).toContain("config");
    });

    it("does NOT auto-promote to wiki (VC-K7 — no wiki write)", () => {
      const decisions: CheckpointDecisions = {
        ...ALL_NONE_DECISIONS,
        wiki: "candidate:.guild/wiki/decisions/x.md",
      };
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root, decisions });
      // Only the reflections queue file should be written — not any wiki file
      const wikiPath = path.join(root, ".guild", "wiki", "decisions", "x.md");
      expect(fs.existsSync(wikiPath)).toBe(false);
    });

    it("accumulates across phases (two calls, two checkpoint files)", () => {
      writeCheckpoint({ runId: RUN, phase: "planning", evidenceRef: "none", guildRoot: root });
      writeCheckpoint({ runId: RUN, phase: "development", evidenceRef: "none", guildRoot: root });
      expect(fs.existsSync(checkpointPath(root, RUN, "planning"))).toBe(true);
      expect(fs.existsSync(checkpointPath(root, RUN, "development"))).toBe(true);
    });
  });

  // ── Knowledge links batch ─────────────────────────────────────────────────

  describe("writeCheckpoint — knowledge_links_batch", () => {
    it("serializes knowledge_links_batch entries under the nested wrapper", () => {
      writeCheckpoint({
        runId: RUN,
        phase: "development",
        evidenceRef: "none",
        guildRoot: root,
        knowledgeLinksBatch: [
          { from: `task:${RUN}`, to: "decision:adr-001", type: "decided_by", run_id: RUN },
        ],
      });
      const content = readCheckpoint(checkpointPath(root, RUN, "development"));
      expect(content).toContain("decided_by");
      expect(content).toContain("task:");
      // Nested indentation — links are under learning_checkpoint
      expect(content).toMatch(/knowledge_links_batch:\s*\n\s+- from:/);
    });

    it("rejects invalid edge type (closed 9-set)", () => {
      expect(() =>
        writeCheckpoint({
          runId: RUN,
          phase: "development",
          evidenceRef: "none",
          guildRoot: root,
          knowledgeLinksBatch: [
            { from: "a", to: "b", type: "invalid_edge_type_xyz" as never, run_id: RUN },
          ],
        }),
      ).toThrow();
    });
  });

  // ── Phase enum validation ─────────────────────────────────────────────────

  describe("writeCheckpoint — phase validation", () => {
    it("accepts all 7 valid phases without throwing", () => {
      const phases: CheckpointPhase[] = [
        "init", "ideation", "planning", "development",
        "quality", "operations", "reflection",
      ];
      for (const phase of phases) {
        expect(() =>
          writeCheckpoint({ runId: RUN, phase, evidenceRef: "none", guildRoot: root }),
        ).not.toThrow();
      }
    });

    it("throws on invalid phase token", () => {
      expect(() =>
        writeCheckpoint({
          runId: RUN,
          phase: "unknown-phase" as CheckpointPhase,
          evidenceRef: "none",
          guildRoot: root,
        }),
      ).toThrow();
    });
  });
});
