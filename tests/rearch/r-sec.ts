/**
 * R-SEC — Security-control inventory rail (STRICT).
 *
 * Reads the security-controls.ts manifest and enforces three assertions:
 *
 *   1. ENFORCER EXISTS (STRICT): every control with enforcer_kind="code" must
 *      have an enforcer_file that exists on disk. A control pointing at a
 *      nonexistent file is a manifest error — either the file was deleted and
 *      the control is now unenforced, or the entry was authored incorrectly.
 *
 *   2. HOSTILE TEST EXISTS (STRICT): every control (code or prose-only) must
 *      have a hostile_test that exists on disk. A control without a hostile test
 *      is untested and cannot be trusted green. The file must be one `bun test`
 *      runs (a *.test.ts outside bunfig.toml's pathIgnorePatterns), and every
 *      hostile_test_titles entry must be a test title in it.
 *
 *   2b. WRAP CHECK (STRICT): a control with a wrap_check must still route every
 *      MCP tool handler through its D-RECALL wrapper (see WrapCheck), and every
 *      MCP server source under src/runtime/mcp/ must be covered by one.
 *
 *   3. PROSE-ONLY GAP (ADVISORY): controls whose enforcer_kind is "prose-only"
 *      are flagged — they represent a security gap (the recall-not-prose lesson:
 *      a security step described only in skill prose is unreliable; it must be
 *      enforced in deterministic code on the real path). Advisory: we report the
 *      gap but do not block CI until the prose→code conversion is done.
 *
 * Anti-vacuity: `--prove` runs the detector against a planted synthetic manifest
 * that points at a nonexistent enforcer and asserts the rail TRIPS. It also plants
 * a prose-only entry and asserts the advisory advisory fires.
 *
 * Run:
 *   cd tests && npx tsx rearch/r-sec.ts
 *   cd tests && npx tsx rearch/r-sec.ts --prove
 */

import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";
import { REPO, RailResult, report, proveAssert } from "./_common";
import {
  SECURITY_CONTROLS,
  proseOnlyControls,
  type SecurityControl,
  type WrapCheck,
} from "./security-controls";

// ─────────────────────────────────────────────────────────────────────────────
// Core detector — pure, accepts an explicit manifest for testability
// ─────────────────────────────────────────────────────────────────────────────

const BUN_TEST_FILE_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** bun test modifiers that stop a test or block from running. */
const DISABLE_MODIFIERS = new Set(["skip", "todo", "skipIf", "if", "failing"]);
const TEST_FNS = new Set(["describe", "it", "test"]);

// Source checks run on the TypeScript AST, never on regex over text: comments
// carry no calls and spacing or formatting cannot hide or fake one.
function parseTs(src: string): ts.SourceFile {
  return ts.createSourceFile("check.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function forEachNode(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node);
  ts.forEachChild(node, (child) => forEachNode(child, fn));
}

/** Number of calls `name(...)` (callee is the bare identifier) under `node`. */
function countCalls(node: ts.Node, name: string): number {
  let n = 0;
  forEachNode(node, (c) => {
    if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === name) n++;
  });
  return n;
}

/** `describe.skip`, `it["todo"]`, … anywhere in the file (called or aliased). */
export function disabledTestModifiers(src: string): string[] {
  const found: string[] = [];
  forEachNode(parseTs(src), (n) => {
    let base: ts.Expression | undefined;
    let mod: string | undefined;
    if (ts.isPropertyAccessExpression(n)) { base = n.expression; mod = n.name.text; }
    else if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) {
      base = n.expression; mod = n.argumentExpression.text;
    }
    if (base && mod && ts.isIdentifier(base) && TEST_FNS.has(base.text) && DISABLE_MODIFIERS.has(mod)) {
      found.push(`${base.text}.${mod}`);
    }
  });
  return found;
}

/** A return/throw anywhere under `st`, not counting nested function bodies. */
function canExitBlock(st: ts.Node): boolean {
  if (ts.isReturnStatement(st) || ts.isThrowStatement(st)) return true;
  if (ts.isFunctionLike(st) || ts.isClassLike(st)) return false;
  return ts.forEachChild(st, (child) => (canExitBlock(child) ? true : undefined)) === true;
}

/**
 * True when `call` is registered unconditionally: every ancestor up to the file
 * is a statement list or the callback body of a plain `describe(...)` call. A
 * test under `if`, a loop, a helper function, or any other context is not
 * provably executed, so it does not count.
 */
function registeredUnconditionally(call: ts.CallExpression): boolean {
  let node: ts.Node = call;
  while (!ts.isSourceFile(node.parent)) {
    const parent = node.parent;
    if (ts.isExpressionStatement(parent)) { node = parent; continue; }
    if (ts.isBlock(parent)) {
      // Any earlier statement that can exit the block (a return/throw at any
      // depth, outside a nested function) may skip the registration.
      const before = parent.statements.slice(0, parent.statements.indexOf(node as ts.Statement));
      if (before.some(canExitBlock)) return false;
      node = parent;
      continue;
    }
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && parent.body === node) {
      const host = parent.parent;
      if (!ts.isCallExpression(host) || !host.arguments.includes(parent)) return false;
      if (!ts.isIdentifier(host.expression) || host.expression.text !== "describe") return false;
      node = host;
      continue;
    }
    return false;
  }
  return ts.isExpressionStatement(node);
}

/** Titles of tests bun executes: `it(...)` / `test(...)` / `.only`, string-literal title. */
export function executedTestTitles(src: string): Set<string> {
  const titles = new Set<string>();
  forEachNode(parseTs(src), (n) => {
    if (!ts.isCallExpression(n) || n.arguments.length === 0) return;
    const callee = n.expression;
    const isTestFn = (e: ts.Expression) => ts.isIdentifier(e) && (e.text === "it" || e.text === "test");
    const runs = isTestFn(callee) ||
      (ts.isPropertyAccessExpression(callee) && callee.name.text === "only" && isTestFn(callee.expression));
    const first = n.arguments[0];
    if (runs && ts.isStringLiteralLike(first) && registeredUnconditionally(n)) titles.add(first.text);
  });
  return titles;
}

/** bunfig.toml [test] pathIgnorePatterns, as path regexes (repo-relative, "/"). */
function bunIgnoreRegexes(repoRoot: string): RegExp[] {
  const bunfig = path.join(repoRoot, "bunfig.toml");
  if (!fs.existsSync(bunfig)) return [];
  const toml = fs.readFileSync(bunfig, "utf8");
  const m = toml.match(/^pathIgnorePatterns\s*=\s*\[([^\]]*)\]/m);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map(([, glob]) => {
    let re = "";
    for (let i = 0; i < glob.length; i++) {
      if (glob.startsWith("**/", i)) { re += "(?:.*/)?"; i += 2; }
      else if (glob.startsWith("/**", i)) { re += "(?:/.*)?"; i += 2; }
      else if (glob.startsWith("**", i)) { re += ".*"; i += 1; }
      else if (glob[i] === "*") re += "[^/]*";
      else re += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${re}$`);
  });
}

/** Problems with one wrap_check against the source text of its file (empty = holds). */
export function wrapCheckProblems(check: WrapCheck, source: string): string[] {
  const problems: string[] = [];
  const sf = parseTs(source);

  const imported = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!stmt.moduleSpecifier.text.includes(check.import_from)) continue;
    const clause = stmt.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const el of clause.namedBindings.elements) {
      // `import { protectChunks as p }` binds p, so a call to protectChunks would be unresolved.
      if (!el.isTypeOnly && !el.propertyName) imported.add(el.name.text);
    }
  }
  for (const prim of check.primitives) {
    if (!imported.has(prim)) problems.push(`${prim} is not imported from a '${check.import_from}' path`);
  }

  // A wrapper must call a primitive or a wrapper listed (and verified) before it.
  const defs = new Map<string, ts.FunctionDeclaration>();
  forEachNode(sf, (n) => { if (ts.isFunctionDeclaration(n) && n.name && n.body) defs.set(n.name.text, n); });
  const verified: string[] = [];
  for (const w of check.wrappers) {
    const def = defs.get(w);
    if (!def) { problems.push(`wrapper ${w} is not defined`); continue; }
    const callees = [...check.primitives, ...verified];
    if (callees.some((c) => countCalls(def.body!, c) > 0)) verified.push(w);
    else problems.push(`wrapper ${w} does not call ${callees.join(" / ")}`);
  }

  const seen = new Set<string>();
  let index = 0;
  forEachNode(sf, (n) => {
    if (!ts.isCallExpression(n)) return;
    const callee = n.expression;
    const isRegister = (ts.isPropertyAccessExpression(callee) && callee.name.text === "registerTool") ||
      (ts.isIdentifier(callee) && callee.text === "registerTool");
    if (!isRegister) return;
    index++;
    const first = n.arguments[0];
    const name = first && ts.isStringLiteralLike(first) ? first.text : `#${index}`;
    seen.add(name);
    const spec = check.tools[name];
    if (!spec) { problems.push(`tool ${name} is registered but has no pinned D-RECALL wrapping`); return; }
    for (const [wrapper, min] of Object.entries(spec.calls)) {
      const got = countCalls(n, wrapper);
      if (got < min) problems.push(`tool ${name} calls ${wrapper} ${got}x, expected >= ${min}`);
    }
    const raw = check.result_builders.reduce((sum, b) => sum + countCalls(n, b), 0);
    if (raw > spec.max_results) problems.push(`tool ${name} has ${raw} raw result call(s), expected <= ${spec.max_results}`);
  });
  for (const name of Object.keys(check.tools)) {
    if (!seen.has(name)) problems.push(`pinned tool ${name} is not registered`);
  }
  return problems;
}

export interface SecViolation {
  control_id: string;
  kind:
    | "enforcer-missing"
    | "hostile-test-missing"
    | "hostile-test-not-run"
    | "hostile-title-missing"
    | "wrap-check-failed"
    | "mcp-surface-unmapped"
    | "prose-only-gap";
  detail: string;
}

/**
 * Run the R-SEC detector over the provided manifest.
 * Returns { enforcer: string[], hostileTest: string[], proseOnly: string[] }
 * where each list holds the control_id of failing controls.
 */
export function detectSecViolations(controls: SecurityControl[], repoRoot: string): {
  enforcer: string[];
  hostileTest: string[];
  wrap: string[];
  proseOnly: string[];
  violations: SecViolation[];
} {
  const enforcer: string[] = [];
  const hostileTest: string[] = [];
  const wrap: string[] = [];
  const proseOnly: string[] = [];
  const violations: SecViolation[] = [];
  const ignore = bunIgnoreRegexes(repoRoot);

  for (const ctrl of controls) {
    // 1. Enforcer file must exist for code controls
    if (ctrl.enforcer_kind === "code") {
      if (!ctrl.enforcer_file || ctrl.enforcer_file.trim() === "") {
        enforcer.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "enforcer-missing",
          detail: `enforcer_file is empty for code control — no enforcer declared`,
        });
      } else {
        const absEnforcer = path.join(repoRoot, ctrl.enforcer_file);
        if (!fs.existsSync(absEnforcer)) {
          enforcer.push(ctrl.control_id);
          violations.push({
            control_id: ctrl.control_id,
            kind: "enforcer-missing",
            detail: `enforcer_file does not exist on disk: ${ctrl.enforcer_file}`,
          });
        }
      }
    }

    // 2. Hostile test must exist for ALL controls (code or prose-only)
    if (!ctrl.hostile_test || ctrl.hostile_test.trim() === "") {
      hostileTest.push(ctrl.control_id);
      violations.push({
        control_id: ctrl.control_id,
        kind: "hostile-test-missing",
        detail: `hostile_test is empty — no hostile test declared`,
      });
    } else {
      const absTest = path.join(repoRoot, ctrl.hostile_test);
      const relTest = ctrl.hostile_test.split(path.sep).join("/");
      if (!fs.existsSync(absTest)) {
        hostileTest.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "hostile-test-missing",
          detail: `hostile_test does not exist on disk: ${ctrl.hostile_test}`,
        });
      } else if (!BUN_TEST_FILE_RE.test(relTest) || ignore.some((re) => re.test(relTest))) {
        hostileTest.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "hostile-test-not-run",
          detail: `hostile_test is not a file bun test runs (name or bunfig pathIgnorePatterns): ${ctrl.hostile_test}`,
        });
      } else if (ctrl.hostile_test_titles?.length) {
        const text = fs.readFileSync(absTest, "utf8");
        const disabled = disabledTestModifiers(text);
        if (disabled.length > 0) {
          hostileTest.push(ctrl.control_id);
          violations.push({
            control_id: ctrl.control_id,
            kind: "hostile-title-missing",
            detail: `hostile_test ${ctrl.hostile_test} disables tests (${disabled.join(", ")}); a bound hostile test must run`,
          });
        }
        const titles = executedTestTitles(text);
        for (const title of ctrl.hostile_test_titles) {
          if (!titles.has(title)) {
            hostileTest.push(ctrl.control_id);
            violations.push({
              control_id: ctrl.control_id,
              kind: "hostile-title-missing",
              detail: `hostile_test ${ctrl.hostile_test} has no test titled "${title}"`,
            });
          }
        }
      }
    }

    // 2b. Wrap check: every MCP tool handler still routes through D-RECALL
    if (ctrl.wrap_check) {
      const abs = path.join(repoRoot, ctrl.wrap_check.file);
      const problems = fs.existsSync(abs)
        ? wrapCheckProblems(ctrl.wrap_check, fs.readFileSync(abs, "utf8"))
        : [`file does not exist: ${ctrl.wrap_check.file}`];
      for (const problem of problems) {
        wrap.push(ctrl.control_id);
        violations.push({
          control_id: ctrl.control_id,
          kind: "wrap-check-failed",
          detail: `${ctrl.wrap_check.file}: ${problem}`,
        });
      }
    }

    // 3. Prose-only advisory
    if (ctrl.enforcer_kind === "prose-only") {
      proseOnly.push(ctrl.control_id);
      violations.push({
        control_id: ctrl.control_id,
        kind: "prose-only-gap",
        detail:
          `enforcer_kind=prose-only: "${ctrl.what_it_protects.slice(0, 80)}…" — ` +
          `no deterministic code enforcer; this is a security gap (recall-not-prose lesson). ` +
          `Action: implement a hook/script enforcer following the recall-protect pattern.`,
      });
    }
  }

  return { enforcer, hostileTest, wrap, proseOnly, violations };
}

/**
 * 2c. Every MCP server source is a model-callable read surface: it must be
 *     covered by a wrap_check, so a new server cannot ship unwrapped. Applies to
 *     the WHOLE manifest, so it is separate from the per-control detector.
 */
export function unmappedMcpSurfaces(controls: SecurityControl[], repoRoot: string): SecViolation[] {
  const violations: SecViolation[] = [];
  const mcpRoot = path.join(repoRoot, "src", "runtime", "mcp");
  const covered = new Set(controls.map((c) => c.wrap_check?.file).filter(Boolean));
  if (!fs.existsSync(mcpRoot)) return violations;
  for (const entry of fs.readdirSync(mcpRoot, { withFileTypes: true })) {
    const rel = `src/runtime/mcp/${entry.name}/index.ts`;
    if (!entry.isDirectory() || !fs.existsSync(path.join(repoRoot, rel))) continue;
    if (!covered.has(rel)) {
      violations.push({
        control_id: `MCP:${entry.name}`,
        kind: "mcp-surface-unmapped",
        detail: `${rel} is a model-callable MCP surface with no wrap_check control`,
      });
    }
  }
  return violations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rail runner
// ─────────────────────────────────────────────────────────────────────────────

export function run(): RailResult {
  const out: RailResult = {
    rail: "R-SEC",
    pass: true,
    advisory: false,
    violations: [],
    notes: [],
  };

  const detected = detectSecViolations(SECURITY_CONTROLS, REPO);
  const { enforcer, hostileTest, proseOnly } = detected;
  const unmapped = unmappedMcpSurfaces(SECURITY_CONTROLS, REPO);
  const violations = [...detected.violations, ...unmapped];

  const totalControls = SECURITY_CONTROLS.length;
  const codeControls = SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "code").length;
  const proseControls = SECURITY_CONTROLS.filter((c) => c.enforcer_kind === "prose-only").length;

  out.notes.push(
    `manifest: ${totalControls} controls total — ${codeControls} code-enforced, ${proseControls} prose-only`,
  );
  out.notes.push(
    `enforcer-exists check: ${codeControls} code controls checked`,
  );
  out.notes.push(
    `hostile-test-exists check: ${totalControls} controls checked`,
  );

  // STRICT: everything except the prose-only advisory blocks CI
  const strictViolations = violations.filter((v) => v.kind !== "prose-only-gap");

  // ADVISORY: prose-only gaps logged but do not block
  const advisoryViolations = violations.filter((v) => v.kind === "prose-only-gap");

  for (const v of strictViolations) {
    out.violations.push(`[STRICT][${v.control_id}][${v.kind}] ${v.detail}`);
  }

  for (const v of advisoryViolations) {
    out.notes.push(`[ADVISORY][${v.control_id}][prose-only-gap] ${v.detail}`);
  }

  // Summary notes
  if (enforcer.length === 0) {
    out.notes.push(`enforcer-exists: all ${codeControls} code enforcer files exist ✓`);
  } else {
    out.notes.push(`enforcer-exists: ${enforcer.length} enforcer file(s) missing — STRICT`);
  }

  if (hostileTest.length === 0) {
    out.notes.push(`hostile-test-exists: all ${totalControls} hostile tests exist ✓`);
  } else {
    out.notes.push(`hostile-test-exists: ${hostileTest.length} hostile test file(s) missing — STRICT`);
  }

  if (proseOnly.length === 0) {
    out.notes.push(
      `prose-only-gap: 0 prose-only controls (M8 is fully deterministic code) ✓`,
    );
  } else {
    out.notes.push(
      `prose-only-gap: ${proseOnly.length} prose-only control(s) flagged (ADVISORY — not blocking) [${proseOnly.join(", ")}]`,
    );
  }

  out.pass = strictViolations.length === 0;
  // Rail is STRICT (not advisory) — prose-only gaps are recorded as notes, not violations.
  out.advisory = false;

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-vacuity proof
// ─────────────────────────────────────────────────────────────────────────────

function prove(): void {
  console.log("\n[R-SEC] --prove (anti-vacuity)");

  // (a) A code control pointing at a nonexistent enforcer_file → TRIPS the rail
  const withMissingEnforcer: SecurityControl[] = [
    {
      control_id: "TEST-MISSING-ENFORCER",
      what_it_protects: "test: nonexistent enforcer",
      enforcer_file: "scripts/lib/security/DOES_NOT_EXIST_abcxyz.ts",
      enforcer_function: "noop",
      enforcer_kind: "code",
      hostile_test: "src/domains/knowledge/recall-protect.test.ts", // real file
      anti_vacuity_control: "planted nonexistent enforcer",
    },
  ];
  const { enforcer: e1 } = detectSecViolations(withMissingEnforcer, REPO);
  proveAssert(
    e1.includes("TEST-MISSING-ENFORCER"),
    "enforcer-missing detector TRIPS when enforcer_file does not exist on disk",
  );

  // (b) A control pointing at a nonexistent hostile_test → TRIPS
  const withMissingTest: SecurityControl[] = [
    {
      control_id: "TEST-MISSING-HOSTILE",
      what_it_protects: "test: nonexistent hostile test",
      enforcer_file: "scripts/lib/recall-protect.ts", // real file
      enforcer_function: "protectChunks",
      enforcer_kind: "code",
      hostile_test: "scripts/__tests__/DOES_NOT_EXIST_abcxyz.test.ts",
      anti_vacuity_control: "planted nonexistent test",
    },
  ];
  const { hostileTest: ht1 } = detectSecViolations(withMissingTest, REPO);
  proveAssert(
    ht1.includes("TEST-MISSING-HOSTILE"),
    "hostile-test-missing detector TRIPS when hostile_test file does not exist",
  );

  // (c) A prose-only entry → advisory fires
  const withProseOnly: SecurityControl[] = [
    {
      control_id: "TEST-PROSE-ONLY",
      what_it_protects: "test: prose-only control (no code enforcer)",
      enforcer_file: "",
      enforcer_function: "",
      enforcer_kind: "prose-only",
      hostile_test: "src/domains/knowledge/recall-protect.test.ts", // real file
      anti_vacuity_control: "planted prose-only",
    },
  ];
  const { proseOnly: p1, violations: v1 } = detectSecViolations(withProseOnly, REPO);
  proveAssert(
    p1.includes("TEST-PROSE-ONLY"),
    "prose-only-gap advisory fires for a control with enforcer_kind='prose-only'",
  );
  // prose-only should be advisory, not a strict violation
  const strictOnly = v1.filter((v) => v.kind !== "prose-only-gap");
  proveAssert(
    strictOnly.length === 0,
    "prose-only control does NOT generate a strict (enforcer-missing) violation — only advisory",
  );

  // (d) Clean control pointing at real files → passes
  const clean: SecurityControl[] = [
    {
      control_id: "TEST-CLEAN",
      what_it_protects: "test: clean code control",
      enforcer_file: "scripts/lib/recall-protect.ts",
      enforcer_function: "protectChunks",
      enforcer_kind: "code",
      hostile_test: "src/domains/knowledge/recall-protect.test.ts",
      anti_vacuity_control: "planted clean control",
    },
  ];
  const { enforcer: e2, hostileTest: ht2, proseOnly: p2 } = detectSecViolations(clean, REPO);
  proveAssert(
    e2.length === 0 && ht2.length === 0 && p2.length === 0,
    "clean control (real enforcer + real hostile_test, code-enforced) passes all checks",
  );

  // (e) The real manifest has zero prose-only controls (all M8 enforcers are code)
  const { proseOnly: realProseOnly } = detectSecViolations(SECURITY_CONTROLS, REPO);
  proveAssert(
    realProseOnly.length === 0,
    `real manifest has 0 prose-only controls — M8 is fully deterministic code (no prose-only gap found)`,
  );

  // (f) The real manifest has zero strict violations (all enforcer + test files exist)
  const { enforcer: realMissingEnforcer, hostileTest: realMissingTest } = detectSecViolations(
    SECURITY_CONTROLS,
    REPO,
  );
  proveAssert(
    realMissingEnforcer.length === 0,
    `real manifest has 0 missing enforcer files`,
  );
  proveAssert(
    realMissingTest.length === 0,
    `real manifest has 0 missing hostile test files`,
  );

  // (g) A hostile_test_titles entry that is not a test title → TRIPS
  const withMissingTitle: SecurityControl[] = [
    {
      control_id: "TEST-MISSING-TITLE",
      what_it_protects: "test: named hostile test absent",
      enforcer_file: "src/domains/security/config.ts",
      enforcer_function: "parseSecurityConfig",
      enforcer_kind: "code",
      hostile_test: "hooks/__tests__/security-config.test.ts",
      hostile_test_titles: ["DOES NOT EXIST abcxyz"],
      anti_vacuity_control: "planted absent title",
    },
  ];
  proveAssert(
    detectSecViolations(withMissingTitle, REPO).violations.some((v) => v.kind === "hostile-title-missing"),
    "hostile-title-missing detector TRIPS when a named title is not an it()/test() title",
  );

  // (g2) The bound title disabled (it.skip), commented out, or under describe.skip → TRIPS
  const titled = "ignores invalid enum values and falls back to defaults";
  const cfgSrc = fs.readFileSync(path.join(REPO, "hooks/__tests__/security-config.test.ts"), "utf8");
  proveAssert(cfgSrc.includes(`it("${titled}"`), "planted-title fixture source holds the real it() declaration");
  const disabledVariants: Array<[string, string]> = [
    ["it.skip", cfgSrc.replace(`it("${titled}"`, `it.skip("${titled}"`)],
    ["commented", cfgSrc.replace(`it("${titled}"`, `// it("${titled}"`)],
    ["describe.skip", cfgSrc.replace('describe("parseSecurityConfig"', 'describe.skip("parseSecurityConfig"')],
    ["spaced describe .skip", cfgSrc.replace('describe("parseSecurityConfig"', 'describe .skip("parseSecurityConfig"')],
    ["describe[\"skip\"]", cfgSrc.replace('describe("parseSecurityConfig"', 'describe["skip"]("parseSecurityConfig"')],
    ["block-commented", cfgSrc.replace(`it("${titled}"`, `/* it("${titled}", () => {}) */ it("renamed"`)],
    ["under if (false)", cfgSrc.replace(`  it("${titled}"`, `  if (false) it("${titled}"`)],
    ["inside a helper", cfgSrc.replace(`  it("${titled}"`, `  const never = () => it("${titled}"`)],
    ["after an early return", cfgSrc.replace(`  it("${titled}"`, `  return;\n  it("${titled}"`)],
    ["after a conditional return", cfgSrc.replace(`  it("${titled}"`, `  if (true) return;\n  it("${titled}"`)],
    ["after a nested throw", cfgSrc.replace(`  it("${titled}"`, `  { try { throw 0; } finally {} }\n  it("${titled}"`)],
  ];
  for (const [label, variant] of disabledVariants) {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "guild-rsec-title-"));
    try {
      fs.mkdirSync(path.join(tmp, "hooks", "__tests__"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "hooks", "__tests__", "security-config.test.ts"), variant);
      const ctrl = { ...withMissingTitle[0], control_id: `TEST-${label}`, enforcer_kind: "prose-only" as const, hostile_test_titles: [titled] };
      proveAssert(
        variant !== cfgSrc && detectSecViolations([ctrl], tmp).violations.some((v) => v.kind === "hostile-title-missing"),
        `hostile-title-missing TRIPS when the bound test is ${label}`,
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // (h) A hostile_test that bun test never runs (not *.test.ts) → TRIPS
  const withUnrunTest: SecurityControl[] = [
    { ...withMissingTitle[0], control_id: "TEST-NOT-RUN", hostile_test: "tests/rearch/r-sec.ts", hostile_test_titles: undefined },
  ];
  proveAssert(
    detectSecViolations(withUnrunTest, REPO).violations.some((v) => v.kind === "hostile-test-not-run"),
    "hostile-test-not-run detector TRIPS when hostile_test is not a file bun test runs",
  );

  // (i) Removing the D-RECALL wrapping from ONE guild-memory tool → TRIPS
  const sec16 = SECURITY_CONTROLS.find((c) => c.control_id === "SEC-16")!;
  const memSrc = fs.readFileSync(path.join(REPO, sec16.wrap_check!.file), "utf8");
  proveAssert(wrapCheckProblems(sec16.wrap_check!, memSrc).length === 0, "real guild-memory source passes its wrap_check");
  const [head, first, ...others] = memSrc.split(/(?=\bregisterTool\s*\()/);
  const strippedTool = [head, first.replace(/\bprotect(Page|Meta)\(/g, "raw$1("), ...others].join("");
  proveAssert(
    wrapCheckProblems(sec16.wrap_check!, strippedTool).some((p) => p.includes("calls protectPage 0x")),
    "wrap_check TRIPS when one guild-memory tool handler stops calling protectPage/protectMeta",
  );

  // (i2) Partial removal: wiki_get keeps protectPage but returns raw frontmatter → TRIPS
  const getAt = memSrc.search(/\bregisterTool\s*\(\s*["']wiki_get["']/);
  const metaAt = memSrc.indexOf("protectMeta(", getAt);
  const partial = memSrc.slice(0, metaAt) + "rawMeta(" + memSrc.slice(metaAt + "protectMeta(".length);
  proveAssert(
    getAt !== -1 && wrapCheckProblems(sec16.wrap_check!, partial).some((p) => p.includes("wiki_get calls protectMeta 0x")),
    "wrap_check TRIPS when wiki_get drops only protectMeta while protectPage survives",
  );

  // (i2b) The removed call kept in a trailing comment does not count → TRIPS
  const commented = memSrc.slice(0, metaAt) + "/* protectMeta( */ rawMeta(" + memSrc.slice(metaAt + "protectMeta(".length);
  const trailing = commented.replace(/rawMeta\(([^\n]*)$/m, "rawMeta($1 // protectMeta(x)");
  proveAssert(
    wrapCheckProblems(sec16.wrap_check!, trailing).some((p) => p.includes("wiki_get calls protectMeta 0x")),
    "wrap_check TRIPS when the removed wrapper call survives only in a comment",
  );

  // (i3) An extra raw result path in a handler → TRIPS
  const searchAt = memSrc.search(/\bregisterTool\s*\(\s*["']wiki_search["']/);
  const bodyAt = memSrc.indexOf("=> {", searchAt);
  const rawPath = memSrc.slice(0, bodyAt) + "=> { if (Math.random() > 2) return jsonResult({ leak: true });" + memSrc.slice(bodyAt + "=> {".length);
  proveAssert(
    bodyAt !== -1 && wrapCheckProblems(sec16.wrap_check!, rawPath).some((p) => p.includes("wiki_search has 2 raw result")),
    "wrap_check TRIPS when a handler gains a raw jsonResult path",
  );

  // (i4) A registered tool with no pinned wrapping → TRIPS
  proveAssert(
    wrapCheckProblems(sec16.wrap_check!, memSrc + '\nserver.registerTool("wiki_raw", {}, async () => jsonResult({}));\n')
      .some((p) => p.includes("wiki_raw is registered but has no pinned")),
    "wrap_check TRIPS when a new MCP tool is registered without pinned D-RECALL wrapping",
  );

  // (j) Removing the D-RECALL import from guild-telemetry → TRIPS
  const sec17 = SECURITY_CONTROLS.find((c) => c.control_id === "SEC-17")!;
  const telSrc = fs.readFileSync(path.join(REPO, sec17.wrap_check!.file), "utf8");
  proveAssert(wrapCheckProblems(sec17.wrap_check!, telSrc).length === 0, "real guild-telemetry source passes its wrap_check");
  const noImport = telSrc.replace(/import\s*\{[^}]*\bprotectFields\b[^}]*\}\s*from\s*["'][^"']*domains\/knowledge[^"']*["'];?/, "");
  proveAssert(noImport !== telSrc, "planted telemetry copy actually removed the D-RECALL import");
  proveAssert(
    wrapCheckProblems(sec17.wrap_check!, noImport).some((p) => p.includes("is not imported")),
    "wrap_check TRIPS when guild-telemetry no longer imports protectFields from the knowledge domain",
  );

  // (k) A wrapper whose body no longer calls a primitive → TRIPS
  const defAt = memSrc.indexOf("function protectPage(");
  const callAt = memSrc.indexOf("protectChunks(", defAt);
  const hollow = memSrc.slice(0, callAt) + "identity(" + memSrc.slice(callAt + "protectChunks(".length);
  proveAssert(
    defAt !== -1 && wrapCheckProblems(sec16.wrap_check!, hollow).some((p) => p.includes("wrapper protectPage")),
    "wrap_check TRIPS when protectPage stops calling protectChunks",
  );

  // (l) A new MCP server source with no wrap_check control → TRIPS
  const tmpRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "guild-rsec-"));
  try {
    fs.mkdirSync(path.join(tmpRoot, "src", "runtime", "mcp", "rogue"), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, "src", "runtime", "mcp", "rogue", "index.ts"), "export {};\n");
    proveAssert(
      unmappedMcpSurfaces([], tmpRoot).some((v) => v.control_id === "MCP:rogue"),
      "mcp-surface-unmapped detector TRIPS for an MCP server source no control covers",
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // (m) The real manifest binds the hostile-config enum test and both MCP read paths
  const sec15 = SECURITY_CONTROLS.find((c) => c.control_id === "SEC-15");
  proveAssert(
    sec15?.hostile_test === "hooks/__tests__/security-config.test.ts" &&
      (sec15.hostile_test_titles ?? []).includes("ignores invalid enum values and falls back to defaults"),
    "real manifest binds the hostile-config enum sanitization test (SEC-15)",
  );
  const { wrap: realWrap, violations: realViolations } = detectSecViolations(SECURITY_CONTROLS, REPO);
  proveAssert(
    realWrap.length === 0 && !realViolations.some((v) => v.kind !== "prose-only-gap"),
    "real manifest has 0 wrap-check / title / not-run violations",
  );
  proveAssert(
    unmappedMcpSurfaces(SECURITY_CONTROLS, REPO).length === 0 &&
      unmappedMcpSurfaces(SECURITY_CONTROLS.filter((c) => c.control_id !== "SEC-16"), REPO)
        .some((v) => v.control_id === "MCP:guild-memory"),
    "every real MCP server is covered, and dropping SEC-16 un-covers guild-memory",
  );

  console.log("\n  All R-SEC anti-vacuity proofs passed.");
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (process.argv.includes("--prove")) {
    try {
      prove();
    } catch {
      process.exit(1);
    }
  } else {
    process.exit(report(run()));
  }
}
