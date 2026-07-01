/**
 * src/modules/intake/workflows/prompt-intake.ts
 *
 * Deterministic ambient prompt routing for ordinary host prompts. This extends
 * the older product_loop|other classifier into a phase router that can decide
 * whether Guild has enough information to draft a spec/plan or should route
 * the user to the missing lifecycle phase.
 */

import { classifyIntake, type IntakeSignal } from "./classify-intake";

export const PROMPT_INTAKE_SCHEMA_VERSION = "guild.prompt_intake.v1" as const;

export type LifecyclePhase = "init" | "ideate" | "plan" | "build" | "qa" | "ops" | "none";
export type PromptIntent =
  | "product_idea"
  | "feature_request"
  | "implementation_request"
  | "qa_request"
  | "operations_request"
  | "research_request"
  | "unrelated";
export type ProjectKnowledgeState =
  | "empty_project"
  | "existing_project_needs_learn"
  | "workspace_needs_federation"
  | "sufficient"
  | "unknown";
export type FeatureMaturity =
  | "rough_idea"
  | "spec_draftable"
  | "goals_needed"
  | "plan_draftable"
  | "implementation_ready"
  | "qa_ready"
  | "ops_ready"
  | "unrelated";
export type WorkflowModality =
  | "web"
  | "mobile"
  | "desktop_installable"
  | "backend_service"
  | "cli_library"
  | "docs_content"
  | "infra_devops"
  | "generic";
export type ProposedNextAction =
  | "ask_init_questions"
  | "run_brownfield_learn"
  | "run_workspace_federation_learn"
  | "run_ideation"
  | "draft_spec_for_approval"
  | "draft_goals_and_plan_for_approval"
  | "ask_plan_approval_before_build"
  | "run_quality"
  | "run_operations"
  | "continue_normal_host_handling";

export interface PromptIntakeContext {
  /** Repo has no meaningful code/docs/product facts yet. */
  emptyProject?: boolean;
  /** Repo has code/docs but Guild has not learned enough to ground a spec. */
  existingProject?: boolean;
  /** Current cwd is a workspace root whose feature may span children. */
  workspace?: boolean;
  /** Project/domain context is already available through wiki/KG/memory/docs. */
  hasProjectKnowledge?: boolean;
  /** Approved or draft spec exists for this request. */
  hasSpec?: boolean;
  /** Approved plan exists for this request. */
  hasPlan?: boolean;
  /** Development receipts/verify output exist. */
  hasDevelopmentOutput?: boolean;
}

export interface InferredPromptFields {
  summary: string;
  acceptance_criteria: string[];
  affected_surfaces: string[];
  modality: WorkflowModality;
}

export interface PromptIntakeV1 {
  schema_version: typeof PROMPT_INTAKE_SCHEMA_VERSION;
  intent: PromptIntent;
  target_phase: LifecyclePhase;
  project_knowledge: ProjectKnowledgeState;
  feature_maturity: FeatureMaturity;
  confidence: number;
  evidence_refs: string[];
  inferred: InferredPromptFields;
  missing_info: string[];
  proposed_next_action: ProposedNextAction;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const PHASES: LifecyclePhase[] = ["init", "ideate", "plan", "build", "qa", "ops", "none"];
const INTENTS: PromptIntent[] = [
  "product_idea",
  "feature_request",
  "implementation_request",
  "qa_request",
  "operations_request",
  "research_request",
  "unrelated",
];
const KNOWLEDGE_STATES: ProjectKnowledgeState[] = [
  "empty_project",
  "existing_project_needs_learn",
  "workspace_needs_federation",
  "sufficient",
  "unknown",
];
const MATURITIES: FeatureMaturity[] = [
  "rough_idea",
  "spec_draftable",
  "goals_needed",
  "plan_draftable",
  "implementation_ready",
  "qa_ready",
  "ops_ready",
  "unrelated",
];
const MODALITIES: WorkflowModality[] = [
  "web",
  "mobile",
  "desktop_installable",
  "backend_service",
  "cli_library",
  "docs_content",
  "infra_devops",
  "generic",
];
const NEXT_ACTIONS: ProposedNextAction[] = [
  "ask_init_questions",
  "run_brownfield_learn",
  "run_workspace_federation_learn",
  "run_ideation",
  "draft_spec_for_approval",
  "draft_goals_and_plan_for_approval",
  "ask_plan_approval_before_build",
  "run_quality",
  "run_operations",
  "continue_normal_host_handling",
];

function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/\s+/g, " ").trim();
}

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

function excerpt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").slice(0, 180);
}

export function classifyWorkflowModality(prompt: unknown): WorkflowModality {
  if (typeof prompt !== "string" || prompt.trim() === "") return "generic";
  const text = normalize(prompt);
  if (has(text, /\b(?:ios|android|react native|expo|swiftui|kotlin|mobile app|simulator|app store|play store)\b/)) {
    return "mobile";
  }
  if (has(text, /\b(?:desktop app|electron|tauri|installer|installable|notariz|signed binary|windows app|mac app|pkg|dmg|msi)\b/)) {
    return "desktop_installable";
  }
  if (has(text, /\b(?:deploy|release|rollback|incident|monitoring|slo|alert|terraform|kubernetes|ci\/cd|pipeline|infra)\b/)) {
    return "infra_devops";
  }
  if (has(text, /\b(?:api|service|backend|server|worker|queue|database|postgres|graphql|rest|endpoint)\b/)) {
    return "backend_service";
  }
  if (has(text, /\b(?:cli|command line|library|sdk|package|npm|binary)\b/)) {
    return "cli_library";
  }
  if (has(text, /\b(?:docs|documentation|guide|mdx|copy|content|website page|landing page)\b/)) {
    return "docs_content";
  }
  if (has(text, /\b(?:web app|website|browser|frontend|react|astro|next\.?js|vue|svelte|dashboard|page)\b/)) {
    return "web";
  }
  return "generic";
}

export function shouldRecommendInitiative(input: {
  projectCount?: number;
  goalCount?: number;
  taskCount?: number;
  expectedMultiSession?: boolean;
}): boolean {
  return (
    (input.projectCount ?? 1) > 1 ||
    (input.goalCount ?? 0) >= 2 ||
    (input.taskCount ?? 0) > 6 ||
    input.expectedMultiSession === true
  );
}

function projectKnowledgeState(ctx: PromptIntakeContext): ProjectKnowledgeState {
  if (ctx.workspace && !ctx.hasProjectKnowledge) return "workspace_needs_federation";
  if (ctx.emptyProject) return "empty_project";
  if (ctx.existingProject && !ctx.hasProjectKnowledge) return "existing_project_needs_learn";
  if (ctx.hasProjectKnowledge) return "sufficient";
  return "unknown";
}

function inferAcceptanceCriteria(prompt: string): string[] {
  const text = excerpt(prompt);
  const criteria: string[] = [];
  if (has(normalize(prompt), /\b(?:acceptance criteria|ac-|must|should|done when|success|criteria)\b/)) {
    criteria.push("Use the prompt's stated acceptance criteria as the initial AC set.");
  }
  if (has(normalize(prompt), /\b(?:test|tests|testing|verify|validation|validated)\b/)) {
    criteria.push("Validation evidence is defined and must be preserved in the plan.");
  }
  if (criteria.length === 0 && text !== "") {
    criteria.push(`Draft acceptance criteria from prompt: ${text}`);
  }
  return criteria;
}

function inferSurfaces(prompt: string, modality: WorkflowModality): string[] {
  const text = normalize(prompt);
  const surfaces: string[] = [];
  if (has(text, /\b(?:auth|login|signup|user)\b/)) surfaces.push("auth/user surface");
  if (has(text, /\b(?:dashboard|page|frontend|ui|screen)\b/)) surfaces.push("user interface");
  if (has(text, /\b(?:api|endpoint|backend|service)\b/)) surfaces.push("backend/API");
  if (has(text, /\b(?:docs|documentation|guide|mdx)\b/)) surfaces.push("docs/content");
  if (surfaces.length === 0) surfaces.push(modality === "generic" ? "to be confirmed" : modality);
  return surfaces;
}

function productSignalsToEvidence(signals: IntakeSignal[]): string[] {
  return signals.map((s) => `classify-intake:${s.id}`);
}

export function classifyPromptIntake(
  prompt: unknown,
  context: PromptIntakeContext = {},
): PromptIntakeV1 {
  const raw = typeof prompt === "string" ? prompt : "";
  const text = normalize(raw);
  const product = classifyIntake(raw);
  const modality = classifyWorkflowModality(raw);
  const knowledge = projectKnowledgeState(context);
  const evidenceRefs = productSignalsToEvidence(product.signals);

  let intent: PromptIntent = "unrelated";
  let targetPhase: LifecyclePhase = "none";
  let maturity: FeatureMaturity = "unrelated";
  let proposed: ProposedNextAction = "continue_normal_host_handling";
  let confidence = 0;
  const missingInfo: string[] = [];

  const hasOps = has(text, /\b(?:deploy|release|rollback|incident|monitoring|runbook|maintenance|slo|alert)\b/);
  const hasQa = has(text, /\b(?:qa|quality|test the app|browser test|simulator|smoke test|release readiness|e2e)\b/);
  const hasImplementation = has(text, /\b(?:implement|build|add|fix|refactor|change|update|wire|create)\b/);
  const hasPlanCue = has(text, /\b(?:plan|tasks?|break down|roadmap|milestones?|goals?)\b/);
  const hasSpecCue = has(text, /\b(?:acceptance criteria|requirements?|user stor(?:y|ies)|non-goals?|scope|success criteria|done when)\b/);
  const hasResearch = has(text, /\b(?:research|compare|investigate|explore options|market|best practices|alternatives)\b/);

  if (text === "") {
    missingInfo.push("prompt");
  } else if (hasQa) {
    intent = "qa_request";
    targetPhase = "qa";
    maturity = "qa_ready";
    proposed = "run_quality";
    confidence = 0.86;
    if (!context.hasDevelopmentOutput) missingInfo.push("development receipts or verify output");
  } else if (hasOps) {
    intent = "operations_request";
    targetPhase = "ops";
    maturity = "ops_ready";
    proposed = "run_operations";
    confidence = 0.9;
    if (!context.hasDevelopmentOutput) missingInfo.push("release candidate or current production state");
  } else if (knowledge === "workspace_needs_federation") {
    intent = product.intake === "product_loop" ? "product_idea" : "feature_request";
    targetPhase = "init";
    maturity = "rough_idea";
    proposed = "run_workspace_federation_learn";
    confidence = 0.82;
    missingInfo.push("workspace child ownership and cross-project impact");
  } else if (knowledge === "empty_project" && !hasSpecCue) {
    intent = product.intake === "product_loop" ? "product_idea" : "feature_request";
    targetPhase = "init";
    maturity = "rough_idea";
    proposed = "ask_init_questions";
    confidence = 0.78;
    missingInfo.push("project purpose, users, constraints, and initial success criteria");
  } else if (knowledge === "existing_project_needs_learn" && !context.hasSpec) {
    intent = product.intake === "product_loop" ? "product_idea" : "feature_request";
    targetPhase = "init";
    maturity = "rough_idea";
    proposed = "run_brownfield_learn";
    confidence = 0.8;
    missingInfo.push("grounded code/documentation understanding");
  } else if (product.intake === "product_loop" || hasResearch) {
    intent = hasResearch ? "research_request" : "product_idea";
    targetPhase = "ideate";
    maturity = "rough_idea";
    proposed = "run_ideation";
    confidence = product.intake === "product_loop" ? 0.84 : 0.74;
    missingInfo.push("approved spec");
  } else if (hasSpecCue && hasPlanCue) {
    intent = hasImplementation ? "implementation_request" : "feature_request";
    targetPhase = "plan";
    maturity = "plan_draftable";
    proposed = "draft_goals_and_plan_for_approval";
    confidence = 0.86;
    missingInfo.push("plan approval");
  } else if (hasSpecCue || context.hasSpec) {
    intent = "feature_request";
    targetPhase = "plan";
    maturity = "goals_needed";
    proposed = "draft_goals_and_plan_for_approval";
    confidence = 0.82;
    missingInfo.push("P.O.V.E.R. goals or ordered task groups");
  } else if (hasImplementation && context.hasPlan) {
    intent = "implementation_request";
    targetPhase = "build";
    maturity = "implementation_ready";
    proposed = "ask_plan_approval_before_build";
    confidence = 0.86;
    missingInfo.push("explicit implementation approval");
  } else if (hasImplementation) {
    intent = "feature_request";
    targetPhase = "ideate";
    maturity = "spec_draftable";
    proposed = "draft_spec_for_approval";
    confidence = 0.7;
    missingInfo.push("approved spec");
  }

  if (evidenceRefs.length === 0 && text !== "") evidenceRefs.push("prompt:heuristic");
  if (knowledge !== "unknown") evidenceRefs.push(`project_knowledge:${knowledge}`);
  if (modality !== "generic") evidenceRefs.push(`modality:${modality}`);

  return {
    schema_version: PROMPT_INTAKE_SCHEMA_VERSION,
    intent,
    target_phase: targetPhase,
    project_knowledge: knowledge,
    feature_maturity: maturity,
    confidence,
    evidence_refs: evidenceRefs,
    inferred: {
      summary: excerpt(raw),
      acceptance_criteria: intent === "unrelated" ? [] : inferAcceptanceCriteria(raw),
      affected_surfaces: intent === "unrelated" ? [] : inferSurfaces(raw, modality),
      modality,
    },
    missing_info: missingInfo,
    proposed_next_action: proposed,
  };
}

function requireEnum(errors: string[], obj: Record<string, unknown>, field: string, allowed: readonly string[]): void {
  if (typeof obj[field] !== "string" || !allowed.includes(obj[field] as string)) {
    errors.push(`${field} must be one of: ${allowed.join(", ")}`);
  }
}

function requireStringArray(errors: string[], obj: Record<string, unknown>, field: string): void {
  if (!Array.isArray(obj[field]) || !(obj[field] as unknown[]).every((v) => typeof v === "string")) {
    errors.push(`${field} must be an array of strings`);
  }
}

export function validatePromptIntakeV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["prompt intake artifact must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (o["schema_version"] !== PROMPT_INTAKE_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${PROMPT_INTAKE_SCHEMA_VERSION}"`);
  }
  requireEnum(errors, o, "intent", INTENTS);
  requireEnum(errors, o, "target_phase", PHASES);
  requireEnum(errors, o, "project_knowledge", KNOWLEDGE_STATES);
  requireEnum(errors, o, "feature_maturity", MATURITIES);
  requireEnum(errors, o, "proposed_next_action", NEXT_ACTIONS);
  if (typeof o["confidence"] !== "number" || o["confidence"] < 0 || o["confidence"] > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }
  requireStringArray(errors, o, "evidence_refs");
  requireStringArray(errors, o, "missing_info");
  const inferred = o["inferred"];
  if (typeof inferred !== "object" || inferred === null || Array.isArray(inferred)) {
    errors.push("inferred must be an object");
  } else {
    const i = inferred as Record<string, unknown>;
    if (typeof i["summary"] !== "string") errors.push("inferred.summary must be a string");
    requireStringArray(errors, i, "acceptance_criteria");
    requireStringArray(errors, i, "affected_surfaces");
    requireEnum(errors, i, "modality", MODALITIES);
  }
  return { valid: errors.length === 0, errors };
}

export function isPromptIntakeV1(value: unknown): value is PromptIntakeV1 {
  return validatePromptIntakeV1(value).valid;
}
