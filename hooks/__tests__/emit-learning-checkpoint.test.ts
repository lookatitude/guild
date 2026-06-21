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

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  writeCheckpoint,
  ALL_NONE_DECISIONS,
  DECISION_TARGETS,
  VALID_PHASES,
  VALID_EDGE_TYPES,
  ALLOWED_NODE_PREFIXES,
  FORBIDDEN_NODE_PREFIXES,
  type CheckpointPhase,
  type CheckpointDecisions,
  type KnowledgeLink,
} from "../emit-learning-checkpoint";
// Shared js-yaml frontmatter parser (OD-3 compliant) — assert the absence of a
// top-level field by parsing, not a hand-rolled line-anchored key regex.
import { parseYaml } from "../../scripts/lib/frontmatter";

const SCRIPT = path.resolve(__dirname, "../emit-learning-checkpoint.ts");

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
      expect(parseYaml(content) as Record<string, unknown>).not.toHaveProperty(
        "schema_version",
      );
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

  // ── D-edge-batch: knowledge-links index append ────────────────────────────
  // Verifies the new Wave-2 wire: links passed to writeCheckpoint are appended
  // to `.guild/indexes/knowledge-links.json` (append-only, dedup, VC-K7).

  describe("knowledge-links index append (D-edge-batch)", () => {
    const LINK_A: KnowledgeLink = {
      from: `task:${RUN}`,
      to: "decision:adr-001",
      type: "decided_by",
      run_id: RUN,
    };
    const LINK_B: KnowledgeLink = {
      from: "task:other",
      to: "skill:guild:new-skill",
      type: "produced",
      run_id: RUN,
    };

    function indexPath(r: string): string {
      return path.join(r, ".guild", "indexes", "knowledge-links.json");
    }
    function readIndex(r: string): { schema_version: string; links: KnowledgeLink[] } {
      return JSON.parse(fs.readFileSync(indexPath(r), "utf8")) as {
        schema_version: string;
        links: KnowledgeLink[];
      };
    }

    it("writes knowledge-links.json with guild.knowledge_links.v1 schema when links provided", () => {
      writeCheckpoint({
        runId: RUN, phase: "development", evidenceRef: "none",
        guildRoot: root, knowledgeLinksBatch: [LINK_A],
      });
      expect(fs.existsSync(indexPath(root))).toBe(true);
      const idx = readIndex(root);
      expect(idx.schema_version).toBe("guild.knowledge_links.v1");
      expect(idx.links).toHaveLength(1);
      expect(idx.links[0]).toMatchObject({ from: LINK_A.from, to: LINK_A.to, type: LINK_A.type });
    });

    it("accumulates links across two writeCheckpoint calls (different phases)", () => {
      writeCheckpoint({
        runId: RUN, phase: "planning", evidenceRef: "none",
        guildRoot: root, knowledgeLinksBatch: [LINK_A],
      });
      writeCheckpoint({
        runId: RUN, phase: "development", evidenceRef: "none",
        guildRoot: root, knowledgeLinksBatch: [LINK_B],
      });
      const idx = readIndex(root);
      expect(idx.links).toHaveLength(2);
    });

    it("deduplicates by {from,to,type} — same edge in two phases counts once", () => {
      writeCheckpoint({
        runId: RUN, phase: "planning", evidenceRef: "none",
        guildRoot: root, knowledgeLinksBatch: [LINK_A],
      });
      // Same {from,to,type}, different run_id — still a dup
      const dupLink: KnowledgeLink = { ...LINK_A, run_id: "run-other" };
      writeCheckpoint({
        runId: RUN, phase: "development", evidenceRef: "none",
        guildRoot: root, knowledgeLinksBatch: [dupLink],
      });
      const idx = readIndex(root);
      expect(idx.links).toHaveLength(1);
    });

    it("does NOT create knowledge-links.json when batch is empty (empty no-op, VC-K7)", () => {
      writeCheckpoint({
        runId: RUN, phase: "development", evidenceRef: "none",
        guildRoot: root,
        // no knowledgeLinksBatch — defaults to []
      });
      expect(fs.existsSync(indexPath(root))).toBe(false);
    });

    it("rejects an edge with a wiki: node — cross-space guard (never-auto-promote, VC-K7)", () => {
      expect(() =>
        writeCheckpoint({
          runId: RUN, phase: "development", evidenceRef: "none",
          guildRoot: root,
          knowledgeLinksBatch: [{ from: "task:1", to: "wiki:x", type: "touches", run_id: RUN }],
        }),
      ).toThrow();
      // Index must NOT have been created (validation fires before any write)
      expect(fs.existsSync(indexPath(root))).toBe(false);
    });

    it("VALID_EDGE_TYPES has exactly 9 closed entries", () => {
      expect(VALID_EDGE_TYPES.length).toBe(9);
    });

    it("rejects an edge with an invalid type before touching the index (closed-9 gate)", () => {
      expect(() =>
        writeCheckpoint({
          runId: RUN, phase: "development", evidenceRef: "none",
          guildRoot: root,
          knowledgeLinksBatch: [
            { from: "a", to: "b", type: "not_a_valid_type" as never, run_id: RUN },
          ],
        }),
      ).toThrow();
      // Index must NOT have been created
      expect(fs.existsSync(indexPath(root))).toBe(false);
    });

    // ── Node-space separation (assertNodePrefixes) ─────────────────────────────
    // Edges whose from/to uses a forbidden cross-space prefix must be rejected
    // BEFORE any index write (same closed-set discipline as assertEdgeTypes).

    describe("node-space separation (assertNodePrefixes)", () => {
      it("rejects an edge with file: prefix on to", () => {
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "task:1", to: "file:src/index.ts", type: "touches", run_id: RUN },
            ],
          }),
        ).toThrow(/file:/);
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("rejects an edge with domain: prefix on to", () => {
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "task:1", to: "domain:auth", type: "touches", run_id: RUN },
            ],
          }),
        ).toThrow(/domain:/);
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("rejects an edge with component: prefix on to", () => {
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "task:1", to: "component:scrubber", type: "touches", run_id: RUN },
            ],
          }),
        ).toThrow(/component:/);
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("rejects an edge with forbidden prefix on from (not just to)", () => {
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "wiki:some-page", to: "decision:adr-001", type: "decided_by", run_id: RUN },
            ],
          }),
        ).toThrow(/wiki:/);
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("rejects an edge with an unknown prefix on from (allowlist — not just denylist)", () => {
        // "other:x" is not a forbidden prefix but is also not in ALLOWED_NODE_PREFIXES
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "other:x", to: "decision:adr-001", type: "decided_by", run_id: RUN },
            ],
          }),
        ).toThrow();
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("rejects a bare no-prefix node id (allowlist gate)", () => {
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: [
              { from: "bare-id", to: "decision:adr-001", type: "decided_by", run_id: RUN },
            ],
          }),
        ).toThrow();
        expect(fs.existsSync(indexPath(root))).toBe(false);
      });

      it("accepts edges with all 6 allowed node prefixes without throwing", () => {
        const validLinks: KnowledgeLink[] = [
          { from: "task:t1", to: "run:r1", type: "touches", run_id: RUN },
          { from: "decision:d1", to: "skill:guild:new-skill", type: "decided_by", run_id: RUN },
          { from: "agent:backend", to: "feature:auth", type: "produced", run_id: RUN },
        ];
        expect(() =>
          writeCheckpoint({
            runId: RUN, phase: "development", evidenceRef: "none",
            guildRoot: root,
            knowledgeLinksBatch: validLinks,
          }),
        ).not.toThrow();
      });

      it("FORBIDDEN_NODE_PREFIXES has exactly 4 entries", () => {
        expect(FORBIDDEN_NODE_PREFIXES.length).toBe(4);
      });

      it("ALLOWED_NODE_PREFIXES has exactly 6 entries", () => {
        expect(ALLOWED_NODE_PREFIXES.length).toBe(6);
      });
    });
  });

  // ── CLI — GUILD_CHECKPOINT_LINKS env wire ─────────────────────────────────

  describe("CLI — GUILD_CHECKPOINT_LINKS wiring", () => {
    function spawnCLI(
      r: string,
      extra: Record<string, string | undefined> = {},
    ): { status: number | null; stdout: string; stderr: string } {
      const res = spawnSync("npx", ["tsx", SCRIPT], {
        encoding: "utf8",
        env: {
          ...process.env,
          GUILD_RUN_ID: RUN,
          GUILD_PHASE: "development",
          GUILD_EVIDENCE_REF: "none",
          GUILD_CWD: r,
          ...extra,
        },
        timeout: 30000,
      });
      return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    }

    it("reads links from GUILD_CHECKPOINT_LINKS and serializes them in the checkpoint YAML", () => {
      const linksFile = path.join(root, "links.json");
      const links: KnowledgeLink[] = [
        { from: `task:${RUN}`, to: "decision:adr-cli", type: "decided_by", run_id: RUN },
      ];
      fs.writeFileSync(linksFile, JSON.stringify(links), "utf8");

      const { status } = spawnCLI(root, { GUILD_CHECKPOINT_LINKS: linksFile });
      expect(status).toBe(0);

      const yamlPath = path.join(root, ".guild", "runs", RUN, "learning", `development-${RUN}.yaml`);
      const yaml = fs.readFileSync(yamlPath, "utf8");
      expect(yaml).toContain("decided_by");
      expect(yaml).not.toContain("knowledge_links_batch: []");
    });

    it("appends links to knowledge-links.json when GUILD_CHECKPOINT_LINKS is set", () => {
      const linksFile = path.join(root, "links.json");
      const links: KnowledgeLink[] = [
        { from: "run:x", to: "decision:d1", type: "learned_from", run_id: RUN },
      ];
      fs.writeFileSync(linksFile, JSON.stringify(links), "utf8");

      spawnCLI(root, { GUILD_CHECKPOINT_LINKS: linksFile });

      const indexFile = path.join(root, ".guild", "indexes", "knowledge-links.json");
      expect(fs.existsSync(indexFile)).toBe(true);
      const idx = JSON.parse(fs.readFileSync(indexFile, "utf8")) as { links: KnowledgeLink[] };
      expect(idx.links.some((l) => l.type === "learned_from")).toBe(true);
    });

    it("is a safe no-op when GUILD_CHECKPOINT_LINKS is absent (back-compat)", () => {
      const { status } = spawnCLI(root); // no GUILD_CHECKPOINT_LINKS
      expect(status).toBe(0);

      const yamlPath = path.join(root, ".guild", "runs", RUN, "learning", `development-${RUN}.yaml`);
      const yaml = fs.readFileSync(yamlPath, "utf8");
      expect(yaml).toContain("knowledge_links_batch: []");

      const indexFile = path.join(root, ".guild", "indexes", "knowledge-links.json");
      expect(fs.existsSync(indexFile)).toBe(false);
    });
  });

  // ── VC-K4 (strengthened): GUILD_CHECKPOINT_ARTIFACTS_JSON producer path ───
  // METRIC 1b — proves classifyPhase() is actually WIRED into the emit hook.
  // The original happy-path tests only proved the all-none DEFAULT. This block
  // drives the real producer path: a serialized ArtifactSet WHERE SIGNALS ARE
  // PRESENT must yield non-`none` decisions in the emitted YAML — so the test is
  // NOT vacuously all-none, and a regression that unwires the classifier (or
  // makes classifyPhase return all-none) flips this RED.

  describe("CLI — GUILD_CHECKPOINT_ARTIFACTS_JSON classifier wiring (VC-K4 / METRIC 1b)", () => {
    function spawnClassify(
      r: string,
      artifacts: Record<string, unknown>,
      extra: Record<string, string | undefined> = {},
    ): { status: number | null; stdout: string; stderr: string } {
      const artifactsFile = path.join(r, "artifacts.json");
      fs.writeFileSync(artifactsFile, JSON.stringify(artifacts), "utf8");
      const res = spawnSync("npx", ["tsx", SCRIPT], {
        encoding: "utf8",
        env: {
          ...process.env,
          GUILD_RUN_ID: RUN,
          GUILD_PHASE: "development",
          GUILD_EVIDENCE_REF: "none",
          GUILD_CWD: r,
          GUILD_CHECKPOINT_ARTIFACTS_JSON: artifactsFile,
          ...extra,
        },
        timeout: 30000,
      });
      return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
    }

    function readEmittedDecisions(r: string): Record<string, string> {
      const yamlPath = path.join(
        r, ".guild", "runs", RUN, "learning", `development-${RUN}.yaml`,
      );
      const parsed = parseYaml(fs.readFileSync(yamlPath, "utf8")) as {
        learning_checkpoint?: { decisions?: Record<string, string> };
      } | null;
      return parsed?.learning_checkpoint?.decisions ?? {};
    }

    it("classifies a signal-rich ArtifactSet → machine-derivable targets are NON-'none' (not vacuously all-none)", () => {
      // An ArtifactSet that trips the deterministic, machine-derivable signatures
      // (provenance.touched.* + classifyProposalInput) — no NL-regex reliance.
      // Verdict forms are contract-driven (§2 :63-64):
      //   knowledge_graph → "refresh:<classifier-state>"   (NOT "re-derive")
      //   domain_model    → "re-derive"                    (NOT "refresh:stale")
      const artifacts = {
        runId: RUN,
        provenanceTouched: {
          decisions: ["decision:adr-77"],            // → memory: candidate:<ref>
          wiki: [".guild/wiki/decisions/adr-77.md"], // → wiki: candidate:<ref>
          initiatives: ["initiative:learning-tier"], // → knowledge_graph: refresh:<state>
          config_keys: ["models.tiers.cheap"],       // → config: proposal:<key>
          tasks: ["TASK-9"],                         // → task_tracking (with done handoff)
          // domain_model signal: domain-graph index touched → re-derive
          files: [".guild/indexes/domain-graph.json"],
        },
        handoffBlocks: [{ status: "done" }],
        classifyProposalInput: {                     // → agent_template + skill_template
          distinct_subject_count: 3,
          same_run: false,
          same_signature: true,
          user_approved: true,
        },
      };

      const { status } = spawnClassify(root, artifacts);
      expect(status).toBe(0);

      const decisions = readEmittedDecisions(root);

      // The 12-key shape is intact…
      expect(Object.keys(decisions).sort()).toEqual([...DECISION_TARGETS].sort());

      // …and the machine-derivable targets fired (NON-vacuous proof of wiring).
      // Verdict forms match contract §2 exactly.
      expect(decisions["memory"]).toBe("candidate:decision:adr-77");
      expect(decisions["wiki"]).toBe("candidate:.guild/wiki/decisions/adr-77.md");
      expect(decisions["knowledge_graph"]).toBe("refresh:initiative-touched");
      expect(decisions["domain_model"]).toBe("re-derive");
      expect(decisions["config"]).toBe("proposal:models.tiers.cheap");
      expect(decisions["task_tracking"]).toBe("update:TASK-9");
      expect(decisions["agent_template"]).toBe("systemic-proposal");
      expect(decisions["skill_template"]).toBe("systemic-proposal");

      // Sanity: at least one target is still `none` — proves the classifier
      // discriminates and does not blanket-fire every key.
      const noneCount = Object.values(decisions).filter((v) => v === "none").length;
      expect(noneCount).toBeGreaterThan(0);
    });

    it("routes the non-none verdicts to the reflections queue (VC-K7 — proves the emit side-effect ran)", () => {
      spawnClassify(root, {
        runId: RUN,
        provenanceTouched: { decisions: ["decision:adr-77"], config_keys: ["x.y"] },
      });
      const ref = reflectionsPath(root, RUN);
      expect(fs.existsSync(ref)).toBe(true);
      const body = fs.readFileSync(ref, "utf8");
      expect(body).toContain("memory");
      expect(body).toContain("config");
    });

    it("is a true classifier (anti-vacuity control): an empty-signal ArtifactSet → all-'none'", () => {
      // Same producer path, ZERO signals → the classifier must yield all-none.
      // Pairs with the signal-rich case above: the ONLY difference is the input
      // signals, so the non-none result there cannot be a constant.
      const { status } = spawnClassify(root, { runId: RUN });
      expect(status).toBe(0);
      const decisions = readEmittedDecisions(root);
      expect(Object.keys(decisions).sort()).toEqual([...DECISION_TARGETS].sort());
      for (const v of Object.values(decisions)) expect(v).toBe("none");
      // No non-none verdicts ⇒ no reflections queue file (VC-K7).
      expect(fs.existsSync(reflectionsPath(root, RUN))).toBe(false);
    });

    it("a pre-written GUILD_CHECKPOINT_VERDICT wins over the ArtifactSet classify path", () => {
      // Precedence guard: when both env vars are present, the explicit verdict
      // file is used (the SK-13 seam), NOT the in-process classify.
      const verdictFile = path.join(root, "verdict.json");
      const verdict: CheckpointDecisions = {
        ...ALL_NONE_DECISIONS,
        wiki: "candidate:.guild/wiki/explicit.md",
      };
      fs.writeFileSync(verdictFile, JSON.stringify(verdict), "utf8");

      // ArtifactSet would classify memory=candidate, but the explicit verdict
      // (wiki only) must win.
      spawnClassify(
        root,
        { runId: RUN, provenanceTouched: { decisions: ["decision:should-not-win"] } },
        { GUILD_CHECKPOINT_VERDICT: verdictFile },
      );
      const decisions = readEmittedDecisions(root);
      expect(decisions["wiki"]).toBe("candidate:.guild/wiki/explicit.md");
      expect(decisions["memory"]).toBe("none"); // ArtifactSet path was NOT used
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
