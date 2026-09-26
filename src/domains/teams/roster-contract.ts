/** Public, module-owned roster shapes consumed by team composition. */
export type Tier = "cheap" | "mid" | "powerful";
export type RosterSource = "shipped" | "project" | "template";

export interface RosterAgentEntry {
  name: string;
  source: RosterSource;
  definition: string;
  definition_abs: string;
  description: string | null;
  when_to_use: string | null;
  model: string | null;
  default_tier: Tier;
  tools: string[] | null;
  skills: string[];
  derived_from_template: string | null;
  specialist_type: string | null;
  host_preference: string | null;
  model_params: Record<string, unknown> | null;
  owns: string[];
  external_skills: string[];
  reusable_in: string[];
  consistency_source: string | null;
  overrides_shipped: boolean;
  augmenting: boolean;
}

export interface RosterSkillEntry {
  id: string;
  file: string;
  name: string | null;
  description: string | null;
  type: string | null;
  used_by: string[];
  external_skills: string[];
  consistency_source: string | null;
}

export interface RosterResolution {
  schema_version: "guild.roster.v1";
  plugin_root: string;
  project_root: string;
  shipped: RosterAgentEntry[];
  project: RosterAgentEntry[];
  templates: RosterAgentEntry[];
  roster: RosterAgentEntry[];
  project_skills: RosterSkillEntry[];
  warnings: string[];
}
