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
 * PARSED VALUES: both halves compare as parsed YAML scalars (frontmatterValue), so
 *   `"say \"hi\""` and `'say "hi"'` are the same value; only a value change is drift.
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
import { splitFrontmatter, parseFrontmatter, parseYaml } from "../../scripts/lib/frontmatter";
import { validateSurfaceManifest, SurfaceManifest } from "../../scripts/lib/surface-manifest";
import { CLAUDE_TIER_FALLBACK } from "../../scripts/lib/capability/tier-defaults";
import * as yaml from "js-yaml";
import * as fs from "fs";
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
  "agents/developer.md",
  "agents/team-lead.md",
  "agents/context-manager.md",
];

/** Canonical `model:` → tier map: CLAUDE_TIER_FALLBACK inverted (exact alias match). */
const MODEL_TO_TIER: Record<string, string> = Object.fromEntries(
  Object.entries(CLAUDE_TIER_FALLBACK).map(([tier, model]) => [model, tier]),
);

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

/**
 * A top-level frontmatter field as its PARSED YAML value (undefined when absent).
 * A YAML-clean frontmatter is parsed whole. A YAML-hostile one (the unquoted skill
 * `description:` convention) is rebuilt entry by entry: each entry is the shortest
 * run of lines up to a column-0 line that still parses after the entries before it.
 * A line no run can parse must be a single-line `key: plain text` entry (plain or
 * quoted key); key and value are re-emitted as JSON (= YAML double-quoted) strings. The rebuilt document is then
 * parsed whole, so quoted keys, anchors and duplicate keys keep YAML semantics.
 * Anything else is undefined, so it never matches a manifest value.
 */
export function frontmatterValue(content: string, key: string): unknown {
  const fm = parseFrontmatter(content);
  if (fm !== null) return fm[key] === null ? undefined : fm[key];
  const { frontmatter } = splitFrontmatter(content);
  if (frontmatter === null) return undefined;
  const lines = frontmatter.split("\n");
  const isCont = (l: string) => l.trim() === "" || /^[ \t]/.test(l);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isCont(lines[i]) || lines[i].startsWith("#")) {
      out.push(lines[i++]);
      continue;
    }
    let taken = -1;
    for (let e = i + 1; e <= lines.length && taken === -1; e++) {
      if (e < lines.length && isCont(lines[e])) continue;
      if (parseYaml([...out, ...lines.slice(i, e)].join("\n")) !== null) taken = e;
    }
    if (taken !== -1) {
      out.push(...lines.slice(i, taken));
      i = taken;
      continue;
    }
    const ln = lines[i];
    // the key ends at the first `:` (plain key) or the first `:` after a closing quote
    // whose prefix parses to a string (quoted key)
    let colon = -1;
    let k: unknown;
    for (let c = ln.indexOf(":"); c > 0; c = ln.indexOf(":", c + 1)) {
      const token = ln.slice(0, c);
      if (!"\"'".includes(token[0])) {
        [colon, k] = [c, token];
        break;
      }
      const parsed = parseYaml(token);
      if (typeof parsed === "string") {
        [colon, k] = [c, parsed];
        break;
      }
    }
    const raw = ln.slice(colon + 1).trim();
    const next = lines.slice(i + 1).find((l) => l.trim() !== "");
    if (colon <= 0 || typeof k !== "string" || ln.slice(0, colon).trim() !== ln.slice(0, colon)) return undefined;
    if (raw === "" || (next !== undefined && /^[ \t]/.test(next))) return undefined;
    if ("\"'[{|>&*!#%@`".includes(raw[0])) return undefined;
    out.push(`${JSON.stringify(k)}: ${JSON.stringify(raw)}`);
    i++;
  }
  const doc = parseYaml(out.join("\n"));
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return undefined;
  const v = (doc as Record<string, unknown>)[key];
  return v === null ? undefined : v;
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
  const fmName = frontmatterValue(content, "name");
  if (m.name !== fmName) push(`name "${m.name}" ≠ frontmatter name "${fmName}"`);

  // description ≡ frontmatter description
  const fmDesc = frontmatterValue(content, "description");
  if (m.description !== fmDesc) push(`description drifts from frontmatter description`);

  // when_to_use ≡ frontmatter when_to_use (only when the manifest declares one)
  if (m.when_to_use !== undefined) {
    const fmWtu = frontmatterValue(content, "when_to_use");
    if (m.when_to_use !== fmWtu) push(`when_to_use drifts from frontmatter when_to_use`);
  }

  // type/tier
  if (m.type !== undefined) {
    if (m.kind === "agent") {
      // agent tier is derived from the `model:` frontmatter
      const model = frontmatterValue(content, "model");
      const expectedTier = typeof model === "string" ? MODEL_TO_TIER[model] : undefined;
      if (m.type !== expectedTier) {
        push(`tier "${m.type}" ≠ tier derived from model "${model}" (${expectedTier ?? "unknown"})`);
      }
    } else {
      // skill type ≡ frontmatter type
      const fmType = frontmatterValue(content, "type");
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

export function run(root: string = REPO): RailResult {
  const out: RailResult = {
    rail: "R-DECL",
    pass: true,
    advisory: false,
    violations: [],
    notes: [
      `${EXEMPLARS.length} W7 exemplars checked: schema-valid AND prose-≡ (name/description/when_to_use/type-tier/gates/dispatch)`,
    ],
  };
  // G05 R2: a machinery agent that carries a manifest is never outside the rail.
  let agentFiles: string[] = [];
  try { agentFiles = fs.readdirSync(path.join(root, "agents")).filter((n) => n.endsWith(".md")); } catch { /* no agents dir */ }
  for (const name of agentFiles) {
    const rel = `agents/${name}`;
    if (!EXEMPLARS.includes(rel) && extractManifestBlock(read(path.join(root, rel))) !== null) {
      out.pass = false;
      out.violations.push(`[${rel}] carries a surface_manifest: block but is not an R-DECL exemplar`);
    }
  }
  for (const f of EXEMPLARS) {
    const content = read(path.join(root, f));
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

  // CONTROL 5 — quoting-only difference is CLEAN; an escape that changes the value TRIPS.
  {
    const agentWith = (mf: string) =>
      [
        "---",
        "name: demo-agent",
        'description: "say \\"hi\\" to the cell\'s lead"',
        "model: opus",
        "surface_manifest:",
        "  schema_version: guild.surface_manifest.v1",
        "  kind: agent",
        "  name: demo-agent",
        `  description: ${mf}`,
        "  type: powerful",
        "---",
        "# demo-agent",
        "",
      ].join("\n");
    const same = agentWith(`'say "hi" to the cell''s lead'`);
    const ms = validateSurfaceManifest(extractManifestBlock(same));
    proveAssert(
      ms.ok && crossCheck(same, ms.manifest!, "demo-agent").length === 0,
      "CONTROL: scalars that differ only in quoting/escaping parse equal (CLEAN)",
    );
    const drift = agentWith(`'say \\"hi\\" to the cell''s lead'`);
    const md = validateSurfaceManifest(extractManifestBlock(drift));
    proveAssert(
      md.ok && crossCheck(drift, md.manifest!, "demo-agent").some((x) => x.reason.includes("description")),
      "CONTROL: a single-quoted literal backslash is a different parsed value (TRIPS)",
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
