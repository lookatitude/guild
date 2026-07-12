/**
 * scripts/lib/roster.ts
 *
 * Deterministic specialist-roster resolution (guild.roster.v1).
 *
 * The D4 anti-drift rule (specialist-roster ADR; docs/v2/10-factory-evolution.md)
 * says the roster is "enumerated from the filesystem + agent frontmatter — never
 * from a hand-maintained list". Until now that enumeration existed only as skill
 * prose executed by the model. This library is the code-backed implementation:
 *
 *   shipped roster   = <pluginRoot>/agents/*.md            (read-only library)
 *   project roster   = <projectRoot>/.guild/agents/*.md    (minted instances;
 *                       the `proposed/` incubation tree is NEVER a candidate)
 *   merged roster    = union, project wins on a name collision (a project
 *                       instance may specialize a shipped type)
 *
 * It also derives the registry projections:
 *
 *   .guild/agents/registry.yaml   (guild.agents_registry.v1)
 *   .guild/skills/registry.yaml   (guild.skills_registry.v1)
 *
 * The registries are DERIVED INDEXES of the *.md / SKILL.md trees — the files
 * remain the source of truth. deriveRegistry never clobbers a hand-authored
 * registry: it only writes when the target is absent, empty, or carries the
 * roster-resolve generated marker (or when force is passed).
 */

import * as fs from "fs";
import * as path from "path";

const yaml = require("js-yaml") as {
  load: (s: string) => unknown;
  dump: (o: unknown, opts?: Record<string, unknown>) => string;
};

// ── Types ──────────────────────────────────────────────────────────────────

export type Tier = "cheap" | "mid" | "powerful";
export type RosterSource = "shipped" | "project";

/**
 * The three augmenting registered agents (canonical-specialist-roster ADR: the
 * 17-agent split = 14 product specialists + these). They stay in the roster
 * (they are real, dispatchable registered agents) but are flagged
 * `augmenting: true` so guild:team-compose excludes them from domain matching
 * and the cap-6 count.
 */
export const AUGMENTING_AGENT_IDS = new Set(["advisor", "developer", "doc-writer"]);

export interface RosterAgentEntry {
  name: string;
  source: RosterSource;
  /** Path to the agent definition file, relative to its root (pluginRoot for shipped, projectRoot for project). */
  definition: string;
  /** Absolute path to the definition file. */
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
  /** true on a project entry whose name collides with a shipped type (the project instance wins in the merged roster). */
  overrides_shipped: boolean;
  /**
   * true for the augmenting registered types (advisor/developer/doc-writer):
   * kept in the roster for dispatch, excluded from team-compose domain
   * matching and the cap-6 count (canonical-specialist-roster ADR).
   */
  augmenting: boolean;
}

export interface RosterSkillEntry {
  id: string;
  /** Path relative to projectRoot. */
  file: string;
  name: string | null;
  description: string | null;
}

export interface RosterResolution {
  schema_version: "guild.roster.v1";
  plugin_root: string;
  project_root: string;
  shipped: RosterAgentEntry[];
  project: RosterAgentEntry[];
  /** Union of shipped + project; project wins on name collision. */
  roster: RosterAgentEntry[];
  /** Project-local skills under .guild/skills/<id>/SKILL.md (proposed-* excluded). */
  project_skills: RosterSkillEntry[];
  warnings: string[];
}

// ── Frontmatter ────────────────────────────────────────────────────────────

export function parseFrontmatter(raw: string): Record<string, unknown> | null {
  if (!raw.startsWith("---")) return null;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return null;
  const block = raw.slice(raw.indexOf("\n") + 1, end);
  try {
    const parsed = yaml.load(block);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function asStringList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string").map((s) => s.trim());
  }
  if (typeof v === "string" && v.trim().length > 0) {
    // "Read, Write, Edit" flow shape used by shipped agents' `tools:` line.
    return v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

// Cost-aware-tiering §1 ladder: opus=powerful, sonnet=mid, haiku=cheap.
// Explicit `default_tier:` frontmatter always wins over the model mapping.
export function tierForModel(model: string | null): Tier | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes("opus")) return "powerful";
  if (m.includes("sonnet")) return "mid";
  if (m.includes("haiku")) return "cheap";
  return null;
}

// ── Enumeration ────────────────────────────────────────────────────────────

function listAgentFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

function readAgentEntry(
  root: string,
  relPath: string,
  source: RosterSource,
  warnings: string[]
): RosterAgentEntry | null {
  const abs = path.join(root, relPath);
  let raw: string;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch {
    warnings.push(`unreadable agent file skipped: ${relPath}`);
    return null;
  }
  const fm = parseFrontmatter(raw);
  if (!fm) {
    warnings.push(`agent file without parseable frontmatter skipped: ${relPath}`);
    return null;
  }
  const name = asString(fm["name"]) ?? path.basename(relPath, ".md");
  const model = asString(fm["model"]);
  const explicitTier = asString(fm["default_tier"]);
  const tier: Tier =
    explicitTier === "cheap" || explicitTier === "mid" || explicitTier === "powerful"
      ? explicitTier
      : tierForModel(model) ?? "mid";
  const modelParams = fm["model_params"];
  return {
    name,
    source,
    definition: relPath,
    definition_abs: abs,
    description: asString(fm["description"]),
    when_to_use: asString(fm["when_to_use"]),
    model,
    default_tier: tier,
    tools: fm["tools"] !== undefined ? asStringList(fm["tools"]) : null,
    skills: asStringList(fm["skills"]),
    derived_from_template: asString(fm["derived_from_template"]),
    specialist_type: asString(fm["specialist_type"]),
    host_preference: asString(fm["host_preference"]),
    model_params:
      modelParams && typeof modelParams === "object" && !Array.isArray(modelParams)
        ? (modelParams as Record<string, unknown>)
        : null,
    overrides_shipped: false,
    augmenting: AUGMENTING_AGENT_IDS.has(name),
  };
}

function listProjectSkills(projectRoot: string): RosterSkillEntry[] {
  const skillsDir = path.join(projectRoot, ".guild", "skills");
  if (!fs.existsSync(skillsDir)) return [];
  const entries: RosterSkillEntry[] = [];
  for (const e of fs.readdirSync(skillsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    // `proposed-*` is the create-skill incubation shape — never a candidate.
    if (!e.isDirectory() || e.name.startsWith("proposed")) continue;
    const skillMd = path.join(skillsDir, e.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    const fm = parseFrontmatter(fs.readFileSync(skillMd, "utf8")) ?? {};
    entries.push({
      id: e.name,
      file: path.join(".guild", "skills", e.name, "SKILL.md"),
      name: asString(fm["name"]),
      description: asString(fm["description"]),
    });
  }
  return entries;
}

export function resolveRoster(opts: {
  projectRoot: string;
  pluginRoot: string;
}): RosterResolution {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const warnings: string[] = [];

  const shipped: RosterAgentEntry[] = [];
  for (const f of listAgentFiles(path.join(pluginRoot, "agents"))) {
    const entry = readAgentEntry(pluginRoot, path.join("agents", f), "shipped", warnings);
    if (entry) shipped.push(entry);
  }

  // Project agents: top-level *.md only — `.guild/agents/proposed/` (incubation)
  // and `_shared/` are never candidates.
  const project: RosterAgentEntry[] = [];
  const shippedNames = new Set(shipped.map((s) => s.name));
  for (const f of listAgentFiles(path.join(projectRoot, ".guild", "agents"))) {
    const entry = readAgentEntry(
      projectRoot,
      path.join(".guild", "agents", f),
      "project",
      warnings
    );
    if (!entry) continue;
    entry.overrides_shipped = shippedNames.has(entry.name);
    project.push(entry);
  }

  const byName = new Map<string, RosterAgentEntry>();
  for (const s of shipped) byName.set(s.name, s);
  for (const p of project) {
    if (byName.has(p.name)) {
      warnings.push(
        `project specialist '${p.name}' overrides the shipped type of the same name (project wins)`
      );
    }
    byName.set(p.name, p);
  }

  return {
    schema_version: "guild.roster.v1",
    plugin_root: pluginRoot,
    project_root: projectRoot,
    shipped,
    project,
    roster: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    project_skills: listProjectSkills(projectRoot),
    warnings,
  };
}

// ── Derived registries ─────────────────────────────────────────────────────

export const GENERATED_MARKER = "generated_by: guild.roster_resolve.v1";

export interface DeriveResult {
  path: string;
  action: "written" | "unchanged" | "refused";
  reason?: string;
}

function registryDoc(header: string[], key: "agents" | "skills", items: unknown[]): string {
  const head = header.map((l) => `# ${l}`).join("\n");
  const body =
    items.length === 0
      ? `${key}: []\n`
      : yaml.dump({ [key]: items }, { lineWidth: 100, noRefs: true });
  return `${head}\n${body}`;
}

function pruneNulls(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * A registry target is safely writable when it is absent, effectively empty
 * (an empty doc, or ONLY the expected key holding an empty/null list — the
 * init scaffold shape), or was generated by this tool (GENERATED_MARKER as a
 * real comment line, not a substring anywhere). Anything else — entries under
 * the expected key, unknown keys, unparseable content — is treated as
 * hand-authored and never clobbered without force. Symlinked targets (or a
 * containing dir whose realpath escapes the project root) are always refused:
 * a symlink could redirect the write outside `.guild/`.
 */
function writable(
  target: string,
  key: "agents" | "skills",
  projectRoot: string
): { ok: boolean; reason?: string; hard?: boolean } {
  // hard: path-safety refusal — force must NEVER override these (a symlink or
  // an escaping ancestor would redirect the write outside the project's
  // .guild/). Soft refusals are content-clobber protection only.
  const refuseHard = (why: string) => ({
    ok: false,
    hard: true,
    reason: `${target} ${why} — refusing to write (not overridable by force)`,
  });
  const refuse = (why: string) => ({
    ok: false,
    reason: `${target} ${why} — refusing to overwrite (pass force to override)`,
  });

  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink()) return refuseHard("is a symlink");
  // The containing dir — or ANY ancestor, including a not-yet-created
  // .guild/agents whose parent .guild is a symlink — may redirect the write.
  // Walk up to the nearest EXISTING ancestor and require its realpath to stay
  // under the resolved project root.
  let ancestor = path.dirname(target);
  while (!fs.existsSync(ancestor)) {
    const up = path.dirname(ancestor);
    if (up === ancestor) break;
    ancestor = up;
  }
  if (fs.existsSync(ancestor)) {
    const realDir = fs.realpathSync(ancestor);
    const realRoot = fs.realpathSync(projectRoot);
    if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) {
      return refuseHard(`resolves outside the project root (${realDir})`);
    }
  }
  if (!st) return { ok: true };
  if (!st.isFile()) return refuseHard("is not a regular file");

  const raw = fs.readFileSync(target, "utf8");
  // Marker must be an actual generated-header comment line, not a substring
  // buried in hand-authored content.
  if (new RegExp(`^#\\s*${GENERATED_MARKER}\\s*$`, "m").test(raw)) return { ok: true };
  try {
    const parsed = yaml.load(raw) as unknown;
    if (parsed === null || parsed === undefined) return { ok: true };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return refuse("has an unexpected document shape");
    }
    const keys = Object.keys(parsed as Record<string, unknown>);
    const list = (parsed as Record<string, unknown>)[key];
    const emptyList = list === null || (Array.isArray(list) && list.length === 0);
    if (keys.every((k) => k === key) && (keys.length === 0 || emptyList)) {
      return { ok: true };
    }
  } catch {
    // Unparseable and not ours — treat as hand-authored.
  }
  return refuse(`has hand-authored content and no '${GENERATED_MARKER}' marker line`);
}

export function deriveAgentsRegistry(
  resolution: RosterResolution,
  opts: { force?: boolean; dryRun?: boolean } = {}
): DeriveResult {
  const target = path.join(resolution.project_root, ".guild", "agents", "registry.yaml");
  const items = resolution.project.map((a) =>
    pruneNulls({
      id: a.name,
      file: a.definition,
      model: a.model,
      model_params: a.model_params,
      host_preference: a.host_preference,
      default_tier: a.default_tier,
      specialist_type: a.specialist_type,
      derived_from_template: a.derived_from_template,
      skills: a.skills,
      overrides_shipped: a.overrides_shipped ? true : undefined,
    })
  );
  const doc = registryDoc(
    [
      "schema_version: guild.agents_registry.v1",
      GENERATED_MARKER,
      "DERIVED INDEX of .guild/agents/*.md — the .md files are the source of truth (D4).",
      "Regenerate with: roster-resolve.ts --cwd <root> --write-registry. Do not hand-edit.",
    ],
    "agents",
    items
  );
  return writeDerived(target, doc, "agents", resolution.project_root, opts);
}

export function deriveSkillsRegistry(
  resolution: RosterResolution,
  opts: { force?: boolean; dryRun?: boolean } = {}
): DeriveResult {
  const target = path.join(resolution.project_root, ".guild", "skills", "registry.yaml");
  const items = resolution.project_skills.map((s) =>
    pruneNulls({ id: s.id, file: s.file, name: s.name, description: s.description })
  );
  const doc = registryDoc(
    [
      "schema_version: guild.skills_registry.v1",
      GENERATED_MARKER,
      "DERIVED INDEX of .guild/skills/*/SKILL.md — the SKILL.md files are the source of truth (D4).",
      "Regenerate with: roster-resolve.ts --cwd <root> --write-registry. Do not hand-edit.",
    ],
    "skills",
    items
  );
  return writeDerived(target, doc, "skills", resolution.project_root, opts);
}

function writeDerived(
  target: string,
  doc: string,
  key: "agents" | "skills",
  projectRoot: string,
  opts: { force?: boolean; dryRun?: boolean }
): DeriveResult {
  const w = writable(target, key, projectRoot);
  // force overrides content-clobber refusals only; path-safety refusals
  // (symlink / non-regular file / realpath escape) are never overridable.
  if (!w.ok && (w.hard || !opts.force)) {
    return { path: target, action: "refused", reason: w.reason };
  }
  if (fs.existsSync(target) && fs.readFileSync(target, "utf8") === doc) {
    return { path: target, action: "unchanged" };
  }
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, doc, "utf8");
  }
  return { path: target, action: "written" };
}
