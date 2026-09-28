/**
 * Backward-compatible public entrypoint.
 *
 * Learning signatures live in src/modules/evolution so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  classifyMemory,
  classifyWiki,
  classifyKnowledgeGraph,
  classifyDomainModel,
  classifyAgentDef,
  classifySkillDef,
  classifyAgentTemplate,
  classifySkillTemplate,
  classifyConfig,
  classifyTaskTracking,
  classifyWorkflowRules,
  classifyReviewPolicy,
  classifyPhase,
  type ArtifactSet,
  type HandoffV2Block,
  type ProvenanceTouched,
  type Verdict,
  type PhaseVerdict,
} from "../../src/domains/evolve/index";
