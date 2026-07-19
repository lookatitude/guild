/**
 * scripts/lib/roster.ts
 *
 * Deterministic specialist-roster resolution (guild.roster.v1).
 *
 * The D4 anti-drift rule (specialist-roster ADR; docs/v2/factory-evolution.html)
 * says the roster is "enumerated from the filesystem + agent frontmatter — never
 * from a hand-maintained list". Until now that enumeration existed only as skill
 * prose executed by the model. This library is the code-backed implementation:
 *
 *   shipped roster   = <pluginRoot>/agents/*.md            (MACHINERY agents only —
 *                       advisor/developer; the plugin ships no domain specialists
 *                       as registered agents)
 *   template library = <pluginRoot>/templates/specialists/*.md (the 15 domain
 *                       specialist TYPE templates — read-only feedstock, never
 *                       dispatched directly; minted into a project on demand)
 *   project roster   = <projectRoot>/.guild/agents/*.md    (minted instances;
 *                       the `proposed/` incubation tree is NEVER a candidate)
 *   merged roster    = shipped ∪ project, project wins on a name collision
 *                       (templates are NOT in the merged roster — only their
 *                       minted project instances are dispatchable)
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
// The ONE shared, js-yaml-backed frontmatter/YAML reader (OD-3): all reading
// goes through it — this file only DUMPS YAML directly.
import { parseFrontmatter, parseYaml } from "./frontmatter";

const yaml = require("js-yaml") as {
  dump: (o: unknown, opts?: Record<string, unknown>) => string;
};

// ── Types ──────────────────────────────────────────────────────────────────

export type Tier = "cheap" | "mid" | "powerful";
export type RosterSource = "shipped" | "project" | "template";

/**
 * The machinery agents the plugin ships as registered, dispatchable agents
 * (machinery-vs-template-library ADR): `advisor` (the powerful escalation
 * supervisor) and `developer` (the generic mid-tier lane worker). They stay in
 * the roster but are flagged `augmenting: true` so guild:team-compose excludes
 * them from domain matching and the cap-6 count. Every DOMAIN specialist
 * (architect, backend, … — formerly shipped agents, including doc-writer) is a
 * template under templates/specialists/, minted into the consuming repo's
 * .guild/agents/ before it can join a team.
 */
export const AUGMENTING_AGENT_IDS = new Set(["advisor", "developer"]);

export const SPECIALIST_TEMPLATE_VERSION = "guild.specialist_template.v1";

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
  /** Optional project metadata passed through from frontmatter into the derived registry. */
  owns: string[];
  external_skills: string[];
  reusable_in: string[];
  /** Cross-repo consistency pointer (workspace-relative, e.g. ../website/.guild/agents/<x>.md). */
  consistency_source: string | null;
  /** true on a project entry whose name collides with a shipped type (the project instance wins in the merged roster). */
  overrides_shipped: boolean;
  /**
   * true for the machinery agents (advisor/developer): kept in the roster
   * for dispatch, excluded from team-compose domain matching and the cap-6
   * count (machinery-vs-template-library ADR).
   */
  augmenting: boolean;
}

export interface RosterSkillEntry {
  id: string;
  /** Path relative to projectRoot. */
  file: string;
  name: string | null;
  description: string | null;
  /** Optional project metadata passed through from frontmatter into the derived registry. */
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
  /**
   * The shipped specialist TYPE templates (templates/specialists/*.md).
   * NOT dispatchable and never part of `roster` — each is a mint candidate:
   * team-compose matches a domain against a template, mints the instance into
   * .guild/agents/ (mintFromTemplate), and the INSTANCE joins the roster.
   */
  templates: RosterAgentEntry[];
  /** Union of shipped + project; project wins on name collision. */
  roster: RosterAgentEntry[];
  /** Project-local skills under .guild/skills/<id>/SKILL.md (proposed-* excluded). */
  project_skills: RosterSkillEntry[];
  warnings: string[];
}

// ── Frontmatter ────────────────────────────────────────────────────────────
// Parsing is delegated to the shared reader (scripts/lib/frontmatter.ts):
// parseFrontmatter(content) → object | null (no block / empty / non-object).

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
    owns: asStringList(fm["owns"]),
    external_skills: asStringList(fm["external_skills"]),
    reusable_in: asStringList(fm["reusable_in"]),
    consistency_source: asString(fm["consistency_source"]),
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
      type: asString(fm["type"]),
      used_by: asStringList(fm["used_by"]),
      external_skills: asStringList(fm["external_skills"]),
      consistency_source: asString(fm["consistency_source"]),
    });
  }
  return entries;
}

/**
 * Enumerate the shipped specialist TYPE templates (templates/specialists/*.md).
 * Same frontmatter shape as an agent file plus the `template_version:
 * guild.specialist_template.v1` stamp; entries missing the stamp are skipped
 * with a warning (a template must self-declare its contract).
 */
export function listSpecialistTemplates(
  pluginRoot: string,
  warnings: string[] = []
): RosterAgentEntry[] {
  const dir = path.join(pluginRoot, "templates", "specialists");
  const out: RosterAgentEntry[] = [];
  for (const f of listAgentFiles(dir)) {
    const rel = path.join("templates", "specialists", f);
    const entry = readAgentEntry(pluginRoot, rel, "template", warnings);
    if (!entry) continue;
    let fm: Record<string, unknown> | null = null;
    try {
      fm = parseFrontmatter(fs.readFileSync(path.join(pluginRoot, rel), "utf8"));
    } catch {
      fm = null;
    }
    if (asString(fm?.["template_version"]) !== SPECIALIST_TEMPLATE_VERSION) {
      warnings.push(
        `specialist template without 'template_version: ${SPECIALIST_TEMPLATE_VERSION}' skipped: ${rel}`
      );
      continue;
    }
    // A template is never augmenting — it IS the domain-matchable feedstock.
    entry.augmenting = false;
    out.push(entry);
  }
  return out;
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

  const templates = listSpecialistTemplates(pluginRoot, warnings);

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
    templates,
    roster: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    project_skills: listProjectSkills(projectRoot),
    warnings,
  };
}

// ── Template minting ───────────────────────────────────────────────────────

export interface MintResult {
  /** Absolute path of the (would-be) minted instance. */
  path: string;
  action: "written" | "exists" | "refused";
  reason?: string;
}

/**
 * Mint a project specialist instance from a shipped template — the
 * deterministic, code-backed instantiation step guild:team-compose runs when a
 * matched domain has a template but no project instance yet.
 *
 *   templates/specialists/<name>.md  →  <projectRoot>/.guild/agents/<name>.md
 *
 * The copy is byte-preserving except for one frontmatter transform: the
 * `template_version:` stamp becomes `derived_from_template:` (the DH-3
 * provenance stamp instances carry). An existing instance is NEVER overwritten
 * (reuse-never-re-create; `force` is intentionally not offered — evolving an
 * instance is guild:evolve-skill's job, not a re-mint). Path safety mirrors the
 * derived-registry writer: symlinked targets or ancestors escaping the project
 * root are refused outright.
 */
export function mintFromTemplate(opts: {
  pluginRoot: string;
  projectRoot: string;
  name: string;
  /** Run every check and report the would-be action WITHOUT writing anything. */
  dryRun?: boolean;
}): MintResult {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const name = opts.name;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return {
      path: "",
      action: "refused",
      reason: `unsafe specialist name "${name}" — must be a [a-z0-9-] segment`,
    };
  }
  const src = path.join(pluginRoot, "templates", "specialists", `${name}.md`);
  if (!fs.existsSync(src)) {
    return {
      path: src,
      action: "refused",
      reason: `no shipped template for "${name}" (templates/specialists/${name}.md not found)`,
    };
  }
  // Source-side safety: only a REAL file inside the shipped template library
  // is mintable. A symlinked <role>.md — or a symlinked templates/ ancestor —
  // could smuggle a non-template body in; refuse both (codex G-lane finding).
  let srcSt: fs.Stats;
  try {
    srcSt = fs.lstatSync(src);
  } catch {
    return { path: src, action: "refused", reason: `cannot stat template ${src}` };
  }
  if (!srcSt.isFile() || srcSt.isSymbolicLink()) {
    return { path: src, action: "refused", reason: `template ${src} is not a regular file` };
  }
  const realSrc = fs.realpathSync(src);
  const realPluginRoot = fs.realpathSync(pluginRoot);
  if (realSrc !== path.join(realPluginRoot, "templates", "specialists", `${name}.md`)) {
    return {
      path: src,
      action: "refused",
      reason: `template ${src} resolves outside the shipped template library (${realSrc})`,
    };
  }
  const raw = fs.readFileSync(src, "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm || asString(fm["template_version"]) !== SPECIALIST_TEMPLATE_VERSION) {
    return {
      path: src,
      action: "refused",
      reason: `template ${name}.md does not carry 'template_version: ${SPECIALIST_TEMPLATE_VERSION}'`,
    };
  }

  // Reuse-never-re-create is a ROSTER-NAME invariant, not a filename one: a
  // project instance under any filename whose frontmatter `name:` matches the
  // role already covers it (codex G-lane finding — a second `frontend` under a
  // different filename would produce duplicate registry ids).
  const projWarnings: string[] = [];
  for (const f of listAgentFiles(path.join(projectRoot, ".guild", "agents"))) {
    const existing = readAgentEntry(
      projectRoot,
      path.join(".guild", "agents", f),
      "project",
      projWarnings
    );
    if (existing && existing.name === name) {
      return {
        path: existing.definition_abs,
        action: "exists",
        reason: `instance already minted as ${existing.definition} (reuse, never re-create)`,
      };
    }
  }

  const target = path.join(projectRoot, ".guild", "agents", `${name}.md`);
  // Path-safety (same hard rules as writeDerived): never write through a
  // symlink, never let an ancestor's realpath escape the project root.
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink()) {
    return { path: target, action: "refused", reason: `${target} is a symlink` };
  }
  if (st) {
    return { path: target, action: "exists", reason: "instance already minted (reuse, never re-create)" };
  }
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
      return {
        path: target,
        action: "refused",
        reason: `${target} resolves outside the project root (${realDir})`,
      };
    }
  }

  // The one-line provenance transform, bounded to the frontmatter block (the
  // text between the leading `---` fences) so a body occurrence can never be
  // swapped, and verified: exactly one stamp line must be replaced — otherwise
  // fail closed (a YAML-quoted/odd stamp that satisfied parseFrontmatter but
  // not the literal line would silently mint with the wrong provenance key).
  // NOTE: this is NOT YAML reading (that already happened via the shared
  // parseFrontmatter above) — it is a whole-line byte transform, done by exact
  // string equality so the rest of the file is preserved as authored.
  const stampLine = `template_version: ${SPECIALIST_TEMPLATE_VERSION}`;
  const fmEnd = raw.indexOf("\n---", 3);
  const fmBlock = fmEnd === -1 ? raw : raw.slice(0, fmEnd + 4);
  const fmLines = fmBlock.split("\n");
  const stampAt = fmLines.reduce<number[]>((acc, l, i) => {
    if (l.trim() === stampLine) acc.push(i);
    return acc;
  }, []);
  if (stampAt.length !== 1) {
    return {
      path: src,
      action: "refused",
      reason: `template ${name}.md must carry exactly one literal '${stampLine}' frontmatter line (found ${stampAt.length})`,
    };
  }
  fmLines[stampAt[0]] = `derived_from_template: ${SPECIALIST_TEMPLATE_VERSION}`;
  const minted = fmLines.join("\n") + raw.slice(fmBlock.length);
  if (!opts.dryRun) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, minted, "utf8");
  }
  return { path: target, action: "written" };
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
  const parsed = parseYaml(raw);
  if (parsed === null) {
    // Shared parseYaml is fail-soft: null covers BOTH an empty/comment-only doc
    // (safe to write) and unparseable content (hand-authored — refuse). Split
    // the cases on the raw text.
    const hasContent = raw
      .split(/\r?\n/)
      .some((l) => l.trim() !== "" && !l.trim().startsWith("#"));
    if (!hasContent) return { ok: true };
  } else if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse("has an unexpected document shape");
  } else {
    const keys = Object.keys(parsed as Record<string, unknown>);
    const list = (parsed as Record<string, unknown>)[key];
    const emptyList = list === null || (Array.isArray(list) && list.length === 0);
    if (keys.every((k) => k === key) && (keys.length === 0 || emptyList)) {
      return { ok: true };
    }
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
      owns: a.owns,
      external_skills: a.external_skills,
      reusable_in: a.reusable_in,
      consistency_source: a.consistency_source,
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
    pruneNulls({
      id: s.id,
      file: s.file,
      name: s.name,
      description: s.description,
      type: s.type,
      used_by: s.used_by,
      external_skills: s.external_skills,
      consistency_source: s.consistency_source,
    })
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

// ── Host-native projection (opt-in) ────────────────────────────────────────

export const HOST_NATIVE_MARKER = "generated_by: guild.roster_resolve.v1";

/**
 * Opt-in projection of a minted project instance into the project's
 * `.claude/agents/<name>.md` so a Claude host can auto-route to it natively
 * (TRIGGER-description routing). The projection is a byte copy of the
 * instance with one added frontmatter line (`generated_by: …`) marking it as
 * a generated projection — the instance under `.guild/agents/` stays the
 * source of truth. An existing target WITHOUT the marker is hand-authored and
 * never clobbered; symlinked targets are refused outright.
 */
export function projectInstanceToHostNative(opts: {
  projectRoot: string;
  name: string;
}): MintResult {
  const projectRoot = path.resolve(opts.projectRoot);
  const name = opts.name;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    return { path: "", action: "refused", reason: `unsafe specialist name "${name}"` };
  }
  const src = path.join(projectRoot, ".guild", "agents", `${name}.md`);
  if (!fs.existsSync(src)) {
    return {
      path: src,
      action: "refused",
      reason: `no project instance at .guild/agents/${name}.md — mint it first`,
    };
  }
  const raw = fs.readFileSync(src, "utf8");
  if (!parseFrontmatter(raw)) {
    return { path: src, action: "refused", reason: `instance ${src} has no parseable frontmatter` };
  }

  const target = path.join(projectRoot, ".claude", "agents", `${name}.md`);
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(target);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink() || (st && !st.isFile())) {
    return { path: target, action: "refused", reason: `${target} is not a regular file` };
  }
  // A symlinked .claude/ (or .claude/agents/) ancestor could redirect the
  // write outside the project — same hard rule as every other roster writer:
  // the nearest existing ancestor's realpath must stay under the project root.
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
      return {
        path: target,
        action: "refused",
        reason: `${target} resolves outside the project root (${realDir})`,
      };
    }
  }
  if (st) {
    const existing = parseFrontmatter(fs.readFileSync(target, "utf8"));
    if (asString(existing?.["generated_by"]) !== "guild.roster_resolve.v1") {
      return {
        path: target,
        action: "refused",
        reason: `${target} exists without the '${HOST_NATIVE_MARKER}' marker — hand-authored, refusing to overwrite`,
      };
    }
  }
  // Insert the marker as the first frontmatter line after the opening fence,
  // matching the file's own line ending (the shared parser accepts CRLF
  // fences, so a CRLF instance must not silently skip the marker).
  const eol = raw.startsWith("---\r\n") ? "\r\n" : raw.startsWith("---\n") ? "\n" : null;
  if (eol === null) {
    return {
      path: src,
      action: "refused",
      reason: `instance ${src} does not open with a '---' frontmatter fence`,
    };
  }
  const withMarker = `---${eol}${HOST_NATIVE_MARKER}${eol}` + raw.slice(3 + eol.length);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, withMarker, "utf8");
  return { path: target, action: "written" };
}

// ── Team-file roster migration (shipped → template-library model) ──────────

export interface TeamMigrationFileResult {
  /** Absolute team-file path. */
  path: string;
  action: "rewritten" | "unchanged" | "refused";
  /** Roles whose entries were rewritten shipped → project. */
  migrated: string[];
  /** Roles minted by this migration (instance was absent). */
  minted: string[];
  /**
   * Domain roles whose mint was REFUSED — their entries are left as
   * `shipped` (still undispatchable). Any entry here makes the overall
   * migration a failure (exit 2): a silent broken lane is worse than a loud
   * one (codex G-lane finding).
   */
  failed: Array<{ role: string; reason: string }>;
  reason?: string;
}

/**
 * Migrate pre-template-library team files: any specialist entry carrying
 * `definition_source: shipped` for a DOMAIN role (one with a shipped
 * template) can no longer dispatch — the host no longer registers that
 * agent name. For each such entry: mint the project instance (idempotent —
 * `exists` is fine) and rewrite the entry to
 * `definition: .guild/agents/<role>.md` + `definition_source: project`.
 * Machinery agents (advisor/developer) keep `shipped`.
 *
 * Team files are derived composition artifacts, so the rewrite is a canonical
 * re-dump of the parsed document (data-preserving; comment lines are not).
 * Files that fail the shared YAML parse are refused, never guessed at.
 */
export function migrateTeamRoster(opts: {
  pluginRoot: string;
  projectRoot: string;
  dryRun?: boolean;
}): TeamMigrationFileResult[] {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const teamDir = path.join(projectRoot, ".guild", "team");
  if (!fs.existsSync(teamDir)) return [];
  const templateNames = new Set(listSpecialistTemplates(pluginRoot).map((t) => t.name));

  const results: TeamMigrationFileResult[] = [];
  for (const f of fs.readdirSync(teamDir).filter((n) => n.endsWith(".yaml")).sort()) {
    const abs = path.join(teamDir, f);
    if (fs.lstatSync(abs).isSymbolicLink()) {
      results.push({ path: abs, action: "refused", migrated: [], minted: [], failed: [], reason: "symlink" });
      continue;
    }
    const parsed = parseYaml(fs.readFileSync(abs, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      results.push({
        path: abs,
        action: "refused",
        migrated: [],
        minted: [],
        failed: [],
        reason: "unparseable team file — not migrating a document I cannot read",
      });
      continue;
    }
    const doc = parsed as Record<string, unknown>;
    const specialists = doc["specialists"];
    if (!Array.isArray(specialists)) {
      results.push({ path: abs, action: "unchanged", migrated: [], minted: [], failed: [] });
      continue;
    }

    const migrated: string[] = [];
    const minted: string[] = [];
    const failed: Array<{ role: string; reason: string }> = [];
    for (const entry of specialists) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const e = entry as Record<string, unknown>;
      const role = asString(e["name"]);
      if (!role || asString(e["definition_source"]) !== "shipped") continue;
      if (!templateNames.has(role)) continue; // machinery/dev-team stay shipped
      // Probe/execute the mint — dry-run runs the SAME checks without writing,
      // so a dry-run report never overstates what the real run can do.
      const mint = mintFromTemplate({ pluginRoot, projectRoot, name: role, dryRun: opts.dryRun });
      if (mint.action === "refused") {
        // Leave the entry untouched, but SURFACE it: this lane stays broken.
        failed.push({ role, reason: mint.reason ?? "mint refused" });
        continue;
      }
      if (mint.action === "written") minted.push(role);
      e["definition"] = path.join(".guild", "agents", `${role}.md`);
      e["definition_source"] = "project";
      migrated.push(role);
    }

    const action: TeamMigrationFileResult["action"] =
      failed.length > 0 ? "refused" : migrated.length === 0 ? "unchanged" : "rewritten";
    if (migrated.length > 0 && !opts.dryRun) {
      fs.writeFileSync(abs, yaml.dump(doc, { lineWidth: 100, noRefs: true }), "utf8");
    }
    results.push({
      path: abs,
      action,
      migrated,
      minted,
      failed,
      ...(failed.length > 0
        ? { reason: `mint refused for: ${failed.map((x) => `${x.role} (${x.reason})`).join("; ")}` }
        : {}),
    });
  }
  return results;
}
