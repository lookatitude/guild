/**
 * R-DEP — dependency-direction rail (STRICT for layering; circularity advisory).
 *
 * §4 enforcement rail. Two parts:
 *   1. CIRCULARITY (advisory): `madge --circular` over the source tree should report 0
 *      cycles. madge is not yet a devDependency, so when absent the rail records a
 *      backlog note + the install recommendation rather than failing.
 *   2. LAYERING (STRICT): scripts/lib/shared/ is the dependency FLOOR — modules there
 *      may import only from shared/, node builtins, or external packages. They MUST NOT
 *      runtime-import upward (../recall, ../../understand/lib/schema, ../../config-cmd …).
 *
 *      EXCEPTION — type-only imports. `import type { … } from "<upward>"` and
 *      `export type { … } from "<upward>"` carry ZERO runtime coupling (erased by the
 *      compiler), so they are an explicit, allowed exception to the layering floor.
 *      A RUNTIME (value) upward import is a strict violation → pass:false.
 *
 *      Compatibility shims are allowed to re-export implementations from src/modules
 *      when they contain no local logic. A runtime `import { x } from "../../understand/…"`
 *      MUST still fail.
 *
 * Anti-vacuity: `--prove` runs the pure layering detector against (a) a synthetic shared
 * module with a RUNTIME upward import → flagged, (b) a clean one → not flagged, and
 * (c) a `import type` upward import → NOT flagged (the type-only exception), and
 * (d) a pure src/modules re-export shim → NOT flagged.
 */
import { REPO, RailResult, report, walk, read, rel, proveAssert } from "./_common";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const SHARED_FLOOR = "scripts/lib/shared/";

/**
 * Pure layering detector: a shared/ module may not RUNTIME-import a path that escapes the
 * shared/ floor. Type-only imports (`import type …` / `export type …`) are an allowed
 * exception (zero runtime coupling). Returns the offending runtime specifiers.
 */
export function detectUpwardImports(sharedRel: string, content: string): string[] {
  const bad: string[] = [];
  // Capture the FULL statement keyword run so we can tell a type-only import/export apart
  // from a value import/export. Groups:
  //   g1 = leading keyword(s) ("import" | "import type" | "export" | "export type" | "import * as" …)
  //   g2 = the brace clause body (may be undefined for `import "x"` / `import * as ns`)
  //   g3 = module specifier for `… from "spec"`
  //   g4 = bare side-effect import specifier (`import "spec"`)
  //   g5 = require("spec")
  const importRe =
    /\b(import\s+type|export\s+type|import|export)\b([^'"]*?)\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content))) {
    const keyword = (m[1] ?? "").replace(/\s+/g, " ").trim();
    const clause = m[2] ?? "";
    const spec = m[3] ?? m[4] ?? m[5];
    if (!spec || !spec.startsWith(".")) continue; // external / builtin — always allowed

    const resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(sharedRel), spec),
    );
    if (resolved.startsWith(SHARED_FLOOR)) continue; // within the floor — fine
    if (isPureModuleShim(sharedRel, content, spec, resolved)) continue;

    // upward import — is it type-only (allowed) or runtime (forbidden)?
    const isStatementTypeOnly = keyword === "import type" || keyword === "export type";
    // an `import { type A, type B } from …` (all specifiers inline-typed) is also type-only.
    const isFullyInlineTypeOnly = isClauseFullyTypeOnly(clause);
    if (isStatementTypeOnly || isFullyInlineTypeOnly) continue; // type-only exception

    bad.push(`${spec}  →  ${resolved}`);
  }
  return bad;
}

function isPureModuleShim(sharedRel: string, content: string, spec: string, resolved: string): boolean {
  if (!sharedRel.replace(/\\/g, "/").startsWith(SHARED_FLOOR)) return false;
  if (!resolved.startsWith("src/modules/")) return false;
  const trimmed = content.trim();
  const escapedSpec = spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const shimRe = new RegExp(`^(?:/\\*[\\s\\S]*?\\*/\\s*)?export\\s+\\*\\s+from\\s+["']${escapedSpec}["'];?$`);
  return shimRe.test(trimmed);
}

/**
 * True iff a brace clause body imports ONLY inline-typed bindings, e.g. `{ type A, type B }`.
 * A mixed clause (`{ type A, b }`) has a runtime binding → NOT fully type-only → forbidden.
 * An empty / braceless clause is NOT fully-type-only (it is a value/namespace import).
 */
function isClauseFullyTypeOnly(clause: string): boolean {
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return false; // namespace import / default import — runtime binding
  const names = brace[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length === 0) return false;
  return names.every((n) => /^type\s+\S/.test(n));
}

function madgeCircular(): { available: boolean; cycles: number; raw: string } {
  for (const bin of ["madge", "npx"]) {
    try {
      const args =
        bin === "npx"
          ? ["--no-install", "madge", "--circular", "--extensions", "ts", "scripts", "mcp-servers"]
          : ["--circular", "--extensions", "ts", "scripts", "mcp-servers"];
      const raw = execFileSync(bin, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const cycles = (raw.match(/^\d+\)/gm) ?? []).length;
      return { available: true, cycles, raw };
    } catch (e: any) {
      const out = `${e?.stdout ?? ""}${e?.stderr ?? ""}`;
      if (/could not determine executable|not found|install/i.test(out)) continue;
      if (/Circularity|✖|\)\s/.test(out)) {
        const cycles = (out.match(/^\d+\)/gm) ?? []).length;
        return { available: true, cycles, raw: out };
      }
    }
  }
  return { available: false, cycles: -1, raw: "" };
}

export function run(): RailResult {
  const out: RailResult = {
    rail: "R-DEP",
    // STRICT for the layering floor. A runtime upward import sets pass=false and blocks.
    pass: true,
    advisory: false,
    violations: [],
    notes: [],
  };

  // 1. circularity (advisory sub-check — never blocks; recorded as backlog)
  const m = madgeCircular();
  if (!m.available) {
    out.notes.push(
      "madge not installed — circularity check SKIPPED (advisory sub-check). W2 backlog: add `madge` devDependency, then `npx madge --circular --extensions ts scripts mcp-servers` must report 0.",
    );
  } else if (m.cycles > 0) {
    out.notes.push(`madge reported ${m.cycles} circular dependency group(s) (advisory sub-check — not blocking):`);
    for (const l of m.raw.split("\n").filter((l) => /^\d+\)/.test(l))) {
      out.notes.push(`  circular: ${l.trim()}`);
    }
  } else {
    out.notes.push("madge --circular: 0 cycles ✓");
  }

  // 2. layering floor — STRICT
  const sharedDir = path.join(REPO, "scripts", "lib", "shared");
  if (!fs.existsSync(sharedDir)) {
    out.notes.push(
      "scripts/lib/shared/ does not exist — layering rule inert (W1 creates the floor).",
    );
    return out;
  }
  const sharedFiles = walk(sharedDir, (n) => n.endsWith(".ts"));
  out.notes.push(`layering (STRICT): checking ${sharedFiles.length} shared/ module(s) for RUNTIME upward imports (import type allowed)`);
  for (const f of sharedFiles) {
    const bad = detectUpwardImports(rel(f), read(f));
    for (const b of bad) {
      out.violations.push(`[layering] ${rel(f)} RUNTIME-imports upward (forbidden; use shared/ or import type): ${b}`);
    }
  }
  out.pass = out.violations.length === 0; // STRICT: any runtime upward import blocks
  return out;
}

function prove(): void {
  console.log("\n[R-DEP] --prove (anti-vacuity)");

  // (a) RUNTIME upward import → flagged (and the external `zod` import ignored)
  const runtimeUpward = detectUpwardImports(
    "scripts/lib/shared/bm25.ts",
    'import { recall } from "../recall";\nimport { z } from "zod";\n',
  );
  proveAssert(
    runtimeUpward.length === 1,
    "layering detector FLAGS a shared/ module RUNTIME-importing ../recall (and ignores external `zod`)",
  );

  // (b) clean (only within-floor + builtins) → not flagged
  const clean = detectUpwardImports(
    "scripts/lib/shared/bm25.ts",
    'import { tokenize } from "./share-set";\nimport * as fs from "fs";\n',
  );
  proveAssert(clean.length === 0, "layering detector PASSES a shared/ module importing only within shared/ + builtins");

  // (c) TYPE-ONLY upward import → NOT flagged (the explicit exception) — the real
  //     graph-scoring.ts case.
  const typeOnly = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'import type { GraphNode, GraphEdge } from "../../understand/lib/schema";\n',
  );
  proveAssert(
    typeOnly.length === 0,
    "layering detector ALLOWS `import type {…}` upward (zero runtime coupling — type-only exception)",
  );

  const moduleShim = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'export * from "../../../src/modules/knowledge/workflows/graph-scoring";\n',
  );
  proveAssert(moduleShim.length === 0, "layering detector ALLOWS a pure shared/ compatibility shim to src/modules");

  const impureModuleShim = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'const local = 1;\nexport * from "../../../src/modules/knowledge/workflows/graph-scoring";\n',
  );
  proveAssert(impureModuleShim.length === 1, "PLANTED CONTROL: a shared/ shim with local logic still TRIPS the layer rail");

  // (c2) the same upward path as a VALUE import MUST fail (control proving the exception
  //      is the keyword, not the path).
  const valueSamePath = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'import { validateGraph } from "../../understand/lib/schema";\n',
  );
  proveAssert(
    valueSamePath.length === 1,
    "PLANTED CONTROL: a RUNTIME value import of the SAME upward path (../../understand/lib/schema) TRIPS the rail",
  );

  // (d) a `export type { … } from` upward re-export → allowed
  const exportType = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'export type { GraphNode } from "../../understand/lib/schema";\n',
  );
  proveAssert(exportType.length === 0, "layering detector ALLOWS `export type {…}` upward re-export");

  // (e) inline-typed clause `{ type A, type B }` → allowed; mixed `{ type A, b }` → forbidden
  const inlineType = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'import { type GraphNode, type GraphEdge } from "../../understand/lib/schema";\n',
  );
  proveAssert(inlineType.length === 0, "layering detector ALLOWS a fully inline-typed clause `{ type A, type B }`");
  const mixed = detectUpwardImports(
    "scripts/lib/shared/graph-scoring.ts",
    'import { type GraphNode, validateGraph } from "../../understand/lib/schema";\n',
  );
  proveAssert(mixed.length === 1, "layering detector FLAGS a MIXED clause `{ type A, runtimeB }` (one runtime binding leaks)");
}

if (require.main === module) {
  if (process.argv.includes("--prove")) prove();
  else process.exit(report(run()));
}
