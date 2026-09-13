#!/usr/bin/env node
/**
 * build-coverage-draft — the first `guild.coverage.v1` draft (spec gap G-a).
 *
 * Enumerates every pre-change id on this tree (command, skill, live
 * `src/modules/*` public export, eval) and maps it to its post-reshape target:
 * assembler chapter | playbook | domain function | alias | deleted.
 * Zero unmapped ids is the acceptance criterion; the script fails loudly when an
 * id has no rule, so drift on the live tree cannot silently produce a hole.
 *
 *   npx tsx scripts/lint/build-coverage-draft.ts --out=<path>   (default: plugin .guild/evolve/coverage-draft.yaml)
 *   npx tsx scripts/lint/build-coverage-draft.ts --check        (verify, write nothing)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as ts from "typescript";

const ROOT = path.resolve(
  typeof __dirname !== "undefined" ? __dirname : path.join(process.cwd(), "lint"),
  "..", "..",
);

// ------------------------------------------------------------------ rules
/** 13 dispatchers that survive as command files. */
const KEEP_COMMANDS: Record<string, string> = {
  guild: "command:guild", init: "command:init", ideate: "command:ideate",
  plan: "command:plan", build: "command:build", qa: "command:qa", ops: "command:ops",
  learn: "command:learn", wiki: "command:wiki", initiative: "command:initiative",
  config: "command:config", status: "command:status", maintain: "command:maintain",
};
/** Dropped filenames -> the sub-verb that absorbs them; each keeps a print-only alias. */
const COMMAND_SUBVERBS: Record<string, string> = {
  goal: "command:plan goal", models: "command:config models", migrate: "command:config migrate",
  resume: "command:status resume", stats: "command:status stats", dashboard: "command:status dashboard",
  evolve: "command:maintain evolve", rollback: "command:maintain rollback",
  audit: "command:maintain audit", fix: "command:maintain fix",
  adopt: "command:init adopt",
};

/** Current skill id -> one of the 17 indexed assemblers. */
const SKILL_TO_ASSEMBLER: Record<string, string> = {
  "meta/using-guild": "using-guild", "meta/init": "init", "meta/brainstorm": "brainstorm",
  "meta/plan": "plan", "meta/team-compose": "team-compose", "meta/execute-plan": "execute-plan",
  "guild-quality": "quality", "guild-operations": "operations", "knowledge/learn": "learn",
  "meta/initiative": "initiative", "meta/review": "review", "meta/diagnose": "diagnose",
  "meta/evolve-skill": "evolve", "meta/create-skill": "create-skill",
  "meta/create-specialist": "create-specialist", "meta/reflect": "reflect",
};
/** Current skill id -> `references/` chapter of the named assembler. */
const SKILL_TO_CHAPTER: Record<string, string> = {
  "knowledge/learn-diff": "learn", "knowledge/learn-explain": "learn",
  "knowledge/learn-graph": "learn", "knowledge/learn-harvest": "learn",
  "knowledge/learn-knowledge": "learn", "knowledge/learn-map": "learn",
  "knowledge/learn-onboard": "learn",
  "knowledge/wiki-ingest": "wiki", "knowledge/wiki-lint": "wiki", "knowledge/wiki-query": "wiki",
  "meta/product-explore": "brainstorm", "meta/product-define": "plan",
  "meta/product-template": "plan", "meta/verify-done": "quality",
  "meta/writing-skills": "create-skill", "meta/review-broker": "review",
  "meta/audit": "evolve", "meta/rollback-skill": "evolve",
};
/** Current skill id -> off-glob L3 playbook under src/surfaces/playbooks/. */
const SKILL_TO_PLAYBOOK: Record<string, string> = {
  "meta/tdd": "tdd", "meta/worktrees": "worktrees",
  "meta/systematic-debug": "systematic-debug", "meta/finish-branch": "finish-branch",
  "meta/dispatching-parallel-agents": "dispatching-parallel-agents",
  "meta/codex-review": "codex-review",
  "meta/loop-clarify": "loop-clarify", "meta/loop-implement": "loop-implement",
  "meta/loop-plan-review": "loop-plan-review",
  "meta/dashboard": "dashboard",
  "meta/ops-incident": "ops-incident", "meta/ops-maintenance": "ops-maintenance",
  "meta/ops-monitoring": "ops-monitoring", "meta/ops-release": "ops-release",
  "meta/ops-rollback": "ops-rollback",
};
/** Current skill id -> a domain function; the skill file itself is deleted. */
const SKILL_TO_DOMAIN: Record<string, string> = {
  "meta/learning-checkpoint": "domain:knowledge#learningCheckpoint",
  "meta/context-assemble": "domain:knowledge#assembleLaneBundle",
  "meta/decisions": "domain:knowledge#writeDecision",
};
/** Folded wholesale into another surface; no file survives. */
const SKILL_FOLDED: Record<string, string> = {
  "core/principles": "assembler:using-guild §Operating principles",
};

/** Live module -> its domain home (KTD36 fold table). */
const MODULE_TO_DOMAIN: Record<string, string> = {
  kernel: "kernel", state: "state", security: "security", config: "config",
  lifecycle: "lifecycle", knowledge: "knowledge", teams: "teams", dispatch: "dispatch",
  review: "review", telemetry: "telemetry", evolution: "evolve", distribution: "distribution",
  migrations: "state", capability: "config", context: "knowledge", learning: "knowledge",
  initiatives: "lifecycle", operations: "lifecycle", loops: "lifecycle", intake: "lifecycle",
  quality: "review", evals: "evolve", communication: "dispatch", prompting: "config",
  workspace: "state", specialists: "teams", templates: "teams", "docs-sync": "distribution",
  documents: "lifecycle", "host-runtime": "adapters",
  // Judgment call (not in the source fold table): the status dashboard launcher is
  // a producer/launcher surface (KTD66) whose functions belong with run telemetry.
  dashboard: "telemetry",
};

// ------------------------------------------------------------------ helpers
function read(p: string): string {
  try { return fs.readFileSync(p, "utf8"); } catch { return ""; }
}
function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}
function walk(root: string, rel = "", out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out); else out.push(r);
  }
  return out;
}
function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

interface Entry { id: string; kind: string; target: string; disposition: string; note?: string; }

// ------------------------------------------------------------ export resolution
/** Barrels whose backing file is not on disk; surfaced instead of silently dropped. */
const UNRESOLVED_BARRELS: string[] = [];

function resolveSpecifier(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ""));
  const candidates = [
    `${base}.ts`, `${base}.tsx`, `${base}.d.ts`,
    path.join(base, "index.ts"), path.join(base, "index.tsx"),
  ];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}

function declaredName(n: ts.Node): string[] {
  if (ts.isVariableStatement(n)) {
    return n.declarationList.declarations
      .map((d) => (ts.isIdentifier(d.name) ? d.name.text : null))
      .filter((x): x is string => !!x);
  }
  if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isEnumDeclaration(n) ||
       ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isModuleDeclaration(n)) &&
      n.name && ts.isIdentifier(n.name)) {
    return [n.name.text];
  }
  return [];
}

function hasExportModifier(n: ts.Node): boolean {
  const mods = (n as any).modifiers as ts.NodeArray<ts.ModifierLike> | undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Public export names of `file`, expanding `export * from` recursively. */
function collectExports(file: string, seen: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const abs = path.resolve(file);
  if (seen.has(abs) || !fs.existsSync(abs)) return out;
  seen.add(abs);
  const sf = ts.createSourceFile(abs, read(abs), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st)) {
      const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
        ? st.moduleSpecifier.text : null;
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) out.set(el.name.text, abs);
        continue;
      }
      if (st.exportClause && ts.isNamespaceExport(st.exportClause)) {
        out.set(st.exportClause.name.text, abs);
        continue;
      }
      if (spec) {
        const target = resolveSpecifier(abs, spec);
        if (!target) { UNRESOLVED_BARRELS.push(spec); continue; }
        for (const [k, v] of collectExports(target, seen)) if (!out.has(k)) out.set(k, v);
      }
      continue;
    }
    if (ts.isExportAssignment(st)) { out.set("default", abs); continue; }
    if (hasExportModifier(st)) for (const n of declaredName(st)) out.set(n, abs);
  }
  return out;
}

// ------------------------------------------------------------------ collectors
function commands(): Entry[] {
  const dir = path.join(ROOT, "commands");
  const ids = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  return ids.map((id) => {
    if (KEEP_COMMANDS[id]) {
      return { id: `command:${id}`, kind: "command", target: KEEP_COMMANDS[id], disposition: "kept-dispatcher" };
    }
    const sub = COMMAND_SUBVERBS[id];
    if (!sub) throw new Error(`unmapped command id: ${id}`);
    return {
      id: `command:${id}`, kind: "command", target: sub, disposition: "alias",
      note: `dropped filename; print-only alias on next (KTD14)${id === "adopt" ? "; not in the rev-20 command map — see assumptions" : ""}`,
    };
  });
}

function skillIds(): string[] {
  return walk(path.join(ROOT, "skills"))
    .filter((f) => /(^|\/)SKILL(\.src)?\.md$/.test(f))
    .map((f) => f.replace(/\/?SKILL(\.src)?\.md$/, ""))
    .sort();
}

function skillTarget(sid: string): { target: string; disposition: string; note?: string } {
  if (SKILL_TO_ASSEMBLER[sid]) {
    const a = SKILL_TO_ASSEMBLER[sid];
    const renamed = sid.endsWith("/evolve-skill");
    return {
      target: `assembler:${a}`,
      disposition: "indexed-assembler",
      note: renamed ? "renamed evolve-skill -> evolve (U-S)" : undefined,
    };
  }
  if (SKILL_TO_CHAPTER[sid]) {
    return { target: `chapter:${SKILL_TO_CHAPTER[sid]}/references/${path.basename(sid)}.md`, disposition: "assembler-chapter" };
  }
  if (SKILL_TO_PLAYBOOK[sid]) {
    return { target: `playbook:${SKILL_TO_PLAYBOOK[sid]}`, disposition: "off-glob-playbook" };
  }
  if (SKILL_TO_DOMAIN[sid]) {
    return { target: SKILL_TO_DOMAIN[sid], disposition: "domain-function", note: "skill file deleted; behaviour is a domain function" };
  }
  if (SKILL_FOLDED[sid]) {
    return { target: SKILL_FOLDED[sid], disposition: "deleted", note: "content folded; file deleted (KTD25)" };
  }
  if (sid.startsWith("specialists/")) {
    return {
      target: `playbook:specialists/${path.basename(sid)}`,
      disposition: "off-glob-playbook",
      note: "specialist starter feedstock, copy-on-mint (KTD13/KTD20)",
    };
  }
  throw new Error(`unmapped skill id: ${sid}`);
}

function skills(): Entry[] {
  return skillIds().map((sid) => {
    const t = skillTarget(sid);
    return { id: `skill:${sid}`, kind: "skill", target: t.target, disposition: t.disposition, note: t.note };
  });
}

function moduleExports(): Entry[] {
  const base = path.join(ROOT, "src/modules");
  const out: Entry[] = [];
  for (const m of fs.readdirSync(base).sort()) {
    if (!isDir(path.join(base, m))) continue;
    const domain = MODULE_TO_DOMAIN[m];
    if (!domain) throw new Error(`unmapped module: ${m}`);
    const idx = path.join(base, m, "index.ts");
    if (!fs.existsSync(idx)) {
      out.push({
        id: `module:${m}`, kind: "module_export", target: `domain:${domain}`,
        disposition: "domain-fold", note: "module has no index.ts; U3 gives it one or folds its files",
      });
      continue;
    }
    // Every `export * from` barrel is resolved to its named symbols with the
    // TypeScript compiler API, recursively, so the row is a public export and not a
    // file path. Symbols keep the file they come from, which is what U3 has to move.
    const symbols = collectExports(idx, new Set());
    for (const [name, from] of [...symbols.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const rel = path.relative(ROOT, from).replace(/\\/g, "/");
      out.push({
        id: `module:${m}#${name}`,
        kind: "module_export",
        target: `domain:${domain}#${name}`,
        disposition: "domain-fold",
        note: rel === `src/modules/${m}/index.ts` ? undefined : `declared in ${rel}`,
      });
    }
    for (const spec of UNRESOLVED_BARRELS.splice(0)) {
      out.push({
        id: `module:${m}#*:${spec}`,
        kind: "module_export",
        target: `domain:${domain} <- ${spec}`,
        disposition: "domain-fold",
        note: "re-export barrel whose backing file could not be resolved on disk; U3 must place it by hand",
      });
    }
  }
  return out;
}

function evals(): Entry[] {
  const out: Entry[] = [];
  for (const sid of skillIds()) {
    if (!fs.existsSync(path.join(ROOT, "skills", sid, "evals.json"))) continue;
    const t = skillTarget(sid);
    out.push({
      id: `eval:skills/${sid}/evals.json`, kind: "eval",
      target: t.target.startsWith("assembler:")
        ? `eval-corpus:${t.target.slice("assembler:".length)}`
        : `eval-corpus:${t.target.split(":")[1] ?? t.target}`,
      disposition: t.disposition === "deleted" ? "eval-retired" : "eval-moved",
      note: "evals ride the surface they score (evals corpus lives in the evolve domain)",
    });
  }
  const boundary = "tests/boundary/evals.json";
  if (fs.existsSync(path.join(ROOT, boundary))) {
    out.push({
      id: `eval:${boundary}`, kind: "eval", target: "eval-corpus:review#boundary-collision",
      disposition: "eval-moved", note: "cross-cutting boundary evals; colocated under the review domain",
    });
  }
  return out;
}

// ------------------------------------------------------------------ emit
function main(argv: string[]): number {
  const opt = (n: string) => {
    const hit = argv.find((a) => a.startsWith(`--${n}=`));
    return hit ? hit.slice(n.length + 3) : undefined;
  };
  const entries = [...commands(), ...skills(), ...moduleExports(), ...evals()];
  const unmapped = entries.filter((e) => !e.target || !e.target.trim());
  const counts = entries.reduce<Record<string, number>>((a, e) => {
    a[e.kind] = (a[e.kind] ?? 0) + 1; return a;
  }, {});

  const lines: string[] = [];
  lines.push("# guild.coverage.v1 — first draft (T01 pattern lock, spec gap G-a)");
  lines.push("#");
  lines.push("# Generated by scripts/lint/build-coverage-draft.ts on the pre-reshape tree.");
  lines.push("# Every pre-change id maps to exactly one post-reshape target. T03 (skills),");
  lines.push("# T04 (commands) and T12 (domains) consume and then reconcile this file to the");
  lines.push("# moved files; the bijection is CI from T02 onward. Regenerate, never hand-edit.");
  lines.push("schema_version: guild.coverage.v1");
  lines.push("status: draft");
  lines.push("produced_by: T01-pattern-lock");
  lines.push(`source_tree: ${yamlStr("plugin/ at branch plr/T01-pattern-lock")}`);
  lines.push("counts:");
  for (const k of ["command", "skill", "module_export", "eval"]) lines.push(`  ${k}: ${counts[k] ?? 0}`);
  lines.push(`  total: ${entries.length}`);
  lines.push(`  unmapped: ${unmapped.length}`);
  lines.push("entries:");
  for (const e of entries) {
    lines.push(`  - id: ${yamlStr(e.id)}`);
    lines.push(`    kind: ${e.kind}`);
    lines.push(`    target: ${yamlStr(e.target)}`);
    lines.push(`    disposition: ${e.disposition}`);
    if (e.note) lines.push(`    note: ${yamlStr(e.note)}`);
  }
  const body = `${lines.join("\n")}\n`;

  if (argv.includes("--check")) {
    console.log(`coverage draft: ${entries.length} ids · ${unmapped.length} unmapped`);
    return unmapped.length === 0 ? 0 : 1;
  }
  const out = path.resolve(opt("out") ?? path.join(ROOT, ".guild/evolve/coverage-draft.yaml"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, body);
  console.log(`wrote ${entries.length} ids (${unmapped.length} unmapped) to ${out}`);
  for (const k of Object.keys(counts).sort()) console.log(`  ${k}: ${counts[k]}`);
  return unmapped.length === 0 ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
