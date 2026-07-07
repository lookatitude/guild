/**
 * R-DECL — declarative-surface rail (STRICT).
 *
 * W7 EXEMPLAR SLICE (target-architecture.md §11). Each converted live-surface
 * exemplar carries an ADDITIVE `surface_manifest:` block (guild.surface_manifest.v1)
 * that EXTRACTS the structured/drift-prone metadata (name, description,
 * trigger/when_to_use, type/tier, gates, dispatch targets) into a validated contract.
 * The prose body is preserved verbatim; the block is additive metadata.
 *
 * This rail asserts, for every converted exemplar, BOTH halves:
 *   (1) SCHEMA   — the block validates against scripts/lib/surface-manifest.ts.
 *   (2) PROSE-≡  — the block MATCHES the file's own prose/frontmatter it mirrors:
 *        · name        ≡ frontmatter `name`
 *        · description ≡ frontmatter `description`
 *        · when_to_use ≡ frontmatter `when_to_use`        (skills/agents that carry it)
 *        · type (skill)≡ frontmatter `type`
 *        · type (agent)= the TIER derived from `model:` (opus→powerful, …) — the
 *                        canonical capability/tier-defaults mapping
 *        · gates       ⊆ the gate ids the body's `## Gates` section declares
 *        · dispatch_targets — every target named in the body's dispatch wiring
 *                        (Handoff chain / `## Dispatch`)
 *   A manifest that disagrees with its prose is DRIFT — the exact class this rail
 *   guards (dispatch-table / gate-list / tier drift the P1 audit found).
 *
 * WHY a sub-block extractor (not parseFrontmatter): the skill frontmatter is
 *   intentionally YAML-hostile (unquoted `description:` with colons — the long-
 *   standing skill convention), so a whole-block `yaml.load` returns null and would
 *   SILENTLY DROP the two skill exemplars (vacuity hole). We slice the
 *   `surface_manifest:` sub-tree, de-indent one level, and parse only that clean,
 *   fully-quoted/folded sub-document — so the skills are actually checked.
 *
 * SCOPING: only the W7 exemplar set (CONVERTED). A live-surface file WITHOUT a
 *   `surface_manifest:` block is out of scope (W7 is a slice, not the full rework);
 *   a file LISTED here that has lost its block, or whose block drifts, is RED.
 *
 * Anti-vacuity (`--prove`): mutate a manifest so it disagrees with its prose
 *   (wrong dispatch target, wrong tier, a gate the body never declares, a name
 *   mismatch) and assert the cross-checker TRIPS; the real shipped exemplars are
 *   asserted CLEAN (real-path proof).
 *
 * Run:   cd tests && npx tsx rearch/r-decl.ts
 * Prove: cd tests && npx tsx rearch/r-decl.ts --prove
 */
import { REPO, RailResult, report, read, proveAssert } from "./_common";
import { splitFrontmatter, readScalarField } from "../../scripts/lib/frontmatter";
import { validateSurfaceManifest, SurfaceManifest } from "../../scripts/lib/surface-manifest";
import * as yaml from "js-yaml";
import * as path from "path";

/**
 * The W7 converted exemplar set — each MUST carry a valid, prose-matching manifest.
 * NOTE: commands are intentionally EXCLUDED. Commands are ALREADY declarative — they
 * render byte-for-byte from an authored command-registry source (see
 * command-registry-source.test.ts); a `surface_manifest:` block on a generated command
 * file breaks the source≡rendered invariant and is redundant with the registry. So the
 * surface_manifest model targets the NON-generated surfaces (skills + agents); commands'
 * declarative source is the registry. (W7-exemplar finding.)
 */
export const EXEMPLARS: string[] = [
  "skills/specialists/architect-tradeoff-matrix/SKILL.md",
  "skills/specialists/backend-service-integration/SKILL.md",
  "agents/advisor.md",
];

/** Canonical `model:` → tier map (capability/tier-defaults.ts CLAUDE_TIER_FALLBACK, inverted). */
const MODEL_TO_TIER: Record<string, string> = {
  haiku: "cheap",
  sonnet: "mid",
  opus: "powerful",
};

/**
 * Extract the `surface_manifest:` sub-block as a standalone object. We do NOT
 * `yaml.load` the whole (YAML-hostile) skill frontmatter; we slice the
 * `surface_manifest:` sub-tree, de-indent one level, and parse only that.
 * Returns null when there is no block.
 */
export function extractManifestBlock(content: string): unknown {
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return null;
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((l) => /^surface_manifest:\s*$/.test(l));
  if (start === -1) return null;
  const block: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "") {
      block.push(l);
      continue;
    }
    if (/^[ \t]/.test(l)) block.push(l.replace(/^ {2}/, "")); // de-indent one level
    else break; // a non-indented line ends the sub-block (next top-level key)
  }
  try {
    return yaml.load(block.join("\n"), { schema: yaml.JSON_SCHEMA });
  } catch {
    return null;
  }
}

/** True iff the body's dispatch wiring (anywhere in the prose) names `target`. */
function bodyNamesDispatchTarget(body: string, target: string): boolean {
  // dispatch targets are referenced in the body as `architect-adr-writer`,
  // `guild:dashboard`, etc. A plain substring is robust against markdown
  // formatting (backticks, list items); the names are distinctive.
  return body.includes(target);
}

/** Gate ids the body declares under its `## Gates` section (single-letter / token ids). */
export function declaredGates(body: string): Set<string> {
  const out = new Set<string>();
  const lines = body.split("\n");
  let inGates = false;
  for (const l of lines) {
    if (/^#{2,}\s+Gates\b/i.test(l)) {
      inGates = true;
      continue;
    }
    if (inGates && /^#{1,}\s/.test(l)) break; // next heading ends the section
    if (!inGates) continue;
    // a gate line looks like:  - **I** (interactive) on REQUIRED-INSTALL: …
    const m = l.match(/^\s*-\s+\*\*([A-Za-z][A-Za-z0-9_-]*)\*\*/);
    if (m) out.add(m[1]);
  }
  return out;
}

export interface DeclFinding {
  file: string;
  reason: string;
}

/**
 * Pure cross-checker. Given a file's content + its validated manifest, returns the
 * prose-disagreement findings (empty = the manifest matches the prose it mirrors).
 * Pure: no I/O.
 */
export function crossCheck(content: string, m: SurfaceManifest, file: string): DeclFinding[] {
  const out: DeclFinding[] = [];
  const { body } = splitFrontmatter(content);
  const push = (reason: string) => out.push({ file, reason });

  // name ≡ frontmatter name
  const fmName = readScalarField(content, "name");
  if (m.name !== fmName) push(`name "${m.name}" ≠ frontmatter name "${fmName}"`);

  // description ≡ frontmatter description
  const fmDesc = readScalarField(content, "description");
  if (m.description !== fmDesc) push(`description drifts from frontmatter description`);

  // when_to_use ≡ frontmatter when_to_use (only when the manifest declares one)
  if (m.when_to_use !== undefined) {
    const fmWtu = readScalarField(content, "when_to_use");
    if (m.when_to_use !== fmWtu) push(`when_to_use drifts from frontmatter when_to_use`);
  }

  // type/tier
  if (m.type !== undefined) {
    if (m.kind === "agent") {
      // agent tier is derived from the `model:` frontmatter
      const model = readScalarField(content, "model");
      const expectedTier = model ? MODEL_TO_TIER[model] : undefined;
      if (m.type !== expectedTier) {
        push(`tier "${m.type}" ≠ tier derived from model "${model}" (${expectedTier ?? "unknown"})`);
      }
    } else {
      // skill type ≡ frontmatter type
      const fmType = readScalarField(content, "type");
      if (m.type !== fmType) push(`type "${m.type}" ≠ frontmatter type "${fmType}"`);
    }
  }

  // gates ⊆ declared gates in the body's `## Gates` section
  if (m.gates) {
    const declared = declaredGates(body);
    for (const g of m.gates) {
      if (!declared.has(g)) push(`gate "${g}" is not declared in the body's Gates section`);
    }
  }

  // dispatch_targets — every target must be named in the body's dispatch wiring
  if (m.dispatch_targets) {
    for (const t of m.dispatch_targets) {
      if (!bodyNamesDispatchTarget(body, t)) {
        push(`dispatch_target "${t}" is not named anywhere in the body dispatch wiring`);
      }
    }
  }

  return out;
}

export function run(): RailResult {
  const out: RailResult = {
    rail: "R-DECL",
    pass: true,
    advisory: false,
    violations: [],
    notes: [
      `${EXEMPLARS.length} W7 exemplars checked: schema-valid AND prose-≡ (name/description/when_to_use/type-tier/gates/dispatch)`,
    ],
  };
  for (const f of EXEMPLARS) {
    const content = read(path.join(REPO, f));
    if (content === "") {
      out.pass = false;
      out.violations.push(`[${f}] file unreadable`);
      continue;
    }
    const raw = extractManifestBlock(content);
    if (raw === null) {
      out.pass = false;
      out.violations.push(`[${f}] no surface_manifest: block (W7 exemplar must carry one)`);
      continue;
    }
    const v = validateSurfaceManifest(raw);
    if (!v.ok || v.manifest === null) {
      out.pass = false;
      for (const e of v.errors) out.violations.push(`[${f}] schema: ${e}`);
      continue;
    }
    const findings = crossCheck(content, v.manifest, f);
    for (const d of findings) {
      out.pass = false;
      out.violations.push(`[${d.file}] prose-≡: ${d.reason}`);
    }
  }
  return out;
}

function prove(): void {
  console.log("\n[R-DECL] --prove (anti-vacuity — a manifest disagreeing with its prose must TRIP)");

  // A representative real exemplar content (skill with a YAML-hostile frontmatter +
  // a folded manifest description, exactly the shape we ship).
  const good = [
    "---",
    "name: demo-skill",
    'description: Does a thing. Output: a table. TRIGGER: "do the thing".',
    "when_to_use: Pulled when a thing is needed.",
    "type: specialist",
    "surface_manifest:",
    "  schema_version: guild.surface_manifest.v1",
    "  kind: skill",
    "  name: demo-skill",
    "  description: >-",
    '    Does a thing. Output: a table. TRIGGER: "do the thing".',
    "  when_to_use: >-",
    "    Pulled when a thing is needed.",
    "  type: specialist",
    "  dispatch_targets:",
    "    - downstream-skill",
    "---",
    "# demo-skill",
    "## Handoff",
    "Chains into `downstream-skill`.",
    "",
  ].join("\n");

  // baseline: the good doc must be schema-valid AND prose-≡ (CLEAN).
  {
    const m = validateSurfaceManifest(extractManifestBlock(good));
    proveAssert(m.ok, "baseline: well-formed exemplar validates against the schema");
    proveAssert(
      crossCheck(good, m.manifest!, "demo").length === 0,
      "baseline: a manifest that matches its prose is CLEAN",
    );
  }

  // CONTROL 1 — dispatch drift: manifest names a target the body never dispatches.
  {
    const m = validateSurfaceManifest({
      schema_version: "guild.surface_manifest.v1",
      kind: "skill",
      name: "demo-skill",
      description: 'Does a thing. Output: a table. TRIGGER: "do the thing".',
      when_to_use: "Pulled when a thing is needed.",
      type: "specialist",
      dispatch_targets: ["GHOST-skill"],
    });
    const f = crossCheck(good, m.manifest!, "demo");
    proveAssert(
      f.some((x) => x.reason.includes("GHOST-skill")),
      "CONTROL: a dispatch_target the body never names TRIPS the prose-≡ check",
    );
  }

  // CONTROL 2 — tier drift on an agent: model=opus but manifest claims `mid`.
  {
    const agent = [
      "---",
      "name: demo-agent",
      'description: "An agent."',
      "model: opus",
      "surface_manifest:",
      "  schema_version: guild.surface_manifest.v1",
      "  kind: agent",
      "  name: demo-agent",
      '  description: "An agent."',
      "  type: mid", // WRONG — opus is `powerful`
      "---",
      "# demo-agent",
      "",
    ].join("\n");
    const m = validateSurfaceManifest(extractManifestBlock(agent));
    proveAssert(m.ok, "control agent manifest is schema-valid (drift is semantic, not schema)");
    const f = crossCheck(agent, m.manifest!, "demo-agent");
    proveAssert(
      f.some((x) => x.reason.includes("tier")),
      "CONTROL: agent tier `mid` with model `opus` TRIPS (canonical opus→powerful)",
    );
  }

  // CONTROL 3 — gate drift: manifest declares a gate the body's Gates section omits.
  {
    const cmd = [
      "---",
      "name: demo-cmd",
      'description: "A command."',
      "surface_manifest:",
      "  schema_version: guild.surface_manifest.v1",
      "  kind: command",
      "  name: demo-cmd",
      '  description: "A command."',
      "  gates:",
      "    - Z", // WRONG — body declares only **I**
      "  dispatch_targets:",
      "    - guild:demo",
      "---",
      "# demo-cmd",
      "## Gates",
      "- **I** (interactive) on something.",
      "## Dispatch",
      "Invoke `guild:demo`.",
      "",
    ].join("\n");
    const m = validateSurfaceManifest(extractManifestBlock(cmd));
    proveAssert(m.ok, "control command manifest is schema-valid");
    const f = crossCheck(cmd, m.manifest!, "demo-cmd");
    proveAssert(
      f.some((x) => x.reason.includes('gate "Z"')),
      "CONTROL: a gate `Z` absent from the body Gates section TRIPS",
    );
  }

  // CONTROL 4 — name drift: manifest name ≠ frontmatter name.
  {
    const m = validateSurfaceManifest({
      schema_version: "guild.surface_manifest.v1",
      kind: "skill",
      name: "WRONG-NAME",
      description: 'Does a thing. Output: a table. TRIGGER: "do the thing".',
      when_to_use: "Pulled when a thing is needed.",
      type: "specialist",
    });
    const f = crossCheck(good, m.manifest!, "demo");
    proveAssert(
      f.some((x) => x.reason.includes("name")),
      "CONTROL: a manifest name ≠ frontmatter name TRIPS",
    );
  }

  // SCHEMA control — unknown key / bad enum is rejected by the validator itself.
  {
    const bad = validateSurfaceManifest({
      schema_version: "guild.surface_manifest.v1",
      kind: "widget", // not a SurfaceKind
      name: "x",
      description: "y",
      bogus: 1, // unknown key
    });
    proveAssert(!bad.ok, "SCHEMA CONTROL: bad kind + unknown key fails validation");
  }

  // The live exemplars themselves must be CLEAN (real-path proof, not just synthetic).
  {
    const r = run();
    proveAssert(
      r.pass,
      "REAL-PATH: all shipped W7 exemplars validate AND match their prose (rail GREEN)",
    );
  }
  console.log("  All R-DECL anti-vacuity proofs passed.");
}

if (require.main === module) {
  if (process.argv.includes("--prove")) {
    prove();
  } else {
    process.exit(report(run()));
  }
}
